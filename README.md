# trail-analytics

Personal tool for offroad trail modeling, analysis, and visualization.

**[Open the live trail planner](https://mostlyunoriginal.github.io/trail-analytics/).**

Give it a trail name; an agent gathers public data — USGS 3DEP elevation, NAIP aerial imagery,
USFS MVUM / OpenStreetMap route geometry, trip reports and media — and builds an interactive 3D
model of the trail, browsable in a web viewer: scrub along the route, change perspective, toggle
layers, inspect grade and elevation, and (eventually) open Gaussian-splat reconstructions of key
obstacles captured on foot.

See [PLAN.md](PLAN.md) for the full vision, constraints, and staged roadmap, and
[docs/capture-protocol.md](docs/capture-protocol.md) for the field capture checklist.

Personal project — US trails only, ToS-clean public data sources only.

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
node --test tests/core.test.mjs
```

The pipeline integration checks require a built bundle. For isolated browser
checks with installed Microsoft Edge:

```powershell
py -m pip install --target .qa/vendor playwright==1.62.0
py tools/qa/browser_check.py
```

Screenshots and test downloads go to ignored `.qa/`. No browser profile or cloud
account is needed. The live viewer uses public CDN and map services.
