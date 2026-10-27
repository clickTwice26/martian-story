import * as THREE from 'three';
import { bakeEquirect, MARS_SURFACE, EARTH_SURFACE, JUPITER_SURFACE, GALAXY_SKY, floatTargetType } from './bake.js';
import { makeBackground, makeStars, makePlanet, makeMoon, makeSun, makeOrbit } from './space.js';
import { CinePost } from './post.js';
import { Particles, Debris } from './particles.js';
import { Ship, buildWreck } from './ship.js';
import { Score, CHORDS } from './score.js';

/**
 * The opening: a courier ship, the support unit at its helm, the last day of
 * an eight-month run to Mars - and the crash at Jezero that the game begins
 * beside.
 *
 *   0   black, mission text
 *   6   act I   - the solar system, title
 *  22   act II  - the Kestrel and its pilot; Mars; the debris strike; entry
 *  68   act III - over the real Jezero DTM: the fireball, the crash, the
 *                 smoke, and the pilot getting back up
 * 100   control handed to the player, standing by the wreck
 *
 * Acts I and II render their own scenes through the HDR post chain. Act III
 * is drawn by the game's own renderer on the real terrain, so the wreck it
 * leaves behind is simply part of the world from then on.
 *
 * Timing is driven by intro time advanced per frame, so any moment can be
 * re-created exactly (seek); frames are capped at 0.25 s so a hitch cannot
 * jump a scene, while slow machines still stay in sync with the score.
 */

export const INTRO_LMST = 17.25;        // golden hour at Jezero: sun ~20 deg up in the west
const END = 100;
const T = { solar: 6, ship: 22, cockpit: 29.5, mars: 38, strike: 50, entry: 58, sky: 68, impact: 77, slide: 79.2, after: 84 };

const clamp01 = x => Math.max(0, Math.min(1, x));
const smooth = x => { x = clamp01(x); return x * x * (3 - 2 * x); };
const easeInOut = x => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const lerp = (a, b, t) => a + (b - a) * t;
const UP = new THREE.Vector3(0, 1, 0);

/** Smooth handheld / impact shake, deterministic in time. */
function shake(t, amp, out) {
  return out.set(
    Math.sin(t * 13.1) * 0.6 + Math.sin(t * 29.7 + 1.3) * 0.4,
    Math.sin(t * 11.3 + 2.1) * 0.6 + Math.sin(t * 31.9) * 0.4,
    Math.sin(t * 17.9 + 0.7) * 0.5 + Math.sin(t * 23.3 + 2.9) * 0.5).multiplyScalar(amp);
}
function ll(latDeg, lonDeg) {
  const la = THREE.MathUtils.degToRad(latDeg), lo = THREE.MathUtils.degToRad(lonDeg);
  return new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo));
}

/* ======================================================= crash layout ===== */
/**
 * Where everything lands, relative to where the player starts. The fireball
 * comes out of the low western sun, over the player's head, and comes to rest
 * ~50 m ahead of them - in view the moment control is handed over.
 */
export function crashLayout(spawn, yaw) {
  const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const h = f.clone().applyAxisAngle(UP, -0.26).normalize();         // direction of travel
  const side = new THREE.Vector3(h.z, 0, -h.x);                       // right of travel
  const W = new THREE.Vector3(spawn.x, 0, spawn.z).addScaledVector(f, 52).addScaledVector(r, -8);
  const I = W.clone().addScaledVector(h, -34);                        // first contact
  const robot = W.clone().addScaledVector(f, -9).addScaledVector(r, 1.5);
  return { f, r, h, side, W, I, robot, spawn: new THREE.Vector3(spawn.x, 0, spawn.z), yaw };
}

/* ========================================================= wreck site ===== */
/** The Kestrel where it came to rest, smoking. Lives on after the intro. */
export class WreckSite {
  constructor(scene, hf, layout) {
    this.hf = hf;
    this.layout = layout;
    const w = buildWreck((x, z) => hf.heightAt(x, z), layout.W, layout.h);
    this.wreck = w;
    this.group = new THREE.Group();
    this.group.add(w.group, w.wing, w.pieces);
    scene.add(this.group);
    this.smoke = new Particles(700, { additive: false, renderOrder: 12 });
    this.fire = new Particles(260, { additive: true, renderOrder: 13 });
    this.embers = new Particles(220, { additive: true, soft: 1, renderOrder: 14 });
    scene.add(this.smoke.mesh, this.fire.mesh, this.embers.mesh);
    this.wind = new THREE.Vector3(1.6, 0, 0.5);         // a light westerly
    this.age = 0;
    this._acc = { smoke: 0, fire: 0, ember: 0 };
    this._v = new THREE.Vector3();
    // the broken port engine and the cockpit are where it burns
    this.sources = [new THREE.Vector3(-1.75, 0.2, 5.6), new THREE.Vector3(0, 0.6, -2.5), new THREE.Vector3(1.6, 0.3, 1.0)];
    this.visible = true;
  }
  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
    for (const p of [this.smoke, this.fire, this.embers]) p.mesh.visible = v;
  }
  /** Warm the smoke column up so a skipped intro does not show it starting. */
  prewarm(seconds) { for (let t = 0; t < seconds; t += 1 / 15) this.update(1 / 15); }

  update(dt) {
    if (!this.visible) return;
    this.age += dt;
    // burns hard at first, then settles into a long smoulder
    const heat = Math.max(0.22, 1 - this.age / 420);
    const root = this.wreck.group.children[0];
    root.updateWorldMatrix(true, false);
    const a = this._acc;
    a.smoke += dt * 6.5 * (0.5 + heat); a.fire += dt * 18 * heat; a.ember += dt * 9 * heat;
    while (a.smoke >= 1) {
      a.smoke -= 1;
      const s = this.sources[Math.random() < 0.6 ? 0 : (Math.random() < 0.5 ? 1 : 2)];
      this._v.copy(s).applyMatrix4(root.matrixWorld);
      const g = 0.09 + Math.random() * 0.05;
      this.smoke.spawn({ x: this._v.x, y: this._v.y, z: this._v.z,
        vx: (Math.random() - 0.5) * 0.6, vy: 1.8 + Math.random() * 1.2, vz: (Math.random() - 0.5) * 0.6,
        life: 15 + Math.random() * 8, size0: 1.2, size1: 13 + Math.random() * 8, drag: 0.08,
        c0: [g, g * 0.92, g * 0.85, 0.5], c1: [0.42, 0.33, 0.25, 0.0], fadeIn: 0.04, fadeOut: 0.35, spin: (Math.random() - 0.5) * 0.3 });
    }
    while (a.fire >= 1) {
      a.fire -= 1;
      const s = this.sources[Math.random() < 0.75 ? 0 : 1];
      this._v.copy(s).applyMatrix4(root.matrixWorld);
      this.fire.spawn({ x: this._v.x + (Math.random() - 0.5) * 0.8, y: this._v.y, z: this._v.z + (Math.random() - 0.5) * 0.8,
        vy: 1.5 + Math.random(), life: 0.45 + Math.random() * 0.3, size0: 1.3 * heat + 0.3, size1: 0.3,
        c0: [3.2, 1.3, 0.35, 0.8], c1: [1.0, 0.25, 0.05, 0.0], fadeIn: 0.1, fadeOut: 0.3 });
    }
    while (a.ember >= 1) {
      a.ember -= 1;
      this._v.copy(this.sources[0]).applyMatrix4(root.matrixWorld);
      this.embers.spawn({ x: this._v.x, y: this._v.y, z: this._v.z,
        vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3, vz: (Math.random() - 0.5) * 2,
        life: 1.2 + Math.random(), size0: 0.09, size1: 0.03, grav: 3.721 * 0.5, drag: 0.4,
        c0: [5, 2.2, 0.6, 1], c1: [2, 0.5, 0.1, 0], fadeIn: 0.02, fadeOut: 0.5 });
    }
    this.smoke.update(dt, this.wind);
    this.fire.update(dt, this.wind);
    this.embers.update(dt, this.wind);
  }

  /** Keep a walker out of the hull: a capsule along the wreck's length. */
  pushOut(pos, radius = 0.45) {
    const L = this.layout, a = L.W.clone().addScaledVector(L.h, -7.5), b = L.W.clone().addScaledVector(L.h, 7.5);
    const ab = b.sub(a), t = clamp01(((pos.x - a.x) * ab.x + (pos.z - a.z) * ab.z) / (ab.x * ab.x + ab.z * ab.z));
    const cx = a.x + ab.x * t, cz = a.z + ab.z * t;
    let dx = pos.x - cx, dz = pos.z - cz, d = Math.hypot(dx, dz);
    const R = 2.7 + radius;
    if (d >= R) return false;
    if (d < 1e-6) { dx = L.side.x; dz = L.side.z; d = 1; }        // dead on the keel: step out sideways
    pos.x = cx + dx / d * R; pos.z = cz + dz / d * R;
    return true;
  }
}

/* ============================================================== intro ===== */
export class Intro {
  /**
   * @param world  hooks into the game: { renderer, scene, hf, renderWorld(cam),
   *   companion, wreck (WreckSite), layout, gameplayCamera() -> {pos, target},
   *   showPlayer(bool), setHud(bool), audio (SuitAudio), lowQuality, antialias }
   */
  constructor(world) {
    this.w = world;
    this.renderer = world.renderer;
    this.active = false;
    this.done = false;
    this.t = 0;
    this.ui = {};
    for (const id of ['cine', 'cineFade', 'cineFlash', 'cineGrain', 'cineVig', 'cineOpen', 'cineTitle', 'cineSub',
                      'cineWarn', 'cineStamp', 'cineCards', 'cineSkip']) this.ui[id] = document.getElementById(id);
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._sh = new THREE.Vector3();
  }

  /* ------------------------------------------------------------ prepare -- */
  async prepare(status = () => {}) {
    const r = this.renderer, low = !!this.w.lowQuality;
    const y = () => new Promise(res => setTimeout(res, 0));
    const ft = floatTargetType(r);
    status('Rendering the solar system…');
    this.bakes = {
      galaxy: await bakeEquirect(r, low ? 1024 : 2048, low ? 512 : 1024, GALAXY_SKY, { type: ft, yieldFn: y }),
      mars: await bakeEquirect(r, low ? 1024 : 2048, low ? 512 : 1024, MARS_SURFACE, { yieldFn: y }),
      earth: await bakeEquirect(r, 1024, 512, EARTH_SURFACE, { yieldFn: y }),
      jupiter: await bakeEquirect(r, 512, 256, JUPITER_SURFACE, { yieldFn: y }),
    };
    this.tex = Object.fromEntries(Object.entries(this.bakes).map(([k, rt]) => [k, rt.texture]));
    this.post = new CinePost(r, { msaa: !!this.w.antialias });
    this._buildActI();
    status('Fuelling the Kestrel…');
    this._buildActII();
    this.ship = await Ship.build({ envMap: this.env });
    this.nearB.add(this.ship.root);
    this._buildActIII();
    this._buildCues();
    // Compile everything now rather than stalling mid-film - including the
    // ship and effects under the game scene's own lights, where act III draws them.
    try {
      r.compile(this.sceneA, this.camA);
      r.compile(this.farB, this.camB);
      r.compile(this.nearB, this.camB);
      const lights = [this.ship.cockpitLight, this.ship.alarmLight];
      for (const l of lights) this.ship.root.remove(l);
      this.w.scene.add(this.ship.root);
      this.groupC.visible = true;
      const wasVis = this.w.wreck.visible;
      this.w.wreck.setVisible(true);
      r.compile(this.w.scene, this.camC);
      this.w.wreck.setVisible(wasVis);
      this.groupC.visible = false;
      this.nearB.add(this.ship.root);
      for (const l of lights) this.ship.root.add(l);
    } catch (e) { console.warn('intro precompile', e); }
  }

  _buildActI() {
    const s = this.sceneA = new THREE.Scene();
    this.camA = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 4000);
    const bg = makeBackground(this.tex.galaxy); s.add(bg);
    this.starsA = makeStars(); s.add(this.starsA);
    this.sunA = makeSun(4); s.add(this.sunA);
    const solid = (r, g, b) => { const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1); t.needsUpdate = true; return t; };
    this.planetsA = [
      { name: 'mercury', orbit: 12, a0: 4.1, w: 0.050, p: makePlanet({ radius: 0.35, map: solid(92, 86, 80) }) },
      { name: 'venus', orbit: 18, a0: 5.3, w: 0.035, p: makePlanet({ radius: 0.8, map: solid(214, 190, 140), atmo: 0x7a6a40 }) },
      { name: 'earth', orbit: 26, a0: 2.55, w: 0.024, p: makePlanet({ radius: 1.0, map: this.tex.earth, atmo: 0x4d8fff, clouds: 1, ocean: 1, night: 1 }) },
      { name: 'mars', orbit: 36, a0: 0.62, w: 0.016, p: makePlanet({ radius: 0.7, map: this.tex.mars, atmo: 0xc0714a, bump: 3 }) },
      { name: 'jupiter', orbit: 58, a0: 1.55, w: 0.008, p: makePlanet({ radius: 3.0, map: this.tex.jupiter, atmo: 0x9a8a70 }) },
    ];
    for (const pl of this.planetsA) {
      s.add(pl.p);
      pl.p.userData.uniforms.uSunPos.value.set(0, 0, 0);
      pl.p.userData.uniforms.uSunCol.value.setRGB(1.0, 0.95, 0.88).multiplyScalar(1.5);
      s.add(makeOrbit(pl.orbit, pl.name === 'mars' ? 0xffa070 : 0x8fb4ff, pl.name === 'mars' ? 0.32 : 0.16));
    }
    this.earthA = this.planetsA[2]; this.marsA = this.planetsA[3];
    // the Kestrel's transfer arc, Earth to Mars, and the ship as a moving spark
    const pts = [];
    for (let i = 0; i <= 160; i++) {
      const u = i / 160, a = lerp(-1.25, 0.86, u), rr = lerp(26, 36, smooth(u));
      pts.push(Math.cos(a) * rr, 0.0, Math.sin(a) * rr);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.arcA = new THREE.Line(g, new THREE.LineDashedMaterial({ color: 0x66ddff, dashSize: 0.6, gapSize: 0.45,
                                transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.arcA.computeLineDistances();
    s.add(this.arcA);
    this.sparkA = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 3.5, 5.0) }));
    s.add(this.sparkA);
    // cards + reticles
    this.cards = {};
    for (const [key, cls, title, body] of [
      ['earth', '', 'Earth', 'Third planet from the Sun. 225 million kilometres behind us now, and getting further every second.'],
      ['mars', 'mars', 'Mars', 'Fourth planet. Thin CO₂ air, 38% gravity. Destination: Jezero Crater, an ancient lake bed at 18.4° N.'],
    ]) {
      const card = document.createElement('div'); card.className = 'ccard ' + cls;
      card.innerHTML = `<h3>${title}</h3><p>${body}</p>`;
      const ret = document.createElement('div'); ret.className = 'creticle';
      this.ui.cineCards.append(card, ret);
      this.cards[key] = { card, ret };
    }
  }

  _buildActII() {
    this.camB = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.05, 6e4);
    this.camBfar = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 800, 2e8);
    // sun to the side and a little behind: Mars reads gibbous, terrain lit raking
    this.sunDirB = new THREE.Vector3(0.80, 0.30, -0.20).normalize();
    const far = this.farB = new THREE.Scene();
    this.bgB = makeBackground(this.tex.galaxy);
    this.bgB.material.uniforms.uSunDisc.value = 1;
    this.bgB.material.uniforms.uSunDir.value.copy(this.sunDirB);
    far.add(this.bgB);
    this.starsB = makeStars(); far.add(this.starsB);
    this.R = 3389500;
    this.mars = makePlanet({ radius: this.R, map: this.tex.mars, atmo: 0xd9845a, atmoScale: 1.03, bump: 5, segments: 160 });
    this.mars.userData.uniforms.uSunPos.value.copy(this.sunDirB).multiplyScalar(1e11);
    this.mars.userData.uniforms.uSunCol.value.setRGB(1.0, 0.95, 0.88).multiplyScalar(1.7);
    far.add(this.mars);
    this.phobos = makeMoon(22000);
    far.add(this.phobos);
    const farSun = new THREE.DirectionalLight(0xfff1e0, 3.2);
    farSun.position.copy(this.sunDirB);
    far.add(farSun, new THREE.HemisphereLight(0x223355, 0x110805, 0.05));
    // orientations: Valles Marineris toward the approach, Jezero under the entry
    this.qValles = new THREE.Quaternion();
    this.qJezero = new THREE.Quaternion().setFromUnitVectors(ll(18.44, 77.45), UP);

    const near = this.nearB = new THREE.Scene();
    const sun = new THREE.DirectionalLight(0xfff1e0, 3.4);
    sun.position.copy(this.sunDirB).multiplyScalar(100);
    this.marsBounce = new THREE.DirectionalLight(0xff8a50, 0.0);
    near.add(sun, this.marsBounce, new THREE.HemisphereLight(0x5a6c9a, 0x1a0d08, 0.12));
    this.fireB = new Particles(900, { additive: true, renderOrder: 20 });
    this.smokeB = new Particles(700, { additive: false, renderOrder: 19 });
    this.sparksB = new Particles(500, { additive: true, soft: 1, renderOrder: 21 });
    this.dustB = new Particles(300, { additive: true, soft: 1, renderOrder: 18 });
    near.add(this.fireB.mesh, this.smokeB.mesh, this.sparksB.mesh, this.dustB.mesh);
    const rockGeo = new THREE.IcosahedronGeometry(1, 1);
    this.rocksB = new Debris(rockGeo, new THREE.MeshStandardMaterial({ color: 0x4a3c34, roughness: 1, flatShading: true }), 24);
    near.add(this.rocksB.mesh);

    // reflections: the galaxy and the sun, prefiltered once
    const envScene = new THREE.Scene();
    const envBg = makeBackground(this.tex.galaxy);
    envBg.material.uniforms.uSunDisc.value = 1;
    envBg.material.uniforms.uSunDir.value.copy(this.sunDirB);
    envBg.material.uniforms.uGain.value = 3;
    envScene.add(envBg);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.env = pm.fromScene(envScene, 0, 0.1, 100).texture;
    pm.dispose();
  }

  _buildActIII() {
    const scene = this.w.scene;
    this.camC = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.18, 60000);
    this.trailFire = new Particles(500, { additive: true, renderOrder: 16 });
    this.trailSmoke = new Particles(1300, { additive: false, renderOrder: 15 });
    this.dustC = new Particles(900, { additive: false, renderOrder: 14 });
    this.flashC = new Particles(160, { additive: true, renderOrder: 17 });
    this.debrisC = new Debris(new THREE.BoxGeometry(1, 0.15, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x55504a, roughness: 0.8, metalness: 0.3 }), 60);
    this.shock = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64),
      new THREE.MeshBasicMaterial({ color: 0xc9a27e, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    this.shock.rotation.x = -Math.PI / 2;
    this.groupC = new THREE.Group();
    this.groupC.add(this.trailFire.mesh, this.trailSmoke.mesh, this.dustC.mesh, this.flashC.mesh, this.debrisC.mesh, this.shock);
    this.groupC.visible = false;
    scene.add(this.groupC);
    // the flight path: out of the western sun, over the player, into the ground
    const L = this.w.layout, hf = this.w.hf;
    const I = L.I.clone(); I.y = hf.heightAt(I.x, I.z) + 1.6;
    this.pathC = {
      p0: I.clone().addScaledVector(L.h, -3600).setY(I.y + 1500),
      p1: I.clone().addScaledVector(L.h, -1100).setY(I.y + 260),
      p2: I,
    };
    const W = L.W.clone(); W.y = hf.heightAt(W.x, W.z) + 0.4;
    this.slideEnd = W;
    this.camCpos = L.spawn.clone().addScaledVector(L.f, -22).addScaledVector(L.r, 24);
    this.camCpos.y = hf.heightAt(this.camCpos.x, this.camCpos.z) + 1.7;
    this.camCwide = L.I.clone().addScaledVector(L.h, -1500).addScaledVector(L.side, 900);
    this.camCwide.y = hf.heightAt(this.camCwide.x, this.camCwide.z) + 3;
  }

  /* --------------------------------------------------------------- cues -- */
  _buildCues() {
    const c = [];
    const at = (t, fn) => c.push([t, fn]);
    const sub = (t, who, text, dur = 4.5) => {
      at(t, () => this._sub(who, text));
      at(t + dur, () => this._sub(null));
    };
    const open = this.ui.cineOpen.children;
    // A transmission draws itself out of the dark, then the dark opens like an iris.
    at(0.0, () => { this.score?.drone(true, { level: 0.06 }); this.score?.chord(CHORDS.Dm9, { attack: 5, hold: 6, level: 0.035, bright: 700 }); });
    at(0.3, () => this.ui.cineOpen.classList.add('line'));
    at(0.9, () => this._type(open[0], 'INTERPLANETARY COURIER  KESTREL'));
    at(2.5, () => this._type(open[1], 'DAY 212 OF 214  ·  EARTH → MARS TRANSFER'));
    at(4.1, () => this._type(open[2], 'CREW 1, IN HIBERNATION  ·  AT THE HELM: SUPPORT UNIT K-7'));
    at(5.0, () => this.score?.swell(2.4));
    at(5.6, () => {
      this.ui.cineOpen.classList.add('out');
      this.ui.cineFade.classList.add('iris');
      this._fadeTo(0, 3.6);
      this.score?.bells(true);
    });
    at(7.3, () => { this.ui.cineTitle.classList.add('show'); this.score?.braam(); });
    at(9.4, () => { this.ui.cineFade.classList.remove('iris'); this.ui.cineOpen.classList.remove('line', 'out'); this.ui.cineOpen.style.opacity = 0; });
    at(8.0, () => this.score?.chord(CHORDS.Bbmaj7, { attack: 4, hold: 6, level: 0.04 }));
    at(13.6, () => this.ui.cineTitle.classList.remove('show'));
    at(12.2, () => this._card('earth', true)); at(16.4, () => this._card('earth', false));
    at(16.0, () => { this._card('mars', true); this.score?.chord(CHORDS.Fmaj7A, { attack: 3, hold: 6, level: 0.04 }); });
    at(21.0, () => { this._card('mars', false); this._fadeTo(1, 1.0); });

    at(22.0, () => { this._fadeTo(0, 1.6); this._type(this.ui.cineStamp, 'KESTREL  ·  MARS APPROACH\nORBIT INSERTION  T−04:12'); });
    at(24.0, () => this.score?.chord(CHORDS.Csus2, { attack: 3.5, hold: 6, level: 0.04 }));
    at(28.5, () => { this.ui.cineStamp.textContent = ''; });
    sub(30.6, 'K-7', 'Kestrel to Commander. Mars orbit insertion in four minutes.', 3.6);
    sub(34.4, 'K-7', 'You should see this. Even from here, it is… beautiful.', 3.4);
    at(32.0, () => this.score?.chord(CHORDS.Gm9, { attack: 4, hold: 5, level: 0.04 }));
    at(38.0, () => this.score?.chord(CHORDS.Dm9, { attack: 5, hold: 8, level: 0.05, bright: 1300 }));
    sub(42.6, 'K-7', 'Beginning the aerobraking pass. Jezero landing window opens in eleven minutes.', 4.6);
    at(47.5, () => { this.score?.bells(false); this.score?.ostinato(true, 88); });

    at(50.9, () => this._spawnRocks());
    at(51.5, () => this._strike());
    at(52.0, () => { this._warn('⚠  HULL BREACH  ·  PORT ENGINE FAILURE'); this.score?.alarm(true); });
    sub(53.3, 'K-7', 'Impact! We have lost the port engine — rerouting power—', 3.0);
    sub(56.7, 'K-7', 'Too steep. I can’t hold her!', 2.6);
    at(58.0, () => { this.score?.rumble(10.5); this._warn('⚠  ENTRY CORRIDOR EXCEEDED  ·  HEAT SHIELD 31%'); });
    sub(63.6, 'K-7', 'Brace! Brace! Brace!', 2.6);
    at(66.8, () => { this.score?.alarm(false); this.score?.ostinato(false); this._warn(null); });
    at(67.0, () => this._tween(this.ui.cineFlash, 'opacity', 0, 1, 1.0));

    at(68.0, () => { this._tween(this.ui.cineFlash, 'opacity', 1, 0, 1.4); this._enterActIII(); });
    at(70.0, () => this._type(this.ui.cineStamp, 'JEZERO CRATER  ·  MARS\nLOCAL TIME 17:15'));
    at(72.5, () => this.score?.whoosh(4.8));
    at(76.0, () => { this.ui.cineStamp.textContent = ''; });
    at(T.impact, () => this._impact());
    at(T.slide, () => this._toWreck());
    at(T.after, () => { this._fadeFrom(0.9); this.score?.chord(CHORDS.Dm9, { attack: 6, hold: 7, level: 0.035, bright: 600 }); });
    at(84.8, () => { this.ui.cineTitle.querySelector('h1').textContent = 'SOL 1980';
      this.ui.cineTitle.querySelector('h2').textContent = 'JEZERO CRATER  ·  18.44° N  77.45° E';
      this.ui.cineTitle.classList.add('show'); });
    at(88.6, () => this.ui.cineTitle.classList.remove('show'));
    at(90.4, () => this._robot('Standing'));
    sub(91.2, 'K-7', '…Systems online. Kestrel is gone.', 3.0);
    at(92.6, () => this.score?.chord(CHORDS.Asus4, { attack: 2.5, hold: 3, level: 0.04 }));
    sub(94.4, 'K-7', 'Commander? Commander — do you read me?', 2.8);
    at(95.2, () => this._robot('Wave'));
    at(96.0, () => { this.w.showPlayer(true); this.score?.chord(CHORDS.Dmaj, { attack: 3, hold: 5, level: 0.05, bright: 1600 }); });
    sub(97.4, 'K-7', 'There you are. Perseverance’s tracks are close. Let’s move.', 3.0);
    at(98.4, () => { this.ui.cine.classList.remove('bars'); });
    c.sort((a, b) => a[0] - b[0]);
    this.cues = c;
  }

  /* ----------------------------------------------------------------- UI -- */
  _type(el, text, cps = 34) {
    // earlier lines of the same block step back as a new one types
    if (el.parentElement === this.ui.cineOpen)
      for (const sib of el.parentElement.children) if (sib !== el && sib.textContent) sib.classList.add('dim');
    this.typers.push({ el, text, t0: this.t, cps, n: 0 });
    el.textContent = ''; el.style.opacity = 1;
    el.classList.remove('dim'); el.classList.add('typing');
  }
  _sub(who, text) {
    const s = this.ui.cineSub;
    if (!who) { s.classList.remove('show'); return; }
    s.querySelector('b').textContent = who;
    s.querySelector('span').textContent = text;
    s.classList.add('show');
    if (this.w.audio?.beep) this.w.audio.beep('ok');
  }
  _warn(text) {
    const el = this.ui.cineWarn;
    if (!text) { el.classList.remove('show'); el.style.opacity = 0; return; }
    el.textContent = text; el.classList.add('show');
  }
  _card(key, on) { const c = this.cards[key]; c.card.classList.toggle('show', on); c.ret.classList.toggle('show', on); }
  _tween(el, prop, from, to, dur) { this.tweens.push({ el, prop, from, to, t0: this.t, dur }); }
  _fadeTo(to, dur) { this._tween(this.ui.cineFade, 'opacity', +getComputedStyle(this.ui.cineFade).opacity, to, dur); }
  _fadeFrom(dur) { this.ui.cineFade.style.opacity = 1; this._tween(this.ui.cineFade, 'opacity', 1, 0, dur); }

  _uiUpdate() {
    for (const ty of this.typers) {
      const n = Math.min(ty.text.length, Math.floor((this.t - ty.t0) * ty.cps));
      if (n !== ty.n) {
        ty.n = n;
        ty.el.textContent = ty.text.slice(0, n);
        if (ty.text[n - 1] && ty.text[n - 1] !== ' ') this.score?.tick();
      }
    }
    for (const ty of this.typers) if (ty.n >= ty.text.length) ty.el.classList.remove('typing');
    this.typers = this.typers.filter(ty => ty.n < ty.text.length);
    for (const tw of this.tweens) {
      const k = clamp01((this.t - tw.t0) / tw.dur);
      tw.el.style[tw.prop] = lerp(tw.from, tw.to, smooth(k));
    }
    this.tweens = this.tweens.filter(tw => this.t - tw.t0 < tw.dur);
  }

  _placeCard(key, obj, cam, dx, dy) {
    const c = this.cards[key];
    if (!c.card.classList.contains('show')) return;
    obj.getWorldPosition(this._v).project(cam);
    const x = (this._v.x * 0.5 + 0.5) * innerWidth, yv = (-this._v.y * 0.5 + 0.5) * innerHeight;
    c.ret.style.left = x + 'px'; c.ret.style.top = yv + 'px';
    const cx = Math.min(innerWidth - 320, Math.max(16, x + dx)), cy = Math.min(innerHeight * 0.89 - 200, Math.max(innerHeight * 0.11 + 12, yv + dy));
    c.card.style.left = cx + 'px'; c.card.style.top = cy + 'px';
  }

  /* -------------------------------------------------------------- start -- */
  start() {
    this.active = true; this.done = false; this.t = 0;
    this.typers = []; this.tweens = []; this._cue = 0; this._skipHold = 0; this._skipping = false;
    const ui = this.ui;
    ui.cine.classList.remove('off');
    requestAnimationFrame(() => ui.cine.classList.add('bars'));
    ui.cineFade.style.opacity = 1; ui.cineFlash.style.opacity = 0;
    ui.cineGrain.style.opacity = 0; ui.cineVig.style.opacity = 0;
    ui.cineOpen.style.opacity = 1;
    ui.cineOpen.classList.remove('line', 'out');
    ui.cineFade.classList.remove('iris');
    for (const d of ui.cineOpen.children) { d.textContent = ''; d.classList.remove('dim', 'typing'); }
    ui.cineTitle.querySelector('h1').textContent = 'MARTIAN STORY';
    ui.cineTitle.querySelector('h2').innerHTML = 'PART ONE &nbsp;·&nbsp; THE LAST APPROACH';
    this.w.setHud(false);
    this.w.showPlayer(false);
    this.w.wreck.setVisible(false);
    this.w.companion.root.visible = false;
    if (!ui.cineGrain.style.backgroundImage) ui.cineGrain.style.backgroundImage = `url(${grainDataURL()})`;
    const a = this.w.audio;
    if (a && a.ctx) {
      this.score = new Score(a.ctx, a.master);
      this._bedLevels = { fan: a.fanGain?.gain.value, wind: a.windGain?.gain.value };
      if (a.fanGain) a.fanGain.gain.value = 0;
      if (a.windGain) a.windGain.gain.value = 0;
    }
    this._onKey = e => {
      if (!this.active) return;
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); this._holding = e.type === 'keydown'; }
    };
    addEventListener('keydown', this._onKey, true);
    addEventListener('keyup', this._onKey, true);
    this._onSkipClick = () => this.skip();
    ui.cineSkip.addEventListener('click', this._onSkipClick);
  }

  skip() {
    if (!this.active || this._skipping) return;
    this._skipping = true;
    this._skipT = this.t;
    this.ui.cineFade.classList.remove('iris');      // the iris mask would hide the fade
    this._fadeTo(1, 0.6);
    this.score?.stop(0.8);
  }

  /* ------------------------------------------------------------- update -- */
  update(rawDt) {
    if (!this.active) return;
    // Real time, so the film stays in step with its (real-time) score even on a
    // slow GPU; capped so a single long hitch cannot skip a beat of the story.
    const dt = Math.min(rawDt, 0.25);
    this.t += dt;
    const t = this.t;
    while (this._cue < this.cues.length && this.cues[this._cue][0] <= t) this.cues[this._cue++][1]();
    this._uiUpdate();

    // hold to skip
    this._skipHold = this._holding ? this._skipHold + dt : Math.max(0, this._skipHold - dt * 2);
    this.ui.cineSkip.style.setProperty('--p', Math.min(100, this._skipHold / 0.9 * 100) + '%');
    if (this._skipHold >= 0.9) this.skip();
    if (this._skipping && t - this._skipT > 0.7) { this.finish(true); return; }

    if (t < T.solar - 1) this._renderBlack();
    else if (t < T.ship) this._actI(t, dt);
    else if (t < T.sky) this._actII(t, dt);
    else this._actIII(t, dt);
    if (t >= END) this.finish(false);
  }

  _renderBlack() {
    if (this._noRender) return;
    const r = this.renderer;
    r.setRenderTarget(null);
    r.setClearColor(0x000000, 1);
    r.clear();
  }

  /* ------------------------------------------------- act I: the system -- */
  _actI(t, dt) {
    const cam = this.camA;
    cam.aspect = innerWidth / innerHeight;
    const u = clamp01((t - (T.solar - 1)) / (T.ship - T.solar + 1));
    for (const pl of this.planetsA) {
      const a = pl.a0 + pl.w * (t - T.solar);
      pl.p.position.set(Math.cos(a) * pl.orbit, 0, Math.sin(a) * pl.orbit);
      pl.p.userData.body.rotation.y = t * 0.15;
      pl.p.userData.uniforms.uCloudShift.value = t * 0.002;
    }
    // the spark rides the arc toward Mars
    const k = lerp(0.70, 0.97, u);
    const arr = this.arcA.geometry.attributes.position;
    const i = Math.floor(k * (arr.count - 1));
    this.sparkA.position.fromBufferAttribute(arr, i);
    this.sparkA.scale.setScalar(0.8 + 0.4 * Math.sin(t * 6));
    // crane down from above the ecliptic toward Mars' orbit
    const e = easeInOut(u);
    const marsP = this.marsA.p.position;
    cam.position.set(lerp(-34, marsP.x + 9, e), lerp(64, 2.6, e), lerp(96, marsP.z + 14, e));
    // open with the sun low in frame, under the title; end on Mars
    this._v.set(6, 15, 4).lerp(marsP, smooth((u - 0.30) / 0.70));
    cam.lookAt(this._v);
    cam.fov = lerp(42, 34, e);
    cam.updateProjectionMatrix();
    this.starsA.material.uniforms.uTime.value = t;
    this.starsA.material.uniforms.uPx.value = this.renderer.getPixelRatio();
    this.sunA.userData.core.material.uniforms.uTime.value = t;
    this._placeCard('earth', this.earthA.p, cam, 60, -150);
    this._placeCard('mars', this.marsA.p, cam, 70, -170);
    this._sunFlare(this._v2.set(0, 0, 0), cam, 1.0, []);
    const cu = this.post.composite.uniforms;
    cu.uExposure.value = 1.05; cu.uBloomStrength.value = 0.9; cu.uTint.value.set(1, 1, 1);
    cu.uTime.value = t; cu.uGrain.value = 0.03; cu.uVignette.value = 0.6;
    if (!this._noRender) this.post.render([{ scene: this.sceneA, camera: cam }]);
  }

  /* -------------------------------------------- act II: ship and planet -- */
  _actII(t, dt) {
    const ship = this.ship, R = this.R;
    const cam = this.camB;
    cam.aspect = innerWidth / innerHeight;
    ship.update(dt);
    // where Mars is, relative to the ship (which stays at the origin)
    const mc = this.mars.position;
    if (t < T.mars) {
      mc.set(0.25, -0.08, -1).normalize().multiplyScalar(lerp(3.2e7, 2.6e7, (t - T.ship) / (T.mars - T.ship)));
      this._orientMars(this.qValles, ll(-8, -68));
    } else if (t < T.strike) {
      const u = (t - T.mars) / (T.strike - T.mars);
      mc.set(0.08, -0.40, -1).normalize().multiplyScalar(lerp(1.35e7, 0.78e7, smooth(u)));
      this._orientMars(this.qValles, ll(-8, -68));
    } else if (t < T.entry) {
      const u = (t - T.strike) / (T.entry - T.strike);
      mc.set(0.0, -0.62, -1).normalize().multiplyScalar(lerp(6.2e6, 4.7e6, u));
      this._orientMars(this.qValles, ll(-8, -68));
    } else {
      const u = (t - T.entry) / (T.sky - T.entry);
      mc.set(0, -(R + lerp(1.28e5, 1.035e5, u)), -lerp(0, 8e4, u));
      this.mars.quaternion.copy(this.qJezero);
    }
    this.mars.userData.body.rotation.y = 0;
    // Phobos crosses the face of Mars during the reveal
    const pu = (t - T.mars) / (T.strike - T.mars);
    this.phobos.position.copy(mc).multiplyScalar(0.06).add(this._v.set(lerp(9e5, -7e5, pu), lerp(1.2e5, -0.5e5, pu), 0));
    this.phobos.rotation.set(t * 0.05, t * 0.11, 0.3);
    this.phobos.visible = t > T.mars && t < T.strike;
    // light bounced off Mars grows as it fills the sky
    const ang = Math.asin(Math.min(1, R / mc.length()));
    this.marsBounce.position.copy(mc).normalize();
    this.marsBounce.intensity = 1.6 * ang;
    this.mars.userData.shell.material.uniforms.uStrength.value = 1.8;

    // ---- shots ----
    const sh = this._sh.set(0, 0, 0);
    ship.root.rotation.set(0, 0, Math.sin(t * 0.4) * 0.04);
    ship.setThrottle(t < T.strike ? 1 : 0.8);
    if (t < T.cockpit) {                                            // the ship, gliding
      const u = (t - T.ship) / (T.cockpit - T.ship), a = lerp(-1.05, 0.55, easeInOut(u));
      const rad = lerp(30, 21, u);
      cam.position.set(Math.sin(a) * rad, lerp(3.5, 6.5, u), Math.cos(a) * rad + 1);
      cam.lookAt(0, 0, -1.5);
      cam.fov = 40;
      this._spaceDust(dt, 1);
    } else if (t < T.mars) {                                        // the pilot
      this._cockpitCam(cam, t, 0.004);
      ship.setExpression('Sad', smooth((t - 34) / 1.5) * 0.35);   // wistful at "beautiful"
    } else if (t < T.strike) {                                      // Mars fills the frame
      const u = smooth((t - T.mars) / (T.strike - T.mars));
      cam.position.set(lerp(2.5, 9, u), lerp(2.6, 8.5, u), lerp(16, 30, u));
      this._v.copy(mc).normalize().multiplyScalar(60).add(this._v2.set(0, 6, 0));
      cam.lookAt(this._v.lerp(this._v2.set(0, 0, -4), 0.35));
      cam.fov = lerp(48, 55, u);
      this._spaceDust(dt, 0.6);
    } else if (t < T.entry) {                                       // the strike
      const hit = t - 51.5;
      const kick = hit > 0 ? Math.exp(-hit * 1.6) : 0;
      ship.root.rotation.z += kick * 0.35 * Math.sin(hit * 9);
      ship.root.rotation.x = kick * -0.12;
      ship.setDamage(hit > 0 ? Math.min(1, 0.6 + hit * 0.15) : 0);
      if (t < 53) {
        cam.position.set(13, 2.2, -17);
        cam.lookAt(0, 0, -1);
        cam.fov = 44;
      } else if (t < 56.5) {
        this._cockpitCam(cam, t, 0.02 + kick * 0.05);
        ship.setExpression('Surprised', 1);
      } else {
        cam.position.set(-6, 3.5, 24);
        cam.lookAt(0, 0, -2);
        cam.fov = 46;
      }
      shake(t, 0.05 + kick * 0.9, sh);
      this._emitDamage(dt, 1);
      if (hit > 0) this.post.composite.uniforms.uTint.value.set(1 + 0.25 * (Math.sin(t * 6.5) > 0 ? 1 : 0), 0.92, 0.9);
    } else {                                                        // atmospheric entry
      const u = (t - T.entry) / (T.sky - T.entry);
      ship.setDamage(1);
      ship.setHeat(smooth(u * 1.6));
      ship.setExpression('Surprised', 1);
      ship.root.rotation.set(-0.32 - 0.1 * u, 0, 0.25 * Math.sin(t * 1.3) + 0.15);
      if (t < 63.5) {
        cam.position.set(0, 7, 27);
        cam.lookAt(0, -3, -6);
        cam.fov = 50;
      } else {
        cam.position.set(18, -2, 6);
        cam.lookAt(0, 0, -3);
        cam.fov = 52;
      }
      shake(t, 0.18 + 0.55 * u, sh);
      this._emitDamage(dt, 1);
      this._emitEntry(dt, smooth(u * 1.6));
      this.post.composite.uniforms.uTint.value.set(1 + 0.18 * u, 1, 1 - 0.15 * u);
    }
    if (t < T.strike) this.post.composite.uniforms.uTint.value.set(1, 1, 1);
    cam.position.add(sh);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // particles live in ship space; space rushes past at the ship's speed
    const wind = this._v.set(0, 0, 55);
    this.fireB.update(dt, wind); this.smokeB.update(dt, wind); this.sparksB.update(dt);
    this.dustB.update(dt);
    this.rocksB.update(dt, null, 0);

    // the far pass shares the camera's pose with planetary near/far planes
    const fc = this.camBfar;
    fc.position.copy(cam.position); fc.quaternion.copy(cam.quaternion);
    fc.fov = cam.fov; fc.aspect = cam.aspect; fc.updateProjectionMatrix(); fc.updateMatrixWorld();
    for (const st of [this.starsB]) {
      st.material.uniforms.uTime.value = t;
      st.material.uniforms.uPx.value = this.renderer.getPixelRatio();
    }
    this._sunFlare(this._v2.copy(cam.position).addScaledVector(this.sunDirB, 1e9), fc, 1.0, [mc]);
    const cu = this.post.composite.uniforms;
    cu.uExposure.value = t > T.strike ? 0.85 : 1.0; cu.uBloomStrength.value = 0.8;
    cu.uTime.value = t; cu.uGrain.value = 0.035; cu.uVignette.value = 0.62;
    if (!this._noRender) this.post.render([{ scene: this.farB, camera: fc }, { scene: this.nearB, camera: cam, clearDepth: true }]);
  }

  _orientMars(q, landmark) {
    // turn `landmark` toward the ship so the approach shows Valles Marineris
    const toShip = this._v.copy(this.mars.position).multiplyScalar(-1).normalize();
    q.setFromUnitVectors(landmark, toShip);
    // and rotate it a little off-centre, toward the lit side
    this.mars.quaternion.copy(q).premultiply(new THREE.Quaternion().setFromAxisAngle(UP, -0.35));
  }

  _cockpitCam(cam, t, shakeAmp) {
    const head = this._v;
    this.ship.pilot.getObjectByName('Head')?.getWorldPosition(head) ?? head.set(0, 0.5, -3.1);
    // inside the canopy, over the console, looking back at the pilot's face
    cam.position.set(0.30 + Math.sin(t * 0.3) * 0.04, head.y + 0.10, head.z - 1.15);
    cam.lookAt(head.x - 0.04, head.y - 0.10, head.z + 0.1);
    cam.position.add(shake(t * 1.7, shakeAmp, this._v2));
    cam.fov = 52;
  }

  _spaceDust(dt, rate) {
    this._dustAcc = (this._dustAcc || 0) + dt * 60 * rate;
    while (this._dustAcc >= 1) {
      this._dustAcc -= 1;
      this.dustB.spawn({ x: (Math.random() - 0.5) * 60, y: (Math.random() - 0.5) * 30, z: -60 - Math.random() * 20,
        vz: 75, life: 1.4, size0: 0.05, c0: [1.4, 1.6, 2.0, 0.7], fadeIn: 0.2, fadeOut: 0.7 });
    }
  }

  _spawnRocks() {
    // a scatter of debris, one of them on a collision course with the port engine
    const target = new THREE.Vector3(-1.75, -0.1, 4.0);
    const v = new THREE.Vector3(-0.55, 0.02, 1).normalize().multiplyScalar(160);
    for (let i = 0; i < 18; i++) {
      const hit = i === 0;
      const off = hit ? new THREE.Vector3() : new THREE.Vector3((Math.random() - 0.3) * 70, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 60);
      const p0 = target.clone().add(off).addScaledVector(v, -0.6);
      this.rocksB.spawn({ x: p0.x, y: p0.y, z: p0.z, vx: v.x, vy: v.y, vz: v.z, s: hit ? 0.55 : 0.3 + Math.random() * 1.6,
                          wx: Math.random() * 3, wy: Math.random() * 3, wz: Math.random() * 3 });
    }
  }

  _strike() {
    this.score?.hullImpact();
    this.rocksB.items.shift();                                     // the one that hit is gone
    const p = this._v.set(-1.75, -0.1, 4.0);
    for (let i = 0; i < 160; i++) {
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      this.sparksB.spawn({ x: p.x, y: p.y, z: p.z, vx: d.x * 30, vy: d.y * 30, vz: d.z * 30 + 20,
        life: 0.6 + Math.random() * 0.8, size0: 0.08, size1: 0.02, drag: 1.2,
        c0: [5, 2.4, 0.7, 1], c1: [1.5, 0.3, 0.05, 0], fadeIn: 0.01 });
    }
    for (let i = 0; i < 36; i++) {
      this.fireB.spawn({ x: p.x + (Math.random() - 0.5), y: p.y + (Math.random() - 0.5), z: p.z,
        vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 10, vz: (Math.random() - 0.5) * 10,
        life: 0.9, size0: 1.2, size1: 4.5, drag: 1.5, c0: [3.2, 1.4, 0.5, 0.9], c1: [0.8, 0.15, 0.03, 0] });
    }
  }

  _emitDamage(dt, rate) {
    if (this.t < 51.5) return;
    const n = this.ship.parts.nacelles[1];
    n.updateWorldMatrix(true, false);
    const p = this._v.set(0, 0.3, 1.5).applyMatrix4(n.matrixWorld);
    this._fireAcc = (this._fireAcc || 0) + dt * 70 * rate;
    while (this._fireAcc >= 1) {
      this._fireAcc -= 1;
      this.fireB.spawn({ x: p.x + (Math.random() - 0.5) * 0.6, y: p.y + (Math.random() - 0.5) * 0.6, z: p.z,
        vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2, life: 0.55, size0: 0.8, size1: 2.2,
        c0: [2.6, 1.0, 0.28, 0.75], c1: [0.6, 0.12, 0.02, 0] });
      if (Math.random() < 0.45) this.smokeB.spawn({ x: p.x, y: p.y, z: p.z + 2, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3,
        life: 2.2, size0: 1.5, size1: 7, c0: [0.08, 0.075, 0.07, 0.55], c1: [0.2, 0.18, 0.16, 0], fadeIn: 0.05 });
    }
  }

  _emitEntry(dt, heat) {
    this._entryAcc = (this._entryAcc || 0) + dt * 160 * heat;
    while (this._entryAcc >= 1) {
      this._entryAcc -= 1;
      // flame peeling off the hull and streaming aft in ribbons
      const a = Math.random() * Math.PI * 2, rr = 1.2 + Math.random() * 1.4;
      const p = this._v.set(Math.cos(a) * rr * 1.5, Math.sin(a) * rr * 0.8, -5 + Math.random() * 8).applyMatrix4(this.ship.root.matrixWorld);
      this.fireB.spawn({ x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * 3, vy: Math.sin(a) * 3, vz: 40, life: 0.55,
        size0: 0.9, size1: 3.2, c0: [1.8, 0.7, 0.18, 0.32], c1: [0.4, 0.07, 0.01, 0], fadeIn: 0.02 });
    }
  }

  /* --------------------------------------------- act III: Jezero, sol 1980 -- */
  _enterActIII() {
    // The ship leaves the space scene for the real one. Its cockpit lights stay
    // behind: point lights joining the game scene would force every lit
    // material there to recompile mid-film.
    this.ship.root.remove(this.ship.cockpitLight, this.ship.alarmLight);
    this.w.scene.add(this.ship.root);
    this.ship.root.scale.setScalar(1);
    this.ship.setHeat(1);
    this.ship.setThrottle(0.15);
    this.ship.cockpitLight.intensity = 0;
    this.groupC.visible = true;
    this.ui.cineGrain.style.opacity = 0.06;
    this.ui.cineVig.style.opacity = 1;
  }

  _shipOnPath(u, out) {
    const { p0, p1, p2 } = this.pathC;
    const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
    return out.set(p0.x * a + p1.x * b + p2.x * c, p0.y * a + p1.y * b + p2.y * c, p0.z * a + p1.z * b + p2.z * c);
  }

  _actIII(t, dt) {
    const cam = this.camC, L = this.w.layout, hf = this.w.hf;
    cam.aspect = innerWidth / innerHeight;
    const ship = this.ship;
    const sh = this._sh.set(0, 0, 0);

    if (t < T.slide) {
      ship.update(dt);
      if (t < T.impact) {
        // the fireball
        const u = clamp01((t - T.sky - 0.4) / (T.impact - T.sky - 0.4));
        const ue = u * u * 0.35 + u * 0.65;                         // still accelerating in
        const pos = this._shipOnPath(ue, this._v);
        const ahead = this._shipOnPath(Math.min(1, ue + 0.01), this._v2).sub(pos).normalize();
        ship.root.position.copy(pos);
        ship.root.lookAt(pos.x - ahead.x, pos.y - ahead.y, pos.z - ahead.z);   // nose (-Z) along travel
        ship.root.rotateZ(0.5 * Math.sin(t * 0.9) + 0.4);
        ship.setHeat(lerp(1, 0.2, u));
        this._emitTrail(dt, pos, ahead, u);
      } else {
        // skidding down the furrow to where the wreck will lie
        const u = clamp01((t - T.impact) / (T.slide - T.impact));
        const k = 1 - Math.pow(1 - u, 2.4);
        const pos = this._v.copy(this.pathC.p2).lerp(this.slideEnd, k);
        pos.y = hf.heightAt(pos.x, pos.z) + 0.9;
        ship.root.position.copy(pos);
        ship.root.lookAt(pos.x - L.h.x, pos.y, pos.z - L.h.z);
        ship.root.rotateZ(0.3 + u * 0.4);
        ship.setHeat(lerp(0.2, 0.05, u));
        if (Math.random() < 0.9) this._skidDust(pos, 1 - u);
      }
    }

    if (t < 73) {
      // wide and side-on: the streak drawn across the evening sky
      cam.position.copy(this.camCwide);
      // follow the ship's bearing but tilt only part way up, so the horizon
      // and the ground stay in frame under the streak
      const target = ship.root.position;
      this._aimW = this._aimW || target.clone();
      this._aimW.lerp(target, 1 - Math.exp(-dt * 2.5));
      const d = this._v2.copy(this._aimW).sub(cam.position);
      const hz = Math.hypot(d.x, d.z), elev = Math.atan2(d.y, hz) * 0.55;
      this._v2.set(cam.position.x + d.x / hz, cam.position.y + Math.tan(elev), cam.position.z + d.z / hz);
      cam.lookAt(this._v2);
      cam.fov = 46;
      shake(t * 0.5, 0.01, sh);
    } else if (t < T.impact + 0.6) {
      // standing near the player's start, looking up the path into the sun
      cam.position.copy(this.camCpos);
      const target = ship.root.position;
      this._aimC = this._aimC || target.clone();
      this._aimC.lerp(target, 1 - Math.exp(-dt * 4.0));
      cam.lookAt(this._aimC);
      const dist = cam.position.distanceTo(target);
      cam.fov = THREE.MathUtils.clamp(lerp(34, 66, 1 - Math.min(1, dist / 2200)), 34, 66);
      shake(t, 0.004 + 0.06 * smooth(1 - dist / 900), sh);
      if (t > T.impact) shake(t * 1.6, 0.35 * Math.exp(-(t - T.impact - 0.2) * 3), this._v2), sh.add(this._v2);
    } else if (t < T.after) {
      // low and side-on to the furrow as the dust boils up
      const base = this._v.copy(L.W).addScaledVector(L.side, -42).addScaledVector(L.h, -12);
      base.y = hf.heightAt(base.x, base.z) + 1.3;
      const u = (t - T.impact) / (T.after - T.impact);
      cam.position.copy(base).addScaledVector(L.h, u * 4);
      this._v2.copy(L.W).addScaledVector(L.h, -10); this._v2.y = hf.heightAt(this._v2.x, this._v2.z) + 2.5 + u * 3;
      cam.lookAt(this._v2);
      cam.fov = 50;
      const since = t - T.impact - 42 / 240;                        // the ground wave, then the boom
      if (since > 0) shake(t * 1.8, 0.22 * Math.exp(-since * 1.4), sh);
    } else {
      this._aftermathCam(cam, t, dt);
    }
    this._robotUpdate(dt);

    cam.position.add(sh);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    // the persistent site and the one-off effects
    this.w.wreck.update(dt);
    const wind = this._v.set(1.6, 0, 0.5);
    this.trailFire.update(dt, wind); this.trailSmoke.update(dt, wind); this.dustC.update(dt, wind);
    this.flashC.update(dt);
    this.debrisC.update(dt, (x, z) => hf.heightAt(x, z));
    if (this.shock.material.opacity > 0) {
      const s = (t - T.impact) * 85;
      this.shock.scale.setScalar(Math.max(0.1, s));
      this.shock.material.opacity = Math.max(0, 0.55 * (1 - (t - T.impact) / 2.2));
    }
    if (t > T.after + 10) this.w.animatePlayer?.(dt);
    if (!this._noRender) this.w.renderWorld(cam);
  }

  _emitTrail(dt, pos, ahead, u) {
    this._trailAcc = (this._trailAcc || 0) + dt * 75;
    while (this._trailAcc >= 1) {
      this._trailAcc -= 1;
      const j = Math.random();
      const x = pos.x - ahead.x * (8 + j * 30), y = pos.y - ahead.y * (8 + j * 30), z = pos.z - ahead.z * (8 + j * 30);
      const g = 0.16 + Math.random() * 0.08;
      this.trailSmoke.spawn({ x, y, z, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 3,
        life: 40 + Math.random() * 15, size0: 6, size1: 34 + Math.random() * 22, drag: 0.15,
        c0: [g, g * 0.9, g * 0.82, 0.55], c1: [0.55, 0.44, 0.34, 0.0], fadeIn: 0.01, fadeOut: 0.3, spin: 0.05 });
      const far = Math.max(1, this.camC.position.distanceTo(pos) / 400);
      this.trailFire.spawn({ x: pos.x - ahead.x * j * 14, y: pos.y - ahead.y * j * 14, z: pos.z - ahead.z * j * 14,
        life: 0.5, size0: 7 * Math.min(far, 4), size1: 2.5 * Math.min(far, 4), c0: [3.2, 1.3, 0.35, 0.55], c1: [1.2, 0.25, 0.04, 0] });
    }
  }

  _skidDust(pos, k) {
    const L = this.w.layout;
    for (let i = 0; i < 3; i++) {
      const s = (Math.random() - 0.5) * 2;
      this.dustC.spawn({ x: pos.x + L.side.x * s * 4, y: pos.y - 0.5, z: pos.z + L.side.z * s * 4,
        vx: L.side.x * s * 9 + L.h.x * 6 * k, vy: 3 + Math.random() * 6 * k, vz: L.side.z * s * 9 + L.h.z * 6 * k,
        life: 14 + Math.random() * 10, size0: 2, size1: 14 + Math.random() * 10, drag: 0.6, grav: 0.4,
        c0: [0.45, 0.32, 0.21, 0.4], c1: [0.58, 0.45, 0.33, 0], fadeIn: 0.03, fadeOut: 0.4, spin: 0.1 });
    }
  }

  _impact() {
    const p = this.pathC.p2, hf = this.w.hf;
    this.score?.crash(this.camCpos.distanceTo(p));
    this._tween(this.ui.cineFlash, 'opacity', 0.85, 0, 0.9);
    for (let i = 0; i < 260; i++) {
      const a = Math.random() * Math.PI * 2, up = Math.random();
      const sp = 8 + Math.random() * 45, jit = 0.85 + Math.random() * 0.3;
      this.dustC.spawn({ x: p.x, y: p.y, z: p.z,
        vx: Math.cos(a) * sp * (1 - up * 0.6), vy: 4 + up * 30, vz: Math.sin(a) * sp * (1 - up * 0.6),
        life: 18 + Math.random() * 14, size0: 3, size1: 20 + Math.random() * 18, drag: 0.9, grav: 0.5,
        c0: [0.42 * jit, 0.30 * jit, 0.20 * jit, 0.40], c1: [0.60 * jit, 0.46 * jit, 0.34 * jit, 0], fadeIn: 0.01, fadeOut: 0.45, spin: 0.15 });
    }
    for (let i = 0; i < 26; i++) {
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize();
      this.flashC.spawn({ x: p.x, y: p.y + 1, z: p.z, vx: d.x * 26, vy: d.y * 26, vz: d.z * 26, drag: 2.5,
        life: 0.5 + Math.random() * 0.5, size0: 4, size1: 11, c0: [2.2, 0.95, 0.30, 0.55], c1: [0.6, 0.12, 0.02, 0] });
    }
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2, sp = 10 + Math.random() * 30;
      this.debrisC.spawn({ x: p.x, y: p.y + 1, z: p.z, vx: Math.cos(a) * sp + this.w.layout.h.x * 12, vy: 8 + Math.random() * 22,
        vz: Math.sin(a) * sp + this.w.layout.h.z * 12, s: 0.25 + Math.random() * 0.8,
        wx: Math.random() * 8, wy: Math.random() * 8, wz: Math.random() * 8 });
    }
    this.shock.position.set(p.x, hf.heightAt(p.x, p.z) + 0.3, p.z);
    this.shock.material.opacity = 0.55;
  }

  _toWreck() {
    this.ship.root.visible = false;
    this.w.wreck.setVisible(true);
    this.w.wreck.prewarm(2);
    // the pilot was thrown clear and sits dazed beside it
    const comp = this.w.companion, L = this.w.layout;
    const p = L.robot;
    comp.pos.set(p.x, this.w.hf.heightAt(p.x, p.z), p.z);
    comp.root.position.copy(comp.pos);
    comp.yaw = Math.atan2(L.spawn.x - p.x, L.spawn.z - p.z);
    comp.root.rotation.y = comp.yaw;
    comp.root.visible = true;
    this._robot('Sitting', true);
  }

  _robot(name, instant = false) {
    const comp = this.w.companion, a = comp.actions[name];
    if (!a) return;
    a.reset();
    a.setLoop(name === 'Idle' ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = true;
    if (comp.current && comp.current !== a) comp.current.fadeOut(instant ? 0 : 0.5);
    a.setEffectiveWeight(1).fadeIn(instant ? 0 : 0.5).play();
    if (instant) a.time = a.getClip().duration;
    comp.current = a; comp.currentName = name;
    this._robotNext = name === 'Standing' ? { at: this.t + a.getClip().duration - 0.3, name: 'Idle' }
                    : name === 'Wave' ? { at: this.t + a.getClip().duration - 0.2, name: 'Idle' } : null;
  }

  _robotUpdate(dt) {
    const comp = this.w.companion;
    if (!comp.root.visible) return;
    if (this._robotNext && this.t >= this._robotNext.at) { const n = this._robotNext.name; this._robotNext = null; this._robot(n); }
    comp.mixer.update(dt);
    if (comp.face && comp.face.morphTargetInfluences) {
      const i = comp.face.morphTargetDictionary.Sad;
      const want = this.t < 92 ? 0.6 : 0;
      if (i !== undefined) comp.face.morphTargetInfluences[i] += (want - comp.face.morphTargetInfluences[i]) * Math.min(1, dt * 2);
    }
  }

  _aftermathCam(cam, t, dt) {
    const L = this.w.layout, hf = this.w.hf;
    if (t < 89.6) {
      // establishing: the wreck, its smoke column, the contrail still in the sky
      const u = smooth((t - T.after) / 5.6);
      const p = this._v.copy(L.W).addScaledVector(L.f, -lerp(85, 66, u)).addScaledVector(L.r, lerp(30, 22, u));
      p.y = hf.heightAt(p.x, p.z) + lerp(5, 3.5, u);
      cam.position.copy(p);
      this._v2.copy(L.W); this._v2.y = hf.heightAt(L.W.x, L.W.z) + lerp(9, 4, u);
      cam.lookAt(this._v2);
      cam.fov = 42;
    } else if (t < 96) {
      // close on the pilot, who gets up
      const R = L.robot;
      const u = smooth((t - 89.6) / 6.4);
      const toward = this._v2.copy(L.spawn).sub(R).normalize();
      const p = this._v.copy(R).addScaledVector(toward, lerp(4.2, 3.4, u)).addScaledVector(new THREE.Vector3(toward.z, 0, -toward.x), 1.3);
      p.y = hf.heightAt(p.x, p.z) + lerp(0.8, 1.1, u);
      cam.position.copy(p);
      this._v2.copy(R); this._v2.y = hf.heightAt(R.x, R.z) + lerp(0.5, 0.95, u);
      cam.lookAt(this._v2);
      cam.fov = 40;
    } else {
      // rise and swing round behind the commander: the gameplay camera
      const u = easeInOut((t - 96) / 4);
      const R = L.robot;
      const gp = this.w.gameplayCamera();
      const toward = this._v2.copy(L.spawn).sub(R).normalize();
      const start = this._v.copy(R).addScaledVector(toward, 3.4).addScaledVector(new THREE.Vector3(toward.z, 0, -toward.x), 1.3);
      start.y = hf.heightAt(start.x, start.z) + 1.1;
      cam.position.copy(start).lerp(gp.pos, u);
      cam.position.y += Math.sin(u * Math.PI) * 4;
      const look = this._v2.copy(R); look.y = hf.heightAt(R.x, R.z) + 0.95;
      look.lerp(gp.target, u);
      cam.lookAt(look);
      cam.fov = lerp(40, gp.fov, u);
    }
  }

  /** Jump to intro time `target`: simulate at 30 Hz without drawing, then draw once. */
  seek(target) {
    this._noRender = true;
    while (this.active && this.t < target - 1 / 30) this.update(1 / 30);
    this._noRender = false;
    if (this.active) this.update(1 / 30);
  }

  /* ------------------------------------------------------------- finish -- */
  finish(skipped) {
    if (!this.active) return;
    this.active = false;
    this.done = true;
    removeEventListener('keydown', this._onKey, true);
    removeEventListener('keyup', this._onKey, true);
    this.ui.cineSkip.removeEventListener('click', this._onSkipClick);
    if (this.score && !this.score.stopped) this.score.stop(skipped ? 0.6 : 2.5);
    const a = this.w.audio;
    if (a && this._bedLevels) {
      if (a.fanGain && this._bedLevels.fan != null) a.fanGain.gain.setTargetAtTime(this._bedLevels.fan, a.ctx.currentTime, 1.5);
      if (a.windGain && this._bedLevels.wind != null) a.windGain.gain.setTargetAtTime(this._bedLevels.wind, a.ctx.currentTime, 2.5);
    }
    // the world as the crash left it, however the film ended
    this.ship.root.visible = false;
    this.w.scene.remove(this.ship.root);
    if (!this.w.wreck.visible) { this.w.wreck.setVisible(true); this.w.wreck.prewarm(20); }
    if (skipped) { this.groupC.visible = false; this.trailSmoke.clear(); this.dustC.clear(); }
    const comp = this.w.companion;
    if (!comp.root.visible || skipped) {
      const p = this.w.layout.robot;
      comp.pos.set(p.x, this.w.hf.heightAt(p.x, p.z), p.z);
      comp.root.position.copy(comp.pos);
      comp.root.visible = true;
    }
    this._robot('Idle', true);
    this._keepDrifting = !skipped;           // the dust and contrail settle in play
    const ui = this.ui;
    ui.cine.classList.remove('bars');
    for (const k of Object.values(this.cards)) { k.card.classList.remove('show'); k.ret.classList.remove('show'); }
    ui.cineTitle.classList.remove('show'); this._sub(null); this._warn(null);
    ui.cineFade.style.transition = 'opacity 1.2s ease';
    ui.cineFade.style.opacity = 0;
    setTimeout(() => { ui.cine.classList.add('off'); ui.cineFade.style.transition = ''; }, 1300);
    this.w.showPlayer(true);
    this.w.setHud(true);
    this.post.dispose();
    this._disposeSpace();
    this.w.onDone?.(skipped);
  }

  /** The space acts are never drawn again: give their GPU memory back. */
  _disposeSpace() {
    const seen = new Set();
    const free = o => {
      if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
      for (const m of [].concat(o.material || [])) if (!seen.has(m)) { seen.add(m); m.dispose(); }
    };
    for (const sc of [this.sceneA, this.farB, this.nearB]) sc.traverse(free);
    this.ship.root.traverse(free);
    for (const rt of Object.values(this.bakes)) rt.dispose();
    this.env?.dispose();
    this.sceneA = this.farB = this.nearB = null;
  }

  /** After the film: let its dust and contrail drift away in the live world. */
  updateAfter(dt) {
    if (!this._keepDrifting) return;
    const wind = this._v.set(1.6, 0, 0.5);
    this.trailFire.update(dt, wind); this.trailSmoke.update(dt, wind); this.dustC.update(dt, wind);
    this.flashC.update(dt);
    this.debrisC.update(dt, (x, z) => this.w.hf.heightAt(x, z));
    if (!this.trailSmoke.n && !this.dustC.n) { this._keepDrifting = false; }
  }

  /** Flare/streak for the composite: only when the sun is on screen and not behind a planet. */
  _sunFlare(sunWorld, cam, gain, occluders) {
    const u = this.post.composite.uniforms.uSunScreen.value;
    const p = this._v.copy(sunWorld).project(cam);
    let vis = p.z < 1 && Math.abs(p.x) < 1.15 && Math.abs(p.y) < 1.15 ? 1 : 0;
    if (vis && occluders.length) {
      const d = this._v2.copy(sunWorld).sub(cam.position).normalize();
      for (const c of occluders) {
        const oc = c.clone().sub(cam.position), tca = oc.dot(d);
        if (tca > 0 && oc.lengthSq() - tca * tca < this.R * this.R) vis = 0;
      }
    }
    u.set(p.x, p.y, vis * gain * (1 - smooth((Math.max(Math.abs(p.x), Math.abs(p.y)) - 0.85) / 0.3)));
  }
}

let GRAIN = null;
function grainDataURL() {
  if (GRAIN) return GRAIN;
  const c = document.createElement('canvas'); c.width = c.height = 180;
  const g = c.getContext('2d'), img = g.createImageData(180, 180);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return (GRAIN = c.toDataURL());
}
