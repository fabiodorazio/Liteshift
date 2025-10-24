// POST /drawdown  — simplified GBM drawdown in JS
export const onRequestPost: PagesFunction = async (ctx) => {
  const body = await ctx.request.json();
  const years = body.years ?? 30;
  const freq = body.frequency ?? 12;
  const n = body.n_sims ?? 2000;
  const mu = body.expected_return ?? 0.07;
  const vol = body.volatility ?? 0.18;
  const fee = body.expense_ratio ?? 0.001;
  const T = years * freq;
  const dt = 1 / freq;
  const drift = (mu - fee - 0.5 * vol * vol) * dt;
  const sigma = vol * Math.sqrt(dt);
  
  // simulate normalized prices
  const prices = Array.from({ length: n }, () => {
    const p = new Array(T + 1).fill(1);
    for (let t = 1; t <= T; t++) {
      const z = Math.sqrt(-2*Math.log(Math.random())) * Math.cos(2*Math.PI*Math.random());
      const factor = Math.exp(drift + sigma * z);
      p[t] = p[t-1] * factor;
    }
    return p;
  });
  
  // drawdowns per path
  const dds = prices.map(p => {
    let peak = 1; const out = new Array(T+1).fill(0);
    for (let t = 0; t <= T; t++) { peak = Math.max(peak, p[t]); out[t] = (p[t]-peak)/peak; }
    return out;
  });
  
  // percentile over time
  const col = (k:number) => dds.map(r => r[k]).sort((a,b)=>a-b);
  const pct = (arr:number[], q:number) => arr[Math.floor((arr.length-1)*q)];
  const p10 = [], p50 = [], p90 = [];
  for (let t=0; t<=T; t++) {
    const c = col(t); p10.push(+pct(c,0.10).toFixed(3)); p50.push(+pct(c,0.50).toFixed(3)); p90.push(+pct(c,0.90).toFixed(3));
  }
  
  // summary (median path)
  const medIdx = Math.floor(n/2);
  const medPath = prices.map(p => p[0]); // not ideal; keep it simple for demo
  
  const start = new Date(); const labels = Array.from({length:T+1}, (_,m) => {
    const d = new Date(start); d.setMonth(d.getMonth()+m); return d.toISOString().slice(0,10);
  });
  
  return Response.json({
    labels,
    percentiles: { p10, p50, p90 },
    summary: { median_max_drawdown: Math.min(...p50) }
  });
};
