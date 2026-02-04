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
        if method == "POST" and path == "/sites":
            return createSite(event)
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


def listSites(event):
    """Query DynamoDB byEntity (entityType=SITE) and return items. Optional ?id= for single site."""
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
            return jsonResponse({"site": site})

        result = dynamodb.query(
            TableName=TABLE_NAME,
            IndexName="byEntity",
            KeyConditionExpression="entityType = :et",
            ExpressionAttributeValues={":et": {"S": "SITE"}},
        )
        items = result.get("Items", [])
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

        dynamodb = boto3.client("dynamodb")

        tags_list = [{"S": str(tag)} for tag in (body.get("tags", []) or [])]
        category_ids = [str(c) for c in (body.get("categoryIds") or []) if c]
        category_ids_list = [{"S": cid} for cid in category_ids]

        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
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
            },
        )

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
        now = datetime.utcnow().isoformat() + "Z"

        update_expr = []
        names = {}
        values = {":updatedAt": {"S": now}}

        if title is not None:
            update_expr.append("#title = :title")
            names["#title"] = "title"
            values[":title"] = {"S": title}
        if description is not None:
            update_expr.append("#description = :description")
            names["#description"] = "description"
            values[":description"] = {"S": description}
        if category_ids is not None:
            update_expr.append("categoryIds = :categoryIds")
            values[":categoryIds"] = {"L": [{"S": str(c)} for c in category_ids]}

        if not update_expr:
            return jsonResponse({"error": "Nothing to update"}, 400)

        update_expr.append("updatedAt = :updatedAt")

        dynamodb = boto3.client("dynamodb")
        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": site_id}, "SK": {"S": "METADATA"}},
            UpdateExpression="SET " + ", ".join(update_expr),
            ExpressionAttributeNames=names if names else None,
            ExpressionAttributeValues=values,
        )

        return jsonResponse({"id": site_id, "title": title, "description": description, "categoryIds": category_ids}, 200)
    except Exception as e:
        logger.exception("updateSite error")
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
