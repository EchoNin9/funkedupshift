"""
SNS alerting for the lipsync module. No-op (with a logged warning) when
LIPSYNC_ALERT_TOPIC_ARN isn't set, so local runs and tests never need a real
SNS topic. Mirrors social/alerts.py exactly.
"""
import logging
import os

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

LIPSYNC_ALERT_TOPIC_ARN = os.environ.get("LIPSYNC_ALERT_TOPIC_ARN", "")

_sns = None


def _client():
    global _sns
    if _sns is None:
        import boto3
        _sns = boto3.client("sns")
    return _sns


def sendAlert(subject, message):
    if not LIPSYNC_ALERT_TOPIC_ARN:
        logger.warning("LIPSYNC_ALERT_TOPIC_ARN not set; suppressing alert: %s", subject)
        return
    _client().publish(TopicArn=LIPSYNC_ALERT_TOPIC_ARN, Subject=subject[:100], Message=message)


def sendHeartbeat(subject, message):
    if not LIPSYNC_ALERT_TOPIC_ARN:
        logger.warning("LIPSYNC_ALERT_TOPIC_ARN not set; suppressing heartbeat: %s", subject)
        return
    _client().publish(TopicArn=LIPSYNC_ALERT_TOPIC_ARN, Subject=subject[:100], Message=message)
