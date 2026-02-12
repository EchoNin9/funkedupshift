"""
Thumbnail generation Lambda. Triggered by S3 PutObject on media/images/ or media/videos/.
- Images: copy to media/thumbnails/{mediaId_safe}.ext and update DynamoDB (mediaId_safe = mediaId with # replaced by _)
- Videos: submit MediaConvert frame capture + minimal video job; EventBridge invokes on completion to update DynamoDB
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
    """Process S3 event, MediaConvert completion event, or API-triggered regenerate."""
    try:
        if "Records" in event:
            return _handle_s3_event(event)
        if "detail" in event and event.get("source") == "aws.mediaconvert":
            return _handle_mediaconvert_event(event)
        if event.get("source") == "api" and event.get("action") == "regenerate":
            return _handle_regenerate(event)
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
    thumb_key = f"media/thumbnails/{media_id.replace('#', '_')}.{ext}"
    try:
        s3 = boto3.client("s3", region_name=AWS_REGION)
        s3.copy_object(
            Bucket=bucket,
            CopySource={"Bucket": bucket, "Key": key},
            Key=thumb_key,
        )
        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        current = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": media_id}, "SK": {"S": "METADATA"}},
            ProjectionExpression="thumbnailKey",
        )
        current_thumb = (current.get("Item") or {}).get("thumbnailKey", {}).get("S", "")
        if "_custom" in current_thumb:
            logger.info("Skipping thumbnail update: custom thumbnail already set for %s", media_id)
            return
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


def _process_video(bucket, key, media_id, use_first_frame=False):
    """Submit MediaConvert frame capture job.
    use_first_frame: if True, capture first frame (for videos under 4 sec).
    Otherwise capture frame between 3-4 seconds."""
    if not MEDIACONVERT_ROLE_ARN:
        logger.warning("MEDIACONVERT_ROLE_ARN not set")
        return
    try:
        import boto3

        mc = boto3.client("mediaconvert", region_name=AWS_REGION)
        account = mc.describe_endpoints()["Endpoints"][0]["Url"]
        mc = boto3.client("mediaconvert", region_name=AWS_REGION, endpoint_url=account)

        input_path = f"s3://{bucket}/{key}"
        media_id_safe = media_id.replace("#", "_")
        frame_prefix = f"s3://{bucket}/media/thumbnails/mc_{media_id_safe}"
        temp_video_prefix = f"s3://{bucket}/media/thumbnails/_temp/{media_id_safe}"
        thumb_key = f"media/thumbnails/{media_id_safe}.jpg"

        if use_first_frame:
            input_clipping = {
                "StartTimecode": "00:00:00:00",
                "EndTimecode": "00:00:01:00",
            }
        else:
            input_clipping = {
                "StartTimecode": "00:00:03:00",
                "EndTimecode": "00:00:04:00",
            }

        user_metadata = {
            "mediaId": media_id,
            "thumbnailKey": thumb_key,
            "bucket": bucket,
            "originalKey": key,
        }
        if use_first_frame:
            user_metadata["retryCount"] = "1"

        job = mc.create_job(
            Role=MEDIACONVERT_ROLE_ARN,
            UserMetadata=user_metadata,
            Settings={
                "Inputs": [
                    {
                        "FileInput": input_path,
                        "VideoSelector": {"DefaultSelection": "DEFAULT"},
                        "InputClippings": [input_clipping],
                    }
                ],
                "OutputGroups": [
                    {
                        "Name": "File Group",
                        "OutputGroupSettings": {
                            "Type": "FILE_GROUP_SETTINGS",
                            "FileGroupSettings": {"Destination": frame_prefix},
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
                                            "MaxCaptures": 1,
                                        },
                                    },
                                },
                            }
                        ],
                    },
                    {
                        "Name": "File Group",
                        "OutputGroupSettings": {
                            "Type": "FILE_GROUP_SETTINGS",
                            "FileGroupSettings": {"Destination": temp_video_prefix},
                        },
                        "Outputs": [
                            {
                                "NameModifier": "_temp",
                                "ContainerSettings": {
                                    "Container": "MP4",
                                    "Mp4Settings": {
                                        "CslgAtom": "INCLUDE",
                                        "FreeSpaceBox": "EXCLUDE",
                                        "MoovPlacement": "PROGRESSIVE_DOWNLOAD",
                                    },
                                },
                                "VideoDescription": {
                                    "Width": 320,
                                    "Height": 180,
                                    "ScalingBehavior": "DEFAULT",
                                    "CodecSettings": {
                                        "Codec": "H_264",
                                        "H264Settings": {
                                            "Bitrate": 200000,
                                            "CodecProfile": "BASELINE",
                                            "FramerateControl": "INITIALIZE_FROM_SOURCE",
                                            "RateControlMode": "CBR",
                                            "InterlaceMode": "PROGRESSIVE",
                                        },
                                    },
                                },
                            }
                        ],
                    },
                ],
            },
        )
        logger.info(
            "MediaConvert job submitted: %s for %s (first_frame=%s)",
            job["Job"]["Id"],
            media_id,
            use_first_frame,
        )
    except Exception as e:
        logger.exception("_process_video failed: %s", e)


def _handle_regenerate(event):
    """API-triggered thumbnail regeneration for a video. Clears existing thumbnail and submits MediaConvert job."""
    import boto3

    media_id = (event.get("mediaId") or "").strip()
    if not media_id or not media_id.startswith("MEDIA#"):
        logger.warning("regenerate: invalid mediaId")
        return {"statusCode": 400, "body": json.dumps({"error": "mediaId required"})}
    if not TABLE_NAME or not MEDIA_BUCKET:
        logger.warning("TABLE_NAME or MEDIA_BUCKET not set")
        return {"statusCode": 500, "body": json.dumps({"error": "server misconfigured"})}
    try:
        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": media_id}, "SK": {"S": "METADATA"}},
            ProjectionExpression="mediaKey, mediaType, thumbnailKey",
        )
        item = resp.get("Item") or {}
        media_key = (item.get("mediaKey", {}).get("S") or "").strip()
        media_type = (item.get("mediaType", {}).get("S") or "").strip().lower()
        if media_type != "video":
            return {"statusCode": 400, "body": json.dumps({"error": "only videos can regenerate thumbnail"})}
        if not media_key.startswith("media/videos/"):
            return {"statusCode": 400, "body": json.dumps({"error": "invalid media key"})}
        current_thumb = (item.get("thumbnailKey", {}).get("S") or "").strip()
        if current_thumb and "_custom" in current_thumb:
            try:
                s3 = boto3.client("s3", region_name=AWS_REGION)
                s3.delete_object(Bucket=MEDIA_BUCKET, Key=current_thumb)
            except Exception as e:
                logger.warning("Failed to delete custom thumbnail %s: %s", current_thumb, e)
        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": media_id}, "SK": {"S": "METADATA"}},
            UpdateExpression="REMOVE thumbnailKey SET updatedAt = :now",
            ExpressionAttributeValues={
                ":now": {"S": __import__("datetime").datetime.utcnow().isoformat() + "Z"},
            },
        )
        _process_video(MEDIA_BUCKET, media_key, media_id)
        return {"statusCode": 200, "body": json.dumps({"ok": True, "message": "Thumbnail regeneration started"})}
    except Exception as e:
        logger.exception("_handle_regenerate failed: %s", e)
        return {"statusCode": 500, "body": json.dumps({"error": str(e)})}


def _submit_first_frame_fallback(media_id, thumbnail_key, bucket, original_key):
    """Retry with first frame when 3-4 second capture fails (video too short)."""
    if not media_id or not thumbnail_key or not bucket or not original_key:
        logger.warning("Missing metadata for first-frame fallback")
        return
    logger.info("Retrying with first frame for %s (video likely under 4 sec)", media_id)
    _process_video(bucket, original_key, media_id, use_first_frame=True)


def _handle_mediaconvert_event(event):
    """Handle MediaConvert job state change - update DynamoDB when COMPLETE, retry with first frame on ERROR."""
    import boto3

    detail = event.get("detail", {})
    status = detail.get("status", "")
    user_meta = detail.get("userMetadata", {})

    if status == "ERROR":
        retry_count = int(user_meta.get("retryCount", "0"))
        if retry_count > 0:
            logger.warning("MediaConvert job %s failed after first-frame retry", detail.get("jobId"))
            return {"statusCode": 200, "body": "ok"}
        media_id = user_meta.get("mediaId", "")
        thumbnail_key = user_meta.get("thumbnailKey", "")
        bucket = user_meta.get("bucket", "")
        original_key = user_meta.get("originalKey", "")
        _submit_first_frame_fallback(media_id, thumbnail_key, bucket, original_key)
        return {"statusCode": 200, "body": "ok"}

    if status != "COMPLETE":
        logger.info("MediaConvert job %s status: %s", detail.get("jobId"), status)
        return {"statusCode": 200, "body": "ok"}

    media_id = user_meta.get("mediaId", "")
    thumbnail_key = user_meta.get("thumbnailKey", "")
    if not media_id or not thumbnail_key:
        logger.warning("Missing mediaId or thumbnailKey in job metadata")
        return {"statusCode": 200, "body": "ok"}

    job_id = detail.get("jobId", "")
    if not job_id:
        return {"statusCode": 200, "body": "ok"}

    try:
        output_groups = detail.get("outputGroupDetails") or detail.get("OutputGroupDetails")
        if not output_groups:
            logger.info("No outputGroupDetails in event, fetching job %s via get_job", job_id)
            mc = boto3.client("mediaconvert", region_name=AWS_REGION)
            account = mc.describe_endpoints()["Endpoints"][0]["Url"]
            mc = boto3.client("mediaconvert", region_name=AWS_REGION, endpoint_url=account)
            job = mc.get_job(Id=job_id)
            output_groups = job.get("Job", {}).get("OutputGroupDetails", [])

        src_key = None
        bucket = MEDIA_BUCKET
        temp_keys_to_delete = []
        for og in output_groups:
            output_details = og.get("OutputDetails") or og.get("outputDetails") or []
            for od in output_details:
                paths = od.get("OutputFilePaths") or od.get("outputFilePaths") or []
                for path in paths:
                    match = re.search(r"s3://([^/]+)/(.+)", path)
                    if match:
                        b, k = match.group(1), match.group(2)
                        if k.lower().endswith(".jpg"):
                            bucket, src_key = b, k
                        else:
                            temp_keys_to_delete.append((b, k))
        if not src_key:
            logger.warning("No .jpg output file path in job %s (outputGroupCount=%s)", job_id, len(output_groups))
            return {"statusCode": 200, "body": "ok"}

        logger.info("MediaConvert COMPLETE: jobId=%s, src_key=%s, temp_keys=%s", job_id, src_key, len(temp_keys_to_delete))
        s3 = boto3.client("s3", region_name=AWS_REGION)
        s3.copy_object(
            Bucket=bucket,
            CopySource={"Bucket": bucket, "Key": src_key},
            Key=thumbnail_key,
        )
        s3.delete_object(Bucket=bucket, Key=src_key)
        for b, k in temp_keys_to_delete:
            try:
                s3.delete_object(Bucket=b, Key=k)
            except Exception as e:
                logger.warning("Failed to delete temp output %s: %s", k, e)
        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        current = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": media_id}, "SK": {"S": "METADATA"}},
            ProjectionExpression="thumbnailKey",
        )
        current_thumb = (current.get("Item") or {}).get("thumbnailKey", {}).get("S", "")
        if "_custom" in current_thumb:
            logger.info("Skipping thumbnail update: custom thumbnail already set for %s", media_id)
            return {"statusCode": 200, "body": "ok"}
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
