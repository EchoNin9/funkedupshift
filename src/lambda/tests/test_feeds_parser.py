"""Unit tests for feeds.parser and feeds.sanitize (RSS/Atom/JSON, XSS, Slack mrkdwn, TZ bucketing)."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from feeds.parser import (  # noqa: E402
    FeedParseError,
    computeDay,
    computeItemHash,
    isValidTimezone,
    parseFeed,
    preparePolledItems,
)
from feeds.sanitize import MAX_HTML_BYTES, MAX_HTML_CHARS, htmlToPlainText, renderMarkupToHtml, sanitizeHtml  # noqa: E402


RSS_SAMPLE = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Example Engineering Blog</title>
    <link>https://blog.example.com/</link>
    <item>
      <guid isPermaLink="false">post-42</guid>
      <title>Post &amp; Beyond</title>
      <link>https://blog.example.com/posts/42</link>
      <author>Alice</author>
      <pubDate>Thu, 19 Nov 2026 07:30:00 GMT</pubDate>
      <description>&lt;p&gt;Intro &lt;img src="https://evil.example/a.png" onerror="alert(1)"/&gt; &lt;a href="https://blog.example.com/x" onclick="steal()"&gt;read&lt;/a&gt;&lt;/p&gt;&lt;script&gt;alert(2)&lt;/script&gt;</description>
    </item>
    <item>
      <title>No Guid Entry</title>
      <description>Plain summary only</description>
    </item>
  </channel>
</rss>
"""

ATOM_SAMPLE = b"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Stream</title>
  <link href="https://atom.example.com/" rel="alternate"/>
  <entry>
    <id>urn:uuid:1234</id>
    <title>Atom Item</title>
    <link href="/entries/1"/>
    <author><name>Bob</name></author>
    <updated>2026-11-19T08:15:00Z</updated>
    <content type="html">&lt;p&gt;Body &lt;img src="/pic.jpg"&gt; &lt;a href="javascript:alert(1)"&gt;bad&lt;/a&gt; &lt;a href="https://good.example"&gt;ok&lt;/a&gt;&lt;/p&gt;</content>
  </entry>
</feed>
"""

JSON_FEED_SAMPLE = b"""{
  "version": "https://jsonfeed.org/version/1.1",
  "title": "JSON Daily",
  "home_page_url": "https://json.example.com",
  "items": [
    {
      "id": "jf-1",
      "url": "https://json.example.com/1",
      "title": "First JSON Post",
      "content_html": "<p>Hello <img src='https://x.test/i.png'/> <a href='https://json.example.com/ref'>ref</a></p><svg onload='alert(1)'>badsvg</svg>",
      "authors": [{"name": "Carol"}],
      "date_published": "2026-11-19T06:00:00-08:00"
    },
    {
      "id": "jf-2",
      "external_url": "https://other.example.com/ext",
      "content_text": "Line one\\n\\nLine two",
      "date_modified": "2026-11-18T12:00:00Z"
    }
  ]
}"""


def test_parse_rss_strips_images_and_scripts():
    feed = parseFeed(RSS_SAMPLE, contentType="application/rss+xml", url="https://blog.example.com/rss.xml")
    assert feed.kind == "rss"
    assert feed.title == "Example Engineering Blog"
    assert feed.siteUrl == "https://blog.example.com/"
    assert len(feed.items) == 2

    first = feed.items[0]
    assert first.guid == "post-42"
    assert first.title == "Post & Beyond"
    assert first.link == "https://blog.example.com/posts/42"
    assert first.author == "Alice"
    assert first.publishedAt == "2026-11-19T07:30:00Z"
    assert "<img" not in first.contentHtml
    assert "<script" not in first.contentHtml
    assert "onclick" not in first.contentHtml
    assert 'target="_blank"' in first.contentHtml
    assert 'rel="noopener noreferrer"' in first.contentHtml
    assert "Intro" in first.summary

    second = feed.items[1]
    assert second.guid == ""
    assert second.link is None
    assert second.publishedAt is None


def test_parse_atom_resolves_relative_link_and_drops_javascript_href():
    feed = parseFeed(ATOM_SAMPLE, contentType="application/atom+xml", url="https://atom.example.com/feed.atom")
    assert feed.kind == "atom"
    assert feed.title == "Atom Stream"
    assert len(feed.items) == 1
    it = feed.items[0]
    assert it.guid == "urn:uuid:1234"
    assert it.link == "https://atom.example.com/entries/1"
    assert it.author == "Bob"
    assert it.publishedAt == "2026-11-19T08:15:00Z"
    assert "<img" not in it.contentHtml
    assert "javascript:" not in it.contentHtml
    assert 'href="https://good.example"' in it.contentHtml
    assert 'target="_blank"' in it.contentHtml


def test_parse_json_feed():
    feed = parseFeed(JSON_FEED_SAMPLE, contentType="application/feed+json", url="https://json.example.com/feed.json")
    assert feed.kind == "json"
    assert feed.title == "JSON Daily"
    assert feed.siteUrl == "https://json.example.com"
    assert len(feed.items) == 2

    first = feed.items[0]
    assert first.guid == "jf-1"
    assert first.author == "Carol"
    assert first.publishedAt == "2026-11-19T14:00:00Z"
    assert "<img" not in first.contentHtml
    assert "<svg" not in first.contentHtml
    assert "badsvg" not in first.contentHtml

    second = feed.items[1]
    assert second.title == "Line one Line two"
    assert second.link == "https://other.example.com/ext"
    assert "<p>Line one</p><p>Line two</p>" == second.contentHtml


@pytest.mark.parametrize(
    "payload,ctype",
    [
        (b"", "application/xml"),
        (b"   ", "text/xml"),
        (b"<html><head><link rel='alternate' type='application/rss+xml' href='/rss.xml'></head><body>hi</body></html>", "text/html"),
        (b"<<<not valid xml>>>", "application/xml"),
        (b'{"hello": "world"}', "application/json"),
        (b"not json", "application/feed+json"),
    ],
)
def test_parse_feed_rejects_non_feeds(payload, ctype):
    with pytest.raises(FeedParseError):
        parseFeed(payload, contentType=ctype, url="https://example.com")


def test_sanitize_truncates_over_max_chars_and_preserves_valid_html():
    huge = "<p>" + ("word " * 30_000) + "</p>"
    cleaned = sanitizeHtml(huge, maxChars=1_000)
    assert len(cleaned) <= 1_000
    assert cleaned.endswith("</p>")
    assert MAX_HTML_CHARS == 100_000


def test_render_slack_mrkdwn_and_markdown():
    mrkdwn = (
        "*Todoist Morning*\n"
        "• <https://todoist.com/showTask?id=1&amp;view=list|Pay rent> — *urgent* _today_\n"
        "• <javascript:alert(1)|Evil> [MdEvil](javascript:alert(2)) and ~done~\n"
        "Check https://example.com/foo_bar_baz.\n"
        "&gt; Quoted note\n"
    )
    html = renderMarkupToHtml(mrkdwn)
    assert "<strong>Todoist Morning</strong>" in html
    assert "<ul><li>" in html
    assert 'href="https://todoist.com/showTask?id=1&amp;view=list"' in html
    assert 'target="_blank"' in html
    assert 'rel="noopener noreferrer"' in html
    assert "<strong>urgent</strong>" in html
    assert "<em>today</em>" in html
    assert "<del>done</del>" in html
    assert 'href="javascript:' not in html
    assert 'href="https://example.com/foo_bar_baz"' in html
    assert "<em>bar</em>" not in html
    assert "<blockquote>" in html


def test_render_markdown_features():
    md = "## Daily Notes\n\n1. [Open report](https://example.com/r) **ready**\n2. `cmd --flag`\n\n```py\nprint('<script>')\n```"
    html = renderMarkupToHtml(md, fmt="markdown")
    assert "<h2>Daily Notes</h2>" in html
    assert "<ol><li>" in html
    assert 'href="https://example.com/r"' in html
    assert "<strong>ready</strong>" in html
    assert "<code>cmd --flag</code>" in html
    assert "<pre><code>print('&lt;script&gt;')</code></pre>" in html
    assert "<script>" not in html


def test_html_to_plain_text_truncates():
    assert htmlToPlainText("<p>Hello <b>world</b></p><script>bad</script>") == "Hello world"
    assert htmlToPlainText("<p>" + "x" * 100 + "</p>", maxChars=20) == ("x" * 19 + "…")


def test_compute_day_midnight_la_pst_and_pdt():
    # 07:30 UTC on 2026-11-19 is 23:30 PST on 2026-11-18 in America/Los_Angeles (UTC-8)
    dayPst, normPst = computeDay("2026-11-19T07:30:00Z", None, "2026-11-19T12:00:00Z", "America/Los_Angeles")
    assert dayPst == "2026-11-18"
    assert normPst == "2026-11-19T07:30:00Z"

    # 08:30 UTC on 2026-11-19 is 00:30 PST on 2026-11-19
    dayPst2, _ = computeDay("2026-11-19T08:30:00Z", None, "2026-11-19T12:00:00Z", "America/Los_Angeles")
    assert dayPst2 == "2026-11-19"

    # 06:30 UTC on 2026-07-19 is 23:30 PDT on 2026-07-18 (UTC-7)
    dayPdt, _ = computeDay("2026-07-19T06:30:00Z", None, "2026-07-19T12:00:00Z", "America/Los_Angeles")
    assert dayPdt == "2026-07-18"

    # Fallback date
    dayFb, pubFb = computeDay(None, "2026-11-19", "2026-11-20T00:00:00Z", "America/Los_Angeles")
    assert dayFb == "2026-11-19"
    assert pubFb == "2026-11-19T20:00:00Z"

    assert isValidTimezone("America/Los_Angeles") is True
    assert isValidTimezone("Not/A_Zone") is False


def test_prepare_polled_items_hashes_items_without_guid_or_date_deterministically():
    feed = parseFeed(RSS_SAMPLE, url="https://blog.example.com/rss.xml")
    batch1 = preparePolledItems(feed, fetchedAt="2026-11-19T10:00:00Z", tzName="America/Los_Angeles")
    batch2 = preparePolledItems(feed, fetchedAt="2026-11-19T11:00:00Z", tzName="America/Los_Angeles")
    assert batch1[1]["itemHash"] == batch2[1]["itemHash"]
    assert computeItemHash("g1", "https://a", "T", None) != computeItemHash("g2", "https://a", "T", None)


def test_slack_link_label_cannot_inject_html_and_preserves_encoded_angles():
    evil = "<https://mail.google.com/1|Click <a href=\"https://evil.com\" title=\"phish\">here</a>>"
    htmlEvil = renderMarkupToHtml(evil)
    assert '<a href="https://evil.com"' not in htmlEvil
    assert "&lt;a href=" in htmlEvil
    assert htmlEvil.count("<a ") == 1
    assert "https://mail.google.com/1|Click" not in htmlEvil

    # Even if Slack pre-escaped the inner <a ...> inside a valid Slack link label, it must remain escaped text.
    slackLabelHtml = "<https://mail.google.com/1|Click &lt;a href=&quot;https://evil.com&quot; title=&quot;phish&quot;&gt;here&lt;/a&gt;>"
    htmlEvil2 = renderMarkupToHtml(slackLabelHtml)
    assert htmlEvil2.count("<a ") == 1
    assert 'href="https://mail.google.com/1"' in htmlEvil2
    assert '<a href="https://evil.com"' not in htmlEvil2
    assert "&lt;a href=" in htmlEvil2

    # Real Slack-encoded angle brackets inside link label are preserved as escaped text inside the link
    slackEscaped = "<https://example.com|Email from &lt;alice@example.com&gt;>"
    htmlSafe = renderMarkupToHtml(slackEscaped)
    assert htmlSafe.count("<a ") == 1
    assert 'href="https://example.com"' in htmlSafe
    assert "Email from &lt;alice@example.com&gt;" in htmlSafe


def test_markdown_format_distinguishes_italic_and_bold():
    html = renderMarkupToHtml("*italic* and **bold**", fmt="markdown")
    assert "<em>italic</em>" in html
    assert "<strong>bold</strong>" in html
    assert "<strong>italic</strong>" not in html


def test_sanitize_enforces_utf8_byte_cap():
    # 4-byte emoji repeats: 1000 chars == 4000 UTF-8 bytes
    emojis = "<p>" + ("🚀" * 1000) + "</p>"
    cleaned = sanitizeHtml(emojis, maxChars=10_000, maxBytes=500)
    assert len(cleaned.encode("utf-8")) <= 500
    assert cleaned.endswith("</p>")
    assert MAX_HTML_BYTES == 200_000


def test_date_only_published_at_year_0001_and_plain_text_angle_brackets():
    # Date-only string stays on that calendar day in LA (not shifted to previous day)
    day, _ = computeDay("2026-11-19", None, "2026-11-20T00:00:00Z", "America/Los_Angeles")
    assert day == "2026-11-19"

    # Year 0001 must not raise OverflowError when converting timezone
    day0001, _ = computeDay("0001-01-01T00:00:00Z", None, "2026-11-19T12:00:00Z", "America/Los_Angeles")
    assert day0001 == "2026-11-19"

    # JSON Feed plain-text title with literal <int> and <script> is preserved intact
    jf = b'{"version":"https://jsonfeed.org/version/1.1","title":"C++ <vector> Feed","items":[{"id":"1","title":"Using std::vector<int> and <script> safely","content_text":"Body"}]}'
    parsed = parseFeed(jf, contentType="application/feed+json", url="https://cpp.example/feed.json")
    assert parsed.title == "C++ <vector> Feed"
    assert parsed.items[0].title == "Using std::vector<int> and <script> safely"


def test_pass2_parser_and_sanitize_edge_cases():
    import time
    from feeds.parser import isValidCalendarDate

    # 1. renderMarkupToHtml stays O(N) on large documents with many inline links
    manyLinks = "\n".join(f"- [Item {i}](https://example.com/{i}) `code_{i}`" for i in range(400))
    assert len(manyLinks) > 15_000
    t0 = time.monotonic()
    bigHtml = renderMarkupToHtml(manyLinks, fmt="markdown")
    assert time.monotonic() - t0 < 0.5
    assert bigHtml.count("<a ") == 400

    # 2. Backtick inside markdown URL does not allow \x00 placeholder expansion / attribute injection
    evilMd = '[legit](https://good.com/`"title="spoofed`)'
    mdHtml = renderMarkupToHtml(evilMd, fmt="markdown")
    assert 'title="spoofed"' not in mdHtml

    # 3. Slack entity unescaping preserves HTML named entities like &copy;, &reg;, &not= in query params
    for slackLink in (
        "<https://example.com/?a=1&amp;copy=2&amp;reg=us&amp;not=3|Copy>",
        "<https://example.com/?a=1&copy=2&reg=us&not=3|Copy>",
    ):
        linkHtml = renderMarkupToHtml(slackLink)
        assert 'href="https://example.com/?a=1&amp;copy=2&amp;reg=us&amp;not=3"' in linkHtml
        assert "©" not in linkHtml and "®" not in linkHtml and "¬" not in linkHtml

    # 4. Calendar date year bounds (1970..2100)
    assert isValidCalendarDate("0001-01-01") is False
    assert isValidCalendarDate("2101-01-01") is False
    assert isValidCalendarDate("2026-11-19") is True

    # 5. UTF-8 BOM JSON Feed parses both with and without JSON content-type
    bomJson = b"\xef\xbb\xbf" + JSON_FEED_SAMPLE
    assert parseFeed(bomJson, contentType="", url="https://json.example.com/feed.json").kind == "json"
    assert parseFeed(bomJson, contentType="application/feed+json", url="https://json.example.com/feed.json").kind == "json"

    # 6. Truncated/malformed XML without title/entries raises FeedParseError
    with pytest.raises(FeedParseError):
        parseFeed(b"<rss><channel><title>Broken<<<", contentType="application/rss+xml", url="https://bad.example/rss")


