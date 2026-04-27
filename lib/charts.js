// Tiny chart helpers — return self-contained SVG strings (no external libs,
// no <script>). Used by lib/report-html.js to embed visualisations in the
// downloadable weekly report.

function escapeText(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const PALETTE = ["#2563eb", "#16a34a", "#d97706", "#9333ea", "#dc2626", "#0891b2", "#65a30d", "#c2410c"];

// Counter card. Plain HTML, not SVG — meant to sit inline inside a flex row.
export function counter({ label, value, footnote = "" }) {
  return `
    <div class="counter">
      <div class="counter-value">${escapeText(value)}</div>
      <div class="counter-label">${escapeText(label)}</div>
      ${footnote ? `<div class="counter-footnote">${escapeText(footnote)}</div>` : ""}
    </div>`;
}

// Horizontal bar chart. items = [{ label, value, color? }]
export function bar(items, { width = 520, rowHeight = 28, gap = 6, valueSuffix = "" } = {}) {
  if (!items.length) return "<div class='empty-chart'>no data</div>";
  const max = Math.max(1, ...items.map((i) => i.value || 0));
  const labelCol = 180;
  const barCol = width - labelCol - 60;
  const height = items.length * (rowHeight + gap) + gap;
  const rows = items.map((item, i) => {
    const y = gap + i * (rowHeight + gap);
    const w = Math.max(2, ((item.value || 0) / max) * barCol);
    const color = item.color || PALETTE[i % PALETTE.length];
    return `
      <g transform="translate(0,${y})">
        <text x="${labelCol - 8}" y="${rowHeight / 2 + 4}" text-anchor="end"
              font-size="12" fill="#1f2328">${escapeText(item.label)}</text>
        <rect x="${labelCol}" y="3" width="${w}" height="${rowHeight - 6}"
              rx="3" fill="${color}" />
        <text x="${labelCol + w + 6}" y="${rowHeight / 2 + 4}" font-size="12" fill="#4b5563">${escapeText(item.value)}${escapeText(valueSuffix)}</text>
      </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img">${rows}</svg>`;
}

// Pie chart. slices = [{ label, value, color? }]
export function pie(slices, { size = 220 } = {}) {
  const total = slices.reduce((s, x) => s + (x.value || 0), 0);
  if (!total) return "<div class='empty-chart'>no data</div>";
  const cx = size / 2, cy = size / 2, r = size / 2 - 4;
  let angle = -Math.PI / 2;
  const arcs = slices.map((sl, i) => {
    const fraction = (sl.value || 0) / total;
    if (fraction <= 0) return "";
    const a2 = angle + fraction * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(a2);
    const y2 = cy + r * Math.sin(a2);
    const large = fraction > 0.5 ? 1 : 0;
    const color = sl.color || PALETTE[i % PALETTE.length];
    let path;
    if (fraction >= 0.999) {
      path = `M ${cx - r},${cy} A ${r},${r} 0 1 1 ${cx + r},${cy} A ${r},${r} 0 1 1 ${cx - r},${cy} Z`;
    } else {
      path = `M ${cx},${cy} L ${x1},${y1} A ${r},${r} 0 ${large} 1 ${x2},${y2} Z`;
    }
    angle = a2;
    return `<path d="${path}" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;
  }).join("");
  const legend = slices.map((sl, i) => {
    const color = sl.color || PALETTE[i % PALETTE.length];
    const pct = total > 0 ? Math.round(((sl.value || 0) / total) * 100) : 0;
    return `<div class="legend-row"><span class="legend-swatch" style="background:${color}"></span>${escapeText(sl.label)} <span class="legend-num">${escapeText(sl.value)} (${pct}%)</span></div>`;
  }).join("");
  return `
    <div class="pie-wrap">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img">${arcs}</svg>
      <div class="legend">${legend}</div>
    </div>`;
}

// Line chart from a list of points. data = [{ x: "label", y: number }]
export function line(data, { width = 520, height = 180, valuePrefix = "" } = {}) {
  if (!data.length) return "<div class='empty-chart'>no data</div>";
  const padL = 36, padR = 12, padT = 12, padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const max = Math.max(1, ...data.map((d) => d.y || 0));
  const min = Math.min(0, ...data.map((d) => d.y || 0));
  const span = Math.max(1, max - min);
  const pts = data.map((d, i) => {
    const x = padL + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
    const y = padT + innerH - ((d.y - min) / span) * innerH;
    return { x, y, label: d.x, value: d.y };
  });
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const dots = pts.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="#2563eb" />`).join("");
  const xLabels = pts.map((p) => `<text x="${p.x.toFixed(1)}" y="${height - 8}" font-size="10" fill="#6b7280" text-anchor="middle">${escapeText(p.label)}</text>`).join("");
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img">
      <line x1="${padL}" y1="${padT + innerH}" x2="${width - padR}" y2="${padT + innerH}" stroke="#e5e7eb" />
      <text x="6" y="${padT + 8}" font-size="10" fill="#6b7280">${escapeText(valuePrefix + max)}</text>
      <text x="6" y="${padT + innerH}" font-size="10" fill="#6b7280">${escapeText(valuePrefix + min)}</text>
      <path d="${path}" fill="none" stroke="#2563eb" stroke-width="2" />
      ${dots}
      ${xLabels}
    </svg>`;
}

// Stacked horizontal bar (single row) for resolution mix. items = [{label, value, color?}]
export function stackedBar(items, { width = 520, height = 28, valueSuffix = "" } = {}) {
  const total = items.reduce((s, i) => s + (i.value || 0), 0);
  if (!total) return "<div class='empty-chart'>no data</div>";
  let x = 0;
  const segs = items.map((it, i) => {
    const w = ((it.value || 0) / total) * width;
    const color = it.color || PALETTE[i % PALETTE.length];
    const seg = `<rect x="${x}" y="0" width="${w}" height="${height}" fill="${color}" />`;
    x += w;
    return seg;
  }).join("");
  const legend = items.map((it, i) => {
    const color = it.color || PALETTE[i % PALETTE.length];
    return `<span class="legend-inline"><span class="legend-swatch" style="background:${color}"></span>${escapeText(it.label)}: ${escapeText(it.value)}${escapeText(valueSuffix)}</span>`;
  }).join(" · ");
  return `
    <div class="stacked-wrap">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img">${segs}</svg>
      <div class="legend-line">${legend}</div>
    </div>`;
}

export const _internal = { escapeText, PALETTE };
