"""Unit tests for feeds.fetcher (hourly poll, 304, backoff, time budget, cleanup sweep)."""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from feeds import fetcher  # noqa: E402
from feeds.fetch import FeedFetchError, FetchResult  # noqa: E402

_RSS_ONE = b"""<?xml version="1.0"?>
<rss version="2.0"><channel><title>Feed</title>
  <item><guid>item-1</guid><title>Hello</title><link>https://a.example/1</link><pubDate>Thu, 19 Nov 2026 15:00:00 GMT</pubDate></item>
</channel></rss>"""


def test_poll_due_feeds_handles_updated_304_and_failure_backoff():
    due = [
        {"sub": "u1", "feedId": "f-ok", "url": "https://a.example/rss", "etag": '"e1"', "failCount": 0, "tz": "America/Los_Angeles"},
        {"sub": "u1", "feedId": "f-304", "url": "https://b.example/rss", "etag": '"e2"', "failCount": 1, "tz": "America/Los_Angeles"},
        {"sub": "u2", "feedId": "f-bad", "url": "https://c.example/rss", "failCount": 2, "tz": "America/Los_Angeles"},
    ]

    def fakeFetch(url, etag=None, lastModified=None):
        if "a.example" in url:
            return FetchResult(200, url, "application/rss+xml", _RSS_ONE, '"e1-new"', None, False)
        if "b.example" in url:
            return FetchResult(304, url, "", b"", '"e2"', None, True)
        raise FeedFetchError("Connection timed out")

    with (
        patch.object(fetcher.storage, "_ddbClient"),
        patch.object(fetcher.storage, "sweepDeletedFeedCleanup", return_value=4),
        patch.object(fetcher.storage, "queryDueFeeds", return_value=due),
        patch.object(fetcher, "fetchUrl", side_effect=fakeFetch),
        patch.object(fetcher.storage, "upsertItems", return_value=(1, 0)) as mockUpsert,
        patch.object(fetcher.storage, "recordFetchSuccess") as mockOk,
        patch.object(fetcher.storage, "recordFetchFailure") as mockFail,
    ):
        stats = fetcher.handler({"job": "poll"}, None)

    assert stats["cleaned"] == 4
    assert stats["polled"] == 3
    assert stats["updated"] == 1
    assert stats["notModified"] == 1
    assert stats["failed"] == 1
    assert stats["itemsAdded"] == 1
    assert stats["stoppedEarly"] is False
    mockUpsert.assert_called_once()
    assert mockUpsert.call_args.kwargs["allowOverwrite"] is False
    assert mockOk.call_count == 2
    mockFail.assert_called_once()
    assert mockFail.call_args.kwargs["failCount"] == 3


def test_poll_due_feeds_stops_early_when_budget_low():
    due = [
        {"sub": "u1", "feedId": f"f-{i}", "url": f"https://ex{i}.test/rss", "failCount": 0}
        for i in range(10)
    ]
    ctx = MagicMock()
    ctx.get_remaining_time_in_millis.return_value = 5_000  # below MIN_REMAINING_SEC (15s)

    with (
        patch.object(fetcher.storage, "_ddbClient"),
        patch.object(fetcher.storage, "sweepDeletedFeedCleanup", return_value=0),
        patch.object(fetcher.storage, "queryDueFeeds", return_value=due),
        patch.object(fetcher, "fetchUrl") as mockFetch,
    ):
        stats = fetcher.handler({"job": "poll"}, ctx)

    assert stats["stoppedEarly"] is True
    assert stats["polled"] == 0
    mockFetch.assert_not_called()


def test_poll_due_feeds_end_to_end_with_fake_dynamo(monkeypatch):
    from tests.test_feeds_routes import FakeDynamo

    db = FakeDynamo()
    monkeypatch.setenv("FEEDS_TABLE", db.tableName)
    monkeypatch.setattr(fetcher.storage, "_tbl", lambda: db)
    monkeypatch.setattr(fetcher.storage, "_ddbClient", lambda: db)

    # Seed two due feeds + one orphan CLEANUP job
    okFeed = {
        "PK": "USER#u1",
        "SK": "FEED#f-ok",
        "feedId": "f-ok",
        "sub": "u1",
        "title": "OK Feed",
        "kind": "rss",
        "url": "https://ok.example/rss",
        "pinned": False,
        "sortOrder": 0,
        "tz": "America/Los_Angeles",
        "createdAt": "2026-11-18T00:00:00Z",
        "failCount": 0,
        "fetchKey": "POLL",
        "nextFetchAt": "2020-01-01T00:00:00Z",
    }
    badFeed = {
        "PK": "USER#u1",
        "SK": "FEED#f-bad",
        "feedId": "f-bad",
        "sub": "u1",
        "title": "Bad Feed",
        "kind": "rss",
        "url": "https://bad.example/rss",
        "pinned": False,
        "sortOrder": 1,
        "tz": "America/Los_Angeles",
        "createdAt": "2026-11-18T00:00:00Z",
        "failCount": 1,
        "fetchKey": "POLL",
        "nextFetchAt": "2020-01-01T00:00:00Z",
    }
    db.put_item(Item=okFeed)
    db.put_item(Item=badFeed)
    db.put_item(Item={"PK": "CLEANUP", "SK": "FEED#u1#f-deleted", "sub": "u1", "feedId": "f-deleted"})
    db.put_item(Item={"PK": "FEED#u1#f-deleted", "SK": "DAY#2026-11-01#ITEM#" + ("f" * 24)})

    def fakeFetch(url, etag=None, lastModified=None):
        if "ok.example" in url:
            return FetchResult(200, url, "application/rss+xml", _RSS_ONE, '"e-new"', None, False)
        raise FeedFetchError("HTTP 503", statusCode=503)

    with patch.object(fetcher, "fetchUrl", side_effect=fakeFetch):
        stats = fetcher.handler({"job": "poll"}, None)

    assert stats["cleaned"] == 1
    assert stats["polled"] == 2
    assert stats["updated"] == 1
    assert stats["failed"] == 1
    assert stats["itemsAdded"] == 1
    assert ("CLEANUP", "FEED#u1#f-deleted") not in db.rows

    feedRow = db.get_item(Key={"PK": "USER#u1", "SK": "FEED#f-ok"})["Item"]
    assert feedRow["etag"] == '"e-new"'
    assert feedRow["nextFetchAt"] > "2026-01-01T00:00:00Z"
    dayIdx = db.get_item(Key={"PK": "FEED#u1#f-ok", "SK": "DAYIDX#2026-11-19"})["Item"]
    assert dayIdx["count"] == 1

    badRow = db.get_item(Key={"PK": "USER#u1", "SK": "FEED#f-bad"})["Item"]
    assert badRow["failCount"] == 2
    assert "503" in badRow["lastError"]

