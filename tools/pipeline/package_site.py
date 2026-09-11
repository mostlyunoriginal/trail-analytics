"""Create a reviewable static-site artifact without publishing it."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
from media_publication import merge_publication, read_publication, read_repository_media, write_publication

REPO=Path(__file__).resolve().parents[2]


def package(trail, destination, media_publication=None):
    media_items = read_repository_media(REPO / "viewer", trail)
    if media_publication:
        media_items = merge_publication(media_items, read_publication(media_publication, trail))
    source=REPO/"data"/trail/"derived"/"viewer"
    pointer=json.loads((source/"current.json").read_text())
    release=(source/pointer["path"]).resolve()
    if not release.is_relative_to(source.resolve()) or not release.is_dir():
        raise ValueError("Invalid release pointer")
    inventory=json.loads((release/"inventory.json").read_text())
    # Verify every artifact before creating a deployment folder.
    for name,info in inventory.items():
        p=(release/name).resolve()
        if not p.is_relative_to(release) or not p.is_file(): raise ValueError("Invalid asset path")
        if p.stat().st_size!=info["bytes"] or hashlib.sha256(p.read_bytes()).hexdigest()!=info["sha256"]:
            raise ValueError(f"Asset changed after publication: {name}")
    out=Path(destination).resolve()
    if not out.is_relative_to(REPO/"dist"):
        raise ValueError("Destination must be inside this repository's dist directory")
    if out.exists():raise FileExistsError(f"Choose a new artifact directory; refusing to overwrite {out}")
    out.mkdir(parents=True)
    shutil.copytree(REPO/"viewer",out/"viewer",ignore=shutil.ignore_patterns("*.map", "published-media", "published-media.json", ".media-*"))
    write_publication(out/"viewer", trail, media_items)
    data=out/"data"/trail/"derived"/"viewer";data.mkdir(parents=True)
    shutil.copy2(source/"current.json",data/"current.json")
    shutil.copytree(release,data/pointer["path"])
    (out/".nojekyll").touch()
    (out/"index.html").write_text('<!doctype html><html lang="en"><meta charset="utf-8"><title>Trail Analytics</title><p><a href="viewer/">Open Trail Analytics</a></p><script>location.replace(new URL("viewer/"+location.search+location.hash,location.href))</script></html>',encoding="utf-8")
    files=[p for p in out.rglob("*") if p.is_file()]
    report={"build_id":pointer["build_id"],"files":len(files),"bytes":sum(p.stat().st_size for p in files),"entry":"index.html","published_media":len(media_items),"contains":"Viewer, one public-data release, repository media, and optional reviewed publication media; excludes raw caches, tools, notes and browser storage."}
    (out/"artifact.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    print(json.dumps({"path":str(out),**report},indent=2))
    return out


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("--trail",default="bunce-school-road");p.add_argument("--out",default="dist/astra-enhance")
    p.add_argument("--media-publication", help="Reviewed .trailmedia publication archive; private backups are rejected")
    a=p.parse_args();package(a.trail,a.out,a.media_publication)
