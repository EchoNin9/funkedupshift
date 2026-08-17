"""Unit tests for lipsync/providers/fal.py and the provider ABC/registry
(lipsync/providers/base.py). urllib is mocked per house style (see
test_social_instagram.py's _mockResponse helper) -- no moto, no real
network calls."""
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _mockResponse(payload):
    """A context-manager-compatible stand-in for the object urlopen() returns."""
    resp = MagicMock()
    resp.read.return_value = json.dumps(payload).encode("utf-8")
    resp.__enter__ = MagicMock(return_value=resp)
    resp.__exit__ = MagicMock(return_value=False)
    return resp


def _job(mode="avatar", **overrides):
    base = {
        "jobId": "job1", "mode": mode, "provider": "fal",
        "model": "fal-ai/kling-video/ai-avatar/v2/pro" if mode == "avatar" else "veed/lipsync",
        "audioKey": "uploads/u/audio/a.wav", "providerJobId": "req-abc",
    }
    if mode == "avatar":
        base["imageKey"] = "uploads/u/image/i.jpg"
    else:
        base["videoKey"] = "uploads/u/video/v.mp4"
    base.update(overrides)
    return base


def _httpError(code=500):
    return HTTPError(url="https://queue.fal.run/x", code=code, msg="Error", hdrs=None, fp=None)


# --- registry / getProvider ------------------------------------------------------


def test_fal_is_registered_in_providers():
    from lipsync.providers import PROVIDERS

    assert "fal" in PROVIDERS
    assert PROVIDERS["fal"].name == "fal"


def test_get_provider_returns_registered_instance():
    from lipsync.providers import getProvider

    assert getProvider("fal").name == "fal"


def test_get_provider_unknown_raises_typed_error():
    from lipsync.providers import UnknownProviderError, getProvider

    with pytest.raises(UnknownProviderError):
        getProvider("not-a-real-provider")


# --- modelFor ----------------------------------------------------------------------


def test_model_for_returns_canonical_model_per_mode():
    from lipsync.providers.fal import FalProvider, MODE_MODELS

    provider = FalProvider()
    assert provider.modelFor("avatar") == MODE_MODELS["avatar"]
    assert provider.modelFor("relip") == MODE_MODELS["relip"]


def test_model_for_avatar_model_id_matches_fals_real_api_not_the_design_docs_typo():
    """docs/lipsync-design.md and the frontend's statusStyles.ts (display-only,
    never sent to the API) both spell this
    'fal-ai/kling-video/v2/pro/ai-avatar' -- verified against fal's own API
    reference, that ordering 404s. This test pins the CORRECTED id so a
    future refactor can't silently drift back to the wrong one."""
    from lipsync.providers.fal import MODE_MODELS

    assert MODE_MODELS["avatar"] == "fal-ai/kling-video/ai-avatar/v2/pro"


def test_model_for_unknown_mode_raises_validation_error():
    from lipsync.providers.base import ValidationError
    from lipsync.providers.fal import FalProvider

    with pytest.raises(ValidationError):
        FalProvider().modelFor("not-a-mode")


def test_model_for_accepts_matching_override():
    from lipsync.providers.fal import FalProvider, MODE_MODELS

    provider = FalProvider()
    assert provider.modelFor("avatar", override=MODE_MODELS["avatar"]) == MODE_MODELS["avatar"]


def test_model_for_rejects_mismatched_override():
    from lipsync.providers.base import ValidationError
    from lipsync.providers.fal import FalProvider

    with pytest.raises(ValidationError):
        FalProvider().modelFor("avatar", override="some/other-model")


# --- validate ------------------------------------------------------------------------


def test_validate_avatar_requires_image_key():
    from lipsync.providers.base import ValidationError
    from lipsync.providers.fal import FalProvider

    job = _job(mode="avatar")
    job["imageKey"] = ""
    with pytest.raises(ValidationError):
        FalProvider().validate(job)


def test_validate_relip_requires_video_key():
    from lipsync.providers.base import ValidationError
    from lipsync.providers.fal import FalProvider

    job = _job(mode="relip")
    job["videoKey"] = ""
    with pytest.raises(ValidationError):
        FalProvider().validate(job)


def test_validate_requires_audio_key():
    from lipsync.providers.base import ValidationError
    from lipsync.providers.fal import FalProvider

    job = _job(mode="avatar")
    job["audioKey"] = ""
    with pytest.raises(ValidationError):
        FalProvider().validate(job)


def test_validate_unsupported_mode_raises():
    from lipsync.providers.base import ValidationError
    from lipsync.providers.fal import FalProvider

    with pytest.raises(ValidationError):
        FalProvider().validate({"mode": "not-a-mode", "audioKey": "a"})


def test_validate_passes_for_a_well_formed_job_of_either_mode():
    from lipsync.providers.fal import FalProvider

    FalProvider().validate(_job(mode="avatar"))  # must not raise
    FalProvider().validate(_job(mode="relip"))  # must not raise


# --- submit --------------------------------------------------------------------------


@patch("lipsync.providers.fal.getFalApiKey", return_value="test-fal-key")
@patch("lipsync.providers.fal.urlopen")
def test_submit_avatar_posts_image_and_audio_url_with_auth_header(mock_urlopen, mock_key):
    from lipsync.providers.fal import FalProvider

    mock_urlopen.return_value = _mockResponse(
        {"request_id": "req-123", "status_url": "https://queue.fal.run/x/requests/req-123/status"}
    )
    job = _job(mode="avatar")
    inputUrls = {"imageUrl": "https://s3.example/image.jpg", "audioUrl": "https://s3.example/audio.wav"}

    result = FalProvider().submit(job, inputUrls)

    assert result.providerJobId == "req-123"
    assert result.statusUrl == "https://queue.fal.run/x/requests/req-123/status"

    req = mock_urlopen.call_args[0][0]
    assert req.full_url == "https://queue.fal.run/fal-ai/kling-video/ai-avatar/v2/pro"
    assert req.get_header("Authorization") == "Key test-fal-key"
    body = json.loads(req.data.decode("utf-8"))
    assert body == {"image_url": "https://s3.example/image.jpg", "audio_url": "https://s3.example/audio.wav"}


@patch("lipsync.providers.fal.getFalApiKey", return_value="test-fal-key")
@patch("lipsync.providers.fal.urlopen")
def test_submit_relip_posts_video_and_audio_url(mock_urlopen, mock_key):
    from lipsync.providers.fal import FalProvider

    mock_urlopen.return_value = _mockResponse({"request_id": "req-456"})
    job = _job(mode="relip")
    inputUrls = {"videoUrl": "https://s3.example/video.mp4", "audioUrl": "https://s3.example/audio.wav"}

    result = FalProvider().submit(job, inputUrls)

    assert result.providerJobId == "req-456"
    req = mock_urlopen.call_args[0][0]
    assert req.full_url == "https://queue.fal.run/veed/lipsync"
    body = json.loads(req.data.decode("utf-8"))
    assert body == {"video_url": "https://s3.example/video.mp4", "audio_url": "https://s3.example/audio.wav"}


@patch("lipsync.providers.fal.getFalApiKey", return_value="test-fal-key")
@patch("lipsync.providers.fal.urlopen")
def test_submit_http_error_raises_provider_error_with_safe_message(mock_urlopen, mock_key):
    from lipsync.providers.base import ProviderError
    from lipsync.providers.fal import FalProvider

    mock_urlopen.side_effect = _httpError(code=429)
    with pytest.raises(ProviderError) as excInfo:
        FalProvider().submit(_job(), {"imageUrl": "x", "audioUrl": "y"})
    assert "429" in str(excInfo.value)


@patch("lipsync.providers.fal.getFalApiKey", return_value="test-fal-key")
@patch("lipsync.providers.fal.urlopen")
def test_submit_network_error_raises_provider_error(mock_urlopen, mock_key):
    from lipsync.providers.base import ProviderError
    from lipsync.providers.fal import FalProvider

    mock_urlopen.side_effect = URLError("connection refused")
    with pytest.raises(ProviderError):
        FalProvider().submit(_job(), {"imageUrl": "x", "audioUrl": "y"})


@patch("lipsync.providers.fal.getFalApiKey", return_value="test-fal-key")
@patch("lipsync.providers.fal.urlopen")
def test_submit_malformed_json_raises_provider_error(mock_urlopen, mock_key):
    from lipsync.providers.base import ProviderError
    from lipsync.providers.fal import FalProvider

    resp = MagicMock()
    resp.read.return_value = b"not json at all"
    resp.__enter__ = MagicMock(return_value=resp)
    resp.__exit__ = MagicMock(return_value=False)
    mock_urlopen.return_value = resp

    with pytest.raises(ProviderError):
        FalProvider().submit(_job(), {"imageUrl": "x", "audioUrl": "y"})


@patch("lipsync.providers.fal.getFalApiKey", return_value="test-fal-key")
@patch("lipsync.providers.fal.urlopen")
def test_submit_response_missing_request_id_raises_provider_error(mock_urlopen, mock_key):
    from lipsync.providers.base import ProviderError
    from lipsync.providers.fal import FalProvider

    mock_urlopen.return_value = _mockResponse({"status": "IN_QUEUE"})  # no request_id
    with pytest.raises(ProviderError):
        FalProvider().submit(_job(), {"imageUrl": "x", "audioUrl": "y"})


@patch("lipsync.providers.fal.getFalApiKey", return_value="test-fal-key")
@patch("lipsync.providers.fal.urlopen")
def test_submit_secret_not_found_propagates(mock_urlopen, mock_key):
    """submit() must not swallow a missing-credentials error -- runner.py
    is responsible for turning it into a user-safe message, not this layer."""
    from lipsync.secrets import SecretNotFoundError
    from lipsync.providers.fal import FalProvider

    mock_key.side_effect = SecretNotFoundError("SSM parameter not found: x")
    with pytest.raises(SecretNotFoundError):
        FalProvider().submit(_job(), {"imageUrl": "x", "audioUrl": "y"})


# --- checkStatus -----------------------------------------------------------------------


@patch("lipsync.providers.fal.getFalApiKey", return_value="test-fal-key")
@patch("lipsync.providers.fal.urlopen")
@pytest.mark.parametrize("state", ["IN_QUEUE", "IN_PROGRESS"])
def test_check_status_still_running_states_do_not_fetch_result(mock_urlopen, mock_key, state):
    from lipsync.providers.fal import FalProvider

    mock_urlopen.return_value = _mockResponse({"status": state})
    result = FalProvider().checkStatus(_job())

    assert result.state == state
    assert result.outputUrl == ""
    assert mock_urlopen.call_count == 1  # status only, no result fetch


@patch("lipsync.providers.fal.getFalApiKey", return_value="test-fal-key")
@patch("lipsync.providers.fal.urlopen")
def test_check_status_completed_fetches_result_and_extracts_video_url(mock_urlopen, mock_key):
    from lipsync.providers.fal import FalProvider

    mock_urlopen.side_effect = [
        _mockResponse({"status": "COMPLETED"}),
        _mockResponse({"video": {"url": "https://fal.example/output.mp4"}, "duration": 12.3}),
    ]
    result = FalProvider().checkStatus(_job())

    assert result.state == "COMPLETED"
    assert result.outputUrl == "https://fal.example/output.mp4"
    assert mock_urlopen.call_count == 2
    statusReq = mock_urlopen.call_args_list[0][0][0]
    resultReq = mock_urlopen.call_args_list[1][0][0]
    # owner/app prefix ONLY -- the full model id here returns 405 from fal.
    # See test_status_url_uses_owner_app_prefix_not_full_model_id below.
    assert statusReq.full_url == "https://queue.fal.run/fal-ai/kling-video/requests/req-abc/status"
    assert resultReq.full_url == "https://queue.fal.run/fal-ai/kling-video/requests/req-abc"


def test_queue_app_id_truncates_to_owner_and_app():
    """Regression: fal routes queue status/result on the owner/app prefix only.

    A deep model id (fal-ai/kling-video/ai-avatar/v2/pro) submitted fine but
    failed its first poll in staging with HTTP 405, because the poll URL was
    built from the full id. Verified against the live service: the two-segment
    form returns 401 unauthenticated (route exists), the full-path form returns
    405 (route rejects GET). fal's published OpenAPI schema documents the full
    path for all three operations and is wrong.
    """
    from lipsync.providers.fal import FalProvider

    assert FalProvider.queueAppId("fal-ai/kling-video/ai-avatar/v2/pro") == "fal-ai/kling-video"
    # Already two segments -- unchanged. This is why relip never hit the bug.
    assert FalProvider.queueAppId("veed/lipsync") == "veed/lipsync"
    assert FalProvider.queueAppId("owner/app/extra") == "owner/app"
    # Tolerate stray slashes rather than emitting a URL with an empty segment.
    assert FalProvider.queueAppId("/fal-ai/kling-video/ai-avatar/") == "fal-ai/kling-video"


@patch("lipsync.providers.fal.getFalApiKey", return_value="test-fal-key")
@patch("lipsync.providers.fal.urlopen")
def test_submit_uses_full_model_id_while_status_uses_prefix(mock_urlopen, mock_key):
    """The two URLs are deliberately different shapes -- pin both together so a
    future refactor can't quietly unify them back into the broken form."""
    mock_urlopen.side_effect = [
        _mockResponse({"request_id": "req-xyz"}),
        _mockResponse({"status": "IN_QUEUE"}),
    ]
    from lipsync.providers.fal import FalProvider

    inputUrls = {"imageUrl": "https://s3.example/image.jpg", "audioUrl": "https://s3.example/audio.wav"}
    provider = FalProvider()
    provider.submit(_job(), inputUrls)
    provider.checkStatus(_job(providerJobId="req-xyz"))

    submitUrl = mock_urlopen.call_args_list[0][0][0].full_url
    statusUrl = mock_urlopen.call_args_list[1][0][0].full_url
    assert submitUrl == "https://queue.fal.run/fal-ai/kling-video/ai-avatar/v2/pro"
    assert statusUrl == "https://queue.fal.run/fal-ai/kling-video/requests/req-xyz/status"


@patch("lipsync.providers.fal.getFalApiKey", return_value="test-fal-key")
@patch("lipsync.providers.fal.urlopen")
def test_check_status_completed_but_result_missing_video_url_is_failed(mock_urlopen, mock_key):
    from lipsync.providers.fal import FalProvider

    mock_urlopen.side_effect = [
        _mockResponse({"status": "COMPLETED"}),
        _mockResponse({"video": {}}),
    ]
    result = FalProvider().checkStatus(_job())
    assert result.state == "FAILED"
    assert "video.url" in result.error


@patch("lipsync.providers.fal.getFalApiKey", return_value="test-fal-key")
@patch("lipsync.providers.fal.urlopen")
def test_check_status_veed_lipsync_completed_without_duration_field_still_works(mock_urlopen, mock_key):
    """veed/lipsync's documented result shape omits `duration` (unlike the
    avatar model) -- checkStatus must not depend on it; runner.py
    re-measures duration from the copied output instead."""
    from lipsync.providers.fal import FalProvider

    mock_urlopen.side_effect = [
        _mockResponse({"status": "COMPLETED"}),
        _mockResponse({"video": {"url": "https://fal.example/relip-output.mp4"}}),
    ]
    result = FalProvider().checkStatus(_job(mode="relip"))
    assert result.state == "COMPLETED"
    assert result.outputUrl == "https://fal.example/relip-output.mp4"


@patch("lipsync.providers.fal.getFalApiKey", return_value="test-fal-key")
@patch("lipsync.providers.fal.urlopen")
def test_check_status_failed_state(mock_urlopen, mock_key):
    from lipsync.providers.fal import FalProvider

    mock_urlopen.return_value = _mockResponse({"status": "FAILED", "error": "model error"})
    result = FalProvider().checkStatus(_job())
    assert result.state == "FAILED"


@patch("lipsync.providers.fal.getFalApiKey", return_value="test-fal-key")
@patch("lipsync.providers.fal.urlopen")
def test_check_status_malformed_response_is_failed_not_an_exception(mock_urlopen, mock_key):
    from lipsync.providers.fal import FalProvider

    resp = MagicMock()
    resp.read.return_value = b"{not valid json"
    resp.__enter__ = MagicMock(return_value=resp)
    resp.__exit__ = MagicMock(return_value=False)
    mock_urlopen.return_value = resp

    result = FalProvider().checkStatus(_job())  # must not raise
    assert result.state == "FAILED"
    assert result.error


@patch("lipsync.providers.fal.getFalApiKey", return_value="test-fal-key")
@patch("lipsync.providers.fal.urlopen")
def test_check_status_unrecognised_status_string_is_failed(mock_urlopen, mock_key):
    from lipsync.providers.fal import FalProvider

    mock_urlopen.return_value = _mockResponse({"status": "SOMETHING_NEW_FAL_ADDED"})
    result = FalProvider().checkStatus(_job())
    assert result.state == "FAILED"
    assert "SOMETHING_NEW_FAL_ADDED" in result.error


@patch("lipsync.providers.fal.getFalApiKey", return_value="test-fal-key")
@patch("lipsync.providers.fal.urlopen")
def test_check_status_http_error_is_failed_not_an_exception(mock_urlopen, mock_key):
    from lipsync.providers.fal import FalProvider

    mock_urlopen.side_effect = _httpError(code=500)
    result = FalProvider().checkStatus(_job())  # must not raise
    assert result.state == "FAILED"


def test_check_status_missing_provider_job_id_is_failed_without_any_http_call():
    from lipsync.providers.fal import FalProvider

    job = _job()
    job["providerJobId"] = ""
    with patch("lipsync.providers.fal.urlopen") as mock_urlopen:
        result = FalProvider().checkStatus(job)

    assert result.state == "FAILED"
    mock_urlopen.assert_not_called()


# --- safe error stringification: never echo response bodies or the key -----------------


def test_safe_err_str_never_reads_the_http_error_body():
    from lipsync.providers.fal import FalProvider

    err = _httpError(code=403)
    err.read = MagicMock(side_effect=AssertionError("must never read the response body"))
    msg = FalProvider._safeErrStr(err)
    assert "403" in msg
    err.read.assert_not_called()
