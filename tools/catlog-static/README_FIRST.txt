CatLog dataset notes

CatLog in brief
- CatLog is a catalog of enzyme kinetic values (kcat, Km, kcat/Km and Ki), each with its enzyme, organism, substrate,
  variant, assay conditions and source. This snapshot (2026-10-13) holds 169,413 records, 53,545 of them accepted.
- 44,627 records were read from the paper by CatLog (1,919 papers); the other 124,786 come from enzyme databases (the
  earlier catalog).

How the values were obtained and checked
- Read from the paper by CatLog (the CatLog v2 method): CatLog reads papers directly. An AI model (Claude, Anthropic)
  reads each kcat, Km and kcat/Km with its unit, enzyme, organism, substrate and assay conditions. A second, separate
  AI check compares every value with the paper. Code confirms that the quoted line is in the paper text, and converts
  units where the paper's differ from the catalog's. Each value keeps where it is printed and the number as printed. A
  person has not checked these values unless the record is marked human-checked.
- From enzyme databases (the earlier catalog): BRENDA, SABIO-RK, the Open Enzyme Database (OED), UniProt and SKiD,
  plus earlier paper extractions and rows with no source recorded. An earlier automated pipeline of AI models and code
  checks screened them; it stopped on 2026-10-09. When CatLog reads a paper, its records replace that paper's earlier
  ones.
- Review result (verification_status): verified or corrected = Accepted (53,545); manual_review_required = Not
  confirmed (the earlier review left a question open); unverified or mathematically_inferred = Not checked; disputed =
  Disputed. An accepted record has a linked paper: 173 older records that the earlier review accepted but that have no
  PMID or DOI (public_trust_basis identity_only) are mathematically_inferred, not accepted. 58 older records are
  accepted because a human reviewer approved every value, although the earlier review had not accepted them
  (accepted_basis "human review").

Quality checks
- AI audits: 1,081 values re-checked against their papers by a separate AI auditor that tries to find errors; 3 (0.3%)
  were wrong and removed.
- Human review: 1,543 accepted records are human-checked: a human reviewer approved every value shown. In the earlier
  catalog, 19 of 3,887 values reviewers compared had a wrong number or unit (99.5% correct), and 137 had a wrong
  enzyme, organism, substrate, variant or protein label.
- Agreement with human reviewers (as of 2026-10-12): reviewers checked 291 papers of the earlier catalog that CatLog
  has since read, and approved 3,838 values on them. At the first comparison, before any fix it prompted, CatLog had
  the same value for 85.6% of those on the 271 papers it read fully blind (95% range 80.9-89.9; 86.8% on all of them).
  That comparison found 68 label or annotation errors in CatLog (a UniProt entry, substrate structure or variant
  field) and 1 missed value, and 0 wrong kcat or Km numbers; after fixing them CatLog has the same value for 3,412
  (88.9%). Of the 426 that still differ, CatLog's own check against the paper (not the reviewers') has covered 323:
  CatLog right in 142 (the earlier catalog had a wrong value in 19 and a wrong enzyme, organism, substrate, variant or
  protein label in 123); the same printed value under another name in 134; rounding in 3; CatLog wrong in 0; not
  comparable in 44 (CatLog left the value out under its reading rules). The other 103 are not checked yet. Reviewers
  also named 58 values the earlier catalog lacked; CatLog has 53 of them. No record read by CatLog has been reviewed
  directly yet.

Files
- Full data (catlog-enriched.<id>.jsonl.gz): gzip-compressed JSON Lines, one row per line, every field below.
- Table (catlog-table.<id>.jsonl.gz): the same rows in the same order, without the fields marked * below (no
  sequences, SMILES, paper IDs, printed values or assay_conditions_summary); join it to Full data on record_key.
- Load with pandas: pandas.read_json(path, lines=True, compression="gzip").
- Rows of one paper share pubmed_id: split training and test sets by paper or by primary_uniprot_id.

Units
- kcat in s^-1 (kcat_unit "s^(-1)"); Km and Ki in mM (km_unit, ki_unit "mM"); kcat/Km in mM^-1 s^-1 (kcat_over_km_unit
  "s^(-1)*mM^(-1)"); temperature_c in deg C and temperature_k in K.
- Always read the *_unit field: an empty one means the source gave no unit (condition_flags then says
  unit_not_recorded_kcat or unit_not_recorded_km) and the number is not in the column unit; a few older database rows
  keep another unit there (min^-1, mg/mL, uM, M^-1 s^-1).
- Rows read from the paper by CatLog keep the precision the paper printed: code converted each printed value to the
  units above and rounded it to the significant figures of the printed number (at least 2); a kcat/Km worked out from
  kcat and Km has the significant figures of the less precise of the two.
- Empty means the paper or source gives none; "Unknown" (EC, organism, substrate): not stated in the paper or the
  source database.

Fields (* = Full data only)
- Record: record_key (the record ID), measurement_key.
- Enzyme and organism: enzyme_display_name, enzyme_label_source and enzyme_name_source (where the name comes from),
  ec_number, organism.
- Protein: primary_uniprot_id, uniprot_id*, uniprot_candidate_ids (possible UniProt entries when none was chosen),
  protein_accession and protein_accession_database (the UniProt or NCBI Protein entry), source_protein_accession (the
  accession the source gave, when it differs), has_sequence, sequence_resolved, sequence* (the variant sequence when
  one was built, otherwise the reference), wild_type_sequence*, variant_sequence*, sequence_source*,
  sequence_source_confidence, sequence_variant_status, sequence_variant_note* (what the sequence shown is).
- Variant: wild_type (true, false or empty = not known), mutation_type*, mutation_signature (for example H150A;
  "Unknown" on wild-type rows and where no mutation is given).
- Substrate: substrate_name, smiles*.
- Values: kcat, km, ki and kcat_over_km (numbers in the units above), kcat_unit, km_unit, ki_unit and
  kcat_over_km_unit, kcat_display, km_display, ki_display and kcat_over_km_display (the text the page shows), has_ki;
  kcat_over_km_origin (paper_reported, source_listed, calculated = kcat / Km and not printed, or not_specified),
  source_kcat_over_km_values* (the kcat/Km values the source databases list) and kcat_over_km_source_differs (one of
  them differs from kcat_over_km).
- Conditions: ph, ph_display, temperature_c, temperature_k, temperature_display; assay_conditions_summary* (other
  assay conditions: buffer, cosubstrate and the like; on older rows also pH and temperature); condition_note* (on a
  row read from the paper by CatLog that shows the same values as another row of the paper: the conditions that tell
  them apart).
- Cautions: condition_flags lists reasons a value may be wrong: unit_not_recorded_kcat, unit_not_recorded_km,
  kcat_over_km_quotient_mismatch (the kcat/Km shown differs from kcat / Km; on rows read from the paper by CatLog by
  more than 1.5x, widened by printed uncertainties, and more than the printed figures explain; all three stay as
  printed), kcat_over_km_unit_mismatch, kcat_over_km_source_mismatch (every kcat/Km the source databases list is more
  than 2-fold from the kcat/Km shown), km_magnitude_needs_check (Km above 10 M or below 1 nM),
  kcat_magnitude_needs_check (kcat above 10^8 s^-1), efficiency_above_diffusion_limit, temperature_*_needs_check;
  empty when none applies.
- Paper: pubmed_id*, doi*, supporting_pmids* and supporting_dois* (every paper of a merged row), pmid_count,
  doi_count, literature_id_count, has_literature_id.
- Evidence: proof_lines* gives each value as printed: where (table_label, row_label, column_label), which value
  (metric, metric_label), the printed number and unit (raw_value, raw_unit; raw_value_unit_evidence as text), the
  value in the units above (normalized_value, normalized_unit; normalized_value_unit_evidence as text),
  assay_condition, pmid and doi; on rows read from the paper by CatLog also printed (number and unit as printed),
  printed_line (the line it was read from, once per line), check (what the second, separate AI check found: confirmed,
  or corrected and what), conversion (how code converted it; empty when stored as printed), value_display (the value
  in the units above with the printed figures: a printed 135.0 stays 135.0) and, for a value an AI audit re-checked,
  audit_date and audit_result (kept or unit corrected). proof_kind (paper_evidence or source_note) and
  has_proof_excerpt say whether there is any.
- Review: verification_status, public_trust_basis (literature_referenced: accepted with a linked paper; identity_only:
  the earlier review accepted it, but no PMID or DOI is linked, so it is not accepted; empty on other records),
  accepted_basis* ("human review": accepted because a human reviewer approved every value). human-checked records are
  listed in human-review-marks.json on the site, keyed by record_key.
- Source and license: source_db, source_databases_merged*, source_record_count (above 1: the row merges several
  database rows), source_license.
- Short names: enzyme*, substrate*, uniprot*, status* and source* repeat enzyme_display_name, substrate_name,
  uniprot_id, verification_status and source_db.
- Earlier-pipeline provenance, not needed for analysis: verification_method* (on rows read from the paper by CatLog it
  starts with "catlog_"), evidence_confidence_tier, paper_grounding_status, literature_linkage,
  identity_resolution_state, data_origin*, review_key.

License
- Read from the paper by CatLog: 44,627 rows, CatLog compilation, CC BY 4.0: cite the snapshot and the CatRange paper
  below. Text quoted from a paper (the printed lines in proof_lines) remains the publisher's. Their source_license
  reads "CC BY 4.0 (CatLog compilation); quoted paper text remains the publisher's".
- The other rows keep the license of the database they came from; source_license names each license of a merged row:
  - CC BY 4.0: 107,860 rows from BRENDA, OED and UniProt.
  - SABIO-RK terms (free for academic use): 11,039 rows, alone or merged with a CC BY 4.0 row.
  - CC BY-NC-ND 4.0, non-commercial use only, no derivatives: 5,709 rows, every row whose source_license includes it:
    4,181 with SKiD as their source and 1,528 BRENDA, SABIO-RK or UniProt rows a SKiD record was merged into. Filter
    on source_license, not on source_db.
  - As published (see paper): 24 rows from earlier paper extractions. See source: 154 rows.
- For reuse of CatLog review notes and corrections, contact the Chowdhury Lab.
- Sources (source_db; a row merged from several databases counts under each):
  - BRENDA (brenda): 80,276 rows; CC BY 4.0; https://www.brenda-enzymes.org/
  - Read from the paper by CatLog (primary_paper_direct): 44,627 rows, CatLog compilation CC BY 4.0, text quoted from
    a paper remains the publisher's; 24 earlier paper extractions: as published (see paper).
  - Open Enzyme Database (OED) (oed): 14,531 rows; CC BY 4.0; https://openenzymedb.platform.moleculemaker.org/
  - UniProt (uniprot): 14,243 rows; CC BY 4.0; https://www.uniprot.org/
  - SABIO-RK (sabio_rk): 11,452 rows; SABIO-RK terms (free for academic use; see sabiork.h-its.org);
    https://sabiork.h-its.org/
  - SKiD (Structure-Oriented Kinetics Database) (skid): 4,181 rows; CC BY-NC-ND 4.0;
    https://zenodo.org/records/15355031
  - STRENDA DB (strenda): 3 rows; see source; https://www.beilstein-strenda-db.org/
  - No source recorded (unknown): 151 rows; see source.

Cite
- CatLog snapshot 2026-10-13 (data ID 3df64d5f0c), Chowdhury Lab,
  https://chowdhurylab.github.io/tools/catlog-latest.html
- Sajeevan, K. A., et al. (2026). CatRange enables robust prediction of enzyme variant kinetic regimes. PNAS Nexus,
  pgag309. doi: 10.1093/pnasnexus/pgag309 (https://doi.org/10.1093/pnasnexus/pgag309). The CatRange paper describes
  CatLog-27k (27,176 kinetic records curated from BRENDA and SABIO-RK), the set its models were trained on; CatLog is
  the growing catalog that followed.
- If you use rows from a database, cite that database as it asks: BRENDA, SABIO-RK, SKiD (Zenodo 15355031), the Open
  Enzyme Database, UniProt (links under License).
- Keep the file you used: older snapshots leave the site over time.

Snapshot details
- Rows: 169,413. Generated (UTC): 2026-10-13T02:09:44+00:00.
- Data ID 3df64d5f0c: the first 10 characters of the SHA-256 of the decompressed Full data (gunzip -c
  catlog-enriched.<id>.jsonl.gz | shasum -a 256): 3df64d5f0cb26948c9a1134aad1aba0d441b1e3147ead25dea80475a1faa830c.
- Full data file catlog-enriched.70f39d7a4285.jsonl.gz, SHA-256
  70f39d7a428597c679117c0e200c2cb126ba45b53f628bc0341ace750f81f3ec.
- Table file catlog-table.f43d7c60b121.jsonl.gz, SHA-256
  f43d7c60b1210e987ddad1064feb1f161e470c2265e9cf11ac04c4e44a0398b0.
- SHA-256 of the catalog file this snapshot was built from:
  7c910e56933b1164f286171a959f31b06da4d076aebd81a23b59c1e4ed1040e2.
- Rows with a sequence: 86,117 (wild-type sequence 81,888, variant sequence 25,111); rows with SMILES: 107,655.
