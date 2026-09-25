# Supplier Scorecard

A client-side web app that scores and ranks suppliers on Cost Efficiency, Delivery
Reliability, and Resilience from any order/shipment CSV.

## Files
- `index.html` — page structure
- `style.css` — visual design
- `script.js` — CSV parsing, cleaning, scoring, and rendering logic

## How to run
No install, no server. Open `index.html` directly in a browser (Chrome, Firefox, Edge).

## How to use
1. Upload a CSV (e.g. `SCMS_Delivery_History_Dataset_20150929.csv`)
2. Map columns — vendor, promised date, and delivered date are required;
   unit price, product group, freight cost, and order value are optional and unlock
   extra metrics
3. Review the data-cleaning summary (dropped rows, non-numeric values skipped)
4. Set pillar weights (or use a preset) and a minimum-shipments threshold
5. View the ranked scorecard, the weight-sensitivity table, and the price-only baseline
6. Download the ranked results as CSV

## Methodology
See METHODOLOGY.md for the metric formulas and pipeline steps.

## Notes
- Handles UTF-8 and Windows-1252 (latin-1) encoded CSVs
- Non-numeric values in numeric columns (e.g. "Freight Included in Commodity Cost")
  are skipped for that calculation instead of breaking the app
- Dates like "2-Jun-06", "2006-06-02", and "06/02/2006" all parse correctly
