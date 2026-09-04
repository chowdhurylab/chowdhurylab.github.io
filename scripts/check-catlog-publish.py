#!/usr/bin/env python3
"""Reject Git LFS pointers and undersized blobs in published CatLog data."""

from __future__ import annotations

import os
import subprocess
import sys
from collections import defaultdict
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = "tools/catlog-static/data"
CANONICAL_PAGE = REPOSITORY_ROOT / "tools/catlog-static/index.html"
USAGE_TRACKER_TAG = (
    '<script src="/assets/js/usage-tracker.js" data-usage-source="catlog"></script>'
)
LFS_POINTER_HEADER = b"version https://git-lfs.github.com/spec/v1"
MINIMUM_BLOB_SIZE = 200
READ_CHUNK_SIZE = 1024 * 1024


def git_environment() -> dict[str, str]:
    environment = os.environ.copy()
    environment["GIT_NO_LAZY_FETCH"] = "1"
    environment["GIT_OPTIONAL_LOCKS"] = "0"
    return environment


def tracked_data_blobs() -> tuple[dict[str, list[str]], list[str]]:
    result = subprocess.run(
        ["git", "ls-files", "--stage", "-z", "--", DATA_PATH],
        cwd=REPOSITORY_ROOT,
        env=git_environment(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", "replace").strip()
        return {}, [f"cannot enumerate the Git index: {detail or 'git ls-files failed'}"]

    paths_by_oid: dict[str, list[str]] = defaultdict(list)
    failures: list[str] = []
    for entry in result.stdout.split(b"\0"):
        if not entry:
            continue
        try:
            metadata, raw_path = entry.split(b"\t", 1)
            _mode, raw_oid, raw_stage = metadata.split()
        except ValueError:
            failures.append(f"unparseable Git index entry: {entry!r}")
            continue
        path = raw_path.decode("utf-8", "surrogateescape")
        stage = raw_stage.decode("ascii")
        if stage != "0":
            failures.append(f"unmerged Git index entry (stage {stage}): {path}")
            continue
        paths_by_oid[raw_oid.decode("ascii")].append(path)

    if not paths_by_oid:
        failures.append(f"no tracked files found under {DATA_PATH}")
    return dict(paths_by_oid), failures


def inspect_git_blobs(paths_by_oid: dict[str, list[str]]) -> list[str]:
    process = subprocess.Popen(
        ["git", "cat-file", "--batch"],
        cwd=REPOSITORY_ROOT,
        env=git_environment(),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert process.stdin is not None
    assert process.stdout is not None
    failures: list[str] = []

    try:
        for oid, paths in sorted(paths_by_oid.items()):
            process.stdin.write(f"{oid}\n".encode("ascii"))
            process.stdin.flush()
            response = process.stdout.readline()
            fields = response.rstrip(b"\n").split()
            if len(fields) == 2 and fields[1] == b"missing":
                failures.extend(f"Git blob unavailable: {path} ({oid})" for path in paths)
                continue
            if len(fields) != 3:
                failures.extend(
                    f"invalid git cat-file response for {path}: {response!r}" for path in paths
                )
                break

            _resolved_oid, object_type, raw_size = fields
            try:
                size = int(raw_size)
            except ValueError:
                failures.extend(
                    f"invalid Git object size for {path}: {raw_size!r}" for path in paths
                )
                break

            prefix = b""
            remaining = size
            while remaining:
                chunk = process.stdout.read(min(READ_CHUNK_SIZE, remaining))
                if not chunk:
                    failures.extend(f"truncated Git blob: {path} ({oid})" for path in paths)
                    remaining = 0
                    break
                if len(prefix) < len(LFS_POINTER_HEADER):
                    needed = len(LFS_POINTER_HEADER) - len(prefix)
                    prefix += chunk[:needed]
                remaining -= len(chunk)
            terminator = process.stdout.read(1)
            if terminator != b"\n":
                failures.extend(f"invalid Git blob framing: {path} ({oid})" for path in paths)
                break

            if object_type != b"blob":
                failures.extend(
                    f"not a Git blob ({object_type.decode('ascii', 'replace')}): {path}"
                    for path in paths
                )
            elif prefix.startswith(LFS_POINTER_HEADER):
                failures.extend(f"git-lfs pointer: {path}" for path in paths)
            elif size < MINIMUM_BLOB_SIZE:
                failures.extend(
                    f"undersized ({size} bytes, minimum {MINIMUM_BLOB_SIZE}): {path}"
                    for path in paths
                )
    finally:
        process.stdin.close()

    stderr = process.stderr.read().decode("utf-8", "replace").strip() if process.stderr else ""
    return_code = process.wait()
    if return_code != 0:
        failures.append(f"git cat-file failed with exit {return_code}: {stderr or 'no detail'}")
    return failures


def inspect_usage_tracker() -> list[str]:
    try:
        page = CANONICAL_PAGE.read_text(encoding="utf-8")
    except OSError as error:
        return [f"cannot read canonical CatLog page: {error}"]

    count = page.count(USAGE_TRACKER_TAG)
    if count != 1:
        return [f"canonical CatLog page has {count} usage tracker tags; expected exactly 1"]
    return []


def main() -> int:
    paths_by_oid, failures = tracked_data_blobs()
    if paths_by_oid:
        failures.extend(inspect_git_blobs(paths_by_oid))
    failures.extend(inspect_usage_tracker())

    if failures:
        print("CatLog publish check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1

    checked = sum(len(paths) for paths in paths_by_oid.values())
    print(f"CatLog publish check passed: {checked} tracked data blobs checked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
