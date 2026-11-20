"""RSS, Atom, and JSON Feed 1.0/1.1 parser plus date bucketing and dedupe hashing."""

import calendar
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import hashlib
from html import escape
import json
import re
from urllib.parse import urljoin, urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import feedparser

from feeds.sanitize import cleanPlainText, htmlToPlainText, sanitizeHtml

DEFAULT_TZ = "America/Los_Angeles"
MAX_PARSED_ITEMS = 200
MAX_LINK_LEN = 2048
MAX_GUID_LEN = 512
_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


class FeedParseError(Exception):
    """Raised when fetched bytes cannot be parsed as RSS, Atom, or JSON Feed."""


@dataclass
class ParsedItem:
    guid: str
    title: str
    link: str | None
    summary: str
    contentHtml: str
    author: str | None
    publishedAt: str | None


@dataclass
class ParsedFeed:
    kind: str  # "rss" | "atom" | "json"
    title: str
    siteUrl: str | None
    items: list[ParsedItem]


def safeHttpUrl(rawUrl: str | None, baseUrl: str = "") -> str | None:
    """Resolve optional relative URLs and permit http/https links only (<= 2048 chars)."""
    if not rawUrl or not isinstance(rawUrl, str):
        return None
    val = rawUrl.strip()
    if not val or len(val) > MAX_LINK_LEN or any(ord(c) < 32 or ord(c) == 127 for c in val):
        return None
    if baseUrl and "://" not in val and not re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", val):
        val = urljoin(baseUrl, val)
    if len(val) > MAX_LINK_LEN:
        return None
    try:
        p = urlsplit(val)
    except ValueError:
        return None
    if p.scheme.lower() not in ("http", "https") or not p.hostname:
        return None
    return val


def _plainTextToHtml(text: str) -> str:
    cleaned = str(text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not cleaned:
        return ""
    blocks = [b.strip() for b in re.split(r"\n{2,}", cleaned) if b.strip()]
    paras = [f"<p>{escape(b, quote=False).replace(chr(10), '<br>')}</p>" for b in blocks]
    return sanitizeHtml("".join(paras))


def _isoFromDatetime(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def isValidCalendarDate(raw: str | None) -> bool:
    if not raw or not isinstance(raw, str):
        return False
    s = raw.strip()
    if not _DATE_RE.match(s):
        return False
    try:
        dt = datetime.strptime(s, "%Y-%m-%d")
        return 1970 <= dt.year <= 2100
    except ValueError:
        return False


def parseIsoTimestamp(raw: str | None) -> str | None:
    """Parse an ISO 8601 or RFC 2822 timestamp into normalized UTC ISO 8601."""
    if not raw or not isinstance(raw, str):
        return None
    s = raw.strip()
    if not s:
        return None
    dt = None
    try:
        iso = s[:-1] + "+00:00" if s.endswith(("Z", "z")) else s
        dt = datetime.fromisoformat(iso)
    except ValueError:
        try:
            dt = parsedate_to_datetime(s)
        except (TypeError, ValueError):
            return None
    if dt.year < 1970 or dt.year > 2100:
        return None
    try:
        return _isoFromDatetime(dt)
    except OverflowError:
        return None


def _entryPublishedAt(entry) -> str | None:
    tm = entry.get("published_parsed") or entry.get("updated_parsed")
    if tm is not None:
        try:
            ts = calendar.timegm(tm)
            return _isoFromDatetime(datetime.fromtimestamp(ts, tz=timezone.utc))
        except (TypeError, ValueError, OverflowError):
            pass
    return parseIsoTimestamp(entry.get("published") or entry.get("updated"))


def _jsonAuthor(item: dict) -> str | None:
    authors = item.get("authors")
    if isinstance(authors, list) and authors:
        first = authors[0]
        if isinstance(first, dict) and first.get("name"):
            return str(first["name"]).strip()[:120] or None
    author = item.get("author")
    if isinstance(author, dict) and author.get("name"):
        return str(author["name"]).strip()[:120] or None
    if isinstance(author, str) and author.strip():
        return author.strip()[:120]
    return None


def _parseJsonFeed(data: dict, baseUrl: str) -> ParsedFeed:
    version = str(data.get("version") or "")
    itemsRaw = data.get("items")
    hasVersion = version.startswith("https://jsonfeed.org/version/")
    if not hasVersion and not (isinstance(itemsRaw, list) and isinstance(data.get("title"), str)):
        raise FeedParseError("JSON payload is not a JSON Feed")
    if not isinstance(itemsRaw, list):
        itemsRaw = []

    feedTitle = cleanPlainText(str(data.get("title") or ""), 200) or (urlsplit(baseUrl).hostname or "Untitled Feed")
    siteUrl = safeHttpUrl(data.get("home_page_url"), baseUrl=baseUrl)

    items: list[ParsedItem] = []
    for raw in itemsRaw[:MAX_PARSED_ITEMS]:
        if not isinstance(raw, dict):
            continue
        guid = str(raw.get("id") or "").strip()[:MAX_GUID_LEN]
        link = safeHttpUrl(raw.get("url") or raw.get("external_url"), baseUrl=baseUrl)
        contentHtmlRaw = raw.get("content_html")
        contentTextRaw = raw.get("content_text")
        summaryRaw = raw.get("summary")

        if isinstance(contentHtmlRaw, str) and contentHtmlRaw.strip():
            contentHtml = sanitizeHtml(contentHtmlRaw)
        elif isinstance(contentTextRaw, str) and contentTextRaw.strip():
            contentHtml = _plainTextToHtml(contentTextRaw)
        elif isinstance(summaryRaw, str) and summaryRaw.strip():
            contentHtml = _plainTextToHtml(summaryRaw)
        else:
            contentHtml = ""

        summary = (
            cleanPlainText(summaryRaw)
            if isinstance(summaryRaw, str) and summaryRaw.strip()
            else htmlToPlainText(contentHtml)
        )
        title = cleanPlainText(str(raw.get("title") or ""), 300) or (summary[:120] if summary else "(untitled)")
        publishedAt = parseIsoTimestamp(raw.get("date_published") or raw.get("date_modified"))
        items.append(
            ParsedItem(
                guid=guid,
                title=title,
                link=link,
                summary=summary,
                contentHtml=contentHtml,
                author=_jsonAuthor(raw),
                publishedAt=publishedAt,
            )
        )

    return ParsedFeed(kind="json", title=feedTitle, siteUrl=siteUrl, items=items)


def _entryContentHtml(entry) -> str:
    contents = entry.get("content")
    if isinstance(contents, list) and contents:
        chosen = None
        for c in contents:
            ctype = str(c.get("type") or "").lower()
            if "html" in ctype:
                chosen = c
                break
        if chosen is None:
            chosen = contents[0]
        val = str(chosen.get("value") or "")
        if val.strip():
            if str(chosen.get("type") or "").lower() == "text/plain":
                return _plainTextToHtml(val)
            return sanitizeHtml(val)

    summary = entry.get("summary") or entry.get("description") or ""
    if isinstance(summary, str) and summary.strip():
        detailType = str((entry.get("summary_detail") or {}).get("type") or "").lower()
        if detailType == "text/plain":
            return _plainTextToHtml(summary)
        return sanitizeHtml(summary)
    return ""


def parseFeed(rawBytes: bytes, *, contentType: str = "", url: str = "") -> ParsedFeed:
    """Parse RSS, Atom, or JSON Feed bytes. Never performs network I/O."""
    if not rawBytes or not rawBytes.strip():
        raise FeedParseError("Empty response body")

    ctype = (contentType or "").lower()
    trimmed = rawBytes.lstrip()
    if trimmed.startswith(b"\xef\xbb\xbf"):
        trimmed = trimmed[3:].lstrip()
    if "json" in ctype or trimmed.startswith(b"{"):
        try:
            data = json.loads(trimmed.decode("utf-8-sig", errors="replace"))
        except ValueError as e:
            if "json" in ctype:
                raise FeedParseError(f"Invalid JSON feed: {e}") from e
        else:
            if isinstance(data, dict):
                return _parseJsonFeed(data, baseUrl=url)
            if "json" in ctype:
                raise FeedParseError("Invalid JSON feed root")

    # Always pass bytes directly to feedparser — never a URL.
    parsed = feedparser.parse(rawBytes)
    version = str(getattr(parsed, "version", "") or "")
    entries = getattr(parsed, "entries", None) or []
    feedMeta = getattr(parsed, "feed", {}) or {}
    if not version and not entries:
        raise FeedParseError("Not a valid RSS, Atom, or JSON feed")
    if getattr(parsed, "bozo", False) and not entries and not str(feedMeta.get("title") or "").strip():
        raise FeedParseError("Malformed or truncated XML feed")

    kind = "atom" if version.lower().startswith("atom") else "rss"
    feedTitleType = str((feedMeta.get("title_detail") or {}).get("type") or "").lower()
    rawFeedTitle = str(feedMeta.get("title") or "")
    feedTitle = (
        (cleanPlainText(rawFeedTitle, 200) if feedTitleType == "text/plain" else htmlToPlainText(rawFeedTitle, 200))
        or (urlsplit(url).hostname or "Untitled Feed")
    )
    siteUrl = safeHttpUrl(feedMeta.get("link"), baseUrl=url)

    items: list[ParsedItem] = []
    for entry in entries[:MAX_PARSED_ITEMS]:
        guid = str(entry.get("id") or entry.get("guid") or "").strip()[:MAX_GUID_LEN]
        link = safeHttpUrl(entry.get("link"), baseUrl=url)
        contentHtml = _entryContentHtml(entry)
        summary = htmlToPlainText(contentHtml or str(entry.get("summary") or ""))
        titleType = str((entry.get("title_detail") or {}).get("type") or "").lower()
        rawTitle = str(entry.get("title") or "")
        cleanedTitle = cleanPlainText(rawTitle, 300) if titleType == "text/plain" else htmlToPlainText(rawTitle, 300)
        title = cleanedTitle or (summary[:120] if summary else "(untitled)")

        rawAuthor = entry.get("author") or (entry.get("author_detail") or {}).get("name")
        author = cleanPlainText(str(rawAuthor), 120) if rawAuthor else None

        items.append(
            ParsedItem(
                guid=guid,
                title=title,
                link=link,
                summary=summary,
                contentHtml=contentHtml,
                author=author or None,
                publishedAt=_entryPublishedAt(entry),
            )
        )

    return ParsedFeed(kind=kind, title=feedTitle, siteUrl=siteUrl, items=items)


def resolveTimezone(tzName: str | None) -> ZoneInfo:
    """Return a validated ZoneInfo, falling back to America/Los_Angeles."""
    name = (tzName or "").strip() or DEFAULT_TZ
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, KeyError, ValueError):
        return ZoneInfo(DEFAULT_TZ)


def isValidTimezone(tzName: str | None) -> bool:
    if not tzName or not isinstance(tzName, str) or not tzName.strip():
        return False
    try:
        ZoneInfo(tzName.strip())
        return True
    except (ZoneInfoNotFoundError, KeyError, ValueError):
        return False


def computeDay(
    publishedAtIso: str | None,
    fallbackDate: str | None,
    fallbackNowIso: str,
    tzName: str = DEFAULT_TZ,
) -> tuple[str, str]:
    """Bucket an item into ``YYYY-MM-DD`` in the user's timezone and normalize UTC timestamp."""
    tz = resolveTimezone(tzName)

    # A bare YYYY-MM-DD date string represents a calendar day, not UTC midnight.
    if isValidCalendarDate(publishedAtIso):
        dateStr = publishedAtIso.strip()
        y, m, d = (int(p) for p in dateStr.split("-"))
        localNoon = datetime(y, m, d, 12, 0, 0, tzinfo=tz)
        return dateStr, _isoFromDatetime(localNoon)

    normPub = parseIsoTimestamp(publishedAtIso)
    if normPub:
        try:
            dt = datetime.fromisoformat(normPub.replace("Z", "+00:00"))
            return dt.astimezone(tz).strftime("%Y-%m-%d"), normPub
        except OverflowError:
            pass

    if isValidCalendarDate(fallbackDate):
        dateStr = fallbackDate.strip()
        y, m, d = (int(p) for p in dateStr.split("-"))
        localNoon = datetime(y, m, d, 12, 0, 0, tzinfo=tz)
        return dateStr, _isoFromDatetime(localNoon)

    normNow = parseIsoTimestamp(fallbackNowIso) or _isoFromDatetime(datetime.now(timezone.utc))
    nowDt = datetime.fromisoformat(normNow.replace("Z", "+00:00"))
    return nowDt.astimezone(tz).strftime("%Y-%m-%d"), normNow


def computeItemHash(
    guid: str | None,
    link: str | None,
    title: str | None,
    publishedAt: str | None,
    summary: str | None = None,
) -> str:
    """Deterministic 24-hex-char dedupe key for an item."""
    g = (guid or "").strip()
    l = (link or "").strip()
    t = (title or "").strip()
    p = (publishedAt or "").strip()
    s = (summary or "").strip()
    if g:
        basis = f"guid:{g}"
    elif l:
        basis = f"link:{l}"
    elif p:
        basis = f"tp:{t}|{p}"
    else:
        basis = f"ts:{t}|{s[:200]}"
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()[:24]


def preparePolledItems(
    parsed: ParsedFeed,
    *,
    fetchedAt: str,
    tzName: str = DEFAULT_TZ,
    limit: int = MAX_PARSED_ITEMS,
) -> list[dict]:
    """Convert ParsedFeed items into storage-ready item dicts with day bucketing and dedupe hashes."""
    prepared: list[dict] = []
    for item in parsed.items[:limit]:
        day, normPub = computeDay(item.publishedAt, None, fetchedAt, tzName)
        itemHash = computeItemHash(item.guid, item.link, item.title, item.publishedAt, item.summary)
        prepared.append(
            {
                "itemHash": itemHash,
                "day": day,
                "title": item.title,
                "link": item.link,
                "summary": item.summary,
                "contentHtml": item.contentHtml,
                "author": item.author,
                "publishedAt": normPub,
                "fetchedAt": fetchedAt,
                "guid": item.guid or None,
            }
        )
    return prepared
