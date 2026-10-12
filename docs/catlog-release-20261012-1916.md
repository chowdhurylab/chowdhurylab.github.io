# CatLog release October 12, 2026

- Records: 169,060, of them 51,485 accepted (41,156 read from the paper by CatLog, 10,329 from the earlier catalog). Data ID 7a8dd50c1e.
- New from CatLog: CatLog read 1,652 papers; 1,630 of them give 41,156 records and 22 give none. These records replace the papers' 31,542 older records (6,585 of them accepted); papers that give none no longer show older records.
  CatLog reads papers directly. An AI model (Claude, Anthropic) reads each kcat, Km and kcat/Km with its unit, enzyme, organism, substrate and assay conditions. A second, separate AI check compares every value with the paper. Code confirms that the quoted line is in the paper text, and converts units where the paper's differ from the catalog's. Each value keeps where it is printed and the number as printed. A person has not checked these values unless the record is marked human-checked.
- Older records: the October 7, 2026 catalog.
- Review rules: an accepted record needs a linked paper, so 173 older records without a PMID or DOI are no longer counted as accepted; 121 older records whose every value a human reviewer approved are accepted.
- Checks: 973 values audited so far, 2 wrong and removed; 1,861 accepted records human-checked; CatLog has the same value for 2,232 of the 2,489 values human reviewers approved on papers it has read (89.7%).
- Site changes:
  - The outdated CatLog method files (tools/catlog/, 29 files) leave the site, and the human-review notes are rewritten in five plain lines.
  - Source is the first filter: All records, Read from the paper by CatLog or From enzyme databases (by database), and the status cell names each record's source.
  - Review results read Accepted, Not confirmed, Not checked and Disputed, with their definitions, status colours and Only human-checked under Accepted.
  - A variant's mutation has its own line under the enzyme name in the table and after organism and substrate on phones.
  - Filter counts follow the current results, each option counted with its own group set aside, and options at 0 are greyed.
  - Values show no more precision than was measured: at most 4 significant figures, 3 for per-minute conversions, and a kcat/Km equal to kcat ÷ Km is shown as calculated.
  - And 60 smaller fixes.
