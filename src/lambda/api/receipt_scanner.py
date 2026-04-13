"""Receipt scanning via AWS Textract AnalyzeExpense."""
import logging
import os
import re
import uuid

logger = logging.getLogger(__name__)

MEDIA_BUCKET = os.environ.get("MEDIA_BUCKET", "")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")


def get_receipt_upload_url(user_id, content_type):
    """Generate presigned PUT URL for receipt image upload."""
    if not MEDIA_BUCKET or not user_id:
        return None
    ext = ".jpg"
    if content_type:
        ext_map = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
        ext = ext_map.get(content_type, ".jpg")
    key = f"receipts/{user_id}/{uuid.uuid4()}{ext}"
    try:
        import boto3
        s3 = boto3.client("s3", region_name=AWS_REGION)
        params = {"Bucket": MEDIA_BUCKET, "Key": key}
        if content_type:
            params["ContentType"] = content_type
        upload_url = s3.generate_presigned_url("put_object", Params=params, ExpiresIn=3600)
        return {
            "uploadUrl": upload_url,
            "key": key,
            "contentType": content_type or "image/jpeg",
        }
    except Exception as e:
        logger.warning("get_receipt_upload_url failed: %s", e)
        return None


def scan_fuel_receipt(image_key):
    """Extract fuel receipt fields using two Textract passes.

    Pass 1 – AnalyzeExpense: structured fields (date, total).
    Pass 2 – AnalyzeDocument + QUERIES: fuel litres and odometer.
             QUERIES handles printed *and* handwritten text, and lets us ask
             plain-English questions so Textract knows what to look for even
             in non-standard pump-receipt formats like "46.234L @ $2.159/L".
    """
    if not MEDIA_BUCKET or not image_key:
        return None
    try:
        import boto3
        textract = boto3.client("textract", region_name=AWS_REGION)
        doc = {"S3Object": {"Bucket": MEDIA_BUCKET, "Name": image_key}}

        # --- Pass 1: AnalyzeExpense for date and total price ---
        expense_resp = textract.analyze_expense(Document=doc)
        result = parse_fuel_receipt(expense_resp)
        # Log what AnalyzeExpense found
        expense_text = _get_all_text(expense_resp.get("ExpenseDocuments", [{}])[0]) if expense_resp.get("ExpenseDocuments") else ""
        logger.info("AnalyzeExpense text: %s", expense_text[:1000])
        logger.info("AnalyzeExpense result: %s", result)

        # --- Pass 2: AnalyzeDocument with QUERIES for fuel-specific fields ---
        # Also extracts all raw LINE text blocks for regex fallback.
        queries = [
            # Specific to Canadian pump format: "51.309L AT $2.339/L"
            {"Text": "How many litres of fuel were pumped? Look for a number followed by L.",
             "Alias": "FUEL_LITRES"},
            # Odometer is often a bare handwritten number at the top of the receipt
            {"Text": "What is the handwritten number at the top of the receipt?",
             "Alias": "ODOMETER"},
        ]
        # Only ask for date/price if pass 1 didn't find them.
        if not result["date"]:
            queries.append({"Text": "What is the date on this receipt?", "Alias": "DATE"})
        if result["fuelPrice"] is None:
            queries.append({"Text": "What is the total amount or fuel sales amount?",
                            "Alias": "TOTAL"})

        doc_resp = textract.analyze_document(
            Document=doc,
            FeatureTypes=["QUERIES"],
            QueriesConfig={"Queries": queries},
        )

        # Pull structured query answers.
        query_answers = _extract_query_answers(doc_resp)
        logger.info("Textract query answers: %s", query_answers)

        if result["fuelLitres"] is None and "FUEL_LITRES" in query_answers:
            result["fuelLitres"] = _parse_number(query_answers["FUEL_LITRES"])
        if result["odometerKm"] is None and "ODOMETER" in query_answers:
            parsed = _parse_number(query_answers["ODOMETER"])
            if parsed is not None and 1_000 <= parsed <= 9_999_999:
                result["odometerKm"] = parsed
        if not result["date"] and "DATE" in query_answers:
            result["date"] = _parse_date(query_answers["DATE"])
        if result["fuelPrice"] is None and "TOTAL" in query_answers:
            result["fuelPrice"] = _parse_number(query_answers["TOTAL"])

        # --- Extract from raw blocks with special handling ---
        blocks = doc_resp.get("Blocks", [])
        raw_lines = [
            b["Text"]
            for b in blocks
            if b.get("BlockType") == "LINE" and b.get("Text")
        ]
        raw_text = " ".join(raw_lines).lower()
        logger.info("AnalyzeDocument raw lines: %s", raw_lines[:30])

        # Fuel litres: regex over all text
        if result["fuelLitres"] is None:
            result["fuelLitres"] = _extract_litres_from_text(raw_text)

        # Odometer: first try handwriting detection, then regex fallback
        if result["odometerKm"] is None:
            result["odometerKm"] = _extract_handwritten_odometer(blocks)
        if result["odometerKm"] is None:
            result["odometerKm"] = _extract_odometer_from_text(raw_text)

        # Include raw text for frontend debugging (temporary — can remove later)
        result["_debug"] = {
            "expenseText": expense_text[:500] if expense_text else "",
            "queryAnswers": query_answers,
            "rawLines": raw_lines[:30],
        }

        return result
    except Exception as e:
        logger.exception("scan_fuel_receipt error: %s", e)
        return {"error": str(e)}


def _extract_query_answers(doc_response):
    """Parse QUERY_RESULT blocks from an AnalyzeDocument response.

    Returns a dict of {alias: answer_text} for results with high confidence.
    """
    blocks = doc_response.get("Blocks", [])
    # Build id→block lookup.
    by_id = {b["Id"]: b for b in blocks}
    answers = {}
    for block in blocks:
        if block.get("BlockType") != "QUERY":
            continue
        alias = block.get("Query", {}).get("Alias", "")
        if not alias:
            continue
        for rel in block.get("Relationships", []):
            if rel.get("Type") != "ANSWER":
                continue
            for answer_id in rel.get("Ids", []):
                answer_block = by_id.get(answer_id, {})
                if answer_block.get("BlockType") == "QUERY_RESULT":
                    confidence = answer_block.get("Confidence", 0)
                    text = answer_block.get("Text", "").strip()
                    if text and confidence >= 50:
                        answers[alias] = text
    return answers


def parse_fuel_receipt(textract_response):
    """Extract fuel receipt fields from Textract AnalyzeExpense response.

    Returns dict with keys: date, fuelPrice, fuelLitres, odometerKm (all nullable).
    """
    result = {
        "date": None,
        "fuelPrice": None,
        "fuelLitres": None,
        "odometerKm": None,
    }

    expense_docs = textract_response.get("ExpenseDocuments", [])
    if not expense_docs:
        return result

    doc = expense_docs[0]

    # Extract from summary fields
    for field in doc.get("SummaryFields", []):
        field_type = _get_field_type(field)
        field_value = _get_field_value(field)
        if not field_value:
            continue

        ft = field_type.upper()

        # Date extraction
        if ft in ("INVOICE_RECEIPT_DATE", "DATE", "ORDER_DATE") and not result["date"]:
            parsed_date = _parse_date(field_value)
            if parsed_date:
                result["date"] = parsed_date

        # Total price extraction
        if ft in ("TOTAL", "AMOUNT_PAID", "AMOUNT_DUE", "SUBTOTAL") and result["fuelPrice"] is None:
            parsed_num = _parse_number(field_value)
            if parsed_num is not None and parsed_num > 0:
                result["fuelPrice"] = parsed_num

    # Extract litres and odometer from line items
    for group in doc.get("LineItemGroups", []):
        for item in group.get("LineItems", []):
            for expense_field in item.get("LineItemExpenseFields", []):
                field_type = _get_field_type(expense_field)
                field_value = _get_field_value(expense_field)
                if not field_value:
                    continue

                value_lower = field_value.lower()

                # Look for litres/liters in quantity or description
                if field_type.upper() == "QUANTITY":
                    parsed = _parse_number(field_value)
                    if parsed is not None and parsed > 0:
                        # Heuristic: if quantity is reasonable for fuel (1-200L), treat as litres
                        if 0.5 <= parsed <= 500 and result["fuelLitres"] is None:
                            result["fuelLitres"] = parsed

                # Check description fields for litre/odometer keywords
                if field_type.upper() in ("ITEM", "DESCRIPTION", "PRODUCT_CODE"):
                    if _matches_fuel_keywords(value_lower) and result["fuelLitres"] is None:
                        # Try to extract a number from the description
                        nums = _extract_numbers(field_value)
                        for n in nums:
                            if 0.5 <= n <= 500:
                                result["fuelLitres"] = n
                                break

    # Try to extract litres from all text if not found in structured fields
    if result["fuelLitres"] is None:
        all_text = _get_all_text(doc).lower()
        result["fuelLitres"] = _extract_litres_from_text(all_text)

    # Try to extract odometer from all text (often handwritten)
    if result["odometerKm"] is None:
        all_text = _get_all_text(doc).lower()
        result["odometerKm"] = _extract_odometer_from_text(all_text)

    return result


def _get_field_type(field):
    """Get the type text from a Textract expense field."""
    type_obj = field.get("Type", {})
    return type_obj.get("Text", "") if isinstance(type_obj, dict) else ""


def _get_field_value(field):
    """Get the value text from a Textract expense field."""
    value_obj = field.get("ValueDetection", {})
    return (value_obj.get("Text", "") if isinstance(value_obj, dict) else "").strip()


def _parse_number(text):
    """Parse a number from text, handling currency symbols and EU/US formats."""
    if not text:
        return None
    cleaned = re.sub(r"[^\d.,\-]", "", text)
    if not cleaned:
        return None
    # EU format: 65,50 -> 65.50
    if re.match(r"^\d+,\d{2}$", cleaned):
        cleaned = cleaned.replace(",", ".")
    # US format with thousands: 1,234.56
    elif "," in cleaned and "." in cleaned:
        cleaned = cleaned.replace(",", "")
    # Plain number with comma thousands: 1,234
    elif "," in cleaned and "." not in cleaned:
        parts = cleaned.split(",")
        if len(parts) == 2 and len(parts[1]) == 3:
            cleaned = cleaned.replace(",", "")
        else:
            cleaned = cleaned.replace(",", ".")
    try:
        return round(float(cleaned), 2)
    except ValueError:
        return None


def _parse_date(text):
    """Try to parse a date string into YYYY-MM-DD format."""
    import re
    text = text.strip()

    # Try common date patterns
    patterns = [
        # YYYY-MM-DD
        (r"(\d{4})-(\d{1,2})-(\d{1,2})", lambda m: f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"),
        # DD/MM/YYYY or DD-MM-YYYY
        (r"(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})", lambda m: f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"),
        # MM/DD/YYYY (US format — ambiguous, try if day > 12)
        (r"(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})", lambda m: f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"),
        # DD Mon YYYY or DD Month YYYY
        (r"(\d{1,2})\s+(\w+)\s+(\d{4})", None),
    ]

    for pattern, formatter in patterns:
        match = re.search(pattern, text)
        if match and formatter:
            try:
                result = formatter(match)
                parts = result.split("-")
                y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
                if 1 <= m <= 12 and 1 <= d <= 31 and 1900 <= y <= 2100:
                    return result
            except (ValueError, IndexError):
                continue

    # Try month names
    month_names = {
        "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
        "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
        "january": 1, "february": 2, "march": 3, "april": 4, "june": 6,
        "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
    }
    match = re.search(r"(\d{1,2})\s+(\w+)\s+(\d{4})", text)
    if match:
        day = int(match.group(1))
        month_str = match.group(2).lower()
        year = int(match.group(3))
        month = month_names.get(month_str)
        if month and 1 <= day <= 31 and 1900 <= year <= 2100:
            return f"{year}-{month:02d}-{day:02d}"

    return None


def _matches_fuel_keywords(text):
    """Check if text contains fuel-related keywords."""
    keywords = ["litre", "liter", "litr", "fuel", "petrol", "diesel", "gasoline", "unleaded", "premium"]
    return any(kw in text for kw in keywords)


def _extract_numbers(text):
    """Extract all numbers from text."""
    nums = []
    for match in re.finditer(r"\d+[.,]?\d*", text):
        parsed = _parse_number(match.group())
        if parsed is not None:
            nums.append(parsed)
    return nums


def _get_all_text(doc):
    """Get all text from a Textract expense document."""
    texts = []
    for field in doc.get("SummaryFields", []):
        val = _get_field_value(field)
        if val:
            texts.append(val)
    for group in doc.get("LineItemGroups", []):
        for item in group.get("LineItems", []):
            for f in item.get("LineItemExpenseFields", []):
                val = _get_field_value(f)
                if val:
                    texts.append(val)
    return " ".join(texts)


def _extract_litres_from_text(text):
    """Try to find litres value from text using keyword proximity.

    Handles pump-receipt formats like:
      - "46.234L @ $2.159/L"   (no space before L)
      - "46.234 L"
      - "46.234 litres"
      - "litres: 46.234"
    Input is expected to already be lowercased.
    """
    patterns = [
        # "46.234l" or "46.234 l" or "46.234 litres" — number then L/litres
        r"(\d+[.,]\d+)\s*l(?:itres?|iters?)?\b",
        # Whole-number litres with unit: "50 L"
        r"(\d+)\s*l(?:itres?|iters?)\b",
        # Keyword first: "litres: 46.234"
        r"(?:litres?|liters?)[:\s]+(\d+[.,]?\d*)",
        # Gallons fallback
        r"(\d+[.,]?\d*)\s*gal(?:lons?)?\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            parsed = _parse_number(match.group(1))
            if parsed is not None and 0.5 <= parsed <= 500:
                return parsed
    return None


def _extract_handwritten_odometer(blocks):
    """Find odometer from handwritten text detected by Textract.

    On many fuel receipts the odometer is a bare handwritten number (no label)
    at the top or bottom of the receipt.  Textract marks these blocks with
    ``TextType: "HANDWRITING"``.

    We look for LINE blocks flagged as handwriting that contain a standalone
    5-7 digit number (the typical odometer range 10,000 – 9,999,999).
    If multiple candidates exist we prefer the one closest to the top of the
    page (smallest ``Top`` geometry value), since attendants usually write the
    odometer at the very top.
    """
    candidates = []
    for block in blocks:
        if block.get("BlockType") != "LINE":
            continue
        if block.get("TextType") != "HANDWRITING":
            continue
        text = (block.get("Text") or "").strip()
        if not text:
            continue
        # Strip common separators: spaces, commas, periods used as thousands
        cleaned = re.sub(r"[\s,.]", "", text)
        # Must be purely digits and in the 5-7 digit odometer range
        if not cleaned.isdigit():
            continue
        value = int(cleaned)
        if 1_000 <= value <= 9_999_999:
            top = block.get("Geometry", {}).get("BoundingBox", {}).get("Top", 1.0)
            candidates.append((top, value))

    if not candidates:
        return None

    # Pick the candidate closest to the top of the page
    candidates.sort(key=lambda c: c[0])
    logger.info("Handwritten odometer candidates: %s", candidates)
    return candidates[0][1]


def _extract_odometer_from_text(text):
    """Try to find odometer/km reading from text.

    Handles:
      - Labelled:   "odometer: 123456", "odo 123,456", "km: 123456"
      - Suffixed:   "123456 km", "123,456 kms"
      - Bare number written in a context line (e.g. handwritten "123456")
        — only accepted when on a line that also contains a label keyword.
    Input is expected to already be lowercased.
    """
    # Labelled patterns (highest confidence)
    labelled_patterns = [
        r"(?:odometer|odo(?:meter)?|mileage)[:\s#]+(\d[\d,. ]{3,8})",
        r"(?:km|kms|klm)[:\s]+(\d[\d,. ]{3,8})",
    ]
    for pattern in labelled_patterns:
        match = re.search(pattern, text)
        if match:
            raw = re.sub(r"[\s,]", "", match.group(1))
            parsed = _parse_number(raw)
            if parsed is not None and 1_000 <= parsed <= 9_999_999:
                return parsed

    # Suffixed patterns
    suffixed_patterns = [
        r"(\d[\d,]{3,7})\s*(?:km|kms|klm|miles?)\b",
    ]
    for pattern in suffixed_patterns:
        match = re.search(pattern, text)
        if match:
            raw = re.sub(r"[\s,]", "", match.group(1))
            parsed = _parse_number(raw)
            if parsed is not None and 1_000 <= parsed <= 9_999_999:
                return parsed

    return None
