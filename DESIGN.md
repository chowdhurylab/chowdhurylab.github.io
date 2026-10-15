# CatLog Public UI

Browse is the working table. Keep its header, search, compact counts, filters,
record drawer and downloads intact. Stats is a separate page, not a drawer or
expanding summary that takes space from the table. Browse's active-filter chips
wear a colour (a 3px bar and a quiet tint; the words stay): an option's own
colour where it has one (a review result's status colour, a database result's
square, a caution's amber), else the colour of the dot beside its group in the
sidebar (Source purple, enzyme fields raspberry, measurement olive: colours that
mean nothing else on the page), and Undo,
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
line, then numbered parts, each with one plain heading (20px, its number in a small accent disc) and its figures and
tables on a 12-column grid (max 1200px, gaps 48px and 32px), two to a row from 1024px (an odd one out spans the row;
a bar chart that spans it keeps its labels within 240px of the bars; from 1024 to 1279px Figures 1 and 2 take a row
each, so the legend table keeps its room beside the donut), one below. Figures and tables are numbered across parts.

1. At a glance, the headline band (the user: "the stats bar on top - can it glow a bit or more focus driving"): a box
   with a 2px accent rule along its top, fading to the right, and a soft accent wash in its corner. Line 1 (32px):
   Records, Accepted with its share, Read from the paper with its papers, Human review ("99.9%", "values correct of
   2,674 entries from the earlier version (408 papers)"; a snapshot without the review's counts gives the share of
   approved values the same, read from the paper again), the numbers in accent ink with a soft
   glow (a 14px text-shadow of the accent at 26%, never neon). Line 2 (20px): Papers, Enzymes, EC numbers, Organisms,
   Substrates. Accepted and Read from the paper link into Browse: the whole item is the link and tints calmly under
   the pointer. Phones: 24/18px, two to a row; below 360px line 1 stands one under the other, so Read from the paper
   keeps one line in a wide font (DejaVu Sans). CatLog is the one name (round 8): records are Read from the paper or
   Not yet re-read, never v1 or v2; the earlier version is named only in help (How these numbers are counted, once on
   Stats), in the human review's base and in the Guide's method section. "re-read" never breaks at its hyphen ("re-" /
   "read" on two lines): Stats wraps each one in its text in a nowrap span (keepReRead) and the Guide writes the same span. Browse's counts band gets the same treatment at 20px: its key numbers
   in accent ink with the glow (Human-checked in its green), a soft wash and a thin accent rule along its foot; a
   linked count tints around itself without moving the line. Its With counts (kcat, Km, kcat/Km) are secondary:
   16px/500 in --text-2 with their 13px labels, so the key numbers lead. Nothing moves when the viewer asks for less motion;
   print drops every glow and wash.
2. Quality: the lead, then Checks on the values.
3. What is in the catalog: Review result (the donut), Records by main source, Read from the paper and not yet re-read,
   Values read from each paper, then What the records contain beside Wild type and variants.
4. Biology: Enzyme classes, the 10 most common organisms and EC numbers, then the same among records read from the
   paper.
5. Values: Value ranges, then Values by enzyme class.
6. Cautions.
7. Against the databases (manifest `summary.database_comparison`; round 9 brief section 5): a one-sentence lead, Each
   value against the databases (alone in its row until Why no database lists a value joins it), Each database against
   the values read from its papers beside When a database lists a number for the same measurement, How each correction
   was found beside Corrections by cause and database, then Corrections on records not yet re-read beside Entries
   replaced by reading the paper. Each only when the snapshot has its counts; a pair with one figure gives it the row.

A closed "How these numbers are counted" ends the page. The parts' figures and tables:

- Lead (first in Quality, full width): Human review of the earlier version's entries, what the reviewers'
  own files say (the user, 2026-10-13: "keep it simple, reflect the review document"), from
  `overview.quality.review.v1` (catlog-v2 HUMAN_REVIEW.md "Measuring CatLog against the reviewers"; `build_overview`
  copies each reviewed catalog's numbers, strings and `other_by_kind`). Each entry a reviewer checked counts once, by
  its final verdict. Its heading is "Human review"; the big number is the values correct (kcat, Km, kcat/Km): entries
  where no reviewer disputed a number or its unit, worked out from `entries` and `value_disputed` ("99.9%"), with its
  base under it as one phrase, "values correct of 2,674 entries from the earlier version (408 papers)". One sentence,
  without repeating the base: "A reviewer disputed a kcat, Km or kcat/Km value on 3 of the 2,674 entries, and all 3
  are as printed in the paper." (`value_disputed_checked_as_printed`). Two facts: Values missing ("31 entries
  (1.2%)") and Other disagreements ("177 entries (6.6%)"), then one note: what values missing means ("the paper
  prints a value the entry lacked, mostly the kcat"), with how many of the values reviewers named CatLog has read from
  the paper since ("CatLog has read 53 of the 58 values reviewers named from the paper";
  `agreement.stated_values_catlog_has` of `stated_values`), and the other disagreements by kind, a minor line
  ("could not find the value 153, organism name 13, DOI 5, ..."). A review of records read from the paper
  (`review.v2`, once reviewers check them) adds one sentence of the same shape ("Human reviewers checked 40 records
  read from the paper (3 papers): ..."). CatLog's reading against the review is one side line, set off by a rule at
  its left: "Read from the paper again: same value as the reviewers for 3,625 of 4,074 approved values (89.0%); wrong
  CatLog values found: 0." (`agreement.agree` of `values_approved`, else
  `v2_found` of `v2_approved_total`: the match as it is now; `agreement.catlog_value_wrong`, else `v2_wrong`). Then
  a data line with the definitions and links to the Guide's method and to Team. kcat, Km and kcat/Km in the lead's
  text (the big number's words, the sentence, the notes, the data line) take the site's italic markup with a
  subscript (metricWordsHtml, on escaped text only), as the Values lines and the Guide write them. The first-comparison and blind
  fields (`first_agree*`, `papers_unexposed`, the 95% range) are reference only: never read, never shown; no
  "first comparison", "read blind" or "95% range" anywhere. A snapshot without `review` leads with that match ("of the
  values human reviewers approved are the same, read from the paper again"; its sentence names the papers: "Read from
  the paper again (98 papers human reviewers checked): ...") and what reviewers found in entries from the earlier
  version (`compared_values_v1`); one with neither has no lead. Counts that do not hold together are not shown.
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
  each value label gives the records, then the share accepted. Only CatLog's
  own records are linked (no single filter opens a main source). Under it, the
  per-database counts Browse's source filter finds (a merged record counts
  under each, as the Guide's source list), each linked. A snapshot without
  `main_sources` draws the same groups from the source_db counts, unsplit. A Records | Share switch above the bars
  redraws each source as 100% of itself (the accepted share by source, with its own 0-100% axis), eased unless the
  viewer asks for less motion.
- Read from the paper and not yet re-read: two bars stacked by review result (Read from the paper: the main source
  CatLog's own reading; Not yet re-read: every other record, so the two make all records), each label the records,
  then the share accepted; both names link into Browse (source=paper, source=databases). What each means is said once,
  in How these numbers are counted.
- Values read from each paper (`overview.from_paper_values`): the papers CatLog has read, by how many kcat, Km and
  printed kcat/Km values it read from each (1, 2-4, 5-9, 10-19, 20-49, 50-99, 100-199, 200-499, 500 or more; a
  calculated kcat/Km is not a value read), each label the papers, then their share; drawn only when the bins add up to
  the papers CatLog has read. No publication years: the data has none.
- Part 7, Against the databases, reads only the manifest's `summary.database_comparison` (the page never parses a
  value's database line): whole counts, checked to add up (the parameters to `values.all`, the causes to
  `corrections.values`); a figure whose keys are absent or damaged is left out, and the part has no heading without
  figures. The databases, their order and names come from its `sources` list (key, name, display), else from the
  databases its counts name in the Source filter's order and spelling (STRENDA DB), else BRENDA, SABIO-RK, OED, SKiD,
  STRENDA DB and UniProt (the one list Browse, the record and the Guide use too): no number of databases is fixed. A
  database's name never breaks across lines (captions, table headings, the per-database lines), as in the Guide.
  Every caption ends "Numbers compared for the same paper. A different number can mean a different measurement; it
  does not by itself mean a database is wrong." (the Guide's note too; a record says it once, in the "?" box beside
  its Against the databases heading with the compared databases and a link to the Guide, and under its notes only
  when a value has a Different number: the user, 2026-10-15, "do we need to write it every time?"). A result's name and definition are Browse's
  option's (DATABASE_RESULT_NAMES, databaseFilters' title), in Stats and the Guide alike. Shares only on a base of 1,000 values, else counts. Colours as Browse
  gives the results: same green, same number under another label --bar-neutral, corrects red, different number brown,
  not in the databases cyan (a database's own not-listed kinds at three cyan strengths; how found at two reds).
  - Lead (14px): "Of 126,951 values read from 2,650 papers and compared, 97,791 (77.0%) are the number a database
    lists, 5,574 are a number a database lists under another label, 1,548 correct a database's number (656 checked
    against the paper), 1,051 differ without a known cause and 20,987 are in none of the databases. Where a database
    lists a number for the same measurement (100,390 values), it is the paper's number for 97.4%." Its counts add up to
    the total; the four result phrases link into Browse (db=other_label, corrects, differs, not_listed), each titled
    with the records it opens ("1,548 values in 1,443 records", from the option's record count).
  - Links never open a wider list than their count: a count, segment or label whose link would name a database
    (dbsrc), a cause (dbwhy) or a compared parameter (dbpar) links only once Browse matches that key
    (DATABASE_REFINE_KEYS, the record's rule too); until then it is a plain number and only the db= links stay.
  - Each value against the databases: 100% bars kcat, Km, printed kcat/Km and All values (same, same other label,
    corrects, differs, not listed); the counts of corrects and differs beside each bar (with dbpar, see above);
    shares under the bars; a segment with a filter opens Browse when clicked; data line: calculated kcat/Km not
    compared, numbers the databases list that CatLog does not have (`not_reproduced.distinct`), with those CatLog has as a
    kcat/Km it calculated or under another parameter named apart; "the README gives the reasons" only when the snapshot
    has its comparison download (`database_comparison_download`), whose build writes the README's section on it.
  - Each database against the values read from its papers (`values_by_database`): a 100% bar per database, the
    values from papers it lists beside it, "+ N values from papers X does not list" under it, never in it. Its own
    not-listed kinds in the database's words (Lists other values only, Lists none of this parameter, Value in no
    database), never the Why not listed labels, which say what all the databases list. A database that lists none of
    the papers read gets a data line ("UniProt lists none of these papers."), no empty bar, and no column in
    Corrections by cause and database. Beside it,
    the table When a database lists a number for the same measurement: Paired, Same (share), Corrects, Differs per
    database and "All, each value once" (`values.all`); below 400px the paired count goes under the name. Per
    database only Corrects links (bar, legend, table): a database's Different number also counts its other number for a
    value whose own result is Same or Corrects, and its Same, other label a value whose own result is Same, so Browse,
    which matches a value by its own result, would show fewer; the All row's Differs links (one result).
  - How each correction was found: a bar per cause family (Unit or scale, Decimal slip, Another number, Unit
    misprinted; DATABASE_CAUSE_FAMILIES, the Guide's list too, maps every cause code), split checked against the paper / an exact factor found by
    code from `corrections.by` when the causes code finds (power of ten, 60 or 3,600, printed number in another unit)
    add up to its code count; a bar split two ways prints its two counts under its name, each after its colour. Beside
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
- Enzyme classes: records bars (light) with the accepted drawn over them and the records read from the paper as a darker navy
  stripe inside the accepted bar (70% navy, 30% text), set off from its fill by a 1px white gap above and below, so it
  parts from it by more than lightness, in grey print too (`ec_classes[].from_paper`; the legend's swatch is an
  accepted swatch with the stripe through it, named Read from the paper); a nonzero accepted or read-from-the-paper
  count draws at least 2px wide; each label gives records, accepted, then read from the paper (navy), each
  number in its own right-aligned column under a 12px muted heading line (Records, Accepted, From paper: the legend's
  order, the last in the short tag), every column as wide as its heading or widest entry; once drawn, the value column takes exactly the width of
  that heading line. On phones, as in every bar chart, its bars and axis span the row: the class name and its numbers
  share the first line, under the headings, 8px apart, and a long class name hyphenates. Below 360px From paper takes
  one word per line (From / paper, the headings standing on their last line) and its column is only as wide as its
  longest word or count (data-sizer-narrow; the columns are fitted again when the width crosses 360px), so the class
  names keep their room and stay whole at 320px; only a name wider than the whole label column (Oxidoreductases in
  DejaVu Sans at 320px, as before round 8) may still break.
- Value ranges (full width): per metric in catalog units (kcat s⁻¹, Km mM,
  kcat/Km s⁻¹ mM⁻¹) the median, the 10–90% range and a histogram per power of
  ten whose end bars hold every value beyond them, drawn on the log axis it shares with Values by enzyme class (the
  whole decades around that parameter's class grid; bars beyond it join the end bars) in the class panels' columns
  (their label, median and n columns left blank beside it), so a reader can run an eye down from the whole
  distribution to the classes and 10⁰ stands at one x in all of Part 5; without a class grid, or when the histogram
  does not reach that far, each keeps its own axis; values without a recorded
  unit or in another unit are left out; the median (here, in Values by enzyme class, in every tooltip line and in
  the figures' accessible text) and the 10–90% bounds have two significant figures. The value figures (these and the next) are single-series and use --bar-neutral: every Nature BPG hue
  already means a review result, a database comparison or a kind of change on this page (green would read as "same
  number as a database" in Part 7), so the panels' own headings name the parameter. The light fills carry nothing on
  their own: the bars' 1px outline and the ridge lines, which give the shapes, are drawn darker than the colour (75% of
  it with --text, 5.3:1 against the page), as the 10–90% line and the median dot are.
- Values by enzyme class (full width, small multiples): per parameter a ridgeline panel, one ridge per EC class
  drawn through its half-decade bins (`overview.metrics.<metric>.by_class`: one grid of 14-18 bins per parameter
  shared by every class, the end bins holding every value beyond them; a record in several classes counts in
  each), each scaled to its own peak (shapes compare whatever the class's size) with a smooth curve that never
  overshoots its bins. The open-ended end bins are not in the curve (a pile there is not a peak in the data): the
  curve covers the inner bins, cut off level at an end with values beyond it (falling to the baseline where there are
  none), and each end bin with values gets a 6px hatched stub of fixed height, its count in the tooltip line and the
  row's summary. A fill from the parameter's colour to its tint, the 10–90% range as a line on the baseline
  with the median as a dot, the median at the right to two significant figures and the class's number of values
  after it (a muted n column sized in ch to its longest count), a class with fewer than 300 values drawn lighter
  (fill at 45%) with a dashed outline so it does not look as solid as a big one (the data line says so when one is
  shown), a shared log axis per panel, the one Value ranges uses (a tick per decade, labelled at the even powers when there are more than 7 ticks, so
  10⁰ is always labelled; every second label thins out when narrow, the power of ten with it). EC N links into Browse with the panel's parameter (the
  class's records with it in any unit, so Browse can count more than n; the tooltip line says so); the class name stands beside it only where a panel has the
  row to itself (641-1023px); three panels side by side, phones and paper show the class number alone.
- Tables: Most common organisms and Most common EC numbers (top 10, the EC
  with the enzyme name its records use most, bars against the largest), then Most common organisms and Most common
  EC numbers among records read from the paper (counts "Records", shares of the records read from the paper, navy
  bars, linked with source=paper),
  What the records contain, Wild type and variants, Cautions.

Figure style (the user: "some SOTA plots maybe - yeah Nature BPG colour palette but a bit glowing"): every figure
and table has a heading (16px; the parts' headings are 20px), the plot, then
"Figure N." or "Table N." (numbered in reading order, figures and tables
apart, so without figures 3-5 the next figure is 3) with one sentence (13px) and a 12px data line (snapshot, Data ID,
definition). Bars 16px thick, 8px apart, their outer ends rounded 2px; fills run from the colour to its tint, top
to bottom, with a 1px opaque outline; legends inline above the plot with 10px
swatches in segment order (a name that wraps keeps its count right after it);
one shared scale per chart with axis ticks of
three to five whole steps (1, 2, 2.5, 3 or 5 × 10ⁿ), each label centred on
its tick, the end one too, so they sit evenly (where labels would touch they thin evenly: a narrow axis keeps every
other one of six ticks, 0, 2 and 4 steps, 0, the middle and the end of five, and only the ends of four under 24ch, in
the labels' own font, so labels never touch, also in a wider font; on phones, where the end label ends at its tick, they
thin sooner: six ticks under 56ch, five under 45ch, four under 34ch); light 1px gridlines at the
ticks shown, a gridline giving way with its label, so none is unlabelled. Category labels 13px, value labels and ticks
12px, tabular numbers; a chart's value column fits its longest label (sized in ch, so a wider font widens it). A
label of several numbers (the count, then the share; Figure 5's records, accepted and read from the paper) sets each
number in its own right-aligned column 6px apart, every column after the first as wide as its widest entry in the
chart (a hidden sizer holds the entries' shapes, digits as 0, one per line, measured in the viewer's own font at 600,
the boldest weight in a value column), so the counts line up whatever the shares.
Pointing at a mark, or focusing the link in its row, lights it with a soft glow in its own colour (a low-alpha
drop-shadow), dims the other marks of its figure (bars, slices, ridges; their names and counts keep full ink, so
their contrast holds) and shows its exact count in a dark tooltip line; touch shows it on a
tap. Scrolling hides a line the pointer showed (the pointer brings it back), while a line keyboard focus showed
follows its mark as long as the mark is in view, so Tab to a mark below the fold, which scrolls the page, keeps it.
Escape puts the line and the light out without moving the pointer or focus (WCAG 1.4.13); they stay out on that mark
until the pointer or focus moves on.
Nothing eases when the viewer asks for less motion. Table rows 13px with an 80px bar (48px on phones); the counts
right-aligned under their headings. Colours are tokens: review results
(--st-accepted navy, --st-pending salmon with its ring, --st-unverified slate,
--st-not-reviewed tan, --st-disputed red), the comparisons of figures 3-5
(--cmp-same green, --cmp-differs brown, --cmp-new cyan) with the kinds of
change in figure 4 (--chg-precision mint, --chg-magnitude red), --bar-neutral for
single-series bars and table bars (Table 1 included) and amber only for
cautions. No gauges, completion bars or confidence scores; the review-result
donut is the only ring; the glow stays soft (never neon) and only marks focus: at rest only the headline band's key
numbers and the lead figure of Quality glow; a mark (bar, slice, ridge, median dot) glows only while pointed at or
focused, so the part numbers, meters, the median dots, the ridges and the pressed switch button have plain 1px
outlines at rest, and the read-from-the-paper stripe never glows (its accepted bar does). Markup (a deliberate change from the design spec's
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
and columns print in their colours even with the browser's background graphics off; no glow, wash, tooltip or
switch on paper.

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
The Guide starts with three plain tasks and a real search example, not a
numbered onboarding strip or a repeated workflow illustration.

## Team

Team (#team, in catlog-latest.html like the Guide; its own view, never the
record index) is "People behind CatLog": one plain line, then the loop the
user approved: a racetrack of stations Papers, AI reading, AI check, CatLog,
Human check, Rules updated and back to Papers (clockwise, small arrows), with
Website and The paper branching off CatLog. AI agents stand above their
stations (Download agent at Papers, Reading agents at AI reading, Checking
agents at AI check, Audit agents at CatLog; rectangles on the accent tint), people below
(Supantha at Rules updated, also lighting Papers, CatLog and Website; Aarna and
Erin at Human check; Mohammad at The paper; grey pills). First names only: no titles, ranks, model or vendor
names; individual review decisions stay anonymous. Live numbers at the
stations come from the manifest (papers read and records at AI reading,
values re-checked by AI audits at CatLog, the human review's headline and
human-checked records at Human check, records at Website), each left out when
its field is absent. Human check says the Stats lead's headline shortened, never
a bare "agreement": "99.9% values correct" over "of 2,674 entries from the earlier version"
("99.9% values correct" over "of 2,674 entries from" over "the earlier version" on the upright loop),
its label one phrase; without the review's counts, "89.0% of approved values the same,"
over "read from the paper again" (three lines on the upright loop). No station's
name and numbers come within 12px of another station's,
the track, or the chips and their lines, also in a wider font (Linux Chrome): on
the wide loop CatLog's stand up and left of its dot, clear of the arc, Rules
updated sits near the lower straight's left end and Human check right of its
middle, so Human check's lines start well below CatLog's and its last line is
far from Rules updated's name; on the upright loop AI check stands higher than
Human check, Human check's lines end on the straight part well above CatLog's
name, and a drawn line longer than 23 characters (16 for CatLog's, in the lower
arc) breaks at a space. Small dots move round the track (SVG animateMotion),
not drawn for prefers-reduced-motion. Its text is on the type scale (station names 16,
numbers 13, chips 14; upright 14 and 12) and the caption 13px like Stats'; the
chips leave the status navy and the comparison brown to their own meanings, and
a focused chip gets a 2px accent ring set apart from it. Pointing at a person or
agent, on the figure or in the legend under it (People and AI agents, one
plain phrase each and where they work, in the loop's order), or focusing a chip, lights their stations and fades the
rest. Each legend line starts with a filled 10px swatch in its chip's outline colour, as Stats' legends are drawn (a
grey dot for a person, an accent square for an agent; hollow marks read as unticked radio buttons and checkboxes) and is a toggle button (aria-pressed, named by its phrase,
where they work as its description): a click, tap, Enter or
Space keeps its stations lit until it or another line is pressed, so touch
screens can light them too. The drawing is named by aria-label, not a <title>
(a tooltip over the whole figure), and a station's label reads a number wrapped
onto two lines as one phrase. Below 960px the loop stands upright (the people and agents are in the
legend beside it, under it on phones; its viewBox is cut to the drawing, 320px
wide at most) so its labels stay 12px or more down to a 320px phone; its caption then says the list tells where each one works, instead of
asking to point at people the drawing does not show. Printed, the wide loop with its people and agents stays whole on one
page and the legend follows in two columns. The Guide's method section links
to it.

Not reviewed is the label for the legacy mathematically_inferred record status
(labelled Pre-review until October 2026): the importer also used it for
source-derived records. Do not describe every value in that group as
calculated. A calculated ratio field is separate from record acceptance;
changing these labels must not alter the scientific data.
