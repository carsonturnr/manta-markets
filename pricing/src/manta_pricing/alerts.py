"""Alerts (step 11): checks every user's alerts against the minute's listing and emails the ones
that start to hold.

Runs on the VM after manta-contracts stores the listing (contracts.py), with the admin login,
which row-level security doesn't limit. The conditions match site/lib/alerts.ts and
db/schema.sql (manta.alerts):

    above / below  midpoint ≥ / ≤ threshold        spread  ask − bid ≥ threshold
    depth          the smaller best-price size < threshold contracts, or a side is empty
    venues         |Kalshi midpoint − Polymarket midpoint| ≥ threshold, from manta.pairs

An alert fires when its condition starts to hold (it didn't at the last check), at most once an
hour. Firing writes manta.alert_log and emails the user through Resend; the address comes from
Clerk at that moment and isn't kept. Email addresses are never printed: logs carry counts only.

A user who deletes their account at Clerk loses their watchlist and alerts here too: at once if
one of their alerts fires, otherwise in the daily sweep.
"""

import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta

import psycopg
from psycopg.rows import dict_row

SITE = "https://mantamarkets.com"
SENDER = "Manta alerts <alerts@mantamarkets.com>"
COOLDOWN = timedelta(hours=1)
EPS = 1e-9  # prices are floats: 0.03 must count as at least 3¢


def mid(bid: float | None, ask: float | None) -> float | None:
    return None if bid is None or ask is None else (bid + ask) / 2


def evaluate(kind: str, threshold: float, r: dict) -> tuple[bool, float | None]:
    """Whether the condition holds now, and the value it was judged on (None: no reading).
    `r` has the contract's bid, ask, bid_size, ask_size and its pair's two midpoints."""
    m = mid(r["bid"], r["ask"])
    if kind == "above":
        return (m is not None and m >= threshold - EPS), m
    if kind == "below":
        return (m is not None and m <= threshold + EPS), m
    if kind == "spread":
        s = None if m is None else r["ask"] - r["bid"]
        return (s is not None and s >= threshold - EPS), s
    if kind == "depth":
        if r["bid_size"] is None or r["ask_size"] is None:
            return True, None  # a side is empty: no depth at all
        d = min(r["bid_size"], r["ask_size"])
        return d < threshold, d
    if kind == "venues":
        k, p = r["kalshi_mid"], r["poly_mid"]
        g = None if k is None or p is None else abs(k - p)
        return (g is not None and g >= threshold - EPS), g
    raise ValueError(kind)


def fires(met: bool, was_met: bool, fired: datetime | None, now: datetime) -> bool:
    """An alert fires when its condition starts to hold, at most once per COOLDOWN."""
    return met and not was_met and (fired is None or now - fired >= COOLDOWN)


def describe(kind: str, threshold: float) -> str:
    """The same words as site/lib/alerts.ts."""
    c = f"{round(threshold * 1000) / 10:g}¢"
    return {
        "above": f"Midpoint at or above {c}",
        "below": f"Midpoint at or below {c}",
        "spread": f"Spread at least {c}",
        "depth": f"Size at the best bid or ask under {threshold:,.0f} contracts",
        "venues": f"Kalshi and Polymarket midpoints at least {c} apart",
    }[kind]


def reading(kind: str, value: float | None) -> str:
    if value is None:
        return "one side of the book is empty" if kind == "depth" else "no reading"
    if kind == "depth":
        return f"{value:,.0f} contracts"
    return f"{round(value * 1000) / 10:g}¢"


# Every alert still running, with what it needs from this minute's listing. A contract is a
# whole side of at most one pair; `limit 1` keeps it one row even if not.
ACTIVE = """
select a.alert_id, a.user_id, a.venue, a.id, a.kind, a.threshold, a.met, a.fired, a.closes,
       m.id is not null as listed, m.close_time, m.title, m.label,
       m.bid, m.ask, m.bid_size, m.ask_size, p.kalshi_mid, p.poly_mid
from manta.alerts a
left join manta.markets m on m.venue = a.venue and m.id = a.id
left join lateral (
    select (kalshi_bid + kalshi_ask) / 2 as kalshi_mid, (poly_bid + poly_ask) / 2 as poly_mid
    from manta.pairs
    where (a.venue = 'kalshi' and kalshi_ids = array[a.id])
       or (a.venue = 'polymarket' and poly_ids = array[a.id])
    limit 1
) p on true
where a.ended is null
"""


def check(conn: psycopg.Connection, now: datetime) -> None:
    """Checks every running alert once; emails the ones that fire."""
    alerts = conn.cursor(row_factory=dict_row).execute(ACTIVE).fetchall()
    ended = fired = emailed = 0
    gone: set[str] = set()
    for a in alerts:
        if a["user_id"] in gone:
            continue
        if not a["listed"]:
            # Gone from the listing: closed, once its close time has passed.
            if a["closes"] is not None and a["closes"] <= now:
                conn.execute("update manta.alerts set ended = %s where alert_id = %s",
                             (now, a["alert_id"]))  # fmt: skip
                ended += 1
            continue
        met, value = evaluate(a["kind"], a["threshold"], a)
        go = fires(met, a["met"], a["fired"], now)
        sent = False
        if go:
            outcome = send(a, value)
            if outcome == "gone":
                forget(conn, a["user_id"])
                gone.add(a["user_id"])
                continue
            sent = outcome == "sent"
        conn.execute(
            "update manta.alerts set met = %s, closes = %s,"
            " fired = case when %s then %s else fired end where alert_id = %s",
            (met, a["close_time"], go, now, a["alert_id"]),
        )
        if go:
            conn.execute("insert into manta.alert_log values (%s, %s, %s, %s, %s)",
                         (a["alert_id"], a["user_id"], now, value, sent))  # fmt: skip
            fired += 1
            emailed += sent
    conn.commit()
    if fired or ended or gone:
        print(
            f"alerts: {len(alerts)} checked, {fired} fired, {emailed} emailed, {ended} ended,"
            f" {len(gone)} deleted accounts removed"
        )


def forget(conn: psycopg.Connection, user_id: str) -> None:
    """Deletes everything of a user whose Clerk account is gone (the log goes with the alerts)."""
    conn.execute("delete from manta.alerts where user_id = %s", (user_id,))
    conn.execute("delete from manta.watchlist where user_id = %s", (user_id,))


def sweep(conn: psycopg.Connection) -> None:
    """Once a day: forgets the users Clerk no longer has."""
    users = [r[0] for r in conn.execute(
        "select user_id from manta.watchlist union select user_id from manta.alerts")]  # fmt: skip
    gone = [u for u in users if clerk_user(u) is None]
    for u in gone:
        forget(conn, u)
    conn.commit()
    print(f"alerts: swept {len(users)} users, {len(gone)} deleted accounts removed")


def http(url: str, key: str, body: dict | None = None) -> dict:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={
        "Authorization": f"Bearer {key}", "Content-Type": "application/json",
        "User-Agent": "manta-markets/0.1",
    })  # fmt: skip
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def clerk_user(user_id: str) -> dict | None:
    """The user from Clerk's API; None if Clerk has no such user (the account was deleted)."""
    try:
        return http(f"https://api.clerk.com/v1/users/{user_id}", os.environ["CLERK_SECRET_KEY"])
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def send(a: dict, value: float | None) -> str:
    """Emails one firing: "sent", "failed" (logged without the address), or "gone" (no such
    user at Clerk)."""
    try:
        u = clerk_user(a["user_id"])
        if u is None:
            return "gone"
        primary = u.get("primary_email_address_id")
        to = next((e["email_address"] for e in u.get("email_addresses", [])
                   if e["id"] == primary), None)  # fmt: skip
        if to is None:
            print(f"alert {a['alert_id']}: the user has no email address at Clerk")
            return "failed"
        page = f"{SITE}/contract/{a['venue']}/{a['id']}"
        condition = describe(a["kind"], a["threshold"])
        text = (
            f"{condition}: now {reading(a['kind'], value)}.\n\n"
            f"{a['title']} ({a['label']}, {'Kalshi' if a['venue'] == 'kalshi' else 'Polymarket'})"
            f"\n{page}\n\n"
            "This alert emails again only after the condition has stopped holding, at most once"
            f" an hour. Change or delete your alerts: {SITE}/account\n\n"
            "Manta shows market data and analytics. Not investment advice."
        )
        http("https://api.resend.com/emails", os.environ["RESEND_API_KEY"], {
            "from": SENDER, "to": [to], "subject": f"Manta alert: {condition}", "text": text,
        })  # fmt: skip
        return "sent"
    except Exception as e:  # noqa: BLE001 - logged in alert_log as not emailed
        # The error's class only: a message could quote the address.
        print(f"alert {a['alert_id']}: email failed ({type(e).__name__})")
        return "failed"
