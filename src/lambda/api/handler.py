"""
API Gateway HTTP API (payload 2.0) handler. Routes by path.
"""
import json
import logging
import os
import sys
from pathlib import Path

# Ensure common module is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from common.response import jsonResponse
except ImportError:
    # Fallback if import fails
    def jsonResponse(body, statusCode=200):
        return {
            "statusCode": statusCode,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
            "body": json.dumps(body) if not isinstance(body, str) else body,
        }

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ.get("TABLE_NAME", "")
MEDIA_BUCKET = os.environ.get("MEDIA_BUCKET", "")


def getUserInfo(event):
    """Extract user info from Cognito authorizer context."""
    authorizer = event.get("requestContext", {}).get("authorizer", {})
    jwt = authorizer.get("jwt", {})
    claims = jwt.get("claims", {})

    raw_groups = claims.get("cognito:groups")
    groups: list[str] = []

    if isinstance(raw_groups, list):
        groups = [str(g) for g in raw_groups]
    elif isinstance(raw_groups, str) and raw_groups:
        # Cognito sometimes returns groups as a JSON-ish string like "[admin]"
        try:
            parsed = json.loads(raw_groups)
            if isinstance(parsed, list):
                groups = [str(g) for g in parsed]
            else:
                groups = [str(parsed)]
        except Exception:
            # Fallback: split on commas and strip brackets/quotes/whitespace
            parts = raw_groups.split(",")
            for p in parts:
                g = p.strip().strip("[]\"'")
                if g:
                    groups.append(g)

    return {
        "userId": claims.get("sub", ""),
        "email": claims.get("email", ""),
        "groups": groups,
    }


def handler(event, context):
    """Route request by path; return JSON with CORS headers."""
    try:
        logger.info("event=%s", event)
        
        # Extract path and method from API Gateway HTTP API v2 event
        path = event.get("rawPath", "")
        if not path:
            request_context = event.get("requestContext", {})
            http_info = request_context.get("http", {})
            path = http_info.get("path", "")
        
        method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
        
        logger.info("path=%s, method=%s", path, method)

        if method == "GET" and path == "/health":
            return jsonResponse({"ok": True})
        if method == "GET" and path == "/sites":
            return listSites(event)
        if method == "GET" and path == "/sites/all":
            return listSites(event, forceAll=True)
        if method == "POST" and path == "/sites":
            return createSite(event)
        if method == "POST" and path == "/sites/logo-upload":
            return getPresignedLogoUpload(event)
        if method == "PUT" and path == "/sites":
            return updateSite(event)
        if method == "GET" and path == "/me":
            return getMe(event)
        if method == "POST" and path == "/stars":
            return setStar(event)
        if method == "GET" and path == "/categories":
            return listCategories(event)
        if method == "POST" and path == "/categories":
            return createCategory(event)
        if method == "PUT" and path == "/categories":
            return updateCategory(event)
        if method == "DELETE" and path == "/categories":
            return deleteCategory(event)
        if method == "GET" and path == "/media":
            return listMedia(event)
        if method == "GET" and path == "/media/all":
            return listMedia(event, forceAll=True)
        if method == "POST" and path == "/media":
            return createMedia(event)
        if method == "PUT" and path == "/media":
            return updateMedia(event)
        if method == "DELETE" and path == "/media":
            return deleteMedia(event)
        if method == "POST" and path == "/media/upload":
            return getPresignedMediaUpload(event)
        if method == "POST" and path == "/media/stars":
            return setMediaStar(event)
        if method == "GET" and path == "/media-categories":
            return listMediaCategories(event)
        if method == "POST" and path == "/media-categories":
            return createMediaCategory(event)
        if method == "PUT" and path == "/media-categories":
            return updateMediaCategory(event)
        if method == "DELETE" and path == "/media-categories":
            return deleteMediaCategory(event)
        if method == "OPTIONS":
            # CORS preflight
            return jsonResponse({}, 200)
        return jsonResponse({"error": "Not Found", "path": path, "method": method}, 404)
    except Exception as e:
        logger.exception("handler error: %s", str(e))
        import traceback
        logger.error("traceback: %s", traceback.format_exc())
        return jsonResponse({"error": str(e), "type": type(e).__name__}, 500)


def _resolveCategoriesForSites(dynamodb, sites):
    """Add categories list (id, name) to each site from categoryIds. Batch-get category items."""
    all_ids = set()
    for s in sites:
        for cid in s.get("categoryIds") or []:
            all_ids.add(cid)
    if not all_ids:
        for s in sites:
            s.setdefault("categories", [])
        return
    keys = [{"PK": {"S": cid}, "SK": {"S": "METADATA"}} for cid in all_ids]
    id_to_name = {}
    for i in range(0, len(keys), 100):
        batch = keys[i : i + 100]
        resp = dynamodb.batch_get_item(
            RequestItems={TABLE_NAME: {"Keys": batch}},
        )
        for item in resp.get("Responses", {}).get(TABLE_NAME, []):
            pk = item.get("PK", {}).get("S", "")
            name = item.get("name", {}).get("S", pk)
            id_to_name[pk] = name
    for s in sites:
        s["categories"] = [
            {"id": cid, "name": id_to_name.get(cid, cid)}
            for cid in (s.get("categoryIds") or [])
        ]


def _addLogoUrls(sites, region=None):
    """Set logoUrl (presigned GET) for each site that has logoKey. In-place."""
    if not MEDIA_BUCKET or not sites:
        return
    try:
        import boto3
        region = region or os.environ.get("AWS_REGION", "us-east-1")
        s3 = boto3.client("s3", region_name=region)
        for s in sites:
            key = s.get("logoKey")
            if key and isinstance(key, str) and key.strip():
                url = s3.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": MEDIA_BUCKET, "Key": key},
                    ExpiresIn=3600,
                )
                s["logoUrl"] = url
    except Exception as e:
        logger.warning("_addLogoUrls failed: %s", e)


def listSites(event, forceAll=False):
    """Query DynamoDB byEntity (entityType=SITE). Optional ?id= single site. Query constraints: limit (default 100), categoryIds (comma-separated). forceAll=True (GET /sites/all, JWT) = admin only, no limit."""
    logger.info("listSites called, TABLE_NAME=%s", TABLE_NAME)
    if not TABLE_NAME:
        logger.warning("TABLE_NAME not set")
        return jsonResponse({"sites": [], "error": "TABLE_NAME not set"}, 200)

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
                return jsonResponse({"error": "Site not found"}, 404)
            item = resp["Item"]
            site = {}
            for key, val in item.items():
                if "S" in val:
                    site[key] = val["S"]
                elif "N" in val:
                    num_str = val["N"]
                    site[key] = int(num_str) if "." not in num_str else float(num_str)
                elif "L" in val:
                    site[key] = [v.get("S", "") for v in val["L"]]
            total_sum = site.get("totalStarsSum")
            total_count = site.get("totalStarsCount")
            if isinstance(total_sum, (int, float)) and isinstance(total_count, (int, float)) and total_count > 0:
                avg = max(1.0, min(5.0, float(total_sum) / float(total_count)))
                site["averageRating"] = round(avg, 1)
            _resolveCategoriesForSites(dynamodb, [site])
            _addLogoUrls([site], region=region)
            return jsonResponse({"site": site})

        # Limit: forceAll (GET /sites/all with JWT) = admin only, no limit; else limit 100
        if forceAll:
            user = getUserInfo(event)
            if not user.get("userId"):
                return jsonResponse({"error": "Unauthorized"}, 401)
            if "admin" not in user.get("groups", []):
                return jsonResponse({"error": "Forbidden: admin required for full list"}, 403)
            use_no_limit = True
        else:
            use_no_limit = False
        try:
            limit_param = int((qs.get("limit") or "").strip() or 100)
        except ValueError:
            limit_param = 100
        limit_param = max(1, min(limit_param, 10000))
        category_ids_param = (qs.get("categoryIds") or "").strip()
        filter_category_ids = [x.strip() for x in category_ids_param.split(",") if x.strip()]

        page_limit = None if use_no_limit else limit_param
        items = []
        request_kw = {
            "TableName": TABLE_NAME,
            "IndexName": "byEntity",
            "KeyConditionExpression": "entityType = :et",
            "ExpressionAttributeValues": {":et": {"S": "SITE"}},
        }
        if page_limit is not None:
            request_kw["Limit"] = page_limit
        result = dynamodb.query(**request_kw)
        items.extend(result.get("Items", []))
        while use_no_limit and result.get("LastEvaluatedKey"):
            request_kw["ExclusiveStartKey"] = result["LastEvaluatedKey"]
            result = dynamodb.query(**request_kw)
            items.extend(result.get("Items", []))

        sites = []
        for item in items:
            site = {}
            for key, val in item.items():
                if "S" in val:
                    site[key] = val["S"]
                elif "N" in val:
                    num_str = val["N"]
                    site[key] = int(num_str) if "." not in num_str else float(num_str)
                elif "L" in val:
                    site[key] = [v.get("S", "") for v in val["L"]]

            total_sum = site.get("totalStarsSum")
            total_count = site.get("totalStarsCount")
            if isinstance(total_sum, (int, float)) and isinstance(total_count, (int, float)) and total_count > 0:
                avg = float(total_sum) / float(total_count)
                if avg < 1.0:
                    avg = 1.0
                if avg > 5.0:
                    avg = 5.0
                site["averageRating"] = round(avg, 1)

            sites.append(site)

        _resolveCategoriesForSites(dynamodb, sites)
        if filter_category_ids:
            sites = [s for s in sites if any(cid in (s.get("categoryIds") or []) for cid in filter_category_ids)]
        search_q = (qs.get("q") or qs.get("search") or "").strip()
        if search_q:
            q_lower = search_q.lower()
            sites = [
                s for s in sites
                if q_lower in (s.get("title") or "").lower()
                or q_lower in (s.get("url") or "").lower()
                or q_lower in (s.get("description") or "").lower()
            ]
        _addLogoUrls(sites, region=region)
        sites.sort(key=lambda s: (
            -(s.get("averageRating") or 0),
            (s.get("title") or s.get("url") or s.get("PK") or "").lower(),
        ))
        logger.info("Found %d items", len(sites))
        return jsonResponse({"sites": sites})
    except Exception as e:
        logger.error("listSites exception: %s", str(e), exc_info=True)
        import traceback
        error_detail = traceback.format_exc()
        logger.error("Full traceback:\n%s", error_detail)
        return jsonResponse({
            "error": str(e),
            "errorType": type(e).__name__,
            "sites": []
        }, 500)


def createSite(event):
    """Create a new site (admin only)."""
    user = getUserInfo(event)
    if not user.get("userId"):
        return jsonResponse({"error": "Unauthorized"}, 401)
    if "admin" not in user.get("groups", []):
        return jsonResponse({"error": "Forbidden: admin role required"}, 403)

    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)

    try:
        import boto3
        import json
        import uuid
        from datetime import datetime

        body = json.loads(event.get("body", "{}"))
        url = body.get("url", "").strip()
        title = body.get("title", "").strip()

        if not url:
            return jsonResponse({"error": "url is required"}, 400)

        site_id = f"SITE#{uuid.uuid4()}"
        now = datetime.utcnow().isoformat() + "Z"
        logo_key = (body.get("logoKey") or "").strip() or None

        dynamodb = boto3.client("dynamodb")

        tags_list = [{"S": str(tag)} for tag in (body.get("tags", []) or [])]
        category_ids = [str(c) for c in (body.get("categoryIds") or []) if c]
        category_ids_list = [{"S": cid} for cid in category_ids]

        item = {
            "PK": {"S": site_id},
            "SK": {"S": "METADATA"},
            "url": {"S": url},
            "title": {"S": title or url},
            "description": {"S": body.get("description", "")},
            "tags": {"L": tags_list},
            "categoryIds": {"L": category_ids_list},
            "createdAt": {"S": now},
            "updatedAt": {"S": now},
            "entityType": {"S": "SITE"},
            "entitySk": {"S": site_id},
            "totalStarsSum": {"N": "0"},
            "totalStarsCount": {"N": "0"},
        }
        if logo_key:
            item["logoKey"] = {"S": logo_key}
        dynamodb.put_item(TableName=TABLE_NAME, Item=item)

        return jsonResponse({"id": site_id, "url": url, "title": title or url}, 201)
    except Exception as e:
        logger.exception("createSite error")
        return jsonResponse({"error": str(e)}, 500)


def updateSite(event):
    """Update an existing site (admin only)."""
    user = getUserInfo(event)
    if not user.get("userId"):
        return jsonResponse({"error": "Unauthorized"}, 401)
    if "admin" not in user.get("groups", []):
        return jsonResponse({"error": "Forbidden: admin role required"}, 403)

    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)

    try:
        import boto3
        import json
        from datetime import datetime

        body = json.loads(event.get("body", "{}"))
        site_id = body.get("id", "").strip()
        if not site_id:
            return jsonResponse({"error": "id is required"}, 400)

        title = body.get("title")
        description = body.get("description")
        category_ids = body.get("categoryIds")
        delete_logo = body.get("deleteLogo") is True
        logo_key = (body.get("logoKey") or "").strip() or None
        now = datetime.utcnow().isoformat() + "Z"

        dynamodb = boto3.client("dynamodb")
        region = os.environ.get("AWS_REGION", "us-east-1")
        current_logo_key = None
        if delete_logo or logo_key:
            get_resp = dynamodb.get_item(
                TableName=TABLE_NAME,
                Key={"PK": {"S": site_id}, "SK": {"S": "METADATA"}},
                ProjectionExpression="logoKey",
            )
            if "Item" in get_resp and "logoKey" in get_resp["Item"]:
                current_logo_key = get_resp["Item"]["logoKey"].get("S", "").strip() or None

        if MEDIA_BUCKET and current_logo_key and (delete_logo or logo_key):
            try:
                s3 = boto3.client("s3", region_name=region)
                s3.delete_object(Bucket=MEDIA_BUCKET, Key=current_logo_key)
            except Exception as e:
                logger.warning("S3 delete_object for logo failed: %s", e)

        set_parts = []
        remove_parts = []
        names = {}
        values = {":updatedAt": {"S": now}}

        if title is not None:
            set_parts.append("#title = :title")
            names["#title"] = "title"
            values[":title"] = {"S": title}
        if description is not None:
            set_parts.append("#description = :description")
            names["#description"] = "description"
            values[":description"] = {"S": description}
        if category_ids is not None:
            set_parts.append("categoryIds = :categoryIds")
            values[":categoryIds"] = {"L": [{"S": str(c)} for c in category_ids]}
        set_parts.append("updatedAt = :updatedAt")

        if delete_logo:
            remove_parts.append("logoKey")
        elif logo_key:
            set_parts.append("logoKey = :logoKey")
            values[":logoKey"] = {"S": logo_key}

        if not set_parts and not remove_parts:
            return jsonResponse({"error": "Nothing to update"}, 400)

        update_expr = ""
        if set_parts:
            update_expr += "SET " + ", ".join(set_parts)
        if remove_parts:
            update_expr += " REMOVE " + ", ".join(remove_parts)

        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": site_id}, "SK": {"S": "METADATA"}},
            UpdateExpression=update_expr.strip(),
            ExpressionAttributeNames=names if names else None,
            ExpressionAttributeValues=values,
        )

        return jsonResponse({"id": site_id, "title": title, "description": description, "categoryIds": category_ids}, 200)
    except Exception as e:
        logger.exception("updateSite error")
        return jsonResponse({"error": str(e)}, 500)


def getPresignedLogoUpload(event):
    """Return presigned PUT URL for uploading a site logo (admin only)."""
    user = getUserInfo(event)
    if not user.get("userId"):
        return jsonResponse({"error": "Unauthorized"}, 401)
    if "admin" not in user.get("groups", []):
        return jsonResponse({"error": "Forbidden: admin role required"}, 403)
    if not MEDIA_BUCKET:
        return jsonResponse({"error": "MEDIA_BUCKET not configured"}, 500)
    try:
        import boto3
        import uuid as uuid_mod
        body = json.loads(event.get("body", "{}"))
        site_id = (body.get("siteId") or body.get("id") or "").strip() or "new"
        contentType = (body.get("contentType") or "image/png").strip()
        ext = "png"
        if "jpeg" in contentType or "jpg" in contentType:
            ext = "jpg"
        elif "gif" in contentType:
            ext = "gif"
        elif "webp" in contentType:
            ext = "webp"
        unique = str(uuid_mod.uuid4())
        key = f"logos/{site_id}/{unique}.{ext}"
        region = os.environ.get("AWS_REGION", "us-east-1")
        s3 = boto3.client("s3", region_name=region)
        upload_url = s3.generate_presigned_url(
            "put_object",
            Params={"Bucket": MEDIA_BUCKET, "Key": key, "ContentType": contentType},
            ExpiresIn=300,
        )
        return jsonResponse({"uploadUrl": upload_url, "key": key})
    except Exception as e:
        logger.exception("getPresignedLogoUpload error")
        return jsonResponse({"error": str(e)}, 500)


def getMe(event):
    """Return current user info (requires auth)."""
    user = getUserInfo(event)
    if not user.get("userId"):
        return jsonResponse({"error": "Unauthorized"}, 401)
    return jsonResponse(user)


def setStar(event):
    """Set a 1-5 star rating for a site for the current user."""
    user = getUserInfo(event)
    user_id = user.get("userId")
    if not user_id:
        return jsonResponse({"error": "Unauthorized"}, 401)

    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)

    try:
        import boto3
        import json
        from datetime import datetime

        body = json.loads(event.get("body", "{}"))
        site_id = body.get("siteId", "").strip()
        rating = body.get("rating")

        if not site_id:
            return jsonResponse({"error": "siteId is required"}, 400)

        try:
            rating_int = int(rating)
        except Exception:
            return jsonResponse({"error": "rating must be an integer between 1 and 5"}, 400)

        if rating_int < 1 or rating_int > 5:
            return jsonResponse({"error": "rating must be between 1 and 5"}, 400)

        now = datetime.utcnow().isoformat() + "Z"

        dynamodb = boto3.client("dynamodb")

        # Fetch existing rating for this user/site, if any
        existing = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": site_id}, "SK": {"S": f"STAR#{user_id}"}},
        )
        old_rating = None
        if "Item" in existing and "rating" in existing["Item"]:
            try:
                old_rating = int(existing["Item"]["rating"]["N"])
            except Exception:
                old_rating = None

        # Ensure site METADATA exists
        site = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": site_id}, "SK": {"S": "METADATA"}},
        )
        if "Item" not in site:
            return jsonResponse({"error": "Site not found"}, 404)

        site_item = site.get("Item", {})
        has_count = "totalStarsCount" in site_item
        current_count = None
        if has_count:
            try:
                current_count = int(site_item["totalStarsCount"]["N"])
            except Exception:
                current_count = None

        # Compute deltas for aggregates
        if old_rating is None:
            sum_delta = rating_int
            # First rating for this user; always increment count
            count_delta = 1
        else:
            sum_delta = rating_int - old_rating
            # If count is missing or still zero on the site (legacy data), bump it to 1
            if (not has_count) or (current_count is None) or (current_count == 0):
                count_delta = 1
            else:
                count_delta = 0

        # Update aggregate fields on METADATA item (handle legacy items with no attributes yet)
        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": site_id}, "SK": {"S": "METADATA"}},
            UpdateExpression=(
                "SET totalStarsSum = if_not_exists(totalStarsSum, :zero) + :sumDelta, "
                "totalStarsCount = if_not_exists(totalStarsCount, :zero) + :countDelta, "
                "updatedAt = :updatedAt"
            ),
            ExpressionAttributeValues={
                ":sumDelta": {"N": str(sum_delta)},
                ":countDelta": {"N": str(count_delta)},
                ":zero": {"N": "0"},
                ":updatedAt": {"S": now},
            },
        )

        # Upsert the individual star record
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": site_id},
                "SK": {"S": f"STAR#{user_id}"},
                "rating": {"N": str(rating_int)},
                "userId": {"S": user_id},
                "entityType": {"S": "SITE_STAR"},
                "entitySk": {"S": user_id},
                "updatedAt": {"S": now},
            },
        )

        return jsonResponse({"siteId": site_id, "rating": rating_int}, 200)
    except Exception as e:
        logger.exception("setStar error")
        return jsonResponse({"error": str(e)}, 500)


def _requireAdmin(event):
    """Return (user, None) if admin, else (None, error_response)."""
    user = getUserInfo(event)
    if not user.get("userId"):
        return None, jsonResponse({"error": "Unauthorized"}, 401)
    if "admin" not in user.get("groups", []):
        return None, jsonResponse({"error": "Forbidden: admin role required"}, 403)
    return user, None


def _dynamoItemToDict(item):
    """Convert DynamoDB item format to plain dict."""
    out = {}
    for key, val in item.items():
        if "S" in val:
            out[key] = val["S"]
        elif "N" in val:
            num_str = val["N"]
            out[key] = int(num_str) if "." not in num_str else float(num_str)
        elif "L" in val:
            out[key] = [v.get("S", "") for v in val["L"]]
    return out


def listCategories(event):
    """List all categories (admin only)."""
    _, err = _requireAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"categories": [], "error": "TABLE_NAME not set"}, 200)
    try:
        import boto3
        dynamodb = boto3.client("dynamodb")
        result = dynamodb.query(
            TableName=TABLE_NAME,
            IndexName="byEntity",
            KeyConditionExpression="entityType = :et",
            ExpressionAttributeValues={":et": {"S": "CATEGORY"}},
        )
        items = result.get("Items", [])
        categories = [_dynamoItemToDict(i) for i in items]
        categories.sort(key=lambda c: (c.get("name") or c.get("PK") or "").lower())
        return jsonResponse({"categories": categories})
    except Exception as e:
        logger.exception("listCategories error")
        return jsonResponse({"error": str(e)}, 500)


def createCategory(event):
    """Create a category (admin only)."""
    _, err = _requireAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        import uuid
        from datetime import datetime
        body = json.loads(event.get("body", "{}"))
        name = (body.get("name") or "").strip()
        if not name:
            return jsonResponse({"error": "name is required"}, 400)
        cat_id = f"CATEGORY#{uuid.uuid4()}"
        now = datetime.utcnow().isoformat() + "Z"
        dynamodb = boto3.client("dynamodb")
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": cat_id},
                "SK": {"S": "METADATA"},
                "name": {"S": name},
                "description": {"S": body.get("description", "")},
                "entityType": {"S": "CATEGORY"},
                "entitySk": {"S": cat_id},
                "createdAt": {"S": now},
                "updatedAt": {"S": now},
            },
        )
        return jsonResponse({"id": cat_id, "name": name}, 201)
    except Exception as e:
        logger.exception("createCategory error")
        return jsonResponse({"error": str(e)}, 500)


def updateCategory(event):
    """Update a category (admin only)."""
    _, err = _requireAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        from datetime import datetime
        body = json.loads(event.get("body", "{}"))
        cat_id = (body.get("id") or "").strip()
        if not cat_id:
            return jsonResponse({"error": "id is required"}, 400)
        name = body.get("name")
        description = body.get("description")
        now = datetime.utcnow().isoformat() + "Z"
        update_expr = ["updatedAt = :updatedAt"]
        names = {}
        values = {":updatedAt": {"S": now}}
        if name is not None:
            update_expr.append("#name = :name")
            names["#name"] = "name"
            values[":name"] = {"S": str(name)}
        if description is not None:
            update_expr.append("#description = :description")
            names["#description"] = "description"
            values[":description"] = {"S": str(description)}
        dynamodb = boto3.client("dynamodb")
        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": cat_id}, "SK": {"S": "METADATA"}},
            UpdateExpression="SET " + ", ".join(update_expr),
            ExpressionAttributeNames=names or None,
            ExpressionAttributeValues=values,
        )
        return jsonResponse({"id": cat_id, "name": name, "description": description}, 200)
    except Exception as e:
        logger.exception("updateCategory error")
        return jsonResponse({"error": str(e)}, 500)


def deleteCategory(event):
    """Delete a category (admin only)."""
    _, err = _requireAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        # DELETE /categories?id=CATEGORY#uuid (query string) or body {"id": "..."}
        body = event.get("body")
        if body and isinstance(body, str):
            try:
                body = json.loads(body)
            except Exception:
                body = {}
        elif not body:
            body = {}
        qs = event.get("queryStringParameters") or {}
        cat_id = (body.get("id") or qs.get("id") or "").strip()
        if not cat_id:
            return jsonResponse({"error": "id is required"}, 400)
        dynamodb = boto3.client("dynamodb")
        dynamodb.delete_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": cat_id}, "SK": {"S": "METADATA"}},
        )
        return jsonResponse({"id": cat_id, "deleted": True}, 200)
    except Exception as e:
        logger.exception("deleteCategory error")
        return jsonResponse({"error": str(e)}, 500)


# ------------------------------------------------------------------------------
# Media section (images and videos)
# ------------------------------------------------------------------------------

def _resolveCategoriesForMedia(dynamodb, media_list):
    """Add categories list (id, name) to each media item from categoryIds."""
    all_ids = set()
    for m in media_list:
        for cid in m.get("categoryIds") or []:
            all_ids.add(cid)
    if not all_ids:
        for m in media_list:
            m.setdefault("categories", [])
        return
    keys = [{"PK": {"S": cid}, "SK": {"S": "METADATA"}} for cid in all_ids]
    id_to_name = {}
    for i in range(0, len(keys), 100):
        batch = keys[i : i + 100]
        resp = dynamodb.batch_get_item(RequestItems={TABLE_NAME: {"Keys": batch}})
        for item in resp.get("Responses", {}).get(TABLE_NAME, []):
            pk = item.get("PK", {}).get("S", "")
            name = item.get("name", {}).get("S", pk)
            id_to_name[pk] = name
    for m in media_list:
        m["categories"] = [
            {"id": cid, "name": id_to_name.get(cid, cid)}
            for cid in (m.get("categoryIds") or [])
        ]


def _addMediaUrls(media_list, region=None):
    """Set mediaUrl and thumbnailUrl (presigned GET) for each media item."""
    if not MEDIA_BUCKET or not media_list:
        return
    try:
        import boto3
        region = region or os.environ.get("AWS_REGION", "us-east-1")
        s3 = boto3.client("s3", region_name=region)
        for m in media_list:
            for key_attr, url_attr in [("mediaKey", "mediaUrl"), ("thumbnailKey", "thumbnailUrl")]:
                key = m.get(key_attr)
                if key and isinstance(key, str) and key.strip():
                    url = s3.generate_presigned_url(
                        "get_object",
                        Params={"Bucket": MEDIA_BUCKET, "Key": key},
                        ExpiresIn=3600,
                    )
                    m[url_attr] = url
            if not m.get("thumbnailUrl") and m.get("mediaUrl") and m.get("mediaType") == "image":
                m["thumbnailUrl"] = m["mediaUrl"]
    except Exception as e:
        logger.warning("_addMediaUrls failed: %s", e)


def _dynamoItemToMedia(item):
    """Convert DynamoDB item to media dict."""
    out = {}
    for key, val in item.items():
        if "S" in val:
            out[key] = val["S"]
        elif "N" in val:
            num_str = val["N"]
            out[key] = int(num_str) if "." not in num_str else float(num_str)
        elif "L" in val:
            out[key] = [v.get("S", "") for v in val["L"]]
    total_sum = out.get("totalStarsSum")
    total_count = out.get("totalStarsCount")
    if isinstance(total_sum, (int, float)) and isinstance(total_count, (int, float)) and total_count > 0:
        avg = max(1.0, min(5.0, float(total_sum) / float(total_count)))
        out["averageRating"] = round(avg, 1)
    return out


def listMedia(event, forceAll=False):
    """List media (public), optional ?id= single, ?q= search, ?categoryIds= filter, ?limit= 100."""
    if not TABLE_NAME:
        return jsonResponse({"media": [], "error": "TABLE_NAME not set"}, 200)
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
                return jsonResponse({"error": "Media not found"}, 404)
            m = _dynamoItemToMedia(resp["Item"])
            _resolveCategoriesForMedia(dynamodb, [m])
            _addMediaUrls([m], region=region)
            return jsonResponse({"media": m})

        if forceAll:
            user = getUserInfo(event)
            if not user.get("userId"):
                return jsonResponse({"error": "Unauthorized"}, 401)
            if "admin" not in user.get("groups", []):
                return jsonResponse({"error": "Forbidden: admin required for full list"}, 403)
            use_no_limit = True
        else:
            use_no_limit = False
        try:
            limit_param = int((qs.get("limit") or "").strip() or 100)
        except ValueError:
            limit_param = 100
        limit_param = max(1, min(limit_param, 10000))
        category_ids_param = (qs.get("categoryIds") or "").strip()
        filter_category_ids = [x.strip() for x in category_ids_param.split(",") if x.strip()]

        page_limit = None if use_no_limit else limit_param
        items = []
        request_kw = {
            "TableName": TABLE_NAME,
            "IndexName": "byEntity",
            "KeyConditionExpression": "entityType = :et",
            "ExpressionAttributeValues": {":et": {"S": "MEDIA"}},
        }
        if page_limit is not None:
            request_kw["Limit"] = page_limit
        result = dynamodb.query(**request_kw)
        items.extend(result.get("Items", []))
        while use_no_limit and result.get("LastEvaluatedKey"):
            request_kw["ExclusiveStartKey"] = result["LastEvaluatedKey"]
            result = dynamodb.query(**request_kw)
            items.extend(result.get("Items", []))

        media_list = [_dynamoItemToMedia(i) for i in items]
        _resolveCategoriesForMedia(dynamodb, media_list)
        if filter_category_ids:
            media_list = [
                m for m in media_list
                if any(cid in (m.get("categoryIds") or []) for cid in filter_category_ids)
            ]
        search_q = (qs.get("q") or qs.get("search") or "").strip()
        if search_q:
            q_lower = search_q.lower()
            media_list = [
                m for m in media_list
                if q_lower in (m.get("title") or "").lower()
                or q_lower in (m.get("description") or "").lower()
            ]
        _addMediaUrls(media_list, region=region)
        media_list.sort(key=lambda m: (
            -(m.get("averageRating") or 0),
            (m.get("title") or m.get("PK") or "").lower(),
        ))
        return jsonResponse({"media": media_list})
    except Exception as e:
        logger.exception("listMedia error: %s", e)
        return jsonResponse({"error": str(e), "media": []}, 500)


def createMedia(event):
    """Create media item (admin only)."""
    _, err = _requireAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        import uuid
        from datetime import datetime
        body = json.loads(event.get("body", "{}"))
        title = (body.get("title") or "").strip()
        media_type = (body.get("mediaType") or "image").strip().lower()
        if media_type not in ("image", "video"):
            media_type = "image"
        media_key = (body.get("mediaKey") or "").strip()
        if not media_key:
            return jsonResponse({"error": "mediaKey is required"}, 400)
        media_id = (body.get("id") or "").strip()
        if not media_id or not media_id.startswith("MEDIA#"):
            media_id = f"MEDIA#{uuid.uuid4()}"
        now = datetime.utcnow().isoformat() + "Z"
        category_ids = [str(c) for c in (body.get("categoryIds") or []) if c]
        category_ids_list = [{"S": cid} for cid in category_ids]
        item = {
            "PK": {"S": media_id},
            "SK": {"S": "METADATA"},
            "title": {"S": title or "Untitled"},
            "description": {"S": body.get("description", "")},
            "mediaType": {"S": media_type},
            "mediaKey": {"S": media_key},
            "categoryIds": {"L": category_ids_list},
            "createdAt": {"S": now},
            "updatedAt": {"S": now},
            "entityType": {"S": "MEDIA"},
            "entitySk": {"S": media_id},
            "totalStarsSum": {"N": "0"},
            "totalStarsCount": {"N": "0"},
        }
        dynamodb = boto3.client("dynamodb")
        dynamodb.put_item(TableName=TABLE_NAME, Item=item)
        return jsonResponse({"id": media_id, "title": title or "Untitled", "mediaType": media_type}, 201)
    except Exception as e:
        logger.exception("createMedia error")
        return jsonResponse({"error": str(e)}, 500)


def updateMedia(event):
    """Update media item (admin only)."""
    _, err = _requireAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        from datetime import datetime
        body = json.loads(event.get("body", "{}"))
        media_id = (body.get("id") or "").strip()
        if not media_id:
            return jsonResponse({"error": "id is required"}, 400)
        title = body.get("title")
        description = body.get("description")
        category_ids = body.get("categoryIds")
        media_key = (body.get("mediaKey") or "").strip() or None
        now = datetime.utcnow().isoformat() + "Z"
        dynamodb = boto3.client("dynamodb")
        set_parts = ["updatedAt = :updatedAt"]
        names = {}
        values = {":updatedAt": {"S": now}}
        if title is not None:
            set_parts.append("#title = :title")
            names["#title"] = "title"
            values[":title"] = {"S": str(title)}
        if description is not None:
            set_parts.append("#description = :description")
            names["#description"] = "description"
            values[":description"] = {"S": str(description)}
        if category_ids is not None:
            set_parts.append("categoryIds = :categoryIds")
            values[":categoryIds"] = {"L": [{"S": str(c)} for c in category_ids]}
        if media_key is not None:
            set_parts.append("mediaKey = :mediaKey")
            values[":mediaKey"] = {"S": media_key}
        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": media_id}, "SK": {"S": "METADATA"}},
            UpdateExpression="SET " + ", ".join(set_parts),
            ExpressionAttributeNames=names or None,
            ExpressionAttributeValues=values,
        )
        return jsonResponse({"id": media_id, "title": title, "description": description, "categoryIds": category_ids}, 200)
    except Exception as e:
        logger.exception("updateMedia error")
        return jsonResponse({"error": str(e)}, 500)


def deleteMedia(event):
    """Delete media item (admin only)."""
    _, err = _requireAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        body = event.get("body")
        if body and isinstance(body, str):
            try:
                body = json.loads(body)
            except Exception:
                body = {}
        else:
            body = {}
        qs = event.get("queryStringParameters") or {}
        media_id = (body.get("id") or qs.get("id") or "").strip()
        if not media_id:
            return jsonResponse({"error": "id is required"}, 400)
        dynamodb = boto3.client("dynamodb")
        get_resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": media_id}, "SK": {"S": "METADATA"}},
            ProjectionExpression="mediaKey, thumbnailKey",
        )
        if "Item" in get_resp:
            for key_attr in ("mediaKey", "thumbnailKey"):
                key = get_resp["Item"].get(key_attr, {}).get("S", "").strip()
                if key and MEDIA_BUCKET:
                    try:
                        s3 = boto3.client("s3")
                        s3.delete_object(Bucket=MEDIA_BUCKET, Key=key)
                    except Exception as e:
                        logger.warning("S3 delete failed for %s: %s", key, e)
        dynamodb.delete_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": media_id}, "SK": {"S": "METADATA"}},
        )
        return jsonResponse({"id": media_id, "deleted": True}, 200)
    except Exception as e:
        logger.exception("deleteMedia error")
        return jsonResponse({"error": str(e)}, 500)


def getPresignedMediaUpload(event):
    """Return presigned PUT URL for media upload (admin only)."""
    _, err = _requireAdmin(event)
    if err:
        return err
    if not MEDIA_BUCKET:
        return jsonResponse({"error": "MEDIA_BUCKET not configured"}, 500)
    try:
        import boto3
        import uuid as uuid_mod
        body = json.loads(event.get("body", "{}"))
        media_id = (body.get("mediaId") or body.get("id") or "").strip()
        if not media_id:
            return jsonResponse({"error": "mediaId is required (generate client-side: MEDIA#uuid)"}, 400)
        media_type = (body.get("mediaType") or "image").strip().lower()
        if media_type not in ("image", "video"):
            media_type = "image"
        contentType = (body.get("contentType") or "image/png").strip()
        ext = "png"
        if "jpeg" in contentType or "jpg" in contentType:
            ext = "jpg"
        elif "gif" in contentType:
            ext = "gif"
        elif "webp" in contentType:
            ext = "webp"
        elif "mp4" in contentType:
            ext = "mp4"
        elif "webm" in contentType:
            ext = "webm"
        unique = str(uuid_mod.uuid4())
        folder = "images" if media_type == "image" else "videos"
        key = f"media/{folder}/{media_id}/{unique}.{ext}"
        region = os.environ.get("AWS_REGION", "us-east-1")
        s3 = boto3.client("s3", region_name=region)
        upload_url = s3.generate_presigned_url(
            "put_object",
            Params={"Bucket": MEDIA_BUCKET, "Key": key, "ContentType": contentType},
            ExpiresIn=300,
        )
        return jsonResponse({"uploadUrl": upload_url, "key": key})
    except Exception as e:
        logger.exception("getPresignedMediaUpload error")
        return jsonResponse({"error": str(e)}, 500)


def setMediaStar(event):
    """Set 1-5 star rating for media (auth required)."""
    user = getUserInfo(event)
    user_id = user.get("userId")
    if not user_id:
        return jsonResponse({"error": "Unauthorized"}, 401)
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        from datetime import datetime
        body = json.loads(event.get("body", "{}"))
        media_id = body.get("mediaId", "").strip()
        rating = body.get("rating")
        if not media_id:
            return jsonResponse({"error": "mediaId is required"}, 400)
        try:
            rating_int = int(rating)
        except Exception:
            return jsonResponse({"error": "rating must be an integer between 1 and 5"}, 400)
        if rating_int < 1 or rating_int > 5:
            return jsonResponse({"error": "rating must be between 1 and 5"}, 400)
        now = datetime.utcnow().isoformat() + "Z"
        dynamodb = boto3.client("dynamodb")
        existing = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": media_id}, "SK": {"S": f"STAR#{user_id}"}},
        )
        old_rating = None
        if "Item" in existing and "rating" in existing["Item"]:
            try:
                old_rating = int(existing["Item"]["rating"]["N"])
            except Exception:
                old_rating = None
        site = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": media_id}, "SK": {"S": "METADATA"}},
        )
        if "Item" not in site:
            return jsonResponse({"error": "Media not found"}, 404)
        site_item = site.get("Item", {})
        has_count = "totalStarsCount" in site_item
        current_count = int(site_item["totalStarsCount"]["N"]) if has_count else None
        if old_rating is None:
            sum_delta = rating_int
            count_delta = 1
        else:
            sum_delta = rating_int - old_rating
            count_delta = 0 if (has_count and current_count and current_count > 0) else 1
        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": media_id}, "SK": {"S": "METADATA"}},
            UpdateExpression=(
                "SET totalStarsSum = if_not_exists(totalStarsSum, :zero) + :sumDelta, "
                "totalStarsCount = if_not_exists(totalStarsCount, :zero) + :countDelta, "
                "updatedAt = :updatedAt"
            ),
            ExpressionAttributeValues={
                ":sumDelta": {"N": str(sum_delta)},
                ":countDelta": {"N": str(count_delta)},
                ":zero": {"N": "0"},
                ":updatedAt": {"S": now},
            },
        )
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": media_id},
                "SK": {"S": f"STAR#{user_id}"},
                "rating": {"N": str(rating_int)},
                "userId": {"S": user_id},
                "entityType": {"S": "MEDIA_STAR"},
                "entitySk": {"S": user_id},
                "updatedAt": {"S": now},
            },
        )
        return jsonResponse({"mediaId": media_id, "rating": rating_int}, 200)
    except Exception as e:
        logger.exception("setMediaStar error")
        return jsonResponse({"error": str(e)}, 500)


def listMediaCategories(event):
    """List media categories (admin only)."""
    _, err = _requireAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"categories": [], "error": "TABLE_NAME not set"}, 200)
    try:
        import boto3
        dynamodb = boto3.client("dynamodb")
        result = dynamodb.query(
            TableName=TABLE_NAME,
            IndexName="byEntity",
            KeyConditionExpression="entityType = :et",
            ExpressionAttributeValues={":et": {"S": "MEDIA_CATEGORY"}},
        )
        items = result.get("Items", [])
        categories = [_dynamoItemToDict(i) for i in items]
        categories.sort(key=lambda c: (c.get("name") or c.get("PK") or "").lower())
        return jsonResponse({"categories": categories})
    except Exception as e:
        logger.exception("listMediaCategories error")
        return jsonResponse({"error": str(e)}, 500)


def createMediaCategory(event):
    """Create media category (admin only)."""
    _, err = _requireAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        import uuid
        from datetime import datetime
        body = json.loads(event.get("body", "{}"))
        name = (body.get("name") or "").strip()
        if not name:
            return jsonResponse({"error": "name is required"}, 400)
        cat_id = f"MEDIA_CATEGORY#{uuid.uuid4()}"
        now = datetime.utcnow().isoformat() + "Z"
        dynamodb = boto3.client("dynamodb")
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": cat_id},
                "SK": {"S": "METADATA"},
                "name": {"S": name},
                "description": {"S": body.get("description", "")},
                "entityType": {"S": "MEDIA_CATEGORY"},
                "entitySk": {"S": cat_id},
                "createdAt": {"S": now},
                "updatedAt": {"S": now},
            },
        )
        return jsonResponse({"id": cat_id, "name": name}, 201)
    except Exception as e:
        logger.exception("createMediaCategory error")
        return jsonResponse({"error": str(e)}, 500)


def updateMediaCategory(event):
    """Update media category (admin only)."""
    _, err = _requireAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        from datetime import datetime
        body = json.loads(event.get("body", "{}"))
        cat_id = (body.get("id") or "").strip()
        if not cat_id:
            return jsonResponse({"error": "id is required"}, 400)
        name = body.get("name")
        description = body.get("description")
        now = datetime.utcnow().isoformat() + "Z"
        update_expr = ["updatedAt = :updatedAt"]
        names = {}
        values = {":updatedAt": {"S": now}}
        if name is not None:
            update_expr.append("#name = :name")
            names["#name"] = "name"
            values[":name"] = {"S": str(name)}
        if description is not None:
            update_expr.append("#description = :description")
            names["#description"] = "description"
            values[":description"] = {"S": str(description)}
        dynamodb = boto3.client("dynamodb")
        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": cat_id}, "SK": {"S": "METADATA"}},
            UpdateExpression="SET " + ", ".join(update_expr),
            ExpressionAttributeNames=names or None,
            ExpressionAttributeValues=values,
        )
        return jsonResponse({"id": cat_id, "name": name, "description": description}, 200)
    except Exception as e:
        logger.exception("updateMediaCategory error")
        return jsonResponse({"error": str(e)}, 500)


def deleteMediaCategory(event):
    """Delete media category (admin only)."""
    _, err = _requireAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        body = event.get("body")
        if body and isinstance(body, str):
            try:
                body = json.loads(body)
            except Exception:
                body = {}
        else:
            body = {}
        qs = event.get("queryStringParameters") or {}
        cat_id = (body.get("id") or qs.get("id") or "").strip()
        if not cat_id:
            return jsonResponse({"error": "id is required"}, 400)
        dynamodb = boto3.client("dynamodb")
        dynamodb.delete_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": cat_id}, "SK": {"S": "METADATA"}},
        )
        return jsonResponse({"id": cat_id, "deleted": True}, 200)
    except Exception as e:
        logger.exception("deleteMediaCategory error")
        return jsonResponse({"error": str(e)}, 500)
