"""Per-user spend budgets for the lipsync module.

Opening this module to all authenticated users makes the fal API key a live
payment path for anyone with an account. A budget is what stands between that
and the card on file.

Model (docs/lipsync-design.md's "Budgets and spend control"): a ONE-TIME
allowance that depletes and does not reset; an admin tops it up. A user with
no record at all has $0 and cannot spend -- a new account can never cost money
by itself.

    PK = USER#{username}   SK = BUDGET

Money is INTEGER CENTS everywhere. Never floats: boto3's Table resource
rejects raw Python floats outright ("Float types are not supported"), and
float arithmetic on currency accumulates error across many small charges.
Values still go through Decimal on the way in because that is what the
DynamoDB serializer wants, and come back as ints via _asInt.

## Why `availableCents` is stored rather than derived

The reserve step must be atomic: a naive "read remaining, then write" lets a
user submit N jobs concurrently, each passing the check before any completes.
The natural guard would be

    ConditionExpression: budgetCents - spentCents - reservedCents >= :cost

but **DynamoDB condition expressions cannot do arithmetic between
attributes** -- they compare an attribute against a value, nothing more.
Arithmetic IS allowed in an UpdateExpression, so the balance is materialised
as its own attribute and the condition compares against that:

    ConditionExpression: availableCents >= :cost
    UpdateExpression:    availableCents -= :cost, reservedCents += :cost

`availableCents` is therefore an invariant maintained by this module, not a
convenience: availableCents == budgetCents - spentCents - reservedCents.
Every function here must preserve it.

A missing item makes the condition fail (the attribute does not exist), which
is exactly the $0-default behaviour -- reserve returns False and no record is
created.
"""
import logging
from datetime import datetime, timezone
from decimal import Decimal

from botocore.exceptions import ClientError

from lipsync.storage import _tbl

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

BUDGET_SK = "BUDGET"


def _budgetKey(username):
    return {"PK": f"USER#{username}", "SK": BUDGET_SK}


def _isoNowUtc():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _asInt(value):
    """DynamoDB numbers come back as Decimal. Budgets are whole cents, so an
    int round-trip is lossless -- but go through Decimal first so a value that
    somehow arrived as a float still lands on a defined result."""
    if value is None:
        return 0
    return int(Decimal(str(value)))


def _cents(value):
    """Normalise to a non-negative integer number of cents, as a Decimal for
    the serializer. Raises on a non-integral input rather than silently
    truncating money."""
    asDecimal = Decimal(str(value))
    if asDecimal != asDecimal.to_integral_value():
        raise ValueError(f"cents must be a whole number, got {value!r}")
    if asDecimal < 0:
        raise ValueError(f"cents must not be negative, got {value!r}")
    return asDecimal


def _shape(item, username):
    """Public shape for the API contract. remainingCents never goes negative:
    an admin can lower a budget below what is already spent, and the contract
    promises a non-negative remaining."""
    budgetCents = _asInt(item.get("budgetCents"))
    spentCents = _asInt(item.get("spentCents"))
    reservedCents = _asInt(item.get("reservedCents"))
    return {
        "username": item.get("username", username),
        "budgetCents": budgetCents,
        "spentCents": spentCents,
        "reservedCents": reservedCents,
        "remainingCents": max(0, budgetCents - spentCents - reservedCents),
        "updatedAt": item.get("updatedAt", ""),
        "updatedBy": item.get("updatedBy", ""),
        "note": item.get("note", ""),
    }


def getBudget(username):
    """The user's budget, or a synthetic all-zero record when none exists.

    Returns a zero record rather than None so callers can render "$0.00 of
    $0.00" uniformly; `exists` distinguishes "no allocation" from "allocated
    and fully spent", which the UI words differently.
    """
    resp = _tbl().get_item(Key=_budgetKey(username))
    item = resp.get("Item")
    if not item:
        return {
            "username": username, "budgetCents": 0, "spentCents": 0,
            "reservedCents": 0, "remainingCents": 0,
            "updatedAt": "", "updatedBy": "", "note": "", "exists": False,
        }
    shaped = _shape(item, username)
    shaped["exists"] = True
    return shaped


def setBudget(username, budgetCents, updatedBy, note=""):
    """Create or update a user's granted allowance (admin action).

    Recomputes the `availableCents` invariant against whatever has already
    been spent/reserved. Lowering a budget below committed spend clamps
    available at 0 rather than going negative -- the already-reserved work
    still settles, it just cannot be added to.
    """
    granted = _cents(budgetCents)
    current = _tbl().get_item(Key=_budgetKey(username)).get("Item") or {}
    spent = _asInt(current.get("spentCents"))
    reserved = _asInt(current.get("reservedCents"))
    available = max(0, int(granted) - spent - reserved)

    item = {
        **_budgetKey(username),
        "username": username,
        "budgetCents": granted,
        "spentCents": Decimal(spent),
        "reservedCents": Decimal(reserved),
        "availableCents": Decimal(available),
        "updatedAt": _isoNowUtc(),
        "updatedBy": updatedBy,
        "note": note or "",
    }
    _tbl().put_item(Item=item)
    return _shape(item, username)


def reserve(username, cents):
    """Atomically hold `cents` against the user's available balance.

    Returns True when the hold succeeded. False means insufficient budget OR
    no budget record at all -- in both cases the caller MUST NOT call the
    provider. This is the only thing standing between an open module and an
    unbounded bill, so it is a conditional write, not a read-then-write.

    A zero-cost reservation still requires an existing record, so a user with
    no allocation can't slip a free job through.
    """
    amount = _cents(cents)
    try:
        _tbl().update_item(
            Key=_budgetKey(username),
            UpdateExpression=(
                "SET availableCents = availableCents - :amount, "
                "reservedCents = reservedCents + :amount, updatedAt = :now"
            ),
            ConditionExpression="attribute_exists(availableCents) AND availableCents >= :amount",
            ExpressionAttributeValues={":amount": amount, ":now": _isoNowUtc()},
        )
        return True
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return False
        raise


def settle(username, reservedCents, actualCents):
    """Convert a hold into settled spend once a job finishes.

    `actualCents` is re-estimated from the MEASURED output duration, which may
    differ from the estimate made at reservation time. The difference is
    reconciled here:
      - cost <= hold: the unused remainder returns to available
      - cost >  hold: the excess is charged; available may go negative, which
        is correct -- the work already ran and was already billed by fal.
        reserve() will then refuse further jobs until the budget is topped up.
    """
    hold = _cents(reservedCents)
    cost = _cents(actualCents)
    refund = int(hold) - int(cost)

    _tbl().update_item(
        Key=_budgetKey(username),
        UpdateExpression=(
            "SET reservedCents = reservedCents - :hold, "
            "spentCents = spentCents + :cost, "
            "availableCents = availableCents + :refund, updatedAt = :now"
        ),
        ExpressionAttributeValues={
            ":hold": hold, ":cost": cost, ":refund": Decimal(refund), ":now": _isoNowUtc(),
        },
    )


def release(username, cents):
    """Return a hold to available, charging the user nothing.

    Used when a job fails or is cancelled. fal may still have billed us for a
    failed render (a job can fail AFTER a successful submit -- that is exactly
    what the HTTP 405 incident did). That gap between what users are charged
    and what fal charges us is deliberate and is surfaced by the admin
    reconciliation view, not hidden.
    """
    amount = _cents(cents)
    _tbl().update_item(
        Key=_budgetKey(username),
        UpdateExpression=(
            "SET reservedCents = reservedCents - :amount, "
            "availableCents = availableCents + :amount, updatedAt = :now"
        ),
        ExpressionAttributeValues={":amount": amount, ":now": _isoNowUtc()},
    )


def listBudgets():
    """Every budget record, for the admin view. Scan filtered on SK -- budget
    items carry neither statusKey nor createdBy so they sit outside both
    GSIs, and the user count here is small. Same Scan-is-fine-at-this-volume
    precedent as storage.listJobs."""
    from boto3.dynamodb.conditions import Attr

    table = _tbl()
    items, kwargs = [], {"FilterExpression": Attr("SK").eq(BUDGET_SK)}
    while True:
        resp = table.scan(**kwargs)
        items.extend(resp.get("Items", []))
        lastKey = resp.get("LastEvaluatedKey")
        if not lastKey:
            break
        kwargs["ExclusiveStartKey"] = lastKey

    budgets = [_shape(i, i.get("username", "")) for i in items]
    budgets.sort(key=lambda b: b["username"])
    return budgets


def totals(budgets):
    """Aggregates for the admin view: what has been promised vs what has
    actually been consumed. Compared against the live fal balance so an admin
    can see when commitments exceed the money that actually exists."""
    return {
        "totalGrantedCents": sum(b["budgetCents"] for b in budgets),
        "totalSpentCents": sum(b["spentCents"] for b in budgets),
        "totalReservedCents": sum(b["reservedCents"] for b in budgets),
    }


def finalizeJobHold(job, actualCents=None):
    """Settle or release a job's budget hold EXACTLY once.

    `actualCents=None` releases the hold (job failed or was cancelled -- the
    user is charged nothing). Otherwise the hold is settled at `actualCents`,
    re-estimated from the measured output duration.

    The one-time guarantee comes from a conditional flip of `budgetSettled` on
    the JOB item, not from any check in the caller: the runner can be replayed
    (EventBridge at-least-once delivery), and a cancel can race the runner's
    own completion. Whoever flips the flag first does the ledger write; every
    later attempt is a silent no-op. Same discipline as the job status machine.

    Returns True when this call performed the write.
    """
    jobId = job.get("jobId")
    hold = _asInt(job.get("reservedCents"))
    username = job.get("budgetIdentity") or ""
    if not jobId or not username:
        return False

    try:
        _tbl().update_item(
            Key={"PK": f"JOB#{jobId}", "SK": "META"},
            UpdateExpression="SET budgetSettled = :true",
            ConditionExpression="budgetSettled = :false",
            ExpressionAttributeValues={":true": True, ":false": False},
        )
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return False  # already settled or released by someone else
        raise

    if actualCents is None:
        release(username, hold)
    else:
        settle(username, hold, actualCents)
    return True
