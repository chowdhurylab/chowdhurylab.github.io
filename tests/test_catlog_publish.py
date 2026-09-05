"""Focused staged-data binding checks; no catalog or network access."""

import copy
import hashlib
import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/check-catlog-publish.py"
SPEC = importlib.util.spec_from_file_location("catlog_publish_check", SCRIPT)
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)


def fixture():
    metadata = {}
    source_sha = "a1" * 32

    def asset(stem, extension, content):
        digest = hashlib.sha256(content).hexdigest()
        path = f"data/{stem}.{digest[:12]}.{extension}"
        metadata[f"tools/catlog-static/{path}"] = {
            "sha256": digest, "size_bytes": len(content), "prefix": content[:4096],
        }
        return {"path": path, "sha256": digest, "size_bytes": len(content)}

    shard = asset(
        "details-000", "js",
        ('window.CATLOG_DETAIL_SHARD_GENERATIONS[document.currentScript.dataset.catlogShard] = '
         f'"{source_sha}";\n'
         'window.CATLOG_DETAIL_SHARDS[document.currentScript.dataset.catlogShard] = {};\n').encode(),
    )
    table = asset("catlog-table", "jsonl.gz", b"compressed table fixture")
    enriched = asset("catlog-enriched", "jsonl.gz", b"compressed enriched fixture")
    viewer = asset("catlog-viewer-index", "jsonl.gz", b"compressed viewer fixture")
    viewer["source_table_sha256"] = table["sha256"]
    viewer["source_table_size_bytes"] = table["size_bytes"]
    return {
        "source_sha256": source_sha, "record_chunks": [],
        "detail_shards": [shard["path"]], "table_download": table,
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

    def test_missing_generation_stamp_is_rejected(self):
        manifest, metadata = fixture()
        metadata[f'tools/catlog-static/{manifest["detail_shards"][0]}']["prefix"] = b"unstamped legacy shard"
        self.assertTrue(any("source generation differs" in failure for failure in CHECK.inspect_manifest_data(manifest, metadata)))

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
        self.assertEqual(CHECK.inspect_manifest_data(manifest, metadata), [])


if __name__ == "__main__":
    unittest.main()
