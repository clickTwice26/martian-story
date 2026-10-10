import * as THREE from 'three';
import { floatTargetType } from './bake.js';

/**
 * Cinematic post chain for the space acts: scene -> linear HDR target ->
 * mip-chain bloom -> one composite pass that tone maps (three's ACES fit),
 * grades, adds vignette, grain, edge fringing and an analytic sun flare.
 *
 * Bloom is a progressive down/up-sample (the "Call of Duty" style chain), so
 * its cost is a handful of passes over ever smaller targets regardless of
 * radius - cheap enough for the Low preset.
 */

const TRI = new THREE.BufferGeometry();
TRI.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));

const VERT = /* glsl */`
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function pass(frag, uniforms) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms, vertexShader: VERT,
    fragmentShader: `precision highp float;\nin vec2 vUv;\nout vec4 fragColor;\n${frag}`,
    depthTest: false, depthWrite: false,
  });
}

const DOWN = pass(/* glsl */`
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uPrefilter;      // 1 on the first pass: threshold + firefly guard
uniform float uThreshold;
/* A NaN or Inf anywhere in the scene would be spread by every pass of this
   chain into ever larger black blocks; drop it here, and keep half-float
   overflow out too. */
vec3 clean(vec3 c) { return any(isnan(c)) || any(isinf(c)) ? vec3(0.0) : min(c, vec3(60000.0)); }
vec3 s(vec2 o) { return clean(texture(uSrc, vUv + o * uTexel).rgb); }
void main() {
  // 13-tap downsample, weighted to avoid the box filter's pulsing
  vec3 a = s(vec2(-2, 2)), b = s(vec2(0, 2)), c = s(vec2(2, 2));
  vec3 d = s(vec2(-2, 0)), e = s(vec2(0, 0)), f = s(vec2(2, 0));
  vec3 g = s(vec2(-2, -2)), h = s(vec2(0, -2)), i = s(vec2(2, -2));
  vec3 j = s(vec2(-1, 1)), k = s(vec2(1, 1)), l = s(vec2(-1, -1)), m = s(vec2(1, -1));
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  if (uPrefilter > 0.5) {
    float br = max(col.r, max(col.g, col.b));
    float soft = clamp(br - uThreshold + 0.5, 0.0, 1.0);
    soft = soft * soft * 0.5;
    float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
    col *= contrib / (1.0 + br * 0.02);           // Karis-ish: tame single-pixel fireflies
  }
  fragColor = vec4(col, 1.0);
}`, { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uPrefilter: { value: 0 }, uThreshold: { value: 1.0 } });

const UP = pass(/* glsl */`
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uRadius;
vec3 s(vec2 o) { return texture(uSrc, vUv + o * uTexel * uRadius).rgb; }
void main() {
  vec3 col = s(vec2(0)) * 4.0 + (s(vec2(-1, 0)) + s(vec2(1, 0)) + s(vec2(0, -1)) + s(vec2(0, 1))) * 2.0
           + s(vec2(-1, -1)) + s(vec2(1, -1)) + s(vec2(-1, 1)) + s(vec2(1, 1));
  fragColor = vec4(col / 16.0, 1.0);
}`, { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } });

const COMPOSITE = pass(/* glsl */`
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform float uExposure;
uniform float uTime;
uniform float uGrain;
uniform float uVignette;
uniform float uFringe;
uniform vec2 uAspect;
uniform vec3 uSunScreen;       // xy in NDC, z = visibility 0..1
uniform float uFlare;
uniform vec3 uTint;            // scene-wide grade, e.g. red alarm wash
uniform float uFade;           // 0 = black, 1 = picture

vec3 cineRRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 cineAces(vec3 c) {
  const mat3 IN = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 OUT = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  c *= 1.0 / 0.6;
  return clamp(OUT * cineRRTAndODTFit(IN * c), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 clean(vec3 c) { return any(isnan(c)) || any(isinf(c)) ? vec3(0.0) : c; }

vec3 flare(vec2 p) {
  if (uSunScreen.z <= 0.0) return vec3(0.0);
  vec2 s = uSunScreen.xy;
  vec2 q = (p - s) * uAspect;
  vec3 col = vec3(0.0);
  // anamorphic streak through the sun
  col += vec3(0.55, 0.70, 1.0) * exp(-abs(q.y) * 90.0) * exp(-abs(q.x) * 1.6) * 0.6;
  // ghosts along the line through the centre of the frame
  for (int i = 0; i < 5; i++) {
    float t = -0.35 - float(i) * 0.38;
    vec2 g = s * t;
    float r = 0.03 + 0.035 * float(i % 3);
    float d = length((p - g) * uAspect);
    float ring = smoothstep(r, r * 0.7, d) * (0.4 + 0.6 * smoothstep(r * 0.4, r, d));
    vec3 tint = i == 0 ? vec3(0.9, 0.5, 0.3) : i == 1 ? vec3(0.3, 0.6, 0.9) : i == 2 ? vec3(0.6, 0.9, 0.5) : vec3(0.8, 0.6, 1.0);
    col += tint * ring * 0.05;
  }
  // halo ring
  float hd = length(q);
  col += vec3(0.9, 0.7, 0.5) * exp(-pow((hd - 0.42) * 18.0, 2.0)) * 0.05;
  return col * uSunScreen.z * uFlare;
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  // slight lateral chromatic fringe toward the edges, like a real lens
  vec2 off = p * dot(p, p) * uFringe * 0.004;
  vec3 hdr;
  hdr.r = texture(uScene, vUv - off).r;
  hdr.g = texture(uScene, vUv).g;
  hdr.b = texture(uScene, vUv + off).b;
  hdr = clean(hdr);
  hdr += clean(texture(uBloom, vUv).rgb) * uBloomStrength;
  hdr += flare(p);
  hdr *= uTint;
  vec3 c = cineAces(hdr * uExposure);
  // grade: cool the shadows, warm the highlights, a touch of film contrast
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, c * vec3(0.92, 1.0, 1.08), (1.0 - smoothstep(0.0, 0.35, l)) * 0.55);
  c = mix(c, c * vec3(1.06, 1.0, 0.92), smoothstep(0.45, 1.0, l) * 0.45);
  c = mix(vec3(l), c, 1.06);
  float v = 1.0 - uVignette * smoothstep(0.35, 1.45, length(p * vec2(1.0, 0.85)));
  c *= v;
  c = toSRGB(clamp(c, 0.0, 1.0));
  c += (hash(vUv * 937.0 + fract(uTime * 7.31)) - 0.5) * uGrain;
  fragColor = vec4(c * uFade, 1.0);
}`, {
  uScene: { value: null }, uBloom: { value: null }, uBloomStrength: { value: 0.9 },
  uExposure: { value: 1.0 }, uTime: { value: 0 }, uGrain: { value: 0.035 }, uVignette: { value: 0.55 },
  uFringe: { value: 1 }, uAspect: { value: new THREE.Vector2(1, 1) },
  uSunScreen: { value: new THREE.Vector3(0, 0, 0) }, uFlare: { value: 1 },
  uTint: { value: new THREE.Vector3(1, 1, 1) }, uFade: { value: 1 },
});

export class CinePost {
  constructor(renderer, { msaa = true } = {}) {
    this.renderer = renderer;
    this.type = floatTargetType(renderer);
    this.scene = new THREE.Scene();
    this.quad = new THREE.Mesh(TRI, DOWN);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.cam = new THREE.Camera();
    this.msaa = msaa;
    this.levels = 6;
    this.hdr = null;
    this.mips = [];
    this.composite = COMPOSITE;
    this._size = new THREE.Vector2();
  }

  _target(w, h, samples = 0, depth = false) {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: this.type, samples, depthBuffer: depth, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, generateMipmaps: false,
    });
    rt.texture.colorSpace = THREE.NoColorSpace;
    return rt;
  }

  setSize(w, h) {
    w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
    if (this._w === w && this._h === h) return;
    this.dispose();
    this._w = w; this._h = h;
    this.hdr = this._target(w, h, this.msaa ? 4 : 0, true);
    let mw = w, mh = h;
    for (let i = 0; i < this.levels; i++) {
      mw = Math.max(2, mw >> 1); mh = Math.max(2, mh >> 1);
      this.mips.push(this._target(mw, mh));
    }
    COMPOSITE.uniforms.uAspect.value.set(w / h, 1);
  }

  _blit(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.cam);
  }

  /**
   * Render through the full chain to the canvas. `passes` is a list of
   * { scene, camera, clearDepth } drawn in order into the same HDR target -
   * so far objects (planets, at 1e7 m) and near ones (the ship, at 0.1 m) can
   * each use a depth range their 24 bits can actually resolve.
   */
  render(passes) {
    const r = this.renderer;
    r.getDrawingBufferSize(this._size);
    this.setSize(this._size.x, this._size.y);
    const prevClear = r.autoClear;
    r.autoClear = false;              // the up-sample passes accumulate
    r.setRenderTarget(this.hdr);
    r.clear();
    for (const p of passes) {         // three skips tone mapping on render targets: linear HDR
      if (p.clearDepth) r.clearDepth();
      r.render(p.scene, p.camera);
    }

    // bloom: down the chain...
    let src = this.hdr.texture, sw = this._w, sh = this._h;
    for (let i = 0; i < this.mips.length; i++) {
      DOWN.uniforms.uSrc.value = src;
      DOWN.uniforms.uTexel.value.set(1 / sw, 1 / sh);
      DOWN.uniforms.uPrefilter.value = i === 0 ? 1 : 0;
      this._blit(DOWN, this.mips[i]);
      src = this.mips[i].texture; sw = this.mips[i].width; sh = this.mips[i].height;
    }
    // ...and back up, accumulating additively into each larger level
    for (let i = this.mips.length - 1; i > 0; i--) {
      UP.uniforms.uSrc.value = this.mips[i].texture;
      UP.uniforms.uTexel.value.set(1 / this.mips[i].width, 1 / this.mips[i].height);
      UP.blending = THREE.AdditiveBlending; UP.transparent = true;
      this._blit(UP, this.mips[i - 1]);
    }
    COMPOSITE.uniforms.uScene.value = this.hdr.texture;
    COMPOSITE.uniforms.uBloom.value = this.mips[0].texture;
    this._blit(COMPOSITE, null);
    r.autoClear = prevClear;
  }

  dispose() {
    if (this.hdr) this.hdr.dispose();
    for (const m of this.mips) m.dispose();
    this.mips = []; this.hdr = null; this._w = this._h = 0;
  }
}
