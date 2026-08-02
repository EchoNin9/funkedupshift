"""
SNS alerting for the social scheduling module. No-op (with a logged warning)
when SOCIAL_ALERT_TOPIC_ARN isn't set, so local runs and tests never need a
real SNS topic.
"""
import logging
import os

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

SOCIAL_ALERT_TOPIC_ARN = os.environ.get("SOCIAL_ALERT_TOPIC_ARN", "")

_sns = None


def _client():
    global _sns
    if _sns is None:
        import boto3
        _sns = boto3.client("sns")
    return _sns


def sendAlert(subject, message):
    if not SOCIAL_ALERT_TOPIC_ARN:
        logger.warning("SOCIAL_ALERT_TOPIC_ARN not set; suppressing alert: %s", subject)
        return
    _client().publish(TopicArn=SOCIAL_ALERT_TOPIC_ARN, Subject=subject[:100], Message=message)


def sendHeartbeat(subject, message):
    if not SOCIAL_ALERT_TOPIC_ARN:
        logger.warning("SOCIAL_ALERT_TOPIC_ARN not set; suppressing heartbeat: %s", subject)
        return
    _client().publish(TopicArn=SOCIAL_ALERT_TOPIC_ARN, Subject=subject[:100], Message=message)
