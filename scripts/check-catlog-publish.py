#!/usr/bin/env python3
"""Reject Git LFS pointers and undersized blobs in published CatLog data."""

from __future__ import annotations

import codecs
import hashlib
import json
import os
import re
import subprocess
import sys
import zlib
from collections import defaultdict
from html.parser import HTMLParser
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = "tools/catlog-static/data"
CANONICAL_PAGE = REPOSITORY_ROOT / "tools/catlog-static/index.html"
CANONICAL_PAGE_INDEX_PATH = "tools/catlog-static/index.html"
STABLE_ALIAS_SYNC = REPOSITORY_ROOT / "scripts/sync-catlog-latest.py"
USAGE_TRACKER_TAG = (
    '<script src="/assets/js/usage-tracker.js" data-usage-source="catlog"></script>'
)
LFS_POINTER_HEADER = b"version https://git-lfs.github.com/spec/v1"
MINIMUM_BLOB_SIZE = 200
READ_CHUNK_SIZE = 1024 * 1024
MAXIMUM_PAGE_SIZE = 2 * READ_CHUNK_SIZE
MAXIMUM_DETAIL_LINE_CHARS = 16 * READ_CHUNK_SIZE
MAXIMUM_DETAIL_DECOMPRESSED_BYTES = 32 * READ_CHUNK_SIZE
MANIFEST_PREFIX = "window.CATLOG_STATIC_MANIFEST = "
MANIFEST_SCRIPT_SRC = re.compile(r"data/manifest\.([0-9a-f]{12})\.js$")
DETAIL_MANIFEST_PATH = re.compile(
    r"data/details-([0-9]{3,9})\.([0-9a-f]{12})\.jsonl\.gz$"
)
IMMUTABLE_PATH = re.compile(
    r"data/details-[0-9]{3,9}\.([0-9a-f]{12})\.jsonl\.gz$"
    r"|data/records-\d+\.([0-9a-f]{12})\.js$"
    r"|data/(?:catlog-table|catlog-enriched|catlog-viewer-index)\.([0-9a-f]{12})\.jsonl\.gz$"
)
DETAIL_SHARD_PATH = re.compile(
    r"tools/catlog-static/data/details-[0-9]{3,9}\.[0-9a-f]{12}\.jsonl\.gz$"
)
SHA256 = re.compile(r"[0-9a-f]{64}")
DETAIL_HEADER_FIELDS = {"kind", "schema_version", "source_sha256", "record_count"}


def _reject_nonstandard_json_constant(value: str) -> None:
    raise ValueError(f"non-standard JSON constant: {value}")


class _ScriptSourceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.sources: list[str] = []
        self.has_duplicate_source = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "script":
            return
        sources = [value for name, value in attrs if name.lower() == "src"]
        if len(sources) > 1:
            self.has_duplicate_source = True
        elif sources and sources[0] is not None:
            self.sources.append(sources[0])


class DetailShardStreamInspector:
    """Validate one gzip JSONL detail shard without retaining its row payloads."""

    def __init__(self) -> None:
        self._decompressor = zlib.decompressobj(16 + zlib.MAX_WBITS)
        self._decoder = codecs.getincrementaldecoder("utf-8")("strict")
        self._text_buffer = ""
        self._failed = False
        self.header: dict | None = None
        self.record_keys: set[str] = set()
        self.record_count = 0
        self.decompressed_bytes = 0
        self.failures: list[str] = []

    def _fail(self, detail: str) -> None:
        if detail not in self.failures:
            self.failures.append(detail)
        self._failed = True

    def _consume_line(self, line: str) -> None:
        if self._failed:
            return
        if line.endswith("\r"):
            line = line[:-1]
        if not line:
            self._fail("detail shard contains a blank JSONL line")
            return
        if len(line) > MAXIMUM_DETAIL_LINE_CHARS:
            self._fail("detail shard JSONL line exceeds the safety bound")
            return
        try:
            payload = json.loads(line, parse_constant=_reject_nonstandard_json_constant)
        except (json.JSONDecodeError, ValueError):
            self._fail("detail shard contains invalid JSONL")
            return

        if self.header is None:
            if not isinstance(payload, dict) or set(payload) != DETAIL_HEADER_FIELDS:
                self._fail("detail shard header has the wrong shape")
                return
            if payload.get("kind") != "catlog_detail_shard":
                self._fail("detail shard header kind is invalid")
                return
            if type(payload.get("schema_version")) is not int or payload["schema_version"] != 1:
                self._fail("detail shard header schema_version is invalid")
                return
            source_sha = payload.get("source_sha256")
            if not isinstance(source_sha, str) or SHA256.fullmatch(source_sha) is None:
                self._fail("detail shard header source_sha256 is invalid")
                return
            count = payload.get("record_count")
            if type(count) is not int or count < 0:
                self._fail("detail shard header record_count is invalid")
                return
            self.header = payload
            return

        if (
            not isinstance(payload, list)
            or len(payload) != 2
            or not isinstance(payload[0], str)
            or not payload[0]
            or not isinstance(payload[1], dict)
        ):
            self._fail("detail shard row is not a [record_key, detail_object] pair")
            return
        record_key = payload[0]
        if record_key in self.record_keys:
            self._fail(f"detail shard repeats record_key {record_key!r}")
            return
        self.record_keys.add(record_key)
        self.record_count += 1

    def _consume_text(self, text: str) -> None:
        if self._failed:
            return
        self._text_buffer += text
        if len(self._text_buffer) > MAXIMUM_DETAIL_LINE_CHARS and "\n" not in self._text_buffer:
            self._fail("detail shard JSONL line exceeds the safety bound")
            return
        while "\n" in self._text_buffer and not self._failed:
            line, self._text_buffer = self._text_buffer.split("\n", 1)
            self._consume_line(line)
            if len(self._text_buffer) > MAXIMUM_DETAIL_LINE_CHARS and "\n" not in self._text_buffer:
                self._fail("detail shard JSONL line exceeds the safety bound")

    def feed(self, compressed: bytes) -> None:
        if self._failed:
            return
        if self._decompressor.eof and compressed:
            self._fail("detail shard gzip has trailing data or multiple members")
            return
        pending = compressed
        while not self._failed:
            try:
                decoded = self._decompressor.decompress(pending, READ_CHUNK_SIZE)
            except zlib.error:
                self._fail("detail shard is not a valid gzip stream")
                return
            pending = self._decompressor.unconsumed_tail
            self.decompressed_bytes += len(decoded)
            if self.decompressed_bytes > MAXIMUM_DETAIL_DECOMPRESSED_BYTES:
                self._fail("detail shard decompressed payload exceeds the safety bound")
                return
            try:
                self._consume_text(self._decoder.decode(decoded))
            except UnicodeDecodeError:
                self._fail("detail shard payload is not valid UTF-8")
                return
            if self._decompressor.unused_data:
                self._fail("detail shard gzip has trailing data or multiple members")
            elif self._decompressor.eof and pending:
                self._fail("detail shard gzip has trailing data or multiple members")
            if pending or len(decoded) == READ_CHUNK_SIZE:
                continue
            break

    def finish(self) -> dict:
        if not self._failed:
            try:
                decoded = self._decompressor.flush()
                self.decompressed_bytes += len(decoded)
                if self.decompressed_bytes > MAXIMUM_DETAIL_DECOMPRESSED_BYTES:
                    self._fail("detail shard decompressed payload exceeds the safety bound")
                    decoded = b""
                self._consume_text(self._decoder.decode(decoded, final=True))
            except zlib.error:
                self._fail("detail shard is not a valid gzip stream")
            except UnicodeDecodeError:
                self._fail("detail shard payload is not valid UTF-8")
        if not self._failed and not self._decompressor.eof:
            self._fail("detail shard gzip stream is truncated")
        if not self._failed and self._text_buffer:
            self._consume_line(self._text_buffer)
            self._text_buffer = ""
        if not self._failed and self.header is None:
            self._fail("detail shard header is missing")
        if (
            not self._failed
            and self.header is not None
            and self.record_count != self.header["record_count"]
        ):
            self._fail("detail shard record_count does not match its JSONL rows")
        return {
            "detail_header": self.header,
            "detail_record_count": self.record_count,
            "detail_record_keys": frozenset(self.record_keys),
            "detail_failures": tuple(self.failures),
        }


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
            detail_inspector = (
                DetailShardStreamInspector()
                if any(DETAIL_SHARD_PATH.fullmatch(path) for path in paths)
                else None
            )
            remaining = size
            while remaining:
                chunk = process.stdout.read(min(READ_CHUNK_SIZE, remaining))
                if not chunk:
                    failures.extend(f"truncated Git blob: {path} ({oid})" for path in paths)
                    remaining = 0
                    break
                digest.update(chunk)
                if detail_inspector is not None:
                    detail_inspector.feed(chunk)
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
            detail_metadata = detail_inspector.finish() if detail_inspector is not None else {}
            for detail_failure in detail_metadata.get("detail_failures", ()):
                failures.extend(
                    f"{detail_failure}: {path}"
                    for path in paths
                    if DETAIL_SHARD_PATH.fullmatch(path)
                )
            if metadata is not None and object_type == b"blob":
                for path in paths:
                    metadata[path] = {"sha256": digest.hexdigest(), "size_bytes": size, "prefix": prefix}
                    if DETAIL_SHARD_PATH.fullmatch(path):
                        metadata[path].update(detail_metadata)
    finally:
        process.stdin.close()

    stderr = process.stderr.read().decode("utf-8", "replace").strip() if process.stderr else ""
    return_code = process.wait()
    if return_code != 0:
        failures.append(f"git cat-file failed with exit {return_code}: {stderr or 'no detail'}")
    return failures


def _read_staged_file(path: str, *, maximum_size: int, label: str) -> bytes:
    process = subprocess.Popen(
        ["git", "show", f":{path}"],
        cwd=REPOSITORY_ROOT,
        env=git_environment(),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    assert process.stdout is not None
    try:
        content = process.stdout.read(maximum_size + 1)
        if len(content) > maximum_size:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            raise ValueError(f"{label} exceeds the expected size bound")
        return_code = process.wait()
    finally:
        process.stdout.close()
    if return_code:
        raise ValueError(f"{label} is not available at stage 0 in the Git index")
    return content


def resolve_staged_manifest_path(page_bytes: bytes) -> str:
    try:
        page = page_bytes.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValueError("staged canonical CatLog page is not valid UTF-8") from error
    parser = _ScriptSourceParser()
    parser.feed(page)
    if parser.has_duplicate_source:
        raise ValueError("staged canonical CatLog page contains a script with duplicate src attributes")
    candidates = [source for source in parser.sources if "manifest" in source.lower()]
    if len(candidates) != 1:
        raise ValueError("staged canonical CatLog page must reference exactly one manifest script")
    source = candidates[0]
    if MANIFEST_SCRIPT_SRC.fullmatch(source) is None:
        raise ValueError(f"staged canonical CatLog page has an unexpected manifest reference: {source}")
    return f"tools/catlog-static/{source}"


def load_staged_manifest() -> tuple[dict, str]:
    page_bytes = _read_staged_file(
        CANONICAL_PAGE_INDEX_PATH,
        maximum_size=MAXIMUM_PAGE_SIZE,
        label="canonical CatLog page",
    )
    manifest_path = resolve_staged_manifest_path(page_bytes)
    result = _read_staged_file(
        manifest_path,
        maximum_size=READ_CHUNK_SIZE,
        label="current CatLog manifest",
    )
    suffix = MANIFEST_SCRIPT_SRC.fullmatch(
        manifest_path.removeprefix("tools/catlog-static/")
    )
    assert suffix is not None
    digest = hashlib.sha256(result).hexdigest()
    if digest[:12] != suffix.group(1):
        raise ValueError("manifest filename hash differs from staged bytes")
    first_line = result.decode("utf-8").splitlines()[0]
    if not first_line.startswith(MANIFEST_PREFIX) or not first_line.endswith(";"):
        raise ValueError("current CatLog manifest wrapper is invalid")
    manifest = json.loads(first_line[len(MANIFEST_PREFIX):-1])
    if not isinstance(manifest, dict):
        raise ValueError("current CatLog manifest is not an object")
    return manifest, manifest_path


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
    references: list[tuple[str, dict | None, str, int | None]] = []
    for field in ("detail_shards", "record_chunks"):
        paths = manifest.get(field)
        if not isinstance(paths, list) or any(not isinstance(path, str) for path in paths):
            failures.append(f"manifest {field} must be a list of paths")
            continue
        references.extend(
            (path, None, field, position if field == "detail_shards" else None)
            for position, path in enumerate(paths)
        )
    for field in ("table_download", "enriched_download", "viewer_index"):
        descriptor = manifest.get(field)
        if not isinstance(descriptor, dict) or not isinstance(descriptor.get("path"), str):
            failures.append(f"manifest {field} is missing its data descriptor")
            continue
        references.append((descriptor["path"], descriptor, field, None))
    path_stems = {
        "detail_shards": r"details-[0-9]{3,9}",
        "record_chunks": r"records-\d+",
        "table_download": "catlog-table",
        "enriched_download": "catlog-enriched",
        "viewer_index": "catlog-viewer-index",
    }
    total_rows = manifest.get("total_rows")
    total_rows_valid = type(total_rows) is int and total_rows >= 0
    if not total_rows_valid:
        failures.append("manifest total_rows is missing or invalid")
    details_per_shard = manifest.get("details_per_shard")
    details_per_shard_valid = type(details_per_shard) is int and details_per_shard > 0
    if not details_per_shard_valid:
        failures.append("manifest details_per_shard is missing or invalid")
    detail_paths = manifest.get("detail_shards")
    detail_paths_valid = isinstance(detail_paths, list) and all(
        isinstance(path, str) for path in detail_paths
    )
    if total_rows_valid and details_per_shard_valid and detail_paths_valid:
        expected_shard_count = (total_rows + details_per_shard - 1) // details_per_shard
        if len(detail_paths) != expected_shard_count:
            failures.append("manifest detail_shards count does not match total_rows/details_per_shard")
        for position, path in enumerate(detail_paths):
            detail_match = DETAIL_MANIFEST_PATH.fullmatch(path)
            if detail_match is not None and int(detail_match.group(1)) != position:
                failures.append(f"detail shard filename index differs from manifest position: {path}")
    active_record_keys: set[str] = set()
    active_detail_count = 0
    for path, descriptor, field, position in references:
        match = IMMUTABLE_PATH.fullmatch(path)
        if not match:
            failures.append(f"current data path is not content-addressed: {path}")
            continue
        extension = r"js" if field == "record_chunks" else r"jsonl\.gz"
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
            header = item.get("detail_header")
            if not isinstance(header, dict) or header.get("source_sha256") != source_sha:
                failures.append(f"detail shard source generation differs from manifest: {path}")
                continue
            record_keys = item.get("detail_record_keys")
            record_count = item.get("detail_record_count")
            if not isinstance(record_keys, frozenset) or record_count != header.get("record_count"):
                failures.append(f"detail shard decoded metadata is incomplete: {path}")
                continue
            if total_rows_valid and details_per_shard_valid and position is not None:
                remaining = max(0, total_rows - position * details_per_shard)
                expected_record_count = min(details_per_shard, remaining)
                if record_count != expected_record_count:
                    failures.append(
                        "detail shard record_count does not match its manifest position: "
                        f"{path} (expected {expected_record_count}, found {record_count})"
                    )
            if active_record_keys.intersection(record_keys):
                failures.append(f"detail shard record keys overlap another active shard: {path}")
            active_record_keys.update(record_keys)
            active_detail_count += record_count
    if total_rows_valid and active_detail_count != total_rows:
        failures.append("active detail shard record counts do not match manifest total_rows")
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
    failures: list[str] = []
    manifest: dict | None = None
    try:
        manifest, _manifest_path = load_staged_manifest()
    except (ValueError, IndexError, UnicodeError, json.JSONDecodeError) as error:
        failures.append(str(error))

    paths_by_oid, data_failures = tracked_data_blobs()
    failures.extend(data_failures)
    metadata: dict[str, dict] = {}
    if paths_by_oid:
        failures.extend(inspect_git_blobs(paths_by_oid, metadata))
    if manifest is not None:
        failures.extend(inspect_manifest_data(manifest, metadata))
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
