#!/usr/bin/env python3
"""Pre-visit data-gap report: where the model needs field capture, and what to shoot.

Reads the derived viewer assets and the curated waypoints; writes
data/<slug>/gap-report.md. Deterministic — same inputs, same report.

Capture targets = obstacle waypoints + analysis zones not already near one.
A target is 'covered' when any waypoint with media sits within MEDIA_RADIUS_M.
"""
from __future__ import annotations

import json
import math
import sys
from datetime import date
from pathlib import Path

MEDIA_RADIUS_M = 150.0
ZONE_MERGE_M = 120.0
MI = 1609.34

CHECKLIST = """  - [ ] Two–three slow orbits at waist / head / overhead height (~70% frame overlap)
  - [ ] One pass along each driving line, driver's-eye height
  - [ ] Close the loop — end an orbit where it started
  - [ ] One scale reference (known-size object in frame, or tape/pace one distance)
  - [ ] Exposure locked, GPS tagging ON, people/dogs/vehicles out of frame
  - [ ] Overcast if possible; skip if vegetation is whipping in the wind"""


def main():
    trail_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "data/bunce-school-road")
    dv = trail_dir / "derived" / "viewer"
    profile = json.loads((dv / "centerline.json").read_text())
    waypoints = json.loads((dv / "waypoints.json").read_text())
    analysis = json.loads((dv / "analysis.json").read_text())
    mvum = json.loads((dv / "mvum.json").read_text())
    length = profile[-1]["d"]

    def at(d):
        return min(profile, key=lambda p: abs(p["d"] - d))

    # --- capture targets
    targets = [
        {
            "d": w["d"], "title": w["title"], "why": w["notes"],
            "lat": w["lat"], "lon": w["lon"], "kind": "waypoint",
        }
        for w in waypoints
        if w["kind"] == "obstacle"
    ]
    for zone in analysis["steep"] + analysis["rough"]:
        mid = (zone["d0"] + zone["d1"]) / 2
        if any(abs(t["d"] - mid) < ZONE_MERGE_M for t in targets):
            continue
        p = at(mid)
        kind = "steep" if zone in analysis["steep"] else "rough"
        targets.append(
            {
                "d": mid, "lat": p["lat"], "lon": p["lon"], "kind": kind,
                "title": f"Unnamed {kind} zone (mile {mid / MI:.2f})",
                "why": (
                    f"DEM-derived {kind} zone, {zone['d1'] - zone['d0']:.0f} m long, "
                    f"peak metric {zone['peak']:.3f}. No curated waypoint here yet — "
                    "confirm whether this is an obstacle, a shelf edge, or DEM noise."
                ),
            }
        )
    targets.sort(key=lambda t: t["d"])

    media_pts = [w["d"] for w in waypoints if w.get("media")]
    gaps = [t for t in targets if not any(abs(m - t["d"]) < MEDIA_RADIUS_M for m in media_pts)]

    # --- MVUM jurisdiction gaps (no designated segment within 50 m of centerline)
    coslat = math.cos(math.radians(profile[0]["lat"]))

    def min_dist_to_mvum(p):
        best = math.inf
        for seg in mvum:
            for (lon1, lat1), (lon2, lat2) in zip(seg["coords"], seg["coords"][1:]):
                py, px = p["lat"] * 111320, p["lon"] * 111320 * coslat
                ay, ax = lat1 * 111320, lon1 * 111320 * coslat
                by, bx = lat2 * 111320, lon2 * 111320 * coslat
                dx, dy = bx - ax, by - ay
                t = 0.0 if dx == dy == 0 else max(
                    0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))
                )
                best = min(best, math.hypot(px - (ax + t * dx), py - (ay + t * dy)))
        return best

    juris_runs, start = [], None
    for p in profile:
        far = min_dist_to_mvum(p) > 50
        if far and start is None:
            start = p["d"]
        elif not far and start is not None:
            juris_runs.append((start, p["d"]))
            start = None
    if start is not None:
        juris_runs.append((start, length))

    # --- report
    lines = [
        f"# Data-Gap Report — {trail_dir.name}",
        "",
        f"*Generated {date.today().isoformat()} by `tools/pipeline/gap_report.py`. "
        f"Capture technique: `docs/capture-protocol.md`.*",
        "",
        f"Trail: {length / MI:.2f} mi, {len(targets)} capture targets, "
        f"**{len(gaps)} with no anchored media** within {MEDIA_RADIUS_M:.0f} m.",
        "",
        "## Capture list (north → south)",
        "",
    ]
    for i, t in enumerate(gaps, 1):
        p = at(t["d"])
        lines += [
            f"### {i}. {t['title']}",
            f"- **Where:** mile {t['d'] / MI:.2f} · {t['lat']:.5f}, {t['lon']:.5f} · "
            f"{p['z'] * 3.28084:,.0f} ft · local grade {p['g'] * 100:.0f}%",
            f"- **Why:** {t['why']}",
            "- **Shoot:**",
            CHECKLIST,
            "",
        ]
    covered = [t for t in targets if t not in gaps]
    if covered:
        lines += ["## Already has nearby media", ""]
        lines += [f"- {t['title']} (mile {t['d'] / MI:.2f})" for t in covered]
        lines += [""]
    lines += [
        "## Route-data gaps (not capture tasks)",
        "",
        "Segments with no MVUM-designated route within 50 m of the centerline — presumed "
        "county/non-NFS jurisdiction; legality is not in question (the physical road is "
        "continuous), but designation attributes are OSM-only here:",
        "",
    ]
    lines += [f"- mile {a / MI:.2f} – {b / MI:.2f}" for a, b in juris_runs] or ["- none"]
    lines.append("")

    out = trail_dir / "gap-report.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {out}: {len(gaps)} capture gaps, {len(juris_runs)} jurisdiction gaps")


if __name__ == "__main__":
    main()
