import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
import contextlib
import io

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools/pipeline"))
from media_publication import MAGIC, read_publication, read_repository_media, write_publication
from import_media import import_media
import media_publication
import package_site


class MediaPublicationTests(unittest.TestCase):
    def archive(self, path, purpose="publication", **overrides):
        payload = b"fixture photo bytes"
        record = {"id": "12345678-1234-1234-1234-123456789012", "trail": "test", "confirmed": True,
                  "pin": {"lat": 40, "lon": -105}, "mime": "image/jpeg", "type": "photo",
                  "size": len(payload), "hash": hashlib.sha256(payload).hexdigest(), **overrides}
        manifest = json.dumps({"schema_version": 1, "purpose": purpose, "trail": "test", "records": [record]}).encode()
        path.write_bytes(MAGIC + struct.pack(">I", len(manifest)) + manifest + payload)

    def test_private_backup_cannot_be_published(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "media.trailmedia"
            self.archive(path, purpose="backup")
            with self.assertRaisesRegex(ValueError, "reviewed publication"):
                read_publication(path, "test")

    def test_publication_keeps_original_pin_and_uses_safe_asset_names(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path = root / "media.trailmedia"
            self.archive(path)
            items = read_publication(path, "test")
            write_publication(root, "test", items)
            manifest = json.loads((root / "published-media.json").read_text())
            record = manifest["records"][0]
            self.assertEqual(record["pin"], {"lat": 40, "lon": -105})
            self.assertEqual((root / record["url"]).read_bytes(), b"fixture photo bytes")

    def test_unconfirmed_invalid_and_corrupt_media_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "media.trailmedia"
            for overrides in ({"confirmed": False}, {"pin": {"lat": 999, "lon": 0}},
                              {"id": "../../bad"}, {"hash": "bad"}, {"size": -1}):
                self.archive(path, **overrides)
                with self.assertRaises(ValueError):
                    read_publication(path, "test")

    def test_import_merges_updates_and_is_repeatable(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archive = root / "media.trailmedia"
            self.archive(archive, title="First")
            self.assertEqual(import_media(archive, "test", root), (1, 1))
            first_bytes = (root / "published-media.json").read_bytes()
            self.assertEqual(import_media(archive, "test", root), (1, 1))
            self.assertEqual(first_bytes, (root / "published-media.json").read_bytes())
            self.archive(archive, id="22345678-1234-1234-1234-123456789012", title="Second")
            self.assertEqual(import_media(archive, "test", root), (1, 2))
            self.archive(archive, title="Corrected", pin={"lat": 41, "lon": -104})
            self.assertEqual(import_media(archive, "test", root), (1, 2))
            records = [record for record, _ in read_repository_media(root, "test")]
            self.assertEqual([record["title"] for record in records], ["Corrected", "Second"])
            self.assertEqual(records[0]["pin"], {"lat": 41, "lon": -104})

    def test_wrong_trail_backup_and_corruption_leave_repository_unchanged(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archive = root / "media.trailmedia"
            self.archive(archive)
            import_media(archive, "test", root)
            before = (root / "published-media.json").read_bytes()
            for purpose, overrides in (("backup", {}), ("publication", {"hash": "0" * 64})):
                self.archive(archive, purpose=purpose, **overrides)
                with self.assertRaises(ValueError):
                    import_media(archive, "test", root)
                self.assertEqual(before, (root / "published-media.json").read_bytes())
            with self.assertRaisesRegex(ValueError, "another trail"):
                read_repository_media(root, "other")
            record = read_repository_media(root, "test")[0][0]
            (root / record["url"]).write_bytes(b"corrupt")
            with self.assertRaisesRegex(ValueError, "integrity"):
                read_repository_media(root, "test")

    def test_interrupted_update_keeps_previous_media_usable(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archive = root / "media.trailmedia"
            self.archive(archive)
            import_media(archive, "test", root)
            previous = read_repository_media(root, "test")
            record = dict(previous[0][0])
            payload = b"updated photo bytes"
            record.update(size=len(payload), hash=hashlib.sha256(payload).hexdigest())
            real_write = media_publication.atomic_write

            def fail_manifest(path, data):
                if path.name == "published-media.json":
                    raise OSError("simulated interruption")
                real_write(path, data)

            with patch.object(media_publication, "atomic_write", side_effect=fail_manifest):
                with self.assertRaises(OSError):
                    write_publication(root, "test", [(record, payload)])
            self.assertEqual(previous, read_repository_media(root, "test"))

    def test_repository_rejects_asset_path_traversal(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archive = root / "media.trailmedia"
            self.archive(archive)
            import_media(archive, "test", root)
            path = root / "published-media.json"
            manifest = json.loads(path.read_text())
            manifest["records"][0]["url"] = "../private.jpg"
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "path"):
                read_repository_media(root, "test")

    def test_normal_package_includes_only_referenced_media_and_merges_optional_export(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            viewer = root / "viewer"
            viewer.mkdir()
            (viewer / "index.html").write_text("fixture viewer")
            archive = root / "media.trailmedia"
            self.archive(archive)
            import_media(archive, "test", viewer)
            before = (viewer / "published-media.json").read_bytes()
            (viewer / "published-media" / "unreferenced.jpg").write_bytes(b"not published")
            source = root / "data/test/derived/viewer"
            release = source / "releases/test"
            release.mkdir(parents=True)
            (release / "inventory.json").write_text("{}")
            (source / "current.json").write_text(json.dumps({"path": "releases/test", "build_id": "test"}))
            with patch.object(package_site, "REPO", root), contextlib.redirect_stdout(io.StringIO()):
                out = package_site.package("test", root / "dist/normal")
                self.assertEqual(len(read_repository_media(out / "viewer", "test")), 1)
                self.assertFalse((out / "viewer/published-media/unreferenced.jpg").exists())
                self.assertEqual(json.loads((out / "artifact.json").read_text())["published_media"], 1)
                self.archive(archive, id="22345678-1234-1234-1234-123456789012")
                out = package_site.package("test", root / "dist/extra", archive)
                self.assertEqual(len(read_repository_media(out / "viewer", "test")), 2)
                self.assertEqual(before, (viewer / "published-media.json").read_bytes())
                record = read_repository_media(viewer, "test")[0][0]
                (viewer / record["url"]).write_bytes(b"corrupt")
                with self.assertRaisesRegex(ValueError, "integrity"):
                    package_site.package("test", root / "dist/invalid")
                self.assertFalse((root / "dist/invalid").exists())


if __name__ == "__main__":
    unittest.main()
