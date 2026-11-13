"""Tests for GET /sites/latest."""
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api import handler  # noqa: E402


def _site(pk, title, created=None, s=None, c=None, logo=None):
    it = {"PK": {"S": pk}, "title": {"S": title}, "url": {"S": f"https://{pk}.example"}}
    if created:
        it["createdAt"] = {"S": created}
    if s is not None:
        it["totalStarsSum"] = {"N": str(s)}
        it["totalStarsCount"] = {"N": str(c)}
    if logo:
        it["logoUrl"] = {"S": logo}
    return it


def _run(pages, count=None, qs=None):
    ddb = MagicMock()
    ddb.query.side_effect = pages
    settings = {"defaultThemeId": "funk", "defaultMode": "dark"}
    if count is not None:
        settings["latestSitesCount"] = count
    else:
        settings["latestSitesCount"] = 6
    ev = {"rawPath": "/sites/latest", "requestContext": {"http": {"method": "GET", "path": "/sites/latest"}},
          "queryStringParameters": qs}
    with patch.object(handler, "TABLE_NAME", "t"), \
         patch("boto3.client", return_value=ddb), \
         patch("api.themes._get_settings", return_value=settings):
        r = handler.handler(ev, None)
    return r["statusCode"], json.loads(r["body"]), ddb


def _many(n):
    return [_site(f"s{i}", f"T{i}", f"2026-01-{i + 1:02d}T00:00:00Z", logo="http://l") for i in range(n)]


def test_newest_first_and_default_six():
    code, body, _ = _run([{"Items": _many(10)}])
    assert code == 200
    assert [s["PK"] for s in body["sites"]] == ["s9", "s8", "s7", "s6", "s5", "s4"]
    assert body["limit"] == 6 and body["totalSites"] == 10


def test_limit_from_setting():
    _, body, _ = _run([{"Items": _many(10)}], count=3)
    assert len(body["sites"]) == 3 and body["limit"] == 3


def test_limit_zero():
    _, body, _ = _run([{"Items": _many(10)}], count=0)
    assert body["sites"] == [] and body["totalSites"] == 10 and body["limit"] == 0


def test_missing_created_at_sorts_last_title_tiebreak():
    items = [_site("old2", "Zed"), _site("old1", "alpha"), _site("new", "N", "2026-05-01T00:00:00Z")]
    _, body, _ = _run([{"Items": items}])
    assert [s["PK"] for s in body["sites"]] == ["new", "old1", "old2"]
    assert body["sites"][1]["createdAt"] is None


def test_pagination():
    p1 = {"Items": _many(3), "LastEvaluatedKey": {"PK": {"S": "x"}}}
    p2 = {"Items": [_site("late", "L", "2027-01-01T00:00:00Z")]}
    _, body, ddb = _run([p1, p2])
    assert ddb.query.call_count == 2
    assert body["totalSites"] == 4 and body["sites"][0]["PK"] == "late"
    assert ddb.query.call_args_list[1].kwargs["ExclusiveStartKey"] == {"PK": {"S": "x"}}


def test_rating_omitted_when_unrated_and_rounded():
    items = [_site("a", "A", "2026-02-01T00:00:00Z"), _site("b", "B", "2026-01-01T00:00:00Z", s=10, c=3, logo="http://l")]
    _, body, _ = _run([{"Items": items}])
    a, b = body["sites"]
    assert "averageRating" not in a
    assert b["averageRating"] == 3.3
    assert set(b) == {"PK", "title", "url", "logoUrl", "averageRating", "createdAt"}


def test_projection_includes_created_at_and_sites_list_too():
    _, _, ddb = _run([{"Items": []}])
    assert "#createdAt" in ddb.query.call_args.kwargs["ProjectionExpression"]


def test_list_sites_projection_has_created_at():
    ddb = MagicMock()
    ddb.query.return_value = {"Items": [_site("a", "A", "2026-01-01T00:00:00Z")]}
    ev = {"rawPath": "/sites", "requestContext": {"http": {"method": "GET", "path": "/sites"}}, "queryStringParameters": None}
    with patch.object(handler, "TABLE_NAME", "t"), patch("boto3.client", return_value=ddb):
        r = handler.handler(ev, None)
    assert "#createdAt" in ddb.query.call_args.kwargs["ProjectionExpression"]
    assert json.loads(r["body"])["sites"][0]["createdAt"] == "2026-01-01T00:00:00Z"
