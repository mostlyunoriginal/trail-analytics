# Ringboard

Local dashboard for any project tracked in a plan file (`DEFAULT_PLAN` in `ringboard.py`,
default `PLAN.md`; override per run with `--plan`): one progress ring per phase
(fill = task completion rolled up through any subtask nesting; color = schedule health by
default, toggleable to a completion ramp), an **On deck** panel showing the next task per
owner, a phase-window timeline, click-through detail panels with a **notes-to-agents** loop,
and in-place drill-down into nested plan levels. Stdlib Python only — nothing to install,
nothing leaves 127.0.0.1.

## Run

```
py tools\ringboard\ringboard.py          # or double-click ringboard.cmd
```

`ringboard.cmd` exists in two places: the real launcher here in `tools/ringboard/` (sets the
console title, pauses on error) and a two-line shim at the repo root that calls it — installed
from `ringboard.root.cmd` so the board starts with a double-click at the workspace root.

Opens http://127.0.0.1:8347/ in the browser (`DEFAULT_PORT` — give each concurrently-run
project its own port; on Windows two boards on one port silently steal each other's
requests, so the server refuses to share). Flags: `--root <repo>` (default: two levels up
from the script), `--plan <file>`, `--port`, `--no-open`. The board re-reads the plan file
every few seconds, so checkbox edits show up live.

## Plan-file conventions the parser reads

- **Phases:** `## Phase N — Name (anything in a trailing paren is dropped from display)`
- **Tasks:** lines starting `- [ ]` open · `- [x]` done · `- [~]` in progress (counts ½) · `- [!]` blocked
- **Subtasks (optional, any depth):** indent a `- [ ]` item two spaces per level under its
  parent task. Progress rolls up: a leaf counts by its own status; a parent's fraction is
  the mean of its children's. A parent's own checkbox is a human-maintained summary — the
  board derives the number from the leaves.
- **Owners:** `[L]` `[JS]` `[C]` `[M]` `[PD]` tokens anywhere in the task line become chips
  (the known set lives in `OWNER_RE` + `clean_task_text` in `ringboard.py` — extend both
  for a new project role)
- **Gates:** a task containing `major decision point` or `GATE` gets a gate chip
- **Annotations** (HTML comments — invisible in rendered Markdown):
  - global, anywhere above the first phase heading:
    `<!-- ringboard: title="Board title" deadline=2026-10-31 tick="2026-09-04 modeling gate" -->`
    (repeat `tick=` for more milestone markers)
  - per phase, on its own line directly under the heading:
    `<!-- ringboard: window=2026-09-01..2026-09-18 blocker="what's blocking" -->`
  - per task, **inline at the end of the task line** (gives a subtask its own window/blocker
    for the drilled-in timeline and schedule health):
    `- [ ] Field pilot <!-- ringboard: window=2026-09-10..2026-09-14 -->`

Everything else in the plan file is ignored, so the file stays human-first — the tracker
section can live inside a larger design document (e.g. a `## Execution tracker` section
appended to a `REFACTOR_PLAN.md`, with `DEFAULT_PLAN` pointed at that file).

## Navigating nested plans

The top board shows one ring per phase. A ring whose tasks have subtasks **of their own**
(two or more levels beneath it) drills down in place when clicked: the rings become that
node's children, the header shows a breadcrumb (each segment clickable), the On deck panel
and timeline re-scope to that level, and the URL hash tracks the level so browser
back/forward work. A ring with at most one level beneath it opens the side detail panel,
exactly like a flat board. Escape closes the panel, then climbs one level per press.

## On deck (next task per owner)

The panel to the right of the rings shows, for each owner chip found in the current view,
the single next task in plan order: the first in-progress task, else the first open one,
else the first blocked one. When a matched task has subtasks carrying the same owner, the
selection descends into them (preferring in-progress > open > blocked), so the row names
concrete work — and a candidate that resolves to *blocked* work is skipped when a later,
actionable one exists (blocked shows only when everything is). Clicking a
row opens the containing detail panel; **+ note** opens it with the note composer already
targeted at that task. Keep checkbox statuses truthful and the panel answers "what's up
next for me?" at a glance.

## Notes lifecycle (NOTES.md)

Notes logged from the board append to `NOTES.md` at the repo root; attachments are saved
to `NoteAttachments/` and linked from the entry. Entry format:

```
## N3f9c2ab — 2026-09-02 14:22 — Phase 1
- status: open
- response-requested: yes
- re: "task excerpt"
- attachments: NoteAttachments/N3f9c2ab_file.pdf

Note text.
```

A note logged on a specific task also carries `- task-index: 3` (top-level task) or
`- task-path: 3.1.0` (nested task, one 0-based index per level). Ids are random 7-hex
tokens (git-style), so notes logged concurrently in different clones of a shared repo never
collide — merge conflicts from simultaneous appends resolve by keeping both entries, no
renumbering. Legacy numeric ids (`N7`) still parse.

Status flow: **open** → agent sets **addressed** (with an `**Action (Claude, date):**` line)
or, when `response-requested: yes`, **responded** (with a `**Response (Claude, date):**`
line) → the user sets **closed** from the board (or reopens). Entries are never deleted.
The agent-side protocol lives in the NOTES.md header and the repo CLAUDE.md.

## Automatic nudge for ongoing agents

`notes_nudge.py` is wired as a Claude Code **UserPromptSubmit hook** (`.claude/settings.json`):
every prompt sent in this workspace first runs the script, and if NOTES.md has `status: open`
notes it injects a one-line reminder (with a ⚑ count for response-requested ones) into the
agent's context. Silent when there is nothing open; never blocks a prompt. So mid-conversation
agents learn about new notes on your next message — no re-instantiation, no manual nudge.
Review or disable it anytime via `/hooks`.

## Shareable snapshot (artifact)

`py tools\ringboard\make_snapshot.py [root] [out.html] [plan]` embeds the current
plan-file + NOTES.md state into
`snapshot.template.html` and writes a self-contained, read-only page (default: system temp).
Publish it as a Claude artifact, **reusing the project's existing artifact URL** so shared
links never break (this project's: see HANDOFF.md). Attachments appear by name only — their
content never leaves the repo. Regenerate + republish whenever the shared view should refresh.

## Standing this up in a new project

Use the **`/ringboard` skill** (`~/.claude/skills/ringboard/`) — tell a fresh agent the
workspace should be managed with Ringboard and it builds PLAN.md to the conventions above,
then installs this whole kit (tools, NOTES.md, CLAUDE.md protocol, nudge hook) from the
skill's bundled assets. Manual fallback: copy this folder, follow the conventions above, add
the NOTES.md check to CLAUDE.md, merge the `UserPromptSubmit` hook into `.claude/settings.json`,
run `py tools\ringboard\ringboard.py`.

**Canonical source:** the skill's `assets/` bundle is the master template; this folder is a
project instance (per-project knobs: `DEFAULT_PLAN` and `DEFAULT_PORT` at the top of
`ringboard.py`). Improvements made here should be ported back to
`~/.claude/skills/ringboard/assets/` so future projects inherit them.
