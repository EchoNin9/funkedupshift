"""
SSM Parameter Store access for social publisher credentials.

No secrets in code, no secrets in Lambda env vars — publishers pull
per-account credentials from SSM at call time. Naming convention:

    /funkedupshift/social/{platform}/{accountId}/app-password  (SecureString)
    /funkedupshift/social/{platform}/{accountId}/handle        (String)

A module-level cache avoids re-hitting SSM on every call within one warm
Lambda container (mirrors the era_client.py _cache pattern).
"""
import logging

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

_ssm = None
_cache: dict = {}


class SecretNotFoundError(Exception):
    """Raised when a required SSM parameter does not exist."""


def _client():
    global _ssm
    if _ssm is None:
        import boto3
        _ssm = boto3.client("ssm")
    return _ssm


def getParameter(name, decrypt=True):
    """Fetch an SSM parameter by name, cached for the life of the container.

    Raises SecretNotFoundError (not a raw botocore exception) if the
    parameter does not exist, so callers get a clear, typed error instead
    of a leaking ParameterNotFound.
    """
    cacheKey = (name, decrypt)
    if cacheKey in _cache:
        return _cache[cacheKey]

    from botocore.exceptions import ClientError

    try:
        resp = _client().get_parameter(Name=name, WithDecryption=decrypt)
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code == "ParameterNotFound":
            raise SecretNotFoundError(f"SSM parameter not found: {name}") from e
        logger.warning("SSM get_parameter %s failed: %s", name, e)
        raise

    value = resp["Parameter"]["Value"]
    _cache[cacheKey] = value
    return value


def getBlueskyCredentials(accountId):
    """Return (handle, appPassword) for a Bluesky account from SSM."""
    handle = getParameter(f"/funkedupshift/social/bluesky/{accountId}/handle", decrypt=False)
    appPassword = getParameter(f"/funkedupshift/social/bluesky/{accountId}/app-password", decrypt=True)
    return handle, appPassword


SOCIAL_PARAMS_PREFIX = "/funkedupshift/social/"


def listAccounts():
    """Enumerate configured social accounts from SSM (phase 4, GET /social/accounts).

    Derives platform + accountId from each parameter's path
    (/funkedupshift/social/{platform}/{accountId}/{leaf}) and only ever reads
    the VALUE of the "handle" leaf -- the "app-password" leaf's Value is
    never read here, so there is no code path in this function that could
    leak (or log) a credential even by accident.

    Requires ssm:GetParametersByPath (see infra/social.tf lambdaSocial policy).
    """
    accountsByKey = {}
    paginator = _client().get_paginator("get_parameters_by_path")
    for page in paginator.paginate(Path=SOCIAL_PARAMS_PREFIX, Recursive=True, WithDecryption=False):
        for param in page.get("Parameters", []):
            name = param.get("Name", "")
            relative = name[len(SOCIAL_PARAMS_PREFIX):] if name.startswith(SOCIAL_PARAMS_PREFIX) else name
            parts = [p for p in relative.split("/") if p]
            if len(parts) != 3:
                continue
            platform, accountId, leaf = parts
            key = (platform, accountId)
            entry = accountsByKey.setdefault(key, {"platform": platform, "accountId": accountId, "handle": ""})
            if leaf == "handle":
                entry["handle"] = param.get("Value", "")

    return sorted(accountsByKey.values(), key=lambda a: (a["platform"], a["accountId"]))
