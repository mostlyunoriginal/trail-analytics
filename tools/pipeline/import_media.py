"""Import reviewed trail media into the source repository for sharing through Git."""
import argparse
from pathlib import Path

from media_publication import (merge_publication, read_publication,
                               read_repository_media, write_publication)

REPO = Path(__file__).resolve().parents[2]


def import_media(archive, trail="bunce-school-road", viewer=None):
    viewer = Path(viewer) if viewer is not None else REPO / "viewer"
    incoming = read_publication(archive, trail)
    if not incoming:
        raise ValueError("Publication archive contains no media")
    existing = read_repository_media(viewer, trail)
    merged = merge_publication(existing, incoming)
    write_publication(viewer, trail, merged)
    return len(incoming), len(merged)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="Reviewed .trailmedia publication export")
    parser.add_argument("--trail", default="bunce-school-road")
    args = parser.parse_args()
    try:
        imported, total = import_media(args.archive, args.trail)
    except (OSError, ValueError, TypeError, KeyError) as error:
        parser.exit(1, f"Media import failed: {error}\n")
    print(f"Imported/updated {imported} attachment(s); {total} shared attachment(s) total.")
    print("Reload the local viewer to review. Commit and push viewer/published-media.json")
    print("and viewer/published-media/ with the viewer code to share through the remote repo.")
    print("Normal package_site.py builds now include this media. Deploy the package to update Pages.")


if __name__ == "__main__":
    main()
