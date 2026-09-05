# trail-analytics

Personal agentic tool for offroad trail modeling, analysis, and visualization: trail name in →
public data gathered (USGS 3DEP DEM, NAIP imagery, USFS MVUM / OSM routes) → interactive 3D
flythrough in the browser (CesiumJS), with waypoint-anchored media and, eventually, Gaussian-splat
obstacle inspection from personal field capture.

## Session protocol

1. Check `NOTES.md` and act on every `status: open` note per the protocol in its header
   (notes flagged `response-requested: yes` require a written **Response** in the entry).
2. Read `PLAN.md` before making architecture decisions; update it when decisions change.

## Workspace map

| Path | What it is |
|---|---|
| `PLAN.md` | Founding document (vision, constraints, data sources, roadmap) **and** the Ringboard work tracker at the bottom — single source of truth for the plan. |
| `NOTES.md` | User's notes to agents; lifecycle governed by its header. Never delete entries. |
| `tools/ringboard/` | Ringboard dashboard kit (port 8350). Launch via `ringboard.cmd` at repo root. |
| `docs/capture-protocol.md` | Field checklist for obstacle photogrammetry capture. |

## Maintenance

- Keep PLAN.md's checkbox statuses (`[ ]`/`[~]`/`[x]`/`[!]`) and
  `<!-- ringboard: ... -->` annotations (`window=`, `blocker=`) current as work proceeds —
  the board's On-deck panel and schedule colors are only as honest as the checkboxes.

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
