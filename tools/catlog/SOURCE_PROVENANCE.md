# Source Provenance And Update Boundary

This public package is a deliberately data-free, curated representation of the
CatLog method. It is not a byte-for-byte source equivalent, Git mirror, or
production checkout.

## Current Source Anchor

- Private implementation: `SupanthaDey9/realkcat`
- Source branch: `main`
- Source commit: `ef3e02df3166e31b5e3957444fc96cc895486134`
- Public-package refresh date: `2026-09-04`
- Public location: `chowdhurylab/chowdhurylab.github.io`, path `tools/catlog/`
- Public branch: `main`

The source commit identifies the last private implementation revision reviewed
for this package. Later private, uncommitted, or operational work is not implied
to be present here.

## What Is Synchronized

Refresh this package when a verified private change materially alters the
shareable method, including its architecture, review contract, prompt design,
schema, validation behavior, agent guidance, or collaborator setup.

The public package preserves the method in a portable form: explanatory docs,
sanitized prompts and schemas, synthetic examples, a small validator, and a
repo-scoped agent skill. It does not copy the private repository's Git history.

## What Never Synchronizes Here

- `data/verified_catlog.jsonl` or any other harvested/curated database export
- real review packets, paper extracts, PDFs, or row-level evidence
- runtime state, queues, locks, process IDs, receipts, rollback, or recovery files
- credentials, local configuration, Codex sessions, or machine-specific state
- Box backup archives

The live JSONL remains an operator-controlled local file. A separately managed,
private Box upload may be made occasionally for disaster recovery; it is not a
GitHub artifact and does not make this public package a data release.

## Refresh Rule

For every material public-method update:

1. test and commit the reusable change in the private implementation;
2. refresh only the affected data-free files in this package;
3. run `./scripts/validate-example.sh` and validate the repo skill;
4. update the exact source commit above;
5. publish the package to `tools/catlog/` without changing
   `tools/catlog-latest.html` or `tools/catlog-static/`.

This is an explicit verified release step, not an automatic push of every local
edit. That distinction prevents unfinished code or runtime data from entering a
public Git history. `PUBLIC_MANIFEST.sha256` and the public repository history
provide the package-level integrity record.
