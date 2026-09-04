"""fal.ai account balance, cached.

    GET https://api.fal.ai/v1/account/billing?expand=credits
    Authorization: Key <FAL_KEY>

## What is verified and what is not -- read before trusting a number

VERIFIED: the route exists. An unauthenticated GET returns 401 with
`{"error": {"type": "authorization_error", ...}}`, which is what a real
endpoint does; a non-route returns 404 (`/v1/account/requests` does).

NOT VERIFIED: the response body's field names, and whether the balance is
denominated in dollars or cents. Confirming that needs an authenticated call
against a funded account. So this module does NOT assume one shape -- it walks
a list of plausible paths (see _CANDIDATE_PATHS) and, when none matches,
returns "unavailable" rather than guessing.

A wrong balance is worse than a missing one: it feeds the admin's
over-commitment view and the low-balance killswitch. Silence is honest;
a fabricated number is not.

`_TREATS_VALUE_AS_DOLLARS` records the other open assumption -- a bare numeric
`balance`/`credits` is read as DOLLARS and converted to cents. If a real
response shows otherwise, flip that one constant. Whenever the shape is not
recognised, the raw top-level keys are logged (never the API key) so the
actual shape can be pinned from a single real call.

There is also no per-request cost endpoint at fal (`/v1/account/requests`
404s; the only breakdown is an async FOCUS billing export), which is why
per-job cost is estimated in providers/fal.py rather than read back.
"""
import json
import logging
from datetime import datetime, timezone
from decimal import Decimal
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from botocore.exceptions import ClientError

from lipsync.secrets import getFalApiKey
from lipsync.storage import _tbl

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

BILLING_URL = "https://api.fal.ai/v1/account/billing?expand=credits"
REQUEST_TIMEOUT_SEC = 10
CACHE_TTL_SECONDS = 60

# Reject new jobs when the real balance is below this, regardless of a user's
# individual budget. Backstop for estimate drift: per-job cost can only ever
# be approximated, so a hard floor on the actual money is the safety net.
# Applies ONLY when a balance was genuinely read -- an unreachable fal must
# not become a total outage. See routes.createJob.
LOW_BALANCE_FLOOR_CENTS = 200

_TREATS_VALUE_AS_DOLLARS = True

# Ordered candidate paths into the JSON, most-specific first. Each is a tuple
# of keys to walk. Extend this rather than rewriting the parser when a real
# response shape is known.
_CANDIDATE_PATHS = (
    ("credits", "balance"),
    ("credits", "remaining"),
    ("credits", "amount"),
    ("balance", "amount"),
    ("account", "credits", "balance"),
    ("data", "credits", "balance"),
    ("credits",),
    ("balance",),
    ("creditBalance",),
    ("credit_balance",),
)

_BALANCE_KEY = {"PK": "SYSTEM#FAL", "SK": "BALANCE"}


class BalanceResult:
    """`cents is None` means unavailable -- callers must render that as
    'unavailable', never as $0.00, and must not apply the killswitch to it."""

    def __init__(self, cents, fetchedAt, stale=False, reason=""):
        self.cents = cents
        self.fetchedAt = fetchedAt
        self.stale = stale
        self.reason = reason

    @property
    def available(self):
        return self.cents is not None

    def toDict(self):
        return {
            "falBalanceCents": self.cents,
            "falBalanceFetchedAt": self.fetchedAt,
            "falBalanceStale": self.stale,
            "falBalanceReason": self.reason,
        }


def _isoNowUtc():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _walk(payload, path):
    node = payload
    for key in path:
        if not isinstance(node, dict) or key not in node:
            return None
        node = node[key]
    return node


def extractBalanceCents(payload):
    """Best-effort balance in integer cents, or None when unrecognised.

    Deliberately strict about types: a string, bool or dict at a candidate
    path is NOT coerced. Guessing wrong here silently corrupts the admin's
    financial view.
    """
    if not isinstance(payload, dict):
        return None
    for path in _CANDIDATE_PATHS:
        value = _walk(payload, path)
        if isinstance(value, bool) or value is None:
            continue
        if isinstance(value, (int, float)):
            asDecimal = Decimal(str(value))
            if _TREATS_VALUE_AS_DOLLARS:
                asDecimal = asDecimal * 100
            return int(asDecimal.to_integral_value())
    return None


def _fetchFromFal():
    """Returns (cents|None, reason). Never raises -- a fal outage degrades the
    admin view, it does not break the module."""
    try:
        apiKey = getFalApiKey()
    except Exception as e:
        logger.warning("billing: could not read the fal API key: %s", type(e).__name__)
        return None, "fal API key unavailable"

    req = Request(BILLING_URL, headers={"Authorization": f"Key {apiKey}"}, method="GET")
    try:
        with urlopen(req, timeout=REQUEST_TIMEOUT_SEC) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        logger.warning("billing: fal returned HTTP %s", e.code)
        return None, f"fal returned HTTP {e.code}"
    except URLError as e:
        logger.warning("billing: could not reach fal: %s", type(e).__name__)
        return None, "could not reach fal"
    except (ValueError, UnicodeDecodeError):
        logger.warning("billing: fal returned a non-JSON body")
        return None, "fal returned a malformed response"

    cents = extractBalanceCents(payload)
    if cents is None:
        # The one case worth loud logging: the call SUCCEEDED but the shape is
        # not one we know. Log the keys (not values, not the key header) so the
        # real shape can be pinned and added to _CANDIDATE_PATHS.
        keys = sorted(payload.keys()) if isinstance(payload, dict) else type(payload).__name__
        logger.warning("billing: unrecognised fal response shape, top-level keys=%s", keys)
        return None, "fal response shape not recognised"
    return cents, ""


def _readCache():
    try:
        item = _tbl().get_item(Key=_BALANCE_KEY).get("Item")
    except ClientError:
        return None
    return item or None


def _writeCache(cents, fetchedAt):
    try:
        _tbl().put_item(Item={
            **_BALANCE_KEY,
            "balanceCents": Decimal(cents),
            "fetchedAt": fetchedAt,
            "fetchedAtEpoch": Decimal(int(datetime.now(timezone.utc).timestamp())),
        })
    except ClientError as e:
        logger.warning("billing: could not cache balance: %s", e.response.get("Error", {}).get("Code"))


def getBalance(force=False):
    """Cached fal balance. `force=True` bypasses the cache (admin refresh).

    On a fetch failure with a cached value present, returns the CACHED value
    marked stale rather than nothing -- a slightly old balance is more useful
    to an admin than a blank, as long as it is labelled.
    """
    now = int(datetime.now(timezone.utc).timestamp())
    cached = _readCache()

    if not force and cached:
        age = now - int(Decimal(str(cached.get("fetchedAtEpoch", 0))))
        if 0 <= age < CACHE_TTL_SECONDS:
            return BalanceResult(int(Decimal(str(cached["balanceCents"]))), cached.get("fetchedAt", ""))

    cents, reason = _fetchFromFal()
    if cents is None:
        if cached and "balanceCents" in cached:
            return BalanceResult(
                int(Decimal(str(cached["balanceCents"]))), cached.get("fetchedAt", ""),
                stale=True, reason=reason,
            )
        return BalanceResult(None, "", reason=reason)

    fetchedAt = _isoNowUtc()
    _writeCache(cents, fetchedAt)
    return BalanceResult(cents, fetchedAt)
