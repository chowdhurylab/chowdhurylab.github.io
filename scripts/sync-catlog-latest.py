#!/usr/bin/env python3
"""Build the stable CatLog entry page from the current static snapshot."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tools" / "catlog-static" / "index.html"
TARGET = ROOT / "tools" / "catlog-latest.html"
PUBLIC_PREFIX = "catlog-static/"
ASSET_REFERENCE = re.compile(r'(?P<head>\b(?:href|src)=")(?P<path>(?:assets|data)/)')


def build_alias(source: str) -> str:
    alias, reference_count = ASSET_REFERENCE.subn(
        lambda match: f'{match.group("head")}{PUBLIC_PREFIX}{match.group("path")}',
        source,
    )
    alias, base_count = re.subn(
        r'data-catalog-base="\."',
        f'data-catalog-base="{PUBLIC_PREFIX}"',
        alias,
    )
    if reference_count < 5:
        raise RuntimeError(
            f"Expected at least five static asset references, found {reference_count}"
        )
    if base_count != 1:
        raise RuntimeError(f"Expected one catalog base attribute, found {base_count}")
    if ASSET_REFERENCE.search(alias):
        raise RuntimeError("Alias still contains an unprefixed static asset reference")
    return alias


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail if catlog-latest.html is not synchronized",
    )
    args = parser.parse_args()

    expected = build_alias(SOURCE.read_text(encoding="utf-8"))
    current = TARGET.read_text(encoding="utf-8") if TARGET.exists() else None
    if args.check:
        if current != expected:
            raise SystemExit("tools/catlog-latest.html is out of date")
        print("tools/catlog-latest.html is synchronized")
        return 0

    TARGET.write_text(expected, encoding="utf-8")
    print(f"Wrote {TARGET.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
