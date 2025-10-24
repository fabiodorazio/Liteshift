const API = "http://localhost:8000";
const fmt1 = (n) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtPct = (x) => `${fmt1(x)}%`;

let chart;

const revealPlugin = {
  id: "reveal",
  beforeDatasetsDraw(chart) {
    const area = chart?.chartArea; if (!area) return;
    const p = chart.$reveal ?? 1;
    const { ctx } = chart;
    ctx.save(); ctx.beginPath();
    ctx.rect(area.left, area.top, area.width * p, area.bottom - area.top);
    ctx.clip();
  },
  afterDatasetsDraw(chart) { try { chart.ctx.restore(); } catch {} }
};

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("dd-form").addEventListener("submit", run);
});

async function run(e) {
  e.preventDefault();
  const payload = {
    years: +document.getElementById("years").value,
    expected_return: +document.getElementById("er").value / 100,
    volatility: +document.getElementById("vol").value / 100,
    expense_ratio: +document.getElementById("eratio").value / 100,
    n_sims: +document.getElementById("sims").value,
    frequency: 12,
    decimals: 1
  };

  const res = await fetch(`${API}/drawdown`, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  renderChart(data);
  renderStats(data);
}

function renderChart(data) {
  const ctx = document.getElementById("chartDD").getContext("2d");
  if (chart) chart.destroy();

  // Drawdowns come as negatives; we’ll display as negatives with % formatting
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: data.labels, // ISO dates
      datasets: [
        { label:"P10 (shallower)", data: data.percentiles.p10, borderWidth:1, tension:0.2, pointRadius:0, fill:false },
        { label:"Median", data: data.percentiles.p50, borderWidth:2, tension:0.2, pointRadius:0, fill:false },
        { label:"P90 (deeper)", data: data.percentiles.p90, borderWidth:1, tension:0.2, pointRadius:0, fill:false }
      ]
    },
    options: {
      responsive: true,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtPct(c.parsed.y)}` } }
      },
      scales: {
        x: { type:"time", time:{ unit:"year" }, title:{ display:true, text:"Date" } },
        y: { title:{ display:true, text:"Drawdown (%)" },
             ticks:{ callback: (v)=>fmtPct(v) } }
      }
    },
    plugins: [revealPlugin]
  });

  // Left-to-right reveal
  chart.$reveal = 0;
  const DUR = 1000, t0 = performance.now();
  const step = (ts) => {
    const p = Math.min(1, (ts - t0) / DUR);
    chart.$reveal = p; chart.draw();
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(() => requestAnimationFrame(step));
}

function renderStats(data) {
  const s = data.summary;
  const html = `
    <h3>Summary</h3>
    <ul>
      <li>Median max drawdown: ${fmtPct(s.median_max_drawdown)}</li>
      <li>P10 / P90 of max drawdown: ${fmtPct(s.p10_max_drawdown)} / ${fmtPct(s.p90_max_drawdown)}</li>
      <li>Median recovery time (months): ${s.median_recovery_months}</li>
    </ul>
  `;
  document.getElementById("stats").innerHTML = html;
}
