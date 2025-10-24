const API = "http://localhost:8000";

// --- 1-decimal formatting helpers ---
const fmt1 = (n) => Number(n).toLocaleString(undefined, {
  minimumFractionDigits: 1, maximumFractionDigits: 1
});
const fmt1pct = (x) => `${(x * 100).toFixed(1)}%`;
const fmt1usd = (n) => `$${fmt1(n)}`;

let chart;

// --- Plugins: halo + left-to-right reveal (safe versions) ---
const haloPlugin = {
  id: "halo",
  afterDatasetsDraw(chart, args, pluginOptions) {
    const { ctx } = chart;
    const blur = pluginOptions?.blur ?? 10;
    const alpha = pluginOptions?.alpha ?? 0.35;
    const extra = pluginOptions?.extraWidth ?? 2;

    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i);
      if (!meta || meta.hidden || !meta.data || meta.data.length === 0) return;

      ctx.save();
      ctx.beginPath();
      const pts = meta.data;
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k];
        if (!p || typeof p.x !== "number" || typeof p.y !== "number") continue;
        if (k === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.lineWidth = (ds.borderWidth || 2) + extra;
      ctx.shadowBlur = blur;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = (typeof ds.borderColor === "string" && ds.borderColor) ? ds.borderColor : "#ffffff";
      ctx.shadowColor = ctx.strokeStyle;
      ctx.stroke();
      ctx.restore();
    });
  }
};

const revealPlugin = {
  id: "reveal",
  beforeDatasetsDraw(chart) {
    const area = chart?.chartArea;
    if (!area) return;
    const progress = chart.$revealProgress ?? 1;
    const { ctx } = chart;
    ctx.save();
    ctx.beginPath();
    ctx.rect(area.left, area.top, area.width * progress, area.bottom - area.top);
    ctx.clip();
  },
  afterDatasetsDraw(chart) {
    const area = chart?.chartArea;
    if (!area) return;
    chart.ctx.restore();
  }
};

document.getElementById("sim-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    initial: +document.getElementById("initial").value,
    annual_contribution: +document.getElementById("annual_contribution").value,
    contribution_growth: +document.getElementById("contribution_growth").value / 100,
    years: +document.getElementById("years").value,
    expected_return: +document.getElementById("expected_return").value / 100,
    volatility: +document.getElementById("volatility").value / 100,
    expense_ratio: +document.getElementById("expense_ratio").value / 100,
    inflation: +document.getElementById("inflation").value / 100,
    target: document.getElementById("target").value ? +document.getElementById("target").value : null,
    n_sims: +document.getElementById("n_sims").value,
    frequency: 12
  };

  const res = await fetch(`${API}/simulate`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  renderChart(data);
  renderStats(data);
});

// helper: add months to a Date
function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function renderChart(data) {
  // Use real Date labels starting today, 1 label per month
  const start = new Date(); // change to new Date("2025-01-01") if you want a fixed start
  const labels = data.times.map(m => addMonths(start, m));

  const p10 = data.percentiles.p10;
  const p50 = data.percentiles.p50;
  const p90 = data.percentiles.p90;
  const p50_real = data.percentiles.p50_real;

  const ctx = document.getElementById("chart").getContext("2d");
  if (chart) chart.destroy();

  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {label:"P10", data: p10, borderWidth:1, tension:0.2, pointRadius:0, pointHoverRadius:0, fill:false},
        {label:"Median (nominal)", data: p50, borderWidth:2, tension:0.2, pointRadius:0, pointHoverRadius:0, fill:false},
        {label:"P90", data: p90, borderWidth:1, tension:0.2, pointRadius:0, pointHoverRadius:0, fill:false},
        {label:"Median (real)", data: p50_real, borderWidth:2, borderDash:[6,4], tension:0.2, pointRadius:0, pointHoverRadius:0, fill:false}
      ]
    },
    options: {
      responsive: true,
      animation: false, // custom reveal below
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${fmt1usd(ctx.parsed.y)}`
          }
        },
        halo: { blur: 10, extraWidth: 2, alpha: 0.35 }
      },
      scales: {
        x: {
          type: "time",
          time: {
            unit: "year"    // use "month" for denser ticks
          },
          title: { display:true, text:"Date" }
        },
        y: {
          title: { display:true, text:"Portfolio value ($)" },
          ticks: {
            callback: (v) => fmt1usd(v)
          }
        }
      }
    },
    plugins: [haloPlugin, revealPlugin]
  });

  // Left-to-right reveal animation (1.2s)
  chart.$revealProgress = 0;
  const duration = 1200;
  const startTs = performance.now();
  function step(ts) {
    const elapsed = ts - startTs;
    chart.$revealProgress = Math.min(1, elapsed / duration);
    chart.draw();
    if (chart.$revealProgress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(() => requestAnimationFrame(step));
}

function renderStats(data) {
  const s = data.summary;
  const i = data.insights;
  const sugg = data.suggestions || [];
  const html = `
    <h3>Summary</h3>
    <ul>
      <li>Expected final (mean): ${fmt1usd(s.expected_final)}</li>
      <li>Median final: ${fmt1usd(s.median_final)} (real: ${fmt1usd(i.real_median_final)})</li>
      <li>P10 / P90: ${fmt1usd(s.p10_final)} / ${fmt1usd(s.p90_final)}</li>
      ${s.prob_hit_target !== undefined ? `<li>Probability to hit target: ${(s.prob_hit_target*100).toFixed(1)}%</li>` : ""}
      <li>Total contributions: ${fmt1usd(i.total_contrib)}</li>
      <li>Median CAGR: ${fmt1pct(i.median_cagr)}</li>
      <li>Median max drawdown: ${fmt1pct(i.median_max_drawdown)}</li>
    </ul>
    ${sugg.length ? `<h3>Suggestions</h3><ul>` + sugg.map(x=>`<li>${x}</li>`).join("") + `</ul>` : ""}
  `;
  document.getElementById("stats").innerHTML = html;
}
