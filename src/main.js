import * as THREE from 'three';
import { Heightfield } from './heightfield.js';
import { Terrain } from './terrain.js';
import { createMarsSky } from './sky.js';
import { Player, MARS_G, SETTINGS } from './player.js';
import { Astronaut } from './astronaut.js';
import { SuitAudio } from './audio.js';
import { Settings } from './settings.js';
import { Input } from './input.js';
import { Companion } from './companion.js';
import { RockField } from './detail.js';
import { buildSettingsUI } from './settingsui.js';
import { siteTime, missionSol, season, formatSolClock, sunDirection,
         utcForSolAndLmst, JEZERO, SOL_SECONDS } from './marstime.js';

const R_MARS = 3396190.0;
const DEG = Math.PI / 180;
const el = id => document.getElementById(id);
const status = s => { el('loadStatus').textContent = s; };
const bar = f => { el('loadBar').style.transform = `scaleX(${Math.max(0, Math.min(1, f))})`; };

function makeProjector(meta, anchorCol, anchorRow) {
  const { xLeft, yTop } = meta.projected;
  const mpp = meta.metresPerPixel;
  return {
    lonLatToWorld: (lon, lat) => [
      ((lon * DEG * R_MARS - xLeft) / mpp - anchorCol) * mpp,
      ((yTop - lat * DEG * R_MARS) / mpp - anchorRow) * mpp,
    ],
    worldToLonLat: (x, z) => [
      (xLeft + (x / mpp + anchorCol) * mpp) / R_MARS / DEG,
      (yTop - (z / mpp + anchorRow) * mpp) / R_MARS / DEG,
    ],
    lonLatToTexel: (lon, lat) => [
      (lon * DEG * R_MARS - xLeft) / mpp,
      (yTop - lat * DEG * R_MARS) / mpp,
    ],
  };
}

/* 8-bit mask: the browser decodes this losslessly, unlike the 16-bit heightmap. */
async function loadMask(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, img.width, img.height).data;
  const arr = new Uint8Array(img.width * img.height);
  for (let i = 0; i < arr.length; i++) arr[i] = px[i * 4];
  const tex = new THREE.Texture(img);
  tex.colorSpace = THREE.NoColorSpace;          // data, not colour
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { tex, arr, width: img.width, height: img.height };
}

/* ----------------------------------------------------------------- setup -- */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
el('app').appendChild(renderer.domElement);
if (!renderer.capabilities.isWebGL2) { status('WebGL2 required.'); throw new Error('WebGL2 required'); }

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(SETTINGS.view.fov, innerWidth / innerHeight, 0.18, 60000);
const SUN_DIR = new THREE.Vector3(0.58, 0.62, -0.53).normalize();
const settings = new Settings();
/* Simulated Mars clock. Held separately from the settings values so the sliders
   act as a set-point the user drags, while time advances freely underneath
   without hammering localStorage sixty times a second. */
const timeState = { sol: settings.get('missionSol'), lmst: settings.get('localTime'), st: null };
settings.listeners.push((k, v) => {
  if (k === 'missionSol') timeState.sol = v;
  if (k === 'localTime') timeState.lmst = v;
});
scene.add(createMarsSky(SUN_DIR));
const sky = scene.children[0];

/* Lights exist for the astronaut's MeshStandardMaterials only. Intensities are
   pi-scaled to match the terrain shader's own lighting, since three divides
   diffuse by pi and the custom terrain shader does not. */
const sunLight = new THREE.DirectionalLight(0xffe9d4, 2.10 * Math.PI);
sunLight.position.copy(SUN_DIR).multiplyScalar(120);
scene.add(sunLight);
scene.add(new THREE.HemisphereLight(0xc79a6d, 0x4a2e20, 0.62 * Math.PI));

const audio = new SuitAudio();
let hf, terrain, player, projector, waypoints, mask, astronaut, blobShadow, companion, rocks;
/* Shared with the overlay materials so the rover track bends with the ground
   instead of floating off it at range. */
const uCamPosC = { value: new THREE.Vector3() };
const uCurvatureC = { value: 1 / (2 * 3396190) };

/** Bend a built-in material's geometry by the same curvature as the terrain. */
function bendWithPlanet(material) {
  material.onBeforeCompile = shader => {
    shader.uniforms.uCamPosC = uCamPosC;
    shader.uniforms.uCurvatureC = uCurvatureC;
    shader.vertexShader = 'uniform vec3 uCamPosC;\nuniform float uCurvatureC;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      `#include <begin_vertex>
       {
         float cdx = transformed.x - uCamPosC.x;
         float cdz = transformed.z - uCamPosC.z;
         transformed.y -= (cdx * cdx + cdz * cdz) * uCurvatureC;
       }`);
  };
  material.needsUpdate = true;
  return material;
}
let viewMode = 'third';                       // 'first' | 'third'
let bodyYaw = 0, camBoom = 3.4;
const input = new Input(null, {});     // canvas bound once the renderer exists
let last = performance.now() / 1000, fps = 60, frames = 0, fpsT = 0;

async function boot() {
  status('Loading rover traverse…');
  const [wp, trav, meta] = await Promise.all([
    fetch('data/m20_waypoints.json').then(r => r.json()),
    fetch('data/m20_traverse.json').then(r => r.json()),
    fetch('data/jezero_base.json').then(r => r.json()),
  ]);
  waypoints = wp.features;

  const p0 = waypoints[0].properties;
  const [aCol, aRow] = makeProjector(meta, 0, 0).lonLatToTexel(p0.lon, p0.lat);
  const anchorCol = Math.round(aCol), anchorRow = Math.round(aRow);
  projector = makeProjector(meta, anchorCol, anchorRow);

  status('Decoding 16-bit elevation (8192 × 4096)…');
  hf = await Heightfield.load('data/jezero_base.png', 'data/jezero_base.json',
                              { col: anchorCol, row: anchorRow }, f => bar(f * 0.78));

  status('Loading DTM validity mask…');
  mask = await loadMask('data/jezero_base_mask.png');
  bar(0.86);

  status('Building terrain quadtree…');
  await new Promise(r => setTimeout(r, 16));
  // 16 m leaves over a 64-segment patch give 0.25 m vertex spacing near the
  // camera, which is what makes sub-metre ripples representable at all.
  terrain = new Terrain(hf, { leafSize: 16, splitK: 2.7 });
  terrain.material.uniforms.uSunDir.value.copy(SUN_DIR);
  terrain.material.uniforms.uMask.value = mask.tex;
  terrain.material.uniforms.uMaskSize.value.set(mask.width, mask.height);
  scene.add(terrain.mesh);
  bar(0.93);

  status('Placing rover traverse…');
  buildTraverse(trav, waypoints);

  status('Loading crew model…');
  astronaut = await Astronaut.load(undefined, f => bar(0.93 + f * 0.05));
  scene.add(astronaut.root);
  console.info('[crew] model height %.2f m, clips: %s',
               astronaut.measuredHeight, astronaut.availableClips.join(', '));
  blobShadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.46, 22),
    new THREE.MeshBasicMaterial({ color: 0x1a0d07, transparent: true, opacity: 0.34, depthWrite: false })
  );
  blobShadow.rotation.x = -Math.PI / 2;
  scene.add(blobShadow);

  status('Scattering surface detail…');
  rocks = new RockField(hf);
  scene.add(rocks.mesh);

  status('Waking support unit…');
  companion = await Companion.load(hf);
  companion.say = (text, ms) => {
    if (!settings.get('companionChatter')) return;
    const b = el('companionSay');
    b.textContent = text;
    b.dataset.until = String(performance.now() + ms);
  };
  scene.add(companion.root);
  scene.add(companion.marker);     // the beacon it plants at whatever it wants to show you

  player = new Player(hf);
  player.placeAt(0, 0);
  companion.placeNear(0, 0);
  player.aimYaw = player.yaw = bodyYaw = 2.3;
  player.aimPitch = player.pitch = -0.05;
  player.events.footstep = (i, slope) => audio.footstep(i, slope);
  player.events.land = imp => audio.land(imp);

  el('elevRange').textContent = `${meta.elevMin.toFixed(1)} … ${meta.elevMax.toFixed(1)} m`;
  el('dataNote').textContent =
    `${meta.width}×${meta.height} @ ${meta.metresPerPixel} m/px · ` +
    `${(meta.widthMetres / 1000).toFixed(1)}×${(meta.heightMetres / 1000).toFixed(1)} km`;
  bar(1);
  // ---- settings: bind to the live engine, then apply everything at once ----
  settings.bind({
    renderer, terrain, sky, audio, camera, companion, hf, rocks,
    curvature: uCurvatureC,
    settings: SETTINGS,
    traverseLine: window.__traverseLine,
    waypointPoints: window.__waypointPoints,
    onResize: () => applyViewport(),
  });
  settingsUI = buildSettingsUI(settings, el('settings'), closeSettings, input);
  viewMode = settings.get('viewMode') === 'First Person' ? 'first' : 'third';
  settings.listeners.push((k, v) => {
    if (k === 'viewMode') viewMode = v === 'First Person' ? 'first' : 'third';
  });

  // Bind input to the real canvas and surface its state to the player.
  input.onModeChange = () => paintInputBadge();
  input.onNotice = msg => showNotice(msg);
  input.attach(renderer.domElement);
  input.deserialize(settings.get('keybinds'));
  paintInputBadge();

  el('startBtn').addEventListener('click', beginPlay);
  renderer.domElement.addEventListener('click', () => {
    if (!settingsOpen && input.mode !== 'locked') beginPlay();
  });

  el('loading').classList.add('hidden');
  el('startOverlay').classList.remove('hidden');   // never un-hidden before: the bug
  window.__mars = { THREE, scene, camera, renderer, hf, terrain, player, projector,
                    waypoints, astronaut, audio, mask, SETTINGS, settings, timeState, input, companion, rocks,
                    sky, sunLight, SUN_DIR,
                    setMarsTime: (sol, lmst) => { timeState.sol = sol; timeState.lmst = lmst; },
                    get viewMode() { return viewMode; },
                    get settingsOpen() { return settingsOpen; },
                    openSettings: () => openSettings(), closeSettings: () => closeSettings() };
  requestAnimationFrame(frame);
}

function buildTraverse(trav, wps) {
  const pts = [];
  for (const f of trav.features) {
    const c = f.geometry.coordinates;
    for (let i = 0; i + 1 < c.length; i++)
      for (const [lon, lat] of [c[i], c[i + 1]]) {
        const [x, z] = projector.lonLatToWorld(lon, lat);
        pts.push(x, hf.heightAt(x, z) + 0.45, z);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const line = new THREE.LineSegments(g, bendWithPlanet(new THREE.LineBasicMaterial({
    color: 0x35e0ff, transparent: true, opacity: 0.8, toneMapped: false })));
  line.frustumCulled = false;
  scene.add(line);
  window.__traverseLine = line;

  const mp = [], mc = [];
  const maxSol = wps[wps.length - 1].properties.sol || 1;
  const cold = new THREE.Color(0x1f6f8f), hot = new THREE.Color(0xffd27a), tmp = new THREE.Color();
  for (const f of wps) {
    const pr = f.properties;
    const [x, z] = projector.lonLatToWorld(pr.lon, pr.lat);
    mp.push(x, hf.heightAt(x, z) + 0.9, z);
    tmp.copy(cold).lerp(hot, (pr.sol || 0) / maxSol);
    mc.push(tmp.r, tmp.g, tmp.b);
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(mp, 3));
  pg.setAttribute('color', new THREE.Float32BufferAttribute(mc, 3));
  const pnt = new THREE.Points(pg, bendWithPlanet(new THREE.PointsMaterial({
    size: 4, sizeAttenuation: false, vertexColors: true, toneMapped: false })));
  pnt.frustumCulled = false;
  scene.add(pnt);
  window.__waypointPoints = pnt;
}

/** CPU-side mask lookup, matching the shader's base-texel / 4 mapping. */
function isMeasured(x, z) {
  if (!mask) return true;
  const c = Math.round((x / hf.mpp + hf.anchorCol) * 0.25);
  const r = Math.round((z / hf.mpp + hf.anchorRow) * 0.25);
  if (c < 0 || r < 0 || c >= mask.width || r >= mask.height) return false;
  return mask.arr[r * mask.width + c] > 127;
}

/* ----------------------------------------------------------------- input -- */
let settingsUI = null, settingsOpen = false, hasCaptured = false;

function showNotice(msg, ms = 5600) {
  const n = el('notice');
  n.textContent = msg;
  n.classList.add('show');
  clearTimeout(showNotice._t);
  showNotice._t = setTimeout(() => n.classList.remove('show'), ms);
}
function paintInputBadge() {
  const b = el('inputMode');
  if (!b) return;
  b.textContent = input.mode === 'locked' ? 'MOUSE CAPTURED'
                : input.mode === 'drag'   ? 'DRAG TO LOOK'
                : 'CLICK TO CAPTURE';
  b.className = 'badge ' + input.mode;
}

function openSettings() {
  if (!settingsUI) return;
  settingsOpen = true;
  input.enabled = false;
  input.clearKeys();
  settingsUI.refreshAll();
  el('settings').classList.add('open');
  el('startOverlay').classList.add('hidden');
}
function closeSettings() {
  settingsOpen = false;
  input.enabled = true;
  el('settings').classList.remove('open');
  input.requestCapture();                  // still inside the click gesture
}

/**
 * Pointer lock MUST be requested synchronously inside the user gesture.
 * The previous version awaited audio.start() first, which spent the gesture
 * and made the browser refuse the lock - leaving the mouse dead with no error.
 */
function beginPlay() {
  input.requestCapture();
  audio.start().catch(() => {});
  el('startOverlay').classList.add('hidden');
  hasCaptured = true;
}

addEventListener('keydown', e => {
  if (e.code !== 'Escape') return;
  if (settingsOpen) { e.preventDefault(); closeSettings(); }
  else if (input.mode !== 'locked') { e.preventDefault(); openSettings(); }
  // While locked, the browser consumes Escape to exit the lock; the menu then
  // opens from pointerlockchange below.
}, true);

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (locked) {
    hasCaptured = true;
    if (settingsOpen) { settingsOpen = false; input.enabled = true; el('settings').classList.remove('open'); }
    el('startOverlay').classList.add('hidden');
  } else if (hasCaptured && !settingsOpen && !input.lockFailed) {
    openSettings();
  }
  paintInputBadge();
});

/** Edge-triggered actions, polled once per frame. */
function pollActions() {
  if (settingsOpen) return;
  if (input.consume('toggleView')) {
    settings.set('viewMode', viewMode === 'first' ? 'Third Person' : 'First Person');
    audio.beep('mode');
  }
  if (input.consume('surveyMode')) {
    player.mode = player.mode === 'walk' ? 'fly' : 'walk';
    if (player.mode === 'walk') { player.vel.set(0, 0, 0); player.pos.y = hf.heightAt(player.pos.x, player.pos.z); }
    audio.beep('mode');
  }
  if (input.consume('respawn')) { player.placeAt(0, 0); audio.beep('ok'); }
  if (input.consume('roverTrack')) settings.set('roverTrack', !settings.get('roverTrack'));
  if (input.consume('gapOverlay')) { settings.set('gapOverlay', !settings.get('gapOverlay')); audio.beep('mode'); }
  if (input.consume('headBob')) { settings.set('headBob', !settings.get('headBob')); audio.beep('mode'); }
  if (input.consume('mute')) settings.set('enabled', !settings.get('enabled'));
  if (input.consume('timeBack')) { timeState.lmst = (timeState.lmst - 0.25 + 24) % 24; audio.beep('ok'); }
  if (input.consume('timeFwd')) { timeState.lmst = (timeState.lmst + 0.25) % 24; audio.beep('ok'); }
  if (input.consume('sensDown')) { settings.set('sensitivity', Math.max(0.02, settings.get('sensitivity') - 0.015)); audio.beep('ok'); }
  if (input.consume('sensUp')) { settings.set('sensitivity', Math.min(0.60, settings.get('sensitivity') + 0.015)); audio.beep('ok'); }
  if (input.consume('companion') && companion) {
    if (input.isDown('sprint')) {          // SHIFT+H: heel, or let it range again
      companion.heel = !companion.heel;
      companion.emote(companion.heel ? 'Yes' : 'ThumbsUp');
      companion._speak(companion.heel
        ? 'Staying with you.'
        : 'Ranging out again — I will call when I find something.', 3600);
    } else {
      // summon: it drops what it is doing and comes to you
      companion.heel = false;
      companion.poi = null;
      companion.marker.visible = false;
      companion._setMode('regroup');
      companion.emote('Yes', 'Surprised');
      companion._speak(
        `On my way — ${Math.round(Math.hypot(player.pos.x - companion.pos.x, player.pos.z - companion.pos.z))} m out.`, 3600);
    }
    audio.beep('ok');
  }
  if (input.consume('cycleRT')) {
    const tiers = ['Off', 'Low', 'Medium', 'High', 'Ultra'];
    const next = tiers[(tiers.indexOf(settings.get('rayTracing')) + 1) % tiers.length];
    settings.set('rayTracing', next);
    showNotice(`Terrain ray tracing: ${next}`, 2200);
    audio.beep('mode');
  }
}

/* ------------------------------------------------------------------ loop -- */
const TIME_RATES = { 'Paused': 0, '1x': 1, '60x': 60, '600x': 600, '3600x': 3600 };
const LMST_PER_REAL_SECOND = 24 / SOL_SECONDS;   // a sol is 88,775.244 s, not 86,400

function updateMarsTimeAndSun(dt) {
  const mode = settings.get('timeMode');
  const rate = TIME_RATES[settings.get('timeScale')] || 0;

  if (mode === 'Live Mars Time') {
    timeState.st = siteTime(new Date(), JEZERO.lonEast, JEZERO.latNorth);
    timeState.sol = missionSol(new Date());
    timeState.lmst = timeState.st.lmst;
  } else {
    if (mode === 'Mission Sol' && rate > 0) {
      timeState.lmst += dt * rate * LMST_PER_REAL_SECOND;
      while (timeState.lmst >= 24) { timeState.lmst -= 24; timeState.sol += 1; }
      while (timeState.lmst < 0) { timeState.lmst += 24; timeState.sol -= 1; }
    }
    const when = utcForSolAndLmst(timeState.sol, timeState.lmst);
    timeState.st = siteTime(when, JEZERO.lonEast, JEZERO.latNorth);
  }

  const st = timeState.st;
  if (settings.get('sunMode') === 'Manual')
    sunDirection(settings.get('sunElevation'), settings.get('sunAzimuth'), SUN_DIR);
  else
    sunDirection(st.elevation, st.azimuth, SUN_DIR);
  SUN_DIR.normalize();

  terrain.material.uniforms.uSunDir.value.copy(SUN_DIR);
  sky.material.uniforms.uSunDir.value.copy(SUN_DIR);
  sunLight.position.copy(SUN_DIR).multiplyScalar(140);

  // Fade the direct beam through twilight; the dusty sky keeps lighting the
  // ground for a while after the sun is technically below the horizon.
  const alt = SUN_DIR.y;
  const day = Math.max(0, Math.min(1, (alt + 0.09) / 0.22));
  sunLight.intensity = 2.10 * Math.PI * day;
  terrain.material.uniforms.uSunColor.value.setRGB(1.0, 0.86 + 0.06 * day, 0.70 + 0.13 * day)
    .multiplyScalar(0.25 + 0.75 * day);
  const night = 1 - day;
  terrain.material.uniforms.uSkyColor.value.setHex(0xc79a6d).multiplyScalar(0.18 + 0.82 * day);
  terrain.material.uniforms.uFogColor.value.setHex(0xb98c63).multiplyScalar(0.16 + 0.84 * day);
  sky.material.uniforms.uOpacity.value = 0.10 + 0.90 * day;
}

const _fwd = new THREE.Vector3(), _right = new THREE.Vector3();
const _pivot = new THREE.Vector3(), _desired = new THREE.Vector3(), _probe = new THREE.Vector3();

function updateCamera(dt) {
  player.forward(_fwd);
  _right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));

  if (viewMode === 'first' || player.mode === 'fly') {
    astronaut.setVisible(false);
    blobShadow.visible = false;
    const eye = player.eye;
    camera.position.set(eye.x + _right.x * player.bobX, eye.y, eye.z + _right.z * player.bobX);
    camera.lookAt(camera.position.x + _fwd.x, camera.position.y + _fwd.y, camera.position.z + _fwd.z);
    camera.rotateZ(player.roll);
    return;
  }

  astronaut.setVisible(true);
  blobShadow.visible = true;
  _pivot.set(player.pos.x, player.pos.y + 1.22 + player.bobY * 0.5, player.pos.z);

  // March the boom and stop before it would clip the terrain.
  const boom = SETTINGS.view.camDistance;
  let allowed = boom;
  for (let i = 1; i <= 10; i++) {
    const t = (i / 10) * boom;
    _probe.set(_pivot.x - _fwd.x * t, _pivot.y - _fwd.y * t + 0.30, _pivot.z - _fwd.z * t);
    if (_probe.y < hf.heightAt(_probe.x, _probe.z) + 0.55) { allowed = (i - 1) / 10 * boom; break; }
  }
  camBoom += (Math.max(0.9, allowed) - camBoom) * Math.min(1, dt * (allowed < camBoom ? 22 : 5));

  _desired.set(
    _pivot.x - _fwd.x * camBoom + _right.x * 0.42,
    _pivot.y - _fwd.y * camBoom + 0.34,
    _pivot.z - _fwd.z * camBoom + _right.z * 0.42);
  camera.position.copy(_desired);
  camera.lookAt(_pivot.x + _fwd.x * 2.2, _pivot.y + _fwd.y * 2.2 + 0.1, _pivot.z + _fwd.z * 2.2);
  camera.rotateZ(player.roll * 0.6);
}

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000;
  let dt = now - last; last = now;
  if (dt > 0.05) dt = 0.05;

  updateMarsTimeAndSun(dt);
  pollActions();
  const look = input.consumeLook();
  if (look.x || look.y) player.applyMouse(look.x, look.y);
  player.update(dt, input.state());
  audio.update(dt, player.exertion);

  // body turns toward travel when moving, toward the view when idle
  const hs = Math.hypot(player.vel.x, player.vel.z);
  const wantYaw = hs > 0.25 ? Math.atan2(player.vel.x, player.vel.z) : player.yaw;
  let d = (wantYaw - bodyYaw) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2;
  bodyYaw += d * Math.min(1, dt * (hs > 0.25 ? 7 : 3));

  astronaut.root.position.set(player.pos.x, player.pos.y, player.pos.z);
  astronaut.root.rotation.y = bodyYaw;
  astronaut.animate(dt, player.gaitPhase, player.speed01, !player.onGround, player.lean);

  const gy = hf.heightAt(player.pos.x, player.pos.z);
  blobShadow.position.set(player.pos.x, gy + 0.03, player.pos.z);
  const lift = Math.max(0, player.pos.y - gy);
  blobShadow.scale.setScalar(1 + lift * 0.28);
  blobShadow.material.opacity = 0.34 / (1 + lift * 0.9);

  if (companion && companion.root.visible) {
    companion.update(dt, { player, projector, waypoints, isMeasured, timeState, settings });
  }

  updateCamera(dt);
  uCamPosC.value.copy(camera.position);
  if (rocks && rocks.mesh.visible) rocks.update(camera.position.x, camera.position.z);
  updateCompanionBubble();
  sky.position.copy(camera.position);
  sky.scale.setScalar(camera.far * 0.45);
  if (camera.fov !== SETTINGS.view.fov) { camera.fov = SETTINGS.view.fov; camera.updateProjectionMatrix(); }

  terrain.update(camera);
  renderer.render(scene, camera);

  frames++; fpsT += dt;
  if (fpsT > 0.35) { fps = frames / fpsT; frames = 0; fpsT = 0; updateHUD(); }
}

const _proj = new THREE.Vector3();
function updateCompanionBubble() {
  const b = el('companionSay');
  if (!companion || !companion.root.visible || !b.textContent) { b.classList.remove('show'); return; }
  if (performance.now() > Number(b.dataset.until || 0)) { b.classList.remove('show'); b.textContent = ''; return; }
  _proj.set(companion.pos.x, companion.pos.y + 1.55, companion.pos.z).project(camera);
  if (_proj.z > 1 || Math.abs(_proj.x) > 1.6 || Math.abs(_proj.y) > 1.6) { b.classList.remove('show'); return; }
  // Clamp inside the viewport: anchored to a world point, the bubble would
  // otherwise hang off the edge and wrap to one word per line.
  b.classList.add('show');
  const w = b.offsetWidth || 240, h = b.offsetHeight || 60, pad = 12;
  let x = (_proj.x * 0.5 + 0.5) * innerWidth;
  let y = (-_proj.y * 0.5 + 0.5) * innerHeight;
  x = Math.max(w / 2 + pad, Math.min(innerWidth - w / 2 - pad, x));
  y = Math.max(h + pad, Math.min(innerHeight - pad, y));
  b.style.left = x + 'px';
  b.style.top = y + 'px';
}

function updateHUD() {
  const [lon, lat] = projector.worldToLonLat(player.pos.x, player.pos.z);
  el('hudLon').textContent = lon.toFixed(5) + '°E';
  el('hudLat').textContent = lat.toFixed(5) + '°N';
  el('hudElev').textContent = player.pos.y.toFixed(1) + ' m';
  el('hudSlope').textContent = player.slope.toFixed(1) + '°';
  el('hudSpeed').textContent = Math.hypot(player.vel.x, player.vel.z).toFixed(2) + ' m/s';
  el('hudMode').textContent = player.mode === 'walk'
    ? (viewMode === 'third' ? 'EVA · 3RD' : 'EVA · 1ST') : 'SURVEY';
  el('hudFps').textContent = fps.toFixed(0);
  el('hudNodes').textContent = terrain.stats.nodes;
  el('hudTris').textContent = (terrain.stats.tris / 1e6).toFixed(2) + ' M';
  if (rocks) el('hudRocks').textContent = rocks.count;
  el('hudSens').textContent = SETTINGS.mouse.sensitivity.toFixed(3) + '°/cnt';
  el('hudExert').textContent = Math.round(player.exertion * 100) + '%';

  const measured = isMeasured(player.pos.x, player.pos.z);
  const d = el('hudTerrain');
  d.textContent = measured ? 'MEASURED' : 'INTERPOLATED';
  d.style.color = measured ? '#8fd88f' : '#e8a45c';

  const st = timeState.st;
  if (st) {
    el('hudMarsSol').textContent = `SOL ${timeState.sol}`;
    el('hudLmst').textContent = formatSolClock(timeState.lmst);
    el('hudMarsSub').textContent =
      `LMST · Ls ${st.ls.toFixed(1)}° ${season(st.ls)} · MY${st.marsYear} · SUN ${st.elevation.toFixed(1)}°`;
  }

  let best = null, bd = Infinity;
  for (const f of waypoints) {
    const pr = f.properties;
    const [x, z] = projector.lonLatToWorld(pr.lon, pr.lat);
    const dd = (x - player.pos.x) ** 2 + (z - player.pos.z) ** 2;
    if (dd < bd) { bd = dd; best = pr; }
  }
  if (best) {
    el('hudSol').textContent = `SOL ${best.sol} · SITE ${best.site}`;
    el('hudSolDist').textContent = Math.sqrt(bd).toFixed(0) + ' m away';
  }
}

/** Named so settings can re-apply the viewport after a resolution-scale change. */
function applyViewport() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', applyViewport);

boot().catch(e => {
  status('FAILED: ' + e.message);
  el('loadBar').style.background = '#e05a3a';
  console.error(e);
});
