"""Unit tests for generate_description API and logic."""
import json
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


def test_generateDescription_requires_auth():
    """POST /sites/generate-description without auth returns 401."""
    from api.handler import handler
    event = {
        "rawPath": "/sites/generate-description",
        "requestContext": {"http": {"method": "POST", "path": "/sites/generate-description"}},
        "body": '{"url": "https://example.com"}',
    }
    result = handler(event, None)
    assert result["statusCode"] == 401


def test_generateDescription_requires_admin():
    """POST /sites/generate-description with non-admin returns 403."""
    from api.handler import handler
    event = {
        "rawPath": "/sites/generate-description",
        "requestContext": {
            "http": {"method": "POST", "path": "/sites/generate-description"},
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


def test_generateDescription_missing_url_returns_400():
    """POST /sites/generate-description with empty url returns 400."""
    from api.handler import handler
    event = _admin_event("/sites/generate-description", body={"url": ""})
    result = handler(event, None)
    assert result["statusCode"] == 400
    body = json.loads(result["body"])
    assert "error" in body
    assert "URL" in body["error"]


def test_generateDescription_invalid_json_returns_400():
    """POST /sites/generate-description with invalid JSON returns 400."""
    from api.handler import handler
    event = _admin_event("/sites/generate-description")
    event["body"] = "not valid json"
    result = handler(event, None)
    assert result["statusCode"] == 400
    body = json.loads(result["body"])
    assert "error" in body


def test_generateDescription_success_returns_description_and_flag():
    """POST /sites/generate-description with valid url returns description and aiGenerated."""
    from api.handler import handler
    mock_summary = "A useful website for developers."
    with patch("api.generate_description.generate_description") as mock_gen:
        mock_gen.return_value = {"description": mock_summary, "aiGenerated": True}
        event = _admin_event("/sites/generate-description", body={"url": "https://example.com"})
        result = handler(event, None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["description"] == mock_summary
    assert body["aiGenerated"] is True


def test_generateDescription_fetch_error_returns_400():
    """POST /sites/generate-description when fetch fails returns 400."""
    from api.handler import handler
    with patch("api.generate_description.generate_description") as mock_gen:
        mock_gen.return_value = {"error": "Could not fetch or extract content from URL"}
        event = _admin_event("/sites/generate-description", body={"url": "https://example.com"})
        result = handler(event, None)
    assert result["statusCode"] == 400
    body = json.loads(result["body"])
    assert "error" in body


def test_generate_description_empty_url():
    """generate_description with empty url returns error."""
    from api.generate_description import generate_description
    result = generate_description("")
    assert "error" in result
    assert "URL" in result["error"]


def test_extract_text_strips_scripts():
    """extract_text removes script and style tags."""
    from api.generate_description import extract_text
    html = "<html><body><script>alert(1)</script><p>Hello world</p></body></html>"
    text = extract_text(html)
    assert "alert" not in text
    assert "Hello" in text or "world" in text


def test_extract_text_caps_length():
    """extract_text truncates to MAX_CONTENT_CHARS."""
    from api.generate_description import extract_text, MAX_CONTENT_CHARS
    long_html = "<html><body><p>" + "x" * (MAX_CONTENT_CHARS + 1000) + "</p></body></html>"
    text = extract_text(long_html)
    assert len(text) <= MAX_CONTENT_CHARS
