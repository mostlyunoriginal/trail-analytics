export function exifJPEG({ little = true, latitude = 40, longitude = 105, latitudeRef = "N", longitudeRef = "W", denominator = 1 } = {}) {
  const tiff = new Uint8Array(128), view = new DataView(tiff.buffer);
  view.setUint16(0, little ? 0x4949 : 0x4d4d); view.setUint16(2, 42, little); view.setUint32(4, 8, little);
  view.setUint16(8, 1, little); view.setUint16(10, 0x8825, little); view.setUint16(12, 4, little);
  view.setUint32(14, 1, little); view.setUint32(18, 26, little);
  view.setUint16(26, 4, little);
  for (let index = 0; index < 4; index++) {
    const offset = 28 + index * 12;
    view.setUint16(offset, index + 1, little); view.setUint16(offset + 2, index % 2 === 0 ? 2 : 5, little);
    view.setUint32(offset + 4, index % 2 === 0 ? 2 : 3, little);
    if (index % 2 === 0) tiff[offset + 8] = (index === 0 ? latitudeRef : longitudeRef).charCodeAt(0);
    else view.setUint32(offset + 8, index === 1 ? 80 : 104, little);
  }
  for (const [start, degrees] of [[80, latitude], [104, longitude]]) {
    for (let part = 0; part < 3; part++) {
      view.setUint32(start + part * 8, part === 0 ? degrees : 0, little);
      view.setUint32(start + part * 8 + 4, denominator, little);
    }
  }
  const result = new Uint8Array(tiff.length + 14);
  result.set([255, 216, 255, 225]); new DataView(result.buffer).setUint16(4, tiff.length + 8);
  result.set(new TextEncoder().encode("Exif\0\0"), 6); result.set(tiff, 12); result.set([255, 217], result.length - 2);
  return result;
}

export function atom(type, ...payloads) {
  const payload = Buffer.concat(payloads.map((payload) => Buffer.from(payload)));
  const head = Buffer.alloc(8); head.writeUInt32BE(payload.length + 8);
  if (typeof type === "number") head.writeUInt32BE(type, 4); else head.write(type, 4, "latin1");
  return Buffer.concat([head, payload]);
}

export function videoFixture(location = "+40.1500-105.4900+2500/", legacy = false) {
  const format = atom("ftyp", Buffer.from("qt  \0\0\0\0qt  ", "latin1"));
  if (legacy) {
    const head = Buffer.alloc(4); head.writeUInt16BE(location.length);
    return Buffer.concat([format, atom("moov", atom("udta", atom("©xyz", head, Buffer.from(location))))]);
  }
  const keysHead = Buffer.alloc(8); keysHead.writeUInt32BE(2, 4);
  const keys = atom("keys", keysHead, atom("mdta", Buffer.from("com.apple.quicktime.location.ISO6709")), atom("mdta", Buffer.from("com.apple.quicktime.creationdate")));
  const dataHead = Buffer.alloc(8); dataHead.writeUInt32BE(1);
  const list = atom("ilst", atom(1, atom("data", dataHead, Buffer.from(location))), atom(2, atom("data", dataHead, Buffer.from("2026-09-10T10:00:00-06:00"))));
  return Buffer.concat([format, atom("mdat", Buffer.alloc(100)), atom("moov", atom("meta", Buffer.alloc(4), keys, list))]);
}
