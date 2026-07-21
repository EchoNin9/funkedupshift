"""CORS and JSON response helpers for API handlers."""

import decimal
import json


def _jsonDefault(o):
    # boto3 resource API returns DynamoDB numbers as Decimal
    if isinstance(o, decimal.Decimal):
        return int(o) if o == o.to_integral_value() else float(o)
    raise TypeError(f"Object of type {type(o).__name__} is not JSON serializable")


def jsonResponse(body, statusCode=200):
    """Return a response dict with JSON body and CORS headers for API Gateway."""
    return {
        "statusCode": statusCode,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body, default=_jsonDefault) if not isinstance(body, str) else body,
    }
