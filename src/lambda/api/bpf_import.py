"""
Bank statement import parsing for Personal Finances (FUNK-29): OFX 1.x SGML,
OFX 2.x XML, QIF, and column-mapped CSV, plus a dedup fingerprint helper.

Pure stdlib, no boto3, no other api imports — parsers take text in and return
uniform row dicts:
    {"date": "YYYY-MM-DD", "amount": float, "payee": str, "fitid": str,
     "accountNumber": str, "ledgerBalance": float|None,
     "ledgerBalanceDate": "YYYY-MM-DD"|None}
CSV rows additionally carry "category" when the mapping provides one.

OFX is parsed with regexes rather than an XML parser: OFX 1.x is SGML with
unclosed tags, which breaks every stdlib XML parser, and the same regexes
handle 2.x XML for free.
"""
import csv
import hashlib
import io
import logging
import re
from datetime import date, datetime

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

CSV_DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%Y/%m/%d")


# ------------------------------------------------------------------------------
# Format detection
# ------------------------------------------------------------------------------

def detect_format(filename, text):
    """Return "ofx" | "qif" | "csv" from extension, else by sniffing content."""
    name = str(filename or "").lower()
    if name.endswith((".ofx", ".qfx")):
        return "ofx"
    if name.endswith(".qif"):
        return "qif"
    if name.endswith(".csv"):
        return "csv"
    head = str(text or "")[:4096]
    if "<OFX>" in head.upper() or "OFXHEADER" in head.upper():
        return "ofx"
    if head.lstrip().lower().startswith("!type:"):
        return "qif"
    return "csv"


# ------------------------------------------------------------------------------
# Shared value helpers
# ------------------------------------------------------------------------------

def _to_amount(raw):
    """Parse '$1,234.56', '(45.00)', '-45.20', '+10' etc. into a float."""
    s = str(raw or "").strip()
    negative = s.startswith("(") and s.endswith(")")
    if negative:
        s = s[1:-1]
    s = s.replace("$", "").replace(",", "").replace(" ", "").lstrip("+")
    try:
        value = float(s) if s else None
    except ValueError:
        value = None
    if value is None:
        raise ValueError(f"could not parse amount {raw!r}")
    return -value if negative else value


def _row(txn_date, amount, payee, fitid="", account_number="",
         ledger_balance=None, ledger_balance_date=None):
    return {
        "date": txn_date,
        "amount": amount,
        "payee": payee,
        "fitid": fitid,
        "accountNumber": account_number,
        "ledgerBalance": ledger_balance,
        "ledgerBalanceDate": ledger_balance_date,
    }


# ------------------------------------------------------------------------------
# OFX (1.x SGML and 2.x XML)
# ------------------------------------------------------------------------------

def _ofx_field(chunk, tag):
    """Value after <TAG>, ending at the next tag or newline (SGML-safe)."""
    m = re.search(rf"<{tag}>\s*([^<\r\n]*)", chunk, re.IGNORECASE)
    return m.group(1).strip() if m else ""


def _ofx_date(raw):
    """DTPOSTED/DTASOF: YYYYMMDD plus optional time/zone — keep first 8 chars."""
    digits = str(raw or "").strip()[:8]
    if not re.fullmatch(r"\d{8}", digits):
        return None
    return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}"


def parse_ofx(text):
    """Parse OFX text into rows; supports multiple <STMTRS>/<CCSTMTRS> blocks."""
    text = str(text or "")
    blocks = re.split(r"<(?:CC)?STMTRS>", text, flags=re.IGNORECASE)
    # blocks[0] is the pre-statement preamble; with no statement tags at all,
    # fall back to scanning the whole text as a single block.
    blocks = blocks[1:] if len(blocks) > 1 else [text]

    rows = []
    for block in blocks:
        account_number = _ofx_field(block, "ACCTID")
        ledger_balance, ledger_balance_date = None, None
        ledger = re.search(
            r"<LEDGERBAL>(.*?)(?=</LEDGERBAL>|<AVAILBAL>|\Z)",
            block, re.IGNORECASE | re.DOTALL,
        )
        if ledger:
            try:
                ledger_balance = _to_amount(_ofx_field(ledger.group(1), "BALAMT"))
            except ValueError:
                ledger_balance = None
            ledger_balance_date = _ofx_date(_ofx_field(ledger.group(1), "DTASOF"))

        for chunk in re.split(r"<STMTTRN>", block, flags=re.IGNORECASE)[1:]:
            txn_date = _ofx_date(_ofx_field(chunk, "DTPOSTED"))
            try:
                amount = _to_amount(_ofx_field(chunk, "TRNAMT"))
            except ValueError:
                amount = None
            if txn_date is None or amount is None:
                logger.warning("Skipping OFX transaction with bad date/amount")
                continue
            payee = _ofx_field(chunk, "NAME") or _ofx_field(chunk, "MEMO")
            rows.append(_row(txn_date, amount, payee, _ofx_field(chunk, "FITID"),
                             account_number, ledger_balance, ledger_balance_date))

    if not rows:
        raise ValueError("No transactions found in OFX file")
    return rows


# ------------------------------------------------------------------------------
# QIF
# ------------------------------------------------------------------------------

def _qif_date(raw):
    """Normalize QIF dates (7/8/2026, 07/08/2026, 7/ 8'26) to YYYY-MM-DD.

    Assumes month/day/year order; 2-digit years are treated as 20xx.
    """
    parts = re.split(r"[/'-]", str(raw or "").replace(" ", ""))
    if len(parts) == 3:
        try:
            month, day, year = (int(p) for p in parts)
            if year < 100:
                year += 2000
            return date(year, month, day).isoformat()
        except ValueError:
            pass
    raise ValueError(f"could not parse QIF date {raw!r}")


def parse_qif(text):
    """Parse QIF text; !Account block records are skipped, not transactions."""
    rows = []
    record = {}
    in_account = False
    for line in str(text or "").splitlines():
        line = line.rstrip()
        if not line:
            continue
        code, value = line[0], line[1:].strip()
        if code == "!":
            header = line.lower()
            if header.startswith("!account"):
                in_account = True
            elif header.startswith("!type"):
                in_account = False
            record = {}
            continue
        if code == "^":
            if not in_account and "date" in record and "amount" in record:
                payee = record.get("payee") or record.get("memo") or ""
                rows.append(_row(record["date"], record["amount"], payee))
            record = {}
            continue
        if in_account:
            continue
        if code == "D":
            record["date"] = _qif_date(value)
        elif code in ("T", "U"):
            record["amount"] = _to_amount(value)
        elif code == "P":
            record["payee"] = value
        elif code == "M":
            record["memo"] = value

    if not rows:
        raise ValueError("No transactions found in QIF file")
    return rows


# ------------------------------------------------------------------------------
# CSV
# ------------------------------------------------------------------------------

def parse_csv(text, mapping):
    """Parse CSV text using a column mapping.

    mapping keys: date (required), payee (required), amount OR debit+credit,
    optional account, category, dateFormat (strptime). Header matching is
    case-insensitive and whitespace-trimmed. Without dateFormat, each row is
    tried against CSV_DATE_FORMATS in order (US month-first wins ambiguity).
    """
    mapping = mapping or {}
    reader = csv.reader(io.StringIO(str(text or "")))
    try:
        header = next(reader)
    except StopIteration:
        raise ValueError("CSV file is empty") from None
    index = {}
    for i, name in enumerate(header):
        key = name.strip().lower()
        if key and key not in index:
            index[key] = i

    def _col(key, required=False):
        name = mapping.get(key)
        if not name:
            if required:
                raise ValueError(f"CSV mapping requires a {key!r} column")
            return None
        idx = index.get(str(name).strip().lower())
        if idx is None:
            raise ValueError(f"CSV has no column named {name!r} (for {key!r})")
        return idx

    date_i = _col("date", required=True)
    payee_i = _col("payee", required=True)
    amount_i = debit_i = credit_i = None
    if mapping.get("amount"):
        amount_i = _col("amount")
    elif mapping.get("debit") and mapping.get("credit"):
        debit_i = _col("debit")
        credit_i = _col("credit")
    else:
        raise ValueError("CSV mapping requires 'amount' or both 'debit' and 'credit'")
    account_i = _col("account")
    category_i = _col("category")
    formats = [mapping["dateFormat"]] if mapping.get("dateFormat") else list(CSV_DATE_FORMATS)

    rows = []
    for row_num, cells in enumerate(reader, start=2):
        if not any(c.strip() for c in cells):
            continue

        def _cell(i):
            return cells[i].strip() if i is not None and i < len(cells) else ""

        raw_date = _cell(date_i)
        parsed_date = None
        for fmt in formats:
            try:
                parsed_date = datetime.strptime(raw_date, fmt)
                break
            except ValueError:
                continue
        if parsed_date is None:
            raise ValueError(f"row {row_num}: could not parse date {raw_date!r}")

        if amount_i is not None:
            try:
                amount = _to_amount(_cell(amount_i))
            except ValueError as exc:
                raise ValueError(f"row {row_num}: {exc}") from None
        else:
            debit, credit = _cell(debit_i), _cell(credit_i)
            try:
                if debit:
                    amount = -abs(_to_amount(debit))
                elif credit:
                    amount = abs(_to_amount(credit))
                else:
                    raise ValueError("no debit or credit value")
            except ValueError as exc:
                raise ValueError(f"row {row_num}: {exc}") from None

        row = _row(parsed_date.strftime("%Y-%m-%d"), amount, _cell(payee_i),
                   account_number=_cell(account_i) if account_i is not None else "")
        if category_i is not None:
            row["category"] = _cell(category_i)
        rows.append(row)

    if not rows:
        raise ValueError("No transactions found in CSV file")
    return rows


# ------------------------------------------------------------------------------
# Dedup fingerprint
# ------------------------------------------------------------------------------

def fingerprint(account_id, txn_date, amount, payee):
    """Stable dedup key: sha1 of account|date|amount(2dp)|normalized payee."""
    payee_norm = " ".join(str(payee or "").lower().split())
    key = f"{account_id}|{txn_date}|{float(amount):.2f}|{payee_norm}"
    return hashlib.sha1(key.encode("utf-8")).hexdigest()
