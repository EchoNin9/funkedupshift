"""
fal.ai queue API provider (src/lambda/lipsync/providers/fal.py).

stdlib urllib only, no fal SDK -- matching the house style already used by
social/publishers/instagram.py (validate/submit split, HTTPError/URLError
handling, no third-party deps, never echoing response bodies in errors).

Queue API shape (verified directly against fal.ai's own API reference and
model pages, not just docs/lipsync-design.md's summary -- see this module's
MODE_MODELS comment for one place that summary turned out to be wrong):

    POST  https://queue.fal.run/{model_id}                     (submit)
      -> {"request_id", "status_url", "response_url", "cancel_url", ...}
    GET   https://queue.fal.run/{model_id}/requests/{id}/status (poll)
      -> {"status": "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED", ...}
    GET   https://queue.fal.run/{model_id}/requests/{id}        (result)
      -> {"video": {"url": ..., "content_type", "file_name", "file_size"},
          "duration": <float, avatar model only -- veed/lipsync omits it,
          which is why runner.py re-measures the copied output itself
          instead of trusting this field>}

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

# NOTE on the avatar model id: docs/lipsync-design.md's Scope table (and the
# frontend's features/lipsync/statusStyles.ts, which the design doc's model
# string was presumably copied from -- that field is display-only, "never
# sent to the API") both write this as "fal-ai/kling-video/v2/pro/ai-avatar".
# That path-segment ordering is wrong: fal's own API reference
# (fal.ai/models/fal-ai/kling-video/ai-avatar/v2/pro/api, confirmed live)
# gives the real id as "fal-ai/kling-video/ai-avatar/v2/pro". Submitting to
# the design doc's spelling 404s at fal for every single avatar-mode job, so
# this is the corrected id, not the documented one -- flagged in the
# implementation report per the brief's "if you believe something in it is
# wrong, report that back rather than silently deviating" instruction.
MODE_MODELS = {
    "avatar": "fal-ai/kling-video/ai-avatar/v2/pro",
    "relip": "veed/lipsync",
}


class FalProvider(LipsyncProvider):
    name = "fal"
    supportedModes = frozenset(MODE_MODELS)

    def __init__(self, timeoutSec=REQUEST_TIMEOUT_SEC):
        self.timeoutSec = timeoutSec

    # --- LipsyncProvider interface -------------------------------------------

    def modelFor(self, mode, override=None):
        if mode not in MODE_MODELS:
            raise ValidationError(f"fal provider does not support mode={mode!r}")
        canonical = MODE_MODELS[mode]
        if override and override != canonical:
            raise ValidationError(f"unsupported model override {override!r} for mode={mode!r}")
        return canonical

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

    def submit(self, job, inputUrls):
        self.validate(job)
        model = job.get("model") or self.modelFor(job["mode"])
        payload = self._buildInput(job, inputUrls)

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

    def checkStatus(self, job):
        model = job.get("model") or self.modelFor(job["mode"])
        requestId = job.get("providerJobId")
        if not requestId:
            return StatusResult(state=STATE_FAILED, error="job has no providerJobId to check")

        try:
            statusData = self._get(f"{QUEUE_BASE}/{model}/requests/{requestId}/status")
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
            resultData = self._get(f"{QUEUE_BASE}/{model}/requests/{requestId}")
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
    def _buildInput(job, inputUrls):
        if job["mode"] == "avatar":
            return {"image_url": inputUrls["imageUrl"], "audio_url": inputUrls["audioUrl"]}
        return {"video_url": inputUrls["videoUrl"], "audio_url": inputUrls["audioUrl"]}

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
