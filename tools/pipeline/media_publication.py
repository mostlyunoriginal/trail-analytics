"""Validate an explicitly reviewed media archive before adding it to a static artifact."""
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import os
import tempfile

MAGIC = b"TRAILMEDIA1\n"
EXTENSIONS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
              "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm"}


def validate_public_record(record, trail, ids):
    identifier = record.get("id", "")
    pin = record.get("pin") or {}
    mime = record.get("mime", "")
    if (not re.fullmatch(r"[a-f0-9-]{36}", identifier) or identifier in ids
            or record.get("trail") != trail or record.get("confirmed") is not True
            or mime not in EXTENSIONS
            or record.get("type") != ("photo" if mime.startswith("image/") else "video")
            or not isinstance(pin, dict)
            or any(type(pin.get(key)) not in (int, float) or not math.isfinite(pin[key])
                   or abs(pin[key]) > limit for key, limit in (("lat", 90), ("lon", 180)))):
        raise ValueError("Invalid or unconfirmed publication record")
    size = record.get("size")
    if type(size) is not int or not 0 < size <= 100 * 1024 * 1024:
        raise ValueError("Invalid media file size")
    if not re.fullmatch(r"[a-f0-9]{64}", record.get("hash", "")):
        raise ValueError("Invalid media hash")
    ids.add(identifier)


def verify_payload(record, payload):
    if len(payload) != record["size"] or hashlib.sha256(payload).hexdigest() != record["hash"]:
        raise ValueError("Media bytes failed integrity verification")


def read_publication(path, trail):
    path = Path(path)
    if path.stat().st_size > 500 * 1024 * 1024:
        raise ValueError("Media publication exceeds 500 MiB")
    items = []
    with path.open("rb") as source:
        if source.read(len(MAGIC)) != MAGIC:
            raise ValueError("Invalid media archive")
        header = source.read(4)
        if len(header) != 4:
            raise ValueError("Truncated archive")
        length = struct.unpack(">I", header)[0]
        if length > 4 * 1024 * 1024:
            raise ValueError("Invalid manifest size")
        manifest = json.loads(source.read(length))
        if (manifest.get("schema_version") != 1 or manifest.get("purpose") != "publication"
                or manifest.get("trail") != trail or not isinstance(manifest.get("records"), list)):
            raise ValueError("Use a reviewed publication archive for this trail, not a private backup")
        ids = set()
        for record in manifest["records"]:
            validate_public_record(record, trail, ids)
            payload = source.read(record["size"])
            verify_payload(record, payload)
            items.append((record, payload))
        if source.read(1):
            raise ValueError("Unexpected trailing archive data")
    return items


def read_repository_media(viewer, trail):
    path = viewer / "published-media.json"
    if not path.exists():
        return []
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != 1 or not isinstance(manifest.get("records"), list):
        raise ValueError("Invalid repository media manifest")
    if manifest["records"] and manifest.get("trail") != trail:
        raise ValueError("Repository media belongs to another trail")
    items, ids = [], set()
    for record in manifest["records"]:
        validate_public_record(record, trail, ids)
        # Accept previous UUID names as well as content-versioned asset names.
        stem = record["id"]
        allowed = {f"published-media/{stem}{EXTENSIONS[record['mime']]}",
                   f"published-media/{stem}-{record['hash']}{EXTENSIONS[record['mime']]}"}
        if record.get("url") not in allowed:
            raise ValueError("Invalid repository media path")
        asset = viewer / record["url"]
        if not asset.resolve().is_relative_to(viewer.resolve()):
            raise ValueError("Repository media escapes viewer directory")
        if asset.stat().st_size != record["size"]:
            raise ValueError("Media bytes failed integrity verification")
        payload = asset.read_bytes()
        verify_payload(record, payload)
        items.append((record, payload))
    return items


def merge_publication(existing, incoming):
    """Update exported IDs and retain attachments not included in this export."""
    merged = {record["id"]: (record, payload) for record, payload in existing}
    merged.update({record["id"]: (record, payload) for record, payload in incoming})
    return [merged[key] for key in sorted(merged)]


def atomic_write(path, payload):
    handle, temporary = tempfile.mkstemp(prefix=".media-", dir=path.parent)
    try:
        with os.fdopen(handle, "wb") as output:
            output.write(payload)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def write_publication(viewer, trail, items):
    ids = set()
    for record, payload in items:
        validate_public_record(record, trail, ids)
        verify_payload(record, payload)
    folder = viewer / "published-media"
    folder.mkdir(exist_ok=True)
    records = []
    for record, payload in items:
        # New bytes get a new URL; a failed import leaves the old manifest usable.
        filename = record["id"] + "-" + record["hash"] + EXTENSIONS[record["mime"]]
        asset = folder / filename
        if not asset.exists() or asset.read_bytes() != payload:
            atomic_write(asset, payload)
        records.append({**record, "url": "published-media/" + filename})
    atomic_write(viewer / "published-media.json",
                 (json.dumps({"schema_version": 1, "trail": trail, "records": records}, indent=2) + "\n").encode("utf-8"))
