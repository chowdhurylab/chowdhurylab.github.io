# CatLog release October 15, 2026

- Records: 178,676, of them 68,709 accepted (61,919 of these read from the paper, 6,790 not yet re-read). Data ID 8a39252508.
- New from CatLog: CatLog read 3,155 papers; 3,103 of them give 61,919 records and 52 give none. These records replace the papers' 42,689 entries from CatLog's earlier version (10,036 of them accepted); papers that give none no longer show entries from the earlier version.
  CatLog reads papers directly. An AI model (Claude, Anthropic) reads each kcat, Km and kcat/Km with its unit, enzyme, organism, substrate and assay conditions. A second, separate AI check compares every value with the paper. Code confirms that the quoted line is in the paper text, and converts units where the paper's differ from the catalog's. Each value keeps where it is printed and the number as printed. A person has not checked these values unless the record is marked human-checked.
- Records not yet re-read: CatLog's earlier version, the October 7, 2026 catalog.
- Review rules: an accepted record needs a linked paper, so 173 records not yet re-read without a PMID or DOI are no longer counted as accepted; 33 records not yet re-read whose values a human reviewer approved are accepted.
- Checks: 1,712 values audited so far, 57 wrong and removed; 1,739 accepted records human-checked; human review of entries from CatLog's earlier version: values correct 99.9% (3 of 2,770 entries with a disputed value); read from the paper again, CatLog has the reviewers' value for 3,903 of 4,441 approved values (87.9%), no wrong value found.
- Site changes:
  - Records are labelled by what happened to them: Read from the paper or Not yet re-read.
  - The human review leads Stats, the Guide and Team as values correct of the earlier version's entries, with the match on reading the paper again beside it.
  - Stats' figure titles, tables and enzyme-class stripe name the records read from the paper.
  - The Guide calls records Read from the paper or Not yet re-read and names the earlier version in its method section.
  - A record's review notes name the earlier version's entries.
  - The new labels keep one line in wide fonts such as DejaVu Sans in the filter sidebar, the counts band and Stats.
  - And 36 smaller fixes.
