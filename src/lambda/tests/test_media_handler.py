"""Unit tests for media-related API handlers."""
import json
import os
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _admin_event(path, method="POST", body=None):
    """Event with admin JWT authorizer."""
    return {
        "rawPath": path,
        "requestContext": {
            "http": {"method": method, "path": path},
            "authorizer": {
                "jwt": {
                    "claims": {
                        "sub": "admin-123",
                        "email": "admin@example.com",
                        "cognito:groups": "admin",
                    }
                }
            },
        },
        "body": json.dumps(body) if body is not None else "{}",
    }


def _auth_event(path, method="POST", body=None):
    """Event with non-admin JWT authorizer."""
    return {
        "rawPath": path,
        "requestContext": {
            "http": {"method": method, "path": path},
            "authorizer": {
                "jwt": {
                    "claims": {
                        "sub": "user-123",
                        "email": "user@example.com",
                        "cognito:groups": "user",
                    }
                }
            },
        },
        "body": json.dumps(body) if body is not None else "{}",
    }


def test_listMedia_returns_json():
    """GET /media without auth returns media list (public)."""
    os.environ["TABLE_NAME"] = "fus-main"
    try:
        from api.handler import handler
        event = {
            "rawPath": "/media",
            "requestContext": {"http": {"method": "GET", "path": "/media"}},
            "queryStringParameters": {},
        }
        result = handler(event, None)
        assert result["statusCode"] in (200, 500)
        assert "media" in result["body"]
    finally:
        os.environ.pop("TABLE_NAME", None)


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_listMedia_with_id_returns_404_when_not_found(mock_boto_client):
    """GET /media?id=MEDIA#xxx returns 404 when media not found."""
    from api.handler import handler
    mock_dynamo = MagicMock()
    mock_dynamo.get_item.return_value = {}
    mock_boto_client.return_value = mock_dynamo

    event = {
        "rawPath": "/media",
        "requestContext": {"http": {"method": "GET", "path": "/media"}},
        "queryStringParameters": {"id": "MEDIA#nonexistent"},
    }
    result = handler(event, None)
    assert result["statusCode"] == 404


def test_createMedia_requires_auth():
    """POST /media without auth returns 401."""
    from api.handler import handler
    event = {
        "rawPath": "/media",
        "requestContext": {"http": {"method": "POST", "path": "/media"}},
        "body": '{"mediaKey": "media/images/MEDIA#abc/x.png", "title": "Test"}',
    }
    result = handler(event, None)
    assert result["statusCode"] == 401


def test_createMedia_requires_admin():
    """POST /media with non-admin returns 403."""
    from api.handler import handler
    event = _auth_event("/media", body={"mediaKey": "media/images/MEDIA#abc/x.png", "title": "Test"})
    result = handler(event, None)
    assert result["statusCode"] == 403


@patch("api.handler.TABLE_NAME", "fus-main")
def test_createMedia_requires_mediaKey():
    """POST /media without mediaKey returns 400."""
    from api.handler import handler
    event = _admin_event("/media", body={"title": "Test"})
    result = handler(event, None)
    assert result["statusCode"] == 400
    assert "mediaKey" in result["body"]


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_createMedia_success(mock_boto_client):
    """POST /media as admin creates media item."""
    from api.handler import handler
    mock_dynamo = MagicMock()
    mock_dynamo.put_item.return_value = {}
    mock_boto_client.return_value = mock_dynamo

    event = _admin_event("/media", body={
        "id": "MEDIA#test-123",
        "mediaKey": "media/images/MEDIA#test-123/abc.png",
        "title": "My Photo",
        "description": "A test image",
        "mediaType": "image",
        "categoryIds": [],
    })
    result = handler(event, None)

    assert result["statusCode"] == 201
    body = json.loads(result["body"])
    assert body.get("id") == "MEDIA#test-123" or "MEDIA#" in body.get("id", "")
    assert body.get("title") == "My Photo"


def test_mediaUpload_requires_auth():
    """POST /media/upload without auth returns 401."""
    from api.handler import handler
    event = {
        "rawPath": "/media/upload",
        "requestContext": {"http": {"method": "POST", "path": "/media/upload"}},
        "body": '{"mediaId": "MEDIA#abc", "contentType": "image/png"}',
    }
    result = handler(event, None)
    assert result["statusCode"] == 401


@patch("api.handler.MEDIA_BUCKET", "test-media-bucket")
def test_mediaUpload_requires_mediaId():
    """POST /media/upload without mediaId returns 400."""
    from api.handler import handler
    event = _admin_event("/media/upload", body={"contentType": "image/png"})
    result = handler(event, None)
    assert result["statusCode"] == 400
    assert "mediaId" in result["body"]


@patch("api.handler.MEDIA_BUCKET", "test-media-bucket")
@patch("boto3.client")
def test_mediaUpload_returns_url_and_key(mock_boto_client):
    """POST /media/upload as admin returns uploadUrl and key."""
    from api.handler import handler
    mock_s3 = MagicMock()
    mock_s3.generate_presigned_url.return_value = "https://presigned.example/put"
    mock_boto_client.return_value = mock_s3

    event = _admin_event("/media/upload", body={
        "mediaId": "MEDIA#xyz",
        "mediaType": "image",
        "contentType": "image/png",
    })
    result = handler(event, None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert "uploadUrl" in body
    assert body["uploadUrl"] == "https://presigned.example/put"
    assert "key" in body
    assert "media/images/MEDIA#xyz/" in body["key"]
    assert body["key"].endswith(".png")


def test_setMediaStar_requires_auth():
    """POST /media/stars without auth returns 401."""
    from api.handler import handler
    event = {
        "rawPath": "/media/stars",
        "requestContext": {"http": {"method": "POST", "path": "/media/stars"}},
        "body": '{"mediaId": "MEDIA#abc", "rating": 4}',
    }
    result = handler(event, None)
    assert result["statusCode"] == 401


@patch("api.handler.TABLE_NAME", "fus-main")
def test_setMediaStar_requires_mediaId():
    """POST /media/stars without mediaId returns 400."""
    from api.handler import handler
    event = _auth_event("/media/stars", body={"rating": 4})
    result = handler(event, None)
    assert result["statusCode"] == 400
    assert "mediaId" in result["body"]


def test_listMediaCategories_requires_auth():
    """GET /media-categories without auth returns 401."""
    from api.handler import handler
    event = {
        "rawPath": "/media-categories",
        "requestContext": {"http": {"method": "GET", "path": "/media-categories"}},
    }
    result = handler(event, None)
    assert result["statusCode"] == 401


def test_listMediaCategories_requires_admin():
    """GET /media-categories with non-admin returns 403."""
    from api.handler import handler
    event = _auth_event("/media-categories", method="GET")
    event["body"] = None
    result = handler(event, None)
    assert result["statusCode"] == 403


def test_createMediaCategory_requires_admin():
    """POST /media-categories with non-admin returns 403."""
    from api.handler import handler
    event = _auth_event("/media-categories", body={"name": "Photos"})
    result = handler(event, None)
    assert result["statusCode"] == 403


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_updateMedia_thumbnailKey_success(mock_boto_client):
    """PUT /media with thumbnailKey only updates thumbnail (admin)."""
    from api.handler import handler
    mock_dynamo = MagicMock()
    mock_dynamo.update_item.return_value = {}
    mock_boto_client.return_value = mock_dynamo

    event = _admin_event("/media", method="PUT", body={
        "id": "MEDIA#test-123",
        "thumbnailKey": "media/thumbnails/MEDIA#test-123_custom.jpg",
    })
    result = handler(event, None)

    assert result["statusCode"] == 200
    mock_dynamo.update_item.assert_called_once()
    call_kw = mock_dynamo.update_item.call_args[1]
    assert "thumbnailKey" in call_kw["UpdateExpression"] or "#thumbnailKey" in call_kw["UpdateExpression"]
    assert call_kw["ExpressionAttributeValues"][":thumbnailKey"]["S"] == "media/thumbnails/MEDIA#test-123_custom.jpg"


@patch("api.handler.TABLE_NAME", "fus-main")
def test_media_all_requires_admin():
    """GET /media/all without admin returns 403."""
    from api.handler import handler
    event = _auth_event("/media/all", method="GET")
    event["body"] = None
    event["rawPath"] = "/media/all"
    event["requestContext"]["http"]["path"] = "/media/all"
    result = handler(event, None)
    assert result["statusCode"] == 403
