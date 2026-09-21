# Review outcomes and follow-up context

The previous chart split verified and corrected records into separate first-level
categories. The revised ring combines both under Accepted, with the two exact
subcounts below it. The denominator remains every record in the frozen snapshot.
This is not a completion rate or a measure of review effort.

## What the snapshot supports

- Accepted: 16,677 of 156,431 (8,154 verified; 8,523 corrected).
- Follow-up needed: 75,153, internally `manual_review_required`.
- Unverified: 61,433. This does not establish that no work has been done.
- Calculated records: 3,160. This is not the count of calculated kcat/Km fields.
- Disputed: 8, still shown as an exact count despite the very small slice.
- Accepted includes 175 identity-only records, kept explicit in the page.

An accepted correction may change a kinetic value, sequence, or another field.
It is not necessarily evidence that the originally reported kinetic value was
wrong. The new presentation does not change any record's status or values.

## Limits on remaining-work claims

The release manifest does not count pending reasons. The public exporter removes
`next_best_action` and `next_best_action_reason`; its record details do not
publish internal review notes. Named September 20 release receipts also contain
no same-generation blocker tally. Older queue caches and present-day runtime
counts must not be substituted for this snapshot's cohort.

The protein, substrate, and assay examples are explicitly illustrative. They
reflect the checks in the local manual-follow-up contracts, not a measured
distribution of remaining tasks. No count of minor versus major follow-up is
claimed, and no internal model reasoning is published.

## Cohort field presence

`scripts/build-catlog-followup-summary.py` streams only the existing compressed
public full download. It verifies its SHA-256, total rows and complete status
distribution before adding a small `summary.followup_coverage` to a new immutable
manifest. The source records and downloads remain unchanged.

This summary counts paper IDs, saved sequences, saved SMILES, and populated
kinetic fields only within `manual_review_required`. These counts overlap and
are not a pie chart. The UI checks source/download hashes and the cohort before
displaying them. Field presence does not prove that a check passed, and a blank
field is not automatically the reason for follow-up.

GitHub CI run35548424067 audited the exact public gzip successfully. Within
75,153 follow-up records, 72,830 contain kinetic values, 69,427 have paper IDs,
28,899 contain a sequence and 21,933 contain SMILES. These are overlapping
field-presence counts, not passed-check counts. See the adjacent JSON receipt.

## Verification scope

Focused regression tests cover combined acceptance, donut shares and tiny/empty
categories, filter-independent denominators, cohort/hash binding, and rejection
of mismatched public data. Browser verification must cover desktop/mobile layout,
accessible exact counts, examples, Browse navigation, search and downloads before
publication. No change is made to the scientific review pipeline.
