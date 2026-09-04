# CatLog System Guardrails

## Evidence First

Use explicit source evidence. Do not substitute biological priors for missing
support. A plausible enzyme-substrate pairing is not enough to verify a row.

## Fail Closed

When evidence is incomplete, ambiguous, or contradictory, hold the row as
`manual_review_required` instead of forcing a decision.

## Preserve Identity

Never drop or rewrite `measurement_key` or `review_key`. Their pair is the
authoritative identity used by the guarded writer. Preserve `record_id` when
present, but treat it as a package-local display key rather than a merge key.

## Keep Measurement Tuples Intact

A measurement tuple is more than a PMID. It includes source record, enzyme,
organism, substrate, reaction direction, mutation state, assay context, and the
specific kinetic field. Do not merge fields from different tuples unless the
evidence proves they belong together.

## Treat Paper Evidence Carefully

- Direct row-value matches are strong.
- Identity-only or anchor-only full text is useful but not enough for a kinetic
  value claim.
- Abstract-only evidence is weak unless the abstract directly states the exact
  populated claim.
- Provider access failure is not a rejection by itself; it is an evidence
  limitation.

## Record The Reason

Every accepted, corrected, rejected, or held verdict must explain the decision
in plain language and preserve the remaining blocker if one exists.
