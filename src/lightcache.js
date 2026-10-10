import * as THREE from 'three';
import { HEIGHT_SAMPLER, RT_GLSL } from './terrain.js';

/**
 * Terrain lighting cache.
 *
 * The ray-traced sun shadow and horizon AO depend only on the ground and the
 * sun, never on the camera - yet traced per pixel they cost up to ~700 texel
 * fetches for every pixel of every frame, at 2x pixel ratio on a laptop. The
 * sun moves 0.004 degrees a second at 1x, so almost all of that work recomputes
 * last frame's answer.
 *
 * Instead the same rays are traced once per DTM texel into textures, and the
 * terrain shader does one lookup:
 *
 *   near  2048^2 texels at the DTM's own 2 m, a 4 km window that follows the
 *         camera (re-centred when it strays 600 m)
 *   far   the whole 16 x 8 km tile at 8 m, for everything beyond it
 *
 * Rebuilds are sliced into bands and spread over frames into a back buffer,
 * then swapped, so neither a moving sun nor a long walk ever causes a hitch.
 * Until both levels exist the terrain simply keeps tracing live.
 */

const NEAR_SIZE = 2048;
const RECENTRE = 600;            // metres the camera may stray before re-baking
const SUN_EPS = Math.cos(0.04 * Math.PI / 180);
const BAND_PIXELS = 2048 * 128;  // work per frame: ~1/16 of the near window

const BAKE_FRAG = /* glsl */`
precision highp float;
precision highp int;
precision highp usampler2D;
layout(location = 0) out vec4 fragColor;
${HEIGHT_SAMPLER}
${RT_GLSL}
uniform vec2  uOrigin;
uniform float uTexel;
uniform vec3  uBakeSun;

void main() {
  vec2 world = uOrigin + floor(gl_FragCoord.xy) * uTexel;
  vec3 p = vec3(world.x, sampleH(world), world.y);
  fragColor = vec4(traceSunShadow(p, normalize(uBakeSun)), traceAO(p), 0.0, 1.0);
}
`;

function makeTarget(w, h) {
  // Two channels (shadow, AO) at 8 bits: RG8 is colour-renderable in WebGL2,
  // and half of RGBA8's memory and of the bandwidth every terrain pixel reads.
  const rt = new THREE.WebGLRenderTarget(w, h, {
    format: THREE.RGFormat, type: THREE.UnsignedByteType,
    depthBuffer: false, stencilBuffer: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    generateMipmaps: false,
  });
  rt.texture.colorSpace = THREE.NoColorSpace;
  return rt;
}

export class LightCache {
  constructor(renderer, terrain) {
    this.renderer = renderer;
    this.terrain = terrain;
    this.enabled = true;
    const hf = terrain.hf;
    const tu = terrain.material.uniforms;

    // Share the heightfield and ray-tracing uniforms by reference, so the bake
    // traces exactly what the live path would. Only the sun is snapshotted.
    const uniforms = { uOrigin: { value: new THREE.Vector2() }, uTexel: { value: 1 },
                       uBakeSun: { value: new THREE.Vector3(0, 1, 0) } };
    for (const k of ['uHeight', 'uHeightSize', 'uAnchor', 'uMPP', 'uElev', 'uRTSteps',
                     'uRTSoftness', 'uRTMaxDist', 'uAODirs', 'uAOSteps', 'uAORadius'])
      uniforms[k] = tu[k];
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: BAKE_FRAG,
      uniforms, depthTest: false, depthWrite: false,
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const quad = new THREE.Mesh(tri, this.material);
    quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(quad);
    this.camera = new THREE.Camera();

    const farTexel = hf.mpp * 4;
    const farW = Math.ceil(hf.width / 4), farH = Math.ceil(hf.height / 4);
    const level = (w, h, texel) => ({
      w, h, texel,
      front: makeTarget(w, h), back: makeTarget(w, h),
      frontValid: false, frontOrigin: new THREE.Vector2(), frontSun: new THREE.Vector3(),
    });
    this.near = level(NEAR_SIZE, NEAR_SIZE, hf.mpp);
    this.far = level(farW, farH, farTexel);
    this.far.fixedOrigin = new THREE.Vector2(hf.minX, hf.minZ);

    this.queue = [];           // pending bake jobs, FIFO so a fast sun cannot starve the far level
    // Fraction of BAND_PIXELS traced per frame. The adaptive-quality loop lowers
    // it on a struggling GPU so a re-bake is spread thinner instead of adding a
    // fixed slab of ray marching to frames that are already over budget.
    this.budgetScale = 1;
    this.stats = { bakes: 0 };
  }

  /** Throw everything away, e.g. when the ray-tracing tier changes. */
  invalidate() {
    this.near.frontValid = this.far.frontValid = false;
    this.queue.length = 0;
  }

  _job(L, origin, sun) {
    return { L, origin: origin.clone(), sun: sun.clone(), row: 0 };
  }

  _nearOriginFor(cam) {
    // Snap to a 64-texel grid so cache texels sit exactly on DTM texels.
    const snap = this.near.texel * 64, half = NEAR_SIZE * this.near.texel / 2;
    return new THREE.Vector2(Math.round((cam.x - half) / snap) * snap,
                             Math.round((cam.z - half) / snap) * snap);
  }

  _queued(L) { return this.queue.some(j => j.L === L); }

  /** True once both levels hold a finished bake the terrain can sample. */
  get ready() { return this.near.frontValid && this.far.frontValid; }

  update(camPos, sunDir, budget = BAND_PIXELS * this.budgetScale) {
    const tu = this.terrain.material.uniforms;
    const traced = tu.uRTSteps.value > 0 || tu.uAODirs.value > 0;
    if (!this.enabled || !traced) { tu.uLightCache.value = 0; this.queue.length = 0; return; }

    const N = this.near, F = this.far;
    const halfSpan = NEAR_SIZE * N.texel / 2;
    const centre = N.frontValid
      ? Math.max(Math.abs(camPos.x - (N.frontOrigin.x + halfSpan)), Math.abs(camPos.z - (N.frontOrigin.y + halfSpan)))
      : Infinity;

    if (!this._queued(N)) {
      const stale = !N.frontValid || N.frontSun.dot(sunDir) < SUN_EPS || centre > RECENTRE;
      if (stale) this.queue.push(this._job(N, this._nearOriginFor(camPos), sunDir));
    }
    if (!this._queued(F) && (!F.frontValid || F.frontSun.dot(sunDir) < SUN_EPS))
      this.queue.push(this._job(F, F.fixedOrigin, sunDir));

    this._work(budget);

    tu.uLightCache.value = N.frontValid && F.frontValid ? 1 : 0;
  }

  _work(budget) {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget(), prevClear = r.autoClear;
    r.autoClear = false;
    const u = this.material.uniforms;
    while (budget > 0 && this.queue.length) {
      const job = this.queue[0], L = job.L;
      const rows = Math.max(1, Math.min(L.h - job.row, Math.floor(budget / L.w)));
      u.uOrigin.value.copy(job.origin);
      u.uTexel.value = L.texel;
      u.uBakeSun.value.copy(job.sun);
      L.back.viewport.set(0, 0, L.w, L.h);
      L.back.scissor.set(0, job.row, L.w, rows);
      L.back.scissorTest = true;
      r.setRenderTarget(L.back);
      r.render(this.scene, this.camera);
      job.row += rows;
      budget -= rows * L.w;
      if (job.row >= L.h) this._swap(L, job);
    }
    r.setRenderTarget(prevTarget);
    r.autoClear = prevClear;
  }

  _swap(L, job) {
    this.queue.shift();
    [L.front, L.back] = [L.back, L.front];
    L.frontValid = true;
    L.frontOrigin.copy(job.origin);
    L.frontSun.copy(job.sun);
    this.stats.bakes++;
    const tu = this.terrain.material.uniforms;
    if (L === this.near) {
      tu.uNearLight.value = L.front.texture;
      tu.uNearOrigin.value.copy(L.frontOrigin);
      tu.uNearTexel.value = L.texel;
      tu.uNearSize.value.set(L.w, L.h);
    } else {
      tu.uFarLight.value = L.front.texture;
      tu.uFarOrigin.value.copy(L.frontOrigin);
      tu.uFarTexel.value = L.texel;
      tu.uFarSize.value.set(L.w, L.h);
    }
  }
}
