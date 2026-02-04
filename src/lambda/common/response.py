"""CORS and JSON response helpers for API handlers."""

import json


def jsonResponse(body, statusCode=200):
    """Return a response dict with JSON body and CORS headers for API Gateway."""
    return {
        "statusCode": statusCode,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body) if not isinstance(body, str) else body,
    }
