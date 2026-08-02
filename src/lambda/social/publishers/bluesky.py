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
# Bluesky's actual limit is 300 *graphemes*. len() on a Python str counts
# code points, which over-counts multi-codepoint grapheme clusters (flag
# emoji, ZWJ family emoji, etc.) — approximate on the safe side for phase 1.
MAX_GRAPHEMES = 300


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
        if len(text) > MAX_GRAPHEMES:
            errors.append(
                f"Post text is {len(text)} characters, over Bluesky's {MAX_GRAPHEMES}-grapheme limit "
                "(approximate count; see MAX_GRAPHEMES comment)."
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
