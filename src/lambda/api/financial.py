"""
Financial: stock quotes from Alpha Vantage or Yahoo Finance.
"""
import json
import logging
import os
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ.get("TABLE_NAME", "")
ALPHA_VANTAGE_API_KEY = os.environ.get("ALPHA_VANTAGE_API_KEY", "")

AVAILABLE_SOURCES = ["yahoo", "alpha_vantage"]


def _fetch_json(url, timeout=10):
    """Fetch URL and return parsed JSON or None."""
    try:
        req = Request(url, headers={"User-Agent": "FunkedUpShift/1.0"})
        with urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except (HTTPError, URLError, json.JSONDecodeError, OSError) as e:
        logger.warning("fetch %s failed: %s", url[:80], e)
        return None


def fetch_quote_alpha_vantage(symbol):
    """
    Fetch quote from Alpha Vantage GLOBAL_QUOTE.
    Returns {symbol, price, change, changePercent, source} or None.
    """
    if not ALPHA_VANTAGE_API_KEY:
        return None
    symbol_upper = (symbol or "").strip().upper()
    if not symbol_upper:
        return None
    url = (
        "https://www.alphavantage.co/query"
        f"?function=GLOBAL_QUOTE&symbol={symbol_upper}&apikey={ALPHA_VANTAGE_API_KEY}"
    )
    data = _fetch_json(url)
    if not data or "Global Quote" not in data:
        return None
    gq = data["Global Quote"]
    price_str = gq.get("05. price", "")
    change_str = gq.get("09. change", "")
    pct_str = gq.get("10. change percent", "0%").rstrip("%")
    try:
        price = float(price_str) if price_str else None
        change = float(change_str) if change_str else 0.0
        change_percent = float(pct_str) if pct_str else 0.0
    except (TypeError, ValueError):
        return None
    if price is None:
        return None
    return {
        "symbol": symbol_upper,
        "price": price,
        "change": change,
        "changePercent": change_percent,
        "source": "alpha_vantage",
    }


def fetch_quote_yahoo(symbol):
    """
    Fetch quote from Yahoo Finance chart API.
    Returns {symbol, price, change, changePercent, source} or None.
    """
    symbol_upper = (symbol or "").strip().upper()
    if not symbol_upper:
        return None
    url = (
        "https://query1.finance.yahoo.com/v8/finance/chart/"
        f"{symbol_upper}?interval=1d&range=1d"
    )
    data = _fetch_json(url)
    if not data or "chart" not in data or "result" not in data["chart"]:
        return None
    results = data["chart"]["result"]
    if not results:
        return None
    meta = results[0].get("meta", {})
    price = meta.get("regularMarketPrice") or meta.get("previousClose") or meta.get("chartPreviousClose")
    if price is None:
        return None
    prev = meta.get("previousClose") or meta.get("chartPreviousClose") or price
    change = float(price) - float(prev)
    change_percent = (change / float(prev) * 100) if prev else 0.0
    return {
        "symbol": symbol_upper,
        "price": float(price),
        "change": round(change, 2),
        "changePercent": round(change_percent, 2),
        "source": "yahoo",
    }


def fetch_quote(symbol, source="yahoo"):
    """Fetch quote from the given source. Fallback to yahoo if alpha_vantage fails."""
    if source == "alpha_vantage":
        quote = fetch_quote_alpha_vantage(symbol)
        if quote:
            return quote
        return fetch_quote_yahoo(symbol)
    return fetch_quote_yahoo(symbol)


def get_user_watchlist(user_id):
    """Get user's watchlist symbols from DynamoDB."""
    if not TABLE_NAME or not user_id:
        return []
    try:
        import boto3
        dynamodb = boto3.client("dynamodb")
        resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": f"USER#{user_id}"}, "SK": {"S": "FINANCIAL#WATCHLIST"}},
            ProjectionExpression="symbols",
        )
        if "Item" not in resp:
            return []
        syms = resp["Item"].get("symbols", {}).get("L", [])
        return [s.get("S", "").strip() for s in syms if s.get("S", "").strip()]
    except Exception as e:
        logger.warning("get_user_watchlist failed: %s", e)
        return []


def save_user_watchlist(user_id, symbols):
    """Save user's watchlist to DynamoDB."""
    if not TABLE_NAME or not user_id:
        return False
    try:
        import boto3
        from datetime import datetime
        dynamodb = boto3.client("dynamodb")
        now = datetime.utcnow().isoformat() + "Z"
        symbols_clean = [str(s).strip().upper() for s in symbols if str(s).strip()]
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": f"USER#{user_id}"},
                "SK": {"S": "FINANCIAL#WATCHLIST"},
                "symbols": {"L": [{"S": s} for s in symbols_clean]},
                "updatedAt": {"S": now},
            },
        )
        return True
    except Exception as e:
        logger.warning("save_user_watchlist failed: %s", e)
        return False


def get_financial_config():
    """Get financial config (default symbols, default source) from DynamoDB."""
    if not TABLE_NAME:
        return {"symbols": [], "source": "yahoo"}
    try:
        import boto3
        dynamodb = boto3.client("dynamodb")
        resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": "FINANCIAL#CONFIG"}, "SK": {"S": "DEFAULTS"}},
        )
        if "Item" not in resp:
            return {"symbols": [], "source": "yahoo"}
        item = resp["Item"]
        syms = item.get("symbols", {}).get("L", [])
        symbols = [s.get("S", "").strip() for s in syms if s.get("S", "").strip()]
        source = item.get("source", {}).get("S", "yahoo")
        if source not in AVAILABLE_SOURCES:
            source = "yahoo"
        return {"symbols": symbols, "source": source}
    except Exception as e:
        logger.warning("get_financial_config failed: %s", e)
        return {"symbols": [], "source": "yahoo"}


def save_financial_config(symbols, source="yahoo"):
    """Save financial config (admin only)."""
    if not TABLE_NAME:
        return False
    try:
        import boto3
        from datetime import datetime
        dynamodb = boto3.client("dynamodb")
        now = datetime.utcnow().isoformat() + "Z"
        symbols_clean = [str(s).strip().upper() for s in symbols if str(s).strip()]
        if source not in AVAILABLE_SOURCES:
            source = "yahoo"
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": "FINANCIAL#CONFIG"},
                "SK": {"S": "DEFAULTS"},
                "symbols": {"L": [{"S": s} for s in symbols_clean]},
                "source": {"S": source},
                "updatedAt": {"S": now},
            },
        )
        return True
    except Exception as e:
        logger.warning("save_financial_config failed: %s", e)
        return False
