# CatLog Methods Text

## Short Methods Version

CatLog was built as an agent-assisted curation framework for enzyme-kinetic
measurements. Measurements were retrieved from kinetic databases and linked to
supporting identity and literature evidence. Source records were converted into
a common schema while retaining original database fields, kinetic values,
literature identifiers, accession evidence, substrate annotations, mutation
context, and assay context.

Automated checks first tested whether each measurement could be linked to a
defined enzyme identity, the reported organism, the corresponding sequence or
mutation state, the measured substrate, and the supporting literature source.
Passing these checks did not itself add a record. Structured review produced a
verdict, after which deterministic validation, writer admission for the current
measurement and review identity, guarded atomic application, same-generation
integrity audit, and exact-key readback determined acceptance. Records with
unresolved identity, sequence, substrate, assay-context, or paper-evidence
conflicts were evaluated against preserved source records and literature
evidence. Records that could not be resolved after review were retained in a
separate follow-up set and excluded from the curated set until additional
evidence became available.

## Backbone Version

CatLog was operated as a persistent curation system rather than a one-pass
extraction script. Each candidate measurement retained its source payload,
automated check results, review outcome, rationale, field-level corrections,
and update history. The system separated resolved records, active review
records, and follow-up records so that uncertain measurements remained visible
without entering the curated dataset prematurely. This structure allowed
long-running curation sessions to resume from preserved state while keeping
each accepted change traceable to the underlying source evidence.

## Figure Caption Draft

Overview of the CatLog curation backbone. Enzyme-kinetic measurements are
collected from primary kinetic databases and linked to identity and literature
evidence. Automated checks evaluate enzyme identity, organism, sequence or
mutation state, substrate identity, assay context, and literature support.
The checks and structured review emit candidate verdicts; deterministic writer
admission, atomic application, same-generation integrity audit, and exact-key
readback determine entry into the curated dataset. Records that remain
unresolved are retained in a separate follow-up set, preserving provenance
without introducing unsupported values into the curated dataset.
