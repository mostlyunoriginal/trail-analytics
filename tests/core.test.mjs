import assert from "node:assert/strict";
import test from "node:test";
import {
  sample,
  cleanView,
  viewURL,
  viewFromURL,
  mediaURL,
  notesImport,
  gpx,
  periodsForDate,
  freshness,
  mergeWeather,
} from "../viewer/core.js";

test("chainage interpolation respects a short last interval", () => {
  const p = [
    { d: 0, lon: 0, lat: 0, z: 0, g: 0 },
    { d: 10, lon: 10, lat: 10, z: 10, g: 0.1 },
    { d: 11, lon: 11, lat: 11, z: 11, g: 0.1 },
  ];
  assert.equal(sample(p, 10.5).z, 10.5);
  assert.equal(sample(p, 100).z, 11);
});
test("view links roundtrip including camera and reverse direction", () => {
  const view = {
    ...cleanView(),
    d: 100,
    mode: "global",
    direction: -1,
    camera: { lon: -105, lat: 40, height: 2000, heading: 1, pitch: -0.5, roll: 0 },
  };
  const url = viewURL(
    "https://mostlyunoriginal.github.io/trail-analytics/viewer/",
    "bunce-school-road",
    "main",
    view,
  );
  const restored = viewFromURL(new URL(url).search);
  assert.equal(restored.d, 100);
  assert.equal(restored.direction, -1);
  assert.deepEqual(restored.camera, view.camera);
});
test("invalid saved controls cannot poison the camera", () => {
  const v = cleanView({ mode: "bogus", range: Infinity, exagg: -1, camera: { lon: NaN } });
  assert.equal(v.mode, "global");
  assert.equal(v.range, 500);
  assert.equal(v.exagg, 1);
  assert.equal(v.camera, null);
});
test("photos and timestamped embeds have safe URLs", () => {
  assert.match(mediaURL({ type: "youtube", id: "abcdefghijk", start_seconds: 42 }), /start=42/);
  assert.equal(mediaURL({ type: "youtube", id: "<script>" }), null);
  assert.equal(mediaURL({ type: "photo", url: "javascript:alert(1)" }), null);
});
test("note imports reject wrong trail and preserve supported fields", () => {
  const x = {
    schema_version: 1,
    trail: "a",
    notes: { x: { status: "captured", notes: "line one\nline two" } },
  };
  assert.throws(() => notesImport(x, "b", new Set(["x"])));
  assert.equal(notesImport(x, "a", new Set(["x"])).x.notes, "line one\nline two");
});
test("GPX escapes field notes and names", () => {
  const xml = gpx(
    [],
    {},
    [
      {
        id: "x",
        title: "A & B",
        lat: 1,
        lon: 2,
        priority: 1,
        access: "unverified",
        reason: "<ledge>",
      },
    ],
    { x: { status: "observed", notes: "wet & muddy" } },
  );
  assert.match(xml, /A &amp; B/);
  assert.match(xml, /&lt;ledge&gt;/);
  assert.match(xml, /wet &amp; muddy/);
});
test("forecast date uses local timestamp day and stale status is explicit", () => {
  assert.equal(
    periodsForDate([{ startTime: "2026-09-08T23:00:00-06:00" }], "2026-09-08").length,
    1,
  );
  assert.equal(freshness(null), "Date unknown");
  assert.match(freshness("2020-01-01"), /^Stale/);
});
test("old local weather cannot hide a newer published snapshot", () => {
  const a = { label: "high", lat: 40, lon: -105, fetched_at: "2026-09-08T12:00:00Z" };
  const b = { ...a, fetched_at: "2026-09-07T12:00:00Z" };
  assert.equal(mergeWeather([a], [b])[0], a);
  assert.equal(mergeWeather([b], [a])[0], a);
});
