# Methodology

## Step 1 — Data Cleaning & Ingestion
Rows missing a vendor or with an unparseable delivery date are dropped and counted. Freight cost, unit price, and line item value are coerced to numeric; non-numeric entries (e.g. "Freight Included in Commodity Cost") are treated as missing rather than zero to avoid distorting freight ratios. Suppliers below a minimum shipment count (default 20) are excluded from ranking to avoid noisy scores from small samples.

## Step 2 — Metric Engineering
For each supplier:
- **Delay** = Delivered Date − Scheduled Delivery Date, in days ($d_i = t_{\text{actual}} - t_{\text{promised}}$).
- **On-time rate** = Share of shipments with delay $\le 0$.
- **Average delay** = Mean delay across all shipments.
- **Delay spread ($\sigma_{\text{delay}}$)** = Population standard deviation of delay, measuring predictability.
- **Price index** = Supplier's mean unit price $\div$ median unit price for the same product group (benchmarking like-for-like).
- **Freight ratio** = Total freight cost $\div$ total line item value.
- **Monthly consistency** = Standard deviation of monthly on-time rates (for months with $\ge 3$ shipments), measuring temporal stability.

## Step 3 — Normalization
Each metric is min-max scaled to 0–100 across suppliers:
$$\text{Scaled} = \frac{x - \min}{\max - \min} \times 100$$
For metrics where lower is better (price index, freight ratio, average delay, delay spread, monthly consistency), the scale is inverted so that 100 always denotes superior performance:
$$\text{Scaled}_{\text{lower}} = \left(1 - \frac{x - \min}{\max - \min}\right) \times 100$$

## Step 4 — Multi-Criteria Weighting & Scoring
The system supports two complementary weighting frameworks:
1. **Direct Slider & Preset Weighting:** Linear combination of Cost, Reliability, and Resilience pillars:
   $$\text{Composite} = \frac{w_C \cdot \text{Cost} + w_R \cdot \text{Reliability} + w_S \cdot \text{Resilience}}{w_C + w_R + w_S}$$
2. **Analytic Hierarchy Process (AHP - Saaty 1980):** Derives weights from a $3 \times 3$ pairwise comparison matrix $[A]$ using eigenvalue decomposition, computing the Consistency Index ($CI$) and Consistency Ratio ($CR < 0.10$).
3. **TOPSIS (Hwang & Yoon 1981):** Evaluates Euclidean separation from positive-ideal ($A^+$) and negative-ideal ($A^-$) solutions, ranking suppliers by relative closeness $C_i = S_i^- / (S_i^+ + S_i^-)$.

## Step 5 — Sensitivity Analysis
Recomputes rankings under four strategic weight scenarios:
- **Equal:** 1 : 1 : 1 (balanced baseline)
- **Cost-first:** 3 : 1 : 1 (cost-dominant)
- **Reliability-first:** 1 : 3 : 1 (on-time priority)
- **Resilience-first:** 1 : 1 : 3 (predictability and consistency priority)

## Step 6 — Naive Price-Only Baseline Comparison
Compares the multi-criteria composite ranking against a naive lowest-price ranking. This highlights the hidden risk of cheap suppliers: low unit costs often mask frequent delivery failures and supply disruptions.

## Step 7 — FinTech Working Capital & Holding Cost Impact (Chapter 9)
Translates supply chain volatility into balance sheet impact:
- **Buffer Safety Stock ($SS$):** $SS = Z \times \max(\sigma_{\text{delay}}, 0.5) \times \text{Daily Demand}$ where $Z=1.65$ for 95% service level.
- **Working Capital Tied Up:** $SS \times \text{Unit Price}$.
- **Annual Inventory Holding Cost ($H$):** $\text{Working Capital} \times h$ where $h$ is annual holding cost rate (default 20%).
- **True Landed Cost per Unit:** $\text{Unit Price} + \text{Freight Overhead} + \frac{H}{\text{Annual Demand}}$.

## Step 8 — What-If Sourcing Order Allocation Optimizer (Chapter 11)
Linear programming solver that splits order volume across top suppliers:
$$\min \sum_i c_i x_i \quad \text{subject to} \quad \sum_i x_i = Q, \quad \sum_i r_i x_i \ge R_{\min} Q, \quad 0 \le x_i \le x_{\max} Q$$
where $c_i$ is unit landed cost, $r_i$ is supplier on-time rate, $Q$ is total demand, $R_{\min}$ is fleet reliability threshold, and $x_{\max}$ is maximum concentration share.

## Step 9 — Temporal Backtesting Validation
Splits the 10-year dataset into Train (2006–2011) and Test (2012–2015) periods. Verifies that suppliers scoring in the top historical tier maintain superior on-time rates (98.9% vs 94.0%) and lower delay variance in subsequent years.
