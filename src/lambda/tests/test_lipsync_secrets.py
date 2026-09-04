"""Unit tests for lipsync/secrets.py (SSM access + module-level cache).
Mirrors social/secrets.py's test conventions."""
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _notFound():
    from botocore.exceptions import ClientError
    return ClientError({"Error": {"Code": "ParameterNotFound", "Message": "nf"}}, "GetParameter")


def _accessDenied():
    from botocore.exceptions import ClientError
    return ClientError({"Error": {"Code": "AccessDeniedException", "Message": "no"}}, "GetParameter")


def test_get_parameter_returns_value_and_caches():
    from lipsync import secrets

    client = MagicMock()
    client.get_parameter.return_value = {"Parameter": {"Value": "secret-value"}}

    with patch.object(secrets, "_cache", {}), patch.object(secrets, "_client", return_value=client):
        first = secrets.getParameter("/funkedupshift/lipsync/fal/api-key", decrypt=True)
        second = secrets.getParameter("/funkedupshift/lipsync/fal/api-key", decrypt=True)

    assert first == "secret-value"
    assert second == "secret-value"
    client.get_parameter.assert_called_once_with(
        Name="/funkedupshift/lipsync/fal/api-key", WithDecryption=True,
    )


def test_get_parameter_not_found_raises_typed_error_not_raw_client_error():
    from lipsync import secrets

    client = MagicMock()
    client.get_parameter.side_effect = _notFound()

    with patch.object(secrets, "_cache", {}), patch.object(secrets, "_client", return_value=client):
        try:
            secrets.getParameter("/funkedupshift/lipsync/fal/api-key")
            assert False, "expected SecretNotFoundError"
        except secrets.SecretNotFoundError as e:
            assert "/funkedupshift/lipsync/fal/api-key" in str(e)


def test_get_parameter_empty_value_raises_typed_error():
    from lipsync import secrets

    client = MagicMock()
    client.get_parameter.return_value = {"Parameter": {"Value": ""}}

    with patch.object(secrets, "_cache", {}), patch.object(secrets, "_client", return_value=client):
        try:
            secrets.getParameter("/funkedupshift/lipsync/fal/api-key")
            assert False, "expected SecretNotFoundError for a blank value"
        except secrets.SecretNotFoundError:
            pass


def test_get_parameter_other_client_error_reraises():
    from botocore.exceptions import ClientError
    from lipsync import secrets

    client = MagicMock()
    client.get_parameter.side_effect = _accessDenied()

    with patch.object(secrets, "_cache", {}), patch.object(secrets, "_client", return_value=client):
        try:
            secrets.getParameter("/funkedupshift/lipsync/fal/api-key")
            assert False, "expected ClientError to propagate"
        except ClientError as e:
            assert e.response["Error"]["Code"] == "AccessDeniedException"


def test_get_fal_api_key_happy_path():
    from lipsync import secrets

    client = MagicMock()
    client.get_parameter.return_value = {"Parameter": {"Value": "fal-key-xyz"}}

    with patch.object(secrets, "_cache", {}), patch.object(secrets, "_client", return_value=client):
        key = secrets.getFalApiKey()

    assert key == "fal-key-xyz"
    assert client.get_parameter.call_args.kwargs["Name"] == secrets.FAL_API_KEY_PARAM


def test_get_fal_api_key_missing_raises_secret_not_found():
    from lipsync import secrets

    client = MagicMock()
    client.get_parameter.side_effect = _notFound()

    with patch.object(secrets, "_cache", {}), patch.object(secrets, "_client", return_value=client):
        try:
            secrets.getFalApiKey()
            assert False, "expected SecretNotFoundError"
        except secrets.SecretNotFoundError:
            pass


def test_get_parameter_cache_is_keyed_by_name_and_decrypt_flag():
    """A (name, decrypt=False) read and a (name, decrypt=True) read for the
    same parameter name must not share a cache slot -- collapsing them
    could serve an undecrypted SecureString value where a decrypted one was
    requested."""
    from lipsync import secrets

    client = MagicMock()
    client.get_parameter.side_effect = [
        {"Parameter": {"Value": "encrypted-form"}},
        {"Parameter": {"Value": "decrypted-form"}},
    ]

    with patch.object(secrets, "_cache", {}), patch.object(secrets, "_client", return_value=client):
        undecrypted = secrets.getParameter("/funkedupshift/lipsync/fal/api-key", decrypt=False)
        decrypted = secrets.getParameter("/funkedupshift/lipsync/fal/api-key", decrypt=True)

    assert undecrypted == "encrypted-form"
    assert decrypted == "decrypted-form"
    assert client.get_parameter.call_count == 2
