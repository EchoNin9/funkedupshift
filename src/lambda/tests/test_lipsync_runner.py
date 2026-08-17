"""Unit tests for lipsync/runner.py (submitJob/checkJob, the poll worker).
storage/scheduling/media/alerts/getProvider are all mocked, matching the
patch.object conventions used elsewhere in this repo (see
test_social_publisher.py)."""
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lipsync import runner, storage  # noqa: E402
from lipsync.providers.base import (  # noqa: E402
    STATE_COMPLETED,
    STATE_FAILED,
    STATE_IN_PROGRESS,
    STATE_IN_QUEUE,
    LipsyncProvider,
    ProviderError,
    StatusResult,
    SubmitResult,
    ValidationError,
)


def _job(jobId="job1", status=storage.STATUS_QUEUED, mode="avatar", **overrides):
    base = {
        "jobId": jobId, "mode": mode, "status": status, "provider": "fal",
        "model": "fal-ai/kling-video/ai-avatar/v2/pro",
        "audioKey": "uploads/u/audio/a.wav", "imageKey": "uploads/u/image/i.jpg", "videoKey": "",
        "providerJobId": "", "checkCount": 0,
    }
    base.update(overrides)
    return base


def _statefulTransition(job):
    """A transitionStatus side_effect that actually mutates `job` in place
    (like the real conditional write would persist), so a SUBSEQUENT
    storage.getJob(...) call in the same test (checkJob re-reads the job at
    its own start) observes the new status -- a plain
    `return_value=True`/static fixture can't express "the write really
    happened", which matters whenever a test exercises submitJob's inline
    call into checkJob."""

    def _sideEffect(jobId, fromStatus, toStatus, **fields):
        if job["status"] != fromStatus:
            return False
        job["status"] = toStatus
        job.update(fields)
        return True

    return _sideEffect


# --- backoffSeconds ----------------------------------------------------------------


def test_backoff_seconds_documented_sequence():
    assert [runner.backoffSeconds(n) for n in range(1, 8)] == [15, 15, 30, 30, 60, 60, 120]


def test_backoff_seconds_repeats_120_forever_after_the_seventh_step():
    assert runner.backoffSeconds(8) == 120
    assert runner.backoffSeconds(25) == 120
    assert runner.backoffSeconds(1000) == 120


# --- submitJob: happy path --------------------------------------------------------


def test_submit_job_happy_path_moves_to_processing_and_runs_first_check_inline():
    job = _job(status=storage.STATUS_QUEUED)
    fakeProvider = MagicMock()
    fakeProvider.submit.return_value = SubmitResult(providerJobId="req-1", statusUrl="https://x/status")
    fakeProvider.checkStatus.return_value = StatusResult(state=STATE_IN_QUEUE)

    with patch.object(storage, "getJob", return_value=job), \
         patch.object(storage, "transitionStatus", side_effect=_statefulTransition(job)) as mockTransition, \
         patch.object(runner, "getProvider", return_value=fakeProvider), \
         patch.object(runner, "_buildInputUrls", return_value={"imageUrl": "x", "audioUrl": "y"}), \
         patch.object(runner.scheduling, "createCheck", return_value={"immediate": False, "scheduleName": "s1"}):
        result = runner.submitJob("job1")

    # queued->submitting, then submitting->processing, then the
    # processing->processing self-transition inside checkJob's still-running path.
    calls = [c.args[:3] for c in mockTransition.call_args_list]
    assert ("job1", storage.STATUS_QUEUED, storage.STATUS_SUBMITTING) in calls
    assert ("job1", storage.STATUS_SUBMITTING, storage.STATUS_PROCESSING) in calls
    fakeProvider.submit.assert_called_once()
    fakeProvider.checkStatus.assert_called_once()
    assert result["ok"] is True


def test_submit_job_not_found_returns_error_no_raise():
    with patch.object(storage, "getJob", return_value=None):
        result = runner.submitJob("missing")
    assert result["ok"] is False


def test_submit_job_duplicate_invocation_loses_the_claim_race_no_provider_call():
    """The job is no longer `queued` (already claimed by a live invocation,
    or cancelled) -- the conditional write fails, and submit() must never
    be called: this is the double-submit guard."""
    job = _job(status=storage.STATUS_SUBMITTING)
    fakeProvider = MagicMock()

    with patch.object(storage, "getJob", return_value=job), \
         patch.object(storage, "transitionStatus", return_value=False), \
         patch.object(runner, "getProvider", return_value=fakeProvider):
        result = runner.submitJob("job1")

    fakeProvider.submit.assert_not_called()
    assert result["skipped"] is True


def test_submit_job_provider_failure_marks_failed_with_safe_error_and_alerts():
    job = _job(status=storage.STATUS_QUEUED)
    fakeProvider = MagicMock()
    fakeProvider.submit.side_effect = ProviderError("HTTP 429 contacting fal.ai")

    with patch.object(storage, "getJob", return_value=job), \
         patch.object(storage, "transitionStatus", return_value=True) as mockTransition, \
         patch.object(runner, "getProvider", return_value=fakeProvider), \
         patch.object(runner, "_buildInputUrls", return_value={}), \
         patch.object(runner.alerts, "sendAlert") as mockAlert:
        result = runner.submitJob("job1")

    lastCall = mockTransition.call_args_list[-1]
    assert lastCall.args[:3] == ("job1", storage.STATUS_SUBMITTING, storage.STATUS_FAILED)
    assert lastCall.kwargs["error"] == "HTTP 429 contacting fal.ai"
    mockAlert.assert_called_once()
    assert result["ok"] is False


def test_submit_job_secret_not_found_uses_generic_safe_message_not_raw_text():
    from lipsync.secrets import SecretNotFoundError

    job = _job(status=storage.STATUS_QUEUED)
    fakeProvider = MagicMock()
    fakeProvider.submit.side_effect = SecretNotFoundError("SSM parameter not found: /funkedupshift/lipsync/fal/api-key")

    with patch.object(storage, "getJob", return_value=job), \
         patch.object(storage, "transitionStatus", return_value=True) as mockTransition, \
         patch.object(runner, "getProvider", return_value=fakeProvider), \
         patch.object(runner, "_buildInputUrls", return_value={}), \
         patch.object(runner.alerts, "sendAlert"):
        runner.submitJob("job1")

    lastCall = mockTransition.call_args_list[-1]
    errorMessage = lastCall.kwargs["error"]
    assert "/funkedupshift/lipsync/fal/api-key" not in errorMessage
    assert "SSM" not in errorMessage
    assert "administrator" in errorMessage.lower()


def test_submit_job_cancelled_mid_submit_does_not_start_polling():
    """submit() succeeded, but the user cancelled in the gap before the
    submitting->processing write -- that write must lose (cancel wins), and
    checkJob must never be invoked for a job that isn't `processing`."""
    job = _job(status=storage.STATUS_QUEUED)
    fakeProvider = MagicMock()
    fakeProvider.submit.return_value = SubmitResult(providerJobId="req-1")

    def _transitionSideEffect(jobId, fromStatus, toStatus, **fields):
        if fromStatus == storage.STATUS_QUEUED:
            return True
        if fromStatus == storage.STATUS_SUBMITTING and toStatus == storage.STATUS_PROCESSING:
            return False  # lost the race -- cancelled in the meantime
        return True

    with patch.object(storage, "getJob", return_value=job), \
         patch.object(storage, "transitionStatus", side_effect=_transitionSideEffect), \
         patch.object(runner, "getProvider", return_value=fakeProvider), \
         patch.object(runner, "_buildInputUrls", return_value={}), \
         patch.object(runner, "checkJob") as mockCheckJob:
        result = runner.submitJob("job1")

    mockCheckJob.assert_not_called()
    assert result["skipped"] is True
    assert result["reason"] == "cancelled mid-submit"


# --- checkJob: guard clauses -------------------------------------------------------


def test_check_job_not_found_returns_error_no_raise():
    with patch.object(storage, "getJob", return_value=None):
        result = runner.checkJob("missing", 1)
    assert result["ok"] is False


def test_check_job_not_processing_is_a_harmless_skip_no_provider_call():
    """Covers "cancel wins, no resurrection": a duplicate/late check
    schedule firing for a job that's no longer `processing` (cancelled, or
    already resolved by another invocation) must never call the provider."""
    job = _job(status=storage.STATUS_CANCELLED)
    fakeProvider = MagicMock()
    with patch.object(storage, "getJob", return_value=job), \
         patch.object(runner, "getProvider", return_value=fakeProvider):
        result = runner.checkJob("job1", 3)

    fakeProvider.checkStatus.assert_not_called()
    assert result["skipped"] is True
    assert result["status"] == storage.STATUS_CANCELLED


# --- checkJob: still running / backoff / MAX_CHECKS ---------------------------------


@pytest.mark.parametrize("state", [STATE_IN_QUEUE, STATE_IN_PROGRESS])
def test_check_job_still_running_reschedules_with_next_backoff_interval(state):
    job = _job(status=storage.STATUS_PROCESSING)
    fakeProvider = MagicMock()
    fakeProvider.checkStatus.return_value = StatusResult(state=state)

    with patch.object(storage, "getJob", return_value=job), \
         patch.object(storage, "transitionStatus", return_value=True), \
         patch.object(runner, "getProvider", return_value=fakeProvider), \
         patch.object(runner.scheduling, "createCheck", return_value={"immediate": False, "scheduleName": "s"}) as mockCreate:
        result = runner.checkJob("job1", 2)

    # checkCount=2 -> nextCheckCount=3 -> backoffSeconds(3) == 30s.
    assert mockCreate.call_args.args[0] == "job1"
    assert mockCreate.call_args.args[2] == 3
    assert result["status"] == storage.STATUS_PROCESSING
    assert result["scheduled"] is True


def test_check_job_still_running_immediate_schedule_loops_in_process():
    """A sub-60s backoff step -- createCheck reports immediate=True, so
    checkJob must perform the NEXT check itself (in-process), not just
    report 'scheduled'."""
    job = _job(status=storage.STATUS_PROCESSING)
    fakeProvider = MagicMock()
    fakeProvider.checkStatus.side_effect = [
        StatusResult(state=STATE_IN_QUEUE),  # check 1
        StatusResult(state=STATE_COMPLETED, outputUrl="https://fal.example/out.mp4"),  # check 2
    ]

    with patch.object(storage, "getJob", return_value=job), \
         patch.object(storage, "transitionStatus", return_value=True), \
         patch.object(runner, "getProvider", return_value=fakeProvider), \
         patch.object(runner.scheduling, "createCheck", return_value={"immediate": True, "scheduleName": None}), \
         patch.object(runner, "_copyOutput", return_value=("outputs/job1/job1.mp4", 12.0)):
        result = runner.checkJob("job1", 1)

    assert fakeProvider.checkStatus.call_count == 2
    assert result["status"] == storage.STATUS_COMPLETED


def test_check_job_max_checks_ceiling_marks_failed_without_scheduling_a_26th_check():
    job = _job(status=storage.STATUS_PROCESSING)
    fakeProvider = MagicMock()
    fakeProvider.checkStatus.return_value = StatusResult(state=STATE_IN_PROGRESS)

    with patch.object(storage, "getJob", return_value=job), \
         patch.object(storage, "transitionStatus", return_value=True) as mockTransition, \
         patch.object(runner, "getProvider", return_value=fakeProvider), \
         patch.object(runner.scheduling, "createCheck") as mockCreate, \
         patch.object(runner.alerts, "sendAlert") as mockAlert:
        result = runner.checkJob("job1", runner.MAX_CHECKS)

    mockCreate.assert_not_called()  # never attempts a 26th check
    lastCall = mockTransition.call_args_list[-1]
    assert lastCall.args[:3] == ("job1", storage.STATUS_PROCESSING, storage.STATUS_FAILED)
    assert "time" in lastCall.kwargs["error"].lower()
    mockAlert.assert_called_once()
    assert result["status"] == storage.STATUS_FAILED
    assert result["reason"] == "timeout"


def test_check_job_below_max_checks_does_not_time_out():
    job = _job(status=storage.STATUS_PROCESSING)
    fakeProvider = MagicMock()
    fakeProvider.checkStatus.return_value = StatusResult(state=STATE_IN_PROGRESS)

    with patch.object(storage, "getJob", return_value=job), \
         patch.object(storage, "transitionStatus", return_value=True), \
         patch.object(runner, "getProvider", return_value=fakeProvider), \
         patch.object(runner.scheduling, "createCheck", return_value={"immediate": False, "scheduleName": "s"}), \
         patch.object(runner.alerts, "sendAlert") as mockAlert:
        result = runner.checkJob("job1", runner.MAX_CHECKS - 1)

    mockAlert.assert_not_called()
    assert result["status"] == storage.STATUS_PROCESSING


def test_check_job_self_transition_cancelled_mid_check_stops_without_scheduling():
    """The job was cancelled in the narrow window between checkStatus()
    returning 'still running' and the processing->processing bookkeeping
    write -- that write must lose, and no next check may be scheduled."""
    job = _job(status=storage.STATUS_PROCESSING)
    fakeProvider = MagicMock()
    fakeProvider.checkStatus.return_value = StatusResult(state=STATE_IN_PROGRESS)

    with patch.object(storage, "getJob", return_value=job), \
         patch.object(storage, "transitionStatus", return_value=False), \
         patch.object(runner, "getProvider", return_value=fakeProvider), \
         patch.object(runner.scheduling, "createCheck") as mockCreate:
        result = runner.checkJob("job1", 2)

    mockCreate.assert_not_called()
    assert result["skipped"] is True


# --- checkJob: completed -----------------------------------------------------------


def test_check_job_completed_copies_output_sets_fields_and_removes_status_key():
    job = _job(status=storage.STATUS_PROCESSING)
    fakeProvider = MagicMock()
    fakeProvider.checkStatus.return_value = StatusResult(state=STATE_COMPLETED, outputUrl="https://fal.example/out.mp4")

    with patch.object(storage, "getJob", return_value=job), \
         patch.object(storage, "transitionStatus", return_value=True) as mockTransition, \
         patch.object(runner, "getProvider", return_value=fakeProvider), \
         patch.object(runner, "_copyOutput", return_value=("outputs/job1/job1.mp4", 14.2)) as mockCopy:
        result = runner.checkJob("job1", 3)

    mockCopy.assert_called_once_with("job1", "https://fal.example/out.mp4")
    lastCall = mockTransition.call_args_list[-1]
    assert lastCall.args[:3] == ("job1", storage.STATUS_PROCESSING, storage.STATUS_COMPLETED)
    assert lastCall.kwargs == {"outputKey": "outputs/job1/job1.mp4", "durationSec": 14.2}
    assert result["status"] == storage.STATUS_COMPLETED


def test_check_job_completed_output_copy_fails_lands_in_failed_not_stuck():
    """Edge case: 'fal returns COMPLETED but the output download fails ->
    job must land in failed, not hang in processing forever.'"""
    job = _job(status=storage.STATUS_PROCESSING)
    fakeProvider = MagicMock()
    fakeProvider.checkStatus.return_value = StatusResult(state=STATE_COMPLETED, outputUrl="https://fal.example/out.mp4")

    with patch.object(storage, "getJob", return_value=job), \
         patch.object(storage, "transitionStatus", return_value=True) as mockTransition, \
         patch.object(runner, "getProvider", return_value=fakeProvider), \
         patch.object(runner, "_copyOutput", side_effect=RuntimeError("S3 put failed")), \
         patch.object(runner.alerts, "sendAlert") as mockAlert:
        result = runner.checkJob("job1", 3)

    lastCall = mockTransition.call_args_list[-1]
    assert lastCall.args[:3] == ("job1", storage.STATUS_PROCESSING, storage.STATUS_FAILED)
    assert lastCall.kwargs["error"]  # a user-safe message, not the raw RuntimeError text
    assert "S3 put failed" not in lastCall.kwargs["error"]
    mockAlert.assert_called_once()
    assert result["status"] == storage.STATUS_FAILED


def test_check_job_completed_but_cancelled_before_write_lands_does_not_resurrect():
    job = _job(status=storage.STATUS_PROCESSING)
    fakeProvider = MagicMock()
    fakeProvider.checkStatus.return_value = StatusResult(state=STATE_COMPLETED, outputUrl="https://fal.example/out.mp4")

    with patch.object(storage, "getJob", return_value=job), \
         patch.object(storage, "transitionStatus", return_value=False), \
         patch.object(runner, "getProvider", return_value=fakeProvider), \
         patch.object(runner, "_copyOutput", return_value=("outputs/job1/job1.mp4", 1.0)):
        result = runner.checkJob("job1", 3)

    assert result["skipped"] is True


def test_check_job_completed_omits_duration_field_when_unmeasurable():
    """probeDurationSeconds can legitimately return None -- durationSec must
    be omitted from the write entirely rather than passed through as None
    (DynamoDB numeric attributes shouldn't carry a null placeholder here,
    see storage.py's createJob docstring on the same convention)."""
    job = _job(status=storage.STATUS_PROCESSING)
    fakeProvider = MagicMock()
    fakeProvider.checkStatus.return_value = StatusResult(state=STATE_COMPLETED, outputUrl="https://fal.example/out.mp4")

    with patch.object(storage, "getJob", return_value=job), \
         patch.object(storage, "transitionStatus", return_value=True) as mockTransition, \
         patch.object(runner, "getProvider", return_value=fakeProvider), \
         patch.object(runner, "_copyOutput", return_value=("outputs/job1/job1.mp4", None)):
        runner.checkJob("job1", 3)

    lastCall = mockTransition.call_args_list[-1]
    assert "durationSec" not in lastCall.kwargs
    assert lastCall.kwargs["outputKey"] == "outputs/job1/job1.mp4"


# --- checkJob: failed ----------------------------------------------------------------


def test_check_job_failed_state_marks_job_failed_with_providers_error():
    job = _job(status=storage.STATUS_PROCESSING)
    fakeProvider = MagicMock()
    fakeProvider.checkStatus.return_value = StatusResult(state=STATE_FAILED, error="model rejected the input")

    with patch.object(storage, "getJob", return_value=job), \
         patch.object(storage, "transitionStatus", return_value=True) as mockTransition, \
         patch.object(runner, "getProvider", return_value=fakeProvider), \
         patch.object(runner.alerts, "sendAlert") as mockAlert:
        result = runner.checkJob("job1", 3)

    lastCall = mockTransition.call_args_list[-1]
    assert lastCall.args[:3] == ("job1", storage.STATUS_PROCESSING, storage.STATUS_FAILED)
    assert lastCall.kwargs["error"] == "model rejected the input"
    mockAlert.assert_called_once()
    assert result["status"] == storage.STATUS_FAILED


def test_check_job_checkstatus_raises_marks_failed_with_safe_message():
    job = _job(status=storage.STATUS_PROCESSING)
    fakeProvider = MagicMock()
    fakeProvider.checkStatus.side_effect = RuntimeError("boom")

    with patch.object(storage, "getJob", return_value=job), \
         patch.object(storage, "transitionStatus", return_value=True) as mockTransition, \
         patch.object(runner, "getProvider", return_value=fakeProvider), \
         patch.object(runner.alerts, "sendAlert"):
        result = runner.checkJob("job1", 3)

    lastCall = mockTransition.call_args_list[-1]
    assert lastCall.args[:3] == ("job1", storage.STATUS_PROCESSING, storage.STATUS_FAILED)
    assert "boom" not in lastCall.kwargs["error"]
    assert result["ok"] is False


# --- Lambda entrypoint dispatch -----------------------------------------------------


def test_handler_dispatches_submit_when_job_key_absent():
    with patch.object(runner, "submitJob", return_value={"ok": True}) as mockSubmit, \
         patch.object(runner, "checkJob") as mockCheck:
        result = runner.handler({"jobId": "job1"}, None)

    mockSubmit.assert_called_once_with("job1")
    mockCheck.assert_not_called()
    assert result == {"ok": True}


def test_handler_dispatches_check_when_job_is_check():
    with patch.object(runner, "checkJob", return_value={"ok": True}) as mockCheck, \
         patch.object(runner, "submitJob") as mockSubmit:
        result = runner.handler({"jobId": "job1", "job": "check", "checkCount": 5}, None)

    mockCheck.assert_called_once_with("job1", 5)
    mockSubmit.assert_not_called()
    assert result == {"ok": True}


def test_handler_missing_job_id_returns_error_no_raise():
    result = runner.handler({}, None)
    assert result["ok"] is False


def test_handler_unhandled_exception_is_caught_and_alerted():
    with patch.object(runner, "submitJob", side_effect=RuntimeError("kaboom")), \
         patch.object(runner.alerts, "sendAlert") as mockAlert:
        result = runner.handler({"jobId": "job1"}, None)  # must not raise

    assert result["ok"] is False
    mockAlert.assert_called_once()


# --- Provider ABC: a second provider works without touching runner.py --------------


class _FakeProvider(LipsyncProvider):
    """A minimal second provider, used only to prove runner.py never
    hardcodes anything fal-specific -- it only ever calls the ABC's
    modelFor/validate/submit/checkStatus methods via getProvider()."""

    name = "fake"
    supportedModes = frozenset({"avatar", "relip"})

    def modelFor(self, mode, override=None):
        if mode not in self.supportedModes:
            raise ValidationError(f"unsupported mode {mode!r}")
        return f"fake-model-{mode}"

    def validate(self, job):
        if not job.get("audioKey"):
            raise ValidationError("audioKey is required")

    def submit(self, job, inputUrls):
        return SubmitResult(providerJobId="fake-req-1")

    def checkStatus(self, job):
        return StatusResult(state=STATE_COMPLETED, outputUrl="https://fake.example/output.mp4")


def test_a_second_provider_can_be_registered_and_used_by_submit_and_check_without_touching_runner():
    job = _job(status=storage.STATUS_QUEUED, provider="fake")
    fakeInstance = _FakeProvider()

    with patch.object(storage, "getJob", return_value=job), \
         patch.object(storage, "transitionStatus", side_effect=_statefulTransition(job)), \
         patch.object(runner, "getProvider", return_value=fakeInstance), \
         patch.object(runner, "_buildInputUrls", return_value={}), \
         patch.object(runner, "_copyOutput", return_value=("outputs/job1/job1.mp4", 3.0)):
        result = runner.submitJob("job1")

    assert result["ok"] is True
    assert result["status"] == storage.STATUS_COMPLETED
