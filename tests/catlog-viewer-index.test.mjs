import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";


const relative = (path) => new URL(path, new URL("../", import.meta.url));

const manifestSource = await readFile(relative("tools/catlog-static/data/manifest.js"), "utf8");
const manifestPrefix = "window.CATLOG_STATIC_MANIFEST = ";
const manifestLine = manifestSource.split("\n", 1)[0];
assert.ok(manifestLine.startsWith(manifestPrefix) && manifestLine.endsWith(";"));
const manifest = JSON.parse(manifestLine.slice(manifestPrefix.length, -1));
const assetVersionMatch = manifestSource.match(
  /window\.CATLOG_STATIC_MANIFEST\.asset_version = "([a-f0-9]{16})";/,
);
assert.ok(assetVersionMatch);
const assetVersion = assetVersionMatch[1];

const viewer = manifest.viewer_index;
const table = manifest.table_download;
assert.equal(viewer.path, "data/catlog-viewer-index.jsonl.gz");
assert.equal(viewer.format, "jsonl.gz");
assert.equal(viewer.scope, "browser_runtime_row_index");
assert.equal(viewer.schema_version, 1);
assert.equal(viewer.row_count, manifest.total_rows);
assert.equal(viewer.field_count, viewer.retained_fields.length);
assert.equal(viewer.row_order, "identical_to_table_download");
assert.equal(viewer.source_table_sha256, table.sha256);
assert.equal(viewer.source_table_size_bytes, table.size_bytes);
assert.equal(table.path, "data/catlog-table.jsonl.gz");

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

async function* rows(url) {
  const source = createReadStream(fileURLToPath(url));
  const gunzip = createGunzip();
  const lines = createInterface({ input: source.pipe(gunzip), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line.trim()) yield { raw: line, value: JSON.parse(line) };
    }
  } finally {
    lines.close();
    source.destroy();
    gunzip.destroy();
  }
}

const tableRows = rows(tableUrl)[Symbol.asyncIterator]();
const viewerRows = rows(viewerUrl)[Symbol.asyncIterator]();
let rowCount = 0;
let tableUncompressedBytes = 0;
let viewerUncompressedBytes = 0;
const viewerContentHash = createHash("sha256");
let tableFields = null;
const recordKeys = new Set();

while (true) {
  const [tableNext, viewerNext] = await Promise.all([tableRows.next(), viewerRows.next()]);
  assert.equal(viewerNext.done, tableNext.done, "viewer and public table must end together");
  if (tableNext.done) break;

  const publicRow = tableNext.value.value;
  const viewerRow = viewerNext.value.value;
  if (!tableFields) tableFields = Object.keys(publicRow);
  assert.equal(viewerRow.record_key, publicRow.record_key, `record order differs at row ${rowCount + 1}`);
  assert.equal(recordKeys.has(viewerRow.record_key), false, `duplicate record_key at row ${rowCount + 1}`);
  recordKeys.add(viewerRow.record_key);
  assert.deepEqual(Object.keys(viewerRow), viewer.retained_fields);
  for (const field of viewer.retained_fields) {
    assert.deepEqual(viewerRow[field], publicRow[field], `${field} differs at row ${rowCount + 1}`);
  }
  for (const field of viewer.omitted_fields) {
    assert.equal(Object.hasOwn(viewerRow, field), false, `${field} leaked into viewer row ${rowCount + 1}`);
  }
  tableUncompressedBytes += Buffer.byteLength(tableNext.value.raw) + 1;
  const viewerLine = `${viewerNext.value.raw}\n`;
  viewerContentHash.update(viewerLine);
  viewerUncompressedBytes += Buffer.byteLength(viewerLine);
  rowCount += 1;
}

assert.equal(rowCount, manifest.total_rows);
assert.equal(recordKeys.size, manifest.total_rows);
assert.equal(viewerUncompressedBytes, viewer.uncompressed_size_bytes);
assert.equal(viewerContentHash.digest("hex"), viewer.content_sha256);
assert.deepEqual(
  [...viewer.retained_fields, ...viewer.omitted_fields].sort(),
  [...tableFields].sort(),
  "viewer fields and omissions must partition the public table schema",
);
assert.ok(
  viewerUncompressedBytes <= tableUncompressedBytes * 0.85,
  "viewer JSON should reduce the fixed snapshot by at least 15%",
);

const indexHtml = await readFile(relative("tools/catlog-static/index.html"), "utf8");
const aliasHtml = await readFile(relative("tools/catlog-latest.html"), "utf8");
assert.match(indexHtml, /href="data\/catlog-table\.jsonl\.gz\?v=[a-f0-9]{16}"/);
assert.match(indexHtml, /download="catlog-table\.jsonl\.gz"/);
assert.doesNotMatch(indexHtml, /href="data\/catlog-viewer-index\.jsonl\.gz/);
for (const pageHtml of [indexHtml, aliasHtml]) {
  const versions = [...pageHtml.matchAll(/[?&]v=([a-f0-9]{16})/g)].map((match) => match[1]);
  assert.ok(versions.length >= 7);
  assert.deepEqual([...new Set(versions)], [assetVersion]);
}

console.log(
  `CatLog viewer index passed: ${rowCount} rows, `
  + `${tableUncompressedBytes} -> ${viewerUncompressedBytes} uncompressed bytes`,
);
