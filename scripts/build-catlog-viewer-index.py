#!/usr/bin/env python3
"""Build the deterministic, browser-only CatLog record index."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import tempfile
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SOURCE = REPOSITORY_ROOT / "tools" / "catlog-static" / "data" / "catlog-table.jsonl.gz"
TARGET = REPOSITORY_ROOT / "tools" / "catlog-static" / "data" / "catlog-viewer-index.jsonl.gz"
MANIFEST = REPOSITORY_ROOT / "tools" / "catlog-static" / "data" / "manifest.js"
MANIFEST_PREFIX = "window.CATLOG_STATIC_MANIFEST = "

# Keep this explicit: a changed source schema must trigger a review of what the
# browser reads instead of silently growing or shrinking the viewer contract.
VIEWER_FIELDS = (
    "record_key",
    "measurement_key",
    "review_key",
    "enzyme_display_name",
    "enzyme_label_source",
    "primary_uniprot_id",
    "identity_resolution_state",
    "uniprot_candidate_ids",
    "ec_number",
    "organism",
    "substrate_name",
    "source_db",
    "verification_status",
    "evidence_confidence_tier",
    "kcat",
    "kcat_display",
    "km",
    "km_display",
    "kcat_over_km",
    "kcat_over_km_display",
    "wild_type",
    "mutation_signature",
    "sequence_resolved",
    "sequence_variant_status",
    "source_record_count",
    "has_proof_excerpt",
    "proof_kind",
    "has_literature_id",
    "protein_accession",
    "protein_accession_database",
    "source_protein_accession",
    "kcat_over_km_origin",
    "kcat_over_km_source_differs",
    "public_trust_basis",
    "ph",
    "ph_display",
    "temperature_k",
    "temperature_display",
    "condition_flags",
    "kcat_unit",
    "km_unit",
    "kcat_over_km_unit",
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

if set(VIEWER_FIELDS) & set(OMITTED_FIELDS):
    raise RuntimeError("viewer and omitted fields overlap")
if set(TABLE_FIELDS) != set(VIEWER_FIELDS) | set(OMITTED_FIELDS):
    raise RuntimeError("viewer field contract does not partition the table schema")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build(target: Path) -> dict[str, object]:
    row_count = 0
    source_bytes = 0
    viewer_bytes = 0
    first_record_key = ""
    last_record_key = ""
    record_keys: set[str] = set()
    viewer_content_digest = hashlib.sha256()

    with target.open("wb") as raw_output:
        with gzip.GzipFile(
            filename="",
            mode="wb",
            fileobj=raw_output,
            compresslevel=9,
            mtime=0,
        ) as compressed_output:
            with gzip.open(SOURCE, "rb") as source:
                for line_number, raw_line in enumerate(source, start=1):
                    if not raw_line.strip():
                        continue
                    source_bytes += len(raw_line)
                    row = json.loads(raw_line)
                    if tuple(row) != TABLE_FIELDS:
                        missing = sorted(set(TABLE_FIELDS) - set(row))
                        extra = sorted(set(row) - set(TABLE_FIELDS))
                        raise RuntimeError(
                            f"source schema changed at line {line_number}: "
                            f"missing={missing}, extra={extra}"
                        )
                    projected = {field: row[field] for field in VIEWER_FIELDS}
                    encoded = (
                        json.dumps(projected, ensure_ascii=False, separators=(",", ":"))
                        + "\n"
                    ).encode("utf-8")
                    compressed_output.write(encoded)
                    viewer_content_digest.update(encoded)
                    viewer_bytes += len(encoded)
                    record_key = str(row["record_key"])
                    if not record_key:
                        raise RuntimeError(f"missing record_key at line {line_number}")
                    if record_key in record_keys:
                        raise RuntimeError(f"duplicate record_key at line {line_number}: {record_key}")
                    record_keys.add(record_key)
                    if not first_record_key:
                        first_record_key = record_key
                    last_record_key = record_key
                    row_count += 1

    return {
        "row_count": row_count,
        "first_record_key": first_record_key,
        "last_record_key": last_record_key,
        "source_path": str(SOURCE.relative_to(REPOSITORY_ROOT)),
        "source_sha256": sha256(SOURCE),
        "source_compressed_bytes": SOURCE.stat().st_size,
        "source_uncompressed_bytes": source_bytes,
        "viewer_path": str(TARGET.relative_to(REPOSITORY_ROOT)),
        "viewer_sha256": sha256(target),
        "viewer_content_sha256": viewer_content_digest.hexdigest(),
        "viewer_compressed_bytes": target.stat().st_size,
        "viewer_uncompressed_bytes": viewer_bytes,
        "retained_fields": list(VIEWER_FIELDS),
        "omitted_fields": list(OMITTED_FIELDS),
    }


def load_manifest() -> dict[str, object]:
    first_line = MANIFEST.read_text(encoding="utf-8").splitlines()[0]
    if not first_line.startswith(MANIFEST_PREFIX) or not first_line.endswith(";"):
        raise RuntimeError("unexpected CatLog manifest wrapper")
    return json.loads(first_line[len(MANIFEST_PREFIX) : -1])


def viewer_descriptor(metadata: dict[str, object]) -> dict[str, object]:
    return {
        "path": "data/catlog-viewer-index.jsonl.gz",
        "sha256": metadata["viewer_sha256"],
        "content_sha256": metadata["viewer_content_sha256"],
        "size_bytes": metadata["viewer_compressed_bytes"],
        "uncompressed_size_bytes": metadata["viewer_uncompressed_bytes"],
        "format": "jsonl.gz",
        "scope": "browser_runtime_row_index",
        "schema_version": 1,
        "row_count": metadata["row_count"],
        "field_count": len(VIEWER_FIELDS),
        "row_order": "identical_to_table_download",
        "source_table_sha256": metadata["source_sha256"],
        "source_table_size_bytes": metadata["source_compressed_bytes"],
        "retained_fields": list(VIEWER_FIELDS),
        "omitted_fields": list(OMITTED_FIELDS),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail unless the committed viewer index matches a fresh deterministic build",
    )
    args = parser.parse_args()

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    temporary_name = ""
    try:
        with tempfile.NamedTemporaryFile(
            prefix=f".{TARGET.name}.",
            suffix=".tmp",
            dir=TARGET.parent,
            delete=False,
        ) as temporary:
            temporary_name = temporary.name
        temporary_path = Path(temporary_name)
        metadata = build(temporary_path)
        manifest = load_manifest()
        table_descriptor = manifest.get("table_download") or {}
        if table_descriptor.get("path") != "data/catlog-table.jsonl.gz":
            raise SystemExit("manifest table_download path is not the projection source")
        if table_descriptor.get("sha256") != metadata["source_sha256"]:
            raise SystemExit("manifest table_download hash does not match the projection source")
        expected_descriptor = viewer_descriptor(metadata)

        if args.check:
            if not TARGET.exists():
                raise SystemExit(f"missing viewer index: {TARGET.relative_to(REPOSITORY_ROOT)}")
            if sha256(TARGET) != metadata["viewer_sha256"]:
                raise SystemExit("committed viewer index is not the deterministic projection")
            if manifest.get("viewer_index") != expected_descriptor:
                raise SystemExit("manifest viewer_index metadata does not match the projection")
            outcome = "Viewer index is reproducible"
        else:
            os.replace(temporary_path, TARGET)
            temporary_name = ""
            outcome = f"Wrote {TARGET.relative_to(REPOSITORY_ROOT)}"

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
