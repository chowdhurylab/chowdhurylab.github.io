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

Start with the table, not a landing page. Keep Records, Accepted, and the three
Rows with values counts in one 48px line, labels and counts on one baseline, the
snapshot date and View stats at its end; on phones the line keeps Records and
Accepted and a More button shows the rest. Counts follow the current filtered
results; measurement coverage overlaps and must not form a stacked chart. The
count beside Filters is shown only when it says more than the page range.

Expanded counts separate review status from saved source material. Show the
denominator, record count, and share in aligned tables. Each record belongs to
one category per table; source categories follow the stored evidence precedence,
not an acceptance score. Explain the categories in a native disclosure. Keep
the bottom page controls compact, with page size left and navigation right.

Filters open on request at every width. Search matches every word in any order,
and common species names (human, mouse, yeast, E. coli); an EC number matches
whole parts, so 1.1.1 is that subclass only. At 1180px and below the header is
one grid on every view: brand and Download, the tabs on one line, then search
(Browse only). A selected record uses a separate right
column on desktop and a full-height dialog on smaller screens. Never put details
below the table or cover desktop measurement columns. Keep 25 rows per page,
scrolling within the table, and the page controls reachable.

While records load, placeholder rows keep the table's shape and, until the first
rows appear, the count beside Filters says how many have loaded. Page 1 appears
from the first rows of the index, which arrives in Review-status order, and
stays in place when the rest arrives; sorting waits for all records. Stats and
Guide never download the record index.

## Type And Color

Use the existing system font, tabular numerals, and zero letter spacing. One
type scale (front matter) and weights 400/500/600 only; no text below 11px.
Colours are tokens in the stylesheet's :root, the only place hex values appear.
Table numbers share regular weight; enzyme names use medium weight. Reserve
semibold for counts, section headings, and the selected record's main values. Numeric
headers and values align right. Names wrap to two lines; the full name is on
hover and in the record. Every table row has the same height. Value markers
(no unit, calc., a caution) sit beside the value, never under it.

Status cells align left: a dot and one word, then whole-word tags on a second
line. Columns are sized to the page's content: values, EC, Assay and Status are
as wide as their widest entry and never wrap; Enzyme, Organism and Substrate are
as wide as three in four of their names, and wider while room is left and a
name would otherwise be cut short (names wrap to two lines; the full name is on
hover); the space left over goes to the arrow column at the right edge, so
values sit next to the names. In a narrow window names give way first.
Temperature and pH share one Assay column ("25 °C · pH 7.5"). The table writes
numbers at or above 10⁵ and below 10⁻³ as a × 10ⁿ with the stored digits (no
rounding); the record and downloads keep the stored text. Every column fits from
about 1010px; narrower screens scroll the table sideways with the enzyme name
kept in view. With a record open, EC, Assay and the arrow give way; Status
stays. On phones (640px and below) each record is a card: name; organism ·
substrate; kcat, Km and kcat/Km with their units as labels; status and assay.
Filters on phones end with a "Show N records" button.

White and neutral surfaces carry the data. Teal marks selection and actions;
status uses a coloured dot (the Stats outcome colours) and ink words; amber
marks cautions. Use thin dividers, modest control radii, and
shadows only for overlays. No decorative gradients, statistic cards, or hero art.

## Record Details

Keep values, units, warnings, protein form, identifiers, and paper links visible.
The status is one line ("Accepted · read from the paper · human-checked"); an
older record's evidence label sits with its paper links. A CatLog v2 record's
conditions are short labelled lines (Cosubstrate, Conditions as a list,
Preparation), never one block of text, and its sequence note is short and plain.
Sequence and SMILES strings and review notes expand on request. Do not discard
source text, hide scientific warnings, recompute measurements, or weaken review
definitions to make the page shorter. Database attribution belongs in Guide and
dataset notes, not the Browse footer.

## Guide

Show the four starting steps once, followed by the worked record example. Keep
the optional diagram behind a native disclosure, usable at every viewport.
Retain the field meanings, review definitions, download differences, and source
licenses; shorten duplicate instructions rather than scientific qualifications.

## Verification

Use the existing data loader, immutable manifest, downloads, and stable URL.
Verify real desktop and mobile layouts, filters, empty results, page changes,
keyboard focus, overlay dismissal, record downloads, and unchanged data hashes.
Generated mockups guide layout only; their text is not a scientific source.
