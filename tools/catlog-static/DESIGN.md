---
name: CatLog
description: A compact enzyme kinetics workbench for reading measurements and their sources.
colors:
  background: "#ffffff"
  text: "#172120"
  primary: "#245f58"
  muted: "#5f6b68"
  border: "#d3dcd7"
typography:
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Inter, system-ui, sans-serif'
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0px
---

# CatLog

## Layout

Start with the table, not a landing page. Keep Records, Accepted, and the three
Rows with values counts visible in one compact band. More counts expands the
enzyme, EC, organism, review, and evidence breakdowns. Counts follow the current
filtered results; measurement coverage overlaps and must not form a stacked chart.

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

Use the existing system font, tabular numerals, and zero letter spacing. Table
numbers share regular weight; enzyme names use medium weight. Reserve semibold
for counts, section headings, and the selected record's main values. Numeric
headers and values align right. Names wrap to two lines; the full name is on
hover and in the record. Every table row has the same height. Value markers
(no unit, calc., a caution) sit beside the value, never under it.

Status cells align left: a dot and one word, then whole-word tags on a second
line. Columns are sized to their content (values, Status and the arrow are
fixed, names take the rest), so values sit close to the names. With a record
open, EC, temperature, pH and the arrow give way; Status stays.

White and neutral surfaces carry the data. Teal identifies selection and actions;
status uses a coloured dot (the Stats outcome colours) with the word in ink;
amber is reserved for cautions. Use thin dividers, modest control radii, and
shadows only for overlays. No decorative gradients, statistic cards, or hero art.

## Record Details

Keep values, units, warnings, protein form, identifiers, and paper links visible.
The status is one line ("Accepted · read from the paper · human-checked"). A
CatLog v2 record's conditions are short labelled lines (Cosubstrate,
Conditions as a list, Preparation), never one block of text.
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
