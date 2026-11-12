"""FUNK-78 data-layer tests: every finance write site seals sensitive fields and every
reader returns the original values. Uses an in-memory DynamoDB so the serialized
write arguments can be searched for plaintext (MagicMock tests can't do this)."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api import bpf, bpf_crypto, bpf_rules  # noqa: E402
from tests.fake_ddb import FakeTable  # noqa: E402

U = "owner-1"
OFX = """OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><ACCTID>99887766
<BANKTRANLIST>
<STMTTRN><DTPOSTED>20260701<TRNAMT>-45.20<FITID>fit-aaa<NAME>ZEBRA PAYEE ONE
<STMTTRN><DTPOSTED>20260702<TRNAMT>-12.00<FITID>fit-bbb<NAME>NETFLIX.COM
</BANKTRANLIST><LEDGERBAL><BALAMT>1500.25<DTASOF>20260707</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>"""


@pytest.fixture
def table(monkeypatch):
    t = FakeTable()
    monkeypatch.setattr(bpf, "_ddb", lambda: t)
    monkeypatch.setattr(bpf_rules, "_ddb", lambda: t)
    return t


def _blob(table):
    return repr(table.writes)


def assert_no_plaintext(table, *needles):
    blob = _blob(table)
    for n in needles:
        assert n not in blob, f"plaintext {n!r} leaked into a DynamoDB write"


def _acct(**kw):
    data = {"name": "Qwerty Chequing", "kind": "checking", "openingBalance": 1234.56,
            "bank": "Quuxbank", "accountNumber": "99887766", "nickname": "Pocketmoney"}
    data.update(kw)
    acct, err = bpf.save_account(U, data)
    assert err is None
    return acct


# --- accounts ------------------------------------------------------------------

def test_account_round_trip_and_no_plaintext(table):
    acct = _acct()
    assert_no_plaintext(table, "Qwerty", "Quuxbank", "99887766", "Pocketmoney", "1234.56")
    raw = table.items[(f"USER#{U}", f"BPF#ACCOUNT#{acct['id']}")]
    for a in ("name", "bank", "accountNumber", "nickname", "openingBalance"):
        assert bpf_crypto.is_encrypted(raw[a]), a
    assert raw["kind"] == {"S": "checking"} and raw["currency"] == {"S": "USD"}
    [got] = bpf.list_accounts(U)
    assert got["name"] == "Qwerty Chequing" and got["bank"] == "Quuxbank"
    assert got["openingBalance"] == 1234.56 and got["accountNumberMasked"] == "…7766"
    assert got["displayName"] == "Pocketmoney"
    assert bpf.find_account_by_number(U, "99887766") == acct["id"]
    assert bpf.find_account_by_number(U, "00000000") is None


def test_account_edit_keeps_number_reconciliation_and_mapping(table):
    acct = _acct()
    bpf.set_reconciled_balance(U, acct["id"], 777.77, "2026-07-07")
    sk = f"BPF#ACCOUNT#{acct['id']}"
    table.items[(f"USER#{U}", sk)]["csvMapping"] = bpf_crypto.enc_attr(
        U, f"USER#{U}", sk, "csvMapping", '{"date":"Zdate"}')
    bpf.save_account(U, {"name": "Renamed Acct", "kind": "checking"}, account_id=acct["id"])
    [got] = bpf.list_accounts(U)
    assert got["name"] == "Renamed Acct"
    assert bpf.find_account_by_number(U, "99887766") == acct["id"]  # blank number = keep
    assert got["reconciledBalance"] == 777.77 and got["csvMapping"] == {"date": "Zdate"}
    assert_no_plaintext(table, "777.77", "Zdate", "Renamed")


def test_account_edit_encrypts_legacy_plaintext_carry_over(table):
    sk = "BPF#ACCOUNT#legacy1"
    table.put({"PK": {"S": f"USER#{U}"}, "SK": {"S": sk}, "name": {"S": "Old"},
               "kind": {"S": "checking"}, "balance": {"N": "250"},
               "accountNumber": {"S": "55554444"}, "reconciledBalance": {"N": "99.5"},
               "reconciledAt": {"S": "2026-01-01"}, "csvMapping": {"S": '{"date":"D"}'},
               "currency": {"S": "USD"}, "updatedAt": {"S": "t"}})
    [legacy] = bpf.list_accounts(U)  # legacy plaintext still reads
    assert legacy["openingBalance"] == 250.0 and legacy["reconciledBalance"] == 99.5
    table.writes.clear()
    bpf.save_account(U, {"name": "New", "kind": "checking", "openingBalance": 250},
                     account_id="legacy1")
    assert_no_plaintext(table, "55554444", "99.5", '"date"', "'New'")
    [got] = bpf.list_accounts(U)
    assert got["reconciledBalance"] == 99.5 and got["csvMapping"] == {"date": "D"}
    assert bpf.find_account_by_number(U, "55554444") == "legacy1"


# --- transactions --------------------------------------------------------------

def _txn(**kw):
    data = {"date": "2026-07-01", "amount": -45.2, "accountId": "acc1",
            "payee": "Zebra Payee", "category": "Quokka", "notes": "Wombat note"}
    data.update(kw)
    t, err = bpf.save_transaction(U, data)
    assert err is None
    return t


def test_transaction_no_plaintext_and_round_trip(table):
    t = _txn()
    assert_no_plaintext(table, "Zebra", "Quokka", "Wombat", "45.2")
    raw = table.items[(f"USER#{U}", f"BPF#TXN#2026-07-01#{t['id'].split('_')[1]}")]
    for a in ("amount", "payee", "category", "notes"):
        assert bpf_crypto.is_encrypted(raw[a]), a
    assert raw["accountId"] == {"S": "acc1"} and raw["business"] == {"BOOL": False}
    [got] = bpf.list_transactions(U)
    assert (got["amount"], got["payee"], got["category"], got["notes"]) == (
        -45.2, "Zebra Payee", "Quokka", "Wombat note")
    assert isinstance(got["amount"], float)
    # python-side filters still work on decrypted values
    assert len(bpf.list_transactions(U, q="zebra")) == 1
    assert len(bpf.list_transactions(U, q="wombat")) == 1
    assert len(bpf.list_transactions(U, category="quokka")) == 1
    assert bpf.list_transactions(U, q="nomatch") == []
    assert len(bpf.list_transactions(U, from_date="2026-07-01", to_date="2026-07-31")) == 1
    # category seeded into the (encrypted) settings list
    assert "Quokka" in bpf.get_categories(U)


def test_transaction_edit_and_date_move_keep_fitid(table):
    sk = f"BPF#TXN#2026-07-01#u1"
    item = bpf._txn_item(U, sk, {"date": "2026-07-01", "amount": -5.0, "accountId": "a",
                                 "payee": "P", "category": "C", "notes": ""}, fitid="fitid-secret")
    table.put(item)
    t, err = bpf.save_transaction(U, {"date": "2026-07-09", "amount": -6, "accountId": "a",
                                      "payee": "P2", "category": "C"}, txn_id="2026-07-01_u1")
    assert err is None
    [got] = bpf.list_transactions(U)
    assert got["date"] == "2026-07-09" and got["fitid"] == "fitid-secret" and got["amount"] == -6.0


def test_transfers_sealed_transferid_plain_and_mirrored(table):
    a1, a2 = _acct(name="Src Acct", accountNumber="11112222"), _acct(
        name="Dst Acct", accountNumber="33334444", nickname="")
    legs, err = bpf.create_transfer(U, {"date": "2026-07-03", "amount": 80.5,
                                        "fromAccountId": a1["id"], "toAccountId": a2["id"],
                                        "notes": "Giraffe memo"})
    assert err is None and len(legs) == 2
    assert_no_plaintext(table, "Giraffe", "80.5", "Transfer to", "Transfer from")
    got = bpf.list_transactions(U)
    assert {t["transferId"] for t in got} == {legs[0]["transferId"]}
    assert all(t["category"] == "Transfer" for t in got)
    # editing one leg mirrors onto the sibling, still sealed
    table.writes.clear()
    bpf.save_transaction(U, {"date": "2026-07-04", "amount": -90, "accountId": a1["id"],
                             "payee": "x", "category": "Transfer", "notes": "n"},
                         txn_id=legs[0]["id"])
    by_acct = {t["accountId"]: t for t in bpf.list_transactions(U)}
    assert by_acct[a2["id"]]["amount"] == 90.0 and by_acct[a2["id"]]["date"] == "2026-07-04"
    assert_no_plaintext(table, "90.0", "-90")
    # delete takes the sibling (transferId lookup on plaintext attr)
    moved_id = by_acct[a1["id"]]["id"]  # date change re-keyed the SK
    assert bpf.delete_transaction(U, moved_id) is True
    assert bpf.list_transactions(U) == []


def test_link_transfer_pairs_seals_category(table):
    for sk_date, amt, acct in (("2026-07-01", -300.0, "A"), ("2026-07-02", 300.0, "B")):
        t = _txn(date=sk_date, amount=amt, accountId=acct, payee="Move", category="Other",
                 notes="")
    table.writes.clear()
    assert bpf.link_transfer_pairs(U) == 1
    assert all(op == "update" for op, _ in table.writes)
    assert_no_plaintext(table, "'Transfer'", '"Transfer"')
    got = bpf.list_transactions(U)
    assert all(t["category"] == "Transfer" and t["transferId"] for t in got)


def test_bulk_categorize_sealed_and_skips_transfers(table):
    plain = _txn(category="Other")
    other = _txn(date="2026-07-02", payee="Second", category="Other")
    legs, _ = bpf.create_transfer(U, {"date": "2026-07-03", "amount": 1,
                                      "fromAccountId": _acct(accountNumber="1")["id"],
                                      "toAccountId": _acct(accountNumber="2", name="B")["id"]})
    table.writes.clear()
    n, err = bpf.bulk_categorize(U, [plain["id"], other["id"], legs[0]["id"]], "Platypus")
    assert err is None and n == 2  # transfer leg rejected by the transferId condition
    assert_no_plaintext(table, "Platypus")
    cats = {t["id"]: t["category"] for t in bpf.list_transactions(U)}
    assert cats[plain["id"]] == cats[other["id"]] == "Platypus"
    assert cats[legs[0]["id"]] == "Transfer"
    assert "Platypus" in bpf.get_categories(U)


def test_apply_rules_to_uncategorized(table):
    _txn(payee="Narwhal Coffee", category="Other", notes="")
    _txn(date="2026-07-02", payee="Unrelated", category="Other", notes="")
    bpf_rules.save_rules(U, [{"match": "contains", "pattern": "narwhal", "category": "Okapi"}])
    table.writes.clear()
    assert bpf.apply_rules_to_uncategorized(U) == 1
    assert_no_plaintext(table, "Okapi")
    cats = {t["payee"]: t["category"] for t in bpf.list_transactions(U)}
    assert cats == {"Narwhal Coffee": "Okapi", "Unrelated": "Other"}


def test_new_transaction_uses_encrypted_rules(table):
    bpf_rules.save_rules(U, [{"match": "contains", "pattern": "axolotl", "category": "Pets9"}])
    t = _txn(payee="Axolotl Supplies", category="Other")
    assert bpf.list_transactions(U)[0]["category"] == "Pets9"


# --- import (BatchWriteItem) ---------------------------------------------------

def test_import_commit_sealed_dedupes_and_reconciles(table):
    acct = _acct()
    bpf_rules.save_rules(U, [{"match": "contains", "pattern": "netflix", "category": "Streamz"}])
    table.writes.clear()
    body = {"accountId": acct["id"], "filename": "x.qfx", "content": OFX}
    res, err = bpf.import_statement(U, body, commit=True)
    assert err is None and res["new"] == 2 and res["committed"] is True
    ops = {op for op, _ in table.writes}
    assert "batch_put" in ops
    assert_no_plaintext(table, "ZEBRA", "NETFLIX", "fit-aaa", "fit-bbb", "Streamz",
                        "45.2", "1500.25")
    got = {t["payee"]: t for t in bpf.list_transactions(U)}
    assert got["NETFLIX.COM"]["category"] == "Streamz"
    assert got["ZEBRA PAYEE ONE"]["fitid"] == "fit-aaa"
    [a] = bpf.list_accounts(U)
    assert a["reconciledBalance"] == 1500.25
    # re-import: fitids/fingerprints are compared after decryption -> all duplicates
    res2, _ = bpf.import_statement(U, body, commit=True)
    assert res2["new"] == 0 and res2["duplicates"] == 2


def test_import_csv_mapping_sealed(table):
    acct = _acct()
    csv_text = "Date,Description,Amount\n2026-07-05,Capybara Cafe,-8.25\n"
    mapping = {"date": "Date", "payee": "Description", "amount": "Amount"}
    table.writes.clear()
    res, err = bpf.import_statement(U, {"accountId": acct["id"], "filename": "a.csv",
                                        "content": csv_text, "mapping": mapping}, commit=True)
    assert err is None and res["new"] == 1
    assert_no_plaintext(table, "Capybara", "8.25", "Description")
    [a] = bpf.list_accounts(U)
    assert a["csvMapping"] == mapping


# --- settings / budgets / rules ------------------------------------------------

def test_settings_budgets_rules_sealed(table):
    bpf.save_categories(U, ["Ocelot", "Lemur"])
    bpf.save_budgets(U, [{"category": "Ocelot", "monthlyLimit": 321.5}])
    bpf_rules.save_rules(U, [{"match": "equals", "pattern": "ibex", "category": "Lemur"}])
    assert_no_plaintext(table, "Ocelot", "Lemur", "ibex", "321.5")
    for sk, attr in (("BPF#SETTINGS", "categories"), ("BPF#BUDGETS", "budgets"),
                     ("BPF#RULES", "rules")):
        assert bpf_crypto.is_encrypted(table.items[(f"USER#{U}", sk)][attr])
    assert bpf.get_categories(U) == ["Ocelot", "Lemur"]
    [b] = bpf.get_budgets(U)
    assert b["category"] == "Ocelot" and b["monthlyLimit"] == 321.5 and b["actual"] == 0.0
    assert isinstance(b["monthlyLimit"], float)
    assert bpf_rules.get_rules(U) == [
        {"match": "equals", "pattern": "ibex", "category": "Lemur", "source": "manual"}]


def test_legacy_plaintext_settings_budgets_rules_still_read(table):
    pk = {"S": f"USER#{U}"}
    table.put({"PK": pk, "SK": {"S": "BPF#SETTINGS"},
               "categories": {"L": [{"S": "Old1"}, {"S": "Old2"}]}})
    table.put({"PK": pk, "SK": {"S": "BPF#BUDGETS"}, "budgets": {"L": [
        {"M": {"category": {"S": "Old1"}, "monthlyLimit": {"N": "10"}}}]}})
    table.put({"PK": pk, "SK": {"S": "BPF#RULES"}, "rules": {"L": [
        {"M": {"match": {"S": "contains"}, "pattern": {"S": "p"},
               "category": {"S": "Old1"}, "source": {"S": "manual"}}}]}})
    assert bpf.get_categories(U) == ["Old1", "Old2"]
    assert bpf.get_budgets(U)[0]["monthlyLimit"] == 10.0
    assert bpf_rules.get_rules(U)[0]["category"] == "Old1"


# --- shared access / safety -----------------------------------------------------

def test_shared_reader_uses_owner_dek(table):
    """Grantees read via the owner's id; only the owner's DEK item exists."""
    _txn()
    assert bpf.list_transactions(U)[0]["payee"] == "Zebra Payee"
    kms = bpf_crypto._kms()
    assert {ctx["userId"] for _, ctx in kms.generate_calls} == {U}  # only the owner's DEK


def test_write_without_key_id_raises_and_stores_nothing(table, monkeypatch):
    monkeypatch.delenv("FINANCE_KMS_KEY_ID")
    monkeypatch.setattr(bpf_crypto, "_dek_cache", {})
    with pytest.raises(bpf_crypto.FinanceCryptoError):
        bpf.save_transaction(U, {"date": "2026-07-01", "amount": 1, "accountId": "a",
                                 "payee": "p", "category": "c"})
    assert table.writes == []


def test_moved_ciphertext_does_not_decrypt(table):
    t = _txn()
    sk = f"BPF#TXN#2026-07-01#{t['id'].split('_')[1]}"
    item = table.items[(f"USER#{U}", sk)]
    item["notes"] = item["payee"]  # attacker swaps attribute values
    with pytest.raises(bpf_crypto.FinanceCryptoError):
        bpf.list_transactions(U)
