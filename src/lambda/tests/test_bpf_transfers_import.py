"""Unit tests for FUNK-28 (banks/transfers/computed balances) and FUNK-29 (imports)."""
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api import bpf  # noqa: E402


def _account_item(account_id, name="Chequing", bank="RBC", number="12345678",
                  nickname="", opening="100"):
    item = {
        "PK": {"S": "USER#u1"},
        "SK": {"S": f"BPF#ACCOUNT#{account_id}"},
        "name": {"S": name},
        "kind": {"S": "checking"},
        "openingBalance": {"N": opening},
        "currency": {"S": "USD"},
        "updatedAt": {"S": "2026-07-01T00:00:00Z"},
    }
    if bank:
        item["bank"] = {"S": bank}
    if number:
        item["accountNumber"] = {"S": number}
    if nickname:
        item["nickname"] = {"S": nickname}
    return item


# --- accounts: masking, display name, computed balance ------------------------

def test_account_masks_number_and_builds_display_name():
    out = bpf._account_from_item(_account_item("a1"))
    assert out["accountNumberMasked"] == "…5678"
    assert out["displayName"] == "RBC …5678"
    assert "accountNumber" not in out  # full number never leaves the API


def test_account_nickname_wins_and_legacy_balance_is_opening():
    item = _account_item("a1", nickname="Day-to-day")
    del item["openingBalance"]
    item["balance"] = {"N": "250"}
    out = bpf._account_from_item(item)
    assert out["displayName"] == "Day-to-day"
    assert out["openingBalance"] == 250.0


def test_list_accounts_computes_balance_from_transactions():
    with patch.object(bpf, "_query_prefix", return_value=[_account_item("a1", opening="100")]), \
         patch.object(bpf, "list_transactions", return_value=[
             {"accountId": "a1", "amount": -30.0},
             {"accountId": "a1", "amount": 10.0},
             {"accountId": "other", "amount": -999.0},
         ]):
        accounts = bpf.list_accounts("u1")
    assert accounts[0]["balance"] == 80.0


# --- transfers -----------------------------------------------------------------

def _two_accounts():
    return [
        {"id": "a1", "displayName": "RBC …5678"},
        {"id": "a2", "displayName": "CIBC …9999"},
    ]


def test_create_transfer_writes_two_linked_legs():
    ddb = MagicMock()
    with patch.object(bpf, "_ddb", return_value=ddb), \
         patch.object(bpf, "list_accounts", return_value=_two_accounts()):
        legs, err = bpf.create_transfer("u1", {
            "date": "2026-07-05", "amount": 3000,
            "fromAccountId": "a1", "toAccountId": "a2",
        })
    assert err is None
    assert [l["amount"] for l in legs] == [-3000.0, 3000.0]
    assert legs[0]["transferId"] == legs[1]["transferId"] != ""
    assert all(l["category"] == "Transfer" for l in legs)
    assert "CIBC" in legs[0]["payee"] and "RBC" in legs[1]["payee"]
    items = [c.kwargs["Item"] for c in ddb.put_item.call_args_list]
    assert len(items) == 2
    assert items[0]["transferId"] == items[1]["transferId"]


def test_create_transfer_validates():
    with patch.object(bpf, "list_accounts", return_value=_two_accounts()):
        _, err = bpf.create_transfer("u1", {"date": "2026-07-05", "amount": 10,
                                            "fromAccountId": "a1", "toAccountId": "a1"})
        assert err
        _, err = bpf.create_transfer("u1", {"date": "bad", "amount": 10,
                                            "fromAccountId": "a1", "toAccountId": "a2"})
        assert err
        _, err = bpf.create_transfer("u1", {"date": "2026-07-05", "amount": 10,
                                            "fromAccountId": "a1", "toAccountId": "ghost"})
        assert err


def test_delete_transaction_removes_transfer_sibling():
    ddb = MagicMock()
    ddb.get_item.return_value = {"Item": {
        "SK": {"S": "BPF#TXN#2026-07-05#aaa"},
        "transferId": {"S": "t1"},
    }}
    sibling = {"SK": {"S": "BPF#TXN#2026-07-05#bbb"}, "transferId": {"S": "t1"},
               "amount": {"N": "10"}}
    with patch.object(bpf, "_ddb", return_value=ddb), \
         patch.object(bpf, "_query_prefix", return_value=[sibling]):
        assert bpf.delete_transaction("u1", "2026-07-05_aaa") is True
    deleted = [c.kwargs["Key"]["SK"]["S"] for c in ddb.delete_item.call_args_list]
    assert set(deleted) == {"BPF#TXN#2026-07-05#aaa", "BPF#TXN#2026-07-05#bbb"}


def test_transfers_excluded_from_budgets_and_overview():
    txns = [
        {"id": "1", "date": "2026-07-02", "accountId": "a1", "amount": -3000.0,
         "payee": "Transfer to visa", "category": "Transfer", "transferId": "t1",
         "notes": "", "fitid": ""},
        {"id": "2", "date": "2026-07-02", "accountId": "a2", "amount": 3000.0,
         "payee": "Transfer from chequing", "category": "Transfer", "transferId": "t1",
         "notes": "", "fitid": ""},
        {"id": "3", "date": "2026-07-03", "accountId": "a1", "amount": -50.0,
         "payee": "Cafe", "category": "Dining", "transferId": "", "notes": "", "fitid": ""},
    ]
    ddb = MagicMock()
    ddb.get_item.return_value = {"Item": {"budgets": {"L": [
        {"M": {"category": {"S": "Dining"}, "monthlyLimit": {"N": "200"}}}]}}}
    with patch.object(bpf, "_ddb", return_value=ddb), \
         patch.object(bpf, "list_transactions", return_value=txns):
        budgets = bpf.get_budgets("u1")
    assert budgets[0]["actual"] == 50.0  # the $3k transfer is not spend

    with patch.object(bpf, "list_transactions", return_value=txns), \
         patch.object(bpf, "list_accounts", return_value=[]), \
         patch.object(bpf.era_client, "get_accounts", return_value=[]), \
         patch.object(bpf.era_client, "get_transactions", return_value=[]), \
         patch.object(bpf.era_client, "is_connected", return_value=False):
        overview = bpf.overview_payload("u1")
    assert overview["cashFlow30d"]["spend"] == 50.0
    assert overview["cashFlow30d"]["income"] == 0.0


def test_link_transfer_pairs_matches_cross_account():
    txns = [
        {"id": "2026-07-05_x", "date": "2026-07-05", "accountId": "a1", "amount": -3000.0,
         "payee": "PAYMENT", "category": "Other", "transferId": "", "notes": "", "fitid": ""},
        {"id": "2026-07-06_y", "date": "2026-07-06", "accountId": "a2", "amount": 3000.0,
         "payee": "PAYMENT RECEIVED", "category": "Other", "transferId": "", "notes": "", "fitid": ""},
        {"id": "2026-07-06_z", "date": "2026-07-06", "accountId": "a1", "amount": -20.0,
         "payee": "Cafe", "category": "Dining", "transferId": "", "notes": "", "fitid": ""},
    ]
    ddb = MagicMock()
    with patch.object(bpf, "_ddb", return_value=ddb), \
         patch.object(bpf, "list_transactions", return_value=txns):
        assert bpf.link_transfer_pairs("u1") == 1
    assert ddb.update_item.call_count == 2


# --- statement import ----------------------------------------------------------

OFX = """OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><ACCTID>12345678
<BANKTRANLIST>
<STMTTRN><DTPOSTED>20260701<TRNAMT>-45.20<FITID>f1<NAME>SHELL 1234
<STMTTRN><DTPOSTED>20260702<TRNAMT>-12.00<FITID>f2<NAME>NETFLIX.COM
</BANKTRANLIST><LEDGERBAL><BALAMT>1500.25<DTASOF>20260707</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>"""


def _import_env(existing):
    """Common patches for import_statement. Returns (ctx_managers, ddb, puts)."""
    ddb = MagicMock()
    return ddb, [
        patch.object(bpf, "_ddb", return_value=ddb),
        patch.object(bpf, "list_accounts", return_value=[
            {"id": "acc1", "displayName": "RBC …5678"}]),
        patch.object(bpf, "find_account_by_number",
                     side_effect=lambda uid, n: "acc1" if n == "12345678" else None),
        patch.object(bpf, "list_transactions", return_value=existing),
        patch.object(bpf, "link_transfer_pairs", return_value=0),
    ]


def test_import_preview_counts_without_writing():
    from api import bpf_import
    existing = [{"id": "e", "date": "2026-07-01", "accountId": "acc1", "amount": -45.2,
                 "payee": "SHELL 1234", "category": "Other", "transferId": "",
                 "notes": "", "fitid": "f1"}]
    ddb, patches = _import_env(existing)
    with patches[0], patches[1], patches[2], patches[3], patches[4], \
         patch("api.bpf_rules.get_rules", return_value=[]):
        result, err = bpf.import_statement(
            "u1", {"accountId": "acc1", "filename": "x.qfx", "content": OFX})
    assert err is None
    assert result == {"format": "ofx", "total": 2, "new": 1, "duplicates": 1,
                      "routed": {"acc1": 1}, "committed": False}
    ddb.put_item.assert_not_called()


def test_import_commit_writes_new_rows_and_reconciles():
    ddb, patches = _import_env([])
    with patches[0], patches[1], patches[2], patches[3], patches[4], \
         patch("api.bpf_rules.get_rules", return_value=[
             {"match": "contains", "pattern": "netflix", "category": "Subscriptions",
              "source": "manual"}]), \
         patch.object(bpf, "set_reconciled_balance") as mock_rec:
        result, err = bpf.import_statement(
            "u1", {"accountId": "acc1", "filename": "x.qfx", "content": OFX},
            commit=True)
    assert err is None
    assert result["new"] == 2 and result["committed"] is True
    items = [c.kwargs["Item"] for c in ddb.put_item.call_args_list]
    assert len(items) == 2
    assert {i["fitid"]["S"] for i in items} == {"f1", "f2"}
    cats = {i["payee"]["S"]: i["category"]["S"] for i in items}
    assert cats["NETFLIX.COM"] == "Subscriptions"  # rule applied on import
    mock_rec.assert_called_once_with("u1", "acc1", 1500.25, "2026-07-07")


def test_import_rejects_garbage_and_missing_mapping():
    _, patches = _import_env([])
    with patches[1]:
        _, err = bpf.import_statement(
            "u1", {"accountId": "acc1", "filename": "x.csv", "content": "a,b\n1,2"})
        assert "mapping" in err
        _, err = bpf.import_statement(
            "u1", {"accountId": "acc1", "filename": "x.ofx", "content": "not ofx at all"})
        assert err


# --- handler routes ------------------------------------------------------------

def _event(path, method="GET", body=None, sub="user-123"):
    return {
        "rawPath": path,
        "pathParameters": {},
        "queryStringParameters": {},
        "requestContext": {
            "http": {"method": method, "path": path},
            "authorizer": {"jwt": {"claims": {
                "sub": sub, "email": "user@example.com", "cognito:groups": "user"}}},
        },
        "body": json.dumps(body) if body is not None else "{}",
    }


@patch("api.bpf.create_transfer", return_value=([{"id": "l1"}, {"id": "l2"}], None))
@patch("api.handler._getUserCustomGroups", return_value=[])
def test_postFinancesTransfers_route(mock_groups, mock_xfer):
    from api.handler import handler
    result = handler(_event("/finances/transfers", "POST",
                            {"date": "2026-07-05", "amount": 3000,
                             "fromAccountId": "a1", "toAccountId": "a2"}), None)
    assert result["statusCode"] == 201
    assert len(json.loads(result["body"])["legs"]) == 2


@patch("api.bpf.import_statement", return_value=({"new": 3, "committed": False}, None))
@patch("api.handler._getUserCustomGroups", return_value=[])
def test_postFinancesImport_route(mock_groups, mock_imp):
    from api.handler import handler
    result = handler(_event("/finances/import", "POST",
                            {"accountId": "a1", "filename": "x.ofx", "content": "..."}), None)
    assert result["statusCode"] == 200
    mock_imp.assert_called_once()
    assert mock_imp.call_args.kwargs["commit"] is False


@patch("api.bpf_rules.save_rules", return_value=([{"match": "contains"}], None))
@patch("api.bpf_rules.get_rules", return_value=[])
@patch("api.bpf.apply_rules_to_uncategorized", return_value=4)
@patch("api.handler._getUserCustomGroups", return_value=[])
def test_rules_routes(mock_groups, mock_apply, mock_get, mock_save):
    from api.handler import handler
    assert handler(_event("/finances/rules"), None)["statusCode"] == 200
    assert handler(_event("/finances/rules", "PUT", {"rules": []}), None)["statusCode"] == 200
    result = handler(_event("/finances/rules/apply", "POST", {}), None)
    assert json.loads(result["body"])["updated"] == 4
