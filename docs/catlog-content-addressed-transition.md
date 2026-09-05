# CatLog content-addressed transition

Status: local implementation checkpoint, not a deployed data release.

The viewer accepts legacy snapshot-f assets as well as new byte-hashed assets.
New hashed detail shards carry a source-generation stamp and are rejected if
it disagrees with the manifest. The existing bounded retry and error controls
remain in use. Hashed data URLs do not use version queries; legacy paths still
do. The compact viewer-index builder now resolves the table from its manifest
descriptor and names its output by the compressed bytes' SHA-256.

The publication checker requires the next manifest's current data references
to be content-addressed and bound to exact staged file hashes, sizes and source
stamps. It permits unreferenced previous-generation files so cached manifests
can still load. Consequently the current legacy-f data is not a releasable
input to that new gate: complete the data transition before pushing this branch.

## Checked

- Twelve publication-binding unit tests pass.
- The full viewer behavior test passes against unchanged snapshot-f data,
  including the new hashed-loader runtime fixtures.
- JavaScript syntax and stable-alias synchronization pass.
- The originating exporter has dedicated hashed-data, deterministic export,
  privacy and legacy compatibility coverage. A generated synthetic new shard
  also passed old-loader and prebound-key execution.

## Release hold

The current tracked tree is 749.44 MiB; its CatLog data is 444.55 MiB.
Adding a comparable generation while retaining the current one projects to
1,193.98 MiB. This is above the [GitHub Pages 1 GB published-site limit](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
No replacement data has been built or copied into this branch.

Resolve the data-size/hosting decision first. Do not silently delete the
previous generation or unrelated lab assets, and do not confuse rewriting Git
history with reducing the live site's payload size. Then integrate the fresh
public-only bundle, build the compact index, synchronize the alias, run the
complete staged-data and privacy checks, and inspect both URLs locally before
merging and live afterward. This checkpoint does not close R6.
