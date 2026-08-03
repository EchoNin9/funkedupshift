"""Unit tests for social/alerts.py (SNS wrapper, phase 2)."""
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def test_send_alert_no_op_when_topic_arn_unset():
    from social import alerts

    client = MagicMock()
    with patch.object(alerts, "SOCIAL_ALERT_TOPIC_ARN", ""), patch.object(alerts, "_client", return_value=client):
        alerts.sendAlert("subject", "message")

    client.publish.assert_not_called()


def test_send_heartbeat_no_op_when_topic_arn_unset():
    from social import alerts

    client = MagicMock()
    with patch.object(alerts, "SOCIAL_ALERT_TOPIC_ARN", ""), patch.object(alerts, "_client", return_value=client):
        alerts.sendHeartbeat("subject", "message")

    client.publish.assert_not_called()


def test_send_alert_publishes_to_configured_topic_with_subject():
    from social import alerts

    client = MagicMock()
    topicArn = "arn:aws:sns:us-east-1:123:fus-social-alerts"
    with patch.object(alerts, "SOCIAL_ALERT_TOPIC_ARN", topicArn), patch.object(alerts, "_client", return_value=client):
        alerts.sendAlert("Something failed", "details here")

    client.publish.assert_called_once_with(TopicArn=topicArn, Subject="Something failed", Message="details here")


def test_send_heartbeat_publishes_to_configured_topic():
    from social import alerts

    client = MagicMock()
    topicArn = "arn:aws:sns:us-east-1:123:fus-social-alerts"
    with patch.object(alerts, "SOCIAL_ALERT_TOPIC_ARN", topicArn), patch.object(alerts, "_client", return_value=client):
        alerts.sendHeartbeat("Daily heartbeat", "pending=0 published_last_24h=1 failed=0")

    client.publish.assert_called_once_with(
        TopicArn=topicArn, Subject="Daily heartbeat", Message="pending=0 published_last_24h=1 failed=0"
    )


def test_send_alert_truncates_subject_to_100_chars():
    from social import alerts

    client = MagicMock()
    longSubject = "x" * 200
    with patch.object(alerts, "SOCIAL_ALERT_TOPIC_ARN", "arn:aws:sns:us-east-1:123:t"), \
         patch.object(alerts, "_client", return_value=client):
        alerts.sendAlert(longSubject, "m")

    assert len(client.publish.call_args.kwargs["Subject"]) == 100
