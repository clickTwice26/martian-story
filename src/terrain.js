import * as THREE from 'three';
import { OUTPUT_PARS, assertShaderContract } from './shaderlib.js';
import { DETAIL_GLSL } from './detail.js';

/**
 * CDLOD terrain over a real DTM heightfield.
 *
 * A quadtree is selected against camera distance each frame and drawn as ONE
 * instanced draw call: every node shares a single unit grid patch and differs
 * only by (origin, size, morph). The vertex shader samples the elevation
 * texture directly, so no per-node geometry is ever built or uploaded.
 *
 * LOD transitions are morphed rather than switched. Each node blends its grid
 * toward its parent's vertex positions as it approaches the distance where the
 * parent takes over, so the geometry is already identical at the moment of the
 * swap and nothing pops.
 */

/* Segments per patch edge. Every node draws the same patch, so triangle count
   is nodes x GRID^2 - the single biggest cost on a weak GPU, where the terrain
   is vertex-bound long before it is fill-bound. Must be even: the CDLOD morph
   slides odd grid lines onto even ones. Switchable at runtime (setGrid). */
export const GRID_OPTIONS = { Low: 32, Medium: 48, High: 64 };
const GRID = GRID_OPTIONS.High;
/* Adaptive LOD never scales splitK below this (or below the user's own value,
   if lower): further down the selection starts putting neighbouring nodes
   more than one level apart, which the skirts cannot be relied on to hide. */
const MIN_SPLIT_K = 1.5;

function buildPatchGeometry(grid) {
  // (grid+1)^2 interior vertices plus a one-cell skirt ring. The skirt is
  // insurance against hairline cracks where neighbouring nodes differ by more
  // than one LOD level, which distance-based selection can occasionally produce.
  const n = grid + 3;            // includes one duplicated ring on each side
  const verts = n * n;
  const pos = new Float32Array(verts * 3);
  const skirt = new Float32Array(verts);

  let p = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const gi = Math.min(grid, Math.max(0, i - 1));
      const gj = Math.min(grid, Math.max(0, j - 1));
      pos[p * 3 + 0] = gi / grid;
      pos[p * 3 + 1] = 0;
      pos[p * 3 + 2] = gj / grid;
      skirt[p] = (i === 0 || j === 0 || i === n - 1 || j === n - 1) ? 1 : 0;
      p++;
    }
  }

  const quads = (n - 1) * (n - 1);
  const idx = new Uint16Array(quads * 6);   // (64+3)^2 = 4489 vertices: 16 bits is plenty
  let k = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  }

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSkirt', new THREE.BufferAttribute(skirt, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

/* Shared by both stages: the fragment shader needs it to trace rays, not just
   to shade. Kept as one string so vertex displacement and ray marching can
   never disagree about where the ground is. */
export const HEIGHT_SAMPLER = /* glsl */`
uniform usampler2D uHeight;
uniform vec2  uHeightSize;
uniform vec2  uAnchor;
uniform float uMPP;
uniform vec2  uElev;

// Bilinear fetch mirroring Heightfield.heightAt on the CPU bit for bit.
// R16UI cannot be hardware-filtered, so we interpolate by hand - which is
// exactly what keeps CPU collision and GPU display in agreement.
float sampleH(vec2 world) {
  vec2 f  = world / uMPP + uAnchor;
  vec2 i0 = floor(f);
  vec2 t  = f - i0;
  ivec2 m = ivec2(uHeightSize) - 1;
  ivec2 b = ivec2(i0);
  float h00 = float(texelFetch(uHeight, clamp(b,                ivec2(0), m), 0).r);
  float h10 = float(texelFetch(uHeight, clamp(b + ivec2(1, 0), ivec2(0), m), 0).r);
  float h01 = float(texelFetch(uHeight, clamp(b + ivec2(0, 1), ivec2(0), m), 0).r);
  float h11 = float(texelFetch(uHeight, clamp(b + ivec2(1, 1), ivec2(0), m), 0).r);
  return uElev.x + mix(mix(h00, h10, t.x), mix(h01, h11, t.x), t.y) * uElev.y;
}
`;

/* Vertex stage only: the height plus its four one-texel neighbours for the
   normal. Five separate sampleH calls fetch 20 texels, but they overlap - the
   union is a 4x4 block minus its corners - so this fetches each of those 12
   once. h is computed exactly as sampleH computes it, so collision still
   matches the drawn surface. */
const HEIGHT_NORMAL_SAMPLER = /* glsl */`
float hTexel(ivec2 c, ivec2 m) { return float(texelFetch(uHeight, clamp(c, ivec2(0), m), 0).r); }

float sampleHN(vec2 world, out vec3 nrm) {
  vec2 f  = world / uMPP + uAnchor;
  vec2 i0 = floor(f);
  vec2 t  = f - i0;
  ivec2 m = ivec2(uHeightSize) - 1;
  ivec2 b = ivec2(i0);
  float h00 = hTexel(b,                 m), h10 = hTexel(b + ivec2( 1, 0), m);
  float h01 = hTexel(b + ivec2(0, 1),   m), h11 = hTexel(b + ivec2( 1, 1), m);
  float hm0 = hTexel(b + ivec2(-1, 0),  m), hm1 = hTexel(b + ivec2(-1, 1), m);
  float h20 = hTexel(b + ivec2( 2, 0),  m), h21 = hTexel(b + ivec2( 2, 1), m);
  float h0m = hTexel(b + ivec2(0, -1),  m), h1m = hTexel(b + ivec2( 1,-1), m);
  float h02 = hTexel(b + ivec2(0, 2),   m), h12 = hTexel(b + ivec2( 1, 2), m);
  float hl = mix(mix(hm0, h00, t.x), mix(hm1, h01, t.x), t.y);
  float hr = mix(mix(h10, h20, t.x), mix(h11, h21, t.x), t.y);
  float hd = mix(mix(h0m, h1m, t.x), mix(h00, h10, t.x), t.y);
  float hu = mix(mix(h01, h11, t.x), mix(h02, h12, t.x), t.y);
  // Elevation offset cancels in the differences; only the scale is needed.
  nrm = normalize(vec3((hl - hr) * uElev.y, 2.0 * uMPP, (hd - hu) * uElev.y));
  return uElev.x + mix(mix(h00, h10, t.x), mix(h01, h11, t.x), t.y) * uElev.y;
}
`;

/* Also shared with the lighting cache's bake pass (lightcache.js): the cached
   shadows are the very same rays, just traced once per DTM texel instead of
   once per screen pixel per frame. */
export const RT_GLSL = /* glsl */`
uniform int   uRTSteps;       // 0 disables terrain ray tracing entirely
uniform float uRTSoftness;    // penumbra width; 0 = hard shadow edges
uniform float uRTMaxDist;     // how far a shadow ray is allowed to travel
uniform int   uAODirs;        // 0 disables ambient occlusion
uniform int   uAOSteps;
uniform float uAORadius;

/**
 * Sphere-traced soft shadow against the real elevation data.
 *
 * No hardware ray tracing is exposed to browsers - WebGPU does not surface RT
 * cores and WebGL2 certainly does not. But a heightfield is the one case where
 * that does not matter: the surface is a graph, so the vertical gap between
 * ray and terrain is a usable proximity bound and the ray can be advanced by
 * it. These are genuine rays intersecting the genuine USGS DTM.
 *
 * Long shadows matter more on Mars than on Earth: at Jezero the sun spends
 * most of the sol low, and crater rims throw kilometre-scale shadows.
 */
float traceSunShadow(vec3 p, vec3 L) {
  if (uRTSteps <= 0 || L.y <= 0.01) return 1.0;
  float t = uMPP * 1.5;                       // step off the surface
  float res = 1.0;
  for (int i = 0; i < 128; i++) {
    if (i >= uRTSteps) break;
    vec3 q = p + L * t;
    float h = sampleH(q.xz);
    float d = q.y - h;
    if (d < 0.0) return 0.0;                  // terrain blocks the sun
    res = min(res, uRTSoftness * d / t);      // closest approach -> penumbra
    t += clamp(d * 0.75, uMPP * 0.9, uRTMaxDist * 0.06);
    if (t > uRTMaxDist) break;
  }
  return clamp(res, 0.0, 1.0);
}

/** Horizon-traced ambient occlusion: how much sky each point can actually see. */
float traceAO(vec3 p) {
  if (uAODirs <= 0) return 1.0;
  float occ = 0.0;
  float golden = 2.39996323;
  for (int d = 0; d < 8; d++) {
    if (d >= uAODirs) break;
    float a = float(d) * golden;
    vec2 dir = vec2(cos(a), sin(a));
    float maxSlope = 0.0;
    for (int s = 1; s <= 8; s++) {
      if (s > uAOSteps) break;
      float dist = uAORadius * (float(s) / float(uAOSteps));
      float h = sampleH(p.xz + dir * dist);
      maxSlope = max(maxSlope, (h - p.y) / dist);
    }
    occ += clamp(maxSlope, 0.0, 1.0);
  }
  return clamp(1.0 - occ / float(uAODirs), 0.0, 1.0);
}
`;

const VERT = /* glsl */`
precision highp float;
precision highp int;
precision highp usampler2D;
${HEIGHT_SAMPLER}
${HEIGHT_NORMAL_SAMPLER}
${DETAIL_GLSL}
uniform vec3  uCamPos;
uniform float uCurvature;     // 1/(2R); 0 renders a flat plane

attribute float aSkirt;
attribute vec2  iOrigin;      // node corner, world XZ metres
attribute float iSize;        // node edge length, metres
attribute float iMorph;       // 0 = own grid, 1 = fully snapped to parent grid

uniform float uGrid;
uniform float uSkirtDepth;

varying vec3 vWorld;
varying vec3 vNormal;
varying float vSlope;

void main() {
  // --- CDLOD morph: slide odd grid lines onto their even neighbours ---
  vec2 g    = position.xz;
  vec2 frac = fract(g * uGrid * 0.5) * 2.0 / uGrid;
  vec2 gm   = g - frac * iMorph;

  vec2 world = iOrigin + gm * iSize;

  // per-vertex normal from the same texel block: cheaper here than per fragment
  vec3  nrm;
  float h = sampleHN(world, nrm);

  // slope of the MEASURED surface drives shading and the detail mask
  vSlope = acos(clamp(nrm.y, -1.0, 1.0));

  // --- synthesised sub-DTM band: the ripples and roughness 2 m/px cannot hold ---
  float camDist = length(world - uCamPos.xz);
  float dm = mx_detailMask(vSlope, camDist);
  if (dm > 0.001) {
    float e = 0.40;
    h += mx_detailHeight(world) * dm;
    float gx = (mx_detailHeight(world + vec2(e, 0.0)) - mx_detailHeight(world - vec2(e, 0.0))) * dm / (2.0 * e);
    float gz = (mx_detailHeight(world + vec2(0.0, e)) - mx_detailHeight(world - vec2(0.0, e))) * dm / (2.0 * e);
    nrm = normalize(vec3(nrm.x - gx, nrm.y, nrm.z - gz));
  }
  vNormal = nrm;

  // skirts scale with the patch, or a 16 m leaf gets a 6 m curtain
  float skirt = aSkirt * uSkirtDepth * clamp(iSize / 128.0, 0.18, 1.0);

  // vWorld stays the TRUE position so ray tracing and fog stay physical; only
  // the drawn vertex is bent away by the planet's curvature.
  vec3 wp = vec3(world.x, h - skirt, world.y);
  vWorld  = wp;

  float cdx = world.x - uCamPos.x, cdz = world.y - uCamPos.z;
  wp.y -= (cdx * cdx + cdz * cdz) * uCurvature;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);
}
`;

const FRAG = /* glsl */`
precision highp float;
precision highp int;
precision highp usampler2D;
${OUTPUT_PARS}
${HEIGHT_SAMPLER}

${RT_GLSL}

/* Lighting cache (lightcache.js). Sun and sky only move slowly, so shadow and
   AO are baked into textures in heightfield space and merely looked up here:
   a fine window around the camera plus a coarse copy of the whole tile.
   0 falls back to tracing live, per pixel, every frame. */
uniform int       uLightCache;
uniform sampler2D uNearLight;
uniform vec2      uNearOrigin;   // world XZ of texel (0,0)'s centre
uniform float     uNearTexel;    // metres per cache texel
uniform vec2      uNearSize;
uniform sampler2D uFarLight;
uniform vec2      uFarOrigin;
uniform float     uFarTexel;
uniform vec2      uFarSize;

vec2 cachedLight(vec2 w) {
  vec2 tf = (w - uFarOrigin) / uFarTexel;
  vec2 far = textureLod(uFarLight, (tf + 0.5) / uFarSize, 0.0).rg;
  vec2 tn = (w - uNearOrigin) / uNearTexel;
  vec2 edge = min(tn, uNearSize - 1.0 - tn);
  float wN = clamp(min(edge.x, edge.y) / 48.0, 0.0, 1.0);   // fade out at the window rim
  if (wN <= 0.0) return far;
  vec2 near = textureLod(uNearLight, (tn + 0.5) / uNearSize, 0.0).rg;
  return mix(far, near, wN);
}

uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uSkyColor;
uniform vec3  uGroundColor;
uniform vec3  uCamPos;
uniform vec3  uFogColor;
uniform float uFogDensity;
uniform float uDebugLod;
uniform sampler2D uMask;        // 1 = measured DTM, 0 = gap-filled
uniform vec2  uMaskSize;
uniform vec2  uAnchorF;
uniform float uMPPF;
uniform float uMaskStrength;

varying vec3 vWorld;
varying vec3 vNormal;
varying float vSlope;

/* The mask is the same window decimated 4x, so a base texel maps to mask
   texel / 4 exactly - no resampling guesswork. */
float measuredFraction(vec2 world){
  vec2 t = (world / uMPPF + uAnchorF) * 0.25;
  return texture(uMask, (t + 0.5) / uMaskSize).r;
}

// cheap value noise for sub-texel regolith detail
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){ s += a * noise(p); p *= 2.03; a *= 0.5; }
  return s;
}

void main() {
  vec3 N = normalize(vNormal);
  float dist = length(uCamPos - vWorld);

  // Perturb the data-resolution normal with fine detail so the surface does not
  // read as flat between DTM samples. It is metre-scale, so past a few hundred
  // metres it is sub-pixel and only aliases: fade it out and skip the 12 noise
  // evaluations entirely, which is most of the screen.
  float nearFx = 1.0 - smoothstep(160.0, 320.0, dist);
  if (nearFx > 0.0) {
    float e = 0.35;
    float n1 = fbm(vWorld.xz * 0.55);
    float nx = fbm(vWorld.xz * 0.55 + vec2(e, 0.0)) - n1;
    float nz = fbm(vWorld.xz * 0.55 + vec2(0.0, e)) - n1;
    N = normalize(N + vec3(-nx, 0.0, -nz) * 0.55 * nearFx);   // real displacement now carries most of this
  }

  // Slope drives the mix: dust settles on flats, rock is exposed on steeps.
  float slopeT = smoothstep(0.12, 0.55, vSlope);
  // linear-space reflectances, not sRGB swatches: Mars regolith sits around
  // 0.15-0.25 bolometric albedo, so these stay deliberately dark.
  vec3 dust = vec3(0.225, 0.108, 0.052);
  vec3 rock = vec3(0.118, 0.056, 0.033);
  vec3 pale = vec3(0.300, 0.168, 0.094);
  vec3 albedo = mix(dust, rock, slopeT);
  albedo = mix(albedo, pale, smoothstep(0.35, 0.75, fbm(vWorld.xz * 0.014)) * 0.35);
  // 0.469 is this fbm's mean, which is all a distant pixel can resolve of it
  float fine = nearFx > 0.0 ? mix(0.469, fbm(vWorld.xz * 0.9), nearFx) : 0.469;
  albedo *= 0.86 + 0.28 * fine;

  vec3 L = normalize(uSunDir);
  float ndl = max(dot(N, L), 0.0);

  // rays traced against the actual DTM, not a shadow map
  float shadow, ao;
  if (uLightCache != 0) {
    vec2 lit = cachedLight(vWorld.xz);
    shadow = lit.r; ao = lit.g;
  } else {
    shadow = traceSunShadow(vWorld, L);
    ao = traceAO(vWorld);
  }

  // Mars has no ozone and a dusty sky: strong direct sun, warm hemispheric
  // bounce, and noticeably little blue anywhere.
  vec3 hemi = mix(uGroundColor, uSkyColor, N.y * 0.5 + 0.5);
  vec3 col = albedo * (uSunColor * ndl * shadow * 2.10 + hemi * ao * 0.62);

  // very cheap specular sheen on flats, reads as fine dust glint
  vec3 V = normalize(uCamPos - vWorld);
  vec3 H = normalize(L + V);
  col += uSunColor * pow(max(dot(N, H), 0.0), 34.0) * 0.010 * (1.0 - slopeT) * shadow;

  // Ground we interpolated is shown as interpolated: desaturated and cooled,
  // so synthesised terrain is never passed off as measurement.
  float measured = measuredFraction(vWorld.xz);
  float synth = (1.0 - smoothstep(0.35, 0.65, measured)) * uMaskStrength;
  if (synth > 0.001) {
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    vec3 flat_ = mix(vec3(lum), col, 0.35) * vec3(0.84, 0.90, 1.02);
    float hatch = 0.5 + 0.5 * sin((vWorld.x + vWorld.z) * 0.55);
    col = mix(col, flat_ * (0.93 + 0.07 * hatch), synth);
  }

  float fog  = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));

  mx_writeOutput(col);
}
`;

assertShaderContract(FRAG, 'terrain');

class Node {
  constructor(x, z, size, level) {
    this.x = x; this.z = z; this.size = size; this.level = level;
    this.children = null;
    this.minY = 0; this.maxY = 0;
  }
}

export class Terrain {
  constructor(heightfield, opts = {}) {
    this.hf = heightfield;
    this.leafSize = opts.leafSize ?? 128;              // metres
    this.splitK = opts.splitK ?? 2.6;                  // higher = more detail held further out
    // Multiplier on splitK owned by the adaptive-quality loop (1 = as chosen).
    this.lodScale = 1;
    this.grid = opts.grid ?? GRID;
    this.maxInstances = opts.maxInstances ?? 6000;
    this.skirtDepth = opts.skirtDepth ?? 6;
    // Radius around the camera always meshed at full leaf density, detail or
    // not, so the drawn triangles match the bilinear surface collision uses.
    this.interactRange = opts.interactRange ?? 64;

    this.nodesBuilt = 0;
    this.hf.buildMinMax(Math.max(1, Math.round(this.leafSize / this.hf.mpp)));
    this._buildTree();

    const geo = buildPatchGeometry(this.grid);
    this.iOrigin = new THREE.InstancedBufferAttribute(new Float32Array(this.maxInstances * 2), 2);
    this.iSize = new THREE.InstancedBufferAttribute(new Float32Array(this.maxInstances), 1);
    this.iMorph = new THREE.InstancedBufferAttribute(new Float32Array(this.maxInstances), 1);
    for (const a of [this.iOrigin, this.iSize, this.iMorph]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iOrigin', this.iOrigin);
    geo.setAttribute('iSize', this.iSize);
    geo.setAttribute('iMorph', this.iMorph);
    geo.instanceCount = 0;
    // The bounding sphere must cover the whole field; instances are placed
    // entirely in the shader, so three.js cannot infer it.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 40000);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      glslVersion: THREE.GLSL3,
      uniforms: {
        uHeight: { value: heightfield.createTexture() },
        uHeightSize: { value: new THREE.Vector2(heightfield.width, heightfield.height) },
        uAnchor: { value: new THREE.Vector2(heightfield.anchorCol, heightfield.anchorRow) },
        uMPP: { value: heightfield.mpp },
        uElev: { value: new THREE.Vector2(heightfield.elevMin, heightfield.elevSpan) },
        uGrid: { value: this.grid },
        uSkirtDepth: { value: this.skirtDepth },
        uSunDir: { value: new THREE.Vector3(0.45, 0.42, -0.79).normalize() },
        uSunColor: { value: new THREE.Color(0xffe9d4) },
        uSkyColor: { value: new THREE.Color(0xc79a6d) },
        uGroundColor: { value: new THREE.Color(0x4a2e20) },
        uCamPos: { value: new THREE.Vector3() },
        uFogColor: { value: new THREE.Color(0xb98c63) },
        uFogDensity: { value: 0.000052 },
        uDebugLod: { value: 0 },
        uExposure: { value: 1.0 },
        uMask: { value: null },
        uMaskSize: { value: new THREE.Vector2(1, 1) },
        uAnchorF: { value: new THREE.Vector2(heightfield.anchorCol, heightfield.anchorRow) },
        uMPPF: { value: heightfield.mpp },
        uMaskStrength: { value: 1.0 },
        uRTSteps: { value: 40 },
        uRTSoftness: { value: 14.0 },
        uRTMaxDist: { value: 2600.0 },
        uAODirs: { value: 5 },
        uAOSteps: { value: 5 },
        uAORadius: { value: 90.0 },
        uLightCache: { value: 0 },
        uNearLight: { value: null },
        uNearOrigin: { value: new THREE.Vector2() },
        uNearTexel: { value: 1 },
        uNearSize: { value: new THREE.Vector2(1, 1) },
        uFarLight: { value: null },
        uFarOrigin: { value: new THREE.Vector2() },
        uFarTexel: { value: 1 },
        uFarSize: { value: new THREE.Vector2(1, 1) },
        // 1/(2R) for Mars. At 3317 m this drops the surface exactly 1.62 m,
        // which is eye height - so the horizon lands where it really does.
        uCurvature: { value: 1 / (2 * 3396190) },
        uDetailScale: { value: 1.0 },
        uDetailNear: { value: 45.0 },
        uDetailFar: { value: 150.0 },
      },
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;                    // we cull per node ourselves
    this.mesh.renderOrder = 0;
    this.geometry = geo;

    this.stats = { nodes: 0, tris: 0 };
    this._selNode = new Array(this.maxInstances);
    this._selDist = new Float32Array(this.maxInstances);
    this._selMorph = new Float32Array(this.maxInstances);
    this._order = [];
    this._frustum = new THREE.Frustum();
    this._mat = new THREE.Matrix4();
    this._box = new THREE.Box3();
  }

  /** Swap the shared patch for one with a different segment count. */
  setGrid(grid) {
    if (grid === this.grid || grid % 2) return;
    const old = this.geometry, geo = buildPatchGeometry(grid);
    for (const k of ['iOrigin', 'iSize', 'iMorph']) {
      geo.setAttribute(k, old.getAttribute(k));
      old.deleteAttribute(k);            // shared: keep their buffers alive through dispose()
    }
    geo.instanceCount = old.instanceCount;
    geo.boundingSphere = old.boundingSphere;
    old.dispose();
    this.mesh.geometry = this.geometry = geo;
    this.grid = grid;
    this.material.uniforms.uGrid.value = grid;
  }

  // GLSL3 shaders declare their own outputs; three still injects these chunks.
  _buildTree() {
    const hf = this.hf;
    const spanX = hf.maxX - hf.minX, spanZ = hf.maxZ - hf.minZ;
    let root = this.leafSize;
    let levels = 0;
    while (root < Math.max(spanX, spanZ) && levels < 12) { root *= 2; levels++; }
    // one root per leafSize-aligned tile covering the field
    this.roots = [];
    const nx = Math.ceil(spanX / root), nz = Math.ceil(spanZ / root);
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++)
        this.roots.push(this._makeNode(hf.minX + i * root, hf.minZ + j * root, root, levels));
    this.rootSize = root;
    this.levels = levels;
  }

  /**
   * Nodes are created on demand. Eagerly building to a 16 m leaf over a 16 km
   * root would be 4^10 leaves; lazily, only the handful along the camera's
   * path ever exist. Elevation bounds come straight from the min/max pyramid,
   * so a parent never needs its children to know its own extent.
   */
  _makeNode(x, z, size, level) {
    const n = new Node(x, z, size, level);
    const hf = this.hf;
    const col0 = Math.round(x / hf.mpp + hf.anchorCol);
    const row0 = Math.round(z / hf.mpp + hf.anchorRow);
    const [mn, mx] = hf.nodeElevRange(col0, row0, Math.max(1, Math.round(size / hf.mpp)));
    n.minY = mn; n.maxY = mx;
    return n;
  }

  _children(n) {
    if (!n.children && n.level > 0) {
      const h = n.size / 2;
      n.children = [
        this._makeNode(n.x, n.z, h, n.level - 1),
        this._makeNode(n.x + h, n.z, h, n.level - 1),
        this._makeNode(n.x, n.z + h, h, n.level - 1),
        this._makeNode(n.x + h, n.z + h, h, n.level - 1),
      ];
      this.nodesBuilt += 4;
    }
    return n.children;
  }

  _distanceToNode(n, p) {
    const dx = Math.max(n.x - p.x, 0, p.x - (n.x + n.size));
    const dz = Math.max(n.z - p.z, 0, p.z - (n.z + n.size));
    const dy = Math.max(n.minY - p.y, 0, p.y - n.maxY);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  _visible(n) {
    this._box.min.set(n.x, n.minY - this.skirtDepth, n.z);
    this._box.max.set(n.x + n.size, n.maxY, n.z + n.size);
    return this._frustum.intersectsBox(this._box);
  }

  _select(n, p, out) {
    if (out.count >= this.maxInstances) return;
    if (!this._visible(n)) return;
    const d = this._distanceToNode(n, p);
    // Past the synthesised-detail band there is nothing finer than the DTM to
    // draw, so once a patch's vertex spacing reaches the data's own 2 m,
    // splitting further only multiplies triangles over identical bilinear
    // ramps. This removes the densest ring the plain distance rule builds.
    const k = this._k;
    const atDataRes = n.size / this.grid <= this.hf.mpp && d > this._fineRange;
    if (n.level === 0 || atDataRes || d > k * n.size) {
      const lo = k * n.size * 1.35;
      const hi = k * n.size * 2.0;
      const morph = Math.min(1, Math.max(0, (d - lo) / Math.max(hi - lo, 1e-6)));
      const i = out.count++;
      this._selNode[i] = n;
      this._selDist[i] = d;
      this._selMorph[i] = morph;
      // Drop subtrees well behind us so exploring the whole map cannot grow
      // the tree without bound.
      if (n.children && d > k * n.size * 4) { n.children = null; }
    } else {
      for (const c of this._children(n)) this._select(c, p, out);
    }
  }

  update(camera) {
    camera.updateMatrixWorld();
    this._mat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._mat);

    const u = this.material.uniforms;
    this._fineRange = Math.max(this.interactRange, u.uDetailScale.value > 0 ? u.uDetailFar.value : 0);
    this._k = Math.max(Math.min(this.splitK, MIN_SPLIT_K), this.splitK * this.lodScale);
    const p = camera.position;
    const out = { count: 0 };
    for (const r of this.roots) this._select(r, p, out);

    // Front to back, so the depth test rejects hidden ground before it is
    // shaded. three.js cannot sort inside one instanced draw, but the
    // instances themselves can be written in order.
    const order = this._order, dist = this._selDist;
    order.length = out.count;
    for (let i = 0; i < out.count; i++) order[i] = i;
    order.sort((a, b) => dist[a] - dist[b]);
    for (let j = 0; j < out.count; j++) {
      const i = order[j], n = this._selNode[i];
      this.iOrigin.array[j * 2] = n.x;
      this.iOrigin.array[j * 2 + 1] = n.z;
      this.iSize.array[j] = n.size;
      this.iMorph.array[j] = this._selMorph[i];
    }

    this.iOrigin.needsUpdate = true;
    this.iSize.needsUpdate = true;
    this.iMorph.needsUpdate = true;
    this.iOrigin.addUpdateRange(0, out.count * 2);
    this.iSize.addUpdateRange(0, out.count);
    this.iMorph.addUpdateRange(0, out.count);
    this.geometry.instanceCount = out.count;

    this.material.uniforms.uCamPos.value.copy(p);
    this.stats.nodes = out.count;
    this.stats.tris = out.count * (this.grid + 2) * (this.grid + 2) * 2;
    return out.count;
  }
}
