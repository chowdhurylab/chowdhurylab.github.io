# CatLog Curation Protocol

This protocol describes how a candidate enzyme-kinetic measurement moves from
source extraction to a curated or held state.

## 1. Candidate Package

Each candidate measurement should include:

- stable `measurement_key`
- `review_key` for the review batch
- optional package-local `record_id` for display or examples; it is not the
  production merge identity
- enzyme name and EC number
- organism
- substrate and substrate identifiers when available
- populated kinetic fields: `kcat`, `Km`, `Ki`, `kcat_over_Km`, or related
  source-native equivalents
- units and parsed normalized values
- source database and source record identifiers
- literature identifiers such as PMID, PMCID, or DOI
- sequence accession evidence
- mutation or wild-type context
- assay context and unstructured source notes
- preserved source snippets or paper evidence when available

## 2. Automated Screen

The automated screen checks whether the candidate can be accepted without
judgment-heavy review. The screen should fail closed when evidence is missing.

Common routes to review:

- identity is unresolved
- sequence or accession does not match the reported organism
- mutant state is ambiguous
- substrate identity is unresolved
- multiple kinetic fields appear to come from different measurement tuples
- paper evidence is abstract-only, anchor-only, or absent
- source values conflict across preserved payloads

## 3. Evidence Review

A review batch should be narrow enough that the reviewer can inspect every
candidate in context. The reviewer must use only:

- the candidate record
- preserved source payloads included with the candidate
- direct lookup evidence implied by the review task
- literature text or source metadata explicitly recovered during review

The reviewer must not accept a value because it seems biologically plausible.

### Required Three-Pass Review

Loop 1: identify the exact claim.

- What field is populated?
- What enzyme, organism, substrate, and mutation state are claimed?
- What source database or literature item generated the claim?

Loop 2: check contradictions.

- Does the source identity match the sequence or accession?
- Does the organism match?
- Does the substrate match the populated kinetic field?
- Does the paper evidence support the same measurement tuple?
- Are there signs that Km, Ki, kcat, or kcat/Km came from different rows?

Loop 3: write the verdict.

- Choose one allowed status.
- Explain the evidence used.
- Preserve concrete blockers if the record remains unresolved.
- Record an audit history with all three loops.

## 4. Verdict Statuses

`verified`

The current candidate is supported as written by explicit source or paper
evidence.

`corrected`

The candidate is usable after a field-level correction. The corrected field and
evidence must be named directly.

`rejected`

The candidate is contradicted, duplicated in an unsafe way, outside the target
scope, or otherwise should not enter the curated set.

`manual_review_required`

The candidate may be real, but the available evidence is not enough to accept,
correct, or reject it confidently.

## 5. Merge Policy

Only `verified` and evidence-backed `corrected` verdicts are eligible for the
curated dataset, but eligibility is not acceptance. The deterministic writer
validates the verdict, admits the current `(measurement_key, review_key)`
identity, applies the change atomically, audits that same generation, and
performs exact-key readback. Rejected and unresolved records remain in a
separate audit or follow-up state.

The merge layer should preserve:

- original source claim
- normalized curated value
- correction details
- reviewer rationale
- evidence identifiers
- audit history
- remaining blockers

## 6. Paper Evidence Thresholds

Strong evidence:

- full-text or source table excerpt directly supports the populated field
- quote or excerpt is tied to the same enzyme, organism, substrate, and
  measurement tuple

Medium evidence:

- paper confirms identity or assay context but does not directly support every
  populated kinetic field

Weak evidence:

- PMID or DOI exists but no relevant text is preserved
- abstract-only support
- anchor-only full text without row-level value match

Weak evidence should not be upgraded to verified status without additional
support.
