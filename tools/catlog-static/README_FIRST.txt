CatLog static snapshot

This copy is for hosting only
- Serve index.html together with the assets and data folders from a web server (https).
- Keep the folder structure unchanged.
- The records-*.js chunks that the double-click (file://) path needs are not included,
  so opening index.html directly from disk shows an empty catalog. Build without the
  web-only option for a double-click copy.

Snapshot details
- Rows: 159653
- Generated (UTC): 2026-10-09T12:51:00+00:00
- Exporter commit: cc5d91d7be13c4e268ac2c1b783afc90386ed985
- Source: verified_catlog.jsonl
- Source SHA-256: 3bef0b4c9510b075feed74db95154874b59ae56950fbff189ab14ce4c4faae2e
- Public content SHA-256 (decompressed all-public-data JSONL): dff0c45a9f03a8e274ccc7a87db2710db89ed52bae0791b169f05b4495702cb1
- Package: compact_public
- Contents: Full row coverage with compact public-facing fields. Raw source snapshots and private review payloads are not bundled.
- All public data: downloads all rows with available protein sequences, SMILES, references, and source details
- Analysis aliases: enzyme, substrate, uniprot, status, and source
- Table index: downloads a smaller all-row index without protein or substrate structure strings
- Download page: exports the displayed rows with public molecular identity, references, and source details
- All public data file: data/catlog-enriched.80ee04743ce7.jsonl.gz
- Rows with sequence: 76806
- Rows with wild-type sequence: 72356
- Rows with variant sequence: 21292
- Rows with SMILES: 94916

Data sources, licenses and attribution
- BRENDA (brenda): 92307 rows; license CC BY 4.0; https://www.brenda-enzymes.org/
- Open Enzyme Database (OED) (oed): 28180 rows; license CC BY 4.0; https://openenzymedb.platform.moleculemaker.org/
- UniProt (uniprot): 16044 rows; license CC BY 4.0; https://www.uniprot.org/
- SABIO-RK (sabio_rk): 13720 rows; license SABIO-RK terms (free for academic use; see sabiork.h-its.org); https://sabiork.h-its.org/
- Primary literature (direct extraction) (primary_paper_direct): 5087 rows; license as published (see paper)
- SKiD (Structure-Oriented Kinetics Database) (skid): 4255 rows; license CC BY-NC-ND 4.0; https://zenodo.org/records/15355031
- STRENDA DB (strenda): 3 rows; license see source; https://www.beilstein-strenda-db.org/
- Every row carries source_license, derived from the database(s) it was merged from.
- SKiD-derived rows carry a NonCommercial-NoDerivatives license (CC BY-NC-ND 4.0); reuse them only under those terms.
- For reuse of CatLog review notes and corrections, contact the Chowdhury Lab.
