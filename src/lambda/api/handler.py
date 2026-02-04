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
        if method == "OPTIONS":
            # CORS preflight
            return jsonResponse({}, 200)
        return jsonResponse({"error": "Not Found", "path": path, "method": method}, 404)
    except Exception as e:
        logger.exception("handler error: %s", str(e))
        import traceback
        logger.error("traceback: %s", traceback.format_exc())
        return jsonResponse({"error": str(e), "type": type(e).__name__}, 500)


def listSites(event):
    """Query DynamoDB byEntity (entityType=SITE) and return items."""
    logger.info("listSites called, TABLE_NAME=%s", TABLE_NAME)
    if not TABLE_NAME:
        logger.warning("TABLE_NAME not set")
        return jsonResponse({"sites": [], "error": "TABLE_NAME not set"}, 200)

    try:
        logger.info("Importing boto3")
        import boto3
        logger.info("Creating DynamoDB client (not resource)")
        # Use client instead of resource for better error handling
        region = os.environ.get("AWS_REGION", "us-east-1")
        logger.info("Region: %s", region)
        dynamodb = boto3.client("dynamodb", region_name=region)
        logger.info("DynamoDB client created, about to query")
        logger.info("Querying table %s, GSI byEntity", TABLE_NAME)
        result = dynamodb.query(
            TableName=TABLE_NAME,
            IndexName="byEntity",
            KeyConditionExpression="entityType = :et",
            ExpressionAttributeValues={":et": {"S": "SITE"}},
        )
        logger.info("Query completed, processing results")
        items = result.get("Items", [])
        # Convert DynamoDB format to simple dicts
        sites = []
        for item in items:
            site = {}
            for key, val in item.items():
                # DynamoDB returns {"S": "value"} format, extract the value
                if "S" in val:
                    site[key] = val["S"]
                elif "N" in val:
                    site[key] = int(val["N"]) if "." not in val["N"] else float(val["N"])
                elif "L" in val:
                    site[key] = [v.get("S", "") for v in val["L"]]
            sites.append(site)
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
        
        # Convert Python types to DynamoDB format
        tags_list = [{"S": str(tag)} for tag in (body.get("tags", []) or [])]
        
        # Site metadata item
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": site_id},
                "SK": {"S": "METADATA"},
                "url": {"S": url},
                "title": {"S": title or url},
                "description": {"S": body.get("description", "")},
                "tags": {"L": tags_list},
                "createdAt": {"S": now},
                "updatedAt": {"S": now},
                "entityType": {"S": "SITE"},
                "entitySk": {"S": site_id},
            }
        )

        return jsonResponse({"id": site_id, "url": url, "title": title or url}, 201)
    except Exception as e:
        logger.exception("createSite error")
        return jsonResponse({"error": str(e)}, 500)
