# CatLog release October 13, 2026

- Records: 174,553, of them 62,483 accepted (55,153 read from the paper by CatLog as CatLog v2 entries, 7,330 CatLog v1 entries). Data ID 91e8c74eac.
- New from CatLog: CatLog read 2,701 papers; 2,663 of them give 55,153 records and 38 give none. These records replace the papers' 40,046 CatLog v1 entries (9,500 of them accepted); papers that give none no longer show CatLog v1 entries.
  CatLog reads papers directly. An AI model (Claude, Anthropic) reads each kcat, Km and kcat/Km with its unit, enzyme, organism, substrate and assay conditions. A second, separate AI check compares every value with the paper. Code confirms that the quoted line is in the paper text, and converts units where the paper's differ from the catalog's. Each value keeps where it is printed and the number as printed. A person has not checked these values unless the record is marked human-checked.
- CatLog v1 entries: the October 7, 2026 catalog.
- Review rules: an accepted record needs a linked paper, so 173 CatLog v1 entries without a PMID or DOI are no longer counted as accepted; 37 CatLog v1 entries whose values a human reviewer approved are accepted.
- Checks: 1,511 values audited so far, 31 wrong and removed; 1,721 accepted records human-checked; human review of CatLog v1 entries: values correct 99.9% (3 of 2,674 entries with a disputed value); CatLog v2 has the reviewers' value for 3,660 of 4,109 approved values (89.1%), no wrong value found.
- Site changes:
  - The table and phone cards no longer show temperature and pH (the record, the filters and the downloads keep them), and records of one paper that differ only there say which under the substrate.
  - The filter sidebar is compact: one short line per option that never runs into the next, and each group's explanations behind a small "?" beside its title.
  - A filter group Against the databases finds the records whose values CatLog corrected against an enzyme database, those that differ, the same or new to them, shown once the snapshot carries that comparison.
  - With a wide system font the Review result heading is never cut and the phone header's links out wrap at the right instead of running over the brand.
  - Corrects a database says that the record gives what the paper prints and why a database differs.
  - A record now shows a small green check after each value a human reviewer approved, with one line under its Values table saying what the check means.
  - And 123 smaller fixes.
