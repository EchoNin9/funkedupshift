"""Unit tests for finance field encryption (FUNK-78, api/bpf_crypto.py). Fake KMS, no AWS."""
import sys
from decimal import Decimal
from pathlib import Path

import pytest
from botocore.exceptions import ClientError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api import bpf_crypto as c  # noqa: E402
from tests import fake_kms  # noqa: E402

PK, SK = "USER#u1", "BPF#TXN#2026-07-01#abc"


def test_round_trip_and_format():
    tok = c.encrypt_str("u1", PK, SK, "payee", "Blue Bottle Coffee")
    assert tok.startswith("fe1:") and "Blue Bottle" not in tok
    assert c.decrypt_str("u1", PK, SK, "payee", tok) == "Blue Bottle Coffee"
    # random nonce: same plaintext never yields the same token
    assert tok != c.encrypt_str("u1", PK, SK, "payee", "Blue Bottle Coffee")


def test_unicode_and_empty_round_trip():
    for text in ("", "Café ☕ 日本"):
        tok = c.encrypt_str("u1", PK, SK, "notes", text)
        assert c.decrypt_str("u1", PK, SK, "notes", tok) == text


def test_tamper_fails():
    tok = c.encrypt_str("u1", PK, SK, "payee", "x")
    raw = bytearray(c._b64d(tok[4:]))
    raw[-1] ^= 1
    bad = "fe1:" + c._b64e(bytes(raw))
    with pytest.raises(c.FinanceCryptoError):
        c.decrypt_str("u1", PK, SK, "payee", bad)
    with pytest.raises(c.FinanceCryptoError):
        c.decrypt_str("u1", PK, SK, "payee", "fe1:!!notbase64")
    with pytest.raises(c.FinanceCryptoError):
        c.decrypt_str("u1", PK, SK, "payee", "plain")


def test_aad_swap_fails():
    tok = c.encrypt_str("u1", PK, SK, "payee", "secret")
    with pytest.raises(c.FinanceCryptoError):
        c.decrypt_str("u1", PK, "BPF#TXN#2026-07-01#other", "payee", tok)  # other SK
    with pytest.raises(c.FinanceCryptoError):
        c.decrypt_str("u1", PK, SK, "notes", tok)  # other attribute
    with pytest.raises(c.FinanceCryptoError):
        c.decrypt_str("u1", "USER#u2", SK, "payee", tok)  # other PK


def test_enc_attr_numbers_and_json_have_no_floats():
    t = c.enc_attr("u1", PK, SK, "amount", 12.3)
    assert set(t) == {"S"} and c.is_encrypted(t)
    assert c.dec_attr("u1", PK, SK, "amount", t) == "12.3"
    t = c.enc_attr("u1", PK, SK, "amount", Decimal("-4.50"))
    assert c.dec_attr("u1", PK, SK, "amount", t) == "-4.50"
    t = c.enc_attr("u1", PK, "BPF#BUDGETS", "budgets",
                   [{"category": "Dining", "monthlyLimit": 250.5}])
    assert c.dec_json("u1", PK, "BPF#BUDGETS", "budgets", t) == [
        {"category": "Dining", "monthlyLimit": "250.5"}]


def test_legacy_plaintext_passthrough():
    assert c.dec_attr("u1", PK, SK, "amount", {"N": "-12.5"}) == "-12.5"
    assert c.dec_attr("u1", PK, SK, "payee", {"S": "Legacy Payee"}) == "Legacy Payee"
    assert c.dec_attr("u1", PK, "BPF#SETTINGS", "categories",
                      {"L": [{"S": "A"}, {"S": "B"}]}) == ["A", "B"]
    assert c.dec_json("u1", PK, "BPF#BUDGETS", "budgets", {"L": [
        {"M": {"category": {"S": "X"}, "monthlyLimit": {"N": "5"}}}]}) == [
        {"category": "X", "monthlyLimit": "5"}]
    assert not c.is_encrypted({"S": "plain"}) and not c.is_encrypted({"N": "1"})


def test_dek_cached_per_user(monkeypatch):
    kms, table = fake_kms.install(monkeypatch)
    tok = c.encrypt_str("u1", PK, SK, "payee", "a")
    c.decrypt_str("u1", PK, SK, "payee", tok)
    assert len(kms.generate_calls) == 1 and kms.decrypt_calls == []  # cached at creation
    # fresh container: cache empty, key exists -> exactly one KMS decrypt, then cached
    monkeypatch.setattr(c, "_dek_cache", {})
    for _ in range(5):
        assert c.decrypt_str("u1", PK, SK, "payee", tok) == "a"
    assert len(kms.decrypt_calls) == 1
    ctx = kms.decrypt_calls[0][1]
    assert ctx == {"purpose": "fus-finances", "userId": "u1"}
    assert len(kms.generate_calls) == 1


def test_dek_item_shape(monkeypatch):
    kms, table = fake_kms.install(monkeypatch)
    c.encrypt_str("u1", PK, SK, "payee", "a")
    item = table.items[("USER#u1", "BPF#DEK")]
    assert isinstance(item["wrappedKey"]["B"], bytes)
    assert item["keyArn"]["S"] == fake_kms.KEY_ARN
    assert item["alg"]["S"] == "AES-256-GCM" and item["createdAt"]["S"].endswith("Z")
    assert kms.generate_calls[0] == (fake_kms.KEY_ARN, {"purpose": "fus-finances", "userId": "u1"})


def test_two_users_get_different_deks(monkeypatch):
    kms, table = fake_kms.install(monkeypatch)
    c.encrypt_str("u1", "USER#u1", SK, "payee", "a")
    c.encrypt_str("u2", "USER#u2", SK, "payee", "a")
    assert c._dek_cache["u1"] != c._dek_cache["u2"]
    assert len(kms.generate_calls) == 2
    tok = c.encrypt_str("u1", "USER#u1", SK, "payee", "mine")
    with pytest.raises(c.FinanceCryptoError):
        c.decrypt_str("u2", "USER#u1", SK, "payee", tok)  # wrong user's key


def test_concurrent_create_race_uses_winner_key(monkeypatch):
    kms, table = fake_kms.install(monkeypatch)
    winner = kms.generate_data_key(fake_kms.KEY_ARN, "AES_256",
                                   {"purpose": "fus-finances", "userId": "u1"})
    real_get = table.get_item
    calls = {"n": 0}

    def racing_get(TableName, Key):
        calls["n"] += 1
        if calls["n"] == 1:  # first read sees nothing; the other writer lands before our put
            table.items[("USER#u1", "BPF#DEK")] = {
                "PK": {"S": "USER#u1"}, "SK": {"S": "BPF#DEK"},
                "wrappedKey": {"B": winner["CiphertextBlob"]}, "keyArn": {"S": "k"},
                "alg": {"S": "AES-256-GCM"}, "createdAt": {"S": "t"}}
            return {}
        return real_get(TableName, Key)

    table.get_item = racing_get
    tok = c.encrypt_str("u1", PK, SK, "payee", "raced")
    assert c._dek_cache["u1"] == winner["Plaintext"]  # not our losing generated key
    monkeypatch.setattr(c, "_dek_cache", {})
    assert c.decrypt_str("u1", PK, SK, "payee", tok) == "raced"


def test_dek_put_other_error_propagates(monkeypatch):
    kms, table = fake_kms.install(monkeypatch)

    def boom(**kw):
        raise ClientError({"Error": {"Code": "ProvisionedThroughputExceededException"}}, "PutItem")

    monkeypatch.setattr(table, "put_item", lambda **kw: boom())
    with pytest.raises(ClientError):
        c.encrypt_str("u1", PK, SK, "payee", "a")


def test_missing_key_id_errors_on_write(monkeypatch):
    fake_kms.install(monkeypatch)
    monkeypatch.delenv("FINANCE_KMS_KEY_ID")
    with pytest.raises(c.FinanceCryptoError, match="FINANCE_KMS_KEY_ID"):
        c.encrypt_str("u1", PK, SK, "payee", "a")
    with pytest.raises(c.FinanceCryptoError):
        c.enc_attr("u1", PK, SK, "amount", 1)
