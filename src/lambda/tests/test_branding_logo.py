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


def _admin_event_put(path, body=None):
  return _admin_event(path, method="PUT", body=body)


def _admin_event_delete(path):
  return _admin_event(path, method="DELETE", body=None)


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
  # bannerText is always present (defaults when unset); logo url only when configured.
  assert "url" not in body
  assert "bannerText" in body


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


# ── Hero endpoints ──


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("api.handler.MEDIA_BUCKET", "test-media-bucket")
@patch("boto3.client")
def test_getBrandingLogo_returns_hero_when_present(mock_boto_client):
  """GET /branding/logo returns hero fields when HERO#DEFAULT exists."""
  from api.handler import handler

  mock_dynamo = MagicMock()

  def _get_item(**kwargs):
    key = kwargs.get("Key", {})
    sk = key.get("SK", {}).get("S", "")
    if sk == "LOGO#DEFAULT":
      return {}
    if sk == "HERO#DEFAULT":
      return {
          "Item": {
              "PK": {"S": "BRANDING"},
              "SK": {"S": "HERO#DEFAULT"},
              "heroTagline": {"S": "Custom tagline"},
              "heroHeadline": {"S": "Custom headline"},
              "heroSubtext": {"S": "Custom subtext"},
              "heroImageKey": {"S": "branding/hero/abc.jpg"},
              "heroImageOpacity": {"N": "30"},
          }
      }
    return {}

  mock_dynamo.get_item.side_effect = _get_item
  mock_s3 = MagicMock()
  mock_s3.generate_presigned_url.return_value = "https://presigned.example/hero.jpg"

  def _client(service_name, *args, **kwargs):
    if service_name == "dynamodb":
      return mock_dynamo
    return mock_s3

  mock_boto_client.side_effect = _client

  event = _unauth_event("/branding/logo", method="GET")
  result = handler(event, None)

  assert result["statusCode"] == 200
  body = json.loads(result["body"])
  assert body["heroTagline"] == "Custom tagline"
  assert body["heroHeadline"] == "Custom headline"
  assert body["heroSubtext"] == "Custom subtext"
  assert body["heroImageUrl"] == "https://presigned.example/hero.jpg"
  assert body["heroImageOpacity"] == 30


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_putBrandingLogo_requires_auth(mock_boto_client):
  """PUT /branding/logo without auth returns 401."""
  from api.handler import handler

  event = {
      "rawPath": "/branding/logo",
      "requestContext": {"http": {"method": "PUT", "path": "/branding/logo"}},
      "body": '{"alt": "New Alt"}',
  }
  result = handler(event, None)
  assert result["statusCode"] == 401


@patch("api.handler.TABLE_NAME", "fus-main")
def test_putBrandingLogo_requires_admin():
  """PUT /branding/logo with non-admin returns 403."""
  from api.handler import handler

  def _non_admin_user(event):
    return {"userId": "user-1", "email": "u@example.com", "groups": ["user"], "groupsDisplay": []}

  event = _admin_event_put("/branding/logo", body={"alt": "New Alt"})

  with patch("api.handler.getEffectiveUserInfo", side_effect=_non_admin_user):
    result = handler(event, None)

  assert result["statusCode"] == 403


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_putBrandingLogo_returns_404_when_no_logo(mock_boto_client):
  """PUT /branding/logo returns 404 when no logo exists."""
  from api.handler import handler

  mock_dynamo = MagicMock()
  mock_dynamo.get_item.return_value = {}
  mock_boto_client.return_value = mock_dynamo

  event = _admin_event_put("/branding/logo", body={"alt": "New Alt"})
  result = handler(event, None)

  assert result["statusCode"] == 404
  body = json.loads(result["body"])
  assert "No logo configured" in body.get("error", "")


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_putBrandingLogo_success(mock_boto_client):
  """PUT /branding/logo as admin updates alt text."""
  from api.handler import handler

  mock_dynamo = MagicMock()
  mock_dynamo.get_item.return_value = {
      "Item": {
          "PK": {"S": "BRANDING"},
          "SK": {"S": "LOGO#DEFAULT"},
          "logoKey": {"S": "branding/logo/abc.png"},
          "alt": {"S": "Old Alt"},
      }
  }
  mock_boto_client.return_value = mock_dynamo

  event = _admin_event_put("/branding/logo", body={"alt": "New Alt Text"})
  result = handler(event, None)

  assert result["statusCode"] == 200
  body = json.loads(result["body"])
  assert body["alt"] == "New Alt Text"
  mock_dynamo.update_item.assert_called_once()
  call_kwargs = mock_dynamo.update_item.call_args[1]
  assert call_kwargs["ExpressionAttributeValues"][":alt"]["S"] == "New Alt Text"


def test_putBrandingHero_requires_auth():
  """PUT /branding/hero without auth returns 401."""
  from api.handler import handler

  event = {
      "rawPath": "/branding/hero",
      "requestContext": {"http": {"method": "PUT", "path": "/branding/hero"}},
      "body": '{"heroTagline": "Test"}',
  }
  result = handler(event, None)
  assert result["statusCode"] == 401


@patch("api.handler.TABLE_NAME", "fus-main")
def test_putBrandingHero_requires_admin():
  """PUT /branding/hero with non-admin returns 403."""
  from api.handler import handler

  def _non_admin_user(event):
    return {"userId": "user-1", "email": "u@example.com", "groups": ["user"], "groupsDisplay": []}

  event = _admin_event_put("/branding/hero", body={"heroTagline": "Test"})

  with patch("api.handler.getEffectiveUserInfo", side_effect=_non_admin_user):
    result = handler(event, None)

  assert result["statusCode"] == 403


def test_postBrandingHeroImage_requires_auth():
  """POST /branding/hero-image without auth returns 401."""
  from api.handler import handler

  event = {
      "rawPath": "/branding/hero-image",
      "requestContext": {"http": {"method": "POST", "path": "/branding/hero-image"}},
      "body": '{"contentType": "image/png"}',
  }
  result = handler(event, None)
  assert result["statusCode"] == 401


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("api.handler.MEDIA_BUCKET", "test-media-bucket")
def test_postBrandingHeroImage_requires_admin():
  """POST /branding/hero-image with non-admin returns 403."""
  from api.handler import handler

  def _non_admin_user(event):
    return {"userId": "user-1", "email": "u@example.com", "groups": ["user"], "groupsDisplay": []}

  event = _admin_event("/branding/hero-image", body={"contentType": "image/png"})

  with patch("api.handler.getEffectiveUserInfo", side_effect=_non_admin_user):
    result = handler(event, None)

  assert result["statusCode"] == 403


def test_deleteBrandingHeroImage_requires_auth():
  """DELETE /branding/hero-image without auth returns 401."""
  from api.handler import handler

  event = {
      "rawPath": "/branding/hero-image",
      "requestContext": {"http": {"method": "DELETE", "path": "/branding/hero-image"}},
  }
  result = handler(event, None)
  assert result["statusCode"] == 401


@patch("api.handler.TABLE_NAME", "fus-main")
def test_deleteBrandingHeroImage_requires_admin():
  """DELETE /branding/hero-image with non-admin returns 403."""
  from api.handler import handler

  def _non_admin_user(event):
    return {"userId": "user-1", "email": "u@example.com", "groups": ["user"], "groupsDisplay": []}

  event = _admin_event_delete("/branding/hero-image")

  with patch("api.handler.getEffectiveUserInfo", side_effect=_non_admin_user):
    result = handler(event, None)

  assert result["statusCode"] == 403


# ── Banner (marquee) endpoints ──


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("api.handler.MEDIA_BUCKET", "test-media-bucket")
@patch("boto3.client")
def test_getBrandingLogo_returns_default_banner_when_unset(mock_boto_client):
  """GET /branding/logo returns the default banner text when no banner item exists."""
  from api.handler import handler, DEFAULT_BANNER_TEXT

  mock_dynamo = MagicMock()
  mock_dynamo.get_item.return_value = {}
  mock_s3 = MagicMock()

  def _client(service_name, *args, **kwargs):
    return mock_dynamo if service_name == "dynamodb" else mock_s3

  mock_boto_client.side_effect = _client

  result = handler(_unauth_event("/branding/logo", method="GET"), None)

  assert result["statusCode"] == 200
  body = json.loads(result["body"])
  assert body["bannerText"] == DEFAULT_BANNER_TEXT


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("api.handler.MEDIA_BUCKET", "test-media-bucket")
@patch("boto3.client")
def test_getBrandingLogo_returns_stored_banner(mock_boto_client):
  """GET /branding/logo returns the stored banner text when BANNER#DEFAULT exists."""
  from api.handler import handler

  def _get_item(**kwargs):
    sk = kwargs.get("Key", {}).get("SK", {}).get("S", "")
    if sk == "BANNER#DEFAULT":
      return {"Item": {"bannerText": {"S": "Live from the booth"}}}
    return {}

  mock_dynamo = MagicMock()
  mock_dynamo.get_item.side_effect = _get_item
  mock_s3 = MagicMock()

  def _client(service_name, *args, **kwargs):
    return mock_dynamo if service_name == "dynamodb" else mock_s3

  mock_boto_client.side_effect = _client

  result = handler(_unauth_event("/branding/logo", method="GET"), None)

  assert result["statusCode"] == 200
  body = json.loads(result["body"])
  assert body["bannerText"] == "Live from the booth"


def test_putBrandingBanner_requires_auth():
  """PUT /branding/banner without auth returns 401."""
  from api.handler import handler

  event = {
      "rawPath": "/branding/banner",
      "requestContext": {"http": {"method": "PUT", "path": "/branding/banner"}},
      "body": '{"bannerText": "Hello"}',
  }
  result = handler(event, None)
  assert result["statusCode"] == 401


@patch("api.handler.TABLE_NAME", "fus-main")
def test_putBrandingBanner_rejects_non_admin_non_manager():
  """PUT /branding/banner with a plain user returns 403."""
  from api.handler import handler

  def _user(event):
    return {"userId": "user-1", "email": "u@example.com", "groups": ["user"], "groupsDisplay": []}

  event = _admin_event_put("/branding/banner", body={"bannerText": "Hello"})
  with patch("api.handler.getEffectiveUserInfo", side_effect=_user):
    result = handler(event, None)
  assert result["statusCode"] == 403


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_putBrandingBanner_allows_manager(mock_boto_client):
  """PUT /branding/banner is permitted for managers (not just admins)."""
  from api.handler import handler

  mock_dynamo = MagicMock()
  mock_boto_client.return_value = mock_dynamo

  def _manager(event):
    return {"userId": "mgr-1", "email": "m@example.com", "groups": ["manager"], "groupsDisplay": []}

  event = _admin_event_put("/branding/banner", body={"bannerText": "Manager set this"})
  with patch("api.handler.getEffectiveUserInfo", side_effect=_manager):
    result = handler(event, None)

  assert result["statusCode"] == 200
  body = json.loads(result["body"])
  assert body["bannerText"] == "Manager set this"
  mock_dynamo.put_item.assert_called_once()


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_putBrandingBanner_rejects_empty(mock_boto_client):
  """PUT /branding/banner with whitespace/control-only text returns 400."""
  from api.handler import handler

  mock_dynamo = MagicMock()
  mock_boto_client.return_value = mock_dynamo

  event = _admin_event_put("/branding/banner", body={"bannerText": "  \n\t  "})
  result = handler(event, None)

  assert result["statusCode"] == 400
  mock_dynamo.put_item.assert_not_called()


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_putBrandingBanner_rejects_too_long(mock_boto_client):
  """PUT /branding/banner with >500 chars returns 400."""
  from api.handler import handler

  mock_dynamo = MagicMock()
  mock_boto_client.return_value = mock_dynamo

  event = _admin_event_put("/branding/banner", body={"bannerText": "a" * 501})
  result = handler(event, None)

  assert result["statusCode"] == 400
  mock_dynamo.put_item.assert_not_called()


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_putBrandingBanner_persists_and_strips_control_chars(mock_boto_client):
  """PUT /branding/banner as admin persists cleaned text with updatedAt/updatedBy."""
  from api.handler import handler

  mock_dynamo = MagicMock()
  mock_boto_client.return_value = mock_dynamo

  event = _admin_event_put("/branding/banner", body={"bannerText": "  Hello\x07\nWorld  "})
  result = handler(event, None)

  assert result["statusCode"] == 200
  body = json.loads(result["body"])
  # Control chars (\x07, \n) stripped, surrounding whitespace trimmed.
  assert body["bannerText"] == "HelloWorld"
  mock_dynamo.put_item.assert_called_once()
  item = mock_dynamo.put_item.call_args[1]["Item"]
  assert item["SK"]["S"] == "BANNER#DEFAULT"
  assert item["bannerText"]["S"] == "HelloWorld"
  assert item["updatedAt"]["S"]
  assert item["updatedBy"]["S"] == "admin@example.com"

