"""Focused staged-data binding checks; no catalog or network access."""

import copy
import gzip
import hashlib
import importlib.util
import io
import json
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/check-catlog-publish.py"
SPEC = importlib.util.spec_from_file_location("catlog_publish_check", SCRIPT)
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)


def detail_blob(source_sha, rows=None, *, record_count=None):
    rows = rows if rows is not None else [["record-1", {"value": 1}]]
    header = {
        "kind": "catlog_detail_shard",
        "schema_version": 1,
        "source_sha256": source_sha,
        "record_count": len(rows) if record_count is None else record_count,
    }
    decoded = "\n".join(
        json.dumps(value, separators=(",", ":"), sort_keys=True)
        for value in [header, *rows]
    ) + "\n"
    return gzip.compress(decoded.encode(), compresslevel=9, mtime=0)


def detail_metadata(content):
    inspector = CHECK.DetailShardStreamInspector()
    midpoint = max(1, len(content) // 2)
    inspector.feed(content[:midpoint])
    inspector.feed(content[midpoint:])
    return inspector.finish()


def add_detail_asset(metadata, source_sha, index, rows, *, record_count=None):
    content = detail_blob(source_sha, rows, record_count=record_count)
    digest = hashlib.sha256(content).hexdigest()
    path = f"data/details-{index:03d}.{digest[:12]}.jsonl.gz"
    metadata[f"tools/catlog-static/{path}"] = {
        "sha256": digest,
        "size_bytes": len(content),
        "prefix": content[:4096],
        **detail_metadata(content),
    }
    return path


def fixture():
    metadata = {}
    source_sha = "a1" * 32

    def asset(stem, extension, content):
        digest = hashlib.sha256(content).hexdigest()
        path = f"data/{stem}.{digest[:12]}.{extension}"
        item = {
            "sha256": digest, "size_bytes": len(content), "prefix": content[:4096],
        }
        if stem.startswith("details-") and extension == "jsonl.gz":
            item.update(detail_metadata(content))
        metadata[f"tools/catlog-static/{path}"] = item
        return {"path": path, "sha256": digest, "size_bytes": len(content)}

    shard_path = add_detail_asset(metadata, source_sha, 0, [["record-1", {"value": 1}]])
    table = asset("catlog-table", "jsonl.gz", b"compressed table fixture")
    enriched = asset("catlog-enriched", "jsonl.gz", b"compressed enriched fixture")
    viewer = asset("catlog-viewer-index", "jsonl.gz", b"compressed viewer fixture")
    viewer["source_table_sha256"] = table["sha256"]
    viewer["source_table_size_bytes"] = table["size_bytes"]
    return {
        "source_sha256": source_sha, "total_rows": 1, "details_per_shard": 1,
        "record_chunks": [], "detail_shards": [shard_path], "table_download": table,
        "enriched_download": enriched, "viewer_index": viewer,
    }, metadata


class ManifestDataTests(unittest.TestCase):
    def test_exact_staged_bytes_pass(self):
        manifest, metadata = fixture()
        self.assertEqual(CHECK.inspect_manifest_data(manifest, metadata), [])

    def test_stable_or_query_versioned_data_is_rejected(self):
        for path in ("data/catlog-table.jsonl.gz", "data/catlog-table.abcdefabcdef.jsonl.gz?v=old"):
            manifest, metadata = fixture()
            manifest["table_download"]["path"] = path
            failures = CHECK.inspect_manifest_data(manifest, metadata)
            self.assertTrue(any("not content-addressed" in failure for failure in failures))

    def test_filename_suffix_must_match_bytes(self):
        manifest, metadata = fixture()
        path = manifest["detail_shards"][0]
        metadata[f"tools/catlog-static/{path}"]["sha256"] = "00" * 32
        self.assertTrue(any("filename hash differs" in failure for failure in CHECK.inspect_manifest_data(manifest, metadata)))

    def test_descriptors_cannot_exchange_asset_types(self):
        manifest, metadata = fixture()
        manifest["table_download"], manifest["enriched_download"] = (
            manifest["enriched_download"], manifest["table_download"],
        )
        failures = CHECK.inspect_manifest_data(manifest, metadata)
        self.assertEqual(sum("wrong data asset type" in failure for failure in failures), 2)

    def test_record_chunks_cannot_name_detail_shards(self):
        manifest, metadata = fixture()
        manifest["record_chunks"] = list(manifest["detail_shards"])
        self.assertTrue(any("wrong data asset type" in failure for failure in CHECK.inspect_manifest_data(manifest, metadata)))

    def test_untracked_manifest_asset_is_rejected(self):
        manifest, metadata = fixture()
        del metadata[f'tools/catlog-static/{manifest["table_download"]["path"]}']
        self.assertTrue(any("not stage-0 tracked" in failure for failure in CHECK.inspect_manifest_data(manifest, metadata)))

    def test_descriptor_hash_and_size_must_match(self):
        for field in ("sha256", "size_bytes"):
            manifest, metadata = fixture()
            manifest["enriched_download"][field] = "incorrect"
            self.assertTrue(any("descriptor" in failure for failure in CHECK.inspect_manifest_data(manifest, metadata)))

    def test_detail_source_generation_must_match(self):
        manifest, metadata = fixture()
        manifest["source_sha256"] = "b2" * 32
        self.assertTrue(any("source generation differs" in failure for failure in CHECK.inspect_manifest_data(manifest, metadata)))

    def test_missing_decoded_detail_header_is_rejected(self):
        manifest, metadata = fixture()
        metadata[f'tools/catlog-static/{manifest["detail_shards"][0]}']["detail_header"] = None
        self.assertTrue(any("source generation differs" in failure for failure in CHECK.inspect_manifest_data(manifest, metadata)))

    def test_detail_counts_must_match_manifest_total(self):
        manifest, metadata = fixture()
        manifest["total_rows"] = 2
        failures = CHECK.inspect_manifest_data(manifest, metadata)
        self.assertIn(
            "manifest detail_shards count does not match total_rows/details_per_shard",
            failures,
        )
        self.assertIn(
            "active detail shard record counts do not match manifest total_rows",
            failures,
        )

    def test_details_per_shard_must_be_a_positive_integer(self):
        for invalid in (None, 0, -1, True, 1.5):
            with self.subTest(invalid=invalid):
                manifest, metadata = fixture()
                manifest["details_per_shard"] = invalid
                self.assertIn(
                    "manifest details_per_shard is missing or invalid",
                    CHECK.inspect_manifest_data(manifest, metadata),
                )

    def test_detail_record_keys_must_be_unique_across_active_shards(self):
        manifest, metadata = fixture()
        path = add_detail_asset(metadata, "a1" * 32, 1, [["record-1", {"value": 2}]])
        manifest["detail_shards"].append(path)
        manifest["total_rows"] = 2
        self.assertTrue(
            any(
                "record keys overlap" in failure
                for failure in CHECK.inspect_manifest_data(manifest, metadata)
            )
        )

    def test_detail_shard_order_must_match_numeric_filename_indices(self):
        manifest, metadata = fixture()
        path = add_detail_asset(metadata, "a1" * 32, 1, [["record-2", {"value": 2}]])
        manifest["detail_shards"].append(path)
        manifest["total_rows"] = 2
        manifest["detail_shards"].reverse()
        failures = CHECK.inspect_manifest_data(manifest, metadata)
        self.assertEqual(sum("filename index differs" in failure for failure in failures), 2)

    def test_nonfinal_shard_must_have_details_per_shard_rows(self):
        manifest, metadata = fixture()
        path = add_detail_asset(metadata, "a1" * 32, 1, [["record-2", {"value": 2}]])
        manifest["detail_shards"].append(path)
        manifest["total_rows"] = 3
        manifest["details_per_shard"] = 2
        failures = CHECK.inspect_manifest_data(manifest, metadata)
        self.assertTrue(
            any(
                manifest["detail_shards"][0] in failure
                and "manifest position" in failure
                for failure in failures
            )
        )

    def test_final_shard_must_have_only_remaining_rows(self):
        manifest, metadata = fixture()
        old_path = manifest["detail_shards"].pop()
        metadata.pop(f"tools/catlog-static/{old_path}")
        first = add_detail_asset(
            metadata,
            "a1" * 32,
            0,
            [["record-1", {"value": 1}], ["record-2", {"value": 2}]],
        )
        final = add_detail_asset(
            metadata,
            "a1" * 32,
            1,
            [["record-3", {"value": 3}], ["record-4", {"value": 4}]],
        )
        manifest["detail_shards"] = [first, final]
        manifest["total_rows"] = 3
        manifest["details_per_shard"] = 2
        failures = CHECK.inspect_manifest_data(manifest, metadata)
        self.assertTrue(
            any(final in failure and "manifest position" in failure for failure in failures)
        )

    def test_viewer_index_must_bind_the_current_table(self):
        manifest, metadata = fixture()
        manifest["viewer_index"]["source_table_sha256"] = "00" * 32
        self.assertIn("viewer index source-table hash differs from table descriptor", CHECK.inspect_manifest_data(manifest, metadata))

    def test_viewer_index_must_bind_the_table_size(self):
        manifest, metadata = fixture()
        manifest["viewer_index"]["source_table_size_bytes"] += 1
        self.assertIn("viewer index source-table size differs from table descriptor", CHECK.inspect_manifest_data(manifest, metadata))

    def test_retained_previous_generation_is_not_current_input(self):
        manifest, metadata = fixture()
        metadata["tools/catlog-static/data/details-000.js"] = copy.deepcopy(next(iter(metadata.values())))
        metadata["tools/catlog-static/data/manifest.js"] = {
            "sha256": "00" * 32,
            "size_bytes": 300,
            "prefix": b"retained legacy manifest",
        }
        self.assertEqual(CHECK.inspect_manifest_data(manifest, metadata), [])


class DetailShardStreamTests(unittest.TestCase):
    def inspect(self, content):
        return detail_metadata(content)

    def test_valid_gzip_header_rows_and_count(self):
        result = self.inspect(detail_blob("a1" * 32))
        self.assertEqual(result["detail_failures"], ())
        self.assertEqual(result["detail_record_count"], 1)
        self.assertEqual(result["detail_record_keys"], frozenset({"record-1"}))

    def test_non_gzip_detail_is_rejected(self):
        result = self.inspect(b"not a gzip detail shard")
        self.assertTrue(any("not a valid gzip" in failure for failure in result["detail_failures"]))

    def test_truncated_gzip_detail_is_rejected(self):
        result = self.inspect(detail_blob("a1" * 32)[:-5])
        self.assertTrue(any("truncated" in failure for failure in result["detail_failures"]))

    def test_declared_record_count_must_match_rows(self):
        result = self.inspect(detail_blob("a1" * 32, record_count=2))
        self.assertIn(
            "detail shard record_count does not match its JSONL rows",
            result["detail_failures"],
        )

    def test_detail_header_contract_is_exact(self):
        header = {
            "kind": "wrong_kind",
            "schema_version": 1,
            "source_sha256": "a1" * 32,
            "record_count": 0,
        }
        content = gzip.compress((json.dumps(header) + "\n").encode(), mtime=0)
        result = self.inspect(content)
        self.assertIn("detail shard header kind is invalid", result["detail_failures"])

    def test_detail_rows_must_be_key_object_pairs(self):
        result = self.inspect(detail_blob("a1" * 32, [["record-1", "not-an-object"]]))
        self.assertIn(
            "detail shard row is not a [record_key, detail_object] pair",
            result["detail_failures"],
        )

    def test_complete_line_arriving_with_newline_still_obeys_size_bound(self):
        content = detail_blob("a1" * 32, [["record-1", {"value": "x" * 200}]])
        decoded_lines = gzip.decompress(content).decode().splitlines()
        cap = len(decoded_lines[0])
        self.assertGreater(len(decoded_lines[1]), cap)
        inspector = CHECK.DetailShardStreamInspector()
        with mock.patch.object(CHECK, "MAXIMUM_DETAIL_LINE_CHARS", cap):
            inspector.feed(content)
            result = inspector.finish()
        self.assertIn(
            "detail shard JSONL line exceeds the safety bound",
            result["detail_failures"],
        )

    def test_nonstandard_json_numeric_constants_are_rejected(self):
        header = {
            "kind": "catlog_detail_shard",
            "schema_version": 1,
            "source_sha256": "a1" * 32,
            "record_count": 1,
        }
        for constant in ("NaN", "Infinity", "-Infinity"):
            with self.subTest(constant=constant):
                decoded = (
                    json.dumps(header, separators=(",", ":"), sort_keys=True)
                    + f'\n["record-1",{{"value":{constant}}}]\n'
                )
                result = self.inspect(gzip.compress(decoded.encode(), mtime=0))
                self.assertIn("detail shard contains invalid JSONL", result["detail_failures"])

    def test_record_keys_must_be_unique(self):
        rows = [["record-1", {"value": 1}], ["record-1", {"value": 2}]]
        result = self.inspect(detail_blob("a1" * 32, rows))
        self.assertTrue(any("repeats record_key" in failure for failure in result["detail_failures"]))


class StagedManifestTests(unittest.TestCase):
    @staticmethod
    def manifest_bytes():
        payload = {"source_sha256": "a1" * 32}
        return (
            CHECK.MANIFEST_PREFIX
            + json.dumps(payload, separators=(",", ":"), sort_keys=True)
            + ";\n"
        ).encode()

    def test_manifest_is_resolved_from_staged_canonical_page(self):
        manifest_bytes = self.manifest_bytes()
        digest = hashlib.sha256(manifest_bytes).hexdigest()
        manifest_path = f"tools/catlog-static/data/manifest.{digest[:12]}.js"
        page = f'<script src="data/manifest.{digest[:12]}.js"></script>'.encode()
        calls = []

        def staged(path, **_kwargs):
            calls.append(path)
            return page if path == CHECK.CANONICAL_PAGE_INDEX_PATH else manifest_bytes

        with mock.patch.object(CHECK, "_read_staged_file", side_effect=staged):
            manifest, resolved_path = CHECK.load_staged_manifest()
        self.assertEqual(calls, [CHECK.CANONICAL_PAGE_INDEX_PATH, manifest_path])
        self.assertEqual(resolved_path, manifest_path)
        self.assertEqual(manifest["source_sha256"], "a1" * 32)

    def test_manifest_filename_hash_must_match_staged_bytes(self):
        manifest_bytes = self.manifest_bytes()
        page = b'<script src="data/manifest.000000000000.js"></script>'
        with mock.patch.object(
            CHECK,
            "_read_staged_file",
            side_effect=[page, manifest_bytes],
        ):
            with self.assertRaisesRegex(ValueError, "filename hash differs"):
                CHECK.load_staged_manifest()

    def test_stable_query_manifest_is_not_an_active_manifest(self):
        page = b'<script src="data/manifest.js?v=old"></script>'
        with self.assertRaisesRegex(ValueError, "unexpected manifest reference"):
            CHECK.resolve_staged_manifest_path(page)

    def test_manifest_traversal_is_rejected(self):
        page = b'<script src="../../data/manifest.abcdefabcdef.js"></script>'
        with self.assertRaisesRegex(ValueError, "unexpected manifest reference"):
            CHECK.resolve_staged_manifest_path(page)

    def test_staged_file_size_bound_stops_and_reaps_reader(self):
        class Process:
            def __init__(self):
                self.stdout = io.BytesIO(b"123456")
                self.terminated = False
                self.reaped = False

            def terminate(self):
                self.terminated = True

            def wait(self, timeout=None):
                self.reaped = True
                return -15

        process = Process()
        with mock.patch.object(CHECK.subprocess, "Popen", return_value=process):
            with self.assertRaisesRegex(ValueError, "size bound"):
                CHECK._read_staged_file("staged/path", maximum_size=5, label="fixture")
        self.assertTrue(process.terminated)
        self.assertTrue(process.reaped)


if __name__ == "__main__":
    unittest.main()
