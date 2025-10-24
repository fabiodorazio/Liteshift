
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import numpy as np
from typing import List, Optional, Dict

app = FastAPI(title="Better Compound Interest API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SimRequest(BaseModel):
    initial: float = Field(0, ge=0, description="Starting portfolio balance")
    annual_contribution: float = Field(6000, ge=0, description="First-year total contribution")
    contribution_growth: float = Field(0.03, ge=0, description="Annual growth rate for contributions (e.g., 0.03 = 3%)")
    years: int = Field(30, ge=1, le=80)
    n_sims: int = Field(100, ge=50, le=20000)
    expected_return: float = Field(0.07, description="Expected nominal annual return (mu)")
    volatility: float = Field(0.18, description="Annualized volatility (sigma)")
    expense_ratio: float = Field(0.0, ge=0, description="Annual fund expense drag, e.g., 0.001 = 0.10%")
    inflation: float = Field(0.02, ge=0, description="Annual inflation assumption to compute real dollars")
    target: Optional[float] = Field(None, ge=0, description="Optional wealth target to compute probability of reaching")
    frequency: int = Field(12, ge=1, le=12, description="Compounding periods per year; 12 = monthly")
    seed: Optional[int] = None

def simulate_paths(req: SimRequest):
    np.random.seed(req.seed)
    T = req.years * req.frequency
    dt = 1 / req.frequency
    mu_net = req.expected_return - req.expense_ratio           # net of fees
    drift = (mu_net - 0.5 * req.volatility**2) * dt
    vol = req.volatility * np.sqrt(dt)

    # Precompute contributions per period (increasing each year)
    contrib_per_year = np.array([req.annual_contribution * (1 + req.contribution_growth)**y for y in range(req.years)])
    contrib_schedule = np.repeat(contrib_per_year / req.frequency, req.frequency)

    # Simulate GBM returns (lognormal), "bumpy not linear"
    shocks = np.random.normal(drift, vol, size=(req.n_sims, T))
    growth_factors = np.exp(shocks)

    # Wealth paths with contributions added at end of each period
    wealth = np.zeros((req.n_sims, T+1))
    wealth[:, 0] = req.initial
    for t in range(1, T+1):
        # growth on previous wealth
        wealth[:, t] = wealth[:, t-1] * growth_factors[:, t-1] + contrib_schedule[t-1]

    # Real (inflation-adjusted) series for reporting
    inflation_factor = (1 + req.inflation) ** (np.arange(0, T+1) * dt)
    wealth_real = wealth / inflation_factor

    # --- Percentiles (sanitize to avoid NaN/inf) ---
    def tolist_safe(arr):
        return np.nan_to_num(arr, nan=0.0, posinf=0.0, neginf=0.0).tolist()

    percentiles = {
        "p10": tolist_safe(np.percentile(wealth, 10, axis=0)),
        "p25": tolist_safe(np.percentile(wealth, 25, axis=0)),
        "p50": tolist_safe(np.percentile(wealth, 50, axis=0)),
        "p75": tolist_safe(np.percentile(wealth, 75, axis=0)),
        "p90": tolist_safe(np.percentile(wealth, 90, axis=0)),
        "p50_real": tolist_safe(np.percentile(wealth_real, 50, axis=0)),
    }
    final = wealth[:, -1]
    summary = {
        "expected_final": float(np.nan_to_num(np.mean(final))),
        "median_final": float(np.nan_to_num(np.median(final))),
        "p10_final": float(np.nan_to_num(np.percentile(final, 10))),
        "p90_final": float(np.nan_to_num(np.percentile(final, 90))),
    }
    if req.target is not None:
        summary["prob_hit_target"] = float(np.mean(final >= req.target))

    # --- Max drawdown on the median path (skip t=0 and avoid /0) ---
    median_path = np.array(percentiles["p50"], dtype=float)
    running_max = np.maximum.accumulate(median_path)
    safe_den = running_max.copy()
    safe_den[safe_den <= 0] = 1.0  # prevent divide-by-zero
    drawdowns = (median_path - running_max) / safe_den
    if drawdowns.shape[0] > 1:
        max_dd = float(np.nanmin(drawdowns[1:]))  # skip first point
    else:
        max_dd = 0.0

    # --- CAGR (handle zero or flat starts) ---
    if median_path[-1] > 0:
        # find first positive point to avoid 0 baseline
        pos_idx = np.argmax(median_path > 0)
        if median_path[pos_idx] > 0:
            years_elapsed = (len(median_path) - 1 - pos_idx) / req.frequency
            cagr = (median_path[-1] / median_path[pos_idx]) ** (1 / max(years_elapsed, 1e-9)) - 1
        else:
            cagr = 0.0
    else:
        cagr = 0.0

    insights = {
        "median_cagr": float(np.nan_to_num(cagr)),
        "median_max_drawdown": float(np.nan_to_num(max_dd)),
        "total_contrib": float(np.sum(contrib_schedule)),
        "real_median_final": float(np.array(percentiles["p50_real"])[-1]),
    }



    # Suggested knobs (simple heuristics)
    suggestions = []
    if req.target:
        # rough needed multiplier on contributions (keeping returns) to reach target at 60th percentile
        ratio = req.target / (summary["median_final"] + 1e-9)
        if ratio > 1.05:
            suggestions.append(f"Increase annual contributions by ~{(ratio-1)*100:.0f}% (or raise yearly growth above {req.contribution_growth*100:.1f}%).")
        elif ratio < 0.9:
            suggestions.append("You appear on track at median case; consider lowering risk or locking gains later.")
    if req.expense_ratio > 0.002:
        suggestions.append("Your expense ratio looks high; consider a lower-cost index fund (<0.10%).")
    if req.volatility > 0.22:
        suggestions.append("Volatility is high; a diversified mix could smooth drawdowns.")

    return {
        "times": list(range(0, T+1)),
        "percentiles": percentiles,
        "summary": summary,
        "insights": insights,
        "suggestions": suggestions
    }

@app.post("/simulate")
def simulate(req: SimRequest):
    return simulate_paths(req)

class SuggestRequest(BaseModel):
    target: float
    horizon_years: int = 20
    expected_return: float = 0.07
    volatility: float = 0.18
    expense_ratio: float = 0.001
    initial: float = 0.0
    current_annual_contribution: float = 6000
    contribution_growth: float = 0.03

@app.post("/suggestions")
def suggest(req: SuggestRequest):
    # back-of-the-envelope: solve for contribution needed given FV of growing annuity with risky return approximated by expected return
    r = req.expected_return - req.expense_ratio
    g = req.contribution_growth
    n = req.horizon_years
    if abs(r - g) < 1e-6:
        annuity_factor = n * (1 + r) ** (n-1)
    else:
        annuity_factor = ((1 + r) ** n - (1 + g) ** n) / (r - g)
    needed_contrib_year1 = max((req.target - req.initial * (1 + r) ** n) / max(annuity_factor, 1e-9), 0)
    delta = needed_contrib_year1 - req.current_annual_contribution
    return {
        "year1_contribution_needed": needed_contrib_year1,
        "increase_over_current": delta,
        "note": "This uses expected-return math; Monte Carlo will vary."
    }
