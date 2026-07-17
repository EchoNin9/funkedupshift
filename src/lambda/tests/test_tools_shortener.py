"""Unit tests for the tools platform URL shortener Lambda (src/lambda/tools/handler.py)."""
import base64
import json
import re
import string
import sys
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

BASE62_RE = re.compile(r"^[" + re.escape(string.ascii_letters + string.digits) + r"]{7}$")


def _event(
    path,
    method="GET",
    body=None,
    sub="user-123",
    origin="https://funkedupshift.com",
    query=None,
):
    headers = {}
    if origin:
        headers["origin"] = origin
    event = {
        "rawPath": path,
        "requestContext": {
            "http": {"method": method, "path": path},
            "authorizer": {"jwt": {"claims": {"sub": sub, "email": "user@example.com"}}},
        },
        "headers": headers,
        "body": json.dumps(body) if body is not None else "{}",
    }
    if query is not None:
        event["queryStringParameters"] = query
    return event


def _ddb_item(code, url, created_by, created_at="2026-07-01T00:00:00Z", expires_at=None):
    if expires_at is None:
        expires_at = int(time.time()) + 30 * 86400
    return {
        "code": {"S": code},
        "url": {"S": url},
        "createdBy": {"S": created_by},
        "createdHost": {"S": "https://funkedupshift.com"},
        "createdAt": {"S": created_at},
        "expiresAt": {"N": str(expires_at)},
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

    before = int(time.time())
    with patch.object(tools_handler, "_ddb", return_value=ddb), \
         patch.object(tools_handler, "_kvsClient", return_value=kvs):
        result = tools_handler.handler(
            _event("/s", "POST", {"url": "https://example.com/some/page"}), None
        )
    after = int(time.time())

    assert result["statusCode"] == 200
    payload = json.loads(result["body"])
    assert BASE62_RE.match(payload["code"])
    assert payload["url"] == "https://example.com/some/page"
    assert payload["shortUrl"] == f"https://fus.fyi/{payload['code']}"
    # expiresAt ~= now + 30 days (default LINK_TTL_DAYS).
    expected_min = before + 30 * 86400
    expected_max = after + 30 * 86400
    assert expected_min <= payload["expiresAt"] <= expected_max
    ddb.put_item.assert_called_once()

    # The DynamoDB item itself also carries expiresAt (Number) for TTL.
    put_item_kwargs = ddb.put_item.call_args.kwargs
    assert put_item_kwargs["Item"]["expiresAt"]["N"] == str(payload["expiresAt"])

    # KVS is written as JSON {"u": url, "e": expiresAt}, not a bare string.
    kvs.put_key.assert_called_once()
    kvs_kwargs = kvs.put_key.call_args.kwargs
    kvs_value = json.loads(kvs_kwargs["Value"])
    assert kvs_value == {"u": "https://example.com/some/page", "e": payload["expiresAt"]}


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


# --- list: GET /s ---------------------------------------------------------------


def test_list_returns_own_items_newest_first_with_next_cursor():
    from tools import handler as tools_handler

    lek = {"code": {"S": "zzz9999"}, "createdBy": {"S": "user-123"}, "createdAt": {"S": "2026-06-01T00:00:00Z"}}
    ddb = MagicMock()
    ddb.query.return_value = {
        "Items": [
            _ddb_item("newest1", "https://example.com/1", "user-123", created_at="2026-07-15T00:00:00Z"),
            _ddb_item("older12", "https://example.com/2", "user-123", created_at="2026-07-01T00:00:00Z"),
        ],
        "LastEvaluatedKey": lek,
    }

    with patch.object(tools_handler, "_ddb", return_value=ddb):
        result = tools_handler.handler(_event("/s", "GET"), None)

    assert result["statusCode"] == 200
    payload = json.loads(result["body"])
    assert [item["code"] for item in payload["items"]] == ["newest1", "older12"]
    assert payload["items"][0]["shortUrl"] == "https://fus.fyi/newest1"
    assert payload["nextCursor"] is not None
    decoded = json.loads(base64.urlsafe_b64decode(payload["nextCursor"].encode("ascii")))
    assert decoded == lek

    query_kwargs = ddb.query.call_args.kwargs
    assert query_kwargs["IndexName"] == "byCreator"
    assert query_kwargs["ScanIndexForward"] is False
    assert query_kwargs["ExpressionAttributeValues"][":sub"] == {"S": "user-123"}
    assert query_kwargs["Limit"] == tools_handler.DEFAULT_LIST_LIMIT
    assert "ExclusiveStartKey" not in query_kwargs


def test_list_no_more_pages_next_cursor_none():
    from tools import handler as tools_handler

    ddb = MagicMock()
    ddb.query.return_value = {"Items": []}

    with patch.object(tools_handler, "_ddb", return_value=ddb):
        result = tools_handler.handler(_event("/s", "GET"), None)

    payload = json.loads(result["body"])
    assert payload["items"] == []
    assert payload["nextCursor"] is None


def test_list_with_cursor_passes_exclusive_start_key():
    from tools import handler as tools_handler

    start_key = {"code": {"S": "abc1234"}, "createdBy": {"S": "user-123"}, "createdAt": {"S": "2026-07-01T00:00:00Z"}}
    cursor = base64.urlsafe_b64encode(json.dumps(start_key).encode("utf-8")).decode("ascii")

    ddb = MagicMock()
    ddb.query.return_value = {"Items": []}

    with patch.object(tools_handler, "_ddb", return_value=ddb):
        result = tools_handler.handler(_event("/s", "GET", query={"cursor": cursor}), None)

    assert result["statusCode"] == 200
    assert ddb.query.call_args.kwargs["ExclusiveStartKey"] == start_key


def test_list_bad_cursor_400():
    from tools import handler as tools_handler

    ddb = MagicMock()
    with patch.object(tools_handler, "_ddb", return_value=ddb):
        result = tools_handler.handler(_event("/s", "GET", query={"cursor": "not-valid-base64!!"}), None)

    assert result["statusCode"] == 400
    ddb.query.assert_not_called()


@pytest.mark.parametrize("limit_param,expected", [("5", 5), ("500", 100), ("0", 20), ("-3", 20), ("abc", 20), (None, 20)])
def test_list_limit_clamped_not_errored(limit_param, expected):
    from tools import handler as tools_handler

    ddb = MagicMock()
    ddb.query.return_value = {"Items": []}
    query = {"limit": limit_param} if limit_param is not None else {}

    with patch.object(tools_handler, "_ddb", return_value=ddb):
        result = tools_handler.handler(_event("/s", "GET", query=query), None)

    assert result["statusCode"] == 200
    assert ddb.query.call_args.kwargs["Limit"] == expected


# --- delete: DELETE /s/{code} ----------------------------------------------------


def test_delete_happy_path_kvs_then_ddb():
    from tools import handler as tools_handler

    call_order = []
    ddb = MagicMock()
    ddb.get_item.return_value = {"Item": _ddb_item("abc1234", "https://example.com/target", "user-123")}
    ddb.delete_item.side_effect = lambda **kw: call_order.append("ddb_delete")
    kvs = MagicMock()
    kvs.describe_key_value_store.return_value = {"ETag": "etag-1"}
    kvs.delete_key.side_effect = lambda **kw: call_order.append("kvs_delete")

    with patch.object(tools_handler, "_ddb", return_value=ddb), \
         patch.object(tools_handler, "_kvsClient", return_value=kvs):
        result = tools_handler.handler(_event("/s/abc1234", "DELETE", sub="user-123"), None)

    assert result["statusCode"] == 200
    payload = json.loads(result["body"])
    assert payload["code"] == "abc1234"
    assert payload["deleted"] is True

    kvs.delete_key.assert_called_once()
    assert kvs.delete_key.call_args.kwargs["Key"] == "abc1234"
    ddb.delete_item.assert_called_once()
    # KVS-first ordering: a KVS failure must leave the DynamoDB row intact.
    assert call_order == ["kvs_delete", "ddb_delete"]


def test_delete_non_owner_403_does_not_leak_url():
    from tools import handler as tools_handler

    ddb = MagicMock()
    ddb.get_item.return_value = {"Item": _ddb_item("abc1234", "https://example.com/secret", "someone-else")}
    kvs = MagicMock()

    with patch.object(tools_handler, "_ddb", return_value=ddb), \
         patch.object(tools_handler, "_kvsClient", return_value=kvs):
        result = tools_handler.handler(_event("/s/abc1234", "DELETE", sub="user-123"), None)

    assert result["statusCode"] == 403
    assert "example.com" not in result["body"]
    kvs.delete_key.assert_not_called()
    ddb.delete_item.assert_not_called()


def test_delete_unknown_code_404():
    from tools import handler as tools_handler

    ddb = MagicMock()
    ddb.get_item.return_value = {}

    with patch.object(tools_handler, "_ddb", return_value=ddb):
        result = tools_handler.handler(_event("/s/doesnotexist", "DELETE"), None)

    assert result["statusCode"] == 404


def test_delete_kvs_failure_500_ddb_row_stays():
    from tools import handler as tools_handler

    ddb = MagicMock()
    ddb.get_item.return_value = {"Item": _ddb_item("abc1234", "https://example.com/target", "user-123")}
    kvs = MagicMock()
    kvs.describe_key_value_store.side_effect = Exception("kvs unavailable")

    with patch.object(tools_handler, "_ddb", return_value=ddb), \
         patch.object(tools_handler, "_kvsClient", return_value=kvs):
        result = tools_handler.handler(_event("/s/abc1234", "DELETE", sub="user-123"), None)

    assert result["statusCode"] == 500
    ddb.delete_item.assert_not_called()


# --- patch: PATCH /s/{code} ------------------------------------------------------


def test_patch_happy_path_updates_ddb_and_kvs():
    from tools import handler as tools_handler

    ddb = MagicMock()
    ddb.get_item.return_value = {"Item": _ddb_item("abc1234", "https://example.com/target", "user-123")}
    kvs = MagicMock()
    kvs.describe_key_value_store.return_value = {"ETag": "etag-1"}

    new_expiry = int(time.time()) + 60 * 86400
    with patch.object(tools_handler, "_ddb", return_value=ddb), \
         patch.object(tools_handler, "_kvsClient", return_value=kvs):
        result = tools_handler.handler(
            _event("/s/abc1234", "PATCH", {"expiresAt": new_expiry}, sub="user-123"), None
        )

    assert result["statusCode"] == 200
    payload = json.loads(result["body"])
    assert payload["expiresAt"] == new_expiry
    assert payload["code"] == "abc1234"

    ddb.update_item.assert_called_once()
    update_kwargs = ddb.update_item.call_args.kwargs
    assert update_kwargs["ExpressionAttributeValues"][":e"] == {"N": str(new_expiry)}

    kvs.put_key.assert_called_once()
    kvs_value = json.loads(kvs.put_key.call_args.kwargs["Value"])
    assert kvs_value == {"u": "https://example.com/target", "e": new_expiry}


@pytest.mark.parametrize(
    "body",
    [
        {"expiresAt": 1},  # far in the past
        {"expiresAt": "not-a-number"},
        {},
    ],
)
def test_patch_invalid_expiry_400(body):
    from tools import handler as tools_handler

    ddb = MagicMock()

    with patch.object(tools_handler, "_ddb", return_value=ddb):
        result = tools_handler.handler(_event("/s/abc1234", "PATCH", body, sub="user-123"), None)

    assert result["statusCode"] == 400
    ddb.get_item.assert_not_called()


def test_patch_non_owner_403_does_not_leak_url():
    from tools import handler as tools_handler

    ddb = MagicMock()
    ddb.get_item.return_value = {"Item": _ddb_item("abc1234", "https://example.com/secret", "someone-else")}
    new_expiry = int(time.time()) + 60 * 86400

    with patch.object(tools_handler, "_ddb", return_value=ddb):
        result = tools_handler.handler(
            _event("/s/abc1234", "PATCH", {"expiresAt": new_expiry}, sub="user-123"), None
        )

    assert result["statusCode"] == 403
    assert "example.com" not in result["body"]
    ddb.update_item.assert_not_called()


def test_patch_unknown_code_404():
    from tools import handler as tools_handler

    ddb = MagicMock()
    ddb.get_item.return_value = {}
    new_expiry = int(time.time()) + 60 * 86400

    with patch.object(tools_handler, "_ddb", return_value=ddb):
        result = tools_handler.handler(
            _event("/s/doesnotexist", "PATCH", {"expiresAt": new_expiry}), None
        )

    assert result["statusCode"] == 404
