#!/usr/bin/env node
/** Fixed-snapshot CatLog index benchmark. Timing is reported, never asserted. */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { gunzipSync } from "node:zlib";


const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const catalogFile = (path) => new URL(`../tools/catlog-static/${path}`, import.meta.url);
// The manifest the published page loads (content-addressed: data/manifest.<hash>.js).
const indexHtml = readFileSync(catalogFile("index.html"), "utf8");
const manifestPath = indexHtml.match(/<script src="(data\/manifest(?:\.[a-f0-9]{12})?\.js)(?:\?[^"]*)?"><\/script>/)?.[1];
if (!manifestPath) throw new Error("index.html does not load a manifest");
const manifestSource = readFileSync(catalogFile(manifestPath), "utf8");
const manifestPrefix = "window.CATLOG_STATIC_MANIFEST = ";
const manifestLine = manifestSource.split("\n", 1)[0];
const manifest = JSON.parse(manifestLine.slice(manifestPrefix.length, -1));

// The page's own decoder and row preparation (catlog-static.js in test mode), not a copy.
function loadViewer() {
  const window = {
    CATLOG_STATIC_TEST_MODE: true,
    CATLOG_STATIC_MANIFEST: manifest,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    location: { href: "https://example.test/tools/catlog-static/", protocol: "https:" },
  };
  const document = {
    currentScript: { src: "https://example.test/tools/catlog-static/assets/catlog-static.js", dataset: {} },
    baseURI: "https://example.test/tools/catlog-static/",
    getElementById: () => null,
    querySelectorAll: () => [],
  };
  vm.runInNewContext(readFileSync(catalogFile("assets/catlog-static.js"), "utf8"), { window, document, URL, console });
  return window.CATLOG_STATIC_TEST_API;
}

function runWorker(relativePath) {
  if (typeof global.gc !== "function") {
    throw new Error("worker requires node --expose-gc");
  }
  const viewer = loadViewer();
  global.gc();
  const baselineHeapBytes = process.memoryUsage().heapUsed;
  let compressed = readFileSync(catalogFile(relativePath));
  let decoded = gunzipSync(compressed).toString("utf8");
  const decompressedBytes = Buffer.byteLength(decoded);
  compressed = null;

  const parseStarted = performance.now();
  const records = [];
  let ViewerRow = null;
  let format = "keyed rows (schema 1 or the table)";
  let lineStart = 0;
  while (lineStart < decoded.length) {
    const lineEnd = decoded.indexOf("\n", lineStart);
    const end = lineEnd === -1 ? decoded.length : lineEnd;
    if (end > lineStart) {
      const value = JSON.parse(decoded.slice(lineStart, end));
      if (!records.length && !ViewerRow && viewer.isViewerIndexHeader(value)) {
        const header = viewer.checkedViewerIndexHeader(value, Number(manifest.details_per_shard));
        ViewerRow = viewer.viewerRowConstructor(header, manifest.detail_shards || []);
        format = `schema ${header.schema_version} arrays`;
      } else {
        records.push(ViewerRow ? new ViewerRow(value) : value);
      }
    }
    if (lineEnd === -1) break;
    lineStart = lineEnd + 1;
  }
  const parseMilliseconds = performance.now() - parseStarted;
  decoded = null;

  const prepareStarted = performance.now();
  viewer.indexLoadedRecords(records);
  const prepareMilliseconds = performance.now() - prepareStarted;
  global.gc();
  const retainedHeapBytes = process.memoryUsage().heapUsed - baselineHeapBytes;

  process.stdout.write(`${JSON.stringify({
    relative_path: relativePath,
    format,
    rows: records.length,
    decompressed_bytes: decompressedBytes,
    parse_ms: parseMilliseconds,
    prepare_ms: prepareMilliseconds,
    parse_and_prepare_ms: parseMilliseconds + prepareMilliseconds,
    retained_heap_bytes: retainedHeapBytes,
  })}\n`);
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

function summarize(samples) {
  return {
    format: samples[0].format,
    rows: samples[0].rows,
    decompressed_bytes: samples[0].decompressed_bytes,
    median_parse_ms: median(samples.map((sample) => sample.parse_ms)),
    median_prepare_ms: median(samples.map((sample) => sample.prepare_ms)),
    median_parse_and_prepare_ms: median(samples.map((sample) => sample.parse_and_prepare_ms)),
    median_retained_heap_bytes: median(samples.map((sample) => sample.retained_heap_bytes)),
  };
}

function percentReduction(before, after) {
  return ((before - after) / before) * 100;
}

function runParent() {
  const rawRuns = Number(process.argv[2] || 5);
  if (!Number.isInteger(rawRuns) || rawRuns < 1) throw new Error("runs must be a positive integer");
  const paths = {
    public_table: manifest.table_download.path,
    viewer_index: manifest.viewer_index.path,
  };
  const samples = Object.fromEntries(Object.keys(paths).map((key) => [key, []]));

  for (let run = 0; run < rawRuns; run += 1) {
    for (const [key, relativePath] of Object.entries(paths)) {
      const child = spawnSync(
        process.execPath,
        ["--expose-gc", fileURLToPath(import.meta.url), "--worker", relativePath],
        { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 1024 * 1024 },
      );
      if (child.status !== 0) {
        throw new Error(child.stderr.trim() || `benchmark worker failed for ${relativePath}`);
      }
      samples[key].push(JSON.parse(child.stdout));
    }
  }

  const publicTable = summarize(samples.public_table);
  const viewerIndex = summarize(samples.viewer_index);
  const result = {
    runs_per_artifact: rawRuns,
    public_table: publicTable,
    viewer_index: viewerIndex,
    reduction_percent: {
      decompressed_bytes: percentReduction(
        publicTable.decompressed_bytes,
        viewerIndex.decompressed_bytes,
      ),
      median_parse_ms: percentReduction(publicTable.median_parse_ms, viewerIndex.median_parse_ms),
      median_parse_and_prepare_ms: percentReduction(
        publicTable.median_parse_and_prepare_ms,
        viewerIndex.median_parse_and_prepare_ms,
      ),
      median_retained_heap_bytes: percentReduction(
        publicTable.median_retained_heap_bytes,
        viewerIndex.median_retained_heap_bytes,
      ),
    },
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[2] === "--worker") runWorker(process.argv[3]);
else runParent();
