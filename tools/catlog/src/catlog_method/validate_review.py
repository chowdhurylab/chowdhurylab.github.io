from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


ALLOWED_STATUSES = {
    "verified",
    "corrected",
    "rejected",
    "manual_review_required",
}

ALLOWED_STRENGTHS = {
    "strong",
    "medium",
    "weak",
    "contradictory",
}

REQUIRED_VERDICT_FIELDS = {
    "measurement_key",
    "review_key",
    "ec_number",
    "verification_status",
    "review_loop_count",
    "review_summary",
    "review_understanding",
    "critique_rationale",
    "audit_history",
    "evidence_used",
    "verification_notes",
}

REQUIRED_EVIDENCE_FIELDS = {
    "evidence_id",
    "evidence_kind",
    "finding",
    "strength",
}


class ValidationError(Exception):
    """Raised when a CatLog review verdict fails the local contract."""


def _load_json(path: Path) -> Any:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except json.JSONDecodeError as exc:
        raise ValidationError(f"{path} is not valid JSON: {exc}") from exc


def _require_string(item: dict[str, Any], field: str, index: int) -> None:
    value = item.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"item {index}: {field} must be a non-empty string")


def _validate_evidence(evidence: Any, index: int, status: str) -> None:
    if not isinstance(evidence, list) or not evidence:
        raise ValidationError(f"item {index}: evidence_used must be a non-empty list")

    has_strong = False
    for evidence_index, entry in enumerate(evidence):
        if not isinstance(entry, dict):
            raise ValidationError(
                f"item {index}, evidence {evidence_index}: entry must be an object"
            )
        missing = REQUIRED_EVIDENCE_FIELDS - set(entry)
        if missing:
            raise ValidationError(
                f"item {index}, evidence {evidence_index}: missing {sorted(missing)}"
            )
        for field in ("evidence_id", "evidence_kind", "finding"):
            value = entry.get(field)
            if not isinstance(value, str) or not value.strip():
                raise ValidationError(
                    f"item {index}, evidence {evidence_index}: {field} must be text"
                )
        strength = entry.get("strength")
        if strength not in ALLOWED_STRENGTHS:
            raise ValidationError(
                f"item {index}, evidence {evidence_index}: invalid strength {strength!r}"
            )
        has_strong = has_strong or strength == "strong"

    if status in {"verified", "corrected"} and not has_strong:
        raise ValidationError(
            f"item {index}: {status} verdicts need at least one strong evidence item"
        )


def validate_verdicts(payload: Any) -> int:
    if not isinstance(payload, list):
        raise ValidationError("top-level verdict payload must be a JSON array")
    if not payload:
        raise ValidationError("verdict payload is empty")

    for index, item in enumerate(payload):
        if not isinstance(item, dict):
            raise ValidationError(f"item {index}: verdict must be an object")

        missing = REQUIRED_VERDICT_FIELDS - set(item)
        if missing:
            raise ValidationError(f"item {index}: missing {sorted(missing)}")

        for field in (
            "measurement_key",
            "review_key",
            "ec_number",
            "review_summary",
            "review_understanding",
            "critique_rationale",
            "verification_notes",
        ):
            _require_string(item, field, index)

        if "record_id" in item:
            _require_string(item, "record_id", index)

        status = item.get("verification_status")
        if status not in ALLOWED_STATUSES:
            raise ValidationError(
                f"item {index}: invalid verification_status {status!r}"
            )

        loop_count = item.get("review_loop_count")
        if not isinstance(loop_count, int) or loop_count < 3:
            raise ValidationError(
                f"item {index}: review_loop_count must be an integer >= 3"
            )

        audit_history = item.get("audit_history")
        if not isinstance(audit_history, list) or len(audit_history) < 3:
            raise ValidationError(
                f"item {index}: audit_history must include at least three entries"
            )
        for audit_index, entry in enumerate(audit_history):
            if not isinstance(entry, str) or not entry.strip():
                raise ValidationError(
                    f"item {index}, audit {audit_index}: entry must be text"
                )

        _validate_evidence(item.get("evidence_used"), index, status)

    return len(payload)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate a CatLog review verdict JSON file."
    )
    parser.add_argument("verdict_json", type=Path)
    parser.add_argument(
        "--schema",
        type=Path,
        help=(
            "Optional schema path. The validator loads it to confirm it is present "
            "and valid JSON, then applies the built-in CatLog review checks."
        ),
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        if args.schema is not None:
            _load_json(args.schema)
        count = validate_verdicts(_load_json(args.verdict_json))
    except ValidationError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1

    print(f"PASS: validated {count} review verdict(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
