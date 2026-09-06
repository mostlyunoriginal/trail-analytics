# NOTES — user ↔ agents

> Logged from Ringboard (`tools/ringboard/`). **Agents: at session start, act on every
> note with `status: open`:**
> - `response-requested: yes` → write a `**Response (Claude, YYYY-MM-DD):** …` line in the
>   entry body, then change the entry's line to `status: responded`.
> - otherwise → handle it, add a brief `**Action (Claude, YYYY-MM-DD):** …` line, then
>   change to `status: addressed`.
> The user sets `status: closed` (from the board) when satisfied, and may reopen. Never
> delete entries; this file is an audit trail. Attachments live in `NoteAttachments/`.

---

## N0bd93a8 — 2026-09-05 13:12 — Phase 0
- status: addressed
- response-requested: no
- task-index: 5
- re: "GATE — go/no-go on stack and architecture (major decision point)"

let's go!

**Action (Claude, 2026-09-05):** Ran the full Phase 0 spike. All five data tasks done and
checked off; findings + GO recommendation in `data/bunce-school-road/spike-report.md`.
The gate itself (task 5) awaits the user's call.

## N7b2941d — 2026-09-05 14:15 — Phase 1
- status: addressed
- response-requested: no

log for a future enhancement: add a snap back to defaults button for all sliders

**Action (Claude, 2026-09-05):** Implemented directly rather than just logging — the viewer
now has a ↺ reset button (view mode, look°, range, exaggeration back to defaults). Shipped
with the Phase 2 viewer update.

## N3525385 — 2026-09-05 14:37 — Phase 1
- status: addressed
- response-requested: no
- task-index: 1
- re: "Viewer: scrub along trail, perspective controls, layer toggles (visual check passed 2026-0"

log future enhancement: ability to toggle off right side pane

**Action (Claude, 2026-09-05):** Implemented with the multi-route update — the media pane
now has an × close button, and a "media" checkbox in the layers row re-enables it.

## N67a5d85 — 2026-09-05 14:43 — Phase 1
- status: addressed
- response-requested: no
- task-index: 1
- re: "Viewer: scrub along trail, perspective controls, layer toggles (visual check passed 2026-0"

i'm finding that i like to change range with my mouse wheel which zooms me out much further than the range slider supports. when i'm zoomed out like that, i'd like to be able to reorient the map laterally. also, when i'm zoomed out, touching any of the sliders zooms me back in, which is not quite right. maybe there should be a completely separate 'global view' that just supports this? clicking 'global view' puts me into complete zoom out (but i can still zoom in our out) and gives lateral shifting controls and elevation angle control, but it wouldn't support follow, for example. toggling out of global would take me to what we have now, where follow view and the current sliders make sense.

**Action (Claude, 2026-09-05):** Implemented as designed — a "global" option in the view
selector. Entering it releases the trail lock and flies out to frame the whole bundle;
Cesium's free camera then owns the view (drag = lateral shift, wheel = zoom, ctrl or
middle-drag = elevation angle). Sliders that don't apply (look°, range) gray out and no
control touches the camera, so nothing snaps you back in. Scrub/▶ still work, driving a
cyan position marker so you can watch the run from above. Switching back to follow/fixed/
top re-locks to the trail.

