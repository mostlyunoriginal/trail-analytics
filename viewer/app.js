/* Trail Analytics v1 viewer: custom heightfield terrain + live NAIP + trail overlays.
   Data contract: tools/pipeline/build_viewer_assets.py writes
   data/<trail>/derived/viewer/{terrain.json,terrain.bin,centerline.json,mvum.json}. */
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

// ---------------------------------------------------------------- heightfield

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

// ---------------------------------------------------------------- boot

async function boot() {
  const [meta, bin, profile, mvum] = await Promise.all([
    fetch(DATA + "terrain.json").then((r) => r.json()),
    fetch(DATA + "terrain.bin").then((r) => r.arrayBuffer()),
    fetch(DATA + "centerline.json").then((r) => r.json()),
    fetch(DATA + "mvum.json").then((r) => r.json()),
  ]);
  const hf = new Heightfield(meta, new Float32Array(bin));
  const length = profile[profile.length - 1].d;
  document.getElementById("trailName").textContent =
    TRAIL.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) +
    ` — ${(length / MI).toFixed(2)} mi`;

  // -------- terrain provider
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

  // -------- trail line, grouped into constant-grade-bucket runs, clamped to ground
  const trailEntities = [];
  let run = [profile[0]], runBucket = bucket(profile[0].g);
  const flushRun = () => {
    if (run.length < 2) return;
    trailEntities.push(
      viewer.entities.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(run.flatMap((p) => [p.lon, p.lat])),
          clampToGround: true,
          width: 5,
          material: Cesium.Color.fromCssColorString(GRADE_BUCKETS[runBucket].color),
        },
      })
    );
  };
  for (let i = 1; i < profile.length; i++) {
    const b = bucket(profile[i].g);
    run.push(profile[i]);
    if (b !== runBucket) {
      flushRun();
      run = [profile[i]];
      runBucket = b;
    }
  }
  flushRun();

  const mvumEntities = mvum.map((seg) =>
    viewer.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(seg.coords.flat()),
        clampToGround: true,
        width: 10,
        material: Cesium.Color.fromCssColorString("#3d7edb").withAlpha(0.35),
      },
    })
  );

  // -------- camera + scrub
  const ui = Object.fromEntries(
    ["play", "scrub", "mode", "heading", "range", "exagg", "exaggVal", "lyrNaip", "lyrTrail", "lyrMvum", "hudMile", "hudElev", "hudGrade"]
      .map((id) => [id, document.getElementById(id)])
  );

  const at = (d) => {
    const t = Math.min(1, Math.max(0, d / length)) * (profile.length - 1);
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
    Math.atan2(
      (b.lon - a.lon) * Math.cos(Cesium.Math.toRadians(a.lat)),
      b.lat - a.lat
    );

  let d = 0, playing = false, lastT = null;
  const update = () => {
    const ex = viewer.scene.verticalExaggeration;
    const p = at(d), ahead = at(Math.min(length, d + 80));
    const target = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.z * ex + 6);
    const mode = ui.mode.value;
    const heading = mode === "orbit" ? Cesium.Math.toRadians(+ui.heading.value) : bearing(p, ahead);
    const pitch = mode === "top" ? Cesium.Math.toRadians(-88) : Cesium.Math.toRadians(-14);
    viewer.camera.lookAt(target, new Cesium.HeadingPitchRange(heading, pitch, +ui.range.value));
    ui.hudMile.textContent = (d / MI).toFixed(2);
    ui.hudElev.textContent = Math.round(p.z * FT).toLocaleString();
    ui.hudGrade.textContent = (p.g * 100).toFixed(1);
    ui.scrub.value = Math.round((d / length) * 1000);
    drawProfile();
  };

  ui.scrub.addEventListener("input", () => { d = (+ui.scrub.value / 1000) * length; update(); });
  ui.mode.addEventListener("change", () => { ui.heading.disabled = ui.mode.value !== "orbit"; update(); });
  ui.heading.addEventListener("input", update);
  ui.range.addEventListener("input", update);
  ui.exagg.addEventListener("input", () => {
    const ex = +ui.exagg.value / 10;
    viewer.scene.verticalExaggeration = ex;
    ui.exaggVal.textContent = ex.toFixed(1) + "×";
    update();
  });
  ui.lyrNaip.addEventListener("change", () => (naipLayer.show = ui.lyrNaip.checked));
  ui.lyrTrail.addEventListener("change", () => trailEntities.forEach((e) => (e.show = ui.lyrTrail.checked)));
  ui.lyrMvum.addEventListener("change", () => mvumEntities.forEach((e) => (e.show = ui.lyrMvum.checked)));

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

  // -------- profile strip
  const canvas = document.getElementById("profile");
  const ctx = canvas.getContext("2d");
  const zmin = Math.min(...profile.map((p) => p.z)), zmax = Math.max(...profile.map((p) => p.z));
  function drawProfile() {
    const W = (canvas.width = canvas.clientWidth), H = (canvas.height = canvas.clientHeight);
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    ctx.moveTo(0, H);
    profile.forEach((p) => {
      ctx.lineTo((p.d / length) * W, H - 8 - ((p.z - zmin) / (zmax - zmin)) * (H - 22));
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

  update();
}

boot().catch((err) => {
  document.body.insertAdjacentHTML("beforeend", `<pre style="position:absolute;z-index:99;color:#f88;background:#000;padding:12px">${err.stack || err}</pre>`);
});
