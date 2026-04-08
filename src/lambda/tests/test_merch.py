"""Tests for merch catalog, checkout, and webhook helpers."""
import json
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture
def api_event_get_products():
    return {
        "rawPath": "/merch/products",
        "requestContext": {"http": {"method": "GET", "path": "/merch/products"}},
    }


@pytest.fixture
def admin_jwt_context():
    return {
        "requestContext": {
            "http": {"method": "GET", "path": "/admin/merch/products"},
            "authorizer": {
                "jwt": {
                    "claims": {
                        "sub": "admin-user",
                        "email": "a@example.com",
                        "cognito:groups": ["admin"],
                    }
                }
            },
        },
        "rawPath": "/admin/merch/products",
    }


def _with_admin_post(body: dict, method: str = "POST"):
    return {
        "requestContext": {
            "http": {"method": method, "path": "/admin/merch/products"},
            "authorizer": {
                "jwt": {
                    "claims": {
                        "sub": "admin-user",
                        "email": "a@example.com",
                        "cognito:groups": ["admin"],
                    }
                }
            },
        },
        "rawPath": "/admin/merch/products",
        "body": json.dumps(body),
    }


def test_list_merch_products_public_empty(api_event_get_products):
    os.environ["TABLE_NAME"] = "t"
    with patch("boto3.client") as mock_client:
        mock_client.return_value.query.return_value = {"Items": []}
        from api.merch import list_merch_products_public

        r = list_merch_products_public(api_event_get_products)
    assert r["statusCode"] == 200
    body = json.loads(r["body"])
    assert body["products"] == []


def test_list_merch_products_public_active_only(api_event_get_products):
    os.environ["TABLE_NAME"] = "t"
    items = [
        {
            "PK": {"S": "MERCH#PRODUCT"},
            "SK": {"S": "PRODUCT#1"},
            "productId": {"S": "1"},
            "title": {"S": "A"},
            "description": {"S": ""},
            "priceCents": {"N": "1000"},
            "currency": {"S": "usd"},
            "active": {"BOOL": True},
            "gelatoProductUid": {"S": "apparel_test_uid"},
            "imageUrls": {"L": []},
        },
        {
            "PK": {"S": "MERCH#PRODUCT"},
            "SK": {"S": "PRODUCT#2"},
            "productId": {"S": "2"},
            "title": {"S": "B"},
            "description": {"S": ""},
            "priceCents": {"N": "500"},
            "currency": {"S": "usd"},
            "active": {"BOOL": False},
            "gelatoProductUid": {"S": ""},
            "imageUrls": {"L": []},
        },
    ]
    with patch("boto3.client") as mock_client:
        mock_client.return_value.query.return_value = {"Items": items}
        from api.merch import list_merch_products_public

        r = list_merch_products_public(api_event_get_products)
    body = json.loads(r["body"])
    assert len(body["products"]) == 1
    assert body["products"][0]["id"] == "1"


def test_admin_list_requires_auth():
    event = {
        "rawPath": "/admin/merch/products",
        "requestContext": {"http": {"method": "GET", "path": "/admin/merch/products"}},
    }
    from api.merch import list_merch_products_admin

    r = list_merch_products_admin(event)
    assert r["statusCode"] == 401


def test_admin_list_ok(admin_jwt_context):
    os.environ["TABLE_NAME"] = "t"
    with patch("boto3.client") as mock_client:
        mock_client.return_value.query.return_value = {"Items": []}
        from api.merch import list_merch_products_admin

        r = list_merch_products_admin(admin_jwt_context)
    assert r["statusCode"] == 200


def test_create_product_admin():
    os.environ["TABLE_NAME"] = "t"
    ev = _with_admin_post({"title": "Tee", "priceCents": 2500, "gelatoProductUid": "apparel_test_uid", "active": True})
    with patch("boto3.client") as mock_client:
        mock_client.return_value.put_item = MagicMock()
        from api.merch import create_merch_product

        r = create_merch_product(ev)
    assert r["statusCode"] == 201


def test_checkout_session_requires_stripe():
    os.environ["TABLE_NAME"] = "t"
    os.environ["STRIPE_SECRET_KEY"] = ""
    os.environ["MERCH_FRONTEND_BASE_URL"] = "https://example.com"
    try:
        from api.merch import create_merch_checkout_session

        event = {
            "rawPath": "/merch/checkout/session",
            "requestContext": {"http": {"method": "POST", "path": "/merch/checkout/session"}},
            "body": json.dumps({"cart": [{"productId": "x", "quantity": 1}]}),
        }
        r = create_merch_checkout_session(event)
        assert r["statusCode"] == 503
    finally:
        os.environ.pop("STRIPE_SECRET_KEY", None)
        os.environ.pop("MERCH_FRONTEND_BASE_URL", None)


def test_checkout_validates_cart():
    os.environ["TABLE_NAME"] = "t"
    os.environ["STRIPE_SECRET_KEY"] = "sk_test_x"
    os.environ["MERCH_FRONTEND_BASE_URL"] = "https://example.com"
    try:
        from api.merch import create_merch_checkout_session

        event = {
            "rawPath": "/merch/checkout/session",
            "requestContext": {"http": {"method": "POST", "path": "/merch/checkout/session"}},
            "body": json.dumps({"cart": []}),
        }
        r = create_merch_checkout_session(event)
        assert r["statusCode"] == 400
    finally:
        os.environ.pop("STRIPE_SECRET_KEY", None)
        os.environ.pop("MERCH_FRONTEND_BASE_URL", None)


def test_webhook_rejects_missing_sig():
    os.environ["STRIPE_SECRET_KEY"] = "sk_test_x"
    os.environ["STRIPE_WEBHOOK_SECRET"] = "whsec_x"
    try:
        from api.merch import merch_stripe_webhook

        event = {
            "rawPath": "/merch/webhook",
            "requestContext": {"http": {"method": "POST", "path": "/merch/webhook"}},
            "body": "{}",
            "headers": {},
        }
        r = merch_stripe_webhook(event)
        assert r["statusCode"] == 400
    finally:
        os.environ.pop("STRIPE_SECRET_KEY", None)
        os.environ.pop("STRIPE_WEBHOOK_SECRET", None)


def test_handler_merch_routes():
    os.environ["TABLE_NAME"] = "t"
    with patch("boto3.client") as mock_client:
        mock_client.return_value.query.return_value = {"Items": []}
        from api.handler import handler

        ev = {
            "rawPath": "/merch/products",
            "requestContext": {"http": {"method": "GET", "path": "/merch/products"}},
        }
        r = handler(ev, None)
    assert r["statusCode"] == 200
    assert "products" in r["body"]


def test_handler_sqs_fulfillment_dispatches():
    os.environ["TABLE_NAME"] = "t"
    with patch("api.merch.process_fulfillment_sqs") as mock_proc:
        from api.handler import handler

        ev = {
            "Records": [
                {
                    "eventSource": "aws:sqs",
                    "body": '{"orderId":"abc","orderSk":"ORDER#abc"}',
                }
            ]
        }
        r = handler(ev, None)
    mock_proc.assert_called_once()
    assert r == {}
