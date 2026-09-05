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
