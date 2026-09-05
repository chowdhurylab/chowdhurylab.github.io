#!/usr/bin/env python3
"""Reject Git LFS pointers and undersized blobs in published CatLog data."""

from __future__ import annotations

import os
import hashlib
import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = "tools/catlog-static/data"
CANONICAL_PAGE = REPOSITORY_ROOT / "tools/catlog-static/index.html"
STABLE_ALIAS_SYNC = REPOSITORY_ROOT / "scripts/sync-catlog-latest.py"
USAGE_TRACKER_TAG = (
    '<script src="/assets/js/usage-tracker.js" data-usage-source="catlog"></script>'
)
LFS_POINTER_HEADER = b"version https://git-lfs.github.com/spec/v1"
MINIMUM_BLOB_SIZE = 200
READ_CHUNK_SIZE = 1024 * 1024
MANIFEST_PREFIX = "window.CATLOG_STATIC_MANIFEST = "
IMMUTABLE_PATH = re.compile(
    r"data/(?:details-\d+|records-\d+)\.([0-9a-f]{12})\.js$"
    r"|data/(?:catlog-table|catlog-enriched|catlog-viewer-index)\.([0-9a-f]{12})\.jsonl\.gz$"
)
SHARD_GENERATION = re.compile(
    rb'window\.CATLOG_DETAIL_SHARD_GENERATIONS\[document\.currentScript\.dataset\.catlogShard\]\s*=\s*"([0-9a-f]{64})";'
)


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


def inspect_git_blobs(
    paths_by_oid: dict[str, list[str]],
    metadata: dict[str, dict] | None = None,
) -> list[str]:
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
            digest = hashlib.sha256()
            remaining = size
            while remaining:
                chunk = process.stdout.read(min(READ_CHUNK_SIZE, remaining))
                if not chunk:
                    failures.extend(f"truncated Git blob: {path} ({oid})" for path in paths)
                    remaining = 0
                    break
                digest.update(chunk)
                if len(prefix) < 4096:
                    needed = 4096 - len(prefix)
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
            if metadata is not None and object_type == b"blob":
                for path in paths:
                    metadata[path] = {"sha256": digest.hexdigest(), "size_bytes": size, "prefix": prefix}
    finally:
        process.stdin.close()

    stderr = process.stderr.read().decode("utf-8", "replace").strip() if process.stderr else ""
    return_code = process.wait()
    if return_code != 0:
        failures.append(f"git cat-file failed with exit {return_code}: {stderr or 'no detail'}")
    return failures


def load_staged_manifest() -> dict:
    result = subprocess.run(
        ["git", "show", f":{DATA_PATH}/manifest.js"],
        cwd=REPOSITORY_ROOT,
        env=git_environment(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode:
        raise ValueError("current CatLog manifest is not available in the Git index")
    if len(result.stdout) > READ_CHUNK_SIZE:
        raise ValueError("current CatLog manifest exceeds the expected metadata bound")
    first_line = result.stdout.decode("utf-8").splitlines()[0]
    if not first_line.startswith(MANIFEST_PREFIX) or not first_line.endswith(";"):
        raise ValueError("current CatLog manifest wrapper is invalid")
    manifest = json.loads(first_line[len(MANIFEST_PREFIX):-1])
    if not isinstance(manifest, dict):
        raise ValueError("current CatLog manifest is not an object")
    return manifest


def inspect_manifest_data(manifest: dict, metadata: dict[str, dict]) -> list[str]:
    """Bind the current manifest to exact staged bytes, not working-tree files.

    Unreferenced files may be the previous public generation, retained through
    one deployment for cached manifests. The stable human-review ledger and
    manifest itself are metadata, not immutable kinetic data assets.
    """
    failures: list[str] = []
    source_sha = manifest.get("source_sha256")
    if not isinstance(source_sha, str) or not re.fullmatch(r"[0-9a-f]{64}", source_sha):
        failures.append("manifest source_sha256 is missing or invalid")
    references: list[tuple[str, dict | None, str]] = []
    for field in ("detail_shards", "record_chunks"):
        paths = manifest.get(field)
        if not isinstance(paths, list) or any(not isinstance(path, str) for path in paths):
            failures.append(f"manifest {field} must be a list of paths")
            continue
        references.extend((path, None, field) for path in paths)
    for field in ("table_download", "enriched_download", "viewer_index"):
        descriptor = manifest.get(field)
        if not isinstance(descriptor, dict) or not isinstance(descriptor.get("path"), str):
            failures.append(f"manifest {field} is missing its data descriptor")
            continue
        references.append((descriptor["path"], descriptor, field))
    path_stems = {
        "detail_shards": r"details-\d+",
        "record_chunks": r"records-\d+",
        "table_download": "catlog-table",
        "enriched_download": "catlog-enriched",
        "viewer_index": "catlog-viewer-index",
    }
    for path, descriptor, field in references:
        match = IMMUTABLE_PATH.fullmatch(path)
        if not match:
            failures.append(f"current data path is not content-addressed: {path}")
            continue
        extension = r"js" if field in ("detail_shards", "record_chunks") else r"jsonl\.gz"
        if not re.fullmatch(rf"data/{path_stems[field]}\.[0-9a-f]{{12}}\.{extension}", path):
            failures.append(f"manifest {field} names the wrong data asset type: {path}")
            continue
        item = metadata.get(f"tools/catlog-static/{path}")
        if item is None:
            failures.append(f"manifest data file is not stage-0 tracked: {path}")
            continue
        suffix = next(value for value in match.groups() if value is not None)
        if item["sha256"][:12] != suffix:
            failures.append(f"data filename hash differs from staged bytes: {path}")
        if descriptor is not None:
            if descriptor.get("sha256") != item["sha256"]:
                failures.append(f"manifest descriptor SHA-256 differs from staged bytes: {path}")
            if descriptor.get("size_bytes") != item["size_bytes"]:
                failures.append(f"manifest descriptor size differs from staged bytes: {path}")
        if field == "detail_shards":
            stamp = SHARD_GENERATION.search(item["prefix"])
            if stamp is None or stamp.group(1).decode("ascii") != source_sha:
                failures.append(f"detail shard source generation differs from manifest: {path}")
    viewer = manifest.get("viewer_index") or {}
    table = manifest.get("table_download") or {}
    if isinstance(viewer, dict) and isinstance(table, dict):
        if viewer.get("source_table_sha256") != table.get("sha256"):
            failures.append("viewer index source-table hash differs from table descriptor")
        if viewer.get("source_table_size_bytes") != table.get("size_bytes"):
            failures.append("viewer index source-table size differs from table descriptor")
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


def inspect_stable_alias() -> list[str]:
    result = subprocess.run(
        [sys.executable, str(STABLE_ALIAS_SYNC), "--check"],
        cwd=REPOSITORY_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )
    if result.returncode == 0:
        return []
    detail = result.stdout.strip() or "stable alias check failed"
    return [detail]


def main() -> int:
    paths_by_oid, failures = tracked_data_blobs()
    metadata: dict[str, dict] = {}
    if paths_by_oid:
        failures.extend(inspect_git_blobs(paths_by_oid, metadata))
    try:
        failures.extend(inspect_manifest_data(load_staged_manifest(), metadata))
    except (ValueError, IndexError, UnicodeError) as error:
        failures.append(str(error))
    failures.extend(inspect_usage_tracker())
    failures.extend(inspect_stable_alias())

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
