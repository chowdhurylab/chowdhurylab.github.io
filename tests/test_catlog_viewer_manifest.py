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
            row["record_key"] = row["measurement_key"] = "record-1"
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

    def table_row(self, key, **values):
        row = {field: None for field in BUILD.TABLE_FIELDS}
        row.update(record_key=key, measurement_key=key, review_key=key, kcat_display="Not reported",
                   km_display="Not reported", kcat_over_km_display="Not reported", condition_flags=[],
                   source_record_count=1, verification_status="unverified")
        row.update(values)
        return row

    def build_rows(self, rows, details_per_shard=2):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        table = root / "table.jsonl.gz"
        table.write_bytes(gzip.compress("".join(json.dumps(row) + "\n" for row in rows).encode(), mtime=0))
        target = root / "viewer.jsonl.gz"
        with patch.object(BUILD, "REPOSITORY_ROOT", root):
            metadata = BUILD.build(table, target, details_per_shard=details_per_shard)
        lines = gzip.decompress(target.read_bytes()).decode().splitlines()
        return metadata, json.loads(lines[0]), [json.loads(line) for line in lines[1:]]

    def test_schema_2_header_order_and_descriptor(self):
        rows = [
            self.table_row("a", verification_status="unverified", ec_number="2.1.1.1"),
            self.table_row("b", verification_status="manual_review_required", ec_number="1.1.1.1",
                           kcat=7.333, kcat_display="7.333", km=0.5, km_display="0.50001"),
            self.table_row("c", verification_status="verified", ec_number="3.1.1.1", review_key="other",
                           primary_uniprot_id="P11509", protein_accession="P11509"),
            self.table_row("d", verification_status="verified", ec_number="3.1.1.1", source_db="primary_paper_direct",
                           enzyme_label_source="explicit_enzyme_name"),
        ]
        metadata, header, encoded = self.build_rows(rows)
        self.assertEqual((header["kind"], header["schema_version"], header["order"]),
                         ("catlog_viewer_index", 2, "default_review_status"))
        self.assertEqual((header["row_count"], header["details_per_shard"]), (4, 2))
        self.assertEqual(header["fields"], [*BUILD.VIEWER_FIELDS, "s"])
        decoded = []
        for values in encoded:
            row = dict(zip(header["fields"], values))
            for field in BUILD.ENUM_FIELDS:
                row[field] = header["enums"][field][row[field]]
            decoded.append(row)
        # accepted first (the CatLog v2 row leads), then checks pending, then other records; s is the table position
        self.assertEqual([row["record_key"] for row in decoded], ["d", "c", "b", "a"])
        self.assertEqual([row["s"] for row in decoded], [1, 1, 0, 0])
        by_key = {row["record_key"]: row for row in decoded}
        self.assertIs(by_key["b"]["kcat"], True)  # Number("7.333") is the stored value
        self.assertEqual(by_key["b"]["km"], 0.5)  # the display text is not the stored value
        self.assertIs(by_key["c"]["protein_accession"], True)
        self.assertEqual(by_key["c"]["review_key"], "other")
        self.assertIs(by_key["a"]["review_key"], True)
        metadata["viewer_path"] = "data/catlog-viewer-index.000000000000.jsonl.gz"
        descriptor = BUILD.viewer_descriptor(metadata)
        self.assertEqual((descriptor["schema_version"], descriptor["encoding"], descriptor["row_order"]),
                         (2, "header_arrays_enums", "default_review_status"))
        self.assertEqual(descriptor["details_per_shard"], 2)
        self.assertEqual(descriptor["derived_fields"], {"measurement_key": "record_key", "ph": "ph_display"})
        self.assertEqual(sorted(descriptor["retained_fields"] + descriptor["omitted_fields"]), sorted(BUILD.TABLE_FIELDS))
        self.assertEqual(descriptor["uncompressed_size_bytes"], metadata["viewer_uncompressed_bytes"])
        for field in ("path", "sha256", "content_sha256", "size_bytes", "source_table_sha256", "source_table_size_bytes"):
            self.assertIn(field, descriptor)

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
