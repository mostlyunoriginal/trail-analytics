/* Trail Analytics viewer: custom heightfield terrain + live NAIP + multi-route trail bundle.
   Data contract: tools/pipeline/build_viewer_assets.py writes
   data/<trail>/derived/viewer/{terrain.json,terrain.bin,routes.json,route-<id>.json,
   analysis.json,mvum.json,waypoints.json}. */
"use strict";

window.CESIUM_BASE_URL = "https://cdn.jsdelivr.net/npm/cesium@1.130.0/Build/Cesium/";

const TRAIL = new URLSearchParams(location.search).get("trail") || "bunce-school-road";
const DATA = `../data/${TRAIL}/derived/viewer/`;
const FT = 3.28084, MI = 1609.34;

const GRADE_BUCKETS = [
  { max: 0.08, color: "#27b356" },
  { max: 0.14, color: "#e0b62c" },
  { max: 0.20, color: "#e07a2c" },
  { max: Infinity, color: "#d63b3b" },
];
const bucket = (g) => GRADE_BUCKETS.findIndex((b) => Math.abs(g) < b.max);
const KIND_COLOR = { obstacle: "#d63b3b", junction: "#3d7edb", poi: "#27b356" };

class Heightfield {
  constructor(meta, data) {
    this.m = meta;
    this.z = data;
  }
  sample(lon, lat) {
    const { west, south, east, north, cols, rows } = this.m;
    const fx = Math.min(cols - 1.001, Math.max(0, ((lon - west) / (east - west)) * (cols - 1)));
    const fy = Math.min(rows - 1.001, Math.max(0, ((north - lat) / (north - south)) * (rows - 1)));
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const dx = fx - x0, dy = fy - y0;
    const i = y0 * cols + x0;
    return (
      this.z[i] * (1 - dx) * (1 - dy) +
      this.z[i + 1] * dx * (1 - dy) +
      this.z[i + cols] * (1 - dx) * dy +
      this.z[i + cols + 1] * dx * dy
    );
  }
}

async function boot() {
  const [meta, bin, routeList, analysis, mvum, waypoints] = await Promise.all([
    fetch(DATA + "terrain.json").then((r) => r.json()),
    fetch(DATA + "terrain.bin").then((r) => r.arrayBuffer()),
    fetch(DATA + "routes.json").then((r) => r.json()),
    fetch(DATA + "analysis.json").then((r) => r.json()),
    fetch(DATA + "mvum.json").then((r) => r.json()),
    fetch(DATA + "waypoints.json").then((r) => (r.ok ? r.json() : [])),
  ]);
  const profiles = Object.fromEntries(
    await Promise.all(
      routeList.map(async (r) => [r.id, await fetch(DATA + r.file).then((x) => x.json())])
    )
  );
  const hf = new Heightfield(meta, new Float32Array(bin));

  // -------- Cesium scene
  const terrainProvider = new Cesium.CustomHeightmapTerrainProvider({
    width: 33,
    height: 33,
    callback: (x, y, level) => {
      const rect = terrainProvider.tilingScheme.tileXYToRectangle(x, y, level);
      const w = Cesium.Math.toDegrees(rect.west), e = Cesium.Math.toDegrees(rect.east);
      const n = Cesium.Math.toDegrees(rect.north), s = Cesium.Math.toDegrees(rect.south);
      const out = new Float32Array(33 * 33);
      for (let r = 0; r < 33; r++) {
        const lat = n + (s - n) * (r / 32);
        for (let c = 0; c < 33; c++) {
          out[r * 33 + c] = hf.sample(w + (e - w) * (c / 32), lat);
        }
      }
      return out;
    },
  });

  const viewer = new Cesium.Viewer("cesium", {
    terrainProvider,
    baseLayer: new Cesium.ImageryLayer(
      new Cesium.OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" })
    ),
    baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
    animation: false, timeline: false, navigationHelpButton: false, fullscreenButton: false,
    infoBox: false, selectionIndicator: false,
  });
  viewer.scene.globe.depthTestAgainstTerrain = true;

  const naipLayer = viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url:
        "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage" +
        "?f=image&format=jpgpng&size=256,256&bboxSR=3857&imageSR=3857" +
        "&bbox={westProjected},{southProjected},{eastProjected},{northProjected}",
      rectangle: Cesium.Rectangle.fromDegrees(meta.west, meta.south, meta.east, meta.north),
      maximumLevel: 19,
      credit: "USDA NAIP via USGS",
    })
  );

  // -------- per-route entities: grade-colored line (active) + dim line (inactive)
  const routeEnts = {};
  for (const r of routeList) {
    const prof = profiles[r.id];
    const colored = [];
    let run = [prof[0]], runBucket = bucket(prof[0].g);
    const flush = () => {
      if (run.length < 2) return;
      colored.push(
        viewer.entities.add({
          show: false,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(run.flatMap((p) => [p.lon, p.lat])),
            clampToGround: true, width: 5,
            material: Cesium.Color.fromCssColorString(GRADE_BUCKETS[runBucket].color),
          },
        })
      );
    };
    for (let i = 1; i < prof.length; i++) {
      const b = bucket(prof[i].g);
      run.push(prof[i]);
      if (b !== runBucket) { flush(); run = [prof[i]]; runBucket = b; }
    }
    flush();
    const dim = viewer.entities.add({
      show: false,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(prof.flatMap((p) => [p.lon, p.lat])),
        clampToGround: true, width: 3,
        material: Cesium.Color.fromCssColorString("#b8c4d4").withAlpha(0.7),
      },
    });
    const callouts = (analysis[r.id]?.steep || []).slice(0, 3).map((zone) => {
      const mid = (zone.d0 + zone.d1) / 2;
      const p = prof.reduce((a, b) => (Math.abs(b.d - mid) < Math.abs(a.d - mid) ? b : a));
      return viewer.entities.add({
        show: false,
        position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
        label: {
          text: `▲ ${(zone.mean * 100).toFixed(0)}% for ${(zone.d1 - zone.d0).toFixed(0)} m`,
          font: "13px system-ui",
          fillColor: Cesium.Color.fromCssColorString("#ffb1b1"),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("#3a1010").withAlpha(0.85),
          pixelOffset: new Cesium.Cartesian2(0, -42),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 6000),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    });
    routeEnts[r.id] = { colored, dim, callouts };
  }

  const mvumEntities = mvum.map((seg) =>
    viewer.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(seg.coords.flat()),
        clampToGround: true, width: 10,
        material: Cesium.Color.fromCssColorString("#3d7edb").withAlpha(0.3),
      },
    })
  );

  const markEntities = waypoints.map((w) =>
    viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(w.lon, w.lat),
      properties: { wpD: w.d, wpRoute: w.route },
      point: {
        pixelSize: 9,
        color: Cesium.Color.fromCssColorString(KIND_COLOR[w.kind] || "#ccc"),
        outlineColor: Cesium.Color.BLACK, outlineWidth: 1,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: w.title,
        font: "12px system-ui",
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("#0c1016").withAlpha(0.75),
        pixelOffset: new Cesium.Cartesian2(0, -18),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2500),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
  );

  // -------- UI state
  const ui = Object.fromEntries(
    ["play", "scrub", "route", "mode", "heading", "range", "exagg", "exaggVal", "reset",
     "lyrNaip", "lyrTrail", "lyrMvum", "lyrMarks", "lyrMedia", "hudMile", "hudElev", "hudGrade",
     "trailName", "wpTitle", "wpNotes", "wpMedia", "wpClose"]
      .map((id) => [id, document.getElementById(id)])
  );
  const mediaPanel = document.getElementById("mediaPanel");
  ui.route.innerHTML = routeList
    .map((r) => `<option value="${r.id}">${r.name} (${(r.length_m / MI).toFixed(1)} mi)</option>`)
    .join("");

  let activeId = null, profile = null, length = 0, zmin = 0, zmax = 1;
  let d = 0, playing = false, lastT = null, shownWp = null;

  const setRoute = (id, keepD = false) => {
    if (activeId === id) return;
    for (const [rid, ents] of Object.entries(routeEnts)) {
      const active = rid === id;
      ents.colored.forEach((e) => (e.show = active && ui.lyrTrail.checked));
      ents.dim.show = !active && ui.lyrTrail.checked;
      ents.callouts.forEach((e) => (e.show = active && ui.lyrMarks.checked));
    }
    activeId = id;
    profile = profiles[id];
    length = profile[profile.length - 1].d;
    zmin = Math.min(...profile.map((p) => p.z));
    zmax = Math.max(...profile.map((p) => p.z));
    const r = routeList.find((x) => x.id === id);
    ui.trailName.textContent = `${r.name} — ${(length / MI).toFixed(2)} mi`;
    ui.route.value = id;
    if (!keepD) d = 0;
    d = Math.min(d, length);
    update();
  };

  const at = (dd) => {
    const t = Math.min(1, Math.max(0, dd / length)) * (profile.length - 1);
    const i = Math.min(profile.length - 2, Math.floor(t));
    const f = t - i;
    const a = profile[i], b = profile[i + 1];
    return {
      lon: a.lon + (b.lon - a.lon) * f,
      lat: a.lat + (b.lat - a.lat) * f,
      z: a.z + (b.z - a.z) * f,
      g: a.g + (b.g - a.g) * f,
    };
  };
  const bearing = (a, b) =>
    Math.atan2((b.lon - a.lon) * Math.cos(Cesium.Math.toRadians(a.lat)), b.lat - a.lat);

  const surfaceMedia = () => {
    if (!ui.lyrMedia.checked) { shownWp = null; mediaPanel.hidden = true; return; }
    let best = null;
    for (const w of waypoints) {
      if (w.route !== activeId) continue;
      const dist = Math.abs(w.d - d);
      if (dist < 250 && (!best || dist < Math.abs(best.d - d))) best = w;
    }
    if (best === shownWp) return;
    shownWp = best;
    if (!best) { mediaPanel.hidden = true; return; }
    ui.wpTitle.textContent = `${best.title} — mile ${(best.d / MI).toFixed(2)}`;
    ui.wpNotes.textContent = best.notes || "";
    ui.wpMedia.innerHTML = (best.media || [])
      .map(
        (m) =>
          m.type === "youtube"
            ? `<p class="mtitle">${m.title || ""}</p>` +
              `<iframe src="https://www.youtube-nocookie.com/embed/${m.id}" ` +
              `title="${m.title || "video"}" allowfullscreen loading="lazy"></iframe>`
            : ""
      )
      .join("");
    mediaPanel.hidden = false;
  };

  const update = () => {
    const ex = viewer.scene.verticalExaggeration;
    const p = at(d), ahead = at(Math.min(length, d + 80));
    const target = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.z * ex + 6);
    const mode = ui.mode.value;
    // Heading slider: look offset from direction of travel in follow/top;
    // absolute compass heading (0 = north) in fixed mode — steadier on switchbacks.
    const base = mode === "fixed" ? 0 : bearing(p, ahead);
    const heading = base + Cesium.Math.toRadians(+ui.heading.value);
    const pitch = mode === "top" ? Cesium.Math.toRadians(-88) : Cesium.Math.toRadians(-14);
    viewer.camera.lookAt(target, new Cesium.HeadingPitchRange(heading, pitch, +ui.range.value));
    ui.hudMile.textContent = (d / MI).toFixed(2);
    ui.hudElev.textContent = Math.round(p.z * FT).toLocaleString();
    ui.hudGrade.textContent = (p.g * 100).toFixed(1);
    ui.scrub.value = Math.round((d / length) * 1000);
    surfaceMedia();
    drawProfile();
  };

  // -------- controls
  ui.route.addEventListener("change", () => setRoute(ui.route.value));
  ui.scrub.addEventListener("input", () => { d = (+ui.scrub.value / 1000) * length; update(); });
  ui.mode.addEventListener("change", update);
  ui.heading.addEventListener("input", update);
  ui.range.addEventListener("input", update);
  ui.exagg.addEventListener("input", () => {
    const ex = +ui.exagg.value / 10;
    viewer.scene.verticalExaggeration = ex;
    ui.exaggVal.textContent = ex.toFixed(1) + "×";
    update();
  });
  ui.lyrNaip.addEventListener("change", () => (naipLayer.show = ui.lyrNaip.checked));
  ui.lyrTrail.addEventListener("change", () => {
    for (const [rid, ents] of Object.entries(routeEnts)) {
      ents.colored.forEach((e) => (e.show = rid === activeId && ui.lyrTrail.checked));
      ents.dim.show = rid !== activeId && ui.lyrTrail.checked;
    }
  });
  ui.lyrMvum.addEventListener("change", () => mvumEntities.forEach((e) => (e.show = ui.lyrMvum.checked)));
  ui.lyrMedia.addEventListener("change", surfaceMedia);
  ui.wpClose.addEventListener("click", () => { ui.lyrMedia.checked = false; surfaceMedia(); });
  ui.lyrMarks.addEventListener("change", () => {
    markEntities.forEach((e) => (e.show = ui.lyrMarks.checked));
    for (const [rid, ents] of Object.entries(routeEnts)) {
      ents.callouts.forEach((e) => (e.show = rid === activeId && ui.lyrMarks.checked));
    }
  });
  ui.reset.addEventListener("click", () => {
    ui.mode.value = "follow";
    ui.heading.value = 0;
    ui.range.value = 220;
    ui.exagg.value = 10;
    viewer.scene.verticalExaggeration = 1;
    ui.exaggVal.textContent = "1.0×";
    update();
  });
  ui.play.addEventListener("click", () => {
    playing = !playing;
    ui.play.textContent = playing ? "⏸" : "▶";
    lastT = null;
    if (playing) requestAnimationFrame(step);
  });
  const step = (t) => {
    if (!playing) return;
    if (lastT !== null) {
      d += ((t - lastT) / 1000) * 9; // ~20 mph
      if (d >= length) { d = length; playing = false; ui.play.textContent = "▶"; }
    }
    lastT = t;
    update();
    if (playing) requestAnimationFrame(step);
  };

  // click a waypoint marker: switch to its route if needed, jump the scrub there
  viewer.screenSpaceEventHandler.setInputAction((click) => {
    const picked = viewer.scene.pick(click.position);
    const props = picked?.id?.properties;
    const wpD = props?.wpD?.getValue?.();
    if (wpD === undefined) return;
    const wpRoute = props?.wpRoute?.getValue?.();
    if (wpRoute && wpRoute !== activeId) setRoute(wpRoute, true);
    d = wpD;
    update();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // -------- profile strip
  const canvas = document.getElementById("profile");
  const ctx = canvas.getContext("2d");
  function drawProfile() {
    const W = (canvas.width = canvas.clientWidth), H = (canvas.height = canvas.clientHeight);
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    ctx.moveTo(0, H);
    profile.forEach((p) => {
      ctx.lineTo((p.d / length) * W, H - 8 - ((p.z - zmin) / (zmax - zmin || 1)) * (H - 22));
    });
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = "#1d2836";
    ctx.fill();
    ctx.strokeStyle = "#4a90d9";
    ctx.stroke();
    for (let i = 0; i < profile.length - 1; i++) {
      ctx.fillStyle = GRADE_BUCKETS[bucket(profile[i].g)].color;
      ctx.fillRect((profile[i].d / length) * W, H - 6, Math.ceil(W / profile.length) + 1, 4);
    }
    for (const zone of analysis[activeId]?.steep || []) {
      ctx.fillStyle = "rgba(214, 59, 59, 0.16)";
      ctx.fillRect((zone.d0 / length) * W, 0, ((zone.d1 - zone.d0) / length) * W, H);
    }
    for (const w of waypoints) {
      if (w.route !== activeId) continue;
      ctx.fillStyle = KIND_COLOR[w.kind] || "#ccc";
      const wx = (w.d / length) * W;
      ctx.beginPath();
      ctx.moveTo(wx, 2); ctx.lineTo(wx + 4, 8); ctx.lineTo(wx, 14); ctx.lineTo(wx - 4, 8);
      ctx.closePath(); ctx.fill();
    }
    const x = (d / length) * W;
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  const scrubFromEvent = (ev) => {
    const r = canvas.getBoundingClientRect();
    d = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)) * length;
    update();
  };
  canvas.addEventListener("pointerdown", (ev) => {
    scrubFromEvent(ev);
    const move = (e) => scrubFromEvent(e);
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });

  setRoute(routeList[0].id);
}

boot().catch((err) => {
  document.body.insertAdjacentHTML("beforeend", `<pre style="position:absolute;z-index:99;color:#f88;background:#000;padding:12px">${err.stack || err}</pre>`);
});
