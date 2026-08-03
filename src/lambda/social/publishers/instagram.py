"""
Instagram publisher (Meta Graph API, Facebook-Login model -- graph.facebook.com
with a Page-derived access token; see docs/social/instagram-api-notes.md #1/#9
for why this host+token combination is the correct one for this project and
not graph.instagram.com).

stdlib urllib only, no Facebook Business SDK, matching the house style in
social/publishers/bluesky.py (validate/publish split, HTTPError/URLError
handling, no third-party deps).

Media is fetched by Instagram itself from a presigned S3 URL supplied in each
media item's "url" -- needsMediaBytes=False below means this Lambda NEVER
loads media bytes into memory. A 300MB Reel would OOM the 128MB publisher
Lambda if read eagerly (see base.Publisher.needsMediaBytes docstring).
"""
import json
import logging
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from social.publishers.base import PUBLISHERS, PublishResult, Publisher
from social.publishers.bluesky import countGraphemes
from social.secrets import SecretNotFoundError, getInstagramCredentials

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Bump this in one place when Meta ships a new API version -- see
# docs/social/instagram-api-notes.md #1 for the version-support window
# (v25.0 documented current, v21.0 oldest supported, v26.0 newly released).
GRAPH_API_VERSION = "v25.0"
GRAPH_API_BASE = f"https://graph.facebook.com/{GRAPH_API_VERSION}"
REQUEST_TIMEOUT_SEC = 20

# --- validation limits (mirrors src/web/spa/src/features/social/validation.ts
# `instagram` entry so client and server agree) -----------------------------
MAX_CAPTION_GRAPHEMES = 2200
MAX_HASHTAGS = 30
MAX_MENTIONS = 20
MAX_MEDIA_ITEMS = 10  # carousel cap

_HASHTAG_RE = re.compile(r"#[^\s#@]+")
_MENTION_RE = re.compile(r"@[^\s#@]+")

# Meta's guidance: "query a container's status once per minute, for no more
# than 5 minutes" (docs #3) -- fast polling for the first 5 checks, then
# back off to once every 5 minutes.
CHECK_AFTER_SEC_FAST = 60
CHECK_AFTER_SEC_SLOW = 300
CHECK_AFTER_SEC_FAST_LIMIT = 5

# error.code values that mean "back off, rate limited" (docs #10).
_RATE_LIMIT_CODES = {4, 17, 32, 613}
# error.error_subcode values under code 190 that specifically mean the token
# itself is expired/invalid (as opposed to other 190 sub-reasons like a
# checkpointed user or a password change -- still token-ish, folded into the
# generic 190 message below).
_TOKEN_INVALID_SUBCODES = {463, 467}


def _nextCheckAfterSec(checkCount):
    return CHECK_AFTER_SEC_FAST if checkCount <= CHECK_AFTER_SEC_FAST_LIMIT else CHECK_AFTER_SEC_SLOW


def _isVideo(item):
    return (item.get("mimeType") or "").startswith("video/")


class InstagramPublisher(Publisher):
    platform = "instagram"

    # This Lambda receives a presigned GET URL per media item, never raw
    # bytes -- Meta fetches the media itself. See module docstring.
    needsMediaBytes = False

    def __init__(self, timeoutSec=REQUEST_TIMEOUT_SEC):
        self.timeoutSec = timeoutSec

    # --- Publisher interface -------------------------------------------------

    def validate(self, request):
        """Network-free pre-flight check -- mirrors the SPA's `instagram`
        rules in validation.ts so client and server agree on what's allowed."""
        errors = []
        text = request.text or ""

        graphemeCount = countGraphemes(text)
        if graphemeCount > MAX_CAPTION_GRAPHEMES:
            errors.append(
                f"Caption is {graphemeCount} graphemes, over Instagram's {MAX_CAPTION_GRAPHEMES}-grapheme limit."
            )

        hashtagCount = len(_HASHTAG_RE.findall(text))
        if hashtagCount > MAX_HASHTAGS:
            errors.append(f"Too many hashtags ({hashtagCount}), over Instagram's {MAX_HASHTAGS} limit.")

        mentionCount = len(_MENTION_RE.findall(text))
        if mentionCount > MAX_MENTIONS:
            errors.append(f"Too many @ mentions ({mentionCount}), over Instagram's {MAX_MENTIONS} limit.")

        media = request.media or []
        if len(media) == 0:
            # Instagram cannot publish text-only -- this is the rule most
            # likely to be missed, called out explicitly in the brief.
            errors.append("Instagram requires at least one photo or video -- text-only posts aren't supported.")
        if len(media) > MAX_MEDIA_ITEMS:
            errors.append(
                f"Instagram supports at most {MAX_MEDIA_ITEMS} media items per post (carousel cap); got {len(media)}."
            )

        for i, item in enumerate(media):
            mimeType = item.get("mimeType") or ""
            if _isVideo(item):
                if mimeType != "video/mp4":
                    errors.append(
                        f"Media {i}: unsupported video type '{mimeType}' -- Instagram video must be video/mp4."
                    )
            elif mimeType != "image/jpeg":
                errors.append(
                    f"Media {i}: unsupported image type '{mimeType or '(unknown)'}' -- Instagram images must be "
                    "JPEG (image/jpeg); PNG and WebP are not supported."
                )

        return errors

    def publish(self, request):
        errors = self.validate(request)
        if errors:
            return PublishResult(ok=False, error="; ".join(errors))

        try:
            igUserId, accessToken = getInstagramCredentials(request.accountId)
        except SecretNotFoundError as e:
            return PublishResult(ok=False, error=str(e))

        quotaError = self._checkQuota(igUserId, accessToken)
        if quotaError:
            return PublishResult(ok=False, error=quotaError)

        media = request.media or []
        onContainerCreated = request.onContainerCreated
        anyVideo = any(_isVideo(m) for m in media)

        try:
            if len(media) == 1:
                item = media[0]
                containerId = self._createMediaContainer(igUserId, accessToken, item, caption=request.text)
                if onContainerCreated is not None:
                    onContainerCreated(containerId)
                if _isVideo(item):
                    # Reels/video process asynchronously -- caller persists
                    # containerId and resumes via checkPending.
                    return PublishResult(
                        ok=True, pending=True, containerId=containerId, checkAfterSec=CHECK_AFTER_SEC_FAST,
                    )
                return self._publishAndFetchPermalink(igUserId, accessToken, containerId)

            # Carousel (2..MAX_MEDIA_ITEMS items, images and/or video).
            childIds = []
            videoChildIds = []
            for item in media:
                childId = self._createMediaContainer(
                    igUserId, accessToken, item, caption=None, isCarouselItem=True
                )
                childIds.append(childId)
                if _isVideo(item):
                    videoChildIds.append(childId)

            if not anyVideo:
                # All-image carousel is effectively synchronous end to end --
                # assemble and publish the parent right away.
                parentId = self._createCarouselParent(igUserId, accessToken, childIds, request.text)
                if onContainerCreated is not None:
                    onContainerCreated(parentId)
                return self._publishAndFetchPermalink(igUserId, accessToken, parentId)

            # At least one video child -- doc's inference (not a directly
            # documented requirement, see instagram-api-notes.md #4) is that
            # video children must finish processing before the parent can be
            # assembled, so we go pending and let checkPending poll each
            # video child, then assemble+publish once they're all FINISHED.
            containerId = json.dumps({"childIds": childIds, "videoChildIds": videoChildIds})
            if onContainerCreated is not None:
                onContainerCreated(containerId)
            return PublishResult(
                ok=True, pending=True, containerId=containerId, checkAfterSec=CHECK_AFTER_SEC_FAST,
            )
        except HTTPError as e:
            return PublishResult(ok=False, error=self._graphErrorMessage(e))
        except URLError as e:
            return PublishResult(ok=False, error=f"Network error contacting Instagram: {e.reason}")
        except (ValueError, KeyError) as e:
            logger.warning("Unexpected Instagram API response shape during publish: %s", e)
            return PublishResult(ok=False, error=f"Unexpected Instagram API response: {e}")

    def checkPending(self, request, containerId, checkCount):
        """Resume a pending publish. containerId is OPAQUE to the caller --
        either a bare Instagram container id (single image/video) or a JSON
        string encoding carousel-with-video state (see _parseContainerId).
        Never raises: an unparseable containerId or any platform failure
        comes back as PublishResult(ok=False, ...).
        """
        parsed = self._parseContainerId(containerId)
        if parsed is None:
            return PublishResult(ok=False, error=f"Unparseable Instagram containerId: {containerId!r}")

        try:
            igUserId, accessToken = getInstagramCredentials(request.accountId)
        except SecretNotFoundError as e:
            return PublishResult(ok=False, error=str(e))

        try:
            if parsed["kind"] == "single":
                return self._checkPendingSingle(igUserId, accessToken, parsed["id"], checkCount)
            return self._checkPendingCarousel(igUserId, accessToken, parsed, containerId, checkCount, request)
        except HTTPError as e:
            return PublishResult(ok=False, error=self._graphErrorMessage(e))
        except URLError as e:
            return PublishResult(ok=False, error=f"Network error contacting Instagram: {e.reason}")
        except (ValueError, KeyError) as e:
            logger.warning("Unexpected Instagram API response shape during checkPending: %s", e)
            return PublishResult(ok=False, error=f"Unexpected Instagram API response: {e}")

    # --- containerId encoding --------------------------------------------------

    @staticmethod
    def _parseContainerId(containerId):
        """Parse an opaque containerId back into either a bare single-container
        id or carousel-with-video state. Returns None (never raises) on
        anything malformed -- empty string, invalid JSON, or JSON missing the
        expected shape."""
        if not containerId or not isinstance(containerId, str):
            return None
        stripped = containerId.strip()
        if not stripped:
            return None
        if stripped.startswith("{"):
            try:
                data = json.loads(stripped)
            except ValueError:
                return None
            if not isinstance(data, dict):
                return None
            childIds = data.get("childIds")
            if not isinstance(childIds, list) or not childIds:
                return None
            videoChildIds = data.get("videoChildIds") or []
            if not isinstance(videoChildIds, list):
                return None
            return {"kind": "carousel", "childIds": childIds, "videoChildIds": videoChildIds}
        return {"kind": "single", "id": stripped}

    # --- polling ----------------------------------------------------------------

    def _checkPendingSingle(self, igUserId, accessToken, containerId, checkCount):
        statusCode, status = self._getContainerStatus(igUserId, accessToken, containerId)

        if statusCode == "FINISHED":
            return self._publishAndFetchPermalink(igUserId, accessToken, containerId)
        if statusCode == "IN_PROGRESS":
            return PublishResult(
                ok=True, pending=True, containerId=containerId, checkAfterSec=_nextCheckAfterSec(checkCount),
            )
        if statusCode == "ERROR":
            # status's contents are undocumented (docs #3/#12) -- opaque,
            # logged/returned for diagnosis only, never pattern-matched.
            return PublishResult(ok=False, error=f"Instagram container processing failed (status: {status!r}).")
        if statusCode == "EXPIRED":
            return PublishResult(
                ok=False,
                error="Instagram media container expired (24h validity window passed) -- it must be recreated.",
            )
        if statusCode == "PUBLISHED":
            # A previous attempt already published this container and we
            # crashed before recording it -- returning ok=True here (instead
            # of re-publishing) is the anti-duplicate mechanism.
            permalink = self._fetchPermalinkSafe(igUserId, accessToken, containerId)
            return PublishResult(ok=True, permalink=permalink, platformPostId=containerId)

        return PublishResult(ok=False, error=f"Unrecognised Instagram container status_code: {statusCode!r}")

    def _checkPendingCarousel(self, igUserId, accessToken, parsed, containerId, checkCount, request):
        childIds = parsed["childIds"]
        videoChildIds = parsed["videoChildIds"]

        for childId in videoChildIds:
            statusCode, status = self._getContainerStatus(igUserId, accessToken, childId)
            if statusCode == "IN_PROGRESS":
                return PublishResult(
                    ok=True, pending=True, containerId=containerId, checkAfterSec=_nextCheckAfterSec(checkCount),
                )
            if statusCode == "ERROR":
                return PublishResult(
                    ok=False,
                    error=f"Instagram carousel video child {childId} failed processing (status: {status!r}).",
                )
            if statusCode == "EXPIRED":
                return PublishResult(
                    ok=False,
                    error=(
                        f"Instagram carousel video child {childId} expired (24h validity window passed) -- "
                        "the whole carousel must be recreated."
                    ),
                )
            if statusCode not in ("FINISHED", "PUBLISHED"):
                return PublishResult(
                    ok=False,
                    error=(
                        f"Unrecognised Instagram container status_code for carousel child {childId}: "
                        f"{statusCode!r}"
                    ),
                )

        # Every video child is FINISHED (or already PUBLISHED, degenerate) --
        # safe to assemble and publish the parent now.
        parentId = self._createCarouselParent(igUserId, accessToken, childIds, request.text)
        if request.onContainerCreated is not None:
            request.onContainerCreated(parentId)
        return self._publishAndFetchPermalink(igUserId, accessToken, parentId)

    # --- Graph API calls ---------------------------------------------------------

    def _createMediaContainer(self, igUserId, accessToken, item, caption=None, isCarouselItem=False):
        params = {"access_token": accessToken}
        if _isVideo(item):
            params["media_type"] = "REELS"
            params["video_url"] = item["url"]
        else:
            params["image_url"] = item["url"]
            alt = item.get("alt")
            if alt:
                params["alt_text"] = alt[:1000]
        if caption:
            params["caption"] = caption
        if isCarouselItem:
            params["is_carousel_item"] = "true"
        data = self._post(f"{igUserId}/media", params)
        return data["id"]

    def _createCarouselParent(self, igUserId, accessToken, childIds, caption):
        params = {
            "access_token": accessToken,
            "media_type": "CAROUSEL",
            "children": ",".join(childIds),
        }
        if caption:
            params["caption"] = caption
        data = self._post(f"{igUserId}/media", params)
        return data["id"]

    def _mediaPublish(self, igUserId, accessToken, creationId):
        params = {"access_token": accessToken, "creation_id": creationId}
        data = self._post(f"{igUserId}/media_publish", params)
        return data["id"]

    def _getContainerStatus(self, igUserId, accessToken, containerId):
        data = self._get(containerId, {"fields": "status_code,status", "access_token": accessToken})
        return data.get("status_code"), data.get("status")

    def _publishAndFetchPermalink(self, igUserId, accessToken, creationId):
        mediaId = self._mediaPublish(igUserId, accessToken, creationId)
        permalink = self._fetchPermalinkSafe(igUserId, accessToken, mediaId)
        return PublishResult(ok=True, permalink=permalink, platformPostId=mediaId)

    def _fetchPermalinkSafe(self, igUserId, accessToken, mediaId):
        """GET the permalink for a published media id. Meta confirms
        media_publish's id is "the Instagram Media ID" but doesn't spell out
        permalink construction (docs #12), so this is a follow-up call --
        and it must never turn a successful publish into a failure."""
        try:
            data = self._get(mediaId, {"fields": "permalink", "access_token": accessToken})
            return data.get("permalink")
        except (HTTPError, URLError, ValueError, KeyError) as e:
            logger.warning("Instagram permalink fetch failed for mediaId=%s: %s", mediaId, self._safeErrStr(e))
            return None

    def _checkQuota(self, igUserId, accessToken):
        """Returns an error string if the publishing quota is exhausted, or
        None to proceed. If the quota endpoint itself fails or returns an
        unparseable shape, logs and returns None -- a broken quota check must
        never block an otherwise-good publish."""
        try:
            data = self._get(
                f"{igUserId}/content_publishing_limit", {"fields": "config,quota_usage", "access_token": accessToken}
            )
            entry = (data.get("data") or [])[0]
            usage = entry["quota_usage"]
            total = entry["config"]["quota_total"]
        except (HTTPError, URLError, ValueError, KeyError, IndexError, TypeError) as e:
            logger.warning("Instagram quota check failed, continuing with publish: %s", self._safeErrStr(e))
            return None
        if usage >= total:
            return f"Instagram publishing quota exhausted: {usage}/{total} posts used in the current window."
        return None

    # --- low-level HTTP + error handling -----------------------------------------

    def _post(self, path, params):
        data = urlencode(params).encode("utf-8")
        req = Request(f"{GRAPH_API_BASE}/{path}", data=data, method="POST")
        with urlopen(req, timeout=self.timeoutSec) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _get(self, path, params):
        qs = urlencode(params)
        req = Request(f"{GRAPH_API_BASE}/{path}?{qs}", method="GET")
        with urlopen(req, timeout=self.timeoutSec) as resp:
            return json.loads(resp.read().decode("utf-8"))

    @staticmethod
    def _safeErrStr(e):
        """Stringify an exception for logging without ever reading/echoing a
        response body (which is how a token could theoretically leak) --
        HTTPError's code/reason and any other exception's str() are safe."""
        if isinstance(e, HTTPError):
            return f"HTTP {e.code} {getattr(e, 'reason', '')}"
        return str(e)

    @staticmethod
    def _graphErrorMessage(e):
        """Parse Meta's error envelope (docs #10): error.message, error.type,
        error.code, error.error_subcode, error.fbtrace_id. Always includes
        fbtrace_id when present -- that's what Meta support needs. NEVER
        includes the access token: only fields from the parsed error body
        (which Meta does not echo the token into) are used here."""
        try:
            body = e.read()
            data = json.loads(body.decode("utf-8"))
            err = data.get("error") or {}
        except Exception:  # noqa: BLE001 -- any parse failure falls back to a generic message
            return f"Instagram API error: HTTP {getattr(e, 'code', '?')}"

        message = err.get("message") or f"Instagram API error: HTTP {getattr(e, 'code', '?')}"
        code = err.get("code")
        subcode = err.get("error_subcode")
        fbtrace = err.get("fbtrace_id")

        hint = InstagramPublisher._errorHint(code, subcode)
        parts = [message]
        if hint:
            parts.append(hint)
        if fbtrace:
            parts.append(f"fbtrace_id={fbtrace}")
        return " | ".join(parts)

    @staticmethod
    def _errorHint(code, subcode):
        if code in _RATE_LIMIT_CODES:
            return "Rate limited by Instagram/Meta -- back off and retry later."
        if code == 190:
            if subcode in _TOKEN_INVALID_SUBCODES:
                return "Instagram access token is expired or invalid -- refresh/re-issue it."
            return "Instagram access token problem (expired, invalid, or revoked) -- re-authenticate."
        if code == 10 or (isinstance(code, int) and 200 <= code <= 299):
            return "Missing an Instagram permission (likely instagram_content_publish) -- check granted scopes."
        return None


PUBLISHERS[InstagramPublisher.platform] = InstagramPublisher
