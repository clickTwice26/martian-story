# Martian Story — Project Guidelines & Instructions

This document provides guidelines, architecture references, and development workflows for AI agents (including Antigravity / AGY) working in this repository.

---

## 1. Project Overview

**Martian Story (Jezero Crater)** is a browser-based Mars surface exploration game and simulation built on **real NASA and USGS scientific data**.
- **Real Elevation**: USGS Mars 2020 TRN HiRISE DTM mosaic (1 m/px, six stereo pairs). Landing site reads -2569.92 m against NASA's recorded -2569.91 m.
- **Real Traverse**: Perseverance rover's actual 703 waypoints and drive segments through sol 1980 (~45.13 km).
- **Real Timekeeping & Astronomy**: Mars24 algorithm (Allison & McEwen 2000). Sun coordinates derived from solar declination and local true solar time at 18.44°N, 77.45°E.
- **Physical Fidelity**: 0.38g gravity, traction-limited locomotion, and low-passed sound propagation matching Mars' ~610 Pa CO₂ atmosphere.
- **No Bundler / Pure Client**: Pure vanilla ES modules and WebGL2. No Webpack, Vite, Babel, or npm build steps.

---

## 2. Server & Development Workflow

### Launching the Local Server
The application is pure client-side static code, but requires an HTTP server that correctly handles HTTP Range requests and GLB MIME types:
```bash
# Build the Go static server (stdlib only, zero external dependencies)
cd server && go build -o jezero-server .

# Run the server from repository root
./server/jezero-server -dir . -port 8123
```
- **Local URL**: `http://localhost:8123/` (or `http://127.0.0.1:8123/`)
- **Important**: Do **not** replace `jezero-server` with `python3 -m http.server`. Python's default HTTP server does not support partial content (`206 Range`), which breaks row-by-row streaming of multi-megabyte 16-bit DTM heightmaps, fails to compress GeoJSON/JS, and misidentifies `.glb` MIME types.

---

## 3. Architecture & Codebase Map

- **`index.html`**: Main HTML shell, HUD elements, start screen, and settings dialog containers.
- **`src/`**: Core JavaScript modules (pure ES6):
  - `main.js`: Game lifecycle, render loop, camera rigging, viewport sizing, scene setup.
  - `terrain.js`: CDLOD quadtree heightfield renderer, horizon-traced ambient occlusion, sphere-traced soft shadows, planetary curvature shader.
  - `heightfield.js`: CPU-side heightfield elevation queries, bilinear interpolation, physics collision.
  - `audio.js`: Web Audio suit audio synthesis (breathing, ventilation, wind, footsteps, SFX). No audio sample files are used.
  - `player.js`: Player physics, momentum, slope-based traction limits, state management.
  - `companion.js`: Support robot **K-7** behaviors, pathfinding, and waypoint escorting.
  - `survival/`: Survival gameplay loop (oxygen, power, water purification, missions, radiation).
  - `intro/`: Opening cinematic sequence (`score.js` synthesized audio, `ship.js` 3D procedural ship, `post.js` HDR bloom/grading).
  - `settings.js` & `settingsui.js`: Declarative schema-driven settings UI with `localStorage` persistence.
  - `marstime.js`: Mars24 clock and sun position calculations.
  - `detail.js`: Bit-exact procedural detail (slope-driven surface rocks and ripples).
- **`data/`**: Scientific data and heightmaps:
  - `jezero_base.png` & `jezero_detail.png`: 16-bit elevation rasters.
  - `m20_traverse.json` & `m20_waypoints.json`: Actual NASA Perseverance rover drive data.
- **`server/`**: Custom Go HTTP server with gzip and range request support.
- **`vendor/`**: Vendored external libraries (`three.module.js`, loaders, 3D glTF models).
- **`tools/`**: Python preprocessing scripts for GeoTIFFs, elevation slicing, and figures.

---

## 4. Coding & Modification Standards

1. **Keep it Bundler-Free**:
   - Maintain pure ES module imports (`import { ... } from './module.js'`).
   - Do not introduce npm packages, TypeScript transpilers, or build steps unless requested by the user.
2. **Audio Design Integrity**:
   - All sounds are synthesized in Web Audio via mathematical oscillators and filtered brown noise. Never add binary `.wav` or `.mp3` sample files.
   - Respect ambient vs. action volume controls via `SuitAudio` scaling methods.
3. **Scientific Grounding**:
   - Do not alter measured coordinates, rover waypoints, or DTM elevations with arbitrary artistic offsets unless specifically requested.
   - Preserve CPU/GPU synchronization: CPU collision logic in `heightfield.js` and GPU rendering in `terrain.js` must evaluate identically.
4. **Performance & Memory**:
   - Heightfields use CDLOD quadtrees to limit draw calls to one instanced batch.
   - Keep ray-tracing and shadows optimized with the lighting cache (`lightcache.js`).
