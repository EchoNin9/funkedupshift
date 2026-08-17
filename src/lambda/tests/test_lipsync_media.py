"""Unit tests for lipsync/media.py: S3 helpers (mocked boto3 client, no
moto -- matches social/test_social_media.py's conventions) plus the
stdlib-only duration probing (wav/mp4/mp3), which is exercised against
small hand-built byte fixtures rather than real media files."""
import struct
import sys
import wave
from io import BytesIO
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


# --- fixtures: minimal valid container bytes ----------------------------------


def _wavBytes(numFrames=44100, frameRate=44100, nChannels=1, sampWidth=2):
    buf = BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(nChannels)
        w.setsampwidth(sampWidth)
        w.setframerate(frameRate)
        w.writeframes(b"\x00" * (numFrames * nChannels * sampWidth))
    return buf.getvalue()


def _box(boxType, payload):
    return struct.pack(">I", 8 + len(payload)) + boxType.encode("ascii") + payload


def _mvhdPayload(timescale, duration, version=0):
    if version == 1:
        return (
            bytes([1, 0, 0, 0])
            + b"\x00" * 8  # creation_time
            + b"\x00" * 8  # modification_time
            + struct.pack(">I", timescale)
            + struct.pack(">Q", duration)
            + b"\x00" * 60  # rate/volume/reserved/matrix/next_track_id, not read
        )
    return (
        bytes([0, 0, 0, 0])
        + b"\x00" * 4  # creation_time
        + b"\x00" * 4  # modification_time
        + struct.pack(">I", timescale)
        + struct.pack(">I", duration)
        + b"\x00" * 40
    )


def _mp4Bytes(timescale=1000, duration=15500, version=0):
    ftyp = _box("ftyp", b"isom" + b"\x00" * 12)
    mvhd = _box("mvhd", _mvhdPayload(timescale, duration, version))
    moov = _box("moov", mvhd)
    return ftyp + moov


def _mp3FrameHeaderBytes(bitrateIndex=9, sampleRateIndex=0, versionBits=0b11, padding=0):
    """MPEG1 (versionBits=11) Layer III (layerBits=01) frame sync header.
    bitrateIndex=9 -> 128kbps in the MPEG1 Layer III table; sampleRateIndex=0
    -> 44100Hz."""
    b0 = 0xFF
    b1 = 0b11100000 | (versionBits << 3) | (0b01 << 1) | 1  # protection bit set (absent) arbitrarily
    b2 = (bitrateIndex << 4) | (sampleRateIndex << 2) | (padding << 1)
    b3 = 0xC4  # channel mode etc. -- not read by the parser
    return bytes([b0, b1, b2, b3])


# --- S3 helpers ----------------------------------------------------------------


def test_presign_put_calls_boto3_with_bucket_key_content_type_and_expiry():
    from lipsync import media

    client = MagicMock()
    client.generate_presigned_url.return_value = "https://signed-put-url"

    with patch.object(media, "LIPSYNC_MEDIA_BUCKET", "fus-lipsync-media-123"), \
         patch.object(media, "_client", return_value=client):
        url = media.presignPut("uploads/u/audio/x.wav", "audio/wav", expiresIn=120)

    assert url == "https://signed-put-url"
    client.generate_presigned_url.assert_called_once_with(
        "put_object",
        Params={"Bucket": "fus-lipsync-media-123", "Key": "uploads/u/audio/x.wav", "ContentType": "audio/wav"},
        ExpiresIn=120,
    )


def test_presign_get_calls_boto3_with_bucket_key_and_expiry():
    from lipsync import media

    client = MagicMock()
    client.generate_presigned_url.return_value = "https://signed-get-url"

    with patch.object(media, "LIPSYNC_MEDIA_BUCKET", "fus-lipsync-media-123"), \
         patch.object(media, "_client", return_value=client):
        url = media.presignGet("uploads/u/audio/x.wav", expiresIn=60)

    assert url == "https://signed-get-url"
    client.generate_presigned_url.assert_called_once_with(
        "get_object", Params={"Bucket": "fus-lipsync-media-123", "Key": "uploads/u/audio/x.wav"}, ExpiresIn=60,
    )


def test_get_bytes_reads_object_body():
    from lipsync import media

    client = MagicMock()
    body = MagicMock()
    body.read.return_value = b"raw-bytes"
    client.get_object.return_value = {"Body": body}

    with patch.object(media, "LIPSYNC_MEDIA_BUCKET", "fus-lipsync-media-123"), \
         patch.object(media, "_client", return_value=client):
        raw = media.getBytes("uploads/u/audio/x.wav")

    assert raw == b"raw-bytes"
    client.get_object.assert_called_once_with(Bucket="fus-lipsync-media-123", Key="uploads/u/audio/x.wav")


def test_put_bytes_calls_boto3_put_object():
    from lipsync import media

    client = MagicMock()
    with patch.object(media, "LIPSYNC_MEDIA_BUCKET", "fus-lipsync-media-123"), \
         patch.object(media, "_client", return_value=client):
        media.putBytes("outputs/j1/j1.mp4", b"vid-bytes", "video/mp4")

    client.put_object.assert_called_once_with(
        Bucket="fus-lipsync-media-123", Key="outputs/j1/j1.mp4", Body=b"vid-bytes", ContentType="video/mp4",
    )


def test_head_object_returns_metadata_when_found():
    from lipsync import media

    client = MagicMock()
    client.head_object.return_value = {"ContentLength": 12345, "ContentType": "image/jpeg"}
    with patch.object(media, "LIPSYNC_MEDIA_BUCKET", "fus-lipsync-media-123"), \
         patch.object(media, "_client", return_value=client):
        meta = media.headObject("uploads/u/image/x.jpg")

    assert meta == {"contentLength": 12345, "contentType": "image/jpeg"}


def test_head_object_returns_none_on_404():
    from botocore.exceptions import ClientError
    from lipsync import media

    client = MagicMock()
    client.head_object.side_effect = ClientError({"Error": {"Code": "404", "Message": "nf"}}, "HeadObject")
    with patch.object(media, "LIPSYNC_MEDIA_BUCKET", "fus-lipsync-media-123"), \
         patch.object(media, "_client", return_value=client):
        meta = media.headObject("uploads/u/image/missing.jpg")

    assert meta is None


def test_head_object_reraises_other_errors():
    from botocore.exceptions import ClientError
    from lipsync import media

    client = MagicMock()
    client.head_object.side_effect = ClientError({"Error": {"Code": "AccessDenied", "Message": "no"}}, "HeadObject")
    with patch.object(media, "LIPSYNC_MEDIA_BUCKET", "fus-lipsync-media-123"), \
         patch.object(media, "_client", return_value=client):
        try:
            media.headObject("uploads/u/image/x.jpg")
            assert False, "expected ClientError to propagate"
        except ClientError as e:
            assert e.response["Error"]["Code"] == "AccessDenied"


# --- key/extension conventions --------------------------------------------------


def test_extension_for_known_kind_and_content_type():
    from lipsync import media

    assert media.extensionFor("image", "image/jpeg") == ".jpg"
    assert media.extensionFor("audio", "audio/wav") == ".wav"
    assert media.extensionFor("audio", "audio/mp4") == ".m4a"
    assert media.extensionFor("audio", "audio/x-m4a") == ".m4a"
    assert media.extensionFor("video", "video/mp4") == ".mp4"


def test_extension_for_unknown_content_type_is_none():
    from lipsync import media

    assert media.extensionFor("audio", "audio/ogg") is None
    assert media.extensionFor("bogus-kind", "audio/wav") is None


def test_extension_of_key():
    from lipsync import media

    assert media.extensionOfKey("uploads/u/audio/x.MP3") == ".mp3"
    assert media.extensionOfKey("outputs/j1/j1.mp4") == ".mp4"
    assert media.extensionOfKey("") == ""


def test_build_upload_key_convention():
    from lipsync import media

    key = media.buildUploadKey("user-123", "audio", ".wav")
    assert key.startswith("uploads/user-123/audio/")
    assert key.endswith(".wav")


def test_output_key_for_convention():
    from lipsync import media

    assert media.outputKeyFor("job-abc") == "outputs/job-abc/job-abc.mp4"


# --- fetchExternalBytes -----------------------------------------------------------


def test_fetch_external_bytes_returns_full_body():
    from lipsync import media

    fakeResp = MagicMock()
    fakeResp.read.side_effect = [b"hello ", b"world", b""]
    fakeResp.__enter__ = MagicMock(return_value=fakeResp)
    fakeResp.__exit__ = MagicMock(return_value=False)

    with patch("lipsync.media.urlopen", return_value=fakeResp):
        data = media.fetchExternalBytes("https://fal.example/output.mp4")

    assert data == b"hello world"


def test_fetch_external_bytes_raises_when_over_cap():
    from lipsync import media

    fakeResp = MagicMock()
    fakeResp.read.side_effect = [b"x" * 10, b""]
    fakeResp.__enter__ = MagicMock(return_value=fakeResp)
    fakeResp.__exit__ = MagicMock(return_value=False)

    with patch("lipsync.media.urlopen", return_value=fakeResp):
        try:
            media.fetchExternalBytes("https://fal.example/output.mp4", maxBytes=5)
            assert False, "expected FetchTooLargeError"
        except media.FetchTooLargeError:
            pass


# --- duration probing: dispatch -------------------------------------------------


def test_probe_duration_seconds_dispatches_by_extension():
    from lipsync import media

    wavData = _wavBytes(numFrames=44100 * 3, frameRate=44100)
    assert media.probeDurationSeconds(wavData, ".wav") == 3.0
    assert media.probeDurationSeconds(wavData, ".WAV") == 3.0  # case-insensitive


def test_probe_duration_seconds_unknown_extension_is_none():
    from lipsync import media

    assert media.probeDurationSeconds(b"whatever", ".ogg") is None
    assert media.probeDurationSeconds(b"whatever", "") is None


def test_probe_duration_seconds_never_raises_on_garbage():
    from lipsync import media

    for ext in (".wav", ".mp4", ".m4a", ".mp3"):
        assert media.probeDurationSeconds(b"\x00\x01garbage-not-a-real-file", ext) is None


# --- duration probing: wav -------------------------------------------------------


def test_wav_duration_exact():
    from lipsync import media

    data = _wavBytes(numFrames=44100 * 5, frameRate=44100)
    assert media.probeDurationSeconds(data, ".wav") == 5.0


def test_wav_duration_non_integer_seconds():
    from lipsync import media

    data = _wavBytes(numFrames=22050, frameRate=44100)  # 0.5s
    assert media.probeDurationSeconds(data, ".wav") == 0.5


# --- duration probing: mp4/m4a ---------------------------------------------------


def test_mp4_duration_version_0():
    from lipsync import media

    data = _mp4Bytes(timescale=1000, duration=15500, version=0)  # 15.5s
    assert media.probeDurationSeconds(data, ".mp4") == 15.5
    assert media.probeDurationSeconds(data, ".m4a") == 15.5


def test_mp4_duration_version_1_64bit():
    from lipsync import media

    data = _mp4Bytes(timescale=48000, duration=48000 * 12, version=1)  # 12s
    assert media.probeDurationSeconds(data, ".mp4") == 12.0


def test_mp4_duration_missing_moov_is_none():
    from lipsync import media

    data = _box("ftyp", b"isom" + b"\x00" * 12)  # no moov at all
    assert media.probeDurationSeconds(data, ".mp4") is None


def test_mp4_duration_zero_timescale_is_none():
    from lipsync import media

    data = _mp4Bytes(timescale=0, duration=1000, version=0)
    assert media.probeDurationSeconds(data, ".mp4") is None


def test_mp4_duration_truncated_file_is_none_not_raise():
    from lipsync import media

    data = _mp4Bytes(timescale=1000, duration=5000)[:20]  # cut off mid-box
    assert media.probeDurationSeconds(data, ".mp4") is None


# --- duration probing: mp3 -------------------------------------------------------


def test_mp3_duration_cbr_estimate():
    from lipsync import media

    header = _mp3FrameHeaderBytes(bitrateIndex=9, sampleRateIndex=0)  # 128kbps
    # 128kbps == 16000 bytes/sec; 32000 bytes of "frame data" after the
    # header position -> ~2.0s (estimate is (len-pos)*8/(bitrate*1000)).
    body = header + b"\x00" * (32000 - len(header))
    duration = media.probeDurationSeconds(body, ".mp3")
    assert duration is not None
    assert abs(duration - 2.0) < 0.01


def test_mp3_duration_skips_id3v2_header():
    from lipsync import media

    # ID3v2 header: "ID3" + version(2) + flags(1) + syncsafe size(4) = 10 bytes,
    # here declaring a 20-byte tag body.
    id3 = b"ID3" + bytes([3, 0, 0]) + bytes([0, 0, 0, 20]) + b"\x00" * 20
    header = _mp3FrameHeaderBytes(bitrateIndex=9, sampleRateIndex=0)
    body = id3 + header + b"\x00" * (16000 - len(header))  # ~1s of "audio" after the header
    duration = media.probeDurationSeconds(body, ".mp3")
    assert duration is not None
    assert abs(duration - 1.0) < 0.01


def test_mp3_duration_no_valid_frame_is_none():
    from lipsync import media

    assert media.probeDurationSeconds(b"not an mp3 at all, no sync bytes here", ".mp3") is None


def test_mp3_duration_bad_bitrate_index_is_none():
    from lipsync import media

    # bitrateIndex 0 (free) and 0xF (bad) are both invalid -- the frame
    # finder must skip past them rather than accept a zero/undefined bitrate.
    b0, b1, _b2, b3 = _mp3FrameHeaderBytes(bitrateIndex=0, sampleRateIndex=0)
    data = bytes([b0, b1, 0x00, b3])  # bitrateIndex=0 in the top nibble
    assert media.probeDurationSeconds(data, ".mp3") is None
