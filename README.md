# Supplier Selection Scorecard

A data-driven multi-criteria decision tool that scores and ranks suppliers on **Cost Efficiency**, **Delivery Reliability**, and **Supply Chain Resilience** from historical shipment data.

**FinTech Data Science and Analytics (7MD470)**  
**Walchand College of Engineering, Sangli**  
*Guide:* Prof. Bipin Mahadik  
*Team:* Hrishikesh Bankapur, Alok Kulkarni, Trusha Kulkarni, Sumit Ashatapawar, Sahil Jagdale

---

## Key Features

1. **Client-Side Web Application (`index.html`)**:
   - Zero-install, 100% in-browser processing (Chrome, Firefox, Edge).
   - One-click sample dataset loader (`⚡ Load Sample Data` — 10,324 rows from USAID SCMS delivery dataset).
   - Dynamic column auto-detection and data-cleaning audit.
   - Interactive SVG dashboard replicating report figures (Figures 5–8):
     - Figure 5: Composite score bar chart of all 25 ranked vendors.
     - Figure 6: Three-pillar breakdown chart (Cost, Reliability, Resilience).
     - Figure 7: Price Index vs. Composite Score trade-off bubble chart.
     - Figure 8: Sensitivity analysis heatmap across four weighting scenarios.
   - **Advanced MCDM Weighting**: Supports both linear sliders and Analytic Hierarchy Process (AHP) pairwise comparison with Consistency Ratio ($CR < 0.10$), plus TOPSIS ranking.
   - **FinTech Working Capital & Safety Stock Impact (Chapter 9)**: Quantifies the balance-sheet carrying cost of lead-time delay variance ($\sigma_{\text{delay}}$) and true landed cost.
   - **What-If Sourcing Order Allocation Optimizer (Chapter 11)**: Linear programming allocation solver splitting order volumes across top suppliers subject to minimum reliability constraints.
   - **Supplier Detail Drawer**: Click any supplier row to inspect operational metrics and risk profile.

2. **Python Analysis & Report Replication Suite (`analysis.py` & `Supplier_Scorecard_Analysis.ipynb`)**:
   - Reproduces Table 8 (Full Scorecard), Table 9 (Cheapest Vendors vs. Rank), Table 2 (Dataset Summary), and all report figures in `figures/`.
   - Implements Scipy linear programming order allocation and temporal backtesting validation (Train 2006–2011 vs. Test 2012–2015).
   - Exports results to `supplier_scorecard_results.csv`, `sensitivity_analysis_results.csv`, and `fintech_inventory_risk_results.csv`.

---

## File Structure

```text
DS-A_Project/
├── index.html                           # Main web application entry point
├── style.css                            # Styling, chart design, responsive layouts
├── script.js                            # Web application engine, algorithms & SVG charts
├── sample-data.csv                      # USAID Supply Chain Shipment Pricing Dataset (10,324 records)
├── analysis.py                          # Python reproduction script (figures & advanced modules)
├── Supplier_Scorecard_Analysis.ipynb    # Interactive Jupyter Notebook reproducing report analysis
├── figures/                             # Generated publication-quality figures (Figures 1, 5, 6, 7, 8, 9)
│   ├── fig1_shipments_by_mode_and_product.png
│   ├── fig5_composite_scores.png
│   ├── fig6_pillar_scores_top10.png
│   ├── fig7_price_vs_composite.png
│   ├── fig8_sensitivity_heatmap.png
│   └── fig9_fintech_landed_cost.png
├── supplier-scorecard-app/              # Standalone single-file bundle distribution
│   ├── index.html                       # Embedded self-contained bundle
│   └── README.md
├── Supplier_Selection_Scorecard_Report.pdf  # Project Report PDF
├── Supplier_Scorecard_Presentation.pdf     # Presentation Slides PDF
├── METHODOLOGY.md                       # Comprehensive mathematical formulas & pipeline description
└── README.md                            # Project documentation
```

---

## How to Run

### 1. Web Application (Zero Setup)
Open [index.html](file:///c:/Users/alokk/OneDrive/Desktop/XYZ/DS-A_Project/index.html) directly in any web browser.
- Click **"⚡ Load Sample Data"** on Step 1 to immediately run the USAID benchmark dataset.
- Proceed through column mapping and data verification.
- Configure weights via sliders or AHP pairwise comparison.
- Explore the interactive scorecard, visual dashboard charts, FinTech working capital analysis, and sourcing order allocation.

### 2. Python Reproduction & Notebook
Run the Python replication script:
```bash
python analysis.py
```
This generates all figures in the `figures/` directory and outputs all tables matching the project report.

Or open `Supplier_Scorecard_Analysis.ipynb` in VS Code or Jupyter Notebook to execute the pipeline interactively.

---

## Project Methodology
See [METHODOLOGY.md](file:///c:/Users/alokk/OneDrive/Desktop/XYZ/DS-A_Project/METHODOLOGY.md) for full metric formulas, normalization mathematics, AHP/TOPSIS formulations, and FinTech safety stock equations.
