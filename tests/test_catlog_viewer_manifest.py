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

    def test_paper_ids_come_from_the_full_data_of_the_same_records(self):
        rows = [self.table_row("a", verification_status="verified"), self.table_row("b"), self.table_row("c")]
        ids = {"a": ("12514023", ["12514023"], "10.1021/BI101056M", ["10.1021/BI101056M"]),
               "b": ("2936344", ["2936344", "7999766"], None, []), "c": (None, [], None, [])}
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        table = root / "catlog-table.000000000000.jsonl.gz"
        table.write_bytes(gzip.compress("".join(json.dumps(row) + "\n" for row in rows).encode(), mtime=0))
        enriched = [dict(row, pubmed_id=ids[row["record_key"]][0], supporting_pmids=ids[row["record_key"]][1],
                         doi=ids[row["record_key"]][2], supporting_dois=ids[row["record_key"]][3]) for row in rows]
        (root / "catlog-enriched.111111111111.jsonl.gz").write_bytes(
            gzip.compress("".join(json.dumps(row) + "\n" for row in enriched).encode(), mtime=0))
        # another snapshot's Full data (other records) next to it is not used
        (root / "catlog-enriched.222222222222.jsonl.gz").write_bytes(
            gzip.compress((json.dumps(dict(enriched[0], record_key="z")) + "\n").encode(), mtime=0))
        target = root / "viewer.jsonl.gz"
        with patch.object(BUILD, "REPOSITORY_ROOT", root):
            metadata = BUILD.build(table, target, details_per_shard=2)
        lines = gzip.decompress(target.read_bytes()).decode().splitlines()
        header = json.loads(lines[0])
        self.assertEqual(header["fields"], [*BUILD.VIEWER_FIELDS, *BUILD.PAPER_FIELDS, "s"])
        self.assertEqual(header["dois"], ["10.1021/bi101056m"])
        decoded = {row[0]: dict(zip(header["fields"], row)) for row in map(json.loads, lines[1:])}
        self.assertEqual((decoded["a"]["pmids"], decoded["a"]["dois"]), (12514023, 0))
        self.assertEqual((decoded["b"]["pmids"], decoded["b"]["dois"]), ([2936344, 7999766], None))
        self.assertEqual((decoded["c"]["pmids"], decoded["c"]["dois"]), (None, None))
        self.assertEqual(metadata["paper_ids_source"], "catlog-enriched.111111111111.jsonl.gz")
        metadata["viewer_path"] = "data/catlog-viewer-index.000000000000.jsonl.gz"
        self.assertEqual(BUILD.viewer_descriptor(metadata)["paper_id_fields"], ["pmids", "dois"])

    def test_condition_note_is_optional_and_read_when_present(self):
        # The exporter adds condition_note to the Table rows of records read by CatLog that read the same as a sibling
        # (website plan P12); it may sit anywhere among the keys, and most rows have none.
        plain = self.table_row("a", verification_status="verified")
        noted = {}
        for field, value in self.table_row("b", verification_status="verified").items():
            if field == "kcat_unit":
                noted["condition_note"] = "+10 mM FBP"
            noted[field] = value
        blank = dict(self.table_row("c"), condition_note=None)
        metadata, header, encoded = self.build_rows([plain, noted, blank])
        self.assertEqual(header["fields"], [*BUILD.VIEWER_FIELDS, "condition_note", "s"])
        decoded = {row[0]: dict(zip(header["fields"], row)) for row in encoded}
        self.assertEqual(decoded["b"]["condition_note"], "+10 mM FBP")
        self.assertIsNone(decoded["a"]["condition_note"])
        self.assertIsNone(decoded["c"]["condition_note"])
        self.assertEqual(metadata["optional_fields"], ["condition_note"])
        metadata["viewer_path"] = "data/catlog-viewer-index.000000000000.jsonl.gz"
        self.assertEqual(BUILD.viewer_descriptor(metadata)["optional_fields"], ["condition_note"])
        # without any note the index and its descriptor are as before
        metadata, header, _encoded = self.build_rows([plain, blank])
        self.assertEqual(header["fields"], [*BUILD.VIEWER_FIELDS, "s"])
        metadata["viewer_path"] = "data/catlog-viewer-index.000000000000.jsonl.gz"
        self.assertNotIn("optional_fields", BUILD.viewer_descriptor(metadata))
        # a note that is not text, and any other new key, still stop the build
        with self.assertRaisesRegex(RuntimeError, "condition_note is not text"):
            self.build_rows([dict(plain, condition_note=5)])
        with self.assertRaisesRegex(RuntimeError, "source schema changed"):
            self.build_rows([dict(plain, other_note="x")])

    def test_database_summary_is_optional_and_compact(self):
        # The CatLog side may add how each record compares with the enzyme databases to the Table rows (per value,
        # per record, or the earlier review's corrections); the index keeps one number per record for the sidebar.
        v2 = dict(verification_status="verified", source_db="primary_paper_direct", enzyme_label_source="explicit_enzyme_name")
        rows = [
            self.table_row("same", **v2, database_summary="confirmed"),
            self.table_row("fixed", **v2, kcat_database_status="corrected", km_database_status="confirmed",
                           kcat_over_km_database_status="not_compared", database_note=None),
            self.table_row("open", **v2, database_status={"kcat": {"status": "differs"}, "Km": "new"}),
            self.table_row("new", **v2, database_statuses=["new_paper_not_in_databases", "new"]),
            self.table_row("label", **v2, database_summary=16),
            self.table_row("earlier", verification_status="corrected", corrections=[{"field": "km", "kind": "magnitude"}]),
            self.table_row("odd", **v2, database_status="weird; confirmed"),
            self.table_row("calc", **v2, database_status="not_compared"),
            self.table_row("plain"),
        ]
        metadata, header, encoded = self.build_rows(rows)
        self.assertEqual(header["fields"], [*BUILD.VIEWER_FIELDS, "database_summary", "s"])
        decoded = {row[0]: dict(zip(header["fields"], row))["database_summary"] for row in encoded}
        self.assertEqual(decoded, {"same": 1, "fixed": 3, "open": 12, "new": 8, "label": 16, "earlier": 32, "odd": 1,
                                   "calc": None, "plain": None})
        self.assertEqual(metadata["optional_fields"], ["database_summary"])
        self.assertEqual(metadata["rows_with_optional"], {"database_summary": 7})
        self.assertEqual(metadata["database_summary_bits"], {"1": 3, "2": 1, "4": 1, "8": 2, "16": 1, "32": 1})
        self.assertEqual(metadata["database_statuses_unknown"], {"weird": 1})
        metadata["viewer_path"] = "data/catlog-viewer-index.000000000000.jsonl.gz"
        self.assertEqual(BUILD.viewer_descriptor(metadata)["optional_fields"], ["database_summary"])
        # with a condition note too, the summary comes after it; without any comparison the index is as before
        metadata, header, _encoded = self.build_rows([dict(rows[0], condition_note="+10 mM FBP"), rows[-1]])
        self.assertEqual(header["fields"], [*BUILD.VIEWER_FIELDS, "condition_note", "database_summary", "s"])
        metadata, header, _encoded = self.build_rows([rows[-2], rows[-1], dict(rows[-1], record_key="x", measurement_key="x", review_key="x", database_note="All 20 ...")])
        self.assertEqual(header["fields"], [*BUILD.VIEWER_FIELDS, "s"])

    def test_database_summary_comes_from_the_full_data_too(self):
        # The CatLog side's export puts the comparison only in the record and the Full data download: each proof line's
        # database_status, an earlier corrected record's corrections. The index reads it there, with the paper ids.
        v2 = dict(verification_status="verified", source_db="primary_paper_direct", enzyme_label_source="explicit_enzyme_name")
        rows = [self.table_row("fixed", **v2), self.table_row("same", **v2), self.table_row("earlier", verification_status="corrected"),
                self.table_row("both", **v2, km_database_status="differs"), self.table_row("plain"), self.table_row("factor", **v2)]
        full = {
            "fixed": {"proof_lines": [{"metric": "kcat", "database_status": "corrected", "database_line": "BRENDA lists 47,000."},
                                      {"metric": "Km", "database_status": "confirmed"}, {"metric": "kcat/Km"}],
                      "database_note": "BRENDA lists the values of another table."},
            "same": {"proof_lines": [{"metric": "Km", "database_status": "confirmed"}, {"metric": "kcat", "database_status": ""}]},
            "earlier": {"corrections": [{"field": "km", "before": 4.7, "after": 0.47, "kind": "magnitude"}]},
            "both": {"proof_lines": [{"metric": "kcat", "database_status": "new"}]},
            "plain": {"proof_lines": [{"metric": "kcat", "check": "confirmed"}], "corrections": []},
            # an exact factor nothing has yet checked (found_by factor_only) is Different number, not a correction,
            # whatever an older snapshot's status calls it; a status of its own says the same
            "factor": {"proof_lines": [{"metric": "kcat", "database_status": "corrected", "database_found_by": "factor_only"},
                                       {"metric": "Km", "database_status": "differs_factor_only"}]},
        }
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        table = root / "catlog-table.000000000000.jsonl.gz"
        table.write_bytes(gzip.compress("".join(json.dumps(row) + "\n" for row in rows).encode(), mtime=0))
        enriched = root / "catlog-enriched.111111111111.jsonl.gz"
        enriched.write_bytes(gzip.compress("".join(
            json.dumps(dict(row, pubmed_id="123", **full[row["record_key"]])) + "\n" for row in rows).encode(), mtime=0))
        target = root / "viewer.jsonl.gz"
        with patch.object(BUILD, "REPOSITORY_ROOT", root):
            metadata = BUILD.build(table, target, details_per_shard=2, enriched_path=enriched)
        lines = gzip.decompress(target.read_bytes()).decode().splitlines()
        header = json.loads(lines[0])
        self.assertEqual(header["fields"], [*BUILD.VIEWER_FIELDS, "database_summary", *BUILD.PAPER_FIELDS, "s"])
        decoded = {row[0]: dict(zip(header["fields"], row))["database_summary"] for row in map(json.loads, lines[1:])}
        self.assertEqual(decoded, {"fixed": 3, "same": 1, "earlier": 32, "both": 12, "plain": None, "factor": 4})
        self.assertEqual(metadata["rows_with_optional"], {"database_summary": 5})
        self.assertEqual(metadata["database_summary_sources"], {"table": 1, "full_data": 5})
        # without a Full data download of the same records nothing comes from another snapshot's
        other = root / "catlog-enriched.222222222222.jsonl.gz"
        other.write_bytes(gzip.compress((json.dumps(dict(rows[0], record_key="z", **full["fixed"])) + "\n").encode(), mtime=0))
        enriched.unlink()
        with patch.object(BUILD, "REPOSITORY_ROOT", root):
            metadata = BUILD.build(table, target, details_per_shard=2)
        header = json.loads(gzip.decompress(target.read_bytes()).decode().splitlines()[0])
        self.assertEqual(header["fields"], [*BUILD.VIEWER_FIELDS, "database_summary", "s"])
        self.assertEqual(metadata["database_summary_sources"], {"table": 1, "full_data": 0})

    def test_database_kinds_and_mixed_summary(self):
        # The CatLog side writes a record-level summary (same | corrected | differs | other_label | new | mixed |
        # not_compared) and the list of kinds its values carry, in the Table rows and the Full data. "mixed" says
        # nothing itself: the kinds carry it. Either field may be absent; proof lines may be plain strings.
        v2 = dict(verification_status="verified", source_db="primary_paper_direct", enzyme_label_source="explicit_enzyme_name")
        rows = [
            self.table_row("mixed", **v2, database_summary="mixed", database_kinds=["same", "corrected", "new"]),
            self.table_row("label", **v2, database_summary="other_label", database_kinds=["other_label"]),
            self.table_row("kinds", **v2, database_kinds=["same", "differs", "other_label"]),
            self.table_row("bare", **v2, database_summary="mixed"),
            self.table_row("none", **v2, database_summary="not_compared", database_kinds=[]),
            self.table_row("plain"),
        ]
        # database_kinds may sit anywhere among the keys
        moved = {}
        for field, value in self.table_row("moved", **v2).items():
            if field == "kcat":
                moved["database_kinds"] = ["new"]
                moved["database_summary"] = "new"
            moved[field] = value
        rows.append(moved)
        metadata, header, encoded = self.build_rows(rows)
        self.assertEqual(header["fields"], [*BUILD.VIEWER_FIELDS, "database_summary", "s"])
        decoded = {row[0]: dict(zip(header["fields"], row))["database_summary"] for row in encoded}
        self.assertEqual(decoded, {"mixed": 1 | 2 | 8, "label": 16, "kinds": 1 | 4 | 16, "bare": None, "none": None,
                                   "plain": None, "moved": 8})
        self.assertEqual(metadata["database_statuses_unknown"], {})
        self.assertEqual(metadata["database_summary_bits"], {"1": 2, "2": 1, "4": 1, "8": 2, "16": 2, "32": 0})
        # the same from the Full data alone, beside string proof lines and earlier corrections
        table_rows = [self.table_row("mixed", **v2), self.table_row("earlier", verification_status="corrected"),
                      self.table_row("text", **v2)]
        full = {
            "mixed": {"database_summary": "mixed", "database_kinds": ["same", "other_label"],
                      "proof_lines": ["Table 2: kcat 4.1 s-1", {"metric": "kcat", "database_status": "confirmed"},
                                      {"metric": "Km", "database_status": "same_number_other_label"}]},
            "earlier": {"corrections": [{"field": "km", "before": 4.7, "after": 0.47, "kind": "magnitude", "listed": "BRENDA"}]},
            "text": {"proof_lines": ["Table 1 prints 3.2 mM"]},
        }
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        table = root / "catlog-table.000000000000.jsonl.gz"
        table.write_bytes(gzip.compress("".join(json.dumps(row) + "\n" for row in table_rows).encode(), mtime=0))
        enriched = root / "catlog-enriched.111111111111.jsonl.gz"
        enriched.write_bytes(gzip.compress("".join(
            json.dumps(dict(row, **full[row["record_key"]])) + "\n" for row in table_rows).encode(), mtime=0))
        target = root / "viewer.jsonl.gz"
        with patch.object(BUILD, "REPOSITORY_ROOT", root):
            metadata = BUILD.build(table, target, details_per_shard=2, enriched_path=enriched)
        lines = gzip.decompress(target.read_bytes()).decode().splitlines()
        header = json.loads(lines[0])
        decoded = {row[0]: dict(zip(header["fields"], row))["database_summary"] for row in map(json.loads, lines[1:])}
        self.assertEqual(decoded, {"mixed": 1 | 16, "earlier": 32, "text": None})
        self.assertEqual(metadata["database_statuses_unknown"], {})
        self.assertEqual(metadata["database_summary_sources"], {"table": 0, "full_data": 2})

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
