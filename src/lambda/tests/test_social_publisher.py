"""Unit tests for social/publisher.py (the EventBridge Scheduler target,
phase 2). storage/scheduling/media/alerts and the publisher registry are all
mocked -- no moto, no real network calls, no real DynamoDB."""
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _parent(postId="post1", mediaKeys=None, text="hello", links=None, scheduleName=""):
    return {
        "PK": f"POST#{postId}",
        "SK": "META",
        "postId": postId,
        "text": text,
        "mediaKeys": mediaKeys or [],
        "links": links or [],
        "scheduledAt": "2026-08-02T15:00:00Z",
        "status": "pending",
        "scheduleName": scheduleName,
    }


def _target(platform="bluesky", accountId="acct-a", status="pending", overrides=None, attemptCount=0):
    return {
        "PK": "POST#post1",
        "SK": f"TARGET#{platform}#{accountId}",
        "platform": platform,
        "accountId": accountId,
        "status": status,
        "attemptCount": attemptCount,
        "lastError": "",
        "permalink": "",
        "platformPostId": "",
        "overrides": overrides or {},
    }


class _FakePublisher:
    """Configurable stand-in for a Publisher subclass. resultsByAccount maps
    accountId -> PublishResult; capturedRequests records every PublishRequest
    handed to publish() for later assertion."""
    resultsByAccount = {}
    capturedRequests = []

    def publish(self, request):
        type(self).capturedRequests.append(request)
        return type(self).resultsByAccount[request.accountId]


def _fakePublisherClassFactory(resultsByAccount):
    from social.publishers.base import PublishResult  # noqa: F401  (import kept local to avoid unused warning upstream)

    class _Cls(_FakePublisher):
        pass

    _Cls.resultsByAccount = resultsByAccount
    _Cls.capturedRequests = []
    return _Cls


# --- happy path: single target -----------------------------------------------------


def test_happy_path_single_target_publishes_and_rolls_up():
    from social import publisher, storage
    from social.publishers.base import PublishResult

    parent = _parent()
    target = _target()
    FakeCls = _fakePublisherClassFactory({"acct-a": PublishResult(ok=True, permalink="https://x", platformPostId="at://x")})

    with patch.object(storage, "getPost", return_value={"parent": parent, "targets": [target]}), \
         patch.object(storage, "updateTargetStatus", return_value=True) as mockUpdate, \
         patch.object(storage, "rollupParentStatus", return_value=storage.STATUS_PUBLISHED) as mockRollup, \
         patch.object(publisher, "getPublisher", return_value=FakeCls):
        result = publisher.processPost("post1")

    assert result["ok"] is True
    assert result["status"] == storage.STATUS_PUBLISHED
    assert result["results"][0]["status"] == storage.STATUS_PUBLISHED
    mockRollup.assert_called_once_with("post1")

    # Two updateTargetStatus calls: claim (-> publishing) then success (-> published).
    statusesSet = [c.args[3] for c in mockUpdate.call_args_list]
    assert statusesSet == [storage.STATUS_PUBLISHING, storage.STATUS_PUBLISHED]


# --- fan-out: mixed success/failure -------------------------------------------------


def test_fan_out_two_accounts_one_fails_permanently_parent_partial_alert_sent_once():
    from social import alerts, publisher, storage
    from social.publishers.base import PublishResult

    parent = _parent()
    targets = [_target(accountId="acct-a"), _target(accountId="acct-b")]
    FakeCls = _fakePublisherClassFactory({
        "acct-a": PublishResult(ok=True, permalink="https://x", platformPostId="at://x"),
        "acct-b": PublishResult(ok=False, error="boom"),
    })

    with patch.object(storage, "getPost", return_value={"parent": parent, "targets": targets}), \
         patch.object(storage, "updateTargetStatus", return_value=True), \
         patch.object(storage, "incrementAttempt", return_value=3), \
         patch.object(storage, "rollupParentStatus", return_value=storage.STATUS_PARTIAL), \
         patch.object(publisher, "getPublisher", return_value=FakeCls), \
         patch.object(alerts, "sendAlert") as mockAlert:
        result = publisher.processPost("post1")

    assert result["status"] == storage.STATUS_PARTIAL
    statuses = {r["accountId"]: r["status"] for r in result["results"]}
    assert statuses["acct-a"] == storage.STATUS_PUBLISHED
    assert statuses["acct-b"] == storage.STATUS_FAILED
    mockAlert.assert_called_once()


# --- idempotency ---------------------------------------------------------------------


def test_already_published_target_is_skipped_no_publish_call():
    from social import publisher, storage

    parent = _parent()
    target = _target(status=storage.STATUS_PUBLISHED)
    getPublisherMock = MagicMock()

    with patch.object(storage, "getPost", return_value={"parent": parent, "targets": [target]}), \
         patch.object(storage, "updateTargetStatus") as mockUpdate, \
         patch.object(storage, "rollupParentStatus", return_value=storage.STATUS_PUBLISHED), \
         patch.object(publisher, "getPublisher", getPublisherMock):
        result = publisher.processPost("post1")

    getPublisherMock.assert_not_called()
    mockUpdate.assert_not_called()
    assert result["results"][0]["skipped"] is True


def test_losing_the_claim_race_is_treated_as_already_published():
    """A concurrent invocation (live schedule vs. reconciliation sweep) may
    already be mid-publish -- the conditional claim write fails, and this
    invocation must back off rather than double-post."""
    from social import publisher, storage

    parent = _parent()
    target = _target(status=storage.STATUS_PENDING)
    getPublisherMock = MagicMock()

    with patch.object(storage, "getPost", return_value={"parent": parent, "targets": [target]}), \
         patch.object(storage, "updateTargetStatus", return_value=False), \
         patch.object(storage, "rollupParentStatus", return_value=storage.STATUS_PUBLISHED), \
         patch.object(publisher, "getPublisher", getPublisherMock):
        result = publisher.processPost("post1")

    getPublisherMock.assert_not_called()
    assert result["results"][0]["skipped"] is True


# --- retry / attempt-cap ladder -------------------------------------------------------


def test_attempt_1_failure_reschedules_and_does_not_alert():
    from social import alerts, publisher, scheduling, storage
    from social.publishers.base import PublishResult

    parent = _parent(scheduleName="social-post-post1")
    target = _target()
    FakeCls = _fakePublisherClassFactory({"acct-a": PublishResult(ok=False, error="temporary")})

    with patch.object(storage, "getPost", return_value={"parent": parent, "targets": [target]}), \
         patch.object(storage, "updateTargetStatus", return_value=True) as mockUpdate, \
         patch.object(storage, "incrementAttempt", return_value=1), \
         patch.object(storage, "rollupParentStatus", return_value=storage.STATUS_PUBLISHING), \
         patch.object(publisher, "getPublisher", return_value=FakeCls), \
         patch.object(scheduling, "rescheduleOneShot") as mockReschedule, \
         patch.object(alerts, "sendAlert") as mockAlert:
        result = publisher.processPost("post1")

    mockReschedule.assert_called_once()
    assert mockReschedule.call_args.args[0] == "post1"
    assert mockReschedule.call_args.kwargs["oldScheduleName"] == "social-post-post1"
    mockAlert.assert_not_called()
    assert result["results"][0]["status"] == storage.STATUS_PENDING
    finalStatusCalls = [c.args[3] for c in mockUpdate.call_args_list]
    assert storage.STATUS_PENDING in finalStatusCalls


def test_attempt_2_failure_also_reschedules():
    from social import publisher, scheduling, storage
    from social.publishers.base import PublishResult

    parent = _parent(scheduleName="social-post-post1")
    target = _target(attemptCount=1)
    FakeCls = _fakePublisherClassFactory({"acct-a": PublishResult(ok=False, error="temporary again")})

    with patch.object(storage, "getPost", return_value={"parent": parent, "targets": [target]}), \
         patch.object(storage, "updateTargetStatus", return_value=True), \
         patch.object(storage, "incrementAttempt", return_value=2), \
         patch.object(storage, "rollupParentStatus", return_value=storage.STATUS_PUBLISHING), \
         patch.object(publisher, "getPublisher", return_value=FakeCls), \
         patch.object(scheduling, "rescheduleOneShot") as mockReschedule:
        result = publisher.processPost("post1")

    mockReschedule.assert_called_once()
    assert result["results"][0]["status"] == storage.STATUS_PENDING


def test_attempt_3_failure_marks_failed_and_alerts_no_reschedule():
    from social import alerts, publisher, scheduling, storage
    from social.publishers.base import PublishResult

    parent = _parent(scheduleName="social-post-post1")
    target = _target(attemptCount=2)
    FakeCls = _fakePublisherClassFactory({"acct-a": PublishResult(ok=False, error="permanent")})

    with patch.object(storage, "getPost", return_value={"parent": parent, "targets": [target]}), \
         patch.object(storage, "updateTargetStatus", return_value=True) as mockUpdate, \
         patch.object(storage, "incrementAttempt", return_value=3), \
         patch.object(storage, "rollupParentStatus", return_value=storage.STATUS_FAILED), \
         patch.object(publisher, "getPublisher", return_value=FakeCls), \
         patch.object(scheduling, "rescheduleOneShot") as mockReschedule, \
         patch.object(alerts, "sendAlert") as mockAlert:
        result = publisher.processPost("post1")

    mockReschedule.assert_not_called()
    mockAlert.assert_called_once()
    assert result["results"][0]["status"] == storage.STATUS_FAILED
    finalStatusCalls = [c.args[3] for c in mockUpdate.call_args_list]
    assert storage.STATUS_FAILED in finalStatusCalls


# --- never raises ----------------------------------------------------------------------


def test_publisher_never_raises_on_publish_result_ok_false():
    from social import publisher, scheduling, storage
    from social.publishers.base import PublishResult

    parent = _parent(scheduleName="social-post-post1")
    target = _target()
    FakeCls = _fakePublisherClassFactory({"acct-a": PublishResult(ok=False, error="nope")})

    with patch.object(storage, "getPost", return_value={"parent": parent, "targets": [target]}), \
         patch.object(storage, "updateTargetStatus", return_value=True), \
         patch.object(storage, "incrementAttempt", return_value=1), \
         patch.object(storage, "rollupParentStatus", return_value=storage.STATUS_PUBLISHING), \
         patch.object(publisher, "getPublisher", return_value=FakeCls), \
         patch.object(scheduling, "rescheduleOneShot"):
        result = publisher.handler({"postId": "post1"}, None)  # must not raise

    assert result["ok"] is True


def test_handler_missing_post_id_returns_error_dict_no_raise():
    from social import publisher

    result = publisher.handler({}, None)
    assert result["ok"] is False


def test_handler_post_not_found_returns_error_dict_no_raise():
    from social import publisher, storage

    with patch.object(storage, "getPost", return_value={"parent": None, "targets": []}):
        result = publisher.handler({"postId": "missing"}, None)

    assert result["ok"] is False


# --- overrides reach the PublishRequest -------------------------------------------------


def test_per_target_overrides_reach_publish_request():
    from social import media, publisher, storage
    from social.publishers.base import PublishResult

    parent = _parent(mediaKeys=["uploads/u/post1/pic.jpg"], text="parent text", links=["https://parent.example"])
    overrides = {
        "text": "override text",
        "links": ["https://override.example"],
        "media": [{"key": "uploads/u/post1/pic.jpg", "alt": "custom alt"}],
    }
    target = _target(overrides=overrides)
    FakeCls = _fakePublisherClassFactory({"acct-a": PublishResult(ok=True, permalink="p", platformPostId="id")})

    with patch.object(storage, "getPost", return_value={"parent": parent, "targets": [target]}), \
         patch.object(storage, "updateTargetStatus", return_value=True), \
         patch.object(storage, "rollupParentStatus", return_value=storage.STATUS_PUBLISHED), \
         patch.object(media, "getBytes", return_value=b"fake-bytes") as mockGetBytes, \
         patch.object(publisher, "getPublisher", return_value=FakeCls):
        publisher.processPost("post1")

    mockGetBytes.assert_called_once_with("uploads/u/post1/pic.jpg")
    request = FakeCls.capturedRequests[0]
    assert request.text == "override text"
    assert request.links == ["https://override.example"]
    assert request.media[0]["alt"] == "custom alt"
    assert request.media[0]["bytes"] == b"fake-bytes"
    assert request.overrides == overrides


# --- idempotencyKey / scheduledAt wiring (crash-safe republish, phase 5) ------------


def test_build_publish_request_sets_idempotency_key_and_scheduled_at():
    from social.publisher import _buildPublishRequest

    parent = _parent(postId="post1")  # _parent's default scheduledAt is "2026-08-02T15:00:00Z"
    target = _target(platform="bluesky", accountId="acct-a")

    request = _buildPublishRequest(parent, target)

    assert request.idempotencyKey == "post1:bluesky:acct-a"
    assert request.scheduledAt == "2026-08-02T15:00:00Z"
