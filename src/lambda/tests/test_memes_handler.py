"""Unit tests for Memes API handlers."""
import json
import os
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _event(path, method="GET", body=None, sub="user-123", groups="user"):
    """Event with JWT authorizer."""
    return {
        "rawPath": path,
        "pathParameters": {},
        "queryStringParameters": {},
        "requestContext": {
            "http": {"method": method, "path": path},
            "authorizer": {
                "jwt": {
                    "claims": {
                        "sub": sub,
                        "email": "user@example.com",
                        "cognito:groups": groups,
                    }
                }
            },
        },
        "body": json.dumps(body) if body is not None else "{}",
    }


def _admin_event(path, method="GET", body=None):
    """Event with admin (SuperAdmin) JWT authorizer."""
    return _event(path, method, body, sub="admin-123", groups="admin")


def _memes_user_event(path, method="GET", body=None):
    """Event with user in Memes custom group."""
    return _event(path, method, body, sub="memes-user-123", groups="user")


@patch("api.memes.list_memes")
def test_listMemesCache_guest_returns_200(mock_list_memes):
    """GET /memes/cache without auth returns 200 for guests."""
    from api.handler import handler
    mock_list_memes.return_value = {"statusCode": 200, "body": '{"memes": []}'}
    event = {
        "rawPath": "/memes/cache",
        "queryStringParameters": {},
        "requestContext": {"http": {"method": "GET", "path": "/memes/cache"}},
    }
    result = handler(event, None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert "memes" in body


def test_listMemesCache_guest_search_returns_401():
    """GET /memes/cache?q=foo without auth returns 401."""
    from api.handler import handler
    event = {
        "rawPath": "/memes/cache",
        "queryStringParameters": {"q": "foo"},
        "requestContext": {"http": {"method": "GET", "path": "/memes/cache"}},
    }
    result = handler(event, None)
    assert result["statusCode"] == 401


def test_listMemes_guest_returns_401():
    """GET /memes without auth returns 401 (JWT required)."""
    from api.handler import handler
    event = {
        "rawPath": "/memes",
        "queryStringParameters": {},
        "requestContext": {"http": {"method": "GET", "path": "/memes"}},
    }
    result = handler(event, None)
    assert result["statusCode"] == 401


@patch("api.memes._get_user_custom_groups", return_value=[])
def test_listMemes_mine_denied_without_creator_access(mock_custom_groups):
    """GET /memes?mine=1 with user not in Memes group returns 403."""
    from api.handler import handler
    event = _memes_user_event("/memes")
    event["queryStringParameters"] = {"mine": "1"}
    result = handler(event, None)
    assert result["statusCode"] == 403


@patch("api.handler._getUserCustomGroups", return_value=["Memes"])
@patch("api.memes.list_memes")
def test_listMemes_memes_group_can_access(mock_list_memes, mock_custom_groups):
    """GET /memes as user in Memes group can access."""
    from api.handler import handler
    mock_list_memes.return_value = {"statusCode": 200, "body": '{"memes": []}'}
    event = _memes_user_event("/memes")
    result = handler(event, None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert "memes" in body


@patch("api.handler._getUserCustomGroups", return_value=[])
@patch("api.memes.list_memes")
def test_listMemes_admin_can_access(mock_list_memes, mock_custom_groups):
    """GET /memes as SuperAdmin can access."""
    from api.handler import handler
    mock_list_memes.return_value = {"statusCode": 200, "body": '{"memes": []}'}
    event = _admin_event("/memes")
    result = handler(event, None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert "memes" in body


@patch("api.memes._get_user_custom_groups", return_value=["Memes"])
@patch("api.memes.TABLE_NAME", "test-table")
@patch("api.memes.MEDIA_BUCKET", "test-bucket")
def test_createMeme_requires_mediaKey(mock_custom_groups):
    """POST /memes without mediaKey returns 400."""
    from api.handler import handler
    event = _memes_user_event("/memes", method="POST", body={"title": "Test"})
    result = handler(event, None)
    assert result["statusCode"] == 400
    body = json.loads(result["body"])
    assert "mediakey" in body.get("error", "").lower()


@patch("api.memes._get_user_custom_groups", return_value=["Memes"])
@patch("api.memes.create_meme")
def test_createMeme_creates_meme(mock_create_meme, mock_custom_groups):
    """POST /memes with mediaKey creates meme."""
    from api.handler import handler
    mock_create_meme.return_value = {
        "statusCode": 201,
        "body": '{"id": "MEME#test-123", "title": "Test Meme"}',
    }
    event = _memes_user_event("/memes", method="POST", body={
        "mediaKey": "memes/user123/test.png",
        "title": "Test Meme",
    })
    result = handler(event, None)
    assert result["statusCode"] == 201
    body = json.loads(result["body"])
    assert "id" in body
    assert body["id"].startswith("MEME#")
    assert body.get("title") == "Test Meme"


# --- user-supplied URL fetches go through safe_fetch ---

SAFE_FETCH = "api.generate_description.safe_fetch"


def _json_response(body, status=200):
    return {"statusCode": status, "body": json.dumps(body)}


def test_validate_image_url_ok_and_rejects_non_image():
    from api.memes import _validate_image_url, MAX_IMAGE_SIZE_BYTES
    with patch(SAFE_FETCH, return_value=(b"x", "image/png", "u")) as fetch:
        assert _validate_image_url("https://example.com/a.png") == (True, None)
    assert fetch.call_args.args[:2] == ("https://example.com/a.png", MAX_IMAGE_SIZE_BYTES)
    with patch(SAFE_FETCH, return_value=(b"x", "text/html", "u")):
        assert _validate_image_url("https://example.com/a.png") == (False, "URL does not return an image")


def test_validate_image_url_refused_host_and_oversize():
    from api.memes import _validate_image_url
    with patch(SAFE_FETCH, side_effect=ValueError("URL points to a non-public address")):
        assert _validate_image_url("http://169.254.169.254/a.png") == (False, "URL points to a non-public address")
    with patch(SAFE_FETCH, side_effect=ValueError("Response too large (max 10485760 bytes)")):
        ok, err = _validate_image_url("https://example.com/big.png")
    assert not ok and "too large" in err


@patch("api.memes.MEDIA_BUCKET", "bucket")
@patch("boto3.client")
def test_import_meme_from_url_refused_host_keeps_400_shape_and_no_s3_write(mock_boto):
    from api.memes import import_meme_from_url
    event = {"body": json.dumps({"url": "http://127.0.0.1/a.png"})}
    with patch(SAFE_FETCH, side_effect=ValueError("URL points to a non-public address")):
        result = import_meme_from_url(event, {"userId": "u1"}, _json_response)
    assert result["statusCode"] == 400
    assert json.loads(result["body"]) == {"valid": False, "error": "URL points to a non-public address"}
    mock_boto.return_value.put_object.assert_not_called()


@patch("api.memes.MEDIA_BUCKET", "bucket")
@patch("boto3.client")
def test_import_meme_from_url_oversize_refused_and_happy_path_uploads(mock_boto):
    from api.memes import import_meme_from_url
    event = {"body": json.dumps({"url": "https://example.com/a.gif"})}
    with patch(SAFE_FETCH, side_effect=ValueError("Response too large (max 10485760 bytes)")):
        assert import_meme_from_url(event, {"userId": "u1"}, _json_response)["statusCode"] == 400
    mock_boto.return_value.put_object.assert_not_called()
    mock_boto.return_value.generate_presigned_url.return_value = "https://signed"
    with patch(SAFE_FETCH, return_value=(b"GIF89a", "image/gif", "u")):
        result = import_meme_from_url(event, {"userId": "u1"}, _json_response)
    assert result["statusCode"] == 200
    assert json.loads(result["body"])["key"].endswith(".gif")
    assert mock_boto.return_value.put_object.call_args.kwargs["Body"] == b"GIF89a"
