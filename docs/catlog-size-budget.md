# CatLog publication size budget

Run `python3 scripts/check-catlog-publish.py` after staging a release. Its
first check sums the logical bytes of every staged file path, including files
outside CatLog and duplicate copies of the same Git blob. The release ceiling
is 1,000,000,000 bytes; missing object sizes fail the check without fetching
them implicitly. The checker reports the total and remaining byte budget.

This conservative tracked-tree budget is not a measurement of the deployed
artifact, compressed Git history, or exclusive local disk allocation. GitHub
recommends a 1 GB Pages source repository and limits the published site to
1 GB. See the [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

At main `e17823c6`, the tracked tree was 871,630,327 bytes across 1,554 files.
CatLog data accounted for 551,816,895 bytes across 1,225 files. Recalculate
after staging: these values are a dated baseline, not a standing allowance.

Keep only the active public snapshot and the one compatibility predecessor
required by the content-addressed transition. Do not add a third generation
without first retiring the previous compatibility copy through the release
procedure. Preserve cached-page compatibility while doing so. The byte check
does not enforce this generation-count rule or decide which files are safe to
remove; see [the transition contract](catlog-content-addressed-transition.md).

Long-term archives belong in an approved public release/archive service, not
additional snapshot directories or archival branches. Ordinary deletion
commits do not remove historical Git objects. A historical purge is separate,
coordinated maintenance and must preserve any approved recovery references;
this size check neither performs nor authorizes one.
