#!/usr/bin/env python3
"""Count saved fields in the frozen public follow-up cohort, not review blockers."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import importlib.util
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "tools/catlog-static"
FIELD_NAMES = ("kinetic_value", "paper_id", "sequence", "smiles")


def summarize(rows):
    statuses = Counter()
    coverage = dict.fromkeys(
        ("total", "with_literature_id", "with_sequence", "with_smiles", "with_kinetic_value"), 0
    )
    for row in rows:
        status = row.get("verification_status")
        if not isinstance(status, str):
            raise ValueError("Missing review status in public record")
        statuses[status] += 1
        if status != "manual_review_required":
            continue
        coverage["total"] += 1
        coverage["with_literature_id"] += bool(row.get("supporting_pmids") or row.get("supporting_dois"))
        coverage["with_sequence"] += bool(row.get("sequence"))
        coverage["with_smiles"] += bool(row.get("smiles"))
        coverage["with_kinetic_value"] += any(row.get(key) is not None for key in ("kcat", "km", "ki", "kcat_over_km"))
    return coverage, dict(statuses)


def build(manifest, download):
    with download.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    if digest != manifest["enriched_download"]["sha256"]:
        raise ValueError("Frozen download hash does not match the manifest")
    with gzip.open(download, "rb") as handle:
        coverage, statuses = summarize(json.loads(line) for line in handle if line.strip())
    expected = {item["label"]: item["count"] for item in manifest["summary"]["distributions"]["verification_status"]}
    if statuses != expected or sum(statuses.values()) != manifest["total_rows"]:
        raise ValueError("Public download statuses do not match the snapshot")
    return {
        "source_sha256": manifest["source_sha256"],
        "download_sha256": digest,
        "cohort": "manual_review_required",
        "meaning": "Saved field presence; not completed checks or reasons for follow-up",
        **coverage,
    }


def build_review_details(manifest, download):
    with download.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    if digest != manifest["enriched_download"]["sha256"]:
        raise ValueError("Frozen download hash does not match the manifest")
    groups = {status: {"total": 0, "with_literature_id": 0, "with_sequence": 0,
                       "with_smiles": 0, "with_kinetic_value": 0,
                       "material": dict.fromkeys(("paper_excerpt", "source_note", "paper_id", "database_record"), 0),
                       "field_combinations": Counter()}
              for status in ("manual_review_required", "unverified", "mathematically_inferred")}
    statuses = Counter()
    with gzip.open(download, "rb") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            status = row.get("verification_status")
            statuses[status] += 1
            if status not in groups:
                continue
            group = groups[status]
            group["total"] += 1
            group["with_literature_id"] += bool(row.get("supporting_pmids") or row.get("supporting_dois"))
            group["with_sequence"] += bool(row.get("sequence"))
            group["with_smiles"] += bool(row.get("smiles"))
            group["with_kinetic_value"] += any(row.get(key) is not None for key in ("kcat", "km", "ki", "kcat_over_km"))
            present = (any(row.get(key) is not None for key in ("kcat", "km", "ki", "kcat_over_km")),
                       bool(row.get("supporting_pmids") or row.get("supporting_dois")),
                       bool(row.get("sequence")), bool(row.get("smiles")))
            missing = tuple(name for name, included in zip(FIELD_NAMES, present) if not included)
            group["field_combinations"][missing] += 1
            material = ("paper_excerpt" if row.get("has_proof_excerpt") else
                        "source_note" if row.get("proof_kind") == "source_note" else
                        "paper_id" if row.get("has_literature_id") else "database_record")
            group["material"][material] += 1
    expected = {item["label"]: item["count"] for item in manifest["summary"]["distributions"]["verification_status"]}
    if dict(statuses) != expected or sum(statuses.values()) != manifest["total_rows"]:
        raise ValueError("Public download statuses do not match the snapshot")
    for group in groups.values():
        group["field_combinations"] = [
            {"missing": list(missing), "count": count}
            for missing, count in sorted(group["field_combinations"].items(), key=lambda item: (len(item[0]), item[0]))
        ]
    return {"source_sha256": manifest["source_sha256"], "download_sha256": digest,
            "meaning": "Fields and attached material by status, not reasons for review decisions",
            "groups": groups}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="Write a new immutable manifest and update its page reference")
    parser.add_argument("--details-report", action="store_true", help="Print hash-bound follow-up and unverified counts without changing files")
    parser.add_argument("--write-details", action="store_true", help="Recount review-group fields from the frozen public download and publish an immutable manifest")
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location("viewer_builder", ROOT / "scripts/build-catlog-viewer-index.py")
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    old_path = builder.active_manifest_path()
    manifest = builder.load_manifest(old_path)
    download = (CATALOG / manifest["enriched_download"]["path"]).resolve()
    if not download.is_relative_to((CATALOG / "data").resolve()) or download.suffix != ".gz":
        raise ValueError("Expected a public compressed download under this site")
    if args.details_report or args.write_details:
        result = build_review_details(manifest, download)
        saved = manifest["summary"].get("review_details")
        if saved is not None and saved != result and not args.write_details:
            raise ValueError("Published review details differ from the frozen download")
        print(json.dumps(result, indent=2))
        if not args.write_details:
            return
        manifest["summary"]["review_details"] = result
    else:
        result = build(manifest, download)
        saved = manifest["summary"].get("followup_coverage")
        if saved is not None and saved != result and not args.write:
            raise ValueError("Published follow-up summary differs from the frozen download")
        print(json.dumps(result, indent=2))
        if args.write:
            manifest["summary"]["followup_coverage"] = result
    if args.write or args.write_details:
        new_path = builder.write_immutable_manifest(manifest, old_path)
        page_path = CATALOG / "index.html"
        page = page_path.read_text()
        old_ref = str(old_path.relative_to(CATALOG))
        if page.count(old_ref) != 1:
            raise ValueError("Expected exactly one current manifest reference")
        page_path.write_text(page.replace(old_ref, str(new_path.relative_to(CATALOG))))


if __name__ == "__main__":
    main()
