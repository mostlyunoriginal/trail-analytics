import {
  MI,
  FT,
  COLORS,
  clamp,
  bucket,
  escape as esc,
  safeUrl,
  sample,
  cleanView,
  viewFromURL,
  viewURL,
  readStore,
  writeStore,
  periodsForDate,
  freshness,
  notesImport,
  gpx,
  fetchJSON,
  mediaURL,
  mergeWeather,
} from "./core.js";
import { createTerrain } from "./terrain.js";

const $ = (id) => document.getElementById(id);
const TRAIL = new URLSearchParams(location.search).get("trail") || "bunce-school-road";
const ROOT = `../data/${/^[a-z0-9-]+$/.test(TRAIL) ? TRAIL : "invalid"}/derived/viewer/`;
const KEY = `trail-analytics:v2:${TRAIL}`;
const accessLabels = {
  designated: "Cached USFS designation",
  unverified: "Access partly unverified",
  conflict: "Access conflict · verify first",
};
const link = (url, label) => {
  const u = safeUrl(url);
  return u
    ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`
    : esc(label);
};
const badge = (value, label) =>
  `<span class="badge ${esc(value)}">${esc(label || accessLabels[value] || value)}</span>`;
let toastTimer;
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 5000);
}
function download(name, text, type) {
  const u = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
function loadError(error) {
  $("loading").hidden = false;
  $("loadMessage").textContent =
    `${error.message}. Build the trail assets with “py tools/pipeline/enhance.py”, serve the project over HTTP, then retry.`;
  $("loadProgress").hidden = true;
  $("retry").hidden = false;
  console.error(error);
}
$("retry").onclick = () => location.reload();

async function boot() {
  if (!globalThis.Cesium) throw new Error("The map library could not load from its CDN");
  const C = globalThis.Cesium;
  const pointer = await fetchJSON(ROOT + "current.json");
  if (pointer.schema_version !== 2 || !/^releases\/[a-f0-9]+\/$/.test(pointer.path))
    throw new Error("Unsupported or invalid trail build");
  const DATA = ROOT + pointer.path;
  const names = [
    "terrain",
    "routes",
    "analysis",
    "mvum",
    "waypoints",
    "sources",
    "targets",
    "conditions",
    "bundle",
  ];
  const values = await Promise.all(names.map((n) => fetchJSON(DATA + n + ".json")));
  const [meta, routes, analysis, mvum, waypoints, sources, targets, initialConditions, bundle] =
    values;
  if (!routes.length) throw new Error("This bundle has no routes");
  const profiles = Object.fromEntries(
    await Promise.all(
      routes.map(async (r) => {
        if (!/^[a-z0-9-]+$/.test(r.id) || r.file !== `route-${r.id}.json`)
          throw new Error("Invalid route asset");
        const p = await fetchJSON(DATA + r.file);
        if (
          p.length < 2 ||
          p.some(
            (v, i) =>
              !["d", "lon", "lat", "z", "g"].every((k) => Number.isFinite(v[k])) ||
              (i > 0 && v.d <= p[i - 1].d),
          )
        )
          throw new Error("Invalid route profile");
        return [r.id, p];
      }),
    ),
  );
  $("bundleName").textContent = bundle.name;
  $("route").replaceChildren(...routes.map((r) => new Option(r.name, r.id)));
  $("loadMessage").textContent = "Preparing terrain overview…";
  const provider = await createTerrain(C, meta, DATA, (msg) => {
    $("mapNotice").textContent = msg;
  });
  const viewer = new C.Viewer("cesium", {
    terrainProvider: provider,
    baseLayer: new C.ImageryLayer(
      new C.OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" }),
    ),
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    animation: false,
    timeline: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
  });
  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer.scene.backgroundColor = C.Color.fromCssColorString("#102225");
  let sawTiles = false;
  viewer.scene.globe.tileLoadProgressEvent.addEventListener((count) => {
    if (count > 0) sawTiles = true;
    if (sawTiles && count === 0) {
      document.body.dataset.mapReady = "true";
      $("loading").hidden = true;
    }
  });
  const naip = viewer.imageryLayers.addImageryProvider(
    new C.UrlTemplateImageryProvider({
      url: "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage?f=image&format=jpgpng&size=256,256&bboxSR=3857&imageSR=3857&bbox={westProjected},{southProjected},{eastProjected},{northProjected}",
      rectangle: C.Rectangle.fromDegrees(meta.west, meta.south, meta.east, meta.north),
      maximumLevel: 19,
      credit: "USDA NAIP via USGS · imagery acquisition date unverified",
    }),
  );
  let imageryWarned = false;
  naip.imageryProvider.errorEvent.addEventListener(() => {
    if (!imageryWarned) {
      imageryWarned = true;
      toast("Aerial imagery is unavailable. Toggle it off to use the base map.");
    }
  });
  const rect = C.Rectangle.fromDegrees(meta.west, meta.south, meta.east, meta.north);
  const color = (s) => C.Color.fromCssColorString(s);
  const line = (p, material, width = 4, properties = {}) =>
    viewer.entities.add({
      properties,
      polyline: {
        positions: C.Cartesian3.fromDegreesArray(p.flatMap((q) => [q.lon, q.lat])),
        clampToGround: true,
        width,
        material,
      },
    });
  const routeEntities = {},
    accessEntities = {};
  for (const r of routes) {
    const p = profiles[r.id],
      entities = [];
    let run = [p[0]],
      b = bucket(p[0].g);
    const flush = () => {
      if (run.length > 1) entities.push(line(run, color(COLORS[b]), 5, { route: r.id }));
    };
    for (let i = 1; i < p.length; i++) {
      run.push(p[i]);
      if (bucket(p[i].g) !== b) {
        flush();
        run = [p[i]];
        b = bucket(p[i].g);
      }
    }
    flush();
    routeEntities[r.id] = {
      colored: entities,
      dim: line(p, color("#a4b5b0").withAlpha(0.65), 3, { route: r.id }),
    };
    accessEntities[r.id] = r.access_segments
      .filter((s) => s.status !== "designated")
      .map((s) => {
        const segment = [
          { ...sample(p, s.d0), d: s.d0 },
          ...p.filter((q) => q.d > s.d0 && q.d < s.d1),
          { ...sample(p, s.d1), d: s.d1 },
        ];
        return line(
          segment,
          new C.PolylineDashMaterialProperty({
            color: color(s.status === "conflict" ? "#ff80bf" : "#f1c176"),
            dashLength: 14,
          }),
          8,
          { route: r.id, d: s.d0 },
        );
      });
  }
  const mvumEntities = mvum.map((s) =>
    line(
      s.coords.map((c) => ({ lon: c[0], lat: c[1] })),
      color("#90a9f1").withAlpha(0.55),
      10,
    ),
  );
  viewer.entities.add({
    polyline: {
      positions: C.Cartesian3.fromDegreesArray([
        meta.west,
        meta.south,
        meta.east,
        meta.south,
        meta.east,
        meta.north,
        meta.west,
        meta.north,
        meta.west,
        meta.south,
      ]),
      clampToGround: true,
      width: 2,
      material: new C.PolylineDashMaterialProperty({
        color: color("#f1c176").withAlpha(0.7),
        dashLength: 18,
      }),
    },
  });
  const marker = (w, isTarget = false) =>
    viewer.entities.add({
      position: C.Cartesian3.fromDegrees(w.lon, w.lat),
      properties: { route: w.route, d: w.d, waypoint: w.id },
      point: {
        pixelSize: isTarget ? 6 : 9,
        color: color(
          isTarget
            ? "#f1c176"
            : w.kind === "obstacle"
              ? "#e48479"
              : w.kind === "junction"
                ? "#90a9f1"
                : "#bee88a",
        ),
        outlineColor: C.Color.BLACK,
        outlineWidth: 1,
        heightReference: C.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Infinity,
      },
      label: {
        text: w.title,
        font: "12px sans-serif",
        fillColor: C.Color.WHITE,
        showBackground: true,
        backgroundColor: color("#102225").withAlpha(0.85),
        pixelOffset: new C.Cartesian2(0, -20),
        heightReference: C.HeightReference.CLAMP_TO_GROUND,
        distanceDisplayCondition: new C.DistanceDisplayCondition(0, isTarget ? 1000 : 2200),
      },
    });
  const marks = waypoints.map((w) => ({ route: w.route, entity: marker(w) }));
  const candidates = targets
    .filter((t) => !waypoints.some((w) => w.id === t.id))
    .map((t) => ({ route: t.route, entity: marker(t, true) }));
  const position = viewer.entities.add({
    point: {
      pixelSize: 11,
      color: color("#bff8e5"),
      outlineColor: C.Color.BLACK,
      outlineWidth: 2,
      heightReference: C.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Infinity,
    },
  });
  const saved = readStore(KEY, {});
  const state = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  const views = state.views && typeof state.views === "object" ? state.views : {};
  let bookmarks = Array.isArray(state.bookmarks)
    ? state.bookmarks
        .filter((b) => b && typeof b.name === "string" && routes.some((r) => r.id === b.route))
        .slice(0, 100)
    : [];
  let notes = {};
  try {
    notes = notesImport(
      { schema_version: 1, trail: TRAIL, notes: state.notes || {} },
      TRAIL,
      new Set(targets.map((t) => t.id)),
    );
  } catch {}
  let conditions = initialConditions;
  const localWeather = readStore(KEY + ":weather", null);
  if (localWeather && Array.isArray(localWeather.weather))
    conditions = {
      ...conditions,
      weather: conditions.weather?.length
        ? mergeWeather(conditions.weather, localWeather.weather)
        : localWeather.weather,
    };
  let activeId = null,
    profile = null,
    route = null,
    view = cleanView(),
    playing = false,
    lastFrame = null,
    activeTab = "summary",
    pinned = false,
    shownId = null,
    chosenWaypoint = null,
    saving = false;
  const cameraState = () => {
    const c = viewer.camera.positionCartographic;
    return {
      lon: C.Math.toDegrees(c.longitude),
      lat: C.Math.toDegrees(c.latitude),
      height: c.height,
      heading: viewer.camera.heading,
      pitch: viewer.camera.pitch,
      roll: viewer.camera.roll,
    };
  };
  const setCamera = (c) => {
    viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
    viewer.camera.setView({
      destination: C.Cartesian3.fromDegrees(c.lon, c.lat, c.height),
      orientation: { heading: c.heading, pitch: c.pitch, roll: c.roll },
    });
  };
  const remember = () => {
    if (!activeId) return;
    views[activeId] = { ...view, camera: cameraState() };
    if (view.mode === "global") views[activeId].globalCamera = cameraState();
  };
  let saveTimer,
    storageWarned = false;
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (saving) return;
      remember();
      if (
        !writeStore(KEY, { views, activeId, bookmarks, notes, tripDate: $("tripDate").value }) &&
        !storageWarned
      ) {
        storageWarned = true;
        toast("Browser storage is unavailable. Use view links and note backups to keep your work.");
      }
    }, 200);
  };
  const tab = (id) => {
    activeTab = id;
    document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = p.id !== id));
    document
      .querySelectorAll("[data-tab]")
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === id)));
    if ($("sidebar").hidden) togglePanel();
    if (id === "evidence") renderMedia();
  };
  function togglePanel() {
    $("sidebar").hidden = !$("sidebar").hidden;
    $("togglePanel").textContent = $("sidebar").hidden ? "Show planner" : "Hide planner";
    $("togglePanel").setAttribute("aria-expanded", String(!$("sidebar").hidden));
    requestAnimationFrame(() => {
      viewer.resize();
      drawProfile();
    });
  }
  function visibility() {
    for (const r of routes) {
      const active = r.id === activeId;
      routeEntities[r.id].colored.forEach((e) => (e.show = active && $("lyrTrail").checked));
      routeEntities[r.id].dim.show = !active && $("lyrTrail").checked;
      accessEntities[r.id].forEach(
        (e) => (e.show = active && $("lyrAccess").checked && $("lyrTrail").checked),
      );
    }
    mvumEntities.forEach((e) => (e.show = $("lyrMvum").checked));
    marks.forEach((m) => (m.entity.show = $("lyrMarks").checked));
    candidates.forEach((m) => (m.entity.show = $("lyrMarks").checked && m.route === activeId));
    naip.show = $("lyrNaip").checked;
    viewer.scene.requestRender();
  }
  function controlValues() {
    for (const k of ["mode", "heading", "range", "direction", "speed"]) $(k).value = view[k];
    $("exagg").value = Math.round(view.exagg * 10);
    $("heading").disabled = $("range").disabled = view.mode === "global";
    $("headingVal").textContent = `${Math.round(view.heading)}°`;
    $("rangeVal").textContent = `${Math.round(view.range)} m`;
    $("exaggVal").textContent = `${view.exagg.toFixed(1)}×`;
  }
  function update(moveCamera = true) {
    if (!profile) return;
    view.d = clamp(view.d, 0, route.length_m);
    const p = sample(profile, view.d);
    position.position = C.Cartesian3.fromDegrees(p.lon, p.lat);
    viewer.scene.verticalExaggeration = view.exagg;
    if (moveCamera && view.mode !== "global") {
      let other = sample(profile, clamp(view.d + view.direction * 50, 0, route.length_m));
      let origin = p;
      if (Math.abs(other.lon - p.lon) + Math.abs(other.lat - p.lat) < 1e-9) {
        origin = sample(profile, clamp(view.d - view.direction * 50, 0, route.length_m));
        other = p;
      }
      const bearing = Math.atan2(
        (other.lon - origin.lon) * Math.cos(C.Math.toRadians(p.lat)),
        other.lat - origin.lat,
      );
      const h = (view.mode === "fixed" ? 0 : bearing) + C.Math.toRadians(view.heading),
        pitch = C.Math.toRadians(view.mode === "top" ? -88 : -22);
      viewer.camera.lookAt(
        C.Cartesian3.fromDegrees(p.lon, p.lat, p.z * view.exagg + 6),
        new C.HeadingPitchRange(h, pitch, view.range),
      );
    }
    $("hudMile").textContent = `${(view.d / MI).toFixed(2)} mi`;
    $("hudElev").textContent = `${Math.round(p.z * FT).toLocaleString()} ft`;
    $("hudGrade").textContent = `${(p.g * 100 * view.direction).toFixed(1)}% estimated grade`;
    $("scrub").value = Math.round((view.d / route.length_m) * 1000);
    $("scrub").setAttribute("aria-valuetext", `${(view.d / MI).toFixed(2)} miles from route start`);
    $("distanceReadout").textContent =
      `${(view.d / MI).toFixed(2)} / ${(route.length_m / MI).toFixed(2)} mi`;
    $("profile").setAttribute("aria-valuenow", $("scrub").value);
    $("profile").setAttribute(
      "aria-valuetext",
      `${(view.d / MI).toFixed(2)} miles, ${Math.round(p.z * FT)} feet, estimated grade ${(p.g * 100 * view.direction).toFixed(1)} percent`,
    );
    controlValues();
    drawProfile();
    if (activeTab === "evidence") renderMedia();
    viewer.scene.requestRender();
    persist();
  }
  function setRoute(id, override) {
    const r = routes.find((r) => r.id === id);
    if (!r) return;
    remember();
    stop();
    activeId = id;
    route = r;
    profile = profiles[id];
    view = cleanView(override || views[id] || {});
    $("route").value = id;
    chosenWaypoint = null;
    if (!pinned) shownId = null;
    saving = true;
    viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
    controlValues();
    visibility();
    renderRoute();
    renderField();
    update(false);
    if (view.camera) setCamera(view.camera);
    else if (view.mode === "global") viewer.camera.setView({ destination: rect });
    else update();
    saving = false;
    persist();
  }
  function jump(id, d, wp) {
    if (id !== activeId) setRoute(id);
    view.d = d;
    chosenWaypoint = wp || null;
    if (wp && !pinned) shownId = null;
    update();
  }
  function switchMode(mode) {
    const previous = view.mode;
    if (previous === "global") view.globalCamera = cameraState();
    view.mode = mode;
    viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
    if (mode === "global") {
      if (view.globalCamera) setCamera(view.globalCamera);
      else viewer.camera.setView({ destination: rect });
    }
    update();
  }
  function renderRoute() {
    const stats = route.stats,
      wps = waypoints.filter((w) => w.route === activeId),
      ts = targets.filter((t) => t.route === activeId);
    const designations = mvum.filter((s) => route.mvum_ids.includes(s.id));
    $("routeCard").innerHTML =
      `${badge(route.access_status)}<h2 class="route-title">${esc(route.name)}</h2><div class="stats"><div><strong>${(route.length_m / MI).toFixed(2)}</strong><span>miles · one way</span></div><div><strong>${Math.round(stats.ascent_m * FT).toLocaleString()}</strong><span>ft ascent · start → end</span></div><div><strong>${Math.round(stats.descent_m * FT).toLocaleString()}</strong><span>ft descent · start → end</span></div></div><p class="muted">${Math.round(stats.zmin * FT).toLocaleString()}–${Math.round(stats.zmax * FT).toLocaleString()} ft elevation · ${(stats.max_grade * 100).toFixed(0)}% peak estimated grade</p>${route.notes ? `<div class="callout ${route.access_status === "conflict" ? "conflict" : ""}">${esc(route.notes)}</div>` : ""}<p><small>Route evidence: ${esc(route.evidence_date || "date unknown")}. Current closure review: unverified.</small></p><div class="inline">${route.entrances.map((e) => `<button data-jump="${e.d}">${esc(e.label)}</button>`).join("")}</div><p class="muted">${wps.length} curated points · ${ts.length} capture candidates</p><details><summary>Access along this route</summary><p><small>Amber dashes: unverified. Pink dashes: conflicting access evidence. A cached designation does not establish current access.</small></p>${route.access_segments
        .map(
          (s) =>
            `<div class="access-row"><button data-jump="${s.d0}">${(s.d0 / MI).toFixed(2)}–${(s.d1 / MI).toFixed(2)} mi</button>${badge(s.status)}<p>${esc(s.basis)}</p>${link(`https://www.openstreetmap.org/way/${s.osm_way}`, "OSM source")}<small> · ${esc(
              Object.entries(s.osm_tags)
                .filter(([k]) =>
                  ["motor_vehicle", "access", "highway", "surface", "smoothness", "atv"].includes(
                    k,
                  ),
                )
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · "),
            )}</small></div>`,
        )
        .join("")}</details><details><summary>Vehicle permissions and season dates</summary>${
        designations
          .map((s) => {
            const a = s.attributes;
            return `<div class="source-item"><strong>${esc(s.id)} · ${esc(a.jurisdiction)}</strong><p>${esc(a.surfacetype)} · ${esc(a.operationalmaintlevel)}</p>${["fourwd_gt50inches", "atv", "motorcycle", "passengervehicle"].map((k) => `<div>${esc({ fourwd_gt50inches: "4WD >50 in", atv: "ATV", motorcycle: "Motorcycle", passengervehicle: "Passenger vehicle" }[k])}: ${esc(a[k] || "unknown")} · ${esc(a[k === "fourwd_gt50inches" ? "fourwd_gt50_datesopen" : k + "_datesopen"] || "dates unknown")}</div>`).join("")}${link(s.source_url, "USFS source")}</div>`;
          })
          .join("") || "<p>No matching designation in this cache.</p>"
      }</details><details><summary>Route sources</summary>${route.source_urls.map((u, i) => `<p class="source-item">${link(u, i === route.source_urls.length - 1 ? "USFS MVUM service" : "OSM route geometry")}</p>`).join("")}</details>`;
    $("routeCard")
      .querySelectorAll("[data-jump]")
      .forEach((b) => (b.onclick = () => jump(activeId, +b.dataset.jump)));
    const points = [...wps, ...ts.filter((t) => !wps.some((w) => w.id === t.id)).slice(0, 5)].sort(
      (a, b) => a.d - b.d,
    );
    $("waypointList").innerHTML =
      points
        .map(
          (w) =>
            `<button data-point="${esc(w.id)}"><span>${esc(w.title)}</span><small>${(w.d / MI).toFixed(2)} mi</small></button>`,
        )
        .join("") ||
      '<p class="muted">No curated points yet. Browse the capture candidates in Field plan.</p>';
    $("waypointList")
      .querySelectorAll("[data-point]")
      .forEach(
        (b) =>
          (b.onclick = () => {
            const w = points.find((w) => w.id === b.dataset.point);
            jump(activeId, w.d, w.id);
            tab("evidence");
          }),
      );
  }
  function renderMedia() {
    if (pinned && shownId) return;
    const candidates = [
      ...waypoints.filter((w) => w.route === activeId),
      ...targets.filter((t) => t.route === activeId && !waypoints.some((w) => w.id === t.id)),
    ];
    const exact = candidates.find((w) => w.id === chosenWaypoint);
    const nearest =
      exact ||
      candidates
        .filter((w) => Math.abs(w.d - view.d) <= 250)
        .sort((a, b) => Math.abs(a.d - view.d) - Math.abs(b.d - view.d))[0];
    if ((nearest?.id || null) === shownId) return;
    shownId = nearest?.id || null;
    $("evidenceHint").textContent = nearest
      ? `${(nearest.d / MI).toFixed(2)} mi from route start · ${nearest.confidence || "approximate location"}`
      : "No location evidence nearby. Select a waypoint or a field-plan target.";
    if (!nearest) {
      $("mediaContent").replaceChildren();
      return;
    }
    const media = nearest.media || [];
    $("mediaContent").innerHTML =
      `<h3>${esc(nearest.title)}</h3><p>${esc(nearest.notes || nearest.reason || "")}</p>${badge("candidate", nearest.confidence || "Approximate location")}<p><small>${nearest.observed_at ? "Observed " + esc(nearest.observed_at) : "Observation date unknown"}</small></p>${
        media
          .map((m) => {
            const u = mediaURL(m, new URL(DATA, location.href));
            if (!u) return "";
            return `<article class="media-item"><strong>${esc(m.title || "Location media")}</strong>${m.type === "youtube" ? `<iframe src="${esc(u)}" title="${esc(m.title || "Trail video")}" loading="lazy" allowfullscreen></iframe>` : `<img src="${esc(u)}" alt="${esc(m.alt || m.title || "Trail photograph")}" loading="lazy">`}<small>${m.recorded_at ? "Recorded " + esc(m.recorded_at) : "Recording date unknown"} · ${esc(m.direction || "direction unknown")} · ${m.coverage_verified ? "Coverage verified" : "Context only; obstacle coverage unverified"}${Number.isFinite(m.start_seconds) ? " · starts at " + m.start_seconds + "s" : ""}</small>${link(m.source_url || (m.type === "youtube" ? `https://www.youtube.com/watch?v=${m.id}` : u), "Open source")}</article>`;
          })
          .join("") ||
        '<div class="callout">No verified media at this location. Add a dated observation or capture during a visit.</div>'
      }${(nearest.source_urls || [nearest.source_url])
        .filter(Boolean)
        .map((u) => `<p class="source-item">${link(u, "Evidence source")}</p>`)
        .join("")}`;
  }
  function renderSources() {
    const cat = sources.catalog;
    $("sourceDetails").innerHTML =
      `<p class="source-item">${esc(sources.terrain_source)}</p><p class="muted">Acquisition date: ${esc(sources.acquired_at || "unverified")}. Native resolution: ${sources.native_resolution_m ? esc(sources.native_resolution_m) + " m" : "unverified"}. Export spacing: ${esc(sources.sample_spacing_m.north_south)} m north/south, ${esc(sources.sample_spacing_m.east_west)} m east/west.</p><p class="muted">Grade uses 10 m route samples, a five-sample elevation median, and a central difference. Grade variability describes changes in slope, not rocks or ledge heights. Outside the amber boundary, no downloaded terrain is modeled.</p><p class="muted">Aerial imagery uses the live NAIP mosaic; acquisition date is unverified.</p><p>${link(DATA + "sources.json", "Download input hashes and build provenance")}</p>${cat ? `<h3>Available source DEMs</h3><p class="muted">${cat.total} catalog products · queried ${esc(cat.fetched_at?.slice(0, 10))}. These are candidates, not confirmed inputs to this mosaic.</p>${cat.products.map((p) => `<div class="source-item">${link(p.metaUrl || p.downloadURL, p.title)}<br><small>Published ${esc(p.publicationDate || "unknown")} · product ${esc(p.sourceId)}</small></div>`).join("")}` : '<p class="muted">No source-product catalog has been cached.</p>'}`;
  }
  function renderConditions() {
    const date = $("tripDate").value;
    if (!$("weatherStatus").textContent && conditions.errors?.length)
      $("weatherStatus").textContent =
        "Some sources failed during the last refresh. Each card retains its own evidence date.";
    $("agencyNotices").innerHTML =
      `<div class="callout"><strong>Current access review needed</strong><p>${esc(conditions.agency_review?.message || "Check current forest orders and district notices before visiting.")}</p>${(bundle.agency_sources || []).map((s) => `<p>${link(s.url, s.title)}</p>`).join("")}</div>${(conditions.notices || []).map((n) => `<article class="card"><h3>${esc(n.title)}</h3><p>${esc(n.summary)}</p><small>Effective ${esc(n.effective_from || "unknown")}–${esc(n.effective_to || "unknown")} · checked ${esc(n.checked_at || "unknown")} · ${esc(n.applicability || "applicability unverified")}</small><p>${link(n.source_url, "Agency notice")}</p></article>`).join("")}`;
    $("weatherCards").innerHTML =
      (conditions.weather || [])
        .map((w) => {
          const periods = periodsForDate(w.periods, date),
            alerts = (w.alerts || []).filter((a) => {
              const p = a.properties;
              return !p.expires || Date.parse(p.expires) > Date.now();
            });
          return `<article class="card"><h3>${esc(w.label)}</h3><small>${Math.round(w.elevation_m * FT).toLocaleString()} ft route elevation · ${esc(freshness(w.fetched_at, 12))}</small>${periods.map((p) => `<div class="forecast-period"><strong>${esc(p.name)} · ${esc(p.temperature)}°${esc(p.temperatureUnit)}</strong><p>${esc(p.shortForecast)} · wind ${esc(p.windSpeed)} ${esc(p.windDirection)}${p.probabilityOfPrecipitation?.value != null ? " · precipitation " + p.probabilityOfPrecipitation.value + "%" : ""}</p></div>`).join("") || "<p>No forecast available for this date. Refresh within the forecast window.</p>"}${w.alerts === null || w.alerts === undefined ? '<p class="callout">Alerts unavailable; status unknown.</p>' : alerts.length ? alerts.map((a) => `<div class="callout conflict"><strong>${esc(a.properties.event)}</strong><p>${esc(a.properties.headline || "")}</p>${link(a.properties["@id"] || a.id, "Alert source")}</div>`).join("") : "<p><small>No active alerts in this snapshot. Alerts describe current conditions, not a future trip date.</small></p>"}${link(w.source_url, "NWS forecast")}</article>`;
        })
        .join("") || "<p>No weather snapshot available. Use Refresh weather.</p>";
    $("agencyNotices").insertAdjacentHTML(
      "beforeend",
      (conditions.agency_pages || [])
        .map(
          (p) =>
            `<details><summary>${esc(p.title)} · ${p.fetched_at ? "retrieved " + esc(p.fetched_at.slice(0, 10)) : "unavailable"}</summary><p class="muted">Document discovery only; geographic applicability has not been reviewed.</p>${p.error ? '<p class="muted">The agency page could not be retrieved. Open the source directly.</p>' : ""}${(p.documents || []).map((d) => `<p class="source-item">${link(d.url, d.title)}</p>`).join("")}</details>`,
        )
        .join(""),
    );
    $("snowCards").innerHTML =
      (conditions.snow || [])
        .map(
          (s) =>
            `<article class="card"><h3>${esc(s.station.name)}</h3><small>${esc(s.distance_km)} km from bundle center · ${Math.round(s.station.elevation).toLocaleString()} ft · ${esc(freshness(s.fetched_at, 48))}</small>${
              (s.data?.data || [])
                .map((d) => {
                  const v = d.values.filter((v) => v.value != null),
                    last = v.at(-1),
                    first = v[0];
                  return `<p class="snow-values"><strong>${d.stationElement.elementCode === "SNWD" ? "Snow depth" : "Snow water equivalent"}: ${last ? esc(last.value) + " " + esc(d.stationElement.storedUnitCode) : "unavailable"}</strong>${last ? `<br><small>${esc(last.date)} · ${v.length} observations · change ${Number(last.value - first.value).toFixed(1)} ${esc(d.stationElement.storedUnitCode)} since ${esc(first.date)}</small>` : ""}</p>`;
                })
                .join("") || "<p>No recent snow observations.</p>"
            }${link(s.source_url, "NRCS station")}</article>`,
        )
        .join("") ||
      '<p class="muted">No snow snapshot cached. Run the source refresh command to add nearby stations.</p>';
  }
  async function refreshWeather() {
    $("refreshWeather").disabled = true;
    $("weatherStatus").textContent = "Checking NWS forecasts across the bundle…";
    const points = Object.values(profiles).flat(),
      primary = routes.find((r) => r.role === "primary") || routes[0],
      pp = profiles[primary.id];
    const locations = [
      ["Lowest route elevation", points.reduce((a, b) => (a.z < b.z ? a : b))],
      ["Highest route elevation", points.reduce((a, b) => (a.z > b.z ? a : b))],
      ["Primary start", pp[0]],
      ["Primary end", pp.at(-1)],
    ];
    const results = await Promise.allSettled(
      locations.map(async ([label, p]) => {
        const loc = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`,
          info = await fetchJSON("https://api.weather.gov/points/" + loc),
          f = await fetchJSON(info.properties.forecast);
        let alerts = null;
        try {
          alerts = (await fetchJSON("https://api.weather.gov/alerts/active?point=" + loc)).features;
        } catch {}
        return {
          label,
          lat: p.lat,
          lon: p.lon,
          elevation_m: p.z,
          periods: f.properties.periods,
          alerts,
          fetched_at: new Date().toISOString(),
          source_url: `https://forecast.weather.gov/MapClick.php?lat=${p.lat}&lon=${p.lon}`,
        };
      }),
    );
    const weather = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") weather.push(r.value);
      else weather.push(...(conditions.weather || []).filter((w) => w.label === locations[i][0]));
    });
    conditions = { ...conditions, weather };
    writeStore(KEY + ":weather", { weather });
    renderConditions();
    $("refreshWeather").disabled = false;
    const count = results.filter((r) => r.status === "fulfilled").length;
    $("weatherStatus").textContent =
      `Updated ${count}/${locations.length} locations.${count < locations.length ? " Failed locations retain their previous dated snapshots." : ""}`;
  }
  function filteredTargets() {
    return targets.filter((t) =>
      $("fieldFilter").value === "route"
        ? t.route === activeId
        : $("fieldFilter").value === "pending"
          ? !["observed", "captured"].includes(notes[t.id]?.status)
          : true,
    );
  }
  function renderField() {
    const list = filteredTargets();
    $("fieldTotals").innerHTML =
      `<p><strong>${list.length} targets · ${list.reduce((s, t) => s + t.minutes, 0)} min estimated capture</strong><br><small>Notes stay in this browser. Back them up before changing devices.</small></p>`;
    $("captureList").innerHTML =
      list
        .map((t) => {
          const n = notes[t.id] || { status: "pending", notes: "" };
          return `<article class="card" data-target="${esc(t.id)}"><div class="inline">${badge("candidate", "Priority " + t.priority)}${badge(t.access, t.access === "conflict" ? "Resolve access first" : t.access)}</div><h3>${esc(t.title)}</h3><small>${esc(t.route)} · ${(t.d / MI).toFixed(2)} mi · ${t.minutes} min · ${esc(t.confidence)}</small><p>${esc(t.reason)}</p><button data-locate="${esc(t.id)}">Locate on map</button><label>Status<select data-status="${esc(t.id)}">${[
            ["pending", "Pending"],
            ["observed", "Observed"],
            ["captured", "Captured"],
            ["revisit", "Needs revisit"],
          ]
            .map(
              ([v, l]) => `<option value="${v}" ${n.status === v ? "selected" : ""}>${l}</option>`,
            )
            .join(
              "",
            )}</select></label><label>Field notes<textarea data-notes="${esc(t.id)}" maxlength="10000" placeholder="Date, direction, conditions, filenames, measurements…">${esc(n.notes)}</textarea></label><small data-note-time="${esc(t.id)}">${n.updated_at ? "Saved " + esc(n.updated_at.slice(0, 16).replace("T", " ")) + " UTC" : ""}</small></article>`;
        })
        .join("") || '<p class="muted">No targets match this filter.</p>';
    $("captureList")
      .querySelectorAll("[data-locate]")
      .forEach(
        (b) =>
          (b.onclick = () => {
            const t = targets.find((t) => t.id === b.dataset.locate);
            jump(t.route, t.d, t.id);
            if (view.mode === "global") switchMode("top");
          }),
      );
    const saveNote = (id, field, value) => {
      notes[id] = {
        status: "pending",
        notes: "",
        ...notes[id],
        [field]: value,
        updated_at: new Date().toISOString(),
      };
      persist();
    };
    $("captureList")
      .querySelectorAll("[data-status]")
      .forEach(
        (s) =>
          (s.onchange = () => {
            saveNote(s.dataset.status, "status", s.value);
            if ($("fieldFilter").value === "pending") renderField();
          }),
      );
    $("captureList")
      .querySelectorAll("[data-notes]")
      .forEach(
        (t) =>
          (t.oninput = () => {
            saveNote(t.dataset.notes, "notes", t.value);
          }),
      );
  }
  function renderBookmarks() {
    $("bookmarks").innerHTML =
      bookmarks
        .map(
          (b, i) =>
            `<div class="bookmark-row"><button data-bookmark="${i}">${esc(b.name)}</button><button data-remove="${i}" aria-label="Delete bookmark ${esc(b.name)}">×</button></div>`,
        )
        .join("") || '<p class="muted">Save a viewpoint to return to it later.</p>';
    $("bookmarks")
      .querySelectorAll("[data-bookmark]")
      .forEach(
        (b) =>
          (b.onclick = () => {
            const item = bookmarks[+b.dataset.bookmark];
            setRoute(item.route, item.view);
          }),
      );
    $("bookmarks")
      .querySelectorAll("[data-remove]")
      .forEach(
        (b) =>
          (b.onclick = () => {
            bookmarks.splice(+b.dataset.remove, 1);
            renderBookmarks();
            persist();
          }),
      );
  }
  const canvas = $("profile"),
    ctx = canvas.getContext("2d");
  let profileGeometry = { left: 54, right: 10, top: 8, bottom: 24 };
  function drawProfile() {
    if (!profile) return;
    const w = canvas.clientWidth,
      h = canvas.clientHeight,
      scale = window.devicePixelRatio || 1;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * scale) || canvas.height !== Math.round(h * scale)) {
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const { left, right, top, bottom } = profileGeometry,
      pw = w - left - right,
      ph = h - top - bottom;
    const raw = $("rawProfile").checked;
    let min = Math.min(...profile.map((p) => (raw ? Math.min(p.z, p.raw_z ?? p.z) : p.z))),
      max = Math.max(...profile.map((p) => (raw ? Math.max(p.z, p.raw_z ?? p.z) : p.z)));
    if (max - min < 1) max = min + 1;
    const x = (d) => left + (d / route.length_m) * pw,
      y = (z) => top + ((max - z) / (max - min)) * ph;
    ctx.font = "10px system-ui";
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const z = min + ((max - min) * i) / 2;
      ctx.strokeStyle = "#30474a";
      ctx.beginPath();
      ctx.moveTo(left, y(z));
      ctx.lineTo(w - right, y(z));
      ctx.stroke();
      ctx.fillStyle = "#a5b8b5";
      ctx.textAlign = "right";
      ctx.fillText(Math.round(z * FT).toLocaleString() + " ft", left - 5, y(z) + 3);
    }
    for (let i = 0; i < 5; i++) {
      ctx.textAlign = i === 0 ? "left" : i === 4 ? "right" : "center";
      ctx.fillStyle = "#a5b8b5";
      ctx.fillText(
        (((route.length_m / MI) * i) / 4).toFixed(1) + " mi",
        x((route.length_m * i) / 4),
        h - 4,
      );
    }
    for (const z of analysis[activeId].steep) {
      ctx.fillStyle = "#e4847915";
      ctx.fillRect(x(z.d0), top, x(z.d1) - x(z.d0), ph);
    }
    ctx.beginPath();
    ctx.moveTo(x(0), y(min));
    profile.forEach((p) => ctx.lineTo(x(p.d), y(p.z)));
    ctx.lineTo(x(route.length_m), y(min));
    ctx.closePath();
    ctx.fillStyle = "#bee88a12";
    ctx.fill();
    if (raw) {
      ctx.strokeStyle = "#8b9d9b";
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      profile.forEach((p, i) => ctx[i ? "lineTo" : "moveTo"](x(p.d), y(p.raw_z ?? p.z)));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.lineWidth = 2;
    for (let i = 0; i < profile.length - 1; i++) {
      ctx.strokeStyle = COLORS[bucket(profile[i].g)];
      ctx.beginPath();
      ctx.moveTo(x(profile[i].d), y(profile[i].z));
      ctx.lineTo(x(profile[i + 1].d), y(profile[i + 1].z));
      ctx.stroke();
    }
    for (const p of waypoints.filter((w) => w.route === activeId)) {
      ctx.fillStyle = p.kind === "obstacle" ? "#e48479" : "#bee88a";
      ctx.beginPath();
      ctx.arc(x(p.d), top + 3, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "#eef2e9";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x(view.d), top);
    ctx.lineTo(x(view.d), h - bottom);
    ctx.stroke();
  }
  function profileDistance(e) {
    const b = canvas.getBoundingClientRect();
    return (
      clamp(
        (e.clientX - b.left - profileGeometry.left) /
          (b.width - profileGeometry.left - profileGeometry.right),
        0,
        1,
      ) * route.length_m
    );
  }
  let dragging = false;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    chosenWaypoint = null;
    view.d = profileDistance(e);
    update();
  });
  canvas.addEventListener("pointermove", (e) => {
    const d = profileDistance(e),
      p = sample(profile, d);
    if (dragging) {
      chosenWaypoint = null;
      view.d = d;
      update();
    }
    const tooltip = $("profileTooltip");
    tooltip.textContent = `${(d / MI).toFixed(2)} mi · ${Math.round(p.z * FT).toLocaleString()} ft · ${(p.g * 100 * view.direction).toFixed(1)}% estimated`;
    tooltip.hidden = false;
    tooltip.style.left = `${clamp(e.clientX - canvas.getBoundingClientRect().left + 12, 0, Math.max(0, canvas.clientWidth - tooltip.offsetWidth))}px`;
  });
  for (const ev of ["pointerup", "pointercancel"])
    canvas.addEventListener(ev, () => (dragging = false));
  canvas.addEventListener("pointerleave", () => ($("profileTooltip").hidden = true));
  canvas.addEventListener("keydown", (e) => {
    let d = view.d;
    if (e.key === "ArrowRight") d += e.shiftKey ? 100 : 10;
    else if (e.key === "ArrowLeft") d -= e.shiftKey ? 100 : 10;
    else if (e.key === "Home") d = 0;
    else if (e.key === "End") d = route.length_m;
    else return;
    e.preventDefault();
    chosenWaypoint = null;
    view.d = d;
    update();
  });
  function stop() {
    playing = false;
    lastFrame = null;
    $("play").textContent = "Play";
    $("play").setAttribute("aria-label", "Play route");
    $("play").setAttribute("aria-pressed", "false");
  }
  function step(t) {
    if (!playing) return;
    if (lastFrame !== null) {
      view.d += Math.min(1, (t - lastFrame) / 1000) * view.speed * 0.44704 * view.direction;
      if (view.d >= route.length_m || view.d <= 0) stop();
    }
    lastFrame = t;
    chosenWaypoint = null;
    update();
    if (playing) requestAnimationFrame(step);
  }
  function play() {
    if (playing) {
      stop();
      return;
    }
    if (view.direction === 1 && view.d >= route.length_m) view.d = 0;
    if (view.direction === -1 && view.d <= 0) view.d = route.length_m;
    playing = true;
    lastFrame = null;
    $("play").textContent = "Pause";
    $("play").setAttribute("aria-label", "Pause route");
    $("play").setAttribute("aria-pressed", "true");
    requestAnimationFrame(step);
  }
  function nextPoint(direction) {
    const sign = direction * view.direction;
    const ds = [
      0,
      route.length_m,
      ...waypoints.filter((w) => w.route === activeId).map((w) => w.d),
      ...targets.filter((t) => t.route === activeId).map((t) => t.d),
    ];
    const sorted = ds
      .filter((d) => (sign > 0 ? d > view.d + 1 : d < view.d - 1))
      .sort((a, b) => sign * (a - b));
    if (sorted.length) {
      chosenWaypoint = null;
      view.d = sorted[0];
      update();
    } else toast("No more points in this direction.");
  }
  $("route").onchange = () => setRoute($("route").value);
  $("mode").onchange = () => switchMode($("mode").value);
  $("scrub").oninput = () => {
    chosenWaypoint = null;
    view.d = (+$("scrub").value / 1000) * route.length_m;
    update();
  };
  for (const k of ["heading", "range", "direction", "speed"])
    $(k).oninput = () => {
      view[k] = +$(k).value;
      update();
    };
  $("exagg").oninput = () => {
    view.exagg = +$("exagg").value / 10;
    update();
  };
  $("reset").onclick = () => {
    const d = view.d;
    view = cleanView({ d, mode: "follow" });
    update();
  };
  $("overview").onclick = () => {
    view.mode = "global";
    viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
    viewer.camera.setView({ destination: rect });
    view.globalCamera = cameraState();
    update(false);
  };
  $("play").onclick = play;
  $("previous").onclick = () => nextPoint(-1);
  $("next").onclick = () => nextPoint(1);
  document.addEventListener("keydown", (e) => {
    if (
      /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName) ||
      e.target.isContentEditable ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey
    )
      return;
    if (e.code === "Space") {
      e.preventDefault();
      play();
    }
    if (e.key.toLowerCase() === "n") nextPoint(1);
    if (e.key.toLowerCase() === "p") nextPoint(-1);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
  });
  for (const id of ["lyrNaip", "lyrTrail", "lyrMvum", "lyrMarks", "lyrAccess"])
    $(id).onchange = visibility;
  $("rawProfile").onchange = drawProfile;
  $("togglePanel").onclick = togglePanel;
  document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => tab(b.dataset.tab)));
  $("pinMedia").onclick = () => {
    pinned = !pinned;
    $("pinMedia").setAttribute("aria-pressed", String(pinned));
    $("pinMedia").textContent = pinned ? "Unpin card" : "Pin card";
    if (!pinned) {
      shownId = null;
      renderMedia();
    }
  };
  $("helpToggle").onclick = () => {
    $("helpText").hidden = !$("helpText").hidden;
    $("helpToggle").setAttribute("aria-expanded", String(!$("helpText").hidden));
    viewer.resize();
  };
  $("share").onclick = async () => {
    remember();
    const url = viewURL(location.href, TRAIL, activeId, views[activeId]);
    history.replaceState(null, "", url);
    try {
      await navigator.clipboard.writeText(url);
      toast("View link copied.");
    } catch {
      toast("View saved to the address bar. Copy its URL to share.");
    }
  };
  $("bookmark").onclick = () => {
    remember();
    bookmarks.push({
      name: $("bookmarkName").value.trim() || `${route.name} · ${(view.d / MI).toFixed(2)} mi`,
      route: activeId,
      view: views[activeId],
    });
    bookmarks = bookmarks.slice(-100);
    $("bookmarkName").value = "";
    renderBookmarks();
    persist();
    toast("View saved.");
  };
  $("tripDate").value = /^\d{4}-\d{2}-\d{2}$/.test(state.tripDate || "")
    ? state.tripDate
    : new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Denver",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
  $("tripDate").onchange = () => {
    renderConditions();
    persist();
  };
  $("refreshWeather").onclick = () =>
    refreshWeather().catch((e) => {
      $("refreshWeather").disabled = false;
      $("weatherStatus").textContent = e.message;
    });
  $("fieldFilter").onchange = renderField;
  $("exportGpx").onclick = () => {
    const ts = filteredTargets(),
      ids = new Set(ts.map((t) => t.route));
    if (!ids.size && $("fieldFilter").value === "route") ids.add(activeId);
    download(
      `${TRAIL}-field-plan.gpx`,
      gpx(
        routes.filter((r) => ids.has(r.id)),
        profiles,
        ts,
        notes,
      ),
      "application/gpx+xml",
    );
  };
  $("exportNotes").onclick = () =>
    download(
      `${TRAIL}-field-notes.json`,
      JSON.stringify(
        { schema_version: 1, trail: TRAIL, exported_at: new Date().toISOString(), notes },
        null,
        2,
      ),
      "application/json",
    );
  $("importNotes").onchange = async () => {
    try {
      const f = $("importNotes").files[0];
      if (!f) return;
      if (f.size > 2 * 1024 * 1024) throw new Error("Notes file exceeds 2 MB.");
      const imported = notesImport(
        JSON.parse(await f.text()),
        TRAIL,
        new Set(targets.map((t) => t.id)),
      );
      for (const [id, n] of Object.entries(imported)) {
        if (!notes[id] || Date.parse(n.updated_at) > Date.parse(notes[id].updated_at))
          notes[id] = n;
      }
      persist();
      renderField();
      toast("Notes merged; newer local entries retained.");
    } catch (e) {
      toast(e.message);
    } finally {
      $("importNotes").value = "";
    }
  };
  viewer.screenSpaceEventHandler.setInputAction((e) => {
    const picked = viewer.scene.pick(e.position),
      p = picked?.id?.properties,
      id = p?.route?.getValue();
    if (!id) return;
    const d = p?.d?.getValue(),
      wp = p?.waypoint?.getValue();
    if (d !== undefined) {
      jump(id, d, wp);
      if (wp) tab("evidence");
    } else setRoute(id);
  }, C.ScreenSpaceEventType.LEFT_CLICK);
  // Free camera movement is saved without changing it; trail controls use a range
  // synchronized to mouse-wheel distance to avoid snapping back after zooming.
  viewer.camera.moveEnd.addEventListener(() => {
    if (!profile || saving) return;
    if (view.mode !== "global") {
      const p = sample(profile, view.d),
        target = C.Cartesian3.fromDegrees(p.lon, p.lat, p.z * view.exagg + 6);
      view.range = clamp(C.Cartesian3.distance(viewer.camera.positionWC, target), 60, 10000);
      controlValues();
    }
    persist();
  });
  window.addEventListener("pagehide", () => {
    remember();
    writeStore(KEY, { views, activeId, bookmarks, notes, tripDate: $("tripDate").value });
  });
  new ResizeObserver(() => {
    viewer.resize();
    drawProfile();
  }).observe($("workspace"));
  new ResizeObserver(drawProfile).observe(canvas);
  renderSources();
  renderConditions();
  renderBookmarks();
  const url = viewFromURL(location.search);
  setRoute(
    url && routes.some((r) => r.id === url.route)
      ? url.route
      : routes.some((r) => r.id === state.activeId)
        ? state.activeId
        : routes[0].id,
    url && routes.some((r) => r.id === url.route) ? url : undefined,
  );
  $("loadMessage").textContent = "Route controls are ready. Loading the first map tiles…";
  setTimeout(() => {
    if (!document.body.dataset.mapReady) {
      $("loading").hidden = true;
      toast("Map tiles are still loading. Route profiles and planning controls are available.");
    }
  }, 12000);
  document.body.dataset.ready = "true";
}
boot().catch(loadError);
