import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DecompressionStream, ReadableStream } from "node:stream/web";
import { TextDecoder } from "node:util";
import vm from "node:vm";
import { gzipSync } from "node:zlib";

const sourceCode = await readFile(
  new URL("../tools/catlog-static/assets/catlog-static.js", import.meta.url),
  "utf8",
);
const indexHtml = await readFile(
  new URL("../tools/catlog-static/index.html", import.meta.url),
  "utf8",
);
const stableAliasHtml = await readFile(
  new URL("../tools/catlog-latest.html", import.meta.url),
  "utf8",
);
const manifestScriptMatch = indexHtml.match(
  /<script src="(data\/manifest(?:\.[a-f0-9]{12})?\.js)(?:\?[^"]*)?"><\/script>/,
);
assert.ok(manifestScriptMatch, "the canonical page should reference one supported manifest script");
const publishedManifestPath = manifestScriptMatch[1];
assert.ok(
  stableAliasHtml.includes(`src="catlog-static/${publishedManifestPath}`),
  "the stable alias should reference the canonical page's active manifest",
);
const manifestSource = await readFile(
  new URL(`../tools/catlog-static/${publishedManifestPath}`, import.meta.url),
  "utf8",
);
const manifestPrefix = "window.CATLOG_STATIC_MANIFEST = ";
const manifestLine = manifestSource.split("\n", 1)[0];
assert.ok(manifestLine.startsWith(manifestPrefix) && manifestLine.endsWith(";"));
const publishedManifest = JSON.parse(manifestLine.slice(manifestPrefix.length, -1));
const publishedAt = new Date(publishedManifest.generated_at);
assert.ok(!Number.isNaN(publishedAt.valueOf()));
const expectedSnapshotDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "long",
  day: "numeric",
  year: "numeric",
}).format(publishedAt);
const expectedRowCount = new Intl.NumberFormat("en-US").format(publishedManifest.total_rows);

function executePublishedShard(shardSource, shardPath, datasetKey) {
  const currentScript = {
    dataset: {},
    src: `https://example.test/tools/catlog-static/${shardPath}?v=legacy-viewer`,
  };
  if (datasetKey !== undefined) currentScript.dataset.catlogShard = datasetKey;
  const shardWindow = {};
  vm.runInNewContext(shardSource, {
    document: { currentScript },
    URL,
    window: shardWindow,
  });
  return { currentScript, shardWindow };
}

assert.equal(publishedManifest.details_per_shard, 250);
assert.equal(
  publishedManifest.detail_shards.length,
  Math.ceil(publishedManifest.total_rows / publishedManifest.details_per_shard),
);
const hasExactLegacyDetailPaths = publishedManifest.detail_shards.every(
  (shardPath, index) => shardPath === `data/details-${String(index).padStart(3, "0")}.js`,
);
const hasExactHashedJavaScriptDetailPaths = publishedManifest.detail_shards.every(
  (shardPath, index) => new RegExp(
    `^data/details-${String(index).padStart(3, "0")}\\.[a-f0-9]{12}\\.js$`,
  ).test(shardPath),
);
const hasExactCompressedDetailPaths = publishedManifest.detail_shards.every(
  (shardPath, index) => new RegExp(
    `^data/details-${String(index).padStart(3, "0")}\\.[a-f0-9]{12}\\.jsonl\\.gz$`,
  ).test(shardPath),
);
assert.equal(
  [hasExactLegacyDetailPaths, hasExactHashedJavaScriptDetailPaths, hasExactCompressedDetailPaths]
    .filter(Boolean).length,
  1,
  "detail shards must use one complete indexed path class: legacy JS, hashed JS, or hashed JSONL gzip",
);
const usesContentAddressedData = !hasExactLegacyDetailPaths;
for (const [key, basename] of [
  ["table_download", "catlog-table"],
  ["enriched_download", "catlog-enriched"],
  ["viewer_index", "catlog-viewer-index"],
]) {
  const descriptor = publishedManifest[key];
  assert.ok(descriptor, `${key} descriptor should be present`);
  if (usesContentAddressedData) {
    const match = descriptor.path.match(new RegExp(`^data/${basename}\\.([a-f0-9]{12})\\.jsonl\\.gz$`));
    assert.ok(match, `${key} should use the content-addressed path class`);
    assert.equal(match[1], descriptor.sha256.slice(0, 12));
  } else {
    assert.equal(descriptor.path, `data/${basename}.jsonl.gz`, `${key} should use the legacy path class`);
  }
}
for (const index of [0, Math.floor(publishedManifest.detail_shards.length / 2), publishedManifest.detail_shards.length - 1]) {
  const shardPath = publishedManifest.detail_shards[index];
  const shardBytes = await readFile(new URL(`../tools/catlog-static/${shardPath}`, import.meta.url));
  if (hasExactCompressedDetailPaths) {
    const filenameHash = shardPath.match(/\.([a-f0-9]{12})\.jsonl\.gz$/)?.[1];
    assert.equal(filenameHash, createHash("sha256").update(shardBytes).digest("hex").slice(0, 12));
    continue;
  }
  const shardSource = shardBytes.toString("utf8");
  let assignment;
  if (hasExactHashedJavaScriptDetailPaths) {
    const filenameHash = shardPath.match(/\.([a-f0-9]{12})\.js$/)?.[1];
    assert.equal(filenameHash, createHash("sha256").update(shardBytes).digest("hex").slice(0, 12));
    assert.ok(
      shardSource.includes(
        `window.CATLOG_DETAIL_SHARD_GENERATIONS[document.currentScript.dataset.catlogShard] = ${JSON.stringify(publishedManifest.source_sha256)};`,
      ),
    );
    assignment = "window.CATLOG_DETAIL_SHARDS[document.currentScript.dataset.catlogShard] = ";
  } else {
    assignment = `window.CATLOG_DETAIL_SHARDS[${JSON.stringify(shardPath)}] = `;
  }
  const assignmentStart = shardSource.indexOf(assignment);
  assert.ok(assignmentStart > 0 && shardSource.endsWith(";\n"));
  const shard = JSON.parse(shardSource.slice(assignmentStart + assignment.length, -2));
  const expectedCount = index === publishedManifest.detail_shards.length - 1
    ? ((publishedManifest.total_rows - 1) % publishedManifest.details_per_shard) + 1
    : publishedManifest.details_per_shard;
  assert.equal(Object.keys(shard).length, expectedCount);
  assert.ok(Object.entries(shard).every(([key, detail]) => detail.ui_record_key === key));

  if (hasExactHashedJavaScriptDetailPaths) {
    const legacyExecution = executePublishedShard(shardSource, shardPath, undefined);
    assert.equal(legacyExecution.currentScript.dataset.catlogShard, shardPath);
    assert.ok(legacyExecution.shardWindow.CATLOG_DETAIL_SHARDS[shardPath]);
    assert.equal(
      legacyExecution.shardWindow.CATLOG_DETAIL_SHARD_GENERATIONS[shardPath],
      publishedManifest.source_sha256,
    );
    assert.equal(Object.hasOwn(legacyExecution.shardWindow.CATLOG_DETAIL_SHARDS, "undefined"), false);
    assert.equal(Object.hasOwn(legacyExecution.shardWindow.CATLOG_DETAIL_SHARD_GENERATIONS, "undefined"), false);

    const existingKey = `data/existing-${String(index).padStart(3, "0")}.js`;
    const currentExecution = executePublishedShard(shardSource, shardPath, existingKey);
    assert.equal(currentExecution.currentScript.dataset.catlogShard, existingKey);
    assert.ok(currentExecution.shardWindow.CATLOG_DETAIL_SHARDS[existingKey]);
    assert.equal(
      currentExecution.shardWindow.CATLOG_DETAIL_SHARD_GENERATIONS[existingKey],
      publishedManifest.source_sha256,
    );
    assert.equal(Object.hasOwn(currentExecution.shardWindow.CATLOG_DETAIL_SHARDS, shardPath), false);
    assert.equal(Object.hasOwn(currentExecution.shardWindow.CATLOG_DETAIL_SHARD_GENERATIONS, shardPath), false);
    assert.equal(Object.hasOwn(currentExecution.shardWindow.CATLOG_DETAIL_SHARDS, "undefined"), false);
    assert.equal(Object.hasOwn(currentExecution.shardWindow.CATLOG_DETAIL_SHARD_GENERATIONS, "undefined"), false);
  }
}

for (const descriptor of [publishedManifest.enriched_download, publishedManifest.table_download]) {
  const versionSuffix = usesContentAddressedData ? "" : `?v=${publishedManifest.asset_version}`;
  assert.ok(indexHtml.includes(`href="${descriptor.path}${versionSuffix}"`));
  assert.ok(stableAliasHtml.includes(`href="catlog-static/${descriptor.path}${versionSuffix}"`));
  if (usesContentAddressedData) {
    assert.ok(!indexHtml.includes(`href="${descriptor.path}?v=`));
    assert.ok(!stableAliasHtml.includes(`href="catlog-static/${descriptor.path}?v=`));
  }
}

for (const [pageHtml, publicPath] of [[indexHtml, "catlog-static/"], [stableAliasHtml, "catlog-latest.html"]]) {
  assert.doesNotMatch(pageHtml, /<meta http-equiv=/);
  assert.ok(pageHtml.includes("A dash means a value is missing or hidden after a data check."));
  assert.ok(pageHtml.includes("beside a value marks one of the first four cautions below; in the record it moves to a note that says what."));
  assert.doesNotMatch(pageHtml, /Unusual stored values are kept and flagged|Open the row to see unusual stored values/);
  assert.ok(
    pageHtml.includes(
      `<meta name="description" content="CatLog snapshot dated ${expectedSnapshotDate}: browse ${expectedRowCount} enzyme kinetics measurements with review status, source links, protein sequences, and substrate structures." />`,
    ),
  );
  assert.match(pageHtml, /<meta property="og:title" content="CatLog \| Enzyme Kinetics Catalog" \/>/);
  assert.ok(
    pageHtml.includes(
      `<meta property="og:description" content="CatLog snapshot dated ${expectedSnapshotDate} with ${expectedRowCount} enzyme kinetics measurements, review status, source links, protein sequences, and substrate structures." />`,
    ),
  );
  assert.ok(pageHtml.includes(`<meta property="og:url" content="https://chowdhurylab.github.io/tools/${publicPath}" />`));
  assert.ok(pageHtml.includes(`<link rel="canonical" href="https://chowdhurylab.github.io/tools/${publicPath}" />`));
  assert.match(pageHtml, /<link rel="icon" href="\/images\/rz\.png" \/>/);
  const citationSection = pageHtml.match(/<section class="guide-citation"[\s\S]*?<\/section>/)?.[0];
  assert.ok(citationSection, "Guide must keep its citation/version section");
  assert.ok(citationSection.includes('id="guidePaperCitation"'));
  assert.ok(citationSection.includes("Sajeevan, K. A., et al. (2026)."));
  assert.ok(citationSection.includes("CatRange enables robust prediction of enzyme variant kinetic regimes."));
  assert.ok(citationSection.includes("PNAS Nexus, pgag309. doi: 10.1093/pnasnexus/pgag309."));
  for (const id of ["guideSnapshotDate", "guideSourceId", "guideExportId"]) {
    assert.ok(citationSection.includes(`id="${id}"`), `${id} must remain in Guide`);
  }
  assert.ok(citationSection.includes('href="https://doi.org/10.1093/pnasnexus/pgag309"'));
  assert.ok(citationSection.includes('href="mailto:ratul@iastate.edu?cc=supantha@iastate.edu&amp;subject=CatLog%20data%20issue"'));
  const notesPath = pageHtml === indexHtml ? "README_FIRST.txt" : "catlog-static/README_FIRST.txt";
  assert.ok(citationSection.includes(`id="guideDatasetNotesLink" href="${notesPath}"`));
  assert.equal(pageHtml.split(`href="${notesPath}"`).length - 1, 2,
    "Download and Guide must both expose the correctly resolved README");
}

assert.match(
  indexHtml,
  /<aside id="detailPanel" class="detail-panel" tabindex="-1" aria-label="Record details">/,
);
assert.doesNotMatch(indexHtml, /<aside[^>]*class="detail-panel"[^>]*aria-live=/);
assert.match(
  indexHtml,
  /id="detailStatus" class="visually-hidden" role="status" aria-live="polite" aria-atomic="true"/,
);
assert.ok(indexHtml.includes(">Located in the paper</dt><dd>The earlier automated review saved where the paper prints the values; the text may describe context rather than this value."));
assert.ok(indexHtml.includes(">Database note</dt><dd>A database note is saved; no paper-value excerpt is attached."));
assert.match(
  sourceCode,
  /if \(row\.proof_kind === "paper_evidence" \|\| row\.has_proof_excerpt\) return "Located in the paper";\s+if \(row\.proof_kind === "source_note" \|\| proofLines\.length\) return "Database note";/,
);
assert.match(
  indexHtml,
  /<main id="statsView"[^>]*hidden/,
);
assert.match(
  sourceCode,
  /const proofHeading = \(summary\.proof_kind \|\| detail\.proof_kind\) === "source_note"\s+\? "Database note"\s+: "Earlier automated review: where the values are printed";/,
);
assert.match(sourceCode, /const heading = `As printed in the paper\$\{shared \? ` \(\$\{shared\}\)` : ""\}`;/);

function makeClassList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name),
    toggle: (name, force) => {
      const next = force === undefined ? !values.has(name) : Boolean(force);
      if (next) values.add(name);
      else values.delete(name);
      return next;
    },
  };
}

const downloadBlobs = new Map();
const capturedDownloads = [];
let nextDownloadBlobId = 1;

class DownloadBlob {
  constructor(parts, options = {}) {
    this.parts = parts;
    this.type = options.type || "";
  }

  async text() {
    return this.parts.map((part) => String(part)).join("");
  }
}

class RuntimeURL extends URL {}
RuntimeURL.createObjectURL = (blob) => {
  const url = `blob:catlog-test/${nextDownloadBlobId}`;
  nextDownloadBlobId += 1;
  downloadBlobs.set(url, blob);
  return url;
};
RuntimeURL.revokeObjectURL = (url) => downloadBlobs.delete(url);

function makeElement(id) {
  const attributes = new Map();
  const listeners = new Map();
  return {
    id,
    tagName: String(id).toUpperCase(),
    value: "",
    textContent: "",
    innerHTML: "",
    title: "",
    disabled: false,
    checked: false,
    open: false,
    tabIndex: -1,
    dataset: {},
    inert: false,
    style: { setProperty() {} },
    classList: makeClassList(),
    addEventListener(type, listener, options = {}) {
      const entries = listeners.get(type) || [];
      entries.push({ listener, once: Boolean(options?.once) });
      listeners.set(type, entries);
    },
    listenerCount(type) { return (listeners.get(type) || []).length; },
    dispatch(type, fields = {}) {
      const event = {
        currentTarget: this, target: this, defaultPrevented: false, propagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        ...fields,
      };
      const entries = listeners.get(type) || [];
      entries.forEach(({ listener }) => listener(event));
      listeners.set(type, entries.filter(({ once }) => !once));
      return event;
    },
    click() {
      if (this.tagName === "A") {
        capturedDownloads.push({
          filename: this.download,
          blob: downloadBlobs.get(this.href),
        });
      }
      const entries = listeners.get("click") || [];
      entries.forEach(({ listener }) => listener({ currentTarget: this, target: this }));
      listeners.set("click", entries.filter(({ once }) => !once));
    },
    appendChild() {},
    remove() {},
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    contains: () => false,
    focus() { document.activeElement = this; },
    scrollTo() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, bottom: 0, width: 200 }),
  };
}

const elements = new Map();
const element = (id) => {
  if (!elements.has(id)) elements.set(id, makeElement(id));
  return elements.get(id);
};
const recordStateInputs = ["accepted", "curation_pending", "not_verified", "disputed"].map((value) => ({
  value,
  checked: true,
}));
const measurementInputs = ["kcat", "km", "kcat_over_km"].map((value) => ({
  value,
  checked: false,
}));
// Source: three radios (All records, Read from the paper by CatLog, From enzyme databases) and the databases.
const sourceModeInputs = ["all", "paper", "databases"].map((value) => ({
  value, type: "radio", name: "sourceMode", checked: value === "all",
}));
const sourceInputs = ["brenda", "sabio_rk", "oed", "uniprot", "skid", "strenda", "earlier_paper", "unrecorded"].map((value) => ({
  value, type: "checkbox", name: "source", checked: false,
}));
const detailBackgroundSelector = [
  ".app-header",
  "#catalogLoadProgress",
  "#searchSuggestions",
  "#catalogView > .snapshot-band",
  ".workbench > :not(.detail-panel)",
].join(", ");
const detailBackgroundElements = [makeElement("header"), makeElement("table")];
const filterBackgroundSelector = ".app-header, #catalogLoadProgress, #catalogView > .snapshot-band, .table-panel, .detail-panel";
const document = {
  baseURI: "https://example.test/catlog/",
  currentScript: {
    src: "https://example.test/catlog/assets/catlog-static.js",
    dataset: { catalogBase: "." },
  },
  hidden: false,
  activeElement: { tagName: "BODY" },
  body: makeElement("body"),
  getElementById: element,
  querySelector: () => null,
  querySelectorAll: (selector) => {
    if (selector === 'input[name="recordState"]:checked') {
      return recordStateInputs.filter((input) => input.checked);
    }
    if (selector === 'input[name="measurement"]:checked') {
      return measurementInputs.filter((input) => input.checked);
    }
    if (selector === 'input[name="recordState"]') return recordStateInputs;
    if (selector === 'input[name="measurement"]') return measurementInputs;
    if (selector === 'input[name="sourceMode"]:checked') return sourceModeInputs.filter((input) => input.checked);
    if (selector === 'input[name="sourceMode"]') return sourceModeInputs;
    if (selector === 'input[name="source"]:checked') return sourceInputs.filter((input) => input.checked);
    if (selector === 'input[name="source"]') return sourceInputs;
    if (selector === detailBackgroundSelector) return detailBackgroundElements;
    if (selector === filterBackgroundSelector) return [...detailBackgroundElements, element("detailPanel")];
    return [];
  },
  addEventListener() {},
  createElement: (tagName) => makeElement(tagName),
};
const navigator = { clipboard: {} };

let yieldCount = 0;
let embeddedDetailPanel = false;
let narrowDetailPanel = false;
const runtimeSourceSha256 = "a".repeat(64);
const runtimeManifest = {
  source_sha256: runtimeSourceSha256,
  viewer_index: { path: "data/catlog-viewer-index.jsonl.gz" },
  table_download: { path: "data/catlog-table.jsonl.gz" },
};
const compressedShardHandlers = new Map();
const compressedShardRequests = [];

function detailShardJsonl(entries, {
  sourceSha256 = runtimeSourceSha256,
  recordCount = entries.length,
  headerOverrides = {},
} = {}) {
  const header = {
    kind: "catlog_detail_shard",
    schema_version: 1,
    source_sha256: sourceSha256,
    record_count: recordCount,
    ...headerOverrides,
  };
  return `${[JSON.stringify(header), ...entries.map((entry) => JSON.stringify(entry))].join("\n")}\n`;
}

function compressedDetailShard(entries, options = {}) {
  return gzipSync(detailShardJsonl(entries, options));
}

function compressedFetchResponse(body, status = 200) {
  const bytes = body instanceof Uint8Array ? body : new Uint8Array();
  return {
    ok: status >= 200 && status < 300,
    status,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  };
}

async function fetchCompressedShard(url) {
  const request = new URL(url);
  const relativePath = request.pathname.replace(/^\/catlog\//, "");
  compressedShardRequests.push(request.href);
  const handler = compressedShardHandlers.get(relativePath);
  if (!handler) return compressedFetchResponse(undefined, 404);
  const body = typeof handler === "function" ? handler(request) : handler;
  if (body && typeof body === "object" && typeof body.ok === "boolean" && body.body) return body;
  return compressedFetchResponse(body);
}

const window = {
  innerWidth: 1440,
  innerHeight: 900,
  CATLOG_STATIC_TEST_MODE: true,
  CATLOG_STATIC_MANIFEST: runtimeManifest,
  CATLOG_RECORD_CHUNKS: [],
  CATLOG_DETAIL_SHARDS: {},
  CATLOG_DETAIL_SHARD_GENERATIONS: {},
  fetch: fetchCompressedShard,
  AbortController,
  DecompressionStream,
  TextDecoder,
  scheduler: {
    yield: async () => {
      yieldCount += 1;
    },
  },
  location: {
    href: "https://example.test/catlog/",
    protocol: "https:",
    pathname: "/catlog/",
    search: "",
    hash: "",
    replace() {},
  },
  history: { pushState() {}, replaceState() {} },
  requestAnimationFrame: (callback) => callback(),
  scrollTo() {},
  matchMedia: (query) => ({
    get matches() {
      if (query === "(min-width: 1681px)") return embeddedDetailPanel;
      if (query === "(max-width: 1180px)") return narrowDetailPanel;
      return false;
    },
    addEventListener() {},
  }),
  addEventListener() {},
  setTimeout,
  clearTimeout,
};

vm.runInNewContext(sourceCode, {
  Blob: DownloadBlob,
  console,
  document,
  navigator,
  window,
  fetch: (...args) => window.fetch(...args),
  DecompressionStream,
  TextDecoder,
  URL: RuntimeURL,
  URLSearchParams,
  Intl,
  Date,
  Math,
  Number,
  String,
  Set,
  Map,
  Promise,
  Array,
  Object,
});

const api = window.CATLOG_STATIC_TEST_API;
assert.equal(api.state.pageSize, 25, "Browse defaults to 25 rows per page");
assert.ok(api, "test API should be exposed without starting the application");
{
  const originalGetElement = document.getElementById;
  const originalHref = window.location.href;
  const originalReplace = window.location.replace;
  const navigations = [];
  document.getElementById = (id) => id === "statsView" ? null : originalGetElement(id);
  window.location.replace = (href) => navigations.push(href);
  await api.init();
  assert.equal(navigations.length, 1, "Old cached HTML should refresh before binding new controls");
  assert.equal(new URL(navigations[0]).searchParams.get("layout"), "stats");
  window.location.href = navigations[0];
  await api.init();
  assert.equal(navigations.length, 1, "A failed refresh must not loop");
  assert.equal(element("pageSummary").textContent, "This page is out of date. Reload to update it.");
  document.getElementById = originalGetElement;
  window.location.href = originalHref;
  window.location.replace = originalReplace;
}
// Load failures speak plainly: no shard, chunk or generation in the notice.
{
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(api.publicLoadMessage("Detail shard data/details-001.js does not match the CatLog source generation"),
      "This page is out of date. Reload to update it.");
    assert.equal(api.publicLoadMessage("This page cannot read CatLog index version 3. Reload the page."), "This page is out of date. Reload to update it.");
    assert.equal(api.publicLoadMessage("Detail shard data/details-001.js does not contain abc"), "This record could not be loaded.");
    assert.equal(api.publicLoadMessage("The table data could not be downloaded (HTTP 404)"), "The table data could not be downloaded (HTTP 404)");
  } finally {
    console.warn = originalWarn;
  }
}
assert.equal(api.recordIndexPath(), "data/catlog-viewer-index.jsonl.gz");
delete runtimeManifest.viewer_index;
assert.equal(api.recordIndexPath(), "data/catlog-table.jsonl.gz");
runtimeManifest.viewer_index = { path: "data/catlog-viewer-index.jsonl.gz" };

runtimeManifest.total_rows = 1;
runtimeManifest.record_chunks = [];
window.location.protocol = "file:";
await api.loadRecordChunks();
assert.equal(element("activeSummary").textContent, "This copy needs a web server");
assert.ok(document.body.classList.contains("catalog-load-failed"), "load errors should enable the readable empty-table layout");
assert.match(element("pageSummary").textContent, /serve this folder over HTTP/);
assert.match(element("pageSummary").textContent, /does not include an offline snapshot/);
assert.doesNotMatch(element("pageSummary").textContent, /use the offline snapshot|download.*(?:zip|snapshot)/);

window.location.protocol = "https:";
window.DecompressionStream = undefined;
await api.loadRecordChunks();
assert.equal(element("activeSummary").textContent, "This browser cannot open the CatLog records");
assert.match(element("pageSummary").textContent, /current version of Safari, Chrome, Edge or Firefox/);
assert.doesNotMatch(element("pageSummary").textContent, /offline|zip|serve this folder/);
await api.applyFilters();
assert.equal(document.body.classList.contains("catalog-load-failed"), false, "rendering results should restore the normal table layout");
window.DecompressionStream = DecompressionStream;
delete runtimeManifest.total_rows;
delete runtimeManifest.record_chunks;

{
  const originalFetch = window.fetch;
  const originalTimeout = window.setTimeout;
  runtimeManifest.total_rows = 1;
  runtimeManifest.record_chunks = [];
  window.setTimeout = (callback) => { callback(); return 0; };
  try {
    for (const failure of ["invalid-json", "read-error"]) {
      let requests = 0;
      let cancellations = 0;
      let releases = 0;
      window.fetch = async () => {
        requests += 1;
        return {
          ok: true,
          body: {
            pipeThrough: () => ({
              getReader: () => ({
                async read() {
                  if (failure === "read-error") throw new Error("Connection interrupted");
                  return { done: false, value: Buffer.from("{invalid json}\n") };
                },
                async cancel() { cancellations += 1; },
                releaseLock() { releases += 1; },
              }),
            }),
          },
        };
      };
      await api.loadRecordChunks();
      assert.equal(requests, 4, "the table loader must retain its bounded retry budget");
      assert.equal(cancellations, 4, `${failure}: cancel each failed reader before retrying`);
      assert.equal(releases, 4, `${failure}: release each failed reader lock`);
      assert.equal(element("activeSummary").textContent, "CatLog records are temporarily unavailable");
    }
    let requests = 0;
    let cancellations = 0;
    let releases = 0;
    const retryNotices = [];
    window.setTimeout = (callback) => {
      retryNotices.push(element("activeSummary").textContent);
      callback();
      return 0;
    };
    window.fetch = async () => {
      const attempt = ++requests;
      let consumed = false;
      return {
        ok: true,
        body: {
          pipeThrough: () => ({
            getReader: () => ({
              async read() {
                if (attempt === 1) throw new Error("Connection interrupted");
                if (consumed) return { done: true };
                consumed = true;
                return { done: false, value: Buffer.from('{"record_key":"recovered","claim_status":"verified"}\n') };
              },
              async cancel() { cancellations += 1; throw new Error("Reader already failed"); },
              releaseLock() { releases += 1; },
            }),
          }),
        },
      };
    };
    await api.loadRecordChunks();
    assert.equal(requests, 2, "a successful retry should stop further downloads");
    assert.equal(cancellations, 1, "only the failed attempt should be cancelled");
    assert.equal(releases, 2, "release failed and completed reader locks");
    assert.ok(retryNotices.includes("Retrying table download"));
    assert.equal(api.state.recordsReady, true);
    assert.equal(api.state.records[0].record_key, "recovered");
    assert.equal(document.body.classList.contains("catalog-load-failed"), false);
  } finally {
    window.fetch = originalFetch;
    window.setTimeout = originalTimeout;
    delete runtimeManifest.total_rows;
    delete runtimeManifest.record_chunks;
    api.indexLoadedRecords([]);
    await api.applyFilters();
  }
}

const scriptedShardPayloads = new Map();
const scriptedShardGenerations = new Map();
const injectedScripts = [];
let injectedScriptCount = 0;
let removedScriptCount = 0;
document.body.appendChild = (script) => {
  if (script.tagName === "A") return;
  injectedScriptCount += 1;
  const relativePath = new URL(script.src).pathname.replace(/^\/catlog\//, "");
  injectedScripts.push({ src: script.src, catlogShard: script.dataset.catlogShard });
  if (scriptedShardPayloads.has(relativePath)) {
    window.CATLOG_DETAIL_SHARDS[relativePath] = scriptedShardPayloads.get(relativePath);
  }
  if (scriptedShardGenerations.has(relativePath)) {
    window.CATLOG_DETAIL_SHARD_GENERATIONS[relativePath] = scriptedShardGenerations.get(relativePath);
  }
  const remove = script.remove.bind(script);
  script.remove = () => {
    removedScriptCount += 1;
    remove();
  };
  Promise.resolve().then(() => script.onload());
};

const concurrentShard = "data/details-concurrent.js";
const firstConcurrentLoad = api.loadScript(concurrentShard);
const secondConcurrentLoad = api.loadScript(concurrentShard);
assert.strictEqual(firstConcurrentLoad, secondConcurrentLoad);
await Promise.all([firstConcurrentLoad, secondConcurrentLoad]);
assert.equal(injectedScriptCount, 1, "concurrent requests for one shard should inject one script");
assert.equal(removedScriptCount, 1, "a loaded script element should be removed");
assert.equal(injectedScripts.at(-1).catlogShard, concurrentShard);
assert.equal(new URL(injectedScripts.at(-1).src).searchParams.get("v"), runtimeSourceSha256.slice(0, 16));

const hashedRecordChunk = "data/records-000.0123456789ab.js";
await api.loadScript(hashedRecordChunk, true);
const hashedRecordRequest = new URL(injectedScripts.at(-1).src);
assert.equal(hashedRecordRequest.searchParams.has("v"), false, "content-addressed record chunks must not use the asset-version query");
assert.equal(injectedScripts.at(-1).catlogShard, hashedRecordChunk);

api.state.loadedScripts.clear();
api.state.loadingScripts.clear();
window.CATLOG_DETAIL_SHARDS = {};
window.CATLOG_DETAIL_SHARD_GENERATIONS = {};
const generationCheckedShard = "data/details-999.0123456789ab.js";
scriptedShardPayloads.set(generationCheckedShard, { checked: { value: 42 } });
scriptedShardGenerations.set(generationCheckedShard, "b".repeat(64));
const originalSetTimeout = window.setTimeout;
window.setTimeout = (callback) => {
  callback();
  return 0;
};
const scriptsBeforeGenerationFailure = injectedScriptCount;
await assert.rejects(
  api.detailForRow({ detail_shard: generationCheckedShard, record_key: "checked" }),
  /does not match the CatLog source generation/,
);
window.setTimeout = originalSetTimeout;
assert.equal(injectedScriptCount, scriptsBeforeGenerationFailure + 4, "generation mismatch should use the existing retry budget");
assert.equal(api.state.loadedScripts.has(generationCheckedShard), false, "a rejected generation must remain reloadable");
assert.equal(window.CATLOG_DETAIL_SHARDS[generationCheckedShard], undefined);
assert.equal(window.CATLOG_DETAIL_SHARD_GENERATIONS[generationCheckedShard], undefined);

scriptedShardGenerations.set(generationCheckedShard, runtimeSourceSha256);
const scriptsBeforeGenerationReload = injectedScriptCount;
assert.equal(
  (await api.detailForRow({ detail_shard: generationCheckedShard, record_key: "checked" })).value,
  42,
);
assert.equal(injectedScriptCount, scriptsBeforeGenerationReload + 1, "a corrected generation should load on retry");
const generationRequest = new URL(injectedScripts.at(-1).src);
assert.equal(generationRequest.searchParams.has("v"), false, "content-addressed data must not use the asset-version query");
assert.equal(injectedScripts.at(-1).catlogShard, generationCheckedShard);

function resetDetailCaches() {
  api.state.loadedScripts.clear();
  api.state.loadingScripts.clear();
  api.state.detailShardLru.clear();
  window.CATLOG_DETAIL_SHARDS = {};
  window.CATLOG_DETAIL_SHARD_GENERATIONS = {};
}

resetDetailCaches();
const compressedSuccessShard = "data/details-900.111111111111.jsonl.gz";
compressedShardHandlers.set(
  compressedSuccessShard,
  compressedDetailShard([["compressed-row", { value: 17 }]]),
);
const requestsBeforeCompressedSuccess = compressedShardRequests.length;
const firstCompressedLoad = api.loadDetailShard(compressedSuccessShard);
const secondCompressedLoad = api.loadDetailShard(compressedSuccessShard);
assert.strictEqual(firstCompressedLoad, secondCompressedLoad, "compressed shard loads should share one in-flight request");
await Promise.all([firstCompressedLoad, secondCompressedLoad]);
assert.equal(compressedShardRequests.length, requestsBeforeCompressedSuccess + 1);
assert.equal(
  (await api.detailForRow({ detail_shard: compressedSuccessShard, record_key: "compressed-row" })).value,
  17,
);
assert.equal(window.CATLOG_DETAIL_SHARD_GENERATIONS[compressedSuccessShard], runtimeSourceSha256);
const compressedSuccessRequest = new URL(compressedShardRequests.at(-1));
assert.equal(compressedSuccessRequest.searchParams.has("v"), false, "hashed detail gzip must not use the asset-version query");
assert.equal(compressedSuccessRequest.searchParams.has("retry"), false);

const validationShard = "data/details-901.222222222222.jsonl.gz";
{
  const original = { fetch: window.fetch, setTimeout: window.setTimeout, clearTimeout: window.clearTimeout };
  const priorState = { filtered: api.state.filtered, page: api.state.page, pageSize: api.state.pageSize, recordsReady: api.state.recordsReady };
  const turn = () => new Promise(resolve => setImmediate(resolve));
  assert.equal(api.DETAIL_REQUEST_TIMEOUT_MS, 30000);
  try {
    for (const [index, stage] of ["fetch", "body", "cancel"].entries()) {
      resetDetailCaches();
      const shard = `data/details-${970 + index}.abababababab.jsonl.gz`;
      const timers = new Map(), signals = [], lateResponses = [];
      let timerId = 0, cancellations = 0;
      window.setTimeout = (callback, delay) => {
        if (delay === api.DETAIL_REQUEST_TIMEOUT_MS) {
          timers.set(++timerId, callback);
          return timerId;
        }
        queueMicrotask(callback);
        return 0;
      };
      window.clearTimeout = id => timers.delete(id);
      window.fetch = (_url, options) => {
        signals.push(options.signal);
        if (stage === "fetch") return new Promise(resolve => lateResponses.push(resolve));
        return Promise.resolve({ ok: true, body: new ReadableStream({
          cancel() {
            cancellations += 1;
            if (stage === "cancel") return new Promise(() => {});
          },
        }) });
      };
      api.state.filtered = [row({ record_key: "timeout-row", detail_shard: shard })];
      api.state.page = 1;
      api.state.pageSize = 25;
      api.state.recordsReady = true;
      element("downloadPageButton").disabled = false;
      const downloadsBefore = capturedDownloads.length;
      const detailResult = api.loadDetailShard(shard).then(
        () => null,
        error => error,
      );
      const pageResult = api.handlePageDownload();
      assert.equal(api.state.pageDownloadPending, true);
      assert.equal(element("downloadPageButton").disabled, true);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await turn();
        assert.equal(signals.length, attempt + 1, `${stage}: requests share the existing retry budget`);
        assert.equal(timers.size, 1, `${stage}: exactly one deadline per shared attempt`);
        [...timers.values()][0]();
      }
      assert.match((await detailResult).message, /record download took too long/);
      await pageResult;
      await turn();
      assert.equal(api.state.pageDownloadPending, false, `${stage}: page download unlocks`);
      assert.equal(element("downloadPageButton").disabled, false);
      assert.equal(capturedDownloads.length, downloadsBefore, "Do not download partial records after a timeout");
      assert.ok(signals.every(signal => signal.aborted), `${stage}: abort every timed-out request`);
      assert.equal(timers.size, 0, `${stage}: clear all deadline timers`);
      assert.equal(api.state.loadingScripts.has(shard), false);
      assert.equal(api.state.loadedScripts.has(shard), false);
      assert.equal(window.CATLOG_DETAIL_SHARDS[shard], undefined);
      if (stage !== "fetch") assert.equal(cancellations, 4, `${stage}: cancel stalled bodies`);
      for (const resolve of lateResponses) resolve(compressedFetchResponse(compressedDetailShard([["timeout-row", {value: -1}]])));
      await turn();
      assert.equal(window.CATLOG_DETAIL_SHARDS[shard], undefined, "Late responses must not populate the cache");
      let successfulSignal;
      window.fetch = (_url, options) => {
        successfulSignal = options.signal;
        return Promise.resolve(compressedFetchResponse(compressedDetailShard([["timeout-row", {value: 23}]])));
      };
      const recovered = await api.detailForRow({detail_shard: shard, record_key: "timeout-row"});
      assert.equal(recovered.value, 23, "Retry the same shard successfully after timeouts");
      assert.equal(successfulSignal.aborted, false, "A healthy request must not be aborted");
      assert.equal(timers.size, 0, "A successful request clears its deadline");
      await api.handlePageDownload();
      assert.equal(capturedDownloads.length, downloadsBefore + 1, "Page export works again after recovery");
    }
  } finally {
    Object.assign(window, original);
    Object.assign(api.state, priorState);
    resetDetailCaches();
  }
}

const validHeader = detailShardJsonl([], { recordCount: 1 }).split("\n", 1)[0];
assert.throws(
  () => api.parseCompressedDetailShard(`${validHeader}\n[\"truncated\"\n`, validationShard),
  /contains invalid JSON/,
  "a truncated JSONL entry must be rejected",
);
assert.throws(
  () => api.parseCompressedDetailShard(
    detailShardJsonl([["duplicate", {}], ["duplicate", {}]]),
    validationShard,
  ),
  /duplicate record key/,
);
assert.throws(
  () => api.parseCompressedDetailShard(
    detailShardJsonl([["counted", {}]], { recordCount: 2 }),
    validationShard,
  ),
  /record count does not match/,
);
assert.throws(
  () => api.parseCompressedDetailShard(detailShardJsonl([["missing-detail"]]), validationShard),
  /invalid record entry/,
);
assert.throws(
  () => api.parseCompressedDetailShard(
    detailShardJsonl([], { headerOverrides: { extra: true } }),
    validationShard,
  ),
  /invalid header/,
  "the compressed envelope must contain only the specified header fields",
);

async function assertCompressedShardRejected(shard, body, expectedError = null) {
  resetDetailCaches();
  compressedShardHandlers.set(shard, body);
  const requestsBefore = compressedShardRequests.length;
  window.setTimeout = (callback, delay) => {
    if (delay === api.DETAIL_REQUEST_TIMEOUT_MS) return originalSetTimeout(callback, delay);
    callback();
    return 0;
  };
  try {
    if (expectedError) await assert.rejects(api.loadDetailShard(shard), expectedError);
    else await assert.rejects(api.loadDetailShard(shard));
  } finally {
    window.setTimeout = originalSetTimeout;
  }
  assert.equal(compressedShardRequests.length, requestsBefore + 4);
  assert.equal(window.CATLOG_DETAIL_SHARDS[shard], undefined);
  assert.equal(window.CATLOG_DETAIL_SHARD_GENERATIONS[shard], undefined);
  assert.equal(api.state.loadedScripts.has(shard), false);
  assert.equal(api.state.detailShardLru.has(shard), false);
}

const invalidUtf8Shard = "data/details-904.555555555555.jsonl.gz";
let invalidUtf8CancellationCount = 0;
let invalidUtf8ReleaseCount = 0;
await assertCompressedShardRejected(invalidUtf8Shard, () => {
  const reader = {
    async read() {
      return { value: new Uint8Array([0xff]), done: false };
    },
    async cancel() {
      invalidUtf8CancellationCount += 1;
    },
    releaseLock() {
      invalidUtf8ReleaseCount += 1;
    },
  };
  return {
    ok: true,
    status: 200,
    body: {
      pipeThrough() {
        return { getReader: () => reader };
      },
    },
  };
}, /could not be decompressed or decoded/);
assert.equal(invalidUtf8CancellationCount, 4, "each malformed UTF-8 attempt should cancel its still-open stream");
assert.equal(invalidUtf8ReleaseCount, 4, "each malformed UTF-8 attempt should release its reader lock");
const truncatedGzipShard = "data/details-905.666666666666.jsonl.gz";
const completeGzip = compressedDetailShard([["truncated-gzip", { value: 31 }]]);
await assertCompressedShardRejected(
  truncatedGzipShard,
  completeGzip.subarray(0, Math.floor(completeGzip.length / 2)),
);

resetDetailCaches();
const compressedRetryShard = "data/details-902.333333333333.jsonl.gz";
let compressedRetryAttempt = 0;
compressedShardHandlers.set(compressedRetryShard, () => {
  compressedRetryAttempt += 1;
  if (compressedRetryAttempt === 1) {
    return gzipSync(`${detailShardJsonl([], { recordCount: 1 }).split("\n", 1)[0]}\n[\"retry-row\"\n`);
  }
  return compressedDetailShard([["retry-row", { value: 23 }]]);
});
const retryRequestsBefore = compressedShardRequests.length;
const compressedRetryNotices = [];
window.setTimeout = (callback, delay) => {
  if (delay === api.DETAIL_REQUEST_TIMEOUT_MS) return originalSetTimeout(callback, delay);
  callback();
  return 0;
};
try {
  const [firstRetryDetail, secondRetryDetail] = await Promise.all([
    api.detailForRow(
      { detail_shard: compressedRetryShard, record_key: "retry-row" },
      { onRetry: (attempt, delay) => compressedRetryNotices.push([attempt, delay]) },
    ),
    api.detailForRow({ detail_shard: compressedRetryShard, record_key: "retry-row" }),
  ]);
  assert.equal(firstRetryDetail.value, 23);
  assert.equal(secondRetryDetail.value, 23);
} finally {
  window.setTimeout = originalSetTimeout;
}
const compressedRetryRequests = compressedShardRequests.slice(retryRequestsBefore);
assert.equal(compressedRetryRequests.length, 2, "a malformed first response should use one existing retry");
assert.deepEqual(compressedRetryNotices, [[1, 2000]]);
assert.equal(new URL(compressedRetryRequests[0]).searchParams.has("v"), false);
assert.equal(new URL(compressedRetryRequests[1]).searchParams.has("v"), false);
assert.equal(new URL(compressedRetryRequests[1]).searchParams.get("retry"), "1");

resetDetailCaches();
const compressedWrongGenerationShard = "data/details-903.444444444444.jsonl.gz";
compressedShardHandlers.set(
  compressedWrongGenerationShard,
  compressedDetailShard([["wrong-generation", { value: 29 }]], { sourceSha256: "b".repeat(64) }),
);
const wrongGenerationRequestsBefore = compressedShardRequests.length;
window.setTimeout = (callback, delay) => {
  if (delay === api.DETAIL_REQUEST_TIMEOUT_MS) return originalSetTimeout(callback, delay);
  callback();
  return 0;
};
try {
  await assert.rejects(
    api.detailForRow({ detail_shard: compressedWrongGenerationShard, record_key: "wrong-generation" }),
    /does not match the CatLog source generation/,
  );
} finally {
  window.setTimeout = originalSetTimeout;
}
assert.equal(
  compressedShardRequests.length,
  wrongGenerationRequestsBefore + 4,
  "a compressed generation mismatch should use the existing retry budget",
);
assert.equal(window.CATLOG_DETAIL_SHARDS[compressedWrongGenerationShard], undefined);
assert.equal(window.CATLOG_DETAIL_SHARD_GENERATIONS[compressedWrongGenerationShard], undefined);
assert.equal(api.state.loadedScripts.has(compressedWrongGenerationShard), false);
assert.equal(api.state.detailShardLru.has(compressedWrongGenerationShard), false);

resetDetailCaches();
const compressedLruShards = [];
for (let index = 0; index <= api.DETAIL_SHARD_CACHE_LIMIT; index += 1) {
  const shard = `data/details-${700 + index}.${index.toString(16).padStart(12, "0")}.jsonl.gz`;
  const recordKey = `compressed-lru-${index}`;
  compressedLruShards.push({ shard, recordKey });
  compressedShardHandlers.set(shard, compressedDetailShard([[recordKey, { value: index }]]));
  assert.equal((await api.detailForRow({ detail_shard: shard, record_key: recordKey })).value, index);
}
const compressedEvicted = compressedLruShards[0];
assert.equal(window.CATLOG_DETAIL_SHARDS[compressedEvicted.shard], undefined);
assert.equal(window.CATLOG_DETAIL_SHARD_GENERATIONS[compressedEvicted.shard], undefined);
assert.equal(api.state.loadedScripts.has(compressedEvicted.shard), false);
const evictedRequestCount = compressedShardRequests.filter(
  (request) => new URL(request).pathname.endsWith(`/${compressedEvicted.shard}`),
).length;
assert.equal(
  (await api.detailForRow({ detail_shard: compressedEvicted.shard, record_key: compressedEvicted.recordKey })).value,
  0,
);
assert.equal(
  compressedShardRequests.filter(
    (request) => new URL(request).pathname.endsWith(`/${compressedEvicted.shard}`),
  ).length,
  evictedRequestCount + 1,
  "an evicted compressed shard should be fetched again",
);
assert.equal(api.state.detailShardLru.size, api.DETAIL_SHARD_CACHE_LIMIT);

api.state.loadedScripts.clear();
api.state.loadingScripts.clear();
api.state.detailShardLru.clear();
window.CATLOG_DETAIL_SHARDS = {};
window.CATLOG_DETAIL_SHARD_GENERATIONS = {};
assert.equal(api.DETAIL_SHARD_CACHE_LIMIT, 8);
for (let index = 0; index < api.DETAIL_SHARD_CACHE_LIMIT; index += 1) {
  const shard = `data/details-lru-${index}.js`;
  window.CATLOG_DETAIL_SHARDS[shard] = { [`row-${index}`]: { value: index } };
  window.CATLOG_DETAIL_SHARD_GENERATIONS[shard] = runtimeSourceSha256;
  api.state.loadedScripts.add(shard);
  api.retainDetailShard(shard);
}
api.retainDetailShard("data/details-lru-0.js");
window.CATLOG_DETAIL_SHARDS["data/details-lru-8.js"] = { "row-8": { value: 8 } };
window.CATLOG_DETAIL_SHARD_GENERATIONS["data/details-lru-8.js"] = runtimeSourceSha256;
api.state.loadedScripts.add("data/details-lru-8.js");
api.retainDetailShard("data/details-lru-8.js");
assert.ok(window.CATLOG_DETAIL_SHARDS["data/details-lru-0.js"], "a cache hit should refresh recency");
assert.equal(window.CATLOG_DETAIL_SHARDS["data/details-lru-1.js"], undefined, "the true least-recent shard should be evicted");
assert.equal(window.CATLOG_DETAIL_SHARD_GENERATIONS["data/details-lru-1.js"], undefined, "eviction should remove generation metadata");
assert.equal(api.state.loadedScripts.has("data/details-lru-1.js"), false, "an evicted shard must be reloadable");
assert.equal(api.state.detailShardLru.size, api.DETAIL_SHARD_CACHE_LIMIT);

scriptedShardPayloads.set("data/details-lru-1.js", { "row-1": { value: 1 } });
const scriptsBeforeReload = injectedScriptCount;
assert.equal(
  (await api.detailForRow({ detail_shard: "data/details-lru-1.js", record_key: "row-1" })).value,
  1,
);
assert.equal(injectedScriptCount, scriptsBeforeReload + 1, "an evicted shard should load again");
assert.equal(api.state.detailShardLru.size, api.DETAIL_SHARD_CACHE_LIMIT);

api.state.loadedScripts.clear();
api.state.loadingScripts.clear();
api.state.detailShardLru.clear();
window.CATLOG_DETAIL_SHARDS = {};
window.CATLOG_DETAIL_SHARD_GENERATIONS = {};
for (let index = 0; index < api.DETAIL_SHARD_CACHE_LIMIT; index += 1) {
  const shard = `data/details-missing-${index}.js`;
  window.CATLOG_DETAIL_SHARDS[shard] = { [`row-${index}`]: { value: index } };
  api.state.loadedScripts.add(shard);
  api.retainDetailShard(shard);
}
await assert.rejects(
  api.detailForRow({ detail_shard: "data/details-missing-0.js", record_key: "not-present" }),
  /does not contain not-present/,
);
assert.equal(api.state.loadedScripts.has("data/details-missing-0.js"), false, "a missing record should remain reloadable");
assert.equal(Object.keys(window.CATLOG_DETAIL_SHARDS).length, api.DETAIL_SHARD_CACHE_LIMIT);
assert.equal(api.state.detailShardLru.size, api.DETAIL_SHARD_CACHE_LIMIT);
scriptedShardPayloads.set("data/details-after-missing.js", { "after-missing": { value: 9 } });
await api.detailForRow({ detail_shard: "data/details-after-missing.js", record_key: "after-missing" });
assert.equal(Object.keys(window.CATLOG_DETAIL_SHARDS).length, api.DETAIL_SHARD_CACHE_LIMIT);
assert.equal(api.state.detailShardLru.size, api.DETAIL_SHARD_CACHE_LIMIT);

api.state.loadedScripts.clear();
api.state.loadingScripts.clear();
api.state.detailShardLru.clear();
window.CATLOG_DETAIL_SHARDS = {};
window.CATLOG_DETAIL_SHARD_GENERATIONS = {};
const widePageRows = Array.from({ length: 12 }, (_, index) => {
  const detail_shard = `data/details-wide-${index}.js`;
  const record_key = `wide-${index}`;
  scriptedShardPayloads.set(detail_shard, { [record_key]: { value: index } });
  return { detail_shard, record_key };
});
const widePageDetails = await Promise.all(widePageRows.map((row) => api.detailForRow(row)));
assert.deepEqual(widePageDetails.map((detail) => detail.value), Array.from({ length: 12 }, (_, index) => index));
assert.equal(Object.keys(window.CATLOG_DETAIL_SHARDS).length, api.DETAIL_SHARD_CACHE_LIMIT);
assert.equal(api.state.detailShardLru.size, api.DETAIL_SHARD_CACHE_LIMIT);
assert.equal(api.state.loadedScripts.size, api.DETAIL_SHARD_CACHE_LIMIT);

api.state.loadedScripts.clear();
api.state.loadingScripts.clear();
api.state.detailShardLru.clear();
window.CATLOG_DETAIL_SHARDS = {};
window.CATLOG_DETAIL_SHARD_GENERATIONS = {};

const focusRows = [{ record_key: "first" }, { record_key: "second" }];
api.state.activeRowKey = "";
api.state.selectedKey = "";
assert.equal(api.activeTableRowKey(focusRows), "first");
api.state.activeRowKey = "second";
assert.equal(api.activeTableRowKey(focusRows), "second");
api.state.activeRowKey = "missing";
api.state.selectedKey = "first";
assert.equal(api.activeTableRowKey(focusRows), "first");
api.state.activeRowKey = "";
api.state.selectedKey = "";
assert.equal(api.openedRecordMessage({ enzyme_display_name: "Example enzyme" }), "Opened Example enzyme");
assert.equal(api.openedRecordMessage({}), "Opened record");

const detailPanel = element("detailPanel");
narrowDetailPanel = true;
document.body.classList.add("detail-open");
document.activeElement = detailBackgroundElements[0];
api.syncDetailPanelAccessibility();
assert.equal(detailPanel.getAttribute("role"), "dialog");
assert.equal(detailPanel.getAttribute("aria-modal"), "true");
assert.ok(detailBackgroundElements.every((item) => item.inert));
assert.equal(document.activeElement, detailPanel);
narrowDetailPanel = false;
api.syncDetailPanelAccessibility();
assert.equal(detailPanel.getAttribute("role"), null);
assert.equal(detailPanel.getAttribute("aria-modal"), null);
assert.ok(detailBackgroundElements.every((item) => !item.inert));
document.body.classList.remove("detail-open");

for (const narrow of [false, true]) {
  narrowDetailPanel = narrow;
  api.setFiltersOpen(true);
  assert.equal(element("openFiltersButton").getAttribute("aria-expanded"), "true");
  assert.equal(element("catalogFilters").getAttribute("role"), "dialog");
  assert.equal(element("catalogFilters").getAttribute("aria-hidden"), "false");
  assert.equal(element("catalogFilters").inert, false);
  assert.ok(detailBackgroundElements.every((item) => item.inert));
  assert.equal(detailPanel.inert, true);
  api.setFiltersOpen(false);
  assert.equal(element("catalogFilters").inert, true);
  assert.equal(element("catalogFilters").getAttribute("aria-hidden"), "true");
  assert.ok(detailBackgroundElements.every((item) => !item.inert));
  assert.equal(detailPanel.inert, false);
}
narrowDetailPanel = false;
{
  const rail = element("catalogFilters");
  const input = element("enzymeFilterInput");
  const originalContains = rail.contains;
  const originalSetTimeout = window.setTimeout;
  const originalActiveElement = document.activeElement;
  const timers = [];
  window.setTimeout = (callback) => timers.push(callback);
  rail.contains = (target) => target === input || target === element("closeFiltersButton");
  try {
    document.activeElement = element("openFiltersButton");
    api.setFiltersOpen(true);
    timers.shift()();
    assert.equal(document.activeElement, element("closeFiltersButton"), "Opening Filters moves focus after its transition");
    api.setFiltersOpen(false);
    api.setFiltersOpen(true);
    input.focus();
    timers.shift()();
    assert.equal(document.activeElement, input, "Opening Filters must not steal focus after the user tabs into a field");
    api.setFiltersOpen(false);
    document.activeElement = element("openFiltersButton");
    api.setFiltersOpen(true);
    timers.shift()();
    assert.equal(document.activeElement, element("closeFiltersButton"), "Initial focus should still enter an opened panel");
    api.setFiltersOpen(false);
    api.setFiltersOpen(true);
    api.setFiltersOpen(false);
    document.activeElement = element("openFiltersButton");
    timers.shift()();
    assert.equal(document.activeElement, element("openFiltersButton"), "Closing before the transition must cancel deferred focus");
    assert.equal(timers.length, 0, "Only one focus check is scheduled per opening");
  } finally {
    rail.contains = originalContains;
    window.setTimeout = originalSetTimeout;
    document.activeElement = originalActiveElement;
  }
}
{
  const oldHref = window.location.href;
  try {
    window.location.href = "https://example.test/tools/catlog-latest.html?release=old&browser-check=test&ref=paper#guide";
    assert.equal(api.viewUrl("stats").href, "https://example.test/tools/catlog-stats.html?ref=paper");
    assert.equal(api.viewUrl("browse").href, "https://example.test/tools/catlog-latest.html?ref=paper");
    window.location.href = "https://example.test/tools/catlog-stats.html";
    assert.equal(api.viewUrl("guide").href, "https://example.test/tools/catlog-latest.html#guide");
    assert.equal(api.viewUrl("browse").href, "https://example.test/tools/catlog-latest.html");
    window.location.href = "file:///tmp/CatLog%20snapshot/index.html?release=old#guide";
    assert.equal(api.viewUrl("stats").href, "file:///tmp/CatLog%20snapshot/index.html#stats");
  } finally { window.location.href = oldHref; }
}
{
  const oldHref = window.location.href;
  const oldQuerySelector = document.querySelector;
  const canonical = makeElement("canonical");
  const shareUrl = makeElement("shareUrl");
  const shareTitle = makeElement("shareTitle");
  const metadata = { 'link[rel="canonical"]': canonical, 'meta[property="og:url"]': shareUrl, 'meta[property="og:title"]': shareTitle };
  try {
    document.querySelector = (selector) => metadata[selector] || oldQuerySelector(selector);
    for (const initial of ["catlog-latest.html", "catlog-stats.html"]) {
      window.location.href = `https://example.test/tools/${initial}?ref=paper&release=old#guide`;
      for (const view of ["stats", "guide", "browse"]) {
        api.renderView(view);
        const url = `https://example.test/tools/catlog-${view === "stats" ? "stats" : "latest"}.html`;
        assert.equal(canonical.getAttribute("href"), url);
        assert.equal(shareUrl.getAttribute("content"), url);
        assert.equal(shareTitle.getAttribute("content"), document.title);
      }
    }
    for (const portableUrl of ["file:///tmp/catlog-stats.html", "https://example.test/export/index.html"]) {
      window.location.href = portableUrl;
      canonical.setAttribute("href", "preserved");
      shareUrl.setAttribute("content", "preserved");
      api.renderView("stats");
      assert.equal(canonical.getAttribute("href"), "preserved", "Portable exports must retain their public metadata");
      assert.equal(shareUrl.getAttribute("content"), "preserved");
    }
  } finally {
    window.location.href = oldHref;
    document.querySelector = oldQuerySelector;
  }
}
api.renderView("stats", { scroll: true });
assert.equal(element("statsView").hidden, false);
assert.equal(element("catalogView").hidden, true);
assert.equal(element("guideView").hidden, true);
assert.equal(element("statsButton").getAttribute("aria-current"), "page");
assert.equal(document.body.classList.contains("stats-open"), true);
assert.equal(document.activeElement, element("statsHeading"));
assert.equal(document.title, "Stats | CatLog");
api.renderView("guide");
assert.equal(element("statsView").hidden, true);
assert.equal(element("guideView").hidden, false);
api.renderView("browse");
assert.equal(element("statsView").hidden, true);
assert.equal(element("catalogView").hidden, false);
assert.equal(element("browseButton").getAttribute("aria-current"), "page");
assert.equal(document.body.classList.contains("stats-open"), false);
assert.equal(document.body.classList.contains("guide-open"), false);
assert.doesNotMatch(indexHtml, /id="snapshotBreakdown"|id="moreCountsButton"/);
const navMarkup = indexHtml.match(/<nav class="top-nav"[^>]*>([\s\S]*?)<\/nav>/)[1];
for (const view of ["browse", "guide", "stats"]) {
  assert.match(navMarkup, new RegExp(`<a id="${view}Button"[^>]*href="#${view}"`));
}
// The catalog's own tabs (Browse, Stats, Guide), then the links out on their own, right of them.
assert.deepEqual([...navMarkup.matchAll(/>(Browse|Guide|Stats)<\//g)].map((match) => match[1]), ["Browse", "Stats", "Guide"]);
const externalNav = indexHtml.match(/<nav class="external-nav" aria-label="Related sites">([\s\S]*?)<\/nav>/)[1];
assert.match(externalNav, /href="https:\/\/doi\.org\/10\.1093\/pnasnexus\/pgag309"[^>]*target="_blank"[^>]*aria-label="CatRange paper \(PNAS Nexus\), opens in a new tab"\s*><span class="nav-external-long">CatRange paper<\/span>/);
assert.match(externalNav, /href="https:\/\/chowdhurylab\.github\.io\/"[^>]*>Chowdhury Lab&nbsp;<span aria-hidden="true">&#8599;<\/span>/);
assert.doesNotMatch(indexHtml, /ChowdhuryLab</);
// Guide: a contents list whose links reach every section; the search help keeps its examples; filtered views are linked
// in the #browse? format the table reads; no images.
const guideHtml = indexHtml.match(/<main id="guideView"[\s\S]*?<\/main>/)[0];
const guideContents = guideHtml.match(/<nav class="guide-contents"[^>]*>([\s\S]*?)<\/nav>/)[1];
const guideAnchors = [...guideContents.matchAll(/href="#(guide-[a-z-]+)"/g)].map((match) => match[1]);
assert.deepEqual(guideAnchors, ["guide-find", "guide-record", "guide-status", "guide-units", "guide-downloads",
  "guide-caveats", "guide-cite", "guide-sources", "guide-questions"]);
for (const anchor of guideAnchors) assert.match(guideHtml, new RegExp(`<section [^>]*id="${anchor}"`), `${anchor} has a section`);
const guideFind = guideHtml.match(/<section [^>]*id="guide-find"[^>]*>([\s\S]*?)<\/section>/)[1];
assert.match(guideFind, /laccase/);
assert.match(guideFind, /href="#browse\?checked=1"/);
for (const [, href] of guideFind.matchAll(/<a href="(#browse[^"]*)"/g)) {
  const params = new URLSearchParams(href.replace(/&amp;/g, "&").slice("#browse?".length));
  assert.ok([...params.keys()].every((key) => ["q", "status", "checked", "ec", "enzyme", "organism", "substrate", "metric",
    "variant", "tmin", "tmax", "phmin", "phmax", "caution", "source", "sort"].includes(key)), `${href} uses the shared keys`);
}
assert.doesNotMatch(guideHtml, /<img/);
assert.match(guideHtml, /class="state-tag human-checked"><svg class="check-icon"/, "Guide shows the human-checked tag as the table does");

assert.equal(api.enzymeFormLabel({ wild_type: true }), "Wild type");
assert.equal(api.enzymeFormLabel({ mutation_signature: "A12G" }), "Variant: A12G");
assert.equal(
  api.enzymeFormLabel({ sequence_variant_status: "variant" }),
  "Variant (unspecified)",
);
assert.match(
  api.enzymeFormHtml({ sequence_variant_status: "variant" }),
  />variant, not specified</,
  "the table marker should identify an unspecified variant",
);
assert.match(api.enzymeFormHtml({ mutation_signature: "D102E", wild_type: false }), /<span class="enzyme-form" title="Variant: D102E">D102E<\/span>/,
  "the table shows the bare mutation");
assert.equal(api.enzymeFormHtml({ wild_type: true }), "", "wild type shows nothing");
assert.equal(api.enzymeFormHtml({}), "", "a record that does not say shows nothing");
assert.equal(api.enzymeFormLabel({}, { showUnknown: true }), "Not recorded");
{
  const originalCreateElement = document.createElement;
  const originalAppendChild = document.body.appendChild;
  const originalSetTimeout = window.setTimeout;
  const originalActiveElement = document.activeElement;
  const target = element("copyTestSequence");
  target.textContent = "MTESTSEQUENCE";
  try {
    document.body.appendChild = () => {};
    for (const mode of ["clipboard", "denied", "fallback", "throws", "unavailable"]) {
      const button = makeElement("copyTestButton");
      button.dataset.copyTarget = target.id;
      let appended = 0;
      let removed = 0;
      let fallbackCalls = 0;
      const timers = [];
      window.setTimeout = (callback) => timers.push(callback);
      navigator.clipboard = mode === "unavailable" ? undefined : {
        writeText: async (value) => {
          assert.equal(value, target.textContent);
          if (mode !== "clipboard") throw new Error("Clipboard blocked");
        },
      };
      document.createElement = (tag) => {
        assert.equal(tag, "textarea");
        appended += 1;
        const input = makeElement(tag);
        input.select = () => { document.activeElement = input; };
        input.remove = () => { removed += 1; };
        return input;
      };
      document.execCommand = (command) => {
        assert.equal(command, "copy");
        fallbackCalls += 1;
        if (mode === "throws") throw new Error("Copy command blocked");
        return mode === "fallback";
      };
      button.focus();
      await api.copyDetailValue(button);
      const success = mode === "clipboard" || mode === "fallback";
      assert.equal(button.textContent, success ? "Copied" : "Copy failed", `${mode}: report the actual clipboard result`);
      assert.equal(fallbackCalls, mode === "clipboard" ? 0 : 1);
      assert.equal(removed, appended, "remove the temporary field even if copying throws");
      assert.equal(document.activeElement, button, "fallback copying should not lose keyboard focus");
      timers.forEach((callback) => callback());
      assert.equal(button.textContent, "Copy");
    }
  } finally {
    document.createElement = originalCreateElement;
    document.body.appendChild = originalAppendChild;
    window.setTimeout = originalSetTimeout;
    document.activeElement = originalActiveElement;
    delete document.execCommand;
    navigator.clipboard = {};
  }
}
const emptyIdentityHtml = api.molecularIdentitySection({}, {});
assert.match(emptyIdentityHtml, /<h3>Protein and structure<\/h3>/);
assert.match(emptyIdentityHtml, /<span>Enzyme form<\/span><strong>Not recorded<\/strong>/);
assert.doesNotMatch(emptyIdentityHtml, /Sequence note/);
const blankFormNoteHtml = api.molecularIdentitySection({}, { sequence_variant_note: "   " });
assert.match(blankFormNoteHtml, /<span>Enzyme form<\/span><strong>Not recorded<\/strong>/);
assert.doesNotMatch(blankFormNoteHtml, /Sequence note/);
const formNoteHtml = api.molecularIdentitySection(
  { sequence_variant_note: "Source says <variant> & unresolved" },
  {},
);
assert.match(formNoteHtml, /<span>Enzyme form<\/span><strong>Not recorded<\/strong>/);
assert.match(
  formNoteHtml,
  /<span>Sequence note<\/span><strong>Source says &lt;variant&gt; &amp; unresolved<\/strong>/,
  "the form note should be visible and HTML-escaped",
);
assert.ok(
  formNoteHtml.indexOf("Enzyme form") < formNoteHtml.indexOf("Sequence note"),
  "the form note should follow the enzyme form",
);
assert.equal(
  api.sequenceSourceLabel("uniprot_accession", 1),
  "UniProt accession",
);
assert.equal(
  api.sequenceSourceLabel("uniprot_ec_organism_unique", 0.6),
  "UniProt accession inferred from EC and organism",
);
assert.equal(
  api.sequenceSourceLabel("uniprot_ec_organism_unique", null),
  "UniProt accession inferred from EC and organism",
);
assert.equal(
  api.sequenceSourceLabel("brenda_getSequence_unique_ec_organism", 0),
  "UniProt accession inferred from BRENDA EC and organism",
);
assert.equal(
  api.sequenceSourceLabel("uniprot_ec_organism_future_method", null),
  "UniProt accession inferred from EC and organism",
);
assert.equal(
  api.identityResolutionLabel({
    identity_resolution_state: "accession_resolved",
    sequence_source: "uniprot_ec_organism_unique",
  }),
  "Accession inferred (EC/organism)",
);
assert.equal(
  api.identityResolutionLabel({
    identity_resolution_state: "accession_resolved",
    sequence_source: "uniprot_accession",
  }),
  "Accession resolved",
);
assert.equal(
  api.identityResolutionLabel({
    identity_resolution_state: "identity_unresolved",
    sequence_source: "uniprot_ec_organism_unique",
  }),
  "Unresolved",
);
const inferredIdentityHtml = api.molecularIdentitySection(
  { primary_uniprot_id: "Q12345", sequence_source: "uniprot_accession", sequence_source_confidence: 1 },
  { sequence_source: "uniprot_ec_organism_unique", sequence_source_confidence: 0.6 },
);
assert.match(inferredIdentityHtml, /UniProt accession inferred from EC and organism/);
assert.doesNotMatch(inferredIdentityHtml, /confidence/);
const missingDetailConfidenceHtml = api.molecularIdentitySection(
  { primary_uniprot_id: "Q12345", sequence_source: "uniprot_accession", sequence_source_confidence: 1 },
  { sequence_source: "uniprot_ec_organism_unique", sequence_source_confidence: null },
);
assert.match(missingDetailConfidenceHtml, /UniProt accession inferred from EC and organism/);
assert.doesNotMatch(missingDetailConfidenceHtml, /confidence/);

function row(overrides = {}) {
  return {
    record_key: "row",
    measurement_key: "measurement",
    review_key: "review",
    verification_status: "verified",
    evidence_confidence_tier: "paper_grounded",
    source_record_count: 1,
    ec_number: "1.1.1.1",
    enzyme_display_name: "Enzyme",
    enzyme_label_source: "source_record",
    organism: "Organism",
    substrate_name: "Substrate",
    mutation_signature: "",
    source_db: "brenda",
    kcat: 1,
    km: 1,
    kcat_over_km: 1,
    kcat_display: "1",
    km_display: "1",
    kcat_over_km_display: "1",
    kcat_unit: "s-1",
    km_unit: "mM",
    kcat_over_km_unit: "mM-1 s-1",
    temperature_display: "25",
    ph_display: "7",
    condition_flags: [],
    has_proof_excerpt: true,
    has_literature_id: true,
    ...overrides,
  };
}

{
  const previous = { records: api.state.records, filtered: api.state.filtered, recordsReady: api.state.recordsReady };
  const summaryRows = [
    row({ verification_status: "verified", kcat: 0, km: null, kcat_over_km: null }),
    row({ verification_status: "corrected", kcat: null, km: 2, kcat_over_km: 3 }),
    row({ verification_status: "manual_review_required", kcat: 4, km: 5, kcat_over_km: null }),
  ];
  api.state.records = summaryRows;
  api.state.recordsReady = true;
  const displayedCounts = (id) => [...element(id).innerHTML.matchAll(/<strong>([\d,]+)<\/strong>/g)]
    .map((match) => Number(match[1].replaceAll(",", "")));
  for (const [filtered, primary, metrics] of [
    [summaryRows, [3, 2], [2, 2, 1]],
    [summaryRows.slice(1), [2, 1], [1, 2, 1]],
    [[], [0, 0], [0, 0, 0]],
  ]) {
    api.state.filtered = filtered;
    api.renderSummary();
    assert.deepEqual(displayedCounts("summaryGrid"), primary, "Record and accepted counts follow filters");
    assert.deepEqual(displayedCounts("snapshotMeta"), metrics, "Coverage counts include zero but exclude missing values");
  }
  Object.assign(api.state, previous);
}

{
  const previous = { records: api.state.records, filtered: api.state.filtered, recordsReady: api.state.recordsReady };
  const previousManifest = { total_rows: runtimeManifest.total_rows, summary: runtimeManifest.summary, enriched_download: runtimeManifest.enriched_download };
  const previousHref = window.location.href;
  const records = [
    row({ proof_kind: "source_note" }),
    row({ verification_status: "corrected", has_proof_excerpt: false, proof_kind: "source_note" }),
    row({ verification_status: "manual_review_required", has_proof_excerpt: false }),
    row({ verification_status: "unverified", has_proof_excerpt: false, has_literature_id: false }),
    row({ public_trust_basis: "identity_only", has_proof_excerpt: false, proof_kind: "source_note", has_literature_id: false }),
    row({ verification_status: "disputed" }),
  ];
  const readBreakdown = () => Object.fromEntries(
    [...element("statsCharts").innerHTML.matchAll(/data-stat-key="([^"]+)" data-count="(\d+)"/g)]
      .map(([, key, count]) => [key, Number(count)]),
  );
  const headings = () => [...element("statsCharts").innerHTML.matchAll(/<h2 id="[^"]+">([^<]+)<\/h2>/g)].map((match) => match[1]);
  window.location.href = "https://example.test/tools/catlog-stats.html";
  api.state.records = records;
  api.state.filtered = records;
  api.state.recordsReady = true;
  runtimeManifest.total_rows = 6;
  runtimeManifest.enriched_download = { sha256: "fixture-download", coverage: { sequence: 4, smiles: 5, wild_type_sequence: 3, variant_sequence: 1 } };
  runtimeManifest.summary = {
    totals: { unique_enzymes: 2, unique_ec_numbers: 3, unique_organisms: 4, unique_substrates: 5 },
    coverage: { with_kcat: 5, with_km: 6, with_kcat_over_km: 2, calculated_kcat_over_km: 1 },
    distributions: {
      verification_status: [
        { label: "verified", count: 2 }, { label: "corrected", count: 1 },
        { label: "manual_review_required", count: 1 }, { label: "unverified", count: 1 }, { label: "disputed", count: 1 },
      ],
      public_trust_basis: [{ label: "identity_only", count: 1 }],
    },
  };
  // An older manifest: no overview. Stats shows what the manifest has, without empty sections.
  api.renderStats();
  assert.deepEqual(readBreakdown(), {
    accepted: 3, manual_review_required: 1, not_verified: 2, unverified: 1, mathematically_inferred: 0, disputed: 1,
    kcat: 5, km: 6, kcat_over_km: 2, sequence: 4, smiles: 5,
  }, "Stats uses the manifest's counts; the three other statuses sit under Other records");
  assert.deepEqual(headings(), ["Review status", "What the records contain", "Main source"]);
  assert.match(element("statsScope").textContent, /All 6 records/);
  assert.doesNotMatch(element("statsTotals").innerHTML, /Human-checked|Papers|CatLog v2/, "No headline without its number");
  assert.match(element("statsTotals").innerHTML, /Enzymes<\/dt><dd>2</);
  let chart = element("statsCharts").innerHTML;
  assert.match(chart, /Source breakdown unavailable/);
  assert.match(chart, /1 accepted records have no PMID or DOI linked/);
  assert.match(chart, /1 kcat\/Km values were calculated as kcat ÷ Km/);
  assert.match(chart, /Wild-type sequence<\/th><td>3/);
  assert.doesNotMatch(chart, /stats-nested-ring|stats-review-ring|not split by field|How these groups differ|Example checks|Fields in these records/,
    "The two-ring chart and its explanations are gone");
  assert.doesNotMatch(chart, /NaN|Infinity|undefined|Not saved|tokens/i);
  // Links open Browse (catlog-latest.html) with the shared #browse? filters.
  assert.match(chart, /href="https:\/\/example\.test\/tools\/catlog-latest\.html#browse\?status=accepted">Accepted<\/a>/);
  assert.match(chart, /#browse\?status=curation_pending">Checks pending<\/a>/);
  assert.match(chart, /#browse\?status=not_verified">Other records<\/a>/);
  assert.match(chart, /#browse\?metric=kcat_over_km"/);
  assert.doesNotMatch(chart, /status=unverified|status=disputed/, "Browse filters the three other statuses together");
  for (const filtered of [records.slice(2, 4), []]) {
    api.state.filtered = filtered;
    api.renderSummary();
    api.renderStats();
    assert.equal(element("statsCharts").innerHTML, chart, "Browse filters never alter Stats denominators or field coverage");
  }

  // With the overview counted from this snapshot's download.
  const overview = {
    source_sha256: runtimeManifest.source_sha256, download_sha256: "fixture-download",
    records: 6, accepted: 3, accepted_as_reported: 2, corrected: 1, from_paper: { records: 2, papers: 1 },
    papers: 5, with_paper: 4, enzymes: 3, ec_numbers: 4, organisms: 2, substrates: 6,
    human_checked_accepted: 1, human_marked: 2,
    ec_classes: [{ class: 1, name: "Oxidoreductases", count: 4, accepted: 2 }, { class: 3, name: "Hydrolases", count: 2, accepted: 1 }],
    ec_class_none: 0, ec_class_multiple: 0,
    top_organisms: [{ name: "Homo sapiens", count: 4 }, { name: "<b>Escherichia</b> coli", count: 2 }],
    top_ec: [{ ec: "1.1.1.1", name: "alcohol dehydrogenase", count: 4 }],
    enzyme_form: { wild: 3, variant: 2, not_stated: 1 },
    conditions: { temperature: 4, ph: 5, both: 3 },
    cautions: { differs: 1, units: 0, unit_missing: 1, temperature: 0, none: 4 },
    metrics: { kcat: { unit: "s^-1", n: 5, median: 4.5, p10: 0.036, p90: 240, log10_start: -2, counts: [1, 0, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0] } },
    sources: { paper: 2, brenda: 3, sabio_rk: 0, oed: 1, uniprot: 0, skid: 0, other: 0 },
  };
  runtimeManifest.summary.overview = overview;
  api.renderStats();
  chart = element("statsCharts").innerHTML;
  const totalsHtml = element("statsTotals").innerHTML;
  for (const [label, value] of [["Human-checked", 1], ["Read from the paper by CatLog", 2], ["Papers", 5], ["Enzymes", 3], ["EC numbers", 4], ["Organisms", 2], ["Substrates", 6]]) {
    assert.match(totalsHtml, new RegExp(`${label.replace(/[()]/g, "\\$&")}</dt><dd>${value}`));
  }
  assert.match(totalsHtml, /from 1 papers/);
  assert.deepEqual(headings(), ["Review status", "Read from the paper by CatLog", "Human review", "What the records contain", "Enzyme classes",
    "Most common organisms", "Most common EC numbers", "Value ranges", "Wild type and variants", "Cautions", "Main source"]);
  assert.ok(chart.includes("Read from the paper by an AI model; a second, separate AI check compared each value with the paper."));
  assert.match(chart, /#browse\?source=paper">Browse these records/);
  assert.match(chart, /#browse\?checked=1">Browse these records/);
  assert.match(chart, /#browse\?ec=1\.">EC 1/);
  assert.match(chart, /#browse\?ec=1\.1\.1\.1"/);
  assert.match(chart, /#browse\?organism=Homo\+sapiens"><i>Homo sapiens<\/i>/);
  assert.match(chart, /&lt;b&gt;Escherichia&lt;\/b&gt; coli/, "Names from the data are escaped");
  assert.match(chart, /#browse\?variant=wild">Wild type/);
  assert.match(chart, /#browse\?caution=differs"/);
  assert.match(chart, /#browse\?caution=none">No cautions/);
  assert.match(chart, /#browse\?source=paper">Read from papers/);
  assert.doesNotMatch(chart, /source=other/, "Other has no single Browse filter");
  assert.doesNotMatch(chart, /from earlier paper extractions/, "every paper record here was read by CatLog");
  assert.doesNotMatch(chart + element("statsTotals").innerHTML, /CatLog v2/, "The version name is never public");
  const breakdown = readBreakdown();
  assert.equal(breakdown.wild + breakdown.variant + breakdown.not_stated, 6);
  assert.equal(breakdown.source_paper + breakdown.source_brenda + breakdown.source_oed, 6);
  assert.equal(breakdown.temperature, 4);
  assert.equal(breakdown.ph, 5);
  assert.match(chart, /3 records give both temperature and pH/);
  assert.match(chart, /data-stat-key="ec_1" data-count="4"[\s\S]*?2<span class="visually-hidden"> accepted/);
  assert.equal((chart.match(/<figure class="stats-range"/g) || []).length, 1, "Only metrics with a usable summary get a histogram");
  assert.match(chart, /aria-label="kcat: median 4\.5 s⁻¹; 10% of values are below 0\.036 and 10% above 240; 5 values\."/);
  assert.equal((chart.match(/class="stats-histogram-bars">/g) || []).length, 1);
  assert.match(chart, /How these numbers are counted/);
  assert.doesNotMatch(chart, /NaN|Infinity|undefined/);

  // A histogram that does not add up is not drawn.
  assert.equal(api.statsValueRange({ key: "km", html: "Km", unit: "mM" }, { n: 3, median: 1, p10: 1, p90: 1, log10_start: 0, counts: [1, 1] }), "");
  assert.equal(api.statsValueRange({ key: "km", html: "Km", unit: "mM" }, { n: 2, median: 2, p10: 3, p90: 4, log10_start: 0, counts: [1, 1] }), "");
  assert.equal(api.statsValueRange({ key: "km", html: "Km", unit: "mM" }, null), "");
  const range = api.statsValueRange({ key: "km", html: "Km", unit: "mM" }, { n: 4, median: 0.5, p10: 0.01, p90: 50, log10_start: -3, counts: [1, 0, 0, 2, 0, 1] });
  assert.match(range, /data-metric="km" data-count="4"/);
  assert.match(range, /style="height:50%"/);
  assert.match(range, /<i style="left:[\d.]+%"><\/i>/);

  // An overview from another download, or with another record count, is not used.
  runtimeManifest.summary.overview = { ...overview, download_sha256: "other-download" };
  api.renderStats();
  assert.doesNotMatch(element("statsTotals").innerHTML, /Human-checked/);
  assert.equal(api.statsOverview(6), null);
  runtimeManifest.summary.overview = { ...overview, records: 7 };
  assert.equal(api.statsOverview(6), null);
  runtimeManifest.summary.overview = { ...overview, enzyme_form: { wild: 3, variant: 2, not_stated: 2 } };
  api.renderStats();
  assert.doesNotMatch(element("statsCharts").innerHTML, /Wild type and variants/, "Forms that do not add up to the records are not drawn");
  runtimeManifest.summary.overview = overview;

  // Bars, shares and links.
  const halfBar = api.statsBarRows([{ value: "example", label: "Example", count: 3 }], 6);
  assert.match(halfBar, /width:50%/);
  assert.match(halfBar, /50\.0%/);
  assert.match(api.statsBarRows([{ value: "test", label: "<unsafe>", count: 0 }], 0), /width:0%/);
  assert.doesNotMatch(api.statsBarRows([{ value: "test", label: "<unsafe>", count: 0 }], 0), /<unsafe>/);
  assert.equal(api.statsShare(8, 156431), "<0.1%", "A real nonzero outcome must never look like zero");
  assert.equal(api.statsShare(0, 156431), "0.0%");
  assert.equal(api.statsShare(0, 0), "—");
  assert.equal(api.statsBrowseHref({ ec: "1." }), "https://example.test/tools/catlog-latest.html#browse?ec=1.");
  window.location.href = "file:///tmp/CatLog%20snapshot/index.html?release=old#stats";
  assert.equal(api.statsBrowseHref({ checked: "1" }), "file:///tmp/CatLog%20snapshot/index.html#browse?checked=1", "A portable copy links within itself");
  window.location.href = "https://example.test/tools/catlog-stats.html";

  // The fields of records that are not accepted: only the hash-bound group counts, in a plain table.
  runtimeManifest.summary.review_details = {
    source_sha256: runtimeManifest.source_sha256, download_sha256: runtimeManifest.enriched_download.sha256,
    groups: { unverified: { total: 1, with_kinetic_value: 1, with_literature_id: 0, with_sequence: 0, with_smiles: 1,
      material: { paper_excerpt: 0, source_note: 0, paper_id: 0, database_record: 1 },
      field_combinations: [{missing: ["sequence", "paper_id"], count: 1}] } },
  };
  assert.equal(api.statsCohortData("unverified", 1).with_smiles, 1);
  assert.equal(api.statsCohortData("unverified", 2), null, "Exact cohort denominator required");
  const unaccepted = api.statsUnacceptedFields({ unverified: 1, manual_review_required: 1 });
  assert.match(unaccepted, /<th scope="col">Unverified<small>1<\/small><\/th>/);
  assert.doesNotMatch(unaccepted, /Checks pending/, "A group without its own counts gets no column");
  assert.match(unaccepted, /<tr data-field="with_smiles"><th scope="row">Substrate SMILES<\/th><td data-cohort="unverified" data-count="1">1<small>100\.0%<\/small>/);
  assert.match(unaccepted, /does not give the reason for a status/);
  runtimeManifest.summary.review_details.groups.unverified.material.paper_id = 1;
  assert.equal(api.statsCohortData("unverified", 1), null, "Material must be an exclusive whole-cohort partition");
  assert.equal(api.statsUnacceptedFields({ unverified: 1 }), "");
  runtimeManifest.summary.review_details.groups.unverified.material.paper_id = 0;
  runtimeManifest.summary.review_details.download_sha256 = "wrong";
  assert.equal(api.statsCohortData("unverified", 1), null, "Exact frozen download required");
  const prepared = row({verification_status: "mathematically_inferred"});
  assert.equal(api.rowStatusLabel(prepared), "Not checked");
  assert.equal(api.rowStatusLabel(prepared, { exact: true }), "Not checked (Not reviewed)", "the record names the exact earlier value");
  assert.equal(api.rowStatusLabel(row({ verification_status: "unverified" }), { exact: true }), "Not checked (Unverified)");
  assert.equal(api.rowStatusLabel(row({ verification_status: "manual_review_required" })), "Not confirmed");
  assert.equal(api.rowStatusLabel(row({ verification_status: "disputed" })), "Disputed");
  assert.equal(api.rowStatusLabel(row({ verification_status: "corrected" }), { exact: true }), "Accepted");
  // The badge: review result and tags as its accessible name; the meaning (never the full method) in its title.
  const badge = api.statusBadge(row({ verification_status: "corrected" }));
  assert.match(badge, /aria-label="Accepted, BRENDA, corrected"/);
  assert.match(badge, /title="Accepted by the earlier automated review after a correction\."/);
  assert.match(api.statusBadge(prepared), /class="state-badge unresolved"[^>]*title="Not checked \(Not reviewed\): A database record without a PMID or DOI that was never reviewed\."[^>]*aria-label="Not checked, BRENDA"/);
  assert.match(api.statusBadge(row({ verification_status: "disputed" })), /class="state-badge disputed"[^>]*>.*Disputed</);
  const paperBadge = api.statusBadge(row({ source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name" }));
  assert.match(paperBadge, /title="Read from the paper by an AI model; a second, separate AI check compared each value with the paper\." aria-label="Accepted, from paper"/);
  assert.doesNotMatch(paperBadge, /independent|run\b|code converted/);
  assert.equal(api.reviewOutcome(prepared), "Not checked: taken from the source database as listed.");
  // An older record's review says it was the earlier automated review, and what it found.
  for (const [status, sentence] of [
    ["corrected", "Corrected and accepted in the earlier automated review (the value before correction was not kept)."],
    ["verified", "Accepted as printed, in the earlier automated review."],
    ["manual_review_required", "Not confirmed: the earlier automated review left a question open on the value, protein or substrate."],
    ["unverified", "Not checked: the earlier automated review recorded no final check."],
    ["disputed", "Disputed in the earlier automated review; not accepted (no reason recorded)."],
  ]) assert.equal(api.reviewOutcome(row({ verification_status: status })), sentence);
  assert.equal(api.reviewOutcome(row({ verification_status: "verified", public_trust_basis: "identity_only" })),
    "Accepted as listed by the source database; no paper is cited, so the value cannot be traced to a paper.");

  // An unfamiliar status is listed, not dropped; a merged source counts under each source it names, as Browse finds it.
  delete runtimeManifest.summary.review_details;
  delete runtimeManifest.summary.overview;
  runtimeManifest.summary.distributions.verification_status.push({ label: "future_status", count: 1 });
  api.renderStats();
  assert.equal(readBreakdown().other_status, 1, "An unfamiliar outcome must not disappear");
  assert.equal(readBreakdown().not_verified, 3);
  api.state.recordsReady = false;
  runtimeManifest.total_rows = 4;
  runtimeManifest.summary = { distributions: {
    verification_status: [
      { label: "verified", count: 1 }, { label: "corrected", count: 1 },
      { label: "manual_review_required", count: 1 }, { label: "disputed", count: 1 },
    ],
  } };
  api.renderStats();
  assert.deepEqual(readBreakdown(), {
    accepted: 2, manual_review_required: 1, not_verified: 1, unverified: 0, mathematically_inferred: 0, disputed: 1, sequence: 4,
  }, "Stats works before the index arrives; a count above the total is not drawn");
  runtimeManifest.summary.distributions.source_db = [
    { label: "brenda", count: 2 }, { label: "sabio_rk", count: 1 }, { label: "brenda;uniprot", count: 1 },
  ];
  api.renderStats();
  assert.equal(readBreakdown().source_brenda, 3, "A multi-source record counts under BRENDA, as source=brenda finds it");
  assert.equal(readBreakdown().source_sabio_rk, 1);
  assert.equal(readBreakdown().source_uniprot, 1);
  assert.equal(readBreakdown().source_other, undefined, "Every record names a known source");
  Object.assign(api.state, previous);
  Object.assign(runtimeManifest, previousManifest);
  window.location.href = previousHref;
}

const kiMeasurementHtml = api.measurementSection(row(), {
  has_ki: true,
  ki_display: "0.25",
  ki_unit: "µM",
});
assert.match(kiMeasurementHtml, /class="measurement-strip has-ki"/);
assert.match(kiMeasurementHtml, /<i>K<\/i><sub>i<\/sub>/);
assert.match(kiMeasurementHtml, /<strong>0\.25<\/strong>/);
assert.match(kiMeasurementHtml, /<small>µM<\/small>/);

const noKiMeasurementHtml = api.measurementSection(row({ has_ki: false }), {});
assert.doesNotMatch(noKiMeasurementHtml, /class="measurement-strip has-ki"/);
assert.doesNotMatch(noKiMeasurementHtml, /<i>K<\/i><sub>i<\/sub>/);

// Record panel: one number style; a quotient CatLog works out keeps its inputs' significant figures.
assert.equal(api.numberText("8.5"), "8.5");
assert.equal(api.numberText("6.004e+7"), "6.004 × 10⁷");
assert.equal(api.numberText(5038.4615, { figures: 2 }), "5.0 × 10³");
assert.equal(api.numberText(8.5 / 320, { figures: 2 }), "0.027");
// The table rounds a calculated kcat/Km the same way (197 ÷ 2 × 10⁻⁵ is 9.9 × 10⁶, not 9.85 × 10⁶); a printed one keeps its digits.
{
  const calculated = row({ kcat: 197, km: 2e-5, kcat_over_km: 9.85e6, kcat_display: "197", km_display: "2e-05",
    kcat_over_km_display: "9.85e+6", kcat_over_km_origin: "calculated", kcat_over_km_unit: "s^(-1)*mM^(-1)" });
  const tableCell = api.metricDisplayWithUnitHtml(calculated, "kcat_over_km", { table: true });
  assert.match(tableCell, /9\.9/);
  assert.doesNotMatch(tableCell, /9\.85/);
  const printed = api.metricDisplayWithUnitHtml({ ...calculated, kcat_over_km_origin: "printed" }, "kcat_over_km", { table: true });
  assert.match(printed, /9\.85/);
}
// The display rule: at most 4 significant figures, 3 for a ÷60 artefact, never fewer than the integer digits; printed
// digits up to 4 (and their trailing zeros) stay as stored.
assert.deepEqual(["30.333", "5.1667", "0.0516667", "12345.6", "1234.56", "11.579", "135.0", "0.030", "2.8", "123000", "1.23456e+7"]
  .map((value) => api.roundingFigures(value)), [3, 3, 3, 5, 4, 4, 0, 0, 0, 0, 4]);
{
  const shown = (fields) => api.metricDisplayWithUnitHtml(row({ kcat_unit: "s^(-1)", km_unit: "mM", kcat_over_km_unit: "s^(-1)*mM^(-1)",
    kcat_over_km_origin: "paper_reported", ...fields }), Object.keys(fields)[0].replace(/_display$/, ""), { table: true });
  assert.equal(shown({ kcat_display: "30.333" }), "30.3", "a ÷60 artefact shows 3 figures");
  assert.equal(shown({ kcat_display: "5.1667" }), "5.17");
  assert.equal(shown({ kcat_display: "135.0" }), "135.0", "printed trailing zeros stay");
  assert.equal(shown({ km_display: "0.02828" }), "0.02828");
  assert.equal(shown({ km_display: "17.8894" }), "17.89");
  assert.match(shown({ kcat_display: "1.23456e+7" }), /1\.235 &times; 10<sup>7<\/sup>/);
  // The record's value strip follows the rule; the tooltip keeps the stored digits.
  assert.equal(api.panelValueHtml(row({ kcat_display: "30.333" }), "kcat"), "30.3");
  // An earlier-catalog kcat/Km of unstated origin that equals kcat ÷ Km is shown and tagged as calculated; a printed one is not.
  const quotientRow = row({ kcat_display: "2.2", km_display: "0.19", kcat_over_km_display: "11.579", kcat: 2.2, km: 0.19, kcat_over_km: 11.579,
    kcat_unit: "s^(-1)", km_unit: "mM", kcat_over_km_unit: "s^(-1)*mM^(-1)", kcat_over_km_origin: "not_specified" });
  assert.equal(api.metricDisplayWithUnitHtml(quotientRow, "kcat_over_km", { table: true }), "12");
  assert.match(api.efficiencyOriginHtml(quotientRow, { short: true }), /title="Equals kcat ÷ Km; the source does not say whether it was printed or calculated\.[^"]*">calc\.</);
  const printedRow = { ...quotientRow, kcat_over_km_origin: "paper_reported" };
  assert.equal(api.metricDisplayWithUnitHtml(printedRow, "kcat_over_km", { table: true }), "11.58");
  assert.equal(api.efficiencyOriginHtml(printedRow, { short: true }), "");
  const fromPaperRow = { ...quotientRow, source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name" };
  assert.equal(api.efficiencyOriginHtml(fromPaperRow, { short: true }), "", "a value read from the paper is never called calculated");
}
assert.equal(api.printedValueText("0.002", "10^6 M^-1 min^-1"), "0.002 × 10^6 M^-1 min^-1");
assert.equal(api.printedValueText("320", "mM"), "320 mM");
// A flag is said once: a marker button on the value and one note under the values, no second list.
const flaggedHtml = api.measurementSection(row({
  kcat: 8.5, km: 320, kcat_over_km: 0.033, kcat_display: "8.5", km_display: "320", kcat_over_km_display: "0.033",
  condition_flags: ["kcat_over_km_quotient_mismatch"],
}), {});
assert.match(flaggedHtml, /<button class="value-flag" type="button" data-flag-note="detailFlagNote1"/);
assert.match(flaggedHtml, /<li id="detailFlagNote1"[^>]*>.*The source&#39;s kcat\/Km \(0\.033 mM-1 s-1\) is 1\.2-fold above kcat ÷ Km \(0\.027 mM-1 s-1\)\. All three are stored as the source lists them\./);
assert.match(flaggedHtml, /aria-label="kcat\/Km: kcat\/Km mismatch\. Show the note\."/);
assert.doesNotMatch(flaggedHtml, /Check against source|condition-flag|often means|check the unit/);
// The table's "!" states the problem in its tooltip (no order to check), its short words on phones.
{
  const flagged = row({ kcat: 8.5, km: 320, kcat_over_km: 0.033, kcat_display: "8.5", km_display: "320", kcat_over_km_display: "0.033",
    condition_flags: ["kcat_over_km_quotient_mismatch"] });
  const marker = api.valueFlagBadgeHtml(api.conditionFlags(flagged), "kcat_over_km", flagged);
  assert.match(marker, /title="The source&#39;s kcat\/Km \(0\.033 mM-1 s-1\) is 1\.2-fold above kcat ÷ Km/);
  assert.match(marker, /<span class="visually-hidden">kcat\/Km mismatch<\/span>/);
  assert.doesNotMatch(marker, /Check against source/);
}
// A record read from the paper whose kcat/Km is a unit factor off: the printed numbers' own arithmetic says what agrees.
{
  const fromPaperRow = row({ source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name",
    kcat: 10.7, km: 0.00037, kcat_over_km: 28.9, kcat_display: "10.7", km_display: "0.00037", kcat_over_km_display: "28.9",
    kcat_unit: "s^(-1)", km_unit: "mM", kcat_over_km_unit: "s^(-1)*mM^(-1)", condition_flags: ["kcat_over_km_unit_mismatch"] });
  const html = api.measurementSection(fromPaperRow, { proof_lines: [
    { metric: "Km", raw_value: "0.37 ± 0.01", raw_unit: "µM" },
    { metric: "kcat", raw_value: "10.7 ± 0.0", raw_unit: "s−1" },
    { metric: "kcat/Km", raw_value: "28.9", raw_unit: "mM−1 · s−1" },
  ] });
  assert.ok(html.includes("Printed kcat/Km (28.9 s⁻¹ mM⁻¹) is 1,001-fold below kcat ÷ Km (2.9 × 10⁴ s⁻¹ mM⁻¹). "
    + "The factor is close to 1000, the factor between per mM and per M. "
    + "The printed numbers agree (10.7 ÷ 0.37 = 28.9) only if Km and kcat/Km share one concentration unit. "
    + "All three are stored as the paper gives them."), html);
  assert.match(html, /aria-label="kcat\/Km: possible 1000× unit error\. Show the note\."/);
}
// A magnitude caution names the bound the value passes.
{
  const low = api.measurementSection(row({ km: 1e-14, km_display: "1e-14", condition_flags: ["km_magnitude_needs_check"] }), {});
  assert.match(low, /Km is below 1 nM; the unit may be wrong\./);
  assert.match(low, /aria-label="Km: Km &lt; 1 nM\. Show the note\."/);
  const high = api.measurementSection(row({ kcat: 7e12, kcat_display: "7e+12", condition_flags: ["kcat_magnitude_needs_check"] }), {});
  assert.match(high, /kcat is above 10⁸ s⁻¹; the unit may be wrong\./);
}
// An older record's kcat/Km off by a unit factor shows the source's own value that agrees with kcat ÷ Km.
const unitFlagHtml = api.measurementSection(row({
  kcat: 22.6, km: 0.35, kcat_over_km: 64000, kcat_display: "22.6", km_display: "0.35", kcat_over_km_display: "64000",
  condition_flags: ["kcat_over_km_unit_mismatch"], kcat_over_km_source_differs: true,
}), { source_kcat_over_km_values: [{ value: 64, unit: "s^(-1)*mM^(-1)", source_db: "oed" }] });
assert.match(unitFlagHtml, /<strong>64<button class="value-flag"/);
assert.match(unitFlagHtml, /The stored kcat\/Km \(64000 mM-1 s-1\) is 991-fold above kcat ÷ Km \(65 mM-1 s-1\)\. The source&#39;s own kcat\/Km, 64 mM-1 s-1 \(listed above\), agrees with kcat ÷ Km and is shown above\. The factor is close to 1000, the factor between per mM and per M\./);
// v2 conditions: labelled lines; a pH or temperature already shown and per-value qualifiers are not repeated.
const lines = api.conditionLines("pH 7.5; 298.15 K; apparent kcat; apparent Km; cosubstrate NAD+; preparation: purified", row({ ph_display: "7.5", temperature_display: "25" }));
assert.match(lines.cosubstrate, /<span>Cosubstrate<\/span><strong>NAD\+<\/strong>/);
assert.match(lines.conditions, /<span>Conditions<\/span><strong>apparent kcat, Km<\/strong>/);
assert.match(lines.preparation, /<strong>purified<\/strong>/);

// Exporter-produced flagged conditions are withheld, with the reason still visible.
const withheldConditions = row({
  temperature_k: null,
  temperature_display: "n/a",
  ph: null,
  ph_display: null,
  condition_flags: ["temperature_zero_celsius_needs_check", "ph_outside_0_14"],
});
const withheldConditionsBefore = structuredClone(withheldConditions);
const withheldMeasurementHtml = api.measurementSection(withheldConditions, {
  temperature_k: null,
  ph: null,
  condition_flags: withheldConditions.condition_flags,
});
assert.match(withheldMeasurementHtml, /Temperature recorded as exactly 0 °C; may stand for a missing value/);
assert.match(withheldMeasurementHtml, /pH outside 0–14/);
assert.ok(withheldMeasurementHtml.includes("<span>Temperature</span><strong>—</strong>"));
assert.ok(withheldMeasurementHtml.includes("<span>pH</span><strong>—</strong>"));
assert.doesNotMatch(withheldMeasurementHtml, /\(stored\)|null|undefined/);
assert.deepEqual(withheldConditions, withheldConditionsBefore);

const mergedPageRecord = api.publicSummaryRecord({
  paper_grounding_status: "detail-only",
  ki: 0.25,
  source_license: "detail license",
  ...row({ sequence_resolved: true }),
});
assert.equal(mergedPageRecord.paper_grounding_status, "detail-only");
assert.equal(mergedPageRecord.ki, 0.25);
assert.equal(mergedPageRecord.source_license, "detail license");
assert.equal(mergedPageRecord.sequence_resolved, true);
assert.equal(api.sourceLicense({}, { source_license: "detail license" }), "detail license");
assert.equal(api.sourceLicense({ source_license: "summary license" }, {}), "summary license");

const licenseNote = "Source licenses are recorded in source_license; merged records may list multiple licenses. Check those terms before reuse.";
const mixedSourceLicenses = "CC BY 4.0; CC BY-NC-ND 4.0";
const pageLicenseShard = "data/details-page-license.js";
const pageLicenseRows = [
  row({ record_key: "page-mixed", detail_shard: pageLicenseShard, source_license: "CC BY 4.0" }),
  row({ record_key: "page-summary-fallback", detail_shard: pageLicenseShard, source_license: "CC BY 4.0" }),
  row({ record_key: "page-empty-summary", detail_shard: pageLicenseShard, source_license: "" }),
  row({ record_key: "page-missing-license", detail_shard: pageLicenseShard }),
];
window.CATLOG_DETAIL_SHARDS[pageLicenseShard] = {
  "page-mixed": { source_license: mixedSourceLicenses },
  "page-summary-fallback": {},
  "page-empty-summary": { source_license: "CC BY-NC-ND 4.0" },
  "page-missing-license": {},
};
api.state.loadedScripts.add(pageLicenseShard);
api.state.filtered = pageLicenseRows;
api.state.page = 1;
api.state.pageSize = 25;
api.state.recordsReady = true;
api.state.pageDownloadPending = false;
element("downloadPageButton").disabled = false;
const pageDownloadCount = capturedDownloads.length;
await api.handlePageDownload();
assert.equal(capturedDownloads.length, pageDownloadCount + 1);
const pageDownload = capturedDownloads.at(-1);
assert.ok(pageDownload.blob, "page download should create a JSON Blob");
const pagePayload = JSON.parse(await pageDownload.blob.text());
assert.equal(pagePayload.metadata.license_note, licenseNote);
assert.equal(pagePayload.metadata.row_count, 4);
const pageRecordsByKey = Object.fromEntries(
  pagePayload.records.map((record) => [record.record_key, record]),
);
assert.equal(pageRecordsByKey["page-mixed"].source_license, mixedSourceLicenses);
assert.equal(pageRecordsByKey["page-summary-fallback"].source_license, "CC BY 4.0");
assert.equal(pageRecordsByKey["page-empty-summary"].source_license, "CC BY-NC-ND 4.0");
assert.equal(pageRecordsByKey["page-missing-license"].source_license, null);

// R15: keep the first DOI spelling, collapse case variants, and retain
// genuinely different identifiers in their original order.
const doiCaseVariants = ["10.1128/AEM.03151-20", "10.1128/aem.03151-20"];
api.renderDetail(row({ record_key: "doi-case-duplicates" }), {
  supporting_dois: doiCaseVariants,
});
let referenceHtml = element("detailContent").innerHTML;
assert.equal((referenceHtml.match(/href="https:\/\/doi.org\//g) || []).length, 1);
assert.ok(referenceHtml.includes('href="https://doi.org/10.1128/AEM.03151-20"'));
assert.match(referenceHtml, /<span>DOI<\/span>/);
assert.doesNotMatch(referenceHtml, /<span>DOIs<\/span>/);
assert.deepEqual(doiCaseVariants, ["10.1128/AEM.03151-20", "10.1128/aem.03151-20"]);

api.renderDetail(row({ record_key: "doi-distinct-references" }), {
  supporting_dois: [...doiCaseVariants, "10.1000/Second", "10.1000/second"],
});
referenceHtml = element("detailContent").innerHTML;
const doiHrefs = [...referenceHtml.matchAll(/href="(https:\/\/doi.org\/[^\"]+)"/g)].map(match => match[1]);
assert.deepEqual(doiHrefs, ["https://doi.org/10.1128/AEM.03151-20", "https://doi.org/10.1000/Second"]);
assert.match(referenceHtml, /<span>DOIs<\/span>/);

// A stand-in paper ID (a paper without a PMID) is shown as text, never as a PubMed link; the e-mail names the DOI.
api.renderDetail(row({ record_key: "stand-in-paper" }), {
  pubmed_id: "NP1a2b3c4d",
  supporting_pmids: ["NP1a2b3c4d"],
  supporting_dois: ["10.1000/standin"],
});
referenceHtml = element("detailContent").innerHTML;
assert.doesNotMatch(referenceHtml, /pubmed\.ncbi\.nlm\.nih\.gov\/NP/);
assert.match(referenceHtml, /<span>Paper ID<\/span><strong>NP1a2b3c4d \(no PMID\)<\/strong>/);
assert.match(decodeURIComponent(referenceHtml.match(/id="reportRecordProblem" class="button secondary" href="([^"]+)"/)[1]), /DOI 10\.1000\/standin, paper NP1a2b3c4d/);
// An EC or organism stated nowhere says which of the two is unknown; a record without values says so.
api.renderDetail(row({ record_key: "unknowns", ec_number: "Unknown", organism: "Unknown", kcat: null, km: null, kcat_over_km: null,
  kcat_display: "Not reported", km_display: "Not reported", kcat_over_km_display: "Not reported" }), {});
referenceHtml = element("detailContent").innerHTML;
assert.match(referenceHtml, /<p class="detail-subtitle">EC unknown &middot; organism unknown<\/p>/);
assert.match(referenceHtml, /No kcat, Km or kcat\/Km is stored for this record\./);
assert.match(referenceHtml, /<span>SMILES<\/span><strong>None recorded<\/strong>/);
assert.doesNotMatch(referenceHtml, /undefined|NaN|null/);
// The record: name; EC, organism and variant; substrate; status. Then Measurement (with the values as printed),
// Assay conditions, Paper and review, Protein and structure, Source details.
{
  const v2Summary = row({ record_key: "v2-structure", measurement_key: "v2-structure", source_db: "primary_paper_direct",
    enzyme_label_source: "explicit_enzyme_name", ec_number: "1.4.1.20", organism: "Bacillus sphaericus",
    substrate_name: "3-phenyl-2-oxopropanoate", mutation_signature: "N145A", wild_type: false });
  api.renderDetail(v2Summary, {
    verification_method: "catlog_v2_read_and_independent_verify",
    supporting_pmids: ["12234181"],
    proof_lines: [
      { metric: "kcat", table_label: "Table 2", printed: "68 s^-1", check: "confirmed", conversion: "", normalized_value: 68, normalized_unit: "s^(-1)" },
      { metric: "Km", table_label: "Table 2", printed: "1.1 mM", check: "confirmed", conversion: "", normalized_value: 1.1, normalized_unit: "mM" },
    ],
  });
  const html = element("detailContent").innerHTML;
  assert.match(html, /<p class="detail-subtitle">EC 1\.4\.1\.20 &middot; Bacillus sphaericus &middot; N145A variant<\/p>/);
  assert.match(html, /<p class="detail-substrate"><span>Substrate:<\/span> <span class="detail-substrate-name">3-phenyl-2-oxopropanoate<\/span><\/p>/);
  assert.match(html, /<span class="detail-status-word">Accepted<\/span><span>from paper<\/span>/);
  const order = ["<h3>Measurement</h3>", "<h4>As printed in the paper (Table 2)</h4>", "<h3>Assay conditions</h3>",
    "<h3>Paper and review</h3>", "<h3>Protein and structure</h3>", "<summary>Source details</summary>", 'id="downloadSelectedJson"'];
  const positions = order.map((part) => html.indexOf(part));
  assert.ok(positions.every((position) => position >= 0), `every part is drawn: ${positions}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "the parts come in the record's order");
  assert.match(html, /<th scope="col">As printed<\/th><th scope="col">In catalog units<\/th><\/tr>/);
  // A long substrate name is cut short in the header and given in full under Assay conditions.
  const longName = `${"2-deoxy-3-O-[(3R)-3-hydroxytetradecanoyl]-".repeat(3)}glucose`;
  api.renderDetail(row({ record_key: "long-substrate", substrate_name: longName }), {});
  assert.match(element("detailContent").innerHTML, new RegExp(`<span>Substrate</span><strong>${longName.replace(/[[\]()]/g, "\\$&")}</strong>`));
  api.renderDetail(row({ record_key: "short-substrate" }), {});
  assert.doesNotMatch(element("detailContent").innerHTML, /<span>Substrate<\/span>/);
  // The status line names the result and the source as the table does (one helper); Not checked keeps the earlier
  // status in brackets.
  api.renderDetail(row({ record_key: "status-words", verification_status: "mathematically_inferred", source_db: "skid" }), {});
  assert.match(element("detailContent").innerHTML, /<span class="detail-status-word">Not checked \(Not reviewed\)<\/span><span>SKiD<\/span>/);
  api.renderDetail(row({ record_key: "status-words-2", verification_status: "manual_review_required", source_db: "sabio_rk;brenda" }), {});
  assert.match(element("detailContent").innerHTML, /<span class="detail-status-word">Not confirmed<\/span><span>BRENDA, SABIO-RK<\/span>/);
  api.renderDetail(row({ record_key: "status-words-3", verification_status: "unverified", source_db: "unknown" }), {});
  assert.match(element("detailContent").innerHTML, /<span class="detail-status-word">Not checked \(Unverified\)<\/span><span>source not recorded<\/span>/);
}
// A record read by CatLog: Method (with "values stored as printed" when code converted nothing) and Check; the EC the
// paper does not print is said in the header. Badges are named by their words, not the method sentence.
{
  const v2Summary = row({ record_key: "v2-method", measurement_key: "v2-method", source_db: "primary_paper_direct",
    enzyme_label_source: "explicit_enzyme_name", ec_number: "2.3.1.183" });
  const line = (metric, conversion, check = "confirmed") => ({ metric, table_label: "Table 2", printed: "1", check, conversion });
  api.renderDetail(v2Summary, { verification_method: "catlog_v2_read_and_independent_verify; ec_from_databases",
    proof_lines: [line("kcat", ""), line("Km", "")] });
  let html = element("detailContent").innerHTML;
  assert.match(html, /<span>Method<\/span><strong>Read from the paper by an AI model; a second, separate AI check compared each value with the paper; values stored as printed\. <a class="method-link" href="#guide-method">How CatLog reads papers →<\/a><\/strong>/);
  assert.match(html, /<span>Check<\/span><strong>All values confirmed\.<\/strong>/);
  assert.match(html, /<p class="detail-subtitle">EC 2\.3\.1\.183 \(from enzyme databases; not printed in the paper\) &middot; Organism<\/p>/);
  assert.doesNotMatch(html, /<span>Review<\/span>|second, separate AI run|independent/);
  api.renderDetail(v2Summary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [line("kcat", "converted by code"), line("Km", "", "corrected: unit used for the conversion (was none, now mM)")] });
  html = element("detailContent").innerHTML;
  assert.match(html, /compared each value with the paper; units converted by code\./);
  assert.match(html, /<span>Check<\/span><strong>The results differ by value: see the AI check column under the values\.<\/strong>/);
  assert.match(html, /<th scope="col">AI check<\/th>/);
  assert.match(html, /<p class="detail-subtitle">EC 2\.3\.1\.183 &middot; Organism<\/p>/);
  const badge = api.statusBadge(v2Summary);
  assert.match(badge, /aria-label="Accepted, from paper"/);
  assert.match(badge, /title="Read from the paper by an AI model; a second, separate AI check compared each value with the paper\."/);
  assert.match(api.statusBadge(row({ verification_status: "corrected" })), /aria-label="Accepted, BRENDA, corrected"/);
}
// An AI audit: the date and the verdict, from the audit fields or from the check's older suffix (never the word
// "independent"); values audited differently are named.
{
  const v2Summary = row({ record_key: "v2-audit", measurement_key: "v2-audit", source_db: "primary_paper_direct",
    enzyme_label_source: "explicit_enzyme_name" });
  const line = (metric, extra = {}) => ({ metric, table_label: "Table 2", printed: "1", check: "confirmed", conversion: "", ...extra });
  api.renderDetail(v2Summary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [line("kcat", { audit_date: "2026-10-11", audit_result: "kept" }), line("Km", { audit_date: "2026-10-11", audit_result: "kept" })] });
  let html = element("detailContent").innerHTML;
  assert.match(html, /<span>Check<\/span><strong>All values confirmed\.<\/strong><\/div><div class="kv-line"><span>AI audit<\/span><strong>11 Oct 2026: re-checked against the paper and kept\.<\/strong>/);
  api.renderDetail(v2Summary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [line("kcat", { check: "confirmed; re-checked in an independent audit (2026-10-11)" }),
      line("Km", { check: "confirmed; unit corrected in an independent audit (2026-10-11)" })] });
  html = element("detailContent").innerHTML;
  assert.match(html, /<span>Check<\/span><strong>All values confirmed\.<\/strong>/, "the audit suffix does not hide the check");
  assert.match(html, /<span>AI audit<\/span><strong>11 Oct 2026: kcat re-checked against the paper and kept\. 11 Oct 2026: Km re-checked against the paper; the unit was corrected\.<\/strong>/);
  assert.doesNotMatch(html, /independent/);
  api.renderDetail(v2Summary, { verification_method: "catlog_v2_read_and_independent_verify", proof_lines: [line("kcat"), line("Km")] });
  assert.doesNotMatch(element("detailContent").innerHTML, /AI audit/, "no audit, no line");
}
// A printed unit 1000-fold from the unit CatLog used: an amber caution on that value, in place of the grey hint. kcat ÷ Km
// confirms the unit when only one value was read that way; otherwise the note says it cannot.
{
  const v2 = (overrides) => row({ source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name", ...overrides });
  const confirmedSummary = v2({ record_key: "unit-confirmed", kcat: 0.2075, km: 0.22878, kcat_over_km: 0.9177,
    kcat_display: "0.2075", km_display: "0.2288", kcat_over_km_display: "0.9177", kcat_unit: "s^(-1)", km_unit: "mM",
    kcat_over_km_unit: "s^(-1)*mM^(-1)" });
  const proofLine = (metric, raw_value, raw_unit, conversion) => ({ metric, table_label: "Table I", raw_value, raw_unit,
    printed: `${raw_value} ${raw_unit}`, check: "confirmed", conversion });
  const confirmedHtml = api.measurementSection(confirmedSummary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [proofLine("Km", "228.78", "µM", "converted by code"), proofLine("kcat", "12.45", "min^-1", "converted by code"),
      proofLine("kcat/Km", "55.06", "µM^-1 min^-1", "converted by code, printed unit read as mM^-1 min^-1")] });
  assert.match(confirmedHtml, /The paper prints µM⁻¹ min⁻¹; CatLog uses mM⁻¹ min⁻¹, the unit in which the printed kcat\/Km \(55\.06\) agrees with kcat ÷ Km \(54\.41\)\./);
  assert.match(confirmedHtml, /<button class="value-flag" type="button" data-flag-note="detailFlagNote1"[^>]*aria-label="kcat\/Km: printed unit differs\. Show the note\."/);
  assert.match(confirmedHtml, /<small>converted by code<\/small><small class="unit-caution"><span class="value-flag" aria-hidden="true"><\/span>CatLog uses mM⁻¹ min⁻¹, not the printed µM⁻¹ min⁻¹<\/small>/);
  assert.doesNotMatch(confirmedHtml, /printed unit read as/);
  const bothSummary = v2({ record_key: "unit-both", kcat: 150, km: 2.9, kcat_over_km: 54, kcat_display: "150", km_display: "2.9",
    kcat_over_km_display: "54", kcat_unit: "s^(-1)", km_unit: "mM", kcat_over_km_unit: "s^(-1)*mM^(-1)" });
  const bothHtml = api.measurementSection(bothSummary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [proofLine("kcat", "150 ± 13", "s^-1", ""), proofLine("Km", "2.9 ± 0.4", "μM", "printed unit read as mM"),
      proofLine("kcat/Km", "54", "s^-1 μM^-1", "printed unit read as s^-1 mM^-1")] });
  assert.match(bothHtml, /The paper prints μM; CatLog stores mM, 1000-fold apart, and kcat ÷ Km cannot show which is right\./);
  assert.match(bothHtml, /The paper prints s⁻¹ μM⁻¹; CatLog stores s⁻¹ mM⁻¹, 1000-fold apart/);
  // The same prefix read differently (M^-1 s^-1 for m^-1 s^-1) keeps the plain grey hint.
  const sameHtml = api.measurementSection(bothSummary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [proofLine("kcat/Km", "54", "M^-1 s^-1", "converted by code, printed unit read as 10^3 M-1 s-1")] });
  assert.doesNotMatch(sameHtml, /unit-caution|printed unit differs/);
  assert.match(sameHtml, /<small>converted by code, printed unit read as 10<sup>3<\/sup> M-1 s-1<\/small>/);
}
// A merged older record: the kcat/Km its sources list sits under the values, in the source's name and the catalog unit;
// when every one is more than 2-fold from kcat ÷ Km, an amber note says so.
{
  const merged = row({ record_key: "listed", kcat: 7.333, km: 0.5, kcat_over_km: 14.666, kcat_display: "7.333", km_display: "0.5",
    kcat_over_km_display: "14.666", kcat_over_km_origin: "calculated", kcat_unit: "s^(-1)", km_unit: "mM",
    kcat_over_km_unit: "s^(-1)*mM^(-1)", kcat_over_km_source_differs: true, source_db: "oed" });
  const listed = [3.0, 5.333, 3.083, 5.152, 6.117].map((value) => ({ value, unit: "1/mM*1/s", source_db: "oed" }));
  const html = api.measurementSection(merged, { source_kcat_over_km_values: listed });
  assert.match(html, /<span>kcat\/Km listed by OED<\/span><strong><span class="source-efficiency-value"><span>3\.0–6\.1 s<sup>-1<\/sup> mM<sup>-1<\/sup><\/span><small>5 values<\/small><\/span><\/strong>/);
  assert.match(html, /kcat ÷ Km \(15 s⁻¹ mM⁻¹\) is 2\.4–4\.9-fold above every kcat\/Km OED lists for this record \(3\.0–6\.1\)\./);
  assert.match(html, /aria-label="kcat\/Km: listed values differ\. Show the note\."/);
  assert.ok(html.indexOf("kcat/Km listed by OED") < html.indexOf("is 2.4–4.9-fold above"), "the listed values come first, under the values");
  const close = api.measurementSection(merged, { source_kcat_over_km_values: [...listed, { value: 14, unit: "s^(-1)*mM^(-1)", source_db: "brenda" }] });
  assert.match(close, /kcat\/Km listed by BRENDA/);
  assert.doesNotMatch(close, /fold above|listed values differ/, "one listed value agrees: no note");
}
// Records of one paper that read alike: the export's condition note under the substrate (table and record); without
// one, look-alikes on the page that share a paper say their conditions differ.
{
  const twin = (key, extra = {}) => Object.assign(row({ record_key: key, measurement_key: key, substrate_name: "pyruvate" }), { _pmids: 25401076, _dois: null }, extra);
  const page = [twin("a"), twin("b"), twin("c", { kcat_display: "2" }), twin("d", { condition_note: "+10 mM FBP" }), twin("e", { _pmids: 1 })];
  const alike = api.lookAlikeRowKeys(page);
  assert.deepEqual([...alike].sort(), ["a", "b"]);
  assert.equal(api.substrateNoteHtml(page[0], alike), '<small class="condition-note" title="conditions differ, see record">conditions differ, see record</small>');
  assert.equal(api.substrateNoteHtml(page[2], alike), "");
  assert.match(api.substrateNoteHtml(page[3], alike), />\+10 mM FBP<\/small>/);
  api.renderDetail(row({ record_key: "noted" }), { condition_note: "with 10 mM FBP" });
  assert.match(element("detailContent").innerHTML, /<span class="detail-substrate-name">Substrate<\/span><\/p><p class="detail-condition-note">with 10 mM FBP<\/p>/);
  api.renderDetail(row({ record_key: "not-noted" }), {});
  assert.doesNotMatch(element("detailContent").innerHTML, /detail-condition-note/);
}
// The line quoted from the paper: where it is ("Table 2 row"), table markers gone, K_M and k_{cat} as K<sub>m</sub> and
// k<sub>cat</sub>; a long table row or one whose ± signs were lost is folded away with a warning.
{
  const v2Summary = row({ record_key: "printed-lines", source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name" });
  const quoted = (printed_line, metric = "Km") => api.measurementSection(v2Summary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [{ metric, table_label: "Table 2", printed: "1 mM", printed_line, check: "confirmed", conversion: "" }] });
  let html = quoted("mpCAR [rowspan] | K_m [mm] | 20±4*");
  assert.match(html, /<p class="evidence-note-plain">Table 2 row, as extracted from the paper’s text: “mpCAR \| <i>K<\/i><sub>m<\/sub> \[mm\] \| 20±4\*”<\/p>/);
  assert.doesNotMatch(html, /rowspan|<details class="printed-line-disclosure"/);
  html = quoted("We fitted K_M = 4.6 ± 1.0 μM, k_{cat} = 9.7 s^{−1} and K_{m L}-methionine");
  assert.match(html, /<i>K<\/i><sub>m<\/sub> = 4\.6/);
  assert.match(html, /<i>k<\/i><sub>cat<\/sub> = 9\.7 s<sup>−1<\/sup>/);
  assert.match(html, /<i>K<\/i><sub>m L<\/sub>-methionine/);
  html = quoted("L-phenylalanine wt 1.1 ( 0.070 68 ( 1.4 62");
  assert.match(html, /<details class="printed-line-disclosure"><summary>Show the line as extracted<\/summary><p class="evidence-note-plain">Table 2 row, as extracted/);
  assert.match(html, /<p class="printed-line-note">Text extraction can drop symbols such as ±\.<\/p><\/details>/);
  assert.match(quoted("2Np-Gal | 0.9 ± 0.1 | 295.0 ± 6.3 | 310.0 | 24.7 ± 3.9"), /<details class="printed-line-disclosure">/, "more than four cells");
  assert.doesNotMatch(api.measurementSection(v2Summary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [{ metric: "Km", table_label: "Results, p. 4", printed: "1 mM", printed_line: "a Km of 1 mM", check: "confirmed", conversion: "" }] }),
  /row, as extracted/, "only a table's line is a row");
}
// What the AI check found, in words that give the new state: per value in the AI check column ("Unit set to mM"), once
// for the record in the Check line ("The AI check also removed EC 2.7.2.12 and corrected the assay conditions").
{
  const v2Summary = row({ record_key: "checks", source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name" });
  const line = (metric, check) => ({ metric, table_label: "Table 2", printed: "1", check, conversion: "" });
  const render = (lines, extra = {}) => {
    api.renderDetail(v2Summary, { verification_method: "catlog_v2_read_and_independent_verify", proof_lines: lines, ...extra });
    return element("detailContent").innerHTML;
  };
  let html = render([line("kcat", "corrected: construct description"), line("Km", "corrected: construct description")],
    { assay_conditions_summary: "50 mM Tris; preparation: His-tagged" });
  assert.match(html, /<span>Check<\/span><strong>All values confirmed\. The AI check also corrected the construct description \(see Preparation\)\.<\/strong>/);
  assert.doesNotMatch(html, /AI check<\/th>|second run|for every value:/);
  html = render([line("kcat", "corrected: unit used for the conversion (was none, now mM)"), line("Km", "corrected: unit used for the conversion (was none, now mM)")]);
  assert.match(html, /<span>Check<\/span><strong>Unit set to mM for every value\.<\/strong>/);
  html = render([line("kcat", "confirmed"), line("Km", "corrected: EC number (was 2.7.2.12, now none); assay conditions; qualifier (apparent, Hill fit or similar)")],
    { assay_conditions_summary: "pH 7; 50 mM Tris" });
  assert.match(html, /<th scope="col">AI check<\/th>/);
  assert.match(html, /<td>Confirmed<\/td><\/tr>/);
  assert.match(html, /<td>Qualifier corrected<\/td><\/tr>/);
  assert.match(html, /The AI check also removed EC 2\.7\.2\.12 and corrected the assay conditions \(see Conditions\)\.<\/strong>/);
  assert.doesNotMatch(html, /\(was |unit used for the conversion/);
  // Phrases already in plain words pass through; a caution on a confirmed value is pointed to.
  html = render([line("kcat", "confirmed"), line("Km", "confirmed"), line("kcat/Km", "confirmed")]);
  assert.match(html, /All values confirmed\.<\/strong>/);
  api.renderDetail(row({ record_key: "checks-flag", source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name",
    kcat: 8.5, km: 320, kcat_over_km: 0.033, kcat_display: "8.5", km_display: "320", kcat_over_km_display: "0.033",
    condition_flags: ["kcat_over_km_quotient_mismatch"] }), { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [line("kcat", "confirmed"), line("Km", "confirmed"), line("kcat/Km", "confirmed")] });
  assert.match(element("detailContent").innerHTML, /<span>Check<\/span><strong>All values confirmed as printed; see the note on kcat\/Km\.<\/strong>/);
  html = render([line("kcat", "corrected: cosubstrate; assay conditions")], { assay_conditions_summary: "50 mM Tris" });
  assert.match(html, /All values confirmed\. The AI check also corrected the cosubstrate and the assay conditions \(see Conditions\)\.<\/strong>/);
  html = render([line("kcat", "corrected: unit set to mM; EC 1.1.1.1 removed")]);
  assert.match(html, /<span>Check<\/span><strong>Unit set to mM for every value\. The AI check also removed EC 1\.1\.1\.1\.<\/strong>/);
}
// An older record's notes: under "Earlier automated review: where the values are printed", Where, As printed and the
// Conversion line, without code quotes or "->".
{
  api.renderDetail(row({ record_key: "older-notes", proof_kind: "paper_evidence", has_proof_excerpt: true }), {
    proof_lines: [{ table_label: "Table III", row_label: "row `Butanol`",
      raw_value_unit_evidence: "Table III, row `Butanol`: V1 = 5.2 (unit row: s^-1)",
      normalized_value_unit_evidence: "kcat: paper V1 cell 5.2 s^-1 -> 5.2 s^-1; no unit conversion" }],
  });
  const html = element("detailContent").innerHTML;
  assert.match(html, /<summary>Earlier automated review: where the values are printed<\/summary>/);
  assert.match(html, /<span>Where<\/span><strong>Table III · row Butanol<\/strong>/);
  assert.match(html, /<span>As printed<\/span><strong>Table III, row Butanol: V1 = 5\.2 \(unit row: s<sup>-1<\/sup>\)<\/strong>/);
  assert.match(html, /<span>Conversion<\/span><strong>kcat: paper V1 cell 5\.2 s<sup>-1<\/sup> → 5\.2 s<sup>-1<\/sup>; no unit conversion<\/strong>/);
  assert.match(html, /<span>Evidence<\/span><strong>Located in the paper<\/strong>/);
  assert.doesNotMatch(html, /`|-&gt;|Normalized|Reported|Values in source/);
  api.renderDetail(row({ record_key: "older-cited", has_proof_excerpt: false, evidence_confidence_tier: "literature_linked" }), {});
  assert.match(element("detailContent").innerHTML, /<span>Evidence<\/span><strong>Paper cited \(values not located\)<\/strong>/);
}

// Human review: "human-checked" (with its check) only on accepted records; the record's Human review line on every
// marked record; the counts band links to the human-checked records.
{
  api.setHumanReviewMarks({
    "hc-accepted": { checked: true },
    "hc-pending": { checked: true },
    "hc-note": { checked: false, note: "A human reviewer checked the same Km in CatLog's 2026 review of the earlier catalog." },
  });
  const accepted = row({ record_key: "hc-accepted", measurement_key: "hc-accepted", verification_status: "verified" });
  const pending = row({ record_key: "hc-pending", measurement_key: "hc-pending", verification_status: "manual_review_required" });
  const noted = row({ record_key: "hc-note", measurement_key: "hc-note", verification_status: "corrected" });
  assert.match(api.statusBadge(accepted), /<span class="state-tag human-checked"><svg class="check-icon"[^>]*>.*<\/svg>human-checked<\/span>/);
  assert.doesNotMatch(api.statusBadge(pending), /human-checked/);
  assert.doesNotMatch(api.statusBadge(noted), /human-checked/);
  api.renderDetail(accepted, {});
  let html = element("detailContent").innerHTML;
  assert.match(html, /class="detail-status-checked"><svg class="check-icon"/);
  assert.match(html, /<div class="kv-line human-review-line"><span>Human review<\/span><strong><svg class="check-icon"[^>]*>.*<\/svg>A human reviewer approved every value this record shows, in CatLog&#39;s review of the catalog\.<\/strong><\/div>/);
  api.renderDetail(pending, {});
  html = element("detailContent").innerHTML;
  assert.doesNotMatch(html, /detail-status-checked/);
  assert.match(html, /<span>Human review<\/span><strong>A human reviewer approved these values in CatLog&#39;s review of the catalog; other checks on this record are still open\.<\/strong>/);
  api.renderDetail(noted, {});
  // A note's review year is not shown (facts only).
  assert.match(element("detailContent").innerHTML, /<span>Human review<\/span><strong>A human reviewer checked the same Km in CatLog&#39;s review of the earlier catalog\./);

  const previous = { records: api.state.records, filtered: api.state.filtered, recordsReady: api.state.recordsReady, page: api.state.page,
    summary: runtimeManifest.summary, total: runtimeManifest.total_rows, download: runtimeManifest.enriched_download };
  const link = element("humanCheckedLink");
  api.state.records = [accepted, pending, noted];
  api.state.filtered = [accepted, pending, noted];
  api.state.recordsReady = true;
  runtimeManifest.summary = { ...(previous.summary || {}) };
  runtimeManifest.total_rows = 3;
  runtimeManifest.enriched_download = { ...(previous.download || {}), sha256: "d".repeat(64) };
  delete runtimeManifest.summary.overview;
  api.renderSummary();
  assert.equal(link.hidden, true, "no overview count, no Human-checked item");
  const binding = { download_sha256: "d".repeat(64), source_sha256: runtimeManifest.source_sha256, records: 3 };
  runtimeManifest.summary.overview = { ...binding, download_sha256: "e".repeat(64), human_checked_accepted: 1798 };
  api.renderSummary();
  assert.equal(link.hidden, true, "an overview counted from another download is not used");
  runtimeManifest.summary.overview = { ...binding, human_checked_accepted: 1798 };
  api.renderSummary();
  assert.equal(link.hidden, false);
  assert.equal(element("humanCheckedCount").textContent, "1", "the count follows the loaded results");
  assert.equal(link.getAttribute("href"), "#browse?checked=1");
  // The link carries the filters set now (not the address, which can be one change behind or a record's), never the page.
  window.location.hash = "#browse?q=old";
  element("ecFilterInput").value = "1.1.1";
  element("organismFilterInput").value = "Homo sapiens";
  api.state.page = 3;
  assert.equal(api.humanCheckedHref(), "#browse?checked=1&ec=1.1.1&organism=Homo+sapiens", "the link keeps the current filters");
  element("ecFilterInput").value = "";
  element("organismFilterInput").value = "";
  api.state.page = previous.page;
  window.location.hash = "";
  // No human-checked record among the results: the count is plain text, not a link to an empty table.
  api.state.filtered = [pending, noted];
  api.renderSummary();
  assert.equal(element("humanCheckedCount").textContent, "0");
  assert.equal(link.getAttribute("href"), null);
  // Read from the paper N: the records read by CatLog among the results, a link to them with the filters set now.
  assert.equal(element("fromPaperCount").textContent, "0");
  assert.equal(element("fromPaperLink").getAttribute("href"), null, "0 is plain text");
  const readByCatlog = row({ record_key: "fp-1", measurement_key: "fp-1", source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name" });
  api.state.filtered = [readByCatlog, pending];
  api.renderSummary();
  assert.equal(element("fromPaperCount").textContent, "1");
  assert.equal(element("fromPaperLink").getAttribute("href"), "#browse?source=paper");
  api.state.filtered = [pending, noted];
  api.setHumanReviewMarks({});
  api.renderSummary();
  assert.equal(element("humanCheckedCount").textContent, "—", "a filtered view without the marks has no count yet");
  api.state.filtered = [accepted, pending, noted];
  api.renderSummary();
  assert.equal(element("humanCheckedCount").textContent, "1,798", "before the marks load, the snapshot's count");
  assert.equal(link.getAttribute("href"), "#browse?checked=1");
  runtimeManifest.summary = previous.summary;
  runtimeManifest.total_rows = previous.total;
  runtimeManifest.enriched_download = previous.download;
  if (previous.total === undefined) delete runtimeManifest.total_rows;
  if (previous.download === undefined) delete runtimeManifest.enriched_download;
  Object.assign(api.state, { records: previous.records, filtered: previous.filtered, recordsReady: previous.recordsReady });
  api.renderSummary();
}

async function recordDownloadPayload(summary, detail) {
  elements.set("downloadSelectedJson", makeElement("downloadSelectedJson"));
  api.renderDetail(summary, detail);
  const recordDownloadCount = capturedDownloads.length;
  element("downloadSelectedJson").click();
  assert.equal(capturedDownloads.length, recordDownloadCount + 1);
  const download = capturedDownloads.at(-1);
  assert.ok(download.blob, "record download should create a JSON Blob");
  return JSON.parse(await download.blob.text());
}

const detailPreferredPayload = await recordDownloadPayload(
  row({ record_key: "record-detail-preferred", source_license: "CC BY 4.0", summary_marker: true }),
  { source_license: mixedSourceLicenses, detail_marker: true },
);
assert.equal(detailPreferredPayload.metadata.license_note, licenseNote);
assert.equal(detailPreferredPayload.metadata.source_license, mixedSourceLicenses);
assert.equal(detailPreferredPayload.summary.source_license, "CC BY 4.0");
assert.equal(detailPreferredPayload.summary.summary_marker, true);
assert.equal(detailPreferredPayload.detail.source_license, mixedSourceLicenses);
assert.equal(detailPreferredPayload.detail.detail_marker, true);

const summaryFallbackPayload = await recordDownloadPayload(
  row({ record_key: "record-summary-fallback", source_license: "CC BY 4.0" }),
  { source_license: "" },
);
assert.equal(summaryFallbackPayload.metadata.source_license, "CC BY 4.0");
assert.equal(summaryFallbackPayload.detail.source_license, "");

const missingLicensePayload = await recordDownloadPayload(
  row({ record_key: "record-missing-license", source_license: undefined }),
  {},
);
assert.equal(missingLicensePayload.metadata.source_license, null);
assert.equal(missingLicensePayload.summary.source_license, undefined);
const detailFalseKiHtml = api.measurementSection(row({
  has_ki: true,
  ki_display: "0.5",
  ki_unit: "mM",
}), { has_ki: false });
assert.doesNotMatch(detailFalseKiHtml, /<i>K<\/i><sub>i<\/sub>/);

// The Organism field: a common name matches as a whole word ("rat" is not inside Serratia or auratus); other words
// match inside a name, and a binomial finds its strains.
{
  api.indexLoadedRecords(["Rattus norvegicus", "Serratia marcescens", "Mesocricetus auratus", "Homo sapiens", "Escherichia coli K-12"]
    .map((organism, index) => row({ record_key: `organism-${index}`, measurement_key: `organism-${index}`, organism })));
  const organismsFor = async (text) => {
    element("organismFilterInput").value = text;
    await api.ensureCurrentFilters();
    return api.state.filtered.map((item) => item.organism).sort();
  };
  assert.deepEqual(await organismsFor("rat"), ["Rattus norvegicus"]);
  assert.deepEqual(await organismsFor("Rat"), ["Rattus norvegicus"]);
  assert.deepEqual(await organismsFor("human"), ["Homo sapiens"]);
  assert.deepEqual(await organismsFor("ratt"), ["Rattus norvegicus"]);
  assert.deepEqual(await organismsFor("E. coli"), ["Escherichia coli K-12"]);
  element("organismFilterInput").value = "";
}

// Source: read from the paper by CatLog, or from the enzyme databases, narrowed by database; the status cell's second
// line names the source. source=paper and the older status=v2 open the CatLog choice.
{
  const sourceRow = (key, overrides) => row({ record_key: key, measurement_key: key, ...overrides });
  const fromPaper = sourceRow("src-v2", { source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name" });
  const earlier = sourceRow("src-earlier", { source_db: "primary_paper_direct", enzyme_label_source: "ec_name_fallback" });
  const merged = sourceRow("src-merged", { source_db: "sabio_rk;brenda" });
  const unknown = sourceRow("src-unknown", { source_db: "unknown" });
  const oed = sourceRow("src-oed", { source_db: "oed", verification_status: "corrected" });
  api.indexLoadedRecords([fromPaper, earlier, merged, unknown, oed]);
  api.state.recordsReady = true;
  assert.deepEqual([fromPaper, earlier, merged, unknown, oed].map(api.sourceTagText),
    ["from paper", "earlier extraction", "BRENDA, SABIO-RK", "source not recorded", "OED"]);
  assert.match(api.statusBadge(oed), /<span class="state-tags"><span class="state-tag">OED<\/span><span class="state-tag">corrected<\/span><\/span>/);
  assert.match(api.statusBadge(fromPaper), /<span class="state-tag">from paper<\/span>/);
  const keysFor = async (address) => {
    api.applyBrowseParams(new Map(new URLSearchParams(address)));
    await api.ensureCurrentFilters();
    return api.state.filtered.map((item) => item.record_key).sort();
  };
  assert.deepEqual(await keysFor("source=paper"), ["src-v2"]);
  assert.equal(api.browseHash(), "#browse?source=paper");
  assert.deepEqual([...api.activeFilterItems()].map((item) => item.label), ["Source: read from the paper by CatLog"]);
  assert.deepEqual(await keysFor("status=v2"), ["src-v2"], "an older address keeps working");
  assert.equal(api.browseHash(), "#browse?source=paper");
  assert.deepEqual(await keysFor("source=databases"), ["src-earlier", "src-merged", "src-oed", "src-unknown"]);
  assert.deepEqual(await keysFor("source=brenda"), ["src-merged"], "a merged record counts under each database");
  assert.deepEqual(sourceModeInputs.filter((input) => input.checked).map((input) => input.value), ["databases"]);
  assert.deepEqual(await keysFor("source=sabio_rk,unrecorded"), ["src-merged", "src-unknown"]);
  assert.equal(api.browseHash(), "#browse?source=sabio_rk,unrecorded");
  assert.deepEqual([...api.activeFilterItems()].map((item) => item.key), ["source:sabio_rk", "source:unrecorded"]);
  assert.deepEqual(await keysFor("source=earlier"), ["src-earlier"]);
  // Removing the last database chip removes the source filter.
  api.activeFilterItems().find((item) => item.key === "source:earlier_paper").clear();
  assert.equal(api.browseHash(), "");
  assert.deepEqual(await keysFor(""), ["src-earlier", "src-merged", "src-oed", "src-unknown", "src-v2"]);

  // Filter counts follow the results: each option counted over the records that match every other filter.
  const disputed = sourceRow("src-disputed", { source_db: "brenda", verification_status: "disputed", kcat: null });
  const pending = sourceRow("src-pending", { source_db: "sabio_rk", verification_status: "manual_review_required" });
  const unchecked = sourceRow("src-unchecked", { source_db: "unknown", verification_status: "unverified" });
  api.indexLoadedRecords([fromPaper, oed, pending, unchecked, disputed]);
  const countsFor = async (address) => {
    api.applyBrowseParams(new Map(new URLSearchParams(address)));
    await api.ensureCurrentFilters();
    return new Promise((resolve) => api.countFacets(api.filterControlState(), resolve));
  };
  let counts = await countsFor("status=accepted");
  assert.deepEqual({ ...counts.state }, { accepted: 2, curation_pending: 1, not_verified: 1, disputed: 1 },
    "a review result counts with its own group set aside");
  assert.deepEqual([counts.source.all, counts.source.paper, counts.source.databases, counts.source.oed, counts.source.brenda],
    [2, 1, 1, 1, 0], "the source counts follow the review result chosen");
  assert.equal(counts.metric.kcat, 2);
  counts = await countsFor("source=brenda");
  assert.deepEqual({ ...counts.state }, { accepted: 0, curation_pending: 0, not_verified: 0, disputed: 1 });
  assert.equal(counts.source.all, 5, "the source options count with Source set aside");
  assert.equal(counts.metric.kcat, 0, "the one BRENDA record has no kcat");
  counts = await countsFor("source=brenda&status=accepted");
  assert.equal(counts.source.brenda, 0, "ticking BRENDA with Accepted would give nothing");
  assert.equal(counts.state.disputed, 1, "Disputed would give the BRENDA record back");
  assert.equal(counts.metric.km, 0, "a record failing two groups counts nowhere");
  await countsFor("");
}

// Export results as CSV: the table's columns with units, review result, source and paper IDs, stored digits, one line per
// record (RFC 4180 quoting; a cell a spreadsheet would read as a formula starts with an apostrophe).
{
  const csvRows = [
    row({ record_key: "csv-1", enzyme_display_name: "alcohol dehydrogenase, class I", substrate_name: "=SUM(A1)", organism: 'Homo "sapiens"',
      kcat_display: "30.333", kcat_unit: "s^(-1)", km_display: "0.05", km_unit: "mM", kcat_over_km_display: "606.66",
      kcat_over_km_unit: "s^(-1)*mM^(-1)", kcat_over_km_origin: "calculated", mutation_signature: "D102E", wild_type: false,
      verification_status: "unverified", _pmids: [123, 456], primary_uniprot_id: "P00330" }),
    row({ record_key: "csv-2", source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name", wild_type: true,
      kcat_display: "Not reported", kcat: null }),
  ];
  const text = (await api.csvParts(csvRows)).join("");
  const lines = text.replace(/^\ufeff/, "").split("\r\n").filter(Boolean);
  assert.equal(lines.length, 3);
  assert.equal(lines[0], "record_key,enzyme_display_name,ec_number,organism,substrate_name,variant,kcat,kcat_unit,km,km_unit,"
    + "kcat_over_km,kcat_over_km_unit,kcat_over_km_origin,temperature_c,ph,review_result,human_checked,source,source_db,pubmed_id,doi,primary_uniprot_id");
  assert.ok(lines[1].startsWith('csv-1,"alcohol dehydrogenase, class I",1.1.1.1,"Homo ""sapiens""",\'=SUM(A1),D102E,30.333,s^-1,0.05,mM,606.66,s^-1 mM^-1,calculated,25,7,Not checked (Unverified),'), lines[1]);
  assert.ok(lines[1].endsWith(",BRENDA,brenda,123; 456,,P00330"), lines[1]);
  assert.match(lines[2], /^csv-2,Enzyme,1\.1\.1\.1,Organism,Substrate,wild type,,,1,mM,/, "a missing value is an empty cell");
  assert.match(lines[2], /,Accepted,[^,]*,from paper,primary_paper_direct,/);
}

api.indexLoadedRecords([row()]);
const searchInput = element("globalSearchInput");
const suggestions = element("searchSuggestions");
searchInput.value = "enzyme";
suggestions.classList.remove("hidden");
api.state.suggestionInputId = searchInput.id;
searchInput.setAttribute("aria-expanded", "true");
api.showSuggestions(searchInput);
assert.ok(suggestions.classList.contains("hidden"), "typed searches should not show unrelated samples");
assert.equal(searchInput.getAttribute("aria-expanded"), "false");
assert.match(
  sourceCode,
  /if \(\$\(id\)\.value\.trim\(\)\) hideSuggestions\(\);/,
  "typing should close an already-open sample list",
);
searchInput.value = "";
api.showSuggestions(searchInput);
assert.equal(suggestions.classList.contains("hidden"), false, "blank fields can still offer samples");
assert.deepEqual([...suggestions.innerHTML.matchAll(/data-value="([^"]+)"/g)].map((match) => match[1]),
  ["hexokinase", "1.1.1.1", "Escherichia coli", "NADH", "P00330", "PMID 15989682"], "one fixed line of examples, never random values");
assert.match(suggestions.innerHTML, /^<span class="suggestion-title" aria-hidden="true">Try:<\/span>/);

// Suggestions stay reachable beside narrow screens and bottom-of-panel fields.
{
  const originalRect = searchInput.getBoundingClientRect;
  const originalWidth = window.innerWidth;
  const originalHeight = window.innerHeight;
  try {
    window.innerWidth = 320;
    window.innerHeight = 480;
    searchInput.getBoundingClientRect = () => ({ left: 190, top: 420, bottom: 452, width: 120 });
    api.showSuggestions(searchInput);
    assert.equal(suggestions.style.left, "72px");
    assert.equal(suggestions.style.width, "240px");
    assert.equal(suggestions.style.top, "auto");
    assert.equal(suggestions.style.bottom, "66px");
    assert.equal(suggestions.style.maxHeight, "320px");
    searchInput.getBoundingClientRect = () => ({ left: 0, top: 16, bottom: 48, width: 340 });
    api.showSuggestions(searchInput);
    assert.equal(suggestions.style.left, "8px");
    assert.equal(suggestions.style.width, "304px");
    assert.equal(suggestions.style.top, "54px");
    assert.equal(suggestions.style.bottom, "auto", "reopening below clears the previous anchor");
    window.innerHeight = 240;
    searchInput.getBoundingClientRect = () => ({ left: 8, top: 90, bottom: 122, width: 220 });
    api.showSuggestions(searchInput);
    assert.equal(suggestions.style.maxHeight, "104px", "short viewports use a scrollable list");
  } finally {
    searchInput.getBoundingClientRect = originalRect;
    window.innerWidth = originalWidth;
    window.innerHeight = originalHeight;
  }
}

// R20: exercise the bound handlers with a controlled three-option DOM and clock.
// Native button key-to-click synthesis remains a real-browser responsibility.
{
  const originalSetTimeout = window.setTimeout;
  const originalClearTimeout = window.clearTimeout;
  const originalQuerySelectorAll = suggestions.querySelectorAll;
  const originalContains = suggestions.contains;
  const originalFocus = searchInput.focus;
  const originalActiveElement = document.activeElement;
  const timers = new Map();
  let nextTimer = 1;
  let options = [];
  let inputFocusCount = 0;
  window.setTimeout = (callback, delay) => {
    const id = nextTimer++;
    timers.set(id, { callback, delay });
    return id;
  };
  window.clearTimeout = (id) => timers.delete(id);
  suggestions.querySelectorAll = (selector) => selector === "button[data-value]" ? options : [];
  suggestions.contains = (target) => target === suggestions || options.includes(target);
  searchInput.focus = function () {
    inputFocusCount += 1;
    document.activeElement = this;
    this.dispatch("focus");
  };
  const openSuggestions = () => {
    options = ["Enzyme", "Organism", "Substrate"].map((value, index) => {
      const option = makeElement(`catlog-suggestion-${index}`);
      option.tagName = "BUTTON";
      option.dataset.value = value;
      option.scrollIntoView = () => {};
      return option;
    });
    searchInput.value = "";
    document.activeElement = searchInput;
    api.showSuggestions(searchInput);
    assert.equal(options.length, 3);
    assert.equal(api.state.suggestionIndex, -1);
  };
  const runHideTimer = () => {
    const timerId = api.state.suggestionHideTimer;
    const timer = timers.get(timerId);
    assert.ok(timer, "leaving the suggestion widget should schedule its hide check");
    assert.equal(timer.delay, 140);
    timers.delete(timerId);
    timer.callback();
  };
  try {
    api.bindControls();
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
      assert.equal(element("statsButton").dispatch("click", modifier).defaultPrevented, false, "Modified clicks retain normal link behavior");
    }
    {
      const rail = element("catalogFilters");
      const input = element("substrateFilterInput");
      const originalRailRect = rail.getBoundingClientRect;
      const originalInputRect = input.getBoundingClientRect;
      const originalRailContains = rail.contains;
      try {
        rail.contains = candidate => candidate === input;
        rail.getBoundingClientRect = () => ({ top: 0, bottom: 600 });
        input.getBoundingClientRect = () => ({ left: 14, top: 360, bottom: 394, width: 291 });
        api.showSuggestions(input);
        const originalOptions = suggestions.innerHTML;
        rail.dispatch("scroll");
        assert.equal(suggestions.classList.contains("hidden"), false, "focus-induced scrolling keeps visible suggestions open");
        assert.equal(suggestions.innerHTML, originalOptions, "scrolling does not replace the offered suggestions");
        input.getBoundingClientRect = () => ({ left: 14, top: -50, bottom: -16, width: 291 });
        rail.dispatch("scroll");
        assert.equal(suggestions.classList.contains("hidden"), true, "offscreen fields dismiss suggestions");
      } finally {
        rail.getBoundingClientRect = originalRailRect;
        input.getBoundingClientRect = originalInputRect;
        rail.contains = originalRailContains;
      }
    }
    assert.equal(searchInput.getAttribute("role"), "combobox");
    window.location.hash = "#guide";
    element("guideView").hidden = false;
    searchInput.focus();
    assert.equal(element("guideView").hidden, false, "tabbing into Search must not leave Guide");
    searchInput.value = "Enzyme";
    searchInput.dispatch("input");
    assert.equal(element("guideView").hidden, true, "typing a search from Guide opens Browse");
    window.clearTimeout(api.state.filterTimer);
    window.location.hash = "";
    openSuggestions();
    element("catalogFilters").dispatch("scroll");
    assert.equal(suggestions.classList.contains("hidden"), true, "Scrolling Filters closes its detached suggestion popup");
    assert.equal(searchInput.getAttribute("aria-expanded"), "false");
    openSuggestions();
    const firstUp = searchInput.dispatch("keydown", { key: "ArrowUp" });
    assert.equal(firstUp.defaultPrevented, true);
    assert.equal(api.state.suggestionIndex, 2, "initial ArrowUp selects the last, not penultimate, option");
    assert.equal(searchInput.getAttribute("aria-activedescendant"), options[2].id);
    assert.deepEqual(options.map((option) => option.getAttribute("aria-selected")), ["false", "false", "true"]);
    searchInput.dispatch("keydown", { key: "ArrowDown" });
    assert.equal(api.state.suggestionIndex, 0, "ArrowDown wraps from last to first");
    searchInput.dispatch("keydown", { key: "ArrowUp" });
    assert.equal(api.state.suggestionIndex, 2, "ArrowUp wraps from first to last");
    openSuggestions();
    const firstDown = searchInput.dispatch("keydown", { key: "ArrowDown" });
    assert.equal(firstDown.defaultPrevented, true);
    assert.equal(api.state.suggestionIndex, 0, "initial ArrowDown selects the first option");

    searchInput.dispatch("blur");
    options[1].focus();
    runHideTimer();
    assert.equal(suggestions.classList.contains("hidden"), false,
      "the hide callback must preserve an option that has focus, even before focusin cancellation");
    assert.equal(searchInput.getAttribute("aria-expanded"), "true");
    assert.equal(document.activeElement, options[1]);

    api.scheduleSuggestionHide();
    document.activeElement = searchInput;
    runHideTimer();
    assert.equal(suggestions.classList.contains("hidden"), false,
      "the hide callback must also preserve focus returned to the associated input");

    searchInput.dispatch("blur");
    const canceledTimer = api.state.suggestionHideTimer;
    options[1].focus();
    suggestions.dispatch("focusin", { target: options[1] });
    assert.equal(timers.has(canceledTimer), false, "focusin within the box cancels pending hide");
    suggestions.dispatch("focusout", { target: options[1], relatedTarget: options[2] });
    options[2].focus();
    runHideTimer();
    assert.equal(suggestions.classList.contains("hidden"), false,
      "moving between options must keep the list open");

    const outside = element("downloadMenu");
    suggestions.dispatch("focusout", { target: options[2], relatedTarget: outside });
    outside.focus();
    runHideTimer();
    assert.equal(suggestions.classList.contains("hidden"), true, "focus leaving both input and box closes the list");
    assert.equal(searchInput.getAttribute("aria-expanded"), "false");
    assert.equal(searchInput.getAttribute("aria-activedescendant"), null);

    openSuggestions();
    options[0].focus();
    const escape = suggestions.dispatch("keydown", { key: "Escape", target: options[0] });
    assert.equal(escape.defaultPrevented, true);
    assert.equal(escape.propagationStopped, true);
    assert.equal(document.activeElement, searchInput, "Escape from an option returns focus to its input");
    assert.equal(suggestions.classList.contains("hidden"), true,
      "Escape closes after returning focus, so the input focus handler cannot reopen the list");
    assert.equal(searchInput.getAttribute("aria-expanded"), "false");

    openSuggestions();
    const chosen = options[0];
    assert.equal(chosen.listenerCount("click"), 1, "one click handler handles native button activation");
    assert.equal(chosen.listenerCount("mousedown"), 0, "activation must not depend on pointer-only mousedown");
    assert.equal(chosen.listenerCount("keydown"), 0, "native Enter/Space clicks must not be duplicated by custom activation");
    const focusCountBeforeClick = inputFocusCount;
    window.location.hash = "#guide";
    element("guideView").hidden = false;
    chosen.click();
    assert.equal(element("guideView").hidden, true, "choosing a suggestion from Guide opens Browse");
    window.location.hash = "";
    assert.equal(searchInput.value, chosen.dataset.value);
    assert.equal(inputFocusCount, focusCountBeforeClick + 1, "one click chooses exactly once");
    assert.equal(document.activeElement, searchInput);
    assert.equal(suggestions.classList.contains("hidden"), true);
    await api.ensureCurrentFilters();
  } finally {
    window.location.hash = "";
    api.hideSuggestions();
    window.setTimeout = originalSetTimeout;
    window.clearTimeout = originalClearTimeout;
    suggestions.querySelectorAll = originalQuerySelectorAll;
    suggestions.contains = originalContains;
    searchInput.focus = originalFocus;
    searchInput.value = "";
    document.activeElement = originalActiveElement;
  }
}

assert.equal(
  api.conditionFlags(row({
    kcat: 1.4,
    km: 13,
    kcat_over_km: 0.1,
    condition_flags: ["kcat_over_km_quotient_mismatch"],
  })).has("kcat_over_km_quotient_mismatch"),
  false,
  "source rounding should not display a quotient warning",
);
assert.equal(
  api.conditionFlags(row({
    kcat: 0.00028,
    km: 15.0,
    kcat_over_km: 0.17,
    condition_flags: ["kcat_over_km_quotient_mismatch"],
  })).has("kcat_over_km_quotient_mismatch"),
  true,
  "a material quotient discrepancy should remain visible",
);

assert.equal(
  (sourceCode.match(/\$\{detailHeadingHtml\((?:row|summary)\)\}/g) || []).length,
  3,
  "loading, success, and error details should expose a programmatically focusable heading",
);
assert.equal((sourceCode.match(/<h2 id="detailHeading" tabindex="-1"/g) || []).length, 1, "one heading helper");
assert.equal(
  (sourceCode.match(/if \(focusDetail\) focusDetailHeading\(key\);/g) || []).length,
  1,
  "only the initial explicit selection should move focus unconditionally",
);

{
  const content = element("detailContent");
  const heading = element("detailHeading");
  const originalContains = content.contains;
  const originalFocus = heading.focus;
  let headingFocusCount = 0;
  content.contains = (target) => target === heading || target === element("closeDetailButton");
  heading.focus = function () { headingFocusCount += 1; originalFocus.call(this); };
  try {
    for (const success of [true, false]) {
      for (const moveFocus of [true, false]) {
        const key = `focus-${success}-${moveFocus}`;
        const shard = `data/details-${key}.js`;
        const summary = row({ record_key: key, detail_shard: shard });
        api.state.records = api.state.filtered = [summary];
        api.state.page = 1;
        window.CATLOG_DETAIL_SHARDS[shard] = success ? { [key]: { ui_record_key: key } } : {};
        window.CATLOG_DETAIL_SHARD_GENERATIONS[shard] = runtimeSourceSha256;
        api.state.loadedScripts.add(shard);
        headingFocusCount = 0;
        const selecting = api.selectRecord(key);
        assert.equal(document.activeElement, heading, "explicit selection focuses the loading heading");
        if (moveFocus) searchInput.focus();
        await selecting;
        assert.equal(document.activeElement, moveFocus ? searchInput : heading,
          "success and error completion must preserve focus outside the detail panel");
        assert.equal(headingFocusCount, moveFocus ? 1 : 2,
          "restore focus only when replacing currently focused detail content");
        assert.equal(content.innerHTML.includes("retryDetailButton"), !success);
      }
    }
    const originalTimeout = window.setTimeout;
    let finishFocus;
    window.setTimeout = (callback) => { finishFocus = callback; return 0; };
    narrowDetailPanel = true;
    try {
      heading.focus();
      api.focusDetailHeading(api.state.selectedKey);
      element("closeDetailButton").focus();
      finishFocus();
      assert.equal(document.activeElement, element("closeDetailButton"),
        "a delayed mobile focus callback must not override a later user focus change");
    } finally {
      narrowDetailPanel = false;
      window.setTimeout = originalTimeout;
    }
  } finally {
    content.contains = originalContains;
    heading.focus = originalFocus;
    api.state.selectedKey = "";
    document.body.classList.remove("detail-open");
  }
}

const firstRowElement = makeElement("firstRow");
firstRowElement.dataset.key = "first";
const secondRowElement = makeElement("secondRow");
secondRowElement.dataset.key = "second";
const rovingRows = [firstRowElement, secondRowElement];
api.setActiveTableRow(firstRowElement, rovingRows);
assert.equal(firstRowElement.tabIndex, 0);
assert.equal(secondRowElement.tabIndex, -1);
assert.equal(rovingRows.filter((item) => item.tabIndex === 0).length, 1);
api.moveTableRowFocus(firstRowElement, 1, rovingRows);
assert.equal(firstRowElement.tabIndex, -1);
assert.equal(secondRowElement.tabIndex, 0);
assert.equal(document.activeElement, secondRowElement);
assert.equal(api.state.activeRowKey, "second");
api.moveTableRowFocus(secondRowElement, -1, rovingRows);
assert.equal(document.activeElement, firstRowElement);
assert.equal(rovingRows.filter((item) => item.tabIndex === 0).length, 1);

api.announceOpenedRecord({ enzyme_display_name: "Example enzyme" });
assert.equal(element("detailStatus").textContent, "Opened Example enzyme");

element("recordsBody").querySelectorAll = (selector) => (
  selector === "tr[data-key]" ? rovingRows : []
);
api.state.filtered = [
  row({ record_key: "first" }),
  row({ record_key: "second" }),
];
api.state.page = 1;
api.state.pageSize = 25;
api.state.recordsReady = true;
api.state.selectedKey = "second";
api.state.activeRowKey = "second";
api.setActiveTableRow(secondRowElement, rovingRows);
narrowDetailPanel = true;
document.body.classList.add("detail-open");
api.focusDetailHeading("second");
api.closeDetailAndRestoreFocus();
await new Promise((resolve) => setTimeout(resolve, 220));
assert.equal(document.activeElement, secondRowElement, "close should win a pending heading-focus race");
assert.equal(element("detailStatus").textContent, "");
assert.equal(document.body.classList.contains("detail-open"), false);
narrowDetailPanel = false;

// The viewer fills _ecSort on first use, so the reference computes the EC parts itself.
const referenceEcParts = (row) => String(row.ec_number || "").split(".")
  .map((part) => (/^\d+$/.test(part) ? Number(part) : Number.MAX_SAFE_INTEGER));

function referenceEcSort(a, b) {
  const left = referenceEcParts(a);
  const right = referenceEcParts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? -1) - (right[index] ?? -1);
    if (delta !== 0) return delta;
  }
  return String(a.ec_number || "").localeCompare(String(b.ec_number || ""));
}

function referenceComparator(sort) {
  const textKey = (field) => (a, b) => a[field].localeCompare(b[field]);
  const numericDesc = (field) => (a, b) => {
    const left = a[field] == null ? Number.NEGATIVE_INFINITY : Number(a[field]);
    const right = b[field] == null ? Number.NEGATIVE_INFINITY : Number(b[field]);
    return right - left;
  };
  // Low to high, rows without the value last; T and pH sort by the number the table shows.
  const numericAsc = (field) => (a, b) => {
    const left = a[field] == null ? Number.POSITIVE_INFINITY : Number(a[field]);
    const right = b[field] == null ? Number.POSITIVE_INFINITY : Number(b[field]);
    return left - right;
  };
  const shown = (field, valueOf) => (row) => ({ [field]: valueOf(row) });
  const temperature = (row) => (/^-?[\d.]+$/.test(String(row.temperature_display ?? "")) ? Number(row.temperature_display) : null);
  const ph = (row) => (/^[\d.]+$/.test(String(row.ph_display ?? "")) && Number(row.ph_display) <= 14 ? Number(row.ph_display) : null);
  const by = (comparator, valueOf) => (a, b) => comparator({ ...a, ...valueOf(a) }, { ...b, ...valueOf(b) });
  const comparators = {
    evidence: (a, b) => (
      (a._stateRank - b._stateRank)
      || (a._tierRank - b._tierRank)
      || (b._sourceCount - a._sourceCount)
      || referenceEcSort(a, b)
    ),
    ec_number: referenceEcSort,
    enzyme: textKey("_sortEnzyme"),
    organism: textKey("_sortOrganism"),
    substrate: textKey("_sortSubstrate"),
    kcat: numericDesc("kcat"),
    kcat_asc: numericAsc("kcat"),
    km: numericDesc("km"),
    km_asc: numericAsc("km"),
    kcat_over_km: numericDesc("kcat_over_km"),
    kcat_over_km_asc: numericAsc("kcat_over_km"),
    temperature: by(numericDesc("t"), shown("t", temperature)),
    temperature_asc: by(numericAsc("t"), shown("t", temperature)),
    ph: by(numericDesc("p"), shown("p", ph)),
    ph_asc: by(numericAsc("p"), shown("p", ph)),
  };
  return (a, b) => comparators[sort](a, b) || (a._loadIndex - b._loadIndex);
}

const modes = [
  "evidence",
  "ec_number",
  "enzyme",
  "organism",
  "substrate",
  "kcat",
  "kcat_asc",
  "km",
  "km_asc",
  "kcat_over_km",
  "kcat_over_km_asc",
  "temperature",
  "temperature_asc",
  "ph",
  "ph_asc",
];
const fixtures = [
  row({ record_key: "a", verification_status: "unverified", evidence_confidence_tier: "candidate_only", source_record_count: 2, ec_number: "10.2.1.1", enzyme_display_name: "Zulu", organism: "Mouse", substrate_name: "ATP", kcat: null, km: 8, kcat_over_km: 0.1, temperature_display: "37", ph_display: "n/a" }),
  row({ record_key: "b", verification_status: "verified", evidence_confidence_tier: "paper_grounded_high_confidence", source_record_count: 1, ec_number: "2.7.1.1", enzyme_display_name: "Alpha", organism: "Yeast", substrate_name: "Glucose", kcat: 9, km: null, kcat_over_km: 2, temperature_display: "n/a", ph_display: "8.5" }),
  row({ record_key: "c", verification_status: "manual_review_required", evidence_confidence_tier: "literature_linked", source_record_count: 8, ec_number: "2.7.1.-", enzyme_display_name: "Beta", organism: "Human", substrate_name: "Citrate", kcat: 3, km: 4, kcat_over_km: null, temperature_display: "4", ph_display: "6" }),
  row({ record_key: "d", verification_status: "corrected", evidence_confidence_tier: "paper_grounded", source_record_count: 3, ec_number: "1.1.1.1", enzyme_display_name: "Gamma", organism: "Bacterium", substrate_name: "Pyruvate", kcat: 5, km: 2, kcat_over_km: 4 }),
  row({ record_key: "e", verification_status: "verified", evidence_confidence_tier: "paper_grounded", source_record_count: 3, ec_number: "1.1.1.1", enzyme_display_name: "Gamma", organism: "Bacterium", substrate_name: "Pyruvate", kcat: 5, km: 2, kcat_over_km: 4 }),
];

api.indexLoadedRecords(fixtures.map((item) => ({ ...item })));
for (const mode of modes) {
  const expected = [...api.state.records].sort(referenceComparator(mode));
  const actual = await api.orderedRecordsFor(mode);
  assert.deepEqual(
    Array.from(actual, (item) => item.record_key),
    expected.map((item) => item.record_key),
    `${mode} should preserve the previous ordering with load order as the final tie-break`,
  );
  const subset = (item) => ["a", "c", "e"].includes(item.record_key);
  assert.deepEqual(
    Array.from(actual.filter(subset), (item) => item.record_key),
    [...api.state.records].filter(subset).sort(referenceComparator(mode)).map((item) => item.record_key),
    `${mode} should preserve filter-then-sort ordering when filtering a cached global ordering`,
  );
}

const tiedRows = Array.from({ length: 24 }, (_, index) => row({ record_key: `tie-${index}` }));
api.indexLoadedRecords(tiedRows);
for (const mode of modes) {
  const actual = await api.orderedRecordsFor(mode);
  assert.deepEqual(
    Array.from(actual, (item) => item.record_key),
    tiedRows.map((item) => item.record_key),
    `${mode} should be stable across exact ties`,
  );
}

const largeRows = Array.from({ length: 5000 }, (_, index) => row({
  record_key: `large-${index}`,
  enzyme_display_name: index % 2 ? "Beta enzyme" : "Alpha enzyme",
  organism: `Organism ${index % 7}`,
  kcat: index % 31,
}));
api.indexLoadedRecords(largeRows);
window.scheduler.yield = () => {
  yieldCount += 1;
  return new Promise((resolve) => setImmediate(resolve));
};
let heartbeatObserved = false;
const heartbeat = new Promise((resolve) => {
  setTimeout(() => {
    heartbeatObserved = true;
    resolve();
  }, 0);
});
const pendingFirst = api.orderedRecordsFor("evidence");
const pendingSecond = api.orderedRecordsFor("evidence");
assert.strictEqual(pendingSecond, pendingFirst, "concurrent requests should share a pending sort");
await Promise.all([pendingFirst, heartbeat]);
assert.equal(heartbeatObserved, true, "a cold sort should yield to an event-loop heartbeat");
assert.strictEqual(api.orderedRecordsFor("evidence"), pendingFirst, "resolved sorts should be reused");
await api.orderedRecordsFor("enzyme");
await api.orderedRecordsFor("km");
assert.equal(api.state.sortCache.size, api.SORT_CACHE_LIMIT, "full-order cache should stay bounded");
assert.equal(api.state.sortCache.has("evidence"), false, "least-recently used sort should be evicted");

let releaseEvictedSort;
let announceEvictedSortYield;
const evictedSortEnteredYield = new Promise((resolve) => {
  announceEvictedSortYield = resolve;
});
let evictionYieldCalls = 0;
window.scheduler.yield = () => {
  yieldCount += 1;
  evictionYieldCalls += 1;
  if (evictionYieldCalls !== 1) return Promise.resolve();
  announceEvictedSortYield();
  return new Promise((resolve) => {
    releaseEvictedSort = resolve;
  });
};
api.indexLoadedRecords(largeRows.map((item) => ({ ...item })));
const evictedPendingSort = api.orderedRecordsFor("evidence");
const evictedPendingEntry = api.state.sortCache.get("evidence");
await evictedSortEnteredYield;
const retainedPendingSort = api.orderedRecordsFor("enzyme");
const newestPendingSort = api.orderedRecordsFor("km");
await Promise.all([retainedPendingSort, newestPendingSort]);
assert.equal(api.state.sortCache.has("evidence"), false, "a third mode should evict the oldest pending sort");
assert.equal(evictedPendingEntry.cancelled, true, "LRU eviction should mark pending work cancelled");
const yieldsBeforeEvictedRelease = evictionYieldCalls;
releaseEvictedSort();
assert.equal(await evictedPendingSort, null, "an evicted pending sort should cooperatively cancel");
await new Promise((resolve) => setImmediate(resolve));
assert.equal(
  evictionYieldCalls,
  yieldsBeforeEvictedRelease,
  "an evicted blocked sort should not resume work after its yield is released",
);

let releaseYield;
let announceYield;
const enteredYield = new Promise((resolve) => {
  announceYield = resolve;
});
let firstYield = true;
window.scheduler.yield = () => {
  yieldCount += 1;
  if (!firstYield) return Promise.resolve();
  firstYield = false;
  announceYield();
  return new Promise((resolve) => {
    releaseYield = resolve;
  });
};
api.indexLoadedRecords(largeRows.map((item) => ({ ...item })));
const oldGenerationSort = api.orderedRecordsFor("organism");
const oldGenerationEntry = api.state.sortCache.get("organism");
await enteredYield;
api.indexLoadedRecords([row({ record_key: "new-generation" })]);
assert.equal(oldGenerationEntry.cancelled, true, "generation invalidation should cancel cached work");
releaseYield();
assert.equal(await oldGenerationSort, null, "an in-flight old-generation sort should be abandoned");
assert.equal(api.state.sortCache.size, 0, "indexing a new generation should invalidate the cache");
const newGenerationSort = await api.orderedRecordsFor("organism");
assert.deepEqual(Array.from(newGenerationSort, (item) => item.record_key), ["new-generation"]);

const longYieldFailure = `synthetic yield failure ${"x".repeat(300)}`;
api.indexLoadedRecords([row({ record_key: "background-failure" })]);
api.state.recordsReady = true;
element("sortSelect").value = "evidence";
element("globalSearchInput").value = "";
window.scheduler.yield = () => {
  yieldCount += 1;
  return Promise.reject(new Error(longYieldFailure));
};
const unhandledRejections = [];
const recordUnhandledRejection = (reason) => unhandledRejections.push(reason);
process.on("unhandledRejection", recordUnhandledRejection);
const backgroundFailure = api.applyFiltersInBackground();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(await backgroundFailure, false, "a background filter failure should be handled");
await new Promise((resolve) => setImmediate(resolve));
process.off("unhandledRejection", recordUnhandledRejection);
assert.deepEqual(unhandledRejections, [], "background filtering should not leak an unhandled rejection");
assert.ok(api.state.filterFailure.length > 0);
assert.ok(api.state.filterFailure.length <= 160, "the recorded filter failure should be bounded");
assert.match(
  element("recordsBody").innerHTML,
  /CatLog could not update results/,
  "a background filter failure should be visible in the results area",
);

api.indexLoadedRecords(largeRows.map((item) => ({ ...item })));
api.state.recordsReady = true;
element("sortSelect").value = "evidence";
element("globalSearchInput").value = "alpha";
window.scheduler.yield = () => {
  yieldCount += 1;
  return new Promise((resolve) => setImmediate(resolve));
};
const staleApplication = api.applyFilters();
element("globalSearchInput").value = "beta";
const currentApplication = api.applyFilters();
const [staleApplied, currentApplied] = await Promise.all([staleApplication, currentApplication]);
assert.equal(staleApplied, false, "an older filter application should not overwrite newer input");
assert.equal(currentApplied, true, "the newest filter application should render");
assert.ok(api.state.filtered.length > 0);
assert.ok(api.state.filtered.every((item) => item._search.includes("beta")));

const evidenceEntry = api.state.sortCache.get("evidence");
const yieldsBeforePageSize = yieldCount;
api.state.page = 3;
api.applyPageSize("50");
assert.equal(api.state.pageSize, 50);
assert.equal(api.state.page, 1);
assert.strictEqual(api.state.sortCache.get("evidence"), evidenceEntry);
assert.equal(yieldCount, yieldsBeforePageSize, "changing page size should render without sorting");
api.applyPageSize("25");
assert.equal(api.state.pageSize, 25);
assert.equal(
  (element("recordsBody").innerHTML.match(/<tr\s/g) || []).length,
  25,
  "the 25-row option must render all 25 rows, not a short preview",
);

const detailShard = "details-test.js";
{
  element("globalSearchInput").value = "no_such_catlog_record_937461";
  await api.applyFilters();
  assert.equal(api.state.filtered.length, 0);
  assert.equal(element("pageSummary").textContent, "No matching records");
  assert.equal(element("clearResultsButton").hidden, false);
  assert.equal(element("downloadPageButton").disabled, true);
  assert.equal(element("nextButton").disabled, true);
  assert.equal(element("prevButton").disabled, true);
  element("clearResultsButton").click();
  await api.ensureCurrentFilters();
  assert.equal(element("globalSearchInput").value, "");
  assert.equal(document.activeElement, element("globalSearchInput"));
  assert.equal(api.state.filtered.length, largeRows.length);
  assert.equal(element("clearResultsButton").hidden, true);
  assert.equal(element("downloadPageButton").disabled, false);
  assert.equal((element("recordsBody").innerHTML.match(/<tr\s/g) || []).length, 25);
}
const raceRows = largeRows.map((item) => ({ ...item, detail_shard: detailShard }));
const expectedSelectedRow = raceRows.find((item) => item.enzyme_display_name === "Beta enzyme");
window.CATLOG_DETAIL_SHARDS[detailShard] = { [expectedSelectedRow.record_key]: {} };
api.state.loadedScripts.add(detailShard);
api.indexLoadedRecords(raceRows);
api.state.recordsReady = true;
api.state.selectedKey = "";
element("sortSelect").value = "evidence";
element("globalSearchInput").value = "alpha";
embeddedDetailPanel = true;
let releaseLoadRace;
let announceLoadRaceYield;
const loadRaceEnteredYield = new Promise((resolve) => {
  announceLoadRaceYield = resolve;
});
let loadRaceYieldBlocked = false;
window.scheduler.yield = () => {
  yieldCount += 1;
  if (loadRaceYieldBlocked) return Promise.resolve();
  loadRaceYieldBlocked = true;
  announceLoadRaceYield();
  return new Promise((resolve) => {
    releaseLoadRace = resolve;
  });
};
const loadTimeFiltering = api.ensureCurrentFilters();
await loadRaceEnteredYield;
element("globalSearchInput").value = "beta";
element("sortSelect").value = "enzyme";
const racingUserFilter = api.applyFiltersInBackground();
releaseLoadRace();
await Promise.all([loadTimeFiltering, racingUserFilter]);
assert.ok(api.state.filtered.length > 0);
assert.ok(api.state.filtered.every((item) => item._search.includes("beta")));
assert.equal(
  api.state.selectedKey,
  "",
  "load-time filtering must leave the detail pane closed until a row is selected",
);
embeddedDetailPanel = false;

// Stats and Guide are drawn from the manifest: opening either never downloads the record index or the marks.
for (const hash of ["#stats", "#guide", "#guide-units"]) {
  const originalFetch = window.fetch;
  const requests = [];
  window.fetch = (url, ...rest) => {
    requests.push(String(url));
    return originalFetch(url, ...rest);
  };
  window.location.hash = hash;
  window.location.href = `https://example.test/catlog/${hash}`;
  api.state.statsRendered = false;
  element("statsCharts").innerHTML = "";
  try {
    await api.init();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
      requests.filter((url) => /catlog-viewer-index|catlog-table|human-review-marks/.test(url)),
      [],
      `${hash} must not download the record index`,
    );
    assert.equal(element("statsView").hidden, hash !== "#stats");
    assert.equal(api.state.statsRendered, hash === "#stats", "Stats are drawn the first time they are shown");
    assert.equal(element("statsCharts").innerHTML.length > 0, hash === "#stats");
  } finally {
    window.fetch = originalFetch;
    window.location.hash = "";
    window.location.href = "https://example.test/catlog/";
  }
}

console.log("CatLog viewer behavior checks passed.");
