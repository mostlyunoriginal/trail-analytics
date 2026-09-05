#!/usr/bin/env python3
"""Generate a read-only, self-contained snapshot of the Ringboard for artifact publishing.

Embeds the current PLAN.md + NOTES.md state into snapshot.template.html (no server needed --
imports the parser from ringboard.py). Attachments appear by name only; their content never
leaves the repo.

    py make_snapshot.py [root] [out.html] [plan]

Defaults: root = two levels up from this script; out = <system temp>/ringboard_snapshot.html;
plan = ringboard.DEFAULT_PLAN. Publish the output as an Artifact, reusing the project's
existing artifact URL (see README).
"""
import datetime
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ringboard  # noqa: E402


def main():
    here = Path(__file__).resolve().parent
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else here.parents[1]
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else \
        Path(tempfile.gettempdir()) / "ringboard_snapshot.html"
    plan = sys.argv[3] if len(sys.argv) > 3 else ringboard.DEFAULT_PLAN
    meta, phases = ringboard.parse_plan(root, plan)
    state = {**meta, "phases": phases, "notes": ringboard.parse_notes(root)}
    tpl = (here / "snapshot.template.html").read_text(encoding="utf-8")
    html = tpl.replace("__STATE__", json.dumps(state).replace("</", "<\\/"))
    html = html.replace("__SNAP__", datetime.datetime.now().strftime("%Y-%m-%d %H:%M"))
    html = html.replace("__PLAN__", plan)
    html = html.replace("__TITLE__", meta.get("title", "Project"))
    out.write_text(html, encoding="utf-8")
    print(out)


if __name__ == "__main__":
    main()
