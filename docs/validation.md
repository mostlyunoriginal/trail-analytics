# Validation — astra-enhance, 2026-09-08

- Eight JavaScript tests passed: chainage interpolation, camera/view links,
  malformed controls, media URLs, note import, GPX escaping, forecast dates,
  and cache freshness.
- Eight Python tests passed: access conflicts, unrelated MVUM matches, verified
  media coverage, short final profile intervals, overview interpolation/tile
  seams, offline acquisition, failed-build isolation, and artifact integrity.
- Fourteen isolated headless Edge checks passed with zero application exceptions:
  real Cesium boot, visible access caveats, detail-tile loading, per-route state,
  reverse navigation, keyboard scrubbing, global camera stability, view URLs,
  persistent field notes/downloads, dated conditions, pinned media, mobile layout,
  missing-file recovery, and packaged subdirectory behavior.
- Desktop (1440×1000) and mobile (390×844) screenshots were visually inspected.
  Screenshots and disposable QA downloads are in `.qa/`.
- Twelve live USGS comparisons across all four routes passed; the largest
  observed raw elevation difference was approximately 0.2 m. This checks export
  registration, not obstacle-scale accuracy or current road conditions.
- Public acquisition succeeded for four NWS locations, three SNOTEL stations,
  seven native DEM catalog products, and two Forest Service pages.
- The prepared static artifact is `dist/astra-enhance/`: 221 content files,
  48,753,671 bytes before its small artifact manifest. Startup overview terrain is
  264,196 bytes; detailed terrain loads as needed.

The updated browser plugin initializes successfully but reports no connected
browsers (2026-09-08). Testing used a separate temporary Edge profile, not the
user's normal browser or the desktop app's in-app profile.

Remaining evidence limitations are explicit in the product: the Lateral access
conflict and unmapped connection are unresolved; the cached mosaic's exact native
acquisition provenance is unverified; historical videos have no verified obstacle
timestamps; the added Ironclads locations are model candidates. Field observations
and official access determinations cannot be manufactured by software changes.

The user approved deployment on 2026-09-08. The exact reviewed artifact was
verified against its inventory and pushed to `gh-pages` in commit `197c883`.
After the owner made the repository public, GitHub Pages deployed that commit
successfully with HTTPS enforced at
https://mostlyunoriginal.github.io/trail-analytics/.

Live deployment checks passed: 12 published files matched the reviewed artifact
by SHA-256, including the viewer code, current pointer, release inventory,
overview terrain, and a detail tile. Isolated Edge loaded the real map and all
four route options; dated weather/snow rendered; shared views survived reload;
desktop and 390px mobile screenshots were inspected. There were no application
exceptions or failed project-site responses during the smoke test.
The existing personal homepage has not been modified.
