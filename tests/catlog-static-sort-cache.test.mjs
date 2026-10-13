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
  assert.ok(pageHtml.includes("A dash, used only in table cells, means no value."));
  assert.doesNotMatch(pageHtml, /c-temp|c-ph|value="temperature"|value="ph"/, "the table shows no temperature or pH and does not sort by them");
  // The record leaves out a value it does not store; a missing linked item reads None (the Guide says what the record does).
  assert.ok(pageHtml.includes("that is not stored has no row, and the Values section says when none is stored."));
  assert.ok(pageHtml.includes("a missing PMID or DOI, sequence or SMILES reads <em>None</em>"));
  assert.doesNotMatch(pageHtml, /is a dash too|None recorded/);
  assert.doesNotMatch(pageHtml, /hidden after a data check/, "A dash never suggests values were suppressed");
  assert.ok(pageHtml.includes("beside a value flags a possible problem; open the record to read what it is."));
  // Cautions state the problem; they give no orders.
  assert.doesNotMatch(pageHtml.match(/<h3 id="guide-cautions">[\s\S]*?<\/section>/)[0], /check the|to check|needs check|values differ<\/dt>|check units|unit mismatch|above limit</);
  assert.doesNotMatch(pageHtml, /Unusual stored values are kept and flagged|Open the row to see unusual stored values/);
  // A number stays with its unit, and a range with its power of ten, on one line.
  const cautionsHtml = pageHtml.match(/<h3 id="guide-cautions">[\s\S]*?<\/section>/)[0];
  assert.ok(cautionsHtml.includes("exactly 0&nbsp;&deg;C"));
  assert.ok(cautionsHtml.includes('<span class="nowrap">1&ndash;3&nbsp;&times;&nbsp;10<sup>7</sup>&nbsp;s<sup>-1</sup></span>'));
  assert.doesNotMatch(cautionsHtml, /\d (?:&deg;C|M\b|nM\b|s<sup>)/);
  // The release tool writes both descriptions: its earlier wording, or the site's words (records, review results, no
  // serial comma) once it uses them.
  assert.ok(
    [
      `<meta name="description" content="CatLog snapshot dated ${expectedSnapshotDate}: browse ${expectedRowCount} enzyme kinetics measurements with review status, source links, protein sequences, and substrate structures." />`,
      `<meta name="description" content="CatLog snapshot dated ${expectedSnapshotDate}: browse ${expectedRowCount} enzyme kinetics records with review results, source links, protein sequences and substrate structures." />`,
    ].some((tag) => pageHtml.includes(tag)),
  );
  assert.match(pageHtml, /<title>CatLog \| Enzyme kinetics catalog<\/title>/);
  assert.match(pageHtml, /<meta property="og:title" content="CatLog \| Enzyme kinetics catalog" \/>/);
  assert.ok(
    [
      `<meta property="og:description" content="CatLog snapshot dated ${expectedSnapshotDate} with ${expectedRowCount} enzyme kinetics measurements, review status, source links, protein sequences, and substrate structures." />`,
      `<meta property="og:description" content="CatLog snapshot dated ${expectedSnapshotDate} with ${expectedRowCount} enzyme kinetics records, review results, source links, protein sequences and substrate structures." />`,
    ].some((tag) => pageHtml.includes(tag)),
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
  for (const id of ["guideSnapshotDate", "guideSourceId"]) {
    assert.ok(citationSection.includes(`id="${id}"`), `${id} must remain in Guide`);
  }
  // The exporter commit names a private repository no reader can open: it stays in the README only.
  assert.doesNotMatch(pageHtml.match(/<main id="guideView"[\s\S]*?<\/main>/)[0], /guideExportId|Exporter commit|exporter/i);
  assert.ok(citationSection.includes('href="https://doi.org/10.1093/pnasnexus/pgag309"'));
  // Reporting an error is answered once, under Questions.
  assert.ok(!citationSection.includes("mailto:"));
  const questions = pageHtml.match(/<section [^>]*id="guide-questions"[\s\S]*?<\/section>/)[0];
  assert.ok(questions.includes('href="mailto:ratul@iastate.edu?cc=supantha@iastate.edu&amp;subject=CatLog%20data%20issue"'));
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
assert.ok(indexHtml.includes(">Note from BRENDA</dt><dd>The record shows the source database&rsquo;s own note under this heading; no paper text is saved."));
assert.match(
  sourceCode,
  /if \(row\.proof_kind === "paper_evidence" \|\| row\.has_proof_excerpt\) return "Located in the paper";\s+if \(row\.proof_kind === "source_note" \|\| proofLines\.length\) return "Database note";/,
);
assert.match(
  indexHtml,
  /<main id="statsView"[^>]*hidden/,
);
assert.match(sourceCode, /notesDisclosure\("Earlier automated review: where the values are printed", paperNotes\)/);
assert.match(sourceCode, /\$\{printedColumn \? '<th scope="col">As printed<\/th>' : ""\}\$\{whereColumn \? '<th scope="col" class="vt-where">Where<\/th>' : ""\}/);

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
// Against the databases (shown when the snapshot has the comparison).
const databaseInputs = ["corrects", "differs", "same", "adds", "new", "earlier"].map((value) => ({
  value, type: "checkbox", name: "database", checked: false,
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
    if (selector === 'input[name="database"]:checked') return databaseInputs.filter((input) => input.checked);
    if (selector === 'input[name="database"]') return databaseInputs;
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
      if (query === "(max-width: 1023px)") return narrowDetailPanel;
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
    assert.equal(api.publicLoadMessage("Expected 168765 CatLog rows, received 168000"), "The records could not be read. Reload the page to try again.");
    assert.equal(api.publicLoadMessage("Cannot read properties of undefined (reading 'x')"), "The records could not be read. Reload the page to try again.");
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
  /This page is out of date\. Reload to update it\./,
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
    /This page is out of date\. Reload to update it\./,
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
  /This record could not be loaded\./,
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
// Team (#team): its own view, drawn from the manifest the first time it is shown; people by first name, no model or
// vendor names, live numbers at the stations.
api.renderView("team", { scroll: true });
assert.equal(element("teamView").hidden, false);
assert.equal(element("statsView").hidden, true);
assert.equal(element("catalogView").hidden, true);
assert.equal(element("teamButton").getAttribute("aria-current"), "page");
assert.equal(element("statsButton").getAttribute("aria-current"), "false");
assert.equal(document.body.classList.contains("team-open"), true);
assert.equal(document.title, "Team | CatLog");
{
  const team = element("teamFigure").innerHTML + element("teamLegend").innerHTML;
  for (const name of ["Supantha", "Aarna", "Erin", "Mohammad", "Reading agents", "Checking agents", "Audit agents", "Download agent"]) {
    assert.match(team, new RegExp(name), name);
  }
  for (const station of ["Papers", "AI reading", "AI check", "CatLog", "Human check", "Rules updated", "Website", "The paper"]) {
    assert.match(team, new RegExp(`>${station}</text>`), station);
  }
  assert.doesNotMatch(team, /Claude|Codex|Anthropic|OpenAI|GPT|Dr\.|Prof|PhD|independent/);
  assert.match(team, /<strong>Supantha<\/strong> builds CatLog and turns findings into better rules/);
  assert.match(team, /data-actor="aarna erin" data-stations="human"/);
  // Supantha's line meets Rules updated; pointing at him also lights Papers, CatLog and the website.
  assert.match(team, /data-actor="supantha" data-stations="rules papers catlog website"/);
  // Where each works, in the loop's order and mid-sentence case.
  assert.match(team, /<small [^>]*>At Papers, CatLog, Rules updated, Website<\/small>/);
  assert.match(team, /<small [^>]*>At the paper<\/small>/);
  assert.match(team, /aria-label="Supantha: builds CatLog and turns findings into better rules\. At Papers, CatLog, Rules updated, Website\."/);
  assert.doesNotMatch(team, /At The paper/);
  // Tab follows the drawing: the agents above, left to right, then the people below.
  assert.deepEqual(
    [...element("teamFigure").innerHTML.matchAll(/class="team-actor [^"]*" data-actor="(\w+)"/g)].map((match) => match[1]),
    ["download", "reading", "checking", "audit", "supantha", "aarna", "erin", "mohammad"],
  );
  assert.match(team, /<animateMotion dur="24s"/, "Dots move round the loop unless the viewer asks for less motion");
  assert.equal((team.match(/class="team-loop team-loop-(wide|narrow)"/g) || []).length, 2);
  const numbers = api.teamNumbers();
  assert.ok(numbers.website.every((line) => /^[\d,]+ records$/.test(line)));
  assert.ok(numbers.reading.every((line) => /^[\d,]+ (papers read|records)$/.test(line)));
  // The drawing is named by aria-label (a <title> would show as a tooltip over all of it); a station's label reads a
  // wrapped fact as one phrase; legend lines are toggle buttons, not bare focusable list items.
  const figureHtml = element("teamFigure").innerHTML;
  assert.doesNotMatch(figureHtml, /<title/);
  assert.equal((figureHtml.match(/role="group" aria-label="CatLog's loop: /g) || []).length, 2);
  if (numbers.catlog.length) assert.match(figureHtml, /aria-label="CatLog: [\d,]+ values re-checked by AI audits"/);
  // On the upright loop a drawn line breaks at a space after 23 characters (16 in CatLog's, inside the lower arc), so no
  // line reaches the far side of the track in a wider font; the station's label still reads each fact whole.
  const narrowLines = (station) => [...figureHtml.match(/class="team-loop team-loop-narrow"[\s\S]*?<\/svg>/)[0]
    .match(new RegExp(`data-station="${station}"[\\s\\S]*?</g>`))[0].matchAll(/class="team-station-number"[^>]*>([^<]*)</g)].map((match) => match[1]);
  for (const station of ["reading", "human", "catlog", "website"]) {
    assert.ok(narrowLines(station).every((line) => line.length <= (station === "catlog" ? 16 : 23)), narrowLines(station).join(" | "));
  }
  assert.deepEqual([...api.teamWrappedLines("1,543 human-checked records", 23)], ["1,543 human-checked", "records"]);
  assert.deepEqual([...api.teamWrappedLines("1,081 values re-checked", 16)], ["1,081 values", "re-checked"]);
  assert.deepEqual([...api.teamWrappedLines("44,627 records", 23)], ["44,627 records"]);
  assert.deepEqual([...api.teamWrappedLines("44,627 records", undefined)], ["44,627 records"]);
  assert.deepEqual([...api.teamWrappedLines("a-word-longer-than-the-limit", 10)], ["a-word-longer-than-the-limit"]);
  assert.doesNotMatch(element("teamLegend").innerHTML, /tabindex/);
  assert.equal((element("teamLegend").innerHTML.match(/<button type="button" class="team-legend-button" aria-pressed="false" aria-describedby="(teamAt-[\w-]+)">[\s\S]*?<small id="\1" aria-hidden="true">At /g) || []).length, 7);
}
api.renderView("browse");
assert.equal(element("teamView").hidden, true);
assert.equal(document.body.classList.contains("team-open"), false);
assert.doesNotMatch(indexHtml, /id="snapshotBreakdown"|id="moreCountsButton"/);
const navMarkup = indexHtml.match(/<nav class="top-nav"[^>]*>([\s\S]*?)<\/nav>/)[1];
for (const view of ["browse", "guide", "stats", "team"]) {
  assert.match(navMarkup, new RegExp(`<a id="${view}Button"[^>]*href="#${view}"`));
}
// The catalog's own tabs (Browse, Stats, Guide, Team), then the links out on their own, right of them.
assert.deepEqual([...navMarkup.matchAll(/>(Browse|Guide|Stats|Team)<\//g)].map((match) => match[1]), ["Browse", "Stats", "Guide", "Team"]);
assert.match(navMarkup, /<a id="teamButton"[^>]*href="#team"/);
// The Team page is a view of its own that never loads the record index, and the Guide's method section links to it.
assert.match(indexHtml, /h==="#stats"\|\|h==="#team"\)return;/);
assert.match(indexHtml, /<main id="teamView" class="team-view" hidden aria-labelledby="teamHeading">[\s\S]*?<h1 id="teamHeading" tabindex="-1">People behind CatLog<\/h1>/);
const externalNav = indexHtml.match(/<nav class="external-nav" aria-label="Related sites">([\s\S]*?)<\/nav>/)[1];
assert.match(externalNav, /href="https:\/\/doi\.org\/10\.1093\/pnasnexus\/pgag309"[^>]*target="_blank"[^>]*aria-label="CatRange paper \(PNAS Nexus\), opens in a new tab"\s*><span class="nav-external-long">CatRange paper<\/span>/);
assert.match(externalNav, /href="https:\/\/chowdhurylab\.github\.io\/"[^>]*><span class="nav-external-long">Chowdhury Lab<\/span><span class="nav-external-short">Lab<\/span>&nbsp;<span aria-hidden="true">&#8599;<\/span>/);
assert.doesNotMatch(indexHtml, /ChowdhuryLab</);
// Guide: a contents list whose links reach every section; the search help keeps its examples; filtered views are linked
// in the #browse? format the table reads; no images.
const guideHtml = indexHtml.match(/<main id="guideView"[\s\S]*?<\/main>/)[0];
const guideContents = guideHtml.match(/<nav class="guide-contents"[^>]*>([\s\S]*?)<\/nav>/)[1];
const guideAnchors = [...guideContents.matchAll(/href="#(guide-[a-z-]+)"/g)].map((match) => match[1]);
assert.deepEqual(guideAnchors, ["guide-method", "guide-find", "guide-record", "guide-status", "guide-units", "guide-downloads",
  "guide-caveats", "guide-cite", "guide-sources", "guide-questions"]);
// The method is said in full once, in its own section (with the model's name); nowhere else in the Guide.
const guideMethod = guideHtml.match(/<section [^>]*id="guide-method"[^>]*>([\s\S]*?)<\/section>/)[1];
assert.match(guideMethod, /<a href="#team">People behind CatLog<\/a>/);
assert.match(guideMethod, /An AI model \(Claude, Anthropic\) reads each/);
assert.match(guideMethod, /A second, separate AI check compares every value with the paper\./);
// printed unit differs belongs to the Possible unit or magnitude error group (CAUTION_FLAG_BITS), in the Guide and the filter.
assert.match(guideHtml, /<em>Possible unit or magnitude error<\/em> \([^)]*above diffusion limit, printed unit differs\)/);
assert.doesNotMatch(guideHtml, /not in the table or the Cautions filter/);
assert.match(sourceCode, /value: "units", label: "Possible unit or magnitude error", bit: 2, title: "[^"]*a printed unit that differs[^"]*"/);
assert.equal((guideHtml.match(/Claude, Anthropic/g) || []).length, 1, "The full method appears once");
assert.doesNotMatch(guideHtml, /CatLog v2|independent|AI run|guide-note">Older records/);
assert.doesNotMatch(guideHtml, /e-mail|from-paper (?:record|value|row)|Merged rows|round it, or/, "The Guide uses the site's words: email, records, no serial comma");
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
const emptyIdentityHtml = api.proteinSection({}, {});
assert.match(emptyIdentityHtml, /<h3 id="detail-protein-title">Protein and substrate<\/h3>/);
assert.match(emptyIdentityHtml, /<dt>Sequence<\/dt><dd>None<\/dd>/);
assert.match(emptyIdentityHtml, /<dt>Substrate<\/dt><dd>Not recorded<\/dd>/);
assert.match(emptyIdentityHtml, /<dt>Enzyme form<\/dt><dd>Not recorded<\/dd>/);
assert.doesNotMatch(emptyIdentityHtml, /Sequence note/);
// No sequence found reads None, as a missing SMILES does, not a sentence of its own.
for (const note of ["No sequence was resolved for this record, so variant-aware sequence handling could not be applied.",
  "Mutation context is present, but no sequence was resolved for this record."]) {
  const noneHtml = api.proteinSection({}, { sequence_variant_note: note });
  assert.match(noneHtml, /<dt>Sequence<\/dt><dd>None<\/dd>/);
  assert.match(noneHtml, /<dt>SMILES<\/dt><dd>None<\/dd>/);
  assert.doesNotMatch(noneHtml, /No sequence was found/);
}
const blankFormNoteHtml = api.proteinSection({}, { sequence_variant_note: "   " });
assert.match(blankFormNoteHtml, /<dt>Enzyme form<\/dt><dd>Not recorded<\/dd>/);
assert.doesNotMatch(blankFormNoteHtml, /Sequence note/);
const formNoteHtml = api.proteinSection(
  { sequence_variant_note: "Source says <variant> & unresolved" },
  {},
);
assert.match(formNoteHtml, /<dt>Enzyme form<\/dt><dd>Not recorded<\/dd>/);
// Without a sequence, the Sequence row says why (the note), visible and HTML-escaped, after the enzyme form.
assert.match(
  formNoteHtml,
  /<dt>Sequence<\/dt><dd>Source says &lt;variant&gt; &amp; unresolved<\/dd>/,
  "the form note should be visible and HTML-escaped",
);
assert.ok(
  formNoteHtml.indexOf("Enzyme form") < formNoteHtml.indexOf("Source says"),
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
  "UniProt entry inferred from EC number and organism",
);
assert.equal(
  api.identityResolutionLabel({
    identity_resolution_state: "accession_resolved",
    sequence_source: "uniprot_accession",
  }),
  "UniProt entry",
);
assert.equal(
  api.identityResolutionLabel({
    identity_resolution_state: "identity_unresolved",
    sequence_source: "uniprot_ec_organism_unique",
  }),
  "Not matched to UniProt",
);
const inferredIdentityHtml = api.proteinSection(
  { primary_uniprot_id: "Q12345", sequence_source: "uniprot_accession", sequence_source_confidence: 1 },
  { sequence_source: "uniprot_ec_organism_unique", sequence_source_confidence: 0.6 },
);
assert.match(inferredIdentityHtml, /<dt>UniProt<\/dt><dd><a [^>]*>Q12345<\/a> <span class="identity-how">\(inferred from EC number and organism\)<\/span><\/dd>/);
assert.doesNotMatch(inferredIdentityHtml, /confidence|Sequence source/);
const missingDetailConfidenceHtml = api.proteinSection(
  { primary_uniprot_id: "Q12345", sequence_source: "uniprot_accession", sequence_source_confidence: 1 },
  { sequence_source: "uniprot_ec_organism_unique", sequence_source_confidence: null },
);
assert.match(missingDetailConfidenceHtml, /\(inferred from EC number and organism\)/);
// One UniProt line; the variant's own sequence is named by its note; jargon states read plainly.
{
  const variantHtml = api.proteinSection(
    { primary_uniprot_id: "P22498", mutation_signature: "H150A", wild_type: false },
    { sequence_source: "uniprot_accession", sequence_variant_status: "reconstructed_variant_sequence", wild_type_sequence: "MAAA",
      variant_sequence: "MAAG", sequence_variant_note: "H150A applied to the UniProt canonical sequence" },
  );
  assert.match(variantHtml, /<dt>Enzyme form<\/dt><dd><span class="detail-form">Variant <code class="mutation">H150A<\/code><\/span><\/dd>/);
  assert.match(variantHtml, /<dt>Variant sequence<\/dt><dd><span class="reveal-line"><span class="reveal-summary">4 aa, UniProt P22498 with H150A<\/span>/);
  assert.match(variantHtml, /<dt>Wild-type sequence<\/dt><dd><span class="reveal-line"><span class="reveal-summary">4 aa<\/span>/);
  // Show opens the sequence under its row; Copy copies it.
  assert.match(variantHtml, /aria-expanded="false" aria-controls="detailVariantSequenceBox" data-reveal-target="detailVariantSequenceBox">Show<\/button><button class="text-button copy-button" type="button" aria-live="polite" data-copy-target="detailVariantSequence">Copy<\/button>/);
  assert.match(variantHtml, /<span id="detailVariantSequenceBox" class="copy-field" hidden><code id="detailVariantSequence">MAAG<\/code><\/span>/);
  assert.match(variantHtml, /<dt>UniProt<\/dt><dd><a [^>]*>P22498<\/a><\/dd>/);
  assert.doesNotMatch(variantHtml, /Sequence note|Sequence source|Variant: /);
  const wildHtml = api.proteinSection({ primary_uniprot_id: "P1", wild_type: true },
    { sequence_variant_status: "canonical_wild_type_sequence", wild_type_sequence: "MAAA", sequence_variant_note: "UniProt canonical sequence" });
  assert.match(wildHtml, /<dt>Enzyme form<\/dt><dd>Wild type<\/dd>/);
  assert.match(wildHtml, /<dt>Sequence<\/dt><dd><span class="reveal-line"><span class="reveal-summary">4 aa<\/span>/, "a wild-type record's sequence is its Sequence");
  assert.doesNotMatch(wildHtml, /Sequence note|UniProt canonical sequence/);
  assert.match(api.proteinSection({}, { identity_resolution_state: "sequence_resolved_no_accession", sequence: "MAAA" }),
    /<dt>UniProt<\/dt><dd>Sequence known, no UniProt entry<\/dd>/);
  assert.match(api.proteinSection({}, { identity_resolution_state: "candidate_pool", uniprot_candidate_ids: ["P1", "P2"] }),
    /<dt>UniProt<\/dt><dd>Several possible UniProt entries<div class="reference-list">/);
  const unmatched = api.proteinSection({ mutation_signature: "R269A/N270A" }, { identity_resolution_state: "identity_unresolved",
    sequence_source: "manual_literature_uniprot_resolution",
    sequence_variant_note: "Resolved sequence already matches the mutant residue(s), so it is treated as a source-provided variant sequence." });
  assert.match(unmatched, /<dt>UniProt<\/dt><dd>Not matched to UniProt<\/dd>/);
  assert.match(unmatched, /<dt>Sequence<\/dt><dd>None<\/dd>/);
  assert.doesNotMatch(unmatched, /shown as the variant sequence|from the cited paper/, "no note about a sequence that is not shown");
  assert.match(api.proteinSection({ mutation_signature: "R269A/N270A" }, { sequence: "MA",
    sequence_variant_note: "Resolved sequence already matches the mutant residue(s), so it is treated as a source-provided variant sequence." }),
    /The sequence already carries the mutant residues; shown as the variant sequence\./);
  assert.match(api.proteinSection({ primary_uniprot_id: "P2" }, { sequence_source: "manual_literature_uniprot_resolution", sequence: "MA" }),
    /\(from the cited paper\)/);
}
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
    accepted: 3, manual_review_required: 1, not_verified: 1, unverified: 1, mathematically_inferred: 0, disputed: 1,
    kcat: 5, km: 6, kcat_over_km: 2, sequence: 4, smiles: 5,
  }, "Stats uses the manifest's counts; Unverified and Not reviewed sit under Not checked");
  assert.deepEqual(headings(), ["Review result", "Source", "What the records contain"]);
  // Figures and tables are numbered in reading order, each with its caption and a data line.
  assert.match(element("statsCharts").innerHTML, /<strong>Figure 1\.<\/strong> Review result of every record/);
  assert.match(element("statsCharts").innerHTML, /<strong>Table 1\.<\/strong> Records with each value or field/);
  // The review result is a donut (the one partition that is a true whole) beside its legend table; Accepted is split in
  // the rows under it.
  assert.match(element("statsCharts").innerHTML, /<svg class="stats-donut" viewBox="0 0 200 200" role="img" aria-label="Review result of all records: 6 records\. Accepted 3 \(50\.0%\); Not confirmed 1 \(16\.7%\); Not checked \(Unverified\) 1 \(16\.7%\); Disputed 1 \(16\.7%\)\."/);
  assert.match(element("statsCharts").innerHTML, /<path class="stats-part-unverified" d="[^"]+"><title>Not checked \(Unverified\): 1 \(16\.7%\)<\/title>/);
  assert.equal((element("statsCharts").innerHTML.match(/<path class="stats-part-/g) || []).length, 4, "One slice per review result with records");
  assert.match(element("statsCharts").innerHTML, /data-part="accepted_printed" data-count="2"[\s\S]*?As printed/);
  assert.doesNotMatch(element("statsCharts").innerHTML, /Agreement with human reviewers/, "No lead without agreement counts");
  assert.equal(element("statsLead").innerHTML, "", "No lead without agreement counts");
  assert.equal(element("statsLead").hidden, true, "An empty lead takes no room");
  assert.equal(element("statsScope").textContent, "All 6 records in this snapshot. Select a name to see those records in Browse.");
  assert.equal((element("statsCharts").innerHTML.match(/Select a (linked )?name/g) || []).length, 0, "Said once, under the heading");
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
  assert.match(chart, /#browse\?status=curation_pending">Not confirmed<\/a>/);
  assert.match(chart, /#browse\?status=not_verified">Not checked<\/a>/);
  assert.match(chart, /title="2 as printed, 1 after a correction\."/, "Without an overview, Accepted splits as the manifest does");
  assert.doesNotMatch(chart, /Checks pending|Other records/);
  assert.match(chart, /#browse\?metric=kcat_over_km"/);
  assert.doesNotMatch(chart, /status=unverified|status=mathematically_inferred/, "Unverified and Not reviewed have no single Browse filter here");
  // Disputed has its own Browse key (status=not_verified opens Not checked only).
  assert.match(chart, /#browse\?status=disputed">Disputed<\/a>/);
  // Under the review rules (an export that counts accepted_basis) the records without a paper are Not checked, and
  // Accepted names the records a human reviewer's approval accepted.
  {
    const saved = runtimeManifest.summary.distributions;
    runtimeManifest.summary.distributions = { ...saved, accepted_basis: [{ label: "human review", count: 1 }] };
    api.renderStats();
    const ruled = element("statsCharts").innerHTML;
    assert.match(ruled, /1 records have no PMID or DOI linked, so their values cannot be traced to a paper; they are counted under Not checked, not Accepted\./);
    assert.doesNotMatch(ruled, /accepted records have no PMID/);
    assert.match(ruled, /1 as printed, 1 after a correction, 1 after a human reviewer approved every value\./);
    assert.match(ruled, /data-part="accepted_human" data-count="1"/);
    runtimeManifest.summary.distributions = saved;
    api.renderStats();
  }
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
    main_sources: { catlog: { verified: 2 }, brenda: { manual_review_required: 1, unverified: 1, disputed: 1 }, oed: { corrected: 1 } },
  };
  runtimeManifest.summary.overview = overview;
  api.renderStats();
  chart = element("statsCharts").innerHTML;
  const totalsHtml = element("statsTotals").innerHTML;
  for (const [label, value] of [["Human-checked", 1], ["Read from the paper by CatLog", 2], ["Papers", 5], ["Enzymes", 3], ["EC numbers", 4], ["Organisms", 2], ["Substrates", 6]]) {
    assert.match(totalsHtml, new RegExp(`${label.replace(/[()]/g, "\\$&")}</dt><dd>${value}`));
  }
  assert.match(totalsHtml, /from 1 papers/);
  assert.deepEqual(headings(), ["Review result", "Records by main source", "Checks on the values", "Enzyme classes", "Value ranges",
    "Most common organisms", "Most common EC numbers", "What the records contain", "Wild type and variants", "Cautions"]);
  // Wild type and variants and Cautions have their data line under the caption, like every other figure and table.
  assert.match(chart, /Records by enzyme form, as the table tags it\.<\/span><span class="stats-fig-data">[^<]*Shares of all records\./);
  assert.match(chart, /a record can carry more than one\.<\/span><span class="stats-fig-data">[^<]*Shares of all records\./);
  // Figure 2: each record once under its main source, coloured by review result; only CatLog's own records are linked.
  assert.match(chart, /data-row="brenda" data-count="3"[\s\S]*?<span class="stats-chart-value">3 <span class="stats-muted">0\.0%<\/span>/);
  assert.match(chart, /data-row="catlog" data-count="2"[\s\S]*?#browse\?source=paper">Read from the paper by CatLog<\/a>/);
  assert.match(chart, /data-row="oed" data-count="1"[\s\S]*?class="stats-seg stats-part-accepted" style="left:0%;width:33\.3333%"/);
  assert.match(chart, /BRENDA, Not confirmed: 1/);
  // Main-source counts that do not add up to the review results are not drawn by status.
  runtimeManifest.summary.overview = { ...overview, main_sources: { catlog: { verified: 9 } } };
  api.renderStats();
  assert.doesNotMatch(element("statsCharts").innerHTML, /BRENDA, Not confirmed/);
  runtimeManifest.summary.overview = overview;
  api.renderStats();
  assert.ok(chart.includes("Read from the paper by an AI model; a second, separate AI check compared each value with the paper; AI audits and human reviewers then check samples against the papers."));
  // Every caption is "Figure N." or "Table N." and one sentence.
  const captions = chart.match(/<span class="stats-fig-caption">[\s\S]*?<\/span>(?=<span class="stats-fig-data">|<\/figcaption>)/g) || [];
  assert.ok(captions.length >= 3, "Stats has numbered captions");
  for (const caption of captions) {
    const sentence = caption.replace(/<[^>]+>/g, "").replace(/^\s*(Figure|Table) \d+\.\s*/, "").trim();
    assert.doesNotMatch(sentence, /\.\s+[A-Z]/, `One sentence per caption: ${sentence}`);
  }
  assert.match(chart, /href="https:\/\/example\.test\/tools\/catlog-latest\.html#guide-method">How CatLog reads and checks values <span aria-hidden="true">→<\/span><\/a>/);
  assert.doesNotMatch(chart, /independent|AI run|separate AI run/);
  assert.match(chart, /<tr data-check="second_check">[\s\S]*?#browse\?source=paper">2 records<\/a> from 1 papers/);
  assert.match(chart, /<tr data-check="human_checked">[\s\S]*?#browse\?checked=1">1 accepted records<\/a>[\s\S]*?A reviewer approved every value; reviewers looked at 2 records/);
  assert.doesNotMatch(chart, /AI audits<\/th>|data-check="audit"|wrong number or unit/, "Without overview.quality there is no audit row and no accuracy");
  // The Guide's method section gets the same human-review number; its audit item keeps the words without numbers.
  element("guideMethodAudits").textContent = "static audits";
  element("guideMethodHuman").textContent = "static human";
  api.renderGuideMethod();
  assert.equal(element("guideMethodLead").hidden, true, "No agreement line without agreement counts");
  assert.equal(element("guideMethodAudits").textContent, "static audits");
  assert.equal(element("guideMethodHuman").textContent, "1 accepted records are human-checked: a human reviewer approved every value they show.");
  // With the audit and review results (overview.quality, copied from the human-review marks file at build time).
  runtimeManifest.summary.overview = { ...overview, quality: { as_of: "2026-10-11", audit_values: 742, audit_wrong: 2,
    compared_values_v1: 2431, compared_papers_v1: 312, wrong_v1: 9, label_or_annotation_v1: 114, v2_found: 2160,
    v2_approved_total: 2380, v2_differences_checked: 504, v2_wrong: 0 } };
  api.renderStats();
  const qualityChart = element("statsCharts").innerHTML;
  assert.deepEqual(headings().slice(0, 3), ["Review result", "Records by main source", "Checks on the values"]);
  assert.match(qualityChart, /<tr data-check="audit"><th scope="row">AI audits<\/th><td>742 values<\/td>[\s\S]*?<td>740 kept; 2 were wrong \(0\.3%\) and removed \(as of Oct 11, 2026\)<\/td>/);
  // The share correct is never shown without the label errors beside it.
  assert.match(qualityChart, /<tr data-check="earlier"><th scope="row">Human review of the earlier catalog<\/th><td>2,431 values on 312 papers, approved or not<\/td>/);
  assert.match(qualityChart, /<td>9 wrong number or unit \(99\.6% correct\); 114 wrong label<\/td>/);
  assert.match(qualityChart, /<tr data-check="agreement">[\s\S]*?<td>2,380 values<\/td>[\s\S]*?CatLog found 2,160; none of the 504 where it differed was wrong against the paper<\/td>/);
  api.renderGuideMethod();
  assert.equal(element("guideMethodAudits").textContent, "742 values re-checked against their papers by a separate AI auditor that tries to find errors; 2 were wrong (0.3%) and removed. As of Oct 11, 2026.");
  // the comparison with human reviewers comes first, then the human-checked count
  assert.match(element("guideMethodHuman").textContent, /^In the earlier catalog, 9 of 2,431 values.* 1 accepted records are human-checked: a human reviewer approved every value they show\.$/);
  // Numbers that do not hold together are not shown: the share correct never appears without the label errors.
  runtimeManifest.summary.overview = { ...overview, quality: { audit_values: 5, audit_wrong: 6, compared_values_v1: 10, wrong_v1: 1,
    v2_approved_total: 4, v2_found: 3, v2_differences_checked: 2, v2_wrong: 2 } };
  api.renderStats();
  const partialChart = element("statsCharts").innerHTML;
  assert.doesNotMatch(partialChart, /AI audits<\/th>|% correct/);
  assert.match(partialChart, /CatLog found 3; 2 of the 2 where it differed were wrong against the paper/);
  // The lead: agreement with human reviewers (overview.quality.agreement), shown first; the first comparison on papers
  // read without database values in view is the headline when the snapshot has it.
  const agreementFixture = { papers_compared: 98, values_approved: 2489, agree: 2232, agree_pct: 89.7, differ: 257,
    differ_catlog_right: 109, differ_earlier_value_error: 9, differ_earlier_label_error: 100, differ_same_value_other_name: 16,
    differ_rounding: 3, differ_catlog_wrong: 0, differ_not_comparable: 24, differ_not_adjudicated: 105, stated_values: 58,
    stated_values_catlog_has: 53 };
  runtimeManifest.summary.overview = { ...overview, quality: { as_of: "2026-10-12", audit_values: 973, audit_wrong: 2, agreement: agreementFixture } };
  // The Team loop draws CatLog's number on two lines and its label reads it as one phrase.
  api.renderTeam();
  assert.match(element("teamFigure").innerHTML, /aria-label="CatLog: 973 values re-checked by AI audits"/);
  assert.match(element("teamFigure").innerHTML, />973 values re-checked<\/text><text class="team-station-number"[^>]*>by AI audits<\/text>/);
  // Without the blind headline, Human check gives the share of approved values matched (never "agreement" alone).
  assert.match(element("teamFigure").innerHTML, /aria-label="Human check: 89\.7% of approved values matched[",]/);
  assert.doesNotMatch(element("teamFigure").innerHTML, /% agreement/);
  api.renderStats();
  // The lead has its own slot above the headline counts: the first thing on the page after the title.
  let lead = element("statsLead").innerHTML;
  assert.equal(element("statsLead").hidden, false);
  assert.doesNotMatch(element("statsCharts").innerHTML, /Agreement with human reviewers/, "The lead is not repeated among the figures");
  assert.match(lead, /<h2 id="statsAgreementTitle">Agreement with human reviewers<\/h2>/);
  assert.match(lead, /<div class="stats-lead-figure"><strong>89\.7%<\/strong><span>of the values human reviewers approved are the same in CatLog<\/span><\/div>/);
  assert.match(lead, /CatLog has the same value for 2,232 of the 2,489 values human reviewers approved, on 98 papers they checked that CatLog has since read\./);
  // The bar splits the approved values: the same, then the differences as CatLog's check against the paper found them.
  for (const [part, width] of [["same", "89\\.6746"], ["differs", "4\\.3793"], ["rounding", "0\\.7634"], ["neutral", "0\\.9642"], ["open", "4\\.2186"]]) {
    assert.match(lead, new RegExp(`stats-seg stats-part-${part}" style="left:[0-9.]+%;width:${width}%`), part);
  }
  assert.doesNotMatch(lead, /stats-part-magnitude" style/, "No segment for a zero count");
  // ... but the legend still says the paper shows CatLog wrong in none of the differences, and how many were checked.
  assert.match(lead, /<i class="stats-swatch stats-part-magnitude" aria-hidden="true"><\/i><span>The paper shows CatLog wrong <span class="stats-legend-count">0<\/span>/);
  assert.match(lead, /Differences checked against the paper<\/dt><dd>152 of 257; CatLog wrong in none<\/dd>/);
  assert.match(lead, /Missing values reviewers named<\/dt><dd>58; CatLog has 53/);
  // Where the paper shows CatLog right, what the earlier catalog had wrong (the README's split).
  // The 100 label errors belong to these 109 approved values, not to Table 1's count of every value compared.
  assert.match(lead, /The paper shows CatLog right in 109 of the approved values that differ; of these 109, the earlier catalog&#39;s value is not printed in the paper \(9\) or has a wrong enzyme, organism, substrate, variant or protein label \(100\)\./);
  assert.doesNotMatch(lead, /Same value<\/dt>/, "Without a first comparison the big number already gives the same-value count");
  assert.match(element("statsCharts").innerHTML, /<td>2,232 the same in CatLog \(89\.7%\)<\/td>/, "No first comparison: the count stands alone");
  assert.match(lead, /href="https:\/\/example\.test\/tools\/catlog-latest\.html#team">People behind CatLog/);
  assert.doesNotMatch(lead, /independent|AI run|Claude|Codex/);
  // The Guide's method section opens with the same agreement, in one sentence linked to Stats.
  api.renderGuideMethod();
  assert.equal(element("guideMethodLead").hidden, false);
  assert.equal(element("guideMethodLead").innerHTML, '<span class="guide-method-lead-title">Agreement with human reviewers</span> CatLog has the same value as human reviewers for <strong>89.7%</strong> of the values they approved: 2,232 of 2,489, on 98 papers they checked that CatLog has since read. <a href="https://example.test/tools/catlog-stats.html">More on Stats</a>');
  const blindFixture = { ...agreementFixture, first_agree: 2110, first_agree_pct: 84.8, fixed_after_comparison: 122, papers_exposed: 40,
    first_agree_unexposed_pct: 84.7, catlog_value_wrong: 3, rejected_values: 20, rejected_catlog_also_without: 12,
    rejected_catlog_has_same: 8, rejected_dropped_after_audit: 2, rejected_kept_after_audit: 2, rejected_cleared_by_paper_check: 1,
    rejected_changed_since: 1, rejected_pending: 2, rejected_not_value: 4 };
  runtimeManifest.summary.overview = { ...overview, quality: { as_of: "2026-10-12", agreement: blindFixture } };
  api.renderStats();
  lead = element("statsLead").innerHTML;
  // The blind headline is said one way (Stats' lead, the Guide, Team): the first comparison, before any fix, on the papers
  // read blind, with what that means; the first comparison on all papers and the count after fixes come after it.
  assert.match(lead, /<strong>84\.7%<\/strong><span>of approved values matched at the first comparison, on the 58 papers read blind<\/span>/);
  assert.match(lead, /<p class="stats-lead-sentence">At the first comparison, before any fix, CatLog matched 84\.7% of the values human reviewers approved on the 58 papers read blind \(CatLog&#39;s readers never opened database or earlier-catalog files\)\.<\/p>/);
  assert.match(lead, /First comparison, all papers<\/dt><dd>2,110 matched \(84\.8%\)/);
  assert.match(lead, /Now, after fixes<\/dt><dd>2,232 matched \(89\.7%\)/);
  assert.match(lead, /Matched \(the same value\): the same paper/);
  // Table 1 beside that lead says its agreement count is the one after fixes; its bars are grey, as in the other tables.
  assert.match(element("statsCharts").innerHTML, /<tr data-check="agreement">[\s\S]*?<td>2,232 the same in CatLog now, after fixes \(89\.7%\)<\/td>/);
  const checksTable = element("statsCharts").innerHTML.match(/<table class="stats-table stats-checks-table">[\s\S]*?<\/table>/)[0];
  assert.match(checksTable, /stats-minibar"><span class="stats-seg stats-part-neutral"/);
  assert.doesNotMatch(checksTable, /stats-minibar"><span class="stats-seg stats-part-(?!neutral)/);
  assert.match(lead, /Wrong number or unit in CatLog<\/dt><dd>3</);
  // What became of the values reviewers called wrong that CatLog had with the same number: parts of that number.
  assert.match(lead, /Reviewers called 20 values wrong on these papers: CatLog did not have 12 of them; it had 8 with the same number \(an AI audit kept 2, 2 were dropped after an AI audit found them wrong, a check against the paper found 1 right, CatLog has changed or removed 1 since and 2 are not settled yet\)\. 4 other objections dispute no value shown \(a value missing, a duplicate, the DOI or a name\)\./);
  api.renderGuideMethod();
  assert.match(element("guideMethodLead").innerHTML, /<\/span> At the first comparison, before any fix, CatLog matched <strong>84\.7%<\/strong> of the values human reviewers approved on the 58 papers read blind \(CatLog&#39;s readers never opened database or earlier-catalog files\)\. <a /);
  assert.match(api.agreementText(blindFixture), /^At the first comparison, before any fix, CatLog matched 84\.7% of the values human reviewers approved on the 58 papers read blind \(CatLog's readers never opened database or earlier-catalog files\)\. On all 98 papers .*CatLog matched 2,110 of the 2,489 approved values at the first comparison \(84\.8%\) and matches 2,232 now, after fixes \(89\.7%\)\. Of the 257 that differ/);
  // The headline is said with its 95% range and the papers behind it as the CatLog side counts them (papers_unexposed,
  // not papers_compared minus papers_exposed); the errors the first comparison found are named, and what was fixed is
  // said against them.
  const rangeFixture = { ...blindFixture, papers_compared: 160, papers_exposed: 30, papers_unexposed: 122,
    first_agree_unexposed_pct: 85.3, first_agree_unexposed_ci95: "79.7-90.6", first_catlog_errors: 69,
    first_catlog_errors_value: 0, first_catlog_errors_label: 68, first_catlog_errors_missed: 1, fixed_after_comparison: 69 };
  runtimeManifest.summary.overview = { ...overview, quality: { as_of: "2026-10-12", agreement: rangeFixture } };
  api.renderStats();
  lead = element("statsLead").innerHTML;
  assert.match(lead, /<strong>85\.3%<\/strong><span class="stats-lead-range">95% range 79\.7–90\.6%<\/span><span>of approved values matched/);
  assert.match(lead, /At the first comparison, before any fix, CatLog matched 85\.3% \(95% range 79\.7–90\.6%\) of the values human reviewers approved on the 122 papers read blind \(CatLog&#39;s readers never opened database or earlier-catalog files\)\./);
  assert.match(lead, /<span class="stats-lead-range">95% range 79\.7–90\.6%<\/span><span>of approved values matched at the first comparison, on the 122 papers read blind<\/span>/);
  // Team's Human check says it shortened, the range and the papers read blind included: two drawn lines on the wide
  // loop, four on the upright one, one phrase for its label.
  api.renderTeam();
  const teamHtml = element("teamFigure").innerHTML;
  assert.equal((teamHtml.match(/aria-label="Human check: 85\.3% matched \(95% range 79\.7–90\.6%\) at the first comparison, on 122 papers read blind[",]/g) || []).length, 2);
  const humanLines = (layout) => [...teamHtml.match(new RegExp(`class="team-loop team-loop-${layout}"[\\s\\S]*?</svg>`))[0]
    .match(/data-station="human"[\s\S]*?<\/g>/)[0].matchAll(/class="team-station-number"[^>]*>([^<]*)</g)].map((match) => match[1]);
  assert.deepEqual(humanLines("wide").slice(0, 2), ["85.3% matched (95% range 79.7–90.6%)", "first comparison, 122 papers read blind"]);
  assert.deepEqual(humanLines("narrow").slice(0, 4), ["85.3% matched", "95% range 79.7–90.6%", "first comparison,", "122 papers read blind"]);
  // The Guide's lead says the same sentence, the range included.
  api.renderGuideMethod();
  assert.match(element("guideMethodLead").innerHTML, /<\/span> At the first comparison, before any fix, CatLog matched <strong>85\.3%<\/strong> \(95% range 79\.7–90\.6%\) of the values human reviewers approved on the 122 papers read blind \(CatLog&#39;s readers never opened database or earlier-catalog files\)\. <a /);
  assert.match(lead, /Errors found at the first comparison<\/dt><dd>68 wrong labels, 1 missed value, 0 wrong numbers or units<\/dd>/);
  assert.match(lead, /Fixed after the comparison<\/dt><dd>all 69<\/dd>/);
  assert.match(api.agreementText(rangeFixture), /matched 85\.3% \(95% range 79\.7–90\.6%\) of the values human reviewers approved on the 122 papers read blind .* The first comparison found 68 label or annotation errors in CatLog \(a UniProt entry, substrate structure or variant field\), 1 missed value and 0 wrong numbers or units; all 69 are fixed since\. Of the 257/);
  // A range that is not two percentages in order, or a split that does not add up, is not shown (the total stays).
  const unsure = { ...rangeFixture, first_agree_unexposed_ci95: "90.6-79.7", first_catlog_errors_label: 60, fixed_after_comparison: 40 };
  runtimeManifest.summary.overview = { ...overview, quality: { agreement: unsure } };
  api.renderStats();
  lead = element("statsLead").innerHTML;
  assert.doesNotMatch(lead, /95% range|stats-lead-range|wrong labels/);
  assert.match(lead, /Errors found at the first comparison<\/dt><dd>69<\/dd>/);
  assert.match(lead, /Fixed after the comparison<\/dt><dd>40 of 69<\/dd>/);
  assert.doesNotMatch(api.agreementText(unsure), /The first comparison found/);
  // Values of CatLog's own records that reviewers checked directly, with what an AI audit then found.
  runtimeManifest.summary.overview = { ...overview, quality: { agreement: { ...blindFixture, direct_records_reviewed: 12,
    direct_values_reviewed: 30, direct_values_agree: 26, direct_values_disagree: 3, direct_values_other: 1,
    direct_disagree_wrong_after_audit: 1, direct_disagree_audit_pending: 2 } } };
  api.renderStats();
  assert.match(element("statsLead").innerHTML, /Reviewers checked 30 values of CatLog&#39;s own records directly: they approved 26 and disputed 3; an AI audit found 1 of those wrong and 2 are not audited yet\./);
  // Direct counts that do not add up say no audit split, and none at all are not mentioned.
  runtimeManifest.summary.overview = { ...overview, quality: { agreement: { ...blindFixture, direct_values_reviewed: 30,
    direct_values_agree: 26, direct_values_disagree: 3, direct_disagree_wrong_after_audit: 3, direct_disagree_audit_pending: 2 } } };
  api.renderStats();
  assert.match(element("statsLead").innerHTML, /they approved 26 and disputed 3\./);
  runtimeManifest.summary.overview = { ...overview, quality: { agreement: { ...blindFixture, direct_values_reviewed: 0 } } };
  api.renderStats();
  assert.doesNotMatch(element("statsLead").innerHTML, /Reviewers checked/);
  // Zero parts are left out; none dropped yet still says the rest.
  const rejectedLead = (fields) => {
    runtimeManifest.summary.overview = { ...overview, quality: { agreement: { ...blindFixture, rejected_dropped_after_audit: 0,
      rejected_changed_since: 0, rejected_pending: 0, ...fields } } };
    api.renderStats();
    return element("statsLead").innerHTML.match(/Reviewers called [^<]*/)?.[0] || "";
  };
  assert.match(rejectedLead({ rejected_values: 9, rejected_catlog_also_without: 0, rejected_catlog_has_same: 9,
    rejected_kept_after_audit: 4, rejected_cleared_by_paper_check: 5 }),
  /^Reviewers called 9 values wrong on these papers: CatLog had all 9 with the same number \(an AI audit kept 4 and a check against the paper found 5 right\)\. /);
  assert.match(rejectedLead({ rejected_values: 9, rejected_catlog_also_without: 0, rejected_catlog_has_same: 9,
    rejected_kept_after_audit: 4, rejected_cleared_by_paper_check: 4, rejected_dropped_after_audit: 1 }),
  /\(an AI audit kept 4, 1 was dropped after an AI audit found it wrong and a check against the paper found 4 right\)/);
  assert.match(rejectedLead({ rejected_values: 3, rejected_catlog_also_without: 3, rejected_catlog_has_same: 0 }),
    /^Reviewers called 3 values wrong on these papers: CatLog did not have any of them\. /);
  // An older build without rejected_changed_since still says the other parts; parts adding up to more than the whole are
  // left out.
  assert.match(rejectedLead({ rejected_changed_since: undefined, rejected_pending: 3 }),
    /it had 8 with the same number \(an AI audit kept 2, a check against the paper found 1 right and 3 are not settled yet\)/);
  assert.match(rejectedLead({ rejected_kept_after_audit: 5, rejected_pending: 4 }), /: CatLog did not have 12 of them; it had 8 with the same number\. /);
  // Rejections that do not add up are not summed.
  runtimeManifest.summary.overview = { ...overview, quality: { agreement: { ...blindFixture, rejected_values: 21 } } };
  api.renderStats();
  assert.doesNotMatch(element("statsLead").innerHTML, /Reviewers called/);
  assert.match(element("statsLead").innerHTML, /4 other objections dispute no value shown/, "Objections that dispute no value are said on their own");
  // Figures 3-5 when the CatLog side's counts are in overview.quality; numbered after figure 2.
  runtimeManifest.summary.overview = { ...overview, quality: {
    db_compare: { kcat: { same: 9, differs: 1, absent: 0 }, km: { same: 3, differs: 0, absent: 1 }, calculated: 2, papers_all_absent: 1, papers_some_absent: 2 },
    earlier_corrections: { records: 5, values: { kcat: { rounding: 1, different: 2, magnitude: 0, added: 1 } }, before_listed: [3, 4] },
    replaced: { records: 7, accepted: 2, papers: 1, values: { kcat: [5, 6], km: [2, 2] } } } };
  api.renderStats();
  const figures = element("statsCharts").innerHTML;
  assert.deepEqual(headings().slice(0, 5), ["Review result", "Records by main source", "Values read from the paper against the databases",
    "Corrections on records accepted after a correction", "Earlier records of papers CatLog has read"]);
  assert.match(figures, /<strong>Figure 3\.<\/strong> Values CatLog read from the paper/);
  assert.match(figures, /data-row="all" data-count="14"/);
  assert.match(figures, /a different number does not mean the database is wrong\. 2 kcat\/Km calculated by CatLog are not compared\. For 1 paper no database lists any of the parameters CatLog read from it; for 2 more, the databases list some of them but not all\./);
  assert.match(figures, /for 3 of 4 changed values \(75\.0%\)/);
  assert.match(figures, /The 7 earlier records \(2 accepted\) of the 1 paper that CatLog has read and the earlier catalog also had: /);
  // Figure 4 counted for another snapshot names both counts of records accepted after a correction (figure 1 has the
  // snapshot's own); with the same count it names one.
  const correctedNow = runtimeManifest.summary.distributions.verification_status.find((item) => item.label === "corrected")?.count;
  assert.ok(Number.isInteger(correctedNow) && correctedNow !== 5);
  assert.match(figures, new RegExp(`by kind of change, on the 5 records accepted after a correction when counted; Figure 1 counts ${correctedNow} in this snapshot\\.`));
  runtimeManifest.summary.overview = { ...overview, quality: { as_of: "2026-10-12", earlier_corrections: { records: correctedNow,
    values: { kcat: { rounding: 1, different: 2, magnitude: 0, added: 1 } } } } };
  api.renderStats();
  assert.match(element("statsCharts").innerHTML, new RegExp(`on the ${correctedNow} records? accepted after a correction, by kind of change\\.`));
  runtimeManifest.summary.overview = { ...overview, quality: { as_of: "2026-10-12", earlier_corrections: { records: correctedNow + 1,
    values: { kcat: { rounding: 1, different: 2, magnitude: 0, added: 1 } } } } };
  api.renderStats();
  assert.match(element("statsCharts").innerHTML, /accepted after a correction when counted \(Oct 12, 2026\); Figure 1 counts \d+ in this snapshot\./);
  // With no paper missing every parameter, the papers missing one are counted on their own.
  runtimeManifest.summary.overview = { ...overview, quality: { db_compare: { kcat: { same: 9, differs: 1, absent: 0 }, papers_all_absent: 0, papers_some_absent: 1 } } };
  api.renderStats();
  assert.match(element("statsCharts").innerHTML, /wrong\. For 1 paper the databases list some of the parameters CatLog read from it but not all\./);
  // A figure whose counts are not whole numbers is not drawn (never an empty heading).
  runtimeManifest.summary.overview = { ...overview, quality: { db_compare: { kcat: { same: "9", differs: 1, absent: 0 } },
    replaced: { records: 7, values: { kcat: [8, 6] } } } };
  api.renderStats();
  assert.doesNotMatch(element("statsCharts").innerHTML, /against the databases|Earlier records of papers/);
  assert.equal(api.humanComparisonText({ quality: { v2_approved_total: 4, v2_found: 3 } }), "CatLog found 3 of the 4 values reviewers approved.");
assert.equal(api.agreementText({ papers_compared: 98, values_approved: 2489, agree: 2232, differ: 257, differ_catlog_right: 109,
  differ_catlog_wrong: 0, differ_not_adjudicated: 105 }),
  "On 98 papers human reviewers checked that CatLog has since read, CatLog has the same value for 2,232 of the 2,489 values the reviewers approved (89.7%). Of the 257 that differ, 152 were checked against the paper: CatLog was right in 109 and wrong in none; 43 are the same value under another name, a rounding or a value CatLog leaves out by its reading rules. 105 are not checked yet.");
  assert.equal(api.humanComparisonText({ quality: { compared_values_v1: 1000, wrong_v1: 0, label_or_annotation_v1: 0 } }),
    "In the earlier catalog, 0 of 1,000 values reviewers compared had a wrong number or unit (100.0% correct), and 0 had a wrong enzyme, organism, substrate, variant or protein label.");
  runtimeManifest.summary.overview = overview;
  api.renderStats();
  assert.match(chart, /#browse\?ec=1\.">EC 1/);
  assert.match(chart, /#browse\?ec=1\.1\.1\.1"/);
  assert.match(chart, /#browse\?organism=Homo\+sapiens"><i>Homo sapiens<\/i>/);
  assert.match(chart, /&lt;b&gt;Escherichia&lt;\/b&gt; coli/, "Names from the data are escaped");
  assert.match(chart, /#browse\?variant=wild">Wild type/);
  assert.match(chart, /#browse\?caution=differs"/);
  assert.match(chart, /#browse\?caution=none">No cautions/);
  assert.match(chart, /data-stat-key="source_catlog" data-count="2"[\s\S]*?#browse\?source=paper">Read from the paper by CatLog<\/a>/);
  assert.doesNotMatch(chart, /source_paper_earlier|CatLog v2/, "No earlier paper extractions here; no version name");
  assert.doesNotMatch(chart, /source=other/, "Other has no single Browse filter");
  assert.doesNotMatch(chart + element("statsTotals").innerHTML, /CatLog v2/, "The version name is never public");
  // With earlier paper extractions, they are their own row, linked to their By database choice.
  runtimeManifest.summary.overview = { ...overview, sources: { ...overview.sources, paper: 3 }, from_paper: { records: 2, papers: 1 } };
  api.renderStats();
  assert.match(element("statsCharts").innerHTML, /data-stat-key="source_paper_earlier" data-count="1">[\s\S]*?#browse\?source=earlier_paper">Earlier paper extractions<\/a>/);
  runtimeManifest.summary.overview = overview;
  api.renderStats();
  const breakdown = readBreakdown();
  assert.equal(breakdown.wild + breakdown.variant + breakdown.not_stated, 6);
  assert.equal(breakdown.source_catlog + breakdown.source_brenda + breakdown.source_oed, 6);
  assert.equal(breakdown.temperature, 4);
  assert.equal(breakdown.ph, 5);
  assert.match(chart, /3 records give both temperature and pH/);
  assert.match(chart, /data-stat-key="ec_1" data-count="4"[\s\S]*?<span class="stats-chart-value">4 <span class="stats-muted">2<\/span>/);
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
  // A percentile of 1,000 or more prints with thousands separators, like the counts; 100,000 and over as a power of ten.
  const wide = api.statsValueRange({ key: "kcat_over_km", html: "kcat/Km", unit: "s⁻¹ mM⁻¹" }, { n: 3, median: 17, p10: 0.067, p90: 2300, log10_start: -2, counts: [1, 1, 0, 0, 0, 1] });
  assert.match(wide, /<dt>10–90%<\/dt><dd>0\.067 – 2,300<\/dd>/);
  assert.match(wide, /10% above 2,300; 3 values\./);
  assert.match(api.statsValueRange({ key: "kcat", html: "kcat", unit: "s⁻¹" }, { n: 2, median: 1250.5, p10: 2, p90: 250000, log10_start: 0, counts: [1, 0, 0, 0, 0, 1] }),
    /<dd>1,250\.5<\/dd>[\s\S]*<dd>2 – <span class="scientific-number"[^>]*><span aria-hidden="true">2\.5 &times; 10<sup>5<\/sup>/);

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

  // Tables, bars, shares and links.
  const halfBar = api.statsTable([{ value: "example", label: "Example", count: 3 }], 6);
  assert.match(halfBar, /width:50%/);
  assert.match(halfBar, /50\.0%/);
  assert.match(api.statsTable([{ value: "test", label: "<unsafe>", count: 0 }], 0), /width:0%/);
  assert.doesNotMatch(api.statsTable([{ value: "test", label: "<unsafe>", count: 0 }], 0), /<unsafe>/);
  // Stacked segments stay inside their bar; an overlay draws each from the left.
  const stacked = api.statsBarChart({ key: "t", scale: 10, rows: [{ key: "a", count: 9, label: "A", value: "9",
    segments: [{ part: "accepted", count: 6 }, { part: "pending", count: 6 }] }] });
  assert.match(stacked, /stats-part-accepted" style="left:0%;width:60%"[\s\S]*stats-part-pending" style="left:60%;width:40%"/);
  assert.match(api.statsBarChart({ key: "t", scale: 10, overlay: true, rows: [{ key: "a", count: 9, label: "A", value: "9",
    segments: [{ part: "records", count: 8 }, { part: "accepted", count: 2 }] }] }), /stats-part-accepted" style="left:0%;width:20%"/);
  // Axis ends: three to five whole steps ending closest above the largest value.
  assert.equal(JSON.stringify(api.statsNiceScale(81355)), JSON.stringify({ max: 90000, step: 30000 }));
  assert.equal(JSON.stringify(api.statsNiceScale(59012)), JSON.stringify({ max: 60000, step: 20000 }));
  assert.equal(JSON.stringify(api.statsNiceScale(7)), JSON.stringify({ max: 8, step: 2 }));
  // A donut of one part is a whole ring (two half arcs), with no gap lines.
  const ring = api.statsDonut([{ part: "accepted", label: "Accepted", count: 4 }], 4, { title: "Test" });
  assert.equal((ring.match(/A88 88/g) || []).length, 2);
  assert.doesNotMatch(ring, /stats-donut-gap/);
  assert.doesNotMatch(ring, /NaN/);
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
  assert.doesNotMatch(unaccepted, /Not confirmed/, "A group without its own counts gets no column");
  assert.match(unaccepted, /<tr data-field="with_smiles"><th scope="row">Substrate SMILES<\/th><td data-cohort="unverified" data-count="1">1<small>100\.0%<\/small>/);
  assert.match(unaccepted, /does not give the reason for a review result/);
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
  assert.match(badge, /title="Accepted after a correction in the earlier automated review; the record shows the changes when the snapshot lists them\."/);
  assert.match(api.statusBadge(prepared), /class="state-badge unresolved"[^>]*title="Not checked \(Not reviewed\): A database record without a PMID or DOI that was never reviewed\."[^>]*aria-label="Not checked, BRENDA"/);
  assert.match(api.statusBadge(row({ verification_status: "disputed" })), /class="state-badge disputed"[^>]*>.*Disputed</);
  const paperBadge = api.statusBadge(row({ source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name" }));
  assert.match(paperBadge, /title="Read from the paper by an AI model; a second, separate AI check compared each value with the paper\." aria-label="Accepted, from paper"/);
  assert.doesNotMatch(paperBadge, /independent|run\b|code converted/);
  assert.equal(api.reviewOutcome(prepared), "Not checked: taken from the source database as listed.");
  // An older record's review says it was the earlier automated review, and what it found.
  for (const [status, sentence] of [
    ["corrected", "Corrected and accepted in the earlier automated review; this snapshot does not list the changes."],
    ["verified", "Accepted as printed, in the earlier automated review."],
    ["manual_review_required", "Not confirmed: the earlier automated review left a question open on the value, unit, protein or substrate."],
    ["unverified", "Not checked: the earlier automated review recorded no final check."],
    ["disputed", "Disputed in the earlier automated review; not accepted (no reason recorded)."],
  ]) assert.equal(api.reviewOutcome(row({ verification_status: status })), sentence);
  assert.equal(api.reviewOutcome(row({ verification_status: "verified", public_trust_basis: "identity_only" })),
    "Accepted as listed by the source database; no paper is cited, so the value cannot be traced to a paper.");
  // An older snapshot: an accepted record without a paper is tagged; a human-checked one keeps the earlier review's title.
  assert.match(api.statusBadge(row({ verification_status: "verified", public_trust_basis: "identity_only" })),
    /title="Accepted, but no PMID or DOI is linked, so the value cannot be traced to a paper\."[^>]*aria-label="Accepted, BRENDA, no paper linked"/);
  // The user's review rules (D1, D2), followed by an export that counts accepted_basis: a record without a paper is Not
  // checked and still tagged; a record a human reviewer approved in full may be accepted for that alone.
  {
    const savedSummary = runtimeManifest.summary;
    runtimeManifest.summary = { ...savedSummary, distributions: { ...savedSummary.distributions,
      accepted_basis: [{ label: "human review", count: 1 }] } };
    const noPaper = row({ record_key: "no-paper", measurement_key: "no-paper", verification_status: "mathematically_inferred", public_trust_basis: "identity_only", source_db: "skid" });
    const badge = api.statusBadge(noPaper);
    assert.match(badge, /aria-label="Not checked, SKiD, no paper linked"/);
    assert.match(badge, /title="Not checked: the earlier automated review accepted it, but no PMID or DOI is linked, so the value cannot be traced to a paper; not counted as Accepted\."/);
    assert.doesNotMatch(badge, /never reviewed/);
    assert.equal(api.rowStatusLabel(noPaper, { exact: true }), "Not checked", "the tag says why, not 'Not reviewed'");
    assert.equal(api.reviewOutcome(noPaper), "Not checked: the earlier automated review accepted it, but no paper is cited, so the value cannot be traced to a paper.");
    // The Guide's Not checked definition counts these records under Not reviewed, as Stats does, and says how the record
    // shows them.
    api.renderGuideMethod();
    assert.match(element("guideNotCheckedDefinition").innerHTML, /never reviewed, or that the earlier review accepted \(tag: <em>no paper linked<\/em>\)\. The record shows which, for example <em>Not checked \(Unverified\)<\/em>; a record with no paper linked reads <em>Not checked<\/em> with that tag\.$/);
    const approved = row({ record_key: "approved", measurement_key: "approved", verification_status: "verified" });
    api.setHumanReviewMarks({ approved: { checked: true } });
    assert.match(api.statusBadge(approved), /title="Accepted as printed by the earlier automated review, or because a human reviewer approved every value\. Human-checked: a human reviewer approved every value shown\."/);
    assert.equal(api.reviewOutcome(approved, { accepted_basis: "human review" }),
      "Accepted because a human reviewer approved every value; the earlier automated review had not accepted it.");
    assert.equal(api.reviewOutcome(approved, {}), "Accepted as printed, in the earlier automated review.");
    api.setHumanReviewMarks({});
    runtimeManifest.summary = savedSummary;
    // An older snapshot accepts these records, so its Not reviewed is only the records nobody reviewed.
    api.renderGuideMethod();
    assert.match(element("guideNotCheckedDefinition").innerHTML, /that was never reviewed\. The record shows which, for example <em>Not checked \(Unverified\)<\/em>\.$/);
  }

  // An unfamiliar status is listed, not dropped; a merged source counts under each source it names, as Browse finds it.
  delete runtimeManifest.summary.review_details;
  delete runtimeManifest.summary.overview;
  runtimeManifest.summary.distributions.verification_status.push({ label: "future_status", count: 1 });
  api.renderStats();
  assert.equal(readBreakdown().other_status, 1, "An unfamiliar outcome must not disappear");
  assert.equal(readBreakdown().not_verified, 1, "Not checked is Unverified and Not reviewed only");
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
    accepted: 2, manual_review_required: 1, not_verified: 0, unverified: 0, mathematically_inferred: 0, disputed: 1, sequence: 4,
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

// Cite: downloads save under the snapshot's date, and the Data ID check names that file.
{
  const saved = { generated_at: runtimeManifest.generated_at, content_sha256: runtimeManifest.content_sha256 };
  runtimeManifest.generated_at = "2026-10-12T09:46:03+00:00";
  runtimeManifest.content_sha256 = "14ffa6600b55a3896094f59d77c4a13cbedf202e3b142a4f3887d835e1cadd9b";
  api.renderDownloadMetadata();
  assert.equal(element("enrichedDataButton").getAttribute("download"), "catlog-2026-10-12-full.jsonl.gz");
  assert.equal(element("guideFullDataLink").getAttribute("download"), "catlog-2026-10-12-full.jsonl.gz");
  assert.equal(element("exportSnapshotButton").getAttribute("download"), "catlog-2026-10-12-table.jsonl.gz");
  assert.equal(element("guideDataIdFile").textContent, "catlog-2026-10-12-full.jsonl.gz");
  assert.equal(element("guideSourceId").textContent, "14ffa6600b");
  assert.match(element("guideCitationLine").textContent, /^CatLog snapshot 2026-10-12 \(data ID 14ffa6600b\), Chowdhury Lab, /);
  Object.assign(runtimeManifest, saved);
}

// The record's Values and Conditions sections together (what the round-4 Measurement and Assay conditions showed).
const measurementSection = (summary, detail) => api.valuesSection(summary, detail) + api.conditionsSection(summary, detail);
const kiMeasurementHtml = measurementSection(row(), {
  has_ki: true,
  ki_display: "0.25",
  ki_unit: "µM",
});
// Values: one row per stored value, Ki last; a value's number and its unit in their own cells.
assert.match(kiMeasurementHtml, /<tr><th scope="row"><i>K<\/i><sub>i<\/sub><\/th><td class="vt-value"><span class="vt-number">0\.25<\/span><\/td><td class="vt-unit">µM<\/td>/);
// An older record: nothing as printed and no place known, so neither an As printed nor a Where column (a column of
// dashes would read as "nothing printed"); Unit takes the rest.
assert.match(kiMeasurementHtml, /<table class="values-table vt-no-printed"><thead><tr><th scope="col">Parameter<\/th><th scope="col" class="vt-value">Value<\/th><th scope="col">Unit<\/th><\/tr>/);
assert.doesNotMatch(kiMeasurementHtml, /vt-printed|As printed/);
assert.match(kiMeasurementHtml, /<td class="vt-unit">µM<\/td><\/tr>/);
// No pointer to the earlier review's notes unless the record has them under Paper; with them, one grey line.
assert.doesNotMatch(kiMeasurementHtml, /earlier review's notes under Paper/);
assert.match(api.valuesSection(row(), {}, { printedUnderPaper: true }),
  /<ul class="value-notes">(?:<li>[^]*?<\/li>)*<li>The earlier review&#39;s notes under Paper say where the paper prints these values\.<\/li><\/ul>/);
assert.ok(kiMeasurementHtml.indexOf("<i>k</i><sub>cat</sub>/<i>K</i><sub>m</sub></th>") < kiMeasurementHtml.indexOf("<i>K</i><sub>i</sub></th>"), "Ki comes last");

const noKiMeasurementHtml = measurementSection(row({ has_ki: false }), {});
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
  // An earlier-catalog kcat/Km of unstated origin is never called calculated, even when it equals kcat ÷ Km.
  const quotientRow = row({ kcat_display: "2.2", km_display: "0.19", kcat_over_km_display: "11.579", kcat: 2.2, km: 0.19, kcat_over_km: 11.579,
    kcat_unit: "s^(-1)", km_unit: "mM", kcat_over_km_unit: "s^(-1)*mM^(-1)", kcat_over_km_origin: "not_specified" });
  assert.equal(api.metricDisplayWithUnitHtml(quotientRow, "kcat_over_km", { table: true }), "11.58");
  assert.equal(api.efficiencyOriginHtml(quotientRow, { short: true }), "");
  const printedRow = { ...quotientRow, kcat_over_km_origin: "paper_reported" };
  assert.equal(api.metricDisplayWithUnitHtml(printedRow, "kcat_over_km", { table: true }), "11.58");
  assert.equal(api.efficiencyOriginHtml(printedRow, { short: true }), "");
  const fromPaperRow = { ...quotientRow, source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name" };
  assert.equal(api.efficiencyOriginHtml(fromPaperRow, { short: true }), "", "a value read from the paper is never called calculated");
  // A calculated kcat/Km's tooltip: "not printed in the paper" only on a record read from the paper; an older record's
  // source may list (and its paper print) a kcat/Km of its own.
  const calcOlder = { ...quotientRow, kcat_over_km_origin: "calculated", source_db: "oed" };
  assert.equal(api.efficiencyOriginHtml(calcOlder, { short: true }), '<small class="metric-origin" title="kcat ÷ Km, calculated by CatLog.">calc.</small>');
  const calcV2 = { ...calcOlder, source_db: "primary_paper_direct", verification_status: "verified", enzyme_label_source: "explicit_enzyme_name" };
  assert.match(api.efficiencyOriginHtml(calcV2, { short: true }), /title="kcat ÷ Km, calculated by CatLog; not printed in the paper\."/);
}
// A per-minute value stored with 4 figures shows its ÷60 repeat in its ending (7.333 = 440/60, 0.1833 = 11/60): 3 figures
// for kcat and kcat/Km; other 4-figure values, and Km, stay as stored.
assert.deepEqual(["7.333", "0.1833", "4.167", "0.003333", "3.333e-4", "7.334", "1333", "45.83"]
  .map((value) => api.roundingFigures(value, { perMinute: true })), [3, 3, 3, 3, 3, 0, 0, 0]);
assert.equal(api.roundingFigures("7.333"), 0, "Km is never divided by 60");
{
  const shown = (field, display) => api.metricDisplayWithUnitHtml(row({ kcat_unit: "s^(-1)", km_unit: "mM", kcat_over_km_unit: "s^(-1)*mM^(-1)",
    kcat_over_km_origin: "paper_reported", [`${field}_display`]: display }), field, { table: true });
  assert.equal(shown("kcat", "7.333"), "7.33");
  assert.equal(shown("kcat_over_km", "0.3333"), "0.333");
  assert.equal(shown("km", "0.3333"), "0.3333");
}
// A calc. kcat/Km never shows more than 4 figures, and one that only equals kcat ÷ Km never more than it is stored with.
{
  const base = { kcat_unit: "s^(-1)", km_unit: "mM", kcat_over_km_unit: "s^(-1)*mM^(-1)" };
  const equal = row({ ...base, kcat_display: "230.65", km_display: "411.85", kcat_over_km_display: "0.56", kcat: 230.65, km: 411.85,
    kcat_over_km: 0.56, kcat_over_km_origin: "not_specified" });
  assert.equal(api.metricDisplayWithUnitHtml(equal, "kcat_over_km", { table: true }), "0.56");
  assert.equal(api.panelValueHtml(equal, "kcat_over_km"), "0.56");
  const calculated = row({ ...base, kcat_display: "79.002", km_display: "60.001", kcat_over_km_display: "1.3167", kcat: 79.002, km: 60.001,
    kcat_over_km: 1.3167, kcat_over_km_origin: "calculated" });
  assert.equal(api.panelValueHtml(calculated, "kcat_over_km"), "1.317");
}
// A value CatLog gives to the figures printed (value_display "135.0") keeps its trailing zero in Values and in the report
// email; another number in that field is not used.
{
  const v2 = row({ record_key: "printed-zero", source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name",
    kcat: 135, kcat_display: "135", km: 0.03, km_display: "0.03", kcat_over_km: 4500, kcat_over_km_display: "4500",
    kcat_unit: "s^(-1)", km_unit: "mM", kcat_over_km_unit: "s^(-1)*mM^(-1)", kcat_over_km_origin: "paper_reported" });
  const line = (metric, printed, value_display) => ({ metric, table_label: "Table 1", printed, check: "confirmed", conversion: "", value_display });
  api.renderDetail(v2, { verification_method: "catlog_v2_read_and_independent_verify", supporting_pmids: ["31072150"],
    proof_lines: [line("kcat", "135.0 ± 15.1 sec−1", "135.0"), line("Km", "30 µM", "0.030"), line("kcat/Km", "4.5 × 10^3", "4501")] });
  const html = element("detailContent").innerHTML;
  assert.match(html, /<span class="vt-number">135\.0<\/span><\/td><td class="vt-unit">s<sup>-1<\/sup><\/td><td class="vt-printed">135\.0 ± 15\.1 sec−1/, "Values keep the printed zero");
  assert.match(html, /<span class="vt-number">0\.03<\/span><\/td><td class="vt-unit">mM<\/td>/,
    "a printed integer's zero (30 µM) is no printed figure: the stored digits show, as in the table");
  assert.match(html, /<span class="vt-number">4500<\/span><\/td><td class="vt-unit">s<sup>-1<\/sup> mM<sup>-1<\/sup><\/td>/, "a value_display that is not the stored number is not used");
  assert.match(html, /<caption>Printed in Table 1<\/caption>/, "a place every value shares is said once");
  assert.doesNotMatch(html, /class="vt-where/);
  const body = decodeURIComponent(html.match(/id="reportRecordProblem" class="button secondary" href="([^"]+)"/)[1].replace(/&amp;/g, "&"));
  assert.match(body, /kcat 135\.0 s⁻¹; Km 0\.03 mM/);
}
// A value read from the paper shows its value_display exactly, never cut to 4 figures (41e7d72dfb8772a1: kcat 1285.4 ±
// 124.7 sec⁻¹; 0245a504d4175d86: kcat/Km 621.92 ± 7.30 mM⁻¹·s⁻¹), in Values and in the report email; an older record's value
// and a kcat/Km CatLog calculated keep the display rule.
{
  const v2 = row({ record_key: "five-figures", source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name",
    kcat: 1285.4, kcat_display: "1285.4", km: 13.5, km_display: "13.5", kcat_over_km: 621.92, kcat_over_km_display: "621.92",
    kcat_unit: "s^(-1)", km_unit: "mM", kcat_over_km_unit: "s^(-1)*mM^(-1)", kcat_over_km_origin: "paper_reported" });
  const line = (metric, raw_value, raw_unit, value_display) => ({ metric, table_label: "Table 1", raw_value, raw_unit,
    printed: `${raw_value} ${raw_unit}`, check: "confirmed", conversion: "", value_display });
  api.renderDetail(v2, { verification_method: "catlog_v2_read_and_independent_verify", supporting_pmids: ["31072150"],
    proof_lines: [line("kcat", "1285.4 ± 124.7", "sec−1", "1285.4"), line("Km", "13.5 ± 2.2", "mM", "13.5"),
      line("kcat/Km", "621.92 ± 7.30", "mM^{−1}·s^{−1}", "621.92")] });
  const html = element("detailContent").innerHTML;
  assert.match(html, /<span class="vt-number">1285\.4<\/span><\/td><td class="vt-unit">s<sup>-1<\/sup><\/td>/, "kcat as the paper prints it");
  assert.match(html, /<span class="vt-number">621\.92<\/span><\/td><td class="vt-unit">s<sup>-1<\/sup> mM<sup>-1<\/sup><\/td>/);
  const body = decodeURIComponent(html.match(/id="reportRecordProblem" class="button secondary" href="([^"]+)"/)[1].replace(/&amp;/g, "&"));
  assert.match(body, /kcat 1285\.4 s⁻¹; Km 13\.5 mM; kcat\/Km 621\.92 s⁻¹ mM⁻¹/);
  // The same digits on an older record follow the display rule.
  const older = row({ kcat: 1285.4, kcat_display: "1285.4", kcat_unit: "s^(-1)", source_db: "brenda" });
  assert.equal(api.panelValueHtml(older, "kcat"), "1285");
  // A kcat/Km CatLog calculated for a record read from the paper keeps the figures of kcat and Km.
  const calculated = row({ record_key: "calc-v2", source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name",
    kcat: 1285.4, kcat_display: "1285.4", km: 13.5, km_display: "13.5", kcat_over_km: 95.214814, kcat_over_km_display: "95.214814",
    kcat_unit: "s^(-1)", km_unit: "mM", kcat_over_km_unit: "s^(-1)*mM^(-1)", kcat_over_km_origin: "calculated" });
  api.renderDetail(calculated, { verification_method: "catlog_v2_read_and_independent_verify", supporting_pmids: ["31072150"],
    proof_lines: [line("kcat", "1285.4 ± 124.7", "sec−1", "1285.4"), line("Km", "13.5 ± 2.2", "mM", "13.5")] });
  const calcHtml = element("detailContent").innerHTML;
  assert.match(calcHtml, /<span class="vt-number">1285\.4<\/span>/);
  assert.match(calcHtml, /<span class="vt-number">95\.2<\/span>/, "kcat ÷ Km to 3 figures, as Km has");
}
// A value_display with more figures than the paper prints is not used: "47.000" from a printed "47,000 M⁻¹ s⁻¹" (a
// thousands separator) and "9.440" from "9440 ± 780 µM" show the stored digits, as the table does; "0.0300" from a
// printed "30.0 µM" keeps its zero.
{
  const v2 = row({ record_key: "grouped-zeros", source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name",
    kcat: 8, kcat_display: "8", km: 9.44, km_display: "9.44", kcat_over_km: 47, kcat_over_km_display: "47",
    kcat_unit: "s^(-1)", km_unit: "mM", kcat_over_km_unit: "s^(-1)*mM^(-1)", kcat_over_km_origin: "paper_reported" });
  const line = (metric, raw_value, raw_unit, value_display) => ({ metric, table_label: "Table IV", raw_value, raw_unit,
    printed: `${raw_value} ${raw_unit}`, check: "confirmed", conversion: "converted by code", value_display });
  api.renderDetail(v2, { verification_method: "catlog_v2_read_and_independent_verify", supporting_pmids: ["15863831"],
    proof_lines: [line("kcat", "8", "s^-1", "8"), line("Km", "9440 ± 780", "µM", "9.440"), line("kcat/Km", "47,000", "M^-1 s^-1", "47.000")] });
  const html = element("detailContent").innerHTML;
  assert.match(html, /<span class="vt-number">9\.44<\/span><\/td><td class="vt-unit">mM<\/td><td class="vt-printed">9440 ± 780 µM/);
  assert.match(html, /<span class="vt-number">47<\/span><\/td><td class="vt-unit">s<sup>-1<\/sup> mM<sup>-1<\/sup><\/td><td class="vt-printed">47,000 M/);
  const zero = row({ record_key: "decimal-zero", source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name",
    km: 0.03, km_display: "0.03", km_unit: "mM" });
  api.renderDetail(zero, { verification_method: "catlog_v2_read_and_independent_verify", supporting_pmids: ["15863831"],
    proof_lines: [line("Km", "30.0", "µM", "0.0300")] });
  assert.match(element("detailContent").innerHTML, /<span class="vt-number">0\.0300<\/span><\/td><td class="vt-unit">mM<\/td>/);
  assert.equal(api.printedNumberText("47,000"), "47000");
  assert.equal(api.printedNumberText("23 200"), "23200");
  assert.equal(api.printedNumberText("(1,500.5)"), "1500.5");
  assert.equal(api.printedNumberText("0,250"), "0.250", "a decimal comma");
  assert.equal(api.printedNumberText("1,5 ± 0,2"), "1.5");
  assert.equal(api.printedNumberText("0.000 812 ± 0.000 090"), "0.000812");
  assert.equal(api.printedNumberText("6.3 × 10^3"), "6.3");
  assert.equal(api.printedNumberText("n.d."), "");
}
assert.equal(api.printedValueText("0.002", "10^6 M^-1 min^-1"), "0.002 × 10^6 M^-1 min^-1");
assert.equal(api.printedValueText("320", "mM"), "320 mM");
// A flag is said once: a marker button on the value and one note under the values, no second list.
const flaggedHtml = measurementSection(row({
  kcat: 8.5, km: 320, kcat_over_km: 0.033, kcat_display: "8.5", km_display: "320", kcat_over_km_display: "0.033",
  condition_flags: ["kcat_over_km_quotient_mismatch"],
}), {});
assert.match(flaggedHtml, /<button class="value-flag" type="button" data-flag-note="detailFlagNote1"/);
assert.match(flaggedHtml, /<li id="detailFlagNote1"[^>]*>.*The source&#39;s kcat\/Km \(0\.033 mM-1 s-1\) is 1\.2-fold above kcat ÷ Km \(0\.027 mM-1 s-1\)\. All three are stored as the source lists them\./);
assert.match(flaggedHtml, /aria-label="kcat\/Km mismatch\. Show the note\."/);
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
  const html = measurementSection(fromPaperRow, { proof_lines: [
    { metric: "Km", raw_value: "0.37 ± 0.01", raw_unit: "µM" },
    { metric: "kcat", raw_value: "10.7 ± 0.0", raw_unit: "s−1" },
    { metric: "kcat/Km", raw_value: "28.9", raw_unit: "mM−1 · s−1" },
  ] });
  assert.ok(html.includes("The paper&#39;s kcat/Km (28.9 s⁻¹ mM⁻¹) is 1,001-fold below kcat ÷ Km (2.9 × 10⁴ s⁻¹ mM⁻¹). "
    + "The factor is close to 1000, the factor between per mM and per M. "
    + "The printed numbers agree (10.7 ÷ 0.37 = 28.9) only if Km and kcat/Km share one concentration unit. "
    + "All three are stored as the paper gives them."), html);
  assert.match(html, /aria-label="kcat\/Km: possible 1000× unit error\. Show the note\."/);
}
// A magnitude caution names the bound the value passes.
{
  const low = measurementSection(row({ km: 1e-14, km_display: "1e-14", condition_flags: ["km_magnitude_needs_check"] }), {});
  assert.match(low, /Km is below 1 nM; the unit or the value may be wrong\./);
  assert.match(low, /aria-label="Km &lt; 1 nM\. Show the note\."/);
  const high = measurementSection(row({ kcat: 7e12, kcat_display: "7e+12", condition_flags: ["kcat_magnitude_needs_check"] }), {});
  assert.match(high, /kcat is above 10⁸ s⁻¹; the unit or the value may be wrong\./);
  // Every magnitude caution ends as the Guide's does.
  const diffusion = measurementSection(row({ kcat_over_km: 5e9, kcat_over_km_display: "5e+9", condition_flags: ["efficiency_above_diffusion_limit"] }), {});
  assert.match(diffusion, /kcat\/Km is above the diffusion limit; the unit or the value may be wrong\./);
  const guideCautions = indexHtml.match(/<dl class="guide-term-list guide-caution-list">[\s\S]*?<\/dl>/)[0];
  assert.equal((guideCautions.match(/the unit or the value may be wrong\./g) || []).length, 3, "Km, kcat and diffusion limit say it alike");
  assert.doesNotMatch(guideCautions, /the unit may be wrong|magnitude may be wrong/);
  // CatLog's bounds on an older snapshot's flags: a Km below 1 nM is flagged even unflagged, a kcat up to 10⁸ s⁻¹ is not.
  const unflaggedLow = row({ km: 2e-14, km_display: "2e-14", km_unit: "mM", condition_flags: [] });
  assert.ok(api.conditionFlags(unflaggedLow).has("km_magnitude_needs_check"));
  assert.equal(api.rowCautionBits(unflaggedLow), 2, "counted under Possible unit or magnitude error");
  assert.match(api.valueFlagBadgeHtml(api.conditionFlags(unflaggedLow), "km", unflaggedLow), /Km below 1 nM; the unit or the value may be wrong/);
  assert.ok(!api.conditionFlags(row({ km: 2e-6, km_display: "2e-06", km_unit: "mM" })).has("km_magnitude_needs_check"));
  const catalase = row({ kcat: 3e7, kcat_display: "3e+7", kcat_unit: "s^(-1)", condition_flags: ["kcat_magnitude_needs_check"] });
  assert.equal(api.conditionFlags(catalase).size, 0, "kcat at 3 × 10⁷ s⁻¹ is no caution");
  assert.equal(api.rowCautionBits(catalase), 16);
  assert.ok(api.conditionFlags(row({ kcat: 3e7, kcat_display: "3e+7", kcat_unit: "min^(-1)", condition_flags: ["kcat_magnitude_needs_check"] }))
    .has("kcat_magnitude_needs_check"), "a kcat in another unit keeps its flag");
  // A temperature caution (the filter's Temperature questionable group): the table shows no temperature, so the row has
  // no mark for it; the record says it on its Temperature line.
  const zeroCelsius = row({ temperature_display: "", condition_flags: ["temperature_zero_celsius_needs_check"] });
  assert.equal(api.rowCautionBits(zeroCelsius), 8);
  assert.equal(typeof api.temperatureFlagBadgeHtml, "undefined");
  assert.match(measurementSection(zeroCelsius, {}), /<dt>Temperature<\/dt><dd>Not shown, recorded as exactly 0 °C, which may stand for a missing value/);
}
// An older record that stores no kcat/Km shows the kcat/Km its sources list even when nothing differs (3d1ca368da05740a:
// BRENDA lists 0.5 and 50 s⁻¹ mM⁻¹, each also with no unit); one whose stored kcat/Km equals the listed one says it once.
{
  const brenda = (value, unit) => ({ value, unit, source_db: "brenda", source_record_id: null, pmids: ["740076"] });
  const listedOnly = { source_kcat_over_km_values: [brenda(0.5, "s^(-1)*mM^(-1)"), brenda(50, "s^(-1)*mM^(-1)"), brenda(0.5, null), brenda(50, null)] };
  const empty = api.valuesSection(row({ record_key: "listed-only", source_db: "brenda", kcat: null, km: null, kcat_over_km: null,
    kcat_display: null, km_display: null, kcat_over_km_display: null }), listedOnly);
  assert.match(empty, /No kcat, Km or kcat\/Km is stored for this record; BRENDA lists a kcat\/Km for it \(below\)\./);
  assert.match(empty, /<dt>kcat\/Km listed by BRENDA<\/dt><dd><span class="source-efficiency-value"><span><span class="listed-end">0\.50<\/span>–<span class="listed-end">50<\/span> s<sup>-1<\/sup> mM<sup>-1<\/sup><\/span><small>2 values<\/small><\/span><\/dd>/);
  assert.doesNotMatch(empty, /no unit/, "a number BRENDA also gives with no unit is listed once, in its unit");
  const pair = api.valuesSection(row({ record_key: "listed-pair", source_db: "brenda", kcat: 17479, km: 1.86, kcat_over_km: null,
    kcat_display: "17479", km_display: "1.86", kcat_over_km_display: null }), { source_kcat_over_km_values: [brenda(9397, "s^(-1)*mM^(-1)"), brenda(9397, null)] });
  assert.match(pair, /<dt>kcat\/Km listed by BRENDA<\/dt><dd><span class="source-efficiency-value"><span><span class="listed-end">9397<\/span> s<sup>-1<\/sup>/);
  assert.doesNotMatch(pair, /flag-notes|kcat\/Km mismatch/, "no new caution: the table's cautions stay CatLog's flags");
  // One listed value follows the display rule too, as the range's ends are rounded (341905f35e2de883: OED's 126.667 shows
  // 127, a ÷60 artefact; 9397 keeps its 4 figures).
  const one = api.valuesSection(row({ record_key: "listed-one", source_db: "oed", kcat: 11.333, km: 0.09, kcat_over_km: 125.92,
    kcat_display: "11.333", km_display: "0.09", kcat_over_km_display: "125.92", kcat_over_km_origin: "calculated",
    kcat_over_km_source_differs: true }), { source_kcat_over_km_values: [{ value: 126.667, unit: "s^(-1)*mM^(-1)", source_db: "oed", pmids: ["11054102"] }] });
  assert.match(one, /<dt>kcat\/Km listed by OED<\/dt><dd><span class="source-efficiency-value"><span><span class="listed-end">127<\/span> s<sup>-1<\/sup>/);
  assert.doesNotMatch(one, /126\.667/);
  // The report email quotes the listed kcat/Km the record shows, as it shows them.
  api.renderDetail(row({ record_key: "listed-email", source_db: "oed", kcat: 11.333, km: 0.09, kcat_over_km: 125.92,
    kcat_display: "11.333", km_display: "0.09", kcat_over_km_display: "125.92", kcat_over_km_origin: "calculated",
    kcat_over_km_source_differs: true }), { source_kcat_over_km_values: [{ value: 126.667, unit: "s^(-1)*mM^(-1)", source_db: "oed" },
    { value: 3.0, unit: "1/mM*1/s", source_db: "brenda" }, { value: 6.117, unit: "1/mM*1/s", source_db: "brenda" }, { value: 5, unit: "", source_db: "brenda" }] });
  const emailHtml = element("detailContent").innerHTML;
  const emailBody = decodeURIComponent(emailHtml.match(/id="reportRecordProblem" class="button secondary" href="([^"]+)"/)[1].replace(/&amp;/g, "&"));
  assert.match(emailBody, /kcat\/Km 130 mM-1 s-1; kcat\/Km listed by OED 127 s⁻¹ mM⁻¹; kcat\/Km listed by BRENDA 3\.0–6\.1 s⁻¹ mM⁻¹ \(2 values\); kcat\/Km listed by BRENDA 5 no unit\.\n/);
  api.renderDetail(row({ record_key: "nothing-listed" }), {});
  assert.doesNotMatch(decodeURIComponent(element("detailContent").innerHTML.match(/id="reportRecordProblem" class="button secondary" href="([^"]+)"/)[1]), /listed by/);
  assert.equal(api.listedRangeText([126.667]), "127");
  assert.equal(api.listedRangeText([0.0000123456]), "1.235 × 10⁻⁵");
  const same = api.valuesSection(row({ record_key: "listed-same", kcat_over_km: 64, kcat_over_km_display: "64" }),
    { source_kcat_over_km_values: [{ value: 64, unit: "s^(-1)*mM^(-1)", source_db: "oed" }] });
  assert.doesNotMatch(same, /listed by/, "a listed kcat/Km equal to the stored one is not said twice");
}
// An older record's kcat/Km off by a unit factor shows the source's own value that agrees with kcat ÷ Km.
const unitFlagHtml = measurementSection(row({
  kcat: 22.6, km: 0.35, kcat_over_km: 64000, kcat_display: "22.6", km_display: "0.35", kcat_over_km_display: "64000",
  condition_flags: ["kcat_over_km_unit_mismatch"], kcat_over_km_source_differs: true,
}), { source_kcat_over_km_values: [{ value: 64, unit: "s^(-1)*mM^(-1)", source_db: "oed" }] });
assert.match(unitFlagHtml, /<span class="vt-number">64<\/span><button class="value-flag"/);
assert.match(unitFlagHtml, /<span class="vt-number">22\.6<\/span><span class="value-flag vt-ghost" aria-hidden="true"><\/span><\/td>/, "no calc. in this table: no space kept for one");
assert.match(unitFlagHtml, /The stored kcat\/Km \(64000 mM-1 s-1\) is 991-fold above kcat ÷ Km \(65 mM-1 s-1\)\. The source&#39;s own kcat\/Km, 64 mM-1 s-1 \(listed above\), agrees with kcat ÷ Km and is shown above\. The factor is close to 1000, the factor between per mM and per M\./);
// v2 conditions: labelled lines; a pH or temperature already shown and per-value qualifiers are not repeated.
const lines = api.conditionLines("pH 7.5; 298.15 K; apparent kcat; apparent Km; cosubstrate NAD+; preparation: purified", row({ ph_display: "7.5", temperature_display: "25" }));
assert.match(lines.cosubstrate, /<dt>Cosubstrate<\/dt><dd>NAD\+<\/dd>/);
assert.match(lines.conditions, /<dt>Assay<\/dt><dd>apparent kcat, Km<\/dd>/);
assert.match(lines.preparation, /<dt>Preparation<\/dt><dd>purified<\/dd>/);
// The AI reader's remarks about its own reading never show; the facts before them stay (PMIDs 29115742, 18783250, 27271847).
{
  const remarks = api.conditionLines([
    "the assay buffer, Mg2+ concentration, pH and temperature of the kinetic assay are given only in the Supporting Information, which is not part of the provided text",
    "100 mM phosphate buffer (Supporting Information Table 1 footnote, which repeats Table 2's \"pH 7.5\"; the table columns give the assay pH)",
    "HiBgl3C's temperature optimum is printed 55 C in Table 3 but 60 C in the Results text and Fig. 2C, so the assay temperature is not pinned down",
    "Mg2+ (provided text), Tris",
  ].join("; "), row({}));
  assert.doesNotMatch(remarks.conditions, /provided text|pinned down|which repeats|table columns give/);
  assert.match(remarks.conditions, /given only in the Supporting Information<\/li>/);
  assert.match(remarks.conditions, /<li>100 mM phosphate buffer<\/li>/);
  assert.match(remarks.conditions, /and Fig\. 2C<\/li>/);
  assert.match(remarks.conditions, /<li>Mg2<sup>\+<\/sup>, Tris<\/li>|<li>Mg2\+, Tris<\/li>/);
}

// Exporter-produced flagged conditions are withheld, with the reason still visible.
const withheldConditions = row({
  temperature_k: null,
  temperature_display: "n/a",
  ph: null,
  ph_display: null,
  condition_flags: ["temperature_zero_celsius_needs_check", "ph_outside_0_14"],
});
const withheldConditionsBefore = structuredClone(withheldConditions);
const withheldMeasurementHtml = measurementSection(withheldConditions, {
  temperature_k: null,
  ph: null,
  condition_flags: withheldConditions.condition_flags,
});
// A flag on the temperature or pH is said on its row, never as a bare dash; the kinetic notes stay about the values.
assert.ok(withheldMeasurementHtml.includes("<dt>Temperature</dt><dd>Not shown, recorded as exactly 0 °C, which may stand for a missing value</dd>"));
assert.ok(withheldMeasurementHtml.includes("<dt>pH</dt><dd>Not shown, the source&#39;s value is outside 0–14</dd>"));
assert.doesNotMatch(withheldMeasurementHtml, /class="flag-notes"|<dd>—<\/dd>/);
assert.doesNotMatch(withheldMeasurementHtml, /\(stored\)|null|undefined/);
{
  // The source's note gives the temperature it printed; a record read from the paper says what the paper does not state.
  const unitFlag = measurementSection(row({ temperature_k: null, temperature_display: "n/a", condition_flags: ["temperature_unit_needs_check"] }),
    { proof_lines: ["pH 7.4, 30°C, recombinant mutant"] });
  assert.ok(unitFlag.includes("<dt>Temperature</dt><dd>Not shown, the source&#39;s temperature unit is unclear (source note: 30 °C)</dd>"));
  const v2Missing = measurementSection(row({ source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name",
    temperature_k: null, temperature_display: "n/a", ph: null, ph_display: null, substrate_name: "NADH" }),
  { verification_method: "catlog_v2_read_and_independent_verify",
    assay_conditions_summary: "pH left blank: the printed value could not be confirmed in the paper text; assay temperature not stated; buffer not stated; cofactor NADH" });
  assert.ok(v2Missing.includes("<dt>Temperature</dt><dd>Not stated in the paper</dd>"));
  assert.ok(v2Missing.includes("<dt>pH</dt><dd>Not confirmed in the paper text</dd>"));
  assert.match(v2Missing, /<dt>Assay<\/dt><dd>buffer not stated<\/dd>/);
  assert.doesNotMatch(v2Missing, /left blank|assay temperature not stated|<dt>Cofactor<\/dt>/);
  const dbMissing = measurementSection(row({ temperature_k: null, temperature_display: "n/a", ph: null, ph_display: null }), {});
  assert.ok(dbMissing.includes("<dt>Temperature</dt><dd>Not recorded</dd>"));
  assert.ok(dbMissing.includes("<dt>pH</dt><dd>Not recorded</dd>"));
  // No temperature stored and no flag, but the source's note gives one: the row says so, as the flagged row does.
  const noted = measurementSection(row({ temperature_k: null, temperature_display: "n/a", ph: null, ph_display: null }),
    { proof_lines: ["mutant enzyme R269A/N270A, at pH 7.5 and 25°C"] });
  assert.ok(noted.includes("<dt>Temperature</dt><dd>Not recorded (source note: 25 °C)</dd>"));
  const twoNoted = measurementSection(row({ temperature_k: null, temperature_display: "n/a" }),
    { proof_lines: ["pH 7.5, 25°C", "pH 7.5, 37°C, with Mg2+"] });
  assert.ok(twoNoted.includes("<dt>Temperature</dt><dd>Not recorded</dd>"), "two note temperatures: no guess");
}
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
assert.equal(pageRecordsByKey["page-missing-license"].source_license, "See the source's terms", "the license as the record shows it");
// Each record is the flat object Download record saves: the record's words, no internal fields.
for (const record of pagePayload.records) {
  assert.equal(record.review_result, "Accepted");
  for (const internal of ["detail_shard", "review_key", "ui_record_key", "verification_method", "identity_resolution_state",
    "evidence_confidence_tier", "paper_grounding_status", "public_trust_basis", "proof_kind", "normalized_value"]) {
    assert.ok(!(internal in record), `${internal} is internal`);
  }
}

// R15: keep the first DOI spelling, collapse case variants, and retain
// genuinely different identifiers in their original order.
const doiCaseVariants = ["10.1128/AEM.03151-20", "10.1128/aem.03151-20"];
api.renderDetail(row({ record_key: "doi-case-duplicates" }), {
  supporting_dois: doiCaseVariants,
});
let referenceHtml = element("detailContent").innerHTML;
assert.equal((referenceHtml.match(/href="https:\/\/doi.org\//g) || []).length, 1);
assert.ok(referenceHtml.includes('href="https://doi.org/10.1128/AEM.03151-20"'));
assert.match(referenceHtml, /<dt>DOI<\/dt>/);
assert.doesNotMatch(referenceHtml, /<dt>DOIs<\/dt>/);
assert.deepEqual(doiCaseVariants, ["10.1128/AEM.03151-20", "10.1128/aem.03151-20"]);

api.renderDetail(row({ record_key: "doi-distinct-references" }), {
  supporting_dois: [...doiCaseVariants, "10.1000/Second", "10.1000/second"],
});
referenceHtml = element("detailContent").innerHTML;
const doiHrefs = [...referenceHtml.matchAll(/href="(https:\/\/doi.org\/[^\"]+)"/g)].map(match => match[1]);
assert.deepEqual(doiHrefs, ["https://doi.org/10.1128/AEM.03151-20", "https://doi.org/10.1000/Second"]);
assert.match(referenceHtml, /<dt>DOIs<\/dt>/);

// A stand-in paper ID (a paper without a PMID) is shown as text, never as a PubMed link; the e-mail names the DOI.
api.renderDetail(row({ record_key: "stand-in-paper" }), {
  pubmed_id: "NP1a2b3c4d",
  supporting_pmids: ["NP1a2b3c4d"],
  supporting_dois: ["10.1000/standin"],
});
referenceHtml = element("detailContent").innerHTML;
assert.doesNotMatch(referenceHtml, /pubmed\.ncbi\.nlm\.nih\.gov\/NP/);
assert.match(referenceHtml, /<dt>Paper ID<\/dt><dd>NP1a2b3c4d \(no PMID\)<\/dd>/);
assert.match(decodeURIComponent(referenceHtml.match(/id="reportRecordProblem" class="button secondary" href="([^"]+)"/)[1]), /DOI 10\.1000\/standin, paper NP1a2b3c4d/);
// An EC or organism stated nowhere says which of the two is unknown; a record without values says so.
api.renderDetail(row({ record_key: "unknowns", ec_number: "Unknown", organism: "Unknown", kcat: null, km: null, kcat_over_km: null,
  kcat_display: "Not reported", km_display: "Not reported", kcat_over_km_display: "Not reported" }), {});
referenceHtml = element("detailContent").innerHTML;
assert.match(referenceHtml, /<p class="detail-subtitle">EC unknown &middot; organism not recorded<\/p>/);
api.renderDetail(row({ record_key: "unknowns-v2", source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name",
  organism: "Unknown", substrate_name: "Unknown" }), {});
assert.match(element("detailContent").innerHTML, /EC 1\.1\.1\.1 &middot; organism not stated in the paper<\/p>/);
assert.match(element("detailContent").innerHTML, /<span class="detail-substrate-name">Not stated in the paper<\/span>/);
assert.match(referenceHtml, /No kcat, Km or kcat\/Km is stored for this record\./);
assert.match(referenceHtml, /<dt>SMILES<\/dt><dd>None<\/dd>/);
assert.doesNotMatch(referenceHtml, /Protein identity/);
assert.doesNotMatch(referenceHtml, /undefined|NaN|null/);
// The record (design spec 5): name; EC, organism and form; substrate; status; record ID and Copy link. Then Values (with
// the values as printed), Source, Conditions, Protein and substrate, Paper, Review and audit with the record's actions last.
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
  assert.match(html, /<p class="detail-subtitle">EC 1\.4\.1\.20 &middot; <i>Bacillus sphaericus<\/i> &middot; <span class="detail-form">Variant <code class="mutation">N145A<\/code><\/span><\/p>/);
  assert.match(html, /<p class="detail-substrate"><span>Substrate:<\/span> <span class="detail-substrate-name">3-phenyl-2-oxopropanoate<\/span><\/p>/);
  assert.match(html, /<span class="detail-status-word">Accepted<\/span><span>read from the paper<\/span>/);
  assert.match(html, /<p class="detail-key"><span class="visually-hidden">Record ID <\/span><code id="detailRecordKey">v2-structure<\/code>.*data-copy-text="[^"]*#record=v2-structure" data-copy-label="Copy link">Copy link<\/button><\/p>/);
  const order = ['class="detail-top"', ">Values</h3>", ">Source</h3>", ">Conditions</h3>", ">Protein and substrate</h3>", ">Paper</h3>",
    ">Review and audit</h3>", 'id="downloadSelectedJson"'];
  const positions = order.map((part) => html.indexOf(part));
  assert.ok(positions.every((position) => position >= 0), `every part is drawn: ${positions}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "the parts come in the record's order");
  assert.match(html, /<caption>Printed in Table 2<\/caption><thead><tr><th scope="col">Parameter<\/th>/);
  assert.match(html, /<td class="vt-printed">68 s<sup>-1<\/sup><\/td><\/tr>/);
  assert.match(html, /<dt>Location<\/dt><dd>Table 2<\/dd>/);
  assert.doesNotMatch(html, /Against the databases/, "no database comparison in the snapshot: no section");
  assert.match(html, /<dt>Review result<\/dt><dd>Accepted: read from the paper by CatLog\.<\/dd>/);
  // Organism names: the binomial in italics; a strain or "sp." stays roman; a virus stays roman.
  assert.equal(api.organismHtml("Escherichia coli K-12"), "<i>Escherichia coli</i> K-12");
  assert.equal(api.organismHtml("Bacillus sp. A1"), "<i>Bacillus</i> sp. A1");
  assert.equal(api.organismHtml("Human immunodeficiency virus 1"), "Human immunodeficiency virus 1");
  assert.equal(api.organismHtml("unidentified bacterium"), "unidentified bacterium");
  // The substrate is cut short in the header and given in full under Protein and substrate.
  const longName = `${"2-deoxy-3-O-[(3R)-3-hydroxytetradecanoyl]-".repeat(3)}glucose`;
  api.renderDetail(row({ record_key: "long-substrate", substrate_name: longName }), {});
  assert.match(element("detailContent").innerHTML, new RegExp(`<dt>Substrate</dt><dd>${longName.replace(/[[\]()]/g, "\\$&")}</dd>`));
  // The status line names the result and the source as the table does (one helper); Not checked keeps the earlier
  // status in brackets.
  api.renderDetail(row({ record_key: "status-words", verification_status: "mathematically_inferred", source_db: "skid" }), {});
  assert.match(element("detailContent").innerHTML, /<span class="detail-status-word">Not checked \(Not reviewed\)<\/span><span>SKiD<\/span>/);
  // Its dot is the exact status's colour, as in the table: tan with its ring for Not reviewed, salmon with its ring for
  // Not confirmed, slate for Unverified.
  assert.match(element("detailContent").innerHTML, /<p class="detail-status" style="--status-color:var\(--st-not-reviewed\);--status-ring:var\(--st-not-reviewed-ring\)">/);
  api.renderDetail(row({ record_key: "status-words-2", verification_status: "manual_review_required", source_db: "sabio_rk;brenda" }), {});
  assert.match(element("detailContent").innerHTML, /<span class="detail-status-word">Not confirmed<\/span><span>BRENDA, SABIO-RK<\/span>/);
  assert.match(element("detailContent").innerHTML, /style="--status-color:var\(--st-pending\);--status-ring:var\(--st-pending-ring\)"/);
  api.renderDetail(row({ record_key: "status-words-3", verification_status: "unverified", source_db: "unknown" }), {});
  assert.match(element("detailContent").innerHTML, /<span class="detail-status-word">Not checked \(Unverified\)<\/span><span>source not recorded<\/span>/);
  assert.match(element("detailContent").innerHTML, /<p class="detail-status" style="--status-color:var\(--st-unverified\)">/);
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
  assert.match(html, /<dt>Method<\/dt><dd>Read from the paper by an AI model; a second, separate AI check compared each value with the paper; values stored as printed\. <a class="method-link" href="#guide-method">How CatLog reads and checks values<span aria-hidden="true"> →<\/span><\/a><\/dd>/);
  assert.match(html, /<dt>Second check<\/dt><dd>All values confirmed\.<\/dd>/);
  assert.match(html, /<p class="detail-subtitle">EC 2\.3\.1\.183 \(from enzyme databases; not printed in the paper\) &middot; Organism<\/p>/);
  assert.doesNotMatch(html, /<dt>Evidence<\/dt>|second, separate AI run|independent/);
  api.renderDetail(v2Summary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [line("kcat", "converted by code"), line("Km", "", "corrected: unit used for the conversion (was none, now mM)")] });
  html = element("detailContent").innerHTML;
  assert.match(html, /compared each value with the paper; units converted by code\./);
  assert.match(html, /<dt>Second check<\/dt><dd>kcat: confirmed; Km: unit set to mM\.<\/dd>/);
  assert.match(html, /<ul class="value-notes"><li>kcat: converted by code from the printed unit\.<\/li><\/ul>/);
  assert.match(html, /<p class="detail-subtitle">EC 2\.3\.1\.183 &middot; Organism<\/p>/);
  const badge = api.statusBadge(v2Summary);
  assert.match(badge, /aria-label="Accepted, from paper"/);
  assert.match(badge, /title="Read from the paper by an AI model; a second, separate AI check compared each value with the paper\."/);
  assert.match(api.statusBadge(row({ verification_status: "corrected" })), /aria-label="Accepted, BRENDA, corrected"/);
  // A unit in CatLog's own words reads as the page writes units, whether the exponent was typed with a caret or a hyphen.
  api.renderDetail(v2Summary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [line("kcat", "converted by code, printed unit read as 10^3 s-1", "corrected: unit set to 10^3 s-1")] });
  html = element("detailContent").innerHTML;
  assert.match(html, /<dt>Second check<\/dt><dd>Unit set to 10³ s⁻¹ for every value\.<\/dd>/);
  assert.match(html, /<li>kcat: converted by code, printed unit read as 10³ s⁻¹\.<\/li>/);
  assert.equal(api.catlogUnitText("s-1 mM-1"), "s⁻¹ mM⁻¹");
  assert.equal(api.catlogUnitText("M-1s-1"), "M⁻¹s⁻¹");
  assert.equal(api.catlogUnitText("min-1 µM-1"), "min⁻¹ µM⁻¹");
  assert.equal(api.catlogUnitText("mmol-1 L-1"), "mmol⁻¹ L⁻¹");
  assert.equal(api.catlogUnitText("s^(-1)*mM^(-1)"), "s⁻¹ mM⁻¹");
  assert.equal(api.catlogUnitText("mM"), "mM");
  assert.equal(api.catlogUnitText("Ser-1 pH-7 mM-1.5"), "Ser-1 pH-7 mM-1.5", "only a unit's whole-number exponent");
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
  assert.match(html, /<dt>Second check<\/dt><dd>All values confirmed\.<\/dd>/);
  assert.match(html, /<dt>Review result<\/dt><dd>Accepted: read from the paper by CatLog\.<\/dd><\/div><div class="kv-line"><dt>AI audit<\/dt><dd>Oct 11, 2026: re-checked against the paper and kept\.<\/dd>/);
  api.renderDetail(v2Summary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [line("kcat", { check: "confirmed; re-checked in an independent audit (2026-10-11)" }),
      line("Km", { check: "confirmed; unit corrected in an independent audit (2026-10-11)" })] });
  html = element("detailContent").innerHTML;
  assert.match(html, /<dt>Second check<\/dt><dd>All values confirmed\.<\/dd>/, "the audit suffix does not hide the check");
  assert.match(html, /<dt>AI audit<\/dt><dd>Oct 11, 2026: kcat re-checked against the paper and kept\. Oct 11, 2026: Km re-checked against the paper; the unit was corrected\.<\/dd>/);
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
  const confirmedHtml = measurementSection(confirmedSummary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [proofLine("Km", "228.78", "µM", "converted by code"), proofLine("kcat", "12.45", "min^-1", "converted by code"),
      proofLine("kcat/Km", "55.06", "µM^-1 min^-1", "converted by code, printed unit read as mM^-1 min^-1")] });
  assert.match(confirmedHtml, /The paper prints µM⁻¹ min⁻¹; CatLog uses mM⁻¹ min⁻¹, the unit in which the printed kcat\/Km \(55\.06\) agrees with kcat ÷ Km \(54\.41\)\./);
  assert.match(confirmedHtml, /<button class="value-flag" type="button" data-flag-note="detailFlagNote1"[^>]*aria-label="kcat\/Km: printed unit differs\. Show the note\."/);
  // The value carries the "!" (its amber note says which unit and why); the grey note says only that code converted it.
  assert.match(confirmedHtml, /<span class="vt-number">0\.9177<\/span><button class="value-flag"[^>]*data-flag-note="detailFlagNote1"/);
  assert.match(confirmedHtml, /<td class="vt-printed">55\.06 µM<sup>-1<\/sup> min<sup>-1<\/sup>/);
  assert.match(confirmedHtml, /<li>kcat, Km and kcat\/Km: converted by code from the printed units\.<\/li>/);
  assert.doesNotMatch(confirmedHtml, /printed unit read as/);
  const bothSummary = v2({ record_key: "unit-both", kcat: 150, km: 2.9, kcat_over_km: 54, kcat_display: "150", km_display: "2.9",
    kcat_over_km_display: "54", kcat_unit: "s^(-1)", km_unit: "mM", kcat_over_km_unit: "s^(-1)*mM^(-1)" });
  const bothHtml = measurementSection(bothSummary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [proofLine("kcat", "150 ± 13", "s^-1", ""), proofLine("Km", "2.9 ± 0.4", "μM", "printed unit read as mM"),
      proofLine("kcat/Km", "54", "s^-1 μM^-1", "printed unit read as s^-1 mM^-1")] });
  assert.match(bothHtml, /The paper prints μM; CatLog stores mM, 1000-fold apart, and kcat ÷ Km cannot show which is right\./);
  assert.match(bothHtml, /The paper prints s⁻¹ μM⁻¹; CatLog stores s⁻¹ mM⁻¹, 1000-fold apart/);
  assert.doesNotMatch(bothHtml, /AI audit/, "no audit, no audit sentence");
  // An AI audit of the value ends its note with what it found (0f2107bac841d82f); the note stays amber.
  const auditedHtml = measurementSection(bothSummary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [proofLine("kcat", "150 ± 13", "s^-1", ""),
      { ...proofLine("Km", "2.9 ± 0.4", "μM", "printed unit read as mM"), audit_date: "2026-10-12", audit_result: "kept" },
      { ...proofLine("kcat/Km", "54", "s^-1 μM^-1", "printed unit read as s^-1 mM^-1"), audit_date: "2026-10-12", audit_result: "unit corrected" }] });
  assert.match(auditedHtml, /The paper prints μM; CatLog stores mM, 1000-fold apart, and kcat ÷ Km cannot show which is right\. An AI audit on Oct 12, 2026 re-checked it against the paper and kept mM\./);
  assert.match(auditedHtml, /CatLog stores s⁻¹ mM⁻¹, 1000-fold apart, and kcat ÷ Km cannot show which is right\. An AI audit on Oct 12, 2026 re-checked it against the paper and corrected its unit\./);
  assert.match(auditedHtml, /aria-label="Km: printed unit differs\. Show the note\."/);
  // CatLog's own flag for it (printed_unit_prefix_differs) is a unit caution; the per-value notes say it, once.
  const flaggedBoth = { ...bothSummary, condition_flags: ["printed_unit_prefix_differs"] };
  assert.equal(api.rowCautionBits(flaggedBoth), 2, "counted under Possible unit or magnitude error");
  const flaggedBothHtml = api.valuesSection(flaggedBoth, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [proofLine("kcat", "150 ± 13", "s^-1", ""), proofLine("Km", "2.9 ± 0.4", "μM", "printed unit read as mM")] });
  assert.doesNotMatch(flaggedBothHtml, /another concentration unit/);
  assert.match(flaggedBothHtml, /Km: The paper prints μM; CatLog stores mM/);
  assert.match(api.valuesSection(row({ record_key: "flag-only", condition_flags: ["printed_unit_prefix_differs"] }), {}),
    /<li id="detailFlagNote1"[^>]*><span class="value-flag" aria-hidden="true"><\/span><span>The paper prints another concentration unit than the one CatLog uses \(printed unit differs\)\.<\/span><\/li>/);
  // The Method line never says "values stored as printed" above such a note (0f2107bac841d82f).
  api.renderDetail(bothSummary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [proofLine("kcat", "150 ± 13", "s^-1", ""), proofLine("Km", "2.9 ± 0.4", "μM", "printed unit read as mM"),
      proofLine("kcat/Km", "54", "s^-1 μM^-1", "printed unit read as s^-1 mM^-1")] });
  const methodHtml = element("detailContent").innerHTML;
  assert.doesNotMatch(methodHtml, /values stored as printed/);
  assert.match(methodHtml, /compared each value with the paper; not every value is stored in the unit the paper prints \(see the notes\)\./);
  // The same prefix read differently (M^-1 s^-1 for m^-1 s^-1) keeps the plain grey hint.
  const sameHtml = measurementSection(bothSummary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [proofLine("kcat/Km", "54", "M^-1 s^-1", "converted by code, printed unit read as 10^3 M-1 s-1")] });
  assert.doesNotMatch(sameHtml, /unit-caution|printed unit differs/);
  assert.match(sameHtml, /<li>kcat\/Km: converted by code, printed unit read as 10³ M⁻¹ s⁻¹\.<\/li>/);
}
// A merged older record: the kcat/Km its sources list sits under the values, in the source's name and the catalog unit;
// when every one is more than 2-fold from kcat ÷ Km, an amber note says so.
{
  const merged = row({ record_key: "listed", kcat: 7.333, km: 0.5, kcat_over_km: 14.666, kcat_display: "7.333", km_display: "0.5",
    kcat_over_km_display: "14.666", kcat_over_km_origin: "calculated", kcat_unit: "s^(-1)", km_unit: "mM",
    kcat_over_km_unit: "s^(-1)*mM^(-1)", kcat_over_km_source_differs: true, source_db: "oed" });
  const listed = [3.0, 5.333, 3.083, 5.152, 6.117].map((value) => ({ value, unit: "1/mM*1/s", source_db: "oed" }));
  const html = measurementSection(merged, { source_kcat_over_km_values: listed });
  assert.match(html, /<dt>kcat\/Km listed by OED<\/dt><dd><span class="source-efficiency-value"><span><span class="listed-end">3\.0<\/span>–<span class="listed-end">6\.1<\/span> s<sup>-1<\/sup> mM<sup>-1<\/sup><\/span><small>5 values<\/small><\/span><\/dd>/);
  assert.match(html, /kcat ÷ Km \(15 s⁻¹ mM⁻¹\) is 2\.4–4\.9-fold above every kcat\/Km OED lists for this record \(3\.0–6\.1\)\./);
  assert.match(html, /aria-label="kcat\/Km mismatch\. Show the note\."/, "the Guide's caution name");
  // Every number in the Value column ends at the same place: a row without calc. or "!" keeps their space, unseen.
  assert.match(html, /<span class="vt-number">7\.33<\/span><small class="metric-origin vt-ghost" aria-hidden="true">calc\.<\/small><span class="value-flag vt-ghost" aria-hidden="true"><\/span><\/td>/);
  assert.match(html, /<span class="vt-number">15<\/span><small class="metric-origin" title="[^"]+">calc\.<\/small><button class="value-flag"/);
  assert.ok(html.indexOf("kcat/Km listed by OED") < html.indexOf("is 2.4–4.9-fold above"), "the listed values come first, under the values");
  // Its calc. note never says the source does not print a kcat/Km: it says CatLog calculated it and points at the listed one.
  assert.match(html, /<span class="metric-origin">calc\.<\/span> kcat ÷ Km, calculated by CatLog\. OED lists its own kcat\/Km \(above\)\.<\/li>/);
  assert.doesNotMatch(html, /not printed in the source/);
  const alone = measurementSection(merged, {});
  assert.match(alone, /<span class="metric-origin">calc\.<\/span> kcat ÷ Km, calculated by CatLog\.<\/li>/);
  const twoSources = measurementSection(merged, { source_kcat_over_km_values: [...listed, { value: 40, unit: "s^(-1)*mM^(-1)", source_db: "brenda" }] });
  assert.match(twoSources, /calculated by CatLog\. OED and BRENDA list their own kcat\/Km values \(above\)\./);
  // CatLog's flag for the same conflict: a kcat/Km mismatch caution in the table and the filter; the record's note is the
  // one above, never the flag's name.
  const flagged = Object.assign(row({ ...merged, condition_flags: ["kcat_over_km_source_mismatch"] }), {});
  assert.equal(api.rowCautionBits(flagged), 1, "counted under kcat/Km mismatch, not under No cautions");
  assert.match(api.valueFlagBadgeHtml(api.conditionFlags(flagged), "kcat_over_km", flagged), /title="Every kcat\/Km the source databases list for this record is more than 2-fold from the kcat\/Km shown"/);
  const flaggedHtml = measurementSection(flagged, { source_kcat_over_km_values: listed });
  assert.match(flaggedHtml, /is 2\.4–4\.9-fold above every kcat\/Km OED lists/);
  assert.doesNotMatch(flaggedHtml, /Kcat over km|source mismatch|more than 2-fold from the kcat\/Km shown/);
  assert.match(measurementSection(flagged, {}), /Every kcat\/Km the source databases list for this record is more than 2-fold from the kcat\/Km shown\./);
  assert.equal(api.rowCautionBits(row({ record_key: "ph-only", condition_flags: ["ph_outside_0_14"] })), 16, "a flag of no group is no caution, as Stats counts it");
  const close = measurementSection(merged, { source_kcat_over_km_values: [...listed, { value: 14, unit: "s^(-1)*mM^(-1)", source_db: "brenda" }] });
  assert.match(close, /kcat\/Km listed by BRENDA/);
  assert.doesNotMatch(close, /fold above|kcat\/Km mismatch/, "one listed value agrees: no note");
  // One kcat/Km flagged against kcat ÷ Km and against the listed values: one note says both (f93512e053523964).
  const older = (key, kcat, km, ratio, flags) => row({ record_key: key, kcat, km, kcat_over_km: Number(ratio), kcat_display: String(kcat),
    km_display: String(km), kcat_over_km_display: ratio, kcat_unit: "s^(-1)", km_unit: "mM", kcat_over_km_unit: "s^(-1)*mM^(-1)",
    kcat_over_km_source_differs: true, source_db: "brenda", condition_flags: flags });
  const both = ["kcat_over_km_quotient_mismatch", "kcat_over_km_source_mismatch"];
  const twice = measurementSection(older("twice", 4.1, 0.22, "46.067", both), { source_kcat_over_km_values: [{ value: 18.6, unit: "s^(-1)*mM^(-1)", source_db: "brenda" }] });
  assert.match(twice, /The stored kcat\/Km \(46\.1 s⁻¹ mM⁻¹\) is 2\.5-fold above kcat ÷ Km \(19 s⁻¹ mM⁻¹\)\. BRENDA lists kcat\/Km 18\.6 s⁻¹ mM⁻¹ for this record, which agrees with kcat ÷ Km\./);
  assert.equal((twice.match(/<li id="detailFlagNote/g) || []).length, 1, "one note for one mismatch");
  assert.doesNotMatch(twice, /more than 2-fold from the kcat\/Km shown|stored as the source lists them/);
  const some = measurementSection(older("some", 0.076, 1.26, "227.78", both), { source_kcat_over_km_values: [
    { value: 0.06027, unit: "s^(-1)*mM^(-1)", source_db: "brenda" }, { value: 5, unit: "s^(-1)*mM^(-1)", source_db: "brenda" }] });
  assert.match(some, /BRENDA lists 2 kcat\/Km values for this record \(0\.060–5\.0 s⁻¹ mM⁻¹\); one of them agrees with kcat ÷ Km\./);
  // Without listed values in the catalog unit the flags keep their own notes.
  assert.match(measurementSection(older("bare", 4.1, 0.22, "46.067", both), {}), /The source&#39;s kcat\/Km \(46\.1 s⁻¹ mM⁻¹\) is 2\.5-fold above/);
  // A familiar factor between kcat ÷ Km and the listed kcat/Km is named (e375ce185827beeb, 3dc72daa0a20580c).
  const thousand = measurementSection(older("thousand", 3.5, 64, "0.05469", ["kcat_over_km_source_mismatch"]),
    { source_kcat_over_km_values: [{ value: 55.5, unit: "s^(-1)*mM^(-1)", source_db: "brenda" }] });
  assert.match(thousand, /is 1,015-fold below the kcat\/Km BRENDA lists for this record \(55\.5\)\. The factor is close to 1000, the factor between per mM and per M\./);
  // Folds past 10,000 are not spelled out (4a0225c90ac5a298).
  const far = measurementSection(older("far", 390000, 0.0013, "3e+8", ["kcat_over_km_source_mismatch"]),
    { source_kcat_over_km_values: [328, 650, 0.0042].map((value) => ({ value, unit: "s^(-1)*mM^(-1)", source_db: "sabio_rk" })) });
  assert.match(far, /is more than 10,000-fold above every kcat\/Km SABIO-RK lists for this record \(0\.0042–650\)\./);
  assert.doesNotMatch(far, /461,538/);
  const wide = measurementSection(older("wide", 300, 1, "300", ["kcat_over_km_source_mismatch"]),
    { source_kcat_over_km_values: [0.01, 10].map((value) => ({ value, unit: "s^(-1)*mM^(-1)", source_db: "brenda" })) });
  assert.match(wide, /is 30- to more than 10,000-fold above every kcat\/Km BRENDA lists/);
}
// Records of one paper that read alike: the export's condition note under the substrate (table and record); without
// one, look-alikes with values on the page that share a paper say only that they read the same.
{
  const twin = (key, extra = {}) => Object.assign(row({ record_key: key, measurement_key: key, substrate_name: "pyruvate" }), { _pmids: 25401076, _dois: null }, extra);
  const page = [twin("a"), twin("b"), twin("c", { kcat_display: "2" }), twin("d", { condition_note: "+10 mM FBP" }), twin("e", { _pmids: 1 })];
  const alike = api.lookAlikeRowKeys(page);
  assert.deepEqual([...alike.keys()].sort(), ["a", "b"]);
  assert.equal(api.substrateNoteHtml(page[0], alike), '<small class="condition-note" title="same values as another record of this paper">like another record</small>');
  const empty = (key) => twin(key, { kcat_display: "", km_display: "", kcat_over_km_display: "" });
  assert.equal(api.lookAlikeRowKeys([empty("x"), empty("y")]).size, 0, "records without values are not called look-alikes");
  assert.equal(api.substrateNoteHtml(page[2], alike), "");
  assert.match(api.substrateNoteHtml(page[3], alike), /title="\+10 mM FBP">\+10 mM FBP<\/small>/);
  // The table shows no temperature or pH: look-alikes that differ only there say which, and only the part that differs.
  const assay = [twin("p1", { ph_display: "6.5", temperature_display: "25" }), twin("p2", { ph_display: "8.5", temperature_display: "25" }),
    twin("p3", { ph_display: "", temperature_display: "25" }), twin("t1", { substrate_name: "lactate", temperature_display: "25" }),
    twin("t2", { substrate_name: "lactate", temperature_display: "37", ph_display: "" }), twin("t3", { substrate_name: "lactate", temperature_display: "37", ph_display: "7" }),
    twin("same1", { substrate_name: "malate", ph_display: "7", temperature_display: "30" }), twin("same2", { substrate_name: "malate", ph_display: "7", temperature_display: "30" }),
    twin("same3", { substrate_name: "malate", ph_display: "8", temperature_display: "30" })];
  const notes = api.lookAlikeRowKeys(assay);
  assert.equal(notes.get("p1"), "pH 6.5");
  assert.equal(notes.get("p2"), "pH 8.5");
  assert.equal(notes.get("p3"), "pH not stated");
  assert.equal(notes.get("t1"), "pH 7 · 25 °C");
  assert.equal(notes.get("t2"), "pH not stated · 37 °C");
  assert.equal(notes.get("t3"), "pH 7 · 37 °C");
  assert.equal(notes.get("same1"), "", "a record that shares its temperature and pH with another still reads alike");
  assert.equal(notes.get("same3"), "pH 8");
  assert.equal(api.substrateNoteHtml(assay[0], notes), '<small class="condition-note" title="pH 6.5; the other values as another record of this paper">pH 6.5</small>');
  assert.match(api.substrateNoteHtml(assay[6], notes), />like another record<\/small>/);
  // A pH or temperature series whose values differ (cruzain at pH 3.5 to 7.5, PMID 29336553): each record says its own
  // pH; records that read alike in every column, pH included, still say so; another variant or paper is another series.
  const citrate = (key, ph, kcat, extra = {}) => twin(key, { substrate_name: "citrate", ph_display: ph, kcat_display: kcat, ...extra });
  const series = [citrate("s1", "3.5", "0.003"), citrate("s2", "5", "0.21"), citrate("s3", "7.5", "0.67"), citrate("s4", "7.5", "0.67"),
    citrate("s5", "6", "0.5", { mutation_signature: "E208A" }), citrate("s6", "6", "0.4", { _pmids: 2 }),
    citrate("s7", "4.1", "0.012", { verification_status: "corrected" })];
  const seriesNotes = api.lookAlikeRowKeys(series);
  assert.equal(seriesNotes.get("s1"), "pH 3.5");
  assert.equal(seriesNotes.get("s2"), "pH 5");
  assert.equal(seriesNotes.get("s7"), "pH 4.1", "a review result of its own does not take a record out of its series");
  assert.equal(seriesNotes.get("s3"), "", "records that read alike, pH included, still say so");
  assert.equal(seriesNotes.get("s4"), "");
  assert.equal(seriesNotes.has("s5"), false, "another variant is another series");
  assert.equal(seriesNotes.has("s6"), false, "another paper is another series");
  assert.equal(api.substrateNoteHtml(series[0], seriesNotes), '<small class="condition-note" title="pH 3.5; this paper also measured this enzyme and substrate at another pH">pH 3.5</small>');
  assert.match(api.substrateNoteHtml(series[2], seriesNotes), /title="same values as another record of this paper">like another record<\/small>/);
  const urea = [twin("u1", { substrate_name: "urea", temperature_display: "25", km_display: "1" }),
    twin("u2", { substrate_name: "urea", temperature_display: "37", km_display: "3" }), twin("u3", { substrate_name: "urea", temperature_display: "37", ph_display: "8", km_display: "4" })];
  const ureaNotes = api.lookAlikeRowKeys(urea);
  assert.deepEqual(["u1", "u2", "u3"].map((key) => ureaNotes.get(key)), ["pH 7 · 25 °C", "pH 7 · 37 °C", "pH 8 · 37 °C"]);
  assert.match(api.substrateNoteHtml(urea[0], ureaNotes), /title="pH 7 · 25 °C; this paper also measured this enzyme and substrate at another pH or temperature">pH 7 · 25 °C</);
  const warm = api.lookAlikeRowKeys(urea.slice(0, 2));
  assert.match(api.substrateNoteHtml(urea[1], warm), /title="37 °C; this paper also measured this enzyme and substrate at another temperature">37 °C</);
  api.renderDetail(row({ record_key: "noted" }), { condition_note: "with 10 mM FBP" });
  assert.match(element("detailContent").innerHTML, /<span class="detail-substrate-name">Substrate<\/span><\/p><p class="detail-condition-note">with 10 mM FBP<\/p>/);
  api.renderDetail(row({ record_key: "not-noted" }), {});
  assert.doesNotMatch(element("detailContent").innerHTML, /detail-condition-note/);
  // The record index carries the note as an optional column; an index without it gives every row null.
  const enumFields = ["enzyme_label_source", "source_db", "verification_status", "evidence_confidence_tier", "sequence_variant_status",
    "kcat_over_km_origin", "public_trust_basis", "temperature_display", "condition_flags", "kcat_unit", "km_unit", "kcat_over_km_unit", "wild_type"];
  const textFields = ["enzyme_display_name", "ec_number", "organism", "substrate_name", "mutation_signature", "primary_uniprot_id",
    "kcat_display", "km_display", "kcat_over_km_display"];
  const baseFields = ["record_key", "review_key", ...textFields, "protein_accession", "kcat", "km", "kcat_over_km", "ph_display",
    "temperature_k", "source_record_count", ...enumFields];
  const enums = Object.fromEntries(enumFields.map((field) => [field, [null]]));
  const values = (key) => baseFields.map((field) => (field === "record_key" ? key : enumFields.includes(field) ? 0 : field === "review_key" ? true : null));
  const withNote = api.checkedViewerIndexHeader({ schema_version: 2, details_per_shard: 250, enums, texts: {},
    fields: [...baseFields, "condition_note", "s"] }, 250);
  const NotedRow = api.viewerRowConstructor(withNote, ["details-000.js"]);
  assert.equal(new NotedRow([...values("x"), "+10 mM FBP", 0]).condition_note, "+10 mM FBP");
  assert.equal(new NotedRow([...values("y"), null, 0]).condition_note, null);
  assert.match(api.substrateNoteHtml(new NotedRow([...values("x"), "+10 mM FBP", 0]), new Set()), />\+10 mM FBP<\/small>/);
  const without = api.checkedViewerIndexHeader({ schema_version: 2, details_per_shard: 250, enums, texts: {}, fields: [...baseFields, "s"] }, 250);
  assert.equal(new (api.viewerRowConstructor(without, ["details-000.js"]))([...values("z"), 0]).condition_note, null);
}
// The line quoted from the paper: where it is ("Table 2 row"), table markers gone, K_M and k_{cat} as K<sub>m</sub> and
// k<sub>cat</sub>; a long table row or one whose ± signs were lost is folded away with a warning.
{
  const v2Summary = row({ record_key: "printed-lines", source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name" });
  const quoted = (printed_line, metric = "Km") => measurementSection(v2Summary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [{ metric, table_label: "Table 2", printed: "1 mM", printed_line, check: "confirmed", conversion: "" }] });
  let html = quoted("mpCAR [rowspan] | K_m [mm] | 20±4*");
  // The caption above the table names the place, so the line does not repeat it.
  assert.match(html, /<caption>Printed in Table 2<\/caption>/);
  assert.match(html, /<p class="evidence-note-plain">As extracted from the paper’s text: “mpCAR \| <i>K<\/i><sub>m<\/sub> \[mm\] \| 20±4\*”<\/p>/);
  assert.doesNotMatch(html, /rowspan|<details class="printed-line-disclosure"/);
  html = quoted("We fitted K_M = 4.6 ± 1.0 μM, k_{cat} = 9.7 s^{−1} and K_{m L}-methionine");
  assert.match(html, /<i>K<\/i><sub>m<\/sub> = 4\.6/);
  assert.match(html, /<i>k<\/i><sub>cat<\/sub> = 9\.7 s<sup>−1<\/sup>/);
  assert.match(html, /<i>K<\/i><sub>m L<\/sub>-methionine/);
  // A caret charge is a superscript too (NADP^+, Mn^2+, Mn^{2+}, CN^−, a bare "^-" extraction left), and an exponent
  // extraction split ("min^− 1", "10^−^3") is read whole; exponents stay as they were.
  html = quoted("Km[NADP^+] 4 mM with Mn^2+ or Mn^{2+}; CN^− → OAS; 590 min^− 1; 9.1 × 10^- ; 9.1 × 10^−^3; Cl^− 5 mM; k_{cat} 3 s^-1, 2 M^(-2)");
  assert.match(html, /Km\[NADP<sup>\+<\/sup>\] 4 mM with Mn<sup>2\+<\/sup> or Mn<sup>2\+<\/sup>; CN<sup>−<\/sup> → OAS; 590 min<sup>−1<\/sup>; 9\.1 × 10<sup>-<\/sup> ; 9\.1 × 10<sup>−3<\/sup>;/);
  assert.match(html, /Cl<sup>−<\/sup> 5 mM/, "an ion's charge before a concentration is not an exponent");
  assert.match(html, /<i>k<\/i><sub>cat<\/sub> 3 s<sup>-1<\/sup>, 2 M<sup>-2<\/sup>/);
  assert.equal(api.caretHtml("NAD^{+}-dependent, 10^3 M^-1 s^-1"), "NAD<sup>+</sup>-dependent, 10<sup>3</sup> M<sup>-1</sup> s<sup>-1</sup>");
  html = quoted("L-phenylalanine wt 1.1 ( 0.070 68 ( 1.4 62");
  assert.match(html, /<details class="printed-line-disclosure"><summary>Show the line as extracted<\/summary><p class="evidence-note-plain">As extracted/);
  assert.match(html, /<p class="printed-line-note">Text extraction dropped the ± signs from this line\.<\/p><\/details>/);
  const longRow = quoted("2Np-Gal | 0.9 ± 0.1 | 295.0 ± 6.3 | 310.0 | 24.7 ± 3.9");
  assert.match(longRow, /<details class="printed-line-disclosure">/, "more than four cells");
  assert.doesNotMatch(longRow, /printed-line-note/, "a row that kept its ± signs gets no warning");
  assert.doesNotMatch(measurementSection(v2Summary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [{ metric: "Km", table_label: "Results, p. 4", printed: "1 mM", printed_line: "a Km of 1 mM", check: "confirmed", conversion: "" }] }),
  /row, as extracted/, "only a table's line is a row");
  const lines = (...entries) => measurementSection(v2Summary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: entries.map(([metric, table_label, printed_line, printed = "1 mM"]) => ({ metric, table_label, printed, printed_line, check: "confirmed", conversion: "" })) });
  // One line, places that differ: the line gives its place (the Where column has both).
  html = lines(["kcat", "Table 2", "wt | 1 | 2", "1 s^-1"], ["Km", "Table 3", "1 mM"]);
  assert.match(html, /<p class="evidence-note-plain">Table 2 row, as extracted from the paper’s text: “wt/);
  // A sentence (no cells) is not a row, even when the values are said to be in a table.
  html = lines(["kcat", "Table VIII", "the K values for ETF were 3.8, 4.5 and 8.3", "1 s^-1"], ["Km", "Table 3", "1 mM"]);
  assert.match(html, /<p class="evidence-note-plain">Table VIII, as extracted from the paper’s text: “the K values/);
  // More than one line: each names its values, and a line another value's line continues is quoted once, the longer.
  const excerpt = "kcat = 4.0 ± 0.4 s–1 and Km = 3.1 mM catalyze the conversion";
  html = lines(["kcat", "Results", excerpt, "4.0 ± 0.4 s^-1"], ["Km", "Results", "a Km of 3.1 ± 0.3 mM was found"],
    ["kcat/Km", "Results", `${excerpt} of this peptide …`, "1.4 mM^-1 s^-1"]);
  assert.equal((html.match(/class="evidence-note-plain"/g) || []).length, 2);
  assert.match(html, /<p class="evidence-note-plain">kcat and kcat\/Km line, as extracted from the paper’s text: “kcat = 4\.0 ± 0\.4 s–1 and Km = 3\.1 mM catalyze the conversion of this peptide …”<\/p>/);
  assert.match(html, /<p class="evidence-note-plain">Km line, as extracted from the paper’s text: “a Km of 3\.1/);
  assert.doesNotMatch(html, /Results, as extracted/, "the caption names the place");
  // Folded lines name their values, so two toggles never read alike.
  html = lines(["kcat", "Table 2", "kcat | 1 | 2 | 3 | 4", "1 s^-1"], ["Km", "Table 2", "Km | 1 | 2 | 3 | 4"]);
  assert.match(html, /<summary>Show the kcat line as extracted<\/summary><p class="evidence-note-plain">kcat line, as extracted/);
  assert.match(html, /<summary>Show the Km line as extracted<\/summary>/);
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
  assert.match(html, /<dt>Second check<\/dt><dd>All values confirmed\. The AI check also corrected the construct description \(see Preparation\)\.<\/dd>/);
  assert.doesNotMatch(html, /AI check<\/th>|second run|for every value:/);
  html = render([line("kcat", "corrected: unit used for the conversion (was none, now mM)"), line("Km", "corrected: unit used for the conversion (was none, now mM)")]);
  assert.match(html, /<dt>Second check<\/dt><dd>Unit set to mM for every value\.<\/dd>/);
  html = render([line("kcat", "confirmed"), line("Km", "corrected: EC number (was 2.7.2.12, now none); assay conditions; qualifier (apparent, Hill fit or similar)")],
    { assay_conditions_summary: "pH 7; 50 mM Tris" });
  // Values whose results differ: the Second check line names each value's result (no column in Values).
  assert.doesNotMatch(html, /AI check<\/th>/);
  assert.match(html, /<dt>Second check<\/dt><dd>kcat: confirmed; Km: qualifier corrected\. The AI check also removed EC 2\.7\.2\.12 and corrected the assay conditions \(see Conditions\)\.<\/dd>/);
  assert.doesNotMatch(html, /\(was |unit used for the conversion/);
  // Phrases already in plain words pass through; a caution on a confirmed value is pointed to.
  html = render([line("kcat", "confirmed"), line("Km", "confirmed"), line("kcat/Km", "confirmed")]);
  assert.match(html, /All values confirmed\.<\/dd>/);
  api.renderDetail(row({ record_key: "checks-flag", source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name",
    kcat: 8.5, km: 320, kcat_over_km: 0.033, kcat_display: "8.5", km_display: "320", kcat_over_km_display: "0.033",
    condition_flags: ["kcat_over_km_quotient_mismatch"] }), { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [line("kcat", "confirmed"), line("Km", "confirmed"), line("kcat/Km", "confirmed")] });
  assert.match(element("detailContent").innerHTML, /<dt>Second check<\/dt><dd>All values confirmed as printed; see the note on kcat\/Km\.<\/dd>/);
  html = render([line("kcat", "corrected: cosubstrate; assay conditions")], { assay_conditions_summary: "50 mM Tris" });
  assert.match(html, /All values confirmed\. The AI check also corrected the cosubstrate and the assay conditions \(see Conditions\)\.<\/dd>/);
  html = render([line("kcat", "corrected: unit set to mM; EC 1.1.1.25 removed")]);
  assert.match(html, /<dt>Second check<\/dt><dd>Unit set to mM for every value\. The AI check also removed EC 1\.1\.1\.25\.<\/dd>/);
  // A removed EC the header still shows (the record's EC is 1.1.1.1 here) says where the shown one comes from.
  const removedShown = (summary, method = "catlog_v2_read_and_independent_verify") => {
    api.renderDetail(row({ record_key: "checks-ec", source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name", ...summary }),
      { verification_method: method, proof_lines: [line("kcat", "corrected: EC 1.1.1.1 removed")] });
    return element("detailContent").innerHTML;
  };
  html = removedShown({}, "catlog_v2_read_and_independent_verify; ec_from_databases");
  assert.match(html, /EC 1\.1\.1\.1 \(from enzyme databases; not printed in the paper\)/);
  assert.match(html, /All values confirmed\. The AI check also removed EC 1\.1\.1\.1 \(not printed in the paper; the EC shown comes from the enzyme databases\)\.<\/dd>/);
  assert.match(removedShown({ primary_uniprot_id: "A0A5H2WVH6" }),
    /The AI check also removed EC 1\.1\.1\.1 \(not printed in the paper; the EC shown comes from the UniProt entry A0A5H2WVH6\)\.<\/dd>/);
  assert.match(removedShown({ primary_uniprot_id: null }), /The AI check also removed EC 1\.1\.1\.1 \(not printed in the paper\)\.<\/dd>/);
  // CatLog's words for a field the reader left empty ("set to") or the check emptied ("left blank") read as actions too.
  html = render([line("kcat", "corrected: pH left blank; EC set to 3.2.1.23; temperature left blank; protein IDs corrected"),
    line("Km", "corrected: pH left blank; EC set to 3.2.1.23; temperature left blank; protein IDs corrected")]);
  assert.match(html, /All values confirmed\. The AI check also left the pH blank and the temperature blank, set the EC number to 3\.2\.1\.23 and corrected the protein IDs\.<\/dd>/);
  html = render([line("kcat", "corrected: organism set to Carica papaya")]);
  assert.match(html, /All values confirmed\. The AI check also set the organism to Carica papaya\.<\/dd>/);
  html = render([line("kcat", "corrected: pH set to 7.5; variant set to K12A; temperature set to 30 °C")]);
  assert.match(html, /The AI check also set the pH to 7\.5, the variant to K12A and the temperature to 30 °C\.<\/dd>/);
  html = render([line("kcat", "corrected: pH corrected to 7.0; variant removed; organism removed")]);
  assert.match(html, /The AI check also corrected the pH to 7\.0 and removed the variant and the organism\.<\/dd>/);
  assert.doesNotMatch(html, /also (?:pH|EC|organism|temperature|variant) /);
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
  assert.match(html, /<dt>Where<\/dt><dd>Table III · row Butanol<\/dd>/);
  assert.match(html, /<dt>As printed<\/dt><dd>Table III, row Butanol: V1 = 5\.2 \(unit row: s<sup>-1<\/sup>\)<\/dd>/);
  assert.match(html, /<dt>Conversion<\/dt><dd>kcat: paper V1 cell 5\.2 s<sup>-1<\/sup> → 5\.2 s<sup>-1<\/sup> \(no conversion\)\.<\/dd>/);
  // The earlier pipeline's reasoning goes; what was printed and the arithmetic stay (6d4893fb4e83eb11, a6c5593105452783).
  assert.equal(api.conversionFacts("Km: printed Table 1 cell 14.8 uM; 1 uM is 0.001 mM, so 14.8 / 1000 = 0.0148 mM; kcat: printed Table 1 cell 0.610 s-1; the printed unit is already the canonical s-1, so no unit conversion applies and the paper-side value is 0.61 s-1"),
    "Km: printed Table 1 cell 14.8 µM; 14.8 / 1000 = 0.0148 mM. kcat: printed Table 1 cell 0.610 s-1 (no conversion).");
  assert.equal(api.conversionFacts("kcat: paper V1 cell 5.2 s-1 → 5.2 s-1; no unit conversion (the paper's unit row already prints s-1, so no min-1/60-style conversion is involved). Km: paper cell 0.27 mM → 0.27 mM; no conversion. kcat/Km: not printed"),
    "kcat: paper V1 cell 5.2 s-1 → 5.2 s-1 (no conversion). Km: paper cell 0.27 mM → 0.27 mM (no conversion). kcat/Km: not printed.");
  assert.equal(api.conversionFacts("metric: Km; raw value: 3.4 ± 0.3; raw unit: uM; normalized value: 0.0034; normalized unit: mM"), "Km: 3.4 ± 0.3 µM → 0.0034 mM.");
  assert.equal(api.conversionFacts("kcat: printed cell 22 +/- 0.6 s^-1 is already in canonical units, 22.0 s^(-1)."), "kcat: printed cell 22 +/- 0.6 s^-1 (no conversion).");
  // A clause whose printed number would go is kept as it was.
  assert.match(api.conversionFacts("kcat: the column is per second, so no unit conversion applies"), /^kcat: no conversion\.$/);
  // "(no conversion)" sits after the value it is about, never after a value the clause goes on to convert.
  assert.equal(api.conversionFacts("Km: printed Table 3 cell 8739 uM; 8739 / 1000 = 8.739 mM; kcat: printed Table 3 cell 140 s^-1; already in s^-1, no unit conversion applies; the paper's own printed efficiency cell 16.0 x 10^3 M^-1 s^-1 converts to 16.0 s^-1 mM^-1 because 1 M^-1 s^-1 is 0.001 s^-1 mM^-1."),
    "Km: printed Table 3 cell 8739 µM; 8739 / 1000 = 8.739 mM. kcat: printed Table 3 cell 140 s^-1 (no conversion); printed efficiency cell 16.0 x 10^3 M^-1 s^-1 converts to 16.0 s^-1 mM^-1 because 1 M^-1 s^-1 is 0.001 s^-1 mM^-1.");
  assert.equal(api.conversionFacts("Km: printed cell 60.8 uM; 60.8 / 1000 = 0.0608 mM. kcat: printed cell 2.5 s^-1; the cell is already in s^-1, so no unit conversion applies. 1 M^-1 s^-1 is 0.001 s^-1 mM^-1, so 0.41 x 10^5 / 1000 = 41.0 s^-1 mM^-1."),
    "Km: printed cell 60.8 µM; 60.8 / 1000 = 0.0608 mM. kcat: printed cell 2.5 s^-1 (no conversion); 0.41 x 10^5 / 1000 = 41.0 s^-1 mM^-1.");
  // A converted value the source calls canonical gets no tag; a printed 5.0 x 10^3 is a number, not a conversion.
  assert.equal(api.conversionFacts("Km: printed Table 2 cell 343.3 uM; 343.3 / 1000 = 0.3433 mM is the canonical paper value."),
    "Km: printed Table 2 cell 343.3 µM; 343.3 / 1000 = 0.3433 mM.");
  assert.equal(api.conversionFacts("Km: printed Table 2 cell 5.0 x 10^3 mM; the Km column of this table is already millimolar, so the paper value is 5000.0 mM."),
    "Km: printed Table 2 cell 5.0 x 10^3 mM (no conversion).");
  assert.match(html, /<dt>Evidence<\/dt><dd>Located in the paper<\/dd>/);
  assert.doesNotMatch(html, /`|-&gt;|Normalized|Reported|Values in source/);
  api.renderDetail(row({ record_key: "older-normalized", proof_kind: "paper_evidence", has_proof_excerpt: true }), {
    proof_lines: [{ table_label: "Table 1", normalized_value_unit_evidence: "Normalized paper Km: 14.29 uM = 0.01429 mM" }] });
  assert.match(element("detailContent").innerHTML, /<dt>Conversion<\/dt><dd>paper Km: 14\.29 µM = 0\.01429 mM\.<\/dd>/);
  // The earlier review's field names, doubled units, "+/-" and how it fetched the paper never show (9b6aef24da6a5ae3,
  // fb0399f5635b45b4, fd30a554cb5a4a74, 7a7905feca5ca6ea, 15a3fc9449a5f7bf, 1702072ddbfbb89d, 5200afbd43cdffe1).
  const note = (line) => api.evidenceNoteHtml(line).replace(/<[^>]+>/g, "|").replace(/\|+/g, "|").replace(/&#39;/g, "'");
  assert.equal(note({ table_label: "PubMed XML abstract PMID 7635824", row_label: "Citrobacter glycerol dehydrogenase / glycerol",
    raw_value_unit_evidence: "Km raw_value=1.27 mM raw_unit=mM", normalized_value_unit_evidence: "Km normalized_value=1.27 normalized_unit=mM" }),
  "|Where|Abstract · Citrobacter glycerol dehydrogenase / glycerol|As printed|Km 1.27 mM|Conversion|Km 1.27 mM.|");
  assert.match(note({ table_label: "Table 5", raw_value_unit_evidence: "Km raw_value=75 +/- 5 raw_unit=uM raw_cell=75 +/- 5; kcat raw_value=0.05 raw_unit=s^-1 raw_cell=0.05; kcat/Km raw_value=6.00 x 10^2 raw_unit=M^-1*s^-1 raw_cell=6.00 x 10^2" }),
    /\|As printed\|Km 75 ± 5 µM; kcat 0\.05 s\|-1\|; kcat\/Km 6\.00 × 10\|2\| M\|-1\| s\|-1\|$/);
  assert.match(note({ table_label: "Abstract kinetic prose segment", raw_value_unit_evidence: "Km raw_value=60 microM raw_unit=microM raw_cell=Kms were 66 microM (NADPH) and 60 microM [(S)-HMG-CoA]" }),
    /\|As printed\|Km 60 µM, printed “Kms were 66 µM \(NADPH\) and 60 µM \[\(S\)-HMG-CoA\]”\|$/);
  assert.match(note({ table_label: "Table 2", raw_value_unit_evidence: "kcat raw_value=0.022 raw_unit=s^-1 raw_cell=(2.2 +/- 0.1) x 10-2; KM raw_value=184 raw_unit=uM raw_uncertainty=+/- 6 uM" }),
    /\|As printed\|kcat 0\.022 s\|-1\|, printed “\(2\.2 ± 0\.1\) x 10-2”; KM 184 µM ± 6 µM\|$/);
  assert.equal(note({ table_label: "TABLE 4 'Steady-state kinetic constants'", row_label: "TABLE 4, decoded plain-numeral transcription, substrate row `NADH`",
    normalized_value_unit_evidence: "kcat/Km: the paper PRINTS the kcat/Km cell 1490 s^-1 mM^-1 for this substrate row" }),
  "|Where|TABLE 4 'Steady-state kinetic constants' · TABLE 4, substrate row NADH|Conversion|kcat/Km: the paper prints the kcat/Km cell 1490 s|-1| mM|-1| for this substrate row.|");
  assert.equal(note({ table_label: "ScienceDirect HTML Table 1, Kinetic properties of I. isl MalDH", row_label: "Pyruvate",
    normalized_value_unit_evidence: "kcat=8 s^-1. No Km was populated in the expected row, and Table 1 leaves Km blank for pyruvate." }),
  "|Where|Table 1, Kinetic properties of I. isl MalDH · Pyruvate|Conversion|kcat=8 s|-1|. The earlier record has no Km, and Table 1 leaves Km blank for pyruvate.|");
  assert.match(note({ table_label: "Official PMC full-text Table 1", row_label: "x", normalized_value_unit_evidence: "kcat/Km 81.3 s^-1 mM^-1; current_export_kcat_over_km=86.0 s^-1 mM^-1; current_export_km=1.21 mM; kcat_over_km 0.755 s^-1 mM^-1" }),
    /^\|Where\|Table 1 · x\|Conversion\|kcat\/Km 81\.3 .*; earlier kcat\/Km 86\.0 .*; earlier Km 1\.21 mM; kcat\/Km 0\.755 /);
  assert.match(note({ table_label: "PMID 17041055 PMC full text", row_label: "Sulfolobus tokodaii reductase", raw_value_unit_evidence: "Km 0.015 mM mM; normalized to 0.015 mM" }),
    /^\|Where\|Sulfolobus tokodaii reductase\|As printed\|Km 0\.015 mM; converted to 0\.015 mM\|$/);
  // A place, enzyme or abbreviation that only looks like a route stays (an ACS row, a substrate-label image, K_m=).
  assert.match(note({ table_label: "ACS Table 1", row_label: "Official substrate-label image", raw_value_unit_evidence: "K_m=2.2 mM; 1,5-AF_NADPH=49.0 mM" }),
    /^\|Where\|ACS Table 1 · Official substrate-label image\|As printed\|K_m=2\.2 mM; 1,5-AF_NADPH=49\.0 mM\|$/);
  // An accepted record's values were checked: its Evidence line does not say they were not located.
  api.renderDetail(row({ record_key: "older-cited", has_proof_excerpt: false, evidence_confidence_tier: "literature_linked" }), {});
  assert.match(element("detailContent").innerHTML, /<dt>Evidence<\/dt><dd>Paper cited<\/dd>/);
  api.renderDetail(row({ record_key: "older-cited-unverified", verification_status: "unverified", has_proof_excerpt: false, evidence_confidence_tier: "literature_linked" }), {});
  assert.match(element("detailContent").innerHTML, /<dt>Evidence<\/dt><dd>Paper cited \(values not located\)<\/dd>/);
}
// Source names: a record CatLog read says so; databases by name, never a raw key; a database note is headed by its
// source, without an importer's label, and is not shown when it only repeats the temperature and pH.
{
  const render = (summary, detail = {}) => {
    api.renderDetail(row({ record_key: "sources", ...summary }), detail);
    return element("detailContent").innerHTML;
  };
  let html = render({ source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name" },
    { verification_method: "catlog_v2_read_and_independent_verify" });
  assert.match(html, /<dt>Source<\/dt><dd>The paper \(read by CatLog\)<\/dd>/);
  assert.doesNotMatch(html, /<dt>Name from<\/dt>/, "a record read from the paper takes its name from the paper: the Source says so");
  // The source's own details are rows of the Source section (each wraps; nothing to open at the record's end).
  assert.doesNotMatch(html, /Source details|<details class="detail-disclosure"/);
  html = render({ source_db: "strenda", proof_kind: "source_note", has_proof_excerpt: false },
    { proof_lines: ["Raw STRENDA Extraction: kcat/Km\t4200.0 (+/-) 290.0 M⁻¹ s⁻¹"] });
  assert.match(html, /<summary>Note from STRENDA DB<\/summary>/);
  assert.match(html, /<p class="evidence-note-plain">kcat\/Km 4200\.0 ± 290\.0 M⁻¹ s⁻¹<\/p>/);
  assert.match(html, /<dt>Source<\/dt><dd>STRENDA DB<\/dd>/);
  assert.doesNotMatch(html, /Raw STRENDA|<dt>Evidence<\/dt><dd>Database note/);
  html = render({ source_db: "sabio_rk;brenda", enzyme_label_source: "brenda_recommended_name", proof_kind: "source_note",
    has_proof_excerpt: false, temperature_display: "25", ph_display: "7.5" }, { proof_lines: ["pH 7.5, 25°C"] });
  assert.match(html, /<dt>Source<\/dt><dd>BRENDA, SABIO-RK<\/dd>/, "named as the status line names them");
  assert.match(html, /<dt>Name from<\/dt><dd>BRENDA recommended name<\/dd>/);
  assert.match(html.slice(html.indexOf('class="detail-section source-section"'), html.indexOf('class="detail-section conditions-section"')),
    /<dt>Source<\/dt><dd>BRENDA, SABIO-RK<\/dd><\/div><div class="kv-line"><dt>Name from<\/dt><dd>BRENDA recommended name<\/dd>/,
    "Name from follows the Source in its section");
  assert.doesNotMatch(html, /Note from|25°C/, "a note that only repeats T and pH is not shown");
  // SKiD's notes as CatLog writes them ("SKiD: 55°C, pH 8.9"): hidden when they only repeat T and pH; otherwise shown
  // without repeating the source the heading names.
  html = render({ source_db: "skid", proof_kind: "source_note", has_proof_excerpt: false, temperature_display: "55", ph_display: "8.9" },
    { proof_lines: ["SKiD: 55°C, pH 8.9"] });
  assert.doesNotMatch(html, /Note from|55°C/);
  html = render({ source_db: "skid", proof_kind: "source_note", has_proof_excerpt: false, temperature_display: "55", ph_display: "8.9" },
    { proof_lines: ["SKiD: 37°C, pH 8.9"] });
  assert.match(html, /<summary>Note from SKiD<\/summary>/);
  assert.match(html, /<p class="evidence-note-plain">37°C, pH 8\.9<\/p>/);
  html = render({ source_db: "skid;brenda", proof_kind: "source_note", has_proof_excerpt: false, temperature_display: "30", ph_display: "7" },
    { proof_lines: ["pH 7.5, 30°C", "SKiD: 30°C, pH 7"] });
  assert.match(html, /<p class="evidence-note-plain">pH 7\.5, 30°C<\/p>/);
  assert.doesNotMatch(html, /SKiD: 30°C/, "the SKiD note repeats T and pH");
  // A merged record's note does not name every database as its author, and its Databases row does not repeat the
  // Source's databases in another order (f1abdd207ecc711a); the name's origin reads plainly.
  html = render({ source_db: "sabio_rk;brenda;skid", enzyme_label_source: "ec_name_fallback", proof_kind: "source_note",
    has_proof_excerpt: false, temperature_display: "25", ph_display: "7" },
  { source_databases_merged: ["sabio_rk", "brenda", "skid"], proof_lines: ["liver mevalonate kinase", "SKiD: 25°C, pH 7"] });
  assert.match(html, /<dt>Source<\/dt><dd>BRENDA, SABIO-RK, SKiD<\/dd>/);
  assert.match(html, /<summary>Database note<\/summary><div class="evidence-note-list"><p class="evidence-note-plain">liver mevalonate kinase<\/p><\/div>/);
  assert.doesNotMatch(html, /Note from|<dt>Databases<\/dt>/);
  assert.match(html, /<dt>Name from<\/dt><dd>The EC list&#39;s accepted name<\/dd>/);
  html = render({ source_db: "sabio_rk", enzyme_label_source: "explicit_enzyme_name" }, { source_databases_merged: ["sabio_rk", "brenda"] });
  assert.match(html, /<dt>Databases<\/dt><dd>BRENDA, SABIO-RK<\/dd>/, "a database the Source does not name");
  assert.match(html, /<dt>Name from<\/dt><dd>The source database&#39;s entry<\/dd>/);
  html = render({ source_db: "skid", proof_kind: "source_note", has_proof_excerpt: false, temperature_display: "55", ph_display: "8.9" },
    { proof_lines: ["SKiD: 37°C, pH 8.9", "SKiD: 30°C, pH 7.0"] });
  assert.match(html, /<summary>Notes from SKiD<\/summary>/);
  // The earlier review's notes among a database's are not the database's (6537016e7c188e39): where the paper prints
  // the values goes under Paper, the route it took is left out.
  html = render({ source_db: "brenda", proof_kind: "source_note", has_proof_excerpt: false },
    { proof_lines: ["PMID 18984592 Table 1: Dpo4 T239W, dCTP opposite template G, pH 7.4 at 37 C", "Official PMC route: PMCID PMC2605995"] });
  assert.doesNotMatch(html, /Note from BRENDA|Official PMC route|PMC2605995/);
  const paperPart = html.slice(html.indexOf('class="detail-section paper-section"'));
  assert.match(paperPart, /<summary>Earlier automated review: where the values are printed<\/summary><div class="evidence-note-list"><p class="evidence-note-plain">Table 1: Dpo4 T239W, dCTP opposite template G, pH 7\.4 at 37 C<\/p>/);
  assert.match(render({ source_db: "brenda", proof_kind: "source_note", has_proof_excerpt: false },
    { proof_lines: ["PMCID PMC6555127 Table 2 row CYP3A4*2 (S222P)."] }), /<p class="evidence-note-plain">Table 2 row CYP3A4\*2 \(S222P\)\.<\/p>/);
  html = render({ source_db: "brenda", proof_kind: "source_note", has_proof_excerpt: false },
    { proof_lines: ["pH 7.4, 37°C, mutant T239W", "PMID 287271 is a comment on a focal-disease paper, not a kinetics paper."] });
  assert.match(html, /<summary>Note from BRENDA<\/summary><div class="evidence-note-list"><p class="evidence-note-plain">pH 7\.4, 37°C, mutant T239W<\/p><\/div>/);
  assert.doesNotMatch(html, /PMID 287271|Earlier automated review: where/);
}
// The report email quotes the numbers as the record shows them; the paper's title and year lead Paper.
{
  api.renderDetail(row({ record_key: "report-numbers", kcat: 7.333, km: 0.5, kcat_over_km: 14.666, kcat_display: "7.333",
    km_display: "0.5", kcat_over_km_display: "14.666", kcat_over_km_origin: "calculated", kcat_unit: "s^(-1)", km_unit: "mM",
    kcat_over_km_unit: "s^(-1)*mM^(-1)" }), { supporting_pmids: ["2936344"], paper_title: "Probing an invariant His", paper_year: 2019 });
  const html = element("detailContent").innerHTML;
  const body = decodeURIComponent(html.match(/id="reportRecordProblem" class="button secondary" href="([^"]+)"/)[1].replace(/&amp;/g, "&"));
  assert.match(body, /kcat 7\.33 s⁻¹; Km 0\.5 mM; kcat\/Km 15 s⁻¹ mM⁻¹; PMID 2936344/, "440/60 stored as 7.333 shows 3 figures");
  assert.doesNotMatch(body, /14\.666|7\.333/);
  assert.match(html, /<h3 id="detail-paper-title">Paper<\/h3><dl class="detail-kv"><div class="kv-line"><dt>Title<\/dt><dd>Probing an invariant His \(2019\)<\/dd><\/div>/);
  api.renderDetail(row({ record_key: "no-title" }), {});
  assert.doesNotMatch(element("detailContent").innerHTML, /<dt>Title<\/dt>/);
}

// Against the databases (design spec 5G): a record read from the paper shows its values against the databases only when
// the snapshot carries the comparison (each value's database_status ... fields, the record's database_note, or the
// snapshot's record checks); an earlier "corrected" record its correction trail; a database record the earlier review
// did not settle that its values are the database's; any other record has no section (never an empty heading).
{
  const v2Summary = row({ record_key: "v2-db", measurement_key: "v2-db", source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name",
    kcat: 30.4, km: 549.9, kcat_over_km: 0.06, kcat_display: "30.4", km_display: "549.9", kcat_over_km_display: "0.06",
    kcat_unit: "s^(-1)", km_unit: "mM", kcat_over_km_unit: "s^(-1)*mM^(-1)", kcat_over_km_origin: "paper_reported" });
  const line = (metric, extra = {}) => ({ metric, table_label: "Table 1", printed: "1", check: "confirmed", conversion: "", ...extra });
  const render = (summary, detail) => {
    api.renderDetail(summary, detail);
    return element("detailContent").innerHTML;
  };
  const v2Detail = (lines, extra = {}) => ({ verification_method: "catlog_v2_read_and_independent_verify", supporting_pmids: ["31072150"], proof_lines: lines, ...extra });
  let html = render(v2Summary, v2Detail([line("kcat"), line("Km")]));
  assert.doesNotMatch(html, /Against the databases|cmp-mark/);
  html = render(v2Summary, v2Detail([
    line("kcat", { database_status: "confirmed", database_line: "Same as BRENDA, SABIO-RK." }),
    line("Km", { database_status: "corrected", database_line: "BRENDA lists 0.5499 mM, 1,000× lower.", database_cause: "mM_entered_as_uM",
      database_evidence: "Table 1, row Cellobiose: 549.9 ± 62.5" }),
    line("kcat/Km", { database_status: "new", database_line: "Not in BRENDA, SABIO-RK, OED, SKiD or STRENDA for this paper." }),
  ], { database_note: "All 12 BRENDA Km values for this paper are 1000× lower than printed." }));
  const section = html.slice(html.indexOf('class="detail-section databases-section"'), html.indexOf('class="detail-section review-section"'));
  // One list, as the record's other sections: the parameter, then its value and result, the line, the cause (unless the
  // line gives it) and where the paper prints it, each wrapping.
  assert.match(section, /<h3 id="detail-databases-title">Against the databases<\/h3><p class="section-text cmp-paper-note">All 12 BRENDA Km values for this paper are 1000× lower than printed\.<\/p><dl class="detail-kv cmp-list"><div class="kv-line cmp-item"><dt><i>k<\/i><sub>cat<\/sub><\/dt><dd><span class="cmp-value">30\.4 <small>s<sup>-1<\/sup><\/small><\/span>/);
  assert.doesNotMatch(section, /<table|Databases for this paper/, "no table: a list that wraps at any width");
  assert.match(section, /<span class="cmp-mark cmp-same" aria-hidden="true"><\/span><strong>Same number<\/strong><\/span><span class="cmp-line">Same as BRENDA, SABIO-RK\.<\/span><\/dd>/);
  assert.match(section, /<dt><i>K<\/i><sub>m<\/sub><\/dt><dd><span class="cmp-value">549\.9 <small>mM<\/small><\/span><span class="cmp-result"><span class="cmp-mark cmp-magnitude" aria-hidden="true"><\/span><strong>Corrects a database value<\/strong><\/span><span class="cmp-line">BRENDA lists 0\.5499 mM, 1,000× lower\.<\/span><small class="cmp-cause">Checked against the paper: an mM value entered as µM<\/small><small class="cmp-where">In the paper: Table 1, row Cellobiose: 549\.9 ± 62\.5<\/small><\/dd>/);
  assert.match(section, /<span class="cmp-mark cmp-new" aria-hidden="true"><\/span><strong>Not in the databases<\/strong>/);
  assert.match(section, /<p class="section-note">Compared with the values BRENDA, SABIO-RK, OED, SKiD and STRENDA DB list for the same paper\. A different number can mean a different measurement\.<\/p>/);
  assert.doesNotMatch(section, /cmp-explore/, "no link to a Browse filter the page does not have");
  // Right after Values: what CatLog corrected against the databases is found at once.
  assert.ok(html.indexOf(">Values</h3>") < html.indexOf(">Against the databases</h3>") && html.indexOf(">Against the databases</h3>") < html.indexOf(">Source</h3>"));
  // A line that already says what the check against the paper found is not repeated by the cause.
  html = render(v2Summary, v2Detail([line("Km", { database_status: "corrected", database_cause: "uM_entered_as_mM",
    database_line: "BRENDA lists 630 mM, 1,000× higher. The paper prints 630 ± 170 µM (Table 1). Checked against the paper: µM entered as mM." })]));
  assert.doesNotMatch(html, /cmp-cause/);
  assert.match(html, /Checked against the paper: µM entered as mM\.<\/span><\/dd>/);
  // With Browse's "Against the databases" group on the page, the record links to the records like it: each option it
  // matches (a value corrected, one no database lists, every value the same, none in any database), never one the page
  // does not have.
  {
    const previousQuery = document.querySelector;
    const options = ["corrects", "same", "adds", "new", "earlier"];
    document.querySelector = (selector) => {
      const match = selector.match(/^#catalogFilters input\[name="database"\]\[value="([a-z]+)"\]$/);
      return match && options.includes(match[1]) ? {} : null;
    };
    try {
      html = render(v2Summary, v2Detail([
        line("kcat", { database_status: "confirmed", database_line: "Same as BRENDA." }),
        line("Km", { database_status: "new", database_line: "Not in BRENDA." }),
        line("kcat/Km", { database_status: "corrected", database_line: "BRENDA lists 60 mM⁻¹ s⁻¹." }),
      ]));
      assert.match(html, /<p class="cmp-explore">More records like this: <a href="#browse\?db=corrects">Corrects a database value<\/a><span aria-hidden="true"> · <\/span><a href="#browse\?db=adds">Adds a value to the databases<\/a><\/p>/);
      html = render(v2Summary, v2Detail([line("kcat", { database_status: "confirmed", database_line: "Same as BRENDA." }),
        line("Km", { database_status: "same", database_line: "Same as OED." })]));
      assert.match(html, /More records like this: <a href="#browse\?db=same">Same as a database<\/a><\/p>/);
      html = render(v2Summary, v2Detail([line("kcat", { database_status: "new", database_line: "Not in BRENDA." }),
        line("Km", { database_status: "new", database_line: "Not in OED." })]));
      assert.match(html, /More records like this: <a href="#browse\?db=new">In no database<\/a><\/p>/);
      html = render(v2Summary, v2Detail([line("kcat", { database_status: "differs", database_line: "BRENDA lists 3 s⁻¹." })]));
      assert.doesNotMatch(html, /cmp-explore/, "an option Browse does not have gets no link");
      html = render(row({ record_key: "corrected-explore", verification_status: "corrected", source_db: "oed" }),
        { supporting_pmids: ["1"], corrections: [{ field: "km", before: 66, after: 0.066, unit: "mM", kind: "magnitude" }] });
      assert.match(html, /More records like this: <a href="#browse\?db=earlier">Changed in the earlier review<\/a><\/p>/);
    } finally {
      document.querySelector = previousQuery;
    }
  }
  // A line that starts with the result word is the result: the word is not said twice, in bold above it.
  html = render(v2Summary, v2Detail([line("kcat", { database_status: "same", database_line: "same number in BRENDA, SABIO-RK" })]));
  assert.match(html, /<span class="cmp-mark cmp-same" aria-hidden="true"><\/span><span>Same number in BRENDA, SABIO-RK<\/span><\/span><\/dd>/);
  assert.doesNotMatch(html, /<strong>Same number<\/strong>|cmp-line/);
  // A kcat/Km CatLog calculated is not compared: its own row says so, once the other values have rows; never alone.
  const calculatedSummary = { ...v2Summary, record_key: "v2-db-calc", kcat_over_km_origin: "calculated" };
  html = render(calculatedSummary, v2Detail([line("kcat", { database_status: "same", database_line: "same number in BRENDA" }), line("Km")]));
  assert.match(html, /<div class="kv-line cmp-item"><dt><i>k<\/i><sub>cat<\/sub>\/<i>K<\/i><sub>m<\/sub><\/dt><dd><span class="cmp-value">0\.0600 <small>s<sup>-1<\/sup> mM<sup>-1<\/sup><\/small><\/span><span class="cmp-result"><span class="cmp-mark" aria-hidden="true"><\/span><span>Calculated; not compared<\/span><\/span><\/dd><\/div>/);
  html = render(calculatedSummary, v2Detail([line("kcat"), line("Km")]));
  assert.doesNotMatch(html, /Against the databases|not compared/, "no compared value, no section");
  // A correction of the database that is not a unit or a power of ten is a different number (brown), not red.
  html = render(v2Summary, v2Detail([line("Km", { database_status: "corrected", database_line: "BRENDA lists the value of another row.", database_cause: "value_from_other_row" })]));
  assert.match(html, /<span class="cmp-mark cmp-differs" aria-hidden="true"><\/span><strong>Corrects a database value<\/strong><\/span><span class="cmp-line">BRENDA lists the value of another row\.<\/span><small class="cmp-cause">Checked against the paper: a value from another cell of the table<\/small>/);
  // A cause code with no wording is not shown (never the raw code with spaces); a cause given as a phrase is shown as given.
  html = render(v2Summary, v2Detail([line("Km", { database_status: "corrected", database_line: "BRENDA lists 5 mM.", database_cause: "some_new_cause" })]));
  assert.doesNotMatch(html, /cmp-cause|some new cause|some_new_cause/);
  assert.match(html, /<strong>Corrects a database value<\/strong><\/span><span class="cmp-line">BRENDA lists 5 mM\.<\/span><\/dd>/);
  html = render(v2Summary, v2Detail([line("Km", { database_status: "corrected", database_line: "BRENDA lists 5 mM.", database_cause: "a misread header" })]));
  assert.match(html, /<small class="cmp-cause">Checked against the paper: a misread header<\/small>/);
  // A local file named as evidence is never shown.
  html = render(v2Summary, v2Detail([line("kcat", { database_status: "differs", database_line: "BRENDA lists 3 s⁻¹.", database_evidence: "/Users/someone/papers/123.pdf p. 4" })]));
  assert.doesNotMatch(html, /Users\/someone|\.pdf/);
  assert.match(html, /<strong>Different number<\/strong><\/span><span class="cmp-line">BRENDA lists 3 s⁻¹\.<\/span><\/dd>/);
  // A database_check object (one field per fact) and its database value, said when there is no line; the databases a
  // value's database_sources name likewise.
  html = render(v2Summary, v2Detail([line("Km", { database_check: { status: "corrected", sources: ["BRENDA", "OED"], database_value: 0.0028, database_unit: "mM" } })]));
  assert.match(html, /<span class="cmp-line">Databases: BRENDA, OED: 0\.0028 mM<\/span>/);
  html = render(v2Summary, v2Detail([line("Km", { database_status: "confirmed", database_sources: ["BRENDA", "SABIO-RK"] })]));
  assert.match(html, /<strong>Same number<\/strong><\/span><span class="cmp-line">Databases: BRENDA, SABIO-RK<\/span>/);
  html = render(v2Summary, v2Detail([line("Km", { database_status: "confirmed", database_line: "Same as BRENDA.", database_sources: ["BRENDA"] })]));
  assert.doesNotMatch(html, /Databases: /, "the line names them");
  // The snapshot's record checks (spec side file): its phrases are the result.
  assert.match(api.databasesSection(v2Summary, v2Detail([line("kcat"), line("Km"), line("kcat/Km")]), {
    v2Record: true, proof: null, check: { db: { kcat: ["same", "BRENDA,SABIO-RK"] } } }), /^$/, "no proof lines, no rows");
  {
    const proof = { lines: [line("kcat"), line("Km"), line("kcat/Km")], facts: [line("kcat"), line("Km"), line("kcat/Km")].map(api.v2LineFacts) };
    const sideFile = api.databasesSection(v2Summary, {}, { v2Record: true, proof,
      check: { db: { kcat: ["same", "BRENDA,SABIO-RK"], Km: ["differs", "BRENDA,OED", 5], "kcat/Km": ["absent", ""] } } });
    assert.match(sideFile, /<span class="cmp-mark cmp-same" aria-hidden="true"><\/span><span>Same number in BRENDA, SABIO-RK<\/span>/);
    assert.match(sideFile, /<span>Not among the 5 Km values BRENDA and OED list for this paper<\/span>/);
    assert.match(sideFile, /<span class="cmp-mark cmp-new" aria-hidden="true"><\/span><span>No database lists a kcat\/Km for this paper<\/span>/);
  }

  // An earlier "corrected" record: before → after and the kind of change per field, the earlier number's database and
  // where the paper prints it; other fields (pH, temperature, identifiers) the same way; why, once.
  const corrected = row({ record_key: "corrected-trail", verification_status: "corrected", source_db: "oed", kcat: 2.67, km: 0.066,
    kcat_display: "2.67", km_display: "0.066", kcat_unit: "s^(-1)", km_unit: "mM" });
  html = render(corrected, { supporting_pmids: ["2226453"], corrections: [
    { field: "km", before: 66, after: 0.066, unit: "mM", kind: "magnitude", listed: "OED", where: "Table 2, row 12-hydroxydodecanoic acid: Km 66 µM" },
    { field: "kcat", old_value: 2.7, new_value: 2.67, unit: "s^(-1)", kind: "rounding", evidence_table_row: "Table 2, row 12-hydroxydodecanoic acid" },
    { field: "kcat", old_value: 5, new_value: 5, unit: "s^(-1)", kind: "different" },
    { field: "kcat_over_km", old_value: null, new_value: 40, unit: "s^(-1)*mM^(-1)", kind: "added", evidence_table_row: "C:\\papers\\x.pdf" },
    { field: "ph", before: 7, after: 7.5, kind: "different" },
    { field: "temperature_k", before: 298.15, after: 303.15, kind: "different" },
    { field: "uniprot_id", old_value: "P00325", new_value: "P00326", kind: "changed" },
    { field: "smiles", kind: "replaced" },
  ] });
  const trail = html.slice(html.indexOf('class="detail-section databases-section"'), html.indexOf('class="detail-section review-section"'));
  assert.doesNotMatch(trail, /<table/);
  assert.match(trail, /<div class="kv-line cmp-item"><dt><i>K<\/i><sub>m<\/sub><\/dt><dd><span class="cmp-value">66 mM<span class="cmp-arrow"> → <\/span><strong>0\.066 mM<\/strong><\/span><span class="cmp-result"><span class="cmp-mark cmp-magnitude" aria-hidden="true"><\/span><span>unit or magnitude <span class="cmp-factor">\(÷ 1000\)<\/span><\/span><\/span><small class="cmp-before">Before: as in OED for this paper<\/small><small class="cmp-where">In the paper: Table 2, row 12-hydroxydodecanoic acid: Km 66 µM<\/small><\/dd><\/div>/);
  assert.match(trail, /<span class="cmp-value">2\.7 s⁻¹<span class="cmp-arrow"> → <\/span><strong>2\.67 s⁻¹<\/strong><\/span><span class="cmp-result"><span class="cmp-mark cmp-precision" aria-hidden="true"><\/span><span>more digits \/ rounding<\/span><\/span><small class="cmp-before">Before: earlier catalog value<\/small>/);
  assert.equal((trail.match(/>5 s⁻¹/g) || []).length, 0, "a field whose number did not change is not listed");
  assert.match(trail, /<span class="cmp-value">none<span class="cmp-arrow"> → <\/span><strong>40 s⁻¹ mM⁻¹<\/strong><\/span><span class="cmp-result"><span class="cmp-mark cmp-new" aria-hidden="true"><\/span><span>added: the source had none<\/span><\/span><\/dd>/);
  assert.match(trail, /<dt>pH<\/dt><dd><span class="cmp-value">7<span class="cmp-arrow"> → <\/span><strong>7\.5<\/strong><\/span>/);
  assert.match(trail, /<dt>Temperature<\/dt><dd><span class="cmp-value">25 °C<span class="cmp-arrow"> → <\/span><strong>30 °C<\/strong><\/span>/);
  assert.match(trail, /<dt>UniProt<\/dt><dd><span class="cmp-value">P00325<span class="cmp-arrow"> → <\/span><strong>P00326<\/strong><\/span><\/dd>/);
  assert.match(trail, /<dt>SMILES<\/dt><dd><span class="cmp-value">Replaced<\/span><\/dd>/);
  assert.doesNotMatch(trail, /papers\\x\.pdf|x\.pdf/, "a local path never");
  assert.match(trail, /<p class="section-note">Changed in the earlier automated review to what the paper prints\.<\/p>/);
  assert.match(html, /<dt>Review result<\/dt><dd>Corrected and accepted in the earlier automated review; the changes are listed under Against the databases\./);
  assert.doesNotMatch(html, /value before correction was not kept/);
  // Without its trail, a corrected record says the snapshot does not list the changes (the earlier catalog keeps them)
  // and has no section.
  html = render(corrected, { supporting_pmids: ["2226453"] });
  assert.doesNotMatch(html, /Against the databases/);
  assert.match(html, /Corrected and accepted in the earlier automated review; this snapshot does not list the changes\./);
  assert.doesNotMatch(html, /was not kept/);

  // A database record the earlier review did not settle: the values are the database's; accepted, disputed, no paper
  // linked or an earlier extraction: no section.
  const sectionOf = (summary) => render(summary, { supporting_pmids: ["1"] }).match(/<h3 id="detail-databases-title">Against the databases<\/h3>(.*?)<\/section>/)?.[1] ?? null;
  assert.equal(sectionOf(row({ record_key: "db-unverified", verification_status: "unverified", source_db: "brenda", has_proof_excerpt: false })),
    '<p class="section-text">Not yet checked against the paper: the values are the database&#39;s.</p>');
  assert.ok(sectionOf(row({ record_key: "db-pending", verification_status: "manual_review_required", source_db: "sabio_rk", has_proof_excerpt: false })));
  // Values the earlier review located in the paper (Evidence: Located in the paper) were checked against it: no section.
  assert.equal(sectionOf(row({ record_key: "db-located", verification_status: "unverified", source_db: "oed", has_proof_excerpt: false, proof_kind: "paper_evidence" })), null);
  assert.doesNotMatch(render(row({ record_key: "db-excerpt", verification_status: "manual_review_required", source_db: "brenda", has_proof_excerpt: false }),
    { supporting_pmids: ["1"], has_proof_excerpt: true }), /Against the databases|values are the database/);
  assert.equal(sectionOf(row({ record_key: "db-accepted", verification_status: "verified", source_db: "brenda" })), null);
  assert.equal(sectionOf(row({ record_key: "db-disputed", verification_status: "disputed", source_db: "brenda" })), null);
  assert.equal(sectionOf(row({ record_key: "db-no-paper", verification_status: "unverified", source_db: "skid", public_trust_basis: "identity_only" })), null);
  assert.equal(sectionOf(row({ record_key: "earlier-extraction", verification_status: "unverified", source_db: "primary_paper_direct" })), null);
  // A database record that names no paper (no PMID, DOI or paper ID) has nothing to be checked against: no section.
  assert.doesNotMatch(render(row({ record_key: "db-no-pmid", verification_status: "unverified", source_db: "strenda" }), {}), /Against the databases/);
  assert.match(render(row({ record_key: "db-doi-only", verification_status: "unverified", source_db: "strenda", has_proof_excerpt: false }), { supporting_dois: ["10.1/x"] }),
    /Against the databases/);
}
// The Paper section links to the paper's other records in Browse (the search box's pmid: or doi: form), this record
// kept open; the count once the record index is loaded, "Only this record" when it is the paper's one.
{
  const previous = { records: api.state.records, recordsReady: api.state.recordsReady };
  const summary = row({ record_key: "paper-a", measurement_key: "paper-a" });
  try {
    api.state.recordsReady = false;
    api.renderDetail(summary, { supporting_pmids: ["12234181"] });
    assert.match(element("detailContent").innerHTML, /<dt>In CatLog<\/dt><dd><a class="paper-records-link" href="#browse\?q=pmid:12234181&amp;record=paper-a">Records from this paper<span aria-hidden="true"> →<\/span><\/a><\/dd>/);
    api.state.records = [{ ...summary, _pmids: 12234181 }, row({ record_key: "paper-b", _pmids: [5, 12234181] }), row({ record_key: "other", _pmids: 5 })];
    api.state.recordsReady = true;
    api.renderDetail(summary, { supporting_pmids: ["12234181"] });
    assert.match(element("detailContent").innerHTML, /<a class="paper-records-link" href="#browse\?q=pmid:12234181&amp;record=paper-a">2 records from this paper</);
    api.state.records = [{ ...summary, _pmids: 12234181 }];
    api.renderDetail(summary, { supporting_pmids: ["12234181"] });
    assert.match(element("detailContent").innerHTML, /<div class="kv-line paper-records-row"><dt>In CatLog<\/dt><dd>Only this record<\/dd>/);
    api.renderDetail(summary, {});
    assert.doesNotMatch(element("detailContent").innerHTML, /In CatLog/, "no paper, no link");
    // A record that names several papers links to the first by name.
    api.state.records = [{ ...summary, _pmids: [12234181, 777] }, row({ record_key: "paper-c", _pmids: 12234181 })];
    api.renderDetail(summary, { supporting_pmids: ["12234181", "777"] });
    assert.match(element("detailContent").innerHTML, />2 records from PMID 12234181<span aria-hidden="true"> →</);
    api.state.recordsReady = false;
    api.renderDetail(summary, { supporting_dois: ["10.1021/bi020196a"] });
    assert.match(element("detailContent").innerHTML, /href="#browse\?q=doi:10\.1021\/bi020196a&amp;record=paper-a">Records from this paper</);
  } finally {
    api.state.records = previous.records;
    api.state.recordsReady = previous.recordsReady;
  }
}
// Show opens a sequence under its row and says Hide; Copy link copies the record's address.
{
  const box = element("revealBox");
  box.hidden = true;
  const button = makeElement("revealButton");
  button.dataset.revealTarget = "revealBox";
  api.toggleReveal(button);
  assert.equal(box.hidden, false);
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(button.textContent, "Hide");
  api.toggleReveal(button);
  assert.equal(box.hidden, true);
  assert.equal(button.textContent, "Show");
  assert.match(api.recordLink("a b"), /#record=a%20b$/);
}
// Human review: "human-checked" (with its check) only on accepted records; the record's Human review line on every
// marked record; the counts band links to the human-checked records.
{
  api.setHumanReviewMarks({
    "hc-accepted": { checked: true },
    "hc-pending": { checked: true },
    "hc-note": { checked: false, note: "A human reviewer checked the same Km in CatLog's 2026 review of the earlier catalog." },
    "hc-note-2": { checked: false, note: "A human reviewer approved the same kcat and Km for this paper in the 2026 review of the earlier catalog; kcat/Km was not reviewed." },
    "hc-fixed": { checked: true, note: "Checked by a human reviewer. Corrected after human review: Km unit." },
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
  assert.match(html, /<div class="kv-line human-review-line"><dt>Human review<\/dt><dd><svg class="check-icon"[^>]*>.*<\/svg>A human reviewer approved every value on this record\.<\/dd><\/div>/);
  assert.match(api.statusBadge(accepted), /title="[^"]*Human-checked: a human reviewer approved every value shown\."/);
  assert.match(api.statusBadge(accepted), /aria-label="Accepted, BRENDA, human-checked"/);
  api.renderDetail(pending, {});
  html = element("detailContent").innerHTML;
  assert.doesNotMatch(html, /detail-status-checked/);
  assert.match(html, /<dt>Human review<\/dt><dd>A human reviewer approved these values; the record&#39;s status comes from the automated review\.<\/dd>/);
  api.renderDetail(noted, {});
  // A note's review year is not shown (facts only).
  assert.match(element("detailContent").innerHTML, /<dt>Human review<\/dt><dd>A human reviewer checked the same Km in CatLog&#39;s review of the earlier catalog\./);
  api.renderDetail(row({ record_key: "hc-note-2", measurement_key: "hc-note-2" }), {});
  assert.match(element("detailContent").innerHTML, /<dd>A human reviewer approved the same kcat and Km for this paper in the review of the earlier catalog; kcat\/Km was not reviewed\.<\/dd>/);
  // A correction made after human review is said as given, in the Human review line.
  api.renderDetail(row({ record_key: "hc-fixed", measurement_key: "hc-fixed", verification_status: "verified" }), {});
  assert.match(element("detailContent").innerHTML, /<dt>Human review<\/dt><dd><svg class="check-icon"[^>]*>.*<\/svg>Checked by a human reviewer\. Corrected after human review: Km unit\.<\/dd>/);
  // A check after each value a human reviewer approved (Values table), with its meaning once under the table: every value
  // of a checked record, the values the review's sentence names on another, the mark's own list when it has one.
  const approvedValues = (html) => [...html.matchAll(/<tr><th scope="row">(.*?)<\/th><td class="vt-value"><span class="vt-number">[^<]*(<span class="value-approved"[^>]*>)?/g)]
    .filter((match) => match[2]).map((match) => match[1].replace(/<[^>]+>/g, ""));
  const APPROVED_NAME = /<span class="value-approved" role="img" aria-label="approved by a human reviewer" title="Approved by a human reviewer"><svg class="check-icon"/;
  api.renderDetail(accepted, {});
  html = element("detailContent").innerHTML;
  assert.deepEqual(approvedValues(html), ["kcat", "Km", "kcat/Km"]);
  assert.match(html, APPROVED_NAME);
  assert.match(html, /<li><span class="value-approved-key"><svg class="check-icon"[^>]*>.*?<\/svg><\/span>Approved by a human reviewer \(see Human review below\)\.<\/li>/);
  api.renderDetail(row({ record_key: "hc-note-2", measurement_key: "hc-note-2" }), {});
  html = element("detailContent").innerHTML;
  assert.deepEqual(approvedValues(html), ["kcat", "Km"]);
  // A row without a check keeps an unseen copy of its space, so the numbers end at the same place.
  assert.match(html, /<span class="vt-number">1<span class="value-approved vt-ghost" aria-hidden="true"><svg/);
  // A note that is not the review's sentence marks nothing (no guessing from free text).
  api.renderDetail(noted, {});
  assert.deepEqual(approvedValues(element("detailContent").innerHTML), []);
  assert.doesNotMatch(element("detailContent").innerHTML, /value-approved/);
  api.setHumanReviewMarks({
    "hc-list": { checked: false, approved: ["Km", "kcat/Km"] },
    "hc-list-noted": { checked: false, approved: ["kcat"], note: "A reviewer questioned this Km." },
    "hc-calc": { checked: true },
    "hc-strict": { checked: false, note: "A human reviewer approved the same Vmax and Km for this paper." },
  });
  api.renderDetail(row({ record_key: "hc-list", measurement_key: "hc-list" }), {});
  html = element("detailContent").innerHTML;
  assert.deepEqual(approvedValues(html), ["Km", "kcat/Km"]);
  assert.match(html, /<dt>Human review<\/dt><dd>A human reviewer approved the Km and kcat\/Km on this record\.<\/dd>/);
  // The record download names the values that carry the check.
  assert.deepEqual((await recordDownloadPayload(row({ record_key: "hc-list", measurement_key: "hc-list" }), {})).human_approved_values, ["Km", "kcat/Km"]);
  api.renderDetail(row({ record_key: "hc-list-noted", measurement_key: "hc-list-noted" }), {});
  assert.deepEqual(approvedValues(element("detailContent").innerHTML), ["kcat"]);
  // A kcat/Km worked out from kcat and Km (calc.) is not printed: no reviewer approved it as such.
  api.renderDetail(row({ record_key: "hc-calc", measurement_key: "hc-calc", kcat_over_km_origin: "calculated" }), {});
  assert.deepEqual(approvedValues(element("detailContent").innerHTML), ["kcat", "Km"]);
  api.renderDetail(row({ record_key: "hc-strict", measurement_key: "hc-strict" }), {});
  assert.doesNotMatch(element("detailContent").innerHTML, /value-approved/, "a sentence naming another quantity marks nothing");
  api.setHumanReviewMarks({});
  api.renderDetail(accepted, {});
  assert.doesNotMatch(element("detailContent").innerHTML, /value-approved|Approved by a human reviewer/);
  assert.ok(!("human_approved_values" in await recordDownloadPayload(accepted, {})), "no check, no list");
  api.setHumanReviewMarks({
    "hc-accepted": { checked: true },
    "hc-pending": { checked: true },
    "hc-note": { checked: false, note: "A human reviewer checked the same Km in CatLog's 2026 review of the earlier catalog." },
  });

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

// Download record: one flat object, the license written once as the record shows it.
const detailPreferredPayload = await recordDownloadPayload(
  row({ record_key: "record-detail-preferred", source_license: "CC BY 4.0", summary_marker: true }),
  { source_license: mixedSourceLicenses, detail_marker: true },
);
assert.equal(detailPreferredPayload.license_note, licenseNote);
assert.equal(detailPreferredPayload.source_license, mixedSourceLicenses);
assert.equal(detailPreferredPayload.record_key, "record-detail-preferred");
assert.ok(!("summary" in detailPreferredPayload) && !("detail" in detailPreferredPayload) && !("metadata" in detailPreferredPayload));
assert.ok(!("summary_marker" in detailPreferredPayload) && !("detail_marker" in detailPreferredPayload), "only the public fields");
assert.equal((await recordDownloadPayload(row({ record_key: "record-summary-fallback", source_license: "CC BY 4.0" }), { source_license: "" })).source_license,
  "CC BY 4.0");
assert.equal((await recordDownloadPayload(row({ record_key: "record-missing-license", source_license: undefined }), {})).source_license,
  "See the source's terms");
// A record with no recorded source has no source's terms to point to.
assert.equal((await recordDownloadPayload(row({ record_key: "record-no-source", source_db: "unknown", source_license: "see source" }), {})).source_license,
  "Not recorded");
// Download record carries the kcat/Km the record's sources list, as the record shows them.
{
  const listedPayload = await recordDownloadPayload(row({ record_key: "record-listed", source_db: "brenda", kcat: null, km: 0.05,
    kcat_over_km: null, kcat_display: null, km_display: "0.05", kcat_over_km_display: null }),
  { source_kcat_over_km_values: [{ value: 4.9, unit: "s^(-1)*mM^(-1)", source_db: "brenda" }, { value: 4.9, unit: null, source_db: "brenda" }] });
  assert.deepEqual(listedPayload.source_kcat_over_km_values, [{ value: 4.9, unit: "s^-1 mM^-1", source_db: "brenda" }]);
}
// A record read by CatLog: the method, the check and the values as printed in the record's words; CatLog's licence; none
// of the pipeline's words.
{
  const v2Payload = await recordDownloadPayload(
    row({ record_key: "record-v2", measurement_key: "record-v2", source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name",
      kcat: 135, kcat_display: "135", kcat_unit: "s^(-1)", km: 24.7, km_display: "24.7", km_unit: "mM", kcat_over_km: 5.5,
      kcat_over_km_display: "5.5", kcat_over_km_unit: "s^(-1)*mM^(-1)", kcat_over_km_origin: "paper_reported", source_license: "as published (see paper)" }),
    { verification_method: "catlog_v2_read_and_independent_verify", source_license: "as published (see paper)", supporting_pmids: ["31072150"],
      supporting_dois: ["10.1080/14756366.2019.1608198"], identity_resolution_state: "accession_resolved",
      proof_lines: [
        { metric: "kcat", table_label: "Table 1", printed: "135.0 ± 15.1 sec−1", check: "confirmed", conversion: "", value_display: "135.0",
          raw_value_unit_evidence: "kcat printed as 135.0 ± 15.1 sec−1. A second, separate AI run confirmed it.", normalized_value: 135 },
        { metric: "Km", table_label: "Table 1", printed: "24.7 mM", check: "confirmed", conversion: "", printed_line: `4-Aminoacetophenone | 24.7 | ${"x".repeat(300)}` },
      ] },
  );
  assert.ok(!("source_kcat_over_km_values" in v2Payload), "no listed kcat/Km, no field");
  assert.equal(v2Payload.kcat, 135);
  assert.equal(v2Payload.kcat_unit, "s^-1");
  assert.equal(v2Payload.source, "Read from the paper by CatLog");
  assert.equal(v2Payload.source_license, "CC BY 4.0 (CatLog compilation)");
  assert.match(v2Payload.method, /^Read from the paper by an AI model; a second, separate AI check compared each value with the paper; values stored as printed\.$/);
  assert.equal(v2Payload.check, "All values confirmed.");
  assert.deepEqual(v2Payload.values_as_printed[0], { metric: "kcat", as_printed: "135.0 ± 15.1 sec−1", location: "Table 1", printed_line: null, conversion: null, check: "Confirmed" });
  assert.equal(v2Payload.values_as_printed[1].printed_line, `4-Aminoacetophenone | 24.7 | ${"x".repeat(300)}`, "the whole line, longer than the record quotes");
  assert.deepEqual(v2Payload.pubmed_ids, ["31072150"]);
  const text = JSON.stringify(v2Payload);
  assert.doesNotMatch(text, /independent|AI run|catlog_v2|accession_resolved|normali[sz]ed|proof_lines|verification_method/);
  assert.ok(!("database_comparison" in v2Payload) && !("database_note" in v2Payload) && !("earlier_corrections" in v2Payload),
    "no comparison in the snapshot, none in the download");
  assert.ok("ai_audit" in v2Payload && v2Payload.ai_audit === null, "a record read from the paper always names its AI audit");
}
// Against the databases goes into the download as the record says it: each value's result for a record read from the
// paper; the earlier review's changes for a corrected record (a local path never).
{
  const v2Summary = row({ record_key: "record-v2-db", measurement_key: "record-v2-db", source_db: "primary_paper_direct",
    enzyme_label_source: "explicit_enzyme_name", kcat: 30.4, kcat_display: "30.4", kcat_unit: "s^(-1)", km: 549.9, km_display: "549.9", km_unit: "mM" });
  const payload = await recordDownloadPayload(v2Summary, { verification_method: "catlog_v2_read_and_independent_verify", supporting_pmids: ["31072150"],
    database_note: "All 12 BRENDA Km values for this paper are 1000× lower than printed.",
    proof_lines: [
      { metric: "kcat", table_label: "Table 1", printed: "30.4 s^-1", check: "confirmed", conversion: "", database_status: "confirmed", database_line: "Same as BRENDA, SABIO-RK." },
      { metric: "Km", table_label: "Table 1", printed: "549.9 mM", check: "confirmed", conversion: "", database_status: "corrected",
        database_line: "BRENDA lists 0.5499 mM, 1,000× lower.", database_cause: "mM_entered_as_uM", database_evidence: "/Users/someone/p.pdf" },
    ] });
  assert.deepEqual(payload.database_comparison, [
    { metric: "kcat", result: "Same number", line: "Same as BRENDA, SABIO-RK.", databases: null, cause: null, evidence: null },
    { metric: "Km", result: "Corrects a database value", line: "BRENDA lists 0.5499 mM, 1,000× lower.", databases: null, cause: "an mM value entered as µM", evidence: null },
  ]);
  assert.equal(payload.database_note, "All 12 BRENDA Km values for this paper are 1000× lower than printed.");
  // A line that is the result is the result; a calculated kcat/Km reads as the record's row does.
  const calculated = await recordDownloadPayload({ ...v2Summary, record_key: "record-v2-db-calc", kcat_over_km: 0.0553, kcat_over_km_display: "0.0553",
    kcat_over_km_unit: "s^(-1)*mM^(-1)", kcat_over_km_origin: "calculated" }, { verification_method: "catlog_v2_read_and_independent_verify",
    supporting_pmids: ["31072150"], proof_lines: [
      { metric: "kcat", table_label: "Table 1", printed: "30.4 s^-1", check: "confirmed", conversion: "", database_status: "same", database_line: "same number in BRENDA" },
      { metric: "Km", table_label: "Table 1", printed: "549.9 mM", check: "confirmed", conversion: "" },
    ] });
  assert.deepEqual(calculated.database_comparison.map((item) => [item.metric, item.result, item.line]),
    [["kcat", "Same number in BRENDA", null], ["kcat/Km", "Calculated; not compared", null]]);
  const corrected = await recordDownloadPayload(row({ record_key: "record-corrected-trail", verification_status: "corrected", source_db: "oed", km: 0.066, km_display: "0.066", km_unit: "mM" }), {
    supporting_pmids: ["2226453"], corrections: [
      { field: "km", old_value: 66, new_value: 0.066, unit: "mM", kind: "magnitude", listed: "OED", evidence_table_row: "Table 2, row 12-hydroxydodecanoic acid: Km 66 µM" },
      { field: "kcat_over_km", old_value: null, new_value: 40, unit: "s^(-1)*mM^(-1)", kind: "added", evidence_table_row: "C:\\papers\\x.pdf" },
      { field: "uniprot_id", old_value: "P00325", new_value: "P00326" },
    ] });
  assert.deepEqual(corrected.earlier_corrections, [
    { field: "km", before: 66, after: 0.066, unit: "mM", change: "unit or magnitude (÷ 1000)", listed: "OED", evidence: "Table 2, row 12-hydroxydodecanoic acid: Km 66 µM" },
    { field: "kcat_over_km", before: null, after: 40, unit: "s^-1 mM^-1", change: "added: the source had none", listed: null, evidence: null },
    { field: "uniprot_id", before: "P00325", after: "P00326", unit: null, change: null, listed: null, evidence: null },
  ]);
  assert.ok(!("ai_audit" in corrected) && !("database_comparison" in corrected));
}
const detailFalseKiHtml = measurementSection(row({
  has_ki: true,
  ki_display: "0.5",
  ki_unit: "mM",
}), { has_ki: false });
assert.doesNotMatch(detailFalseKiHtml, /<i>K<\/i><sub>i<\/sub>/);
// A record whose only value is a Ki (bc610fa98f4a279b): Download record and the report email carry it, as Values shows it;
// a record without a Ki gets no Ki fields.
{
  const kiOnly = row({ record_key: "ki-only", source_db: "brenda", organism: "Ovis aries", substrate_name: "NADPH", kcat: null,
    km: null, kcat_over_km: null, kcat_display: null, km_display: null, kcat_over_km_display: null, has_ki: true, ki: 0.0021,
    ki_display: "0.0021", ki_unit: "mM" });
  const kiPayload = await recordDownloadPayload(kiOnly, { supporting_pmids: ["15709755"] });
  assert.equal(kiPayload.ki, 0.0021);
  assert.equal(kiPayload.ki_unit, "mM");
  assert.equal(kiPayload.kcat, null);
  api.renderDetail(kiOnly, { supporting_pmids: ["15709755"] });
  const kiBody = decodeURIComponent(element("detailContent").innerHTML
    .match(/id="reportRecordProblem" class="button secondary" href="([^"]+)"/)[1].replace(/&amp;/g, "&"));
  assert.match(kiBody, /Ovis aries; NADPH; Ki 0\.0021 mM; PMID 15709755\./);
  const noKiPayload = await recordDownloadPayload(row({ record_key: "no-ki", has_ki: false, ki_display: "0.5", ki_unit: "mM" }), {});
  assert.ok(!("ki" in noKiPayload) && !("ki_unit" in noKiPayload), "no Ki shown, no Ki fields");
}

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
  assert.deepEqual([...api.activeFilterItems()].map((item) => item.label), ["Source: SABIO-RK", "Source: not recorded"]);
  assert.deepEqual(await keysFor("source=earlier"), ["src-earlier"]);
  // Removing the last database chip removes the source filter.
  api.activeFilterItems().find((item) => item.key === "source:earlier_paper").clear();
  assert.equal(api.browseHash(), "");
  assert.deepEqual(await keysFor(""), ["src-earlier", "src-merged", "src-oed", "src-unknown", "src-v2"]);
  // Older links: the paper with a database (either one) opens all records; the three results of their day, all four.
  assert.deepEqual(await keysFor("source=paper,brenda"), ["src-earlier", "src-merged", "src-oed", "src-unknown", "src-v2"]);
  assert.equal(api.browseHash(), "");
  api.applyBrowseParams(new Map(new URLSearchParams("status=accepted,curation_pending,not_verified")));
  assert.equal(api.browseHash(), "", "every review result ticked");

  // An address's page: page=1, a page that is no page number or no page= at all is the first page. An address that
  // says what the table does not show (rows=37) is rewritten to what it shows.
  {
    const replaced = [];
    const originalReplace = window.history.replaceState;
    window.history.replaceState = (_state, _title, url) => replaced.push(new URL(url).hash);
    try {
      api.state.page = 11;
      api.applyBrowseParams(new Map(new URLSearchParams("q=src&page=-2")));
      assert.equal(api.state.page, 1, "page=-2 opens the first page");
      assert.equal(api.browseHash(), "#browse?q=src");
      api.state.page = 11;
      api.applyBrowseParams(new Map(new URLSearchParams("q=src")));
      assert.equal(api.state.page, 1, "an address without page= opens the first page");
      api.applyBrowseParams(new Map(new URLSearchParams("q=src&page=7")));
      assert.equal(api.browseHash(), "#browse?q=src&page=7");
      api.state.pendingPage = 0;
      api.state.page = 1;
      window.location.hash = "#browse?q=src&rows=37&page=-2";
      assert.equal(api.applyLocationFilters(), false, "the same table: nothing to filter again");
      assert.deepEqual(replaced, ["#browse?q=src"], "the address is rewritten to the table's");
      // An address naming a record keeps its page for the record.
      api.state.page = 3;
      window.location.hash = "#browse?q=src&record=src-v2";
      api.applyBrowseParams(new Map(new URLSearchParams("q=src&record=src-v2")));
      assert.equal(api.state.page, 3);
    } finally {
      window.history.replaceState = originalReplace;
      window.location.hash = "";
      api.state.page = 1;
      api.applyBrowseParams(new Map());
      await api.ensureCurrentFilters();
    }
  }

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
  // "Only human-checked" counts what a click shows: it ticks Accepted too.
  api.setHumanReviewMarks({ "src-v2": { checked: true } });
  counts = await countsFor("status=curation_pending");
  assert.equal(counts.checked, 1, "the human-checked record that Not confirmed alone leaves out");
  api.setHumanReviewMarks({});
  await countsFor("");
  // Against the databases: each record's comparison (the index's number, or the Table download's fields) matches the
  // options it shows; a record that was not compared matches none.
  const compared = (key, extra) => sourceRow(key, { source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name", ...extra });
  const dbRows = [
    compared("db-same", { database_summary: 1 }),
    compared("db-fixed", { kcat_database_status: "corrected", km_database_status: "confirmed", kcat_over_km_database_status: "not_compared" }),
    compared("db-open", { database_status: { kcat: { status: "differs" }, Km: "new" } }),
    compared("db-new", { database_statuses: ["new", "new_paper_not_in_databases"] }),
    compared("db-label", { database_summary: 16 }),
    sourceRow("db-earlier", { source_db: "brenda", verification_status: "corrected", corrections: [{ field: "km" }] }),
    sourceRow("db-plain", { source_db: "brenda" }),
  ];
  assert.deepEqual(dbRows.map((item) => api.rowDatabaseBits(item)), [4, 1, 2 | 8, 8 | 16, 0, 32, 0]);
  assert.deepEqual(dbRows.map((item) => api.databaseSummaryBits(item)), [1, 3, 12, 8, 16, 32, 0]);
  api.indexLoadedRecords(dbRows);
  counts = await countsFor("db=corrected,new");
  assert.equal(databaseInputs.filter((input) => input.checked).length, 0, "db= is read only when the index carries the comparison");
  runtimeManifest.viewer_index.optional_fields = ["database_summary"];
  counts = await countsFor("db=corrected,new");
  assert.deepEqual({ ...counts.database }, { corrects: 1, differs: 1, same: 1, adds: 2, new: 1, earlier: 1 });
  assert.deepEqual(databaseInputs.filter((input) => input.checked).map((input) => input.value), ["corrects", "new"], "db= takes the aliases");
  assert.equal(api.browseHash(), "#browse?db=corrects,new");
  assert.deepEqual(api.state.filtered.map((item) => item.record_key).sort(), ["db-fixed", "db-new"]);
  assert.deepEqual(JSON.parse(JSON.stringify(api.activeFilterItems().map((item) => [item.key, item.label]))),
    [["db:corrects", "Corrects a database value"], ["db:new", "In no database"]]);
  // The index carries the number as an optional column; an index without it gives every row null (the group stays hidden).
  {
    const enumFields = ["enzyme_label_source", "source_db", "verification_status", "evidence_confidence_tier", "sequence_variant_status",
      "kcat_over_km_origin", "public_trust_basis", "temperature_display", "condition_flags", "kcat_unit", "km_unit", "kcat_over_km_unit", "wild_type"];
    const textFields = ["enzyme_display_name", "ec_number", "organism", "substrate_name", "mutation_signature", "primary_uniprot_id",
      "kcat_display", "km_display", "kcat_over_km_display"];
    const baseFields = ["record_key", "review_key", ...textFields, "protein_accession", "kcat", "km", "kcat_over_km", "ph_display",
      "temperature_k", "source_record_count", ...enumFields];
    const enums = Object.fromEntries(enumFields.map((field) => [field, [null]]));
    const values = (key) => baseFields.map((field) => (field === "record_key" ? key : enumFields.includes(field) ? 0 : field === "review_key" ? true : null));
    const Row = api.viewerRowConstructor(api.checkedViewerIndexHeader({ schema_version: 2, details_per_shard: 250, enums, texts: {},
      fields: [...baseFields, "condition_note", "database_summary", "s"] }, 250), ["details-000.js"]);
    const fixed = new Row([...values("x"), null, 3, 0]);
    assert.equal(fixed.database_summary, 3);
    assert.equal(api.rowDatabaseBits(fixed), 1);
    assert.equal(new Row([...values("y"), null, null, 0]).database_summary, null);
    const Plain = api.viewerRowConstructor(api.checkedViewerIndexHeader({ schema_version: 2, details_per_shard: 250, enums, texts: {},
      fields: [...baseFields, "s"] }, 250), ["details-000.js"]);
    assert.equal(api.rowDatabaseBits(new Plain([...values("z"), 0])), 0);
  }
  databaseInputs.forEach((input) => { input.checked = false; });
  delete runtimeManifest.viewer_index.optional_fields;
  await countsFor("");
}

// Export results as CSV: the table's columns with units, review result, source and paper IDs, stored digits, one line per
// record (RFC 4180 quoting; a cell a spreadsheet would read as a formula starts with an apostrophe).
{
  const csvRows = [
    row({ record_key: "csv-1", enzyme_display_name: "alcohol dehydrogenase, class I", substrate_name: "=SUM(A1)", organism: 'Homo "sapiens"',
      condition_note: "+10 mM FBP",
      kcat_display: "30.333", kcat_unit: "s^(-1)", km_display: "0.05", km_unit: "mM", kcat_over_km_display: "606.66",
      kcat_over_km_unit: "s^(-1)*mM^(-1)", kcat_over_km_origin: "calculated", mutation_signature: "D102E", wild_type: false,
      verification_status: "unverified", _pmids: [123, 456], primary_uniprot_id: "P00330" }),
    row({ record_key: "csv-2", source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name", wild_type: true,
      kcat_display: "Not reported", kcat: null }),
  ];
  const text = (await api.csvParts(csvRows)).join("");
  const lines = text.replace(/^\ufeff/, "").split("\r\n").filter(Boolean);
  assert.equal(lines.length, 3);
  assert.equal(lines[0], "record_key,enzyme_display_name,ec_number,organism,substrate_name,condition_note,variant,kcat,kcat_unit,km,km_unit,"
    + "kcat_over_km,kcat_over_km_unit,kcat_over_km_origin,temperature_c,ph,review_result,human_checked,source,source_db,pubmed_id,doi,primary_uniprot_id");
  assert.ok(lines[1].startsWith('csv-1,"alcohol dehydrogenase, class I",1.1.1.1,"Homo ""sapiens""",\'=SUM(A1),\'+10 mM FBP,D102E,30.333,s^-1,0.05,mM,606.66,s^-1 mM^-1,calculated,25,7,Not checked (Unverified),'), lines[1]);
  assert.ok(lines[1].endsWith(",BRENDA,brenda,123; 456,,P00330"), lines[1]);
  assert.match(lines[2], /^csv-2,Enzyme,1\.1\.1\.1,Organism,Substrate,,wild type,,,1,mM,/, "a missing value is an empty cell");
  assert.match(lines[2], /,Accepted,[^,]*,from paper,primary_paper_direct,/);
  // A cell starting with + or - is a formula to a spreadsheet unless it is a plain number (variant "+G212").
  const signed = (await api.csvParts([row({ record_key: "csv-3", mutation_signature: "+G212", wild_type: false, organism: "-Organism",
    kcat_display: "-5", kcat_unit: "s^(-1)", km_display: "+0.5", km_unit: "mM" })])).join("").replace(/^\ufeff/, "").split("\r\n")[1];
  assert.match(signed, /^csv-3,Enzyme,1\.1\.1\.1,'-Organism,Substrate,,'\+G212,-5,s\^-1,\+0\.5,mM,/, signed);
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
    // The examples take one line where the screen has room: the box is as wide as that line, not its field.
    const originalBoxRect = suggestions.getBoundingClientRect;
    suggestions.getBoundingClientRect = () => ({ left: 0, top: 0, bottom: 0, width: 530.4 });
    window.innerWidth = 1280;
    searchInput.getBoundingClientRect = () => ({ left: 780, top: 16, bottom: 48, width: 320 });
    api.showSuggestions(searchInput);
    assert.equal(suggestions.style.width, "531px");
    assert.equal(suggestions.style.left, "741px", "kept inside the screen");
    window.innerWidth = 375;
    api.showSuggestions(searchInput);
    assert.equal(suggestions.style.width, "359px", "a phone wraps them");
    suggestions.getBoundingClientRect = originalBoxRect;
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

    // The examples are never Tab stops; Tab from the input to the next control closes them at once.
    openSuggestions();
    assert.match(suggestions.innerHTML, /<button id="catlog-suggestion-0" type="button" role="option" tabindex="-1"/);
    searchInput.dispatch("blur", { relatedTarget: outside });
    assert.equal(suggestions.classList.contains("hidden"), true, "Tab out of the search box closes the examples at once");
    assert.equal(searchInput.getAttribute("aria-expanded"), "false");

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

// Loading, success and error draw one header helper, which holds the focusable heading.
assert.equal(
  (sourceCode.match(/\$\{detailTopHtml\((?:row|summary), /g) || []).length,
  3,
  "loading, success, and error details should expose a programmatically focusable heading",
);
assert.equal((sourceCode.match(/\$\{detailHeadingHtml\((?:row|summary)\)\}/g) || []).length, 1, "the header helper draws the heading");
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
        // While it loads, the whole header is drawn from the table's row (it keeps its place when the record arrives),
        // then a quiet outline of the values; the heading shows no focus ring after a click.
        assert.match(content.innerHTML, /<p class="detail-substrate">[\s\S]*<p class="detail-status"[\s\S]*<p class="detail-key">[\s\S]*id="detailLoadStatus"[\s\S]*<div class="detail-skeleton" aria-hidden="true">/);
        assert.match(content.innerHTML, /<h2 id="detailHeading" tabindex="-1" class="quiet-focus">/);
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
  // Low to high, rows without the value last.
  const numericAsc = (field) => (a, b) => {
    const left = a[field] == null ? Number.POSITIVE_INFINITY : Number(a[field]);
    const right = b[field] == null ? Number.POSITIVE_INFINITY : Number(b[field]);
    return left - right;
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
    kcat_asc: numericAsc("kcat"),
    km: numericDesc("km"),
    km_asc: numericAsc("km"),
    kcat_over_km: numericDesc("kcat_over_km"),
    kcat_over_km_asc: numericAsc("kcat_over_km"),
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

// The table shows no temperature or pH, so it does not sort by them: an older address's sort=temperature or sort=ph_asc
// opens the default order.
for (const older of ["temperature", "temperature_asc", "ph", "ph_asc"]) {
  assert.deepEqual(Array.from(await api.orderedRecordsFor(older), (item) => item.record_key),
    Array.from(await api.orderedRecordsFor("evidence"), (item) => item.record_key), `${older} opens the default order`);
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
{
  // Previous on the second page opens the first and disables itself: its focus moves to Next, not the page body. Next
  // on the last page hands focus to Previous. A click that did not focus the button (Safari) moves no focus.
  const originalActiveElement = document.activeElement;
  const lastPage = Math.ceil(api.state.filtered.length / api.state.pageSize);
  assert.ok(lastPage > 2);
  api.state.page = 2;
  element("prevButton").focus();
  element("prevButton").click();
  assert.equal(api.state.page, 1);
  assert.equal(element("prevButton").disabled, true);
  assert.equal(document.activeElement, element("nextButton"), "Previous gives its focus to Next on the first page");
  api.state.page = lastPage - 1;
  element("nextButton").click();
  assert.equal(api.state.page, lastPage);
  assert.equal(element("nextButton").disabled, true);
  assert.equal(document.activeElement, element("prevButton"), "Next gives its focus to Previous on the last page");
  document.activeElement = originalActiveElement;
  element("prevButton").click();
  assert.equal(api.state.page, lastPage - 1);
  assert.equal(document.activeElement, originalActiveElement, "Previous that stays enabled keeps focus where it was");
  api.state.page = 2;
  element("prevButton").click();
  assert.equal(document.activeElement, originalActiveElement, "an unfocused click moves no focus");
}

const detailShard = "details-test.js";
{
  element("globalSearchInput").value = "no_such_catlog_record_937461";
  await api.applyFilters();
  assert.equal(api.state.filtered.length, 0);
  assert.equal(element("pageSummary").textContent, "No matching records");
  assert.equal(element("clearResultsButton").hidden, false);
  assert.equal(element("activeFilters").classList.contains("results-empty"), true, "with no results the chips' Clear all gives way to Clear search and filters");
  assert.equal(element("downloadPageButton").disabled, true);
  assert.equal(element("nextButton").disabled, true);
  assert.equal(element("prevButton").disabled, true);
  element("clearResultsButton").click();
  await api.ensureCurrentFilters();
  assert.equal(element("globalSearchInput").value, "");
  assert.equal(document.activeElement, element("globalSearchInput"));
  assert.equal(api.state.filtered.length, largeRows.length);
  assert.equal(element("clearResultsButton").hidden, true);
  assert.equal(element("activeFilters").classList.contains("results-empty"), false);
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

// The Guide's sources list: the paper-read records as two rows, with the counts and licences Browse and the records give.
{
  const saved = { total: runtimeManifest.total_rows, summary: runtimeManifest.summary, enriched: runtimeManifest.enriched_download, source: runtimeManifest.source_sha256 };
  runtimeManifest.total_rows = 100;
  runtimeManifest.source_sha256 = "source";
  runtimeManifest.enriched_download = { sha256: "full" };
  runtimeManifest.summary = { overview: { download_sha256: "full", source_sha256: "source", records: 100, from_paper: { records: 74, papers: 3 } } };
  const paperSource = { key: "primary_paper_direct", name: "Read from the paper by CatLog", license: "as published (see paper)", row_count: 80 };
  const rows = api.sourceAttributionRows([paperSource, { key: "brenda", name: "BRENDA", license: "CC BY 4.0", row_count: 20 }]);
  assert.deepEqual(rows.map((item) => [item.name, item.row_count, item.licenseText || item.license]), [
    ["Read from the paper by CatLog", 74, "CatLog compilation CC BY 4.0; quoted paper text remains the publisher’s"],
    ["Earlier paper extractions", 6, "License: as published (see paper)"],
    ["BRENDA", 20, "CC BY 4.0"],
  ]);
  runtimeManifest.summary = {};
  assert.deepEqual(api.sourceAttributionRows([paperSource]).map((item) => item.name), ["Read from the paper (by CatLog, or earlier extractions)"],
    "without the snapshot's count, one row names both groups");
  Object.assign(runtimeManifest, { total_rows: saved.total, summary: saved.summary, enriched_download: saved.enriched, source_sha256: saved.source });
}

// The sidebar keeps one short line per option; the explanations are behind each group's "?" (aboutSource, aboutStatus).
{
  const source = element("sourceChecklist").innerHTML;
  assert.match(source, /<span>Read from the paper<span class="visually-hidden"> by CatLog<\/span><\/span>/);
  assert.match(source, /<span>Enzyme databases<\/span>/);
  assert.doesNotMatch(source, /source-help|aria-describedby|<p class="filter-note/);
  // The longest names are short in the sidebar (one line at 256px): OED as the table's tag, its name read out and on hover;
  // the caution without "Possible", which its chip and the Guide keep.
  assert.match(source, /<label class="check-row" title="Open Enzyme Database \(OED\)">\s*<input type="checkbox" name="source" value="oed" \/>\s*<span>OED<span class="visually-hidden"> \(Open Enzyme Database\)<\/span><\/span>/);
  assert.match(element("cautionChecklist").innerHTML, /value="units" \/>\s*<span>Unit or magnitude error<\/span>/);
  assert.match(element("aboutSource").innerHTML, /the Open Enzyme Database \(OED\)/);
  assert.match(element("aboutSource").innerHTML, /<strong>Read from the paper by CatLog<\/strong>: Read by an AI model; a second, separate AI check compared each value with the paper\./);
  assert.match(element("aboutSource").innerHTML, /<strong>From enzyme databases<\/strong>: BRENDA, SABIO-RK/);
  assert.match(element("aboutSource").innerHTML, /href="#guide-method"/);
  const status = element("statusChecklist").innerHTML;
  assert.doesNotMatch(status, /status-guide|Review result definitions/);
  assert.match(status, /<span class="visually-hidden">Only <\/span><span class="human-checked-word">/);
  // The Review result "?" is a short line per result and for human-checked, then the Guide (the tags are defined there),
  // so the box never pushes the options out of view.
  const aboutStatus = element("aboutStatus").innerHTML;
  assert.match(aboutStatus, /<strong>Accepted<\/strong>: Passed review: read from the paper by CatLog/);
  assert.match(aboutStatus, /<strong>Not confirmed<\/strong>: The earlier automated review left a question open\./);
  assert.match(aboutStatus, /<strong>Not checked<\/strong>: No review result\./);
  assert.match(aboutStatus, /<strong>Disputed<\/strong>: A check found a problem; not accepted\./);
  assert.match(aboutStatus, /<strong>human-checked<\/strong>: A human reviewer approved every value shown\./);
  assert.match(aboutStatus, /href="#guide-status">Review result and tags in the Guide/);
  assert.doesNotMatch(aboutStatus, /Tags<\/p>|earlier extraction|no paper linked|from paper<\/strong>/);
  assert.equal((aboutStatus.match(/<p>/g) || []).length, 6);
}
console.log("CatLog viewer behavior checks passed.");

// value_display is compared with the stored number (the display string is rounded to 5 figures), and a printed integer
// of up to 3 digits keeps its trailing zero (50 µM -> 0.050 mM), a longer one does not (47,000 -> not 47.000)
{
  const line = (metric, value_display, raw_value) => ({ metric, value_display, raw_value });
  const plainDisplays = (...args) => JSON.parse(JSON.stringify(api.printedFigureDisplays(...args)));
  assert.deepEqual(plainDisplays({ kcat: 3276.38, kcat_display: "3276.4" }, { proof_lines: [line("kcat", "3276.38", "3276.381 ± 184.275")] }), { kcat: "3276.38" });
  assert.deepEqual(plainDisplays({ km: 0.05, km_display: "0.05" }, { proof_lines: [line("Km", "0.050", "50 ± 6")] }), { km: "0.050" });
  assert.deepEqual(plainDisplays({ kcat_over_km: 47, kcat_over_km_display: "47" }, { proof_lines: [line("kcat/Km", "47.000", "47,000")] }), {});
}
