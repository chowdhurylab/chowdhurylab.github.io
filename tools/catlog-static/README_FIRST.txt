CatLog dataset notes

Files
- Full data (catlog-enriched.<id>.jsonl.gz): gzip-compressed JSON Lines, one row per line, all fields below.
- Table (catlog-table.<id>.jsonl.gz): the same rows in the same order, without sequences, SMILES, paper IDs,
  assay_conditions_summary (it has ph and temperature) or printed values; join it to Full data on record_key.
- Load with pandas: pandas.read_json(path, lines=True, compression="gzip").

Units
- kcat in s^-1 (kcat_unit "s^(-1)"); Km and Ki in mM (km_unit, ki_unit "mM");
  kcat/Km in mM^-1 s^-1 (kcat_over_km_unit "s^(-1)*mM^(-1)").
- kcat, km, ki and kcat_over_km are numbers; kcat_display, km_display, ki_display and kcat_over_km_display are
  the strings the page shows.
- Always read the *_unit field: an empty one means the source gave no unit (condition_flags then says
  unit_not_recorded_kcat or unit_not_recorded_km) and the number is not in the column unit; a few older
  database rows keep another unit there (min^-1, mg/mL, uM, M^-1 s^-1).
- CatLog v2 rows keep the precision the paper printed: code converted each printed value to the units above and
  rounded it to the significant figures of the printed number (at least 2); a kcat/Km worked out from kcat and Km
  has the significant figures of the less precise of the two.
- temperature_c (deg C) and temperature_k (K); ph. Empty means the paper or source gives none.
- kcat_over_km_origin: paper_reported, source_listed, calculated (kcat / Km, not printed) or not_specified.

Main fields
- record_key: the row id. enzyme_display_name, ec_number, organism, substrate_name, smiles.
- "Unknown" (EC, organism, substrate): not stated in the paper or the source database.
- primary_uniprot_id; sequence (the variant sequence when one was built, otherwise the reference),
  wild_type_sequence, variant_sequence; wild_type (true, false or empty = not known);
  mutation_signature (for example H150A; "Unknown" on wild-type rows and where no mutation is given).
- pubmed_id, doi, supporting_pmids, supporting_dois: the paper; assay_conditions_summary: other assay conditions
  (buffer, cosubstrate and the like; on older rows also pH and temperature).
- verification_status: verified and corrected (shown as Accepted), manual_review_required (Checks pending),
  unverified, mathematically_inferred (Not reviewed), disputed; public_trust_basis identity_only = Accepted
  (no paper linked: no PMID or DOI, so the value cannot be checked against a paper).
- CatLog v2 rows (verification_method starts with catlog_v2_read_and_independent_verify): read from the paper by an
  AI model (Claude, Anthropic) and checked against the paper by a second, separate AI run; code converted the units.
  proof_lines gives each value as printed (raw_value, raw_unit, table_label; printed joins the two), the printed
  line it was read from (printed_line, given once per line), what the second run found (check: confirmed, or
  corrected and what) and how code converted it (conversion; empty when the number is stored as printed). Their
  kcat_over_km_quotient_mismatch flag means the printed kcat/Km differs from kcat / Km by more than CatLog allows
  (1.5x, widened by printed uncertainties) and more than the printed figures explain; all three stay as printed.
- Other rows come mostly from the enzyme databases listed below, checked by an earlier automated pipeline (AI
  models and code checks).
- human-checked (on the page; data/human-review-marks.json, keyed by record_key): a human reviewer approved every
  value the record shows (on CatLog v2 rows, the same values in the earlier catalog).
- condition_flags: checks to make before using a value (unit_not_recorded_kcat, unit_not_recorded_km,
  kcat_over_km_quotient_mismatch, kcat_over_km_unit_mismatch, km_magnitude_needs_check, kcat_magnitude_needs_check,
  efficiency_above_diffusion_limit, temperature_*_needs_check); empty when none applies.
- source_record_count above 1: the row merges several database rows; supporting_pmids lists their papers.
- Rows of one paper share pubmed_id: split training and test sets by paper or by primary_uniprot_id.
- source_db and source_license: the database(s) a row came from and the license that applies.
- enzyme, substrate, uniprot, status and source repeat enzyme_display_name, substrate_name, uniprot_id,
  verification_status and source_db.

License
- CatLog's own compilation, the rows CatLog v2 read from the papers (source_db primary_paper_direct with a
  verification_method that starts with catlog_v2_read_and_independent_verify), is released under CC BY 4.0: cite the
  snapshot and the CatRange paper below. Their source_license field reads "as published (see paper)": CC BY 4.0 covers
  CatLog's compilation, and text quoted from a paper (the excerpts in proof_lines) remains the publisher's.
- Rows from other databases keep their own license (source_license; "Data sources, licenses and attribution" below).
  A source_license that includes CC BY-NC-ND 4.0 (SKiD) allows non-commercial use only, without derivatives.

Cite
- CatLog snapshot 2026-10-12 (data ID 14ffa6600b), Chowdhury Lab, https://chowdhurylab.github.io/tools/catlog-latest.html
- Sajeevan, K. A., et al. (2026). CatRange enables robust prediction of enzyme variant kinetic regimes.
  PNAS Nexus, pgag309. doi: 10.1093/pnasnexus/pgag309 (https://doi.org/10.1093/pnasnexus/pgag309)
  The CatRange paper describes CatLog-27k (27,176 kinetic records curated from BRENDA and SABIO-RK), the set its models
  were trained on; CatLog is the growing catalog that followed. The current method (CatLog v2) is described under
  Main fields.

Snapshot details
- Rows: 168765
- Generated (UTC): 2026-10-12T09:46:03+00:00
- Exporter commit: cc5d91d7be13c4e268ac2c1b783afc90386ed985
- Source: verified_catlog.jsonl
- Source SHA-256: d07bba45c1d3b6754116bebc6fbfbc50511f14380738c2e11109b84b48785aa9
- Public content SHA-256 (decompressed all-public-data JSONL): 14ffa6600b55a3896094f59d77c4a13cbedf202e3b142a4f3887d835e1cadd9b
- Package: compact_public
- Contents: Full row coverage with compact public-facing fields. Raw source snapshots and private review payloads are not bundled.
- All public data: downloads all rows with available protein sequences, SMILES, references, and source details
- Analysis aliases: enzyme, substrate, uniprot, status, and source
- Table index: downloads a smaller all-row index without protein or substrate structure strings
- Download page: exports the displayed rows with public molecular identity, references, and source details
- All public data file: data/catlog-enriched.a553ca1de6e2.jsonl.gz
- Rows with sequence: 86480
- Rows with wild-type sequence: 82127
- Rows with variant sequence: 25481
- Rows with SMILES: 105937

Data sources, licenses and attribution
- BRENDA (brenda): 83759 rows; license CC BY 4.0; https://www.brenda-enzymes.org/
- Primary literature (direct extraction) (primary_paper_direct): 33778 rows; license as published (see paper)
- Open Enzyme Database (OED) (oed): 19920 rows; license CC BY 4.0; https://openenzymedb.platform.moleculemaker.org/
- UniProt (uniprot): 14854 rows; license CC BY 4.0; https://www.uniprot.org/
- SABIO-RK (sabio_rk): 12169 rows; license SABIO-RK terms (free for academic use; see sabiork.h-its.org); https://sabiork.h-its.org/
- SKiD (Structure-Oriented Kinetics Database) (skid): 4217 rows; license CC BY-NC-ND 4.0; https://zenodo.org/records/15355031
- STRENDA DB (strenda): 3 rows; license see source; https://www.beilstein-strenda-db.org/
- Every row carries source_license, derived from the database(s) it was merged from.
- SKiD-derived rows carry a NonCommercial-NoDerivatives license (CC BY-NC-ND 4.0); reuse them only under those terms.
- For reuse of CatLog review notes and corrections, contact the Chowdhury Lab.
