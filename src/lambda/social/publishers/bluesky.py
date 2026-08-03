"""
Bluesky (AT Protocol) publisher. stdlib-only HTTP via urllib, matching the
house pattern in api/era_client.py and api/financial.py — no requests,
httpx, or the atproto SDK.

A fresh session (com.atproto.server.createSession) is created on every
publish() call. Deliberately not cached/refreshed: this Lambda is
short-lived and a stale token is worse than one extra login call.
"""
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

        try:
            accessJwt, did = self._createSession(handle, appPassword)

            blobs = []
            for item in request.media:
                blob = self._uploadBlob(accessJwt, item)
                blobs.append({"blob": blob, "alt": item.get("alt", "")})

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
                record["embed"] = {
                    "$type": "app.bsky.embed.images",
                    "images": [{"alt": b["alt"], "image": b["blob"]} for b in blobs],
                }

            resp = self._createRecord(accessJwt, did, record)
        except HTTPError as e:
            return PublishResult(ok=False, error=self._httpErrorMessage(e))
        except URLError as e:
            return PublishResult(ok=False, error=f"Network error contacting Bluesky: {e.reason}")

        uri = resp.get("uri") or ""
        rkey = uri.rsplit("/", 1)[-1] if uri else ""
        permalink = f"https://bsky.app/profile/{handle}/post/{rkey}" if rkey else None
        return PublishResult(ok=True, permalink=permalink, platformPostId=uri or None)

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

    def _createRecord(self, accessJwt, did, record):
        payload = json.dumps({
            "repo": did,
            "collection": "app.bsky.feed.post",
            "record": record,
        }).encode("utf-8")
        req = Request(
            f"{BSKY_API_BASE}/xrpc/com.atproto.repo.createRecord",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {accessJwt}",
            },
            method="POST",
        )
        with urlopen(req, timeout=self.timeoutSec) as resp:
            return json.loads(resp.read().decode("utf-8"))

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
