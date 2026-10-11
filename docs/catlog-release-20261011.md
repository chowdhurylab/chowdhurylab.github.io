# CatLog release October 11, 2026

- Records: 169,309; accepted (Verified and Corrected): 41,473.
- Base: the certified October 7, 2026 checkpoint of the old catalog (generation d241dad83bc1).
- CatLog v2: 25,783 measurements from 972 papers (and 12 papers finished with no kcat/Km values),
  each value read from the paper by an AI model and checked against it by a second, separate AI run. They replace
  these papers' 15,920 older rows (1,276 of them accepted); papers finished with no values no longer show old rows.
  CatLog v2 commit 3a39eee, catlog_wide sha256 6ab671ba64fd0375.
- Site changes in this release: feat(catlog): show which records a human reviewer checked (human-checked under Status, the reviewer note in Review notes); feat(catlog): say plainly that CatLog v2 rows are read and checked by AI; mark them "from paper"; superscript units; Sequence note; Primary literature in Stats; Greek-folded search; download and citation text; fix(catlog): from-paper tag only on CatLog v2 rows; human note wording on open records; Checks pending in Stats; row status tooltips; cleaner old-row sequence notes; stored units shown when not converted; Read-from-the-paper filter; marks load without blocking; fix(catlog): decimal exponents in superscript units; human-checked guide wording; exact-key marks; plain table-download text; open record gets its human note when marks load; Safari citation select.
- The human-review ledger file is unchanged.
- Human review: 1,982 records carry a human-review mark; the 1,800 accepted ones show human-checked under Status (HUMAN_REVIEW.md Guideline).
