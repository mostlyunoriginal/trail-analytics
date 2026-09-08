# Trail Analytics — Project Plan

*Founding document, 2026-09-05. This is the durable record of the project vision and roadmap;
update it as decisions change rather than letting it drift.*

## What this is

A personal agentic tool for **offroad trail modeling, analysis, and visualization**. Given a
trail name/location, the tool gathers publicly available data (topography, GIS layers, imagery,
trip reports, video), assembles an interactive 3D model of the trail, and serves it in a web
browser where the trail can be "traveled" and inspected via sliders and controls.

**Purpose of analysis:** personal trip planning, preliminary difficulty assessment before
attempting a trail, and refinable planning across repeated attempts.

## Constraints and decisions (settled)

- **US-only.** This makes the data story dramatically better: USGS 3DEP elevation + USFS MVUM
  route data cover most offroad trails.
- **Personal tool.** Single user, no multi-tenant concerns. Per-trail agent runs can be slow and
  cost real money; results are cached forever, so that's acceptable.
- **ToS-clean data only.** Government open data (USGS, USFS, BLM), OpenStreetMap, and YouTube
  *embeds* (not scraped/downloaded content). No scraping of AllTrails, onX, Gaia, Trails Offroad.
- **Viewer controls:** position along the trail (scrub), camera perspective, and layer toggles.
  Vertical exaggeration and time-of-day lighting are cheap adds. No seasonal simulation.
- **Obstacle-scale 3D comes from personal field capture**, not from crowd-sourced footage.
  Found-footage reconstruction is research-grade unreliable; deliberate capture by the user is
  exactly what photogrammetry/Gaussian splatting works well with.
- **A trail is a route bundle.** Intake accepts "X plus Y and Z"; the agent resolves that to a
  `trail.json` manifest (primary route + named side routes, each mapped to OSM way ids and
  MVUM route ids). One scene per bundle: shared terrain, per-route profiles, route selector in
  the viewer. (Decided 2026-09-05 when Ironclads + T-33 were added to Bunce School Road.)

## Architecture principle

**The agent discovers and curates; a deterministic pipeline assembles.**

The agentic layer handles the messy, judgment-heavy work: disambiguating the trail name, choosing
among candidate routes, finding and ranking trip reports/photos/videos, deciding whether data
quality is sufficient, and generating data-gap reports. The 3D scene assembly (DEM → terrain
tiles, imagery draping, trail geometry, waypoint anchoring) is boring, repeatable, versioned
code that produces the same output from the same inputs.

## Data sources

| Data | Source | Access | Notes |
|---|---|---|---|
| Elevation (1m DEM, lidar) | USGS 3DEP | OpenTopography API, TNM Access, `py3dep` | Free. Captures the mountain, not the rock garden — obstacle detail is below DEM resolution. |
| Aerial imagery (~0.6–1m) | NAIP | Free via USGS/USDA services | For terrain texturing. |
| Official motorized routes | USFS MVUM | Open GIS layers (USFS ArcGIS/EDW services) | The authoritative record of legal motorized routes. |
| BLM routes | BLM open GIS data | Free | Fills gaps outside USFS land. |
| Trail geometry (fallback/supplement) | OpenStreetMap | Overpass API | Plus GPX tracks from forums when available. |
| Trip reports, photos, waypoint names | Forums, public web | Agent search | Used for obstacle-zone hints ("the crux," "waterfall" + mileage). |
| Video | YouTube | Embeds anchored to waypoints | Embed, don't download. |
| Obstacle-scale capture | Personal field visits | Phone video/photos → splat pipeline | See `docs/capture-protocol.md`. |

## Roadmap

### v1 — Terrain flythrough with real trail data
Type a trail name → agent geocodes and disambiguates → finds the route in MVUM/OSM → pulls DEM
and NAIP tiles → computes grade/elevation/slope stats → serves a CesiumJS scene in the browser:
imagery draped on terrain, trail line rendered, camera scrub along the route, perspective
controls, layer toggles, elevation/grade profile.

### v2 — Waypoint-anchored media + data-gap reports
- Photos and YouTube embeds pinned to points along the trail; scrubbing surfaces the media for
  the current location.
- **Pre-visit data-gap report:** the agent flags candidate obstacle zones (DEM slope/roughness
  spikes, trip-report language cross-referenced with mileage), notes segments with no anchored
  media, and emits a per-point field capture checklist (what to shoot, from where, in what
  conditions).
- Analysis overlays: grade coloring on the trail line, steepest-segment callouts.

### v3 — Obstacle inspection mode (Gaussian splats from field capture)
- Ingest personal phone video/photo sets per obstacle → COLMAP poses → splat (Nerfstudio /
  OpenSplat / Postshot; Postshot is a good Windows-native option). Phone apps (Polycam, Luma,
  Scaniverse) are an acceptable shortcut.
- **Georeferencing:** splats come out in arbitrary local coordinates and scale. Plan: automatic
  coarse placement from photo EXIF GPS (3–5m error, worse in canyons) + one known measurement
  per obstacle for scale + manual nudge/rotate/scale controls in the viewer to seat the splat
  against the DEM once; save the transform.
- **Measurement:** splats are for looking; measuring (ledge heights, breakover, line planning)
  uses the point cloud/mesh that the same COLMAP step produces as a byproduct.
- **Viewer integration:** obstacle markers in the terrain flythrough open a separate
  "inspection mode" splat viewer with free orbit. Seamless splat-in-Cesium rendering is a
  later polish item, not a blocker (alignment and depth-compositing are fiddly).
- **Post-visit feedback loop:** the pipeline reports which captures failed reconstruction and
  why (insufficient overlap, motion blur, deep shadow) as refined instructions for the next
  visit. This is the "refinable planning for repeated attempts" goal applied to the data itself.

## First spike (next step)

Pick one trail the user knows well. Pull its real DEM, MVUM/OSM geometry, and NAIP imagery and
evaluate actual data quality before committing to architecture. Second calibration exercise:
splat any nearby boulder from phone video to calibrate capture-workflow expectations before
spending a trail day on it.

**First target trail:** Bunce School Road, Colorado (near Allenspark/Peaceful Valley, Roosevelt
National Forest — USFS land, so MVUM coverage is likely).

## Build and deployment decisions

### 2026-09-08 enhancement decisions

- The `astra-enhance` branch adds a planning layer to the existing static Cesium
  viewer. Access conflicts, uncertain connections, source age, and DEM limitations
  remain visible rather than being interpreted as permissions or observations.
- `tools/pipeline/enhance.py` is the supported build entry point. It defaults to
  offline, publishes immutable releases via an atomic pointer, and serves a small
  overview with detail tiles loaded on demand. `refresh_sources.py` owns public
  network acquisition. Raw hashes and dependency versions identify each build.
- Field status, notes, and saved views use browser storage with explicit export;
  no backend is required. Pages is a viable deployment target under the existing
  account's `/trail-analytics/` project path; publication is a subsequent step.
- Detailed usage and remaining evidence limitations are in
  `docs/enhancement-guide.md`; deployment preparation is in `docs/github-pages.md`.

- Current stack: Python + NumPy/tifffile, per-trail raw caches, static Cesium viewer.
- Deployment publication and any future native-DEM/obstacle reconstruction upgrades
  remain separate decisions after review of the prepared static artifact.

---

# Work tracker (Ringboard)

*Everything below this line is the Ringboard work plan. Owners: `[L]` = lead (user),
`[C]` = Claude. Dates are soft targets for a personal project, not commitments.*

<!-- ringboard: title="Trail Analytics" deadline=2027-06-30 tick="2026-09-19 Spike go/no-go" tick="2026-11-30 v1 flythrough" tick="2027-03-31 v2 media + gap reports" -->

## Phase 0 — Data spike: Bunce School Road
<!-- ringboard: window=2026-09-05..2026-09-19 -->
Prove the data story on the first target trail before committing to architecture.

- [x] [C] Geocode and disambiguate Bunce School Road (Roosevelt NF, near Allenspark)
- [x] [C] Pull route geometry from USFS MVUM and OSM Overpass; compare the two
- [x] [C] Pull 3DEP DEM for the trail corridor; verify resolution and coverage
- [x] [C] Pull NAIP imagery for the corridor
- [x] [C] Write data quality report: gaps, resolution, alignment between sources
- [x] [L] [C] GATE — go/no-go on stack and architecture (major decision point) — **GO, 2026-09-05:** Python pipeline + per-trail cache + CesiumJS static viewer; OSM centerline, MVUM overlay

## Phase 1 — Terrain flythrough (v1)
<!-- ringboard: window=2026-09-20..2026-11-30 -->
Trail name in → CesiumJS flythrough in the browser.

- [x] [C] Deterministic data pipeline
  - [x] DEM → terrain for Cesium (2m heightfield + self-validation vs identify service)
  - [x] NAIP imagery draping (live USGSNAIPPlus provider in viewer)
  - [x] Trail line geometry from MVUM/OSM
  - [x] Per-trail cache layout (directory per trail slug)
- [x] [C] Viewer: scrub along trail, perspective controls, layer toggles (visual check passed 2026-09-05)
- [x] [C] Elevation/grade profile and per-segment stats
- [x] [L] Field-check the flythrough against real knowledge of the trail (confirmed 2026-09-05: "jives with my memories")

## Phase 2 — Anchored media + data-gap reports (v2)
<!-- ringboard: window=2026-12-01..2027-03-31 -->

- [x] [C] Waypoint-anchored photos and YouTube embeds, surfaced by scrub position
- [x] [C] Agent: trip-report mining for obstacle-zone hints (4x4explore + YouTube + geometry/DEM cross-check → waypoints.json)
- [x] [C] Pre-visit data-gap report generator (per-point field capture checklist)
- [x] [C] Analysis overlays: grade coloring on trail line, steepest-segment callouts
- [x] [C] Multi-route trail bundles: trail.json manifest, per-route profiles/analysis, viewer route selector (Bunce + Ironclads ×2 + T-33)
- [ ] [L] Review gap report (`data/bunce-school-road/gap-report.md`) and plan the first capture visit

## Phase 2a — Planning enhancements (astra-enhance)
<!-- ringboard: window=2026-09-08..2026-09-08 -->

- [x] [C] Expose route summaries, access conflicts, vehicle permissions, and source caveats
- [x] [C] Profile axes/tooltips, reverse playback, point navigation, saved views, and mobile layout
- [x] [C] Timestamp/photo media schema, pinned evidence cards, and explicit coverage verification
- [x] [C] Public NWS, SNOTEL, USGS catalog, and agency document snapshots with dates
- [x] [C] Ranked field plan, persistent notes/status, backup/import, and GPX exports
- [x] [C] Offline immutable builds, input hashes, overview/detail terrain, failure states
- [x] [C] JavaScript/pipeline/browser verification and 12-point USGS registration check
- [x] [C] Package static preview and verify project-path deployment readiness
- [x] [L] Review the enhanced planner and approve publishing the prepared Pages artifact (2026-09-08)
- [ ] [C] Publish the reviewed artifact to GitHub Pages and verify the live project URL

## Phase 3 — Obstacle inspection mode (v3)
<!-- ringboard: window=2027-04-01..2027-06-30 -->
Gaussian splats from personal field capture (see docs/capture-protocol.md).

- [ ] [L] Calibration splat: any nearby boulder from phone video
- [ ] [L] Field capture at Bunce School Road per the capture protocol
- [ ] [C] Splat pipeline
  - [ ] Frame extraction + COLMAP camera poses
  - [ ] Splat training (Postshot / OpenSplat / Nerfstudio)
  - [ ] Point cloud / mesh export for measurement
- [ ] [C] Georeferencing workflow: EXIF coarse placement, scale reference, manual seat + saved transform
- [ ] [C] Inspection-mode viewer with obstacle markers in the flythrough
- [ ] [C] Post-visit reconstruction feedback report (what failed, what to reshoot)
