# CatLog release October 13, 2026

- Records: 169,413, of them 53,545 accepted (44,627 read from the paper by CatLog, 8,918 from the earlier catalog). Data ID 3df64d5f0c.
- New from CatLog: CatLog read 1,944 papers; 1,919 of them give 44,627 records and 25 give none. These records replace the papers' 34,660 older records (7,933 of them accepted); papers that give none no longer show older records.
  CatLog reads papers directly. An AI model (Claude, Anthropic) reads each kcat, Km and kcat/Km with its unit, enzyme, organism, substrate and assay conditions. A second, separate AI check compares every value with the paper. Code confirms that the quoted line is in the paper text, and converts units where the paper's differ from the catalog's. Each value keeps where it is printed and the number as printed. A person has not checked these values unless the record is marked human-checked.
- Older records: the October 7, 2026 catalog.
- Review rules: an accepted record needs a linked paper, so 173 older records without a PMID or DOI are no longer counted as accepted; 58 older records whose every value a human reviewer approved are accepted.
- Checks: 1,081 values audited so far, 3 wrong and removed; 1,543 accepted records human-checked; at the first comparison CatLog had the same value for 85.6% of the values human reviewers approved on the 271 papers it read fully blind (95% range 80.9-89.9); 88.9% after fixing what that comparison found.
- Site changes:
  - On the narrowest phones a record's Values table stays inside its section (units may wrap, cells come closer), and the browser check accepts the short link names a narrow window shows.
