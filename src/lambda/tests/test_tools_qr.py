"""Unit tests for the per-short-link QR image routes (FUNK-65) in src/lambda/tools/handler.py."""
import json
import sys
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

from botocore.exceptions import ClientError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools import handler as tools_handler  # noqa: E402

BUCKET = "fus-tools-qr-test"


def _event(path, method, sub="user-123", query=None):
    event = {
        "rawPath": path,
        "requestContext": {
            "http": {"method": method, "path": path},
            "authorizer": {"jwt": {"claims": {"sub": sub}}},
        },
        "headers": {},
        "body": None,
    }
    if query is not None:
        event["queryStringParameters"] = query
    return event


def _item(code="abc1234", owner="user-123", qr_updated=None):
    item = {
        "code": {"S": code},
        "url": {"S": "https://example.com/x"},
        "createdBy": {"S": owner},
        "createdAt": {"S": "2026-07-01T00:00:00Z"},
        "expiresAt": {"N": str(int(time.time()) + 86400)},
    }
    if qr_updated:
        item["qrUpdatedAt"] = {"S": qr_updated}
    return item


def _setup(item=None):
    ddb = MagicMock()
    ddb.get_item.return_value = {"Item": item} if item else {}
    s3 = MagicMock()
    s3.generate_presigned_url.return_value = "https://s3.example/signed-get"
    s3.generate_presigned_post.return_value = {
        "url": "https://s3.example/bucket",
        "fields": {"key": "qr/abc1234.png", "Content-Type": "image/png", "policy": "p"},
    }
    return ddb, s3


def _call(ddb, s3, event):
    kvs = MagicMock()
    kvs.describe_key_value_store.return_value = {"ETag": "e"}
    with patch.object(tools_handler, "QR_BUCKET", BUCKET), \
         patch.object(tools_handler, "_ddb", return_value=ddb), \
         patch.object(tools_handler, "_s3Client", return_value=s3), \
         patch.object(tools_handler, "_kvsClient", return_value=kvs):
        return tools_handler.handler(event, None)


def _not_found():
    return ClientError({"Error": {"Code": "404", "Message": "nf"}}, "HeadObject")


# --- presign ------------------------------------------------------------------


def test_presign_owner_ok_enforces_size_and_type():
    ddb, s3 = _setup(_item())
    res = _call(ddb, s3, _event("/s/abc1234/qr", "POST"))
    assert res["statusCode"] == 200
    body = json.loads(res["body"])
    assert body["uploadUrl"] == "https://s3.example/bucket"
    assert body["fields"]["key"] == "qr/abc1234.png"
    kwargs = s3.generate_presigned_post.call_args.kwargs
    assert kwargs["Bucket"] == BUCKET
    assert kwargs["Key"] == "qr/abc1234.png"
    assert ["content-length-range", 1, 5 * 1024 * 1024] in kwargs["Conditions"]
    assert {"Content-Type": "image/png"} in kwargs["Conditions"]
    assert kwargs["ExpiresIn"] == 300
    # Presign alone must not touch the item.
    ddb.update_item.assert_not_called()


def test_presign_non_owner_404():
    ddb, s3 = _setup(_item(owner="someone-else"))
    res = _call(ddb, s3, _event("/s/abc1234/qr", "POST"))
    assert res["statusCode"] == 404
    s3.generate_presigned_post.assert_not_called()


def test_presign_missing_link_404():
    ddb, s3 = _setup(None)
    res = _call(ddb, s3, _event("/s/nope/qr", "POST"))
    assert res["statusCode"] == 404
    s3.generate_presigned_post.assert_not_called()


# --- confirm (PUT) ---------------------------------------------------------------


def test_confirm_sets_attribute_and_returns_qr_url():
    ddb, s3 = _setup(_item())
    s3.head_object.return_value = {"ContentLength": 1234}
    res = _call(ddb, s3, _event("/s/abc1234/qr", "PUT"))
    assert res["statusCode"] == 200
    body = json.loads(res["body"])
    assert body["qrUrl"] == "https://s3.example/signed-get"
    assert body["qrUpdatedAt"]
    s3.head_object.assert_called_once_with(Bucket=BUCKET, Key="qr/abc1234.png")
    kwargs = ddb.update_item.call_args.kwargs
    assert kwargs["UpdateExpression"] == "SET qrUpdatedAt = :u"
    assert kwargs["ExpressionAttributeValues"][":u"]["S"] == body["qrUpdatedAt"]


def test_confirm_400_when_object_absent():
    ddb, s3 = _setup(_item())
    s3.head_object.side_effect = _not_found()
    res = _call(ddb, s3, _event("/s/abc1234/qr", "PUT"))
    assert res["statusCode"] == 400
    ddb.update_item.assert_not_called()


def test_confirm_non_owner_404():
    ddb, s3 = _setup(_item(owner="someone-else"))
    res = _call(ddb, s3, _event("/s/abc1234/qr", "PUT"))
    assert res["statusCode"] == 404
    s3.head_object.assert_not_called()
    ddb.update_item.assert_not_called()


# --- delete QR -------------------------------------------------------------------


def test_delete_qr_removes_object_and_attribute():
    ddb, s3 = _setup(_item(qr_updated="2026-07-02T00:00:00Z"))
    res = _call(ddb, s3, _event("/s/abc1234/qr", "DELETE"))
    assert res["statusCode"] == 200
    s3.delete_object.assert_called_once_with(Bucket=BUCKET, Key="qr/abc1234.png")
    assert ddb.update_item.call_args.kwargs["UpdateExpression"] == "REMOVE qrUpdatedAt"


def test_delete_qr_non_owner_404():
    ddb, s3 = _setup(_item(owner="someone-else"))
    res = _call(ddb, s3, _event("/s/abc1234/qr", "DELETE"))
    assert res["statusCode"] == 404
    s3.delete_object.assert_not_called()
    ddb.update_item.assert_not_called()


# --- list / get include qrUrl only when present -----------------------------------


def test_list_includes_qr_url_only_when_present():
    ddb, s3 = _setup()
    ddb.query.return_value = {
        "Items": [
            _item("withqr1", qr_updated="2026-07-02T00:00:00Z"),
            _item("noqr123"),
        ]
    }
    res = _call(ddb, s3, _event("/s", "GET"))
    items = {i["code"]: i for i in json.loads(res["body"])["items"]}
    assert items["withqr1"]["qrUrl"] == "https://s3.example/signed-get"
    assert items["withqr1"]["qrUpdatedAt"] == "2026-07-02T00:00:00Z"
    assert "qrUrl" not in items["noqr123"]
    assert "qrUpdatedAt" not in items["noqr123"]
    assert s3.generate_presigned_url.call_count == 1
    assert s3.generate_presigned_url.call_args.kwargs["ExpiresIn"] == 3600


def test_get_link_includes_qr_url_when_present():
    ddb, s3 = _setup(_item(qr_updated="2026-07-02T00:00:00Z"))
    res = _call(ddb, s3, _event("/s/abc1234", "GET"))
    assert json.loads(res["body"])["qrUrl"] == "https://s3.example/signed-get"


def test_get_link_without_qr_has_no_qr_fields():
    ddb, s3 = _setup(_item())
    body = json.loads(_call(ddb, s3, _event("/s/abc1234", "GET"))["body"])
    assert "qrUrl" not in body


# --- deleting the link also deletes the QR -----------------------------------------


def test_link_delete_also_deletes_qr_object():
    ddb, s3 = _setup(_item(qr_updated="2026-07-02T00:00:00Z"))
    res = _call(ddb, s3, _event("/s/abc1234", "DELETE"))
    assert res["statusCode"] == 200
    s3.delete_object.assert_called_once_with(Bucket=BUCKET, Key="qr/abc1234.png")
    ddb.delete_item.assert_called_once()


def test_link_delete_survives_qr_delete_failure():
    ddb, s3 = _setup(_item())
    s3.delete_object.side_effect = RuntimeError("boom")
    res = _call(ddb, s3, _event("/s/abc1234", "DELETE"))
    assert res["statusCode"] == 200
    ddb.delete_item.assert_called_once()
