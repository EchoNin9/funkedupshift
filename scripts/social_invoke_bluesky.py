#!/usr/bin/env python3
"""
Local CLI to invoke the Bluesky publisher Lambda handler directly — no
deploy needed. Phase 1 of the social scheduling module (see
src/lambda/social/).

Usage:
    python scripts/social_invoke_bluesky.py --account test --text "hello" \
        [--profile echo9] [--region us-east-1] \
        [--image path/to/pic.jpg] [--alt "a description of the image"]

Requires local AWS credentials (the usual chain: env vars, ~/.aws/credentials,
SSO, etc.) with permission to read:
    /funkedupshift/social/bluesky/{account}/handle
    /funkedupshift/social/bluesky/{account}/app-password
"""
import argparse
import base64
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "lambda"))

# Terraform's home region for this repo (infra/versions.tf backend + var.awsRegion).
DEFAULT_REGION = "us-east-1"


def _buildMedia(imagePath, alt):
    if not imagePath:
        return []
    with open(imagePath, "rb") as f:
        raw = f.read()
    mimeType = "image/png" if imagePath.lower().endswith(".png") else "image/jpeg"
    return [{
        "bytes": base64.b64encode(raw).decode("ascii"),
        "mimeType": mimeType,
        "alt": alt or "",
    }]


def main():
    parser = argparse.ArgumentParser(description="Invoke the Bluesky publisher Lambda handler locally.")
    parser.add_argument("--account", required=True, help="accountId used to look up SSM credentials")
    parser.add_argument("--text", required=True, help="post text")
    parser.add_argument("--image", help="path to an image to attach (optional)")
    parser.add_argument("--alt", default="", help="alt text for --image")
    parser.add_argument("--profile", help="AWS profile (default: $AWS_PROFILE, else the boto3 default chain)")
    parser.add_argument("--region", default=None,
                        help="AWS region for SSM (default: $AWS_REGION/$AWS_DEFAULT_REGION, else us-east-1)")
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
    # deploy — this is the whole point of the script.
    from social.handler import handler as socialHandler

    event = {
        "accountId": args.account,
        "platform": "bluesky",
        "text": args.text,
        "media": _buildMedia(args.image, args.alt),
        "links": [],
    }

    # AWS-side problems (expired SSO token, wrong profile, no ssm:GetParameter)
    # surface here as botocore exceptions. Print the message, not a 40-line
    # traceback — the fix is almost always "use --profile" or "log in again".
    from botocore.exceptions import BotoCoreError, ClientError

    try:
        result = socialHandler(event, None)
    except (BotoCoreError, ClientError) as e:
        print(f"AWS error: {e}")
        print("Hint: pass --profile <name> (e.g. --profile echo9), or refresh expired credentials.")
        sys.exit(1)

    if result.get("ok"):
        print(f"Posted: {result.get('permalink')}")
        return

    if result.get("errors"):
        print("Validation failed:")
        for e in result["errors"]:
            print(f"  - {e}")
        sys.exit(1)

    print(f"Publish failed: {result.get('error')}")
    sys.exit(1)


if __name__ == "__main__":
    main()
