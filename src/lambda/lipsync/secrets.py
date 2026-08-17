"""
SSM Parameter Store access for lipsync provider credentials.

    /funkedupshift/lipsync/fal/api-key   (SecureString)

Set manually by the repo owner -- NOT committed, NOT created by Terraform
(infra/lipsync.tf grants only the IAM read permission, scoped to the
/funkedupshift/lipsync/* prefix). A module-level cache avoids re-hitting SSM
on every call within one warm Lambda container. Mirrors social/secrets.py.
"""
import logging

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

_ssm = None
_cache: dict = {}


class SecretNotFoundError(Exception):
    """Raised when a required SSM parameter does not exist, or exists but is
    empty. Callers turn this into a clear, typed, user-safe error rather
    than letting a raw botocore exception (or a stack trace) reach the
    client -- see runner._userSafe."""


def _client():
    global _ssm
    if _ssm is None:
        import boto3
        _ssm = boto3.client("ssm")
    return _ssm


def getParameter(name, decrypt=True):
    """Fetch an SSM parameter by name, cached for the life of the container.

    Raises SecretNotFoundError (not a raw botocore exception) if the
    parameter does not exist or exists but is blank -- a blank SecureString
    is indistinguishable from "never configured" and must fail the same
    typed way, not proceed with an empty API key.
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
    if not value:
        raise SecretNotFoundError(f"SSM parameter is empty: {name}")
    _cache[cacheKey] = value
    return value


FAL_API_KEY_PARAM = "/funkedupshift/lipsync/fal/api-key"


def getFalApiKey():
    """Return the fal.ai API key. Raises SecretNotFoundError (typed, no
    stack trace, no raw botocore exception) if it isn't configured yet --
    see docs/lipsync-design.md's Credentials section: this parameter is set
    manually, so a fresh deploy legitimately has it missing until someone
    does that."""
    return getParameter(FAL_API_KEY_PARAM, decrypt=True)
