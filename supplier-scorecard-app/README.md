# Supplier Scorecard App

## How to run
No install needed. Just open `index.html` in any browser (Chrome, Firefox, Edge).

## How to use
1. Upload your supplier/delivery CSV (e.g. SCMS_Delivery_History_Dataset_20150929.csv)
2. Map the columns (vendor, scheduled date, delivered date are required; price, product,
   freight, and order value are optional and unlock extra metrics)
3. Review the data-cleaning summary
4. Set pillar weights (or use a preset) and a minimum-shipments threshold
5. View the ranked scorecard, sensitivity table, and price-only baseline
6. Download the ranked results as CSV from the results page

## Notes
- Handles UTF-8 and Windows-1252 (latin-1) encoded CSVs
- Non-numeric values in numeric columns (e.g. "Freight Included in Commodity Cost")
  are skipped for that calculation rather than breaking the app
- Dates like "2-Jun-06", "2006-06-02", and "06/02/2006" are all parsed
