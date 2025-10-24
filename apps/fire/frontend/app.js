const API = "http://localhost:8000";
const fmt1 = (n) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtUSD = (n) => `$${fmt1(n)}`;

let chart;

// simple reveal clip (optional)
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
  document.getElementById("fire-form").addEventListener("submit", onRun);
});

async function onRun(e) {
  e.preventDefault();

  const payload = {
    initial_balance: +document.getElementById("initial").value,
    monthly_disposable: +document.getElementById("monthly_disposable").value,
    monthly_drawdown: +document.getElementById("monthly_drawdown").value,
    years_to_retire: +document.getElementById("years_to_retire").value,
    years_in_retirement: +document.getElementById("years_in_retirement").value,
    expected_return_accum: +document.getElementById("er_accum").value / 100,
    expected_return_ret: +document.getElementById("er_ret").value / 100,
    volatility: +document.getElementById("vol").value / 100,
    inflation: +document.getElementById("infl").value / 100,
    expense_ratio: +document.getElementById("eratio").value / 100,
    n_sims: +document.getElementById("sims").value,
    frequency: 12,
    decimals: 1
  };

  let res, raw, data;
  try {
    res = await fetch(`${API}/fire`, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });
    raw = await res.text();
  } catch (err) {
    console.error("Network error (/fire):", err);
    document.getElementById("stats").innerHTML = `<div style="color:#ffb4b4;">⚠︎ Network error to backend.</div>`;
    return;
  }
  if (!res.ok) {
    console.error("Backend error (/fire):", res.status, raw);
    document.getElementById("stats").innerHTML = `<div style="color:#ffb4b4;">⚠︎ Backend error ${res.status}.</div>`;
    return;
  }
  try {
    data = JSON.parse(raw);
  } catch (e2) {
    console.error("JSON parse error (/fire):", raw);
    document.getElementById("stats").innerHTML = `<div style="color:#ffb4b4;">⚠︎ Unexpected response.</div>`;
    return;
  }

  renderChart(data);
  renderStats(data);
}

function renderChart(data) {
  const ctx = document.getElementById("chart").getContext("2d");
  if (chart) chart.destroy();

  // Determine retirement split for a vertical marker
  const rStart = data.summary?.retirement_start_index ?? null;

  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: data.labels, // ISO dates
      datasets: [
        { label:"P10", data: data.percentiles.p10, borderWidth:1, tension:0.2, pointRadius:0, fill:false },
        { label:"Median", data: data.percentiles.p50, borderWidth:2, tension:0.2, pointRadius:0, fill:false },
        { label:"P90", data: data.percentiles.p90, borderWidth:1, tension:0.2, pointRadius:0, fill:false }
      ]
    },
    options: {
      responsive: true,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtUSD(c.parsed.y)}` } }
      },
      scales: {
        x: { type:"time", time:{ unit:"year" }, title:{ display:true, text:"Date" } },
        y: { title:{ display:true, text:"Portfolio value ($)" },
             ticks:{ callback: (v)=>fmtUSD(v) } }
      }
    },
    plugins: [revealPlugin, retirementMarkerPlugin(rStart)]
  });

  // reveal
  chart.$reveal = 0;
  const DUR = 1200, t0 = performance.now();
  const step = (ts) => {
    const p = Math.min(1, (ts - t0) / DUR);
    chart.$reveal = p; chart.draw();
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(() => requestAnimationFrame(step));
}

// draws a vertical marker at the retirement start index
function retirementMarkerPlugin(index) {
  return {
    id: "retirementMarker",
    afterDraw(chart) {
      if (index == null) return;
      const labels = chart.data.labels;
      if (!labels || index < 0 || index >= labels.length) return;
      const xScale = chart.scales.x;
      const area = chart.chartArea;
      const x = xScale.getPixelForValue(labels[index]);
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,.35)";
      ctx.lineWidth = 1;
      ctx.setLineDash([6,4]);
      ctx.beginPath();
      ctx.moveTo(x, area.top);
      ctx.lineTo(x, area.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#e5e7eb";
      ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
      ctx.fillText("Retirement", Math.min(Math.max(x + 6, area.left + 6), area.right - 80), area.top + 14);
      ctx.restore();
    }
  };
}

function renderStats(data) {
  const s = data.summary || {};
  const months = s.median_lasting_months ?? 0;
  const years = (months / 12).toFixed(1);
  const prob = s.prob_nonzero_end != null ? (s.prob_nonzero_end * 100).toFixed(1) + "%" : "–";

  const html = `
    <h3>Summary</h3>
    <ul>
      <li>Median terminal wealth: ${fmtUSD(s.median_terminal || 0)}</li>
      <li>Probability portfolio > $0 at end: ${prob}</li>
      <li>Median time money lasts in retirement: ${months} months (~${years} years)</li>
    </ul>
  `;
  document.getElementById("stats").innerHTML = html;
}
