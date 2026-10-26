import * as THREE from 'three';

/**
 * Procedural kit for the survival campaign: salvage crates, base modules,
 * beacons and zone rings. Everything is built from primitives and a painted
 * canvas, like the Kestrel itself, so there is nothing to download.
 *
 * Module builders return a THREE.Group whose local origin sits on the ground
 * at the module's centre; the caller places it and sets its yaw.
 */

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.15, ...o });
const glow = (color, opacity = 1) => new THREE.MeshBasicMaterial({
  color, transparent: opacity < 1, opacity, toneMapped: false, depthWrite: opacity >= 1 });

const WHITE = std(0xe9e4dc, { roughness: 0.5 });
const GREY = std(0x8a8782, { metalness: 0.45, roughness: 0.4 });
const DARK = std(0x2b2724, { metalness: 0.3, roughness: 0.55 });
const ORANGE = std(0xe0672a, { roughness: 0.5 });
const PANEL = std(0x1d2c4f, { metalness: 0.55, roughness: 0.28, emissive: 0x060c1c });
const FOIL = std(0xd9b25c, { metalness: 0.85, roughness: 0.32 });
const REGOLITH = std(0x9a6446, { roughness: 0.96, metalness: 0 });

function shadowed(root) {
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return root;
}

/* ----------------------------------------------------------------- crates -- */
const _labelCache = new Map();
function labelTexture(text, accent) {
  const key = text + accent;
  if (_labelCache.has(key)) return _labelCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#d8d2c6'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = accent; g.fillRect(0, 0, 256, 46); g.fillRect(0, 210, 256, 46);
  // hazard chevrons along the bands
  g.fillStyle = 'rgba(20,16,12,.55)';
  for (let x = -40; x < 300; x += 34) {
    g.beginPath(); g.moveTo(x, 46); g.lineTo(x + 16, 46); g.lineTo(x + 30, 0); g.lineTo(x + 14, 0); g.fill();
  }
  g.fillStyle = '#1c1814';
  g.font = 'bold 64px ui-monospace, Menlo, Consolas, monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 124);
  g.font = 'bold 20px ui-monospace, Menlo, Consolas, monospace';
  g.fillText('KESTREL · NASA', 128, 178);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _labelCache.set(key, t);
  return t;
}

/** A salvage crate: a labelled box, sized to stay inside a two-handed grip. */
export function makeCrate(code, accent, size = [0.66, 0.5, 0.62]) {
  const [w, h, d] = size;
  const mat = new THREE.MeshStandardMaterial({ map: labelTexture(code, accent), roughness: 0.6, metalness: 0.1 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  // corner rails make it read as a flight case, not a cube
  const rail = new THREE.BoxGeometry(0.05, h + 0.02, 0.05);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const r = new THREE.Mesh(rail, DARK);
    r.position.set(sx * (w / 2), 0, sz * (d / 2));
    mesh.add(r);
  }
  mesh.castShadow = mesh.receiveShadow = true;
  return { mesh, halfHeight: h / 2, radius: Math.max(w, d) / 2 };
}

/* ---------------------------------------------------------------- modules -- */
/** Inflatable surface habitat with an airlock, 7.2 m long. */
export function makeHab() {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.CapsuleGeometry(2.1, 3.2, 8, 24), WHITE);
  shell.rotation.z = Math.PI / 2;
  shell.scale.set(1, 1, 0.92);
  shell.position.y = 1.75;
  g.add(shell);
  for (const x of [-1.2, 0, 1.2]) {               // restraint bands
    const band = new THREE.Mesh(new THREE.TorusGeometry(2.13, 0.06, 6, 32), ORANGE);
    band.rotation.y = Math.PI / 2;
    band.position.set(x, 1.75, 0);
    band.scale.set(1, 1, 0.92);
    g.add(band);
  }
  const lock = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.6, 16), GREY);
  lock.rotation.x = Math.PI / 2;
  lock.position.set(0, 1.25, 2.4);
  g.add(lock);
  const hatch = new THREE.Mesh(new THREE.CircleGeometry(0.6, 20), DARK);
  hatch.position.set(0, 1.25, 3.21);
  g.add(hatch);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), glow(0x7fe3ff));
  lamp.position.set(0, 2.05, 3.15);
  g.add(lamp);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {     // feet
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.0, 8), GREY);
    leg.position.set(sx * 2.4, 0.4, sz * 1.1);
    g.add(leg);
  }
  g.userData.lamp = lamp;
  return shadowed(g);
}

/** Regolith berm around the hab. scale.y is driven by how much has been piled. */
export function makeBerm() {
  const pts = [];
  // a trapezoid mound in profile, revolved: 4.4 m inner, 7 m outer radius
  pts.push(new THREE.Vector2(3.0, 0), new THREE.Vector2(3.3, 1), new THREE.Vector2(4.2, 1.15),
           new THREE.Vector2(5.4, 0.55), new THREE.Vector2(6.1, 0));
  const geo = new THREE.LatheGeometry(pts, 40);
  const m = new THREE.Mesh(geo, REGOLITH);
  m.scale.set(1.05, 0.001, 1.35);                  // stretched to the hab's length
  m.receiveShadow = m.castShadow = true;
  return m;
}

/** Solar array: four 2 x 7.5 m panels on a single-axis tracker. 60 m^2. */
export function makeSolarArray() {
  const g = new THREE.Group();
  const tracker = new THREE.Group();
  tracker.position.y = 1.4;
  g.add(tracker);
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.05, 7.5), PANEL);
    p.position.set((i - 1.5) * 2.15, 0, 0);
    tracker.add(p);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.4, 8), GREY);
    post.position.set((i - 1.5) * 2.15, 0.7, 0);
    g.add(post);
  }
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 8.6, 8), GREY);
  beam.rotation.z = Math.PI / 2;
  tracker.add(beam);
  g.userData.tracker = tracker;
  return shadowed(g);
}

/** Solid-oxide CO2 electrolysis plant: a cabinet, an O2 dewar, an intake. */
export function makeO2Plant() {
  const g = new THREE.Group();
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.1), WHITE);
  cab.position.y = 0.7;
  g.add(cab);
  const foil = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.3, 1.12), FOIL);
  foil.position.y = 1.15;
  g.add(foil);
  const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.9, 6, 14), std(0xcfd8e2, { metalness: 0.6, roughness: 0.3 }));
  tank.position.set(1.25, 0.8, 0);
  g.add(tank);
  const intake = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.5, 12), DARK);
  intake.position.set(-0.55, 1.5, 0);
  g.add(intake);
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.02), glow(0x5cff9b));
  led.position.set(0, 0.95, 0.56);
  g.add(led);
  g.userData.led = led;
  return shadowed(g);
}

/** Regolith oven: a hopper over a heated drum, with a condenser coil. */
export function makeOven() {
  const g = new THREE.Group();
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.5, 18), GREY);
  drum.rotation.z = Math.PI / 2;
  drum.position.y = 0.75;
  g.add(drum);
  const hopper = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.25, 0.7, 16, 1, true), std(0x6d6a66, { side: THREE.DoubleSide, metalness: 0.4 }));
  hopper.position.set(-0.4, 1.55, 0);
  g.add(hopper);
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.05, 6, 18), std(0xb87333, { metalness: 0.8, roughness: 0.35 }));
  coil.position.set(0.95, 0.75, 0);
  coil.rotation.y = Math.PI / 2;
  g.add(coil);
  const heat = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 20), glow(0xff6a2a, 0.0));
  heat.position.set(-0.76, 0.75, 0);
  heat.rotation.y = -Math.PI / 2;
  g.add(heat);
  g.userData.heat = heat;
  return shadowed(g);
}

/** Perchlorate purifier: distillation column and two polishing beds. */
export function makePurifier() {
  const g = new THREE.Group();
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 1.7, 14), std(0xd6dde4, { metalness: 0.5, roughness: 0.3 }));
  col.position.y = 0.85;
  g.add(col);
  for (const x of [0.5, 0.85]) {
    const bed = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.9, 12), std(0x4c7fb0, { roughness: 0.4 }));
    bed.position.set(x, 0.45, 0);
    g.add(bed);
  }
  const water = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.02), glow(0x5fc8ff));
  water.position.set(0, 0.6, 0.27);
  g.add(water);
  g.userData.led = water;
  return shadowed(g);
}

/** Hydroponic greenhouse: a pressurised half-dome over grow racks. */
export function makeGreenhouse() {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xcfe9ff, transparent: true, opacity: 0.28, roughness: 0.08,
                                     metalness: 0.1, depthWrite: false }));
  dome.scale.set(1, 0.85, 1.25);
  g.add(dome);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.08, 6, 36), GREY);
  ring.rotation.x = Math.PI / 2;
  ring.scale.set(1, 1.25, 1);
  g.add(ring);
  const leaf = new THREE.MeshStandardMaterial({ color: 0x3fae4a, emissive: 0x1d6b25, emissiveIntensity: 0.6, roughness: 0.7 });
  const plants = new THREE.Group();
  for (let r = 0; r < 3; r++) {
    const rack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 3.6), std(0x5a5550));
    rack.position.set((r - 1) * 1.1, 0.3, 0);
    g.add(rack);
    for (let k = 0; k < 7; k++) {
      const p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), leaf);
      p.position.set((r - 1) * 1.1, 0.72, (k - 3) * 0.5);
      plants.add(p);
    }
  }
  g.add(plants);
  const grow = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.03, 3.6), glow(0xff5fd2, 0.55));
  grow.position.y = 1.6;
  g.add(grow);
  g.userData.plants = plants;
  return shadowed(g);
}

/** Kestrel's 10 kWe fission power unit on its tow sled, radiator fins out. */
export function makeReactor() {
  const g = new THREE.Group();
  const sled = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.25, 3.2), DARK);
  sled.position.y = 0.13;
  g.add(sled);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 1.6, 16), std(0xbfc3c7, { metalness: 0.7, roughness: 0.3 }));
  core.position.set(0, 1.05, -0.8);
  g.add(core);
  const conv = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.2, 12), GREY);
  conv.position.set(0, 0.9, 0.6);
  conv.rotation.x = Math.PI / 2;
  g.add(conv);
  const fins = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.6, 2.4), std(0x3b3f45, { metalness: 0.5 }));
    fin.position.set(0, 1.2, 0.9);
    const piv = new THREE.Group();
    piv.rotation.z = (i / 4) * Math.PI * 2 + Math.PI / 4;
    piv.position.set(0, 1.2, 0.9);
    fin.position.set(0, 0.95, 0);
    piv.add(fin);
    fins.add(piv);
  }
  fins.scale.setScalar(0.05);              // folded for transport
  g.add(fins);
  const tre = new THREE.Mesh(new THREE.RingGeometry(0.56, 0.62, 3), glow(0xffd43a));
  tre.position.set(0, 1.9, -0.8);
  tre.rotation.x = -Math.PI / 2;
  g.add(tre);
  g.userData.fins = fins;
  return shadowed(g);
}

/** Sabatier reactor + water electrolyser, with a methane dewar. */
export function makeSabatier() {
  const g = new THREE.Group();
  const reactor = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.9, 16), std(0x9aa0a6, { metalness: 0.65, roughness: 0.3 }));
  reactor.position.set(-0.5, 0.95, 0);
  g.add(reactor);
  const ch4 = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.0, 6, 14), std(0x5e86c2, { metalness: 0.5, roughness: 0.35 }));
  ch4.position.set(0.55, 0.9, 0);
  g.add(ch4);
  const pipe = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 6, 16, Math.PI), std(0xb87333, { metalness: 0.8 }));
  pipe.position.set(0, 1.8, 0);
  g.add(pipe);
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.02), glow(0x7fa8ff));
  led.position.set(0.55, 1.4, 0.43);
  g.add(led);
  g.userData.led = led;
  return shadowed(g);
}

/** The Kestrel's cockpit pod, thrown clear: also its ascent stage. */
export function makeCapsule() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.45, 1.6, 20), WHITE);
  cyl.position.y = 1.9;
  body.add(cyl);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.9, 20), WHITE);
  cone.position.y = 3.65;
  body.add(cone);
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.215, 1.27, 0.25, 20), ORANGE);
  stripe.position.y = 2.25;
  body.add(stripe);
  const win = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.05), glow(0x7fe3ff, 0.7));
  win.position.set(0, 2.9, 0.98);
  win.rotation.x = -0.5;
  body.add(win);
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.65, 0.7, 16, 1, true), std(0x3a3632, { metalness: 0.7, side: THREE.DoubleSide }));
  bell.position.y = 0.85;
  body.add(bell);
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.9, 6), GREY);
    leg.position.set(Math.cos(a) * 1.35, 0.75, Math.sin(a) * 1.35);
    leg.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45);
    g.add(leg);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.08, 10), GREY);
    pad.position.set(Math.cos(a) * 1.75, 0.04, Math.sin(a) * 1.75);
    g.add(pad);
  }
  const gauge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.2, 0.06), glow(0x5cff9b));
  gauge.position.set(1.36, 1.9, 0);
  body.add(gauge);
  g.userData.body = body;
  g.userData.gauge = gauge;
  return shadowed(g);
}

/** A fuel line laid over the ground between two points. */
export function makeFuelLine(hf, a, b) {
  const pts = [];
  const n = Math.max(8, Math.ceil(a.distanceTo(b) / 1.5));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    pts.push(new THREE.Vector3(x, hf.heightAt(x, z) + 0.08, z));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, n * 2, 0.06, 6), ORANGE);
  m.castShadow = true;
  return m;
}

/* ---------------------------------------------------------------- markers -- */
/** Objective beacon: an amber pillar of light with a pulsing ground ring. */
export function makeBeacon(color = 0xffb347) {
  const g = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 40, 6, 1, true),
    glow(color, 0.38));
  beam.position.y = 20;
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.25, 32), glow(color, 0.7));
  ring.material.side = THREE.DoubleSide;
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  g.add(beam, ring);
  g.userData.ring = ring;
  g.userData.beam = beam;
  g.renderOrder = 20;
  return g;
}

/** A dashed ring hugging the terrain, marking an area (ore field, zones). */
export function makeZoneRing(hf, cx, cz, r, color = 0xffb347) {
  const pts = [];
  const n = Math.max(32, Math.round(r * 5));
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    pts.push(x, hf.heightAt(x, z) + 0.12, z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const line = new THREE.LineLoop(geo, new THREE.LineDashedMaterial({
    color, dashSize: 0.9, gapSize: 0.6, transparent: true, opacity: 0.85, toneMapped: false }));
  line.computeLineDistances();
  return line;
}
