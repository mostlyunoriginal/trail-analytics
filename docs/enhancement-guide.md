# Planning enhancements on astra-enhance

The viewer opens in a bundle overview. Select a route in the planner or click its
line. The route card includes ascent/descent, endpoints, caveats, OSM tags, and
cached USFS vehicle permissions and seasonal dates. Access is never inferred from
physical continuity or a missing agency feature. Amber dashed segments are
unverified; pink dashed segments have conflicting evidence. Grade colors remain
independent of access status.

## Explore

- Follow route, fixed heading, top down, and free exploration each have explicit
  controls. Free exploration keeps camera movement independent of scrubbing.
- Each route remembers its position and camera. Saved views stay in browser
  storage; **Copy view link** captures the route, distance, direction, controls,
  and camera in a URL suitable for a project subdirectory.
- Reverse direction changes playback, next/previous navigation, camera bearing,
  and the displayed signed grade. Mileage always measures from the route start.
- The profile has elevation/distance axes, pointer details, a raw-elevation toggle,
  and keyboard navigation (arrows 10 m, Shift+arrows 100 m, Home/End).
- Space plays/pauses; N/P move between points. Keyboard shortcuts do not intercept
  typing in inputs. Playback speed is an exploration setting, not a driving-time
  estimate.
- The planner collapses and the layout adapts to narrow windows. On phones the
  map, scrollable planner, and controls stack vertically.

## Evidence and confidence

The Evidence tab follows nearby waypoints. Pinning a card keeps it in place while
scrubbing. YouTube supports timestamps; photos support source URLs, alt text,
recording dates, and direction. Unverified media is labeled as context.

Curated source format in `data/<trail>/waypoints.json`:

```json
{
  "id": "example-obstacle",
  "route": "main",
  "kind": "obstacle",
  "lat": 40.15,
  "lon": -105.49,
  "title": "Example obstacle",
  "confidence": "field observed",
  "observed_at": "2026-09-08",
  "notes": "Observed driving north in dry conditions.",
  "source_urls": ["https://example.org/observation"],
  "media": [{
    "type": "youtube",
    "id": "abcdefghijk",
    "title": "Example capture",
    "start_seconds": 42,
    "recorded_at": "2026-09-08",
    "direction": "northbound",
    "coverage_verified": true,
    "target_ids": ["example-obstacle"]
  }]
}
```

For a photograph use `type: "photo"`, `url: "https://…"`, and `alt` in place of
the video ID and timestamp. Only publish photos you have permission to publish.
The current bundle has no field-verified photos or video timestamps: unknown dates
and locations remain explicit. The two added Ironclads points are DEM candidates
with historical report context, not newly discovered field observations.

Grade variability measures changes in smoothed longitudinal slope. It is not
surface roughness, cross-slope, or ledge height. Raw elevation is retained next to
the smoothed profile. The terrain boundary separates downloaded heights from an
unmodeled, zero-height exterior; views crossing that boundary can have an abrupt
edge. The live aerial mosaic has an unverified acquisition date.

## Conditions

`refresh_sources.py` fetches forecasts and alerts at the bundle's lowest/highest
route points and the primary endpoints. It also retrieves the nearest three
SNOTEL stations in the configured state, their elevations, distances, and recent
snow-depth/SWE observations. These are regional context, not road-condition
measurements. The date picker filters the available forecast; dates outside the
forecast window explicitly show no forecast.

Every location retains its own timestamp. Failures retain older data and its
timestamp; a failed alerts request displays unknown status, not an empty alert
list. In-browser **Refresh weather** fetches NWS directly and keeps a local cache.
Older local weather cannot override a newer packaged snapshot. Snow and agency
document discovery refresh through the acquisition script before rebuilding.

Agency pages are scanned for relevant document links. Their retrieval does not
establish applicability or current access. Reviewed notices can be curated in
`raw/agency-notices.json` using `title`, `summary`, `source_url`, `checked_at`,
`effective_from`, `effective_to`, and `applicability`. The current snapshot includes
a dated district-level fire-restriction notice. The Ironclads Lateral access
conflict and unmapped connection remain unresolved.

## Field plan

The list ranks curated obstacle candidates before sustained-grade candidates and
grade-variation candidates. Access conflicts carry an explicit instruction to
resolve access before visiting. Capture times are rough planning allowances and
exclude travel. Filter by route, whole bundle, or pending work.

Status and notes persist locally. **Back up notes** and **Import notes** move them
between browsers; newer local entries win on merge. **Export GPX** includes the
filtered targets, notes, and associated reference tracks. A track's presence in
the export does not establish a permitted or connected driving route. Downloaded
GPX and notes are usable in field tools without the live web viewer.

## Build contract

`enhance.py` reuses the cached DEM acquisition and profile functions, but owns
publication. It defaults to offline, rejects missing/non-finite DEM values rather
than filling them with artificial low elevations, validates chainage and waypoint
offsets, and retains full MVUM attributes. `--validate-live` checks every route
before publication and blocks on a discrepancy above 8 m.

Outputs live in immutable `derived/viewer/releases/<build-id>/` directories.
`current.json` is replaced atomically only after the release is complete. The
release includes all input SHA-256 hashes, code/dependency versions, output
inventory, profiles, conditions, provenance, and field-plan exports. Builds with
the same bytes, code, and dependency versions have the same ID. Incomplete staging
directories are never served or packaged.

Startup downloads a 257×257 overview (~258 KiB). Overlapping 257×257 detail tiles
are requested at close map levels, with four concurrent downloads and a 64-tile
memory cache. Tile failures fall back to the overview with a visible notice.

The USGS catalog identifies candidate native DEM products and their metadata;
these are not falsely attributed to the cached ImageServer mosaic. Exact native
acquisition provenance for that older export is still unknown. Input hashes pin
the actual bytes used. A fresh fetch is a new input snapshot and can produce a
different release.
