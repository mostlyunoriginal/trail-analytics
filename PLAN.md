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

## Open questions

- Exact stack for the pipeline (Python for data pulls is the obvious default; `py3dep`,
  `requests`/ArcGIS REST for MVUM, Overpass for OSM).
- Where the per-trail cache lives (local directory per trail slug is probably enough).
- Whether v1 serves static files or runs a small local server (Cesium works fine from static
  hosting; a local server helps with tile proxying and API keys).

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
- [ ] [L] [C] GATE — go/no-go on stack and architecture (major decision point)

## Phase 1 — Terrain flythrough (v1)
<!-- ringboard: window=2026-09-20..2026-11-30 -->
Trail name in → CesiumJS flythrough in the browser.

- [ ] [C] Deterministic data pipeline
  - [ ] DEM → terrain for Cesium
  - [ ] NAIP imagery draping
  - [ ] Trail line geometry from MVUM/OSM
  - [ ] Per-trail cache layout (directory per trail slug)
- [ ] [C] Viewer: scrub along trail, perspective controls, layer toggles
- [ ] [C] Elevation/grade profile and per-segment stats
- [ ] [L] Field-check the flythrough against real knowledge of the trail

## Phase 2 — Anchored media + data-gap reports (v2)
<!-- ringboard: window=2026-12-01..2027-03-31 -->

- [ ] [C] Waypoint-anchored photos and YouTube embeds, surfaced by scrub position
- [ ] [C] Agent: trip-report mining for obstacle-zone hints
- [ ] [C] Pre-visit data-gap report generator (per-point field capture checklist)
- [ ] [C] Analysis overlays: grade coloring on trail line, steepest-segment callouts
- [ ] [L] Review gap report and plan the first capture visit

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
