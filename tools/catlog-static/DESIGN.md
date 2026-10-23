---
name: CatLog
description: A compact enzyme kinetics workbench for reading records, their values and their sources.
colors:
  background: "#ffffff"
  surface-2: "#f6f8f7"
  text: "#172120"
  text-2: "#3d4845"
  muted: "#5c6865"
  line: "#d3dcd7"
  line-soft: "#e7ece9"
  accent: "#172120 (ink: links with a quiet underline, buttons, the focus ring, selection; no data meaning)"
  accent-hover: "#3d4845"
  accent-tint: "#eef1f0"
  accent-line: "#aebdb7 (link underlines, control outlines)"
  bpg-navy: "#3C5488 (Accepted)"
  bpg-salmon: "#F39B7F (Not confirmed; ring #c4664a)"
  bpg-slate: "#8491B4 (Not checked)"
  bpg-deep-red: "#DC0000 (Disputed)"
  bpg-cyan: "#4DBBD5 (CatLog's reading of the paper; ring #2DA1BD, text #207286)"
  bpg-green: "#00A087 (agreement: Same number; human-checked text #007664)"
  bpg-mint: "#91D1C2 (the same number in another form; ring #45A48E)"
  bpg-brown: "#7E6148 (Different number)"
  bpg-red: "#E64B35 (a correction: Corrects a value, unit or magnitude)"
  bpg-tan: "#B09C85 (caution; ring #8c7a64, text #79654F)"
  status-accepted: "#3C5488"
  status-pending: "#F39B7F"
  status-pending-ring: "#c4664a"
  status-unverified: "#8491B4"
  status-not-reviewed: "#8491B4 (Not checked is one colour)"
  status-disputed: "#DC0000"
  source-paper: "#4DBBD5 (Read from the paper; its text #207286, its 12% tint #eaf7fa)"
  human-checked: "#007664"
  caution: "#79654F (text); caution-mark #B09C85, caution-ring #8c7a64"
  caution-tint: "#f8f6f4"
  caution-line: "#dbd2c8"
  caution-ink: "#4a3b2a"
  compare-same: "#00A087"
  compare-other: "#91D1C2 (ring #45A48E)"
  compare-differs: "#7E6148"
  compare-new: "#4DBBD5 (ring #2DA1BD)"
  change-magnitude: "#E64B35"
  change-precision: "#91D1C2"
  bar-neutral: "#7d8885"
  src-paper-line: "#278CA4 (CatLog's line in CatLog and BRENDA by publication year: 3.9:1 on white, 3.4:1 on the band)"
  plot-band: "#eef1f0 (a plain grey band behind years a figure sets apart; no data meaning)"
  filter-groups: "the accent (ink #172120): the filters with no meaning colour"
  enzyme-class-1: "#E64B35"
  enzyme-class-2: "#4DBBD5"
  enzyme-class-3: "#00A087"
  enzyme-class-4: "#3C5488"
  enzyme-class-5: "#F39B7F"
  enzyme-class-6: "#8491B4"
  enzyme-class-7: "#7E6148"
  database-brenda: "#3C5488 (categorical, for a figure whose only series are the databases; none yet)"
  database-sabio-rk: "#E64B35"
  database-oed: "#00A087"
  database-uniprot: "#8491B4"
  database-skid: "#B09C85"
  database-strenda: "#7E6148"
typography:
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif'
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
    letterSpacing: 0px
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
  table:
    fontSize: 13px
  scale: 12/16, 13/18, 14/20, 16/24, 18/24, 20/24, 24/28, 28/32, 32/36, 40/44px (size/line height)
  weights: 400, 500, 600
  numbers: tabular-nums lining-nums
spacing: 4, 8, 12, 16, 24, 32, 48px
radius: 4px (controls and cards), 2px (Stats bars' outer ends), 0 (table bars)
layout:
  header: 56px
  counts-band: 109px (an 18px line over a 74px hairline card; 129px on tablets, a 94px card; 163px on phones, a 106px card)
  gutter: 24px (16px below 1024px)
  sidebar: 256px (to 1439px), 288px (1440px and up); rail 48px
  record: 440px (1024-1439px), 480px (1440px and up)
---

# CatLog

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

## Layout

Start with the table, not a landing page. The page is one grid on a 4px spacing
scale with 24px gutters (16px below 1024px): a 56px header, the counts band (a 74px card from 1024px),
then [filter sidebar | table | open record]. Rules are 1px --line between regions
and --line-soft inside them; a crisp, short shadow (--shadow, 2px 8px) only where something floats above the page:
menus, dialogs, the phone sheet, the record drawer and Stats' tooltip line. Round 14 (the user's colleague: "it looks a
bit AI-ish, with the glow"): a calm, editorial look, like a scientific reference database (UniProt, PDB, a Nature data
page), never a product landing page. No glow, halo, text-shadow, wash or gradient anywhere (round 13 had them on the
counts band, Stats' headline band, its numbers, the lead of Quality (now a sentence and a table), the figure fills and the marks under the pointer):
the counts band and Stats' headline band are plain white cards with a 1px --line hairline and a 4px radius; their key
numbers lead by size, weight, tabular figures, the whitespace round them and each number's meaning colour, and they
never move (no fade or rise). Figures fill flat (the colour at 60% with a 1px opaque outline); a mark under the pointer
takes a 2px outline in its own colour while the others dim. Cards have a 4px radius (no 8-10px rounding), Stats' part
numbers are plain muted figures (no disc), and the Guide's "Then checked again" box is a hairline box (no dashed line,
no wash). The functional patterns stay: the hatched end stubs of the value curves, the density key's ramp and the
legend swatch that draws the read-from-the-paper stripe.
Stats, the Guide and Team scroll inside their own view under the header; the
document itself never scrolls (each view is positioned, so screen-reader-only
text deep in a page cannot reach past it).

The header is one 56px line from 1024px: brand ("CatLog", enzyme kinetics
catalog), the catalog's tabs Browse · Stats · Guide · Team, the links out set
apart by a thin rule, the search box (at most 560px) and Download. From 1024 to
1439px the brand drops its tagline and the links out read "Paper ↗" and "Lab ↗",
so the search box keeps room for its placeholder. Tabs are 14px/500, the current
one 600 with a 2px accent rule under it.

The counts band (round 13) is the first thing a visitor sees: a focal point like Stats' headline band, a step
quieter. Over the card, one plain 13/18px --text-2 line says what CatLog is ("Enzyme kcat, Km and kcat/Km values, being
read from their papers.") and links the Guide ("How it works →"); round 15: it no longer repeats the band's numbers (it
had said "75,000 of 185,804 read from their papers so far" right over the same two numbers), and never "re-checked
against their papers", which 60% of the records are not yet. The snapshot date (12px --muted, its title the Data ID)
ends that line at the right, its right edge on the card's (a float after the words, inside the line's own box; on a
phone it takes the end of the second line). One line from 641px, two on phones, left out on a short window wider than a
phone (max-height 640px) so the table keeps its 340px. Where that line has no room for the date, the card's copy of it
(#snapshotDateCard, the same text and Data ID title; only one of the two is ever shown) ends the parameters' line:
on tablets, in a short window (from 1100px after "records with each parameter ·", below that alone: in DejaVu Sans the
whole line needs a 1048px window) and, under More, on a phone narrower than 360px (on its own line). Inside the band (6px
above and below, the page's gutter at the sides) a white card with a 1px --line hairline and a 4px radius (no glow,
wash or shadow) holds one even row (round 15, the user: "the screenshot segment could still be improved": half of
round 14's card was an empty gap before the date, the band looked left-heavy, the three stacked With counts read as a
cramped mini-table and the key numbers carried no context). The four key numbers, Records, Accepted, Read from the
paper and Human-checked, then the parameters, in five columns as wide as each other (minmax(max-content, 1fr): never
narrower than their words, so at 1024px the parameters take more); type set in columns, not tiles: one 1px --line-soft
rule, before the parameters, none between the key numbers (round 15's judges: five hairline-boxed tiles each with a
label, a big number and a caption are the stock KPI strip). Each count keeps the room of a seven-character number
(min-width 7ch from 641px), so a filter that changes its digits never moves the columns: the rule stays put within 1px
between an unfiltered view and #browse?source=paper. Every cell has the same three lines, a subgrid of the card's rows,
so the labels, the numbers' baselines and the lines of context each run straight across the band: a label (13/16px,
--muted, every label alike), the number (600, tabular): 28px on a 28px line from 1024px (digits have no descenders; the
card is 74px, 12px taller than round 14's for the added line), 24/24px on tablets (641-1023px), 20/24px on phones, and
one 12/16px --muted line of context, a fact from the snapshot or the results (bandNotes): Records "41,218 papers" (the
papers these records come from), Accepted "43.5% of records", Read from the paper "40.4% of records · 4,324 papers"
("40.4% · 4,324 papers" below 1280px, where "of records" is left to screen readers; only "4,324 papers" when all the
results are read from the paper; its title "40.4% of the records, from 4,324 papers"), Human-checked "2.1% of
accepted" (Stats' wording; human-checked records are accepted ones; the definition stays in the link's title). Shares
(bandShare) have one decimal, "100%" and "0%" only when exact, "<0.1%" and ">99.9%" at the ends, never a rounded 0.0% or
100.0%; a count of 0 or a dash has no line, and while a filtered view's records load no line shows at all (the counts
are the snapshot's then, the filter's not known yet). Papers: the snapshot's summary.overview.papers and
from_paper.papers unfiltered; on a filtered view counted in the page from the index as the builder counts them
(scripts/build-catlog-followup-summary.py paper_keys: a record's PMIDs, else its DOIs), once per results list, and only
when the same count over every record gives the snapshot's own two numbers (an index without paper fields, or a record
the builder counts by a stand-in NP id the index does not carry, leaves a filtered view with the share alone: never a
false "0 papers"; on 2026-10-18's snapshot, which has no stand-in NP ids, the page's counts equal paper_keys' for every
record, and in the page for alcohol dehydrogenase, EC 3, BRENDA, UniProt, Homo sapiens and Read from the paper in EC 1). The lines of context are aria-live="off", so a filter change announces the counts, not every
line. The parameters' cell gives kcat, Km and kcat/Km each as a label over its count (16px, 500, --text-2, on a 20px line
so on the key numbers' baseline it keeps their 28px row) and "records with each parameter" under them. Each key number wears
the colour its meaning has across the site (Type And Color, "Colour meanings") and the colour is otherwise only on
the mark before its label (round 14: the teal accent, a cyan label and a green label had read as one teal family):
Records the page's ink (--text), Accepted the status navy (--st-accepted) with the status dot, Read from the paper the
darker BPG cyan (--src-paper-ink) with Read from the paper's mark, a BPG cyan square ringed #2DA1BD (the same mark goes
before the table's "from paper" tag, the record's, its chip and the Guide's legend; Source's title wears it while it is chosen, its option none, so the label keeps one line), Human-checked
the darker BPG green (--checked) with the green tick; no text-shadow. Stats' band does the same for Accepted and Read
from the paper. From 1024px up this is one row that never wraps or moves as the window widens or the filters change.
Tablets (641-1023px): two rows, the key numbers with their lines of context, then the parameters on one line ("With
kcat 104,525 Km 166,603 kcat/Km 71,218", 12/16px) and the snapshot date at its end (the line's last item, pushed right),
one height (a 94px card) across the range. Phones: the four key numbers two by two (Records and Accepted, then Read
from the paper and Human-checked), More at the first row's right; More shows their lines of context and the parameters
(each label over its 14px count, under a thin rule across the card), rows that exist only while shown; an 8px card
padding (the band is 163px at 375px, 6px shorter than round 14's). Read from the paper keeps its whole label down to
360px and takes its short tag, From paper, below it (a screen reader still reads Read from the paper). Printing keeps
the line over the card, the snapshot date with it. A filtered view says "Matching records". Read from the paper N (the name Stats and the Source filter give that count; its title
says "Show the records read from the paper by CatLog") links to those records (#browse?source=paper plus
the filters set now, from page 1); N is the snapshot's
summary.overview.from_paper.records on an unfiltered view until the records
load, then the count among the current results; 0 is plain text. Human-checked N is a link to those records
(#browse?checked=1 plus the filters set now, from page 1); N is the snapshot's
summary.overview.human_checked_accepted (only when it is bound to this
snapshot, as Stats checks) until the records and marks load, then the count
among the current results; a filtered view shows a dash until the marks arrive,
N = 0 or a dash is plain text, not a link, and the item is hidden when the
snapshot has no such count. Counts follow the current filtered
results; measurement coverage overlaps and must not form a stacked chart. The
count beside Filters is shown only when it says more than the page range.

Export results (a menu beside Sort, "Export" on phones, opening to the right)
offers "All N matching records", "This page" and "This page in full", each in the Download menu's pattern (round 15
polish: the Export menu had put the format in the name): the name, what it holds, then its format, CSV or JSON, on a
muted line of its own.
The CSV is built in the page from the loaded index, a slice at a time: the
table's columns with their units and stored digits (the pH too: every digit the record keeps, a trailing zero
dropped, 7.25 never 7.3, as the table note and the record show it; formatPh), the condition note under the
substrate (condition_note, so look-alike records of a paper stay apart), review result (the exact
value), human-checked, source (named as the JSON and Download record name it: "CatLog (read from the paper)" for a
record read from the paper by CatLog, otherwise the databases by name, "Open Enzyme Database (OED)"; the field names
stay), PMIDs, DOIs, UniProt ID and record ID, one line
per record (RFC 4180, UTF-8 with a byte-order mark; a cell a spreadsheet would
read as a formula starts with an apostrophe). The JSON page export keeps every
field from the records' detail files. Files are named catlog-<snapshot
date>-results.csv, -page-N.csv and -page-N.json.

Expanded counts separate review status from saved source material. Show the
denominator, record count, and share in aligned tables. Each record belongs to
one category per table; source categories follow the stored evidence precedence,
not an acceptance score. Explain the categories in a native disclosure. Keep
the bottom page controls compact, with page size left and navigation right.

Filters are a persistent sidebar, a grid column left of the table and never
over it, and the results follow each change (no "Show N records" button beside
the table). From 1200px it is open by default (256px to 1439px, 288px from
1440px); from 1024 to 1199px it starts as the rail, because the table's columns
do not fit beside it. « in its heading collapses it to a 48px rail, a tall "Filters"
button set vertically with the active-filter count. A viewer's choice that
differs from their width's default (collapsed from 1200px, opened below) is kept
in their browser (localStorage, optional) and applies at every desktop width;
going back to the default forgets it. From 1024 to 1599px an
open record takes the sidebar's place: it becomes the rail and comes back where
it was when the record closes (opening it closes the record); from 1600px the
sidebar, the table and the record sit side by side. From 641 to 1023px it starts
as the rail and opening it pushes the table (which scrolls sideways). On phones
(640px and below) only, the filters are a full-screen sheet that slides up:
"Filters · Clear all · Undo · ×" at the top (Clear all while a filter is on; Undo always, dimmed with nothing to undo,
right before ×, so Clear all coming and going never moves it under the finger; the sheet covers the chips, so their Undo
is here too, 13px like Clear all and 16px from it, none of them overlapping at 320px) and
"Show N records" (accent, 44px) at the bottom; Esc, × or that button close it, and Escape never closes the sidebar.
A control reached with Tab or Shift+Tab scrolls clear of the sticky heading and
footer, focus ring included (scroll padding 56px at the top, 80px at the bottom
of the phone sheet).
Beside the open sidebar from 1280px the table fits, Review result always in
view without sideways scrolling: the name columns give way first to two lines
broken between words (a line may also break after a hyphen, comma or slash),
then to their minimums (Enzyme 136px, Organism 108px, Substrate 112px; a word
longer than its column is hyphenated; Organism last, as a capitalized genus
breaks without a hyphen), and last Review result's tag line ends
in "…" (never its word). Only a table that cannot keep Review result in view
even then (beside a record from 1024px, on a tablet with the sidebar open)
scrolls sideways; its names then narrow only to their longest word, so Enzyme
stays narrow, with the Columns control (‹ › step one column), Enzyme kept in
view and edge shadows drawn over the rows inside the visible area (beside
Enzyme, before the vertical scrollbar). The
sidebar has a sticky 48px heading ("Filters" 14px/600, the count, Clear all
while a filter is on, «; its Undo shows only in the phone sheet: beside the sidebar the chips' Undo is in view, and a
wide font has no room for both in 256px);
its groups are native disclosures with 13px/600 summaries (13px 16px, 44px for
one line; the chevron and any "?" stay level with the title's first line when a
wide font wraps it), a soft rule between them, options in 28px rows (14px box, 13px label, the 12px --muted
count at the right; a label a wide font wraps takes a second line, box and count
on its first, and never runs into the next row) and 32px fields, their labels in
a column as wide as the longest. The sidebar is compact (the user, 2026-10-13):
one short line per option and no help paragraphs; a group with explanations has a
24px round "?" beside its chevron, 46px from the group's right edge (on phones and touch screens a 44px target: its hit
area reaches 10px round the circle, inside the 44px title row and 7px clear of the chevron); the title stops 4px before
it, so a long title in a wide font wraps instead of running under it (until round 13 it could run 6px under it) that shows them in a quiet --surface-2 box under
its title (and hides them again); opened near the foot of the sidebar or the phone sheet, the sidebar scrolls just
enough to keep the group's options in view, never taking its title under the sticky heading. The panel order (round 13; the user, 2026-10-18: "too many options and a bit confusing instead of easy to use, to the
point and what the user might want"): in view, the filters most visitors use, each with a short label and its count:
Enzyme, organism, substrate (labelled fields, Enzyme first, then EC number, Organism and Substrate; the EC field's
example "e.g. 3 or 1.1.1" and its title say that a class, a subclass or a full number lists every enzyme under it; the
only group without a "?": its fields are labelled and a "?" would wrap its long title at 256px), Parameter (round 17; Measurement type until then: Has kcat, Has Km, Has kcat/Km; its "?" says that ticking several shows records with all of them), Review result (Accepted, Not
confirmed, Not checked and Disputed, each after its status dot, the boxes neutral as everywhere in the sidebar (round 15
polish: one pattern, the option's own mark between box and words, the dot, square or "!" in the square's 10px slot, so
the words of Review result, Compared with databases and Cautions start at one edge); "Only
human-checked" sits under Accepted (shown as the green "✓ human-checked" tag, read
out "Only human-checked"; a wide font in the 256px sidebar breaks it after the
hyphen, never into its count), and ticking it ticks Accepted;
its count waits for the review marks; unticking Accepted unticks it; its "?" gives
the four results and human-checked in one short sentence each, "Accepted — read
from the paper by CatLog, ...", a dash after the result and the sentence in lower case after it, never
"Accepted: Read from the paper:"; every group's "?" (Source, Compared with databases, Cautions too) gives a name, a dash
and its definition this way, the definition in lower case unless it starts with a name such as Km or CatLog
(aboutDefinition; round 14) (each option's
title has the full definition) with a link to the Guide's #guide-status, where
the tags are defined, so the box stays small and the options stay in view); then one "More filters" disclosure, closed
at rest, holding the specialist groups, first Source (round 14, the user 2026-10-20: "the filter section source can go
to the extra filter instead of one of the main points"; three
radio buttons: All records, Read from the paper and Not yet re-read: each record labelled by what happened to it, with
CatLog the one name (the user, 2026-10-13, round 8; never v1 or v2; "re-read" never breaks at its hyphen: Stats'
figure titles, captions and tables, the Guide and the sidebar's "?" boxes keep it in a nowrap span); each label on one line beside its count in the
256px sidebar, also in a wide font (DejaVu Sans) beside a six-figure count: the sidebar's scrollbar is thin and a
radio's count may come 4px closer to its label than elsewhere); its "?" says what each is ("Read from the paper: by an
AI model; a second, separate AI check compared each value with the paper." and "Not yet re-read: from CatLog's earlier
version, which started from enzyme database entries and checked part of them against their papers; when CatLog reads
a paper, its records replace these.", never that every such record was checked; each radio's title says the same,
Read from the paper's as the method's short form) and links to the Guide's #guide-method; the databases of Not yet
re-read are their own group, Source database, last under More filters; Source keeps its group dot (its chips' colour) and is
open inside More filters), then Wild type or variant (its "?" says what the form is and how many records state neither, "1 record does not ...",
the line hidden when none) and Assay conditions (temperature °C and pH, from and to, either may be empty; a bound that is not a number is outlined and
ignored; the count beside each is the records that give one, as its "?" says), open inside it like Source, then Compared with databases (shown only when the snapshot carries the comparison:
the record index's optional database_summary, one number per record that
scripts/build-catlog-viewer-index.py takes from the Table download's database
fields or the Full data download of the same records (where the CatLog side's
export puts them: each proof line's database_status, an earlier corrected
record's corrections list; a Table field of the same name wins), the per-value
database_status, a record summary or the corrections list; never an empty heading; round 9 brief section 3), in Stats
Figure 7's order (round 14's fix pass: one order for the results everywhere, the sidebar, the Guide's legend and its
Results table): All values the same (every compared value), Same, other label, Corrects a value, Different number (the
cause not yet known; a value a database lists at an exact factor nothing has yet checked against the paper is
"Different number (exact factor, not yet checked)", under it, never a correction: its definition says so and names the
factor), Not in the databases (a value no compared database lists) with "every value" nested under it (no database
lists any value of the record), then under a --line-soft rule Corrected earlier (records not yet re-read
whose earlier version changed values; shown only when a record has it). A 10px square in the result's colour
(--cmp-same, --cmp-other, --chg-magnitude, --cmp-differs, --cmp-new; the light mint and cyan with a 1px darker ring;
aria-hidden) stands before each name but
Corrected earlier's, which keeps its room (its words in line). The counts at rest equal the manifest's summary.database_comparison: records_with_kind
(corrected, differs, other_label, new), records.every_value_new and records.every_value_confirmed; each option's
title is its definition, plus "N values in M records." where the manifest counts both. Each result has one name
(DATABASE_RESULT_NAMES), the same in the option, its chip, a record's result word and its links to records like
it; the top-level names keep one line beside a five-digit count in the 256px sidebar with a wide font (DejaVu
Sans), also beside an 11px scrollbar (Chrome on Linux and Windows): the square sits 6px after the box and 4px before
the name, the count comes 6px closer (the counts stay in line with the other groups') and the names are set 1px
tighter between words and 0.01em between letters; "every value" may wrap. A record matches any option ticked, except that "every value" narrows Not in the
databases: ticking it ticks that too, unticking that unticks it, and the pair is one chip, "Not in the
databases: every value", that removes both. The "?" names the databases compared from the manifest (its
sources list, else the databases values_by_database counts, else BRENDA, SABIO-RK, OED, SKiD, STRENDA DB and UniProt; each
name kept whole on one line) and gives each option's definition. In the phone sheet the group's rows are 44px. Address key
db=corrects,differs,other_label,not_listed,all_not_listed,all_same,earlier; earlier addresses keep their records:
adds is not_listed, new is all_not_listed (with not_listed) and same is all_same), Cautions (grouped as the "!" notes, each caution after the
table's tan "!" disc (No cautions none, its words in line), the title with no dot (round 15 polish: a lone tan dot had
hung off it in the gutter, read as an "active" sign, whatever was chosen); its "?" gives each caution's definition, the option's title, "label — definition"
as Review result's does, and links to the Guide's #guide-cautions) and Source database (the databases of Not yet re-read: BRENDA, SABIO-RK, the Open Enzyme Database as "OED", the table's
tag, read out and on hover in full, UniProt, SKiD, STRENDA DB, earlier paper extractions, shown as "Earlier extractions",
the table's tag, and read out in full, so a wide font keeps it on one line at 256px, and Source not recorded; ticking one
selects Not yet re-read in Source, a merged record counts under each database it names, and All records or Read from the
paper clears them; its "?" says so; like the other filters without a meaning colour it has no group mark and its chips no mark), these three closed. More filters
opens by itself when one of its filters is set (an address, Back, a link from Stats or a record, Undo), each group with
one set opens too, and nothing in it is ever set unseen: its title (a group title in the accent colour, its chevron too,
with a --line-soft rule under it when open) carries the count of those filters' chips in the Filters badge's look (the
chips of source (Read from the paper, Not yet re-read or a database), variant, temperature, pH, db and caution;
MORE_FILTER_PREFIXES), read out "More filters, 2 active", shown open or closed; its title's tooltip names the groups, and while it is closed a muted 12px line under its title says what is inside, "Source, variant, assay and more" (round 14's fix pass: a newcomer could not see that Source had moved in; aria-hidden, as the groups follow it). A group or More filters opened by its title near
the sidebar's foot (or the phone sheet's) scrolls just enough to show its options, as a "?" does, never taking its title
under the sticky heading; one opened by an address leaves the sidebar where it is. No help text is in view: every
group but the enzyme fields has a "?", and each note (Parameter's, the records stating no form) is behind it.
At 1440 x 1000 the three groups and More filters' title show without scrolling the sidebar (measured on the Oct 15
snapshot: before round 13 eight groups, "By database" and 28 controls took 1,445px, 19 controls in view; round 13's four
groups and More filters' title, 15 controls, took 792px, all in view; in the 375 x 812 phone sheet 1,513px became 792px,
More filters' title just under the Show records bar; round 14 moved Source's three radios under More filters too). The
phone sheet is the same panel, so Source is under More filters there as well. All 41 controls are kept; every address,
chip, sidebar dot and Undo is as before: an address or link with source= (the counts band's Read from the paper,
Stats, a record) opens More filters with Source in it. Every option shows how many of the current
results it covers, counted with its own group set aside (so ticking it shows, or
adds, that many); an option at 0 is grey and stays clickable. Before the record
index arrives, Review result, Parameter and the three Source choices show
the snapshot's own counts (Read from the paper is the counts band's figure,
Not yet re-read the rest), the other options a dash. The counts are
worked out after each change in idle moments, in slices (never while typing),
and a newer change restarts them (a view returned to within a moment shows its
counts at once and drops the count still running for the view left, so an older
count never overwrites a newer one); meanwhile the panel is marked busy
(data-counts="pending", aria-busy) and the numbers fade if that takes a moment. Each active filter and the search is a chip
above the table that removes it, in the sidebar's words ("Source: Read from the paper", "Source: OED", "Source: Earlier
extractions", read out in full as the sidebar reads them; an EC class "EC 1", as Stats names it, without the address's
trailing dot). Every chip says its group (round 15 polish: "Variant", "Corrects a value" and "T 20–30 °C" had stood
bare beside "Review result: Disputed"): the group's name first (Review result, Source, Caution, Databases, Enzyme,
Organism, Substrate, Search) unless the option's own words say it (Has kcat, Wild type, Variant, Only human-checked, EC 1,
Temperature 20–30 °C, pH ≥ 7, Not in the databases) (round 17: the Guide no longer draws a chips sample); after Undo and followed by Clear all (with no matching
records, "Clear search and filters" takes Clear all's place, so the toolbar has one clear
button; Undo, Clear all here and in the sidebar's heading are 24px tall targets at
least); the count beside Filters is the number of chips. Chips are plain (round 14: a 3px bar, a 12% tint and a 45%
line showed one colour three times, the rounded-box-with-a-stripe template look): a 1px --line-strong hairline on
white, the words, and the option's own mark before its name in its meaning colour, which is where the colour coding the
user asked for lives (2026-10-15: "can the filters be different color or sth so that its user friendly to keep track to
undo"): a review result its status dot (Accepted navy, Not confirmed salmon, Not checked slate, Disputed deep red; a
chip naming several results names each after its dot, as the table does), Only human-checked its green tick, Read from
the paper its cyan square (Read from the paper's mark), a database result the sidebar's square (Corrects a value red,
Different number brown, Same, other label mint, Not in the databases cyan, All values the same green), a caution the
table's tan "!" disc at 12px. The filters with no meaning colour (Not yet re-read and a source database; the enzyme,
organism, substrate, EC number and search; the measurement: Parameter, Wild type or variant, Assay conditions;
No cautions; Corrected earlier) have no mark: their words are enough. A group's title in the sidebar has a mark (8px,
aria-hidden, hung in the 16px gutter so the titles keep their width) only where its filter has a meaning colour:
Cautions' tan dot, and Source's cyan square while Read from the paper is chosen; none beside the enzyme fields, the
measurement and Source database (round 13's dot there wore the accent: decoration once the chips lost their colour), nor
beside Review result and Compared with databases, whose options each have their own mark. The words read 15:1 or more on
the white chip and the × 4.5:1. Undo comes first in the bar whenever the bar shows, dimmed
("Nothing to undo") until a change of the filters reaches the results (a box ticked, a field typed, a chip removed,
Clear all, Back or a link that sets filters; never the address a page opens with); it then restores the set before
that change; the page keeps the last 30 sets, in this page only. Back or Forward that lands on the set Undo would bring
back takes that step off instead of adding the opposite one, so Back then Forward leaves one step, not two that undo
each other. Typing is one change, not one per pause: while one
text field (the search, EC, enzyme, organism, substrate, a temperature or pH bound) keeps changing, the set before the
typing began stays the step, so a word typed slowly goes in one press (a word typed and deleted leaves nothing to
undo); another change, Undo, Clear all, a chip, Back or leaving the field starts a new step, and a change the results
do not show yet (keys typed a moment ago, still in their 180ms pause, or a bound applied as it loses the focus to Undo)
is undone first, so one press undoes one change. Its button stays when the chips are redrawn, so a press a redraw falls
inside is not lost. It keeps its place however many chips there are, so
pressing it again undoes one more change and never lands on a chip or Clear all. It stays with no filter left (Clear all can be undone, the bar then holds Undo alone),
and after an Undo the bar keeps it, dimmed once nothing is left, so the table does not move under the pointer. Its name and tooltip say what it gives back ("Undo the last filter
change, back to Source: Read from the paper; EC 1.1"), the status line says "Filters restored: ..." and the focus
stays on Undo while there is more to undo, else goes to Clear all (the search box when no filter is left). Clear all
hands the focus to Undo, the likely next step (the bar's, or the phone sheet's beside it; the sidebar beside the table
keeps it), once the cleared results are kept; only with nothing to undo does it go where removing the last chip sends it. Sort, rows per page and the page are not filters: only
an undone Clear all gives back the sort it reset, unless the sort changed since. The chips and Undo wrap within the
toolbar at any width, each line starting where the chips do: Undo and Clear all stand 4px further from the chips than
the chips from each other, Clear all's room being the last chip's right margin, so a Clear all that wraps is not set in. Esc closes the panel (beside an open record, the one
holding the focus). Typing filters 180ms after the last key; the search text of
every record is prepared in idle moments once the search box or the filters
get focus.

Browse with filters has the address #browse?key=value&... (q, status, checked,
ec, enzyme, organism, substrate, metric, variant, tmin, tmax, phmin, phmax,
caution, db, source, sort, rows, page, record; comma lists; unknown keys ignored;
db only when the snapshot carries the comparison).
source=paper is Read from the paper (the older status=v2 opens it
too), source=databases Not yet re-read, and source=brenda,oed,... those
databases (earlier_paper, unrecorded and strenda included).
It is read on load and on Back and Forward, rewritten in place (never a new
history entry) when the filters, search, sort, rows per page or page change, and
gone when nothing is set, so a copied link opens the same records. An open
record is added after the filters (#browse?...&record=<key>, without page: the
record's place decides it), or is #record=<key> when nothing is set, so reload,
a copied link and Esc keep the filters. Opening a record from the list adds one
history entry (its state remembers the list's address), so Back, on a phone the
system's Back gesture too, closes the record instead of leaving CatLog; another
record opened from there (a link in it, ‹ or ›) replaces that entry, so Back never
steps through every record looked at. × and Esc step back over the entry while the list behind it is
the one it was opened from (else, and after a reload, the address is rewritten
in place); until that Back lands, a record opened meanwhile waits to write its
address and a tab or link followed meanwhile waits to add its entry. Leaving
an open record by a link in it, a tab or × keeps how far it was scrolled in its
entry's state ({key, top}), so Back or Forward to that entry opens the record
where the visitor left it; a new entry, another record in the entry and the
list's address drop it, and a record opened from the list or by a row starts at
its top. A record opened from an address (a link, a reload) adds no entry. An address without a
record closes the open one, and focus that was in the record goes back to its
row. Focus never falls to the page body: when the page does not show the closed
record's row (another page of the results, after its paper's link), × and Esc
put it on the results (the table's current row, or the table itself while it
shows none); a record closed while new filters' results are on their way gets
focus on its row once they are drawn, and focus in a record the new results
leave out goes to the results. A link to #browse?
from Stats or the Guide opens in the page without reloading the records. Rows
per page is remembered in this browser (localStorage, optional).

The search box's placeholder is short enough to fit on a laptop ("Enzyme, EC,
organism or substrate"); its accessible name says all it finds (enzyme, EC
number, organism, substrate, UniProt ID or PMID), and so does the line of
examples. Its "/" badge (the shortcut that focuses it) shows only where there is
a keyboard: a touch screen (pointer: coarse) shows none. Empty, it offers one fixed line of examples
("Try: hexokinase · 1.1.1.1 · Escherichia coli · NADH · P00330 · PMID
15989682"), each a search with results; the name fields offer three of their
own; nothing is drawn at random. The box is as wide as that line wherever the
screen has room (wider than its field); on a phone the examples wrap, with no
"·" left at a line's end or start. The examples are reached with the arrow keys
(Enter picks one) or a click, never with Tab: Tab out of the field closes them. Search matches every word in any order, ignoring case, accents, Greek letters
against their names (β = beta), µ/micro/u-, dash and prime variants, and
hyphens, spaces, commas or underscores inside a name (4-nitrophenyl = 4
nitrophenyl; a locant, a D/L/p/o/m/n prefix or a Greek name typed as its own
word joins the next). It also knows common species names (human, mouse, yeast,
E. coli), as does the Organism field, where a common name matches as a whole
word (rat finds rats, not Serratia); an EC number matches whole parts, so
1.1.1 is that subclass only and 1.1.1.1 never 1.1.1.10. EC 1.1.1.1, ec:1.1.1.1,
1.1.1.- and "1." (a class) work in the search box; the EC field takes any
number and several at once. A number also finds the records of
that PMID, and a DOI (in full or its beginning, with or without doi.org) those
of its paper: the index carries each record's PMIDs and DOIs from the Full data
download of the same snapshot. When nothing matches, the table names the
filters that are on and offers to remove the one set last that brings records
back (with how many) or to clear everything; a button too long for the table's
width wraps onto a second line inside it (at 320px "Remove Caution: Unit or
magnitude error (144 records)"), never past its edge. The header's tabs are the
catalog's own views, Browse · Stats · Guide · Team (#team, the people and agents
behind CatLog); Stats alone has a soft BPG-cyan glow behind its word (no animation; the site's one glow, so visitors
notice the Stats page; the user, 2026-10-21); the links out, "CatRange paper ↗" and "Chowdhury Lab ↗", follow
them, set apart by a thin rule. From 641 to 1023px the header is one grid on
every view: brand and Download, the tabs with the links out at the line's end
(Download ends where they end), then search (Browse only); on phones brand, the links out ("Paper ↗", "Lab ↗")
and Download share the first line (below 360px the header's gaps are 8px, so the two links keep one line at 320px;
only a wide system font puts them on two lines at the right, never over the brand), the four tabs share the second
across the
width, then search. The table's toolbar (48px) holds the active filters as chips
with Clear all at the left and Columns and Export at the right (when the
records are 721 to 1000px wide, beside the open sidebar or a record on a laptop,
Export drops "results" and the chips stay on that one 48px row
while they fit beside them; when they do not, they take the full width under it,
Clear all after the last, instead of a narrow column beside it, so none is cut;
a chip's tooltip names its whole filter); on phones a
Filters button opens the sheet and the chips go under the toolbar (Filters,
Export and Sort stay on one row: phones show cards without column headers, so a "Sort ↑" toggle, a tap reversing the
order, and a menu of the columns stand in for them; below 360px "Sort" is read out but not shown (its arrow stays, a
20px target), Export drops its chevron and the buttons and gaps are narrower, and to 389px with a filter on (the
Filters count) the buttons are narrower and "Sort" gives way to its arrow too, so the menu shows "Review result"
whole). A selected
record is a column right of the table from 1024px (440px, 480px from 1440px) and
a full-height dialog below. Never put details below the table or cover desktop
measurement columns. Keep 25 rows per page,
scrolling within the table, and the page controls reachable. An open record's
address names it (record=<record key>, replaced, not added to history, and
removed when the record closes), so it can be shared; opening such an address
shows the record on its table page once the index (and, with Human-checked on,
the review marks) has it, with its row scrolled into the table's view (only for
an address: a click leaves the table where it is), and a key the snapshot lacks
is put in the search box with a note that it is not there. New filters with the
same record open (its paper's link, Back from there) move the table to the
record's page too, never to page 1. Marks that arrive after a record opened redraw
its panel in place (the rows and focus stay).

While records load, placeholder rows keep the table's shape (a table with no
rows, loading or with nothing matching, keeps the stylesheet's column widths
unless those would leave Enzyme narrower than its heading, as beside the open
sidebar at 1024-1199px: then every column takes its minimum, at least its
heading, and the names share the rest) and, until the first
rows appear, the count beside Filters says how many have loaded ("Loading
records…" when only the files are counted). Loading and failure notices use
plain words, never file, shard or chunk names: a page older than its data says
"This page is out of date. Reload to update it."; the technical detail goes to
the console. Page 1 appears
from the first rows of the index, which arrives in the default order, and
stays in place when the rest arrives; sorting waits for all records (an address
with a value sort keeps the placeholder rows and says "then sorting" until
then, never a provisional top 25). Stats and
Guide never download the record index. Every column header sorts (round 17, the user: "like Excel"): a first click
sorts the column its natural way (Enzyme, Organism and Substrate A to Z, EC 1 to 7, kcat, Km and kcat/Km high to low,
Review result accepted first), a second click the other way, and records without the value stay last both ways (no
name, an organism or substrate the table shows as a dash, an EC number with no digit, no value). The sorted column
alone has aria-sort and a quiet ink arrow (up: ascending, A to Z or low to high; down: descending); hovering another
heading shows a faint arrow for the way a click would sort it; the whole cell is the target and the heading a button
(Enter sorts). The address names every order but the default (sort=enzyme, enzyme_desc, organism_desc,
substrate_desc, ec_number_desc, evidence_desc for Review result reversed; kcat, kcat_asc, km_asc, kcat_over_km_asc as
before); an unknown key, an older sort=temperature or ph included, opens the default. There is no Sort menu from
641px. Review result reversed puts Not checked and Disputed first and accepted records read from the paper last, the
names A to Z within each result. Review result stays the default order: accepted first (read
from the paper leading them, then by tier; Disputed sorts with Not checked), then
the enzyme's name A to Z (A-Z folded to a-z, the rest by code unit, a nameless record
last) with a paper's records of one enzyme together (by its first PMID, a record
without one last), then the table's order: the index is built in this order
(scripts/build-catlog-viewer-index.py default_order_key, header order
"default_review_enzyme") and the page draws page 1 from its first rows only for
this order (an index in an older order is sorted once it has arrived), so the
first page shows the first enzymes A to Z, not 25 records of one paper's EC
1.1.1.1 (2026-10-15). Enzyme, organism and substrate sort A to Z
skipping a name's leading quotes and brackets ('"Chelatobacter" strain ...' under
C, "[Bacillus] caldolyticus" under B).

## Type And Color

Use the existing system font (no web font), tabular lining numerals, and zero
letter spacing; mono only for record keys, mutations, SMILES and sequences. One
scale of sizes with their line heights (12/16 units, ticks and counts in filter
options; 13/18 table cells, chips, labels and captions; 14/20 UI text and record
values; 16/24 Guide body and Stats figure headings; 18/24 Stats part headings on phones; 20/24 the counts band's key
numbers on phones, record title and Stats part headings; 24/28 Stats and Guide titles; 24/24 the counts band's key
numbers on tablets and 28/28 from 1024px (digits only, so no line gap); 32/36 Stats headline; the counts band's parameter
counts 16/20, 500 from 1024px, 12/16 on tablets and 14/20 on phones, and its lines of context 12/16),
each a --fs-N / --lh-N token in the stylesheet. Table
names break between words and hyphenate a word longer than its column (a break
inside a word only as a last resort; the Organism column is at least about 13
characters wide); only SMILES and sequences break anywhere. No serial comma;
tags are lower case, filter labels and headings sentence case. One
type scale (front matter) and weights 400/500/600 only; no text below 12px.
Colours are tokens in the stylesheet's :root, the only place hex values appear (--bpg-* for the ten Nature BPG
colours, each written once; the meaning tokens point at them: --st-* for review status, --cmp-* and --chg-* for the
database comparison and kinds of change, --src-paper* for Read from the paper, --checked for human-checked, --caution*
for cautions, --ec-1 to --ec-7 and --db-* for the categorical sets, --bar-neutral for counts with no meaning colour,
--accent* for actions and selection).

Colour meanings (round 14, the user: "you keep using the same colours of the Nature BPG palette; there are some others,
right?"). The palette is Supantha's saved Nature BPG (ggsci npg "nrc"). One meaning per colour, the same meaning on
Browse, the record, the chips, the sidebar's dots, Stats, the Guide's legend and Team, and colour never alone (a dot, a
square, a tick, a "!" disc or the words go with it). Marks (dots, squares, the "!" disc, ticks) are opaque; figures fill
at 60% (#RRGGBB99 on white) with a 1px opaque outline, with three exceptions where a 60% fill would look like another
meaning's: a correction is opaque red, and the exact-factor corrections and Not checked are hatched (red, slate); tints
(the colour at 9-12% on white) only behind words. Text
passes WCAG AA (4.5:1; 3:1 for large numbers and for marks): where a colour is too light for text or for a mark on white
(cyan, mint, salmon, tan), the text takes a darker shade of the same hue and the mark a 1px ring of it, and the palette
colour itself goes on the mark beside the words.

| BPG colour | Meaning (one per colour) | Where it shows | Text / ring (AA on white) |
|---|---|---|---|
| navy #3C5488 | Accepted | status dot, Accepted's count (counts band, Stats band), chips, Stats bars and donut | itself, 7.5:1 |
| salmon #F39B7F | Not confirmed | status dot (ringed), chips, Stats bars and donut | ring #c4664a, 3.9:1 (the words are ink) |
| slate #8491B4 | Not checked (both kinds, Unverified and Not reviewed: one word, one colour; the record names which) | status dot, chips; in Stats' bars, donut and swatches slate hatching on white (135° lines, 1.5px every 4px, a slate outline), never a flat fill: slate at 60% (#B5BDD2) is navy at 60% (#8A98B8) a step lighter in the same hue | the words are ink |
| deep red #DC0000 | Disputed | status dot, chips, Stats bars | itself, 5.2:1 |
| cyan #4DBBD5 | CatLog's reading of the paper: Read from the paper; Not in the databases (a value only that reading has); Added, the source had none (an earlier version read it from the paper) | Read from the paper's count and label, its chip and the Source dot while chosen, Stats' from-paper marks (Values per paper, Enzyme classes' stripe, From paper counts, the from-paper tables, variants against wild type, assay temperature and pH, the wild-type analyses of round 16, the Checks meters of the AI checks, CatLog's dots and line in CatLog and BRENDA by publication year, the line in --src-paper-line #278CA4 so it keeps 3:1 on the grey band), Not in the databases' square and bars (a database's own "not listed" kinds as cyan hatching, a light cyan and the full fill), the AI agents on Team | text #207286, 5.5:1; ring #2DA1BD, 3.0:1 |
| green #00A087 | Agreement with a second source: Same number (a database lists the paper's number); human-checked (a human reviewer approved the values) | Same number's square, chip and bars; human-checked's tick, word and counts (Browse, record, Stats' Human review, its Checks meter) | text and tick #007664, 5.6:1 (4.7:1 on its 12% tint) |
| mint #91D1C2 | The same number in another form: Same, other label (database); More digits or rounding (an earlier correction) | their squares, chips and bars | ring #45A48E, 3.0:1 (the words are ink) |
| brown #7E6148 | Different number (database; an earlier correction's "a different number") | square, chip, bars | itself, 5.7:1 |
| red #E64B35 | A correction: Corrects a value (CatLog's number corrects a database's); Unit or magnitude (an earlier correction by × or ÷ 10ⁿ) | square, chip, bars: drawn opaque in figures too, the square's own red (red at 60%, #F09386, is salmon to the eye); how found: checked against the paper opaque, an exact factor found by code red hatching on white (never a lighter red: red at 55% then 60%, #F7C4BC, was Not confirmed's salmon fill, #F8C3B2, CIE ΔE 4.9) | itself 3.9:1 as a mark; text #C62E19, 5.5:1 |
| tan #B09C85 | Caution (a value that may be wrong) | the "!" disc (tan, ring #8c7a64, ink "!" 6.2:1), the chip, Cautions' dot, caution notes (tan tint #f8f6f4, line #dbd2c8, ink #4a3b2a), Stats' Cautions bars, the diffusion-limit band of kcat against Km | caution words and lines #79654F, 5.5:1 |

Not BPG, and carrying no data meaning: the ink and greys (--text, --text-2, --muted, --line; --bar-neutral #7d8885 for a
count with no meaning colour: the value ranges of all records, the tables of all records, No cautions, Other status,
Corrected earlier, a chip naming several results; --plot-band #eef1f0 for CatLog and BRENDA by publication year's grey
band of years, and --text-2 #3d4845, the grey of secondary text, for BRENDA's dots, line and words there: --bar-neutral has
CatLog's line's lightness (1.07:1), so in print or greyscale the two lines were one grey where they cross (round 16
review); --text-2 stands 2.4:1 from it, the approved figure's dark line beside a light one), and the accent for what a visitor picks or can act on (links,
buttons, the focus ring, the selected row, the current tab) and for the filters with no meaning colour (Not yet re-read,
a source database, the enzyme fields, the measurement). Round 14 moved the accent from teal #245f58 to ink #172120: the
teal, Human-checked's green and Read from the paper's dark cyan sat side by side in the counts band as one teal family,
so green now means agreement alone. A link is ink with a quiet 1px --accent-line underline (darkening under the
pointer), text buttons the same; tabs, menu items, buttons, contents lists and the counts band's numbers have none; the
browser's theme-color is the page's white. The round 13 purple,
raspberry, olive and amber are gone. Not yet re-read has no colour of its own: where a figure splits the two sources
it is neutral, and its records wear their review result's colour.

Categorical sets reuse BPG colours under a stricter rule: only in a figure where no meaning colour appears, always beside
the category's name or number, so the hue names the category alone there.
- Enzyme classes, --ec-1 to --ec-7: BPG red, cyan, green, navy, salmon, slate, brown (mint and tan are too light for a
  line, deep red is Disputed's alarm), in Values by enzyme class and kcat against Km only (a class's curve, its median
  dot and the short bar before its number); never in Enzyme classes or the EC number tables, whose bars wear
  review-result or Read from the paper colours.
- The databases, --db-brenda, --db-sabio, --db-oed, --db-uniprot, --db-skid, --db-strenda (navy, red, green, slate, tan,
  brown; cyan is left out, being CatLog's reading): for a figure whose only series are the databases. None exists yet:
  every view that lists the databases colours its marks by review result or database result (Records by main source,
  Part 7's figures and tables, the record's comparison, the Source database filter), so there the names tell them
  apart and a hue per database would give a colour a second meaning in the same view. CatLog and BRENDA by publication
  year (round 16) is not one: CatLog's cyan stands beside BRENDA there, and --db-brenda's navy is Accepted's on the same
  page, so BRENDA's line is --text-2's dark grey (no data meaning; darker than CatLog's line, as the approved figure's
  navy was), as the approved figure's navy could not be.
Table numbers share regular weight; enzyme names use medium weight. Reserve
semibold for counts, section headings, and the selected record's main values. Numeric
headers and values align right. Names wrap to two lines; the full name is on
hover and in the record. A variant's mutation (the bare signature, "D102E", or
"variant, not specified") has its own line under the name, a small accent tag that
is never clipped with the name, which then keeps one line; wild type shows
nothing. Records of one paper that read alike but differ in their assay carry a
short condition note (the export's condition_note, "+10 mM FBP") as a grey second
line under the substrate, the substrate then taking one line; without a note,
records with values on the page that share a paper, every column, temperature
and pH read "like another record" (it fits the Substrate column at its 120px minimum; its tooltip
says "same values as another record of this paper"; the table cannot tell what
differs). The record shows the note under its Substrate line. Every table row
has the same height. Value markers
(no unit, calc., a caution) sit beside the value, never under it; a caution's
words are in its tooltip and the record, and on phone cards beside the "!"
(they may go to the next line there, and words wider than the value's third of the
card wrap under each other beside the "!", never past the card). The table shows no temperature or pH (the
record, the filters and the downloads have them), so a temperature caution's "!"
and its short words, T questionable, open the grey line under the substrate, on
desktop too (before any condition or series note, "· +10 mM FBP"; the "!" has the
record's note as its tooltip); the record says it on its Temperature line, and the
Cautions filter finds it. A caution states the problem, never an
order: the tooltip is the record's note ("The paper's kcat/Km (2.2 mM⁻¹ s⁻¹) is
1.6-fold above kcat ÷ Km (1.3 mM⁻¹ s⁻¹). All three are stored as printed."; a
familiar factor is named as a fact in a few words, "The factor is near 1000, as between per mM and per M.", and on a record read from the
paper the printed numbers' own arithmetic says when they agree in one unit); the
short words are kcat/Km mismatch, Km > 10 M or Km < 1 nM (flagged from the stored
value on older snapshots too), kcat > 10⁸ s⁻¹ (an older snapshot's flag on a kcat
up to 10⁸ s⁻¹ is dropped; Stats counts the same way), possible 1000× unit error, above diffusion limit
and T questionable. The
Cautions filter names kcat/Km mismatch, Unit or magnitude error (one name in the
sidebar, its chip, the "?", the record, the Guide and Stats' table; round 14), No unit given, Temperature
questionable and No cautions. Stats' Cautions table counts each group from the same flags as the filter
(scripts/build-catlog-followup-summary.py CAUTION_GROUPS = the page's CAUTION_FLAG_BITS; a unit test holds them
together), so its counts are Browse's.

Review result cells (the column is headed "Review result", as in the Guide) align left: a dot and the review result (Accepted, Not confirmed,
Not checked or Disputed: words that define themselves and promise no further
work), then whole-word tags on a second line that always starts with what happened to the record: "from paper" (read
by CatLog), or "not re-read" (read out "Not yet re-read") followed by its source: the
databases (BRENDA, SABIO-RK, OED, UniProt, SKiD, STRENDA DB; a merged record names
each), "earlier extraction" or "source not recorded". Beside an open record only that first tag stays. "no paper linked" marks a
record without a PMID or DOI; under the user's review rules (an export that
counts accepted_basis) such a record is Not checked, and a human-checked record
the earlier review had not accepted is Accepted (its record says so: "Accepted on a
human reviewer's approval (human-checked)"). human-checked's rule, said the same way
in the filter's "?", the badge's title, the record, the Guide and Stats (the user,
2026-10-13; no whole-row rule): "A human reviewer approved every kcat and Km shown;
the kcat/Km was approved too or agrees with kcat ÷ Km." (a record read by CatLog adds
"the same values, in the review of the earlier version's entries"); never "every value". Columns are sized to the page's content: values, EC and Review result are
as wide as their widest entry (and their heading) and never wrap; Enzyme, Organism and Substrate
start as wide as three in four of their names. The room left in the window goes
to the name columns, first until their names fit on one line, then in
proportion to their widths, so the table fills the window and the arrow sits
right after Review result. In a narrow window Review result's human-checked tag
first moves up as a 12px green check right after the review result ("Accepted ✓",
read out "human-checked"; the word stays in the badge's tooltip), where the tag
line's "…" never cuts it (what that frees beyond the need goes back to the names: one
human-checked row had held Review result at 194px beside the 1280px sidebar and cut
every enzyme name above its variant tag), then the names give way (two lines, broken
between words while they can; the full name is on hover), then they go to their
minimums, then Review result's tags
(the badge's accessible name and the record keep them all), and when that is not enough the
table scrolls sideways. A phone card whose tag line is too long for it (not re-read · BRENDA · corrected · human-checked
at 320px) moves human-checked up the same way, card by card. The table has no temperature or pH columns (the user,
2026-10-13: the rows stay about the enzyme and its values); the records of one
paper's temperature or pH series on the page (the same enzyme, variant, EC,
organism, substrate and source, whatever their values or review result) say
which is theirs under the substrate ("pH 6.5", "37 °C", "pH not stated",
"temperature not stated", "pH and temperature not stated": spelled out, as the
table has no T column; only the
part that differs in the series; the tooltip adds "this paper also measured this
enzyme and substrate at another pH", or, for records whose values another record
shares, "otherwise the same as another record of this paper"). The Guide's Units
says T and pH are in the record and the downloads, not as table columns. The table writes
numbers at or above 10⁵ and below 10⁻³ as a × 10ⁿ, and from 1000 any number with fewer figures than integer digits,
printed or calculated alike (round 15 polish: a printed 3.5 × 10⁷ M⁻¹ s⁻¹ stored as 35000 reads 3.5 × 10⁴, like a calc.
4.1 × 10⁴ in the same column; a plain integer's trailing zeros are not figures); a plain decimal groups its thousands
from five integer digits (12,346; 1285.4 stays), like the site's counts. It shows no more precision
than was measured: at most 4 significant figures, 3 when the stored digits from
the fourth on are a ÷60 artefact (30.333 shows 30.3, 5.1667 shows 5.17; a kcat or
kcat/Km stored with 4 figures ending 333, 667, 833 or 167, as 7.333 = 440/60,
shows 7.33), never fewer than a number's integer digits below 10⁵; up to 4
printed digits stay as stored, trailing zeros included (135.0, 0.030). A kcat/Km
CatLog calculated (kcat_over_km_origin "calculated"; an earlier-catalog kcat/Km of
unstated origin is never called calculated, even when it equals kcat ÷ Km) carries
"calc." and the significant figures of kcat and Km, at most 4. Its title is "kcat ÷
Km, calculated by CatLog; no printed kcat/Km was read for this measurement." on a record read from the
paper (all CatLog knows: a paper can print one its reader did not record) and "kcat ÷ Km, calculated by CatLog." on an older one, whose source may list
a kcat/Km of its own (often the printed one). Tooltips and the downloads keep the stored
digits. The record's Value column follows the table's rule, except that a record
read by CatLog shows its values exactly as CatLog gives them, to the figures the
paper printed and never cut to 4 (value_display: 135.0 where the table shows 135,
1285.4 where it shows 1285), never more figures than the paper prints (a printed
47,000 M⁻¹ s⁻¹ reads 47, not 47.000); the 4-figure rule stays for older records
and for a kcat/Km CatLog calculated. The Guide's Units says it in one line (the paper's significant figures; the
downloads keep every stored digit).
Every column fits in about 910px of table; a table with less room (beside the
sidebar or a record, or on a tablet) has tighter cells and then scrolls sideways
with the enzyme name kept in view. Table headers are 12px/600 --text-2 (units
12px --muted under them), cells 13px, enzyme names 13px/500, rows 44px (a variant's 12px tag is a 16px box and a condition note a 16px line, so neither adds height). With a record open, EC and the arrow give way; Review result
stays with its source line (the other tags give way) and human-checked as the check after "Accepted". On phones (640px and below) the page scrolls
as a whole (2026-10-15: the pinned header, counts band and toolbar had left 1.5-2.5 cards in view, kept Safari's toolbars
from collapsing and put the pager below an iPhone SE's window): the list is as tall as its cards, the pager sticks to the
foot of the window, a new page opens at the table's top (showTableTop scrolls the window where the table's box cannot
scroll), and the page keeps its place behind the filter sheet and an open record (body overflow hidden); from 641px the
table scrolls inside its box as before. Each record is a card: name and EC;
the variant's mutation (under the name, as in the table); organism · substrate, with any note under the substrate on
its own grey line (an organism that takes two lines beside its substrate puts the substrate on a line of its own,
without the "·": fitCardOrganisms, round 15 polish); kcat, Km and kcat/Km, the card's lead (16/20px, 500, tabular; round
15 polish: at 13px/400 they had been its quietest text) with their units as labels, written as the table's headings and the counts
band write them (italic k and K, subscript cat and m: real elements in each value cell, hidden in the table, as a CSS
attr() label cannot draw them); the
two-line status badge. Below 390px kcat/Km (mM⁻¹ s⁻¹) does not fit a third of the card, so every value label puts
its unit on a second line (2px below the name, clear of its subscript), as the table's headings do, and the three
values stay on one line; a wider label breaks
only before its unit, and a value too wide for its third breaks before its "× 10".
The phone filter sheet ends with a "Show N records" button. Filter chips are plain,
a hairline on white with the option's own mark (Filters, above), 12px text, and wrap within the toolbar.

White and neutral surfaces carry the data. One accent (--accent, ink, 16.5:1) marks
links (with a quiet underline), selection, buttons and the focus ring (2px, 2px offset). Status uses a
coloured dot from the Nature BPG palette (ggsci NPG "nrc") and ink words:
accepted navy, not confirmed salmon, not checked slate (one colour for Unverified and
Not reviewed: the word says Not checked for both; its title names which),
disputed deep red; the light salmon dot carries a 1px darker ring. The
sidebar's boxes are all neutral (the accent); each option with a meaning colour shows its own mark between its box and its
words, a review result its status dot, human-checked its green tick, a caution its "!", a database result its square
(round 15 polish: the ticks had worn the status colours, so a result's colour showed only once it was ticked). The filter chips carry the meaning colours only on the marks of the options they name
(Filters, above); the other filters have no mark (the site has one light theme, so there are no dark-mode forms). Tan (--caution-mark, its text --caution) marks cautions. Green (human-checked,
#007664, 5.6:1 on white and 4.7:1 on its tint, the darker shade of BPG green) is for "human-checked" and, at the colour itself, for a
database's Same number (one meaning: agreement with a second source):
a small check drawn before the tag, weight 500, no pill or
background, in table badges, phone cards, the record's status line and Human
review line, the counts band and the Guide. The tag shows on accepted records
only; it updates in place when the marks arrive (rows are not redrawn). On a
phone card the badge keeps its two lines; a tag
line too long for the room left ends in an ellipsis. Use thin dividers, 4px
radii for controls and cards, and a crisp short shadow only for the phone sheet, dialogs, menus, the record drawer and
Stats' tooltip line. No glow, halo, text-shadow, wash, gradient fill or gradient text, no statistic-card styling, pills
where plain text would do, decorative icons or hero art (round 14; see Layout).

## Record Details

Keep values, units, warnings, protein form, identifiers, and paper links
visible, and say each thing once, in plain words. The record is a white column
with a 1px rule on its left: a header that stays in view, then sections, each
after a soft rule with a 14px/600 heading and a definition list (112px terms in
12px muted, 14px values; 96px terms on phones; up to 400px each term sits
above its value, so a sentence or a database comparison takes the whole width).
A section with nothing to say is left out, never an empty heading. Opening a record draws its whole header
at once from the table's row (name, EC and organism, substrate, status, record
ID), so the header keeps its place when the record arrives; below it, only when
loading takes a moment (after 240ms), "Loading record…" and a quiet outline of
the values in `--line-soft` bars (no animation with reduced motion). Another
record opens at its top. The heading takes focus for screen readers; its focus
ring shows after a key press (Enter on a row), not after a click or a link that
opens the record. Round 13 (the user, 2026-10-18: the record "reads a lot of AI inside jargon and repetitive words
for all entries"): a record is a curated entry, not a log. Each section says only what is specific to this record;
what is the same on every record (how CatLog reads and checks a value, that code converts units, the license and the
snapshot) is the Guide's, linked once under Checks ("How CatLog reads a value →", #guide-how-read), or the table footer's.
A field the header gives (form, the source of a record read from the paper, where the values are printed) is not
repeated in a section. The order: A (header), B (Values), G (Compared with databases, or Corrected earlier), H (Checks),
C (Source: an older record's database only), D (Conditions), E (Protein and substrate), F (Paper), then the footer
(Download record and Report a problem). Round 17 (the user: "every entry doesn't need the license, CC, snapshot
line"): the license and the snapshot are said once, the license in the table's footer ("CC BY 4.0 · How to cite",
linking to the Guide's #guide-licence) and the snapshot date (its title the Data ID) in the counts band; only a record
whose terms differ from CC BY 4.0 (SABIO-RK's terms, SKiD's CC BY-NC-ND 4.0, several licenses on a merged record, a
source that names none) has a 12px muted line under the buttons, "License for this record: ...". So the values, how
they compare with the databases and how far they were checked come first, the context after.

- A. Header (stays in view; on phones and on screens up to 900px tall, where
  the whole header would take a third of the record or more, only the name and
  ‹ › × stay, with a rule under them once the record scrolls, and the lines below
  scroll with the record): the name (20px/600; 16px when longer than 64 characters) and, at its top right, ‹ and ›
  (Previous and Next record, 28px wide: the record before or after this one in the results, in the table's order and
  across its pages, the table turning to the page that shows it and, beside the record from 1024px, scrolling its row
  into view; disabled at either end, while a sort waits for the records and when the results do not hold the record;
  the button pressed keeps the focus, the other one takes it at an end) and × close, the name's line keeping their
  88px clear so a long name wraps before them (on phones and touch screens all three are 44px targets with 8px more
  before ×, so a near miss on › never closes the record, and the name keeps 148px clear; on phones only beside them:
  a float their size keeps the first lines clear and the name takes the panel's width below them, round 14). The name
  wraps between its parts only, at a space or after a hyphen or slash, never inside a part and never right after a
  short locant ("4-", "1,2-", "3α-", "D-2-"), which stays with the part after it, nor before a last part of three
  characters or fewer ("TEM-1"): each part is an inline block (detailNameHtml), so a part too wide for the line beside
  the buttons goes under them whole; the text and a copy of it are the name as it is. "EC 1.4.1.20 · *Bacillus sphaericus* · Variant
  `N145A`" (the binomial in italics, a strain or "sp." roman; "Wild type" or
  "Variant, not specified"; nothing when the record does not say; an EC the
  paper does not print reads "EC 2.3.1.183 (from the databases; not in the
  paper)"); "Substrate: ..." (two lines at most; in full under Protein
  and substrate), with the record's condition note under it in grey; one status
  line in the table's colours, the dot in the exact status's colour (slate for
  Unverified, tan with its ring for Not reviewed, salmon with its ring for Not
  confirmed), the result word at 13px/600: the review result ("Not checked
  (Unverified)" keeps the earlier status in brackets), the source ("read from
  the paper" for a record CatLog read, else as the table names it: "BRENDA",
  "earlier extraction", "source not recorded"), then "corrected", "no paper
  linked" or "✓ human-checked" (each "·" sits in the gap before its tag, so a
  tag that wraps onto the next line on a phone leaves no "·" at the end of one
  line or the start of the next); last the record ID in 12px mono and Copy link
  (the page's address with #record=). Copy link, and Show and Copy under E,
  are text buttons at least 24px tall to touch (WCAG 2.5.8), with a negative
  margin so their lines keep their height.
- B. Values: one table, Parameter | Value | Unit | As printed | Where, in kcat,
  Km, kcat/Km, Ki order (a metric the record lacks is not a row); the value at
  16px/600 right-aligned, the unit 12px muted. A record read from the paper
  gives each number as printed; the place goes in a caption ("Printed in
  Table 2") when every value shares it, in a Where column when they differ
  (under As printed on phones). An older record has neither As printed nor
  Where (a column of dashes would read as "nothing printed"; Unit takes the
  rest); where the paper prints its values is said once, under Paper (the earlier review's notes) or as Corrected
  earlier's "In the paper" (then the notes leave their Where out), with no pointer line under the table (round 14). A calculated
  kcat/Km carries "calc.". On phones (up to 640px; round 15 polish: "mM⁻¹ s⁻¹ 0.01 mM⁻¹ s⁻¹" had read as one string and
  the "!" had dropped under its number) a record with As printed reads as the Guide's phone mock: each row a grid of
  parameter (4.5em), value and unit (5.5em, which may wrap), "As printed: ..." (13px --text-2 after a --muted label) on
  its own line under them across the row, the column heads kept for screen readers only; calc., the check and the "!"
  stay beside their number, every row keeping unseen copies of the others' marks so the numbers end at one place, and
  below 340px (Value under 150px) calc. and the "!" go under the number at the right; an older record, with no As
  printed, keeps its three columns and its calc. and "!"
  beside the number from 361 to 640px, so every row stays one line, and its
  unit wraps before the table outgrows the section; a record with checks keeps
  each number of As printed (and each unit with its power, min-1) whole from
  361px up, and from 361 to 420px its
  two-part unit may take two lines and its cells come 2px closer, so the
  check's 16px never breaks a printed number such as 0.00048 in a wide font and
  the table stays inside its section). Up to 360px the columns are fixed (Parameter
  24%, Value 34%, Unit 17%, As printed the rest), calc. and a "!" sit under
  the number at the right, the numbers are 14px, and a
  number too long for Value (1.28 × 10⁻⁴ in a wide font) wraps before "× 10"
  ("× 10" never parts), never into Unit. A value a human reviewer approved carries a
  small green check (`--checked`, 12px) right after its number, named "approved
  by a human reviewer" (role img, named by its tooltip alone: a title beside an
  aria-label is read out again as a description): the values the mark lists (mark.approved:
  only values a reviewer approved), else the kcat and Km of a record the
  reviewer checked (mark.checked), plus the metrics named by the review's own
  sentence "A human reviewer approved the same kcat and Km for this paper ...";
  any other note marks nothing, and a calc. kcat/Km never has one (it is not
  printed). Being checked never puts a check on a kcat/Km: a checked record's
  printed kcat/Km that the list leaves out agrees with the approved kcat ÷ Km,
  and the grey note says so ("The kcat/Km has no tick: no reviewer approved it, but it agrees with the approved
  kcat ÷ Km."; the mark is a tick in these notes, never "check", which means verification elsewhere in the record;
  round 14). A value whose
  magnitude caution the record shows (Km above 10 M or below 1 nM, kcat above
  10⁸ s⁻¹, kcat/Km above the diffusion limit: "the unit or the value may be
  wrong") has its check withheld, in the record and in Download record's
  human_approved_values alike, and the grey note says so: "Km has no tick:
  the note above questions its unit or value." (or, with no tick shown, "A
  human reviewer approved Km, but it has no tick: ..."; on a human-checked
  record "Human-checked: a human reviewer approved Km (see Human review below),
  but it has no tick: ...", so its badge and the unmarked table agree). The check
  stays beside its number (or the number's last line) at every width: a word
  joiner ties the two, and up to 360px the check hangs in a 16px margin of its
  own, so every line of every number ends at the same place. The first grey note under the table says what the check
  means: "✓ Approved by a human reviewer (see Human review below)." ("Human review"
  is a link-styled button that scrolls the panel to that row of Checks,
  focuses it and outlines it a moment); beside a
  calc. kcat/Km it adds "The calc. kcat/Km has no tick: CatLog calculated
  it.", so checks on kcat and Km alone never read as a value the review left
  out. A row without
  the check, calc. or "!" keeps their space unseen (aria-hidden), so every number in the
  Value column ends at the same place; on phones the calc. and "!" space is dropped (kept
  for an older record above 360px, where they stay beside the number). The
  Value heading keeps the same unseen spaces (no height; calc. drawn by the stylesheet,
  so its text stays "Value"), so it ends where the numbers end at every width. Under the table: the
  kcat/Km a merged older record's sources list ("kcat/Km listed by OED: 3.0–6.1
  mM⁻¹ s⁻¹, 5 values", in the catalog unit, a range to 2 significant figures
  and a single value by the display rule, 126.667 showing 127; each end of a
  range is one unbroken number, so a long range breaks after its dash or before
  its unit and fits at 320px; shown when it differs from the
  record's kcat/Km or the record stores none, then the empty line says "No kcat,
  Km or kcat/Km is stored for this record; BRENDA lists a kcat/Km for it
  (below)."; a number a source also gives with no unit is listed once; Download
  record carries them as source_kcat_over_km_values), each caution once as a tan caution note
  its value's "!" moves to, the grey notes (no line says "converted by code" on every record: As printed shows each
  printed cell beside the stored value, so a changed unit shows there, and the Guide says that code converts; a
  printed unit read in a stated way keeps its own line, "kcat/Km: printed unit read as 10³ M⁻¹
  s⁻¹." (a unit in CatLog's own words, in these notes, the Second check and the
  unit cautions, reads s⁻¹ whether the reader typed s^-1 or s-1; As printed
  keeps the text as read), "calc. kcat ÷ Km, calculated by CatLog; no printed
  kcat/Km was read for this measurement."; an older record's "calc. kcat ÷ Km, calculated by CatLog." adds "OED lists its
  own kcat/Km (above)." when its sources list one, never "not printed" or
  "different": a listed value is often the printed one, the same to the figures shown;
  in the grey notes, the empty line and the "kcat/Km listed by OED" label kcat, Km, kcat/Km
  and Ki are set as the table's rows set them, italic k or K with a subscript),
  then each quoted line once (a line another value's line continues, one excerpt
  cut at two lengths, is quoted once, the longer), after "In the paper:"; one line whose place the caption does not
  name gives it in brackets, "In the paper (Table VIII):"; more than one line name
  their values instead, "In the paper (kcat and kcat/Km):" (at most 240 characters, table markers removed, K_M set as
  K<sub>m</sub>, caret exponents and charges set as superscripts: s^-1, mM^{−1},
  NADP^+, Mn^2+, and an exponent extraction split, min^− 1 or 10^−^3, as one; a hyphen or dash before an exponent's
  digits or in a charge is set as the minus sign U+2212, as in every superscript the page sets: s<sup>−1</sup>,
  10<sup>−4</sup>, the Guide's too);
  a row of more than four cells, or one whose ± signs extraction
  dropped, is folded under "Show the printed line" ("Show the printed kcat line" when the lines name their values)
  with that warning.
- C. Source (an older record; a record read from the paper has no Source section, its header says "from paper", unless
  it has a detail of its own: a plain data origin, merged entries): Values from (the databases by
  name, never a raw key; not "Source", which would repeat the heading; an earlier corrected record whose every
  kinetic value shown was added from the paper, "added: the source had none" on each, says "The paper (read by
  CatLog's earlier version)" with a Database entry row naming the database "; its entry had none of these values",
  never a database as the source of values the record says it never had, the user 2026-10-15; a value the database
  had keeps the database); Merged
  from (database entries and papers); the source's own details as rows of the
  same list, each wrapping (nothing to open at the record's end): Databases, the
  databases a merged record combines when they are not those Values from names
  (compared as a set, named in its order); Name
  from on an older record ("BRENDA recommended name", "The source database's
  listing", "The EC list's accepted name"; a record read from the paper takes its
  name from the paper); Data origin when it is a plain
  word other than "experimental"; an Evidence line ("Located in the paper", "Paper cited" whatever the
  review result (fix pass after round 16b: "(values not located)" on a record not accepted said more than any field
  records; the Guide: "The paper is linked; where it prints the values was not saved."),
  "Several database records" or "Database record only"); a license other than CC BY 4.0 is the footnote's
  (a source that names none reads "License for this record: See the source's terms", as the
  Guide's Sources and licenses list says "License: see the source's terms"; a
  record with no recorded source reads "License for this record: Not recorded");
  a database note on request, headed by
  its source ("Note from BRENDA", "Notes from SKiD"; "Database note" on a
  record merged from several databases, which do not say whose note it is),
  without an importer's label and not shown when it only repeats the
  temperature and pH rows. The earlier automated review's own notes among them
  ("PMID ... Table 1: ...", "Official PMC route: ...") are not the database's:
  one that names a table goes under Paper, the rest are left out.
- D. Conditions: temperature, pH, the other conditions (Assay, a short list
  whose items break a word longer than the line, "phosphoenolpyruvate/pyruvate",
  so a 320px phone does not scroll the record sideways), cosubstrate, cofactor,
  preparation. A missing temperature or pH reads "Not
  stated in the paper" on a record read from the paper and "Not recorded" on a
  database record, "Not recorded (source note: 25 °C)" when its source's note
  gives one temperature; a value a flag holds back says why on its own row ("Not
  shown, the source's temperature unit is unclear (source note: 30 °C)", "Not shown, recorded as exactly 0 °C, which
  may mean none was given"); a
  cofactor that is the substrate is not repeated. A labelled row never shows a
  bare dash. An older record's "buffer ..." item that the earlier pipeline cut
  at the paper's first "." or "," ("buffer containing 0" for 0.1 M, "Tris-HCl
  pH 7" beside the record's pH 7.5, "buffer A (10 mM Tris-HCl") never shows its
  cut end: a bare whole number at the end (not a reference, not the record's own
  pH) goes with the words that only led to it, the rest ends in "…" and closes
  the bracket or quote it opened, and an item left with only "buffer" is not
  shown. A bracket that never closes holds no "; ", so a cofactor after it keeps
  its own row.
- E. Protein and substrate: Enzyme form only when the header names no form ("Not recorded"; the header's "Wild type"
  or "Variant H150A" is not repeated); one
  UniProt line, the accession and how it was found ("(inferred from EC number
  and organism)") or "Sequence known, no UniProt entry", "Several possible
  UniProt entries", "Not matched to UniProt"; each sequence as "605 aa" with Show
  (opens it under the row) and Copy, the variant's named by its note ("489 aa,
  UniProt P22498 with H150A"; a long list of substitutions wraps inside the
  record); without a sequence the row says why or "None
  recorded"; the substrate in full; SMILES with Show and Copy, or "None
  recorded".
- F. Paper: the title and year when the record carries them; PubMed and DOI
  links (a stand-in ID is text); where the values are printed is the Values caption's or Where column's, not repeated
  here; In CatLog, a
  link to the paper's records in Browse with this record kept open
  (#browse?q=pmid:<PMID>&record=<key>, or doi:<DOI>), "89 records from this
  paper →" once the record index is loaded ("Only this record" when it is the
  paper's one; a record naming several papers, by PMID or else by DOI, gives
  each its own count and link beside its ID in the PubMed IDs or DOIs row
  instead, "35008493 · 43 records in CatLog →" or "· only this record in
  CatLog", each link named with its paper for screen readers, so no ID is
  listed twice and every cited paper can be explored; up to 1023px, where the
  record covers the list,
  following it closes the record and shows the paper's records with focus on
  them, and Back opens the record again); an older
  record's notes on request: "Earlier automated review: where the values are
  printed" (Where, As printed and Conversion, code quotes and "->" written as
  plain text and arrows; the Conversion line keeps each value's printed number
  and arithmetic and says "(no conversion)" for the earlier pipeline's
  reasoning, right after the value it is about and never after a unit
  conversion such as "/ 1000" or "converts to", uM reads µM; a quotient written
  to six or more decimals with more than four significant digits reads to four,
  "1.1/13 = 0.08462", as the Values table shows it, while 0.000015 keeps its digits;
  a note cut before its first label, "1.1 s⁻¹; K_B = 13 mM; ...", opens with
  "kcat"; Python's 4.69e+01 reads 4.69 × 10¹; "catalog units" reads "the
  catalog's units"). The notes never
  show the earlier pipeline's field names or how it fetched the paper:
  "Km raw_value=1.27 mM raw_unit=mM" reads "Km 1.27 mM" (a unit once), a
  printed cell other than the value is quoted ("kcat 0.022 s⁻¹, printed
  “(2.2 ± 0.1) x 10-2”"), "+/-" reads ±, "PubMed XML abstract PMID n" reads
  "Abstract" and "ScienceDirect HTML Table 1" "Table 1".
- G. Compared with databases (only when there is something to say; round 9 brief,
  section 4). A record whose values were compared has a 24px round "?" 8px after
  its heading's words (the filter groups' "?": the same circle, `--line-strong`
  outline, accent tint while open; centred on the heading's 20px line; on phones
  and touch screens a 44px target, as ‹ › × are there, its hit area 10px round
  the circle and above the section's first line), which
  shows and hides a quiet `--surface-2` box under the heading (12px): "Compared
  with the values BRENDA, SABIO-RK, OED, SKiD, STRENDA DB and UniProt list for
  the same paper. A different number can mean a different measurement; it does
  not by itself mean a database is wrong." (names from the manifest, each kept
  whole on one line: SABIO-RK never breaks at its hyphen nor STRENDA DB at its
  space; never a counted "five"), then "Compared with databases in the Guide →"
  (#guide-databases, when the Guide has that section). The caveat is not in the
  box: it stands under Different number only, as one line under the notes of a
  record with such a value, never as a footer on every record (the user, 2026-10-15:
  "do we need to write it every time?"); an earlier record's correction trail
  compares nothing and has no "?" (its heading is "Corrected earlier"). For a record read from the paper, in this order: the paper's note
  (database_note: one database lists its values at one factor throughout) in a
  box (`--surface-2`, 1px `--line`, 13px), "Across this paper:" and the note as
  given, then a link to those values: "Show these 12 values →" (q=pmid:<PMID>
  or doi:<DOI>, db=corrects, dbsrc, dbpar, from the manifest's
  summary.database_comparison.database_notes, once Browse matches dbsrc and
  dbpar; several notes name their parameter, and their database when they
  differ), else "Records of this paper that correct a value →" (q and
  db=corrects). Then each value a database lists with the same number, in one
  13px line with a green square, values whose lines read the same sharing it
  ("kcat and Km: Same as BRENDA and OED."; the line whole, or "Same as <the
  value's database_sources>." without one). Then one folding note
  (`<details>`) per value that is not the same, values whose notes would read alike (the same result, line,
  databases, cause and place; most often "Not in the databases" with one line for the whole paper) sharing one note
  ("kcat, Km and kcat/Km · Not in the databases"), a value that corrects or differs keeping its own (the Values
  pointer opens it by its parameter); its summary (13px, wraps, the result too: "Different number (exact factor, not
  yet checked)" is wider than a 320px phone's note): the parameter · the result only (the line names the databases;
  each fact is said once), the result's 10px square and word, the name Browse's
  option and chip have: "Corrects a value" (`--chg-magnitude`, whatever the
  cause), "Different number" (`--cmp-differs`), "Same, other label"
  (`--bar-neutral`), "Not in the databases" (`--cmp-new`). Its body: the
  snapshot's line whole (never parsed for reasons, factors, numbers or
  databases; so the lines must name the databases as the "?" box does, "None of
  the compared databases" and "STRENDA DB", round 9 brief C9 on the CatLog
  side: the browser check reads every note, closed ones too, and fails on a
  count in words or a name the "?" box spells otherwise), then a definition list (112px labels, 96px on phones, one column
  up to 400px) with rows that have content: Cause (database_cause in words, said only where the line does not say it:
  not when the line has its own cause part, database_parts.cause, "An AI check of the paper found the cause: ..."; not when it names
  the factor between the two numbers, "10× lower", "60× CatLog's value", "= the printed 21 × 60", "the printed number in
  mM", which is what a cause found automatically is: power_of_ten "off by an exact power of ten",
  printed_number_unit_not_applied "the printed number taken in another unit", time_factor "off by exactly 60 or
  3,600"; not when it says the cause word for word, time_unit worded as CatLog's line words it, "a time unit taken for
  another (seconds, minutes or hours)"; not for different_measurement on a line that says "another measurement"; a
  code with no wording never shown; on a value found by an exact factor alone, database_found_by factor_only or a
  status that says so, whatever an older snapshot calls it, whose result word "Different number (exact factor, not
  yet checked)", brown, says it is not yet checked, only the factor from database_by_source with its cause, "1,000×
  lower (off by an exact power of ten)", when the line does not give it). Then the checker's own notes
  (database_evidence: where the paper prints the value and the arithmetic checked; a local path never) folded under
  "What the AI check found" (a 12px `--muted` `<details>`, closed; never labelled "In the paper", which names the printed
  quote), without a last part that only gives again the number the line names first ("...; OED and SABIO-RK list 917.7
  mM⁻¹ s⁻¹": a part starting with database names whose first number is the line's first number). A note with an
  empty body is a plain line. Notes on a correction or a different number are
  open: every one from 641px, only the first on a phone; others closed; nothing
  is remembered. Then a kcat/Km CatLog calculated, once other values are
  compared: "kcat/Km (calc.): not compared." (the Values table's note says what calc. means; 13px, muted, no
  square: an empty one read as a box to tick), after the compared values. A record with a Different number says
  the caution where it applies: one 12px `--muted` line right under its notes (before the calculated kcat/Km),
  "A different number can mean a different measurement; it does not by itself mean a database is wrong.", once
  however many values differ; no other record has it, and the "?" box keeps only the compared databases and the
  Guide link, so the page says the caution once, under Different number. A snapshot's line that says "not yet
  resolved" reads "cause not yet known" (databaseWords), Browse's words. Display names come from the manifest
  (summary.database_comparison.sources: key, name, display, in order; STRENDA
  reads "STRENDA DB"), else the databases values_by_database counts, else the
  six in the code (with UniProt). Then "More like this:" links, each keeping the record open beside the
  list as its paper's link does (#browse?db=corrects&record=<key>; up to
  1023px it shows the list instead): each Browse option the record matches
  (corrects, differs, other_label, not_listed or, when every value is not
  listed, its nested all_not_listed, all_same, earlier), by the option's chip;
  an option the page does not have gets no link, and neither does one Browse
  cannot filter by (the record index must carry the comparison and the record's
  own row in it must match the option); once Browse matches dbsrc and dbpar,
  each database of the record's strongest result for that parameter ("BRENDA",
  titled "Corrects a value · Database: BRENDA · Compared value: kcat"); the paper's other records are linked once,
  under Paper (no "All records of this paper" here). Under the Values table (section B), a value that corrects or differs
  gets one short 12px line, the parameter and a link-like button, "kcat/Km: corrects BRENDA and OED ↓" or "Km: differs
  from SABIO-RK ↓" (its accessible name adds "see Compared with databases"; no square beside CatLog's number), whose button
  opens that value's note, scrolls it to the middle and focuses it.
  An earlier corrected record (not yet re-read) with its correction trail, headed
  "Corrected earlier" (Browse's name for it; no database is compared there, the
  user 2026-10-15): the
  label "Changed by CatLog's earlier version:" (round 14: a label that claims nothing about the new values; "changed
  to what the paper prints" was not true of a calculated kcat/Km, 138 of the 1,780 kcat/Km changes) (the header's "not re-read" says it has not read the paper again; when every item was added, the source
  having none, "CatLog's earlier version added these values from the paper; the source had none." and no item repeats
  "added: the source had none"), then one item per changed
  field, "66 mM → **0.066 mM**" with the kind of change ("unit or magnitude",
  "more digits / rounding", "different number", "added: the source had none",
  "removed", "replaced"), "Before: as BRENDA lists it for this paper" or
  "Before: the earlier version's value" (nothing for an added value's "none"),
  with the factor between them for a unit, magnitude or different number
  ("(1,000× higher)": before ÷ after); numbers at most 4 significant figures
  (0.546667 reads 0.5467; integer digits below 10⁵ kept, 19230.8 reads 19231;
  more figures when Before and After would read the same, 2.667 → 2.6667), a
  rounded number's stored digits in its title ("As stored: 0.546667"); "In the
  paper: <where>" under each item, or once under the list when every item
  shares it; then pH, temperature (in °C), identifiers as text, as given, never
  written as numbers ("UniProt P00325 → P00326", "PMID 21149620 → 21149602",
  not "2.114962 × 10⁷"; only Vmax and pH are numbers), units as the record's
  units read ("kcat unit s⁻¹ → min⁻¹", never "s^(-1)"; uM as µM) and a
  replaced sequence or SMILES ("Replaced", not repeated); a field whose value
  did not change is not listed, and two stored copies of one field that read the
  same (sequence and canonical_sequence, uniprot_id and primary_uniprot_id: same
  name, same before → after) are one item; then "More like this: Corrected
  earlier" when Browse has that option. A corrected record without its trail
  says so in its Review result line ("this snapshot does not list the
  changes"; the earlier version's files keep them) and has no section G. Any
  other record has no section G: a heading that compares nothing is never
  shown. Colour is never the only carrier: the word or phrase is always printed.
  Factors anywhere in the comparison (x = the database's number ÷ CatLog's):
  exact powers of ten "10×", "100×", "1,000×", "10⁶×", 60 or 3,600 "60×" /
  "3,600×", any other at two figures ("4.5×", "960×"), then "higher" (x > 1) or
  "lower".
- H. Checks (right after G; on a record read from the paper: Second check, AI audit, Human review, then one Guide link
  under the rows, "How CatLog reads a value →" (#guide-how-read; #guide-method while the Guide has no such section)
  or, on a record not yet re-read, "How the earlier review worked →" (#guide-earlier, round 14: the Guide's two sentences
  on the earlier version and its automated review under the four steps; #guide-method on an older Guide),
  13px, moving to the next line whole when it does not fit, so no phone scrolls the record sideways; its header already
  says Accepted · from paper, so no Review result row repeats it): Second check (one result for every value, "All
  values confirmed." or "Unit set to mM for every value.", or each value's result, "kcat: confirmed; Km: unit set to
  mM.", kcat, Km and kcat/Km in italics with subscripts as in the Values table; then once what the check changed on the
  record, "The AI check also removed EC 2.7.2.12 and corrected the assay conditions"; a removed EC the header still
  shows says where the shown one comes from, "removed EC 1.1.1.25 (not printed in the paper; the EC shown comes from
  the enzyme databases)" or "... from the UniProt entry A0A5H2WVH6"); an older record: Review result in one sentence
  (the earlier automated review's result; "Corrected and accepted in the earlier automated review (see Corrected
  earlier)."), and the one link "How the earlier review worked →" (#guide-method) under the rows; for a database record the earlier review did not settle
  (Not confirmed, Not checked) with a paper, a Paper check row under it, "Not
  yet checked; the values are the database's." (not on one
  whose Evidence reads "Located in the paper", nor on one that names no
  paper); an AI audit line with the audit's date and verdict only; a
  Human review line with the reviewer's facts-only note on every record that
  has a mark (no review year; the notes are shown as written, except that a note naming "CatLog v1 entries" reads
  "the earlier version's entries" (versionWords; CatLog is the one name); the review notes of a record not yet re-read
  say "the earlier version's entry" where the earlier review wrote "expected row"; a checked record without a note names the values it shows that a reviewer approved, "A human
  reviewer approved the Km shown." or "... the kcat and Km shown; the kcat/Km agrees with kcat ÷ Km.", never a value
  the record does not have; human-checked's whole rule only when it shows all three and the mark lists none). The
  footer, the record's last part: Download record (the primary button) and
  Report a problem side by side (prefilled with the record ID, the snapshot and
  the values as the record shows them, a Ki included, and the kcat/Km its
  sources list when the record shows one, "kcat/Km listed by OED 3.0–6.1 s⁻¹
  mM⁻¹ (5 values)"; the DOI when there is no PMID). Download record (and This page as JSON) saves one flat object: the Full
  data's field names for the values (ki and ki_unit when the record shows a Ki),
  units, conditions, paper IDs, UniProt ID, sequence and
  SMILES; the record's own words for review result, source, method, check,
  values as printed (each with the whole line quoted from the paper, which the
  record cuts at 240 characters), AI audit, cautions and human review (with
  human_approved_values, the values the record shows with a check), and, when the snapshot
  carries them, Compared with databases (each value's result, line, cause and
  evidence; or the earlier review's changes, Before, After and the kind of
  change; never an empty list or a local path); the license as the record
  shows it, once. The earlier pipeline's internal fields stay in the
  Full data. Under the buttons, only for a record under other terms than CC BY 4.0, the footnote (12px muted):
  "License for this record: CC BY-NC-ND 4.0" (or the source's terms); never the snapshot or its Data ID.

A flagged value carries a small "!" button that moves to its note; nothing is
readable only on hover. A value whose printed concentration unit is not the one
CatLog read it in (µM printed, mM used) is such a caution ("printed unit
differs"), named by its value ("Km: The paper prints µM; ..."): its note says
whether kcat ÷ Km shows the unit used is right and, when an AI audit
re-checked the value, ends with what it found ("... and kept mM."); the note
stays a caution note (tan). CatLog's own flag for it
(printed_unit_prefix_differs) counts as a possible unit error and is said once;
with the flag the table's "!" and the Cautions filter's Unit or magnitude error
find the record too (Stats' Cautions table counts it there as well) (its title and the Guide's list of that
group name it), without it the caution is in the record only.
A merged older record whose listed kcat/Km values are all more than 2-fold from
kcat ÷ Km gets a note saying so (a "kcat/Km mismatch"; a familiar factor such as
1000 is named, and a fold past 10,000 reads "more than 10,000-fold"). A stored
kcat/Km flagged both against kcat ÷ Km and against every listed kcat/Km gets one
note for both ("The stored kcat/Km ... BRENDA lists kcat/Km 18.6 mM⁻¹ s⁻¹ for
this record, which agrees with kcat ÷ Km."). An older record whose
stored kcat/Km is a unit factor off shows the source's own kcat/Km that agrees
with kcat ÷ Km, and its note gives the stored number.

The record writes numbers like the table (a × 10ⁿ at or above 10⁵ and below
10⁻³ and from 1000 with fewer figures than integer digits, thousands grouped from five digits, the same display rule); a value CatLog gives to the figures printed shows
exactly those figures (135.0, 1285.4; never rounded to 4), but never more figures than the paper prints: zeros of a printed
integer are not figures, so "47,000 M⁻¹ s⁻¹" or "9440 µM" shows 47 or 9.44 as
in the table, not 47.000 or 9.440; a kcat/Km calculated for an older record keeps the significant
figures of kcat and Km. Odd records read plainly: "Unknown" EC or organism
reads "EC unknown" / "organism not recorded"; a record without kcat, Km or
kcat/Km says so (or that it stores a Ki only); a missing sequence, SMILES or
paper ID reads "None"; a paper's stand-in ID (NP and 8 hex digits) is text,
never a PubMed link. Sentences are not hyphenated. A record that cannot be
loaded says so ("This record could not be loaded.", or that the page is out of
date, with Reload). Do not discard source text, hide scientific warnings,
recompute measurements, or weaken review definitions to make the page shorter.
Database attribution belongs in Guide and dataset notes, not the Browse footer.

## Stats

One page from the snapshot manifest (never the record index) in numbered parts, each with one plain heading:
1 At a glance (the headline band, the page's focal point: a plain white card with a 1px --line hairline, no glow, halo, wash or motion (round 14); 40px key numbers in the counts band's meaning colours (28px on phones, growing with the window from 721px to 30px at 1023px and on to 40px at 1200px, never smaller on a wider window, so a wide font keeps a six-digit count inside its column), then 20px scope counts),
2 Quality (round 14: the review's 99.9% is At a glance's alone, with one line as the other notes have, "no value
disputed, 2,601 of 2,604" (fix pass after round 16b: the gloss and the entries without a paper had made a three- to
seven-line paragraph of a headline cell; the item's title says it in full, and Quality's lead says the rest; an older
snapshot: "no value disputed, 2,767 of 2,770; 153 (5.5%) not found in the paper"); each item's label and number are two
rows of the band (a subgrid), so the numbers of a row start at one height whatever label wraps); here no second big number and no dashboard cards: Human
review in one sentence over a small table of its verdicts, then Checks on the values as a table of the checks, each row
with what it covered and what it found (no meter since the fix pass after round 16b: the shares are in the words; on a
phone each check is stacked, its name over the two), then Errors found in CatLog (round 16b), the three tables at one
measure (640px at most); the review's flags by kind and the reviewers' approved values read from the paper again are the supplement's
Quality tables), 3 What is in the catalog (the review results as one 100% bar over their legend
table (fix pass after round 16b; a donut until then), records by main source with a Records | Share switch, then CatLog and BRENDA by publication year (round 16, when
the manifest has summary.publication_years), then the enzyme classes with accepted and read-from-the-paper records), 4 Values (value ranges on one log axis per parameter; then, from the records read from
the paper, Between papers (round 16) after the ranges, kcat against Km as a density map with lines of equal kcat/Km, the
diffusion limit and each class's median, Substrate specificity (round 16), and variants against their wild type of the
same paper, enzyme, substrate, pH and temperature), 5 Compared with databases
(from the manifest's database comparison: a two-sentence lead that says once that a different number can mean a different
measurement, and (round 16b) how the corrections were found and that they are a lower bound, values against the
databases, corrections by cause), then S Supplementary figures and tables (round 14):
every other figure and table, numbered apart (Figure S1, Table S1), in five groups (Quality; What is in the catalog;
Organisms, enzymes and variants, called Biology until round 14's polish; Values; Compared with databases), each item one
closed line (a details whose summary holds its number and title) that opens its figure, with its own address
(#stats-s3, #stats-table-s2) that opens it; new there: papers by parameter, single substitutions by residue, kinds of
variant and units as printed, counted by build_overview from the records read from the paper; round 16 added kcat and
assay temperature, Km and substrate size (Values' figures, after Assay temperature and pH) and The typical wild-type
enzyme (Values' first table). No caption or rule names a figure's number: the numbers follow reading order, so a main
figure added later (the BRENDA comparison by year) renumbers the rest by itself.
Figures and tables, two to a row from 1024px, each have "Figure N." or "Table N." with a short caption in plain words
(one sentence, no filler, about 15 words at most since round 14's fix pass: what a mark means beyond that, such as the
ridges' hatched stubs and dashed curves or why a value counts for several databases, is the figure's rule under its
number in How these numbers are counted; a chart names its number columns above them instead) and no data
line: the snapshot's date, its Data ID and the counting rules (each figure's own under its number) are said once, in
the closed How these numbers are counted that ends the page; flat fills, the colour at 60% with 1px opaque outlines, in the
review-result and comparison tokens, --bar-neutral for the single-series value figures and the enzyme classes' own
colours where a figure draws the classes apart, Read from the paper's cyan for the figures of records read from the paper; pointing at a mark gives it a 2px outline in its colour, dims the others and gives its exact count. Figure 1's bar, the
histograms and the ridges are images with a summary;
the bar charts are HTML, so their names stay links and their counts text. Names Browse can filter on link to
`#browse?` with the shared filter keys. The full rules are in the site's
DESIGN.md, "Stats".

## Stats: what the wild-type values show (round 16)

The user, 2026-10-21: "more stats that are more scientifically insightful and important, even as supplementary".
Five analyses of the wild-type records read from the paper (enzyme_form wild; each value in the unit CatLog stores, a
value in another unit or without one left out), counted at stage time by scripts/build-catlog-followup-summary.py
(WildTypeInsights, into overview.from_paper_insights: between_papers, substrate_range, km_by_size, temperature, typical;
about 3.3 KB) from the Full data download. An enzyme is a name and organism (name_key of each); between papers it is a
UniProt entry. Every fold is 10 to the power of a median of log10 values. Each caption is one sentence: what is drawn,
the records, papers and enzymes it uses (statsUsedText, "1 enzyme" in the singular) and the one caveat that matters; the
rest of the rule is under the figure's number in How these numbers are counted. Nothing pairs what it cannot match, and
no sentence is causal. Each is drawn only when its counts hold together (bars add up to their total, quantiles in
order). All wear Read from the paper's cyan (records read from the paper), in Variants against their wild type's panel
style (stats-range stats-insight: a heading, a line of facts, bars with a tooltip line each, a count line) or in Values
by enzyme class's rows (statsMediansPanel: a dot for the median on a line for the middle 80%, p10 to p90, as Value ranges and
Values by enzyme class draw it, so the same mark means the same spread on the page (round 16 review: these rows had drawn
the middle half), the median and the count, headed n as in Values by enzyme class,
the rows centred on their line).

| Figure | Where | What is counted |
|---|---|---|
| Between papers | main, Values, after Value ranges | one UniProt entry and substrate (its SMILES, else its name) as wild type in two papers: each paper's value the median of its records (a calculated kcat/Km included, as the rule says), a pair of papers once per enzyme, substrate and parameter; fold difference in quarter decades from 1-fold (the last bar 100-fold and more), median, within 2-fold and 10-fold; a table of the same at a temperature (to 1 °C) and pH (to 0.1) both papers give (per shared condition the difference of medians, the pair's fold their median); a pair giving the very same number is left out (most are one lab's value printed again in its later paper) and the rule names how many (identical_left_out) |
| Substrate specificity | main, Values, after kcat against Km | a panel: one enzyme on three or more substrates in one paper with one cosubstrate, pH and temperature; per substrate the median kcat/Km (a calculated one included); the best over the worst in half decades from 1-fold (the last 10⁶-fold and more); a table of the median range by substrates tested (3, 4, 5, 6–9, 10 or more), since the range grows with them |
| kcat and assay temperature | supplement, Values | the kcat records in 10 °C bins (below 20, 20 to <30 ... 80 or more: each from its lower edge to below the next, so no edge is in two labels) as medians and middle 80% (different enzymes in each bin); a series, one enzyme and substrate in one paper at two or more temperatures with one cosubstrate and pH: Q₁₀ = 10^(10 × least-squares slope of log10 kcat on °C), bars of a tenth of a decade centred on 10^−0.5 ... 10^1, a dashed line at no change |
| Km and substrate size | supplement, Values | the Km records by the substrate's non-hydrogen atoms (counted from a one-piece SMILES: 1–5, 6–10, 11–15, 16–20, 21–30, 31–50, 51 or more) as medians and middle 80%; within a panel of four or more substrates of at least two sizes, Spearman's ρ of size and median Km, bars of 0.25 centred on −1 ... 1, a dashed line at no trend (all-equal Km counts at 0) |
| The typical wild-type enzyme (Table) | supplement, Values' first table | each parameter's median and 10–90% over its wild-type records (a calculated kcat/Km included, as the rule says), its records, papers and enzymes on a line under its name (three columns, so it fits a phone), beside the average enzyme of Bar-Even et al., Biochemistry 2011 (its value in the Median column, right under CatLog's median kcat/Km in M⁻¹ s⁻¹, its 10–90% a dash) (doi:10.1021/bi2002289; its link is a stats-ref-link that opens the DOI in a new tab, as the record's DOI links do: stats-link always opens Browse) |

The round 16 figures keep a number with its unit (a no-break space in "10 °C", "1 °C" and "28,000 M⁻¹ s⁻¹") and write the
name with a non-breaking hyphen (Bar‑Even, U+2011), so a phone line never ends at "per 10" or "Bar-" (round 16 review).
Bar-Even et al. 2011 was checked against the paper's abstract (PubMed 21506553 and Europe PMC, 2026-10-21): the average
enzyme's kcat/KM is about 10⁵ s⁻¹ M⁻¹ there, so only that number is set beside CatLog's (a constant in the page,
STATS_BAR_EVEN, with the link). Its kcat and KM medians are not used: PubMed's copy of the abstract lost the kcat's digit
("~0 s(-1)") and the full text (ACS) could not be reached. Km and substrate size's rule cites the abstract's finding that
low molecular mass appears to limit Km optimization. The linear axes (ρ, Q₁₀) take the conditions' axis class
(stats-condition-axis), so the narrow rule that thins a log axis's labels as powers of ten never touches them. Tests:
the builder's unit tests (test_wild_type_insights_pair_papers_panels_sizes_and_series, test_heavy_atoms_and_rank_correlation),
the page's node test of the five figures, and the browser check (check_stats_insights: each panel's bars or rows add up
to the overview's count, each figure in its part; the Chrome fixture adds all five), which reads only the DOM (Safari-safe).

## Team

"People behind CatLog" (#team): one line (CatLog reads enzyme kinetics from the original papers, mostly those the enzyme databases cite; fix pass after
round 16b: CatLog also reads papers no database cites, found by a literature search),
then the loop of stations
(Cited papers, AI reading, AI check, AI audit, Human check, Rules updated) with AI agents above
and people below by first name (Supantha also above Website; Vaishnavey at AI critique, which feeds Rules updated from
the lower-left corner, round 14; Mohammad on the people's row), live numbers from the manifest, nothing moving round
it (the chevrons give its direction; round 14 removed the circling dots), and a legend whose lines (the AI agents in CatLog's reading colour,
BPG cyan: a 12% tint, the 3:1 ring and a 60% legend square; the people neutral)
light their stations on hover or while pressed (toggle buttons). Upright below 960px. The full rules are
in the site's DESIGN.md, "Team".

## Guide

Short and plain (round 14, the user 2026-10-20: "the guide is still so verbose, AI ish, confusing and hard to
understand"; round 13 before it: "visuals help more ... a better to-the-point guide"). A newcomer understands in about a
minute what CatLog is, how to read a record and what each label means. Rules for every string in it:
- Each section opens with its answer, at most three short sentences; one idea per sentence; no paragraph or list item
  holds more than three sentences (a unit test counts them).
- No meta sentences ("This section explains ..."), no AI tells: no strings of em dashes, no "seamless", "robust" (the
  CatRange paper's own title excepted), "Note that", rule-of-three padding or a definition with a colon in every
  sentence. Facts only; a number the Guide does not need (the checks' results, the share of matching values) is Stats'.
- Visuals only where they are simpler than words: the four steps, the numbered record, the legend of labels and colours
  and small tables of the cautions, units and database results. They reuse the page's own components (status dot, tags,
  values table, filter chips, Browse's .db-mark squares, the "!" and the tick), so their colours follow the tokens (the
  palette is the look's: never a hard-coded colour here).
- The look is calm and editorial: hairlines between parts, no boxes round prose, no icons, no tinted washes, shadows or
  pill buttons (the contents are plain links); the example record keeps its 1px card, and its parts' numbers are small
  accent circles (CSS counters).
- One column up to 1000px, at the left of Stats' and Team's 1200px container (the same 24px gutters, so a view's title
  keeps its place when the tabs change; round 15 polish: the Guide's had been centred, 76px further right at 1440px);
  every paragraph outside a table keeps to 68ch of its own size (16px body, 14px in tables and legends; three had run
  the whole 1000px).

Word counts (Chrome at 1440px, the live round-13 data; prose = the words outside figure labels, legend items, tables,
reference data such as citations and database versions, and headings): round 13 had 1,524 words in view (374 of them
prose) and 3,043 with every disclosure open (1,443 prose); round 14 has 972 in view (143 prose) and 1,748 open (488
prose), and the page is 4,213px tall at 1440px instead of 5,418px.


Round 17 (Chrome at 1440px, the live October 22 data; in view = innerText with every disclosure closed, open = all
open): before, 1,077 words in view and 1,894 open; after, about 1,040 in view and 1,900 open (the record, the value,
the paper and the labels now come first; the Cite and Sources and licenses parts became one License and citation
section; the chips legend and the dash's second line went, and the cautions fold).
The introduction (h1 "Using CatLog"): "CatLog reads enzyme kinetics (kcat, Km, kcat/Km) back from the papers the enzyme
databases cite. AI agents read and check each value; people review samples. 75,000 of 185,804 records are read from the
paper so far." (one verb, read from the paper, as the labels say; round 14; the counts from
the manifest, renderRereadLines, shared with Team) and, in small type, "By the Chowdhury Lab, Iowa State University."
(CatLog-27k, the CatRange paper's training set, is named in Cite). Never a "download" agent or papers collected in bulk.
Then "On this page": the sections as a wrapped row of plain links, in this order and with these addresses (other pages
link to them; keep every one):

- Records and values (#guide-words, round 17: first, the user's "how are they going to know the values and records and
  entries?"; heading #guide-words-title). One Browse row drawn with the table's own parts (.guide-row: Enzyme, Organism,
  Substrate, kcat, Km, kcat/Km with their units, Review result as the table's .state-badge with its tags, so the look's
  marks apply here too): the real record 07fd908d4f44bfe6 (HAPMO, Pseudomonas fluorescens, 4-aminoacetophenone, 12.7 s⁻¹,
  8.2 × 10⁻⁴ mM, 1.5 × 10⁴ mM⁻¹ s⁻¹, Table 1 of PMID 12514023, the record Read a record draws). A hairline bracket
  "3 values" over the three value cells and one "1 record" under the whole row (--line-strong, muted 13px labels, no
  colour of their own; aria-hidden, the caption says it: "One record and its three values, from Table 1 of one paper
  (PMID 12514023)."). Under 900px the row stacks as a card (enzyme, organism, substrate, the three values side by side
  under their bracket, the review result). Then the three words as a term list, one line each (Record: "One row of
  Browse: one enzyme, wild type or a variant, with one substrate under one set of assay conditions in one paper.";
  Value: "One number: a kcat, a Km or a kcat/Km. A record holds up to three."; Paper: "One publication; a paper can give
  many records."), then the labels the row carries, #guide-status (a role=group labelled by its Review result heading,
  which Browse's "Review result and tags in the Guide" and Stats' review-result caption link): Review result (the four
  results; Accepted's words from guideAcceptedDefinition) and Tags (from paper, not re-read, said as "Not yet re-read:
  from CatLog's earlier version, built from the enzyme databases; replaced when CatLog reads the paper.", human-checked,
  earlier extraction, corrected, no paper linked), the same legend groups and classes as before, said here once.
- How CatLog works (#guide-method; heading #guide-method-title, which Stats' and a record's links focus). Under it How
  CatLog reads a value (#guide-how-read, its h3 #guide-how-read-title set as a small 13px muted label, not a second
  heading: a record links its moved method boilerplate here as "How CatLog reads a value →"): four steps in a row
  (one under another below 900px), each under a 2px accent rule with its number (a CSS counter) and a small arrow on the
  rule between two steps: Read ("An AI model (Claude, Anthropic) reads each value, its unit and conditions, and the line
  it is printed in."; the model and vendor named once in the Guide), Check ("A second, separate AI check compares every
  value with the paper. Automated checks confirm the line is in the paper."), Compare (automatically, with what the
  enzyme databases list for that paper) and Review (AI audits and people re-check samples; what they find improves the
  next readings). Then one line, "Units are converted automatically; no model types a converted number.", then Records
  not yet re-read (#guide-earlier, a muted 13px label like How CatLog reads a value's; round 14): "CatLog's earlier
  version built them from the enzyme databases. Its automated review checked part of them against their papers; each
  record's review result says what it found." (round 17: two sentences; the results themselves are the labels'
  definitions above) (every record not yet re-read
  links it), and two links, "Checks so far on Stats" (#stats-quality) and "People behind CatLog" (Team). The site says "automated checks" and
  "found automatically", never "code", as the README does.
- Read a record (#guide-record): "Select a row to open its record." then a record drawn as the panel draws it, in the
  panel's order (title, EC · organism · form, substrate; the status line with tags; the values table with ticks, As
  printed and its caption "Printed in Table 1"; the quoted line "In the paper: …"; Compared with databases, the real
  record's three lines, 07fd908d4f44bfe6, BRENDA's Km 10× the paper's 0.82 µM; Checks with Second check and Human
  review; Conditions, Protein and substrate and Paper as plain labels), each part numbered (plain 14px accent figures,
  no discs, as a journal figure labels its parts), beside a numbered key of one
  short line each (under it below 900px); the Checks key line links How CatLog reads a value. A part the snapshot lacks
  (Compared with databases) is hidden with its key line, so the numbers stay in sequence. On phones the example's values
  table puts each As printed under its value. When the record's sections change, this example changes with them.
- Marks and cautions (#guide-marks, round 17; was Labels and colours, #guide-status, whose labels moved up): a grid of
  legends under hairlines (two columns, one below 760px), no intro line: Marks beside a value (tick, "!", calc., dash;
  side by side on phones too) and Compared with databases (the five squares in Browse's colours, shown with the
  comparison). Filters in use (the chips) is gone in round 17: Browse's chips say what they are, with their ×. Then two
  folded parts in the Reference's style (.guide-ref, closed at first; a link or address opens them): Cautions
  (#guide-cautions, its h3 #guide-cautions-title in the summary, the gist "What each ! beside a value means"): one table,
  a row per Cautions filter group as the sidebar names it (kcat/Km mismatch, Unit or magnitude error, No unit given,
  Temperature questionable), holding its cautions by the names shown beside a value, each with what it means in
  brackets; Unit or magnitude error says once "The unit or the value may be wrong." (above diffusion limit: above
  10¹⁰ M⁻¹ s⁻¹, the limit the caution uses). On phones each row stacks, its group as a 13px muted label. And Evidence
  labels (#guide-evidence, "On records not yet re-read"), a few words each.
- Compared with databases (#guide-databases, marked data-guide-database-section with its line in the contents and under
  Questions; shown when the manifest's summary.database_comparison is there, or the record index lists database_summary;
  written from the manifest only): the lead in two sentences (the compared databases from the manifest's sources list,
  else the databases its counts name, else the six in the code, never a typed "five"; then "This snapshot compares N
  values from M papers."; the share of matching values is Stats'). Results (h3): one table, Result | Values | Records,
  in Browse's order, each name after Browse's own square (.db-mark db-mark-<result>, so the look's palette applies;
  none on Corrected earlier, glossed "records not yet re-read"); the numbers right-aligned in tabular figures, the
  records linked to #browse?db=<key> where Browse has that option; "every value of the record" under Not in the
  databases, and "exact factor, not yet checked" (the paper's × 10ⁿ, 60 or 3,600) under Different number when counted,
  as indented rows; a count the manifest lacks leaves its cell empty, Corrected earlier left out when the snapshot counts
  0. The results' meanings are the legend's, never repeated here. Under the table the caveat, once: "A different number
  can mean a different measurement; it does not by itself mean a database is wrong." Then one disclosure, "How the
  comparison works" (its summary the h3 #guide-databases-compared): how values are paired and what is not compared (calc.
  with its count, values per mg/mL, records not yet re-read), the databases with versions, dates and values, and three
  small tables side by side (one under another below 900px), a label and its count of values each: Cause of a
  correction (#guide-databases-causes, the four families of DATABASE_CAUSE_FAMILIES, Stats' list), Found by
  (#guide-databases-found: a separate AI check of the paper; an exact factor the paper's kcat ÷ Km agrees with; an older
  comparison's code count goes on the second) and Why no database lists a value (#guide-databases-not-listed, the six
  reasons, the papers no compared database lists beside the last); then "Counts by parameter and database are on
  Stats."
- Before you use the values (#guide-caveats): four short checklist lines (only Accepted passed review; read each value's
  unit; a printed kcat/Km can differ from kcat ÷ Km; split training sets by paper or UniProt accession), each after a
  plain muted en dash (round 14's fix pass: a rotated chevron read as a closed section that does nothing).
- Reference (an h2 with no address of its own): Find records (#guide-find), Units (#guide-units) and Downloads
  (#guide-downloads), each a `<details class="guide-ref">` closed at first, its summary one row (44px or more): a + or −
  in the accent, the name as an h3 (16px/600, its id the one a link focuses) and a 14px gist ("kcat s⁻¹ · Km mM ·
  kcat/Km mM⁻¹ s⁻¹" for Units). An address or a link to one (the contents, "Units" in the checklist) opens it
  (openGuidePart, from renderView and guideSectionHeading). Inside: Find records (Search with example chips and "Gene
  names are not indexed.", Filters (the groups in view: enzyme, EC number, organism, substrate; parameter; review
  result), More filters (source, wild type or variant, assay conditions, compared with databases only when the Guide
  shows its database section, cautions and source database; it opens by itself when one is set), Share; "Try": example
  views in the #browse? format); Units (the three catalog units as hairline rows: name, unit, meaning; then × 10ⁿ,
  Digits, T and pH and Other units, one short line each; the dash is the marks legend's); Downloads (Full data, Table,
  Compared with databases when the manifest has its comparison download ("one line per value and database"), Format
  with the Dataset notes link (#guideDatasetNotesLink, the README), Review files, the Download full data button).
- License and citation (#guide-licence, round 17, the user: "every entry doesn't need the license, CC, snapshot line;
  say it once"; Browse's footer line "CC BY 4.0 · Snapshot … · How to cite" links here): one sentence ("CatLog's
  compilation is free to reuse under CC BY 4.0, with credit. Quoted paper text remains the publisher's; database records
  keep their own license."), then Snapshot, Data ID and Cite as term rows (the paper's citation and the snapshot's
  citation line, selectable as a whole), all in view; then two folded parts: More on citing (#guide-cite: one value's
  record ID and keeping the file, the Data ID check with its file name, CatLog-27k, the CatRange paper's training set)
  and Sources and their licenses (#guide-sources: the list the manifest fills, each license named on its own after the
  source, no "License:" before it, with the source's records; the curation note). Visible spelling: license (the user's
  word); the address keeps the brief's #guide-licence.
- Questions (#guide-questions, native disclosures): why a value differs from BRENDA, why a sequence or SMILES is
  missing, how to report an error; one or two sentences each.

A section's address opens the Guide at that section, and a link to one (from Stats, a record, the filters or the
contents) opens it in the page with focus on its heading (made focusable then, so a page opened at a section shows no
focus ring); the Guide never downloads the record index. Records are "read from the paper" and "not yet re-read" there,
as in the Source filter and Stats (never "older records", never v1 or v2); every "re-read" keeps one line. The earlier
version is named only in the method section and in a tag's or status's help. When the table or the record panel
changes, the Guide's picture and wording change with it. The page keeps exactly two Full data links (Download menu and
Downloads) and one Table link: the release script rewrites them by count. They save as catlog-<snapshot date>-full.jsonl.gz
and catlog-<snapshot date>-table.jsonl.gz (set from the manifest when the page starts). License and citation gives the
snapshot date and the Data ID, and its More on citing the command that checks it (the first 10 characters of the SHA-256
of the decompressed Full data file) and says to keep the file used; Sources and their licenses says to cite a database
whose records are used; the exporter commit stays in the README.

## Verification

Use the existing data loader, immutable manifest, downloads, and stable URL.
Verify real desktop and mobile layouts, filters, empty results, page changes,
keyboard focus, overlay dismissal, record downloads, and unchanged data hashes.
Generated mockups guide layout only; their text is not a scientific source.

## Round 13 visitor fixes

- The filter sidebar is position:relative, so what it holds (the visually hidden More filters label) is clipped by its
  scroll box and never lengthens the page: the Browse page does not scroll as a whole on a desktop.
- Phone cards: organism and substrate each wrap to two lines before they are cut; at 360px and below the substrate takes
  its own line under the organism, without the dot (round 15 polish: on any phone too when the organism takes two lines).
- A record's In the paper quote shows the JBC fonts' code points for ±, ×, − and µ as printed, and a 12px --muted line
  under it when the text layer lost symbols (the snapshot's printed_line_note, or a replacement or private-use
  character).
- Stats' Human review headline says beside its share how many entries had a value the reviewer could not find.
- Stats' Compared with databases figures and tables count the exact-factor values not yet checked against the paper
  under Different number, as the lead does (overview.database_factor_only splits them by parameter and database).

## Round 14 words and polish

- Words (the user, 2026-10-20: "do some passes on the verbose too for the overall setup"): every string the site makes
  says its facts in as few words as it can: a group's "?" a line per option, the Download and Export menus a few words
  per file ("Every field, with sequences, SMILES and paper links"; "The table's columns; no sequences, SMILES or paper
  links"; "Values read from the paper, one row per database listing the paper (CSV)"; "Source records and review
  notes, on request by email"), the review results' definitions without "Passed review:", the Not yet re-read help
  "from CatLog's earlier version, built from database entries and partly checked against the papers; replaced when
  CatLog reads the paper.", the empty record panel "Select a record to see its values and sources." Sentences that come
  from the data (database lines, review notes, the README) are reworded where they are made, in catlog-v2.
- The Download menu gives a file's rows, size and format on a line of their own under what it holds (the spans keep a
  line break: white-space pre-line), so no line starts with " · ": "185,804 rows · 42.6 MB · JSON Lines (gzip)" for Full
  data and Table (fix pass: "Table" read like a spreadsheet), "CSV (gzip)" for Compared with databases; a muted last line
  under a hairline says where a filtered set goes: "The records you filtered: Export results, above the table (CSV)."
- Every disclosure opens with a muted + (− when open): Stats' How these numbers are counted and Fields saved in records
  that are not accepted, and the Guide's Questions and evidence labels, as the supplement, the record and the Guide's
  Reference do; no triangles.
- The counts band's labels are all muted (fix pass: the colour sits on each label's mark and on the number).
- Checks on the values is a table (fix pass), so no card or blank meter remains to line up.
- kcat, Km and kcat/Km are in italics with subscripts in the database lines and the Human review line of a record too
  (kineticWordsHtml: never before or after a hyphen, so a name such as "Ki-67" stays as written). Round 15 polish: the
  record's caution notes too (metricWordsHtml; "The paper's kcat/Km (0.01 mM⁻¹ s⁻¹) is 3.0-fold above kcat ÷ Km" had
  stood in roman between the table and the database lines), and the record's sentences (cautions, grey notes, database
  lines and what the AI check found, Human review) set a unit's or a power of ten's exponent with <sup>, as the Values
  table does (superscriptsHtml; As printed keeps the paper's text).

## Round 15 counts band

- One even row (the user, with round 14's band: "Any more polish? The screenshot segment could still be improved,
  right?"): the four key numbers and the parameters in five columns as wide as each other, a label, a number and a line
  of context in each, lined up across the band (Layout, "The counts band"); no empty stretch before the date, which ends
  the line above. One thin rule, before the parameters; none between the key numbers (type in columns, not KPI tiles).
- The line above says what CatLog is and no longer repeats the band's two numbers; Browse's [data-reread-lede] is gone
  (only the page script and the tests had read it; the Guide's and Team's [data-reread-line] keep their counts).
- Every line of context is a checkable fact: the papers, Accepted's share of the records, Read from the paper's share
  and papers, Human-checked's share of the accepted records ("approved by reviewers", a definition a scientist could
  read as journal peer review, was dropped). Shares never print a rounded 100.0% or 0.0%; a filtered view names its
  papers only when the page counts them as the snapshot does.
- The snapshot date never disappears: in the line above, else at the end of the parameters' line in the card (tablets,
  short windows, small phones under More). Round 14 had it in the card's top right, and on phones only under More.
- Heights (Chrome, the system font, 2026-10-21): 109px from 1024px (round 14: 99), 129px on tablets (119), 163px at
  375px (169); in a short window 87px (75), the table's 340px kept (453px at 1024 x 600, 348px at 800 x 600).

## Round 15 polish

- Stats' percent charts (Values compared with databases and the two supplement figures of earlier changes) give their
  shares in a table under the bars whose column heads are the legend's names, each after its swatch (a grid of
  percentages each behind a colour square, with no heads, had left colour the only key); on a phone the same numbers
  turn round (the results as rows, the chart's rows as four short heads), one table shown at a time. The two counts
  beside Values compared with databases' bars stand under the legend's own names in two lines, "Corrects / a value" and
  "Different / number" (they had read "Corrects" and "Differs").
- "On this page" is one component on Stats and the Guide: a 13px --muted label on its own line, then the parts as a
  wrapped row of 14px/500 links 20px apart (28px targets), no separators; Stats' links keep their parts' numbers, muted.
  Stats' had been one inline line whose "·" separators ended every wrapped line on a phone.
- Stats' smaller slips: Value ranges' histograms fill their column with Figure 6's 16px insets, so the two figures share
  one width and left edge (they keep Values by enzyme class's decades and ticks, no longer its x, since that figure moved
  to the supplement); Figure 3 sets Accepted's counts in navy as it does Read from the paper's in dark cyan, both 600,
  under the legend's words ("Read from / the paper", its short tag From paper below 360px); Checks on the values draws
  a hairline 100% track behind each bar. Legend names link wherever Browse's filter shows exactly what they count: in
  Figure S6 a database's Different number and Same, other label also count values whose own result is another, so they
  stay plain text.
- The Guide's small slips: every group of Labels and colours keeps one 11.5em term column, so the definitions in one
  column start at one x (Tags' had started 32px left of Compared with databases'); the Reference's disclosures open with
  the muted + every other disclosure has; a Results cell with no count shows the dash the Units section says marks no
  value.
- One apostrophe, the typographic ’: escapeHtml sets it for an apostrophe after a letter and before an English ending
  (paper’s, CatLog’s, BRENDA’s, isn’t) in the page's own sentences and in the data's, as the Guide's text has it; a prime
  in a chemical name (2'-deoxyguanosine, 3',5'-cyclic AMP, N,N'-...) and an address keep theirs (Browse's search reads ’
  as '). The page's own strings use ’ at their source.

## Round 16 CatLog and BRENDA by publication year

- The figure the user approved on 2026-10-21 (catlog-v2 work/brenda_lag_20261021/broad/brenda_catlog.png and its README:
  "similar, but up to date"), drawn by the page in What is in the catalog, after Records by main source: kcat, Km and
  kcat/Km values per publication year of their paper, first_year to last_year (2000-2025), in BRENDA's release (BRENDA
  2026.1) and read by CatLog, from the manifest's summary.publication_years, which catlog-v2's build writes (the data
  contract: tools/site_patches/20261021-site-round16-brief.md in catlog-v2; an optional shaded_from moves the band, else
  2020). catlog-v2's build (tools/publication_years.py) adds definition, catlog_papers_without_year and
  catlog_before_first_year: with them the years drawn, the values before and after them and those with no PubMed year
  make CatLog's totals exactly (each paper has one year or none): the caption names the values before first_year and after
  last_year, the counting rules those with no year (counted only in the total). Since the round 16 review CatLog's side
  dates a paper without a PubMed ID by BRENDA's reference year (sources/nopmid_refs.tsv), as BRENDA's side does, and counts
  only values in the site's units (a Km or kcat/Km per mg/mL left out), so its total is the Full data download's and
  Values per paper's. No field, or counts that do not hold together (a
  year missing or out of order, a count that is not a whole number, more values or papers in the parts than in CatLog's
  totals, parts that miss the totals when the build's two counts are there, no release name or date): no figure, nothing
  else changes.
- As approved: a line with a dot per year for each source; the years BRENDA is still adding papers from (2020 on) on a
  plain grey band with open dots, explained in the caption (never "curation incomplete"); direct labels on the lines
  ("BRENDA 2026.1", "CatLog, read so far"), no legend box; BRENDA's highest year and its last year before the band
  labelled with their counts; "CatLog on Oct 21, 2026: 217,969 values from 6,116 papers" above the plot; kcat and Km
  italic with subscripts in the axis title; the comparison ends at last_year, and CatLog's values from papers published
  after it are in the caption, not drawn. The site's own look: CatLog in Read from the paper's cyan, BRENDA in dark grey
  (--text-2, Type And Color), light gridlines, the counts in full ("15,000", not thousands), ticks every 5 years.
- One sentence of caption: the band and CatLog's values outside the years drawn, so the lines and the caption add up to
  the note above the plot ("BRENDA is still adding papers from the shaded years (2020 on); CatLog also has 33,203 values
  from 956 papers published before 2000 and 9,086 from 349 papers published after 2025."); the counting rules (PubMed
  year, a paper without a PubMed ID in the year BRENDA gives for both sources, CatLog's values in the site's units, those
  with no year counted only in its total, how BRENDA's entries count) are the figure's under its number in How these
  numbers are counted.
- Lines in an SVG stretched over the plot (2px, non-scaling); dots, labels and ticks are HTML placed in percent, so they
  stay round and upright at every width. statsPlaceYearLabels places the labels in the viewer's own font, when Stats is
  drawn and whenever the plot changes size: each name along the flattest stretch of its line before the band, on the
  line's outer side (else between the lines), nearer the middle on a tie, then BRENDA's two counts right above or below
  their dot (centred where either side has room, else shifted along it; never beside it, where a count reads as the next
  year's; a count with no room is left out, the year's tooltip line has it). The figure is drawn with a key above the
  plot and the key goes once both names have a place (is-labelled), so a plot with no room for a name keeps the key.
  With the approved numbers both names fit from 320px and the two counts from 641px (on a phone they give way).
- A column per year carries the year's tooltip line ("2009: BRENDA 2026.1, 14,970 values; CatLog, 10,167 values from 265
  papers"); pointing at it draws a hairline through the year and grows its two dots. The plot is an image whose
  accessible name gives each line's first year, highest year, last year before the band and last year, and the band.
- Plot 320px tall (280px below 1024px, 240px on phones), at most 840px wide with its axes (a 2.5:1 plot, near the
  approved figure's proportions), a 16px column after the plot so the last year's label stays inside the figure.

## Round 16b: quality numbers with their scope (catlog-v2's publication review, items 1-8)

Every number comes from overview.quality (catlog-v2 human_review.quality, copied by build_overview's marks_quality) or the
manifest's database comparison; a field an older snapshot lacks leaves its words out, and the page reads as before.
- Human review: the share is over the entries a reviewer could check against a paper (review.v1.checkable); the 166
  entries without a paper are said beside it (At a glance's title, Quality's sentence, "Shares are of the 2,604 entries
  with a paper." under the verdicts) and Table S1 counts the flags of the checkable entries. "Entries" is glossed where
  Stats first uses it, Quality's lead since the fix pass ("People checked 2,770 entries from the earlier version (431
  papers), each a record as reviewers saw it; ..."). Team's Human check gives the same share.
- Checks on the values: the audit's share with its 95% Wilson interval (audit_wrong_ci95, kept only when it holds the
  share) and how many of the wrong values sit in two papers (audit_wrong_top2 of audit_wrong, with more than two papers);
  human-checked records with their values beside them (overview.human_checked_values: the approved values on those
  records). Under the table, one note (quality.exposed): the papers whose reading agent, or only a checking agent, opened
  database values or the earlier version's files, the days the log spans and the blind re-reads they were sent back to.
- Errors found in CatLog (quality.catlog_errors): a small table in the checks table's style, one row per way an error
  was found (AI audit; catalog-wide sweep after an audit or check, its reprinted values and partial constants under the
  name; unit misprinted in the paper, corrected; check of a database difference against the paper), Values and Papers,
  then All (each value once) set off by a hairline and weight; a route with no values has no row; counts that do not
  hold together (a route above All) draw nothing.
- Table S2's caption says who checked the values that differ and how many of how many ("AI agents checked 323 of the
  555 that differ against the paper; 232 are still to check."); values that cannot be compared count as checked.
- Compared with databases' lead keeps the corrections an AI check of the paper found apart from those an exact factor
  found (when both counts add up to the corrections) and calls them a lower bound when the comparison says only
  differences of checked_from_factor-fold or more are checked.
- STRENDA DB's numbers stay its own paired ones (values_by_database: Figure S6, Table S10); no agreement claim names it.
- How these numbers are counted: Human review adds "An entry with no PMID or DOI could not be checked against a paper,
  so the shares leave it out." with the entries-with-a-paper base, and Human-checked says what its values are when the
  overview counts them.

## Fix pass after round 16b (2026-10-22)

- The human-review counts are joined (they had stood as 99.9% of entries, 85.8% of records and 4,522 approved values with
  nothing between them): Checks on the values' Human-checked row says "2,005 records with a reviewer’s verdict" and
  "1,721 (85.8%) accepted with every value approved (3,486 values)"; its counting rule names the other 284 (a value not
  approved, or not accepted) and what the review and Approved values read from the paper again count instead
  (statsHumanCheckedBridge). The review of records read from the paper (quality.review.v2) is said in counts, never as a
  share of so few: how many were drawn at random and picked as hard cases, the free-to-read papers, and how many had a
  value disputed (reviewFromPaperText; its values when catlog-v2 counts them).
- Approved values read from the paper again (Table S2): its caption says what it counts ("The 4,522 values reviewers
  approved on 383 papers CatLog has since read, as CatLog has them now."), then the errors this comparison found in CatLog
  and their fixes from agreement.first_catlog_errors and its parts ("Comparing them found 68 wrong labels and 1 missed
  value in CatLog, all fixed since."; nothing when the parts miss the total), then the AI agents' checks of the values
  that still differ. "Cannot be compared" is "Left out by CatLog’s rules (reprint, Hill fit)" (and in the older lead,
  "left out by CatLog’s reading rules (a reprint, a Hill fit)"). The first comparison's share and the share on papers
  read without database values stay off the site, as round 6 (2026-10-13) decided.
- Substrate matching (Browse's Substrate field and the substrate part of the search box): a word matches only where it
  starts a part of the name (substrateStarts: the name's start, after a character that is not a letter or digit, after a
  digit, after capitals written onto the name, "UDPgalactose", or where capitals follow a small letter, "MgATP"), each
  start kept folded and compacted so locants typed apart or together still match. "lactose" finds 383 records, not
  1,472 (D-galactose, UDP-galactose ...); "ethanol" no longer finds methanol, "pyruvate" phosphoenolpyruvate, "alanine"
  phenylalanine. Enzyme and organism names still match inside a word ("kinase" finds hexokinase). The Substrate field's
  title and the Guide's Search line say it in one sentence.
- Stats' tables have no bars (statsTable, Units as printed): in the supplement most had been slivers under 3px that read
  as rendering debris, their column's left edge moved from table to table (476 to 703px at 1440), and the Share column
  beside them says the same.
- A record open beside the table below 1440px: Organism gives way as EC and the arrow do (the record shows the
  organism), so kcat, Km and kcat/Km stay in the 536px pane at 1024px and the names get Organism's room at 1280px; the
  records title takes no row when nothing in it shows (its visually hidden lines kept a 30px row and a 45px empty band
  above Columns, Export and Sort). The browser check opens a record at 1024 and 1280px and measures both.
- One key per percent chart: Values compared with databases and the earlier version's corrections keep their legend (its
  names link to Browse) and their share table's heads in words; the table's heads and the counts beside the bars no
  longer repeat the legend's swatches. A legend's linked names are underlined only under the pointer or focus, so a name
  with no Browse filter (Same number) does not look broken beside them.
- Team's Human check draws its share in one short line on the wide loop ("99.9% of 2,604 entries undisputed") and two on
  the upright one, over "1,721 human-checked records"; its label keeps the phrase in full. The people's and agents'
  chips are as wide as their names in the viewer's font plus 14 units a side (teamFitChips, measured once the loop is
  drawn, again when a font loads or the window changes), so "Mohammad" in DejaVu Sans has the room the other names have.
- The note on papers read or checked with database values in view (statsExposureText) says first why it matters
  ("CatLog’s reading and checking agents are meant to work without database values, so that agreement with the
  databases is a fair test."), keeps its subject whole, accounts for every paper (sent back to be read or checked again,
  with reread_blind_read and _verify when catlog-v2 gives them, and "the other 6 have not been sent back") and says that
  their values stay in CatLog and in the comparison meanwhile. The Guide's Read step adds "without seeing what the
  databases list". No Browse filter or record tag marks these papers yet: the data has no per-paper field for it.
- Checks on the values' Second AI check gives a result as the other rows do: "169,901 values in 75,000 records (4,324
  papers)" and "163,908 values confirmed, 5,993 corrected (3.5%); values it rejected are left out", from
  overview.from_paper.values and .checks, which build_overview counts at stage time from each value's proof line
  (check_result: confirmed, corrected or other); a snapshot without them keeps the method in words.
- Compared with databases' lead keeps two sentences but no longer splices: "Of the other 3,359, 2,681 correct a database’s
  number (1,745 found by an AI check of the paper, 936 by an exact factor found automatically); the remaining 678 differ
  for a reason not yet known, and some may be other measurements in the paper rather than database errors." The note
  under Values compared with databases gives one total as the Dataset notes do (20,403 numbers that match no value CatLog
  read), then what CatLog has in another form (paired with a CatLog value of another number, a calculated kcat/Km,
  another parameter), the reprints and the possible misses, which are not yet checked (statsNotReproducedText), and links
  the Dataset notes (README_FIRST.txt, datasetNotesHref, as the Download menu names it) for the reasons of the rest.
- Results by database, Paired values by database and Corrections by cause and database carry the lead's qualifiers
  (statsCorrectionsQualifiers): the caption says Corrects is a lower bound when the comparison gives checked_from_factor,
  and the rule says how all the corrections were found (an AI check of the paper, an exact factor), which the comparison
  does not count per database; so no per-database share reads as a database's error rate.
- Look-alike rows: records of one paper, enzyme, variant and substrate at one temperature and pH whose values differ (6,448
  groups among the records read from the paper on Oct 18) say "other assay details" under the substrate, titled with
  what it means (the record's Assay and Preparation say how they differ), so rows that read the same but for their values
  no longer look like duplicates. The difference itself (free or immobilised, buffer or milk) needs catlog-v2's export
  to write it into condition_note; the table then shows that note instead, as it does today.
- The Guide's FAQ no longer says CatLog "never guesses" a sequence or SMILES (name and EC lookups can be wrong, and some
  were): "otherwise the field stays empty (uniprot_candidate_ids lists the candidates)". Sources and licenses says the
  licence once, in its summary line, with the field (source_license). The README's file names for the Data ID check are
  catlog-v2's (site_release.py).
- Value ranges and Values by enzyme class say in their captions that they count all records, those not yet re-read
  included (about 45% of the kcat values drawn), as the figures round them count only records read from the paper.
- kcat against Km labels each line of equal kcat/Km on the line itself, three quarters of a decade in from where it
  leaves the plot, along its slope as "diffusion limit" is, on a plain ground that parts the line (a contour label);
  the labels along the top edge and down the right side had read as a second x axis and a repeat of the y ticks. A line
  with less than a decade and a half in the plot has none. The frame's right column is 16px (the last x tick's half).
- Stats sets the exponents of its sentences, legends and table cells with <sup>, as its axes, table heads and the record
  do (statsSuperscriptsHtml on the drawn page: text only, never a tag, an attribute or an SVG); the page's plural
  possessives are written with ’ ("the AI agents’ readings", "the reviewers’ own files").
- Figure 1 (Review result) draws its results as one 100% bar over its legend table, as wide as the table (640px at
  most; statsStatusBar: a segment per result, Not checked's hatched, its count on its tooltip line, lit with its row);
  the donut with "185,804 records" in its hole repeated the table beside it and was the page's most dashboard-like mark.
- Every 100% bar (Values compared with databases, by enzyme class, by database, the earlier version's corrections) is one
  length, 560px, wherever it stands (a narrower column shrinks it; on a phone it spans the row), its label, bar and
  value columns starting at the left: at 1440px they had been 900, 916, 580 and 584px.

## Round 16b data follow-ups (2026-10-22: catlog-v2's quality branch)

Each new field is optional; a snapshot without it (Oct 18's) reads as before.
- Errors found in CatLog: the second route is "Searches for an error an audit or check had found", as catlog-v2's README
  names it, and its kinds read "reprinted from an earlier paper", "per-product (partial) rate constants" and, when
  catlog-v2 counts them (sweep.other), "others", shown only when the three make the route's values. The database-check
  row says what became of the values (database_check.removed and .corrected, the rest "awaiting a further check"; "all
  removed" when one fate takes them all), shown only when those parts fit (statsErrorKinds).
- Checks on the values' AI audits row: when catlog-v2 gives the follow-up audits apart (audit_targeted_values and
  audit_targeted_wrong, which build_overview's QUALITY_FIELDS now copy), its counts are the random audit's, so Covered
  says "6,477 values drawn at random" and the result ends "Follow-up audits of whole papers and of values a check had
  questioned checked 188 more values and removed 46, counted under Errors found in CatLog." (the last clause only with
  that table). The two-papers sentence shows only when catlog-v2 writes audit_wrong_top2, which it now does only while
  those two papers hold most of the drops. Team's "values re-checked" counts both.
- CatLog and BRENDA by publication year: when catlog-v2 gives BRENDA's papers (years[].brenda_papers, each no more than
  its year's values, making brenda_papers_total), the note above the plot adds a second line, "From 2000 to 2025,
  CatLog’s values come from 6,308 papers and BRENDA 2026.1’s from 22,415.", each year's tooltip line gives BRENDA's
  papers, and the plot's accessible name says both. The caption opens with the reading order: "CatLog reads the papers
  the databases cite for the most values first, and papers no database cites as well, so its line does not show how
  much of BRENDA it covers."
- The review of records read from the paper (review.v2) says "none of their N values was disputed" when catlog-v2 counts
  the values (review.v2.values), else "no value was disputed".
