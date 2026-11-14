"""listSites/listMedia full pagination and duplicate-URL guard for site create/update."""
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api.site_urls import normalize_site_url  # noqa: E402


def _admin_event(path, method="POST", body=None):
    return {
        "rawPath": path,
        "requestContext": {
            "http": {"method": method, "path": path},
            "authorizer": {"jwt": {"claims": {"sub": "admin-123", "email": "a@example.com", "cognito:groups": "admin"}}},
        },
        "body": json.dumps(body) if body is not None else "{}",
    }


def _site(i, url=None, title=None):
    return {"PK": {"S": f"SITE#{i}"}, "title": {"S": title or f"Site {i:03d}"}, "url": {"S": url or f"https://s{i}.example"}}


def _media(i, title=None):
    return {"PK": {"S": f"MEDIA#{i}"}, "title": {"S": title or f"Media {i:03d}"}}


def _pages(items_a, items_b):
    return [{"Items": items_a, "LastEvaluatedKey": {"PK": {"S": "x"}}}, {"Items": items_b}]


def _public(path, qs=None):
    return {"rawPath": path, "requestContext": {"http": {"method": "GET", "path": path}}, "queryStringParameters": qs}


def _ddb(mock_boto_client, pages):
    ddb = MagicMock()
    ddb.query.side_effect = pages
    ddb.batch_get_item.return_value = {"Responses": {}}
    mock_boto_client.side_effect = lambda svc, **kw: MagicMock() if svc == "s3" else ddb
    return ddb


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_listSites_follows_pagination_without_Limit(mock_boto_client):
    ddb = _ddb(mock_boto_client, _pages([_site(i) for i in range(100)], [_site(i) for i in range(100, 135)]))
    from api.handler import handler
    result = handler(_public("/sites"), None)
    assert len(json.loads(result["body"])["sites"]) == 135
    assert ddb.query.call_count == 2
    assert all("Limit" not in c.kwargs for c in ddb.query.call_args_list)


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_listSites_search_finds_item_on_page_two(mock_boto_client):
    _ddb(mock_boto_client, _pages([_site(i) for i in range(100)], [_site(500, title="Zebra Unique")]))
    from api.handler import handler
    result = handler(_public("/sites", {"q": "zebra"}), None)
    sites = json.loads(result["body"])["sites"]
    assert [s["PK"] for s in sites] == ["SITE#500"]


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_listSites_explicit_limit_applies_after_sort(mock_boto_client):
    ddb = _ddb(mock_boto_client, _pages([_site(i) for i in range(100, 150)], [_site(i) for i in range(0, 50)]))
    from api.handler import handler
    result = handler(_public("/sites", {"limit": "10"}), None)
    sites = json.loads(result["body"])["sites"]
    assert [s["title"] for s in sites] == [f"Site {i:03d}" for i in range(10)]
    assert all("Limit" not in c.kwargs for c in ddb.query.call_args_list)


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_listMedia_follows_pagination_and_limit(mock_boto_client):
    ddb = _ddb(mock_boto_client, _pages([_media(i) for i in range(100)], [_media(i) for i in range(100, 135)]))
    from api.handler import handler
    result = handler(_public("/media"), None)
    assert len(json.loads(result["body"])["media"]) == 135
    assert ddb.query.call_count == 2
    assert all("Limit" not in c.kwargs for c in ddb.query.call_args_list)

    ddb = _ddb(mock_boto_client, _pages([_media(i) for i in range(100)], [_media(i) for i in range(100, 135)]))
    result = handler(_public("/media", {"limit": "10"}), None)
    assert len(json.loads(result["body"])["media"]) == 10


@pytest.mark.parametrize("a,b", [
    ("openclaw.ai", "https://openclaw.ai/"),
    ("openclaw.ai", "http://www.OpenClaw.ai"),
    ("openclaw.ai", "https://openclaw.ai:443/"),
    ("  openclaw.ai  ", "http://openclaw.ai:80"),
    ("https://x.com/Path/", "https://x.com/Path"),
    ("https://x.com/a#frag", "https://x.com/a"),
])
def test_normalize_equal(a, b):
    assert normalize_site_url(a) == normalize_site_url(b)


@pytest.mark.parametrize("a,b", [
    ("https://openclaw.ai/docs", "https://openclaw.ai"),
    ("https://x.com/a?b=1", "https://x.com/a"),
    ("https://x.com/Path", "https://x.com/path"),
])
def test_normalize_different(a, b):
    assert normalize_site_url(a) != normalize_site_url(b)


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_createSite_duplicate_returns_409(mock_boto_client):
    ddb = MagicMock()
    ddb.query.return_value = {"Items": [_site(1, url="https://openclaw.ai", title="OpenClaw")]}
    mock_boto_client.return_value = ddb
    from api.handler import handler
    result = handler(_admin_event("/sites", body={"url": "openclaw.ai/"}), None)
    assert result["statusCode"] == 409
    body = json.loads(result["body"])
    assert body["existingId"] == "SITE#1"
    assert body["existingTitle"] == "OpenClaw"
    ddb.put_item.assert_not_called()


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_createSite_duplicate_on_second_page_returns_409(mock_boto_client):
    ddb = MagicMock()
    ddb.query.side_effect = _pages([_site(i) for i in range(100)], [_site(999, url="https://openclaw.ai")])
    mock_boto_client.return_value = ddb
    from api.handler import handler
    result = handler(_admin_event("/sites", body={"url": "openclaw.ai/"}), None)
    assert result["statusCode"] == 409
    assert json.loads(result["body"])["existingId"] == "SITE#999"
    ddb.put_item.assert_not_called()


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_createSite_unique_url_succeeds(mock_boto_client):
    ddb = MagicMock()
    ddb.query.return_value = {"Items": [_site(1, url="https://other.example")]}
    mock_boto_client.return_value = ddb
    from api.handler import handler
    result = handler(_admin_event("/sites", body={"url": "openclaw.ai/"}), None)
    assert result["statusCode"] == 201
    ddb.put_item.assert_called_once()
    assert ddb.put_item.call_args.kwargs["Item"]["url"] == {"S": "openclaw.ai/"}


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_updateSite_url_of_other_site_returns_409(mock_boto_client):
    ddb = MagicMock()
    ddb.query.return_value = {"Items": [_site(1, url="https://a.example"), _site(2, url="https://b.example")]}
    mock_boto_client.return_value = ddb
    from api.handler import handler
    result = handler(_admin_event("/sites", method="PUT", body={"id": "SITE#1", "url": "b.example"}), None)
    assert result["statusCode"] == 409
    assert json.loads(result["body"])["existingId"] == "SITE#2"
    ddb.update_item.assert_not_called()


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_updateSite_keeping_own_url_ok(mock_boto_client):
    ddb = MagicMock()
    ddb.query.return_value = {"Items": [_site(1, url="https://a.example"), _site(2, url="https://b.example")]}
    mock_boto_client.return_value = ddb
    from api.handler import handler
    result = handler(_admin_event("/sites", method="PUT", body={"id": "SITE#1", "url": "https://www.a.example/"}), None)
    assert result["statusCode"] == 200
    ddb.update_item.assert_called_once()
