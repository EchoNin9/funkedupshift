"""Squash doubles: per-user players/matches and expiring public share pages.

Data (main table, single-table):
  Player  PK=USER#<sub>             SK=SQUASH#PLAYER#<uuid>  {name}
  Match   PK=USER#<sub>             SK=SQUASH#MATCH#<uuid>   {date, team*Id, winningTeam, games, tags}
  Share   PK=SQUASH#SHARE#<token>   SK=METADATA              {ownerId, title, mode, filters, snapshot,
                                                              createdAt, expiresAt, entityType, entitySk}

Entry points take (event, user, table) and return (status, body_dict); the
dispatcher in handler.py does auth and wraps with jsonResponse. This module
never imports handler.py (no circular import). Player/match ids are bare uuids
in the API; a legacy "SQUASH#PLAYER#"/"SQUASH#MATCH#" prefix is tolerated on input.
All numbers are written as integer DynamoDB "N" strings (no floats).
"""
import json
import logging
import re
import secrets
import time
import uuid
from datetime import datetime, timezone

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

SHARE_LIMIT = 10
SNAPSHOT_MAX_MATCHES = 500
DEFAULT_EXPIRES_DAYS = 30
MAX_EXPIRES_DAYS = 90
PLAYER_SK = "SQUASH#PLAYER#"
MATCH_SK = "SQUASH#MATCH#"
SHARE_PK = "SQUASH#SHARE#"
_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


# ---------------------------------------------------------------- helpers

def _db():
    import boto3
    return boto3.client("dynamodb")


def _now():
    return int(time.time())


def _isoNow():
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"


def _body(event):
    try:
        body = json.loads(event.get("body") or "{}")
    except (TypeError, ValueError):
        raise ApiError(400, "invalid JSON body")
    if not isinstance(body, dict):
        raise ApiError(400, "body must be an object")
    return body


def _bare(raw, prefix):
    raw = (raw or "").strip() if isinstance(raw, str) else ""
    return raw[len(prefix):] if raw.startswith(prefix) else raw


def _item(raw):
    out = {}
    for k, v in raw.items():
        if "S" in v:
            out[k] = v["S"]
        elif "N" in v:
            out[k] = int(v["N"]) if re.fullmatch(r"-?\d+", v["N"]) else float(v["N"])
        elif "L" in v:
            out[k] = [x.get("S", "") for x in v["L"]]
    return out


def _queryAll(db, **kw):
    items = []
    while True:
        res = db.query(**kw)
        items.extend(res.get("Items", []))
        if not res.get("LastEvaluatedKey"):
            return items
        kw["ExclusiveStartKey"] = res["LastEvaluatedKey"]


def _userItems(db, table, sub, skPrefix):
    return _queryAll(
        db,
        TableName=table,
        KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues={":pk": {"S": f"USER#{sub}"}, ":sk": {"S": skPrefix}},
    )


def _getUserRow(db, table, sub, sk):
    return db.get_item(TableName=table, Key={"PK": {"S": f"USER#{sub}"}, "SK": {"S": sk}}).get("Item")


def _qs(event):
    return event.get("queryStringParameters") or {}


# ---------------------------------------------------------------- players

def listPlayers(event, user, table):
    db = _db()
    players = []
    for raw in _userItems(db, table, user["userId"], PLAYER_SK):
        p = _item(raw)
        players.append({"id": p["SK"][len(PLAYER_SK):], "name": p.get("name", "")})
    players.sort(key=lambda p: p["name"].lower())
    return 200, {"players": players}


def createPlayer(event, user, table):
    name = (_body(event).get("name") or "")
    name = name.strip() if isinstance(name, str) else ""
    if not name:
        raise ApiError(400, "name is required")
    pid = str(uuid.uuid4())
    now = _isoNow()
    _db().put_item(TableName=table, Item={
        "PK": {"S": f"USER#{user['userId']}"},
        "SK": {"S": PLAYER_SK + pid},
        "name": {"S": name},
        "createdAt": {"S": now},
        "updatedAt": {"S": now},
    })
    return 201, {"id": pid, "name": name}


def updatePlayer(event, user, table):
    body = _body(event)
    pid = _bare(body.get("id"), PLAYER_SK)
    if not pid:
        raise ApiError(400, "id is required")
    name = body.get("name")
    name = name.strip() if isinstance(name, str) else ""
    if not name:
        raise ApiError(400, "name is required")
    db = _db()
    row = _getUserRow(db, table, user["userId"], PLAYER_SK + pid)
    if not row:
        raise ApiError(404, "Player not found")
    row["name"] = {"S": name}
    row["updatedAt"] = {"S": _isoNow()}
    db.put_item(TableName=table, Item=row)
    return 200, {"id": pid, "updated": True}


def deletePlayer(event, user, table):
    pid = _bare(_qs(event).get("id"), PLAYER_SK)
    if not pid:
        raise ApiError(400, "id is required")
    db = _db()
    if not _getUserRow(db, table, user["userId"], PLAYER_SK + pid):
        raise ApiError(404, "Player not found")
    db.delete_item(TableName=table, Key={"PK": {"S": f"USER#{user['userId']}"}, "SK": {"S": PLAYER_SK + pid}})
    return 200, {"id": pid, "deleted": True}


# ---------------------------------------------------------------- matches

def _validateSquashMatchBody(body):
    """Validate match body; return (validated, None) or (None, error_msg). Ids are bare uuids."""
    date_val = (body.get("date") or "").strip() if isinstance(body.get("date"), str) else ""
    if not date_val or len(date_val) != 10:
        return None, "date is required (YYYY-MM-DD)"
    try:
        datetime.strptime(date_val, "%Y-%m-%d")
    except ValueError:
        return None, "date must be YYYY-MM-DD"
    keys = ["teamAPlayer1Id", "teamAPlayer2Id", "teamBPlayer1Id", "teamBPlayer2Id"]
    ids = [_bare(body.get(k), PLAYER_SK) for k in keys]
    if not all(ids):
        return None, "teamAPlayer1Id, teamAPlayer2Id, teamBPlayer1Id, teamBPlayer2Id are required"
    if len(set(ids)) != 4:
        return None, "each player can only be on one team"
    win = (body.get("winningTeam") or "").strip().upper() if isinstance(body.get("winningTeam"), str) else ""
    if win not in ("A", "B"):
        return None, "winningTeam must be A or B"
    g_a = body.get("teamAGames")
    g_b = body.get("teamBGames")
    if g_a is None or g_b is None:
        return None, "teamAGames and teamBGames are required"
    try:
        g_a = int(g_a)
        g_b = int(g_b)
    except (TypeError, ValueError):
        return None, "teamAGames and teamBGames must be integers"
    if win == "A":
        if g_a != 3 or g_b not in (0, 1, 2):
            return None, "when team A wins: teamAGames=3, teamBGames in {0,1,2}"
    else:
        if g_b != 3 or g_a not in (0, 1, 2):
            return None, "when team B wins: teamBGames=3, teamAGames in {0,1,2}"
    raw_tags = body.get("tags") if "tags" in body else []
    if raw_tags is None:
        raw_tags = []
    if not isinstance(raw_tags, list):
        return None, "tags must be a list"
    tags, seen = [], set()
    for t in raw_tags:
        t_norm = str(t).strip().lower()
        if t_norm and t_norm not in seen:
            seen.add(t_norm)
            tags.append(t_norm)
    out = dict(zip(keys, ids))
    out.update({"date": date_val, "winningTeam": win, "teamAGames": g_a, "teamBGames": g_b, "tags": tags})
    return out, None


def _matchAttrs(v):
    return {
        "date": {"S": v["date"]},
        "teamAPlayer1Id": {"S": v["teamAPlayer1Id"]},
        "teamAPlayer2Id": {"S": v["teamAPlayer2Id"]},
        "teamBPlayer1Id": {"S": v["teamBPlayer1Id"]},
        "teamBPlayer2Id": {"S": v["teamBPlayer2Id"]},
        "winningTeam": {"S": v["winningTeam"]},
        "teamAGames": {"N": str(int(v["teamAGames"]))},
        "teamBGames": {"N": str(int(v["teamBGames"]))},
        "tags": {"L": [{"S": t} for t in v["tags"]]},
    }


def _requireOwnPlayers(db, table, sub, validated):
    own = {_item(r)["SK"][len(PLAYER_SK):] for r in _userItems(db, table, sub, PLAYER_SK)}
    for k in ("teamAPlayer1Id", "teamAPlayer2Id", "teamBPlayer1Id", "teamBPlayer2Id"):
        if validated[k] not in own:
            raise ApiError(400, "unknown player id: " + validated[k])


def _matchOut(raw):
    m = _item(raw)
    m["id"] = m.pop("SK")[len(MATCH_SK):]
    m.pop("PK", None)
    return m


MAX_FILTER_TAGS = 20
MAX_FILTER_TAG_LEN = 40


def _normFilters(raw):
    """Validate/normalise a filters dict (query-param shaped)."""
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise ApiError(400, "filters must be an object")
    out = {}
    for k in ("date", "dateFrom", "dateTo"):
        v = raw.get(k)
        if v in (None, ""):
            continue
        if not isinstance(v, str) or not _DATE_RE.match(v.strip()):
            raise ApiError(400, f"filters.{k} must be YYYY-MM-DD")
        out[k] = v.strip()
    pids = raw.get("playerIds")
    if isinstance(pids, str):
        pids = [x for x in pids.split(",")]
    if pids in (None, ""):
        pids = []
    if not isinstance(pids, list) or not all(isinstance(x, str) for x in pids):
        raise ApiError(400, "filters.playerIds must be a list of ids")
    pids = [_bare(x, PLAYER_SK) for x in pids]
    pids = [x for x in pids if x]
    if pids:
        out["playerIds"] = pids
        mode = str(raw.get("playerMode") or "and").strip().lower()
        if mode not in ("and", "or"):
            raise ApiError(400, "filters.playerMode must be and|or")
        out["playerMode"] = mode
    tags = raw.get("tags")
    if isinstance(tags, str):
        tags = tags.split(",")
    if tags is None:
        tags = []
    if not isinstance(tags, list) or not all(isinstance(x, str) for x in tags):
        raise ApiError(400, "filters.tags must be a list of strings")
    if len(tags) > MAX_FILTER_TAGS:
        raise ApiError(400, f"filters.tags is limited to {MAX_FILTER_TAGS} tags")
    norm = []
    for t in tags:
        t = t.strip().lower()
        if len(t) > MAX_FILTER_TAG_LEN:
            raise ApiError(400, f"filters.tags entries must be at most {MAX_FILTER_TAG_LEN} characters")
        if t and t not in norm:
            norm.append(t)
    if norm:
        out["tags"] = norm
        tmode = str(raw.get("tagMode") or "and").strip().lower()
        if tmode not in ("and", "or"):
            raise ApiError(400, "filters.tagMode must be and|or")
        out["tagMode"] = tmode
    elif str(raw.get("tagMode") or "and").strip().lower() not in ("and", "or"):
        raise ApiError(400, "filters.tagMode must be and|or")
    order = str(raw.get("sortOrder") or "newest").strip().lower()
    if order not in ("newest", "oldest"):
        raise ApiError(400, "filters.sortOrder must be newest|oldest")
    if order == "oldest":  # "newest" is the default and is never stored
        out["sortOrder"] = order
    return out


def _runFilters(db, table, sub, filters):
    """Matches in `sub`'s partition passing `filters`, as API dicts sorted by date."""
    out = []
    pids = set(filters.get("playerIds") or [])
    tags = set(filters.get("tags") or [])
    for raw in _userItems(db, table, sub, MATCH_SK):
        m = _matchOut(raw)
        d = m.get("date", "")
        if filters.get("date") and d != filters["date"]:
            continue
        if filters.get("dateFrom") and d < filters["dateFrom"]:
            continue
        if filters.get("dateTo") and d > filters["dateTo"]:
            continue
        if pids:
            in_match = {m.get(k) for k in ("teamAPlayer1Id", "teamAPlayer2Id", "teamBPlayer1Id", "teamBPlayer2Id")}
            ok = bool(pids & in_match) if filters.get("playerMode") == "or" else pids <= in_match
            if not ok:
                continue
        if tags:
            have = set(m.get("tags") or [])
            ok = bool(tags & have) if filters.get("tagMode") == "or" else tags <= have
            if not ok:
                continue
        out.append(m)
    # ponytail: whole-partition query per search; fine to thousands of matches per user, add a date-sorted SK if it gets slow.
    out.sort(key=lambda m: (m.get("date", ""), m.get("id", "")), reverse=filters.get("sortOrder") != "oldest")
    return out


def listMatches(event, user, table):
    qs = _qs(event)
    filters = _normFilters({
        "date": qs.get("date"), "dateFrom": qs.get("dateFrom"), "dateTo": qs.get("dateTo"),
        "playerIds": qs.get("playerIds"), "playerMode": qs.get("playerMode"),
        "tags": qs.get("tags"), "tagMode": qs.get("tagMode"), "sortOrder": qs.get("sortOrder"),
    })
    return 200, {"matches": _runFilters(_db(), table, user["userId"], filters)}


def createMatch(event, user, table):
    validated, msg = _validateSquashMatchBody(_body(event))
    if msg:
        raise ApiError(400, msg)
    db = _db()
    _requireOwnPlayers(db, table, user["userId"], validated)
    mid = str(uuid.uuid4())
    now = _isoNow()
    item = {"PK": {"S": f"USER#{user['userId']}"}, "SK": {"S": MATCH_SK + mid},
            "createdAt": {"S": now}, "updatedAt": {"S": now}}
    item.update(_matchAttrs(validated))
    db.put_item(TableName=table, Item=item)
    return 201, {"id": mid, "date": validated["date"]}


def updateMatch(event, user, table):
    body = _body(event)
    mid = _bare(body.get("id"), MATCH_SK)
    if not mid:
        raise ApiError(400, "id is required")
    validated, msg = _validateSquashMatchBody(body)
    if msg:
        raise ApiError(400, msg)
    db = _db()
    row = _getUserRow(db, table, user["userId"], MATCH_SK + mid)
    if not row:
        raise ApiError(404, "Match not found")
    _requireOwnPlayers(db, table, user["userId"], validated)
    row.update(_matchAttrs(validated))
    row["updatedAt"] = {"S": _isoNow()}
    db.put_item(TableName=table, Item=row)
    return 200, {"id": mid, "updated": True}


def deleteMatch(event, user, table):
    mid = _bare(_qs(event).get("id"), MATCH_SK)
    if not mid:
        raise ApiError(400, "id is required")
    db = _db()
    if not _getUserRow(db, table, user["userId"], MATCH_SK + mid):
        raise ApiError(404, "Match not found")
    db.delete_item(TableName=table, Key={"PK": {"S": f"USER#{user['userId']}"}, "SK": {"S": MATCH_SK + mid}})
    return 200, {"id": mid, "deleted": True}


# ---------------------------------------------------------------- shares

def _publicMatches(db, table, sub, matches):
    """Matches with player names filled in and no ids."""
    names = {}
    for r in _userItems(db, table, sub, PLAYER_SK):
        p = _item(r)
        names[p["SK"][len(PLAYER_SK):]] = p.get("name", "")
    out = []
    for m in matches:
        out.append({
            "date": m.get("date", ""),
            "teamA": [names.get(m.get("teamAPlayer1Id"), "Unknown"), names.get(m.get("teamAPlayer2Id"), "Unknown")],
            "teamB": [names.get(m.get("teamBPlayer1Id"), "Unknown"), names.get(m.get("teamBPlayer2Id"), "Unknown")],
            "winningTeam": m.get("winningTeam", ""),
            "teamAGames": m.get("teamAGames", 0),
            "teamBGames": m.get("teamBGames", 0),
            "tags": m.get("tags", []),
        })
    return out


def _takeSnapshot(db, table, sub, filters):
    matches = _runFilters(db, table, sub, filters)
    if len(matches) > SNAPSHOT_MAX_MATCHES:
        raise ApiError(400, f"snapshot is limited to {SNAPSHOT_MAX_MATCHES} matches; narrow your filters")
    return _publicMatches(db, table, sub, matches)


def _expiresInDays(body, default):
    if "expiresInDays" not in body or body["expiresInDays"] is None:
        return default
    v = body["expiresInDays"]
    if isinstance(v, bool) or not isinstance(v, int) or not 1 <= v <= MAX_EXPIRES_DAYS:
        raise ApiError(400, f"expiresInDays must be an integer from 1 to {MAX_EXPIRES_DAYS}")
    return v


def _title(v, default=None):
    if v is None:
        return default
    if not isinstance(v, str) or not v.strip():
        raise ApiError(400, "title must be a non-empty string")
    return v.strip()[:100]


def _mode(v):
    if v not in ("snapshot", "live"):
        raise ApiError(400, "mode must be snapshot or live")
    return v


def _liveShares(db, table, sub):
    """Caller's unexpired share rows (raw DynamoDB items)."""
    now = _now()
    rows = _queryAll(
        db, TableName=table, IndexName="byEntity",
        KeyConditionExpression="entityType = :et AND begins_with(entitySk, :p)",
        ExpressionAttributeValues={":et": {"S": "SQUASH_SHARE"}, ":p": {"S": f"{sub}#"}},
    )
    return [r for r in rows if _item(r).get("expiresAt", 0) > now]


def _shareOut(raw):
    s = _item(raw)
    out = {
        "id": s["PK"][len(SHARE_PK):], "title": s.get("title", ""), "mode": s.get("mode", ""),
        "filters": json.loads(s.get("filters") or "{}"),
        "createdAt": s.get("createdAt", ""), "expiresAt": s.get("expiresAt", 0),
    }
    if s.get("mode") == "snapshot":
        out["snapshotAt"] = s.get("snapshotAt", "")
        out["matchCount"] = len(json.loads(s.get("snapshot") or "[]"))
    return out


def _ownedShare(db, table, sub, token):
    """Raw share item if it exists, is unexpired and owned by `sub`; else raise 404."""
    row = None
    if _TOKEN_RE.match(token or ""):
        row = db.get_item(TableName=table, Key={"PK": {"S": SHARE_PK + token}, "SK": {"S": "METADATA"}}).get("Item")
    if not row:
        raise ApiError(404, "Share not found")
    s = _item(row)
    if s.get("ownerId") != sub or s.get("expiresAt", 0) <= _now():
        raise ApiError(404, "Share not found")
    return row


def listShares(event, user, table):
    shares = [_shareOut(r) for r in _liveShares(_db(), table, user["userId"])]
    shares.sort(key=lambda s: s["createdAt"], reverse=True)
    return 200, {"shares": shares, "count": len(shares), "limit": SHARE_LIMIT}


def createShare(event, user, table):
    body = _body(event)
    sub = user["userId"]
    title = _title(body.get("title"), "Squash results")
    mode = _mode(body.get("mode"))
    filters = _normFilters(body.get("filters"))
    days = _expiresInDays(body, DEFAULT_EXPIRES_DAYS)
    db = _db()
    # ponytail: 10-share cap is count-then-put (a tiny race can make 11); a conditional counter item fixes it if that ever matters.
    if len(_liveShares(db, table, sub)) >= SHARE_LIMIT:
        raise ApiError(409, f"share limit reached ({SHARE_LIMIT})")
    token = secrets.token_urlsafe(16)
    now = _now()
    created = _isoNow()
    item = {
        "PK": {"S": SHARE_PK + token}, "SK": {"S": "METADATA"},
        "ownerId": {"S": sub}, "title": {"S": title}, "mode": {"S": mode},
        "filters": {"S": json.dumps(filters)},
        "createdAt": {"S": created}, "expiresAt": {"N": str(now + days * 86400)},
        "entityType": {"S": "SQUASH_SHARE"}, "entitySk": {"S": f"{sub}#{created}"},
    }
    if mode == "snapshot":
        item["snapshot"] = {"S": json.dumps(_takeSnapshot(db, table, sub, filters))}
        item["snapshotAt"] = {"S": created}
    db.put_item(TableName=table, Item=item)
    return 201, _shareOut(item)


def updateShare(event, user, table):
    body = _body(event)
    sub = user["userId"]
    token = body.get("id") if isinstance(body.get("id"), str) else ""
    if not token.strip():
        raise ApiError(400, "id is required")
    db = _db()
    row = _ownedShare(db, table, sub, token.strip())
    cur = _item(row)
    title = _title(body.get("title"))
    mode = _mode(body["mode"]) if body.get("mode") is not None else cur["mode"]
    filters = _normFilters(body["filters"]) if "filters" in body else json.loads(cur.get("filters") or "{}")
    days = _expiresInDays(body, None)
    row["title"] = {"S": title or cur.get("title", "")}
    row["mode"] = {"S": mode}
    row["filters"] = {"S": json.dumps(filters)}
    if days is not None:
        row["expiresAt"] = {"N": str(_now() + days * 86400)}
    if mode == "live":
        row.pop("snapshot", None)
        row.pop("snapshotAt", None)
    elif (body.get("refresh") is True or "snapshot" not in row
          or ("filters" in body and filters != json.loads(cur.get("filters") or "{}"))):
        row["snapshot"] = {"S": json.dumps(_takeSnapshot(db, table, sub, filters))}
        row["snapshotAt"] = {"S": _isoNow()}
    db.put_item(TableName=table, Item=row)
    return 200, _shareOut(row)


def deleteShare(event, user, table):
    token = (_qs(event).get("id") or "").strip()
    if not token:
        raise ApiError(400, "id is required")
    db = _db()
    _ownedShare(db, table, user["userId"], token)
    db.delete_item(TableName=table, Key={"PK": {"S": SHARE_PK + token}, "SK": {"S": "METADATA"}})
    return 200, {"id": token, "deleted": True}


def getPublic(token, table):
    """Public read of a share. No auth, no claims; never returns ownerId or player ids."""
    db = _db()
    row = None
    if _TOKEN_RE.match(token or ""):
        row = db.get_item(TableName=table, Key={"PK": {"S": SHARE_PK + token}, "SK": {"S": "METADATA"}}).get("Item")
    s = _item(row) if row else None
    if not s or s.get("expiresAt", 0) <= _now():
        raise ApiError(404, "Share expired or not found")
    if s.get("mode") == "live":
        sub = s["ownerId"]
        filters = json.loads(s.get("filters") or "{}")
        matches = _publicMatches(db, table, sub, _runFilters(db, table, sub, filters))
        out = {"title": s.get("title", ""), "mode": "live", "expiresAt": s["expiresAt"], "matches": matches}
    else:
        out = {"title": s.get("title", ""), "mode": "snapshot", "expiresAt": s["expiresAt"],
               "snapshotAt": s.get("snapshotAt", ""), "matches": json.loads(s.get("snapshot") or "[]")}
    return 200, out
