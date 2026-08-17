"""
S3 helpers for the lipsync module, plus stdlib-only best-effort audio/video
duration probing.

Key convention:
    uploads/{createdBy}/{kind}/{uuid}{ext}   (inputs, client PUT via presign)
    outputs/{jobId}/{jobId}.mp4              (generated clip, runner-written)

Duration probing exists because docs/lipsync-design.md's Validation rules
require "Audio duration <= 20s ... enforced server-side, not just in the
UI", but CreateJobInput (src/web/spa/src/features/lipsync/api.ts) carries no
duration field -- the frontend measures it client-side
(LipsyncPage.tsx::readAudioDuration) purely for UX and never transmits it.
With `stdlib urllib only, no new pip dependencies` as a hard constraint (no
mutagen/pydub, no ffprobe binary in this Lambda runtime), routes.createJob
instead downloads the (size-capped, <=20MB) audio object itself and probes
its duration here:

  - .wav          -- exact, via the stdlib `wave` module.
  - .mp4 / .m4a    -- exact, via a small hand-rolled MP4 box walker that
                      reads moov/mvhd's timescale+duration. Also reused for
                      the OUTPUT clip's duration (fal's own result payload
                      only includes a `duration` field for one of the two
                      models -- see providers/fal.py's module docstring --
                      so re-measuring the copied .mp4 ourselves is the only
                      approach that works for both modes).
  - .mp3           -- estimated from the first valid frame's bitrate/sample
                      rate and the remaining file size (exact for CBR,
                      approximate for VBR without a Xing/VBRI header parse.
                      A VBR file whose estimate lands near the cap may be
                      rejected slightly early; re-encoding to CBR or WAV is
                      the workaround -- see probeDurationSeconds's docstring).

Any parse failure returns None ("unknown"), which routes.createJob rejects
with a 400 -- it fails CLOSED. The 20MB upload cap is NOT a usable backstop
here: 20MB of 128kbps mp3 is ~21 minutes of audio, which at Kling's
$0.115/s would bill ~$143 for a single clip. Since every allow-listed audio
content type is covered above, a probe failure indicates a malformed file
rather than a legitimate one, so rejecting costs the caller a re-encode
while allowing it costs real money.
"""
import logging
import os
import struct
import uuid
import wave
from io import BytesIO
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

LIPSYNC_MEDIA_BUCKET = os.environ.get("LIPSYNC_MEDIA_BUCKET", "")

_s3 = None


def _client():
    global _s3
    if _s3 is None:
        import boto3
        _s3 = boto3.client("s3")
    return _s3


# --- upload contract: allow-listed content types, extensions never come from
# the client-supplied filename -------------------------------------------------

ALLOWED_CONTENT_TYPES = {
    "image": {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"},
    "video": {"video/mp4": ".mp4", "video/quicktime": ".mov"},
    # Matches the frontend's file-picker `accept` list exactly (see
    # LipsyncPage.tsx) -- audio/mp4 and audio/x-m4a both map to .m4a so the
    # duration prober can dispatch on extension alone.
    "audio": {"audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/mp4": ".m4a", "audio/x-m4a": ".m4a"},
}

MAX_UPLOAD_BYTES = {"image": 10_000_000, "audio": 20_000_000, "video": 100_000_000}

PRESIGN_UPLOAD_EXPIRES_IN = 3600
# design: "Generate presigned S3 GET URLs (TTL 3600s) and hand those to fal".
INPUT_URL_EXPIRES_IN = 3600
# frozen API contract: GET /lipsync/jobs/{jobId}/output "presigned GET, TTL 300s".
OUTPUT_URL_EXPIRES_IN = 300


def extensionFor(kind, contentType):
    return ALLOWED_CONTENT_TYPES.get(kind, {}).get(contentType)


def extensionOfKey(key):
    _, ext = os.path.splitext(key or "")
    return ext.lower()


def buildUploadKey(createdBy, kind, ext):
    safeCreatedBy = createdBy or "unknown"
    return f"uploads/{safeCreatedBy}/{kind}/{uuid.uuid4().hex}{ext}"


def outputKeyFor(jobId):
    return f"outputs/{jobId}/{jobId}.mp4"


# --- S3: our own bucket -------------------------------------------------------


def presignPut(key, contentType, expiresIn=PRESIGN_UPLOAD_EXPIRES_IN):
    return _client().generate_presigned_url(
        "put_object",
        Params={"Bucket": LIPSYNC_MEDIA_BUCKET, "Key": key, "ContentType": contentType},
        ExpiresIn=expiresIn,
    )


def presignGet(key, expiresIn=INPUT_URL_EXPIRES_IN):
    return _client().generate_presigned_url(
        "get_object", Params={"Bucket": LIPSYNC_MEDIA_BUCKET, "Key": key}, ExpiresIn=expiresIn,
    )


def getBytes(key):
    resp = _client().get_object(Bucket=LIPSYNC_MEDIA_BUCKET, Key=key)
    return resp["Body"].read()


def putBytes(key, data, contentType):
    _client().put_object(Bucket=LIPSYNC_MEDIA_BUCKET, Key=key, Body=data, ContentType=contentType)


def headObject(key):
    """Returns {"contentLength": int, "contentType": str} or None if the key
    doesn't exist -- used to enforce the upload size caps at job-creation
    time for image/video (getBytes is deliberately NOT used for those: a
    100MB video should never be pulled fully into this Lambda's memory just
    to check its size)."""
    from botocore.exceptions import ClientError

    try:
        resp = _client().head_object(Bucket=LIPSYNC_MEDIA_BUCKET, Key=key)
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchKey", "NotFound"):
            return None
        raise
    return {"contentLength": resp.get("ContentLength", 0), "contentType": resp.get("ContentType", "")}


# --- fetching a THIRD-PARTY url (fal's temporary output, never our own S3) ----

MAX_FETCH_BYTES = MAX_UPLOAD_BYTES["video"]
_FETCH_CHUNK_BYTES = 1_000_000


class FetchTooLargeError(Exception):
    """Raised by fetchExternalBytes when the remote response exceeds maxBytes
    -- guards against an unbounded download of a third-party URL."""


def fetchExternalBytes(url, timeoutSec=30, maxBytes=MAX_FETCH_BYTES):
    req = Request(url, method="GET")
    with urlopen(req, timeout=timeoutSec) as resp:
        chunks = []
        total = 0
        while True:
            chunk = resp.read(_FETCH_CHUNK_BYTES)
            if not chunk:
                break
            total += len(chunk)
            if total > maxBytes:
                raise FetchTooLargeError(f"remote file exceeds {maxBytes} bytes")
            chunks.append(chunk)
        return b"".join(chunks)


# --- duration probing (best-effort, stdlib only) ------------------------------


def probeDurationSeconds(data, ext):
    """Dispatch by (lowercased) file extension. Returns float seconds, or
    None if the format isn't one of the three probed here or parsing failed
    for any reason -- this function is designed to never raise; a corrupt or
    unexpected upload degrades to "duration unknown", not a 500."""
    ext = (ext or "").lower()
    try:
        if ext == ".wav":
            return _wavDurationSeconds(data)
        if ext in (".mp4", ".m4a", ".mov"):
            return _mp4DurationSeconds(data)
        if ext == ".mp3":
            return _mp3DurationSeconds(data)
    except Exception:  # noqa: BLE001 -- probing must never raise out of the caller
        logger.warning("Duration probe failed for ext=%s", ext, exc_info=True)
        return None
    return None


def _wavDurationSeconds(data):
    try:
        with wave.open(BytesIO(data), "rb") as w:
            frames = w.getnframes()
            rate = w.getframerate()
    except (wave.Error, EOFError, struct.error):
        return None
    if not rate:
        return None
    return frames / rate


# --- MP4 / M4A / MOV: ISO base media file format box walker ------------------
# moov -> mvhd carries {timescale, duration} regardless of which codec the
# media tracks use, so this one small parser covers both audio (m4a) inputs
# and the mp4 video output fal generates -- see module docstring.


def _iterBoxes(data, start, end):
    """Yield (boxType, payloadStart, payloadEnd) for each top-level box in
    data[start:end]. Stops (rather than raising) at a truncated/malformed
    box -- callers treat "box not found" as an ordinary probe failure."""
    pos = start
    while pos + 8 <= end:
        size = struct.unpack(">I", data[pos:pos + 4])[0]
        boxType = data[pos + 4:pos + 8].decode("ascii", errors="replace")
        headerLen = 8
        if size == 1:
            if pos + 16 > end:
                break
            size = struct.unpack(">Q", data[pos + 8:pos + 16])[0]
            headerLen = 16
        elif size == 0:
            size = end - pos  # box extends to EOF
        if size < headerLen or pos + size > end:
            break
        yield boxType, pos + headerLen, pos + size
        pos += size


def _findBox(data, boxType, start, end):
    for t, payloadStart, payloadEnd in _iterBoxes(data, start, end):
        if t == boxType:
            return payloadStart, payloadEnd
    return None


def _mp4DurationSeconds(data):
    moov = _findBox(data, "moov", 0, len(data))
    if moov is None:
        return None
    mvhd = _findBox(data, "mvhd", moov[0], moov[1])
    if mvhd is None:
        return None
    payloadStart, payloadEnd = mvhd
    if payloadEnd - payloadStart < 4:
        return None

    version = data[payloadStart]
    try:
        if version == 1:
            if payloadEnd - payloadStart < 32:
                return None
            timescale = struct.unpack(">I", data[payloadStart + 20:payloadStart + 24])[0]
            duration = struct.unpack(">Q", data[payloadStart + 24:payloadStart + 32])[0]
        else:
            if payloadEnd - payloadStart < 20:
                return None
            timescale = struct.unpack(">I", data[payloadStart + 12:payloadStart + 16])[0]
            duration = struct.unpack(">I", data[payloadStart + 16:payloadStart + 20])[0]
    except struct.error:
        return None

    if not timescale:
        return None
    return duration / timescale


# --- MP3: first-frame bitrate/sample-rate + remaining-size estimate ----------

_MPEG_BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
_MPEG_BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
_SAMPLE_RATES_BY_VERSION_ID = {
    3: [44100, 48000, 32000],  # MPEG1
    2: [22050, 24000, 16000],  # MPEG2
    0: [11025, 12000, 8000],  # MPEG2.5
}


def _skipId3v2(data):
    if len(data) >= 10 and data[0:3] == b"ID3":
        size = ((data[6] & 0x7F) << 21) | ((data[7] & 0x7F) << 14) | ((data[8] & 0x7F) << 7) | (data[9] & 0x7F)
        return 10 + size
    return 0


def _findMp3FrameHeader(data, start):
    """Return (pos, versionId, bitrateKbps, sampleRate) for the first valid
    MPEG Layer III frame sync at/after `start`, or None if none is found."""
    pos = start
    limit = len(data) - 4
    while pos <= limit:
        if data[pos] == 0xFF and (data[pos + 1] & 0xE0) == 0xE0:
            b1 = data[pos + 1]
            versionId = (b1 >> 3) & 0x3  # 0=MPEG2.5, 1=reserved, 2=MPEG2, 3=MPEG1
            layerId = (b1 >> 1) & 0x3  # 1=Layer III (yes, that ordering is correct)
            if layerId == 1 and versionId != 1:
                b2 = data[pos + 2]
                bitrateIndex = (b2 >> 4) & 0xF
                sampleRateIndex = (b2 >> 2) & 0x3
                if 0 < bitrateIndex < 0xF and sampleRateIndex != 0x3:
                    bitrateTable = _MPEG_BITRATES_V1_L3 if versionId == 3 else _MPEG_BITRATES_V2_L3
                    sampleRate = _SAMPLE_RATES_BY_VERSION_ID[versionId][sampleRateIndex]
                    return pos, versionId, bitrateTable[bitrateIndex], sampleRate
        pos += 1
    return None


def _mp3DurationSeconds(data):
    """Estimated, not exact, for VBR-encoded files (no Xing/VBRI header
    parse -- see module docstring for why that was judged out of scope).
    Exact for CBR, which is the common case for short spoken-word clips."""
    found = _findMp3FrameHeader(data, _skipId3v2(data))
    if found is None:
        return None
    pos, _versionId, bitrateKbps, sampleRate = found
    if not bitrateKbps or not sampleRate:
        return None
    remainingBytes = len(data) - pos
    return (remainingBytes * 8) / (bitrateKbps * 1000)
