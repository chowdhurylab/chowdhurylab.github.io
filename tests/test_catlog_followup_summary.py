import gzip
from collections import Counter, defaultdict
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
         "mutation_signature": "S70A", "kcat": 2e9, "kcat_unit": "s^-1", "condition_flags": ["kcat_magnitude_needs_check"]},
    ]


class OverviewTests(unittest.TestCase):
    def write_fixture(self, directory, rows, marks, quality=None):
        path = Path(directory) / "public.jsonl.gz"
        with gzip.open(path, "wt") as handle:
            for row in rows:
                handle.write(json.dumps(row) + "\n")
        marks_path = Path(directory) / "marks.json"
        payload = {"schema": "catlog-human-review-marks/1", "marks": marks}
        if quality is not None:
            payload["quality"] = quality
        marks_path.write_text(json.dumps(payload))
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
        classes = {item["class"]: (item["count"], item["accepted"], item["from_paper"]) for item in result["ec_classes"]}
        self.assertEqual(classes[1], (2, 2, 1))
        self.assertEqual(classes[2], (1, 1, 0))
        self.assertEqual(classes[3], (1, 0, 0))
        self.assertEqual(classes[7], (0, 0, 0))
        # CatLog v2 entries alone: their organisms and EC numbers (Browse: source=paper with the organism or EC filter)
        # and how many values were read from each paper (record a: kcat, Km and the printed kcat/Km).
        self.assertEqual(result["top_organisms_from_paper"], [{"name": "Homo sapiens", "count": 1}])
        self.assertEqual(result["top_ec_from_paper"], [{"ec": "1.1.1.1", "name": "alcohol dehydrogenase", "count": 1}])
        self.assertEqual(result["from_paper_values"], {"values": 3, "bins": [1, 2, 5, 10, 20, 50, 100, 200, 500],
                                                       "papers": [0, 1, 0, 0, 0, 0, 0, 0, 0]})
        self.assertEqual(sum(result["from_paper_values"]["papers"]), result["from_paper"]["papers"])
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
        # A merged source ("sabio_rk;brenda") counts under each source it names, as the Browse source filter finds it.
        self.assertEqual(result["sources"], {"paper": 1, "brenda": 2, "sabio_rk": 1, "oed": 1, "uniprot": 0, "skid": 0, "strenda": 0, "other": 0})
        # The main source counts each record once, with its review status: CatLog's own reading, one database, or
        # several databases (Stats figure 2).
        self.assertEqual(result["main_sources"], {"catlog": {"verified": 1}, "brenda": {"corrected": 1}, "oed": {"unverified": 1},
                                                  "several": {"manual_review_required": 1}})
        self.assertEqual(sum(sum(item.values()) for item in result["main_sources"].values()), result["records"])
        self.assertEqual(followup.main_source({"source_db": "primary_paper_direct"}), "earlier_paper")
        self.assertEqual(followup.main_source({"source_db": "unknown"}), "unrecorded")
        self.assertEqual(followup.main_source({"source_db": "brenda; skid"}), "several")
        self.assertEqual(followup.main_source({"source_db": "mixed", "source_databases_merged": ["brenda", "skid"]}), "several")
        self.assertEqual(followup.main_source({"source_db": "mixed"}), "several")
        kcat = result["metrics"]["kcat"]
        # The kcat without a unit is left out; 2 and 2e9 s^-1 remain.
        self.assertEqual((kcat["unit"], kcat["n"], kcat["median"]), ("s^-1", 2, 1e9))
        self.assertTrue(12 <= len(kcat["counts"]) <= 16)
        self.assertEqual(sum(kcat["counts"]), kcat["n"])
        # A zero Km has no logarithm: only the two positive Km values count.
        self.assertEqual(result["metrics"]["km"]["n"], 2)
        self.assertEqual(result["metrics"]["kcat_over_km"]["n"], 1)
        # Per enzyme class on one half-decade grid per metric: record b's Km counts in classes 1 and 2 (as ec_classes
        # counts it); record c has no class; record d's kcat is in class 3.
        km = result["metrics"]["km"]["by_class"]
        self.assertEqual((km["bin_width"], [item["class"] for item in km["classes"]]), (0.5, [1, 2]))
        self.assertEqual([(item["n"], item["median"]) for item in km["classes"]], [(2, 1.15), (1, 2.0)])
        for metric in ("kcat", "km", "kcat_over_km"):
            grid = result["metrics"][metric]["by_class"]
            self.assertTrue(all(14 <= len(item["counts"]) <= 18 and sum(item["counts"]) == item["n"] for item in grid["classes"]))
            self.assertEqual(len({len(item["counts"]) for item in grid["classes"]}), 1, "One grid for every class")
        self.assertEqual([item["class"] for item in result["metrics"]["kcat"]["by_class"]["classes"]], [1, 3])
        self.assertLess(len(json.dumps(result, separators=(",", ":"))), 8000)

    def test_listed_kcat_over_km_mismatch_is_a_kcat_over_km_caution(self):
        # CatLog's flag for an older record whose every listed kcat/Km is more than 2-fold from the one shown (plan P7)
        # counts where Browse's caution=differs finds it, not under No cautions.
        self.assertEqual(followup.caution_keys({"condition_flags": ["kcat_over_km_source_mismatch"]}), {"differs"})
        self.assertEqual(followup.caution_keys({"condition_flags": ["km_magnitude_needs_check", "kcat_over_km_source_mismatch"]}),
                         {"differs", "units"})

    def test_magnitude_cautions_use_catlogs_bounds(self):
        # Km below 1 nM is a magnitude caution; kcat is one only above 10^8 s^-1 (an older snapshot flagged it from 10^7).
        self.assertEqual(followup.caution_keys({"km": 2e-14, "km_display": "2e-14", "km_unit": "mM", "condition_flags": []}), {"units"})
        self.assertEqual(followup.caution_keys({"km": 2e-6, "km_display": "2e-06", "km_unit": "mM", "condition_flags": []}), set())
        self.assertEqual(followup.caution_keys({"kcat": 3e7, "kcat_display": "3e+7", "kcat_unit": "s^(-1)",
                                                "condition_flags": ["kcat_magnitude_needs_check"]}), set())
        self.assertEqual(followup.caution_keys({"kcat": 7e12, "kcat_display": "7e+12", "kcat_unit": "s^(-1)",
                                                "condition_flags": ["kcat_magnitude_needs_check"]}), {"units"})
        # A kcat in another unit cannot be judged here: its flag stays.
        self.assertEqual(followup.caution_keys({"kcat": 3e7, "kcat_unit": "min^(-1)", "condition_flags": ["kcat_magnitude_needs_check"]}),
                         {"units"})

    def test_top_organisms_count_as_the_browse_filter_finds_them(self):
        raw = Counter({"Escherichia coli": 5, "Escherichia coli K-12": 3, "Saccharomyces cerevisiae": 4,
                       "Saccharomyces cerevisiae (strain ATCC 204508 / S288c)": 2, "Homo sapiens": 2, "human": 1,
                       "Escherichia  coli": 1, "Unknown": 2})
        spellings = defaultdict(Counter)
        for organism, count in raw.items():
            name = " ".join(organism.split())
            if followup.name_key(name):
                spellings[followup.name_key(name)][name] += count
        result = followup.top_organisms(spellings, raw)
        # Strains count with their species and are not listed again; "human" (whose Browse results include Homo
        # sapiens) is not listed beside the more common Homo sapiens; spacing does not matter.
        self.assertEqual(result, [{"name": "Escherichia coli", "count": 9},
                                  {"name": "Saccharomyces cerevisiae", "count": 6},
                                  {"name": "Homo sapiens", "count": 2}])
        # A common name matches as a whole word: "rat" is not inside Serratia.
        self.assertTrue(followup.organism_matches("Rattus norvegicus", ["rat"]))
        self.assertFalse(followup.organism_matches("Serratia marcescens", ["rat"]))
        self.assertTrue(followup.organism_matches("Escherichia coli K-12", ["escherichia", "coli"]))
        self.assertEqual(followup.source_keys("brenda; skid"), {"brenda", "skid"})
        self.assertEqual(followup.source_keys("sabio_rk/brenda+skid"), {"sabio_rk", "brenda", "skid"})
        self.assertEqual(followup.source_keys("unknown"), set())
        self.assertEqual(followup.field_words("β-Galactosidase  4 nitrophenyl"), ["betagalactosidase", "4nitrophenyl"])

    def test_overview_counts_the_earlier_corrections_lists(self):
        # Records not yet re-read list what the earlier version changed (corrections): the overview counts, per value
        # field, the four kinds Stats draws, every other change apart, and the changed values whose number before the
        # change a database lists ("listed"); a record read from the paper is never counted, and an empty or damaged
        # list counts no record.
        rows = overview_rows()
        rows[1]["corrections"] = [
            {"field": "km", "before": 20.0, "after": 2.0, "kind": "magnitude", "unit": "mM", "listed": "BRENDA"},
            {"field": "kcat_over_km", "before": 0.546667, "after": 0.544, "kind": "rounding", "listed": "SABIO-RK"},
            {"field": "kcat", "after": 3.0, "kind": "added", "unit": "s⁻¹"},
            {"field": "km", "before": 1.5, "after": 2.0, "kind": "different", "listed": ""},
            {"field": "uniprot_id", "after": "P12345", "kind": "added"},
            {"field": "sequence", "kind": "replaced"},
            {"field": "kcat", "kind": "removed"},
            "not an item",
        ]
        rows[0]["corrections"] = [{"field": "kcat", "before": 1.0, "after": 2.0, "kind": "different"}]
        rows[2]["corrections"] = []
        rows[3]["corrections"] = {"field": "kcat"}
        with tempfile.TemporaryDirectory() as directory:
            manifest, path, marks_path = self.write_fixture(directory, rows, {})
            result = followup.build_overview(manifest, path, marks_path)
        earlier = result["earlier_corrections"]
        self.assertEqual((earlier["records"], earlier["items"], earlier["other_items"]), (1, 7, 3))
        self.assertEqual(earlier["values"], {
            "kcat": {"rounding": 0, "different": 0, "magnitude": 0, "added": 1},
            "km": {"rounding": 0, "different": 1, "magnitude": 1, "added": 0},
            "kcat_over_km": {"rounding": 1, "different": 0, "magnitude": 0, "added": 0}})
        self.assertEqual(earlier["before_listed"], [2, 3])
        # Without any list there is no figure to draw: the key is left out.
        with tempfile.TemporaryDirectory() as directory:
            manifest, path, marks_path = self.write_fixture(directory, overview_rows(), {})
            self.assertNotIn("earlier_corrections", followup.build_overview(manifest, path, marks_path))

    def test_overview_copies_the_marks_quality(self):
        quality = {"as_of": "2026-10-11T05:05:00", "audit_values": 742, "audit_wrong": 2, "compared_values_v1": 2431,
                   "compared_papers_v1": 312, "wrong_v1": 9, "label_or_annotation_v1": 114, "v2_found": 2160,
                   "v2_found_after_fixes": 2210, "v2_approved_total": 2380, "v2_differences_checked": 504, "v2_wrong": 0,
                   "reviewer": "someone", "audit_wrong_share": 0.27, "v2_wrong_bool": True}
        with tempfile.TemporaryDirectory() as directory:
            manifest, path, marks_path = self.write_fixture(directory, overview_rows(), {"a": {"checked": True}}, quality)
            result = followup.build_overview(manifest, path, marks_path)
            # Only the known whole counts and the date are kept; names, shares and flags are not copied.
            expected = {key: quality[key] for key in followup.QUALITY_FIELDS}
            self.assertEqual(result["quality"], {"as_of": "2026-10-11", **expected})
            self.assertEqual(list(result["quality"])[0], "as_of")
            self.assertIn("marks_sha256", result)
            # A marks file without a quality object (today's) adds none; a broken one is ignored, not guessed.
            manifest, path, marks_path = self.write_fixture(directory, overview_rows(), {"a": {"checked": True}})
            self.assertNotIn("quality", followup.build_overview(manifest, path, marks_path))
            manifest, path, marks_path = self.write_fixture(directory, overview_rows(), {"a": {"checked": True}},
                                                            {"audit_values": "742", "as_of": "2026-10-11"})
            self.assertNotIn("quality", followup.build_overview(manifest, path, marks_path))
            self.assertIsNone(followup.marks_quality({"quality": [1, 2]}))

    def test_overview_copies_the_agreement_headline_and_figure_counts(self):
        # The agreement fields the page renders (catlog-v2 human_review.AGREEMENT_DEFINITIONS), the headline percentage
        # among them; a percentage the CatLog side could not compute (None) is left out, not guessed.
        agreement = {"papers_compared": 98, "values_approved": 2489, "first_agree": 2100, "first_agree_pct": 84.4,
                     "agree": 2232, "agree_pct": 89.7, "fixed_after_comparison": 132, "papers_exposed": 40,
                     "first_agree_unexposed_pct": 84.8, "catlog_value_wrong": 3, "rejected_values": 20,
                     "rejected_catlog_also_without": 12, "rejected_catlog_has_same": 8, "rejected_dropped_after_audit": 2,
                     "rejected_changed_since": 1,
                     "differ": 257, "definitions": {"agree": "text"}, "unknown_field": 4, "first_agree_pct_blind": None}
        figures = {"db_compare": {"kcat": {"same": 9, "differs": 1, "absent": 0}, "papers_all_absent": 2, "note": "text"},
                   "earlier_corrections": {"records": 5, "values": {"kcat": {"rounding": 1, "different": 2, "magnitude": 0,
                                                                            "added": 1}}, "before_listed": [3, 4]},
                   "replaced": {"records": 7, "values": {"kcat": [5, 6], "km": [1, "x"]}}}
        quality = {"as_of": "2026-10-12", "audit_values": 973, "audit_wrong": 2, "agreement": agreement, **figures}
        result = followup.marks_quality({"quality": quality})
        self.assertEqual(result["agreement"], {key: value for key, value in agreement.items()
                                               if key not in ("definitions", "unknown_field", "first_agree_pct_blind")})
        # The comparison with the databases is the manifest's summary.database_comparison: no db_compare is copied.
        self.assertNotIn("db_compare", result)
        self.assertEqual(result["earlier_corrections"], figures["earlier_corrections"])
        # A list with anything but whole counts is dropped whole.
        self.assertEqual(result["replaced"], {"records": 7, "values": {"kcat": [5, 6]}})
        self.assertNotIn("replaced", followup.marks_quality({"quality": {"audit_values": 1, "replaced": [1]}}))

    def test_overview_copies_the_headline_range_and_first_comparison_errors(self):
        # The headline is reported with its 95% range (a "low-high" string), its blind paper count and the errors the
        # first comparison found; a range in any other shape is left out, never guessed.
        blind = {"papers_compared": 160, "values_approved": 2489, "agree": 2232, "papers_exposed": 38,
                 "papers_unexposed": 122, "first_agree_unexposed_pct": 85.3, "first_agree_unexposed_ci95": "79.7-90.6",
                 "first_catlog_errors": 69, "first_catlog_errors_value": 0, "first_catlog_errors_label": 68,
                 "first_catlog_errors_missed": 1, "fixed_after_comparison": 69}
        self.assertEqual(followup.marks_quality({"quality": {"agreement": blind}})["agreement"], blind)
        for bad in ("79.7 to 90.6", "79.7-", "-5-90", "79.7–90.6", None, [79.7, 90.6]):
            result = followup.marks_quality({"quality": {"agreement": {**blind, "first_agree_unexposed_ci95": bad}}})
            self.assertNotIn("first_agree_unexposed_ci95", result["agreement"], bad)
        # Only the headline's range may be a string.
        result = followup.marks_quality({"quality": {"agreement": {**blind, "papers_unexposed": "122"}}})
        self.assertNotIn("papers_unexposed", result["agreement"])

    def test_overview_copies_the_review_headline(self):
        # quality.review (the user's headline from 2026-10-13: what the reviewers' own files say) reaches the overview: per
        # reviewed catalog its numbers, strings and the other_by_kind map; lists, definitions and broken values stay behind.
        v1 = {"entries": 2674, "papers": 408, "entries_without_paper": 166, "approved": 2464, "rejected": 210,
              "value_disputed": 3, "value_correct_pct": 99.9, "value_disputed_checked_as_printed": 3,
              "value_disputed_unchecked": [], "value_missing": 31, "value_missing_pct": 1.2, "value_missing_named": 32,
              "other_disputed": 177, "other_disputed_pct": 6.6,
              "other_by_kind": {"could not find the value": 153, "organism name": 13, "DOI": 5, "substrate name": 3,
                                "duplicate": 2, "paper evidence mismatch": 1, "broken": "x", "": 4}}
        quality = {"as_of": "2026-10-13", "v2_found": 3625, "v2_found_after_fixes": 3625, "v2_approved_total": 4074,
                   "review": {"v1": {**v1, "definitions": {"entries": "text"}, "flag": True, "nested": {"a": 1},
                                     "negative": -1},
                              "v2": {"papers": 3}, "draft": {"entries": 1}}}
        result = followup.marks_quality({"quality": quality})
        kept = {key: value for key, value in v1.items() if key != "value_disputed_unchecked"}
        kept["other_by_kind"] = {key: value for key, value in v1["other_by_kind"].items() if key and key != "broken"}
        # v2 without an entry count and a key that names no catalog are left out
        self.assertEqual(result["review"], {"v1": kept})
        self.assertEqual((result["v2_found"], result["v2_approved_total"]), (3625, 4074))
        self.assertNotIn("review", followup.marks_quality({"quality": {"audit_values": 1, "review": {"v1": [1]}}}))
        self.assertNotIn("review", followup.marks_quality({"quality": {"audit_values": 1, "review": [1]}}))

    def test_overview_keeps_every_agreement_field_the_page_reads(self):
        # Every quality.agreement field the page's code reads reaches the overview; the 2026-10-12 build's shape (the
        # headline's range as a string among whole counts and percentages) is copied whole, its definitions left behind.
        import re
        script = (Path(__file__).resolve().parents[1] / "tools/catlog-static/assets/catlog-static.js").read_text()
        agreement_key = re.compile(r"^(papers_(compared|exposed|unexposed)|values_approved|agree(_pct)?|first_\w+|differ(_\w+)?"
                                   r"|stated_\w+|rejected_\w+|direct_\w+|fixed_after_comparison|catlog_value_wrong"
                                   r"|matched_later_other)$")
        read = {key for key in re.findall(r"\ba\.([a-z][a-z0-9_]*)|\"([a-z][a-z0-9_]*)\"", script) for key in key if key}
        read = {key for key in read if agreement_key.match(key)}
        # The first-comparison and blind fields are reference only (the user, 2026-10-13): the page reads none of them.
        self.assertFalse({key for key in read if key.startswith("first_") or "unexposed" in key}, read)
        self.assertIn("agree", read)
        self.assertEqual(read - set(followup.AGREEMENT_FIELDS), set())
        fresh = {"papers_compared": 291, "values_approved": 3838, "first_agree": 3332, "first_agree_pct": 86.8, "agree": 3412,
                 "agree_pct": 88.9, "first_catlog_errors": 69, "first_catlog_errors_value": 0,
                 "first_catlog_errors_label": 68, "first_catlog_errors_missed": 1, "fixed_after_comparison": 69,
                 "matched_later_other": 11, "papers_exposed": 14, "first_agree_unexposed_pct": 85.6, "papers_unexposed": 271,
                 "first_agree_unexposed_ci95": "80.9-89.9", "catlog_value_wrong": 0, "differ": 426, "rejected_values": 9,
                 "rejected_catlog_also_without": 0, "rejected_catlog_has_same": 9, "rejected_kept_after_audit": 4,
                 "rejected_cleared_by_paper_check": 5, "rejected_not_value": 37, "direct_values_reviewed": 0}
        quality = {"as_of": "2026-10-12", "v2_found": 3332, "v2_found_after_fixes": 3412, "v2_approved_total": 3838,
                   "agreement": {**fresh, "definitions": {"agree": "text"}}}
        result = followup.marks_quality({"quality": quality})
        self.assertEqual(result["agreement"], fresh)
        self.assertEqual((result["v2_found"], result["v2_found_after_fixes"]), (3332, 3412))

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

    def test_class_histograms_share_one_grid(self):
        values = [10.0 ** (exponent / 4) for exponent in range(-12, 13)] + [1e-12, 1e12]
        start, bins = followup.class_grid(sorted(values))
        self.assertTrue(14 <= bins <= 18)
        self.assertEqual(start * 2, round(start * 2), "Edges on half decades")
        grid = followup.by_class(values, {1: values, 4: values[:5], 6: []})
        self.assertEqual([item["class"] for item in grid["classes"]], [1, 4], "A class without values is left out")
        whole = grid["classes"][0]
        self.assertEqual(sum(whole["counts"]), len(values), "Values beyond the grid go into the end bins")
        self.assertEqual((whole["counts"][0] > 0, whole["counts"][-1] > 0), (True, True))
        # 1 sits at the start of its own bin, not the one below.
        one = followup.class_summary([1.0], start, bins)["counts"]
        self.assertEqual(one.index(1), round((0 - start) / 0.5))
        self.assertIsNone(followup.by_class([], {}))
        # Values per paper: papers in bins from 1, 2, 5, 10 ... values; a paper with none is counted apart.
        self.assertEqual(followup.values_per_paper({"p1": 1, "p2": 4, "p3": 5, "p4": 600, "p5": 0}),
                         {"values": 610, "bins": [1, 2, 5, 10, 20, 50, 100, 200, 500], "papers": [1, 1, 1, 0, 0, 0, 0, 0, 1],
                          "no_values": 1})
        self.assertEqual(followup.paper_values({"kcat": 1, "km": 2, "kcat_over_km": 3, "kcat_over_km_origin": "calculated"}), 2)
        self.assertEqual(followup.paper_values({"kcat": 0, "km": None, "kcat_over_km": 3}), 2)

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
