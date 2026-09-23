CatLog static snapshot

This copy is for hosting only
- Serve index.html together with the assets and data folders from a web server (https).
- Keep the folder structure unchanged.
- The records-*.js chunks that the double-click (file://) path needs are not included,
  so opening index.html directly from disk shows an empty catalog. Build without the
  web-only option for a double-click copy.

Snapshot details
- Rows: 158392
- Generated (UTC): 2026-09-23T22:09:26+00:00
- Exporter commit: 752378c13c82907faa6abd0cbe0e214d26b4ddbf
- Source: verified_catlog.jsonl
- Source SHA-256: c81fb43f1fd31e61550739429c1fa354e5b127e12e79a72a4f0a71690662a5f3
- Public content SHA-256 (decompressed all-public-data JSONL): e1be1c2c552c0f520d95524551e9bd36866d50d83a6fbce65acf4a7a7fa17fc0
- Package: compact_public
- Contents: Full row coverage with compact public-facing fields. Raw source snapshots and private review payloads are not bundled.
- All public data: downloads all rows with available protein sequences, SMILES, references, and source details
- Analysis aliases: enzyme, substrate, uniprot, status, and source
- Table index: downloads a smaller all-row index without protein or substrate structure strings
- Download page: exports the displayed rows with public molecular identity, references, and source details
- All public data file: data/catlog-enriched.8246c9d73898.jsonl.gz
- Rows with sequence: 76271
- Rows with wild-type sequence: 71625
- Rows with variant sequence: 20788
- Rows with SMILES: 93718

Data sources, licenses and attribution
- BRENDA (brenda): 93306 rows; license CC BY 4.0; https://www.brenda-enzymes.org/
- Open Enzyme Database (OED) (oed): 30285 rows; license CC BY 4.0; https://openenzymedb.platform.moleculemaker.org/
- UniProt (uniprot): 16319 rows; license CC BY 4.0; https://www.uniprot.org/
- SABIO-RK (sabio_rk): 13969 rows; license SABIO-RK terms (free for academic use; see sabiork.h-its.org); https://sabiork.h-its.org/
- SKiD (Structure-Oriented Kinetics Database) (skid): 4259 rows; license CC BY-NC-ND 4.0; https://zenodo.org/records/15355031
- Primary literature (direct extraction) (primary_paper_direct): 193 rows; license as published (see paper)
- STRENDA DB (strenda): 3 rows; license see source; https://www.beilstein-strenda-db.org/
- Every row carries source_license, derived from the database(s) it was merged from.
- SKiD-derived rows carry a NonCommercial-NoDerivatives license (CC BY-NC-ND 4.0); reuse them only under those terms.
- For reuse of CatLog review notes and corrections, contact the Chowdhury Lab.
