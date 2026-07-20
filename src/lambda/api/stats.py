import json
import logging
import os
import boto3
from common.response import jsonResponse
from api.handler import getUserInfo

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ.get("TABLE_NAME", "")

def _requireAdmin(event):
    user = getUserInfo(event)
    if "admin" not in user.get("groups", []):
        return None, jsonResponse({"error": "Forbidden: Admin required"}, 403)
    return user, None

def getAdminStats(event):
    user, err = _requireAdmin(event)
    if err:
        return err
    
    if not TABLE_NAME:
        return jsonResponse({"stats": {}})

    try:
        dynamodb = boto3.resource("dynamodb")
        table = dynamodb.Table(TABLE_NAME)
        
        import datetime
        # Try today then yesterday
        today = datetime.datetime.utcnow().strftime("%Y-%m-%d")
        yesterday = (datetime.datetime.utcnow() - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
        
        for date_str in [today, yesterday]:
            resp = table.get_item(
                Key={"PK": f"STATS#DAILY#{date_str}", "SK": "METADATA"},
            )
            if "Item" in resp:
                stats = resp["Item"].get("stats", {})
                return jsonResponse({"stats": stats})
                
        return jsonResponse({"stats": {}})
    except Exception as e:
        logger.exception("getAdminStats error: %s", e)
        return jsonResponse({"error": str(e)}, 500)

def postAdminStatsRecompute(event):
    user, err = _requireAdmin(event)
    if err:
        return err
    
    try:
        lambda_client = boto3.client("lambda")
        collector_fn = os.environ.get("COLLECTOR_FUNCTION_NAME", "fus-collector")
        lambda_client.invoke(
            FunctionName=collector_fn,
            InvocationType="Event",
            Payload=json.dumps({"action": "recompute"})
        )
        return jsonResponse({"message": "Recompute triggered"})
    except Exception as e:
        logger.exception("postAdminStatsRecompute error: %s", e)
        return jsonResponse({"error": str(e)}, 500)
