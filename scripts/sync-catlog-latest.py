#!/usr/bin/env python3
"""Build the stable CatLog entry page from the current static snapshot."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tools" / "catlog-static" / "index.html"
TARGET = ROOT / "tools" / "catlog-latest.html"
STATS_TARGET = ROOT / "tools" / "catlog-stats.html"
PUBLIC_PREFIX = "catlog-static/"
ASSET_REFERENCE = re.compile(
    r'(?P<head>\b(?:href|src)=")(?P<path>(?:assets|data)/)'
)
DATASET_NOTES_REFERENCE = re.compile(r'(?P<head>\bhref=")README_FIRST\.txt"')
USAGE_TRACKER_TAG = (
    '<script src="/assets/js/usage-tracker.js" data-usage-source="catlog"></script>'
)


def prepare_canonical(source: str) -> str:
    """Restore the site's tracker after importing a standalone export."""
    tracker_count = source.count(USAGE_TRACKER_TAG)
    marker_counts = (
        source.lower().count("usage-tracker.js"),
        source.lower().count("data-usage-source"),
    )
    if tracker_count == 1 and marker_counts == (1, 1):
        return source
    if tracker_count or any(marker_counts):
        raise RuntimeError("Expected one canonical usage tracker tag, without duplicates")
    if source.count("</body>") != 1:
        raise RuntimeError("Expected one closing body tag for usage tracker insertion")
    return source.replace("</body>", f"{USAGE_TRACKER_TAG}\n</body>")


def build_alias(source: str, *, stats: bool = False) -> str:
    alias, reference_count = ASSET_REFERENCE.subn(
        lambda match: f'{match.group("head")}{PUBLIC_PREFIX}{match.group("path")}',
        source,
    )
    alias, notes_count = DATASET_NOTES_REFERENCE.subn(
        f'\\g<head>{PUBLIC_PREFIX}README_FIRST.txt"',
        alias,
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
    if notes_count != 2:
        raise RuntimeError(
            f"Expected two dataset-notes references (Download and Guide), found {notes_count}"
        )
    if base_count != 1:
        raise RuntimeError(f"Expected one catalog base attribute, found {base_count}")
    if ASSET_REFERENCE.search(alias):
        raise RuntimeError("Alias still contains an unprefixed static asset reference")
    if DATASET_NOTES_REFERENCE.search(alias):
        raise RuntimeError("Alias still contains an unprefixed dataset-notes reference")
    alias = alias.replace('href="#browse"', 'href="catlog-latest.html"')
    alias = alias.replace('href="#guide"', 'href="catlog-latest.html#guide"')
    alias = alias.replace('href="#stats"', 'href="catlog-stats.html"')
    if stats:
        alias = alias.replace('<title>CatLog | Enzyme Kinetics Catalog</title>', '<title>Stats | CatLog</title>')
        alias = alias.replace('<body>', '<body class="stats-open">')
        alias = alias.replace('<main id="catalogView">', '<main id="catalogView" hidden>')
        alias = alias.replace('class="stats-view" hidden', 'class="stats-view"')
        alias = alias.replace('id="browseButton" class="nav-tab active" href="catlog-latest.html" aria-current="page"',
                              'id="browseButton" class="nav-tab" href="catlog-latest.html"')
        alias = alias.replace('id="statsButton" class="nav-tab"', 'id="statsButton" class="nav-tab active" aria-current="page"')
        alias = alias.replace('content="CatLog | Enzyme Kinetics Catalog"', 'content="Stats | CatLog"')
        alias = alias.replace('https://chowdhurylab.github.io/tools/catlog-static/',
                              'https://chowdhurylab.github.io/tools/catlog-stats.html')
    return alias


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify the canonical tracker and synchronized catlog-latest.html",
    )
    args = parser.parse_args()

    source = SOURCE.read_text(encoding="utf-8")
    canonical = prepare_canonical(source)
    pages = {TARGET: build_alias(canonical), STATS_TARGET: build_alias(canonical, stats=True)}
    if args.check:
        if canonical != source:
            raise SystemExit("tools/catlog-static/index.html is missing its usage tracker")
        for target, expected in pages.items():
            if not target.exists() or target.read_text(encoding="utf-8") != expected:
                raise SystemExit(f"{target.relative_to(ROOT)} is out of date")
        print("CatLog Browse and Stats entry pages are synchronized")
        return 0

    if canonical != source:
        SOURCE.write_text(canonical, encoding="utf-8")
        print(f"Wrote {SOURCE.relative_to(ROOT)}")
    for target, expected in pages.items():
        target.write_text(expected, encoding="utf-8")
        print(f"Wrote {target.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
