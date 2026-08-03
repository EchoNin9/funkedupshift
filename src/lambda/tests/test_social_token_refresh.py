"""Unit tests for social/token_refresh.py (monthly Instagram token
validator/heartbeat, per docs/social/instagram-api-notes.md §9/§10).

Follows test_social_maintenance.py's convention of mocking the collaborator
modules (secrets, alerts) directly rather than hitting real SSM/HTTP. The
Graph API itself is mocked at the urlopen level, same pattern as
test_social_bluesky.py -- no moto, no real network calls.
"""
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Distinctive sentinel secret values -- used ONLY to assert they never leak
# into any alert/log call (test_no_secret_material_leaks below). Never
# assert these appear anywhere except the mocked HTTP request layer.
SENTINEL_TOKEN = "IGT0K3N-sentinel-should-never-be-logged"
SENTINEL_APP_SECRET = "APPSECRET-sentinel-should-never-be-logged"
SENTINEL_USER_TOKEN = "USERTOKEN-sentinel-should-never-be-logged"
SENTINEL_NEW_USER_TOKEN = "NEWUSERTOKEN-sentinel-should-never-be-logged"


def _mockResponse(payload):
    """A context-manager-compatible stand-in for urlopen()'s return value,
    matching the convention in test_social_bluesky.py."""
    resp = MagicMock()
    resp.read.return_value = json.dumps(payload).encode("utf-8")
    resp.__enter__ = MagicMock(return_value=resp)
    resp.__exit__ = MagicMock(return_value=False)
    return resp


def _httpError(code, message, fbtraceId="trace-abc123"):
    body = json.dumps({
        "error": {
            "message": message,
            "type": "OAuthException",
            "code": code,
            "fbtrace_id": fbtraceId,
        }
    }).encode("utf-8")
    err = HTTPError(url="https://graph.facebook.com/x", code=code, msg="err", hdrs=None, fp=None)
    err.read = MagicMock(return_value=body)
    return err


def _account(accountId):
    return {"platform": "instagram", "accountId": accountId, "handle": ""}


def _debugTokenResponse(is_valid=True, expires_at=0, scopes=("instagram_content_publish",)):
    return _mockResponse({"data": {"is_valid": is_valid, "expires_at": expires_at, "scopes": list(scopes)}})


def _livenessResponse(igUserId="17841400000000"):
    return _mockResponse({"id": igUserId})


def _appCreds():
    return ("app-123", SENTINEL_APP_SECRET)


def _accountCreds(igUserId="17841400000000"):
    return (igUserId, SENTINEL_TOKEN)


# --- 1. all accounts healthy -> heartbeat, no alert ---------------------------------


@patch("social.token_refresh.urlopen")
def test_all_accounts_healthy_sends_heartbeat_not_alert(mock_urlopen):
    from social import alerts, secrets, token_refresh

    mock_urlopen.side_effect = [
        _debugTokenResponse(),      # debug_token
        _livenessResponse(),        # liveness probe
    ]

    with patch.object(secrets, "getInstagramAppCredentials", return_value=_appCreds()), \
         patch.object(secrets, "listAccounts", return_value=[_account("acct-a")]), \
         patch.object(secrets, "getInstagramCredentials", return_value=_accountCreds()), \
         patch.object(secrets, "getInstagramUserToken", return_value=None), \
         patch.object(alerts, "sendHeartbeat") as mockHeartbeat, \
         patch.object(alerts, "sendAlert") as mockAlert:
        result = token_refresh.handler({"job": "refresh_instagram_token"}, None)

    mockHeartbeat.assert_called_once()
    mockAlert.assert_not_called()
    assert result["ok"] is True
    assert result["accounts"][0]["healthy"] is True
    assert result["accounts"][0]["status"] == "valid"


# --- 2. one account invalid -> alert names the account slug -------------------------


@patch("social.token_refresh.urlopen")
def test_invalid_account_alerts_and_names_the_account_slug(mock_urlopen):
    from social import alerts, secrets, token_refresh

    mock_urlopen.side_effect = [
        _debugTokenResponse(is_valid=False),  # debug_token: invalid
    ]

    with patch.object(secrets, "getInstagramAppCredentials", return_value=_appCreds()), \
         patch.object(secrets, "listAccounts", return_value=[_account("acct-bad")]), \
         patch.object(secrets, "getInstagramCredentials", return_value=_accountCreds()), \
         patch.object(secrets, "getInstagramUserToken", return_value=None), \
         patch.object(alerts, "sendHeartbeat") as mockHeartbeat, \
         patch.object(alerts, "sendAlert") as mockAlert:
        result = token_refresh.handler({}, None)

    mockAlert.assert_called_once()
    mockHeartbeat.assert_not_called()
    alertMessage = mockAlert.call_args.args[1]
    assert "acct-bad" in alertMessage
    assert result["ok"] is False
    assert result["accounts"][0]["status"] == "invalid"


# --- 3. expires_at == 0 -> healthy (never expires), mandatory -----------------------


@patch("social.token_refresh.urlopen")
def test_expires_at_zero_is_treated_as_never_expires_not_expired(mock_urlopen):
    from social import alerts, secrets, token_refresh

    mock_urlopen.side_effect = [
        _debugTokenResponse(expires_at=0),
        _livenessResponse(),
    ]

    with patch.object(secrets, "getInstagramAppCredentials", return_value=_appCreds()), \
         patch.object(secrets, "listAccounts", return_value=[_account("acct-a")]), \
         patch.object(secrets, "getInstagramCredentials", return_value=_accountCreds()), \
         patch.object(secrets, "getInstagramUserToken", return_value=None), \
         patch.object(alerts, "sendHeartbeat") as mockHeartbeat, \
         patch.object(alerts, "sendAlert") as mockAlert:
        result = token_refresh.handler({}, None)

    verdict = result["accounts"][0]
    assert verdict["healthy"] is True
    assert verdict["status"] == "valid"
    assert verdict["warnings"] == []
    mockAlert.assert_not_called()
    mockHeartbeat.assert_called_once()


# --- 4. expires_at 7 days out -> flagged expiring-soon, alerted ---------------------


@patch("social.token_refresh.urlopen")
def test_expires_at_seven_days_out_flagged_expiring_soon_and_alerted(mock_urlopen):
    from social import alerts, secrets, token_refresh

    fixedNow = 1_700_000_000
    sevenDaysOut = fixedNow + 7 * token_refresh.SECONDS_PER_DAY

    mock_urlopen.side_effect = [
        _debugTokenResponse(expires_at=sevenDaysOut),
        _livenessResponse(),
    ]

    with patch.object(token_refresh, "_nowEpochSeconds", return_value=fixedNow), \
         patch.object(secrets, "getInstagramAppCredentials", return_value=_appCreds()), \
         patch.object(secrets, "listAccounts", return_value=[_account("acct-a")]), \
         patch.object(secrets, "getInstagramCredentials", return_value=_accountCreds()), \
         patch.object(secrets, "getInstagramUserToken", return_value=None), \
         patch.object(alerts, "sendAlert") as mockAlert, \
         patch.object(alerts, "sendHeartbeat") as mockHeartbeat:
        result = token_refresh.handler({}, None)

    verdict = result["accounts"][0]
    assert verdict["status"] == "expiring-soon"
    assert verdict["healthy"] is False
    mockAlert.assert_called_once()
    mockHeartbeat.assert_not_called()


# --- 5. missing instagram_content_publish scope -> warned ---------------------------


@patch("social.token_refresh.urlopen")
def test_missing_content_publish_scope_is_warned_about(mock_urlopen):
    from social import alerts, secrets, token_refresh

    mock_urlopen.side_effect = [
        _debugTokenResponse(expires_at=0, scopes=("instagram_basic",)),
        _livenessResponse(),
    ]

    with patch.object(secrets, "getInstagramAppCredentials", return_value=_appCreds()), \
         patch.object(secrets, "listAccounts", return_value=[_account("acct-a")]), \
         patch.object(secrets, "getInstagramCredentials", return_value=_accountCreds()), \
         patch.object(secrets, "getInstagramUserToken", return_value=None), \
         patch.object(alerts, "sendAlert") as mockAlert, \
         patch.object(alerts, "sendHeartbeat"):
        result = token_refresh.handler({}, None)

    verdict = result["accounts"][0]
    assert verdict["status"] == "missing-scope"
    assert "instagram_content_publish" in verdict["detail"]
    mockAlert.assert_called_once()


# --- 6. user token present -> exchanged AND written to SSM --------------------------


@patch("social.token_refresh.urlopen")
def test_user_token_present_is_exchanged_and_persisted_to_ssm(mock_urlopen):
    from social import alerts, secrets, token_refresh

    mockSsm = MagicMock()

    mock_urlopen.side_effect = [
        _debugTokenResponse(),
        _livenessResponse(),
        _mockResponse({"access_token": SENTINEL_NEW_USER_TOKEN, "token_type": "bearer", "expires_in": 5183944}),
    ]

    with patch.object(secrets, "getInstagramAppCredentials", return_value=_appCreds()), \
         patch.object(secrets, "listAccounts", return_value=[_account("acct-a")]), \
         patch.object(secrets, "getInstagramCredentials", return_value=_accountCreds()), \
         patch.object(secrets, "getInstagramUserToken", return_value=SENTINEL_USER_TOKEN), \
         patch.object(secrets, "_client", return_value=mockSsm), \
         patch.object(alerts, "sendHeartbeat") as mockHeartbeat, \
         patch.object(alerts, "sendAlert") as mockAlert:
        result = token_refresh.handler({}, None)

    mockSsm.put_parameter.assert_called_once()
    kwargs = mockSsm.put_parameter.call_args.kwargs
    assert kwargs["Name"] == "/funkedupshift/social/instagram/user-token"
    assert kwargs["Value"] == SENTINEL_NEW_USER_TOKEN
    assert kwargs["Type"] == "SecureString"
    assert kwargs["Overwrite"] is True
    assert result["userTokenExchange"]["ok"] is True
    mockAlert.assert_not_called()
    mockHeartbeat.assert_called_once()


# --- 7. no user token configured -> put_parameter never called, job succeeds -------


@patch("social.token_refresh.urlopen")
def test_no_user_token_configured_put_parameter_never_called(mock_urlopen):
    from social import alerts, secrets, token_refresh

    mockSsm = MagicMock()

    mock_urlopen.side_effect = [
        _debugTokenResponse(),
        _livenessResponse(),
    ]

    with patch.object(secrets, "getInstagramAppCredentials", return_value=_appCreds()), \
         patch.object(secrets, "listAccounts", return_value=[_account("acct-a")]), \
         patch.object(secrets, "getInstagramCredentials", return_value=_accountCreds()), \
         patch.object(secrets, "getInstagramUserToken", return_value=None), \
         patch.object(secrets, "_client", return_value=mockSsm), \
         patch.object(alerts, "sendHeartbeat"), \
         patch.object(alerts, "sendAlert"):
        result = token_refresh.handler({}, None)

    mockSsm.put_parameter.assert_not_called()
    assert result["ok"] is True
    assert result["userTokenExchange"] is None


# --- 8. fb_exchange_token HTTP error -> alert, no raise, other checks still ran -----


@patch("social.token_refresh.urlopen")
def test_exchange_http_error_alerts_and_does_not_raise_other_checks_ran(mock_urlopen):
    from social import alerts, secrets, token_refresh

    mock_urlopen.side_effect = [
        _debugTokenResponse(),
        _livenessResponse(),
        _httpError(400, "Error validating verification code."),
    ]

    with patch.object(secrets, "getInstagramAppCredentials", return_value=_appCreds()), \
         patch.object(secrets, "listAccounts", return_value=[_account("acct-a")]), \
         patch.object(secrets, "getInstagramCredentials", return_value=_accountCreds()), \
         patch.object(secrets, "getInstagramUserToken", return_value=SENTINEL_USER_TOKEN), \
         patch.object(alerts, "sendAlert") as mockAlert, \
         patch.object(alerts, "sendHeartbeat") as mockHeartbeat:
        result = token_refresh.handler({}, None)

    # must not raise -- reaching this line proves that
    assert result["ok"] is False
    assert result["userTokenExchange"]["ok"] is False
    assert "Error validating verification code" in result["userTokenExchange"]["detail"]
    # the per-account check still ran and was healthy despite the exchange failure
    assert result["accounts"][0]["healthy"] is True
    mockAlert.assert_called_once()
    mockHeartbeat.assert_not_called()


# --- 9. one account raising mid-loop doesn't block the rest -------------------------


@patch("social.token_refresh.urlopen")
def test_one_account_raising_unexpectedly_does_not_block_remaining_accounts(mock_urlopen):
    from social import alerts, secrets, token_refresh

    # acct-a's debug_token call raises something totally unexpected (not
    # HTTPError/URLError) to prove the broad guard in _refreshInstagramTokens
    # catches it; acct-b proceeds normally afterwards.
    mock_urlopen.side_effect = [
        RuntimeError("boom"),
        _debugTokenResponse(),
        _livenessResponse(),
    ]

    def _credsForAccount(accountId):
        return (f"ig-user-{accountId}", SENTINEL_TOKEN)

    with patch.object(secrets, "getInstagramAppCredentials", return_value=_appCreds()), \
         patch.object(secrets, "listAccounts", return_value=[_account("acct-a"), _account("acct-b")]), \
         patch.object(secrets, "getInstagramCredentials", side_effect=_credsForAccount), \
         patch.object(secrets, "getInstagramUserToken", return_value=None), \
         patch.object(alerts, "sendAlert") as mockAlert, \
         patch.object(alerts, "sendHeartbeat"):
        result = token_refresh.handler({}, None)

    assert len(result["accounts"]) == 2
    assert result["accounts"][0]["accountId"] == "acct-a"
    assert result["accounts"][0]["healthy"] is False
    assert result["accounts"][1]["accountId"] == "acct-b"
    assert result["accounts"][1]["healthy"] is True
    mockAlert.assert_called_once()


# --- 10. liveness probe failing -> reported unhealthy -------------------------------


@patch("social.token_refresh.urlopen")
def test_liveness_probe_failure_is_reported_unhealthy(mock_urlopen):
    from social import alerts, secrets, token_refresh

    mock_urlopen.side_effect = [
        _debugTokenResponse(),           # debug_token looks fine
        _httpError(190, "Invalid OAuth access token."),  # but liveness probe fails
    ]

    with patch.object(secrets, "getInstagramAppCredentials", return_value=_appCreds()), \
         patch.object(secrets, "listAccounts", return_value=[_account("acct-a")]), \
         patch.object(secrets, "getInstagramCredentials", return_value=_accountCreds()), \
         patch.object(secrets, "getInstagramUserToken", return_value=None), \
         patch.object(alerts, "sendAlert") as mockAlert, \
         patch.object(alerts, "sendHeartbeat") as mockHeartbeat:
        result = token_refresh.handler({}, None)

    verdict = result["accounts"][0]
    assert verdict["healthy"] is False
    assert verdict["status"] == "invalid"
    assert "liveness probe" in verdict["detail"]
    mockAlert.assert_called_once()
    mockHeartbeat.assert_not_called()


# --- 11. no secret material ever leaks into alerts or logs --------------------------


@patch("social.token_refresh.urlopen")
def test_no_secret_material_leaks_into_alerts_or_logs(mock_urlopen, caplog):
    from social import alerts, secrets, token_refresh

    mockSsm = MagicMock()

    # A mixed run: one healthy account, one invalid account (HTTP error with
    # a body that must never surface secrets), plus a user-token exchange --
    # exercises every code path that touches a credential in one go.
    mock_urlopen.side_effect = [
        _debugTokenResponse(),
        _livenessResponse(),
        _httpError(190, "Invalid OAuth access token."),
        _mockResponse({"access_token": SENTINEL_NEW_USER_TOKEN}),
    ]

    with patch.object(secrets, "getInstagramAppCredentials", return_value=_appCreds()), \
         patch.object(secrets, "listAccounts", return_value=[_account("acct-a"), _account("acct-b")]), \
         patch.object(secrets, "getInstagramCredentials", return_value=_accountCreds()), \
         patch.object(secrets, "getInstagramUserToken", return_value=SENTINEL_USER_TOKEN), \
         patch.object(secrets, "_client", return_value=mockSsm), \
         patch.object(alerts, "sendAlert") as mockAlert, \
         patch.object(alerts, "sendHeartbeat") as mockHeartbeat, \
         caplog.at_level("DEBUG"):
        token_refresh.handler({}, None)

    secretValues = [SENTINEL_TOKEN, SENTINEL_APP_SECRET, SENTINEL_USER_TOKEN, SENTINEL_NEW_USER_TOKEN]

    allAlertText = []
    for call in mockAlert.call_args_list + mockHeartbeat.call_args_list:
        allAlertText.extend(str(a) for a in call.args)
        allAlertText.extend(str(v) for v in call.kwargs.values())

    for secret in secretValues:
        for text in allAlertText:
            assert secret not in text
        assert secret not in caplog.text
