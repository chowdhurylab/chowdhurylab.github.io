# CatLog release October 22, 2026

- Records: 186,193, of them 91,069 accepted (87,768 of these read from the paper, 3,301 not yet re-read). Data ID d5ba68e3e3.
- Read from the paper: CatLog read 5,968 papers; 5,805 of them give 87,768 records and 163 give none. These records replace the papers' 61,021 entries from CatLog's earlier version (13,584 of them accepted); papers that give none keep no earlier entries.
  An AI model (Claude, Anthropic) reads each kcat, Km and kcat/Km in a paper with its unit, enzyme, organism, substrate and assay conditions. A second, separate AI check compares every value with the paper. Automated checks confirm that the quoted line is in the paper text and convert the paper's units to CatLog's. Each value keeps where it is printed and the number as printed. AI audits and human reviewers check samples against the papers; only records marked human-checked count as checked by a person.
- Records not yet re-read: CatLog's earlier version, the October 7, 2026 catalog.
- Review rules: an accepted record needs a linked paper, so 173 records not yet re-read without a PMID or DOI are not counted as accepted; 92 records not yet re-read are accepted because a human reviewer approved their values.
- Checks:
  - AI audits: 6,477 values audited at random so far, 28 wrong and removed (0.4%; 95% interval 0.30-0.62%); 188 more audited because an audit sample or a database check pointed to them, 46 wrong and removed.
  - Human review: 1,841 accepted records (3,952 values) are human-checked. Of the entries from CatLog's earlier version, no value disputed on 2,601 of 2,604 with a paper (99.9%); 166 had no paper and could not be checked.
  - Agreement with the human review: where CatLog has re-read a paper the reviewers checked, its value now matches the approved value for 3,967 of 4,522 (87.7%); comparing them found 68 wrong labels and 1 missed value in CatLog, all fixed since; AI agents checked 323 of the other 555 against the paper and none is a CatLog value found wrong; 232 are not yet checked.
- Site changes:
  - Stats: CatLog's values beside BRENDA 2026.1 by publication year, new analyses of the values read from the paper (the same enzyme and substrate between papers, substrate specificity, kcat by assay temperature, Km by substrate size, the variants papers make) and a supplement of further figures and tables.
  - Quality numbers with their scope: the AI audit's rate with its 95% interval, CatLog's own errors by how they were found, and the papers read with database values in view.
  - Browse: a counts band that gives each number its context, the Source filter under More filters, look-alike rows told apart by their assay, and each colour with one meaning in a calmer look.
  - Guide: shorter, in four steps; Team adds Vaishnavey (AI critique).
- Retired from the site (they stay in git history): 2108 files (299 MB) of the older generation(s) manifest.053089286742.js, manifest.3bee8d8c96bc.js, manifest.88e4edf508da.js, manifest.974f5ebf89d6.js, manifest.d61d096e3ee5.js, manifest.e319a0b9d66c.js.
