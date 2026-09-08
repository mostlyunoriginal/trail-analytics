# GitHub Pages deployment

The enhanced viewer remains a static HTML/CSS/JavaScript app. The Python scripts
run before deployment; Pages only serves the resulting files. No application
server, database, or secret API key is required.

Project address: **https://mostlyunoriginal.github.io/trail-analytics/**,
as a project Pages site attached to `mostlyunoriginal/trail-analytics`. This lets
the existing personal homepage continue independently. GitHub documents this URL
convention in [What is GitHub Pages?](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

## Prepare and review

```powershell
py tools/pipeline/enhance.py
py tools/pipeline/package_site.py --out dist/astra-enhance
py -m http.server 8352 --directory dist --bind 127.0.0.1
```

Open `http://127.0.0.1:8352/astra-enhance/`. This deliberately exercises a project
subdirectory. All application asset paths are relative; view links preserve it.
Choose a new output directory for subsequent packages; packaging never overwrites
an existing artifact. The packager verifies every release asset's hash first.

The artifact contains only the viewer and one complete data release. It excludes
raw downloads, Python tools, Ringboard, workspace notes, and browser-stored field
notes. Review `artifact.json`, route caveats, and the dated evidence before making
the site public. Images referenced by external URL remain external.

## Publishing the reviewed artifact

The user approved `dist/astra-enhance/` on 2026-09-08. Its build ID is
`0d111a99c7608c98ddf6`; the artifact is committed on the dedicated `gh-pages`
branch. Publishing these exact files avoids fetching or changing the reviewed
terrain and condition snapshots during deployment.

Pages uses **Deploy from a branch**, branch **gh-pages**, folder **/ (root)**.
The artifact includes `.nojekyll`. The source code remains on `astra-enhance`;
pushing source changes alone does not redeploy the site.

The owner made the repository public, and deployment completed on 2026-09-08
with HTTPS enforced. GitHub reports deployment commit `197c883` as built.
The personal homepage remains independent.

For subsequent deployments:

1. Refresh public source snapshots if appropriate, build, and package into a new
   `dist/` directory using the commands above.
2. Review the package locally and run the validation checks.
3. Clone the existing `gh-pages` branch into a separate staging directory.
   Replace its published content with only the new artifact's contents, including
   `.nojekyll`, and retain the checkout's `.git` directory and branch history.
   Set `core.autocrlf=false` in that checkout to preserve asset bytes.
4. Commit and push the updated artifact to `gh-pages` without force-pushing.
5. Wait for the Pages build, then check the live `artifact.json` build ID,
   viewer, terrain loading, share links, and mobile layout.

To roll back, revert the relevant deployment commit on `gh-pages` and push.
Do not publish the source checkout or raw cache as the Pages root.

## Operational limits

The current terrain bundle is roughly 50 MB, split into small tiles; this is well
below Pages' [1 GB published-site limit](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
Adding many bundles or obstacle reconstructions may justify external object
storage. CDN-hosted Cesium, map imagery, NWS refreshes, and embedded videos require
network access. The build is offline-capable, but the entire viewer is not an
offline map application.

On Pages, field notes stay in the visitor's browser and do not sync to GitHub.
Changing site origin/path can change storage behavior; export notes first.
Published snow and agency information ages until a new snapshot is deployed.
The interface displays source timestamps, unknown access, and stale weather.
