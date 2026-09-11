# Trail Analytics — Project Plan

*Founded 2026-09-05; media-first revision 2026-09-10. This is the durable record of the project vision and roadmap;
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
- **Personal photos and videos are the deliverable**, not inputs for reconstruction.
  Collect useful views of conditions, obstacles, driving lines, junctions, and landmarks,
  and attach them to specific locations. Gaussian splats, photogrammetry, and reconstructed
  obstacle measurements are out of the active roadmap.
- **Location metadata assists; the user decides.** Suggest a pin from geographic metadata
  when available, but always allow manual placement and correction, even for geotagged media.
  Attaching media must not require GPS, a special capture recipe, or editing JSON.
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
| Personal photos and videos | Personal field visits | File attachment → metadata suggestion or manual map pin | Useful standalone evidence; see `docs/capture-protocol.md`. |

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

### v3 — Easy media attachment and location pinning

Extend the existing waypoint evidence viewer with a user-facing attachment workflow for
personal photos and video files, while retaining curated photo URLs and YouTube embeds.
This replaces the Gaussian-splat milestone. The first implementation is available locally as
of 2026-09-10; see `docs/media-guide.md` for supported formats, limits, and publication steps.

#### Attachment workflow

1. **Add media** from the trail toolbar, a waypoint, or a selected map location. Offer a file
   picker on desktop/mobile and drag-and-drop on desktop, for one file or a batch. Adding
   from a waypoint/map point offers that location as a starting suggestion.
2. **Preview and inspect metadata.** Show a thumbnail or playable video, filename, and
   recording date when available. Read photo EXIF GPS and supported video location metadata.
   Missing, invalid, or unreadable metadata must not block attachment; show a status such as
   "No location found — choose on map." Never substitute import time for capture time.
3. **Choose the location.** Show valid metadata locations as unconfirmed suggestions. Users
   can accept a suggestion, click/tap anywhere on the map, drag the pin, select an existing
   waypoint, or use the current trail scrub position. Offer coordinate entry as a keyboard
   alternative. Manual placement is available regardless of whether GPS exists.
4. **Review trail association.** Show the selected route, mileage, and distance from the pin
   to the route. Offer optional snapping, never silent snapping. Allow off-trail pins (such
   as overlooks or camera positions), changing routes, or a map-only pin with no route.
   At crossings, loops, or nearby side routes, require review of ambiguous route/segment
   suggestions. Warn about distant metadata without discarding it or forcing it onto a trail.
5. **Save.** Show a final media-and-map preview with optional title, caption, direction,
   conditions, and corrected recording date. Save after location confirmation, or retain
   the item in a visible **Unplaced** inbox. Batches show per-file placement status; applying
   one location to selected items requires an explicit action.
6. **Browse and revise.** A map marker or nearby trail position opens its gallery; a gallery
   item can jump to its pin. Support multiple items at a point, full-size photos, and playable
   personal video. **Move pin**, **Use original GPS** (when available), edit, detach, and delete
   remain available after saving. Distinguish geographic pins from the existing **Pin card**
   control, which only holds an evidence card while scrubbing.

Initially, each attachment has one location. A moving video can have a chosen start timestamp;
its pin does not assert that the entire clip depicts that point. Multiple timestamped locations
or a synchronized video track are later enhancements.

#### Data, persistence, and evidence

- Keep original geographic metadata separate from the confirmed display pin. Record stable
  media IDs, asset references, media type, original filename, capture date/source, selected
  coordinates, placement method (metadata/manual/waypoint/scrub), and confirmation status.
  Moving a pin must preserve the original GPS and must not modify the source file.
- Route association is optional and separate from coordinates. Retain the chosen route and
  segment/chainage with a route geometry version so rebuilds flag associations for review
  instead of silently moving user pins. Existing curated waypoint media must keep working.
- Start local-first, with no required backend: plan an IndexedDB store for media bytes and
  attachment records, not localStorage or temporary object URLs as durable storage. Prototype
  supported formats and practical size limits; report unsupported codecs/formats, unreadable
  files, and quota failures per item without losing successful attachments. Provide conversion
  guidance rather than promising all phone formats.
- Provide backup/import of **both media files and placement metadata**. Existing notes-only
  exports are not media backups. Explain browser/device-local storage, possible eviction, and
  no automatic cross-device sync. Report import duplicates/conflicts rather than silently
  overwriting edited pins.
- Local attachment does not upload or publish anything. Publishing selected media to the
  static site is a separate, explicit export/build step with a preview of public files and
  coordinates. Offer metadata-stripped publication copies while retaining originals locally;
  review embedded metadata and visible private details. Keep YouTube embeds, not downloads.
- A confirmed pin establishes intended placement, not obstacle coverage, current conditions,
  or safe/legal access. Keep coverage verification explicit and dated. Missing metadata and
  unconfirmed locations stay visible; proximity alone must not close a data gap.
- Update field-plan generators and capture-time assumptions to request useful views rather
  than overlapping orbits, scale references, or reconstruction coverage. Post-visit review
  flags unplaced files, unclear views, missing context, and stale evidence, not failed splats.

#### Acceptance checks

- A geotagged photo gets a suggestion that can be accepted or manually overridden. Moving
  it and reloading preserves the new pin and original GPS separately.
- A photo or video without readable GPS can be previewed, manually pinned, saved, and reopened.
- Geotagged video uses supported metadata with the same manual fallback as photos. Invalid
  coordinates never become confirmed pins; unsupported media produces actionable feedback.
- Map, waypoint, scrub-position, and coordinate-entry placement work on desktop and mobile;
  keyboard users can attach and reposition without dragging.
- Off-trail pins, nearby routes, crossings, and loops do not cause silent snapping or route
  reassignment. Unplaced items remain recoverable; batch items can have different locations.
- Multiple items at one pin remain accessible and personal videos play. Existing curated
  media and evidence-card pinning do not regress.
- Reload and backup/import retain playable media and edited locations. Storage failures are
  visible; attaching locally never changes the published site or marks coverage verified.

## First spike (next step)

The terrain/data spike is complete (Phase 0). The next workflow spike is to attach a small
set of personal photos and videos, with and without GPS, to Bunce School Road. Validate metadata
extraction, manual pins, playback, and backup/restore before a dedicated capture visit. No
boulder reconstruction or special capture sequence is required.

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
- Future native-DEM upgrades remain a separate decision. Obstacle reconstruction is no longer
  an active milestone; the 2026-09-10 media-first decision supersedes that earlier direction.

### 2026-09-10 media-first decision

- Prioritize standalone photos/videos and a friendly attachment interface with optional
  metadata suggestions and always-available manual pins. Preserve the existing terrain viewer.
- Phase 3 now delivers this workflow, not Gaussian splats. Its existing schedule window is a
  soft placeholder, not a requirement to delay this next milestone until April.
- The initial revision changed planning guidance only. The subsequent implementation adds the
  attachment UI, local media storage, backups, and explicit publication export. Field-plan
  generators and the current Bunce report now use the media-first checklist and time allowances.
- The supported first pass reads EXIF GPS in JPEG/PNG/WebP and common MP4/MOV location tags;
  HEIC, other GPS layouts, and unsupported video codecs need conversion or manual placement.
  Local and published media are separate; publication remains an explicit review/deploy action.

### 2026-09-11 repository media sharing

- Reviewed publication exports can be imported into `viewer/published-media/` and its
  manifest with `tools/pipeline/import_media.py`. Imports merge by attachment ID, preserving
  other shared items. Files and pins can be committed and pushed with the source code.
- Normal site packages verify and include the repository manifest's assets automatically.
  Source pushes and `gh-pages` deployments remain separate; a new Pages deployment makes
  attachments visible to public visitors. Browser attachment remains local until exported.

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
- [x] [C] Publish the reviewed artifact to GitHub Pages and verify the live project URL (2026-09-08)

## Phase 3 — User-friendly media attachment (v3)
<!-- ringboard: window=2027-04-01..2027-06-30 -->
Useful standalone photos/videos pinned to trail/map locations (see docs/capture-protocol.md).

- [x] [C] Prototype imports with generated photo/video fixtures; establish metadata, format, and size support
- [x] [C] Add media picker/drop zone, previews, batch review, and recoverable Unplaced inbox
- [x] [C] Suggest pins from geographic metadata; show missing/invalid metadata clearly
- [x] [C] Manual map/waypoint/scrub/coordinate placement, optional snapping, and ambiguity review
- [x] [C] Save/edit pins independently of original GPS; retain route/segment association provenance
- [x] [C] Integrate pinned galleries, full-size photos, and personal video playback
- [x] [C] Local media persistence, quota/error handling, and media-plus-metadata backup/import
- [x] [C] Selected-media publication export with location/metadata privacy review
- [x] [C] Import reviewed media into Git-tracked files and include shared attachments in normal site builds
- [x] [C] Publish seven reviewed photos and the media-enabled viewer to GitHub Pages; verify live desktop/mobile loading (2026-09-11)
- [x] [C] Replace reconstruction checklists/time assumptions in field-plan generators; regenerate reports
- [x] [C] Review filters for unplaced/undated/old/unverified media; captions and explicit target coverage confirmation
- [x] [C] Verify v3 acceptance checks, mobile/coordinate placement, and existing-media regression — 17 JS + 11 Python tests; 11 media + 14 existing-viewer browser checks (2026-09-10)
- [ ] [L] Trial existing photos/videos, then capture useful missing views at Bunce School Road
