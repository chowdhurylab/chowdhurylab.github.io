CatLog static snapshot

This copy is for hosting only
- Serve index.html together with the assets and data folders from a web server (https).
- Keep the folder structure unchanged.
- The records-*.js chunks that the double-click (file://) path needs are not included,
  so opening index.html directly from disk shows an empty catalog. Build without the
  web-only option for a double-click copy.

Snapshot details
- Rows: 151448
- Generated (UTC): 2026-09-10T19:13:30+00:00
- Exporter commit: c248f580740dc9a44a39f3a7c4bfdfbf36687239
- Source: verified_catlog.jsonl
- Source SHA-256: 7839abc55a23e1519b7ba16bbe2dcb3368e88f9737c1004565b17289a4f5f914
- Public content SHA-256 (decompressed all-public-data JSONL): 0750d6ee74639c99520839cbb750fa49dd9121e0f12ebbae464fb34d5a43dc75
- Package: compact_public
- Contents: Full row coverage with compact public-facing fields. Raw source snapshots and private review payloads are not bundled.
- Full data: downloads all rows with available protein sequences, SMILES, references, and source details
- Analysis aliases: enzyme, substrate, uniprot, status, and source
- Table: downloads all rows without sequence or SMILES fields
- Download page: exports the displayed rows with public molecular identity, references, and source details
- Full data file: data/catlog-enriched.bc8a67ffdb08.jsonl.gz
- Rows with sequence: 76093
- Rows with wild-type sequence: 71546
- Rows with variant sequence: 20798
- Rows with SMILES: 91824

Data sources, licenses and attribution
- BRENDA (brenda): 89535 rows; license CC BY 4.0; https://www.brenda-enzymes.org/
- Open Enzyme Database (OED) (oed): 28443 rows; license CC BY 4.0; https://openenzymedb.platform.moleculemaker.org/
- UniProt (uniprot): 16106 rows; license CC BY 4.0; https://www.uniprot.org/
- SABIO-RK (sabio_rk): 12884 rows; license SABIO-RK terms (free for academic use; see sabiork.h-its.org); https://sabiork.h-its.org/
- SKiD (Structure-Oriented Kinetics Database) (skid): 4224 rows; license CC BY-NC-ND 4.0; https://zenodo.org/records/15355031
- Primary literature (direct extraction) (primary_paper_direct): 193 rows; license as published (see paper)
- STRENDA DB (strenda): 3 rows; license see source; https://www.beilstein-strenda-db.org/
- Every row carries source_license, derived from the database(s) it was merged from.
- SKiD-derived rows carry a NonCommercial-NoDerivatives license (CC BY-NC-ND 4.0); reuse them only under those terms.
- For reuse of CatLog review notes and corrections, contact the Chowdhury Lab.
