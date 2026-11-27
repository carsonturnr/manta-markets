// The privacy policy (steps 10 and 11): what the waitlist and accounts collect and what happens
// to it, in plain English. It must stay true to the code: lib/account.ts, pricing/alerts.py,
// db/schema.sql (manta.waitlist, manta.watchlist, manta.alerts). The waitlist form was removed
// 2026-11-26 (accounts and the API are open); addresses already on it stay until deleted as below.
export const metadata = { title: "Manta: privacy" };

const CONTACT = "privacy@mantamarkets.com";

export default function Privacy() {
  return (
    <div className="prose">
      <h1>Privacy policy</h1>
      <p className="muted">Effective 27 November 2026.</p>

      <p>
        Manta is run by Carson Turner. This page explains what personal data Manta collects, why,
        and what you can ask for. Questions and requests:{" "}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>

      <h2>What we collect</h2>
      <p>
        <b>The waitlist:</b> your email address and the time you signed up. Nothing else is asked
        for or stored with it.
      </p>
      <p>
        <b>An account:</b> signing in is handled by Clerk, which keeps your email address (and, if
        you sign in with Google, the name and picture Google shares). Manta&apos;s own database
        holds only Clerk&apos;s ID for your account, never your email address, next to what you
        save: the contracts on your watchlist, your alerts, and when each alert fired.
      </p>
      <p>
        Everything else on this site (prices, order books, fair values, statistics) is market data
        from the venues&apos; public APIs and contains no personal data. The only cookies are the
        ones Clerk needs to keep you signed in. The site uses no analytics, advertising or tracking
        scripts.
      </p>
      <p>
        Like any website, the company that hosts it (Vercel) keeps routine request logs, such as IP
        addresses and browser types, for a short time to run and secure the service. We don&apos;t
        use them to identify visitors, and our code never writes email addresses to any log.
      </p>

      <h2>Why, and on what basis</h2>
      <p>
        <b>The waitlist:</b> to email you about Manta: when accounts open, and occasional news about
        the product. We rely on your consent, given by ticking the box when you sign up. You can
        withdraw it at any time, and we&apos;ll delete your address.
      </p>
      <p>
        <b>An account:</b> to provide what you ask for: your watchlist, and the alert emails you set
        up. When an alert fires, its email is sent to the address Clerk has for you, which is read
        at that moment and not kept. Accounts get no marketing email.
      </p>

      <h2>Where it is kept, and who can see it</h2>
      <p>
        In a database on Manta&apos;s own server, rented from Hetzner in Finland (Helsinki). The table is protected by
        row-level security: the website&apos;s sign-up connection can add an address but cannot read
        the list, and only the administrator&apos;s login can read or delete it. Watchlists and
        alerts are protected the same way: the website&apos;s account connection can reach only the
        signed-in person&apos;s rows. The website itself is hosted by Vercel, accounts by Clerk, and
        alert emails are sent through Resend, all in the United States. They process the data only
        to provide their services to us.
      </p>
      <p>We don&apos;t sell, rent or share your data with anyone else.</p>

      <h2>How long</h2>
      <p>
        <b>The waitlist:</b> until you ask us to delete it, or until the waitlist ends: if Manta
        stops, or once accounts open and you have been told, addresses that didn&apos;t become
        accounts are deleted.
      </p>
      <p>
        <b>An account:</b> until you delete it. You can delete your account yourself from the
        account menu (your picture, top right, then Manage account); your watchlist, alerts and
        their history are then deleted from Manta&apos;s database within a day. Deleting an alert
        deletes its history.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to see the data we hold about you, correct it, or have it deleted, by writing to{" "}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a> from the address concerned. We answer within 30
        days. If you are in the EU or the UK you can also complain to your data-protection
        authority, and California residents have the same rights to know and to delete under
        California law.
      </p>

      <h2>Children</h2>
      <p>
        Manta is about financial markets and is not meant for anyone under 18. We don&apos;t
        knowingly collect their data; if you think a child has signed up, tell us and we&apos;ll
        delete it.
      </p>

      <h2>Changes</h2>
      <p>
        If this policy changes, the new version is published here with a new date. If a change
        affects how we use your email address, we&apos;ll tell you by email before it applies.
      </p>
    </div>
  );
}
