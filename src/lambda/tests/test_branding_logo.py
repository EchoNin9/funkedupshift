"""Unit tests for branding logo endpoints."""
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _admin_event(path, method="POST", body=None):
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


def _unauth_event(path, method="GET"):
  return {
      "rawPath": path,
      "requestContext": {"http": {"method": method, "path": path}},
  }


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("api.handler.MEDIA_BUCKET", "test-media-bucket")
@patch("boto3.client")
def test_getBrandingLogo_returns_empty_when_not_configured(mock_boto_client):
  """GET /branding/logo returns empty dict when no item exists."""
  from api.handler import handler

  mock_dynamo = MagicMock()
  mock_dynamo.get_item.return_value = {}
  mock_s3 = MagicMock()
  mock_boto_client.side_effect = [mock_dynamo, mock_s3]

  event = _unauth_event("/branding/logo", method="GET")
  result = handler(event, None)

  assert result["statusCode"] == 200
  body = json.loads(result["body"])
  assert body == {} or "url" in body


def test_postBrandingLogoUpload_requires_auth():
  """POST /branding/logo without auth returns 401."""
  from api.handler import handler

  event = {
      "rawPath": "/branding/logo",
      "requestContext": {"http": {"method": "POST", "path": "/branding/logo"}},
      "body": '{"contentType": "image/png"}',
  }
  result = handler(event, None)
  assert result["statusCode"] == 401


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("api.handler.MEDIA_BUCKET", "test-media-bucket")
def test_postBrandingLogoUpload_requires_admin():
  """POST /branding/logo with non-admin returns 403."""
  from api.handler import handler, getUserInfo

  def _non_admin_user(event):
    return {"userId": "user-1", "email": "u@example.com", "groups": ["user"], "groupsDisplay": []}

  event = _admin_event("/branding/logo", body={"contentType": "image/png"})

  with patch("api.handler.getUserInfo", side_effect=_non_admin_user):
    result = handler(event, None)

  assert result["statusCode"] == 403


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("api.handler.MEDIA_BUCKET", "test-media-bucket")
@patch("boto3.client")
def test_postBrandingLogoUpload_success(mock_boto_client):
  """POST /branding/logo as admin returns uploadUrl and key and writes metadata."""
  from api.handler import handler

  mock_s3 = MagicMock()
  mock_s3.generate_presigned_url.return_value = "https://presigned.example/put"
  mock_dynamo = MagicMock()

  # First call for DynamoDB, second for S3 (region_name argument allows us to distinguish)
  def _client(service_name, *args, **kwargs):
    if service_name == "dynamodb":
      return mock_dynamo
    return mock_s3

  mock_boto_client.side_effect = _client

  event = _admin_event("/branding/logo", body={"contentType": "image/png", "alt": "Brand Logo"})
  result = handler(event, None)

  assert result["statusCode"] == 200
  body = json.loads(result["body"])
  assert body["uploadUrl"] == "https://presigned.example/put"
  assert body["key"].startswith("branding/logo/")
  assert body["key"].endswith(".png")
  mock_dynamo.put_item.assert_called_once()

