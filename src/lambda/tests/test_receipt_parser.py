"""Tests for receipt_scanner.parse_fuel_receipt."""
import sys
import os

# Add parent dirs to path so api module is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from api.receipt_scanner import parse_fuel_receipt, _parse_number, _parse_date


class TestParseNumber:
    def test_simple_number(self):
        assert _parse_number("42.50") == 42.50

    def test_currency_symbol(self):
        assert _parse_number("$65.50") == 65.50

    def test_eu_format(self):
        assert _parse_number("65,50") == 65.50

    def test_us_thousands(self):
        assert _parse_number("1,234.56") == 1234.56

    def test_euro_symbol(self):
        assert _parse_number("€42.30") == 42.30

    def test_empty(self):
        assert _parse_number("") is None
        assert _parse_number(None) is None

    def test_non_numeric(self):
        assert _parse_number("abc") is None


class TestParseDate:
    def test_iso_format(self):
        assert _parse_date("2026-04-04") == "2026-04-04"

    def test_dd_mm_yyyy_slash(self):
        assert _parse_date("04/04/2026") == "2026-04-04"

    def test_dd_mm_yyyy_dash(self):
        assert _parse_date("04-04-2026") == "2026-04-04"

    def test_with_month_name(self):
        assert _parse_date("4 April 2026") == "2026-04-04"

    def test_with_short_month(self):
        assert _parse_date("4 Apr 2026") == "2026-04-04"

    def test_invalid(self):
        assert _parse_date("not a date") is None

    def test_empty(self):
        assert _parse_date("") is None


class TestParseFuelReceipt:
    def test_empty_response(self):
        result = parse_fuel_receipt({"ExpenseDocuments": []})
        assert result["date"] is None
        assert result["fuelPrice"] is None
        assert result["fuelLitres"] is None
        assert result["odometerKm"] is None

    def test_basic_receipt(self):
        """Test with a typical Textract AnalyzeExpense response structure."""
        response = {
            "ExpenseDocuments": [
                {
                    "SummaryFields": [
                        {
                            "Type": {"Text": "INVOICE_RECEIPT_DATE"},
                            "ValueDetection": {"Text": "2026-04-04"},
                        },
                        {
                            "Type": {"Text": "TOTAL"},
                            "ValueDetection": {"Text": "$65.50"},
                        },
                    ],
                    "LineItemGroups": [
                        {
                            "LineItems": [
                                {
                                    "LineItemExpenseFields": [
                                        {
                                            "Type": {"Text": "QUANTITY"},
                                            "ValueDetection": {"Text": "42.3"},
                                        },
                                        {
                                            "Type": {"Text": "ITEM"},
                                            "ValueDetection": {"Text": "Unleaded 91"},
                                        },
                                    ]
                                }
                            ]
                        }
                    ],
                }
            ]
        }
        result = parse_fuel_receipt(response)
        assert result["date"] == "2026-04-04"
        assert result["fuelPrice"] == 65.50
        assert result["fuelLitres"] == 42.3
        assert result["odometerKm"] is None

    def test_receipt_with_litres_in_text(self):
        """Test extraction of litres from text patterns like '42.3 L'."""
        response = {
            "ExpenseDocuments": [
                {
                    "SummaryFields": [
                        {
                            "Type": {"Text": "TOTAL"},
                            "ValueDetection": {"Text": "80.00"},
                        },
                    ],
                    "LineItemGroups": [
                        {
                            "LineItems": [
                                {
                                    "LineItemExpenseFields": [
                                        {
                                            "Type": {"Text": "DESCRIPTION"},
                                            "ValueDetection": {"Text": "Fuel 50.5 litres"},
                                        },
                                    ]
                                }
                            ]
                        }
                    ],
                }
            ]
        }
        result = parse_fuel_receipt(response)
        assert result["fuelPrice"] == 80.00
        assert result["fuelLitres"] == 50.5

    def test_receipt_with_odometer(self):
        """Test extraction of handwritten odometer from text."""
        response = {
            "ExpenseDocuments": [
                {
                    "SummaryFields": [
                        {
                            "Type": {"Text": "TOTAL"},
                            "ValueDetection": {"Text": "70.00"},
                        },
                        {
                            "Type": {"Text": "OTHER"},
                            "ValueDetection": {"Text": "odometer: 123456"},
                        },
                    ],
                    "LineItemGroups": [],
                }
            ]
        }
        result = parse_fuel_receipt(response)
        assert result["odometerKm"] == 123456

    def test_receipt_with_amount_paid(self):
        """Test AMOUNT_PAID summary field type."""
        response = {
            "ExpenseDocuments": [
                {
                    "SummaryFields": [
                        {
                            "Type": {"Text": "AMOUNT_PAID"},
                            "ValueDetection": {"Text": "€55,90"},
                        },
                    ],
                    "LineItemGroups": [],
                }
            ]
        }
        result = parse_fuel_receipt(response)
        assert result["fuelPrice"] == 55.90

    def test_no_expense_documents(self):
        result = parse_fuel_receipt({})
        assert result["date"] is None
        assert result["fuelPrice"] is None
