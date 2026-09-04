"""Unit tests for lipsync/maintenance.py (reconciliation sweep + daily
heartbeat). storage/runner/alerts are all mocked. Mirrors
social/maintenance.py's test conventions (test_social_maintenance.py)."""
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lipsync import alerts, maintenance, runner, storage  # noqa: E402


def _stuckJob(jobId="job1", status="queued", checkCount=0):
    return {"jobId": jobId, "status": status, "checkCount": checkCount}


def _counts(**overrides):
    base = {s: 0 for s in storage.ALL_STATUSES}
    base.update(overrides)
    return base


# --- reconcile: per-status recovery dispatch ----------------------------------------


def test_reconcile_resumes_stuck_queued_job_via_submit_job():
    stuck = [_stuckJob("job1", status="queued")]
    with patch.object(storage, "findStuckJobs", return_value=stuck) as mockFind, \
         patch.object(runner, "submitJob") as mockSubmit, \
         patch.object(storage, "countByStatus", return_value=_counts()), \
         patch.object(alerts, "sendAlert") as mockAlert, \
         patch.object(alerts, "sendHeartbeat"):
        result = maintenance._reconcile()

    mockFind.assert_called_once_with(maintenance.DEFAULT_GRACE_MINUTES)
    mockSubmit.assert_called_once_with("job1")
    assert result["resumedQueued"] == ["job1"]
    mockAlert.assert_called_once()  # "stuck jobs resumed" summary


def test_reconcile_resumes_stuck_submitting_job_by_resetting_then_submitting():
    stuck = [_stuckJob("job2", status="submitting")]
    with patch.object(storage, "findStuckJobs", return_value=stuck), \
         patch.object(storage, "resetStuckSubmitting", return_value=True) as mockReset, \
         patch.object(runner, "submitJob") as mockSubmit, \
         patch.object(storage, "countByStatus", return_value=_counts()), \
         patch.object(alerts, "sendAlert"), \
         patch.object(alerts, "sendHeartbeat"):
        result = maintenance._reconcile()

    mockReset.assert_called_once_with("job2")
    mockSubmit.assert_called_once_with("job2")
    assert result["resumedSubmitting"] == ["job2"]


def test_reconcile_stuck_submitting_reset_race_lost_does_not_resubmit():
    """A live invocation resolved the job between findStuckJobs and the
    reset attempt -- resetStuckSubmitting's own conditional write loses
    that race, and the sweep must not then force a submit anyway."""
    stuck = [_stuckJob("job2", status="submitting")]
    with patch.object(storage, "findStuckJobs", return_value=stuck), \
         patch.object(storage, "resetStuckSubmitting", return_value=False), \
         patch.object(runner, "submitJob") as mockSubmit, \
         patch.object(storage, "countByStatus", return_value=_counts()), \
         patch.object(alerts, "sendAlert") as mockAlert, \
         patch.object(alerts, "sendHeartbeat"):
        result = maintenance._reconcile()

    mockSubmit.assert_not_called()
    assert result["resumedSubmitting"] == []
    mockAlert.assert_not_called()  # nothing was actually resumed


def test_reconcile_resumes_stuck_processing_job_via_check_job_from_its_check_count():
    stuck = [_stuckJob("job3", status="processing", checkCount=7)]
    with patch.object(storage, "findStuckJobs", return_value=stuck), \
         patch.object(runner, "checkJob") as mockCheck, \
         patch.object(storage, "countByStatus", return_value=_counts()), \
         patch.object(alerts, "sendAlert"), \
         patch.object(alerts, "sendHeartbeat"):
        result = maintenance._reconcile()

    mockCheck.assert_called_once_with("job3", 7)
    assert result["resumedProcessing"] == ["job3"]


def test_reconcile_stuck_processing_job_missing_check_count_defaults_to_one():
    stuck = [{"jobId": "job4", "status": "processing"}]  # no checkCount key at all
    with patch.object(storage, "findStuckJobs", return_value=stuck), \
         patch.object(runner, "checkJob") as mockCheck, \
         patch.object(storage, "countByStatus", return_value=_counts()), \
         patch.object(alerts, "sendAlert"), \
         patch.object(alerts, "sendHeartbeat"):
        maintenance._reconcile()

    mockCheck.assert_called_once_with("job4", 1)


def test_reconcile_handles_a_mix_of_all_three_stuck_statuses_in_one_sweep():
    stuck = [
        _stuckJob("q1", status="queued"),
        _stuckJob("s1", status="submitting"),
        _stuckJob("p1", status="processing", checkCount=2),
    ]
    with patch.object(storage, "findStuckJobs", return_value=stuck), \
         patch.object(storage, "resetStuckSubmitting", return_value=True), \
         patch.object(runner, "submitJob") as mockSubmit, \
         patch.object(runner, "checkJob") as mockCheck, \
         patch.object(storage, "countByStatus", return_value=_counts()), \
         patch.object(alerts, "sendAlert"), \
         patch.object(alerts, "sendHeartbeat"):
        result = maintenance._reconcile()

    assert result["resumedQueued"] == ["q1"]
    assert result["resumedSubmitting"] == ["s1"]
    assert result["resumedProcessing"] == ["p1"]
    assert result["resumed"] == ["q1", "s1", "p1"]
    assert mockSubmit.call_count == 2  # q1 (direct) + s1 (after reset)
    mockCheck.assert_called_once_with("p1", 2)


# --- reconcile: nothing stuck -> no alert, heartbeat still sent ---------------------


def test_reconcile_nothing_stuck_no_alert_but_heartbeat_still_sent():
    with patch.object(storage, "findStuckJobs", return_value=[]), \
         patch.object(storage, "countByStatus", return_value=_counts()), \
         patch.object(alerts, "sendAlert") as mockAlert, \
         patch.object(alerts, "sendHeartbeat") as mockHeartbeat:
        result = maintenance._reconcile()

    mockAlert.assert_not_called()
    mockHeartbeat.assert_called_once()
    assert result["resumed"] == []


def test_reconcile_passes_grace_minutes_default_to_storage():
    with patch.object(storage, "findStuckJobs", return_value=[]) as mockFind, \
         patch.object(storage, "countByStatus", return_value=_counts()), \
         patch.object(alerts, "sendHeartbeat"):
        maintenance._reconcile()

    mockFind.assert_called_once_with(maintenance.DEFAULT_GRACE_MINUTES)


# --- heartbeat content -----------------------------------------------------------------


def test_heartbeat_message_includes_every_status_count():
    counts = _counts(queued=1, submitting=0, processing=2, completed=9, failed=1, cancelled=3)
    with patch.object(storage, "findStuckJobs", return_value=[]), \
         patch.object(storage, "countByStatus", return_value=counts), \
         patch.object(alerts, "sendHeartbeat") as mockHeartbeat:
        maintenance._reconcile()

    message = mockHeartbeat.call_args.args[1]
    assert "queued=1" in message
    assert "processing=2" in message
    assert "completed=9" in message
    assert "failed=1" in message
    assert "cancelled=3" in message


def test_heartbeat_message_includes_stuck_resumed_count():
    stuck = [_stuckJob("job1", status="queued")]
    with patch.object(storage, "findStuckJobs", return_value=stuck), \
         patch.object(runner, "submitJob"), \
         patch.object(storage, "countByStatus", return_value=_counts()), \
         patch.object(alerts, "sendAlert"), \
         patch.object(alerts, "sendHeartbeat") as mockHeartbeat:
        maintenance._reconcile()

    message = mockHeartbeat.call_args.args[1]
    assert "stuck_resumed=1" in message


def test_heartbeat_is_sent_even_when_recovery_raises_nothing_but_finds_zero():
    """Restates the design doc's requirement explicitly: 'publishes ...
    heartbeat whether or not anything was found -- operational silence
    must itself be visible.'"""
    with patch.object(storage, "findStuckJobs", return_value=[]), \
         patch.object(storage, "countByStatus", return_value=_counts()), \
         patch.object(alerts, "sendHeartbeat") as mockHeartbeat:
        maintenance._reconcile()

    mockHeartbeat.assert_called_once()


# --- handler dispatch ----------------------------------------------------------------


def test_handler_dispatches_reconcile_job():
    with patch.object(maintenance, "_reconcile", return_value={"ok": True}) as mockReconcile:
        result = maintenance.handler({"job": "reconcile"}, None)

    mockReconcile.assert_called_once()
    assert result == {"ok": True}


def test_handler_defaults_to_reconcile_when_job_omitted():
    with patch.object(maintenance, "_reconcile", return_value={"ok": True}) as mockReconcile:
        maintenance.handler({}, None)

    mockReconcile.assert_called_once()


def test_handler_unknown_job_returns_error_no_raise():
    result = maintenance.handler({"job": "not-a-real-job"}, None)
    assert result["ok"] is False
