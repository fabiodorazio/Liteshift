// ---------- Config & formatters ----------
const API = "http://localhost:8000";
const fmt1 = (n) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt1usd = (n) => `$${fmt1(n)}`;

// ---------- State ----------
let chart;                 // main chart
let compareChart;          // comparison chart
const compareRuns = [];    // stored median lines

// ---------- Plugins ----------
const haloPlugin = {
  id: "halo",
  afterDatasetsDraw(chart, _args, opts) {
    try {
      const { ctx } = chart;
      const blur = opts?.blur ?? 10;
      const alpha = opts?.alpha ?? 0.35;
      const extra = opts?.extraWidth ?? 2;

      chart.data.datasets.forEach((ds, i) => {
        const meta = chart.getDatasetMeta(i);
        if (!meta || meta.hidden || !meta.data?.length) return;

        ctx.save();
        ctx.beginPath();
        for (let k = 0; k < meta.data.length; k++) {
          const p = meta.data[k];
          if (!p || typeof p.x !== "number" || typeof p.y !== "number") continue;
          if (k === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.lineWidth = (ds.borderWidth || 2) + extra;
        ctx.shadowBlur = blur;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = (typeof ds.borderColor === "string" && ds.borderColor) || "#fff";
        ctx.shadowColor = ctx.strokeStyle;
        ctx.stroke();
        ctx.restore();
      });
    } catch (e) { console.error("halo plugin", e); }
  }
};

const revealPlugin = {
  id: "reveal",
  beforeDatasetsDraw(chart) {
    try {
      const area = chart?.chartArea; if (!area) return;
      const progress = chart.$revealProgress ?? 1;
      const { ctx } = chart;
      ctx.save();
      ctx.beginPath();
      ctx.rect(area.left, area.top, area.width * progress, area.bottom - area.top);
      ctx.clip();
    } catch (e) { console.error("reveal before", e); }
  },
  afterDatasetsDraw(chart) {
    try { chart.ctx.restore(); } catch {}
  }
};

const finalLabelPlugin = {
  id: "finalLabel",
  afterDatasetsDraw(chart) {
    try {
      if ((chart.$revealProgress ?? 1) < 1) return;
      const expected = chart.$expectedFinal;
      if (typeof expected !== "number" || isNaN(expected)) return;

      const xScale = chart.scales.x, yScale = chart.scales.y;
      const labels = chart.data.labels;
      const area = chart.chartArea;
      if (!xScale || !yScale || !labels?.length || !area) return;

      const lastX = labels[labels.length - 1];
      let x = xScale.getPixelForValue(lastX);
      let y = yScale.getPixelForValue(expected);
      x = Math.min(Math.max(x, area.left), area.right);
      y = Math.min(Math.max(y, area.top + 8), area.bottom - 8);

      const ctx = chart.ctx;
      const text = `Mean: ${fmt1usd(expected)}`;
      ctx.save();
      ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
      const padX = 8, h = 22, w = ctx.measureText(text).width + padX * 2, r = 8;
      let bx = x - w - 12, by = y - h / 2;
      if (bx < area.left + 6) bx = Math.min(x + 12, area.right - w - 6);
      if (by < area.top + 6) by = area.top + 6;
      if (by + h > area.bottom - 6) by = area.bottom - h - 6;

      // Tag bg
      ctx.beginPath();
      ctx.moveTo(bx + r, by);
      ctx.lineTo(bx + w - r, by);
      ctx.quadraticCurveTo(bx + w, by, bx + w, by + r);
      ctx.lineTo(bx + w, by + h - r);
      ctx.quadraticCurveTo(bx + w, by + h, bx + w - r, by + h);
      ctx.lineTo(bx + r, by + h);
      ctx.quadraticCurveTo(bx, by + h, bx, by + h - r);
      ctx.lineTo(bx, by + r);
      ctx.quadraticCurveTo(bx, by, bx + r, by);
      ctx.closePath();
      ctx.fillStyle = "rgba(15,23,42,.9)";
      ctx.strokeStyle = "rgba(43,54,85,1)";
      ctx.lineWidth = 1;
      ctx.shadowColor = "rgba(0,0,0,.35)";
      ctx.shadowBlur = 8;
      ctx.fill(); ctx.stroke();

      // Text
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#f5f7ff";
      ctx.fillText(text, bx + padX, by + h / 2 + 4);
      ctx.restore();
    } catch (e) { console.error("finalLabel", e); }
  }
};

// ---------- Helpers ----------
function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

// ---------- Wire up ----------
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("sim-form");
  const clearBtn = document.getElementById("clear-compare");

  form.addEventListener("submit", onRun);
  clearBtn?.addEventListener("click", () => {
    compareRuns.length = 0;
    if (compareChart) { compareChart.data.datasets = []; compareChart.update(); }
  });
});

async function onRun(e) {
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

  renderMainChart(data);
  addRunToComparison(data, payload);
  renderCompareChart();
  renderStats(data);
}

// ---------- Charts ----------
function renderMainChart(data) {
  const ctx = document.getElementById("chart").getContext("2d");
  if (chart) chart.destroy();

  // Date labels from today
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const labels = data.times.map((m) => addMonths(start, m));

  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label:"P10", data: data.percentiles.p10, borderWidth:1, tension:0.2, pointRadius:0, fill:false },
        { label:"Median (nominal)", data: data.percentiles.p50, borderWidth:2, tension:0.2, pointRadius:0, fill:false },
        { label:"P90", data: data.percentiles.p90, borderWidth:1, tension:0.2, pointRadius:0, fill:false },
        { label:"Median (real)", data: data.percentiles.p50_real, borderWidth:2, borderDash:[6,4], tension:0.2, pointRadius:0, fill:false }
      ]
    },
    options: {
      responsive: true,
      animation: false, // we'll drive reveal
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt1usd(c.parsed.y)}` } },
        halo: { blur: 10, extraWidth: 2, alpha: 0.35 }
      },
      scales: {
        x: { type: "time", time: { unit: "year" }, title: { display:true, text:"Date" } },
        y: { title: { display:true, text:"Portfolio value ($)" }, ticks: { callback: (v) => fmt1usd(v) } }
      }
    },
    plugins: [haloPlugin, revealPlugin, finalLabelPlugin]
  });

  // Provide mean final for the tag
  chart.$expectedFinal = data.summary.expected_final;

  // Left-to-right reveal (~1.2s)
  chart.$revealProgress = 0;
  const DUR = 1200;
  const t0 = performance.now();
  function step(ts) {
    const p = Math.min(1, (ts - t0) / DUR);
    chart.$revealProgress = p;
    chart.draw();
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(() => requestAnimationFrame(step));
}

function runLabelFromPayload(p) {
  const er = (p.expected_return * 100).toFixed(1);
  const vol = (p.volatility * 100).toFixed(1);
  const cg = (p.contribution_growth * 100).toFixed(1);
  return `Y:${p.years} • ER:${er}% • Vol:${vol}% • CG:${cg}%`;
}

function addRunToComparison(data, payload) {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const points = data.percentiles.p50.map((y, i) => ({ x: addMonths(start, i), y }));
  compareRuns.push({ label: runLabelFromPayload(payload), data: points });
}

function renderCompareChart() {
  const el = document.getElementById("chartCompare");
  if (!el) return; // only render if the canvas exists in HTML
  const ctx = el.getContext("2d");

  const datasets = compareRuns.map((run) => ({
    label: run.label,
    data: run.data,    // [{x: Date, y: number}, ...]
    borderWidth: 2,
    tension: 0.2,
    pointRadius: 0,
    fill: false
  }));

  if (!compareChart) {
    compareChart = new Chart(ctx, {
      type: "line",
      data: { datasets },
      options: {
        responsive: true,
        interaction: { mode: "nearest", intersect: false },
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              title: (items) => new Date(items[0].parsed.x).toLocaleDateString(),
              label: (c) => `${c.dataset.label}: ${fmt1usd(c.parsed.y)}`
            }
          }
        },
        scales: {
          x: { type: "time", time: { unit: "year" }, title: { display:true, text:"Date" } },
          y: { title: { display:true, text:"Median (nominal)" }, ticks: { callback: (v) => fmt1usd(v) } }
        }
      }
    });
  } else {
    compareChart.data.datasets = datasets;
    compareChart.update();
  }
}

// ---------- Stats ----------
function renderStats(data) {
  const s = data.summary, i = data.insights, sugg = data.suggestions || [];
  const html = `
    <h3>Summary</h3>
    <ul>
      <li>Expected final (mean): ${fmt1usd(s.expected_final)}</li>
      <li>Median final: ${fmt1usd(s.median_final)} (real: ${fmt1usd(i.real_median_final)})</li>
      <li>P10 / P90: ${fmt1usd(s.p10_final)} / ${fmt1usd(s.p90_final)}</li>
      ${s.prob_hit_target !== undefined ? `<li>Probability to hit target: ${(s.prob_hit_target*100).toFixed(1)}%</li>` : ""}
      <li>Total contributions: ${fmt1usd(i.total_contrib)}</li>
      <li>Median CAGR: ${(i.median_cagr*100).toFixed(1)}%</li>
      <li>Median max drawdown: ${(i.median_max_drawdown*100).toFixed(1)}%</li>
    </ul>
    ${sugg.length ? `<h3>Suggestions</h3><ul>` + sugg.map(x=>`<li>${x}</li>`).join("") + `</ul>` : ""}
  `;
  document.getElementById("stats").innerHTML = html;
}
