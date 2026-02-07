"""
Thumbnail generation Lambda. Triggered by S3 PutObject on media/images/ or media/videos/.
- Images: copy to media/thumbnails/{mediaId}.jpg and update DynamoDB
- Videos: submit MediaConvert frame capture job; EventBridge invokes on completion to update DynamoDB
"""
import json
import logging
import os
import re

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ.get("TABLE_NAME", "")
MEDIA_BUCKET = os.environ.get("MEDIA_BUCKET", "")
MEDIACONVERT_ROLE_ARN = os.environ.get("MEDIACONVERT_ROLE_ARN", "")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")


def _extract_media_id(key):
    """Extract mediaId from S3 key: media/images/MEDIA#uuid/file.ext or media/videos/MEDIA#uuid/file.ext"""
    parts = key.split("/")
    if len(parts) >= 3 and parts[0] == "media" and parts[1] in ("images", "videos"):
        return parts[2]
    return None


def handler(event, context):
    """Process S3 event or MediaConvert completion event."""
    try:
        if "Records" in event:
            return _handle_s3_event(event)
        if "detail" in event and event.get("source") == "aws.mediaconvert":
            return _handle_mediaconvert_event(event)
        logger.warning("Unknown event format: %s", list(event.keys())[:5])
        return {"statusCode": 200, "body": "ignored"}
    except Exception as e:
        logger.exception("handler error: %s", e)
        raise


def _handle_s3_event(event):
    """Process S3 PutObject - trigger thumbnail generation."""
    import boto3

    for record in event.get("Records", []):
        bucket = record.get("s3", {}).get("bucket", {}).get("name", "")
        key = record.get("s3", {}).get("object", {}).get("key", "")
        if not bucket or not key:
            continue
        key = key.replace("%23", "#")
        media_id = _extract_media_id(key)
        if not media_id:
            logger.info("Skipping key (no mediaId): %s", key)
            continue
        if key.startswith("media/images/"):
            _process_image(bucket, key, media_id)
        elif key.startswith("media/videos/"):
            _process_video(bucket, key, media_id)
    return {"statusCode": 200, "body": "ok"}


def _process_image(bucket, key, media_id):
    """Copy image to thumbnails folder and update DynamoDB."""
    import boto3

    if not TABLE_NAME or not MEDIA_BUCKET:
        logger.warning("TABLE_NAME or MEDIA_BUCKET not set")
        return
    ext = key.split(".")[-1].lower() if "." in key else "jpg"
    if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
        ext = "jpg"
    thumb_key = f"media/thumbnails/{media_id}.{ext}"
    try:
        s3 = boto3.client("s3", region_name=AWS_REGION)
        s3.copy_object(
            Bucket=bucket,
            CopySource={"Bucket": bucket, "Key": key},
            Key=thumb_key,
        )
        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": media_id}, "SK": {"S": "METADATA"}},
            UpdateExpression="SET thumbnailKey = :tk, updatedAt = :now",
            ExpressionAttributeValues={
                ":tk": {"S": thumb_key},
                ":now": {"S": __import__("datetime").datetime.utcnow().isoformat() + "Z"},
            },
        )
        logger.info("Image thumbnail: %s -> %s", key, thumb_key)
    except Exception as e:
        logger.warning("_process_image failed: %s", e)


def _process_video(bucket, key, media_id):
    """Submit MediaConvert frame capture job."""
    if not MEDIACONVERT_ROLE_ARN:
        logger.warning("MEDIACONVERT_ROLE_ARN not set")
        return
    try:
        import boto3

        mc = boto3.client("mediaconvert", region_name=AWS_REGION)
        account = mc.describe_endpoints()["Endpoints"][0]["Url"]
        mc = boto3.client("mediaconvert", region_name=AWS_REGION, endpoint_url=account)

        input_path = f"s3://{bucket}/{key}"
        output_prefix = f"s3://{bucket}/media/thumbnails/mc_{media_id.replace('#', '_')}"
        thumb_key = f"media/thumbnails/{media_id}.jpg"

        job = mc.create_job(
            Role=MEDIACONVERT_ROLE_ARN,
            UserMetadata={"mediaId": media_id, "thumbnailKey": thumb_key},
            Settings={
                "Inputs": [
                    {
                        "FileInput": input_path,
                        "VideoSelector": {"DefaultSelection": "DEFAULT"},
                    }
                ],
                "OutputGroups": [
                    {
                        "Name": "File Group",
                        "OutputGroupSettings": {
                            "Type": "FILE_GROUP_SETTINGS",
                            "FileGroupSettings": {"Destination": output_prefix},
                        },
                        "Outputs": [
                            {
                                "NameModifier": "",
                                "ContainerSettings": {"Container": "RAW"},
                                "VideoDescription": {
                                    "Width": 640,
                                    "Height": 360,
                                    "ScalingBehavior": "DEFAULT",
                                    "CodecSettings": {
                                        "Codec": "FRAME_CAPTURE",
                                        "FrameCaptureSettings": {
                                            "FramerateNumerator": 30,
                                            "FramerateDenominator": 30,
                                            "MaxCaptures": 2,
                                        },
                                    },
                                },
                            }
                        ],
                    }
                ],
            },
        )
        logger.info("MediaConvert job submitted: %s for %s", job["Job"]["Id"], media_id)
    except Exception as e:
        logger.exception("_process_video failed: %s", e)


def _handle_mediaconvert_event(event):
    """Handle MediaConvert job state change - update DynamoDB when COMPLETE."""
    import boto3

    detail = event.get("detail", {})
    status = detail.get("status", "")
    if status != "COMPLETE":
        logger.info("MediaConvert job %s status: %s", detail.get("jobId"), status)
        return {"statusCode": 200, "body": "ok"}

    media_id = detail.get("userMetadata", {}).get("mediaId", "")
    thumbnail_key = detail.get("userMetadata", {}).get("thumbnailKey", "")
    if not media_id or not thumbnail_key:
        logger.warning("Missing mediaId or thumbnailKey in job metadata")
        return {"statusCode": 200, "body": "ok"}

    job_id = detail.get("jobId", "")
    if not job_id:
        return {"statusCode": 200, "body": "ok"}

    try:
        mc = boto3.client("mediaconvert", region_name=AWS_REGION)
        account = mc.describe_endpoints()["Endpoints"][0]["Url"]
        mc = boto3.client("mediaconvert", region_name=AWS_REGION, endpoint_url=account)
        job = mc.get_job(Id=job_id)
        job_data = job.get("Job", {})
        output_groups = job_data.get("OutputGroupDetails", [])
        src_key = None
        bucket = MEDIA_BUCKET
        for og in output_groups:
            for od in og.get("OutputDetails", []):
                for path in od.get("OutputFilePaths", []):
                    match = re.search(r"s3://([^/]+)/(.+)", path)
                    if match:
                        bucket, src_key = match.group(1), match.group(2)
                        break
            if src_key:
                break
        if not src_key:
            logger.warning("No output file path in job %s", job_id)
            return {"statusCode": 200, "body": "ok"}

        s3 = boto3.client("s3", region_name=AWS_REGION)
        s3.copy_object(
            Bucket=bucket,
            CopySource={"Bucket": bucket, "Key": src_key},
            Key=thumbnail_key,
        )
        s3.delete_object(Bucket=bucket, Key=src_key)
        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": media_id}, "SK": {"S": "METADATA"}},
            UpdateExpression="SET thumbnailKey = :tk, updatedAt = :now",
            ExpressionAttributeValues={
                ":tk": {"S": thumbnail_key},
                ":now": {"S": __import__("datetime").datetime.utcnow().isoformat() + "Z"},
            },
        )
        logger.info("Video thumbnail updated: %s", thumbnail_key)
    except Exception as e:
        logger.exception("_handle_mediaconvert_event failed: %s", e)
    return {"statusCode": 200, "body": "ok"}
