"""Shared fixtures. Finance encryption (FUNK-78) must never touch real KMS/DynamoDB in tests."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture(autouse=True)
def _fake_finance_kms(monkeypatch):
    from tests import fake_kms
    fake_kms.install(monkeypatch)
