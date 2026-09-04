"""
fal.ai queue API provider (src/lambda/lipsync/providers/fal.py).

stdlib urllib only, no fal SDK -- matching the house style already used by
social/publishers/instagram.py (validate/submit split, HTTPError/URLError
handling, no third-party deps, never echoing response bodies in errors).

Queue API shape (verified directly against fal.ai's own API reference and
model pages, not just docs/lipsync-design.md's summary -- see this module's
MODEL_CATALOG comment for one place that summary turned out to be wrong):

    POST  https://queue.fal.run/{model_id}                    (submit)
      -> {"request_id", "status_url", "response_url", "cancel_url", ...}
    GET   https://queue.fal.run/{app_id}/requests/{id}/status (poll)
      -> {"status": "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED", ...}
    GET   https://queue.fal.run/{app_id}/requests/{id}        (result)
      -> {"video": {"url": ..., "content_type", "file_name", "file_size"},
          "duration": <float, avatar model only -- veed/lipsync omits it,
          which is why runner.py re-measures the copied output itself
          instead of trusting this field>}

Note {model_id} vs {app_id}: submit takes the FULL model id, but status and
result key off the owner/app prefix only (see FalProvider.queueAppId). Using
the full id on a poll returns HTTP 405.

Auth: header `Authorization: Key <FAL_KEY>` on every call (submit, status,
and result) -- fal's status/result endpoints are account-scoped, not public.
"""
import json
import logging
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from lipsync.providers.base import (
    KNOWN_STATES,
    STATE_COMPLETED,
    STATE_FAILED,
    LipsyncProvider,
    PROVIDERS,
    ProviderError,
    StatusResult,
    SubmitResult,
    ValidationError,
)
from lipsync.secrets import getFalApiKey

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

QUEUE_BASE = "https://queue.fal.run"
REQUEST_TIMEOUT_SEC = 20

# NOTE on the avatar default's model id: docs/lipsync-design.md's Scope table
# (and, until this catalog existed, the frontend's
# features/lipsync/statusStyles.ts, which the design doc's model string was
# presumably copied from -- that field was display-only, "never sent to the
# API") both wrote this as "fal-ai/kling-video/v2/pro/ai-avatar". That
# path-segment ordering is wrong: fal's own API reference
# (fal.ai/models/fal-ai/kling-video/ai-avatar/v2/pro/api, confirmed live)
# gives the real id as "fal-ai/kling-video/ai-avatar/v2/pro". Submitting to
# the design doc's spelling 404s at fal for every single avatar-mode job, so
# this is the corrected id, not the documented one -- flagged in the original
# implementation report per the brief's "if you believe something in it is
# wrong, report that back rather than silently deviating" instruction, and
# carried forward here as the `avatar` entry in DEFAULT_MODELS.
#
# --- Model catalog ------------------------------------------------------------
#
# Every fal.ai model this provider can submit to, keyed by the FULL model id
# fal expects on submit (queueAppId derives the shorter status/result prefix
# from this at call time -- see that method's docstring; nothing below needs
# to duplicate that logic). Verified directly against fal's live OpenAPI
# schema and its queue routing (2026-08-17) -- field names are EXACT, do not
# "correct" them by pattern-matching neighbouring entries:
#
#   - fal-ai/musetalk takes `source_video_url`, NOT `video_url` like every
#     other relip model. This is exactly why the submit payload is built from
#     a PER-MODEL field map (see `fields` below and _buildInput) instead of a
#     per-mode assumption -- a per-mode map cannot express this one model's
#     different field name.
#   - fal-ai/infinitalk REQUIRES `prompt`. Every other avatar model treats it
#     as optional; every relip model doesn't accept it at all.
#
# Per entry:
#   mode           "avatar" | "relip"
#   label          human-readable, shown in the frontend's model picker
#   fields         fal input field name -> key in the `inputUrls` dict
#                  runner.py's _buildInputUrls builds (imageUrl/videoUrl/
#                  audioUrl) -- i.e. everything EXCEPT the prompt, which has
#                  no URL and is sourced from the job record directly.
#   promptField    fal's field name for a text prompt on this model, or None
#                  if the model has no prompt input at all (in which case a
#                  client-supplied prompt must be dropped, never forwarded as
#                  an unrecognised field -- see _buildInput).
#   promptRequired True only for fal-ai/infinitalk today.
#   price          INDICATIVE ONLY, sourced from fal's public model pages at
#                  authoring time -- NOT verified against a live fal account.
#                  Treat as a rough guide for the picker, never as a billing
#                  guarantee. Where sources actively disagreed (VEED), the
#                  string says so instead of picking one; where no figure was
#                  sourced at all (three of the four Kling variants, plus
#                  MuseTalk), it says "not verified" rather than inventing a
#                  number.
MODEL_CATALOG = {
    "fal-ai/kling-video/ai-avatar/v2/pro": {
        "mode": "avatar",
        "label": "Kling Avatar v2 Pro",
        "fields": {"image_url": "imageUrl", "audio_url": "audioUrl"},
        "promptField": "prompt",
        "promptRequired": False,
        "price": "~$0.115/s",
    },
    "fal-ai/kling-video/ai-avatar/v2/standard": {
        "mode": "avatar",
        "label": "Kling Avatar v2 Standard",
        "fields": {"image_url": "imageUrl", "audio_url": "audioUrl"},
        "promptField": "prompt",
        "promptRequired": False,
        "price": "not verified",
    },
    "fal-ai/kling-video/v1/standard/ai-avatar": {
        "mode": "avatar",
        "label": "Kling Avatar v1 Standard",
        "fields": {"image_url": "imageUrl", "audio_url": "audioUrl"},
        "promptField": "prompt",
        "promptRequired": False,
        "price": "not verified",
    },
    "fal-ai/infinitalk": {
        "mode": "avatar",
        "label": "InfiniteTalk",
        "fields": {"image_url": "imageUrl", "audio_url": "audioUrl"},
        "promptField": "prompt",
        "promptRequired": True,
        "price": "not verified",
    },
    "veed/lipsync": {
        "mode": "relip",
        "label": "VEED Lipsync",
        "fields": {"video_url": "videoUrl", "audio_url": "audioUrl"},
        "promptField": None,
        "promptRequired": False,
        "price": "uncertain -- fal pricing pages disagree ($0.07/s vs $0.40/min)",
    },
    "fal-ai/sync-lipsync/v2": {
        "mode": "relip",
        "label": "Sync Lipsync v2",
        "fields": {"video_url": "videoUrl", "audio_url": "audioUrl"},
        "promptField": None,
        "promptRequired": False,
        "price": "~$3/min",
    },
    "fal-ai/latentsync": {
        "mode": "relip",
        "label": "LatentSync",
        "fields": {"video_url": "videoUrl", "audio_url": "audioUrl"},
        "promptField": None,
        "promptRequired": False,
        "price": "~$0.20 (clips up to 40s)",
    },
    "fal-ai/musetalk": {
        "mode": "relip",
        "label": "MuseTalk",
        "fields": {"source_video_url": "videoUrl", "audio_url": "audioUrl"},
        "promptField": None,
        "promptRequired": False,
        "price": "not verified",
    },
    "fal-ai/pixverse/lipsync": {
        "mode": "relip",
        "label": "PixVerse Lipsync",
        "fields": {"video_url": "videoUrl", "audio_url": "audioUrl"},
        "promptField": None,
        "promptRequired": False,
        "price": "~$0.04/s",
    },
}

# Model used when CreateJobInput carries no `model` override -- unchanged
# from the pre-catalog behaviour (same two ids as the old MODE_MODELS).
DEFAULT_MODELS = {
    "avatar": "fal-ai/kling-video/ai-avatar/v2/pro",
    "relip": "veed/lipsync",
}


# --- Pricing ---------------------------------------------------------------------
#
# Budget enforcement needs EXACT integer arithmetic, so rates are held in
# TENTHS OF A CENT per second. Kling v2 Pro is $0.115/s = 11.5c/s, which is not
# an integer number of cents -- storing 115 tenths keeps it exact and avoids
# floats entirely (DynamoDB rejects raw Python floats, and float currency
# arithmetic accumulates error across many small charges).
#
# fal has NO per-request cost endpoint (/v1/account/requests 404s; the only
# breakdown is an async FOCUS billing export), so per-job cost can only ever be
# ESTIMATED. Where a real figure could not be sourced, the entry uses a
# conservative stand-in equal to the highest verified rate for that MODE, so a
# budget is never UNDER-charged -- a user may get slightly less value than
# their dollar figure suggests, rather than the account owner getting a
# surprise bill. `verified` False is surfaced in the UI so the estimate is not
# presented as a real quote.
#
# `flatTenthCents` is for models billed per clip rather than per second
# (LatentSync charges one flat fee up to 40s, comfortably above this module's
# 20s hard cap), in which case duration does not enter the estimate at all.
CONSERVATIVE_AVATAR_TENTH_CENTS_PER_SEC = 115  # Kling v2 Pro, the highest verified avatar rate
CONSERVATIVE_RELIP_TENTH_CENTS_PER_SEC = 50    # Sync Lipsync v2, the highest verified relip rate

MODEL_PRICING = {
    "fal-ai/kling-video/ai-avatar/v2/pro": {"tenthCentsPerSec": 115, "verified": True},
    "fal-ai/kling-video/ai-avatar/v2/standard": {
        "tenthCentsPerSec": CONSERVATIVE_AVATAR_TENTH_CENTS_PER_SEC, "verified": False},
    "fal-ai/kling-video/v1/standard/ai-avatar": {
        "tenthCentsPerSec": CONSERVATIVE_AVATAR_TENTH_CENTS_PER_SEC, "verified": False},
    "fal-ai/infinitalk": {
        "tenthCentsPerSec": CONSERVATIVE_AVATAR_TENTH_CENTS_PER_SEC, "verified": False},
    # Sources disagreed ($0.07/s vs $0.40/min ~= $0.0067/s) -- take the higher.
    "veed/lipsync": {"tenthCentsPerSec": 70, "verified": False},
    "fal-ai/sync-lipsync/v2": {"tenthCentsPerSec": 50, "verified": True},  # $3/min
    "fal-ai/latentsync": {"flatTenthCents": 200, "verified": True},        # ~$0.20 flat
    "fal-ai/musetalk": {
        "tenthCentsPerSec": CONSERVATIVE_RELIP_TENTH_CENTS_PER_SEC, "verified": False},
    "fal-ai/pixverse/lipsync": {"tenthCentsPerSec": 40, "verified": True},
}


def estimateCostCents(model, durationSec):
    """Estimated cost of one clip, in whole cents, rounded UP.

    Rounding up is deliberate: a budget that under-charges leaks money, and a
    fraction-of-a-cent rounding error in the user's favour, repeated, is a
    slow leak. An unknown model falls back to the most expensive rate in the
    catalog rather than to zero -- a pricing gap must never become a free job.
    """
    from decimal import ROUND_CEILING, Decimal

    pricing = MODEL_PRICING.get(model)
    if pricing is None:
        worst = max(
            [p.get("tenthCentsPerSec", 0) for p in MODEL_PRICING.values()]
            + [p.get("flatTenthCents", 0) for p in MODEL_PRICING.values()]
        )
        pricing = {"tenthCentsPerSec": worst, "verified": False}

    if "flatTenthCents" in pricing:
        tenths = Decimal(pricing["flatTenthCents"])
    else:
        seconds = Decimal(str(max(0, durationSec or 0)))
        tenths = seconds * Decimal(pricing["tenthCentsPerSec"])

    return int((tenths / 10).to_integral_value(rounding=ROUND_CEILING))


def priceIsVerified(model):
    pricing = MODEL_PRICING.get(model)
    return bool(pricing and pricing.get("verified"))


class FalProvider(LipsyncProvider):
    name = "fal"
    supportedModes = frozenset(DEFAULT_MODELS)

    def __init__(self, timeoutSec=REQUEST_TIMEOUT_SEC):
        self.timeoutSec = timeoutSec

    # --- LipsyncProvider interface -------------------------------------------

    def modelFor(self, mode, override=None):
        if mode not in DEFAULT_MODELS:
            raise ValidationError(f"fal provider does not support mode={mode!r}")
        if not override:
            return DEFAULT_MODELS[mode]
        entry = MODEL_CATALOG.get(override)
        if entry is None:
            raise ValidationError(f"unknown model {override!r}")
        if entry["mode"] != mode:
            raise ValidationError(f"model {override!r} is not valid for mode={mode!r}")
        return override

    def estimateCostCents(self, model, durationSec):
        return estimateCostCents(model, durationSec)

    def priceIsVerified(self, model):
        return priceIsVerified(model)

    def promptRequired(self, model):
        entry = MODEL_CATALOG.get(model)
        return bool(entry and entry["promptRequired"])

    def validate(self, job):
        mode = job.get("mode")
        if mode not in self.supportedModes:
            raise ValidationError(f"fal provider does not support mode={mode!r}")
        if mode == "avatar" and not job.get("imageKey"):
            raise ValidationError("avatar mode requires imageKey")
        if mode == "relip" and not job.get("videoKey"):
            raise ValidationError("relip mode requires videoKey")
        if not job.get("audioKey"):
            raise ValidationError("audioKey is required")
        # Defense in depth: routes.createJob already resolves/validates
        # `model` through modelFor (and the prompt requirement through
        # promptRequired) before a job is ever written, so this should be
        # unreachable in the normal flow -- but submit() calls validate()
        # again at runner time against whatever the job record actually
        # holds, so a corrupted/hand-edited record still fails safely here
        # instead of reaching _buildInput with an unknown catalog key.
        model = job.get("model") or DEFAULT_MODELS.get(mode)
        entry = MODEL_CATALOG.get(model)
        if entry is None:
            raise ValidationError(f"unknown model {model!r}")
        if entry["mode"] != mode:
            raise ValidationError(f"model {model!r} is not valid for mode={mode!r}")
        if entry["promptRequired"] and not str(job.get("prompt") or "").strip():
            raise ValidationError(f"model {model!r} requires a prompt")

    def submit(self, job, inputUrls):
        self.validate(job)
        model = job.get("model") or self.modelFor(job["mode"])
        payload = self._buildInput(model, job, inputUrls)

        try:
            data = self._post(f"{QUEUE_BASE}/{model}", payload)
        except (HTTPError, URLError) as e:
            raise ProviderError(self._safeErrStr(e)) from e
        except (ValueError, UnicodeDecodeError) as e:
            raise ProviderError(f"malformed response from fal: {e}") from e

        requestId = data.get("request_id")
        if not requestId:
            raise ProviderError("fal submit response is missing request_id")
        return SubmitResult(providerJobId=requestId, statusUrl=data.get("status_url", ""))

    @staticmethod
    def queueAppId(model):
        """Status/result URLs key off the OWNER/APP prefix, not the full model id.

        Submitting uses the full id (POST /fal-ai/kling-video/ai-avatar/v2/pro),
        but the queue routes status and result on the first two segments only:

            GET /fal-ai/kling-video/requests/{id}/status      -> 401 (route exists)
            GET /fal-ai/kling-video/ai-avatar/v2/pro/requests/{id}/status -> 405

        fal's published OpenAPI schema for this endpoint lists the FULL path for
        all three operations, which is wrong -- verified empirically against the
        live service (unauthenticated: valid routes 401, invalid ones 405).

        This only bites models with >2 path segments, which is why `veed/lipsync`
        worked end to end while `fal-ai/kling-video/ai-avatar/v2/pro` failed on
        its first poll with HTTP 405.
        """
        parts = [p for p in str(model).split("/") if p]
        return "/".join(parts[:2])

    def checkStatus(self, job):
        model = job.get("model") or self.modelFor(job["mode"])
        appId = self.queueAppId(model)
        requestId = job.get("providerJobId")
        if not requestId:
            return StatusResult(state=STATE_FAILED, error="job has no providerJobId to check")

        try:
            statusData = self._get(f"{QUEUE_BASE}/{appId}/requests/{requestId}/status")
        except (HTTPError, URLError) as e:
            return StatusResult(state=STATE_FAILED, error=self._safeErrStr(e))
        except ValueError as e:
            return StatusResult(state=STATE_FAILED, error=f"malformed status response from fal: {e}")

        state = statusData.get("status")
        if state not in KNOWN_STATES:
            return StatusResult(state=STATE_FAILED, error=f"unrecognised fal status: {state!r}")
        if state != STATE_COMPLETED:
            return StatusResult(state=state)

        try:
            resultData = self._get(f"{QUEUE_BASE}/{appId}/requests/{requestId}")
        except (HTTPError, URLError) as e:
            return StatusResult(state=STATE_FAILED, error=self._safeErrStr(e))
        except ValueError as e:
            return StatusResult(state=STATE_FAILED, error=f"malformed result response from fal: {e}")

        outputUrl = (resultData.get("video") or {}).get("url")
        if not outputUrl:
            return StatusResult(state=STATE_FAILED, error="fal result is missing video.url")
        return StatusResult(state=STATE_COMPLETED, outputUrl=outputUrl)

    # --- request building ------------------------------------------------------

    @staticmethod
    def _buildInput(model, job, inputUrls):
        """Build the fal submit payload from MODEL_CATALOG[model]["fields"] --
        deliberately PER MODEL, not per mode, because fal-ai/musetalk's field
        name (`source_video_url`) differs from every other relip model's
        (`video_url`); a per-mode assumption cannot express that. `inputUrls`
        supplies the URL-valued fields (see runner._buildInputUrls); `prompt`
        is the one non-URL field and is sourced from the job record directly.

        A prompt is forwarded only when this model has a promptField AND the
        job actually carries one -- a prompt sent for a model with no prompt
        input is silently dropped here rather than forwarded as a field fal
        doesn't recognise. (Required-but-missing is rejected far earlier, at
        routes.createJob / validate() -- by the time this runs the job either
        has a prompt or didn't need one.)
        """
        entry = MODEL_CATALOG[model]
        payload = {falField: inputUrls[urlKey] for falField, urlKey in entry["fields"].items()}
        promptField = entry["promptField"]
        if promptField:
            prompt = str(job.get("prompt") or "").strip()
            if prompt:
                payload[promptField] = prompt
        return payload

    # --- low-level HTTP + error handling -----------------------------------------

    def _post(self, url, payload):
        data = json.dumps(payload).encode("utf-8")
        req = Request(url, data=data, method="POST", headers=self._headers())
        with urlopen(req, timeout=self.timeoutSec) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _get(self, url):
        req = Request(url, method="GET", headers=self._headers())
        with urlopen(req, timeout=self.timeoutSec) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _headers(self):
        return {"Content-Type": "application/json", "Authorization": f"Key {getFalApiKey()}"}

    @staticmethod
    def _safeErrStr(e):
        """Stringify an exception for logging/storage without ever reading
        or echoing a response body (which is how request/account details
        could theoretically leak) -- HTTPError's code and any other
        exception's reason/str() are safe. The FAL_KEY itself never appears
        in any string this module builds, since it's only ever placed in a
        request header, never formatted into a message."""
        if isinstance(e, HTTPError):
            return f"HTTP {e.code} contacting fal.ai"
        return f"Network error contacting fal.ai: {getattr(e, 'reason', e)}"


PROVIDERS[FalProvider.name] = FalProvider()
