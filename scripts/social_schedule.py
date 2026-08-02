#!/usr/bin/env python3
"""
Local CLI for phase-2 social post scheduling -- create/get/list/cancel/retry
against the direct-invoke socialApi handler (src/lambda/social/handler.py).
Mirrors scripts/social_invoke_bluesky.py's --profile/--region handling
exactly (same env-var translation, same DEFAULT_REGION, same botocore error
guard) -- see that script for the reasoning.

Usage:
    python scripts/social_schedule.py --action create --account bluesky:test \
        --text "hello" --at "2026-08-02T15:04:00Z" [--image uploads/me/post1/pic.jpg] \
        [--profile echo9] [--region us-east-1]
    python scripts/social_schedule.py --action get --post-id <id>
    python scripts/social_schedule.py --action list --month 2026-08
    python scripts/social_schedule.py --action cancel --post-id <id>
    python scripts/social_schedule.py --action retry --post-id <id> --account bluesky:test

Requires local AWS credentials with permission to read/write the
fus-social-posts table and the fus-social schedule group (see infra/social.tf).
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "lambda"))

# Terraform's home region for this repo (infra/versions.tf backend + var.awsRegion).
DEFAULT_REGION = "us-east-1"


def _parseAccount(raw):
    """'platform:accountId' -> {"platform":, "accountId":, "overrides": {}}.
    A bare accountId (no colon) defaults to platform=bluesky."""
    if ":" in raw:
        platform, accountId = raw.split(":", 1)
    else:
        platform, accountId = "bluesky", raw
    return {"platform": platform, "accountId": accountId, "overrides": {}}


def _buildMediaKeys(imageKey):
    # This CLI does not upload media -- --image takes the S3 key of media
    # already uploaded under the uploads/ prefix (see social/media.py); the
    # publisher fetches it by key at publish time.
    return [imageKey] if imageKey else []


def main():
    parser = argparse.ArgumentParser(description="Create/inspect/cancel/retry scheduled social posts.")
    parser.add_argument("--action", required=True, choices=["create", "get", "list", "cancel", "retry"])
    parser.add_argument(
        "--account", action="append", default=[],
        help="platform:accountId, repeatable (create/retry)",
    )
    parser.add_argument("--text", default=None, help="post text (create)")
    parser.add_argument(
        "--at", dest="scheduledAt", default=None,
        help='ISO-8601 UTC scheduled time, e.g. "2026-08-02T15:04:00Z" (create)',
    )
    parser.add_argument("--image", default=None, help="S3 key of an already-uploaded image to attach (create)")
    parser.add_argument("--post-id", dest="postId", default=None, help="postId (get/cancel/retry)")
    parser.add_argument("--month", default=None, help="YYYY-MM (list)")
    parser.add_argument("--profile", help="AWS profile (default: $AWS_PROFILE, else the boto3 default chain)")
    parser.add_argument(
        "--region", default=None,
        help="AWS region (default: $AWS_REGION/$AWS_DEFAULT_REGION, else us-east-1)",
    )
    args = parser.parse_args()

    # boto3 does not see the --profile/--region flags, so translate them into
    # the env vars it reads. Must happen before the handler import below
    # creates any client. In Lambda, AWS_REGION is always set by the runtime;
    # locally it usually isn't, which is why we default it rather than letting
    # boto3 raise NoRegionError.
    if args.profile:
        os.environ["AWS_PROFILE"] = args.profile
    if args.region:
        os.environ["AWS_DEFAULT_REGION"] = args.region
    elif not os.environ.get("AWS_REGION") and not os.environ.get("AWS_DEFAULT_REGION"):
        os.environ["AWS_DEFAULT_REGION"] = DEFAULT_REGION

    # Imported after arg parsing so `--help` works without AWS creds or a
    # deploy -- this is the whole point of the script.
    from social.handler import handler as socialHandler

    if args.action == "create":
        if not args.text or not args.scheduledAt or not args.account:
            print("--action create requires --text, --at, and at least one --account")
            sys.exit(1)
        event = {
            "action": "create",
            "text": args.text,
            "scheduledAt": args.scheduledAt,
            "accounts": [_parseAccount(a) for a in args.account],
            "mediaKeys": _buildMediaKeys(args.image),
            "links": [],
            "createdBy": os.environ.get("USER", "cli"),
        }
    elif args.action == "get":
        if not args.postId:
            print("--action get requires --post-id")
            sys.exit(1)
        event = {"action": "get", "postId": args.postId}
    elif args.action == "list":
        if not args.month:
            print("--action list requires --month")
            sys.exit(1)
        event = {"action": "listMonth", "month": args.month}
    elif args.action == "cancel":
        if not args.postId:
            print("--action cancel requires --post-id")
            sys.exit(1)
        event = {"action": "cancel", "postId": args.postId}
    else:  # retry
        if not args.postId or not args.account:
            print("--action retry requires --post-id and one --account")
            sys.exit(1)
        target = _parseAccount(args.account[0])
        event = {
            "action": "retry",
            "postId": args.postId,
            "platform": target["platform"],
            "accountId": target["accountId"],
        }

    # AWS-side problems (expired SSO token, wrong profile, missing IAM grant)
    # surface here as botocore exceptions. Print the message, not a 40-line
    # traceback -- the fix is almost always "use --profile" or "log in again".
    from botocore.exceptions import BotoCoreError, ClientError

    try:
        result = socialHandler(event, None)
    except (BotoCoreError, ClientError) as e:
        print(f"AWS error: {e}")
        print("Hint: pass --profile <name> (e.g. --profile echo9), or refresh expired credentials.")
        sys.exit(1)

    print(json.dumps(result, indent=2, default=str))
    if not result.get("ok", False):
        sys.exit(1)


if __name__ == "__main__":
    main()
