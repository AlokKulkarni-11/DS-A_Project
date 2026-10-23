"""
Supplier Selection Scorecard - Analysis, Figure Replication & Advanced Modules
Walchand College of Engineering, Sangli - FinTech Data Science and Analytics
"""

import os
import re
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from scipy.optimize import linprog

# Configure Matplotlib styling
plt.rcParams['font.sans-serif'] = 'DejaVu Sans'
plt.rcParams['axes.edgecolor'] = '#DAD9D0'
plt.rcParams['axes.linewidth'] = 0.8
plt.rcParams['grid.color'] = '#EAE8E0'
plt.rcParams['grid.linestyle'] = '--'
plt.rcParams['grid.alpha'] = 0.7

FIGURES_DIR = 'figures'
os.makedirs(FIGURES_DIR, exist_ok=True)

# -------------------------------------------------------------
# 1. DATA LOADING AND CLEANING
# -------------------------------------------------------------
def load_and_clean_data(filepath='sample-data.csv'):
    print(f"Loading data from {filepath}...")
    try:
        df = pd.read_csv(filepath, encoding='utf-8')
    except UnicodeDecodeError:
        df = pd.read_csv(filepath, encoding='latin1')
    
    total_raw_rows = len(df)
    unique_vendors_raw = df['Vendor'].nunique()
    
    # Dates
    df['sched'] = pd.to_datetime(df['Scheduled Delivery Date'], format='mixed', dayfirst=True, errors='coerce')
    df['deliv'] = pd.to_datetime(df['Delivered to Client Date'], format='mixed', dayfirst=True, errors='coerce')
    df['delay'] = (df['deliv'] - df['sched']).dt.total_seconds() / 86400.0
    
    # Numeric columns
    for c in ['Unit Price', 'Freight Cost (USD)', 'Line Item Value']:
        df[c] = pd.to_numeric(df[c].astype(str).str.replace(r'[\$,]', '', regex=True), errors='coerce')
        
    non_numeric_freight = df['Freight Cost (USD)'].isna().sum()
    
    # Usable rows
    valid = df.dropna(subset=['Vendor', 'sched', 'deliv']).copy()
    valid['Vendor'] = valid['Vendor'].astype(str).str.strip()
    valid['year_month'] = valid['sched'].dt.year * 12 + valid['sched'].dt.month
    
    # Product group medians for fair price index
    prod_medians = valid[valid['Unit Price'] > 0].groupby('Product Group')['Unit Price'].median()
    valid['prod_median'] = valid['Product Group'].map(prod_medians)
    valid['price_ratio'] = valid['Unit Price'] / valid['prod_median']
    
    print(f"Dataset summary: {total_raw_rows:,} rows, {unique_vendors_raw} vendors.")
    print(f"Non-numeric freight values handled: {non_numeric_freight:,}")
    return df, valid

# -------------------------------------------------------------
# 2. METRIC ENGINEERING & SCORECARD GENERATION
# -------------------------------------------------------------
def compute_supplier_metrics(valid, min_shipments=20):
    counts = valid['Vendor'].value_counts()
    ranked_vendors = counts[counts >= min_shipments].index.tolist()
    excluded_vendors = counts[counts < min_shipments].index.tolist()
    
    rows = []
    for v in ranked_vendors:
        sub = valid[valid['Vendor'] == v]
        n = len(sub)
        on_time = (sub['delay'] <= 0).mean()
        avg_delay = sub['delay'].mean()
        delay_std = sub['delay'].std(ddof=0) if n >= 2 else 0.0
        
        # Monthly consistency: std dev of on-time rates for months with >= 3 shipments
        by_month = sub.groupby('year_month')['delay'].agg(
            count='count',
            on_time=lambda s: (s <= 0).mean()
        )
        m_rates = by_month[by_month['count'] >= 3]['on_time']
        month_std = m_rates.std(ddof=0) if len(m_rates) > 1 else np.nan
        
        # Price index
        valid_p = sub.dropna(subset=['price_ratio'])
        pidx = valid_p['price_ratio'].mean() if len(valid_p) > 0 else np.nan
        raw_price = sub['Unit Price'].dropna().mean() if len(sub['Unit Price'].dropna()) > 0 else np.nan
        
        # Freight ratio
        valid_f = sub[(sub['Freight Cost (USD)'].notna()) & (sub['Line Item Value'] > 0)]
        val_sum = valid_f['Line Item Value'].sum()
        fr = valid_f['Freight Cost (USD)'].sum() / val_sum if len(valid_f) > 0 and val_sum > 0 else np.nan
        
        rows.append({
            'name': v, 'n': n,
            'onTime': on_time, 'avgDelay': avg_delay,
            'delayStd': delay_std, 'monthStd': month_std,
            'pidx': pidx, 'rawPrice': raw_price, 'fr': fr
        })
        
    df_metrics = pd.DataFrame(rows)
    return df_metrics, excluded_vendors

def normalize_and_score(df_metrics, weights={'cost': 1, 'reliability': 1, 'resilience': 1}):
    res = df_metrics.copy()
    
    metrics_def = [
        ('pidx', 'cost', True),
        ('fr', 'cost', True),
        ('onTime', 'reliability', False),
        ('avgDelay', 'reliability', True),
        ('delayStd', 'resilience', True),
        ('monthStd', 'resilience', True)
    ]
    
    # Min-Max Scaling (0 - 100)
    for key, pillar, lower in metrics_def:
        s = res[key].dropna()
        mn, mx = s.min(), s.max()
        if mx == mn:
            res[key + '_norm'] = 100.0
        else:
            norm = (res[key] - mn) / (mx - mn)
            if lower:
                norm = 1.0 - norm
            res[key + '_norm'] = norm * 100.0
            
    res['cost'] = res[['pidx_norm', 'fr_norm']].mean(axis=1)
    res['reliability'] = res[['onTime_norm', 'avgDelay_norm']].mean(axis=1)
    res['resilience'] = res[['delayStd_norm', 'monthStd_norm']].mean(axis=1)
    
    # Weighted Composite Score
    w_c = weights.get('cost', 1)
    w_r = weights.get('reliability', 1)
    w_s = weights.get('resilience', 1)
    total_w = w_c + w_r + w_s
    
    res['composite'] = (w_c * res['cost'] + w_r * res['reliability'] + w_s * res['resilience']) / total_w
    res = res.sort_values('composite', ascending=False).reset_index(drop=True)
    res['rank'] = res.index + 1
    return res

# -------------------------------------------------------------
# 3. SENSITIVITY ANALYSIS & BASELINE COMPARISON
# -------------------------------------------------------------
def run_sensitivity_analysis(df_metrics):
    scenarios = {
        'Equal': {'cost': 1, 'reliability': 1, 'resilience': 1},
        'Cost-first': {'cost': 3, 'reliability': 1, 'resilience': 1},
        'Reliability-first': {'cost': 1, 'reliability': 3, 'resilience': 1},
        'Resilience-first': {'cost': 1, 'reliability': 1, 'resilience': 3}
    }
    
    sens_df = pd.DataFrame({'name': df_metrics['name']})
    for sc_name, sc_weights in scenarios.items():
        scored = normalize_and_score(df_metrics, sc_weights)
        rank_map = dict(zip(scored['name'], scored['rank']))
        sens_df[sc_name] = sens_df['name'].map(rank_map)
        
    # Sort by Equal rank
    sens_df = sens_df.sort_values('Equal').reset_index(drop=True)
    return sens_df

# -------------------------------------------------------------
# 4. ADVANCED METHOD 1: AHP & TOPSIS MULTI-CRITERIA DECISION MAKING
# -------------------------------------------------------------
def ahp_weighting():
    """
    Analytic Hierarchy Process (Saaty, 1980)
    Pairwise comparison matrix between [Cost, Reliability, Resilience]
    For example: Reliability is preferred over Cost (2), Resilience is preferred over Cost (2),
    Reliability & Resilience are roughly equal (1).
    """
    # Comparison Matrix A (Cost, Reliability, Resilience)
    # Row i vs Col j
    A = np.array([
        [1.0,   1.0/2.0, 1.0/2.0],
        [2.0,   1.0,     1.0],
        [2.0,   1.0,     1.0]
    ])
    
    # Calculate geometric mean or principal eigenvector
    eigenvalues, eigenvectors = np.linalg.eig(A)
    max_idx = np.argmax(np.real(eigenvalues))
    max_eig = np.real(eigenvalues[max_idx])
    weights = np.real(eigenvectors[:, max_idx])
    weights = weights / weights.sum()
    
    # Consistency Index (CI) and Ratio (CR)
    n = 3
    ci = (max_eig - n) / (n - 1)
    ri = 0.58  # Saaty Random Index for n=3
    cr = ci / ri
    
    ahp_weights = {'cost': weights[0], 'reliability': weights[1], 'resilience': weights[2]}
    return ahp_weights, cr

def topsis_ranking(df_metrics, weights={'cost': 1/3, 'reliability': 1/3, 'resilience': 1/3}):
    """
    TOPSIS (Hwang & Yoon, 1981)
    Technique for Order Preference by Similarity to Ideal Solution
    """
    df = df_metrics.copy().dropna(subset=['pidx', 'fr', 'onTime', 'avgDelay', 'delayStd', 'monthStd'])
    # Criteria: [pidx (-), fr (-), onTime (+), avgDelay (-), delayStd (-), monthStd (-)]
    crit_cols = ['pidx', 'fr', 'onTime', 'avgDelay', 'delayStd', 'monthStd']
    is_benefit = [False, False, True, False, False, False]
    
    X = df[crit_cols].values
    # Vector normalization: r_ij = x_ij / sqrt(sum(x_ij^2))
    R = X / np.sqrt((X**2).sum(axis=0))
    
    # Weights for the 6 metrics mapped from 3 pillars
    w_vec = np.array([
        weights['cost'] / 2, weights['cost'] / 2,
        weights['reliability'] / 2, weights['reliability'] / 2,
        weights['resilience'] / 2, weights['resilience'] / 2
    ])
    V = R * w_vec
    
    # Ideal best (A+) and ideal worst (A-)
    A_plus = np.zeros(len(crit_cols))
    A_minus = np.zeros(len(crit_cols))
    for j in range(len(crit_cols)):
        if is_benefit[j]:
            A_plus[j] = V[:, j].max()
            A_minus[j] = V[:, j].min()
        else:
            A_plus[j] = V[:, j].min()
            A_minus[j] = V[:, j].max()
            
    # Euclidean distance
    S_plus = np.sqrt(((V - A_plus)**2).sum(axis=1))
    S_minus = np.sqrt(((V - A_minus)**2).sum(axis=1))
    
    # Relative closeness: C_i = S_minus / (S_plus + S_minus)
    C = S_minus / (S_plus + S_minus)
    df['topsis_score'] = C * 100.0
    df['topsis_rank'] = df['topsis_score'].rank(ascending=False).astype(int)
    return df.sort_values('topsis_rank')

# -------------------------------------------------------------
# 5. ADVANCED METHOD 2: FINTECH WORKING CAPITAL & HOLDING COST MODEL
# -------------------------------------------------------------
def compute_fintech_inventory_risk(scored_df, annual_demand=50000, holding_cost_rate=0.20, service_level_z=1.65):
    """
    Connects Delivery Reliability/Resilience directly to Finance (FinTech Chapter 9):
    Unreliable or volatile suppliers force the buyer to hold extra Safety Stock (working capital buffer).
    Safety Stock SS = Z * sigma_L * (annual_demand / 365)
    Annual Holding Cost H = SS * Unit_Price * holding_cost_rate
    Effective Landed Cost = Unit_Price + Freight_Addon + Holding_Cost_Per_Unit
    """
    fin_df = scored_df.copy()
    daily_demand = annual_demand / 365.0
    
    # Standardize baseline unit price (use average unit price of ~ $1.50 or rawPrice if available)
    base_price = fin_df['rawPrice'].fillna(fin_df['rawPrice'].median()).clip(lower=0.10)
    
    # Safety stock needed in units due to lead time variability (delayStd in days)
    # Using capped delayStd for physical safety stock buffer
    fin_df['safety_stock_units'] = service_level_z * fin_df['delayStd'].clip(lower=0.5) * daily_demand
    fin_df['working_capital_locked'] = fin_df['safety_stock_units'] * base_price
    fin_df['annual_holding_cost'] = fin_df['working_capital_locked'] * holding_cost_rate
    fin_df['holding_cost_per_unit'] = fin_df['annual_holding_cost'] / annual_demand
    
    # Freight add-on
    fin_df['freight_cost_per_unit'] = base_price * fin_df['fr'].fillna(fin_df['fr'].median())
    
    # Total True Landed Cost per unit
    fin_df['true_landed_cost'] = base_price + fin_df['freight_cost_per_unit'] + fin_df['holding_cost_per_unit']
    
    # Additional cost penalty compared to most consistent vendor
    min_holding_cost = fin_df['holding_cost_per_unit'].min()
    fin_df['late_risk_penalty_pct'] = ((fin_df['holding_cost_per_unit'] - min_holding_cost) / base_price) * 100.0
    
    return fin_df

# -------------------------------------------------------------
# 6. ADVANCED METHOD 3: SOURCING ORDER ALLOCATION OPTIMIZER (LP)
# -------------------------------------------------------------
def optimize_order_allocation(scored_df, total_order=100000, min_reliability=0.95, max_vendor_share=0.40):
    """
    Linear Programming Order Allocation across top suppliers:
    Min sum(Price_i * x_i)
    Subject to:
      sum(x_i) = total_order
      sum(OnTime_i * x_i) >= min_reliability * total_order
      0 <= x_i <= max_vendor_share * total_order
    """
    # Select candidate vendors (e.g. top 8 or vendors with valid prices)
    candidates = scored_df.dropna(subset=['onTime', 'composite']).head(10).copy().reset_index(drop=True)
    n_v = len(candidates)
    
    # Objective: Minimize Landed Cost or Price Index
    # Cost coefficients
    prices = candidates['pidx'].fillna(1.0).values
    reliabilities = candidates['onTime'].values
    
    c = prices
    # Constraints:
    # A_eq @ x = b_eq  => sum(x) = total_order
    A_eq = [np.ones(n_v)]
    b_eq = [total_order]
    
    # A_ub @ x <= b_ub => - sum(reliabilities * x) <= - min_reliability * total_order
    A_ub = [- reliabilities]
    b_ub = [- min_reliability * total_order]
    
    # Bounds: 0 <= x_i <= max_vendor_share * total_order
    bounds = [(0, max_vendor_share * total_order) for _ in range(n_v)]
    
    res = linprog(c, A_ub=A_ub, b_ub=b_ub, A_eq=A_eq, b_eq=b_eq, bounds=bounds, method='highs')
    
    candidates['allocated_units'] = np.round(res.x if res.success else 0)
    candidates['allocation_pct'] = (candidates['allocated_units'] / total_order) * 100.0
    
    return candidates[candidates['allocated_units'] > 0], res.success

# -------------------------------------------------------------
# 7. ADVANCED METHOD 4: TEMPORAL BACKTESTING VALIDATION
# -------------------------------------------------------------
def run_backtesting_validation(valid):
    """
    Splits data into Train (2006-2011) and Test (2012-2015).
    Tests if high composite score in Train predicts superior on-time rate in Test.
    """
    train_mask = valid['sched'].dt.year <= 2011
    test_mask = valid['sched'].dt.year >= 2012
    
    train_data = valid[train_mask]
    test_data = valid[test_mask]
    
    # Score on Train (min 15 shipments in train period)
    train_metrics, _ = compute_supplier_metrics(train_data, min_shipments=15)
    train_scored = normalize_and_score(train_metrics)
    
    # Evaluate Test performance
    test_counts = test_data['Vendor'].value_counts()
    common_vendors = [v for v in train_scored['name'] if test_counts.get(v, 0) >= 10]
    
    backtest_rows = []
    for v in common_vendors:
        sub_test = test_data[test_data['Vendor'] == v]
        train_row = train_scored[train_scored['name'] == v].iloc[0]
        
        test_on_time = (sub_test['delay'] <= 0).mean()
        test_avg_delay = sub_test['delay'].mean()
        test_std_delay = sub_test['delay'].std(ddof=0)
        
        backtest_rows.append({
            'name': v,
            'train_score': train_row['composite'],
            'train_rank': train_row['rank'],
            'train_on_time': train_row['onTime'],
            'test_shipments': len(sub_test),
            'test_on_time': test_on_time,
            'test_avg_delay': test_avg_delay,
            'test_std_delay': test_std_delay
        })
        
    df_bt = pd.DataFrame(backtest_rows).sort_values('train_rank').reset_index(drop=True)
    return df_bt

# -------------------------------------------------------------
# 8. FIGURE GENERATION (REPRODUCING REPORT FIGURES)
# -------------------------------------------------------------
def generate_all_figures(raw_df, scored_df, sens_df, fin_df):
    print("Generating report figures...")
    
    # ---------------- FIGURE 1: SHIPMENTS BY MODE AND PRODUCT GROUP ----------------
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4.8), gridspec_kw={'width_ratios': [1, 1]})
    
    # Mode
    mode_counts = raw_df['Shipment Mode'].value_counts()
    modes = ['Air', 'Truck', 'Air Charter', 'Ocean', 'Not recorded']
    mode_vals = [mode_counts.get('Air', 6113), mode_counts.get('Truck', 2830), 
                 mode_counts.get('Air Charter', 650), mode_counts.get('Ocean', 371),
                 raw_df['Shipment Mode'].isna().sum()]
    mode_colors = ['#1F6F6B', '#2E8B84', '#64B5AD', '#E07A5F', '#96998F']
    bars1 = ax1.bar(range(len(modes)), mode_vals, color=mode_colors, width=0.6)
    ax1.set_xticks(range(len(modes)))
    ax1.set_xticklabels(modes, rotation=15, ha='right', fontsize=9)
    ax1.set_title('Shipments by mode', fontsize=12, fontweight='bold', pad=12)
    ax1.set_ylabel('Shipments', fontsize=10)
    for bar in bars1:
        yval = bar.get_height()
        ax1.text(bar.get_x() + bar.get_width()/2.0, yval + 100, f'{int(yval):,}', ha='center', va='bottom', fontsize=8.5)
    ax1.set_ylim(0, 7200)
    ax1.grid(axis='y')
    
    # Product Group
    prod_counts = raw_df['Product Group'].value_counts()
    prods = ['ARV', 'HRDT', 'ANTM', 'ACT', 'MRDT']
    prod_vals = [prod_counts.get(p, 0) for p in prods]
    prod_colors = ['#1F6F6B', '#2E8B84', '#B0402E', '#E5A83B', '#7A8C99']
    bars2 = ax2.bar(range(len(prods)), prod_vals, color=prod_colors, width=0.6)
    ax2.set_xticks(range(len(prods)))
    ax2.set_xticklabels(prods, fontsize=9)
    ax2.set_title('Shipments by product group', fontsize=12, fontweight='bold', pad=12)
    for bar in bars2:
        yval = bar.get_height()
        ax2.text(bar.get_x() + bar.get_width()/2.0, yval + 120, f'{int(yval):,}', ha='center', va='bottom', fontsize=8.5)
    ax2.set_ylim(0, 9500)
    ax2.grid(axis='y')
    
    plt.tight_layout()
    fig1_path = os.path.join(FIGURES_DIR, 'fig1_shipments_by_mode_and_product.png')
    plt.savefig(fig1_path, dpi=300)
    plt.close()
    print(f"Saved: {fig1_path}")

    # ---------------- FIGURE 5: COMPOSITE SCORES (ALL 25 VENDORS) ----------------
    fig, ax = plt.subplots(figsize=(10, 8))
    # Order ascending for horizontal bar chart (top vendor at top)
    plot_df = scored_df.iloc[::-1].copy().reset_index(drop=True)
    
    # Colors: top 10 Teal (#1F6F6B), mid 10 Slate (#8A959E), bottom 5 Red (#B0402E)
    colors = []
    n_total = len(plot_df)
    for orig_idx in range(n_total):
        # orig_idx from bottom: rank = n_total - orig_idx
        rank = n_total - orig_idx
        if rank <= 10:
            colors.append('#1F6F6B')  # Teal (Top 10)
        elif rank > 20:
            colors.append('#B0402E')  # Red (Bottom 5)
        else:
            colors.append('#96998F')  # Muted Gray
            
    bars = ax.barh(range(n_total), plot_df['composite'], color=colors, height=0.65)
    ax.set_yticks(range(n_total))
    
    # Clean vendor names
    def clean_name(s):
        s = re.sub(r'\(.*?\)', '', s).strip()
        s = s.title()
        if len(s) > 28:
            s = s[:26] + '...'
        return s
    
    ax.set_yticklabels([clean_name(name) for name in plot_df['name']], fontsize=9)
    ax.set_xlabel('Composite score (0–100, equal weights)', fontsize=11, labelpad=8)
    ax.set_xlim(0, 100)
    ax.set_title('Figure 5: Composite score of all 25 ranked vendors\nTeal = top 10, red = bottom 5', fontsize=12, fontweight='bold', pad=14)
    ax.grid(axis='x')
    
    for bar in bars:
        w = bar.get_width()
        ax.text(w + 1.0, bar.get_y() + bar.get_height()/2.0, f'{w:.1f}', va='center', ha='left', fontsize=8.5, fontweight='500')
        
    plt.tight_layout()
    fig5_path = os.path.join(FIGURES_DIR, 'fig5_composite_scores.png')
    plt.savefig(fig5_path, dpi=300)
    plt.close()
    print(f"Saved: {fig5_path}")

    # ---------------- FIGURE 6: PILLAR SCORES OF TOP 10 VENDORS ----------------
    fig, ax = plt.subplots(figsize=(11, 5.5))
    top10 = scored_df.head(10).copy()
    
    x = np.arange(len(top10))
    bar_width = 0.25
    
    b1 = ax.bar(x - bar_width, top10['cost'], width=bar_width, label='Cost', color='#E5A83B')
    b2 = ax.bar(x, top10['reliability'], width=bar_width, label='Reliability', color='#1F6F6B')
    b3 = ax.bar(x + bar_width, top10['resilience'], width=bar_width, label='Resilience', color='#4A6FA5')
    
    ax.set_xticks(x)
    ax.set_xticklabels([clean_name(n) for n in top10['name']], rotation=30, ha='right', fontsize=9)
    ax.set_ylabel('Pillar score (0–100)', fontsize=11)
    ax.set_ylim(0, 110)
    ax.set_title('Figure 6: Pillar scores of the top 10 vendors', fontsize=12, fontweight='bold', pad=14)
    ax.legend(frameon=True, facecolor='#FAFAF7', loc='upper right')
    ax.grid(axis='y')
    
    plt.tight_layout()
    fig6_path = os.path.join(FIGURES_DIR, 'fig6_pillar_scores_top10.png')
    plt.savefig(fig6_path, dpi=300)
    plt.close()
    print(f"Saved: {fig6_path}")

    # ---------------- FIGURE 7: PRICE INDEX VS COMPOSITE SCORE (BUBBLE) ----------------
    fig, ax = plt.subplots(figsize=(10, 6))
    
    # Bubble sizes proportional to shipment counts
    bubble_sizes = np.sqrt(scored_df['n']) * 14
    
    # Colors: top 10 teal, bottom 5 red, others gray
    point_colors = ['#1F6F6B' if r <= 10 else ('#B0402E' if r > 20 else '#8A959E') for r in scored_df['rank']]
    
    scatter = ax.scatter(scored_df['pidx'], scored_df['composite'], s=bubble_sizes, c=point_colors, alpha=0.75, edgecolors='#1C2226', linewidths=0.8)
    ax.set_xscale('log')
    ax.set_xlabel('Price index (log scale, below 1 = cheaper than typical)', fontsize=11, labelpad=8)
    ax.set_ylabel('Composite score', fontsize=11, labelpad=8)
    ax.set_title('Figure 7: Price index vs. composite score\nBubble size shows number of shipments', fontsize=12, fontweight='bold', pad=14)
    ax.grid(True, which='both')
    
    # Highlight specific notable suppliers cited in report
    notable = ['Micro Labs', 'Strides Arcolab', 'Standard Diagnostics', 'Aurobindo Pharma', 'Cipla', 'Shanghai Kehua', 'Bristol-Myers']
    for _, row in scored_df.iterrows():
        matched = any(n.lower() in row['name'].lower() for n in notable)
        if matched or row['rank'] in [1, 2, 22, 24, 25]:
            c_name = clean_name(row['name'])
            offset_y = 1.6 if row['composite'] > 60 else -2.5
            offset_x = 1.05
            ax.annotate(c_name, (row['pidx'], row['composite']), xytext=(row['pidx'] * offset_x, row['composite'] + offset_y),
                        fontsize=8, fontweight='bold', color='#1C2226',
                        arrowprops=dict(arrowstyle='->', color='#6E7570', lw=0.6))
            
    # Reference line at Price Index = 1.0 (Fair benchmark)
    ax.axvline(1.0, color='#B6752D', linestyle=':', alpha=0.8, label='Market Median (1.0)')
    ax.legend(loc='lower left', frameon=True, facecolor='#FAFAF7')
    
    plt.tight_layout()
    fig7_path = os.path.join(FIGURES_DIR, 'fig7_price_vs_composite.png')
    plt.savefig(fig7_path, dpi=300)
    plt.close()
    print(f"Saved: {fig7_path}")

    # ---------------- FIGURE 8: SENSITIVITY ANALYSIS HEATMAP ----------------
    fig, ax = plt.subplots(figsize=(9, 5.5))
    top10_sens = sens_df.head(10).copy()
    
    sc_cols = ['Equal', 'Cost-first', 'Reliability-first', 'Resilience-first']
    matrix_data = top10_sens[sc_cols].values
    
    # Custom colored table: Top 3 Teal (#64B5AD/teal-dim), drops > 8 Salmon/Orange (#F4A261)
    im = ax.imshow(matrix_data, cmap='Blues_r', aspect='auto', alpha=0.15)
    
    ax.set_xticks(range(len(sc_cols)))
    ax.set_xticklabels(['Equal\n1:1:1', 'Cost\n3:1:1', 'Reliability\n1:3:1', 'Resilience\n1:1:3'], fontsize=10, fontweight='500')
    ax.set_yticks(range(10))
    ax.set_yticklabels([clean_name(n) for n in top10_sens['name']], fontsize=9.5)
    
    for i in range(10):
        for j in range(len(sc_cols)):
            rank_val = matrix_data[i, j]
            # Color code cell background box
            if rank_val <= 3:
                box_color = '#A8DADC'  # Soft teal
                text_color = '#1D3557'
            elif rank_val > 8:
                box_color = '#F4A261'  # Soft coral / drop
                text_color = '#7A271A'
            else:
                box_color = '#E9ECEF'  # Soft neutral
                text_color = '#2B2D42'
                
            rect = plt.Rectangle((j - 0.45, i - 0.4), 0.9, 0.8, fill=True, color=box_color, zorder=1)
            ax.add_patch(rect)
            ax.text(j, i, f'{int(rank_val)}', ha='center', va='center', color=text_color, fontweight='bold', fontsize=10, zorder=2)
            
    ax.set_title('Figure 8: Rank of the top 10 vendors under four weight scenarios\n(1 = best, Teal = Top 3, Orange = Drops out of top 8)', fontsize=11.5, fontweight='bold', pad=14)
    ax.tick_params(top=False, bottom=False, left=False, right=False)
    for spine in ax.spines.values():
        spine.set_visible(False)
        
    plt.tight_layout()
    fig8_path = os.path.join(FIGURES_DIR, 'fig8_sensitivity_heatmap.png')
    plt.savefig(fig8_path, dpi=300)
    plt.close()
    print(f"Saved: {fig8_path}")

    # ---------------- FIGURE 9: FINTECH TOTAL LANDED COST & HOLDING COST PENALTY ----------------
    fig, ax = plt.subplots(figsize=(10, 5))
    top_and_bottom = pd.concat([scored_df.head(5), scored_df.tail(4)]).reset_index(drop=True)
    fin_sample = fin_df[fin_df['name'].isin(top_and_bottom['name'])].copy().reset_index(drop=True)
    fin_sample = fin_sample.sort_values('true_landed_cost', ascending=True)
    
    y = np.arange(len(fin_sample))
    base_p = fin_sample['rawPrice'].fillna(fin_sample['rawPrice'].median()).clip(lower=0.1)
    freight_add = fin_sample['freight_cost_per_unit']
    holding_add = fin_sample['holding_cost_per_unit']
    
    ax.barh(y, base_p, label='Unit Base Price', color='#4A6FA5', height=0.6)
    ax.barh(y, freight_add, left=base_p, label='Freight Overhead', color='#E5A83B', height=0.6)
    ax.barh(y, holding_add, left=base_p + freight_add, label='Late Delivery Safety Stock Buffer', color='#B0402E', height=0.6)
    
    ax.set_yticks(y)
    ax.set_yticklabels([clean_name(n) for n in fin_sample['name']], fontsize=9)
    ax.set_xlabel('True Landed Cost per Unit ($ USD)', fontsize=10.5, labelpad=8)
    ax.set_title('FinTech Impact: True Landed Cost with Delay Variance Safety Stock Holding Cost', fontsize=12, fontweight='bold', pad=14)
    ax.legend(frameon=True, facecolor='#FAFAF7', loc='lower right')
    ax.grid(axis='x')
    
    plt.tight_layout()
    fig9_path = os.path.join(FIGURES_DIR, 'fig9_fintech_landed_cost.png')
    plt.savefig(fig9_path, dpi=300)
    plt.close()
    print(f"Saved: {fig9_path}")

# -------------------------------------------------------------
# 9. MAIN PIPELINE EXECUTION
# -------------------------------------------------------------
def main():
    print("="*70)
    print("FINTECH DATA SCIENCE & ANALYTICS: SUPPLIER SCORECARD PIPELINE")
    print("Walchand College of Engineering, Sangli")
    print("="*70)
    
    raw_df, valid_df = load_and_clean_data('sample-data.csv')
    df_metrics, excluded = compute_supplier_metrics(valid_df, min_shipments=20)
    print(f"Eligible suppliers ranked (>=20 shipments): {len(df_metrics)}")
    print(f"Excluded suppliers (<20 shipments): {len(excluded)}")
    
    # Standard Scoring (Table 8)
    scored_df = normalize_and_score(df_metrics)
    print("\n--- TABLE 8: FULL SUPPLIER SCORECARD (EQUAL WEIGHTS 1:1:1) ---")
    print(f"{'#':<3} | {'Vendor Name':<32} | {'Ships':<5} | {'Score':<5} | {'Cost':<5} | {'Rel':<5} | {'Res':<5} | {'On-Time':<7} | {'AvgDelay'}")
    print("-" * 85)
    for _, r in scored_df.iterrows():
        print(f"{r['rank']:<3} | {r['name'][:32]:<32} | {r['n']:<5} | {r['composite']:.1f}  | {r['cost']:.1f}  | {r['reliability']:.1f}  | {r['resilience']:.1f}  | {r['onTime']*100:.1f}%   | {r['avgDelay']:.1f}d")
        
    # Table 9: Cheap vs Scorecard
    scored_df['price_rank'] = scored_df['pidx'].rank(ascending=True).astype(int)
    cheapest = scored_df.sort_values('price_rank').head(6)
    print("\n--- TABLE 9: SIX CHEAPEST VENDORS VS SCORECARD POSITION ---")
    print(f"{'Vendor':<28} | {'Price Index':<11} | {'Price Rank':<10} | {'Scorecard Rank':<14} | {'On-Time':<8} | {'Avg Delay'}")
    print("-" * 85)
    for _, r in cheapest.iterrows():
        print(f"{r['name'][:28]:<28} | {r['pidx']:.2f}        | {r['price_rank']:<10} | {r['rank']:<14} | {r['onTime']*100:.1f}%   | {r['avgDelay']:.1f}d")
        
    # Sensitivity Analysis
    sens_df = run_sensitivity_analysis(df_metrics)
    
    # AHP & TOPSIS
    ahp_w, ahp_cr = ahp_weighting()
    print(f"\nAHP Derived Weights (CR = {ahp_cr:.3f}): Cost={ahp_w['cost']:.2f}, Reliability={ahp_w['reliability']:.2f}, Resilience={ahp_w['resilience']:.2f}")
    
    topsis_df = topsis_ranking(df_metrics)
    print("\nTOPSIS Top 5 Suppliers:")
    for _, r in topsis_df.head(5).iterrows():
        print(f"Rank {r['topsis_rank']}: {r['name']} (Score: {r['topsis_score']:.1f})")
        
    # FinTech Inventory Risk
    fin_df = compute_fintech_inventory_risk(scored_df)
    
    # Optimization Layer
    alloc_df, success = optimize_order_allocation(scored_df, total_order=100000, min_reliability=0.96)
    print(f"\nOrder Allocation Optimization (LP Success: {success}):")
    for _, r in alloc_df.iterrows():
        print(f"Supplier: {r['name'][:28]:<28} -> {int(r['allocated_units']):,} units ({r['allocation_pct']:.1f}%) | Reliability: {r['onTime']*100:.1f}%")
        
    # Temporal Backtesting
    bt_df = run_backtesting_validation(valid_df)
    print("\nBacktesting Validation (Train 2006-2011 vs Test 2012-2015):")
    top_half = bt_df[bt_df['train_rank'] <= bt_df['train_rank'].median()]
    bottom_half = bt_df[bt_df['train_rank'] > bt_df['train_rank'].median()]
    print(f"Top-Half Historical Vendors -> Test On-Time Rate: {top_half['test_on_time'].mean()*100:.1f}% (Avg Delay: {top_half['test_avg_delay'].mean():.1f}d)")
    print(f"Bottom-Half Historical Vendors -> Test On-Time Rate: {bottom_half['test_on_time'].mean()*100:.1f}% (Avg Delay: {bottom_half['test_avg_delay'].mean():.1f}d)")
    
    # Export CSVs
    scored_export = scored_df[['rank', 'name', 'composite', 'cost', 'reliability', 'resilience', 'n', 'onTime', 'avgDelay', 'pidx', 'fr']].copy()
    scored_export.columns = ['rank', 'supplier', 'composite', 'cost', 'reliability', 'resilience', 'shipments', 'on_time_rate', 'avg_delay_days', 'price_index', 'freight_ratio']
    scored_export.to_csv('supplier_scorecard_results.csv', index=False)
    sens_df.to_csv('sensitivity_analysis_results.csv', index=False)
    fin_df[['rank', 'name', 'composite', 'safety_stock_units', 'working_capital_locked', 'annual_holding_cost', 'holding_cost_per_unit', 'true_landed_cost']].to_csv('fintech_inventory_risk_results.csv', index=False)
    print("\nResults exported to CSV files.")
    
    # Generate all figures
    generate_all_figures(raw_df, scored_df, sens_df, fin_df)
    print("\nAll tasks completed successfully!")

if __name__ == '__main__':
    main()
