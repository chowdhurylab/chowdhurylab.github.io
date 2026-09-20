# CatLog Public UI

Browse is the working table. Keep its header, search, compact counts, filters,
record drawer and downloads intact. Stats is a separate page, not a drawer or
expanding summary that takes space from the table.

## Stats

Use the current snapshot manifest, not filtered rows or new backend scans.
Every chart uses all records as its denominator. Show exact counts beside
horizontal bars; a nonzero share below 0.1% must not be printed as zero.
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
