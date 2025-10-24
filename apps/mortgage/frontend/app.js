const API = "http://localhost:8000";
const fmt1 = (n) => Number(n).toLocaleString(undefined, { minimumFractionDigits:1, maximumFractionDigits:1 });
const fmtUSD = (n) => `$${fmt1(n)}`;

let chart;

// simple clip-reveal (optional)
const revealPlugin = {
  id: "reveal",
  beforeDatasetsDraw(chart) {
    const a = chart?.chartArea; if (!a) return;
    const p = chart.$reveal ?? 1; const { ctx } = chart;
    ctx.save(); ctx.beginPath(); ctx.rect(a.left, a.top, a.width * p, a.bottom - a.top); ctx.clip();
  },
  afterDatasetsDraw(chart){ try{ chart.ctx.restore(); }catch{} }
};

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("mort-form").addEventListener("submit", onRun);
});

async function onRun(e){
  e.preventDefault();

  const principal = +document.getElementById("principal").value;
  const term_years = +document.getElementById("term_years").value;
  const fixed_years = +document.getElementById("fixed_years").value;
  const fixed_rate = +document.getElementById("fixed_rate").value / 100;
  const variable_rate = +document.getElementById("variable_rate").value / 100;
  const monthly_overpayment = +document.getElementById("overpay").value;
  const recalc_on_rate_change = document.getElementById("recalc").value === "true";

  // optional extra payment
  const extra_month = document.getElementById("extra_month").value; // "YYYY-MM" or ""
  const extra_amount = +document.getElementById("extra_amount").value || 0;
  let extra_payments = [];
  if (extra_month && extra_amount > 0) {
    // month offset from start (0-based): compute year/month offsets
    const start = new Date(); // aligns with server default start_date = today
    const [y, m] = extra_month.split("-").map(Number);
    const when = new Date(y, m - 1, 1);
    const diffMonths = (when.getFullYear() - start.getFullYear()) * 12 + (when.getMonth() - start.getMonth());
    if (diffMonths >= 0) {
      extra_payments.push({ year: Math.floor(diffMonths / 12), month: diffMonths % 12, amount: extra_amount });
    }
  }

  let res, raw;
  try {
    res = await fetch(`${API}/mortgage`, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({
        principal, term_years, fixed_years, fixed_rate, variable_rate,
        monthly_overpayment, extra_payments,
        recalc_on_rate_change, decimals: 1
      })
    });
    raw = await res.text();
  } catch (err) {
    console.error("Network error:", err);
    document.getElementById("stats").innerHTML = `<div style="color:#ffb4b4;">⚠︎ Network error to backend.</div>`;
    return;
  }
  if (!res.ok) {
    console.error("Backend error:", res.status, raw);
    document.getElementById("stats").innerHTML = `<div style="color:#ffb4b4;">⚠︎ Backend error ${res.status}.</div>`;
    return;
  }
  let data;
  try { data = JSON.parse(raw); } catch(e2){ console.error("JSON parse error:", raw); return; }

  renderChart(data);
  renderStats(data);
}

function renderChart(data){
  const ctx = document.getElementById("chart").getContext("2d");
  if (chart) chart.destroy();

  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: data.labels, // ISO dates
      datasets: [
        { label: "Balance", data: data.balance, borderWidth: 2, tension: 0.2, pointRadius: 0, fill: false },
        { label: "Baseline (no overpay)", data: data.baseline_balance, borderWidth: 2, tension: 0.2, pointRadius: 0, borderDash:[6,4], fill: false }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label:(c)=> `${c.dataset.label}: ${fmtUSD(c.parsed.y)}` } }
      },
      scales: {
        x: { type:"time", time:{ unit:"year" }, title:{ display:true, text:"Date" } },
        y: { title:{ display:true, text:"Outstanding balance ($)" }, ticks:{ callback:(v)=>fmtUSD(v) } }
      }
    },
    plugins: [revealPlugin]
  });

  // reveal
  chart.$reveal = 0;
  const DUR = 1000, t0 = performance.now();
  const step = (ts)=>{ const p = Math.min(1,(ts - t0)/DUR); chart.$reveal = p; chart.draw(); if(p<1) requestAnimationFrame(step); };
  requestAnimationFrame(()=>requestAnimationFrame(step));
}

if (s.is_balloon) {
  items.push(`<li>Ending (balloon) balance: ${fmtUSD(s.ending_balance)}</li>`);
}


function renderStats(data){
  const s = data.summary;
  const html = `
    <h3>Summary</h3>
    <ul>
      <li>Payoff date: ${s.payoff_date} (${s.payoff_months} months)</li>
      <li>Baseline payoff date: ${s.baseline_payoff_date} (${s.baseline_payoff_months} months)</li>
      <li>Total interest: ${fmtUSD(s.total_interest)} (baseline: ${fmtUSD(s.baseline_total_interest)})</li>
      <li>Interest saved vs baseline: ${fmtUSD(s.interest_saved)}</li>
      <li>Months saved vs baseline: ${s.months_saved}</li>
      <li>Fixed period length: ${s.fixed_months} months</li>
    </ul>
  `;
  document.getElementById("stats").innerHTML = html;
}
