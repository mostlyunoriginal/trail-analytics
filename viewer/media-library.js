import { escape as escapeHTML, MI } from "./core.js";
import { coordinates, validPin, inspectMedia, routeCandidates, hashBlob, createArchive, readArchive, validateRecord } from "./media-core.js";
import { openMediaStore } from "./media-store.js";

const element = (id) => document.getElementById(id);
const option = (label, value) => new Option(label, value);

function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function checkPlayback(blob, type) {
  return new Promise((resolve, reject) => {
    const preview = document.createElement(type === "photo" ? "img" : "video");
    const url = URL.createObjectURL(blob);
    const finish = (error) => {
      clearTimeout(timer); preview.onload = preview.onloadeddata = preview.onerror = null;
      preview.removeAttribute("src"); if (type === "video") preview.load();
      URL.revokeObjectURL(url);
      if (error) reject(new Error("This browser cannot preview the file. Convert to JPEG or H.264 MP4 and try again."));
      else resolve();
    };
    const timer = setTimeout(() => finish(true), 20000);
    preview.onload = preview.onloadeddata = () => finish(false);
    preview.onerror = () => finish(true);
    if (type === "video") { preview.muted = true; preview.preload = "auto"; }
    preview.src = url;
  });
}

export async function createMediaLibrary({ viewer, Cesium, trail, routes, profiles, waypoints, targets, getContext, showPanel, prepareMap }) {
  element("library").innerHTML = `
    <h2>Your trail media</h2>
    <p class="muted">Your additions stay private to this browser and device. Published items are labeled and read-only. Nothing uploads automatically. Browser data can be cleared or evicted; back up files and pins regularly.</p>
    <div id="mediaDrop" class="media-drop"><label for="mediaFiles">Add photos or videos · choose files or drop here</label>
      <input id="mediaFiles" type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,.mov" />
      <small>JPEG, PNG, WebP, playable MP4/MOV/WebM · 100 MiB/file. HEIC: export as JPEG. GPS reading: photo EXIF and supported MP4/MOV tags.</small></div>
    <p id="libraryStatus" role="status" aria-live="polite"></p>
    <div class="inline"><label>Show <select id="mediaFilter"><option value="all">All media</option><option value="unplaced">Unplaced</option><option value="nearby">Near trail position</option><option value="review">Needs review</option></select></label>
      <button id="mediaSelect">Select visible</button><button id="mediaClear">Clear selection</button></div>
    <button id="mediaBatchPin">Pin selected at current trail position…</button>
    <div class="inline"><button id="mediaBackup">Back up all / selected</button>
      <label class="button">Restore media<input id="mediaRestore" type="file" accept=".trailmedia" hidden /></label></div>
    <details><summary>Prepare selected media for publication</summary>
      <p>Export selected attachments to share through the repository and public viewer. Pins, captions, dates and visible private details will be public.</p>
      <p>Import the downloaded archive into your checkout, then commit, push and publish a new site build. The download alone does not upload your media.</p>
      <label><input id="mediaStrip" type="checkbox" checked /> Strip photo metadata (re-encode JPEG; originals stay local)</label>
      <p class="muted">Video metadata stripping is not supported. Exclude videos, or explicitly allow originals below. Review faces, plates, and sensitive locations yourself.</p>
      <label><input id="mediaOriginals" type="checkbox" /> Allow originals with embedded metadata (required for videos or unstripped photos)</label>
      <button id="mediaPublish">Review and export selected</button></details>
    <div id="mediaEditor" hidden>
      <div class="section-heading"><h3 id="mediaEditorTitle">Place media</h3><button id="mediaClose">Close editor</button></div>
      <div id="mediaPreview"></div><p id="mediaMetadata" class="muted"></p>
      <form id="mediaForm">
        <label>Title<input id="mediaTitle" maxlength="200" /></label>
        <div class="media-coordinate-row"><label>Latitude<input id="mediaLat" type="number" step="any" min="-90" max="90" /></label>
          <label>Longitude<input id="mediaLon" type="number" step="any" min="-180" max="180" /></label></div>
        <div class="inline"><button id="mediaPick" type="button">Choose on map</button><button id="mediaShowDraft" type="button">Show draft pin</button><button id="mediaScrub" type="button">Use trail position</button><button id="mediaGPS" type="button">Use original GPS</button></div>
        <label>Or use a waypoint<select id="mediaWaypoint"><option value="">Choose waypoint…</option></select></label>
        <p class="muted">Click/tap the map or drag the gold draft pin. Coordinates also work without dragging. A pin may mark the subject, not the camera.</p>
        <label>Route association<select id="mediaAssociation"></select></label>
        <p id="mediaRouteHint" class="muted"></p><button id="mediaSnap" type="button">Snap to chosen route segment</button>
        <details id="mediaDetails"><summary>Optional details and coverage review</summary>
        <label>Caption / what to notice<textarea id="mediaCaption" maxlength="4000" rows="2"></textarea></label>
        <label>Recording date (optional)<input id="mediaDate" type="date" /></label>
        <label>View / travel direction<input id="mediaDirection" maxlength="200" /></label>
        <label>Observed conditions<input id="mediaConditions" maxlength="1000" /></label>
        <label>Video start (seconds)<input id="mediaStart" type="number" min="0" step="0.1" value="0" /></label>
        <label>Evidence for target (optional)<select id="mediaTarget"><option value="">No target</option></select></label>
        <label><input id="mediaVerified" type="checkbox" /> I reviewed this media and confirm it shows this target</label>
        <p class="muted">A location pin alone does not verify coverage, current conditions, or safe/legal access.</p>
        </details>
        <div class="inline media-save-actions"><button type="submit">Confirm location &amp; save</button><button id="mediaUnplaced" type="button">Keep unplaced</button><button id="mediaDelete" type="button">Delete attachment</button></div>
      </form>
    </div>
    <p id="mediaCount" class="muted"></p><div id="mediaList"></div>`;
  const status = (message) => { element("libraryStatus").textContent = message; };
  let store, items = [], published = [], selectedId = null, draft = null, dirty = false, previewURL = null;
  let picking = false, dragging = false, dragged = false, busy = false, candidates = [], lastNearby = "", openSequence = 0, importContext = null;
  const selected = new Set(), markers = [], geometryVersions = {};
  const draftMarker = viewer.entities.add({
    show: false, properties: { mediaDraft: true },
    point: { pixelSize: 17, color: Cesium.Color.GOLD, outlineWidth: 2, outlineColor: Cesium.Color.BLACK,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity },
  });
  for (const [route, profile] of Object.entries(profiles))
    geometryVersions[route] = await hashBlob(new Blob([JSON.stringify(profile.map(({ lon, lat, d }) => [lon, lat, d]))]));
  const points = [...waypoints, ...targets.filter((target) => !waypoints.some((waypoint) => waypoint.id === target.id))];
  element("mediaWaypoint").append(...points.map((point) => option(`${routes.find((route) => route.id === point.route)?.name} · ${point.title}`, point.id)));
  element("mediaTarget").append(...targets.map((target) => option(target.title, target.id)));
  const needsReview = (record) => !record.confirmed || !record.recorded_at || !record.coverage_verified ||
    (record.association && record.association.geometry_version !== geometryVersions[record.association.route]) ||
    Date.parse(record.recorded_at) < Date.now() - 365 * 86400000;
  const routeName = (id) => routes.find((route) => route.id === id)?.name || id;
  const pinDescription = (record) => !record.confirmed ? "Unplaced · location not confirmed" :
    `${record.pin.lat.toFixed(5)}, ${record.pin.lon.toFixed(5)}${record.association ? ` · ${routeName(record.association.route)} · ${(record.association.d / MI).toFixed(2)} mi` : " · map-only"}`;
  const visibleItems = () => {
    const filter = element("mediaFilter").value, context = getContext();
    return items.filter(({ record }) => filter === "all" ||
      (filter === "unplaced" && !record.confirmed) || (filter === "review" && needsReview(record)) ||
      (filter === "nearby" && record.confirmed && record.association?.route === context.route &&
        record.association.geometry_version === geometryVersions[context.route] && Math.abs(record.association.d - context.d) <= 250));
  };
  function renderList() {
    const visible = visibleItems();
    if (element("mediaFilter").value === "nearby") lastNearby = visible.map(({ record }) => record.id).join(",");
    element("mediaCount").textContent = `${visible.length} shown · ${items.filter(({ record }) => !record.confirmed).length} unplaced · ${selected.size} selected`;
    element("mediaList").innerHTML = visible.map(({ record, published }) => `<article class="media-card">
      <label><input type="checkbox" data-media-select="${record.id}" ${selected.has(record.id) ? "checked" : ""} /> Select</label>
      <button class="media-open" data-media-open="${record.id}">${escapeHTML(record.title || record.filename)}</button>
      <small>${published ? "Published · read-only" : "Private · local"} · ${record.type === "photo" ? "Photo" : "Video"} · ${escapeHTML(pinDescription(record))}</small>
      <small>${escapeHTML(record.recorded_at || "Recording date unknown")} · ${record.coverage_verified ? "Coverage reviewed" : "Coverage unverified"}${record.association && record.association.geometry_version !== geometryVersions[record.association.route] ? " · Route changed: reassociate" : ""}</small>
      ${record.confirmed ? `<button data-media-jump="${record.id}">Show pin</button>` : ""}</article>`).join("") || '<p class="muted">No media here yet. Add a few useful views of the trail.</p>';
    element("mediaList").querySelectorAll("[data-media-open]").forEach((button) => { button.onclick = () => openItem(button.dataset.mediaOpen); });
    element("mediaList").querySelectorAll("[data-media-select]").forEach((checkbox) => {
      checkbox.onchange = () => { if (checkbox.checked) selected.add(checkbox.dataset.mediaSelect); else selected.delete(checkbox.dataset.mediaSelect); renderList(); };
    });
    element("mediaList").querySelectorAll("[data-media-jump]").forEach((button) => {
      button.onclick = () => { const record = items.find((item) => item.record.id === button.dataset.mediaJump).record; flyToPin(record.pin); };
    });
  }
  function flyToPin(pin) {
    prepareMap();
    const position = Cesium.Cartesian3.fromDegrees(pin.lon, pin.lat);
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(position, 50), { duration: 0.6, offset: new Cesium.HeadingPitchRange(0, -Math.PI / 3, 800) });
  }
  function renderMarkers() {
    for (const marker of markers) viewer.entities.remove(marker);
    markers.length = 0;
    const groups = new Map();
    for (const { record } of items.filter(({ record }) => record.confirmed)) {
      const key = `${record.pin.lat.toFixed(6)},${record.pin.lon.toFixed(6)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    }
    for (const records of groups.values()) markers.push(viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(records[0].pin.lon, records[0].pin.lat),
      properties: { localMedia: records.map((record) => record.id) },
      point: { pixelSize: 13, color: Cesium.Color.CYAN, outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity },
      label: { text: `${records.length} ${records.length === 1 ? "attachment" : "attachments"}`, font: "12px sans-serif", showBackground: true,
        pixelOffset: new Cesium.Cartesian2(0, -22), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3000) },
    }));
    viewer.scene.requestRender();
  }
  function updateDraftMarker() {
    draftMarker.show = !!draft && validPin(draft.pin);
    if (draftMarker.show) draftMarker.position = Cesium.Cartesian3.fromDegrees(draft.pin.lon, draft.pin.lat);
    viewer.scene.requestRender();
  }
  function routeOptions() {
    candidates = routeCandidates(draft.pin, profiles);
    const association = draft.association;
    element("mediaAssociation").replaceChildren(option("Map-only · no route association", ""), ...candidates.map((candidate, index) =>
      option(`${routeName(candidate.route)} · ${(candidate.d / MI).toFixed(2)} mi · ${Math.round(candidate.offset)} m away (segment ${candidate.segment + 1})`, String(index))));
    const matched = candidates.findIndex((candidate) => candidate.route === association?.route && Math.abs(candidate.d - association.d) < 1);
    element("mediaAssociation").value = matched >= 0 ? String(matched) : "";
    if (matched < 0) draft.association = null;
    else draft.association = { ...candidates[matched], geometry_version: association.geometry_version };
    const ambiguous = candidates.length > 1 && candidates[1].offset < candidates[0].offset + 30;
    element("mediaRouteHint").textContent = !draft.pin ? "Choose a location first." :
      `${candidates[0]?.offset > 500 ? "This pin is far from the trail bundle. Keep it if intentional. " : ""}${ambiguous ? "Nearby routes or loop segments are ambiguous: choose the intended segment. " : ""}No automatic snapping. Select a route to associate it, or keep map-only.`;
    element("mediaSnap").disabled = !draft.association;
  }
  function setPin(pin, method, association = null) {
    draft.pin = pin; draft.placement_method = method; draft.association = association;
    dirty = true;
    element("mediaLat").value = pin?.lat ?? ""; element("mediaLon").value = pin?.lon ?? "";
    routeOptions(); updateDraftMarker();
  }
  function endPicking() {
    picking = false; element("mediaPick").textContent = "Choose on map";
    element("mediaPick").setAttribute("aria-pressed", "false");
    element("cesium").classList.remove("media-picking");
  }
  function closeEditor(force = false) {
    if (busy || (!force && dirty && !confirm("Discard unsaved edits to this attachment?"))) return false;
    endPicking();
    openSequence++;
    const video = element("mediaPreview").querySelector("video"); if (video) video.pause();
    element("mediaPreview").replaceChildren();
    if (previewURL) URL.revokeObjectURL(previewURL);
    previewURL = null; draft = null; selectedId = null; dirty = false;
    element("mediaEditor").hidden = true; updateDraftMarker(); return true;
  }
  async function materialize(item) {
    if (item.blob) return item;
    const response = await fetch(new URL(item.record.url, import.meta.url), { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Missing published file: ${item.record.filename}`);
    const blob = await response.blob();
    if (blob.size !== item.record.size || await hashBlob(blob) !== item.record.hash) throw new Error("Published media integrity check failed");
    item.blob = blob.slice(0, blob.size, item.record.mime);
    return item;
  }
  async function openItem(id) {
    if (!closeEditor()) return;
    const item = items.find((item) => item.record.id === id); if (!item) return;
    const sequence = openSequence;
    try { await materialize(item); } catch (error) { status(error.message); return; }
    if (sequence !== openSequence) return;
    selectedId = id; draft = structuredClone(item.record);
    showPanel(); element("mediaEditor").hidden = false;
    element("mediaForm").hidden = !!item.published;
    element("mediaEditorTitle").textContent = item.record.confirmed ? "View / move pin" : "Place media";
    const preview = document.createElement(draft.type === "photo" ? "img" : "video");
    previewURL = URL.createObjectURL(item.blob); preview.src = previewURL;
    if (draft.type === "photo") { preview.alt = draft.caption || draft.title || draft.filename; preview.onclick = () => window.open(previewURL, "_blank", "noopener"); }
    else { preview.controls = true; preview.preload = "metadata"; preview.onloadedmetadata = () => { if (draft && draft.start_seconds < preview.duration) preview.currentTime = draft.start_seconds; }; }
    preview.onerror = () => status("Playback failed in this browser. Keep the original backup and convert to JPEG/H.264 MP4 if needed.");
    element("mediaPreview").replaceChildren(preview);
    if (draft.type === "photo") {
      const full = document.createElement("a"); full.href = previewURL; full.target = "_blank"; full.rel = "noopener"; full.textContent = "Open full-size photo";
      element("mediaPreview").append(full);
    }
    element("mediaMetadata").textContent = `${draft.filename} · ${draft.metadata_status}${draft.original_gps ? ` Original GPS: ${draft.original_gps.lat.toFixed(6)}, ${draft.original_gps.lon.toFixed(6)}.` : ""}`;
    for (const [id, field] of Object.entries({ mediaTitle: "title", mediaCaption: "caption", mediaDirection: "direction", mediaConditions: "conditions", mediaStart: "start_seconds" })) element(id).value = draft[field];
    element("mediaDate").value = draft.recorded_at.slice(0, 10);
    element("mediaTarget").value = draft.target_id || ""; element("mediaVerified").checked = draft.coverage_verified === true;
    element("mediaGPS").disabled = !draft.original_gps;
    element("mediaStart").disabled = draft.type !== "video";
    element("mediaWaypoint").value = "";
    element("mediaLat").value = draft.pin?.lat ?? ""; element("mediaLon").value = draft.pin?.lon ?? "";
    routeOptions(); updateDraftMarker();
    if (item.published) { draftMarker.show = false; status("Published media is read-only. Back up and restore it to make a private editable copy."); }
    element("mediaEditor").scrollIntoView({ block: "start" });
    if (!item.published) element("mediaTitle").focus({ preventScroll: true });
  }
  async function reload() {
    const local = store ? await store.list() : [];
    items = [...local, ...published.filter((item) => !local.some(({ record }) => record.id === item.record.id))];
    items.sort((first, second) => (first.record.title || first.record.filename).localeCompare(second.record.title || second.record.filename));
    renderList(); renderMarkers();
  }
  async function run(operation) {
    if (busy) return;
    busy = true;
    element("library").setAttribute("aria-busy", "true");
    const controls = [...element("library").querySelectorAll("input,button,select,textarea")];
    const disabled = controls.map((control) => control.disabled);
    controls.forEach((control) => { control.disabled = true; });
    try { await operation(); } catch (error) { status(`${error.name === "QuotaExceededError" ? "Browser storage is full. Back up media and free space. " : ""}${error.message}`); }
    finally {
      busy = false; controls.forEach((control, index) => { control.disabled = disabled[index]; });
      element("library").setAttribute("aria-busy", "false");
    }
  }
  async function addFiles(files) {
    if (!store) { status("Media storage is unavailable. Enable browser storage and reload."); return; }
    if (dirty) { status("Save or close your edited attachment before adding files."); return; }
    let firstId = null;
    await run(async () => {
      const messages = [], context = importContext || getContext();
      importContext = null;
      for (const file of files) {
        status(`Checking ${file.name}…`);
        try {
          const metadata = await inspectMedia(file);
          const blob = file.slice(0, file.size, metadata.mime);
          await checkPlayback(blob, metadata.type);
          const hash = await hashBlob(blob);
          if (items.some((item) => !item.published && item.record.hash === hash)) { messages.push(`${file.name}: duplicate file skipped; existing pin retained.`); continue; }
          const record = {
            id: crypto.randomUUID(), trail, type: metadata.type, mime: metadata.mime, hash, size: file.size,
            filename: file.name, title: file.name, caption: "", direction: "", conditions: "", recorded_at: metadata.recorded_at || "",
            original_recorded_at: metadata.recorded_at || "", recorded_at_source: metadata.recorded_at ? "metadata" : "unknown",
            metadata_status: metadata.metadata_status, original_gps: metadata.gps || null,
            pin: metadata.gps || context.pin, confirmed: false, association: null,
            placement_method: metadata.gps ? "metadata" : context.method || "scrub", start_seconds: 0,
            target_id: "", coverage_verified: false, verified_at: "", updated_at: new Date().toISOString(),
          };
          await store.put(record, blob); items.push({ record, blob }); firstId ||= record.id;
          messages.push(`${file.name}: saved to Unplaced. ${metadata.metadata_status}`);
        } catch (error) { messages.push(`${file.name}: ${error.message}`); }
      }
      await reload(); status(messages.join("\n"));
    });
    if (firstId) openItem(firstId);
  }
  element("mediaFiles").onchange = () => { const files = [...element("mediaFiles").files]; element("mediaFiles").value = ""; addFiles(files); };
  element("mediaDrop").ondragover = (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; };
  element("mediaDrop").ondrop = (event) => { event.preventDefault(); if (!busy) addFiles([...event.dataTransfer.files]); };
  element("mediaClose").onclick = () => closeEditor();
  element("mediaForm").oninput = () => { dirty = true; };
  for (const id of ["mediaLat", "mediaLon"]) element(id).onchange = () => {
    try { setPin(coordinates(element("mediaLat").value, element("mediaLon").value), "manual"); }
    catch (error) { draft.pin = null; draft.association = null; routeOptions(); updateDraftMarker(); status(error.message); }
  };
  element("mediaAssociation").onchange = () => {
    const candidate = element("mediaAssociation").value === "" ? null : candidates[Number(element("mediaAssociation").value)];
    draft.association = candidate ? { ...candidate, geometry_version: geometryVersions[candidate.route] } : null;
    element("mediaSnap").disabled = !candidate; dirty = true;
  };
  element("mediaSnap").onclick = () => { const association = draft.association; if (association) setPin({ lat: association.lat, lon: association.lon }, "manual", association); };
  element("mediaGPS").onclick = () => { if (draft.original_gps) { setPin({ ...draft.original_gps }, "metadata"); flyToPin(draft.pin); } };
  element("mediaShowDraft").onclick = () => { if (validPin(draft.pin)) flyToPin(draft.pin); else status("Choose a location first."); };
  element("mediaScrub").onclick = () => {
    const context = getContext();
    const nearest = routeCandidates(context.pin, { [context.route]: profiles[context.route] }).sort((first, second) => Math.abs(first.d - context.d) - Math.abs(second.d - context.d))[0];
    setPin(context.pin, "scrub", { ...nearest, geometry_version: geometryVersions[context.route] });
  };
  element("mediaWaypoint").onchange = () => {
    const point = points.find((point) => point.id === element("mediaWaypoint").value);
    if (point) { setPin({ lat: point.lat, lon: point.lon }, "waypoint"); flyToPin(draft.pin); }
  };
  element("mediaPick").onclick = () => {
    if (picking) { endPicking(); return; }
    picking = true; prepareMap(); element("mediaPick").textContent = "Cancel map placement";
    element("mediaPick").setAttribute("aria-pressed", "true"); element("cesium").classList.add("media-picking");
    status("Click/tap the map to place the gold pin, then confirm and save. Escape cancels map placement.");
    element("mapArea").scrollIntoView({ block: "center" });
  };
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") endPicking(); });
  window.addEventListener("beforeunload", (event) => { if (dirty || busy) { event.preventDefault(); event.returnValue = ""; } });
  async function save(confirmed) {
    if (!draft) return;
    const record = structuredClone(draft), item = items.find((item) => item.record.id === selectedId);
    try {
      if (confirmed) {
        const pin = coordinates(element("mediaLat").value, element("mediaLon").value);
        if (!validPin(record.pin) || pin.lat !== record.pin.lat || pin.lon !== record.pin.lon) { record.association = null; record.placement_method = "manual"; }
        record.pin = pin;
      }
      for (const [id, field] of Object.entries({ mediaTitle: "title", mediaCaption: "caption", mediaDirection: "direction", mediaConditions: "conditions" })) record[field] = element(id).value;
      const date = element("mediaDate").value;
      if (date !== record.recorded_at.slice(0, 10)) record.recorded_at_source = date ? "manual" : "unknown";
      record.recorded_at = date === record.recorded_at.slice(0, 10) ? record.recorded_at : date;
      record.start_seconds = Number(element("mediaStart").value);
      const video = element("mediaPreview").querySelector("video");
      if (video && Number.isFinite(video.duration) && record.start_seconds >= video.duration) throw new Error("Video start must be before the end of the clip.");
      record.confirmed = confirmed;
      record.target_id = element("mediaTarget").value;
      record.coverage_verified = confirmed && element("mediaVerified").checked;
      if (record.coverage_verified && (!record.target_id || !record.recorded_at)) throw new Error("Choose a target and recording date before verifying coverage.");
      record.verified_at = record.coverage_verified ? new Date().toISOString() : "";
      if (!confirmed) { record.pin = null; record.association = null; record.placement_method = "unplaced"; }
      record.updated_at = new Date().toISOString();
      await run(async () => { await store.put(record, item.blob); dirty = false; await reload(); status(confirmed ? "Location saved locally. Original GPS preserved; nothing uploaded." : "Saved in Unplaced. Original GPS is still available."); });
      if (!dirty) { closeEditor(true); openItem(record.id); }
    } catch (error) { status(error.message); }
  }
  element("mediaForm").onsubmit = (event) => { event.preventDefault(); save(true); };
  element("mediaUnplaced").onclick = () => save(false);
  element("mediaDelete").onclick = async () => {
    if (!confirm("Delete this local attachment and its pin? Keep a backup if you need it later.")) return;
    await run(async () => { await store.remove(selectedId); selected.delete(selectedId); dirty = false; await reload(); });
    if (!dirty) closeEditor(true);
  };
  element("mediaFilter").onchange = renderList;
  element("mediaSelect").onclick = () => { visibleItems().forEach(({ record }) => selected.add(record.id)); renderList(); };
  element("mediaClear").onclick = () => { selected.clear(); renderList(); };
  element("mediaBatchPin").onclick = async () => {
    if (dirty) { status("Save or close the current edit before assigning a batch location."); return; }
    const chosen = items.filter((item) => selected.has(item.record.id) && !item.published), context = getContext();
    if (!chosen.length) { status("Select local attachments first. Published items cannot be moved."); return; }
    if (!confirm(`Pin ${chosen.length} selected attachment(s) at ${context.pin.lat.toFixed(6)}, ${context.pin.lon.toFixed(6)} on ${routeName(context.route)}? Previous pins will be replaced; original GPS stays unchanged. Coverage verification will be cleared.`)) return;
    const candidate = routeCandidates(context.pin, { [context.route]: profiles[context.route] }).sort((first, second) => Math.abs(first.d - context.d) - Math.abs(second.d - context.d))[0];
    closeEditor(true);
    await run(async () => {
      const messages = [];
      for (const { record, blob } of chosen) {
        try {
          await store.put({ ...record, pin: context.pin, confirmed: true, placement_method: "scrub",
            association: { ...candidate, geometry_version: geometryVersions[context.route] }, coverage_verified: false, verified_at: "", updated_at: new Date().toISOString() }, blob);
          messages.push(`${record.filename}: pinned.`);
        } catch (error) { messages.push(`${record.filename}: ${error.message}`); }
      }
      await reload(); status(messages.join("\n"));
    });
  };
  element("mediaBackup").onclick = () => run(async () => {
    const chosen = selected.size ? items.filter(({ record }) => selected.has(record.id)) : items;
    for (const item of chosen) await materialize(item);
    downloadBlob(`${trail}-media.trailmedia`, await createArchive(chosen, trail));
    status("Backup downloaded: original files and saved pins. Unsaved editor changes are not included. Store a copy outside this browser.");
  });
  element("mediaRestore").onchange = async () => {
    const file = element("mediaRestore").files[0]; element("mediaRestore").value = ""; if (!file) return;
    await run(async () => {
      const archive = await readArchive(file, trail), messages = [];
      for (const item of archive.items) {
        const existing = items.find(({ record, published }) => !published && (record.id === item.record.id || record.hash === item.record.hash));
        if (existing) { messages.push(`${item.record.filename}: duplicate/conflict skipped; local version kept.`); continue; }
        try { await store.put(item.record, item.blob); items.push(item); messages.push(`${item.record.filename}: restored.`); }
        catch (error) { messages.push(`${item.record.filename}: ${error.message}`); }
      }
      await reload(); status(messages.join("\n") || "Archive contained no media.");
    });
  };
  element("mediaPublish").onclick = () => run(async () => {
    const chosen = items.filter(({ record }) => selected.has(record.id));
    if (!chosen.length || chosen.some(({ record }) => !record.confirmed)) throw new Error("Select confirmed, saved media only for publication.");
    const strip = element("mediaStrip").checked, originals = element("mediaOriginals").checked;
    if (chosen.some(({ record }) => record.type === "video" || !strip) && !originals) throw new Error("Exclude videos or explicitly allow originals with embedded metadata.");
    if (!confirm(`Export these PUBLIC locations and descriptions?\n${chosen.map(({ record }) => `${record.title}: ${pinDescription(record)}`).join("\n")}\nReview visible private details before deploying.`)) return;
    const publication = [];
    for (const item of chosen) {
      await materialize(item);
      const record = structuredClone(item.record); let blob = item.blob;
      if (strip && record.type === "photo") {
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
        const context = canvas.getContext("2d"); context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0); bitmap.close();
        blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
        if (!blob) throw new Error("Photo conversion failed; nothing exported.");
        record.mime = "image/jpeg"; record.filename = `${record.id}.jpg`;
      }
      record.original_gps = null; record.original_recorded_at = ""; record.metadata_status = "Published location approved by owner.";
      record.hash = await hashBlob(blob); record.size = blob.size;
      publication.push({ record, blob });
    }
    downloadBlob(`${trail}-publication.trailmedia`, await createArchive(publication, trail, "publication"));
    status(`Publication archive downloaded. To save it in the shared repository, run: py tools/pipeline/import_media.py "PATH/TO/${trail}-publication.trailmedia" --trail ${trail}. Then commit/push the media and deploy a normal site package. See the media guide for steps.`);
  });
  const mapPin = (position) => {
    const ray = viewer.camera.getPickRay(position);
    const cartesian = ray && viewer.scene.globe.pick(ray, viewer.scene);
    if (!cartesian) return null;
    const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
    return { lat: Cesium.Math.toDegrees(cartographic.latitude), lon: Cesium.Math.toDegrees(cartographic.longitude) };
  };
  let selectedMapPin = null;
  element("addMapMedia").onclick = () => {
    if (!selectedMapPin) return;
    importContext = { ...getContext(), pin: selectedMapPin, method: "manual" };
    showPanel(); element("mediaFiles").focus(); element("addMapMedia").hidden = true;
    status(`New files will start at ${selectedMapPin.lat.toFixed(6)}, ${selectedMapPin.lon.toFixed(6)} unless they have GPS. Review every pin before saving.`);
  };
  viewer.screenSpaceEventHandler.setInputAction((event) => {
    const properties = viewer.scene.pick(event.position)?.id?.properties;
    const editable = properties?.mediaDraft?.getValue() || properties?.localMedia?.getValue()?.includes(selectedId);
    if (!draft || busy || element("mediaForm").hidden || !editable) return;
    dragging = true; dragged = false; viewer.scene.screenSpaceCameraController.enableInputs = false;
  }, Cesium.ScreenSpaceEventType.LEFT_DOWN);
  viewer.screenSpaceEventHandler.setInputAction((event) => {
    if (!dragging) return;
    const pin = mapPin(event.endPosition); if (pin) { setPin(pin, "manual"); dragged = true; }
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  const releaseDrag = () => {
    if (dragging) {
      dragging = false; viewer.scene.screenSpaceCameraController.enableInputs = true;
      setTimeout(() => { dragged = false; }, 0);
    }
  };
  viewer.screenSpaceEventHandler.setInputAction(releaseDrag, Cesium.ScreenSpaceEventType.LEFT_UP);
  window.addEventListener("pointerup", releaseDrag); window.addEventListener("blur", releaseDrag);
  try {
    const response = await fetch(new URL("published-media.json", import.meta.url), { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = await response.json();
    if (manifest.schema_version !== 1 || !Array.isArray(manifest.records)) throw new Error("Invalid published media manifest");
    if (manifest.trail === trail) for (const record of manifest.records) {
      validateRecord(record);
      if (record.trail !== trail || !record.confirmed || !/^published-media\/[a-f0-9-]{36}(?:-[a-f0-9]{64})?\.(jpg|png|webp|mp4|mov|webm)$/.test(record.url)) throw new Error("Invalid published media path");
      published.push({ record, published: true });
    }
  } catch (error) { status(`Published media unavailable: ${error.message}`); }
  try { store = await openMediaStore(trail); await reload(); }
  catch (error) { await reload(); status(`Media storage unavailable: ${error.message}. Enable browser storage and reload; the trail viewer still works.`); }
  return {
    open: (context = null) => { importContext = context; showPanel(); element("mediaFiles").focus(); },
    refreshNearby: () => {
      if (element("mediaFilter").value !== "nearby") return;
      const key = visibleItems().map(({ record }) => record.id).join(",");
      if (lastNearby !== key) { lastNearby = key; renderList(); }
    },
    handleClick: (event) => {
      if (dragged) { dragged = false; return true; }
      if (picking && draft && !busy) {
        const pin = mapPin(event.position);
        if (pin) { setPin(pin, "manual"); endPicking(); status("Pin placed. Review coordinates and route, then confirm and save."); }
        else status("No ground under that point. Click the map surface or enter coordinates.");
        return true;
      }
      const ids = viewer.scene.pick(event.position)?.id?.properties?.localMedia?.getValue();
      if (!ids) {
        selectedMapPin = mapPin(event.position);
        element("addMapMedia").hidden = !selectedMapPin;
        return false;
      }
      const current = ids.indexOf(selectedId); openItem(ids[(current + 1) % ids.length]);
      status(`${ids.length} attachment(s) at this pin. Click the marker again to cycle; all are listed below.`);
      return true;
    },
  };
}
