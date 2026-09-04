# Sharing Guide

## Public Folder To Share

Share this GitHub folder:

```text
https://github.com/chowdhurylab/chowdhurylab.github.io/tree/main/tools/catlog
```

The folder is stored in the website repository but is not linked from the lab
navigation or the CatLog viewer. The full private implementation is shared
separately by granting access to `SupanthaDey9/realkcat`.

A local archive can also be made from the parent directory that contains this
package:

```bash
zip -r catlog-method-repo.zip catlog-method-repo \
  -x "catlog-method-repo/.venv/*" \
  -x "catlog-method-repo/archive/*"
```

## What The Recipient Gets

The recipient gets a data-free description of how CatLog works:

- architecture
- curation protocol
- prompt templates
- guardrails
- review schemas
- synthetic examples
- a small local validator
- a development trace narrative, index, and coverage audit

## What They Do Not Get

They do not get the database or any gathered source records. The database
release, if needed, should be a separate package with separate provenance,
license, and data-use notes.

## Suggested First Read Order

1. `README.md`
2. `docs/architecture.md`
3. `docs/curation_protocol.md`
4. `docs/development_trace.md`
5. `docs/development_trace_coverage_audit.md`
6. `docs/development_trace_index_summary.md`
7. `docs/development_trace_flow.svg`
8. `protocol/prompts/review_prompt.md`
9. `examples/synthetic_batch.json`
10. `examples/synthetic_verdict.json`
11. `SOURCE_PROVENANCE.md`

## Currentness

Read `SOURCE_PROVENANCE.md` for the exact private source revision represented by
the public package. Refresh the package after a tested private implementation
change materially changes the method, prompts, schema, agent guidance, or
collaborator setup. Do not refresh it merely because the live JSONL or runtime
state changed.
