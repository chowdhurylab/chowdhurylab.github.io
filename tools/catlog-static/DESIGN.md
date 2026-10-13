---
name: CatLog
description: A compact enzyme kinetics workbench for reading measurements and their sources.
colors:
  background: "#ffffff"
  surface-2: "#f6f8f7"
  text: "#172120"
  text-2: "#3d4845"
  muted: "#5c6865"
  line: "#d3dcd7"
  line-soft: "#e7ece9"
  accent: "#245f58"
  accent-hover: "#1b4a44"
  accent-tint: "#e8f2ef"
  status-accepted: "#3C5488"
  status-pending: "#F39B7F"
  status-pending-ring: "#c4664a"
  status-unverified: "#8491B4"
  status-not-reviewed: "#B09C85"
  status-not-reviewed-ring: "#8c7a64"
  status-disputed: "#DC0000"
  human-checked: "#17733a"
  caution: "#8a5a14"
  caution-tint: "#fff6e8"
  compare-same: "#00A087"
  compare-differs: "#7E6148"
  compare-new: "#4DBBD5"
  change-magnitude: "#E64B35"
  change-precision: "#91D1C2"
  bar-neutral: "#7d8885"
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
  scale: 12/16, 13/18, 14/20, 16/24, 18/24, 20/24, 24/28, 32/36px (size/line height)
  weights: 400, 500, 600
  numbers: tabular-nums lining-nums
spacing: 4, 8, 12, 16, 24, 32, 48px
radius: 4px (controls), 0 (bars)
layout:
  header: 56px
  counts-band: 64px
  gutter: 24px (16px below 1024px)
  sidebar: 256px (to 1439px), 288px (1440px and up); rail 48px
  record: 440px (1024-1439px), 480px (1440px and up)
---

# CatLog

## Layout

Start with the table, not a landing page. The page is one grid on a 4px spacing
scale with 24px gutters (16px below 1024px): a 56px header, a 64px counts band,
then [filter sidebar | table | open record]. Rules are 1px --line between regions
and --line-soft inside them; there are no gradients, and shadows only on the phone
sheet, dialogs and menus.
Stats, the Guide and Team scroll inside their own view under the header; the
document itself never scrolls (each view is positioned, so screen-reader-only
text deep in a page cannot reach past it).

The header is one 56px line from 1024px: brand ("CatLog", enzyme kinetics
catalog), the catalog's tabs Browse · Stats · Guide · Team, the links out set
apart by a thin rule, the search box (at most 560px) and Download. From 1024 to
1279px the brand drops its tagline and the links out read "Paper ↗" and "Lab ↗",
so the search box keeps room for its placeholder. Tabs are 14px/500, the current
one 600 with a 2px accent rule under it.

Keep Records, Accepted, Read from the paper, Human-checked and the three "With
kcat · Km · kcat/Km" counts in one 64px line: numbers 20px/600, labels 13px
--muted, on one baseline, the snapshot date (12px) at its end (its title is the
Data ID; Stats is a tab, not a band link). From 641 to 1439px the gaps tighten.
From 1181 to 1439px "With" is read out but not shown; a window still too narrow
(or "Matching records") moves the date under the counts, inside the same 64px.
From 641 to 1180px, too narrow for the counts on one line, the band always takes
the same two lines (Records, Accepted, Read from the paper, Human-checked; then the With
counts and the date, with no divider at the start of a line); below about 740px
Human-checked moves to a line of its own. On phones the line keeps Records and Accepted (numbers still 20px;
a filtered "Matching records" count too wide for one line puts Accepted under it),
Human-checked takes the next line with the More button, and More shows the rest
(Read from the paper first). Read from the paper N links to those records (#browse?source=paper plus
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
offers "All N matching records (CSV)", "This page (CSV)" and "This page (JSON)".
The CSV is built in the page from the loaded index, a slice at a time: the
table's columns with their units and stored digits, the condition note under the
substrate (condition_note, so look-alike records of a paper stay apart), review result (the exact
value), human-checked, source, PMIDs, DOIs, UniProt ID and record ID, one line
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
"Filters · Clear all · ×" at the top (Clear all while a filter is on) and "Show N records" (accent, 44px) at the
bottom; Esc, × or that button close it, and Escape never closes the sidebar.
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
while a filter is on, «);
its groups are native disclosures with 13px/600 summaries (13px 16px, 44px for
one line; the chevron and any "?" stay level with the title's first line when a
wide font wraps it), a soft rule between them, options in 28px rows (14px box, 13px label, the 12px --muted
count at the right; a label a wide font wraps takes a second line, box and count
on its first, and never runs into the next row) and 32px fields, their labels in
a column as wide as the longest. The sidebar is compact (the user, 2026-10-13):
one short line per option and no help paragraphs; a group with explanations has a
24px round "?" beside its chevron that shows them in a quiet --surface-2 box under
its title (and hides them again). The panel order: Source (three
radio buttons: All records, Read from the paper (read out "by CatLog") and Enzyme
databases; its "?" says what each holds, that a merged record counts under each
database and links to the Guide's #guide-method; "By database" folds the databases (the Open Enzyme Database as "OED", the
table's tag, read out and on hover in full), STRENDA DB,
earlier paper extractions and Source not recorded: ticking one selects From
enzyme databases, a merged record counts under each database it names, and All
records or Read from the paper clears them), Against the databases (shown only when the snapshot carries the comparison:
the record index's optional database_summary, one number per record that
scripts/build-catlog-viewer-index.py takes from the Table download's database
fields or the Full data download of the same records (where the CatLog side's
export puts them: each proof line's database_status, an earlier corrected
record's corrections list; a Table field of the same name wins), the per-value
database_status, a record summary or the corrections list; never an empty heading: Corrects a value,
Different number (not yet resolved), Same number (every compared value), Adds a value (a
value no database lists for the paper), Not in any database (none listed) and,
when a record has one, Corrected earlier (by the earlier automated review). Each result has one short
name (DATABASE_RESULT_NAMES), the same in the option, its chip, a record's result word and
its links to records like it, and short enough for one line beside a five-digit count
at 1024 to 1439px with a wide font or a scrollbar ("Corrects a database value" and
"Changed in earlier review" took two); the group's heading says "databases" and the
longer meaning is each option's title and the "?". A record matches any option
ticked; its "?" says what is compared and what each option means; address key
db=corrects,differs,same,adds,new,earlier), Review result (Accepted, Not
confirmed, Not checked and Disputed, each tick in its status colour; "Only
human-checked" sits under Accepted (shown as the green "✓ human-checked" tag, read
out "Only human-checked"), its tick green, and ticking it ticks Accepted;
its count waits for the review marks; unticking Accepted unticks it; its "?" gives
the four results and human-checked in one short sentence each (each option's
title has the full definition) with a link to the Guide's #guide-status, where
the tags are defined, so the box stays small and the options stay in view), Enzyme, organism,
substrate (labelled fields, the EC number first), Measurement type
(ticking several shows records with all of them), Wild type or variant (a note
says how many records state neither, "1 record does not ...", and is hidden when none), Assay conditions (temperature °C and pH, from
and to, either may be empty; a bound that is not a number is outlined and
ignored), then Cautions (grouped as the "!" notes), which starts closed and opens
when one of its options is set. Every option shows how many of the current
results it covers, counted with its own group set aside (so ticking it shows, or
adds, that many); an option at 0 is grey and stays clickable. Before the record
index arrives, Review result, Measurement type and the three Source choices show
the snapshot's own counts (Read from the paper is the counts band's figure,
Enzyme databases the rest), the other options a dash. The counts are
worked out after each change in idle moments, in slices (never while typing),
and a newer change restarts them; meanwhile the panel is marked busy
(data-counts="pending", aria-busy) and the numbers fade if that takes a moment. Each active filter and the search is a chip
above the table that removes it, followed by Clear all (with no matching
records, "Clear search and filters" takes its place, so the toolbar has one clear
button; Clear all here and in the sidebar's heading are 24px tall targets at
least); the count beside Filters is the number of chips. Esc closes the panel (beside an open record, the one
holding the focus). Typing filters 180ms after the last key; the search text of
every record is prepared in idle moments once the search box or the filters
get focus.

Browse with filters has the address #browse?key=value&... (q, status, checked,
ec, enzyme, organism, substrate, metric, variant, tmin, tmax, phmin, phmax,
caution, db, source, sort, rows, page, record; comma lists; unknown keys ignored;
db only when the snapshot carries the comparison).
source=paper is Read from the paper by CatLog (the older status=v2 opens it
too), source=databases From enzyme databases, and source=brenda,oed,... those
databases (earlier_paper, unrecorded and strenda included).
It is read on load and on Back and Forward, rewritten in place (never a new
history entry) when the filters, search, sort, rows per page or page change, and
gone when nothing is set, so a copied link opens the same records. An open
record is added after the filters (#browse?...&record=<key>, without page: the
record's place decides it), or is #record=<key> when nothing is set, so reload,
a copied link and Esc keep the filters. An address without a record closes the
open one. A link to #browse?
from Stats or the Guide opens in the page without reloading the records. Rows
per page is remembered in this browser (localStorage, optional).

The search box's placeholder is short enough to fit on a laptop ("Enzyme, EC,
organism or substrate"); its accessible name says all it finds (enzyme, EC
number, organism, substrate, UniProt ID or PMID), and so does the line of
examples. Empty, it offers one fixed line of examples
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
back (with how many) or to clear everything. The header's tabs are the
catalog's own views, Browse · Stats · Guide · Team (#team, the people and agents
behind CatLog); the links out, "CatRange paper ↗" and "Chowdhury Lab ↗", follow
them, set apart by a thin rule. From 641 to 1023px the header is one grid on
every view: brand and Download, the tabs with the links out at the line's end
(Download ends where they end), then search (Browse only); on phones brand, the links out ("Paper ↗", "Lab ↗")
and Download share the first line (below 360px the header's gaps are 8px, so the two links keep one line at 320px;
only a wide system font puts them on two lines at the right, never over the brand), the four tabs share the second
across the
width, then search. The table's toolbar (48px) holds the active filters as chips
with Clear all at the left and Columns, Export and Sort at the right (when the
records are 721 to 1000px wide, beside the open sidebar or a record on a laptop,
the chips take the full width under that row instead of a narrow column beside
it, so none is cut; a chip's tooltip names its whole filter); on phones a
Filters button opens the sheet and the chips go under the toolbar (Filters,
Export and Sort stay on one row; below 360px "Sort" is read out but not shown
and the buttons are narrower, and to 389px the buttons are narrower while a
filter is on (the Filters count), so the menu shows "Review result" whole). A selected
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
from the first rows of the index, which arrives in Review-status order, and
stays in place when the rest arrives; sorting waits for all records (an address
with a value sort keeps the placeholder rows and says "then sorting" until
then, never a provisional top 25). Stats and
Guide never download the record index. kcat, Km and kcat/Km sort both
ways, from the Sort menu or by clicking the column header (high to low first,
then low to high); the header's arrow shows the direction, and records without
the value stay last. Review result stays the default order (Disputed sorts with
Not checked, as the index arrives). Enzyme, organism and substrate sort A to Z
skipping a name's leading quotes and brackets ('"Chelatobacter" strain ...' under
C, "[Bacillus] caldolyticus" under B). On a desktop the Sort menu is 180px, or as wide
as its longest option when a wider font needs more, so the chosen order always
reads whole ("kcat/Km, high to low" was cut in Verdana).

## Type And Color

Use the existing system font (no web font), tabular lining numerals, and zero
letter spacing; mono only for record keys, mutations, SMILES and sequences. One
scale of sizes with their line heights (12/16 units, ticks and counts in filter
options; 13/18 table cells, chips, labels and captions; 14/20 UI text and record
values; 16/24 Guide body; 18/24 Stats section headings; 20/24 counts band
numbers and record title; 24/28 Stats and Guide titles; 32/36 Stats headline),
each a --fs-N / --lh-N token in the stylesheet. Table
names break between words and hyphenate a word longer than its column (a break
inside a word only as a last resort; the Organism column is at least about 13
characters wide); only SMILES and sequences break anywhere. No serial comma;
tags are lower case, filter labels and headings sentence case. One
type scale (front matter) and weights 400/500/600 only; no text below 12px.
Colours are tokens in the stylesheet's :root, the only place hex values appear
(other areas use the tokens: --st-* for review status, which figures fill at 60%
with a 1px opaque outline, --cmp-* and --chg-* for the database comparison and kinds
of change (and for the Stats lead's agreement set, which reuses their hues; see the
root DESIGN.md), --bar-neutral for single-series bars and table bars, --caution* for cautions,
--checked for human-checked, --accent* for actions).
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
(they may wrap to the next line there). The table shows no temperature or pH (the
record, the filters and the downloads have them), so a temperature caution's "!"
and its short words, T questionable, open the grey line under the substrate, on
desktop too (before any condition or series note, "· +10 mM FBP"; the "!" has the
record's note as its tooltip); the record says it on its Temperature line, and the
Cautions filter finds it. A caution states the problem, never an
order: the tooltip is the record's note ("The paper's kcat/Km (2.2 s⁻¹ mM⁻¹) is
1.6-fold above kcat ÷ Km (1.3 s⁻¹ mM⁻¹). All three are stored as the paper gives
them."; a familiar factor is named as a fact, and on a record read from the
paper the printed numbers' own arithmetic says when they agree in one unit); the
short words are kcat/Km mismatch, Km > 10 M or Km < 1 nM (flagged from the stored
value on older snapshots too), kcat > 10⁸ s⁻¹ (an older snapshot's flag on a kcat
up to 10⁸ s⁻¹ is dropped; Stats counts the same way), possible 1000× unit error, above diffusion limit
and T questionable. The
Cautions filter names kcat/Km mismatch, Possible unit or magnitude error (the
sidebar says "Unit or magnitude error", one line at 256px; its chip and the
Guide keep "Possible"), No unit given, Temperature questionable and No cautions.

Review result cells (the column is headed "Review result", as in the Guide) align left: a dot and the review result (Accepted, Not confirmed,
Not checked or Disputed: words that define themselves and promise no further
work), then whole-word tags on a second line that always starts with the source: "from paper" (read by CatLog), the
databases (BRENDA, SABIO-RK, OED, UniProt, SKiD, STRENDA DB; a merged record names
each), "earlier extraction" or "source not recorded". "no paper linked" marks a
record without a PMID or DOI; under the user's review rules (an export that
counts accepted_basis) such a record is Not checked, and a record whose every
value a human reviewer approved is Accepted (its record says so: "Accepted
because a human reviewer approved every value"). Columns are sized to the page's content: values, EC and Review result are
as wide as their widest entry (and their heading) and never wrap; Enzyme, Organism and Substrate
start as wide as three in four of their names. The room left in the window goes
to the name columns, first until their names fit on one line, then in
proportion to their widths, so the table fills the window and the arrow sits
right after Review result. In a narrow window Review result's human-checked tag
first keeps only its green check (its word stays in the badge's tooltip and
accessible name; what that frees beyond the need goes back to the names: one
human-checked row had held Review result at 194px beside the 1280px sidebar and cut
every enzyme name above its variant tag), then the names give way (two lines, broken
between words while they can; the full name is on hover), then they go to their
minimums, then Review result's tags
(the badge's accessible name and the record keep them all), and when that is not enough the
table scrolls sideways. The table has no temperature or pH columns (the user,
2026-10-13: the rows stay about the enzyme and its values); the records of one
paper's temperature or pH series on the page (the same enzyme, variant, EC,
organism, substrate and source, whatever their values or review result) say
which is theirs under the substrate ("pH 6.5", "37 °C", "pH not stated",
"temperature not stated", "pH and temperature not stated": spelled out, as the
table has no T column; only the
part that differs in the series; the tooltip adds "this paper also measured this
enzyme and substrate at another pH", or, for records whose values another record
shares, "otherwise the same as another record of this paper"). The table writes
numbers at or above 10⁵ and below 10⁻³ as a × 10ⁿ. It shows no more precision
than was measured: at most 4 significant figures, 3 when the stored digits from
the fourth on are a ÷60 artefact (30.333 shows 30.3, 5.1667 shows 5.17; a kcat or
kcat/Km stored with 4 figures ending 333, 667, 833 or 167, as 7.333 = 440/60,
shows 7.33), never fewer than a number's integer digits below 10⁵; up to 4
printed digits stay as stored, trailing zeros included (135.0, 0.030). A kcat/Km
CatLog calculated (kcat_over_km_origin "calculated"; an earlier-catalog kcat/Km of
unstated origin is never called calculated, even when it equals kcat ÷ Km) carries
"calc." and the significant figures of kcat and Km, at most 4. Its title is "kcat ÷
Km, calculated by CatLog; not printed in the paper." on a record read from the
paper and "kcat ÷ Km, calculated by CatLog." on an older one, whose source may list
a kcat/Km of its own (often the printed one). Tooltips and the downloads keep the stored
digits. The record's Value column follows the table's rule, except that a record
read by CatLog shows its values exactly as CatLog gives them, to the figures the
paper printed and never cut to 4 (value_display: 135.0 where the table shows 135,
1285.4 where it shows 1285), never more figures than the paper prints (a printed
47,000 M⁻¹ s⁻¹ reads 47, not 47.000); the 4-figure rule stays for older records
and for a kcat/Km CatLog calculated. The Guide's Units section says the same.
Every column fits in about 910px of table; a table with less room (beside the
sidebar or a record, or on a tablet) has tighter cells and then scrolls sideways
with the enzyme name kept in view. Table headers are 12px/600 --text-2 (units
12px --muted under them), cells 13px, enzyme names 13px/500, rows 44px (a variant's 12px tag is a 16px box and a condition note a 16px line, so neither adds height). With a record open, EC and the arrow give way; Review result
stays with its source line (the other tags give way). On phones (640px and below) each record is a card: name and EC;
the variant's mutation (under the name, as in the table); organism · substrate, with any note under the substrate on
its own grey line; kcat, Km and kcat/Km with their units as labels; the
two-line status badge. Below 390px kcat/Km (s⁻¹ mM⁻¹) does not fit a third of the card, so every value label puts
its unit on a second line, as the table's headings do, and the three values stay on one line; a wider label breaks
only before its unit, and a value too wide for its third breaks before its "× 10".
The phone filter sheet ends with a "Show N records" button. Filter chips use
the accent tint with a thin accent line, 12px text, and wrap within the toolbar.

White and neutral surfaces carry the data. One accent (--accent, 7.4:1) marks
links, selection, buttons and the focus ring (2px, 2px offset). Status uses a
coloured dot from the Nature BPG palette (ggsci NPG "nrc") and ink words:
accepted navy, not confirmed salmon, not checked slate for Unverified and tan for
Not reviewed (the word says Not checked for both; its title names which),
disputed dark red; the light salmon and tan dots carry a 1px darker ring. The
filter's ticks use the status colour, or a darker form where it is light
(salmon's ring colour, a darker slate), so a ticked box stands out on white and
does not look disabled. Amber (--caution) marks cautions. Green (human-checked, 5.9:1 on white) is only for
"human-checked": a small check drawn before the tag, weight 500, no pill or
background, in table badges, phone cards, the record's status line and Human
review line, the counts band and the Guide. The tag shows on accepted records
only; it updates in place when the marks arrive (rows are not redrawn). On a
phone card the badge keeps its two lines; a tag
line too long for the room left ends in an ellipsis. Use thin dividers, 4px
control radii, and shadows only for the phone sheet, dialogs and menus. No
decorative gradients, statistic cards, or hero art.

## Record Details

Keep values, units, warnings, protein form, identifiers, and paper links
visible, and say each thing once, in plain words. The record is a white column
with a 1px rule on its left: a header that stays in view, then sections, each
after a soft rule with a 14px/600 heading and a definition list (112px terms in
12px muted, 14px values; 96px terms on phones). A section with nothing to say
is left out, never an empty heading. Opening a record draws its whole header
at once from the table's row (name, EC and organism, substrate, status, record
ID), so the header keeps its place when the record arrives; below it, only when
loading takes a moment (after 240ms), "Loading record…" and a quiet outline of
the values in `--line-soft` bars (no animation with reduced motion). Another
record opens at its top. The heading takes focus for screen readers; its focus
ring shows after a key press (Enter on a row), not after a click or a link that
opens the record. The order is design spec 5's, with G (Against the databases)
moved up right after B (Values), so what CatLog corrected against the databases is
found at once: A, B, G, C, D, E, F, H.

- A. Header (stays in view; on phones and on screens up to 900px tall, where
  the whole header would take a third of the record or more, only the name and
  × stay, with a rule under them once the record scrolls, and the lines below
  scroll with the record): the name (20px/600; 16px when longer than 64 characters) and × close; "EC 1.4.1.20 · *Bacillus sphaericus* · Variant
  `N145A`" (the binomial in italics, a strain or "sp." roman; "Wild type" or
  "Variant, not specified"; nothing when the record does not say; an EC the
  paper does not print reads "EC 2.3.1.183 (from enzyme databases; not printed
  in the paper)"); "Substrate: ..." (two lines at most; in full under Protein
  and substrate), with the record's condition note under it in grey; one status
  line in the table's colours, the dot in the exact status's colour (slate for
  Unverified, tan with its ring for Not reviewed, salmon with its ring for Not
  confirmed), the result word at 13px/600: the review result ("Not checked
  (Unverified)" keeps the earlier status in brackets), the source ("read from
  the paper" for a record CatLog read, else as the table names it: "BRENDA",
  "earlier extraction", "source not recorded"), then "corrected", "no paper
  linked" or "✓ human-checked"; last the record ID in 12px mono and Copy link
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
  rest), and when its earlier review noted where the paper prints the values,
  a grey line under the table points to those notes under Paper. A calculated
  kcat/Km carries "calc." (on phones calc. and a "!" go under the number, so
  As printed keeps about 100px at 375px; at 320px a two-part unit may take two
  lines and the table still fits). A value a human reviewer approved carries a
  small green check (`--checked`, 12px) right after its number, named "approved
  by a human reviewer" (role img), and stays beside its number on phones: every
  value of a record the reviewer checked (mark.checked), the values the mark
  lists (mark.approved, when the marks carry it), or the metrics named by the
  review's own sentence "A human reviewer approved the same kcat and Km for this
  paper ..."; any other note marks nothing, and a calc. kcat/Km never has one
  (it is not printed). The first grey note under the table says what the check
  means: "✓ Approved by a human reviewer (see Human review below)." A row without
  the check, calc. or "!" keeps their space unseen (aria-hidden), so every number in the
  Value column ends at the same place; on phones the calc. and "!" space is dropped. Under the table: the
  kcat/Km a merged older record's sources list ("kcat/Km listed by OED: 3.0–6.1
  s⁻¹ mM⁻¹, 5 values", in the catalog unit, a range to 2 significant figures
  and a single value by the display rule, 126.667 showing 127; each end of a
  range is one unbroken number, so a long range breaks after its dash or before
  its unit and fits at 320px; shown when it differs from the
  record's kcat/Km or the record stores none, then the empty line says "No kcat,
  Km or kcat/Km is stored for this record; BRENDA lists a kcat/Km for it
  (below)."; a number a source also gives with no unit is listed once; Download
  record carries them as source_kcat_over_km_values), each caution once as an amber note
  its value's "!" moves to, the grey notes ("kcat and Km: converted by code from
  the printed units.", "kcat/Km: converted by code, printed unit read as 10³ M⁻¹
  s⁻¹." (a unit in CatLog's own words, in these notes, the Second check and the
  unit cautions, reads s⁻¹ whether the reader typed s^-1 or s-1; As printed
  keeps the text as read), "calc. kcat ÷ Km, calculated by CatLog; not printed
  in the paper."; an older record's "calc. kcat ÷ Km, calculated by CatLog." adds "OED lists its
  own kcat/Km (above)." when its sources list one, never "not printed" or
  "different": a listed value is often the printed one, the same to the figures shown),
  then each quoted line once (a line another value's line continues, one excerpt
  cut at two lengths, is quoted once, the longer): one line gives its place,
  "Table 2 row, as extracted from the paper's text" ("Table 2, as extracted ..."
  for a sentence, a line with no cells), or "As extracted from the paper's text"
  when the caption already names it; more than one line name
  their values instead, "kcat and kcat/Km line, as extracted from the paper's
  text" (at most 240 characters, table markers removed, K_M set as
  K<sub>m</sub>, caret exponents and charges set as superscripts: s^-1, mM^{−1},
  NADP^+, Mn^2+, and an exponent extraction split, min^− 1 or 10^−^3, as one);
  a row of more than four cells, or one whose ± signs extraction
  dropped, is folded under "Show the line as extracted" ("Show the kcat line as
  extracted" when the lines name their values) with that warning.
- C. Source: Source ("The paper (read by CatLog)" or the databases by name,
  never a raw key); Merged from (database entries and papers); the source's own
  details as rows of the same list, each wrapping (nothing to open at the
  record's end): Databases, the databases a merged record combines when they are
  not the Source's own (compared as a set, named in the Source's order); Name
  from on an older record ("BRENDA recommended name", "The source database's
  entry", "The EC list's accepted name"; a record read from the paper takes its
  name from the paper, which its Source says); Data origin when it is a plain
  word other than "experimental"; for a record read
  by CatLog a Method line (the short method sentence ending "units converted by
  code" or "values stored as printed", with "How CatLog reads and checks values
  →", the Guide section's own name, as every link to it reads; the link moves to
  the next line whole when it does not fit and wraps only on a line narrower than
  itself, so no phone scrolls the record sideways) and a
  Second check line (one result for every value, "All values confirmed." or
  "Unit set to mM for every value.", or each value's result, "kcat: confirmed;
  Km: unit set to mM."; then once what the check changed on the record, "The AI
  check also removed EC 2.7.2.12 and corrected the assay conditions"; a removed
  EC the header still shows says where the shown one comes from, "removed EC
  1.1.1.25 (not printed in the paper; the EC shown comes from the enzyme
  databases)" or "... from the UniProt entry A0A5H2WVH6"); for an
  older record an Evidence line ("Located in the paper", "Paper cited" on an
  accepted record or "Paper cited (values not located)" on one that is not,
  "Several database records" or "Database record only"); one
  license line (a source that names none reads "See the source's terms", as the
  Guide's Sources and licenses list says "License: see the source's terms"; a
  record with no recorded source reads "Not recorded"); the snapshot's data ID;
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
  shown, the source's temperature unit is unclear (source note: 30 °C)"); a
  cofactor that is the substrate is not repeated. A labelled row never shows a
  bare dash.
- E. Protein and substrate: Enzyme form ("Variant H150A", "Wild type"); one
  UniProt line, the accession and how it was found ("(inferred from EC number
  and organism)") or "Sequence known, no UniProt entry", "Several possible
  UniProt entries", "Not matched to UniProt"; each sequence as "605 aa" with Show
  (opens it under the row) and Copy, the variant's named by its note ("489 aa,
  UniProt P22498 with H150A"; a long list of substitutions wraps inside the
  record); without a sequence the row says why or "None
  recorded"; the substrate in full; SMILES with Show and Copy, or "None
  recorded".
- F. Paper: the title and year when the record carries them; PubMed and DOI
  links (a stand-in ID is text); where the values are printed; In CatLog, a
  link to the paper's records in Browse with this record kept open
  (#browse?q=pmid:<PMID>&record=<key>, or doi:<DOI>), "89 records from this
  paper →" once the record index is loaded ("Only this record" when it is the
  paper's one; a record naming several papers links to the first by name, "43
  records from PMID 35008493"); an older
  record's notes on request: "Earlier automated review: where the values are
  printed" (Where, As printed and Conversion, code quotes and "->" written as
  plain text and arrows; the Conversion line keeps each value's printed number
  and arithmetic and says "(no conversion)" for the earlier pipeline's
  reasoning, right after the value it is about and never after a unit
  conversion such as "/ 1000" or "converts to", uM reads µM). The notes never
  show the earlier pipeline's field names or how it fetched the paper:
  "Km raw_value=1.27 mM raw_unit=mM" reads "Km 1.27 mM" (a unit once), a
  printed cell other than the value is quoted ("kcat 0.022 s⁻¹, printed
  “(2.2 ± 0.1) x 10-2”"), "+/-" reads ±, "PubMed XML abstract PMID n" reads
  "Abstract" and "ScienceDirect HTML Table 1" "Table 1".
- G. Against the databases (only when there is something to say), laid out like
  the record's other lists so it wraps at any width (no table): for a record read
  from the paper, one item per value, the parameter in the label column, then its
  value and unit, its result (a 10px square in its comparison colour:
  `--cmp-same`, `--cmp-differs`, `--cmp-new`, `--chg-magnitude` for a database
  CatLog corrects by a unit or a power of ten, `--cmp-differs` for any other
  correction, `--bar-neutral` for the same number under another label, beside
  its word, the name Browse's option has: "Same number", "Different number",
  "Not in any database", "Corrects a value" (CatLog's "corrected" status: one
  database value, never the database as a whole), and "Other label", "Not
  compared"), then the snapshot's line as given ("BRENDA lists 1,300 mM, 1,000×
  higher. The paper prints 1.3 ± 0.10 mM (Table 2). Checked against the paper:
  µM entered as mM."), the cause in words when the line does not already say
  it ("Checked against the paper: a µM value entered as mM"; a cause code with
  no wording is left out, never shown as the raw code), and where the paper
  prints the value ("In the paper: Table 2, row ..."; a local path never); the
  databases a value's database_sources name only when there is no line. A line
  that starts with the result word ("same number in BRENDA, SABIO-RK") stands in
  the word's place, so the result is said once; a kcat/Km CatLog calculated gets
  a "Calculated; not compared" item once other values have items; a paper-level
  note above as plain section text (CatLog's sentence, not a quote), and
  "Compared with the values BRENDA, SABIO-RK, OED, SKiD and STRENDA DB list for
  the same paper. A different number can mean a different measurement." under
  it. When Browse has the "Against the databases" filter group (options named
  database; address #browse?db=...), a last line links each option the record
  matches to the records like it, by the option's name: "More records like this:
  Corrects a value · Adds a value" (corrects: a value corrected; differs:
  a different number not yet resolved; same: every compared value the same;
  adds: a value no database lists; new: no value in any database, said instead
  of adds; earlier: an earlier corrected record); an option the page does not
  have gets no link. An earlier corrected record with its correction trail: one item per
  changed field, "66 mM → **0.066 mM**" with the kind of change ("unit or
  magnitude (÷ 1000)" with the factor kept on one line, "more digits /
  rounding", "different number", "added: the source had none", "removed",
  "replaced"), "Before: as in OED for this paper" or "Before: earlier catalog
  value" (nothing for an added value's "none"), "In the paper: <where>"; then
  pH, temperature (in °C), identifiers ("UniProt P00325 → P00326") and a
  replaced sequence or SMILES ("Replaced", not repeated); a field whose value
  did not change is not listed; one closing note, "Changed in the earlier
  automated review to what the paper prints." (and "More records like this:
  Corrected earlier" when Browse has that option). A corrected record without its
  trail says so in its Review result line ("this snapshot does not list the
  changes"; the earlier catalog keeps them) and has no section G. A database
  record the earlier review did not settle (Not confirmed, Not checked) with a
  paper: "Not yet checked against the paper: the values are the database's."
  (not on one whose Evidence reads "Located in the paper": it has no section
  G). Colour is never the only carrier: the word or phrase is always printed.
- H. Review and audit: Review result in one sentence ("Accepted: read from the paper
  by CatLog.", or the earlier automated review's result with "How the earlier
  review worked →"); an AI audit line with the audit's date and verdict only; a
  Human review line with the reviewer's facts-only note on every record that
  has a mark (no review year); then Download record (the primary button) and
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
  carries them, Against the databases (each value's result, line, cause and
  evidence; or the earlier review's changes, Before, After and the kind of
  change; never an empty list or a local path); the license as the record
  shows it, once. The earlier pipeline's internal fields stay in the
  Full data.

A flagged value carries a small "!" button that moves to its note; nothing is
readable only on hover. A value whose printed concentration unit is not the one
CatLog read it in (µM printed, mM used) is such a caution ("printed unit
differs"), named by its value ("Km: The paper prints µM; ..."): its note says
whether kcat ÷ Km shows the unit used is right and, when an AI audit
re-checked the value, ends with what it found ("... and kept mM."); the note
stays amber. CatLog's own flag for it
(printed_unit_prefix_differs) counts as a possible unit error and is said once;
with the flag the table's "!" and the Cautions filter's Possible unit or
magnitude error find the record too (its title and the Guide's list of that
group name it), without it the caution is in the record only.
A merged older record whose listed kcat/Km values are all more than 2-fold from
kcat ÷ Km gets a note saying so (a "kcat/Km mismatch"; a familiar factor such as
1000 is named, and a fold past 10,000 reads "more than 10,000-fold"). A stored
kcat/Km flagged both against kcat ÷ Km and against every listed kcat/Km gets one
note for both ("The stored kcat/Km ... BRENDA lists kcat/Km 18.6 s⁻¹ mM⁻¹ for
this record, which agrees with kcat ÷ Km."). An older record whose
stored kcat/Km is a unit factor off shows the source's own kcat/Km that agrees
with kcat ÷ Km, and its note gives the stored number.

The record writes numbers like the table (a × 10ⁿ at or above 10⁵ and below
10⁻³, the same display rule); a value CatLog gives to the figures printed shows
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

One page from the snapshot manifest (never the record index): the agreement
with human reviewers first, as the lead (the success measure), then two
headline lines (32px and 20px), then numbered figures and tables, two to a row
from 1024px:
the review-result donut and its legend table, records by main source stacked
by review result, the database comparison, earlier corrections and replaced
records when the snapshot has their counts, the checks table, enzyme classes,
value ranges, then the top organisms and EC numbers, what the records contain,
wild type and variants, and cautions. Each has "Figure N." or "Table N." with
one sentence and a 12px data line (snapshot, Data ID, definition); fills at 60%
with 1px outlines in the review-result and comparison tokens. The donut and the
histograms are images with a summary; the bar charts are HTML, so their names
stay links and their counts text. Names Browse can filter on link to
`#browse?` with the shared filter keys. The full rules are in the site's
DESIGN.md, "Stats".

## Team

"People behind CatLog" (#team): one line, then the loop of stations (Papers, AI
reading, AI check, CatLog, Human check, Rules updated) with AI agents above
and people below by first name, live numbers from the manifest, dots moving
round it unless the viewer asks for less motion, and a legend whose lines
light their stations on hover or while pressed (toggle buttons). Upright below 960px. The full rules are
in the site's DESIGN.md, "Team".

## Guide

One reading column (72ch, 16px body). The introduction says what CatLog is and,
in one sentence, that the CatRange paper (PNAS Nexus, linked in the header) describes
CatLog-27k and that this site is the growing catalog that followed, then
points to the method ("How this catalog is built: see ..."). Then "On this
page", a short contents list (three columns, two on phones) linking to the
sections, in this order and with these addresses: How CatLog reads and checks
values (#guide-method: the only place the method is said in full; it opens
with the agreement with human reviewers in a light box, the Stats lead's
sentence word for word (the blind headline with its 95% range and what read
blind means) linked to Stats, left out without agreement counts; then a definition list of Read from the paper, AI audits, Human
review, Earlier catalog and Who does it (linking to Team); the
audit and human-review numbers are filled from the snapshot's overview when it
has them, never typed, and the items read without numbers otherwise; badges,
filters and Stats say it in one line and link here), Find records (#guide-find:
search, filters, sort, sharing a view, and example views linked in the
#browse? format), Read a record (#guide-record: the panel's sections, one worked
from-paper record drawn as the table and the panel draw it, and Cautions, one
line per short caution word), Review result (#guide-status: Accepted, Not confirmed, Not checked and
Disputed, each with the table's own badge, then each tag, human-checked with
its check and green),
Units (#guide-units), Downloads (#guide-downloads), Before you use the values
(#guide-caveats), Cite (#guide-cite), Sources and licenses (#guide-sources) and
Questions (#guide-questions, native disclosures). A section's address opens the
Guide at that section, and a link to one (from Stats, a record, the filters or
the contents list) opens it in the page with focus on its heading (made
focusable then, so a page opened at a section shows no focus ring); the Guide never downloads the record index. Terms and
meanings are two-column lists, one line each where they fit; no walls of text.
Long lists of labels go in native disclosures. Shorten duplicate instructions
rather than scientific qualifications. When the table or the record panel
changes, the Guide's wording and example change with it. The page keeps exactly
two Full data links (Download menu and Downloads) and one Table link: the
release script rewrites them by count. They save as
catlog-<snapshot date>-full.jsonl.gz and catlog-<snapshot date>-table.jsonl.gz
(set from the manifest when the page starts). Cite gives the snapshot date and
the Data ID with the command that checks it (the first 10 characters of the
SHA-256 of the decompressed Full data file), says to keep the file used and to
cite a database whose rows are used; the exporter commit stays in the README.

## Verification

Use the existing data loader, immutable manifest, downloads, and stable URL.
Verify real desktop and mobile layouts, filters, empty results, page changes,
keyboard focus, overlay dismissal, record downloads, and unchanged data hashes.
Generated mockups guide layout only; their text is not a scientific source.
