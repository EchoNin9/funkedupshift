"""Unit tests for social/maintenance.py (reconciliation sweep + daily
heartbeat, phase 2). storage/publisher/alerts are all mocked."""
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _overdueParent(postId="post1"):
    return {"PK": f"POST#{postId}", "SK": "META", "postId": postId, "status": "pending"}


def _target(platform="bluesky", accountId="acct-a", status="pending", attemptCount=0, lastError=""):
    return {
        "platform": platform, "accountId": accountId, "status": status,
        "attemptCount": attemptCount, "lastError": lastError,
    }


def _heartbeatCounts(pending=0, publishedLast24h=0, failed=0):
    return {"pending": pending, "publishedLast24h": publishedLast24h, "failed": failed}


# --- reconcile: retries an overdue-but-under-cap post -------------------------------


def test_reconcile_finds_overdue_pending_target_and_retries_it():
    from social import alerts, maintenance, publisher, storage

    overdue = [_overdueParent("post1")]
    post = {"parent": _overdueParent("post1"), "targets": [_target(attemptCount=0)]}

    with patch.object(storage, "findOverduePending", return_value=overdue), \
         patch.object(storage, "getPost", return_value=post), \
         patch.object(publisher, "processPost") as mockProcessPost, \
         patch.object(storage, "countHeartbeat", return_value=_heartbeatCounts()), \
         patch.object(alerts, "sendAlert") as mockAlert, \
         patch.object(alerts, "sendHeartbeat"):
        result = maintenance._reconcile()

    mockProcessPost.assert_called_once_with("post1")
    assert result["retried"] == ["post1"]
    mockAlert.assert_called_once()  # "overdue work found" summary


def test_reconcile_passes_grace_minutes_default_to_storage():
    from social import maintenance, storage

    with patch.object(storage, "findOverduePending", return_value=[]) as mockFind, \
         patch.object(storage, "countHeartbeat", return_value=_heartbeatCounts()), \
         patch("social.maintenance.alerts.sendHeartbeat"):
        maintenance._reconcile()

    assert mockFind.call_args.args[1] == maintenance.DEFAULT_GRACE_MINUTES


# --- reconcile: a target past the attempt cap is marked failed, not retried -----------


def test_reconcile_marks_over_cap_target_failed_and_alerts_without_retrying():
    from social import alerts, maintenance, publisher, storage

    overdue = [_overdueParent("post2")]
    overCapTarget = _target(accountId="acct-b", attemptCount=publisher.MAX_ATTEMPTS, lastError="previous error")
    post = {"parent": _overdueParent("post2"), "targets": [overCapTarget]}

    with patch.object(storage, "findOverduePending", return_value=overdue), \
         patch.object(storage, "getPost", return_value=post), \
         patch.object(storage, "updateTargetStatus") as mockUpdateTarget, \
         patch.object(storage, "rollupParentStatus") as mockRollup, \
         patch.object(publisher, "processPost") as mockProcessPost, \
         patch.object(storage, "countHeartbeat", return_value=_heartbeatCounts()), \
         patch.object(alerts, "sendAlert") as mockAlert, \
         patch.object(alerts, "sendHeartbeat"):
        result = maintenance._reconcile()

    mockProcessPost.assert_not_called()  # over cap -- must not be handed back to the publish path
    mockUpdateTarget.assert_called_once()
    assert mockUpdateTarget.call_args.args[3] == storage.STATUS_FAILED
    mockRollup.assert_called_once_with("post2")
    mockAlert.assert_called_once()
    assert result["cappedFailed"] == [{"postId": "post2", "platform": "bluesky", "accountId": "acct-b"}]


# --- reconcile: nothing overdue -> no alert, heartbeat still sent ---------------------


def test_reconcile_nothing_overdue_no_alert_but_heartbeat_still_sent():
    from social import alerts, maintenance, storage

    with patch.object(storage, "findOverduePending", return_value=[]), \
         patch.object(storage, "countHeartbeat", return_value=_heartbeatCounts()), \
         patch.object(alerts, "sendAlert") as mockAlert, \
         patch.object(alerts, "sendHeartbeat") as mockHeartbeat:
        result = maintenance._reconcile()

    mockAlert.assert_not_called()
    mockHeartbeat.assert_called_once()
    assert result["overdueCount"] == 0


# --- heartbeat content ------------------------------------------------------------------


def test_heartbeat_message_includes_the_three_counts():
    from social import alerts, maintenance, storage

    counts = _heartbeatCounts(pending=3, publishedLast24h=7, failed=2)
    with patch.object(storage, "findOverduePending", return_value=[]), \
         patch.object(storage, "countHeartbeat", return_value=counts), \
         patch.object(alerts, "sendHeartbeat") as mockHeartbeat:
        maintenance._reconcile()

    message = mockHeartbeat.call_args.args[1]
    assert "pending=3" in message
    assert "published_last_24h=7" in message
    assert "failed=2" in message


# --- handler dispatch ---------------------------------------------------------------------


def test_handler_dispatches_reconcile_job():
    from social import maintenance

    with patch.object(maintenance, "_reconcile", return_value={"ok": True}) as mockReconcile:
        result = maintenance.handler({"job": "reconcile"}, None)

    mockReconcile.assert_called_once()
    assert result == {"ok": True}


def test_handler_defaults_to_reconcile_when_job_omitted():
    from social import maintenance

    with patch.object(maintenance, "_reconcile", return_value={"ok": True}) as mockReconcile:
        maintenance.handler({}, None)

    mockReconcile.assert_called_once()


def test_handler_unknown_job_returns_error_no_raise():
    from social import maintenance

    result = maintenance.handler({"job": "not-a-real-job"}, None)
    assert result["ok"] is False
