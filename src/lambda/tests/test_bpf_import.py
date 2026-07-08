"""Unit tests for bank statement import parsing (FUNK-29, api/bpf_import.py)."""
import hashlib
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api import bpf_import


OFX_SGML = """OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>123456
<ACCTID>CHK-001
</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260701120000[-5:EST]
<TRNAMT>-45.20
<FITID>abc123
<NAME>SHELL 1234
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260702
<TRNAMT>1500.00
<FITID>abc124
<MEMO>PAYROLL DEPOSIT
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>2100.55
<DTASOF>20260703080000
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
<CREDITCARDMSGSRSV1>
<CCSTMTTRNRS>
<CCSTMTRS>
<CURDEF>USD
<CCACCTFROM>
<ACCTID>CC-999
</CCACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<DTPOSTED>20260628
<TRNAMT>-12.99
<FITID>cc-1
<NAME>NETFLIX
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>-450.00
<DTASOF>20260703
</LEDGERBAL>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>
"""

OFX_XML = """<?xml version="1.0" encoding="UTF-8"?>
<OFX>
  <BANKMSGSRSV1><STMTTRNRS><STMTRS>
    <BANKACCTFROM><ACCTID>CHK-XML</ACCTID></BANKACCTFROM>
    <BANKTRANLIST>
      <STMTTRN>
        <DTPOSTED>20260705080000.000[-5:EST]</DTPOSTED>
        <TRNAMT>-12.34</TRNAMT>
        <FITID>x1</FITID>
        <NAME>COFFEE SHOP</NAME>
      </STMTTRN>
    </BANKTRANLIST>
    <LEDGERBAL><BALAMT>999.99</BALAMT><DTASOF>20260706</DTASOF></LEDGERBAL>
  </STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>
"""

QIF_BANK = """!Type:Bank
D7/1/2026
T-45.20
PSHELL 1234
^
D7/ 8'26
U1,500.00
MPAYROLL DEPOSIT
^
"""

QIF_WITH_ACCOUNT_BLOCK = """!Account
NChecking
TBank
^
!Type:Bank
D07/02/2026
T-10.00
PCoffee
^
"""


# --- detect_format -----------------------------------------------------------

def test_detect_format_by_extension():
    assert bpf_import.detect_format("stmt.ofx", "") == "ofx"
    assert bpf_import.detect_format("STMT.QFX", "") == "ofx"
    assert bpf_import.detect_format("stmt.qif", "") == "qif"
    assert bpf_import.detect_format("stmt.csv", "") == "csv"


def test_detect_format_sniffing():
    assert bpf_import.detect_format("upload.txt", "OFXHEADER:100\n<OFX>") == "ofx"
    assert bpf_import.detect_format("upload", "<OFX><BANKMSGSRSV1>") == "ofx"
    assert bpf_import.detect_format("upload.txt", "\n!Type:Bank\nD7/1/2026") == "qif"
    assert bpf_import.detect_format("upload.txt", "date,payee,amount") == "csv"


# --- OFX ---------------------------------------------------------------------

def test_parse_ofx_sgml_two_statements():
    rows = bpf_import.parse_ofx(OFX_SGML)
    assert len(rows) == 3
    chk = [r for r in rows if r["accountNumber"] == "CHK-001"]
    cc = [r for r in rows if r["accountNumber"] == "CC-999"]
    assert len(chk) == 2 and len(cc) == 1
    assert chk[0] == {
        "date": "2026-07-01", "amount": -45.20, "payee": "SHELL 1234",
        "fitid": "abc123", "accountNumber": "CHK-001",
        "ledgerBalance": 2100.55, "ledgerBalanceDate": "2026-07-03",
    }
    # MEMO fallback when NAME is absent
    assert chk[1]["payee"] == "PAYROLL DEPOSIT"
    assert chk[1]["amount"] == 1500.00
    assert cc[0]["payee"] == "NETFLIX"
    assert cc[0]["ledgerBalance"] == -450.00
    assert cc[0]["ledgerBalanceDate"] == "2026-07-03"


def test_parse_ofx_xml():
    rows = bpf_import.parse_ofx(OFX_XML)
    assert rows == [{
        "date": "2026-07-05", "amount": -12.34, "payee": "COFFEE SHOP",
        "fitid": "x1", "accountNumber": "CHK-XML",
        "ledgerBalance": 999.99, "ledgerBalanceDate": "2026-07-06",
    }]


def test_parse_ofx_garbage_raises():
    with pytest.raises(ValueError, match="No transactions"):
        bpf_import.parse_ofx("this is not an ofx file at all")


# --- QIF ---------------------------------------------------------------------

def test_parse_qif_both_date_styles():
    rows = bpf_import.parse_qif(QIF_BANK)
    assert len(rows) == 2
    assert rows[0]["date"] == "2026-07-01"
    assert rows[0]["amount"] == -45.20
    assert rows[0]["payee"] == "SHELL 1234"
    assert rows[0]["fitid"] == "" and rows[0]["accountNumber"] == ""
    assert rows[0]["ledgerBalance"] is None
    # Quicken's "7/ 8'26" style, U amount with comma, memo payee fallback
    assert rows[1]["date"] == "2026-07-08"
    assert rows[1]["amount"] == 1500.00
    assert rows[1]["payee"] == "PAYROLL DEPOSIT"


def test_parse_qif_skips_account_block():
    rows = bpf_import.parse_qif(QIF_WITH_ACCOUNT_BLOCK)
    assert len(rows) == 1
    assert rows[0]["payee"] == "Coffee"
    assert rows[0]["date"] == "2026-07-02"


def test_parse_qif_garbage_raises():
    with pytest.raises(ValueError, match="No transactions"):
        bpf_import.parse_qif("total garbage\nnothing here\n")


# --- CSV ---------------------------------------------------------------------

def test_parse_csv_single_amount_column():
    text = ("Date, Payee ,Amount,Category,Account\n"
            "2026-07-01,SHELL 1234,-45.20,Transportation,CHK-001\n"
            "\n"
            "07/02/2026,Payroll,1500.00,Income,CHK-001\n")
    mapping = {"date": "date", "payee": "PAYEE", "amount": "amount",
               "category": "category", "account": "Account"}
    rows = bpf_import.parse_csv(text, mapping)
    assert len(rows) == 2
    assert rows[0] == {
        "date": "2026-07-01", "amount": -45.20, "payee": "SHELL 1234",
        "fitid": "", "accountNumber": "CHK-001",
        "ledgerBalance": None, "ledgerBalanceDate": None,
        "category": "Transportation",
    }
    assert rows[1]["date"] == "2026-07-02"  # per-row fallback format


def test_parse_csv_debit_credit_and_money_formats():
    text = ('date,description,debit,credit\n'
            '2026-07-01,Big purchase,"$1,234.56",\n'
            '2026-07-02,Fee,(45.00),\n'
            '2026-07-03,Deposit,,100.00\n')
    mapping = {"date": "date", "payee": "description",
               "debit": "debit", "credit": "credit"}
    rows = bpf_import.parse_csv(text, mapping)
    assert [r["amount"] for r in rows] == [-1234.56, -45.00, 100.00]
    assert "category" not in rows[0]


def test_parse_csv_bad_date_names_row():
    text = "date,payee,amount\nnot-a-date,Shop,1.00\n"
    mapping = {"date": "date", "payee": "payee", "amount": "amount"}
    with pytest.raises(ValueError, match="row 2"):
        bpf_import.parse_csv(text, mapping)


def test_parse_csv_garbage_raises():
    mapping = {"date": "date", "payee": "payee", "amount": "amount"}
    with pytest.raises(ValueError):
        bpf_import.parse_csv("complete nonsense with no matching header", mapping)


# --- fingerprint ---------------------------------------------------------------

def test_fingerprint_stable_format():
    expected = hashlib.sha1(b"acct1|2026-07-01|-45.20|shell 1234").hexdigest()
    assert bpf_import.fingerprint("acct1", "2026-07-01", -45.2, "shell 1234") == expected


def test_fingerprint_payee_normalization():
    a = bpf_import.fingerprint("acct1", "2026-07-01", -45.20, "  SHELL   1234 ")
    b = bpf_import.fingerprint("acct1", "2026-07-01", -45.2, "shell 1234")
    assert a == b
    assert a != bpf_import.fingerprint("acct2", "2026-07-01", -45.2, "shell 1234")
