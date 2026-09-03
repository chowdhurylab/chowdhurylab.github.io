CatLog static snapshot

This copy is for hosting only
- Serve index.html together with the assets and data folders from a web server (https).
- Keep the folder structure unchanged.
- The records-*.js chunks that the double-click (file://) path needs are not included,
  so opening index.html directly from disk shows an empty catalog. Build without the
  web-only option for a double-click copy.

Snapshot details
- Rows: 148289
- Generated (UTC): 2026-09-03T12:23:39+00:00
- Exporter commit: 217602267e99e42b541074118e87768cf2fc70bd
- Source: verified_catlog.jsonl
- Source SHA-256: 81cd66566946d24ddf3e91155b3d37228ece25ec70981025eb9d9f6da69bb863
- Public content SHA-256 (decompressed all-public-data JSONL): 37e98444dcdd690052791543ec05cf60fd65576ed4d8292d75dad3f2b71b5806
- Package: compact_public
- Contents: Full row coverage with compact public-facing fields. Raw source snapshots, private review payloads, and other large provenance blobs are not bundled.
- All public data: downloads all rows with available protein sequences, SMILES, references, and public provenance
- Analysis aliases: enzyme, substrate, uniprot, status, and source
- Table index: downloads a smaller all-row index without protein or substrate structure strings
- Download page: exports the displayed rows with public molecular identity, references, and provenance
- All public data file: data/catlog-enriched.jsonl.gz
- Rows with sequence: 75936
- Rows with wild-type sequence: 49455
- Rows with variant sequence: 20795
- Rows with SMILES: 90444

Data sources, licenses and attribution
- BRENDA (brenda): 88440 rows; license CC BY 4.0; https://www.brenda-enzymes.org/
- Open Enzyme Database (OED) (oed): 27113 rows; license CC BY 4.0; https://openenzymedb.platform.moleculemaker.org/
- UniProt (uniprot): 15945 rows; license CC BY 4.0; https://www.uniprot.org/
- SABIO-RK (sabio_rk): 12340 rows; license SABIO-RK terms (free for academic use; see sabiork.h-its.org); https://sabiork.h-its.org/
- SKiD (Structure-Oriented Kinetics Database) (skid): 4195 rows; license CC BY-NC-ND 4.0; https://zenodo.org/records/15355031
- Primary literature (direct extraction) (primary_paper_direct): 193 rows; license as published (see paper)
- STRENDA DB (strenda): 3 rows; license see source; https://www.beilstein-strenda-db.org/
- Every row carries source_license, derived from the database(s) it was merged from.
- SKiD-derived rows carry a NonCommercial-NoDerivatives license (CC BY-NC-ND 4.0); reuse them only under those terms.
- For reuse of CatLog review notes and corrections, contact the Chowdhury Lab.
