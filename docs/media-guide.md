# Attach trail photos and videos

Open the local viewer and choose **Add media** or **My media**. Additions stay on this
browser/device; they do not change the public site. Use HTTPS or localhost (the normal
`viewer.cmd` setup); a phone opening an HTTP LAN address may lack required secure-browser APIs.

## Add, place, and edit

1. Choose files, or drop them onto the import area. Import saves each successful file to
   **Unplaced**, so a later failure in a batch does not discard earlier files.
2. Preview the photo/video. Supported GPS is an unconfirmed suggestion. Without GPS, the
   current trail position is a starting suggestion, not an assertion about where it was taken.
3. Use **Choose on map**, drag the gold draft pin, enter latitude/longitude, select a waypoint,
   or choose **Use trail position**. **Show draft pin** moves the camera to it. Original GPS
   remains available after manual changes through **Use original GPS**.
4. Optionally associate a route/segment; mileage and distance from the route are shown.
   Nearby routes and loop segments have separate choices. **Snap to chosen route segment**
   is explicit: association alone does not move the pin. Keeping a map-only/off-trail pin is fine.
5. **Confirm location & save**, or **Keep unplaced** to remove the current placement while
   retaining the file and original GPS. Optional details include caption, recording date,
   direction, conditions, video start time, and explicit dated coverage review for a target.

You can also select a waypoint in **Evidence → Add media at this waypoint**, or click a map
point and choose **Add media at selected point** before importing. GPS still takes precedence
as an initial suggestion, never as an irreversible placement decision.

Open any local item again to edit or move it. Click cyan map markers to open their media;
repeated clicks cycle through attachments sharing a pin. Gold indicates the editable draft.
The photo preview has a full-size link; videos have normal playback controls. One video pin
represents a chosen point/moment, not the path covered by the entire recording.

**Near trail position** filters confirmed route-associated media within 250 metres of the
scrubber's chainage. Map-only pins remain in **All media** and on the map. **Needs review**
includes unplaced, undated, older-than-one-year, coverage-unverified, and changed-route items.
These are review prompts, not claims that evidence is wrong or that access is safe.
Coverage review is attachment-specific and does not silently change the pipeline's field-plan
status; use the existing field notes/status controls to record visit progress.

Select several local items and use **Pin selected at current trail position…** only when they
really share a location. The confirmation lists the destination; this replaces their pins and
clears prior coverage verification, but preserves original GPS. Other batch imports are reviewed
one item at a time. Leaving the page or switching items warns about unsaved edits.

## Supported files and metadata

- Up to **100 MiB per file**: JPEG, PNG, WebP, browser-playable MP4/MOV and WebM. The importer
  checks file signatures and browser decoding, not just extensions. MOV compatibility depends
  on its codec. Convert unsupported photos (including HEIC) to JPEG and videos to H.264 MP4;
  trim/compress large clips. There is no built-in transcoder.
- Geographic metadata: EXIF GPS in JPEG and PNG/WebP EXIF chunks; MP4/MOV QuickTime
  `com.apple.quicktime.location.ISO6709` metadata and legacy `©xyz` user data. The first version
  supports signed decimal-degree ISO 6709 strings, not every coordinate notation or timed GPS
  track. No WebM/XMP/sidecar location reader is included.
- EXIF DateTimeOriginal and supported QuickTime creation-date tags populate the recording date.
  A date without timezone stays without timezone; import time is never substituted for it.
  Correcting the displayed date preserves the original extracted value in a private backup.
- Missing, malformed, oversized, or unsupported metadata falls back to manual pinning. GPS
  does not automatically verify a target. Metadata parsing is bounded (JPEG header 2 MiB,
  image EXIF chunks 1 MiB, video metadata atom 16 MiB) and skips large video payloads.
- Route/segment associations store a hash of the route geometry. A rebuilt, changed route
  triggers review instead of moving a saved pin; reselect the association before relying on mileage.

Parser references: [CIPA Exif standards](https://www.cipa.jp/e/std/std-sec.html) and
[Apple QuickTime location metadata](https://developer.apple.com/documentation/quicktime-file-format/location_metadata).

## Back up and restore

**Back up all / selected** downloads a `.trailmedia` archive containing original file bytes,
descriptions, original metadata, and saved placements. With no selection it includes all items;
with a selection it includes only those items. Unsaved editor edits are not included.

**Restore media** validates the trail, record structure, size, and file hashes before importing.
Existing IDs or identical file hashes are reported as duplicates/conflicts and skipped, never
silently overwritten. To recover a conflicting backup version, first back up the local version,
then delete that attachment and restore the desired archive. New-item storage failures are
reported separately; successful imports remain available. Archives are limited to **500 MiB**;
select smaller batches when needed.

Media is stored in IndexedDB, separately from notes and saved views. Browser clearing, quota
limits, private browsing, and eviction can lose it. Keep backups outside the browser. Changing
hostname, port, browser, or device creates a different storage context; restore your archive
there. Existing **Back up notes** does not include media. No automatic sync or cloud backup exists.

## Share media through the repository

1. Save and select only the confirmed items you intend to make public.
2. Expand **Prepare selected media for publication**. By default photos are re-encoded as
   JPEG without embedded metadata (transparency is flattened onto white). Original files stay
   unchanged locally. Video metadata stripping is not implemented: exclude videos, strip them
   externally before attachment, or explicitly allow originals with embedded metadata.
3. Review titles, coordinates, captions, dates, faces, plates, and sensitive locations. The
   selected map pins remain public even when embedded metadata is stripped. Confirm and export.
4. Import the downloaded archive into your repository checkout (run from the repository root):

   ```powershell
   py tools/pipeline/import_media.py "C:/path/to/bunce-school-road-publication.trailmedia"
   ```

   This saves the selected files in `viewer/published-media/` and their descriptions/pins
   in `viewer/published-media.json`. Reload the local viewer to review them. New imports
   retain earlier shared attachments; re-exporting an existing attachment updates that ID's
   file, caption, and pin. Importing the same archive again does not duplicate attachments.
   The current viewer has one shared trail manifest; `--trail` must match it when it is nonempty.

5. Commit and push the manifest and assets together, along with the media feature code if
   it has not yet been pushed. For subsequent media-only updates:

   ```powershell
   git add viewer/published-media.json viewer/published-media/
   git commit -m "Share trail photos and videos"
   git push
   ```

   Anyone pulling that source branch gets the media. **The live Pages viewer requires a
   new deployment**, because it is served from the separate `gh-pages` branch.

6. Build a new site package. Saved repository media is included automatically:

   ```powershell
   py tools/pipeline/package_site.py --out dist/media-review
   ```

   Review it, then follow [the Pages deployment steps](github-pages.md#publishing-the-reviewed-artifact).
   Visitors see the shared pins and can play media without importing an archive or using
   the browser/device where the files were attached.

Repository files are checked for valid pins, file sizes, paths, and SHA-256 hashes before
packaging. Files have content-versioned names, so updated bytes get fresh URLs. Older asset
versions may remain in the source folder for safety; only files referenced by the manifest
are included in a site package. Local edits with the same attachment ID take precedence on
your device; a fresh browser shows the shared version.

To stop including an attachment in future builds, remove its record from
`viewer/published-media.json`, then commit, push, and redeploy. Its files can also be removed
from `viewer/published-media/`; previous Git commits and already-downloaded copies retain them.

### One-off site package

You can also add a reviewed archive to a single package without importing it into the
repository. This merges the export with saved repository media for that build only:

   ```powershell
   py tools/pipeline/package_site.py --out dist/media-review --media-publication C:/path/to/bunce-school-road-publication.trailmedia
   ```

Only an archive marked for publication is accepted by either command; private backup archives are rejected.
The artifact includes a separate published-media manifest and selected assets, not browser
storage or raw caches. Published media loads on demand and is read-only. To make an editable
private copy, back it up and restore it. Follow the existing Pages review/deployment process
only after inspecting the resulting artifact. No publication is performed by attaching media.

## Verification

```powershell
node --test tests/core.test.mjs tests/media.test.mjs
py -m unittest discover -s tests -v
py tools/qa/media_browser_check.py
py tools/qa/browser_check.py
```

The isolated Edge checks generate their own photo/video fixtures and write downloads/screenshots
under ignored `.qa/`; no personal media is used. Test representative files from your own phone
before a dedicated capture visit, especially MOV codecs and less-common metadata layouts.
