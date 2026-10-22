CatLog dataset notes

CatLog in brief
- CatLog is a catalog of enzyme kinetic values (kcat, Km, kcat/Km), each with its enzyme, organism, substrate,
  variant, assay conditions and source. This snapshot (2026-10-22) holds 186,193 records, 91,069 of them accepted.
- 87,768 records are labelled Read from the paper (5,805 papers, 5,395 cited by a compared database). The other 98,425
  are Not yet re-read: from CatLog's earlier version, built from database entries and partly checked against the
  papers; replaced when CatLog reads the paper.

How the values were obtained and checked
- Read from the paper: An AI model (Claude, Anthropic) reads each kcat, Km and kcat/Km in a paper with its unit,
  enzyme, organism, substrate and assay conditions. A second, separate AI check compares every value with the paper.
  Automated checks confirm that the quoted line is in the paper text and convert the paper's units to CatLog's. Each
  value keeps where it is printed and the number as printed. AI audits and human reviewers check samples against the
  papers; only records marked human-checked count as checked by a person.
- Not yet re-read: values from enzyme databases (BRENDA, SABIO-RK, the Open Enzyme Database (OED), UniProt and SKiD),
  earlier paper extractions and rows with no source recorded. CatLog's earlier version screened them with AI models
  and automated checks until 2026-10-09.
- Review result (verification_status): verified or corrected = Accepted (91,069); manual_review_required = Not
  confirmed (the earlier review left a question open); unverified or mathematically_inferred = Not checked; disputed =
  Disputed. An accepted record needs a linked paper: 173 records not yet re-read that the earlier review accepted have
  no PMID or DOI (public_trust_basis identity_only), so they are mathematically_inferred, not accepted. 92 records not
  yet re-read are accepted on human review (accepted_basis, under Fields).

Quality checks
- AI audits: a separate AI auditor re-checked 6,477 values, drawn at random, against their papers to find errors; 28
  (0.4%; 95% interval 0.30-0.62%) were wrong and removed. The interval treats each value as independent; errors can
  cluster in a paper. A further 188 values were audited because an audit sample or a database check pointed to them
  (46 wrong and removed); they are not in this share, and their wrong values count under CatLog's own errors.
- CatLog's own errors found so far: 1,435 values in 127 papers (a value found in two ways counts once). AI audits
  found 74 (26 papers), removed. Searches for an error an audit or check had found, in the rest of its paper or across
  the catalog, removed 1,254 more (97 papers): 1,058 values the paper reprints from earlier work, 103 per-product
  (partial) rate constants stored as the reaction's kcat or kcat/Km and 93 others. A unit misprinted in the paper led
  to 108 corrected values (13 papers). Checks of database differences against the paper found 12 (4 papers): 10
  corrected and 2 awaiting a further check.
- Blind reading: CatLog's reading and checking agents are meant to work without database values, so that agreement
  with the databases is a fair test. Between October 9 and October 21, 2026, agents saw such values, or files of
  CatLog's earlier version, on 309 papers: the reading agent on 173 and only a checking agent on 136. 303 of them were
  sent back on October 21, 2026 to be read or checked again without them (173 to be read and 130 to be checked; none
  finished yet); the other 6 have not been sent back. Until then their values stay in CatLog and in the comparison
  with the databases.
- Human review: people checked 2,770 entries from the earlier version (431 papers; an entry is one of its records as
  the reviewers saw it); 166 had no paper and could not be checked; no value disputed on 2,601 of the 2,604 that could
  (99.9%); the 3 disputed values are as printed in the paper.
- Values missing: 27 entries (1.0%) lacked a value the paper prints, mostly the kcat. CatLog now has 71 of the 77
  values reviewers named. Other disagreements: organism name (13), DOI (5), substrate name (3), duplicate (2), paper
  evidence mismatch (1).
- Where CatLog has re-read a paper the reviewers checked, its value now matches the approved value for 3,967 of 4,522
  (87.7%). Comparing them found 68 wrong labels and 1 missed value in CatLog, all fixed since. AI agents checked 323
  of the other 555 against the paper: 134 are the same value under another name, 142 are values the paper supports as
  CatLog reads them (the earlier entry's number or label was wrong), 3 differ by rounding and 44 are left out by
  CatLog's reading rules (a reprint, a Hill fit); none is a CatLog value found wrong. 232 are not yet checked.
- Human-checked: 1,841 accepted records (3,952 values), where a human reviewer approved every kcat and Km shown and
  the kcat/Km was approved too or agrees with kcat ÷ Km.

Files
- Full data, catlog-2026-10-22-full.jsonl.gz (data/catlog-enriched.769145fd8ebf.jsonl.gz on the server):
  gzip-compressed JSON Lines, one row per line, every field below.
- Table, catlog-2026-10-22-table.jsonl.gz (data/catlog-table.94f3675ede5f.jsonl.gz on the server): the same rows in
  the same order, without the fields marked * below (no sequences, SMILES, paper IDs, printed values or
  assay_conditions_summary); join it to Full data on record_key.
- Load with pandas: pandas.read_json(path, lines=True, compression="gzip").
- Compared with databases, catlog-2026-10-22-database-comparison.csv.gz
  (data/catlog-database-comparison.7b7fe70a5160.csv.gz on the server): gzip-compressed CSV, described under Compared
  with databases below; load with pandas.read_csv(path).
- Rows of one paper share pubmed_id: split training and test sets by paper or by primary_uniprot_id.

Units
- kcat in s⁻¹ (kcat_unit "s^(-1)"); Km and Ki in mM (km_unit, ki_unit "mM"); kcat/Km in mM⁻¹ s⁻¹ (kcat_over_km_unit
  "s^(-1)*mM^(-1)"); temperature_c in °C, temperature_k in K.
- Always read the *_unit field: empty means the source gave no unit and the number is not in the column unit
  (condition_flags then has unit_not_recorded_kcat or unit_not_recorded_km); a few rows not yet re-read keep another
  unit there (min⁻¹, mg/mL, µM, M⁻¹ s⁻¹).
- Rows read from the paper keep the printed precision: each printed value is converted to the units above and rounded
  to the printed number's significant figures (at least 2); a kcat/Km calculated from kcat and Km has the significant
  figures of the less precise of the two.
- Empty means the paper or source gives none; "Unknown" (EC, organism, substrate): not stated in the paper or the
  source database.

Fields (* = Full data only)
- Record: record_key (the record ID), measurement_key.
- Enzyme and organism: enzyme_display_name, enzyme_label_source and enzyme_name_source (where the name comes from),
  ec_number, organism.
- Protein: primary_uniprot_id, uniprot_id*, uniprot_candidate_ids (possible UniProt entries when none was chosen),
  protein_accession and protein_accession_database (UniProt or NCBI Protein), source_protein_accession (the source's
  accession, when it differs), has_sequence, sequence_resolved, sequence* (the variant sequence when one was built,
  else the reference), wild_type_sequence*, variant_sequence*, sequence_source*, sequence_source_confidence,
  sequence_variant_status, sequence_variant_note* (what the sequence shown is).
- Variant: wild_type (true, false or empty = not known), mutation_type*, mutation_signature (for example H150A;
  "Unknown" on wild-type rows and where no mutation is given).
- Substrate: substrate_name, smiles*.
- Values: kcat, km, ki and kcat_over_km (in the units above); kcat_unit, km_unit, ki_unit and kcat_over_km_unit;
  kcat_display, km_display, ki_display and kcat_over_km_display (the text the page shows); has_ki; kcat_over_km_origin
  (paper_reported, source_listed, calculated = kcat / Km and not printed, or not_specified);
  source_kcat_over_km_values* (the kcat/Km values the source databases list) and kcat_over_km_source_differs (one of
  them differs from kcat_over_km).
- Conditions: ph, ph_display, temperature_c, temperature_k, temperature_display; assay_conditions_summary* (other
  conditions such as buffer and cosubstrate; on rows not yet re-read also pH and temperature); condition_note* (rows
  read from the paper: what tells the row from another row of the paper with the same enzyme, organism, substrate,
  variant, pH and temperature: the assay parts that differ, else a qualifier such as apparent Km, else the table).
- Cautions: condition_flags, the reasons a value may be wrong (empty when none applies): unit_not_recorded_kcat,
  unit_not_recorded_km, kcat_over_km_quotient_mismatch (the kcat/Km shown differs from kcat / Km; on rows read from
  the paper by more than 1.5x widened by the printed uncertainties, and by more than the printed figures explain; all
  three stay as printed), kcat_over_km_unit_mismatch, kcat_over_km_source_mismatch (every kcat/Km the source databases
  list is more than 2-fold from the one shown), km_magnitude_needs_check (Km above 10 M or below 1 nM),
  kcat_magnitude_needs_check (kcat above 10⁸ s⁻¹), efficiency_above_diffusion_limit, temperature_*_needs_check,
  printed_unit_prefix_differs (rows read from the paper: a printed unit with another concentration prefix than the
  unit used, such as µM printed and mM used; the conversion field names the unit used).
- Paper: pubmed_id*, doi*, supporting_pmids* and supporting_dois* (every paper of a merged row), pmid_count,
  doi_count, literature_id_count, has_literature_id.
- Evidence: proof_lines*, one entry per printed value: table_label, row_label and column_label (where); metric and
  metric_label (which value); raw_value and raw_unit (as printed); normalized_value and normalized_unit (in the units
  above); raw_value_unit_evidence and normalized_value_unit_evidence (the same as text; on rows read from the paper
  with the line it is printed in and what it was converted from); assay_condition, pmid and doi. proof_kind
  (paper_evidence or source_note) and has_proof_excerpt say whether there is any.
  - On rows read from the paper each entry also has printed (number and unit as printed), printed_line (the line it
    was read from, once per line, as the paper's text gives it; printed_line_note says where a PDF's text layer lost
    symbols or gives ± as another character), check (what the second, separate AI check found: confirmed, or corrected
    and what), conversion (empty when the value is stored as printed; else "converted by code", "printed unit read as"
    the unit used, or both), value_display (the value with the printed figures: a printed 135.0 stays 135.0) and, for
    a value an AI audit re-checked, audit_date and audit_result (kept or unit corrected).
- Against the enzyme databases, per value (rows read from the paper; BRENDA, SABIO-RK, OED, SKiD, STRENDA and UniProt,
  for the same paper, substrate, variant and organism). Each entry of proof_lines has:
  - database_status: confirmed (a database lists the same number); corrected (a database lists another number for the
    same measurement, CatLog's is the one the paper prints, and an automated check or a check against the paper found
    why); differs (another number, cause not yet known; a different number can mean a different measurement and does
    not by itself mean a database is wrong); same_number_other_label (a database lists this number for the paper under
    another substrate, variant or organism); new (no compared database lists it); not_compared.
  - database_line (the comparison in fixed sentences, as the record page shows it) and database_sources (the databases
    it names).
  - database_by_source: what each compared database that lists the paper lists for the value, in the order above: db;
    kind (same; same_rounded, the same to one or two significant figures; corrected; differs; same_number_other_label;
    other_number, another number for this value; another_measurement; other_values_only, other values of this
    parameter for the paper; parameter_absent; value_absent, none for this value); value (its number in the units
    above, at most 4 significant figures); unit; x (its number ÷ CatLog's); label (the label it lists CatLog's number
    under, at most 90 characters).
  - database_cause, on a correction: found by an AI check of the paper (header_scale_inverted, header_scale_ignored,
    unit_not_converted, uM_entered_as_mM, mM_entered_as_uM, time_unit, decimal_or_exponent_slip, value_from_other_row,
    value_not_in_paper, paper_unit_misprint, recomputed_ratio) or automatically (power_of_ten, off by an exact power
    of ten; printed_number_unit_not_applied, the printed number taken in another unit; time_factor, off by exactly 60
    or 3,600; paper_unit_misprint, the printed value in a printed unit that the paper's own kcat ÷ Km does not
    support). On a different number: exact_factor (an exact factor found automatically, nothing else checked). On any
    value: different_measurement (an AI check of the paper found a database number to be another measurement of the
    paper).
  - database_found_by, on a correction: paper_check (a separate AI check read the paper and recorded the cause) or
    factor_cross_checked (an exact factor, or the printed value in its printed unit, found automatically, and the
    paper's own kcat ÷ Km agrees with CatLog's number, not the database's). database_evidence, with a cause from an AI
    check of the paper: where in the paper and what it prints.
  - database_new_reason, for a value no compared database lists: paper_not_in_databases (the paper is in none of
    them); metric_absent (no value of this parameter for the paper); substrate_absent; variant_absent (none for this
    substrate with this variant or organism); condition_absent (other numbers for this substrate and variant, not this
    one; some may be values the pairing could not match); ratio_only (a printed kcat/Km whose kcat and Km they list;
    they did not store the ratio).
- Against the enzyme databases, per record (rows read from the paper): database_summary, one word for its printed
  values: same (each is the number a database lists for that paper, substrate and variant), corrected, differs,
  other_label, new (no compared database lists any of them: a new measurement), mixed (values of more than one kind)
  or not_compared; database_kinds, every kind among them (["same", "new"]: a new value next to a confirmed one), to
  filter records with a new value or a correction; database_paper_sources, the compared databases that list any kcat,
  Km or kcat/Km from the paper ([] when none does); database_note*, a database difference that covers the whole paper.
  Databases often copy one another. UniProt: the kinetic parameters of reviewed (Swiss-Prot) entries that cite the
  paper.
- Earlier corrections: corrections* (records with verification_status corrected) lists each field the earlier review
  changed: field; before and after (numbers for kinetic values, pH and temperature; text for identifiers such as a
  PMID); unit; kind (rounding: within 2%, or one number printed to at most 2 significant figures and the other the
  same rounded half up; magnitude: a power of ten; different, added, removed, replaced, changed); where (the table and
  row it was read from); listed (a database that lists the before value for that paper).
- Review: verification_status, public_trust_basis (literature_referenced: accepted with a linked paper; identity_only:
  see Review result above; empty on other records), accepted_basis* ("human review" on a record not yet re-read that
  is accepted because a human reviewer approved its values, though the earlier review had not). Human-checked records
  are listed in human-review-marks.json on the site, keyed by record_key.
- Source and license: source_db, source_databases_merged*, source_record_count (above 1: the row merges several
  database rows), source_license.
- Short names: enzyme*, substrate*, uniprot*, status* and source* repeat enzyme_display_name, substrate_name,
  uniprot_id, verification_status and source_db.
- Provenance from CatLog's earlier version, not needed for analysis: verification_method* (on rows read from the paper
  it starts with "catlog_"), evidence_confidence_tier, paper_grounding_status, literature_linkage,
  identity_resolution_state, data_origin*, review_key.

Compared with databases
- Each printed kcat, Km and kcat/Km read from the paper is compared with the values BRENDA, SABIO-RK, OED, SKiD,
  STRENDA DB and UniProt list for the same paper: the same substrate, variant and organism, with pH and temperature
  used to pair values. Readers and checkers are meant to work without database values; the comparison runs on the
  finished values. Differences of 1.5-fold or more are then checked against the paper by an AI agent; those checks
  have found no CatLog value wrong so far. Between October 9 and October 21, 2026, a reading or checking agent opened
  database values or files of CatLog's earlier version on 309 papers; 303 of them were sent back to be read or checked
  again without them (Quality checks).
- The databases compared (version, the date the copy was taken, its kcat, Km and kcat/Km values with a paper ID, the
  papers they cite, and the SHA-256 of the file they come from):
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
- The file (catlog-2026-10-22-database-comparison.csv.gz, UTF-8 CSV) has one row per value and database that lists its
  paper, and one row with database empty for a value no database lists and for a kcat/Km CatLog calculated. Columns:
  data_id and snapshot_date (this snapshot); record_key (joins the Full data); measurement_id, pubmed_id, doi, enzyme,
  ec_number, organism, variant, substrate; parameter (kcat, Km or kcat/Km); catlog_value and catlog_unit (s⁻¹, mM,
  mM⁻¹ s⁻¹); as_printed (number and unit as printed); location (where in the paper); result (below); found_by, cause
  and not_listed_reason (database_found_by, database_cause and database_new_reason under Fields); database,
  database_version and database_retrieved (as listed above); database_kind (the kind in database_by_source under
  Fields); database_value and database_unit (its number in CatLog's units); factor (database_value ÷ CatLog's number,
  to 4 significant figures); database_label (for same_number_other_label: the substrate, variant or organism label the
  database lists the number under, at most 90 characters); review_result and review_round (empty until a human review
  of disagreements); line (the record page's sentence for the value).
- result: the database_status under Fields, as same (confirmed), same_other_label (same_number_other_label), corrects
  (corrected), differs, not_listed (new) or not_compared (a kcat/Km CatLog calculated as kcat ÷ Km; the paper prints
  none).
- In this snapshot 197,799 values read from 5,805 papers were compared: 138,772 (70.2%) are the number a database
  lists, 8,656 (4.4%) the same number under another label, 2,862 (1.4%) correct a database's number, 881 (0.4%) differ
  with the cause not yet known and 46,628 (23.6%) are in none of the databases. 9,992 kcat/Km values CatLog calculated
  are not compared. A value counts once however many databases list it; per database: values_by_database in the
  manifest, or the database_kind column.
- Why no database lists a value (not_listed_reason): paper not listed (paper_not_in_databases) 10,445; kcat and Km
  listed (ratio_only) 8,374; other values listed (condition_absent) 7,881; parameter not listed (metric_absent) 7,673;
  substrate not listed (substrate_absent) 7,301; variant or organism not listed (variant_absent) 4,954.
- The databases also list 21,640 numbers for these papers that match no value CatLog read from them (each paper,
  parameter and number to 3 significant figures counted once), by the first reason that applies: paired with a CatLog
  value as a different number (corrects or differs) 7,842; reprinted by the paper from other work (CatLog leaves
  reprints out) 3,711; CatLog kept no value from the paper (retracted, a review, no kinetic constants) 3,092; equal to
  a kcat/Km CatLog calculated (the paper prints none) 2,217; in the paper text with 3 or more significant digits or a
  power of ten: a possible CatLog miss, not yet checked 1,630; rejected by CatLog's checks 771; only a 2-digit number
  in the paper text: a weak possible miss 597; not in the paper text under any unit factor 584; in CatLog under
  another parameter 505; next to Ki, Vmax or another quantity in the text 261; no substrate named, and the paper has
  several 231; another measurement of the paper, found by an AI check of the paper 199. Together, 2,227 may be values
  CatLog missed, not yet checked.
- The values no database lists: pandas.read_csv(path)[lambda d: d.result == 'not_listed'].
- To reproduce: the database values come from the files above, merged into one table (db_values.tsv, SHA-256
  23d3fe3abce8ffc40a5ada3215c9a48ff43fd893111878f77800e5363f892d4a); the AI checks of the paper are in
  database_corrections.tsv (SHA-256 a4989b321971d26776a0291dfc08605515019135bb7a9c5670dd7338445c6d60); CatLog's values
  are its export with SHA-256 dae2ceb6bc3e2e222ffc5567d743dc0bd3b0961eac8aab2a5b8846f2635e4d2a, built with CatLog code
  commit d6b8810. The comparison is automatic: the same files give the same rows.
- To cite: "Of 197,799 kinetic values (kcat, Km and kcat/Km) CatLog read from 5,805 papers and compared with BRENDA,
  SABIO-RK, OED, SKiD, STRENDA DB and UniProt for the same paper, 46,628 (23.6%) are listed by none of them: 8,374
  printed kcat/Km values whose kcat and Km they list, 7,881 where they list other numbers for the same substrate and
  variant, and 30,373 for a substrate, variant, organism, parameter or paper they list nothing for. Where a database
  lists a number for the same measurement (142,515 values), it is the paper's number for 138,772 (97.4%); 2,862 values
  correct a database's number (1,769 found by an AI check of the paper, 1,093 by an exact factor that the paper's own
  kcat ÷ Km agrees with; a lower bound, as only differences of 1.5-fold or more are checked) and 881 differ with the
  cause not yet known (86 by an exact factor not yet checked against the paper)." CatLog snapshot 2026-10-22, data ID
  d5ba68e3e3.

License
- Read from the paper by CatLog: 87,768 rows under CC BY 4.0 (CatLog compilation): cite the snapshot and the CatRange
  paper below. Quoted paper text (the printed lines in proof_lines) remains the publisher's. Their source_license: "CC
  BY 4.0 (CatLog compilation); quoted paper text remains the publisher's".
- The other rows keep their source database's license; source_license names each license of a merged row:
  - CC BY 4.0: 84,330 rows from BRENDA, OED and UniProt.
  - SABIO-RK terms (free for academic use): 8,636 rows, alone or merged with a CC BY 4.0 row.
  - CC BY-NC-ND 4.0 (non-commercial use only, no derivatives): 5,214 rows whose source_license includes it, 4,036 with
    SKiD as their source and 1,178 BRENDA, SABIO-RK or UniProt rows a SKiD record was merged into. Filter on
    source_license, not on source_db.
  - As published (see paper): 91 rows from earlier paper extractions. See source: 154 rows.
- For reuse of CatLog review notes and corrections, contact the Chowdhury Lab.
- Sources (source_db; a row merged from several databases counts under each):
  - Read from the paper by CatLog (primary_paper_direct): 87,768 rows, licensed as above; 91 earlier paper
    extractions: as published (see paper).
  - BRENDA (brenda): 66,742 rows; CC BY 4.0; https://www.brenda-enzymes.org/
  - UniProt (uniprot): 10,668 rows; CC BY 4.0; https://www.uniprot.org/
  - SABIO-RK (sabio_rk): 8,955 rows; SABIO-RK terms (free for academic use; see sabiork.h-its.org);
    https://sabiork.h-its.org/
  - Open Enzyme Database (OED) (oed): 7,840 rows; CC BY 4.0; https://openenzymedb.platform.moleculemaker.org/
  - SKiD (Structure-Oriented Kinetics Database) (skid): 4,036 rows; CC BY-NC-ND 4.0;
    https://zenodo.org/records/15355031
  - STRENDA DB (strenda): 3 rows; see source; https://www.beilstein-strenda-db.org/
  - No source recorded (unknown): 151 rows; see source.

Cite
- CatLog snapshot 2026-10-22 (data ID d5ba68e3e3), Chowdhury Lab,
  https://chowdhurylab.github.io/tools/catlog-latest.html
- Sajeevan, K. A., et al. (2026). CatRange enables robust prediction of enzyme variant kinetic regimes. PNAS Nexus,
  pgag309. doi: 10.1093/pnasnexus/pgag309 (https://doi.org/10.1093/pnasnexus/pgag309). It describes CatLog-27k (27,176
  kinetic records curated from BRENDA and SABIO-RK), the set its models were trained on; CatLog is the growing catalog
  that followed.
- If you use rows from a database, cite that database as it asks: BRENDA, SABIO-RK, SKiD (Zenodo 15355031), the Open
  Enzyme Database, UniProt (links under License).
- Keep the file you used: older snapshots leave the site over time.

Snapshot details
- Rows: 186,193. Generated (UTC): 2026-10-22T16:18:37+00:00.
- Data ID d5ba68e3e3: the first 10 characters of the SHA-256 of the decompressed Full data (gunzip -c
  catlog-2026-10-22-full.jsonl.gz | shasum -a 256): d5ba68e3e3d26751bd76e3e34e308809b349e6301030912568a25a2369d73f58.
- Full data file catlog-enriched.769145fd8ebf.jsonl.gz, SHA-256
  769145fd8ebfad3bd6497bd459f89a37a92ed70f1202c72b35f5a6927c408adc.
- Table file catlog-table.94f3675ede5f.jsonl.gz, SHA-256
  94f3675ede5f51f1c7def589c0a2d35d01c9ef14beb8eafe6ee501b0c46a0d03.
- Compared with databases file catlog-database-comparison.7b7fe70a5160.csv.gz, SHA-256
  7b7fe70a516055a915aae1384dcafa91b64ba5840ba1398405183303823f903e, 382,029 rows.
- Catalog file this snapshot was built from: SHA-256 48a3f6293635a5b620cea0d99bcca0a5f59d80729ecfc8d197a075648c054200.
- Rows with a sequence: 98,036 (wild-type sequence 94,012, variant sequence 27,632); rows with SMILES: 128,975.
