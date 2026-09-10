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

Filters open on request at every width. A selected record uses a separate right
column on desktop and a full-height dialog on smaller screens. Never put details
below the table or cover desktop measurement columns. Keep 25 rows per page,
scrolling within the table, and the page controls reachable.

## Type And Color

Use the existing system font, tabular numerals, and zero letter spacing. Table
numbers share regular weight; enzyme names use medium weight. Reserve semibold
for counts, section headings, and the selected record's main values. Numeric
headers and values align right. Long names wrap rather than shrink.

White and neutral surfaces carry the data. Teal identifies selection and actions;
amber is reserved for cautions. Use thin dividers, modest control radii, and
shadows only for overlays. No decorative gradients, statistic cards, or hero art.

## Record Details

Keep values, units, warnings, protein form, identifiers, and paper links visible.
Sequence and SMILES strings and review notes expand on request. Do not discard
source text, hide scientific warnings, recompute measurements, or weaken review
definitions to make the page shorter. Database attribution belongs in Guide and
dataset notes, not the Browse footer.

## Verification

Use the existing data loader, immutable manifest, downloads, and stable URL.
Verify real desktop and mobile layouts, filters, empty results, page changes,
keyboard focus, overlay dismissal, record downloads, and unchanged data hashes.
Generated mockups guide layout only; their text is not a scientific source.
