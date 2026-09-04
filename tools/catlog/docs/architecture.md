# CatLog Architecture

CatLog is an agent-assisted curation backbone for enzyme-kinetic measurements.
It is designed around a simple rule: a value should not enter the curated set
unless the system can show what evidence supported the decision.

## Components

### 1. Source Intake

Source adapters collect candidate kinetic measurements and supporting identity
evidence from kinetic databases, sequence resources, and literature metadata.
The source payload is retained so later reviewers can inspect the original
claim instead of trusting a flattened value.

### 2. Evidence-Preserving Harmonization

Each candidate measurement is converted into a common record shape while
retaining source-native fields. The harmonized record keeps enzyme identity,
EC number, organism, substrate, kinetic values, units, accession evidence,
mutation context, assay context, literature identifiers, and source snapshots.

### 3. Deterministic Quality Checks

Automated checks screen each candidate for common failure modes:

- missing or ambiguous enzyme identity
- organism and accession mismatch
- unresolved wild-type or mutant state
- substrate identity ambiguity
- unit or range parsing risk
- weak or missing literature support
- mixed measurement tuple risk, where different kinetic fields may come from
  different source rows or assay contexts

Passing this screen does not itself add a record. Agent workers emit structured
verdicts only. Deterministic verdict validation, writer admission, guarded
atomic application, a same-generation integrity audit, and exact-key readback
determine whether a change is accepted. Records needing scientific judgment
are routed to structured evidence review.

### 4. Structured Evidence Review

The review agent receives a bounded candidate batch, preserved source evidence,
and explicit guardrails. The review is deliberately narrow: it must answer only
the assigned measurement question and must not infer a value from general
biological priors.

Each review performs three passes:

- Loop 1: read the claim, identity, and populated kinetic fields
- Loop 2: check contradictions across source, sequence, substrate, and paper
  evidence
- Loop 3: make the final verdict and record unresolved blockers

### 5. Conservative Merge Layer

The merge layer recognizes these review decisions:

- verified: the current record is supported as written
- corrected: a field-level correction is supported by explicit evidence
- rejected: the candidate is contradicted or out of scope
- manual_review_required: evidence remains insufficient or ambiguous

`verified` and evidence-backed `corrected` verdicts are eligible for application,
but a verdict alone is not acceptance. The writer must validate the verdict,
admit the current `(measurement_key, review_key)` identity, apply the change
atomically, audit the same generation, and complete exact-key readback.
Unresolved records remain visible in a follow-up set but are not silently
merged into the curated dataset.

### 6. Audit and Inspection Layer

Each accepted or held decision keeps:

- source identifiers
- evidence summary
- review rationale
- field-level corrections
- audit history
- remaining blockers, when any

This makes the curation state reconstructable without rerunning the entire
collection pipeline.

## Design Commitments

- Keep data release separate from method release.
- Preserve raw evidence references, but do not include private or bulky source
  payloads in the method package.
- Treat paper presence as weaker than paper evidence. A PMID or DOI alone does
  not prove the row.
- Treat abstract-only evidence as weak unless the abstract itself directly
  resolves the populated claim.
- Prefer follow-up holds over unsupported acceptance.
- Keep prompts, schemas, and merge rules inspectable by collaborators.
