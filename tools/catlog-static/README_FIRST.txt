CatLog static snapshot

This copy is for hosting only
- Serve index.html together with the assets and data folders from a web server (https).
- Keep the folder structure unchanged.
- The records-*.js chunks that the double-click (file://) path needs are not included,
  so opening index.html directly from disk shows an empty catalog. Build without the
  web-only option for a double-click copy.

Snapshot details
- Rows: 151190
- Generated (UTC): 2026-09-05T04:08:56+00:00
- Exporter commit: ca70f437e14bdca733fd6d92653b8cb9e714d5cf
- Source: verified_catlog.jsonl
- Source SHA-256: c7397a1b42a787173e37fa290786fec280d5c87a7d04f3b1b4e62e4b00cf5395
- Public content SHA-256 (decompressed all-public-data JSONL): 97a786c4808ee86ad117bfd7df053f812baf00c4ee21feebb150c40b9fad14c3
- Package: compact_public
- Contents: Full row coverage with compact public-facing fields. Raw source snapshots and private review payloads are not bundled.
- All public data: downloads all rows with available protein sequences, SMILES, references, and source details
- Analysis aliases: enzyme, substrate, uniprot, status, and source
- Table index: downloads a smaller all-row index without protein or substrate structure strings
- Download page: exports the displayed rows with public molecular identity, references, and source details
- All public data file: data/catlog-enriched.jsonl.gz
- Rows with sequence: 75973
- Rows with wild-type sequence: 71428
- Rows with variant sequence: 20798
- Rows with SMILES: 91737

Data sources, licenses and attribution
- BRENDA (brenda): 89502 rows; license CC BY 4.0; https://www.brenda-enzymes.org/
- Open Enzyme Database (OED) (oed): 28360 rows; license CC BY 4.0; https://openenzymedb.platform.moleculemaker.org/
- UniProt (uniprot): 15986 rows; license CC BY 4.0; https://www.uniprot.org/
- SABIO-RK (sabio_rk): 12862 rows; license SABIO-RK terms (free for academic use; see sabiork.h-its.org); https://sabiork.h-its.org/
- SKiD (Structure-Oriented Kinetics Database) (skid): 4224 rows; license CC BY-NC-ND 4.0; https://zenodo.org/records/15355031
- Primary literature (direct extraction) (primary_paper_direct): 193 rows; license as published (see paper)
- STRENDA DB (strenda): 3 rows; license see source; https://www.beilstein-strenda-db.org/
- Every row carries source_license, derived from the database(s) it was merged from.
- SKiD-derived rows carry a NonCommercial-NoDerivatives license (CC BY-NC-ND 4.0); reuse them only under those terms.
- For reuse of CatLog review notes and corrections, contact the Chowdhury Lab.
