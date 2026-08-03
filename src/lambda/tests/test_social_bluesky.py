"""Unit tests for the Bluesky publisher (src/lambda/social/publishers/bluesky.py)
and the publisher registry. urllib and SSM are mocked per house style (see
test_tools_shortener.py / test_visitor_network.py for the patch conventions
used elsewhere in this repo) — no moto, no real network calls."""
import json
import sys
from datetime import datetime
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


def _request():
    from social.publishers.base import PublishRequest
    return PublishRequest(accountId="test-account", text="hello world", media=[], links=[])


# --- session / auth threading ----------------------------------------------------


@patch("social.publishers.bluesky.getBlueskyCredentials")
@patch("social.publishers.bluesky.urlopen")
def test_create_session_called_with_identifier_and_password_jwt_threaded(mock_urlopen, mock_creds):
    from social.publishers.bluesky import BlueskyPublisher

    mock_creds.return_value = ("alice.bsky.social", "app-password-123")
    mock_urlopen.side_effect = [
        _mockResponse({"accessJwt": "jwt-abc", "did": "did:plc:alice"}),
        _mockResponse({"uri": "at://did:plc:alice/app.bsky.feed.post/rkey123", "cid": "cid1"}),
    ]

    publisher = BlueskyPublisher()
    result = publisher.publish(_request())

    assert result.ok is True

    session_call = mock_urlopen.call_args_list[0]
    session_req = session_call[0][0]
    assert "createSession" in session_req.full_url
    body = json.loads(session_req.data.decode("utf-8"))
    assert body == {"identifier": "alice.bsky.social", "password": "app-password-123"}

    record_call = mock_urlopen.call_args_list[1]
    record_req = record_call[0][0]
    assert record_req.headers.get("Authorization") == "Bearer jwt-abc"


# --- record shape -----------------------------------------------------------------


@patch("social.publishers.bluesky.getBlueskyCredentials")
@patch("social.publishers.bluesky.urlopen")
def test_record_shape_type_createdat_langs_facets_omitted_when_empty(mock_urlopen, mock_creds):
    from social.publishers.bluesky import BlueskyPublisher

    mock_creds.return_value = ("alice.bsky.social", "pw")
    mock_urlopen.side_effect = [
        _mockResponse({"accessJwt": "jwt-abc", "did": "did:plc:alice"}),
        _mockResponse({"uri": "at://did:plc:alice/app.bsky.feed.post/rkey123", "cid": "cid1"}),
    ]

    publisher = BlueskyPublisher()
    result = publisher.publish(_request())
    assert result.ok is True

    record_req = mock_urlopen.call_args_list[1][0][0]
    payload = json.loads(record_req.data.decode("utf-8"))
    record = payload["record"]

    assert record["$type"] == "app.bsky.feed.post"
    assert record["text"] == "hello world"
    assert record["langs"] == ["en"]
    assert record["createdAt"].endswith("Z")
    # Must parse as ISO-8601.
    datetime.fromisoformat(record["createdAt"].replace("Z", "+00:00"))
    assert "facets" not in record
    assert "embed" not in record
    assert payload["repo"] == "did:plc:alice"
    assert payload["collection"] == "app.bsky.feed.post"


@patch("social.publishers.bluesky.getBlueskyCredentials")
@patch("social.publishers.bluesky.urlopen")
def test_record_includes_facets_when_text_has_a_link(mock_urlopen, mock_creds):
    from social.publishers.base import PublishRequest
    from social.publishers.bluesky import BlueskyPublisher

    mock_creds.return_value = ("alice.bsky.social", "pw")
    mock_urlopen.side_effect = [
        _mockResponse({"accessJwt": "jwt-abc", "did": "did:plc:alice"}),
        _mockResponse({"uri": "at://did:plc:alice/app.bsky.feed.post/rkey123", "cid": "cid1"}),
    ]

    publisher = BlueskyPublisher()
    request = PublishRequest(accountId="a", text="see https://example.com", media=[], links=[])
    result = publisher.publish(request)
    assert result.ok is True

    record_req = mock_urlopen.call_args_list[1][0][0]
    record = json.loads(record_req.data.decode("utf-8"))["record"]
    assert "facets" in record
    assert record["facets"][0]["features"][0]["uri"] == "https://example.com"


# --- image embed --------------------------------------------------------------


@patch("social.publishers.bluesky.getBlueskyCredentials")
@patch("social.publishers.bluesky.urlopen")
def test_image_embed_shape_uses_inner_blob_object(mock_urlopen, mock_creds):
    from social.publishers.base import PublishRequest
    from social.publishers.bluesky import BlueskyPublisher

    mock_creds.return_value = ("alice.bsky.social", "pw")
    blob_obj = {"$type": "blob", "ref": {"$link": "bafyabc"}, "mimeType": "image/jpeg", "size": 12}
    mock_urlopen.side_effect = [
        _mockResponse({"accessJwt": "jwt-abc", "did": "did:plc:alice"}),
        _mockResponse({"blob": blob_obj}),  # uploadBlob response wraps blob inside "blob"
        _mockResponse({"uri": "at://did:plc:alice/app.bsky.feed.post/rkey123", "cid": "cid1"}),
    ]

    publisher = BlueskyPublisher()
    request = PublishRequest(
        accountId="a",
        text="a photo",
        media=[{"bytes": b"fake-jpeg-bytes", "mimeType": "image/jpeg", "alt": "a cat"}],
        links=[],
    )
    result = publisher.publish(request)
    assert result.ok is True

    # Blob upload call: raw bytes body, mime-typed Content-Type, bearer auth.
    blob_req = mock_urlopen.call_args_list[1][0][0]
    assert blob_req.data == b"fake-jpeg-bytes"
    assert blob_req.headers.get("Content-type") == "image/jpeg"
    assert blob_req.headers.get("Authorization") == "Bearer jwt-abc"

    record_req = mock_urlopen.call_args_list[2][0][0]
    record = json.loads(record_req.data.decode("utf-8"))["record"]
    assert record["embed"]["$type"] == "app.bsky.embed.images"
    assert record["embed"]["images"] == [{"alt": "a cat", "image": blob_obj}]


# --- validation: no HTTP calls made -----------------------------------------------


def test_more_than_4_images_validation_error_no_http_calls():
    from social.publishers.base import PublishRequest
    from social.publishers.bluesky import BlueskyPublisher

    media = [{"bytes": b"x", "mimeType": "image/jpeg", "alt": ""} for _ in range(5)]
    request = PublishRequest(accountId="a", text="too many", media=media, links=[])

    publisher = BlueskyPublisher()
    with patch("social.publishers.bluesky.urlopen") as mock_urlopen:
        result = publisher.publish(request)

    assert result.ok is False
    assert "4 images" in result.error or "images" in result.error
    mock_urlopen.assert_not_called()

    errors = publisher.validate(request)
    assert any("images" in e for e in errors)


def test_image_over_1mb_validation_error_names_size_no_upload():
    from social.publishers.base import PublishRequest
    from social.publishers.bluesky import BlueskyPublisher

    oversized = b"x" * 1_000_001
    request = PublishRequest(
        accountId="a", text="big pic", media=[{"bytes": oversized, "mimeType": "image/jpeg", "alt": ""}], links=[]
    )

    publisher = BlueskyPublisher()
    errors = publisher.validate(request)
    assert len(errors) == 1
    assert "1000001" in errors[0] or "1,000,001" in errors[0]

    with patch("social.publishers.bluesky.urlopen") as mock_urlopen:
        result = publisher.publish(request)
    assert result.ok is False
    mock_urlopen.assert_not_called()


def test_text_over_300_graphemes_validation_error():
    from social.publishers.base import PublishRequest
    from social.publishers.bluesky import BlueskyPublisher

    request = PublishRequest(accountId="a", text="x" * 301, media=[], links=[])
    publisher = BlueskyPublisher()
    errors = publisher.validate(request)
    assert len(errors) == 1
    assert "300" in errors[0]


# --- error handling ------------------------------------------------------------


@patch("social.publishers.bluesky.getBlueskyCredentials")
@patch("social.publishers.bluesky.urlopen")
def test_http_error_with_bluesky_json_body_surfaces_message(mock_urlopen, mock_creds):
    from social.publishers.bluesky import BlueskyPublisher

    mock_creds.return_value = ("alice.bsky.social", "wrong-password")
    error_body = json.dumps({"error": "AuthenticationRequired", "message": "Invalid identifier or password"}).encode()
    http_err = HTTPError(
        url="https://bsky.social/xrpc/com.atproto.server.createSession",
        code=401,
        msg="Unauthorized",
        hdrs=None,
        fp=None,
    )
    http_err.read = MagicMock(return_value=error_body)
    mock_urlopen.side_effect = http_err

    publisher = BlueskyPublisher()
    result = publisher.publish(_request())

    assert result.ok is False
    assert result.error == "Invalid identifier or password"


@patch("social.publishers.bluesky.getBlueskyCredentials")
@patch("social.publishers.bluesky.urlopen")
def test_url_error_clean_failure_not_a_traceback(mock_urlopen, mock_creds):
    from social.publishers.bluesky import BlueskyPublisher

    mock_creds.return_value = ("alice.bsky.social", "pw")
    mock_urlopen.side_effect = URLError("Name or service not known")

    publisher = BlueskyPublisher()
    result = publisher.publish(_request())

    assert result.ok is False
    assert isinstance(result.error, str)
    assert "Name or service not known" in result.error


# --- permalink ------------------------------------------------------------------


@patch("social.publishers.bluesky.getBlueskyCredentials")
@patch("social.publishers.bluesky.urlopen")
def test_permalink_built_correctly_from_at_uri(mock_urlopen, mock_creds):
    from social.publishers.bluesky import BlueskyPublisher

    mock_creds.return_value = ("alice.bsky.social", "pw")
    mock_urlopen.side_effect = [
        _mockResponse({"accessJwt": "jwt-abc", "did": "did:plc:alice"}),
        _mockResponse({"uri": "at://did:plc:alice/app.bsky.feed.post/3jzz9zq2xyz2y", "cid": "cid1"}),
    ]

    publisher = BlueskyPublisher()
    result = publisher.publish(_request())

    assert result.ok is True
    assert result.permalink == "https://bsky.app/profile/alice.bsky.social/post/3jzz9zq2xyz2y"
    assert result.platformPostId == "at://did:plc:alice/app.bsky.feed.post/3jzz9zq2xyz2y"


# --- registry ---------------------------------------------------------------------


def test_get_publisher_bluesky_returns_the_class():
    from social.publishers import getPublisher
    from social.publishers.bluesky import BlueskyPublisher

    assert getPublisher("bluesky") is BlueskyPublisher


def test_get_publisher_unknown_platform_raises_cleanly():
    from social.publishers import UnknownPublisherError, getPublisher

    with pytest.raises(UnknownPublisherError):
        getPublisher("instagram")


# --- countGraphemes (phase 4) -------------------------------------------------------------


def test_grapheme_count_plain_ascii():
    from social.publishers.bluesky import countGraphemes

    assert countGraphemes("hello world") == 11


def test_grapheme_count_combining_mark_counts_as_one():
    from social.publishers.bluesky import countGraphemes

    # "e" + COMBINING ACUTE ACCENT (U+0301) -- two code points, one grapheme.
    text = "é"
    assert len(text) == 2
    assert countGraphemes(text) == 1


def test_grapheme_count_zwj_family_emoji_is_one():
    from social.publishers.bluesky import countGraphemes

    family = "\U0001F468\u200d\U0001F469\u200d\U0001F467\u200d\U0001F466"  # man-woman-girl-boy
    assert len(family) == 7
    assert countGraphemes(family) == 1


def test_grapheme_count_flag_is_one():
    from social.publishers.bluesky import countGraphemes

    flag = "\U0001F1E6\U0001F1FA"  # regional indicators A + U -> Australia flag
    assert len(flag) == 2
    assert countGraphemes(flag) == 1


def test_grapheme_count_emoji_with_skin_tone_is_one():
    from social.publishers.bluesky import countGraphemes

    thumbsUp = "\U0001F44D\U0001F3FD"  # THUMBS UP + medium skin tone modifier
    assert len(thumbsUp) == 2
    assert countGraphemes(thumbsUp) == 1


def test_grapheme_count_300_family_emoji_passes_validation():
    from social.publishers.base import PublishRequest
    from social.publishers.bluesky import BlueskyPublisher, countGraphemes

    family = "\U0001F468\u200d\U0001F469\u200d\U0001F467\u200d\U0001F466"
    text = family * 300
    assert len(text) == 2100  # 7 code points x 300 -- would over-count under the old len()-based check
    assert countGraphemes(text) == 300

    request = PublishRequest(accountId="a", text=text, media=[], links=[])
    errors = BlueskyPublisher().validate(request)
    assert errors == []


def test_grapheme_count_301_plain_chars_still_fails_validation():
    from social.publishers.base import PublishRequest
    from social.publishers.bluesky import BlueskyPublisher

    request = PublishRequest(accountId="a", text="x" * 301, media=[], links=[])
    errors = BlueskyPublisher().validate(request)
    assert len(errors) == 1
    assert "301" in errors[0]
    assert "300" in errors[0]
