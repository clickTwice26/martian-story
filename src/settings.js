/**
 * Settings: one declarative schema drives both the menu UI and the engine.
 *
 * Every control is defined once here, with its type, range, default and an
 * apply() that pushes the value into the running renderer. Adding an option
 * means adding one entry, not touching three files - and nothing can drift
 * between what the menu shows and what the engine is doing.
 *
 * Persisted to localStorage so a session survives a reload.
 */

const STORE_KEY = 'jezero.settings.v1';

/** Terrain ray-tracing tiers. Cost is dominated by texelFetch count per pixel. */
export const RT_PRESETS = {
  Off:    { steps: 0,   soft: 0,    maxDist: 0,    aoDirs: 0, aoSteps: 0, aoRadius: 0 },
  Low:    { steps: 20,  soft: 6.0,  maxDist: 900,  aoDirs: 0, aoSteps: 0, aoRadius: 60 },
  Medium: { steps: 40,  soft: 14.0, maxDist: 2600, aoDirs: 5, aoSteps: 5, aoRadius: 90 },
  High:   { steps: 72,  soft: 22.0, maxDist: 5000, aoDirs: 6, aoSteps: 6, aoRadius: 130 },
  Ultra:  { steps: 110, soft: 30.0, maxDist: 9000, aoDirs: 8, aoSteps: 8, aoRadius: 180 },
};

export const SCHEMA = {
  Graphics: {
    rayTracing: {
      label: 'Terrain Ray Tracing', type: 'select',
      options: Object.keys(RT_PRESETS), def: 'Medium',
      hint: 'Sun shadows traced against the real DTM. No browser exposes hardware RT; this marches rays through the elevation data itself.',
      apply: (v, c) => {
        const p = RT_PRESETS[v], u = c.terrain.material.uniforms;
        u.uRTSteps.value = p.steps; u.uRTSoftness.value = p.soft;
        u.uRTMaxDist.value = p.maxDist; u.uAODirs.value = p.aoDirs;
        u.uAOSteps.value = p.aoSteps; u.uAORadius.value = p.aoRadius;
      },
    },
    softShadows: {
      label: 'Soft Shadow Penumbra', type: 'slider', min: 0, max: 40, step: 1, def: 14,
      hint: '0 gives hard, knife-edge shadows. Higher widens the penumbra.',
      apply: (v, c) => { c.terrain.material.uniforms.uRTSoftness.value = v; },
    },
    resolutionScale: {
      label: 'Resolution Scale', type: 'slider', min: 0.5, max: 2.0, step: 0.05, def: 1.0,
      apply: (v, c) => { c.renderer.setPixelRatio(Math.min(devicePixelRatio * v, 2.5)); c.onResize(); },
    },
    terrainDetail: {
      label: 'Terrain Detail', type: 'slider', min: 1.4, max: 4.5, step: 0.1, def: 2.7,
      hint: 'Higher holds fine LOD further out. Directly trades triangles for sharpness.',
      apply: (v, c) => { c.terrain.splitK = v; },
    },
    surfaceDetail: {
      label: 'Surface Detail', type: 'slider', min: 0, max: 2, step: 0.05, def: 1.0,
      hint: 'Synthesises the sub-2 m band the DTM cannot hold: ripples and regolith roughness. Applied identically on CPU and GPU so collision matches what you see.',
      apply: (v, c) => {
        c.terrain.material.uniforms.uDetailScale.value = v;
        c.hf.detailScale = v;
      },
    },
    rockDensity: {
      label: 'Scattered Rock', type: 'slider', min: 0, max: 2, step: 0.05, def: 1.0,
      hint: 'Float rock scattered by measured slope. The strongest scale cue there is.',
      apply: (v, c) => { if (c.rocks) { c.rocks.setScale(v); c.rocks.mesh.visible = v > 0; } },
    },
    curvature: {
      label: 'Planetary Curvature', type: 'toggle', def: true,
      hint: "Mars' radius is 3,396 km, so from 1.62 m the horizon is 3.3 km away against Earth's 4.5 km. A flat plane throws it to the fog limit and breaks the sense of scale.",
      apply: (v, c) => { c.terrain.material.uniforms.uCurvature.value = v ? 1 / (2 * 3396190) : 0; c.curvature.value = v ? 1 / (2 * 3396190) : 0; },
    },
    fogDensity: {
      label: 'Atmospheric Haze', type: 'slider', min: 0, max: 0.0004, step: 0.000005, def: 0.000052,
      apply: (v, c) => { c.terrain.material.uniforms.uFogDensity.value = v; },
    },
    exposure: {
      label: 'Exposure', type: 'slider', min: 0.4, max: 2.0, step: 0.05, def: 1.0,
      apply: (v, c) => {
        c.renderer.toneMappingExposure = v;
        c.terrain.material.uniforms.uExposure.value = v;
        c.sky.material.uniforms.uExposure.value = v;
      },
    },
    fov: {
      label: 'Field of View', type: 'slider', min: 45, max: 100, step: 1, def: 62,
      apply: (v, c) => { c.settings.view.fov = v; },
    },
  },

  World: {
    timeMode: {
      label: 'Time Source', type: 'select', options: ['Live Mars Time', 'Mission Sol', 'Frozen'], def: 'Mission Sol',
      hint: 'Live tracks the actual current time at Jezero. Mission Sol lets you pick any sol since landing.',
      apply: () => {},
    },
    missionSol: {
      label: 'Mission Sol', type: 'slider', min: 0, max: 2000, step: 1, def: 1980,
      hint: 'Perseverance landed on sol 0, 18 Feb 2021. The traverse data runs to sol 1980.',
      apply: () => {},
    },
    localTime: {
      label: 'Local Solar Time (LMST)', type: 'slider', min: 0, max: 23.98, step: 0.02, def: 9.5,
      apply: () => {},
    },
    timeScale: {
      label: 'Time Rate', type: 'select',
      options: ['Paused', '1x', '60x', '600x', '3600x'], def: 'Paused',
      apply: () => {},
    },
    sunMode: {
      label: 'Sun Position', type: 'select', options: ['From Mars Time', 'Manual'], def: 'From Mars Time',
      apply: () => {},
    },
    sunElevation: {
      label: 'Sun Elevation', type: 'slider', min: -20, max: 90, step: 0.5, def: 38,
      apply: () => {},
    },
    sunAzimuth: {
      label: 'Sun Azimuth', type: 'slider', min: 0, max: 360, step: 1, def: 120,
      apply: () => {},
    },
    gapOverlay: {
      label: 'Mark Interpolated Terrain', type: 'toggle', def: true,
      hint: '9.3% of this tile is gap-filled between HiRISE stereo pairs. Shown desaturated when on.',
      apply: (v, c) => { c.terrain.material.uniforms.uMaskStrength.value = v ? 1 : 0; },
    },
    companion: {
      label: 'Support Unit', type: 'toggle', def: true,
      hint: 'A companion that follows you and calls out real rover waypoints, unmeasured ground and slope hazards.',
      apply: (v, c) => { if (c.companion) { c.companion.root.visible = v; if (!v) c.companion.marker.visible = false; } },
    },
    companionChatter: {
      label: 'Support Unit Commentary', type: 'toggle', def: true,
      apply: () => {},
    },
    roverTrack: {
      label: 'Show Rover Traverse', type: 'toggle', def: true,
      apply: (v, c) => { if (c.traverseLine) c.traverseLine.visible = v; if (c.waypointPoints) c.waypointPoints.visible = v; },
    },
  },

  Camera: {
    viewMode: {
      label: 'View', type: 'select', options: ['Third Person', 'First Person'], def: 'Third Person',
      apply: () => {},
    },
    camDistance: {
      label: 'Third-Person Distance', type: 'slider', min: 2.5, max: 12, step: 0.1, def: 6.0,
      hint: 'At 3.4 m a 1.85 m astronaut fills half the frame and reads as oversized. 6 m puts him near 28%.',
      apply: (v, c) => { c.settings.view.camDistance = v; },
    },
    headBob: { label: 'Head Bob', type: 'toggle', def: true,
      apply: (v, c) => { c.settings.view.bobEnabled = v; } },
    bobScale: { label: 'Head Bob Amount', type: 'slider', min: 0, max: 2, step: 0.05, def: 1,
      apply: (v, c) => { c.settings.view.bobScale = v; } },
    strafeRoll: { label: 'Strafe Lean', type: 'slider', min: 0, max: 2, step: 0.05, def: 1,
      apply: (v, c) => { c.settings.view.strafeRoll = v; } },
    lookSway: { label: 'Helmet Inertia (roll only)', type: 'slider', min: 0, max: 2, step: 0.05, def: 1,
      hint: 'Banks into fast pans. Roll only - it can never affect where you are aiming.',
      apply: (v, c) => { c.settings.view.lookSway = v; } },
    landingDip: { label: 'Landing Impact', type: 'slider', min: 0, max: 2, step: 0.05, def: 1,
      apply: (v, c) => { c.settings.view.landingDip = v; } },
  },

  Mouse: {
    sensitivity: {
      label: 'Sensitivity (deg / count)', type: 'slider', min: 0.02, max: 0.6, step: 0.005, def: 0.115,
      apply: (v, c) => { c.settings.mouse.sensitivity = v; },
    },
    invertY: { label: 'Invert Vertical', type: 'toggle', def: false,
      apply: (v, c) => { c.settings.mouse.invertY = v; } },
    helmetInertia: {
      label: 'Aim Smoothing', type: 'slider', min: 0, max: 0.12, step: 0.002, def: 0,
      hint: 'Kept at 0 by default. Anything above ~0.02 s is measurable lag between mouse and view.',
      apply: (v, c) => { c.settings.mouse.helmetInertia = v; },
    },
  },

  Audio: {
    enabled: { label: 'Sound', type: 'toggle', def: true,
      apply: (v, c) => c.audio.setEnabled(v) },
    master: { label: 'Master Volume', type: 'slider', min: 0, max: 1, step: 0.02, def: 0.85,
      apply: (v, c) => { c.audio.masterVolume = v; if (c.audio.master) c.audio.master.gain.value = c.audio.enabled ? v : 0; } },
    breathing: { label: 'Breathing', type: 'slider', min: 0, max: 2, step: 0.05, def: 1,
      apply: (v, c) => { c.audio.breathGain = v; } },
    suitFan: { label: 'Suit Ventilation', type: 'slider', min: 0, max: 2, step: 0.05, def: 1,
      apply: (v, c) => { c.audio.fanScale = v; if (c.audio.fanGain) c.audio.fanGain.gain.value = 0.085 * v; } },
    wind: { label: 'Exterior Wind', type: 'slider', min: 0, max: 3, step: 0.05, def: 1,
      hint: 'Mars is near-silent outside: 610 Pa of CO2 crushes everything above ~240 Hz.',
      apply: (v, c) => { if (c.audio.windGain) c.audio.windGain.gain.value = 0.05 * v; } },
    footsteps: { label: 'Footsteps', type: 'slider', min: 0, max: 2, step: 0.05, def: 1,
      apply: (v, c) => { c.audio.stepScale = v; } },
  },
};

export const QUALITY_PRESETS = {
  Low:    { rayTracing: 'Off',    resolutionScale: 0.75, terrainDetail: 2.0, softShadows: 0 },
  Medium: { rayTracing: 'Medium', resolutionScale: 1.0,  terrainDetail: 2.7, softShadows: 14 },
  High:   { rayTracing: 'High',   resolutionScale: 1.0,  terrainDetail: 3.4, softShadows: 22 },
  Ultra:  { rayTracing: 'Ultra',  resolutionScale: 1.25, terrainDetail: 4.0, softShadows: 30 },
};

export class Settings {
  constructor() {
    this.values = {};
    for (const [group, items] of Object.entries(SCHEMA))
      for (const [key, def] of Object.entries(items)) this.values[key] = def.def;
    // Key bindings are not a simple control, so they live alongside the schema
    // values rather than inside it, but persist through the same store.
    this.values.keybinds = null;
    this.load();
    this.ctx = null;
    this.listeners = [];
  }

  def(key) {
    for (const items of Object.values(SCHEMA)) if (items[key]) return items[key];
    return null;
  }

  get(key) { return this.values[key]; }

  set(key, v, skipApply) {
    this.values[key] = v;
    const d = this.def(key);
    if (!skipApply && d && this.ctx) { try { d.apply(v, this.ctx); } catch (e) { console.warn('apply', key, e); } }
    for (const fn of this.listeners) fn(key, v);
    this.save();
  }

  bind(ctx) { this.ctx = ctx; this.applyAll(); }

  applyAll() {
    if (!this.ctx) return;
    for (const items of Object.values(SCHEMA))
      for (const [key, d] of Object.entries(items)) {
        try { d.apply(this.values[key], this.ctx); } catch (e) { console.warn('apply', key, e); }
      }
  }

  applyPreset(name) {
    const p = QUALITY_PRESETS[name];
    if (!p) return;
    for (const [k, v] of Object.entries(p)) this.set(k, v);
  }

  resetDefaults() {
    for (const items of Object.values(SCHEMA))
      for (const [key, d] of Object.entries(items)) this.set(key, d.def);
  }

  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.values)); } catch (e) { /* private mode */ }
  }

  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      for (const k of Object.keys(this.values)) if (k in saved) this.values[k] = saved[k];
    } catch (e) { /* ignore corrupt state */ }
  }
}
