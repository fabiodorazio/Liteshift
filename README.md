# Better Compound Interest (Monte Carlo)

A small FastAPI + HTML/Chart.js app that simulates a bumpy S&P‑500‑like path with increasing yearly contributions,
summarizes percentiles, and suggests tweaks.

## Quickstart

```bash
cd backend
python -m venv .venv && source .venv/bin/activate 
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Then open `frontend/index.html` in your browser (or serve it from any static server).
Edit `API` in `frontend/app.js` if your backend URL differs.

## API
- `POST /simulate` — run Monte Carlo
  - body fields: `initial, annual_contribution, contribution_growth, years, n_sims, expected_return, volatility, expense_ratio, inflation, target, frequency, seed`
- `POST /suggestions` — back-of-the-envelope contribution target

## Notes
- Returns are simulated using GBM with drift = expected_return − expense_ratio and annualized volatility.
- Contributions rise each year by `contribution_growth` and are deposited evenly each month.
- Real dollars are computed using the `inflation` assumption.
