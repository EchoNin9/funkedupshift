"""Squash: per-user data, expiring public shares, migration transform."""
import importlib.util
import json
import sys
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

NOW = 1_800_000_000


class FakeDynamo:
    """Minimal in-memory low-level DynamoDB client (only what squash.py uses)."""

    def __init__(self):
        self.rows = {}

    def get_item(self, TableName, Key):
        r = self.rows.get((Key["PK"]["S"], Key["SK"]["S"]))
        return {"Item": dict(r)} if r else {}

    def put_item(self, TableName, Item):
        self.rows[(Item["PK"]["S"], Item["SK"]["S"])] = dict(Item)

    def delete_item(self, TableName, Key):
        self.rows.pop((Key["PK"]["S"], Key["SK"]["S"]), None)

    def query(self, TableName, KeyConditionExpression, ExpressionAttributeValues, IndexName=None, **kw):
        v = {k: x["S"] for k, x in ExpressionAttributeValues.items()}
        if IndexName == "byEntity":
            items = [r for r in self.rows.values()
                     if r.get("entityType", {}).get("S") == v[":et"]
                     and r.get("entitySk", {}).get("S", "").startswith(v[":p"])]
        else:
            items = [r for (pk, sk), r in self.rows.items() if pk == v[":pk"] and sk.startswith(v[":sk"])]
        return {"Items": [dict(i) for i in items]}


@pytest.fixture
def db():
    d = FakeDynamo()
    with patch("boto3.client", return_value=d), patch("api.handler.TABLE_NAME", "t"), \
            patch("api.squash._now", return_value=NOW), \
            patch("api.handler._getUserCustomGroups", return_value=["Squash"]):
        yield d


def call(path, method="GET", body=None, sub="alice", groups="user", qs=None):
    from api.handler import handler
    event = {
        "rawPath": path,
        "queryStringParameters": qs or {},
        "requestContext": {"http": {"method": method, "path": path}, "authorizer": {"jwt": {"claims": {
            "sub": sub, "email": f"{sub}@x.com", "cognito:groups": groups}}}},
        "body": json.dumps(body) if body is not None else "{}",
    }
    r = handler(event, None)
    return r["statusCode"], json.loads(r["body"])


def public(token):
    from api.handler import handler
    # No requestContext authorizer at all.
    r = handler({"rawPath": f"/squash/public/{token}", "requestContext": {"http": {"method": "GET"}}}, None)
    return r["statusCode"], json.loads(r["body"])


def mkPlayers(sub="alice", names=("A", "B", "C", "D")):
    return [call("/squash/players", "POST", {"name": n}, sub=sub)[1]["id"] for n in names]


def matchBody(ids, date="2026-01-10", win="A", ga=3, gb=1, **kw):
    return {"date": date, "teamAPlayer1Id": ids[0], "teamAPlayer2Id": ids[1], "teamBPlayer1Id": ids[2],
            "teamBPlayer2Id": ids[3], "winningTeam": win, "teamAGames": ga, "teamBGames": gb, **kw}


def mkMatch(ids, **kw):
    s, b = call("/squash/matches", "POST", matchBody(ids, **kw))
    assert s == 201, b
    return b["id"]


def mkShare(**kw):
    body = {"title": "t", "mode": "snapshot", "filters": {}, **kw}
    return call("/squash/shares", "POST", body)


# ---------------------------------------------------------------- access

def test_requires_auth():
    from api.handler import handler
    r = handler({"rawPath": "/squash/players", "requestContext": {"http": {"method": "GET"}}}, None)
    assert r["statusCode"] == 401


def test_no_squash_group_403():
    with patch("api.handler._getUserCustomGroups", return_value=[]), patch("api.handler.TABLE_NAME", "t"):
        for method, path in [("GET", "/squash/players"), ("POST", "/squash/matches"), ("GET", "/squash/shares"),
                             ("DELETE", "/squash/shares")]:
            assert call(path, method)[0] == 403


def test_plain_user_in_group_can_create_update_delete(db):
    pid = call("/squash/players", "POST", {"name": "Al"})
    assert pid[0] == 201
    assert call("/squash/players", "PUT", {"id": pid[1]["id"], "name": "Alan"})[0] == 200
    assert call("/squash/players", "DELETE", qs={"id": pid[1]["id"]})[0] == 200


def test_admin_passes_without_group(db):
    with patch("api.handler._getUserCustomGroups", return_value=[]):
        assert call("/squash/players", sub="root", groups="admin")[0] == 200


def test_players_only_name_stored(db):
    s, b = call("/squash/players", "POST", {"name": " Al ", "email": "e@x", "userId": "u"})
    assert s == 201 and b == {"id": b["id"], "name": "Al"}
    row = db.rows[("USER#alice", "SQUASH#PLAYER#" + b["id"])]
    assert "email" not in row and "userId" not in row and "entityType" not in row
    assert call("/squash/players", "POST", {"name": " "})[0] == 400
    assert call("/squash/players")[1]["players"] == [{"id": b["id"], "name": "Al"}]


# ---------------------------------------------------------------- matches

def test_match_numbers_are_integer_N_strings(db):
    ids = mkPlayers()
    mid = mkMatch(ids, tags=["Fun", "fun"])
    row = db.rows[("USER#alice", "SQUASH#MATCH#" + mid)]
    for k in ("teamAGames", "teamBGames"):
        assert list(row[k]) == ["N"] and isinstance(Decimal(row[k]["N"]), Decimal) and "." not in row[k]["N"]
    assert row["tags"] == {"L": [{"S": "fun"}]}
    m = call("/squash/matches")[1]["matches"][0]
    assert m["id"] == mid and m["teamAGames"] == 3 and m["teamAPlayer1Id"] == ids[0]


def test_match_validation(db):
    ids = mkPlayers()
    assert call("/squash/matches", "POST", matchBody([ids[0]] * 2 + ids[2:]))[0] == 400
    assert call("/squash/matches", "POST", matchBody(ids, ga=2, gb=1))[0] == 400
    assert call("/squash/matches", "POST", matchBody(ids, tags="x"))[0] == 400


def test_match_with_other_users_player_is_400(db):
    mine = mkPlayers("alice")
    theirs = mkPlayers("bob")
    assert call("/squash/matches", "POST", matchBody(mine[:3] + theirs[:1]))[0] == 400
    mid = mkMatch(mine)
    assert call("/squash/matches", "PUT", {"id": mid, **matchBody(mine[:3] + theirs[:1])})[0] == 400


def test_match_update_and_filters(db):
    ids = mkPlayers()
    m1 = mkMatch(ids, date="2026-01-10")
    mkMatch(ids, date="2026-02-10")
    assert call("/squash/matches", "PUT", {"id": m1, **matchBody(ids, date="2026-01-11", win="B", ga=0, gb=3)})[0] == 200
    ms = call("/squash/matches")[1]["matches"]
    assert [m["date"] for m in ms] == ["2026-01-11", "2026-02-10"] and ms[0]["teamBGames"] == 3
    assert len(call("/squash/matches", qs={"date": "2026-02-10"})[1]["matches"]) == 1
    assert len(call("/squash/matches", qs={"dateFrom": "2026-01-01", "dateTo": "2026-01-31"})[1]["matches"]) == 1
    assert len(call("/squash/matches", qs={"playerIds": ids[0]})[1]["matches"]) == 2
    assert len(call("/squash/matches", qs={"playerIds": "nope"})[1]["matches"]) == 0
    assert len(call("/squash/matches", qs={"playerIds": f"{ids[0]},nope", "playerMode": "or"})[1]["matches"]) == 2
    assert call("/squash/matches", qs={"date": "bad"})[0] == 400


# ---------------------------------------------------------------- isolation

def test_cross_user_isolation_404(db):
    ids = mkPlayers("alice")
    mid = mkMatch(ids)
    sid = mkShare()[1]["id"]
    assert call("/squash/players", sub="bob")[1]["players"] == []
    assert call("/squash/matches", sub="bob")[1]["matches"] == []
    assert call("/squash/shares", sub="bob")[1]["shares"] == []
    bm = matchBody(mkPlayers("bob"))
    assert call("/squash/matches", "PUT", {"id": mid, **bm}, sub="bob")[0] == 404
    assert call("/squash/matches", "DELETE", qs={"id": mid}, sub="bob")[0] == 404
    assert call("/squash/players", "PUT", {"id": ids[0], "name": "x"}, sub="bob")[0] == 404
    assert call("/squash/players", "DELETE", qs={"id": ids[0]}, sub="bob")[0] == 404
    assert call("/squash/shares", "PUT", {"id": sid, "title": "x"}, sub="bob")[0] == 404
    assert call("/squash/shares", "DELETE", qs={"id": sid}, sub="bob")[0] == 404
    # untouched
    assert len(call("/squash/players")[1]["players"]) == 4
    assert call("/squash/matches", "DELETE", qs={"id": mid})[0] == 200
    assert call("/squash/matches", "DELETE", qs={"id": mid})[0] == 404


# ---------------------------------------------------------------- shares

def test_share_row_shape(db):
    s, b = mkShare(title="Hi")
    assert s == 201 and b["id"]
    row = db.rows[("SQUASH#SHARE#" + b["id"], "METADATA")]
    assert row["entityType"] == {"S": "SQUASH_SHARE"} and row["entitySk"]["S"].startswith("alice#")
    assert row["ownerId"] == {"S": "alice"}
    assert row["expiresAt"] == {"N": str(NOW + 30 * 86400)}
    assert len(b["id"]) >= 20


@pytest.mark.parametrize("days,status", [(0, 400), (91, 400), (-1, 400), (True, 400), (1.5, 400), ("5", 400),
                                         (None, 201), (90, 201), (1, 201)])
def test_expires_in_days_validation(db, days, status):
    s, b = mkShare(expiresInDays=days)
    assert s == status
    if status == 201:
        n = 30 if days is None else days
        assert db.rows[("SQUASH#SHARE#" + b["id"], "METADATA")]["expiresAt"] == {"N": str(NOW + n * 86400)}


def test_share_bad_mode_and_filters(db):
    assert mkShare(mode="x")[0] == 400
    assert mkShare(filters="x")[0] == 400
    assert mkShare(filters={"date": "nope"})[0] == 400


def test_share_limit_10_and_expired_dont_count(db):
    ids = []
    for _ in range(10):
        s, b = mkShare(mode="live")
        assert s == 201
        ids.append(b["id"])
    assert mkShare()[0] == 409
    assert call("/squash/shares")[1]["count"] == 10
    assert call("/squash/shares")[1]["limit"] == 10
    db.rows[("SQUASH#SHARE#" + ids[0], "METADATA")]["expiresAt"] = {"N": str(NOW)}
    assert call("/squash/shares")[1]["count"] == 9
    assert mkShare()[0] == 201
    # another user is unaffected by alice's cap
    assert call("/squash/shares", "POST", {"mode": "live"}, sub="bob")[0] == 201


def test_list_shares_shape(db):
    sid = mkShare(title="X")[1]["id"]
    sh = call("/squash/shares")[1]["shares"][0]
    assert sh["id"] == sid and sh["title"] == "X" and sh["mode"] == "snapshot"
    assert {"filters", "expiresAt", "createdAt"} <= set(sh) and "ownerId" not in sh and "snapshot" not in sh


def test_public_missing_expired_and_no_leaks(db):
    ids = mkPlayers()
    mkMatch(ids)
    assert public("nope")[0] == 404
    assert public("../x")[0] == 404
    for mode in ("snapshot", "live"):
        sid = mkShare(mode=mode)[1]["id"]
        s, b = public(sid)
        assert s == 200 and b["mode"] == mode and b["title"] == "t"
        assert b["expiresAt"] == NOW + 30 * 86400 and isinstance(b["expiresAt"], int)
        assert b["matches"][0]["teamA"] == ["A", "B"] and b["matches"][0]["teamB"] == ["C", "D"]
        assert b["matches"][0]["winningTeam"] == "A" and b["matches"][0]["teamAGames"] == 3
        raw = json.dumps(b)
        assert "alice" not in raw and "ownerId" not in raw and not any(i in raw for i in ids)
        db.rows[("SQUASH#SHARE#" + sid, "METADATA")]["expiresAt"] = {"N": str(NOW)}
        assert public(sid)[0] == 404


def test_snapshot_frozen_live_updates(db):
    ids = mkPlayers()
    mkMatch(ids)
    snap = mkShare(mode="snapshot")[1]["id"]
    live = mkShare(mode="live")[1]["id"]
    mkMatch(ids, date="2026-03-01")
    assert len(public(snap)[1]["matches"]) == 1
    assert len(public(live)[1]["matches"]) == 2


def test_live_reruns_filters(db):
    ids = mkPlayers()
    mkMatch(ids, date="2026-01-10")
    live = mkShare(mode="live", filters={"dateFrom": "2026-02-01"})[1]["id"]
    assert public(live)[1]["matches"] == []
    mkMatch(ids, date="2026-02-05")
    assert len(public(live)[1]["matches"]) == 1


def test_snapshot_cap_500(db):
    ids = mkPlayers()
    for i in range(501):
        db.rows[("USER#alice", f"SQUASH#MATCH#m{i:04d}")] = {
            "PK": {"S": "USER#alice"}, "SK": {"S": f"SQUASH#MATCH#m{i:04d}"}, "date": {"S": "2026-01-01"},
            "teamAPlayer1Id": {"S": ids[0]}, "teamAPlayer2Id": {"S": ids[1]}, "teamBPlayer1Id": {"S": ids[2]},
            "teamBPlayer2Id": {"S": ids[3]}, "winningTeam": {"S": "A"}, "teamAGames": {"N": "3"},
            "teamBGames": {"N": "0"}, "tags": {"L": []}}
    assert mkShare(mode="snapshot")[0] == 400
    assert mkShare(mode="live")[0] == 201
    assert mkShare(mode="snapshot", filters={"playerIds": ["zzz"]})[0] == 201


def test_put_refresh_resnapshots(db):
    ids = mkPlayers()
    mkMatch(ids)
    sid = mkShare()[1]["id"]
    mkMatch(ids, date="2026-03-01")
    assert call("/squash/shares", "PUT", {"id": sid, "title": "new"})[0] == 200
    assert len(public(sid)[1]["matches"]) == 1  # title change does not re-snapshot
    s, b = call("/squash/shares", "PUT", {"id": sid, "refresh": True})
    assert s == 200 and b["title"] == "new"
    assert len(public(sid)[1]["matches"]) == 2


def test_put_filters_change_resnapshots_and_mode_switch(db):
    ids = mkPlayers()
    mkMatch(ids, date="2026-01-01")
    mkMatch(ids, date="2026-05-01")
    sid = mkShare()[1]["id"]
    assert len(public(sid)[1]["matches"]) == 2
    call("/squash/shares", "PUT", {"id": sid, "filters": {"dateFrom": "2026-04-01"}})
    assert len(public(sid)[1]["matches"]) == 1
    call("/squash/shares", "PUT", {"id": sid, "mode": "live"})
    row = db.rows[("SQUASH#SHARE#" + sid, "METADATA")]
    assert "snapshot" not in row and public(sid)[1]["mode"] == "live"
    call("/squash/shares", "PUT", {"id": sid, "mode": "snapshot"})
    assert "snapshot" in db.rows[("SQUASH#SHARE#" + sid, "METADATA")]


def test_put_expires_resets_from_now(db):
    sid = mkShare(expiresInDays=5)[1]["id"]
    with patch("api.squash._now", return_value=NOW + 1000):
        s, b = call("/squash/shares", "PUT", {"id": sid, "expiresInDays": 10})
    assert s == 200 and b["expiresAt"] == NOW + 1000 + 10 * 86400
    assert db.rows[("SQUASH#SHARE#" + sid, "METADATA")]["expiresAt"] == {"N": str(NOW + 1000 + 864000)}
    assert call("/squash/shares", "PUT", {"id": sid, "expiresInDays": True})[0] == 400
    assert call("/squash/shares", "PUT", {"id": sid, "expiresInDays": 0})[0] == 400


def test_put_expired_share_404_and_missing_id_400(db):
    sid = mkShare()[1]["id"]
    assert call("/squash/shares", "PUT", {})[0] == 400
    db.rows[("SQUASH#SHARE#" + sid, "METADATA")]["expiresAt"] = {"N": str(NOW)}
    assert call("/squash/shares", "PUT", {"id": sid, "title": "x"})[0] == 404
    assert call("/squash/shares", "DELETE", qs={"id": sid})[0] == 404


def test_delete_share_then_public_404(db):
    sid = mkShare()[1]["id"]
    assert public(sid)[0] == 200
    assert call("/squash/shares", "DELETE", qs={"id": sid})[0] == 200
    assert public(sid)[0] == 404


# ---------------------------------------------------------------- migration

def _migrate():
    p = Path(__file__).resolve().parents[3] / "scripts" / "migrate-squash-to-user.py"
    spec = importlib.util.spec_from_file_location("migrate_squash", p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_migration_transform_player_and_match():
    m = _migrate()
    player = {"PK": {"S": "SQUASH#PLAYER#p1"}, "SK": {"S": "METADATA"}, "name": {"S": "Al"},
              "email": {"S": "e"}, "userId": {"S": "u"}, "entityType": {"S": "SQUASH_PLAYER"},
              "entitySk": {"S": "SQUASH#PLAYER#p1"}, "createdAt": {"S": "c"}}
    out = m.transformRow(player, "sub1")
    assert out == {"PK": {"S": "USER#sub1"}, "SK": {"S": "SQUASH#PLAYER#p1"}, "name": {"S": "Al"},
                   "createdAt": {"S": "c"}}
    match = {"PK": {"S": "SQUASH#MATCH#m1"}, "SK": {"S": "METADATA"}, "date": {"S": "2026-01-01"},
             "squashDate": {"S": "2026-01-01"}, "matchId": {"S": "SQUASH#MATCH#m1"},
             "teamAPlayer1Id": {"S": "SQUASH#PLAYER#p1"}, "teamAPlayer2Id": {"S": "SQUASH#PLAYER#p2"},
             "teamBPlayer1Id": {"S": "p3"}, "teamBPlayer2Id": {"S": "SQUASH#PLAYER#p4"},
             "teamAGames": {"N": "3"}, "tags": {"L": []}, "entityType": {"S": "SQUASH_MATCH"},
             "entitySk": {"S": "x"}}
    out = m.transformRow(match, "sub1")
    assert out["PK"] == {"S": "USER#sub1"} and out["SK"] == {"S": "SQUASH#MATCH#m1"}
    assert [out[k]["S"] for k in m.PLAYER_FIELDS] == ["p1", "p2", "p3", "p4"]
    assert out["teamAGames"] == {"N": "3"}
    assert not {"squashDate", "matchId", "entityType", "entitySk"} & set(out)
    with pytest.raises(ValueError):
        m.transformRow(out, "sub1")
