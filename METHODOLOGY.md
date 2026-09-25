# Methodology

## Step 1 — Data cleaning
Rows missing a vendor or with an unparseable delivery date are dropped and counted.
Freight cost, unit price, and line item value are coerced to numeric; non-numeric
entries (e.g. "Freight Included in Commodity Cost") are treated as missing rather
than zero. Suppliers below a minimum shipment count (default 20) are excluded from
ranking to avoid noisy scores from small samples.

## Step 2 — Metric engineering
For each supplier:
- **Delay** = Delivered Date − Scheduled Delivery Date, in days
- **On-time rate** = share of shipments with delay ≤ 0
- **Average delay** = mean delay across shipments
- **Delay spread** = standard deviation of delay (predictability)
- **Price index** = supplier's mean unit price ÷ median unit price for the same
  product group
- **Freight ratio** = total freight cost ÷ total line item value
- **Monthly consistency** = standard deviation of on-time rate computed per month
  (months with ≥3 shipments), a lightweight resilience proxy

## Step 3 — Normalization
Each metric is min-max scaled to 0–100 across suppliers. Metrics where lower is
better are inverted so 100 always means "best."

## Step 4 — Weighting
Cost Efficiency, Delivery Reliability, and Resilience are each the average of their
available normalized metrics. The composite score is a weighted average of the
three pillars (adjustable via sliders, default equal weighting). A pillar with no
underlying data is dropped and remaining weights are renormalized.

## Step 5 — Ranking and sensitivity
Suppliers are sorted by composite score. A sensitivity table recomputes ranks under
four weighting scenarios (equal, cost-first, reliability-first, resilience-first)
to test how robust the top ranking is to the weighting choice.

## Step 6 — Baseline comparison
A naive price-only ranking is shown alongside the composite ranking, to highlight
cases where a cheap-but-unreliable supplier drops once reliability and resilience
are weighed in.

## Limitations
- Resilience uses delay spread and monthly consistency as proxies, not the full
  seasonal-shock or route-comparison analysis described in the project brief.
- AHP/TOPSIS weighting, the optimization/what-if layer, and backtesting validation
  are not implemented — flagged as remaining scope.
