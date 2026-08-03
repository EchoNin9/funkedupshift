"""
Bluesky (AT Protocol) publisher. stdlib-only HTTP via urllib, matching the
house pattern in api/era_client.py and api/financial.py — no requests,
httpx, or the atproto SDK.

A fresh session (com.atproto.server.createSession) is created on every
publish() call. Deliberately not cached/refreshed: this Lambda is
short-lived and a stale token is worse than one extra login call.
"""
import hashlib
import json
import logging
import re
import unicodedata
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from social.publishers.base import PUBLISHERS, PublishResult, Publisher
from social.secrets import SecretNotFoundError, getBlueskyCredentials

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

BSKY_API_BASE = "https://bsky.social"  # per-account override is a later phase; module constant is fine now
REQUEST_TIMEOUT_SEC = 10

MAX_IMAGES = 4
MAX_IMAGE_BYTES = 1_000_000
# Bluesky's actual limit is 300 *graphemes*, enforced via countGraphemes()
# below (stdlib unicodedata only -- no external grapheme-segmentation dep).
MAX_GRAPHEMES = 300

# --- deterministic AT Protocol TID (record key) -------------------------------
#
# app.bsky.feed.post's lexicon specifies `key: tid` -- a plain hash will not
# validate. A TID is a 64-bit integer encoded as 13 characters of this
# sortable base32 alphabet, big-endian, 5 bits/char: bit 63 is always 0,
# bits 62..10 are a 53-bit microsecond-since-epoch timestamp, bits 9..0 are a
# 10-bit clock id.
_TID_ALPHABET = "234567abcdefghijklmnopqrstuvwxyz"
_TID_LENGTH = 13

# Fixed sentinel epoch (2024-01-01T00:00:00Z) used ONLY when scheduledAt is
# missing/unparseable, so the fallback TID is still fully deterministic --
# never time.time(), which would break the "same inputs -> same rkey"
# guarantee this whole mechanism depends on.
_TID_FALLBACK_EPOCH_SECONDS = 1704067200

# --- grapheme counting (stdlib-only, no external deps) ------------------------

_ZWJ = "\u200d"
_VARIATION_SELECTOR_RANGE = (0xFE00, 0xFE0F)
_SKIN_TONE_MODIFIER_RANGE = (0x1F3FB, 0x1F3FF)
_REGIONAL_INDICATOR_RANGE = (0x1F1E6, 0x1F1FF)
_COMBINING_CATEGORIES = ("Mn", "Mc", "Me")


def _isRegionalIndicator(codepoint):
    return _REGIONAL_INDICATOR_RANGE[0] <= codepoint <= _REGIONAL_INDICATOR_RANGE[1]


def countGraphemes(text):
    """Approximate Unicode grapheme-cluster count, stdlib-only (no regex/ICU
    grapheme segmentation available without a third-party dep).

    len(text) counts Python code points, which OVER-counts any multi-codepoint
    cluster -- a ZWJ family emoji is 7 code points but renders (and counts,
    per Bluesky's own limit, and per the SPA's Intl.Segmenter) as ONE
    grapheme. This collapses the sequences that matter in practice for social
    post text: combining marks, ZWJ joins, variation selectors, skin-tone
    modifiers, and regional-indicator (flag) pairs -- each of those collapses
    into a single grapheme rather than counting every code point.

    Not a full UAX #29 implementation (no support for e.g. Hangul jamo
    clustering or every exotic extended-pictographic edge case), but it
    agrees with Intl.Segmenter on plain text and on every common emoji shape
    (plain, ZWJ sequences, flags, skin-tone modifiers), which is what the
    frontend actually counts against.
    """
    if not text:
        return 0

    count = 0
    i = 0
    n = len(text)
    joinNext = False  # a ZWJ just consumed -- the next codepoint attaches to the current cluster

    while i < n:
        c = text[i]
        codepoint = ord(c)
        category = unicodedata.category(c)

        # Combining marks always attach to the previous grapheme -- never
        # start a new one.
        if category in _COMBINING_CATEGORIES:
            i += 1
            joinNext = False
            continue

        # Variation selectors (text vs. emoji presentation) attach to the
        # preceding base character.
        if _VARIATION_SELECTOR_RANGE[0] <= codepoint <= _VARIATION_SELECTOR_RANGE[1]:
            i += 1
            joinNext = False
            continue

        # Skin-tone modifiers attach to the preceding emoji base.
        if _SKIN_TONE_MODIFIER_RANGE[0] <= codepoint <= _SKIN_TONE_MODIFIER_RANGE[1]:
            i += 1
            joinNext = False
            continue

        if c == _ZWJ:
            # A ZWJ glues the NEXT codepoint onto the cluster already
            # counted -- it never starts (or itself counts as) a grapheme.
            joinNext = True
            i += 1
            continue

        if joinNext:
            # This codepoint was joined to the previous cluster by the ZWJ
            # just consumed -- don't start a new grapheme for it.
            joinNext = False
            i += 1
            continue

        if _isRegionalIndicator(codepoint) and i + 1 < n and _isRegionalIndicator(ord(text[i + 1])):
            # A flag is exactly two regional-indicator codepoints -> one grapheme.
            count += 1
            i += 2
            continue

        count += 1
        i += 1

    return count


# --- facets: URL / mention / hashtag detection with UTF-8 byte offsets --------

_URL_RE = re.compile(r"https?://\S+")
_MENTION_RE = re.compile(r"(?<![\w@.])@([a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?)")
_TAG_RE = re.compile(r"(?<![\w#])#(\w+)", re.UNICODE)

_TRAILING_PUNCT_SIMPLE = ".,!?;:'\""


def _trimTrailingUrlPunct(text, start, end):
    """Shrink a raw [start:end) URL match to exclude trailing sentence
    punctuation, e.g. "https://x.com." -> "https://x.com". A trailing ')'
    is only trimmed if it's unbalanced within the match (so a URL that
    legitimately ends in a balanced paren, e.g. a Wikipedia
    .../Foo_(bar) link, is left alone; a URL merely wrapped in
    "(...)" prose has its wrapping paren stripped)."""
    while end > start:
        c = text[end - 1]
        if c in _TRAILING_PUNCT_SIMPLE:
            end -= 1
            continue
        if c == ")":
            substr = text[start:end]
            if substr.count("(") < substr.count(")"):
                end -= 1
                continue
        break
    return end


def buildFacets(text, resolveHandleFn=None):
    """Build Bluesky richtext facets for URLs, @mentions, and #hashtags in `text`.

    Pure and network-free: `resolveHandleFn(handle) -> did-or-None` is
    injected so tests can exercise this with a stubbed resolver. The
    default resolves nothing (mentions are skipped, never network calls).

    Facet index offsets are BYTE indices into text.encode("utf-8") — the AT
    Protocol requires byte offsets, not character offsets, so a post with
    any multi-byte characters ahead of a link needs this to render as a
    clickable link at all.

    Returns [] when there is nothing to link — callers should omit the
    `facets` key entirely from the post record in that case.
    """
    resolveHandleFn = resolveHandleFn or (lambda handle: None)
    matches = []  # (startChar, endChar, feature)
    urlSpans = []

    for m in _URL_RE.finditer(text):
        end = _trimTrailingUrlPunct(text, m.start(), m.end())
        if end <= m.start():
            continue
        uri = text[m.start():end]
        urlSpans.append((m.start(), end))
        matches.append((m.start(), end, {"$type": "app.bsky.richtext.facet#link", "uri": uri}))

    def _insideUrl(start, end):
        """A URL path can contain '@' or '#' (medium.com/@user,
        youtube.com/@chan, docs#anchor). Those must not also become mention
        or tag facets — AT Protocol facets must not overlap, and a mention
        facet nested inside a link facet produces a malformed record."""
        return any(s <= start and end <= e for s, e in urlSpans)

    for m in _MENTION_RE.finditer(text):
        if _insideUrl(m.start(), m.end()):
            continue
        handle = m.group(1)
        try:
            did = resolveHandleFn(handle)
        except Exception as e:
            logger.warning("mention resolve failed for @%s: %s", handle, e)
            did = None
        if not did:
            # Resolution failed (or handle doesn't exist) — skip this facet,
            # the post still goes out with the @handle as plain text.
            continue
        matches.append((m.start(), m.end(), {"$type": "app.bsky.richtext.facet#mention", "did": did}))

    for m in _TAG_RE.finditer(text):
        if _insideUrl(m.start(), m.end()):
            continue
        matches.append((m.start(), m.end(), {"$type": "app.bsky.richtext.facet#tag", "tag": m.group(1)}))

    matches.sort(key=lambda t: t[0])

    facets = []
    for startChar, endChar, feature in matches:
        byteStart = len(text[:startChar].encode("utf-8"))
        byteEnd = len(text[:endChar].encode("utf-8"))
        facets.append({"index": {"byteStart": byteStart, "byteEnd": byteEnd}, "features": [feature]})
    return facets


def _isoNowUtc():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _s32Encode(value, length=_TID_LENGTH):
    """Encode a non-negative int as `length` chars of the TID base32
    alphabet, big-endian (most-significant chunk first, 5 bits/char)."""
    chars = [""] * length
    v = value
    for i in range(length - 1, -1, -1):
        chars[i] = _TID_ALPHABET[v & 0x1F]
        v >>= 5
    return "".join(chars)


def _parseScheduledAtEpochSeconds(scheduledAt):
    """Parse an ISO-8601 scheduledAt (optionally 'Z'-suffixed) into epoch
    seconds. Returns None when empty/unparseable so the caller can fall
    back to a fixed sentinel instead of guessing."""
    if not scheduledAt:
        return None
    try:
        s = scheduledAt.strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except (ValueError, TypeError):
        return None


def _deterministicRkey(idempotencyKey, scheduledAt):
    """Derive a deterministic, lexicon-valid AT Protocol TID from a stable
    per-target idempotency key and the parent post's scheduledAt.

    Why: a target stuck in 'publishing' (process crashed between the
    platform ack and the DynamoDB write) gets republished by the
    maintenance sweep. A deterministic rkey makes that republish land on
    the exact same record instead of creating a duplicate post -- see the
    createRecord/getRecord replay handling in _createRecord's caller.

    The timestamp component is anchored to the real scheduledAt second (so
    the TID sorts correctly among genuinely-time-ordered posts); the
    sub-second microseconds and the clock id are both derived from a
    SHA-256 hash of idempotencyKey, so the same inputs always produce the
    same TID -- no randomness, no wall-clock dependency.
    """
    digest = hashlib.sha256(idempotencyKey.encode("utf-8")).digest()
    subSecondSource = int.from_bytes(digest[0:8], "big")
    clockIdSource = int.from_bytes(digest[8:16], "big")

    epochSeconds = _parseScheduledAtEpochSeconds(scheduledAt)
    if epochSeconds is None:
        epochSeconds = _TID_FALLBACK_EPOCH_SECONDS

    micros = int(epochSeconds) * 1_000_000 + (subSecondSource % 1_000_000)
    clockid = clockIdSource % 1024
    value = (micros << 10) | clockid

    tid = _s32Encode(value, _TID_LENGTH)
    assert len(tid) == _TID_LENGTH
    return tid


# --- image dimensions (stdlib-only; Pillow is not available to this Lambda) --


def _pngDimensions(data):
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        return None
    width = int.from_bytes(data[16:20], "big")
    height = int.from_bytes(data[20:24], "big")
    return (width, height)


_JPEG_SOF_MARKERS = frozenset(range(0xC0, 0xD0)) - {0xC4, 0xC8, 0xCC}


def _jpegDimensions(data):
    n = len(data)
    if n < 4 or data[0:2] != b"\xff\xd8":
        return None

    i = 2
    while i < n:
        if data[i] != 0xFF:
            return None
        j = i + 1
        while j < n and data[j] == 0xFF:  # skip fill bytes
            j += 1
        if j >= n:
            return None
        marker = data[j]
        i = j + 1

        if marker == 0xD9:  # EOI -- ran off the end without finding a SOF
            return None
        if marker == 0x01 or 0xD0 <= marker <= 0xD7:
            # No-payload markers (TEM, restart markers) -- no length field.
            continue
        if i + 2 > n:
            return None
        segLength = int.from_bytes(data[i:i + 2], "big")
        if marker in _JPEG_SOF_MARKERS:
            if i + 7 > n:
                return None
            height = int.from_bytes(data[i + 3:i + 5], "big")
            width = int.from_bytes(data[i + 5:i + 7], "big")
            return (width, height)
        if segLength < 2 or i + segLength > n:
            return None
        i += segLength
    return None


def _webpDimensions(data):
    # 20 = 12-byte RIFF/WEBP header + 8-byte chunk header (fourcc + size);
    # each branch below further checks its own chunk-data minimum (VP8L's
    # smallest valid payload is 5 bytes, so a blanket 30-byte floor here
    # would wrongly reject a minimal-but-valid VP8L file).
    if len(data) < 20 or data[0:4] != b"RIFF" or data[8:12] != b"WEBP":
        return None

    fourcc = data[12:16]
    chunk = data[20:]

    if fourcc == b"VP8 ":
        if len(chunk) < 10 or chunk[3:6] != b"\x9d\x01\x2a":
            return None
        width = int.from_bytes(chunk[6:8], "little") & 0x3FFF
        height = int.from_bytes(chunk[8:10], "little") & 0x3FFF
        return (width, height)

    if fourcc == b"VP8L":
        if len(chunk) < 5 or chunk[0] != 0x2F:
            return None
        bits = int.from_bytes(chunk[1:5], "little")
        width = (bits & 0x3FFF) + 1
        height = ((bits >> 14) & 0x3FFF) + 1
        return (width, height)

    if fourcc == b"VP8X":
        if len(chunk) < 10:
            return None
        width = int.from_bytes(chunk[4:7], "little") + 1
        height = int.from_bytes(chunk[7:10], "little") + 1
        return (width, height)

    return None


def _imageDimensions(data):
    """Return (width, height) parsed from raw image bytes (PNG, JPEG, or
    WebP -- the three formats the presign route accepts), or None if the
    format is unrecognised or the bytes are truncated/malformed.

    Never raises: a dimension-parse failure must not break a publish --
    callers just omit the aspectRatio key for that image.
    """
    if not data:
        return None
    try:
        if data[:8] == b"\x89PNG\r\n\x1a\n":
            return _pngDimensions(data)
        if data[:2] == b"\xff\xd8":
            return _jpegDimensions(data)
        if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            return _webpDimensions(data)
    except Exception as e:  # noqa: BLE001 -- must never raise out of publish()
        logger.warning("_imageDimensions failed to parse image bytes: %s", e)
        return None
    return None


class BlueskyPublisher(Publisher):
    platform = "bluesky"

    def __init__(self, timeoutSec=REQUEST_TIMEOUT_SEC):
        self.timeoutSec = timeoutSec

    # --- Publisher interface ---------------------------------------------------

    def validate(self, request):
        errors = []
        text = request.text or ""
        graphemeCount = countGraphemes(text)
        if graphemeCount > MAX_GRAPHEMES:
            errors.append(
                f"Post text is {graphemeCount} graphemes, over Bluesky's {MAX_GRAPHEMES}-grapheme limit."
            )

        media = request.media or []
        if len(media) > MAX_IMAGES:
            errors.append(f"Bluesky supports at most {MAX_IMAGES} images per post; got {len(media)}.")

        for i, item in enumerate(media):
            size = len(item.get("bytes") or b"")
            if size > MAX_IMAGE_BYTES:
                errors.append(
                    f"Image {i} is {size} bytes, over Bluesky's {MAX_IMAGE_BYTES}-byte blob upload limit "
                    "(resizing is not implemented in phase 1)."
                )

        return errors

    def publish(self, request):
        errors = self.validate(request)
        if errors:
            return PublishResult(ok=False, error="; ".join(errors))

        try:
            handle, appPassword = getBlueskyCredentials(request.accountId)
        except SecretNotFoundError as e:
            return PublishResult(ok=False, error=str(e))

        preflightError = self._preflightResolveHandle(handle, request.accountId)
        if preflightError:
            return PublishResult(ok=False, error=preflightError)

        rkey = self._deterministicRkeyFor(request) if request.idempotencyKey else None

        try:
            accessJwt, did = self._createSession(handle, appPassword)

            blobs = []
            for item in request.media:
                blob = self._uploadBlob(accessJwt, item)
                blobs.append({
                    "blob": blob,
                    "alt": item.get("alt", ""),
                    "dims": _imageDimensions(item.get("bytes") or b""),
                })

            facets = buildFacets(request.text, lambda h: self._resolveHandle(h))

            record = {
                "$type": "app.bsky.feed.post",
                "text": request.text,
                "createdAt": _isoNowUtc(),
                "langs": ["en"],
            }
            if facets:
                record["facets"] = facets
            if blobs:
                images = []
                for b in blobs:
                    image = {"alt": b["alt"], "image": b["blob"]}
                    if b["dims"] is not None:
                        width, height = b["dims"]
                        image["aspectRatio"] = {"width": width, "height": height}
                    images.append(image)
                record["embed"] = {
                    "$type": "app.bsky.embed.images",
                    "images": images,
                }
        except HTTPError as e:
            return PublishResult(ok=False, error=self._httpErrorMessage(e))
        except URLError as e:
            return PublishResult(ok=False, error=f"Network error contacting Bluesky: {e.reason}")

        try:
            resp = self._createRecord(accessJwt, did, record, rkey=rkey)
        except HTTPError as e:
            if rkey:
                replay = self._checkForExistingRecord(accessJwt, did, handle, rkey)
                if replay is not None:
                    return replay
            return PublishResult(ok=False, error=self._httpErrorMessage(e))
        except URLError as e:
            return PublishResult(ok=False, error=f"Network error contacting Bluesky: {e.reason}")

        uri = resp.get("uri") or ""
        respRkey = uri.rsplit("/", 1)[-1] if uri else ""
        permalink = f"https://bsky.app/profile/{handle}/post/{respRkey}" if respRkey else None
        return PublishResult(ok=True, permalink=permalink, platformPostId=uri or None)

    @staticmethod
    def _deterministicRkeyFor(request):
        return _deterministicRkey(request.idempotencyKey, request.scheduledAt)

    # --- XRPC calls --------------------------------------------------------------

    def _createSession(self, handle, appPassword):
        payload = json.dumps({"identifier": handle, "password": appPassword}).encode("utf-8")
        req = Request(
            f"{BSKY_API_BASE}/xrpc/com.atproto.server.createSession",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(req, timeout=self.timeoutSec) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data["accessJwt"], data["did"]

    def _uploadBlob(self, accessJwt, mediaItem):
        req = Request(
            f"{BSKY_API_BASE}/xrpc/com.atproto.repo.uploadBlob",
            data=mediaItem["bytes"],
            headers={
                "Content-Type": mediaItem.get("mimeType", "application/octet-stream"),
                "Authorization": f"Bearer {accessJwt}",
            },
            method="POST",
        )
        with urlopen(req, timeout=self.timeoutSec) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data["blob"]

    def _createRecord(self, accessJwt, did, record, rkey=None):
        payload = {
            "repo": did,
            "collection": "app.bsky.feed.post",
            "record": record,
        }
        if rkey:
            payload["rkey"] = rkey
        req = Request(
            f"{BSKY_API_BASE}/xrpc/com.atproto.repo.createRecord",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {accessJwt}",
            },
            method="POST",
        )
        with urlopen(req, timeout=self.timeoutSec) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _getRecord(self, accessJwt, did, rkey):
        """GET com.atproto.repo.getRecord for (did, rkey). Raises HTTPError/
        URLError/ValueError/KeyError on any failure -- callers decide what a
        failure means (used only for the createRecord replay check below)."""
        qs = urlencode({"repo": did, "collection": "app.bsky.feed.post", "rkey": rkey})
        req = Request(
            f"{BSKY_API_BASE}/xrpc/com.atproto.repo.getRecord?{qs}",
            headers={"Authorization": f"Bearer {accessJwt}"},
            method="GET",
        )
        with urlopen(req, timeout=self.timeoutSec) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _checkForExistingRecord(self, accessJwt, did, handle, rkey):
        """Called when createRecord fails AND we supplied an explicit
        (deterministic) rkey -- the record may already exist from a crashed
        prior attempt (see _deterministicRkey's docstring). If getRecord
        finds it, the post already went out and is ours (the rkey is
        deterministic, so it cannot belong to anything else): return an ok
        PublishResult. If getRecord also fails, return None so the caller
        falls back to the ORIGINAL createRecord error, unchanged."""
        try:
            existing = self._getRecord(accessJwt, did, rkey)
        except (HTTPError, URLError, ValueError, KeyError) as e:
            logger.warning("getRecord replay check for rkey=%s failed: %s", rkey, e)
            return None
        if not existing:
            return None
        uri = f"at://{did}/app.bsky.feed.post/{rkey}"
        permalink = f"https://bsky.app/profile/{handle}/post/{rkey}"
        return PublishResult(ok=True, permalink=permalink, platformPostId=uri)

    def _preflightResolveHandle(self, handle, accountId):
        """Resolve `handle` before createSession so a bad handle (typo'd
        SSM value, wrong parameter) surfaces a specific, actionable error
        instead of createSession's opaque "invalid identifier or password"
        for both failure modes.

        Returns an error string to fail the publish, or None to proceed.
        A transient network failure (URLError -- no HTTP response at all)
        must NOT block an otherwise-good publish, so only a resolved
        failure (HTTPError, or a malformed/empty response) is treated as
        a hard failure; a URLError just logs and continues.
        """
        qs = urlencode({"handle": handle})
        req = Request(f"{BSKY_API_BASE}/xrpc/com.atproto.identity.resolveHandle?{qs}", method="GET")
        unresolvedMessage = (
            f"Bluesky handle '{handle}' did not resolve -- check "
            f"/funkedupshift/social/bluesky/{accountId}/handle in SSM "
            "(use the account's actual handle, not its display name)."
        )
        try:
            with urlopen(req, timeout=self.timeoutSec) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except HTTPError as e:
            logger.warning("preflight resolveHandle(%s) failed to resolve: %s", handle, e)
            return unresolvedMessage
        except URLError as e:
            logger.warning("preflight resolveHandle(%s) hit a transient network error, continuing: %s", handle, e)
            return None
        except (ValueError, KeyError) as e:
            logger.warning("preflight resolveHandle(%s) returned an unparseable response: %s", handle, e)
            return unresolvedMessage

        if not data.get("did"):
            return unresolvedMessage
        return None

    def _resolveHandle(self, handle):
        """GET resolveHandle -> did, or None on any failure. Never raises —
        a mention that can't be resolved must not fail the whole post."""
        qs = urlencode({"handle": handle})
        req = Request(f"{BSKY_API_BASE}/xrpc/com.atproto.identity.resolveHandle?{qs}", method="GET")
        try:
            with urlopen(req, timeout=self.timeoutSec) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            return data.get("did")
        except (HTTPError, URLError, ValueError, KeyError) as e:
            logger.warning("resolveHandle(%s) failed: %s", handle, e)
            return None

    @staticmethod
    def _httpErrorMessage(e):
        """Bluesky returns {"error": "...", "message": "..."} on HTTPError.
        Read + parse it so the caller gets the API's own message rather than
        a raw traceback; fall back to a generic message if the body isn't
        the shape we expect."""
        try:
            body = e.read()
            data = json.loads(body.decode("utf-8"))
            return data.get("message") or data.get("error") or f"Bluesky API error: HTTP {e.code}"
        except Exception:
            return f"Bluesky API error: HTTP {getattr(e, 'code', '?')}"


PUBLISHERS[BlueskyPublisher.platform] = BlueskyPublisher
