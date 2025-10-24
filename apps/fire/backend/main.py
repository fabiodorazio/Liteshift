
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import numpy as np
from datetime import date
import calendar

app = FastAPI(title="Better Compound Interest API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



# --- helpers (reuse if you already defined similar ones) ---
def add_months(d: date, months: int) -> date:
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    day = min(d.day, calendar.monthrange(y, m)[1])
    return date(y, m, day)

def sanitize_list(xs):
    return np.nan_to_num(np.array(xs, dtype=float), nan=0.0, posinf=0.0, neginf=0.0).tolist()

def sanitize_float(x: float) -> float:
    return float(np.nan_to_num(float(x)))

def round_float(x: float, d: int) -> float:
    return float(np.round(float(x), d))

def round_list(xs, d: int):
    return np.round(np.array(xs, dtype=float), d).tolist()

# --- request model ---
class FireRequest(BaseModel):
    initial_balance: float = 0.0
    monthly_disposable: float = 500.0      # invested during accumulation
    monthly_drawdown: float = 2500.0       # spent during retirement
    years_to_retire: int = 20
    years_in_retirement: int = 30
    expected_return_accum: float = 0.07    # annual
    expected_return_ret: float = 0.05      # annual (can be lower in retirement)
    volatility: float = 0.18               # annual
    inflation: float = 0.02                # annual
    expense_ratio: float = 0.001
    n_sims: int = 2000
    frequency: int = 12                    # monthly
    start_date: date | None = None
    decimals: int = 1
    seed: int | None = None

@app.post("/fire")
def fire(req: FireRequest):
    if req.seed is not None:
        np.random.seed(req.seed)

    T_acc = req.years_to_retire * req.frequency
    T_ret = req.years_in_retirement * req.frequency
    T = T_acc + T_ret
    dt = 1.0 / req.frequency

    # Build monthly contribution/withdrawal schedule (inflation yearly)
    contrib = np.zeros(T, dtype=float)
    draw    = np.zeros(T, dtype=float)

    # accumulation: monthly_disposable grows with inflation annually
    monthly = req.monthly_disposable
    for m in range(T_acc):
        contrib[m] = monthly
        # bump once every 12 months (start of each new year in sim)
        if (m + 1) % 12 == 0:
            monthly *= (1.0 + req.inflation)

    # retirement: monthly_drawdown grows with inflation annually
    spend = req.monthly_drawdown
    for m in range(T_acc, T):
        draw[m] = spend
        if (m + 1 - T_acc) % 12 == 0:
            spend *= (1.0 + req.inflation)

    # Simulate GBM monthly factors with different expected returns for phases
    sigma = req.volatility
    mu_acc = req.expected_return_accum - req.expense_ratio
    mu_ret = req.expected_return_ret - req.expense_ratio

    # shocks for full horizon
    shock = sigma * np.sqrt(dt) * np.random.randn(req.n_sims, T)

    drift_acc = (mu_acc - 0.5 * sigma * sigma) * dt
    drift_ret = (mu_ret - 0.5 * sigma * sigma) * dt

    # factors piecewise
    factors = np.exp(drift_acc + shock[:, :T_acc])
    factors_ret = np.exp(drift_ret + shock[:, T_acc:])
    factors = np.concatenate([factors, factors_ret], axis=1)

    # Wealth simulation with contributions then withdrawals
    wealth = np.zeros((req.n_sims, T + 1), dtype=float)
    wealth[:, 0] = req.initial_balance
    for t in range(1, T + 1):
        # previous wealth grows
        w_prev = wealth[:, t - 1] * factors[:, t - 1]
        # net flow this month (add invest / subtract spending)
        flow = contrib[t - 1] - draw[t - 1]
        wealth[:, t] = w_prev + flow
        wealth[:, t] = np.maximum(wealth[:, t], 0.0)  # no negative balance

    # Percentiles
    p10 = np.percentile(wealth, 10, axis=0)
    p25 = np.percentile(wealth, 25, axis=0)
    p50 = np.percentile(wealth, 50, axis=0)
    p75 = np.percentile(wealth, 75, axis=0)
    p90 = np.percentile(wealth, 90, axis=0)

    # Summary: terminal stats & survival probability
    terminal = wealth[:, -1]
    prob_nonzero_end = float(np.mean(terminal > 0))
    median_terminal = float(np.median(terminal))

    # Time to depletion: first index where wealth hits zero during retirement
    # (count only after retirement starts)
    time_to_zero = []
    for i in range(req.n_sims):
        path = wealth[i]
        zero_idx = None
        for t in range(T_acc + 1, T + 1):
            if path[t] <= 0.0:
                zero_idx = t
                break
        if zero_idx is None:
            time_to_zero.append(T_ret)   # lasted the whole retirement
        else:
            time_to_zero.append(max(0, zero_idx - T_acc))
    median_longevity_months = int(np.median(time_to_zero))

    # Labels from today
    start_d = req.start_date or date.today()
    labels = [add_months(start_d, m).isoformat() for m in range(0, T + 1)]

    # Round & sanitize
    d = max(0, int(req.decimals))
    percentiles = {
        "p10": round_list(sanitize_list(p10), d),
        "p25": round_list(sanitize_list(p25), d),
        "p50": round_list(sanitize_list(p50), d),
        "p75": round_list(sanitize_list(p75), d),
        "p90": round_list(sanitize_list(p90), d),
    }
    summary = {
        "median_terminal": round_float(sanitize_float(median_terminal), d),
        "prob_nonzero_end": round_float(sanitize_float(prob_nonzero_end), d),
        "median_lasting_months": median_longevity_months,
        "retirement_start_index": T_acc  # helpful for drawing a vertical marker
    }

    return {
        "labels": labels,
        "percentiles": percentiles,
        "summary": summary
    }
