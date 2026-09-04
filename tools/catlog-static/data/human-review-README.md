# CatLog public human-review ledger

This directory publishes the original recorded human-review layer separately
from the CatLog data and from later agent-assisted adjudication. It lets a
reader join a decision to the corresponding public CatLog row by
`measurement_key`.

The ledger contains only two fields: `measurement_key` and
`original_human_review_status`. The status is the latest recorded human decision
from the union of browser exports, before adjudication or catalog import. It is
a reviewer verdict, not a claim of ground truth or the row's current catalog
disposition.

The public release deliberately excludes reviewer identity, comments, history,
timestamps, review keys, biological fields, citations, evidence, local paths,
agent traces, adjudication, and import actions. The stored review exports do not
identify the reviewer, so this artifact records decisions without independently
authenticating who made them.

Files:

- `human-review.jsonl`: inspectable canonical ledger.
- `human-review.jsonl.gz`: deterministic compressed copy.
- `human-review-manifest.json`: release, denominator, count, join, and checksum
  metadata.
- `human-review-schema.json`: the two-field JSON Schema.

The manifest binds this ledger to one public CatLog release. Every published
measurement key was verified to occur exactly once in that release. The ledger
is not a live-catalog import file and must not be used by itself to mutate the
catalog.

The same four files are mirrored at
`chowdhurylab/chowdhurylab.github.io/tools/catlog-static/data/`. Future human
review batches should regenerate this ledger, repeat the exact public-release
join and privacy checks, then update both copies with matching SHA-256 values.
CatLog badges and in-app display are intentionally deferred.
