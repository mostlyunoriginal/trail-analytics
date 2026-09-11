import assert from "node:assert/strict";
import test from "node:test";
import { coordinates, validPin, parseISO6709, routeCandidates, inspectMedia, hashBlob, validateRecord, createArchive, readArchive } from "../viewer/media-core.js";
import { exifJPEG, videoFixture } from "./media-fixtures.mjs";

test("coordinates reject blanks, nonfinite numbers, and out-of-range pins but accept zero", () => {
  assert.deepEqual(coordinates("0", "0"), { lat: 0, lon: 0 });
  for (const pair of [["", "1"], ["1", " "], ["NaN", "1"], ["91", "0"], ["1", "181"]]) assert.throws(() => coordinates(...pair));
  assert.equal(validPin({ lat: "40", lon: -105 }), false);
});

test("ISO6709 handles signed coordinates and altitude without inventing a pin", () => {
  assert.deepEqual(parseISO6709("+40.1500-105.4900+2500/"), { lat: 40.15, lon: -105.49 });
  for (const value of ["+99.0-105.0/", "+40.0-190.0/", "40,-105", "+4015-10530/", "+40.0-105.0"]) assert.equal(parseISO6709(value), null);
});

test("JPEG EXIF extracts both byte orders; malformed GPS remains manually placeable", async () => {
  for (const little of [true, false]) {
    const metadata = await inspectMedia(new Blob([exifJPEG({ little })]));
    assert.deepEqual(metadata.gps, { lat: 40, lon: -105 }); assert.equal(metadata.type, "photo");
  }
  for (const options of [{ denominator: 0 }, { latitude: 99 }, { latitudeRef: "X" }]) {
    const metadata = await inspectMedia(new Blob([exifJPEG(options)]));
    assert.equal(metadata.gps, undefined); assert.match(metadata.metadata_status, /Invalid GPS/);
  }
  const metadata = await inspectMedia(new Blob([exifJPEG().slice(0, 32)]));
  assert.match(metadata.metadata_status, /could not be read/);
});

test("QuickTime extracts keyed and legacy GPS while skipping video payload", async () => {
  for (const legacy of [true, false]) {
    const metadata = await inspectMedia(new Blob([videoFixture(undefined, legacy)]));
    assert.deepEqual(metadata.gps, { lat: 40.15, lon: -105.49 });
    if (!legacy) assert.equal(metadata.recorded_at, "2026-09-10T10:00:00-06:00");
  }
  assert.equal((await inspectMedia(new Blob([videoFixture("bad location")]))).gps, undefined);
});

test("PNG and WebP embedded EXIF use the same geographic metadata reader", async () => {
  const tiff = Buffer.from(exifJPEG().slice(12, -2));
  const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = Buffer.alloc(8); chunk.writeUInt32BE(tiff.length); chunk.write("eXIf", 4);
  const png = new Blob([pngHeader, chunk, tiff, Buffer.alloc(4)]);
  const webpHeader = Buffer.alloc(20); webpHeader.write("RIFF"); webpHeader.writeUInt32LE(tiff.length + 12, 4);
  webpHeader.write("WEBPEXIF", 8); webpHeader.writeUInt32LE(tiff.length, 16);
  for (const file of [png, new Blob([webpHeader, tiff])]) assert.deepEqual((await inspectMedia(file)).gps, { lat: 40, lon: -105 });
});

test("unsupported formats are actionable and no-GPS files remain attachable", async () => {
  await assert.rejects(inspectMedia(new Blob(["not an image"])), /Unsupported format/);
  await assert.rejects(inspectMedia(new Blob([])), /nonempty/);
  const metadata = await inspectMedia(new Blob([new Uint8Array([255, 216, 255, 217])]));
  assert.equal(metadata.type, "photo"); assert.match(metadata.metadata_status, /No supported location/);
});

test("route projections retain separate choices at crossings and never mutate pins", () => {
  const pin = { lat: 0, lon: 0 };
  const profiles = { loop: [{ lat: 0, lon: -0.01, d: 0 }, { lat: 0, lon: 0.01, d: 2000 }, { lat: -0.01, lon: 0, d: 3500 }, { lat: 0.01, lon: 0, d: 5500 }],
    side: [{ lat: -0.01, lon: 0, d: 0 }, { lat: 0.01, lon: 0, d: 2000 }] };
  const candidates = routeCandidates(pin, profiles);
  assert.equal(candidates.filter((candidate) => candidate.route === "loop" && candidate.offset < 1).length, 2);
  assert.equal(candidates.filter((candidate) => candidate.route === "side").length, 1);
  assert.deepEqual(pin, { lat: 0, lon: 0 });
  assert.ok(routeCandidates({ lat: 40, lon: -105 }, profiles)[0].offset > 500);
});

async function item() {
  const blob = new Blob([exifJPEG()], { type: "image/jpeg" });
  return { blob, record: { id: crypto.randomUUID(), trail: "test-trail", type: "photo", mime: blob.type,
    hash: await hashBlob(blob), size: blob.size, filename: "original.jpg", title: "Obstacle", caption: "", direction: "", conditions: "",
    recorded_at: "", metadata_status: "GPS", original_gps: { lat: 40, lon: -105 }, pin: { lat: 40.1, lon: -105.1 },
    confirmed: true, association: null, placement_method: "manual", start_seconds: 0, updated_at: "2026-09-10" } };
}

test("backup roundtrip retains original bytes, manually edited pin, and original GPS", async () => {
  const original = await item(), archive = await createArchive([original], "test-trail");
  const restored = await readArchive(archive, "test-trail");
  assert.deepEqual(restored.items[0].record, original.record);
  assert.deepEqual(await restored.items[0].blob.arrayBuffer(), await original.blob.arrayBuffer());
  await assert.rejects(readArchive(archive, "wrong-trail"), /trail does not match/);
});

test("archives reject corrupted/truncated bytes, duplicated IDs, and invalid records", async () => {
  const original = await item(), archive = await createArchive([original], "test-trail");
  const bytes = new Uint8Array(await archive.arrayBuffer()); bytes[bytes.length - 1] ^= 1;
  await assert.rejects(readArchive(new Blob([bytes]), "test-trail"), /Corrupt media/);
  await assert.rejects(readArchive(archive.slice(0, archive.size - 1), "test-trail"), /incomplete archive/);
  const duplicate = await createArchive([original, original], "test-trail");
  await assert.rejects(readArchive(duplicate, "test-trail"), /Duplicate ID/);
  assert.throws(() => validateRecord({ ...original.record, confirmed: true, pin: null }), /needs a location/);
  assert.throws(() => validateRecord({ ...original.record, pin: { lat: 999, lon: 0 } }), /Invalid media/);
  assert.throws(() => validateRecord({ ...original.record, coverage_verified: "true" }), /coverage confirmation/);
  assert.throws(() => validateRecord({ ...original.record, coverage_verified: true }), /Verified coverage needs/);
  assert.throws(() => validateRecord({ ...original.record, mime: "video/mp4" }), /does not match/);
});
