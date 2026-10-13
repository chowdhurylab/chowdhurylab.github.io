# CatLog Public UI

Browse is the working table. Keep its header, search, compact counts, filters,
record drawer and downloads intact. Stats is a separate page, not a drawer or
expanding summary that takes space from the table.

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

Order: the title (24px) with the snapshot line, then the lead (the agreement
with human reviewers, first on the page: the user's headline success measure),
then two headline lines (32px: Records, Accepted with its share, Read from the
paper by CatLog with its papers, Human-checked; 20px: Papers, Enzymes, EC
numbers, Organisms, Substrates; 24/18px on phones), then numbered figures and
tables on a 12-column grid (max 1200px, gap 24px), two to a row from 1024px (an
odd one out spans the row; a bar chart that spans it keeps its labels within
240px of the bars; from 1024 to 1279px Figures 1 and 2 take a row each, so the
legend table keeps its room beside the donut), one below:

- Lead (`#statsLead`, above the headline counts, full width): Agreement with
  human reviewers, the success measure (the user, 2026-10-12), from
  `overview.quality.agreement` (catlog-v2
  human_review.AGREEMENT_DEFINITIONS; `build_overview` copies the fields listed
  in AGREEMENT_FIELDS). The headline is `first_agree_unexposed_pct` (the first
  comparison on papers CatLog read without database or earlier-catalog values
  in view) when present, else agree of values_approved; under the number its
  95% range when `first_agree_unexposed_ci95` gives one ("95% range
  79.7–90.6%", also in the sentence and the Guide), then what it counts ("of
  the values human reviewers approved are the same in CatLog", or the same
  value at the first comparison on papers read without database values in
  view); the blind paper count is `papers_unexposed` when present. Then one
  sentence, a
  100% bar of the approved values (the same value, then the differences as
  CatLog's own check against the paper split them: CatLog right, the same
  printed value under another name or rounded, left out by its reading rules,
  CatLog wrong, not checked yet) with its legend (a zero count has no segment
  and no row, except CatLog wrong: its 0 is a result), the facts (values
  approved, first comparison and now after fixes when present, differences
  checked against the paper with CatLog wrong in them ("152 of 257; CatLog
  wrong in none"), the errors the first
  comparison found ("68 wrong labels, 1 missed value, 0 wrong numbers or
  units", from `first_catlog_errors` and its split), fixes said against them
  ("all 69"), wrong number or unit in CatLog, missing values reviewers named),
  where the paper shows CatLog
  right what the earlier catalog had wrong (its value not printed in the paper,
  or a wrong label: the README's split), the values reviewers called
  wrong (the ones CatLog did not have and the ones it had with the same
  number, then what became of the latter: kept or dropped by an AI audit,
  found right against the paper, changed since, not settled; zero parts left
  out) and the direct review of CatLog's records when their counts add up
  (objections that dispute no value shown are said apart, never as failures), a
  data line with the definitions, and links to the Guide's method and to Team.
  No agreement counts, no lead.
- Figure 1, Review result: a donut drawn at 200px (outer r 88, inner r 56, 12 o'clock,
  clockwise, 1px white gaps, the total in the centre; the one partition that is
  a true whole) beside its legend table: Accepted (split in the rows under it:
  read from the paper by CatLog, earlier catalog as printed, after a
  correction, every value approved by a human reviewer; the split in words is
  the row's title), Not confirmed, Not checked (Unverified and Not reviewed
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
  `main_sources` draws the same groups from the source_db counts, unsplit.
- Figures 3-5 when `overview.quality` holds `db_compare`, `earlier_corrections`
  and `replaced` (counts the CatLog side computes; whole counts only, checked
  to add up): values read from the paper against the databases (same number,
  a different number, no database value; the caption says only the paper and
  parameter are compared and a different number is not a database error; its
  data line names the papers the databases miss, "For 9 papers no database
  lists any of the parameters CatLog read from them; for 171 more, the
  databases list some of them but not all", leaving out a count of zero),
  the corrections on records accepted after a correction (rounding, a
  different number, unit or magnitude, added) and the earlier records of
  papers CatLog has read (same number in CatLog's reading, not found). 100%
  bars per parameter with reference lines at 25/50/75/100% and the shares
  under them. Absent counts: no figure and no heading. Captions never seem to
  contradict the headline: figure 5's papers are those CatLog has read that
  the earlier catalog also had, figure 3 says for how many papers no database
  lists any parameter CatLog read and for how many it lists some but not all,
  and figure 4, when its record count is not the snapshot's count of records
  accepted after a correction, names both (with the date it was counted).
- Table, Checks on the values: second AI check (records read from the paper),
  AI audits, the reviewers' approved values, human-checked records, the human
  review of the earlier catalog (the share correct always beside the label
  errors); a row whose numbers are missing is left out. Its bars are grey
  (--bar-neutral), as in the other tables; when the lead gives the first
  comparison, the reviewers' row says its count is now, after fixes.
- Enzyme classes: records bars (light) with the accepted drawn over them.
- Value ranges (full width): per metric in catalog units (kcat s⁻¹, Km mM,
  kcat/Km s⁻¹ mM⁻¹) the median, the 10–90% range and a histogram per power of
  ten whose end bars hold every value beyond them; values without a recorded
  unit or in another unit are left out; the 10–90% bounds have two significant
  figures.
- Tables: Most common organisms and Most common EC numbers (top 10, the EC
  with the enzyme name its records use most, bars against the largest), What
  the records contain, then Wild type and variants above Cautions in one
  column. A closed "How these numbers are counted" ends the page.

Figure style: every figure and table has a heading (18px), the plot, then
"Figure N." or "Table N." (numbered in reading order, figures and tables
apart, so without figures 3-5 the next figure is 3) with one sentence (13px) and a 12px data line (snapshot, Data ID,
definition). Bars 16px thick, 8px apart, square ends; fills at 60% of their
colour with a 1px opaque outline; legends inline above the plot with 10px
swatches in segment order (a name that wraps keeps its count right after it);
one shared scale per chart with axis ticks of
three to five whole steps (1, 2, 2.5, 3 or 5 × 10ⁿ), each label centred on
its tick, the end one too, so they sit evenly (a narrow axis keeps 0, the
middle and the end of five ticks); no gridlines except 1px reference lines. Category labels 13px, value labels and ticks 12px, tabular
numbers. Table rows 13px with an 80px bar (48px on phones); the counts
right-aligned under their headings. Colours are tokens: review results
(--st-accepted navy, --st-pending salmon with its ring, --st-unverified slate,
--st-not-reviewed tan, --st-disputed red), comparisons (--cmp-same green,
--cmp-differs brown, --cmp-new cyan; the same colours compare CatLog with the
reviewers in the lead), kinds of change (--chg-precision mint,
--chg-magnitude red), --bar-neutral for single-series bars and amber only for
cautions. No gauges, completion bars or confidence scores; the review-result
donut is the only ring. Markup (a deliberate change from the design spec's
inline SVG with role="img" for every figure): the donut is an SVG image
(role="img", its summary in aria-label, a title per part) and each value-range
histogram an image with its summary in aria-label; bar charts and table bars
are HTML in a `<figure>`, so their names stay links into Browse that a keyboard
reaches and every count is text a screen reader reads row by row and a viewer
can copy. On phones each name sits above its bar. `@media
print`: one column, no figure or headline count split across pages (the three
value-range histograms stay side by side on any paper size, so their caption
stays with them); bars, swatches and columns print in their colours even with
the browser's background graphics off.

Review result lists each record once, in the words Browse uses: Accepted (the
rows under it split it into the records read from the paper by CatLog and the
earlier catalog's, as printed, after a correction or on a human reviewer's
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
record whose mark is checked (looked up as the badge does); papers are
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
agents at AI check, Audit agents at CatLog; navy rectangles), people below
(Supantha at Rules updated, also lighting Papers, CatLog and Website; Aarna and
Erin at Human check; Mohammad at The paper; brown pills). First names only: no titles, ranks, model or vendor
names; individual review decisions stay anonymous. Live numbers at the
stations come from the manifest (papers read and records at AI reading,
values re-checked by AI audits at CatLog, human-checked records and the
agreement headline at Human check, records at Website), each left out when
its field is absent. Small dots move round the track (SVG animateMotion),
not drawn for prefers-reduced-motion. Pointing at or focusing a person or
agent, on the figure or in the legend under it (People and AI agents, one
plain phrase each and where they work), lights their stations and fades the
rest. Below 960px the loop stands upright (the people and agents are in the
legend beside it, under it on phones) so its labels stay 11px or more at
375px. Printed, the wide loop with its people and agents stays whole on one
page and the legend follows in two columns. The Guide's method section links
to it.

Not reviewed is the label for the legacy mathematically_inferred record status
(labelled Pre-review until October 2026): the importer also used it for
source-derived records. Do not describe every value in that group as
calculated. A calculated ratio field is separate from record acceptance;
changing these labels must not alter the scientific data.
