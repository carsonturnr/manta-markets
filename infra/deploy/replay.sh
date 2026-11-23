#!/usr/bin/env bash
# Hourly replay files (step 8; recorder/cmd/replay): for every finished hour still on this
# machine (the VM keeps 12 hours of raw files) that has no replay yet, rebuild Kalshi's books
# from that hour's files, warmed up on the previous hour's, and write one file per event to
# /var/lib/manta/replay/<event>/<hour>.json.gz. Run by manta-replay.service at low priority
# with CPU and memory caps, so it can't crowd out the recorder. Files older than 60 days go.
set -euo pipefail
RAW=${RAW:-/var/lib/manta/raw}
OUT=${OUT:-/var/lib/manta/replay}
SERIES=${REPLAY_SERIES:-KXBTCD}
DONE="$OUT/.done"
mkdir -p "$DONE"

files() { # the Kalshi files of one hour (YYYY-mm-ddTHH), in time order
  ls "$RAW/kalshi/${1%T*}/${1#*T}"-*.jsonl.gz 2>/dev/null | sort || true
}

# Event response (recorder/cmd/eventresponse, docs/plan-event-response.md): for each release in
# releases.tsv whose window (t0 − 15 min to t0 + 30 min) has closed and that has no file yet,
# while its raw files are still here, write $OUT/events/<release>.json. Before the replay, so
# the page is up minutes after the hour; a failure is logged and doesn't hold up the replay.
RELEASES=${RELEASES:-/opt/manta/releases.tsv}
# The contracts still trading through a release: Fed meetings, later CPI/payrolls ladders,
# index, FX and crypto hourlies (the plan's list).
EVENT_SERIES=${EVENT_SERIES:-KXFEDDECISION,KXFED,KXPAYROLLS,KXU3,KXCPI,KXCPIYOY,KXCPICORE,KXCPICOREYOY,KXINXU,KXNASDAQ100U,KXEURUSDH,KXUSDJPYH,KXBTCD,KXETHD}
clock_us() { # a timesync figure in µs ("Offset: -38us", "Root distance: 29.372ms (max: 5s)")
  timedatectl timesync-status 2>/dev/null | awk -v k="$1:" 'index($0, k) {
    s = $0; sub(/^[^:]*: */, "", s); split(s, a, " "); n = a[1] + 0
    if (a[1] ~ /ms$/) n *= 1000; else if (a[1] !~ /us$/ && a[1] ~ /s$/) n *= 1e6
    printf "%d\n", n }'
}
# The page publishes the VM clock: read now, not the command's defaults (measured 2026-11-23).
offset=$(clock_us Offset)
bound=$(clock_us "Root distance")
clockflags="${offset:+-vm-offset-us $offset} ${bound:+-bound-ms $(((bound + 999) / 1000))}"
now=$(date -u +%s)
failed=0
while IFS=$'\t' read -r id t0 name; do
  [[ -z "$id" || "$id" == \#* ]] && continue
  t=$(date -u -d "$t0" +%s)
  # Window closed (+5 s: receive time trails Kalshi's stamps); raw files kept 12 h, so 11 is safe.
  ((now > t + 1805 && now < t + 11 * 3600)) || continue
  [ -e "$OUT/events/$id.json" ] && continue
  list=""
  # Every hour from the warm-up's start (t0 − 35 min) to the window's end.
  for ((h = (t - 2100) / 3600 * 3600; h <= t + 1805; h += 3600)); do
    list="$list $(files "$(date -u -d "@$h" +%Y-%m-%dT%H)")"
  done
  if [ -z "${list// /}" ]; then
    echo "$id: no raw files for its window"
    continue
  fi
  # shellcheck disable=SC2086 # file lists split on whitespace on purpose (names have none)
  /opt/manta/bin/eventresponse -release "$id" -name "$name" -t0 "$t0" -series "$EVENT_SERIES" \
    $clockflags -out "$OUT" $list || { echo "$id: eventresponse failed, retried next hour"; failed=1; }
done < <(cat "$RELEASES" 2>/dev/null || true)

for back in $(seq 11 -1 1); do
  hour=$(date -u -d "$back hour ago" +%Y-%m-%dT%H)
  prev=$(date -u -d "$((back + 1)) hour ago" +%Y-%m-%dT%H)
  [ -e "$DONE/$hour" ] && continue
  cur=$(files "$hour")
  if [ -z "$cur" ]; then
    echo "$hour: no raw files (already archived away, or the recorder was down)"
    touch "$DONE/$hour"
    continue
  fi
  # shellcheck disable=SC2086 # file lists split on whitespace on purpose (names have none)
  /opt/manta/bin/replay -series "$SERIES" -hour "$hour" -out "$OUT" $(files "$prev") $cur
  touch "$DONE/$hour"
done
find "$OUT" -name '*.json.gz' -mtime +60 -delete
find "$DONE" -type f -mtime +60 -delete
find "$OUT" -mindepth 1 -type d -empty -not -path "$DONE" -delete
exit "$failed" # a failed release shows as a failed run in systemctl
