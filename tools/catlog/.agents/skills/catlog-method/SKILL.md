---
name: catlog-method
description: Use when explaining, reviewing, validating, or adapting the public data-free CatLog curation method package; covers its architecture, prompts, schemas, synthetic example, and development trace without implying access to the live catalog.
---

# CatLog Method

This repository is a shareable method package, not the production CatLog
workspace. Start by reading `AGENTS.md` and `README.md`.

## Route The Request

- For architecture or scientific-method questions, read
  `docs/architecture.md` and `docs/curation_protocol.md`.
- For manuscript wording, read `docs/methods_text.md`.
- For how the approach changed through trial, error, and recorded design
  decisions, read `docs/development_trace.md` and its coverage audit. Use the
  index only when a dated trace-back is needed.
- For prompt or verdict-contract changes, inspect `protocol/prompts/`,
  `protocol/schemas/`, and the synthetic examples together.
- For currentness or provenance, read `SOURCE_PROVENANCE.md` before making a
  claim about the private implementation.

## Data Boundary

- Use only the synthetic examples in this repository.
- Do not infer current catalog counts, runtime state, or production readiness.
- Do not add harvested records, paper files, credentials, live queues, logs,
  backups, or rollback artifacts.
- The production JSONL and the private implementation are separate
  operator-controlled artifacts.
- Do not start, imitate, or claim control of private production supervisors or
  writers from this package.

## Verification

After a method, prompt, schema, or validator change, run:

```bash
./scripts/validate-example.sh
```

Keep the prompt, schema, synthetic example, and validator consistent. When the
private implementation materially changes the public method, update
`SOURCE_PROVENANCE.md` and the relevant method document from one exact private
source revision; do not copy private Git history or runtime files into this
package.
