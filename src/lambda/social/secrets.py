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
