#!/usr/bin/env python3
"""Ringboard — local dashboard for plan-file progress + notes-to-agents.

Stdlib only; nothing to install. Run:

    py ringboard.py                 # auto-detects repo root two levels up, opens browser
    py ringboard.py --root C:\\git\\my-project --port 8347 --no-open
    py ringboard.py --plan OTHER_PLAN.md   # override the plan file (default: DEFAULT_PLAN below)

Parses the plan file live on every request (the board polls, so ticking a checkbox in the
file shows up within seconds). Tasks may nest: indented `- [ ]` items become subtasks to
any depth, and the board renders each level as its own ring view. Notes logged from the
board append to NOTES.md at the repo root; attachments are saved under NoteAttachments/.
Binds 127.0.0.1 only. Conventions the parser expects: see README.md in this folder.
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import re
import secrets
import sys
import threading
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

LOCK = threading.Lock()
MAX_ATTACH = 25 * 1024 * 1024

# Per-project config: the plan file the board drives off (repo-root-relative) and the
# port it serves on (give each concurrently-run project its own port).
DEFAULT_PLAN = "PLAN.md"
DEFAULT_PORT = 8350

# ---------------------------------------------------------------- plan file

PHASE_RE = re.compile(r"^##\s+Phase\s+(\d+)\s*[—–-]\s*(.*)$")
HEADING_RE = re.compile(r"^#{1,2}\s")
TASK_RE = re.compile(r"^(\s*)- \[( |x|~|!)\] (.*)$")
ANNOT_RE = re.compile(r"<!--\s*ringboard:\s*(.*?)\s*-->")
KV_RE = re.compile(r'([\w-]+)=(?:"([^"]*)"|(\S+))')
OWNER_RE = re.compile(r"\[(L|JS|C|M|PD)\]")
GATE_RE = re.compile(r"major decision point|\bGATE\b", re.IGNORECASE)
STATUS = {" ": "open", "x": "done", "~": "prog", "!": "blocked"}


def annot_pairs(s: str):
    return [(k, vq if vq else vb) for k, vq, vb in KV_RE.findall(s)]


def clean_task_text(raw: str) -> str:
    txt = re.sub(r"\*\([^)]*\)\*", "", raw)        # italic asides: *(major decision point)*
    txt = re.sub(r"`(?:\[[A-Z]+\])+`", "", txt)    # owner chunks: `[C][L]`
    txt = re.sub(r"\[(?:L|JS|C|M|PD)\]", "", txt)
    txt = txt.replace("**", "").replace("`", "")
    txt = re.sub(r"\s+", " ", txt).strip()
    txt = re.sub(r"\s*\d{4}-\d{2}-\d{2}$", "", txt)  # trailing completion date
    return txt.strip(" ;—–-").strip()


def parse_plan(root: Path, plan: str | None = None):
    plan = plan or DEFAULT_PLAN
    text = (root / plan).read_text(encoding="utf-8")
    title_m = re.search(r"^# (.+)$", text, re.MULTILINE)
    meta = {"title": title_m.group(1).strip() if title_m else plan,
            "plan": plan, "deadline": None, "ticks": []}
    phases, cur = [], None
    stack: list[tuple[int, dict]] = []   # (indent, task node) — open nesting chain
    last_task = None                     # most recent task node, for wrapped continuations
    for line in text.splitlines():
        pm = PHASE_RE.match(line)
        if pm:
            name = re.sub(r"\s*\([^()]*\)\s*$", "", pm.group(2)).strip()
            cur = {"id": int(pm.group(1)), "name": name, "start": None, "end": None,
                   "blocker": None, "desc": [], "tasks": []}
            phases.append(cur)
            stack, last_task = [], None
            continue
        tm = TASK_RE.match(line.expandtabs(4)) if cur is not None else None
        if tm:
            raw = tm.group(3)
            node = {"s": STATUS[tm.group(2)], "t": "", "o": [], "gate": False,
                    "start": None, "end": None, "blocker": None, "c": []}
            # an inline annotation on the task line applies to the task itself
            am = ANNOT_RE.search(raw)
            if am:
                for k, v in annot_pairs(am.group(1)):
                    if k == "window":
                        a, _, b = v.partition("..")
                        node["start"], node["end"] = a.strip(), b.strip()
                    elif k == "blocker":
                        node["blocker"] = v
                raw = ANNOT_RE.sub("", raw)
            for o in OWNER_RE.findall(raw):
                if o not in node["o"]:
                    node["o"].append(o)
            node["t"] = clean_task_text(raw)
            node["gate"] = bool(GATE_RE.search(raw))
            indent = len(tm.group(1))
            while stack and stack[-1][0] >= indent:   # pop siblings/deeper levels
                stack.pop()
            (stack[-1][1]["c"] if stack else cur["tasks"]).append(node)
            stack.append((indent, node))
            last_task = node
            continue
        am = ANNOT_RE.search(line)
        if am:
            for k, v in annot_pairs(am.group(1)):
                if cur is None:
                    if k == "deadline":
                        meta["deadline"] = v
                    elif k == "title":
                        meta["title"] = v
                    elif k == "tick":
                        d, _, label = v.partition(" ")
                        meta["ticks"].append({"d": d, "label": label.strip() or d})
                else:
                    if k == "window":
                        a, _, b = v.partition("..")
                        cur["start"], cur["end"] = a.strip(), b.strip()
                    elif k == "blocker":
                        cur["blocker"] = v
            continue
        if HEADING_RE.match(line):
            cur, stack, last_task = None, [], None
            continue
        if cur is None:
            continue
        # hard-wrapped continuation of the previous task (indented, not a new bullet)
        if line.startswith("  ") and line.strip() and last_task is not None \
                and not line.lstrip().startswith("- "):
            t = last_task
            frag = clean_task_text(line)
            if frag:
                t["t"] = (t["t"] + " " + frag).strip()
            for o in OWNER_RE.findall(line):
                if o not in t["o"]:
                    t["o"].append(o)
            t["gate"] = t["gate"] or bool(GATE_RE.search(line))
            continue
        st = line.strip()
        if st and not st.startswith(("|", ">", "---")):
            cur["desc"].append(re.sub(r"[*`]", "", st))
    for p in phases:
        p["desc"] = " ".join(p["desc"]).strip() or None
    return meta, phases


# ---------------------------------------------------------------- NOTES.md

NOTES_HEADER = """# NOTES — user ↔ agents

> Logged from Ringboard (`tools/ringboard/`). **Agents: at session start, act on every
> note with `status: open`:**
> - `response-requested: yes` → write a `**Response (Claude, YYYY-MM-DD):** …` line in the
>   entry body, then change the entry's line to `status: responded`.
> - otherwise → handle it, add a brief `**Action (Claude, YYYY-MM-DD):** …` line, then
>   change to `status: addressed`.
> The user sets `status: closed` (from the board) when satisfied, and may reopen. Never
> delete entries; this file is an audit trail. Attachments live in `NoteAttachments/`.

---
"""

# Ids are random 7-hex tokens (git-style) so notes logged concurrently in different
# clones of a shared repo never collide; legacy numeric ids (N7) still parse.
NOTE_HEAD_RE = re.compile(r"^## N(\w+) — (.+?) — (.+)$", re.MULTILINE)
NOTE_META_KEYS = ("status", "response-requested", "task-index", "task-path", "re", "attachments")


def parse_notes(root: Path):
    path = root / "NOTES.md"
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8")
    heads = list(NOTE_HEAD_RE.finditer(text))
    notes = []
    for i, h in enumerate(heads):
        end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
        meta, body, in_body = {}, [], False
        for ln in text[h.end():end].splitlines():
            m = None if in_body else re.match(r"^- ([\w-]+): ?(.*)$", ln)
            if m and m.group(1) in NOTE_META_KEYS:
                meta[m.group(1)] = m.group(2).strip()
            elif ln.strip() or body:
                in_body = True
                body.append(ln)
        pm = re.match(r"Phase (\d+)", h.group(3).strip())
        ti = meta.get("task-index", "")
        tp = meta.get("task-path", "")
        if tp and all(x.isdigit() for x in tp.split(".")):
            task_path = [int(x) for x in tp.split(".")]
        elif ti.isdigit():
            task_path = [int(ti)]
        else:
            task_path = None
        notes.append({
            "id": h.group(1),
            "seq": i,  # file order — the display sort key alongside ts, since ids don't order
            "ts": h.group(2).strip(),
            "phase": int(pm.group(1)) if pm else None,
            "status": meta.get("status", "open"),
            "needs_response": meta.get("response-requested", "no").lower().startswith("y"),
            # task_path locates the task within its phase (nested = one index per level);
            # task_index kept for older templates that only know flat plans.
            "task_path": task_path,
            "task_index": task_path[0] if task_path and len(task_path) == 1 else None,
            "task_ref": meta.get("re", "").strip('"'),
            "attachments": [a.strip() for a in meta.get("attachments", "").split(";") if a.strip()],
            "text": "\n".join(body).strip(),
        })
    return notes


def save_attachment(root: Path, nid: str, name: str, data_b64: str) -> str:
    data = base64.b64decode(data_b64)
    if len(data) > MAX_ATTACH:
        raise ValueError(f"attachment {name} exceeds 25 MB")
    safe = re.sub(r"[^\w.\- ]+", "_", Path(name).name).strip() or "file"
    att_dir = root / "NoteAttachments"
    att_dir.mkdir(exist_ok=True)
    p, n = att_dir / f"N{nid}_{safe}", 1
    while p.exists():
        p = att_dir / f"N{nid}_{n}_{safe}"
        n += 1
    p.write_bytes(data)
    return p.relative_to(root).as_posix()


def append_note(root: Path, payload: dict) -> str:
    with LOCK:
        taken = {n["id"] for n in parse_notes(root)}
        nid = secrets.token_hex(4)[:7]
        while nid in taken:
            nid = secrets.token_hex(4)[:7]
        atts = [save_attachment(root, nid, f.get("name", "file"), f.get("data", ""))
                for f in payload.get("files", [])]
        ctx = "General" if payload.get("phase") is None else f"Phase {payload['phase']}"
        ts = datetime.now().strftime("%Y-%m-%d %H:%M")
        lines = [f"## N{nid} — {ts} — {ctx}",
                 "- status: open",
                 f"- response-requested: {'yes' if payload.get('needs_response') else 'no'}"]
        tp = payload.get("task_path")
        if tp is None and payload.get("task_index") is not None:
            tp = [payload["task_index"]]
        if tp:
            tp = [int(x) for x in tp]
            if len(tp) == 1:   # flat reference — legacy-readable form
                lines.append(f"- task-index: {tp[0]}")
            else:              # nested reference — one 0-based index per level
                lines.append("- task-path: " + ".".join(str(x) for x in tp))
        if payload.get("task_ref"):
            lines.append('- re: "' + payload["task_ref"].replace('"', "'")[:100] + '"')
        if atts:
            lines.append("- attachments: " + "; ".join(atts))
        text = (payload.get("text") or "").strip() or ("(see attachment)" if atts else "")
        if not text:
            raise ValueError("empty note")
        entry = "\n".join(lines) + "\n\n" + text + "\n\n"
        path = root / "NOTES.md"
        base = path.read_text(encoding="utf-8") if path.exists() else NOTES_HEADER
        if not base.endswith("\n\n"):
            base = base.rstrip("\n") + "\n\n"
        path.write_text(base + entry, encoding="utf-8")
        return nid


def set_note_status(root: Path, nid: str, status: str):
    if status not in ("open", "closed"):
        raise ValueError("the board can only set status open/closed")
    with LOCK:
        path = root / "NOTES.md"
        text = path.read_text(encoding="utf-8")
        heads = list(NOTE_HEAD_RE.finditer(text))
        for i, h in enumerate(heads):
            if h.group(1) != nid:
                continue
            end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
            seg, n = re.subn(r"(?m)^- status: .*$", f"- status: {status}",
                             text[h.end():end], count=1)
            if n == 0:
                raise ValueError(f"note N{nid} has no status line")
            path.write_text(text[:h.end()] + seg + text[end:], encoding="utf-8")
            return
        raise ValueError(f"note N{nid} not found")


# ---------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    server_version = "Ringboard/1.1"
    root: Path
    board: Path
    plan: str = DEFAULT_PLAN

    def log_message(self, fmt, *args):  # keep the console quiet
        pass

    def _send(self, code: int, data: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _json(self, obj, code: int = 200):
        self._send(code, json.dumps(obj).encode("utf-8"), "application/json; charset=utf-8")

    def do_GET(self):
        try:
            if self.path in ("/", "/index.html"):
                self._send(200, self.board.read_bytes(), "text/html; charset=utf-8")
            elif self.path == "/api/state":
                meta, phases = parse_plan(self.root, self.plan)
                self._json({**meta, "phases": phases, "notes": parse_notes(self.root)})
            elif self.path.startswith("/files/"):
                rel = unquote(self.path[len("/files/"):])
                target = (self.root / rel).resolve()
                att = (self.root / "NoteAttachments").resolve()
                if not (target.is_file() and att in target.parents):
                    return self._json({"error": "not found"}, 404)
                ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
                self._send(200, target.read_bytes(), ctype)
            else:
                self._json({"error": "not found"}, 404)
        except Exception as e:  # surface parse errors to the board rather than dying
            self._json({"error": str(e)}, 500)

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
            if n > 40 * 1024 * 1024:
                return self._json({"error": "payload too large"}, 413)
            payload = json.loads(self.rfile.read(n) or b"{}")
            if self.path == "/api/notes":
                self._json({"ok": True, "id": append_note(self.root, payload)})
            elif self.path == "/api/notes/status":
                set_note_status(self.root, str(payload["id"]), payload["status"])
                self._json({"ok": True})
            else:
                self._json({"error": "not found"}, 404)
        except Exception as e:
            self._json({"error": str(e)}, 400)


def main():
    ap = argparse.ArgumentParser(description="Ringboard — plan-file dashboard + notes-to-agents")
    ap.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2],
                    help="repo root containing the plan file (default: two levels up from this script)")
    ap.add_argument("--plan", default=DEFAULT_PLAN,
                    help=f"plan file name, repo-root-relative (default: {DEFAULT_PLAN})")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--no-open", action="store_true", help="don't open the browser on start")
    a = ap.parse_args()
    root = a.root.resolve()
    if not (root / a.plan).exists():
        raise SystemExit(f"No {a.plan} found in {root} — pass --root <repo> / --plan <file>")
    Handler.root = root
    Handler.plan = a.plan
    Handler.board = Path(__file__).resolve().parent / "board.html"
    # On Windows, allow_reuse_address lets a second server silently bind an in-use port
    # and steal connections from the first — fail loudly instead. (ASCII-only prints:
    # redirected stdout may be cp1252, where fancy arrows raise UnicodeEncodeError.)
    ThreadingHTTPServer.allow_reuse_address = sys.platform != "win32"
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    url = f"http://127.0.0.1:{a.port}/"
    print(f"Ringboard: {root / a.plan}  ->  {url}   (Ctrl+C to stop)")
    if not a.no_open:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
