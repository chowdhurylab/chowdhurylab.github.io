import gzip
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("followup", Path(__file__).resolve().parents[1] / "scripts/build-catlog-followup-summary.py")
followup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(followup)


class FollowupSummaryTests(unittest.TestCase):
    def test_only_pending_rows_and_saved_fields_are_counted(self):
        coverage, statuses = followup.summarize([
            {"verification_status": "verified", "sequence": "ACD", "smiles": "C"},
            {"verification_status": "manual_review_required", "sequence": "ACD", "smiles": None, "km": 0, "supporting_pmids": ["123"]},
            {"verification_status": "manual_review_required", "sequence": None, "smiles": "C", "supporting_dois": ["10.1/example"]},
        ])
        self.assertEqual(coverage, dict(total=2, with_literature_id=2, with_sequence=1, with_smiles=1, with_kinetic_value=1))
        self.assertEqual(statuses, {"verified": 1, "manual_review_required": 2})
        self.assertNotIn("missing_sequence_reason", coverage)

    def test_hash_and_cohort_must_match(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "public.jsonl.gz"
            with gzip.open(path, "wt") as handle:
                handle.write(json.dumps({"verification_status": "manual_review_required", "sequence": "ACD"}) + "\n")
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            manifest = {"source_sha256": "frozen-source", "total_rows": 1,
                        "enriched_download": {"sha256": digest},
                        "summary": {"distributions": {"verification_status": [{"label": "manual_review_required", "count": 1}]}}}
            self.assertEqual(followup.build(manifest, path)["download_sha256"], digest)
            manifest["total_rows"] = 2
            with self.assertRaisesRegex(ValueError, "statuses"):
                followup.build(manifest, path)
            manifest["enriched_download"]["sha256"] = "different"
            with self.assertRaisesRegex(ValueError, "hash"):
                followup.build(manifest, path)

    def test_status_is_required(self):
        with self.assertRaisesRegex(ValueError, "Missing review status"):
            followup.summarize([{}])
