// radar chart SVG for an uncle rate result
export function radarSvg(ticker, rate) {
  const W = 560, H = 560, cx = W / 2, cy = H / 2 + 10, R = 190;
  const n = rate.dims.length;
  const angle = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i, r) => `${(cx + Math.cos(angle(i)) * r).toFixed(1)},${(cy + Math.sin(angle(i)) * r).toFixed(1)}`;

  const rings = [25, 50, 75, 100].map((v) =>
    `<polygon points="${rate.dims.map((_, i) => pt(i, (v / 100) * R)).join(' ')}" fill="none" stroke="#21262d"/>`
  ).join('');
  const axes = rate.dims.map((_, i) => `<line x1="${cx}" y1="${cy}" x2="${pt(i, R).split(',')[0]}" y2="${pt(i, R).split(',')[1]}" stroke="#21262d"/>`).join('');
  const shape = rate.dims.map((d, i) => pt(i, (d.score / 100) * R)).join(' ');
  const hot = rate.composite >= 60;
  const col = hot ? '#ff5d5d' : '#58a6ff';
  const labels = rate.dims.map((d, i) => {
    const [x, y] = pt(i, R + 26).split(',').map(Number);
    const anchor = Math.abs(Math.cos(angle(i))) < 0.3 ? 'middle' : Math.cos(angle(i)) > 0 ? 'start' : 'end';
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="#8b949e" font-size="13">${d.label}</text>
<text x="${x}" y="${y + 15}" text-anchor="${anchor}" fill="${col}" font-size="13" font-weight="bold">${d.score}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="ui-monospace,Menlo,monospace">
<rect width="${W}" height="${H}" fill="#0d1117"/>
<text x="${W / 2}" y="34" text-anchor="middle" fill="#e6edf3" font-size="20" font-weight="bold">🐀 $${ticker} · uncle rate ${rate.composite}</text>
${rings}${axes}
<polygon points="${shape}" fill="${col}" fill-opacity="0.25" stroke="${col}" stroke-width="2"/>
${labels}
</svg>`;
}
