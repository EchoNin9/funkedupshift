import pytest
import os
import json
import gzip
import datetime
from unittest.mock import MagicMock, patch

# Set env vars before importing handler
os.environ["TABLE_NAME"] = "test-table"
os.environ["CLOUDFRONT_LOG_BUCKET"] = "test-bucket"
os.environ["API_LOG_GROUP_NAME"] = "test-log-group"
# collector builds boto3 clients at import; a region must exist for local runs
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")

from collector.handler import handler

@patch("collector.handler.s3_client")
@patch("collector.handler.logs_client")
@patch("collector.handler.cw_client")
@patch("collector.handler.dynamodb")
def test_handler_cron(mock_dynamodb, mock_cw, mock_logs, mock_s3):
    # Setup mocks
    mock_table = MagicMock()
    mock_dynamodb.Table.return_value = mock_table
    
    # Key must embed the target date the way CloudFront names log files:
    # <prefix><dist>.YYYY-MM-DD-HH.<hash>.gz — the collector matches ".<date>-".
    _yday = (datetime.datetime.utcnow() - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    mock_s3.get_paginator.return_value.paginate.return_value = [
        {"Contents": [
            {"Key": f"production/E1ABCD.{_yday}-22.deadbeef.gz"},
            {"Key": f"production/E1ABCD.2000-01-01-00.other.gz"},  # wrong day: skipped
        ]}
    ]
    
    # Mock gzip content
    mock_body = MagicMock()
    # GzipFile needs a read method.
    import io
    # A dummy gz file with some content
    gz_data = gzip.compress(b"line1\nline2\n")
    mock_body.read.side_effect = lambda amt=-1: io.BytesIO(gz_data).read(amt)
    mock_s3.get_object.return_value = {"Body": io.BytesIO(gz_data)}
    
    mock_cw.get_metric_statistics.return_value = {
        "Datapoints": [{"Sum": 42}]
    }
    
    mock_logs.start_query.return_value = {"queryId": "123"}
    mock_logs.get_query_results.return_value = {
        "status": "Complete",
        "results": [
            [{"field": "@message", "value": "click path 1"}]
        ]
    }
    
    # Run
    event = {}
    response = handler(event, {})
    
    # Assertions
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["message"] == "Success"
    
    yesterday = datetime.datetime.utcnow() - datetime.timedelta(days=1)
    assert body["date"] == yesterday.strftime("%Y-%m-%d")
    
    stats = body["stats"]
    assert stats["s3_log_lines"] == 2
    assert stats["metrics"]["4xx_errors"] == 42
    assert stats["click_paths"] == ["click path 1"]
    
    mock_table.put_item.assert_called_once()
    put_args = mock_table.put_item.call_args[1]["Item"]
    assert put_args["PK"] == f"STATS#DAILY#{body['date']}"
    assert put_args["SK"] == "METADATA"


@patch("collector.handler.s3_client")
@patch("collector.handler.logs_client")
@patch("collector.handler.cw_client")
@patch("collector.handler.dynamodb")
def test_handler_recompute(mock_dynamodb, mock_cw, mock_logs, mock_s3):
    mock_table = MagicMock()
    mock_dynamodb.Table.return_value = mock_table
    
    mock_s3.get_paginator.return_value.paginate.return_value = []
    
    mock_cw.get_metric_statistics.return_value = {}
    mock_logs.start_query.return_value = {"queryId": "123"}
    mock_logs.get_query_results.return_value = {"status": "Complete", "results": []}
    
    event = {"action": "recompute", "date": "2024-01-01"}
    response = handler(event, {})
    
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["date"] == "2024-01-01"
    
    mock_table.put_item.assert_called_once()
    put_args = mock_table.put_item.call_args[1]["Item"]
    assert put_args["PK"] == "STATS#DAILY#2024-01-01"
