import json
from unittest.mock import patch, MagicMock
from api.stats import getAdminStats, postAdminStatsRecompute
from api.handler import handler

@patch("api.stats.TABLE_NAME", "test_table")
@patch("api.stats.boto3.resource")
def test_get_admin_stats_success(mock_boto3_resource):
    # stats.py uses boto3.resource (not .client); resource API returns plain Python values
    mock_table = MagicMock()
    mock_boto3_resource.return_value.Table.return_value = mock_table
    mock_table.get_item.return_value = {
        "Item": {"stats": {"users": 10, "sites": 5}}
    }
    
    event = {
        "requestContext": {
            "authorizer": {
                "jwt": {
                    "claims": {
                        "sub": "user123",
                        "cognito:groups": ["admin"]
                    }
                }
            }
        }
    }
    
    resp = getAdminStats(event)
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["stats"]["users"] == 10
    assert body["stats"]["sites"] == 5

@patch("api.stats.TABLE_NAME", "test_table")
@patch("api.stats.boto3.resource")
def test_get_admin_stats_serializes_decimals(mock_boto3_resource):
    # collector rollups come back from the resource API as Decimal — must not 500
    from decimal import Decimal
    mock_table = MagicMock()
    mock_boto3_resource.return_value.Table.return_value = mock_table
    mock_table.get_item.return_value = {
        "Item": {"stats": {"s3_log_lines": Decimal("42"), "metrics": {"4xx_errors": Decimal("3")}}}
    }

    event = {
        "requestContext": {
            "authorizer": {"jwt": {"claims": {"sub": "user123", "cognito:groups": ["admin"]}}}
        }
    }

    resp = getAdminStats(event)
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["stats"]["s3_log_lines"] == 42
    assert body["stats"]["metrics"]["4xx_errors"] == 3

def test_get_admin_stats_forbidden():
    event = {
        "requestContext": {
            "authorizer": {
                "jwt": {
                    "claims": {
                        "sub": "user123",
                        "cognito:groups": ["user"]
                    }
                }
            }
        }
    }
    
    resp = getAdminStats(event)
    assert resp["statusCode"] == 403

@patch("api.stats.boto3.client")
@patch("api.stats.os.environ.get")
def test_post_admin_stats_recompute_success(mock_env_get, mock_boto3_client):
    mock_env_get.side_effect = lambda k, d="": "test_table" if k == "TABLE_NAME" else "fus-collector"
    mock_lambda = MagicMock()
    mock_boto3_client.return_value = mock_lambda
    
    event = {
        "requestContext": {
            "authorizer": {
                "jwt": {
                    "claims": {
                        "sub": "user123",
                        "cognito:groups": ["admin"]
                    }
                }
            }
        }
    }
    
    resp = postAdminStatsRecompute(event)
    assert resp["statusCode"] == 200
    mock_lambda.invoke.assert_called_once()
    args, kwargs = mock_lambda.invoke.call_args
    assert kwargs["FunctionName"] == "fus-collector"
    assert kwargs["InvocationType"] == "Event"
    payload = json.loads(kwargs["Payload"])
    assert payload["action"] == "recompute"
    # recompute now targets today (UTC) so fresh traffic is captured (FUNK-62)
    import datetime
    assert payload["date"] == datetime.datetime.utcnow().strftime("%Y-%m-%d")

def test_post_admin_stats_recompute_forbidden():
    event = {
        "requestContext": {
            "authorizer": {
                "jwt": {
                    "claims": {
                        "sub": "user123",
                        "cognito:groups": ["user"]
                    }
                }
            }
        }
    }
    
    resp = postAdminStatsRecompute(event)
    assert resp["statusCode"] == 403

@patch("api.handler.logger.info")
def test_handler_emits_structured_log(mock_logger_info):
    event = {
        "rawPath": "/health",
        "requestContext": {
            "http": {"method": "GET", "path": "/health"},
            "authorizer": {
                "jwt": {
                    "claims": {
                        "sub": "user123"
                    }
                }
            }
        }
    }
    
    handler(event, {})
    
    found = False
    for call in mock_logger_info.call_args_list:
        try:
            log_obj = json.loads(call[0][0])
            if "ts" in log_obj and log_obj.get("sub") == "user123" and log_obj.get("method") == "GET" and log_obj.get("path") == "/health":
                found = True
        except Exception:
            pass
    assert found

@patch("api.handler.logger.info")
def test_handler_emits_structured_log_unauthenticated(mock_logger_info):
    event = {
        "rawPath": "/health",
        "requestContext": {
            "http": {"method": "GET", "path": "/health"}
        }
    }
    
    handler(event, {})
    
    found = False
    for call in mock_logger_info.call_args_list:
        try:
            log_obj = json.loads(call[0][0])
            if "ts" in log_obj and log_obj.get("sub") == "unauthenticated" and log_obj.get("method") == "GET" and log_obj.get("path") == "/health":
                found = True
        except Exception:
            pass
    assert found
