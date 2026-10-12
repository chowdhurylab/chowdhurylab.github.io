---
name: CatLog
description: A compact enzyme kinetics workbench for reading measurements and their sources.
colors:
  background: "#ffffff"
  text: "#172120"
  text-2: "#3d4845"
  muted: "#5f6b68"
  primary: "#245f58"
  border: "#d3dcd7"
  status-accepted: "#339cff"
  status-pending: "#f3883b"
  status-unverified: "#a9b1ae"
  status-not-reviewed: "#9b79ec"
  status-disputed: "#e02e2a"
  human-checked: "#17733a"
typography:
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Inter, system-ui, sans-serif'
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0px
  table:
    fontSize: 13px
  scale: 11, 12, 13, 14, 16, 18, 22, 28px (Stats labels 15px, Stats notes 14px)
  weights: 400, 500, 600
spacing: 4, 8, 12, 16, 24, 32px
---

# CatLog

## Layout

Start with the table, not a landing page. Keep Records, Accepted, Read from the
paper, Human-checked and the three "With kcat · Km · kcat/Km" counts in one 48px
line, labels and counts on one baseline, the snapshot date at its end (its title
is the Data ID; Stats is a tab, not a band link); from 1181 to 1339px the gaps
tighten, and a window still too narrow wraps the date to a second line; from 641
to 1023px it takes two lines (Records, Accepted, Read from the paper,
Human-checked; then the With counts and the date, with no divider at the start of
a line); on phones the line keeps Records and Accepted, Human-checked takes the
next line with the More button, and More shows the rest (Read from the paper
first). Read from the paper N links to those records (#browse?source=paper plus
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
table's columns with their units and stored digits, review result (the exact
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

Filters open on request at every width. From 1440px they are a column beside
the table (288px; no overlay, the table stays usable) and the results follow
each change; from 1600px they stay open beside an open record, below that a
record takes their place and closing it brings them back where they were.
Beside them a name column is never narrower than its longest word (a line may
break after a hyphen, comma or slash); a table still too wide scrolls sideways
with the Columns control, edge shadows and Enzyme kept in view. Narrower than
1440px (where a column would squeeze the names to a few letters), they are an
overlay that ends with a "Show N records" button. The panel order: Source (three
radio buttons: All records, Read from the paper by CatLog and From enzyme
databases, the last two with a one-line help under them, the first ending in a
link to the Guide's #guide-method; "By database" folds the databases, STRENDA DB,
earlier paper extractions and Source not recorded: ticking one selects From
enzyme databases, a merged record counts under each database it names, and All
records or Read from the paper clears them), Review result (Accepted, Not
confirmed, Not checked and Disputed, each tick in its status colour; "Only
human-checked" sits under Accepted, its tick green, and ticking it ticks Accepted;
its count waits for the review marks; then Status definitions: the four results
and the tags, the method in one line with a link to #guide-method), Enzyme, organism and
substrate (labelled fields, the EC number first), Measurement type
(ticking several shows records with all of them), Wild type or variant (a note
says how many records state neither), Assay conditions (temperature °C and pH, from
and to, either may be empty; a bound that is not a number is outlined and
ignored), then Cautions (grouped as the "!" notes), which starts closed and opens
when one of its options is set. Every option shows how many of the current
results it covers, counted with its own group set aside (so ticking it shows, or
adds, that many); an option at 0 is grey and stays clickable. The counts are
worked out after each change in idle moments, in slices (never while typing),
and a newer change restarts them; meanwhile the panel is marked busy
(data-counts="pending", aria-busy) and the numbers fade if that takes a moment. Each active filter and the search is a chip
above the table that removes it, followed by Clear all; the count beside Filters
is the number of chips. Esc closes the panel (beside an open record, the one
holding the focus). Typing filters 180ms after the last key; the search text of
every record is prepared in idle moments once the search box or the filters
get focus.

Browse with filters has the address #browse?key=value&... (q, status, checked,
ec, enzyme, organism, substrate, metric, variant, tmin, tmax, phmin, phmax,
caution, source, sort, rows, page, record; comma lists; unknown keys ignored).
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

The search box's placeholder names what it finds (enzyme, EC number, organism,
substrate, UniProt ID or PMID). Empty, it offers one fixed line of examples
("Try: hexokinase · 1.1.1.1 · Escherichia coli · NADH · P00330 · PMID
15989682"), each a search with results; the name fields offer three of their
own; nothing is drawn at random. Search matches every word in any order, ignoring case, accents, Greek letters
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
catalog's own views, Browse · Stats · Guide; the links out, "CatRange paper ↗"
and "Chowdhury Lab ↗", sit apart at the right (beside Download; on phones the
first reads "Paper ↗"). At 1180px and below the header is one grid on every
view: brand and Download, the tabs with the links out at the line's end, then
search (Browse only). A selected record uses a separate right
column on desktop and a full-height dialog on smaller screens. Never put details
below the table or cover desktop measurement columns. Keep 25 rows per page,
scrolling within the table, and the page controls reachable. An open record's
address names it (record=<record key>, replaced, not added to history, and
removed when the record closes), so it can be shared; opening such an address
shows the record on its table page once the index (and, with Human-checked on,
the review marks) has it, and a key the snapshot lacks is put in the search box
with a note that it is not there. Marks that arrive after a record opened redraw
its panel in place (the rows and focus stay).

While records load, placeholder rows keep the table's shape and, until the first
rows appear, the count beside Filters says how many have loaded ("Loading
records…" when only the files are counted). Loading and failure notices use
plain words, never file, shard or chunk names: a page older than its data says
"This page is out of date. Reload to update it."; the technical detail goes to
the console. Page 1 appears
from the first rows of the index, which arrives in Review-status order, and
stays in place when the rest arrives; sorting waits for all records (an address
with a value sort keeps the placeholder rows and says "then sorting" until
then, never a provisional top 25). Stats and
Guide never download the record index. kcat, Km, kcat/Km, T and pH sort both
ways, from the Sort menu or by clicking the column header (high to low first,
then low to high); the header's arrow shows the direction, and records without
the value stay last. Review result stays the default order (Disputed sorts with
Not checked, as the index arrives).

## Type And Color

Use the existing system font, tabular numerals, and zero letter spacing. Table
names break between words and hyphenate a word longer than its column (a break
inside a word only as a last resort; the Organism column is at least about 13
characters wide); only SMILES and sequences break anywhere. No serial comma;
tags are lower case, filter labels and headings sentence case. One
type scale (front matter) and weights 400/500/600 only; no text below 11px.
Colours are tokens in the stylesheet's :root, the only place hex values appear.
Table numbers share regular weight; enzyme names use medium weight. Reserve
semibold for counts, section headings, and the selected record's main values. Numeric
headers and values align right. Names wrap to two lines; the full name is on
hover and in the record. A variant's mutation (the bare signature, "D102E", or
"variant, not specified") has its own line under the name, a small teal tag that
is never clipped with the name, which then keeps one line; wild type shows
nothing. Every table row has the same height. Value markers
(no unit, calc., a caution) sit beside the value, never under it; a caution's
words are in its tooltip and the record, and on phone cards beside the "!"
(they may wrap to the next line there). A caution states the problem, never an
order: the tooltip is the record's note ("Printed kcat/Km (2.2 s⁻¹ mM⁻¹) is
1.6-fold above kcat ÷ Km (1.3 s⁻¹ mM⁻¹). All three are stored as the paper gives
them."; a familiar factor is named as a fact, and on a record read from the
paper the printed numbers' own arithmetic says when they agree in one unit); the
short words are kcat/Km mismatch, Km > 10 M or Km < 1 nM, kcat > 10⁷ s⁻¹ (10⁸
for a larger value), possible 1000× unit error and above diffusion limit. The
Cautions filter names kcat/Km mismatch, Possible unit or magnitude error, No
unit given, Temperature questionable and No cautions.

Status cells align left: a dot and the review result (Accepted, Not confirmed,
Not checked or Disputed: words that define themselves and promise no further
work), then whole-word tags on a second line that always starts with the source: "from paper" (read by CatLog), the
databases (BRENDA, SABIO-RK, OED, UniProt, SKiD, STRENDA DB; a merged record names
each), "earlier extraction" or "source not recorded". Columns are sized to the page's content: values, EC, T, pH and Status are
as wide as their widest entry and never wrap; Enzyme, Organism and Substrate
start as wide as three in four of their names. The room left in the window goes
to the name columns, first until their names fit on one line, then in
proportion to their widths, so the table fills the window and the arrow sits
right after Status. In a narrow window the names give way (two lines, broken
between words while they can; the full name is on hover), and when that is not
enough the table scrolls sideways. Temperature and pH are two plain numeric columns, T (°C)
and pH, with a dash when the value is missing. The table writes
numbers at or above 10⁵ and below 10⁻³ as a × 10ⁿ. It shows no more precision
than was measured: at most 4 significant figures, 3 when the stored digits from
the fourth on are a ÷60 artefact (30.333 shows 30.3, 5.1667 shows 5.17), never
fewer than a number's integer digits below 10⁵; up to 4 printed digits stay as
stored, trailing zeros included (135.0, 0.030). A kcat/Km CatLog calculated, or
an earlier-catalog kcat/Km of unstated origin that equals kcat ÷ Km within 0.1%,
carries "calc." (its title says which) and the significant figures of kcat and
Km. Tooltips, the record's "In catalog units" and the downloads keep the stored
digits. Every column fits from
about 1010px; narrower screens scroll the table sideways with the enzyme name
kept in view. With a record open, EC, T, pH and the arrow give way; Status
stays. On phones (640px and below) each record is a card: name and EC;
organism · substrate; the variant's mutation; kcat, Km and kcat/Km with their units as labels; the
two-line status badge, then °C and pH at the line's end.
The filters overlay (below 1440px, phones included) ends with a "Show N
records" button. Filter chips use the teal tint with a thin teal line, 12px
text, and wrap within the page gutters.

White and neutral surfaces carry the data. Teal marks selection and actions;
status uses a coloured dot (the Stats outcome colours) and ink words: accepted
blue, not confirmed orange, not checked grey (Unverified and Not reviewed
alike), disputed red; the filter's ticks use the same colours. Amber marks
cautions. Green (human-checked, 5.9:1 on white) is only for
"human-checked": a small check drawn before the tag, weight 500, no pill or
background, in table badges, phone cards, the record's status line and Human
review line, the counts band and the Guide. The tag shows on accepted records
only; it updates in place when the marks arrive (rows are not redrawn). On a
phone card the badge keeps its two lines and T and pH sit at its right; a tag
line too long for the room left ends in an ellipsis. Use thin dividers, modest
control radii, and
shadows only for overlays. No decorative gradients, statistic cards, or hero art.

## Record Details

Keep values, units, warnings, protein form, identifiers, and paper links visible.
The header tells records of one paper apart: the name; "EC 1.4.1.20 · Bacillus
sphaericus · N145A variant" (nothing for wild type; an EC the paper does not
print reads "EC 2.3.1.183 (from enzyme databases; not printed in the paper)");
"Substrate: ..." (two lines
at most; a longer name is also given in full under Assay conditions); one status
line in the table's words and colours: the review result ("Not checked
(Unverified)" keeps the earlier status in brackets), the source ("from paper", or
the databases as the table names them: "BRENDA", "earlier extraction", "source not
recorded"), then "corrected", "no paper linked" or "✓ human-checked" ("Accepted ·
from paper · ✓ human-checked", "Accepted · BRENDA · corrected"). Then, in this order: Measurement (the values,
each caution once as a plain note under them, and for a record read from the
paper "As printed in the paper (Table 2)": one row per value with As printed and
In catalog units, a Check column only when results differ); Assay conditions
(cosubstrate, temperature, pH, other conditions as a short list, preparation);
Paper and review (links; for a record read by CatLog a Method line, the short
method sentence ending "units converted by code" or "values stored as printed"
with a link to the Guide's method section, and a Check line, one result for
every value or a pointer to the Check column, then an AI audit line with the
audit's date and verdict only when one re-checked the values; for an older
record its Review line; a Human review line with the reviewer's facts-only note on every record
that has a mark; merged rows; an older record's notes); Protein and structure; Source details,
collapsed, with one licence line; the actions. Odd records read plainly: a name longer than 64 characters is set
at 16px so the header that stays in view stays short; "Unknown" EC or organism
reads "EC unknown" / "organism unknown"; a record without kcat, Km or kcat/Km
says so (or that it stores a Ki only); a missing sequence or SMILES reads "None
recorded"; a paper's stand-in ID (NP and 8 hex digits) is text, never a PubMed
link, and Report a problem names the DOI when there is no PMID. A flagged value
carries a small "!" button that moves to its note; nothing is readable only on
hover. The record writes numbers like the table (a × 10ⁿ at
or above 10⁵ and below 10⁻³, the same display rule in the value strip, the stored
digits in its values table); a kcat/Km CatLog calculated for an older record
keeps the significant figures of kcat and Km. An older record whose
stored kcat/Km is a unit factor off shows the source's own kcat/Km that agrees
with kcat ÷ Km, and its note gives the stored number. Sequence and SMILES
strings and an older record's review notes expand on request. Do not discard
source text, hide scientific warnings, recompute measurements, or weaken review
definitions to make the page shorter. Database attribution belongs in Guide and
dataset notes, not the Browse footer.

## Stats

One plain page from the snapshot manifest (never the record index): two
headline lines, then sections that each have a heading, at most one line of
explanation and plain bars (name, bar, count, share of all records). Colour
marks review status only, with the status dot colours; other bars are one
teal. Names Browse can filter on link to `#browse?` with the shared filter
keys. Value ranges show the median, the 10–90% range and a log histogram per
metric in catalog units. The full rules are in the site's DESIGN.md, "Stats".

## Guide

One reading column (72ch, 16px body). The introduction says what CatLog is and,
in one sentence, that the CatRange paper (PNAS Nexus, linked from the header) describes
CatLog-27k and that this site is the growing catalog that followed. Then "On
this page", a short contents list (three columns, two on phones) linking to the
sections, in this order and with these addresses: Find records (#guide-find:
search, filters, sort, sharing a view, and example views linked in the
#browse? format), Read a record (#guide-record: the panel's parts, one worked
from-paper record drawn as the table and the panel draw it, and Cautions, one
line per short caution word), Review status (#guide-status: each status with the
table's own badge, then each tag, human-checked with its check and green),
Units (#guide-units), Downloads (#guide-downloads), Before you use the values
(#guide-caveats), Cite (#guide-cite), Sources and licenses (#guide-sources) and
Questions (#guide-questions, native disclosures). A section's address opens the
Guide at that section; the Guide never downloads the record index. Terms and
meanings are two-column lists, one line each where they fit; no walls of text.
Long lists of labels go in native disclosures. Shorten duplicate instructions
rather than scientific qualifications. When the table or the record panel
changes, the Guide's wording and example change with it. The page keeps exactly
two Full data links (Download menu and Downloads) and one Table link: the
release script rewrites them by count.

## Verification

Use the existing data loader, immutable manifest, downloads, and stable URL.
Verify real desktop and mobile layouts, filters, empty results, page changes,
keyboard focus, overlay dismissal, record downloads, and unchanged data hashes.
Generated mockups guide layout only; their text is not a scientific source.
