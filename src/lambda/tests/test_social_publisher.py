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


def _target(platform="bluesky", accountId="acct-a", status="pending", overrides=None, attemptCount=0, containerId=""):
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
        "containerId": containerId,
    }


class _FakePublisher:
    """Configurable stand-in for a Publisher subclass. resultsByAccount maps
    accountId -> PublishResult; capturedRequests records every PublishRequest
    handed to publish() for later assertion."""
    resultsByAccount = {}
    capturedRequests = []
    needsMediaBytes = True

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


def _fakeCheckPendingPublisherClassFactory(result):
    """Stand-in Publisher whose checkPending() always returns `result`
    (a single PublishResult, reused across calls) and records every
    (request, containerId, checkCount) it was invoked with."""

    class _Cls:
        needsMediaBytes = True
        capturedCalls = []

        def checkPending(self, request, containerId, checkCount):
            type(self).capturedCalls.append((request, containerId, checkCount))
            return result

    _Cls.capturedCalls = []
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


# --- media shape per needsMediaBytes (phase 5, test matrix #1 / #2) -------------------


def test_needs_media_bytes_false_uses_presigned_url_not_raw_bytes():
    from social import media, publisher, storage
    from social.publishers.base import PublishResult

    parent = _parent(mediaKeys=["uploads/u/post1/vid.mp4"])
    target = _target(platform="instagram")
    FakeCls = _fakePublisherClassFactory({"acct-a": PublishResult(ok=True, permalink="p", platformPostId="id")})
    FakeCls.needsMediaBytes = False

    with patch.object(storage, "getPost", return_value={"parent": parent, "targets": [target]}), \
         patch.object(storage, "updateTargetStatus", return_value=True), \
         patch.object(storage, "rollupParentStatus", return_value=storage.STATUS_PUBLISHED), \
         patch.object(media, "getBytes") as mockGetBytes, \
         patch.object(media, "presignGet", return_value="https://signed.example/vid.mp4") as mockPresignGet, \
         patch.object(publisher, "getPublisher", return_value=FakeCls):
        publisher.processPost("post1")

    mockGetBytes.assert_not_called()
    mockPresignGet.assert_called_once_with("uploads/u/post1/vid.mp4", expiresIn=21600)
    item = FakeCls.capturedRequests[0].media[0]
    assert item["key"] == "uploads/u/post1/vid.mp4"
    assert item["url"] == "https://signed.example/vid.mp4"
    assert "bytes" not in item


def test_needs_media_bytes_true_unchanged_behavior_has_bytes_and_key():
    from social import media, publisher, storage
    from social.publishers.base import PublishResult

    parent = _parent(mediaKeys=["uploads/u/post1/pic.jpg"])
    target = _target()
    FakeCls = _fakePublisherClassFactory({"acct-a": PublishResult(ok=True, permalink="p", platformPostId="id")})
    assert FakeCls.needsMediaBytes is True  # default, matching every existing publisher

    with patch.object(storage, "getPost", return_value={"parent": parent, "targets": [target]}), \
         patch.object(storage, "updateTargetStatus", return_value=True), \
         patch.object(storage, "rollupParentStatus", return_value=storage.STATUS_PUBLISHED), \
         patch.object(media, "getBytes", return_value=b"fake-bytes") as mockGetBytes, \
         patch.object(media, "presignGet") as mockPresignGet, \
         patch.object(publisher, "getPublisher", return_value=FakeCls):
        publisher.processPost("post1")

    mockGetBytes.assert_called_once_with("uploads/u/post1/pic.jpg")
    mockPresignGet.assert_not_called()
    item = FakeCls.capturedRequests[0].media[0]
    assert item["key"] == "uploads/u/post1/pic.jpg"
    assert item["bytes"] == b"fake-bytes"


# --- pending publish (phase 5, test matrix #3 / #4) -----------------------------------


def test_pending_result_marks_target_processing_schedules_check_no_attempt_increment():
    from social import publisher, scheduling, storage
    from social.publishers.base import PublishResult

    parent = _parent(scheduleName="social-post-post1")
    target = _target(platform="instagram")
    FakeCls = _fakePublisherClassFactory({
        "acct-a": PublishResult(ok=False, pending=True, containerId="container-abc", checkAfterSec=60)
    })

    with patch.object(storage, "getPost", return_value={"parent": parent, "targets": [target]}), \
         patch.object(storage, "updateTargetStatus", return_value=True), \
         patch.object(storage, "markTargetProcessing") as mockMarkProcessing, \
         patch.object(storage, "incrementAttempt") as mockIncrementAttempt, \
         patch.object(storage, "rollupParentStatus", return_value=storage.STATUS_PUBLISHING), \
         patch.object(scheduling, "createContainerCheck") as mockCreateCheck, \
         patch.object(publisher, "getPublisher", return_value=FakeCls):
        result = publisher.processPost("post1")

    mockIncrementAttempt.assert_not_called()
    mockMarkProcessing.assert_called_once_with("post1", "instagram", "acct-a", "container-abc", checkCount=1)
    mockCreateCheck.assert_called_once()
    assert mockCreateCheck.call_args.args[0] == "post1"
    assert mockCreateCheck.call_args.args[1] == "instagram"
    assert mockCreateCheck.call_args.args[2] == "acct-a"
    assert mockCreateCheck.call_args.kwargs["checkCount"] == 1
    assert result["results"][0]["status"] == storage.STATUS_PROCESSING


def test_on_container_created_callback_invoked_before_result_processed():
    from social import publisher, storage
    from social.publishers.base import PublishResult

    parent = _parent()
    target = _target(platform="instagram")
    callOrder = []

    class _CallbackPublisher:
        needsMediaBytes = True

        def publish(self, request):
            request.onContainerCreated("container-xyz")
            return PublishResult(ok=True, permalink="p", platformPostId="id")

    def _fakeSetTargetContainer(postId, platform, accountId, containerId):
        callOrder.append(("setTargetContainer", containerId))

    def _fakeUpdateTargetStatus(postId, platform, accountId, status, **kwargs):
        callOrder.append(("updateTargetStatus", status))
        return True

    with patch.object(storage, "getPost", return_value={"parent": parent, "targets": [target]}), \
         patch.object(storage, "updateTargetStatus", side_effect=_fakeUpdateTargetStatus), \
         patch.object(storage, "setTargetContainer", side_effect=_fakeSetTargetContainer) as mockSetContainer, \
         patch.object(storage, "rollupParentStatus", return_value=storage.STATUS_PUBLISHED), \
         patch.object(publisher, "getPublisher", return_value=_CallbackPublisher):
        publisher.processPost("post1")

    mockSetContainer.assert_called_once_with("post1", "instagram", "acct-a", "container-xyz")
    setIdx = callOrder.index(("setTargetContainer", "container-xyz"))
    publishedIdx = callOrder.index(("updateTargetStatus", storage.STATUS_PUBLISHED))
    assert setIdx < publishedIdx  # durable before the publish result is processed


# --- checkContainer (phase 5, test matrix #7-#11) -------------------------------------


def test_check_container_ok_true_marks_published_and_rolls_up():
    from social import publisher, storage
    from social.publishers.base import PublishResult

    parent = _parent()
    target = _target(platform="instagram", status=storage.STATUS_PROCESSING, containerId="container-1")
    FakeCls = _fakeCheckPendingPublisherClassFactory(PublishResult(ok=True, permalink="p", platformPostId="id"))

    with patch.object(storage, "getPost", return_value={"parent": parent, "targets": [target]}), \
         patch.object(storage, "updateTargetStatus", return_value=True) as mockUpdate, \
         patch.object(storage, "rollupParentStatus", return_value=storage.STATUS_PUBLISHED) as mockRollup, \
         patch.object(publisher, "getPublisher", return_value=FakeCls):
        result = publisher.checkContainer("post1", "instagram", "acct-a", 3)

    assert result["ok"] is True
    assert result["status"] == storage.STATUS_PUBLISHED
    mockRollup.assert_called_once_with("post1")
    assert mockUpdate.call_args.args[3] == storage.STATUS_PUBLISHED
    assert FakeCls.capturedCalls[0][1] == "container-1"
    assert FakeCls.capturedCalls[0][2] == 3


def test_check_container_pending_reschedules_with_incremented_check_count():
    from social import publisher, scheduling, storage
    from social.publishers.base import PublishResult

    parent = _parent()
    target = _target(platform="instagram", status=storage.STATUS_PROCESSING, containerId="container-1")
    FakeCls = _fakeCheckPendingPublisherClassFactory(
        PublishResult(ok=False, pending=True, containerId="container-1", checkAfterSec=90)
    )

    with patch.object(storage, "getPost", return_value={"parent": parent, "targets": [target]}), \
         patch.object(storage, "markTargetProcessing") as mockMarkProcessing, \
         patch.object(storage, "incrementAttempt") as mockIncrementAttempt, \
         patch.object(scheduling, "createContainerCheck") as mockCreateCheck, \
         patch.object(publisher, "getPublisher", return_value=FakeCls):
        result = publisher.checkContainer("post1", "instagram", "acct-a", 3)

    mockIncrementAttempt.assert_not_called()
    mockMarkProcessing.assert_called_once_with("post1", "instagram", "acct-a", "container-1", checkCount=4)
    mockCreateCheck.assert_called_once()
    assert mockCreateCheck.call_args.kwargs["checkCount"] == 4
    assert result["status"] == storage.STATUS_PROCESSING


def test_check_container_at_max_checks_not_rescheduled_retries_via_attempt_ladder():
    from social import publisher, scheduling, storage
    from social.publishers.base import PublishResult

    parent = _parent(scheduleName="social-post-post1")
    target = _target(platform="instagram", status=storage.STATUS_PROCESSING, containerId="container-1")
    FakeCls = _fakeCheckPendingPublisherClassFactory(
        PublishResult(ok=False, pending=True, containerId="container-1", checkAfterSec=60)
    )

    with patch.object(storage, "getPost", return_value={"parent": parent, "targets": [target]}), \
         patch.object(storage, "incrementAttempt", return_value=1), \
         patch.object(storage, "updateTargetStatus", return_value=True), \
         patch.object(storage, "rollupParentStatus", return_value=storage.STATUS_PUBLISHING), \
         patch.object(scheduling, "createContainerCheck") as mockCreateCheck, \
         patch.object(scheduling, "rescheduleOneShot") as mockReschedule, \
         patch.object(publisher, "getPublisher", return_value=FakeCls):
        result = publisher.checkContainer("post1", "instagram", "acct-a", publisher.MAX_CONTAINER_CHECKS)

    mockCreateCheck.assert_not_called()  # not rescheduled forever
    mockReschedule.assert_called_once()  # 1 attempt < MAX_ATTEMPTS -- folded into the normal retry ladder
    assert result["status"] == storage.STATUS_PENDING


def test_check_container_at_max_checks_exhausts_attempts_marks_failed_and_alerts():
    from social import alerts, publisher, scheduling, storage
    from social.publishers.base import PublishResult

    parent = _parent(scheduleName="social-post-post1")
    target = _target(
        platform="instagram", status=storage.STATUS_PROCESSING, containerId="container-1", attemptCount=2
    )
    FakeCls = _fakeCheckPendingPublisherClassFactory(
        PublishResult(ok=False, pending=True, containerId="container-1", checkAfterSec=60)
    )

    with patch.object(storage, "getPost", return_value={"parent": parent, "targets": [target]}), \
         patch.object(storage, "incrementAttempt", return_value=3), \
         patch.object(storage, "updateTargetStatus", return_value=True), \
         patch.object(storage, "rollupParentStatus", return_value=storage.STATUS_FAILED), \
         patch.object(scheduling, "createContainerCheck") as mockCreateCheck, \
         patch.object(scheduling, "rescheduleOneShot") as mockReschedule, \
         patch.object(alerts, "sendAlert") as mockAlert, \
         patch.object(publisher, "getPublisher", return_value=FakeCls):
        result = publisher.checkContainer("post1", "instagram", "acct-a", publisher.MAX_CONTAINER_CHECKS)

    mockCreateCheck.assert_not_called()
    mockReschedule.assert_not_called()
    mockAlert.assert_called_once()
    assert result["status"] == storage.STATUS_FAILED


def test_check_container_already_terminal_is_no_op():
    from social import publisher, storage

    parent = _parent()
    target = _target(platform="instagram", status=storage.STATUS_PUBLISHED)
    getPublisherMock = MagicMock()

    with patch.object(storage, "getPost", return_value={"parent": parent, "targets": [target]}), \
         patch.object(publisher, "getPublisher", getPublisherMock):
        result = publisher.checkContainer("post1", "instagram", "acct-a", 2)

    getPublisherMock.assert_not_called()
    assert result["skipped"] is True
    assert result["status"] == storage.STATUS_PUBLISHED


def test_check_container_ok_false_increments_attempt_and_retries():
    from social import publisher, scheduling, storage
    from social.publishers.base import PublishResult

    parent = _parent(scheduleName="social-post-post1")
    target = _target(platform="instagram", status=storage.STATUS_PROCESSING, containerId="container-1")
    FakeCls = _fakeCheckPendingPublisherClassFactory(PublishResult(ok=False, error="container failed"))

    with patch.object(storage, "getPost", return_value={"parent": parent, "targets": [target]}), \
         patch.object(storage, "incrementAttempt", return_value=1) as mockIncrementAttempt, \
         patch.object(storage, "updateTargetStatus", return_value=True), \
         patch.object(storage, "rollupParentStatus", return_value=storage.STATUS_PUBLISHING), \
         patch.object(scheduling, "rescheduleOneShot") as mockReschedule, \
         patch.object(publisher, "getPublisher", return_value=FakeCls):
        result = publisher.checkContainer("post1", "instagram", "acct-a", 2)

    mockIncrementAttempt.assert_called_once()
    mockReschedule.assert_called_once()
    assert result["status"] == storage.STATUS_PENDING


# --- handler dispatch for checkContainer jobs ------------------------------------------


def test_handler_dispatches_check_container_job():
    from social import publisher

    with patch.object(publisher, "checkContainer", return_value={"ok": True}) as mockCheckContainer:
        result = publisher.handler(
            {"job": "checkContainer", "postId": "post1", "platform": "instagram", "accountId": "acct-a",
             "checkCount": 2},
            None,
        )

    mockCheckContainer.assert_called_once_with("post1", "instagram", "acct-a", 2)
    assert result == {"ok": True}


def test_handler_check_container_job_missing_fields_returns_error_no_raise():
    from social import publisher

    result = publisher.handler({"job": "checkContainer", "postId": "post1"}, None)
    assert result["ok"] is False


def test_handler_normal_post_id_path_unaffected_by_job_dispatch():
    """The existing {"postId": ...} shape (no "job" key) must work exactly
    as before."""
    from social import publisher

    with patch.object(publisher, "processPost", return_value={"ok": True, "postId": "post1"}) as mockProcessPost:
        result = publisher.handler({"postId": "post1"}, None)

    mockProcessPost.assert_called_once_with("post1")
    assert result == {"ok": True, "postId": "post1"}


# --- mixed fan-out: one sync target + one pending target (test matrix #15) ------------


def test_mixed_fan_out_sync_and_pending_parent_stays_publishing():
    from social import publisher, scheduling, storage
    from social.publishers.base import PublishResult

    parent = _parent()
    syncTarget = _target(platform="bluesky", accountId="acct-sync")
    pendingTarget = _target(platform="instagram", accountId="acct-pending")

    class _MixedPublisher:
        needsMediaBytes = True

        def publish(self, request):
            if request.accountId == "acct-sync":
                return PublishResult(ok=True, permalink="p", platformPostId="id")
            return PublishResult(ok=False, pending=True, containerId="container-1", checkAfterSec=60)

    with patch.object(
             storage, "getPost", return_value={"parent": parent, "targets": [syncTarget, pendingTarget]}
         ), \
         patch.object(storage, "updateTargetStatus", return_value=True), \
         patch.object(storage, "markTargetProcessing") as mockMarkProcessing, \
         patch.object(storage, "rollupParentStatus", return_value=storage.STATUS_PUBLISHING), \
         patch.object(scheduling, "createContainerCheck"), \
         patch.object(publisher, "getPublisher", return_value=_MixedPublisher):
        result = publisher.processPost("post1")

    statuses = {r["accountId"]: r["status"] for r in result["results"]}
    assert statuses["acct-sync"] == storage.STATUS_PUBLISHED
    assert statuses["acct-pending"] == storage.STATUS_PROCESSING
    assert result["status"] == storage.STATUS_PUBLISHING  # stays in-progress, doesn't resolve early
    mockMarkProcessing.assert_called_once()


def test_mixed_fan_out_resolves_once_pending_target_checks_in_as_published():
    """Once the still-processing target's container check reports ok=True,
    checkContainer publishes it and rolls the parent up -- with the sync
    target already published, deriveParentStatus resolves to published."""
    from social import publisher, storage
    from social.publishers.base import PublishResult

    parent = _parent()
    publishedSyncTarget = _target(platform="bluesky", accountId="acct-sync", status=storage.STATUS_PUBLISHED)
    processingTarget = _target(
        platform="instagram", accountId="acct-pending", status=storage.STATUS_PROCESSING, containerId="container-1"
    )
    FakeCls = _fakeCheckPendingPublisherClassFactory(PublishResult(ok=True, permalink="p2", platformPostId="id2"))

    with patch.object(
             storage, "getPost",
             return_value={"parent": parent, "targets": [publishedSyncTarget, processingTarget]},
         ), \
         patch.object(storage, "updateTargetStatus", return_value=True), \
         patch.object(storage, "rollupParentStatus", return_value=storage.STATUS_PUBLISHED) as mockRollup, \
         patch.object(publisher, "getPublisher", return_value=FakeCls):
        result = publisher.checkContainer("post1", "instagram", "acct-pending", 1)

    assert result["status"] == storage.STATUS_PUBLISHED
    assert result["parentStatus"] == storage.STATUS_PUBLISHED
    mockRollup.assert_called_once_with("post1")


# --- pending/ok precedence regression (phase 3) --------------------------------------------
#
# The real InstagramPublisher signals a still-processing container as
# pending=True AND ok=True -- pending is not an error. An earlier version of
# _processTarget/checkContainer tested `result.ok` first, which marked a Reel
# published the instant its container was created (and stopped the polling
# loop on the first check), so the post showed as successful while nothing
# ever reached Instagram. Every other pending test here happens to use
# ok=False, which is exactly why that inversion went unnoticed.


def test_process_target_pending_takes_precedence_over_ok_true():
    from social import publisher, scheduling, storage
    from social.publishers.base import PublishResult

    parent = _parent(scheduleName="social-post-post1")
    target = _target(platform="instagram")
    FakeCls = _fakePublisherClassFactory(
        {"acct-a": PublishResult(ok=True, pending=True, containerId="container-xyz", checkAfterSec=60)}
    )

    with patch.object(storage, "getPost", return_value={"parent": parent, "targets": [target]}), \
         patch.object(storage, "updateTargetStatus", return_value=True) as mockUpdateStatus, \
         patch.object(storage, "markTargetProcessing") as mockMarkProcessing, \
         patch.object(storage, "incrementAttempt") as mockIncrementAttempt, \
         patch.object(storage, "rollupParentStatus", return_value=storage.STATUS_PUBLISHING), \
         patch.object(scheduling, "createContainerCheck") as mockCreateCheck, \
         patch.object(publisher, "getPublisher", return_value=FakeCls):
        result = publisher.processPost("post1")

    assert result["results"][0]["status"] == storage.STATUS_PROCESSING
    mockMarkProcessing.assert_called_once()
    mockCreateCheck.assert_called_once()
    mockIncrementAttempt.assert_not_called()
    # The critical assertion: it must NOT have been recorded as published.
    for call in mockUpdateStatus.call_args_list:
        assert storage.STATUS_PUBLISHED not in call.args


def test_check_container_pending_takes_precedence_over_ok_true():
    from social import publisher, scheduling, storage
    from social.publishers.base import PublishResult

    parent = _parent()
    target = _target(platform="instagram", status=storage.STATUS_PROCESSING, containerId="container-1")
    FakeCls = _fakeCheckPendingPublisherClassFactory(
        PublishResult(ok=True, pending=True, containerId="container-1", checkAfterSec=60)
    )

    with patch.object(storage, "getPost", return_value={"parent": parent, "targets": [target]}), \
         patch.object(storage, "markTargetProcessing") as mockMarkProcessing, \
         patch.object(storage, "updateTargetStatus") as mockUpdateStatus, \
         patch.object(scheduling, "createContainerCheck") as mockCreateCheck, \
         patch.object(publisher, "getPublisher", return_value=FakeCls):
        result = publisher.checkContainer("post1", "instagram", "acct-a", 2)

    # Still processing: rescheduled, not published, polling loop continues.
    assert result["status"] == storage.STATUS_PROCESSING
    mockCreateCheck.assert_called_once()
    mockMarkProcessing.assert_called_once()
    for call in mockUpdateStatus.call_args_list:
        assert storage.STATUS_PUBLISHED not in call.args
