#!/usr/bin/env python3
"""Phase 0 spike: compare MVUM vs OSM geometry for one trail.

Stdlib only. Reads the raw pulls from data/<trail>/raw/ and reports:
- total route length per source
- cross-source offset stats (sampled point -> nearest point on other source's lines)

Offsets use an equirectangular approximation, fine at trail scale.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

M_PER_DEG_LAT = 111_320.0


def dist_m(lat1, lon1, lat2, lon2, coslat):
    dy = (lat2 - lat1) * M_PER_DEG_LAT
    dx = (lon2 - lon1) * M_PER_DEG_LAT * coslat
    return math.hypot(dx, dy)


def seg_point_dist_m(p, a, b, coslat):
    """Distance from point p to segment a-b, all (lat, lon)."""
    py, px = p[0] * M_PER_DEG_LAT, p[1] * M_PER_DEG_LAT * coslat
    ay, ax = a[0] * M_PER_DEG_LAT, a[1] * M_PER_DEG_LAT * coslat
    by, bx = b[0] * M_PER_DEG_LAT, b[1] * M_PER_DEG_LAT * coslat
    dx, dy = bx - ax, by - ay
    if dx == dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def line_length_m(coords, coslat):
    return sum(
        dist_m(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1], coslat)
        for i in range(len(coords) - 1)
    )


def min_dist_to_lines(p, lines, coslat):
    return min(
        seg_point_dist_m(p, line[i], line[i + 1], coslat)
        for line in lines
        for i in range(len(line) - 1)
    )


def load_osm_lines(path, name_ref_filter):
    """OSM Overpass JSON -> list of [(lat, lon), ...] for matching highway ways."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    lines = []
    for el in data.get("elements", []):
        tags = el.get("tags", {}) or {}
        if not tags.get("highway"):
            continue
        if name_ref_filter and name_ref_filter not in (tags.get("ref") or ""):
            continue
        geom = el.get("geometry") or []
        if len(geom) >= 2:
            lines.append([(g["lat"], g["lon"]) for g in geom])
    return lines


def load_geojson_lines(path, id_filter):
    """GeoJSON (MVUM pull) -> list of [(lat, lon), ...] for matching features."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    lines = []
    for f in data.get("features", []):
        props = f.get("properties", {}) or {}
        if id_filter and str(props.get("id", "")) != id_filter:
            continue
        geom = f.get("geometry") or {}
        coords = geom.get("coordinates") or []
        parts = [coords] if geom.get("type") == "LineString" else coords
        for part in parts:
            if len(part) >= 2:
                lines.append([(c[1], c[0]) for c in part])  # GeoJSON is lon,lat
    return lines


def sample_points(lines, step_m, coslat):
    pts = []
    for line in lines:
        acc = 0.0
        pts.append(line[0])
        for i in range(len(line) - 1):
            d = dist_m(line[i][0], line[i][1], line[i + 1][0], line[i + 1][1], coslat)
            acc += d
            if acc >= step_m:
                pts.append(line[i + 1])
                acc = 0.0
    return pts


def main():
    trail_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "data/bunce-school-road")
    osm_lines = load_osm_lines(trail_dir / "raw" / "osm-overpass.json", "105.0")
    mvum_lines = load_geojson_lines(trail_dir / "raw" / "mvum-bunce.geojson", "105.0")
    if not osm_lines or not mvum_lines:
        sys.exit(f"missing geometry: osm={len(osm_lines)} mvum={len(mvum_lines)} lines")

    coslat = math.cos(math.radians(osm_lines[0][0][0]))
    osm_len = sum(line_length_m(l, coslat) for l in osm_lines)
    mvum_len = sum(line_length_m(l, coslat) for l in mvum_lines)

    offsets = [
        min_dist_to_lines(p, mvum_lines, coslat)
        for p in sample_points(osm_lines, 25.0, coslat)
    ]
    offsets.sort()
    n = len(offsets)
    stats = {
        "osm_length_m": round(osm_len, 1),
        "mvum_length_m": round(mvum_len, 1),
        "osm_ways": len(osm_lines),
        "mvum_segments": len(mvum_lines),
        "samples": n,
        "offset_m": {
            "mean": round(sum(offsets) / n, 2),
            "median": round(offsets[n // 2], 2),
            "p95": round(offsets[int(n * 0.95)], 2),
            "max": round(offsets[-1], 2),
        },
    }
    out = trail_dir / "derived"
    out.mkdir(exist_ok=True)
    (out / "geometry-comparison.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
