"""The shared look of Manta's emails (alerts.py, quality.py): one HTML layout, sent next to the
plain text, which stays as the fallback for apps that don't show HTML.

Email apps strip scripts and outside stylesheets, so every style is inline, in simple tables at
most 560 px wide, with fonts every device has (Georgia stands in for the site's Newsreader: Gmail
and Outlook refuse web fonts).

Dark mode is the hard part, because apps handle it in two ways:
- Apple Mail and others that read `prefers-color-scheme` get the DARK rules below: the site's
  own look (black, mint button, mint links).
- The Gmail and Outlook apps ignore those rules and recolour the email themselves: light fills
  go dark and dark text goes light, each colour on its own. Black, white and coloured text on
  the card survive that; a mint fill with words on it does not (it turned a muddy green in
  Carson's inbox, 2026-11-28). So the base design is a white card with black text and a black
  button, and mint appears only as an edge with no text on it, drawn as a one-colour gradient:
  those apps leave background images alone (EDGE).
Mint #00ff77 is 1.4:1 against white, far under the 4.5:1 that text needs, so on white, links and
"All clear" use GREEN (5.4:1).

Everything that comes from data (market titles, labels, problem lines) must go through esc()
before it is put into `body` or `footer`; layout() escapes the title and the button itself.

Named mail.py, not email.py: run as a script from this folder, email.py would hide Python's own
`email` module, which urllib needs.
"""

from html import escape as esc
from string import Template

SITE = "https://mantamarkets.com"
# site/app/apple-icon.png as Next serves it: the white mark on a black square, which stays
# readable whatever an email app's dark mode does to the colours around it.
LOGO = f"{SITE}/apple-icon.png"
SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
SERIF = "Georgia,'Times New Roman',serif"
INK = "#0b0b0c"
GREEN = "#007a45"  # mint dark enough to read on white (5.4:1): links, "All clear"
RED = "#b3261e"  # 6.5:1 on white: "Problem"
MINT = "#00ff77"
TONES = {"ink": INK, "ok": GREEN, "bad": RED}  # the title's colour; also its class in DARK

# A 4 px mint edge, the site's mark for "this one" (the charted contract, the open panel).
EDGE = (
    f'<td width="4" bgcolor="{MINT}" style="background:{MINT};'
    f'background-image:linear-gradient({MINT},{MINT});font-size:0;line-height:0;">&nbsp;</td>'
)

# Only apps that support dark mode properly read this; the site's tokens (site/app/globals.css).
DARK = """\
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  .ground { background: #000000 !important; }
  .card { background: #0b0b0c !important; border-color: #2a2a2a !important; }
  .card, .ink { color: #f2f2f2 !important; }
  .link, .ok { color: #00ff77 !important; }
  .bad { color: #ff5468 !important; }
  .btn { background: #00ff77 !important; }
  .btn a { color: #03150b !important; }
}
"""

# The [if mso] table gives desktop Outlook the 560 px width: it ignores max-width.
PAGE = Template("""\
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>$title</title>
<style>
$dark</style>
</head>
<body class="ground" style="margin:0;padding:0;background:#f2f2f0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
 class="ground" bgcolor="#f2f2f0">
<tr><td align="center" style="padding:32px 12px;">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0"
 border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
 style="max-width:560px;">
<tr><td style="padding:0 2px 14px;">
<a href="$site" style="text-decoration:none;color:$ink;">
<img src="$logo" width="28" height="28" alt=""
 style="border:0;border-radius:3px;vertical-align:middle;">
<span class="ink" style="font-family:$serif;font-size:24px;letter-spacing:-0.03em;color:$ink;
vertical-align:middle;">&nbsp;Manta</span></a>
</td></tr>
<tr><td class="card" bgcolor="#ffffff" style="background:#ffffff;border:1px solid #e0e0dc;
border-radius:3px;padding:32px 28px;font-family:$sans;font-size:15px;line-height:1.5;
color:$ink;">
<h1 class="$tone" style="margin:0 0 10px;font-family:$serif;font-weight:400;font-size:26px;
line-height:1.2;letter-spacing:-0.02em;color:$color;">$title</h1>
$body
$button
</td></tr>
<tr><td class="ink" style="padding:16px 2px 0;font-family:$sans;font-size:14px;line-height:1.5;
color:$ink;">
$footer
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
""")

BUTTON = Template("""\
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
<tr>$edge<td class="btn" bgcolor="$ink" style="background:$ink;">
<a href="$url" style="display:inline-block;padding:12px 22px;font-family:$sans;
font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">$label</a>
</td></tr>
</table>""")


def link(url: str, text: str) -> str:
    """A link in the readable green; both parts are escaped here."""
    return f'<a class="link" href="{esc(url)}" style="color:{GREEN};">{esc(text)}</a>'


def edged(inner: str) -> str:
    """`inner` (HTML, already escaped) set large beside the mint edge."""
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0"'
        f' style="margin-top:22px;"><tr>{EDGE}'
        f'<td class="ink" style="padding:2px 0 2px 14px;font-family:{SANS};font-size:22px;'
        f'line-height:1.3;color:{INK};">{inner}</td></tr></table>'
    )


def layout(
    title: str,
    body: str,
    button: tuple[str, str] | None = None,
    footer: str = "",
    tone: str = "ink",
) -> str:
    """The whole HTML email. `title` is plain text; `body` and `footer` are HTML the caller has
    already escaped; `button` is (label, url); `tone` colours the title: ink, ok or bad."""
    b = ""
    if button:
        b = BUTTON.substitute(
            label=esc(button[0]), url=esc(button[1]), edge=EDGE, ink=INK, sans=SANS
        )
    return PAGE.substitute(
        title=esc(title), body=body, button=b, footer=footer, tone=tone, color=TONES[tone],
        dark=DARK, site=SITE, logo=LOGO, sans=SANS, serif=SERIF, ink=INK,
    )  # fmt: skip
