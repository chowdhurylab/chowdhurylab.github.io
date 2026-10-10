CatLog static snapshot

This copy is for hosting only
- Serve index.html together with the assets and data folders from a web server (https).
- Keep the folder structure unchanged.
- The records-*.js chunks that the double-click (file://) path needs are not included,
  so opening index.html directly from disk shows an empty catalog. Build without the
  web-only option for a double-click copy.

Snapshot details
- Rows: 164936
- Generated (UTC): 2026-10-10T17:08:36+00:00
- Exporter commit: cc5d91d7be13c4e268ac2c1b783afc90386ed985
- Source: verified_catlog.jsonl
- Source SHA-256: 02dd361ea6f9d6c6a01ba1d4f0c05470c17b95e6f6084c5857a2f335454f3e94
- Public content SHA-256 (decompressed all-public-data JSONL): 6d2b03c1806a8e41ccf8cb15cb360d3ca670ea8704840ba23cc8aaf5982c485c
- Package: compact_public
- Contents: Full row coverage with compact public-facing fields. Raw source snapshots and private review payloads are not bundled.
- All public data: downloads all rows with available protein sequences, SMILES, references, and source details
- Analysis aliases: enzyme, substrate, uniprot, status, and source
- Table index: downloads a smaller all-row index without protein or substrate structure strings
- Download page: exports the displayed rows with public molecular identity, references, and source details
- All public data file: data/catlog-enriched.2143b6729e45.jsonl.gz
- Rows with sequence: 80949
- Rows with wild-type sequence: 76547
- Rows with variant sequence: 22807
- Rows with SMILES: 98215

Data sources, licenses and attribution
- BRENDA (brenda): 89684 rows; license CC BY 4.0; https://www.brenda-enzymes.org/
- Open Enzyme Database (OED) (oed): 26745 rows; license CC BY 4.0; https://openenzymedb.platform.moleculemaker.org/
- UniProt (uniprot): 15580 rows; license CC BY 4.0; https://www.uniprot.org/
- Primary literature (direct extraction) (primary_paper_direct): 15295 rows; license as published (see paper)
- SABIO-RK (sabio_rk): 13321 rows; license SABIO-RK terms (free for academic use; see sabiork.h-its.org); https://sabiork.h-its.org/
- SKiD (Structure-Oriented Kinetics Database) (skid): 4245 rows; license CC BY-NC-ND 4.0; https://zenodo.org/records/15355031
- STRENDA DB (strenda): 3 rows; license see source; https://www.beilstein-strenda-db.org/
- Every row carries source_license, derived from the database(s) it was merged from.
- SKiD-derived rows carry a NonCommercial-NoDerivatives license (CC BY-NC-ND 4.0); reuse them only under those terms.
- For reuse of CatLog review notes and corrections, contact the Chowdhury Lab.
