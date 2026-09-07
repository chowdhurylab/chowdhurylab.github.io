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

for (const pageHtml of [indexHtml, stableAliasHtml]) {
  assert.doesNotMatch(pageHtml, /<meta http-equiv=/);
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
  assert.match(
    pageHtml,
    /<meta property="og:url" content="https:\/\/chowdhurylab\.github\.io\/tools\/catlog-static\/" \/>/,
  );
  assert.match(
    pageHtml,
    /<link rel="canonical" href="https:\/\/chowdhurylab\.github\.io\/tools\/catlog-static\/" \/>/,
  );
  assert.match(pageHtml, /<link rel="icon" href="\/images\/rz\.png" \/>/);
  const citationSection = pageHtml.match(/<section class="guide-citation"[\s\S]*?<\/section>/)?.[0];
  assert.ok(citationSection, "Guide must keep its citation/version section");
  assert.ok(citationSection.includes('id="guidePaperCitation"'));
  assert.ok(citationSection.includes("Sajeevan, K. A., et al. (2025)."));
  assert.ok(citationSection.includes("Robust Prediction of Enzyme Variant Kinetics with RealKcat."));
  assert.ok(citationSection.includes("bioRxiv, version 2. doi: 10.1101/2025.02.10.637555."));
  for (const id of ["guideSnapshotDate", "guideSourceId", "guideExportId"]) {
    assert.ok(citationSection.includes(`id="${id}"`), `${id} must remain in Guide`);
  }
  assert.ok(citationSection.includes('href="https://www.biorxiv.org/content/10.1101/2025.02.10.637555v2"'));
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
assert.match(indexHtml, />Paper evidence<\/dt><dd>A structured paper value and its table or measurement excerpt are saved\./);
assert.match(indexHtml, />Source note<\/dt><dd>A plain note from the source record is saved, but it is not a structured paper-value excerpt\./);
assert.match(
  sourceCode,
  /if \(row\.proof_kind === "paper_evidence" \|\| row\.has_proof_excerpt\) return "paper_evidence";\s+if \(row\.proof_kind === "source_note"\) return "source_note";/,
);
assert.match(sourceCode, /counts\.source_note = publicEvidence\.source_note \|\| 0;/);
assert.match(
  sourceCode,
  /<span tabindex="0" title="\$\{escapeHtml\(item\.description\)\}" aria-label="\$\{escapeHtml\(accessibleLabel\)\}">/,
);
assert.match(
  sourceCode,
  /const proofHeading = \(summary\.proof_kind \|\| detail\.proof_kind\) === "source_note"\s+\? "Source note"\s+: "Values in source";/,
);
assert.match(sourceCode, /<h3>\$\{escapeHtml\(proofHeading\)\}<\/h3>/);

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
    getBoundingClientRect: () => ({ left: 0, bottom: 0, width: 200 }),
  };
}

const elements = new Map();
const element = (id) => {
  if (!elements.has(id)) elements.set(id, makeElement(id));
  return elements.get(id);
};
const recordStateInputs = ["accepted", "curation_pending", "not_verified"].map((value) => ({
  value,
  checked: true,
}));
const measurementInputs = ["kcat", "km", "kcat_over_km"].map((value) => ({
  value,
  checked: false,
}));
const detailBackgroundSelector = [
  ".app-header",
  "#catalogLoadProgress",
  "#searchSuggestions",
  "#catalogView > .snapshot-band",
  "#catalogFooter",
  ".workbench > :not(.detail-panel)",
].join(", ");
const detailBackgroundElements = [makeElement("header"), makeElement("table")];
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
    if (selector === detailBackgroundSelector) return detailBackgroundElements;
    return [];
  },
  addEventListener() {},
  createElement: (tagName) => makeElement(tagName),
};

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
  CATLOG_STATIC_TEST_MODE: true,
  CATLOG_STATIC_MANIFEST: runtimeManifest,
  CATLOG_RECORD_CHUNKS: [],
  CATLOG_DETAIL_SHARDS: {},
  CATLOG_DETAIL_SHARD_GENERATIONS: {},
  fetch: fetchCompressedShard,
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
  window,
  URL: RuntimeURL,
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
assert.ok(api, "test API should be exposed without starting the application");
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
assert.equal(element("activeSummary").textContent, "This browser cannot open the CatLog index");
assert.match(element("pageSummary").textContent, /current version of Safari, Chrome, Edge, or Firefox/);
assert.doesNotMatch(element("pageSummary").textContent, /offline|zip|serve this folder/);
await api.applyFilters();
assert.equal(document.body.classList.contains("catalog-load-failed"), false, "rendering results should restore the normal table layout");
window.DecompressionStream = DecompressionStream;
delete runtimeManifest.total_rows;
delete runtimeManifest.record_chunks;

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
  window.setTimeout = (callback) => {
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
window.setTimeout = (callback) => {
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
window.setTimeout = (callback) => {
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

assert.equal(api.enzymeFormLabel({ wild_type: true }), "Wild type");
assert.equal(api.enzymeFormLabel({ mutation_signature: "A12G" }), "Variant: A12G");
assert.equal(
  api.enzymeFormLabel({ sequence_variant_status: "variant" }),
  "Variant (unspecified)",
);
assert.match(
  api.enzymeFormHtml({ sequence_variant_status: "variant" }),
  />Variant \(unspecified\)</,
  "the table marker should identify an unspecified variant",
);
assert.equal(api.enzymeFormLabel({}, { showUnknown: true }), "Not recorded");
const formNoteHtml = api.molecularIdentitySection(
  { sequence_variant_note: "Source says <variant> & unresolved" },
  {},
);
assert.match(formNoteHtml, /<span>Enzyme form<\/span><strong>Not recorded<\/strong>/);
assert.match(
  formNoteHtml,
  /<span>Form note<\/span><strong>Source says &lt;variant&gt; &amp; unresolved<\/strong>/,
  "the form note should be visible and HTML-escaped",
);
assert.ok(
  formNoteHtml.indexOf("Enzyme form") < formNoteHtml.indexOf("Form note"),
  "the form note should follow the enzyme form",
);
assert.equal(
  api.sequenceSourceLabel("uniprot_accession", 1),
  "UniProt accession · confidence 1",
);
assert.equal(
  api.sequenceSourceLabel("uniprot_ec_organism_unique", 0.6),
  "UniProt accession inferred from EC and organism · confidence 0.6",
);
assert.equal(
  api.sequenceSourceLabel("uniprot_ec_organism_unique", null),
  "UniProt accession inferred from EC and organism",
);
assert.equal(
  api.sequenceSourceLabel("brenda_getSequence_unique_ec_organism", 0),
  "UniProt accession inferred from BRENDA EC and organism · confidence 0",
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
assert.match(inferredIdentityHtml, /UniProt accession inferred from EC and organism · confidence 0\.6/);
assert.doesNotMatch(inferredIdentityHtml, /confidence 1/);
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
  (sourceCode.match(/<h2 id="detailHeading" tabindex="-1">/g) || []).length,
  3,
  "loading, success, and error details should expose a programmatically focusable heading",
);
assert.equal(
  (sourceCode.match(/if \(focusDetail\) focusDetailHeading\(key\);/g) || []).length,
  3,
  "loading, success, and error details should move explicit-selection focus",
);

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

function referenceEcSort(a, b) {
  const left = a._ecSort || [];
  const right = b._ecSort || [];
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
    km: numericDesc("km"),
    kcat_over_km: numericDesc("kcat_over_km"),
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
  "km",
  "kcat_over_km",
];
const fixtures = [
  row({ record_key: "a", verification_status: "unverified", evidence_confidence_tier: "candidate_only", source_record_count: 2, ec_number: "10.2.1.1", enzyme_display_name: "Zulu", organism: "Mouse", substrate_name: "ATP", kcat: null, km: 8, kcat_over_km: 0.1 }),
  row({ record_key: "b", verification_status: "verified", evidence_confidence_tier: "paper_grounded_high_confidence", source_record_count: 1, ec_number: "2.7.1.1", enzyme_display_name: "Alpha", organism: "Yeast", substrate_name: "Glucose", kcat: 9, km: null, kcat_over_km: 2 }),
  row({ record_key: "c", verification_status: "manual_review_required", evidence_confidence_tier: "literature_linked", source_record_count: 8, ec_number: "2.7.1.-", enzyme_display_name: "Beta", organism: "Human", substrate_name: "Citrate", kcat: 3, km: 4, kcat_over_km: null }),
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

const detailShard = "details-test.js";
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
const loadTimeFiltering = api.ensureCurrentFiltersAndSelectFirst();
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
  api.state.filtered[0].record_key,
  "load-time auto-selection should use the newest filter state after a race",
);
assert.equal(api.state.selectedKey, expectedSelectedRow.record_key);
embeddedDetailPanel = false;

console.log("CatLog viewer behavior checks passed.");
