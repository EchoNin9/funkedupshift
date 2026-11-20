"""SSRF-safe HTTP fetching, conditional GETs, gzip zip-bomb guard, and feed autodiscovery.

Every outbound TCP/TLS connection uses ``common.netguard.PinnedHTTPConnection`` or
``PinnedHTTPSConnection`` so DNS is resolved once, validated as globally routable IPv4,
and connected directly on every redirect hop.
"""

from dataclasses import dataclass
from html.parser import HTMLParser
import http.client
import re
import socket
import ssl
import time
from urllib.parse import quote, urljoin, urlsplit, urlunsplit
import zlib

from common.netguard import PinnedHTTPConnection, PinnedHTTPSConnection
from feeds.parser import FeedParseError, ParsedFeed, parseFeed

USER_AGENT = "FunkedupshiftFeeds/1.0 (+https://feed.e9.cx)"
ACCEPT_HEADER = (
    "application/feed+json, application/atom+xml, application/rss+xml, "
    "application/xml, text/xml, text/html;q=0.8, */*;q=0.5"
)
ALLOWED_PORTS = (80, 443, 8080, 8443)
DEFAULT_PORTS = {"http": 80, "https": 443}
REDIRECT_STATUSES = (301, 302, 303, 307, 308)
MAX_URL_LEN = 2048
MAX_BYTES = 5 * 1024 * 1024
CONNECT_TIMEOUT_SEC = 5.0
TOTAL_TIMEOUT_SEC = 10.0
MAX_REDIRECTS = 3
_CHUNK_BYTES = 65_536
MAX_HEADER_VAL_LEN = 512

_SCHEME_PREFIX_RE = re.compile(r"^([A-Za-z][A-Za-z0-9+.-]*):")

_FEED_LINK_PRIORITY = {
    "application/rss+xml": 0,
    "application/atom+xml": 1,
    "application/feed+json": 2,
    "application/json": 3,
    "application/xml": 4,
    "text/xml": 5,
}


class FeedFetchError(Exception):
    """Raised when an HTTP fetch fails, times out, hits SSRF guards, or exceeds limits."""

    def __init__(self, message: str, *, statusCode: int | None = None):
        super().__init__(message)
        self.statusCode = statusCode


class FeedDiscoveryError(Exception):
    """Raised when a URL neither parses as a feed nor yields a valid feed link."""


@dataclass
class FetchResult:
    status: int
    url: str
    contentType: str
    body: bytes
    etag: str | None
    lastModified: str | None
    notModified: bool


def parseFeedUrl(rawUrl: str | None) -> tuple[str, str, str, int, str]:
    """Validate and normalize a feed URL. Returns ``(cleanUrl, scheme, host, port, target)``."""
    url = (rawUrl or "").strip()
    if not url:
        raise FeedFetchError("URL is required")
    if len(url) > MAX_URL_LEN:
        raise FeedFetchError(f"URL must be at most {MAX_URL_LEN} characters")
    if any(ord(c) < 33 or ord(c) == 127 for c in url):
        raise FeedFetchError("URL must not contain spaces or control characters")

    sm = _SCHEME_PREFIX_RE.match(url)
    if sm:
        schemePrefix = sm.group(1).lower()
        # Allow host:port shorthand (e.g. example.com:8443/feed) only when not a scheme like file: or javascript:.
        afterColon = url[sm.end() :]
        if schemePrefix in DEFAULT_PORTS and afterColon.startswith("//"):
            pass
        elif afterColon.startswith("//") or not re.match(r"^\d+(?:/|$|\?|#)", afterColon):
            raise FeedFetchError("Only http and https URLs are allowed")
        else:
            url = "https://" + url
    else:
        url = "https://" + url

    try:
        p = urlsplit(url)
        port = p.port
    except ValueError as e:
        raise FeedFetchError("URL is not valid") from e

    scheme = p.scheme.lower()
    if scheme not in DEFAULT_PORTS:
        raise FeedFetchError("Only http and https URLs are allowed")
    if not p.hostname:
        raise FeedFetchError("URL must include a hostname")
    if "@" in p.netloc:
        raise FeedFetchError("URL must not contain credentials")

    port = port or DEFAULT_PORTS[scheme]
    if port not in ALLOWED_PORTS:
        raise FeedFetchError("URL port is not allowed")

    try:
        host = p.hostname.encode("idna").decode("ascii")
    except UnicodeError as e:
        raise FeedFetchError("Hostname is not valid") from e

    target = quote(p.path or "/", safe="%/:=&~+!$,;'@()*[]-._") + (
        "?" + quote(p.query, safe="%/:=&?~+!$,;'@()*[]-._") if p.query else ""
    )
    canonicalNetloc = _hostHeader(scheme, host.lower(), port)
    cleanUrl = urlunsplit((scheme, canonicalNetloc, p.path or "/", p.query, ""))
    return cleanUrl, scheme, host, port, target


def _hostHeader(scheme: str, host: str, port: int) -> str:
    return host if port == DEFAULT_PORTS[scheme] else f"{host}:{port}"


def _cleanHeaderVal(val: str | None, maxLen: int = MAX_HEADER_VAL_LEN) -> str | None:
    if not val or not isinstance(val, str):
        return None
    s = val.strip()
    if not s or len(s) > maxLen or any(ord(c) < 32 or ord(c) == 127 for c in s):
        return None
    return s


def _readBoundedBody(
    resp: http.client.HTTPResponse,
    *,
    maxBytes: int,
    deadline: float,
    sock=None,
) -> bytes:
    encoding = (resp.getheader("Content-Encoding") or "").strip().lower()
    isGzip = "gzip" in encoding
    decomp = zlib.decompressobj(16 + zlib.MAX_WBITS) if isGzip else None

    chunks: list[bytes] = []
    wireTotal = 0
    outTotal = 0

    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0.05:
            raise FeedFetchError("Feed request timed out")
        if sock is not None and hasattr(sock, "settimeout"):
            try:
                sock.settimeout(remaining)
            except OSError:
                pass
        chunk = resp.read(_CHUNK_BYTES)
        if not chunk:
            break
        wireTotal += len(chunk)
        if wireTotal > maxBytes:
            raise FeedFetchError(f"Response too large (max {maxBytes} bytes)")

        if decomp is not None:
            remainingBytes = maxBytes - outTotal + 1
            try:
                part = decomp.decompress(chunk, max_length=remainingBytes)
            except zlib.error as e:
                raise FeedFetchError(f"Invalid gzip response: {e}") from e
            outTotal += len(part)
            if outTotal > maxBytes or decomp.unconsumed_tail:
                raise FeedFetchError(f"Response too large (max {maxBytes} bytes)")
            if part:
                chunks.append(part)
        else:
            outTotal += len(chunk)
            if outTotal > maxBytes:
                raise FeedFetchError(f"Response too large (max {maxBytes} bytes)")
            chunks.append(chunk)

    if decomp is not None:
        try:
            tail = decomp.flush(max(1, maxBytes - outTotal + 1))
        except zlib.error as e:
            raise FeedFetchError(f"Invalid gzip response: {e}") from e
        outTotal += len(tail)
        if outTotal > maxBytes:
            raise FeedFetchError(f"Response too large (max {maxBytes} bytes)")
        if tail:
            chunks.append(tail)

    return b"".join(chunks)


def _fetchOnce(
    parts: tuple[str, str, str, int, str],
    *,
    etag: str | None,
    lastModified: str | None,
    timeout: float,
    deadline: float,
    maxBytes: int,
) -> tuple[int, dict[str, str], bytes]:
    _, scheme, host, port, target = parts
    cls = PinnedHTTPSConnection if scheme == "https" else PinnedHTTPConnection
    conn = cls(host, port, timeout=timeout)
    headers = {
        "Host": _hostHeader(scheme, host, port),
        "User-Agent": USER_AGENT,
        "Accept": ACCEPT_HEADER,
        "Accept-Encoding": "gzip",
    }
    cleanEtag = _cleanHeaderVal(etag)
    cleanLastMod = _cleanHeaderVal(lastModified)
    if cleanEtag:
        headers["If-None-Match"] = cleanEtag
    if cleanLastMod:
        headers["If-Modified-Since"] = cleanLastMod

    try:
        conn.request("GET", target, headers=headers)
        resp = conn.getresponse()
        respHeaders = {k.lower(): v for k, v in resp.getheaders()}
        if resp.status == 304 or resp.status in REDIRECT_STATUSES:
            return resp.status, respHeaders, b""
        if resp.status >= 400:
            raise FeedFetchError(f"Feed returned HTTP {resp.status}", statusCode=resp.status)
        body = _readBoundedBody(
            resp,
            maxBytes=maxBytes,
            deadline=deadline,
            sock=getattr(conn, "sock", None),
        )
        return resp.status, respHeaders, body
    except FeedFetchError:
        raise
    except ValueError as e:
        # netguard SSRF refusals raise ValueError("URL points to a non-public address") etc.
        raise FeedFetchError(str(e)) from e
    except ssl.SSLError as e:
        raise FeedFetchError(f"TLS error: {getattr(e, 'reason', None) or str(e)}") from e
    except (socket.timeout, TimeoutError) as e:
        raise FeedFetchError("Feed request timed out") from e
    except (OSError, http.client.HTTPException) as e:
        raise FeedFetchError(f"Could not fetch feed: {e}") from e
    finally:
        conn.close()


def fetchUrl(
    rawUrl: str,
    *,
    etag: str | None = None,
    lastModified: str | None = None,
    maxBytes: int = MAX_BYTES,
    connectTimeout: float = CONNECT_TIMEOUT_SEC,
    totalTimeout: float = TOTAL_TIMEOUT_SEC,
    maxRedirects: int = MAX_REDIRECTS,
) -> FetchResult:
    """Fetch a feed URL safely with SSRF-pinned connections, redirects, and conditional GET."""
    parts = parseFeedUrl(rawUrl)
    visited = {(parts[1], parts[2].lower(), parts[3], parts[4])}
    deadline = time.monotonic() + totalTimeout

    for hop in range(maxRedirects + 1):
        remaining = deadline - time.monotonic()
        if remaining <= 0.05:
            raise FeedFetchError("Feed request timed out")
        hopTimeout = min(connectTimeout, remaining)

        status, respHeaders, body = _fetchOnce(
            parts,
            etag=etag if hop == 0 else None,
            lastModified=lastModified if hop == 0 else None,
            timeout=hopTimeout,
            deadline=deadline,
            maxBytes=maxBytes,
        )

        if status == 304:
            return FetchResult(
                status=304,
                url=parts[0],
                contentType="",
                body=b"",
                etag=_cleanHeaderVal(respHeaders.get("etag") or etag),
                lastModified=_cleanHeaderVal(respHeaders.get("last-modified") or lastModified),
                notModified=True,
            )

        if status in REDIRECT_STATUSES:
            loc = (respHeaders.get("location") or "").strip()
            if not loc:
                raise FeedFetchError(f"Redirect ({status}) missing Location header")
            if hop >= maxRedirects:
                raise FeedFetchError("Too many redirects")
            nextRaw = urljoin(parts[0], loc)
            nextParts = parseFeedUrl(nextRaw)
            key = (nextParts[1], nextParts[2].lower(), nextParts[3], nextParts[4])
            if key in visited:
                raise FeedFetchError("Redirect loop detected")
            visited.add(key)
            parts = nextParts
            continue

        ctype = (respHeaders.get("content-type") or "").split(";")[0].strip().lower()
        return FetchResult(
            status=status,
            url=parts[0],
            contentType=ctype,
            body=body,
            etag=_cleanHeaderVal(respHeaders.get("etag")),
            lastModified=_cleanHeaderVal(respHeaders.get("last-modified")),
            notModified=False,
        )

    raise FeedFetchError("Too many redirects")


class _AlternateLinkParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.candidates: list[tuple[int, int, str]] = []
        self._order = 0

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "link":
            return
        attrMap = {str(k).lower(): (v or "") for k, v in attrs}
        rels = {r.strip().lower() for r in attrMap.get("rel", "").split()}
        if "alternate" not in rels:
            return
        href = attrMap.get("href", "").strip()
        if not href:
            return
        mime = attrMap.get("type", "").split(";")[0].strip().lower()
        if mime in _FEED_LINK_PRIORITY:
            prio = _FEED_LINK_PRIORITY[mime]
        elif "rss" in mime or "atom" in mime or "feed+json" in mime:
            prio = 2
        else:
            return
        self.candidates.append((prio, self._order, href))
        self._order += 1


def discoverFeedUrls(htmlBytes: bytes, baseUrl: str) -> list[str]:
    """Extract and prioritize ``<link rel='alternate'>`` feed URLs from an HTML page."""
    if not htmlBytes:
        return []
    parser = _AlternateLinkParser()
    try:
        parser.feed(htmlBytes.decode("utf-8", errors="replace"))
        parser.close()
    except Exception:
        return []

    seen: set[str] = set()
    urls: list[str] = []
    for _, _, rawHref in sorted(parser.candidates):
        resolved = urljoin(baseUrl, rawHref)
        try:
            cleanUrl, *_ = parseFeedUrl(resolved)
        except FeedFetchError:
            continue
        if cleanUrl not in seen:
            seen.add(cleanUrl)
            urls.append(cleanUrl)
    return urls


def fetchAndDiscoverFeed(rawUrl: str, *, totalTimeout: float = 15.0) -> tuple[str, ParsedFeed, FetchResult]:
    """Fetch a URL as a feed, or discover an alternate RSS/Atom/JSON link from HTML."""
    deadline = time.monotonic() + totalTimeout
    res = fetchUrl(rawUrl, totalTimeout=min(TOTAL_TIMEOUT_SEC, totalTimeout))
    try:
        parsed = parseFeed(res.body, contentType=res.contentType, url=res.url)
        return res.url, parsed, res
    except FeedParseError as firstErr:
        candidates = discoverFeedUrls(res.body, res.url)
        if not candidates:
            raise FeedDiscoveryError(str(firstErr)) from firstErr

        lastErr: Exception = firstErr
        for candidate in candidates[:3]:
            remaining = deadline - time.monotonic()
            if remaining <= 0.1:
                raise FeedFetchError("Feed request timed out") from lastErr
            try:
                candRes = fetchUrl(candidate, totalTimeout=remaining)
                candParsed = parseFeed(candRes.body, contentType=candRes.contentType, url=candRes.url)
                return candRes.url, candParsed, candRes
            except (FeedFetchError, FeedParseError) as err:
                lastErr = err
        raise FeedDiscoveryError(f"Found feed links, but none could be parsed: {lastErr}") from lastErr
