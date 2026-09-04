# CatLog Method Repository

CatLog is a data-free method package for an agent-assisted enzyme kinetics
curation workflow. It describes the backbone of the setup: source intake,
evidence-preserving normalization, automated checks, structured review prompts,
conservative merge rules, and audit-ready outputs.

The public copy lives at
[`chowdhurylab.github.io/tools/catlog`](https://github.com/chowdhurylab/chowdhurylab.github.io/tree/main/tools/catlog).
It is intentionally not linked into the lab website navigation or the live
CatLog viewer. This folder is meant to be shared as a clean method package. It does not
contain harvested database exports, live queues, credentials, logs, rollback
files, or runtime state.

## What This Is

CatLog turns enzyme-kinetic extraction into a reviewable curation process.
Candidate measurements are packaged with their source context, screened by
deterministic checks, and routed to structured evidence review only when a
claim needs judgment. Accepted changes retain the reason, source evidence,
field-level correction, and audit trail.

The core pattern is:

```text
source intake
  -> evidence-preserving common schema
  -> deterministic quality checks
  -> structured agent-assisted review
  -> conservative merge or follow-up hold
  -> audit and inspection layer
```

## What Is Included

- `docs/architecture.md`: the CatLog backbone and design commitments
- `docs/curation_protocol.md`: the review and merge protocol
- `docs/methods_text.md`: manuscript-style method wording
- `docs/development_trace.md`: curated development flow and design rationale
- `docs/development_trace_index.csv`: 13-milestone public development index
- `docs/development_trace_coverage_audit.md`: trace coverage and redaction boundary
- `docs/development_trace_index_summary.md`: compact milestone summary
- `docs/development_trace_flow.svg`: shareable visual backbone for the method story
- `SOURCE_PROVENANCE.md`: the exact private source revision and refresh boundary
- `PUBLIC_MANIFEST.sha256`: exact checksums for the published package
- `.agents/skills/catlog-method/SKILL.md`: repo-scoped guidance for coding agents
- `protocol/prompts/`: sanitized prompt templates and guardrails
- `protocol/schemas/`: JSON schema documents for review inputs and outputs
- `examples/`: small synthetic examples, not real harvested records
- `src/catlog_method/`: small reference validator for review verdict files
- `scripts/validate-example.sh`: smoke test for the synthetic example

## What Is Not Included

- Raw or curated database exports
- Source database credentials or `.env` files
- Paper PDFs, extracted text caches, or provider-specific downloads
- Live review queues or worker state
- Local logs, rollback files, screenshots, and scratch artifacts
- Any public publishing or remote-release configuration

The full production implementation remains in the private
[`SupanthaDey9/realkcat`](https://github.com/SupanthaDey9/realkcat) repository.
Trusted collaborators who need the complete code can be invited there. The live
catalog JSONL is not stored in either GitHub location.

## Quick Start

From this folder:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e .
python -m catlog_method.validate_review examples/synthetic_verdict.json \
  --schema protocol/schemas/review_verdict.schema.json
```

Or run the bundled smoke test:

```bash
./scripts/validate-example.sh
```

Expected result:

```text
PASS: validated 1 review verdict(s)
```

When using Codex or another repository-aware coding agent, start it from this
folder and ask it to read `AGENTS.md`. Codex can use the included
`catlog-method` skill to route architecture, protocol, prompt, validation, and
development-trace questions without assuming access to production data.

## How This Copy Stays Current

The private repository is the implementation source of truth. After a tested,
committed code, prompt, skill, or backend change materially changes the public
method, this package is refreshed from that exact commit and
`SOURCE_PROVENANCE.md` is updated. Live catalog writes, locks, receipts, queues,
and backups do not trigger a GitHub source update.

## Sharing Contract

This folder is the shareable method/backbone package. If someone needs the
database, that should be handled as a separate release with its own schema,
license, provenance table, and data-use notes. Keep those two surfaces separate:
CatLog method package here, curated database elsewhere.
