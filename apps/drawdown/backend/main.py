from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import date
import calendar
import numpy as np

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173","http://127.0.0.1:5173",
        "http://localhost:5500","http://127.0.0.1:5500",
        "http://localhost:8000","http://127.0.0.1:8000"
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

def add_months(d: date, months: int) -> date:
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    day = min(d.day, calendar.monthrange(y, m)[1])
    return date(y, m, day)

def sanitize_float(x: float) -> float:
    return float(np.nan_to_num(float(x)))

def sanitize_list(xs):
    return np.nan_to_num(np.array(xs, dtype=float), nan=0.0, posinf=0.0, neginf=0.0).tolist()

def round_float(x: float, d: int) -> float:
    return float(np.round(float(x), d))

def round_list(xs, d: int):
    return np.round(np.array(xs, dtype=float), d).tolist()

class DrawdownRequest(BaseModel):
    years: int = 30
    expected_return: float = 0.07
    volatility: float = 0.18
    expense_ratio: float = 0.001
    n_sims: int = 2000
    frequency: int = 12
    start_date: date | None = None
    decimals: int = 1
    seed: int | None = None

@app.post("/drawdown")
def drawdown(req: DrawdownRequest):
    if req.seed is not None:
        np.random.seed(req.seed)
    T = req.years * req.frequency
    dt = 1.0 / req.frequency
    mu_net = req.expected_return - req.expense_ratio
    sigma = req.volatility

    drift = (mu_net - 0.5 * sigma * sigma) * dt
    shock = sigma * np.sqrt(dt) * np.random.randn(req.n_sims, T)
    factors = np.exp(drift + shock)
    prices = np.ones((req.n_sims, T + 1), dtype=float)
    prices[:, 1:] = np.cumprod(factors, axis=1)

    rolling_peak = np.maximum.accumulate(prices, axis=1)
    dd = (prices - rolling_peak) / rolling_peak  # <= 0

    p10 = np.percentile(dd, 10, axis=0)
    p25 = np.percentile(dd, 25, axis=0)
    p50 = np.percentile(dd, 50, axis=0)
    p75 = np.percentile(dd, 75, axis=0)
    p90 = np.percentile(dd, 90, axis=0)

    max_dd_per_path = dd.min(axis=1)
    median_max_dd = float(np.median(max_dd_per_path))
    p10_max_dd = float(np.percentile(max_dd_per_path, 10))
    p90_max_dd = float(np.percentile(max_dd_per_path, 90))

    med_path = np.percentile(prices, 50, axis=0)
    med_peak = np.maximum.accumulate(med_path)
    med_dd = (med_path - med_peak) / med_peak
    trough_idx = int(np.argmin(med_dd))
    rec_idx = trough_idx
    prev_peak = med_peak[trough_idx]
    for j in range(trough_idx, med_path.shape[0]):
        if med_path[j] >= prev_peak:
            rec_idx = j
            break
    recovery_months = max(0, rec_idx - trough_idx)

    start_d = req.start_date or date.today()
    labels = [add_months(start_d, m).isoformat() for m in range(0, T + 1)]

    d = max(0, int(req.decimals))
    percentiles = {
        "p10": round_list(sanitize_list(p10), d),
        "p25": round_list(sanitize_list(p25), d),
        "p50": round_list(sanitize_list(p50), d),
        "p75": round_list(sanitize_list(p75), d),
        "p90": round_list(sanitize_list(p90), d),
    }
    summary = {
        "median_max_drawdown": round_float(sanitize_float(median_max_dd), d),
        "p10_max_drawdown": round_float(sanitize_float(p10_max_dd), d),
        "p90_max_drawdown": round_float(sanitize_float(p90_max_dd), d),
        "median_recovery_months": int(recovery_months),
    }

    return {"labels": labels, "percentiles": percentiles, "summary": summary}
