"""Hourly EventBridge feed poller and async deleted-feed partition sweeper."""

from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import datetime, timezone
import logging
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from feeds import storage
from feeds.fetch import FeedFetchError, fetchUrl
from feeds.parser import DEFAULT_TZ, FeedParseError, parseFeed, preparePolledItems

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

MAX_WORKERS = 5
DEFAULT_BUDGET_SEC = 270.0
MIN_REMAINING_SEC = 15.0


def _isoNowUtc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _remainingSeconds(context, deadline: float) -> float:
    monoLeft = deadline - time.monotonic()
    if context is not None and hasattr(context, "get_remaining_time_in_millis"):
        try:
            ctxLeft = float(context.get_remaining_time_in_millis()) / 1000.0
            return min(monoLeft, ctxLeft)
        except Exception:
            pass
    return monoLeft


def _pollOneFeed(feed: dict) -> dict:
    sub = feed["sub"]
    feedId = feed["feedId"]
    url = feed.get("url") or ""
    failCount = int(feed.get("failCount", 0))

    if not url:
        storage.recordFetchFailure(sub, feedId, errorMessage="Feed URL missing", failCount=failCount + 1)
        return {"status": "failed", "added": 0}

    try:
        res = fetchUrl(url, etag=feed.get("etag"), lastModified=feed.get("lastModified"))
    except FeedFetchError as e:
        logger.warning("Feed poll fetch failed feedId=%s err=%s", feedId, e)
        storage.recordFetchFailure(sub, feedId, errorMessage=str(e), failCount=failCount + 1)
        return {"status": "failed", "added": 0}
    except Exception as e:
        logger.exception("Unexpected feed poll error feedId=%s: %s", feedId, e)
        storage.recordFetchFailure(sub, feedId, errorMessage=str(e), failCount=failCount + 1)
        return {"status": "failed", "added": 0}

    if res.notModified:
        storage.recordFetchSuccess(
            sub,
            feedId,
            etag=res.etag,
            lastModified=res.lastModified,
            lastItemAt=None,
            currentLastItemAt=feed.get("lastItemAt"),
            notModified=True,
        )
        return {"status": "notModified", "added": 0}

    try:
        parsed = parseFeed(res.body, contentType=res.contentType, url=res.url)
        nowIso = _isoNowUtc()
        prepared = preparePolledItems(parsed, fetchedAt=nowIso, tzName=feed.get("tz") or DEFAULT_TZ)
        added, _ = storage.upsertItems(sub, feedId, prepared, allowOverwrite=False)
        lastItemAt = max((it["publishedAt"] for it in prepared), default=None)
        storage.recordFetchSuccess(
            sub,
            feedId,
            etag=res.etag,
            lastModified=res.lastModified,
            lastItemAt=lastItemAt,
            currentLastItemAt=feed.get("lastItemAt"),
            notModified=False,
        )
        return {"status": "updated", "added": added}
    except FeedParseError as e:
        logger.warning("Feed parse failed feedId=%s err=%s", feedId, e)
        storage.recordFetchFailure(sub, feedId, errorMessage=str(e), failCount=failCount + 1)
        return {"status": "failed", "added": 0}
    except Exception as e:
        logger.exception("Feed upsert failed feedId=%s: %s", feedId, e)
        storage.recordFetchFailure(sub, feedId, errorMessage=str(e), failCount=failCount + 1)
        return {"status": "failed", "added": 0}


def pollDueFeeds(context=None, *, maxBudgetSec: float = DEFAULT_BUDGET_SEC) -> dict:
    deadline = time.monotonic() + maxBudgetSec
    cleaned = storage.sweepDeletedFeedCleanup()

    nowIso = _isoNowUtc()
    dueFeeds = storage.queryDueFeeds(nowIso)

    stats = {
        "polled": 0,
        "updated": 0,
        "notModified": 0,
        "failed": 0,
        "itemsAdded": 0,
        "cleaned": cleaned,
        "stoppedEarly": False,
    }
    if not dueFeeds:
        return stats

    # Pre-initialize shared low-level boto3 client before spawning threads;
    # high-level ServiceResource is stored per-thread via threading.local().
    storage._ddbClient()

    it = iter(dueFeeds)
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        inFlight = set()

        while True:
            while len(inFlight) < MAX_WORKERS:
                if _remainingSeconds(context, deadline) < MIN_REMAINING_SEC:
                    stats["stoppedEarly"] = True
                    break
                try:
                    feed = next(it)
                except StopIteration:
                    break
                inFlight.add(pool.submit(_pollOneFeed, feed))

            if not inFlight:
                break

            done, inFlight = wait(inFlight, return_when=FIRST_COMPLETED)
            for fut in done:
                stats["polled"] += 1
                try:
                    res = fut.result()
                except Exception as e:
                    logger.exception("Unhandled worker exception: %s", e)
                    stats["failed"] += 1
                    continue
                st = res.get("status")
                if st in ("updated", "notModified", "failed"):
                    stats[st] += 1
                stats["itemsAdded"] += int(res.get("added", 0))

            if stats["stoppedEarly"] and not inFlight:
                break

    return stats


def handler(event, context):
    return pollDueFeeds(context=context)
