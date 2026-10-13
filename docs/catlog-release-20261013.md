# CatLog release October 13, 2026

- Records: 169,413, of them 53,545 accepted (44,627 read from the paper by CatLog, 8,918 from the earlier catalog). Data ID 3df64d5f0c.
- New from CatLog: CatLog read 1,944 papers; 1,919 of them give 44,627 records and 25 give none. These records replace the papers' 34,660 older records (7,933 of them accepted); papers that give none no longer show older records.
  CatLog reads papers directly. An AI model (Claude, Anthropic) reads each kcat, Km and kcat/Km with its unit, enzyme, organism, substrate and assay conditions. A second, separate AI check compares every value with the paper. Code confirms that the quoted line is in the paper text, and converts units where the paper's differ from the catalog's. Each value keeps where it is printed and the number as printed. A person has not checked these values unless the record is marked human-checked.
- Older records: the October 7, 2026 catalog.
- Review rules: an accepted record needs a linked paper, so 173 older records without a PMID or DOI are no longer counted as accepted; 58 older records whose every value a human reviewer approved are accepted.
- Checks: 1,081 values audited so far, 3 wrong and removed; 1,543 accepted records human-checked; at the first comparison CatLog had the same value for 85.6% of the values human reviewers approved on the 271 papers it read fully blind (95% range 80.9-89.9); 88.9% after fixing what that comparison found.
- Site changes:
  - The site uses one type scale (12 to 32px), a 2px focus ring and the Nature BPG status colours: navy accepted, salmon not confirmed, slate unverified, tan not reviewed, dark red disputed.
  - The header is one 56px line with a Team tab (Browse · Stats · Guide · Team, then the links out) and the counts band shows its numbers at 20px; phones put the links beside Download and the four tabs across the width.
  - Filters are a sidebar beside the table, never over it: open from 1024px (a viewer's « collapses it to a 48px rail, remembered), the rail on tablets and while a record is open below 1600px, a full-screen sheet on phones; the active filters sit in the table's toolbar.
  - The Guide's headings and text, the Stats column (1200px, centred) and the 32px buttons follow the same type scale and grid.
  - The design notes describe the new type scale, the Nature BPG colour tokens, the page grid, the filter sidebar and the Team tab.
  - On phones Filters, Export and Sort stay on one toolbar row.
  - And 154 smaller fixes.
