"""
Shared HTTP JSON fetch, used by investing.py. The Financial dashboard
(watchlist/quotes) was retired in favour of the Personal Finances app
(FUNK-20); its data functions were removed with it. Orphaned DynamoDB items
(SK=FINANCIAL#WATCHLIST, FINANCIAL#CONFIG) were left in place.
"""
import json
import logging
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def _fetch_json(url, timeout=10):
    """Fetch URL and return parsed JSON or None."""
    try:
        req = Request(url, headers={"User-Agent": "FunkedUpShift/1.0"})
        with urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except (HTTPError, URLError, json.JSONDecodeError, OSError) as e:
        logger.warning("fetch %s failed: %s", url[:80], e)
        return None
