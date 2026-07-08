"""Unit tests for Personal Finances (B&PF) API handlers and bpf/era_client logic."""
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _event(path, method="GET", body=None, query=None, sub="user-123", email="user@example.com"):
    return {
        "rawPath": path,
        "pathParameters": {},
        "queryStringParameters": query or {},
        "requestContext": {
            "http": {"method": method, "path": path},
            "authorizer": {
                "jwt": {
                    "claims": {"sub": sub, "email": email, "cognito:groups": "user"}
                }
            },
        },
        "body": json.dumps(body) if body is not None else "{}",
    }


def test_finances_requires_auth():
    from api.handler import handler
    event = {
        "rawPath": "/finances/overview",
        "requestContext": {"http": {"method": "GET", "path": "/finances/overview"}},
    }
    assert handler(event, None)["statusCode"] == 401


# --- accounts ---------------------------------------------------------------

@patch("api.bpf.list_accounts", return_value=[{"id": "a1", "name": "Chequing", "balance": 100.0}])
@patch("api.handler._getUserCustomGroups", return_value=[])
def test_getFinancesAccounts(mock_groups, mock_list):
    from api.handler import handler
    result = handler(_event("/finances/accounts"), None)
    assert result["statusCode"] == 200
    assert json.loads(result["body"])["accounts"][0]["id"] == "a1"


@patch("api.bpf.save_account", return_value=({"id": "a1", "name": "Chequing"}, None))
@patch("api.handler._getUserCustomGroups", return_value=[])
def test_postFinancesAccounts(mock_groups, mock_save):
    from api.handler import handler
    result = handler(_event("/finances/accounts", "POST", {"name": "Chequing"}), None)
    assert result["statusCode"] == 201


@patch("api.handler._getUserCustomGroups", return_value=[])
def test_postFinancesAccounts_validates(mock_groups):
    """Validation errors surface as 400 (real _validate_account, no DDB write)."""
    from api.handler import handler
    result = handler(_event("/finances/accounts", "POST", {"name": ""}), None)
    assert result["statusCode"] == 400


@patch("api.bpf.account_exists", return_value=False)
@patch("api.handler._getUserCustomGroups", return_value=[])
def test_putFinancesAccount_not_found(mock_groups, mock_exists):
    from api.handler import handler
    result = handler(_event("/finances/accounts/nope", "PUT", {"name": "X"}), None)
    assert result["statusCode"] == 404


@patch("api.bpf.delete_account", return_value=True)
@patch("api.handler._getUserCustomGroups", return_value=[])
def test_deleteFinancesAccount(mock_groups, mock_del):
    from api.handler import handler
    result = handler(_event("/finances/accounts/a1", "DELETE"), None)
    assert result["statusCode"] == 200
    mock_del.assert_called_once_with("user-123", "a1")


# --- transactions -----------------------------------------------------------

@patch("api.bpf.transactions_payload", return_value={"transactions": [], "eraConnected": False})
@patch("api.handler._getUserCustomGroups", return_value=[])
def test_getFinancesTransactions(mock_groups, mock_payload):
    from api.handler import handler
    result = handler(_event("/finances/transactions", query={"from": "2026-01-01", "q": "coffee"}), None)
    assert result["statusCode"] == 200
    mock_payload.assert_called_once_with(
        "user-123", from_date="2026-01-01", to_date=None, q="coffee", category=None)


@patch("api.bpf.save_transaction", return_value=({"id": "2026-07-01_abc"}, None))
@patch("api.handler._getUserCustomGroups", return_value=[])
def test_postFinancesTransactions(mock_groups, mock_save):
    from api.handler import handler
    result = handler(
        _event("/finances/transactions", "POST",
               {"date": "2026-07-01", "amount": -12.5, "payee": "Cafe"}), None)
    assert result["statusCode"] == 201


@patch("api.handler._getUserCustomGroups", return_value=[])
def test_postFinancesTransactions_validates_date(mock_groups):
    from api.handler import handler
    result = handler(_event("/finances/transactions", "POST", {"date": "bad", "amount": 1}), None)
    assert result["statusCode"] == 400


@patch("api.bpf.delete_transaction", return_value=False)
@patch("api.handler._getUserCustomGroups", return_value=[])
def test_deleteFinancesTransaction_not_found(mock_groups, mock_del):
    from api.handler import handler
    result = handler(_event("/finances/transactions/2026-07-01_zzz", "DELETE"), None)
    assert result["statusCode"] == 404


# --- budgets ----------------------------------------------------------------

@patch("api.bpf.get_budgets", return_value=[{"category": "Groceries", "monthlyLimit": 500.0, "actual": 120.0}])
@patch("api.handler._getUserCustomGroups", return_value=[])
def test_getFinancesBudgets(mock_groups, mock_budgets):
    from api.handler import handler
    result = handler(_event("/finances/budgets"), None)
    assert result["statusCode"] == 200
    assert json.loads(result["body"])["budgets"][0]["actual"] == 120.0


@patch("api.handler._getUserCustomGroups", return_value=[])
def test_putFinancesBudgets_validates(mock_groups):
    from api.handler import handler
    result = handler(_event("/finances/budgets", "PUT", {"budgets": "nope"}), None)
    assert result["statusCode"] == 400


def test_get_budgets_computes_actuals():
    from api import bpf
    ddb = MagicMock()
    ddb.get_item.return_value = {"Item": {"budgets": {"L": [
        {"M": {"category": {"S": "Groceries"}, "monthlyLimit": {"N": "500"}}}]}}}
    with patch.object(bpf, "_ddb", return_value=ddb), \
         patch.object(bpf, "list_transactions", return_value=[
             {"category": "Groceries", "amount": -120.0},
             {"category": "Groceries", "amount": -30.0},
             {"category": "Income", "amount": 1000.0},
         ]):
        budgets = bpf.get_budgets("u1")
    assert budgets == [{"category": "Groceries", "monthlyLimit": 500.0, "actual": 150.0}]


# --- insights ---------------------------------------------------------------

@patch("api.bpf.insights_payload", return_value={"period": "2026-07", "eraConnected": False})
@patch("api.handler._getUserCustomGroups", return_value=[])
def test_getFinancesInsights(mock_groups, mock_payload):
    from api.handler import handler
    result = handler(_event("/finances/insights", query={"period": "2026-07"}), None)
    assert result["statusCode"] == 200
    mock_payload.assert_called_once_with("user-123", "2026-07")


@patch("api.bpf.summarize_insights", return_value=("All good. Not financial advice.", None))
@patch("api.handler._getUserCustomGroups", return_value=[])
def test_postFinancesInsightsSummary(mock_groups, mock_sum):
    from api.handler import handler
    result = handler(_event("/finances/insights/summary", "POST", {}), None)
    assert result["statusCode"] == 200
    assert "Not financial advice." in json.loads(result["body"])["summary"]


@patch("api.bpf.summarize_insights", return_value=(None, "boom"))
@patch("api.handler._getUserCustomGroups", return_value=[])
def test_postFinancesInsightsSummary_bedrock_error(mock_groups, mock_sum):
    from api.handler import handler
    result = handler(_event("/finances/insights/summary", "POST", {}), None)
    assert result["statusCode"] == 502


def test_insights_payload_computation():
    from api import bpf

    def fake_txns(user_id, from_date=None, to_date=None, q=None, category=None):
        if from_date and from_date.startswith("2026-07"):
            return [{"date": "2026-07-02", "amount": -100.0, "category": "Dining", "id": "a"},
                    {"date": "2026-07-03", "amount": 500.0, "category": "Income", "id": "b"}]
        if from_date and from_date.startswith("2026-06"):
            return [{"date": "2026-06-10", "amount": -40.0, "category": "Dining", "id": "c"}]
        return [{"date": "2026-05-15", "amount": 300.0, "category": "Income", "id": "d"}]

    with patch.object(bpf, "list_transactions", side_effect=fake_txns), \
         patch.object(bpf.era_client, "is_connected", return_value=False), \
         patch.object(bpf.era_client, "get_insights", return_value=None), \
         patch.object(bpf, "date") as mock_date:
        from datetime import date as real_date
        mock_date.today.return_value = real_date(2026, 7, 7)
        payload = bpf.insights_payload("u1")

    assert payload["period"] == "2026-07"
    assert payload["spendingByCategory"] == {"Dining": 100.0}
    assert payload["comparison"]["previousSpend"] == 40.0
    assert payload["comparison"]["income"] == 500.0
    assert len(payload["forecast"]) == 3
    assert payload["forecast"][0]["month"] == "2026-08"
    assert payload["eraConnected"] is False
    assert "era" not in payload


# --- sharing ----------------------------------------------------------------

@patch("api.bpf.get_share_sections", return_value=["dashboard"])
@patch("api.bpf.overview_payload", return_value={"netWorth": 1.0})
@patch("api.handler._getUserCustomGroups", return_value=[])
def test_shared_overview_allowed(mock_groups, mock_payload, mock_share):
    from api.handler import handler
    result = handler(_event("/finances/overview", query={"owner": "owner-9"}), None)
    assert result["statusCode"] == 200
    mock_payload.assert_called_once_with("owner-9")
    mock_share.assert_called_once_with("owner-9", "user-123")


@patch("api.bpf.get_share_sections", return_value=["transactions"])
@patch("api.handler._getUserCustomGroups", return_value=[])
def test_shared_overview_wrong_section_403(mock_groups, mock_share):
    from api.handler import handler
    result = handler(_event("/finances/overview", query={"owner": "owner-9"}), None)
    assert result["statusCode"] == 403


@patch("api.bpf.get_share_sections", return_value=None)
@patch("api.handler._getUserCustomGroups", return_value=[])
def test_shared_budgets_no_grant_403(mock_groups, mock_share):
    from api.handler import handler
    result = handler(_event("/finances/budgets", query={"owner": "owner-9"}), None)
    assert result["statusCode"] == 403


@patch("api.bpf.put_share", return_value=({"granteeId": "g1", "sections": ["dashboard"]}, None))
@patch("api.handler._resolveCognitoSubByEmail", return_value="g1")
@patch("api.handler._getUserCustomGroups", return_value=[])
def test_putFinancesShares(mock_groups, mock_resolve, mock_put):
    from api.handler import handler
    result = handler(_event("/finances/shares", "PUT",
                            {"email": "friend@example.com", "sections": ["dashboard"]}), None)
    assert result["statusCode"] == 200
    mock_put.assert_called_once_with(
        "user-123", "user@example.com", "g1", "friend@example.com", ["dashboard"])


@patch("api.handler._resolveCognitoSubByEmail", return_value=None)
@patch("api.handler._getUserCustomGroups", return_value=[])
def test_putFinancesShares_unknown_email_404(mock_groups, mock_resolve):
    from api.handler import handler
    result = handler(_event("/finances/shares", "PUT",
                            {"email": "ghost@example.com", "sections": ["dashboard"]}), None)
    assert result["statusCode"] == 404


@patch("api.bpf.delete_share", return_value=True)
@patch("api.handler._getUserCustomGroups", return_value=[])
def test_deleteFinancesShare(mock_groups, mock_del):
    from api.handler import handler
    result = handler(_event("/finances/shares/g1", "DELETE"), None)
    assert result["statusCode"] == 200
    mock_del.assert_called_once_with("user-123", "g1")


@patch("api.bpf.list_shared_with_me", return_value=[{"ownerId": "o1", "sections": ["insights"]}])
@patch("api.handler._getUserCustomGroups", return_value=[])
def test_getFinancesSharedWithMe(mock_groups, mock_list):
    from api.handler import handler
    result = handler(_event("/finances/shared-with-me"), None)
    assert result["statusCode"] == 200
    assert json.loads(result["body"])["sharedWithMe"][0]["ownerId"] == "o1"


def test_put_share_rejects_bad_sections():
    from api.bpf import put_share
    _, err = put_share("o1", "o@x.com", "g1", "g@x.com", ["nope"])
    assert err
    _, err = put_share("o1", "o@x.com", "o1", "o@x.com", ["dashboard"])
    assert err


# --- config + Era degradation ------------------------------------------------

@patch("api.bpf.get_categories", return_value=["Income", "Other"])
@patch("api.handler._getUserCustomGroups", return_value=[])
def test_getFinancesConfig_no_era_key(mock_groups, mock_cats, monkeypatch):
    monkeypatch.delenv("ERA_API_KEY", raising=False)
    from api.handler import handler
    result = handler(_event("/finances/config"), None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["eraConnected"] is False
    assert "Income" in body["categories"]


def test_era_client_disconnected_without_key(monkeypatch):
    monkeypatch.delenv("ERA_API_KEY", raising=False)
    from api import era_client
    assert era_client.is_connected() is False
    assert era_client.get_accounts() == []
    assert era_client.get_transactions() == []
    assert era_client.get_insights() is None


def test_era_client_degrades_on_http_error(monkeypatch):
    monkeypatch.setenv("ERA_API_KEY", "test-key")
    from api import era_client
    era_client._cache.clear()
    with patch.object(era_client.urllib.request, "urlopen", side_effect=OSError("down")):
        assert era_client.get_accounts() == []
        assert era_client.get_transactions() == []
        assert era_client.get_insights() is None


def test_era_client_has_no_write_methods():
    """Guardrail: the Era client is read-only by construction."""
    from api import era_client
    public = [n for n in dir(era_client) if not n.startswith("_") and callable(getattr(era_client, n))]
    banned = ("create", "update", "delete", "post", "put", "patch", "manage", "set_")
    assert not [n for n in public if any(b in n.lower() for b in banned)]


def test_transactions_payload_merges_and_flags_era(monkeypatch):
    from api import bpf
    local = [{"id": "2026-07-01_a", "date": "2026-07-01", "amount": -5.0,
              "payee": "Cafe", "category": "Dining", "notes": "", "source": "local"}]
    era = [{"id": "e1", "date": "2026-07-03", "amount": -9.0,
            "payee": "Shop", "category": "Shopping", "notes": "", "source": "era"}]
    with patch.object(bpf, "list_transactions", return_value=local), \
         patch.object(bpf.era_client, "get_transactions", return_value=era), \
         patch.object(bpf.era_client, "is_connected", return_value=True):
        payload = bpf.transactions_payload("u1")
    assert payload["eraConnected"] is True
    assert [t["id"] for t in payload["transactions"]] == ["e1", "2026-07-01_a"]
    assert payload["transactions"][0]["source"] == "era"


# --- bpf unit helpers ---------------------------------------------------------

def test_txn_sk_roundtrip():
    from api.bpf import _txn_sk
    assert _txn_sk("2026-07-01_abc123") == "BPF#TXN#2026-07-01#abc123"
    assert _txn_sk("garbage") is None
    assert _txn_sk("") is None


def test_month_bounds():
    from api.bpf import _month_bounds
    assert _month_bounds("2026-02") == ("2026-02-01", "2026-02-28")
    assert _month_bounds("2026-12") == ("2026-12-01", "2026-12-31")


def test_summary_prompt_is_capped_and_single_call(monkeypatch):
    """Cost caps: one converse() call, maxTokens 1024, truncated prompt."""
    from api import bpf
    big = {"spendingByCategory": {f"cat{i}": 1.0 for i in range(3000)}, "eraConnected": False}
    client = MagicMock()
    client.converse.return_value = {
        "output": {"message": {"content": [{"text": "Fine. Not financial advice."}]}}}
    boto3_mock = MagicMock()
    boto3_mock.client.return_value = client
    with patch.object(bpf, "insights_payload", return_value=big), \
         patch.object(bpf, "get_budgets", return_value=[]), \
         patch.dict(sys.modules, {"boto3": boto3_mock}):
        text, err = bpf.summarize_insights("u1")
    assert err is None and "Not financial advice." in text
    assert client.converse.call_count == 1
    kwargs = client.converse.call_args.kwargs
    assert kwargs["inferenceConfig"]["maxTokens"] == 1024
    assert kwargs["modelId"] == bpf.BEDROCK_MODEL_ID
    prompt = kwargs["messages"][0]["content"][0]["text"]
    assert len(prompt) < bpf.MAX_PROMPT_CHARS + 400
