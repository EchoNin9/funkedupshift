"""
Personal Finances field-level envelope encryption (FUNK-78).

Each user has one AES-256 data key (DEK) wrapped by the finances KMS key and
stored at PK USER#{id} / SK BPF#DEK. Sensitive attribute values are sealed with
AES-256-GCM (random 12-byte nonce) and stored as the string
"fe1:" + base64url(nonce || ciphertext+tag). The AAD is "{pk}|{sk}|{attr}", so a
ciphertext copied to another item or attribute fails authentication.

Readers accept legacy plaintext (N / S / L) so data can be migrated in place;
writers never store plaintext (a missing FINANCE_KMS_KEY_ID is an error).

Intentionally standalone: no imports from other api modules.
"""
import base64
import json
import os
from datetime import datetime, timezone
from decimal import Decimal

from botocore.exceptions import ClientError
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PREFIX = "fe1:"
PURPOSE = "fus-finances"
ALG = "AES-256-GCM"
DEK_SK = "BPF#DEK"

# ponytail: no TTL — a Lambda container lives at most hours, and KMS key
# rotation never requires re-encrypting data (the wrapped DEK stays decryptable).
_dek_cache = {}

_ddb_client = None
_kms_client = None


class FinanceCryptoError(Exception):
    """Encryption is misconfigured, or a value failed to decrypt/authenticate."""


def _table():
    return os.environ.get("TABLE_NAME", "")


def _key_id():
    return os.environ.get("FINANCE_KMS_KEY_ID", "")


def _ddb():
    global _ddb_client
    if _ddb_client is None:
        import boto3
        _ddb_client = boto3.client("dynamodb")
    return _ddb_client


def _kms():
    global _kms_client
    if _kms_client is None:
        import boto3
        _kms_client = boto3.client("kms")
    return _kms_client


def _ctx(user_id):
    return {"purpose": PURPOSE, "userId": user_id}


def _dek_key(user_id):
    return {"PK": {"S": f"USER#{user_id}"}, "SK": {"S": DEK_SK}}


def _unwrap(user_id, wrapped):
    resp = _kms().decrypt(CiphertextBlob=wrapped, EncryptionContext=_ctx(user_id))
    return resp["Plaintext"]


def _get_dek(user_id, create=True):
    """Plaintext DEK for the user, creating it on first write when `create`."""
    cached = _dek_cache.get(user_id)
    if cached:
        return cached
    resp = _ddb().get_item(TableName=_table(), Key=_dek_key(user_id))
    item = resp.get("Item")
    if not item:
        if not create:
            raise FinanceCryptoError("no data key for user")
        key_id = _key_id()
        if not key_id:
            raise FinanceCryptoError(
                "FINANCE_KMS_KEY_ID is not set; refusing to store finance data in plaintext")
        gen = _kms().generate_data_key(
            KeyId=key_id, KeySpec="AES_256", EncryptionContext=_ctx(user_id))
        new_item = {
            **_dek_key(user_id),
            "wrappedKey": {"B": gen["CiphertextBlob"]},
            "keyArn": {"S": key_id},
            "alg": {"S": ALG},
            "createdAt": {"S": datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"},
        }
        try:
            _ddb().put_item(TableName=_table(), Item=new_item,
                            ConditionExpression="attribute_not_exists(PK)")
            dek = gen["Plaintext"]
            _dek_cache[user_id] = dek
            return dek
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                raise
            # concurrent first write: use the winner's key
            item = _ddb().get_item(TableName=_table(), Key=_dek_key(user_id)).get("Item")
            if not item:
                raise FinanceCryptoError("data key vanished during creation race")
    dek = _unwrap(user_id, item["wrappedKey"]["B"])
    _dek_cache[user_id] = dek
    return dek


def _aad(pk, sk, attr):
    return f"{pk}|{sk}|{attr}".encode("utf-8")


def _b64e(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64d(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def encrypt_str(user_id, pk, sk, attr, plaintext):
    """Seal a string for (pk, sk, attr). Returns the "fe1:..." token."""
    dek = _get_dek(user_id, create=True)
    nonce = os.urandom(12)
    ct = AESGCM(dek).encrypt(nonce, str(plaintext).encode("utf-8"), _aad(pk, sk, attr))
    return PREFIX + _b64e(nonce + ct)


def decrypt_str(user_id, pk, sk, attr, token):
    """Open a token for (pk, sk, attr). Raises FinanceCryptoError on tamper/wrong AAD."""
    if not isinstance(token, str) or not token.startswith(PREFIX):
        raise FinanceCryptoError("not an encrypted finance value")
    try:
        raw = _b64d(token[len(PREFIX):])
        nonce, ct = raw[:12], raw[12:]
        dek = _get_dek(user_id, create=False)
        return AESGCM(dek).decrypt(nonce, ct, _aad(pk, sk, attr)).decode("utf-8")
    except (InvalidTag, ValueError) as e:
        raise FinanceCryptoError(
            f"finance value failed authentication ({attr} on {sk})") from e


def _jsonable(v):
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, float):
        return str(Decimal(str(v)))
    if isinstance(v, dict):
        return {k: _jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_jsonable(x) for x in v]
    return v


def enc_attr(user_id, pk, sk, attr, value):
    """Typed DynamoDB attribute {"S": token}. Numbers are stored as their decimal
    string; lists/maps as compact JSON (Decimals/floats as strings)."""
    if isinstance(value, bool):
        raise FinanceCryptoError("bool values are not encrypted")
    if isinstance(value, (int, float, Decimal)):
        text = str(Decimal(str(value)))
    elif isinstance(value, (list, dict, tuple)):
        text = json.dumps(_jsonable(value), separators=(",", ":"))
    else:
        text = str(value)
    return {"S": encrypt_str(user_id, pk, sk, attr, text)}


def is_encrypted(typed):
    return (isinstance(typed, dict) and isinstance(typed.get("S"), str)
            and typed["S"].startswith(PREFIX))


def _from_typed(t):
    if "S" in t:
        return t["S"]
    if "N" in t:
        return t["N"]
    if "BOOL" in t:
        return t["BOOL"]
    if "L" in t:
        return [_from_typed(x) for x in t["L"]]
    if "M" in t:
        return {k: _from_typed(x) for k, x in t["M"].items()}
    return None


def dec_attr(user_id, pk, sk, attr, typed):
    """Python value of a stored attribute. Encrypted -> the decrypted string
    (caller converts to float/json as before); legacy plaintext passes through:
    N -> number string, S -> string, L/M -> plain Python list/dict."""
    if is_encrypted(typed):
        return decrypt_str(user_id, pk, sk, attr, typed["S"])
    return _from_typed(typed)


def dec_json(user_id, pk, sk, attr, typed):
    """For list/map attributes: parsed JSON if encrypted, else the legacy list/map."""
    if is_encrypted(typed):
        return json.loads(decrypt_str(user_id, pk, sk, attr, typed["S"]))
    return _from_typed(typed)
