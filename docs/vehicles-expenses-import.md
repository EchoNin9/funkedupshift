# Vehicles Expenses – CSV / Excel Import

## Overview

You can import fuel expense entries from a CSV or Excel (.xlsx, .xls) file into the Vehicles Expenses module. Each row becomes a fuel entry linked to a vehicle. **CSV is recommended** for simplicity.

## Required Access

- You must be a member of the **expenses** custom group to use this feature.
- All imported data is private to your account.

## File Format

### Supported Formats

- **CSV** (.csv) – Recommended. Use comma-separated values with headers.
- **Excel** (.xlsx, .xls) – Also supported.

### Column Layout

Use the following columns (order can vary; headers are auto-detected):

| Column | Header keywords | Example |
|--------|-----------------|---------|
| Date | date | 2026-02-15 or Excel date serial |
| Fuel price | price, cost | 65.00 |
| Fuel litres | litre, liter, volume | 45.5 |
| Odometer (km) | odometer, mileage, km | 123456 |
| Vehicle | vehicle | My Car |

- **Date**: Use `YYYY-MM-DD` (e.g. 2026-02-15). For Excel, date serials are also supported.
- **Vehicle**: Matches an existing vehicle by name, or creates a new vehicle if it does not exist. Use a specific name (e.g. `CLK-500`). Empty values default to `Vehicle`.

### Example

| Date       | Fuel Price | Fuel Litres | Odometer (km) | Vehicle |
|------------|------------|-------------|---------------|---------|
| 2026-02-15 | 65.00      | 45.5        | 123456        | My Car  |
| 2026-02-01 | 62.00      | 44.0        | 123100        | My Car  |
| 2026-01-15 | 58.50      | 42.0        | 122500        | Truck   |

### Notes

- The first row is treated as headers.
- Rows with all empty values are skipped.
- If the **Vehicle** column is empty, the row is assigned to a vehicle named `"Vehicle"`.
- Column names are matched case-insensitively (e.g. `Fuel Price`, `fuel price`, `FUEL PRICE`).

## How to Import

1. Open the **Vehicles Expenses** page.
2. Click **Import from CSV/Excel**.
3. Choose your .csv, .xlsx, or .xls file.
4. Wait for the import to finish. A message shows how many entries were created and any errors.

## Creating a CSV File

1. In Excel or Google Sheets, create a sheet with the headers in the first row.
2. Add one row per fuel fill-up.
3. Save as **CSV (.csv)** – recommended for best compatibility.
4. Use the import feature to upload the file.

## Creating an Excel File

1. In Excel or Google Sheets, create a sheet with the headers in the first row.
2. Add one row per fuel fill-up.
3. Save as **Excel Workbook (.xlsx)** or **Excel 97-2003 (.xls)**.
4. Use the import feature to upload the file.
