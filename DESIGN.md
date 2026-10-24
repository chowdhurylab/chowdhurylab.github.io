# CatLog Public UI

Browse is the working table. Keep its header, search, compact counts, filters,
record drawer and downloads intact. Stats is a separate page, not a drawer or
expanding summary that takes space from the table. The filter sidebar shows in view only
the filters most visitors use (Enzyme, organism, substrate; Parameter; Review result
with human-checked), each option one short line with its count, and folds the
specialist groups (Source, first since round 14; Wild type or variant, Assay conditions, Compared with databases,
Cautions, Source database) under one "More filters", which opens by itself when one of them is set
and counts them on its title; help text sits behind each group's "?", never in view; no
option, address or chip changed (the user, 2026-10-18). Browse's active-filter chips
are plain since round 14 (a 1px hairline on white, no stripe or tint): the colour is on the option's own words or mark,
in its meaning colour (a review result's word and Read from the paper's words in their colours' text shades since round
17, human-checked's tick, a database result's square, a caution's "!"), and the filters with no meaning colour have no
mark; and Undo,
first in the bar (it keeps its place, dimmed with nothing to undo), restores the filter set before the last change,
Clear all too
(tools/catlog-static/DESIGN.md, Filters).

Every column header sorts the table (round 17, the user: "like Excel"): a first click its natural way (names A to Z, EC
1 to 7, values high to low, Review result accepted first), a second click the other way, records without the value last
both ways; the sorted column alone shows a quiet arrow and aria-sort. No Sort menu from 641px; phone cards, which have
no headers, keep a compact "Sort ↑" toggle and a column menu (tools/catlog-static/DESIGN.md, Layout).

## Words

Round 17 (the user, 2026-10-23: "how are they going to know the values and records and entries and measurements? It's
confusing"). Two counting words only, everywhere a visitor or reviewer reads: Browse, the record, Stats, the Guide, the
README, the downloads and the help texts, and the sentences catlog-v2 writes into the site bundle and the README
(tools/site_release.py, tools/human_review.py). Code names stay as they are (measurement_key, measurement_id, the
manifest's entries, entries_without_paper, v2_measurements ...); only visible words follow this table.

| Word | What it means | Defined for a visitor | Never on the site for it |
| --- | --- | --- | --- |
| value | One number: a kcat, a Km or a kcat/Km. | Guide, Records and values (#guide-words) | measurement, data point, item |
| record | One row of Browse: one enzyme (wild type or a variant) with one substrate under one set of assay conditions in one paper, and its values (up to three). Inside the code this is a "measurement". | Browse's counts band "?", the Guide's first section, Stats' first box | measurement(s), entry/entries, row(s) as a count, slot, item |
| paper | One publication. | Guide, Records and values | article, reference (as a count) |
| parameter | kcat, Km or kcat/Km as a kind of value; the filter group is "Parameter". | Guide, Records and values (the Value line) | measurement type |
| records people checked (reviewed records) | The human review's "entries": records of CatLog's earlier version as the reviewers saw them. | Stats, Quality | entries, entries reviewed |
| the enzyme databases, database listings | What BRENDA, SABIO-RK, OED, SKiD, STRENDA DB and UniProt list. | Guide, Compared with databases | database entries |

Labels that keep their words: the review results Accepted, Not confirmed, Not checked and Disputed; the sources Read from
the paper and Not yet re-read (tags "from paper" and "not re-read"); the tag human-checked; Compared with databases' five
results. A UniProt entry is UniProt's own word and stays. Where two counts differ (records people checked and records with
the human-checked tag; values and records), the page says why in a few words, from data only. Each counting word is
defined once where a visitor first meets it, not again and again. A file's lines may be called lines ("one line per value
and database"); a count of records is never "rows". Visible spelling is American: license (the user's word, the field
source_license and the README), color.

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
   paper with its papers, Human review, earlier version ("99.9%", "no value disputed, 2,601 of 2,604", the sentence in
   full its title; round 17 fix pass: the label names the scope, the records of CatLog's earlier version people checked,
   so the share never reads as the current records' accuracy; round 14 states the review's share here only; an older
   snapshot without the counts over the records with a paper keeps the not-found records beside it, as the user asked on
   2026-10-15; a snapshot without the review's counts gives, as "Human review", the share of approved values the same
   where CatLog has re-read the paper), the numbers in the colours Browse's counts band gives them (Records ink, Accepted navy, Read from
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
   each label over its number and each number in its meaning's colour (Records ink, Accepted navy, Read from the paper
   the darker BPG cyan, Human-checked the darker BPG green with its tick; round 17 took the dot and the square off the
   labels), no text-shadow; a linked
   count tints in its colour around itself without moving anything. Round 15: one even row across the card, type set in
   columns (one thin rule, before the parameters; none between the key numbers), each number over one 12px muted line
   of context, a fact from the snapshot or the results: Records "41,218 papers", Accepted "43.5% of records", Read from
   the paper "40.4% of records · 4,324 papers", Human-checked "2.1% of accepted" (shares never a rounded 100.0% or 0.0%;
   a filtered view names its papers only when the page counts them as the snapshot does). The parameters (kcat, Km,
   kcat/Km) are secondary: each label over a 16px count, 500 in --text-2, "records with each parameter" under them. The
   line over the card says what CatLog is, without the band's numbers, and ends with the snapshot date (in the card
   where that line has no room). One row from 1024px up, two rows on tablets, two by two on phones
   (tools/catlog-static/DESIGN.md, Layout). Nothing moves, as the window widens or the filters change.
   Round 17: the band ends with the counting words, defined once where Stats first uses them, in one 12px muted line
   ("Record: one enzyme or variant, one substrate, one set of assay conditions, one paper. Value: one kcat, Km or
   kcat/Km, up to three per record."); the line under the title is "Select a name to see its records in Browse."
2. Quality (round 17, the user: "after the first box it should be the quality thing, with figures to understand it, not
   all those tables"): three numbered figures, no table, the review's share At a glance's alone.
   - Human review: a unit chart, one 5px square per record people checked on a 6px pitch, 100 to a row (50 on phones, a
     second drawing; statsUnitGridSvg), so 3 disputed among 2,604 show: CatLog's earlier version's records with no
     value disputed (human-checked's green at 60%), with a value disputed (Disputed's deep red, opaque as its dot), then
     a blank row and the records with no PMID or DOI as open squares in Not checked's slate; a key beside the squares
     from 1024px (under them below) gives the counts in words and what a check of the paper found of the disputed values.
     Under it, at the same size, the records read from the paper people checked (drawn at random, then a row of those
     picked as hard cases) with their values none disputed; then one line on the records in Browse with the
     human-checked tag and why they are fewer ("of the 2,131 records with a reviewer’s verdict in Browse, those accepted
     with every kcat and Km approved and the kcat/Km approved or agreeing with kcat ÷ Km": the tag's rule, never "every
     value").
   - Checks on the values: two panels. The second AI check as one 100% bar of every value read from the paper,
     confirmed (Read from the paper's cyan) and corrected (a correction's opaque red), each count and share under its
     end; the random AI audit as its share removed as wrong on a small axis (0 to 0.5, 1, 2 ... 100%, the first with a
     fifth of room above the interval), an ink ring at the share (to the interval's precision, "0.43%") over its 95%
     interval, a 2px line with end ticks: a statistic, no meaning colour. Under the figure, two plain sentences on the
     papers read or checked with database values in view and where reading them again stands (statsExposureText, from
     reread_blind and reread_blind_done: sent back and none or some done, or all done); which agent saw them, when
     they were sent back and the papers not sent back are its rule (statsExposureRule), with the audit's date, its
     Wilson interval and its follow-ups.
   - Errors found in CatLog: neutral bars on one axis, a row per route (the sweep's kinds and a database check's fates as
     parts of its bar, when they make it; the audit's random and follow-up values in words), Values and Papers beside
     each, then All, each value once, after a hairline and in 600.
   A snapshot without the reviewers' own counts gives the match read from the paper again in words as Quality's lead
   (statsReviewFallbackHtml), and the human-checked line under Checks on the values. One line of links ends the part.
3. What is in the catalog: Review result beside Records by main source, then Enzyme classes. Review result (round 17:
   no legend table) is the 100% bar with its labels under it, a column per result as wide as its part (name, records,
   share; Accepted's records read from the paper as a stripe through its part and a line under its label, Not checked's
   two kinds under it; a result under a tenth of the records on a line of its own under the bar's end; on phones, and
   wherever a column cannot hold its lines one line each in the viewer's font, a key under the bar instead: a line per
   result with its swatch, name, records and share, its kinds indented under it); Accepted's other
   parts are its title and the rule, and the fields saved in records that are not accepted a table in the rule.
4. Values: Value ranges, Between papers, kcat against Km, Substrate specificity and Variants against their wild type.
   Round 17, no table: Between papers' same-temperature-and-pH table is 100% bars under its histograms, each parameter's
   pairs within 2-fold, 2- to 10-fold and more than 10-fold apart (one cyan, darker for closer, open for the farthest),
   its share on each part where it fits and the median beside it, the same at a temperature and pH both papers give
   right under it; kcat against Km's class medians are a dot plot beside the map (the map's numbered dots on a log
   axis of kcat and one of Km, a 1px rule between the two panels, the value beside each, the records at the end, the
   names whole from 641px; a row lights its dot on the map; under the map from 1024px to 1279px);
   Substrate specificity's table is bars of the median range by substrates tested on a log axis of folds.
5. Compared with databases: a one-sentence lead ("Where a database lists a number for a value read from the paper
   (142,515 of 197,799), it is the paper’s for 97.4%."), then Values compared with databases (each part's share on the
   bar itself where it fits, statsFitSegmentLabels; no share table; the caveat its caption, "a different number may be
   another assay’s") and Corrections by cause and how found (its caption calls the corrections a lower bound). The
   corrections, how they were found and the values that differ for a reason not yet known are Values compared with
   databases' rule, with the database numbers no CatLog value matches and the link to the Dataset notes.
6. CatLog and BRENDA by publication year (round 17, the user: "the CatLog and BRENDA plot should come later"): its own
   part, the last main one, the figure headed "Values per publication year"; its caption one sentence (the band, and
   "CatLog’s line is what it has read so far"), the reading order and the values outside the years drawn its rule.
Round 17's writing: captions one sentence, part leads one short sentence or none, the method's detail in How these
numbers are counted; visible prose (captions, leads, notes and paragraphs outside the figures' labels) 354 words at
1440px against 719 before, and no table on the main page against 9.
S. Supplementary figures (round 14, the user: "not every figure has to be shown like that (and tables, right?)"; round
   17, the user: "they should click on Supplementary figures and tables and all of them open, not one click per figure.
   Way too many tables there that you can convert to figures"): the figures that do not tell the main story, last
   before How these numbers are counted. It is one closed disclosure (details.stats-supp-all) whose summary is the
   part's heading line: the muted S, its title, then at the line's end a muted "+" and "Show all 22 figures" in the
   accent ("−" and "Hide" when open). Its title says what it holds: "Supplementary figures" while every item is a figure,
   "Supplementary figures and tables" if a table comes back (statsSupplementTitle; On this page names it the same).
   Closed, its heading line's hairline is the last rule above How these numbers are counted, which then has none of its
   own (no empty band framed by two hairlines); open, the method's rule ends the figures. One click opens everything: inside, five groups (Quality; What is in the catalog; Organisms, enzymes and variants;
   Values; Compared with databases), each a grid of open items laid out as the main parts' (two to a row from 1024px, a
   wide figure or an odd one out taking the row, one per row below 1024px), no disclosure in any item. An item is a
   div.stats-supp-item with its own address by its key as its id (#stats-supp-printed-units for Units as printed; never
   its number, which follows the items the snapshot has: a data update that drops one would move every later address), its
   heading (h4, under the group's h3) its number, a muted link to that address, and its title, then the figure with its
   caption "Figure S1. ..." (one sentence; what a mark means beyond it is the figure's rule in How these numbers are
   counted). Numbers run in the order the page shows them; a figure the snapshot cannot draw takes no number.
   Addresses: #stats-supplement and any item's address open the supplement (statsAddressTarget) and scroll to what they
   name, also when the page opens there; a followed link focuses the supplement's summary (Enter or Space closes it) or
   the item's heading. The live round 16b numbering (11 figures, 14 tables) is kept as an alias map,
   STATS_SUPPLEMENT_OLD_ADDRESSES: every numbered address (#stats-s1 to #stats-s12, #stats-table-s1 to #stats-table-s14)
   opens the item it named on that page, by the item's key in data-supp, whatever number the item has now (#stats-s3,
   papers by parameter, is Figure S5 today; #stats-table-s4, the most common organisms, a figure); a number that page
   never had, or an item this snapshot lacks, opens the supplement. The older #stats-biology opens What is in the catalog and #stats-cautions the Cautions figure. A visitor's own
   click on the summary puts #stats-supplement in the address bar in place (replaceState) and closing it gives back the
   address from before; a number link pushes the item's address. The supplement fits its value columns and tables when
   it opens (statsFitOpened on its toggle); on paper it prints open (beforeprint and the print stylesheet, its Show
   all hidden), and no Stats address loads the record index (the preload hint skips #stats-*, as #guide-*). The
   supplement's rules stand under their own numbers in How these numbers are counted, after the main figures'.
   Round 17 drew the 14 tables as figures, in the page's figure style (statsListChart: statsBarChart's rows, a name a
   Browse link where one filter opens exactly those records, a bar, its count and share; a count above 0 at least 2px
   wide; small multiples, statsPanelsHtml, panels side by side where each gets 300px):
   - Human review by kind: bars in --bar-neutral, the other disagreements indented under their total, what CatLog has
     read since of the values reviewers named as a muted line under the Value missing bar.
   - Approved values read from the paper again: bars in the colours the words mean on the page (Same value green,
     another name and rounding mint, the paper supports CatLog's value cyan, CatLog error Disputed's deep red, still to
     check slate hatching, left out neutral); who checked the values that differ is its rule.
   - What the records contain: bars on a 0-100% axis of all records, the kinds of sequence and both temperature and pH
     indented under their field (the old Sequence fields disclosure is gone).
   - Most common organisms and Most common EC numbers: one figure each of two panels, All records (--bar-neutral) and
     Read from the paper (cyan), each its ten commonest with counts and shares (were Tables S4-S7).
   - Wild type and variants: two panels, all records by enzyme form and the variant records read from the paper by kind
     of change, both on a 0-100% axis (were Tables S8 and S9).
   - The typical wild-type enzyme: a dot plot, a panel per parameter on its own log axis, the median dot and middle-80%
     line of the wild-type records (as Values by enzyme class draws them), and on the kcat/Km line the average enzyme of
     Bar-Even et al. 2011 as an open ink diamond at about 10⁵ M⁻¹ s⁻¹, named in the legend above the panels with its DOI
     link (a row of its own left a phone's plot under 120px); each panel names its papers and enzymes.
   - Units as printed: three panels, a parameter each, the printed units as cyan bars of that parameter's values.
   - Cautions on values: a tan bar per caution, each name a Browse link; No cautions, most records, is a link in the
     caption, so its bar does not make the others slivers.
   - Paired values by database: a dot plot, per database the share of its paired values CatLog's number corrects (a red
     dot) and that differ (a brown square, colour never alone) on one percent axis, their counts beside them (Corrects
     a Browse link per database; All's Differs too), the paired values and the share the same under the name; no marks
     under 1,000 paired values; the All row under a hairline.
   - Corrections by cause and database: a heat map, a row per database and a column per cause family, each cell's count
     on a grey shaded from 8% to 60% of the map's ink by the log of its count (no meaning colour: a light correction red
     is Not confirmed's salmon; ink numbers keep 5:1), each database's total and the All row as plain margins, every
     count a Browse link where Browse can filter it; where the table does not fit its figure (phones, a wide font) a
     line per database instead (statsFitDatabaseTables).
   - Single substitutions' five commonest substitutions: bars under the map's facts.
   The one table form left is inside Corrections on records not yet re-read (its share table under the 100% bars, the
   legend's names as heads, round 15): a segment of 1.5% cannot carry its own number.
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
     several, deletion, insertion, truncation, other or not specified; drawn when they add up to the records): a panel
     of Wild type and variants (round 17), its records linked to source=paper&variant=variant.
   - Units as printed (`from_paper_insights.printed_units`: per parameter the values, up to eight printed units by
     count and Other): the unit printed with each value (its proof line's raw_unit) with a power of ten set aside, read
     by `printed_unit` (per s, min or h; M, mM, µM, nM or pM, mol/L spelled out too; a lower-case m standing alone is
     the molar sign, as small capitals come out of a text layer), a panel per parameter with its stored unit (round 17;
     a table grouped by parameter until then), shares of that parameter's values.
   No publication year or journal in the Full data, so no figure from it by year (the brief's example; the one figure
   by year, CatLog and BRENDA by publication year, reads the manifest's `summary.publication_years`, which catlog-v2's
   build dates by PubMed); no organism kingdom or substrate kind either (no field gives them).

A closed "How these numbers are counted" ends the page: the one place the snapshot's date, its Data ID and the counting
rules are said (the user, 2026-10-15, of the line that stood under every figure, "Snapshot Oct 15, 2026 · Data ID ... ·
143,184 values in all; ...": "Do we need this???"). It gives Snapshot (the date and Data ID, counted from this
snapshot's Full data download, the human-review results and, when the audits are shown, the AI audit records),
Shares (what a share is out of: all records in the
figures and tables that count all records, named by number (since round 17 the review result, What the records contain
and Cautions on values, `STATS_SHARES_OF_ALL`; the supplement's two-panel figures name each panel's own records),
elsewhere its own bar's, row's or card's total or the total its caption names; one decimal, a nonzero share under 0.1%
written <0.1%), Papers, Names, Human-checked, Main source, Read from the paper
and Not yet re-read (with an overview), Human review (with a lead: its date and definitions), Compared with databases
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
  hole; each slice has one fill, its colour at 60% with a 1px opaque outline, Not checked's slices slate hatching, so
  navy and slate stay apart by pattern, not lightness alone; the one partition that is
  a true whole) beside its legend table; pointing at a slice or its row lights both (lit rows tinted --surface-2; Not
  checked's row lights both its slices with their rows, while Unverified or Not reviewed alone leaves it unlit): Accepted (split in the rows under it:
  Read from the paper; Not yet re-read, as printed, after a correction or
  approved by a human reviewer; the split in words is the row's title), Not confirmed, Not checked (Unverified and Not reviewed
  under it), Disputed: names, records and share only (round 14: the definitions ran 2-6 lines a row and left the
  row 700px tall beside a lone donut); each row's definition is its title and the caption links the Guide's
  definitions ("Each record has exactly one review result (defined in the Guide)."). The no-paper-linked note and
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
- CatLog and BRENDA by publication year (round 16, the figure the user approved on 2026-10-21, "similar, but up to
  date"): from the manifest's `summary.publication_years` (written by catlog-v2's build; BRENDA's side fixed until a new
  BRENDA release), kcat, Km and kcat/Km values per PubMed publication year of their paper, 2000-2025, in BRENDA 2026.1
  and read by CatLog (every catalog value, as CatLog's status counts them): a line with a dot per year for each, CatLog
  in Read from the paper's cyan, BRENDA in the grey of a count with no meaning colour (navy is Accepted's on this page),
  the years BRENDA is still adding papers from (2020 on) on a plain grey band with open dots, direct labels on the lines
  and BRENDA's highest year and last year before the band labelled with their counts (placed in the viewer's font where
  they touch nothing; a key above the plot when a name finds no room), "CatLog on <date>: N values from M papers" above
  the plot. One caption sentence carries the band and CatLog's values from papers after 2025, which are not drawn; the
  counting rules are the figure's in How these numbers are counted (with the build's catlog_before_first_year and
  catlog_papers_without_year the parts must make CatLog's totals, and the rules name the values before 2000). A column per year gives its tooltip line. No field,
  or counts that do not hold together: no figure (tools/catlog-static/DESIGN.md, "Round 16").
- Read from the paper and not yet re-read: two bars stacked by review result (Read from the paper: the main source
  CatLog's own reading; Not yet re-read: every other record, so the two make all records, as its caption says), its
  number columns named Records and % accepted; both names link into Browse (source=paper, source=databases). What each means is said once,
  in How these numbers are counted.
- Values per paper (`overview.from_paper_values`): the papers CatLog has read, by how many kcat, Km and
  printed kcat/Km values it read from each (1, 2-4, 5-9, 10-19, 20-49, 50-99, 100-199, 200-499, 500 or more; a
  calculated kcat/Km is not a value read), its number columns named Papers and % of papers; drawn only when the bins add up to
  the papers CatLog has read. No publication years here: the Full data has none (CatLog and BRENDA by publication year
  reads the manifest's own field).
- Part 7, Compared with databases, reads only the manifest's `summary.database_comparison` (the page never parses a
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
  - Values compared with databases: 100% bars kcat, Km, printed kcat/Km and All values (same, same other label,
    corrects, differs, not listed); the counts of corrects and differs beside each bar (with dbpar, see above), each
    after its swatch in a right-aligned column under its heading, Corrects and Differs (Table S10's names; each column as
    wide as its widest count or heading plus the swatch, a sizer as in Figure 3, fitted to the heading line once drawn);
    shares under the bars; a segment with a filter opens Browse when clicked; its rule (How these numbers are
    counted): calculated kcat/Km not compared; a note under the figure (a result, so beside it): the numbers the databases list that CatLog does not have (`not_reproduced.distinct`), with those CatLog has as a
    kcat/Km it calculated or under another parameter named apart; "the README gives the reasons" only when the snapshot
    has its comparison download (`database_comparison_download`), whose build writes the README's section on it; that
    file is also the Download menu's and the Guide's Downloads' "Compared with databases" item (one row per value and
    database, CSV; rows and size from the manifest, saved as catlog-<date>-database-comparison.csv.gz), hidden
    without it.
  - Results by database (`values_by_database`): a 100% bar per database, the
    values from papers it lists beside it under the heading Values, "N values from papers X does not list" under it
    (no leading "+", the glyph that opens every closed item), never in it. Its own
    not-listed kinds in the database's words (Lists other values only in cyan hatching, Lists none of this parameter a
    light cyan, Value in no database Not in the databases' own cyan fill: never three cyan tints), never the Why not
    listed labels, which say what all the databases list. A database that lists none of
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
  stripe of Read from the paper's colour (--src-paper) inside the accepted bar, a 4px band through its middle (round 17 fix
  pass: thin, so the accepted bar keeps Accepted's navy), set off from its fill by a 1px white gap above and below, so it
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
    caption that papers choose which residues to change, so these are not a random sample of mutations (fix pass: no
    claim about catalytic residues, which no field records); per parameter (kcat, Km, kcat/Km) a histogram of log10(variant ÷ wild type) in
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
- What the wild-type values show (round 16, the user 2026-10-21: "more stats that are more scientifically insightful and
  important, even as supplementary"; `from_paper_insights.between_papers`, `substrate_range`, `km_by_size`,
  `temperature`, `typical`, counted by `build_overview` (WildTypeInsights) from the wild-type records read from the paper,
  each value in the unit CatLog stores; about 3.3 KB). An enzyme is a name and organism; between papers a UniProt entry.
  Each caption is one sentence: what is drawn, the records, papers and enzymes it uses and the caveat that matters; the
  rest of its rule is under its number in How these numbers are counted. All in Read from the paper's cyan; each only
  when its counts hold together. The tooltip line of each bar or row gives its range and count.
  - Between papers (main, Values, after Value ranges): one UniProt entry and substrate (SMILES, else name) as wild type
    in two papers; each paper's value the median of its records, a pair of papers once per enzyme, substrate and parameter; per parameter a
    histogram of the fold difference in quarter decades from 1-fold (the last bar 100-fold and more), Median, Within
    2-fold and Within 10-fold above it; under the three, a table of the same at a temperature (to 1 °C) and pH (to 0.1)
    both papers give, and the records it uses. Caveat: assays and constructs differ between papers, so a difference is
    not all error.
  - Substrate specificity (main, Values, after kcat against Km): one wild-type enzyme on three or more substrates in one
    paper with one cosubstrate, pH and temperature (a panel), the kcat/Km of its best substrate over its worst in half
    decades from 1-fold (the last bar 10⁶-fold and more), beside a table of the median range by substrates tested (3,
    4, 5, 6–9, 10 or more). Caveat: papers choose the substrates, and the range grows with their number.
  - kcat and assay temperature (supplement figure): the kcat records in 10 °C bins (each from its lower edge) as a dot
    (median) on a line (middle half) per row, in Values by enzyme class's rows (statsMediansPanel); beside it, one
    paper's series of one enzyme and substrate at two or more temperatures with one cosubstrate and pH, Q₁₀ (10 to the
    power of ten times the least-squares slope of log10 kcat on temperature) in bars of a tenth of a decade centred on
    10^−0.5 ... 10^1, a dashed line at no change. Caveat: each bin holds different enzymes, and a series can pass the
    enzyme's best temperature.
  - Km and substrate size (supplement figure): the Km records by the substrate's non-hydrogen atoms (from a one-piece
    SMILES) as medians on lines; beside it, within a panel of four or more substrates of at least two sizes, Spearman's
    ρ of size and median Km in bars of 0.25 centred on −1 ... 1, a dashed line at no trend. Caveat: each size holds
    different enzymes, so only the correlation compares substrates of one enzyme. Its rule cites Bar-Even et al. 2011's
    abstract: low molecular mass appears to limit Km optimization.
  - The typical wild-type enzyme (supplement, Values' first table): median and 10–90% per parameter, the records, papers
    and enzymes on a line under its name (three columns fit a phone), and the average enzyme's kcat/Km of Bar-Even et
    al., Biochemistry 2011 (doi:10.1021/bi2002289), about 10⁵ M⁻¹ s⁻¹, the one number checked against the paper (its
    abstract, PubMed and Europe PMC, 2026-10-21; its kcat and KM medians are not used: PubMed's copy of the abstract lost
    the kcat's digit and the ACS full text could not be reached). Caveat: CatLog counts every substrate and assay a paper
    reports, not one value per enzyme.
  The linear axes (ρ, Q₁₀) use stats-condition-axis, as Assay temperature and pH do. No caption or rule names a figure's
  number, so the BRENDA comparison by year (another round 16 lane) can join the main figures and the rest renumber.
- Compared with databases by enzyme class (`from_paper_insights.database_by_class`, part 7, after Values against the
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
not sending AI to get paper business"): CatLog reads published enzyme kinetics back from their papers; its agents find
the paper each database value cites, read the values in it and check each one against the paper; people review
samples. The line (round 14, shorter, one verb as the labels say: read from the paper): "CatLog reads enzyme kinetics
back from the papers the enzyme databases cite. AI agents read and check each value; people review samples, and what
they find improves the rules. 75,000 of 185,804 records are read from the paper so far." (the last sentence from the
manifest, renderRereadLines: never "each database value" as if every one were done). The caption starts "The loop runs clockwise from cited papers." The method says "automated checks" and "found
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
under Checks ("How CatLog reads a value →", #guide-how-read); the license and the snapshot are said once for every
record (round 17: the table's footer "CC BY 4.0 · How to cite" and the counts band's date), and a record says its
license only when it is not CC BY 4.0; nothing the header says (form, "from paper") is repeated in a section
(tools/catlog-static/DESIGN.md, Record Details). Its name wraps between its parts only (at a space or after a hyphen or
slash), a short locant ("4-", "1,2-") kept with the part after it, and on a phone it takes the panel's width under
‹ › × after its first lines (round 14).

## Round 17: words, not shapes (Browse's review result and variant line)
The user (2026-10-23): the dots and squares for Accepted and from paper looked AI-made, not eye-soothing; the boxed
mutation code was hard to understand. A review result is now its word in its colour's text shade, with human-checked's
green check right after it in every width ("Accepted ✓"); the source line under it says "from paper" in Read from the
paper's dark cyan or "not re-read · BRENDA" in muted grey. The sidebar's options, the chips, the record's status line
("Accepted ✓ human-checked · from paper"), the Guide's legend, Browse's counts band and Stats' headline band follow: no
dot, square or pill anywhere a result or the source is named. The badge's accessible name says each source in full
("Accepted, Read from the paper"). Words and marks (contrast on white / the hovered row / the selected row):

| Meaning | Word or mark | Colour | Contrast |
|---|---|---|---|
| Accepted | the word, 13px/500 (record 600) | navy #3C5488 (BPG) | 7.5 / 6.8 / 6.6:1 |
| Not confirmed | the word | terracotta #975B4C (salmon's darker shade; ΔE2000 16.9 from Disputed, 11.2 from brown, whose words stay ink) | 5.4 / 4.9 / 4.7:1 |
| Not checked (Unverified and Not reviewed) | the word | slate grey #60687F (slate's darker, greyer shade; ΔE2000 11.2 from navy; no tan) | 5.5 / 5.1 / 4.9:1 |
| Disputed | the word | deep red #DC0000 (BPG) | 5.2 / 4.8 / 4.6:1 |
| Read from the paper | "from paper" 12px/400, its option, chip and count | dark cyan #207286 (BPG cyan's text shade) | 5.5 / 5.0 / 4.8:1 |
| Not yet re-read, its source, corrected, no paper linked | the tag words | muted #5c6865 | 5.8 / 5.3 / 5.1:1 |
| human-checked | a 12px check after the word (the Guide and the record add the word) | green #007664 | 5.6 / 5.1 / 4.9:1 |
| database results, cautions | their square or "!" before the words (unchanged) | their BPG colours | (tools/catlog-static/DESIGN.md) |

A variant reads "variant E124Q" under the enzyme (12/16px, "variant" muted, the mutation in --text-2 with tabular
figures, no box; a long list cut with "…"; "variant, not specified" muted whole; a signature that describes itself,
"deletion mutant", stands alone unless it starts with a substitution), its title the substitutions in words where every
part parses ("Variant E124Q: Glu124 → Gln"), and the record's header "Variant E124Q (Glu124 → Gln)" in the same plain
type for up to three (tools/catlog-static/DESIGN.md, Type And Color).
A mutation field that holds an old pipeline's reasoning or an assay note ("but the preserved evidence still stops at
...", "... remains manual_review_required because ...", "stopped-flow measurement of ...", "reaction stopped with ...":
15 earlier-catalog records on Oct 22) names no form, so mutationSignature() treats it as none (NOT_A_FORM) and the record
reads "variant, not specified" in the table, the cards, the titles, the record, the search and the downloads. Codes
that are not substitutions get no words (mutationWords): one position given two wild-type residues ("M6P/M1P/G1P/G6P",
"K2H/H2P") and, on a record whose enzyme or substrate says "phosph", sugar-phosphate-shaped codes only ("G6P", "G1P/F6P").
