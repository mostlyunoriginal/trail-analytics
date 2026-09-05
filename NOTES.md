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

