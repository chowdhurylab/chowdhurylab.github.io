CatLog dataset notes

Files
- Full data (catlog-enriched.<id>.jsonl.gz): gzip-compressed JSON Lines, one row per line, all fields below.
- Table (catlog-table.<id>.jsonl.gz): the same rows in the same order, without sequences, SMILES, paper IDs,
  assay_conditions_summary (it has ph and temperature) or printed values; join it to Full data on record_key.
- Python: pandas.read_json(path, lines=True, compression="gzip").

Units
- kcat in s^-1 (kcat_unit "s^(-1)"); Km and Ki in mM (km_unit, ki_unit "mM");
  kcat/Km in mM^-1 s^-1 (kcat_over_km_unit "s^(-1)*mM^(-1)").
- Always read the *_unit field: an empty one means the source gave no unit (condition_flags then says
  unit_not_recorded_kcat or unit_not_recorded_km) and the number is not in the column unit; a few older
  database rows keep another unit there (min^-1, mg/mL, uM, M^-1 s^-1).
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
  unverified, mathematically_inferred (Pre-review), disputed; public_trust_basis identity_only = Accepted (identity only).
- CatLog v2 rows (verification_method starts with catlog_v2_read_and_independent_verify): each value was read
  from the paper by an AI model (Claude, Anthropic); a second, separate AI run checked it against the paper;
  code converted the units. proof_lines gives each value as printed (raw_value, raw_unit, table_label).
- Other rows come mostly from the enzyme databases listed below, checked by an earlier automated pipeline (AI
  models and code checks).
- human-checked (on the page; data/human-review-marks.json, keyed by record_key): a human reviewer approved every
  value the record shows in CatLog's 2026 review; on CatLog v2 rows, the same values of the earlier catalog.
- source_db and source_license: the database(s) a row came from and the license that applies.
- enzyme, substrate, uniprot, status and source repeat enzyme_display_name, substrate_name, uniprot_id,
  verification_status and source_db.

Cite
- CatLog snapshot 2026-10-11 (data ID 4f90e639a5), Chowdhury Lab, https://chowdhurylab.github.io/tools/catlog-latest.html
- Sajeevan, K. A., et al. (2025). Robust Prediction of Enzyme Variant Kinetics with RealKcat. bioRxiv, version 2.
  https://www.biorxiv.org/content/10.1101/2025.02.10.637555v2

Snapshot details
- Rows: 169309
- Generated (UTC): 2026-10-11T16:02:13+00:00
- Exporter commit: cc5d91d7be13c4e268ac2c1b783afc90386ed985
- Source: verified_catlog.jsonl
- Source SHA-256: 49c70cdf153c47906b58070381d0fed4e3d493a1e1c530dc7612719d116856b0
- Public content SHA-256 (decompressed all-public-data JSONL): 4f90e639a531aeef195d065e8ec471d28360d8a14ee506ae188673ff688d0a9f
- Package: compact_public
- Contents: Full row coverage with compact public-facing fields. Raw source snapshots and private review payloads are not bundled.
- All public data: downloads all rows with available protein sequences, SMILES, references, and source details
- Analysis aliases: enzyme, substrate, uniprot, status, and source
- Table index: downloads a smaller all-row index without protein or substrate structure strings
- Download page: exports the displayed rows with public molecular identity, references, and source details
- All public data file: data/catlog-enriched.d7f524ba670e.jsonl.gz
- Rows with sequence: 85952
- Rows with wild-type sequence: 81565
- Rows with variant sequence: 25104
- Rows with SMILES: 104677

Data sources, licenses and attribution
- BRENDA (brenda): 86228 rows; license CC BY 4.0; https://www.brenda-enzymes.org/
- Primary literature (direct extraction) (primary_paper_direct): 25893 rows; license as published (see paper)
- Open Enzyme Database (OED) (oed): 24868 rows; license CC BY 4.0; https://openenzymedb.platform.moleculemaker.org/
- UniProt (uniprot): 15200 rows; license CC BY 4.0; https://www.uniprot.org/
- SABIO-RK (sabio_rk): 12824 rows; license SABIO-RK terms (free for academic use; see sabiork.h-its.org); https://sabiork.h-its.org/
- SKiD (Structure-Oriented Kinetics Database) (skid): 4228 rows; license CC BY-NC-ND 4.0; https://zenodo.org/records/15355031
- STRENDA DB (strenda): 3 rows; license see source; https://www.beilstein-strenda-db.org/
- Every row carries source_license, derived from the database(s) it was merged from.
- SKiD-derived rows carry a NonCommercial-NoDerivatives license (CC BY-NC-ND 4.0); reuse them only under those terms.
- For reuse of CatLog review notes and corrections, contact the Chowdhury Lab.
