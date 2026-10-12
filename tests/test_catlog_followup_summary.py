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


def overview_rows():
    return [
        # CatLog v2, accepted, human-checked; a kcat/Km that agrees with kcat / Km within printed precision.
        {"record_key": "a", "measurement_key": "a", "verification_status": "verified",
         "verification_method": "catlog_v2_read_and_independent_verify", "source_db": "primary_paper_direct",
         "supporting_pmids": ["111"], "pubmed_id": "111", "ec_number": "1.1.1.1", "enzyme_display_name": "alcohol dehydrogenase",
         "organism": "Homo sapiens", "substrate_name": "ethanol", "wild_type": True, "mutation_signature": "Unknown",
         "temperature_display": "25", "ph_display": 7.5,
         "kcat": 2.0, "kcat_unit": "s^(-1)", "km": 0.3, "km_unit": "mM", "kcat_over_km": 6.7, "kcat_over_km_unit": "s^(-1)*mM^(-1)",
         "condition_flags": ["kcat_over_km_quotient_mismatch"]},
        # Corrected, marked but not checked; two EC classes; a DOI and no PMID.
        {"record_key": "b", "verification_status": "corrected", "verification_method": "corrected_field_lock_review",
         "source_db": "brenda", "supporting_pmids": [], "pubmed_id": None, "supporting_dois": ["10.1/X"], "doi": "https://doi.org/10.1/x",
         "ec_number": "1.1.1.1; 2.7.1.1", "enzyme_display_name": "Alcohol  dehydrogenase", "organism": "homo sapiens",
         "substrate_name": "Ethanol", "wild_type": False, "temperature_display": "n/a", "temperature_k": 303.15,
         "km": 2.0, "km_unit": "mM", "condition_flags": ["kcat_over_km_quotient_mismatch", "temperature_zero_celsius_needs_check"]},
        # Checks pending, checked mark (not accepted, so not human-checked); a stand-in paper id; unit not recorded.
        {"record_key": "c", "verification_status": "manual_review_required", "source_db": "sabio_rk;brenda",
         "pubmed_id": "NP1a2b3c4d", "ec_number": "Unknown", "enzyme_display_name": "Unknown", "organism": "Unknown",
         "substrate_name": "", "sequence_variant_status": "reconstructed_variant_sequence", "ph_display": 21,
         "kcat": 5.0, "kcat_unit": None, "km": 0.0, "km_unit": "mM", "condition_flags": ["unit_not_recorded_kcat"]},
        # Unverified, no paper; a printed variant; magnitude caution; a large kcat.
        {"record_key": "d", "verification_status": "unverified", "source_db": "oed", "ec_number": "3.5.2.6",
         "enzyme_display_name": "beta-lactamase", "organism": "Escherichia coli", "substrate_name": "ampicillin",
         "mutation_signature": "S70A", "kcat": 2e7, "kcat_unit": "s^-1", "condition_flags": ["kcat_magnitude_needs_check"]},
    ]


class OverviewTests(unittest.TestCase):
    def write_fixture(self, directory, rows, marks):
        path = Path(directory) / "public.jsonl.gz"
        with gzip.open(path, "wt") as handle:
            for row in rows:
                handle.write(json.dumps(row) + "\n")
        marks_path = Path(directory) / "marks.json"
        marks_path.write_text(json.dumps({"schema": "catlog-human-review-marks/1", "marks": marks}))
        statuses = {}
        for row in rows:
            statuses[row["verification_status"]] = statuses.get(row["verification_status"], 0) + 1
        manifest = {"source_sha256": "source", "total_rows": len(rows),
                    "enriched_download": {"sha256": hashlib.sha256(path.read_bytes()).hexdigest()},
                    "summary": {"distributions": {"verification_status": [
                        {"label": label, "count": count} for label, count in statuses.items()]}}}
        return manifest, path, marks_path

    def test_overview_counts_follow_the_page_rules(self):
        with tempfile.TemporaryDirectory() as directory:
            marks = {"a": {"checked": True}, "b": {"checked": False, "note": "n"}, "c": {"checked": True}, "zz": {"checked": True}}
            manifest, path, marks_path = self.write_fixture(directory, overview_rows(), marks)
            result = followup.build_overview(manifest, path, marks_path)
        self.assertEqual(result["download_sha256"], manifest["enriched_download"]["sha256"])
        self.assertEqual((result["records"], result["accepted"], result["accepted_as_reported"], result["corrected"]), (4, 2, 1, 1))
        self.assertEqual(result["from_paper"], {"records": 1, "papers": 1})
        # PMID 111, DOI 10.1/x (both spellings), stand-in NP1a2b3c4d; record d has no paper.
        self.assertEqual((result["papers"], result["with_paper"]), (3, 3))
        self.assertEqual((result["human_checked_accepted"], result["human_marked"]), (1, 3))
        # Names fold case and spacing; Unknown and blank are not names.
        self.assertEqual((result["enzymes"], result["organisms"], result["substrates"], result["ec_numbers"]), (2, 2, 2, 3))
        classes = {item["class"]: (item["count"], item["accepted"]) for item in result["ec_classes"]}
        self.assertEqual(classes[1], (2, 2))
        self.assertEqual(classes[2], (1, 1))
        self.assertEqual(classes[3], (1, 0))
        self.assertEqual(classes[7], (0, 0))
        self.assertEqual((result["ec_class_none"], result["ec_class_multiple"]), (1, 1))
        # One organism whatever its capitals (the Browse organism filter ignores them).
        self.assertEqual(result["top_organisms"][0], {"name": "Homo sapiens", "count": 2})
        self.assertNotIn("Unknown", [item["name"] for item in result["top_organisms"]])
        self.assertEqual(result["top_ec"][0], {"ec": "1.1.1.1", "name": "alcohol dehydrogenase", "count": 2})
        self.assertEqual(result["enzyme_form"], {"wild": 1, "variant": 3, "not_stated": 0})
        self.assertEqual(sum(result["enzyme_form"].values()), result["records"])
        # pH 21 is not a pH; 303.15 K is 30 °C.
        self.assertEqual(result["conditions"], {"temperature": 2, "ph": 1, "both": 1})
        # Record a's kcat/Km agrees with 2.0 / 0.3 within its printed precision, so it is not flagged.
        self.assertEqual(result["cautions"], {"differs": 1, "units": 1, "unit_missing": 1, "temperature": 1, "none": 1})
        self.assertEqual(result["sources"], {"paper": 1, "brenda": 1, "sabio_rk": 0, "oed": 1, "uniprot": 0, "skid": 0, "other": 1})
        self.assertEqual(sum(result["sources"].values()), result["records"])
        kcat = result["metrics"]["kcat"]
        # The kcat without a unit is left out; 2 and 2e7 s^-1 remain.
        self.assertEqual((kcat["unit"], kcat["n"], kcat["median"]), ("s^-1", 2, 1e7))
        self.assertTrue(12 <= len(kcat["counts"]) <= 16)
        self.assertEqual(sum(kcat["counts"]), kcat["n"])
        # A zero Km has no logarithm: only the two positive Km values count.
        self.assertEqual(result["metrics"]["km"]["n"], 2)
        self.assertEqual(result["metrics"]["kcat_over_km"]["n"], 1)
        self.assertLess(len(json.dumps(result, separators=(",", ":"))), 6000)

    def test_overview_without_marks_and_hash_binding(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest, path, _marks = self.write_fixture(directory, overview_rows(), {})
            result = followup.build_overview(manifest, path)
            self.assertNotIn("human_checked_accepted", result)
            manifest["total_rows"] = 5
            with self.assertRaisesRegex(ValueError, "statuses"):
                followup.build_overview(manifest, path)
            manifest["enriched_download"]["sha256"] = "different"
            with self.assertRaisesRegex(ValueError, "hash"):
                followup.build_overview(manifest, path)

    def test_metric_histogram_bins(self):
        values = [10.0 ** exponent for exponent in range(-3, 3)] + [5e9]
        summary = followup.metric_summary(values, "mM")
        self.assertTrue(12 <= len(summary["counts"]) <= 16)
        self.assertEqual(sum(summary["counts"]), len(values))
        start = summary["log10_start"]
        self.assertEqual(summary["counts"][-3 - start], 1, "1e-3 falls in its own decade")
        self.assertEqual(followup.metric_summary([], "mM"), {"unit": "mM", "n": 0})
        wide = followup.metric_summary([10.0 ** exponent for exponent in range(-30, 30)], "s^-1")
        self.assertEqual(len(wide["counts"]), 16)
        self.assertEqual(sum(wide["counts"]), 60, "Values beyond the range go into the end bins")
