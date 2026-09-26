import * as THREE from 'three';

/**
 * Sub-DTM surface detail.
 *
 * The HiRISE DTM is 2 m/px, so by Nyquist nothing under ~4 m exists in it: no
 * ripples, no rocks, no pebbles. Those are exactly the objects the eye uses to
 * judge human scale, which is why a correctly-sized 1.85 m astronaut reads as
 * a giant on it. This module synthesises that missing band.
 *
 * The synthesis is DRIVEN by the real data - amplitude follows measured slope
 * and a broad sand mask - so it is an honest interpolation of the surface, not
 * invention layered on top.
 *
 * CRITICAL: the CPU and GPU implementations must agree, or the player walks
 * on a surface that is not the one being drawn. A `fract(sin(x)*43758)` hash
 * cannot do that - it is chaotic, so float32 (GLSL) and float64 (JS) produce
 * entirely different values. The integer hash below is exact in both:
 * Math.imul matches GLSL's uint multiply mod 2^32, and the shifts match.
 */

/* ---------------------------------------------------------------- GLSL ---- */
export const DETAIL_GLSL = /* glsl */`
uniform float uDetailScale;     // 0 disables the whole layer
uniform float uDetailNear;      // full strength inside this radius
uniform float uDetailFar;       // gone beyond it (mesh can no longer carry it)

uint mx_hashU(uvec2 p){
  uint h = p.x * 374761393u + p.y * 668265263u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return h ^ (h >> 16u);
}
float mx_hash(ivec2 p){
  return float(mx_hashU(uvec2(p + 1048576)) & 0xFFFFFFu) / 16777215.0;
}
float mx_vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  ivec2 b = ivec2(i);
  float a00 = mx_hash(b);
  float a10 = mx_hash(b + ivec2(1, 0));
  float a01 = mx_hash(b + ivec2(0, 1));
  float a11 = mx_hash(b + ivec2(1, 1));
  return mix(mix(a00, a10, u.x), mix(a01, a11, u.x), u.y);
}

/**
 * Aeolian ripples plus regolith roughness, in metres.
 * Jezero's transverse aeolian ridges run a few centimetres to tens of
 * centimetres high with a ~2 m wavelength and a dominant orientation, so that
 * is what this reproduces rather than generic fBm lumpiness.
 */
float mx_detailHeight(vec2 w){
  const float WIND = 0.62;                       // prevailing bearing, radians
  vec2 dir = vec2(cos(WIND), sin(WIND));
  float t = dot(w, dir);
  float ripple = sin(t * 2.856) + sin(t * 5.10 + 1.3) * 0.22;   // lambda ~2.2 m
  float sand = smoothstep(0.34, 0.70, mx_vnoise(w * 0.021));
  float rough = (mx_vnoise(w * 1.35) - 0.5)
              + (mx_vnoise(w * 3.10) - 0.5) * 0.45;
  return ripple * 0.055 * sand + rough * 0.050;
}

/** Detail only belongs on ground the mesh can resolve and sand can sit on. */
float mx_detailMask(float slopeRad, float camDist){
  // NB: 'flat' and 'near' are reserved words in GLSL ES 3.0 - and note the
  // quotes: a backtick here would terminate this template literal.
  float flatness = smoothstep(0.42, 0.14, slopeRad);        // off on scarps
  float nearness = 1.0 - smoothstep(uDetailNear, uDetailFar, camDist);
  return flatness * nearness * uDetailScale;
}
`;

/* ------------------------------------------------------------------ JS ---- */
function hashU(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
export function hash2(x, y) {
  return (hashU((x + 1048576) >>> 0, (y + 1048576) >>> 0) & 0xFFFFFF) / 16777215;
}
function vnoise(px, pz) {
  const ix = Math.floor(px), iz = Math.floor(pz);
  const fx = px - ix, fz = pz - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a00 = hash2(ix, iz), a10 = hash2(ix + 1, iz);
  const a01 = hash2(ix, iz + 1), a11 = hash2(ix + 1, iz + 1);
  return (a00 + (a10 - a00) * ux) + ((a01 + (a11 - a01) * ux) - (a00 + (a10 - a00) * ux)) * uz;
}

const WIND = 0.62, WDX = Math.cos(WIND), WDZ = Math.sin(WIND);

/** Mirror of mx_detailHeight. Agrees with the shader to float precision. */
export function detailHeight(x, z) {
  const t = x * WDX + z * WDZ;
  const ripple = Math.sin(t * 2.856) + Math.sin(t * 5.10 + 1.3) * 0.22;
  const n = vnoise(x * 0.021, z * 0.021);
  const sand = n <= 0.34 ? 0 : n >= 0.70 ? 1 : (() => { const s = (n - 0.34) / 0.36; return s * s * (3 - 2 * s); })();
  const rough = (vnoise(x * 1.35, z * 1.35) - 0.5)
              + (vnoise(x * 3.10, z * 3.10) - 0.5) * 0.45;
  return ripple * 0.055 * sand + rough * 0.050;
}

export function detailMask(slopeRad, scale = 1) {
  const s = slopeRad;
  const flat = s >= 0.42 ? 0 : s <= 0.14 ? 1 : (() => { const t = (0.42 - s) / 0.28; return t * t * (3 - 2 * t); })();
  return flat * scale;
}

/* ------------------------------------------------------------- rocks ------ */
/**
 * Scattered float rock, the strongest scale cue available.
 *
 * Placement is deterministic per grid cell, so rocks do not swim or pop as you
 * move, and density follows the measured slope: bare, blocky ground near
 * scarps, far fewer on the sand sheets where ripples dominate instead.
 */
export class RockField {
  constructor(hf, opts = {}) {
    this.hf = hf;
    this.cell = opts.cell ?? 7.0;            // metres
    this.radius = opts.radius ?? 135;
    this.maxRocks = opts.maxRocks ?? 2600;
    // A rock narrower than this fraction of its distance is a pixel or two
    // on screen; it is skipped rather than drawn as a shimmering speck.
    this.minAngular = opts.minAngular ?? 0.0022;
    this.chunkCells = opts.chunkCells ?? 7;  // 49 m chunks, frustum-culled individually
    this.scale = 1;

    this.geometry = this._rockGeometry();
    this.material = new THREE.MeshStandardMaterial({
      color: 0x6e4a35, roughness: 0.94, metalness: 0.0, flatShading: true,
    });
    // `mesh` is a group of per-chunk instanced meshes: one draw call each, but
    // three.js can now drop every chunk outside the view frustum, where a
    // single field-wide mesh always drew all of them.
    this.mesh = new THREE.Group();
    this._chunks = new Map();
    this._pool = [];
    this._chunkCap = Math.ceil(this.chunkCells * this.chunkCells * 18);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._lastCellX = NaN;
    this._lastCellZ = NaN;
    this.count = 0;
  }

  /** One irregular low-poly boulder; variety comes from per-instance scale. */
  _rockGeometry() {
    const g = new THREE.IcosahedronGeometry(0.5, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 0.62 + 0.55 * hash2(Math.round(x * 97), Math.round(y * 89) + Math.round(z * 71));
      p.setXYZ(i, x * n, y * n * 0.78, z * n);
    }
    g.computeVertexNormals();
    return g;
  }

  _chunk(key, kx, kz) {
    let c = this._chunks.get(key);
    if (c) return c;
    let m = this._pool.pop();
    if (!m) {
      m = new THREE.InstancedMesh(this.geometry, this.material, this._chunkCap);
      m.castShadow = true;
      m.receiveShadow = true;
      m.instanceColor = null;
      m.frustumCulled = true;
      m.boundingSphere = new THREE.Sphere();
    }
    const span = this.chunkCells * this.cell;
    const cx = (kx + 0.5) * span, cz = (kz + 0.5) * span;
    // Half-diagonal plus headroom for relief inside the chunk and rock size.
    m.boundingSphere.center.set(cx, this.hf.baseHeightAt(cx, cz), cz);
    m.boundingSphere.radius = span * 0.7072 + 28;
    m.count = 0;
    this.mesh.add(m);
    c = { mesh: m, n: 0 };
    this._chunks.set(key, c);
    return c;
  }

  setScale(v) { this.scale = v; this._lastCellX = NaN; }   // force a rebuild

  update(camX, camZ) {
    const cx = Math.floor(camX / this.cell), cz = Math.floor(camZ / this.cell);
    if (cx === this._lastCellX && cz === this._lastCellZ) return this.count;
    this._lastCellX = cx; this._lastCellZ = cz;

    for (const c of this._chunks.values()) { this.mesh.remove(c.mesh); this._pool.push(c.mesh); }
    this._chunks.clear();

    const R = Math.ceil(this.radius / this.cell);
    const hf = this.hf, K = this.chunkCells;
    let n = 0;

    for (let j = -R; j <= R && n < this.maxRocks; j++) {
      for (let i = -R; i <= R && n < this.maxRocks; i++) {
        if (i * i + j * j > R * R) continue;
        const gx = cx + i, gz = cz + j;
        const h0 = hash2(gx, gz);
        const baseX = (gx + 0.5) * this.cell, baseZ = (gz + 0.5) * this.cell;
        if (baseX < hf.minX || baseX > hf.maxX || baseZ < hf.minZ || baseZ > hf.maxZ) continue;

        // measured slope decides how rocky this patch is
        const slope = hf.baseSlopeAt ? hf.baseSlopeAt(baseX, baseZ) : hf.slopeAt(baseX, baseZ);
        // Jezero's floor is strewn with float rock, not swept clean; density
        // rises toward outcrops rather than starting from nothing.
        const rocky = Math.min(2.2, 0.55 + slope / 14);
        const want = Math.floor(h0 * 4.0 * rocky * this.scale);
        if (!want) continue;
        const kx = Math.floor(gx / K), kz = Math.floor(gz / K);
        let chunk = null;

        for (let k = 0; k < want && n < this.maxRocks; k++) {
          const hx = hash2(gx * 31 + k, gz * 17 - k);
          const hz = hash2(gx * 13 - k, gz * 29 + k);
          const hs = hash2(gx * 7 + k * 101, gz * 5 + k * 57);
          const hr = hash2(gx * 3 - k * 11, gz * 23 + k * 3);

          const x = (gx + hx) * this.cell, z = (gz + hz) * this.cell;
          // log-ish size distribution: mostly cobbles, rare metre boulders
          const size = 0.07 + Math.pow(hs, 3.4) * 1.55;
          // Placement stays deterministic; only what is drawn depends on range.
          if (size < Math.hypot(x - camX, z - camZ) * this.minAngular) continue;
          chunk = chunk || this._chunk(kx * 100003 + kz, kx, kz);
          if (chunk.n >= this._chunkCap) break;
          const y = (hf.baseHeightAt ? hf.baseHeightAt(x, z) : hf.heightAt(x, z)) - size * 0.22;

          this._p.set(x, y, z);
          this._e.set(hr * 0.5 - 0.25, hr * 12.9, hx * 0.5 - 0.25);
          this._q.setFromEuler(this._e);
          this._s.set(size * (0.8 + hz * 0.5), size * (0.62 + hs * 0.5), size * (0.8 + hr * 0.5));
          chunk.mesh.setMatrixAt(chunk.n++, this._m.compose(this._p, this._q, this._s));
          n++;
        }
      }
    }
    for (const c of this._chunks.values()) {
      c.mesh.count = c.n;
      c.mesh.instanceMatrix.needsUpdate = true;
      c.mesh.instanceMatrix.clearUpdateRanges?.();
      c.mesh.instanceMatrix.addUpdateRange(0, c.n * 16);
    }
    this.count = n;
    return n;
  }
}
