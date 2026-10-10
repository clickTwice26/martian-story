import * as THREE from 'three';

/**
 * Camera-facing particle quads, one instanced draw per system.
 *
 * Simulated on the CPU (a few hundred to a couple of thousand live particles
 * at most), drawn as instanced billboards rather than GL points so a smoke
 * puff can be forty metres across without hitting the point-size limit.
 * The shader includes three's tone-mapping and colour-space chunks, which are
 * no-ops when drawing into the cinematic's linear HDR target and correct when
 * drawing straight to the canvas over the Mars terrain.
 */

let PUFF = null;
/**
 * Smoke puff: a Gaussian falloff broken up by two octaves of value noise.
 * Built per pixel, so the density thins out smoothly to nothing at the rim -
 * stacked hard-edged blobs read as discs the moment hundreds overlap.
 */
function puffTexture() {
  if (PUFF) return PUFF;
  const S = 128, data = new Uint8Array(S * S * 4);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const G = 9, grid = Array.from({ length: (G + 1) * (G + 1) }, rnd);
  const G2 = 21, grid2 = Array.from({ length: (G2 + 1) * (G2 + 1) }, rnd);
  const vn = (g, n, x, y) => {
    const fx = x * n, fy = y * n, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), w = n + 1;
    const a = g[iy * w + ix], b = g[iy * w + ix + 1], c = g[(iy + 1) * w + ix], d = g[(iy + 1) * w + ix + 1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x + 0.5) / S, v = (y + 0.5) / S, r2 = (u - 0.5) ** 2 + (v - 0.5) ** 2;
    const n = 0.62 * vn(grid, G, u, v) + 0.38 * vn(grid2, G2, u, v);
    const a = Math.exp(-r2 * 22) * (0.45 + 0.75 * n) * Math.max(0, 1 - r2 * 4);
    const i = (y * S + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = Math.min(255, a * 255); data[i + 3] = 255;
  }
  PUFF = new THREE.DataTexture(data, S, S);
  PUFF.colorSpace = THREE.NoColorSpace;
  PUFF.magFilter = PUFF.minFilter = THREE.LinearFilter;
  PUFF.needsUpdate = true;
  return PUFF;
}

const VERT = /* glsl */`
attribute vec3 iPos;
attribute vec4 iColor;
attribute vec2 iSizeRot;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vUv = position.xy + 0.5;
  vColor = iColor;
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  float c = cos(iSizeRot.y), s = sin(iSizeRot.y);
  vec2 q = mat2(c, s, -s, c) * position.xy * iSizeRot.x;
  mv.xy += q;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
uniform sampler2D uTex;
uniform float uSoft;
uniform float uShade;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  float r = length(vUv - 0.5);
  float a = texture2D(uTex, vUv).r;
  a = mix(a, smoothstep(0.5, 0.0, r), uSoft);
  // lit from above: the underside of a puff sits in its own shadow
  float shade = mix(1.0, 0.86 + 0.22 * vUv.y, (1.0 - uSoft) * uShade);
  vec4 col = vec4(vColor.rgb * shade, vColor.a * a);
  if (col.a < 0.002) discard;
  gl_FragColor = col;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Particles {
  /**
   * @param max      pool size
   * @param additive true for fire/sparks/plasma, false for smoke/dust
   * @param soft     0 = lumpy puff texture, 1 = plain round glow (sparks)
   */
  constructor(max, { additive = false, soft = 0, renderOrder = 10 } = {}) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.size = new Float32Array(max * 2);       // start, end
    this.c0 = new Float32Array(max * 4);
    this.c1 = new Float32Array(max * 4);
    this.phys = new Float32Array(max * 4);       // drag, gravity, rot, spin
    this.fade = new Float32Array(max * 2);       // fade-in fraction, fade-out start fraction

    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSR = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iColor', this.aCol);
    geo.setAttribute('iSizeRot', this.aSR);
    geo.instanceCount = 0;
    this.geometry = geo;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: puffTexture() }, uSoft: { value: soft }, uShade: { value: additive ? 0 : 1 } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  /** Spawn one particle. Colours are [r, g, b, a]; rgb may exceed 1 (HDR). */
  spawn(o) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos.set([o.x, o.y, o.z], i * 3);
    this.vel.set([o.vx || 0, o.vy || 0, o.vz || 0], i * 3);
    this.age[i] = 0;
    this.life[i] = o.life;
    this.size[i * 2] = o.size0; this.size[i * 2 + 1] = o.size1 ?? o.size0;
    this.c0.set(o.c0, i * 4); this.c1.set(o.c1 ?? o.c0, i * 4);
    this.phys.set([o.drag || 0, o.grav || 0, o.rot ?? Math.random() * 6.283, o.spin || 0], i * 4);
    this.fade[i * 2] = o.fadeIn ?? 0.08; this.fade[i * 2 + 1] = o.fadeOut ?? 0.6;
  }

  clear() { this.n = 0; this.geometry.instanceCount = 0; }

  /** Advance by dt. `wind` (optional Vector3) is added to every position. */
  update(dt, wind) {
    const P = this.pos, V = this.vel;
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const a = this.age[i] + dt;
      if (a >= this.life[i]) continue;               // dead: compacted away below
      const drag = Math.exp(-this.phys[i * 4] * dt), g = this.phys[i * 4 + 1];
      let vx = V[i * 3] * drag, vy = V[i * 3 + 1] * drag - g * dt, vz = V[i * 3 + 2] * drag;
      let x = P[i * 3] + vx * dt, y = P[i * 3 + 1] + vy * dt, z = P[i * 3 + 2] + vz * dt;
      if (wind) { x += wind.x * dt; y += wind.y * dt; z += wind.z * dt; }
      if (w !== i) {
        this.age[w] = a; this.life[w] = this.life[i];
        this.size[w * 2] = this.size[i * 2]; this.size[w * 2 + 1] = this.size[i * 2 + 1];
        for (let k = 0; k < 4; k++) {
          this.c0[w * 4 + k] = this.c0[i * 4 + k]; this.c1[w * 4 + k] = this.c1[i * 4 + k];
          this.phys[w * 4 + k] = this.phys[i * 4 + k];
        }
        this.fade[w * 2] = this.fade[i * 2]; this.fade[w * 2 + 1] = this.fade[i * 2 + 1];
      } else this.age[w] = a;
      P[w * 3] = x; P[w * 3 + 1] = y; P[w * 3 + 2] = z;
      V[w * 3] = vx; V[w * 3 + 1] = vy; V[w * 3 + 2] = vz;
      this.phys[w * 4 + 2] += this.phys[w * 4 + 3] * dt;
      w++;
    }
    this.n = w;
    this._write();
  }

  _write() {
    const ap = this.aPos.array, ac = this.aCol.array, as = this.aSR.array;
    for (let i = 0; i < this.n; i++) {
      const t = this.age[i] / this.life[i];
      const fi = this.fade[i * 2], fo = this.fade[i * 2 + 1];
      const env = Math.min(1, t / Math.max(fi, 1e-3)) * (t > fo ? Math.max(0, 1 - (t - fo) / (1 - fo)) : 1);
      ap[i * 3] = this.pos[i * 3]; ap[i * 3 + 1] = this.pos[i * 3 + 1]; ap[i * 3 + 2] = this.pos[i * 3 + 2];
      for (let k = 0; k < 4; k++) ac[i * 4 + k] = this.c0[i * 4 + k] + (this.c1[i * 4 + k] - this.c0[i * 4 + k]) * t;
      ac[i * 4 + 3] *= env;
      // sizes grow fast then settle, like a real expanding puff
      const st = 1 - (1 - t) * (1 - t);
      as[i * 2] = this.size[i * 2] + (this.size[i * 2 + 1] - this.size[i * 2]) * st;
      as[i * 2 + 1] = this.phys[i * 4 + 2];
    }
    this.geometry.instanceCount = this.n;
    for (const a of [this.aPos, this.aCol, this.aSR]) {
      a.needsUpdate = true;
      a.clearUpdateRanges?.();
      a.addUpdateRange(0, this.n * a.itemSize);
    }
  }
}

/** Ballistic chunks (hull fragments, rocks) that bounce on a height function. */
export class Debris {
  constructor(geometry, material, max) {
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.items = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler();
    this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
  }
  spawn(o) { if (this.items.length < this.mesh.instanceMatrix.count) this.items.push({ ...o, rx: 0, ry: 0, rz: 0, rest: false }); }
  clear() { this.items.length = 0; this.mesh.count = 0; }
  update(dt, ground, g = 3.721) {
    let i = 0;
    for (const it of this.items) {
      if (!it.rest) {
        it.vy -= g * dt;
        it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
        it.rx += it.wx * dt; it.ry += it.wy * dt; it.rz += it.wz * dt;
        if (ground) {
          const gy = ground(it.x, it.z) + it.s * 0.3;
          if (it.y < gy) {
            it.y = gy;
            if (Math.abs(it.vy) < 1.2) { it.rest = true; it.vx = it.vz = it.vy = 0; }
            else { it.vy *= -0.32; it.vx *= 0.55; it.vz *= 0.55; it.wx *= 0.5; it.wz *= 0.5; }
          }
        }
      }
      this._p.set(it.x, it.y, it.z);
      this._q.setFromEuler(this._e.set(it.rx, it.ry, it.rz));
      this._s.set(it.s * (it.sx || 1), it.s * (it.sy || 1), it.s * (it.sz || 1));
      this.mesh.setMatrixAt(i++, this._m.compose(this._p, this._q, this._s));
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
