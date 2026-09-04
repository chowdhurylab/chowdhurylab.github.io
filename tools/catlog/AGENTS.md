# CatLog Method Repo Agent Notes

## Scope

This folder is a clean, data-free CatLog method package. Keep it focused on
architecture, protocol, prompts, schemas, synthetic examples, and small helper
code.

Read `SOURCE_PROVENANCE.md` before claiming that this package reflects a current
private implementation revision. The private repository remains the source of
truth; this package is a reviewed public-method release.

The included public skill is explanatory and synthetic-data-only. It does not
include, start, or operate the private production supervisors or writers.

## Naming

- Use `CatLog` for the project name.
- Do not reintroduce older project names or live-workspace names.
- Avoid internal runtime labels in paper-facing docs unless they are being
  documented as generic implementation choices.

## Safety

Do not add:

- harvested database exports
- raw source payloads
- live review queues
- credential files
- paper PDFs or extraction caches
- runtime logs
- rollback files
- screenshots or scratch artifacts

## Verification

After edits, run:

```bash
./scripts/validate-example.sh
```

When the repo-scoped skill changes, also run the skill validator. Scan for
credentials, private paths, real records, and accidental runtime files before
sharing. A public refresh must not alter the website's
`tools/catlog-latest.html` or `tools/catlog-static/` paths.
