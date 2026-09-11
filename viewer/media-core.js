export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_BACKUP_BYTES = 500 * 1024 * 1024;
const MAGIC = new TextEncoder().encode("TRAILMEDIA1\n");
const decoder = new TextDecoder();

export function validPin(pin) {
  return !!pin && Number.isFinite(pin.lat) && Number.isFinite(pin.lon) &&
    Math.abs(pin.lat) <= 90 && Math.abs(pin.lon) <= 180;
}

export function coordinates(latitude, longitude) {
  if (String(latitude).trim() === "" || String(longitude).trim() === "")
    throw new Error("Enter both latitude and longitude, or choose a map location.");
  const pin = { lat: Number(latitude), lon: Number(longitude) };
  if (!validPin(pin)) throw new Error("Latitude must be −90 to 90; longitude −180 to 180.");
  return pin;
}

export function parseISO6709(value) {
  const match = /^([+-]\d{2}(?:\.\d+)?)([+-]\d{3}(?:\.\d+)?)(?:[+-]\d+(?:\.\d+)?)?\/$/.exec(value.trim());
  if (!match) return null;
  const pin = { lat: Number(match[1]), lon: Number(match[2]) };
  return validPin(pin) ? pin : null;
}

export function routeCandidates(pin, profiles) {
  if (!validPin(pin)) return [];
  const longitudeScale = 111320 * Math.cos(pin.lat * Math.PI / 180);
  const candidates = [];
  for (const [route, profile] of Object.entries(profiles)) {
    const projections = [];
    for (let segment = 0; segment < profile.length - 1; segment++) {
      const start = profile[segment], end = profile[segment + 1];
      const startX = (start.lon - pin.lon) * longitudeScale;
      const startY = (start.lat - pin.lat) * 111320;
      const deltaX = (end.lon - start.lon) * longitudeScale;
      const deltaY = (end.lat - start.lat) * 111320;
      const lengthSquared = deltaX ** 2 + deltaY ** 2;
      const fraction = lengthSquared ? Math.max(0, Math.min(1, -(startX * deltaX + startY * deltaY) / lengthSquared)) : 0;
      projections.push({ route, segment, d: start.d + fraction * (end.d - start.d),
        lat: start.lat + fraction * (end.lat - start.lat), lon: start.lon + fraction * (end.lon - start.lon),
        offset: Math.hypot(startX + fraction * deltaX, startY + fraction * deltaY) });
    }
    projections.sort((first, second) => first.offset - second.offset);
    const alternatives = [];
    for (const candidate of projections) {
      if (alternatives.length && candidate.offset > projections[0].offset + 30) break;
      if (alternatives.every((other) => Math.abs(other.d - candidate.d) > 100)) alternatives.push(candidate);
      if (alternatives.length === 4) break;
    }
    candidates.push(...alternatives);
  }
  return candidates.sort((first, second) => first.offset - second.offset);
}

export async function hashBlob(blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readExif(buffer) {
  const view = new DataView(buffer);
  const little = view.getUint16(0) === 0x4949;
  if ((!little && view.getUint16(0) !== 0x4d4d) || view.getUint16(2, little) !== 42) return {};
  const integer = (offset) => view.getUint32(offset, little);
  const directory = (offset) => {
    const entries = new Map();
    const count = view.getUint16(offset, little);
    if (count > 1024 || offset + 2 + count * 12 > buffer.byteLength) throw new Error("Invalid EXIF directory");
    for (let index = 0; index < count; index++) {
      const entry = offset + 2 + index * 12;
      const tag = view.getUint16(entry, little), type = view.getUint16(entry + 2, little);
      const count = integer(entry + 4), size = ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 })[type];
      if (!size || count > 10000) continue;
      const position = count * size <= 4 ? entry + 8 : integer(entry + 8);
      if (position + count * size > buffer.byteLength) continue;
      if (type === 2) entries.set(tag, decoder.decode(new Uint8Array(buffer, position, count)).replace(/\0+$/, ""));
      if (type === 4 && count === 1) entries.set(tag, integer(position));
      if (type === 5 && count === 3) entries.set(tag, [0, 1, 2].map((index) => integer(position + index * 8) / integer(position + index * 8 + 4)));
    }
    return entries;
  };
  const root = directory(integer(4)), result = {};
  if (root.has(0x8825)) {
    const gps = directory(root.get(0x8825));
    const degrees = (parts) => Array.isArray(parts) && parts.every(Number.isFinite) &&
      parts[0] >= 0 && parts[1] >= 0 && parts[1] < 60 && parts[2] >= 0 && parts[2] < 60
      ? parts[0] + parts[1] / 60 + parts[2] / 3600 : NaN;
    const pin = { lat: degrees(gps.get(2)) * (gps.get(1) === "S" ? -1 : 1),
      lon: degrees(gps.get(4)) * (gps.get(3) === "W" ? -1 : 1) };
    if (["N", "S"].includes(gps.get(1)) && ["E", "W"].includes(gps.get(3)) && validPin(pin)) result.gps = pin;
    else result.warning = "Invalid GPS metadata — choose a location manually.";
  }
  if (root.has(0x8769)) {
    const date = directory(root.get(0x8769)).get(0x9003);
    if (typeof date === "string" && /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(date))
      result.recorded_at = date.replace(/^(\d{4}):(\d{2}):(\d{2}) /, "$1-$2-$3T");
  }
  return result;
}

function atoms(buffer, start = 0, end = buffer.byteLength) {
  const view = new DataView(buffer), entries = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset), header = 8;
    if (size === 1) { size = Number(view.getBigUint64(offset + 8)); header = 16; }
    if (size === 0) size = end - offset;
    if (size < header || offset + size > end || entries.length > 10000) throw new Error("Invalid video metadata atom");
    entries.push({ type: String.fromCharCode(...new Uint8Array(buffer, offset + 4, 4)),
      index: view.getUint32(offset + 4), start: offset + header, end: offset + size });
    offset += size;
  }
  return entries;
}

export function quickTimeMetadata(buffer) {
  const result = {}, view = new DataView(buffer);
  const string = (start, end) => decoder.decode(new Uint8Array(buffer, start, end - start)).replace(/\0+$/, "");
  const location = (value) => {
    const gps = parseISO6709(value);
    if (gps) result.gps = gps;
    else result.warning = "Unsupported or invalid video GPS — choose a location manually.";
  };
  const visit = (start, end, depth) => {
    if (depth > 6) return;
    for (const atom of atoms(buffer, start, end)) {
      if (["moov", "udta"].includes(atom.type)) visit(atom.start, atom.end, depth + 1);
      if (atom.type === "©xyz" && atom.start + 4 <= atom.end) location(string(atom.start + 4, atom.end));
      if (atom.type !== "meta") continue;
      const offset = ["hdlr", "keys"].includes(string(atom.start + 4, atom.start + 8)) ? 0 : 4;
      const children = atoms(buffer, atom.start + offset, atom.end);
      const keysAtom = children.find((child) => child.type === "keys");
      const list = children.find((child) => child.type === "ilst");
      if (!keysAtom || !list) continue;
      const keys = [];
      let position = keysAtom.start + 8;
      const count = view.getUint32(keysAtom.start + 4);
      if (count > 10000) throw new Error("Too many metadata keys");
      for (let index = 0; index < count; index++) {
        const size = view.getUint32(position);
        if (size < 8 || position + size > keysAtom.end) throw new Error("Invalid metadata key");
        keys.push(string(position + 8, position + size)); position += size;
      }
      for (const item of atoms(buffer, list.start, list.end)) {
        const data = atoms(buffer, item.start, item.end).find((child) => child.type === "data");
        if (!data || data.start + 8 > data.end || view.getUint32(data.start) !== 1) continue;
        const value = string(data.start + 8, data.end), key = keys[item.index - 1];
        if (key === "com.apple.quicktime.location.ISO6709") location(value);
        if (key === "com.apple.quicktime.creationdate" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))) result.recorded_at = value;
      }
    }
  };
  visit(0, buffer.byteLength, 0);
  return result;
}

export async function inspectMedia(file) {
  if (!file.size || file.size > MAX_FILE_BYTES) throw new Error("Use a nonempty file no larger than 100 MiB; trim/compress larger videos first.");
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const signature = String.fromCharCode(...head);
  let type, mime;
  if (head[0] === 0xff && head[1] === 0xd8) { type = "photo"; mime = "image/jpeg"; }
  else if (signature.startsWith("\x89PNG\r\n\x1a\n")) { type = "photo"; mime = "image/png"; }
  else if (signature.startsWith("RIFF") && signature.slice(8, 12) === "WEBP") { type = "photo"; mime = "image/webp"; }
  else if (signature.slice(4, 8) === "ftyp" && !/hei[cfx]|mif1|msf1|avif|avis/.test(signature.slice(8))) {
    type = "video"; mime = signature.slice(8, 12) === "qt  " ? "video/quicktime" : "video/mp4";
  } else if (signature.startsWith("\x1a\x45\xdf\xa3")) { type = "video"; mime = "video/webm"; }
  else throw new Error("Unsupported format. Export photos as JPEG/PNG/WebP, or video as browser-playable MP4/WebM (H.264 MP4 recommended). HEIC needs conversion.");
  let metadata = {};
  try {
    if (mime === "image/jpeg") {
      const buffer = await file.slice(0, 2 * 1024 * 1024).arrayBuffer(), view = new DataView(buffer);
      let offset = 2;
      while (offset + 4 <= buffer.byteLength) {
        if (view.getUint8(offset) !== 0xff) break;
        const marker = view.getUint8(offset + 1), length = view.getUint16(offset + 2);
        if (marker === 0xda || marker === 0xd9) break;
        if (length < 2 || offset + 2 + length > buffer.byteLength) throw new Error("Truncated metadata");
        if (marker === 0xe1 && decoder.decode(new Uint8Array(buffer, offset + 4, 6)) === "Exif\0\0") {
          metadata = readExif(buffer.slice(offset + 10, offset + 2 + length)); break;
        }
        offset += length + 2;
      }
    }
    if (mime === "image/png" || mime === "image/webp") {
      const little = mime === "image/webp";
      let offset = little ? 12 : 8, count = 0;
      while (offset + 8 <= file.size && count++ < 10000) {
        const header = await file.slice(offset, offset + 8).arrayBuffer(), view = new DataView(header);
        const size = view.getUint32(little ? 4 : 0, little);
        const tag = decoder.decode(new Uint8Array(header, little ? 0 : 4, 4));
        if (offset + 8 + size > file.size) throw new Error("Truncated image chunk");
        if (tag === "eXIf" || tag === "EXIF") {
          if (size > 1024 * 1024) throw new Error("EXIF chunk exceeds limit");
          let buffer = await file.slice(offset + 8, offset + 8 + size).arrayBuffer();
          if (decoder.decode(new Uint8Array(buffer, 0, Math.min(6, size))) === "Exif\0\0") buffer = buffer.slice(6);
          metadata = readExif(buffer); break;
        }
        offset += 8 + size + (little ? size % 2 : 4);
      }
    }
    if (mime === "video/mp4" || mime === "video/quicktime") {
      let offset = 0, count = 0;
      while (offset + 8 <= file.size && count++ < 10000) {
        const buffer = await file.slice(offset, offset + 16).arrayBuffer(), view = new DataView(buffer);
        let size = view.getUint32(0), header = 8;
        if (size === 1) { size = Number(view.getBigUint64(8)); header = 16; }
        if (!size) size = file.size - offset;
        if (size < header || offset + size > file.size) throw new Error("Invalid video header");
        if (decoder.decode(new Uint8Array(buffer, 4, 4)) === "moov") {
          if (size > 16 * 1024 * 1024) throw new Error("Metadata block exceeds limit");
          metadata = quickTimeMetadata(await file.slice(offset, offset + size).arrayBuffer()); break;
        }
        offset += size;
      }
    }
  } catch {
    metadata.warning = "Metadata could not be read — manual placement is still available.";
  }
  return { type, mime, ...metadata, metadata_status: metadata.warning || (metadata.gps ? "GPS suggestion — confirm or move the pin." : "No supported location found — choose on map.") };
}

export function validateRecord(record) {
  if (!record || !/^[a-f0-9-]{36}$/.test(record.id) || !/^[a-z0-9-]+$/.test(record.trail) ||
      !["photo", "video"].includes(record.type) ||
      !["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "video/webm"].includes(record.mime) ||
      !/^[a-f0-9]{64}$/.test(record.hash) || !Number.isSafeInteger(record.size) || record.size <= 0 || record.size > MAX_FILE_BYTES ||
      (record.pin !== null && !validPin(record.pin)) || (record.original_gps !== null && !validPin(record.original_gps)))
    throw new Error("Invalid media record or location.");
  for (const field of ["filename", "title", "caption", "direction", "conditions", "recorded_at", "metadata_status", "placement_method", "updated_at"])
    if (typeof record[field] !== "string" || record[field].length > 10000) throw new Error("Invalid media description.");
  if (!Number.isFinite(record.start_seconds) || record.start_seconds < 0) throw new Error("Invalid video timestamp.");
  if ((record.type === "photo") !== record.mime.startsWith("image/")) throw new Error("Media type does not match its format.");
  if (record.coverage_verified !== undefined && typeof record.coverage_verified !== "boolean") throw new Error("Invalid coverage confirmation.");
  if (record.coverage_verified && (!record.confirmed || typeof record.target_id !== "string" || !record.target_id ||
      !record.recorded_at || typeof record.verified_at !== "string" || !Number.isFinite(Date.parse(record.verified_at))))
    throw new Error("Verified coverage needs a placed item, target, recording date, and review date.");
  if (record.association !== null && (!record.association || typeof record.association.route !== "string" ||
      !Number.isFinite(record.association.d) || record.association.d < 0 ||
      !Number.isSafeInteger(record.association.segment) || record.association.segment < 0 ||
      typeof record.association.geometry_version !== "string")) throw new Error("Invalid route association.");
  if (typeof record.confirmed !== "boolean" || (record.confirmed && !record.pin)) throw new Error("A confirmed item needs a location.");
  return record;
}

export async function createArchive(items, trail, purpose = "backup") {
  if (!items.length) throw new Error("Select at least one media item.");
  const records = items.map(({ record, blob }) => {
    validateRecord(record);
    if (record.trail !== trail || blob.size !== record.size) throw new Error("Media bytes do not match the record.");
    return record;
  });
  const manifest = new TextEncoder().encode(JSON.stringify({ schema_version: 1, trail, purpose, records }));
  if (manifest.length > 4 * 1024 * 1024) throw new Error("Too many records for one backup.");
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, manifest.length);
  const archive = new Blob([MAGIC, length, manifest, ...items.map((item) => item.blob)], { type: "application/octet-stream" });
  if (archive.size > MAX_BACKUP_BYTES) throw new Error("Select fewer items: each backup is limited to 500 MiB.");
  return archive;
}

export async function readArchive(file, trail) {
  if (file.size > MAX_BACKUP_BYTES) throw new Error("Backup exceeds 500 MiB; use smaller batches.");
  const header = new Uint8Array(await file.slice(0, MAGIC.length + 4).arrayBuffer());
  if (header.length !== MAGIC.length + 4 || !MAGIC.every((byte, index) => header[index] === byte)) throw new Error("Not a Trail Analytics media archive.");
  const length = new DataView(header.buffer).getUint32(MAGIC.length);
  let offset = header.length + length;
  if (length > 4 * 1024 * 1024 || offset > file.size) throw new Error("Invalid archive header.");
  const manifest = JSON.parse(await file.slice(header.length, offset).text());
  if (manifest.schema_version !== 1 || manifest.trail !== trail || !["backup", "publication"].includes(manifest.purpose) ||
      !Array.isArray(manifest.records) || manifest.records.length > 10000) throw new Error("Archive format or trail does not match.");
  const items = [], ids = new Set();
  for (const record of manifest.records) {
    validateRecord(record);
    if (record.trail !== trail || ids.has(record.id) || offset + record.size > file.size) throw new Error("Duplicate ID or incomplete archive.");
    ids.add(record.id);
    const blob = file.slice(offset, offset + record.size, record.mime);
    if (await hashBlob(blob) !== record.hash) throw new Error(`Corrupt media: ${record.filename}`);
    items.push({ record, blob }); offset += record.size;
  }
  if (offset !== file.size) throw new Error("Unexpected archive data.");
  return { ...manifest, items };
}
