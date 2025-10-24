# --- imports (most you already have) ---
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from datetime import date
import calendar
import numpy as np
from pydantic import BaseModel
from typing import List, Optional

app = FastAPI(title="Better Compound Interest API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- helpers (reuse if they already exist in your file) ---
def add_months(d: date, months: int) -> date:
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    day = min(d.day, calendar.monthrange(y, m)[1])
    return date(y, m, day)

def round_float(x: float, d: int) -> float:
    return float(np.round(float(x), d))

def round_list(xs, d: int):
    return np.round(np.array(xs, dtype=float), d).tolist()

def _pmt(balance: float, i: float, n: int) -> float:
    """Monthly annuity payment for rate i (per month), n months, principal balance."""
    if n <= 0:
        return balance
    if abs(i) < 1e-12:
        return balance / n
    return balance * (i) / (1.0 - (1.0 + i) ** (-n))

class ExtraPayment(BaseModel):
    year: int            # offset years from start (0 = this year)
    month: int           # 0-based month offset within that year (0..11)
    amount: float

class MortgageRequest(BaseModel):
    principal: float = 350_000.0
    term_years: int = 25
    fixed_years: int = 5
    fixed_rate: float = 0.04         # 4% APR during fixed period
    variable_rate: float = 0.055     # 5.5% APR after
    monthly_overpayment: float = 0.0
    extra_payments: Optional[List[ExtraPayment]] = None  # optional lump-sum list
    start_date: Optional[date] = None
    recalc_on_rate_change: bool = True
    decimals: int = 1

class MortgageResponse(BaseModel):
    labels: List[str]
    balance: List[float]
    baseline_balance: List[float]
    schedule_payment: List[float]          # scheduled annuity (excl. overpay/lumps)
    total_payment: List[float]             # scheduled + overpay + lumps
    interest: List[float]
    principal: List[float]
    summary: dict

def _amortize(principal: float, term_m: int, fixed_m: int, fixed_r_yr: float, var_r_yr: float,
              monthly_overpay: float, extra_map: dict, recalc_on_change: bool):
    bal = principal
    i_fixed = fixed_r_yr / 12.0
    i_var   = var_r_yr   / 12.0

    balances = [bal]
    sched = []      # scheduled payment (no overpay/lump)
    totalp = []     # including overpay + lump
    interest = []
    principal_paid = []

    months_left = term_m
    # initial scheduled payment for phase 1
    pmt = _pmt(bal, i_fixed, months_left)

    for m in range(1, term_m + 1):
        current_rate = i_fixed if m <= fixed_m else i_var

        # optionally recalc when rate switches
        if recalc_on_change and m == fixed_m + 1:
            months_left = term_m - (m - 1)
            pmt = _pmt(bal, current_rate, months_left)

        intr = bal * current_rate
        lump = extra_map.get(m, 0.0)
        pay_total = pmt + monthly_overpay + lump

        # standard update: balance grows by interest, then reduced by payment
        new_bal = bal + intr - pay_total

        # principal actually paid (can be negative if we had a shortfall)
        princ_actual = pay_total - intr

        # clamp very small noise around zero
        if new_bal < 0 and new_bal > -1e-6:
            new_bal = 0.0

        balances.append(new_bal)
        sched.append(pmt)
        totalp.append(pay_total)
        interest.append(intr)
        principal_paid.append(princ_actual)

        bal = new_bal
        if bal <= 0.0:
            # paid off early; stop here (arrays keep current length)
            break

    return balances, sched, totalp, interest, principal_paid


@app.post("/mortgage", response_model=MortgageResponse)
def mortgage(req: MortgageRequest):
    # Inputs
    P = float(req.principal)
    term_m   = int(req.term_years * 12)
    fixed_m  = int(req.fixed_years * 12)
    fixed_r  = float(req.fixed_rate)
    var_r    = float(req.variable_rate)
    overpay  = float(req.monthly_overpayment)
    start_d  = req.start_date or date.today()
    d        = max(0, int(req.decimals))

    # Extra payments -> map by month index (1..term_m)
    extra_map = {}
    if req.extra_payments:
        for ep in req.extra_payments:
            idx = ep.year * 12 + ep.month + 1
            if 1 <= idx <= term_m:
                extra_map[idx] = extra_map.get(idx, 0.0) + float(ep.amount)

    # MAIN schedule (with overpayments/lumps)
    balances, sched, totalp, intr, princ = _amortize(
        principal=P,
        term_m=term_m,
        fixed_m=fixed_m,
        fixed_r_yr=fixed_r,
        var_r_yr=var_r,
        monthly_overpay=overpay,
        extra_map=extra_map,
        recalc_on_change=req.recalc_on_rate_change,
    )

    # BASELINE (no overpayments/lumps)
    b_balances, b_sched, b_totalp, b_intr, b_princ = _amortize(
        principal=P,
        term_m=term_m,
        fixed_m=fixed_m,
        fixed_r_yr=fixed_r,
        var_r_yr=var_r,
        monthly_overpay=0.0,
        extra_map={},
        recalc_on_change=req.recalc_on_rate_change,
    )

    # Labels (dates) for the longer of the two (usually baseline)
    L = max(len(balances), len(b_balances))
    labels = [add_months(start_d, m).isoformat() for m in range(0, L)]

    # Pad arrays to same length for charting
    def _pad(arr, L):
        if len(arr) >= L: return arr[:L]
        return arr + [arr[-1]] * (L - len(arr))

    balances         = _pad(balances, L)
    baseline_balance = _pad(b_balances, L)
    sched            = _pad(sched, L-1)          # monthly entries
    totalp           = _pad(totalp, L-1)
    intr             = _pad(intr, L-1)
    princ            = _pad(princ, L-1)

    # Summary
    def _payoff_month(bals):  # first index where balance == 0
        for i, v in enumerate(bals):
            if v <= 0.0:
                return i
        return len(bals)-1

    m_off   = _payoff_month(balances)
    m_base  = _payoff_month(b_balances)
    total_interest      = float(np.sum(intr))
    baseline_interest   = float(np.sum(b_intr))
    interest_saved      = max(0.0, baseline_interest - total_interest)
    months_saved        = max(0, m_base - m_off)

    # after computing `balances` for the chosen scenario
    ending_balance = float(balances[-1])


    summary = {
        "payoff_months": m_off,
        "payoff_date": add_months(start_d, m_off).isoformat(),
        "baseline_payoff_months": m_base,
        "baseline_payoff_date": add_months(start_d, m_base).isoformat(),
        "total_interest": round_float(total_interest, d),
        "baseline_total_interest": round_float(baseline_interest, d),
        "interest_saved": round_float(interest_saved, d),
        "months_saved": int(months_saved),
        "ending_balance": round_float(ending_balance, d),
        "is_balloon": bool(ending_balance > 0.0),
        "fixed_months": fixed_m
    }

    return MortgageResponse(
        labels=labels,
        balance=round_list(balances, d),
        baseline_balance=round_list(baseline_balance, d),
        schedule_payment=round_list([0.0] + sched, d),   # align to labels length
        total_payment=round_list([0.0] + totalp, d),
        interest=round_list([0.0] + intr, d),
        principal=round_list([0.0] + princ, d),
        summary=summary
    )
