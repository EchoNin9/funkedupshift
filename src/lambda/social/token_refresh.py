"""
Monthly Instagram token validator/heartbeat (see docs/social/instagram-api-notes.md
§9 for the token model, §10 for Meta's error envelope).

The Page access token used for publishing is effectively non-expiring in the
Facebook-Login model this project uses, so this job is primarily a
liveness/validity check across every configured Instagram account -- NOT a
refresh of the publishing token itself. A real refresh only happens for the
OPTIONAL shared long-lived user token, when one has been configured (see
secrets.getInstagramUserToken).

Alerts on BOTH outcomes -- sendHeartbeat when everything is healthy,
sendAlert when anything is invalid/expiring/failed -- so this job doubles as
the module's monthly heartbeat, same idea as maintenance.py's daily one.

SECURITY, absolute: never log, print, alert on, or include in any exception
message a token or secret VALUE, not even truncated. Only parameter names
and account slugs. Every f-string in this file that touches a credential
variable must go through _metaErrorInfo (which only ever reads Meta's own
`message`/`fbtrace_id` fields -- neither of which echoes back request
credentials) -- never interpolate accountToken/appSecret/userToken directly.
"""
import json
import logging
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from social import alerts, secrets

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

GRAPH_API_BASE = "https://graph.facebook.com/v25.0"
REQUEST_TIMEOUT_SEC = 10

# Warn when a (non-zero) expires_at is under this many days away.
EXPIRING_SOON_DAYS = 14
SECONDS_PER_DAY = 86400

REQUIRED_SCOPE = "instagram_content_publish"

JOB_NAME = "refresh_instagram_token"


def _nowEpochSeconds():
    return time.time()


def _get(url):
    req = Request(url, method="GET")
    with urlopen(req, timeout=REQUEST_TIMEOUT_SEC) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _metaErrorInfo(e):
    """Parse Meta's standard error envelope (§10) out of an HTTPError body:
    {"error": {"message", "type", "code", "error_subcode", "fbtrace_id"}}.

    Returns (message, fbtraceId). Never raises -- falls back to a generic
    HTTP-code message if the body isn't the expected shape. Safe to log:
    Meta's error envelope never echoes back the access_token/app-secret
    that was sent, only describes the failure.
    """
    try:
        body = e.read()
        data = json.loads(body.decode("utf-8"))
        err = data.get("error", {})
        message = err.get("message") or f"HTTP {e.code}"
        fbtraceId = err.get("fbtrace_id")
        return message, fbtraceId
    except Exception:
        return f"HTTP {getattr(e, 'code', '?')}", None


def _formatMetaFailure(prefix, e):
    if isinstance(e, HTTPError):
        message, fbtraceId = _metaErrorInfo(e)
        suffix = f" (fbtrace_id={fbtraceId})" if fbtraceId else ""
        return f"{prefix}: {message}{suffix}"
    if isinstance(e, URLError):
        return f"{prefix}: network error: {e.reason}"
    return f"{prefix}: unparseable response: {e}"


def _debugToken(accountToken, appId, appSecret):
    """GET /debug_token for accountToken, returning the `data` object.
    Raises HTTPError/URLError/ValueError/KeyError -- caller decides what a
    failure means for this account's verdict."""
    qs = urlencode({
        "input_token": accountToken,
        "access_token": f"{appId}|{appSecret}",
    })
    resp = _get(f"{GRAPH_API_BASE}/debug_token?{qs}")
    return resp["data"]


def _livenessProbe(igUserId, accountToken):
    """GET /{ig-user-id}?fields=id using the account's own token -- a cheap
    proof the token actually works against THIS account (debug_token alone
    only proves the token parses/is valid in the abstract). Raises on any
    failure; returns the parsed JSON on success (unused beyond that)."""
    qs = urlencode({"fields": "id", "access_token": accountToken})
    return _get(f"{GRAPH_API_BASE}/{igUserId}?{qs}")


def _newVerdict(accountId):
    return {
        "accountId": accountId,
        "healthy": False,
        "status": "unknown",  # valid | invalid | expiring-soon | missing-scope
        "warnings": [],
        "detail": "",
    }


def _checkAccount(account, appId, appSecret):
    """Validate one configured Instagram account: debug_token + a liveness
    probe against its own ig-user-id. Never raises -- every failure mode is
    caught and turned into an unhealthy verdict so one bad account can't
    stop the others from being checked (the caller also wraps this in a
    broad try/except as a second line of defense)."""
    accountId = account["accountId"]
    verdict = _newVerdict(accountId)

    try:
        igUserId, accountToken = secrets.getInstagramCredentials(accountId)
    except secrets.SecretNotFoundError as e:
        verdict["status"] = "invalid"
        verdict["detail"] = f"credentials not found: {e}"
        return verdict

    try:
        data = _debugToken(accountToken, appId, appSecret)
    except (HTTPError, URLError, ValueError, KeyError) as e:
        verdict["status"] = "invalid"
        verdict["detail"] = _formatMetaFailure("debug_token failed", e)
        return verdict

    if not data.get("is_valid"):
        verdict["status"] = "invalid"
        verdict["detail"] = "debug_token reports is_valid=false"
        return verdict

    # expires_at == 0 means "never expires" (the normal, healthy state for a
    # Page token in the Facebook Login model) -- NOT "expired in 1970". Only
    # a genuinely non-zero, positive expires_at is a real expiry to watch.
    expiresAt = data.get("expires_at") or 0
    scopes = data.get("scopes") or []

    if expiresAt > 0:
        daysRemaining = (expiresAt - _nowEpochSeconds()) / SECONDS_PER_DAY
        if daysRemaining < EXPIRING_SOON_DAYS:
            verdict["warnings"].append(f"expires in {daysRemaining:.1f} day(s)")

    if REQUIRED_SCOPE not in scopes:
        verdict["warnings"].append(f"missing required scope '{REQUIRED_SCOPE}'")

    try:
        _livenessProbe(igUserId, accountToken)
    except (HTTPError, URLError, ValueError, KeyError) as e:
        verdict["status"] = "invalid"
        verdict["detail"] = _formatMetaFailure("liveness probe failed", e)
        return verdict

    if verdict["warnings"]:
        isExpiring = any(w.startswith("expires in") for w in verdict["warnings"])
        verdict["status"] = "expiring-soon" if isExpiring else "missing-scope"
        verdict["detail"] = "; ".join(verdict["warnings"])
        return verdict

    verdict["healthy"] = True
    verdict["status"] = "valid"
    verdict["detail"] = "token valid, scopes ok, liveness probe ok"
    return verdict


def _maybeExchangeUserToken(appId, appSecret):
    """If the optional shared long-lived user token is configured, exchange
    it via fb_exchange_token and persist the refreshed token back to SSM.

    Returns None when no user token is configured (nothing to do this
    month). Otherwise returns {"ok": bool, "detail": str}. Never raises.
    """
    userToken = secrets.getInstagramUserToken()
    if not userToken:
        return None

    qs = urlencode({
        "grant_type": "fb_exchange_token",
        "client_id": appId,
        "client_secret": appSecret,
        "fb_exchange_token": userToken,
    })
    try:
        data = _get(f"{GRAPH_API_BASE}/oauth/access_token?{qs}")
    except (HTTPError, URLError, ValueError, KeyError) as e:
        return {"ok": False, "detail": _formatMetaFailure("fb_exchange_token failed", e)}

    newToken = data.get("access_token")
    if not newToken:
        return {"ok": False, "detail": "fb_exchange_token response missing access_token"}

    try:
        secrets.putInstagramUserToken(newToken)
    except Exception as e:  # noqa: BLE001 -- an SSM write failure must not raise out of handler
        logger.warning("token_refresh: failed to persist refreshed user token to SSM: %s", type(e).__name__)
        return {"ok": False, "detail": f"exchange succeeded but SSM write failed: {type(e).__name__}"}

    return {"ok": True, "detail": "user token exchanged and refreshed"}


def _formatVerdictLine(v):
    return f"{v['accountId']}: {v['status']} -- {v['detail']}"


def _refreshInstagramTokens():
    try:
        appId, appSecret = secrets.getInstagramAppCredentials()
    except secrets.SecretNotFoundError as e:
        message = f"Instagram app credentials not configured: {e}"
        logger.error("token_refresh: %s", message)
        alerts.sendAlert("Social Instagram token refresh: FAILED", message)
        return {"ok": False, "error": "app credentials not configured", "accounts": [], "userTokenExchange": None}

    accounts = [a for a in secrets.listAccounts() if a["platform"] == "instagram"]

    verdicts = []
    for account in accounts:
        try:
            verdict = _checkAccount(account, appId, appSecret)
        except Exception as e:  # noqa: BLE001 -- one bad account must not stop the loop
            logger.warning(
                "token_refresh: unexpected error checking account %s: %s",
                account.get("accountId"), type(e).__name__,
            )
            verdict = _newVerdict(account.get("accountId"))
            verdict["status"] = "invalid"
            verdict["detail"] = f"unexpected error: {type(e).__name__}"
        verdicts.append(verdict)

    exchangeResult = _maybeExchangeUserToken(appId, appSecret)

    anyUnhealthy = any(not v["healthy"] for v in verdicts)
    if exchangeResult is not None and not exchangeResult["ok"]:
        anyUnhealthy = True

    lines = [_formatVerdictLine(v) for v in verdicts] if verdicts else ["No Instagram accounts configured."]
    if exchangeResult is not None:
        lines.append(f"user-token exchange: {'ok' if exchangeResult['ok'] else 'FAILED'} -- {exchangeResult['detail']}")

    summary = "\n".join(lines)

    if anyUnhealthy:
        alerts.sendAlert("Social Instagram token refresh: ISSUES FOUND", summary)
    else:
        alerts.sendHeartbeat("Social Instagram token refresh: all healthy", summary)

    return {
        "ok": not anyUnhealthy,
        "accounts": verdicts,
        "userTokenExchange": exchangeResult,
    }


def handler(event, context):
    event = event or {}
    job = event.get("job", JOB_NAME)
    if job != JOB_NAME:
        logger.error("token_refresh handler: unknown job=%s", job)
        return {"ok": False, "error": f"unknown job: {job}"}
    return _refreshInstagramTokens()
