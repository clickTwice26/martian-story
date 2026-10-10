import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/jsm/loaders/GLTFLoader.js';
import { COMPANION_MODEL } from '../companion.js';

/**
 * The Kestrel: the light courier the support unit flies to Jezero.
 *
 * Built entirely from primitives and one painted canvas, so it ships with no
 * model files and no licence questions. Silhouette after a racing courier:
 * flattened lifting body, swept wings, twin canted fins, two big nacelles
 * trailing energy beams. Nose points down -Z, up is +Y, ~16 m long.
 */

/* ------------------------------------------------------------ hull paint -- */
function hullTexture() {
  const W = 1024, H = 512, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#dcd6cb'; g.fillRect(0, 0, W, H);
  // individual panels, each a slightly different tone of the same paint
  for (let i = 0; i < 260; i++) {
    const x = Math.floor(rnd() * 16) * 64, y = Math.floor(rnd() * 16) * 32;
    const w = 64 * (1 + Math.floor(rnd() * 3)), h = 32 * (1 + Math.floor(rnd() * 2));
    const t = 200 + Math.floor(rnd() * 30);
    g.fillStyle = `rgb(${t + 8},${t + 4},${t - 4})`;
    g.fillRect(x, y, w, h);
  }
  // panel seams
  g.strokeStyle = 'rgba(40,36,32,0.55)'; g.lineWidth = 1.5;
  for (let x = 0; x <= W; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0; y <= H; y += 32) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
  }
  // rivet rows
  g.fillStyle = 'rgba(60,55,50,0.5)';
  for (let y = 16; y < H; y += 32) for (let x = 4; x < W; x += 9) g.fillRect(x, y, 1.5, 1.5);
  // livery: a racing band in signal orange, a thin black pinstripe
  g.fillStyle = '#d4581c'; g.fillRect(0, 150, W, 34);
  g.fillStyle = '#1b1b1e'; g.fillRect(0, 188, W, 7);
  g.fillStyle = '#d4581c'; g.fillRect(0, 380, W, 12);
  // name and number on both flanks (u = 0.25 and 0.75), written along the hull
  for (const u of [0.25, 0.75]) {
    g.save();
    g.translate(u * W, 250);
    g.rotate(Math.PI / 2 * (u < 0.5 ? 1 : -1));
    g.fillStyle = '#1d1d22';
    g.font = 'bold 30px monospace';
    g.textAlign = 'center';
    g.fillText('KESTREL', 0, 10);
    g.font = 'bold 18px monospace';
    g.fillText('K-7  ·  JEZERO RUN', 0, 34);
    g.restore();
  }
  // warning chevrons near the engine roots
  for (let x = 0; x < W; x += 28) {
    g.fillStyle = (x / 28) % 2 ? '#1b1b1e' : '#e2b23a';
    g.beginPath(); g.moveTo(x, 430); g.lineTo(x + 14, 430); g.lineTo(x + 28, 444); g.lineTo(x + 14, 444); g.fill();
  }
  // soot and wear toward the tail
  const grd = g.createLinearGradient(0, 360, 0, H);
  grd.addColorStop(0, 'rgba(30,25,20,0)'); grd.addColorStop(1, 'rgba(30,25,20,0.55)');
  g.fillStyle = grd; g.fillRect(0, 360, W, H - 360);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(50,42,36,${0.05 + rnd() * 0.08})`;
    g.beginPath(); g.ellipse(rnd() * W, rnd() * H, 6 + rnd() * 30, 2 + rnd() * 6, 0, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function screenTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#02080c'; g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#3fe0ff'; g.lineWidth = 2;
  g.beginPath(); g.arc(64, 64, 40, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(24, 64); g.lineTo(104, 64); g.moveTo(64, 24); g.lineTo(64, 104); g.stroke();
  g.fillStyle = '#3fe0ff'; g.font = '12px monospace';
  ['ALT 1204 KM', 'VEL 4.1 KM/S', 'MARS ORB INS', 'JEZERO 18.4N'].forEach((t, i) => g.fillText(t, 128, 30 + i * 22));
  g.fillStyle = '#ffb13b'; g.fillRect(128, 104, 100, 6);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ------------------------------------------------------------- geometry -- */
function fuselageGeometry() {
  // radius along the length, nose first (y is distance toward the nose)
  const prof = [[0, 8.2], [0.32, 7.6], [0.7, 6.6], [1.05, 5.0], [1.35, 3.0], [1.55, 0.6], [1.58, -1.8],
                [1.5, -4.0], [1.32, -5.8], [1.05, -7.0], [0.0, -7.05]];
  const geo = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 48, Math.PI, Math.PI * 2);
  geo.rotateX(-Math.PI / 2);          // nose to -Z
  geo.scale(1.0, 0.56, 1.0);          // a lifting body, not a tube
  // Keep the lathe's own normals (scale() re-normalises them). Recomputing
  // from faces leaves the nose and tail tips - points where only zero-area
  // triangles meet - with zero-length normals, and normalize(0) is NaN on
  // Apple GPUs: one NaN pixel the bloom then smears into black rectangles.
  return geo;
}

function wingGeometry(sign) {
  const pts = [[0.9, -1.2], [6.6, 3.6], [7.0, 5.0], [6.2, 5.3], [0.9, 5.7]].map(([x, z]) => [x * sign, z]);
  if (sign < 0) pts.reverse();
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.06,
                                                 bevelSize: 0.06, bevelSegments: 2, steps: 1 });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0.08, 0);
  return geo;
}

function finGeometry() {
  const shape = new THREE.Shape([[3.6, 0], [6.1, 2.9], [7.0, 2.9], [6.9, 0]].map(([z, y]) => new THREE.Vector2(z, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.04,
                                                 bevelSize: 0.04, bevelSegments: 1 });
  geo.rotateY(-Math.PI / 2);
  return geo;
}

/* --------------------------------------------------------------- shaders -- */
const PLUME = () => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uPower: { value: 1 }, uCol: { value: new THREE.Color(0.45, 0.75, 1.0) } },
  vertexShader: /* glsl */`
    varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main() { vUv = uv; vN = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv; }`,
  fragmentShader: /* glsl */`
    uniform float uTime, uPower; uniform vec3 uCol;
    varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main() {
      float along = vUv.y;                                   // 1 at the nozzle, 0 at the tip
      float core = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
      float flick = 0.85 + 0.15 * sin(uTime * 61.0 + along * 30.0) * sin(uTime * 37.0);
      float diamonds = 0.75 + 0.25 * sin(along * 46.0 - uTime * 20.0);   // shock diamonds
      vec3 c = mix(uCol, vec3(1.0), core * along) * core * pow(along, 1.4) * diamonds * flick;
      gl_FragColor = vec4(c * 3.0 * uPower, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
});

const BEAM = () => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uPower: { value: 1 }, uCol: { value: new THREE.Color(0.25, 0.85, 1.0) } },
  vertexShader: /* glsl */`
    varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main() { vUv = uv; vN = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv; }`,
  fragmentShader: /* glsl */`
    uniform float uTime, uPower; uniform vec3 uCol;
    varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main() {
      float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
      float fade = pow(vUv.y, 2.2);                          // bright at the ship, gone at the tail
      float pulse = 0.8 + 0.2 * sin(vUv.y * 90.0 + uTime * 14.0);
      gl_FragColor = vec4(uCol * edge * fade * pulse * 1.3 * uPower, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
});

const SHEATH = () => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uHeat: { value: 0 } },
  vertexShader: /* glsl */`
    varying vec3 vN; varying vec3 vV; varying vec3 vObj;
    void main() { vObj = position; vN = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv; }`,
  fragmentShader: /* glsl */`
    uniform float uTime, uHeat;
    varying vec3 vN; varying vec3 vV; varying vec3 vObj;
    float h(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
    void main() {
      float fres = 1.0 - abs(dot(normalize(vN), normalize(vV)));
      float front = smoothstep(0.9, -0.6, vObj.z);           // the bow shock sits ahead of the nose
      float ang = atan(vObj.y, vObj.x);
      float streak = h(vec2(floor(ang * 18.0), floor(vObj.z * 3.0 + uTime * 26.0)));
      float i = (pow(fres, 1.5) * 1.3 + 0.25) * front * (0.7 + 0.6 * streak);
      vec3 c = mix(vec3(1.0, 0.36, 0.08), vec3(1.0, 0.85, 0.75), pow(front, 3.0) * (1.0 - fres));
      gl_FragColor = vec4(c * i * uHeat * 1.6, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
});

/* ------------------------------------------------------------------ rig -- */
/* The cockpit is a hole in the hull under the canopy: fragments of the hull
   inside the canopy's footprint are discarded, revealing the tub beneath. */
function cutCockpit(mat) {
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vShipPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShipPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vShipPos;')
      .replace('void main() {', `void main() {
        vec2 q = vec2(vShipPos.x / 0.80, (vShipPos.z + 3.6) / 1.95);
        if (vShipPos.y > 0.25 && dot(q, q) < 1.0) discard;`);
  };
  return mat;
}

function materials(tex) {
  return {
    hull: cutCockpit(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42, metalness: 0.35 })),
    dark: new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.55, metalness: 0.7 }),
    accent: new THREE.MeshStandardMaterial({ color: 0xd4581c, roughness: 0.5, metalness: 0.2 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0b1a20, roughness: 0.04, metalness: 0.9, transparent: true,
                                            opacity: 0.38, envMapIntensity: 2.4, depthWrite: false }),
    interior: new THREE.MeshStandardMaterial({ color: 0x2c2f35, roughness: 0.8, metalness: 0.2 }),
  };
}

/** Everything except the pilot. Shared by the flying ship and the wreck. */
function buildAirframe(M) {
  const root = new THREE.Group();
  const parts = {};
  parts.fuselage = new THREE.Mesh(fuselageGeometry(), M.hull);
  root.add(parts.fuselage);

  parts.wingR = new THREE.Mesh(wingGeometry(1), M.hull);
  parts.wingL = new THREE.Mesh(wingGeometry(-1), M.hull);
  parts.wingR.position.y = parts.wingL.position.y = -0.18;
  parts.wingR.rotation.z = -0.06; parts.wingL.rotation.z = 0.06;       // slight anhedral
  root.add(parts.wingR, parts.wingL);
  // wingtip accents
  for (const [w, s] of [[parts.wingR, 1], [parts.wingL, -1]]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 1.7), M.accent);
    tip.position.set(6.75 * s, 0.12, 4.3);
    w.add(tip);
  }

  parts.finR = new THREE.Mesh(finGeometry(), M.accent);
  parts.finL = new THREE.Mesh(finGeometry(), M.accent);
  parts.finR.position.set(0.85, 0.55, 0); parts.finR.rotation.z = -0.38;
  parts.finL.position.set(-0.85, 0.55, 0); parts.finL.rotation.z = 0.38;
  root.add(parts.finR, parts.finL);

  parts.nacelles = [];
  parts.nozzles = [];
  for (const s of [1, -1]) {
    const n = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 5.0, 28), M.dark);
    n.geometry.rotateX(Math.PI / 2);
    n.position.set(1.75 * s, -0.12, 4.0);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.07, 8, 28), M.accent);
    ring.position.z = -2.2;
    n.add(ring);
    const intake = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 0.3, 28, 1, true), M.interior);
    intake.geometry.rotateX(Math.PI / 2);
    intake.position.z = -2.6;
    n.add(intake);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.48, 0.9, 28, 1, true), M.dark);
    nozzle.geometry.rotateX(Math.PI / 2);
    nozzle.position.z = 2.9;
    nozzle.material = M.dark;
    n.add(nozzle);
    parts.nacelles.push(n); parts.nozzles.push(nozzle);
    root.add(n);
  }
  // dorsal spine and a few greebles that catch the light
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.22, 7.5), M.dark);
  spine.position.set(0, 0.86, 1.6);
  root.add(spine);
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.4), M.interior);
    b.position.set(i % 2 ? 0.5 : -0.5, 0.8, 2.5 + i * 0.7);
    root.add(b);
  }
  // the cockpit tub, seen through the opening cut in the hull
  const tub = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.9, metalness: 0.1, side: THREE.BackSide }));
  tub.scale.set(0.80, 0.75, 1.95);
  tub.position.set(0, 0.42, -3.6);
  root.add(tub);
  parts.canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), M.glass);
  parts.canopy.scale.set(0.86, 0.62, 2.1);
  parts.canopy.position.set(0, 0.42, -3.6);
  parts.canopy.renderOrder = 5;
  root.add(parts.canopy);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 6, 40, Math.PI), M.dark);
  frame.scale.set(0.86, 0.62, 1); frame.position.set(0, 0.42, -3.6);
  root.add(frame);

  root.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return { root, parts };
}

export class Ship {
  static async build({ envMap = null } = {}) {
    const M = materials(hullTexture());
    for (const m of Object.values(M)) if (envMap) { m.envMap = envMap; m.needsUpdate = true; }
    const ship = new Ship();
    const { root, parts } = buildAirframe(M);
    ship.root = root; ship.parts = parts; ship.M = M;

    // cockpit interior
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.10, 0.55), M.interior);
    seat.position.set(0, 0.20, -2.85);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.10), M.interior);
    back.position.set(0, 0.62, -2.42); back.rotation.x = -0.12;
    root.add(back);
    const console_ = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.28, 0.45), M.interior);
    console_.position.set(0, 0.42, -4.5); console_.rotation.x = -0.5;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45),
      new THREE.MeshBasicMaterial({ map: screenTexture(), toneMapped: false }));
    screen.position.set(0, 0.60, -4.32); screen.rotation.x = -0.45;   // faces the pilot (+Z), tilted up
    screen.material.color.setScalar(2.2);
    root.add(seat, console_, screen);
    ship.screen = screen;
    ship.cockpitLight = new THREE.PointLight(0x55d8ff, 3.0, 3.5, 2);
    ship.cockpitLight.position.set(0, 0.95, -4.0);
    ship.alarmLight = new THREE.PointLight(0xff2a1a, 0, 4.5, 2);
    ship.alarmLight.position.set(0, 1.0, -3.2);
    root.add(ship.cockpitLight, ship.alarmLight);

    // the pilot: the same support unit you will walk Jezero with
    const gltf = await new Promise((res, rej) => new GLTFLoader().load(COMPANION_MODEL, res, undefined, rej));
    const pilot = gltf.scene;
    pilot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(pilot);
    pilot.scale.setScalar(1.15 / Math.max(0.1, box.max.y - box.min.y));
    pilot.rotation.y = Math.PI;                        // authored facing +Z; the nose is -Z
    pilot.position.set(0, 0.02, -3.05);           // head and shoulders under the glass
    root.add(pilot);
    ship.pilot = pilot;
    ship.mixer = new THREE.AnimationMixer(pilot);
    ship.actions = Object.fromEntries(gltf.animations.map(c => [c.name, ship.mixer.clipAction(c)]));
    pilot.traverse(o => { if (o.isMesh && o.morphTargetDictionary && /head/i.test(o.name)) ship.face = o; });
    const sit = ship.actions.Sitting;
    if (sit) { sit.setLoop(THREE.LoopOnce, 1); sit.clampWhenFinished = true; sit.play(); }
    ship.mixer.update(3);                              // settle into the seat

    // engines: plumes and long energy beams
    ship.plumes = []; ship.beams = [];
    for (const n of parts.nacelles) {
      const plume = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.55, 7, 20, 1, true), PLUME());
      plume.geometry.rotateX(Math.PI / 2);               // tip toward +Z
      plume.geometry.translate(0, 0, 3.5);
      plume.position.z = 3.3;
      n.add(plume);
      ship.plumes.push(plume);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.32, 180, 12, 1, true), BEAM());
      beam.geometry.rotateX(Math.PI / 2);
      beam.geometry.translate(0, 0, 90);
      beam.position.z = 3.3;
      n.add(beam);
      ship.beams.push(beam);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.85, 1.0).multiplyScalar(3), toneMapped: false }));
      disc.position.z = 3.25;
      n.add(disc);
      (ship.discs ||= []).push(disc);
    }
    // nav lights: red port, green starboard, white tail strobe
    ship.nav = [];
    for (const [x, y, z, col] of [[-6.85, 0.1, 4.6, [8, 0.4, 0.3]], [6.85, 0.1, 4.6, [0.3, 8, 0.6]], [0, 1.0, 6.8, [9, 9, 9]]]) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(...col), toneMapped: false }));
      l.position.set(x, y, z);
      root.add(l);
      ship.nav.push(l);
    }
    // re-entry plasma sheath: an elongated shell standing ahead of the nose
    ship.sheath = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), SHEATH());
    ship.sheath.scale.set(3.6, 2.4, 10);
    ship.sheath.position.z = -1.5;
    ship.sheath.visible = false;
    root.add(ship.sheath);

    ship.throttle = 1; ship.heat = 0; ship.damage = 0; ship.t = 0;
    return ship;
  }

  setThrottle(v) { this.throttle = v; }
  setHeat(v) {
    this.heat = v;
    this.sheath.visible = v > 0.3;           // no bow shock once it is down in the thick air
    this.M.hull.emissive.setRGB(1.0, 0.32, 0.08);
    this.M.hull.emissiveIntensity = v * 0.35;
  }
  /** 0 intact, 1 port engine dead. */
  setDamage(v) { this.damage = v; }
  setExpression(name, w = 1) {
    if (!this.face) return;
    const i = this.face.morphTargetDictionary[name];
    const inf = this.face.morphTargetInfluences;
    for (let k = 0; k < inf.length; k++) inf[k] = k === i ? w : inf[k] * 0.9;
  }

  update(dt) {
    this.t += dt;
    const t = this.t;
    this.mixer.update(dt);
    for (let i = 0; i < this.plumes.length; i++) {
      // the port engine (index 1, x < 0) coughs and dies with damage
      const dead = i === 1 ? this.damage : 0;
      const cough = dead > 0 ? (Math.sin(t * 23) * Math.sin(t * 7.3) > 0.2 ? 0.35 : 0.0) : 1;
      const p = this.throttle * (dead > 0.99 ? 0 : (1 - dead) + dead * cough);
      this.plumes[i].material.uniforms.uTime.value = t;
      this.plumes[i].material.uniforms.uPower.value = p;
      this.plumes[i].visible = p > 0.01;
      this.beams[i].material.uniforms.uTime.value = t;
      this.beams[i].material.uniforms.uPower.value = p * (this.heat > 0.2 ? 0 : 1);
      this.beams[i].visible = this.beams[i].material.uniforms.uPower.value > 0.01;
      this.discs[i].material.color.setRGB(0.55, 0.85, 1.0).multiplyScalar(3 * Math.max(0.05, p));
    }
    this.nav[2].visible = (t % 1.4) < 0.08;
    for (const l of this.nav.slice(0, 2)) l.visible = this.damage < 0.5 || Math.sin(t * 30) > 0;
    this.sheath.material.uniforms.uTime.value = t;
    this.sheath.material.uniforms.uHeat.value = this.heat;
    this.screen.material.color.setScalar(this.damage > 0 ? (Math.sin(t * 9) > 0 ? 2.4 : 0.6) : 2.2);
    this.alarmLight.intensity = this.damage > 0 ? (Math.sin(t * 6.5) > 0 ? 1.6 : 0.15) : 0;
  }
}

/* ---------------------------------------------------------------- wreck -- */
/**
 * The Kestrel after it met Jezero: half-buried, rolled onto one side,
 * starboard wing torn off and thrown down the skid, hull scorched.
 * Positioned by the caller; `heightAt` seats the pieces on the real DTM.
 */
export function buildWreck(heightAt, at, heading) {
  const tex = hullTexture();
  const M = materials(tex);
  M.hull.color.setRGB(0.42, 0.38, 0.35);              // scorched paint
  M.hull.roughness = 0.85; M.hull.metalness = 0.25;
  M.hull.emissive.setRGB(1.0, 0.30, 0.06);
  M.hull.emissiveIntensity = 0.0;
  M.glass.opacity = 0.55; M.glass.color.setRGB(0.05, 0.05, 0.05);
  const { root, parts } = buildAirframe(M);
  root.remove(parts.wingR);
  parts.finL.rotation.z = 1.2;                         // a fin folded flat
  parts.nacelles[1].rotation.x = 0.35;                 // port engine knocked askew

  const group = new THREE.Group();
  const gy = heightAt(at.x, at.z);
  root.rotation.set(-0.07, 0, 0.32);                   // nose dug in, rolled to starboard
  root.position.set(0, -0.75, 0);                      // half a metre into the regolith
  group.add(root);
  group.position.set(at.x, gy, at.z);
  group.rotation.y = Math.atan2(-heading.x, -heading.z);

  // the torn wing, thrown back along the skid
  const wing = new THREE.Mesh(parts.wingR.geometry, M.hull);
  const back = { x: at.x - heading.x * 26 + heading.z * 6, z: at.z - heading.z * 26 - heading.x * 6 };
  wing.position.set(back.x, heightAt(back.x, back.z) + 0.1, back.z);
  wing.rotation.set(0.15, 1.9, 2.9);

  // hull fragments strewn down the furrow
  const pieces = new THREE.Group();
  const geos = [new THREE.BoxGeometry(1, 0.08, 0.7), new THREE.BoxGeometry(0.6, 0.3, 0.5), new THREE.CylinderGeometry(0.2, 0.2, 0.9, 10)];
  let seed = 19;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 34; i++) {
    const d = 4 + rnd() * 60, side = (rnd() - 0.5) * (6 + d * 0.25);
    const x = at.x - heading.x * d + heading.z * side, z = at.z - heading.z * d - heading.x * side;
    const m = new THREE.Mesh(geos[i % 3], i % 4 === 0 ? M.dark : M.hull);
    const s = 0.4 + rnd() * 1.4;
    m.scale.setScalar(s);
    m.position.set(x, heightAt(x, z) + 0.05 * s, z);
    m.rotation.set(rnd() * 3, rnd() * 6, rnd() * 3);
    pieces.add(m);
  }
  return { group, wing, pieces, materials: M, parts, radius: 7.5 };
}
