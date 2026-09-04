# Development Trace Coverage Audit

The public narrative is a curated synthesis of a much larger private
development ledger. The public CSV is intentionally a milestone index, not a
copy of operational notes.

## Coverage

- Detailed private-ledger extraction originally covered April 1 through
  May 18, 2026.
- The public milestone index now covers April 1 through September 4, 2026.
- Later phases are synthesized from the private ledger and Git history at the
  exact source revision recorded in `SOURCE_PROVENANCE.md`.
- The index contains dates, issue classes, recorded design decisions,
  verification surfaces, and source anchors only.

## Deliberate Redactions

The public index omits row-level scientific data, literature identifiers,
review keys, source payloads, queue counts, process identifiers, filesystem
paths, rollback names, and runtime status pulses. Those details are not needed
to explain how the method changed and should not be used as a substitute for a
data release.

## What The Narrative Supports

The narrative and milestone index support the development sequence: problem,
design decision, verification surface, and resulting method boundary. They do
not prove every operational event, reproduce the private ledger, or establish
causal attribution for a scientific result.

## Recommended Use

- Read `docs/development_trace.md` for the human-readable story.
- Use `docs/development_trace_index.csv` for a compact dated map.
- Use `SOURCE_PROVENANCE.md` to bind currentness claims to a private source
  revision.
- Request access to the private repository when a line-level engineering audit
  is required.

## Bottom Line

The public trace shows the method's recorded decisions without publishing the
operational ledger that produced them.
