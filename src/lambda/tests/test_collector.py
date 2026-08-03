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
os.environ["API_ID"] = "test-api-id"
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
    
    # CloudWatch returns Sum as a float; the collector must int() it so the
    # DynamoDB write doesn't choke ("Float types are not supported").
    mock_cw.get_metric_statistics.return_value = {
        "Datapoints": [{"Sum": 42.0}]
    }
    
    mock_logs.start_query.return_value = {"queryId": "123"}
    mock_logs.get_query_results.return_value = {
        "status": "Complete",
        "results": [
            # Lambda log line wrapping the structured request JSON
            [{"field": "@message", "value":
                '2026-07-21T06:11:37Z\treqid\t{"ts": "2026-07-21T06:11:37Z", '
                '"sub": "user123", "method": "GET", "path": "/admin/stats"}'}],
            # non-JSON line falls back to the raw message (truncated)
            [{"field": "@message", "value": "malformed line no json"}],
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
    assert isinstance(stats["metrics"]["4xx_errors"], int)
    assert stats["click_paths"] == ["GET /admin/stats", "malformed line no json"]
    
    mock_table.put_item.assert_called_once()
    put_args = mock_table.put_item.call_args[1]["Item"]
    assert put_args["PK"] == f"STATS#DAILY#{body['date']}"
    assert put_args["SK"] == "METADATA"


def _log_row(sub, method, path):
    payload = {"ts": "2026-07-21T06:11:37Z", "sub": sub, "method": method, "path": path}
    return [{"field": "@message", "value": f"2026-07-21T06:11:37Z\treqid\t{json.dumps(payload)}"}]


@patch("collector.handler.s3_client")
@patch("collector.handler.logs_client")
@patch("collector.handler.cw_client")
@patch("collector.handler.dynamodb")
def test_click_paths_top15_ranking(mock_dynamodb, mock_cw, mock_logs, mock_s3):
    mock_dynamodb.Table.return_value = MagicMock()
    mock_s3.get_paginator.return_value.paginate.return_value = []
    mock_cw.get_metric_statistics.return_value = {}
    mock_logs.start_query.return_value = {"queryId": "123"}

    # Newest-first (as the query returns): /a x3, /b x2, then 20 unique singles.
    rows = [_log_row("u", "GET", "/a")] * 3 + [_log_row("u", "GET", "/b")] * 2
    rows += [_log_row("u", "GET", f"/s{i}") for i in range(20)]
    mock_logs.get_query_results.return_value = {"status": "Complete", "results": rows}

    body = json.loads(handler({"action": "recompute", "date": "2024-01-01"}, {})["body"])
    cp = body["stats"]["click_paths"]

    assert len(cp) == 15                       # capped at 15
    assert cp[0] == "GET /a  (×3)"             # highest count first
    assert cp[1] == "GET /b  (×2)"             # next by count
    assert cp[2] == "GET /s0"                  # fill with most-recent single, no count suffix
    assert cp[-1] == "GET /s12"                # 2 multi + 13 singles = 15 rows


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
