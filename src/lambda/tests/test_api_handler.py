"""Unit tests for api.handler."""
import json
import os
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

# Allow importing api and common when running tests from repo root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture
def healthEvent():
    """API Gateway HTTP API 2.0 payload for GET /health."""
    return {
        "version": "2.0",
        "routeKey": "GET /health",
        "rawPath": "/health",
        "requestContext": {
            "http": {
                "method": "GET",
                "path": "/health",
            }
        },
    }


@pytest.fixture
def sitesEvent():
    """API Gateway HTTP API 2.0 payload for GET /sites."""
    return {
        "version": "2.0",
        "routeKey": "GET /sites",
        "rawPath": "/sites",
        "requestContext": {
            "http": {
                "method": "GET",
                "path": "/sites",
            }
        },
    }


def test_health_returns_ok(healthEvent):
    from api.handler import handler
    result = handler(healthEvent, None)
    assert result["statusCode"] == 200
    assert "Access-Control-Allow-Origin" in result["headers"]
    assert "ok" in result["body"]
    assert "true" in result["body"]


def test_sites_returns_json(sitesEvent):
    os.environ["TABLE_NAME"] = "fus-main"
    try:
        from api.handler import handler
        result = handler(sitesEvent, None)
        assert result["statusCode"] in (200, 500)
        assert "sites" in result["body"]
    finally:
        os.environ.pop("TABLE_NAME", None)


def test_unknown_route_returns_404():
    from api.handler import handler
    event = {
        "rawPath": "/unknown",
        "requestContext": {"http": {"method": "GET", "path": "/unknown"}},
    }
    result = handler(event, None)
    assert result["statusCode"] == 404


def test_createSite_requires_auth():
    from api.handler import handler
    event = {
        "rawPath": "/sites",
        "requestContext": {"http": {"method": "POST", "path": "/sites"}},
        "body": '{"url": "https://example.com"}',
    }
    result = handler(event, None)
    assert result["statusCode"] == 401


def test_createSite_requires_admin():
    from api.handler import handler
    event = {
        "rawPath": "/sites",
        "requestContext": {
            "http": {"method": "POST", "path": "/sites"},
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
        "body": '{"url": "https://example.com"}',
    }
    result = handler(event, None)
    assert result["statusCode"] == 403


def test_listCategories_requires_auth():
    from api.handler import handler
    event = {
        "rawPath": "/categories",
        "requestContext": {"http": {"method": "GET", "path": "/categories"}},
    }
    result = handler(event, None)
    assert result["statusCode"] == 401


def test_listCategories_requires_admin():
    from api.handler import handler
    event = {
        "rawPath": "/categories",
        "requestContext": {
            "http": {"method": "GET", "path": "/categories"},
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
    }
    result = handler(event, None)
    assert result["statusCode"] == 403


# ------------------------------------------------------------------------------
# Logo upload / delete tests
# ------------------------------------------------------------------------------

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


def test_logo_upload_requires_auth():
    """POST /sites/logo-upload without auth returns 401."""
    from api.handler import handler
    event = {
        "rawPath": "/sites/logo-upload",
        "requestContext": {"http": {"method": "POST", "path": "/sites/logo-upload"}},
        "body": '{"siteId": "SITE#abc", "contentType": "image/png"}',
    }
    result = handler(event, None)
    assert result["statusCode"] == 401


def test_logo_upload_requires_admin():
    """POST /sites/logo-upload with non-admin returns 403."""
    from api.handler import handler
    event = _admin_event("/sites/logo-upload", body={"siteId": "SITE#abc"})
    event["requestContext"]["authorizer"]["jwt"]["claims"]["cognito:groups"] = "user"
    result = handler(event, None)
    assert result["statusCode"] == 403


@patch("api.handler.MEDIA_BUCKET", "test-media-bucket")
@patch("boto3.client")
def test_logo_upload_returns_url_and_key(mock_boto_client):
    """POST /sites/logo-upload as admin returns uploadUrl and key."""
    from api.handler import handler
    mock_s3 = MagicMock()
    mock_s3.generate_presigned_url.return_value = "https://presigned.example/put"
    mock_boto_client.return_value = mock_s3

    event = _admin_event("/sites/logo-upload", body={"siteId": "SITE#xyz", "contentType": "image/png"})
    result = handler(event, None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert "uploadUrl" in body
    assert body["uploadUrl"] == "https://presigned.example/put"
    assert "key" in body
    assert body["key"].startswith("logos/SITE#xyz/")
    assert body["key"].endswith(".png")


@patch("api.handler.MEDIA_BUCKET", "")
def test_logo_upload_fails_without_media_bucket():
    """POST /sites/logo-upload when MEDIA_BUCKET not set returns 500."""
    from api.handler import handler
    event = _admin_event("/sites/logo-upload", body={"siteId": "SITE#abc"})
    result = handler(event, None)
    assert result["statusCode"] == 500
    assert "MEDIA_BUCKET" in result["body"] or "error" in result["body"].lower()


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("api.handler.MEDIA_BUCKET", "test-media-bucket")
@patch("boto3.client")
def test_updateSite_deleteLogo_removes_logo(mock_boto_client):
    """PUT /sites with deleteLogo: true triggers S3 delete and DynamoDB REMOVE logoKey."""
    from api.handler import handler
    mock_dynamo = MagicMock()
    mock_dynamo.get_item.return_value = {
        "Item": {"logoKey": {"S": "logos/SITE#abc/old-uuid.png"}},
    }
    mock_dynamo.update_item.return_value = {}
    mock_s3 = MagicMock()
    mock_boto_client.side_effect = lambda service, **kw: mock_dynamo if service == "dynamodb" else mock_s3

    event = _admin_event("/sites", method="PUT", body={
        "id": "SITE#abc",
        "title": "Updated",
        "deleteLogo": True,
    })
    result = handler(event, None)

    assert result["statusCode"] == 200
    mock_s3.delete_object.assert_called_once_with(Bucket="test-media-bucket", Key="logos/SITE#abc/old-uuid.png")
    update_call = mock_dynamo.update_item.call_args
    assert "REMOVE" in update_call.kwargs["UpdateExpression"]
    assert "logoKey" in update_call.kwargs["UpdateExpression"]


# Logo-from-URL tests
def test_logo_from_url_requires_auth():
    """POST /sites/logo-from-url without auth returns 401."""
    from api.handler import handler
    event = {
        "rawPath": "/sites/logo-from-url",
        "requestContext": {"http": {"method": "POST", "path": "/sites/logo-from-url"}},
        "body": '{"siteId": "SITE#abc", "imageUrl": "https://example.com/logo.png"}',
    }
    result = handler(event, None)
    assert result["statusCode"] == 401


def test_logo_from_url_requires_admin():
    """POST /sites/logo-from-url with non-admin returns 403."""
    from api.handler import handler
    event = _admin_event("/sites/logo-from-url", body={"siteId": "SITE#abc", "imageUrl": "https://example.com/logo.png"})
    event["requestContext"]["authorizer"]["jwt"]["claims"]["cognito:groups"] = "user"
    result = handler(event, None)
    assert result["statusCode"] == 403


@patch("api.handler.MEDIA_BUCKET", "test-media-bucket")
def test_logo_from_url_400_missing_site_id():
    """POST /sites/logo-from-url without siteId returns 400."""
    from api.handler import handler
    event = _admin_event("/sites/logo-from-url", body={"imageUrl": "https://example.com/logo.png"})
    result = handler(event, None)
    assert result["statusCode"] == 400
    body = json.loads(result["body"])
    assert "siteId" in body.get("error", "").lower() or "required" in body.get("error", "").lower()


@patch("api.handler.MEDIA_BUCKET", "test-media-bucket")
def test_logo_from_url_400_missing_image_url():
    """POST /sites/logo-from-url without imageUrl returns 400."""
    from api.handler import handler
    event = _admin_event("/sites/logo-from-url", body={"siteId": "SITE#abc"})
    result = handler(event, None)
    assert result["statusCode"] == 400
    body = json.loads(result["body"])
    assert "imageUrl" in body.get("error", "").lower() or "required" in body.get("error", "").lower()


@patch("api.handler.MEDIA_BUCKET", "test-media-bucket")
@patch("urllib.request.urlopen")
def test_logo_from_url_400_download_failure(mock_urlopen):
    """POST /sites/logo-from-url when download fails returns 400."""
    import urllib.error
    from api.handler import handler
    mock_urlopen.side_effect = urllib.error.URLError("connection refused")
    event = _admin_event("/sites/logo-from-url", body={"siteId": "SITE#abc", "imageUrl": "https://example.com/logo.png"})
    result = handler(event, None)
    assert result["statusCode"] == 400
    body = json.loads(result["body"])
    assert "error" in body
    assert "download" in body["error"].lower() or "could not" in body["error"].lower()


@patch("api.handler.MEDIA_BUCKET", "test-media-bucket")
@patch("urllib.request.urlopen")
def test_logo_from_url_400_image_too_large(mock_urlopen):
    """POST /sites/logo-from-url when image exceeds 5 MB returns 400."""
    from api.handler import handler
    mock_resp = MagicMock()
    mock_resp.read.side_effect = [b"x" * (5 * 1024 * 1024 + 1)]
    mock_resp.headers = {"Content-Length": str(5 * 1024 * 1024 + 1), "Content-Type": "image/png"}
    mock_resp.__enter__ = lambda self: self
    mock_resp.__exit__ = lambda self, *a: None
    mock_urlopen.return_value = mock_resp
    event = _admin_event("/sites/logo-from-url", body={"siteId": "SITE#abc", "imageUrl": "https://example.com/logo.png"})
    result = handler(event, None)
    assert result["statusCode"] == 400
    body = json.loads(result["body"])
    assert "error" in body
    assert "large" in body["error"].lower() or "5" in body["error"]


@patch("api.handler.MEDIA_BUCKET", "test-media-bucket")
@patch("urllib.request.urlopen")
def test_logo_from_url_400_unsupported_type(mock_urlopen):
    """POST /sites/logo-from-url when Content-Type is not image returns 400."""
    from api.handler import handler
    mock_resp = MagicMock()
    mock_resp.read.return_value = b"\x89PNG\r\n\x1a\n"[:100]
    mock_resp.headers = {"Content-Length": "100", "Content-Type": "text/html"}
    mock_resp.__enter__ = lambda self: self
    mock_resp.__exit__ = lambda self, *a: None
    mock_urlopen.return_value = mock_resp
    event = _admin_event("/sites/logo-from-url", body={"siteId": "SITE#abc", "imageUrl": "https://example.com/logo.png"})
    result = handler(event, None)
    assert result["statusCode"] == 400
    body = json.loads(result["body"])
    assert "error" in body
    assert "unsupported" in body["error"].lower() or "type" in body["error"].lower()


@patch("api.handler.MEDIA_BUCKET", "test-media-bucket")
@patch("PIL.Image.open")
@patch("urllib.request.urlopen")
def test_logo_from_url_400_dimensions_too_small(mock_urlopen, mock_pil_open):
    """POST /sites/logo-from-url when image is smaller than 100x100 returns 400."""
    from api.handler import handler
    mock_resp = MagicMock()
    mock_resp.read.return_value = b"\x89PNG\r\n\x1a\n"
    mock_resp.headers = {"Content-Length": "100", "Content-Type": "image/png"}
    mock_resp.__enter__ = lambda self: self
    mock_resp.__exit__ = lambda self, *a: None
    mock_urlopen.return_value = mock_resp
    mock_img = MagicMock()
    mock_img.size = (50, 50)
    mock_pil_open.return_value = mock_img
    event = _admin_event("/sites/logo-from-url", body={"siteId": "SITE#abc", "imageUrl": "https://example.com/logo.png"})
    result = handler(event, None)
    assert result["statusCode"] == 400
    body = json.loads(result["body"])
    assert "error" in body
    assert "100" in body["error"] and "pixel" in body["error"].lower()


@patch("api.handler.MEDIA_BUCKET", "test-media-bucket")
@patch("boto3.client")
@patch("PIL.Image.open")
@patch("urllib.request.urlopen")
def test_logo_from_url_200_returns_key(mock_urlopen, mock_pil_open, mock_boto_client):
    """POST /sites/logo-from-url as admin downloads, validates, uploads to S3 and returns key."""
    from api.handler import handler
    image_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 200
    mock_resp = MagicMock()
    mock_resp.read.return_value = image_bytes
    mock_resp.headers = {"Content-Length": str(len(image_bytes)), "Content-Type": "image/png"}
    mock_resp.__enter__ = lambda self: self
    mock_resp.__exit__ = lambda self, *a: None
    mock_urlopen.return_value = mock_resp
    mock_img = MagicMock()
    mock_img.size = (100, 100)
    mock_pil_open.return_value = mock_img
    mock_s3 = MagicMock()
    mock_boto_client.return_value = mock_s3
    event = _admin_event("/sites/logo-from-url", body={"siteId": "SITE#xyz", "imageUrl": "https://example.com/logo.png"})
    result = handler(event, None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert "key" in body
    assert body["key"].startswith("logos/SITE#xyz/")
    assert body["key"].endswith(".png")
    mock_s3.put_object.assert_called_once()
    call_kw = mock_s3.put_object.call_args.kwargs
    assert call_kw["Bucket"] == "test-media-bucket"
    assert call_kw["Key"] == body["key"]
    assert call_kw["Body"] == image_bytes
    assert call_kw["ContentType"] == "image/png"
