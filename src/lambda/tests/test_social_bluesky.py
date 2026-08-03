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


def _resolveHandleOk(did="did:plc:alice"):
    """The preflight resolveHandle GET's successful response -- prepend this
    to a urlopen side_effect list for any test whose publish() call is
    expected to proceed past the handle-resolution pre-flight."""
    return _mockResponse({"did": did})


# --- session / auth threading ----------------------------------------------------


@patch("social.publishers.bluesky.getBlueskyCredentials")
@patch("social.publishers.bluesky.urlopen")
def test_create_session_called_with_identifier_and_password_jwt_threaded(mock_urlopen, mock_creds):
    from social.publishers.bluesky import BlueskyPublisher

    mock_creds.return_value = ("alice.bsky.social", "app-password-123")
    mock_urlopen.side_effect = [
        _resolveHandleOk(),
        _mockResponse({"accessJwt": "jwt-abc", "did": "did:plc:alice"}),
        _mockResponse({"uri": "at://did:plc:alice/app.bsky.feed.post/rkey123", "cid": "cid1"}),
    ]

    publisher = BlueskyPublisher()
    result = publisher.publish(_request())

    assert result.ok is True

    session_call = mock_urlopen.call_args_list[1]
    session_req = session_call[0][0]
    assert "createSession" in session_req.full_url
    body = json.loads(session_req.data.decode("utf-8"))
    assert body == {"identifier": "alice.bsky.social", "password": "app-password-123"}

    record_call = mock_urlopen.call_args_list[2]
    record_req = record_call[0][0]
    assert record_req.headers.get("Authorization") == "Bearer jwt-abc"


# --- record shape -----------------------------------------------------------------


@patch("social.publishers.bluesky.getBlueskyCredentials")
@patch("social.publishers.bluesky.urlopen")
def test_record_shape_type_createdat_langs_facets_omitted_when_empty(mock_urlopen, mock_creds):
    from social.publishers.bluesky import BlueskyPublisher

    mock_creds.return_value = ("alice.bsky.social", "pw")
    mock_urlopen.side_effect = [
        _resolveHandleOk(),
        _mockResponse({"accessJwt": "jwt-abc", "did": "did:plc:alice"}),
        _mockResponse({"uri": "at://did:plc:alice/app.bsky.feed.post/rkey123", "cid": "cid1"}),
    ]

    publisher = BlueskyPublisher()
    result = publisher.publish(_request())
    assert result.ok is True

    record_req = mock_urlopen.call_args_list[2][0][0]
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
        _resolveHandleOk(),
        _mockResponse({"accessJwt": "jwt-abc", "did": "did:plc:alice"}),
        _mockResponse({"uri": "at://did:plc:alice/app.bsky.feed.post/rkey123", "cid": "cid1"}),
    ]

    publisher = BlueskyPublisher()
    request = PublishRequest(accountId="a", text="see https://example.com", media=[], links=[])
    result = publisher.publish(request)
    assert result.ok is True

    record_req = mock_urlopen.call_args_list[2][0][0]
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
        _resolveHandleOk(),
        _mockResponse({"accessJwt": "jwt-abc", "did": "did:plc:alice"}),
        _mockResponse({"blob": blob_obj}),  # uploadBlob response wraps blob inside "blob"
        _mockResponse({"uri": "at://did:plc:alice/app.bsky.feed.post/rkey123", "cid": "cid1"}),
    ]

    publisher = BlueskyPublisher()
    # Not a real JPEG -- _imageDimensions will return None for these bytes, so
    # this test's embed has no aspectRatio key (covered explicitly elsewhere).
    request = PublishRequest(
        accountId="a",
        text="a photo",
        media=[{"bytes": b"fake-jpeg-bytes", "mimeType": "image/jpeg", "alt": "a cat"}],
        links=[],
    )
    result = publisher.publish(request)
    assert result.ok is True

    # Blob upload call: raw bytes body, mime-typed Content-Type, bearer auth.
    blob_req = mock_urlopen.call_args_list[2][0][0]
    assert blob_req.data == b"fake-jpeg-bytes"
    assert blob_req.headers.get("Content-type") == "image/jpeg"
    assert blob_req.headers.get("Authorization") == "Bearer jwt-abc"

    record_req = mock_urlopen.call_args_list[3][0][0]
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
    # First call is the preflight resolveHandle (must succeed so we get past
    # it to createSession, which is what actually fails here with the wrong
    # password).
    mock_urlopen.side_effect = [_resolveHandleOk(), http_err]

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
        _resolveHandleOk(),
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

    # Was "instagram" until phase 3 registered it. Any string that is not a
    # registered platform works here -- the point is the clean failure mode,
    # not the particular name.
    with pytest.raises(UnknownPublisherError):
        getPublisher("myspace")


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


# --- deterministic rkey (phase: crash-safe republish) -----------------------------


def test_deterministic_rkey_same_inputs_produce_the_same_rkey():
    from social.publishers.bluesky import _deterministicRkey

    rkey1 = _deterministicRkey("post1:bluesky:acct-a", "2026-08-02T15:00:00Z")
    rkey2 = _deterministicRkey("post1:bluesky:acct-a", "2026-08-02T15:00:00Z")
    assert rkey1 == rkey2


def test_deterministic_rkey_different_account_id_produces_different_rkey():
    from social.publishers.bluesky import _deterministicRkey

    rkeyA = _deterministicRkey("post1:bluesky:acct-a", "2026-08-02T15:00:00Z")
    rkeyB = _deterministicRkey("post1:bluesky:acct-b", "2026-08-02T15:00:00Z")
    assert rkeyA != rkeyB


def test_deterministic_rkey_is_13_chars_of_the_sortable_base32_alphabet():
    from social.publishers.bluesky import _TID_ALPHABET, _deterministicRkey

    rkey = _deterministicRkey("post1:bluesky:acct-a", "2026-08-02T15:00:00Z")
    assert len(rkey) == 13
    assert all(c in _TID_ALPHABET for c in rkey)


def test_deterministic_rkey_decoded_timestamp_same_utc_second_as_scheduled_at():
    from social.publishers.bluesky import _TID_ALPHABET, _deterministicRkey

    scheduledAt = "2026-08-02T15:00:00Z"
    rkey = _deterministicRkey("post1:bluesky:acct-a", scheduledAt)

    value = 0
    for ch in rkey:
        value = (value << 5) | _TID_ALPHABET.index(ch)
    decodedMicros = value >> 10
    decodedSeconds = decodedMicros // 1_000_000

    expectedSeconds = int(datetime.fromisoformat(scheduledAt.replace("Z", "+00:00")).timestamp())
    assert decodedSeconds == expectedSeconds


@patch("social.publishers.bluesky.getBlueskyCredentials")
@patch("social.publishers.bluesky.urlopen")
def test_empty_idempotency_key_omits_rkey_from_create_record_payload(mock_urlopen, mock_creds):
    from social.publishers.bluesky import BlueskyPublisher

    mock_creds.return_value = ("alice.bsky.social", "pw")
    mock_urlopen.side_effect = [
        _resolveHandleOk(),
        _mockResponse({"accessJwt": "jwt-abc", "did": "did:plc:alice"}),
        _mockResponse({"uri": "at://did:plc:alice/app.bsky.feed.post/rkey123", "cid": "cid1"}),
    ]

    publisher = BlueskyPublisher()
    result = publisher.publish(_request())  # idempotencyKey defaults to ""
    assert result.ok is True

    record_req = mock_urlopen.call_args_list[2][0][0]
    payload = json.loads(record_req.data.decode("utf-8"))
    assert "rkey" not in payload


@patch("social.publishers.bluesky.getBlueskyCredentials")
@patch("social.publishers.bluesky.urlopen")
def test_nonempty_idempotency_key_includes_rkey_in_create_record_payload(mock_urlopen, mock_creds):
    from social.publishers.base import PublishRequest
    from social.publishers.bluesky import BlueskyPublisher, _deterministicRkey

    mock_creds.return_value = ("alice.bsky.social", "pw")
    idempotencyKey = "post1:bluesky:a"
    scheduledAt = "2026-08-02T15:00:00Z"
    expectedRkey = _deterministicRkey(idempotencyKey, scheduledAt)

    mock_urlopen.side_effect = [
        _resolveHandleOk(),
        _mockResponse({"accessJwt": "jwt-abc", "did": "did:plc:alice"}),
        _mockResponse({"uri": f"at://did:plc:alice/app.bsky.feed.post/{expectedRkey}", "cid": "cid1"}),
    ]

    request = PublishRequest(
        accountId="a", text="hi", media=[], links=[], idempotencyKey=idempotencyKey, scheduledAt=scheduledAt,
    )
    publisher = BlueskyPublisher()
    result = publisher.publish(request)
    assert result.ok is True

    record_req = mock_urlopen.call_args_list[2][0][0]
    payload = json.loads(record_req.data.decode("utf-8"))
    assert payload["rkey"] == expectedRkey


@patch("social.publishers.bluesky.getBlueskyCredentials")
@patch("social.publishers.bluesky.urlopen")
def test_create_record_replay_getrecord_finds_it_returns_ok_with_permalink(mock_urlopen, mock_creds):
    """A target stuck in 'publishing' gets republished by the maintenance
    sweep -- createRecord fails (the deterministic rkey already exists from
    the crashed prior attempt) but getRecord finds it, so this must be
    treated as success rather than a hard failure."""
    from social.publishers.base import PublishRequest
    from social.publishers.bluesky import BlueskyPublisher, _deterministicRkey

    mock_creds.return_value = ("alice.bsky.social", "pw")
    idempotencyKey = "post1:bluesky:a"
    scheduledAt = "2026-08-02T15:00:00Z"
    expectedRkey = _deterministicRkey(idempotencyKey, scheduledAt)

    error_body = json.dumps({"error": "InvalidRequest", "message": "conflict"}).encode()
    create_record_err = HTTPError(
        url="https://bsky.social/xrpc/com.atproto.repo.createRecord", code=400, msg="Bad Request", hdrs=None, fp=None
    )
    create_record_err.read = MagicMock(return_value=error_body)

    mock_urlopen.side_effect = [
        _resolveHandleOk(),
        _mockResponse({"accessJwt": "jwt-abc", "did": "did:plc:alice"}),
        create_record_err,
        _mockResponse({"uri": f"at://did:plc:alice/app.bsky.feed.post/{expectedRkey}", "value": {"text": "hi"}}),
    ]

    request = PublishRequest(
        accountId="a", text="hi", media=[], links=[], idempotencyKey=idempotencyKey, scheduledAt=scheduledAt,
    )
    publisher = BlueskyPublisher()
    result = publisher.publish(request)

    assert result.ok is True
    assert expectedRkey in result.permalink
    assert result.platformPostId == f"at://did:plc:alice/app.bsky.feed.post/{expectedRkey}"

    get_record_call = mock_urlopen.call_args_list[3]
    get_record_req = get_record_call[0][0]
    assert "getRecord" in get_record_req.full_url
    assert get_record_req.headers.get("Authorization") == "Bearer jwt-abc"


@patch("social.publishers.bluesky.getBlueskyCredentials")
@patch("social.publishers.bluesky.urlopen")
def test_create_record_replay_getrecord_also_fails_returns_original_error(mock_urlopen, mock_creds):
    from social.publishers.base import PublishRequest
    from social.publishers.bluesky import BlueskyPublisher

    mock_creds.return_value = ("alice.bsky.social", "pw")

    error_body = json.dumps({"error": "InvalidRequest", "message": "record already exists (maybe)"}).encode()
    create_record_err = HTTPError(
        url="https://bsky.social/xrpc/com.atproto.repo.createRecord", code=400, msg="Bad Request", hdrs=None, fp=None
    )
    create_record_err.read = MagicMock(return_value=error_body)
    get_record_err = URLError("timed out")

    mock_urlopen.side_effect = [
        _resolveHandleOk(),
        _mockResponse({"accessJwt": "jwt-abc", "did": "did:plc:alice"}),
        create_record_err,
        get_record_err,
    ]

    request = PublishRequest(
        accountId="a", text="hi", media=[], links=[],
        idempotencyKey="post1:bluesky:a", scheduledAt="2026-08-02T15:00:00Z",
    )
    publisher = BlueskyPublisher()
    result = publisher.publish(request)

    assert result.ok is False
    assert result.error == "record already exists (maybe)"


# --- image dimensions (stdlib-only aspectRatio parsing) -----------------------------


def _pngFixture(width, height):
    import struct

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr_data = struct.pack(">II", width, height) + b"\x08\x06\x00\x00\x00"
    chunk = struct.pack(">I", len(ihdr_data)) + b"IHDR" + ihdr_data + b"\x00\x00\x00\x00"
    return sig + chunk


def _jpegFixture(width, height):
    import struct

    soi = b"\xff\xd8"
    num_components = 1
    payload = b"\x08" + struct.pack(">H", height) + struct.pack(">H", width) + bytes([num_components]) + b"\x01\x11\x00"
    seg_len = 2 + len(payload)
    sof = b"\xff\xc0" + struct.pack(">H", seg_len) + payload
    eoi = b"\xff\xd9"
    return soi + sof + eoi


def _webpVp8Fixture(width, height):
    import struct

    frame_tag = b"\x00\x00\x00"
    sync = b"\x9d\x01\x2a"
    dims = struct.pack("<H", width & 0x3FFF) + struct.pack("<H", height & 0x3FFF)
    chunk_data = frame_tag + sync + dims
    chunk = b"VP8 " + struct.pack("<I", len(chunk_data)) + chunk_data
    riff_size = 4 + len(chunk)
    return b"RIFF" + struct.pack("<I", riff_size) + b"WEBP" + chunk


def _webpVp8LFixture(width, height):
    import struct

    sig = b"\x2f"
    bits = ((width - 1) & 0x3FFF) | (((height - 1) & 0x3FFF) << 14)
    payload = sig + struct.pack("<I", bits)
    chunk = b"VP8L" + struct.pack("<I", len(payload)) + payload
    riff_size = 4 + len(chunk)
    return b"RIFF" + struct.pack("<I", riff_size) + b"WEBP" + chunk


def _webpVp8XFixture(width, height):
    import struct

    flags = b"\x00\x00\x00\x00"
    dims = struct.pack("<I", width - 1)[:3] + struct.pack("<I", height - 1)[:3]
    payload = flags + dims
    chunk = b"VP8X" + struct.pack("<I", len(payload)) + payload
    riff_size = 4 + len(chunk)
    return b"RIFF" + struct.pack("<I", riff_size) + b"WEBP" + chunk


def test_image_dimensions_png():
    from social.publishers.bluesky import _imageDimensions

    assert _imageDimensions(_pngFixture(120, 80)) == (120, 80)


def test_image_dimensions_jpeg():
    from social.publishers.bluesky import _imageDimensions

    assert _imageDimensions(_jpegFixture(200, 100)) == (200, 100)


def test_image_dimensions_webp_vp8_lossy():
    from social.publishers.bluesky import _imageDimensions

    assert _imageDimensions(_webpVp8Fixture(64, 48)) == (64, 48)


def test_image_dimensions_webp_vp8l_lossless():
    from social.publishers.bluesky import _imageDimensions

    assert _imageDimensions(_webpVp8LFixture(64, 48)) == (64, 48)


def test_image_dimensions_webp_vp8x_extended():
    from social.publishers.bluesky import _imageDimensions

    assert _imageDimensions(_webpVp8XFixture(500, 300)) == (500, 300)


def test_image_dimensions_garbage_bytes_returns_none():
    from social.publishers.bluesky import _imageDimensions

    assert _imageDimensions(b"not an image, just some junk bytes") is None
    assert _imageDimensions(b"") is None
    assert _imageDimensions(b"\x89PNG\r\n\x1a\n\x00\x00") is None  # truncated PNG


@patch("social.publishers.bluesky.getBlueskyCredentials")
@patch("social.publishers.bluesky.urlopen")
def test_malformed_image_bytes_publish_still_succeeds_no_aspect_ratio_key(mock_urlopen, mock_creds):
    from social.publishers.base import PublishRequest
    from social.publishers.bluesky import BlueskyPublisher

    mock_creds.return_value = ("alice.bsky.social", "pw")
    blob_obj = {"$type": "blob", "ref": {"$link": "bafyabc"}, "mimeType": "image/jpeg", "size": 3}
    mock_urlopen.side_effect = [
        _resolveHandleOk(),
        _mockResponse({"accessJwt": "jwt-abc", "did": "did:plc:alice"}),
        _mockResponse({"blob": blob_obj}),
        _mockResponse({"uri": "at://did:plc:alice/app.bsky.feed.post/rkey123", "cid": "cid1"}),
    ]

    request = PublishRequest(
        accountId="a", text="a photo",
        media=[{"bytes": b"xyz", "mimeType": "image/jpeg", "alt": "junk"}],
        links=[],
    )
    publisher = BlueskyPublisher()
    result = publisher.publish(request)
    assert result.ok is True

    record_req = mock_urlopen.call_args_list[3][0][0]
    record = json.loads(record_req.data.decode("utf-8"))["record"]
    assert "aspectRatio" not in record["embed"]["images"][0]


@patch("social.publishers.bluesky.getBlueskyCredentials")
@patch("social.publishers.bluesky.urlopen")
def test_successful_publish_with_one_image_produces_aspect_ratio_in_embed(mock_urlopen, mock_creds):
    from social.publishers.base import PublishRequest
    from social.publishers.bluesky import BlueskyPublisher

    mock_creds.return_value = ("alice.bsky.social", "pw")
    blob_obj = {"$type": "blob", "ref": {"$link": "bafyabc"}, "mimeType": "image/png", "size": 100}
    png_bytes = _pngFixture(300, 150)
    mock_urlopen.side_effect = [
        _resolveHandleOk(),
        _mockResponse({"accessJwt": "jwt-abc", "did": "did:plc:alice"}),
        _mockResponse({"blob": blob_obj}),
        _mockResponse({"uri": "at://did:plc:alice/app.bsky.feed.post/rkey123", "cid": "cid1"}),
    ]

    request = PublishRequest(
        accountId="a", text="a photo",
        media=[{"bytes": png_bytes, "mimeType": "image/png", "alt": "a view"}],
        links=[],
    )
    publisher = BlueskyPublisher()
    result = publisher.publish(request)
    assert result.ok is True

    record_req = mock_urlopen.call_args_list[3][0][0]
    record = json.loads(record_req.data.decode("utf-8"))["record"]
    assert record["embed"]["images"][0]["aspectRatio"] == {"width": 300, "height": 150}


# --- handle pre-flight (bad handle vs. bad password) --------------------------------


@patch("social.publishers.bluesky.getBlueskyCredentials")
@patch("social.publishers.bluesky.urlopen")
def test_preflight_resolve_handle_http_error_fails_clean_and_never_calls_create_session(mock_urlopen, mock_creds):
    from social.publishers.bluesky import BlueskyPublisher

    mock_creds.return_value = ("typo-dhandle.bsky.social", "pw")
    resolve_err = HTTPError(
        url="https://bsky.social/xrpc/com.atproto.identity.resolveHandle",
        code=400, msg="Bad Request", hdrs=None, fp=None,
    )
    resolve_err.read = MagicMock(return_value=b'{"error":"InvalidRequest","message":"Unable to resolve handle"}')
    mock_urlopen.side_effect = resolve_err

    publisher = BlueskyPublisher()
    result = publisher.publish(_request())

    assert result.ok is False
    assert "typo-dhandle.bsky.social" in result.error
    assert mock_urlopen.call_count == 1  # only the resolveHandle preflight -- createSession never reached


@patch("social.publishers.bluesky.getBlueskyCredentials")
@patch("social.publishers.bluesky.urlopen")
def test_preflight_resolve_handle_url_error_is_transient_and_publish_proceeds(mock_urlopen, mock_creds):
    from social.publishers.bluesky import BlueskyPublisher

    mock_creds.return_value = ("alice.bsky.social", "pw")
    mock_urlopen.side_effect = [
        URLError("Name or service not known"),  # transient preflight failure -- must not block
        _mockResponse({"accessJwt": "jwt-abc", "did": "did:plc:alice"}),
        _mockResponse({"uri": "at://did:plc:alice/app.bsky.feed.post/rkey123", "cid": "cid1"}),
    ]

    publisher = BlueskyPublisher()
    result = publisher.publish(_request())

    assert result.ok is True
