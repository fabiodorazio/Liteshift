// Draw "Mean: $X.X" at the last x after the reveal animation finishes
const finalLabelPlugin = {
  id: "finalLabel",
  afterDatasetsDraw(chart) {
    try {
      if (!chart || chart.$revealProgress < 1) return;                   // only after animation
      const expected = chart.$expectedFinal;
      if (typeof expected !== "number" || isNaN(expected)) return;

      const labels = chart.data.labels;
      if (!labels || labels.length === 0) return;

      const xScale = chart.scales.x;
      const yScale = chart.scales.y;
      if (!xScale || !yScale) return;

      // Last x and the mean final y
      const lastLabel = labels[labels.length - 1];
      let x = xScale.getPixelForValue(lastLabel);
      let y = yScale.getPixelForValue(expected);

      // If mean is off the chart, clamp inside the area slightly
      const area = chart.chartArea;
      if (!area) return;
      x = Math.min(Math.max(x, area.left), area.right);
      y = Math.min(Math.max(y, area.top + 8), area.bottom - 8);

      const ctx = chart.ctx;
      const text = `Mean: $${Number(expected).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;

      // Draw a soft tag (rounded rect) behind the text
      ctx.save();
      ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
      const padX = 8, padY = 5;
      const textW = ctx.measureText(text).width;
      const boxW = textW + padX * 2;
      const boxH = 22;
      const rx = 8;

      let boxX = x - boxW - 12; // box to the left of the last point
      let boxY = y - boxH / 2;

      // keep box inside chart area
      if (boxX < area.left + 6) boxX = Math.min(x + 12, area.right - boxW - 6);
      if (boxY < area.top + 6) boxY = area.top + 6;
      if (boxY + boxH > area.bottom - 6) boxY = area.bottom - boxH - 6;

      // rounded rect
      ctx.beginPath();
      ctx.moveTo(boxX + rx, boxY);
      ctx.lineTo(boxX + boxW - rx, boxY);
      ctx.quadraticCurveTo(boxX + boxW, boxY, boxX + boxW, boxY + rx);
      ctx.lineTo(boxX + boxW, boxY + boxH - rx);
      ctx.quadraticCurveTo(boxX + boxW, boxY + boxH, boxX + boxW - rx, boxY + boxH);
      ctx.lineTo(boxX + rx, boxY + boxH);
      ctx.quadraticCurveTo(boxX, boxY + boxH, boxX, boxY + boxH - rx);
      ctx.lineTo(boxX, boxY + rx);
      ctx.quadraticCurveTo(boxX, boxY, boxX + rx, boxY);
      ctx.closePath();

      ctx.fillStyle = "rgba(15, 23, 42, 0.9)";       // dark translucent
      ctx.strokeStyle = "rgba(43, 54, 85, 1)";       // subtle border
      ctx.lineWidth = 1;
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.stroke();

      // text
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#f5f7ff";
      ctx.fillText(text, boxX + padX, boxY + boxH/2 + 4);

      ctx.restore();
    } catch (e) {
      console.error("finalLabel plugin error:", e);
    }
  }
};
