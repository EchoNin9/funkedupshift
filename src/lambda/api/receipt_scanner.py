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
    """Call Textract AnalyzeExpense on an S3 image and extract fuel receipt fields."""
    if not MEDIA_BUCKET or not image_key:
        return None
    try:
        import boto3
        textract = boto3.client("textract", region_name=AWS_REGION)
        response = textract.analyze_expense(
            Document={
                "S3Object": {
                    "Bucket": MEDIA_BUCKET,
                    "Name": image_key,
                }
            }
        )
        return parse_fuel_receipt(response)
    except Exception as e:
        logger.exception("scan_fuel_receipt error: %s", e)
        return {"error": str(e)}


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
        all_text = _get_all_text(doc)
        result["fuelLitres"] = _extract_litres_from_text(all_text)

    # Try to extract odometer from all text (often handwritten)
    all_text = _get_all_text(doc)
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
    """Try to find litres value from text using keyword proximity."""
    text_lower = text.lower()
    # Look for patterns like "42.3 L" or "42.3 litres" or "litres: 42.3"
    patterns = [
        r"(\d+[.,]?\d*)\s*(?:l(?:itres?|iters?)?)\b",
        r"(?:litres?|liters?)[:\s]+(\d+[.,]?\d*)",
        r"(\d+[.,]?\d*)\s*(?:gal(?:lons?)?)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text_lower)
        if match:
            parsed = _parse_number(match.group(1))
            if parsed is not None and 0.5 <= parsed <= 500:
                return parsed
    return None


def _extract_odometer_from_text(text):
    """Try to find odometer/km reading from text."""
    text_lower = text.lower()
    # Look for patterns like "odometer: 123456" or "km: 123456" or "123456 km"
    patterns = [
        r"(?:odometer|odo|mileage|km|kms)[:\s]+(\d{4,7})",
        r"(\d{4,7})\s*(?:km|kms|miles?)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text_lower)
        if match:
            parsed = _parse_number(match.group(1))
            if parsed is not None and parsed >= 100:
                return parsed
    return None
