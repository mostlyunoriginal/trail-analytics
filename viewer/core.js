export const MI = 1609.34,
  FT = 3.28084;
export const COLORS = ["#79bf82", "#d9cd79", "#e5a268", "#e48479"];
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const bucket = (g) =>
  Math.abs(g) < 0.08 ? 0 : Math.abs(g) < 0.14 ? 1 : Math.abs(g) < 0.2 ? 2 : 3;
export const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
export function safeUrl(value, base = globalThis.location?.href || "https://example.invalid/") {
  try {
    const u = new URL(value, base);
    return ["https:", "http:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
export function sample(profile, d) {
  d = clamp(d, 0, profile.at(-1).d);
  let lo = 0,
    hi = profile.length - 1;
  while (hi - lo > 1) {
    const m = (hi + lo) >> 1;
    if (profile[m].d <= d) lo = m;
    else hi = m;
  }
  const a = profile[lo],
    b = profile[hi],
    t = (d - a.d) / (b.d - a.d || 1);
  return Object.fromEntries(
    ["lon", "lat", "z", "raw_z", "g"].map((k) => [
      k,
      (a[k] ?? a.z) + ((b[k] ?? b.z) - (a[k] ?? a.z)) * t,
    ]),
  );
}
export function validCamera(c) {
  return (
    c &&
    ["lon", "lat", "height", "heading", "pitch", "roll"].every((k) => Number.isFinite(c[k])) &&
    Math.abs(c.lon) <= 180 &&
    Math.abs(c.lat) <= 90 &&
    c.height > 0 &&
    c.height < 50000000
  );
}
export function cleanView(v = {}) {
  const n = (k, f, a, b) => (Number.isFinite(+v[k]) && v[k] != null ? clamp(+v[k], a, b) : f);
  return {
    d: n("d", 0, 0, 1e8),
    mode: ["global", "follow", "fixed", "top"].includes(v.mode) ? v.mode : "global",
    heading: n("heading", 0, -180, 180),
    range: n("range", 500, 60, 10000),
    exagg: n("exagg", 1, 1, 3),
    direction: v.direction === -1 || v.direction === "-1" ? -1 : 1,
    speed: [2, 5, 10, 20, 60].includes(+v.speed) ? +v.speed : 5,
    camera: validCamera(v.camera) ? v.camera : null,
    globalCamera: validCamera(v.globalCamera) ? v.globalCamera : null,
  };
}
export function viewFromURL(search) {
  const p = new URLSearchParams(search);
  if (!p.has("route")) return null;
  let camera = null;
  try {
    camera = JSON.parse(p.get("camera"));
  } catch {}
  return { route: p.get("route"), ...cleanView({ ...Object.fromEntries(p), camera }) };
}
export function viewURL(href, trail, route, view) {
  const u = new URL(href);
  u.search = "";
  u.searchParams.set("trail", trail);
  u.searchParams.set("route", route);
  const v = cleanView(view);
  for (const k of ["d", "mode", "heading", "range", "exagg", "direction", "speed"])
    u.searchParams.set(k, String(v[k]));
  if (v.camera) u.searchParams.set("camera", JSON.stringify(v.camera));
  return u.href;
}
export function readStore(key, fallback = {}) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
export function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function periodsForDate(periods, date) {
  return (periods || []).filter((p) => p.startTime?.slice(0, 10) === date);
}
export function mergeWeather(snapshot, local) {
  return snapshot.map((w) => {
    const newer = local.find(
      (v) =>
        v.label === w.label && Math.abs(v.lat - w.lat) < 0.001 && Math.abs(v.lon - w.lon) < 0.001,
    );
    return newer && Date.parse(newer.fetched_at) > Date.parse(w.fetched_at) ? newer : w;
  });
}
export function freshness(date, hours = 24, now = Date.now()) {
  const t = Date.parse(date);
  if (!Number.isFinite(t)) return "Date unknown";
  const age = (now - t) / 3600000;
  if (age < -0.1) return "Timestamp is in the future";
  return age > hours
    ? `Stale · ${Math.floor(age / 24)}d ${Math.floor(age % 24)}h old`
    : `Updated ${age < 1 ? "less than 1h" : Math.floor(age) + "h"} ago`;
}
export function notesImport(value, trail, ids) {
  if (
    !value ||
    value.schema_version !== 1 ||
    value.trail !== trail ||
    !value.notes ||
    typeof value.notes !== "object" ||
    Array.isArray(value.notes)
  )
    throw new Error("This backup does not match this trail or format.");
  const result = {};
  for (const [id, n] of Object.entries(value.notes)) {
    if (!ids.has(id)) continue;
    if (!n || !["pending", "observed", "captured", "revisit"].includes(n.status))
      throw new Error("Unknown capture status.");
    if (typeof n.notes !== "string" || n.notes.length > 10000)
      throw new Error("Invalid field note.");
    result[id] = {
      status: n.status,
      notes: n.notes,
      updated_at: typeof n.updated_at === "string" ? n.updated_at : null,
    };
  }
  return result;
}
export function gpx(routes, profiles, targets, notes) {
  const w = targets
    .map(
      (t) =>
        `<wpt lat="${t.lat}" lon="${t.lon}"><name>${escape(t.title)}</name><desc>${escape(`P${t.priority}; ${t.access}; ${notes[t.id]?.status || "pending"}; ${t.reason}; ${notes[t.id]?.notes || ""}`)}</desc></wpt>`,
    )
    .join("");
  const tracks = routes
    .map(
      (r) =>
        `<trk><name>${escape(r.name)}</name><desc>${escape("Geometry reference; access/connectivity need verification. " + (r.notes || ""))}</desc><trkseg>${profiles[r.id].map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.z}</ele></trkpt>`).join("")}</trkseg></trk>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Trail Analytics" xmlns="http://www.topografix.com/GPX/1/1">${w}${tracks}</gpx>`;
}
export async function fetchJSON(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${r.status} loading ${new URL(url, location.href).pathname}`);
  return r.json();
}
export function mediaURL(m, base) {
  if (m.type === "youtube" && /^[\w-]{11}$/.test(m.id))
    return `https://www.youtube-nocookie.com/embed/${m.id}${Number.isFinite(m.start_seconds) ? "?start=" + Math.max(0, Math.floor(m.start_seconds)) : ""}`;
  return m.type === "photo" ? safeUrl(m.url, base) : null;
}
