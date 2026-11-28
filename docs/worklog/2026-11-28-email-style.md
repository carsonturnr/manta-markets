# Designed HTML for the two emails

## What
- New `pricing/src/manta_pricing/mail.py`: one HTML layout (logo, title, body, button, footer)
  with inline styles, simple tables, 560 px wide, Georgia and system sans, values HTML-escaped.
- User alert (`alerts.py message()`): the market question, outcome and venue, the condition and
  current value large beside a mint edge, an "Open the market" button, and a one-line footer
  ("Manage alerts", "Not investment advice").
- Ops email (`quality.py message()`): "Problem" in red or "All clear" in green, the problem
  lines as a list, a link to /how-its-built.
- Both still send the old plain text unchanged as the `text` fallback.
- Tests: both emails give text and HTML, data is escaped, the alert's HTML has the condition,
  the value and the link (66 tests pass).

## Why
- Both emails were plain text; Carson approved a designed version on 2026-11-28.

## Decisions
- Dark mode in two layers. Apps that read `prefers-color-scheme` (Apple Mail) get the site's
  look: black card, mint button, mint links. The Gmail and Outlook apps ignore that and recolour
  the email themselves, which turned the first version's mint button and green text muddy in
  Carson's inbox. So the base is a white card with a black button, and mint is only an edge with
  no words on it, drawn as a one-colour gradient those apps reportedly leave alone.
- Considered and dropped: a mint button as a hosted image (exact colour everywhere, but a plain
  link when images are blocked, and the site must deploy first) and blend-mode tricks for Gmail
  (only hold white text, and could not be tested here).
- Small print cut from the HTML after Carson's review; the way to stop the emails and the short
  disclaimer stay. The plain text keeps the full wording.
- Logo is `https://mantamarkets.com/apple-icon.png` (site/public has no PNG) with "Manta" as text.
- Named `mail.py`: an `email.py` in the package folder would hide Python's own `email` module
  when a script there is run directly.
- Newsreader is not used: Gmail and Outlook refuse web fonts.

## Follow-ups
- Not deployed: the emails change when `infra/deploy/deploy-snap.sh` next runs (Carson's OK).
- Checked in Chrome (light, dark, forced darkening) and in Carson's inbox only; the Outlook
  desktop app and the Gmail app on the other phone platform were not seen.
- The plain-text ops email still prints the raw ISO report time.
