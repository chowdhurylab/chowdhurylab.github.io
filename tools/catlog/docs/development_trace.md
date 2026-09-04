# CatLog Development Trace

This document reorganizes the large development ledger into a method-paper
support narrative. It is not a replacement for the raw ledger. It is a clean
guide to the design flow: what problem appeared, what design response was
added, and how the CatLog method matured from a source-collection idea into a
reviewable curation backbone.

## Source And Index

The source for this trace is the private development ledger and Git history at
the exact revision recorded in `SOURCE_PROVENANCE.md`. The raw ledger is large,
operational, and intentionally excluded from this shareable package.

- Public milestone index: `docs/development_trace_index.csv`.
- Coverage audit: `docs/development_trace_coverage_audit.md`.
- Public milestones: 13.
- Detailed private-ledger extraction: April 1 through May 18, 2026.
- Later source-and-Git synthesis: May 19 through September 4, 2026.

The public index records issue classes, design decisions, verification
surfaces, and source anchors. It is a curated trace, not a line-by-line copy of
private operations.

## One-Sentence Development Story

CatLog evolved from a multi-source enzyme-kinetics collection script into an
evidence-preserving curation system with deterministic checks, structured
review, conservative merge rules, follow-up states, and an operator surface for
auditing long-running scientific data review.

## Chronological Flow

| Phase | Dates | What changed | Why it matters for the method paper |
|---|---:|---|---|
| 1. Bootstrap and architecture | Apr 1-Apr 2 | Built the first multi-source intake idea, common record shape, source payload preservation, and review-loop framing. | Establishes that CatLog is not just a scrape; it is a curation architecture. |
| 2. Evidence gates and review contract | Apr 3-Apr 6 | Added source-health warnings, paper-grounding gates, sequence provenance checks, review defaults, and stronger evidence recognition. | Supports the Methods claim that weak evidence is separated from accepted evidence. |
| 3. Recovery lanes and traceable merges | Apr 7-Apr 8 | Added literature-recovery, strong-claim re-audit, reviewed-excerpt preservation, recovery ledgers, and measurement-identity patching. | Shows that historical rows are repaired through traceable revisit lanes rather than blind overwrites. |
| 4. Backlog separation and live review stabilization | Apr 9-Apr 15 | Split live review from held/manual follow-up, restored hidden backlog state, and made batch review state more exact. | Explains how unresolved records remain visible but do not enter the curated set prematurely. |
| 5. Operations dashboard and trust surface | Apr 18-Apr 25 | Built the operator-facing dashboard, trust summaries, status semantics, paper-proof surfaces, and promotion/refill controls. | Gives the method paper a concrete audit and inspection layer. |
| 6. CatLog naming, UX, and identity hardening | Apr 27-Apr 29 | Standardized CatLog-facing language, simplified the explorer, added proof-click behavior, clarified review-slot health, and hardened exact identity claims. | Converts the internal system into a collaborator-readable product and audit surface. |
| 7. Cleanup lanes and held-paper checkpoints | May 1-May 6 | Drained and measured follow-up lanes, separated easy manual cleanup from held paper review, and checkpointed held-paper progress. | Demonstrates that unresolved work is categorized into safe, explicit cleanup paths. |
| 8. Resource guard, kinetic safety, and QA | May 7-May 11 | Added resource guardrails, kinetic-value overwrite protection, exact-accession safeguards, evidence-layer distinctions, and independent QA sampling. | Shows the reliability story: throughput is subordinate to scientific safety. |
| 9. Source-gap refill, live health, and final guardrails | May 12-May 18 | Added targeted source-gap refill, count-vs-localized-row separation, protected cleanup policy, live-health checks, and final guardrail passes. | Explains how CatLog distinguishes raw source coverage from curated local rows and keeps the system auditable under long runs. |
| 10. Evidence-recovery scaling | May 19-Jun 30 | Scaled source-gap recovery while separating feeder work from accepted output and serializing writes under resource pressure. | Shows why recovery throughput and scientific acceptance were kept as different units. |
| 11. Guarded strict transactions | Jul 1-Aug 13 | Bound candidate identity to the current generation and required writer admission, atomic apply, same-generation integrity audit, and exact-key readback. | Replaces informal acceptance with a verifiable transaction boundary. |
| 12. Versioned engineering and audit | Aug 14-Aug 30 | Adopted Git-backed engineering, expanded focused tests, and reviewed correctness, source, paper, and security boundaries. | Makes implementation changes inspectable without treating repository history as scientific proof. |
| 13. Public export and collaborator portability | Aug 31-Sep 4 | Separated streaming public export from the live catalog, added public-field and provenance checks, packaged repository skills, and documented accepted-versus-held campaigns. | Enables collaborators to inspect the method without receiving production data or runtime state. |

## Later Method Hardening Reflected In The Current Source Anchor

After the indexed May trace, the private implementation continued to harden the
same method rather than replacing it. The later system added stronger separation
between broad source intake and strict accepted gain, explicit transaction
admission, atomic apply and exact readback, reusable retrieval receipts,
resource-aware supervisors, clone-local skills, and a collaborator check that
distinguishes code-only use from production operation. Public static export and
private live-data backup were also separated from the reusable source workflow.

These later points are a high-level source-anchored update, not a reconstructed
day-by-day ledger. A future public trace refresh should extend the chronological
index from the private ledger before making finer-grained historical claims.

## Human Decisions In The Development Story

The trace is not a transcript of model output. Human decisions shaped the
scientific acceptance boundary: which evidence counted, when ambiguous records
had to remain held, how source volume was separated from curated gain, what
corrections required field-level locks, and which operational shortcuts were
rejected after testing. Agent workers made bounded evidence judgments inside
those constraints; deterministic validation and human-defined release rules
decided what could enter the curated state.

## Design Lineage

### 1. From source collection to evidence-preserving candidates

The initial problem was that enzyme-kinetic values from different sources could
not be trusted after flattening. CatLog therefore keeps each candidate
measurement tied to source identifiers, source-native values, literature
anchors, substrate context, organism context, accession evidence, mutation
state, and assay notes.

Method-paper use:

> Candidate measurements were harmonized into a common schema while retaining
> source-native evidence needed for downstream audit.

### 2. From one-pass filtering to deterministic quality gates

The ledger shows repeated cases where a record looked usable until sequence,
organism, substrate, unit, or paper-evidence checks exposed ambiguity. CatLog
therefore uses deterministic checks before review: identity, sequence,
mutation, substrate, unit/range, paper evidence, source health, and measurement
tuple consistency.

Method-paper use:

> Automated checks routed records with unresolved identity, sequence, substrate,
> assay-context, or literature conflicts into structured review.

### 3. From broad model judgment to bounded structured review

The review workflow became safer only after the review scope was narrowed to
specific batches with preserved evidence and a required three-pass loop:
claim reading, contradiction checking, and final verdict writing.

Method-paper use:

> Model-assisted review was constrained to bounded evidence packets and emitted
> structured verdicts with review summaries, rationale, audit history, evidence
> used, and unresolved blockers.

### 4. From paper presence to paper-proof tiers

The development trace repeatedly separates a literature identifier from actual
row-level paper support. CatLog now treats full-text value matches, source-table
evidence, abstract-only anchors, and missing text as different evidence tiers.

Method-paper use:

> Literature identifiers were not treated as sufficient proof; records required
> preserved row-level evidence or were retained in follow-up states.

### 5. From accepted/rejected only to follow-up states

The large held/manual backlog was not discarded. It was split into executable
cleanup paths and nonfinal follow-up states. This is central to the scientific
integrity story: uncertain records remain visible without being treated as
curated facts.

Method-paper use:

> Unresolved records were preserved in follow-up sets rather than silently
> excluded or prematurely accepted.

### 6. From fragile commits to conservative merge rules

The ledger contains several important safety turns: exact measurement identity,
commit serialization, field-correction locks, kinetic-value overwrite guards,
and export integrity audits. These made the merge layer conservative.

Method-paper use:

> Accepted corrections were applied only when the reviewed measurement identity
> and corrected fields were explicit; otherwise records remained in review.

### 7. From invisible operations to an auditable operator surface

A long-running curation system needs visible status. CatLog added an operator
surface for live/held counts, review progress, source coverage, evidence tiers,
resource state, and record-level proof drawers.

Method-paper use:

> The system exposed curation state through an audit interface so accepted,
> unresolved, and follow-up records could be inspected without reading raw
> JSONL files.

### 8. From raw source totals to two-layer progress accounting

The later trace clarifies a key reporting distinction: raw source-native count
census is not the same as localized curated records. CatLog separates source
coverage, localized workload, reviewed rows, and claim-verified rows.

Method-paper use:

> Source-native totals were tracked separately from localized review rows to
> avoid presenting upstream source volume as curated completion.

## Method-Paper Claims Supported By The Trace

- CatLog is an evidence-preserving curation framework, not a plain aggregator.
- Candidate records retain source-native context for later audit.
- Automated checks and model-assisted review are separated.
- Review is bounded, structured, and fail-closed.
- Paper evidence is tiered by strength, not inferred from PMID/DOI presence.
- Corrections are merged conservatively with field-level locks.
- Unresolved records are retained in follow-up states.
- Operator-facing status distinguishes live review, held follow-up, source
  intake, promotion, and cleanup.
- Source count census and curated-row progress are separate units.

## Things Not To Claim

- Do not claim every source-native row is curated.
- Do not claim a PMID or DOI alone proves a kinetic value.
- Do not describe unresolved follow-up rows as final database rows.
- Do not imply cleanup lanes are the same as live review.
- Do not collapse source count census totals into reviewed-row completion.
- Do not present model review as unconstrained free-form reasoning.

## How To Use This For Writing

1. Use `docs/methods_text.md` for the short manuscript-ready method language.
2. Use this document for the longer development rationale.
3. Use `docs/development_trace_flow.mmd` or
   `docs/development_trace_flow.svg` for the figure backbone.
4. Use `docs/development_trace_index.csv` only when you need to trace a
   statement back to a specific dated ledger section.

## Recommended Method Figure Story

The clearest figure is a left-to-right backbone:

```text
source records
  -> evidence-preserving schema
  -> automated checks
  -> structured evidence review
  -> conservative merge / follow-up hold
  -> audit interface and progress accounting
```

The figure should emphasize two separations:

- deterministic checks vs structured review
- curated rows vs unresolved follow-up rows
