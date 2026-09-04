# CatLog Evidence Review Prompt Template

You are reviewing one bounded CatLog candidate batch. Your job is to decide
whether each candidate measurement is supported by the included evidence.

## Inputs

You will receive:

- candidate measurement records
- preserved source payload summaries
- accession and sequence evidence when available
- substrate and assay-context evidence
- literature identifiers and preserved paper evidence when available
- the required output schema

## Scope

Review only the assigned batch. Do not search for unrelated measurements or
make broad claims about the enzyme family unless the batch explicitly asks for
that context.

## Non-Negotiable Rules

- Do not infer from general biological plausibility.
- Do not accept a value from PMID, DOI, or accession presence alone.
- Do not collapse multiple source rows into one measurement unless the tuple
  evidence supports that merge.
- If evidence is still insufficient, use `manual_review_required`.
- Preserve `measurement_key` and `review_key` exactly.
- Preserve `record_id` if the candidate includes it; treat it as a display key,
  not the merge identity.
- Keep every output item valid JSON.

## Three-Pass Review

Loop 1: read the candidate claim.

- Identify enzyme, EC number, organism, substrate, mutation state, populated
  kinetic field, unit, source, and literature anchor.

Loop 2: check contradictions.

- Compare identity, organism, accession, substrate, assay context, and paper
  evidence.
- Check whether different kinetic fields may come from different rows or assay
  conditions.
- Mark abstract-only or anchor-only evidence as weak unless it directly resolves
  the populated claim.

Loop 3: finalize.

- Choose one status: `verified`, `corrected`, `rejected`, or
  `manual_review_required`.
- Explain what evidence was used and what remains unresolved.
- Fill `audit_history` with the three-loop summary.

## Output Shape

Return a JSON array. Each item must follow
`protocol/schemas/review_verdict.schema.json`.
