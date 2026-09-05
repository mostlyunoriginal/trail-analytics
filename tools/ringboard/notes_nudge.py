#!/usr/bin/env python3
"""UserPromptSubmit hook: inject a reminder when NOTES.md has open notes.

Prints one line to stdout when open notes exist (Claude Code adds it to context);
prints nothing when there are none. Root = $CLAUDE_PROJECT_DIR, else argv[1],
else two levels up from this script. Always exits 0 — a nudge must never block a prompt.
"""
import os
import re
import sys
from pathlib import Path


def main():
    try:
        root = Path(os.environ.get("CLAUDE_PROJECT_DIR")
                    or (sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[2]))
        text = (root / "NOTES.md").read_text(encoding="utf-8")
        open_notes, flagged = [], 0
        heads = list(re.finditer(r"(?m)^## (N\w+) — .*$", text))
        for i, h in enumerate(heads):
            seg = text[h.end(): heads[i + 1].start() if i + 1 < len(heads) else len(text)]
            if re.search(r"(?m)^- status: open\s*$", seg):
                open_notes.append(h.group(1))
                if re.search(r"(?m)^- response-requested: yes\s*$", seg):
                    flagged += 1
        if open_notes:
            n = len(open_notes)
            msg = f"NOTES.md has {n} open note{'s' if n != 1 else ''} from the user ({', '.join(open_notes)})"
            if flagged:
                msg += f", {flagged} flagged response-requested (needs a written Response in the entry)"
            msg += ". Act on them per the NOTES.md header protocol before or alongside the current request."
            print(msg)
    except Exception:
        pass  # never block the prompt over a nudge


if __name__ == "__main__":
    main()
