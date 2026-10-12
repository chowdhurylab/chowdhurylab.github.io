import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";


const relative = (path) => new URL(path, new URL("../", import.meta.url));

const indexHtml = await readFile(relative("tools/catlog-static/index.html"), "utf8");
const manifestPath = indexHtml.match(/<script src="(data\/manifest\.[a-f0-9]{12}\.js)"><\/script>/)?.[1];
assert.ok(manifestPath, "check the manifest selected by the published page");
const manifestSource = await readFile(relative(`tools/catlog-static/${manifestPath}`), "utf8");
assert.equal(
  manifestPath,
  `data/manifest.${createHash("sha256").update(manifestSource).digest("hex").slice(0, 12)}.js`,
);
const manifestPrefix = "window.CATLOG_STATIC_MANIFEST = ";
const manifestLine = manifestSource.split("\n", 1)[0];
assert.ok(manifestLine.startsWith(manifestPrefix) && manifestLine.endsWith(";"));
const manifest = JSON.parse(manifestLine.slice(manifestPrefix.length, -1));
const assetVersion = manifest.asset_version;
assert.match(assetVersion, /^[a-f0-9]{16}$/);

const viewer = manifest.viewer_index;
const table = manifest.table_download;
assert.equal(viewer.path, `data/catlog-viewer-index.${viewer.sha256.slice(0, 12)}.jsonl.gz`);
assert.equal(viewer.format, "jsonl.gz");
assert.equal(viewer.encoding, "header_arrays_enums");
assert.equal(viewer.scope, "browser_runtime_row_index");
assert.equal(viewer.schema_version, 2);
assert.equal(viewer.row_count, manifest.total_rows);
assert.equal(viewer.field_count, viewer.retained_fields.length);
assert.equal(viewer.row_order, "default_review_status");
assert.equal(viewer.details_per_shard, manifest.details_per_shard);
assert.deepEqual(viewer.derived_fields, { measurement_key: "record_key", ph: "ph_display" });
assert.equal(viewer.source_table_sha256, table.sha256);
assert.equal(viewer.source_table_size_bytes, table.size_bytes);
assert.equal(table.path, `data/catlog-table.${table.sha256.slice(0, 12)}.jsonl.gz`);

const viewerUrl = relative(`tools/catlog-static/${viewer.path}`);
const tableUrl = relative(`tools/catlog-static/${table.path}`);

async function sha256(url) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(fileURLToPath(url))) digest.update(chunk);
  return digest.digest("hex");
}

const assetHashes = [];
for (const path of [
  "tools/catlog-static/assets/catlog-static.css",
  "tools/catlog-static/assets/catlog-static.js",
  "tools/catlog-static/assets/catlog-guide-workflow.svg",
  "tools/catlog-static/assets/catlog-mark.svg",
]) {
  assetHashes.push(await sha256(relative(path)));
}
const expectedAssetVersion = createHash("sha256")
  .update([manifest.source_sha256, ...assetHashes].join(""), "ascii")
  .digest("hex")
  .slice(0, 16);
assert.equal(assetVersion, expectedAssetVersion);

assert.equal((await stat(viewerUrl)).size, viewer.size_bytes);
assert.equal((await stat(tableUrl)).size, table.size_bytes);
assert.equal(await sha256(viewerUrl), viewer.sha256);
assert.equal(await sha256(tableUrl), table.sha256);
assert.ok(viewer.size_bytes < table.size_bytes);

async function* lines(url) {
  const source = createReadStream(fileURLToPath(url));
  const gunzip = createGunzip();
  const reader = createInterface({ input: source.pipe(gunzip), crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      if (line.trim()) yield line;
    }
  } finally {
    reader.close();
    source.destroy();
    gunzip.destroy();
  }
}

// The public table, by record_key: its position (detail shards follow it) and every row value.
const tableRows = new Map();
let tableFields = null;
let tableUncompressedBytes = 0;
for await (const line of lines(tableUrl)) {
  const row = JSON.parse(line);
  if (!tableFields) tableFields = Object.keys(row);
  assert.equal(tableRows.has(row.record_key), false, `duplicate record_key in the table: ${row.record_key}`);
  tableRows.set(row.record_key, { position: tableRows.size, row });
  tableUncompressedBytes += Buffer.byteLength(line) + 1;
}
assert.deepEqual(
  [...viewer.retained_fields, ...viewer.omitted_fields].sort(),
  [...tableFields].sort(),
  "viewer fields and omissions must partition the public table schema",
);

// Decode schema 2 the way the page does (catlog-static.js viewerRowConstructor).
const viewerLines = lines(viewerUrl)[Symbol.asyncIterator]();
const headerLine = (await viewerLines.next()).value;
const header = JSON.parse(headerLine);
assert.equal(header.kind, "catlog_viewer_index");
assert.equal(header.schema_version, 2);
assert.equal(header.row_count, manifest.total_rows);
assert.equal(header.order, "default_review_status");
assert.equal(header.details_per_shard, manifest.details_per_shard);
// Paper identifiers (PMIDs, DOIs) from the Full data download, when the index was built with it.
const paperFields = viewer.paper_id_fields || [];
assert.ok(paperFields.length === 0 || paperFields.join() === "pmids,dois");
assert.deepEqual(header.fields, [...viewer.retained_fields, ...paperFields, "s"]);
const at = Object.fromEntries(header.fields.map((field, index) => [field, index]));
const enums = header.enums;
const texts = header.texts || {};
for (const field of viewer.enum_fields) assert.ok(Array.isArray(enums[field]), `${field} needs its shared values`);
const numberFromDisplay = { kcat: "kcat_display", km: "km_display", kcat_over_km: "kcat_over_km_display" };
const sameAs = { review_key: "record_key", protein_accession: "primary_uniprot_id" };

function decode(values) {
  assert.ok(Array.isArray(values) && values.length === header.fields.length, "each row is one array of every field");
  const row = {};
  for (const field of viewer.retained_fields) {
    const value = values[at[field]];
    if (enums[field]) row[field] = enums[field][value];
    else if (texts[field] && typeof value === "number") row[field] = texts[field][value];
    else row[field] = value;
  }
  for (const [field, display] of Object.entries(numberFromDisplay)) {
    if (row[field] === true) row[field] = Number(row[display]);
  }
  for (const [field, source] of Object.entries(sameAs)) {
    if (row[field] === true) row[field] = row[source];
  }
  for (const [field, source] of Object.entries(viewer.derived_fields)) row[field] = row[source];
  const papers = paperFields.length
    ? { pmids: [values[at.pmids]].flat().filter((value) => value != null),
      dois: [values[at.dois]].flat().filter((value) => value != null).map((index) => header.dois[index]) }
    : null;
  return { row, shard: values[at.s], papers };
}

// Per record, the PMIDs and lower-case DOIs the Full data download gives it (the builder's _paper_ids).
const enrichedIds = new Map();
if (paperFields.length) {
  for await (const line of lines(relative(`tools/catlog-static/${manifest.enriched_download.path}`))) {
    const row = JSON.parse(line);
    const pmids = [...new Set([row.pubmed_id, ...(row.supporting_pmids || [])]
      .map((value) => String(value ?? "").trim()).filter((value) => /^[1-9][0-9]{0,9}$/.test(value)).map(Number))];
    const dois = [...new Set([row.doi, ...(row.supporting_dois || [])]
      .map((value) => String(value ?? "").trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "").toLowerCase())
      .filter((value) => value.startsWith("10.") && value.includes("/")))];
    enrichedIds.set(row.record_key, { pmids, dois });
  }
  assert.equal(enrichedIds.size, manifest.total_rows, "the Full data download holds every record");
}

// rowComparator("evidence") from catlog-static.js, with localeCompare as the page uses it.
const recordStates = { verified: 0, corrected: 0, manual_review_required: 1 };
const tierOrder = {
  paper_grounded_high_confidence: 0,
  paper_grounded: 1,
  cross_source_supported: 2,
  literature_linked: 3,
  candidate_only: 4,
};
const isV2Row = (row) => row.source_db === "primary_paper_direct"
  && row.verification_status === "verified"
  && row.enzyme_label_source === "explicit_enzyme_name";
const orderKey = (row) => ({
  stateRank: recordStates[row.verification_status] ?? 2,
  tierRank: isV2Row(row) ? -1 : (tierOrder[row.evidence_confidence_tier] ?? 99),
  sourceCount: Number(row.source_record_count || 0),
  ec: String(row.ec_number || ""),
  ecParts: String(row.ec_number || "").split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : Number.MAX_SAFE_INTEGER)),
});
function ecSort(a, b) {
  for (let index = 0; index < Math.max(a.ecParts.length, b.ecParts.length); index += 1) {
    const delta = (a.ecParts[index] ?? -1) - (b.ecParts[index] ?? -1);
    if (delta !== 0) return delta;
  }
  return a.ec.localeCompare(b.ec);
}
const evidence = (a, b) => (a.stateRank - b.stateRank) || (a.tierRank - b.tierRank)
  || (b.sourceCount - a.sourceCount) || ecSort(a, b);

let rowCount = 0;
let viewerUncompressedBytes = Buffer.byteLength(`${headerLine}\n`);
const viewerContentHash = createHash("sha256").update(`${headerLine}\n`);
const recordKeys = new Set();
let previousKey = null;
for await (const line of viewerLines) {
  const { row, shard, papers } = decode(JSON.parse(line));
  rowCount += 1;
  assert.equal(recordKeys.has(row.record_key), false, `duplicate record_key at viewer row ${rowCount}`);
  recordKeys.add(row.record_key);
  const source = tableRows.get(row.record_key);
  assert.ok(source, `viewer row ${rowCount} is not in the table: ${row.record_key}`);
  for (const field of [...viewer.retained_fields, ...Object.keys(viewer.derived_fields)]) {
    assert.deepEqual(row[field], source.row[field], `${field} differs for ${row.record_key}`);
  }
  assert.equal(shard, Math.floor(source.position / header.details_per_shard), `detail shard of ${row.record_key}`);
  if (papers) assert.deepEqual(papers, enrichedIds.get(row.record_key), `paper identifiers of ${row.record_key}`);
  assert.ok(manifest.detail_shards[shard], `detail shard ${shard} is not in the manifest`);
  const key = orderKey(row);
  if (previousKey) assert.ok(evidence(previousKey, key) <= 0, `viewer row ${rowCount} is out of the default order`);
  previousKey = key;
  const viewerLine = `${line}\n`;
  viewerContentHash.update(viewerLine);
  viewerUncompressedBytes += Buffer.byteLength(viewerLine);
}

assert.equal(rowCount, manifest.total_rows);
assert.equal(recordKeys.size, tableRows.size, "every table row is in the viewer index once");
assert.equal(viewerUncompressedBytes, viewer.uncompressed_size_bytes);
assert.equal(viewerContentHash.digest("hex"), viewer.content_sha256);
assert.ok(
  viewerUncompressedBytes <= tableUncompressedBytes * 0.25,
  "the decoded viewer index should be at most a quarter of the table's size",
);

const aliasHtml = await readFile(relative("tools/catlog-latest.html"), "utf8");
const statsHtml = await readFile(relative("tools/catlog-stats.html"), "utf8");
assert.ok(indexHtml.includes(`href="${table.path}"`));
assert.match(indexHtml, /download="catlog-table\.jsonl\.gz"/);
assert.ok(!indexHtml.includes(`href="${viewer.path}"`));
assert.ok(aliasHtml.includes(`src="catlog-static/${manifestPath}"`));
for (const [pageHtml, prefix] of [
  [indexHtml, ""],
  [aliasHtml, "catlog-static/"],
  [statsHtml, "catlog-static/"],
]) {
  assert.ok(pageHtml.includes(`src="${prefix}${manifestPath}"`));
  assert.ok(pageHtml.includes(`href="${prefix}assets/catlog-static.css?v=${assetVersion}"`));
  assert.ok(pageHtml.includes(`src="${prefix}assets/catlog-static.js?v=${assetVersion}"`));
  // the <head> starts downloading the current index; no other generation's index is named
  assert.equal(pageHtml.split(`data-src="${prefix}${viewer.path}"`).length - 1, 1);
  assert.equal((pageHtml.match(/catlog-viewer-index\.[a-f0-9]{12}\.jsonl\.gz/g) || []).length, 1);
  const versions = [...pageHtml.matchAll(/[?&]v=([a-f0-9]{16})/g)].map((match) => match[1]);
  assert.equal(versions.length, 2, "only mutable CSS and JavaScript need query versions");
  assert.deepEqual([...new Set(versions)], [assetVersion]);
}

console.log(
  `CatLog viewer index passed: ${rowCount} rows, `
  + `${tableUncompressedBytes} -> ${viewerUncompressedBytes} uncompressed bytes`,
);
