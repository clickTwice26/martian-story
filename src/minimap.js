/**
 * North-up minimap drawn from the real HiRISE ground image (jezero_albedo.jpg)
 * with the rover traverse, the player, the support unit, Perseverance, the
 * wreck and the current objective. Redrawn at ~12 Hz; click cycles zoom.
 */
const ZOOMS = [120, 300, 800, 2200];       // radius in metres

export class Minimap {
  constructor(canvas, { hf, projector, traverse, albedo }) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.hf = hf;
    this.albedo = albedo || null;           // HTMLImageElement on the heightfield grid, or null
    this.zoom = 1;
    this.t = 0;
    this.markers = [];
    this.track = (traverse?.features || []).map(f =>
      f.geometry.coordinates.map(([lon, lat]) => projector.lonLatToWorld(lon, lat)));
    canvas.addEventListener('click', () => { this.zoom = (this.zoom + 1) % ZOOMS.length; this.t = 0; });
    canvas.title = 'Click to zoom';
    this._fit();
    addEventListener('resize', () => this._fit());
  }

  _fit() {
    const css = this.c.clientWidth || 190;
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.c.width = this.c.height = Math.round(css * dpr);
    this.t = 0;
  }

  get radius() { return ZOOMS[this.zoom]; }

  /**
   * @param s { x, z, fx, fz } player position and forward vector
   * @param markers [{ x, z, kind: 'k7'|'rover'|'wreck'|'goal' }]
   */
  update(dt, s, markers) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 1 / 12;
    const { g, c } = this, W = c.width, R = this.radius, k = W / 2 / R;   // px per metre
    const toPx = (x, z) => [W / 2 + (x - s.x) * k, W / 2 + (z - s.z) * k];
    g.save();
    g.clearRect(0, 0, W, W);
    g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 1, 0, Math.PI * 2); g.clip();

    // ground
    g.fillStyle = '#3a2216'; g.fillRect(0, 0, W, W);
    if (this.albedo) {
      const mpp = this.hf.mpp;
      const [c0, r0] = this.hf.worldToTexel(s.x - R, s.z - R);
      const span = 2 * R / mpp;
      g.imageSmoothingEnabled = true;
      g.globalAlpha = 0.95;
      g.drawImage(this.albedo, c0, r0, span, span, 0, 0, W, W);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = '#e8a46e'; g.fillRect(0, 0, W, W);
      g.globalCompositeOperation = 'source-over';
    }
    // edge of the measured tile
    const [ex0, ez0] = toPx(this.hf.minX, this.hf.minZ), [ex1, ez1] = toPx(this.hf.maxX, this.hf.maxZ);
    g.strokeStyle = 'rgba(255,255,255,.25)'; g.setLineDash([4, 4]); g.lineWidth = 1;
    g.strokeRect(ex0, ez0, ex1 - ex0, ez1 - ez0); g.setLineDash([]);

    // rover traverse
    g.strokeStyle = 'rgba(56,189,248,.85)'; g.lineWidth = Math.max(1.5, W / 120);
    g.lineJoin = g.lineCap = 'round';
    g.beginPath();
    for (const line of this.track) {
      for (let i = 0; i < line.length; i++) {
        const [px, py] = toPx(line[i][0], line[i][1]);
        if (i) g.lineTo(px, py); else g.moveTo(px, py);
      }
    }
    g.stroke();

    // markers
    const u = W / 190;
    for (const m of markers) {
      let [px, py] = toPx(m.x, m.z);
      const dx = px - W / 2, dy = py - W / 2, d = Math.hypot(dx, dy), lim = W / 2 - 9 * u;
      const off = d > lim;
      if (off) { if (m.kind !== 'goal' && m.kind !== 'rover') continue; px = W / 2 + dx / d * lim; py = W / 2 + dy / d * lim; }
      drawMarker(g, m.kind, px, py, u, off);
    }

    // player: heading cone + arrow
    const a = Math.atan2(s.fz, s.fx);
    const grd = g.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, 46 * u);
    grd.addColorStop(0, 'rgba(255,255,255,.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath(); g.moveTo(W / 2, W / 2); g.arc(W / 2, W / 2, 46 * u, a - 0.5, a + 0.5); g.closePath(); g.fill();
    g.translate(W / 2, W / 2); g.rotate(a);
    g.fillStyle = '#ffffff'; g.strokeStyle = '#0f172a'; g.lineWidth = 2 * u;
    g.beginPath(); g.moveTo(9 * u, 0); g.lineTo(-6 * u, 6 * u); g.lineTo(-3 * u, 0); g.lineTo(-6 * u, -6 * u); g.closePath();
    g.stroke(); g.fill();
    g.restore();

    // rim: north tick and scale
    g.save();
    g.strokeStyle = 'rgba(56,189,248,.55)'; g.lineWidth = 2;
    g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 1.5, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#fb923c'; g.font = `700 ${11 * u}px Orbitron, sans-serif`; g.textAlign = 'center';
    g.fillText('N', W / 2, 13 * u);
    const bar = niceLen(R * 0.45), bw = bar * k;
    g.fillStyle = 'rgba(2,6,12,.6)'; g.fillRect(W / 2 - bw / 2 - 6 * u, W - 26 * u, bw + 12 * u, 16 * u);
    g.strokeStyle = '#fff'; g.lineWidth = 1.5 * u;
    g.beginPath(); g.moveTo(W / 2 - bw / 2, W - 14 * u); g.lineTo(W / 2 + bw / 2, W - 14 * u); g.stroke();
    g.fillStyle = '#fff'; g.font = `600 ${8.5 * u}px "Share Tech Mono", monospace`;
    g.fillText(bar >= 1000 ? `${bar / 1000} km` : `${bar} m`, W / 2, W - 16.5 * u);
    g.restore();
  }
}

function niceLen(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 5, 10].map(x => x * p).filter(x => x <= v).pop() || p;
}

function drawMarker(g, kind, x, y, u, off) {
  g.save();
  g.translate(x, y);
  const col = { k7: '#a78bfa', rover: '#38bdf8', wreck: '#f87171', goal: '#fbbf24', base: '#34d399' }[kind] || '#fff';
  g.fillStyle = col; g.strokeStyle = '#0b0f17'; g.lineWidth = 1.6 * u;
  if (kind === 'goal') {
    const r = (off ? 5 : 6.5) * u;
    g.beginPath(); g.moveTo(0, -r); g.lineTo(r, 0); g.lineTo(0, r); g.lineTo(-r, 0); g.closePath();
    g.stroke(); g.fill();
    if (!off) { g.strokeStyle = col; g.lineWidth = 1.2 * u; g.beginPath(); g.arc(0, 0, r + 4 * u, 0, Math.PI * 2); g.stroke(); }
  } else if (kind === 'rover') {
    g.beginPath(); g.roundRect(-5 * u, -4 * u, 10 * u, 8 * u, 2 * u); g.stroke(); g.fill();
  } else if (kind === 'wreck') {
    g.lineWidth = 2.6 * u; g.strokeStyle = '#0b0f17';
    g.beginPath(); g.moveTo(-5 * u, -5 * u); g.lineTo(5 * u, 5 * u); g.moveTo(5 * u, -5 * u); g.lineTo(-5 * u, 5 * u); g.stroke();
    g.lineWidth = 1.6 * u; g.strokeStyle = col; g.stroke();
  } else {
    g.beginPath(); g.arc(0, 0, 4 * u, 0, Math.PI * 2); g.stroke(); g.fill();
  }
  g.restore();
}
