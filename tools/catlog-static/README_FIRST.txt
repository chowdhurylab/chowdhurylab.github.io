CatLog static snapshot

This copy is for hosting only
- Serve index.html together with the assets and data folders from a web server (https).
- Keep the folder structure unchanged.
- The records-*.js chunks that the double-click (file://) path needs are not included,
  so opening index.html directly from disk shows an empty catalog. Build without the
  web-only option for a double-click copy.

Snapshot details
- Rows: 156431
- Generated (UTC): 2026-09-20T15:42:40+00:00
- Exporter commit: 2a1e6443763d61efdd23b6c2574580ce3428f745
- Source: verified_catlog.jsonl
- Source SHA-256: 624e998bee0ab307c39e713b6997c2e6a6c5619262633915a8658516da028c03
- Public content SHA-256 (decompressed all-public-data JSONL): b3cf5d48d78f1957a70434dc53e23cee13eb559692ac4e7240113b60b182df1e
- Package: compact_public
- Contents: Full row coverage with compact public-facing fields. Raw source snapshots and private review payloads are not bundled.
- All public data: downloads all rows with available protein sequences, SMILES, references, and source details
- Analysis aliases: enzyme, substrate, uniprot, status, and source
- Table index: downloads a smaller all-row index without protein or substrate structure strings
- Download page: exports the displayed rows with public molecular identity, references, and source details
- All public data file: data/catlog-enriched.0867b2f89e73.jsonl.gz
- Rows with sequence: 76279
- Rows with wild-type sequence: 71627
- Rows with variant sequence: 20790
- Rows with SMILES: 93212

Data sources, licenses and attribution
- BRENDA (brenda): 92177 rows; license CC BY 4.0; https://www.brenda-enzymes.org/
- Open Enzyme Database (OED) (oed): 29779 rows; license CC BY 4.0; https://openenzymedb.platform.moleculemaker.org/
- UniProt (uniprot): 16314 rows; license CC BY 4.0; https://www.uniprot.org/
- SABIO-RK (sabio_rk): 13658 rows; license SABIO-RK terms (free for academic use; see sabiork.h-its.org); https://sabiork.h-its.org/
- SKiD (Structure-Oriented Kinetics Database) (skid): 4247 rows; license CC BY-NC-ND 4.0; https://zenodo.org/records/15355031
- Primary literature (direct extraction) (primary_paper_direct): 193 rows; license as published (see paper)
- STRENDA DB (strenda): 3 rows; license see source; https://www.beilstein-strenda-db.org/
- Every row carries source_license, derived from the database(s) it was merged from.
- SKiD-derived rows carry a NonCommercial-NoDerivatives license (CC BY-NC-ND 4.0); reuse them only under those terms.
- For reuse of CatLog review notes and corrections, contact the Chowdhury Lab.
