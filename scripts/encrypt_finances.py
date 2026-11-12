#!/usr/bin/env python3
"""
FUNK-78: encrypt existing Personal Finances data in place (field-level, via api.bpf_crypto).

  AWS_PROFILE=echo9 python scripts/encrypt_finances.py --table <name> --key-id <arn> [--apply] [--verify]

Default is a dry run (counts only, no KMS or write calls). --apply SETs only the
plaintext attributes, guarded by `updatedAt` still equalling the scanned value, so a
concurrent edit is skipped (re-run to pick it up) rather than clobbered. Idempotent:
attributes already "fe1:" are left alone. --verify reports plaintext attributes
remaining per item type and exits non-zero if any remain.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "lambda"))

# item type -> (SK match, attributes that must be sealed)
TYPES = {
    "transaction": ("prefix", "BPF#TXN#", ("amount", "payee", "notes", "category", "fitid")),
    "account": ("prefix", "BPF#ACCOUNT#", (
        "name", "bank", "accountNumber", "nickname", "openingBalance",
        "balance",  # legacy static balance (treated as the opening balance)
        "reconciledBalance", "csvMapping")),
    "settings": ("exact", "BPF#SETTINGS", ("categories",)),
    "budgets": ("exact", "BPF#BUDGETS", ("budgets",)),
    "rules": ("exact", "BPF#RULES", ("rules",)),
}


def item_type(sk):
    for name, (mode, key, _) in TYPES.items():
        if (mode == "prefix" and sk.startswith(key)) or (mode == "exact" and sk == key):
            return name
    return None  # DEK, SHARE#, SHAREDWITH#, anything else: not ours


def plaintext_attrs(item):
    """Attributes of `item` in the encrypt list that are not yet sealed."""
    from api import bpf_crypto
    t = item_type(item.get("SK", {}).get("S", ""))
    if not t:
        return t, []
    return t, [a for a in TYPES[t][2] if a in item and not bpf_crypto.is_encrypted(item[a])]


def scan_bpf(client, table):
    key = None
    while True:
        kwargs = {"TableName": table,
                  "FilterExpression": "begins_with(SK, :bpf)",
                  "ExpressionAttributeValues": {":bpf": {"S": "BPF#"}}}
        if key:
            kwargs["ExclusiveStartKey"] = key
        resp = client.scan(**kwargs)
        yield from resp.get("Items", [])
        key = resp.get("LastEvaluatedKey")
        if not key:
            return


def encrypt_items(client, table, apply):
    from api import bpf_crypto
    stats = {"scanned": 0, "needs_work": 0, "updated": 0, "skipped_conflict": 0, "attrs": 0}
    for item in scan_bpf(client, table):
        t, attrs = plaintext_attrs(item)
        if not attrs:
            continue
        stats["scanned"] += 1
        stats["needs_work"] += 1
        stats["attrs"] += len(attrs)
        if not apply:
            continue
        pk, sk = item["PK"]["S"], item["SK"]["S"]
        user_id = pk[len("USER#"):]
        names, values, sets = {}, {}, []
        for n, a in enumerate(attrs):
            plain = bpf_crypto.dec_attr(user_id, pk, sk, a, item[a])
            names[f"#a{n}"] = a
            values[f":v{n}"] = bpf_crypto.enc_attr(user_id, pk, sk, a, plain)
            sets.append(f"#a{n} = :v{n}")
        if "updatedAt" in item:
            cond = "updatedAt = :cur"
            values[":cur"] = item["updatedAt"]
        else:
            cond = "attribute_not_exists(updatedAt)"
        try:
            client.update_item(
                TableName=table, Key={"PK": item["PK"], "SK": item["SK"]},
                UpdateExpression="SET " + ", ".join(sets),
                ConditionExpression=cond,
                ExpressionAttributeNames=names, ExpressionAttributeValues=values)
            stats["updated"] += 1
        except Exception as e:  # noqa: BLE001
            if getattr(e, "response", {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException":
                stats["skipped_conflict"] += 1
            else:
                raise
    return stats


def verify(client, table):
    """{item type: plaintext attribute count} for all finance items."""
    remaining = {t: 0 for t in TYPES}
    for item in scan_bpf(client, table):
        t, attrs = plaintext_attrs(item)
        if t:
            remaining[t] += len(attrs)
    return remaining


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--table", required=True)
    ap.add_argument("--key-id", required=True, help="finances KMS key ARN")
    ap.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    ap.add_argument("--verify", action="store_true", help="report remaining plaintext; non-zero if any")
    args = ap.parse_args(argv)
    os.environ["TABLE_NAME"] = args.table
    os.environ["FINANCE_KMS_KEY_ID"] = args.key_id
    import boto3
    client = boto3.client("dynamodb")
    if args.verify:
        remaining = verify(client, args.table)
        for t, n in remaining.items():
            print(f"{t}: {n} plaintext attribute(s) remaining")
        return 1 if any(remaining.values()) else 0
    stats = encrypt_items(client, args.table, args.apply)
    mode = "APPLY" if args.apply else "DRY RUN"
    print(f"[{mode}] items needing encryption: {stats['needs_work']} "
          f"({stats['attrs']} attributes)")
    if args.apply:
        print(f"updated: {stats['updated']}, skipped (concurrent edit, re-run): "
              f"{stats['skipped_conflict']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
