#!/usr/bin/env python3
"""Build the deterministic, browser-only CatLog record index.

Schema 2 (``encoding: header_arrays_enums``): line 1 is a header naming the fields and the shared values of the
low-cardinality fields; every further line is one JSON array per record, already in the page's default order
(Review status), so the first rows can be shown while the rest of the file is still downloading.

The search box also finds a paper's records by PMID or DOI: when the Full data download of the same snapshot sits
next to the table (or is named), each row also carries its paper identifiers (PAPER_FIELDS).
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import os
import re
import tempfile
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
CATALOG_ROOT = REPOSITORY_ROOT / "tools" / "catlog-static"
DATA_ROOT = CATALOG_ROOT / "data"
MANIFEST = DATA_ROOT / "manifest.js"
MANIFEST_PREFIX = "window.CATLOG_STATIC_MANIFEST = "

SCHEMA_VERSION = 2
ENCODING = "header_arrays_enums"
ROW_ORDER = "default_review_status"
DETAILS_PER_SHARD = 250  # the exporter's detail-shard size; build(..., details_per_shard=) overrides it

# Keep this explicit: a changed source schema must trigger a review of what the
# browser reads instead of silently growing or shrinking the viewer contract.
# Written per row, in this order (then "s", the detail-shard number).
VIEWER_FIELDS = (
    "record_key",
    "review_key",
    "enzyme_display_name",
    "ec_number",
    "organism",
    "substrate_name",
    "mutation_signature",
    "primary_uniprot_id",
    "protein_accession",
    "kcat_display",
    "km_display",
    "kcat_over_km_display",
    "kcat",
    "km",
    "kcat_over_km",
    "ph_display",
    "temperature_k",
    "source_record_count",
    "enzyme_label_source",
    "source_db",
    "verification_status",
    "evidence_confidence_tier",
    "sequence_variant_status",
    "kcat_over_km_origin",
    "public_trust_basis",
    "temperature_display",
    "condition_flags",
    "kcat_unit",
    "km_unit",
    "kcat_over_km_unit",
    "wild_type",
)

# Written as an index into header["enums"][field]: few distinct values, repeated on every row.
ENUM_FIELDS = (
    "enzyme_label_source",
    "source_db",
    "verification_status",
    "evidence_confidence_tier",
    "sequence_variant_status",
    "kcat_over_km_origin",
    "public_trust_basis",
    "temperature_display",
    "condition_flags",
    "kcat_unit",
    "km_unit",
    "kcat_over_km_unit",
    "wild_type",
)

# Text written as an index into header["texts"][field] when it is one of that field's common values (50+ rows);
# other values stay inline. These fields hold text or null only (the build fails on a number).
SHARED_TEXT_FIELDS = (
    "enzyme_display_name",
    "ec_number",
    "organism",
    "substrate_name",
    "mutation_signature",
    "primary_uniprot_id",
    "kcat_display",
    "km_display",
    "kcat_over_km_display",
)
SHARED_TEXT_MIN_ROWS = 50
SHARED_TEXT_MAX_VALUES = 4096
# A number written as true: the browser reads it from its *_display text (Number(display) is the stored value).
NUMBER_FROM_DISPLAY = {"kcat": "kcat_display", "km": "km_display", "kcat_over_km": "kcat_over_km_display"}
# Written as true when equal to another field of the same row (and not null).
SAME_AS = {"review_key": "record_key", "protein_accession": "primary_uniprot_id"}
# Not written; the browser restores them (the build fails if a row breaks the rule).
DERIVED_FIELDS = {"measurement_key": "record_key", "ph": "ph_display"}
# Record-panel fields: every detail shard carries them, so the table index does not.
DETAIL_ONLY_FIELDS = (
    "identity_resolution_state",
    "uniprot_candidate_ids",
    "sequence_resolved",
    "has_proof_excerpt",
    "proof_kind",
    "has_literature_id",
    "protein_accession_database",
    "source_protein_accession",
    "kcat_over_km_source_differs",
)

OMITTED_FIELDS = (
    "enzyme_name_source",
    "paper_grounding_status",
    "literature_linkage",
    "ki",
    "ki_display",
    "has_sequence",
    "sequence_source_confidence",
    "pmid_count",
    "doi_count",
    "literature_id_count",
    "has_ki",
    "source_license",
    "temperature_c",
    "ki_unit",
    *DERIVED_FIELDS,
    *DETAIL_ONLY_FIELDS,
)

TABLE_FIELDS = (
    "record_key",
    "measurement_key",
    "review_key",
    "enzyme_display_name",
    "enzyme_label_source",
    "enzyme_name_source",
    "primary_uniprot_id",
    "identity_resolution_state",
    "uniprot_candidate_ids",
    "ec_number",
    "organism",
    "substrate_name",
    "source_db",
    "verification_status",
    "evidence_confidence_tier",
    "paper_grounding_status",
    "literature_linkage",
    "kcat",
    "kcat_display",
    "km",
    "km_display",
    "ki",
    "ki_display",
    "kcat_over_km",
    "kcat_over_km_display",
    "wild_type",
    "mutation_signature",
    "sequence_resolved",
    "has_sequence",
    "sequence_source_confidence",
    "sequence_variant_status",
    "source_record_count",
    "pmid_count",
    "doi_count",
    "literature_id_count",
    "has_proof_excerpt",
    "has_ki",
    "has_literature_id",
    "protein_accession",
    "protein_accession_database",
    "source_protein_accession",
    "kcat_over_km_origin",
    "kcat_over_km_source_differs",
    "proof_kind",
    "source_license",
    "public_trust_basis",
    "ph",
    "ph_display",
    "temperature_k",
    "temperature_c",
    "temperature_display",
    "condition_flags",
    "kcat_unit",
    "km_unit",
    "ki_unit",
    "kcat_over_km_unit",
)

# Table fields a snapshot may or may not carry. A row may hold them anywhere among its keys; the other keys must still be
# TABLE_FIELDS in order. When any row holds one, the index writes it after VIEWER_FIELDS (null on rows without it), as
# inline text: condition_note is what tells a record read by CatLog from a sibling of its paper that reads the same
# ("+10 mM FBP"), under the substrate in the table (about 100 records, so it is not a shared text).
OPTIONAL_TEXT_FIELDS = ("condition_note",)

# How a record compares with the enzyme databases (BRENDA, SABIO-RK, OED, SKiD, STRENDA DB for the same paper), for the
# sidebar's "Against the databases" group. The Table download may carry it in any of these shapes (the CatLog side's
# per-value database_status, a record-level summary, or the earlier review's corrections list); the index writes one
# compact number per record, "database_summary" (after the optional text fields, null on rows without it), only when
# some row has one. The per-value lines themselves stay in the record's detail file.
DATABASE_FIELDS = (
    "database_summary",
    "database_statuses",
    "database_status",
    "kcat_database_status",
    "km_database_status",
    "kcat_over_km_database_status",
    "corrections",
    "corrections_count",
    "database_note",
)
DATABASE_SUMMARY_FIELD = "database_summary"
# The summary's bits: a value the same as a database lists (1), a value CatLog corrected against a database (2), a
# different number not yet resolved (4), a value no database lists (8), the same number under another label (16), and
# an earlier "corrected" record whose changes are listed (32). A calculated kcat/Km is not compared (0).
DATABASE_STATUS_BITS = {
    "confirmed": 1, "same": 1, "same_number": 1,
    "corrected": 2,
    "differs": 4, "different": 4, "differs_not_resolved": 4,
    "new": 8, "new_paper_not_in_databases": 8, "paper_not_in_databases": 8, "not_in_databases": 8,
    "same_number_other_label": 16, "other_label": 16,
    "not_compared": 0, "calculated": 0,
}
DATABASE_EARLIER_CORRECTIONS_BIT = 32
DATABASE_SUMMARY_MASK = 63


def database_summary(values: dict, unknown: dict[str, int]) -> int | None:
    """One record's comparison with the enzyme databases as DATABASE_STATUS_BITS (None when the row says nothing, or
    only that nothing was compared).
    A number is taken as it is (masked); statuses may be one text ("corrected", or "confirmed; new"), a list, or an
    object keyed by parameter ({"kcat": "confirmed", "Km": {"status": "corrected"}}). A status this page does not know
    counts in `unknown` and adds nothing."""
    bits = 0

    def add(status: object) -> None:
        nonlocal bits
        if isinstance(status, dict):
            status = status.get("status", status.get("database_status"))
        if status is None or status == "":
            return
        if isinstance(status, (list, tuple)):
            for item in status:
                add(item)
            return
        for part in re.split(r"[;,|]\s*", str(status)):
            key = part.strip().lower().replace(" ", "_").replace("-", "_")
            if not key:
                continue
            if key in DATABASE_STATUS_BITS:
                bits |= DATABASE_STATUS_BITS[key]
            else:
                unknown[key] = unknown.get(key, 0) + 1

    summary = values.get("database_summary")
    if isinstance(summary, bool):
        summary = None
    if isinstance(summary, (int, float)) and math.isfinite(summary):
        bits |= int(summary) & DATABASE_SUMMARY_MASK
    elif isinstance(summary, dict):
        for value in summary.values():
            add(value)
    else:
        add(summary)
    for field in ("database_statuses", "database_status", "kcat_database_status", "km_database_status",
                  "kcat_over_km_database_status"):
        value = values.get(field)
        add(list(value.values()) if isinstance(value, dict) else value)
    corrections = values.get("corrections")
    count = values.get("corrections_count")
    if (isinstance(corrections, list) and corrections) or (
            isinstance(count, (int, float)) and not isinstance(count, bool) and count > 0):
        bits |= DATABASE_EARLIER_CORRECTIONS_BIT
    return bits or None

# Paper identifiers, from the Full data download (catlog-enriched.<id>.jsonl.gz: pubmed_id, supporting_pmids, doi,
# supporting_dois), not the table. Written after VIEWER_FIELDS, before "s": "pmids" holds one PMID as a number, a list
# of them, or null; "dois" one index into header["dois"] (the lower-case DOIs, sorted), a list of indexes, or null.
# Without the Full data file of the same records the index has neither field and the page searches without them.
PAPER_FIELDS = ("pmids", "dois")
ENRICHED_NAME = re.compile(r"catlog-enriched\.[0-9a-f]{12}\.jsonl\.gz")
PMID_TEXT = re.compile(r"[1-9][0-9]{0,9}")
DOI_PREFIX = re.compile(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", re.IGNORECASE)

if (set(OPTIONAL_TEXT_FIELDS) | set(DATABASE_FIELDS)) & set(TABLE_FIELDS) or set(OPTIONAL_TEXT_FIELDS) & set(DATABASE_FIELDS):
    raise RuntimeError("an optional field is also a required table field")
if set(VIEWER_FIELDS) & set(OMITTED_FIELDS):
    raise RuntimeError("viewer and omitted fields overlap")
if set(TABLE_FIELDS) != set(VIEWER_FIELDS) | set(OMITTED_FIELDS):
    raise RuntimeError("viewer field contract does not partition the table schema")
if not (set(ENUM_FIELDS) | set(SHARED_TEXT_FIELDS) | set(NUMBER_FROM_DISPLAY) | set(SAME_AS)) <= set(VIEWER_FIELDS):
    raise RuntimeError("encoded fields must be viewer fields")
if set(ENUM_FIELDS) & (set(SHARED_TEXT_FIELDS) | set(NUMBER_FROM_DISPLAY) | set(SAME_AS)) \
        or set(SHARED_TEXT_FIELDS) & (set(NUMBER_FROM_DISPLAY) | set(SAME_AS)):
    raise RuntimeError("a field has one encoding only")

STATE_RANK = {"verified": 0, "corrected": 0, "manual_review_required": 1}
TIER_ORDER = {
    "paper_grounded_high_confidence": 0,
    "paper_grounded": 1,
    "cross_source_supported": 2,
    "literature_linked": 3,
    "candidate_only": 4,
}
MAX_SAFE_INTEGER = 2**53 - 1
DISPLAY_NUMBER = re.compile(r"[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_v2_row(row: dict) -> bool:
    """A CatLog v2 row (read from the paper); the page's isV2Row()."""
    return (
        row["source_db"] == "primary_paper_direct"
        and row["verification_status"] == "verified"
        and row["enzyme_label_source"] == "explicit_enzyme_name"
    )


def _number(value: object) -> float:
    """JavaScript Number(value || 0) for the values the table holds."""
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    if value in (None, ""):
        return 0.0
    return float(value)


def default_order_key(row: dict, position: int) -> tuple:
    """The page's rowComparator("evidence"): accepted first, CatLog v2 rows leading them, then tier, more source
    records, EC number by its numeric parts, the EC text and the table position. Python compares the EC text by code
    point where the page uses localeCompare; the page checks the order once and sorts again if they ever disagree."""
    ec = str(row["ec_number"] or "")
    parts = tuple(int(part) if re.fullmatch(r"[0-9]+", part) else MAX_SAFE_INTEGER for part in ec.split("."))
    tier = -1 if is_v2_row(row) else TIER_ORDER.get(row["evidence_confidence_tier"], 99)
    return (
        STATE_RANK.get(row["verification_status"], 2),
        tier,
        -_number(row["source_record_count"]),
        parts,
        ec,
        position,
    )


def _same_number(display: object, value: object) -> bool:
    if not isinstance(display, str) or isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    if not DISPLAY_NUMBER.fullmatch(display):
        return False
    parsed = float(display)
    return parsed == value and math.copysign(1.0, parsed) == math.copysign(1.0, float(value))


def _enum_key(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def shared_texts(source_path: Path) -> dict[str, list[str]]:
    """Per field, the values on SHARED_TEXT_MIN_ROWS+ rows, most common first (ties by text): written once in the
    header and referenced by number. A value shorter than 3 characters gains nothing and stays inline."""
    counts: dict[str, dict[str, int]] = {field: {} for field in SHARED_TEXT_FIELDS}
    with gzip.open(source_path, "rb") as source:
        for raw_line in source:
            if not raw_line.strip():
                continue
            row = json.loads(raw_line)
            for field in SHARED_TEXT_FIELDS:
                value = row.get(field)
                if isinstance(value, str) and len(value) >= 3:
                    counts[field][value] = counts[field].get(value, 0) + 1
    return {
        field: [
            value for value, count in sorted(values.items(), key=lambda item: (-item[1], item[0]))
            if count >= SHARED_TEXT_MIN_ROWS
        ][:SHARED_TEXT_MAX_VALUES]
        for field, values in counts.items()
    }


def _paper_ids(enriched_path: Path, record_keys: set[str]) -> dict[str, tuple[list[int], list[str]]] | None:
    """Per record_key, its PMIDs (the paper's own first) and lower-case DOIs from one Full data download; None when
    that download does not hold exactly these records (another snapshot's)."""
    found: dict[str, tuple[list[int], list[str]]] = {}
    with gzip.open(enriched_path, "rb") as source:
        for raw_line in source:
            if not raw_line.strip():
                continue
            row = json.loads(raw_line)
            key = row.get("record_key")
            if key not in record_keys or key in found:
                return None
            pmids: list[int] = []
            for value in (row.get("pubmed_id"), *(row.get("supporting_pmids") or ())):
                text = str(value or "").strip()
                if PMID_TEXT.fullmatch(text) and int(text) not in pmids:
                    pmids.append(int(text))
            dois: list[str] = []
            for value in (row.get("doi"), *(row.get("supporting_dois") or ())):
                text = DOI_PREFIX.sub("", str(value or "").strip()).lower()
                if text.startswith("10.") and "/" in text and text not in dois:
                    dois.append(text)
            found[key] = (pmids, dois)
    return found if len(found) == len(record_keys) else None


def paper_ids(source_path: Path, record_keys: set[str], enriched_path: Path | None = None):
    """The Full data download of these records and its paper identifiers: the named file, else the newest
    catlog-enriched.<id>.jsonl.gz next to the table that holds exactly the table's records; (None, {}) when the
    folder has none."""
    if enriched_path is not None:
        ids = _paper_ids(enriched_path, record_keys)
        if ids is None:
            raise RuntimeError(f"{enriched_path.name} does not hold the table's records")
        return enriched_path, ids
    candidates = sorted(
        (path for path in source_path.parent.iterdir() if ENRICHED_NAME.fullmatch(path.name)),
        key=lambda path: (-path.stat().st_mtime, path.name),
    )
    for candidate in candidates:
        ids = _paper_ids(candidate, record_keys)
        if ids is not None:
            return candidate, ids
    return None, {}


def _id_value(values: list[int]) -> object:
    """One identifier as itself, several as a list, none as null."""
    return values[0] if len(values) == 1 else (values or None)


def build(
    source_path: Path,
    target: Path,
    details_per_shard: int = DETAILS_PER_SHARD,
    enriched_path: Path | None = None,
) -> dict[str, object]:
    if type(details_per_shard) is not int or details_per_shard < 1:
        raise RuntimeError("details_per_shard must be a positive integer")
    texts = shared_texts(source_path)
    text_index = {field: {value: index for index, value in enumerate(values)} for field, values in texts.items()}
    record_keys: set[str] = set()
    enum_values: dict[str, list] = {field: [] for field in ENUM_FIELDS}
    enum_index: dict[str, dict[str, int]] = {field: {} for field in ENUM_FIELDS}
    rows: list[tuple[tuple, list, str, int]] = []
    optional_values: dict[str, dict[str, str]] = {field: {} for field in OPTIONAL_TEXT_FIELDS}
    database_values: dict[str, int] = {}
    database_unknown: dict[str, int] = {}
    source_bytes = 0
    encoded_numbers = {field: 0 for field in (*NUMBER_FROM_DISPLAY, *SAME_AS)}

    with gzip.open(source_path, "rb") as source:
        for line_number, raw_line in enumerate(source, start=1):
            if not raw_line.strip():
                continue
            source_bytes += len(raw_line)
            row = json.loads(raw_line)
            optional = {field: row.pop(field) for field in OPTIONAL_TEXT_FIELDS if field in row}
            database = {field: row.pop(field) for field in DATABASE_FIELDS if field in row}
            if tuple(row) != TABLE_FIELDS:
                missing = sorted(set(TABLE_FIELDS) - set(row))
                extra = sorted(set(row) - set(TABLE_FIELDS))
                raise RuntimeError(
                    f"source schema changed at line {line_number}: "
                    f"missing={missing}, extra={extra}"
                )
            record_key = str(row["record_key"] or "")
            if not record_key:
                raise RuntimeError(f"missing record_key at line {line_number}")
            if record_key in record_keys:
                raise RuntimeError(f"duplicate record_key at line {line_number}: {record_key}")
            record_keys.add(record_key)
            for field, value in optional.items():
                if value is not None and not isinstance(value, str):
                    raise RuntimeError(f"{field} is not text at line {line_number}: {value!r}")
                if value and value.strip():
                    optional_values[field][record_key] = value.strip()
            if database:
                summary = database_summary(database, database_unknown)
                if summary is not None:
                    database_values[record_key] = summary
            for field, source_field in DERIVED_FIELDS.items():
                value, source_value = row[field], row[source_field]
                if value != source_value or isinstance(value, bool) != isinstance(source_value, bool):
                    raise RuntimeError(
                        f"{field} differs from {source_field} at line {line_number}: the viewer index derives it"
                    )
            position = len(rows)
            values: list[object] = []
            for field in VIEWER_FIELDS:
                value = row[field]
                if field in SHARED_TEXT_FIELDS:
                    if value is not None and not isinstance(value, str):
                        raise RuntimeError(f"{field} is not text at line {line_number}: {value!r}")
                    if value is not None and value in text_index[field]:
                        value = text_index[field][value]
                elif field in ENUM_FIELDS:
                    key = _enum_key(value)
                    index = enum_index[field].get(key)
                    if index is None:
                        index = enum_index[field][key] = len(enum_values[field])
                        enum_values[field].append(value)
                    value = index
                elif field in NUMBER_FROM_DISPLAY and _same_number(row[NUMBER_FROM_DISPLAY[field]], value):
                    value = True
                    encoded_numbers[field] += 1
                elif field in SAME_AS and value is not None and value == row[SAME_AS[field]]:
                    value = True
                    encoded_numbers[field] += 1
                values.append(value)
            rows.append((default_order_key(row, position), values, record_key, position))

    rows.sort(key=lambda item: item[0])
    papers_path, ids = paper_ids(source_path, record_keys, enriched_path)
    paper_fields = PAPER_FIELDS if papers_path else ()
    optional_fields = tuple(field for field in OPTIONAL_TEXT_FIELDS if optional_values[field])
    if database_values:
        optional_fields += (DATABASE_SUMMARY_FIELD,)
    dois = sorted({doi for _pmids, row_dois in ids.values() for doi in row_dois})
    doi_index = {doi: index for index, doi in enumerate(dois)}
    encoded_rows: list[bytes] = []
    for _order, values, record_key, position in rows:
        values += [database_values.get(record_key) if field == DATABASE_SUMMARY_FIELD else optional_values[field].get(record_key)
                   for field in optional_fields]
        if paper_fields:
            row_pmids, row_dois = ids[record_key]
            values += [_id_value(row_pmids), _id_value([doi_index[doi] for doi in row_dois])]
        values.append(position // details_per_shard)
        encoded_rows.append((json.dumps(values, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
    header = {
        "kind": "catlog_viewer_index",
        "schema_version": SCHEMA_VERSION,
        "row_count": len(rows),
        "order": ROW_ORDER,
        "details_per_shard": details_per_shard,
        "fields": [*VIEWER_FIELDS, *optional_fields, *paper_fields, "s"],
        "enums": enum_values,
        "texts": texts,
    }
    if paper_fields:
        header["dois"] = dois
    header_line = (json.dumps(header, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    viewer_content_digest = hashlib.sha256()
    viewer_bytes = 0
    with target.open("wb") as raw_output:
        with gzip.GzipFile(
            filename="",
            mode="wb",
            fileobj=raw_output,
            compresslevel=9,
            mtime=0,
        ) as compressed_output:
            for encoded in (header_line, *encoded_rows):
                compressed_output.write(encoded)
                viewer_content_digest.update(encoded)
                viewer_bytes += len(encoded)

    return {
        "row_count": len(rows),
        "first_record_key": rows[0][2] if rows else "",
        "last_record_key": rows[-1][2] if rows else "",
        "details_per_shard": details_per_shard,
        "enum_value_counts": {field: len(values) for field, values in enum_values.items()},
        "shared_text_counts": {field: len(values) for field, values in texts.items()},
        "encoded_from_display": encoded_numbers,
        "source_path": str(source_path.relative_to(REPOSITORY_ROOT)),
        "source_sha256": sha256(source_path),
        "source_compressed_bytes": source_path.stat().st_size,
        "source_uncompressed_bytes": source_bytes,
        "viewer_sha256": sha256(target),
        "viewer_content_sha256": viewer_content_digest.hexdigest(),
        "viewer_compressed_bytes": target.stat().st_size,
        "viewer_uncompressed_bytes": viewer_bytes,
        "retained_fields": list(VIEWER_FIELDS),
        "omitted_fields": list(OMITTED_FIELDS),
        "optional_fields": list(optional_fields),
        "rows_with_optional": {field: len(database_values if field == DATABASE_SUMMARY_FIELD else optional_values[field])
                               for field in optional_fields},
        "database_summary_bits": {str(bit): sum(1 for value in database_values.values() if value & bit)
                                  for bit in (1, 2, 4, 8, 16, 32)} if database_values else {},
        "database_statuses_unknown": dict(sorted(database_unknown.items())),
        "paper_id_fields": list(paper_fields),
        "paper_ids_source": papers_path.name if papers_path else None,
        "rows_with_pmid": sum(1 for row_pmids, _dois in ids.values() if row_pmids),
        "rows_with_doi": sum(1 for _pmids, row_dois in ids.values() if row_dois),
    }


def active_manifest_path() -> Path:
    page = (CATALOG_ROOT / "index.html").read_text(encoding="utf-8")
    paths = re.findall(
        r'<script\b[^>]*\bsrc="(data/manifest(?:\.[0-9a-f]{12})?\.js)(?:\?v=[^"<>]*)?"',
        page,
    )
    if len(paths) != 1:
        raise RuntimeError("canonical CatLog page must load exactly one local manifest")
    return manifest_data_path(paths[0], field="manifest")


def load_manifest(path: Path | None = None) -> dict[str, object]:
    path = path or active_manifest_path()
    content = path.read_bytes()
    if path.name != "manifest.js":
        match = re.fullmatch(r"manifest\.([0-9a-f]{12})\.js", path.name)
        if match is None or match.group(1) != hashlib.sha256(content).hexdigest()[:12]:
            raise RuntimeError("manifest filename hash differs from its bytes")
    first_line = content.decode("utf-8").splitlines()[0]
    if not first_line.startswith(MANIFEST_PREFIX) or not first_line.endswith(";"):
        raise RuntimeError("unexpected CatLog manifest wrapper")
    return json.loads(first_line[len(MANIFEST_PREFIX) : -1])


def write_immutable_manifest(manifest: dict[str, object], template_path: Path) -> Path:
    """Finalize the new generation without replacing the legacy stable manifest."""
    _first_line, separator, suffix = template_path.read_text(encoding="utf-8").partition("\n")
    content = (
        MANIFEST_PREFIX + json.dumps(manifest, ensure_ascii=False, separators=(",", ":"))
        + ";" + separator + suffix
    ).encode("utf-8")
    target = DATA_ROOT / f"manifest.{hashlib.sha256(content).hexdigest()[:12]}.js"
    target.write_bytes(content)
    return target


def manifest_data_path(value: object, *, field: str) -> Path:
    relative = Path(str(value or ""))
    if not value or relative.is_absolute() or relative.parent != Path("data"):
        raise RuntimeError(f"manifest {field} must name one file under data/")
    return CATALOG_ROOT / relative


def viewer_descriptor(metadata: dict[str, object]) -> dict[str, object]:
    descriptor = {
        "path": metadata["viewer_path"],
        "sha256": metadata["viewer_sha256"],
        "content_sha256": metadata["viewer_content_sha256"],
        "size_bytes": metadata["viewer_compressed_bytes"],
        "uncompressed_size_bytes": metadata["viewer_uncompressed_bytes"],
        "format": "jsonl.gz",
        "encoding": ENCODING,
        "scope": "browser_runtime_row_index",
        "schema_version": SCHEMA_VERSION,
        "row_count": metadata["row_count"],
        "field_count": len(VIEWER_FIELDS),
        "row_order": ROW_ORDER,
        "details_per_shard": metadata.get("details_per_shard", DETAILS_PER_SHARD),
        "source_table_sha256": metadata["source_sha256"],
        "source_table_size_bytes": metadata["source_compressed_bytes"],
        "retained_fields": list(VIEWER_FIELDS),
        "omitted_fields": list(OMITTED_FIELDS),
        "enum_fields": list(ENUM_FIELDS),
        "shared_text_fields": list(SHARED_TEXT_FIELDS),
        "derived_fields": dict(DERIVED_FIELDS),
        "detail_only_fields": list(DETAIL_ONLY_FIELDS),
        "paper_id_fields": list(metadata.get("paper_id_fields", [])),
    }
    if metadata.get("optional_fields"):  # only then: an index without them keeps its earlier descriptor
        descriptor["optional_fields"] = list(metadata["optional_fields"])
    return descriptor


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail unless the committed viewer index matches a fresh deterministic build",
    )
    parser.add_argument("--manifest", help="use this data/manifest file instead of the page's active manifest")
    parser.add_argument(
        "--write-manifest", action="store_true",
        help="write a new content-addressed manifest containing the viewer descriptor; preserve manifest.js",
    )
    args = parser.parse_args()
    if args.check and args.write_manifest:
        parser.error("--check cannot be combined with --write-manifest")

    manifest_path = (
        manifest_data_path(args.manifest, field="manifest")
        if args.manifest else active_manifest_path()
    )
    manifest = load_manifest(manifest_path)
    table_descriptor = manifest.get("table_download") or {}
    if not isinstance(table_descriptor, dict):
        raise SystemExit("manifest table_download descriptor is invalid")
    source_path = manifest_data_path(
        table_descriptor.get("path"),
        field="table_download.path",
    )

    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    temporary_name = ""
    try:
        with tempfile.NamedTemporaryFile(
            prefix=".catlog-viewer-index.",
            suffix=".tmp",
            dir=DATA_ROOT,
            delete=False,
        ) as temporary:
            temporary_name = temporary.name
        temporary_path = Path(temporary_name)
        details_per_shard = manifest.get("details_per_shard", DETAILS_PER_SHARD)
        enriched_descriptor = manifest.get("enriched_download")
        enriched_path = (
            manifest_data_path(enriched_descriptor.get("path"), field="enriched_download.path")
            if isinstance(enriched_descriptor, dict) and enriched_descriptor.get("path") else None
        )
        metadata = build(source_path, temporary_path, details_per_shard=details_per_shard, enriched_path=enriched_path)
        if table_descriptor.get("sha256") != metadata["source_sha256"]:
            raise SystemExit("manifest table_download hash does not match the projection source")
        target = DATA_ROOT / f"catlog-viewer-index.{str(metadata['viewer_sha256'])[:12]}.jsonl.gz"
        metadata["viewer_path"] = str(target.relative_to(CATALOG_ROOT))
        expected_descriptor = viewer_descriptor(metadata)

        if args.check:
            current_descriptor = manifest.get("viewer_index") or {}
            if not isinstance(current_descriptor, dict):
                raise SystemExit("manifest viewer_index descriptor is invalid")
            if current_descriptor.get("path") != expected_descriptor["path"]:
                raise SystemExit("manifest viewer_index path does not match its content hash")
            current_target = manifest_data_path(
                current_descriptor.get("path"),
                field="viewer_index.path",
            )
            if not current_target.exists():
                raise SystemExit(
                    f"missing viewer index: {current_target.relative_to(REPOSITORY_ROOT)}"
                )
            if sha256(current_target) != metadata["viewer_sha256"]:
                raise SystemExit("committed viewer index is not the deterministic projection")
            if current_descriptor != expected_descriptor:
                raise SystemExit("manifest viewer_index metadata does not match the projection")
            outcome = "Viewer index is reproducible"
        else:
            os.replace(temporary_path, target)
            temporary_name = ""
            outcome = f"Wrote {target.relative_to(REPOSITORY_ROOT)}"
            if args.write_manifest:
                manifest["viewer_index"] = expected_descriptor
                finalized_manifest = write_immutable_manifest(manifest, manifest_path)
                print(f"Final manifest: {finalized_manifest.relative_to(CATALOG_ROOT)}")

        print(outcome)
        print(json.dumps(metadata, indent=2, sort_keys=True))
        print("Expected manifest viewer_index:")
        print(json.dumps(expected_descriptor, indent=2, sort_keys=True))
        return 0
    finally:
        if temporary_name:
            Path(temporary_name).unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
