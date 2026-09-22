# CatLog Public UI

Browse is the working table. Keep its header, search, compact counts, filters,
record drawer and downloads intact. Stats is a separate page, not a drawer or
expanding summary that takes space from the table.

## Stats

Use the current snapshot manifest, not filtered rows or new backend scans.
Outcome and coverage charts use all records as their denominator. Any
follow-up-only counts explicitly name that cohort and bind to the same frozen
download. Show exact counts; a nonzero share below 0.1% must not print as zero.
Review outcomes, saved source material, available fields and database links
are different concepts. Never imply that a missing field explains a pending
review or that a source excerpt establishes acceptance.

Use white, unframed sections with light rules and thin circular charts. Match
the approved artifact palette: blue #339cff for accepted, orange #f3883b for
follow-up, gray for unverified, and red for disputed. Green #5dc977 marks
kinetics, blue protein sequences, orange substrate structures, and pink #eb77b1
reference material. Browse keeps its existing colors. Keep Stats content within
1200px so charts and labels stay together on a wide monitor.
Color is secondary to the written label and count. Keep labels readable,
numerals aligned, and charts free of decorative imagery or confidence scores.

At desktop sizes, use two chart columns. Below 1000px, use one column with
normal page scrolling. Never add an independently scrolling chart panel.
Keep Browse's filtered state when navigating away and back.

Search belongs to Browse, not Stats or Guide. On Stats, show exact percentages
and aligned counts rather than progress-track styling. Keep the
identity-only caveat visible; put short definitions and examples in optional
disclosures. Never invent a reason for a pending review from a blank field.

Navigation order is Browse, Guide, Paper, ChowdhuryLab, Stats. Use two overview
sections, followed by full-width field comparisons and the source chart.
Put overlapping wild-type and variant sequence counts in a disclosure rather
than adding more repeated rings. "Without this field" means no value in the
public download; never imply rejection, data loss, or an incomplete review.
Source-chart slices use exclusive recorded source groups, not overlapping
database link counts. Do not publish project token statistics on this page.
The Guide starts with three plain tasks and a real search example, not a
numbered onboarding strip or a repeated workflow illustration.
Browse, Guide and Stats are real links; normal clicks retain the loaded table,
while modified clicks and copying work normally. Strip only deployment-check
query tags from shared navigation, preserving the stable path and view hash.
Changing a review group must leave the surrounding explanations open.

Group verified and corrected together as Accepted in the outcome ring, with
their two subcounts alongside. The ring is a status distribution, never a
completion gauge: unaccepted records are not a measure of work remaining.
Do not enlarge tiny slices or quietly omit unknown categories. All slices
have an accessible text count. Explain follow-up with explicitly illustrative
protein, substrate and assay checks; do not infer a reason from missing data.
Same-snapshot field presence can describe what is already saved in follow-up
records, but cannot establish a completed check or the severity of the rest.
Follow-up, Unverified and Pre-review link to a selectable group detail below the
overview. Each group uses its own hash-bound field and material counts. Keep
the status meaning and short illustrative checks visible; do not hide all
explanation behind a disclosure or present these examples as counted reasons.
Pre-review is the label for the legacy mathematically_inferred record status:
the importer also used it for source-derived records. Do not describe every
value in that group as calculated. A calculated ratio field is separate from
record acceptance; changing these labels must not alter the scientific data.
