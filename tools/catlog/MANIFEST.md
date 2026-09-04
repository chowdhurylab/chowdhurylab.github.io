# CatLog Method Package Manifest

## Shareable Contents

This package contains only method and protocol material:

- `README.md`: entry point and usage notes
- `SOURCE_PROVENANCE.md`: exact private source anchor and update boundary
- `PUBLIC_MANIFEST.sha256`: SHA-256 inventory for every other published file
- `pyproject.toml`: local editable install metadata
- `LICENSE`: MIT license text for the method package
- `.gitignore`: safeguards against adding data/runtime artifacts
- `.agents/skills/catlog-method/`: repo-scoped guidance for coding agents
- `docs/architecture.md`: architecture overview
- `docs/curation_protocol.md`: curation and review rules
- `docs/methods_text.md`: manuscript-style method text
- `docs/development_trace.md`: curated development narrative through September 4, 2026
- `docs/development_trace_index.csv`: redacted 13-milestone public index
- `docs/development_trace_coverage_audit.md`: coverage and limitation audit for the trace
- `docs/development_trace_index_summary.md`: compact milestone-group summary
- `docs/development_trace_flow.mmd`: editable Mermaid flow diagram
- `docs/development_trace_flow.svg`: visual flow diagram
- `docs/sharing_guide.md`: what to send and what to keep private
- `protocol/prompts/review_prompt.md`: review prompt template
- `protocol/prompts/system_guardrails.md`: evidence and safety rules
- `protocol/schemas/candidate_measurement.schema.json`: input schema
- `protocol/schemas/review_verdict.schema.json`: output schema
- `examples/synthetic_batch.json`: synthetic candidate batch
- `examples/synthetic_verdict.json`: synthetic verdict output
- `src/catlog_method/`: small reference validation code
- `scripts/validate-example.sh`: local smoke test

## Deliberately Excluded

The following are not part of this package:

- database exports
- raw source payloads
- real review queues
- paper PDFs and extraction caches
- credential files
- runtime logs
- local worker state
- rollback backups
- scratch screenshots or generated UI captures

## Intended Use

Use this package to explain, review, or reproduce the CatLog curation method
without disclosing the gathered database itself. It is suitable for sharing with
collaborators who need to understand the protocol, architecture, and output
contract before seeing any real data.
