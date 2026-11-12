"""File Drop (FUNK-76): expiring file share links, up to 5 GB.

Bytes never touch the Lambda. The browser uploads straight to a private
ca-central-1 S3 bucket with a multipart upload, using presigned UploadPart
URLs minted here; downloads are 5-minute presigned GETs. Metadata lives in the
text-share DynamoDB table (hash key `id`, GSI byCreator on createdBy/createdAt,
TTL on expiresAt) with `kind = "file"`; text-share code paths ignore those.

API contract (all JSON; errors are {"error": "..."}):

JWT routes (owner = JWT `sub`)
  POST   /tools/files                 {name, size, contentType?, expiry, password?, oneTime?}
         -> 201 {id, uploadId, partSize, partCount, expiresAt}
         expiry in 1h|1d|7d|30d; size 1..5 GiB (413 beyond); 409 over quota.
  POST   /tools/files/{id}/parts      {partNumbers: [1..100 ints, each 1..partCount]}
         -> 200 {urls: [{partNumber, url}]}   (403 not owner, 409 not uploading)
  POST   /tools/files/{id}/complete   {parts: [{partNumber, etag}]}  (exactly partCount)
         -> 200 {id, status: "ready", size, expiresAt}   (400 on size mismatch)
  DELETE /tools/files/{id}            -> 200 {deleted: true}   (404 if gone)
  GET    /tools/files                 -> 200 {files: [{id, name, size, status,
         expiresAt, createdAt, hasPassword, oneTime, downloadCount}],
         usage: {count, bytes, maxCount, maxBytes}}   newest first, unexpired only

Public routes (NO authorizer; must never read claims)
  GET  /tools/f/{id}                  -> 200 {name, size, expiresAt, hasPassword, oneTime}
  POST /tools/f/{id}/download         {password?} -> 200 {url, name, size}
  Both: 404 not found/deleted/not ready, 410 expired or one-time already
  downloaded, 423 locked after 10 wrong passwords; download: 403 wrong password.
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from datetime import datetime, timezone
from urllib.parse import quote

from botocore.exceptions import ClientError

BUCKET = os.environ.get("FILES_BUCKET", "")
BUCKET_REGION = os.environ.get("FILES_BUCKET_REGION", "ca-central-1")
TABLE = os.environ.get("TEXT_TABLE_NAME", "")
TABLE_REGION = os.environ.get("TEXT_TABLE_REGION", "ca-central-1")

MAX_FILE_BYTES = 5 * 1024 ** 3
PART_SIZE = 16 * 1024 ** 2
MAX_PARTS_PER_REQUEST = 100
MAX_ACTIVE_FILES = 20
MAX_TOTAL_BYTES = 10 * 1024 ** 3
MAX_NAME_LEN = 255
MAX_PASSWORD_LEN = 128
MAX_CONTENT_TYPE_LEN = 255
MAX_WRONG_ATTEMPTS = 10
PBKDF2_ITERATIONS = 200_000
PART_URL_EXPIRES_IN = 3600
DOWNLOAD_URL_EXPIRES_IN = 300

EXPIRY_SECONDS = {"1h": 3600, "1d": 86400, "7d": 7 * 86400, "30d": 30 * 86400}
# ponytail: a 1 h file's bytes live up to a day in S3 (lifecycle granularity is
# days); the public endpoints refuse it at expiresAt, so this is only cleanup.
EXPIRY_TAG = {"1h": "1d", "1d": "1d", "7d": "7d", "30d": "30d"}

_ddb_client = None
_s3_client = None


def _ddb():
    global _ddb_client
    if _ddb_client is None:
        import boto3
        _ddb_client = boto3.client("dynamodb", region_name=TABLE_REGION)
    return _ddb_client


def _s3():
    """SigV4 + virtual addressing + pinned regional endpoint so presigned URLs
    are valid for a ca-central-1 bucket and the browser never sees a redirect."""
    global _s3_client
    if _s3_client is None:
        import boto3
        from botocore.config import Config
        _s3_client = boto3.client(
            "s3",
            region_name=BUCKET_REGION,
            endpoint_url=f"https://s3.{BUCKET_REGION}.amazonaws.com",
            config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
        )
    return _s3_client


def _now():
    return int(time.time())


def _sub(event):
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {}) or {}
    return claims.get("sub") or claims.get("cognito:username") or claims.get("username") or ""


def _err(message, status):
    return status, {"error": message}


def _body(event):
    try:
        body = json.loads(event.get("body") or "{}")
    except (json.JSONDecodeError, TypeError):
        return None
    return body if isinstance(body, dict) else None


def _key(file_id):
    return f"files/{file_id}"


def _num(item, field, default=0):
    return int(item.get(field, {}).get("N", default))


def sanitizeName(raw):
    """Strip path components, control characters and leading dots.
    Returns (name, error)."""
    if not isinstance(raw, str):
        return None, "name is required"
    name = re.split(r"[/\\]", raw)[-1]
    name = "".join(c for c in name if not (ord(c) < 32 or 127 <= ord(c) < 160))
    name = name.strip().lstrip(".").strip()
    if not name:
        return None, "name is required"
    if len(name) > MAX_NAME_LEN:
        return None, f"name must be at most {MAX_NAME_LEN} characters"
    return name, None


def hashPassword(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return salt.hex(), digest.hex()


def _passwordOk(item, password):
    salt = bytes.fromhex(item["pwSalt"]["S"])
    _, digest = hashPassword(password, salt)
    return hmac.compare_digest(digest, item["pwHash"]["S"])


def contentDisposition(name):
    """RFC 6266 attachment header with an ASCII fallback and RFC 5987 filename*."""
    fallback = "".join(c if (32 <= ord(c) < 127 and c not in '"\;%') else "_" for c in name)
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(name, safe='')}"


def _partCount(size):
    return -(-size // PART_SIZE)


def _ownedItem(event, file_id):
    """Returns (item, errorTuple). Owner-only; expired/foreign-kind items are 404."""
    resp = _ddb().get_item(TableName=TABLE, Key={"id": {"S": file_id}})
    item = resp.get("Item")
    if not item or item.get("kind", {}).get("S") != "file":
        return None, _err("Not found", 404)
    if item.get("createdBy", {}).get("S", "") != _sub(event):
        return None, _err("Forbidden", 403)
    return item, None


def _userFiles(sub):
    """All unexpired file items for a user (GSI byCreator, newest first)."""
    items = []
    kwargs = {
        "TableName": TABLE,
        "IndexName": "byCreator",
        "KeyConditionExpression": "createdBy = :sub",
        "FilterExpression": "expiresAt > :now AND kind = :file",
        "ExpressionAttributeValues": {
            ":sub": {"S": sub},
            ":now": {"N": str(_now())},
            ":file": {"S": "file"},
        },
        "ScanIndexForward": False,
    }
    while True:
        resp = _ddb().query(**kwargs)
        items.extend(resp.get("Items", []))
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            return items
        kwargs["ExclusiveStartKey"] = lek


def _usage(items):
    active = [i for i in items if i.get("status", {}).get("S") in ("uploading", "ready")]
    return {
        "count": len(active),
        "bytes": sum(_num(i, "size") for i in active),
        "maxCount": MAX_ACTIVE_FILES,
        "maxBytes": MAX_TOTAL_BYTES,
    }


def initiate(event):
    body = _body(event)
    if body is None:
        return _err("Invalid JSON body", 400)

    name, e = sanitizeName(body.get("name"))
    if e:
        return _err(e, 400)

    size = body.get("size")
    if not isinstance(size, int) or isinstance(size, bool) or size < 1:
        return _err("size must be a positive integer", 400)
    if size > MAX_FILE_BYTES:
        return _err("File too large: max 5 GB", 413)

    expiry = body.get("expiry")
    if expiry not in EXPIRY_SECONDS:
        return _err("expiry must be one of 1h, 1d, 7d, 30d", 400)

    password = body.get("password")
    if password is not None and (not isinstance(password, str) or len(password) > MAX_PASSWORD_LEN):
        return _err(f"password must be at most {MAX_PASSWORD_LEN} characters", 400)

    content_type = body.get("contentType") or "application/octet-stream"
    if not isinstance(content_type, str) or len(content_type) > MAX_CONTENT_TYPE_LEN:
        return _err("Invalid contentType", 400)

    one_time = body.get("oneTime", False)
    if not isinstance(one_time, bool):
        return _err("oneTime must be a boolean", 400)

    sub = _sub(event)
    usage = _usage(_userFiles(sub))
    if usage["count"] >= MAX_ACTIVE_FILES:
        return _err(f"File limit reached: max {MAX_ACTIVE_FILES} active files", 409)
    if usage["bytes"] + size > MAX_TOTAL_BYTES:
        return _err("Storage limit reached: max 10 GB of active files", 409)

    file_id = secrets.token_urlsafe(16)
    # While uploading, keep the item for at least a day (matching the bucket's
    # abort-incomplete-multipart rule) so a slow upload of a 1 h file isn't
    # TTL-reaped mid-upload; complete() resets expiresAt to now + the chosen expiry.
    expires_at = _now() + max(EXPIRY_SECONDS[expiry], 86400)
    part_count = _partCount(size)

    upload = _s3().create_multipart_upload(
        Bucket=BUCKET,
        Key=_key(file_id),
        ContentType=content_type,
        Tagging=f"expiry={EXPIRY_TAG[expiry]}",
    )
    upload_id = upload["UploadId"]

    item = {
        "id": {"S": file_id},
        "kind": {"S": "file"},
        "createdBy": {"S": sub},
        "createdAt": {"S": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")},
        "expiresAt": {"N": str(expires_at)},
        "name": {"S": name},
        "size": {"N": str(size)},
        "contentType": {"S": content_type},
        "uploadId": {"S": upload_id},
        "partCount": {"N": str(part_count)},
        "expirySeconds": {"N": str(EXPIRY_SECONDS[expiry])},
        "status": {"S": "uploading"},
        "oneTime": {"BOOL": one_time},
        "downloadCount": {"N": "0"},
        "wrongAttempts": {"N": "0"},
    }
    if password:
        salt, digest = hashPassword(password)
        item["pwSalt"] = {"S": salt}
        item["pwHash"] = {"S": digest}
    try:
        _ddb().put_item(TableName=TABLE, Item=item, ConditionExpression="attribute_not_exists(id)")
    except Exception:
        try:
            _s3().abort_multipart_upload(Bucket=BUCKET, Key=_key(file_id), UploadId=upload_id)
        except ClientError:
            pass
        raise

    return 201, {
        "id": file_id,
        "uploadId": upload_id,
        "partSize": PART_SIZE,
        "partCount": part_count,
        "expiresAt": expires_at,
    }


def partUrls(event, file_id):
    item, err = _ownedItem(event, file_id)
    if err:
        return err
    if item.get("status", {}).get("S") != "uploading":
        return _err("Upload is not in progress", 409)

    body = _body(event)
    nums = (body or {}).get("partNumbers")
    if not isinstance(nums, list) or not 1 <= len(nums) <= MAX_PARTS_PER_REQUEST:
        return _err(f"partNumbers must list 1-{MAX_PARTS_PER_REQUEST} part numbers", 400)
    part_count = _num(item, "partCount")
    size = _num(item, "size")
    if not all(isinstance(n, int) and not isinstance(n, bool) and 1 <= n <= part_count for n in nums):
        return _err(f"part numbers must be integers between 1 and {part_count}", 400)

    urls = []
    for n in nums:
        length = size - (n - 1) * PART_SIZE if n == part_count else PART_SIZE
        url = _s3().generate_presigned_url(
            "upload_part",
            Params={
                "Bucket": BUCKET,
                "Key": _key(file_id),
                "UploadId": item["uploadId"]["S"],
                "PartNumber": n,
                "ContentLength": length,
            },
            ExpiresIn=PART_URL_EXPIRES_IN,
        )
        urls.append({"partNumber": n, "url": url})
    return 200, {"urls": urls}


def complete(event, file_id):
    item, err = _ownedItem(event, file_id)
    if err:
        return err
    if item.get("status", {}).get("S") != "uploading":
        return _err("Upload is not in progress", 409)

    part_count = _num(item, "partCount")
    size = _num(item, "size")
    parts = (_body(event) or {}).get("parts")
    ok = isinstance(parts, list) and len(parts) == part_count and all(
        isinstance(p, dict)
        and isinstance(p.get("partNumber"), int) and not isinstance(p.get("partNumber"), bool)
        and isinstance(p.get("etag"), str) and p["etag"]
        for p in parts
    )
    if not ok or sorted(p["partNumber"] for p in parts) != list(range(1, part_count + 1)):
        return _err(f"parts must contain exactly {part_count} parts numbered 1..{part_count}", 400)

    key = _key(file_id)
    s3 = _s3()
    try:
        s3.complete_multipart_upload(
            Bucket=BUCKET,
            Key=key,
            UploadId=item["uploadId"]["S"],
            MultipartUpload={
                "Parts": [
                    {"PartNumber": p["partNumber"], "ETag": p["etag"]}
                    for p in sorted(parts, key=lambda p: p["partNumber"])
                ]
            },
        )
    except ClientError:
        return _err("Upload could not be completed; check the part ETags and retry", 400)

    actual = s3.head_object(Bucket=BUCKET, Key=key).get("ContentLength", 0)
    if actual != size or actual > MAX_FILE_BYTES:
        s3.delete_object(Bucket=BUCKET, Key=key)
        _ddb().update_item(
            TableName=TABLE,
            Key={"id": {"S": file_id}},
            UpdateExpression="SET #s = :failed",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":failed": {"S": "failed"}},
        )
        return _err("Uploaded size does not match the declared size", 400)

    # The expiry clock restarts at completion so a slow upload doesn't eat it.
    expires_at = _now() + _num(item, "expirySeconds")
    _ddb().update_item(
        TableName=TABLE,
        Key={"id": {"S": file_id}},
        UpdateExpression="SET #s = :ready, expiresAt = :exp",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":ready": {"S": "ready"}, ":exp": {"N": str(expires_at)}},
    )
    return 200, {"id": file_id, "status": "ready", "size": size, "expiresAt": expires_at}


def delete(event, file_id):
    item, err = _ownedItem(event, file_id)
    if err:
        return err
    s3 = _s3()
    try:
        if item.get("status", {}).get("S") == "uploading":
            s3.abort_multipart_upload(Bucket=BUCKET, Key=_key(file_id), UploadId=item["uploadId"]["S"])
        else:
            s3.delete_object(Bucket=BUCKET, Key=_key(file_id))
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") != "NoSuchUpload":
            raise
    _ddb().delete_item(TableName=TABLE, Key={"id": {"S": file_id}})
    return 200, {"deleted": True}


def listFiles(event):
    items = _userFiles(_sub(event))
    files = [
        {
            "id": i["id"]["S"],
            "name": i.get("name", {}).get("S", ""),
            "size": _num(i, "size"),
            "status": i.get("status", {}).get("S", ""),
            "expiresAt": _num(i, "expiresAt"),
            "createdAt": i.get("createdAt", {}).get("S", ""),
            "hasPassword": "pwHash" in i,
            "oneTime": i.get("oneTime", {}).get("BOOL", False),
            "downloadCount": _num(i, "downloadCount"),
        }
        for i in items
    ]
    return 200, {"files": files, "usage": _usage(items)}


def _publicItem(file_id):
    """Shared gate for the public routes. Returns (item, errorTuple)."""
    resp = _ddb().get_item(TableName=TABLE, Key={"id": {"S": file_id}})
    item = resp.get("Item")
    if (
        not item
        or item.get("kind", {}).get("S") != "file"
        or item.get("status", {}).get("S") != "ready"
    ):
        return None, _err("File not found or deleted", 404)
    if _num(item, "expiresAt") <= _now():
        return None, _err("This link has expired", 410)
    if item.get("oneTime", {}).get("BOOL") and _num(item, "downloadCount") >= 1:
        return None, _err("This file was a one-time download and has already been downloaded", 410)
    if _num(item, "wrongAttempts") >= MAX_WRONG_ATTEMPTS:
        return None, _err("Too many wrong passwords", 423)
    return item, None


def publicGet(event, file_id):
    # Public route: never reads claims.
    item, err = _publicItem(file_id)
    if err:
        return err
    return 200, {
        "name": item["name"]["S"],
        "size": _num(item, "size"),
        "expiresAt": _num(item, "expiresAt"),
        "hasPassword": "pwHash" in item,
        "oneTime": item.get("oneTime", {}).get("BOOL", False),
    }


def publicDownload(event, file_id):
    # Public route: never reads claims.
    item, err = _publicItem(file_id)
    if err:
        return err
    body = _body(event)
    if body is None:
        return _err("Invalid JSON body", 400)

    key = {"id": {"S": file_id}}
    if "pwHash" in item:
        password = body.get("password")
        if not isinstance(password, str) or not _passwordOk(item, password):
            resp = _ddb().update_item(
                TableName=TABLE,
                Key=key,
                UpdateExpression="ADD wrongAttempts :one",
                ExpressionAttributeValues={":one": {"N": "1"}},
                ReturnValues="UPDATED_NEW",
            )
            attempts = int(resp.get("Attributes", {}).get("wrongAttempts", {}).get("N", "0"))
            if attempts >= MAX_WRONG_ATTEMPTS:
                return _err("Too many wrong passwords", 423)
            return _err("Wrong password", 403)

    if item.get("oneTime", {}).get("BOOL"):
        # Atomic claim: only one caller can move downloadCount from 0 to 1.
        # ponytail: the presigned URL itself stays usable for its 5-minute life.
        try:
            _ddb().update_item(
                TableName=TABLE,
                Key=key,
                UpdateExpression="SET downloadCount = :one",
                ConditionExpression="attribute_not_exists(downloadCount) OR downloadCount = :zero",
                ExpressionAttributeValues={":one": {"N": "1"}, ":zero": {"N": "0"}},
            )
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
                return _err("This file was a one-time download and has already been downloaded", 410)
            raise
    else:
        _ddb().update_item(
            TableName=TABLE,
            Key=key,
            UpdateExpression="ADD downloadCount :one",
            ExpressionAttributeValues={":one": {"N": "1"}},
        )

    name = item["name"]["S"]
    url = _s3().generate_presigned_url(
        "get_object",
        Params={
            "Bucket": BUCKET,
            "Key": _key(file_id),
            "ResponseContentDisposition": contentDisposition(name),
            "ResponseContentType": "application/octet-stream",
        },
        ExpiresIn=DOWNLOAD_URL_EXPIRES_IN,
    )
    return 200, {"url": url, "name": name, "size": _num(item, "size")}
