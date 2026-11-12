"""In-memory KMS + DEK-table fakes for finance encryption tests (FUNK-78). No AWS."""
import os

from botocore.exceptions import ClientError

KEY_ARN = "arn:aws:kms:us-east-1:111122223333:key/test-key"


class FakeKMS:
    def __init__(self):
        self.generate_calls = []
        self.decrypt_calls = []
        self._n = 0

    def generate_data_key(self, KeyId, KeySpec, EncryptionContext):
        assert KeySpec == "AES_256"
        assert EncryptionContext.get("purpose") == "fus-finances"
        self.generate_calls.append((KeyId, dict(EncryptionContext)))
        self._n += 1
        plaintext = bytes([self._n % 256]) * 32  # distinct, deterministic per call
        blob = b"wrapped:" + plaintext + b":" + EncryptionContext["userId"].encode()
        return {"Plaintext": plaintext, "CiphertextBlob": blob}

    def decrypt(self, CiphertextBlob, EncryptionContext):
        self.decrypt_calls.append((CiphertextBlob, dict(EncryptionContext)))
        assert EncryptionContext.get("purpose") == "fus-finances"
        tag, plaintext, user = CiphertextBlob.split(b":", 2)
        if EncryptionContext["userId"].encode() != user:
            raise ClientError({"Error": {"Code": "InvalidCiphertextException"}}, "Decrypt")
        return {"Plaintext": plaintext}


class FakeDekTable:
    """Just enough DynamoDB for the DEK item: get_item / put_item with attribute_not_exists."""

    def __init__(self):
        self.items = {}
        self.put_calls = []

    def get_item(self, TableName, Key):
        item = self.items.get((Key["PK"]["S"], Key["SK"]["S"]))
        return {"Item": item} if item else {}

    def put_item(self, TableName, Item, ConditionExpression=None):
        key = (Item["PK"]["S"], Item["SK"]["S"])
        self.put_calls.append(Item)
        if ConditionExpression == "attribute_not_exists(PK)" and key in self.items:
            raise ClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, "PutItem")
        self.items[key] = Item


def install(monkeypatch):
    """Patch bpf_crypto onto fakes; returns (kms, dek_table)."""
    from api import bpf_crypto
    kms, table = FakeKMS(), FakeDekTable()
    monkeypatch.setenv("FINANCE_KMS_KEY_ID", KEY_ARN)
    monkeypatch.setattr(bpf_crypto, "_kms", lambda: kms)
    monkeypatch.setattr(bpf_crypto, "_ddb", lambda: table)
    monkeypatch.setattr(bpf_crypto, "_dek_cache", {})
    return kms, table
