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
def test_listMemes_guest_cache_returns_200(mock_list_memes):
    """GET /memes without auth (cache-only) returns 200 for guests."""
    from api.handler import handler
    mock_list_memes.return_value = {"statusCode": 200, "body": '{"memes": []}'}
    event = {
        "rawPath": "/memes",
        "queryStringParameters": {},
        "requestContext": {"http": {"method": "GET", "path": "/memes"}},
    }
    result = handler(event, None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert "memes" in body


def test_listMemes_guest_mine_returns_401():
    """GET /memes?mine=1 without auth returns 401."""
    from api.handler import handler
    event = {
        "rawPath": "/memes",
        "queryStringParameters": {"mine": "1"},
        "requestContext": {"http": {"method": "GET", "path": "/memes"}},
    }
    result = handler(event, None)
    assert result["statusCode"] == 401


@patch("api.handler._getUserCustomGroups", return_value=[])
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
