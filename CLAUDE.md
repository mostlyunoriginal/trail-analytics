# trail-analytics

Personal agentic tool for offroad trail modeling, analysis, and visualization: trail name in →
public data gathered (USGS 3DEP DEM, NAIP imagery, USFS MVUM / OSM routes) → interactive 3D
flythrough in the browser (CesiumJS), with waypoint-anchored media and, eventually, Gaussian-splat
obstacle inspection from personal field capture.

## Read first

- **`PLAN.md`** — the founding document: vision, settled constraints, data sources, and the
  v1/v2/v3 roadmap. Read it before making architecture decisions; update it when decisions change.
- `docs/capture-protocol.md` — field checklist for obstacle photogrammetry capture.

## Ground rules

- **Agent discovers/curates; deterministic pipeline assembles.** Judgment-heavy work (trail
  disambiguation, source ranking, data-gap reports) belongs in the agentic layer. Scene assembly
  must be repeatable, versioned code — same inputs, same output.
- **ToS-clean data only:** government open data, OSM, YouTube embeds. Never scrape AllTrails,
  onX, Gaia, or Trails Offroad.
- US-only scope; single user; per-trail results are cached and reused.

## Status

- 2026-09-05: repo created, plan documented. First target trail: **Bunce School Road, Colorado**.
  Next: v1 spike — pull real DEM + MVUM/OSM + NAIP data for it and evaluate quality.
