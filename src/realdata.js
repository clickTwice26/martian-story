import * as THREE from 'three';
import { loadPNG16 } from './png16.js';
import { OUTPUT_PARS, assertShaderContract } from './shaderlib.js';

/**
 * The free, no-login NASA / USGS datasets layered on top of the HiRISE DTM.
 * Each loader is optional: if a file is missing the game runs as before.
 *
 *   jezero_albedo*.jpg   HiRISE orthomosaic brightness, slope shading removed
 *   jezero_minerals.png  MRO CRISM spectral indicators (olivine, carbonate, hydrated)
 *   jezero_far.*         JPL CTX DEM + MOLA: the rest of the crater and its rim
 *   meda_climate.json    Perseverance MEDA weather station, hourly by season
 *   m20_media.json       real Mastcam-Z / Navcam frames and RIMFAX radargrams
 *
 * The tools that bake them live in tools/ (extract_ortho, extract_crism,
 * extract_horizon, build_meda, index_media).
 */

const R_MARS = 3396190;

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function image(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
  return img;
}

/** 8-bit data image -> single-channel GPU texture (a quarter the memory of RGBA). */
function redTexture(img, mipmaps = true) {
  const t = new THREE.Texture(img);
  t.format = THREE.RedFormat;
  t.internalFormat = 'R8';
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = mipmaps;
  t.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

function pixels(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, img.width, img.height).data;
}

/* ------------------------------------------------------------------ surface */

/**
 * HiRISE albedo and CRISM minerals, wired into the terrain shader.
 * Returns a CPU-side mineral lookup for gameplay.
 */
export async function loadSurfaceData(terrain, baseMeta) {
  const u = terrain.material.uniforms;
  const out = { albedo: false, minerals: null };
  try {
    const [img, near, nearMeta] = await Promise.all([
      image('data/jezero_albedo.jpg'),
      image('data/jezero_albedo_near.jpg'),
      json('data/jezero_albedo_near.json'),
    ]);
    u.uAlbedo.value = redTexture(img);
    u.uAlbedoNear.value = redTexture(near);
    const mpp = baseMeta.metresPerPixel;
    u.uNearRect.value.set(
      (nearMeta.projected.xLeft - baseMeta.projected.xLeft) / mpp,
      (baseMeta.projected.yTop - nearMeta.projected.yTop) / mpp,
      nearMeta.widthMetres / mpp, 0);
    u.uAlbedoOn.value = 1;
    out.albedo = true;
  } catch (e) { console.warn('[realdata] HiRISE albedo unavailable:', e.message); }

  try {
    const [img, meta] = await Promise.all([image('data/jezero_minerals.png'), json('data/jezero_minerals.json')]);
    const t = new THREE.Texture(img);
    t.colorSpace = THREE.NoColorSpace;
    t.generateMipmaps = false;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.flipY = false;
    t.premultiplyAlpha = false;
    t.needsUpdate = true;
    u.uMinerals.value = t;
    u.uMineralSize.value.set(img.width, img.height);
    out.minerals = new MineralMap(pixels(img), img.width, img.height, meta, baseMeta);
  } catch (e) { console.warn('[realdata] CRISM minerals unavailable:', e.message); }
  return out;
}

export class MineralMap {
  constructor(px, w, h, meta, baseMeta) {
    this.px = px; this.w = w; this.h = h; this.meta = meta;
    this.scale = meta.metresPerPixel / baseMeta.metresPerPixel;   // base texels per mineral texel
  }
  /** Indicators 0..1 at a world position, or null outside CRISM coverage. */
  at(hf, x, z) {
    const [c, r] = hf.worldToTexel(x, z);
    const i = Math.floor((c + 0.5) / this.scale), j = Math.floor((r + 0.5) / this.scale);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return null;
    const k = (j * this.w + i) * 4;
    if (this.px[k + 3] < 128) return null;
    return { olivine: this.px[k] / 255, carbonate: this.px[k + 1] / 255, hydrated: this.px[k + 2] / 255 };
  }
  /** Plain-language reading of the strongest indicator. */
  describe(m) {
    if (!m) return 'No CRISM coverage here';
    // enrichment relative to this tile (same thresholds as the shader overlay)
    const ramp = (v, a, b) => Math.max(0, Math.min(1, (v - a) / (b - a)));
    const top = [['olivine', ramp(m.olivine, 0.42, 0.58)], ['Mg carbonate', ramp(m.carbonate, 0.08, 0.35)],
                 ['hydrated minerals', ramp(m.hydrated, 0.16, 0.42)]].sort((a, b) => b[1] - a[1]);
    const [name, v] = top[0];
    if (v < 0.2) return m.olivine > 0.3 ? 'Olivine-bearing basaltic floor' : 'Dusty regolith, weak spectral signal';
    return `${v > 0.6 ? 'Strong' : 'Moderate'} ${name} signature`;
  }
}

/* -------------------------------------------------------------- far terrain */

const FAR_VERT = /* glsl */`
uniform vec3  uCamPos;
uniform float uCurvature;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
void main() {
  vec3 wp = position;
  float dx = wp.x - uCamPos.x, dz = wp.z - uCamPos.z;
  wp.y -= (dx * dx + dz * dz) * uCurvature;
  vWorld = position;
  vNormal = normal;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FAR_FRAG = /* glsl */`
${OUTPUT_PARS}
uniform sampler2D uFarAlbedo;
uniform vec4  uHole;            // world rect of the HiRISE tile: minX, minZ, maxX, maxZ
uniform vec3  uSunDir, uSunColor, uSkyColor, uGroundColor, uCamPos, uFogColor;
uniform float uFogDensity;
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
void main() {
  if (vWorld.x > uHole.x && vWorld.x < uHole.z && vWorld.z > uHole.y && vWorld.z < uHole.w) discard;
  vec3 N = normalize(vNormal);
  float a = texture(uFarAlbedo, vUv).r;
  float real = smoothstep(0.012, 0.024, a);
  float rel = mix(1.0, clamp(a * (255.0 / 128.0), 0.35, 2.2), real);
  float slopeT = smoothstep(0.12, 0.55, 1.0 - N.y);
  vec3 albedo = mix(vec3(0.225, 0.108, 0.052), vec3(0.118, 0.056, 0.033), slopeT) * rel;
  float ndl = max(dot(N, normalize(uSunDir)), 0.0);
  vec3 hemi = mix(uGroundColor, uSkyColor, N.y * 0.5 + 0.5);
  vec3 col = albedo * (uSunColor * ndl * 2.10 + hemi * 0.62);
  float dist = length(uCamPos - vWorld);
  float fog = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
  mx_writeOutput(col);
}`;
assertShaderContract(FAR_FRAG, 'far terrain');

/**
 * The crater beyond the HiRISE tile: CTX DEM (20 m) with MOLA filling the
 * west, as one static mesh. It skips the tile itself, which the CDLOD terrain
 * draws, and shares that terrain's sun, sky and haze uniforms.
 */
export async function loadFarSource() {
  const [meta, height] = await Promise.all([json('data/jezero_far.json'), loadPNG16('data/jezero_far.png')]);
  return { meta, height };
}

/** Elevation of the far grid (CTX 20 m / MOLA) at projected metres, bilinear. */
function farElevation(src, X, Y) {
  const { meta, height } = src;
  const fc = (X - meta.projected.xLeft) / meta.metresPerPixel - 0.5;
  const fr = (meta.projected.yTop - Y) / meta.metresPerPixel - 0.5;
  const c0 = Math.max(0, Math.min(meta.width - 2, Math.floor(fc)));
  const r0 = Math.max(0, Math.min(meta.height - 2, Math.floor(fr)));
  const tx = Math.min(1, Math.max(0, fc - c0)), ty = Math.min(1, Math.max(0, fr - r0));
  const d = height.data, w = meta.width, k = r0 * w + c0;
  const v = (d[k] * (1 - tx) + d[k + 1] * tx) * (1 - ty) + (d[k + w] * (1 - tx) + d[k + w + 1] * tx) * ty;
  return meta.elevMin + v * (meta.elevMax - meta.elevMin) / 65535;
}

/**
 * Replace the HiRISE tile's gap-filled texels (no stereo coverage; filled by
 * smearing the nearest value) with measured CTX stereo elevations, blended in
 * across the mask edge. Runs before the terrain is built, so the CPU collision
 * surface and the GPU heightfield texture still read the same array.
 * Returns the number of texels changed.
 */
export function fillGapsFromFar(hf, mask, baseMeta, src) {
  const mpp = hf.mpp, span = hf.elevSpan, W = hf.width, H = hf.height;
  const sc = mask.width / W;                       // mask texels per base texel
  const m = mask.arr, mw = mask.width, mh = mask.height;
  const maskAt = (c, r) => {                        // bilinear 0..1, 1 = measured
    const x = c * sc - 0.5, y = r * sc - 0.5;
    const x0 = Math.max(0, Math.min(mw - 2, Math.floor(x))), y0 = Math.max(0, Math.min(mh - 2, Math.floor(y)));
    const tx = Math.min(1, Math.max(0, x - x0)), ty = Math.min(1, Math.max(0, y - y0));
    const k = y0 * mw + x0;
    return ((m[k] * (1 - tx) + m[k + 1] * tx) * (1 - ty) + (m[k + mw] * (1 - tx) + m[k + mw + 1] * tx) * ty) / 255;
  };
  // the CTX and HiRISE products share the MOLA datum, but match the local
  // level along the mask edge anyway so the patch cannot leave a step
  let off = 0, n = 0;
  for (let r = 0; r < H; r += 8) for (let c = 0; c < W; c += 8) {
    const a = maskAt(c, r);
    if (a > 0.97 && a < 0.999 || (a > 0.4 && a < 0.6)) {
      const z = hf.elevMin + hf.data[r * W + c] * span;
      off += z - farElevation(src, baseMeta.projected.xLeft + c * mpp, baseMeta.projected.yTop - r * mpp); n++;
    }
  }
  off = n ? off / n : 0;
  let changed = 0;
  for (let r = 0; r < H; r++) {
    const Y = baseMeta.projected.yTop - r * mpp;
    for (let c = 0; c < W; c++) {
      const a = maskAt(c, r);
      if (a >= 0.999) continue;
      const w = 1 - Math.min(1, a * 1.6);           // fully CTX once well inside the gap
      if (w <= 0) continue;
      const i = r * W + c;
      const z0 = hf.elevMin + hf.data[i] * span;
      const zf = farElevation(src, baseMeta.projected.xLeft + c * mpp, Y) + off;
      const z = z0 + (zf - z0) * w;
      hf.data[i] = Math.max(0, Math.min(65535, Math.round((z - hf.elevMin) / span)));
      changed++;
    }
  }
  return { changed, datumOffset: off };
}

export async function loadFarTerrain(terrain, hf, baseMeta, src, segments = 400) {
  const [{ meta, height }, alb] = await Promise.all([
    src || loadFarSource(), image('data/jezero_far_albedo.jpg'),
  ]);
  const mpp = baseMeta.metresPerPixel;
  // world = projected - (tile origin + anchor offset); z grows southward
  const ox = baseMeta.projected.xLeft + hf.anchorCol * mpp;
  const oz = baseMeta.projected.yTop - hf.anchorRow * mpp;
  const span = (meta.elevMax - meta.elevMin) / 65535;
  const n = segments + 1;
  const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
  const H = (c, r) => {
    c = Math.min(meta.width - 1, Math.max(0, c)); r = Math.min(meta.height - 1, Math.max(0, r));
    return meta.elevMin + height.data[r * meta.width + c] * span;
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const fc = i / segments * (meta.width - 1), fr = j / segments * (meta.height - 1);
      const c0 = Math.floor(fc), r0 = Math.floor(fr), tx = fc - c0, ty = fr - r0;
      const h = (H(c0, r0) * (1 - tx) + H(c0 + 1, r0) * tx) * (1 - ty) + (H(c0, r0 + 1) * (1 - tx) + H(c0 + 1, r0 + 1) * tx) * ty;
      const k = j * n + i;
      pos[k * 3] = meta.projected.xLeft + (fc + 0.5) * meta.metresPerPixel - ox;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = oz - (meta.projected.yTop - (fr + 0.5) * meta.metresPerPixel);
      uv[k * 2] = i / segments; uv[k * 2 + 1] = j / segments;
    }
  }
  const idx = new Uint32Array(segments * segments * 6);
  let p = 0;
  for (let j = 0; j < segments; j++) for (let i = 0; i < segments; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const tu = terrain.material.uniforms;
  const inset = 6;   // let the tile's skirts hide the seam
  const mat = new THREE.ShaderMaterial({
    vertexShader: FAR_VERT, fragmentShader: FAR_FRAG, glslVersion: THREE.GLSL3,
    uniforms: {
      uFarAlbedo: { value: redTexture(alb) },
      uHole: { value: new THREE.Vector4(hf.minX + inset, hf.minZ + inset, hf.maxX - inset, hf.maxZ - inset) },
      uSunDir: tu.uSunDir, uSunColor: tu.uSunColor, uSkyColor: tu.uSkyColor, uGroundColor: tu.uGroundColor,
      uCamPos: tu.uCamPos, uFogColor: tu.uFogColor, uFogDensity: tu.uFogDensity,
      uCurvature: tu.uCurvature, uExposure: tu.uExposure,
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.name = 'farTerrain';
  mesh.userData.meta = meta;
  return mesh;
}

/* ------------------------------------------------------------------ weather */

/**
 * Perseverance's own weather station at Jezero, as a season x hour table.
 * sample(ls, lmstHours) interpolates between seasons and hours.
 */
export class MarsWeather {
  constructor(d) {
    this.d = d;
    this.bins = 360 / d.lsBinDeg;
  }
  static async load() { return new MarsWeather(await json('data/meda_climate.json')); }

  _grid(field, ls, hour) {
    const g = this.d[field];
    const bf = ((ls % 360) + 360) % 360 / this.d.lsBinDeg - 0.5;
    const b0 = Math.floor(bf), tb = bf - b0;
    const hf = ((hour % 24) + 24) % 24 - 0.5;
    const h0 = Math.floor(hf), th = hf - h0;
    const at = (b, h) => g[((b % this.bins) + this.bins) % this.bins][((h % 24) + 24) % 24];
    const lerp = (a, b, t) => (a == null ? b : b == null ? a : a + (b - a) * t);
    return lerp(lerp(at(b0, h0), at(b0, h0 + 1), th), lerp(at(b0 + 1, h0), at(b0 + 1, h0 + 1), th), tb);
  }
  sample(ls, hour) {
    const dir = this._grid('windDir', ls, Math.round(hour - 0.5) + 0.5);   // circular: no blending
    return {
      pressure: this._grid('pressure', ls, hour),       // Pa
      airT: this._grid('airT', ls, hour),               // K
      groundT: this._grid('groundT', ls, hour),         // K
      wind: this._grid('wind', ls, hour),               // m/s
      windDir: dir,
    };
  }
  /** What MEDA logged on the sampled sol nearest `sol`. */
  daily(sol) {
    let best = null;
    for (const r of this.d.daily) if (!best || Math.abs(r.sol - sol) < Math.abs(best.sol - sol)) best = r;
    return best;
  }
}

/* -------------------------------------------------------------------- media */

/** Real rover photos and RIMFAX radargrams, looked up by where you stand. */
export class RoverMedia {
  constructor(d, projector) {
    this.d = d;
    this.photos = d.photos.map(p => ({ ...p, w: projector.lonLatToWorld(p.lon, p.lat) }));
    this.radar = d.rimfax.map(r => {
      const a = projector.lonLatToWorld(r.lonMin, r.latMax), b = projector.lonLatToWorld(r.lonMax, r.latMin);
      return { ...r, x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), z0: Math.min(a[1], b[1]), z1: Math.max(a[1], b[1]) };
    });
  }
  static async load(projector) { return new RoverMedia(await json('data/m20_media.json'), projector); }

  nearestPhoto(x, z, maxDist = 60) {
    let best = null, bd = maxDist * maxDist;
    for (const p of this.photos) {
      const d = (p.w[0] - x) ** 2 + (p.w[1] - z) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best ? { ...best, dist: Math.sqrt(bd) } : null;
  }
  /** Radargram whose sounding box (padded) contains the point, nearest first. */
  radarAt(x, z, pad = 12) {
    let best = null, bd = Infinity;
    for (const r of this.radar) {
      if (x < r.x0 - pad || x > r.x1 + pad || z < r.z0 - pad || z > r.z1 + pad) continue;
      const d = Math.hypot(x - (r.x0 + r.x1) / 2, z - (r.z0 + r.z1) / 2);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }
}

export const K_TO_C = k => k - 273.15;
export { R_MARS };
