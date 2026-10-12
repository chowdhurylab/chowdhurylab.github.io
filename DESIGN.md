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

Order: two headline lines (Records, Accepted, Human-checked, Read from the
paper by CatLog with its papers; then Papers, Enzymes, EC numbers,
Organisms, Substrates), then sections, each a heading, at most one line of
plain explanation and its chart: Review result (full width); three short
boxes side by side (one column below 1025px): Read from the paper by CatLog
(records and papers, the method in one line with "How CatLog reads papers →"
to the Guide's #guide-method), AI audits (values re-checked, how many were
wrong and removed, as of when) and Human review (accepted records
human-checked, records reviewers looked at, and what reviewers found when they
compared values with their papers: the share correct always beside the label
errors). The audit and comparison numbers come from overview.quality, which
`build_overview` copies from the human-review marks file's top-level
"quality" object (known whole-count fields and the as_of date only); a box or
sentence whose numbers are missing or do not hold together is left out, and
the Guide's method section uses the same sentences. What the records contain;
Enzyme classes (records and accepted);
Most common organisms and EC numbers (top 10, the EC with the enzyme name its
records use most); Value ranges (full width); Wild type and variants above
Cautions in one column, Source above a closed "How these numbers are
counted" in the other (stacked, so a short section leaves no gap). On phones a
second count column ("Accepted") is wide enough for its heading.

Charts are plain horizontal bars: name, bar, count, share of all records.
Colour marks the review result only, with the Browse status dot colours (blue
#339cff accepted, orange #f3883b not confirmed, grey not checked, for
Unverified and Not reviewed alike, red #e02e2a disputed); every other bar is one teal
(#277c86). Top-10 bars are drawn against the largest item, all others against
all records. Value ranges show, per metric in catalog units (kcat s⁻¹, Km mM,
kcat/Km s⁻¹ mM⁻¹), the median, the 10–90% range and a histogram per power of
ten whose end bars hold every value beyond them; values without a recorded
unit or in another unit are left out, and the 10–90% bounds have two
significant figures. No rings, gauges, completion bars or confidence scores.
Labels 15px, notes 14px; on phones each name sits above its bar.

Review result lists each record once, in the words Browse uses: Accepted (its
note splits it into the records read from the paper by CatLog and the earlier
catalog's, as printed or after a correction), Not confirmed, Not checked (the
group Browse filters on, with Unverified and Not reviewed under it), then
Disputed. An unfamiliar status is listed, not dropped. Keep the no-paper-linked caveat visible. The
fields saved in records that are not accepted (hash-bound `review_details`)
sit in a closed table; never imply that a missing field explains a status or
that the unaccepted records measure work remaining.

Every name Browse can filter on links to `catlog-latest.html#browse?` with the
shared keys (status, checked, ec, organism, metric, variant, caution, source);
a portable copy links within itself. Items with no single Browse filter
(Unverified alone, Not stated, earlier paper extractions, other sources,
sequence, temperature, pH) stay plain text. Source lists the records read from
the paper by CatLog (linked as #browse?status=v2, which opens exactly them)
apart from the earlier paper extractions, then each database. Counting rules shared with the page: human-checked is an accepted
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

Use white, unframed sections with light rules, within 1280px. Use normal page
scrolling; never an independently scrolling chart panel. Search belongs to
Browse, not Stats or Guide. Keep Browse's filtered state when navigating away
and back. Do not publish project token statistics on this page.

Navigation order is Browse, Stats, Guide, then, apart at the right, the links
out "CatRange paper ↗" and "Chowdhury Lab ↗". Browse, Guide and Stats are real
links; normal clicks retain the loaded table, while
modified clicks and copying work normally. Strip only deployment-check query
tags from shared navigation. Stats uses catlog-stats.html; Browse keeps
catlog-latest.html. Old #stats bookmarks and portable export hashes still work.
The Guide starts with three plain tasks and a real search example, not a
numbered onboarding strip or a repeated workflow illustration.

Not reviewed is the label for the legacy mathematically_inferred record status
(labelled Pre-review until October 2026): the importer also used it for
source-derived records. Do not describe every value in that group as
calculated. A calculated ratio field is separate from record acceptance;
changing these labels must not alter the scientific data.
