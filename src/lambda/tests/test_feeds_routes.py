"""Unit & integration-style tests for feeds.routes and feeds.storage (all 20 routes + strict Decimal/TypeSerializer checks)."""

from copy import deepcopy
from decimal import Decimal
import json
from pathlib import Path
import re
import sys
from unittest.mock import patch

from boto3.dynamodb.types import TypeDeserializer, TypeSerializer
from botocore.exceptions import ClientError
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from feeds import routes, storage  # noqa: E402
from feeds.fetch import FetchResult  # noqa: E402
from feeds.parser import parseFeed  # noqa: E402

_SER = TypeSerializer()
_DESER = TypeDeserializer()


class FakeDynamo:
    """In-memory single-table DynamoDB double enforcing boto3 TypeSerializer on all writes."""

    def __init__(self):
        self.rows: dict[tuple[str, str], dict] = {}
        self.tableName = "fus-feeds-test"

    def _condErr(self, code="ConditionalCheckFailedException", cancellationReasons=None):
        err = {"Error": {"Code": code, "Message": code}}
        if cancellationReasons is not None:
            err["CancellationReasons"] = cancellationReasons
        return ClientError(err, "DynamoOp")

    def _evalKeyCond(self, expr, item: dict) -> bool:
        e = expr.get_expression()
        op = e["operator"]
        vals = e["values"]
        if op == "AND":
            return all(self._evalKeyCond(v, item) for v in vals)
        attr = vals[0].name
        target = vals[1]
        val = item.get(attr)
        if val is None:
            return False
        if op == "=":
            return val == target
        if op == "begins_with":
            return isinstance(val, str) and val.startswith(target)
        if op == "<=":
            return val <= target
        if op == ">":
            return val > target
        raise AssertionError(f"Unsupported condition operator: {op}")

    def _resolveName(self, tok: str, names: dict | None) -> str:
        if tok.startswith("#") and names and tok in names:
            return names[tok]
        return tok

    def _checkCond(self, cond: str | None, existing: dict | None, names: dict | None, vals: dict | None) -> bool:
        if not cond:
            return True
        c = cond.strip()
        mNotEx = re.match(r"^attribute_not_exists\(([^)]+)\)$", c)
        if mNotEx:
            attr = self._resolveName(mNotEx.group(1).strip(), names)
            return existing is None or attr not in existing
        mEx = re.match(r"^attribute_exists\(([^)]+)\)$", c)
        if mEx:
            attr = self._resolveName(mEx.group(1).strip(), names)
            return existing is not None and attr in existing
        m = re.match(r"^(\S+)\s*<=\s*(:\w+)$", c)
        if m and vals:
            attr = self._resolveName(m.group(1), names)
            cur = (existing or {}).get(attr)
            return cur is not None and cur <= vals[m.group(2)]
        mEq = re.match(r"^(\S+)\s*=\s*(:\w+)$", c)
        if mEq and vals:
            attr = self._resolveName(mEq.group(1), names)
            return (existing or {}).get(attr) == vals[mEq.group(2)]
        raise AssertionError(f"Unsupported ConditionExpression: {cond}")

    def _applyUpdate(self, key: dict, expr: str, names: dict | None, vals: dict | None) -> dict:
        item = deepcopy(self.rows.get((key["PK"], key["SK"])) or dict(key))
        names = names or {}
        vals = vals or {}

        # Split clauses: SET ..., ADD ..., REMOVE ...
        clauses = re.split(r"\b(SET|ADD|REMOVE)\b", expr.strip())
        curOp = None
        for part in clauses:
            part = part.strip()
            if not part:
                continue
            if part in ("SET", "ADD", "REMOVE"):
                curOp = part
                continue
            if curOp == "SET":
                for assign in re.split(r",(?![^()]*\))", part):
                    lhs, rhs = [x.strip() for x in assign.split("=", 1)]
                    attr = self._resolveName(lhs, names)
                    mIfe = re.match(r"^if_not_exists\((\S+?),\s*(:\w+)\)$", rhs)
                    if mIfe:
                        chkAttr = self._resolveName(mIfe.group(1), names)
                        if chkAttr not in item:
                            item[attr] = vals[mIfe.group(2)]
                    else:
                        item[attr] = vals[rhs]
            elif curOp == "ADD":
                for addExpr in part.split(","):
                    lhs, rhs = addExpr.strip().split()
                    attr = self._resolveName(lhs, names)
                    cur = item.get(attr, 0)
                    item[attr] = cur + vals[rhs]
            elif curOp == "REMOVE":
                for remAttr in part.split(","):
                    attr = self._resolveName(remAttr.strip(), names)
                    item.pop(attr, None)

        # Enforce real boto3 TypeSerializer (rejects bare floats).
        for v in item.values():
            _SER.serialize(v)
        self.rows[(item["PK"], item["SK"])] = item
        return deepcopy(item)

    # Table-API methods
    def get_item(self, Key):
        row = self.rows.get((Key["PK"], Key["SK"]))
        return {"Item": deepcopy(row)} if row is not None else {}

    def put_item(self, Item, ConditionExpression=None, ExpressionAttributeNames=None, ExpressionAttributeValues=None):
        for v in Item.values():
            _SER.serialize(v)
        k = (Item["PK"], Item["SK"])
        if not self._checkCond(ConditionExpression, self.rows.get(k), ExpressionAttributeNames, ExpressionAttributeValues):
            raise self._condErr()
        self.rows[k] = deepcopy(Item)
        return {}

    def update_item(
        self,
        Key,
        UpdateExpression,
        ConditionExpression=None,
        ExpressionAttributeNames=None,
        ExpressionAttributeValues=None,
        ReturnValues="NONE",
    ):
        for v in (ExpressionAttributeValues or {}).values():
            _SER.serialize(v)
        k = (Key["PK"], Key["SK"])
        if not self._checkCond(ConditionExpression, self.rows.get(k), ExpressionAttributeNames, ExpressionAttributeValues):
            raise self._condErr()
        updated = self._applyUpdate(Key, UpdateExpression, ExpressionAttributeNames, ExpressionAttributeValues)
        if ReturnValues in ("ALL_NEW", "UPDATED_NEW"):
            return {"Attributes": updated}
        return {}

    def delete_item(self, Key, ConditionExpression=None, ExpressionAttributeNames=None, ExpressionAttributeValues=None):
        k = (Key["PK"], Key["SK"])
        if not self._checkCond(ConditionExpression, self.rows.get(k), ExpressionAttributeNames, ExpressionAttributeValues):
            raise self._condErr()
        self.rows.pop(k, None)
        return {}

    def query(
        self,
        KeyConditionExpression,
        IndexName=None,
        FilterExpression=None,
        ProjectionExpression=None,
        ScanIndexForward=True,
        Limit=None,
        ExclusiveStartKey=None,
    ):
        matched = [deepcopy(r) for r in self.rows.values() if self._evalKeyCond(KeyConditionExpression, r)]
        if IndexName == "byFetchDue":
            matched.sort(key=lambda r: (r.get("nextFetchAt", ""), r["PK"], r["SK"]), reverse=not ScanIndexForward)
        else:
            matched.sort(key=lambda r: r["SK"], reverse=not ScanIndexForward)

        if ExclusiveStartKey is not None:
            esk = (ExclusiveStartKey["PK"], ExclusiveStartKey["SK"])
            idx = next((i for i, r in enumerate(matched) if (r["PK"], r["SK"]) == esk), None)
            matched = matched[idx + 1 :] if idx is not None else []

        lek = None
        if Limit is not None and len(matched) > Limit:
            page = matched[:Limit]
            last = page[-1]
            lek = {"PK": last["PK"], "SK": last["SK"]}
            if IndexName == "byFetchDue":
                lek["fetchKey"] = last["fetchKey"]
                lek["nextFetchAt"] = last["nextFetchAt"]
        else:
            page = matched

        if FilterExpression is not None:
            page = [r for r in page if self._evalKeyCond(FilterExpression, r)]

        out = {"Items": page}
        if lek is not None:
            out["LastEvaluatedKey"] = lek
        return out

    # Low-level client methods
    def transact_write_items(self, TransactItems):
        staged = deepcopy(self.rows)
        try:
            for idx, tx in enumerate(TransactItems):
                reasons = [{"Code": "None"} for _ in TransactItems]
                reasons[idx] = {"Code": "ConditionalCheckFailed"}
                if "ConditionCheck" in tx:
                    op = tx["ConditionCheck"]
                    key = {k: _DESER.deserialize(v) for k, v in op["Key"].items()}
                    vals = {k: _DESER.deserialize(v) for k, v in (op.get("ExpressionAttributeValues") or {}).items()}
                    k = (key["PK"], key["SK"])
                    if not self._checkCond(op.get("ConditionExpression"), self.rows.get(k), op.get("ExpressionAttributeNames"), vals):
                        raise self._condErr("TransactionCanceledException", reasons)
                elif "Put" in tx:
                    op = tx["Put"]
                    item = {k: _DESER.deserialize(v) for k, v in op["Item"].items()}
                    vals = {k: _DESER.deserialize(v) for k, v in (op.get("ExpressionAttributeValues") or {}).items()}
                    k = (item["PK"], item["SK"])
                    if not self._checkCond(op.get("ConditionExpression"), self.rows.get(k), op.get("ExpressionAttributeNames"), vals):
                        raise self._condErr("TransactionCanceledException", reasons)
                    self.rows[k] = item
                elif "Delete" in tx:
                    op = tx["Delete"]
                    key = {k: _DESER.deserialize(v) for k, v in op["Key"].items()}
                    vals = {k: _DESER.deserialize(v) for k, v in (op.get("ExpressionAttributeValues") or {}).items()}
                    k = (key["PK"], key["SK"])
                    if not self._checkCond(op.get("ConditionExpression"), self.rows.get(k), op.get("ExpressionAttributeNames"), vals):
                        raise self._condErr("TransactionCanceledException", reasons)
                    self.rows.pop(k, None)
                elif "Update" in tx:
                    op = tx["Update"]
                    key = {k: _DESER.deserialize(v) for k, v in op["Key"].items()}
                    vals = {k: _DESER.deserialize(v) for k, v in (op.get("ExpressionAttributeValues") or {}).items()}
                    k = (key["PK"], key["SK"])
                    if not self._checkCond(op.get("ConditionExpression"), self.rows.get(k), op.get("ExpressionAttributeNames"), vals):
                        raise self._condErr("TransactionCanceledException", reasons)
                    self._applyUpdate(key, op["UpdateExpression"], op.get("ExpressionAttributeNames"), vals)
        except Exception:
            self.rows = staged
            raise

    def batch_get_item(self, RequestItems):
        keys = RequestItems[self.tableName]["Keys"]
        found = []
        for avKey in keys:
            k = (_DESER.deserialize(avKey["PK"]), _DESER.deserialize(avKey["SK"]))
            row = self.rows.get(k)
            if row is not None:
                found.append({attr: _SER.serialize(val) for attr, val in row.items()})
        return {"Responses": {self.tableName: found}, "UnprocessedKeys": {}}

    def batch_write_item(self, RequestItems):
        for req in RequestItems[self.tableName]:
            if "DeleteRequest" in req:
                avKey = req["DeleteRequest"]["Key"]
                self.rows.pop((_DESER.deserialize(avKey["PK"]), _DESER.deserialize(avKey["SK"])), None)
        return {"UnprocessedItems": {}}


@pytest.fixture
def fakeDb(monkeypatch):
    db = FakeDynamo()
    monkeypatch.setenv("FEEDS_TABLE", db.tableName)
    monkeypatch.setattr(storage, "_tbl", lambda: db)
    monkeypatch.setattr(storage, "_ddbClient", lambda: db)
    return db


def _jwtEvent(method, path, *, sub="user-a", body=None, qs=None, pathParams=None, withClaims=True):
    return {
        "rawPath": path,
        "requestContext": {
            "http": {"method": method, "path": path},
            "authorizer": {"jwt": {"claims": {"sub": sub}}} if withClaims else {},
        },
        "queryStringParameters": qs or {},
        "pathParameters": pathParams or {},
        "body": json.dumps(body) if isinstance(body, (dict, list)) else body,
    }


def _ingestEvent(body, *, apiKey=None, headers=None, isBase64=False):
    hdrs = dict(headers or {})
    if apiKey is not None:
        hdrs["x-api-key"] = apiKey
    return {
        "rawPath": "/feeds/ingest",
        "requestContext": {"http": {"method": "POST", "path": "/feeds/ingest"}},
        "headers": hdrs,
        "isBase64Encoded": isBase64,
        "body": json.dumps(body) if isinstance(body, (dict, list)) else body,
    }


def _resp(res):
    return res["statusCode"], json.loads(res["body"])


def test_decimal_choke_point_converts_floats_and_rejects_nan():
    converted = storage.toDynamoValue({"a": 1.25, "b": True, "c": 4, "nested": [{"x": 2.5}]})
    assert isinstance(converted["a"], Decimal) and converted["a"] == Decimal("1.25")
    assert converted["b"] is True
    assert type(converted["c"]) is int
    assert isinstance(converted["nested"][0]["x"], Decimal)

    # Confirm FakeDynamo rejects bare floats just like boto3
    db = FakeDynamo()
    with pytest.raises(TypeError, match="Float types are not supported"):
        db.put_item(Item={"PK": "P", "SK": "S", "bad": 3.14})

    with pytest.raises(ValueError, match="Non-finite"):
        storage.toDynamoValue(float("nan"))


def test_jwt_required_for_protected_routes(fakeDb):
    for method, path in [
        ("GET", "/feeds"),
        ("POST", "/feeds"),
        ("PUT", "/feeds/order"),
        ("GET", "/feeds/stars"),
        ("PUT", "/feeds/stars"),
        ("DELETE", "/feeds/stars"),
        ("GET", "/feeds/seen"),
        ("PUT", "/feeds/seen"),
        ("DELETE", "/feeds/seen"),
        ("GET", "/feeds/keys"),
        ("POST", "/feeds/keys"),
        ("DELETE", "/feeds/keys/abc"),
        ("GET", "/feeds/prefs"),
        ("PUT", "/feeds/prefs"),
        ("PUT", "/feeds/123"),
        ("DELETE", "/feeds/123"),
        ("POST", "/feeds/123/refresh"),
        ("GET", "/feeds/123/days"),
        ("GET", "/feeds/123/days/2026-11-19"),
    ]:
        code, body = _resp(routes.handler(_jwtEvent(method, path, withClaims=False), None))
        assert code == 401
        assert body["error"] == "unauthorized"


def test_polled_feed_autodiscovery_initial_ingest_dedup_and_refresh(fakeDb):
    rssXml = b"""<?xml version="1.0"?>
    <rss version="2.0"><channel><title>Cool Blog</title><link>https://cool.example</link>
      <item><guid>g1</guid><title>First</title><link>https://cool.example/1</link><pubDate>Thu, 19 Nov 2026 18:00:00 GMT</pubDate><description>Hello</description></item>
    </channel></rss>"""
    parsed = parseFeed(rssXml, url="https://cool.example/rss.xml")
    fetchRes = FetchResult(200, "https://cool.example/rss.xml", "application/rss+xml", rssXml, '"e1"', "lm1", False)

    with patch("feeds.routes.fetchAndDiscoverFeed", return_value=("https://cool.example/rss.xml", parsed, fetchRes)):
        code, data = _resp(routes.handler(_jwtEvent("POST", "/feeds", body={"url": "https://cool.example"}), None))
        assert code == 201
        feedId = data["feed"]["feedId"]
        assert data["feed"]["title"] == "Cool Blog"
        assert data["feed"]["url"] == "https://cool.example/rss.xml"
        assert data["itemsAdded"] == 1

        # Duplicate URL returns 409
        codeDup, dupData = _resp(routes.handler(_jwtEvent("POST", "/feeds", body={"url": "https://cool.example/rss.xml"}), None))
        assert codeDup == 409
        assert dupData["feedId"] == feedId

    # Refresh 304 Not Modified
    with patch("feeds.routes.fetchUrl", return_value=FetchResult(304, "https://cool.example/rss.xml", "", b"", '"e2"', "lm1", True)):
        code, ref = _resp(routes.handler(_jwtEvent("POST", f"/feeds/{feedId}/refresh"), None))
        assert code == 200
        assert ref["notModified"] is True
        assert ref["itemsAdded"] == 0
        assert ref["feed"]["etag"] == '"e2"'

    # Refresh 502 records error
    from feeds.fetch import FeedFetchError

    with patch("feeds.routes.fetchUrl", side_effect=FeedFetchError("Upstream 503", statusCode=503)):
        code, err = _resp(routes.handler(_jwtEvent("POST", f"/feeds/{feedId}/refresh"), None))
        assert code == 502
        assert "503" in err["error"]

    code, listed = _resp(routes.handler(_jwtEvent("GET", "/feeds"), None))
    assert code == 200
    assert listed["feeds"][0]["lastError"] == "Upstream 503"
    assert listed["feeds"][0]["failCount"] == 1

    # Subsequent successful refresh clears lastError and resets failCount
    rssXml2 = b"""<?xml version="1.0"?>
    <rss version="2.0"><channel><title>Cool Blog</title><item><guid>g2</guid><title>Second</title><pubDate>Thu, 19 Nov 2026 19:00:00 GMT</pubDate></item></channel></rss>"""
    with patch("feeds.routes.fetchUrl", return_value=FetchResult(200, "https://cool.example/rss.xml", "application/rss+xml", rssXml2, '"e3"', None, False)):
        code, ref2 = _resp(routes.handler(_jwtEvent("POST", f"/feeds/{feedId}/refresh"), None))
        assert code == 200
        assert ref2["itemsAdded"] == 1
        assert "lastError" not in ref2["feed"]
        assert ref2["feed"]["failCount"] == 0


def test_feed_pinning_drag_reorder_and_cross_tenant_isolation(fakeDb):
    c1, f1 = _resp(routes.handler(_jwtEvent("POST", "/feeds", sub="user-a", body={"kind": "push", "title": "Alpha", "slug": "alpha"}), None))
    c2, f2 = _resp(routes.handler(_jwtEvent("POST", "/feeds", sub="user-a", body={"kind": "push", "title": "Beta", "slug": "beta"}), None))
    c3, f3 = _resp(routes.handler(_jwtEvent("POST", "/feeds", sub="user-a", body={"kind": "push", "title": "Gamma", "slug": "gamma"}), None))
    assert (c1, c2, c3) == (201, 201, 201)
    id1, id2, id3 = f1["feed"]["feedId"], f2["feed"]["feedId"], f3["feed"]["feedId"]

    # Duplicate slug blocked with 409 for same user, allowed for user-b
    cDup, _ = _resp(routes.handler(_jwtEvent("POST", "/feeds", sub="user-a", body={"kind": "push", "title": "Alpha 2", "slug": "alpha"}), None))
    assert cDup == 409
    cOther, fOther = _resp(routes.handler(_jwtEvent("POST", "/feeds", sub="user-b", body={"kind": "push", "title": "Alpha B", "slug": "alpha"}), None))
    assert cOther == 201

    # Drag-and-drop reorder: Gamma, Alpha, Beta
    code, ordBody = _resp(routes.handler(_jwtEvent("PUT", "/feeds/order", sub="user-a", body={"feedIds": [id3, id1, id2]}), None))
    assert code == 200
    assert ordBody["feedIds"] == [id3, id1, id2]

    # Pin Beta -> pinned feeds sort before unpinned regardless of sortOrder
    code, upd = _resp(routes.handler(_jwtEvent("PUT", f"/feeds/{id2}", sub="user-a", body={"pinned": True, "title": "Beta Pinned"}), None))
    assert code == 200
    assert upd["feed"]["pinned"] is True

    _, listed = _resp(routes.handler(_jwtEvent("GET", "/feeds", sub="user-a"), None))
    assert [f["feedId"] for f in listed["feeds"]] == [id2, id3, id1]

    # Cross-tenant isolation: user-b cannot access or reorder user-a's feeds (404)
    assert _resp(routes.handler(_jwtEvent("PUT", f"/feeds/{id1}", sub="user-b", body={"title": "Hacked"}), None))[0] == 404
    assert _resp(routes.handler(_jwtEvent("DELETE", f"/feeds/{id1}", sub="user-b"), None))[0] == 404
    assert _resp(routes.handler(_jwtEvent("POST", f"/feeds/{id1}/refresh", sub="user-b"), None))[0] == 404
    assert _resp(routes.handler(_jwtEvent("GET", f"/feeds/{id1}/days", sub="user-b"), None))[0] == 404
    assert _resp(routes.handler(_jwtEvent("GET", f"/feeds/{id1}/days/2026-11-19", sub="user-b"), None))[0] == 404
    assert _resp(routes.handler(_jwtEvent("PUT", "/feeds/order", sub="user-b", body={"feedIds": [fOther["feed"]["feedId"], id1]}), None))[0] == 404


def test_api_keys_and_mox_ingest_overwrite_rate_limit_and_stars(fakeDb):
    # Create API key (rawKey returned once)
    code, keyResp = _resp(routes.handler(_jwtEvent("POST", "/feeds/keys", sub="user-a", body={"name": "Mox"}), None))
    assert code == 201
    rawKey = keyResp["rawKey"]
    keyId = keyResp["key"]["keyId"]
    assert rawKey.startswith("fusf_")

    # GET /feeds/keys never returns keyHash or rawKey
    _, keysList = _resp(routes.handler(_jwtEvent("GET", "/feeds/keys", sub="user-a"), None))
    assert len(keysList["keys"]) == 1
    assert "keyHash" not in keysList["keys"][0]
    assert "rawKey" not in keysList["keys"][0]

    # Bad key -> 401
    assert _resp(routes.handler(_ingestEvent({"feed": "mox-todoist", "items": [{"title": "x"}]}, apiKey="bad"), None))[0] == 401

    # Oversize body (> 256 KB) -> 413
    hugeBody = json.dumps({"feed": "mox-todoist", "items": [{"title": "x", "contentMarkdown": "a" * (260 * 1024)}]})
    assert _resp(routes.handler(_ingestEvent(hugeBody, apiKey=rawKey), None))[0] == 413

    # Ingest Mox summary + second events feed (multi-slug per user)
    code, ing1 = _resp(
        routes.handler(
            _ingestEvent(
                {
                    "feed": "mox-todoist",
                    "title": "Mox · Todoist",
                    "date": "2026-11-19",
                    "items": [
                        {
                            "guid": "todoist-2026-11-19",
                            "title": "Todoist — 2026-11-19",
                            "contentMarkdown": "*Today*\n• <https://todoist.com/showTask?id=1|Ship feeds>",
                        }
                    ],
                },
                apiKey=rawKey,
            ),
            None,
        )
    )
    assert code == 200
    assert ing1["created"] is True
    assert ing1["itemsAdded"] == 1
    moxFeedId = ing1["feedId"]

    # Re-ingest same guid on same day -> overwrites content, does NOT bump DAYIDX count
    code, ing2 = _resp(
        routes.handler(
            _ingestEvent(
                {
                    "feed": "mox-todoist",
                    "date": "2026-11-19",
                    "items": [
                        {
                            "guid": "todoist-2026-11-19",
                            "title": "Todoist — 2026-11-19 (fixed)",
                            "contentMarkdown": "*Fixed* summary",
                        }
                    ],
                },
                apiKey=rawKey,
            ),
            None,
        )
    )
    assert code == 200
    assert ing2["created"] is False
    assert ing2["itemsAdded"] == 0
    assert ing2["itemsUpdated"] == 1

    _, daysPage = _resp(routes.handler(_jwtEvent("GET", f"/feeds/{moxFeedId}/days", sub="user-a"), None))
    assert daysPage["days"] == [{"day": "2026-11-19", "count": 1}]

    # Re-ingest same guid with a corrected date -> moves DAYIDX count cleanly
    code, ingMove = _resp(
        routes.handler(
            _ingestEvent(
                {
                    "feed": "mox-todoist",
                    "date": "2026-11-18",
                    "items": [
                        {
                            "guid": "todoist-2026-11-19",
                            "title": "Todoist — moved",
                            "contentMarkdown": "Moved day",
                        }
                    ],
                },
                apiKey=rawKey,
            ),
            None,
        )
    )
    assert code == 200 and ingMove["itemsUpdated"] == 1
    _, daysAfterMove = _resp(routes.handler(_jwtEvent("GET", f"/feeds/{moxFeedId}/days", sub="user-a"), None))
    assert daysAfterMove["days"] == [{"day": "2026-11-18", "count": 1}]

    # Second feed slug auto-created cleanly (e.g. mox-jinks-email-events)
    _, ingEvents = _resp(
        routes.handler(
            _ingestEvent(
                {
                    "feed": "mox-jinks-email-events",
                    "items": [
                        {
                            "guid": "ev-1",
                            "title": "Events",
                            "publishedAt": "2026-11-19T15:30:00Z",
                            "contentMarkdown": "Tickets ready",
                        }
                    ],
                },
                apiKey=rawKey,
            ),
            None,
        )
    )
    assert ingEvents["created"] is True
    assert ingEvents["feedId"] != moxFeedId

    # Verify day items ordering + starring a Mox summary (no external link)
    _, dayItems = _resp(routes.handler(_jwtEvent("GET", f"/feeds/{moxFeedId}/days/2026-11-18", sub="user-a"), None))
    assert len(dayItems["items"]) == 1
    itemSk = dayItems["items"][0]["itemSk"]
    assert dayItems["items"][0]["title"] == "Todoist — moved"
    assert dayItems["items"][0]["starred"] is False

    # Star
    cStar, starResp = _resp(routes.handler(_jwtEvent("PUT", "/feeds/stars", sub="user-a", body={"feedId": moxFeedId, "itemSk": itemSk}), None))
    assert cStar == 200 and starResp["starred"] is True
    assert starResp["star"]["day"] == "2026-11-18"
    assert "link" not in starResp["star"]

    _, dayItemsAfter = _resp(routes.handler(_jwtEvent("GET", f"/feeds/{moxFeedId}/days/2026-11-18", sub="user-a"), None))
    assert dayItemsAfter["items"][0]["starred"] is True

    _, starsList = _resp(routes.handler(_jwtEvent("GET", "/feeds/stars", sub="user-a"), None))
    assert len(starsList["items"]) == 1

    # Delete feed, then verify unstar STILL works via query params
    assert _resp(routes.handler(_jwtEvent("DELETE", f"/feeds/{moxFeedId}", sub="user-a"), None))[0] == 200
    cUnstar, _ = _resp(
        routes.handler(_jwtEvent("DELETE", "/feeds/stars", sub="user-a", qs={"feedId": moxFeedId, "itemSk": itemSk}), None)
    )
    assert cUnstar == 200
    assert _resp(routes.handler(_jwtEvent("GET", "/feeds/stars", sub="user-a"), None))[1]["items"] == []

    # Revoke API key -> 401 on subsequent ingest (cross-user revoke returns 404 first)
    assert _resp(routes.handler(_jwtEvent("DELETE", f"/feeds/keys/{keyId}", sub="user-b"), None))[0] == 404
    assert _resp(routes.handler(_jwtEvent("DELETE", f"/feeds/keys/{keyId}", sub="user-a"), None))[0] == 200
    assert _resp(routes.handler(_ingestEvent({"feed": "mox-todoist", "items": [{"title": "late"}]}, apiKey=rawKey), None))[0] == 401


def test_ingest_rate_limit_429_and_prefs(fakeDb):
    _, keyResp = _resp(routes.handler(_jwtEvent("POST", "/feeds/keys", sub="user-a", body={"name": "RL"}), None))
    rawKey = keyResp["rawKey"]
    keyId = keyResp["key"]["keyId"]

    with patch.object(storage, "checkRateLimit", return_value=False):
        code, body = _resp(routes.handler(_ingestEvent({"feed": "mox-todoist", "items": [{"title": "x"}]}, apiKey=rawKey), None))
        assert code == 429
        assert "Rate limit" in body["error"]

    # Prefs GET / PUT
    assert _resp(routes.handler(_jwtEvent("GET", "/feeds/prefs", sub="user-a"), None))[1]["tz"] == "America/Los_Angeles"
    assert _resp(routes.handler(_jwtEvent("PUT", "/feeds/prefs", sub="user-a", body={"tz": "Bad/Zone"}), None))[0] == 400
    code, prefs = _resp(routes.handler(_jwtEvent("PUT", "/feeds/prefs", sub="user-a", body={"tz": "America/New_York"}), None))
    assert code == 200 and prefs["tz"] == "America/New_York"

    # Real checkRateLimit counter test
    for _ in range(60):
        assert storage.checkRateLimit(keyId, limitPerMin=60) is True
    assert storage.checkRateLimit(keyId, limitPerMin=60) is False


def test_days_pagination_cursor_validation_and_large_feed_cleanup(fakeDb):
    _, fResp = _resp(routes.handler(_jwtEvent("POST", "/feeds", sub="user-a", body={"kind": "push", "title": "Archive", "slug": "arch"}), None))
    feedId = fResp["feed"]["feedId"]

    items = [
        {
            "itemHash": f"h{i:03d}",
            "day": f"2026-11-{(i % 20) + 1:02d}",
            "title": f"Item {i}",
            "summary": "s",
            "contentHtml": "<p>s</p>",
            "publishedAt": f"2026-11-{(i % 20) + 1:02d}T12:00:00Z",
            "fetchedAt": "2026-11-20T00:00:00Z",
        }
        for i in range(15)
    ]
    added, _ = storage.upsertItems("user-a", feedId, items, allowOverwrite=False)
    assert added == 15

    # Paginate days
    code, p1 = _resp(routes.handler(_jwtEvent("GET", f"/feeds/{feedId}/days", sub="user-a", qs={"limit": "5"}), None))
    assert code == 200 and len(p1["days"]) == 5 and p1["nextCursor"]
    assert p1["days"][0]["day"] == "2026-11-15"

    # Tampered cursor targeting another user's partition -> 400
    assert _resp(routes.handler(_jwtEvent("GET", f"/feeds/{feedId}/days", sub="user-a", qs={"cursor": "bad!!!"}), None))[0] == 400

    # Delete with small sync cap -> queues CLEANUP job, then sweep finishes it
    assert storage.deleteFeed("user-a", feedId, maxSyncDelete=5) is True
    assert ("CLEANUP", f"FEED#user-a#{feedId}") in fakeDb.rows
    cleaned = storage.sweepDeletedFeedCleanup(maxDeletes=500)
    assert cleaned > 0
    assert ("CLEANUP", f"FEED#user-a#{feedId}") not in fakeDb.rows


def test_review_remediations_races_validation_cursors_limits_and_resubscribe(fakeDb):
    import base64
    from datetime import datetime, timezone

    # 1. Delete-during-poll/ingest/prefs/key-touch races must NEVER resurrect zombie rows
    _, fPush = _resp(routes.handler(_jwtEvent("POST", "/feeds", sub="user-a", body={"kind": "push", "title": "Race", "slug": "race"}), None))
    pushId = fPush["feed"]["feedId"]
    assert storage.deleteFeed("user-a", pushId) is True

    storage.recordFetchSuccess("user-a", pushId, etag='"x"', lastModified=None, lastItemAt="2026-11-19T10:00:00Z")
    storage.recordFetchFailure("user-a", pushId, errorMessage="timeout", failCount=1)
    storage.touchPushFeedActivity("user-a", pushId, lastItemAt="2026-11-19T10:00:00Z")
    storage.touchApiKeyLastUsed("user-a", "missing-key")
    code, feedsBody = _resp(routes.handler(_jwtEvent("GET", "/feeds", sub="user-a"), None))
    assert code == 200 and feedsBody["feeds"] == []

    # 2. Polled feed: subscribe -> verify 55m nextFetchAt -> refresh clears stale etag -> delete -> re-subscribe succeeds
    rssXml = b'<?xml version="1.0"?><rss version="2.0"><channel><title>P</title><item><guid>1</guid><title>One</title><pubDate>Thu, 19 Nov 2026 18:00:00 GMT</pubDate></item></channel></rss>'
    parsed = parseFeed(rssXml, url="https://p.example/rss.xml")
    with patch("feeds.routes.fetchAndDiscoverFeed", return_value=("https://p.example/rss.xml", parsed, FetchResult(200, "https://p.example/rss.xml", "application/rss+xml", rssXml, '"e1"', "lm1", False))):
        cAdd, added = _resp(routes.handler(_jwtEvent("POST", "/feeds", sub="user-a", body={"url": "https://p.example/rss.xml"}), None))
        assert cAdd == 201
        polledId = added["feed"]["feedId"]

    nextFetch = datetime.fromisoformat(added["feed"]["nextFetchAt"].replace("Z", "+00:00"))
    deltaMin = (nextFetch - datetime.now(timezone.utc)).total_seconds() / 60.0
    assert 50.0 <= deltaMin <= 56.0

    # Refresh returning 200 WITHOUT etag/last-modified clears stale etag & lastModified
    with patch("feeds.routes.fetchUrl", return_value=FetchResult(200, "https://p.example/rss.xml", "application/rss+xml", rssXml, None, None, False)):
        cRef, refBody = _resp(routes.handler(_jwtEvent("POST", f"/feeds/{polledId}/refresh", sub="user-a"), None))
        assert cRef == 200
        assert "etag" not in refBody["feed"]
        assert "lastModified" not in refBody["feed"]

    # Delete and re-subscribe same URL succeeds
    assert _resp(routes.handler(_jwtEvent("DELETE", f"/feeds/{polledId}", sub="user-a"), None))[0] == 200
    with patch("feeds.routes.fetchAndDiscoverFeed", return_value=("https://p.example/rss.xml", parsed, FetchResult(200, "https://p.example/rss.xml", "application/rss+xml", rssXml, None, None, False))):
        cReAdd, _ = _resp(routes.handler(_jwtEvent("POST", "/feeds", sub="user-a", body={"url": "https://p.example/rss.xml"}), None))
        assert cReAdd == 201

    # 3. Starring non-item SKs (DAYIDX# / GUID#) returns 400 (not 500), cross-user returns 404
    _, p2 = _resp(routes.handler(_jwtEvent("POST", "/feeds", sub="user-a", body={"kind": "push", "title": "Mox", "slug": "mox-x"}), None))
    moxId = p2["feed"]["feedId"]
    assert _resp(routes.handler(_jwtEvent("PUT", "/feeds/stars", sub="user-a", body={"feedId": moxId, "itemSk": "DAYIDX#2026-11-19"}), None))[0] == 400
    assert _resp(routes.handler(_jwtEvent("PUT", "/feeds/stars", sub="user-a", body={"feedId": moxId, "itemSk": "GUID#deadbeef"}), None))[0] == 400
    validShapeSk = "DAY#2026-11-19#ITEM#" + ("a" * 24)
    assert _resp(routes.handler(_jwtEvent("PUT", "/feeds/stars", sub="user-b", body={"feedId": moxId, "itemSk": validShapeSk}), None))[0] == 404

    # 4. Tampered base64 JSON cursor checks: foreign PK, wrong SK prefix, extra keys -> 400
    for badCursorObj in [
        {"PK": "FEED#user-b#" + moxId, "SK": "DAYIDX#2026-11-19"},
        {"PK": f"FEED#user-a#{moxId}", "SK": "DAY#2026-11-19#ITEM#" + ("a" * 24)},
        {"PK": f"FEED#user-a#{moxId}", "SK": "DAYIDX#2026-11-19", "extra": 1},
    ]:
        tok = base64.urlsafe_b64encode(json.dumps(badCursorObj).encode()).decode()
        assert _resp(routes.handler(_jwtEvent("GET", f"/feeds/{moxId}/days", sub="user-a", qs={"cursor": tok}), None))[0] == 400

    # 5. MAX_ACTIVE_KEYS (20) enforcement + base64 ingest + validation + non-regressing lastItemAt
    keys = []
    for idx in range(storage.MAX_ACTIVE_KEYS):
        ck, kr = _resp(routes.handler(_jwtEvent("POST", "/feeds/keys", sub="user-a", body={"name": f"K{idx}"}), None))
        assert ck == 201
        keys.append(kr["rawKey"])
    assert _resp(routes.handler(_jwtEvent("POST", "/feeds/keys", sub="user-a", body={"name": "K21"}), None))[0] == 400

    apiKey = keys[0]
    # Invalid calendar date, >100 items, javascript link, invalid publishedAt
    assert _resp(routes.handler(_ingestEvent({"feed": "mox-x", "date": "2026-02-31", "items": [{"title": "x"}]}, apiKey=apiKey), None))[0] == 400
    assert _resp(routes.handler(_ingestEvent({"feed": "mox-x", "items": [{"title": "x"}] * 101}, apiKey=apiKey), None))[0] == 400
    assert _resp(routes.handler(_ingestEvent({"feed": "mox-x", "items": [{"title": "x", "link": "javascript:alert(1)"}]}, apiKey=apiKey), None))[0] == 400
    assert _resp(routes.handler(_ingestEvent({"feed": "mox-x", "items": [{"title": "x", "publishedAt": "not-a-date"}]}, apiKey=apiKey), None))[0] == 400

    # Base64-encoded ingest + Slack mrkdwn summary extraction + backfill non-regressing lastItemAt
    payloadB64 = base64.b64encode(
        json.dumps(
            {
                "feed": "mox-x",
                "items": [
                    {
                        "guid": "recent-1",
                        "title": "Recent",
                        "publishedAt": "2026-11-19T12:00:00Z",
                        "summary": "<https://todoist.com/1|Pay rent>",
                    }
                ],
            }
        ).encode("utf-8")
    ).decode("ascii")
    cB64, _ = _resp(routes.handler(_ingestEvent(payloadB64, apiKey=apiKey, isBase64=True), None))
    assert cB64 == 200

    _, dayRecent = _resp(routes.handler(_jwtEvent("GET", f"/feeds/{moxId}/days/2026-11-19", sub="user-a"), None))
    assert dayRecent["items"][0]["summary"] == "Pay rent"

    # Backfill older item must NOT regress lastItemAt
    _resp(
        routes.handler(
            _ingestEvent(
                {
                    "feed": "mox-x",
                    "items": [{"guid": "old-1", "title": "Old", "publishedAt": "2026-10-01T12:00:00Z", "contentMarkdown": "old"}],
                },
                apiKey=apiKey,
            ),
            None,
        )
    )
    assert storage.getFeed("user-a", moxId)["lastItemAt"] == "2026-11-19T12:00:00Z"

    # 6. TransactionCanceledException with TransactionConflict is NOT swallowed by _isConditionFailure
    conflictErr = ClientError(
        {"Error": {"Code": "TransactionCanceledException"}, "CancellationReasons": [{"Code": "TransactionConflict"}]},
        "TransactWriteItems",
    )
    assert storage._isConditionFailure(conflictErr) is False
    condErr = ClientError(
        {"Error": {"Code": "TransactionCanceledException"}, "CancellationReasons": [{"Code": "ConditionalCheckFailed"}]},
        "TransactWriteItems",
    )
    assert storage._isConditionFailure(condErr) is True

    # 7. Concurrent day-move condition failure triggers retry without double-counting DAYIDX
    origTx = fakeDb.transact_write_items
    racedOnce = {"done": False}

    def racingTx(TransactItems):
        if not racedOnce["done"]:
            racedOnce["done"] = True
            # Simulate concurrent caller already moving the guid from 2026-11-19 to 2026-11-18
            _resp(
                routes.handler(
                    _ingestEvent(
                        {"feed": "mox-x", "date": "2026-11-18", "items": [{"guid": "recent-1", "title": "Moved first", "contentMarkdown": "a"}]},
                        apiKey=apiKey,
                    ),
                    None,
                )
            )
        return origTx(TransactItems)

    with patch.object(fakeDb, "transact_write_items", side_effect=racingTx):
        cRace, rRace = _resp(
            routes.handler(
                _ingestEvent(
                    {"feed": "mox-x", "date": "2026-11-17", "items": [{"guid": "recent-1", "title": "Moved second", "contentMarkdown": "b"}]},
                    apiKey=apiKey,
                ),
                None,
            )
        )
        assert cRace == 200 and rRace["itemsUpdated"] == 1

    _, daysRace = _resp(routes.handler(_jwtEvent("GET", f"/feeds/{moxId}/days", sub="user-a"), None))
    assert daysRace["days"] == [{"day": "2026-11-17", "count": 1}, {"day": "2026-10-01", "count": 1}]


def test_pass2_review_remediations_races_conflicts_cleanup_and_caps(fakeDb):
    import base64

    _, fResp = _resp(routes.handler(_jwtEvent("POST", "/feeds", sub="user-a", body={"kind": "push", "title": "Stars", "slug": "stars"}), None))
    feedId = fResp["feed"]["feedId"]
    _, kResp = _resp(routes.handler(_jwtEvent("POST", "/feeds/keys", sub="user-a", body={"name": "K"}), None))
    apiKey = kResp["rawKey"]

    _resp(
        routes.handler(
            _ingestEvent(
                {"feed": "stars", "date": "2026-11-19", "items": [{"guid": "s1", "title": "Item 1", "contentMarkdown": "body"}]},
                apiKey=apiKey,
            ),
            None,
        )
    )
    _, dayData = _resp(routes.handler(_jwtEvent("GET", f"/feeds/{feedId}/days/2026-11-19", sub="user-a"), None))
    itemSk = dayData["items"][0]["itemSk"]

    # 1. unstarItem stale-ref race: if another caller unstars + re-stars between read and tx, condition fails,
    #    re-reads the live starSk, and cleans up BOTH STARREF and live STAR# (no orphan STAR# row).
    storage.starItem("user-a", feedId, itemSk)
    origTx = fakeDb.transact_write_items
    unstarRace = {"fired": False}

    def raceDuringUnstar(TransactItems):
        isStarRefDelete = (
            len(TransactItems) == 2
            and "Delete" in TransactItems[0]
            and _DESER.deserialize(TransactItems[0]["Delete"]["Key"]["SK"]).startswith("STARREF#")
        )
        if isStarRefDelete and not unstarRace["fired"]:
            unstarRace["fired"] = True
            # Concurrent unstar + re-star creates a fresh starSk on STARREF
            origTx([
                {"Delete": {"TableName": fakeDb.tableName, "Key": TransactItems[0]["Delete"]["Key"]}},
                {"Delete": {"TableName": fakeDb.tableName, "Key": TransactItems[1]["Delete"]["Key"]}},
            ])
            with patch.object(storage, "_isoNowUtc", return_value="2026-11-19T23:59:59.999Z"):
                storage.starItem("user-a", feedId, itemSk)
        return origTx(TransactItems)

    with patch.object(fakeDb, "transact_write_items", side_effect=raceDuringUnstar):
        storage.unstarItem("user-a", feedId, itemSk)

    assert unstarRace["fired"] is True
    remainingStars = [k for k in fakeDb.rows if k[0] == "USER#user-a" and (k[1].startswith("STAR#") or k[1].startswith("STARREF#"))]
    assert remainingStars == []

    # 2. starItem concurrent unstar race: tx fails ConditionExpression, concurrent caller deletes STARREF before fallback read -> retries cleanly
    starRace = {"fired": False}

    def raceDuringStar(TransactItems):
        isStarPut = (
            len(TransactItems) == 2
            and "Put" in TransactItems[1]
            and _DESER.deserialize(TransactItems[1]["Put"]["Item"]["SK"]).startswith("STARREF#")
        )
        if isStarPut and not starRace["fired"]:
            starRace["fired"] = True
            starRefKey = _DESER.deserialize(TransactItems[1]["Put"]["Item"]["SK"])
            # Simulate pre-existing STARREF at tx time that vanishes right after ConditionFailure
            condErr = fakeDb._condErr("TransactionCanceledException", [{"Code": "None"}, {"Code": "ConditionalCheckFailed"}])
            fakeDb.rows.pop(("USER#user-a", starRefKey), None)
            raise condErr
        return origTx(TransactItems)

    with patch.object(fakeDb, "transact_write_items", side_effect=raceDuringStar):
        cStar, sBody = _resp(routes.handler(_jwtEvent("PUT", "/feeds/stars", sub="user-a", body={"feedId": feedId, "itemSk": itemSk}), None))
        assert cStar == 200 and sBody["starred"] is True

    # 3. TransactionConflict triggers retry and succeeds
    conflictCount = {"n": 0}

    def flakyConflict(TransactItems):
        if conflictCount["n"] < 2:
            conflictCount["n"] += 1
            raise fakeDb._condErr("TransactionCanceledException", [{"Code": "None"}, {"Code": "TransactionConflict"}])
        return origTx(TransactItems)

    with patch.object(fakeDb, "transact_write_items", side_effect=flakyConflict), patch.object(storage.time, "sleep"):
        cConf, bConf = _resp(
            routes.handler(
                _ingestEvent(
                    {"feed": "stars", "date": "2026-11-20", "items": [{"guid": "s2", "title": "Conflict OK", "contentMarkdown": "ok"}]},
                    apiKey=apiKey,
                ),
                None,
            )
        )
        assert cConf == 200 and bConf["itemsAdded"] == 1
        assert conflictCount["n"] == 2

    # 4. POST /feeds failure during upsertItems must NOT persist etag/lastModified
    rssXml = b'<?xml version="1.0"?><rss version="2.0"><channel><title>FailUpsert</title><item><guid>1</guid><title>One</title></item></channel></rss>'
    parsed = parseFeed(rssXml, url="https://failupsert.example/rss.xml")
    with (
        patch("feeds.routes.fetchAndDiscoverFeed", return_value=("https://failupsert.example/rss.xml", parsed, FetchResult(200, "https://failupsert.example/rss.xml", "application/rss+xml", rssXml, '"e-should-not-stick"', "Wed, 18 Nov 2026 00:00:00 GMT", False))),
        patch.object(storage, "upsertItems", side_effect=RuntimeError("boom")),
    ):
        with pytest.raises(RuntimeError, match="boom"):
            routes.handler(_jwtEvent("POST", "/feeds", sub="user-a", body={"url": "https://failupsert.example/rss.xml"}), None)

    createdFeeds = [f for f in storage.listFeeds("user-a") if f.get("url") == "https://failupsert.example/rss.xml"]
    assert len(createdFeeds) == 1
    assert "etag" not in createdFeeds[0]
    assert "lastModified" not in createdFeeds[0]

    # 5. deleteFeed writes CLEANUP atomically BEFORE sync deletes execute, and cleans it up when done
    sawCleanupDuringDelete = {"seen": False}
    origBatchDel = storage._batchDeleteKeys
    feedPk = f"FEED#user-a#{feedId}"

    def inspectBeforeBatchDelete(keys):
        if ("CLEANUP", feedPk) in fakeDb.rows:
            sawCleanupDuringDelete["seen"] = True
        return origBatchDel(keys)

    with patch.object(storage, "_batchDeleteKeys", side_effect=inspectBeforeBatchDelete):
        assert storage.deleteFeed("user-a", feedId) is True

    assert sawCleanupDuringDelete["seen"] is True
    assert ("CLEANUP", feedPk) not in fakeDb.rows

    # 6. Concurrent delete during upsertItems stops cleanly via ConditionCheck without writing orphan items
    _, fGoneResp = _resp(routes.handler(_jwtEvent("POST", "/feeds", sub="user-a", body={"kind": "push", "title": "Gone", "slug": "gone"}), None))
    goneId = fGoneResp["feed"]["feedId"]
    gonePk = f"FEED#user-a#{goneId}"
    storage.deleteFeed("user-a", goneId)
    addedGone, updatedGone = storage.upsertItems(
        "user-a",
        goneId,
        [
            {
                "itemHash": "a" * 24,
                "day": "2026-11-19",
                "title": "Orphan",
                "summary": "x",
                "contentHtml": "<p>x</p>",
                "publishedAt": "2026-11-19T12:00:00Z",
                "fetchedAt": "2026-11-19T12:00:00Z",
            }
        ],
        allowOverwrite=False,
    )
    assert (addedGone, updatedGone) == (0, 0)
    assert not any(k[0] == gonePk for k in fakeDb.rows)

    # 7. reorderFeeds concurrent delete raises FeedNotFoundError -> 404
    _, fOrdResp = _resp(routes.handler(_jwtEvent("POST", "/feeds", sub="user-a", body={"kind": "push", "title": "Ord", "slug": "ord"}), None))
    ordId = fOrdResp["feed"]["feedId"]
    with patch.object(fakeDb, "update_item", side_effect=fakeDb._condErr()):
        assert _resp(routes.handler(_jwtEvent("PUT", "/feeds/order", sub="user-a", body={"feedIds": [ordId]}), None))[0] == 404

    # 8. Oversize base64 payload returns 413 WITHOUT calling base64.b64decode
    bigB64 = "A" * (((routes.MAX_INGEST_BYTES + 2) // 3) * 4 + 32)
    with patch("feeds.routes.base64.b64decode", side_effect=AssertionError("should not decode oversize base64")):
        assert _resp(routes.handler(_ingestEvent(bigB64, apiKey=apiKey, isBase64=True), None))[0] == 413

    # 9. Dateless/guidless/linkless ingest posted twice at different timestamps deduplicates cleanly
    with patch.object(routes, "_isoNowUtc", side_effect=["2026-11-19T10:00:00Z", "2026-11-19T11:00:00Z"]):
        c1, r1 = _resp(routes.handler(_ingestEvent({"feed": "dateless", "items": [{"title": "Daily Summary", "contentMarkdown": "Same text"}]}, apiKey=apiKey), None))
        c2, r2 = _resp(routes.handler(_ingestEvent({"feed": "dateless", "items": [{"title": "Daily Summary", "contentMarkdown": "Same text"}]}, apiKey=apiKey), None))
    assert (c1, r1["itemsAdded"]) == (200, 1)
    assert (c2, r2["itemsAdded"], r2["itemsUpdated"]) == (200, 0, 1)

    # 10. Overlong IDs, out-of-range sortOrder, and overlong cursor SK are rejected cleanly
    longId = "x" * (routes.MAX_ID_LEN + 1)
    assert _resp(routes.handler(_jwtEvent("PUT", f"/feeds/{longId}", sub="user-a", body={"title": "ok"}), None))[0] == 404
    assert _resp(routes.handler(_jwtEvent("DELETE", f"/feeds/keys/{longId}", sub="user-a"), None))[0] == 404
    assert _resp(routes.handler(_jwtEvent("PUT", "/feeds/order", sub="user-a", body={"feedIds": [longId]}), None))[0] == 400
    assert _resp(routes.handler(_jwtEvent("PUT", f"/feeds/{ordId}", sub="user-a", body={"sortOrder": 2_000_000}), None))[0] == 400

    longCursor = base64.urlsafe_b64encode(
        json.dumps({"PK": f"FEED#user-a#{ordId}", "SK": "DAYIDX#" + ("9" * 1100)}).encode()
    ).decode()
    assert _resp(routes.handler(_jwtEvent("GET", f"/feeds/{ordId}/days", sub="user-a", qs={"cursor": longCursor}), None))[0] == 400


def test_seen_markers_persist_per_sub_isolate_dedupe_race_and_use_one_batch_get(fakeDb):
    """FUNK-100: per-item "seen" markers mirror stars (server-side, per Cognito sub)."""
    import base64

    # 0. Setup: push feed with one link-less item, plus an API key for ingest.
    _, fResp = _resp(routes.handler(_jwtEvent("POST", "/feeds", sub="user-a", body={"kind": "push", "title": "Seen Feed", "slug": "seen-feed"}), None))
    feedId = fResp["feed"]["feedId"]
    feedKind = fResp["feed"]["kind"]
    _, kResp = _resp(routes.handler(_jwtEvent("POST", "/feeds/keys", sub="user-a", body={"name": "K"}), None))
    apiKey = kResp["rawKey"]
    # Body is deliberately longer than 240 chars so the snippet truncation is exercised.
    longBody = ("alpha bravo charlie delta echo foxtrot " * 10).strip()
    assert len(longBody) > 240
    _resp(
        routes.handler(
            _ingestEvent(
                {"feed": "seen-feed", "date": "2026-11-19", "items": [{"guid": "v1", "title": "Item 1", "contentMarkdown": longBody}]},
                apiKey=apiKey,
            ),
            None,
        )
    )

    # "seen" must be a reserved feedId so /feeds/seen is never parsed as /feeds/{id}
    assert "seen" in routes._RESERVED_FEED_IDS
    assert _resp(routes.handler(_jwtEvent("POST", "/feeds/seen/refresh", sub="user-a"), None))[0] == 404

    # 1. Day view reports seen False initially
    code, dayData = _resp(routes.handler(_jwtEvent("GET", f"/feeds/{feedId}/days/2026-11-19", sub="user-a"), None))
    assert code == 200 and len(dayData["items"]) == 1
    itemSk = dayData["items"][0]["itemSk"]
    itemSummary = dayData["items"][0]["summary"]
    assert dayData["items"][0]["seen"] is False
    assert dayData["items"][0]["starred"] is False
    assert "link" not in dayData["items"][0]

    # 2. PUT /feeds/seen marks it; link-less item carries no "link" key
    cMark, markBody = _resp(routes.handler(_jwtEvent("PUT", "/feeds/seen", sub="user-a", body={"feedId": feedId, "itemSk": itemSk}), None))
    assert cMark == 200 and markBody["seen"] is True
    mark = markBody["seenItem"]
    assert mark["day"] == "2026-11-19"
    assert mark["title"] == "Item 1"
    assert mark["feedTitle"] == "Seen Feed"
    assert mark["feedKind"] == feedKind
    assert mark["feedId"] == feedId and mark["itemSk"] == itemSk
    assert len(itemSummary) > 240  # otherwise the next two assertions are no-ops
    assert len(mark["snippet"]) == 240
    assert mark["snippet"] == itemSummary[:240]
    assert "link" not in mark

    # seenSk is pinned against the ACTUAL stored row key and its component ORDER against
    # independently-known values (the feedId we created, the itemHash on the item row) --
    # NOT rebuilt out of the same response, which would still pass if the implementation
    # emitted SEEN#{seenAt}#{itemHash}#{feedId} and silently broke listSeen ordering.
    storedItem = fakeDb.rows[(f"FEED#user-a#{feedId}", itemSk)]
    storedSeenKeys = [k for k in fakeDb.rows if k[0] == "USER#user-a" and k[1].startswith("SEEN#")]
    assert len(storedSeenKeys) == 1
    assert mark["seenSk"] == storedSeenKeys[0][1]
    skParts = mark["seenSk"].split("#")
    assert len(skParts) == 4
    assert skParts[0] == "SEEN"
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", skParts[1])
    assert skParts[1] == fakeDb.rows[storedSeenKeys[0]]["seenAt"]
    assert feedId != storedItem["itemHash"]  # a feedId/itemHash swap must be detectable
    assert skParts[2] == feedId
    assert skParts[3] == storedItem["itemHash"]

    # Both rows live in the USER partition and write only string attributes (no bare floats)
    seenRows = {k: v for k, v in fakeDb.rows.items() if k[0] == "USER#user-a" and k[1].startswith("SEEN")}
    assert sorted(k[1].split("#", 1)[0] for k in seenRows) == ["SEEN", "SEENREF"]
    for rowKey, row in seenRows.items():
        for attrName, attrVal in row.items():
            assert isinstance(attrVal, str), f"{rowKey} attr {attrName} is {type(attrVal)}, expected str"
    refRow = fakeDb.rows[("USER#user-a", f"SEENREF#{feedId}#{itemSk}")]
    assert refRow["seenSk"] == mark["seenSk"] and refRow["seenAt"] == mark["seenAt"]

    # 3. Re-PUT is idempotent: same seenSk, exactly one SEEN# + one SEENREF# row
    _, markBody2 = _resp(routes.handler(_jwtEvent("PUT", "/feeds/seen", sub="user-a", body={"feedId": feedId, "itemSk": itemSk}), None))
    assert markBody2["seen"] is True
    assert markBody2["seenItem"]["seenSk"] == mark["seenSk"]
    assert len([k for k in fakeDb.rows if k[0] == "USER#user-a" and k[1].startswith("SEEN#")]) == 1
    assert len([k for k in fakeDb.rows if k[0] == "USER#user-a" and k[1].startswith("SEENREF#")]) == 1

    # 4. Re-reading the day view shows seen True (persisted server-side, not client state)
    _, dayAfter = _resp(routes.handler(_jwtEvent("GET", f"/feeds/{feedId}/days/2026-11-19", sub="user-a"), None))
    assert dayAfter["items"][0]["seen"] is True
    assert dayAfter["items"][0]["starred"] is False

    # 5. GET /feeds/seen returns the one item and NEVER leaks the SEENREF# row
    #    ("SEENREF#" does not begin_with "SEEN#": 5th byte 'R' != '#')
    cList, seenList = _resp(routes.handler(_jwtEvent("GET", "/feeds/seen", sub="user-a"), None))
    assert cList == 200
    assert seenList["nextCursor"] is None
    assert len(seenList["items"]) == 1
    assert seenList["items"][0]["seenSk"] == mark["seenSk"]
    assert all(not it["seenSk"].startswith("SEENREF#") for it in seenList["items"])
    assert ("USER#user-a", f"SEENREF#{feedId}#{itemSk}") in fakeDb.rows  # the ref row really exists

    # 6. Per-sub isolation: user-b sees nothing of user-a's, and cannot mark user-a's item
    _, seenListB = _resp(routes.handler(_jwtEvent("GET", "/feeds/seen", sub="user-b"), None))
    assert seenListB["items"] == []
    validShapeSk = "DAY#2026-11-19#ITEM#" + ("a" * 24)
    assert _resp(routes.handler(_jwtEvent("PUT", "/feeds/seen", sub="user-b", body={"feedId": feedId, "itemSk": validShapeSk}), None))[0] == 404
    assert _resp(routes.handler(_jwtEvent("PUT", "/feeds/seen", sub="user-b", body={"feedId": feedId, "itemSk": itemSk}), None))[0] == 404
    assert _resp(routes.handler(_jwtEvent("DELETE", "/feeds/seen", sub="user-b", qs={"feedId": feedId, "itemSk": itemSk}), None))[0] == 200
    assert _resp(routes.handler(_jwtEvent("GET", "/feeds/seen", sub="user-a"), None))[1]["items"][0]["seenSk"] == mark["seenSk"]

    # 7. DELETE unsets; day view flips back; list empties; a second DELETE is a 200 no-op
    cDel, delBody = _resp(routes.handler(_jwtEvent("DELETE", "/feeds/seen", sub="user-a", qs={"feedId": feedId, "itemSk": itemSk}), None))
    assert cDel == 200 and delBody["seen"] is False
    assert not [k for k in fakeDb.rows if k[0] == "USER#user-a" and k[1].startswith("SEEN")]
    _, dayUnseen = _resp(routes.handler(_jwtEvent("GET", f"/feeds/{feedId}/days/2026-11-19", sub="user-a"), None))
    assert dayUnseen["items"][0]["seen"] is False
    assert _resp(routes.handler(_jwtEvent("GET", "/feeds/seen", sub="user-a"), None))[1]["items"] == []
    cDel2, delBody2 = _resp(routes.handler(_jwtEvent("DELETE", "/feeds/seen", sub="user-a", body={"feedId": feedId, "itemSk": itemSk}), None))
    assert cDel2 == 200 and delBody2["seen"] is False

    # 8. Validation mirrors stars exactly
    assert _resp(routes.handler(_jwtEvent("PUT", "/feeds/seen", sub="user-a", body={"feedId": feedId, "itemSk": "DAYIDX#2026-11-19"}), None)) == (
        400,
        {"error": "Invalid itemSk"},
    )
    assert _resp(routes.handler(_jwtEvent("PUT", "/feeds/seen", sub="user-a", body={"feedId": feedId, "itemSk": "GUID#deadbeef"}), None))[0] == 400
    assert _resp(routes.handler(_jwtEvent("DELETE", "/feeds/seen", sub="user-a", qs={"feedId": feedId, "itemSk": "GUID#deadbeef"}), None))[0] == 400
    assert _resp(routes.handler(_jwtEvent("PUT", "/feeds/seen", sub="user-a", body={"feedId": feedId}), None)) == (
        400,
        {"error": "feedId and itemSk are required"},
    )
    assert _resp(routes.handler(_jwtEvent("DELETE", "/feeds/seen", sub="user-a", body={}), None)) == (
        400,
        {"error": "feedId and itemSk are required"},
    )
    longId = "x" * (routes.MAX_ID_LEN + 1)
    assert _resp(routes.handler(_jwtEvent("PUT", "/feeds/seen", sub="user-a", body={"feedId": longId, "itemSk": itemSk}), None)) == (
        400,
        {"error": "Invalid feedId"},
    )
    assert _resp(routes.handler(_jwtEvent("DELETE", "/feeds/seen", sub="user-a", qs={"feedId": longId, "itemSk": itemSk}), None))[0] == 400
    assert _resp(routes.handler(_jwtEvent("PUT", "/feeds/seen", sub="user-a", body="{not json"), None)) == (400, {"error": "Invalid JSON body"})
    assert _resp(routes.handler(_jwtEvent("DELETE", "/feeds/seen", sub="user-a", body="{not json"), None)) == (400, {"error": "Invalid JSON body"})

    # 9. Tampered cursors: foreign PK, wrong SK prefix (STAR#/SEENREF#), extra keys -> 400
    for badCursorObj in [
        {"PK": "USER#user-b", "SK": f"SEEN#2026-11-19T00:00:00.000Z#{feedId}#" + ("a" * 24)},
        {"PK": "USER#user-a", "SK": f"STAR#2026-11-19T00:00:00.000Z#{feedId}#" + ("a" * 24)},
        {"PK": "USER#user-a", "SK": f"SEENREF#{feedId}#{itemSk}"},
        {"PK": "USER#user-a", "SK": f"SEEN#2026-11-19T00:00:00.000Z#{feedId}#" + ("a" * 24), "extra": 1},
    ]:
        tok = base64.urlsafe_b64encode(json.dumps(badCursorObj).encode()).decode()
        assert _resp(routes.handler(_jwtEvent("GET", "/feeds/seen", sub="user-a", qs={"cursor": tok}), None))[0] == 400
    assert _resp(routes.handler(_jwtEvent("GET", "/feeds/seen", sub="user-a", qs={"cursor": "bad!!!"}), None))[0] == 400

    # 10. seen and starred are fully independent; an item can be both
    assert _resp(routes.handler(_jwtEvent("PUT", "/feeds/stars", sub="user-a", body={"feedId": feedId, "itemSk": itemSk}), None))[0] == 200
    _, dayStarOnly = _resp(routes.handler(_jwtEvent("GET", f"/feeds/{feedId}/days/2026-11-19", sub="user-a"), None))
    assert dayStarOnly["items"][0]["starred"] is True and dayStarOnly["items"][0]["seen"] is False
    assert _resp(routes.handler(_jwtEvent("GET", "/feeds/seen", sub="user-a"), None))[1]["items"] == []

    assert _resp(routes.handler(_jwtEvent("PUT", "/feeds/seen", sub="user-a", body={"feedId": feedId, "itemSk": itemSk}), None))[0] == 200
    _, dayBoth = _resp(routes.handler(_jwtEvent("GET", f"/feeds/{feedId}/days/2026-11-19", sub="user-a"), None))
    assert dayBoth["items"][0]["starred"] is True and dayBoth["items"][0]["seen"] is True

    # Unmarking seen leaves the star alone, and unstarring leaves seen alone
    assert _resp(routes.handler(_jwtEvent("DELETE", "/feeds/seen", sub="user-a", qs={"feedId": feedId, "itemSk": itemSk}), None))[0] == 200
    _, dayStarKept = _resp(routes.handler(_jwtEvent("GET", f"/feeds/{feedId}/days/2026-11-19", sub="user-a"), None))
    assert dayStarKept["items"][0]["starred"] is True and dayStarKept["items"][0]["seen"] is False
    assert _resp(routes.handler(_jwtEvent("PUT", "/feeds/seen", sub="user-a", body={"feedId": feedId, "itemSk": itemSk}), None))[0] == 200
    assert _resp(routes.handler(_jwtEvent("DELETE", "/feeds/stars", sub="user-a", qs={"feedId": feedId, "itemSk": itemSk}), None))[0] == 200
    _, daySeenKept = _resp(routes.handler(_jwtEvent("GET", f"/feeds/{feedId}/days/2026-11-19", sub="user-a"), None))
    assert daySeenKept["items"][0]["seen"] is True and daySeenKept["items"][0]["starred"] is False
    assert _resp(routes.handler(_jwtEvent("GET", "/feeds/stars", sub="user-a"), None))[1]["items"] == []
    assert len(_resp(routes.handler(_jwtEvent("GET", "/feeds/seen", sub="user-a"), None))[1]["items"]) == 1

    # 11. A MULTI-item day resolves both marker kinds in ONE _batchGetItems pass.
    #     (A one-item day could only ever report 1 call, so it pins nothing.)
    _resp(
        routes.handler(
            _ingestEvent(
                {
                    "feed": "seen-feed",
                    "date": "2026-11-18",
                    "items": [
                        {"guid": "m1", "title": "Multi 1", "contentMarkdown": "star only"},
                        {"guid": "m2", "title": "Multi 2", "contentMarkdown": "seen only"},
                        {"guid": "m3", "title": "Multi 3", "contentMarkdown": "both"},
                        {"guid": "m4", "title": "Multi 4", "contentMarkdown": "neither"},
                    ],
                },
                apiKey=apiKey,
            ),
            None,
        )
    )
    _, multiDay = _resp(routes.handler(_jwtEvent("GET", f"/feeds/{feedId}/days/2026-11-18", sub="user-a"), None))
    multiSks = {it["title"]: it["itemSk"] for it in multiDay["items"]}
    assert len(multiSks) == 4
    for title in ("Multi 1", "Multi 3"):
        assert _resp(routes.handler(_jwtEvent("PUT", "/feeds/stars", sub="user-a", body={"feedId": feedId, "itemSk": multiSks[title]}), None))[0] == 200
    for title in ("Multi 2", "Multi 3"):
        assert _resp(routes.handler(_jwtEvent("PUT", "/feeds/seen", sub="user-a", body={"feedId": feedId, "itemSk": multiSks[title]}), None))[0] == 200

    with (
        patch.object(storage, "_batchGetItems", wraps=storage._batchGetItems) as spyBatch,
        patch.object(fakeDb, "batch_get_item", wraps=fakeDb.batch_get_item) as spyRawBatch,
    ):
        cMulti, dayMulti = _resp(routes.handler(_jwtEvent("GET", f"/feeds/{feedId}/days/2026-11-18", sub="user-a"), None))
    assert cMulti == 200 and len(dayMulti["items"]) == 4
    # (a) one pass, (b) carrying 2 keys per item, (c) including BOTH ref kinds for the
    # same item -- this fails if anyone reintroduces a second batch pass.
    assert spyBatch.call_count == 1
    batchKeyArg = spyBatch.call_args.args[0]
    assert len(batchKeyArg) == 2 * len(dayMulti["items"]) == 8
    bothSk = multiSks["Multi 3"]
    assert {"PK": "USER#user-a", "SK": f"STARREF#{feedId}#{bothSk}"} in batchKeyArg
    assert {"PK": "USER#user-a", "SK": f"SEENREF#{feedId}#{bothSk}"} in batchKeyArg
    # 8 keys is one 100-key chunk, so exactly one raw batch_get_item (a >50-item day
    # would legitimately cost two chunks).
    assert spyRawBatch.call_count == 1
    # (d) per-item flags are right
    assert {it["title"]: (it["starred"], it["seen"]) for it in dayMulti["items"]} == {
        "Multi 1": (True, False),
        "Multi 2": (False, True),
        "Multi 3": (True, True),
        "Multi 4": (False, False),
    }

    # Clean the 2026-11-18 markers back out so later sections reason about one item only.
    for title in ("Multi 2", "Multi 3"):
        assert _resp(routes.handler(_jwtEvent("DELETE", "/feeds/seen", sub="user-a", qs={"feedId": feedId, "itemSk": multiSks[title]}), None))[0] == 200
    for title in ("Multi 1", "Multi 3"):
        assert _resp(routes.handler(_jwtEvent("DELETE", "/feeds/stars", sub="user-a", qs={"feedId": feedId, "itemSk": multiSks[title]}), None))[0] == 200
    assert _resp(routes.handler(_jwtEvent("PUT", "/feeds/stars", sub="user-a", body={"feedId": feedId, "itemSk": itemSk}), None))[0] == 200
    assert ("USER#user-a", f"STARREF#{feedId}#{itemSk}") in fakeDb.rows
    assert ("USER#user-a", f"SEENREF#{feedId}#{itemSk}") in fakeDb.rows
    assert len([k for k in fakeDb.rows if k[0] == "USER#user-a" and k[1].startswith("SEEN#")]) == 1

    # 12. Deleting a feed RECLAIMS its seen markers but deliberately KEEPS its stars.
    _, fDel = _resp(routes.handler(_jwtEvent("POST", "/feeds", sub="user-a", body={"kind": "push", "title": "Doomed", "slug": "doomed"}), None))
    delFeedId = fDel["feed"]["feedId"]
    _resp(
        routes.handler(
            _ingestEvent(
                {"feed": "doomed", "date": "2026-11-19", "items": [{"guid": "d1", "title": "Doomed item", "contentMarkdown": "x"}]},
                apiKey=apiKey,
            ),
            None,
        )
    )
    _, delDay = _resp(routes.handler(_jwtEvent("GET", f"/feeds/{delFeedId}/days/2026-11-19", sub="user-a"), None))
    delItemSk = delDay["items"][0]["itemSk"]
    assert _resp(routes.handler(_jwtEvent("PUT", "/feeds/seen", sub="user-a", body={"feedId": delFeedId, "itemSk": delItemSk}), None))[0] == 200
    assert _resp(routes.handler(_jwtEvent("PUT", "/feeds/stars", sub="user-a", body={"feedId": delFeedId, "itemSk": delItemSk}), None))[0] == 200
    assert [k for k in fakeDb.rows if k[0] == "USER#user-a" and k[1].startswith(f"SEENREF#{delFeedId}#")]
    assert [k for k in fakeDb.rows if k[0] == "USER#user-a" and k[1].startswith("SEEN#") and delFeedId in k[1]]

    assert _resp(routes.handler(_jwtEvent("DELETE", f"/feeds/{delFeedId}", sub="user-a"), None))[0] == 200

    # Seen rows are garbage once the feed is gone: deleteFeed sweeps BOTH the SEENREF#
    # lookup and the SEEN# list row out of the USER partition.
    assert not [k for k in fakeDb.rows if k[0] == "USER#user-a" and k[1].startswith(f"SEENREF#{delFeedId}#")]
    assert not [k for k in fakeDb.rows if k[0] == "USER#user-a" and k[1].startswith("SEEN#") and delFeedId in k[1]]
    assert [it for it in _resp(routes.handler(_jwtEvent("GET", "/feeds/seen", sub="user-a"), None))[1]["items"] if it["feedId"] == delFeedId] == []

    # ...but STARS SURVIVE the same deletion, on purpose: the UI promises "Any items you
    # starred remain in Starred". This asymmetry is intentional -- do not "unify" it.
    assert ("USER#user-a", f"STARREF#{delFeedId}#{delItemSk}") in fakeDb.rows
    assert [k for k in fakeDb.rows if k[0] == "USER#user-a" and k[1].startswith("STAR#") and delFeedId in k[1]]
    survivingStars = _resp(routes.handler(_jwtEvent("GET", "/feeds/stars", sub="user-a"), None))[1]["items"]
    assert [s["itemSk"] for s in survivingStars if s["feedId"] == delFeedId] == [delItemSk]

    # DELETE /feeds/seen after the feed is gone is still a 200 -- now a pure no-op,
    # because the sweep above already removed both rows.
    cPostDel, bPostDel = _resp(routes.handler(_jwtEvent("DELETE", "/feeds/seen", sub="user-a", qs={"feedId": delFeedId, "itemSk": delItemSk}), None))
    assert cPostDel == 200 and bPostDel["seen"] is False
    assert not [k for k in fakeDb.rows if k[0] == "USER#user-a" and k[1].startswith("SEEN") and delFeedId in k[1]]
    # Unstarring is still what removes the surviving star rows.
    assert _resp(routes.handler(_jwtEvent("DELETE", "/feeds/stars", sub="user-a", qs={"feedId": delFeedId, "itemSk": delItemSk}), None))[0] == 200
    assert not [k for k in fakeDb.rows if k[0] == "USER#user-a" and k[1].startswith("STAR") and delFeedId in k[1]]

    # 13a. unmarkSeen stale-ref race: a concurrent unmark+remark between read and tx fails the
    #      CAS, then the retry re-reads the live seenSk and leaves ZERO SEEN#/SEENREF# orphans.
    origTx = fakeDb.transact_write_items
    unmarkRace = {"fired": False}

    def raceDuringUnmark(TransactItems):
        isSeenRefDelete = (
            len(TransactItems) == 2
            and "Delete" in TransactItems[0]
            and _DESER.deserialize(TransactItems[0]["Delete"]["Key"]["SK"]).startswith("SEENREF#")
        )
        if isSeenRefDelete and not unmarkRace["fired"]:
            unmarkRace["fired"] = True
            origTx([
                {"Delete": {"TableName": fakeDb.tableName, "Key": TransactItems[0]["Delete"]["Key"]}},
                {"Delete": {"TableName": fakeDb.tableName, "Key": TransactItems[1]["Delete"]["Key"]}},
            ])
            with patch.object(storage, "_isoNowUtc", return_value="2026-11-19T23:59:59.999Z"):
                storage.markSeen("user-a", feedId, itemSk)
        return origTx(TransactItems)

    with patch.object(fakeDb, "transact_write_items", side_effect=raceDuringUnmark):
        storage.unmarkSeen("user-a", feedId, itemSk)

    assert unmarkRace["fired"] is True
    assert [k for k in fakeDb.rows if k[0] == "USER#user-a" and (k[1].startswith("SEEN#") or k[1].startswith("SEENREF#"))] == []

    # 13b. markSeen race: tx hits ConditionalCheckFailed, the concurrent caller's SEENREF
    #      vanishes before the fallback read, and attempt 2 retries cleanly to 200.
    markRace = {"fired": False}

    def raceDuringMark(TransactItems):
        isSeenRefPut = (
            len(TransactItems) == 2
            and "Put" in TransactItems[1]
            and _DESER.deserialize(TransactItems[1]["Put"]["Item"]["SK"]).startswith("SEENREF#")
        )
        if isSeenRefPut and not markRace["fired"]:
            markRace["fired"] = True
            seenRefSk = _DESER.deserialize(TransactItems[1]["Put"]["Item"]["SK"])
            condErr = fakeDb._condErr("TransactionCanceledException", [{"Code": "None"}, {"Code": "ConditionalCheckFailed"}])
            fakeDb.rows.pop(("USER#user-a", seenRefSk), None)
            raise condErr
        return origTx(TransactItems)

    with patch.object(fakeDb, "transact_write_items", side_effect=raceDuringMark):
        cRace, bRace = _resp(routes.handler(_jwtEvent("PUT", "/feeds/seen", sub="user-a", body={"feedId": feedId, "itemSk": itemSk}), None))
    assert markRace["fired"] is True
    assert cRace == 200 and bRace["seen"] is True
    assert len([k for k in fakeDb.rows if k[0] == "USER#user-a" and k[1].startswith("SEEN#")]) == 1
    assert len([k for k in fakeDb.rows if k[0] == "USER#user-a" and k[1].startswith("SEENREF#")]) == 1
    assert _resp(routes.handler(_jwtEvent("GET", f"/feeds/{feedId}/days/2026-11-19", sub="user-a"), None))[1]["items"][0]["seen"] is True

    # 14. Self-heal: deleteFeed's seen sweep is BatchWriteItem (not atomic), so a partial
    #     failure can leave a SEENREF# whose SEEN# list row is gone. Re-marking must
    #     compare-and-swap over that stale ref and return 200, not 500 forever.
    orphanRefKey = ("USER#user-a", f"SEENREF#{feedId}#{itemSk}")
    staleSeenSk = fakeDb.rows[orphanRefKey]["seenSk"]
    assert fakeDb.rows.pop(("USER#user-a", staleSeenSk), None) is not None
    assert orphanRefKey in fakeDb.rows
    assert not [k for k in fakeDb.rows if k[0] == "USER#user-a" and k[1].startswith("SEEN#")]

    cHeal, bHeal = _resp(routes.handler(_jwtEvent("PUT", "/feeds/seen", sub="user-a", body={"feedId": feedId, "itemSk": itemSk}), None))
    assert cHeal == 200 and bHeal["seen"] is True
    healedSeenSk = bHeal["seenItem"]["seenSk"]
    assert healedSeenSk.startswith("SEEN#") and healedSeenSk.endswith(f"#{feedId}#{storedItem['itemHash']}")
    healedSeenKeys = [k for k in fakeDb.rows if k[0] == "USER#user-a" and k[1].startswith("SEEN#")]
    healedRefKeys = [k for k in fakeDb.rows if k[0] == "USER#user-a" and k[1].startswith("SEENREF#")]
    assert len(healedSeenKeys) == 1 and len(healedRefKeys) == 1
    assert healedSeenKeys[0][1] == healedSeenSk
    assert fakeDb.rows[orphanRefKey]["seenSk"] == healedSeenSk
    assert _resp(routes.handler(_jwtEvent("GET", "/feeds/seen", sub="user-a"), None))[1]["items"][0]["seenSk"] == healedSeenSk


def test_seen_list_pagination_cursor_round_trip(fakeDb):
    """FUNK-100: GET /feeds/seen paginates newest-first through storage.listSeen's ExclusiveStartKey branch."""
    _, fResp = _resp(routes.handler(_jwtEvent("POST", "/feeds", sub="user-a", body={"kind": "push", "title": "Pager", "slug": "pager"}), None))
    feedId = fResp["feed"]["feedId"]
    _, kResp = _resp(routes.handler(_jwtEvent("POST", "/feeds/keys", sub="user-a", body={"name": "K"}), None))
    _resp(
        routes.handler(
            _ingestEvent(
                {
                    "feed": "pager",
                    "date": "2026-11-19",
                    "items": [{"guid": f"p{i}", "title": f"Page item {i}", "contentMarkdown": "x"} for i in (1, 2, 3)],
                },
                apiKey=kResp["rawKey"],
            ),
            None,
        )
    )
    _, day = _resp(routes.handler(_jwtEvent("GET", f"/feeds/{feedId}/days/2026-11-19", sub="user-a"), None))
    sks = {it["title"]: it["itemSk"] for it in day["items"]}
    assert len(sks) == 3

    # Fixed, distinct seenAt values so newest-first order is deterministic.
    markedAt = {"Page item 1": "2026-11-19T10:00:00.000Z", "Page item 2": "2026-11-19T10:01:00.000Z", "Page item 3": "2026-11-19T10:02:00.000Z"}
    for title, stamp in markedAt.items():
        with patch.object(storage, "_isoNowUtc", return_value=stamp):
            assert _resp(routes.handler(_jwtEvent("PUT", "/feeds/seen", sub="user-a", body={"feedId": feedId, "itemSk": sks[title]}), None))[0] == 200

    pages = []
    cursor = None
    for _ in range(4):
        qs = {"limit": "1"}
        if cursor:
            qs["cursor"] = cursor
        code, body = _resp(routes.handler(_jwtEvent("GET", "/feeds/seen", sub="user-a", qs=qs), None))
        assert code == 200
        pages.append(body["items"])
        cursor = body["nextCursor"]
        if not cursor:
            break
    assert cursor is None  # final page carries no cursor

    walked = [it for page in pages for it in page]
    assert [len(p) for p in pages[:3]] == [1, 1, 1]
    assert [it["title"] for it in walked] == ["Page item 3", "Page item 2", "Page item 1"]  # newest seenAt first
    assert [it["seenAt"] for it in walked] == [markedAt["Page item 3"], markedAt["Page item 2"], markedAt["Page item 1"]]
    assert len({it["seenSk"] for it in walked}) == 3  # distinct items, no repeats across pages
    assert {it["itemSk"] for it in walked} == set(sks.values())  # union is every marked item

    # One unpaginated call returns the same three in the same order.
    _, allSeen = _resp(routes.handler(_jwtEvent("GET", "/feeds/seen", sub="user-a"), None))
    assert allSeen["nextCursor"] is None
    assert [it["seenSk"] for it in allSeen["items"]] == [it["seenSk"] for it in walked]




def test_delete_feed_survives_a_failing_seen_sweep(fakeDb):
    """FUNK-100: the seen sweep is best-effort garbage collection.

    deleteFeed reclaims SEEN#/SEENREF# rows AFTER the feed itself is already gone, so a
    DynamoDB failure in that sweep must not turn DELETE /feeds/{id} into a 500 and must
    not resurrect the feed. The orphan rows are acceptable; a failed delete is not.
    """
    _, fResp = _resp(routes.handler(_jwtEvent("POST", "/feeds", sub="user-a", body={"kind": "push", "title": "Doomed", "slug": "doomed"}), None))
    feedId = fResp["feed"]["feedId"]
    _, kResp = _resp(routes.handler(_jwtEvent("POST", "/feeds/keys", sub="user-a", body={"name": "K"}), None))
    _resp(
        routes.handler(
            _ingestEvent(
                {"feed": "doomed", "date": "2026-11-19", "items": [{"guid": "d1", "title": "Doomed item", "contentMarkdown": "x"}]},
                apiKey=kResp["rawKey"],
            ),
            None,
        )
    )
    _, day = _resp(routes.handler(_jwtEvent("GET", f"/feeds/{feedId}/days/2026-11-19", sub="user-a"), None))
    itemSk = day["items"][0]["itemSk"]
    assert _resp(routes.handler(_jwtEvent("PUT", "/feeds/seen", sub="user-a", body={"feedId": feedId, "itemSk": itemSk}), None))[0] == 200
    assert any(sk.startswith("SEENREF#") for (_pk, sk) in fakeDb.rows)

    # Fail only the sweep: the feed row and its FEED# partition are already handled by
    # the time _sweepFeedSeenRows runs, so raising here isolates the best-effort path.
    with patch.object(storage, "_sweepFeedSeenRows", side_effect=RuntimeError("DynamoDB batch_write_item left unprocessed items after retries")):
        code, body = _resp(routes.handler(_jwtEvent("DELETE", f"/feeds/{feedId}", sub="user-a", pathParams={"id": feedId}), None))

    assert code == 200, body
    # The feed is really gone despite the sweep blowing up...
    assert _resp(routes.handler(_jwtEvent("GET", "/feeds", sub="user-a"), None))[1]["feeds"] == []
    assert not any(sk == f"FEED#{feedId}" for (_pk, sk) in fakeDb.rows)
    # ...and the unreclaimed markers are inert garbage, not an error.
    assert any(sk.startswith("SEENREF#") for (_pk, sk) in fakeDb.rows)
