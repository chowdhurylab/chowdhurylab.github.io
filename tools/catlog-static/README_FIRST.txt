CatLog dataset notes

CatLog in brief
- CatLog is a catalog of enzyme kinetic values (kcat, Km, kcat/Km and Ki), each with its enzyme, organism, substrate,
  variant, assay conditions and source. This snapshot (2026-10-15) holds 178,676 records, 68,709 of them accepted.
- 61,919 records are labelled Read from the paper: CatLog read them from 3,103 papers. The other 116,757 are labelled
  Not yet re-read: they are from CatLog's earlier version, which started from enzyme database entries and checked part
  of them against their papers; when CatLog reads a paper, its records replace these.

How the values were obtained and checked
- Read from the paper by CatLog: CatLog reads papers directly. An AI model (Claude, Anthropic) reads each kcat, Km and
  kcat/Km with its unit, enzyme, organism, substrate and assay conditions. A second, separate AI check compares every
  value with the paper. Code confirms that the quoted line is in the paper text, and converts units where the paper's
  differ from the catalog's. Each value keeps where it is printed and the number as printed. A person has not checked
  these values unless the record is marked human-checked.
- Not yet re-read, from enzyme databases: BRENDA, SABIO-RK, the Open Enzyme Database (OED), UniProt and SKiD, plus
  earlier paper extractions and rows with no source recorded. An earlier automated pipeline of AI models and code
  checks screened them; it stopped on 2026-10-09.
- Review result (verification_status): verified or corrected = Accepted (68,709); manual_review_required = Not
  confirmed (the earlier review left a question open); unverified or mathematically_inferred = Not checked; disputed =
  Disputed. An accepted record has a linked paper: 173 records not yet re-read that the earlier review accepted but
  that have no PMID or DOI (public_trust_basis identity_only) are mathematically_inferred, not accepted. 33 records
  not yet re-read are accepted because a human reviewer approved their values, although the earlier review had not
  accepted them (accepted_basis "human review").

Quality checks
- AI audits: 1,712 values re-checked against their papers by a separate AI auditor that tries to find errors; 57
  (3.3%) were wrong and removed.
- Human review: 99.9% values correct (kcat, Km, kcat/Km) of 2,770 entries from CatLog's earlier version (431 papers;
  the reviewers' own files, as of 2026-10-14). A reviewer disputed a value on 3 of 2,770 entries, and all 3 are as
  printed in the paper. Values missing: 27 entries (1.0%) lacked a value the paper prints, mostly the kcat. CatLog now
  has 53 of the 58 values reviewers named. Other disagreements: 177 entries (6.4%): could not find the value 153;
  organism name 13; DOI 5; substrate name 3; duplicate 2; paper evidence mismatch 1.
- Read from the paper again: same value as the reviewers for 3,903 of 4,441 approved values (87.9%); wrong CatLog
  values found: 0.
- Human-checked: 1,739 accepted entries, where a human reviewer approved every kcat and Km shown and the kcat/Km was
  approved too or agrees with kcat ÷ Km.

Files
- Full data (catlog-enriched.<id>.jsonl.gz): gzip-compressed JSON Lines, one row per line, every field below.
- Table (catlog-table.<id>.jsonl.gz): the same rows in the same order, without the fields marked * below (no
  sequences, SMILES, paper IDs, printed values or assay_conditions_summary); join it to Full data on record_key.
- Load with pandas: pandas.read_json(path, lines=True, compression="gzip").
- Against the databases (catlog-database-comparison.<id>.csv.gz): gzip-compressed CSV, one row per value read from the
  paper and database that lists its paper; see Against the databases below. Load with pandas.read_csv(path).
- Rows of one paper share pubmed_id: split training and test sets by paper or by primary_uniprot_id.

Units
- kcat in s^-1 (kcat_unit "s^(-1)"); Km and Ki in mM (km_unit, ki_unit "mM"); kcat/Km in mM^-1 s^-1 (kcat_over_km_unit
  "s^(-1)*mM^(-1)"); temperature_c in deg C and temperature_k in K.
- Always read the *_unit field: an empty one means the source gave no unit (condition_flags then says
  unit_not_recorded_kcat or unit_not_recorded_km) and the number is not in the column unit; a few rows not yet re-read
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
  assay conditions: buffer, cosubstrate and the like; on rows not yet re-read also pH and temperature);
  condition_note* (on a row read from the paper by CatLog that shows the same values as another row of the paper: the
  conditions that tell them apart).
- Cautions: condition_flags lists reasons a value may be wrong: unit_not_recorded_kcat, unit_not_recorded_km,
  kcat_over_km_quotient_mismatch (the kcat/Km shown differs from kcat / Km; on rows read from the paper by CatLog by
  more than 1.5x, widened by printed uncertainties, and more than the printed figures explain; all three stay as
  printed), kcat_over_km_unit_mismatch, kcat_over_km_source_mismatch (every kcat/Km the source databases list is more
  than 2-fold from the kcat/Km shown), km_magnitude_needs_check (Km above 10 M or below 1 nM),
  kcat_magnitude_needs_check (kcat above 10^8 s^-1), efficiency_above_diffusion_limit, temperature_*_needs_check,
  printed_unit_prefix_differs (on a row read from the paper by CatLog: a value whose printed unit has another
  concentration prefix than the unit CatLog converted it with, such as µM printed and mM used; its proof line says
  which unit was used); empty when none applies.
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
- Against the enzyme databases (rows read from the paper by CatLog; BRENDA, SABIO-RK, OED, SKiD, STRENDA and UniProt,
  the same paper, substrate, variant and organism): each proof line has database_status (confirmed, corrected: the
  database lists another number for the same measurement and code or a check against the paper found why, differs: not
  yet resolved, same_number_other_label, new: none of the compared databases lists it, not_compared), database_line
  (the comparison in one fixed sentence), database_sources (the databases it names), database_by_source (what each
  compared database that lists the paper lists for the value, in the order above: db, kind (same, same_rounded: the
  same to one or two significant figures, corrected, differs, same_number_other_label, other_number: another number
  for this value, another_measurement, other_values_only: other values of this parameter for the paper,
  parameter_absent, value_absent: none for this value), value (its number in the units above, at most 4 significant
  figures), unit, x (its number ÷ CatLog's) and label (the label it lists CatLog's number under, at most 90
  characters)); for a correction database_cause (found by a check against the paper: header_scale_inverted,
  header_scale_ignored, unit_not_converted, uM_entered_as_mM, mM_entered_as_uM, time_unit, decimal_or_exponent_slip,
  value_from_other_row, value_not_in_paper, paper_unit_misprint, recomputed_ratio; found by code: power_of_ten (off by
  an exact power of ten), printed_number_unit_not_applied (the printed number taken in another unit), time_factor (off
  by exactly 60 or 3,600); different_measurement, on any value, where a check against the paper found a database
  number to be another measurement of the paper) and database_found_by (paper_check: a check against the paper
  recorded the cause; factor_cross_checked: code found an exact factor and the paper's own kcat ÷ Km agrees with
  CatLog's number, not the database's; factor_only: code found an exact factor and nothing else was checked), and with
  a cause found by a check against the paper database_evidence (where in the paper and what it prints); for a value no
  compared database lists database_new_reason (paper_not_in_databases, metric_absent: no value of this parameter for
  the paper, substrate_absent, variant_absent: none for this substrate with this variant or organism,
  condition_absent: other numbers for this substrate and variant, ratio_only: a printed kcat/Km whose kcat and Km they
  list); database_note* is a database difference that covers the whole paper. A different number can be a different
  measurement; databases often copy one another. UniProt: the kinetic parameters of reviewed (Swiss-Prot) entries that
  cite the paper.
- Against the enzyme databases, per record (rows read from the paper by CatLog): database_summary, one word for its
  printed values: same (every one is the number a database lists for that paper, substrate and variant), corrected,
  differs, other_label, new (none of the compared databases lists any of them for the paper: a new measurement), mixed
  (values of more than one kind) or not_compared; database_kinds, every kind among them (["same", "new"]: a record
  with a new value next to a confirmed one), for a filter on records with a new value or a correction;
  database_paper_sources, the compared databases that list any kcat, Km or kcat/Km from the paper ([] when none does).
- Earlier corrections: corrections* (on records with verification_status corrected) lists each field the earlier
  review changed: field, before, after (numbers for kinetic values, pH and temperature; text for identifiers such as a
  PMID), unit, kind (rounding: within 2%, or one number printed to at most 2 significant figures and the other the
  same rounded half up; magnitude: a power of ten; different, added, removed, replaced, changed), where (the table and
  row it was read from) and listed (a database that lists the before value for that paper).
- Review: verification_status, public_trust_basis (literature_referenced: accepted with a linked paper; identity_only:
  the earlier review accepted it, but no PMID or DOI is linked, so it is not accepted; empty on other records),
  accepted_basis* ("human review": accepted because a human reviewer approved its values). human-checked records are
  listed in human-review-marks.json on the site, keyed by record_key.
- Source and license: source_db, source_databases_merged*, source_record_count (above 1: the row merges several
  database rows), source_license.
- Short names: enzyme*, substrate*, uniprot*, status* and source* repeat enzyme_display_name, substrate_name,
  uniprot_id, verification_status and source_db.
- Earlier-pipeline provenance, not needed for analysis: verification_method* (on rows read from the paper by CatLog it
  starts with "catlog_"), evidence_confidence_tier, paper_grounding_status, literature_linkage,
  identity_resolution_state, data_origin*, review_key.

Against the databases
- Each value read from the paper by CatLog (a printed kcat, Km or kcat/Km) is compared with the values BRENDA,
  SABIO-RK, OED, SKiD, STRENDA DB and UniProt list for the same paper: the same substrate, variant and organism, with
  pH and temperature used to pair values. Numbers compared for the same paper. A different number can mean a different
  measurement; it does not by itself mean a database is wrong. Databases are never used to read or check a value: the
  comparison runs on the finished values.
- The databases compared (version, the date the copy was taken, the kcat, Km and kcat/Km values with a paper ID that
  were compared, the papers they cite, and the SHA-256 of the file the values come from):
  - BRENDA 2026.1: 297,863 values from 36,795 papers; SHA-256
    bb2549d02b7255de2272b35701c331493caad16b82eb38a41adb2e03bbb0d2e1.
  - SABIO-RK (retrieved 2026-10-07): 106,008 values from 7,549 papers; SHA-256
    aa51e8f558cbb30382dc8b281446e7f9542ca5770731912bf09b6b96a65e9672.
  - OED (retrieved 2026-10-07): 99,282 values from 5,931 papers; SHA-256
    51e19e7bec3a297a788c76aabc2f67527e97d7f9b00c0a10f9435cfcd2c2ff1d.
  - SKiD Zenodo 15355031: 24,011 values from 2,881 papers; SHA-256
    e97da49d10b1c68a6355591f66e5d960543f94624cc4d42fc3afd1c5e6791e9d.
  - STRENDA DB (retrieved 2026-10-07): 898 values from 48 papers; SHA-256
    ed28b808616fc7b986eaa51c6c7c44ea7fd062d701fafc6b8133b1f544e55be7.
  - UniProt 2026_03 (retrieved 2026-10-13): 35,941 values from 8,862 papers; SHA-256
    42f20aea04b15f3f0e9b626e1d6690658c6fbb57e90e48a32099c0ede1280e53.
- The file (catlog-database-comparison.<id>.csv.gz, UTF-8 CSV): one row per value and database that lists its paper; a
  value no database lists, and a kcat/Km CatLog calculated, have one row with database empty. Columns: data_id and
  snapshot_date (this snapshot), record_key (join to the Full data), measurement_id, pubmed_id, doi, enzyme,
  ec_number, organism, variant, substrate, parameter (kcat, Km or kcat/Km), catlog_value and catlog_unit (s⁻¹, mM,
  mM⁻¹ s⁻¹), as_printed (the number and unit as printed), location (where in the paper), result, found_by, cause (as
  database_cause under Fields), not_listed_reason, database, database_version and database_retrieved (as listed
  above), database_kind (how that database lists the value, as the kind in database_by_source under Fields),
  database_value and database_unit (its number in CatLog's units), factor (database_value ÷ CatLog's number, to 4
  significant figures), database_label (where database_kind is same_number_other_label: the label, such as a
  substrate, variant or organism, that database lists the number under, at most 90 characters), review_result and
  review_round (empty until a human review of disagreements), and line (the record page's sentence for the value).
- result: same, the number a database lists for this value; same_other_label, a database lists this number for the
  paper under another substrate, variant or organism; corrects, a database lists another number for this value;
  CatLog's is the one the paper prints, and found_by and cause say how that was found and why the numbers differ;
  differs, a database lists another number for this value and the cause is not yet known; a different number can be a
  different measurement; not_listed, no compared database lists this value for this paper; not_listed_reason says why;
  not_compared, a kcat/Km CatLog calculated as kcat ÷ Km (the paper prints none).
- not_listed_reason: ratio_only, kcat and Km listed: a printed kcat/Km whose kcat and Km the databases list; they did
  not store the ratio; condition_absent, other values listed: the databases list other numbers for this substrate and
  variant, not this one; some may be values the pairing could not match; substrate_absent, substrate not listed;
  metric_absent, parameter not listed: no value of this parameter for the paper; variant_absent, variant or organism
  not listed; paper_not_in_databases, paper not listed: the paper is in none of the compared databases.
- found_by (every correction): paper_check, checked against the paper: a separate AI check read the paper and named
  the cause; factor_cross_checked, exact factor, the paper's kcat ÷ Km agrees: code found the database's number is the
  paper's times an exact factor, and the paper's own kcat ÷ Km matches CatLog's value, not the database's;
  factor_only, exact factor only: code found an exact factor; nothing else was checked.
- In this snapshot 143,139 values read from 3,103 papers were compared: 109,683 (76.6%) are the number a database
  lists, 6,263 (4.4%) the same number under another label, 1,599 (1.1%) correct a database's number (656 checked
  against the paper, 697 by an exact factor that the paper's own kcat ÷ Km agrees with, 246 by an exact factor alone),
  1,215 (0.8%) differ without a known cause and 24,379 (17.0%) are in none of the databases. Where a database lists a
  number for the same measurement (112,497 values), it is the paper's number for 109,683 (97.5%). 6,815 kcat/Km values
  CatLog calculated are not compared. A value counts once however many databases list it; per database:
  values_by_database in the manifest, or the database_kind column.
- Why no database lists a value: kcat and Km listed 5,790; other values listed 5,508; substrate not listed 4,887;
  parameter not listed 4,859; variant or organism not listed 3,199; paper not listed 136.
- The databases also list 16,783 numbers for these papers that CatLog does not have (each paper, parameter and number
  to 3 significant figures counted once), first reason that applies: paired with a CatLog value as a different number
  (corrects or differs) 6,289; values the paper reprints from other work (CatLog leaves reprints out) 2,807; CatLog
  kept no value from the paper (retracted, a review, no kinetic constants) 2,295; a kcat/Km equal to CatLog's
  calculated kcat ÷ Km (the paper prints no ratio) 1,780; in the paper text with 3 or more significant digits or a
  power of ten: a possible CatLog miss, not yet checked 1,276; only a 2-digit number in the paper text: a weak
  possible miss 509; the number is another parameter in CatLog 507; the number is not in the paper text under any unit
  factor 470; CatLog's checks rejected this number 365; the database names no substrate and the paper has several 262;
  the number sits next to Ki, Vmax or another quantity in the text 213; another measurement of the paper, found by a
  check against the paper 10.
- The values no database lists, for papers about new data: the rows with result not_listed (one per value;
  not_listed_reason says why), for example pandas.read_csv(path)[lambda d: d.result == 'not_listed'].
- To reproduce: the database values come from the files above (by SHA-256), merged into one table (db_values.tsv,
  SHA-256 23d3fe3abce8ffc40a5ada3215c9a48ff43fd893111878f77800e5363f892d4a); the checks against the paper are recorded
  in database_corrections.tsv (SHA-256 213cda877a1f6c1ed67f8d86f9c02ec1bcf87f16e5f1c211a90645dc63c48516); CatLog's
  values are its export with SHA-256 2332e66b01052c391ccb110f34f4a07515e9051bd10b69c8e76861878257178f, built with
  CatLog code commit ca9c5ff. The comparison is code: the same files give the same rows.
- To cite: "Of 143,139 kinetic values (kcat, Km and kcat/Km) CatLog read from 3,103 papers and compared with BRENDA,
  SABIO-RK, OED, SKiD, STRENDA DB and UniProt for the same paper, 24,379 (17.0%) are listed by none of them. Where a
  database lists a number for the same measurement (112,497 values), it is the paper's number for 109,683 (97.5%);
  1,599 values correct a database's number (656 checked against the paper, 697 by an exact factor that the paper's own
  kcat ÷ Km agrees with, 246 by an exact factor alone) and 1,215 differ without a known cause." CatLog snapshot
  2026-10-15, data ID 8a39252508.

License
- Read from the paper by CatLog: 61,919 rows, CatLog compilation, CC BY 4.0: cite the snapshot and the CatRange paper
  below. Text quoted from a paper (the printed lines in proof_lines) remains the publisher's. Their source_license
  reads "CC BY 4.0 (CatLog compilation); quoted paper text remains the publisher's".
- The other rows keep the license of the database they came from; source_license names each license of a merged row:
  - CC BY 4.0: 100,779 rows from BRENDA, OED and UniProt.
  - SABIO-RK terms (free for academic use): 10,252 rows, alone or merged with a CC BY 4.0 row.
  - CC BY-NC-ND 4.0, non-commercial use only, no derivatives: 5,555 rows, every row whose source_license includes it:
    4,163 with SKiD as their source and 1,392 BRENDA, SABIO-RK or UniProt rows a SKiD record was merged into. Filter
    on source_license, not on source_db.
  - As published (see paper): 17 rows from earlier paper extractions. See source: 154 rows.
- For reuse of CatLog review notes and corrections, contact the Chowdhury Lab.
- Sources (source_db; a row merged from several databases counts under each):
  - BRENDA (brenda): 77,023 rows; CC BY 4.0; https://www.brenda-enzymes.org/
  - Read from the paper by CatLog (primary_paper_direct): 61,919 rows, CatLog compilation CC BY 4.0, text quoted from
    a paper remains the publisher's; 17 earlier paper extractions: as published (see paper).
  - UniProt (uniprot): 13,359 rows; CC BY 4.0; https://www.uniprot.org/
  - Open Enzyme Database (OED) (oed): 11,495 rows; CC BY 4.0; https://openenzymedb.platform.moleculemaker.org/
  - SABIO-RK (sabio_rk): 10,614 rows; SABIO-RK terms (free for academic use; see sabiork.h-its.org);
    https://sabiork.h-its.org/
  - SKiD (Structure-Oriented Kinetics Database) (skid): 4,163 rows; CC BY-NC-ND 4.0;
    https://zenodo.org/records/15355031
  - STRENDA DB (strenda): 3 rows; see source; https://www.beilstein-strenda-db.org/
  - No source recorded (unknown): 151 rows; see source.

Cite
- CatLog snapshot 2026-10-15 (data ID 8a39252508), Chowdhury Lab,
  https://chowdhurylab.github.io/tools/catlog-latest.html
- Sajeevan, K. A., et al. (2026). CatRange enables robust prediction of enzyme variant kinetic regimes. PNAS Nexus,
  pgag309. doi: 10.1093/pnasnexus/pgag309 (https://doi.org/10.1093/pnasnexus/pgag309). The CatRange paper describes
  CatLog-27k (27,176 kinetic records curated from BRENDA and SABIO-RK), the set its models were trained on; CatLog is
  the growing catalog that followed.
- If you use rows from a database, cite that database as it asks: BRENDA, SABIO-RK, SKiD (Zenodo 15355031), the Open
  Enzyme Database, UniProt (links under License).
- Keep the file you used: older snapshots leave the site over time.

Snapshot details
- Rows: 178,676. Generated (UTC): 2026-10-15T00:16:43+00:00.
- Data ID 8a39252508: the first 10 characters of the SHA-256 of the decompressed Full data (gunzip -c
  catlog-enriched.<id>.jsonl.gz | shasum -a 256): 8a39252508ba601e9d3a744d52ab4b1b8233d3ee58fce6f478a7f8e5c4dcb857.
- Full data file catlog-enriched.89414728c519.jsonl.gz, SHA-256
  89414728c519169a689bc6b901e62c83cea36f31e5e4e4c35aa52950516a7f2c.
- Table file catlog-table.2cee5dd22031.jsonl.gz, SHA-256
  2cee5dd22031e9b4c627ddb51b363d29b245c2dd2a055ce76f77f17ff202ed7c.
- Against the databases file catlog-database-comparison.0c324f207018.csv.gz, SHA-256
  0c324f207018ec73c3ae38820256aa4edb5439362f95e3ea6d091534016e8c48, 295,792 rows.
- SHA-256 of the catalog file this snapshot was built from:
  588d03684878bcead645a0dc73a27894c3b0e3973e66b04156f02f3a7bc7edc3.
- Rows with a sequence: 91,888 (wild-type sequence 87,622, variant sequence 26,756); rows with SMILES: 117,307.
