CatLog static snapshot

This copy is for hosting only
- Serve index.html together with the assets and data folders from a web server (https).
- Keep the folder structure unchanged.
- The records-*.js chunks that the double-click (file://) path needs are not included,
  so opening index.html directly from disk shows an empty catalog. Build without the
  web-only option for a double-click copy.

Snapshot details
- Rows: 158795
- Generated (UTC): 2026-10-02T16:55:36+00:00
- Exporter commit: e0e0b3e8a073d968a004d71f591bef2059a3f16f
- Source: verified_catlog.jsonl
- Source SHA-256: 8ff3f2d6a7a8f6ec167234c38652aa57cf9f3d3f5007762c18548ab288fe5138
- Public content SHA-256 (decompressed all-public-data JSONL): c8b4c123c5d51f89d4440b8fed3efca9efa3e9379a30802f950febf7006b5154
- Package: compact_public
- Contents: Full row coverage with compact public-facing fields. Raw source snapshots and private review payloads are not bundled.
- All public data: downloads all rows with available protein sequences, SMILES, references, and source details
- Analysis aliases: enzyme, substrate, uniprot, status, and source
- Table index: downloads a smaller all-row index without protein or substrate structure strings
- Download page: exports the displayed rows with public molecular identity, references, and source details
- All public data file: data/catlog-enriched.889fbe06ec74.jsonl.gz
- Rows with sequence: 76275
- Rows with wild-type sequence: 71740
- Rows with variant sequence: 20788
- Rows with SMILES: 93798

Data sources, licenses and attribution
- BRENDA (brenda): 93558 rows; license CC BY 4.0; https://www.brenda-enzymes.org/
- Open Enzyme Database (OED) (oed): 30365 rows; license CC BY 4.0; https://openenzymedb.platform.moleculemaker.org/
- UniProt (uniprot): 16323 rows; license CC BY 4.0; https://www.uniprot.org/
- SABIO-RK (sabio_rk): 14033 rows; license SABIO-RK terms (free for academic use; see sabiork.h-its.org); https://sabiork.h-its.org/
- SKiD (Structure-Oriented Kinetics Database) (skid): 4262 rows; license CC BY-NC-ND 4.0; https://zenodo.org/records/15355031
- Primary literature (direct extraction) (primary_paper_direct): 193 rows; license as published (see paper)
- STRENDA DB (strenda): 3 rows; license see source; https://www.beilstein-strenda-db.org/
- Every row carries source_license, derived from the database(s) it was merged from.
- SKiD-derived rows carry a NonCommercial-NoDerivatives license (CC BY-NC-ND 4.0); reuse them only under those terms.
- For reuse of CatLog review notes and corrections, contact the Chowdhury Lab.
