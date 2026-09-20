# Data and asset provenance

Everything in this repository that did not originate here, and where it came from.

## Mars elevation — public domain (US Government work)

`data/jezero_base.png`, `data/jezero_detail.png`, `data/jezero_base_mask.png`

Derived from the **USGS Mars 2020 Terrain Relative Navigation HiRISE DTM Mosaic**,
product `JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40`
(1 m/px, 21400 x 21488, built from six HiRISE stereo pairs).

- https://www.usgs.gov/data/mars-2020-terrain-relative-navigation-hirise-dtm-mosaic

The committed PNGs are decimated 16-bit re-encodings produced by `tools/extract_dtm.py`.
The georeferencing was verified against the source: elevation at the Octavia E. Butler
landing site reads -2569.92 m here against NASA's recorded -2569.91 m.

**9.31% of `jezero_base` is interpolated**, not measured — the rectangular window
extends past the union of the six stereo footprints. `jezero_base_mask.png` marks
exactly which texels those are, and the renderer desaturates them so synthesised
ground is never presented as measurement. `jezero_detail` is 0% interpolated.

## Rover traverse — public domain (NASA)

`data/m20_waypoints.json`, `data/m20_traverse.json`

NASA MMGIS Mars 2020 traverse data: 703 waypoints and 556 drive segments through
**sol 1980**, 45.13 km driven.

- https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json

## three.js — MIT

`vendor/three.module.js`, `vendor/jsm/**` (r160), and the two rigged models:

- `vendor/models/Soldier.glb` — crew body
- `vendor/models/RobotExpressive.glb` — support unit

Both ship with three.js under its MIT licence. Copyright (c) 2010-2024 three.js authors.
https://github.com/mrdoob/three.js/blob/dev/LICENSE

Both use a Mixamo-style `mixamorig` skeleton, so any humanoid GLB with that rig —
including a personal Ready Player Me avatar — can be swapped in by changing
`MODEL_URL` in `src/astronaut.js`.

## Mars timekeeping algorithm

`src/marstime.js` implements Allison, M. and McEwen, M. (2000), *A post-Pathfinder
evaluation of areocentric solar coordinates with improved timing recipes for Mars
seasonal/diurnal climate studies*, Planetary and Space Science 48, 215-235 — the
same algorithm behind NASA's Mars24.
