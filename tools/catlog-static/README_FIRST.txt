CatLog static snapshot

This copy is for hosting only
- Serve index.html together with the assets and data folders from a web server (https).
- Keep the folder structure unchanged.
- The records-*.js chunks that the double-click (file://) path needs are not included,
  so opening index.html directly from disk shows an empty catalog. Build without the
  web-only option for a double-click copy.

Snapshot details
- Rows: 153223
- Generated (UTC): 2026-09-15T12:19:39+00:00
- Exporter commit: 2a1e6443763d61efdd23b6c2574580ce3428f745
- Source: verified_catlog.jsonl
- Source SHA-256: 9589470d93d5450fd8c95558e9c26417550c911cd8d83c384ae0741b1afb3656
- Public content SHA-256 (decompressed all-public-data JSONL): 8ec0dad0af54654604394b05ceb9fae10699e166a4e456d6a0bc89e7f17d9ad2
- Package: compact_public
- Contents: Full row coverage with compact public-facing fields. Raw source snapshots and private review payloads are not bundled.
- Full data: downloads all rows with available protein sequences, SMILES, references, and source details
- Analysis aliases: enzyme, substrate, uniprot, status, and source
- Table: downloads all rows without sequence or SMILES fields
- Download page: exports the displayed rows with public molecular identity, references, and source details
- Full data file: data/catlog-enriched.21aa407988ca.jsonl.gz
- Rows with sequence: 76281
- Rows with wild-type sequence: 71629
- Rows with variant sequence: 20798
- Rows with SMILES: 92289

Data sources, licenses and attribution
- BRENDA (brenda): 90615 rows; license CC BY 4.0; https://www.brenda-enzymes.org/
- Open Enzyme Database (OED) (oed): 28857 rows; license CC BY 4.0; https://openenzymedb.platform.moleculemaker.org/
- UniProt (uniprot): 16295 rows; license CC BY 4.0; https://www.uniprot.org/
- SABIO-RK (sabio_rk): 12964 rows; license SABIO-RK terms (free for academic use; see sabiork.h-its.org); https://sabiork.h-its.org/
- SKiD (Structure-Oriented Kinetics Database) (skid): 4236 rows; license CC BY-NC-ND 4.0; https://zenodo.org/records/15355031
- Primary literature (direct extraction) (primary_paper_direct): 193 rows; license as published (see paper)
- STRENDA DB (strenda): 3 rows; license see source; https://www.beilstein-strenda-db.org/
- Every row carries source_license, derived from the database(s) it was merged from.
- SKiD-derived rows carry a NonCommercial-NoDerivatives license (CC BY-NC-ND 4.0); reuse them only under those terms.
- For reuse of CatLog review notes and corrections, contact the Chowdhury Lab.
