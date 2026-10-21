# CatLog Public UI

Browse is the working table. Keep its header, search, compact counts, filters,
record drawer and downloads intact. Stats is a separate page, not a drawer or
expanding summary that takes space from the table. The filter sidebar shows in view only
the filters most visitors use (Enzyme, organism, substrate; Measurement type; Review result
with human-checked), each option one short line with its count, and folds the
specialist groups (Source, first since round 14; Wild type or variant, Assay conditions, Against the databases,
Cautions, Source database) under one "More filters", which opens by itself when one of them is set
and counts them on its title; help text sits behind each group's "?", never in view; no
option, address or chip changed (the user, 2026-10-18). Browse's active-filter chips
are plain since round 14 (a 1px hairline on white, no stripe or tint): the colour is on the option's own mark before
its name, in its meaning colour (a review result's status dot, human-checked's tick, Read from the paper's cyan square,
a database result's square, a caution's "!"), and the filters with no meaning colour have no mark; and Undo,
first in the bar (it keeps its place, dimmed with nothing to undo), restores the filter set before the last change,
Clear all too
(tools/catlog-static/DESIGN.md, Filters).

## Stats

Stats answers "what is in CatLog" in one plain page. It reads the snapshot
manifest only (never the record index, detail shards or review marks): the
summary counts and, when present, `summary.overview`, which
`scripts/build-catlog-followup-summary.py` (`build_overview`) counts from the
Full data download of the same snapshot (its sha256 must match
`enriched_download`) and the human-review marks. Every count uses all records,
before filtering. Show exact counts; a nonzero share below 0.1% prints <0.1%.
An older manifest without an overview shows what it has: never an empty
heading, a headline without its number, or a count above the record total.

Order (the user, 2026-10-13: "more stuff in Stats or make it better organized"): the title (24px) with the snapshot
line, under it one 14px line "On this page" naming the parts as their headings number them, each a link to the part's
own address (#stats-<key>, the part section's id: it opens Stats at that part, with the heading focused when followed
in the page; the line wraps between parts only and is left out of print), the way to a part on a phone, where Stats
runs 17 screens (2026-10-15); then numbered parts, each with one plain heading (20px, its number in plain muted figures before it: no disc, round 14) and its figures and
tables on a 12-column grid (max 1200px, gaps 48px and 32px), two to a row from 1024px (an odd one out spans the row;
a bar chart that spans it keeps its labels within 240px of the bars; from 1024 to 1279px Figures 1 and 2 take a row
each, so the legend table keeps its room beside the donut), one below. Figures and tables are numbered across parts.

1. At a glance, the headline band, the page's focal point. Round 14 (the user's colleague: "it looks a bit AI-ish,
   with the glow"): a plain white card with a 1px --line hairline and a 4px radius, no glow, halo, wash, gradient rule or
   entrance motion (round 13 had an accent glow round it, a fading accent rule along its top, a corner wash and a soft
   radial halo behind each number). Line 1 (40px, 600, tabular numbers): Records, Accepted with its share, Read from the
   paper with its papers, Human review ("99.9%", "no value disputed on 2,767 of 2,770 entries from the earlier version
   (431 papers)"; a snapshot without the review's counts gives the share of approved values the same where CatLog has
   re-read the paper), the numbers in the colours Browse's counts band gives them (Records ink, Accepted navy, Read from
   the paper the darker BPG cyan --src-paper-ink, Human review the human-checked green: one meaning per colour), leading
   by size, weight and whitespace alone; under the pointer a linked item takes a flat 9% tint of its colour and its
   label and note step up to --text-2 (muted on the tint fell to 4.46:1; --text-2 is 7.3:1). The numbers stand still
   (no entrance motion; the page no longer sets an is-entering class). Line 2 (20px): Papers,
   Enzymes, EC numbers, Organisms, Substrates. Accepted and Read from the paper link into Browse: the whole item is the
   link and tints calmly under the pointer. From 721 to 1199px line 1 grows with the window from the phones' 28px to
   40px, never smaller on a wider window and with no jump at 721, 1024 or 1200px: to 30px at 1023px (the page keeps a
   760px column there, a band column about 146px, and a six-digit count in DejaVu Sans Bold at 30px is 137px), then on
   to 40px at 1200px. Phones (720px and under): 28/20px (18px
   from 640px), two to a row; below 360px line 1 stands one under the other, so Read from
   the paper keeps one line in a wide font. CatLog is the one name (round 8): records are Read from the paper or
   Not yet re-read, never v1 or v2; the earlier version is named only in help (How these numbers are counted, once on
   Stats), in the human review's base and in the Guide's method section. "re-read" never breaks at its hyphen ("re-" /
   "read" on two lines): Stats wraps each one in its text in a nowrap span (keepReRead) and the Guide writes the same span. Browse's counts band is a step quieter (round 13, the user:
   "the numbers and overall progress ... so small and colour same so it doesn't capture any attention"; round 14: no
   glow): a plain white hairline card with the four key numbers at 28px (24px on tablets, 20px on phones),
   each label over its number and each number in its meaning's colour (Records ink, Accepted navy with its status dot,
   Read from the paper the darker BPG cyan, Human-checked the darker BPG green with its tick), no text-shadow; a linked
   count tints in its colour around itself without moving anything. Its With counts (kcat, Km,
   kcat/Km) are secondary: three 12px lines beside the key numbers, 500 in --text-2, as tall as a label and its number.
   One row from 1024px up, two rows on tablets, two by two on phones (tools/catlog-static/DESIGN.md, Layout). Nothing
   moves.
2. Quality: the lead, then Checks on the values.
3. What is in the catalog: Review result (the donut) beside Records by main source, then Enzyme classes across the row.
4. Values: Value ranges, kcat against Km and Variants against their wild type, each full width.
5. Against the databases (manifest `summary.database_comparison`; round 9 brief section 5): a short lead, Values
   against the databases, then Corrections by cause and how found, each across the row (the corrections' bars kept to
   760px, stats-narrow). Each only when the snapshot has its counts; without a figure here the part has no heading,
   and a figure in the supplement that compares values still gets the caveat once, at the head of its group there.
S. Supplementary figures and tables (round 14, the user: "not every figure has to be shown like that (and tables,
   right?)"): the figures and tables that do not tell the main story, last before How these numbers are counted, in
   four groups (What is in the catalog: Read from the paper and not yet re-read, Values per paper,
   Papers by parameter, What the records contain, Wild type and variants; Organisms, enzymes and variants (Biology
   until round 14's polish): the four top-ten tables, Single
   substitutions, Kinds of variant; Values: Values by enzyme class, Assay temperature and pH, Units as printed,
   Cautions on values; Against the databases: the same by enzyme class, Results by database, Paired values by
   database, Corrections by cause and database, Corrections on records not yet re-read, Entries replaced by reading
   the paper). Figures and tables are numbered apart from the main ones and from each other, in this reading order
   ("Figure S1", "Table S1"); a figure the snapshot cannot draw takes no number. Each item is one closed line on a
   hairline list (a muted "+", its number in a muted column, its title in accent; open, "−" and the title in ink 600):
   a `<details>` whose summary holds the item's heading (h4, under the group's h3), the figure under it with its
   caption "Figure S1. ..." and no heading of its own. A figure drawn half-width in the main parts keeps to 760px; a
   wide one takes the column, with no indent, so Values by enzyme class keeps the x of Value ranges' shared log axis.
   Every item has its own address, #stats-s3 for Figure S3 and #stats-table-s2 for Table S2 (statsAddressTarget): it
   opens the item and scrolls to it, also when the page opens there, and a link to it focuses its summary (Enter or
   Space closes it again). The older #stats-biology opens What is in the catalog (its enzyme classes) and
   #stats-cautions the Cautions table. "On this page" ends with "S Supplementary figures and tables"
   (#stats-supplement). An item that opens fits its value columns and tables then (statsFitOpened, on its toggle); on
   paper every item prints open (beforeprint and the print stylesheet), and no Stats address loads the record index
   (the preload hint skips #stats-*, as #guide-*). The supplement's rules stand under their own numbers in How these
   numbers are counted, after the main figures'; Shares names "Tables S1-S4 and S9" as statsNumbersText writes them.
   New in round 14, counted by `build_overview` from the records read from the paper only (about 2 KB):
   - Papers by parameter (`from_paper_parameters`: papers, kcat, km, kcat_km, kcat_over_km, all; a calculated kcat/Km is
     not given): bars in Read from the paper's colour, Papers and % of papers, drawn only for the papers the band
     counts and counts that nest (kcat and Km within each, all three within both); no links (Browse lists records).
   - Single substitutions (`from_paper_insights.substitutions`: variants, papers, residues in the BLOSUM order
     ARNDCQEGHILKMFPSTWYV, a 20 x 20 count matrix): each variant with one substitution written as a residue, its
     position and another (H57A), once per paper, enzyme, organism and mutation, by wild-type residue (rows) and new
     residue (columns), as grey cells shaded as the kcat against Km map (a cell's count and both residues' names in
     its tooltip line); beside it the variants, the commonest new residue and the five commonest substitutions.
   - Kinds of variant (`from_paper_insights.variant_kinds`: the variant records by mutation_type: one substitution,
     several, deletion, insertion, truncation, other or not specified; drawn when they add up to the records): a table,
     its records linked to source=paper&variant=variant.
   - Units as printed (`from_paper_insights.printed_units`: per parameter the values, up to eight printed units by
     count and Other): the unit printed with each value (its proof line's raw_unit) with a power of ten set aside, read
     by `printed_unit` (per s, min or h; M, mM, µM, nM or pM, mol/L spelled out too; a lower-case m standing alone is
     the molar sign, as small capitals come out of a text layer), in a table grouped by parameter with its stored unit,
     shares of that parameter's values.
   No publication year or journal: the Full data has neither, so no figure by year (the brief's example); no organism
   kingdom or substrate kind either (no field gives them).

A closed "How these numbers are counted" ends the page: the one place the snapshot's date, its Data ID and the counting
rules are said (the user, 2026-10-15, of the line that stood under every figure, "Snapshot Oct 15, 2026 · Data ID ... ·
143,184 values in all; ...": "Do we need this???"). It gives Snapshot (the date and Data ID, counted from this
snapshot's Full data download, the human-review results and, when the audits are shown, the AI audit records),
Shares (what a share is out of: all records in the
figures and tables that count all records, named by number (Figure 1 and Tables S1-S4 and S9 today; `STATS_SHARES_OF_ALL`),
elsewhere its own bar's, row's or card's total or the total its caption names; one decimal, a nonzero share under 0.1%
written <0.1%), Papers, Names, Human-checked, Main source, Read from the paper
and Not yet re-read (with an overview), Human review (with a lead: its date and definitions), Against the databases
(with part 7: same paper and parameter, shares only on 1,000 values or more), then each figure's or table's own rules
under its number ("Figure 4", "Table 1", the title first), in reading order. It prints open, so paper and PDF keep
the Data ID and the rules: beforeprint opens it and afterprint closes it again unless the viewer had opened it, and the
print stylesheet opens its ::details-content where a browser prints without those events. A figure keeps its caption as
its accessible description; no figure or table has a data line. The parts' figures and tables:

- Lead (first in Quality, full width): Human review of the earlier version's entries, what the reviewers'
  own files say (the user, 2026-10-13: "keep it simple, reflect the review document"), from
  `overview.quality.review.v1` (catlog-v2 HUMAN_REVIEW.md "Measuring CatLog against the reviewers"; `build_overview`
  copies each reviewed catalog's numbers, strings and `other_by_kind`). Each entry a reviewer checked counts once, by
  its final verdict. Its heading is "Human review"; the big number is the share of entries where no reviewer disputed
  a kcat, Km or kcat/Km number or its unit, worked out from `entries` and `value_disputed` ("99.9%"), with the
  headline's words under it as one phrase (the user's words, 2026-10-15; the same on the band, in the Guide's lead and
  at Team's Human check; never "values correct"): "no value disputed on 2,767 of 2,770 entries from the earlier
  version (431 papers)". One sentence, without repeating the base, said as what a check found (never "disputed, yet
  as printed"): "A check of the paper found all 3 disputed values printed as the entry gives them."
  (`value_disputed_checked_as_printed`; "A check of the paper found 1 of the 2 disputed values printed as the entry
  gives it." for part of them) and, with the headline wherever it stands, "In 153 entries (5.5%) the reviewer could not find the value in the
  paper." (`other_by_kind`'s "could not find the value" kind of `entries`). Two facts: Values missing ("27 entries
  (1.0%)") and Other disagreements ("177 entries (6.4%)"), then one note: what values missing means ("the paper
  prints a value the entry lacked, most often the kcat"), then, as its own sentence, how many of the values reviewers
  named CatLog has read from the paper since ("CatLog has since read 53 of the 58 values the reviewers named";
  `agreement.stated_values_catlog_has` of `stated_values`), and the other disagreements by kind, counts in brackets,
  without the kind the sentence above says ("organism name (13), DOI (5), ..."). A review of records read from the
  paper (`review.v2`, once reviewers check them) adds one sentence of the same shape ("Human reviewers checked 40
  records read from the paper (3 papers): no value disputed on 39 of them (97.5%); ..."). CatLog's reading against
  the review is one side line, set off by a rule at its left (the user's sentence, 2026-10-15): "Where CatLog has
  re-read a paper the reviewers checked, its value matches the approved value for 3,903 of 4,441 (87.9%). Of the
  other 538, 279 were checked: 134 are the same value under another name, 142 are values the paper supports as CatLog
  reads them (the earlier entry's number or label was wrong) and 3 differ by rounding; none is a CatLog error. 44
  cannot be compared and 215 are still to check." (never more than was checked; `agreement.agree` of `values_approved`, else `v2_found` of
  `v2_approved_total`: the match as it is now; the other values' kinds from `differ_same_value_other_name`,
  `differ_catlog_right`, `differ_rounding`, `differ_not_comparable` and `differ_not_adjudicated`, said only when each
  is a whole count and they add up, with the wrong values found, to the values that differ; the wrong values found
  from `differ_catlog_wrong`, else `catlog_value_wrong`, else `v2_wrong`; without the kinds only "Of the other 538,
  none has been found to be a CatLog error."). Then links to the Guide's method and to Team; the date the review was counted and
  its definitions (No value disputed, Could not find the value, Values missing, Approved values, The same value) are
  said once, under How these numbers are counted (Human review). kcat, Km and kcat/Km in the lead's text (the big
  number's words, the sentence, the notes) take the site's italic markup with a subscript (metricWordsHtml, on
  escaped text only), as the Values lines and the Guide write them. The first-comparison and blind fields
  (`first_agree*`, `papers_unexposed`, the 95% range) are reference only: never read, never shown; no "first
  comparison", "read blind" or "95% range" anywhere. A snapshot without `review` leads with that match ("of the
  values human reviewers approved are the same where CatLog has re-read the paper (366 papers)") and what reviewers
  found in entries from the earlier version (`compared_values_v1`); one with neither has no lead. Counts that do not
  hold together are not shown.
- Figure 1, Review result: a donut drawn at 200px (outer r 88, inner r 56, 12 o'clock,
  clockwise, thin white gaps, the total in the centre, set smaller when the viewer's font draws it wider than the
  hole; each slice has one fill, its colour at 60% with a 1px opaque outline, so navy and slate stay apart (the
  bars keep their fade); the one partition that is
  a true whole) beside its legend table; pointing at a slice or its row lights both (lit rows tinted --surface-2; Not
  checked's row lights both its slices with their rows, while Unverified or Not reviewed alone leaves it unlit): Accepted (split in the rows under it:
  Read from the paper; Not yet re-read, as printed, after a correction or
  approved by a human reviewer; the split in words is the row's title), Not confirmed, Not checked (Unverified and Not reviewed
  under it), Disputed, each with its definition. The no-paper-linked note and
  the closed table of fields saved in records that are not accepted follow.
- Figure 2, Records by main source: each record once (`main_sources`:
  CatLog's own reading, one database, Several databases, Other for STRENDA DB,
  earlier paper extractions and no source recorded, named in its note),
  stacked by review result (Accepted, Not confirmed, Not checked, Disputed);
  its two number columns are named above them, Records and % accepted (of the bar's own records; a no-break space
  keeps the heading on one line), so Accepted heads only Figure 3's count. Only CatLog's
  own records are linked (no single filter opens a main source). Under it, the
  per-database counts Browse's source filter finds (a merged record counts
  under each, as the Guide's source list), each linked. A snapshot without
  `main_sources` draws the same groups from the source_db counts, unsplit. A Records | Share switch above the bars
  redraws each source as 100% of itself (the accepted share by source, with its own 0-100% axis), eased unless the
  viewer asks for less motion.
- Read from the paper and not yet re-read: two bars stacked by review result (Read from the paper: the main source
  CatLog's own reading; Not yet re-read: every other record, so the two make all records, as its caption says), its
  number columns named Records and % accepted; both names link into Browse (source=paper, source=databases). What each means is said once,
  in How these numbers are counted.
- Values per paper (`overview.from_paper_values`): the papers CatLog has read, by how many kcat, Km and
  printed kcat/Km values it read from each (1, 2-4, 5-9, 10-19, 20-49, 50-99, 100-199, 200-499, 500 or more; a
  calculated kcat/Km is not a value read), its number columns named Papers and % of papers; drawn only when the bins add up to
  the papers CatLog has read. No publication years: the data has none.
- Part 7, Against the databases, reads only the manifest's `summary.database_comparison` (the page never parses a
  value's database line): whole counts, checked to add up (the parameters to `values.all`, the causes to
  `corrections.values`); a figure whose keys are absent or damaged is left out, and the part has no heading without
  figures. The databases, their order and names come from its `sources` list (key, name, display), else from the
  databases its counts name in the Source filter's order and spelling (STRENDA DB), else BRENDA, SABIO-RK, OED, SKiD,
  STRENDA DB and UniProt (the one list Browse, the record and the Guide use too): no number of databases is fixed. A
  database's name never breaks across lines (captions, table headings, the per-database lines), as in the Guide.
  Stats says "A different number can mean a different measurement; it does not by itself mean a database is wrong."
  once, right after the lead's sentence on the values that correct a database's number and differ (under Different
  number only, the user 2026-10-15; alone as the lead when the values' counts for one are missing but a figure
  compares values), never under each figure or in a tooltip; How these numbers are counted says the numbers are
  compared for the same paper and parameter. The same rule everywhere: the caveat once per page and with Different
  number only: Browse's "?" box adds it to that option's definition (never the group's intro), the Guide's results
  add it to that result (its closing note says only that all comparisons are within one paper), and a record says
  it only under its notes when a value has a Different number (its "?" box never: the user, 2026-10-15, "do we need
  to write it every time?"). Units are written concentration first wherever the page shows kcat/Km's unit, "mM⁻¹ s⁻¹"
  (efficiencyUnitOrder turns a stored s^(-1)*mM^(-1) round for unitText and unitHtml; the table's heading, the phone
  card's label, Stats' value ranges and the Guide write it so; the downloads keep the file string). A result's name and definition are Browse's
  option's (DATABASE_RESULT_NAMES, databaseFilters' title), in Stats and the Guide alike. Shares only on a base of 1,000 values, else counts. Colours as Browse
  gives the results: same green, same number under another label --bar-neutral, corrects red, different number brown,
  not in the databases cyan (a database's own not-listed kinds at three cyan strengths; how found at two reds).
  - Lead (14px), one idea per sentence (its papers are `papers_compared`, the papers with a compared value, so never
    more than CatLog has read; `papers` only for an older comparison without it; the Guide's lead names the same
    count, and How these numbers are counted says why it can be one fewer than the papers read: one paper count per
    set, each from one manifest key, the band's and Team's papers read from `from_paper.papers`, Figure S2's values
    from `from_paper_values.values`, never typed): "CatLog compared 126,951 values read from 2,598 papers with what the
    databases list for the same papers. Of these, 97,791 (77.0%) are the number a database lists, and 5,574 are the same
    number under another label. Another 1,353 correct a database's number (656 checked against the paper, 697 by an
    exact factor the paper's own kcat ÷ Km confirms), and 1,461 differ, cause not yet known (246 by an exact factor,
    not yet checked). The remaining 20,987 are in none of the databases. Where a database lists a number for the same
    measurement (100,390 values), 97.4% of those numbers are the paper's. A different number can mean a different
    measurement; it does not by itself mean a database is wrong." Its counts add up to the total; the four result phrases link into Browse (db=other_label, corrects, differs, not_listed), each titled
    with the records it opens ("1,548 values in 1,443 records", from the option's record count).
  - An exact factor alone (found_by factor_only: a database's number is the paper's times a power of ten, 60 or
    3,600 and nothing else was checked) is no correction (the user, 2026-10-15): the value is "Different number
    (exact factor, not yet checked)" and counts under Different number everywhere (comparisonFactorOnly,
    comparisonWordCounts). The comparison counts such values under Different number itself, as a status of their own
    in values.all (differs_factor_only or differs_exact_factor, added into the Differs segment and the differs
    option) or as a count under differs (differs.by_found_by.factor_only, else differs.factor_only); an older
    comparison that counts them among its corrections (corrections.by_cause_found_by[cause].factor_only, else
    corrections.by.factor_only) has them moved in the words (the lead, the Guide's results, the option titles), taken
    out of Figure 8's causes and the All column of Table S11 (its rule says the per-database columns keep them), and a
    note right after the lead says the figures still hold them under Corrects; nothing per parameter or per database
    is guessed. The record says it in the result word, "Different number (exact factor, not yet checked)"; its line gives
    the factor (database_by_source's x under Cause when the line does not).
  - Links never open a wider list than their count: a count, segment or label whose link would name a database
    (dbsrc), a cause (dbwhy) or a compared parameter (dbpar) links only once Browse matches that key
    (DATABASE_REFINE_KEYS, the record's rule too); until then it is a plain number and only the db= links stay.
  - Values against the databases: 100% bars kcat, Km, printed kcat/Km and All values (same, same other label,
    corrects, differs, not listed); the counts of corrects and differs beside each bar (with dbpar, see above), each
    after its swatch in a right-aligned column under its heading, Corrects and Differs (Table S10's names; each column as
    wide as its widest count or heading plus the swatch, a sizer as in Figure 3, fitted to the heading line once drawn);
    shares under the bars; a segment with a filter opens Browse when clicked; its rule (How these numbers are
    counted): calculated kcat/Km not compared; a note under the figure (a result, so beside it): the numbers the databases list that CatLog does not have (`not_reproduced.distinct`), with those CatLog has as a
    kcat/Km it calculated or under another parameter named apart; "the README gives the reasons" only when the snapshot
    has its comparison download (`database_comparison_download`), whose build writes the README's section on it; that
    file is also the Download menu's and the Guide's Downloads' "Against the databases" item (one row per value and
    database, CSV; rows and size from the manifest, saved as catlog-<date>-database-comparison.csv.gz), hidden
    without it.
  - Results by database (`values_by_database`): a 100% bar per database, the
    values from papers it lists beside it under the heading Values, "+ N values from papers X does not list" under it, never in it. Its own
    not-listed kinds in the database's words (Lists other values only, Lists none of this parameter, Value in no
    database), never the Why not listed labels, which say what all the databases list. A database that lists none of
    the papers read is named in a note under the figure and under Corrections by cause and database ("UniProt lists
    none of these papers."), so a missing bar or column is explained where it is missing, with no
    empty bar and no column in
    Corrections by cause and database. Beside it,
    the table Paired values by database (paired: the database lists a number for the same measurement): Paired, Same (share), Corrects, Differs per
    database and "All, each value once" (`values.all`); below 400px the paired count goes under the name. Per
    database only Corrects links (bar, legend, table): a database's Different number also counts its other number for a
    value whose own result is Same or Corrects, and its Same, other label a value whose own result is Same, so Browse,
    which matches a value by its own result, would show fewer; the All row's Differs links (one result).
  - Corrections by cause and how found ("Corrections by cause" without the split; its caption: "The 1,353 values
    that correct a database's number, each counted once.", as Table S11 counts one per database): a bar per cause family (Unit or scale, Decimal slip, Another number, Unit
    misprinted; DATABASE_CAUSE_FAMILIES, the Guide's list too, maps every cause code), split checked against the paper / an exact factor found by
    code (the paper's own kcat ÷ Km agreeing) from `corrections.by` when the causes code finds (power of ten, 60 or 3,600, printed number in another unit)
    add up to its code count, an older comparison's factor-only values taken out of both; a bar split two ways prints its two counts under its name, each after its colour. Beside
    it Corrections by cause and database (`by_cause_database`), non-zero cells
    linking to db=corrects&dbsrc&dbwhy (see above); a line per database on phones, or wherever the table does not fit
    its column.
  - Corrections on records not yet re-read: `overview.earlier_corrections`, counted by the overview builder from the
    Full data's corrections lists (kcat, Km, kcat/Km by kind: more digits or rounding, a different number, unit or
    magnitude, added; other changes counted apart; how many values before the change a database lists), its records
    linking to db=earlier; without it, the CatLog side's `overview.quality.earlier_corrections` (another snapshot's
    count names both record counts). Entries replaced by reading the paper (`overview.quality.replaced`) as before.
- Checks on the values (cards, after the lead): second AI check (records read from the paper),
  AI audits, the human review of the earlier version's entries (entries and papers; values
  correct, values missing and other disagreements as shares; a snapshot without
  `review` gives every value reviewers compared, approved or not, the share
  correct always beside the label errors), the reviewers' approved values read
  from the paper again (the same value now, wrong CatLog values found) and human-checked
  records (with human-checked's rule and the records of this snapshot that have a
  human reviewer's verdict, approved or not: `human_marked`, records, not the
  review's entries); a row whose numbers are missing is left out. Metric words in
  its result lines are in italics, as in the lead. Each card with a share (kept of the values audited; human-checked
  of the records with a reviewer's verdict) has a
  thin accent bar for it; the second AI check covers every value, so it has none (no completion bar).
- Enzyme classes (no class colour: its bars wear review-result and Read from the paper colours, so a class colour
  beside them would mean a second thing; the class colours are keyed in Values by enzyme class and kcat against Km):
  records bars (light) with the accepted drawn over them and the records read from the paper as a
  stripe of Read from the paper's colour (--src-paper) inside the accepted bar, set off from its fill by a 1px white gap above and below, so it
  parts from it by more than lightness, in grey print too (`ec_classes[].from_paper`; the legend's swatch is an
  accepted swatch with the stripe through it, named Read from the paper); a nonzero accepted or read-from-the-paper
  count draws at least 2px wide; each label gives records, accepted, then read from the paper (--src-paper), each
  number in its own right-aligned column under a 12px muted heading line (Records, Accepted, From paper: the legend's
  order, the last in the short tag), every column as wide as its heading or widest entry; once drawn, the value column takes exactly the width of
  that heading line. On phones, as in every bar chart, its bars and axis span the row: the class name and its numbers
  share the first line, under the headings, 8px apart, and a long class name hyphenates. Below 360px From paper takes
  one word per line (From / paper, the headings standing on their last line) and its column is only as wide as its
  longest word or count (data-sizer-narrow; the columns are fitted again when the width crosses 360px), so the class
  names keep their room and stay whole at 320px; only a name wider than the whole label column (Oxidoreductases in
  DejaVu Sans at 320px, as before round 8) may still break.
- Value ranges (full width): per metric in catalog units (kcat s⁻¹, Km mM,
  kcat/Km mM⁻¹ s⁻¹) the median, the 10–90% range and a histogram per power of
  ten whose end bars hold every value beyond them, drawn on the log axis it shares with Values by enzyme class (the
  whole decades around that parameter's class grid; bars beyond it join the end bars) in the class panels' columns
  (their label, median and n columns left blank beside it), so a reader can run an eye down from the whole
  distribution to the classes and 10⁰ stands at one x in all of Part 5; without a class grid, or when the histogram
  does not reach that far, each keeps its own axis; values without a recorded
  unit or in another unit are left out; the median (here, in Values by enzyme class, in every tooltip line and in
  the figures' accessible text) and the 10–90% bounds have two significant figures. Value ranges is single-series and
  uses --bar-neutral (the panels' own headings name the parameter); Values by enzyme class draws each class in its
  class colour (below). The light fills carry nothing on
  their own: the bars' 1px outline and the ridge lines, which give the shapes, are drawn darker than the colour (75% of
  it with --text, 5.3:1 against the page), as the 10–90% line and the median dot are.
- Values by enzyme class (full width, small multiples): per parameter a ridgeline panel, one ridge per EC class
  drawn through its half-decade bins (`overview.metrics.<metric>.by_class`: one grid of 14-18 bins per parameter
  shared by every class, the end bins holding every value beyond them; a record in several classes counts in
  each), each in its class's colour (--ec-N on the row, its fill from its own gradient, the short class bar before
  EC N), each scaled to its own peak (shapes compare whatever the class's size) with a smooth curve that never
  overshoots its bins. The open-ended end bins are not in the curve (a pile there is not a peak in the data): the
  curve covers the inner bins, cut off level at an end with values beyond it (falling to the baseline where there are
  none), and each end bin with values gets a 6px hatched stub of fixed height, its count in the tooltip line and the
  row's summary. A fill from the parameter's colour to its tint, the 10–90% range as a line on the baseline
  with the median as a dot, the median at the right to two significant figures and the class's number of values
  after it (a muted n column sized in ch to its longest count), a class with fewer than 300 values drawn lighter
  (fill at 45%) with a dashed outline so it does not look as solid as a big one (the caption's second sentence names
  the marks shown: "A hatched stub at either end marks the values beyond the curve; a lighter, dashed curve has fewer
  than 300 values."; Value ranges' caption says its end bars hold every value beyond them), a shared log axis per panel, the one Value ranges uses (a tick per decade, labelled at the even powers when there are more than 7 ticks, so
  10⁰ is always labelled; every second label thins out when narrow, the power of ten with it). EC N links into Browse with the panel's parameter (the
  class's records with it in any unit, so Browse can count more than n; the tooltip line says so); the class name stands beside it only where a panel has the
  row to itself (641-1023px); three panels side by side, phones and paper show the class number alone.
- What the values show (`overview.from_paper_insights`, counted by `build_overview` from the Full data's records read
  from the paper only, about 6 KB; each figure only when its counts hold together, so an older snapshot shows none):
  - kcat against Km (`kcat_km`): a density map of the records read from the paper with both a kcat and a Km in
    catalog units, on a grid of quarter decades whose axes are the whole decades around the middle 99% of each value
    (the outer rows and columns hold every value beyond), drawn with decades of one size, so a line of equal kcat/Km
    runs at 45° (the plot keeps the grid's shape by aspect-ratio). Grey cells, darker for more records (opacity
    0.08-0.92 on the log of the count, bent by 1.6 so the crowded core stands out), each cell's range and count in its
    tooltip line; thin lines of equal kcat/Km every hundredfold, labelled in M⁻¹ s⁻¹ where they leave the plot (top,
    else right; "10" and a 12px `<sup>` exponent, as the axis ticks are, one exponent style per figure), the unit the diffusion limit is known in, so no label reads as the limit in another unit; the
    diffusion limit, 10⁸–10⁹ M⁻¹ s⁻¹ (10⁵–10⁶ mM⁻¹ s⁻¹), as a light tan band with dashed darker-tan edges and
    "diffusion limit" along it (tan, the caution's colour: a value far beyond it, above 10¹⁰ M⁻¹ s⁻¹, carries the
    above-diffusion-limit caution, and the facts beside the map say "(the caution marks those above 10¹⁰)"; the
    caution, its filter's title and the Guide give that limit, never "the diffusion limit" alone); each enzyme class's median kcat
    and median Km as a 16px dot in its class colour with its class number in it (ink, white on navy and brown), ringed white, the smaller classes on top; dots that would cover each other at the plot's size (EC 2 and EC 6 stand a tenth of a decade apart) are pushed apart until 20px separate their centres, each moved one with a 1px line and a 5px dot of its colour back at its own place (statsPlaceMapDots, again when the plot changes size). A legend above (records per cell 1 to the largest,
    equal kcat/Km, the limit, a class median with a dot of all seven colours). Beside the map (under it below 1024px):
    Records (linked to source=paper&metric=kcat,km only when `linked`, the records Browse finds with both values in any
    unit, is the same number), the median kcat ÷ Km in mM⁻¹ s⁻¹ with M⁻¹ s⁻¹ under it, the records at the diffusion
    limit or above (10⁸, and how many at 10⁹), then a table of the class medians (Enzyme class, kcat, Km, Records;
    each class linked to ec=N.&source=paper&metric=kcat,km): a row lights its dot and the dot its row, the other dots
    dimmed; on phones the table gives the class number alone (the names are in the supplement's Organisms, enzymes and variants and the dots' tooltip lines),
    so its numbers keep their columns at 320px in DejaVu Sans. The plot is an image with its summary in aria-label.
  - Variants against their wild type (`mutations`): each variant record read from the paper (a variant has one per
    substrate and condition) paired with the one wild-type record its paper gives for the same enzyme, organism,
    substrate, cosubstrate (a "cosubstrate <name>" part of the record's conditions; a cofactor-switch paper's NADP+
    variant never pairs with its NAD+ wild type), pH and temperature (a paper with several such wild-type records, or
    none, leaves its variant record unpaired: an ambiguous pairing is never made; the counts left out are said in the
    figure's rules). Every count says "variant records"; the rules add the variants among them (`variant_count`:
    paper, enzyme, organism and mutation), "17,115 variant records (7,496 variants) from 1,236 papers", and the
    caption that the variants are those the papers chose to make, often at catalytic residues, so the spread describes
    studied mutations, not mutations in general; per parameter (kcat, Km, kcat/Km) a histogram of log10(variant ÷ wild type) in
    quarter-decade bars centred on whole quarters from 10⁻⁴ to 10³ (the bar at 1 holds changes under 1.33-fold either
    way; the end bars hold every change beyond), drawn like Value ranges (--bar-neutral) with a dashed line on the wild
    type's own bar and "wild type" above the bars; Median (×), Lower and Higher above each, the variant records and the
    shares at a tenth or less and at ten times or more under it. A link to the variants read from the paper in Browse
    (source=paper&variant=variant) under the figure.
  - Assay temperature and pH (`conditions`): the records read from the paper by the temperature and pH their paper
    gives, a bar per 1 °C from 0 to 100 °C and per 0.1 from pH 2 to 12 (the first bar holds every value below it, the
    last every value at its edge and above), solid narrow bars with 1px gaps (75% of --bar-neutral with --text, at
    least 3:1); each bar with records opens them in Browse when clicked (source=paper with tmin/tmax or phmin/phmax:
    the bin's lower edge to the next edge less one step of the most decimals any value has, `decimals`, so the range
    opens exactly that bar's records; no links when a value has more than 3 decimals; the tooltip line gives the range
    when the values have decimals, "37 °C (37–37.9 °C)"), and Most common gives the three largest bars as links with
    their shares, for the keyboard. Its axes have their own class (stats-condition-axis), since their labels are not
    powers of ten. Axes 0-100 °C (every 10, labelled every 20) and pH 2-12
    (every 1, labelled every 2).
- Against the databases by enzyme class (`from_paper_insights.database_by_class`, part 7, after Values against the
  databases, only with the comparison): a 100% bar per class of the values read from the paper by each value's own
  result (its proof line's database_status, as part 7's figures count them: a correction found by an exact factor alone
  stands under Corrects where this snapshot's figures keep it there), in part 7's colours and legend; the class
  (EC N and its name) links to ec=N.&source=paper; its Values column names the compared values; shares in the tooltip
  lines on 1,000 values or more. The class colour stays off this figure: its segments carry the results' colours.
- Tables (all in the supplement since round 14): Most common organisms and Most common EC numbers (top 10, the EC
  with the enzyme name its records use most, no class colour; bars against
  the largest), then Most common organisms and Most common
  EC numbers among records read from the paper (counts "Records", shares of the records read from the paper, bars in
  Read from the paper's colour, linked with source=paper),
  What the records contain, Wild type and variants, Cautions.

Wording (the user, 2026-10-15: "the figures have some weird ai ish wording right?"): titles are short noun phrases;
a caption is one short plain sentence (round 14: "so verbose"; a semicolon may join the marks it names) that says what the title does not (how the figure is drawn, what a share
is of), one idea per sentence, no stacked semicolons, never "in all", and no filler about where the numbers stand: a
chart whose numbers need naming names its columns above them (Records / % accepted, Papers / % of papers, Figure 3's
Records / Accepted / From paper): a share column says what it is out of. Before -> after: "Records by main source, coloured by review result; each label gives
the records, then the share accepted." -> "Each record counts once, under the source it came from, coloured by review
result."; "The 3,104 papers CatLog has read, by how many kcat, Km and kcat/Km values CatLog read from each; each label
gives the papers, then their share." -> "The 3,104 papers CatLog has read, by the number of kcat, Km and kcat/Km values
read from each."; "For each database, how it lists the values read from the papers it lists (the number beside its
bar); ..." -> "Each bar covers only the values from papers that database lists. A value counts for every database
that lists its paper." (a value counts for several databases because several list its paper, not because of the bar).
Round 8's binding words stay as they are (the human review's headline and side line, "among records read from the
paper").

Figure style (the user: "some SOTA plots maybe - yeah Nature BPG colour palette"; round 14: no glow): every figure
and table has a heading (16px; the parts' headings are 20px), the plot, then
"Figure N." or "Table N." (numbered in reading order, figures and tables
apart, so without figures 3-5 the next figure is 3) with a short caption (13px), its accessible description; no data
line (the snapshot, Data ID and rules are said once, at the end). Bars 16px thick, 8px apart, their outer ends rounded 2px; one flat fill, the colour at 60% (#RRGGBB99
on white), with a 1px opaque outline (a darker ring where the colour is light: cyan, mint, salmon, tan); legends inline above the plot with 10px
swatches in segment order (a name that wraps keeps its count right after it);
one shared scale per chart with axis ticks of
three to five whole steps (1, 2, 2.5, 3 or 5 × 10ⁿ), each label centred on
its tick, the end one too, so they sit evenly (where labels would touch they thin evenly: a narrow axis keeps every
other one of six ticks, 0, 2 and 4 steps, 0, the middle and the end of five, and only the ends of four under 24ch, in
the labels' own font, so labels never touch, also in a wider font; on phones, where the end label ends at its tick, they
thin sooner: six ticks under 56ch, five under 45ch, four under 34ch); light 1px gridlines at the
ticks shown, a gridline giving way with its label, so none is unlabelled. Category labels 13px, value labels and ticks
12px, tabular numbers; a chart's value column fits its longest label (sized in ch, so a wider font widens it). A
label of several numbers (the count, then the share; Figure 3's records, accepted and read from the paper) sets each
number in its own right-aligned column 6px apart, every column after the first as wide as its widest entry in the
chart (a hidden sizer holds the entries' shapes, digits as 0, one per line, measured in the viewer's own font at 600,
the boldest weight in a value column), so the counts line up whatever the shares.
Pointing at a mark, or focusing the link in its row, gives it a 2px outline in its own colour (a slice a 2px
stroke, a ridge a thicker line, a class median a wider ring; never a glow), dims the other marks of its figure (bars, slices, ridges; their names and counts keep full ink, so
their contrast holds) and shows its exact count in a dark tooltip line; touch shows it on a
tap. Scrolling hides a line the pointer showed (the pointer brings it back), while a line keyboard focus showed
follows its mark as long as the mark is in view, so Tab to a mark below the fold, which scrolls the page, keeps it.
Escape puts the line and the light out without moving the pointer or focus (WCAG 1.4.13); they stay out on that mark
until the pointer or focus moves on.
Nothing eases when the viewer asks for less motion. Table rows 13px with an 80px bar (48px on phones); the counts
right-aligned under their headings. Colours are tokens: review results
(--st-accepted navy, --st-pending salmon with its ring, --st-unverified and
--st-not-reviewed slate, one colour for Not checked, --st-disputed deep red), the database comparison
(--cmp-same green, --cmp-other mint, --chg-magnitude red, --cmp-differs brown, --cmp-new cyan) with the kinds of
change on records not yet re-read (--chg-precision mint, --cmp-differs brown, --chg-magnitude red, --cmp-new cyan),
Read from the paper's cyan (--src-paper) for every figure, bar and count of records read from the paper (Values per
paper, Enzyme classes' stripe and From paper counts, the from-paper tables, variants against their wild type, assay
temperature and pH, the Checks meters of the AI checks), --bar-neutral for single-series bars and table bars of all
records (Table 1 included), tan only for cautions (the Cautions table's bars, the diffusion-limit band), and the
enzyme classes' colours (--ec-1 to --ec-7: BPG red, cyan, green, navy, salmon, slate and brown;
mint is too light for a line; the user, 2026-10-18, "include some more palette colors") only where a figure draws the
classes apart (Values by enzyme class, kcat against Km) and as a 3px bar before a class's number (Enzyme classes,
those figures' labels), always beside the class's number, so colour is never all that tells two classes apart. No gauges, completion bars or confidence scores; the review-result
donut is the only ring; nothing glows (round 14): the headline band's key numbers and the lead figure of Quality stand
on plain white, the part numbers are plain muted figures, the meters flat bars in their check's colour (CatLog's AI
checks cyan, human-checked green), the median dots, the ridges and the pressed switch button have plain 1px outlines,
and the read-from-the-paper stripe never takes the pointer's outline (its accepted bar does). The ridges fill flat
(40%, no fade). Markup (a deliberate change from the design spec's
inline SVG with role="img" for every figure): the donut is an SVG image
(role="img", its summary in aria-label, a title per part), each value-range
histogram and each class ridge an image with its summary in aria-label; bar charts and table bars
are HTML in a `<figure>`, so their names stay links into Browse that a keyboard
reaches and every count is text a screen reader reads row by row and a viewer
can copy. A name with a breakdown under it (Figure 2's Other) has its bar and numbers on the name's line, not
centred on the breakdown. On phones each name sits above its bar with its numbers right-aligned on the name's line (the
first line of a name with a breakdown), and the bar and axis span the row (the end tick's label ends at its tick), so
bars take the full width and small segments stay visible. `@media
print`: one column across the page's full width at 80% scale (a landscape
page holds the title, the lead and the headline counts, and most pages two
figures or tables), no figure or headline count split across pages (the lead
alone may go on between its parts; the three value-range histograms stay side
by side on any paper size, so their caption stays with them, and the three ridgeline panels too); bars, swatches
and columns print in their colours even with the browser's background graphics off; no tooltip or switch on
paper.

Review result lists each record once, in the words Browse uses: Accepted (the
rows under it split it into the records read from the paper by CatLog and
those not yet re-read, as printed, after a correction or on a human reviewer's
approval), Not confirmed, Not checked (the
group Browse filters on, with Unverified and Not reviewed under it), then
Disputed. An unfamiliar status is listed, not dropped. Keep the no-paper-linked caveat visible. The
fields saved in records that are not accepted (hash-bound `review_details`)
sit in a closed table; never imply that a missing field explains a status or
that the unaccepted records measure work remaining.

Every name Browse can filter on links to `catlog-latest.html#browse?` with the
shared keys (status, checked, ec, organism, metric, variant, caution, source);
a portable copy links within itself. Items with no single Browse filter
(Unverified alone, Not reviewed alone, Not stated, other sources, sequence,
temperature, pH, the main sources other than CatLog's own reading) stay plain
text. The per-database list under figure 2 gives the records read from the
paper by CatLog (linked as #browse?source=paper, which opens exactly them) apart
from the earlier paper extractions (#browse?source=earlier_paper), then each
database. Counting rules shared with the page: human-checked is an accepted
record whose mark is checked (looked up as the badge does): a reviewer approved
every kcat and Km it shows and its kcat/Km was approved too or agrees with kcat ÷ Km
(the user, 2026-10-13; no whole-row rule); papers are
distinct PMIDs, else DOIs, else a stand-in id; names are distinct ignoring
capitals, without "Unknown"; EC numbers are complete four-part numbers; a
record naming EC numbers in two classes counts in each class (said in a note);
wild type and variant follow the table's enzyme-form rule; cautions follow the
record's own flags (a kcat/Km that agrees with kcat ÷ Km within its printed
precision is not "differs"). A linked count is the number of records its link
opens: an organism counts every record whose organism name contains it, as the
Browse organism filter matches (strains with their species; names whose results
overlap, such as "human" and Homo sapiens, are listed once), and a record merged
from several databases counts under each source (so sources add up to more than
all records, and match the Guide's source list). Stats and the filters use the
same names for cautions and sources.

Use white, unframed sections with light rules, in one centred column at most
1200px wide (32px 24px padding; the lead alone sits in a light box). Use normal page
scrolling; never an independently scrolling chart panel. Search belongs to
Browse, not Stats, Guide or Team. Keep Browse's filtered state when navigating away
and back. Do not publish project token statistics on this page.

Navigation order is Browse, Stats, Guide, Team, then, set apart by a thin rule,
the links out "CatRange paper ↗" and "Chowdhury Lab ↗". Browse, Guide, Stats and
Team are real links; normal clicks retain the loaded table, while
modified clicks and copying work normally. Strip only deployment-check query
tags from shared navigation. Stats uses catlog-stats.html; Browse keeps
catlog-latest.html. Old #stats bookmarks and portable export hashes still work.
The Guide is short and plain (the user, 2026-10-18 and 2026-10-20: "still so
verbose, AI-ish, confusing"): a newcomer learns in about a minute what CatLog is,
how to read a record and what each label means. Pictures only where they are
simpler than words (four steps Read, Check, Compare, Review; a numbered record;
one legend of labels and colours), each section opening with its answer in at most
three short sentences, no meta sentences or AI tells, no icons, boxes or tinted
washes, reference in disclosures (tools/catlog-static/DESIGN.md, Guide).

## Team

Team (#team, in catlog-latest.html like the Guide; its own view, never the
record index) is "People behind CatLog": one plain line, then the loop the
user approved. The words say what CatLog is (the user, 2026-10-18: "we are in the verification scientific progress,
not sending AI to get paper business"): CatLog re-verifies published enzyme kinetics; its agents find the paper each
database value cites, read the values in it and check each one against the paper; people review samples. The line
(round 14, shorter): "CatLog re-verifies published enzyme kinetics. AI agents read the papers that enzyme databases
cite and check each value against the paper. People review samples; what they find improves the rules. So far 61,919
of 178,676 records are re-read." (the last sentence from the manifest, renderRereadLines: never "each database value"
as if every one were done). The caption starts "The loop runs clockwise from cited papers." The method says "automated checks" and "found
automatically", never "code", as the README does. No agent is a
"download" agent and nothing says papers are fetched or collected (the Guide alone says, where needed, that papers come
through the library's licensed and open-access routes). The loop: a racetrack of stations Cited papers (key papers), AI
reading, AI check, AI audit (2026-10-15: "CatLog" named the whole site as a step of its own loop; the
station's key stays catlog), Human check, Rules updated and back to Cited papers
(clockwise, small arrows), with Website and The paper branching off AI audit and AI critique (key critique; round 14,
the user 2026-10-20) feeding Rules updated. Each branch is a dashed line with a chevron the way it flows: halfway out to
Website and The paper, two fifths of the way from AI critique towards Rules updated.
AI agents stand above their stations (Source agents at Cited papers, "find the paper each database value cites";
Reading agents at AI reading, "read each value in the paper"; Verification agents at AI check, "check each value
against the paper, separately"; rectangles in CatLog's reading colour, BPG cyan: a 12% tint and the 3:1 ring #2DA1BD, round 14), Audit agents ("re-check samples") right of AI audit
between its two branches, their line level with it; people below
(Vaishnavey at AI critique, "examines the AI agents' readings for systematic errors; the findings feed the rules", the
only thing the site says AI critique is: never a pronoun, a title or more than that sentence; Supantha at Rules updated,
also lighting Cited papers, AI audit and Website, "builds CatLog and its website, and turns findings into better rules";
Aarna and Erin at Human check; Mohammad at The paper; grey pills). AI critique stands in the wide loop's lower-left
corner the user pointed at (the screenshot's empty space), outside the track: its name left of its dot, Vaishnavey's
chip under the dot in the people's row (left of Supantha), its dashed line rising to Rules updated clear of the arc;
the wide viewBox starts at x 90 (was 130) for it, and the wide drawing's max-width is 1004px (was 960) so its type keeps
its size. On the upright loop, whose 288 units leave no room outside the track, AI critique stands inside it, right of
Rules updated, whose name stands a little above its dot so the dashed line passes under it. Supantha stands
a second time above Website (he built and maintains the website; the user, 2026-10-18: "website making should have my
name"), as Mohammad stands below The paper: a second chip with its own line, lit with the first and with no tab stop
or name of its own (aria-hidden: the first chip names every station). First names only: no titles, ranks, model or
vendor names; individual review decisions stay anonymous. Live numbers at the
stations come from the manifest (none at AI critique; papers read and records at AI reading,
values re-checked at AI audit, the human review's headline and
human-checked records at Human check, records at Website), each left out when
its field is absent. Human check says the Stats lead's headline shortened, never
a bare "agreement": "no value disputed on 2,767 of 2,770 entries" over "(99.9%) from the earlier version"
("no value disputed on" over "2,767 of 2,770 entries" over "(99.9%) from the" over "earlier version" on the upright
loop), its label one phrase; without the review's counts, "87.9% of approved values the same"
over "where CatLog has re-read the paper" (four lines on the upright loop). No station's
name and numbers come within 12px of another station's,
the track, or the chips and their lines, also in a wider font (Linux Chrome): on
the wide loop AI audit's stand up and left of its dot, clear of the arc, Rules
updated sits near the lower straight's left end and Human check right of its
middle, so Human check's lines start well below CatLog's and its last line is
far from Rules updated's name; on the upright loop AI check stands higher than
Human check, Human check's lines end on the straight part well above CatLog's
name, and a drawn line longer than 23 characters (16 for CatLog's, in the lower
arc) breaks at a space. Nothing moves round the track (round 14: six accent dots
circling it endlessly were the last landing-page touch; the chevrons show which way it runs). Mohammad stands on the
people's row (y 438), with Vaishnavey, Supantha, Aarna and Erin. Its text is on the type scale (station names 16,
numbers 13, chips 14; upright 14 and 12) and the caption 13px like Stats'; the
chips leave the status navy and the comparison brown to their own meanings, and
a focused chip gets a 2px accent ring set apart from it. Pointing at a person or
agent, on the figure or in the legend under it (People and AI agents, one
plain phrase each and where they work, in the loop's order; an agent's line has no "(AI)", which its heading says, while
its chip's name on the figure keeps it), or focusing a chip, lights their stations and fades the
rest. Each legend line starts with a filled 10px swatch in its chip's outline colour, as Stats' legends are drawn (a
grey dot for a person, a cyan square (60% fill, the 3:1 ring) for an agent; hollow marks read as unticked radio buttons and checkboxes) and is a toggle button (aria-pressed, named by its phrase,
where they work as its description): a click, tap, Enter or
Space keeps its stations lit until it or another line is pressed, so touch
screens can light them too. The drawing is named by aria-label, not a <title>
(a tooltip over the whole figure), and a station's label reads a number wrapped
onto two lines as one phrase. Below 960px the loop stands upright (the people and agents are in the
legend beside it, under it on phones; its viewBox is cut to the drawing, 320px
wide at most) so its labels stay 12px or more down to a 320px phone; its caption then says "The list says where each
person and agent works.", instead of asking to point at people the drawing does not show. Printed, the wide loop with its people and agents stays whole on one
page and the legend follows in two columns. The Guide's method section links
to it.

Not reviewed is the label for the legacy mathematically_inferred record status
(labelled Pre-review until October 2026): the importer also used it for
source-derived records. Do not describe every value in that group as
calculated. A calculated ratio field is separate from record acceptance;
changing these labels must not alter the scientific data.

## Record

A record is a curated entry, not a log (round 13, the user 2026-10-18: "reads a lot of AI inside jargon and repetitive
words for all entries"). Each section says only what is specific to this record: the values with the cell as printed
and where it is printed ("In the paper:" before a quoted line), how they compare with the databases, how far they were
checked (Checks: the second AI check, an AI audit, a human review), then conditions, protein and substrate, and the
paper. What is the same on every record (how CatLog reads, checks and converts a value) is the Guide's, linked once
under Checks ("How CatLog reads a value →", #guide-how-read); the license and the snapshot are one footnote under the
record's buttons; nothing the header says (form, "from paper") is repeated in a section
(tools/catlog-static/DESIGN.md, Record Details). Its name wraps between its parts only (at a space or after a hyphen or
slash), a short locant ("4-", "1,2-") kept with the part after it, and on a phone it takes the panel's width under
‹ › × after its first lines (round 14).
