from manta_pricing.mail import layout, link


def test_layout_escapes_the_title_and_button_and_keeps_the_body():
    html = layout("A <b> & C", "<p>body</p>", ("Open <it>", 'https://x.test/?a=1&b="2"'), "foot")
    assert html.count("A &lt;b&gt; &amp; C") == 2  # <title> and <h1>
    assert "<p>body</p>" in html and "foot" in html
    assert "Open &lt;it&gt;" in html and 'href="https://x.test/?a=1&amp;b=&quot;2&quot;"' in html
    # Email-safe: nothing an email app would strip or block.
    for banned in ("<script", "<link", "@import", "url(", "$"):
        assert banned not in html
    assert html.count("<style") == 1 and "prefers-color-scheme: dark" in html


def test_layout_without_a_button_and_link_escaping():
    assert '<table role="presentation" cellpadding' not in layout("T", "")
    assert link("https://x.test/?a=1&b=2", "a < b") == (
        '<a class="link" href="https://x.test/?a=1&amp;b=2" style="color:#007a45;">a &lt; b</a>'
    )
