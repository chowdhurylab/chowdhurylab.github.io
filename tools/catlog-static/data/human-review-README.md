# CatLog public merged human-review ledger

This directory publishes the substantive human-review layer separately from
the current CatLog data and from later agent-assisted adjudication. It combines
all distinct stored browser exports into one record per `measurement_key`, using
the latest submitted human decision as the final state. The release manifest
records the current export and decision counts.

Each row includes:

- the opaque `measurement_key`, which joins to the corresponding public CatLog
  row;
- `human_review.final`: the final submitted status and its paired comment; and
- `human_review.submitted_decisions`: the meaningful submitted status/comment
  sequence, so a reader can see reversals or changed notes.

Repeated exports often contain the same submission at several timestamps. The
public history collapses adjacent identical status/comment states and removes
the timestamps. Empty comments are encoded as JSON `null`. Comments are kept
verbatim and paired with the status submitted in the same decision object.
They are reviewer notes, not necessarily complete rationales; rare
status/comment combinations that read inconsistently are preserved rather than
silently reinterpreted.

The stored exports leave `reviewer_name` blank, and the review format can also
be imported by compatible tools. This release therefore establishes that a
note was submitted through the human-review results format, not independently
authenticated authorship. Some common notes may come from predefined reason
choices in the review interface.

The retained review reference pack is used to verify every reviewed key and the
private overlay join. Its EC numbers, organisms, substrates, source-database
labels, status/tier fields, and citation identifiers are not copied into this
ledger. Readers can obtain the current scientific context by joining
`measurement_key` to the public CatLog release named in the manifest. The
campaign includes exports made against more than one catalog snapshot, and the
manifest lists those source-snapshot identities.

Files:

- `human-review.jsonl`: inspectable merged public ledger.
- `human-review.jsonl.gz`: deterministic compressed copy.
- `human-review-manifest.json`: release, denominator, count, provenance, join,
  and checksum metadata.
- `human-review-schema.json`: JSON Schema for each JSONL row.

The public release excludes unsubmitted draft comments, activity timestamps,
reviewer identity, internal review keys and flags, scientific source fields,
full evidence, local paths, agent traces, adjudication verdicts, adjudication
reasons, and catalog import actions. Those private layers must not be inferred
from this file or folded into the human comments. In this release, every
nonempty draft-comment value is already present in a submitted decision
history, so omitting the draft field does not remove any distinct
review-comment text.

The manifest binds this ledger to one public CatLog release. Every published
measurement key was verified to occur exactly once in that release. The ledger
is not a live-catalog import file and must not be used by itself to mutate the
catalog.

This release is published at the repository owner's direction for inspection
and provenance. The stored exports do not authenticate the named author of a
submission. No separate reuse license is granted for the human-review
annotations by this data release; the repository's software license and the
public CatLog's source-data terms are separate matters.

The same four release files are mirrored at
`chowdhurylab/chowdhurylab.github.io/tools/catlog-static/data/`. Future human
review batches should regenerate the ledger from the raw-export manifest and
canonical merged overlay. The builder verifies every stored export checksum and
summary, proves the overlay equals their union, repeats the review-pack and
public-release joins and free-text privacy checks, generates the schema, then
updates the checksummed artifacts. Both repositories must receive byte-matching
copies. CatLog badges and in-app display are intentionally deferred.
