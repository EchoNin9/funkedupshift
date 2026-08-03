"""Unit tests for the Instagram publisher (src/lambda/social/publishers/instagram.py).

urllib and SSM are mocked per house style (see test_social_bluesky.py's
_mockResponse helper) -- no moto, no real network calls, no real HTTP ever."""
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, call, patch
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


def _quotaOk(usage=2, total=100):
    return _mockResponse({"data": [{"quota_usage": usage, "config": {"quota_total": total, "quota_duration": 86400}}]})


def _request(text="hello caption", media=None, onContainerCreated=None):
    from social.publishers.base import PublishRequest
    return PublishRequest(
        accountId="test-account", text=text, media=media or [], links=[], onContainerCreated=onContainerCreated,
    )


def _jpegItem(url="https://s3.example.com/photo.jpg", alt="a photo"):
    return {"key": "uploads/photo.jpg", "mimeType": "image/jpeg", "alt": alt, "url": url}


def _mp4Item(url="https://s3.example.com/clip.mp4", alt="a clip"):
    return {"key": "uploads/clip.mp4", "mimeType": "video/mp4", "alt": alt, "url": url}


def _httpError(code, message="Something went wrong", err_type="OAuthException", err_code=None, subcode=None, fbtrace="TraceXYZ"):
    body = {
        "error": {
            "message": message,
            "type": err_type,
            "fbtrace_id": fbtrace,
        }
    }
    if err_code is not None:
        body["error"]["code"] = err_code
    if subcode is not None:
        body["error"]["error_subcode"] = subcode
    err = HTTPError(url="https://graph.facebook.com/v25.0/x", code=code, msg="Error", hdrs=None, fp=None)
    err.read = MagicMock(return_value=json.dumps(body).encode("utf-8"))
    return err


# --- validate: network-free ------------------------------------------------------


def test_validate_text_only_no_media_is_an_error():
    from social.publishers.instagram import InstagramPublisher

    request = _request(text="just words", media=[])
    errors = InstagramPublisher().validate(request)
    assert any("at least one photo or video" in e for e in errors)


def test_validate_png_image_errors_naming_jpeg():
    from social.publishers.instagram import InstagramPublisher

    item = {"key": "x", "mimeType": "image/png", "alt": "", "url": "https://s3.example.com/x.png"}
    request = _request(media=[item])
    errors = InstagramPublisher().validate(request)
    assert any("JPEG" in e or "image/jpeg" in e for e in errors)


def test_validate_11_media_items_is_an_error():
    from social.publishers.instagram import InstagramPublisher

    media = [_jpegItem(url=f"https://s3.example.com/{i}.jpg") for i in range(11)]
    request = _request(media=media)
    errors = InstagramPublisher().validate(request)
    assert any("10" in e for e in errors)


def test_validate_2201_graphemes_is_an_error():
    from social.publishers.instagram import InstagramPublisher

    request = _request(text="x" * 2201, media=[_jpegItem()])
    errors = InstagramPublisher().validate(request)
    assert any("2201" in e and "2200" in e for e in errors)


def test_validate_31_hashtags_is_an_error():
    from social.publishers.instagram import InstagramPublisher

    text = " ".join(f"#tag{i}" for i in range(31))
    request = _request(text=text, media=[_jpegItem()])
    errors = InstagramPublisher().validate(request)
    assert any("hashtag" in e.lower() for e in errors)


def test_validate_valid_single_jpeg_no_errors_and_no_network_call():
    from social.publishers.instagram import InstagramPublisher

    request = _request(media=[_jpegItem()])
    publisher = InstagramPublisher()
    with patch("social.publishers.instagram.urlopen") as mock_urlopen:
        errors = publisher.validate(request)
    assert errors == []
    mock_urlopen.assert_not_called()


# --- single image happy path ------------------------------------------------------


@patch("social.publishers.instagram.getInstagramCredentials")
@patch("social.publishers.instagram.urlopen")
def test_single_image_happy_path_media_then_media_publish(mock_urlopen, mock_creds):
    from social.publishers.instagram import InstagramPublisher

    mock_creds.return_value = ("ig-user-1", "token-secret-abc")
    mock_urlopen.side_effect = [
        _quotaOk(),
        _mockResponse({"id": "container-1"}),
        _mockResponse({"id": "media-1"}),
        _mockResponse({"permalink": "https://instagram.com/p/abc"}),
    ]

    publisher = InstagramPublisher()
    result = publisher.publish(_request(media=[_jpegItem()]))

    assert result.ok is True
    assert result.permalink == "https://instagram.com/p/abc"
    assert result.platformPostId == "media-1"

    media_call = mock_urlopen.call_args_list[1]
    media_req = media_call[0][0]
    assert media_req.full_url == "https://graph.facebook.com/v25.0/ig-user-1/media"
    assert "image_url=" in media_req.data.decode("utf-8")

    publish_call = mock_urlopen.call_args_list[2]
    publish_req = publish_call[0][0]
    assert publish_req.full_url == "https://graph.facebook.com/v25.0/ig-user-1/media_publish"
    assert "creation_id=container-1" in publish_req.data.decode("utf-8")


# --- onContainerCreated ordering ---------------------------------------------------


@patch("social.publishers.instagram.getInstagramCredentials")
@patch("social.publishers.instagram.urlopen")
def test_on_container_created_invoked_before_media_publish(mock_urlopen, mock_creds):
    from social.publishers.instagram import InstagramPublisher

    mock_creds.return_value = ("ig-user-1", "token-secret-abc")
    events = []

    def _urlopen_side_effect(req, timeout=None):
        if "media_publish" in req.full_url:
            events.append("media_publish")
            return _mockResponse({"id": "media-1"})
        if "content_publishing_limit" in req.full_url:
            return _quotaOk()
        if req.full_url.endswith("/permalink") or "fields=permalink" in req.full_url:
            return _mockResponse({"permalink": "https://instagram.com/p/abc"})
        events.append("create_container")
        return _mockResponse({"id": "container-1"})

    mock_urlopen.side_effect = _urlopen_side_effect

    def _onCreated(containerId):
        events.append(f"onContainerCreated:{containerId}")

    publisher = InstagramPublisher()
    result = publisher.publish(_request(media=[_jpegItem()], onContainerCreated=_onCreated))

    assert result.ok is True
    assert events == ["create_container", "onContainerCreated:container-1", "media_publish"]


@patch("social.publishers.instagram.getInstagramCredentials")
@patch("social.publishers.instagram.urlopen")
def test_on_container_created_none_does_not_crash(mock_urlopen, mock_creds):
    from social.publishers.instagram import InstagramPublisher

    mock_creds.return_value = ("ig-user-1", "token-secret-abc")
    mock_urlopen.side_effect = [
        _quotaOk(),
        _mockResponse({"id": "container-1"}),
        _mockResponse({"id": "media-1"}),
        _mockResponse({"permalink": "https://instagram.com/p/abc"}),
    ]

    publisher = InstagramPublisher()
    result = publisher.publish(_request(media=[_jpegItem()], onContainerCreated=None))
    assert result.ok is True


# --- single video ------------------------------------------------------------------


@patch("social.publishers.instagram.getInstagramCredentials")
@patch("social.publishers.instagram.urlopen")
def test_single_video_creates_reels_container_and_returns_pending(mock_urlopen, mock_creds):
    from social.publishers.instagram import InstagramPublisher

    mock_creds.return_value = ("ig-user-1", "token-secret-abc")
    mock_urlopen.side_effect = [
        _quotaOk(),
        _mockResponse({"id": "container-vid-1"}),
    ]

    publisher = InstagramPublisher()
    result = publisher.publish(_request(media=[_mp4Item()]))

    assert result.pending is True
    assert result.containerId == "container-vid-1"
    assert result.checkAfterSec == 60

    media_req = mock_urlopen.call_args_list[1][0][0]
    body = media_req.data.decode("utf-8")
    assert "media_type=REELS" in body
    assert "video_url=" in body


# --- image-only carousel ------------------------------------------------------------


@patch("social.publishers.instagram.getInstagramCredentials")
@patch("social.publishers.instagram.urlopen")
def test_image_only_carousel_children_then_parent_then_publish(mock_urlopen, mock_creds):
    from social.publishers.instagram import InstagramPublisher

    mock_creds.return_value = ("ig-user-1", "token-secret-abc")
    mock_urlopen.side_effect = [
        _quotaOk(),
        _mockResponse({"id": "child-1"}),
        _mockResponse({"id": "child-2"}),
        _mockResponse({"id": "child-3"}),
        _mockResponse({"id": "parent-1"}),
        _mockResponse({"id": "media-1"}),
        _mockResponse({"permalink": "https://instagram.com/p/carousel"}),
    ]

    media = [_jpegItem(url=f"https://s3.example.com/{i}.jpg") for i in range(3)]
    publisher = InstagramPublisher()
    result = publisher.publish(_request(media=media))

    assert result.ok is True

    for i in range(1, 4):
        child_req = mock_urlopen.call_args_list[i][0][0]
        assert "is_carousel_item=true" in child_req.data.decode("utf-8")

    parent_req = mock_urlopen.call_args_list[4][0][0]
    parent_body = parent_req.data.decode("utf-8")
    assert "media_type=CAROUSEL" in parent_body
    assert "children=child-1%2Cchild-2%2Cchild-3" in parent_body

    publish_req = mock_urlopen.call_args_list[5][0][0]
    assert "creation_id=parent-1" in publish_req.data.decode("utf-8")


# --- carousel with a video child -----------------------------------------------------


@patch("social.publishers.instagram.getInstagramCredentials")
@patch("social.publishers.instagram.urlopen")
def test_carousel_with_video_child_returns_pending(mock_urlopen, mock_creds):
    from social.publishers.instagram import InstagramPublisher

    mock_creds.return_value = ("ig-user-1", "token-secret-abc")
    mock_urlopen.side_effect = [
        _quotaOk(),
        _mockResponse({"id": "child-img-1"}),
        _mockResponse({"id": "child-vid-1"}),
    ]

    media = [_jpegItem(), _mp4Item()]
    publisher = InstagramPublisher()
    result = publisher.publish(_request(media=media))

    assert result.pending is True
    parsed = json.loads(result.containerId)
    assert parsed["childIds"] == ["child-img-1", "child-vid-1"]
    assert parsed["videoChildIds"] == ["child-vid-1"]


# --- checkPending -------------------------------------------------------------------


@patch("social.publishers.instagram.getInstagramCredentials")
@patch("social.publishers.instagram.urlopen")
def test_check_pending_finished_publishes_and_ok(mock_urlopen, mock_creds):
    from social.publishers.instagram import InstagramPublisher

    mock_creds.return_value = ("ig-user-1", "token-secret-abc")
    mock_urlopen.side_effect = [
        _mockResponse({"status_code": "FINISHED", "status": "ok"}),
        _mockResponse({"id": "media-1"}),
        _mockResponse({"permalink": "https://instagram.com/p/abc"}),
    ]

    publisher = InstagramPublisher()
    result = publisher.checkPending(_request(media=[_mp4Item()]), "container-vid-1", 1)

    assert result.ok is True
    assert result.permalink == "https://instagram.com/p/abc"


@patch("social.publishers.instagram.getInstagramCredentials")
@patch("social.publishers.instagram.urlopen")
def test_check_pending_in_progress_is_pending_and_backoff(mock_urlopen, mock_creds):
    from social.publishers.instagram import InstagramPublisher

    mock_creds.return_value = ("ig-user-1", "token-secret-abc")
    mock_urlopen.side_effect = [_mockResponse({"status_code": "IN_PROGRESS", "status": "processing"})]

    publisher = InstagramPublisher()
    result = publisher.checkPending(_request(media=[_mp4Item()]), "container-vid-1", 2)
    assert result.pending is True
    assert result.checkAfterSec == 60


@patch("social.publishers.instagram.getInstagramCredentials")
@patch("social.publishers.instagram.urlopen")
def test_check_pending_in_progress_backoff_slows_after_5_checks(mock_urlopen, mock_creds):
    from social.publishers.instagram import InstagramPublisher

    mock_creds.return_value = ("ig-user-1", "token-secret-abc")
    mock_urlopen.side_effect = [_mockResponse({"status_code": "IN_PROGRESS", "status": "processing"})]

    publisher = InstagramPublisher()
    result = publisher.checkPending(_request(media=[_mp4Item()]), "container-vid-1", 9)
    assert result.pending is True
    assert result.checkAfterSec == 300


@patch("social.publishers.instagram.getInstagramCredentials")
@patch("social.publishers.instagram.urlopen")
def test_check_pending_error_status_ok_false_with_opaque_status(mock_urlopen, mock_creds):
    from social.publishers.instagram import InstagramPublisher

    mock_creds.return_value = ("ig-user-1", "token-secret-abc")
    mock_urlopen.side_effect = [_mockResponse({"status_code": "ERROR", "status": "some-opaque-reason-xyz"})]

    publisher = InstagramPublisher()
    result = publisher.checkPending(_request(media=[_mp4Item()]), "container-vid-1", 1)
    assert result.ok is False
    assert "some-opaque-reason-xyz" in result.error


@patch("social.publishers.instagram.getInstagramCredentials")
@patch("social.publishers.instagram.urlopen")
def test_check_pending_expired_status_mentions_recreation(mock_urlopen, mock_creds):
    from social.publishers.instagram import InstagramPublisher

    mock_creds.return_value = ("ig-user-1", "token-secret-abc")
    mock_urlopen.side_effect = [_mockResponse({"status_code": "EXPIRED", "status": "expired"})]

    publisher = InstagramPublisher()
    result = publisher.checkPending(_request(media=[_mp4Item()]), "container-vid-1", 1)
    assert result.ok is False
    assert "recreat" in result.error.lower()


@patch("social.publishers.instagram.getInstagramCredentials")
@patch("social.publishers.instagram.urlopen")
def test_check_pending_published_status_is_ok_true_anti_duplicate(mock_urlopen, mock_creds):
    from social.publishers.instagram import InstagramPublisher

    mock_creds.return_value = ("ig-user-1", "token-secret-abc")
    mock_urlopen.side_effect = [
        _mockResponse({"status_code": "PUBLISHED", "status": "ok"}),
        _mockResponse({"permalink": "https://instagram.com/p/already-published"}),
    ]

    publisher = InstagramPublisher()
    result = publisher.checkPending(_request(media=[_mp4Item()]), "container-vid-1", 1)
    assert result.ok is True
    assert result.permalink == "https://instagram.com/p/already-published"


@patch("social.publishers.instagram.getInstagramCredentials")
@patch("social.publishers.instagram.urlopen")
def test_check_pending_unrecognised_status_code_ok_false_naming_it(mock_urlopen, mock_creds):
    from social.publishers.instagram import InstagramPublisher

    mock_creds.return_value = ("ig-user-1", "token-secret-abc")
    mock_urlopen.side_effect = [_mockResponse({"status_code": "SOMETHING_NEW", "status": "?"})]

    publisher = InstagramPublisher()
    result = publisher.checkPending(_request(media=[_mp4Item()]), "container-vid-1", 1)
    assert result.ok is False
    assert "SOMETHING_NEW" in result.error


@patch("social.publishers.instagram.getInstagramCredentials")
@patch("social.publishers.instagram.urlopen")
def test_check_pending_carousel_video_children_finished_assembles_and_publishes(mock_urlopen, mock_creds):
    from social.publishers.instagram import InstagramPublisher

    mock_creds.return_value = ("ig-user-1", "token-secret-abc")
    containerId = json.dumps({"childIds": ["child-img-1", "child-vid-1"], "videoChildIds": ["child-vid-1"]})
    mock_urlopen.side_effect = [
        _mockResponse({"status_code": "FINISHED", "status": "ok"}),  # video child status check
        _mockResponse({"id": "parent-1"}),  # parent creation
        _mockResponse({"id": "media-1"}),  # media_publish
        _mockResponse({"permalink": "https://instagram.com/p/carousel-vid"}),  # permalink
    ]

    events = []

    def _onCreated(cid):
        events.append(cid)

    publisher = InstagramPublisher()
    result = publisher.checkPending(
        _request(media=[_jpegItem(), _mp4Item()], onContainerCreated=_onCreated), containerId, 1
    )

    assert result.ok is True
    assert result.permalink == "https://instagram.com/p/carousel-vid"
    assert events == ["parent-1"]

    parent_req = mock_urlopen.call_args_list[1][0][0]
    assert "children=child-img-1%2Cchild-vid-1" in parent_req.data.decode("utf-8")


def test_check_pending_malformed_container_id_clean_failure_no_exception():
    from social.publishers.instagram import InstagramPublisher

    publisher = InstagramPublisher()
    with patch("social.publishers.instagram.urlopen") as mock_urlopen:
        result = publisher.checkPending(_request(media=[_mp4Item()]), "{not valid json", 1)
    assert result.ok is False
    mock_urlopen.assert_not_called()

    with patch("social.publishers.instagram.urlopen") as mock_urlopen2:
        result2 = publisher.checkPending(_request(media=[_mp4Item()]), "", 1)
    assert result2.ok is False
    mock_urlopen2.assert_not_called()


# --- quota ---------------------------------------------------------------------------


@patch("social.publishers.instagram.getInstagramCredentials")
@patch("social.publishers.instagram.urlopen")
def test_quota_exhausted_ok_false_naming_both_numbers_no_media_call(mock_urlopen, mock_creds):
    from social.publishers.instagram import InstagramPublisher

    mock_creds.return_value = ("ig-user-1", "token-secret-abc")
    mock_urlopen.side_effect = [_quotaOk(usage=100, total=100)]

    publisher = InstagramPublisher()
    result = publisher.publish(_request(media=[_jpegItem()]))

    assert result.ok is False
    assert "100" in result.error
    assert mock_urlopen.call_count == 1  # only the quota check -- no /media call made


@patch("social.publishers.instagram.getInstagramCredentials")
@patch("social.publishers.instagram.urlopen")
def test_quota_endpoint_erroring_publish_still_proceeds(mock_urlopen, mock_creds):
    from social.publishers.instagram import InstagramPublisher

    mock_creds.return_value = ("ig-user-1", "token-secret-abc")
    mock_urlopen.side_effect = [
        URLError("quota endpoint down"),
        _mockResponse({"id": "container-1"}),
        _mockResponse({"id": "media-1"}),
        _mockResponse({"permalink": "https://instagram.com/p/abc"}),
    ]

    publisher = InstagramPublisher()
    result = publisher.publish(_request(media=[_jpegItem()]))
    assert result.ok is True


# --- error envelope ---------------------------------------------------------------------


@patch("social.publishers.instagram.getInstagramCredentials")
@patch("social.publishers.instagram.urlopen")
def test_graph_error_envelope_includes_fbtrace_id_and_token_hint_for_190(mock_urlopen, mock_creds):
    from social.publishers.instagram import InstagramPublisher

    mock_creds.return_value = ("ig-user-1", "token-secret-abc")
    err = _httpError(401, message="Error validating access token", err_code=190, subcode=463, fbtrace="TraceABC123")
    mock_urlopen.side_effect = [_quotaOk(), err]

    publisher = InstagramPublisher()
    result = publisher.publish(_request(media=[_jpegItem()]))

    assert result.ok is False
    assert "TraceABC123" in result.error
    assert "token" in result.error.lower()


# --- permalink fetch failure after success ------------------------------------------------


@patch("social.publishers.instagram.getInstagramCredentials")
@patch("social.publishers.instagram.urlopen")
def test_permalink_fetch_failure_still_ok_true(mock_urlopen, mock_creds):
    from social.publishers.instagram import InstagramPublisher

    mock_creds.return_value = ("ig-user-1", "token-secret-abc")
    permalink_err = URLError("permalink fetch timed out")
    mock_urlopen.side_effect = [
        _quotaOk(),
        _mockResponse({"id": "container-1"}),
        _mockResponse({"id": "media-1"}),
        permalink_err,
    ]

    publisher = InstagramPublisher()
    result = publisher.publish(_request(media=[_jpegItem()]))

    assert result.ok is True
    assert result.permalink is None
    assert result.platformPostId == "media-1"


# --- no token leakage ----------------------------------------------------------------------


@patch("social.publishers.instagram.getInstagramCredentials")
@patch("social.publishers.instagram.urlopen")
def test_no_token_leakage_in_errors_or_logs(mock_urlopen, mock_creds, caplog):
    from social.publishers.instagram import InstagramPublisher

    sentinel_token = "SENTINEL-TOKEN-DO-NOT-LEAK-9f8e7d6c"
    mock_creds.return_value = ("ig-user-1", sentinel_token)

    err = _httpError(401, message="Error validating access token", err_code=190, subcode=467, fbtrace="TraceDEF456")
    mock_urlopen.side_effect = [_quotaOk(), err]

    publisher = InstagramPublisher()
    with caplog.at_level("DEBUG"):
        result = publisher.publish(_request(media=[_jpegItem()]))

    assert result.ok is False
    assert sentinel_token not in (result.error or "")
    for record in caplog.records:
        assert sentinel_token not in record.getMessage()


@patch("social.publishers.instagram.getInstagramCredentials")
@patch("social.publishers.instagram.urlopen")
def test_no_token_leakage_on_network_error(mock_urlopen, mock_creds, caplog):
    from social.publishers.instagram import InstagramPublisher

    sentinel_token = "SENTINEL-TOKEN-DO-NOT-LEAK-9f8e7d6c"
    mock_creds.return_value = ("ig-user-1", sentinel_token)
    mock_urlopen.side_effect = [URLError("network is down"), URLError("network is down")]

    publisher = InstagramPublisher()
    with caplog.at_level("DEBUG"):
        result = publisher.publish(_request(media=[_jpegItem()]))

    assert result.ok is False
    assert sentinel_token not in (result.error or "")
    for record in caplog.records:
        assert sentinel_token not in record.getMessage()


# --- registry ---------------------------------------------------------------------


def test_get_publisher_instagram_returns_the_class():
    from social.publishers import getPublisher
    from social.publishers.instagram import InstagramPublisher

    assert getPublisher("instagram") is InstagramPublisher
