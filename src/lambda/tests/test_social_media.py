"""Unit tests for social/media.py (S3 helpers, phase 2)."""
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def test_build_key_convention():
    from social.media import buildKey

    assert buildKey("user-123", "post1", "pic.jpg") == "uploads/user-123/post1/pic.jpg"


def test_presign_put_calls_boto3_with_bucket_key_content_type_and_expiry():
    from social import media

    client = MagicMock()
    client.generate_presigned_url.return_value = "https://signed-put-url"

    with patch.object(media, "SOCIAL_MEDIA_BUCKET", "fus-social-media-123"), \
         patch.object(media, "_client", return_value=client):
        url = media.presignPut("uploads/u/post1/pic.jpg", "image/jpeg", expiresIn=120)

    assert url == "https://signed-put-url"
    client.generate_presigned_url.assert_called_once_with(
        "put_object",
        Params={"Bucket": "fus-social-media-123", "Key": "uploads/u/post1/pic.jpg", "ContentType": "image/jpeg"},
        ExpiresIn=120,
    )


def test_presign_put_default_expiry_is_one_hour():
    from social import media

    client = MagicMock()
    with patch.object(media, "SOCIAL_MEDIA_BUCKET", "fus-social-media-123"), \
         patch.object(media, "_client", return_value=client):
        media.presignPut("k", "image/png")

    assert client.generate_presigned_url.call_args.kwargs["ExpiresIn"] == 3600


def test_presign_get_calls_boto3_with_bucket_key_and_expiry():
    from social import media

    client = MagicMock()
    client.generate_presigned_url.return_value = "https://signed-get-url"

    with patch.object(media, "SOCIAL_MEDIA_BUCKET", "fus-social-media-123"), \
         patch.object(media, "_client", return_value=client):
        url = media.presignGet("uploads/u/post1/pic.jpg", expiresIn=60)

    assert url == "https://signed-get-url"
    client.generate_presigned_url.assert_called_once_with(
        "get_object",
        Params={"Bucket": "fus-social-media-123", "Key": "uploads/u/post1/pic.jpg"},
        ExpiresIn=60,
    )


def test_get_bytes_reads_object_body():
    from social import media

    client = MagicMock()
    body = MagicMock()
    body.read.return_value = b"raw-bytes"
    client.get_object.return_value = {"Body": body}

    with patch.object(media, "SOCIAL_MEDIA_BUCKET", "fus-social-media-123"), \
         patch.object(media, "_client", return_value=client):
        raw = media.getBytes("uploads/u/post1/pic.jpg")

    assert raw == b"raw-bytes"
    client.get_object.assert_called_once_with(Bucket="fus-social-media-123", Key="uploads/u/post1/pic.jpg")


def test_delete_object_calls_boto3_delete():
    from social import media

    client = MagicMock()
    with patch.object(media, "SOCIAL_MEDIA_BUCKET", "fus-social-media-123"), \
         patch.object(media, "_client", return_value=client):
        media.deleteObject("uploads/u/post1/pic.jpg")

    client.delete_object.assert_called_once_with(Bucket="fus-social-media-123", Key="uploads/u/post1/pic.jpg")
