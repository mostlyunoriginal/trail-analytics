"""Copy the current verified build's ranked field plan to the trail report."""
import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("trail", nargs="?", default="data/bunce-school-road")
    trail = Path(parser.parse_args().trail)
    root = trail / "derived" / "viewer"
    pointer = root / "current.json"
    if not pointer.exists():
        raise SystemExit("Build the trail first: py tools/pipeline/enhance.py " + str(trail))
    current = json.loads(pointer.read_text(encoding="utf-8"))
    release = (root / current["path"]).resolve()
    if not release.is_relative_to(root.resolve()):
        raise ValueError("Invalid release pointer")
    report = (release / "field-plan.md").read_text(encoding="utf-8")
    (trail / "gap-report.md").write_text(report, encoding="utf-8")
    print("Updated gap report from the current versioned field plan")


if __name__ == "__main__":
    main()
