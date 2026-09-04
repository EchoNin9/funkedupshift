"""Unit tests for lipsync/routes.py (API Gateway HTTP dispatch). No moto --
storage/media/getProvider/the lambda client are all mocked, matching the
patch.object conventions used elsewhere in this repo (see
test_social_routes.py)."""
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lipsync import billing, budget, media, routes, storage  # noqa: E402


def _event(method, path, *, body=None, groups="admin", withClaims=True, sub="user-1",
           pathParameters=None, queryStringParameters=None):
    claims = {}
    if withClaims:
        claims = {"sub": sub, "email": "a@example.com"}
        if groups is not None:
            claims["cognito:groups"] = groups

    return {
        "rawPath": path,
        "requestContext": {
            "http": {"method": method, "path": path},
            "authorizer": {"jwt": {"claims": claims}} if withClaims else {},
        },
        "pathParameters": pathParameters or {},
        "queryStringParameters": queryStringParameters,
        "body": json.dumps(body) if body is not None else None,
    }


def _call(event):
    resp = routes.route(event)
    return resp["statusCode"], json.loads(resp["body"])


def _routeEvent(method, path, body):
    rawPath = path.split("?")[0]
    qs = None
    if "?" in path:
        qs = dict(pair.split("=") for pair in path.split("?", 1)[1].split("&"))
    pathParameters = {}
    parts = [p for p in rawPath.split("/") if p]
    if len(parts) >= 3 and parts[1] == "jobs":
        pathParameters["jobId"] = parts[2]
    return _event(method, rawPath, body=body, queryStringParameters=qs, pathParameters=pathParameters)


ALL_ROUTES = [
    ("POST", "/lipsync/media/presign", {"filename": "a.wav", "contentType": "audio/wav", "kind": "audio"}),
    ("POST", "/lipsync/jobs", {"mode": "avatar", "audioKey": "a", "imageKey": "i", "consentAttested": True}),
    ("GET", "/lipsync/jobs", None),
    ("GET", "/lipsync/jobs/abc", None),
    ("DELETE", "/lipsync/jobs/abc", None),
    ("GET", "/lipsync/jobs/abc/output", None),
]


def _job(jobId="abc", status="queued", **overrides):
    base = {
        "jobId": jobId, "mode": "avatar", "status": status, "provider": "fal", "model": "fal-ai/x",
        "audioKey": "uploads/u/audio/a.wav", "imageKey": "uploads/u/image/i.jpg", "videoKey": "",
        "createdAt": "2026-08-16T12:00:00.000Z", "updatedAt": "2026-08-16T12:00:00.000Z",
        "consentAttested": True, "outputKey": "", "error": "",
    }
    base.update(overrides)
    return base


# --- auth: admin group required on every route ---------------------------------------


ADMIN_ONLY_ROUTES = [
    ("GET", "/lipsync/admin/budgets", None),
    ("PUT", "/lipsync/admin/budgets/someone@example.com", {"budgetCents": 500}),
]


def test_admin_routes_403_for_non_admin():
    """Only /lipsync/admin/* is group-gated now. The job routes deliberately
    are NOT -- the module is open to every signed-in user, and ownership (not
    the route gate) is what stops one user seeing another's work."""
    for method, path, body in ADMIN_ONLY_ROUTES:
        event = _routeEvent(method, path, body)
        event["requestContext"]["authorizer"]["jwt"]["claims"]["cognito:groups"] = "user"
        status, payload = _call(event)
        assert status == 403, f"{method} {path} expected 403, got {status}"
        assert payload == {"error": "forbidden"}


def test_job_routes_are_not_admin_gated():
    """Regression guard for the gate opening: a non-admin must NOT get 403 on
    the job routes. Anything other than 403 is fine here -- the point is only
    that the admin group is no longer required."""
    for method, path, body in ALL_ROUTES:
        event = _routeEvent(method, path, body)
        event["requestContext"]["authorizer"]["jwt"]["claims"]["cognito:groups"] = "user"
        with patch.object(storage, "getJob", return_value=None), \
                patch.object(storage, "listJobs", return_value=([], None)), \
                patch.object(media, "presignPut", return_value="https://s3.example/put"), \
                patch.object(media, "headObject", return_value={"contentLength": 10, "contentType": "image/jpeg"}), \
                patch.object(media, "getBytes", return_value=b"\x00" * 10), \
                patch.object(media, "probeDurationSeconds", return_value=2.0), \
                patch.object(billing, "getBalance", return_value=_balance(50000)), \
                patch.object(budget, "reserve", return_value=False), \
                patch.object(budget, "getBudget", return_value=_budgetRecord(exists=False)):
            status, _ = _call(event)
        assert status != 403, f"{method} {path} should not be admin-gated, got 403"


def test_every_route_401s_with_no_claims():
    for method, path, body in ALL_ROUTES:
        event = _routeEvent(method, path, body)
        event["requestContext"]["authorizer"] = {}
        status, payload = _call(event)
        assert status == 401, f"{method} {path} expected 401, got {status}"
        assert payload == {"error": "unauthorized"}


def test_cognito_groups_as_space_separated_string_parses():
    claims = {"sub": "u", "cognito:groups": "[admin manager]"}
    parsed = routes._parseGroups(claims["cognito:groups"])
    assert "admin" in parsed


def test_cognito_groups_as_list_parses():
    assert routes._parseGroups(["admin", "manager"]) == ["admin", "manager"]


# --- POST /lipsync/media/presign -----------------------------------------------------


def test_presign_happy_path():
    with patch.object(media, "presignPut", return_value="https://s3.example/put") as mockPresign:
        status, payload = _call(_routeEvent(
            "POST", "/lipsync/media/presign", {"filename": "clip.wav", "contentType": "audio/wav", "kind": "audio"},
        ))

    assert status == 200
    assert payload["uploadUrl"] == "https://s3.example/put"
    assert payload["key"].startswith("uploads/user-1/audio/")
    assert payload["key"].endswith(".wav")
    mockPresign.assert_called_once()


def test_presign_rejects_bad_kind():
    status, payload = _call(_routeEvent(
        "POST", "/lipsync/media/presign", {"filename": "x.wav", "contentType": "audio/wav", "kind": "bogus"},
    ))
    assert status == 400
    assert any("kind" in e for e in payload["errors"])


def test_presign_rejects_content_type_not_allowed_for_kind():
    status, payload = _call(_routeEvent(
        "POST", "/lipsync/media/presign", {"filename": "x.ogg", "contentType": "audio/ogg", "kind": "audio"},
    ))
    assert status == 400
    assert any("contentType" in e for e in payload["errors"])


def test_presign_rejects_missing_filename():
    status, payload = _call(_routeEvent(
        "POST", "/lipsync/media/presign", {"filename": "", "contentType": "audio/wav", "kind": "audio"},
    ))
    assert status == 400
    assert any("filename" in e for e in payload["errors"])


def test_presign_key_never_derives_extension_from_filename():
    """design doc: 'extension derived from content type, never from the
    client-supplied filename' -- a filename with a mismatched/malicious
    extension must not leak into the S3 key."""
    with patch.object(media, "presignPut", return_value="https://s3.example/put"):
        status, payload = _call(_routeEvent(
            "POST", "/lipsync/media/presign",
            {"filename": "../../etc/passwd.exe", "contentType": "audio/wav", "kind": "audio"},
        ))

    assert status == 200
    assert payload["key"].endswith(".wav")
    assert "passwd" not in payload["key"]
    assert ".." not in payload["key"]


def test_presign_invalid_json_body_400():
    event = _routeEvent("POST", "/lipsync/media/presign", None)
    event["body"] = "{not json"
    status, payload = _call(event)
    assert status == 400


# --- POST /lipsync/jobs -------------------------------------------------------------


def _createJobBody(**overrides):
    body = {"mode": "avatar", "audioKey": "uploads/u/audio/a.wav", "imageKey": "uploads/u/image/i.jpg",
            "consentAttested": True}
    body.update(overrides)
    return body


def _balance(cents):
    return billing.BalanceResult(cents, "2026-08-17T00:00:00.000Z")


def _budgetRecord(budgetCents=10000, spentCents=0, reservedCents=0, exists=True):
    return {
        "username": "a@example.com", "budgetCents": budgetCents, "spentCents": spentCents,
        "reservedCents": reservedCents,
        "remainingCents": max(0, budgetCents - spentCents - reservedCents),
        "updatedAt": "", "updatedBy": "", "note": "", "exists": exists,
    }


def _patchCreateJobHappy(**kwargs):
    """Common mocks for a createJob call that should reach the DB write --
    image/video head_object ok, audio bytes small + short, storage write ok."""
    defaults = dict(
        headObject={"contentLength": 1000, "contentType": "image/jpeg"},
        audioBytes=b"\x00" * 1000,
        duration=2.0,
        balanceCents=50000,
        reserveOk=True,
    )
    defaults.update(kwargs)
    return (
        patch.object(media, "headObject", return_value=defaults["headObject"]),
        patch.object(media, "getBytes", return_value=defaults["audioBytes"]),
        patch.object(media, "probeDurationSeconds", return_value=defaults["duration"]),
        patch.object(storage, "createJob", return_value=_job(status="queued")),
        patch.object(routes, "_invokeRunnerAsync"),
        # Spend control: a funded balance and a successful hold. Without these
        # the real billing/budget code would reach DynamoDB/fal.
        patch.object(billing, "getBalance", return_value=_balance(defaults["balanceCents"])),
        patch.object(budget, "reserve", return_value=defaults["reserveOk"]),
        patch.object(budget, "getBudget", return_value=_budgetRecord()),
        patch.object(storage, "setBudgetIdentity"),
    )


def test_create_job_avatar_happy_path_201():
    mocks = _patchCreateJobHappy()
    with mocks[0], mocks[1], mocks[2], mocks[3] as mockCreate, mocks[4] as mockInvoke, mocks[5], mocks[6], mocks[7], mocks[8]:
        status, payload = _call(_routeEvent("POST", "/lipsync/jobs", _createJobBody()))

    assert status == 201
    assert payload["status"] == "queued"
    assert "jobId" in payload
    mockCreate.assert_called_once()
    assert mockCreate.call_args.kwargs["mode"] == "avatar"
    assert mockCreate.call_args.kwargs["createdBy"] == "user-1"
    mockInvoke.assert_called_once_with(payload["jobId"])


def test_create_job_relip_happy_path_201():
    mocks = _patchCreateJobHappy(headObject={"contentLength": 5000, "contentType": "video/mp4"})
    with mocks[0], mocks[1], mocks[2], mocks[3] as mockCreate, mocks[4], mocks[5], mocks[6], mocks[7], mocks[8]:
        status, payload = _call(_routeEvent(
            "POST", "/lipsync/jobs",
            _createJobBody(mode="relip", imageKey=None, videoKey="uploads/u/video/v.mp4"),
        ))

    assert status == 201
    assert mockCreate.call_args.kwargs["mode"] == "relip"
    assert mockCreate.call_args.kwargs["videoKey"] == "uploads/u/video/v.mp4"


def test_create_job_missing_mode_400():
    status, payload = _call(_routeEvent("POST", "/lipsync/jobs", _createJobBody(mode="")))
    assert status == 400
    assert any("mode" in e for e in payload["errors"])


def test_create_job_missing_audio_key_400():
    status, payload = _call(_routeEvent("POST", "/lipsync/jobs", _createJobBody(audioKey="")))
    assert status == 400
    assert any("audioKey" in e for e in payload["errors"])


def test_create_job_avatar_missing_image_key_400():
    status, payload = _call(_routeEvent("POST", "/lipsync/jobs", _createJobBody(imageKey="")))
    assert status == 400
    assert any("imageKey" in e for e in payload["errors"])


def test_create_job_avatar_with_video_key_also_supplied_400():
    status, payload = _call(_routeEvent(
        "POST", "/lipsync/jobs", _createJobBody(videoKey="uploads/u/video/v.mp4"),
    ))
    assert status == 400
    assert any("videoKey" in e for e in payload["errors"])


def test_create_job_relip_missing_video_key_400():
    status, payload = _call(_routeEvent(
        "POST", "/lipsync/jobs", _createJobBody(mode="relip", imageKey=None),
    ))
    assert status == 400
    assert any("videoKey" in e for e in payload["errors"])


def test_create_job_relip_with_image_key_also_supplied_400():
    status, payload = _call(_routeEvent(
        "POST", "/lipsync/jobs", _createJobBody(mode="relip", videoKey="uploads/u/video/v.mp4"),
    ))
    assert status == 400
    assert any("imageKey" in e for e in payload["errors"])


def test_create_job_consent_attested_false_400():
    status, payload = _call(_routeEvent("POST", "/lipsync/jobs", _createJobBody(consentAttested=False)))
    assert status == 400
    assert any("consentAttested" in e for e in payload["errors"])


def test_create_job_consent_attested_missing_400():
    body = _createJobBody()
    del body["consentAttested"]
    status, payload = _call(_routeEvent("POST", "/lipsync/jobs", body))
    assert status == 400
    assert any("consentAttested" in e for e in payload["errors"])


def test_create_job_consent_attested_truthy_non_bool_still_400():
    """Must require the literal boolean True, not just any truthy value --
    a client bug sending the string 'true' must not slip past this check."""
    status, payload = _call(_routeEvent("POST", "/lipsync/jobs", _createJobBody(consentAttested="true")))
    assert status == 400


def test_create_job_invalid_json_body_400():
    event = _routeEvent("POST", "/lipsync/jobs", None)
    event["body"] = "{not json"
    status, payload = _call(event)
    assert status == 400


def test_create_job_unknown_model_override_400():
    status, payload = _call(_routeEvent("POST", "/lipsync/jobs", _createJobBody(model="not-a-real-model")))
    assert status == 400


def test_create_job_unknown_model_override_never_reaches_storage_or_fal():
    """The 400 must happen before any job row is written -- unknown/cross-mode
    model rejection happens before storage.createJob is ever called."""
    with patch.object(storage, "createJob") as mockCreate:
        status, payload = _call(_routeEvent("POST", "/lipsync/jobs", _createJobBody(model="not-a-real-model")))

    assert status == 400
    mockCreate.assert_not_called()


def test_create_job_cross_mode_model_override_400():
    """A relip-only model (veed/lipsync) must never be accepted on an avatar
    job, even though both mode and the model individually are each valid."""
    status, payload = _call(_routeEvent(
        "POST", "/lipsync/jobs", _createJobBody(mode="avatar", model="veed/lipsync"),
    ))
    assert status == 400


def test_create_job_cross_mode_model_override_never_reaches_storage():
    with patch.object(storage, "createJob") as mockCreate:
        status, payload = _call(_routeEvent(
            "POST", "/lipsync/jobs", _createJobBody(mode="avatar", model="veed/lipsync"),
        ))

    assert status == 400
    mockCreate.assert_not_called()


def test_create_job_non_default_same_mode_model_override_is_accepted():
    mocks = _patchCreateJobHappy()
    with mocks[0], mocks[1], mocks[2], mocks[3] as mockCreate, mocks[4], mocks[5], mocks[6], mocks[7], mocks[8]:
        status, payload = _call(_routeEvent(
            "POST", "/lipsync/jobs", _createJobBody(model="fal-ai/kling-video/ai-avatar/v2/standard"),
        ))

    assert status == 201
    assert mockCreate.call_args.kwargs["model"] == "fal-ai/kling-video/ai-avatar/v2/standard"


# --- POST /lipsync/jobs: prompt --------------------------------------------------------


def test_create_job_prompt_required_model_with_no_prompt_400():
    status, payload = _call(_routeEvent(
        "POST", "/lipsync/jobs", _createJobBody(model="fal-ai/infinitalk"),
    ))
    assert status == 400


def test_create_job_prompt_required_model_with_no_prompt_never_reaches_storage():
    with patch.object(storage, "createJob") as mockCreate:
        status, payload = _call(_routeEvent(
            "POST", "/lipsync/jobs", _createJobBody(model="fal-ai/infinitalk"),
        ))

    assert status == 400
    mockCreate.assert_not_called()


def test_create_job_prompt_required_model_with_prompt_201():
    mocks = _patchCreateJobHappy()
    with mocks[0], mocks[1], mocks[2], mocks[3] as mockCreate, mocks[4], mocks[5], mocks[6], mocks[7], mocks[8]:
        status, payload = _call(_routeEvent(
            "POST", "/lipsync/jobs",
            _createJobBody(model="fal-ai/infinitalk", prompt="a robot waving hello"),
        ))

    assert status == 201
    assert mockCreate.call_args.kwargs["prompt"] == "a robot waving hello"


def test_create_job_prompt_optional_model_with_prompt_is_stored():
    mocks = _patchCreateJobHappy()
    with mocks[0], mocks[1], mocks[2], mocks[3] as mockCreate, mocks[4], mocks[5], mocks[6], mocks[7], mocks[8]:
        status, payload = _call(_routeEvent(
            "POST", "/lipsync/jobs", _createJobBody(prompt="an optional prompt"),
        ))

    assert status == 201
    assert mockCreate.call_args.kwargs["prompt"] == "an optional prompt"


def test_create_job_prompt_omitted_defaults_to_empty_string():
    mocks = _patchCreateJobHappy()
    with mocks[0], mocks[1], mocks[2], mocks[3] as mockCreate, mocks[4], mocks[5], mocks[6], mocks[7], mocks[8]:
        status, payload = _call(_routeEvent("POST", "/lipsync/jobs", _createJobBody()))

    assert status == 201
    assert mockCreate.call_args.kwargs["prompt"] == ""


def test_create_job_prompt_on_a_model_that_does_not_accept_it_is_still_201():
    """routes.createJob doesn't reject this -- it's stored on the job record
    regardless (audit trail), and it's _buildInput's job at submit time to
    drop it rather than forward it to a model with no prompt field. See
    test_lipsync_fal_provider.py's build-input coverage for that half."""
    mocks = _patchCreateJobHappy(headObject={"contentLength": 5000, "contentType": "video/mp4"})
    with mocks[0], mocks[1], mocks[2], mocks[3] as mockCreate, mocks[4], mocks[5], mocks[6], mocks[7], mocks[8]:
        status, payload = _call(_routeEvent(
            "POST", "/lipsync/jobs",
            _createJobBody(mode="relip", imageKey=None, videoKey="uploads/u/video/v.mp4", prompt="ignored anyway"),
        ))

    assert status == 201
    assert mockCreate.call_args.kwargs["prompt"] == "ignored anyway"


def test_create_job_image_not_found_400():
    with patch.object(media, "headObject", return_value=None):
        status, payload = _call(_routeEvent("POST", "/lipsync/jobs", _createJobBody()))
    assert status == 400
    assert any("imageKey" in e for e in payload["errors"])


def test_create_job_image_oversize_400():
    with patch.object(media, "headObject", return_value={"contentLength": media.MAX_UPLOAD_BYTES["image"] + 1}):
        status, payload = _call(_routeEvent("POST", "/lipsync/jobs", _createJobBody()))
    assert status == 400
    assert any("imageKey" in e for e in payload["errors"])


def test_create_job_video_oversize_400():
    with patch.object(media, "headObject", return_value={"contentLength": media.MAX_UPLOAD_BYTES["video"] + 1}):
        status, payload = _call(_routeEvent(
            "POST", "/lipsync/jobs", _createJobBody(mode="relip", imageKey=None, videoKey="uploads/u/video/v.mp4"),
        ))
    assert status == 400
    assert any("videoKey" in e for e in payload["errors"])


def test_create_job_audio_not_found_400():
    from botocore.exceptions import ClientError

    with patch.object(media, "headObject", return_value={"contentLength": 1000}), \
         patch.object(media, "getBytes", side_effect=ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")):
        status, payload = _call(_routeEvent("POST", "/lipsync/jobs", _createJobBody()))

    assert status == 400
    assert any("audioKey" in e for e in payload["errors"])


def test_create_job_audio_read_unexpected_error_is_500_not_a_stack_trace():
    with patch.object(media, "headObject", return_value={"contentLength": 1000}), \
         patch.object(media, "getBytes", side_effect=RuntimeError("boom, unexpected internal detail")):
        status, payload = _call(_routeEvent("POST", "/lipsync/jobs", _createJobBody()))

    assert status == 500
    assert "boom" not in json.dumps(payload)


def test_create_job_audio_oversize_400():
    with patch.object(media, "headObject", return_value={"contentLength": 1000}), \
         patch.object(media, "getBytes", return_value=b"\x00" * (media.MAX_UPLOAD_BYTES["audio"] + 1)):
        status, payload = _call(_routeEvent("POST", "/lipsync/jobs", _createJobBody()))

    assert status == 400
    assert any("audioKey" in e for e in payload["errors"])


def test_create_job_audio_too_long_400():
    with patch.object(media, "headObject", return_value={"contentLength": 1000}), \
         patch.object(media, "getBytes", return_value=b"\x00" * 1000), \
         patch.object(media, "probeDurationSeconds", return_value=45.0):
        status, payload = _call(_routeEvent("POST", "/lipsync/jobs", _createJobBody()))

    assert status == 400
    assert any("45" in e for e in payload["errors"])


def test_create_job_audio_duration_unknown_is_rejected():
    """An unreadable duration fails CLOSED. The 20MB size cap cannot bound
    cost (20MB of 128kbps mp3 is ~21 minutes, ~$143 at Kling's per-second
    rate), and every allow-listed audio type is covered by the probe, so a
    parse failure means a malformed file -- not a legitimate one to wave
    through."""
    mocks = _patchCreateJobHappy(duration=None)
    with mocks[0], mocks[1], mocks[2], mocks[3], mocks[4], mocks[5], mocks[6], mocks[7], mocks[8]:
        status, payload = _call(_routeEvent("POST", "/lipsync/jobs", _createJobBody()))

    assert status == 400
    assert any("Re-encode" in e for e in payload["errors"])


def test_create_job_exactly_at_duration_cap_is_allowed():
    mocks = _patchCreateJobHappy(duration=20.0)
    with mocks[0], mocks[1], mocks[2], mocks[3], mocks[4], mocks[5], mocks[6], mocks[7], mocks[8]:
        status, payload = _call(_routeEvent("POST", "/lipsync/jobs", _createJobBody()))

    assert status == 201


def test_create_job_invokes_runner_asynchronously():
    mocks = _patchCreateJobHappy()
    client = MagicMock()
    with mocks[0], mocks[1], mocks[2], mocks[3], mocks[5], mocks[6], mocks[7], mocks[8], \
         patch.object(routes, "RUNNER_FUNCTION_NAME", "fus-lipsync-runner"), \
         patch.object(routes, "_lambdaClientFn", return_value=client):
        status, payload = _call(_routeEvent("POST", "/lipsync/jobs", _createJobBody()))

    assert status == 201
    client.invoke.assert_called_once()
    kwargs = client.invoke.call_args.kwargs
    assert kwargs["FunctionName"] == "fus-lipsync-runner"
    assert kwargs["InvocationType"] == "Event"
    assert json.loads(kwargs["Payload"]) == {"jobId": payload["jobId"]}


def test_create_job_runner_invoke_failure_does_not_fail_the_request():
    """The job record is already written -- a lost/denied async invoke is
    tolerated (the daily reconciliation sweep recovers it), not fatal."""
    mocks = _patchCreateJobHappy()
    client = MagicMock()
    client.invoke.side_effect = RuntimeError("lambda invoke failed")
    with mocks[0], mocks[1], mocks[2], mocks[3], mocks[5], mocks[6], mocks[7], mocks[8], \
         patch.object(routes, "RUNNER_FUNCTION_NAME", "fus-lipsync-runner"), \
         patch.object(routes, "_lambdaClientFn", return_value=client):
        status, payload = _call(_routeEvent("POST", "/lipsync/jobs", _createJobBody()))

    assert status == 201


# --- GET /lipsync/jobs?status=&limit=&cursor= ---------------------------------------


def test_list_jobs_happy_path_default_params():
    with patch.object(storage, "listJobs", return_value=([_job()], None)) as mockList:
        status, payload = _call(_routeEvent("GET", "/lipsync/jobs", None))

    assert status == 200
    assert payload["jobs"][0]["jobId"] == "abc"
    assert payload["cursor"] is None
    # createdBy=None only because the default test caller is an admin; a
    # normal user must be scoped to their own sub (see the ownership tests).
    mockList.assert_called_once_with(
        status=None, limit=storage.DEFAULT_LIST_LIMIT, cursor=None, createdBy=None)


def test_list_jobs_status_filter_passed_through():
    with patch.object(storage, "listJobs", return_value=([], None)) as mockList:
        _call(_routeEvent("GET", "/lipsync/jobs?status=completed", None))

    assert mockList.call_args.kwargs["status"] == "completed"


def test_list_jobs_bad_status_400():
    status, payload = _call(_routeEvent("GET", "/lipsync/jobs?status=not-a-status", None))
    assert status == 400


def test_list_jobs_bad_limit_400():
    status, payload = _call(_routeEvent("GET", "/lipsync/jobs?limit=notanumber", None))
    assert status == 400


def test_list_jobs_limit_clamped_to_max():
    with patch.object(storage, "listJobs", return_value=([], None)) as mockList:
        _call(_routeEvent(f"GET", f"/lipsync/jobs?limit=99999", None))

    assert mockList.call_args.kwargs["limit"] == storage.MAX_LIST_LIMIT


def test_list_jobs_cursor_passed_through():
    with patch.object(storage, "listJobs", return_value=([], "next-job-id")) as mockList:
        status, payload = _call(_routeEvent("GET", "/lipsync/jobs?cursor=abc123", None))

    assert mockList.call_args.kwargs["cursor"] == "abc123"
    assert payload["cursor"] == "next-job-id"


# --- GET /lipsync/jobs/{jobId} -------------------------------------------------------


def test_get_job_by_id_happy_path():
    with patch.object(storage, "getJob", return_value=_job()):
        status, payload = _call(_routeEvent("GET", "/lipsync/jobs/abc", None))

    assert status == 200
    assert payload["job"]["jobId"] == "abc"


def test_get_job_by_id_not_found_404():
    with patch.object(storage, "getJob", return_value=None):
        status, payload = _call(_routeEvent("GET", "/lipsync/jobs/missing", None))

    assert status == 404
    assert payload == {"error": "not found"}


# --- DELETE /lipsync/jobs/{jobId} ----------------------------------------------------


def test_cancel_job_happy_path():
    with patch.object(storage, "getJob", return_value=_job(createdBy="user-1")), \
            patch.object(storage, "cancelJob", return_value=_job(status="cancelled")), \
            patch.object(budget, "finalizeJobHold") as mockFinalize:
        status, payload = _call(_routeEvent("DELETE", "/lipsync/jobs/abc", None))
    # Cancelling must free the hold -- the user pays nothing for work that
    # never ran.
    mockFinalize.assert_called_once()
    assert mockFinalize.call_args.kwargs["actualCents"] is None

    assert status == 200
    assert payload == {"jobId": "abc", "status": "cancelled"}


def test_cancel_job_not_found_404():
    with patch.object(storage, "getJob", return_value=None):
        status, payload = _call(_routeEvent("DELETE", "/lipsync/jobs/missing", None))

    assert status == 404


def test_cancel_job_already_terminal_409():
    with patch.object(storage, "getJob", return_value=_job(createdBy="user-1")), \
            patch.object(storage, "cancelJob", return_value=False):
        status, payload = _call(_routeEvent("DELETE", "/lipsync/jobs/abc", None))

    assert status == 409
    assert "error" in payload


# --- GET /lipsync/jobs/{jobId}/output ------------------------------------------------


def test_get_job_output_happy_path():
    job = _job(status="completed", outputKey="outputs/abc/abc.mp4")
    with patch.object(storage, "getJob", return_value=job), \
         patch.object(media, "presignGet", return_value="https://s3.example/get") as mockPresign:
        status, payload = _call(_routeEvent("GET", "/lipsync/jobs/abc/output", None))

    assert status == 200
    assert payload["url"] == "https://s3.example/get"
    mockPresign.assert_called_once_with("outputs/abc/abc.mp4", expiresIn=media.OUTPUT_URL_EXPIRES_IN)


def test_get_job_output_not_found_404():
    with patch.object(storage, "getJob", return_value=None):
        status, payload = _call(_routeEvent("GET", "/lipsync/jobs/missing/output", None))
    assert status == 404


def test_get_job_output_not_completed_400():
    job = _job(status="processing")
    with patch.object(storage, "getJob", return_value=job):
        status, payload = _call(_routeEvent("GET", "/lipsync/jobs/abc/output", None))
    assert status == 400


def test_get_job_output_completed_but_no_output_key_400():
    job = _job(status="completed", outputKey="")
    with patch.object(storage, "getJob", return_value=job):
        status, payload = _call(_routeEvent("GET", "/lipsync/jobs/abc/output", None))
    assert status == 400


# --- unknown path / wrong method -----------------------------------------------------


def test_unknown_path_404():
    status, payload = _call(_routeEvent("GET", "/lipsync/nope", None))
    assert status == 404
    assert payload == {"error": "not found"}


def test_wrong_method_on_known_path_404():
    status, payload = _call(_routeEvent("PATCH", "/lipsync/jobs", None))
    assert status == 404


def test_wrong_method_on_job_path_404():
    status, payload = _call(_routeEvent("PUT", "/lipsync/jobs/abc", None))
    assert status == 404


# --- handler is the Lambda entrypoint --------------------------------------------------


def test_handler_delegates_to_route():
    event = _routeEvent("GET", "/lipsync/jobs", None)
    with patch.object(routes, "route", return_value={"statusCode": 200, "body": "{}", "headers": {}}) as mockRoute:
        result = routes.handler(event, None)

    mockRoute.assert_called_once_with(event)
    assert result == {"statusCode": 200, "body": "{}", "headers": {}}


# --- ownership: the security boundary created by opening the gate --------------------
#
# Until budgets landed, every route required the admin group, so a table-wide
# scan and an unchecked getJob were harmless. With the module open to all
# signed-in users, ownership is the ONLY thing stopping one user reading,
# cancelling or downloading another's work. These are the tests that fail if
# that regresses.


def _otherUsersJob():
    return _job(createdBy="someone-else")


def _asUser(method, path, sub="user-1", groups="user"):
    event = _routeEvent(method, path, None)
    event["requestContext"]["authorizer"]["jwt"]["claims"]["sub"] = sub
    event["requestContext"]["authorizer"]["jwt"]["claims"]["cognito:groups"] = groups
    return event


def test_get_job_owned_by_another_user_is_404_not_403():
    """404, never 403: a 403 confirms the id EXISTS, which lets any user probe
    for other users' job ids."""
    with patch.object(storage, "getJob", return_value=_otherUsersJob()):
        status, payload = _call(_asUser("GET", "/lipsync/jobs/abc"))
    assert status == 404
    assert payload == {"error": "not found"}


def test_cancel_job_owned_by_another_user_is_404_and_does_not_cancel():
    with patch.object(storage, "getJob", return_value=_otherUsersJob()), \
            patch.object(storage, "cancelJob") as mockCancel:
        status, _ = _call(_asUser("DELETE", "/lipsync/jobs/abc"))
    assert status == 404
    mockCancel.assert_not_called()


def test_get_output_owned_by_another_user_is_404_and_presigns_nothing():
    with patch.object(storage, "getJob", return_value=_otherUsersJob()), \
            patch.object(media, "presignGet") as mockPresign:
        status, _ = _call(_asUser("GET", "/lipsync/jobs/abc/output"))
    assert status == 404
    mockPresign.assert_not_called()


def test_list_jobs_is_scoped_to_the_calling_user():
    with patch.object(storage, "listJobs", return_value=([], None)) as mockList:
        _call(_asUser("GET", "/lipsync/jobs", sub="user-9"))
    assert mockList.call_args.kwargs["createdBy"] == "user-9"


def test_admin_sees_all_jobs_and_any_single_job():
    with patch.object(storage, "listJobs", return_value=([], None)) as mockList:
        _call(_asUser("GET", "/lipsync/jobs", sub="admin-1", groups="admin"))
    assert mockList.call_args.kwargs["createdBy"] is None

    with patch.object(storage, "getJob", return_value=_otherUsersJob()):
        status, _ = _call(_asUser("GET", "/lipsync/jobs/abc", sub="admin-1", groups="admin"))
    assert status == 200


def test_owner_can_read_their_own_job():
    with patch.object(storage, "getJob", return_value=_job(createdBy="user-1")):
        status, _ = _call(_asUser("GET", "/lipsync/jobs/abc", sub="user-1"))
    assert status == 200


# --- spend control at the route boundary ---------------------------------------------


def test_create_job_rejected_when_budget_insufficient_makes_no_job_and_no_provider_call():
    """A rejected job must cost nothing and leave no trace: no reservation
    consumed, no job row, no runner invocation, no fal call."""
    mocks = _patchCreateJobHappy(reserveOk=False)
    with mocks[0], mocks[1], mocks[2], mocks[3] as mockCreate, mocks[4] as mockInvoke, \
            mocks[5], mocks[6], mocks[7], mocks[8]:
        status, payload = _call(_routeEvent("POST", "/lipsync/jobs", _createJobBody()))

    assert status == 400
    mockCreate.assert_not_called()
    mockInvoke.assert_not_called()
    assert any("remaining" in e for e in payload["errors"])


def test_create_job_with_no_budget_record_says_so_explicitly():
    mocks = _patchCreateJobHappy(reserveOk=False)
    with mocks[0], mocks[1], mocks[2], mocks[3], mocks[4], mocks[5], \
            mocks[6], patch.object(budget, "getBudget", return_value=_budgetRecord(exists=False)), mocks[8]:
        status, payload = _call(_routeEvent("POST", "/lipsync/jobs", _createJobBody()))

    assert status == 400
    assert any("budget" in e.lower() for e in payload["errors"])


def test_create_job_blocked_when_fal_balance_below_floor():
    """Killswitch: a hard floor on the REAL money, independent of any user's
    budget, because per-job cost can only ever be estimated."""
    mocks = _patchCreateJobHappy(balanceCents=1)
    with mocks[0], mocks[1], mocks[2], mocks[3] as mockCreate, mocks[4], mocks[5], mocks[6], mocks[7], mocks[8]:
        status, payload = _call(_routeEvent("POST", "/lipsync/jobs", _createJobBody()))

    assert status == 400
    mockCreate.assert_not_called()
    assert any("balance" in e.lower() for e in payload["errors"])


def test_create_job_not_blocked_when_balance_merely_unavailable():
    """A fal outage must not become a total outage -- the killswitch applies
    only when a balance was genuinely READ and is genuinely low."""
    mocks = _patchCreateJobHappy()
    unavailable = billing.BalanceResult(None, "", reason="could not reach fal")
    with mocks[0], mocks[1], mocks[2], mocks[3], mocks[4], \
            patch.object(billing, "getBalance", return_value=unavailable), mocks[6], mocks[7], mocks[8]:
        status, _ = _call(_routeEvent("POST", "/lipsync/jobs", _createJobBody()))

    assert status == 201


def test_budget_route_returns_only_the_callers_own_budget():
    with patch.object(budget, "getBudget", return_value=_budgetRecord()) as mockGet:
        status, payload = _call(_asUser("GET", "/lipsync/budget", sub="user-1"))
    assert status == 200
    # Keyed on email (the identity an admin grants against), not the sub.
    assert mockGet.call_args[0][0] == "a@example.com"
    assert "falBalanceCents" not in payload, "the fal account balance must never reach a normal user"
