import * as THREE from 'three';
import { Heightfield } from './heightfield.js';
import { Terrain, GRID_OPTIONS } from './terrain.js';
import { createMarsSky } from './sky.js';
import { Player, MARS_G, SETTINGS } from './player.js';
import { Astronaut } from './astronaut.js';
import { SuitAudio } from './audio.js';
import { Settings } from './settings.js';
import { Input } from './input.js';
import { Companion } from './companion.js';
import { RockField } from './detail.js';
import { LightCache } from './lightcache.js';
import { buildSettingsUI, keyName } from './settingsui.js';
import { CharacterActions, LIFT_MAX } from './actions.js';
import { Interactables, PropSet, RockSource } from './interact.js';
import { Intro, WreckSite, crashLayout, INTRO_LMST } from './intro/intro.js';
import { Survival } from './survival/survival.js';
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

/**
 * First run only: guess whether this is a low-power GPU before anything is
 * drawn, so the first impression is not a slideshow. A throwaway context is
 * enough to read the renderer string - and MSAA has to be decided before the
 * real context exists. The adaptive loop still tunes from measured frame times.
 */
function detectLowPowerGPU() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (/swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(name)) return name;
    if (/\b(intel|mali|adreno|powervr|videocore)\b/i.test(name) && !/\barc\b/i.test(name)) return name;
    if ((navigator.hardwareConcurrency || 8) <= 4 && (navigator.deviceMemory || 8) <= 4) return name;
  } catch (e) { /* no verdict: keep the defaults */ }
  return null;
}

/* ----------------------------------------------------------------- setup -- */
const settings = new Settings();
const lowPowerGPU = settings.fromStore ? null : detectLowPowerGPU();
if (lowPowerGPU) settings.applyPreset('Low');

const renderer = new THREE.WebGLRenderer({ antialias: !!settings.get('antialias'), powerPreference: 'high-performance' });
const antialiasActive = !!settings.get('antialias');
/* Pixel ratio = the user's chosen scale x an adaptive factor (<= 1) that the
   frame loop lowers when the GPU cannot hold the target frame rate, and
   restores once it can. The user's choice is a ceiling, never exceeded.
   lod is the same idea for terrain triangles: a multiplier on Terrain Detail. */
const res = { base: 1, dyn: 1, lod: 1 };
function applyPixelRatio() {
  renderer.setPixelRatio(Math.min(devicePixelRatio * res.base, 2.5) * res.dyn);
}
applyPixelRatio();
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
el('app').appendChild(renderer.domElement);
if (!renderer.capabilities.isWebGL2) { status('WebGL2 required.'); throw new Error('WebGL2 required'); }

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(SETTINGS.view.fov, innerWidth / innerHeight, 0.18, 60000);
const SUN_DIR = new THREE.Vector3(0.58, 0.62, -0.53).normalize();
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
let hf, terrain, lightCache, player, projector, waypoints, mask, astronaut, blobShadow, companion, rocks;
let props, interactables, actions, grabMarker;
let wreck = null, intro = null, crash = null;
let survival = null, survivalModal = false;
const SPAWN = { x: 0, z: 0, yaw: 2.3 };
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
    // The track floats 0.45 m up, but at 1 km a 24-bit depth buffer only
    // resolves ~0.3 m (~3 m at 3 km) and WebGL has no polygon offset for
    // lines, so without MSAA it z-fights into dashes. Scaling the view-space
    // position toward the eye leaves it on exactly the same pixels and only
    // pulls its depth forward, by a fraction of its range.
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>',
      `#include <project_vertex>
       gl_Position = projectionMatrix * vec4(mvPosition.xyz * 0.996, 1.0);`);
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
  lightCache = new LightCache(renderer, terrain);
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

  // Loose bodies (rocks you have picked up, dropped or knocked over) and the
  // registry the crew member's hands search.
  props = new PropSet(hf);
  scene.add(props.group);
  interactables = new Interactables().register(props).register(new RockSource(rocks, props));
  grabMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffc86a, transparent: true, opacity: 0.55,
                                  depthWrite: false, toneMapped: false }));
  grabMarker.visible = false;
  scene.add(grabMarker);

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
  player.placeAt(SPAWN.x, SPAWN.z);
  _body.pos = player.pos; _body.vel = player.vel;
  // Where the Kestrel came down, ahead of the player: the wreck is part of the
  // world whether or not the opening is watched.
  crash = crashLayout(SPAWN, SPAWN.yaw);
  wreck = new WreckSite(scene, hf, crash);
  wreck.prewarm(20);
  companion.placeNear(SPAWN.x, SPAWN.z);
  companion.pos.set(crash.robot.x, hf.heightAt(crash.robot.x, crash.robot.z), crash.robot.z);
  companion.root.position.copy(companion.pos);
  player.aimYaw = player.yaw = bodyYaw = SPAWN.yaw;
  player.aimPitch = player.pitch = -0.05;
  player.events.footstep = (i, slope) => audio.footstep(i, slope);
  player.events.land = imp => audio.land(imp);
  setupActions();
  if (settings.get('storyMode')) {
    survival = new Survival({
      scene, hf, crash, wreck, player, companion, actions, props, audio, timeState, camera,
      isMeasured, notice: (m, ms) => showNotice(m, ms),
    });
    survival.onJournal = open => {
      survivalModal = open;
      input.enabled = !open;
      input.clearKeys();
      if (open) { if (document.pointerLockElement) document.exitPointerLock(); }
      else input.requestCapture();
    };
  }

  el('elevRange').textContent = `${meta.elevMin.toFixed(1)} … ${meta.elevMax.toFixed(1)} m`;
  el('dataNote').textContent =
    `${meta.width}×${meta.height} @ ${meta.metresPerPixel} m/px · ` +
    `${(meta.widthMetres / 1000).toFixed(1)}×${(meta.heightMetres / 1000).toFixed(1)} km`;
  bar(1);
  // ---- settings: bind to the live engine, then apply everything at once ----
  settings.bind({
    renderer, terrain, lightCache, sky, audio, camera, companion, hf, rocks,
    res, applyPixelRatio,
    curvature: uCurvatureC,
    settings: SETTINGS,
    traverseLine: window.__traverseLine,
    waypointPoints: window.__waypointPoints,
    onResize: () => applyViewport(),
    antialiasActive,
    notify: (msg, ms) => showNotice(msg, ms),
  });

  // The opening plays out at golden hour; the world keeps that light after it.
  const playIntro = !!settings.get('introCinematic');
  if (playIntro && settings.get('timeMode') === 'Mission Sol') timeState.lmst = INTRO_LMST;

  // Trace the sunlight now, behind the loading screen. Otherwise the first
  // frames fall back to ray marching every pixel live while the cache fills -
  // around three times the cost of a normal frame, which on a weak GPU means
  // the opening seconds of play are a slideshow.
  status('Tracing sunlight across the DTM…');
  updateMarsTimeAndSun(0);
  for (let i = 0; i < 64; i++) {
    lightCache.update(player.pos, SUN_DIR, 1 << 20);
    if (!lightCache.queue.length) break;
    await new Promise(r => setTimeout(r, 0));
  }

  if (playIntro) {
    try {
      intro = new Intro({
        renderer, scene, hf, companion, wreck, layout: crash, audio,
        lowQuality: settings.get('terrainMesh') === 'Low', antialias: antialiasActive,
        renderWorld, gameplayCamera, animatePlayer: dt => astronaut.animate(dt, player.gaitPhase, 0, false, 0),
        showPlayer: v => {
          astronaut.setVisible(v); blobShadow.visible = v;
          astronaut.root.position.copy(player.pos); astronaut.root.rotation.y = bodyYaw;
        },
        setHud: v => { el('hud').style.display = v ? '' : 'none'; },
        onDone: introDone,
      });
      await intro.prepare(status);
    } catch (e) {
      console.warn('opening cinematic unavailable', e);
      intro = null;
    }
  }

  // three.js compiles each material on its first draw. On integrated GPUs a
  // driver compile of the terrain shader alone can take seconds, which would
  // land as a freeze right after "Click to explore" - so pay it here instead,
  // with everything that can appear (rock chunks, the beacon) in the scene.
  status('Compiling shaders…');
  rocks.update(player.pos.x, player.pos.z);
  const markerWasVisible = companion.marker.visible;
  companion.marker.visible = true;
  grabMarker.visible = true;
  try {
    // compileAsync only helps (and otherwise warns) with parallel compile support
    if (renderer.extensions.has('KHR_parallel_shader_compile')) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
  } catch (e) { console.warn('precompile', e); }
  companion.marker.visible = markerWasVisible;
  grabMarker.visible = false;
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
  if (intro) {
    el('startBtn').textContent = 'BEGIN';
    el('startHint').textContent = 'A short opening plays first. Hold SPACE or press ESC to skip it.';
  }
  el('startOverlay').classList.remove('hidden');   // never un-hidden before: the bug
  if (lowPowerGPU) showNotice('Low-power GPU detected — using the Low quality preset. ESC → Settings to change it.', 7000);
  window.__mars = { THREE, scene, camera, renderer, hf, terrain, player, projector, intro, wreck, crash,
                    waypoints, astronaut, audio, mask, SETTINGS, settings, timeState, input, companion, rocks, lightCache, res,
                    sky, sunLight, SUN_DIR, actions, props, interactables, survival,
                    setMarsTime: (sol, lmst) => { timeState.sol = sol; timeState.lmst = lmst; },
                    get viewMode() { return viewMode; },
                    get settingsOpen() { return settingsOpen; },
                    openSettings: () => openSettings(), closeSettings: () => closeSettings() };
  requestAnimationFrame(frame);
}

/**
 * Punch, defend, grab. The controller is generic (see actions.js); this is
 * only the player's wiring: feedback for each event, and nothing else.
 */
function setupActions() {
  actions = new CharacterActions({
    world: interactables,
    ground: (x, z) => hf.heightAt(x, z),
    dims: astronaut.rig.dims,
  });
  const kg = m => m < 10 ? m.toFixed(1) : Math.round(m);
  actions.events = {
    onPunch: () => { audio.swing(1); player.exertion = Math.min(1, player.exertion + 0.04); },
    onThrow: (p, v) => { audio.swing(1.3); player.exertion = Math.min(1, player.exertion + 0.08); },
    onPickUp: p => {
      survival?.onPickUp(p);
      audio.thud(0.4);
      if (p.mass > LIFT_MAX * 0.5) audio.exhaleSharp();
      player.exertion = Math.min(1, player.exertion + p.mass / LIFT_MAX * 0.25);
    },
    onDrop: p => audio.thud(0.3 + Math.min(1, p.mass / LIFT_MAX)),
    onHit: ({ item, moved }) => {
      audio.thud(0.9);
      if (!moved) showNotice(`Solid ${item.label} — about ${kg(item.mass)} kg. It does not budge.`, 2400);
    },
    onStrike: ({ point }) => {
      if (!companion) return;
      const dx = point.x - companion.pos.x, dz = point.z - companion.pos.z;
      const dy = point.y - (companion.pos.y + 0.9);
      if (dx * dx + dy * dy + dz * dz > 0.8 * 0.8) return;
      audio.thud(0.6);
      companion.emote('No', 'Angry');
      companion._speak('Hey! Careful with the hardware.', 2600);
    },
    onFail: (why, it) => {
      if (why === 'nothing') showNotice('Nothing within reach to pick up.', 1800);
      else if (why === 'too-big')
        showNotice(`That ${it.label} is ${(it.radius * 2).toFixed(2)} m across — too wide to get your arms around.`, 2800);
      else if (why === 'too-heavy') {
        audio.exhaleSharp();
        showNotice(`About ${kg(it.mass)} kg of basalt. Only ${kg(it.mass * MARS_G / 9.80665)} kg-force on Mars, ` +
                   `but still too heavy to lift.`, 3200);
      }
    },
  };
  // something landing hard nearby: felt through the ground more than heard
  props.onImpact = (p, speed) => {
    const d = Math.hypot(p.position.x - player.pos.x, p.position.z - player.pos.z);
    const s = Math.min(1.2, speed / 4) * Math.min(1, p.mass / 20) / (1 + d / 5);
    if (s > 0.05) audio.thud(s);
  };
}

/** The pick-up prompt, and a ring on the ground around what would be taken. */
function updateActionHUD() {
  const pr = el('actionPrompt');
  const key = a => keyName(input.codesFor(a)[0] || input.codesFor(a)[1]);
  const kg = m => m < 10 ? m.toFixed(1) : Math.round(m);
  let text = '';
  // A story station (inflate, refill, rest...) takes E unless a story item is in reach.
  const station = survival && player.mode === 'walk' && actions.state !== 'carry' ? survival.prompt : '';
  const c = player.mode === 'walk' && !station ? actions.candidate : null;
  if (actions.held && actions.state === 'carry') {
    text = `<b>${key('grab')}</b> put down &nbsp; <b>${key('punch')}</b> throw &nbsp; · ${actions.held.label} ${kg(actions.held.mass)} kg`;
  } else if (station) {
    text = `<b>${key('grab')}</b> ${station}`;
  } else if (c) {
    const heavy = c.mass > LIFT_MAX;
    text = `<b>${key('grab')}</b> ${heavy ? 'try to lift' : 'pick up'} &nbsp; · ${c.label} ~${kg(c.mass)} kg` +
           (heavy ? ' <i>(heavy)</i>' : '') + (survival ? survival.describe(c) : '');
  }
  if (pr.innerHTML !== text) pr.innerHTML = text;
  pr.classList.toggle('show', !!text);

  grabMarker.visible = !!c;
  if (c) {
    grabMarker.position.set(c.position.x, hf.heightAt(c.position.x, c.position.z) + 0.03, c.position.z);
    grabMarker.scale.setScalar(c.radius + 0.12);
    grabMarker.material.color.setHex(c.mass > LIFT_MAX ? 0xe06a4a : 0xffc86a);
  }
}

/**
 * The 45 km traverse is split into 1 km tiles, each its own draw with a real
 * bounding sphere, so only the stretches inside the view frustum are drawn
 * instead of the whole track every frame.
 */
function buildTraverse(trav, wps) {
  const TILE = 1024;
  const tiles = new Map();
  for (const f of trav.features) {
    const c = f.geometry.coordinates;
    for (let i = 0; i + 1 < c.length; i++) {
      const [x0, z0] = projector.lonLatToWorld(c[i][0], c[i][1]);
      const [x1, z1] = projector.lonLatToWorld(c[i + 1][0], c[i + 1][1]);
      const key = Math.floor(x0 / TILE) + ',' + Math.floor(z0 / TILE);
      let t = tiles.get(key);
      if (!t) tiles.set(key, t = []);
      t.push(x0, hf.heightAt(x0, z0) + 0.45, z0, x1, hf.heightAt(x1, z1) + 0.45, z1);
    }
  }
  const lineMat = bendWithPlanet(new THREE.LineBasicMaterial({
    color: 0x35e0ff, transparent: true, opacity: 0.8, toneMapped: false }));
  const line = new THREE.Group();
  for (const pts of tiles.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.computeBoundingSphere();
    // The shader bends the track down by d^2/2R: at the far edge of the tile
    // that is ~40 m, so pad the sphere or tiles would be culled while visible.
    g.boundingSphere.radius += 40;
    line.add(new THREE.LineSegments(g, lineMat));
  }
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
  const audioReady = audio.start().catch(() => {});
  el('startOverlay').classList.add('hidden');
  hasCaptured = true;
  // the score needs the audio context, which only exists after this gesture
  if (intro && !intro.done && !intro.active) audioReady.finally(() => intro.start());
  else if (survival && !survival.running && (!intro || intro.done)) survival.begin();
}

/** Draw the live world from an arbitrary camera (the opening's act III). */
function renderWorld(cam) {
  uCamPosC.value.copy(cam.position);
  sky.position.copy(cam.position);
  sky.scale.setScalar(cam.far * 0.45);
  if (rocks && rocks.mesh.visible) rocks.update(cam.position.x, cam.position.z);
  terrain.update(cam);
  _viewFrustum.setFromProjectionMatrix(_viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  lightCache.update(cam.position, SUN_DIR);
  renderer.render(scene, cam);
}

/** Where the gameplay camera will be at the spawn, so the opening can land on it. */
function gameplayCamera() {
  player.forward(_fwd);
  _right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  const fov = SETTINGS.view.fov;
  if (viewMode === 'first') {
    const eye = player.eye.clone();
    return { pos: eye, target: eye.clone().add(_fwd), fov };
  }
  const pivot = new THREE.Vector3(player.pos.x, player.pos.y + 1.22, player.pos.z);
  const boom = SETTINGS.view.camDistance;
  return {
    pos: new THREE.Vector3(pivot.x - _fwd.x * boom + _right.x * 0.42, pivot.y - _fwd.y * boom + 0.34,
                           pivot.z - _fwd.z * boom + _right.z * 0.42),
    target: new THREE.Vector3(pivot.x + _fwd.x * 2.2, pivot.y + _fwd.y * 2.2 + 0.1, pivot.z + _fwd.z * 2.2),
    fov,
  };
}

function introDone(skipped) {
  camBoom = SETTINGS.view.camDistance;
  companion._greeted = true;               // it has already spoken, in the film
  companion._setMode('roam');
  if (survival) survival.begin();
  else if (skipped) companion.say?.('Kestrel is gone, Commander. Perseverance\u2019s tracks are close \u2014 follow me.', 6000);
  if (input.mode !== 'locked') {
    el('startBtn').textContent = 'CLICK TO EXPLORE';
    el('startHint').textContent = 'Mouse look needs pointer lock. If your browser refuses it, hold the left mouse button and drag to look instead \u2014 both work.';
    el('startOverlay').classList.remove('hidden');
  }
}

addEventListener('keydown', e => {
  if (e.code !== 'Escape') return;
  if (intro && intro.active) { e.preventDefault(); intro.skip(); return; }
  if (survivalModal) return;                 // the journal closes itself
  if (settingsOpen) { e.preventDefault(); closeSettings(); }
  else if (input.mode !== 'locked') { e.preventDefault(); openSettings(); }
  // While locked, the browser consumes Escape to exit the lock; the menu then
  // opens from pointerlockchange below.
}, true);

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (intro && intro.active) {
    // ESC during the film releases the lock: treat it as "skip"
    if (!locked) intro.skip();
    paintInputBadge();
    return;
  }
  if (locked) {
    hasCaptured = true;
    if (settingsOpen) { settingsOpen = false; input.enabled = true; el('settings').classList.remove('open'); }
    el('startOverlay').classList.add('hidden');
  } else if (hasCaptured && !settingsOpen && !input.lockFailed && !survivalModal) {
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
    actions.dropNow();                     // nobody flies off with a boulder
    if (player.mode === 'walk') { player.vel.set(0, 0, 0); player.pos.y = hf.heightAt(player.pos.x, player.pos.z); }
    audio.beep('mode');
  }
  if (input.consume('respawn')) { actions.dropNow(); player.placeAt(0, 0); audio.beep('ok'); }
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
  // Character actions only exist on foot.
  const punch = input.consume('punch'), grab = input.consume('grab');
  if (player.mode === 'walk' && !(survival && (survival.paused || survival.ending))) {
    if (punch) actions.punch();
    if (grab && !(survival && survival.interact())) actions.grab();
  }
  if (input.consume('journal') && survival && survival.running) survival.toggleJournal();
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
  // While the story runs it owns the clock: one Mars minute per real second.
  const storyRate = survival ? survival.clockRate() : null;
  const mode = storyRate !== null ? 'Mission Sol' : settings.get('timeMode');
  const rate = storyRate !== null ? storyRate : TIME_RATES[settings.get('timeScale')] || 0;

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

  // A dust storm: the sun dims, the haze closes in and turns ochre.
  const storm = survival ? survival.storm : 0;
  terrain.material.uniforms.uFogDensity.value = settings.get('fogDensity') * (1 + 16 * storm);
  if (storm > 0.002) {
    sunLight.intensity *= 1 - 0.78 * storm;
    terrain.material.uniforms.uSunColor.value.multiplyScalar(1 - 0.7 * storm);
    terrain.material.uniforms.uFogColor.value.lerp(_stormFog, storm * 0.6);
  }
}
const _stormFog = new THREE.Color(0x8a5a34);

const _fwd = new THREE.Vector3(), _right = new THREE.Vector3();
const _body = { pos: null, vel: null, yaw: 0, aimYaw: 0 };   // what CharacterActions acts from
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
  const rawDt = dt;
  if (dt > 0.05) dt = 0.05;

  if (intro && intro.active) {
    updateMarsTimeAndSun(dt);
    intro.update(rawDt);
    adaptResolution(rawDt);
    frames++; fpsT += rawDt;
    if (fpsT > 0.35) { fps = frames / fpsT; frames = 0; fpsT = 0; }
    return;
  }

  updateMarsTimeAndSun(dt);
  input.pollPad();
  pollActions();
  const look = input.consumeLook();
  if (look.x || look.y) player.applyMouse(look.x, look.y);
  // What the hands are doing limits the legs: no sprinting with a boulder.
  const st = input.state();
  if (survival && (survival.paused || survival.ending)) { st.axisX = st.axisY = 0; st.forward = st.back = st.left = st.right = st.jump = st.sprint = false; }
  actions.setDefend(player.mode === 'walk' && input.isDown('defend'));
  if (player.mode === 'walk') {
    st.axisX *= actions.moveScale; st.axisY *= actions.moveScale;
    if (!actions.canSprint) st.sprint = false;
    if (!actions.canJump) st.jump = false;
  }
  player.update(dt, st);
  if (wreck && wreck.pushOut(player.pos)) { player.vel.multiplyScalar(0.5); }
  if (survival && survival.collide(player.pos)) { player.vel.multiplyScalar(0.5); }
  audio.update(dt, player.exertion);

  // Body turns toward travel when moving, toward the view when idle, and
  // squares up to whatever an action is aimed at. In first person nobody sees
  // the body, but the hands still work from it, so it follows the view.
  const hs = Math.hypot(player.vel.x, player.vel.z);
  const facing = viewMode === 'first' ? player.yaw : actions.faceYaw;
  const wantYaw = facing ?? (hs > 0.25 ? Math.atan2(player.vel.x, player.vel.z) : player.yaw);
  let d = (wantYaw - bodyYaw) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2;
  bodyYaw += d * Math.min(1, dt * (facing != null ? 10 : hs > 0.25 ? 7 : 3));

  _body.yaw = bodyYaw; _body.aimYaw = player.yaw;
  actions.update(dt, _body);
  // Stepping in to pick something up: short, slow paces the gait can follow.
  if (actions.stepTo && player.onGround) {
    const dx = actions.stepTo.x - player.pos.x, dz = actions.stepTo.z - player.pos.z;
    const dd = Math.hypot(dx, dz), sp = Math.min(0.9, Math.max(0.35, dd * 3));
    if (dd > 0.02) { player.vel.x = dx / dd * sp; player.vel.z = dz / dd * sp; }
  }
  props.update(dt);

  astronaut.root.position.set(player.pos.x, player.pos.y, player.pos.z);
  astronaut.root.rotation.y = bodyYaw;
  // Nobody sees the crew body in first person or survey mode; skip the skinning.
  if (viewMode === 'third' && player.mode !== 'fly')
    astronaut.animate(dt, player.gaitPhase, player.speed01, !player.onGround, player.lean, actions.pose);

  const gy = hf.heightAt(player.pos.x, player.pos.z);
  blobShadow.position.set(player.pos.x, gy + 0.03, player.pos.z);
  const lift = Math.max(0, player.pos.y - gy);
  blobShadow.scale.setScalar(1 + lift * 0.28);
  blobShadow.material.opacity = 0.34 / (1 + lift * 0.9);

  if (companion && companion.root.visible) {
    companion.animEvery = companionAnimRate();
    companion.update(dt, { player, projector, waypoints, isMeasured, timeState, settings });
  }

  if (survival) survival.update(dt, { sunElevation: Math.asin(Math.max(-1, Math.min(1, SUN_DIR.y))) * 180 / Math.PI, camera });
  if (!(survival && survival.driveCamera(camera))) updateCamera(dt);
  if (survival && survival.hidePlayer) { astronaut.setVisible(false); blobShadow.visible = false; }
  uCamPosC.value.copy(camera.position);
  if (rocks && rocks.mesh.visible) rocks.update(camera.position.x, camera.position.z);
  if (wreck) wreck.update(dt);
  if (intro) intro.updateAfter(dt);
  updateCompanionBubble();
  updateActionHUD();
  sky.position.copy(camera.position);
  sky.scale.setScalar(camera.far * 0.45);
  if (camera.fov !== SETTINGS.view.fov) { camera.fov = SETTINGS.view.fov; camera.updateProjectionMatrix(); }

  terrain.update(camera);
  _viewFrustum.setFromProjectionMatrix(_viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  lightCache.update(camera.position, SUN_DIR);
  renderer.render(scene, camera);

  adaptResolution(rawDt);
  frames++; fpsT += rawDt;           // the clamped dt would floor the readout at 20 fps
  if (fpsT > 0.35) { fps = frames / fpsT; frames = 0; fpsT = 0; updateHUD(); }
}

/* ------------------------------------------------ range & view awareness -- */
const _viewFrustum = new THREE.Frustum(), _viewProj = new THREE.Matrix4();
const _compSphere = new THREE.Sphere(new THREE.Vector3(), 1.4);

/**
 * How often the support unit's skeleton is re-posed: every frame up close,
 * less often as it shrinks with distance, and not at all while it is off
 * screen. Its AI and movement still run every frame regardless. Uses last
 * frame's frustum, which is one frame stale at most.
 */
function companionAnimRate() {
  _compSphere.center.set(companion.pos.x, companion.pos.y + 0.9, companion.pos.z);
  if (!_viewFrustum.intersectsSphere(_compSphere)) return 0;
  const d = camera.position.distanceTo(_compSphere.center);
  return d < 35 ? 1 : d < 90 ? 2 : 4;
}

/**
 * Adaptive quality. Two levers, because a GPU can run short of either:
 * pixels (fill - the terrain shader's cost scales with them) and triangles
 * (the terrain is one instanced patch per quadtree node, and on integrated
 * GPUs it is vertex-bound: lowering resolution alone just blurs the image
 * without buying a single frame). Cost goes with the square of each, so when
 * the frame rate sags both drop by the square root of the shortfall, and both
 * creep back once there is headroom. While either is lowered the lighting
 * cache re-bakes in thinner slices, so a moving sun cannot add a fixed slab
 * of ray marching to frames that are already late.
 *
 * Last resort, for a weak GPU the first-run check did not recognise: if both
 * levers sit at their floors and it is still too slow, the terrain mesh steps
 * down a density for the rest of the session. That one is not undone
 * automatically - at a 60 Hz cap there is never the headroom to prove the
 * denser mesh would fit - but choosing a mesh or preset in Settings restores it.
 */
const dynRes = { t: 0, n: 0, warm: 3, MIN: 0.5, LOD_MIN: 0.6, pinned: 0 };
function stepMeshDown() {
  const lower = Object.values(GRID_OPTIONS).filter(g => g < terrain.grid);
  if (!lower.length) return;
  terrain.setGrid(Math.max(...lower));
  dynRes.warm = 1.5;                         // judge the new mesh on its own frames
  showNotice(`Frame rate still low — terrain mesh lowered to ${terrain.grid} segments for this session.`, 4200);
}
function adaptResolution(frameDt) {
  dynRes.t += frameDt; dynRes.n++;
  if (dynRes.t < 0.75) return;
  const fps = dynRes.n / dynRes.t;
  dynRes.t = 0; dynRes.n = 0;
  if ((dynRes.warm -= 0.75) > 0) return;     // shader compiles and first bakes are not the steady state
  let nextRes = res.dyn, nextLod = res.lod;
  if (!settings.get('adaptiveRes')) { nextRes = 1; nextLod = 1; }
  else if (!settingsOpen) {
    const target = settings.get('targetFps');
    if (fps < target * 0.88) {
      const step = Math.max(0.75, Math.sqrt(fps / target));
      nextRes = Math.max(dynRes.MIN, res.dyn * step);
      nextLod = Math.max(dynRes.LOD_MIN, res.lod * step);
      const atFloor = res.dyn <= dynRes.MIN && res.lod <= dynRes.LOD_MIN;
      dynRes.pinned = atFloor ? dynRes.pinned + 1 : 0;
      if (dynRes.pinned >= 2) { dynRes.pinned = 0; stepMeshDown(); }
    } else if (fps > target * 0.96) {
      dynRes.pinned = 0;
      nextRes = Math.min(1, res.dyn * 1.06);
      nextLod = Math.min(1, res.lod * 1.06);
    }
  }
  // Snap to 5% steps: every pixel-ratio change reallocates the framebuffer,
  // itself a hitch, so it must not twitch by fractions of a percent.
  nextRes = nextRes >= 1 ? 1 : Math.max(dynRes.MIN, Math.round(nextRes * 20) / 20);
  if (nextRes !== res.dyn) { res.dyn = nextRes; applyPixelRatio(); }
  res.lod = nextLod;
  terrain.lodScale = nextLod;
  lightCache.budgetScale = res.dyn < 0.995 || res.lod < 0.995 ? 0.25 : 1;
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
  el('hudRes').textContent = renderer.getPixelRatio().toFixed(2) + 'x' +
    (res.dyn < 0.995 ? ' (auto)' : '');
  el('hudLod').textContent = Math.round(res.lod * 100) + '%' + (res.lod < 0.995 ? ' (auto)' : '') +
    ' · ' + terrain.grid;
  el('hudLight').textContent = terrain.material.uniforms.uLightCache.value ? 'CACHED'
    : terrain.material.uniforms.uRTSteps.value > 0 ? 'LIVE' : 'OFF';
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
