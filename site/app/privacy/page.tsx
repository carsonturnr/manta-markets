// The privacy policy (step 10): what the waitlist collects and what happens to it, in plain
// English. It must stay true to the code: lib/waitlist.ts, db/schema.sql (manta.waitlist).
export const metadata = { title: "Manta: privacy" };

const CONTACT = "privacy@mantamarkets.com";

export default function Privacy() {
  return (
    <div className="prose">
      <h1>Privacy policy</h1>
      <p className="muted">Effective 17 November 2026.</p>

      <p>
        Manta is run by Carson Turner. This page explains what personal data Manta collects, why,
        and what you can ask for. Questions and requests:{" "}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>

      <h2>What we collect</h2>
      <p>
        Only what you give us when you join the waitlist: your email address, and the time you
        signed up. Nothing else is asked for or stored with it.
      </p>
      <p>
        Everything else on this site (prices, order books, fair values, statistics) is market data
        from the venues&apos; public APIs and contains no personal data. The site sets no cookies
        and uses no analytics, advertising or tracking scripts.
      </p>
      <p>
        Like any website, the company that hosts it (Vercel) keeps routine request logs, such as IP
        addresses and browser types, for a short time to run and secure the service. We don&apos;t
        use them to identify visitors, and our code never writes email addresses to any log.
      </p>

      <h2>Why, and on what basis</h2>
      <p>
        To email you about Manta: when accounts open, and occasional news about the product. We rely
        on your consent, given by ticking the box when you sign up. You can withdraw it at any time,
        and we&apos;ll delete your address.
      </p>

      <h2>Where it is kept, and who can see it</h2>
      <p>
        In a database hosted by Supabase in the United States (Ohio). The table is protected by
        row-level security: the website&apos;s sign-up connection can add an address but cannot read
        the list, and only the administrator&apos;s login can read or delete it. The website itself
        is hosted by Vercel. Supabase and Vercel process the data only to provide their services to
        us.
      </p>
      <p>We don&apos;t sell, rent or share your email address with anyone else.</p>

      <h2>How long</h2>
      <p>
        Until you ask us to delete it, or until the waitlist ends: if Manta stops, or once accounts
        open and you have been told, addresses that didn&apos;t become accounts are deleted.
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
