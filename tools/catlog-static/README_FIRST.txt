CatLog static snapshot

This copy is for hosting only
- Serve index.html together with the assets and data folders from a web server (https).
- Keep the folder structure unchanged.
- The records-*.js chunks that the double-click (file://) path needs are not included,
  so opening index.html directly from disk shows an empty catalog. Build without the
  web-only option for a double-click copy.

Snapshot details
- Rows: 148289
- Generated (UTC): 2026-09-03T11:00:07+00:00
- Exporter commit: 8e43ff631e973815da3a1597aa1ddd87e84fddc5
- Source: verified_catlog.jsonl
- Source SHA-256: 90adc875fe5c57b3bcea38193cb30a66351cc0418dd009bafa91463cfa58417e
- Public content SHA-256 (decompressed all-public-data JSONL): d73d5682af88d2ea86b7c092fe5d92d6002eea66212c04c108c6f1afebca642f
- Package: compact_public
- Contents: Full row coverage with compact public-facing fields. Raw source snapshots, private review payloads, and other large provenance blobs are not bundled.
- All public data: downloads all rows with available protein sequences, SMILES, references, and public provenance
- Analysis aliases: enzyme, substrate, uniprot, status, and source
- Table index: downloads a smaller all-row index without protein or substrate structure strings
- Download page: exports the displayed rows with public molecular identity, references, and provenance
- All public data file: data/catlog-enriched.jsonl.gz
- Rows with sequence: 75936
- Rows with wild-type sequence: 49456
- Rows with variant sequence: 20764
- Rows with SMILES: 90444

Data sources, licenses and attribution
- BRENDA (brenda): 88368 rows; license CC BY 4.0; https://www.brenda-enzymes.org/
- Open Enzyme Database (OED) (oed): 27113 rows; license CC BY 4.0; https://openenzymedb.platform.moleculemaker.org/
- UniProt (uniprot): 15945 rows; license CC BY 4.0; https://www.uniprot.org/
- SABIO-RK (sabio_rk): 12289 rows; license SABIO-RK terms (free for academic use; see sabiork.h-its.org); https://sabiork.h-its.org/
- SKiD (Structure-Oriented Kinetics Database) (skid): 4143 rows; license CC BY-NC-ND 4.0; https://zenodo.org/records/15355031
- Primary literature (direct extraction) (primary_paper_direct): 193 rows; license as published (see paper)
- unknown (unknown): 151 rows; license see source
- sabio_rk;brenda (sabio_rk;brenda): 11 rows; license see source
- brenda; skid (brenda; skid): 9 rows; license see source
- brenda;skid (brenda;skid): 9 rows; license see source
- sabio_rk;brenda;skid (sabio_rk;brenda;skid): 7 rows; license see source
- brenda,skid (brenda,skid): 6 rows; license see source
- sabio_rk,brenda (sabio_rk,brenda): 6 rows; license see source
- sabio_rk; brenda (sabio_rk; brenda): 5 rows; license see source
- brenda, skid (brenda, skid): 4 rows; license see source
- sabio_rk, brenda (sabio_rk, brenda): 3 rows; license see source
- sabio_rk, brenda, skid (sabio_rk, brenda, skid): 3 rows; license see source
- sabio_rk,brenda,skid (sabio_rk,brenda,skid): 3 rows; license see source
- sabio_rk,skid (sabio_rk,skid): 3 rows; license see source
- sabio_rk/brenda (sabio_rk/brenda): 3 rows; license see source
- sabio_rk/skid (sabio_rk/skid): 3 rows; license see source
- STRENDA DB (strenda): 3 rows; license see source; https://www.beilstein-strenda-db.org/
- brenda/skid (brenda/skid): 2 rows; license see source
- merged (merged): 2 rows; license see source
- sabio_rk;skid (sabio_rk;skid): 2 rows; license see source
- mixed (mixed): 1 rows; license see source
- sabio_rk+brenda (sabio_rk+brenda): 1 rows; license see source
- sabio_rk, skid (sabio_rk, skid): 1 rows; license see source
- Every row carries source_license, derived from the database(s) it was merged from.
- SKiD-derived rows carry a NonCommercial-NoDerivatives license (CC BY-NC-ND 4.0); reuse them only under those terms.
- License of the CatLog curation layer: to be stated by the Chowdhury Lab
