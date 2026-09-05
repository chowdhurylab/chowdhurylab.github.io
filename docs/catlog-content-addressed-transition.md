# CatLog content-addressed transition

Status: local implementation checkpoint, not a deployed data release.

The viewer accepts legacy snapshot-f JavaScript assets as well as new
byte-hashed gzip JSONL details. Each compressed detail shard starts with a
versioned header binding its source generation and row count. The complete
payload is decoded and validated before it enters the cache. Failed streams
are cancelled and released before retrying; existing retries, in-flight
deduplication and bounded detail caching remain in use. Hashed data URLs do
not use version queries; legacy paths still do.

New HTML loads a content-addressed manifest. Keep the stable `data/manifest.js`
and snapshot-f data unchanged for old cached HTML. The viewer-index builder
accepts an explicit `--manifest data/manifest.<sha12>.js`; `--write-manifest`
adds the index descriptor to a new hash-named manifest without replacing the
stable legacy manifest. Publication must explicitly activate the final path
printed by that command, then synchronize the alias. The preliminary exporter
manifest does not yet contain the viewer-index descriptor.

The publication checker requires the next manifest's current data references
to be content-addressed and bound to exact staged file hashes, sizes and source
stamps. It selects that manifest from staged canonical HTML, streams and
validates gzip/JSONL framing, and checks shard ordering, per-shard counts and
unique keys. It permits unreferenced previous-generation files so cached
manifests can still load. Usage-tracker and stable-alias checks also require
the tracked working tree to match the staged release. The legacy-f HTML alone
is not releasable through this new gate: complete the transition before pushing.

## Checked

- Thirty-two publication-binding unit tests pass.
- Four manifest-finalization tests pass, including CLI finalization, explicit
  HTML activation, index reproducibility and unchanged stable-manifest bytes.
- The full viewer behavior test passes against unchanged snapshot-f data,
  including gzip fixtures, generation mismatch, malformed data, cancellation,
  retries, in-flight sharing and cache eviction.
- JavaScript syntax passes. Alias synchronization must be repeated after
  activating the new manifest.
- Originating exporter commit `05ebb387064d02773e009311269341f717ede035`
  has focused losslessness, deterministic compression, strict JSON-number,
  privacy, condition, license, memory and offline-compatibility coverage.

## Release hold

A fresh public-only bundle has now been built: 151,404 rows, 606 detail shards,
no record chunks, no full-data archive, and no canonical write. Its source
SHA-256 is `7a088994b245d864e34552b654ab9b98416beaa1b98291eef8c372edb190da0c`.
Compressed details occupy 30,180,421 bytes; the generated data directory is
74,855,208 bytes before adding the viewer index. This resolves the earlier
uncompressed-size constraint without dropping snapshot f or changing hosts.
Integration and index finalization are complete. Both pages now select
`data/manifest.004cd02af661.js` (SHA-256
`004cd02af6618900491f4d02d61aecd2608b016325684052fa21404ee94e4835`).
The index is `catlog-viewer-index.a01f98cefb4d.jsonl.gz`, 10,819,926 bytes.
All 611 data changes are additions; legacy snapshot-f data and its stable
manifest are unchanged. The staged publication checker passed on 1,225
tracked data blobs, with a clean tracked working tree/index comparison,
synchronized alias and exact README match to the exporter output.

Before this documentation update, the complete staged tree measured
871,592,209 bytes, below the conservative 1,000,000,000-byte ceiling for the
[GitHub Pages published-site limit](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
Recheck final tree size before publication.

Next: reproduce the real index with `--check`, rerun the viewer test against
the activated manifest, finish privacy and human-review join checks, inspect
both URLs locally on desktop and mobile, merge, and verify live with a
cache-busting query. This local checkpoint is not a published release and
does not close R6.
