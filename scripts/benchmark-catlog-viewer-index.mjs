#!/usr/bin/env node
/** Fixed-snapshot CatLog index benchmark. Timing is reported, never asserted. */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";


const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const manifestSource = readFileSync(
  new URL("../tools/catlog-static/data/manifest.js", import.meta.url),
  "utf8",
);
const manifestPrefix = "window.CATLOG_STATIC_MANIFEST = ";
const manifestLine = manifestSource.split("\n", 1)[0];
const manifest = JSON.parse(manifestLine.slice(manifestPrefix.length, -1));

const recordStates = ["accepted", "curation_pending", "not_verified"];
const tierOrder = {
  paper_grounded_high_confidence: 0,
  paper_grounded: 1,
  cross_source_supported: 2,
  literature_linked: 3,
  candidate_only: 4,
};

function recordStateForRow(row) {
  if (row.verification_status === "verified" || row.verification_status === "corrected") {
    return "accepted";
  }
  if (row.verification_status === "manual_review_required") return "curation_pending";
  return "not_verified";
}

function prepare(records) {
  records.forEach((row, index) => {
    row._loadIndex = index;
    row._recordState = recordStateForRow(row);
    row._stateRank = recordStates.indexOf(row._recordState);
    row._tierRank = tierOrder[row.evidence_confidence_tier] ?? 99;
    row._sourceCount = Number(row.source_record_count || 0);
    row._ecSort = String(row.ec_number || "").split(".").map(
      (part) => (/^\d+$/.test(part) ? Number(part) : Number.MAX_SAFE_INTEGER),
    );
    row._sortEnzyme = String(row.enzyme_display_name || "");
    row._sortOrganism = String(row.organism || "");
    row._sortSubstrate = String(row.substrate_name || "");
    row._search = String([
      row.measurement_key,
      row.review_key,
      row.ec_number,
      row.enzyme_display_name,
      row.organism,
      row.substrate_name,
      row.mutation_signature,
      row.source_db,
      row.primary_uniprot_id,
      row.protein_accession,
    ].join(" ")).toLowerCase();
  });
}

function runWorker(relativePath) {
  if (typeof global.gc !== "function") {
    throw new Error("worker requires node --expose-gc");
  }
  global.gc();
  const baselineHeapBytes = process.memoryUsage().heapUsed;
  let compressed = readFileSync(new URL(`../tools/catlog-static/${relativePath}`, import.meta.url));
  let decoded = gunzipSync(compressed).toString("utf8");
  const decompressedBytes = Buffer.byteLength(decoded);
  compressed = null;

  const parseStarted = performance.now();
  const records = [];
  let lineStart = 0;
  while (lineStart < decoded.length) {
    const lineEnd = decoded.indexOf("\n", lineStart);
    const end = lineEnd === -1 ? decoded.length : lineEnd;
    if (end > lineStart) records.push(JSON.parse(decoded.slice(lineStart, end)));
    if (lineEnd === -1) break;
    lineStart = lineEnd + 1;
  }
  const parseMilliseconds = performance.now() - parseStarted;
  decoded = null;

  const prepareStarted = performance.now();
  prepare(records);
  const prepareMilliseconds = performance.now() - prepareStarted;
  global.gc();
  const retainedHeapBytes = process.memoryUsage().heapUsed - baselineHeapBytes;

  process.stdout.write(`${JSON.stringify({
    relative_path: relativePath,
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
