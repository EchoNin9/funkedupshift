"""Unit tests for the tools platform URL shortener Lambda (src/lambda/tools/handler.py)."""
import json
import re
import string
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

BASE62_RE = re.compile(r"^[" + re.escape(string.ascii_letters + string.digits) + r"]{7}$")


def _event(path, method="GET", body=None, sub="user-123", origin="https://funkedupshift.com"):
    headers = {}
    if origin:
        headers["origin"] = origin
    return {
        "rawPath": path,
        "requestContext": {
            "http": {"method": method, "path": path},
            "authorizer": {"jwt": {"claims": {"sub": sub, "email": "user@example.com"}}},
        },
        "headers": headers,
        "body": json.dumps(body) if body is not None else "{}",
    }


def _conditional_check_failed():
    return ClientError(
        {"Error": {"Code": "ConditionalCheckFailedException", "Message": "exists"}},
        "PutItem",
    )


# --- mint: happy path --------------------------------------------------------


def test_mint_valid_url_returns_code_and_short_url():
    from tools import handler as tools_handler

    ddb = MagicMock()
    ddb.put_item.return_value = {}
    kvs = MagicMock()
    kvs.describe_key_value_store.return_value = {"ETag": "etag-1"}
    kvs.put_key.return_value = {"ETag": "etag-2"}

    with patch.object(tools_handler, "_ddb", return_value=ddb), \
         patch.object(tools_handler, "_kvsClient", return_value=kvs):
        result = tools_handler.handler(
            _event("/s", "POST", {"url": "https://example.com/some/page"}), None
        )

    assert result["statusCode"] == 200
    payload = json.loads(result["body"])
    assert BASE62_RE.match(payload["code"])
    assert payload["url"] == "https://example.com/some/page"
    assert payload["shortUrl"] == f"https://fus.fyi/{payload['code']}"
    ddb.put_item.assert_called_once()
    kvs.put_key.assert_called_once()


# --- mint: validation ---------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        {"url": ""},
        {"url": "not-a-url"},
        {"url": "ftp://example.com/file"},
        {"url": "javascript:alert(1)"},
        {},
    ],
)
def test_mint_invalid_url_400(body):
    from tools import handler as tools_handler

    result = tools_handler.handler(_event("/s", "POST", body), None)
    assert result["statusCode"] == 400


def test_mint_oversize_url_400():
    from tools import handler as tools_handler

    huge = "https://example.com/" + ("a" * 2048)
    result = tools_handler.handler(_event("/s", "POST", {"url": huge}), None)
    assert result["statusCode"] == 400


def test_mint_short_domain_loop_rejected_400():
    from tools import handler as tools_handler

    for target in ("https://fus.fyi/abc1234", "https://e9.cx/xyz9999", "https://sub.fus.fyi/x"):
        result = tools_handler.handler(_event("/s", "POST", {"url": target}), None)
        assert result["statusCode"] == 400, target


def test_mint_invalid_json_body_400():
    from tools import handler as tools_handler

    event = _event("/s", "POST")
    event["body"] = "{not json"
    result = tools_handler.handler(event, None)
    assert result["statusCode"] == 400


# --- mint: collision retry -----------------------------------------------------


def test_mint_retries_on_collision_then_succeeds():
    from tools import handler as tools_handler

    ddb = MagicMock()
    ddb.put_item.side_effect = [_conditional_check_failed(), _conditional_check_failed(), {}]
    kvs = MagicMock()
    kvs.describe_key_value_store.return_value = {"ETag": "etag-1"}
    kvs.put_key.return_value = {"ETag": "etag-2"}

    with patch.object(tools_handler, "_ddb", return_value=ddb), \
         patch.object(tools_handler, "_kvsClient", return_value=kvs):
        result = tools_handler.handler(
            _event("/s", "POST", {"url": "https://example.com/retry"}), None
        )

    assert result["statusCode"] == 200
    assert ddb.put_item.call_count == 3


def test_mint_retry_exhaustion_500():
    from tools import handler as tools_handler

    ddb = MagicMock()
    ddb.put_item.side_effect = _conditional_check_failed()
    kvs = MagicMock()

    with patch.object(tools_handler, "_ddb", return_value=ddb), \
         patch.object(tools_handler, "_kvsClient", return_value=kvs):
        result = tools_handler.handler(
            _event("/s", "POST", {"url": "https://example.com/exhausted"}), None
        )

    assert result["statusCode"] == 500
    assert ddb.put_item.call_count == tools_handler.MAX_MINT_ATTEMPTS
    kvs.put_key.assert_not_called()


def test_mint_kvs_write_failure_500_but_item_stays_in_table():
    from tools import handler as tools_handler

    ddb = MagicMock()
    ddb.put_item.return_value = {}
    kvs = MagicMock()
    kvs.describe_key_value_store.side_effect = Exception("kvs unavailable")

    with patch.object(tools_handler, "_ddb", return_value=ddb), \
         patch.object(tools_handler, "_kvsClient", return_value=kvs):
        result = tools_handler.handler(
            _event("/s", "POST", {"url": "https://example.com/kvs-fail"}), None
        )

    assert result["statusCode"] == 500
    # The DynamoDB write already succeeded and is not rolled back.
    ddb.put_item.assert_called_once()


# --- metadata GET --------------------------------------------------------------


def test_get_known_code_200():
    from tools import handler as tools_handler

    ddb = MagicMock()
    ddb.get_item.return_value = {
        "Item": {
            "code": {"S": "abc1234"},
            "url": {"S": "https://example.com/target"},
            "createdBy": {"S": "user-123"},
            "createdHost": {"S": "https://funkedupshift.com"},
            "createdAt": {"S": "2026-07-16T00:00:00Z"},
        }
    }

    with patch.object(tools_handler, "_ddb", return_value=ddb):
        result = tools_handler.handler(_event("/s/abc1234", "GET"), None)

    assert result["statusCode"] == 200
    payload = json.loads(result["body"])
    assert payload["code"] == "abc1234"
    assert payload["url"] == "https://example.com/target"
    assert payload["shortUrl"] == "https://fus.fyi/abc1234"


def test_get_unknown_code_404():
    from tools import handler as tools_handler

    ddb = MagicMock()
    ddb.get_item.return_value = {}

    with patch.object(tools_handler, "_ddb", return_value=ddb):
        result = tools_handler.handler(_event("/s/doesnotexist", "GET"), None)

    assert result["statusCode"] == 404


def test_unknown_route_404():
    from tools import handler as tools_handler

    result = tools_handler.handler(_event("/nope", "GET"), None)
    assert result["statusCode"] == 404
