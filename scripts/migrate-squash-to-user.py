#!/usr/bin/env python3
"""Move global squash players/matches (SQUASH#PLAYER#/SQUASH#MATCH# METADATA rows)
into one owner's partition (PK=USER#<sub>), keeping uuids, then delete the old
rows and the per-player MATCH# link rows. Idempotent: re-running finds nothing
left in the old shape.

  scripts/migrate-squash-to-user.py --owner-sub SUB --table NAME \
      [--profile P] [--region R] [--dry-run]
"""
import argparse

OLD_P, OLD_M = "SQUASH#PLAYER#", "SQUASH#MATCH#"
DROP = {"PK", "SK", "entityType", "entitySk", "squashDate", "matchId", "email", "userId"}
PLAYER_FIELDS = ("teamAPlayer1Id", "teamAPlayer2Id", "teamBPlayer1Id", "teamBPlayer2Id")


def _bare(v, prefix):
    return v[len(prefix):] if v.startswith(prefix) else v


def transformRow(item, ownerSub):
    """Pure: old low-level DynamoDB item (player or match) -> new owner-partition item."""
    pk = item["PK"]["S"]
    if pk.startswith(OLD_P):
        new = {"PK": {"S": f"USER#{ownerSub}"}, "SK": {"S": OLD_P + pk[len(OLD_P):]}}
    elif pk.startswith(OLD_M):
        new = {"PK": {"S": f"USER#{ownerSub}"}, "SK": {"S": OLD_M + pk[len(OLD_M):]}}
    else:
        raise ValueError("not an old squash row: " + pk)
    for k, v in item.items():
        if k in DROP:
            continue
        if k in PLAYER_FIELDS:
            v = {"S": _bare(v["S"], OLD_P)}
        new[k] = v
    return new


def _queryAll(db, **kw):
    while True:
        res = db.query(**kw)
        yield from res.get("Items", [])
        if not res.get("LastEvaluatedKey"):
            return
        kw["ExclusiveStartKey"] = res["LastEvaluatedKey"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--owner-sub", required=True)
    ap.add_argument("--table", required=True)
    ap.add_argument("--profile")
    ap.add_argument("--region")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    import boto3
    db = boto3.Session(profile_name=a.profile, region_name=a.region).client("dynamodb")
    counts = {"players": 0, "matches": 0, "links": 0}
    for et, key in (("SQUASH_PLAYER", "players"), ("SQUASH_MATCH", "matches")):
        for item in _queryAll(db, TableName=a.table, IndexName="byEntity",
                              KeyConditionExpression="entityType = :et",
                              ExpressionAttributeValues={":et": {"S": et}}):
            if item["SK"]["S"] != "METADATA":
                continue
            counts[key] += 1
            old_key = {"PK": item["PK"], "SK": item["SK"]}
            if not a.dry_run:
                db.put_item(TableName=a.table, Item=transformRow(item, a.owner_sub))
            if key == "players":
                for link in _queryAll(db, TableName=a.table,
                                      KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
                                      ExpressionAttributeValues={":pk": item["PK"], ":sk": {"S": "MATCH#"}}):
                    counts["links"] += 1
                    if not a.dry_run:
                        db.delete_item(TableName=a.table, Key={"PK": link["PK"], "SK": link["SK"]})
            if not a.dry_run:
                db.delete_item(TableName=a.table, Key=old_key)
    print(("DRY RUN " if a.dry_run else "") + f"players={counts['players']} matches={counts['matches']} link_rows={counts['links']}")


if __name__ == "__main__":
    main()
