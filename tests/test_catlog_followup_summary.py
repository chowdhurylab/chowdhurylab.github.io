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

    def test_review_details_keep_cohorts_and_material_exclusive(self):
        rows = [
            {"verification_status": "manual_review_required", "km": 0, "has_proof_excerpt": True,
             "proof_kind": "source_note", "has_literature_id": True, "supporting_pmids": ["123"]},
            {"verification_status": "unverified", "sequence": "ACD", "proof_kind": "source_note", "has_literature_id": True},
            {"verification_status": "unverified", "smiles": "C", "has_literature_id": True},
            {"verification_status": "unverified"},
            {"verification_status": "verified", "sequence": "ACD"},
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "public.jsonl.gz"
            with gzip.open(path, "wt") as handle:
                for row in rows:
                    handle.write(json.dumps(row) + "\n")
            manifest = {"source_sha256": "source", "total_rows": 5,
                        "enriched_download": {"sha256": hashlib.sha256(path.read_bytes()).hexdigest()},
                        "summary": {"distributions": {"verification_status": [
                            {"label": "manual_review_required", "count": 1},
                            {"label": "unverified", "count": 3}, {"label": "verified", "count": 1}]}}}
            result = followup.build_review_details(manifest, path)
            pending = result["groups"]["manual_review_required"]
            unknown = result["groups"]["unverified"]
            self.assertEqual(pending["with_kinetic_value"], 1)
            self.assertEqual(pending["material"]["paper_excerpt"], 1)
            self.assertEqual(unknown["with_sequence"], 1)
            self.assertEqual(unknown["with_smiles"], 1)
            self.assertEqual(unknown["material"], dict(paper_excerpt=0, source_note=1, paper_id=1, database_record=1))
            self.assertEqual(sum(unknown["material"].values()), unknown["total"])
            self.assertEqual(pending["field_combinations"], [{"missing": ["sequence", "smiles"], "count": 1}])
            self.assertEqual(sum(item["count"] for item in unknown["field_combinations"]), unknown["total"])
            # One record may lack several fields, but belongs to exactly one pie slice.
            for field, count_key in zip(followup.FIELD_NAMES, ("with_kinetic_value", "with_literature_id", "with_sequence", "with_smiles")):
                missing = sum(item["count"] for item in unknown["field_combinations"] if field in item["missing"])
                self.assertEqual(missing, unknown["total"] - unknown[count_key])
            manifest["enriched_download"]["sha256"] = "wrong"
            with self.assertRaisesRegex(ValueError, "hash"):
                followup.build_review_details(manifest, path)

    def test_complete_and_zero_kinetic_values_are_present(self):
        rows = [{"verification_status": "unverified", "km": 0, "sequence": "ACD", "smiles": "C", "supporting_dois": ["10.1/test"]}]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "public.jsonl.gz"
            with gzip.open(path, "wt") as handle:
                handle.write(json.dumps(rows[0]) + "\n")
            manifest = {"source_sha256": "source", "total_rows": 1,
                        "enriched_download": {"sha256": hashlib.sha256(path.read_bytes()).hexdigest()},
                        "summary": {"distributions": {"verification_status": [{"label": "unverified", "count": 1}]}}}
            group = followup.build_review_details(manifest, path)["groups"]["unverified"]
            self.assertEqual(group["field_combinations"], [{"missing": [], "count": 1}])
