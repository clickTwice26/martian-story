import * as THREE from 'three';

/**
 * Procedural aerospace hardware kit for the survival campaign:
 * Salvage logistics cases, expandable surface habitat module, articulated GaAs solar wings,
 * solid-oxide O2 plant (MOXIE architecture), Kilopower surface nuclear reactor, and ascent vehicle.
 *
 * Built with procedural high-fidelity PBR Canvas textures (crinkled gold Kapton MLI thermal blankets,
 * triple-junction GaAs solar cell grids, Kevlar MMOD protective weaves, and aerospace stencils),
 * providing authentic NASA mission aesthetics with zero download footprint.
 *
 * Module builders return a THREE.Group whose local origin sits on the ground
 * at the module's centre; the caller places it and sets its yaw.
 */

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.25, ...o });
const glow = (color, opacity = 1) => new THREE.MeshBasicMaterial({
  color, transparent: opacity < 1, opacity, toneMapped: false, depthWrite: opacity >= 1 });

function shadowed(root) {
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return root;
}

/* -------------------------------------------------- Procedural PBR Canvas Textures -- */
let _solarTex = null;
function getSolarTexture() {
  if (_solarTex) return _solarTex;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');

  // Deep anti-reflective photovoltaic base
  g.fillStyle = '#0b162c';
  g.fillRect(0, 0, 512, 512);

  // 4x8 array of triple-junction GaAs solar cells with busbars
  const cols = 4, rows = 8;
  const cellW = 512 / cols, cellH = 512 / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = x * cellW + 3, py = y * cellH + 3;
      const pw = cellW - 6, ph = cellH - 6;

      // Dark crystalline gradient
      const grad = g.createLinearGradient(px, py, px + pw, py + ph);
      grad.addColorStop(0, '#152446');
      grad.addColorStop(0.5, '#0e1832');
      grad.addColorStop(1, '#1b1442');
      g.fillStyle = grad;
      g.fillRect(px, py, pw, ph);

      // Micro silver grid fingers
      g.strokeStyle = 'rgba(203, 213, 225, 0.28)';
      g.lineWidth = 1;
      for (let gy = py + 6; gy < py + ph - 4; gy += 7) {
        g.beginPath();
        g.moveTo(px + 4, gy);
        g.lineTo(px + pw - 4, gy);
        g.stroke();
      }

      // Dual main silver busbars
      g.strokeStyle = '#e2e8f0';
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(px + pw * 0.33, py);
      g.lineTo(px + pw * 0.33, py + ph);
      g.moveTo(px + pw * 0.67, py);
      g.lineTo(px + pw * 0.67, py + ph);
      g.stroke();

      // Corner bevel solder contacts
      g.fillStyle = '#f8fafc';
      g.fillRect(px + pw * 0.33 - 3, py + 2, 6, 4);
      g.fillRect(px + pw * 0.67 - 3, py + 2, 6, 4);
    }
  }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _solarTex = t;
  return t;
}

let _foilTex = null;
function getFoilTexture() {
  if (_foilTex) return _foilTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');

  // Gold Kapton / Mylar thermal blanket base
  g.fillStyle = '#d9941e';
  g.fillRect(0, 0, 256, 256);

  // Procedural crinkle facet highlights and creases
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const r = 10 + Math.random() * 28;
    const alpha = 0.12 + Math.random() * 0.22;
    g.fillStyle = (i % 2 === 0) ? `rgba(255, 235, 150, ${alpha})` : `rgba(140, 75, 10, ${alpha})`;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + r * (Math.random() - 0.5), y + r);
    g.lineTo(x + r, y + r * (Math.random() - 0.5));
    g.closePath();
    g.fill();
  }

  // Quilted thermal blanket seam tape & grommets
  g.strokeStyle = 'rgba(40, 25, 10, 0.45)';
  g.lineWidth = 2;
  g.strokeRect(4, 4, 248, 248);
  g.strokeRect(128, 4, 1, 248);
  g.strokeRect(4, 128, 248, 1);

  g.fillStyle = '#fef08a';
  for (let gx = 16; gx < 250; gx += 32) {
    for (let gy = 16; gy < 250; gy += 32) {
      g.beginPath();
      g.arc(gx, gy, 1.8, 0, Math.PI * 2);
      g.fill();
    }
  }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _foilTex = t;
  return t;
}

let _habTex = null;
function getHabTexture() {
  if (_habTex) return _habTex;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');

  // Multi-layer Nextel / Kevlar protective outer weave
  g.fillStyle = '#e8e4dc';
  g.fillRect(0, 0, 512, 512);

  // Micro-weave lattice
  g.fillStyle = 'rgba(0, 0, 0, 0.025)';
  for (let y = 0; y < 512; y += 4) {
    g.fillRect(0, y, 512, 1.5);
  }

  // High-visibility structural retention band
  g.fillStyle = '#ea580c';
  g.fillRect(0, 220, 512, 42);
  g.fillStyle = 'rgba(0,0,0,0.45)';
  for (let x = -20; x < 540; x += 36) {
    g.beginPath();
    g.moveTo(x, 220);
    g.lineTo(x + 16, 220);
    g.lineTo(x + 32, 262);
    g.lineTo(x + 16, 262);
    g.fill();
  }

  // NASA & Mission Stenciling
  g.fillStyle = '#0f172a';
  g.font = 'bold 36px ui-monospace, Menlo, Consolas, monospace';
  g.textAlign = 'center';
  g.fillText('NASA · JEZERO HABITAT-01', 256, 140);
  g.font = 'bold 18px ui-monospace, Menlo, Consolas, monospace';
  g.fillStyle = '#334155';
  g.fillText('PRESSURIZED MMOD EXPEDITION ENCLOSURE', 256, 175);
  g.fillText('STRUCTURAL INTEGRITY 70.3 kPa · AIRLOCK INTERFACE', 256, 320);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _habTex = t;
  return t;
}

/* -------------------------------------------------- PBR Material Palettes -- */
const MAT_WHITE = std(0xeeeeea, { roughness: 0.42, metalness: 0.1 });
const MAT_TITANIUM = std(0x9ca3af, { metalness: 0.75, roughness: 0.28 });
const MAT_DARK = std(0x1e2229, { metalness: 0.5, roughness: 0.45 });
const MAT_ORANGE = std(0xe05e26, { roughness: 0.45, metalness: 0.15 });
const MAT_COPPER = std(0xb87333, { metalness: 0.85, roughness: 0.25 });
const MAT_REGOLITH = std(0x9a6446, { roughness: 0.96, metalness: 0 });

/* ----------------------------------------------------------------- crates -- */
const _labelCache = new Map();
function labelTexture(text, accent) {
  const key = text + accent;
  if (_labelCache.has(key)) return _labelCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');

  // Hardened structural thermoplastic flight-case body
  g.fillStyle = '#dcd8ce';
  g.fillRect(0, 0, 512, 512);

  // Molded corner rib reinforcements
  g.fillStyle = '#262a30';
  g.fillRect(0, 0, 512, 28);
  g.fillRect(0, 484, 512, 28);
  g.fillRect(0, 0, 28, 512);
  g.fillRect(484, 0, 28, 512);

  // High-visibility classification hazard bands
  g.fillStyle = accent;
  g.fillRect(28, 48, 456, 68);
  g.fillRect(28, 396, 456, 68);

  // Contrast hazard chevrons
  g.fillStyle = 'rgba(15, 23, 42, 0.7)';
  for (let x = -20; x < 540; x += 44) {
    g.beginPath();
    g.moveTo(x, 48); g.lineTo(x + 22, 48); g.lineTo(x + 44, 116); g.lineTo(x + 22, 116); g.fill();
    g.beginPath();
    g.moveTo(x, 396); g.lineTo(x + 22, 396); g.lineTo(x + 44, 464); g.lineTo(x + 22, 464); g.fill();
  }

  // Pressure relief valve & latches graphics
  g.fillStyle = '#0f172a';
  g.fillRect(236, 18, 40, 16);
  g.fillRect(236, 478, 40, 16);

  // Typography
  g.fillStyle = '#0f172a';
  g.font = 'bold 76px ui-monospace, Menlo, Consolas, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 230);

  g.font = 'bold 24px ui-monospace, Menlo, Consolas, monospace';
  g.fillText('NASA · MARS LOGISTICS SYSTEM', 256, 295);
  g.font = '16px ui-monospace, Menlo, Consolas, monospace';
  g.fillStyle = '#475569';
  g.fillText('HERMETIC SEALS VERIFIED · SPEC 2020-MSR', 256, 335);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _labelCache.set(key, t);
  return t;
}

/** A salvage crate: a labelled box with ruggedized molded ribs and handles. */
export function makeCrate(code, accent, size = [0.66, 0.5, 0.62]) {
  const [w, h, d] = size;
  const mat = new THREE.MeshStandardMaterial({
    map: labelTexture(code, accent),
    roughness: 0.45,
    metalness: 0.2,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);

  // Heavy-duty structural corner bumpers and handle grips
  const railGeo = new THREE.BoxGeometry(0.06, h + 0.02, 0.06);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const r = new THREE.Mesh(railGeo, MAT_DARK);
      r.position.set(sx * (w / 2), 0, sz * (d / 2));
      mesh.add(r);
    }
  }

  // Flush recessed handles on port and starboard sides
  const handleGeo = new THREE.BoxGeometry(0.04, 0.12, 0.24);
  for (const sx of [-1, 1]) {
    const handle = new THREE.Mesh(handleGeo, MAT_TITANIUM);
    handle.position.set(sx * (w / 2 + 0.01), 0, 0);
    mesh.add(handle);
  }

  mesh.castShadow = mesh.receiveShadow = true;
  return { mesh, halfHeight: h / 2, radius: Math.max(w, d) / 2 };
}

/* ---------------------------------------------------------------- modules -- */

/** Inflatable surface habitat with structural airlock and avionics mast. */
export function makeHab() {
  const g = new THREE.Group();

  // 1. Quilted Inflatable Main Pressure Hull with Kevlar MMOD Shell
  const habMat = new THREE.MeshStandardMaterial({
    map: getHabTexture(),
    roughness: 0.52,
    metalness: 0.15,
  });
  const shell = new THREE.Mesh(new THREE.CapsuleGeometry(2.1, 3.2, 12, 32), habMat);
  shell.rotation.z = Math.PI / 2;
  shell.scale.set(1, 1, 0.94);
  shell.position.y = 1.85;
  g.add(shell);

  // 2. High-tensile Kevlar Restraint Ribs with Ratchet Blocks
  for (const x of [-1.3, 0, 1.3]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(2.14, 0.07, 8, 36), MAT_ORANGE);
    band.rotation.y = Math.PI / 2;
    band.position.set(x, 1.85, 0);
    band.scale.set(1, 1, 0.94);
    g.add(band);

    const ratchet = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.16), MAT_TITANIUM);
    ratchet.position.set(x, 3.92, 0);
    g.add(ratchet);
  }

  // 3. Precision Machined Titanium Airlock Module
  const lock = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 1.8, 24), MAT_TITANIUM);
  lock.rotation.x = Math.PI / 2;
  lock.position.set(0, 1.32, 2.45);
  g.add(lock);

  // Airlock Structural Bulkhead Flange
  const flange = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.06, 8, 28), MAT_DARK);
  flange.position.set(0, 1.32, 3.3);
  g.add(flange);

  // Exterior EVA Hatch with Pressure Equalization Wheel
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 0.12, 24), MAT_DARK);
  hatch.rotation.x = Math.PI / 2;
  hatch.position.set(0, 1.32, 3.35);
  g.add(hatch);

  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.04, 6, 20), MAT_ORANGE);
  wheel.position.set(0, 1.32, 3.42);
  g.add(wheel);

  // EVA Handrails (Safety Yellow / Amber)
  const railMat = std(0xfacc15, { roughness: 0.35 });
  for (const sx of [-0.85, 0.85]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 8), railMat);
    rail.position.set(sx, 1.35, 2.6);
    rail.rotation.x = Math.PI / 2;
    g.add(rail);
  }

  // Exterior Status & EVA Work Lamp
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), glow(0x7fe3ff));
  lamp.position.set(0, 2.22, 3.25);
  g.add(lamp);

  // Dorsal Fluid Radiator Loop
  const radFoil = new THREE.MeshStandardMaterial({
    map: getFoilTexture(),
    roughness: 0.25,
    metalness: 0.92,
  });
  const dorsalRadiator = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 1.2), radFoil);
  dorsalRadiator.position.set(0, 3.88, -0.4);
  g.add(dorsalRadiator);

  // 4. Outrigger Self-Leveling Ground Landing Struts
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 1.2, 10), MAT_TITANIUM);
      leg.position.set(sx * 2.35, 0.5, sz * 1.2);
      g.add(leg);

      const footPad = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.08, 14), MAT_DARK);
      footPad.position.set(sx * 2.35, 0.04, sz * 1.2);
      g.add(footPad);
    }
  }

  g.userData.lamp = lamp;
  return shadowed(g);
}

/** Regolith berm around the hab. scale.y is driven by how much has been piled. */
export function makeBerm() {
  const pts = [];
  pts.push(new THREE.Vector2(3.0, 0), new THREE.Vector2(3.3, 1), new THREE.Vector2(4.2, 1.15),
           new THREE.Vector2(5.4, 0.55), new THREE.Vector2(6.1, 0));
  const geo = new THREE.LatheGeometry(pts, 40);
  const m = new THREE.Mesh(geo, MAT_REGOLITH);
  m.scale.set(1.05, 0.001, 1.35);
  m.receiveShadow = m.castShadow = true;
  return m;
}

/** Solar array: Articulated high-efficiency GaAs triple-junction wings on a tracking gimbal. */
export function makeSolarArray() {
  const g = new THREE.Group();
  const tracker = new THREE.Group();
  tracker.position.y = 1.45;
  g.add(tracker);

  const solarMat = new THREE.MeshStandardMaterial({
    map: getSolarTexture(),
    roughness: 0.22,
    metalness: 0.65,
    emissive: 0x050c18,
  });

  const foilMat = new THREE.MeshStandardMaterial({
    map: getFoilTexture(),
    roughness: 0.25,
    metalness: 0.92,
  });

  // Four articulated solar panel wings
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.06, 7.6), solarMat);
    p.position.set((i - 1.5) * 2.18, 0, 0);
    tracker.add(p);

    // Carbon-composite frame perimeter
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.07, 7.66), MAT_DARK);
    frame.position.copy(p.position);
    frame.scale.set(1.01, 0.9, 1.005);
    tracker.add(frame);

    // Structural support truss mast
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 1.45, 8), MAT_TITANIUM);
    post.position.set((i - 1.5) * 2.18, 0.72, 0);
    g.add(post);
  }

  // Heavy-duty central solar tracking torque tube
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 8.9, 12), MAT_TITANIUM);
  beam.rotation.z = Math.PI / 2;
  tracker.add(beam);

  // Central tracking drive motor actuator wrapped in gold MLI foil
  const motorHub = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.65, 16), foilMat);
  motorHub.rotation.z = Math.PI / 2;
  tracker.add(motorHub);

  g.userData.tracker = tracker;
  return shadowed(g);
}

/** Solid-oxide CO2 electrolysis plant (MOXIE architecture): insulated core, SOEC stack, dewar. */
export function makeO2Plant() {
  const g = new THREE.Group();

  const foilMat = new THREE.MeshStandardMaterial({
    map: getFoilTexture(),
    roughness: 0.24,
    metalness: 0.92,
  });

  // 1. Primary Avionics & Compressor Chassis
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.65, 1.25, 1.15), MAT_WHITE);
  cab.position.y = 0.72;
  g.add(cab);

  // 2. 800°C High-Temperature SOEC Reaction Core (wrapped in gold Kapton MLI)
  const coreHousing = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.38, 1.18), foilMat);
  coreHousing.position.y = 1.22;
  g.add(coreHousing);

  // Heat sink dissipation ribs
  for (let z = -0.4; z <= 0.4; z += 0.2) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.04, 0.08), MAT_TITANIUM);
    fin.position.set(0, 1.38, z);
    g.add(fin);
  }

  // 3. Vacuum-Jacketed Stainless Cryogenic O2 Storage Dewar
  const dewar = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.38, 0.95, 8, 20),
    std(0xdbeafe, { metalness: 0.8, roughness: 0.22 })
  );
  dewar.position.set(1.3, 0.82, 0);
  g.add(dewar);

  // Pressure manifold & relief valves
  const manifold = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.04, 6, 18), MAT_COPPER);
  manifold.position.set(1.3, 0.82, 0);
  g.add(manifold);

  // 4. Mars Atmospheric Intake Cowl with Cyclonic Dust Separator
  const intakeStack = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 0.65, 16), MAT_DARK);
  intakeStack.position.set(-0.55, 1.6, 0);
  g.add(intakeStack);

  const filterCowl = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.24, 0.22, 16), MAT_TITANIUM);
  filterCowl.position.set(-0.55, 1.95, 0);
  g.add(filterCowl);

  // 5. Digital Telemetry Status LED
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.09, 0.02), glow(0x5cff9b));
  led.position.set(0, 0.98, 0.59);
  g.add(led);

  g.userData.led = led;
  return shadowed(g);
}

/** Regolith oven: Rotary heated drum, insulated hopper, copper condenser coil. */
export function makeOven() {
  const g = new THREE.Group();

  const foilMat = new THREE.MeshStandardMaterial({
    map: getFoilTexture(),
    roughness: 0.25,
    metalness: 0.92,
  });

  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 1.6, 22), MAT_TITANIUM);
  drum.rotation.z = Math.PI / 2;
  drum.position.y = 0.78;
  g.add(drum);

  // Gold insulated thermal jacket
  const drumJacket = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.8, 22), foilMat);
  drumJacket.rotation.z = Math.PI / 2;
  drumJacket.position.set(0, 0.78, 0);
  g.add(drumJacket);

  const hopper = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.28, 0.75, 18, 1, true),
    std(0x6b7280, { side: THREE.DoubleSide, metalness: 0.45 }));
  hopper.position.set(-0.4, 1.6, 0);
  g.add(hopper);

  // Copper condensation coil
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.06, 8, 24), MAT_COPPER);
  coil.position.set(0.98, 0.78, 0);
  coil.rotation.y = Math.PI / 2;
  g.add(coil);

  const heat = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.46, 24), glow(0xff6a2a, 0.0));
  heat.position.set(-0.81, 0.78, 0);
  heat.rotation.y = -Math.PI / 2;
  g.add(heat);

  g.userData.heat = heat;
  return shadowed(g);
}

/** Perchlorate purifier: Distillation column, ion exchange polishing beds, sight glass. */
export function makePurifier() {
  const g = new THREE.Group();

  const col = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.28, 1.75, 18),
    std(0xdbeafe, { metalness: 0.65, roughness: 0.25 })
  );
  col.position.y = 0.88;
  g.add(col);

  for (const x of [0.52, 0.9]) {
    const bed = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.95, 14), std(0x2563eb, { roughness: 0.35 }));
    bed.position.set(x, 0.48, 0);
    g.add(bed);

    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), MAT_TITANIUM);
    cap.position.set(x, 0.96, 0);
    g.add(cap);
  }

  const water = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.11, 0.03), glow(0x5fc8ff));
  water.position.set(0, 0.62, 0.29);
  g.add(water);

  g.userData.led = water;
  return shadowed(g);
}

/** Hydroponic greenhouse: Pressurized ETFE fluoropolymer half-dome over LED grow racks. */
export function makeGreenhouse() {
  const g = new THREE.Group();

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(2.45, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: 0xdbeafe,
      transparent: true,
      opacity: 0.32,
      roughness: 0.08,
      metalness: 0.12,
      depthWrite: false,
    })
  );
  dome.scale.set(1, 0.86, 1.25);
  g.add(dome);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.45, 0.09, 8, 40), MAT_TITANIUM);
  ring.rotation.x = Math.PI / 2;
  ring.scale.set(1, 1.25, 1);
  g.add(ring);

  const leaf = new THREE.MeshStandardMaterial({
    color: 0x22c55e,
    emissive: 0x15803d,
    emissiveIntensity: 0.65,
    roughness: 0.65,
  });

  const plants = new THREE.Group();
  for (let r = 0; r < 3; r++) {
    const rack = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 3.65), MAT_DARK);
    rack.position.set((r - 1) * 1.1, 0.31, 0);
    g.add(rack);
    for (let k = 0; k < 7; k++) {
      const p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), leaf);
      p.position.set((r - 1) * 1.1, 0.74, (k - 3) * 0.5);
      plants.add(p);
    }
  }
  g.add(plants);

  // Full-spectrum horticultural pink/purple LED illuminator bar
  const grow = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.04, 3.6), glow(0xf43f5e, 0.65));
  grow.position.y = 1.65;
  g.add(grow);

  g.userData.plants = plants;
  return shadowed(g);
}

/** NASA Kilopower (KRUSTY) 10 kWe surface nuclear fission reactor with deployable Stirling radiators. */
export function makeReactor() {
  const g = new THREE.Group();

  // Tubular titanium transport sled with terrain skids
  const sled = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.26, 3.3), MAT_DARK);
  sled.position.y = 0.14;
  g.add(sled);

  // Beryllium oxide neutron reflector ring surrounding cast uranium core vessel
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(0.48, 0.58, 1.65, 20),
    std(0xe2e8f0, { metalness: 0.85, roughness: 0.22 })
  );
  core.position.set(0, 1.08, -0.85);
  g.add(core);

  // Tungsten / Depleted Uranium radiation shadow shield
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 0.28, 20), MAT_DARK);
  shield.position.set(0, 0.38, -0.85);
  g.add(shield);

  // Dual Stirling power conversion engines
  const conv = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.25, 16), MAT_TITANIUM);
  conv.position.set(0, 0.94, 0.6);
  conv.rotation.x = Math.PI / 2;
  g.add(conv);

  // Deployable fan of curved titanium-water heat pipe radiator panels
  const fins = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 1.65, 2.45),
      std(0x334155, { metalness: 0.75, roughness: 0.3 })
    );
    const piv = new THREE.Group();
    piv.rotation.z = (i / 4) * Math.PI * 2 + Math.PI / 4;
    piv.position.set(0, 1.2, 0.9);
    fin.position.set(0, 0.95, 0);
    piv.add(fin);
    fins.add(piv);
  }
  fins.scale.setScalar(0.05); // folded during transport
  g.add(fins);

  // Ionizing radiation trefoil warning decal
  const tre = new THREE.Mesh(new THREE.RingGeometry(0.58, 0.65, 3), glow(0xfacc15));
  tre.position.set(0, 1.95, -0.85);
  tre.rotation.x = -Math.PI / 2;
  g.add(tre);

  g.userData.fins = fins;
  return shadowed(g);
}

/** Sabatier reactor + water electrolyser: Methane synthesis dewar, copper pipework. */
export function makeSabatier() {
  const g = new THREE.Group();

  const reactor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 1.95, 18),
    std(0x94a3b8, { metalness: 0.72, roughness: 0.26 })
  );
  reactor.position.set(-0.5, 0.98, 0);
  g.add(reactor);

  // Cryogenic Liquid Methane (CH4) Dewar Tank
  const ch4 = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.44, 1.05, 8, 16),
    std(0x3b82f6, { metalness: 0.6, roughness: 0.3 })
  );
  ch4.position.set(0.55, 0.92, 0);
  g.add(ch4);

  // High-purity copper transfer loop
  const pipe = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.05, 8, 20, Math.PI), MAT_COPPER);
  pipe.position.set(0, 1.85, 0);
  g.add(pipe);

  const led = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.09, 0.02), glow(0x60a5fa));
  led.position.set(0.55, 1.42, 0.45);
  g.add(led);

  g.userData.led = led;
  return shadowed(g);
}

/** The Kestrel's cockpit pod & Mars Ascent Vehicle (MAV) with PICA-X heat shield. */
export function makeCapsule() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);

  // 1. Aerodynamic Biconic Composite Hull
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(1.22, 1.48, 1.65, 24), MAT_WHITE);
  cyl.position.y = 1.92;
  body.add(cyl);

  const cone = new THREE.Mesh(new THREE.ConeGeometry(1.22, 1.95, 24), MAT_WHITE);
  cone.position.y = 3.7;
  body.add(cone);

  // Racing Orange NASA Logistics Stripe
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.235, 1.29, 0.26, 24), MAT_ORANGE);
  stripe.position.y = 2.28;
  body.add(stripe);

  // Gold-Coated Cockpit Multi-Pane Visor
  const win = new THREE.Mesh(
    new THREE.BoxGeometry(0.92, 0.32, 0.06),
    new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      metalness: 0.88,
      roughness: 0.15,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.3,
    })
  );
  win.position.set(0, 2.94, 1.0);
  win.rotation.x = -0.5;
  body.add(win);

  // 2. PICA-X Ablative Heat Shield & Main Ascent Rocket Engine Bell
  const bell = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.68, 0.72, 20, 1, true),
    std(0x18181b, { metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide })
  );
  bell.position.y = 0.86;
  body.add(bell);

  // 3. Four Shock-Absorbing Hydraulic Landing Struts with Articulating Footpads
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.95, 8), MAT_TITANIUM);
    leg.position.set(Math.cos(a) * 1.38, 0.76, Math.sin(a) * 1.38);
    leg.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45);
    g.add(leg);

    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 0.09, 12), MAT_DARK);
    pad.position.set(Math.cos(a) * 1.78, 0.05, Math.sin(a) * 1.78);
    g.add(pad);
  }

  // 4. Illuminated Liquid Propellant Quantity Indicator
  const gauge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.25, 0.06), glow(0x22c55e));
  gauge.position.set(1.38, 1.92, 0);
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
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, n * 2, 0.065, 8), MAT_ORANGE);
  m.castShadow = true;
  return m;
}

/* ---------------------------------------------------------------- markers -- */
/** Objective beacon: an amber pillar of light with a pulsing ground ring. */
export function makeBeacon(color = 0xffb347) {
  const g = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 40, 6, 1, true),
    glow(color, 0.38)
  );
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
    const a = (i / n) * Math.PI * 2;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    pts.push(x, hf.heightAt(x, z) + 0.12, z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const line = new THREE.LineLoop(
    geo,
    new THREE.LineDashedMaterial({
      color,
      dashSize: 0.9,
      gapSize: 0.6,
      transparent: true,
      opacity: 0.85,
      toneMapped: false,
    })
  );
  line.computeLineDistances();
  return line;
}
