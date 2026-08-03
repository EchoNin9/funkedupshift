"""Unit tests for social/routes.py (phase 4 -- API Gateway HTTP dispatch) and
the handler.py detection that delegates to it. No moto -- storage/secrets/
media/directHandler/publisher are all mocked, matching the
patch.object conventions used elsewhere in this repo (see
test_social_handler_actions.py)."""
import json
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


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
    from social import routes
    resp = routes.route(event)
    return resp["statusCode"], json.loads(resp["body"])


ALL_ROUTES = [
    ("GET", "/social/accounts", None),
    ("GET", "/social/posts?month=2026-08", None),
    ("POST", "/social/posts", {"text": "hi", "scheduledAt": "2026-08-02T15:00:00Z", "accounts": []}),
    ("GET", "/social/posts/abc", None),
    ("DELETE", "/social/posts/abc", None),
    ("POST", "/social/posts/abc/retry", {}),
    ("POST", "/social/media/presign", {"filename": "x.png", "contentType": "image/png", "sizeBytes": 10}),
]


def _routeEvent(method, path, body):
    # strip query string for path/pathParameters purposes
    rawPath = path.split("?")[0]
    qs = None
    if "?" in path:
        qs = dict(pair.split("=") for pair in path.split("?", 1)[1].split("&"))
    pathParameters = {}
    parts = [p for p in rawPath.split("/") if p]
    if len(parts) >= 3 and parts[1] == "posts":
        pathParameters["postId"] = parts[2]
    return _event(method, rawPath, body=body, queryStringParameters=qs, pathParameters=pathParameters)


# --- auth: admin group required on every route ---------------------------------------


def test_every_route_requires_admin_group_403_for_non_admin():
    for method, path, body in ALL_ROUTES:
        event = _routeEvent(method, path, body)
        event["requestContext"]["authorizer"]["jwt"]["claims"]["cognito:groups"] = "user"
        status, payload = _call(event)
        assert status == 403, f"{method} {path} expected 403, got {status}"
        assert payload == {"error": "forbidden"}


def test_every_route_401s_with_no_claims():
    for method, path, body in ALL_ROUTES:
        event = _routeEvent(method, path, body)
        event["requestContext"]["authorizer"] = {}
        status, payload = _call(event)
        assert status == 401, f"{method} {path} expected 401, got {status}"
        assert payload == {"error": "unauthorized"}


def test_cognito_groups_as_space_separated_string_parses():
    from social import routes
    claims = {"sub": "u", "cognito:groups": "[admin manager]"}
    parsed = routes._parseGroups(claims["cognito:groups"])
    assert "admin" in parsed
    assert "manager" in parsed


def test_cognito_groups_as_list_parses():
    from social import routes
    parsed = routes._parseGroups(["admin", "manager"])
    assert parsed == ["admin", "manager"]


def test_cognito_groups_single_value_no_brackets():
    from social import routes
    assert routes._parseGroups("admin") == ["admin"]


def test_cognito_groups_json_array_string_parses():
    from social import routes
    parsed = routes._parseGroups('["admin", "manager"]')
    assert parsed == ["admin", "manager"]


# --- GET /social/accounts --------------------------------------------------------------


def test_get_accounts_happy_path_and_never_leaks_app_password():
    from social import routes, secrets

    accounts = [{"platform": "bluesky", "accountId": "personal", "handle": "jinksy.bsky.social"}]
    with patch.object(secrets, "listAccounts", return_value=accounts):
        status, payload = _call(_routeEvent("GET", "/social/accounts", None))

    assert status == 200
    assert payload == {"accounts": accounts}
    dumped = json.dumps(payload)
    assert "app-password" not in dumped
    assert "password" not in dumped.lower()


# --- GET /social/posts?month= -----------------------------------------------------------


def test_list_posts_happy_path_includes_targets():
    from social import routes, storage

    parent = {"postId": "abc", "monthKey": "2026-08"}
    full = {"parent": {"postId": "abc", "monthKey": "2026-08"}, "targets": [{"platform": "bluesky"}]}
    with patch.object(storage, "listPostsByMonth", return_value=[parent]), \
         patch.object(storage, "getPost", return_value=full):
        status, payload = _call(_routeEvent("GET", "/social/posts?month=2026-08", None))

    assert status == 200
    assert payload["posts"] == [{"postId": "abc", "monthKey": "2026-08", "targets": [{"platform": "bluesky"}]}]


def test_list_posts_missing_month_400():
    status, payload = _call(_routeEvent("GET", "/social/posts", None))
    assert status == 400
    assert "error" in payload


def test_list_posts_malformed_month_400():
    status, payload = _call(_routeEvent("GET", "/social/posts?month=not-a-month", None))
    assert status == 400
    assert "error" in payload


# --- POST /social/posts ------------------------------------------------------------------


def test_create_post_happy_path_201():
    from social import storage

    with patch("social.handler._actionCreate", return_value={"ok": True, "postId": "abc", "immediate": False}), \
         patch.object(storage, "getPost", return_value={"parent": {"postId": "abc"}, "targets": []}):
        status, payload = _call(_routeEvent(
            "POST", "/social/posts",
            {"text": "hi", "scheduledAt": "2026-08-02T15:00:00Z", "accounts": [{"platform": "bluesky", "accountId": "a"}]},
        ))

    assert status == 201
    assert payload["postId"] == "abc"
    assert payload["post"] == {"parent": {"postId": "abc"}, "targets": []}


def test_create_post_validation_failure_400_errors_list():
    with patch("social.handler._actionCreate", return_value={"ok": False, "error": "scheduledAt is required"}):
        status, payload = _call(_routeEvent("POST", "/social/posts", {"text": "hi", "accounts": []}))

    assert status == 400
    assert payload["errors"] == ["scheduledAt is required"]


def test_create_post_publisher_validation_errors_list_passthrough():
    with patch("social.handler._actionCreate", return_value={"ok": False, "errors": ["text too long"]}):
        status, payload = _call(_routeEvent(
            "POST", "/social/posts",
            {"text": "x" * 400, "scheduledAt": "2026-08-02T15:00:00Z", "accounts": [{"platform": "bluesky", "accountId": "a"}]},
        ))

    assert status == 400
    assert payload["errors"] == ["text too long"]


def test_create_post_invalid_json_body_400():
    event = _routeEvent("POST", "/social/posts", None)
    event["body"] = "{not json"
    status, payload = _call(event)
    assert status == 400
    assert "errors" in payload


# --- GET /social/posts/{postId} -----------------------------------------------------------


def test_get_post_happy_path():
    from social import storage
    full = {"parent": {"postId": "abc"}, "targets": []}
    with patch.object(storage, "getPost", return_value=full):
        status, payload = _call(_routeEvent("GET", "/social/posts/abc", None))

    assert status == 200
    assert payload["post"] == full


def test_get_post_unknown_404():
    from social import storage
    with patch.object(storage, "getPost", return_value={"parent": None, "targets": []}):
        status, payload = _call(_routeEvent("GET", "/social/posts/missing", None))

    assert status == 404
    assert payload == {"error": "not found"}


# --- DELETE /social/posts/{postId} --------------------------------------------------------


def test_cancel_post_happy_path():
    result = {"ok": True, "postId": "abc", "post": {"parent": {"status": "cancelled"}, "targets": []}}
    with patch("social.handler._actionCancel", return_value=result):
        status, payload = _call(_routeEvent("DELETE", "/social/posts/abc", None))

    assert status == 200
    assert payload["postId"] == "abc"
    assert payload["post"] == result["post"]


def test_cancel_post_unknown_404():
    with patch("social.handler._actionCancel", return_value={"ok": False, "error": "not found"}):
        status, payload = _call(_routeEvent("DELETE", "/social/posts/missing", None))

    assert status == 404


# --- POST /social/posts/{postId}/retry ------------------------------------------------------


def test_retry_specific_target_happy_path():
    from social import storage
    result = {"ok": True, "postId": "abc"}
    full = {"parent": {"postId": "abc"}, "targets": []}
    with patch("social.handler._actionRetry", return_value=result) as mockRetry, \
         patch.object(storage, "getPost", return_value=full):
        status, payload = _call(_routeEvent(
            "POST", "/social/posts/abc/retry", {"platform": "bluesky", "accountId": "a"}
        ))

    mockRetry.assert_called_once_with({"postId": "abc", "platform": "bluesky", "accountId": "a"})
    assert status == 200
    assert payload["postId"] == "abc"
    assert payload["post"] == full


def test_retry_all_failed_targets_when_omitted():
    from social import routes, storage

    post = {
        "parent": {"postId": "abc"},
        "targets": [
            {"platform": "bluesky", "accountId": "a", "status": storage.STATUS_FAILED},
            {"platform": "bluesky", "accountId": "b", "status": storage.STATUS_PUBLISHED},
        ],
    }
    with patch.object(storage, "getPost", return_value=post) as mockGet, \
         patch.object(storage, "updateTargetStatus") as mockUpdate, \
         patch.object(routes, "processPost") as mockProcess:
        status, payload = _call(_routeEvent("POST", "/social/posts/abc/retry", {}))

    mockUpdate.assert_called_once_with("abc", "bluesky", "a", storage.STATUS_PENDING, lastError="")
    mockProcess.assert_called_once_with("abc")
    assert status == 200
    assert mockGet.call_count >= 1


def test_retry_partial_platform_accountid_400():
    status, payload = _call(_routeEvent("POST", "/social/posts/abc/retry", {"platform": "bluesky"}))
    assert status == 400
    assert "errors" in payload


def test_retry_unknown_post_404():
    from social import storage
    with patch.object(storage, "getPost", return_value={"parent": None, "targets": []}):
        status, payload = _call(_routeEvent("POST", "/social/posts/missing/retry", {}))

    assert status == 404


# --- POST /social/media/presign -----------------------------------------------------------


def test_presign_happy_path():
    from social import media
    with patch.object(media, "presignPut", return_value="https://s3.example/put") as mockPresign:
        status, payload = _call(_routeEvent(
            "POST", "/social/media/presign",
            {"filename": "photo.png", "contentType": "image/png", "sizeBytes": 12345},
        ))

    assert status == 200
    assert payload["uploadUrl"] == "https://s3.example/put"
    assert payload["expiresIn"] == 3600
    assert payload["key"].startswith("uploads/user-1/")
    assert payload["key"].endswith("/photo.png")
    mockPresign.assert_called_once()


def test_presign_rejects_bad_content_type():
    status, payload = _call(_routeEvent(
        "POST", "/social/media/presign",
        {"filename": "x.exe", "contentType": "application/x-msdownload", "sizeBytes": 10},
    ))
    assert status == 400
    assert any("contentType" in e for e in payload["errors"])


def test_presign_rejects_oversize():
    status, payload = _call(_routeEvent(
        "POST", "/social/media/presign",
        {"filename": "x.mp4", "contentType": "video/mp4", "sizeBytes": 100_000_001},
    ))
    assert status == 400
    assert any("sizeBytes" in e for e in payload["errors"])


def test_presign_sanitizes_traversal_and_spaces():
    from social import routes
    sanitized = routes._sanitizeFilename("../../etc/my file (1).png")
    assert "/" not in sanitized
    assert ".." not in sanitized
    assert " " not in sanitized
    assert sanitized.endswith(".png")


def test_presign_key_uses_sanitized_filename():
    from social import media
    with patch.object(media, "presignPut", return_value="https://s3.example/put"):
        status, payload = _call(_routeEvent(
            "POST", "/social/media/presign",
            {"filename": "../../evil dir/my file.png", "contentType": "image/png", "sizeBytes": 10},
        ))

    assert status == 200
    assert " " not in payload["key"]
    assert ".." not in payload["key"]


# --- unknown path / wrong method -----------------------------------------------------------


def test_unknown_path_404():
    status, payload = _call(_routeEvent("GET", "/social/nope", None))
    assert status == 404
    assert payload == {"error": "not found"}


def test_wrong_method_on_known_path_404():
    status, payload = _call(_routeEvent("PATCH", "/social/accounts", None))
    assert status == 404


def test_wrong_method_on_post_path_404():
    status, payload = _call(_routeEvent("PUT", "/social/posts/abc", None))
    assert status == 404


# --- handler.py dispatch: API Gateway vs. direct-invoke -----------------------------------


def test_handler_delegates_api_gateway_events_to_routes():
    from social import handler

    event = _routeEvent("GET", "/social/accounts", None)
    with patch("social.routes.route", return_value={"statusCode": 200, "body": "{}", "headers": {}}) as mockRoute:
        result = handler.handler(event, None)

    mockRoute.assert_called_once_with(event)
    assert result == {"statusCode": 200, "body": "{}", "headers": {}}


def test_handler_direct_invoke_still_returns_plain_dict_unchanged():
    """Phase-1/2 behaviour must be completely unaffected by phase 4 -- a
    direct invoke (no requestContext.http) never touches routes.py and never
    gets an API Gateway envelope back."""
    from social import handler
    from social.publishers.base import PublishResult

    with patch.object(handler, "getPublisher") as mockGetPublisher:
        class _FakePublisher:
            def validate(self, request):
                return []

            def publish(self, request):
                return PublishResult(ok=True, permalink="https://x", platformPostId="id")

        mockGetPublisher.return_value = _FakePublisher
        result = handler.handler({"accountId": "a", "platform": "bluesky", "text": "hi"}, None)

    assert result == {"ok": True, "permalink": "https://x", "platformPostId": "id", "error": None}
    assert "statusCode" not in result
    assert "body" not in result
