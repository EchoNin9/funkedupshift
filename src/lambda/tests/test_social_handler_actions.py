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


# --- media descriptors at validation time (phase 3 regression) -----------------------------
#
# _actionCreate used to validate with a hardcoded media=[]. Harmless for
# Bluesky, whose validate() only enforces MAXIMUM counts -- but Instagram
# requires at least one media item, so every Instagram post was unschedulable
# no matter what the caller attached. The whole platform was unusable and 663
# tests passed, because no test asserted what validate() actually receives.


def _instagramAccount():
    return [{"platform": "instagram", "accountId": "jinksninja", "overrides": {}}]


def test_create_passes_media_descriptors_to_validate_not_an_empty_list():
    from social import handler

    seen = {}

    class FakePublisher:
        platform = "instagram"

        def validate(self, request):
            seen["media"] = request.media
            return []

    with patch.object(handler, "getPublisher", return_value=FakePublisher), \
         patch.object(handler.scheduling, "createOneShot", return_value={"immediate": False, "scheduleName": "s"}), \
         patch.object(handler.storage, "createPost", return_value={"parent": {}, "targets": []}):
        handler._actionCreate({
            "text": "WRESTLING",
            "scheduledAt": "2026-08-04T12:00:00Z",
            "accounts": _instagramAccount(),
            "mediaKeys": ["uploads/u1/p1/photo.jpg"],
        })

    assert len(seen["media"]) == 1, "validate() must see the attached media, not an empty list"
    assert seen["media"][0]["key"] == "uploads/u1/p1/photo.jpg"
    assert seen["media"][0]["mimeType"] == "image/jpeg"


def test_create_with_media_passes_the_real_instagram_validator():
    """End-to-end through the actual InstagramPublisher.validate, which is what
    the CLI hit. A JPEG attachment must schedule cleanly."""
    from social import handler

    with patch.object(handler.scheduling, "createOneShot", return_value={"immediate": False, "scheduleName": "s"}), \
         patch.object(handler.storage, "createPost", return_value={"parent": {}, "targets": []}), \
         patch.object(handler.storage, "getPost", return_value={"parent": {}, "targets": []}):
        result = handler._actionCreate({
            "text": "WRESTLING",
            "scheduledAt": "2026-08-04T12:00:00Z",
            "accounts": _instagramAccount(),
            "mediaKeys": ["uploads/u1/p1/photo.jpg"],
        })

    assert "errors" not in result, f"expected a clean schedule, got {result.get('errors')}"


def test_create_text_only_instagram_still_correctly_rejected():
    """The requiresMedia rule must still fire when there genuinely is no media."""
    from social import handler

    result = handler._actionCreate({
        "text": "WRESTLING",
        "scheduledAt": "2026-08-04T12:00:00Z",
        "accounts": _instagramAccount(),
        "mediaKeys": [],
    })

    assert result["ok"] is False
    assert any("at least one photo or video" in e for e in result["errors"])


def test_create_instagram_png_rejected_at_schedule_time():
    """Mime is guessed from the extension, so a PNG fails immediately rather
    than at publish time hours later."""
    from social import handler

    result = handler._actionCreate({
        "text": "WRESTLING",
        "scheduledAt": "2026-08-04T12:00:00Z",
        "accounts": _instagramAccount(),
        "mediaKeys": ["uploads/u1/p1/photo.png"],
    })

    assert result["ok"] is False
    assert any("JPEG" in e for e in result["errors"])


def test_create_bluesky_with_media_descriptors_unaffected():
    """Bluesky's validate() reads item['bytes'] defensively; descriptors
    without bytes must not break it or invent a size error."""
    from social import handler

    with patch.object(handler.scheduling, "createOneShot", return_value={"immediate": False, "scheduleName": "s"}), \
         patch.object(handler.storage, "createPost", return_value={"parent": {}, "targets": []}), \
         patch.object(handler.storage, "getPost", return_value={"parent": {}, "targets": []}):
        result = handler._actionCreate({
            "text": "hello",
            "scheduledAt": "2026-08-04T12:00:00Z",
            "accounts": [{"platform": "bluesky", "accountId": "personal", "overrides": {}}],
            "mediaKeys": ["uploads/u1/p1/photo.png"],
        })

    assert "errors" not in result
