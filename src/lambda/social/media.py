"""
S3 helpers for social media uploads (src/lambda/social/media.py).

Key convention: uploads/{createdBy}/{postId}/{filename}
"""
import logging
import os

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

SOCIAL_MEDIA_BUCKET = os.environ.get("SOCIAL_MEDIA_BUCKET", "")

_s3 = None


def _client():
    global _s3
    if _s3 is None:
        import boto3
        _s3 = boto3.client("s3")
    return _s3


def buildKey(createdBy, postId, filename):
    return f"uploads/{createdBy}/{postId}/{filename}"


def presignPut(key, contentType, expiresIn=3600):
    """Presigned URL for a direct browser upload (phase 4)."""
    return _client().generate_presigned_url(
        "put_object",
        Params={"Bucket": SOCIAL_MEDIA_BUCKET, "Key": key, "ContentType": contentType},
        ExpiresIn=expiresIn,
    )


def presignGet(key, expiresIn=3600):
    """Presigned URL so a platform (e.g. Meta, phase 3) can fetch media by URL."""
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": SOCIAL_MEDIA_BUCKET, "Key": key},
        ExpiresIn=expiresIn,
    )


def getBytes(key):
    resp = _client().get_object(Bucket=SOCIAL_MEDIA_BUCKET, Key=key)
    return resp["Body"].read()


def deleteObject(key):
    _client().delete_object(Bucket=SOCIAL_MEDIA_BUCKET, Key=key)
