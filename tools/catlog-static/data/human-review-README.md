# CatLog human review

- `human-review.jsonl` (and the identical `human-review.jsonl.gz`): one line per reviewed record, with the reviewer's
  final decision (approved or rejected), its comment, and the earlier decisions when they changed. It holds no
  reviewer names and no times.
- Join key: `measurement_key`, the record's key in the CatLog snapshot named in `human-review-manifest.json`, which
  also gives the counts and checksums; `human-review-schema.json` describes each line.
- `human-review-marks.json` is what the CatLog page reads: a record on which a human reviewer approved every value
  shows "human-checked".
- Comments are the reviewers' notes as written; they are not a full reason for every decision.
- No separate reuse license is granted for these review annotations.
