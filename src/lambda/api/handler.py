"""
API Gateway HTTP API (payload 2.0) handler. Routes by path.
"""
import logging
import os

from common.response import jsonResponse

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ.get("TABLE_NAME", "")


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
