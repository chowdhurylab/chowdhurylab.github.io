"""Focused immutable-manifest finalization; no catalog or network access."""

import hashlib
import gzip
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from contextlib import redirect_stdout


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/build-catlog-viewer-index.py"
SPEC = importlib.util.spec_from_file_location("catlog_viewer_manifest", SCRIPT)
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


class ViewerManifestTests(unittest.TestCase):
    def test_cli_finalization_then_explicit_html_activation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = root / "data"
            data.mkdir()
            row = {field: None for field in BUILD.TABLE_FIELDS}
            row["record_key"] = "record-1"
            table = gzip.compress((json.dumps(row) + "\n").encode(), mtime=0)
            table_hash = hashlib.sha256(table).hexdigest()
            table_ref = f"data/catlog-table.{table_hash[:12]}.jsonl.gz"
            (root / table_ref).write_bytes(table)
            legacy = data / "manifest.js"
            legacy_bytes = (BUILD.MANIFEST_PREFIX + '{"total_rows":0};\n').encode()
            legacy.write_bytes(legacy_bytes)
            old_html = '<script src="data/manifest.js?v=legacy"></script>'
            (root / "index.html").write_text(old_html)
            manifest = {"total_rows": 1, "table_download": {
                "path": table_ref, "sha256": table_hash, "size_bytes": len(table),
            }}
            with patch.object(BUILD, "REPOSITORY_ROOT", root), patch.object(BUILD, "CATALOG_ROOT", root), patch.object(BUILD, "DATA_ROOT", data):
                preliminary = BUILD.write_immutable_manifest(manifest, legacy)
                output = io.StringIO()
                with patch("sys.argv", [str(SCRIPT), "--manifest", f"data/{preliminary.name}", "--write-manifest"]), redirect_stdout(output):
                    self.assertEqual(BUILD.main(), 0)
                final_ref = next(line.removeprefix("Final manifest: ") for line in output.getvalue().splitlines() if line.startswith("Final manifest: "))
                self.assertNotEqual(final_ref, f"data/{preliminary.name}")
                self.assertEqual(legacy.read_bytes(), legacy_bytes)
                self.assertEqual((root / "index.html").read_text(), old_html)
                (root / "index.html").write_text(f'<script src="{final_ref}"></script>')
                with patch("sys.argv", [str(SCRIPT), "--check"]), redirect_stdout(io.StringIO()):
                    self.assertEqual(BUILD.main(), 0)
                self.assertEqual(BUILD.load_manifest()["viewer_index"]["row_count"], 1)

    def test_finalization_preserves_legacy_and_binds_new_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = root / "data"
            data.mkdir()
            legacy = data / "manifest.js"
            suffix = '\nwindow.CATLOG_DETAIL_SHARDS = window.CATLOG_DETAIL_SHARDS || {};\n'
            legacy_bytes = (BUILD.MANIFEST_PREFIX + '{"total_rows":1};' + suffix).encode()
            legacy.write_bytes(legacy_bytes)
            manifest = {"total_rows": 2, "viewer_index": {"path": "data/example.jsonl.gz"}}
            with patch.object(BUILD, "DATA_ROOT", data), patch.object(BUILD, "CATALOG_ROOT", root):
                target = BUILD.write_immutable_manifest(manifest, legacy)
                self.assertEqual(legacy.read_bytes(), legacy_bytes)
                digest = hashlib.sha256(target.read_bytes()).hexdigest()
                self.assertEqual(target.name, f"manifest.{digest[:12]}.js")
                self.assertTrue(target.read_text().endswith(suffix))
                (root / "index.html").write_text(f'<script src="data/{target.name}"></script>')
                self.assertEqual(BUILD.active_manifest_path(), target)
                self.assertEqual(BUILD.load_manifest(), manifest)
                self.assertEqual(BUILD.write_immutable_manifest(manifest, legacy), target)

    def test_hash_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.000000000000.js"
            path.write_text(BUILD.MANIFEST_PREFIX + json.dumps({"total_rows": 1}) + ";\n")
            with self.assertRaisesRegex(RuntimeError, "filename hash differs"):
                BUILD.load_manifest(path)

    def test_legacy_page_remains_readable_and_ambiguous_page_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "data").mkdir()
            legacy = root / "data/manifest.js"
            legacy.write_text(BUILD.MANIFEST_PREFIX + '{"total_rows":1};\n')
            tag = '<script src="data/manifest.js?v=legacy"></script>'
            with patch.object(BUILD, "CATALOG_ROOT", root):
                (root / "index.html").write_text(tag)
                self.assertEqual(BUILD.load_manifest(), {"total_rows": 1})
                (root / "index.html").write_text(tag + tag)
                with self.assertRaisesRegex(RuntimeError, "exactly one"):
                    BUILD.active_manifest_path()


if __name__ == "__main__":
    unittest.main()
