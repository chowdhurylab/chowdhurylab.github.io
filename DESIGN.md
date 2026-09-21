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

Use white, unframed sections with light rules. Teal identifies accepted
outcomes and field availability, amber identifies pending checks, gray means
unverified, blue-gray marks source material, and red marks disputed records.
Color is secondary to the written label and count. Keep labels readable,
numerals aligned, and charts free of decorative imagery or confidence scores.

At desktop sizes, use two chart columns. Below 1000px, use one column with
normal page scrolling. Never add an independently scrolling chart panel.
Keep Browse's filtered state when navigating away and back.

Search belongs to Browse, not Stats or Guide. On Stats, show a shared
0-100% scale and aligned counts instead of progress-track styling. Keep the
identity-only caveat visible; put short definitions and examples in optional
disclosures. Never invent a reason for a pending review from a blank field.

Navigation order is Browse, Guide, Paper, ChowdhuryLab, Stats. Use independently
flowing Stats columns, not equal-height chart rows that create blank blocks.
The Guide starts with three plain tasks and a real search example, not a
numbered onboarding strip or a repeated workflow illustration.

Group verified and corrected together as Accepted in the outcome ring, with
their two subcounts alongside. The ring is a status distribution, never a
completion gauge: unaccepted records are not a measure of work remaining.
Do not enlarge tiny slices or quietly omit unknown categories. All slices
have an accessible text count. Explain follow-up with explicitly illustrative
protein, substrate and assay checks; do not infer a reason from missing data.
Same-snapshot field presence can describe what is already saved in follow-up
records, but cannot establish a completed check or the severity of the rest.
