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

At load time the game replaces those interpolated texels with the measured CTX
elevation below (blended across the mask edge); the mask still marks them.

## Surface brightness, horizon, minerals, weather, media — public domain (US Government)

All free and without login. Produced by the scripts in `tools/`.

- `data/jezero_albedo.jpg`, `data/jezero_albedo_near.jpg` — **USGS Mars 2020 TRN HiRISE
  orthomosaic** `JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first`, same release
  as the DTM. Block-averaged; slope shading regressed out against the DTM (`extract_ortho.py`).
- `data/jezero_far.png`, `data/jezero_far_albedo.jpg` — **JPL/USGS Mars 2020 CTX DEM**
  (`M20_JezeroCrater_CTXDEM_20m`) and **CTX orthomosaic** (`M20_JezeroCrater_CTXortho_mosaic_5m`),
  plus the **MGS MOLA global DEM** (463 m) west of the CTX coverage (`extract_horizon.py`).
  https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/
- `data/jezero_minerals.png` — **MRO CRISM MTRDR** browse products (MAF, CAR, HYD summary
  parameters, Viviano-Beck et al. 2014) from six targeted observations, PDS Geosciences Node
  (`extract_crism.py`). Spectral indicators, not mineral identifications.
- `data/meda_climate.json` — **Mars 2020 MEDA** weather station (DER_PS, CAL_TIRS, DER_WS),
  PDS Atmospheres Node, https://pds-atmospheres.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/
  (`build_meda.py`).
- `data/m20_media.json` — links only: **Mars 2020 raw images** (NASA/JPL-Caltech,
  mars.nasa.gov raw-image API) and **RIMFAX** annotated browse radargrams, PDS Geosciences
  Node (`index_media.py`). The images load from those hosts at runtime.

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
