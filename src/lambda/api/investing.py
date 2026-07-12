"""
Investing: Yahoo Finance research (search, candles, P/E),
Bedrock AI ticker suggestions + buy-timing analysis, per-user tracker.
"""
import json
import logging
import os
import re
from urllib.parse import quote

from api.financial import _fetch_json

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ.get("TABLE_NAME", "")
BEDROCK_MODEL_ID = "amazon.nova-micro-v1:0"

VALID_RANGES = ["1mo", "3mo", "6mo", "1y", "2y", "5y", "max"]
VALID_INTERVALS = ["1d", "1wk", "1mo"]


def search_symbols(query):
    """Yahoo symbol search. Returns [{symbol, name, exchange, exchDisp, quoteType}]."""
    q = (query or "").strip()
    if not q:
        return []
    url = (
        "https://query1.finance.yahoo.com/v1/finance/search"
        f"?q={quote(q)}&quotesCount=10&newsCount=0"
    )
    data = _fetch_json(url)
    if not data or "quotes" not in data:
        return []
    results = []
    for item in data["quotes"]:
        symbol = item.get("symbol")
        if not symbol:
            continue
        results.append({
            "symbol": symbol,
            "name": item.get("shortname") or item.get("longname") or symbol,
            "exchange": item.get("exchange", ""),
            "exchDisp": item.get("exchDisp", item.get("exchange", "")),
            "quoteType": item.get("quoteType", ""),
        })
    return results


def get_candles(symbol, range="1y", interval="1d"):
    """
    Yahoo chart OHLCV. Returns {symbol, meta: {...}, candles: [{t,o,h,l,c,v}]} or None.
    """
    symbol_upper = (symbol or "").strip().upper()
    if not symbol_upper:
        return None
    if range not in VALID_RANGES:
        range = "1y"
    if interval not in VALID_INTERVALS:
        interval = "1d"
    url = (
        "https://query1.finance.yahoo.com/v8/finance/chart/"
        f"{quote(symbol_upper)}?range={range}&interval={interval}"
    )
    data = _fetch_json(url)
    if not data or not data.get("chart", {}).get("result"):
        return None
    result = data["chart"]["result"][0]
    meta = result.get("meta", {})
    timestamps = result.get("timestamp", [])
    quotes = result.get("indicators", {}).get("quote", [{}])[0]
    opens = quotes.get("open", [])
    highs = quotes.get("high", [])
    lows = quotes.get("low", [])
    closes = quotes.get("close", [])
    volumes = quotes.get("volume", [])
    candles = []
    for i, t in enumerate(timestamps):
        try:
            o, h, l, c = opens[i], highs[i], lows[i], closes[i]
        except IndexError:
            break
        if None in (o, h, l, c):
            continue
        v = volumes[i] if i < len(volumes) else None
        candles.append({"t": t, "o": o, "h": h, "l": l, "c": c, "v": v or 0})
    return {
        "symbol": symbol_upper,
        "meta": {
            "price": meta.get("regularMarketPrice"),
            "currency": meta.get("currency"),
            "exchangeName": meta.get("fullExchangeName") or meta.get("exchangeName"),
            "name": meta.get("shortName") or meta.get("longName") or symbol_upper,
        },
        "candles": candles,
    }


# quoteSummary requires Yahoo's cookie+crumb handshake; cache per lambda container
_yahoo_session = {"opener": None, "crumb": None}
_BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"


def _get_yahoo_session():
    """Cookie-carrying opener + crumb for authed Yahoo endpoints. Returns (opener, crumb)."""
    if _yahoo_session["crumb"]:
        return _yahoo_session["opener"], _yahoo_session["crumb"]
    import http.cookiejar
    from urllib.request import HTTPCookieProcessor, build_opener
    opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
    opener.addheaders = [("User-Agent", _BROWSER_UA)]
    try:
        opener.open("https://fc.yahoo.com", timeout=10)
    except Exception:
        pass  # 404 expected; the response still sets the session cookie
    try:
        with opener.open("https://query1.finance.yahoo.com/v1/test/getcrumb", timeout=10) as resp:
            crumb = resp.read().decode().strip()
    except Exception as e:
        logger.warning("yahoo getcrumb failed: %s", e)
        return None, None
    if not crumb:
        return None, None
    _yahoo_session["opener"] = opener
    _yahoo_session["crumb"] = crumb
    return opener, crumb


def get_pe(symbol):
    """Yahoo quoteSummary P/E. Returns {trailingPE, forwardPE} (values may be None)."""
    symbol_upper = (symbol or "").strip().upper()
    if not symbol_upper:
        return {"trailingPE": None, "forwardPE": None}
    opener, crumb = _get_yahoo_session()
    data = None
    if opener:
        url = (
            "https://query1.finance.yahoo.com/v10/finance/quoteSummary/"
            f"{quote(symbol_upper)}?modules=summaryDetail,defaultKeyStatistics"
            f"&crumb={quote(crumb)}"
        )
        try:
            with opener.open(url, timeout=10) as resp:
                data = json.loads(resp.read().decode())
        except Exception as e:
            logger.warning("quoteSummary %s failed: %s", symbol_upper, e)
            _yahoo_session["crumb"] = None  # stale crumb; next call re-handshakes
    result = (data or {}).get("quoteSummary", {}).get("result") or [{}]
    summary = result[0].get("summaryDetail", {})
    stats = result[0].get("defaultKeyStatistics", {})
    trailing = summary.get("trailingPE", {}).get("raw")
    forward = summary.get("forwardPE", {}).get("raw") or stats.get("forwardPE", {}).get("raw")
    return {"trailingPE": trailing, "forwardPE": forward}


def get_ticker_data(symbol, range="1y", interval="1d"):
    """Candles + meta + P/E in one payload. Returns dict or None."""
    data = get_candles(symbol, range, interval)
    if not data:
        return None
    try:
        data["pe"] = get_pe(symbol)
    except Exception as e:
        logger.warning("get_pe failed for %s: %s", symbol, e)
        data["pe"] = {"trailingPE": None, "forwardPE": None}
    return data


def _converse(prompt, max_tokens=512):
    """Call Bedrock Nova Micro via Converse. Returns text or ''."""
    import boto3

    region = os.environ.get("AWS_REGION", "us-east-1")
    client = boto3.client("bedrock-runtime", region_name=region)
    response = client.converse(
        modelId=BEDROCK_MODEL_ID,
        messages=[{"role": "user", "content": [{"text": prompt}]}],
        inferenceConfig={"maxTokens": max_tokens, "temperature": 0.3},
    )
    for block in response.get("output", {}).get("message", {}).get("content", []):
        if block.get("text"):
            return block["text"].strip()
    return ""


def _parse_ticker_array(text):
    """Extract first JSON array of strings from model output. Returns []."""
    if not text:
        return []
    match = re.search(r"\[[^\]]*\]", text, re.DOTALL)
    if not match:
        return []
    try:
        arr = json.loads(match.group(0))
    except json.JSONDecodeError:
        return []
    if not isinstance(arr, list):
        return []
    return [str(s).strip().upper() for s in arr if str(s).strip()][:8]


def suggest_tickers(query):
    """
    AI query -> validated tickers. Returns [{symbol, name, exchange, exchDisp}].
    Hallucinated symbols drop out at Yahoo-search validation.
    """
    prompt = (
        "You are a stock screener. Return ONLY a JSON array (max 8) of ticker "
        "symbols for stocks, ETFs, or commodity futures matching this request. "
        "Symbols must be valid Yahoo Finance tickers (e.g. AAPL, GLD, GC=F). "
        f"No prose, no explanation.\n\nRequest: {query}"
    )
    text = _converse(prompt, max_tokens=256)
    validated = []
    for sym in _parse_ticker_array(text):
        for hit in search_symbols(sym):
            if hit["symbol"].upper() == sym:
                validated.append(hit)
                break
    return validated


def analyze_ticker(symbol):
    """
    Feed real 1y weekly history + P/E to Bedrock for a buy-timing assessment.
    Returns {symbol, analysis} or None if data unavailable.
    """
    data = get_candles(symbol, "1y", "1wk")
    if not data or not data["candles"]:
        return None
    pe = get_pe(symbol)
    closes = [round(c["c"], 2) for c in data["candles"]]
    meta = data["meta"]
    prompt = (
        "You are an investment research assistant. Using ONLY the data below, "
        f"assess whether now looks like a favorable time to buy {data['symbol']}: "
        "consider current price vs its 52-week range, the trend over the past "
        "year, and valuation from P/E (if available). Maximum 150 words. "
        "End with 'Not financial advice.'\n\n"
        f"Name/Exchange: {meta.get('name')} / {meta.get('exchangeName')}\n"
        f"Current price: {meta.get('price')} {meta.get('currency') or ''}\n"
        f"52-week high/low: {max(c['h'] for c in data['candles'])} / "
        f"{min(c['l'] for c in data['candles'])}\n"
        f"Trailing P/E: {pe.get('trailingPE')}  Forward P/E: {pe.get('forwardPE')}\n"
        f"Weekly closes (oldest to newest): {closes}"
    )
    analysis = _converse(prompt)
    if not analysis:
        return None
    return {"symbol": data["symbol"], "analysis": analysis}


def get_tracker(user_id):
    """Get user's tracked symbols from DynamoDB."""
    if not TABLE_NAME or not user_id:
        return []
    try:
        import boto3
        dynamodb = boto3.client("dynamodb")
        resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": f"USER#{user_id}"}, "SK": {"S": "INVESTING#TRACKER"}},
            ProjectionExpression="symbols",
        )
        if "Item" not in resp:
            return []
        syms = resp["Item"].get("symbols", {}).get("L", [])
        return [s.get("S", "").strip() for s in syms if s.get("S", "").strip()]
    except Exception as e:
        logger.warning("get_tracker failed: %s", e)
        return []


def save_tracker(user_id, symbols):
    """Save user's tracked symbols to DynamoDB."""
    if not TABLE_NAME or not user_id:
        return False
    try:
        import boto3
        from datetime import datetime, timezone
        dynamodb = boto3.client("dynamodb")
        now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"
        symbols_clean = [str(s).strip().upper() for s in symbols if str(s).strip()]
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": f"USER#{user_id}"},
                "SK": {"S": "INVESTING#TRACKER"},
                "symbols": {"L": [{"S": s} for s in symbols_clean]},
                "updatedAt": {"S": now},
            },
        )
        return True
    except Exception as e:
        logger.warning("save_tracker failed: %s", e)
        return False
