"""
Merch store: catalog (DynamoDB), Stripe Checkout, webhooks, Gelato fulfillment via SQS.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import uuid
from datetime import datetime
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from common.response import jsonResponse

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ.get("TABLE_NAME", "")
PK_PRODUCT = "MERCH#PRODUCT"
PK_ORDER = "MERCH#ORDER"
PK_STRIPE_EVENT = "MERCH#STRIPE_EVENT"
PK_STRIPE_SESSION = "MERCH#STRIPE_SESSION"
ENTITY_MERCH_PRODUCT = "MERCH_PRODUCT"
ENTITY_MERCH_SESSION_MAP = "MERCH_SESSION_MAP"

def _env(k: str, default: str = "") -> str:
    return os.environ.get(k, default) or default


def _merch_frontend_base_url() -> str:
    return (_env("MERCH_FRONTEND_BASE_URL") or "").rstrip("/")


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _item_to_dict(item: dict) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, val in item.items():
        if "S" in val:
            out[key] = val["S"]
        elif "N" in val:
            num_str = val["N"]
            out[key] = int(num_str) if "." not in num_str else float(num_str)
        elif "BOOL" in val:
            out[key] = val["BOOL"]
        elif "L" in val:
            out[key] = [v.get("S", "") for v in val["L"] if "S" in v]
        elif "NULL" in val:
            out[key] = None
    return out


def _product_from_item(item: dict) -> dict[str, Any]:
    d = _item_to_dict(item)
    pid = (d.get("SK") or "").replace("PRODUCT#", "", 1) if d.get("SK") else ""
    # Prefer gelatoProductUid; legacy DynamoDB attribute printfulVariantId may hold a Gelato UID from migration.
    gelato_uid = (d.get("gelatoProductUid") or d.get("printfulVariantId") or "").strip()
    return {
        "id": d.get("productId") or pid,
        "title": d.get("title", ""),
        "description": d.get("description", ""),
        "imageUrls": d.get("imageUrls") if isinstance(d.get("imageUrls"), list) else [],
        "priceCents": int(d.get("priceCents", 0)),
        "currency": (d.get("currency") or "usd").lower(),
        "active": bool(d.get("active", False)),
        "gelatoProductUid": gelato_uid,
    }


def _optional_cognito_sub(event: dict) -> str | None:
    headers = event.get("headers") or {}
    auth = headers.get("authorization") or headers.get("Authorization") or ""
    if not auth.lower().startswith("bearer "):
        return None
    token = auth[7:].strip()
    pool = _env("COGNITO_USER_POOL_ID")
    if not token or not pool:
        return None
    try:
        import boto3

        client = boto3.client("cognito-idp")
        resp = client.get_user(AccessToken=token)
        for a in resp.get("UserAttributes", []):
            if a.get("Name") == "sub":
                return a.get("Value") or None
        return resp.get("Username")
    except Exception as e:
        logger.info("optional cognito get_user skipped: %s", e)
        return None


def list_merch_products_public(event: dict) -> dict:
    if not TABLE_NAME:
        return jsonResponse({"products": [], "error": "TABLE_NAME not set"}, 200)
    try:
        import boto3

        dynamodb = boto3.client("dynamodb")
        result = dynamodb.query(
            TableName=TABLE_NAME,
            KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues={
                ":pk": {"S": PK_PRODUCT},
                ":sk": {"S": "PRODUCT#"},
            },
        )
        products = []
        for it in result.get("Items", []):
            p = _product_from_item(it)
            if p.get("active"):
                products.append(p)
        products.sort(key=lambda x: (x.get("title") or "").lower())
        return jsonResponse({"products": products})
    except Exception as e:
        logger.exception("list_merch_products_public: %s", e)
        return jsonResponse({"error": str(e), "products": []}, 500)


def list_merch_products_admin(event: dict) -> dict:
    from api.handler import _requireAdmin

    _, err = _requireAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        import boto3

        dynamodb = boto3.client("dynamodb")
        result = dynamodb.query(
            TableName=TABLE_NAME,
            KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues={
                ":pk": {"S": PK_PRODUCT},
                ":sk": {"S": "PRODUCT#"},
            },
        )
        products = [_product_from_item(it) for it in result.get("Items", [])]
        products.sort(key=lambda x: (x.get("title") or "").lower())
        return jsonResponse({"products": products})
    except Exception as e:
        logger.exception("list_merch_products_admin: %s", e)
        return jsonResponse({"error": str(e)}, 500)


def create_merch_product(event: dict) -> dict:
    from api.handler import _requireAdmin

    user, err = _requireAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        body = json.loads(event.get("body") or "{}")
        title = (body.get("title") or "").strip()
        if not title:
            return jsonResponse({"error": "title is required"}, 400)
        price_cents = body.get("priceCents")
        try:
            price_cents = int(price_cents)
        except (TypeError, ValueError):
            return jsonResponse({"error": "priceCents must be an integer"}, 400)
        if price_cents < 0:
            return jsonResponse({"error": "priceCents must be non-negative"}, 400)
        pid = str(body.get("id") or uuid.uuid4())
        sk = f"PRODUCT#{pid}"
        now = _now_iso()
        currency = (body.get("currency") or "usd").lower()
        active = bool(body.get("active", True))
        description = (body.get("description") or "").strip()
        image_urls = body.get("imageUrls")
        if not isinstance(image_urls, list):
            image_urls = []
        image_urls = [str(u).strip() for u in image_urls if str(u).strip()]
        gelato_uid = str(body.get("gelatoProductUid") or body.get("printfulVariantId") or "").strip()
        import boto3

        dynamodb = boto3.client("dynamodb")
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": PK_PRODUCT},
                "SK": {"S": sk},
                "entityType": {"S": ENTITY_MERCH_PRODUCT},
                "entitySk": {"S": sk},
                "productId": {"S": pid},
                "title": {"S": title},
                "description": {"S": description},
                "priceCents": {"N": str(price_cents)},
                "currency": {"S": currency},
                "active": {"BOOL": active},
                "gelatoProductUid": {"S": gelato_uid},
                "imageUrls": {"L": [{"S": u} for u in image_urls]},
                "createdAt": {"S": now},
                "updatedAt": {"S": now},
                "createdBy": {"S": user.get("userId", "")},
            },
        )
        return jsonResponse({"id": pid, "title": title}, 201)
    except Exception as e:
        logger.exception("create_merch_product: %s", e)
        return jsonResponse({"error": str(e)}, 500)


def update_merch_product(event: dict) -> dict:
    from api.handler import _requireAdmin

    _, err = _requireAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        body = json.loads(event.get("body") or "{}")
        pid = (body.get("id") or "").strip()
        if not pid:
            return jsonResponse({"error": "id is required"}, 400)
        sk = f"PRODUCT#{pid}"
        now = _now_iso()
        import boto3

        dynamodb = boto3.client("dynamodb")
        names: dict[str, str] = {"#ua": "updatedAt"}
        values: dict[str, Any] = {":ua": {"S": now}}
        expr = ["#ua = :ua"]
        if "title" in body:
            expr.append("title = :title")
            values[":title"] = {"S": str(body.get("title") or "")}
        if "description" in body:
            expr.append("description = :description")
            values[":description"] = {"S": str(body.get("description") or "")}
        if "priceCents" in body:
            try:
                pc = int(body["priceCents"])
            except (TypeError, ValueError):
                return jsonResponse({"error": "priceCents must be an integer"}, 400)
            expr.append("priceCents = :priceCents")
            values[":priceCents"] = {"N": str(pc)}
        if "currency" in body:
            expr.append("currency = :currency")
            values[":currency"] = {"S": str(body.get("currency") or "usd").lower()}
        if "active" in body:
            expr.append("active = :active")
            values[":active"] = {"BOOL": bool(body.get("active"))}
        if "gelatoProductUid" in body or "printfulVariantId" in body:
            gelato_uid = str(body.get("gelatoProductUid") or body.get("printfulVariantId") or "").strip()
            expr.append("gelatoProductUid = :gelatoProductUid")
            values[":gelatoProductUid"] = {"S": gelato_uid}
        if "imageUrls" in body:
            iu = body.get("imageUrls")
            if not isinstance(iu, list):
                return jsonResponse({"error": "imageUrls must be a list"}, 400)
            urls = [str(u).strip() for u in iu if str(u).strip()]
            expr.append("imageUrls = :imageUrls")
            values[":imageUrls"] = {"L": [{"S": u} for u in urls]}
        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": PK_PRODUCT}, "SK": {"S": sk}},
            UpdateExpression="SET " + ", ".join(expr),
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ConditionExpression="attribute_exists(SK)",
        )
        return jsonResponse({"id": pid, "ok": True})
    except Exception as e:
        logger.exception("update_merch_product: %s", e)
        from botocore.exceptions import ClientError

        if isinstance(e, ClientError) and e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return jsonResponse({"error": "Product not found"}, 404)
        msg = str(e)
        if "ValidationException" in type(e).__name__ or "does not exist" in msg.lower():
            return jsonResponse({"error": "Product not found"}, 404)
        return jsonResponse({"error": str(e)}, 500)


def delete_merch_product(event: dict) -> dict:
    from api.handler import _requireAdmin

    _, err = _requireAdmin(event)
    if err:
        return err
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        body = json.loads(event.get("body") or "{}")
        pid = (body.get("id") or "").strip()
        if not pid:
            return jsonResponse({"error": "id is required"}, 400)
        sk = f"PRODUCT#{pid}"
        import boto3

        dynamodb = boto3.client("dynamodb")
        dynamodb.delete_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": PK_PRODUCT}, "SK": {"S": sk}},
        )
        return jsonResponse({"ok": True})
    except Exception as e:
        logger.exception("delete_merch_product: %s", e)
        return jsonResponse({"error": str(e)}, 500)


def _get_product_by_id(dynamodb, pid: str) -> dict[str, Any] | None:
    sk = f"PRODUCT#{pid}"
    r = dynamodb.get_item(
        TableName=TABLE_NAME,
        Key={"PK": {"S": PK_PRODUCT}, "SK": {"S": sk}},
    )
    it = r.get("Item")
    return _product_from_item(it) if it else None


def create_merch_checkout_session(event: dict) -> dict:
    sk = _env("STRIPE_SECRET_KEY")
    if not sk:
        return jsonResponse({"error": "Stripe is not configured"}, 503)
    base = _merch_frontend_base_url()
    if not base:
        return jsonResponse({"error": "MERCH_FRONTEND_BASE_URL is not configured"}, 503)
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)
    try:
        body = json.loads(event.get("body") or "{}")
        cart = body.get("cart")
        if not isinstance(cart, list) or not cart:
            return jsonResponse({"error": "cart must be a non-empty list"}, 400)
        import boto3
        import stripe

        stripe.api_key = sk
        dynamodb = boto3.client("dynamodb")
        line_items: list[dict[str, Any]] = []
        cognito_sub = _optional_cognito_sub(event)
        for entry in cart:
            if not isinstance(entry, dict):
                return jsonResponse({"error": "invalid cart entry"}, 400)
            pid = str(entry.get("productId", "")).strip()
            qty = entry.get("quantity", 1)
            try:
                qty = int(qty)
            except (TypeError, ValueError):
                return jsonResponse({"error": "invalid quantity"}, 400)
            if qty < 1 or qty > 99:
                return jsonResponse({"error": "quantity must be 1–99"}, 400)
            prod = _get_product_by_id(dynamodb, pid)
            if not prod or not prod.get("active"):
                return jsonResponse({"error": f"Product not available: {pid}"}, 400)
            imgs = prod.get("imageUrls") if isinstance(prod.get("imageUrls"), list) else []
            print_url = str(imgs[0]).strip() if imgs else ""
            gelato_uid = str(prod.get("gelatoProductUid") or "").strip()
            if not gelato_uid:
                return jsonResponse(
                    {"error": f"Product {pid} is missing a Gelato product UID (set in admin)."},
                    400,
                )
            if not print_url:
                return jsonResponse(
                    {
                        "error": f"Product {pid} needs at least one public image URL for Gelato print files.",
                    },
                    400,
                )
            title = prod.get("title") or "Item"
            # Only merchProductId on Stripe product metadata (URLs can exceed Stripe metadata limits).
            meta = {"merchProductId": pid}
            line_items.append(
                {
                    "quantity": qty,
                    "price_data": {
                        "currency": prod.get("currency") or "usd",
                        "unit_amount": int(prod["priceCents"]),
                        "product_data": {
                            "name": title,
                            "metadata": {k: v for k, v in meta.items() if v},
                        },
                    },
                }
            )
        success_url = f"{base}/merch/success?session_id={{CHECKOUT_SESSION_ID}}"
        cancel_url = f"{base}/merch"
        metadata: dict[str, str] = {}
        if cognito_sub:
            metadata["cognitoUserId"] = cognito_sub
        session = stripe.checkout.Session.create(
            mode="payment",
            line_items=line_items,
            success_url=success_url,
            cancel_url=cancel_url,
            shipping_address_collection={"allowed_countries": ["US", "CA", "GB", "AU", "DE", "FR"]},
            metadata=metadata or None,
            client_reference_id=cognito_sub,
        )
        return jsonResponse({"url": session.url, "sessionId": session.id})
    except Exception as e:
        logger.exception("create_merch_checkout_session: %s", e)
        return jsonResponse({"error": str(e)}, 500)


def _stripe_raw_body(event: dict) -> str:
    body = event.get("body") or ""
    if event.get("isBase64Encoded"):
        if isinstance(body, str):
            return base64.b64decode(body).decode("utf-8")
        return base64.b64decode(body).decode("utf-8")
    if isinstance(body, str):
        return body
    return json.dumps(body)


def merch_stripe_webhook(event: dict) -> dict:
    wh_secret = _env("STRIPE_WEBHOOK_SECRET")
    api_secret = _env("STRIPE_SECRET_KEY")
    if not wh_secret or not api_secret:
        return jsonResponse({"error": "Webhook not configured"}, 503)
    import stripe

    stripe.api_key = api_secret
    payload = _stripe_raw_body(event)
    sig = (event.get("headers") or {}).get("stripe-signature") or (event.get("headers") or {}).get("Stripe-Signature")
    if not sig:
        return jsonResponse({"error": "Missing signature"}, 400)
    try:
        stripe_event = stripe.Webhook.construct_event(payload, sig, wh_secret)
    except ValueError:
        return jsonResponse({"error": "Invalid payload"}, 400)
    except Exception as e:
        if type(e).__name__ == "SignatureVerificationError":
            return jsonResponse({"error": "Invalid signature"}, 400)
        raise

    if stripe_event["type"] != "checkout.session.completed":
        return jsonResponse({"received": True})

    session = stripe_event["data"]["object"]
    event_id = stripe_event.get("id", "")
    return _fulfill_checkout_session_completed(session, event_id)


def _fulfill_checkout_session_completed(session: dict, stripe_event_id: str) -> dict:
    import boto3
    import stripe
    from botocore.exceptions import ClientError

    stripe.api_key = _env("STRIPE_SECRET_KEY")
    if not TABLE_NAME:
        return jsonResponse({"error": "TABLE_NAME not set"}, 500)

    dynamodb = boto3.client("dynamodb")
    try:
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": PK_STRIPE_EVENT},
                "SK": {"S": f"EVENT#{stripe_event_id}"},
                "processedAt": {"S": _now_iso()},
            },
            ConditionExpression="attribute_not_exists(PK)",
        )
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            logger.info("stripe event already processed: %s", stripe_event_id)
            return jsonResponse({"received": True, "duplicate": True})
        logger.exception("idempotency put failed: %s", e)
        return jsonResponse({"error": "idempotency failed"}, 500)

    session_id = session.get("id") or ""
    try:
        full = stripe.checkout.Session.retrieve(
            session_id,
            expand=["line_items.data.price.product"],
        )
    except Exception as e:
        logger.exception("retrieve session: %s", e)
        return jsonResponse({"error": "retrieve session failed"}, 500)

    full_dict = full if isinstance(full, dict) else full.to_dict()
    li_wrap = full_dict.get("line_items") or {}
    li_data = li_wrap.get("data") or []
    order_id = str(uuid.uuid4())
    sk = f"ORDER#{order_id}"
    now = _now_iso()
    lines: list[dict[str, Any]] = []
    for row in li_data:
        qty = int(row.get("quantity") or 1)
        price = row.get("price") or {}
        prod = price.get("product")
        if isinstance(prod, str):
            prod = stripe.Product.retrieve(prod)
            prod = prod if isinstance(prod, dict) else prod.to_dict()
        elif prod is not None and not isinstance(prod, dict):
            prod = prod.to_dict()
        meta = (prod or {}).get("metadata") or {}
        pid = str(meta.get("merchProductId") or "").strip()
        gelato_uid = ""
        print_url = ""
        if pid:
            db_prod = _get_product_by_id(dynamodb, pid)
            if db_prod:
                gelato_uid = str(db_prod.get("gelatoProductUid") or "").strip()
                imgs = db_prod.get("imageUrls") if isinstance(db_prod.get("imageUrls"), list) else []
                print_url = str(imgs[0]).strip() if imgs else ""
        lines.append(
            {
                "productId": pid,
                "gelatoProductUid": gelato_uid,
                "gelatoPrintFileUrl": print_url,
                "title": (prod or {}).get("name", ""),
                "quantity": qty,
                "unitAmountCents": int((price.get("unit_amount") or 0)),
            }
        )

    shipping = full_dict.get("shipping_details") or (full_dict.get("collected_information") or {}).get(
        "shipping_details"
    ) or {}
    addr = shipping.get("address") or {}
    customer_details = full_dict.get("customer_details") or {}
    email = customer_details.get("email") or full_dict.get("customer_email") or ""
    cognito_user = (full_dict.get("metadata") or {}).get("cognitoUserId") or full_dict.get("client_reference_id") or ""

    order_item = {
        "PK": {"S": PK_ORDER},
        "SK": {"S": sk},
        "entityType": {"S": "MERCH_ORDER"},
        "entitySk": {"S": sk},
        "orderId": {"S": order_id},
        "status": {"S": "paid"},
        "stripeSessionId": {"S": session_id},
        "stripePaymentIntentId": {"S": str(full_dict.get("payment_intent") or "")},
        "stripeEventId": {"S": stripe_event_id},
        "customerEmail": {"S": email},
        "cognitoUserId": {"S": cognito_user or ""},
        "currency": {"S": str(full_dict.get("currency") or "usd")},
        "amountTotalCents": {"N": str(int(full_dict.get("amount_total") or 0))},
        "shippingName": {"S": str(shipping.get("name") or "")},
        "shippingLine1": {"S": str(addr.get("line1") or "")},
        "shippingLine2": {"S": str(addr.get("line2") or "")},
        "shippingCity": {"S": str(addr.get("city") or "")},
        "shippingState": {"S": str(addr.get("state") or "")},
        "shippingPostalCode": {"S": str(addr.get("postal_code") or "")},
        "shippingCountry": {"S": str(addr.get("country") or "")},
        "lineItemsJson": {"S": json.dumps(lines)},
        "fulfillmentStatus": {"S": "queued"},
        "createdAt": {"S": now},
        "updatedAt": {"S": now},
    }
    try:
        dynamodb.put_item(TableName=TABLE_NAME, Item=order_item)
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": PK_STRIPE_SESSION},
                "SK": {"S": f"SESSION#{session_id}"},
                "entityType": {"S": ENTITY_MERCH_SESSION_MAP},
                "entitySk": {"S": f"SESSION#{session_id}"},
                "orderId": {"S": order_id},
                "orderSk": {"S": sk},
                "createdAt": {"S": now},
            },
        )
    except Exception as e:
        logger.exception("save order: %s", e)
        return jsonResponse({"error": "save order failed"}, 500)

    qurl = _env("MERCH_FULFILLMENT_QUEUE_URL")
    if qurl:
        try:
            boto3.client("sqs").send_message(
                QueueUrl=qurl,
                MessageBody=json.dumps({"orderId": order_id, "orderSk": sk}),
            )
        except Exception as e:
            logger.exception("enqueue fulfillment: %s", e)
    else:
        logger.warning("MERCH_FULFILLMENT_QUEUE_URL not set; fulfillment not queued")

    return jsonResponse({"received": True})


def get_merch_order_status(event: dict) -> dict:
    params = event.get("queryStringParameters") or {}
    session_id = (params.get("session_id") or params.get("sessionId") or "").strip()
    if not session_id or not TABLE_NAME:
        return jsonResponse({"error": "session_id required"}, 400)
    try:
        import boto3

        dynamodb = boto3.client("dynamodb")
        m = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": PK_STRIPE_SESSION}, "SK": {"S": f"SESSION#{session_id}"}},
        )
        mit = m.get("Item")
        if not mit:
            return jsonResponse({"error": "Order not found"}, 404)
        md = _item_to_dict(mit)
        sk = md.get("orderSk") or f"ORDER#{md.get('orderId', '')}"
        r = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": PK_ORDER}, "SK": {"S": sk}},
        )
        it = r.get("Item")
        if not it:
            return jsonResponse({"error": "Order not found"}, 404)
        d = _item_to_dict(it)
        return jsonResponse(
            {
                "orderId": d.get("orderId"),
                "status": d.get("status"),
                "fulfillmentStatus": d.get("fulfillmentStatus"),
                "amountTotalCents": int(d.get("amountTotalCents", 0)),
                "currency": d.get("currency"),
            }
        )
    except Exception as e:
        logger.exception("get_merch_order_status: %s", e)
        return jsonResponse({"error": str(e)}, 500)


def _split_shipping_name(full: str) -> tuple[str, str]:
    full = (full or "").strip() or "Customer"
    parts = full.split(None, 1)
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], parts[1]


def _gelato_create_order(order: dict[str, Any], lines: list[dict[str, Any]]) -> dict[str, Any]:
    api_key = _env("GELATO_API_KEY")
    if not api_key:
        raise RuntimeError("GELATO_API_KEY not set")
    shipment_uid = (_env("GELATO_SHIPMENT_METHOD_UID") or "express").strip()
    phone = (_env("GELATO_ORDER_PHONE") or "0000000000").strip()

    first_name, last_name = _split_shipping_name(str(order.get("shippingName") or ""))
    if not last_name:
        last_name = first_name

    items: list[dict[str, Any]] = []
    oid = str(order.get("orderId") or "")
    for i, ln in enumerate(lines):
        uid = str(ln.get("gelatoProductUid") or "").strip()
        file_url = str(ln.get("gelatoPrintFileUrl") or "").strip()
        if not uid or not file_url:
            continue
        items.append(
            {
                "itemReferenceId": f"{oid}-{i}",
                "productUid": uid,
                "files": [{"type": "default", "url": file_url}],
                "quantity": int(ln.get("quantity") or 1),
            }
        )
    if not items:
        raise RuntimeError("No valid Gelato line items (productUid + print file URL required)")

    currency = str(order.get("currency") or "usd").upper()
    if len(currency) != 3:
        currency = "USD"

    customer_ref = str(order.get("customerEmail") or order.get("cognitoUserId") or "guest").strip() or "guest"
    customer_ref = customer_ref[:200]

    payload: dict[str, Any] = {
        "orderType": "order",
        "orderReferenceId": oid[:200],
        "customerReferenceId": customer_ref,
        "currency": currency,
        "items": items,
        "shipmentMethodUid": shipment_uid,
        "shippingAddress": {
            "firstName": first_name[:100],
            "lastName": last_name[:100],
            "addressLine1": str(order.get("shippingLine1") or "")[:200],
            "addressLine2": str(order.get("shippingLine2") or "")[:200],
            "city": str(order.get("shippingCity") or "")[:100],
            "state": str(order.get("shippingState") or "")[:50],
            "postCode": str(order.get("shippingPostalCode") or "")[:20],
            "country": str(order.get("shippingCountry") or "US").upper()[:2],
            "email": str(order.get("customerEmail") or "")[:200],
            "phone": phone[:40],
        },
    }

    data = json.dumps(payload).encode("utf-8")
    req = Request(
        "https://order.gelatoapis.com/v4/orders",
        data=data,
        headers={
            "X-API-KEY": api_key,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(req, timeout=90) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw)


def process_fulfillment_sqs(event: dict, context: Any) -> dict:
    if not TABLE_NAME:
        return {}
    import boto3

    dynamodb = boto3.client("dynamodb")
    for record in event.get("Records", []):
        try:
            body = json.loads(record.get("body") or "{}")
            oid = (body.get("orderId") or "").strip()
            sk = (body.get("orderSk") or "").strip() or f"ORDER#{oid}"
            if not oid:
                continue
            r = dynamodb.get_item(
                TableName=TABLE_NAME,
                Key={"PK": {"S": PK_ORDER}, "SK": {"S": sk}},
            )
            it = r.get("Item")
            if not it:
                logger.warning("order not found %s", sk)
                continue
            order = _item_to_dict(it)
            if order.get("fulfillmentExternalId"):
                logger.info("order already fulfilled %s", oid)
                continue
            if not _env("GELATO_API_KEY"):
                logger.warning("GELATO_API_KEY missing; marking skipped")
                dynamodb.update_item(
                    TableName=TABLE_NAME,
                    Key={"PK": {"S": PK_ORDER}, "SK": {"S": sk}},
                    UpdateExpression="SET fulfillmentStatus = :fs, updatedAt = :u",
                    ExpressionAttributeValues={
                        ":fs": {"S": "skipped_no_gelato"},
                        ":u": {"S": _now_iso()},
                    },
                )
                continue
            lines = json.loads(order.get("lineItemsJson") or "[]")
            try:
                gelato_resp = _gelato_create_order(order, lines)
            except (HTTPError, URLError, RuntimeError, ValueError, json.JSONDecodeError, KeyError) as e:
                logger.exception("gelato order failed: %s", e)
                dynamodb.update_item(
                    TableName=TABLE_NAME,
                    Key={"PK": {"S": PK_ORDER}, "SK": {"S": sk}},
                    UpdateExpression="SET fulfillmentStatus = :fs, updatedAt = :u",
                    ExpressionAttributeValues={
                        ":fs": {"S": "fulfillment_failed"},
                        ":u": {"S": _now_iso()},
                    },
                )
                continue
            ext_id = str((gelato_resp or {}).get("id") or "").strip()
            if not ext_id:
                logger.error("gelato bad response: %s", gelato_resp)
                dynamodb.update_item(
                    TableName=TABLE_NAME,
                    Key={"PK": {"S": PK_ORDER}, "SK": {"S": sk}},
                    UpdateExpression="SET fulfillmentStatus = :fs, updatedAt = :u",
                    ExpressionAttributeValues={
                        ":fs": {"S": "fulfillment_failed"},
                        ":u": {"S": _now_iso()},
                    },
                )
                continue
            dynamodb.update_item(
                TableName=TABLE_NAME,
                Key={"PK": {"S": PK_ORDER}, "SK": {"S": sk}},
                UpdateExpression="SET fulfillmentStatus = :fs, fulfillmentProvider = :fp, fulfillmentExternalId = :ex, updatedAt = :u",
                ExpressionAttributeValues={
                    ":fs": {"S": "submitted_gelato"},
                    ":fp": {"S": "gelato"},
                    ":ex": {"S": ext_id},
                    ":u": {"S": _now_iso()},
                },
            )
        except Exception as e:
            logger.exception("process_fulfillment_sqs record: %s", e)
    return {}
