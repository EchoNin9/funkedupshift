"""
Meme generator API: CRUD, upload, tags, title generation, stars, cache.
Access: Memes custom group OR admin.
"""
import json
import logging
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ.get("TABLE_NAME", "")
MEDIA_BUCKET = os.environ.get("MEDIA_BUCKET", "")
BEDROCK_MODEL_ID = "amazon.nova-micro-v1:0"
MEME_CACHE_MAX = 20
VALID_IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp")
MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024  # 10MB
FETCH_TIMEOUT_SEC = 10


def _get_user_custom_groups(user_id):
    """Fetch user's custom group memberships from DynamoDB."""
    if not TABLE_NAME or not user_id:
        return []
    try:
        import boto3
        dynamodb = boto3.client("dynamodb")
        pk = f"USER#{user_id}"
        result = dynamodb.query(
            TableName=TABLE_NAME,
            KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues={
                ":pk": {"S": pk},
                ":sk": {"S": "MEMBERSHIP#"},
            },
        )
        groups = []
        for item in result.get("Items", []):
            group_name = item.get("groupName", {}).get("S", "")
            if group_name:
                groups.append(group_name)
        return groups
    except Exception as e:
        logger.warning("_getUserCustomGroups error: %s", e)
        return []


def can_access_memes(user):
    """User can access Memes: admin OR in Memes custom group."""
    if not user.get("userId"):
        return False
    if "admin" in user.get("groups", []):
        return True
    custom = _get_user_custom_groups(user["userId"])
    return "Memes" in custom


def _dynamo_item_to_meme(item):
    """Convert DynamoDB item to meme dict."""
    out = {}
    for key, val in item.items():
        if "S" in val:
            out[key] = val["S"]
        elif "N" in val:
            num_str = val["N"]
            out[key] = int(num_str) if "." not in num_str else float(num_str)
        elif "L" in val:
            out[key] = [v.get("S", "") for v in val["L"]]
        elif "BOOL" in val:
            out[key] = val["BOOL"]
    return out


def _add_meme_urls(meme_list, region=None):
    """Set mediaUrl and thumbnailUrl (presigned GET) for each meme."""
    if not MEDIA_BUCKET or not meme_list:
        return
    try:
        import boto3
        region = region or os.environ.get("AWS_REGION", "us-east-1")
        s3 = boto3.client("s3", region_name=region)
        for m in meme_list:
            for key_attr, url_attr in [("mediaKey", "mediaUrl"), ("thumbnailKey", "thumbnailUrl")]:
                key = m.get(key_attr)
                if key and isinstance(key, str) and key.strip():
                    url = s3.generate_presigned_url(
                        "get_object",
                        Params={"Bucket": MEDIA_BUCKET, "Key": key},
                        ExpiresIn=3600,
                    )
                    m[url_attr] = url
            if not m.get("thumbnailUrl") and m.get("mediaUrl"):
                m["thumbnailUrl"] = m["mediaUrl"]
    except Exception as e:
        logger.warning("_addMemeUrls failed: %s", e)


def _validate_image_url(url):
    """Validate URL returns a direct image. Returns (ok, error_msg)."""
    if not url or not str(url).strip():
        return False, "URL is required"
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        return False, "URL must start with http:// or https://"
    parsed = urllib.parse.urlparse(url)
    path_lower = (parsed.path or "").lower()
    if not any(path_lower.endswith(ext) for ext in VALID_IMAGE_EXTENSIONS):
        return False, "URL must point to a direct image (jpg, png, gif, webp, bmp)"
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (compatible; Funkedupshift/1.0)"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_SEC) as resp:
            if resp.status != 200:
                return False, f"HTTP {resp.status}"
            content_type = resp.headers.get("Content-Type", "").lower()
            if "image" not in content_type:
                return False, "URL does not return an image"
            content_length = resp.headers.get("Content-Length")
            if content_length and int(content_length) > MAX_IMAGE_SIZE_BYTES:
                return False, f"Image too large (max {MAX_IMAGE_SIZE_BYTES // (1024*1024)}MB)"
            return True, None
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}: {e.reason}"
    except urllib.error.URLError as e:
        return False, str(e.reason) if e.reason else str(e)
    except Exception as e:
        logger.exception("_validate_image_url error: %s", e)
        return False, str(e)


def generate_meme_title():
    """Generate a random fun name using Bedrock Nova Micro."""
    import random
    adjectives = ["Epic", "Chaotic", "Silly", "Random", "Meme", "Funny", "Wild", "Based"]
    nouns = ["Moment", "Vibe", "Energy", "Mood", "Flex", "Drip", "Chad", "Karen"]
    fallback = f"{random.choice(adjectives)}{random.choice(nouns)}{random.randint(100, 999)}"
    try:
        import boto3
        region = os.environ.get("AWS_REGION", "us-east-1")
        client = boto3.client("bedrock-runtime", region_name=region)
        prompt = """Generate a single short, funny, random meme-like title (2-4 words). Examples: "Chaotic Energy", "Based Karen Moment", "Epic Flex 9000". Be creative and varied. Return ONLY the title, nothing else."""
        response = client.converse(
            modelId=BEDROCK_MODEL_ID,
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": 32, "temperature": 0.9},
        )
        output = response.get("output", {})
        message = output.get("message", {})
        content = message.get("content", [])
        for block in content:
            if block.get("text"):
                title = block["text"].strip()
                if title and len(title) < 80:
                    return title
        return fallback
    except Exception as e:
        logger.warning("generate_meme_title Bedrock error: %s", e)
        return fallback


def list_memes(event, user, json_response):
    """List memes: cache (default), or search. Public memes + user's private memes."""
    if not TABLE_NAME:
        return json_response({"memes": [], "error": "TABLE_NAME not set"}, 200)
    try:
        import boto3
        region = os.environ.get("AWS_REGION", "us-east-1")
        dynamodb = boto3.client("dynamodb", region_name=region)
        qs = event.get("queryStringParameters") or {}
        single_id = (qs.get("id") or "").strip()
        if single_id:
            resp = dynamodb.get_item(
                TableName=TABLE_NAME,
                Key={"PK": {"S": single_id}, "SK": {"S": "METADATA"}},
            )
            if "Item" not in resp:
                return json_response({"error": "Meme not found"}, 404)
            m = _dynamo_item_to_meme(resp["Item"])
            _add_meme_urls([m], region=region)
            if m.get("isPrivate") and m.get("userId") != user.get("userId") and "admin" not in user.get("groups", []):
                return json_response({"error": "Meme not found"}, 404)
            return json_response({"meme": m})

        search_q_param = (qs.get("q") or "").strip()
        tag_ids_param = (qs.get("tagIds") or "").strip()
        use_cache = not search_q_param and not tag_ids_param
        if use_cache:
            cache_resp = dynamodb.get_item(
                TableName=TABLE_NAME,
                Key={"PK": {"S": "MEME_CACHE#latest"}, "SK": {"S": "METADATA"}},
            )
            meme_ids = []
            if "Item" in cache_resp and "memeIds" in cache_resp["Item"]:
                meme_ids = [v.get("S", "") for v in cache_resp["Item"]["memeIds"].get("L", [])]
            if not meme_ids:
                return json_response({"memes": []})

            keys = [{"PK": {"S": mid}, "SK": {"S": "METADATA"}} for mid in meme_ids]
            id_to_meme = {}
            for i in range(0, len(keys), 100):
                batch = keys[i : i + 100]
                batch_resp = dynamodb.batch_get_item(RequestItems={TABLE_NAME: {"Keys": batch}})
                for item in batch_resp.get("Responses", {}).get(TABLE_NAME, []):
                    m = _dynamo_item_to_meme(item)
                    if m.get("isPrivate") and m.get("userId") != user.get("userId") and "admin" not in user.get("groups", []):
                        continue
                    id_to_meme[m.get("PK", "")] = m
            memes = [id_to_meme[mid] for mid in meme_ids if mid in id_to_meme]
            _add_meme_urls(memes, region=region)
            return json_response({"memes": memes})

        result = dynamodb.query(
            TableName=TABLE_NAME,
            IndexName="byEntity",
            KeyConditionExpression="entityType = :et",
            ExpressionAttributeValues={":et": {"S": "MEME"}},
        )
        items = result.get("Items", [])
        while result.get("LastEvaluatedKey"):
            result = dynamodb.query(
                TableName=TABLE_NAME,
                IndexName="byEntity",
                KeyConditionExpression="entityType = :et",
                ExpressionAttributeValues={":et": {"S": "MEME"}},
                ExclusiveStartKey=result["LastEvaluatedKey"],
            )
            items.extend(result.get("Items", []))

        meme_list = [_dynamo_item_to_meme(i) for i in items]
        user_id = user.get("userId")
        is_admin = "admin" in user.get("groups", [])
        meme_list = [m for m in meme_list if not m.get("isPrivate") or m.get("userId") == user_id or is_admin]

        tag_ids = [x.strip() for x in (qs.get("tagIds") or "").split(",") if x.strip()]
        tag_mode = (qs.get("tagMode") or "or").strip().lower() or "or"
        if tag_ids:
            if tag_mode == "and":
                meme_list = [m for m in meme_list if all(t in (m.get("tags") or []) for t in tag_ids)]
            else:
                meme_list = [m for m in meme_list if any(t in (m.get("tags") or []) for t in tag_ids)]

        search_q = (qs.get("q") or "").strip()
        if search_q:
            q_lower = search_q.lower()
            meme_list = [
                m for m in meme_list
                if q_lower in (m.get("title") or "").lower() or q_lower in (m.get("description") or "").lower()
            ]

        limit = min(20, max(1, int((qs.get("limit") or "20").strip() or 20)))
        meme_list = meme_list[:limit]
        _add_meme_urls(meme_list, region=region)
        return json_response({"memes": meme_list})
    except Exception as e:
        logger.exception("listMemes error: %s", e)
        return json_response({"error": str(e), "memes": []}, 500)


def list_meme_tags(event, json_response):
    """List meme tags for autocomplete. Returns all unique tags."""
    if not TABLE_NAME:
        return json_response({"tags": []}, 200)
    try:
        import boto3
        dynamodb = boto3.client("dynamodb")
        resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": "MEME_TAGS#REGISTRY"}, "SK": {"S": "METADATA"}},
        )
        tags = []
        if "Item" in resp and "tags" in resp["Item"]:
            tags = [v.get("S", "") for v in resp["Item"]["tags"].get("L", [])]
        tags = sorted(set(t for t in tags if t))
        q = (event.get("queryStringParameters") or {}).get("q", "").strip().lower()
        if q:
            tags = [t for t in tags if q in t.lower()]
        return json_response({"tags": tags})
    except Exception as e:
        logger.exception("listMemeTags error: %s", e)
        return json_response({"error": str(e), "tags": []}, 500)


def _ensure_tags_in_registry(dynamodb, new_tags):
    """Add new tags to MEME_TAGS#REGISTRY if not exists."""
    if not new_tags:
        return
    resp = dynamodb.get_item(
        TableName=TABLE_NAME,
        Key={"PK": {"S": "MEME_TAGS#REGISTRY"}, "SK": {"S": "METADATA"}},
    )
    existing = []
    if "Item" in resp and "tags" in resp["Item"]:
        existing = [v.get("S", "") for v in resp["Item"]["tags"].get("L", [])]
    combined = sorted(set(existing) | set(new_tags))
    now = datetime.utcnow().isoformat() + "Z"
    dynamodb.put_item(
        TableName=TABLE_NAME,
        Item={
            "PK": {"S": "MEME_TAGS#REGISTRY"},
            "SK": {"S": "METADATA"},
            "tags": {"L": [{"S": t} for t in combined]},
            "updatedAt": {"S": now},
        },
    )


def _update_meme_cache(dynamodb, meme_id):
    """Prepend meme_id to cache, trim to MEME_CACHE_MAX."""
    resp = dynamodb.get_item(
        TableName=TABLE_NAME,
        Key={"PK": {"S": "MEME_CACHE#latest"}, "SK": {"S": "METADATA"}},
    )
    ids = []
    if "Item" in resp and "memeIds" in resp["Item"]:
        ids = [v.get("S", "") for v in resp["Item"]["memeIds"].get("L", [])]
    ids = [meme_id] + [i for i in ids if i != meme_id]
    ids = ids[:MEME_CACHE_MAX]
    now = datetime.utcnow().isoformat() + "Z"
    dynamodb.put_item(
        TableName=TABLE_NAME,
        Item={
            "PK": {"S": "MEME_CACHE#latest"},
            "SK": {"S": "METADATA"},
            "memeIds": {"L": [{"S": i} for i in ids]},
            "updatedAt": {"S": now},
        },
    )


def create_meme(event, user, json_response):
    """Create meme (memes group or admin)."""
    if not TABLE_NAME or not MEDIA_BUCKET:
        return json_response({"error": "Meme service not configured"}, 500)
    try:
        body = json.loads(event.get("body", "{}"))
    except (json.JSONDecodeError, TypeError):
        return json_response({"error": "Invalid JSON body"}, 400)
    media_key = (body.get("mediaKey") or "").strip()
    if not media_key:
        return json_response({"error": "mediaKey is required"}, 400)
    try:
        import boto3
        import uuid as uuid_mod
        meme_id = f"MEME#{uuid_mod.uuid4()}"
        now = datetime.utcnow().isoformat() + "Z"
        user_id = user["userId"]
        title = (body.get("title") or "").strip() or generate_meme_title()
        description = (body.get("description") or "").strip() or ""
        is_private = bool(body.get("isPrivate"))
        tags = [str(t).strip() for t in (body.get("tags") or []) if str(t).strip()]
        text_boxes = body.get("textBoxes") or []
        size_mode = (body.get("sizeMode") or "resize").strip().lower()
        if size_mode not in ("original", "resize"):
            size_mode = "resize"

        dynamodb = boto3.client("dynamodb")
        item = {
            "PK": {"S": meme_id},
            "SK": {"S": "METADATA"},
            "title": {"S": title},
            "description": {"S": description},
            "mediaKey": {"S": media_key},
            "thumbnailKey": {"S": media_key},
            "userId": {"S": user_id},
            "isPrivate": {"BOOL": is_private},
            "tags": {"L": [{"S": t} for t in tags]},
            "textBoxes": {"S": json.dumps(text_boxes) if text_boxes else "[]"},
            "sizeMode": {"S": size_mode},
            "createdAt": {"S": now},
            "updatedAt": {"S": now},
            "entityType": {"S": "MEME"},
            "entitySk": {"S": meme_id},
            "totalStarsSum": {"N": "0"},
            "totalStarsCount": {"N": "0"},
        }
        dynamodb.put_item(TableName=TABLE_NAME, Item=item)
        _ensure_tags_in_registry(dynamodb, tags)
        _update_meme_cache(dynamodb, meme_id)
        return json_response({"id": meme_id, "title": title}, 201)
    except Exception as e:
        logger.exception("createMeme error: %s", e)
        return json_response({"error": str(e)}, 500)


def update_meme(event, user, json_response):
    """Update meme (creator, manager, or admin). Tags only for user/manager/admin."""
    if not TABLE_NAME:
        return json_response({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        import uuid as uuid_mod
        body = json.loads(event.get("body", "{}"))
        meme_id = (body.get("id") or "").strip()
        if not meme_id or not meme_id.startswith("MEME#"):
            return json_response({"error": "id is required"}, 400)
        dynamodb = boto3.client("dynamodb")
        resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": meme_id}, "SK": {"S": "METADATA"}},
        )
        if "Item" not in resp:
            return json_response({"error": "Meme not found"}, 404)
        existing = _dynamo_item_to_meme(resp["Item"])
        creator_id = existing.get("userId", "")
        is_admin = "admin" in user.get("groups", [])
        is_manager = "manager" in user.get("groups", [])
        can_edit = creator_id == user.get("userId") or is_admin or is_manager
        if not can_edit:
            return json_response({"error": "Forbidden: cannot edit this meme"}, 403)

        now = datetime.utcnow().isoformat() + "Z"
        set_parts = ["updatedAt = :now"]
        names = {}
        values = {":now": {"S": now}}
        if "title" in body:
            title_val = (body.get("title") or "").strip()
            set_parts.append("#title = :title")
            names["#title"] = "title"
            values[":title"] = {"S": title_val or existing.get("title", "Untitled")}
        if "description" in body:
            set_parts.append("#description = :desc")
            names["#description"] = "description"
            values[":desc"] = {"S": str(body.get("description", ""))}
        if "isPrivate" in body:
            set_parts.append("isPrivate = :priv")
            values[":priv"] = {"BOOL": bool(body.get("isPrivate"))}
        if "tags" in body:
            tags = [str(t).strip() for t in (body.get("tags") or []) if str(t).strip()]
            set_parts.append("tags = :tags")
            values[":tags"] = {"L": [{"S": t} for t in tags]}
            _ensure_tags_in_registry(dynamodb, tags)

        update_expr = "SET " + ", ".join(set_parts)
        update_kw = {
            "TableName": TABLE_NAME,
            "Key": {"PK": {"S": meme_id}, "SK": {"S": "METADATA"}},
            "UpdateExpression": update_expr,
            "ExpressionAttributeValues": values,
        }
        if names:
            update_kw["ExpressionAttributeNames"] = names
        dynamodb.update_item(**update_kw)
        return json_response({"id": meme_id, "updated": True})
    except Exception as e:
        logger.exception("updateMeme error: %s", e)
        return json_response({"error": str(e)}, 500)


def delete_meme(event, user, json_response):
    """Delete meme (creator or admin)."""
    if not TABLE_NAME:
        return json_response({"error": "TABLE_NAME not set"}, 500)
    try:
        body = json.loads(event.get("body", "{}"))
        meme_id = (body.get("id") or "").strip()
        if not meme_id:
            return json_response({"error": "id is required"}, 400)
        import boto3
        dynamodb = boto3.client("dynamodb")
        resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": meme_id}, "SK": {"S": "METADATA"}},
            ProjectionExpression="userId, mediaKey",
        )
        if "Item" not in resp:
            return json_response({"error": "Meme not found"}, 404)
        creator_id = resp["Item"].get("userId", {}).get("S", "")
        if creator_id != user.get("userId") and "admin" not in user.get("groups", []):
            return json_response({"error": "Forbidden: cannot delete this meme"}, 403)
        dynamodb.delete_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": meme_id}, "SK": {"S": "METADATA"}},
        )
        if MEDIA_BUCKET:
            media_key = resp["Item"].get("mediaKey", {}).get("S", "")
            if media_key:
                try:
                    s3 = boto3.client("s3")
                    s3.delete_object(Bucket=MEDIA_BUCKET, Key=media_key)
                except Exception as e:
                    logger.warning("S3 delete meme media failed: %s", e)
        return json_response({"id": meme_id, "deleted": True})
    except Exception as e:
        logger.exception("deleteMeme error: %s", e)
        return json_response({"error": str(e)}, 500)


def get_meme_presigned_upload(event, user, json_response):
    """Return presigned PUT URL for meme image upload. Prefix: memes/<username>/"""
    if not MEDIA_BUCKET:
        return json_response({"error": "MEDIA_BUCKET not configured"}, 500)
    try:
        import boto3
        import uuid as uuid_mod
        body = json.loads(event.get("body", "{}"))
        meme_id = (body.get("memeId") or body.get("id") or "").strip() or f"MEME#{uuid_mod.uuid4()}"
        if not meme_id.startswith("MEME#"):
            meme_id = f"MEME#{meme_id}"
        content_type = (body.get("contentType") or "image/png").strip()
        ext = "png"
        if "jpeg" in content_type or "jpg" in content_type:
            ext = "jpg"
        elif "gif" in content_type:
            ext = "gif"
        elif "webp" in content_type:
            ext = "webp"
        elif "bmp" in content_type:
            ext = "bmp"
        user_id = user.get("userId", "unknown")
        safe_user = re.sub(r"[^a-zA-Z0-9_-]", "_", user_id)[:64]
        key = f"memes/{safe_user}/{meme_id.replace('#', '_')}_{uuid_mod.uuid4()}.{ext}"
        region = os.environ.get("AWS_REGION", "us-east-1")
        s3 = boto3.client("s3", region_name=region)
        upload_url = s3.generate_presigned_url(
            "put_object",
            Params={"Bucket": MEDIA_BUCKET, "Key": key, "ContentType": content_type},
            ExpiresIn=300,
        )
        return json_response({"uploadUrl": upload_url, "key": key, "memeId": meme_id})
    except Exception as e:
        logger.exception("getMemePresignedUpload error: %s", e)
        return json_response({"error": str(e)}, 500)


def validate_image_url(event, json_response):
    """POST /memes/validate-url - Validate image URL (memes access)."""
    try:
        body = json.loads(event.get("body", "{}"))
        url = (body.get("url") or "").strip()
        ok, err = _validate_image_url(url)
        if ok:
            return json_response({"valid": True})
        return json_response({"valid": False, "error": err}, 400)
    except Exception as e:
        logger.exception("validateImageUrl error: %s", e)
        return json_response({"error": str(e)}, 500)


def import_meme_from_url(event, user, json_response):
    """POST /memes/import-from-url - Fetch image from URL, upload to S3, return key."""
    if not MEDIA_BUCKET:
        return json_response({"error": "MEDIA_BUCKET not configured"}, 500)
    try:
        import boto3
        import uuid as uuid_mod
        import re
        body = json.loads(event.get("body", "{}"))
        url = (body.get("url") or "").strip()
        ok, err = _validate_image_url(url)
        if not ok:
            return json_response({"valid": False, "error": err}, 400)
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (compatible; Funkedupshift/1.0)"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_SEC) as resp:
            data = resp.read()
        content_type = resp.headers.get("Content-Type", "image/png").split(";")[0].strip().lower()
        ext = "png"
        if "jpeg" in content_type or "jpg" in content_type:
            ext = "jpg"
        elif "gif" in content_type:
            ext = "gif"
        elif "webp" in content_type:
            ext = "webp"
        elif "bmp" in content_type:
            ext = "bmp"
        user_id = user.get("userId", "unknown")
        safe_user = re.sub(r"[^a-zA-Z0-9_-]", "_", user_id)[:64]
        meme_id = f"MEME#{uuid_mod.uuid4()}"
        key = f"memes/{safe_user}/{meme_id.replace('#', '_')}.{ext}"
        region = os.environ.get("AWS_REGION", "us-east-1")
        s3 = boto3.client("s3", region_name=region)
        s3.put_object(Bucket=MEDIA_BUCKET, Key=key, Body=data, ContentType=content_type)
        presigned_url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": MEDIA_BUCKET, "Key": key},
            ExpiresIn=3600,
        )
        return json_response({"key": key, "memeId": meme_id, "presignedUrl": presigned_url})
    except Exception as e:
        logger.exception("importMemeFromUrl error: %s", e)
        return json_response({"error": str(e)}, 500)


def generate_meme_title_handler(event, user, json_response):
    """POST /memes/generate-title - Generate meme title (memes access)."""
    title = generate_meme_title()
    return json_response({"title": title})


def set_meme_star(event, user, json_response):
    """POST /memes/stars - Set star rating (1-5) for meme (memes access)."""
    if not TABLE_NAME:
        return json_response({"error": "TABLE_NAME not set"}, 500)
    try:
        body = json.loads(event.get("body", "{}"))
        meme_id = (body.get("memeId") or body.get("id") or "").strip()
        rating = body.get("rating")
        if not meme_id:
            return json_response({"error": "memeId is required"}, 400)
        if not isinstance(rating, (int, float)) or rating < 1 or rating > 5:
            return json_response({"error": "rating must be 1-5"}, 400)
        rating = int(rating)
        user_id = user.get("userId", "")
        star_sk = f"STAR#{user_id}"
        import boto3
        region = os.environ.get("AWS_REGION", "us-east-1")
        dynamodb = boto3.client("dynamodb", region_name=region)
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": meme_id},
                "SK": {"S": star_sk},
                "rating": {"N": str(rating)},
                "entityType": {"S": "MEME"},
                "entitySk": {"S": meme_id},
            },
        )
        resp = dynamodb.query(
            TableName=TABLE_NAME,
            KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues={
                ":pk": {"S": meme_id},
                ":sk": {"S": "STAR#"},
            },
        )
        total_sum = 0
        total_count = 0
        for item in resp.get("Items", []):
            if "rating" in item:
                total_sum += int(item["rating"]["N"])
                total_count += 1
        avg = round(total_sum / total_count, 1) if total_count > 0 else 0
        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": meme_id}, "SK": {"S": "METADATA"}},
            UpdateExpression="SET totalStarsSum = :sum, totalStarsCount = :cnt",
            ExpressionAttributeValues={
                ":sum": {"N": str(total_sum)},
                ":cnt": {"N": str(total_count)},
            },
        )
        return json_response({"memeId": meme_id, "rating": rating, "averageRating": avg})
    except Exception as e:
        logger.exception("setMemeStar error: %s", e)
        return json_response({"error": str(e)}, 500)


def get_meme_user_rating(event, user, meme_id, dynamodb):
    """Get current user's star rating for meme."""
    user_id = user.get("userId", "")
    if not user_id:
        return None
    resp = dynamodb.get_item(
        TableName=TABLE_NAME,
        Key={"PK": {"S": meme_id}, "SK": {"S": f"STAR#{user_id}"}},
    )
    if "Item" in resp and "rating" in resp["Item"]:
        return int(resp["Item"]["rating"]["N"])
    return None
