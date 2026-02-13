"""
API Gateway HTTP API (payload 2.0) handler. Routes by path.
"""
import json
import logging
import os
import sys
from pathlib import Path

# Ensure common module is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from common.response import jsonResponse
except ImportError:
    # Fallback if import fails
    def jsonResponse(body, statusCode=200):
        return {
            "statusCode": statusCode,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
            "body": json.dumps(body) if not isinstance(body, str) else body,
        }

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ.get("TABLE_NAME", "")
MEDIA_BUCKET = os.environ.get("MEDIA_BUCKET", "")
COGNITO_USER_POOL_ID = os.environ.get("COGNITO_USER_POOL_ID", "")

ROLE_DISPLAY_MAP = {"admin": "SuperAdmin", "manager": "Manager", "user": "User"}


def _getSourceIp(event):
    """Extract client IP from API Gateway HTTP API v2 event."""
    ctx = event.get("requestContext", {})
    http = ctx.get("http", {})
    ip = http.get("sourceIp") or http.get("sourceip")
    if ip:
        return str(ip)
    identity = ctx.get("identity", {})
    return str(identity.get("sourceIp", "") or identity.get("sourceip", "")) or ""


def _recordLastLogin(event, user_id):
    """Update USER PROFILE with lastLoginAt and lastLoginIp (non-blocking)."""
    if not TABLE_NAME or not user_id:
        return
    try:
        import boto3
        from datetime import datetime
        ip = _getSourceIp(event)
        now = datetime.utcnow().isoformat() + "Z"
        dynamodb = boto3.client("dynamodb")
        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": f"USER#{user_id}"}, "SK": {"S": "PROFILE"}},
            UpdateExpression="SET lastLoginAt = :t, lastLoginIp = :ip, updatedAt = :now",
            ExpressionAttributeValues={
                ":t": {"S": now},
                ":ip": {"S": ip},
                ":now": {"S": now},
            },
        )
    except Exception:
        pass


def _getUserLastLogin(user_id):
    """Fetch lastLoginAt and lastLoginIp from USER PROFILE."""
    if not TABLE_NAME or not user_id:
        return {}
    try:
        import boto3
        dynamodb = boto3.client("dynamodb")
        resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": f"USER#{user_id}"}, "SK": {"S": "PROFILE"}},
            ProjectionExpression="lastLoginAt, lastLoginIp",
        )
        if "Item" not in resp:
            return {}
        item = resp["Item"]
        out = {}
        if "lastLoginAt" in item:
            out["lastLoginAt"] = item["lastLoginAt"].get("S", "")
        if "lastLoginIp" in item:
            out["lastLoginIp"] = item["lastLoginIp"].get("S", "")
        return out
    except Exception:
        return {}


def getUserInfo(event):
    """Extract user info from Cognito authorizer context."""
    authorizer = event.get("requestContext", {}).get("authorizer", {})
    jwt = authorizer.get("jwt", {})
    claims = jwt.get("claims", {})

    raw_groups = claims.get("cognito:groups")
    groups: list[str] = []

    if isinstance(raw_groups, list):
        groups = [str(g) for g in raw_groups]
    elif isinstance(raw_groups, str) and raw_groups:
        # Cognito sometimes returns groups as a JSON-ish string like "[admin]"
        try:
            parsed = json.loads(raw_groups)
            if isinstance(parsed, list):
                groups = [str(g) for g in parsed]
            else:
                groups = [str(parsed)]
        except Exception:
            # Fallback: split on commas and strip brackets/quotes/whitespace
            parts = raw_groups.split(",")
            for p in parts:
                g = p.strip().strip("[]\"'")
                if g:
                    groups.append(g)

    groups_display = [ROLE_DISPLAY_MAP.get(g, g) for g in groups]
    return {
        "userId": claims.get("sub", ""),
        "email": claims.get("email", ""),
        "groups": groups,
        "groupsDisplay": groups_display,
    }


def _resolveImpersonation(event, real_user):
    """If superadmin and X-Impersonate-* header set, return impersonated user dict. Else return None."""
    if "admin" not in real_user.get("groups", []):
        return None
    headers = event.get("headers") or {}
    headers_lower = {k.lower(): v for k, v in headers.items()}
    impersonate_user = (headers_lower.get("x-impersonate-user") or "").strip()
    impersonate_role = (headers_lower.get("x-impersonate-role") or "").strip()
    if not impersonate_user and not impersonate_role:
        return None
    if impersonate_user and impersonate_role:
        return None  # Only one at a time
    if impersonate_user:
        try:
            import boto3
            cognito = boto3.client("cognito-idp")
            user_resp = cognito.admin_get_user(
                UserPoolId=COGNITO_USER_POOL_ID,
                Username=impersonate_user,
            )
            attrs = {a["Name"]: a["Value"] for a in user_resp.get("UserAttributes", [])}
            sub = attrs.get("sub", "")
            email = attrs.get("email", impersonate_user)
            if not sub:
                return None
            grp_resp = cognito.admin_list_groups_for_user(
                UserPoolId=COGNITO_USER_POOL_ID,
                Username=impersonate_user,
            )
            cognito_groups = [g.get("GroupName", "") for g in grp_resp.get("Groups", []) if g.get("GroupName")]
            if "admin" in cognito_groups:
                return None  # Cannot impersonate superadmin
            custom_groups = _getUserCustomGroups(sub)
            return {
                "userId": sub,
                "email": email,
                "groups": cognito_groups,
                "groupsDisplay": [ROLE_DISPLAY_MAP.get(g, g) for g in cognito_groups],
                "customGroups": custom_groups,
                "impersonated": True,
                "impersonatedAs": f"user:{email}",
            }
        except Exception as e:
            logger.warning("impersonate user error: %s", e)
            return None
    if impersonate_role:
        if not TABLE_NAME:
            return None
        try:
            import boto3
            dynamodb = boto3.client("dynamodb")
            resp = dynamodb.get_item(
                TableName=TABLE_NAME,
                Key={"PK": {"S": f"ROLE#{impersonate_role}"}, "SK": {"S": "METADATA"}},
            )
            if "Item" not in resp:
                return None
            item = resp["Item"]
            cognito_groups = [v.get("S", "") for v in item.get("cognitoGroups", {}).get("L", [])]
            custom_groups = [v.get("S", "") for v in item.get("customGroups", {}).get("L", [])]
            return {
                "userId": f"role:{impersonate_role}",
                "email": f"(role: {impersonate_role})",
                "groups": cognito_groups,
                "groupsDisplay": [ROLE_DISPLAY_MAP.get(g, g) for g in cognito_groups],
                "customGroups": custom_groups,
                "impersonated": True,
                "impersonatedAs": f"role:{impersonate_role}",
            }
        except Exception as e:
            logger.warning("impersonate role error: %s", e)
            return None
    return None


def getEffectiveUserInfo(event):
    """Get user info, applying impersonation when superadmin and X-Impersonate-* header is set."""
    user = getUserInfo(event)
    if not user.get("userId"):
        return user
    headers = event.get("headers") or {}
    headers_lower = {k.lower(): v for k, v in headers.items()}
    has_impersonation_header = bool(
        (headers_lower.get("x-impersonate-user") or "").strip()
        or (headers_lower.get("x-impersonate-role") or "").strip()
    )
    impersonated = _resolveImpersonation(event, user)
    if impersonated:
        return impersonated
    if has_impersonation_header and "admin" in user.get("groups", []):
        user["impersonationRejected"] = True
    user_id = user.get("userId", "")
    user["customGroups"] = _getUserCustomGroups(user_id)
    return user


def handler(event, context):
    """Route request by path; return JSON with CORS headers."""
    try:
        logger.info("event=%s", event)
        
        # Extract path and method from API Gateway HTTP API v2 event
        path = event.get("rawPath", "")
        if not path:
            request_context = event.get("requestContext", {})
            http_info = request_context.get("http", {})
            path = http_info.get("path", "")
        
        method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
        
        logger.info("path=%s, method=%s", path, method)

        if method == "GET" and path == "/health":
            return jsonResponse({"ok": True})
        if method == "GET" and path == "/branding/logo":
            return getBrandingLogo(event)
        if method == "POST" and path == "/branding/logo":
            return postBrandingLogoUpload(event)
        if method == "GET" and path == "/internet-dashboard":
            return getInternetDashboard(event)
        if method == "GET" and path == "/recommended/highlights":
            return getOurProperties(event)
        if method == "GET" and path == "/recommended/highest-rated":
            return getHighestRated(event)
        if method == "GET" and path == "/sites":
            return listSites(event)
        if method == "GET" and path == "/sites/all":
            return listSites(event, forceAll=True)
        if method == "POST" and path == "/sites":
            return createSite(event)
        if method == "POST" and path == "/sites/logo-upload":
            return getPresignedLogoUpload(event)
        if method == "POST" and path == "/sites/logo-from-url":
            return importLogoFromUrl(event)
        if method == "POST" and path == "/sites/generate-description":
            from api.generate_description import generateDescription
            return generateDescription(event)
        if method == "PUT" and path == "/sites":
            return updateSite(event)
        if method == "DELETE" and path == "/sites":
            return deleteSite(event)
        if method == "GET" and path == "/me":
            return getMe(event)
        if method == "GET" and path == "/groups":
            return listGroupsForSelfJoin(event)
        if method == "POST" and path == "/me/groups":
            return joinGroupSelf(event)
        if method == "DELETE" and path.startswith("/me/groups/"):
            path_params = event.get("pathParameters") or {}
            group_name = path_params.get("groupName") or path.split("/me/groups/")[-1].strip("/")
            if group_name:
                return leaveGroupSelf(event, group_name)
        if method == "GET" and path == "/profile":
            return getProfile(event)
        if method == "PUT" and path == "/profile":
            return updateProfile(event)
        if method == "POST" and path == "/profile/avatar-upload":
            return getProfileAvatarUpload(event)
        if method == "POST" and path == "/profile/avatar-from-url":
            return importProfileAvatarFromUrl(event)
        if method == "DELETE" and path == "/profile/avatar":
            return deleteProfileAvatar(event)
        if method == "GET" and path == "/stars":
            return getStar(event)
        if method == "POST" and path == "/stars":
            return setStar(event)
        if method == "GET" and path == "/categories":
            return listCategories(event)
        if method == "POST" and path == "/categories":
            return createCategory(event)
        if method == "PUT" and path == "/categories":
            return updateCategory(event)
        if method == "DELETE" and path == "/categories":
            return deleteCategory(event)
        if method == "GET" and path == "/media":
            return listMedia(event)
        if method == "GET" and path == "/media/all":
            return listMedia(event, forceAll=True)
        if method == "POST" and path == "/media":
            return createMedia(event)
        if method == "PUT" and path == "/media":
            return updateMedia(event)
        if method == "DELETE" and path == "/media":
            return deleteMedia(event)
        if method == "POST" and path == "/media/upload":
            return getPresignedMediaUpload(event)
        if method == "POST" and path == "/media/thumbnail-upload":
            return getPresignedThumbnailUpload(event)
        if method == "POST" and path == "/media/regenerate-thumbnail":
            return postMediaRegenerateThumbnail(event)
        if method == "POST" and path == "/media/stars":
            return setMediaStar(event)
        if method == "GET" and path == "/media-categories":
            return listMediaCategories(event)
        if method == "POST" and path == "/media-categories":
            return createMediaCategory(event)
        if method == "PUT" and path == "/media-categories":
            return updateMediaCategory(event)
        if method == "DELETE" and path == "/media-categories":
            return deleteMediaCategory(event)
        # Memes section routes
        if method == "GET" and path == "/memes/cache":
            return listMemesCache(event)
        if method == "GET" and path == "/memes":
            return listMemes(event)
        if method == "GET" and path == "/memes/tags":
            return listMemeTags(event)
        if method == "POST" and path == "/memes":
            return createMeme(event)
        if method == "PUT" and path == "/memes":
            return updateMeme(event)
        if method == "DELETE" and path == "/memes":
            return deleteMeme(event)
        if method == "POST" and path == "/memes/upload":
            return getMemePresignedUpload(event)
        if method == "POST" and path == "/memes/validate-url":
            return validateMemeImageUrl(event)
        if method == "POST" and path == "/memes/import-from-url":
            return importMemeFromUrl(event)
        if method == "POST" and path == "/memes/generate-title":
            return generateMemeTitle(event)
        if method == "POST" and path == "/memes/stars":
            return setMemeStar(event)
        # Squash section routes
        if method == "GET" and path == "/squash/players":
            return listSquashPlayers(event)
        if method == "POST" and path == "/squash/players":
            return createSquashPlayer(event)
        if method == "PUT" and path == "/squash/players":
            return updateSquashPlayer(event)
        if method == "DELETE" and path == "/squash/players":
            return deleteSquashPlayer(event)
        if method == "GET" and path == "/squash/matches":
            return listSquashMatches(event)
        if method == "POST" and path == "/squash/matches":
            return createSquashMatch(event)
        if method == "PUT" and path == "/squash/matches":
            return updateSquashMatch(event)
        if method == "DELETE" and path == "/squash/matches":
            return deleteSquashMatch(event)
        # Financial section routes (Financial custom group required)
        if method == "GET" and path == "/financial/watchlist":
            return getFinancialWatchlist(event)
        if method == "PUT" and path == "/financial/watchlist":
            return putFinancialWatchlist(event)
        if method == "GET" and path == "/financial/quote":
            return getFinancialQuote(event)
        if method == "GET" and path == "/financial/config":
            return getFinancialConfig(event)
        if method == "GET" and path == "/admin/financial/default-symbols":
            return getFinancialDefaultSymbols(event)
        if method == "PUT" and path == "/admin/financial/default-symbols":
            return putFinancialDefaultSymbols(event)
        # Admin user/group management routes
        path_params = event.get("pathParameters") or {}
        if method == "GET" and path == "/admin/users":
            return listAdminUsers(event)
        if method == "GET" and path.startswith("/admin/users/") and path.endswith("/groups"):
            username = path_params.get("username") or path.split("/admin/users/")[-1].rstrip("/groups").strip("/")
            if username:
                return getUserGroups(event, username)
        if method == "POST" and path.startswith("/admin/users/") and path.endswith("/groups"):
            username = path_params.get("username") or path.split("/admin/users/")[-1].rstrip("/groups").strip("/")
            if username:
                return addUserToGroup(event, username)
        if method == "DELETE" and path.startswith("/admin/users/") and "/groups/" not in path:
            username = path_params.get("username") or path.split("/admin/users/")[-1].strip("/")
            if username:
                return deleteAdminUser(event, username)
        if method == "DELETE" and "/admin/users/" in path and "/groups/" in path:
            username = path_params.get("username")
            group_name = path_params.get("groupName")
            if not username or not group_name:
                parts = path.split("/admin/users/")[-1].split("/groups/")
                if len(parts) == 2:
                    username = parts[0].strip("/")
                    group_name = parts[1].strip("/")
            if username and group_name:
                return removeUserFromGroup(event, username, group_name)
        if method == "GET" and path == "/admin/groups":
            return listAdminGroups(event)
        if method == "POST" and path == "/admin/groups":
            return createAdminGroup(event)
        if method == "PUT" and path.startswith("/admin/groups/"):
            name = path_params.get("name") or path.split("/admin/groups/")[-1].strip("/")
            if name:
                return updateAdminGroup(event, name)
        if method == "DELETE" and path.startswith("/admin/groups/"):
            name = path_params.get("name") or path.split("/admin/groups/")[-1].strip("/")
            if name:
                return deleteAdminGroup(event, name)
        if method == "GET" and path == "/admin/roles":
            return listAdminRoles(event)
        if method == "POST" and path == "/admin/roles":
            return createAdminRole(event)
        if method == "PUT" and path.startswith("/admin/roles/"):
            name = path_params.get("name") or path.split("/admin/roles/")[-1].strip("/")
            if name:
                return updateAdminRole(event, name)
        if method == "DELETE" and path.startswith("/admin/roles/"):
            name = path_params.get("name") or path.split("/admin/roles/")[-1].strip("/")
            if name:
                return deleteAdminRole(event, name)
        if method == "GET" and path == "/admin/internet-dashboard/sites":
            return getInternetDashboardSites(event)
        if method == "PUT" and path == "/admin/internet-dashboard/sites":
            return putInternetDashboardSites(event)
        if method == "GET" and path == "/admin/recommended/highlights/sites":
            return getOurPropertiesSites(event)
        if method == "PUT" and path == "/admin/recommended/highlights/sites":
            return putOurPropertiesSites(event)
        if method == "POST" and path == "/admin/recommended/highlights/generate":
            return postOurPropertiesGenerate(event)
        if method == "GET" and path == "/admin/recommended/highest-rated/sites":
            return getHighestRatedSites(event)
        if method == "PUT" and path == "/admin/recommended/highest-rated/sites":
            return putHighestRatedSites(event)
        if method == "POST" and path == "/admin/recommended/highest-rated/generate":
            return postHighestRatedGenerate(event)
        if method == "OPTIONS":
            # CORS preflight
            return jsonResponse({}, 200)
        return jsonResponse({"error": "Not Found", "path": path, "method": method}, 404)
    except Exception as e:
        logger.exception("handler error: %s", str(e))
        import traceback
        logger.error("traceback: %s", traceback.format_exc())
        return jsonResponse({"error": str(e), "type": type(e).__name__}, 500)


def getInternetDashboard(event):
    """GET /internet-dashboard: status of popular sites (public, no auth)."""
    try:
        from api.internet_dashboard import fetchDashboard
        sites = fetchDashboard()
        return jsonResponse({"sites": sites})
    except Exception as e:
        logger.exception("getInternetDashboard error: %s", e)
        return jsonResponse({"error": str(e), "sites": []}, 500)


# ------------------------------------------------------------------------------
# Financial section (Financial custom group required)
# ------------------------------------------------------------------------------

def getFinancialWatchlist(event):
    """GET /financial/watchlist - Return current user's watchlist symbols (logged-in users only)."""
    user, err = _requireAuth(event)
    if err:
        return err
    try:
        from api.financial import get_user_watchlist
        symbols = get_user_watchlist(user["userId"])
        return jsonResponse({"symbols": symbols})
    except Exception as e:
        logger.exception("getFinancialWatchlist error: %s", e)
        return jsonResponse({"error": str(e), "symbols": []}, 500)


def putFinancialWatchlist(event):
    """PUT /financial/watchlist - Save current user's watchlist symbols (logged-in users only)."""
    user, err = _requireAuth(event)
    if err:
        return err
    try:
        body = event.get("body")
        if body and isinstance(body, str):
            body = json.loads(body)
        else:
            body = body or {}
        symbols = body.get("symbols")
        if not isinstance(symbols, list):
            return jsonResponse({"error": "symbols must be an array"}, 400)
        from api.financial import save_user_watchlist
        save_user_watchlist(user["userId"], symbols)
        return jsonResponse({"symbols": [str(s).strip().upper() for s in symbols if str(s).strip()]})
    except Exception as e:
        logger.exception("putFinancialWatchlist error: %s", e)
        return jsonResponse({"error": str(e)}, 500)


def getFinancialQuote(event):
    """GET /financial/quote?symbol=AAPL&source=yahoo - Fetch stock quote (public for guests)."""
    qs = event.get("queryStringParameters") or {}
    symbol = (qs.get("symbol") or "").strip()
    if not symbol:
        return jsonResponse({"error": "symbol is required"}, 400)
    source = (qs.get("source") or "yahoo").strip().lower()
    if source not in ("yahoo", "alpha_vantage"):
        source = "yahoo"
    try:
        from api.financial import fetch_quote
        quote = fetch_quote(symbol, source)
        if not quote:
            return jsonResponse({"error": "Quote not found for symbol"}, 404)
        return jsonResponse(quote)
    except Exception as e:
        logger.exception("getFinancialQuote error: %s", e)
        return jsonResponse({"error": str(e)}, 500)


def getFinancialConfig(event):
    """GET /financial/config - Return default symbols and available sources (public for guests)."""
    try:
        from api.financial import get_financial_config, AVAILABLE_SOURCES
        config = get_financial_config()
        config["availableSources"] = AVAILABLE_SOURCES
        return jsonResponse(config)
    except Exception as e:
        logger.exception("getFinancialConfig error: %s", e)
        return jsonResponse({"error": str(e)}, 500)


def getFinancialDefaultSymbols(event):
    """GET /admin/financial/default-symbols - Return admin default symbols and source (SuperAdmin only)."""
    _, err = _requireAdmin(event)
    if err:
        return err
    try:
        from api.financial import get_financial_config, AVAILABLE_SOURCES
        config = get_financial_config()
        return jsonResponse({
            "symbols": config["symbols"],
            "source": config["source"],
            "availableSources": AVAILABLE_SOURCES,
        })
    except Exception as e:
        logger.exception("getFinancialDefaultSymbols error: %s", e)
        return jsonResponse({"error": str(e)}, 500)


def putFinancialDefaultSymbols(event):
    """PUT /admin/financial/default-symbols - Save admin default symbols and source (SuperAdmin only)."""
    _, err = _requireAdmin(event)
    if err:
        return err
    try:
        body = event.get("body")
        if body and isinstance(body, str):
            body = json.loads(body)
        else:
            body = body or {}
        symbols = body.get("symbols")
        if not isinstance(symbols, list):
            return jsonResponse({"error": "symbols must be an array"}, 400)
        source = (body.get("source") or "yahoo").strip().lower()
        if source not in ("yahoo", "alpha_vantage"):
            source = "yahoo"
        from api.financial import save_financial_config
        save_financial_config(symbols, source)
        return jsonResponse({
            "symbols": [str(s).strip().upper() for s in symbols if str(s).strip()],
            "source": source,
        })
    except Exception as e:
        logger.exception("putFinancialDefaultSymbols error: %s", e)
        return jsonResponse({"error": str(e)}, 500)


def getInternetDashboardSites(event):
    """GET /admin/internet-dashboard/sites - Return dashboard sites list (SuperAdmin only)."""
    _, err = _requireAdmin(event)
    if err:
        return err
    try:
        from api.internet_dashboard import get_dashboard_sites
        sites = get_dashboard_sites()
        return jsonResponse({"sites": sites})
    except Exception as e:
        logger.exception("getInternetDashboardSites error: %s", e)
        return jsonResponse({"error": str(e)}, 500)


def putInternetDashboardSites(event):
    """PUT /admin/internet-dashboard/sites - Update dashboard sites list (SuperAdmin only)."""
    _, err = _requireAdmin(event)
    if err:
        return err
    try:
        body = event.get("body")
        if body and isinstance(body, str):
            body = json.loads(body)
        else:
            body = body or {}
        sites = body.get("sites")
        if not isinstance(sites, list):
            return jsonResponse({"error": "sites must be a non-empty array"}, 400)
        sites = [str(s).strip() for s in sites if str(s).strip()]
        if not sites:
            return jsonResponse({"error": "sites must have at least one domain"}, 400)
        from api.internet_dashboard import save_dashboard_sites
        if not save_dashboard_sites(sites):
            return jsonResponse({"error": "Failed to save"}, 500)
        return jsonResponse({"sites": sites})
    except json.JSONDecodeError:
        return jsonResponse({"error": "Invalid JSON body"}, 400)
    except Exception as e:
        logger.exception("putInternetDashboardSites error: %s", e)
        return jsonResponse({"error": str(e)}, 500)


def getOurProperties(event):
    """GET /recommended/highlights: status of our sites (public, no auth)."""
    try:
        from api.our_properties import fetch_our_properties
        sites = fetch_our_properties()
        return jsonResponse({"sites": sites})
    except Exception as e:
        logger.exception("getOurProperties error: %s", e)
        return jsonResponse({"error": str(e), "sites": []}, 500)


def getOurPropertiesSites(event):
    """GET /admin/recommended/highlights/sites - Return highlights cache (manager or admin)."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err
    try:
        from api.our_properties import get_our_properties_sites, get_our_properties_updated_at
        sites = get_our_properties_sites()
        updated_at = get_our_properties_updated_at()
        return jsonResponse({"sites": sites, "updatedAt": updated_at})
    except Exception as e:
        logger.exception("getOurPropertiesSites error: %s", e)
        return jsonResponse({"error": str(e)}, 500)


def postOurPropertiesGenerate(event):
    """POST /admin/recommended/highlights/generate - Generate cache from highlight category (manager or admin)."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err
    try:
        from api.our_properties import generate_highlights_cache_from_category
        sites, err_msg = generate_highlights_cache_from_category()
        if err_msg:
            return jsonResponse({"error": err_msg}, 400)
        from api.our_properties import get_our_properties_updated_at
        updated_at = get_our_properties_updated_at()
        return jsonResponse({"sites": sites, "updatedAt": updated_at})
    except Exception as e:
        logger.exception("postOurPropertiesGenerate error: %s", e)
        return jsonResponse({"error": str(e)}, 500)


def putOurPropertiesSites(event):
    """PUT /admin/recommended/highlights/sites - Update our properties sites list (manager or admin)."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err
    try:
        body = event.get("body")
        if body and isinstance(body, str):
            body = json.loads(body)
        else:
            body = body or {}
        sites = body.get("sites")
        if not isinstance(sites, list):
            return jsonResponse({"error": "sites must be an array"}, 400)
        from api.our_properties import save_our_properties_sites, normalize_sites, get_our_properties_updated_at
        sites = normalize_sites(sites)
        if not save_our_properties_sites(sites):
            return jsonResponse({"error": "Failed to save"}, 500)
        updated_at = get_our_properties_updated_at()
        return jsonResponse({"sites": sites, "updatedAt": updated_at})
    except json.JSONDecodeError:
        return jsonResponse({"error": "Invalid JSON body"}, 400)
    except Exception as e:
        logger.exception("putOurPropertiesSites error: %s", e)
        return jsonResponse({"error": str(e)}, 500)


def getHighestRated(event):
    """GET /recommended/highest-rated: top 14 sites by stars (public, no auth)."""
    try:
        from api.our_properties import fetch_highest_rated
        sites = fetch_highest_rated()
        return jsonResponse({"sites": sites})
    except Exception as e:
        logger.exception("getHighestRated error: %s", e)
        return jsonResponse({"error": str(e), "sites": []}, 500)


def getHighestRatedSites(event):
    """GET /admin/recommended/highest-rated/sites - Return highest rated cache (manager or admin)."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err
    try:
        from api.our_properties import get_highest_rated_sites, get_highest_rated_updated_at
        sites = get_highest_rated_sites()
        updated_at = get_highest_rated_updated_at()
        return jsonResponse({"sites": sites, "updatedAt": updated_at})
    except Exception as e:
        logger.exception("getHighestRatedSites error: %s", e)
        return jsonResponse({"error": str(e)}, 500)


def postHighestRatedGenerate(event):
    """POST /admin/recommended/highest-rated/generate - Generate cache from top 14 by stars (manager or admin)."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err
    try:
        from api.our_properties import generate_highest_rated_cache_from_stars
        sites, err_msg = generate_highest_rated_cache_from_stars()
        if err_msg:
            return jsonResponse({"error": err_msg}, 400)
        from api.our_properties import get_highest_rated_updated_at
        updated_at = get_highest_rated_updated_at()
        return jsonResponse({"sites": sites, "updatedAt": updated_at})
    except Exception as e:
        logger.exception("postHighestRatedGenerate error: %s", e)
        return jsonResponse({"error": str(e)}, 500)


def putHighestRatedSites(event):
    """PUT /admin/recommended/highest-rated/sites - Update highest rated sites list (manager or admin)."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err
    try:
        body = event.get("body")
        if body and isinstance(body, str):
            body = json.loads(body)
        else:
            body = body or {}
        sites = body.get("sites")
        if not isinstance(sites, list):
            return jsonResponse({"error": "sites must be an array"}, 400)
        from api.our_properties import save_highest_rated_sites, normalize_highest_rated_sites, get_highest_rated_updated_at
        sites = normalize_highest_rated_sites(sites)
        if not save_highest_rated_sites(sites):
            return jsonResponse({"error": "Failed to save"}, 500)
        updated_at = get_highest_rated_updated_at()
        return jsonResponse({"sites": sites, "updatedAt": updated_at})
    except json.JSONDecodeError:
        return jsonResponse({"error": "Invalid JSON body"}, 400)
    except Exception as e:
        logger.exception("putHighestRatedSites error: %s", e)
        return jsonResponse({"error": str(e)}, 500)


def _resolveCategoriesForSites(dynamodb, sites):
    """Add categories list (id, name) to each site from categoryIds. Batch-get category items."""
    all_ids = set()
    for s in sites:
        for cid in s.get("categoryIds") or []:
            all_ids.add(cid)
    if not all_ids:
        for s in sites:
            s.setdefault("categories", [])
        return
    keys = [{"PK": {"S": cid}, "SK": {"S": "METADATA"}} for cid in all_ids]
    id_to_name = {}
    for i in range(0, len(keys), 100):
        batch = keys[i : i + 100]
        resp = dynamodb.batch_get_item(
            RequestItems={TABLE_NAME: {"Keys": batch}},
        )
        for item in resp.get("Responses", {}).get(TABLE_NAME, []):
            pk = item.get("PK", {}).get("S", "")
            name = item.get("name", {}).get("S", pk)
            id_to_name[pk] = name
    for s in sites:
        s["categories"] = [
            {"id": cid, "name": id_to_name.get(cid, cid)}
            for cid in (s.get("categoryIds") or [])
        ]


def _addLogoUrls(sites, region=None):
    """Set logoUrl: use stored logoUrl if present; else presigned GET for logoKey. In-place."""
    if not sites:
        return
    for s in sites:
        if s.get("logoUrl") and isinstance(s["logoUrl"], str) and s["logoUrl"].strip():
            continue
        key = s.get("logoKey")
        if key and isinstance(key, str) and key.strip() and MEDIA_BUCKET:
            try:
                import boto3
                region = region or os.environ.get("AWS_REGION", "us-east-1")
                s3 = boto3.client("s3", region_name=region)
                url = s3.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": MEDIA_BUCKET, "Key": key},
                    ExpiresIn=3600,
                )
                s["logoUrl"] = url
            except Exception as e:
                logger.warning("_addLogoUrls failed for key %s: %s", key, e)


def listSites(event, forceAll=False):
    """Query DynamoDB byEntity (entityType=SITE). Optional ?id= single site. Query constraints: limit (default 100), categoryIds (comma-separated). forceAll=True (GET /sites/all, JWT) = admin only, no limit."""
    logger.info("listSites called, TABLE_NAME=%s", TABLE_NAME)
    if not TABLE_NAME:
        logger.warning("TABLE_NAME not set")
        return jsonResponse({"sites": [], "error": "TABLE_NAME not set"}, 200)

    try:
        import boto3
        region = os.environ.get("AWS_REGION", "us-east-1")
        dynamodb = boto3.client("dynamodb", region_name=region)

        qs = event.get("queryStringParameters") or {}
        single_id = (qs.get("id") or "").strip()
        if single_id:
            resp = dynamodb.get_item(
                TableName=TABLE_NAME,
                Key={"PK": {"S": single_id}, "SK": {"S": "METADATA"}},
            )
            if "Item" not in resp:
                return jsonResponse({"error": "Site not found"}, 404)
            item = resp["Item"]
            site = {}
            for key, val in item.items():
                if "S" in val:
                    site[key] = val["S"]
                elif "N" in val:
                    num_str = val["N"]
                    site[key] = int(num_str) if "." not in num_str else float(num_str)
                elif "L" in val:
                    site[key] = [v.get("S", "") for v in val["L"]]
                elif "BOOL" in val:
                    site[key] = val["BOOL"]
            total_sum = site.get("totalStarsSum")
            total_count = site.get("totalStarsCount")
            if isinstance(total_sum, (int, float)) and isinstance(total_count, (int, float)) and total_count > 0:
                avg = max(1.0, min(5.0, float(total_sum) / float(total_count)))
                site["averageRating"] = round(avg, 1)
            _resolveCategoriesForSites(dynamodb, [site])
            _addLogoUrls([site], region=region)
            return jsonResponse({"site": site})

        # Limit: forceAll (GET /sites/all with JWT) = admin only, no limit; else limit 100
        if forceAll:
            user = getEffectiveUserInfo(event)
            if not user.get("userId"):
                return jsonResponse({"error": "Unauthorized"}, 401)
            if "admin" not in user.get("groups", []):
                return jsonResponse({"error": "Forbidden: admin required for full list"}, 403)
            use_no_limit = True
        else:
            use_no_limit = False
        try:
            limit_param = int((qs.get("limit") or "").strip() or 100)
        except ValueError:
            limit_param = 100
        limit_param = max(1, min(limit_param, 10000))
        category_ids_param = (qs.get("categoryIds") or "").strip()
        filter_category_ids = [x.strip() for x in category_ids_param.split(",") if x.strip()]
        category_mode = (qs.get("categoryMode") or "").strip().lower() or "and"

        page_limit = None if use_no_limit else limit_param
        items = []
        request_kw = {
            "TableName": TABLE_NAME,
            "IndexName": "byEntity",
            "KeyConditionExpression": "entityType = :et",
            "ExpressionAttributeValues": {":et": {"S": "SITE"}},
        }
        if page_limit is not None:
            request_kw["Limit"] = page_limit
        result = dynamodb.query(**request_kw)
        items.extend(result.get("Items", []))
        while use_no_limit and result.get("LastEvaluatedKey"):
            request_kw["ExclusiveStartKey"] = result["LastEvaluatedKey"]
            result = dynamodb.query(**request_kw)
            items.extend(result.get("Items", []))

        sites = []
        for item in items:
            site = {}
            for key, val in item.items():
                if "S" in val:
                    site[key] = val["S"]
                elif "N" in val:
                    num_str = val["N"]
                    site[key] = int(num_str) if "." not in num_str else float(num_str)
                elif "L" in val:
                    site[key] = [v.get("S", "") for v in val["L"]]
                elif "BOOL" in val:
                    site[key] = val["BOOL"]

            total_sum = site.get("totalStarsSum")
            total_count = site.get("totalStarsCount")
            if isinstance(total_sum, (int, float)) and isinstance(total_count, (int, float)) and total_count > 0:
                avg = float(total_sum) / float(total_count)
                if avg < 1.0:
                    avg = 1.0
                if avg > 5.0:
                    avg = 5.0
                site["averageRating"] = round(avg, 1)

            sites.append(site)

        _resolveCategoriesForSites(dynamodb, sites)
        if filter_category_ids:
            if category_mode == "or":
                sites = [s for s in sites if any(cid in (s.get("categoryIds") or []) for cid in filter_category_ids)]
            else:
                sites = [s for s in sites if all(cid in (s.get("categoryIds") or []) for cid in filter_category_ids)]
        search_q = (qs.get("q") or qs.get("search") or "").strip()
        if search_q:
            q_lower = search_q.lower()
            sites = [
                s for s in sites
                if q_lower in (s.get("title") or "").lower()
                or q_lower in (s.get("url") or "").lower()
                or q_lower in (s.get("description") or "").lower()
            ]
        _addLogoUrls(sites, region=region)
        sites.sort(key=lambda s: (
            -(s.get("averageRating") or 0),
            (s.get("title") or s.get("url") or s.get("PK") or "").lower(),
        ))
        logger.info("Found %d items", len(sites))
        return jsonResponse({"sites": sites})
    except Exception as e:
        logger.error("listSites exception: %s", str(e), exc_info=True)
        import traceback
        error_detail = traceback.format_exc()
        logger.error("Full traceback:\n%s", error_detail)
        return jsonResponse({
            "error": str(e),
            "errorType": type(e).__name__,
            "sites": []
        }, 500)


def createSite(event):
    """Create a new site (manager or admin)."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err

    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)

    try:
        import boto3
        import json
        import uuid
        from datetime import datetime

        body = json.loads(event.get("body", "{}"))
        url = body.get("url", "").strip()
        title = body.get("title", "").strip()

        if not url:
            return jsonResponse({"error": "url is required"}, 400)

        site_id = f"SITE#{uuid.uuid4()}"
        now = datetime.utcnow().isoformat() + "Z"
        logo_key = (body.get("logoKey") or "").strip() or None
        logo_url = (body.get("logoUrl") or "").strip() or None

        dynamodb = boto3.client("dynamodb")

        tags_list = [{"S": str(tag)} for tag in (body.get("tags", []) or [])]
        category_ids = [str(c) for c in (body.get("categoryIds") or []) if c]
        category_ids_list = [{"S": cid} for cid in category_ids]

        scraped_content = body.get("scrapedContent")
        if scraped_content is not None:
            scraped_content = scraped_content if isinstance(scraped_content, str) else str(scraped_content)
            if len(scraped_content) > 102400:  # ~100KB
                return jsonResponse({"error": "scrapedContent exceeds 100KB limit"}, 400)

        item = {
            "PK": {"S": site_id},
            "SK": {"S": "METADATA"},
            "url": {"S": url},
            "title": {"S": title or url},
            "description": {"S": body.get("description", "")},
            "tags": {"L": tags_list},
            "categoryIds": {"L": category_ids_list},
            "createdAt": {"S": now},
            "updatedAt": {"S": now},
            "entityType": {"S": "SITE"},
            "entitySk": {"S": site_id},
            "totalStarsSum": {"N": "0"},
            "totalStarsCount": {"N": "0"},
        }
        if body.get("descriptionAiGenerated") is True:
            item["descriptionAiGenerated"] = {"BOOL": True}
        if scraped_content is not None and scraped_content:
            item["scrapedContent"] = {"S": scraped_content}
        if logo_key:
            item["logoKey"] = {"S": logo_key}
        elif logo_url:
            item["logoUrl"] = {"S": logo_url}
        dynamodb.put_item(TableName=TABLE_NAME, Item=item)

        return jsonResponse({"id": site_id, "url": url, "title": title or url}, 201)
    except Exception as e:
        logger.exception("createSite error")
        return jsonResponse({"error": str(e)}, 500)


def updateSite(event):
    """Update an existing site (manager or admin)."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err

    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)

    try:
        import boto3
        import json
        from datetime import datetime

        body = json.loads(event.get("body", "{}"))
        site_id = body.get("id", "").strip()
        if not site_id:
            return jsonResponse({"error": "id is required"}, 400)

        url = body.get("url")
        title = body.get("title")
        description = body.get("description")
        description_ai_generated = body.get("descriptionAiGenerated")
        category_ids = body.get("categoryIds")
        delete_logo = body.get("deleteLogo") is True
        logo_key = (body.get("logoKey") or "").strip() or None
        logo_url = (body.get("logoUrl") or "").strip() or None
        now = datetime.utcnow().isoformat() + "Z"

        dynamodb = boto3.client("dynamodb")
        region = os.environ.get("AWS_REGION", "us-east-1")
        current_logo_key = None
        if delete_logo or logo_key or logo_url:
            get_resp = dynamodb.get_item(
                TableName=TABLE_NAME,
                Key={"PK": {"S": site_id}, "SK": {"S": "METADATA"}},
                ProjectionExpression="logoKey",
            )
            if "Item" in get_resp and "logoKey" in get_resp["Item"]:
                current_logo_key = get_resp["Item"]["logoKey"].get("S", "").strip() or None

        if MEDIA_BUCKET and current_logo_key and (delete_logo or logo_key or logo_url):
            try:
                s3 = boto3.client("s3", region_name=region)
                s3.delete_object(Bucket=MEDIA_BUCKET, Key=current_logo_key)
            except Exception as e:
                logger.warning("S3 delete_object for logo failed: %s", e)

        set_parts = []
        remove_parts = []
        names = {}
        values = {":updatedAt": {"S": now}}

        if url is not None:
            url_val = (url if isinstance(url, str) else "").strip()
            if url_val:
                set_parts.append("#url = :url")
                names["#url"] = "url"
                values[":url"] = {"S": url_val}
        if title is not None:
            set_parts.append("#title = :title")
            names["#title"] = "title"
            values[":title"] = {"S": title}
        if description is not None:
            set_parts.append("#description = :description")
            names["#description"] = "description"
            values[":description"] = {"S": description}
        if description_ai_generated is True:
            set_parts.append("descriptionAiGenerated = :descAi")
            values[":descAi"] = {"BOOL": True}
        elif description_ai_generated is False:
            remove_parts.append("descriptionAiGenerated")
        if category_ids is not None:
            set_parts.append("categoryIds = :categoryIds")
            values[":categoryIds"] = {"L": [{"S": str(c)} for c in category_ids]}
        scraped_content = body.get("scrapedContent")
        if scraped_content is not None:
            scraped_content = scraped_content if isinstance(scraped_content, str) else str(scraped_content)
            if len(scraped_content) > 102400:
                return jsonResponse({"error": "scrapedContent exceeds 100KB limit"}, 400)
            if scraped_content:
                set_parts.append("scrapedContent = :scrapedContent")
                values[":scrapedContent"] = {"S": scraped_content}
            else:
                remove_parts.append("scrapedContent")
        tags = body.get("tags")
        if tags is not None:
            if tags:
                set_parts.append("tags = :tags")
                values[":tags"] = {"L": [{"S": str(t)} for t in tags]}
            else:
                remove_parts.append("tags")
        set_parts.append("updatedAt = :updatedAt")

        if delete_logo:
            remove_parts.append("logoKey")
            remove_parts.append("logoUrl")
        elif logo_key:
            set_parts.append("logoKey = :logoKey")
            values[":logoKey"] = {"S": logo_key}
            remove_parts.append("logoUrl")
        elif logo_url:
            set_parts.append("logoUrl = :logoUrl")
            values[":logoUrl"] = {"S": logo_url}
            remove_parts.append("logoKey")

        if not set_parts and not remove_parts:
            return jsonResponse({"error": "Nothing to update"}, 400)

        update_expr = ""
        if set_parts:
            update_expr += "SET " + ", ".join(set_parts)
        if remove_parts:
            update_expr += " REMOVE " + ", ".join(remove_parts)

        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": site_id}, "SK": {"S": "METADATA"}},
            UpdateExpression=update_expr.strip(),
            ExpressionAttributeNames=names if names else None,
            ExpressionAttributeValues=values,
        )

        return jsonResponse({"id": site_id, "url": url, "title": title, "description": description, "categoryIds": category_ids}, 200)
    except Exception as e:
        logger.exception("updateSite error")
        return jsonResponse({"error": str(e)}, 500)


def deleteSite(event):
    """Delete a site (manager or admin)."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        body = event.get("body")
        if body and isinstance(body, str):
            try:
                body = json.loads(body)
            except Exception:
                body = {}
        else:
            body = {}
        qs = event.get("queryStringParameters") or {}
        site_id = (body.get("id") or qs.get("id") or "").strip()
        if not site_id:
            return jsonResponse({"error": "id is required"}, 400)
        dynamodb = boto3.client("dynamodb")
        region = os.environ.get("AWS_REGION", "us-east-1")
        # Get logo key to delete from S3
        get_resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": site_id}, "SK": {"S": "METADATA"}},
            ProjectionExpression="logoKey",
        )
        if "Item" in get_resp and MEDIA_BUCKET:
            logo_key = get_resp["Item"].get("logoKey", {}).get("S", "").strip()
            if logo_key:
                try:
                    s3 = boto3.client("s3", region_name=region)
                    s3.delete_object(Bucket=MEDIA_BUCKET, Key=logo_key)
                except Exception as e:
                    logger.warning("S3 delete logo failed for %s: %s", logo_key, e)
        # Delete all items with this PK (METADATA + TAG#...)
        result = dynamodb.query(
            TableName=TABLE_NAME,
            KeyConditionExpression="PK = :pk",
            ExpressionAttributeValues={":pk": {"S": site_id}},
            ProjectionExpression="PK, SK",
        )
        for item in result.get("Items", []):
            pk = item.get("PK", {}).get("S", "")
            sk = item.get("SK", {}).get("S", "")
            if pk and sk:
                dynamodb.delete_item(
                    TableName=TABLE_NAME,
                    Key={"PK": {"S": pk}, "SK": {"S": sk}},
                )
        return jsonResponse({"id": site_id, "deleted": True}, 200)
    except Exception as e:
        logger.exception("deleteSite error")
        return jsonResponse({"error": str(e)}, 500)


def getPresignedLogoUpload(event):
    """Return presigned PUT URL for uploading a site logo (manager or admin)."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err
    if not MEDIA_BUCKET:
        return jsonResponse({"error": "MEDIA_BUCKET not configured"}, 500)
    try:
        import boto3
        import uuid as uuid_mod
        body = json.loads(event.get("body", "{}"))
        site_id = (body.get("siteId") or body.get("id") or "").strip() or "new"
        contentType = (body.get("contentType") or "image/png").strip()
        ext = "png"
        if "jpeg" in contentType or "jpg" in contentType:
            ext = "jpg"
        elif "gif" in contentType:
            ext = "gif"
        elif "webp" in contentType:
            ext = "webp"
        unique = str(uuid_mod.uuid4())
        key = f"logos/{site_id}/{unique}.{ext}"
        region = os.environ.get("AWS_REGION", "us-east-1")
        s3 = boto3.client("s3", region_name=region)
        upload_url = s3.generate_presigned_url(
            "put_object",
            Params={"Bucket": MEDIA_BUCKET, "Key": key, "ContentType": contentType},
            ExpiresIn=300,
        )
        return jsonResponse({"uploadUrl": upload_url, "key": key})
    except Exception as e:
        logger.exception("getPresignedLogoUpload error")
        return jsonResponse({"error": str(e)}, 500)


def importLogoFromUrl(event):
    """Download image from URL, validate dimensions (min 100x100), upload to S3 (manager or admin)."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err
    if not MEDIA_BUCKET:
        return jsonResponse({"error": "MEDIA_BUCKET not configured"}, 500)
    try:
        import io
        import uuid as uuid_mod
        import urllib.request
        import urllib.error
        body = json.loads(event.get("body", "{}"))
        site_id = (body.get("siteId") or body.get("id") or "").strip()
        image_url = (body.get("imageUrl") or "").strip()
        if not site_id:
            return jsonResponse({"error": "siteId is required"}, 400)
        if not image_url:
            return jsonResponse({"error": "imageUrl is required"}, 400)
        MAX_LOGO_BYTES = 5 * 1024 * 1024
        MIN_LOGO_SIZE = 100
        FETCH_TIMEOUT_SEC = 10
        req = urllib.request.Request(image_url, headers={"User-Agent": "FunkedupshiftLogoImport/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_SEC) as resp:
                content_length = resp.headers.get("Content-Length")
                if content_length and int(content_length) > MAX_LOGO_BYTES:
                    return jsonResponse({"error": "Image too large (max 5 MB)"}, 400)
                data = resp.read(MAX_LOGO_BYTES + 1)
                if len(data) > MAX_LOGO_BYTES:
                    return jsonResponse({"error": "Image too large (max 5 MB)"}, 400)
                content_type = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        except urllib.error.HTTPError as e:
            logger.warning("logo-from-url HTTP error: %s", e)
            return jsonResponse({"error": "Could not download image"}, 400)
        except urllib.error.URLError as e:
            logger.warning("logo-from-url URL error: %s", e)
            return jsonResponse({"error": "Could not download image"}, 400)
        allowed_types = ("image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp")
        if content_type not in allowed_types:
            return jsonResponse({"error": "Unsupported image type (use PNG, JPEG, GIF, or WebP)"}, 400)
        try:
            from PIL import Image
            img = Image.open(io.BytesIO(data))
            img.load()
            w, h = img.size
            if w < MIN_LOGO_SIZE or h < MIN_LOGO_SIZE:
                return jsonResponse({"error": "Logo must be at least 100×100 pixels."}, 400)
        except Exception as e:
            logger.warning("logo-from-url PIL/open error: %s", e)
            return jsonResponse({"error": "Invalid or unsupported image"}, 400)
        ext = "png"
        if "jpeg" in content_type or "jpg" in content_type:
            ext = "jpg"
        elif "gif" in content_type:
            ext = "gif"
        elif "webp" in content_type:
            ext = "webp"
        unique = str(uuid_mod.uuid4())
        key = f"logos/{site_id}/{unique}.{ext}"
        region = os.environ.get("AWS_REGION", "us-east-1")
        import boto3
        s3 = boto3.client("s3", region_name=region)
        s3.put_object(Bucket=MEDIA_BUCKET, Key=key, Body=data, ContentType=content_type)
        return jsonResponse({"key": key})
    except json.JSONDecodeError as e:
        return jsonResponse({"error": "Invalid JSON body"}, 400)
    except Exception as e:
        logger.exception("importLogoFromUrl error")
        return jsonResponse({"error": str(e)}, 500)


def getMe(event):
    """Return current user info (requires auth). Supports impersonation via X-Impersonate-User or X-Impersonate-Role."""
    user = getEffectiveUserInfo(event)
    if not user.get("userId"):
        return jsonResponse({"error": "Unauthorized"}, 401)
    real_user_id = getEffectiveUserInfo(event).get("userId", "")
    if real_user_id and not user.get("impersonated"):
        _recordLastLogin(event, real_user_id)
    return jsonResponse(user)


def getProfile(event):
    """GET /profile - Return current user's full profile (auth required)."""
    user = getEffectiveUserInfo(event)
    if not user.get("userId"):
        return jsonResponse({"error": "Unauthorized"}, 401)
    user_id = user.get("userId", "")
    _recordLastLogin(event, user_id)
    status = ""
    try:
        if COGNITO_USER_POOL_ID and user.get("email"):
            import boto3
            cognito = boto3.client("cognito-idp")
            resp = cognito.admin_get_user(
                UserPoolId=COGNITO_USER_POOL_ID,
                Username=user.get("email", ""),
            )
            status = resp.get("UserStatus", "")
    except Exception:
        pass
    profile = {}
    try:
        if TABLE_NAME and user_id:
            import boto3
            dynamodb = boto3.client("dynamodb")
            resp = dynamodb.get_item(
                TableName=TABLE_NAME,
                Key={"PK": {"S": f"USER#{user_id}"}, "SK": {"S": "PROFILE"}},
            )
            if "Item" in resp:
                item = resp["Item"]
                profile["description"] = item.get("description", {}).get("S", "")
                profile["lastLoginAt"] = item.get("lastLoginAt", {}).get("S", "")
                profile["lastLoginIp"] = item.get("lastLoginIp", {}).get("S", "")
                avatar_key = item.get("avatarKey", {}).get("S", "")
                if avatar_key and MEDIA_BUCKET:
                    region = os.environ.get("AWS_REGION", "us-east-1")
                    s3 = boto3.client("s3", region_name=region)
                    profile["avatarUrl"] = s3.generate_presigned_url(
                        "get_object",
                        Params={"Bucket": MEDIA_BUCKET, "Key": avatar_key},
                        ExpiresIn=3600,
                    )
                profile["avatarKey"] = avatar_key
    except Exception as e:
        logger.exception("getProfile error")
        return jsonResponse({"error": str(e)}, 500)
    custom_groups = _getUserCustomGroups(user_id)
    out = {
        "userId": user.get("userId"),
        "email": user.get("email"),
        "status": status,
        "groups": user.get("groups", []),
        "groupsDisplay": user.get("groupsDisplay", []),
        "cognitoGroups": user.get("groups", []),
        "customGroups": custom_groups,
        "profile": profile,
    }
    return jsonResponse(out)


def updateProfile(event):
    """PUT /profile - Update current user's profile (description, avatarKey)."""
    user = getEffectiveUserInfo(event)
    if not user.get("userId"):
        return jsonResponse({"error": "Unauthorized"}, 401)
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        from datetime import datetime
        body = json.loads(event.get("body", "{}"))
        description = body.get("description")
        avatar_key = body.get("avatarKey")
        user_id = user.get("userId", "")
        pk = f"USER#{user_id}"
        now = datetime.utcnow().isoformat() + "Z"

        if description is not None:
            desc_str = str(description).strip()[:100]
            if len(str(description).strip()) > 100:
                return jsonResponse({"error": "description must be at most 100 characters"}, 400)
        else:
            desc_str = None

        dynamodb = boto3.client("dynamodb")
        updates = ["updatedAt = :now"]
        values = {":now": {"S": now}}
        names = {}
        if desc_str is not None:
            updates.append("#desc = :desc")
            names["#desc"] = "description"
            values[":desc"] = {"S": desc_str}
        if avatar_key is not None:
            key_str = str(avatar_key).strip() if avatar_key else ""
            updates.append("avatarKey = :ak")
            values[":ak"] = {"S": key_str}

        params = {
            "TableName": TABLE_NAME,
            "Key": {"PK": {"S": pk}, "SK": {"S": "PROFILE"}},
            "UpdateExpression": "SET " + ", ".join(updates),
            "ExpressionAttributeValues": values,
        }
        if names:
            params["ExpressionAttributeNames"] = names
        dynamodb.update_item(**params)
        return jsonResponse({"updated": True})
    except Exception as e:
        logger.exception("updateProfile error")
        return jsonResponse({"error": str(e)}, 500)


def listGroupsForSelfJoin(event):
    """GET /groups - List custom groups for self-join (any logged-in user)."""
    user, err = _requireAuth(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"groups": [], "error": "TABLE_NAME not set"}, 200)
    try:
        import boto3
        dynamodb = boto3.client("dynamodb")
        result = dynamodb.query(
            TableName=TABLE_NAME,
            IndexName="byEntity",
            KeyConditionExpression="entityType = :et",
            ExpressionAttributeValues={":et": {"S": "GROUP"}},
        )
        groups = []
        for item in result.get("Items", []):
            g = _dynamoItemToDict(item)
            g["name"] = g.get("name") or g.get("PK", "").replace("GROUP#", "")
            groups.append(g)
        groups.sort(key=lambda x: (x.get("name") or "").lower())
        return jsonResponse({"groups": groups})
    except Exception as e:
        logger.exception("listGroupsForSelfJoin error")
        return jsonResponse({"error": str(e)}, 500)


def joinGroupSelf(event):
    """POST /me/groups - Add current user to custom group (self-service)."""
    user, err = _requireAuth(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        import re
        from datetime import datetime
        body = json.loads(event.get("body", "{}"))
        group_name = (body.get("groupName") or "").strip()
        if not group_name:
            return jsonResponse({"error": "groupName is required"}, 400)
        if not re.match(r"^[a-zA-Z0-9_-]+$", group_name):
            return jsonResponse({"error": "groupName must be alphanumeric, underscore, or hyphen"}, 400)
        user_id = user.get("userId", "")
        dynamodb = boto3.client("dynamodb")
        group_check = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": f"GROUP#{group_name}"}, "SK": {"S": "METADATA"}},
        )
        if "Item" not in group_check:
            return jsonResponse({"error": f"Custom group '{group_name}' not found"}, 404)
        now = datetime.utcnow().isoformat() + "Z"
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": f"USER#{user_id}"},
                "SK": {"S": f"MEMBERSHIP#{group_name}"},
                "groupName": {"S": group_name},
                "userId": {"S": user_id},
                "addedAt": {"S": now},
                "addedBy": {"S": user_id},
            },
        )
        return jsonResponse({"groupName": group_name, "added": True}, 200)
    except Exception as e:
        logger.exception("joinGroupSelf error")
        return jsonResponse({"error": str(e)}, 500)


def leaveGroupSelf(event, group_name):
    """DELETE /me/groups/{groupName} - Remove current user from custom group (self-service)."""
    user, err = _requireAuth(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        user_id = user.get("userId", "")
        dynamodb = boto3.client("dynamodb")
        dynamodb.delete_item(
            TableName=TABLE_NAME,
            Key={
                "PK": {"S": f"USER#{user_id}"},
                "SK": {"S": f"MEMBERSHIP#{group_name}"},
            },
        )
        return jsonResponse({"groupName": group_name, "removed": True}, 200)
    except Exception as e:
        logger.exception("leaveGroupSelf error")
        return jsonResponse({"error": str(e)}, 500)


def getProfileAvatarUpload(event):
    """POST /profile/avatar-upload - Presigned PUT URL for profile avatar (any logged-in user)."""
    user = getEffectiveUserInfo(event)
    if not user.get("userId"):
        return jsonResponse({"error": "Unauthorized"}, 401)
    if not MEDIA_BUCKET:
        return jsonResponse({"error": "MEDIA_BUCKET not configured"}, 500)
    try:
        import boto3
        import uuid as uuid_mod
        body = json.loads(event.get("body", "{}"))
        contentType = (body.get("contentType") or "image/png").strip()
        if contentType not in ("image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"):
            return jsonResponse({"error": "contentType must be image/png, image/jpeg, image/gif, or image/webp"}, 400)
        ext = "png"
        if "jpeg" in contentType or "jpg" in contentType:
            ext = "jpg"
        elif "gif" in contentType:
            ext = "gif"
        elif "webp" in contentType:
            ext = "webp"
        user_id_safe = user.get("userId", "").replace(":", "_").replace("/", "_")
        unique = str(uuid_mod.uuid4())
        key = f"profile/avatars/{user_id_safe}/{unique}.{ext}"
        region = os.environ.get("AWS_REGION", "us-east-1")
        s3 = boto3.client("s3", region_name=region)
        upload_url = s3.generate_presigned_url(
            "put_object",
            Params={"Bucket": MEDIA_BUCKET, "Key": key, "ContentType": contentType},
            ExpiresIn=300,
        )
        return jsonResponse({"uploadUrl": upload_url, "key": key})
    except Exception as e:
        logger.exception("getProfileAvatarUpload error")
        return jsonResponse({"error": str(e)}, 500)


def importProfileAvatarFromUrl(event):
    """Download image from URL, validate dimensions (min 48x48), upload to S3 (any logged-in user)."""
    user = getEffectiveUserInfo(event)
    if not user.get("userId"):
        return jsonResponse({"error": "Unauthorized"}, 401)
    if not MEDIA_BUCKET:
        return jsonResponse({"error": "MEDIA_BUCKET not configured"}, 500)
    try:
        import io
        import uuid as uuid_mod
        import urllib.request
        import urllib.error
        body = json.loads(event.get("body", "{}"))
        image_url = (body.get("imageUrl") or "").strip()
        if not image_url:
            return jsonResponse({"error": "imageUrl is required"}, 400)
        MAX_AVATAR_BYTES = 5 * 1024 * 1024
        MIN_AVATAR_SIZE = 48
        FETCH_TIMEOUT_SEC = 10
        req = urllib.request.Request(image_url, headers={"User-Agent": "FunkedupshiftAvatarImport/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_SEC) as resp:
                content_length = resp.headers.get("Content-Length")
                if content_length and int(content_length) > MAX_AVATAR_BYTES:
                    return jsonResponse({"error": "Image too large (max 5 MB)"}, 400)
                data = resp.read(MAX_AVATAR_BYTES + 1)
                if len(data) > MAX_AVATAR_BYTES:
                    return jsonResponse({"error": "Image too large (max 5 MB)"}, 400)
                content_type = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        except urllib.error.HTTPError as e:
            logger.warning("avatar-from-url HTTP error: %s", e)
            return jsonResponse({"error": "Could not download image"}, 400)
        except urllib.error.URLError as e:
            logger.warning("avatar-from-url URL error: %s", e)
            return jsonResponse({"error": "Could not download image"}, 400)
        allowed_types = ("image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp")
        if content_type not in allowed_types:
            return jsonResponse({"error": "Unsupported image type (use PNG, JPEG, GIF, or WebP)"}, 400)
        try:
            from PIL import Image
            img = Image.open(io.BytesIO(data))
            img.load()
            w, h = img.size
            if w < MIN_AVATAR_SIZE or h < MIN_AVATAR_SIZE:
                return jsonResponse({"error": "Image must be at least 48×48 pixels."}, 400)
        except Exception as e:
            logger.warning("avatar-from-url PIL/open error: %s", e)
            return jsonResponse({"error": "Invalid or unsupported image"}, 400)
        ext = "png"
        if "jpeg" in content_type or "jpg" in content_type:
            ext = "jpg"
        elif "gif" in content_type:
            ext = "gif"
        elif "webp" in content_type:
            ext = "webp"
        user_id_safe = user.get("userId", "").replace(":", "_").replace("/", "_")
        unique = str(uuid_mod.uuid4())
        key = f"profile/avatars/{user_id_safe}/{unique}.{ext}"
        region = os.environ.get("AWS_REGION", "us-east-1")
        import boto3
        s3 = boto3.client("s3", region_name=region)
        s3.put_object(Bucket=MEDIA_BUCKET, Key=key, Body=data, ContentType=content_type)
        return jsonResponse({"key": key})
    except json.JSONDecodeError as e:
        return jsonResponse({"error": "Invalid JSON body"}, 400)
    except Exception as e:
        logger.exception("importProfileAvatarFromUrl error")
        return jsonResponse({"error": str(e)}, 500)


def deleteProfileAvatar(event):
    """DELETE /profile/avatar - Remove avatar from profile (any logged-in user)."""
    user = getEffectiveUserInfo(event)
    if not user.get("userId"):
        return jsonResponse({"error": "Unauthorized"}, 401)
    if not TABLE_NAME or not MEDIA_BUCKET:
        return jsonResponse({"error": "Not configured"}, 500)
    try:
        import boto3
        from datetime import datetime
        user_id = user.get("userId", "")
        pk = f"USER#{user_id}"
        dynamodb = boto3.client("dynamodb")
        resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": pk}, "SK": {"S": "PROFILE"}},
            ProjectionExpression="avatarKey",
        )
        old_key = None
        if "Item" in resp and resp["Item"].get("avatarKey", {}).get("S"):
            old_key = resp["Item"]["avatarKey"]["S"]
        if old_key:
            s3 = boto3.client("s3")
            s3.delete_object(Bucket=MEDIA_BUCKET, Key=old_key)
        now = datetime.utcnow().isoformat() + "Z"
        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": pk}, "SK": {"S": "PROFILE"}},
            UpdateExpression="SET avatarKey = :empty, updatedAt = :now",
            ExpressionAttributeValues={":empty": {"S": ""}, ":now": {"S": now}},
        )
        return jsonResponse({"deleted": True})
    except Exception as e:
        logger.exception("deleteProfileAvatar error")
        return jsonResponse({"error": str(e)}, 500)


def getBrandingLogo(event):
    """GET /branding/logo - Public metadata and URL for current global logo."""
    if not TABLE_NAME or not MEDIA_BUCKET:
        # Fail-soft: return empty payload so frontend can fall back to default.
        return jsonResponse({})
    try:
        import boto3

        region = os.environ.get("AWS_REGION", "us-east-1")
        dynamodb = boto3.client("dynamodb", region_name=region)
        pk = "BRANDING"
        sk = "LOGO#DEFAULT"
        resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": pk}, "SK": {"S": sk}},
        )
        if "Item" not in resp:
            return jsonResponse({})
        item = resp["Item"]
        logo_key = item.get("logoKey", {}).get("S")
        if not logo_key:
            return jsonResponse({})
        alt = item.get("alt", {}).get("S", "Funkedupshift")
        updated_at = item.get("updatedAt", {}).get("S", "")

        s3 = boto3.client("s3", region_name=region)
        url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": MEDIA_BUCKET, "Key": logo_key},
            ExpiresIn=3600,
        )
        return jsonResponse({"url": url, "alt": alt, "updatedAt": updated_at})
    except Exception as e:
        logger.exception("getBrandingLogo error")
        return jsonResponse({"error": str(e)}, 500)


def postBrandingLogoUpload(event):
    """POST /branding/logo - Admin-only: presigned PUT URL + persist logo metadata."""
    user = getEffectiveUserInfo(event)
    if not user.get("userId"):
        return jsonResponse({"error": "Unauthorized"}, 401)
    if "admin" not in user.get("groups", []):
        return jsonResponse({"error": "Forbidden: admin role required"}, 403)
    if not TABLE_NAME or not MEDIA_BUCKET:
        return jsonResponse({"error": "Not configured"}, 500)
    try:
        import boto3
        import json as json_mod
        import uuid as uuid_mod
        from datetime import datetime

        body = json_mod.loads(event.get("body", "{}"))
        content_type = (body.get("contentType") or "image/png").strip()
        alt = (body.get("alt") or "Funkedupshift").strip() or "Funkedupshift"

        allowed = {"image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"}
        if content_type not in allowed:
            return jsonResponse(
                {
                    "error": "contentType must be image/png, image/jpeg, image/gif, or image/webp"
                },
                400,
            )

        ext = "png"
        if "jpeg" in content_type or "jpg" in content_type:
            ext = "jpg"
        elif "gif" in content_type:
            ext = "gif"
        elif "webp" in content_type:
            ext = "webp"

        region = os.environ.get("AWS_REGION", "us-east-1")
        unique = str(uuid_mod.uuid4())
        logo_key = f"branding/logo/{unique}.{ext}"

        s3 = boto3.client("s3", region_name=region)
        upload_url = s3.generate_presigned_url(
            "put_object",
            Params={"Bucket": MEDIA_BUCKET, "Key": logo_key, "ContentType": content_type},
            ExpiresIn=300,
        )

        dynamodb = boto3.client("dynamodb", region_name=region)
        now = datetime.utcnow().isoformat() + "Z"
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": "BRANDING"},
                "SK": {"S": "LOGO#DEFAULT"},
                "logoKey": {"S": logo_key},
                "alt": {"S": alt},
                "updatedAt": {"S": now},
                "uploadedBy": {"S": user.get("userId", "")},
                "entityType": {"S": "BRANDING"},
                "entitySk": {"S": "LOGO#DEFAULT"},
            },
        )

        return jsonResponse({"uploadUrl": upload_url, "key": logo_key, "alt": alt})
    except Exception as e:
        logger.exception("postBrandingLogoUpload error")
        return jsonResponse({"error": str(e)}, 500)


def getStar(event):
    """GET /stars?siteId=SITE#id - Return current user's star rating for a site (auth required)."""
    user = getEffectiveUserInfo(event)
    user_id = user.get("userId")
    if not user_id:
        return jsonResponse({"error": "Unauthorized"}, 401)
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    qs = event.get("queryStringParameters") or {}
    site_id = (qs.get("siteId") or "").strip()
    if not site_id:
        return jsonResponse({"error": "siteId is required"}, 400)
    try:
        import boto3
        dynamodb = boto3.client("dynamodb")
        resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": site_id}, "SK": {"S": f"STAR#{user_id}"}},
        )
        if "Item" not in resp or "rating" not in resp["Item"]:
            return jsonResponse({"error": "No rating found"}, 404)
        rating = int(resp["Item"]["rating"]["N"])
        return jsonResponse({"siteId": site_id, "rating": rating}, 200)
    except Exception as e:
        logger.exception("getStar error")
        return jsonResponse({"error": str(e)}, 500)


def setStar(event):
    """Set a 1-5 star rating for a site for the current user."""
    user = getEffectiveUserInfo(event)
    user_id = user.get("userId")
    if not user_id:
        return jsonResponse({"error": "Unauthorized"}, 401)

    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)

    try:
        import boto3
        import json
        from datetime import datetime

        body = json.loads(event.get("body", "{}"))
        site_id = body.get("siteId", "").strip()
        rating = body.get("rating")

        if not site_id:
            return jsonResponse({"error": "siteId is required"}, 400)

        try:
            rating_int = int(rating)
        except Exception:
            return jsonResponse({"error": "rating must be an integer between 1 and 5"}, 400)

        if rating_int < 1 or rating_int > 5:
            return jsonResponse({"error": "rating must be between 1 and 5"}, 400)

        now = datetime.utcnow().isoformat() + "Z"

        dynamodb = boto3.client("dynamodb")

        # Fetch existing rating for this user/site, if any
        existing = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": site_id}, "SK": {"S": f"STAR#{user_id}"}},
        )
        old_rating = None
        if "Item" in existing and "rating" in existing["Item"]:
            try:
                old_rating = int(existing["Item"]["rating"]["N"])
            except Exception:
                old_rating = None

        # Ensure site METADATA exists
        site = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": site_id}, "SK": {"S": "METADATA"}},
        )
        if "Item" not in site:
            return jsonResponse({"error": "Site not found"}, 404)

        site_item = site.get("Item", {})
        has_count = "totalStarsCount" in site_item
        current_count = None
        if has_count:
            try:
                current_count = int(site_item["totalStarsCount"]["N"])
            except Exception:
                current_count = None

        # Compute deltas for aggregates
        if old_rating is None:
            sum_delta = rating_int
            # First rating for this user; always increment count
            count_delta = 1
        else:
            sum_delta = rating_int - old_rating
            # If count is missing or still zero on the site (legacy data), bump it to 1
            if (not has_count) or (current_count is None) or (current_count == 0):
                count_delta = 1
            else:
                count_delta = 0

        # Update aggregate fields on METADATA item (handle legacy items with no attributes yet)
        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": site_id}, "SK": {"S": "METADATA"}},
            UpdateExpression=(
                "SET totalStarsSum = if_not_exists(totalStarsSum, :zero) + :sumDelta, "
                "totalStarsCount = if_not_exists(totalStarsCount, :zero) + :countDelta, "
                "updatedAt = :updatedAt"
            ),
            ExpressionAttributeValues={
                ":sumDelta": {"N": str(sum_delta)},
                ":countDelta": {"N": str(count_delta)},
                ":zero": {"N": "0"},
                ":updatedAt": {"S": now},
            },
        )

        # Upsert the individual star record
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": site_id},
                "SK": {"S": f"STAR#{user_id}"},
                "rating": {"N": str(rating_int)},
                "userId": {"S": user_id},
                "entityType": {"S": "SITE_STAR"},
                "entitySk": {"S": user_id},
                "updatedAt": {"S": now},
            },
        )

        return jsonResponse({"siteId": site_id, "rating": rating_int}, 200)
    except Exception as e:
        logger.exception("setStar error")
        return jsonResponse({"error": str(e)}, 500)


def _requireAdmin(event):
    """Return (user, None) if admin, else (None, error_response)."""
    user = getEffectiveUserInfo(event)
    if not user.get("userId"):
        return None, jsonResponse({"error": "Unauthorized"}, 401)
    if "admin" not in user.get("groups", []):
        return None, jsonResponse({"error": "Forbidden: admin role required"}, 403)
    return user, None


def _requireSuperAdmin(event):
    """Return (user, None) if SuperAdmin (admin group), else (None, error_response)."""
    return _requireAdmin(event)


def _requireManagerOrAdmin(event):
    """Return (user, None) if admin or manager, else (None, error_response)."""
    user = getEffectiveUserInfo(event)
    if not user.get("userId"):
        return None, jsonResponse({"error": "Unauthorized"}, 401)
    groups = user.get("groups", [])
    if "admin" not in groups and "manager" not in groups:
        return None, jsonResponse({"error": "Forbidden: manager or admin role required"}, 403)
    return user, None


def _canModifyAdminGroup(user):
    """Only SuperAdmin can add/remove users from admin group."""
    return "admin" in user.get("groups", [])


def _dynamoItemToDict(item):
    """Convert DynamoDB item format to plain dict."""
    out = {}
    for key, val in item.items():
        if "S" in val:
            out[key] = val["S"]
        elif "N" in val:
            num_str = val["N"]
            out[key] = int(num_str) if "." not in num_str else float(num_str)
        elif "L" in val:
            out[key] = [v.get("S", "") for v in val["L"]]
    return out


def listCategories(event):
    """List all categories (public read for browse/filter)."""
    if not TABLE_NAME:
        return jsonResponse({"categories": [], "error": "TABLE_NAME not set"}, 200)
    try:
        import boto3
        dynamodb = boto3.client("dynamodb")
        result = dynamodb.query(
            TableName=TABLE_NAME,
            IndexName="byEntity",
            KeyConditionExpression="entityType = :et",
            ExpressionAttributeValues={":et": {"S": "CATEGORY"}},
        )
        items = result.get("Items", [])
        categories = [_dynamoItemToDict(i) for i in items]
        categories.sort(key=lambda c: (c.get("name") or c.get("PK") or "").lower())
        return jsonResponse({"categories": categories})
    except Exception as e:
        logger.exception("listCategories error")
        return jsonResponse({"error": str(e)}, 500)


def createCategory(event):
    """Create a category (manager or admin)."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        import uuid
        from datetime import datetime
        body = json.loads(event.get("body", "{}"))
        name = (body.get("name") or "").strip()
        if not name:
            return jsonResponse({"error": "name is required"}, 400)
        cat_id = f"CATEGORY#{uuid.uuid4()}"
        now = datetime.utcnow().isoformat() + "Z"
        dynamodb = boto3.client("dynamodb")
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": cat_id},
                "SK": {"S": "METADATA"},
                "name": {"S": name},
                "description": {"S": body.get("description", "")},
                "entityType": {"S": "CATEGORY"},
                "entitySk": {"S": cat_id},
                "createdAt": {"S": now},
                "updatedAt": {"S": now},
            },
        )
        return jsonResponse({"id": cat_id, "name": name}, 201)
    except Exception as e:
        logger.exception("createCategory error")
        return jsonResponse({"error": str(e)}, 500)


def updateCategory(event):
    """Update a category (manager or admin)."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        from datetime import datetime
        body = json.loads(event.get("body", "{}"))
        cat_id = (body.get("id") or "").strip()
        if not cat_id:
            return jsonResponse({"error": "id is required"}, 400)
        name = body.get("name")
        description = body.get("description")
        now = datetime.utcnow().isoformat() + "Z"
        update_expr = ["updatedAt = :updatedAt"]
        names = {}
        values = {":updatedAt": {"S": now}}
        if name is not None:
            update_expr.append("#name = :name")
            names["#name"] = "name"
            values[":name"] = {"S": str(name)}
        if description is not None:
            update_expr.append("#description = :description")
            names["#description"] = "description"
            values[":description"] = {"S": str(description)}
        dynamodb = boto3.client("dynamodb")
        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": cat_id}, "SK": {"S": "METADATA"}},
            UpdateExpression="SET " + ", ".join(update_expr),
            ExpressionAttributeNames=names or None,
            ExpressionAttributeValues=values,
        )
        return jsonResponse({"id": cat_id, "name": name, "description": description}, 200)
    except Exception as e:
        logger.exception("updateCategory error")
        return jsonResponse({"error": str(e)}, 500)


def deleteCategory(event):
    """Delete a category (manager or admin)."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        # DELETE /categories?id=CATEGORY#uuid (query string) or body {"id": "..."}
        body = event.get("body")
        if body and isinstance(body, str):
            try:
                body = json.loads(body)
            except Exception:
                body = {}
        elif not body:
            body = {}
        qs = event.get("queryStringParameters") or {}
        cat_id = (body.get("id") or qs.get("id") or "").strip()
        if not cat_id:
            return jsonResponse({"error": "id is required"}, 400)
        dynamodb = boto3.client("dynamodb")
        dynamodb.delete_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": cat_id}, "SK": {"S": "METADATA"}},
        )
        return jsonResponse({"id": cat_id, "deleted": True}, 200)
    except Exception as e:
        logger.exception("deleteCategory error")
        return jsonResponse({"error": str(e)}, 500)


# ------------------------------------------------------------------------------
# Media section (images and videos)
# ------------------------------------------------------------------------------

def _resolveCategoriesForMedia(dynamodb, media_list):
    """Add categories list (id, name) to each media item from categoryIds."""
    all_ids = set()
    for m in media_list:
        for cid in m.get("categoryIds") or []:
            all_ids.add(cid)
    if not all_ids:
        for m in media_list:
            m.setdefault("categories", [])
        return
    keys = [{"PK": {"S": cid}, "SK": {"S": "METADATA"}} for cid in all_ids]
    id_to_name = {}
    for i in range(0, len(keys), 100):
        batch = keys[i : i + 100]
        resp = dynamodb.batch_get_item(RequestItems={TABLE_NAME: {"Keys": batch}})
        for item in resp.get("Responses", {}).get(TABLE_NAME, []):
            pk = item.get("PK", {}).get("S", "")
            name = item.get("name", {}).get("S", pk)
            id_to_name[pk] = name
    for m in media_list:
        m["categories"] = [
            {"id": cid, "name": id_to_name.get(cid, cid)}
            for cid in (m.get("categoryIds") or [])
        ]


def _addMediaUrls(media_list, region=None):
    """Set mediaUrl and thumbnailUrl (presigned GET) for each media item."""
    if not MEDIA_BUCKET or not media_list:
        return
    try:
        import boto3
        region = region or os.environ.get("AWS_REGION", "us-east-1")
        s3 = boto3.client("s3", region_name=region)
        for m in media_list:
            for key_attr, url_attr in [("mediaKey", "mediaUrl"), ("thumbnailKey", "thumbnailUrl")]:
                key = m.get(key_attr)
                if key and isinstance(key, str) and key.strip():
                    if url_attr == "thumbnailUrl" and "#" in key:
                        logger.info("Skipping thumbnailKey with # (presigned URL broken): %s", key[:50])
                        continue
                    url = s3.generate_presigned_url(
                        "get_object",
                        Params={"Bucket": MEDIA_BUCKET, "Key": key},
                        ExpiresIn=3600,
                    )
                    m[url_attr] = url
            if not m.get("thumbnailUrl") and m.get("mediaUrl") and m.get("mediaType") == "image":
                m["thumbnailUrl"] = m["mediaUrl"]
    except Exception as e:
        logger.warning("_addMediaUrls failed: %s", e)


def _dynamoItemToMedia(item):
    """Convert DynamoDB item to media dict."""
    out = {}
    for key, val in item.items():
        if "S" in val:
            out[key] = val["S"]
        elif "N" in val:
            num_str = val["N"]
            out[key] = int(num_str) if "." not in num_str else float(num_str)
        elif "L" in val:
            out[key] = [v.get("S", "") for v in val["L"]]
    total_sum = out.get("totalStarsSum")
    total_count = out.get("totalStarsCount")
    if isinstance(total_sum, (int, float)) and isinstance(total_count, (int, float)) and total_count > 0:
        avg = max(1.0, min(5.0, float(total_sum) / float(total_count)))
        out["averageRating"] = round(avg, 1)
    return out


def listMedia(event, forceAll=False):
    """List media (public), optional ?id= single, ?q= search, ?categoryIds= filter, ?limit= 100."""
    if not TABLE_NAME:
        return jsonResponse({"media": [], "error": "TABLE_NAME not set"}, 200)
    try:
        import boto3
        region = os.environ.get("AWS_REGION", "us-east-1")
        dynamodb = boto3.client("dynamodb", region_name=region)
        qs = event.get("queryStringParameters") or {}
        single_id = (qs.get("id") or "").strip()
        if single_id:
            resp = dynamodb.get_item(
                TableName=TABLE_NAME,
                Key={"PK": {"S": single_id}, "SK": {"S": "METADATA"}},
            )
            if "Item" not in resp:
                return jsonResponse({"error": "Media not found"}, 404)
            m = _dynamoItemToMedia(resp["Item"])
            _resolveCategoriesForMedia(dynamodb, [m])
            _addMediaUrls([m], region=region)
            return jsonResponse({"media": m})

        if forceAll:
            user = getEffectiveUserInfo(event)
            if not user.get("userId"):
                return jsonResponse({"error": "Unauthorized"}, 401)
            if "admin" not in user.get("groups", []):
                return jsonResponse({"error": "Forbidden: admin required for full list"}, 403)
            use_no_limit = True
        else:
            use_no_limit = False
        try:
            limit_param = int((qs.get("limit") or "").strip() or 100)
        except ValueError:
            limit_param = 100
        limit_param = max(1, min(limit_param, 10000))
        category_ids_param = (qs.get("categoryIds") or "").strip()
        filter_category_ids = [x.strip() for x in category_ids_param.split(",") if x.strip()]
        category_mode = (qs.get("categoryMode") or "").strip().lower() or "and"

        page_limit = None if use_no_limit else limit_param
        items = []
        request_kw = {
            "TableName": TABLE_NAME,
            "IndexName": "byEntity",
            "KeyConditionExpression": "entityType = :et",
            "ExpressionAttributeValues": {":et": {"S": "MEDIA"}},
        }
        if page_limit is not None:
            request_kw["Limit"] = page_limit
        result = dynamodb.query(**request_kw)
        items.extend(result.get("Items", []))
        while use_no_limit and result.get("LastEvaluatedKey"):
            request_kw["ExclusiveStartKey"] = result["LastEvaluatedKey"]
            result = dynamodb.query(**request_kw)
            items.extend(result.get("Items", []))

        media_list = [_dynamoItemToMedia(i) for i in items]
        _resolveCategoriesForMedia(dynamodb, media_list)
        if filter_category_ids:
            if category_mode == "or":
                media_list = [
                    m for m in media_list
                    if any(cid in (m.get("categoryIds") or []) for cid in filter_category_ids)
                ]
            else:
                media_list = [
                    m for m in media_list
                    if all(cid in (m.get("categoryIds") or []) for cid in filter_category_ids)
                ]
        search_q = (qs.get("q") or qs.get("search") or "").strip()
        if search_q:
            q_lower = search_q.lower()
            media_list = [
                m for m in media_list
                if q_lower in (m.get("title") or "").lower()
                or q_lower in (m.get("description") or "").lower()
            ]
        _addMediaUrls(media_list, region=region)
        media_list.sort(key=lambda m: (
            -(m.get("averageRating") or 0),
            (m.get("title") or m.get("PK") or "").lower(),
        ))
        return jsonResponse({"media": media_list})
    except Exception as e:
        logger.exception("listMedia error: %s", e)
        return jsonResponse({"error": str(e), "media": []}, 500)


def createMedia(event):
    """Create media item (manager or admin)."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        import uuid
        from datetime import datetime
        body = json.loads(event.get("body", "{}"))
        title = (body.get("title") or "").strip()
        media_type = (body.get("mediaType") or "image").strip().lower()
        if media_type not in ("image", "video"):
            media_type = "image"
        media_key = (body.get("mediaKey") or "").strip()
        if not media_key:
            return jsonResponse({"error": "mediaKey is required"}, 400)
        media_id = (body.get("id") or "").strip()
        if not media_id or not media_id.startswith("MEDIA#"):
            media_id = f"MEDIA#{uuid.uuid4()}"
        now = datetime.utcnow().isoformat() + "Z"
        category_ids = [str(c) for c in (body.get("categoryIds") or []) if c]
        category_ids_list = [{"S": cid} for cid in category_ids]
        item = {
            "PK": {"S": media_id},
            "SK": {"S": "METADATA"},
            "title": {"S": title or "Untitled"},
            "description": {"S": body.get("description", "")},
            "mediaType": {"S": media_type},
            "mediaKey": {"S": media_key},
            "categoryIds": {"L": category_ids_list},
            "createdAt": {"S": now},
            "updatedAt": {"S": now},
            "entityType": {"S": "MEDIA"},
            "entitySk": {"S": media_id},
            "totalStarsSum": {"N": "0"},
            "totalStarsCount": {"N": "0"},
        }
        dynamodb = boto3.client("dynamodb")
        dynamodb.put_item(TableName=TABLE_NAME, Item=item)
        return jsonResponse({"id": media_id, "title": title or "Untitled", "mediaType": media_type}, 201)
    except Exception as e:
        logger.exception("createMedia error")
        return jsonResponse({"error": str(e)}, 500)


def updateMedia(event):
    """Update media item (manager or admin)."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        from datetime import datetime
        raw_body = event.get("body", "{}")
        body = json.loads(raw_body) if isinstance(raw_body, str) else (raw_body or {})
        media_id = (body.get("id") or "").strip()
        if not media_id:
            return jsonResponse({"error": "id is required"}, 400)
        title = body.get("title")
        description = body.get("description")
        category_ids = body.get("categoryIds")
        media_key = (body.get("mediaKey") or "").strip() or None
        now = datetime.utcnow().isoformat() + "Z"
        dynamodb = boto3.client("dynamodb")
        set_parts = ["updatedAt = :updatedAt"]
        names = {}
        values = {":updatedAt": {"S": now}}
        if title is not None:
            set_parts.append("#title = :title")
            names["#title"] = "title"
            values[":title"] = {"S": str(title)}
        if description is not None:
            set_parts.append("#description = :description")
            names["#description"] = "description"
            values[":description"] = {"S": str(description)}
        if category_ids is not None:
            set_parts.append("categoryIds = :categoryIds")
            values[":categoryIds"] = {"L": [{"S": str(c)} for c in category_ids]}
        if media_key is not None:
            set_parts.append("mediaKey = :mediaKey")
            values[":mediaKey"] = {"S": media_key}
        delete_thumbnail = body.get("deleteThumbnail") is True
        thumbnail_key = (body.get("thumbnailKey") or "").strip() or None
        remove_parts = []
        current_thumb_key = None
        if delete_thumbnail or thumbnail_key is not None:
            get_resp = dynamodb.get_item(
                TableName=TABLE_NAME,
                Key={"PK": {"S": media_id}, "SK": {"S": "METADATA"}},
                ProjectionExpression="thumbnailKey",
            )
            if "Item" in get_resp and "thumbnailKey" in get_resp["Item"]:
                current_thumb_key = get_resp["Item"]["thumbnailKey"].get("S", "").strip() or None
        # Only delete from S3 when the key is actually changing (or on explicit delete).
        # If thumbnail_key equals current_thumb_key, we're reusing the same key (e.g. same extension);
        # deleting would remove the object before the new upload overwrites it.
        if MEDIA_BUCKET and current_thumb_key and (delete_thumbnail or (thumbnail_key is not None and thumbnail_key != current_thumb_key)):
            try:
                s3 = boto3.client("s3")
                s3.delete_object(Bucket=MEDIA_BUCKET, Key=current_thumb_key)
            except Exception as e:
                logger.warning("S3 delete_object for thumbnail failed: %s", e)
        if delete_thumbnail:
            remove_parts.append("#thumbnailKey")
            names["#thumbnailKey"] = "thumbnailKey"
        elif thumbnail_key is not None:
            set_parts.append("#thumbnailKey = :thumbnailKey")
            names["#thumbnailKey"] = "thumbnailKey"
            values[":thumbnailKey"] = {"S": thumbnail_key}
        update_expr = "SET " + ", ".join(set_parts)
        if remove_parts:
            update_expr += " REMOVE " + ", ".join(remove_parts)
        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": media_id}, "SK": {"S": "METADATA"}},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=names if names else None,
            ExpressionAttributeValues=values,
        )
        return jsonResponse({"id": media_id, "title": title, "description": description, "categoryIds": category_ids}, 200)
    except Exception as e:
        logger.exception("updateMedia error")
        return jsonResponse({"error": str(e)}, 500)


def deleteMedia(event):
    """Delete media item (manager or admin)."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        body = event.get("body")
        if body and isinstance(body, str):
            try:
                body = json.loads(body)
            except Exception:
                body = {}
        else:
            body = {}
        qs = event.get("queryStringParameters") or {}
        media_id = (body.get("id") or qs.get("id") or "").strip()
        if not media_id:
            return jsonResponse({"error": "id is required"}, 400)
        dynamodb = boto3.client("dynamodb")
        get_resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": media_id}, "SK": {"S": "METADATA"}},
            ProjectionExpression="mediaKey, thumbnailKey",
        )
        if "Item" in get_resp:
            for key_attr in ("mediaKey", "thumbnailKey"):
                key = get_resp["Item"].get(key_attr, {}).get("S", "").strip()
                if key and MEDIA_BUCKET:
                    try:
                        s3 = boto3.client("s3")
                        s3.delete_object(Bucket=MEDIA_BUCKET, Key=key)
                    except Exception as e:
                        logger.warning("S3 delete failed for %s: %s", key, e)
        dynamodb.delete_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": media_id}, "SK": {"S": "METADATA"}},
        )
        return jsonResponse({"id": media_id, "deleted": True}, 200)
    except Exception as e:
        logger.exception("deleteMedia error")
        return jsonResponse({"error": str(e)}, 500)


def getPresignedMediaUpload(event):
    """Return presigned PUT URL for media upload (manager or admin)."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err
    if not MEDIA_BUCKET:
        return jsonResponse({"error": "MEDIA_BUCKET not configured"}, 500)
    try:
        import boto3
        import uuid as uuid_mod
        body = json.loads(event.get("body", "{}"))
        media_id = (body.get("mediaId") or body.get("id") or "").strip()
        if not media_id:
            return jsonResponse({"error": "mediaId is required (generate client-side: MEDIA#uuid)"}, 400)
        media_type = (body.get("mediaType") or "image").strip().lower()
        if media_type not in ("image", "video"):
            media_type = "image"
        contentType = (body.get("contentType") or "image/png").strip()
        ext = "png"
        if "jpeg" in contentType or "jpg" in contentType:
            ext = "jpg"
        elif "gif" in contentType:
            ext = "gif"
        elif "webp" in contentType:
            ext = "webp"
        elif "mp4" in contentType:
            ext = "mp4"
        elif "webm" in contentType:
            ext = "webm"
        unique = str(uuid_mod.uuid4())
        folder = "images" if media_type == "image" else "videos"
        key = f"media/{folder}/{media_id}/{unique}.{ext}"
        region = os.environ.get("AWS_REGION", "us-east-1")
        s3 = boto3.client("s3", region_name=region)
        upload_url = s3.generate_presigned_url(
            "put_object",
            Params={"Bucket": MEDIA_BUCKET, "Key": key, "ContentType": contentType},
            ExpiresIn=300,
        )
        return jsonResponse({"uploadUrl": upload_url, "key": key})
    except Exception as e:
        logger.exception("getPresignedMediaUpload error")
        return jsonResponse({"error": str(e)}, 500)


def getPresignedThumbnailUpload(event):
    """Return presigned PUT URL for custom thumbnail upload (manager or admin)."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err
    if not MEDIA_BUCKET:
        return jsonResponse({"error": "MEDIA_BUCKET not configured"}, 500)
    try:
        import boto3
        body = json.loads(event.get("body", "{}"))
        media_id = (body.get("mediaId") or body.get("id") or "").strip()
        if not media_id:
            return jsonResponse({"error": "mediaId is required"}, 400)
        contentType = (body.get("contentType") or "image/jpeg").strip()
        ext = "jpg"
        if "jpeg" in contentType or "jpg" in contentType:
            ext = "jpg"
        elif "png" in contentType:
            ext = "png"
        elif "gif" in contentType:
            ext = "gif"
        elif "webp" in contentType:
            ext = "webp"
        key = f"media/thumbnails/{media_id.replace('#', '_')}_custom.{ext}"
        region = os.environ.get("AWS_REGION", "us-east-1")
        s3 = boto3.client("s3", region_name=region)
        upload_url = s3.generate_presigned_url(
            "put_object",
            Params={"Bucket": MEDIA_BUCKET, "Key": key, "ContentType": contentType},
            ExpiresIn=300,
        )
        return jsonResponse({"uploadUrl": upload_url, "key": key})
    except Exception as e:
        logger.exception("getPresignedThumbnailUpload error")
        return jsonResponse({"error": str(e)}, 500)


def postMediaRegenerateThumbnail(event):
    """POST /media/regenerate-thumbnail - Trigger thumbnail regeneration for a video (manager or admin)."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err
    try:
        import boto3
        body = json.loads(event.get("body", "{}"))
        media_id = (body.get("mediaId") or body.get("id") or "").strip()
        if not media_id:
            return jsonResponse({"error": "mediaId is required"}, 400)
        thumb_fn = os.environ.get("THUMB_FUNCTION_NAME", "fus-thumb")
        region = os.environ.get("AWS_REGION", "us-east-1")
        lambda_client = boto3.client("lambda", region_name=region)
        payload = json.dumps({"source": "api", "action": "regenerate", "mediaId": media_id})
        resp = lambda_client.invoke(
            FunctionName=thumb_fn,
            InvocationType="RequestResponse",
            Payload=payload,
        )
        payload_out = resp.get("Payload")
        if payload_out:
            result = json.loads(payload_out.read().decode())
            status_code = result.get("statusCode", 200)
            body_str = result.get("body", "{}")
            try:
                body_out = json.loads(body_str) if isinstance(body_str, str) else body_str
            except Exception:
                body_out = {"error": body_str}
            if status_code != 200:
                return jsonResponse(body_out.get("error", "Regeneration failed"), statusCode=status_code)
            return jsonResponse({"ok": True, "message": "Thumbnail regeneration started"})
        return jsonResponse({"error": "No response from thumbnail service"}, 500)
    except Exception as e:
        logger.exception("postMediaRegenerateThumbnail error")
        return jsonResponse({"error": str(e)}, 500)


def setMediaStar(event):
    """Set 1-5 star rating for media (auth required)."""
    user = getEffectiveUserInfo(event)
    user_id = user.get("userId")
    if not user_id:
        return jsonResponse({"error": "Unauthorized"}, 401)
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        from datetime import datetime
        body = json.loads(event.get("body", "{}"))
        media_id = body.get("mediaId", "").strip()
        rating = body.get("rating")
        if not media_id:
            return jsonResponse({"error": "mediaId is required"}, 400)
        try:
            rating_int = int(rating)
        except Exception:
            return jsonResponse({"error": "rating must be an integer between 1 and 5"}, 400)
        if rating_int < 1 or rating_int > 5:
            return jsonResponse({"error": "rating must be between 1 and 5"}, 400)
        now = datetime.utcnow().isoformat() + "Z"
        dynamodb = boto3.client("dynamodb")
        existing = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": media_id}, "SK": {"S": f"STAR#{user_id}"}},
        )
        old_rating = None
        if "Item" in existing and "rating" in existing["Item"]:
            try:
                old_rating = int(existing["Item"]["rating"]["N"])
            except Exception:
                old_rating = None
        site = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": media_id}, "SK": {"S": "METADATA"}},
        )
        if "Item" not in site:
            return jsonResponse({"error": "Media not found"}, 404)
        site_item = site.get("Item", {})
        has_count = "totalStarsCount" in site_item
        current_count = int(site_item["totalStarsCount"]["N"]) if has_count else None
        if old_rating is None:
            sum_delta = rating_int
            count_delta = 1
        else:
            sum_delta = rating_int - old_rating
            count_delta = 0 if (has_count and current_count and current_count > 0) else 1
        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": media_id}, "SK": {"S": "METADATA"}},
            UpdateExpression=(
                "SET totalStarsSum = if_not_exists(totalStarsSum, :zero) + :sumDelta, "
                "totalStarsCount = if_not_exists(totalStarsCount, :zero) + :countDelta, "
                "updatedAt = :updatedAt"
            ),
            ExpressionAttributeValues={
                ":sumDelta": {"N": str(sum_delta)},
                ":countDelta": {"N": str(count_delta)},
                ":zero": {"N": "0"},
                ":updatedAt": {"S": now},
            },
        )
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": media_id},
                "SK": {"S": f"STAR#{user_id}"},
                "rating": {"N": str(rating_int)},
                "userId": {"S": user_id},
                "entityType": {"S": "MEDIA_STAR"},
                "entitySk": {"S": user_id},
                "updatedAt": {"S": now},
            },
        )
        return jsonResponse({"mediaId": media_id, "rating": rating_int}, 200)
    except Exception as e:
        logger.exception("setMediaStar error")
        return jsonResponse({"error": str(e)}, 500)


def listMediaCategories(event):
    """List media categories (public read for browse/filter)."""
    if not TABLE_NAME:
        return jsonResponse({"categories": [], "error": "TABLE_NAME not set"}, 200)
    try:
        import boto3
        dynamodb = boto3.client("dynamodb")
        result = dynamodb.query(
            TableName=TABLE_NAME,
            IndexName="byEntity",
            KeyConditionExpression="entityType = :et",
            ExpressionAttributeValues={":et": {"S": "MEDIA_CATEGORY"}},
        )
        items = result.get("Items", [])
        categories = [_dynamoItemToDict(i) for i in items]
        categories.sort(key=lambda c: (c.get("name") or c.get("PK") or "").lower())
        return jsonResponse({"categories": categories})
    except Exception as e:
        logger.exception("listMediaCategories error")
        return jsonResponse({"error": str(e)}, 500)


def createMediaCategory(event):
    """Create media category (manager or admin)."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        import uuid
        from datetime import datetime
        body = json.loads(event.get("body", "{}"))
        name = (body.get("name") or "").strip()
        if not name:
            return jsonResponse({"error": "name is required"}, 400)
        cat_id = f"MEDIA_CATEGORY#{uuid.uuid4()}"
        now = datetime.utcnow().isoformat() + "Z"
        dynamodb = boto3.client("dynamodb")
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": cat_id},
                "SK": {"S": "METADATA"},
                "name": {"S": name},
                "description": {"S": body.get("description", "")},
                "entityType": {"S": "MEDIA_CATEGORY"},
                "entitySk": {"S": cat_id},
                "createdAt": {"S": now},
                "updatedAt": {"S": now},
            },
        )
        return jsonResponse({"id": cat_id, "name": name}, 201)
    except Exception as e:
        logger.exception("createMediaCategory error")
        return jsonResponse({"error": str(e)}, 500)


def updateMediaCategory(event):
    """Update media category (manager or admin)."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        from datetime import datetime
        body = json.loads(event.get("body", "{}"))
        cat_id = (body.get("id") or "").strip()
        if not cat_id:
            return jsonResponse({"error": "id is required"}, 400)
        name = body.get("name")
        description = body.get("description")
        now = datetime.utcnow().isoformat() + "Z"
        update_expr = ["updatedAt = :updatedAt"]
        names = {}
        values = {":updatedAt": {"S": now}}
        if name is not None:
            update_expr.append("#name = :name")
            names["#name"] = "name"
            values[":name"] = {"S": str(name)}
        if description is not None:
            update_expr.append("#description = :description")
            names["#description"] = "description"
            values[":description"] = {"S": str(description)}
        dynamodb = boto3.client("dynamodb")
        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": cat_id}, "SK": {"S": "METADATA"}},
            UpdateExpression="SET " + ", ".join(update_expr),
            ExpressionAttributeNames=names or None,
            ExpressionAttributeValues=values,
        )
        return jsonResponse({"id": cat_id, "name": name, "description": description}, 200)
    except Exception as e:
        logger.exception("updateMediaCategory error")
        return jsonResponse({"error": str(e)}, 500)


def deleteMediaCategory(event):
    """Delete media category (manager or admin)."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        body = event.get("body")
        if body and isinstance(body, str):
            try:
                body = json.loads(body)
            except Exception:
                body = {}
        else:
            body = {}
        qs = event.get("queryStringParameters") or {}
        cat_id = (body.get("id") or qs.get("id") or "").strip()
        if not cat_id:
            return jsonResponse({"error": "id is required"}, 400)
        dynamodb = boto3.client("dynamodb")
        dynamodb.delete_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": cat_id}, "SK": {"S": "METADATA"}},
        )
        return jsonResponse({"id": cat_id, "deleted": True}, 200)
    except Exception as e:
        logger.exception("deleteMediaCategory error")
        return jsonResponse({"error": str(e)}, 500)


# ------------------------------------------------------------------------------
# Memes section
# ------------------------------------------------------------------------------

def listMemesCache(event):
    """GET /memes/cache - Public cache-only view for guests. No auth required."""
    user = getEffectiveUserInfo(event)
    qs = event.get("queryStringParameters") or {}
    single_id = (qs.get("id") or "").strip()
    search_param = bool((qs.get("q") or "").strip() or (qs.get("tagIds") or "").strip())
    mine_param = (qs.get("mine") or "").strip().lower() in ("1", "true", "yes")
    if search_param or mine_param:
        return jsonResponse({"error": "Unauthorized"}, 401)
    from api.memes import list_memes
    return list_memes(event, user or {}, jsonResponse)


def listMemes(event):
    """GET /memes - List memes (JWT required). Cache, search, mine for logged-in users."""
    user, err = _requireAuth(event)
    if err:
        return err
    qs = event.get("queryStringParameters") or {}
    mine_param = (qs.get("mine") or "").strip().lower() in ("1", "true", "yes")
    search_param = bool((qs.get("q") or "").strip() or (qs.get("tagIds") or "").strip())

    if mine_param:
        from api.memes import can_create_memes
        if not can_create_memes(user):
            return jsonResponse({"error": "Forbidden: Memes creator access required (user + Memes group) for My Memes"}, 403)
    elif search_param:
        if not _canAccessMemes(user):
            return jsonResponse({"error": "Forbidden: Memes access required (join Memes group or contact admin)"}, 403)

    from api.memes import list_memes
    return list_memes(event, user, jsonResponse)


def listMemeTags(event):
    """GET /memes/tags - List meme tags for autocomplete. Public (no auth required)."""
    from api.memes import list_meme_tags
    return list_meme_tags(event, jsonResponse)


def _requireAuth(event):
    """Return (user, None) if logged in, else (None, error_response)."""
    user = getEffectiveUserInfo(event)
    if not user.get("userId"):
        return None, jsonResponse({"error": "Unauthorized"}, 401)
    return user, None


def _requireMemesRateAccess(event):
    """Return (user, None) if user can rate memes (logged in + Memes group), else (None, error_response)."""
    user, err = _requireAuth(event)
    if err:
        return None, err
    from api.memes import can_rate_memes
    if not can_rate_memes(user):
        return None, jsonResponse({"error": "Forbidden: Memes access required to rate (join Memes group)"}, 403)
    return user, None


def _requireMemesCreateAccess(event):
    """Return (user, None) if user can create memes (user+Memes or admin), else (None, error_response).
    When impersonating, superadmin can create on behalf of the impersonated user."""
    user, err = _requireAuth(event)
    if err:
        return None, err
    if user.get("impersonated"):
        return user, None
    from api.memes import can_create_memes
    if not can_create_memes(user):
        return None, jsonResponse({"error": "Forbidden: Memes creator access required (user + Memes group)"}, 403)
    return user, None


def createMeme(event):
    """POST /memes - Create meme. User+Memes or admin required."""
    user, err = _requireMemesCreateAccess(event)
    if err:
        return err
    from api.memes import create_meme
    return create_meme(event, user, jsonResponse)


def updateMeme(event):
    """PUT /memes - Update meme. Creator (user+memes), manager+memes, or admin."""
    user, err = _requireAuth(event)
    if err:
        return err
    if not _canAccessMemes(user):
        return jsonResponse({"error": "Forbidden: Memes access required"}, 403)
    from api.memes import update_meme
    return update_meme(event, user, jsonResponse)


def deleteMeme(event):
    """DELETE /memes - Delete meme. Creator (user+memes), manager+memes, or admin."""
    user, err = _requireAuth(event)
    if err:
        return err
    if not _canAccessMemes(user):
        return jsonResponse({"error": "Forbidden: Memes access required"}, 403)
    from api.memes import delete_meme
    return delete_meme(event, user, jsonResponse)


def getMemePresignedUpload(event):
    """POST /memes/upload - Presigned PUT URL. User+Memes or admin required."""
    user, err = _requireMemesCreateAccess(event)
    if err:
        return err
    from api.memes import get_meme_presigned_upload
    return get_meme_presigned_upload(event, user, jsonResponse)


def validateMemeImageUrl(event):
    """POST /memes/validate-url - Validate image URL. User+Memes or admin required."""
    _, err = _requireMemesCreateAccess(event)
    if err:
        return err
    from api.memes import validate_image_url
    return validate_image_url(event, jsonResponse)


def importMemeFromUrl(event):
    """POST /memes/import-from-url - Import image from URL. User+Memes or admin required."""
    user, err = _requireMemesCreateAccess(event)
    if err:
        return err
    from api.memes import import_meme_from_url
    return import_meme_from_url(event, user, jsonResponse)


def generateMemeTitle(event):
    """POST /memes/generate-title - Generate meme title. User+Memes or admin required."""
    user, err = _requireMemesCreateAccess(event)
    if err:
        return err
    from api.memes import generate_meme_title_handler
    return generate_meme_title_handler(event, user, jsonResponse)


def setMemeStar(event):
    """POST /memes/stars - Set star rating. Logged in + Memes group required."""
    user, err = _requireMemesRateAccess(event)
    if err:
        return err
    from api.memes import set_meme_star
    return set_meme_star(event, user, jsonResponse)


# ------------------------------------------------------------------------------
# Squash doubles section
# ------------------------------------------------------------------------------

def _requireSquashAccess(event):
    """Return (user, None) if user can view Squash, else (None, error_response)."""
    user = getEffectiveUserInfo(event)
    if not user.get("userId"):
        return None, jsonResponse({"error": "Unauthorized"}, 401)
    if not _canAccessSquash(user):
        return None, jsonResponse({"error": "Forbidden: Squash access required"}, 403)
    return user, None


def _requireFinancialAccess(event):
    """Return (user, None) if user can access Financial, else (None, error_response)."""
    user = getEffectiveUserInfo(event)
    if not user.get("userId"):
        return None, jsonResponse({"error": "Unauthorized"}, 401)
    if not _canAccessFinancial(user):
        return None, jsonResponse({"error": "Forbidden: Financial access required"}, 403)
    return user, None


def _requireFinancialAdmin(event):
    """Return (user, None) if user can admin Financial, else (None, error_response)."""
    user = getEffectiveUserInfo(event)
    if not user.get("userId"):
        return None, jsonResponse({"error": "Unauthorized"}, 401)
    if not _canAccessFinancialAdmin(user):
        return None, jsonResponse({"error": "Forbidden: Financial admin required"}, 403)
    return user, None


def _canAccessMemes(user):
    """User can access Memes: admin OR in Memes custom group."""
    if not user.get("userId"):
        return False
    if "admin" in user.get("groups", []):
        return True
    custom = _getUserCustomGroups(user["userId"])
    return "Memes" in custom


def _requireMemesAccess(event):
    """Return (user, None) if user can access Memes, else (None, error_response)."""
    user = getEffectiveUserInfo(event)
    if not user.get("userId"):
        return None, jsonResponse({"error": "Unauthorized"}, 401)
    if not _canAccessMemes(user):
        return None, jsonResponse({"error": "Forbidden: Memes access required (join Memes group or contact admin)"}, 403)
    return user, None


def _requireSquashModify(event):
    """Return (user, None) if user can modify Squash, else (None, error_response)."""
    user = getEffectiveUserInfo(event)
    if not user.get("userId"):
        return None, jsonResponse({"error": "Unauthorized"}, 401)
    if not _canModifySquash(user):
        return None, jsonResponse({"error": "Forbidden: Squash modify permission required"}, 403)
    return user, None


def listSquashPlayers(event):
    """GET /squash/players - List squash players (Squash access required)."""
    _, err = _requireSquashAccess(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"players": [], "error": "TABLE_NAME not set"}, 200)
    try:
        import boto3
        dynamodb = boto3.client("dynamodb")
        result = dynamodb.query(
            TableName=TABLE_NAME,
            IndexName="byEntity",
            KeyConditionExpression="entityType = :et",
            ExpressionAttributeValues={":et": {"S": "SQUASH_PLAYER"}},
        )
        items = result.get("Items", [])
        players = []
        for item in items:
            p = _dynamoItemToDict(item)
            p["id"] = p.get("PK", "")
            players.append(p)
        players.sort(key=lambda p: (p.get("name") or "").lower())
        return jsonResponse({"players": players})
    except Exception as e:
        logger.exception("listSquashPlayers error")
        return jsonResponse({"error": str(e)}, 500)


def createSquashPlayer(event):
    """POST /squash/players - Create squash player (Squash modify required)."""
    _, err = _requireSquashModify(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        import uuid
        from datetime import datetime
        body = json.loads(event.get("body", "{}"))
        name = (body.get("name") or "").strip()
        if not name:
            return jsonResponse({"error": "name is required"}, 400)
        player_id = str(uuid.uuid4())
        pk = f"SQUASH#PLAYER#{player_id}"
        now = datetime.utcnow().isoformat() + "Z"
        email = (body.get("email") or "").strip() or None
        user_id = (body.get("userId") or "").strip() or None
        dynamodb = boto3.client("dynamodb")
        item = {
            "PK": {"S": pk},
            "SK": {"S": "METADATA"},
            "name": {"S": name},
            "entityType": {"S": "SQUASH_PLAYER"},
            "entitySk": {"S": pk},
            "createdAt": {"S": now},
            "updatedAt": {"S": now},
        }
        if email:
            item["email"] = {"S": email}
        if user_id:
            item["userId"] = {"S": user_id}
        dynamodb.put_item(TableName=TABLE_NAME, Item=item)
        return jsonResponse({"id": pk, "name": name, "email": email, "userId": user_id}, 201)
    except Exception as e:
        logger.exception("createSquashPlayer error")
        return jsonResponse({"error": str(e)}, 500)


def updateSquashPlayer(event):
    """PUT /squash/players - Update squash player (Squash modify required)."""
    _, err = _requireSquashModify(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        from datetime import datetime
        body = json.loads(event.get("body", "{}"))
        raw_id = (body.get("id") or "").strip()
        pk = raw_id if raw_id.startswith("SQUASH#PLAYER#") else f"SQUASH#PLAYER#{raw_id}"
        if not pk or pk == "SQUASH#PLAYER#":
            return jsonResponse({"error": "id is required"}, 400)
        name = body.get("name")
        email = body.get("email")
        user_id = body.get("userId")
        now = datetime.utcnow().isoformat() + "Z"
        dynamodb = boto3.client("dynamodb")
        updates = ["updatedAt = :now"]
        values = {":now": {"S": now}}
        if name is not None:
            updates.append("name = :name")
            values[":name"] = {"S": str(name).strip()}
        if email is not None:
            if str(email).strip():
                updates.append("email = :email")
                values[":email"] = {"S": str(email).strip()}
            else:
                updates.append("remove email")
        if user_id is not None:
            if str(user_id).strip():
                updates.append("userId = :uid")
                values[":uid"] = {"S": str(user_id).strip()}
            else:
                updates.append("remove userId")
        if len(updates) <= 1:
            return jsonResponse({"error": "no fields to update"}, 400)
        update_expr = "SET " + ", ".join(u for u in updates if not u.startswith("remove"))
        remove_parts = [u.replace("remove ", "") for u in updates if u.startswith("remove")]
        if remove_parts:
            update_expr += " REMOVE " + ", ".join(remove_parts)
        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": pk}, "SK": {"S": "METADATA"}},
            UpdateExpression=update_expr,
            ExpressionAttributeValues=values,
        )
        return jsonResponse({"id": pk, "updated": True}, 200)
    except Exception as e:
        logger.exception("updateSquashPlayer error")
        return jsonResponse({"error": str(e)}, 500)


def deleteSquashPlayer(event):
    """DELETE /squash/players?id=xxx - Delete squash player (Squash modify required)."""
    _, err = _requireSquashModify(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        qs = event.get("queryStringParameters") or {}
        raw_id = (qs.get("id") or "").strip()
        pk = raw_id if raw_id.startswith("SQUASH#PLAYER#") else f"SQUASH#PLAYER#{raw_id}"
        if not pk or pk == "SQUASH#PLAYER#":
            return jsonResponse({"error": "id is required"}, 400)
        dynamodb = boto3.client("dynamodb")
        dynamodb.delete_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": pk}, "SK": {"S": "METADATA"}},
        )
        result = dynamodb.query(
            TableName=TABLE_NAME,
            KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues={":pk": {"S": pk}, ":sk": {"S": "MATCH#"}},
        )
        for item in result.get("Items", []):
            match_sk = item.get("SK", {}).get("S", "")
            dynamodb.delete_item(
                TableName=TABLE_NAME,
                Key={"PK": {"S": pk}, "SK": {"S": match_sk}},
            )
        return jsonResponse({"id": pk, "deleted": True}, 200)
    except Exception as e:
        logger.exception("deleteSquashPlayer error")
        return jsonResponse({"error": str(e)}, 500)


def listSquashMatches(event):
    """GET /squash/matches - List squash matches (Squash access required). Query: date, dateFrom, dateTo, playerIds, playerMode (and|or)."""
    _, err = _requireSquashAccess(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"matches": [], "error": "TABLE_NAME not set"}, 200)
    try:
        import boto3
        dynamodb = boto3.client("dynamodb")
        qs = event.get("queryStringParameters") or {}
        date_val = (qs.get("date") or "").strip()
        date_from = (qs.get("dateFrom") or "").strip()
        date_to = (qs.get("dateTo") or "").strip()
        player_ids_param = (qs.get("playerIds") or "").strip()
        filter_player_ids = [x.strip() for x in player_ids_param.split(",") if x.strip()]

        match_ids = set()

        if date_val:
            result = dynamodb.query(
                TableName=TABLE_NAME,
                IndexName="bySquashDate",
                KeyConditionExpression="squashDate = :d",
                ExpressionAttributeValues={":d": {"S": date_val}},
            )
            for item in result.get("Items", []):
                pk = item.get("PK", {}).get("S", "")
                if pk:
                    match_ids.add(pk)
        elif date_from and date_to:
            result = dynamodb.query(
                TableName=TABLE_NAME,
                IndexName="bySquashDate",
                KeyConditionExpression="squashDate BETWEEN :d1 AND :d2",
                ExpressionAttributeValues={":d1": {"S": date_from}, ":d2": {"S": date_to}},
            )
            for item in result.get("Items", []):
                pk = item.get("PK", {}).get("S", "")
                if pk:
                    match_ids.add(pk)
        else:
            result = dynamodb.query(
                TableName=TABLE_NAME,
                IndexName="byEntity",
                KeyConditionExpression="entityType = :et",
                ExpressionAttributeValues={":et": {"S": "SQUASH_MATCH"}},
            )
            for item in result.get("Items", []):
                pk = item.get("PK", {}).get("S", "")
                if pk:
                    match_ids.add(pk)
            while result.get("LastEvaluatedKey"):
                result = dynamodb.query(
                    TableName=TABLE_NAME,
                    IndexName="byEntity",
                    KeyConditionExpression="entityType = :et",
                    ExpressionAttributeValues={":et": {"S": "SQUASH_MATCH"}},
                    ExclusiveStartKey=result["LastEvaluatedKey"],
                )
                for item in result.get("Items", []):
                    pk = item.get("PK", {}).get("S", "")
                    if pk:
                        match_ids.add(pk)

        if filter_player_ids:
            player_mode = (qs.get("playerMode") or "").strip().lower() or "and"
            per_player_sets = []
            for pid in filter_player_ids:
                pk = pid if pid.startswith("SQUASH#PLAYER#") else f"SQUASH#PLAYER#{pid}"
                result = dynamodb.query(
                    TableName=TABLE_NAME,
                    KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
                    ExpressionAttributeValues={":pk": {"S": pk}, ":sk": {"S": "MATCH#"}},
                )
                ids_for_player = set()
                for item in result.get("Items", []):
                    mid = item.get("matchId", {}).get("S")
                    if not mid:
                        sk = item.get("SK", {}).get("S", "")
                        mid = sk.replace("MATCH#", "") if "MATCH#" in sk else ""
                    if mid:
                        full = mid if "SQUASH#" in mid else f"SQUASH#MATCH#{mid}"
                        ids_for_player.add(full)
                per_player_sets.append(ids_for_player)
            if per_player_sets:
                if player_mode == "or":
                    player_match_ids = set()
                    for s in per_player_sets:
                        player_match_ids |= s
                else:
                    player_match_ids = per_player_sets[0].copy()
                    for s in per_player_sets[1:]:
                        player_match_ids &= s
                if player_match_ids:
                    match_ids = match_ids & player_match_ids if match_ids else player_match_ids

        matches = []
        for mid in match_ids:
            full_pk = mid if mid.startswith("SQUASH#MATCH#") else f"SQUASH#MATCH#{mid}"
            resp = dynamodb.get_item(
                TableName=TABLE_NAME,
                Key={"PK": {"S": full_pk}, "SK": {"S": "METADATA"}},
            )
            if "Item" in resp:
                m = _dynamoItemToDict(resp["Item"])
                m["id"] = full_pk.replace("SQUASH#MATCH#", "")
                matches.append(m)
        matches.sort(key=lambda m: (m.get("date", ""), m.get("id", "")))
        return jsonResponse({"matches": matches})
    except Exception as e:
        logger.exception("listSquashMatches error")
        return jsonResponse({"error": str(e)}, 500)


def _validateSquashMatchBody(body):
    """Validate match body; return (None, error_msg) or (validated_dict, None)."""
    date_val = (body.get("date") or "").strip()
    if not date_val or len(date_val) != 10:
        return None, "date is required (YYYY-MM-DD)"
    try:
        from datetime import datetime
        datetime.strptime(date_val, "%Y-%m-%d")
    except ValueError:
        return None, "date must be YYYY-MM-DD"
    p1 = (body.get("teamAPlayer1Id") or "").strip()
    p2 = (body.get("teamAPlayer2Id") or "").strip()
    p3 = (body.get("teamBPlayer1Id") or "").strip()
    p4 = (body.get("teamBPlayer2Id") or "").strip()
    for x in [p1, p2, p3, p4]:
        if not x:
            return None, "teamAPlayer1Id, teamAPlayer2Id, teamBPlayer1Id, teamBPlayer2Id are required"
    ids = set()
    for raw in [p1, p2, p3, p4]:
        n = raw if raw.startswith("SQUASH#PLAYER#") else f"SQUASH#PLAYER#{raw}"
        ids.add(n)
    if len(ids) != 4:
        return None, "each player can only be on one team"
    win = (body.get("winningTeam") or "").strip().upper()
    if win not in ("A", "B"):
        return None, "winningTeam must be A or B"
    g_a = body.get("teamAGames")
    g_b = body.get("teamBGames")
    if g_a is None or g_b is None:
        return None, "teamAGames and teamBGames are required"
    try:
        g_a = int(g_a)
        g_b = int(g_b)
    except (TypeError, ValueError):
        return None, "teamAGames and teamBGames must be integers"
    if win == "A":
        if g_a != 3 or g_b not in (0, 1, 2):
            return None, "when team A wins: teamAGames=3, teamBGames in {0,1,2}"
    else:
        if g_b != 3 or g_a not in (0, 1, 2):
            return None, "when team B wins: teamBGames=3, teamAGames in {0,1,2}"
    return {
        "date": date_val,
        "teamAPlayer1Id": p1 if p1.startswith("SQUASH#") else f"SQUASH#PLAYER#{p1}",
        "teamAPlayer2Id": p2 if p2.startswith("SQUASH#") else f"SQUASH#PLAYER#{p2}",
        "teamBPlayer1Id": p3 if p3.startswith("SQUASH#") else f"SQUASH#PLAYER#{p3}",
        "teamBPlayer2Id": p4 if p4.startswith("SQUASH#") else f"SQUASH#PLAYER#{p4}",
        "winningTeam": win,
        "teamAGames": g_a,
        "teamBGames": g_b,
    }, None


def createSquashMatch(event):
    """POST /squash/matches - Create squash match (Squash modify required)."""
    _, err = _requireSquashModify(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        import uuid
        from datetime import datetime
        body = json.loads(event.get("body", "{}"))
        validated, err_msg = _validateSquashMatchBody(body)
        if err_msg:
            return jsonResponse({"error": err_msg}, 400)
        match_id = str(uuid.uuid4())
        pk = f"SQUASH#MATCH#{match_id}"
        now = datetime.utcnow().isoformat() + "Z"
        dynamodb = boto3.client("dynamodb")
        item = {
            "PK": {"S": pk},
            "SK": {"S": "METADATA"},
            "date": {"S": validated["date"]},
            "squashDate": {"S": validated["date"]},
            "matchId": {"S": pk},
            "teamAPlayer1Id": {"S": validated["teamAPlayer1Id"]},
            "teamAPlayer2Id": {"S": validated["teamAPlayer2Id"]},
            "teamBPlayer1Id": {"S": validated["teamBPlayer1Id"]},
            "teamBPlayer2Id": {"S": validated["teamBPlayer2Id"]},
            "winningTeam": {"S": validated["winningTeam"]},
            "teamAGames": {"N": str(validated["teamAGames"])},
            "teamBGames": {"N": str(validated["teamBGames"])},
            "entityType": {"S": "SQUASH_MATCH"},
            "entitySk": {"S": pk},
            "createdAt": {"S": now},
            "updatedAt": {"S": now},
        }
        dynamodb.put_item(TableName=TABLE_NAME, Item=item)
        for player_pk in [validated["teamAPlayer1Id"], validated["teamAPlayer2Id"], validated["teamBPlayer1Id"], validated["teamBPlayer2Id"]]:
            dynamodb.put_item(
                TableName=TABLE_NAME,
                Item={
                    "PK": {"S": player_pk},
                    "SK": {"S": f"MATCH#{pk}"},
                    "matchId": {"S": pk},
                    "squashDate": {"S": validated["date"]},
                },
            )
        return jsonResponse({"id": pk, "date": validated["date"]}, 201)
    except Exception as e:
        logger.exception("createSquashMatch error")
        return jsonResponse({"error": str(e)}, 500)


def updateSquashMatch(event):
    """PUT /squash/matches - Update squash match (Squash modify required)."""
    _, err = _requireSquashModify(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        from datetime import datetime
        body = json.loads(event.get("body", "{}"))
        raw_id = (body.get("id") or "").strip()
        pk = raw_id if raw_id.startswith("SQUASH#MATCH#") else f"SQUASH#MATCH#{raw_id}"
        if not pk or pk == "SQUASH#MATCH#":
            return jsonResponse({"error": "id is required"}, 400)
        validated, err_msg = _validateSquashMatchBody(body)
        if err_msg:
            return jsonResponse({"error": err_msg}, 400)
        now = datetime.utcnow().isoformat() + "Z"
        dynamodb = boto3.client("dynamodb")
        resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": pk}, "SK": {"S": "METADATA"}},
        )
        if "Item" not in resp:
            return jsonResponse({"error": "Match not found"}, 404)
        old = _dynamoItemToDict(resp["Item"])
        old_players = [old.get("teamAPlayer1Id"), old.get("teamAPlayer2Id"), old.get("teamBPlayer1Id"), old.get("teamBPlayer2Id")]
        for op in old_players:
            if op:
                dynamodb.delete_item(
                    TableName=TABLE_NAME,
                    Key={"PK": {"S": op}, "SK": {"S": f"MATCH#{pk}"}},
                )
        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": pk}, "SK": {"S": "METADATA"}},
            UpdateExpression="SET date = :d, squashDate = :d, teamAPlayer1Id = :p1, teamAPlayer2Id = :p2, teamBPlayer1Id = :p3, teamBPlayer2Id = :p4, winningTeam = :w, teamAGames = :ga, teamBGames = :gb, updatedAt = :now",
            ExpressionAttributeValues={
                ":d": {"S": validated["date"]},
                ":p1": {"S": validated["teamAPlayer1Id"]},
                ":p2": {"S": validated["teamAPlayer2Id"]},
                ":p3": {"S": validated["teamBPlayer1Id"]},
                ":p4": {"S": validated["teamBPlayer2Id"]},
                ":w": {"S": validated["winningTeam"]},
                ":ga": {"N": str(validated["teamAGames"])},
                ":gb": {"N": str(validated["teamBGames"])},
                ":now": {"S": now},
            },
        )
        for player_pk in [validated["teamAPlayer1Id"], validated["teamAPlayer2Id"], validated["teamBPlayer1Id"], validated["teamBPlayer2Id"]]:
            dynamodb.put_item(
                TableName=TABLE_NAME,
                Item={
                    "PK": {"S": player_pk},
                    "SK": {"S": f"MATCH#{pk}"},
                    "matchId": {"S": pk},
                    "squashDate": {"S": validated["date"]},
                },
            )
        return jsonResponse({"id": pk, "updated": True}, 200)
    except Exception as e:
        logger.exception("updateSquashMatch error")
        return jsonResponse({"error": str(e)}, 500)


def deleteSquashMatch(event):
    """DELETE /squash/matches?id=xxx - Delete squash match (Squash modify required)."""
    _, err = _requireSquashModify(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        qs = event.get("queryStringParameters") or {}
        raw_id = (qs.get("id") or "").strip()
        pk = raw_id if raw_id.startswith("SQUASH#MATCH#") else f"SQUASH#MATCH#{raw_id}"
        if not pk or pk == "SQUASH#MATCH#":
            return jsonResponse({"error": "id is required"}, 400)
        dynamodb = boto3.client("dynamodb")
        resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": pk}, "SK": {"S": "METADATA"}},
        )
        if "Item" not in resp:
            return jsonResponse({"error": "Match not found"}, 404)
        old = _dynamoItemToDict(resp["Item"])
        old_players = [old.get("teamAPlayer1Id"), old.get("teamAPlayer2Id"), old.get("teamBPlayer1Id"), old.get("teamBPlayer2Id")]
        dynamodb.delete_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": pk}, "SK": {"S": "METADATA"}},
        )
        for op in old_players:
            if op:
                dynamodb.delete_item(
                    TableName=TABLE_NAME,
                    Key={"PK": {"S": op}, "SK": {"S": f"MATCH#{pk}"}},
                )
        return jsonResponse({"id": pk, "deleted": True}, 200)
    except Exception as e:
        logger.exception("deleteSquashMatch error")
        return jsonResponse({"error": str(e)}, 500)


# ------------------------------------------------------------------------------
# Admin user & group management
# ------------------------------------------------------------------------------

def listAdminUsers(event):
    """GET /admin/users - List Cognito users (SuperAdmin or Manager)."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err
    if not COGNITO_USER_POOL_ID:
        return jsonResponse({"error": "COGNITO_USER_POOL_ID not set"}, 500)
    try:
        import boto3
        cognito = boto3.client("cognito-idp")
        qs = event.get("queryStringParameters") or {}
        try:
            limit = min(int(qs.get("limit", 60)), 60)
        except (TypeError, ValueError):
            limit = 60
        token = qs.get("paginationToken", "")

        kwargs = {
            "UserPoolId": COGNITO_USER_POOL_ID,
            "Limit": limit,
        }
        if token:
            kwargs["PaginationToken"] = token

        result = cognito.list_users(**kwargs)
        users = []
        for u in result.get("Users", []):
            attrs = {a["Name"]: a["Value"] for a in u.get("Attributes", [])}
            sub = attrs.get("sub", "")
            email = attrs.get("email", attrs.get("sub", u.get("Username", "")))
            users.append({
                "username": u.get("Username"),
                "email": email,
                "sub": sub,
                "status": u.get("UserStatus"),
                "enabled": u.get("Enabled", True),
            })
        if TABLE_NAME and users:
            subs = [u["sub"] for u in users if u.get("sub")]
            if subs:
                try:
                    dynamodb = boto3.client("dynamodb")
                    keys = [{"PK": {"S": f"USER#{s}"}, "SK": {"S": "PROFILE"}} for s in subs]
                    batch = dynamodb.batch_get_item(
                        RequestItems={
                            TABLE_NAME: {"Keys": keys, "ProjectionExpression": "PK, lastLoginAt, lastLoginIp"},
                        },
                    )
                    items = batch.get("Responses", {}).get(TABLE_NAME, [])
                    sub_to_login = {}
                    for it in items:
                        pk = it.get("PK", {}).get("S", "")
                        if pk.startswith("USER#"):
                            sub = pk[5:]
                            sub_to_login[sub] = {
                                "lastLoginAt": it.get("lastLoginAt", {}).get("S", ""),
                                "lastLoginIp": it.get("lastLoginIp", {}).get("S", ""),
                            }
                    for u in users:
                        login = sub_to_login.get(u.get("sub", ""), {})
                        u["lastLoginAt"] = login.get("lastLoginAt", "")
                        u["lastLoginIp"] = login.get("lastLoginIp", "")
                except Exception:
                    for u in users:
                        u["lastLoginAt"] = ""
                        u["lastLoginIp"] = ""
        else:
            for u in users:
                u["lastLoginAt"] = ""
                u["lastLoginIp"] = ""
        out = {"users": users}
        if result.get("PaginationToken"):
            out["paginationToken"] = result["PaginationToken"]
        return jsonResponse(out)
    except Exception as e:
        logger.exception("listAdminUsers error")
        return jsonResponse({"error": str(e)}, 500)


def _getUserCustomGroups(user_id):
    """Fetch user's custom group memberships from DynamoDB."""
    # #region agent log
    import json
    try:
        with open('/Users/adam/Github/EchoNin9/funkedupshift/.cursor/debug.log', 'a') as f:
            f.write(json.dumps({"id":"log_getcustomgroups_entry","timestamp":int(__import__('time').time()*1000),"location":"handler.py:2361","message":"_getUserCustomGroups called","data":{"userId":user_id,"tableName":TABLE_NAME if 'TABLE_NAME' in globals() else None},"runId":"run1","hypothesisId":"B"}) + '\n')
    except: pass
    # #endregion
    if not TABLE_NAME or not user_id:
        # #region agent log
        try:
            with open('/Users/adam/Github/EchoNin9/funkedupshift/.cursor/debug.log', 'a') as f:
                f.write(json.dumps({"id":"log_getcustomgroups_empty","timestamp":int(__import__('time').time()*1000),"location":"handler.py:2364","message":"_getUserCustomGroups early return","data":{"userId":user_id,"hasTable":bool(TABLE_NAME)},"runId":"run1","hypothesisId":"B"}) + '\n')
        except: pass
        # #endregion
        return []
    try:
        import boto3
        dynamodb = boto3.client("dynamodb")
        pk = f"USER#{user_id}"
        # #region agent log
        try:
            with open('/Users/adam/Github/EchoNin9/funkedupshift/.cursor/debug.log', 'a') as f:
                f.write(json.dumps({"id":"log_getcustomgroups_query","timestamp":int(__import__('time').time()*1000),"location":"handler.py:2369","message":"_getUserCustomGroups querying","data":{"pk":pk},"runId":"run1","hypothesisId":"B"}) + '\n')
        except: pass
        # #endregion
        result = dynamodb.query(
            TableName=TABLE_NAME,
            KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues={
                ":pk": {"S": pk},
                ":sk": {"S": "MEMBERSHIP#"},
            },
        )
        # #region agent log
        try:
            with open('/Users/adam/Github/EchoNin9/funkedupshift/.cursor/debug.log', 'a') as f:
                f.write(json.dumps({"id":"log_getcustomgroups_result","timestamp":int(__import__('time').time()*1000),"location":"handler.py:2377","message":"_getUserCustomGroups query result","data":{"itemCount":len(result.get("Items",[])),"items":result.get("Items",[])},"runId":"run1","hypothesisId":"B"}) + '\n')
        except: pass
        # #endregion
        groups = []
        for item in result.get("Items", []):
            group_name = item.get("groupName", {}).get("S", "")
            if group_name:
                groups.append(group_name)
        # #region agent log
        try:
            with open('/Users/adam/Github/EchoNin9/funkedupshift/.cursor/debug.log', 'a') as f:
                f.write(json.dumps({"id":"log_getcustomgroups_return","timestamp":int(__import__('time').time()*1000),"location":"handler.py:2382","message":"_getUserCustomGroups returning","data":{"groups":groups,"squashInGroups":"Squash" in groups},"runId":"run1","hypothesisId":"B"}) + '\n')
        except: pass
        # #endregion
        return groups
    except Exception as e:
        # #region agent log
        try:
            with open('/Users/adam/Github/EchoNin9/funkedupshift/.cursor/debug.log', 'a') as f:
                f.write(json.dumps({"id":"log_getcustomgroups_error","timestamp":int(__import__('time').time()*1000),"location":"handler.py:2383","message":"_getUserCustomGroups error","data":{"error":str(e)},"runId":"run1","hypothesisId":"B"}) + '\n')
        except: pass
        # #endregion
        return []


def _canAccessSquash(user):
    """User can view Squash section: in Squash custom group OR SuperAdmin."""
    if not user.get("userId"):
        return False
    if "admin" in user.get("groups", []):
        return True
    custom = _getUserCustomGroups(user["userId"])
    return "Squash" in custom


def _canModifySquash(user):
    """User can add/edit/delete: SuperAdmin OR (Manager AND in Squash group)."""
    if not user.get("userId"):
        return False
    if "admin" in user.get("groups", []):
        return True
    if "manager" not in user.get("groups", []):
        return False
    custom = _getUserCustomGroups(user["userId"])
    return "Squash" in custom


def _canAccessFinancial(user):
    """Financial view is public (guests, users, managers, superadmins). Kept for backward compat."""
    return True


def _canAccessFinancialAdmin(user):
    """User can admin Financial: SuperAdmin only."""
    if not user.get("userId"):
        return False
    return "admin" in user.get("groups", [])


def getUserGroups(event, username):
    """GET /admin/users/{username}/groups - Get user's Cognito + custom groups."""
    user, err = _requireManagerOrAdmin(event)
    if err:
        return err
    if not COGNITO_USER_POOL_ID:
        return jsonResponse({"error": "COGNITO_USER_POOL_ID not set"}, 500)
    try:
        import boto3
        cognito = boto3.client("cognito-idp")
        resp = cognito.admin_list_groups_for_user(
            UserPoolId=COGNITO_USER_POOL_ID,
            Username=username,
        )
        cognito_groups = [g.get("GroupName", "") for g in resp.get("Groups", []) if g.get("GroupName")]
        user_resp = cognito.admin_get_user(
            UserPoolId=COGNITO_USER_POOL_ID,
            Username=username,
        )
        attrs = {a["Name"]: a["Value"] for a in user_resp.get("UserAttributes", [])}
        sub = attrs.get("sub", "")
        custom_groups = _getUserCustomGroups(sub) if sub else []
        login = _getUserLastLogin(sub) if sub else {}
        return jsonResponse({
            "username": username,
            "sub": sub,
            "cognitoGroups": cognito_groups,
            "customGroups": custom_groups,
            "lastLoginAt": login.get("lastLoginAt", ""),
            "lastLoginIp": login.get("lastLoginIp", ""),
        })
    except Exception as e:
        if "UserNotFoundException" in str(type(e).__name__) or "UserNotFoundException" in str(e):
            return jsonResponse({"error": "User not found"}, 404)
        logger.exception("getUserGroups error")
        return jsonResponse({"error": str(e)}, 500)


def addUserToGroup(event, username):
    """POST /admin/users/{username}/groups - Add user to group (body: {groupName})."""
    user, err = _requireManagerOrAdmin(event)
    if err:
        return err
    try:
        body = json.loads(event.get("body", "{}"))
        group_name = (body.get("groupName") or "").strip()
        if not group_name:
            return jsonResponse({"error": "groupName is required"}, 400)

        cognito_system_groups = {"admin", "manager", "user"}
        if group_name == "admin" and not _canModifyAdminGroup(user):
            return jsonResponse({"error": "Forbidden: only SuperAdmin can add users to admin group"}, 403)
        if group_name == "manager" and not _canModifyAdminGroup(user):
            return jsonResponse({"error": "Forbidden: only SuperAdmin can add users to manager group"}, 403)
        if group_name == "user" and "admin" not in user.get("groups", []) and "manager" not in user.get("groups", []):
            return jsonResponse({"error": "Forbidden"}, 403)

        if not COGNITO_USER_POOL_ID:
            return jsonResponse({"error": "COGNITO_USER_POOL_ID not set"}, 500)

        if group_name in cognito_system_groups:
            import boto3
            cognito = boto3.client("cognito-idp")
            cognito.admin_add_user_to_group(
                UserPoolId=COGNITO_USER_POOL_ID,
                Username=username,
                GroupName=group_name,
            )
            return jsonResponse({"username": username, "groupName": group_name, "added": True}, 200)
        else:
            if "admin" not in user.get("groups", []) and "manager" not in user.get("groups", []):
                return jsonResponse({"error": "Forbidden"}, 403)
            if not TABLE_NAME:
                return jsonResponse({"error": "TABLE_NAME not set"}, 500)
            import boto3
            from datetime import datetime
            cognito = boto3.client("cognito-idp")
            dynamodb = boto3.client("dynamodb")
            user_resp = cognito.admin_get_user(
                UserPoolId=COGNITO_USER_POOL_ID,
                Username=username,
            )
            attrs = {a["Name"]: a["Value"] for a in user_resp.get("UserAttributes", [])}
            sub = attrs.get("sub", "")
            if not sub:
                return jsonResponse({"error": "User sub not found"}, 400)
            group_check = dynamodb.get_item(
                TableName=TABLE_NAME,
                Key={"PK": {"S": f"GROUP#{group_name}"}, "SK": {"S": "METADATA"}},
            )
            if "Item" not in group_check:
                return jsonResponse({"error": f"Custom group '{group_name}' not found"}, 404)
            now = datetime.utcnow().isoformat() + "Z"
            dynamodb.put_item(
                TableName=TABLE_NAME,
                Item={
                    "PK": {"S": f"USER#{sub}"},
                    "SK": {"S": f"MEMBERSHIP#{group_name}"},
                    "groupName": {"S": group_name},
                    "userId": {"S": sub},
                    "addedAt": {"S": now},
                    "addedBy": {"S": user.get("userId", "")},
                },
            )
            return jsonResponse({"username": username, "groupName": group_name, "added": True}, 200)
    except Exception as e:
        if "UserNotFoundException" in str(type(e).__name__) or "UserNotFoundException" in str(e):
            return jsonResponse({"error": "User not found"}, 404)
        logger.exception("addUserToGroup error")
        return jsonResponse({"error": str(e)}, 500)


def deleteAdminUser(event, username):
    """DELETE /admin/users/{username} - Delete user from Cognito and DynamoDB (SuperAdmin only)."""
    _, err = _requireSuperAdmin(event)
    if err:
        return err
    if not COGNITO_USER_POOL_ID:
        return jsonResponse({"error": "COGNITO_USER_POOL_ID not set"}, 500)
    try:
        import boto3
        cognito = boto3.client("cognito-idp")
        user_resp = cognito.admin_get_user(
            UserPoolId=COGNITO_USER_POOL_ID,
            Username=username,
        )
        attrs = {a["Name"]: a["Value"] for a in user_resp.get("UserAttributes", [])}
        sub = attrs.get("sub", "")
        cognito.admin_delete_user(
            UserPoolId=COGNITO_USER_POOL_ID,
            Username=username,
        )
        if TABLE_NAME and sub:
            dynamodb = boto3.client("dynamodb")
            items = dynamodb.query(
                TableName=TABLE_NAME,
                KeyConditionExpression="PK = :pk",
                ExpressionAttributeValues={":pk": {"S": f"USER#{sub}"}},
            )
            for item in items.get("Items", []):
                pk = item.get("PK", {}).get("S", "")
                sk = item.get("SK", {}).get("S", "")
                if pk and sk:
                    dynamodb.delete_item(
                        TableName=TABLE_NAME,
                        Key={"PK": {"S": pk}, "SK": {"S": sk}},
                    )
        return jsonResponse({"deleted": True, "username": username}, 200)
    except Exception as e:
        if "UserNotFoundException" in str(type(e).__name__) or "UserNotFoundException" in str(e):
            return jsonResponse({"error": "User not found"}, 404)
        logger.exception("deleteAdminUser error")
        return jsonResponse({"error": str(e)}, 500)


def removeUserFromGroup(event, username, group_name):
    """DELETE /admin/users/{username}/groups/{groupName} - Remove user from group."""
    user, err = _requireManagerOrAdmin(event)
    if err:
        return err
    # Permission checks first (no Cognito needed) so we return 403 before 500 when pool not configured
    cognito_system_groups = {"admin", "manager", "user"}
    if group_name in cognito_system_groups:
        if group_name == "admin" and not _canModifyAdminGroup(user):
            return jsonResponse({"error": "Forbidden: only SuperAdmin can remove users from admin group"}, 403)
        if group_name == "manager" and not _canModifyAdminGroup(user):
            return jsonResponse({"error": "Forbidden: only SuperAdmin can remove users from manager group"}, 403)
    if not COGNITO_USER_POOL_ID:
        return jsonResponse({"error": "COGNITO_USER_POOL_ID not set"}, 500)
    try:
        if group_name in cognito_system_groups:
            import boto3
            cognito = boto3.client("cognito-idp")
            cognito.admin_remove_user_from_group(
                UserPoolId=COGNITO_USER_POOL_ID,
                Username=username,
                GroupName=group_name,
            )
            return jsonResponse({"username": username, "groupName": group_name, "removed": True}, 200)
        else:
            if not TABLE_NAME:
                return jsonResponse({"error": "TABLE_NAME not set"}, 500)
            import boto3
            cognito = boto3.client("cognito-idp")
            user_resp = cognito.admin_get_user(
                UserPoolId=COGNITO_USER_POOL_ID,
                Username=username,
            )
            attrs = {a["Name"]: a["Value"] for a in user_resp.get("UserAttributes", [])}
            sub = attrs.get("sub", "")
            if not sub:
                return jsonResponse({"error": "User sub not found"}, 400)
            dynamodb = boto3.client("dynamodb")
            dynamodb.delete_item(
                TableName=TABLE_NAME,
                Key={
                    "PK": {"S": f"USER#{sub}"},
                    "SK": {"S": f"MEMBERSHIP#{group_name}"},
                },
            )
            return jsonResponse({"username": username, "groupName": group_name, "removed": True}, 200)
    except Exception as e:
        if "UserNotFoundException" in str(type(e).__name__) or "UserNotFoundException" in str(e):
            return jsonResponse({"error": "User not found"}, 404)
        logger.exception("removeUserFromGroup error")
        return jsonResponse({"error": str(e)}, 500)


def listAdminGroups(event):
    """GET /admin/groups - List custom RBAC groups (DynamoDB)."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"groups": [], "error": "TABLE_NAME not set"}, 200)
    try:
        import boto3
        dynamodb = boto3.client("dynamodb")
        result = dynamodb.query(
            TableName=TABLE_NAME,
            IndexName="byEntity",
            KeyConditionExpression="entityType = :et",
            ExpressionAttributeValues={":et": {"S": "GROUP"}},
        )
        groups = []
        for item in result.get("Items", []):
            g = _dynamoItemToDict(item)
            g["name"] = g.get("name") or g.get("PK", "").replace("GROUP#", "")
            groups.append(g)
        groups.sort(key=lambda x: (x.get("name") or "").lower())
        return jsonResponse({"groups": groups})
    except Exception as e:
        logger.exception("listAdminGroups error")
        return jsonResponse({"error": str(e)}, 500)


def createAdminGroup(event):
    """POST /admin/groups - Create custom RBAC group."""
    user, err = _requireManagerOrAdmin(event)
    if err:
        return err
    try:
        import boto3
        import re
        from datetime import datetime
        body = json.loads(event.get("body", "{}"))
        name = (body.get("name") or "").strip()
        if not name:
            return jsonResponse({"error": "name is required"}, 400)
        if not TABLE_NAME:
            return jsonResponse({"error": "TABLE_NAME not set"}, 500)
        if not re.match(r"^[a-zA-Z0-9_-]+$", name):
            return jsonResponse({"error": "name must be alphanumeric, underscore, or hyphen"}, 400)
        description = (body.get("description") or "").strip()
        permissions = body.get("permissions", [])
        if isinstance(permissions, str):
            permissions = [p.strip() for p in permissions.split(",") if p.strip()]
        elif not isinstance(permissions, list):
            permissions = []
        now = datetime.utcnow().isoformat() + "Z"
        pk = f"GROUP#{name}"
        dynamodb = boto3.client("dynamodb")
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": pk},
                "SK": {"S": "METADATA"},
                "name": {"S": name},
                "description": {"S": description},
                "entityType": {"S": "GROUP"},
                "entitySk": {"S": pk},
                "permissions": {"L": [{"S": str(p)} for p in permissions]},
                "createdAt": {"S": now},
                "updatedAt": {"S": now},
            },
        )
        return jsonResponse({"name": name, "description": description, "permissions": permissions}, 201)
    except Exception as e:
        logger.exception("createAdminGroup error")
        return jsonResponse({"error": str(e)}, 500)


def updateAdminGroup(event, name):
    """PUT /admin/groups/{name} - Update custom group."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        from datetime import datetime
        body = json.loads(event.get("body", "{}"))
        description = body.get("description")
        permissions = body.get("permissions")
        now = datetime.utcnow().isoformat() + "Z"
        pk = f"GROUP#{name}"
        update_expr = ["updatedAt = :updatedAt"]
        names = {}
        values = {":updatedAt": {"S": now}}
        if description is not None:
            update_expr.append("#desc = :desc")
            names["#desc"] = "description"
            values[":desc"] = {"S": str(description)}
        if permissions is not None:
            perms = permissions if isinstance(permissions, list) else []
            if isinstance(permissions, str):
                perms = [p.strip() for p in permissions.split(",") if p.strip()]
            update_expr.append("permissions = :perms")
            values[":perms"] = {"L": [{"S": str(p)} for p in perms]}
        dynamodb = boto3.client("dynamodb")
        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": pk}, "SK": {"S": "METADATA"}},
            UpdateExpression="SET " + ", ".join(update_expr),
            ExpressionAttributeNames=names or None,
            ExpressionAttributeValues=values,
        )
        return jsonResponse({"name": name, "updated": True}, 200)
    except Exception as e:
        logger.exception("updateAdminGroup error")
        return jsonResponse({"error": str(e)}, 500)


def deleteAdminGroup(event, name):
    """DELETE /admin/groups/{name} - Delete custom group."""
    _, err = _requireManagerOrAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        dynamodb = boto3.client("dynamodb")
        pk = f"GROUP#{name}"
        dynamodb.delete_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": pk}, "SK": {"S": "METADATA"}},
        )
        return jsonResponse({"name": name, "deleted": True}, 200)
    except Exception as e:
        logger.exception("deleteAdminGroup error")
        return jsonResponse({"error": str(e)}, 500)


# ------------------------------------------------------------------------------
# Admin roles (SuperAdmin only): named combinations of cognito + custom groups
# ------------------------------------------------------------------------------

def listAdminRoles(event):
    """GET /admin/roles - List defined roles (SuperAdmin only)."""
    _, err = _requireSuperAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"roles": [], "error": "TABLE_NAME not set"}, 200)
    try:
        import boto3
        dynamodb = boto3.client("dynamodb")
        result = dynamodb.query(
            TableName=TABLE_NAME,
            IndexName="byEntity",
            KeyConditionExpression="entityType = :et",
            ExpressionAttributeValues={":et": {"S": "ROLE"}},
        )
        roles = []
        for item in result.get("Items", []):
            r = _dynamoItemToDict(item)
            r["name"] = r.get("name") or r.get("PK", "").replace("ROLE#", "")
            roles.append(r)
        roles.sort(key=lambda x: (x.get("name") or "").lower())
        return jsonResponse({"roles": roles})
    except Exception as e:
        logger.exception("listAdminRoles error")
        return jsonResponse({"error": str(e)}, 500)


def createAdminRole(event):
    """POST /admin/roles - Create a named role (SuperAdmin only)."""
    _, err = _requireSuperAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        import re
        from datetime import datetime
        body = json.loads(event.get("body", "{}"))
        name = (body.get("name") or "").strip()
        if not name:
            return jsonResponse({"error": "name is required"}, 400)
        if not re.match(r"^[a-zA-Z0-9_-]+$", name):
            return jsonResponse({"error": "name must be alphanumeric, underscore, or hyphen"}, 400)
        cognito_groups = body.get("cognitoGroups", [])
        custom_groups = body.get("customGroups", [])
        if not isinstance(cognito_groups, list):
            cognito_groups = [cognito_groups] if cognito_groups else []
        if not isinstance(custom_groups, list):
            custom_groups = [custom_groups] if custom_groups else []
        cognito_groups = [str(g).strip() for g in cognito_groups if str(g).strip()]
        custom_groups = [str(g).strip() for g in custom_groups if str(g).strip()]
        now = datetime.utcnow().isoformat() + "Z"
        pk = f"ROLE#{name}"
        dynamodb = boto3.client("dynamodb")
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": pk},
                "SK": {"S": "METADATA"},
                "name": {"S": name},
                "cognitoGroups": {"L": [{"S": g} for g in cognito_groups]},
                "customGroups": {"L": [{"S": g} for g in custom_groups]},
                "entityType": {"S": "ROLE"},
                "entitySk": {"S": pk},
                "createdAt": {"S": now},
                "updatedAt": {"S": now},
            },
        )
        return jsonResponse({"name": name, "cognitoGroups": cognito_groups, "customGroups": custom_groups}, 201)
    except Exception as e:
        logger.exception("createAdminRole error")
        return jsonResponse({"error": str(e)}, 500)


def updateAdminRole(event, name):
    """PUT /admin/roles/{name} - Update a role (SuperAdmin only)."""
    _, err = _requireSuperAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        from datetime import datetime
        body = json.loads(event.get("body", "{}"))
        cognito_groups = body.get("cognitoGroups")
        custom_groups = body.get("customGroups")
        now = datetime.utcnow().isoformat() + "Z"
        pk = f"ROLE#{name}"
        update_expr = ["updatedAt = :now"]
        values = {":now": {"S": now}}
        if cognito_groups is not None:
            cg = cognito_groups if isinstance(cognito_groups, list) else []
            cg = [str(g).strip() for g in cg if str(g).strip()]
            update_expr.append("cognitoGroups = :cg")
            values[":cg"] = {"L": [{"S": g} for g in cg]}
        if custom_groups is not None:
            cug = custom_groups if isinstance(custom_groups, list) else []
            cug = [str(g).strip() for g in cug if str(g).strip()]
            update_expr.append("customGroups = :cug")
            values[":cug"] = {"L": [{"S": g} for g in cug]}
        dynamodb = boto3.client("dynamodb")
        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": pk}, "SK": {"S": "METADATA"}},
            UpdateExpression="SET " + ", ".join(update_expr),
            ExpressionAttributeValues=values,
        )
        return jsonResponse({"name": name, "updated": True}, 200)
    except Exception as e:
        logger.exception("updateAdminRole error")
        return jsonResponse({"error": str(e)}, 500)


def deleteAdminRole(event, name):
    """DELETE /admin/roles/{name} - Delete a role (SuperAdmin only)."""
    _, err = _requireSuperAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3
        dynamodb = boto3.client("dynamodb")
        pk = f"ROLE#{name}"
        dynamodb.delete_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": pk}, "SK": {"S": "METADATA"}},
        )
        return jsonResponse({"name": name, "deleted": True}, 200)
    except Exception as e:
        logger.exception("deleteAdminRole error")
        return jsonResponse({"error": str(e)}, 500)
