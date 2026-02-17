#!/usr/bin/env python3
"""Import vehicles fuel expenses from CSV directly to DynamoDB."""
import csv
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "lambda"))

os.environ.setdefault("TABLE_NAME", "fus-main")
os.environ.setdefault("AWS_REGION", "us-east-1")

# User ID from cleanup output (USER#44087408-3081-70b2-062c-74dc3b313c63)
USER_ID = "44087408-3081-70b2-062c-74dc3b313c63"


def _parse_currency(val: str) -> float:
    """Strip currency symbols and parse number. Handles $65.00, €50, 65,50 (EU) etc."""
    import re
    s = re.sub(r"[$€£¥\s]", "", (val or "").strip())
    if not s:
        return 0.0
    if "." in s:
        s = s.replace(",", "")
    else:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _match_column(header: str, patterns: list) -> bool:
    """Return True if header (lowercased) matches any pattern (substring or exact)."""
    h = (header or "").lower().strip()
    if not h:
        return False
    for p in patterns:
        if p in h or h == p:
            return True
    return False


def _build_col_map(headers: list) -> dict:
    """Build map of field -> header key. Columns can be in any order."""
    col_map = {}
    for i, h in enumerate(headers):
        key = (h or "").strip()
        if not key:
            continue
        if _match_column(key, ["date"]):
            col_map["date"] = key
        elif _match_column(key, ["litre", "liter", "volume"]):
            col_map["fuelLitres"] = key
        elif _match_column(key, ["price", "cost", "amount"]):
            col_map["fuelPrice"] = key
        elif _match_column(key, ["odometer", "mileage"]) or ("km" in key.lower() and "l/100" not in key.lower()):
            col_map["odometerKm"] = key
        elif _match_column(key, ["vehicle", "car"]):
            col_map["vehicle"] = key
    return col_map


def parse_csv(path: str) -> list:
    """Parse CSV into imports format: [{vehicleName, entries: [{date, fuelPrice, fuelLitres, odometerKm}]}].
    Columns can be in any order; detected by header name."""
    by_vehicle = {}
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames or []
        col_map = _build_col_map(headers)
        date_key = col_map.get("date")
        price_key = col_map.get("fuelPrice")
        litres_key = col_map.get("fuelLitres")
        odo_key = col_map.get("odometerKm")
        vehicle_key = col_map.get("vehicle")
        for row in reader:
            date_val = (row.get(date_key) or "").strip() if date_key else ""
            price_val = (row.get(price_key) or "").strip() if price_key else ""
            litres_val = (row.get(litres_key) or "").strip() if litres_key else ""
            odo_val = (row.get(odo_key) or "").strip() if odo_key else ""
            vehicle_val = (row.get(vehicle_key) or "").strip() if vehicle_key else ""
            if not date_val and not price_val and not litres_val and not odo_val:
                continue
            try:
                price = _parse_currency(price_val) if price_val else 0
                litres = float(litres_val.replace(",", "")) if litres_val else 0
                odo = float(odo_val.replace(",", "")) if odo_val else 0
            except ValueError:
                continue
            vehicle_name = vehicle_val or "Vehicle"
            if vehicle_name not in by_vehicle:
                by_vehicle[vehicle_name] = []
            by_vehicle[vehicle_name].append({
                "date": date_val[:10] if date_val else "",
                "fuelPrice": price,
                "fuelLitres": litres,
                "odometerKm": odo,
            })
    return [{"vehicleName": k, "entries": v} for k, v in by_vehicle.items() if v]


def main():
    csv_path = "/Users/adam/Downloads/vehicles-fuel-expenses-import.csv"
    if not os.path.exists(csv_path):
        print(f"File not found: {csv_path}")
        sys.exit(1)
    imports = parse_csv(csv_path)
    if not imports:
        print("No valid rows found")
        sys.exit(1)
    print(f"Parsed {len(imports)} vehicles, {sum(len(i['entries']) for i in imports)} total entries")
    from api.vehicles_expenses import import_fuel_entries
    result = import_fuel_entries(USER_ID, {"imports": imports})
    print(f"Created: {result['created']}")
    if result.get("errors"):
        print("Errors:", result["errors"])
    print("Done.")


if __name__ == "__main__":
    main()
