#!/usr/bin/env python3
"""Build the deterministic, browser-only CatLog record index."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
CATALOG_ROOT = REPOSITORY_ROOT / "tools" / "catlog-static"
DATA_ROOT = CATALOG_ROOT / "data"
MANIFEST = DATA_ROOT / "manifest.js"
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


def build(source_path: Path, target: Path) -> dict[str, object]:
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
            with gzip.open(source_path, "rb") as source:
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
    return {
        "path": metadata["viewer_path"],
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
        metadata = build(source_path, temporary_path)
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
