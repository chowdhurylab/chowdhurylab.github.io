# CatLog release October 18, 2026

- Records: 185,804, of them 80,843 accepted (75,000 of these read from the paper, 5,843 not yet re-read). Data ID b944300ce7.
- Read from the paper: CatLog read 4,396 papers; 4,324 of them give 75,000 records and 72 give none. These records replace the papers' 48,642 entries from CatLog's earlier version (10,981 of them accepted); papers that give none no longer show entries from the earlier version.
  CatLog re-verifies published enzyme kinetics against the papers they come from. An AI model (Claude, Anthropic) reads each kcat, Km and kcat/Km in a paper with its unit, enzyme, organism, substrate and assay conditions. A second, separate AI check compares every value with the paper. Automated checks confirm that the quoted line is in the paper text and convert units where the paper's differ from CatLog's. Each value keeps where it is printed and the number as printed. AI audits and human reviewers check samples against the papers; a person has not checked a value unless its record is marked human-checked.
- Records not yet re-read: CatLog's earlier version, the October 7, 2026 catalog.
- Review rules: an accepted record needs a linked paper, so 173 records not yet re-read without a PMID or DOI are no longer counted as accepted; 31 records not yet re-read whose values a human reviewer approved are accepted.
- Checks: 3,401 values audited so far, 65 wrong and removed; 1,721 accepted records human-checked; human review of entries from CatLog's earlier version: no value disputed on 2,767 of 2,770 entries (99.9%); where CatLog has re-read a paper the reviewers checked, its value matches the approved value for 3,940 of 4,494 (87.7%), no CatLog value found wrong.
- Site changes:
  - In Safari the browser check skips the database checks that reload the whole catalog per link, width or old address (Chrome covers them), so the Safari job fits its time.
  - A record's Against the databases section no longer ends with the same note every time: the compared databases and the caution sit behind a "?" beside its heading, and the caution shows under the notes only when a value has a different number.
  - Active filters above the table are coloured by filter group, matching a dot beside each group in the sidebar, and an Undo button before Clear all brings back the filters before the last change, Clear all included.
  - A filter chip whose option already has a colour on the page now wears that colour (a review result its status dot's, a database result its square's, a caution amber), and Source, the enzyme fields and the measurement take colours that mean nothing else on the page.
  - Undo now keeps one place, first in the bar above the table and right before × in the phone filter sheet (dimmed when there is nothing to undo), so pressing it again undoes one more change instead of removing a chip or clearing all.
  - A word typed in a filter or the search box is now one Undo step instead of one per pause, and Undo pressed just after typing takes back the keys not yet applied.
  - And 88 smaller fixes.
- Retired from the site (they stay in git history): 1361 files (186 MB) of the older generation(s) manifest.04844c49d4a5.js, manifest.33f7ae338f79.js.
