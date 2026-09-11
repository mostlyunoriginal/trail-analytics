# trail-analytics

Personal tool for offroad trail modeling, analysis, and visualization.

**[Open the live trail planner](https://mostlyunoriginal.github.io/trail-analytics/).**

Give it a trail name; an agent gathers public data — USGS 3DEP elevation, NAIP aerial imagery,
USFS MVUM / OpenStreetMap route geometry, trip reports and media — and builds an interactive 3D
model of the trail, browsable in a web viewer: scrub along the route, change perspective, toggle
layers, inspect grade and elevation, and browse location-anchored media. **Add media** attaches
personal photos and videos, suggests locations from supported geographic metadata, and lets
you manually pin/reposition any item on the trail or map. Files and pins stay local until you
explicitly export them. Media is useful on its own; Gaussian-splat reconstruction is not planned.

See [PLAN.md](PLAN.md) for the full vision, constraints, and staged roadmap, and
[docs/capture-protocol.md](docs/capture-protocol.md) for the field capture checklist.

Personal project — US trails only, ToS-clean public data sources only.

See [the media guide](docs/media-guide.md) for attachment, supported formats, full media
backup/restore, and optional selected-media publication. HEIC needs conversion; video playback
depends on the browser's codec support. Nothing uploads automatically.

To share attached files with everyone, select confirmed items in **My media**, choose
**Prepare selected media for publication**, and export. Then run:

```powershell
py tools/pipeline/import_media.py "C:/path/to/bunce-school-road-publication.trailmedia"
```

Commit and push `viewer/published-media.json` and `viewer/published-media/` with the viewer
code. Normal site packages include these files automatically; deploy a new package to
update the live Pages viewer. See [the sharing steps](docs/media-guide.md#share-media-through-the-repository).

## Run the enhanced planner

Python 3.12+ and the two pinned dependencies are required to build assets:

```powershell
py -m pip install -r requirements.txt
py tools/pipeline/enhance.py
py -m http.server 8351 --bind 127.0.0.1
```

Open http://127.0.0.1:8351/viewer/. `viewer.cmd` also builds and launches it.
The build is offline by default. A fresh clone does not include the bulky DEM
cache: use `py tools/pipeline/enhance.py --fetch` once to acquire missing bands.
Use `py tools/pipeline/refresh_sources.py` to refresh public NWS weather, NRCS snow,
USGS product metadata, and agency document discovery, then rebuild.

The viewer provides route summaries, access evidence, saved camera views,
interactive elevation profiles, dated conditions, and a field plan with local
notes and GPX export. See [the enhancement guide](docs/enhancement-guide.md) for
controls, curation formats, and data limitations, and [the Pages deployment guide](docs/github-pages.md)
for publishing and rollback instructions.

## Verify

```powershell
py -m unittest discover -s tests -v
node --test tests/core.test.mjs tests/media.test.mjs
```

The pipeline integration checks require a built bundle. For isolated browser
checks with installed Microsoft Edge:

```powershell
py -m pip install --target .qa/vendor playwright==1.62.0
py tools/qa/browser_check.py
py tools/qa/media_browser_check.py
```

Screenshots and test downloads go to ignored `.qa/`. No browser profile or cloud
account is needed. The live viewer uses public CDN and map services.
