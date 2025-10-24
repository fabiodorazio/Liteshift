const API = "http://localhost:8000";

const fmt = (n) => n.toLocaleString(undefined, {maximumFractionDigits: 0});
let chart;

// --- Safer halo plugin (manual path) ---
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

      // Build path from data points
      ctx.save();
      ctx.beginPath();
      const pts = meta.data;
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k];
        if (!p || typeof p.x !== "number" || typeof p.y !== "number") continue;
        if (k === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      // Halo styling
      ctx.lineWidth = (ds.borderWidth || 2) + extra;
      ctx.shadowBlur = blur;
      ctx.globalAlpha = alpha;
      // use dataset borderColor if any, else fallback
      ctx.strokeStyle = (typeof ds.borderColor === "string" && ds.borderColor) ? ds.borderColor : "#ffffff";
      ctx.shadowColor = ctx.strokeStyle;
      ctx.stroke();
      ctx.restore();
    });
  }
};

// --- Safer reveal plugin with guards ---
const revealPlugin = {
  id: "reveal",
  beforeDatasetsDraw(chart) {
    const area = chart?.chartArea;
    if (!area) return; // guard: sometimes undefined before layout
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

function renderChart(data) {
  const t = data.times.map(m => m/12);
  const p10 = data.percentiles.p10;
  const p50 = data.percentiles.p50;
  const p90 = data.percentiles.p90;
  const p50_real = data.percentiles.p50_real;

  const ctx = document.getElementById("chart").getContext("2d");
  if (chart) chart.destroy();

  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: t,
      datasets: [
        {label:"P10", data: p10, borderWidth:1, tension:0.2, pointRadius:0, pointHoverRadius:0, fill:false},
        {label:"Median (nominal)", data: p50, borderWidth:2, tension:0.2, pointRadius:0, pointHoverRadius:0, fill:false},
        {label:"P90", data: p90, borderWidth:1, tension:0.2, pointRadius:0, pointHoverRadius:0, fill:false},
        {label:"Median (real)", data: p50_real, borderWidth:2, borderDash:[6,4], tension:0.2, pointRadius:0, pointHoverRadius:0, fill:false}
      ]
    },
    options: {
      responsive: true,
      animation: false, // custom animation below
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: $${fmt(ctx.parsed.y)}` } },
        halo: { blur: 10, extraWidth: 2, alpha: 0.35 }
      },
      scales: {
        x: { title: { display:true, text:"Years" } },
        y: { title: { display:true, text:"Portfolio value ($)" }, ticks: { callback: (v)=>"$"+fmt(v) } }
      }
    },
    plugins: [haloPlugin, revealPlugin]
  });

  // Left-to-right reveal animation (guarded)
  const area = chart?.chartArea;
  chart.$revealProgress = 0;
  const duration = 1200; // ms
  const start = performance.now();
  function step(ts) {
    const elapsed = ts - start;
    chart.$revealProgress = Math.min(1, elapsed / duration);
    chart.draw();
    if (chart.$revealProgress < 1) requestAnimationFrame(step);
  }
  // Wait one frame to ensure layout & chartArea exist
  requestAnimationFrame(() => requestAnimationFrame(step));
}

function renderStats(data) {
  const s = data.summary;
  const i = data.insights;
  const sugg = data.suggestions || [];
  const html = `
    <h3>Summary</h3>
    <ul>
      <li>Expected final (mean): $${fmt(s.expected_final)}</li>
      <li>Median final: $${fmt(s.median_final)} (real: $${fmt(i.real_median_final)})</li>
      <li>P10 / P90: $${fmt(s.p10_final)} / $${fmt(s.p90_final)}</li>
      ${s.prob_hit_target !== undefined ? `<li>Probability to hit target: ${(s.prob_hit_target*100).toFixed(1)}%</li>` : ""}
      <li>Total contributions: $${fmt(i.total_contrib)}</li>
      <li>Median CAGR: ${(i.median_cagr*100).toFixed(2)}%</li>
      <li>Median max drawdown: ${(i.median_max_drawdown*100).toFixed(1)}%</li>
    </ul>
    ${sugg.length ? `<h3>Suggestions</h3><ul>` + sugg.map(x=>`<li>${x}</li>`).join("") + `</ul>` : ""}
  `;
  document.getElementById("stats").innerHTML = html;
}
