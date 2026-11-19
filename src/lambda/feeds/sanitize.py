"""HTML sanitization, plain-text extraction, and Slack mrkdwn / Markdown rendering.

Every item body stored or returned by the feeds module passes through ``sanitizeHtml``
before persistence or rendering. Images and active media/script tags are stripped in v1
(per design decision), and every link is forced to ``target="_blank" rel="noopener noreferrer"``
with only ``http``, ``https``, and ``mailto`` URL schemes permitted.
"""

from html import escape
from html.parser import HTMLParser
import re

import nh3

MAX_HTML_CHARS = 100_000
MAX_HTML_BYTES = 200_000
MAX_SUMMARY_CHARS = 500

_ALLOWED_TAGS = {
    "p",
    "br",
    "a",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "del",
    "code",
    "pre",
    "blockquote",
    "ul",
    "ol",
    "li",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "span",
    "div",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
}

_CLEAN_CONTENT_TAGS = {
    "script",
    "style",
    "svg",
    "math",
    "noscript",
    "template",
}

_ALLOWED_ATTRIBUTES = {
    "a": {"href", "title"},
}

_SET_TAG_ATTRS = {
    "a": {"target": "_blank"},
}

_ALLOWED_URL_SCHEMES = {"http", "https", "mailto"}

_BLOCK_TAGS = {
    "p",
    "br",
    "div",
    "li",
    "tr",
    "th",
    "td",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "pre",
    "hr",
}


def _nh3Clean(rawHtml: str) -> str:
    return nh3.clean(
        rawHtml,
        tags=_ALLOWED_TAGS,
        clean_content_tags=_CLEAN_CONTENT_TAGS,
        attributes=_ALLOWED_ATTRIBUTES,
        set_tag_attribute_values=_SET_TAG_ATTRS,
        url_schemes=_ALLOWED_URL_SCHEMES,
        link_rel="noopener noreferrer",
        strip_comments=True,
    )


def sanitizeHtml(
    rawHtml: str | None,
    maxChars: int = MAX_HTML_CHARS,
    maxBytes: int = MAX_HTML_BYTES,
) -> str:
    """Sanitize untrusted HTML with nh3, strip images/scripts, and cap char + UTF-8 byte length."""
    if not rawHtml:
        return ""
    cleaned = _nh3Clean(str(rawHtml)).strip()
    if len(cleaned) <= maxChars and len(cleaned.encode("utf-8")) <= maxBytes:
        return cleaned

    # Leave room for tag-balancing and truncation marker, then re-clean so open
    # elements are closed properly and final output stays <= maxChars and <= maxBytes.
    budget = max(0, min(len(cleaned), maxChars) - 32)
    while True:
        snippet = cleaned[:budget]
        if len(snippet.encode("utf-8")) > max(0, maxBytes - 32):
            snippet = snippet.encode("utf-8")[: max(0, maxBytes - 32)].decode("utf-8", errors="ignore")
        snippet = re.sub(r"<[^>]*$", "", snippet)
        snippet = re.sub(r"&[A-Za-z0-9#]{0,12}$", "", snippet)
        balanced = _nh3Clean(f"{snippet}<p>…</p>").strip()
        balancedBytes = len(balanced.encode("utf-8"))
        if len(balanced) <= maxChars and balancedBytes <= maxBytes:
            return balanced
        if budget == 0:
            return ""
        charOver = max(0, len(balanced) - maxChars)
        byteOver = max(0, balancedBytes - maxBytes)
        step = max(32, charOver + 16, byteOver + 16)
        budget = max(0, min(budget, len(snippet)) - step)


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []
        self._skipDepth = 0

    def handle_starttag(self, tag, attrs):
        t = tag.lower()
        if t in _CLEAN_CONTENT_TAGS:
            self._skipDepth += 1
        elif self._skipDepth == 0 and t in _BLOCK_TAGS:
            self._parts.append(" ")

    def handle_endtag(self, tag):
        t = tag.lower()
        if t in _CLEAN_CONTENT_TAGS and self._skipDepth > 0:
            self._skipDepth -= 1
        elif self._skipDepth == 0 and t in _BLOCK_TAGS:
            self._parts.append(" ")

    def handle_data(self, data):
        if self._skipDepth == 0 and data:
            self._parts.append(data)


def cleanPlainText(text: str | None, maxChars: int = MAX_SUMMARY_CHARS) -> str:
    """Collapse whitespace and truncate plain text without stripping literal angle brackets."""
    if not text:
        return ""
    collapsed = " ".join(str(text).split())
    if len(collapsed) <= maxChars:
        return collapsed
    if maxChars <= 1:
        return "…"[:maxChars]
    return collapsed[: maxChars - 1].rstrip() + "…"


def htmlToPlainText(htmlStr: str | None, maxChars: int = MAX_SUMMARY_CHARS) -> str:
    """Extract collapsed plain text from HTML, truncated to ``maxChars``."""
    if not htmlStr:
        return ""
    parser = _TextExtractor()
    parser.feed(str(htmlStr))
    parser.close()
    return cleanPlainText("".join(parser._parts), maxChars=maxChars)


_SLACK_LINK_RE = re.compile(
    r"&lt;((?:https?://|mailto:)(?:(?!&gt;)[^|\s\x00]){1,2048})(?:\|((?:(?!&lt;|&gt;)[^<>\n\x00]){1,500}))?&gt;"
)
_MD_LINK_RE = re.compile(r"\[([^\[\]\n]{1,500})\]\(((?:https?://|mailto:)[^)\s\x00]{1,2048})\)")
_BARE_URL_RE = re.compile(r"(?<!['\"=])(https?://[^\s<>'\"\]|\x00]+)")
_FENCE_RE = re.compile(r"```(?:[A-Za-z0-9_+-]+\n)?(.*?)```", re.DOTALL)
_INLINE_CODE_RE = re.compile(r"`([^`\n]+)`")
_MD_BOLD_RE = re.compile(r"\*\*([^\n*](?:[^\n]*?[^\n*])?)\*\*")
_SLACK_BOLD_RE = re.compile(r"(?<![A-Za-z0-9_])\*([^\s*\n](?:[^*\n]*?[^\s*\n])?)\*(?![A-Za-z0-9_])")
_MD_STAR_ITALIC_RE = re.compile(r"(?<![A-Za-z0-9_*])\*([^\s*\n](?:[^*\n]*?[^\s*\n])?)\*(?![A-Za-z0-9_*])")
_ITALIC_RE = re.compile(r"(?<![A-Za-z0-9_/])_([^\s_\n](?:[^_\n]*?[^\s_\n])?)_(?![A-Za-z0-9_/])")
_STRIKE_RE = re.compile(r"~~([^\s~\n](?:[^~\n]*?[^\s~\n])?)~~|(?<![A-Za-z0-9_])~([^\s~\n](?:[^~\n]*?[^\s~\n])?)~(?![A-Za-z0-9_])")
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$")
_UL_RE = re.compile(r"^\s*(?:•|-|\*)\s+(.+)$")
_OL_RE = re.compile(r"^\s*\d+\.\s+(.+)$")
_BQ_RE = re.compile(r"^\s*(?:&amp;gt;|&gt;|>)\s?(.*)$")


def _unescapeBasicHtml(s: str) -> str:
    """Exact single-layer inverse of html.escape(..., quote=False) and Slack's &/< /> encoding."""
    return s.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")


def _safeLinkHtml(rawEscapedHref: str, rawEscapedLabel: str | None = None, *, slackUnescape: bool = False) -> str:
    # Unescape HTML layer added before formatting; Slack mrkdwn only encodes &amp; / &lt; / &gt;
    # so we intentionally avoid full html.unescape() that would corrupt &copy= / &reg= query params.
    href = _unescapeBasicHtml(rawEscapedHref).strip()
    if slackUnescape:
        href = _unescapeBasicHtml(href).strip()
    if "\x00" in href or not href.lower().startswith(("http://", "https://", "mailto:")):
        return rawEscapedLabel if rawEscapedLabel is not None else rawEscapedHref
    if rawEscapedLabel is not None and rawEscapedLabel.strip():
        plainLabel = _unescapeBasicHtml(rawEscapedLabel)
        if slackUnescape:
            plainLabel = _unescapeBasicHtml(plainLabel)
        safeLabel = escape(plainLabel, quote=False)
    else:
        safeLabel = escape(href, quote=False)
    return f'<a href="{escape(href, quote=True)}">{safeLabel}</a>'


def _formatInline(escapedLine: str, *, fmt: str = "auto") -> str:
    tokens: list[str] = []

    def stash(htmlVal: str) -> str:
        idx = len(tokens)
        tokens.append(htmlVal)
        return f"\x00T{idx}\x00"

    # Protect inline code first so formatting/links inside backticks aren't rewritten.
    s = _INLINE_CODE_RE.sub(lambda m: stash(f"<code>{m.group(1)}</code>"), escapedLine)

    # Slack <url|label> and <url> links (on HTML-escaped text, < and > are &lt; and &gt;).
    if fmt != "markdown":
        s = _SLACK_LINK_RE.sub(lambda m: stash(_safeLinkHtml(m.group(1), m.group(2), slackUnescape=True)), s)

    # Standard Markdown [label](url) links.
    s = _MD_LINK_RE.sub(lambda m: stash(_safeLinkHtml(m.group(2), m.group(1))), s)

    # Bare URLs; trim trailing sentence punctuation that isn't part of balanced parens.
    def _bareRepl(m: re.Match) -> str:
        url = m.group(1)
        trailing = ""
        while url and url[-1] in ".,;:!?":
            trailing = url[-1] + trailing
            url = url[:-1]
        while url.endswith(")") and url.count(")") > url.count("("):
            trailing = ")" + trailing
            url = url[:-1]
        return stash(_safeLinkHtml(url)) + trailing

    s = _BARE_URL_RE.sub(_bareRepl, s)

    # Inline emphasis: Markdown **bold** + *italic*, or Slack *bold*, _italic_, ~strike~ / ~~strike~~.
    s = _MD_BOLD_RE.sub(r"<strong>\1</strong>", s)
    if fmt == "markdown":
        s = _MD_STAR_ITALIC_RE.sub(r"<em>\1</em>", s)
    else:
        s = _SLACK_BOLD_RE.sub(r"<strong>\1</strong>", s)
    s = _ITALIC_RE.sub(r"<em>\1</em>", s)
    s = _STRIKE_RE.sub(lambda m: f"<del>{m.group(1) or m.group(2)}</del>", s)

    # Restore tokens (inline code / anchor tags).
    for idx in range(len(tokens) - 1, -1, -1):
        s = s.replace(f"\x00T{idx}\x00", tokens[idx])
    return s


def renderMarkupToHtml(text: str | None, fmt: str = "auto", maxChars: int = MAX_HTML_CHARS) -> str:
    """Convert Slack mrkdwn and/or Markdown into sanitized safe HTML."""
    if not text:
        return ""
    if fmt == "html":
        return sanitizeHtml(text, maxChars=maxChars)

    cleanedText = str(text).replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")
    escaped = escape(cleanedText, quote=False)

    # Stash fenced code blocks before line-by-line block parsing.
    blockTokens: list[str] = []

    def _stashBlock(m: re.Match) -> str:
        idx = len(blockTokens)
        code = m.group(1).strip("\n")
        blockTokens.append(f"<pre><code>{code}</code></pre>")
        return f"\n\x00B{idx}\x00\n"

    escaped = _FENCE_RE.sub(_stashBlock, escaped)

    out: list[str] = []
    lines = escaped.split("\n")
    i = 0

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        if stripped.startswith("\x00B") and stripped.endswith("\x00"):
            idxStr = stripped[2:-1]
            if idxStr.isdigit() and int(idxStr) < len(blockTokens):
                out.append(blockTokens[int(idxStr)])
                i += 1
                continue

        if re.match(r"^(?:-{3,}|\*{3,}|_{3,})$", stripped):
            out.append("<hr>")
            i += 1
            continue

        hm = _HEADING_RE.match(stripped)
        if hm:
            lvl = len(hm.group(1))
            out.append(f"<h{lvl}>{_formatInline(hm.group(2), fmt=fmt)}</h{lvl}>")
            i += 1
            continue

        if _BQ_RE.match(line):
            bqLines: list[str] = []
            while i < len(lines):
                bm = _BQ_RE.match(lines[i])
                if not bm:
                    break
                bqLines.append(_formatInline(bm.group(1), fmt=fmt))
                i += 1
            out.append(f"<blockquote><p>{'<br>'.join(bqLines)}</p></blockquote>")
            continue

        if _UL_RE.match(line):
            items: list[str] = []
            while i < len(lines):
                um = _UL_RE.match(lines[i])
                if not um:
                    break
                items.append(f"<li>{_formatInline(um.group(1), fmt=fmt)}</li>")
                i += 1
            out.append(f"<ul>{''.join(items)}</ul>")
            continue

        if _OL_RE.match(line):
            items = []
            while i < len(lines):
                om = _OL_RE.match(lines[i])
                if not om:
                    break
                items.append(f"<li>{_formatInline(om.group(1), fmt=fmt)}</li>")
                i += 1
            out.append(f"<ol>{''.join(items)}</ol>")
            continue

        paraLines: list[str] = []
        while i < len(lines):
            cur = lines[i]
            curStripped = cur.strip()
            if (
                not curStripped
                or curStripped.startswith("\x00B")
                or _HEADING_RE.match(curStripped)
                or _BQ_RE.match(cur)
                or _UL_RE.match(cur)
                or _OL_RE.match(cur)
                or re.match(r"^(?:-{3,}|\*{3,}|_{3,})$", curStripped)
            ):
                break
            paraLines.append(_formatInline(cur, fmt=fmt))
            i += 1
        if paraLines:
            out.append(f"<p>{'<br>'.join(paraLines)}</p>")

    return sanitizeHtml("".join(out), maxChars=maxChars)
