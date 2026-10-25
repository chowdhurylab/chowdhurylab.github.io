# CatLog release October 25, 2026

- Records: 190,222, of them 100,639 accepted (98,324 of these read from the paper, 2,315 not yet re-read). Data ID 523fd5860b.
- Read from the paper: CatLog read 6,575 papers; 6,391 of them give 98,324 records and 184 give none. These records replace the papers' 67,548 records of CatLog's earlier version (14,508 of them accepted); papers that give none keep no earlier records.
  An AI model (Claude, Anthropic) reads each kcat, Km and kcat/Km in a paper with its unit, enzyme, organism, substrate and assay conditions. A second, separate AI check compares every value with the paper. Automated checks confirm that the quoted line is in the paper text and convert the paper's units to CatLog's. Each value keeps where it is printed and the number as printed. AI audits and human reviewers check samples against the papers; only records marked human-checked count as checked by a person.
- Records not yet re-read: CatLog's earlier version, the October 7, 2026 snapshot.
- Review rules: an accepted record needs a linked paper, so 173 records not yet re-read without a PMID or DOI are not counted as accepted; 30 records not yet re-read are accepted because a human reviewer approved their values.
- Checks:
  - AI audits: 6,928 values audited at random so far, 29 wrong and removed (0.42%; 95% interval 0.29-0.60%); 696 more audited because an audit sample or a database check pointed to them, 119 wrong and removed.
  - Human review: 1,791 accepted records (3,687 values) are human-checked. Of the records of CatLog's earlier version people checked, no value disputed on 2,601 of 2,604 with a paper (99.9%); 166 had no paper and could not be checked.
  - Agreement with the human review: where CatLog has re-read a paper the reviewers checked, its value now matches the approved value for 3,969 of 4,522 (87.8%); comparing them found 68 wrong labels and 1 missed value in CatLog, all fixed since; AI agents checked 321 of the other 553 against the paper and none is a CatLog value found wrong; 232 are not yet checked.
- Site changes:
  - CatLog's main site is now catlog.structf.studio; this page stays as a mirror and is updated rarely.
  - Stats: Human review shown as two plain bars, and Errors caught by CatLog's checks.
  - Fresh data: the latest papers read from the paper.
