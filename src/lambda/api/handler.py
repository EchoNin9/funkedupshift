"""
API Gateway HTTP API (payload 2.0) handler. Routes by path.
"""
import logging
import os

from common.response import jsonResponse

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ.get("TABLE_NAME", "")


def getUserInfo(event):
    """Extract user info from Cognito authorizer context."""
    authorizer = event.get("requestContext", {}).get("authorizer", {})
    jwt = authorizer.get("jwt", {})
    claims = jwt.get("claims", {})
    return {
        "userId": claims.get("sub", ""),
        "email": claims.get("email", ""),
        "groups": claims.get("cognito:groups", "").split(",") if claims.get("cognito:groups") else [],
    }


def handler(event, context):
    """Route request by path; return JSON with CORS headers."""
    logger.info("event=%s", event)

    try:
        path = event.get("rawPath") or event.get("requestContext", {}).get("http", {}).get("path") or ""
        method = event.get("requestContext", {}).get("http", {}).get("method") or "GET"

        if method == "GET" and path == "/health":
            return jsonResponse({"ok": True})
        if method == "GET" and path == "/sites":
            return listSites(event)
        if method == "POST" and path == "/sites":
            return createSite(event)
        return jsonResponse({"error": "Not Found"}, 404)
    except Exception as e:
        logger.exception("handler error")
        return jsonResponse({"error": str(e)}, 500)


def listSites(event):
    """Query DynamoDB byEntity (entityType=SITE) and return items."""
    if not TABLE_NAME:
        return jsonResponse({"sites": [], "error": "TABLE_NAME not set"}, 200)

    try:
        import boto3
        dynamo = boto3.resource("dynamodb")
        table = dynamo.Table(TABLE_NAME)
        result = table.query(
            IndexName="byEntity",
            KeyConditionExpression="entityType = :et",
            ExpressionAttributeValues={":et": "SITE"},
        )
        items = result.get("Items", [])
        return jsonResponse({"sites": items})
    except Exception as e:
        logger.exception("listSites error")
        return jsonResponse({"error": str(e), "sites": []}, 500)


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

        dynamo = boto3.resource("dynamodb")
        table = dynamo.Table(TABLE_NAME)

        # Site metadata item
        table.put_item(
            Item={
                "PK": site_id,
                "SK": "METADATA",
                "url": url,
                "title": title or url,
                "description": body.get("description", ""),
                "tags": body.get("tags", []),
                "createdAt": now,
                "updatedAt": now,
                "entityType": "SITE",
                "entitySk": site_id,
            }
        )

        return jsonResponse({"id": site_id, "url": url, "title": title or url}, 201)
    except Exception as e:
        logger.exception("createSite error")
        return jsonResponse({"error": str(e)}, 500)
