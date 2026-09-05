# Phase 0 Spike Report — Bunce School Road, Colorado

*2026-09-05. Data pulled live from public services; raw responses cached under `raw/`,
computed comparisons under `derived/`.*

## Trail identity (disambiguation result)

**Bunce School Road = USFS road 105.0**, Roosevelt NF (Boulder Ranger District), Allenspark,
Boulder County, CO. Runs ~5.1 mi from CO-7 near the historic Bunce School (40.1727, −105.4690)
south to the Peaceful Valley area (40.1317, −105.5093). Elevation along the corridor
~8,250–8,620 ft (verified against the live 3DEP service at three points). OSM also carries a
short `service` way of the same name at the schoolhouse itself — an access stub, not the trail;
trivially excluded by `highway=track` + `ref=FS 105.0`. Related MVUM routes: 115.1A/115.1B
"Bunce School Spur."

## Source-by-source quality

### Route geometry — OSM (Overpass)
- Main way 164929506: `highway=track`, `ref=FS 105.0`, `surface=dirt`, 205 nodes, 5.08 mi,
  **continuous end to end**. Plus spur ways (FS 115.1A) and service stubs.
- Cached: `raw/osm-overpass.json` (7 ways).

### Route geometry — USFS MVUM
- Road **105.0 "BUNCE SCHOOL"**: 6 segments, 2.78 mi total. Attributes: open **yearlong**,
  ATV open, surface `NAT - NATIVE MATERIAL`, maintenance level `2 - HIGH CLEARANCE VEHICLES`,
  symbol "Roads open to all Vehicles, Yearlong." Spurs 115.1A/B also present (0.36/0.35 mi).
- Cached: `raw/mvum-bunce.geojson` (8 features).

### Geometry cross-check (`derived/geometry-comparison.json`)
- **Median offset OSM↔MVUM: 6.9 m** where both exist — the sources agree to within the road
  corridor's own width. Alignment is not a problem.
- **Coverage differs**: MVUM's 105.0 covers ~2.8 of OSM's 5.1 mi. Gaps localize to mile
  0.0–0.2 (north approach at CO-7), ~1.4–2.3, and ~3.2–4.0. Consistent with MVUM mapping
  only National-Forest-System jurisdiction segments; the gaps are almost certainly county
  road / non-NFS jurisdiction stretches of the same physical road (the bbox pull shows
  nearby routes attributed to Boulder County). **Pipeline implication:** use OSM as the
  continuous centerline for scene assembly; drape MVUM designations/attributes over it as an
  overlay rather than expecting MVUM to provide the drivable line.

### Elevation — USGS 3DEP
- **1m DEM: 7 products cover the corridor**, best being `CO_ArapahoRooseveltPikeNF_D23`
  (2023 lidar flight of the forest itself, published 2026-03-20 — essentially brand new),
  plus DRCOG 2020. No coverage gaps over the corridor bbox.
- **Raw lidar point clouds (LPC): 65 tiles** from the same D23 project — headroom for
  finer-than-1m terrain products around obstacles later.
- Live sample: 1500×1800 F32 GeoTIFF exported from the 3DEPElevation ImageServer
  (`raw/dem-corridor-sample.tif`, ~11 MB, not committed); spot elevations sane.
- For production, prefer downloading the source 1m DEM tiles (TNM Access API) over the
  mosaic ImageServer — versioned inputs, repeatable output.

### Imagery — NAIP
- `USGSNAIPPlus` ImageServer live, 0.3 m nominal pixel. Sample export at the CO-7 corner
  (`raw/naip-midtrail-sample.png`, not committed) is sharp: individual trees resolved and
  **the trail itself is clearly visible** threading the forest.

## Verdict

**Data quality is more than sufficient — recommend GO.** Every layer the v1 flythrough needs
exists, is free, is current (2023 lidar, fresh NAIP), and was pulled live today with no
authentication. The one design consequence is the centerline/designation split noted above.

## Recommended stack (for the gate decision)

- **Pipeline:** Python, minimal deps; ArcGIS REST (MVUM), Overpass (OSM), TNM Access +
  3DEP (DEM), USGSNAIPPlus (imagery). Cache per trail slug under `data/<slug>/raw` +
  `derived` (established by this spike).
- **Viewer:** CesiumJS, static files; terrain from the 1m DEM (quantized-mesh or Cesium ion
  self-hosted alternative to be decided in Phase 1), NAIP draped, OSM centerline + MVUM
  overlay.

## Lessons for the pipeline (hard-won today)

- **Save raw response bytes** (`Invoke-WebRequest -OutFile` / streamed download). A
  parse→re-serialize round-trip through PowerShell objects silently mangled GeoJSON keys.
- ArcGIS `where` clauses with `%` wildcards must go through proper form encoding (pass as
  a parameter table/dict, never a hand-built query string).
- The MVUM GeoJSON endpoint returns **lowercase** property keys (`id`, `name`); the JSON
  (`f=json`) endpoint uses uppercase. Case-sensitive consumers beware.
- **`exportImage` silently expands a bbox whose degree aspect ratio doesn't match the
  requested pixel size** (it never distorts pixels), misregistering the result against the
  requested bbox — up to ±50m elevation error on steep ground in our case. Fix: uniform
  square-in-degrees cells and a bbox snapped to them (`snap_bbox` in the pipeline), plus a
  post-build validation against the point-identify service.
