"""Unit tests for File Drop (src/lambda/tools/filedrop.py, FUNK-76)."""
import json
import re
import sys
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools import filedrop, handler as tools_handler  # noqa: E402

MIB = 1024 ** 2
GIB = 1024 ** 3


def _event(path, method="GET", body=None, sub="user-1", authed=True):
    rc = {"http": {"method": method, "path": path}}
    if authed:
        rc["authorizer"] = {"jwt": {"claims": {"sub": sub}}}
    return {
        "rawPath": path,
        "requestContext": rc,
        "headers": {},
        "body": json.dumps(body) if body is not None else "{}",
    }


def _call(path, method, body=None, **kw):
    resp = tools_handler.handler(_event(path, method, body, **kw), None)
    return resp["statusCode"], json.loads(resp["body"])


@pytest.fixture
def aws():
    ddb, s3 = MagicMock(), MagicMock()
    ddb.query.return_value = {"Items": []}
    ddb.get_item.return_value = {}
    s3.create_multipart_upload.return_value = {"UploadId": "up-1"}
    s3.generate_presigned_url.side_effect = lambda op, Params, ExpiresIn: f"https://s3/{op}?n={Params.get('PartNumber', '')}"
    with patch.object(filedrop, "_ddb", return_value=ddb), patch.object(
        filedrop, "_s3", return_value=s3
    ), patch.object(filedrop, "BUCKET", "bkt"), patch.object(filedrop, "TABLE", "tbl"):
        yield ddb, s3


def _item(fid="abc", sub="user-1", status="ready", size=100, expires=None, **extra):
    item = {
        "id": {"S": fid},
        "kind": {"S": "file"},
        "createdBy": {"S": sub},
        "createdAt": {"S": "2026-11-01T00:00:00Z"},
        "expiresAt": {"N": str(expires if expires is not None else int(time.time()) + 3600)},
        "name": {"S": "a.txt"},
        "size": {"N": str(size)},
        "uploadId": {"S": "up-1"},
        "partCount": {"N": str(filedrop._partCount(size))},
        "expirySeconds": {"N": "3600"},
        "status": {"S": status},
        "oneTime": {"BOOL": False},
        "downloadCount": {"N": "0"},
        "wrongAttempts": {"N": "0"},
    }
    item.update(extra)
    return item


def _pw_item(password="hunter2", **extra):
    salt, digest = filedrop.hashPassword(password)
    return _item(pwSalt={"S": salt}, pwHash={"S": digest}, **extra)


def _assert_no_floats(obj):
    if isinstance(obj, float):
        raise AssertionError("float written to DynamoDB")
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == "N":
                assert isinstance(v, str) and re.fullmatch(r"\d+", v), v
            _assert_no_floats(v)
    if isinstance(obj, list):
        for v in obj:
            _assert_no_floats(v)


# --- initiate ----------------------------------------------------------------


@pytest.mark.parametrize(
    "size,count",
    [(1, 1), (16 * MIB, 1), (16 * MIB + 1, 2), (5 * GIB, 320)],
)
def test_initiate_part_counts(aws, size, count):
    status, body = _call("/tools/files", "POST", {"name": "a.bin", "size": size, "expiry": "1d"})
    assert status == 201
    assert body["partSize"] == 16 * MIB
    assert body["partCount"] == count
    assert body["uploadId"] == "up-1" and body["id"] and body["expiresAt"] > time.time()


@pytest.mark.parametrize("size,status", [(0, 400), (-1, 400), (5 * GIB + 1, 413), ("5", 400), (1.5, 400), (True, 400)])
def test_initiate_bad_size(aws, size, status):
    assert _call("/tools/files", "POST", {"name": "a", "size": size, "expiry": "1d"})[0] == status


def test_initiate_bad_expiry_and_fields(aws):
    assert _call("/tools/files", "POST", {"name": "a", "size": 1, "expiry": "2d"})[0] == 400
    assert _call("/tools/files", "POST", {"name": "a", "size": 1})[0] == 400
    assert _call("/tools/files", "POST", {"name": "a", "size": 1, "expiry": "1d", "password": "x" * 129})[0] == 400
    assert _call("/tools/files", "POST", {"name": "a", "size": 1, "expiry": "1d", "oneTime": "yes"})[0] == 400
    assert _call("/tools/files", "POST", {"name": "a", "size": 1, "expiry": "1d", "contentType": "x" * 256})[0] == 400
    assert _call("/tools/files", "POST", {"name": "x" * 256, "size": 1, "expiry": "1d"})[0] == 400
    assert _call("/tools/files", "POST", {"name": "...", "size": 1, "expiry": "1d"})[0] == 400


@pytest.mark.parametrize(
    "raw,clean",
    [("../../etc/passwd", "passwd"), ("C:\\x\\y.txt", "y.txt"), ("a\x00b\x1fc.txt", "abc.txt"), (".hidden", "hidden")],
)
def test_name_sanitising(raw, clean):
    assert filedrop.sanitizeName(raw) == (clean, None)


def test_initiate_stores_sanitised_name_and_tag(aws):
    ddb, s3 = aws
    _call("/tools/files", "POST", {"name": "../../etc/passwd", "size": 10, "expiry": "7d"})
    assert ddb.put_item.call_args.kwargs["Item"]["name"] == {"S": "passwd"}
    assert s3.create_multipart_upload.call_args.kwargs["Tagging"] == "expiry=7d"


@pytest.mark.parametrize("expiry,tag", [("1h", "1d"), ("1d", "1d"), ("7d", "7d"), ("30d", "30d")])
def test_expiry_tag_and_ttl(aws, expiry, tag):
    ddb, s3 = aws
    _call("/tools/files", "POST", {"name": "a", "size": 1, "expiry": expiry})
    assert s3.create_multipart_upload.call_args.kwargs["Tagging"] == f"expiry={tag}"
    exp = int(ddb.put_item.call_args.kwargs["Item"]["expiresAt"]["N"])
    # Uploading items live at least a day (upload grace); complete() sets the real expiry.
    assert abs(exp - (time.time() + max(filedrop.EXPIRY_SECONDS[expiry], 86400))) < 5


def test_initiate_no_floats_and_password_hashed(aws):
    ddb, _ = aws
    status, _b = _call(
        "/tools/files", "POST", {"name": "a", "size": 5, "expiry": "1d", "password": "s3cret-pw", "oneTime": True}
    )
    assert status == 201
    kwargs = ddb.put_item.call_args.kwargs
    _assert_no_floats(kwargs)
    assert "s3cret-pw" not in json.dumps(kwargs, default=str)
    item = kwargs["Item"]
    assert item["kind"] == {"S": "file"} and item["status"] == {"S": "uploading"}
    assert item["oneTime"] == {"BOOL": True}
    assert len(bytes.fromhex(item["pwSalt"]["S"])) == 16 and len(item["pwHash"]["S"]) == 64


def test_initiate_no_password_no_hash(aws):
    ddb, _ = aws
    _call("/tools/files", "POST", {"name": "a", "size": 5, "expiry": "1d"})
    assert "pwHash" not in ddb.put_item.call_args.kwargs["Item"]


def test_quota_count(aws):
    ddb, s3 = aws
    ddb.query.return_value = {"Items": [_item(fid=str(i)) for i in range(20)]}
    status, body = _call("/tools/files", "POST", {"name": "a", "size": 1, "expiry": "1d"})
    assert status == 409 and "20" in body["error"]
    s3.create_multipart_upload.assert_not_called()


def test_quota_bytes(aws):
    ddb, _ = aws
    ddb.query.return_value = {"Items": [_item(size=6 * GIB), _item(fid="b", size=4 * GIB)]}
    status, body = _call("/tools/files", "POST", {"name": "a", "size": 1, "expiry": "1d"})
    assert status == 409 and "10 GB" in body["error"]


def test_quota_ignores_failed_and_paginates(aws):
    ddb, _ = aws
    ddb.query.side_effect = [
        {"Items": [_item(status="failed", size=9 * GIB)], "LastEvaluatedKey": {"id": {"S": "x"}}},
        {"Items": [_item(fid="b", size=GIB)]},
    ]
    assert _call("/tools/files", "POST", {"name": "a", "size": GIB, "expiry": "1d"})[0] == 201
    assert ddb.query.call_count == 2


# --- parts -------------------------------------------------------------------


def test_parts_happy_and_last_part_length(aws):
    ddb, s3 = aws
    size = 16 * MIB + 5
    ddb.get_item.return_value = {"Item": _item(status="uploading", size=size)}
    status, body = _call("/tools/files/abc/parts", "POST", {"partNumbers": [1, 2]})
    assert status == 200 and [u["partNumber"] for u in body["urls"]] == [1, 2]
    lengths = {c.kwargs["Params"]["PartNumber"]: c.kwargs["Params"]["ContentLength"] for c in s3.generate_presigned_url.call_args_list}
    assert lengths == {1: 16 * MIB, 2: 5}
    assert s3.generate_presigned_url.call_args.kwargs["ExpiresIn"] == 3600


def test_parts_errors(aws):
    ddb, _ = aws
    ddb.get_item.return_value = {"Item": _item(status="uploading", size=16 * MIB + 5, sub="other")}
    assert _call("/tools/files/abc/parts", "POST", {"partNumbers": [1]})[0] == 403
    ddb.get_item.return_value = {"Item": _item(status="ready")}
    assert _call("/tools/files/abc/parts", "POST", {"partNumbers": [1]})[0] == 409
    ddb.get_item.return_value = {"Item": _item(status="uploading", size=16 * MIB + 5)}
    assert _call("/tools/files/abc/parts", "POST", {"partNumbers": [3]})[0] == 400
    assert _call("/tools/files/abc/parts", "POST", {"partNumbers": [0]})[0] == 400
    assert _call("/tools/files/abc/parts", "POST", {"partNumbers": []})[0] == 400
    assert _call("/tools/files/abc/parts", "POST", {"partNumbers": [1] * 101})[0] == 400
    assert _call("/tools/files/abc/parts", "POST", {"partNumbers": ["1"]})[0] == 400
    ddb.get_item.return_value = {}
    assert _call("/tools/files/abc/parts", "POST", {"partNumbers": [1]})[0] == 404


def test_parts_100_allowed(aws):
    ddb, _ = aws
    ddb.get_item.return_value = {"Item": _item(status="uploading", size=5 * GIB)}
    status, body = _call("/tools/files/abc/parts", "POST", {"partNumbers": list(range(1, 101))})
    assert status == 200 and len(body["urls"]) == 100


# --- complete ----------------------------------------------------------------


def _parts(n):
    return [{"partNumber": i, "etag": f'"e{i}"'} for i in range(1, n + 1)]


def test_complete_wrong_part_count(aws):
    ddb, s3 = aws
    ddb.get_item.return_value = {"Item": _item(status="uploading", size=16 * MIB + 5)}
    assert _call("/tools/files/abc/complete", "POST", {"parts": _parts(1)})[0] == 400
    assert _call("/tools/files/abc/complete", "POST", {"parts": [_parts(1)[0], _parts(1)[0]]})[0] == 400
    assert _call("/tools/files/abc/complete", "POST", {})[0] == 400
    s3.complete_multipart_upload.assert_not_called()


def test_complete_size_mismatch_deletes_object(aws):
    ddb, s3 = aws
    ddb.get_item.return_value = {"Item": _item(status="uploading", size=100)}
    s3.head_object.return_value = {"ContentLength": 99}
    status, _b = _call("/tools/files/abc/complete", "POST", {"parts": _parts(1)})
    assert status == 400
    s3.delete_object.assert_called_once_with(Bucket="bkt", Key="files/abc")
    assert ddb.update_item.call_args.kwargs["ExpressionAttributeValues"][":failed"] == {"S": "failed"}


def test_complete_happy(aws):
    ddb, s3 = aws
    ddb.get_item.return_value = {"Item": _item(status="uploading", size=100)}
    s3.head_object.return_value = {"ContentLength": 100}
    status, body = _call("/tools/files/abc/complete", "POST", {"parts": _parts(1)})
    assert status == 200 and body["status"] == "ready" and body["size"] == 100
    assert s3.complete_multipart_upload.call_args.kwargs["MultipartUpload"] == {
        "Parts": [{"PartNumber": 1, "ETag": '"e1"'}]
    }
    _assert_no_floats(ddb.update_item.call_args.kwargs)


def test_complete_s3_error_and_non_owner(aws):
    ddb, s3 = aws
    ddb.get_item.return_value = {"Item": _item(status="uploading", size=100)}
    s3.complete_multipart_upload.side_effect = ClientError({"Error": {"Code": "InvalidPart"}}, "Complete")
    assert _call("/tools/files/abc/complete", "POST", {"parts": _parts(1)})[0] == 400
    ddb.get_item.return_value = {"Item": _item(status="uploading", sub="other")}
    assert _call("/tools/files/abc/complete", "POST", {"parts": _parts(1)})[0] == 403


# --- delete ------------------------------------------------------------------


def test_delete_uploading_aborts(aws):
    ddb, s3 = aws
    ddb.get_item.return_value = {"Item": _item(status="uploading")}
    assert _call("/tools/files/abc", "DELETE") == (200, {"deleted": True})
    s3.abort_multipart_upload.assert_called_once_with(Bucket="bkt", Key="files/abc", UploadId="up-1")
    ddb.delete_item.assert_called_once()


def test_delete_ready_deletes_object(aws):
    ddb, s3 = aws
    ddb.get_item.return_value = {"Item": _item(status="ready")}
    assert _call("/tools/files/abc", "DELETE")[0] == 200
    s3.delete_object.assert_called_once_with(Bucket="bkt", Key="files/abc")


def test_delete_non_owner_and_missing(aws):
    ddb, s3 = aws
    ddb.get_item.return_value = {"Item": _item(sub="other")}
    assert _call("/tools/files/abc", "DELETE")[0] == 403
    s3.delete_object.assert_not_called()
    ddb.get_item.return_value = {}
    assert _call("/tools/files/abc", "DELETE")[0] == 404


def test_delete_ignores_text_item(aws):
    ddb, s3 = aws
    ddb.get_item.return_value = {"Item": {"id": {"S": "t"}, "kind": {"S": "text"}, "createdBy": {"S": "user-1"}}}
    assert _call("/tools/files/t", "DELETE")[0] == 404
    ddb.delete_item.assert_not_called()


# --- list --------------------------------------------------------------------


def test_list_usage_and_shape(aws):
    ddb, _ = aws
    ddb.query.return_value = {
        "Items": [
            _item(fid="a", size=100, status="ready", pwHash={"S": "h"}, pwSalt={"S": "s"}),
            _item(fid="b", size=50, status="uploading"),
            _item(fid="c", size=999, status="failed"),
        ]
    }
    status, body = _call("/tools/files", "GET")
    assert status == 200
    assert [f["id"] for f in body["files"]] == ["a", "b", "c"]
    assert body["files"][0]["hasPassword"] is True and body["files"][1]["hasPassword"] is False
    assert set(body["files"][0]) == {"id", "name", "size", "status", "expiresAt", "createdAt", "hasPassword", "oneTime", "downloadCount"}
    assert body["usage"] == {"count": 2, "bytes": 150, "maxCount": 20, "maxBytes": 10 * GIB}
    kw = ddb.query.call_args.kwargs
    assert kw["IndexName"] == "byCreator" and kw["ScanIndexForward"] is False
    # expired and text items are excluded by the query filter itself
    assert "expiresAt > :now" in kw["FilterExpression"] and "kind = :file" in kw["FilterExpression"]


# --- public get --------------------------------------------------------------


def _pub(path, method="GET", body=None):
    return _call(path, method, body, authed=False)


def test_public_get_ok_without_claims(aws):
    ddb, _ = aws
    ddb.get_item.return_value = {"Item": _pw_item(oneTime={"BOOL": True})}
    status, body = _pub("/tools/f/abc")
    assert status == 200
    assert body["name"] == "a.txt" and body["hasPassword"] is True and body["oneTime"] is True
    assert "pwHash" not in json.dumps(body)


def test_public_get_errors(aws):
    ddb, _ = aws
    ddb.get_item.return_value = {}
    assert _pub("/tools/f/abc")[0] == 404
    ddb.get_item.return_value = {"Item": _item(status="uploading")}
    assert _pub("/tools/f/abc")[0] == 404
    ddb.get_item.return_value = {"Item": {"id": {"S": "t"}, "kind": {"S": "text"}}}
    assert _pub("/tools/f/abc")[0] == 404
    ddb.get_item.return_value = {"Item": _item(expires=int(time.time()) - 5)}
    status, body = _pub("/tools/f/abc")
    assert status == 410 and body["error"] == "This link has expired"
    ddb.get_item.return_value = {"Item": _item(oneTime={"BOOL": True}, downloadCount={"N": "1"})}
    assert _pub("/tools/f/abc")[0] == 410
    ddb.get_item.return_value = {"Item": _item(wrongAttempts={"N": "10"})}
    assert _pub("/tools/f/abc")[0] == 423


# --- download ----------------------------------------------------------------


def test_download_no_password(aws):
    ddb, s3 = aws
    ddb.get_item.return_value = {"Item": _item()}
    status, body = _pub("/tools/f/abc/download", "POST", {})
    assert status == 200 and body["name"] == "a.txt" and body["size"] == 100 and body["url"]
    params = s3.generate_presigned_url.call_args.kwargs["Params"]
    assert params["ResponseContentType"] == "application/octet-stream"
    assert params["ResponseContentDisposition"].startswith("attachment;")
    assert params["Key"] == "files/abc"
    assert s3.generate_presigned_url.call_args.kwargs["ExpiresIn"] == 300


def test_download_wrong_password_increments(aws):
    ddb, s3 = aws
    ddb.get_item.return_value = {"Item": _pw_item()}
    ddb.update_item.return_value = {"Attributes": {"wrongAttempts": {"N": "1"}}}
    for pw in ({"password": "nope"}, {}):
        status, body = _pub("/tools/f/abc/download", "POST", pw)
        assert status == 403 and body["error"] == "Wrong password"
    assert "wrongAttempts" in ddb.update_item.call_args.kwargs["UpdateExpression"]
    s3.generate_presigned_url.assert_not_called()


def test_download_tenth_wrong_locks(aws):
    ddb, _ = aws
    ddb.get_item.return_value = {"Item": _pw_item(wrongAttempts={"N": "9"})}
    ddb.update_item.return_value = {"Attributes": {"wrongAttempts": {"N": "10"}}}
    assert _pub("/tools/f/abc/download", "POST", {"password": "x"})[0] == 423
    ddb.get_item.return_value = {"Item": _pw_item(wrongAttempts={"N": "10"})}
    assert _pub("/tools/f/abc/download", "POST", {"password": "hunter2"})[0] == 423


def test_download_right_password(aws):
    ddb, _ = aws
    ddb.get_item.return_value = {"Item": _pw_item()}
    status, body = _pub("/tools/f/abc/download", "POST", {"password": "hunter2"})
    assert status == 200 and body["url"]


def test_download_one_time_conditional(aws):
    ddb, _ = aws
    ddb.get_item.return_value = {"Item": _item(oneTime={"BOOL": True})}
    assert _pub("/tools/f/abc/download", "POST", {})[0] == 200
    kw = ddb.update_item.call_args.kwargs
    assert "downloadCount = :zero" in kw["ConditionExpression"]
    _assert_no_floats(kw)
    # lost race: conditional check fails -> 410
    ddb.update_item.side_effect = ClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, "UpdateItem")
    status, body = _pub("/tools/f/abc/download", "POST", {})
    assert status == 410 and "already been downloaded" in body["error"]
    # and once the item shows downloadCount 1, the gate refuses up front
    ddb.get_item.return_value = {"Item": _item(oneTime={"BOOL": True}, downloadCount={"N": "1"})}
    assert _pub("/tools/f/abc/download", "POST", {})[0] == 410


def test_download_wrong_password_does_not_burn_one_time(aws):
    ddb, _ = aws
    ddb.get_item.return_value = {"Item": _pw_item(oneTime={"BOOL": True})}
    ddb.update_item.return_value = {"Attributes": {"wrongAttempts": {"N": "1"}}}
    _pub("/tools/f/abc/download", "POST", {"password": "bad"})
    assert all("ConditionExpression" not in c.kwargs for c in ddb.update_item.call_args_list)


def test_download_non_ascii_filename(aws):
    ddb, s3 = aws
    ddb.get_item.return_value = {"Item": _item(name={"S": 'résumé "final"; 日本.pdf'})}
    _pub("/tools/f/abc/download", "POST", {})
    cd = s3.generate_presigned_url.call_args.kwargs["Params"]["ResponseContentDisposition"]
    assert cd == (
        "attachment; filename=\"r_sum_ _final__ __.pdf\"; "
        "filename*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22%3B%20%E6%97%A5%E6%9C%AC.pdf"
    ) or cd.endswith("filename*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22%3B%20%E6%97%A5%E6%9C%AC.pdf")
    assert cd.isascii()


# --- text-share isolation ----------------------------------------------------


def test_text_list_filters_files():
    ddb = MagicMock()
    ddb.query.return_value = {"Items": []}
    with patch.object(tools_handler, "_textDdb", return_value=ddb):
        tools_handler.handler(_event("/tools/text", "GET"), None)
    kw = ddb.query.call_args.kwargs
    assert "kind <> :file" in kw["FilterExpression"]
    assert kw["ExpressionAttributeValues"][":file"] == {"S": "file"}


def test_text_get_and_delete_ignore_file_items():
    ddb = MagicMock()
    ddb.get_item.return_value = {"Item": _item()}
    with patch.object(tools_handler, "_textDdb", return_value=ddb):
        r = tools_handler.handler(_event("/tools/text/abc", "GET", authed=False), None)
        assert r["statusCode"] == 404
        r = tools_handler.handler(_event("/tools/text/abc", "DELETE"), None)
        assert r["statusCode"] == 404
    ddb.delete_item.assert_not_called()
