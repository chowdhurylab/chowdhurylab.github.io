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

Start with the table, not a landing page. Keep Records, Accepted, Human-checked
and the three Rows with values counts in one 48px line, labels and counts on one
baseline, the snapshot date and View stats at its end; on phones the line keeps
Records and Accepted, Human-checked takes the next line with the More button,
and More shows the rest. Human-checked N is a link to those records
(#browse?checked=1, plus the filters in the address); N is the snapshot's
summary.overview.human_checked_accepted until the records and marks load, then
the count among the current results, and the item is hidden when the snapshot
has no such count. Counts follow the current filtered
results; measurement coverage overlaps and must not form a stacked chart. The
count beside Filters is shown only when it says more than the page range.

Expanded counts separate review status from saved source material. Show the
denominator, record count, and share in aligned tables. Each record belongs to
one category per table; source categories follow the stored evidence precedence,
not an acceptance score. Explain the categories in a native disclosure. Keep
the bottom page controls compact, with page size left and navigation right.

Filters open on request at every width. From 1280px they are a column beside
the table (248px, 288px from 1440px; no overlay, the table stays usable) and
the results follow each change; from 1600px they stay open beside an open
record, below that opening one closes the other. Narrower, they are an overlay
that ends with a "Show N records" button. The panel order: Review status (the
three statuses, Read from the paper (CatLog v2), Human-checked: accepted records
whose badge shows "human-checked"; its count waits for the review marks), Names
and EC number (labelled fields), Measurement type (ticking several shows records
with all of them), Wild type or variant (records that do not say are in
neither), Assay conditions (temperature °C and pH, from and to, either may be
empty; a bound that is not a number is outlined and ignored), then Cautions
(grouped as the "!" notes) and Main source (a merged source counts for each it
names), which start closed and open when one of theirs is set. Every option
shows its count over all records. Each active filter and the search is a chip
above the table that removes it, followed by Clear all; the count beside Filters
is the number of chips. Esc closes the panel (beside an open record, the one
holding the focus). Typing filters 180ms after the last key; the search text of
every record is prepared in idle moments once the search box or the filters
get focus.

Browse with filters has the address #browse?key=value&... (q, status, checked,
ec, enzyme, organism, substrate, metric, variant, tmin, tmax, phmin, phmax,
caution, source, sort, rows, page; comma lists; unknown keys ignored). It is
read on load and on Back and Forward, rewritten in place (never a new history
entry) when the filters, search, sort, rows per page or page change, and gone
when nothing is set, so a copied link opens the same records. An open record's
#record= address takes its place until the record closes. A link to #browse?
from Stats or the Guide opens in the page without reloading the records. Rows
per page is remembered in this browser (localStorage, optional).

Search matches every word in any order, ignoring case, accents, Greek letters
against their names (β = beta), µ/micro/u-, dash and prime variants, and
hyphens, spaces, commas or underscores inside a name (4-nitrophenyl = 4
nitrophenyl; a locant, a D/L/p/o/m/n prefix or a Greek name typed as its own
word joins the next). It also knows common species names (human, mouse, yeast,
E. coli), as does the Organism field; an EC number matches whole parts, so
1.1.1 is that subclass only and 1.1.1.1 never 1.1.1.10. EC 1.1.1.1, ec:1.1.1.1,
1.1.1.- and "1." (a class) work in the search box; the EC field takes any
number and several at once. A number also finds the records of
that PMID, and a DOI (in full or its beginning, with or without doi.org) those
of its paper: the index carries each record's PMIDs and DOIs from the Full data
download of the same snapshot. When nothing matches, the table names the
filters that are on and offers to remove the one set last (with how many
records that shows) or to clear everything. At 1180px and below the header is
one grid on every view: brand and Download, the tabs on one line, then search
(Browse only). A selected record uses a separate right
column on desktop and a full-height dialog on smaller screens. Never put details
below the table or cover desktop measurement columns. Keep 25 rows per page,
scrolling within the table, and the page controls reachable. An open record's
address ends in #record=<record key> (replaced, not added to history, and
removed when the record closes), so it can be shared; opening such an address
shows the record on its table page once the index has it, and a key the
snapshot lacks is put in the search box with a note that it is not there.

While records load, placeholder rows keep the table's shape and, until the first
rows appear, the count beside Filters says how many have loaded. Page 1 appears
from the first rows of the index, which arrives in Review-status order, and
stays in place when the rest arrives; sorting waits for all records. Stats and
Guide never download the record index. kcat, Km, kcat/Km, T and pH sort both
ways, from the Sort menu or by clicking the column header (high to low first,
then low to high); the header's arrow shows the direction, and records without
the value stay last. Review status stays the default order.

## Type And Color

Use the existing system font, tabular numerals, and zero letter spacing. One
type scale (front matter) and weights 400/500/600 only; no text below 11px.
Colours are tokens in the stylesheet's :root, the only place hex values appear.
Table numbers share regular weight; enzyme names use medium weight. Reserve
semibold for counts, section headings, and the selected record's main values. Numeric
headers and values align right. Names wrap to two lines; the full name is on
hover and in the record. Every table row has the same height. Value markers
(no unit, calc., a caution) sit beside the value, never under it; a caution's
words are in its tooltip and the record, and on phone cards beside the "!"
(they may wrap to the next line there).

Status cells align left: a dot and one word, then whole-word tags on a second
line. Columns are sized to the page's content: values, EC, T, pH and Status are
as wide as their widest entry and never wrap; Enzyme, Organism and Substrate
start as wide as three in four of their names. The room left in the window goes
to the name columns, first until their names fit on one line, then in
proportion to their widths, so the table fills the window and the arrow sits
right after Status. In a narrow window the names give way (two lines, broken
between words while they can; the full name is on hover), and when that is not
enough the table scrolls sideways. Temperature and pH are two plain numeric columns, T (°C)
and pH, with a dash when the value is missing. The table writes
numbers at or above 10⁵ and below 10⁻³ as a × 10ⁿ with the stored digits (no
rounding); the record and downloads keep the stored text. Every column fits from
about 1010px; narrower screens scroll the table sideways with the enzyme name
kept in view. With a record open, EC, T, pH and the arrow give way; Status
stays. On phones (640px and below) each record is a card: name and EC;
organism · substrate; kcat, Km and kcat/Km with their units as labels; status,
°C and pH.
The filters overlay (below 1280px, phones included) ends with a "Show N
records" button. Filter chips use the teal tint with a thin teal line, 12px
text, and wrap within the page gutters.

White and neutral surfaces carry the data. Teal marks selection and actions;
status uses a coloured dot (the Stats outcome colours) and ink words; amber
marks cautions. Green (human-checked, 5.9:1 on white) is only for
"human-checked": a small check drawn before the tag, weight 500, no pill or
background, in table badges, phone cards, the record's status line and Human
review line, the counts band and the Guide. The tag shows on accepted records
only; it updates in place when the marks arrive (rows are not redrawn). On a
phone card a badge with two tags takes its own line, T and pH at the next line's
end. Use thin dividers, modest control radii, and
shadows only for overlays. No decorative gradients, statistic cards, or hero art.

## Record Details

Keep values, units, warnings, protein form, identifiers, and paper links visible.
Order: name, EC · organism and one status line ("Accepted · read from the
paper · ✓ human-checked"); Measurement (the values, then each flag once as a plain
note under them, then substrate, cosubstrate, temperature, pH, conditions as a
short list, preparation); Protein and substrate; Paper (links, the review
outcome, a Human review line with the reviewer's facts-only note on every record
that has a mark, and a CatLog v2 record's values as one table: printed, stored,
second check only when results differ); Source details, collapsed, with one
licence line. Odd records read plainly: a name longer than 64 characters is set
at 16px so the header that stays in view stays short; "Unknown" EC or organism
reads "EC unknown" / "organism unknown"; a record without kcat, Km or kcat/Km
says so (or that it stores a Ki only); a missing sequence or SMILES reads "None
recorded"; a paper's stand-in ID (NP and 8 hex digits) is text, never a PubMed
link, and Report a problem names the DOI when there is no PMID. A flagged value
carries a small "!" button that moves to its note; nothing is readable only on
hover. The record writes numbers like the table (a × 10ⁿ at
or above 10⁵ and below 10⁻³, stored digits); a kcat/Km CatLog calculated for an
older record keeps the significant figures of kcat and Km. An older record whose
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
in one sentence, that the CatRange paper (PNAS Nexus, the Paper tab) describes
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
