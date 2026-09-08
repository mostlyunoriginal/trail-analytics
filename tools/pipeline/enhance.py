"""Build a versioned planning bundle. Offline by default; publish via atomic pointer.

Usage: py tools/pipeline/enhance.py [data/bunce-school-road] [--fetch] [--validate-live]
No live request occurs without one of the explicit network flags.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import json
import math
import os
import platform
import re
import tempfile
import uuid
from pathlib import Path
from xml.etree import ElementTree as ET

import numpy as np
import tifffile
import build_viewer_assets as base

SCHEMA = 2
MVUM_URL = "https://apps.fs.usda.gov/fsgisx05/rest/services/wo_nfs_gtac/IVMQuery/MapServer/0"
MI = 1609.34


@contextmanager
def staging_directory(parent):
    # Inherit normal directory ACLs. tempfile's owner-only Windows ACLs would
    # otherwise be carried into a published release and block a separate server.
    path = parent / ("staging-" + uuid.uuid4().hex)
    path.mkdir()
    try:
        yield path
    except BaseException:
        # Retain an incomplete stage for diagnosis; it is never pointed to or packaged.
        raise


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")), encoding="utf-8")


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def distance(a, b):
    return math.hypot((a[1] - b[1]) * 111320, (a[0] - b[0]) * 111320 * math.cos(math.radians(a[1])))


def line_distance(point, coords):
    p = np.array(point) * [math.cos(math.radians(point[1])) * 111320, 111320]
    xy = np.asarray(coords)[:, :2] * [math.cos(math.radians(point[1])) * 111320, 111320]
    if len(xy) < 2:
        return float(np.linalg.norm(xy[0] - p)) if len(xy) else math.inf
    a, delta = xy[:-1], np.diff(xy, axis=0)
    den = (delta * delta).sum(axis=1)
    t = np.clip(((p - a) * delta).sum(axis=1) / np.where(den == 0, 1, den), 0, 1)
    return float(np.linalg.norm(p - (a + t[:, None] * delta), axis=1).min())


def mvum_segments(raw):
    result, seen = [], set()
    for path in sorted(raw.glob("mvum-*.geojson")):
        for f in read(path)["features"]:
            props = {k.lower(): v for k, v in f["properties"].items()}
            geometry = f["geometry"]
            parts = [geometry["coordinates"]] if geometry["type"] == "LineString" else geometry["coordinates"]
            for coords in parts:
                key = (props.get("id"), str(coords))
                if key in seen:
                    continue
                seen.add(key)
                result.append({"id": props.get("id"), "coords": [c[:2] for c in coords],
                               "attributes": props, "source_url": MVUM_URL, "cache_file": path.name})
    return result


def access_for(point, ways, mvum, route_ids):
    way = min(ways, key=lambda w: line_distance(point, w["coords"]))
    tags = way["tags"]
    matches = [s for s in mvum if s["id"] in route_ids and line_distance(point, s["coords"]) <= 30]
    restricted = tags.get("motor_vehicle") in ("no", "private") or tags.get("access") in ("no", "private")
    status = "conflict" if restricted else "designated" if matches else "unverified"
    return {"status": status, "osm_way": way["id"], "osm_tags": tags,
            "mvum_ids": sorted(set(s["id"] for s in matches)),
            "basis": "OSM restricts access; verify the applicable agency designation." if restricted else
                     "Cached MVUM geometry within 30 m; current closures still need review." if matches else
                     "No matching cached MVUM segment within 30 m. Access is unverified."}


def access_runs(profile, ways, mvum, route_ids):
    runs = []
    for i, p in enumerate(profile[:-1]):
        next_p = profile[i + 1]
        info = access_for(((p["lon"] + next_p["lon"]) / 2, (p["lat"] + next_p["lat"]) / 2), ways, mvum, route_ids)
        key = (info["status"], info["osm_way"], tuple(info["mvum_ids"]))
        if runs and runs[-1]["_key"] == key:
            runs[-1]["d1"] = next_p["d"]
        else:
            runs.append({**info, "d0": p["d"], "d1": next_p["d"], "_key": key})
    for r in runs:
        del r["_key"]
    return runs


def media_covers(media, target):
    """A nearby embed is context, never proof of obstacle coverage."""
    return (media.get("coverage_verified") is True and target in media.get("target_ids", [])
            and (media.get("type") == "photo" or (type(media.get("start_seconds")) in (int, float)
                 and math.isfinite(media['start_seconds']) and media['start_seconds'] >= 0)))


def capture_targets(route, profile, analysis, waypoints):
    targets = []
    for w in waypoints:
        if w["route"] == route["id"] and w["kind"] == "obstacle":
            targets.append({"id": w["id"], "route": route["id"], "d": w["d"], "lon": w["lon"], "lat": w["lat"],
                            "title": w["title"], "reason": w.get("notes", ""), "confidence": w.get("confidence", "approximate"),
                            "priority": 1, "minutes": 12})
    for kind in ("steep", "grade_variability"):
        for zone in analysis[kind]:
            mid = (zone["d0"] + zone["d1"]) / 2
            if any(abs(t["d"] - mid) < 120 for t in targets):
                continue
            p = min(profile, key=lambda p: abs(p["d"] - mid))
            targets.append({"id": f"{route['id']}-{kind}-{round(mid)}", "route": route["id"], "d": p["d"],
                            "lon": p["lon"], "lat": p["lat"], "title": f"{'Sustained grade' if kind == 'steep' else 'Grade variation'} · mile {mid / MI:.2f}",
                            "reason": "DEM candidate: inspect the road alignment and terrain before choosing a capture location.",
                            "confidence": "model candidate", "priority": 2 if kind == "steep" else 3, "minutes": 8})
    media = [m for w in waypoints if w["route"] == route["id"] for m in w.get("media", [])]
    for t in targets:
        t["covered"] = any(media_covers(m, t["id"]) for m in media)
        t["access"] = next((s["status"] for s in route["access_segments"] if s["d0"] <= t["d"] <= s["d1"]), "unverified")
        if t["access"] == "conflict":
            t["reason"] = "Resolve access conflict before planning a visit. " + t["reason"]
        t["source_url"] = "https://www.usgs.gov/3d-elevation-program"
    return sorted(targets, key=lambda t: (t["priority"], t["d"]))


def write_gpx(path, routes, profiles, targets):
    root = ET.Element("gpx", version="1.1", creator="Trail Analytics", xmlns="http://www.topografix.com/GPX/1/1")
    for t in targets:
        w = ET.SubElement(root, "wpt", lat=str(t["lat"]), lon=str(t["lon"]))
        ET.SubElement(w, "name").text = t["title"]
        ET.SubElement(w, "desc").text = f"P{t['priority']}; {t['access']}; {t['reason']}"
    for r in routes:
        track = ET.SubElement(root, "trk")
        ET.SubElement(track, "name").text = r["name"]
        ET.SubElement(track, "desc").text = "Geometry reference; access and connectivity require verification. " + r.get("notes", "")
        seg = ET.SubElement(track, "trkseg")
        for p in profiles[r["id"]]:
            q = ET.SubElement(seg, "trkpt", lat=str(p["lat"]), lon=str(p["lon"]))
            ET.SubElement(q, "ele").text = str(p["z"])
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)


def terrain_assets(out, grid, meta):
    """Small overview plus independently loadable 257x257 overlapping detail tiles."""
    rows, cols = grid.shape
    ys = np.linspace(0, rows - 1, min(257, rows)).round().astype(int)
    xs = np.linspace(0, cols - 1, min(257, cols)).round().astype(int)
    # Interpolate to a truly uniform overview grid; rounded indexing shifts samples.
    gx = np.linspace(0, cols - 1, len(xs)); gy = np.linspace(0, rows - 1, len(ys))
    x0 = np.minimum(gx.astype(int), cols - 2); dx = gx - x0
    overview = np.empty((len(ys), len(xs)), dtype="<f4")
    for i, y in enumerate(gy):
        y0 = min(int(y), rows - 2); dy = y - y0
        overview[i] = ((grid[y0, x0] * (1-dx) + grid[y0, x0+1] * dx) * (1-dy)
                       + (grid[y0+1, x0] * (1-dx) + grid[y0+1, x0+1] * dx) * dy)
    overview.tofile(out / "overview.bin")
    folder = out / "terrain"; folder.mkdir()
    tiles = []
    for y in range(0, rows - 1, 256):
        for x in range(0, cols - 1, 256):
            tile = grid[y:min(rows, y+257), x:min(cols, x+257)]
            name = f"terrain/{x}-{y}.bin"; tile.astype("<f4").tofile(out / name)
            tiles.append({"x": x, "y": y, "cols": tile.shape[1], "rows": tile.shape[0], "file": name})
    return {**meta, "overview": {"file": "overview.bin", "cols": len(xs), "rows": len(ys)}, "tiles": tiles}


def build(trail_dir, fetch=False, validate_live=False):
    trail_dir = Path(trail_dir)
    raw = trail_dir / "raw"
    manifest = read(trail_dir / "trail.json")
    routes = base.load_routes(trail_dir)
    if not routes or any(not re.fullmatch(r"[a-z0-9-]+", r["id"]) for r in routes):
        raise ValueError("Routes need nonempty, safe IDs")
    if len({r["id"] for r in routes}) != len(routes):
        raise ValueError("Duplicate route IDs")
    coords = [c for r in routes for c in r["coords"]]
    cell = base.TARGET_RES_M / base.M_PER_DEG_LAT
    bbox, width, height = base.snap_bbox((min(c[0] for c in coords)-.01, min(c[1] for c in coords)-.01,
                                         max(c[0] for c in coords)+.01, max(c[1] for c in coords)+.01), cell)
    grid = base.fetch_dem(raw, bbox, width, height, offline=not fetch)
    if grid.shape != (height, width) or not np.isfinite(grid).all() or (grid <= -9000).any():
        raise ValueError("DEM has invalid shape, missing or non-finite elevations; no synthetic fill was published")
    bounds = (bbox[0]+cell/2, bbox[1]+cell/2, bbox[2]-cell/2, bbox[3]-cell/2)
    profiles = {r["id"]: base.build_profile(r["coords"], grid, bounds) for r in routes}
    for rid, p in profiles.items():
        if len(p) < 2 or any(b["d"] <= a["d"] for a,b in zip(p,p[1:])):
            raise ValueError(f"Invalid chainage: {rid}")
    if validate_live:
        for p in profiles.values():
            # Compare unsmoothed samples so filtering is not mistaken for misregistration.
            if base.validate_against_service([{**q, 'z': q['raw_z']} for q in p]) > 8:
                raise ValueError("Live elevation validation exceeded 8 m; previous release retained")
    waypoints = base.anchor_waypoints(trail_dir, profiles)
    for w in waypoints:
        if w["offset_m"] > 50:
            raise ValueError(f"Waypoint {w['id']} is {w['offset_m']} m off route")
    mvum = mvum_segments(raw)
    osm = {e["id"]: {"id":e["id"], "tags":e.get("tags", {}), "coords":[(p["lon"],p["lat"]) for p in e["geometry"]]}
           for e in read(raw / "osm-routes.json")["elements"]}
    analyses, targets = {}, []
    for r in routes:
        p = profiles[r["id"]]
        a = base.build_analysis(p)
        a["grade_variability"] = a.pop("rough")
        a["method"] = {"profile_spacing_m":10, "median_samples":5, "grade_window_m":20,
                       "variability_window_m":110, "confidence":"DEM estimate; not observed surface roughness"}
        a["stats"].update(ascent_m=round(sum(max(0,b["z"]-a["z"]) for a,b in zip(p,p[1:]))),
                          descent_m=round(sum(max(0,a["z"]-b["z"]) for a,b in zip(p,p[1:]))))
        analyses[r["id"]] = a
        r["access_segments"] = access_runs(p, [osm[w] for w in r["osm_way_ids"]], mvum, r["mvum_ids"])
        r["length_m"] = p[-1]["d"]; r["file"] = f"route-{r['id']}.json"
        r["entrances"] = [{"label":label,"lon":q["lon"],"lat":q["lat"],"d":q["d"]} for label,q in [("Route start",p[0]),("Route end",p[-1])]]
        r["stats"] = a["stats"]
        r["source_urls"] = [f"https://www.openstreetmap.org/way/{w}" for w in r["osm_way_ids"]] + [MVUM_URL]
        r["evidence_date"] = manifest.get("resolved")
        r["access_status"] = "conflict" if any(s["status"] == "conflict" for s in r["access_segments"]) else "unverified" if any(s["status"] == "unverified" for s in r["access_segments"]) else "designated"
        targets += capture_targets(r, p, a, waypoints)
        del r["coords"]
    inputs = sorted([trail_dir/"trail.json", trail_dir/"waypoints.json"] + list(raw.glob("*.json")) + list(raw.glob("mvum-*.geojson")) + list(raw.glob("dem-*-band*.tif")))
    sources = {str(p.relative_to(trail_dir)).replace("\\", "/"):digest(p) for p in inputs}
    code = {p.name:digest(p) for p in [Path(__file__),Path(base.__file__)]}
    lock = {"schema_version":SCHEMA, "inputs":sources,"pipeline":code,
            "dependencies":{"python":platform.python_version(),"numpy":np.__version__,"tifffile":tifffile.__version__},
            "evidence_date":manifest.get("resolved"), "native_resolution_m":None,"acquired_at":None,
            "terrain_source":"Cached USGS 3DEPElevation mosaic; native product/date not established by export resolution",
            "sample_spacing_m":{"north_south":2,"east_west":round(2*math.cos(math.radians(bounds[1])),2)},
            "catalog":read(raw/"source-catalog.json") if (raw/"source-catalog.json").exists() else None}
    build_id = hashlib.sha256(json.dumps(lock,sort_keys=True).encode()).hexdigest()[:20]
    root = trail_dir/"derived"/"viewer"; root.mkdir(parents=True,exist_ok=True)
    releases = root/"releases"; releases.mkdir(exist_ok=True)
    release = releases/build_id
    if not release.exists():
        with staging_directory(releases) as tmp:
            out = Path(tmp)
            meta = terrain_assets(out, grid, dict(zip(("west","south","east","north"), bounds)) | {"cols":width,"rows":height,"zmin":float(grid.min()),"zmax":float(grid.max())})
            write(out/"terrain.json",meta); write(out/"routes.json",routes); write(out/"analysis.json",analyses)
            write(out/"waypoints.json",waypoints); write(out/"mvum.json",mvum); write(out/"sources.json",lock)
            write(out/"targets.json",sorted(targets,key=lambda t:(t["priority"],t["route"],t["d"])))
            conditions = read(raw/"conditions.json") if (raw/"conditions.json").exists() else {"fetched_at":None,"weather":[],"snow":[],"notices":[],"errors":["No conditions snapshot. Use Refresh weather in the viewer or run refresh_sources.py."]}
            if (raw/"agency-notices.json").exists():
                conditions['notices'] = read(raw/"agency-notices.json")
            write(out/"conditions.json",conditions)
            write(out/"bundle.json", {k:v for k,v in manifest.items() if k != "routes"})
            for r in routes:
                write(out/r["file"],profiles[r["id"]])
            write_gpx(out/"field-plan.gpx",routes,profiles,targets)
            lines = [f"# Field plan — {manifest['name']}", "", "Access conflicts must be resolved before visiting. Times are capture estimates, excluding travel.", "", "| Priority | Route | Mile | Target | Minutes | Access |", "|---|---|---:|---|---:|---|"]
            for t in sorted(targets,key=lambda t:(t["priority"],t["route"],t["d"])):
                lines.append(f"| {t['priority']} | {t['route']} | {t['d']/MI:.2f} | {t['title']} | {t['minutes']} | {t['access']} |")
            lines += ["", "## Shared capture checklist", "", "- Confirm access and the candidate's actual location.", "- Slow overlapping orbits at waist/head/overhead height; capture each intended driving line.", "- Include a measured scale reference; lock exposure; enable location tagging.", "- Record observation date, direction, conditions, and capture filenames.", "", "A nearby video is context. Coverage requires an explicitly verified target and a timestamp (or photo).", "", "## Access evidence", ""]
            for r in routes:
                lines.append(f"- **{r['name']}**: {r['access_status']}. {r.get('notes','')}".rstrip())
            (out/"field-plan.md").write_text("\n".join(lines)+"\n",encoding="utf-8")
            inventory = {str(p.relative_to(out)).replace("\\","/"): {"bytes":p.stat().st_size,"sha256":digest(p)} for p in sorted(out.rglob("*")) if p.is_file()}
            write(out/"inventory.json",inventory)
            # Move the complete immutable release, never individual live files.
            os.replace(out, release)
    pointer = {"schema_version":SCHEMA,"build_id":build_id,"path":f"releases/{build_id}/"}
    pointer_tmp = root / ("current-" + uuid.uuid4().hex + ".tmp")
    write(pointer_tmp, pointer)
    os.replace(pointer_tmp,root/"current.json")
    print(f"Published {build_id}: {len(routes)} routes, {len(targets)} capture targets; overview {257*257*4/1024:.0f} KiB")
    return release


def cli():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("trail",nargs="?",default="data/bunce-school-road")
    parser.add_argument("--fetch",action="store_true",help="Fetch missing DEM bands")
    parser.add_argument("--validate-live",action="store_true",help="Check all routes against USGS before publication")
    args=parser.parse_args()
    build(args.trail,args.fetch,args.validate_live)


if __name__ == "__main__":
    cli()
