"""Unit tests for the phase-2 "action" dispatch added to social/handler.py.
Covers: the phase-1 default (no "action") path still works unmodified, and
create/get/listMonth/cancel/retry are wired to storage/scheduling/publisher
correctly. storage/scheduling/publisher and the publisher registry are all
mocked -- no moto, no real network calls."""
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


class _FakePublisher:
    validateErrors = []
    publishResult = None

    def validate(self, request):
        return type(self).validateErrors

    def publish(self, request):
        return type(self).publishResult


def _fakePublisherClass(validateErrors=None, publishResult=None):
    from social.publishers.base import PublishResult

    class _Cls(_FakePublisher):
        pass

    _Cls.validateErrors = validateErrors or []
    _Cls.publishResult = publishResult or PublishResult(ok=True, permalink="https://x", platformPostId="at://x")
    return _Cls


# --- default (no "action") path is unchanged from phase 1 ---------------------------


def test_no_action_falls_back_to_immediate_publish():
    from social import handler
    from social.publishers.base import PublishResult

    FakeCls = _fakePublisherClass(publishResult=PublishResult(ok=True, permalink="https://x", platformPostId="id"))

    with patch.object(handler, "getPublisher", return_value=FakeCls):
        result = handler.handler({"accountId": "a", "platform": "bluesky", "text": "hi"}, None)

    assert result["ok"] is True
    assert result["permalink"] == "https://x"


def test_no_action_validation_errors_short_circuit_before_publish():
    from social import handler

    FakeCls = _fakePublisherClass(validateErrors=["text too long"])

    with patch.object(handler, "getPublisher", return_value=FakeCls):
        result = handler.handler({"accountId": "a", "platform": "bluesky", "text": "x" * 400}, None)

    assert result["ok"] is False
    assert result["errors"] == ["text too long"]


# --- action: create ------------------------------------------------------------------


def test_action_create_validates_before_writing_anything():
    from social import handler, scheduling, storage

    FakeCls = _fakePublisherClass(validateErrors=["text is required"])

    with patch.object(handler, "getPublisher", return_value=FakeCls), \
         patch.object(scheduling, "createOneShot") as mockCreateSchedule, \
         patch.object(storage, "createPost") as mockCreatePost:
        result = handler.handler(
            {
                "action": "create", "text": "", "scheduledAt": "2026-08-02T15:00:00Z",
                "accounts": [{"platform": "bluesky", "accountId": "a", "overrides": {}}],
            },
            None,
        )

    assert result["ok"] is False
    mockCreateSchedule.assert_not_called()
    mockCreatePost.assert_not_called()


def test_action_create_requires_scheduled_at_and_accounts():
    from social import handler

    assert handler.handler({"action": "create", "text": "hi", "accounts": [{"platform": "bluesky", "accountId": "a"}]}, None)["ok"] is False
    assert handler.handler({"action": "create", "text": "hi", "scheduledAt": "2026-08-02T15:00:00Z", "accounts": []}, None)["ok"] is False


def test_action_create_happy_path_scheduled_writes_ddb_and_schedule():
    from social import handler, scheduling, storage

    FakeCls = _fakePublisherClass()

    with patch.object(handler, "getPublisher", return_value=FakeCls), \
         patch.object(scheduling, "createOneShot", return_value={"immediate": False, "scheduleName": "social-post-abc"}), \
         patch.object(storage, "createPost", return_value={"parent": {}, "targets": []}) as mockCreatePost:
        result = handler.handler(
            {
                "action": "create", "text": "hi", "scheduledAt": "2026-08-02T15:00:00Z", "postId": "abc",
                "accounts": [{"platform": "bluesky", "accountId": "a", "overrides": {}}],
            },
            None,
        )

    assert result["ok"] is True
    assert result["immediate"] is False
    assert result["scheduleName"] == "social-post-abc"
    mockCreatePost.assert_called_once()
    assert mockCreatePost.call_args.kwargs["scheduleName"] == "social-post-abc"


def test_action_create_immediate_path_publishes_synchronously():
    from social import handler, publisher, scheduling, storage

    FakeCls = _fakePublisherClass()

    with patch.object(handler, "getPublisher", return_value=FakeCls), \
         patch.object(scheduling, "createOneShot", return_value={"immediate": True, "scheduleName": None}), \
         patch.object(storage, "createPost", return_value={"parent": {}, "targets": []}), \
         patch.object(publisher, "processPost", return_value={"ok": True, "status": "published"}) as mockProcess:
        result = handler.handler(
            {
                "action": "create", "text": "hi", "scheduledAt": "2020-01-01T00:00:00Z", "postId": "abc",
                "accounts": [{"platform": "bluesky", "accountId": "a", "overrides": {}}],
            },
            None,
        )

    assert result["immediate"] is True
    mockProcess.assert_called_once_with("abc")


def test_action_create_duplicate_post_id_returns_error():
    from social import handler, scheduling, storage

    FakeCls = _fakePublisherClass()

    with patch.object(handler, "getPublisher", return_value=FakeCls), \
         patch.object(scheduling, "createOneShot", return_value={"immediate": False, "scheduleName": "social-post-abc"}), \
         patch.object(storage, "createPost", side_effect=storage.PostAlreadyExistsError("dup")):
        result = handler.handler(
            {
                "action": "create", "text": "hi", "scheduledAt": "2026-08-02T15:00:00Z", "postId": "abc",
                "accounts": [{"platform": "bluesky", "accountId": "a", "overrides": {}}],
            },
            None,
        )

    assert result["ok"] is False


# --- action: get / listMonth ----------------------------------------------------------


def test_action_get_not_found():
    from social import handler, storage

    with patch.object(storage, "getPost", return_value={"parent": None, "targets": []}):
        result = handler.handler({"action": "get", "postId": "missing"}, None)

    assert result["ok"] is False


def test_action_get_found():
    from social import handler, storage

    post = {"parent": {"postId": "abc"}, "targets": []}
    with patch.object(storage, "getPost", return_value=post):
        result = handler.handler({"action": "get", "postId": "abc"}, None)

    assert result["ok"] is True
    assert result["post"] == post


def test_action_list_month_requires_month():
    from social import handler

    assert handler.handler({"action": "listMonth"}, None)["ok"] is False


def test_action_list_month_returns_items():
    from social import handler, storage

    with patch.object(storage, "listPostsByMonth", return_value=[{"postId": "abc"}]) as mockList:
        result = handler.handler({"action": "listMonth", "month": "2026-08"}, None)

    mockList.assert_called_once_with("2026-08")
    assert result["items"] == [{"postId": "abc"}]


# --- action: cancel ----------------------------------------------------------------------


def test_action_cancel_cancels_schedule_and_marks_cancelled():
    from social import handler, scheduling, storage

    post = {"parent": {"postId": "abc", "scheduleName": "social-post-abc"}, "targets": []}
    with patch.object(storage, "getPost", return_value=post), \
         patch.object(scheduling, "cancelOneShot") as mockCancel, \
         patch.object(storage, "cancelPost", return_value={"parent": {"status": "cancelled"}, "targets": []}):
        result = handler.handler({"action": "cancel", "postId": "abc"}, None)

    mockCancel.assert_called_once_with("social-post-abc")
    assert result["ok"] is True


def test_action_cancel_not_found():
    from social import handler, storage

    with patch.object(storage, "getPost", return_value={"parent": None, "targets": []}):
        result = handler.handler({"action": "cancel", "postId": "missing"}, None)

    assert result["ok"] is False


# --- action: retry -----------------------------------------------------------------------


def test_action_retry_resets_failed_target_and_republishes():
    from social import handler, publisher, storage

    post = {
        "parent": {"postId": "abc"},
        "targets": [{"platform": "bluesky", "accountId": "a", "status": storage.STATUS_FAILED}],
    }
    with patch.object(storage, "getPost", return_value=post), \
         patch.object(storage, "updateTargetStatus") as mockUpdate, \
         patch.object(publisher, "processPost", return_value={"ok": True}) as mockProcess:
        result = handler.handler({"action": "retry", "postId": "abc", "platform": "bluesky", "accountId": "a"}, None)

    mockUpdate.assert_called_once_with("abc", "bluesky", "a", storage.STATUS_PENDING, lastError="")
    mockProcess.assert_called_once_with("abc")
    assert result["ok"] is True


def test_action_retry_rejects_non_failed_target():
    from social import handler, storage

    post = {
        "parent": {"postId": "abc"},
        "targets": [{"platform": "bluesky", "accountId": "a", "status": storage.STATUS_PUBLISHED}],
    }
    with patch.object(storage, "getPost", return_value=post):
        result = handler.handler({"action": "retry", "postId": "abc", "platform": "bluesky", "accountId": "a"}, None)

    assert result["ok"] is False


# --- unknown action ------------------------------------------------------------------------


def test_unknown_action_returns_error():
    from social import handler

    result = handler.handler({"action": "not-a-real-action"}, None)
    assert result["ok"] is False
