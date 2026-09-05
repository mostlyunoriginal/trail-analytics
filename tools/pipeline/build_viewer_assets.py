#!/usr/bin/env python3
"""Phase 1 pipeline: build viewer assets for one trail from cached/raw public data.

Deterministic: same inputs -> same outputs. Network is touched only to fill a missing
raw cache file (the DEM export); everything derived is rebuilt from raw/ every run.

Inputs  (data/<slug>/raw/):  osm-overpass.json, mvum-bunce.geojson, dem-corridor-2m.tif
Outputs (data/<slug>/derived/viewer/):
  terrain.json   heightfield metadata (bbox, size, min/max elevation)
  terrain.bin    Float32 LE row-major heightfield, north row first
  centerline.json  ordered trail centerline with chainage/elevation/grade per vertex
  mvum.json      MVUM designated segments + key attributes
"""
from __future__ import annotations

import json
import math
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import tifffile

M_PER_DEG_LAT = 111_320.0
DEM_SERVICE = (
    "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/"
    "ImageServer/exportImage"
)
TARGET_RES_M = 2.0  # DEM grid spacing for the flythrough heightfield
MARGIN_DEG = 0.010  # corridor margin around the trail's bbox
PROFILE_STEP_M = 10.0

# The OSM way that IS the trail (disambiguated in the Phase 0 spike).
MAIN_OSM_WAY = 164929506
MVUM_ROUTE_ID = "105.0"


def load_osm_centerline(path: Path) -> list[tuple[float, float]]:
    data = json.loads(path.read_text())
    for el in data["elements"]:
        if el.get("id") == MAIN_OSM_WAY:
            return [(g["lon"], g["lat"]) for g in el["geometry"]]
    sys.exit(f"OSM way {MAIN_OSM_WAY} not in {path}")


def load_mvum(path: Path) -> list[dict]:
    data = json.loads(path.read_text())
    out = []
    for f in data["features"]:
        p = f.get("properties", {})
        geom = f.get("geometry", {})
        coords = geom.get("coordinates", [])
        parts = [coords] if geom.get("type") == "LineString" else coords
        for part in parts:
            out.append(
                {
                    "id": p.get("id"),
                    "name": p.get("name"),
                    "symbol": p.get("mvum_symbol_name"),
                    "seasonal": p.get("seasonal"),
                    "maintenance": p.get("operationalmaintlevel"),
                    "coords": [[c[0], c[1]] for c in part],
                }
            )
    return out


MAX_EXPORT_PX = 5_000_000  # empirical 3DEPElevation exportImage budget per request


def snap_bbox(bbox, cell_deg):
    """Snap bbox to a whole number of uniform degree cells.

    exportImage silently EXPANDS a bbox whose degree aspect ratio doesn't match the
    requested pixel size (it never distorts pixels), which misregisters the result
    against the requested bbox. Using one square-in-degrees cell for both axes and
    snapping the bbox to it keeps request and response geometry identical.
    """
    west, south, east, north = bbox
    width_px = math.ceil((east - west) / cell_deg)
    height_px = math.ceil((north - south) / cell_deg)
    return (west, south, west + width_px * cell_deg, south + height_px * cell_deg), width_px, height_px


def fetch_dem(raw_dir: Path, bbox, width_px: int, height_px: int) -> np.ndarray:
    """Export the corridor DEM in horizontal bands (cached individually), stack north->south."""
    west, south, east, north = bbox
    n_bands = math.ceil(width_px * height_px / MAX_EXPORT_PX)
    band_rows = math.ceil(height_px / n_bands)
    bands = []
    for i in range(n_bands):
        r0, r1 = i * band_rows, min((i + 1) * band_rows, height_px)
        band_path = raw_dir / f"dem-corridor-2m-band{i}.tif"
        if not band_path.exists():
            lat_n = north - r0 * (north - south) / height_px
            lat_s = north - r1 * (north - south) / height_px
            params = urllib.parse.urlencode(
                {
                    "bbox": f"{west},{lat_s},{east},{lat_n}",
                    "bboxSR": "4326",
                    "imageSR": "4326",
                    "size": f"{width_px},{r1 - r0}",
                    "format": "tiff",
                    "pixelType": "F32",
                    "f": "image",
                }
            )
            print(f"fetching DEM band {i + 1}/{n_bands} ({width_px}x{r1 - r0}) ...")
            req = urllib.request.Request(
                f"{DEM_SERVICE}?{params}",
                headers={"User-Agent": "trail-analytics-pipeline/0.1"},
            )
            with urllib.request.urlopen(req, timeout=600) as resp:
                band_path.write_bytes(resp.read())
        band = tifffile.imread(band_path).astype(np.float32)
        if band.ndim == 3:
            band = band[..., 0]
        bands.append(band)
    return np.vstack(bands)


def bilinear(grid: np.ndarray, bbox, lon: float, lat: float) -> float:
    """Sample the north-up heightfield at lon/lat."""
    west, south, east, north = bbox
    rows, cols = grid.shape
    fx = (lon - west) / (east - west) * (cols - 1)
    fy = (north - lat) / (north - south) * (rows - 1)
    x0, y0 = int(np.clip(fx, 0, cols - 2)), int(np.clip(fy, 0, rows - 2))
    dx, dy = fx - x0, fy - y0
    z = (
        grid[y0, x0] * (1 - dx) * (1 - dy)
        + grid[y0, x0 + 1] * dx * (1 - dy)
        + grid[y0 + 1, x0] * (1 - dx) * dy
        + grid[y0 + 1, x0 + 1] * dx * dy
    )
    return float(z)


def build_profile(centerline, grid, bbox):
    """Resample the centerline every PROFILE_STEP_M; attach chainage/elevation/grade."""
    coslat = math.cos(math.radians(centerline[0][1]))

    def dist(a, b):
        return math.hypot(
            (b[1] - a[1]) * M_PER_DEG_LAT, (b[0] - a[0]) * M_PER_DEG_LAT * coslat
        )

    pts = []  # (chainage_m, lon, lat)
    chain = 0.0
    pts.append((0.0, *centerline[0]))
    carry = 0.0
    for a, b in zip(centerline, centerline[1:]):
        seg = dist(a, b)
        if seg == 0:
            continue
        t = (PROFILE_STEP_M - carry) / seg
        while t <= 1.0:
            lon = a[0] + (b[0] - a[0]) * t
            lat = a[1] + (b[1] - a[1]) * t
            chain += PROFILE_STEP_M
            pts.append((chain, lon, lat))
            t += PROFILE_STEP_M / seg
        carry = (carry + seg) % PROFILE_STEP_M
    chain_total = 0.0
    for a, b in zip(centerline, centerline[1:]):
        chain_total += dist(a, b)
    if pts[-1][0] < chain_total:
        pts.append((chain_total, *centerline[-1]))

    raw_z = [bilinear(grid, bbox, lon, lat) for _, lon, lat in pts]
    # The centerline can sit meters off the physical road bench (median OSM<->MVUM
    # offset is ~7m), so a single DEM pixel can catch an adjacent cut/wall. A short
    # median window keeps the road's real grades while dropping those spikes.
    smooth_z = [
        float(np.median(raw_z[max(0, i - 2) : i + 3])) for i in range(len(raw_z))
    ]
    out = []
    for (d, lon, lat), z in zip(pts, smooth_z):
        out.append({"d": round(d, 1), "lon": lon, "lat": lat, "z": round(z, 2)})
    for i, p in enumerate(out):
        if 0 < i < len(out) - 1:
            dz = out[i + 1]["z"] - out[i - 1]["z"]
            dd = out[i + 1]["d"] - out[i - 1]["d"]
        elif i == 0:
            dz, dd = out[1]["z"] - out[0]["z"], out[1]["d"] - out[0]["d"]
        else:
            dz, dd = out[i]["z"] - out[i - 1]["z"], out[i]["d"] - out[i - 1]["d"]
        p["g"] = round(dz / dd if dd else 0.0, 4)
    return out


def anchor_waypoints(trail_dir: Path, profile) -> list[dict]:
    """Anchor curated waypoints (data/<slug>/waypoints.json) to trail chainage."""
    src = trail_dir / "waypoints.json"
    if not src.exists():
        return []
    coslat = math.cos(math.radians(profile[0]["lat"]))
    out = []
    for wp in json.loads(src.read_text())["waypoints"]:
        nearest = min(
            profile,
            key=lambda p: math.hypot(
                (wp["lat"] - p["lat"]) * M_PER_DEG_LAT,
                (wp["lon"] - p["lon"]) * M_PER_DEG_LAT * coslat,
            ),
        )
        off = math.hypot(
            (wp["lat"] - nearest["lat"]) * M_PER_DEG_LAT,
            (wp["lon"] - nearest["lon"]) * M_PER_DEG_LAT * coslat,
        )
        out.append({**wp, "d": nearest["d"], "z": nearest["z"], "offset_m": round(off, 1)})
    return sorted(out, key=lambda w: w["d"])


def build_analysis(profile) -> dict:
    """Sustained-steepness and roughness zones along the profile."""
    g = [p["g"] for p in profile]
    n = len(g)

    def rolling(fn, half):
        return [fn(g[max(0, i - half) : i + half + 1]) for i in range(n)]

    mean_abs = rolling(lambda w: sum(abs(x) for x in w) / len(w), 7)  # ~150m window
    std = rolling(
        lambda w: (sum((x - sum(w) / len(w)) ** 2 for x in w) / len(w)) ** 0.5, 5
    )

    def zones(metric, thresh, min_pts=3):
        found, start = [], None
        for i in range(n + 1):
            hot = i < n and metric[i] >= thresh
            if hot and start is None:
                start = i
            elif not hot and start is not None:
                if i - start >= min_pts:
                    seg = metric[start:i]
                    found.append(
                        {
                            "d0": profile[start]["d"],
                            "d1": profile[i - 1]["d"],
                            "peak": round(max(seg), 4),
                            "mean": round(sum(seg) / len(seg), 4),
                        }
                    )
                start = None
        return sorted(found, key=lambda z: -z["peak"])[:8]

    return {
        "steep": zones(mean_abs, 0.12),
        "rough": zones(std, 0.045),
        "stats": {
            "length_m": profile[-1]["d"],
            "zmin": min(p["z"] for p in profile),
            "zmax": max(p["z"] for p in profile),
            "max_grade": round(max(abs(x) for x in g), 4),
        },
    }


def validate_against_service(profile, tolerance_m=8.0):
    """Spot-check grid-derived elevations against the service's point-identify.

    Guards against export misregistration (see snap_bbox). Warn-only above tolerance:
    identify reads the 1m source while the grid is a 2m resample, so a few meters of
    disagreement on steep ground is expected.
    """
    identify_url = DEM_SERVICE.replace("exportImage", "identify")
    worst = 0.0
    for frac in (0.25, 0.5, 0.75):
        p = profile[int(len(profile) * frac)]
        geom = json.dumps({"x": p["lon"], "y": p["lat"], "spatialReference": {"wkid": 4326}})
        params = urllib.parse.urlencode(
            {"geometry": geom, "geometryType": "esriGeometryPoint", "returnGeometry": "false", "f": "json"}
        )
        req = urllib.request.Request(
            f"{identify_url}?{params}", headers={"User-Agent": "trail-analytics-pipeline/0.1"}
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            value = json.loads(resp.read())["value"]
        diff = abs(p["z"] - float(value))
        worst = max(worst, diff)
        print(f"  validate mile {p['d']/1609.34:.2f}: grid {p['z']:.1f} vs service {float(value):.1f} (d={diff:.1f} m)")
    if worst > tolerance_m:
        print(f"WARNING: worst validation diff {worst:.1f} m exceeds {tolerance_m} m — check export registration")


def main():
    trail_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "data/bunce-school-road")
    raw, derived = trail_dir / "raw", trail_dir / "derived" / "viewer"
    derived.mkdir(parents=True, exist_ok=True)

    centerline = load_osm_centerline(raw / "osm-overpass.json")
    lons = [c[0] for c in centerline]
    lats = [c[1] for c in centerline]
    cell_deg = TARGET_RES_M / M_PER_DEG_LAT
    bbox, width_px, height_px = snap_bbox(
        (
            min(lons) - MARGIN_DEG,
            min(lats) - MARGIN_DEG,
            max(lons) + MARGIN_DEG,
            max(lats) + MARGIN_DEG,
        ),
        cell_deg,
    )

    grid = fetch_dem(raw, bbox, width_px, height_px)
    nodata = grid <= -9000
    if nodata.any():
        grid[nodata] = float(grid[~nodata].min())
    print(f"DEM grid {grid.shape}, z {grid.min():.1f}..{grid.max():.1f} m")

    # Sampling happens against pixel CENTERS; bbox gives pixel outer edges.
    cbounds = (
        bbox[0] + cell_deg / 2,
        bbox[1] + cell_deg / 2,
        bbox[2] - cell_deg / 2,
        bbox[3] - cell_deg / 2,
    )

    grid.astype("<f4").tofile(derived / "terrain.bin")
    (derived / "terrain.json").write_text(
        json.dumps(
            {
                "west": cbounds[0],
                "south": cbounds[1],
                "east": cbounds[2],
                "north": cbounds[3],
                "cols": int(grid.shape[1]),
                "rows": int(grid.shape[0]),
                "zmin": float(grid.min()),
                "zmax": float(grid.max()),
                "source": "USGS 3DEP (3DEPElevation ImageServer export, ~2m)",
            },
            indent=2,
        )
    )

    profile = build_profile(centerline, grid, cbounds)
    (derived / "centerline.json").write_text(json.dumps(profile))
    validate_against_service(profile)
    print(
        f"centerline: {len(profile)} pts, {profile[-1]['d']/1609.34:.2f} mi, "
        f"z {min(p['z'] for p in profile):.0f}..{max(p['z'] for p in profile):.0f} m, "
        f"max grade {max(abs(p['g']) for p in profile)*100:.0f}%"
    )

    mvum = load_mvum(raw / "mvum-bunce.geojson")
    (derived / "mvum.json").write_text(json.dumps(mvum))
    print(f"mvum: {len(mvum)} segments")

    waypoints = anchor_waypoints(trail_dir, profile)
    (derived / "waypoints.json").write_text(json.dumps(waypoints, indent=1))
    print(f"waypoints: {len(waypoints)} anchored" + (
        f", worst offset {max(w['offset_m'] for w in waypoints)} m" if waypoints else ""))

    analysis = build_analysis(profile)
    (derived / "analysis.json").write_text(json.dumps(analysis, indent=1))
    print(f"analysis: {len(analysis['steep'])} steep zones, {len(analysis['rough'])} rough zones")


if __name__ == "__main__":
    main()
