#!/usr/bin/env python3
"""
Local CLI for phase-2 social post scheduling -- create/get/list/cancel/retry
against the direct-invoke socialApi handler (src/lambda/social/handler.py).
Mirrors scripts/social_invoke_bluesky.py's --profile/--region handling
exactly (same env-var translation, same DEFAULT_REGION, same botocore error
guard) -- see that script for the reasoning.

social/handler.py (and the storage/media/scheduling/alerts modules it wires
together) reads SOCIAL_TABLE, SOCIAL_MEDIA_BUCKET, SOCIAL_ALERT_TOPIC_ARN,
SOCIAL_SCHEDULE_GROUP, SOCIAL_PUBLISHER_ARN, and SOCIAL_SCHEDULER_ROLE_ARN at
import/module-load time. Rather than requiring the caller to export all six
by hand, this script resolves any that are missing from `terraform output`
(infra/outputs.tf) -- pass --no-terraform to skip that and rely on env vars
you've already set (e.g. in CI).

Usage:
    python scripts/social_schedule.py --action create --account bluesky:test \
        --text "hello" --at "2026-08-02T15:04:00Z" [--image uploads/me/post1/pic.jpg] \
        [--profile echo9] [--region us-east-1]
    python scripts/social_schedule.py --action get --post-id <id>
    python scripts/social_schedule.py --action list --month 2026-08
    python scripts/social_schedule.py --action cancel --post-id <id>
    python scripts/social_schedule.py --action retry --post-id <id> --account bluesky:test
    python scripts/social_schedule.py --action list --month 2026-08 --no-terraform

Requires local AWS credentials with permission to read/write the
fus-social-posts table and the fus-social schedule group (see infra/social.tf),
and (unless --no-terraform is passed) a `terraform` binary with initialized,
applied state in infra/.
"""
import argparse
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "lambda"))

# Terraform's home region for this repo (infra/versions.tf backend + var.awsRegion).
DEFAULT_REGION = "us-east-1"

# Repo-root-relative infra/ dir, so this script works regardless of cwd.
INFRA_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "infra"))

# How long to wait on `terraform output -json` before giving up and falling
# back to whatever env vars are already set.
TERRAFORM_TIMEOUT_SECONDS = 30

# SOCIAL_* env var social/handler.py's modules need -> the infra/outputs.tf
# output that provides it (see local.socialEnvVars in infra/social.tf, which
# is what actually populates these env vars on the deployed Lambdas).
SOCIAL_ENV_TERRAFORM_OUTPUTS = {
    "SOCIAL_TABLE": "socialPostsTableName",
    "SOCIAL_MEDIA_BUCKET": "socialMediaBucketName",
    "SOCIAL_ALERT_TOPIC_ARN": "socialAlertsTopicArn",
    "SOCIAL_SCHEDULE_GROUP": "socialScheduleGroupName",
    "SOCIAL_PUBLISHER_ARN": "socialPublisherArn",
    "SOCIAL_SCHEDULER_ROLE_ARN": "socialSchedulerRoleArn",
}


def _resolveSocialEnvFromTerraform():
    """Fill in any unset/empty SOCIAL_* env vars from a single
    `terraform output -json` call against infra/. An already-exported env
    var always wins -- this only fills gaps, so existing workflows/CI that
    export these directly keep working unchanged.

    Never raises: any terraform/parsing problem prints a short, actionable
    note to stderr and returns, leaving env vars exactly as they were. It is
    up to the caller to notice a still-missing required var and fail there.
    """
    missing = [name for name in SOCIAL_ENV_TERRAFORM_OUTPUTS if not os.environ.get(name)]
    if not missing:
        return  # caller's environment already has everything we'd look up

    try:
        proc = subprocess.run(
            ["terraform", f"-chdir={INFRA_DIR}", "output", "-json"],
            capture_output=True,
            text=True,
            timeout=TERRAFORM_TIMEOUT_SECONDS,
        )
    except FileNotFoundError:
        print(
            "Note: `terraform` not found on PATH -- skipping auto-config from "
            "terraform output. Export the SOCIAL_* env vars yourself, or install "
            "terraform, or pass --no-terraform to silence this.",
            file=sys.stderr,
        )
        return
    except subprocess.TimeoutExpired:
        print(
            f"Note: `terraform output` did not finish within {TERRAFORM_TIMEOUT_SECONDS}s -- "
            "skipping auto-config. Export the SOCIAL_* env vars yourself if this keeps happening.",
            file=sys.stderr,
        )
        return

    if proc.returncode != 0:
        stderrTail = "\n".join(proc.stderr.strip().splitlines()[-10:])
        print(
            "Note: `terraform output` failed -- skipping auto-config. If infra/ "
            "has no local state yet, run `terraform -chdir=infra init` (and apply) first.\n"
            f"{stderrTail}",
            file=sys.stderr,
        )
        return

    try:
        outputs = json.loads(proc.stdout)
    except json.JSONDecodeError:
        print(
            "Note: could not parse `terraform output -json` as JSON -- skipping auto-config.",
            file=sys.stderr,
        )
        return

    filled = []
    for envName, outputName in SOCIAL_ENV_TERRAFORM_OUTPUTS.items():
        if os.environ.get(envName):
            continue  # already set -- env always wins, don't even look it up
        entry = outputs.get(outputName)
        if entry is None:
            print(
                f"Note: terraform output '{outputName}' (needed for {envName}) is missing. "
                "Has infra/ been deployed with this output defined? Skipping this variable.",
                file=sys.stderr,
            )
            continue
        value = entry.get("value")
        if value:
            os.environ[envName] = str(value)
            filled.append(envName)

    if filled:
        print(f"Note: resolved {', '.join(filled)} from `terraform output` ({INFRA_DIR}).", file=sys.stderr)


def _applyTerraformConfig(noTerraform):
    """Thin wrapper around _resolveSocialEnvFromTerraform so --no-terraform
    can skip the lookup entirely without a subprocess ever being spawned."""
    if noTerraform:
        return
    _resolveSocialEnvFromTerraform()


def _requireSocialEnv():
    """Hard-fail with one clear message if, after terraform resolution (or
    --no-terraform), a required SOCIAL_* var is still unset -- better than
    letting social/handler.py's modules silently default to "" and fail
    confusingly deep inside a boto3 call."""
    stillMissing = [name for name in SOCIAL_ENV_TERRAFORM_OUTPUTS if not os.environ.get(name)]
    if stillMissing:
        print(
            "Error: missing required env var(s): " + ", ".join(stillMissing) + ".\n"
            "Either export them directly, or let this script resolve them via "
            "`terraform output` (needs infra/ initialized and applied -- see "
            "infra/outputs.tf and infra/social.tf).",
            file=sys.stderr,
        )
        sys.exit(1)


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
    parser.add_argument(
        "--no-terraform", dest="noTerraform", action="store_true",
        help="skip the automatic `terraform output` config lookup; use only "
             "SOCIAL_* env vars already present in the environment",
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

    # Resolve SOCIAL_* config from terraform output (unless --no-terraform)
    # before the handler import below, which is where social/handler.py's
    # modules read those env vars. Also happens after arg parsing so
    # `--help` works with no AWS creds, no terraform state, and no
    # terraform binary at all -- this is the whole point of the script.
    _applyTerraformConfig(args.noTerraform)
    _requireSocialEnv()

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
