CatLog static snapshot

This copy is for hosting only
- Serve index.html together with the assets and data folders from a web server (https).
- Keep the folder structure unchanged.
- The records-*.js chunks that the double-click (file://) path needs are not included,
  so opening index.html directly from disk shows an empty catalog. Build without the
  web-only option for a double-click copy.

Snapshot details
- Rows: 159446
- Generated (UTC): 2026-10-07T22:41:59+00:00
- Exporter commit: 23417e3f60092e635caddeed09e13a83c3c1cf6b
- Source: verified_catlog.jsonl
- Source SHA-256: 4434a604ae0387577544b5c1f59d03399a3bce26d713d70479ee61abddb20553
- Public content SHA-256 (decompressed all-public-data JSONL): 598f32f838185aca924cbfcf6ae10fa516929ba428b93958613ea64660bdcdb6
- Package: compact_public
- Contents: Full row coverage with compact public-facing fields. Raw source snapshots and private review payloads are not bundled.
- All public data: downloads all rows with available protein sequences, SMILES, references, and source details
- Analysis aliases: enzyme, substrate, uniprot, status, and source
- Table index: downloads a smaller all-row index without protein or substrate structure strings
- Download page: exports the displayed rows with public molecular identity, references, and source details
- All public data file: data/catlog-enriched.dcc8589d2b5e.jsonl.gz
- Rows with sequence: 76279
- Rows with wild-type sequence: 71760
- Rows with variant sequence: 20788
- Rows with SMILES: 93955

Data sources, licenses and attribution
- BRENDA (brenda): 93898 rows; license CC BY 4.0; https://www.brenda-enzymes.org/
- Open Enzyme Database (OED) (oed): 30522 rows; license CC BY 4.0; https://openenzymedb.platform.moleculemaker.org/
- UniProt (uniprot): 16327 rows; license CC BY 4.0; https://www.uniprot.org/
- SABIO-RK (sabio_rk): 14178 rows; license SABIO-RK terms (free for academic use; see sabiork.h-its.org); https://sabiork.h-its.org/
- SKiD (Structure-Oriented Kinetics Database) (skid): 4267 rows; license CC BY-NC-ND 4.0; https://zenodo.org/records/15355031
- Primary literature (direct extraction) (primary_paper_direct): 193 rows; license as published (see paper)
- STRENDA DB (strenda): 3 rows; license see source; https://www.beilstein-strenda-db.org/
- Every row carries source_license, derived from the database(s) it was merged from.
- SKiD-derived rows carry a NonCommercial-NoDerivatives license (CC BY-NC-ND 4.0); reuse them only under those terms.
- For reuse of CatLog review notes and corrections, contact the Chowdhury Lab.
