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
const styleSource = await readFile(new URL("../tools/catlog-static/assets/catlog-static.css", import.meta.url), "utf8");
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
  assert.ok(pageHtml.includes("<dd>No value (table cells only).</dd>"), "the Guide's marks legend says what a dash is");
  assert.doesNotMatch(pageHtml, /c-temp|c-ph|value="temperature"|value="ph"/, "the table shows no temperature or pH and does not sort by them");
  // The record leaves out a value it does not store; a missing linked item reads None (the Guide says what the record does).
  assert.ok(pageHtml.includes("that is not stored has no row, and the Values section says when none is stored;"));
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
  assert.ok(cautionsHtml.includes('<span class="nowrap">1&ndash;3&nbsp;&times;&nbsp;10<sup>7</sup>&nbsp;s<sup>&minus;1</sup></span>'));
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
// Source: three radios (All records, Read from the paper, Not yet re-read) and the databases.
const sourceModeInputs = ["all", "paper", "databases"].map((value) => ({
  value, type: "radio", name: "sourceMode", checked: value === "all",
}));
const sourceInputs = ["brenda", "sabio_rk", "oed", "uniprot", "skid", "strenda", "earlier_paper", "unrecorded"].map((value) => ({
  value, type: "checkbox", name: "source", checked: false,
}));
// Against the databases (shown when the snapshot has the comparison).
const databaseInputs = ["corrects", "differs", "other_label", "not_listed", "all_not_listed", "all_same", "earlier"].map((value) => ({
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
  for (const name of ["Supantha", "Aarna", "Erin", "Mohammad", "Source agents", "Reading agents", "Verification agents", "Audit agents"]) {
    assert.match(team, new RegExp(name), name);
  }
  for (const station of ["Cited papers", "AI reading", "AI check", "AI audit", "Human check", "Rules updated", "Website", "The paper"]) {
    assert.match(team, new RegExp(`>${station}</text>`), station);
  }
  assert.doesNotMatch(team, /Claude|Codex|Anthropic|OpenAI|GPT|Dr\.|Prof|PhD|independent/);
  // CatLog re-verifies what is published: no agent downloads or fetches papers (round 13).
  assert.doesNotMatch(team + element("teamView").innerHTML, /[Dd]ownload|[Ff]etch|>Papers</);
  assert.match(team, /<strong>Source agents<\/strong> \(AI\) find the paper each database value cites/);
  assert.match(team, /<strong>Verification agents<\/strong> \(AI\) check each value against the paper, separately/);
  assert.match(team, /<strong>Supantha<\/strong> builds CatLog and its website, and turns findings into better rules/);
  assert.match(team, /data-actor="aarna erin" data-stations="human"/);
  // Supantha's line meets Rules updated; pointing at him also lights Cited papers, AI audit and the website.
  assert.match(team, /data-actor="supantha" data-stations="rules papers catlog website"/);
  // Where each works, in the loop's order and mid-sentence case.
  assert.match(team, /<small [^>]*>At Cited papers, AI audit, Rules updated, Website<\/small>/);
  assert.match(team, /<small [^>]*>At the paper<\/small>/);
  assert.match(team, /aria-label="Supantha: builds CatLog and its website, and turns findings into better rules\. At Cited papers, AI audit, Rules updated, Website\."/);
  assert.doesNotMatch(team, /At The paper/);
  // Tab follows the drawing: the agents above, left to right, then the people below; Supantha's second chip, at the
  // Website station (he builds the website), is drawn last and is no second tab stop.
  assert.deepEqual(
    [...element("teamFigure").innerHTML.matchAll(/class="team-actor [^"]*" data-actor="(\w+)"/g)].map((match) => match[1]),
    ["source", "reading", "checking", "audit", "supantha", "aarna", "erin", "mohammad", "supantha"],
  );
  {
    const also = element("teamFigure").innerHTML.match(/<g class="team-actor team-actor-person team-actor-also" data-actor="supantha"[^>]*>[\s\S]*?<\/g>/);
    assert.ok(also && /aria-hidden="true"/.test(also[0]) && !/tabindex/.test(also[0]) && />Supantha<\/text>/.test(also[0]), "Supantha also stands at Website");
    assert.equal((element("teamFigure").innerHTML.match(/class="team-actor [^"]*" data-actor="\w+" data-stations="[^"]*" tabindex="0"/g) || []).length, 8, "one tab stop per person or agent");
  }
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
  if (numbers.catlog.length) assert.match(figureHtml, /aria-label="AI audit: [\d,]+ values re-checked"/);
  assert.doesNotMatch(figureHtml, /aria-label="CatLog: /, "no station named after the whole site");
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
// (round 13, the user: a short, visual Guide: how a value is read and checked first, then a record's parts, then the labels
// and colours, before the reference parts)
assert.deepEqual(guideAnchors, ["guide-method", "guide-record", "guide-status", "guide-databases", "guide-find", "guide-units",
  "guide-downloads", "guide-caveats", "guide-cite", "guide-sources", "guide-questions"]);
// Against the databases is a section of its own, written from the manifest when the snapshot carries the comparison: it
// starts hidden, and its line in the contents with it.
assert.match(guideContents, /<li data-guide-database-section hidden><a href="#guide-databases">Against the databases<\/a><\/li>/);
assert.match(guideHtml, /<section class="guide-section guide-databases" id="guide-databases" aria-labelledby="guide-databases-title" data-guide-database-section hidden>\s*<h2 id="guide-databases-title">Against the databases<\/h2>\s*<div id="guideDatabasesBody"><\/div>\s*<\/section>/);
assert.equal((guideHtml.match(/href="#guide-databases"/g) || []).length, 4, "the contents, Read a record, the legend and Questions link to it");
// The method is said in full once, in its own section (with the model's name); nowhere else in the Guide.
const guideMethod = guideHtml.match(/<section [^>]*id="guide-method"[^>]*>([\s\S]*?)<\/section>/)[1];
assert.match(guideMethod, /<a href="#team">People behind CatLog<\/a>/);
assert.match(guideMethod, /An AI model \(Claude, Anthropic\) reads each/);
// How CatLog reads a value (#guide-how-read, which a record's "How CatLog reads a value" link opens): the four steps in
// order, each one sentence, then what the record keeps (the boilerplate records no longer repeat).
const howRead = guideMethod.match(/<div class="guide-how-read" id="guide-how-read" aria-labelledby="guide-how-read-title">([\s\S]*?)<\/div>\s*<div class="guide-loop">/)[1];
assert.match(howRead, /<h3 id="guide-how-read-title">How CatLog reads a value<\/h3>/);
assert.deepEqual([...howRead.matchAll(/<strong class="guide-flow-name">([^<]*)<\/strong>/g)].map((match) => match[1]), ["Find the paper", "Read", "Check", "Compare"]);
assert.match(howRead, /a model never types a converted number/);
assert.match(howRead, /tagged <em>from paper<\/em>/);
// The Guide's record picture follows the record panel's order (round 13): its quote reads "In the paper:" as the record's
// does, a Checks part (the panel's Checks section) follows Against the databases, its key links How CatLog reads a value,
// no part names a section the record no longer has, and every numbered part has its key line.
{
  const anatomy = guideHtml.match(/<figure class="guide-anatomy"[\s\S]*?<\/figure>/)[0];
  assert.match(anatomy, /<span>In the paper:<\/span> &ldquo;/);
  assert.match(sourceCode, /const label = `In the paper\$\{/);
  assert.match(anatomy, /<div class="guide-anatomy-part" data-guide-databases hidden>[\s\S]*?<div class="guide-anatomy-part guide-anatomy-checks">\s*<span class="guide-pin" aria-hidden="true"><\/span>\s*<p class="guide-anatomy-heading">Checks<\/p>/);
  assert.match(sourceCode, /detailSection\("checks", "Checks"/);
  assert.match(anatomy, /<strong>Checks<\/strong>[^<]*<a href="#guide-how-read">How CatLog reads a value<\/a>/);
  assert.doesNotMatch(anatomy, /Review and audit|In the paper, Table/);
  const key = anatomy.match(/<div class="guide-anatomy-key">([\s\S]*?)<\/div>/)[1];
  assert.equal((anatomy.match(/<div class="guide-anatomy-part[ "]/g) || []).length, (key.match(/<li[ >]/g) || []).length);
}
// The framing (round 13): CatLog re-verifies published values; never a download agent or papers in bulk.
assert.match(guideHtml, /CatLog re-verifies published enzyme kinetics/);
assert.doesNotMatch(guideHtml, /download agent|in bulk|mass download/i);
assert.match(guideMethod, /A second, separate AI check compares every value with the paper\./);
// printed unit differs belongs to the Possible unit or magnitude error group (CAUTION_FLAG_BITS), in the Guide and the filter.
assert.match(guideHtml, /<em>Possible unit or magnitude error<\/em> \([^)]*above diffusion limit, printed unit differs\)/);
assert.doesNotMatch(guideHtml, /not in the table or the Cautions filter/);
assert.match(sourceCode, /value: "units", label: "Possible unit or magnitude error", bit: 2, title: "[^"]*a printed unit that differs[^"]*"/);
assert.equal((guideHtml.match(/Claude, Anthropic/g) || []).length, 1, "The full method appears once");
// Records are named by what happened to them (the user, 2026-10-13, round 8): Read from the paper and Not yet re-read,
// never "the earlier catalog", "the old catalog" or older records. CatLog is the one name: no v1 or v2; the earlier
// version is named only in the method section and in help (a tag's definition), and the method section says once that
// the current version is the second.
assert.doesNotMatch(guideHtml, /earlier catalog|old catalog|independent|AI run|guide-note">Older records/i);
assert.doesNotMatch(guideHtml, /\b(?:older|earlier) record/i, "The Guide says records not yet re-read, never older records");
assert.doesNotMatch(guideHtml.replace(/<[^>]*>/g, " "), /\bv[12]\b|version 2/i);
assert.match(guideHtml, /<summary>Evidence labels on records not yet <span class="nowrap">re-read<\/span><\/summary>/);
// "re-read" never breaks at its hyphen (a wide font split "re-" / "read"): every one in the Guide's text keeps one line.
assert.doesNotMatch(guideHtml, /(?<!<span class="nowrap">)re-read(?![^<>]*>)/, "Each re-read in the Guide is kept whole");
assert.equal(api.keepReRead('Not yet re-read <a title="not yet re-read">pre-reading re-read</a>'),
  'Not yet <span class="nowrap">re-read</span> <a title="not yet re-read">pre-reading <span class="nowrap">re-read</span></a>');
// The tag a record not yet re-read carries where one read from the paper says "from paper".
assert.match(guideHtml, /<dt><span class="state-tag">not <span class="nowrap">re-read<\/span><\/span><\/dt>\s*<dd>From CatLog&rsquo;s earlier version; its source follows /);
assert.match(guideHtml, /<dt><span class="state-tag">earlier extraction<\/span><\/dt>\s*<dd>Read from a paper by CatLog&rsquo;s earlier version \(AI models and code checks\)\.<\/dd>/);
assert.doesNotMatch(guideHtml, /not by CatLog/, "Earlier extractions come from CatLog's earlier version");
{
  const method = guideHtml.match(/<section [^>]*id="guide-method"[^>]*>([\s\S]*?)<\/section>/)[1];
  // Two kinds of record, side by side: read from the paper (by the current, second version) and not yet re-read.
  assert.match(method, /<strong>Read from the paper<\/strong>\s*<p>Read and checked against its paper by the current, second version of CatLog, as above\.<\/p>/);
  assert.match(method, /<strong>Not yet <span class="nowrap">re-read<\/span><\/strong>\s*<p>From CatLog&rsquo;s earlier version, which started from database entries \([^)]*\) and checked part of them[^<]*When CatLog reads the paper, its records replace these\.<\/p>/);
  assert.equal((guideHtml.match(/second version/g) || []).length, 1, "The Guide says once that the current version is the second");
}
// The table shows pH or temperature only under the substrate, to tell apart records of one paper (lookAlikeRowKeys); the
// Guide says so once, in Units, where it says the table has no column for them (not again under Cautions).
assert.match(guideHtml, /the table has no column for them and shows them only to tell apart records of one paper/);
assert.equal((guideHtml.match(/tell apart records of one paper/g) || []).length, 1, "said once, in Units");
assert.doesNotMatch(guideHtml, /table does not show (?:temperature|them)/);
// The counts band names the records read from the paper by CatLog as Stats and the Source filter do: Read from the paper
// (its short tag, From paper, where the band's first line is tight; a screen reader reads the whole label).
assert.match(indexHtml, /id="fromPaperLink"[^>]*title="Show the records read from the paper by CatLog"[^>]*><span><span class="snapshot-paper-long">Read from the paper<\/span><span class="snapshot-paper-short" aria-hidden="true">From paper<\/span><\/span><strong id="fromPaperCount">/);
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
  // The header names the form ("Variant H150A"): the section does not repeat it.
  assert.doesNotMatch(variantHtml, /<dt>Enzyme form<\/dt>/);
  assert.match(variantHtml, /<dt>Variant sequence<\/dt><dd><span class="reveal-line"><span class="reveal-summary">4 aa, UniProt P22498 with H150A<\/span>/);
  assert.match(variantHtml, /<dt>Wild-type sequence<\/dt><dd><span class="reveal-line"><span class="reveal-summary">4 aa<\/span>/);
  // Show opens the sequence under its row; Copy copies it.
  assert.match(variantHtml, /aria-expanded="false" aria-controls="detailVariantSequenceBox" data-reveal-target="detailVariantSequenceBox">Show<\/button><button class="text-button copy-button" type="button" aria-live="polite" data-copy-target="detailVariantSequence">Copy<\/button>/);
  assert.match(variantHtml, /<span id="detailVariantSequenceBox" class="copy-field" hidden><code id="detailVariantSequence">MAAG<\/code><\/span>/);
  assert.match(variantHtml, /<dt>UniProt<\/dt><dd><a [^>]*>P22498<\/a><\/dd>/);
  assert.doesNotMatch(variantHtml, /Sequence note|Sequence source|Variant: /);
  const wildHtml = api.proteinSection({ primary_uniprot_id: "P1", wild_type: true },
    { sequence_variant_status: "canonical_wild_type_sequence", wild_type_sequence: "MAAA", sequence_variant_note: "UniProt canonical sequence" });
  assert.doesNotMatch(wildHtml, /<dt>Enzyme form<\/dt>/, "the header says Wild type");
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
  // Figure and table titles (the human-review lead's apart), and the numbered parts' headings.
  const headings = () => [...element("statsCharts").innerHTML.matchAll(/<h3 id="(?!statsReviewTitle)[^"]+" class="stats-fig-title">(.*?)<\/h3>/g)]
    .map((match) => match[1].replace(/<[^>]*>/g, ""));
  const partTitles = () => [...(element("statsTotals").innerHTML + element("statsCharts").innerHTML)
    .matchAll(/<h2 id="statsPart\w+Title" class="stats-part-title"><span class="stats-part-number" aria-hidden="true">(\d+)<\/span><span>([^<]+)<\/span><\/h2>/g)]
    .map((match) => `${match[1]} ${match[2]}`);
  // The human-review lead, now the first block of Quality.
  const leadHtml = () => element("statsCharts").innerHTML.match(/<section class="stats-section stats-lead[\s\S]*?<\/section>/)?.[0] || "";
  // How these numbers are counted, the page's last block: the snapshot, the rules and each figure's own rules.
  // A caption in plain words (the user, 2026-10-15: "the figures have some weird ai ish wording right?"): one or two
  // short sentences, no stacked semicolons, no filler about where the numbers stand, never "in all".
  const assertPlainCaption = (caption) => {
    const text = caption.replace(/<[^>]+>/g, "").replace(/^\s*(Figure|Table) \d+\.\s*/, "").trim();
    assert.ok((text.match(/\.\s+[A-Z]/g) || []).length <= 1, `At most two short sentences: ${text}`);
    assert.ok((text.match(/;/g) || []).length <= 1, `No stacked semicolons: ${text}`);
    assert.doesNotMatch(text, /\bin all\b|each label gives|beside each bar|the number beside|Numbers compared for the same paper/i, `No filler: ${text}`);
  };
  const methodHtml = () => element("statsCharts").innerHTML.match(/<details class="stats-explanation stats-method">[\s\S]*?<\/details>$/)?.[0] || "";
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
  // Numbered parts with one plain heading each; a part without its numbers is left out and the rest stay in order.
  assert.deepEqual(partTitles(), ["1 At a glance", "2 What is in the catalog"]);
  // Figures and tables are numbered in reading order, each with its caption; no figure has a data line under it (the
  // user, 2026-10-15: "Do we need this???"): the snapshot, its Data ID and the rules are said once, at the end.
  assert.doesNotMatch(element("statsCharts").innerHTML, /stats-fig-data|Snapshot [A-Z][a-z]{2} \d/);
  assert.equal((element("statsCharts").innerHTML.match(/Data ID/g) || []).length, 1, "The Data ID is said once");
  assert.match(methodHtml(), /^<details class="stats-explanation stats-method"><summary>How these numbers are counted<\/summary><dl>\s*<div><dt>Snapshot<\/dt><dd>[^<]*Data ID [0-9a-f]{10}\. Every number on this page is counted from this snapshot&#39;s Full data download\.<\/dd><\/div>/);
  // Shares say what they are out of: all records only in the figures and tables that count all records (here Figure 1
  // and Table 1); elsewhere the bar's, row's or card's own total, or the total the caption names.
  assert.match(methodHtml(), /<dt>Shares<\/dt><dd>In Figure 1 and Table 1 a share is out of all records; elsewhere it is out of its own bar&#39;s, row&#39;s or card&#39;s total, or the total its caption names\. Shares are given to one decimal place; a share above 0 but below 0\.1% is written &lt;0\.1%\.<\/dd>/);
  // Paper and PDF: How these numbers are counted (the one place of the Data ID and the rules) prints open, then closes
  // again unless the viewer had opened it; the stylesheet opens it too where a browser prints without telling the page.
  {
    const closed = { open: false, dataset: {} };
    const opened = { open: true, dataset: {} };
    const previousAll = document.querySelectorAll;
    document.querySelectorAll = (selector) => (selector === ".stats-method:not([open])" ? [closed, opened].filter((item) => !item.open)
      : selector === ".stats-method[data-print-opened]" ? [closed, opened].filter((item) => item.dataset.printOpened) : previousAll(selector));
    try {
      api.statsOpenMethodForPrint();
      assert.deepEqual([closed.open, opened.open], [true, true]);
      api.statsCloseMethodAfterPrint();
      assert.deepEqual([closed.open, opened.open, closed.dataset.printOpened], [false, true, undefined]);
    } finally {
      document.querySelectorAll = previousAll;
    }
    assert.match(styleSource, /@media print \{[^@]*?\.stats-method::details-content \{ content-visibility:visible; display:block \}/);
  }
  // A linked key number under the pointer: the tint and larger halo darken its ground, so its label and note step up
  // to --text-2 and keep AA contrast.
  assert.match(styleSource, /\.stats-total:has\(> dd > a\.stats-total-value:hover\) :is\(dt, dd small\) \{ color:var\(--text-2\) \}/);
  assert.deepEqual(api.statsNumbersText("Table", [1, 2, 3, 4, 7]), "Tables 1–4 and 7");
  assert.deepEqual(api.statsNumbersText("Table", [1, 2, 5]), "Tables 1, 2 and 5");
  assert.deepEqual(api.statsNumbersText("Figure", [1]), "Figure 1");
  assert.equal(api.statsSharesRule({ Figure: [], Table: [] }).slice(0, 37), "A share is out of its own bar's, row'");
  assert.match(element("statsCharts").innerHTML, /<strong>Figure 1\.<\/strong> Each record has exactly one review result\.<\/span><\/figcaption>/);
  assert.match(element("statsCharts").innerHTML, /<strong>Table 1\.<\/strong> A record usually has several of these\.<\/span><\/figcaption>/);
  // The review result is a donut (the one partition that is a true whole) beside its legend table; Accepted is split in
  // the rows under it.
  assert.match(element("statsCharts").innerHTML, /<svg class="stats-donut" viewBox="0 0 200 200" role="img" aria-label="Review result of all records: 6 records\. Accepted 3 \(50\.0%\); Not confirmed 1 \(16\.7%\); Not checked \(Unverified\) 1 \(16\.7%\); Disputed 1 \(16\.7%\)\."/);
  // Each slice has one fill (its colour at 60%, from the stylesheet), no gradient, and lights with its table row.
  assert.match(element("statsCharts").innerHTML, /<path class="stats-part-unverified" d="[^"]+" data-hl="unverified" data-tip="Not checked \(Unverified\): 1 \(16\.7%\)"><\/path>/);
  assert.doesNotMatch(element("statsCharts").innerHTML, /radialGradient|statsDonutFill/);
  assert.match(element("statsCharts").innerHTML, /data-stat-key="unverified" data-count="1" data-hl="unverified"/);
  // Not checked stands for both of its parts: pointing at it lights the Unverified and Not reviewed slices and rows.
  assert.match(element("statsCharts").innerHTML, /<tr class="stats-row-group" data-stat-key="not_verified" data-count="1" data-hl="unverified mathematically_inferred">/);
  assert.match(element("statsCharts").innerHTML, /data-part="accepted_printed" data-count="2" data-hl="accepted"/, "Accepted's parts light Accepted");
  assert.equal((element("statsCharts").innerHTML.match(/<path class="stats-part-/g) || []).length, 4, "One slice per review result with records");
  assert.match(element("statsCharts").innerHTML, /data-part="accepted_printed" data-count="2"[\s\S]*?As printed/);
  assert.doesNotMatch(element("statsCharts").innerHTML, /Agreement with human reviewers|stats-lead/, "No lead without agreement counts");
  assert.equal(element("statsScope").textContent, "All 6 records in this snapshot. Select a name to see those records in Browse.");
  assert.equal((element("statsCharts").innerHTML.match(/Select a (linked )?name/g) || []).length, 0, "Said once, under the heading");
  assert.doesNotMatch(element("statsTotals").innerHTML, /Human-checked|Papers|Read from the paper/, "No headline without its number");
  assert.match(element("statsTotals").innerHTML, /Enzymes<\/dt><dd><span class="stats-total-value">2</);
  // The key numbers: Records plain, Accepted linked to its Browse filter.
  assert.match(element("statsTotals").innerHTML, /<div class="stats-total" data-total="records"><dt>Records<\/dt><dd><span class="stats-total-value">6<\/span>/);
  assert.match(element("statsTotals").innerHTML, /<dt>Accepted<\/dt><dd><a class="stats-total-value" href="https:\/\/example\.test\/tools\/catlog-latest\.html#browse\?status=accepted">3<\/a><small>50\.0% of records<\/small>/);
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
    assert.match(ruled, /1 records have no PMID or DOI linked, so their values cannot be traced to a paper\. They count as Not checked, not Accepted\./);
    assert.doesNotMatch(ruled, /accepted records have no PMID/);
    assert.match(ruled, /1 as printed, 1 after a correction, 1 on a human reviewer&#39;s approval\./);
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
  for (const [label, value] of [["Read from the paper", 2], ["Papers", 5], ["Enzymes", 3], ["EC numbers", 4], ["Organisms", 2], ["Substrates", 6]]) {
    assert.match(totalsHtml, new RegExp(`${label}</dt><dd>(<a class="stats-total-value" [^>]+>|<span class="stats-total-value">)${value}<`));
  }
  assert.match(totalsHtml, /#browse\?source=paper">2<\/a><small>from 1 papers<\/small>/);
  // Human-checked is a check under Quality; the band has no Human review without the review's counts.
  assert.doesNotMatch(totalsHtml, /Human-checked|Human review/);
  assert.deepEqual(partTitles(), ["1 At a glance", "2 Quality", "3 What is in the catalog", "4 Biology", "5 Values", "6 Cautions"]);
  // On this page: one line under the title listing the parts as their headings number them, each a link to the part's
  // own address (#stats-<key>, the section's id), so a phone visitor reaches a part without scrolling the whole page.
  const contentsItems = () => [...element("statsContents").innerHTML
    .matchAll(/<li><a href="#stats-([a-z]+)"><span class="stats-contents-number" aria-hidden="true">(\d+)<\/span> ([^<]+)<\/a><\/li>/g)]
    .map((match) => [match[1], `${match[2]} ${match[3]}`]);
  assert.equal(element("statsContents").hidden, false);
  assert.match(element("statsContents").innerHTML, /^<span class="stats-contents-title">On this page<\/span><ul><li>/);
  assert.deepEqual(contentsItems().map(([, title]) => title), partTitles());
  for (const [key] of contentsItems()) {
    assert.match(element("statsTotals").innerHTML + element("statsCharts").innerHTML, new RegExp(`<section class="stats-(?:band|part)[^"]*" id="stats-${key}"`), `#stats-${key} is a part`);
  }
  assert.deepEqual(headings(), ["Checks on the values", "Review result", "Records by main source", "Read from the paper and not yet re-read",
    "What the records contain", "Wild type and variants", "Enzyme classes", "Most common organisms", "Most common EC numbers", "Value ranges",
    "Cautions on values"]);
  // An odd figure out in a part shares a column: the fields stand over the forms beside Read from the paper and not yet
  // re-read.
  assert.match(chart, /<div class="stats-stack"><section class="stats-section stats-figure-section" aria-labelledby="statsContentsTitle"/);
  // A figure's caption ends its figcaption; its own rules stand under its number at the end of the page.
  assert.match(chart, /<strong>Table 2\.<\/strong> Each record's enzyme form, as Browse tags it\.<\/span><\/figcaption>/);
  assert.match(chart, /<strong>Table \d+\.<\/strong> A caution marks a value that may be wrong\. One record can carry several\.<\/span><\/figcaption>/);
  // Bar charts name their number columns above them instead of saying in the caption what each number is; a share
  // column says its base (% accepted: of the bar's own records), so Accepted heads only a count (Figure 5).
  assert.match(chart, /data-chart="main-source"[\s\S]*?<div class="stats-chart-head" aria-hidden="true"><span class="stats-chart-value has-parts"><span class="stats-value-part"[^>]*><span>Records<\/span><\/span><span class="stats-value-part"[^>]*><span>% accepted<\/span>/);
  assert.match(chart, /data-chart="versions"[\s\S]*?<span>Records<\/span><\/span><span class="stats-value-part"[^>]*><span>% accepted<\/span>/);
  assert.doesNotMatch(chart, /data-sizer-narrow="[^"]*accepted/, "% accepted keeps one line on the narrowest phones");
  assert.match(chart, /<strong>Figure 2\.<\/strong> Each record counts once, under the source it came from, coloured by review result\./);
  assert.match(chart, /<strong>Figure 3\.<\/strong> Together the two bars hold every record, coloured by review result\./);
  assert.match(methodHtml(), /<dl class="stats-method-figures"><div><dt>Figure 2<\/dt><dd><span class="stats-method-title">Records by main source\.<\/span> A record merged from several databases counts once here, under Several databases\./);
  assert.match(methodHtml(), /<dt>Table 1<\/dt><dd><span class="stats-method-title">What the records contain\.<\/span> 1 kcat\/Km values were calculated as kcat ÷ Km/);
  // The numbers come from the snapshot's Full data download and, where the page has them, the human-review results and
  // the AI audit records (dated where they are shown).
  assert.match(methodHtml(), /<dt>Snapshot<\/dt><dd>[^<]*Every number on this page is counted from this snapshot&#39;s Full data download and the human-review results\.<\/dd>/);
  // Figure 2: each record once under its main source, coloured by review result; only CatLog's own records are linked.
  assert.match(chart, /data-row="brenda" data-count="3"[\s\S]*?<span class="stats-chart-value has-parts"><span class="stats-value-part" data-sizer="[^"]+"><span>3<\/span><\/span><span class="stats-value-part stats-muted" data-sizer="[^"]+"><span>0\.0%<\/span><\/span><\/span>/);
  assert.match(chart, /data-row="catlog" data-count="2"[\s\S]*?#browse\?source=paper">Read from the paper<\/a>/);
  assert.match(chart, /data-row="oed" data-count="1"[\s\S]*?class="stats-seg stats-part-accepted is-start is-end" style="left:0%;width:33\.3333%" data-records="0,33\.3333" data-share="0,100"/);
  // Records | Share: each segment carries both places, and the share axis waits hidden.
  assert.match(chart, /<button type="button" class="stats-switch-button" data-stats-mode="records" aria-pressed="true">Records<\/button><button type="button" class="stats-switch-button" data-stats-mode="share" aria-pressed="false">Share<\/button>/);
  assert.match(chart, /data-axis-mode="share" hidden/);
  // Read from the paper and not yet re-read by review result: the first is the main source catlog, the second every
  // other record. CatLog is the one name: no v1 or v2 anywhere on Stats.
  assert.doesNotMatch((chart + totalsHtml).replace(/<[^>]*>/g, " "), /\bv[12]\b/);
  assert.match(chart, /data-row="catlog" data-count="2"[\s\S]*?#browse\?source=paper">Read from the paper<\/a>[\s\S]*?<span class="stats-chart-value has-parts"><span class="stats-value-part" data-sizer="0&#10;Records"><span>2<\/span><\/span><span class="stats-value-part stats-muted" data-sizer="000\.0%&#10;%\u00a0accepted"><span>100\.0%<\/span>/);
  assert.match(chart, /data-row="v1" data-count="4"[\s\S]*?#browse\?source=databases">Not yet <span class="nowrap">re-read<\/span><\/a>[\s\S]*?<span class="stats-chart-value has-parts"><span class="stats-value-part" data-sizer="0&#10;Records"><span>4<\/span><\/span><span class="stats-value-part stats-muted" data-sizer="000\.0%&#10;%\u00a0accepted"><span>25\.0%<\/span>/);
  assert.match(chart, /data-tip="Not yet re-read, Not confirmed: 1 \(25\.0%\)"/);
  // How these numbers are counted says what each means, the earlier version once, in its help.
  assert.match(chart, /<dt>Read from the paper<\/dt><dd>Records read from the paper by an AI model; a second, separate AI check compared each value with the paper\.<\/dd>/);
  assert.match(chart, /<dt>Not yet <span class="nowrap">re-read<\/span><\/dt><dd>All other records: from CatLog&#39;s earlier version, which started from enzyme database entries and checked part of them against their papers; when CatLog reads a paper, its records replace these\.<\/dd>/);
  assert.doesNotMatch(element("statsCharts").innerHTML, /(?<!<span class="nowrap">)re-read(?![^<>]*>)/, "Each re-read on Stats is kept whole");
  assert.equal((chart.match(/earlier version/g) || []).length, 1, "the earlier version is named once on Stats");
  assert.match(chart, /BRENDA, Not confirmed: 1/);
  // Main-source counts that do not add up to the review results are not drawn by status.
  runtimeManifest.summary.overview = { ...overview, main_sources: { catlog: { verified: 9 } } };
  api.renderStats();
  assert.doesNotMatch(element("statsCharts").innerHTML, /BRENDA, Not confirmed/);
  runtimeManifest.summary.overview = overview;
  api.renderStats();
  assert.ok(chart.includes("Read from the paper by an AI model; a second, separate AI check compared each value with the paper. AI audits and human reviewers then checked samples against the papers."));
  // Every caption is "Figure N." or "Table N." and a short, plain caption.
  const captions = chart.match(/<span class="stats-fig-caption">[\s\S]*?<\/span>(?=<\/figcaption>)/g) || [];
  assert.ok(captions.length >= 3, "Stats has numbered captions");
  captions.forEach(assertPlainCaption);
  assert.match(chart, /href="https:\/\/example\.test\/tools\/catlog-latest\.html#guide-method">How CatLog reads and checks values <span aria-hidden="true">→<\/span><\/a>/);
  assert.doesNotMatch(chart, /independent|AI run|separate AI run/);
  assert.match(chart, /<li class="stats-check" data-check="second_check">[\s\S]*?#browse\?source=paper">2<\/a><\/span>\s*<span class="stats-check-unit">records from 1 papers<\/span>/);
  // kcat, Km and kcat/Km in the site's italic markup, in the lead, the checks and the Guide's method section.
  const metricPlain = (html) => html.replace(/<i>([kK])<\/i><sub>(cat|m|i)<\/sub>/g, "$1$2");
  assert.match(chart, /<span class="stats-check-result">A human reviewer approved every <i>k<\/i><sub>cat<\/sub> and <i>K<\/i><sub>m<\/sub> shown;/);
  // The records with a reviewer's verdict are said as such (not mixed up with the review's entries).
  assert.match(metricPlain(chart), /<li class="stats-check" data-check="human_checked">[\s\S]*?#browse\?checked=1">1<\/a><\/span>\s*<span class="stats-check-unit">accepted records<\/span>[\s\S]*?<span class="stats-check-result">A human reviewer approved every kcat and Km shown; the kcat\/Km was approved too or agrees with kcat ÷ Km\. Reviewers gave a verdict on 2 records, approved or not\.<\/span>/);
  assert.match(chart, /<span class="stats-meter" aria-hidden="true"><span style="width:50%"><\/span><\/span>/, "Human-checked of the records with a reviewer's verdict");
  // The second AI check covers every value: no completion bar, only its place kept (the cards align).
  assert.match(chart, /data-check="second_check">[\s\S]*?<span class="stats-meter is-blank" aria-hidden="true"><\/span>[\s\S]*?data-check="human_checked"/);
  assert.doesNotMatch(chart, /data-check="audit"|wrong number or unit/, "Without overview.quality there is no audit check and no accuracy");
  // How these numbers are counted: human-checked's rule as one clause after "where".
  assert.match(chart, /<dt>Human-checked<\/dt><dd>Accepted records where a human reviewer approved every kcat and Km shown and the kcat\/Km was approved too or agrees with kcat ÷ Km \(the human-checked tag\)\.<\/dd>/);
  // The Guide's method section: what the checks found, as tiles (one figure, one phrase, one note each), from the same
  // numbers; without the review's counts only the human-checked records, and no disclosure of what the review found.
  const guideTiles = () => [...element("guideMethodLead").innerHTML.matchAll(/data-guide-check="([^"]+)"/g)].map((match) => match[1]);
  const guideTile = (key) => element("guideMethodLead").innerHTML.match(new RegExp(`<li class="guide-check" data-guide-check="${key}">[\\s\\S]*?</li>`))?.[0] || "";
  element("guideMethodHuman").innerHTML = "static human";
  api.renderGuideMethod();
  assert.deepEqual(guideTiles(), ["checked"], "Only the human-checked records without the review's counts");
  assert.equal(metricPlain(guideTile("checked")), '<li class="guide-check" data-guide-check="checked"><span class="guide-check-title">Human-checked</span><span class="guide-check-figure"><svg class="check-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2.4 6.5 4.9 9 9.6 3.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>1</span><span class="guide-check-text">accepted records: a human reviewer approved every kcat and Km they show</span><span class="guide-check-note"><a href="#browse?checked=1">Show them</a></span></li>');
  assert.match(guideTile("checked"), /approved every <i>k<\/i><sub>cat<\/sub> and <i>K<\/i><sub>m<\/sub> they show/);
  assert.match(element("guideMethodLead").innerHTML, /<a href="https:\/\/example\.test\/tools\/catlog-stats\.html">More on Stats<\/a>/);
  assert.equal(element("guideMethodMore").hidden, true, "No disclosure of what the review found without its counts");
  // With the audit and review results (overview.quality, copied from the human-review marks file at build time).
  runtimeManifest.summary.overview = { ...overview, quality: { as_of: "2026-10-11", audit_values: 742, audit_wrong: 2,
    compared_values_v1: 2431, compared_papers_v1: 312, wrong_v1: 9, label_or_annotation_v1: 114, v2_found: 2160,
    v2_approved_total: 2380, v2_differences_checked: 504, v2_wrong: 0 } };
  api.renderStats();
  const qualityChart = element("statsCharts").innerHTML;
  assert.deepEqual(headings().slice(0, 3), ["Checks on the values", "Review result", "Records by main source"]);
  assert.match(qualityChart, /<li class="stats-check" data-check="audit">\s*<span class="stats-check-name">AI audits<\/span>\s*<span class="stats-check-number">742<\/span>\s*<span class="stats-check-unit">values re-checked against the paper<\/span>[\s\S]*?<span class="stats-check-result">740 kept and 2 removed as wrong \(0\.3%\), as of Oct 11, 2026\.<\/span>/);
  // The lead (the match read from the paper again) says what reviewers found in the earlier version's entries: the share
  // correct never without the label errors beside it; the checks repeat neither.
  assert.match(leadHtml(), /In entries from the earlier version, 9 of 2,431 values reviewers compared had a wrong number or unit \(99\.6% correct\), and 114 had a wrong enzyme, organism, substrate, variant or protein label\./);
  assert.doesNotMatch(qualityChart, /data-check="review"|data-check="agreement"/);
  // With the audits shown, their records are named among the sources of the page's numbers.
  assert.match(methodHtml(), /<dt>Snapshot<\/dt><dd>[^<]*Every number on this page is counted from this snapshot&#39;s Full data download, the human-review results and the AI audit records\.<\/dd>/);
  // v2_found of v2_approved_total: the reviewers' approved values CatLog has, read from the paper again (a snapshot
  // without quality.agreement).
  assert.match(leadHtml(), /Where CatLog has <span class="nowrap">re-read<\/span> a paper the reviewers checked, its value matches the approved value for 2,160 of 2,380 \(90\.8%\)\. None of the other 220 is a CatLog value found wrong\./);
  // The band gives the same share as the lead.
  assert.match(element("statsTotals").innerHTML, /<dt>Human review<\/dt><dd><span class="stats-total-value">90\.8%<\/span><small>of approved values the same where CatLog has <span class="nowrap">re-read<\/span> the paper<\/small>/);
  api.renderGuideMethod();
  assert.deepEqual(guideTiles(), ["reread", "audit", "checked"]);
  assert.equal(guideTile("audit"), '<li class="guide-check" data-guide-check="audit"><span class="guide-check-title">AI audits</span><span class="guide-check-figure">742</span><span class="guide-check-text">values re-checked against their papers by a separate AI auditor</span><span class="guide-check-note">2 were wrong (0.3%) and removed. As of Oct 11, 2026.</span></li>');
  assert.match(guideTile("reread"), /<span class="guide-check-figure">90\.8%<\/span><span class="guide-check-text">of approved values the same where CatLog has <span class="nowrap">re-read<\/span> the paper \(2,160 of 2,380\)<\/span><span class="guide-check-note">None of the other 220 is a CatLog value found wrong\.<\/span>/);
  // the comparison with human reviewers comes first, then the match and the human-checked count
  assert.equal(element("guideMethodMore").hidden, false);
  assert.match(metricPlain(element("guideMethodHuman").innerHTML), /^In entries from the earlier version, 9 of 2,431 values.* 1 accepted records are human-checked: a human reviewer approved every kcat and Km they show; the kcat\/Km was approved too or agrees with kcat ÷ Km\.$/);
  // Numbers that do not hold together are not shown: the share correct never appears without the label errors.
  runtimeManifest.summary.overview = { ...overview, quality: { audit_values: 5, audit_wrong: 6, compared_values_v1: 10, wrong_v1: 1,
    v2_approved_total: 4, v2_found: 3, v2_differences_checked: 2, v2_wrong: 2 } };
  api.renderStats();
  const partialChart = element("statsCharts").innerHTML;
  assert.doesNotMatch(partialChart, /data-check="audit"|% correct/);
  // (two wrong values among one that differs do not hold together: the match is said without them)
  assert.match(leadHtml(), /for 3 of 4 \(75\.0%\)\.<\/p>/);
  // The lead: the human review (the user's headline from 2026-10-13). A snapshot without the reviewers' own counts
  // (overview.quality.review) leads with the match of the reviewers' approved values, read from the paper again.
  const agreementFixture = { papers_compared: 98, values_approved: 2489, agree: 2232, agree_pct: 89.7, differ: 257,
    differ_catlog_right: 109, differ_earlier_value_error: 9, differ_earlier_label_error: 100, differ_same_value_other_name: 16,
    differ_rounding: 3, differ_catlog_wrong: 0, differ_not_comparable: 24, differ_not_adjudicated: 105, stated_values: 58,
    stated_values_catlog_has: 53 };
  runtimeManifest.summary.overview = { ...overview, quality: { as_of: "2026-10-12", audit_values: 973, audit_wrong: 2, agreement: agreementFixture } };
  // The Team loop's AI audit station gives the values re-checked (on two lines inside the upright loop's arc).
  api.renderTeam();
  assert.match(element("teamFigure").innerHTML, /aria-label="AI audit: 973 values re-checked"/);
  assert.match(element("teamFigure").innerHTML, />973 values<\/text><text class="team-station-number"[^>]*>re-checked<\/text>/);
  // Without the review's counts, Human check gives the share of approved values the same where CatLog has re-read the
  // paper (never "agreement" alone).
  assert.match(element("teamFigure").innerHTML, /aria-label="Human check: 89\.7% of approved values the same where CatLog has re-read the paper[",]/);
  assert.doesNotMatch(element("teamFigure").innerHTML, /% agreement/);
  api.renderStats();
  // The lead opens Quality, the first part after the headline band.
  let lead = leadHtml();
  assert.equal((element("statsCharts").innerHTML.match(/data-figure="review"/g) || []).length, 1, "The lead is shown once");
  assert.match(element("statsCharts").innerHTML, /^<section class="stats-part" id="stats-quality" data-part="quality" aria-labelledby="statsPartQualityTitle">\s*<h2 id="statsPartQualityTitle"[^>]*>[\s\S]*?<\/h2>\s*<div class="stats-part-grid"><section class="stats-section stats-lead/);
  assert.equal(element("statsLead").hidden, true, "An older page's slot above the counts stays empty");
  assert.match(lead, /<h3 id="statsReviewTitle" class="stats-fig-title">Human review<\/h3>/);
  assert.match(lead, /<div class="stats-lead-figure"><strong>89\.7%<\/strong><span>of the values human reviewers approved are the same where CatLog has <span class="nowrap">re-read<\/span> the paper \(98 papers\)<\/span><\/div>/);
  // The other values, each kind counted (the user's sentence, 2026-10-15), only when the kinds add up to them.
  assert.match(lead, /<p class="stats-lead-sentence">Where CatLog has <span class="nowrap">re-read<\/span> a paper the reviewers checked, its value matches the approved value for 2,232 of 2,489 \(89\.7%\)\. Of the other 257, 16 are the same value under another name, 109 are values the paper supports as CatLog reads them \(the earlier entry&#39;s number or label was wrong\), 3 differ by rounding, 24 cannot be compared and 105 are not yet checked; none is a CatLog value found wrong\.<\/p>/);
  assert.match(lead, /href="https:\/\/example\.test\/tools\/catlog-latest\.html#team">People behind CatLog/);
  assert.doesNotMatch(lead, /independent|AI run|Claude|Codex|first comparison|blind|95% range/);
  assert.doesNotMatch(element("statsCharts").innerHTML, /data-check="agreement"/, "The match is the lead's, not repeated in the checks");
  // The Guide's tiles give the same share, linked to Stats; the disclosure gives the other values by kind.
  api.renderGuideMethod();
  assert.equal(element("guideMethodLead").hidden, false);
  assert.deepEqual(guideTiles(), ["reread", "audit", "checked"]);
  assert.match(guideTile("reread"), /<span class="guide-check-figure">89\.7%<\/span>[\s\S]*\(2,232 of 2,489\)<\/span><span class="guide-check-note">None of the other 257 is a CatLog value found wrong\.<\/span>/);
  assert.match(element("guideMethodHuman").innerHTML, /Of the other 257, 16 are the same value under another name, 109 are values the paper supports as CatLog reads them \(the earlier entry&#39;s number or label was wrong\), 3 differ by rounding, 24 cannot be compared and 105 are not yet checked; none is a CatLog value found wrong\./);
  // With the reviewers' own counts (quality.review.v1, as the marks file has them on 2026-10-13) the lead is the human
  // review of the earlier version's entries; the first-comparison and blind fields are reference only and never read.
  const reviewV1 = { entries: 2674, papers: 408, entries_without_paper: 166, approved: 2464, rejected: 210, value_disputed: 3,
    value_correct_pct: 99.9, value_disputed_checked_as_printed: 3, value_missing: 31, value_missing_pct: 1.2, value_missing_named: 32,
    other_disputed: 177, other_disputed_pct: 6.6, other_by_kind: { "could not find the value": 153, "organism name": 13, DOI: 5,
      "substrate name": 3, duplicate: 2, "paper evidence mismatch": 1 } };
  const currentAgreement = { papers_compared: 311, values_approved: 4074, first_agree: 3545, first_agree_pct: 87.0, agree: 3625,
    agree_pct: 89.0, papers_exposed: 14, first_agree_unexposed_pct: 85.9, papers_unexposed: 291, first_agree_unexposed_ci95: "81.6-89.7",
    first_catlog_errors: 69, first_catlog_errors_value: 0, first_catlog_errors_label: 68, first_catlog_errors_missed: 1,
    fixed_after_comparison: 69, catlog_value_wrong: 0, stated_values: 58, stated_values_catlog_has: 53 };
  const reviewQuality = { as_of: "2026-10-13", audit_values: 1331, audit_wrong: 30, v2_found: 3625, v2_approved_total: 4074,
    review: { v1: reviewV1 }, agreement: currentAgreement };
  runtimeManifest.summary.overview = { ...overview, quality: reviewQuality };
  api.renderStats();
  lead = leadHtml();
  assert.match(lead, /The 3 disputed values are as printed in the paper/);
  assert.doesNotMatch(lead.replace(/<a [^>]*>[\s\S]*?<\/a>/g, ""), /(?<![\w/>])(?:kcat|Km)(?![\w])/, "No plain kcat or Km in the lead's text");
  lead = metricPlain(lead);
  // The user's words (2026-10-15): "Human review", 99.9%, no value disputed on 2,671 of 2,674 entries from the earlier
  // version (408 papers); the sentence under it says the disputed values as printed and the entries whose value the
  // reviewer could not find, never the base again.
  assert.match(lead, /<h3 id="statsReviewTitle" class="stats-fig-title">Human review<\/h3>/);
  // The band's Human review is the same headline. The base's parenthesis keeps one line wherever it is shown.
  assert.match(element("statsTotals").innerHTML, /<dt>Human review<\/dt><dd><span class="stats-total-value">99\.9%<\/span><small>no value disputed on 2,671 of 2,674 entries from the earlier version <span class="nowrap">\(408 papers\)<\/span><\/small>/);
  assert.match(lead, /<div class="stats-lead-figure"><strong>99\.9%<\/strong><span>no value disputed on 2,671 of 2,674 entries from the earlier version <span class="nowrap">\(408 papers\)<\/span><\/span><\/div>/);
  assert.match(lead, /<p class="stats-lead-sentence">The 3 disputed values are as printed in the paper\. In 153 entries \(5\.7%\) the reviewer could not find the value in the paper\.<\/p>/);
  assert.doesNotMatch(lead, /values correct|A reviewer disputed/);
  assert.match(lead, /<dt>Values missing<\/dt><dd>31 entries \(1\.2%\)<\/dd><\/div><div><dt>Other disagreements<\/dt><dd>177 entries \(6\.6%\)<\/dd>/);
  // The kinds of other disagreement, counts in brackets, without the one the sentence above says.
  assert.match(lead, /<p class="stats-lead-note">Values missing: the paper prints a value the entry lacked, most often the kcat\. CatLog has since read 53 of the 58 values the reviewers named\. Other disagreements, by kind: organism name \(13\), DOI \(5\), substrate name \(3\), duplicate \(2\), paper evidence mismatch \(1\)\.<\/p>/);
  // The match without the kinds of the other values (an agreement without them says only the wrong values found).
  assert.match(lead, /<p class="stats-lead-side">Where CatLog has <span class="nowrap">re-read<\/span> a paper the reviewers checked, its value matches the approved value for 3,625 of 4,074 \(89\.0%\)\. None of the other 449 is a CatLog value found wrong\.<\/p>/);
  assert.doesNotMatch(lead.replace(/<[^>]*>/g, " "), /\bv[12]\b/, "CatLog is the one name");
  // What the review counts is said once, under How these numbers are counted, not under the lead.
  assert.doesNotMatch(lead, /Counted|own files|stats-fig-data/);
  // Its definitions set kcat and Km in italic as everywhere else on the page.
  assert.match(methodHtml(), /<dt>Human review<\/dt><dd>[^<]*no reviewer disputed the entry&#39;s <i>k<\/i><sub>cat<\/sub>, <i>K<\/i><sub>m<\/sub> or/);
  assert.match(metricPlain(methodHtml()), /<dt>Human review<\/dt><dd>Counted Oct 13, 2026\. From the reviewers&#39; own files: each entry a reviewer checked counts once, by its final verdict\. No value disputed: no reviewer disputed the entry&#39;s kcat, Km or kcat\/Km number or unit\. Could not find the value: the reviewer could not find the entry&#39;s value in the paper \(one kind of other disagreement\)\. Values missing: the reviewer says the paper prints a value the entry lacks\. Approved values: kcat, Km and printed kcat\/Km values a reviewer approved without objection\. The same value: the same paper, metric, protein, variant and substrate, and a value within 2%\.<\/dd>/);
  assert.doesNotMatch(lead, /first comparison|blind|95% range|85\.9|87\.0|earlier catalog/i, "The strict wording is gone");
  // The checks: the second AI check, the AI audits and the human-checked records; the review and the match are the
  // lead's.
  const checks = element("statsCharts").innerHTML.match(/<ul class="stats-checks"[\s\S]*?<\/ul>/)[0];
  assert.deepEqual([...checks.matchAll(/data-check="([^"]+)"/g)].map((match) => match[1]), ["second_check", "audit", "human_checked"]);
  assert.match(checks, /1,301 kept and 30 removed as wrong \(2\.3%\), as of Oct 13, 2026\./);
  // The Guide: the headline first among the tiles (the base's parenthesis on one line), then the match, the audits and
  // the human-checked records; the review in full in the disclosure.
  api.renderGuideMethod();
  assert.deepEqual(guideTiles(), ["review", "reread", "audit", "checked"]);
  assert.equal(guideTile("review"), '<li class="guide-check" data-guide-check="review"><span class="guide-check-title">Human review</span><span class="guide-check-figure">99.9%</span><span class="guide-check-text">no value disputed on 2,671 of 2,674 entries from the earlier version <span class="nowrap">(408 papers)</span></span><span class="guide-check-note">The 3 disputed values are as printed in the paper.</span></li>');
  assert.match(guideTile("reread"), /<span class="guide-check-figure">89\.0%<\/span>[\s\S]*\(3,625 of 4,074\)<\/span><span class="guide-check-note">None of the other 449 is a CatLog value found wrong\.<\/span>/);
  assert.match(guideTile("audit"), /<span class="guide-check-figure">1,331<\/span>[\s\S]*<span class="guide-check-note">30 were wrong \(2\.3%\) and removed\. As of Oct 13, 2026\.<\/span>/);
  // The disclosure does not repeat the tiles' headline: it starts with what they do not say.
  assert.equal(metricPlain(element("guideMethodHuman").innerHTML), "In 153 entries (5.7%) the reviewer could not find the value in the paper. Values missing: 31 entries (1.2%) lacked a value the paper prints, most often the kcat. CatLog has since read 53 of the 58 values the reviewers named. Other disagreements: 177 entries (6.6%). Where CatLog has <span class=\"nowrap\">re-read</span> a paper the reviewers checked, its value matches the approved value for 3,625 of 4,074 (89.0%). None of the other 449 is a CatLog value found wrong. 1 accepted records are human-checked: a human reviewer approved every kcat and Km they show; the kcat/Km was approved too or agrees with kcat ÷ Km.");
  // Team's Human check: no value disputed, on two lines on the wide loop and four on the upright one, one phrase for
  // its label.
  api.renderTeam();
  const teamHtml = element("teamFigure").innerHTML;
  assert.equal((teamHtml.match(/aria-label="Human check: no value disputed on 2,671 of 2,674 entries \(99\.9%\) from the earlier version, 1 human-checked records"/g) || []).length, 2);
  const humanLines = (layout) => [...teamHtml.match(new RegExp(`class="team-loop team-loop-${layout}"[\\s\\S]*?</svg>`))[0]
    .match(/data-station="human"[\s\S]*?<\/g>/)[0].matchAll(/class="team-station-number"[^>]*>([^<]*)</g)].map((match) => match[1]);
  assert.deepEqual(humanLines("wide"), ["no value disputed on 2,671 of 2,674 entries", "(99.9%) from the earlier version", "1 human-checked records"]);
  // The upright loop's lines keep within its 23 characters, broken where the phrase reads on.
  assert.deepEqual(humanLines("narrow"), ["no value disputed on", "2,671 of 2,674 entries", "(99.9%) from the", "earlier version", "1 human-checked records"]);
  assert.doesNotMatch(teamHtml.replace(/<[^>]*>/g, " "), /\bv[12]\b/);
  assert.doesNotMatch(teamHtml, /first comparison|blind|95% range/);
  // No dispute, a dispute only partly checked against the paper, and a review of records read from the paper.
  assert.equal(api.reviewSentence(api.reviewFacts({ entries: 10, value_disputed: 0 })),
    "Human reviewers checked 10 entries from the earlier version: no value disputed on 10 of them (100.0%).");
  assert.equal(api.reviewSentence(api.reviewFacts({ entries: 10, papers: 1, value_disputed: 2, value_disputed_checked_as_printed: 1 })),
    "Human reviewers checked 10 entries from the earlier version (1 paper): no value disputed on 8 of them (80.0%); of the 2 disputed values, 1 is as printed in the paper.");
  assert.equal(api.reviewSentence(api.reviewFacts({ entries: 10000, papers: 40, value_disputed: 1, value_disputed_checked_as_printed: 1 }), { fromPaper: true }),
    "Human reviewers checked 10,000 records read from the paper (40 papers): no value disputed on 9,999 of them (>99.9%); the one disputed value is as printed in the paper.");
  // The disputed values and the entries whose value the reviewer could not find, on their own (under a lead that already
  // says the headline).
  assert.equal(api.reviewDisputedText(api.reviewFacts({ entries: 10, papers: 1, value_disputed: 2, value_disputed_checked_as_printed: 1 })),
    "Of the 2 disputed values, 1 is as printed in the paper.");
  assert.equal(api.reviewDisputedText(api.reviewFacts({ entries: 10, value_disputed: 0 })), "No value was disputed.");
  assert.equal(api.reviewDisputedText(api.reviewFacts({ entries: 10, value_disputed: 2 })), "");
  assert.equal(api.reviewNotFoundText(api.reviewFacts({ entries: 200, value_disputed: 0, other_disputed: 20, other_by_kind: { "could not find the value": 7, DOI: 1 } })),
    "In 7 entries (3.5%) the reviewer could not find the value in the paper.");
  assert.equal(api.reviewNotFoundText(api.reviewFacts({ entries: 200, value_disputed: 0, other_disputed: 20, other_by_kind: { DOI: 1 } })), "");
  runtimeManifest.summary.overview = { ...overview, quality: { ...reviewQuality, review: { v1: reviewV1,
    v2: { entries: 40, papers: 3, value_disputed: 1, value_disputed_checked_as_printed: 0 } } } };
  api.renderStats();
  assert.match(metricPlain(leadHtml()), /<p class="stats-lead-note">Human reviewers checked 40 records read from the paper <span class="nowrap">\(3 papers\)<\/span>: no value disputed on 39 of them \(97\.5%\)\.<\/p>/);
  api.renderGuideMethod();
  assert.match(element("guideMethodHuman").innerHTML, /Human reviewers checked 40 records read from the paper <span class="nowrap">\(3 papers\)<\/span>: no value disputed on 39 of them/);
  // Counts that do not hold together are not shown: a dispute count above the entries drops the review (the lead falls
  // back to the match read from the paper again), kinds that are not whole counts are left out.
  runtimeManifest.summary.overview = { ...overview, quality: { ...reviewQuality, review: { v1: { ...reviewV1, value_disputed: 3000 } } } };
  api.renderStats();
  assert.match(leadHtml(), /<h3 id="statsReviewTitle" class="stats-fig-title">Human review<\/h3>/);
  assert.doesNotMatch(leadHtml(), /entries from the earlier version|no value disputed/);
  runtimeManifest.summary.overview = { ...overview, quality: { review: { v1: { ...reviewV1, value_missing: undefined,
    other_by_kind: { "organism name": 13, DOI: "5", "": 2, duplicate: 400 } } } } };
  api.renderStats();
  lead = leadHtml();
  assert.doesNotMatch(lead, /Values missing|stats-lead-side|DOI|duplicate/);
  assert.match(lead, /Other disagreements, by kind: organism name \(13\)\./);
  assert.doesNotMatch(lead, /could not find/);
  // Part 7, Against the databases, reads only summary.database_comparison (the test bundle's counts, 2026-10-13): the
  // lead, each value against the databases, each database beside the values it pairs, how each correction was found
  // beside the corrections by cause and database; then the earlier version's figures (overview.earlier_corrections,
  // else quality's) and the replaced entries. An overview.quality.db_compare is no longer read.
  const databaseComparison = () => ({
    values: {
      kcat: { new_paper_not_in_databases: 411, confirmed: 34186, differs: 269, new: 4689, same_number_other_label: 1658, corrected: 328 },
      Km: { new_paper_not_in_databases: 635, confirmed: 40117, new: 4245, same_number_other_label: 2467, corrected: 381, differs: 221 },
      "kcat/Km": { new_paper_not_in_databases: 336, confirmed: 23488, not_compared: 5946, same_number_other_label: 1449, new: 5798,
        differs: 561, new_ratio_only: 4873, corrected: 839 },
      all: { new_paper_not_in_databases: 1382, confirmed: 97791, not_compared: 5946, differs: 1051, new: 14732,
        same_number_other_label: 5574, corrected: 1548, new_ratio_only: 4873 },
    },
    corrections: {
      values: 1548,
      by_cause: { power_of_ten: 557, printed_number_unit_not_applied: 253, header_scale_inverted: 179, unit_not_converted: 126,
        paper_unit_misprint: 91, decimal_or_exponent_slip: 86, time_factor: 82, header_scale_ignored: 56, mM_entered_as_uM: 28,
        value_from_other_row: 22, recomputed_ratio: 21, time_unit: 21, uM_entered_as_mM: 18, value_not_in_paper: 8 },
      by_database: { BRENDA: 1156, OED: 616, "SABIO-RK": 368, SKiD: 130, STRENDA: 12 },
      by_cause_database: {
        power_of_ten: { "SABIO-RK": 97, BRENDA: 456, OED: 259, SKiD: 51 },
        header_scale_inverted: { "SABIO-RK": 130, OED: 9, BRENDA: 49 },
        header_scale_ignored: { "SABIO-RK": 1, BRENDA: 55, OED: 8, SKiD: 2 },
        decimal_or_exponent_slip: { BRENDA: 85, OED: 48, SKiD: 3 },
        paper_unit_misprint: { "SABIO-RK": 43, OED: 25, BRENDA: 46, SKiD: 4 },
        mM_entered_as_uM: { BRENDA: 28, OED: 4, SKiD: 1 },
        time_factor: { BRENDA: 82, OED: 29, SKiD: 6 },
        value_from_other_row: { BRENDA: 22, OED: 5 },
        recomputed_ratio: { BRENDA: 21, OED: 6 },
        printed_number_unit_not_applied: { BRENDA: 229, OED: 133, "SABIO-RK": 24, SKiD: 63 },
        unit_not_converted: { BRENDA: 48, OED: 73, STRENDA: 12, "SABIO-RK": 66 },
        uM_entered_as_mM: { "SABIO-RK": 7, BRENDA: 11, OED: 11 },
        value_not_in_paper: { BRENDA: 3, OED: 6 },
        time_unit: { BRENDA: 21 },
      },
      by: { code: 892, paper_check: 656 },
    },
    values_by_database: {
      BRENDA: { same: 63221, paper_absent: 25603, value_absent: 18746, parameter_absent: 6268, other_values_only: 5433,
        same_number_other_label: 4731, corrected: 1156, differs: 813, same_rounded: 706, other_number: 274 },
      "SABIO-RK": { paper_absent: 76540, same: 44991, same_number_other_label: 3297, value_absent: 1131, corrected: 368,
        other_values_only: 291, parameter_absent: 136, differs: 120, other_number: 47, same_rounded: 30 },
      OED: { paper_absent: 52172, same: 45964, other_values_only: 14719, value_absent: 8126, same_number_other_label: 2876,
        same_rounded: 1771, corrected: 616, differs: 478, parameter_absent: 133, other_number: 96 },
      SKiD: { paper_absent: 99102, same: 8511, other_values_only: 7141, parameter_absent: 6219, value_absent: 4762,
        same_number_other_label: 844, corrected: 130, same_rounded: 107, differs: 79, other_number: 56 },
      STRENDA: { paper_absent: 126567, same: 216, same_number_other_label: 82, other_values_only: 38, value_absent: 34, corrected: 12, differs: 2 },
    },
    records_with_kind: { same: 45251, corrected: 1443, differs: 955, other_label: 3466, new: 14002 },
    not_reproduced: { distinct: { paired_with_different_number: 5635, reprinted_from_other_work: 2372, catlog_kept_no_values_from_paper: 1793,
      equals_catlog_calculated_ratio: 1687, possible_catlog_miss: 1118, another_parameter_in_catlog: 463, possible_miss_weak: 448,
      not_in_paper_text: 409, rejected_by_catlog_checks: 322, no_substrate_named_paper_has_several: 222, next_to_other_quantity: 154,
      another_measurement_per_paper_check: 10 } },
    papers: 2650, papers_compared: 2598,
  });
  const databaseSection = () => element("statsCharts").innerHTML.match(/<section class="stats-part" id="stats-databases" data-part="databases"[\s\S]*?<\/div><\/section>(?=<section class="stats-part"|<details|$)/)?.[0] || "";
  const figureHtml = (key) => element("statsCharts").innerHTML.match(new RegExp(`<section class="stats-section[^"]*" aria-labelledby="[^"]+" data-figure="${key}">[\\s\\S]*?</figure>[\\s\\S]*?</section>`))?.[0] || "";
  const plain = (html) => html.replace(/<[^>]*>/g, "").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const earlierCounts = { records: 2881, items: 5059, other_items: 889, before_listed: [2601, 3635], values: {
    kcat: { rounding: 454, different: 222, magnitude: 35, added: 159 }, km: { rounding: 214, different: 319, magnitude: 85, added: 236 },
    kcat_over_km: { rounding: 1532, different: 728, magnitude: 46, added: 140 } } };
  runtimeManifest.summary.database_comparison = databaseComparison();
  runtimeManifest.summary.overview = { ...overview, earlier_corrections: earlierCounts, quality: {
    db_compare: { kcat: { same: 9, differs: 1, absent: 0 } },
    replaced: { records: 7, accepted: 2, papers: 1, values: { kcat: [5, 6], km: [2, 2] } } } };
  api.renderStats();
  let figures = element("statsCharts").innerHTML;
  assert.deepEqual(headings().slice(-7), ["Values against the databases", "Results by database",
    "Paired values by database", "Corrections by cause and how found", "Corrections by cause and database",
    "Corrections on records not yet re-read", "Entries replaced by reading the paper"]);
  assert.equal(partTitles().at(-1), "7 Against the databases");
  assert.doesNotMatch(figures, /Values read from the paper against the databases|data-figure="db-compare"/);
  // The lead: one sentence on every value compared, one on the values a database pairs; result names link into Browse.
  const dbLead = figures.match(/<p class="stats-part-lead" data-lead="databases">[\s\S]*?<\/p>/)?.[0] || "";
  // The lead names the papers with a compared value (papers_compared), never more than CatLog has read.
  assert.equal(plain(dbLead), "CatLog compared 126,951 values read from 2,598 papers with what the databases list for the same papers. Of these, 97,791 (77.0%) are the number a database lists, and 5,574 are the same number under another label. Another 1,548 correct a database's number (656 checked against the paper), and 1,051 differ, cause not yet known. A different number can mean a different measurement; it does not by itself mean a database is wrong. The remaining 20,987 are in none of the databases. Where a database lists a number for the same measurement (100,390 values), 97.4% of those numbers are the paper's.");
  // The caveat is said once in part 7, here, never under each figure.
  assert.equal((databaseSection().match(/does not by itself mean a database is wrong/g) || []).length, 1);
  // Its counts add up to the total (97,791 + 5,574 + 1,548 + 1,051 + 20,987 = 126,951), in Figure 8's order.
  // Browse lists records: each link's title says how many it opens.
  assert.match(dbLead, /href="[^"]*#browse\?db=other_label" title="5,574 values in 3,466 records">5,574 are the same number under another label/);
  assert.match(dbLead, /href="[^"]*#browse\?db=corrects" title="1,548 values in 1,443 records">1,548 correct a database/);
  assert.match(dbLead, /href="[^"]*#browse\?db=differs" title="1,051 values in 955 records">1,051 differ/);
  assert.match(dbLead, /href="[^"]*#browse\?db=not_listed" title="20,987 values in 14,002 records">20,987 are in none/);
  // The lead stands right under the part's heading, before its figures.
  assert.match(figures, /<span>Against the databases<\/span><\/h2>\s*<p class="stats-part-lead"/);
  // Each value against the databases: a 100% bar per parameter and for all, the thin counts right of each bar.
  const values = figureHtml("db-values");
  assert.match(values, /stats-wide/, "Alone in its pair (Why no database lists a value is not here yet), it takes the row");
  assert.deepEqual([...values.matchAll(/data-row="([^"]+)" data-count="(\d+)"/g)].map((match) => [match[1], Number(match[2])]),
    [["kcat", 41541], ["km", 48066], ["kcatkm", 37344], ["all", 126951]]);
  // Until Browse matches a compared parameter (dbpar), a parameter's counts are plain numbers: a link would open every
  // record with that result. All values links by result alone.
  assert.match(values, /data-row="kcat"[\s\S]*?stats-part-corrects" aria-hidden="true"><\/i>328<\/span><\/span><span class="stats-value-part" data-sizer="[^"]*"><span><i class="stats-swatch stats-part-differs" aria-hidden="true"><\/i>269<\/span><\/span>/);
  // The two counts beside each bar stand under their headings, Corrects and Differs (Table 8's names), each column as
  // wide as its widest count or its heading.
  assert.match(values, /<div class="stats-chart stats-chart-percent has-value-heads" data-chart="db-values"/);
  assert.match(values, /<div class="stats-chart-head" aria-hidden="true"><span class="stats-chart-value"><span class="stats-db-thin"><span class="stats-value-part" data-sizer="0,000&#10;Corrects"><span>Corrects<\/span><\/span><span class="stats-value-part" data-sizer="0,000&#10;Differs"><span>Differs<\/span><\/span><\/span><\/span><\/div>/);
  assert.match(styleSource, /\.stats-db-thin > \.stats-value-part\[data-sizer\]::before \{ padding-left:14px \}/);
  assert.match(values, /data-row="kcatkm"[\s\S]*?<small>printed<\/small>/);
  assert.match(values, /data-row="all"[\s\S]*?href="[^"]*#browse\?db=corrects" aria-label="All values, Corrects a value: 1,548">1,548<\/a>/);
  // Segments with a Browse filter open it (data-href); Same number has none.
  assert.match(values, /class="stats-seg stats-part-not-listed[^"]*"[^>]*data-tip="All values, Not in the databases: 20,987 \(16\.5%\)" data-href="[^"]*#browse\?db=not_listed"/);
  assert.match(values, /class="stats-seg stats-part-not-listed[^"]*"[^>]*data-tip="kcat, Not in the databases: 5,100 \(12\.3%\)"><\/span>/);
  assert.doesNotMatch(values, /stats-part-same[^"]*"[^>]*data-href/);
  assert.match(values, /<span class="visually-hidden">printed kcat\/Km: Same number 23,488 \(62\.9%\), Same, other label 1,449 \(3\.9%\), Corrects a value 839 \(2\.2%\), Different number 561 \(1\.5%\), Not in the databases 11,007 \(29\.5%\)\.<\/span>/);
  // The legend names link into Browse (Same number has no filter), each with its definition.
  assert.match(values, /<ul class="stats-legend">[\s\S]*?<span title="A database lists this number for this value\.">Same number<\/span>[\s\S]*?#browse\?db=other_label" title="A database lists this number for the paper under another substrate, variant or organism\.">Same, other label<\/a>/);
  assert.match(plain(values), /Figure \d+\. Values read from the paper, compared with BRENDA, SABIO-RK, OED, SKiD and STRENDA DB\./);
  // The numbers the databases list that match no value CatLog read: those CatLog has as a kcat/Km it calculated or
  // under another parameter are named apart (14,633 = 12,483 + 1,687 + 463). The README is named for the reasons only
  // when the snapshot has its comparison download (the README's section on the comparison comes with it).
  // A result, so it is said under the figure; the rule (calculated kcat/Km not compared) under How these numbers are
  // counted, under the figure's number.
  assert.match(values, /<\/figure><p class="stats-note">The databases also list 12,483 numbers for these papers that CatLog does not have, 1,687 that equal a <i>k<\/i><sub>cat<\/sub>\/<i>K<\/i><sub>m<\/sub> CatLog calculated and 463 that CatLog has under another parameter\.<\/p>/);
  assert.match(methodHtml(), /<dt>Figure \d+<\/dt><dd><span class="stats-method-title">Values against the databases\.<\/span> 5,946 kcat\/Km calculated by CatLog are not compared\.<\/dd>/);
  assert.doesNotMatch(values, /not compared|README/);
  assert.doesNotMatch(methodHtml(), /README|databases also list/);
  // Part 7's own rules, once.
  assert.match(methodHtml(), /<dt>Against the databases<\/dt><dd>Numbers are compared for the same paper and parameter\. Its papers are those with at least one compared value: fewer than the papers read when none of a paper&#39;s values could be compared\. Shares are given only on 1,000 values or more; below that, counts\.<\/dd>/);
  assert.equal(api.statsNotReproducedText({ not_reproduced: { distinct: { equals_catlog_calculated_ratio: 1, another_parameter_in_catlog: 0 } } }),
    "The databases also list 1 number for these papers that equals a kcat/Km CatLog calculated.");
  runtimeManifest.database_comparison_download = { path: "data/catlog-database-comparison.0123456789ab.csv.gz", rows: 10 };
  try {
    assert.equal(api.statsNotReproducedText({ not_reproduced: { distinct: { possible_catlog_miss: 1 } } }),
      "The databases also list 1 number for these papers that CatLog does not have; the README gives the reasons.");
  } finally {
    delete runtimeManifest.database_comparison_download;
  }
  assert.equal(api.statsNotReproducedText({ not_reproduced: { distinct: {} } }), "");
  assert.equal(api.statsNotReproducedText({ not_reproduced: { distinct: { possible_catlog_miss: 1.5 } } }), "");
  assert.match(values, /<dl class="stats-share-lines">[\s\S]*?82\.3%/);
  // Each database against the values read from its papers: a bar per database in order, its papers' values right of
  // it, the others under it; STRENDA DB by the Source filter's name.
  const bySource = figureHtml("db-sources");
  assert.deepEqual([...bySource.matchAll(/data-row="([^"]+)" data-count="(\d+)"/g)].map((match) => [match[1], Number(match[2])]),
    [["db_brenda", 101348], ["db_sabio_rk", 50411], ["db_oed", 74779], ["db_skid", 27849], ["db_strenda", 384]]);
  // A database's name never breaks across lines in part 7 ("SABIO-" / "RK", "STRENDA" / "DB" with a wide font).
  assert.match(bySource, /<span class="stats-chart-aside" aria-hidden="true">\+ 25,603 values from papers <span class="nowrap">BRENDA<\/span> does not list<\/span>/);
  assert.match(bySource, /<span class="stats-chart-label">STRENDA DB<\/span>/);
  // The number beside each bar is headed Values; the caption says what a bar covers and why a value counts more than once.
  assert.match(bySource, /<div class="stats-chart-head" aria-hidden="true"><span class="stats-chart-value has-parts"><span class="stats-value-part" data-sizer="[^"]*&#10;Values"><span>Values<\/span><\/span><\/span><\/div>/);
  assert.match(bySource, /data-row="db_brenda" data-count="101348"[\s\S]*?<span class="stats-chart-value has-parts"><span class="stats-value-part" data-sizer="[^"]*"><span>101,348<\/span><\/span><\/span>/);
  assert.match(plain(bySource), /Figure \d+\. Each bar covers only the values from papers that database lists\. A value counts for every database that lists its paper\./);
  assert.match(bySource, /STRENDA DB, Same number: 216"/, "No share on a base under 1,000 values");
  assert.match(bySource, /BRENDA, Same number: 63,927 \(63\.1%\)"/);
  assert.match(bySource, /BRENDA: Same number 63,927 \(63\.1%\),[^<]*; 25,603 values from papers it does not list\./);
  assert.doesNotMatch(bySource, /data-href/, "No database filter in Browse yet: no segment links");
  // The 1,000-value rule for shares is part 7's, said once under How these numbers are counted.
  assert.doesNotMatch(bySource + figureHtml("db-paired"), /Shares (are given )?only/);
  for (const part of ["not-listed", "not-listed-2", "not-listed-3"]) assert.match(bySource, new RegExp(`stats-swatch stats-part-${part}"`));
  // A database's own not-listed kinds in its own words, apart from the Why not listed labels (all the databases).
  assert.match(bySource, /BRENDA: [^<]*Lists other values only 5,433 \(5\.4%\), Lists none of this parameter 6,268 \(6\.2%\), Value in no database 18,746 \(18\.5%\);/);
  assert.doesNotMatch(bySource, /Other values listed|Parameter not listed|Value not listed/);
  // Beside it, the values each database pairs: same with its share, corrects and differs linking into Browse.
  const paired = figureHtml("db-paired");
  assert.match(paired, /<tr data-stat-key="db_brenda"><th scope="row"><span class="nowrap">BRENDA<\/span><small class="stats-db-paired-note">66,170 paired<\/small><\/th><td class="stats-num stats-db-paired-col" data-count="66170">66,170<\/td>\s*<td class="stats-num" data-count="63927">63,927<small>96\.6%<\/small><\/td><td class="stats-num" data-count="1156">1,156<small>1\.7%<\/small><\/td><td class="stats-num" data-count="1087">1,087<small>/);
  assert.match(paired, /<tr data-stat-key="db_strenda"><th scope="row"><span class="nowrap">STRENDA DB<\/span><small class="stats-db-paired-note">230 paired<\/small><\/th><td class="stats-num stats-db-paired-col" data-count="230">230<\/td>\s*<td class="stats-num" data-count="216">216<\/td>/);
  assert.match(paired, /<tfoot><tr data-stat-key="db_all"><th scope="row">All, each value once<small class="stats-db-paired-note">100,390 paired<\/small><\/th><td class="stats-num stats-db-paired-col" data-count="100390">100,390<\/td>\s*<td class="stats-num" data-count="97791">97,791<small>97\.4%<\/small><\/td><td class="stats-num" data-count="1548"><a class="stats-link" href="[^"]*#browse\?db=corrects" aria-label="All, corrects a value: 1,548">1,548<\/a><small>1\.5%<\/small><\/td><td class="stats-num" data-count="1051"><a[^>]*>1,051<\/a><small>1\.0%<\/small>/);
  assert.match(plain(paired), /A value is paired when a database lists a number for the same measurement\. A number copied into several databases counts for each \(SKiD derives from BRENDA\), but once in the All row\./);
  // How each correction was found: a bar per cause family, split checked against the paper / an exact factor found by
  // code (the causes code finds add up to corrections.by.code).
  const found = figureHtml("db-found");
  assert.deepEqual([...found.matchAll(/data-row="([^"]+)" data-count="(\d+)"/g)].map((match) => [match[1], Number(match[2])]),
    [["unit", 1320], ["decimal", 86], ["elsewhere", 51], ["misprint", 91]]);
  assert.match(found, /data-tip="Unit or scale, Checked against the paper: 428"[\s\S]*?data-tip="Unit or scale, Exact factor found by code: 892"/);
  assert.match(found, /<span class="visually-hidden">Unit or scale: 1,320 \(85\.3%\); checked against the paper 428, exact factor found by code 892\.<\/span>/);
  // A bar found both ways prints its two counts under its name, each after its colour; a bar found one way does not.
  assert.match(found, /data-row="unit"[^>]*>\s*<span class="stats-chart-label"><span title="[^"]*">Unit or scale<\/span><small><span class="stats-db-thin" aria-hidden="true"><span><i class="stats-swatch stats-part-corrects" aria-hidden="true"><\/i>428<\/span><span><i class="stats-swatch stats-part-corrects-2" aria-hidden="true"><\/i>892<\/span><\/span><\/small><\/span>/);
  assert.equal((found.match(/<small><span class="stats-db-thin"/g) || []).length, 1);
  assert.match(found, /<span title="A decimal point or exponent slip\.">Decimal slip<\/span>/);
  // Its title names both splits; the caption says each value counts once (Table 9 counts one per database).
  assert.match(found, /<h3 id="statsDbFoundTitle" class="stats-fig-title">Corrections by cause and how found<\/h3>/);
  assert.match(plain(found), /The 1,548 values that correct a database's number, each counted once\./);
  // Corrections by cause and database: the families by database, All counting each value once; on phones a line each.
  const causes = figureHtml("db-causes");
  assert.match(plain(causes.match(/<thead>[\s\S]*?<\/thead>/)[0]), /^Cause ?BRENDA ?SABIO-RK ?OED ?SKiD ?STRENDA DB ?All$/);
  assert.equal((causes.match(/<thead>[\s\S]*?<\/thead>/)[0].match(/<th scope="col" class="stats-num"><span class="nowrap">[^<]+<\/span><\/th>/g) || []).length, 6);
  assert.deepEqual([...causes.match(/<tr data-stat-key="cause_unit">[\s\S]*?<\/tr>/)[0].matchAll(/data-count="(\d+)"/g)].map((match) => Number(match[1])),
    [979, 325, 526, 123, 12, 1320]);
  assert.match(causes, /data-count="979">979<\/td>/);
  assert.match(causes, /<tr data-stat-key="cause_all">[\s\S]*?href="[^"]*#browse\?db=corrects" aria-label="All, all causes: 1,548">1,548<\/a>/);
  assert.match(causes, /data-stat-key="cause_decimal">[\s\S]*?data-count="0"><span class="stats-muted">0<\/span>/);
  assert.deepEqual([...causes.match(/<tr data-stat-key="cause_all">[\s\S]*?<\/tr>/)[0].matchAll(/data-count="(\d+)"/g)].map((match) => Number(match[1])),
    [1156, 368, 616, 130, 12, 1548]);
  assert.match(plain(causes.match(/<ul class="stats-db-blocks">[\s\S]*?<\/ul>/)[0].replace(/<\/li>/g, " ")), /^BRENDA: unit or scale 979 · decimal slip 85 · another number 46 · unit misprinted 46 SABIO-RK: unit or scale 325 · unit misprinted 43 /);
  // The earlier version's corrections, counted from this snapshot's Full data: on the records Corrected earlier finds.
  const earlier = figureHtml("earlier-corrections");
  assert.match(plain(earlier), /Values CatLog's earlier version changed to the paper's number, on the 2,881 records not yet re-read that list their changes\./);
  // Every part-7 caption is plain, and none repeats the caveat the lead says once.
  for (const caption of databaseSection().match(/<span class="stats-fig-caption">[\s\S]*?<\/span>(?=<\/figcaption>)/g)) assertPlainCaption(caption);
  assert.match(earlier, /<a class="stats-link" href="[^"]*#browse\?db=earlier">2,881 records not yet <span class="nowrap">re-read<\/span><\/a>/);
  assert.match(methodHtml(), /<span class="stats-method-title">Corrections on records not yet <span class="nowrap">re-read<\/span>\.<\/span> The value before the change equals a number a database lists for that paper for 2,601 of 3,635 changed values \(71\.6%\)\. These records also list 889 other changes\.<\/dd>/);
  assert.doesNotMatch(earlier, /Figure 1 counts/);
  // Pairs: each value alone (wide); each database beside the values it pairs; how found beside cause by database; the
  // earlier corrections beside the replaced entries.
  assert.deepEqual([...databaseSection().matchAll(/<section class="stats-section stats-figure-section( stats-wide)?[^"]*" aria-labelledby="[^"]+" data-figure="([^"]+)">/g)]
    .map((match) => `${match[2]}${match[1] ? " wide" : ""}`), ["db-values wide", "db-sources", "db-paired", "db-found", "db-causes", "earlier-corrections", "replaced"]);
  assert.match(figures, /<strong>Table \d+\.<\/strong> A value is paired when a database lists a number for the same measurement\./);
  assert.doesNotMatch(plain(databaseSection()), /\bv[12]\b|\bfive\b|independent|blind|claim/i);
  // A part-7 link never names an address key Browse does not match (it would open a wider list than its count).
  assert.doesNotMatch(databaseSection(), /db(?:src|why|par)=/);
  // Once Browse matches a database, a cause and a compared parameter, those counts link to exactly those values.
  const browseKeys = [...api.databaseRefineKeys];
  for (const key of ["dbsrc", "dbwhy", "dbpar"]) api.databaseRefineKeys.add(key);
  try {
    api.renderStats();
    const refined = (key) => figureHtml(key);
    assert.match(refined("db-values"), /data-row="kcat"[\s\S]*?href="[^"]*#browse\?db=corrects&amp;dbpar=kcat" aria-label="kcat, Corrects a value: 328">328<\/a>[\s\S]*?href="[^"]*#browse\?db=differs&amp;dbpar=kcat" aria-label="kcat, Different number: 269">269<\/a>/);
    assert.match(refined("db-values"), /data-row="kcatkm"[\s\S]*?<small>printed<\/small>[\s\S]*?#browse\?db=corrects&amp;dbpar=kcatkm/);
    assert.match(refined("db-values"), /class="stats-seg stats-part-not-listed[^"]*"[^>]*data-tip="kcat, Not in the databases: 5,100 \(12\.3%\)" data-href="[^"]*#browse\?db=not_listed&amp;dbpar=kcat"/);
    assert.match(refined("db-sources"), /data-href="[^"]*#browse\?db=corrects&amp;dbsrc=sabio_rk"/);
    assert.match(refined("db-paired"), /<td class="stats-num" data-count="1156"><a class="stats-link" href="[^"]*#browse\?db=corrects&amp;dbsrc=brenda" aria-label="BRENDA, corrects a value: 1,156">1,156<\/a><small>1\.7%<\/small><\/td>/);
    // A database's Different number (813 differs + 274 other numbers for BRENDA) and Same, other label count values
    // whose own result is another, which Browse's value-level filter would not show: plain numbers, in the table,
    // the bars and the legend, even then. The All row's Differs is one result and links.
    assert.doesNotMatch(databaseSection(), /db=(?:differs|other_label)&amp;dbsrc=/);
    assert.match(refined("db-paired"), /<td class="stats-num" data-count="1087">1,087<small>1\.6%<\/small><\/td>/);
    assert.match(refined("db-paired"), /<tfoot>[\s\S]*?href="[^"]*#browse\?db=differs" aria-label="All, different number: 1,051">1,051<\/a>/);
    assert.match(refined("db-sources"), /<ul class="stats-legend">[\s\S]*?<span title="[^"]*">Same, other label<\/span>[\s\S]*?#browse\?db=corrects"[^>]*>Corrects a value<\/a>[\s\S]*?<span title="[^"]*">Different number<\/span>/);
    assert.match(refined("db-found"), /href="[^"]*#browse\?db=corrects&amp;dbwhy=decimal" title="A decimal point or exponent slip\.">Decimal slip<\/a>/);
    assert.match(refined("db-causes"), /href="[^"]*#browse\?db=corrects&amp;dbsrc=brenda&amp;dbwhy=unit" aria-label="BRENDA, unit or scale: 979">979<\/a>/);
    // A key Browse still lacks keeps its counts plain: a database without a cause.
    api.databaseRefineKeys.delete("dbwhy");
    api.renderStats();
    assert.match(refined("db-paired"), /dbsrc=brenda" aria-label="BRENDA, corrects a value: 1,156"/);
    assert.match(refined("db-causes"), /data-count="979">979<\/td>/);
    assert.match(refined("db-causes"), /<tr data-stat-key="cause_all">[\s\S]*?dbsrc=brenda" aria-label="BRENDA, all causes: 1,156">1,156<\/a>/);
    assert.doesNotMatch(databaseSection(), /dbwhy=/);
  } finally {
    api.databaseRefineKeys.clear();
    for (const key of browseKeys) api.databaseRefineKeys.add(key);
    api.renderStats();
  }
  // Every cause code has a family: the bundle's, and the codes the CatLog side writes for a correction.
  for (const cause of [...Object.keys(databaseComparison().corrections.by_cause), "header_scale_inverted", "header_scale_ignored",
    "unit_not_converted", "uM_entered_as_mM", "mM_entered_as_uM", "time_unit", "decimal_or_exponent_slip", "value_from_other_row",
    "value_not_in_paper", "paper_unit_misprint", "recomputed_ratio", "power_of_ten", "printed_number_unit_not_applied", "time_factor"]) {
    assert.ok(["unit", "decimal", "elsewhere", "misprint"].includes(api.STATS_CAUSE_FAMILY[cause]), `${cause} has no cause family`);
  }
  // The comparison's own list of databases (C7) names and orders them, and gives Browse's key; a sixth joins anywhere.
  runtimeManifest.summary.database_comparison = { ...databaseComparison(), sources: [
    { key: "uniprot", name: "UniProt", display: "UniProt" }, { key: "brenda", name: "BRENDA", display: "BRENDA" },
    { key: "strenda", name: "STRENDA", display: "STRENDA DB" }] };
  runtimeManifest.summary.database_comparison.values_by_database.UniProt = { same: 10, value_absent: 3, paper_absent: 126938 };
  api.renderStats();
  assert.deepEqual([...figureHtml("db-sources").matchAll(/data-row="([^"]+)"/g)].map((match) => match[1]), ["db_uniprot", "db_brenda", "db_strenda"]);
  assert.match(plain(figureHtml("db-values")), /compared with UniProt, BRENDA and STRENDA DB\./);
  assert.match(figureHtml("db-causes"), /<th scope="col" class="stats-num"><span class="nowrap">UniProt<\/span><\/th>[\s\S]*?data-count="0"><span class="stats-muted">0<\/span>/);
  assert.doesNotMatch(figureHtml("db-sources"), /lists none of these papers/);
  // A database that lists none of the papers read is named under the figure and the table, not given an empty bar or a
  // column of zeros.
  runtimeManifest.summary.database_comparison.values_by_database.UniProt = { paper_absent: 126951 };
  api.renderStats();
  assert.deepEqual([...figureHtml("db-sources").matchAll(/data-row="([^"]+)"/g)].map((match) => match[1]), ["db_brenda", "db_strenda"]);
  assert.match(figureHtml("db-sources"), /<\/figure><p class="stats-note">UniProt lists none of these papers\.<\/p><\/section>/);
  assert.doesNotMatch(figureHtml("db-causes"), /UniProt<\/span><\/th>/);
  assert.match(figureHtml("db-causes"), /<\/figure><p class="stats-note">UniProt lists none of these papers\.<\/p><\/section>/);
  assert.doesNotMatch(methodHtml(), /lists none of these papers/);
  runtimeManifest.summary.database_comparison.values_by_database.SKiD = { paper_absent: 126951 };
  runtimeManifest.summary.database_comparison.sources.push({ key: "skid", name: "SKiD", display: "SKiD" });
  api.renderStats();
  assert.match(figureHtml("db-sources"), /<p class="stats-note">UniProt and SKiD list none of these papers\.<\/p>/);
  // Without that list, a database the counts name that the page does not know is drawn after the known ones by its own name.
  runtimeManifest.summary.database_comparison = databaseComparison();
  runtimeManifest.summary.database_comparison.values_by_database = { "Some DB": { same: 5, paper_absent: 1 }, ...databaseComparison().values_by_database };
  assert.equal(JSON.stringify(api.statsDatabaseSources(runtimeManifest.summary.database_comparison).map((source) => [source.key, source.display])),
    JSON.stringify([["brenda", "BRENDA"], ["sabio_rk", "SABIO-RK"], ["oed", "OED"], ["skid", "SKiD"], ["strenda", "STRENDA DB"], ["some_db", "Some DB"]]));
  // Stats, the Guide, Browse's "?" and a record's footer read one list (comparedDatabases): a comparison that neither lists
  // nor counts its databases names the six; none without a comparison; a listed database keeps its version, date and rows.
  assert.deepEqual([...api.statsDatabaseSources({ values: {} })].map((source) => source.display), ["BRENDA", "SABIO-RK", "OED", "SKiD", "STRENDA DB", "UniProt"]);
  assert.equal(api.statsDatabaseSources(null).length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(api.statsDatabaseSources({ sources: [{ key: "strenda_db", name: "STRENDA DB", version: "2026-10-07", rows: 898 }, "UniProt"] }))),
    [{ key: "strenda", name: "STRENDA DB", display: "STRENDA DB", version: "2026-10-07", rows: 898 }, { key: "uniprot", name: "UniProt", display: "UniProt" }]);
  assert.deepEqual([...api.guideDatabaseSources({ values: {} })].map((source) => source.name), [...api.statsDatabaseSources({ values: {} })].map((source) => source.display));
  // Each figure needs its own keys; a damaged count drops that figure (and the lead with the values), never shows an
  // empty heading.
  const withOut = (change) => {
    const data = databaseComparison();
    change(data);
    runtimeManifest.summary.database_comparison = data;
    api.renderStats();
    return [...databaseSection().matchAll(/data-figure="([^"]+)"/g)].map((match) => match[1]);
  };
  assert.deepEqual(withOut((data) => { data.values.kcat.confirmed = "34186"; }), ["db-sources", "db-paired", "db-found", "db-causes", "earlier-corrections", "replaced"]);
  // Without the values' counts there is no lead, but the figures that compare values still get the caveat once.
  assert.equal(plain(databaseSection().match(/<p class="stats-part-lead"[\s\S]*?<\/p>/)[0]),
    "A different number can mean a different measurement; it does not by itself mean a database is wrong.");
  assert.deepEqual(withOut((data) => { data.values.all.confirmed += 1; }).slice(0, 2), ["db-sources", "db-paired"], "Parameters that do not add up to all");
  assert.deepEqual(withOut((data) => { delete data.values_by_database; }), ["db-values", "db-found", "db-causes", "earlier-corrections", "replaced"]);
  assert.deepEqual(withOut((data) => { delete data.corrections.by_cause_database; }), ["db-values", "db-sources", "db-paired", "db-found", "earlier-corrections", "replaced"]);
  assert.match(figureHtml("db-found"), /stats-wide/);
  assert.deepEqual(withOut((data) => { data.corrections.values = 1549; }), ["db-values", "db-sources", "db-paired", "earlier-corrections", "replaced"], "Causes that do not add up to the corrections");
  // Without corrections.by, or when the causes code finds do not add up to its code count, the bars are not split and
  // How these numbers are counted gives the two counts; a cause with no family is counted apart.
  withOut((data) => { delete data.corrections.by; });
  assert.doesNotMatch(figureHtml("db-found"), /Exact factor found by code|checked against the paper/);
  withOut((data) => { data.corrections.by = { code: 900, paper_check: 648 }; });
  assert.match(methodHtml(), /648 checked against the paper; for 900 code found an exact factor\./);
  assert.doesNotMatch(figureHtml("db-found"), /<ul class="stats-legend">/);
  withOut((data) => { data.corrections.by_cause.new_cause = 2; data.corrections.by_cause.time_unit -= 2; });
  assert.match(methodHtml(), /<span class="stats-method-title">Corrections by cause\.<\/span> [^<]*2 corrections have causes not named here\.<\/dd>/);
  assert.match(methodHtml(), /<span class="stats-method-title">Corrections by cause and database\.<\/span> 2 corrections have causes not named here\. All causes counts them\.<\/dd>/);
  // An older comparison counts its factor-only values (an exact factor nothing has yet checked) among the corrections:
  // the lead counts them under Different number, a note after it says the figures still hold them under Corrects,
  // Figure 10 and the All column take them out of their causes (the per-database columns keep them, said in the rule).
  withOut((data) => { data.corrections.by_cause_found_by = { power_of_ten: { factor_cross_checked: 300, factor_only: 257 }, unit_not_converted: { paper_check: 126 } }; });
  assert.match(plain(databaseSection().match(/<p class="stats-part-lead"[\s\S]*?<\/p>/)[0]),
    /Another 1,291 correct a database's number \(126 checked against the paper\), and 1,308 differ, cause not yet known \(257 by an exact factor, not yet checked\)\. A different number can mean/);
  assert.match(plain(databaseSection().match(/<p class="stats-note stats-part-note">[\s\S]*?<\/p>/)[0]),
    /^In this snapshot's figures and tables, 257 values a database lists at an exact factor from the paper's number, not yet checked against the paper, still stand under Corrects; the lead and the Guide count them under Different number \(exact factor, not yet checked\)\.$/);
  assert.deepEqual([...figureHtml("db-found").matchAll(/data-row="([^"]+)" data-count="(\d+)"/g)].map((match) => [match[1], Number(match[2])]),
    [["unit", 1063], ["decimal", 86], ["elsewhere", 51], ["misprint", 91]]);
  assert.match(figureHtml("db-found"), /data-tip="Unit or scale, Exact factor found by code: 635"/);
  assert.match(plain(figureHtml("db-found")), /The 1,291 values that correct a database's number, each counted once\./);
  assert.match(methodHtml(), /Corrections by cause and database\.<\/span> 257 values a database lists at an exact factor, not yet checked against the paper, are Different number, left out of All; the columns per database still hold them\.<\/dd>/);
  // A comparison that counts them under Different number itself (a status of their own): in the Differs segment, no
  // move and no note.
  withOut((data) => { data.values.kcat.differs_factor_only = 40; data.values.all.differs_factor_only = 40; data.values.all.differs += 0; });
  assert.match(plain(databaseSection().match(/<p class="stats-part-lead"[\s\S]*?<\/p>/)[0]), /Another 1,548 correct a database's number \(656 checked against the paper\), and 1,091 differ, cause not yet known \(40 by an exact factor, not yet checked\)\./);
  assert.doesNotMatch(databaseSection(), /stats-part-note/);
  assert.match(figureHtml("db-values"), /kcat, Different number: 309 \(0\.7%\)"/);
  // Small counts: no shares on a base under 1,000 values, counts under the bars, singular words.
  runtimeManifest.summary.database_comparison = { values: { kcat: { confirmed: 1, corrected: 1, new: 2 }, Km: { confirmed: 3, differs: 1 } }, papers: 1 };
  api.renderStats();
  assert.equal(plain(databaseSection().match(/<p class="stats-part-lead"[\s\S]*?<\/p>/)[0]),
    "CatLog compared 8 values read from 1 paper with what the databases list for the same paper. Of these, 4 are the number a database lists. Another 1 corrects a database's number and 1 differs, cause not yet known. A different number can mean a different measurement; it does not by itself mean a database is wrong. The remaining 2 are in none of the databases. Where a database lists a number for the same measurement (6 values), 4 of those numbers are the paper's.");
  assert.doesNotMatch(databaseSection().match(/<p class="stats-part-lead"[\s\S]*?<\/p>/)[0], /title=/, "No record counts, no titles");
  runtimeManifest.summary.database_comparison.records_with_kind = { corrected: 1, differs: "1" };
  api.renderStats();
  assert.match(databaseSection(), /#browse\?db=corrects" title="1 value in 1 record">1 corrects/);
  assert.match(databaseSection(), /#browse\?db=differs">1 differs/, "A damaged record count gives no title");
  assert.match(figureHtml("db-values"), /<dt>All values<\/dt><dd><span><i class="stats-swatch stats-part-same" aria-hidden="true"><\/i>4<\/span>/);
  assert.doesNotMatch(figureHtml("db-values"), /\(\d+\.\d%\)/);
  // Without overview.earlier_corrections, quality's count (another snapshot's) is used, with its own caption.
  delete runtimeManifest.summary.database_comparison;
  runtimeManifest.summary.overview = { ...overview, quality: {
    earlier_corrections: { records: 5, values: { kcat: { rounding: 1, different: 2, magnitude: 0, added: 1 } }, before_listed: [3, 4] },
    replaced: { records: 7, accepted: 2, papers: 1, values: { kcat: [5, 6], km: [2, 2] } } } };
  api.renderStats();
  figures = element("statsCharts").innerHTML;
  assert.deepEqual(headings().slice(-2), ["Corrections on records not yet re-read", "Entries replaced by reading the paper"]);
  assert.equal(partTitles().at(-1), "7 Against the databases");
  assert.doesNotMatch(figures, /stats-part-lead/);
  assert.match(figures, /<strong>Figure 6\.<\/strong> Values the earlier review changed/);
  assert.match(figures, /for 3 of 4 changed values \(75\.0%\)/);
  assert.match(figures, /The 7 entries from the earlier version \(2 accepted\) on the 1 paper CatLog has since read, by whether CatLog found the same number for that paper and parameter\./);
  assert.match(figures, /When CatLog reads a paper, its records replace these entries\./);
  assert.doesNotMatch(figures.replace(/<[^>]*>/g, " "), /\bv[12]\b/);
  // Figure 4 counted for another snapshot names both counts of records accepted after a correction (figure 1 has the
  // snapshot's own); with the same count it names one.
  const correctedNow = runtimeManifest.summary.distributions.verification_status.find((item) => item.label === "corrected")?.count;
  assert.ok(Number.isInteger(correctedNow) && correctedNow !== 5);
  assert.match(figures, new RegExp(`changed to the paper's number, on the 5 records accepted after a correction when counted; Figure 1 counts ${correctedNow} in this snapshot\\.`));
  runtimeManifest.summary.overview = { ...overview, quality: { as_of: "2026-10-12", earlier_corrections: { records: correctedNow,
    values: { kcat: { rounding: 1, different: 2, magnitude: 0, added: 1 } } } } };
  api.renderStats();
  assert.match(element("statsCharts").innerHTML, new RegExp(`on the ${correctedNow} records? accepted after a correction\\.`));
  assert.match(element("statsCharts").innerHTML, /stats-wide[^"]*" aria-labelledby="statsCorrectionsTitle"/, "Without its pair it takes the row");
  runtimeManifest.summary.overview = { ...overview, quality: { as_of: "2026-10-12", earlier_corrections: { records: correctedNow + 1,
    values: { kcat: { rounding: 1, different: 2, magnitude: 0, added: 1 } } } } };
  api.renderStats();
  assert.match(element("statsCharts").innerHTML, /accepted after a correction when counted \(Oct 12, 2026\); Figure 1 counts \d+ in this snapshot\./);
  // A figure whose counts are not whole numbers is not drawn, and part 7 without figures has no heading.
  runtimeManifest.summary.overview = { ...overview, quality: { db_compare: { kcat: { same: 9, differs: 1, absent: 0 } },
    replaced: { records: 7, values: { kcat: [8, 6] } } } };
  api.renderStats();
  assert.doesNotMatch(element("statsCharts").innerHTML, /against the databases|Against the databases|Entries replaced/);
  // The match is the lead's (and the Guide lead's) side line; the Guide's Human review item adds nothing for it.
  assert.equal(api.humanComparisonText({ quality: { v2_approved_total: 4, v2_found: 3 } }), "");
  assert.equal(api.v2MatchSentence(api.v2MatchFacts({ v2_approved_total: 4, v2_found: 3, v2_wrong: 1 })),
    "Where CatLog has re-read a paper the reviewers checked, its value matches the approved value for 3 of 4 (75.0%). Of the other 1, 1 is a CatLog value found wrong.");
  // quality.agreement's counts come first; differ_catlog_wrong, else catlog_value_wrong, is the wrong values found.
  assert.equal(api.v2MatchSentence(api.v2MatchFacts({ v2_approved_total: 4, v2_found: 3, v2_wrong: 1,
    agreement: { papers_compared: 1, values_approved: 10, agree: 9, catlog_value_wrong: 0 } })),
    "Where CatLog has re-read a paper the reviewers checked, its value matches the approved value for 9 of 10 (90.0%). None of the other 1 is a CatLog value found wrong.");
  assert.equal(api.v2MatchSentence(api.v2MatchFacts({ agreement: { papers_compared: 1, values_approved: 10, agree: 9 } })),
    "Where CatLog has re-read a paper the reviewers checked, its value matches the approved value for 9 of 10 (90.0%).");
  // The kinds of the other values are said only when they add up to them (with the wrong values found), each kind
  // that counts, in the user's order.
  assert.equal(api.v2MatchSentence(api.v2MatchFacts({ agreement: { values_approved: 20, agree: 10, differ_same_value_other_name: 4,
    differ_catlog_right: 0, differ_rounding: 1, differ_not_comparable: 2, differ_not_adjudicated: 2, differ_catlog_wrong: 1 } })),
    "Where CatLog has re-read a paper the reviewers checked, its value matches the approved value for 10 of 20 (50.0%). Of the other 10, 4 are the same value under another name, 1 differs by rounding, 2 cannot be compared and 2 are not yet checked; 1 is a CatLog value found wrong.");
  assert.equal(api.v2MatchSentence(api.v2MatchFacts({ agreement: { values_approved: 20, agree: 10, differ_same_value_other_name: 4,
    differ_catlog_right: 0, differ_rounding: 1, differ_not_comparable: 2, differ_not_adjudicated: 9, differ_catlog_wrong: 0 } })),
    "Where CatLog has re-read a paper the reviewers checked, its value matches the approved value for 10 of 20 (50.0%). None of the other 10 is a CatLog value found wrong.");
  assert.equal(api.v2MatchSentence(api.v2MatchFacts({ agreement: { values_approved: 20, agree: 20, differ_catlog_wrong: 0 } })),
    "Where CatLog has re-read a paper the reviewers checked, its value matches the approved value for 20 of 20 (100.0%).");
  assert.equal(api.humanComparisonText({ quality: { compared_values_v1: 1000, wrong_v1: 0, label_or_annotation_v1: 0 } }),
    "In entries from the earlier version, 0 of 1,000 values reviewers compared had a wrong number or unit (100.0% correct), and 0 had a wrong enzyme, organism, substrate, variant or protein label.");
  runtimeManifest.summary.overview = overview;
  api.renderStats();
  assert.match(chart, /#browse\?ec=1\.">EC 1/);
  assert.match(chart, /#browse\?ec=1\.1\.1\.1"/);
  assert.match(chart, /#browse\?organism=Homo\+sapiens"><i>Homo sapiens<\/i>/);
  assert.match(chart, /&lt;b&gt;Escherichia&lt;\/b&gt; coli/, "Names from the data are escaped");
  assert.match(chart, /#browse\?variant=wild">Wild type/);
  assert.match(chart, /#browse\?caution=differs"/);
  assert.match(chart, /#browse\?caution=none">No cautions/);
  assert.match(chart, /data-stat-key="source_catlog" data-count="2"[\s\S]*?#browse\?source=paper">Read from the paper<\/a>/);
  assert.doesNotMatch(chart, /source_paper_earlier/, "No earlier paper extractions here");
  assert.doesNotMatch(chart, /source=other/, "Other has no single Browse filter");
  assert.doesNotMatch(chart + element("statsTotals").innerHTML, /earlier catalog|old catalog/i, "Records are named by what happened to them");
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
  // Enzyme classes name their value columns in a heading line (Records, Accepted), each column, the first too, sized to
  // its heading and its entries, so the heading stands right-aligned over its numbers.
  assert.match(chart, /<div class="stats-chart has-value-heads" data-chart="ec-classes"/);
  assert.match(chart, /<div class="stats-chart-head" aria-hidden="true"><span class="stats-chart-value has-parts"><span class="stats-value-part" data-sizer="0&#10;Records"><span>Records<\/span><\/span><span class="stats-value-part" data-sizer="0&#10;Accepted"><span>Accepted<\/span><\/span><\/span><\/div>/);
  assert.match(chart, /data-stat-key="ec_1" data-count="4"[\s\S]*?<span class="stats-chart-value has-parts"><span class="stats-value-part" data-sizer="0&#10;Records"><span>4<\/span><\/span><span class="stats-value-part stats-muted" data-sizer="0&#10;Accepted"><span>2<\/span><\/span><\/span>/);
  assert.equal((chart.match(/<figure class="stats-range"/g) || []).length, 1, "Only metrics with a usable summary get a histogram");
  assert.match(chart, /aria-label="kcat: median 4\.5 s⁻¹; 10% of values are below 0\.036 and 10% above 240; 5 values\."/);
  assert.equal((chart.match(/class="stats-histogram-bars">/g) || []).length, 1);
  assert.match(chart, /How these numbers are counted/);
  assert.doesNotMatch(chart, /NaN|Infinity|undefined/);

  // More from the overview when the snapshot counts it: the records read from the paper per enzyme class, the most common
  // organisms and EC numbers among them (linked with source=paper), values per paper, and values per enzyme class as
  // small multiples on one half-decade grid per metric.
  {
    const kcatClasses = { log10_start: -1, bin_width: 0.5, classes: [
      { class: 1, n: 3, median: 2, p10: 0.5, p90: 9, counts: [0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0] },
      { class: 3, n: 1, median: 4.5, p10: 4.5, p90: 4.5, counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1] }] };
    runtimeManifest.summary.overview = { ...overview,
      ec_classes: [{ class: 1, name: "Oxidoreductases", count: 4, accepted: 2, from_paper: 2 }, { class: 3, name: "Hydrolases", count: 2, accepted: 1, from_paper: 0 }],
      top_organisms_from_paper: [{ name: "Homo sapiens", count: 2 }], top_ec_from_paper: [{ ec: "1.1.1.1", name: "alcohol dehydrogenase", count: 2 }],
      from_paper_values: { values: 5, bins: [1, 2, 5, 10], papers: [0, 1, 0, 0] },
      metrics: { kcat: { ...overview.metrics.kcat, by_class: kcatClasses } } };
    api.renderStats();
    const more = element("statsCharts").innerHTML;
    assert.match(more, /<div class="stats-chart-head" aria-hidden="true"><span class="stats-chart-value has-parts"><span class="stats-value-part" data-sizer="0&#10;Records"><span>Records<\/span><\/span><span class="stats-value-part" data-sizer="0&#10;Accepted"><span>Accepted<\/span><\/span><span class="stats-value-part" data-sizer="0&#10;From paper" data-sizer-narrow="0&#10;From&#10;paper"><span>From paper<\/span><\/span><\/span><\/div>/);
    // Below 360px From paper takes one word per line (data-sizer-narrow), so its column needs only its longest word or
    // count and the class names keep their room; one-word headings need no second sizer.
    assert.doesNotMatch(more, /data-sizer-narrow="0&#10;(?:Records|Accepted)"/);
    assert.match(styleSource, /@media \(max-width: 359px\) \{(?:[^{}]*\{[^{}]*\})*?[^{}]*\.stats-value-part\[data-sizer-narrow\]::before \{ content:attr\(data-sizer-narrow\) \}/);
    assert.match(more, /data-stat-key="ec_1" data-count="4"[\s\S]*?<span class="stats-chart-value has-parts"><span class="stats-value-part" data-sizer="0&#10;Records"><span>4<\/span><\/span><span class="stats-value-part stats-muted" data-sizer="0&#10;Accepted"><span>2<\/span><\/span><span class="stats-value-part stats-v2-count" data-sizer="0&#10;From paper" data-sizer-narrow="0&#10;From&#10;paper"><span>2<\/span><\/span><\/span>/);
    assert.match(more, /stats-part-catlog-mark is-start is-end" style="left:0%;width:[\d.]+%" data-tip="EC 1: 2 read from the paper \(50\.0%\)"/);
    assert.match(more, /<i class="stats-swatch stats-part-catlog-mark" aria-hidden="true"><\/i><span>Read from the paper<\/span><\/li>/);
    assert.match(more, /<h3 id="statsV2OrganismsTitle" class="stats-fig-title">Most common organisms among records read from the paper<\/h3>[\s\S]*?<th scope="col" class="stats-num">Records<\/th>[\s\S]*?#browse\?source=paper&amp;organism=Homo\+sapiens"><i>Homo sapiens<\/i>[\s\S]*?100\.0%/);
    assert.match(more, /#browse\?source=paper&amp;ec=1\.1\.1\.1"><span class="stats-ec-number">1\.1\.1\.1<\/span> alcohol dehydrogenase/);
    // An EC number in a table carries no class colour (the bars beside it wear other meanings).
    assert.match(more, /<span class="stats-name"><span><a class="stats-link" href="[^"]*#browse\?source=paper&amp;ec=1\.1\.1\.1">/);
    // Values read from each paper: rows from the first bin to the last one with papers; shares of the papers CatLog read.
    assert.match(more, /<h3 id="statsPerPaperTitle" class="stats-fig-title">Values per paper<\/h3>/);
    assert.match(more, /<strong>Figure 4\.<\/strong> The 1 paper CatLog has read, by the number of kcat, Km and kcat\/Km values read from each\./);
    assert.doesNotMatch(more.replace(/<[^>]*>/g, " "), /\bv[12]\b|Entries/, "CatLog is the one name");
    assert.deepEqual([...more.matchAll(/data-row="(values_\d+)" data-count="(\d+)"/g)].map((match) => `${match[1]}:${match[2]}`), ["values_1:0", "values_2:1"]);
    assert.match(more, /<span class="stats-chart-label">2–4<\/span>/);
    // Its columns are named above the bars (Papers, % of papers); its counting rule is said once, at the end.
    assert.match(more, /data-chart="values-per-paper"[\s\S]*?<span>Papers<\/span><\/span><span class="stats-value-part"[^>]*><span>% of papers<\/span>/);
    assert.match(more, /<span class="stats-method-title">Values per paper\.<\/span> \d[\d,]* kcat, Km and kcat\/Km values from 1 paper\. A kcat\/Km calculated from kcat and Km is not counted\./);
    // Its screen reader's lines and tooltips say one value and one paper in the singular.
    assert.match(more, /1 value: 0 papers\./);
    assert.match(more, /2–4 values: 1 paper\./);
    assert.match(more, /data-tip="2–4 values: 1 paper \(100\.0%\)"/);
    assert.doesNotMatch(more, /\b1 values: /);
    // Values by enzyme class: a ridge per class, its median dot and 10–90% line, a link to the class in Browse.
    assert.match(more, /<h3 id="statsClassValuesTitle" class="stats-fig-title">Values by enzyme class<\/h3>/);
    assert.equal((more.match(/<li class="stats-ridge-row[ "]/g) || []).length, 2);
    // A class with fewer than 300 values is drawn lighter and dashed (is-few), and the caption's second sentence says so,
    // with the hatched stub where an end bin holds values; the bins and end-bin rule are said under How these numbers are
    // counted.
    assert.match(more, /<li class="stats-ridge-row is-few stats-ec-1" data-hl="ec_1" data-class="1" data-count="3" data-tip="EC 1 Oxidoreductases, kcat: 3 values; median 2\.0 s⁻¹; 10–90% 0\.5–9 s⁻¹\. The link lists every EC 1 record with a kcat, in any unit\.">/);
    assert.match(more, /<span class="stats-method-title">Values by enzyme class\.<\/span> Each curve runs through half-decade bins on a log scale, and n is the class&#39;s number of values\. A record in several classes counts in each\. The two end bins also hold every value beyond them, so the curve leaves them out; the tooltip line gives their counts\./);
    assert.match(more, /<strong>Figure 7\.<\/strong> One curve per enzyme class, each scaled to its own peak, with the median \(dot\) and the middle 80% of values \(line\)\. A hatched stub at either end marks the values beyond the curve; a lighter, dashed curve has fewer than 300 values\.<\/span>/);
    assert.doesNotMatch(methodHtml(), /dashed|hatched/);
    // Each class's number of values in a muted n column after the median, sized in ch to the longest count.
    assert.match(more, /<span class="stats-ridges-head">Median<\/span><span class="stats-ridges-head">n<\/span><\/p>/);
    assert.deepEqual([...more.matchAll(/<span class="stats-ridge-n">([^<]+)<\/span>/g)].map((match) => match[1]), ["3", "1"]);
    assert.match(more, /data-metric="kcat" style="--ridge-n:calc\(1ch \+ 4px\)"/);
    assert.match(more, /<svg class="stats-ridge-svg" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="EC 3 Hydrolases, kcat: 1 values; median 4\.5 s⁻¹/);
    // Each class's ridge is drawn in its class colour (--ec-N, the row's stats-ec-N), the fill from its own gradient, and
    // a short bar of that colour stands before the class's number.
    assert.match(more, /fill:url\(#statsRidgeFill-kcat-1\)/);
    assert.match(more, /<linearGradient id="statsRidgeFill-kcat-1" class="stats-ec-1"/);
    assert.match(more, /<linearGradient id="statsRidgeFill-kcat-3" class="stats-ec-3"/);
    assert.match(more, /<span class="stats-ridge-label"><i class="stats-ec-key stats-ec-1" aria-hidden="true"><\/i><a class="stats-link"/);
    // Enzyme classes (Figure 5) carries no class colour: its bars wear review-result and Read from the paper colours.
    assert.match(more, /<span class="stats-ec-label" data-stat-key="ec_1" data-count="4"><a /);
    assert.doesNotMatch(more.slice(more.indexOf('data-figure="ec-classes"'), more.indexOf('data-figure="ec-classes"') + 4000), /stats-ec-key/);
    for (let number = 1; number <= 7; number += 1) assert.match(styleSource, new RegExp(`\\.stats-ec-${number} \\{ --part:var\\(--ec-${number}\\) \\}`));
    // the median of class 1 (2 s⁻¹ = 10^0.301) on a 7-decade grid from 10^-1: (0.301 + 1) / 7
    assert.match(more, new RegExp(`<i class="stats-ridge-median" style="left:${+((Math.log10(2) + 1) / 7 * 100).toFixed(3)}%"></i>`));
    // Value ranges and Values by enzyme class share one axis per parameter: the whole decades around the class grid
    // (10⁻¹ to 10⁶ here), with the same ticks, and the histogram in the class panels' columns (the same n column width).
    // Its bars beyond that axis join its end bars: 1 below 10⁻¹ and 0 in 10⁻¹-10⁰ make the first bar (below 10⁰).
    assert.match(more, /<figure class="stats-range" data-metric="kcat" data-count="5" style="--ridge-n:calc\(1ch \+ 4px\)">[\s\S]*?<div class="stats-range-plot"><div class="stats-histogram"/);
    const bars = more.match(/<div class="stats-histogram-bars">([\s\S]*?)<\/div>/)[1];
    assert.deepEqual([...bars.matchAll(/height:([\d.]+)%/g)].map((match) => Number(match[1])), [50, 100, 50, 50, 0, 0, 0]);
    assert.match(bars, /data-tip="below 10⁰ s⁻¹: 1 values"/);
    assert.match(bars, /<span style="height:0%" data-tip="10⁵ and above s⁻¹: 0 values"><\/span>$/);
    const histogramTicks = more.match(/<div class="stats-histogram-axis" aria-hidden="true">([\s\S]*?)<\/div>/)[1];
    assert.equal(histogramTicks, more.match(/<span class="stats-ridge-ticks">([\s\S]*?)<\/span><span><\/span><span><\/span><\/div>/)[1]);
    assert.equal(histogramTicks, api.statsDecadeTicks(-1, 6));
    // The class's link opens its records with the panel's parameter (in any unit, so Browse can count more than n).
    assert.match(more, /#browse\?ec=1\.&amp;metric=kcat">EC 1<\/a><span class="stats-ridge-name"> Oxidoreductases<\/span>/);
    // The median column reads evenly: two significant figures, the same in the tooltip line and the accessible text.
    assert.deepEqual([...more.matchAll(/<span class="stats-ridge-value">([^<]+)<\/span>/g)].map((match) => match[1]), ["2.0", "4.5"]);
    assert.match(more, /aria-label="EC 1 Oxidoreductases, kcat: 3 values; median 2\.0 s⁻¹;/);
    // The end bins hold every value beyond the grid: the curve covers the inner bins only (here bins 1-12 of 14, from
    // 7.143% to 92.857%), a class with values in an end bin gets a hatched stub there with the count in its tooltip line,
    // and its summary says so; class 1 has none in its end bins, so no stub and its curve falls to the baseline.
    assert.match(more, /data-class="1"[^>]*>[\s\S]*?<path class="stats-ridge-area" style="fill:url\(#statsRidgeFill-kcat-1\)" d="M7\.14 40C[^"]*L92\.857 40L7\.143 40Z"\/>/);
    assert.doesNotMatch(more.split('data-class="3"')[0], /stats-ridge-end/);
    assert.match(more, /<i class="stats-ridge-end" style="left:92\.857%;width:7\.143%" data-tip="EC 3 Hydrolases, kcat 10⁵·⁵ s⁻¹ and above: 1 values \(end bin, not in the curve\)"><\/i>/);
    assert.match(more, /aria-label="EC 3 Hydrolases, kcat: 1 values; [^"]*; in the end bins, not in the curve: 1 at 10⁵·⁵ s⁻¹ and above\."/);
    {
      // A pile in an end bin neither sets the scale nor draws a peak: the inner bins' highest count (4) is the ridge's
      // peak (y 4), and the curve is cut off level at both ends, where values lie beyond (left at 2 of 4: y 22).
      const piled = api.statsRidgeFigure({ ec_classes: [{ class: 4, name: "Lyases" }], metrics: { kcat: { by_class: { log10_start: 0, bin_width: 0.5,
        classes: [{ class: 4, n: 111, median: 3, p10: 1, p90: 1000, counts: [5, 2, 4, 100] }] } } } });
      const area = piled.body.match(/class="stats-ridge-area"[^>]* d="([^"]+)"/)[1];
      assert.match(area, /^M25 22C/);
      assert.match(area, /C[^C]* 75 4L75 40L25 40Z$/);
      const ys = [...area.matchAll(/-?[\d.]+ (-?[\d.]+)/g)].map((match) => Number(match[1]));
      assert.ok(Math.min(...ys) >= 4 - 1e-9, area);
      assert.match(piled.body, /data-tip="EC 4 Lyases, kcat below 10⁰·⁵ s⁻¹: 5 values \(end bin, not in the curve\)"/);
      assert.match(piled.body, /data-tip="EC 4 Lyases, kcat 10¹·⁵ s⁻¹ and above: 100 values \(end bin, not in the curve\)"/);
      assert.match(piled.rules, /The two end bins also hold every value beyond them, so the curve leaves them out; the tooltip line gives their counts\./);
      assert.match(piled.caption, /\(line\)\. A hatched stub at either end marks the values beyond the curve; a lighter, dashed curve has fewer than 300 values\.$/);
      assert.equal(piled.data, undefined, "No data line under the figure");
      // 300 values or more: drawn in full, n with thousands separators, no word about lighter curves.
      const full = api.statsRidgeFigure({ metrics: { km: { by_class: { log10_start: 0, bin_width: 0.5,
        classes: [{ class: 2, n: 18789, median: 3, p10: 1, p90: 10, counts: [0, 9000, 9789, 0] }] } } } });
      assert.match(full.body, /<li class="stats-ridge-row stats-ec-2" data-hl="ec_2"/);
      assert.match(full.body, /<span class="stats-ridge-n">18,789<\/span>/);
      assert.match(full.body, /style="--ridge-n:calc\(6ch \+ 4px\)"/);
      assert.doesNotMatch(full.rules + full.caption, /lighter|hatched/, "No end-bin values and no small class: the caption has one sentence");
    }
    // A count chart's value column fits its longest entry per number column, here each column's heading (Records,
    // Accepted, From paper), in ch (a wider font widens it), with 6px between the columns, at least 96px.
    assert.match(more, /data-chart="ec-classes" style="--value-w:max\(96px, calc\(25ch \+ 18px\)\)"/);
    // Figures stay numbered in reading order with the new ones, and captions stay plain.
    assert.deepEqual(headings(), ["Checks on the values", "Review result", "Records by main source", "Read from the paper and not yet re-read",
      "Values per paper", "What the records contain", "Wild type and variants", "Enzyme classes", "Most common organisms",
      "Most common EC numbers", "Most common organisms among records read from the paper",
      "Most common EC numbers among records read from the paper", "Value ranges",
      "Values by enzyme class", "Cautions on values"]);
    assert.deepEqual([...more.matchAll(/<strong>Figure (\d+)\.<\/strong>/g)].map((match) => Number(match[1])), [1, 2, 3, 4, 5, 6, 7]);
    more.match(/<span class="stats-fig-caption">[\s\S]*?<\/span>(?=<\/figcaption>)/g).forEach(assertPlainCaption);
    assert.doesNotMatch(more, /NaN|Infinity|undefined/);
    // Counts that do not hold together are not drawn: values per paper that miss a paper, a class grid whose counts do
    // not add up, a count read from the paper above the class's records.
    runtimeManifest.summary.overview = { ...runtimeManifest.summary.overview, from_paper_values: { values: 5, bins: [1, 2], papers: [0, 0] },
      metrics: { kcat: { ...overview.metrics.kcat, by_class: { ...kcatClasses, classes: [{ ...kcatClasses.classes[0], n: 4 }] } } },
      ec_classes: [{ class: 1, name: "Oxidoreductases", count: 4, accepted: 2, from_paper: 5 }] };
    api.renderStats();
    assert.doesNotMatch(element("statsCharts").innerHTML, /Values per paper|Values by enzyme class|stats-v2-count/);
    assert.equal(api.statsClassGrid({ by_class: { log10_start: 0, bin_width: 0.5, classes: [] } }, {}), null);
    assert.equal(api.statsRidgeFigure({}), null);
    // The smooth curve never leaves the range of its points (no overshoot below the baseline or above the peak).
    // Medians rounded for a column: 7 → 7.0, 12.8 → 13, 0.0573 → 0.057, 1,234 → 1,200; unrounded as before.
    assert.deepEqual([7, 12.8, 0.0573, 1234, 370].map((value) => api.statsRangeNumber(value, { figures: 2 })), ["7.0", "13", "0.057", "1,200", "370"]);
    assert.equal(api.statsRangeNumber(0.0573), "0.0573");
    // The donut's centre total is set smaller only when it is wider than the hole's room (data-room, px).
    const fitted = new Map();
    const total = { getAttribute: (name) => (name === "data-room" ? "104" : null), getComputedTextLength: () => 130,
      style: { removeProperty: (name) => fitted.delete(name), set fontSize(value) { fitted.set("font-size", value); } } };
    window.getComputedStyle = () => ({ fontSize: "24px" });
    api.statsFitDonutTotals({ querySelectorAll: () => [total] });
    assert.equal(fitted.get("font-size"), "19.2px");
    total.getComputedTextLength = () => 90;
    api.statsFitDonutTotals({ querySelectorAll: () => [total] });
    assert.ok(!fitted.has("font-size"));
    delete window.getComputedStyle;
    assert.match(element("statsCharts").innerHTML, /<text class="stats-donut-total" x="100" y="100" data-room="104">/);
    const path = api.statsSmoothPath([[0, 40], [10, 40], [20, 4], [30, 39], [40, 40], [100, 40]]);
    const ys = [...path.matchAll(/-?[\d.]+ (-?[\d.]+)/g)].map((match) => Number(match[1]));
    assert.ok(ys.length > 6 && ys.every((y) => y >= 4 - 1e-9 && y <= 40 + 1e-9), path);
    runtimeManifest.summary.overview = overview;
    api.renderStats();
  }

  // What the values read from the paper show (overview.from_paper_insights): kcat against Km, variants against their
  // wild type and the assay temperature and pH close Values; the database results by enzyme class follow Values against
  // the databases. Each only when its counts hold together.
  {
    const classNames = { 1: "Oxidoreductases", 3: "Hydrolases" };
    // A 4 x 4 grid of quarter decades (kcat 10⁰-10¹ s⁻¹, Km 10⁻¹-10⁰ mM): 3 records.
    const map = { records: 3, linked: 3, bin_width: 0.25, kcat_log10_start: 0, km_log10_start: -1,
      counts: [[1, 0, 0, 0], [0, 0, 0, 0], [0, 0, 2, 0], [0, 0, 0, 0]], ratio_median: 17.3, at_diffusion_limit: [1, 0],
      classes: [{ class: 1, n: 2, kcat_median: 4.4, km_median: 0.23 }, { class: 3, n: 1, kcat_median: 1, km_median: 0.1 }, { class: 9, n: 1, kcat_median: 1, km_median: 1 }] };
    const figure = api.statsKcatKmFigure(map, classNames);
    assert.equal(figure.key, "kcat-km");
    // Equal decades: the plot keeps the grid's shape, a cell per non-empty bin with its count in its tooltip line.
    assert.match(figure.body, /<div class="stats-map-plot" style="aspect-ratio:4 \/ 4" role="img" aria-label="kcat against Km of 3 records read from the paper, on log scales; median kcat ÷ Km 17 mM⁻¹ s⁻¹; 1 at the diffusion limit or above\. Class medians: EC 1 kcat 4\.4 s⁻¹, Km 0\.23 mM; EC 3 kcat 1\.0 s⁻¹, Km 0\.10 mM\."/);
    assert.equal((figure.body.match(/<rect /g) || []).length, 2);
    assert.match(figure.body, /<rect x="2" y="1" width="1" height="1" style="fill-opacity:0\.92" data-tip="kcat 10⁰·⁵–10⁰·⁷⁵ s⁻¹, Km 10⁻⁰·⁵–10⁻⁰·²⁵ mM: 2 records"\/>/);
    assert.match(figure.body, /<rect x="0" y="3" [^>]*data-tip="kcat below 10⁰·²⁵ s⁻¹, Km below 10⁻⁰·⁷⁵ mM: 1 record"\/>/);
    // A dot per class 1-7 in its class colour with its class number in it, its median in the tooltip line, the smaller
    // classes on top (--z); a row of the class table lights it; a layer for the lines back from moved dots.
    assert.equal((figure.body.match(/class="stats-map-dot /g) || []).length, 2);
    assert.match(figure.body, /<i class="stats-map-dot stats-ec-1" data-hl="ec_1" data-class="1" data-tip="EC 1 Oxidoreductases: median kcat 4\.4 s⁻¹, median Km 0\.23 mM; 2 records\." style="left:[\d.]+%;bottom:[\d.]+%;--z:2">1<\/i>/);
    assert.match(figure.body, /<i class="stats-map-dot stats-ec-3" data-hl="ec_3" data-class="3" [^>]*;--z:3">3<\/i>/);
    assert.match(figure.body, /<svg class="stats-map-leaders" aria-hidden="true" focusable="false"><\/svg>/);
    assert.match(figure.body, /<tr data-hl="ec_1"[^>]*>[\s\S]*?<i class="stats-ec-key stats-ec-1" aria-hidden="true"><\/i><span><a class="stats-link" href="[^"]*#browse\?ec=1\.&amp;source=paper&amp;metric=kcat%2Ckm">EC 1<\/a>/);
    // The records link to them in Browse when Browse finds the same number; the median kcat ÷ Km in both units; the
    // diffusion limit in M⁻¹ s⁻¹, as are the lines of equal kcat/Km.
    assert.match(figure.body, /<dt>Records<\/dt><dd><a class="stats-link" href="[^"]*#browse\?source=paper&amp;metric=kcat%2Ckm">3<\/a><\/dd>/);
    assert.match(figure.body, /17 mM⁻¹ s⁻¹<small>17,000 M⁻¹ s⁻¹<\/small>/);
    assert.match(figure.body, /<dd>1 <span class="stats-muted">\(33\.3%\)<\/span><small>10⁸ M⁻¹ s⁻¹ or more; 0 at 10⁹ or more<\/small>/);
    assert.match(figure.body, /Diffusion limit, 10⁸–10⁹ M⁻¹ s⁻¹/);
    assert.match(figure.body, /Equal <i>k<\/i><sub>cat<\/sub>\/<i>K<\/i><sub>m<\/sub> \(M⁻¹ s⁻¹\), every 100-fold/);
    assert.doesNotMatch(api.statsKcatKmFigure({ ...map, linked: 4 }, classNames).body, /<dd><a class="stats-link"/, "No link when Browse would list another number");
    // Counts that do not add up, or a grid that is not whole decades, draw nothing.
    assert.equal(api.statsKcatKmFigure({ ...map, records: 4 }, classNames), null);
    assert.equal(api.statsKcatKmFigure({ ...map, counts: map.counts.slice(0, 3) }, classNames), null);
    assert.equal(api.statsKcatKmFigure(null, classNames), null);

    const fold = (n, lower, higher) => ({ n, median: 0.3, lower, higher, tenfold_lower: 1, tenfold_higher: 0, counts: [1, 0, 0, 0, n - 2, 1] });
    const mutations = { variants: 5, papers: 2, ambiguous: 3, no_wild_type: 4, bin_width: 0.25, log10_start: -1,
      metrics: { kcat: fold(4, 3, 1), kcat_over_km: fold(5, 4, 0) } };
    const folds = api.statsMutationsFigure(mutations);
    assert.deepEqual([...folds.body.matchAll(/data-metric="(\w+)"/g)].map((match) => match[1]), ["kcat", "kcat_over_km"]);
    // The dashed line at the wild type: bins centred on whole quarters from 10⁻¹, so 1 (10⁰) is 4.5 of 6 bins along.
    assert.match(folds.body, /<i class="stats-fold-zero" style="left:75%" aria-hidden="true"><span>wild type<\/span><\/i>/);
    assert.match(folds.body, /<dt>Lower<\/dt><dd>75\.0%<\/dd>/);
    // Each bar's range in its tooltip line, the end bars open-ended.
    assert.match(folds.body, /data-tip="kcat 0\.13 times the wild type or less: 1 variant \(25\.0%\)"/);
    assert.match(folds.body, /data-tip="kcat 0\.75 to 1\.3 times the wild type: 2 variants \(50\.0%\)"/);
    assert.match(folds.body, /data-tip="kcat 1\.3 times the wild type or more: 1 variant \(25\.0%\)"/);
    assert.match(folds.rules, /^5 variants from 2 papers\. A variant is paired only when its paper gives exactly one wild-type record for the same enzyme, organism, substrate, pH and temperature: 3 variants whose paper gives several such wild-type records and 4 with none are left out\./);
    assert.match(folds.after, /#browse\?source=paper&amp;variant=variant">Variants read from the paper<\/a> in Browse/);
    assert.equal(api.statsMutationsFigure({ ...mutations, metrics: { kcat: { ...fold(4, 3, 1), n: 5 } } }), null);

    // Temperature: a bar per 1 °C, each bar with records a Browse range exact to the values' decimals (25 to 25.9 °C).
    const temperature = { n: 6, start: 0, width: 1, decimals: 1, counts: Array.from({ length: 101 }, (_value, index) => (index === 25 ? 4 : index === 0 || index === 100 ? 1 : 0)) };
    const ph = { n: 3, start: 2, width: 0.1, decimals: 2, counts: Array.from({ length: 101 }, (_value, index) => (index === 55 ? 3 : 0)) };
    const conditions = api.statsConditionsFigure({ temperature, ph }, 10);
    assert.match(conditions.body, /data-tip="25 °C \(25–25\.9 °C\): 4 records \(66\.7%\)" data-href="[^"]*#browse\?source=paper&amp;tmin=25\.0&amp;tmax=25\.9"/);
    assert.match(conditions.body, /data-tip="below 1 °C: 1 record \(16\.7%\)" data-href="[^"]*#browse\?source=paper&amp;tmax=0\.9"/);
    assert.match(conditions.body, /data-tip="100 °C and above: 1 record \(16\.7%\)" data-href="[^"]*#browse\?source=paper&amp;tmin=100\.0"/);
    assert.match(conditions.body, /#browse\?source=paper&amp;phmin=7\.50&amp;phmax=7\.59" title="3 records \(pH 7\.5–7\.59\)">pH 7\.5<\/a> <span class="stats-muted">100\.0%<\/span>/);
    assert.match(conditions.body, /<p class="stats-range-count">6 records of 10<\/p>/);
    assert.equal((conditions.body.match(/<div class="stats-condition-bars">/g) || []).length, 2);
    // Without the values' decimals no bar links (a range could miss a value); counts that do not add up draw nothing.
    assert.doesNotMatch(api.statsConditionsFigure({ temperature: { ...temperature, decimals: null } }, 10).body, /data-href/);
    assert.equal(api.statsConditionsFigure({ temperature: { ...temperature, n: 7 } }, 10), null);

    const byClass = api.statsDatabaseClassFigure([{ class: 1, same: 8, other_label: 1, corrects: 1, differs: 0, not_listed: 2 },
      { class: 3, same: 0, other_label: 0, corrects: 0, differs: 0, not_listed: 0 }, { class: 2, same: "8" }], classNames);
    assert.deepEqual([...byClass.body.matchAll(/data-row="(\w+)" data-count="(\d+)"/g)].map((match) => `${match[1]}:${match[2]}`), ["ec_1:12"]);
    assert.match(byClass.body, /data-tip="EC 1 Oxidoreductases, Corrects a value: 1"/);
    assert.match(byClass.body, /#browse\?ec=1\.&amp;source=paper">EC 1<\/a><span class="stats-ec-name"> Oxidoreductases<\/span>/);
    assert.equal(api.statsDatabaseClassFigure([], classNames), null);

    // In the page: Values ends with the three, the class figure follows Values against the databases.
    // (The page's records read from the paper bound the conditions' counts: here 2.)
    const two = (index) => Array.from({ length: 101 }, (_value, bin) => (bin === index ? 2 : 0));
    runtimeManifest.summary.overview = { ...overview, from_paper_insights: { kcat_km: map, mutations,
      conditions: { temperature: { ...temperature, n: 2, counts: two(25) }, ph: { ...ph, n: 2, counts: two(55) } },
      database_by_class: [{ class: 1, same: 8, other_label: 1, corrects: 1, differs: 0, not_listed: 2 }] } };
    api.renderStats();
    const titles = headings();
    assert.deepEqual(titles.slice(titles.indexOf("Value ranges"), titles.indexOf("Value ranges") + 5),
      ["Value ranges", "kcat against Km", "Variants against their wild type", "Assay temperature and pH", "Cautions on values"]);
    assert.doesNotMatch(element("statsCharts").innerHTML, /NaN|Infinity|undefined/);
    runtimeManifest.summary.overview = overview;
    api.renderStats();
  }

  // Decade ticks: one per decade, labelled every other decade on an axis of more than 7 ticks, at multiples of 2 (10⁰
  // always labelled), every second label marked to give way on a narrow axis; up to 7 ticks, every decade labelled.
  const ticks = api.statsDecadeTicks(-5, 3);
  assert.deepEqual([...ticks.matchAll(/<span(?: class="([^"]+)")? style="left:([\d.]+)%">(.*?)<\/span>/g)].map((match) => [match[1] || "", Number(match[2]), match[3].replace(/<\/?sup>/g, "")]),
    [["stats-tick-minor", 0, ""], ["", 12.5, "10−4"], ["stats-tick-minor", 25, ""], ["stats-tick-alt", 37.5, "10−2"], ["stats-tick-minor", 50, ""],
      ["", 62.5, "100"], ["stats-tick-minor", 75, ""], ["stats-tick-alt", 87.5, "102"], ["stats-tick-minor", 100, ""]]);
  assert.deepEqual([...api.statsDecadeTicks(-2, 3).matchAll(/<span(?: class="([^"]+)")?/g)].map((match) => match[1] || ""), ["", "stats-tick-alt", "", "stats-tick-alt", "", "stats-tick-alt"]);
  // The shared axis of a parameter: the whole decades around its class grid, when the whole-distribution histogram
  // reaches that far; none without a class grid or when the histogram is narrower.
  const kcatGrid = { log10_start: -4, bin_width: 0.5, classes: [{ class: 1, n: 29253, median: 5.2, p10: 0.04, p90: 300, counts: [1, ...Array(16).fill(0), 29252] }] };
  const kcatSummary = { n: 3, median: 4.4, p10: 0.034, p90: 240, log10_start: -5, counts: [1, ...Array(10).fill(0), 2] };
  assert.deepEqual({ ...api.statsValueAxis({ ...kcatSummary, by_class: kcatGrid }) }, { start: -4, end: 5, n: "calc(6ch + 4px)" });
  assert.deepEqual({ ...api.statsValueAxis({ ...kcatSummary, by_class: { ...kcatGrid, log10_start: -4.5 } }) }, { start: -5, end: 5, n: "calc(6ch + 4px)" });
  assert.equal(api.statsValueAxis({ ...kcatSummary, log10_start: -3, by_class: kcatGrid }), null);
  assert.equal(api.statsValueAxis(kcatSummary), null);
  assert.equal(api.statsValueAxis({ ...kcatSummary, n: 4, by_class: kcatGrid }), null);
  // On that axis the histogram's bars beyond it join its end bars, and its median sits where the class panels' would.
  const onAxis = api.statsValueRange({ key: "kcat", html: "kcat", unit: "s⁻¹" }, { ...kcatSummary, n: 4, counts: [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1] }, { start: -4, end: 5, n: "calc(6ch + 4px)" });
  assert.equal((onAxis.match(/<span(?: class="has-values")? style="height:/g) || []).length, 9);
  assert.match(onAxis, /<span class="has-values" style="height:100%" data-tip="below 10⁻³ s⁻¹: 2 values"><\/span>/);
  assert.match(onAxis, /<span class="has-values" style="height:100%" data-tip="10⁴ and above s⁻¹: 2 values"><\/span><\/div>/);
  assert.match(onAxis, new RegExp(`<i style="left:${(Math.log10(4.4) + 4) / 9 * 100}%"><\\/i>`));

  // A histogram that does not add up is not drawn.
  assert.equal(api.statsValueRange({ key: "km", html: "Km", unit: "mM" }, { n: 3, median: 1, p10: 1, p90: 1, log10_start: 0, counts: [1, 1] }), "");
  assert.equal(api.statsValueRange({ key: "km", html: "Km", unit: "mM" }, { n: 2, median: 2, p10: 3, p90: 4, log10_start: 0, counts: [1, 1] }), "");
  assert.equal(api.statsValueRange({ key: "km", html: "Km", unit: "mM" }, null), "");
  const range = api.statsValueRange({ key: "km", html: "Km", unit: "mM" }, { n: 4, median: 0.5, p10: 0.01, p90: 50, log10_start: -3, counts: [1, 0, 0, 2, 0, 1] });
  assert.match(range, /data-metric="km" data-count="4"/);
  assert.match(range, /style="height:50%"/);
  assert.match(range, /<i style="left:[\d.]+%"><\/i>/);
  // A percentile of 1,000 or more prints with thousands separators, like the counts; 100,000 and over as a power of ten.
  const wide = api.statsValueRange({ key: "kcat_over_km", html: "kcat/Km", unit: "mM⁻¹ s⁻¹" }, { n: 3, median: 17, p10: 0.067, p90: 2300, log10_start: -2, counts: [1, 1, 0, 0, 0, 1] });
  assert.match(wide, /<dt>10–90%<\/dt><dd>0\.067 – 2,300<\/dd>/);
  assert.match(wide, /10% above 2,300; 3 values\./);
  // The median reads to two significant figures, as in Values by enzyme class (also in its accessible text).
  const thousands = api.statsValueRange({ key: "kcat", html: "kcat", unit: "s⁻¹" }, { n: 2, median: 1250.5, p10: 2, p90: 250000, log10_start: 0, counts: [1, 0, 0, 0, 0, 1] });
  assert.match(thousands, /<dd>1,300<\/dd>[\s\S]*<dd>2 – <span class="scientific-number"[^>]*><span aria-hidden="true">2\.5 &times;&nbsp;10<sup>5<\/sup>/);
  assert.match(thousands, /aria-label="kcat: median 1,300 s⁻¹;/);
  assert.match(api.statsValueRange({ key: "km", html: "Km", unit: "mM" }, { n: 2, median: 0.131, p10: 0.0028, p90: 7.3, log10_start: -3, counts: [1, 0, 0, 1] }),
    /<dt>Median<\/dt><dd>0\.13<\/dd>[\s\S]*aria-label="Km: median 0\.13 mM;/);

  // An overview from another download, or with another record count, is not used.
  runtimeManifest.summary.overview = { ...overview, download_sha256: "other-download" };
  api.renderStats();
  assert.doesNotMatch(element("statsTotals").innerHTML, /Read from the paper|Papers/);
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
  // The bar's outer ends are rounded: the first segment's left, the last one's right.
  assert.match(stacked, /stats-part-accepted is-start" style="left:0%;width:60%"[\s\S]*stats-part-pending is-end" style="left:60%;width:40%"/);
  assert.match(api.statsBarChart({ key: "t", scale: 10, overlay: true, rows: [{ key: "a", count: 9, label: "A", value: "9",
    segments: [{ part: "records", count: 8 }, { part: "accepted", count: 2 }] }] }), /stats-part-accepted is-start is-end" style="left:0%;width:20%"/);
  // A count chart with gridlines at its ticks, one group in the ticks' order (so a gridline gives way with its label).
  const gridded = api.statsBarChart({ key: "t", scale: 30, step: 10, rows: [{ key: "a", count: 9, label: "A", value: "9",
    segments: [{ part: "accepted", count: 9 }] }] });
  assert.equal((gridded.match(/<i class="stats-ref" style="left:[\d.]+%"><\/i>/g) || []).length, 4);
  assert.match(gridded, /<span class="stats-refs"><i class="stats-ref" style="left:0%"><\/i><i class="stats-ref" style="left:33\.3333%"><\/i><i class="stats-ref" style="left:66\.6667%"><\/i><i class="stats-ref" style="left:100%"><\/i><\/span>/);
  // A chart with a Records | Share switch keeps each mode's gridlines in a group of their own.
  assert.match(api.statsBarChart({ key: "t", scale: 30, step: 10, switchable: true, rows: [{ key: "a", count: 9, label: "A", value: "9",
    segments: [{ part: "accepted", count: 9 }] }] }), /<span class="stats-refs stats-ref-records">(<i class="stats-ref"[^>]*><\/i>){4}<\/span><span class="stats-refs stats-ref-share">(<i class="stats-ref"[^>]*><\/i>){5}<\/span>/);
  // A value label of several numbers sets each in its own right-aligned column: the count, then the share, every column
  // after the first sized by a hidden sizer (data-sizer) of its entries' shapes, so the counts line up. The shapes: digits
  // as 0, without one that ends another; "<0.0%" stays, since "<" may be wider than a digit.
  assert.equal(api.statsValueSizer(["3.2%", "100.0%", "27.9%", "0.0%"]), "000.0%");
  assert.equal(api.statsValueSizer(["99.9%", "<0.1%", "<0.1%"]), "00.0%\n<0.0%");
  assert.equal(api.statsValueSizer(["18,217", "119", ""]), "00,000");
  const columns = api.statsBarChart({ key: "t", scale: 90000, rows: [
    { key: "a", count: 80215, label: "A", parts: [{ text: "80,215" }, { text: "3.2%", className: "stats-muted" }], segments: [{ part: "accepted", count: 2567 }] },
    { key: "b", count: 44627, label: "B", parts: [{ text: "44,627" }, { text: "100.0%", className: "stats-muted" }], segments: [{ part: "accepted", count: 44627 }] },
    { key: "c", count: 5, label: "C <x>", parts: [{ text: "5" }, { text: "<0.1%", className: "stats-muted" }], segments: [{ part: "accepted", count: 0 }] }] });
  assert.match(columns, /<span class="stats-chart-value has-parts"><span class="stats-value-part">80,215<\/span><span class="stats-value-part stats-muted" data-sizer="000\.0%&#10;&lt;0\.0%"><span>3\.2%<\/span><\/span><\/span>/);
  assert.match(columns, /<span class="stats-value-part">5<\/span><span class="stats-value-part stats-muted" data-sizer="000\.0%&#10;&lt;0\.0%"><span>&lt;0\.1%<\/span>/);
  assert.match(columns, /style="--value-w:max\(96px, calc\(12ch \+ 12px\)\)"/);
  assert.doesNotMatch(columns, /stats-chart-head|has-value-heads/);
  // With headings (one per column) every column, the first too, is sized to its heading and entries; the estimate in ch
  // counts the headings, and statsFitValueColumns then sets the width the headings' line takes as drawn.
  const headed = api.statsBarChart({ key: "t", scale: 90000, valueHeads: ["Records", "Accepted"], rows: [
    { key: "a", count: 80215, label: "A", parts: [{ text: "80,215" }, { text: "2,567", className: "stats-muted" }], segments: [{ part: "accepted", count: 2567 }] }] });
  assert.match(headed, /<div class="stats-chart has-value-heads" data-chart="t" style="--value-w:max\(96px, calc\(15ch \+ 12px\)\)">/);
  assert.match(headed, /<span class="stats-value-part" data-sizer="00,000&#10;Records"><span>80,215<\/span><\/span><span class="stats-value-part stats-muted" data-sizer="0,000&#10;Accepted"><span>2,567<\/span><\/span>/);
  // headings that do not match the columns are left out
  assert.doesNotMatch(api.statsBarChart({ key: "t", scale: 9, valueHeads: ["Records"], rows: [
    { key: "a", count: 8, label: "A", parts: [{ text: "8" }, { text: "2" }], segments: [{ part: "accepted", count: 2 }] }] }), /stats-chart-head/);
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
  // The badge: review result and tags as its accessible name; the meaning (never the full method) in its title. A record
  // not yet re-read is tagged "not re-read" where one read from the paper says "from paper", read out in full.
  const badge = api.statusBadge(row({ verification_status: "corrected" }));
  assert.match(badge, /aria-label="Accepted, Not yet re-read, BRENDA, corrected"/);
  assert.match(badge, /<span class="state-tags"><span class="state-tag">not re-read<\/span><span class="state-tag">BRENDA<\/span><span class="state-tag">corrected<\/span><\/span>/);
  assert.match(badge, /title="Accepted after a correction in the earlier automated review; the record shows the changes when the snapshot lists them\."/);
  assert.match(api.statusBadge(prepared), /class="state-badge unresolved"[^>]*title="Not checked \(Not reviewed\): A database record without a PMID or DOI that was never reviewed\."[^>]*aria-label="Not checked, Not yet re-read, BRENDA"/);
  assert.match(api.statusBadge(row({ verification_status: "disputed" })), /class="state-badge disputed"[^>]*>.*Disputed</);
  const paperBadge = api.statusBadge(row({ source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name" }));
  assert.match(paperBadge, /title="Read from the paper by an AI model; a second, separate AI check compared each value with the paper\." aria-label="Accepted, from paper"/);
  assert.match(paperBadge, /<span class="state-tags"><span class="state-tag">from paper<\/span><\/span>/);
  assert.doesNotMatch(paperBadge, /not re-read|Not yet re-read/);
  assert.doesNotMatch(paperBadge, /independent|run\b|code converted/);
  assert.equal(api.reviewOutcome(prepared), "Not checked: taken from the source database as listed.");
  // An older record's review says it was the earlier automated review, and what it found.
  for (const [status, sentence] of [
    ["corrected", "Corrected and accepted in the earlier automated review; this snapshot does not list the changes."],
    ["verified", "Accepted as printed in the earlier automated review."],
    ["manual_review_required", "Not confirmed: the earlier automated review left a question open on the value, unit, protein or substrate."],
    ["unverified", "Not checked: the earlier automated review recorded no final check."],
    ["disputed", "Disputed in the earlier automated review; not accepted (no reason recorded)."],
  ]) assert.equal(api.reviewOutcome(row({ verification_status: status })), sentence);
  assert.equal(api.reviewOutcome(row({ verification_status: "verified", public_trust_basis: "identity_only" })),
    "Accepted as listed by the source database; no paper is cited, so the value cannot be traced to a paper.");
  // An older snapshot: an accepted record without a paper is tagged; a human-checked one keeps the earlier review's title.
  assert.match(api.statusBadge(row({ verification_status: "verified", public_trust_basis: "identity_only" })),
    /title="Accepted, but no PMID or DOI is linked, so the value cannot be traced to a paper\."[^>]*aria-label="Accepted, Not yet re-read, BRENDA, no paper linked"/);
  // The user's review rules (D1, D2), followed by an export that counts accepted_basis: a record without a paper is Not
  // checked and still tagged; a record a human reviewer approved in full may be accepted for that alone.
  {
    const savedSummary = runtimeManifest.summary;
    runtimeManifest.summary = { ...savedSummary, distributions: { ...savedSummary.distributions,
      accepted_basis: [{ label: "human review", count: 1 }] } };
    const noPaper = row({ record_key: "no-paper", measurement_key: "no-paper", verification_status: "mathematically_inferred", public_trust_basis: "identity_only", source_db: "skid" });
    const badge = api.statusBadge(noPaper);
    assert.match(badge, /aria-label="Not checked, Not yet re-read, SKiD, no paper linked"/);
    assert.match(badge, /title="Not checked: the earlier automated review accepted it, but no PMID or DOI is linked, so the value cannot be traced to a paper; not counted as Accepted\."/);
    assert.doesNotMatch(badge, /never reviewed/);
    assert.equal(api.rowStatusLabel(noPaper, { exact: true }), "Not checked", "the tag says why, not 'Not reviewed'");
    assert.equal(api.reviewOutcome(noPaper), "Not checked: the earlier automated review accepted it, but no paper is cited, so the value cannot be traced to a paper.");
    // The Guide's Not checked definition counts these records under Not reviewed, as Stats does, and says how the record
    // shows them.
    api.renderGuideMethod();
    assert.match(element("guideNotCheckedDefinition").innerHTML, /^No review result\. The record names which kind: <em>Unverified<\/em> \(the earlier review recorded no final check\) or <em>Not reviewed<\/em> \(a SKiD or BRENDA record with no PMID or DOI, including records the earlier review accepted, tagged <em>no paper linked<\/em>\)\.$/);
    const approved = row({ record_key: "approved", measurement_key: "approved", verification_status: "verified" });
    api.setHumanReviewMarks({ approved: { checked: true } });
    // human-checked's rule (the user, 2026-10-13): every kcat and Km, and the kcat/Km approved too or agreeing with kcat ÷ Km.
    assert.match(api.statusBadge(approved), /title="Accepted as printed by the earlier automated review, or on a human reviewer&#39;s approval\. Human-checked: a human reviewer approved every kcat and Km shown; the kcat\/Km was approved too or agrees with kcat ÷ Km\."/);
    assert.equal(api.reviewOutcome(approved, { accepted_basis: "human review" }),
      "Accepted on a human reviewer's approval (human-checked); the earlier automated review had not accepted it.");
    assert.equal(api.reviewOutcome(approved, {}), "Accepted as printed in the earlier automated review.");
    api.setHumanReviewMarks({});
    runtimeManifest.summary = savedSummary;
    // An older snapshot accepts these records, so its Not reviewed is only the records nobody reviewed.
    api.renderGuideMethod();
    assert.match(element("guideNotCheckedDefinition").innerHTML, /or <em>Not reviewed<\/em> \(a SKiD or BRENDA record with no PMID or DOI that was never reviewed\)\.$/);
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
  // The comparison with the databases as a file (the README documents it): in the Download menu and the Guide's
  // Downloads when the manifest has it (database_comparison_download), with its rows and size, hidden otherwise.
  const savedComparison = runtimeManifest.database_comparison_download;
  runtimeManifest.database_comparison_download = { path: "data/catlog-database-comparison.0123456789ab.csv.gz", size_bytes: 5437467, rows: 295792 };
  api.renderDownloadMetadata();
  assert.equal(element("comparisonDataButton").hidden, false);
  assert.equal(element("guideComparisonDownload").hidden, false);
  assert.ok(element("comparisonDataButton").href.endsWith("/data/catlog-database-comparison.0123456789ab.csv.gz"), element("comparisonDataButton").href);
  assert.equal(element("guideComparisonLink").href, element("comparisonDataButton").href);
  assert.equal(element("comparisonDataButton").getAttribute("download"), "catlog-2026-10-12-database-comparison.csv.gz");
  assert.equal(element("guideComparisonLink").getAttribute("download"), "catlog-2026-10-12-database-comparison.csv.gz");
  assert.equal(element("comparisonDataDescription").textContent, "One row per value read from the paper and each database that lists its paper (CSV) · 295,792 rows · 5.2 MB");
  delete runtimeManifest.database_comparison_download;
  api.renderDownloadMetadata();
  assert.equal(element("comparisonDataButton").hidden, true);
  assert.equal(element("guideComparisonDownload").hidden, true);
  assert.equal(element("comparisonDataDescription").textContent, "One row per value read from the paper and each database that lists its paper (CSV)");
  if (savedComparison) runtimeManifest.database_comparison_download = savedComparison;
  assert.equal(element("guideSourceId").textContent, "14ffa6600b");
  assert.match(element("guideCitationLine").textContent, /^CatLog snapshot 2026-10-12 \(data ID 14ffa6600b\), Chowdhury Lab, /);
  Object.assign(runtimeManifest, saved);
}

// The record's Values and Conditions sections together (what the round-4 Measurement and Assay conditions showed).
const measurementSection = (summary, detail) => api.valuesSection(summary, detail) + api.conditionsSection(summary, detail);
// The Values section's own lines write kcat, Km, kcat/Km and Ki as its table does (italic k or K, subscript); the checks of
// their words read them plain.
const plainMetricNames = (html) => html.replace(/<i>([kK])<\/i><sub>(cat|m|i)<\/sub>/g, "$1$2");
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
  assert.match(shown({ kcat_display: "1.23456e+7" }), /1\.235 &times;&nbsp;10<sup>7<\/sup>/, "× 10 never parts");
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
  // A calculated kcat/Km's tooltip: that no printed kcat/Km was read, only on a record read from the paper (all CatLog
  // knows; it never says the paper prints none); an older record's source may list (and its paper print) one of its own.
  const calcOlder = { ...quotientRow, kcat_over_km_origin: "calculated", source_db: "oed" };
  assert.equal(api.efficiencyOriginHtml(calcOlder, { short: true }), '<small class="metric-origin" title="kcat ÷ Km, calculated by CatLog.">calc.</small>');
  const calcV2 = { ...calcOlder, source_db: "primary_paper_direct", verification_status: "verified", enzyme_label_source: "explicit_enzyme_name" };
  assert.match(api.efficiencyOriginHtml(calcV2, { short: true }), /title="kcat ÷ Km, calculated by CatLog; no printed kcat\/Km was read for this measurement\."/);
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
  assert.match(html, /<span class="vt-number">135\.0<\/span><\/td><td class="vt-unit">s<sup>−1<\/sup><\/td><td class="vt-printed">135\.0 ± 15\.1 sec−1/, "Values keep the printed zero");
  assert.match(html, /<span class="vt-number">0\.03<\/span><\/td><td class="vt-unit">mM<\/td>/,
    "a printed integer's zero (30 µM) is no printed figure: the stored digits show, as in the table");
  assert.match(html, /<span class="vt-number">4500<\/span><\/td><td class="vt-unit">mM<sup>−1<\/sup> s<sup>−1<\/sup><\/td>/, "a value_display that is not the stored number is not used");
  assert.match(html, /<caption>Printed in Table 1<\/caption>/, "a place every value shares is said once");
  assert.doesNotMatch(html, /class="vt-where/);
  const body = decodeURIComponent(html.match(/id="reportRecordProblem" class="button secondary" href="([^"]+)"/)[1].replace(/&amp;/g, "&"));
  assert.match(body, /kcat 135\.0 s⁻¹; Km 0\.03 mM/);
  // In a table with checks each printed number of As printed is one unbreakable piece (the check's 16px once broke
  // "0.00048" in a wide font at 375px), and so is a unit written with its power; a single figure and the text between
  // them stay as they are.
  api.setHumanReviewMarks({ [v2.measurement_key || v2.record_key]: { checked: true, approved: ["kcat", "km"] } });
  api.renderDetail(v2, { verification_method: "catlog_v2_read_and_independent_verify", supporting_pmids: ["31072150"],
    proof_lines: [line("kcat", "135.0 ± 15.1 sec−1", "135.0"), line("Km", "30 µM", "0.030"), line("kcat/Km", "4.5 × 10^3", "4501")] });
  const checked = element("detailContent").innerHTML;
  assert.match(checked, /<table class="values-table vt-checks">/);
  assert.match(checked, /<td class="vt-printed"><span class="vt-whole">135\.0<\/span> ± <span class="vt-whole">15\.1<\/span> <span class="vt-whole">sec−1<\/span><\/td>/);
  assert.match(checked, /<td class="vt-printed"><span class="vt-whole">30<\/span> µM<\/td>/);
  assert.match(checked, /<td class="vt-printed"><span class="vt-whole">4\.5<\/span> × <span class="vt-whole">10<\/span><sup>3<\/sup><\/td>/);
  api.setHumanReviewMarks({});
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
  assert.match(html, /<span class="vt-number">1285\.4<\/span><\/td><td class="vt-unit">s<sup>−1<\/sup><\/td>/, "kcat as the paper prints it");
  assert.match(html, /<span class="vt-number">621\.92<\/span><\/td><td class="vt-unit">mM<sup>−1<\/sup> s<sup>−1<\/sup><\/td>/);
  const body = decodeURIComponent(html.match(/id="reportRecordProblem" class="button secondary" href="([^"]+)"/)[1].replace(/&amp;/g, "&"));
  assert.match(body, /kcat 1285\.4 s⁻¹; Km 13\.5 mM; kcat\/Km 621\.92 mM⁻¹ s⁻¹/);
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
  assert.match(html, /<span class="vt-number">47<\/span><\/td><td class="vt-unit">mM<sup>−1<\/sup> s<sup>−1<\/sup><\/td><td class="vt-printed">47,000 M/);
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
  assert.ok(html.includes("The paper&#39;s kcat/Km (28.9 mM⁻¹ s⁻¹) is 1,001-fold below kcat ÷ Km (2.9 × 10⁴ mM⁻¹ s⁻¹). "
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
  const guideCautions = indexHtml.match(/<dl class="guide-caution-list">[\s\S]*?<\/dl>/)[0];
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
  // A temperature caution (the filter's Temperature questionable group): the table shows no temperature, so the row's "!"
  // and its short words open the grey line under the substrate (before any other note); the record says it on its
  // Temperature line.
  const zeroCelsius = row({ temperature_display: "", condition_flags: ["temperature_zero_celsius_needs_check"] });
  assert.equal(api.rowCautionBits(zeroCelsius), 8);
  const noLookAlikes = api.lookAlikeRowKeys([]);
  assert.equal(api.substrateNoteHtml(zeroCelsius, noLookAlikes),
    '<small class="condition-note"><span class="value-flag" role="img" title="Temperature recorded as exactly 0 °C; may stand for a missing value" '
    + 'aria-label="Temperature recorded as exactly 0 °C; may stand for a missing value"><span class="visually-hidden">T questionable</span></span></small>');
  const notedZero = row({ temperature_display: "", condition_note: "+10 mM FBP", condition_flags: ["temperature_unit_needs_check"] });
  assert.match(api.substrateNoteHtml(notedZero, noLookAlikes),
    /^<small class="condition-note"><span class="value-flag" role="img" title="Temperature unit questionable"[^>]*><span class="visually-hidden">T questionable<\/span><\/span> <span title="\+10 mM FBP">· \+10 mM FBP<\/span><\/small>$/);
  assert.equal(api.temperatureFlagBadgeHtml(api.conditionFlags(unflaggedLow)), "", "a Km caution leaves the substrate line unmarked");
  assert.equal(api.substrateNoteHtml(unflaggedLow, noLookAlikes), "");
  assert.match(measurementSection(zeroCelsius, {}), /<dt>Temperature<\/dt><dd>Not shown, recorded as exactly 0 °C, which may stand for a missing value/);
}
// An older record that stores no kcat/Km shows the kcat/Km its sources list even when nothing differs (3d1ca368da05740a:
// BRENDA lists 0.5 and 50 mM⁻¹ s⁻¹, each also with no unit); one whose stored kcat/Km equals the listed one says it once.
{
  const brenda = (value, unit) => ({ value, unit, source_db: "brenda", source_record_id: null, pmids: ["740076"] });
  const listedOnly = { source_kcat_over_km_values: [brenda(0.5, "s^(-1)*mM^(-1)"), brenda(50, "s^(-1)*mM^(-1)"), brenda(0.5, null), brenda(50, null)] };
  const empty = api.valuesSection(row({ record_key: "listed-only", source_db: "brenda", kcat: null, km: null, kcat_over_km: null,
    kcat_display: null, km_display: null, kcat_over_km_display: null }), listedOnly);
  assert.match(plainMetricNames(empty), /No kcat, Km or kcat\/Km is stored for this record; BRENDA lists a kcat\/Km for it \(below\)\./);
  // Its empty line and the listed values' label name the parameters as the Values table does.
  assert.match(empty, /<p class="values-empty">No <i>k<\/i><sub>cat<\/sub>, <i>K<\/i><sub>m<\/sub> or <i>k<\/i><sub>cat<\/sub>\/<i>K<\/i><sub>m<\/sub> is stored/);
  assert.match(empty, /<dt><i>k<\/i><sub>cat<\/sub>\/<i>K<\/i><sub>m<\/sub> listed by BRENDA<\/dt>/);
  assert.match(plainMetricNames(empty), /<dt>kcat\/Km listed by BRENDA<\/dt><dd><span class="source-efficiency-value"><span><span class="listed-end">0\.50<\/span>–<span class="listed-end">50<\/span> mM<sup>−1<\/sup> s<sup>−1<\/sup><\/span><small>2 values<\/small><\/span><\/dd>/);
  assert.doesNotMatch(empty, /no unit/, "a number BRENDA also gives with no unit is listed once, in its unit");
  const pair = api.valuesSection(row({ record_key: "listed-pair", source_db: "brenda", kcat: 17479, km: 1.86, kcat_over_km: null,
    kcat_display: "17479", km_display: "1.86", kcat_over_km_display: null }), { source_kcat_over_km_values: [brenda(9397, "s^(-1)*mM^(-1)"), brenda(9397, null)] });
  assert.match(plainMetricNames(pair), /<dt>kcat\/Km listed by BRENDA<\/dt><dd><span class="source-efficiency-value"><span><span class="listed-end">9397<\/span> mM<sup>−1<\/sup> s<sup>−1<\/sup>/);
  assert.doesNotMatch(pair, /flag-notes|kcat\/Km mismatch/, "no new caution: the table's cautions stay CatLog's flags");
  // One listed value follows the display rule too, as the range's ends are rounded (341905f35e2de883: OED's 126.667 shows
  // 127, a ÷60 artefact; 9397 keeps its 4 figures).
  const one = api.valuesSection(row({ record_key: "listed-one", source_db: "oed", kcat: 11.333, km: 0.09, kcat_over_km: 125.92,
    kcat_display: "11.333", km_display: "0.09", kcat_over_km_display: "125.92", kcat_over_km_origin: "calculated",
    kcat_over_km_source_differs: true }), { source_kcat_over_km_values: [{ value: 126.667, unit: "s^(-1)*mM^(-1)", source_db: "oed", pmids: ["11054102"] }] });
  assert.match(plainMetricNames(one), /<dt>kcat\/Km listed by OED<\/dt><dd><span class="source-efficiency-value"><span><span class="listed-end">127<\/span> mM<sup>−1<\/sup> s<sup>−1<\/sup>/);
  assert.doesNotMatch(one, /126\.667/);
  // The report email quotes the listed kcat/Km the record shows, as it shows them.
  api.renderDetail(row({ record_key: "listed-email", source_db: "oed", kcat: 11.333, km: 0.09, kcat_over_km: 125.92,
    kcat_display: "11.333", km_display: "0.09", kcat_over_km_display: "125.92", kcat_over_km_origin: "calculated",
    kcat_over_km_source_differs: true }), { source_kcat_over_km_values: [{ value: 126.667, unit: "s^(-1)*mM^(-1)", source_db: "oed" },
    { value: 3.0, unit: "1/mM*1/s", source_db: "brenda" }, { value: 6.117, unit: "1/mM*1/s", source_db: "brenda" }, { value: 5, unit: "", source_db: "brenda" }] });
  const emailHtml = element("detailContent").innerHTML;
  const emailBody = decodeURIComponent(emailHtml.match(/id="reportRecordProblem" class="button secondary" href="([^"]+)"/)[1].replace(/&amp;/g, "&"));
  assert.match(emailBody, /kcat\/Km 130 mM-1 s-1; kcat\/Km listed by OED 127 mM⁻¹ s⁻¹; kcat\/Km listed by BRENDA 3\.0–6\.1 mM⁻¹ s⁻¹ \(2 values\); kcat\/Km listed by BRENDA 5 no unit\.\n/);
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
// An older record's "buffer ..." item cut at a decimal point or comma by the earlier pipeline never shows its cut end
// (record ed087b4be9cba15c read "buffer containing 0"): the words before it stay with "…", an item with nothing left goes.
{
  const older = (text, ph) => api.conditionLines(text, row({ source_db: "brenda", ph_display: ph }));
  const zero = older("pH 7.4; 298.15 K; buffer containing 0; cofactor NADP+", "7.4");
  assert.equal(zero.conditions, "", "'buffer containing 0' (0.1 M cut at its decimal point) is left out");
  assert.match(zero.cosubstrate, /<dt>Cofactor<\/dt><dd>NADP(?:<sup>\+<\/sup>|\+)<\/dd>/);
  for (const cut of ['buffer note ("in 0', "buffer note: 'in 0", "buffer of 0", "buffer and 1", "buffer I = 0", "buffer pH 5"]) {
    assert.equal(older(`pH 5.8; ${cut}`, "5.8").conditions, "", `${cut} is left out`);
  }
  assert.match(older("pH 7.5; buffer 50 mM Tris-HCl pH 7", "7.5").conditions, /<dt>Assay<\/dt><dd>buffer 50 mM Tris-HCl …<\/dd>/,
    "a buffer pH cut from 7.5 to 7 never stands beside the record's pH 7.5");
  assert.match(older("pH 9.8; buffer containing 50 mM glycine (pH 9", "9.8").conditions, /<dd>buffer containing 50 mM glycine …<\/dd>/);
  assert.match(older("pH 7.4; buffer containing 1 mM EDTA and 2", "7.4").conditions, /<dd>buffer containing 1 mM EDTA …<\/dd>/);
  assert.match(older("pH 8.5; buffer 20 mM 1", "8.5").conditions, /<dd>buffer 20 mM …<\/dd>/);
  // A cut that left a bracket or quote open closes it after "…", and a bracket that never closes holds no "; ".
  const tes = older("pH 7.2; buffer 35 mM TES (K+; cofactor FAD", "7.2");
  assert.match(tes.conditions, /<dd>buffer 35 mM TES \(K(?:<sup>\+<\/sup>|\+) …\)<\/dd>/);
  assert.match(tes.cosubstrate, /<dt>Cofactor<\/dt><dd>FAD<\/dd>/, "the cofactor after an unclosed bracket keeps its own row");
  assert.match(older("pH 7.6; buffer note \"in 50 mM Tris-HCl", "7.6").conditions, /<dd>buffer note &quot;in 50 mM Tris-HCl …&quot;<\/dd>/);
  assert.match(older("pH 6.8; buffer conditions ('imidazole-HCl buffer pH 6", "6.8").conditions, /<dd>buffer conditions \(&#39;imidazole-HCl buffer …&#39;\)<\/dd>/);
  // Whole items stay as they are: the record's own pH, a reference, a unit's digits.
  assert.match(older("pH 9; buffer pH 9", "9").conditions, /<dd>buffer pH 9<\/dd>/);
  assert.match(older("pH 8; buffer to ref 10", "8").conditions, /<dd>buffer to ref 10<\/dd>/);
  assert.match(older("pH 6.5; buffer 50 mM KH2PO4", "6.5").conditions, /<dd>buffer 50 mM KH2PO4<\/dd>/);
  // A name's number is not an amount (earlier paper-read records, 41766dc20ab8f4ed); an earlier paper-read record's cut
  // item goes like a database record's (ed087b4be9cba15c, PMID 1980064).
  const earlierPaper = (text) => api.conditionLines(text, row({ source_db: "primary_paper_direct", enzyme_label_source: "ec_name_fallback" }));
  assert.match(earlierPaper("buffer and substrate made metal-free on Chelex 100").conditions, /<dd>buffer and substrate made metal-free on Chelex 100<\/dd>/);
  assert.equal(earlierPaper("pH 7; buffer containing 0").conditions, "");
  // CatLog's own readers write whole sentences: a record CatLog read from the paper is shown as written.
  const v2 = api.conditionLines("buffer containing 0", row({ source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name" }));
  assert.match(v2.conditions, /<dd>buffer containing 0<\/dd>/);
}
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
assert.match(plainMetricNames(referenceHtml), /No kcat, Km or kcat\/Km is stored for this record\./);
assert.match(referenceHtml, /<dt>SMILES<\/dt><dd>None<\/dd>/);
assert.doesNotMatch(referenceHtml, /Protein identity/);
assert.doesNotMatch(referenceHtml, /undefined|NaN|null/);
// The record (design spec 5, round 13): name; EC, organism and form; substrate; status; record ID and Copy link. Then Values
// (with the values as printed), Checks, Conditions, Protein and substrate, Paper, and the record's actions with its license
// and snapshot last. A record read from the paper has no Source section: its header says "from paper".
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
  assert.match(html, /<span class="detail-status-word">Accepted<\/span><span>from paper<\/span>/);
  assert.match(html, /<p class="detail-key"><span class="visually-hidden">Record ID <\/span><code id="detailRecordKey">v2-structure<\/code>.*data-copy-text="[^"]*#record=v2-structure" data-copy-label="Copy link">Copy link<\/button><\/p>/);
  const order = ['class="detail-top"', ">Values</h3>", ">Checks</h3>", ">Conditions</h3>", ">Protein and substrate</h3>", ">Paper</h3>",
    'id="downloadSelectedJson"', 'class="detail-footnote"'];
  const positions = order.map((part) => html.indexOf(part));
  assert.ok(positions.every((position) => position >= 0), `every part is drawn: ${positions}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "the parts come in the record's order");
  assert.match(html, /<caption>Printed in Table 2<\/caption><thead><tr><th scope="col">Parameter<\/th>/);
  assert.match(html, /<td class="vt-printed">68 s<sup>−1<\/sup><\/td><\/tr>/);
  assert.doesNotMatch(html, /<dt>Location<\/dt>/, "the Values caption says where the values are printed");
  assert.doesNotMatch(html, />Source<\/h3>|<dt>Values from<\/dt>|<dt>License<\/dt>|<dt>Data ID<\/dt>/);
  assert.doesNotMatch(html, /Against the databases/, "no database comparison in the snapshot: no section");
  assert.doesNotMatch(html, /<dt>Review result<\/dt>|Accepted: read from the paper by CatLog/, "the header says Accepted · from paper");
  assert.match(html, /<p class="section-link"><a class="method-link" href="#guide-how-read">How CatLog reads a value<span aria-hidden="true"> →<\/span><\/a><\/p><\/section>/);
  assert.match(html, /<p class="detail-footnote"><span class="detail-license">License: CC BY 4\.0 \(CatLog compilation\)<\/span>/);
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
  assert.match(element("detailContent").innerHTML, /<span class="detail-status-word">Not checked \(Not reviewed\)<\/span><span>not re-read<\/span><span>SKiD<\/span>/);
  // Its dot is the exact status's colour, as in the table: tan with its ring for Not reviewed, salmon with its ring for
  // Not confirmed, slate for Unverified.
  assert.match(element("detailContent").innerHTML, /<p class="detail-status" style="--status-color:var\(--st-not-reviewed\);--status-ring:var\(--st-not-reviewed-ring\)">/);
  api.renderDetail(row({ record_key: "status-words-2", verification_status: "manual_review_required", source_db: "sabio_rk;brenda" }), {});
  assert.match(element("detailContent").innerHTML, /<span class="detail-status-word">Not confirmed<\/span><span>not re-read<\/span><span>BRENDA, SABIO-RK<\/span>/);
  assert.match(element("detailContent").innerHTML, /style="--status-color:var\(--st-pending\);--status-ring:var\(--st-pending-ring\)"/);
  api.renderDetail(row({ record_key: "status-words-3", verification_status: "unverified", source_db: "unknown" }), {});
  assert.match(element("detailContent").innerHTML, /<span class="detail-status-word">Not checked \(Unverified\)<\/span><span>not re-read<\/span><span>source not recorded<\/span>/);
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
  // The method is the Guide's, linked once under Checks; no Method line repeats it on every record.
  assert.doesNotMatch(html, /<dt>Method<\/dt>|values stored as printed|second, separate AI check/);
  assert.match(html, /<dt>Second check<\/dt><dd>All values confirmed\.<\/dd><\/div><\/dl><p class="section-link"><a class="method-link" href="#guide-how-read">/);
  assert.match(html, /<p class="detail-subtitle">EC 2\.3\.1\.183 \(from enzyme databases; not printed in the paper\) &middot; Organism<\/p>/);
  assert.doesNotMatch(html, /<dt>Evidence<\/dt>|second, separate AI run|independent/);
  api.renderDetail(v2Summary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [line("kcat", "converted by code"), line("Km", "", "corrected: unit used for the conversion (was none, now mM)")] });
  html = element("detailContent").innerHTML;
  assert.doesNotMatch(html, /units converted by code/);
  // The Second check line sets kcat, Km and kcat/Km as the Values table does (italics, subscripts).
  assert.match(html, /<dt>Second check<\/dt><dd><i>k<\/i><sub>cat<\/sub>: confirmed; <i>K<\/i><sub>m<\/sub>: unit set to mM\.<\/dd>/);
  // As printed shows the printed cell beside the stored value: no line says "converted by code" on every record.
  assert.doesNotMatch(html, /converted by code|<ul class="value-notes">/);
  assert.match(html, /<p class="detail-subtitle">EC 2\.3\.1\.183 &middot; Organism<\/p>/);
  const badge = api.statusBadge(v2Summary);
  assert.match(badge, /aria-label="Accepted, from paper"/);
  assert.match(badge, /title="Read from the paper by an AI model; a second, separate AI check compared each value with the paper\."/);
  assert.match(api.statusBadge(row({ verification_status: "corrected" })), /aria-label="Accepted, Not yet re-read, BRENDA, corrected"/);
  // A unit in CatLog's own words reads as the page writes units, whether the exponent was typed with a caret or a hyphen.
  api.renderDetail(v2Summary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [line("kcat", "converted by code, printed unit read as 10^3 s-1", "corrected: unit set to 10^3 s-1")] });
  html = element("detailContent").innerHTML;
  assert.match(html, /<dt>Second check<\/dt><dd>Unit set to 10³ s⁻¹ for every value\.<\/dd>/);
  assert.match(html, /<li><i>k<\/i><sub>cat<\/sub>: printed unit read as 10³ s⁻¹\.<\/li>/);
  assert.equal(api.catlogUnitText("s-1 mM-1"), "mM⁻¹ s⁻¹");
  assert.equal(api.catlogUnitText("M-1s-1"), "M⁻¹s⁻¹");
  assert.equal(api.catlogUnitText("min-1 µM-1"), "min⁻¹ µM⁻¹");
  assert.equal(api.catlogUnitText("mmol-1 L-1"), "mmol⁻¹ L⁻¹");
  assert.equal(api.catlogUnitText("s^(-1)*mM^(-1)"), "mM⁻¹ s⁻¹");
  // An earlier correction's unit stored with its superscripts, and the file string, both read concentration first.
  assert.equal(api.catlogUnitText("s⁻¹ mM⁻¹"), "mM⁻¹ s⁻¹");
  assert.equal(api.catlogUnitText("s^-1 M^-1"), "M⁻¹ s⁻¹");
  assert.equal(api.catlogUnitText("s⁻¹ μM⁻¹"), "s⁻¹ μM⁻¹", "a printed unit in another concentration unit is left as it is");
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
  assert.match(html, /<dt>Second check<\/dt><dd>All values confirmed\.<\/dd><\/div><div class="kv-line"><dt>AI audit<\/dt><dd>Oct 11, 2026: re-checked against the paper and kept\.<\/dd>/);
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
  assert.match(confirmedHtml, /<td class="vt-printed">55\.06 µM<sup>−1<\/sup> min<sup>−1<\/sup>/);
  assert.doesNotMatch(confirmedHtml, /converted by code/, "As printed shows each printed cell; no line repeats the method");
  assert.doesNotMatch(confirmedHtml, /printed unit read as/);
  const bothSummary = v2({ record_key: "unit-both", kcat: 150, km: 2.9, kcat_over_km: 54, kcat_display: "150", km_display: "2.9",
    kcat_over_km_display: "54", kcat_unit: "s^(-1)", km_unit: "mM", kcat_over_km_unit: "s^(-1)*mM^(-1)" });
  const bothHtml = measurementSection(bothSummary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [proofLine("kcat", "150 ± 13", "s^-1", ""), proofLine("Km", "2.9 ± 0.4", "μM", "printed unit read as mM"),
      proofLine("kcat/Km", "54", "s^-1 μM^-1", "printed unit read as s^-1 mM^-1")] });
  assert.match(bothHtml, /The paper prints μM; CatLog stores mM, 1000-fold apart, and kcat ÷ Km cannot show which is right\./);
  assert.match(bothHtml, /The paper prints s⁻¹ μM⁻¹; CatLog stores mM⁻¹ s⁻¹, 1000-fold apart/);
  assert.doesNotMatch(bothHtml, /AI audit/, "no audit, no audit sentence");
  // An AI audit of the value ends its note with what it found (0f2107bac841d82f); the note stays amber.
  const auditedHtml = measurementSection(bothSummary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [proofLine("kcat", "150 ± 13", "s^-1", ""),
      { ...proofLine("Km", "2.9 ± 0.4", "μM", "printed unit read as mM"), audit_date: "2026-10-12", audit_result: "kept" },
      { ...proofLine("kcat/Km", "54", "s^-1 μM^-1", "printed unit read as s^-1 mM^-1"), audit_date: "2026-10-12", audit_result: "unit corrected" }] });
  assert.match(auditedHtml, /The paper prints μM; CatLog stores mM, 1000-fold apart, and kcat ÷ Km cannot show which is right\. An AI audit on Oct 12, 2026 re-checked it against the paper and kept mM\./);
  assert.match(auditedHtml, /CatLog stores mM⁻¹ s⁻¹, 1000-fold apart, and kcat ÷ Km cannot show which is right\. An AI audit on Oct 12, 2026 re-checked it against the paper and corrected its unit\./);
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
  assert.doesNotMatch(methodHtml, /values stored as printed|<dt>Method<\/dt>/);
  assert.match(methodHtml, /The paper prints μM; CatLog stores mM/, "the amber notes say which values are stored in another unit");
  // The same prefix read differently (M^-1 s^-1 for m^-1 s^-1) keeps the plain grey hint.
  const sameHtml = measurementSection(bothSummary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [proofLine("kcat/Km", "54", "M^-1 s^-1", "converted by code, printed unit read as 10^3 M-1 s-1")] });
  assert.doesNotMatch(sameHtml, /unit-caution|printed unit differs/);
  assert.match(plainMetricNames(sameHtml), /<li>kcat\/Km: printed unit read as 10³ M⁻¹ s⁻¹\.<\/li>/);
}
// A merged older record: the kcat/Km its sources list sits under the values, in the source's name and the catalog unit;
// when every one is more than 2-fold from kcat ÷ Km, an amber note says so.
{
  const merged = row({ record_key: "listed", kcat: 7.333, km: 0.5, kcat_over_km: 14.666, kcat_display: "7.333", km_display: "0.5",
    kcat_over_km_display: "14.666", kcat_over_km_origin: "calculated", kcat_unit: "s^(-1)", km_unit: "mM",
    kcat_over_km_unit: "s^(-1)*mM^(-1)", kcat_over_km_source_differs: true, source_db: "oed" });
  const listed = [3.0, 5.333, 3.083, 5.152, 6.117].map((value) => ({ value, unit: "1/mM*1/s", source_db: "oed" }));
  const html = measurementSection(merged, { source_kcat_over_km_values: listed });
  assert.match(plainMetricNames(html), /<dt>kcat\/Km listed by OED<\/dt><dd><span class="source-efficiency-value"><span><span class="listed-end">3\.0<\/span>–<span class="listed-end">6\.1<\/span> mM<sup>−1<\/sup> s<sup>−1<\/sup><\/span><small>5 values<\/small><\/span><\/dd>/);
  assert.match(html, /kcat ÷ Km \(15 mM⁻¹ s⁻¹\) is 2\.4–4\.9-fold above every kcat\/Km OED lists for this record \(3\.0–6\.1\)\./);
  assert.match(html, /aria-label="kcat\/Km mismatch\. Show the note\."/, "the Guide's caution name");
  // Every number in the Value column ends at the same place: a row without calc. or "!" keeps their space, unseen.
  assert.match(html, /<span class="vt-number">7\.33<\/span><small class="metric-origin vt-ghost" aria-hidden="true">calc\.<\/small><span class="value-flag vt-ghost" aria-hidden="true"><\/span><\/td>/);
  assert.match(html, /<span class="vt-number">15<\/span><small class="metric-origin" title="[^"]+">calc\.<\/small><button class="value-flag"/);
  assert.ok(plainMetricNames(html).indexOf("kcat/Km listed by OED") >= 0
    && plainMetricNames(html).indexOf("kcat/Km listed by OED") < plainMetricNames(html).indexOf("is 2.4–4.9-fold above"), "the listed values come first, under the values");
  // Its calc. note never says the source does not print a kcat/Km: it says CatLog calculated it and points at the listed one.
  assert.match(plainMetricNames(html), /<span class="metric-origin">calc\.<\/span> kcat ÷ Km, calculated by CatLog\. OED lists its own kcat\/Km \(above\)\.<\/li>/);
  assert.match(html, /<span class="metric-origin">calc\.<\/span> <i>k<\/i><sub>cat<\/sub> ÷ <i>K<\/i><sub>m<\/sub>, calculated by CatLog\. OED lists its own <i>k<\/i><sub>cat<\/sub>\/<i>K<\/i><sub>m<\/sub> \(above\)\.<\/li>/);
  assert.doesNotMatch(html, /not printed in the source/);
  const alone = measurementSection(merged, {});
  assert.match(plainMetricNames(alone), /<span class="metric-origin">calc\.<\/span> kcat ÷ Km, calculated by CatLog\.<\/li>/);
  const twoSources = measurementSection(merged, { source_kcat_over_km_values: [...listed, { value: 40, unit: "s^(-1)*mM^(-1)", source_db: "brenda" }] });
  assert.match(plainMetricNames(twoSources), /calculated by CatLog\. OED and BRENDA list their own kcat\/Km values \(above\)\./);
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
  assert.match(plainMetricNames(close), /kcat\/Km listed by BRENDA/);
  assert.doesNotMatch(close, /fold above|kcat\/Km mismatch/, "one listed value agrees: no note");
  // One kcat/Km flagged against kcat ÷ Km and against the listed values: one note says both (f93512e053523964).
  const older = (key, kcat, km, ratio, flags) => row({ record_key: key, kcat, km, kcat_over_km: Number(ratio), kcat_display: String(kcat),
    km_display: String(km), kcat_over_km_display: ratio, kcat_unit: "s^(-1)", km_unit: "mM", kcat_over_km_unit: "s^(-1)*mM^(-1)",
    kcat_over_km_source_differs: true, source_db: "brenda", condition_flags: flags });
  const both = ["kcat_over_km_quotient_mismatch", "kcat_over_km_source_mismatch"];
  const twice = measurementSection(older("twice", 4.1, 0.22, "46.067", both), { source_kcat_over_km_values: [{ value: 18.6, unit: "s^(-1)*mM^(-1)", source_db: "brenda" }] });
  assert.match(twice, /The stored kcat\/Km \(46\.1 mM⁻¹ s⁻¹\) is 2\.5-fold above kcat ÷ Km \(19 mM⁻¹ s⁻¹\)\. BRENDA lists kcat\/Km 18\.6 mM⁻¹ s⁻¹ for this record, which agrees with kcat ÷ Km\./);
  assert.equal((twice.match(/<li id="detailFlagNote/g) || []).length, 1, "one note for one mismatch");
  assert.doesNotMatch(twice, /more than 2-fold from the kcat\/Km shown|stored as the source lists them/);
  const some = measurementSection(older("some", 0.076, 1.26, "227.78", both), { source_kcat_over_km_values: [
    { value: 0.06027, unit: "s^(-1)*mM^(-1)", source_db: "brenda" }, { value: 5, unit: "s^(-1)*mM^(-1)", source_db: "brenda" }] });
  assert.match(some, /BRENDA lists 2 kcat\/Km values for this record \(0\.060–5\.0 mM⁻¹ s⁻¹\); one of them agrees with kcat ÷ Km\./);
  // Without listed values in the catalog unit the flags keep their own notes.
  assert.match(measurementSection(older("bare", 4.1, 0.22, "46.067", both), {}), /The source&#39;s kcat\/Km \(46\.1 mM⁻¹ s⁻¹\) is 2\.5-fold above/);
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
  // A temperature the paper does not state is spelled out: the table has no T column to explain "T".
  const noTemperature = api.lookAlikeRowKeys([twin("n1", { substrate_name: "serine", temperature_display: "", kcat_display: "3" }),
    twin("n2", { substrate_name: "serine", temperature_display: "60", ph_display: "8" })]);
  assert.deepEqual(["n1", "n2"].map((key) => noTemperature.get(key)), ["pH 7 · temperature not stated", "pH 8 · 60 °C"]);
  const neither = api.lookAlikeRowKeys([twin("m1", { substrate_name: "serine", temperature_display: "", ph_display: "", kcat_display: "3" }),
    twin("m2", { substrate_name: "serine", temperature_display: "60", ph_display: "8" })]);
  assert.deepEqual(["m1", "m2"].map((key) => neither.get(key)), ["pH and temperature not stated", "pH 8 · 60 °C"]);
  assert.equal(notes.get("same1"), "", "a record that shares its temperature and pH with another still reads alike");
  assert.equal(notes.get("same3"), "pH 8");
  assert.equal(api.substrateNoteHtml(assay[0], notes), '<small class="condition-note" title="pH 6.5; otherwise the same as another record of this paper">pH 6.5</small>');
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
// The line quoted from the paper: "In the paper:" (with its place or its values in brackets when needed), table markers
// gone, K_M and k_{cat} as K<sub>m</sub> and k<sub>cat</sub>; a long table row or one whose ± signs were lost is folded
// away with a warning.
{
  const v2Summary = row({ record_key: "printed-lines", source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name" });
  const quoted = (printed_line, metric = "Km") => measurementSection(v2Summary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [{ metric, table_label: "Table 2", printed: "1 mM", printed_line, check: "confirmed", conversion: "" }] });
  let html = quoted("mpCAR [rowspan] | K_m [mm] | 20±4*");
  // The caption above the table names the place, so the line does not repeat it.
  assert.match(html, /<caption>Printed in Table 2<\/caption>/);
  assert.match(html, /<p class="evidence-note-plain">In the paper: “mpCAR \| <i>K<\/i><sub>m<\/sub> \[mm\] \| 20±4\*”<\/p>/);
  assert.doesNotMatch(html, /as extracted|As extracted/);
  assert.doesNotMatch(html, /rowspan|<details class="printed-line-disclosure"/);
  html = quoted("We fitted K_M = 4.6 ± 1.0 μM, k_{cat} = 9.7 s^{−1} and K_{m L}-methionine");
  assert.match(html, /<i>K<\/i><sub>m<\/sub> = 4\.6/);
  assert.match(html, /<i>k<\/i><sub>cat<\/sub> = 9\.7 s<sup>−1<\/sup>/);
  assert.match(html, /<i>K<\/i><sub>m L<\/sub>-methionine/);
  // A caret charge is a superscript too (NADP^+, Mn^2+, Mn^{2+}, CN^−, a bare "^-" extraction left), and an exponent
  // extraction split ("min^− 1", "10^−^3") is read whole; exponents stay as they were.
  html = quoted("Km[NADP^+] 4 mM with Mn^2+ or Mn^{2+}; CN^− → OAS; 590 min^− 1; 9.1 × 10^- ; 9.1 × 10^−^3; Cl^− 5 mM; k_{cat} 3 s^-1, 2 M^(-2)");
  assert.match(html, /Km\[NADP<sup>\+<\/sup>\] 4 mM with Mn<sup>2\+<\/sup> or Mn<sup>2\+<\/sup>; CN<sup>−<\/sup> → OAS; 590 min<sup>−1<\/sup>; 9\.1 × 10<sup>−<\/sup> ; 9\.1 × 10<sup>−3<\/sup>;/);
  assert.match(html, /Cl<sup>−<\/sup> 5 mM/, "an ion's charge before a concentration is not an exponent");
  assert.match(html, /<i>k<\/i><sub>cat<\/sub> 3 s<sup>−1<\/sup>, 2 M<sup>−2<\/sup>/);
  assert.equal(api.caretHtml("NAD^{+}-dependent, 10^3 M^-1 s^-1"), "NAD<sup>+</sup>-dependent, 10<sup>3</sup> M<sup>−1</sup> s<sup>−1</sup>");
  html = quoted("L-phenylalanine wt 1.1 ( 0.070 68 ( 1.4 62");
  assert.match(html, /<details class="printed-line-disclosure"><summary>Show the printed line<\/summary><p class="evidence-note-plain">In the paper: /);
  assert.match(html, /<p class="printed-line-note">Text extraction dropped the ± signs from this line\.<\/p><\/details>/);
  const longRow = quoted("2Np-Gal | 0.9 ± 0.1 | 295.0 ± 6.3 | 310.0 | 24.7 ± 3.9");
  assert.match(longRow, /<details class="printed-line-disclosure">/, "more than four cells");
  assert.doesNotMatch(longRow, /printed-line-note/, "a row that kept its ± signs gets no warning");
  assert.doesNotMatch(measurementSection(v2Summary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [{ metric: "Km", table_label: "Results, p. 4", printed: "1 mM", printed_line: "a Km of 1 mM", check: "confirmed", conversion: "" }] }),
  /In the paper \(/, "the caption names the place: the line does not repeat it");
  const lines = (...entries) => measurementSection(v2Summary, { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: entries.map(([metric, table_label, printed_line, printed = "1 mM"]) => ({ metric, table_label, printed, printed_line, check: "confirmed", conversion: "" })) });
  // One line, places that differ: the line gives its place (the Where column has both).
  html = lines(["kcat", "Table 2", "wt | 1 | 2", "1 s^-1"], ["Km", "Table 3", "1 mM"]);
  assert.match(html, /<p class="evidence-note-plain">In the paper \(Table 2\): “wt/);
  // A sentence (no cells) is not a row, even when the values are said to be in a table.
  html = lines(["kcat", "Table VIII", "the K values for ETF were 3.8, 4.5 and 8.3", "1 s^-1"], ["Km", "Table 3", "1 mM"]);
  assert.match(html, /<p class="evidence-note-plain">In the paper \(Table VIII\): “the K values/);
  // More than one line: each names its values, and a line another value's line continues is quoted once, the longer.
  const excerpt = "kcat = 4.0 ± 0.4 s–1 and Km = 3.1 mM catalyze the conversion";
  html = lines(["kcat", "Results", excerpt, "4.0 ± 0.4 s^-1"], ["Km", "Results", "a Km of 3.1 ± 0.3 mM was found"],
    ["kcat/Km", "Results", `${excerpt} of this peptide …`, "1.4 mM^-1 s^-1"]);
  assert.equal((html.match(/class="evidence-note-plain"/g) || []).length, 2);
  assert.match(plainMetricNames(html), /<p class="evidence-note-plain">In the paper \(kcat and kcat\/Km\): “kcat = 4\.0 ± 0\.4 s–1 and Km = 3\.1 mM catalyze the conversion of this peptide …”<\/p>/);
  assert.match(plainMetricNames(html), /<p class="evidence-note-plain">In the paper \(Km\): “a Km of 3\.1/);
  assert.doesNotMatch(html, /In the paper \(Results\)/, "the caption names the place");
  // Folded lines name their values, so two toggles never read alike.
  html = lines(["kcat", "Table 2", "kcat | 1 | 2 | 3 | 4", "1 s^-1"], ["Km", "Table 2", "Km | 1 | 2 | 3 | 4"]);
  assert.match(plainMetricNames(html), /<summary>Show the printed kcat line<\/summary><p class="evidence-note-plain">In the paper \(kcat\): /);
  assert.match(plainMetricNames(html), /<summary>Show the printed Km line<\/summary>/);
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
  assert.match(plainMetricNames(html), /<dt>Second check<\/dt><dd>kcat: confirmed; Km: qualifier corrected\. The AI check also removed EC 2\.7\.2\.12 and corrected the assay conditions \(see Conditions\)\.<\/dd>/);
  assert.doesNotMatch(html, /\(was |unit used for the conversion/);
  // Phrases already in plain words pass through; a caution on a confirmed value is pointed to.
  html = render([line("kcat", "confirmed"), line("Km", "confirmed"), line("kcat/Km", "confirmed")]);
  assert.match(html, /All values confirmed\.<\/dd>/);
  api.renderDetail(row({ record_key: "checks-flag", source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name",
    kcat: 8.5, km: 320, kcat_over_km: 0.033, kcat_display: "8.5", km_display: "320", kcat_over_km_display: "0.033",
    condition_flags: ["kcat_over_km_quotient_mismatch"] }), { verification_method: "catlog_v2_read_and_independent_verify",
    proof_lines: [line("kcat", "confirmed"), line("Km", "confirmed"), line("kcat/Km", "confirmed")] });
  assert.match(element("detailContent").innerHTML, /<dt>Second check<\/dt><dd>All values confirmed as printed; see the note on <i>k<\/i><sub>cat<\/sub>\/<i>K<\/i><sub>m<\/sub>\.<\/dd>/);
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
  assert.match(html, /<dt>As printed<\/dt><dd>Table III, row Butanol: V1 = 5\.2 \(unit row: s<sup>−1<\/sup>\)<\/dd>/);
  assert.match(html, /<dt>Conversion<\/dt><dd>kcat: paper V1 cell 5\.2 s<sup>−1<\/sup> → 5\.2 s<sup>−1<\/sup> \(no conversion\)\.<\/dd>/);
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
  // The notes' slips read cleanly (text_check): a quotient to six or more decimals reads to four significant digits, as
  // the Values table shows it (a small number keeps its digits); a note cut before its first label opens with "kcat";
  // Python's 4.69e+01 reads 4.69 × 10^1; "catalog units" is the catalog's units.
  assert.equal(api.conversionFacts("1.1 s^-1; K_B = 13 mM; kcat/K_B = 1.1/13 = 0.084615 s^-1 mM^-1"),
    "kcat 1.1 s^-1; K_B = 13 mM; kcat/K_B = 1.1/13 = 0.08462 s^-1 mM^-1.");
  assert.equal(api.conversionFacts("1.2 s^-1; 33 uM = 0.033 mM; kcat/K_A = 1.2/0.033 = 36.363636 s^-1 mM^-1"),
    "kcat 1.2 s^-1; 33 µM = 0.033 mM; kcat/K_A = 1.2/0.033 = 36.36 s^-1 mM^-1.");
  assert.equal(api.conversionFacts("kcat 548 min-1 = 9.133333. Km=0.91 mM."), "kcat 548 min-1 = 9.133. Km=0.91 mM.");
  assert.equal(api.conversionFacts("0.013 uM = 0.000013 mM; 0.53 uM min-1 = 0.00000000883 M s-1."), "0.013 µM = 0.000013 mM; 0.53 µM min-1 = 0.00000000883 M s-1.");
  assert.equal(api.conversionFacts("290 uM = 0.29 mM."), "290 µM = 0.29 mM.", "a lone concentration keeps its words");
  assert.equal(api.conversionFacts("kcat/Km 0.0469 s-1 mM-1 (converted by code from 4.69e+01 s-1 M-1)."),
    "kcat/Km 0.0469 s-1 mM-1 (converted by code from 4.69 × 10^1 s-1 M-1).");
  assert.equal(api.conversionFacts("kcat/Km 130 s-1 mM-1 (converted by code from 13 × 10^{4.}(s-1/M))."),
    "kcat/Km 130 s-1 mM-1 (converted by code from 13 × 10^{4}(s-1/M)).");
  assert.equal(api.conversionFacts("Central values in catalog units are Km = 0.12 mM."), "Central values in the catalog's units are Km = 0.12 mM.");
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
    /\|As printed\|Km 75 ± 5 µM; kcat 0\.05 s\|−1\|; kcat\/Km 6\.00 × 10\|2\| M\|−1\| s\|−1\|$/);
  assert.match(note({ table_label: "Abstract kinetic prose segment", raw_value_unit_evidence: "Km raw_value=60 microM raw_unit=microM raw_cell=Kms were 66 microM (NADPH) and 60 microM [(S)-HMG-CoA]" }),
    /\|As printed\|Km 60 µM, printed “Kms were 66 µM \(NADPH\) and 60 µM \[\(S\)-HMG-CoA\]”\|$/);
  assert.match(note({ table_label: "Table 2", raw_value_unit_evidence: "kcat raw_value=0.022 raw_unit=s^-1 raw_cell=(2.2 +/- 0.1) x 10-2; KM raw_value=184 raw_unit=uM raw_uncertainty=+/- 6 uM" }),
    /\|As printed\|kcat 0\.022 s\|−1\|, printed “\(2\.2 ± 0\.1\) x 10-2”; KM 184 µM ± 6 µM\|$/);
  assert.equal(note({ table_label: "TABLE 4 'Steady-state kinetic constants'", row_label: "TABLE 4, decoded plain-numeral transcription, substrate row `NADH`",
    normalized_value_unit_evidence: "kcat/Km: the paper PRINTS the kcat/Km cell 1490 s^-1 mM^-1 for this substrate row" }),
  "|Where|TABLE 4 'Steady-state kinetic constants' · TABLE 4, substrate row NADH|Conversion|kcat/Km: the paper prints the kcat/Km cell 1490 s|−1| mM|−1| for this substrate row.|");
  assert.equal(note({ table_label: "ScienceDirect HTML Table 1, Kinetic properties of I. isl MalDH", row_label: "Pyruvate",
    normalized_value_unit_evidence: "kcat=8 s^-1. No Km was populated in the expected row, and Table 1 leaves Km blank for pyruvate." }),
  "|Where|Table 1, Kinetic properties of I. isl MalDH · Pyruvate|Conversion|kcat=8 s|−1|. The earlier version's entry has no Km, and Table 1 leaves Km blank for pyruvate.|");
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
  // A record read by CatLog has no Source section: its header says "from paper", the Guide how it was read, and its
  // footnote gives the license and the snapshot.
  assert.doesNotMatch(html, />Source<\/h3>|<dt>Values from<\/dt>|<dt>Method<\/dt>|<dt>Name from<\/dt>/);
  assert.match(html, /<span class="detail-status-word">Accepted<\/span><span>from paper<\/span>/);
  assert.doesNotMatch(html, /<dt>Source<\/dt>/, "the Source section's first row does not repeat its heading");
  // The source's own details are rows of the Source section (each wraps; nothing to open at the record's end).
  assert.doesNotMatch(html, /Source details|<details class="detail-disclosure"/);
  html = render({ source_db: "strenda", proof_kind: "source_note", has_proof_excerpt: false },
    { proof_lines: ["Raw STRENDA Extraction: kcat/Km\t4200.0 (+/-) 290.0 M⁻¹ s⁻¹"] });
  assert.match(html, /<summary>Note from STRENDA DB<\/summary>/);
  assert.match(html, /<p class="evidence-note-plain">kcat\/Km 4200\.0 ± 290\.0 M⁻¹ s⁻¹<\/p>/);
  assert.match(html, /<dt>Values from<\/dt><dd>STRENDA DB<\/dd>/);
  assert.doesNotMatch(html, /Raw STRENDA|<dt>Evidence<\/dt><dd>Database note/);
  html = render({ source_db: "sabio_rk;brenda", enzyme_label_source: "brenda_recommended_name", proof_kind: "source_note",
    has_proof_excerpt: false, temperature_display: "25", ph_display: "7.5" }, { proof_lines: ["pH 7.5, 25°C"] });
  assert.match(html, /<dt>Values from<\/dt><dd>BRENDA, SABIO-RK<\/dd>/, "named as the status line names them");
  assert.match(html, /<dt>Name from<\/dt><dd>BRENDA recommended name<\/dd>/);
  assert.match(html.slice(html.indexOf('class="detail-section source-section"'), html.indexOf('class="detail-section conditions-section"')),
    /<dt>Values from<\/dt><dd>BRENDA, SABIO-RK<\/dd><\/div><div class="kv-line"><dt>Name from<\/dt><dd>BRENDA recommended name<\/dd>/,
    "Name from follows Values from in its section");
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
  assert.match(html, /<dt>Values from<\/dt><dd>BRENDA, SABIO-RK, SKiD<\/dd>/);
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
  assert.match(body, /kcat 7\.33 s⁻¹; Km 0\.5 mM; kcat\/Km 15 mM⁻¹ s⁻¹; PMID 2936344/, "440/60 stored as 7.333 shows 3 figures");
  assert.doesNotMatch(body, /14\.666|7\.333/);
  assert.match(html, /<h3 id="detail-paper-title">Paper<\/h3><dl class="detail-kv"><div class="kv-line"><dt>Title<\/dt><dd>Probing an invariant His \(2019\)<\/dd><\/div>/);
  api.renderDetail(row({ record_key: "no-title" }), {});
  assert.doesNotMatch(element("detailContent").innerHTML, /<dt>Title<\/dt>/);
}

// Against the databases (round 9 brief, section 4): a record read from the paper shows its values against the
// databases only when the snapshot carries the comparison (each value's database_status ... fields, the record's
// database_note, or the snapshot's record checks): the paper's note in a box, the values a database lists with the
// same number in lines, a folding note per other value, the compared databases from the manifest and links to records
// like it; an earlier "corrected" record its correction trail; a database record the earlier review did not settle
// that its values are the database's; any other record has no section (never an empty heading).
{
  const v2Summary = row({ record_key: "v2-db", measurement_key: "v2-db", source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name",
    kcat: 30.4, km: 549.9, kcat_over_km: 0.06, kcat_display: "30.4", km_display: "549.9", kcat_over_km_display: "0.06",
    kcat_unit: "s^(-1)", km_unit: "mM", kcat_over_km_unit: "s^(-1)*mM^(-1)", kcat_over_km_origin: "paper_reported" });
  const line = (metric, extra = {}) => ({ metric, table_label: "Table 1", printed: "1", check: "confirmed", conversion: "", ...extra });
  const render = (summary, detail) => {
    api.renderDetail(summary, detail);
    return element("detailContent").innerHTML;
  };
  const sectionOf = (html) => html.slice(html.indexOf('class="detail-section databases-section'), html.indexOf('class="detail-section checks-section"'));
  const valuesOf = (html) => html.slice(html.indexOf('class="detail-section values-section"'), html.indexOf('class="detail-section databases-section'));
  const v2Detail = (lines, extra = {}) => ({ verification_method: "catlog_v2_read_and_independent_verify", supporting_pmids: ["31072150"], proof_lines: lines, ...extra });
  // A phone (the test page's media queries match nothing) or a wider screen (641px and up).
  const wideScreen = (wide, callback) => {
    const previous = window.matchMedia;
    window.matchMedia = (query) => (query === "(min-width: 641px)" ? { matches: wide, addEventListener() {} } : previous(query));
    try {
      return callback();
    } finally {
      window.matchMedia = previous;
    }
  };
  let html = render(v2Summary, v2Detail([line("kcat"), line("Km")]));
  assert.doesNotMatch(html, /Against the databases|cmp-mark|cmp-pointer/);
  const comparedDetail = () => v2Detail([
    line("kcat", { database_status: "confirmed", database_line: "Same as BRENDA, SABIO-RK.", database_sources: ["BRENDA", "SABIO-RK"] }),
    line("Km", { database_status: "corrected", database_line: "BRENDA lists 0.5499 mM, 1,000× lower.", database_cause: "mM_entered_as_uM",
      database_sources: ["BRENDA", "STRENDA"], database_evidence: "Table 1, row Cellobiose: 549.9 ± 62.5" }),
    line("kcat/Km", { database_status: "new", database_line: "None of the compared databases lists this kcat/Km for this paper." }),
  ], { database_note: "All 12 BRENDA Km values for this paper are 1000× lower than printed." });
  html = render(v2Summary, comparedDetail());
  let section = sectionOf(html);
  // The paper's note in a box, said as given after "Across this paper:"; no link while Browse cannot filter by it.
  // The heading's "?" (the filter groups' pattern) controls a quiet box, closed at first, that names the compared databases
  // once; the paper's note follows.
  assert.match(section, /<h3 id="detail-databases-title">Against the databases<\/h3><button class="section-about" type="button" aria-expanded="false" aria-controls="detail-databases-about" title="About the comparison with the databases"><span aria-hidden="true">\?<\/span><span class="visually-hidden">About the comparison with the databases<\/span><\/button><div class="filter-about detail-about" id="detail-databases-about" hidden><p class="cmp-compared">[\s\S]*?<\/div><div class="cmp-paper-note"><p><strong>Across this paper:<\/strong> All 12 BRENDA Km values for this paper are 1000× lower than printed\.<\/p><\/div>/);
  assert.match(section, /^class="detail-section databases-section has-about" aria-labelledby="detail-databases-title">/);
  // A value a database lists with the same number: one line, its line whole.
  assert.match(section, /<p class="cmp-same-line"><span class="cmp-mark cmp-same" aria-hidden="true"><\/span><span><i>k<\/i><sub>cat<\/sub>: Same as BRENDA, SABIO-RK\.<\/span><\/p>/);
  // A value that is not the same: a folding note. Its summary says the parameter and the result (the line names the
  // databases); its body CatLog's line whole, the cause only where the line does not say it (here the factor does), and
  // the checker's notes folded under "How it was checked". On a phone only the first note on a correction or a different
  // number is open.
  assert.match(section, /<details class="cmp-note" data-cmp-field="km" open><summary><span class="cmp-note-head"><i>K<\/i><sub>m<\/sub><span class="cmp-sep" aria-hidden="true"> · <\/span><\/span><span class="cmp-result"><span class="cmp-mark cmp-magnitude" aria-hidden="true"><\/span><strong>Corrects a value<\/strong><\/span><\/summary><div class="cmp-note-body"><p class="cmp-line">BRENDA lists 0\.5499 mM, 1,000× lower\.<\/p><details class="cmp-how"><summary>How it was checked<\/summary><p>Table 1, row Cellobiose: 549\.9 ± 62\.5<\/p><\/details><\/div><\/details>/);
  assert.doesNotMatch(section, /<dt>Cause<\/dt>|<dt>In the paper<\/dt>|list another number/);
  assert.match(section, /<details class="cmp-note" data-cmp-field="kcat_over_km"><summary><span class="cmp-note-head"><i>k<\/i><sub>cat<\/sub>\/<i>K<\/i><sub>m<\/sub><span class="cmp-sep" aria-hidden="true"> · <\/span><\/span><span class="cmp-result"><span class="cmp-mark cmp-new" aria-hidden="true"><\/span><strong>Not in the databases<\/strong><\/span><\/summary><div class="cmp-note-body"><p class="cmp-line">None of the compared databases lists this kcat\/Km for this paper\.<\/p><\/div><\/details>/);
  // The compared databases (the six fallback names: this snapshot neither lists nor counts them), each kept whole on one
  // line (SABIO-RK never breaks at its hyphen, STRENDA DB at its space), and the caption's second sentence: said once, in
  // the "?" box, never as a footer on every record (the user, 2026-10-15). No Guide link while the Guide has no section.
  assert.match(section, /<div class="filter-about detail-about" id="detail-databases-about" hidden><p class="cmp-compared">Compared with the values <span class="nowrap">BRENDA<\/span>, <span class="nowrap">SABIO-RK<\/span>, <span class="nowrap">OED<\/span>, <span class="nowrap">SKiD<\/span>, <span class="nowrap">STRENDA DB<\/span> and <span class="nowrap">UniProt<\/span> list for the same paper\.<\/p><\/div>/);
  assert.doesNotMatch(section, /cmp-footer|guide-databases/);
  assert.equal((section.match(/does not by itself mean a database is wrong/g) || []).length, 0, "no Different number: no caveat anywhere in the record");
  assert.doesNotMatch(section, /cmp-caution-line/);
  // No More like this while Browse cannot filter by a result: the paper's records are linked once, under Paper.
  assert.doesNotMatch(section, /cmp-explore|All records of this paper/);
  assert.doesNotMatch(section, /db=|<table|cmp-list|Not in any database|Same number, other label/);
  // Right after Values: what CatLog corrected against the databases is found at once; Checks follow it.
  assert.ok(html.indexOf(">Values</h3>") < html.indexOf(">Against the databases</h3>") && html.indexOf(">Against the databases</h3>") < html.indexOf(">Checks</h3>"));
  // Section B: a value that corrects or differs gets one short line under the Values table, the parameter and a button
  // that opens its note ("corrects BRENDA and STRENDA DB ↓"); the table itself carries no comparison mark.
  const values = valuesOf(html);
  assert.match(values, /<\/table><p class="cmp-pointer"><i>K<\/i><sub>m<\/sub>: <button class="text-button cmp-pointer-link" type="button" data-show-note="km">corrects BRENDA and STRENDA DB<span class="visually-hidden">, see Against the databases<\/span><span aria-hidden="true"> ↓<\/span><\/button><\/p>/);
  assert.equal((values.match(/cmp-pointer"/g) || []).length, 1, "only the value that corrects or differs");
  assert.doesNotMatch(values.slice(0, values.indexOf("</table>")), /cmp-mark/);
  // Its button opens the note, scrolls it into view and focuses its summary.
  {
    const summaryElement = { focused: false, focus() { this.focused = true; } };
    const note = { open: false, tabIndex: 0, scrolled: null, classList: makeElement("details").classList,
      querySelector: (selector) => (selector === "summary" ? summaryElement : null), scrollIntoView(options) { this.scrolled = options; } };
    const previousQuery = document.querySelector;
    document.querySelector = (selector) => (selector === '#detailContent .cmp-note[data-cmp-field="km"]' ? note : null);
    try {
      api.showDatabaseNote("km");
    } finally {
      document.querySelector = previousQuery;
    }
    assert.equal(note.open, true);
    assert.equal(note.scrolled?.block, "center");
    assert.equal(summaryElement.focused, true);
  }
  // From 641px every note on a correction or a different number is open; others stay closed (nothing is remembered).
  const notesOpen = (detail, wide) => wideScreen(wide, () => [...sectionOf(render(v2Summary, detail))
    .matchAll(/<details class="cmp-note" data-cmp-field="(\w+)"( open)?>/g)].map((match) => [match[1], Boolean(match[2])]));
  const twoChanged = v2Detail([
    line("kcat", { database_status: "differs", database_line: "OED lists 41 s⁻¹ (CatLog: 38 s⁻¹).", database_sources: ["OED"] }),
    line("Km", { database_status: "same_number_other_label", database_line: "SABIO-RK lists this number for substrate 'NAD+'.", database_sources: ["SABIO-RK"] }),
    line("kcat/Km", { database_status: "corrected", database_line: "BRENDA lists 60 mM⁻¹ s⁻¹.", database_sources: ["BRENDA"] }),
  ]);
  assert.deepEqual(notesOpen(twoChanged, true), [["kcat", true], ["km", false], ["kcat_over_km", true]]);
  assert.deepEqual(notesOpen(twoChanged, false), [["kcat", true], ["km", false], ["kcat_over_km", false]]);
  html = render(v2Summary, twoChanged);
  // A record with a Different number says the caution in one line right under its notes, and its "?" box leaves it out:
  // the record says it once (the reviewer: with the box open it showed twice).
  assert.match(sectionOf(html), /<\/details><\/div><p class="section-note cmp-caution-line">A different number can mean a different measurement; it does not by itself mean a database is wrong\.<\/p>/);
  assert.equal((sectionOf(html).match(/cmp-caution-line/g) || []).length, 1, "one line, however many values differ");
  assert.equal((sectionOf(html).match(/A different number can mean/g) || []).length, 1, "said once");
  assert.match(sectionOf(html), /<p class="cmp-compared">Compared with the values [^<]*(?:<span class="nowrap">[^<]*<\/span>[^<]*)* for the same paper\.<\/p>/);
  // The "?" box links the Guide's section when the Guide has it (the manifest's comparison or the record index's).
  {
    const previousSummary = runtimeManifest.summary;
    runtimeManifest.summary = { ...(previousSummary || {}), database_comparison: { values_by_database: { BRENDA: {} } } };
    try {
      assert.match(sectionOf(render(v2Summary, twoChanged)), /<div class="filter-about detail-about" id="detail-databases-about" hidden><p class="cmp-compared">Compared with the values <span class="nowrap">BRENDA<\/span> lists for the same paper\.<\/p><p><a href="#guide-databases">Against the databases in the Guide<span aria-hidden="true">&nbsp;&rarr;<\/span><\/a><\/p><\/div>/);
    } finally {
      runtimeManifest.summary = previousSummary;
    }
  }
  // The same number under another label: the result word (its line says which database and label); a different number
  // in brown. The record says once which databases list another number: in the note's line.
  assert.match(html, /<i>K<\/i><sub>m<\/sub><span class="cmp-sep" aria-hidden="true"> · <\/span><\/span><span class="cmp-result"><span class="cmp-mark cmp-neutral" aria-hidden="true"><\/span><strong>Same, other label<\/strong><\/span>/);
  assert.match(html, /<i>k<\/i><sub>cat<\/sub><span class="cmp-sep" aria-hidden="true"> · <\/span><\/span><span class="cmp-result"><span class="cmp-mark cmp-differs" aria-hidden="true"><\/span><strong>Different number<\/strong>/);
  assert.equal((html.match(/OED lists/g) || []).length, 1, "the databases are named once, in the line");
  assert.match(valuesOf(html), /<i>k<\/i><sub>cat<\/sub>: <button[^>]*data-show-note="kcat">differs from OED</);
  assert.match(valuesOf(html), /<i>k<\/i><sub>cat<\/sub>\/<i>K<\/i><sub>m<\/sub>: <button[^>]*data-show-note="kcat_over_km">corrects BRENDA</);
  // Every correction is red, whatever its cause.
  html = render(v2Summary, v2Detail([line("Km", { database_status: "corrected", database_line: "BRENDA lists the value of another row.", database_cause: "value_from_other_row", database_sources: ["BRENDA"] })]));
  assert.match(html, /<span class="cmp-mark cmp-magnitude" aria-hidden="true"><\/span><strong>Corrects a value<\/strong>/);
  assert.match(html, /<dt>Cause<\/dt><dd>a value from another cell of the table<\/dd>/);
  // The cause comes from database_cause and is said once: a line that ends with what the check against the paper found
  // (its database_parts.cause), or that names the factor between the numbers, has no Cause row under it; a cause code
  // found automatically has its words where the line does not give the factor.
  html = render(v2Summary, v2Detail([line("Km", { database_status: "corrected", database_cause: "uM_entered_as_mM", database_sources: ["BRENDA"],
    database_line: "BRENDA lists 630 mM, 1,000× higher. The paper prints 630 ± 170 µM (Table 1). Checked against the paper: µM entered as mM." })]));
  assert.match(html, /Checked against the paper: µM entered as mM\.<\/p><\/div><\/details>/);
  html = render(v2Summary, v2Detail([line("Km", { database_status: "corrected", database_cause: "value_from_other_row", database_sources: ["BRENDA"],
    database_line: "BRENDA lists 0.96 mM. Checked against the paper: a number from another cell of the table.",
    database_parts: { lists: "BRENDA lists 0.96 mM.", cause: "Checked against the paper: a number from another cell of the table." } })]));
  assert.doesNotMatch(html, /<dt>Cause<\/dt>/, "the line's own cause part says it");
  for (const [code, said] of [["power_of_ten", "BRENDA lists 15 mM⁻¹ s⁻¹, 10× higher."], ["printed_number_unit_not_applied", "SABIO-RK lists 32 mM: the printed number in mM."],
    ["time_factor", "BRENDA and OED list 1,260 s⁻¹ = the printed 21 × 60."], ["time_factor", "BRENDA lists 100 mM⁻¹ s⁻¹ (60× CatLog's value)."],
    ["different_measurement", "BRENDA lists 0.02 mM⁻¹ s⁻¹ for another measurement in this paper (checked against the paper)."]]) {
    html = render(v2Summary, v2Detail([line("kcat", { database_status: "corrected", database_line: said, database_cause: code, database_sources: ["BRENDA"] })]));
    assert.doesNotMatch(html, /<dt>Cause<\/dt>/, said);
  }
  // A time unit is worded as CatLog's line words it (catlog-v2 site_release.CAUSE_TEXT), so a line that says it is not
  // said again under it.
  html = render(v2Summary, v2Detail([line("kcat", { database_status: "corrected", database_cause: "time_unit", database_sources: ["BRENDA"],
    database_line: "BRENDA lists 0.2 s⁻¹. Checked against the paper: a time unit taken for another (seconds, minutes or hours)." })]));
  assert.doesNotMatch(html, /<dt>Cause<\/dt>/);
  assert.equal((html.match(/a time unit taken for another/g) || []).length, 1);
  for (const [code, words] of [["power_of_ten", "off by an exact power of ten"], ["printed_number_unit_not_applied", "the printed number taken in another unit"],
    ["time_factor", "off by exactly 60 or 3,600"], ["header_scale_inverted", "the table header&#39;s power of ten applied the wrong way"],
    ["time_unit", "a time unit taken for another \\(seconds, minutes or hours\\)"]]) {
    html = render(v2Summary, v2Detail([line("kcat", { database_status: "corrected", database_line: "OED lists 0.5 s⁻¹.", database_cause: code, database_sources: ["OED"] })]));
    assert.match(html, new RegExp(`<dt>Cause</dt><dd>${words}</dd>`), code);
  }
  // An exact factor nothing has yet checked against the paper (database_found_by factor_only) is Different number
  // (exact factor, not yet checked), in brown, whatever the snapshot's status calls it; the result says it is not yet
  // checked and the line gives the factor, so no Cause row repeats them; the download gives the cause in words.
  const factorOnly = line("Km", { database_status: "corrected", database_found_by: "factor_only", database_cause: "power_of_ten", database_sources: ["SABIO-RK"],
    database_line: "SABIO-RK lists 0.0036 mM, 1,000× lower. The paper prints 3.6 mM (Results p.1059).",
    database_by_source: [{ db: "SABIO-RK", kind: "corrected", unit: "mM", value: 0.0036, x: 0.001 }, { db: "OED", kind: "other_values_only" }] });
  html = render(v2Summary, v2Detail([factorOnly]));
  assert.match(html, /<i>K<\/i><sub>m<\/sub><span class="cmp-sep" aria-hidden="true"> · <\/span><\/span><span class="cmp-result"><span class="cmp-mark cmp-differs" aria-hidden="true"><\/span><strong>Different number \(exact factor, not yet checked\)<\/strong>/);
  assert.doesNotMatch(html, /Corrects a value|cmp-magnitude|<dt>Cause<\/dt>|not yet checked against the paper/);
  assert.match(html, /cmp-caution-line/, "a Different number: the record says the caution");
  assert.match(valuesOf(html), /<i>K<\/i><sub>m<\/sub>: <button[^>]*data-show-note="km">differs from SABIO-RK</);
  assert.deepEqual(JSON.parse(JSON.stringify(api.publicRecordObject(v2Summary, v2Detail([factorOnly])).database_comparison)), [{ metric: "Km",
    result: "Different number (exact factor, not yet checked)", line: "SABIO-RK lists 0.0036 mM, 1,000× lower. The paper prints 3.6 mM (Results p.1059).",
    databases: "SABIO-RK", cause: "off by an exact power of ten", evidence: null }]);
  // A line that does not give the factor: the Cause row names it (from database_by_source).
  html = render(v2Summary, v2Detail([{ ...factorOnly, database_line: "SABIO-RK lists 0.0036 mM." }]));
  assert.match(html, /<dt>Cause<\/dt><dd>1,000× lower \(off by an exact power of ten\)<\/dd>/);
  // A status of its own says it too; with no factor to name, nothing more is said under the line.
  html = render(v2Summary, v2Detail([line("kcat", { database_status: "differs_factor_only", database_line: "OED lists 0.5 s⁻¹.", database_sources: ["OED"] })]));
  assert.match(html, /<strong>Different number \(exact factor, not yet checked\)<\/strong>/);
  assert.doesNotMatch(html, /<dt>Cause<\/dt>/);
  // A cause code with no wording is not shown (never the raw code with spaces); a cause given as a phrase is shown as given.
  html = render(v2Summary, v2Detail([line("Km", { database_status: "corrected", database_line: "BRENDA lists 5 mM.", database_cause: "some_new_cause" })]));
  assert.doesNotMatch(html, /<dt>Cause<\/dt>|some new cause|some_new_cause/);
  assert.match(valuesOf(html), /data-show-note="km">corrects a database</, "no database named: no name made up");
  html = render(v2Summary, v2Detail([line("Km", { database_status: "corrected", database_line: "BRENDA lists 5 mM.", database_cause: "a misread header" })]));
  assert.match(html, /<dt>Cause<\/dt><dd>a misread header<\/dd>/);
  // The checker's notes are folded and muted under "How it was checked" (never labelled "In the paper", which names the
  // printed quote), without a last part that only gives again the number the line names first.
  html = render(v2Summary, v2Detail([line("kcat/Km", { database_status: "corrected", database_sources: ["SABIO-RK", "OED"], database_cause: "paper_unit_misprint",
    database_line: "SABIO-RK and OED list 917.7 mM⁻¹ s⁻¹: the printed value in its printed unit. The paper prints 55.06 µM⁻¹ min⁻¹ (Table I).",
    database_evidence: "Table I, wild type: kcat/Km column prints 55.06; kcat 12.45 min⁻¹ / Km 228.78 µM = 0.0544 µM⁻¹ min⁻¹ (54.4 mM⁻¹ min⁻¹). OED and SABIO-RK list 917.7 mM⁻¹ s⁻¹" })]));
  assert.match(html, /<details class="cmp-how"><summary>How it was checked<\/summary><p>Table I, wild type: kcat\/Km column prints 55\.06; kcat 12\.45 min⁻¹ \/ Km 228\.78 µM = 0\.0544 µM⁻¹ min⁻¹ \(54\.4 mM⁻¹ min⁻¹\)\.<\/p><\/details>/);
  assert.equal((html.match(/917\.7/g) || []).length, 1, "the database's number once, in the line");
  html = render(v2Summary, v2Detail([line("kcat/Km", { database_status: "corrected", database_sources: ["SABIO-RK"],
    database_line: "SABIO-RK lists 2.4 × 10⁻⁹ mM⁻¹ s⁻¹, 10¹²× lower.", database_evidence: "Table 5 prints 2.4; footnote b '(kcat/Km) x 10⁶ M⁻¹ s⁻¹'; SABIO-RK 2.4 × 10⁻⁹ mM⁻¹ s⁻¹ (=x10⁻⁶ M⁻¹ s⁻¹)" })]));
  assert.match(html, /<p>Table 5 prints 2\.4; footnote b &#39;\(kcat\/Km\) x 10⁶ M⁻¹ s⁻¹&#39;\.<\/p><\/details>/);
  // A last part with other facts stays (BRENDA's own kcat and Km, the arithmetic).
  html = render(v2Summary, v2Detail([line("kcat/Km", { database_status: "corrected", database_sources: ["BRENDA"],
    database_line: "BRENDA lists 0.01 mM⁻¹ s⁻¹ (1.1 × 10⁴× lower than CatLog's value).", database_evidence: "Table 1 prints 105.58 ± 12.16; BRENDA lists kcat 0.042 s⁻¹, Km 4.1 mM" })]));
  assert.match(html, /<p>Table 1 prints 105\.58 ± 12\.16; BRENDA lists kcat 0\.042 s⁻¹, Km 4\.1 mM<\/p>/);
  // A local file named as evidence is never shown.
  html = render(v2Summary, v2Detail([line("kcat", { database_status: "differs", database_line: "BRENDA lists 3 s⁻¹.", database_evidence: "/Users/someone/papers/123.pdf p. 4" })]));
  assert.doesNotMatch(html, /Users\/someone|\.pdf|In the paper<\/dt>|How it was checked/);
  // Values whose lines read the same share one line; a kcat/Km CatLog calculated is not compared (its own muted line
  // with no square, after the compared values and their notes; never alone).
  const calculatedSummary = { ...v2Summary, record_key: "v2-db-calc", kcat_over_km_origin: "calculated" };
  html = render(calculatedSummary, v2Detail([line("kcat", { database_status: "confirmed", database_line: "Same as BRENDA." }),
    line("Km", { database_status: "confirmed", database_line: "Same as BRENDA." })]));
  section = sectionOf(html);
  assert.match(section, /<p class="cmp-same-line"><span class="cmp-mark cmp-same" aria-hidden="true"><\/span><span><i>k<\/i><sub>cat<\/sub> and <i>K<\/i><sub>m<\/sub>: Same as BRENDA\.<\/span><\/p><p class="cmp-calc-line"><i>k<\/i><sub>cat<\/sub>\/<i>K<\/i><sub>m<\/sub> \(calc\.\): not compared\.<\/p>(?:<p class="cmp-explore">|<\/section>)/);
  assert.doesNotMatch(section, /cmp-note|cmp-pointer/);
  // With a note, the calculated kcat/Km comes after it (the compared values first) and after the caution line a Different
  // number brings.
  html = render(calculatedSummary, v2Detail([line("kcat", { database_status: "differs", database_line: "OED lists 41 s⁻¹.", database_sources: ["OED"] }),
    line("Km", { database_status: "confirmed", database_line: "Same as BRENDA." })]));
  section = sectionOf(html);
  assert.match(section, /<p class="cmp-same-line">[\s\S]*?Same as BRENDA\.<\/span><\/p><div class="cmp-notes"><details class="cmp-note" data-cmp-field="kcat"[\s\S]*?<\/details><\/div><p class="section-note cmp-caution-line">[^<]*<\/p><p class="cmp-calc-line"><i>k<\/i><sub>cat<\/sub>\/<i>K<\/i><sub>m<\/sub> \(calc\.\): not compared\.<\/p>(?:<p class="cmp-explore">|<\/section>)/);
  assert.equal((section.match(/cmp-mark/g) || []).length, 2, "squares only on the same line and the note's result");
  html = render(calculatedSummary, v2Detail([line("kcat"), line("Km")]));
  assert.doesNotMatch(html, /Against the databases|not compared/, "no compared value, no section");
  // Values whose notes read alike share one note ("kcat and Km · Not in the databases"), as the same lines do; a value
  // that corrects or differs keeps its own (the Values pointer opens it by its parameter).
  const noneLine = "BRENDA, SABIO-RK, OED, SKiD, STRENDA DB and UniProt list no kcat, Km or kcat/Km for this paper.";
  html = render(v2Summary, v2Detail([line("kcat", { database_status: "new", database_line: noneLine }), line("Km", { database_status: "new", database_line: noneLine })]));
  section = sectionOf(html);
  assert.equal((section.match(/<details class="cmp-note"/g) || []).length, 1, "one note for both values");
  assert.equal(section.split(noneLine).length - 1, 1, "the line once");
  assert.match(section, /<details class="cmp-note" data-cmp-field="kcat"><summary><span class="cmp-note-head"><i>k<\/i><sub>cat<\/sub> and <i>K<\/i><sub>m<\/sub><span class="cmp-sep" aria-hidden="true"> · <\/span><\/span><span class="cmp-result"><span class="cmp-mark cmp-new" aria-hidden="true"><\/span><strong>Not in the databases<\/strong>/);
  html = render(v2Summary, v2Detail([line("kcat", { database_status: "differs", database_line: "BRENDA lists 3 s⁻¹.", database_sources: ["BRENDA"] }),
    line("Km", { database_status: "differs", database_line: "BRENDA lists 3 s⁻¹.", database_sources: ["BRENDA"] })]));
  assert.equal((sectionOf(html).match(/<details class="cmp-note"/g) || []).length, 2, "a different number keeps its own note");
  // A cause the line already says word for word is not said again under it.
  html = render(v2Summary, v2Detail([line("Km", { database_status: "corrected", database_sources: ["BRENDA"], database_cause: "header_scale_inverted",
    database_line: "BRENDA lists 5 mM, 1,000× lower. Checked against the paper: the table header's power of ten applied the wrong way." })]));
  assert.doesNotMatch(html, /<dt>Cause<\/dt>/);
  assert.equal((html.match(/applied the wrong way/g) || []).length, 1);
  // A database_check object (one field per fact) and its database value, said when there is no line; a same value
  // without a line says which databases list it.
  html = render(v2Summary, v2Detail([line("Km", { database_check: { status: "differs", sources: ["BRENDA", "OED"], database_value: 0.0028, database_unit: "mM" } })]));
  assert.match(html, /<strong>Different number<\/strong>[\s\S]*<p class="cmp-line">Databases: BRENDA, OED: 0\.0028 mM<\/p>/);
  html = render(v2Summary, v2Detail([line("Km", { database_status: "confirmed", database_sources: ["BRENDA", "STRENDA"] })]));
  assert.match(html, /<i>K<\/i><sub>m<\/sub>: Same as BRENDA and STRENDA DB\.<\/span>/);
  // The snapshot's record checks (spec side file): its phrases are the line.
  assert.match(api.databasesSection(v2Summary, v2Detail([line("kcat"), line("Km"), line("kcat/Km")]), {
    v2Record: true, proof: null, check: { db: { kcat: ["same", "BRENDA,SABIO-RK"] } } }), /^$/, "no proof lines, no rows");
  {
    const proof = { lines: [line("kcat"), line("Km"), line("kcat/Km")], facts: [line("kcat"), line("Km"), line("kcat/Km")].map(api.v2LineFacts) };
    const sideFile = api.databasesSection(v2Summary, {}, { v2Record: true, proof,
      check: { db: { kcat: ["same", "BRENDA,SABIO-RK"], Km: ["differs", "BRENDA,OED", 5], "kcat/Km": ["absent", ""] } } });
    assert.match(sideFile, /<i>k<\/i><sub>cat<\/sub>: Same number in BRENDA, SABIO-RK<\/span>/);
    assert.match(sideFile, /<strong>Different number<\/strong>[\s\S]*<p class="cmp-line">Not among the 5 Km values BRENDA and OED list for this paper<\/p>/);
    assert.match(sideFile, /<strong>Not in the databases<\/strong><\/span><\/summary><div class="cmp-note-body"><p class="cmp-line">No database lists a kcat\/Km for this paper<\/p>/);
  }

  // The compared databases come from the manifest when it lists them (a sixth among them), in its order, with their
  // display names; a value's database_sources name them as the manifest's names do.
  {
    const previousSummary = runtimeManifest.summary;
    const names = (text) => text.replace(/<span class="nowrap">([^<]*)<\/span>/g, "$1");
    runtimeManifest.summary = { ...(previousSummary || {}), database_comparison: { sources: [
      { key: "brenda", name: "BRENDA", display: "BRENDA" }, { key: "sabio_rk", name: "SABIO-RK", display: "SABIO-RK" },
      { key: "oed", name: "OED", display: "OED" }, { key: "skid", name: "SKiD", display: "SKiD" },
      { key: "strenda", name: "STRENDA", display: "STRENDA DB" }, { key: "uniprot", name: "UniProt", display: "UniProt" },
    ] } };
    try {
      html = render(v2Summary, v2Detail([line("kcat", { database_status: "corrected", database_line: "UniProt lists 3 s⁻¹.", database_sources: ["UniProt", "STRENDA"] })]));
      assert.match(names(html), /Compared with the values BRENDA, SABIO-RK, OED, SKiD, STRENDA DB and UniProt list for the same paper\./);
      assert.match(html, /data-show-note="kcat">corrects UniProt and STRENDA DB</);
      runtimeManifest.summary.database_comparison.sources = [{ key: "brenda", name: "BRENDA", display: "BRENDA" }];
      assert.match(names(render(v2Summary, comparedDetail())), /Compared with the values BRENDA lists for the same paper\./);
      runtimeManifest.summary.database_comparison.sources = [{}, null, { key: "" }];
      assert.match(names(render(v2Summary, comparedDetail())), /Compared with the values BRENDA, SABIO-RK, OED, SKiD, STRENDA DB and UniProt list/, "an unusable list: the fallback");
      // Without a list, the databases the snapshot counts the values' database_sources for (values_by_database), in order.
      runtimeManifest.summary.database_comparison = { values_by_database: { STRENDA: {}, OED: {}, BRENDA: {}, SKiD: {}, "SABIO-RK": {} } };
      assert.match(names(render(v2Summary, comparedDetail())), /Compared with the values BRENDA, SABIO-RK, OED, SKiD and STRENDA DB list for the same paper\./);
    } finally {
      runtimeManifest.summary = previousSummary;
    }
  }

  // With Browse's "Against the databases" group on the page, the record links to the records like it: each option it
  // matches, never one the page does not have, and only when Browse can filter by it: the record index carries the
  // comparison (else db= is not read and the link would open Browse unfiltered) and the record's own row in it matches
  // the option. The paper's note links to the records of the paper that correct a value; once Browse matches a database
  // and a parameter (dbsrc, dbpar), to the values the manifest's note names, and More like this adds the databases.
  {
    const previousQuery = document.querySelector;
    const previousRecords = api.state.records;
    const previousSummary = runtimeManifest.summary;
    let options = ["corrects", "differs", "other_label", "not_listed", "all_not_listed", "all_same", "earlier"];
    document.querySelector = (selector) => {
      const match = selector.match(/^#catalogFilters input\[name="database"\]\[value="([a-z_]+)"\]$/);
      return match && options.includes(match[1]) ? {} : null;
    };
    // The record's row in the index, with its comparison summary (same 1, corrected 2, differs 4, new 8, other label 16,
    // earlier 32).
    const indexRow = (key, summary) => {
      api.state.records = [row({ record_key: key, database_summary: summary })];
    };
    const explore = (html) => html.match(/<p class="cmp-explore">([\s\S]*?)<\/p>/)?.[1] ?? "";
    const noteLinks = (html) => html.match(/<p class="cmp-paper-links">([\s\S]*?)<\/p>/)?.[1] ?? "";
    try {
      // The records' own fields carry the comparison, the record index does not: the group is hidden, so no link.
      indexRow("v2-db", 1 | 2 | 8);
      html = render(v2Summary, comparedDetail());
      assert.equal(explore(html), "", "no result link, and the paper's records are linked under Paper");
      assert.equal(noteLinks(html), "");
      runtimeManifest.viewer_index.optional_fields = ["database_summary"];
      html = render(v2Summary, comparedDetail());
      // Each link keeps the record open beside the list, as its paper's link does.
      assert.equal(explore(html), 'More like this: <a href="#browse?db=corrects&amp;record=v2-db">Corrects a value</a><span aria-hidden="true"> · </span>'
        + '<a href="#browse?db=not_listed&amp;record=v2-db">Not in the databases</a>');
      assert.equal(noteLinks(html), '<a href="#browse?q=pmid:31072150&amp;db=corrects&amp;record=v2-db">Records of this paper that correct a value<span aria-hidden="true"> →</span></a>');
      // An option the record's own row in the index does not match (the list would not hold the record): no link to
      // it, and the paper's records that correct a value open without it.
      indexRow("v2-db", 1 | 8);
      html = render(v2Summary, comparedDetail());
      assert.doesNotMatch(explore(html), /db=corrects/);
      assert.equal(noteLinks(html), '<a href="#browse?q=pmid:31072150&amp;db=corrects">Records of this paper that correct a value<span aria-hidden="true"> →</span></a>');
      api.state.records = [];
      assert.doesNotMatch(explore(render(v2Summary, comparedDetail())), /db=/, "no row in the index, no link");
      indexRow("v2-db", 4);
      html = render(v2Summary, v2Detail([line("kcat", { database_status: "differs", database_line: "BRENDA lists 3 s⁻¹.", database_sources: ["BRENDA"] })]));
      assert.match(explore(html), /^More like this: <a href="#browse\?db=differs&amp;record=v2-db">Different number<\/a>/);
      // An option the page does not have gets no link.
      options = options.filter((value) => value !== "differs");
      assert.doesNotMatch(explore(html = render(v2Summary, v2Detail([line("kcat", { database_status: "differs", database_line: "BRENDA lists 3 s⁻¹.", database_sources: ["BRENDA"] })]))), /db=/);
      options = [...options, "differs"];
      // Every value the same: All values the same; the same number under another label is found under its own option
      // (not with the records whose every value is the same); no value in any database: the nested "every value", said
      // instead of Not in the databases.
      indexRow("v2-db", 1);
      html = render(v2Summary, v2Detail([line("kcat", { database_status: "confirmed", database_line: "Same as BRENDA." }),
        line("Km", { database_status: "same", database_line: "Same as OED." })]));
      assert.match(explore(html), /^More like this: <a href="#browse\?db=all_same&amp;record=v2-db">All values the same<\/a>/);
      indexRow("v2-db", 1 | 16);
      html = render(v2Summary, v2Detail([line("kcat", { database_status: "confirmed", database_line: "Same as BRENDA." }),
        line("Km", { database_status: "same_number_other_label", database_line: "SABIO-RK lists this number for substrate NAD+.", database_sources: ["SABIO-RK"] })]));
      assert.match(explore(html), /^More like this: <a href="#browse\?db=other_label&amp;record=v2-db">Same, other label<\/a>/);
      assert.doesNotMatch(explore(html), /db=all_same/);
      indexRow("v2-db", 8);
      html = render(v2Summary, v2Detail([line("kcat", { database_status: "new", database_line: "Not in BRENDA." }),
        line("Km", { database_status: "new", database_line: "Not in OED." })]));
      assert.match(explore(html), /^More like this: <a href="#browse\?db=all_not_listed&amp;record=v2-db">Not in the databases: every value<\/a>/);
      assert.doesNotMatch(explore(html), /db=not_listed/);
      indexRow("v2-db", 4);
      html = render(v2Summary, v2Detail([line("kcat", { database_status: "differs", database_line: "BRENDA lists 3 s⁻¹.", database_sources: ["BRENDA"] })]));
      // (The paper's records are linked under Paper, never here.)
      api.state.records = [{ ...row({ record_key: "v2-db", database_summary: 4 }), _pmids: 31072150 }];
      api.state.recordsReady = true;
      assert.equal(explore(render(v2Summary, v2Detail([line("kcat", { database_status: "differs", database_line: "BRENDA lists 3 s⁻¹.", database_sources: ["BRENDA"] })]))),
        'More like this: <a href="#browse?db=differs&amp;record=v2-db">Different number</a>');
      // Browse matches a database and a parameter: the note's values (the manifest's database_notes for this paper) and
      // the databases of the record's strongest result, each named in the link's title as the chips say it.
      indexRow("v2-db", 1 | 2 | 8);
      api.databaseRefineKeys.add("dbsrc");
      api.databaseRefineKeys.add("dbpar");
      runtimeManifest.summary = { ...(previousSummary || {}), database_comparison: { database_notes: [
        { paper: "31072150", db: "BRENDA", metric: "Km", n: 12, of: 12, factor: 1000, direction: "lower" },
        { paper: "99", db: "OED", metric: "kcat", n: 3, of: 3 },
      ] } };
      html = render(v2Summary, comparedDetail());
      assert.equal(noteLinks(html), '<a href="#browse?q=pmid:31072150&amp;db=corrects&amp;dbsrc=brenda&amp;dbpar=km&amp;record=v2-db">Show these 12 values<span aria-hidden="true"> →</span></a>');
      assert.match(explore(html), /<a href="#browse\?db=corrects&amp;dbsrc=brenda&amp;dbpar=km&amp;record=v2-db" title="Corrects a value · Database: BRENDA · Compared value: Km">BRENDA<\/a><span aria-hidden="true"> · <\/span><a href="#browse\?db=corrects&amp;dbsrc=strenda&amp;dbpar=km&amp;record=v2-db" title="Corrects a value · Database: STRENDA DB · Compared value: Km">STRENDA DB<\/a>/);
      // Two notes on one paper: each link names its parameter (and its database when they differ).
      runtimeManifest.summary.database_comparison.database_notes.push({ paper: "31072150", db: "OED", metric: "kcat/Km", n: 5 });
      assert.match(noteLinks(render(v2Summary, comparedDetail())), /Show these 12 BRENDA <i>K<\/i><sub>m<\/sub> values<span aria-hidden="true"> →<\/span><\/a><span aria-hidden="true"> · <\/span><a href="#browse\?q=pmid:31072150&amp;db=corrects&amp;dbsrc=oed&amp;dbpar=kcatkm">Show these 5 OED <i>k<\/i><sub>cat<\/sub>\/<i>K<\/i><sub>m<\/sub> values/);
      const correctedRecord = row({ record_key: "corrected-explore", verification_status: "corrected", source_db: "oed" });
      const trail = { supporting_pmids: ["1"], corrections: [{ field: "km", before: 66, after: 0.066, unit: "mM", kind: "magnitude" }] };
      indexRow("corrected-explore", 32);
      // (Its Paper section links the paper's records.)
      assert.equal(explore(render(correctedRecord, trail)), 'More like this: <a href="#browse?db=earlier&amp;record=corrected-explore">Corrected earlier</a>');
      // A value a database had: the database stays the source. Every value added from the paper ("added: the source
      // had none"): the paper, read by the earlier version, is the source, and the database entry is named apart (the
      // user, 2026-10-15); a value the database had, or a value with no correction, keeps the database as the source.
      assert.match(render(correctedRecord, trail), /<dt>Values from<\/dt><dd>Open Enzyme Database \(OED\)<\/dd>/);
      const allAdded = { supporting_pmids: ["1"], corrections: [
        { field: "kcat", before: null, after: 0.35, unit: "s-1", kind: "added" }, { field: "km", before: null, after: 0.32, unit: "mM", kind: "added" },
        { field: "kcat_over_km", before: null, after: 1.09, unit: "mM-1 s-1", kind: "added" }, { field: "doi", before: null, after: "10.1/x", kind: "added" }] };
      assert.match(render(correctedRecord, allAdded), /<dt>Values from<\/dt><dd>The paper \(read by CatLog&#39;s earlier version\)<\/dd><\/div><div class="kv-line"><dt>Database entry<\/dt><dd>Open Enzyme Database \(OED\); its entry had none of these values<\/dd>/);
      assert.match(render(correctedRecord, { ...allAdded, corrections: allAdded.corrections.slice(0, 2) }), /<dt>Values from<\/dt><dd>Open Enzyme Database \(OED\)<\/dd>/, "a kcat/Km with no correction: the database had it");
      assert.match(render({ ...correctedRecord, kcat_over_km_origin: "calculated" }, { ...allAdded, corrections: allAdded.corrections.slice(0, 2) }), /<dt>Values from<\/dt><dd>The paper \(read by CatLog&#39;s earlier version\)<\/dd>/, "a calculated kcat/Km is not a value to account for");
      assert.doesNotMatch(render(correctedRecord, allAdded), /<dt>Database entry<\/dt>[\s\S]*<dt>Database entry<\/dt>/);
      indexRow("corrected-explore", 0);
      assert.equal(explore(render(correctedRecord, trail)), "", "an index without the earlier changes: no link");
      delete runtimeManifest.viewer_index.optional_fields;
      indexRow("corrected-explore", 32);
      assert.doesNotMatch(explore(render(correctedRecord, trail)), /db=/);
    } finally {
      document.querySelector = previousQuery;
      api.state.records = previousRecords;
      api.state.recordsReady = false;
      api.databaseRefineKeys.clear();
      runtimeManifest.summary = previousSummary;
      delete runtimeManifest.viewer_index.optional_fields;
    }
  }

  // Factors (x = the database's number ÷ CatLog's): exact powers of ten, 60 and 3,600, else two figures; higher or lower.
  for (const [x, text] of [[10, "10× higher"], [0.01, "100× lower"], [1000, "1,000× higher"], [0.001, "1,000× lower"], [1e4, "10⁴× higher"],
    [1e-6, "10⁶× lower"], [1.0002e12, "10¹²× higher"], [60.1, "60× higher"], [1 / 60, "60× lower"], [3600, "3,600× higher"], [1 / 3610, "3,600× lower"],
    [4.5, "4.5× higher"], [1 / 4.5, "4.5× lower"], [4, "4.0× higher"], [961.5, "960× higher"], [1 / 12.4, "12× lower"], [1.6, "1.6× higher"],
    [1.03, ""], [1, ""], [0, ""], [-2, ""], [Number.NaN, ""]]) {
    assert.equal(api.databaseFactorText(x), text, String(x));
  }
  const plainData = (value) => JSON.parse(JSON.stringify(value));
  // An earlier correction's numbers: at most 4 significant figures, the stored digits kept for the title; more when
  // Before and After would read the same; integer digits below 10⁵ kept, as the record's values do.
  assert.deepEqual(plainData(api.correctionNumbers(0.546667, 0.544)), [{ text: "0.5467", stored: "0.546667" }, { text: "0.544", stored: "" }]);
  assert.deepEqual(plainData(api.correctionNumbers(2.667, 2.66667)), [{ text: "2.667", stored: "" }, { text: "2.6667", stored: "2.66667" }]);
  assert.deepEqual(plainData(api.correctionNumbers(19230.8, 20)), [{ text: "19231", stored: "19230.8" }, { text: "20", stored: "" }]);
  assert.deepEqual(plainData(api.correctionNumbers(250, 0.25)), [{ text: "250", stored: "" }, { text: "0.25", stored: "" }]);
  assert.deepEqual(plainData(api.correctionNumbers(1.23456e-7, 1.2e-4)), [{ text: "1.235 × 10⁻⁷", stored: "1.23456e-7" }, { text: "1.2 × 10⁻⁴", stored: "" }]);

  // An earlier "corrected" record: an intro, then before → after and the kind of change per field, the earlier number's
  // database and the factor between them, and where the paper prints it; other fields (pH, temperature, identifiers)
  // the same way.
  const corrected = row({ record_key: "corrected-trail", verification_status: "corrected", source_db: "oed", kcat: 2.67, km: 0.066,
    kcat_display: "2.67", km_display: "0.066", kcat_unit: "s^(-1)", km_unit: "mM" });
  html = render(corrected, { supporting_pmids: ["2226453"], corrections: [
    { field: "km", before: 66, after: 0.066, unit: "mM", kind: "magnitude", listed: "STRENDA", where: "Table 2, row 12-hydroxydodecanoic acid: Km 66 µM" },
    { field: "kcat", old_value: 2.7, new_value: 2.67, unit: "s^(-1)", kind: "rounding", evidence_table_row: "Table 2, row 12-hydroxydodecanoic acid" },
    { field: "kcat", old_value: 5, new_value: 5, unit: "s^(-1)", kind: "different" },
    { field: "kcat_over_km", old_value: null, new_value: 40, unit: "s^(-1)*mM^(-1)", kind: "added", evidence_table_row: "C:\\papers\\x.pdf" },
    { field: "ki", before: 0.546667, after: 0.002, unit: "mM", kind: "different", listed: "BRENDA" },
    { field: "ph", before: 7, after: 7.5, kind: "different" },
    { field: "temperature_k", before: 298.15, after: 303.15, kind: "different" },
    { field: "uniprot_id", old_value: "P00325", new_value: "P00326", kind: "changed" },
    { field: "primary_uniprot_id", old_value: "P00325", new_value: "P00326", kind: "changed", where: "Methods: UniProt P00326" },
    { field: "sequence", kind: "replaced" },
    { field: "canonical_sequence", kind: "replaced" },
    { field: "km", before: 66, after: 0.066, unit: "mM", kind: "magnitude" },
    { field: "pubmed_id", before: "21149620", after: "21149602", kind: "changed" },
    { field: "ncbi_protein_id", before: null, after: 123456789, kind: "added" },
    { field: "vmax", before: 120000, after: 1200, unit: "nmol/min/mg", kind: "magnitude" },
    { field: "kcat_unit", before: "s^(-1)", after: "min^(-1)", kind: "changed" },
    { field: "km_unit", before: null, after: "uM", kind: "added" },
    { field: "kcat_over_km_unit", before: "s^-1 M^-1", after: "s^(-1)*mM^(-1)", kind: "changed" },
    { field: "ki_unit", before: "min(-1)", after: "s-1", kind: "changed" },
    { field: "wild_type", before: true, after: false, kind: "changed" },
    { field: "smiles", kind: "replaced" },
  ] });
  const trail = sectionOf(html);
  // Headed as Browse's option names it: no database is compared on an earlier record.
  // (The header's "not re-read" says CatLog has not read the paper again yet.)
  assert.match(trail, /<h3 id="detail-databases-title">Corrected earlier<\/h3><p class="section-text cmp-intro">CatLog&#39;s earlier version changed these values to what the paper prints\.<\/p><dl class="detail-kv cmp-list">/);
  assert.doesNotMatch(trail, /<table|Changed in the earlier automated review|cmp-footer|Compared with the values|section-about|detail-about|cmp-caution-line/, "an earlier correction trail compares nothing: no \"?\" box");
  // "Before: as STRENDA DB lists it for this paper" with the factor between the two numbers (the database's 1,000× higher).
  assert.match(trail, /<div class="kv-line cmp-item"><dt><i>K<\/i><sub>m<\/sub><\/dt><dd><span class="cmp-value">66 mM<span class="cmp-arrow"> → <\/span><strong>0\.066 mM<\/strong><\/span><span class="cmp-result"><span class="cmp-mark cmp-magnitude" aria-hidden="true"><\/span><span>unit or magnitude<\/span><\/span><small class="cmp-before">Before: as STRENDA DB lists it for this paper \(1,000× higher\)<\/small><small class="cmp-where">In the paper: Table 2, row 12-hydroxydodecanoic acid: Km 66 µM<\/small><\/dd><\/div>/);
  assert.match(trail, /<span class="cmp-value">2\.7 s⁻¹<span class="cmp-arrow"> → <\/span><strong>2\.67 s⁻¹<\/strong><\/span><span class="cmp-result"><span class="cmp-mark cmp-precision" aria-hidden="true"><\/span><span>more digits \/ rounding<\/span><\/span><small class="cmp-before">Before: the earlier version&#39;s value<\/small>/);
  // At most 4 figures, the stored number in the title; a different number has its factor at two figures.
  assert.match(trail, /<dt><i>K<\/i><sub>i<\/sub><\/dt><dd><span class="cmp-value"><span title="As stored: 0\.546667">0\.5467 mM<\/span><span class="cmp-arrow"> → <\/span><strong>0\.002 mM<\/strong><\/span><span class="cmp-result"><span class="cmp-mark cmp-differs" aria-hidden="true"><\/span><span>different number<\/span><\/span><small class="cmp-before">Before: as BRENDA lists it for this paper \(270× higher\)<\/small>/);
  assert.equal((trail.match(/>5 s⁻¹/g) || []).length, 0, "a field whose number did not change is not listed");
  assert.match(trail, /<span class="cmp-value">none<span class="cmp-arrow"> → <\/span><strong>40 mM⁻¹ s⁻¹<\/strong><\/span><span class="cmp-result"><span class="cmp-mark cmp-new" aria-hidden="true"><\/span><span>added: the source had none<\/span><\/span><\/dd>/);
  assert.match(trail, /<dt>pH<\/dt><dd><span class="cmp-value">7<span class="cmp-arrow"> → <\/span><strong>7\.5<\/strong><\/span>/);
  assert.match(trail, /<dt>Temperature<\/dt><dd><span class="cmp-value">25 °C<span class="cmp-arrow"> → <\/span><strong>30 °C<\/strong><\/span>/);
  assert.match(trail, /<dt>Form<\/dt><dd><span class="cmp-value">wild type<span class="cmp-arrow"> → <\/span><strong>variant<\/strong><\/span>/);
  // Two copies of one field that read the same (uniprot_id and primary_uniprot_id, sequence and canonical_sequence, a
  // value listed twice) are one row, keeping the place in the paper either gives.
  assert.match(trail, /<dt>UniProt<\/dt><dd><span class="cmp-value">P00325<span class="cmp-arrow"> → <\/span><strong>P00326<\/strong><\/span><small class="cmp-where">In the paper: Methods: UniProt P00326<\/small><\/dd>/);
  assert.equal((trail.match(/<dt>UniProt<\/dt>/g) || []).length, 1, "one UniProt row");
  assert.equal((trail.match(/<dt>Sequence<\/dt><dd><span class="cmp-value">Replaced<\/span>/g) || []).length, 1, "one Sequence row");
  assert.equal((trail.match(/<dt><i>K<\/i><sub>m<\/sub><\/dt>/g) || []).length, 1, "one Km row");
  // Identifiers are text as given, never numbers in × 10ⁿ; a numeric field such as Vmax is written as a number.
  assert.match(trail, /<dt>PMID<\/dt><dd><span class="cmp-value">21149620<span class="cmp-arrow"> → <\/span><strong>21149602<\/strong><\/span><\/dd>/);
  assert.match(trail, /<dt>NCBI Protein<\/dt><dd><span class="cmp-value">none<span class="cmp-arrow"> → <\/span><strong>123456789<\/strong><\/span>/);
  assert.doesNotMatch(trail, /× 10⁷|× 10⁸/);
  // A changed unit reads as the record's units do: superscript exponents, µM; never the stored carets.
  assert.match(trail, /<dt><i>k<\/i><sub>cat<\/sub> unit<\/dt><dd><span class="cmp-value">s⁻¹<span class="cmp-arrow"> → <\/span><strong>min⁻¹<\/strong><\/span><\/dd>/);
  assert.match(trail, /<dt><i>K<\/i><sub>m<\/sub> unit<\/dt><dd><span class="cmp-value">none<span class="cmp-arrow"> → <\/span><strong>µM<\/strong><\/span>/);
  assert.match(trail, /<span class="cmp-value">M⁻¹ s⁻¹<span class="cmp-arrow"> → <\/span><strong>mM⁻¹ s⁻¹<\/strong><\/span>/);
  assert.match(trail, /<dt><i>K<\/i><sub>i<\/sub> unit<\/dt><dd><span class="cmp-value">min⁻¹<span class="cmp-arrow"> → <\/span><strong>s⁻¹<\/strong><\/span>/);
  assert.doesNotMatch(trail, /\^|\(-1\)/, "no caret unit left");
  assert.match(trail, /<dt>V<sub>max<\/sub><\/dt><dd><span class="cmp-value">1\.2 × 10⁵ nmol\/min\/mg<span class="cmp-arrow"> → <\/span><strong>1200 nmol\/min\/mg<\/strong><\/span>/);
  assert.match(trail, /<dt>SMILES<\/dt><dd><span class="cmp-value">Replaced<\/span><\/dd>/);
  assert.doesNotMatch(trail, /papers\\x\.pdf|x\.pdf|cmp-where-once/, "a local path never; places differ, so each item says its own");
  assert.match(html, /<dt>Review result<\/dt><dd>Corrected and accepted in the earlier automated review \(see Corrected earlier\)\.<\/dd>/);
  assert.doesNotMatch(html, /value before correction was not kept/);
  // Every value added (the source had none of them): said once in the intro, not as a tag on each item.
  html = render(corrected, { supporting_pmids: ["2226453"], corrections: [
    { field: "kcat", before: null, after: 2.67, unit: "s^(-1)", kind: "added" },
    { field: "km", before: null, after: 0.066, unit: "mM", kind: "added" },
    { field: "uniprot_id", before: null, after: "P00326", kind: "added" },
    { field: "sequence", kind: "replaced" },
  ] });
  const addedTrail = sectionOf(html);
  assert.match(addedTrail, /<p class="section-text cmp-intro">CatLog&#39;s earlier version added these values from the paper; the source had none\.<\/p>/);
  assert.doesNotMatch(addedTrail, /added: the source had none|cmp-result/);
  assert.match(addedTrail, /<span class="cmp-value">none<span class="cmp-arrow"> → <\/span><strong>0\.066 mM<\/strong><\/span>/);
  // A place every item shares is said once, under the list.
  html = render(corrected, { supporting_pmids: ["2226453"], corrections: [
    { field: "kcat", before: 2.667, after: 2.66667, unit: "s^(-1)", kind: "rounding", where: "PMC4133812 Table 1; TMGS D10N", listed: "SABIO-RK" },
    { field: "kcat_over_km", before: 0.546667, after: 0.544, unit: "mM⁻¹ s⁻¹", kind: "rounding", where: "PMC4133812 Table 1; TMGS D10N", listed: "BRENDA" },
  ] });
  const shared = sectionOf(html);
  assert.equal((shared.match(/PMC4133812/g) || []).length, 1);
  assert.match(shared, /<\/dl><p class="cmp-where-once">In the paper: PMC4133812 Table 1; TMGS D10N<\/p>/);
  assert.match(shared, /<span class="cmp-value">2\.667 s⁻¹<span class="cmp-arrow"> → <\/span><strong><span title="As stored: 2\.66667">2\.6667 s⁻¹<\/span><\/strong><\/span>/);
  assert.match(shared, /<span title="As stored: 0\.546667">0\.5467 mM⁻¹ s⁻¹<\/span><span class="cmp-arrow"> → <\/span><strong>0\.544 mM⁻¹ s⁻¹<\/strong>/);
  assert.match(shared, /<small class="cmp-before">Before: as SABIO-RK lists it for this paper<\/small>/, "rounding: no factor");
  // Without its trail, a corrected record says the snapshot does not list the changes (the earlier catalog keeps them)
  // and has no section.
  html = render(corrected, { supporting_pmids: ["2226453"] });
  assert.doesNotMatch(html, /Against the databases/);
  assert.match(html, /Corrected and accepted in the earlier automated review; this snapshot does not list the changes\./);
  assert.doesNotMatch(html, /was not kept/);

  // A database record the earlier review did not settle: the values are the database's, said in Checks' Paper check row,
  // never under Against the databases (it compares nothing); accepted, disputed, no paper linked or an earlier
  // extraction: no such line.
  const NOT_YET = "<dt>Paper check</dt><dd>Not yet checked against the paper: the values are the database&#39;s.</dd>";
  const paperCheckOf = (summary, detail = { supporting_pmids: ["1"] }) => {
    const html = render(summary, detail);
    assert.doesNotMatch(html, /Against the databases/, "no comparison, no section");
    const review = html.match(/<h3 id="detail-checks-title">Checks<\/h3>([\s\S]*?)<\/section>/)?.[1] ?? "";
    return review.includes(NOT_YET) ? review : null;
  };
  const unverified = paperCheckOf(row({ record_key: "db-unverified", verification_status: "unverified", source_db: "brenda", has_proof_excerpt: false }));
  assert.ok(unverified);
  // Right after the review result.
  assert.match(unverified, /<dt>Review result<\/dt><dd>Not checked: the earlier automated review recorded no final check\.<\/dd><\/div><div class="kv-line"><dt>Paper check<\/dt>/);
  // One Guide link, under the rows: how the earlier review worked.
  assert.match(unverified, /<\/dl><p class="section-link"><a class="method-link" href="#guide-method">How the earlier review worked<span aria-hidden="true"> →<\/span><\/a><\/p>$/);
  assert.ok(paperCheckOf(row({ record_key: "db-pending", verification_status: "manual_review_required", source_db: "sabio_rk", has_proof_excerpt: false })));
  // Values the earlier review located in the paper (Evidence: Located in the paper) were checked against it: no line.
  assert.equal(paperCheckOf(row({ record_key: "db-located", verification_status: "unverified", source_db: "oed", has_proof_excerpt: false, proof_kind: "paper_evidence" })), null);
  assert.doesNotMatch(render(row({ record_key: "db-excerpt", verification_status: "manual_review_required", source_db: "brenda", has_proof_excerpt: false }),
    { supporting_pmids: ["1"], has_proof_excerpt: true }), /Against the databases|values are the database|Paper check/);
  assert.equal(paperCheckOf(row({ record_key: "db-accepted", verification_status: "verified", source_db: "brenda" })), null);
  assert.equal(paperCheckOf(row({ record_key: "db-disputed", verification_status: "disputed", source_db: "brenda" })), null);
  assert.equal(paperCheckOf(row({ record_key: "db-no-paper", verification_status: "unverified", source_db: "skid", public_trust_basis: "identity_only" })), null);
  assert.equal(paperCheckOf(row({ record_key: "earlier-extraction", verification_status: "unverified", source_db: "primary_paper_direct" })), null);
  // A database record that names no paper (no PMID, DOI or paper ID) has nothing to be checked against: no line.
  assert.equal(paperCheckOf(row({ record_key: "db-no-pmid", verification_status: "unverified", source_db: "strenda" }), {}), null);
  assert.ok(paperCheckOf(row({ record_key: "db-doi-only", verification_status: "unverified", source_db: "strenda", has_proof_excerpt: false }), { supporting_dois: ["10.1/x"] }));

  // The Guide's two sentences on Against the databases show only when the snapshot carries the comparison (the
  // manifest's record index lists database_summary), as Browse's group does.
  {
    const guideItems = [{ hidden: true }, { hidden: true }];
    const previousAll = document.querySelectorAll;
    document.querySelectorAll = (selector) => selector === "[data-guide-databases]" ? guideItems : previousAll(selector);
    try {
      api.renderGuideDatabases();
      assert.deepEqual(guideItems.map((item) => item.hidden), [true, true], "no comparison in the snapshot: hidden");
      runtimeManifest.viewer_index.optional_fields = ["database_summary"];
      api.renderGuideDatabases();
      assert.deepEqual(guideItems.map((item) => item.hidden), [false, false]);
      runtimeManifest.viewer_index.optional_fields = ["condition_note"];
      api.renderGuideDatabases();
      assert.deepEqual(guideItems.map((item) => item.hidden), [true, true]);
    } finally {
      document.querySelectorAll = previousAll;
      delete runtimeManifest.viewer_index.optional_fields;
    }
  }
}
// The Guide's section Against the databases (#guide-databases) is written from the manifest's
// summary.database_comparison: what is compared, the six results with their counts (the ones Browse's options count),
// the cause families, how a correction is found and why no database lists a value; a count the manifest lacks leaves
// its line out. The fixture's numbers are the round 9 test bundle's.
{
  const bundleComparison = () => ({
    values: { all: { new_paper_not_in_databases: 1382, confirmed: 97791, not_compared: 5946, differs: 1051, new: 14732,
      same_number_other_label: 5574, corrected: 1548, new_ratio_only: 4873 } },
    corrections: { values: 1548, by: { code: 892, paper_check: 656 },
      by_cause: { power_of_ten: 557, printed_number_unit_not_applied: 253, header_scale_inverted: 179, unit_not_converted: 126,
        paper_unit_misprint: 91, decimal_or_exponent_slip: 86, time_factor: 82, header_scale_ignored: 56, mM_entered_as_uM: 28,
        value_from_other_row: 22, recomputed_ratio: 21, time_unit: 21, uM_entered_as_mM: 18, value_not_in_paper: 8 },
      by_database: { BRENDA: 1156, OED: 616, "SABIO-RK": 368, SKiD: 130, STRENDA: 12 } },
    values_by_database: { BRENDA: { same: 1 }, "SABIO-RK": { same: 1 }, OED: { same: 1 }, SKiD: { same: 1 }, STRENDA: { same: 1 } },
    records: { every_value_new: 6283, any_value_new: 14002, every_value_confirmed: 36121, corrects_a_database_value: 1443,
      differs_not_yet_resolved: 955 },
    records_by_summary: { same: 36121, corrected: 128, differs: 124, other_label: 1824, new: 6283, mixed: 10078, not_compared: 0 },
    records_with_kind: { same: 45251, corrected: 1443, differs: 955, other_label: 3466, new: 14002 },
    papers_not_in_databases: Array.from({ length: 39 }, (_, index) => String(1000 + index)),
    papers: 2650,
  });
  const plain = (html) => html.replace(/<[^>]+>/g, "").replace(/&rsquo;/g, "’").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  const items = (html, title) => {
    const list = html.split(new RegExp(`<h3 id="[^"]+">${title}</h3>`))[1].split("<h3")[0];
    return Object.fromEntries([...list.matchAll(/<div(?: data-result="[a-z_]+")?><dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd><\/div>/g)]
      .map(([, label, text]) => [plain(label).trim(), plain(text).trim()]));
  };
  const earlierOverview = { earlier_corrections: { records: 2881 } };
  let html = api.guideDatabasesHtml(bundleComparison(), earlierOverview);
  let text = plain(html);
  assert.ok(text.startsWith("CatLog compares the values it reads from a paper with the values BRENDA, SABIO-RK, OED, SKiD and STRENDA DB list for the same paper. This snapshot compares 126,951 values from 2,650 papers. Where a database lists a number for the same measurement (100,390 values), it is the paper’s number for 97.4%."), text);
  assert.match(html, /<i>k<\/i><sub>cat<\/sub>, <i>K<\/i><sub>m<\/sub> and <i>k<\/i><sub>cat<\/sub>\/<i>K<\/i><sub>m<\/sub> CatLog reads from a paper/);
  assert.match(text, /Not compared: a kcat\/Km CatLog calculated \(calc\.; 5,946 in this snapshot\) and a value printed over a mass concentration \(mg\/mL\)\./);
  assert.match(html, /<dt>Databases<\/dt><dd><span class="nowrap">BRENDA<\/span>, <span class="nowrap">SABIO-RK<\/span>, <span class="nowrap">OED<\/span>, <span class="nowrap">SKiD<\/span> and <span class="nowrap">STRENDA DB<\/span>\.<\/dd>/);
  // The six results in Browse's order, each with the square of its colour (none on Corrected earlier) and its counts.
  const results = items(html, "Results");
  assert.deepEqual(Object.keys(results), ["Corrects a value", "Different number", "Same, other label", "Not in the databases",
    "All values the same", "Corrected earlier"]);
  assert.deepEqual([...html.matchAll(/<span class="guide-db-mark"(?: data-result="([a-z_]+)")? aria-hidden="true"><\/span>/g)].map((match) => match[1] ?? ""),
    ["corrects", "differs", "other_label", "not_listed", "same", ""]);
  assert.equal(results["Corrects a value"], "A database lists another number for this value. CatLog’s value is the one the paper prints; the record names the cause and how it was found. 1,548 values in 1,443 records");
  assert.ok(results["Different number"].endsWith("A different number can mean a different measurement; it does not by itself mean a database is wrong. 1,051 values in 955 records"));
  // The caveat stands under Different number only, once in the section.
  assert.equal((text.match(/does not by itself mean a database is wrong/g) || []).length, 1);
  assert.ok(results["Same, other label"].endsWith("under another substrate, variant or organism. 5,574 values in 3,466 records"));
  assert.ok(results["Not in the databases"].endsWith("The record says why and what they do list. 20,987 values in 14,002 records Under it, every value: no compared database lists any value of the record (6,283 records)."), results["Not in the databases"]);
  assert.ok(results["All values the same"].endsWith("Every compared value is the number a database lists for it. 36,121 records"));
  assert.ok(results["Corrected earlier"].startsWith("Not yet re-read: CatLog’s earlier version changed these values"));
  assert.ok(results["Corrected earlier"].endsWith("2,881 records"));
  // The Guide, Stats and Browse give a result one name and one definition: Browse's option's.
  for (const item of api.GUIDE_DB_RESULTS) {
    const option = api.databaseFilters.find((filter) => filter.value === item.key);
    assert.equal(item.label, option.label, item.key);
    assert.equal(item.text, option.title, item.key);
  }
  // Every cause code has a family (a code without one would drop out of the counts); the families add up to the corrections.
  // One list of families for the Guide and Stats (Stats' map is the same list's).
  const families = api.DATABASE_CAUSE_FAMILIES;
  for (const family of families) for (const code of family.causes) assert.equal(api.STATS_CAUSE_FAMILY[code], family.key, code);
  const codes = [...Object.keys(bundleComparison().corrections.by_cause)];
  for (const code of codes) assert.equal(families.filter((family) => family.causes.includes(code)).length, 1, code);
  const causes = items(html, "Cause of a correction");
  assert.deepEqual(Object.keys(causes), ["Unit or scale", "Decimal slip", "Another number", "Unit misprinted"]);
  assert.deepEqual(Object.values(causes).map((value) => value.match(/([\d,]+) values$/)[1]), ["1,320", "86", "51", "91"]);
  // How found: this snapshot counts the paper check apart and code's two ways together.
  const found = items(html, "How a correction is found");
  // Two ways: an exact factor alone, nothing else checked, is no correction (the user, 2026-10-15).
  assert.deepEqual(Object.keys(found), ["Checked against the paper", "Exact factor; the paper’s kcat ÷ Km agrees"]);
  assert.ok(found["Checked against the paper"].endsWith("named the cause. 656 values"));
  assert.doesNotMatch(text, /Exact factor only|nothing else was checked/);
  assert.match(text, /Found by code \(an exact factor the paper’s own kcat ÷ Km agrees with\): 892 values\./);
  assert.doesNotMatch(text, /Among them, exact factor/, "no factor-only count in this comparison: no line for it");
  // Why not listed: the two kinds values.all counts apart, the paper count from the papers no database lists.
  const why = items(html, "Why no database lists a value");
  assert.deepEqual(Object.keys(why), ["kcat and Km listed", "Other values listed", "Substrate not listed", "Parameter not listed",
    "Variant not listed", "Paper not listed"]);
  assert.ok(why["kcat and Km listed"].endsWith("they did not store the ratio. 4,873 values"));
  assert.ok(why["Other values listed"].endsWith("the pairing could not match."));
  assert.ok(why["Paper not listed"].endsWith("in none of the compared databases. 1,382 values from 39 papers"));
  assert.ok(text.includes("All comparisons are within one paper. Counts by parameter and database are on Stats."));
  assert.doesNotMatch(text, /\bfive\b|\bv[12]\b|independent|claim|agentic|blind|undefined|NaN|null/i);
  assert.match(html, /not yet <span class="nowrap">re-read<\/span>/);
  // Links into Browse only where Browse can filter by the result (its option exists and the record index carries the
  // comparison): Corrects a value always; without the comparison in the record index none.
  assert.doesNotMatch(html, /#browse\?db=/);
  runtimeManifest.viewer_index.optional_fields = ["database_summary"];
  try {
    html = api.guideDatabasesHtml(bundleComparison(), earlierOverview);
    assert.match(html, /1,548 values in <a href="[^"]*#browse\?db=corrects">1,443 records<\/a>/);
    for (const item of api.GUIDE_DB_RESULTS.flatMap((result) => [result, result.nested].filter(Boolean))) {
      const href = api.guideDatabaseBrowseHref(item.key);
      assert.ok(href === "" || href.endsWith(`#browse?db=${item.key}`), href);
      if (href) assert.ok(html.includes(`href="${href}"`), item.key);
    }
  } finally {
    delete runtimeManifest.viewer_index.optional_fields;
  }
  // N databases: a sixth the snapshot counts values for joins by itself, in the manifest's order.
  const six = bundleComparison();
  six.values_by_database.UniProt = { same: 1 };
  assert.match(plain(api.guideDatabasesHtml(six)), /with the values BRENDA, SABIO-RK, OED, SKiD, STRENDA DB and UniProt list for the same paper\./);
  // The manifest's sources list names the databases with their versions, dates and values.
  six.sources = [{ key: "brenda", name: "BRENDA", version: "2026.1", retrieved: "2026-10-07", rows: 297863 },
    { key: "strenda", name: "STRENDA", display: "STRENDA DB", retrieved: "2026-10-07" }, "uniprot"];
  html = api.guideDatabasesHtml(six);
  assert.match(plain(html), /with the values BRENDA, STRENDA DB and UniProt list for the same paper\./);
  const sources = [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) => plain(match[1]));
  assert.equal(sources.length, 3);
  assert.match(sources[0], /^BRENDA 2026\.1, retrieved Oct 7, 2026 \(297,863 values\)$/);
  assert.match(sources[1], /^STRENDA DB, retrieved Oct 7, 2026$/);
  assert.equal(sources[2], "UniProt");
  // Counts of the three ways and of the six reasons when the manifest has them (by cause then way, or by way then cause).
  const counted = bundleComparison();
  counted.corrections.by_cause_found_by = { power_of_ten: { factor_cross_checked: 300, factor_only: 257 }, unit_not_converted: { paper_check: 126 } };
  counted.values.not_listed_by_reason = { kcat: { ratio_only: 0, condition_absent: 1792, substrate_absent: 10 },
    Km: { condition_absent: 1607, metric_absent: 3, variant_absent: 4 }, "kcat/Km": { condition_absent: 1130, ratio_only: 4873, paper_not_in_databases: 336 } };
  html = api.guideDatabasesHtml(counted);
  assert.deepEqual(Object.values(items(html, "How a correction is found")).map((value) => value.match(/([\d,]+) values$/)?.[1]), ["126", "300"]);
  assert.doesNotMatch(plain(html), /Found by code/);
  // An older comparison counts its factor-only values among the corrections: the Guide moves them under Different
  // number (1,548 - 257 correct; 1,051 + 257 differ), with their own line and count there.
  assert.match(items(html, "Results")["Corrects a value"], /1,291 values in 1,443 records$/);
  assert.match(items(html, "Results")["Different number"], /1,308 values in 955 records Among them, exact factor, not yet checked: [^;]*; the record says Different number \(exact factor, not yet checked\) and names the factor \(257 values\)\.$/);
  // (shortened in round 13: the database's number is the paper's times a power of ten, 60 or 3,600, not yet checked)
  assert.match(items(html, "Results")["Different number"], /Among them, exact factor, not yet checked: the database’s number is the paper’s times a power of ten, 60 or 3,600, not yet checked against the paper;/);
  assert.deepEqual(Object.values(items(html, "Why no database lists a value")).map((value) => value.match(/([\d,]+) values(?: from [\d,]+ papers?)?$/)?.[1]),
    ["4,873", "4,529", "10", "3", "4", "336"]);
  counted.corrections.by_cause_found_by = { paper_check: { unit_not_converted: 5 }, factor_only: { power_of_ten: 2 } };
  assert.deepEqual(Object.values(items(api.guideDatabasesHtml(counted), "How a correction is found")).map((value) => value.match(/([\d,]+) values?$/)?.[1]), ["5", "0"]);
  assert.match(items(api.guideDatabasesHtml(counted), "Results")["Different number"], /1,053 values in 955 records Among them, [^]*\(2 values\)\.$/);
  // A comparison that counts them under Different number itself: as a status of their own (counted into Different
  // number, no move), or as a count under differs.
  const ownStatus = bundleComparison();
  ownStatus.values.all.differs_factor_only = 40;
  assert.match(items(api.guideDatabasesHtml(ownStatus), "Results")["Different number"], /^[^]*1,091 values in 955 records Among them, [^]*\(40 values\)\.$/);
  assert.match(items(api.guideDatabasesHtml(ownStatus), "Results")["Corrects a value"], /1,548 values in 1,443 records$/);
  const underDiffers = bundleComparison();
  underDiffers.differs = { by_found_by: { factor_only: 12 } };
  assert.match(items(api.guideDatabasesHtml(underDiffers), "Results")["Different number"], /1,051 values in 955 records Among them, [^]*\(12 values\)\.$/);
  // Without counts: the words alone, never an empty count, a guessed number or a heading without its list.
  html = api.guideDatabasesHtml({});
  text = plain(html);
  assert.doesNotMatch(html, /guide-db-count|guide-db-note">Found by code|<li>/);
  assert.doesNotMatch(text, /undefined|NaN|null|This snapshot compares|Where a database lists a number for the same measurement|in this snapshot/);
  assert.match(text, /with the values BRENDA, SABIO-RK, OED, SKiD, STRENDA DB and UniProt list for the same paper\./);
  assert.equal([...html.matchAll(/<h3 /g)].length, 5);
  // The section at a glance (round 13): the lead and the results as cards; what is compared, the causes, how a correction
  // is found and why no database lists a value in disclosures, each headed by its h3.
  assert.deepEqual([...html.matchAll(/<summary><h3 id="([a-z-]+)">/g)].map((match) => match[1]),
    ["guide-databases-compared", "guide-databases-causes", "guide-databases-found", "guide-databases-not-listed"]);
  assert.match(html, /<dl class="guide-status-list guide-db-results guide-db-cards">/);
  assert.equal(Object.keys(items(html, "Results")).length, 6);
  assert.equal(api.guideDatabasesHtml(null), "");
  // A snapshot whose records carry no earlier corrections leaves Corrected earlier out (Browse has no such option then).
  assert.ok(!("Corrected earlier" in items(api.guideDatabasesHtml(bundleComparison(), { earlier_corrections: { records: 0 } }), "Results")));
  assert.ok("Corrected earlier" in items(api.guideDatabasesHtml(bundleComparison(), { quality: { earlier_corrections: { records: 5 } } }), "Results"));
  // The section and its lines in the contents and under Questions show with the manifest's comparison (or the record
  // index's); the body is written then.
  {
    const sectionItems = [{ hidden: true }, { hidden: true }, { hidden: true }];
    const previousAll = document.querySelectorAll;
    document.querySelectorAll = (selector) => selector === "[data-guide-database-section]" ? sectionItems : previousAll(selector);
    const hadSummary = "summary" in runtimeManifest;
    const previousSummary = runtimeManifest.summary;
    try {
      runtimeManifest.summary = { ...(previousSummary || {}) };
      delete runtimeManifest.summary.database_comparison;
      api.renderGuideDatabases();
      assert.deepEqual(sectionItems.map((item) => item.hidden), [true, true, true]);
      assert.equal(element("guideDatabasesBody").innerHTML, "");
      runtimeManifest.summary.database_comparison = bundleComparison();
      api.renderGuideDatabases();
      assert.deepEqual(sectionItems.map((item) => item.hidden), [false, false, false]);
      assert.match(element("guideDatabasesBody").innerHTML, /This snapshot compares 126,951 values from 2,650 papers\./);
      // One paper count per set: the Guide names the papers with a compared value, as Stats' lead does.
      runtimeManifest.summary.database_comparison = { ...bundleComparison(), papers_compared: 2598 };
      api.renderGuideDatabases();
      assert.match(element("guideDatabasesBody").innerHTML, /This snapshot compares 126,951 values from 2,598 papers\./);
      delete runtimeManifest.summary.database_comparison;
      runtimeManifest.viewer_index.optional_fields = ["database_summary"];
      api.renderGuideDatabases();
      assert.deepEqual(sectionItems.map((item) => item.hidden), [false, false, false]);
      assert.doesNotMatch(element("guideDatabasesBody").innerHTML, /This snapshot compares/);
    } finally {
      document.querySelectorAll = previousAll;
      delete runtimeManifest.viewer_index.optional_fields;
      if (hadSummary) runtimeManifest.summary = previousSummary;
      else delete runtimeManifest.summary;
      api.renderGuideDatabases();
    }
  }
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
    // On a phone or tablet the link shows the paper's records without the record (it covers the list there).
    assert.equal(api.hashWithoutRecord("#browse?q=pmid:12234181&record=paper-a", "paper-a"), "#browse?q=pmid:12234181");
    assert.equal(api.hashWithoutRecord("#browse?record=paper%20a&q=doi:10.1/x", "paper a"), "#browse?q=doi:10.1/x");
    assert.equal(api.hashWithoutRecord("#browse?q=x&record=paper-a&page=2", "paper-a"), "#browse?q=x&page=2");
    assert.equal(api.hashWithoutRecord("#browse?q=x&record=other", "paper-a"), "#browse?q=x&record=other", "another record stays");
    api.renderDetail(summary, {});
    assert.doesNotMatch(element("detailContent").innerHTML, /In CatLog/, "no paper, no link");
    // A record that names several papers gives each its count and link beside its ID in the PubMed IDs row (one row,
    // no ID listed twice, no separate In CatLog row); a paper with only this record says so without a link.
    api.state.records = [{ ...summary, _pmids: [12234181, 777, 777] }, row({ record_key: "paper-c", _pmids: 12234181 }),
      row({ record_key: "paper-d", _pmids: [5, 12234181] })];
    api.renderDetail(summary, { supporting_pmids: ["12234181", "777"] });
    let paperHtml = element("detailContent").innerHTML;
    assert.match(paperHtml, /<div class="kv-line paper-records-row"><dt>PubMed IDs<\/dt><dd><div class="reference-list"><span class="paper-records-item"><a class="reference-link" href="https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/12234181\/"[^>]*>12234181<\/a><span class="paper-records-sep" aria-hidden="true"> · <\/span><a class="paper-records-link" href="#browse\?q=pmid:12234181&amp;record=paper-a" aria-label="3 records in CatLog from PMID 12234181">3 records in CatLog<span aria-hidden="true"> →<\/span><\/a><\/span>/);
    assert.match(paperHtml, />777<\/a><span class="paper-records-sep" aria-hidden="true"> · <\/span><span class="paper-records-only">only this record in CatLog<\/span>/,
      "a PMID listed twice in a row's index entry counts the row once");
    assert.doesNotMatch(paperHtml, /In CatLog<\/dt>/);
    assert.equal((paperHtml.match(/>12234181<\/a>/g) || []).length, 1, "each ID is listed once");
    // Before the record index is loaded each paper links without a count; the refresh fills them in place.
    api.state.recordsReady = false;
    api.renderDetail(summary, { supporting_pmids: ["12234181", "777"] });
    paperHtml = element("detailContent").innerHTML;
    assert.match(paperHtml, /href="#browse\?q=pmid:777&amp;record=paper-a" aria-label="Records in CatLog from PMID 777">Records in CatLog</);
    // Several DOIs and no PMID: the DOIs row does the same; a single PMID with several DOIs keeps one In CatLog link.
    api.state.recordsReady = true;
    api.renderDetail(summary, { supporting_dois: ["10.1/a", "10.1/b"] });
    paperHtml = element("detailContent").innerHTML;
    assert.match(paperHtml, /<dt>DOIs<\/dt><dd><div class="reference-list"><span class="paper-records-item"><a class="reference-link" href="https:\/\/doi\.org\/10\.1\/a"/);
    assert.match(paperHtml, /href="#browse\?q=doi:10\.1\/b&amp;record=paper-a" aria-label="Records in CatLog from DOI 10\.1\/b">Records in CatLog</);
    api.renderDetail(summary, { supporting_pmids: ["12234181"], supporting_dois: ["10.1/a", "10.1/b"] });
    paperHtml = element("detailContent").innerHTML;
    assert.match(paperHtml, /<dt>DOIs<\/dt><dd><div class="reference-list"><a class="reference-link"/);
    assert.match(paperHtml, /<dt>In CatLog<\/dt><dd><a class="paper-records-link" href="#browse\?q=pmid:12234181&amp;record=paper-a">3 records from this paper</);
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
    "hc-note": { checked: false, note: "A human reviewer checked the same Km in CatLog's 2026 review of CatLog v1 entries." },
    "hc-note-2": { checked: false, note: "A human reviewer approved the same kcat and Km for this paper in the 2026 review of CatLog v1 entries; kcat/Km was not reviewed." },
    "hc-fixed": { checked: true, note: "Checked by a human reviewer. Corrected after human review: Km unit." },
  });
  const accepted = row({ record_key: "hc-accepted", measurement_key: "hc-accepted", verification_status: "verified" });
  const pending = row({ record_key: "hc-pending", measurement_key: "hc-pending", verification_status: "manual_review_required" });
  const noted = row({ record_key: "hc-note", measurement_key: "hc-note", verification_status: "corrected" });
  assert.match(api.statusBadge(accepted), /<span class="state-tag human-checked"><svg class="check-icon"[^>]*>.*<\/svg>human-checked<\/span>/);
  // The same mark as a check after the review result, for a table short of room or beside an open record.
  assert.match(api.statusBadge(accepted), /<span class="state-label">Accepted<span class="state-check" role="img" aria-label="human-checked"><svg class="check-icon"/);
  assert.doesNotMatch(api.statusBadge(pending), /human-checked/);
  assert.doesNotMatch(api.statusBadge(noted), /human-checked/);
  api.renderDetail(accepted, {});
  let html = element("detailContent").innerHTML;
  assert.match(html, /class="detail-status-checked"><svg class="check-icon"/);
  assert.match(html, /<div class="kv-line human-review-line"><dt>Human review<\/dt><dd><svg class="check-icon"[^>]*>.*<\/svg>A human reviewer approved every kcat and Km shown; the kcat\/Km was approved too or agrees with kcat ÷ Km\.<\/dd><\/div>/);
  assert.match(api.statusBadge(accepted), /title="[^"]*Human-checked: a human reviewer approved every kcat and Km shown; the kcat\/Km was approved too or agrees with kcat ÷ Km\."/);
  assert.match(api.statusBadge(accepted), /aria-label="Accepted, Not yet re-read, BRENDA, human-checked"/);
  api.renderDetail(pending, {});
  html = element("detailContent").innerHTML;
  assert.doesNotMatch(html, /detail-status-checked/);
  assert.match(html, /<dt>Human review<\/dt><dd>A human reviewer approved these values; the record&#39;s status comes from the automated review\.<\/dd>/);
  api.renderDetail(noted, {});
  // A note's review year is not shown (facts only), and a note that names CatLog v1 entries says the earlier version's
  // entries (CatLog is the one name, round 8).
  assert.match(element("detailContent").innerHTML, /<dt>Human review<\/dt><dd>A human reviewer checked the same Km in CatLog&#39;s review of the earlier version&#39;s entries\./);
  api.renderDetail(row({ record_key: "hc-note-2", measurement_key: "hc-note-2" }), {});
  assert.match(element("detailContent").innerHTML, /<dd>A human reviewer approved the same kcat and Km for this paper in the review of the earlier version&#39;s entries; kcat\/Km was not reviewed\.<\/dd>/);
  // The other shapes a note could take say the same.
  assert.deepEqual(["The CatLog v1 entry has no Km.", "a CatLog v1 entry", "An CatLog v1 entry", "CatLog v2 entries agree", "A CatLog v2 entry", "CatLog v2 reads"].map(api.versionWords),
    ["The earlier version's entry has no Km.", "an entry from the earlier version", "An entry from the earlier version", "records read from the paper agree", "A record read from the paper", "CatLog reads"]);
  // A correction made after human review is said as given, in the Human review line.
  api.renderDetail(row({ record_key: "hc-fixed", measurement_key: "hc-fixed", verification_status: "verified" }), {});
  assert.match(element("detailContent").innerHTML, /<dt>Human review<\/dt><dd><svg class="check-icon"[^>]*>.*<\/svg>Checked by a human reviewer\. Corrected after human review: Km unit\.<\/dd>/);
  // A check after each value a human reviewer approved (Values table), with its meaning once under the table: every value
  // of a checked record, the values the review's sentence names on another, the mark's own list when it has one.
  const approvedValues = (html) => [...html.matchAll(/<tr><th scope="row">(.*?)<\/th><td class="vt-value"><span class="vt-number">[^<]*(<span class="value-approved"[^>]*>)?/g)]
    .filter((match) => match[2]).map((match) => match[1].replace(/<[^>]+>/g, ""));
  // (named by its tooltip alone: a title beside an aria-label is read out again as a description)
  const APPROVED_NAME = /<span class="value-approved" role="img" title="approved by a human reviewer"><svg class="check-icon"/;
  // A checked record without a list: its kcat and Km (its kcat/Km was approved too or only agrees with kcat ÷ Km, so
  // being checked never puts a check on it).
  api.renderDetail(accepted, {});
  html = element("detailContent").innerHTML;
  assert.deepEqual(approvedValues(html), ["kcat", "Km"]);
  assert.match(html, APPROVED_NAME);
  assert.doesNotMatch(html, /class="value-approved"[^>]*aria-label/);
  assert.match(html, /<li><span class="value-approved-key"><svg class="check-icon"[^>]*>.*?<\/svg><\/span>Approved by a human reviewer \(see <button class="text-button review-row-link" type="button" data-show-row="human-review-line">Human review<\/button> below\)\.<\/li>/);
  api.renderDetail(row({ record_key: "hc-note-2", measurement_key: "hc-note-2" }), {});
  html = element("detailContent").innerHTML;
  assert.deepEqual(approvedValues(html), ["kcat", "Km"]);
  // A row without a check keeps an unseen copy of its space, so the numbers end at the same place; a word joiner ties
  // each check (or its copy) to its number, so a narrow cell never puts it on a line of its own.
  assert.match(html, /<span class="vt-number">1&#8288;<span class="value-approved vt-ghost" aria-hidden="true"><svg/);
  assert.match(html, /<table class="values-table[^"]* vt-checks"/, "a table with checks keeps a margin for them on the narrowest phones");
  // The Value heading keeps the check's space after it too, so it ends where the numbers end; its text stays "Value".
  assert.match(html, /<th scope="col" class="vt-value"><span class="vt-head">Value<span class="value-approved vt-ghost" aria-hidden="true"><svg[^>]*>.*?<\/svg><\/span><\/span><\/th>/);
  // A note that is not the review's sentence marks nothing (no guessing from free text).
  api.renderDetail(noted, {});
  assert.deepEqual(approvedValues(element("detailContent").innerHTML), []);
  assert.doesNotMatch(element("detailContent").innerHTML, /value-approved/);
  api.setHumanReviewMarks({
    "hc-list": { checked: false, approved: ["Km", "kcat/Km"] },
    "hc-list-noted": { checked: false, approved: ["kcat"], note: "A reviewer questioned this Km." },
    "hc-calc": { checked: true },
    "hc-strict": { checked: false, note: "A human reviewer approved the same Vmax and Km for this paper." },
    "hc-big-km": { checked: true, approved: ["kcat", "km", "kcat_over_km"] },
    "hc-only-km": { checked: true },
    // the marks file's list holds only values a reviewer approved: a kcat/Km that agrees with the approved kcat ÷ Km is
    // left out of it, and a sentence naming kcat/Km gives a checked record without a list its check
    "hc-follows": { checked: true, approved: ["kcat", "km"], note: "A human reviewer approved the same kcat and Km for this paper in the 2026 review of CatLog v1 entries." },
    "hc-named": { checked: true, note: "A human reviewer approved the same kcat, Km and kcat/Km for this paper in the 2026 review of CatLog v1 entries." },
  });
  api.renderDetail(row({ record_key: "hc-follows", measurement_key: "hc-follows", verification_status: "verified" }), {});
  html = element("detailContent").innerHTML;
  assert.deepEqual(approvedValues(html), ["kcat", "Km"], "a kcat/Km that only agrees with kcat ÷ Km carries no check");
  assert.match(plainMetricNames(html), /<li><span class="value-approved-key">.*?<\/span>Approved by a human reviewer \(see <button class="text-button review-row-link" type="button" data-show-row="human-review-line">Human review<\/button> below\)\. The kcat\/Km carries no check: it agrees with the approved kcat ÷ Km\.<\/li>/);
  assert.deepEqual((await recordDownloadPayload(row({ record_key: "hc-follows", measurement_key: "hc-follows" }), {})).human_approved_values, ["kcat", "Km"]);
  api.renderDetail(row({ record_key: "hc-named", measurement_key: "hc-named", verification_status: "verified" }), {});
  html = element("detailContent").innerHTML;
  assert.deepEqual(approvedValues(html), ["kcat", "Km", "kcat/Km"]);
  assert.doesNotMatch(html, /agrees with the approved/, "without a list, nothing is said about how the kcat/Km was approved");
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
  // The heading keeps the calc. space as well (the stylesheet draws its unseen "calc.").
  assert.match(element("detailContent").innerHTML, /<span class="vt-head">Value<span class="value-approved vt-ghost" aria-hidden="true"><svg[^>]*>.*?<\/svg><\/span><small class="metric-origin vt-ghost" aria-hidden="true"><\/small><\/span><\/th>/);
  // The line under the table says why the calc. kcat/Km beside checked values has none.
  assert.match(plainMetricNames(element("detailContent").innerHTML), /<li><span class="value-approved-key">.*?<\/span>Approved by a human reviewer \(see <button class="text-button review-row-link" type="button" data-show-row="human-review-line">Human review<\/button> below\)\. The calc\. kcat\/Km carries no check: CatLog calculated it\.<\/li>/);
  api.renderDetail(row({ record_key: "hc-strict", measurement_key: "hc-strict" }), {});
  assert.doesNotMatch(element("detailContent").innerHTML, /value-approved/, "a sentence naming another quantity marks nothing");
  // A value under a magnitude caution ("Km is above 10 M; the unit or the value may be wrong.") carries no check, also in
  // the record download, and the note under the table says why; Km below 1 nM counts too.
  const bigKm = row({ record_key: "hc-big-km", measurement_key: "hc-big-km", km: 37500, km_display: "37500", kcat_over_km: 0.0032,
    kcat_over_km_display: "0.0032", condition_flags: ["km_magnitude_needs_check"] });
  api.renderDetail(bigKm, {});
  html = element("detailContent").innerHTML;
  assert.match(html, /Km is above 10 M; the unit or the value may be wrong\./);
  assert.deepEqual(approvedValues(html), ["kcat", "kcat/Km"]);
  assert.match(plainMetricNames(html), /<li><span class="value-approved-key">.*?<\/span>Approved by a human reviewer \(see <button class="text-button review-row-link" type="button" data-show-row="human-review-line">Human review<\/button> below\)\. Km carries no check: the note above questions its unit or value\.<\/li>/);
  assert.deepEqual((await recordDownloadPayload(bigKm, {})).human_approved_values, ["kcat", "kcat/Km"]);
  api.renderDetail(row({ record_key: "hc-big-km", measurement_key: "hc-big-km", km: 9e-7, km_display: "9e-7" }), {});
  assert.deepEqual(approvedValues(element("detailContent").innerHTML), ["kcat", "kcat/Km"], "Km below 1 nM: no check");
  const onlyKm = row({ record_key: "hc-only-km", measurement_key: "hc-only-km", kcat: null, kcat_display: "", kcat_over_km: null,
    kcat_over_km_display: "", km: 37500, km_display: "37500", condition_flags: ["km_magnitude_needs_check"] });
  api.renderDetail(onlyKm, {});
  html = element("detailContent").innerHTML;
  assert.deepEqual(approvedValues(html), []);
  assert.doesNotMatch(html, /value-approved/);
  // A human-checked record whose only approved value has its check withheld still says it is human-checked under the
  // table, so its badge and the unmarked table agree; a record that is not accepted says only what the reviewer approved.
  assert.match(html, /<li>Human-checked: a human reviewer approved <i>K<\/i><sub>m<\/sub> \(see <button class="text-button review-row-link" type="button" data-show-row="human-review-line">Human review<\/button> below\), but it carries no check: the note above questions its unit or value\.<\/li>/);
  assert.ok(!("human_approved_values" in await recordDownloadPayload(onlyKm, {})), "no check shown, none listed");
  api.renderDetail({ ...onlyKm, verification_status: "manual_review_required" }, {});
  assert.match(element("detailContent").innerHTML, /<li>A human reviewer approved <i>K<\/i><sub>m<\/sub> \(see <button class="text-button review-row-link" type="button" data-show-row="human-review-line">Human review<\/button> below\), but it carries no check: the note above questions its unit or value\.<\/li>/);
  // A human-checked record without a note names only the values it shows: a Km-only record says nothing of a kcat or a
  // kcat/Km it does not have; with the mark's list, a kcat/Km that was not approved itself agrees with kcat ÷ Km.
  const humanLine = (record) => {
    api.renderDetail(record, {});
    return element("detailContent").innerHTML.match(/<dt>Human review<\/dt><dd>(?:<svg[^>]*>.*?<\/svg>)?(.*?)<\/dd>/)?.[1];
  };
  api.setHumanReviewMarks({
    "hc-km": { checked: true, approved: ["km"] },
    "hc-kcat": { checked: true, approved: ["kcat"] },
    "hc-pair": { checked: true, approved: ["kcat", "km"] },
    "hc-all": { checked: true, approved: ["kcat", "km", "kcat_over_km"] },
    "hc-only-km": { checked: true },
  });
  const kmOnly = { kcat: null, kcat_display: "", kcat_over_km: null, kcat_over_km_display: "" };
  assert.equal(humanLine(row({ record_key: "hc-km", measurement_key: "hc-km", ...kmOnly })), "A human reviewer approved the Km shown.");
  assert.equal(humanLine(row({ record_key: "hc-only-km", measurement_key: "hc-only-km", ...kmOnly })), "A human reviewer approved the Km shown.",
    "a mark without a list: the values shown");
  assert.equal(humanLine(row({ record_key: "hc-kcat", measurement_key: "hc-kcat", km: null, km_display: "", kcat_over_km: null, kcat_over_km_display: "" })),
    "A human reviewer approved the kcat shown.");
  assert.equal(humanLine(row({ record_key: "hc-pair", measurement_key: "hc-pair" })),
    "A human reviewer approved the kcat and Km shown; the kcat/Km agrees with kcat ÷ Km.");
  assert.equal(humanLine(row({ record_key: "hc-pair", measurement_key: "hc-pair", kcat_over_km: null, kcat_over_km_display: "" })),
    "A human reviewer approved the kcat and Km shown.");
  assert.equal(humanLine(row({ record_key: "hc-all", measurement_key: "hc-all" })), "A human reviewer approved the kcat, Km and kcat/Km shown.");
  assert.equal((await recordDownloadPayload(row({ record_key: "hc-km", measurement_key: "hc-km", ...kmOnly }), {})).human_review,
    "A human reviewer approved the Km shown.");
  // The badge keeps human-checked's general rule.
  assert.match(api.statusBadge(row({ record_key: "hc-km", measurement_key: "hc-km", ...kmOnly })), /Human-checked: a human reviewer approved every kcat and Km shown; the kcat\/Km was approved too or agrees with kcat ÷ Km\."/);
  api.setHumanReviewMarks({});
  api.renderDetail(accepted, {});
  assert.doesNotMatch(element("detailContent").innerHTML, /value-approved|Approved by a human reviewer/);
  assert.ok(!("human_approved_values" in await recordDownloadPayload(accepted, {})), "no check, no list");
  api.setHumanReviewMarks({
    "hc-accepted": { checked: true },
    "hc-pending": { checked: true },
    "hc-note": { checked: false, note: "A human reviewer checked the same Km in CatLog's 2026 review of CatLog v1 entries." },
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
  assert.equal(link.getAttribute("title"), null, "a count of 0 offers no records");
  // Read from the paper N: the records read by CatLog among the results, a link to them with the filters set now.
  assert.equal(element("fromPaperCount").textContent, "0");
  assert.equal(element("fromPaperLink").getAttribute("href"), null, "0 is plain text");
  assert.equal(element("fromPaperLink").getAttribute("title"), null, "0 is plain text, with no link title");
  const readByCatlog = row({ record_key: "fp-1", measurement_key: "fp-1", source_db: "primary_paper_direct", enzyme_label_source: "explicit_enzyme_name" });
  api.state.filtered = [readByCatlog, pending];
  api.renderSummary();
  assert.equal(element("fromPaperCount").textContent, "1");
  assert.equal(element("fromPaperLink").getAttribute("href"), "#browse?source=paper");
  assert.equal(element("fromPaperLink").getAttribute("title"), "Show the records read from the paper by CatLog");
  api.state.filtered = [pending, noted];
  api.setHumanReviewMarks({});
  api.renderSummary();
  assert.equal(element("humanCheckedCount").textContent, "—", "a filtered view without the marks has no count yet");
  api.state.filtered = [accepted, pending, noted];
  api.renderSummary();
  assert.equal(element("humanCheckedCount").textContent, "1,798", "before the marks load, the snapshot's count");
  assert.equal(link.getAttribute("href"), "#browse?checked=1");
  assert.equal(link.getAttribute("title"), "Show the accepted records a human reviewer approved");
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
  assert.equal(v2Payload.source, "CatLog (read from the paper)");
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
    { metric: "Km", result: "Corrects a value", line: "BRENDA lists 0.5499 mM, 1,000× lower.", databases: null, cause: "an mM value entered as µM", evidence: null },
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
  assert.match(api.statusBadge(oed), /<span class="state-tags"><span class="state-tag">not re-read<\/span><span class="state-tag">OED<\/span><span class="state-tag">corrected<\/span><\/span>/);
  assert.match(api.statusBadge(earlier), /<span class="state-tags"><span class="state-tag">not re-read<\/span><span class="state-tag">earlier extraction<\/span><\/span>/);
  assert.match(api.statusBadge(fromPaper), /<span class="state-tag">from paper<\/span>/);
  const keysFor = async (address) => {
    api.applyBrowseParams(new Map(new URLSearchParams(address)));
    await api.ensureCurrentFilters();
    return api.state.filtered.map((item) => item.record_key).sort();
  };
  assert.deepEqual(await keysFor("source=paper"), ["src-v2"]);
  assert.equal(api.browseHash(), "#browse?source=paper");
  assert.deepEqual([...api.activeFilterItems()].map((item) => item.label), ["Source: Read from the paper"]);
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
  // A chip says what the sidebar says ("Earlier extractions", "OED"); its button and the no-results note read the name in
  // full, as the sidebar does.
  assert.deepEqual([...api.activeFilterItems()].map((item) => [item.label, item.labelHtml]),
    [["Source: Earlier paper extractions", "Source: Earlier extractions"]]);
  assert.deepEqual(await keysFor("source=oed"), ["src-oed"]);
  assert.deepEqual([...api.activeFilterItems()].map((item) => [item.label, item.labelHtml]),
    [["Source: OED (Open Enzyme Database)", "Source: OED"]]);
  // An EC class chip is named as Stats names it: "EC 1" for ec=1. (a trailing dot left out).
  for (const [address, chip] of [["ec=1.", "EC 1"], ["ec=1.1.1.", "EC 1.1.1"], ["ec=EC+3.1.,+2.7", "EC 3.1, 2.7"], ["ec=1.1.1.1", "EC 1.1.1.1"]]) {
    api.applyBrowseParams(new Map(new URLSearchParams(address)));
    assert.deepEqual([...api.activeFilterItems()].map((item) => item.label), [chip], address);
  }
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

  // Each active filter's chip wears a colour (tone-<tone>); its words stay. An option that has a colour on the page wears
  // it (a review result its status colour, human-checked green, a database result its square's, a caution amber); the
  // other groups wear the colour of the dot beside their group in the sidebar. Undo (before Clear all) restores the
  // filter set before the last change, Clear all too; its name says what it gives back; the sort comes back only with the
  // Clear all that reset it (the user, 2026-10-15: "can the filters be different color or sth so that its user friendly
  // to keep track to undo").
  {
    assert.deepEqual(["source:paper", "status", "checked", "db:differs", "ec", "q", "enzyme", "organism", "substrate", "temperature", "ph",
      "metric:kcat", "variant:wild", "caution:units", "anything"].map(api.filterGroup),
    ["source", "review", "review", "databases", "identity", "identity", "identity", "identity", "identity", "measurement", "measurement",
      "measurement", "measurement", "caution", "measurement"]);
    const tones = (address, keys) => {
      api.applyBrowseParams(new Map(new URLSearchParams(address)));
      const controls = api.filterControlState();
      return keys.map((key) => api.filterChipTone(key, controls));
    };
    assert.deepEqual(tones("status=disputed&caution=none", ["status", "checked", "caution:none", "source:brenda", "ec", "tmin"]),
      ["st-disputed", "checked", "caution", "source", "identity", "measurement"]);
    assert.deepEqual(tones("status=accepted,curation_pending", ["status"]), ["neutral"], "several results: each is named after its dot");
    assert.deepEqual(tones("status=curation_pending", ["status"]), ["st-pending"]);
    assert.deepEqual(["db:corrects", "db:differs", "db:other_label", "db:not_listed", "db:all_not_listed", "db:all_same", "db:earlier"]
      .map((key) => api.filterChipTone(key)), ["cmp-corrects", "cmp-differs", "neutral", "cmp-new", "cmp-new", "cmp-same", "neutral"]);
    // A chip whose option has a mark on the page shows it before the option's name, so colour is not all that tells
    // the groups apart (the reviewer: some chip colours look alike to colour-blind readers): human-checked its tick (a
    // caution its "!" and a database result its square: the browser check); Source, the enzyme fields and the
    // measurement have none.
    api.applyBrowseParams(new Map(new URLSearchParams("checked=1&source=paper&ec=1.1&metric=kcat")));
    const marks = Object.fromEntries([...api.activeFilterItems()].map((item) => [item.key, item.labelHtml]));
    assert.match(marks.checked, /^<span class="chip-check"><svg class="check-icon" [^>]*aria-hidden="true"[\s\S]*<\/svg><\/span>Only human-checked$/);
    assert.deepEqual([marks["source:paper"], marks.ec, marks["metric:kcat"]].map((html) => /class="(?:chip-|db-mark)/.test(html)), [false, false, false]);
    await keysFor("status=accepted,curation_pending");
    assert.match(element("activeFilters").innerHTML, /<\/button><button class="filter-chip tone-neutral" type="button" data-filter-key="status" title="Remove filter: Review result: Accepted, Not confirmed" aria-label="Remove filter: Review result: Accepted, Not confirmed"><span>Review result: <span class="chip-state accepted">Accepted<\/span>, <span class="chip-state review">Not confirmed<\/span><\/span>/);
    const bar = () => element("activeFilters").innerHTML;
    // Undo keeps its place first in the bar, dimmed when there is nothing to undo, so pressing it again never lands on a
    // chip or Clear all.
    const nothing = '<button class="text-button filter-chips-undo" type="button" data-filter-undo="" title="Nothing to undo" aria-label="Undo the last filter change" disabled>Undo</button>';
    api.state.filterHistory.length = 0;
    api.state.filterBase = null;
    api.state.filterUndoKeepsPlace = false;
    await keysFor("source=paper");
    assert.equal(api.state.filterHistory.length, 0, "the address's filters are the start, not a change");
    assert.ok(bar().startsWith(`${nothing}<button class="filter-chip tone-paper" type="button" data-filter-key="source:paper" title="Remove filter: Source: Read from the paper"`), bar());
    assert.equal(element("activeFilters").hidden, false);
    assert.equal(element("undoFiltersButton").disabled, true, "the phone sheet's Undo is dimmed too");
    assert.equal(element("undoFiltersButton").title, "Nothing to undo");
    await keysFor("source=paper&ec=1.1.1&tmin=20");
    assert.equal(api.state.filterHistory.length, 1);
    assert.deepEqual([...bar().matchAll(/class="filter-chip (tone-[\w-]+)"/g)].map((match) => match[1]), ["tone-paper", "tone-identity", "tone-measurement"]);
    const back = "Undo the last filter change, back to Source: Read from the paper";
    assert.ok(bar().startsWith(`<button class="text-button filter-chips-undo" type="button" data-filter-undo="" title="${back}" aria-label="${back}">Undo</button><button class="filter-chip `), bar());
    assert.ok(bar().endsWith('<button class="text-button filter-chips-clear" type="button" data-filter-clear="">Clear all</button>'), bar());
    assert.equal(element("undoFiltersButton").disabled, false, "the phone sheet's Undo too");
    assert.equal(element("undoFiltersButton").getAttribute("aria-label"), back);
    api.undoFilterChange();
    await api.ensureCurrentFilters();
    assert.equal(api.browseHash(), "#browse?source=paper");
    assert.equal(api.state.filterHistory.length, 0, "applying the restored set keeps nothing for Undo");
    assert.equal(element("tableStatus").textContent, "Filters restored: Source: Read from the paper");
    assert.ok(bar().startsWith(nothing), bar());
    assert.equal(element("undoFiltersButton").disabled, true);
    // Clear all can be undone: with no filter left the bar shows Undo alone; the sort Clear all reset comes back.
    await keysFor("source=paper&ec=1.1.1&sort=km");
    api.state.filterHistory.length = 0;
    api.clearFilters();
    await api.ensureCurrentFilters();
    assert.equal(api.browseHash(), "");
    assert.equal(element("sortSelect").value, "evidence");
    assert.equal(bar(), '<button class="text-button filter-chips-undo" type="button" data-filter-undo="" title="Undo the last filter change, back to Source: Read from the paper; EC 1.1.1" aria-label="Undo the last filter change, back to Source: Read from the paper; EC 1.1.1">Undo</button>');
    assert.equal(element("activeFilters").hidden, false);
    api.undoFilterChange();
    await api.ensureCurrentFilters();
    assert.equal(api.browseHash(), "#browse?ec=1.1.1&source=paper&sort=km");
    // A sort changed after the change undone stays.
    api.applyBrowseParams(new Map(new URLSearchParams("ec=1.1.1&source=paper&sort=km&tmin=20")));
    await api.ensureCurrentFilters();
    api.applyBrowseParams(new Map(new URLSearchParams("ec=1.1.1&source=paper&sort=enzyme&tmin=20")));
    await api.ensureCurrentFilters();
    api.undoFilterChange();
    await api.ensureCurrentFilters();
    assert.equal(api.browseHash(), "#browse?ec=1.1.1&source=paper&sort=enzyme");
    // At most 30 changes are kept, newest last.
    for (let index = 0; index < 35; index += 1) await keysFor(`tmin=${index}`);
    assert.equal(api.state.filterHistory.length, 30);
    assert.equal(api.state.filterHistory.at(-1).key, "#browse?tmin=33");
    api.state.filterHistory.length = 0;
    await keysFor("");
    api.state.filterHistory.length = 0;
    api.renderActiveFilters();
    assert.equal(bar(), nothing, "after an Undo the bar keeps Undo's place, so the table does not move under the pointer");
    api.state.filterUndoKeepsPlace = false;
    api.renderActiveFilters();
    assert.equal(bar(), "");
    assert.equal(element("activeFilters").hidden, true);
  }

  // Typing in one field is one Undo step, not one per pause (the reviewer: "lipase" typed at 250ms a key took five
  // presses); leaving the field, or another field, starts a new step; typing back to where it began leaves nothing to
  // undo; keys no pass has applied yet are undone first.
  {
    const hashFor = (address) => {
      api.applyBrowseParams(new Map(new URLSearchParams(address)));
      return api.browseHash();
    };
    const type = async (field, address) => {
      api.noteFilterTyping(field);
      await keysFor(address);
    };
    api.state.filterTyping = null;
    await keysFor("source=paper&metric=km");
    api.state.filterHistory.length = 0;
    const start = api.browseHash();
    for (const text of ["l", "li", "lip", "lipa", "lipas", "lipase"]) await type("enzyme", `source=paper&metric=km&enzyme=${text}`);
    assert.deepEqual([...api.state.filterHistory].map((entry) => entry.key), [start], "one step for the typed word");
    api.endFilterTyping("enzyme");
    await type("enzyme", "source=paper&metric=km&enzyme=lipase A");
    assert.equal(api.state.filterHistory.length, 2, "leaving the field ends the step");
    const withWord = api.state.filterHistory[1].key;
    assert.equal(withWord, hashFor("source=paper&metric=km&enzyme=lipase"));
    await type("organism", "source=paper&metric=km&enzyme=lipase A&organism=c");
    await type("organism", "source=paper&metric=km&enzyme=lipase A&organism=coli");
    assert.equal(api.state.filterHistory.length, 3, "another field is another step");
    // The two temperature bounds are one field.
    await type("temperature", "source=paper&metric=km&enzyme=lipase A&organism=coli&tmin=2");
    await type("temperature", "source=paper&metric=km&enzyme=lipase A&organism=coli&tmin=25");
    await type("temperature", "source=paper&metric=km&enzyme=lipase A&organism=coli&tmin=25&tmax=4");
    assert.equal(api.state.filterHistory.length, 4);
    // Typed and deleted again: nothing to undo for it.
    await type("substrate", "source=paper&metric=km&enzyme=lipase A&organism=coli&tmin=25&tmax=4&substrate=n");
    assert.equal(api.state.filterHistory.length, 5);
    await type("substrate", "source=paper&metric=km&enzyme=lipase A&organism=coli&tmin=25&tmax=4");
    assert.equal(api.state.filterHistory.length, 4);
    // A box ticked while a step is open ends it.
    await type("substrate", "source=paper&metric=km&enzyme=lipase A&organism=coli&tmin=25&tmax=4&substrate=n");
    await keysFor("source=paper&metric=km,kcat&enzyme=lipase A&organism=coli&tmin=25&tmax=4&substrate=n");
    await type("substrate", "source=paper&metric=km,kcat&enzyme=lipase A&organism=coli&tmin=25&tmax=4&substrate=nad");
    assert.equal(api.state.filterHistory.length, 7);
    // Keys no pass has applied yet (still in their 180ms pause) are undone first, back to the set the results show...
    const shown = api.browseHash();
    api.noteFilterTyping("ec");
    api.applyBrowseParams(new Map(new URLSearchParams("source=paper&metric=km,kcat&enzyme=lipase A&organism=coli&tmin=25&tmax=4&substrate=nad&ec=1.1")));
    api.state.filterTimerPending = true;
    api.undoFilterChange();
    await api.ensureCurrentFilters();
    assert.equal(api.browseHash(), shown);
    assert.equal(api.state.filterHistory.length, 7, "nothing kept was undone");
    // So is a change whose pass has not finished (a bound applied as it lost the focus to Undo): one press, one change.
    api.applyBrowseParams(new Map(new URLSearchParams("source=paper&metric=km,kcat&enzyme=lipase A&organism=coli&tmin=25&tmax=4&substrate=nad&phmin=7")));
    api.state.filterTimerPending = false;
    api.undoFilterChange();
    await api.ensureCurrentFilters();
    assert.equal(api.browseHash(), shown);
    assert.equal(api.state.filterHistory.length, 7, "nothing kept was undone");
    // ...unless they continue the typing the last step holds: then the whole typing goes.
    await type("substrate", "source=paper&metric=km,kcat&enzyme=lipase A&organism=coli&tmin=25&tmax=4&substrate=nadh");
    assert.equal(api.state.filterHistory.length, 8);
    const beforeTyping = api.state.filterHistory[7].key;
    api.noteFilterTyping("substrate");
    api.applyBrowseParams(new Map(new URLSearchParams("source=paper&metric=km,kcat&enzyme=lipase A&organism=coli&tmin=25&tmax=4&substrate=nadph")));
    api.state.filterTimerPending = true;
    api.undoFilterChange();
    await api.ensureCurrentFilters();
    assert.equal(api.browseHash(), beforeTyping);
    assert.equal(api.state.filterHistory.length, 7);
    // Undo steps back through them one at a time: the typed word goes in one press.
    while (api.state.filterHistory.length > 1) {
      api.undoFilterChange();
      await api.ensureCurrentFilters();
    }
    assert.equal(api.browseHash(), withWord);
    api.undoFilterChange();
    await api.ensureCurrentFilters();
    assert.equal(api.browseHash(), start);
    api.state.filterHistory.length = 0;
    api.state.filterTyping = null;
    await keysFor("");
    api.state.filterHistory.length = 0;
    api.state.filterUndoKeepsPlace = false;
  }

  // Back or Forward landing on the set Undo would bring back takes that step off (the reviewer: Back then Forward left two
  // steps that undo each other); a link followed in the page that lands there is a change like any other.
  {
    const visit = async (hash, traversal) => {
      window.location.hash = hash;
      api.applyLocationFilters({ traversal });
      await api.ensureCurrentFilters();
      return [...api.state.filterHistory].map((entry) => [...entry.labels].join("; "));
    };
    await keysFor("source=paper&ec=1.1");
    api.state.filterHistory.length = 0;
    await keysFor("source=paper");
    assert.equal(api.state.filterHistory.length, 1);
    assert.deepEqual(await visit("#browse?ec=1.1&source=paper", true), [], "Back onto the set before the change");
    assert.deepEqual(await visit("#browse?source=paper", true), ["Source: Read from the paper; EC 1.1"], "Forward again: one step");
    assert.deepEqual(await visit("#browse?ec=1.1&source=paper", false), ["Source: Read from the paper; EC 1.1", "Source: Read from the paper"],
      "a link is a change");
    window.location.hash = "";
    api.state.filterHistory.length = 0;
    await keysFor("");
    api.state.filterHistory.length = 0;
    api.state.filterUndoKeepsPlace = false;
  }

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

  // Opening a record over the list adds one history entry that remembers the list (Back closes the record); another
  // record opened from there replaces it; × steps back over it only while the list behind is the one it was opened from,
  // else the address is rewritten in place and the entry is no record entry any more.
  {
    const calls = [];
    const original = { push: window.history.pushState, replace: window.history.replaceState, href: window.location.href };
    const go = (kind) => (state, _title, url) => {
      const next = new URL(url);
      calls.push([kind, next.hash]);
      window.history.state = state;
      window.location.href = next.href;
      window.location.hash = next.hash;
    };
    window.history.pushState = go("push");
    window.history.replaceState = go("replace");
    try {
      api.state.page = 1;
      api.applyBrowseParams(new Map(new URLSearchParams("q=src")));
      window.location.href = "https://example.test/catlog/#browse?q=src";
      window.location.hash = "#browse?q=src";
      window.history.state = null;
      api.syncRecordUrl("src-v2");
      assert.deepEqual(calls, [["push", "#browse?q=src&record=src-v2"]]);
      assert.equal(window.history.state.catlogRecordFrom, "#browse?q=src");
      api.syncRecordUrl("src-oed");
      assert.deepEqual(calls.at(-1), ["replace", "#browse?q=src&record=src-oed"], "another record replaces the entry");
      assert.equal(window.history.state.catlogRecordFrom, "#browse?q=src");
      window.history.back = () => {};
      assert.equal(api.canLeaveRecordEntry("src-oed"), true, "× steps back to the list");
      assert.equal(api.canLeaveRecordEntry("src-v2"), false, "not the record the address names");
      api.applyBrowseParams(new Map(new URLSearchParams("q=other&record=src-oed")));
      assert.equal(api.canLeaveRecordEntry("src-oed"), false, "the list behind changed");
      api.syncRecordUrl("");
      assert.deepEqual(calls.at(-1), ["replace", "#browse?q=other"]);
      assert.ok(!("catlogRecordFrom" in window.history.state), "the entry now shows the list");
      // A record the address already names (opened from a link or a reload) adds no entry.
      calls.length = 0;
      window.location.href = "https://example.test/catlog/#record=src-v2";
      window.location.hash = "#record=src-v2";
      api.applyBrowseParams(new Map());
      api.syncRecordUrl("src-v2");
      assert.deepEqual(calls, []);
      // Leaving an open record by a link, a tab or × keeps its place in its entry, so Back or Forward opens it there;
      // only for that record, and a new entry, another record or the list does not carry it.
      const previousKey = api.state.selectedKey;
      api.state.selectedKey = "src-v2";
      document.body.classList.add("detail-open");
      element("detailPanel").scrollTop = 420.4;
      try {
        window.history.state = { catlogView: "browse" };
        api.rememberRecordScroll();
        assert.deepEqual(calls.at(-1), ["replace", "#record=src-v2"], "the same address");
        assert.equal(JSON.stringify(window.history.state), '{"catlogView":"browse","catlogRecordScroll":{"key":"src-v2","top":420}}');
        assert.equal(JSON.stringify(api.rememberedRecordScroll("src-v2")), '{"key":"src-v2","top":420}');
        assert.equal(api.rememberedRecordScroll("src-oed"), null, "another record opens at its top");
        window.history.state = { catlogRecordScroll: { key: "src-v2", top: 0 } };
        assert.equal(api.rememberedRecordScroll("src-v2"), null, "at its top: nothing to restore");
        // A record the address does not name (its entry was left already): nothing is written.
        calls.length = 0;
        window.location.href = "https://example.test/catlog/#browse?q=src";
        window.location.hash = "#browse?q=src";
        api.rememberRecordScroll();
        assert.deepEqual(calls, []);
        // A new record entry, another record in the entry and the list's address all drop the place.
        api.applyBrowseParams(new Map(new URLSearchParams("q=src")));
        window.history.state = { catlogView: "browse", catlogRecordScroll: { key: "src-v2", top: 420 } };
        api.syncRecordUrl("src-v2");
        assert.deepEqual(calls.at(-1), ["push", "#browse?q=src&record=src-v2"]);
        assert.ok(!("catlogRecordScroll" in window.history.state), "a new entry starts at the record's top");
        window.history.state = { ...window.history.state, catlogRecordScroll: { key: "src-v2", top: 420 } };
        api.syncRecordUrl("src-oed");
        assert.deepEqual(calls.at(-1), ["replace", "#browse?q=src&record=src-oed"]);
        assert.ok(!("catlogRecordScroll" in window.history.state));
        window.history.state = { ...window.history.state, catlogRecordScroll: { key: "src-oed", top: 420 } };
        api.syncRecordUrl("");
        assert.deepEqual(calls.at(-1), ["replace", "#browse?q=src"]);
        assert.equal(JSON.stringify(Object.keys(window.history.state)), '["catlogView"]');
      } finally {
        api.state.selectedKey = previousKey;
        document.body.classList.remove("detail-open");
        element("detailPanel").scrollTop = 0;
      }
    } finally {
      window.history.pushState = original.push;
      window.history.replaceState = original.replace;
      delete window.history.back;
      delete window.history.state;
      window.location.href = original.href;
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
  // The options' bits: corrects 1, differs 2, other_label 4, not_listed 8, all_not_listed 16, all_same 32, earlier 64. The
  // same number under another label has its own option and is not All values the same.
  const bit = Object.fromEntries(api.databaseFilters.map((item) => [item.value, item.bit]));
  assert.deepEqual(bit, { corrects: 1, differs: 2, other_label: 4, not_listed: 8, all_not_listed: 16, all_same: 32, earlier: 64 });
  assert.deepEqual(dbRows.map((item) => api.rowDatabaseBits(item)), [32, 1, 2 | 8, 8 | 16, 4, 64, 0]);
  assert.deepEqual(dbRows.map((item) => api.databaseSummaryBits(item)), [1, 3, 12, 8, 16, 32, 0]);
  api.indexLoadedRecords(dbRows);
  counts = await countsFor("db=corrected,new");
  assert.equal(databaseInputs.filter((input) => input.checked).length, 0, "db= is read only when the index carries the comparison");
  runtimeManifest.viewer_index.optional_fields = ["database_summary"];
  // Earlier addresses keep working: corrected is corrects, new (no database lists any value) is "every value", which
  // brings Not in the databases with it; the two are one filter, the records no database lists any value of.
  counts = await countsFor("db=corrected,new");
  assert.deepEqual({ ...counts.database }, { corrects: 1, differs: 1, other_label: 1, not_listed: 2, all_not_listed: 1, all_same: 1, earlier: 1 });
  assert.deepEqual(databaseInputs.filter((input) => input.checked).map((input) => input.value), ["corrects", "not_listed", "all_not_listed"],
    "db= takes the aliases, and a nested option its parent");
  assert.equal(api.browseHash(), "#browse?db=corrects,not_listed,all_not_listed");
  assert.deepEqual(api.state.filtered.map((item) => item.record_key).sort(), ["db-fixed", "db-new"]);
  assert.deepEqual(JSON.parse(JSON.stringify(api.activeFilterItems().map((item) => [item.key, item.label]))),
    [["db:corrects", "Corrects a value"], ["db:all_not_listed", "Not in the databases: every value"]]);
  // Its chip removes both.
  api.activeFilterItems().find((item) => item.key === "db:all_not_listed").clear();
  assert.deepEqual(databaseInputs.filter((input) => input.checked).map((input) => input.value), ["corrects"]);
  // adds (a value no database lists) is Not in the databases, same is All values the same, and each option finds its own.
  for (const [address, ticked, keys] of [
    ["db=adds", ["not_listed"], ["db-new", "db-open"]],
    ["db=same", ["all_same"], ["db-same"]],
    ["db=other_label", ["other_label"], ["db-label"]],
    ["db=same_number_other_label,differs", ["differs", "other_label"], ["db-label", "db-open"]],
    ["db=not_listed,all_not_listed", ["not_listed", "all_not_listed"], ["db-new"]],
    ["db=every_value", ["not_listed", "all_not_listed"], ["db-new"]],
    ["db=all_same,earlier", ["all_same", "earlier"], ["db-earlier", "db-same"]],
  ]) {
    await countsFor(address);
    assert.deepEqual(databaseInputs.filter((input) => input.checked).map((input) => input.value), ticked, address);
    assert.deepEqual(api.state.filtered.map((item) => item.record_key).sort(), keys, address);
  }
  assert.equal(api.databaseFilterBits(["not_listed", "all_not_listed", "corrects"]), bit.corrects | bit.all_not_listed);
  assert.equal(api.databaseFilterBits(["not_listed", "differs"]), bit.not_listed | bit.differs);
  // One name per result: the sidebar's options say what their chips, a record's result words and its links say; each
  // result has its square in the result's colour (none on Corrected earlier, which sits under a rule), "every value" is
  // nested under Not in the databases and read with it.
  {
    const rows = [...element("databaseChecklist").innerHTML.matchAll(/<label class="check-row([^"]*)" title="([^"]*)">([\s\S]*?)<\/label>/g)];
    const shown = rows.map((match) => match[3].match(/<span>([\s\S]*?)<\/span>\s*<strong/)[1]);
    assert.deepEqual(shown.map((html) => html.replace(/<span class="visually-hidden">[^<]*<\/span>/g, "").replace(/<[^>]*>/g, "")),
      ["Corrects a value", "Different number", "Same, other label", "Not in the databases", "every value", "All values the same", "Corrected earlier"]);
    assert.deepEqual(shown.map((html) => html.replace(/<[^>]*aria-hidden[^>]*><\/span>/g, "").replace(/<[^>]*>/g, "")).slice(4, 5),
      ["Not in the databases: every value"]);
    assert.deepEqual(shown.map((html) => (html.match(/class="db-mark db-mark-([a-z-]+)" aria-hidden="true"/) || [])[1] || ""),
      ["corrects", "differs", "other-label", "not-listed", "not-listed", "same", ""]);
    assert.deepEqual(rows.map((match) => match[1].trim()), ["", "", "", "", "nested", "", "after-divider"]);
    assert.deepEqual(rows.map((match) => match[2]), [...api.databaseFilters].map((item) => item.title.replace(/'/g, "&#39;")));
  }
  // The "?" names the databases compared, from the manifest (here none listed or counted: the six fallback names).
  assert.match(element("aboutDatabases").innerHTML, /with the numbers <span class="nowrap">BRENDA<\/span>, <span class="nowrap">SABIO-RK<\/span>, <span class="nowrap">OED<\/span>, <span class="nowrap">SKiD<\/span>, <span class="nowrap">STRENDA DB<\/span> and <span class="nowrap">UniProt<\/span> list for the same paper/, "each name kept whole on one line");
  assert.match(element("aboutDatabases").innerHTML, /<strong>Every value<\/strong> \(under Not in the databases\): No compared database lists any value of the record\./);
  assert.doesNotMatch(element("aboutDatabases").innerHTML, /\.\./);
  // How values are paired, in words the options below do not contradict (Same, other label: another substrate, variant
  // or organism).
  assert.match(element("aboutDatabases").innerHTML, /list for the same paper,\s+pairing values by substrate, variant and organism\.<\/p>/);
  // The caveat once, under Different number only.
  assert.equal((element("aboutDatabases").innerHTML.match(/does not by itself mean a database is wrong/g) || []).length, 1);
  assert.match(element("aboutDatabases").innerHTML, /<strong>Different number<\/strong>: [^<]*it does not by itself mean a database is wrong\.<\/p>/);
  assert.doesNotMatch(element("aboutDatabases").innerHTML, /\(same substrate/);
  // Counts on the test snapshot (bundle-20261013-135809's record index, 174,246 records: how many records carry each
  // database_summary number) equal the manifest's keys: records_with_kind for the first four, records.every_value_new and
  // records.every_value_confirmed; Corrected earlier equals the index builder's count of records with earlier changes.
  {
    const summaries = { 1: 36121, 2: 128, 3: 1059, 4: 124, 5: 630, 6: 2, 7: 29, 8: 6283, 9: 6364, 10: 46, 11: 163, 12: 50,
      13: 89, 14: 4, 16: 1824, 17: 609, 18: 5, 19: 2, 20: 10, 21: 13, 24: 822, 25: 172, 26: 5, 28: 4, 32: 2881, null: 116807 };
    const comparison = {
      records: { every_value_new: 6283, any_value_new: 14002, every_value_confirmed: 36121, corrects_a_database_value: 1443, differs_not_yet_resolved: 955 },
      records_with_kind: { same: 45251, corrected: 1443, differs: 955, other_label: 3466, new: 14002 },
      values: { all: { new_paper_not_in_databases: 1382, confirmed: 97791, not_compared: 5946, differs: 1051, new: 14732,
        same_number_other_label: 5574, corrected: 1548, new_ratio_only: 4873 } },
    };
    assert.equal(Object.values(summaries).reduce((total, count) => total + count, 0), 174246);
    const optionCounts = Object.fromEntries(api.databaseFilters.map((item) => [item.value, 0]));
    for (const [summary, count] of Object.entries(summaries)) {
      const bits = api.rowDatabaseBits({ database_summary: summary === "null" ? null : Number(summary) });
      api.databaseFilters.forEach((item) => { if (bits & item.bit) optionCounts[item.value] += count; });
    }
    assert.deepEqual(optionCounts, {
      corrects: comparison.records_with_kind.corrected, differs: comparison.records_with_kind.differs,
      other_label: comparison.records_with_kind.other_label, not_listed: comparison.records_with_kind.new,
      all_not_listed: comparison.records.every_value_new, all_same: comparison.records.every_value_confirmed, earlier: 2881,
    });
    // Each option's title adds the manifest's counts where it has both values and records.
    const previousSummary = runtimeManifest.summary;
    runtimeManifest.summary = { ...(previousSummary || {}), database_comparison: comparison };
    try {
      const titles = Object.fromEntries(api.databaseFilters.map((item) => [item.value, api.databaseOptionTitle(item)]));
      assert.ok(titles.corrects.endsWith("how it was found. 1,548 values in 1,443 records."), titles.corrects);
      assert.ok(titles.differs.endsWith(" 1,051 values in 955 records."), titles.differs);
      assert.ok(titles.other_label.endsWith(" 5,574 values in 3,466 records."), titles.other_label);
      assert.ok(titles.not_listed.endsWith(" 20,987 values in 14,002 records."), titles.not_listed);
      assert.equal(titles.all_not_listed, "No compared database lists any value of the record.");
      assert.equal(titles.all_same, "Every compared value is the number a database lists for it.");
      assert.ok(titles.earlier.startsWith("Not yet re-read: ") && titles.earlier.endsWith("before and after."), titles.earlier);
      runtimeManifest.summary.database_comparison = { records_with_kind: { corrected: 1 }, values: { all: { corrected: 1 } } };
      assert.ok(api.databaseOptionTitle(api.databaseFilters[0]).endsWith(" 1 value in 1 record."));
      runtimeManifest.summary.database_comparison = { records_with_kind: { corrected: 2 }, values: { all: { corrected: "2" } } };
      assert.equal(api.databaseOptionTitle(api.databaseFilters[0]), api.databaseFilters[0].title, "a count that is not a number is left out");
      // The databases compared come from the manifest: its sources list (a sixth database joins there), else the
      // databases values_by_database counts, else six.
      runtimeManifest.summary.database_comparison = { values_by_database: { BRENDA: {}, "SABIO-RK": {}, OED: {}, SKiD: {}, STRENDA: {} } };
      assert.deepEqual(JSON.parse(JSON.stringify(api.comparedDatabases())), [
        { key: "brenda", name: "BRENDA", display: "BRENDA" }, { key: "sabio_rk", name: "SABIO-RK", display: "SABIO-RK" },
        { key: "oed", name: "OED", display: "OED" }, { key: "skid", name: "SKiD", display: "SKiD" },
        { key: "strenda", name: "STRENDA", display: "STRENDA DB" }]);
      runtimeManifest.summary.database_comparison = { sources: [{ key: "brenda", name: "BRENDA" }, { key: "strenda", name: "STRENDA", display: "STRENDA DB" },
        { key: "uniprot", name: "UniProt", display: "UniProt" }, null, { name: "" }, "OED"], values_by_database: { SKiD: {} } };
      assert.deepEqual([...api.comparedDatabases()].map((item) => `${item.key}:${item.display}`), ["brenda:BRENDA", "strenda:STRENDA DB", "uniprot:UniProt", "oed:OED"]);
      delete runtimeManifest.summary.database_comparison;
      assert.deepEqual([...api.comparedDatabases()].map((item) => item.display), ["BRENDA", "SABIO-RK", "OED", "SKiD", "STRENDA DB", "UniProt"]);
    } finally {
      if (previousSummary === undefined) delete runtimeManifest.summary;
      else runtimeManifest.summary = previousSummary;
    }
  }
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
  // The source as This page (JSON) and Download record name it: CatLog (read from the paper) for a record read from the
  // paper by CatLog; the databases by name otherwise.
  assert.match(lines[2], /,Accepted,[^,]*,CatLog \(read from the paper\),primary_paper_direct,/);
  const sourceLines = (await api.csvParts([row({ record_key: "csv-oed", source_db: "oed" }), row({ record_key: "csv-merged", source_db: "sabio_rk;brenda" }),
    row({ record_key: "csv-mixed", source_db: "mixed" })])).join("").split("\r\n").slice(1, -1);
  assert.deepEqual(sourceLines.map((line) => line.match(/,(Open Enzyme Database \(OED\)|"BRENDA, SABIO-RK"|Not recorded),(?:oed|sabio_rk;brenda|mixed),/)?.[1]),
    ["Open Enzyme Database (OED)", '"BRENDA, SABIO-RK"', "Not recorded"], sourceLines.join("\n"));
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

// The record's ‹ and › open the record before or after it in the results, turning the table's page when it is on another
// one, and keep the focus on the button pressed (on the other one at either end); both are disabled when the results do
// not hold the open record.
{
  const keys = ["step-a", "step-b", "step-c"];
  const stepRows = keys.map((key) => {
    const shard = `data/details-${key}.js`;
    window.CATLOG_DETAIL_SHARDS[shard] = { [key]: { ui_record_key: key } };
    window.CATLOG_DETAIL_SHARD_GENERATIONS[shard] = runtimeSourceSha256;
    api.state.loadedScripts.add(shard);
    return row({ record_key: key, detail_shard: shard });
  });
  const previousPageSize = api.state.pageSize;
  const previousButton = element("previousRecordButton");
  const nextButton = element("nextRecordButton");
  try {
    api.state.records = api.state.filtered = stepRows;
    api.state.pageSize = 2;
    api.state.page = 1;
    await api.selectRecord("step-a");
    assert.equal(previousButton.disabled, true, "the first record has no previous one");
    assert.equal(nextButton.disabled, false);
    assert.match(element("detailContent").innerHTML, /<div class="detail-title-buttons">\s*<button id="previousRecordButton" class="icon-button record-step" type="button" aria-label="Previous record"[^>]*>&lsaquo;<\/button>\s*<button id="nextRecordButton" class="icon-button record-step" type="button" aria-label="Next record"[^>]*>&rsaquo;<\/button>\s*<button id="closeDetailButton"/);
    nextButton.focus();
    await api.stepRecord(1);
    assert.equal(api.state.selectedKey, "step-b");
    assert.equal(api.state.page, 1);
    assert.equal(document.activeElement, nextButton, "the focus stays on Next");
    assert.deepEqual([previousButton.disabled, nextButton.disabled], [false, false]);
    await api.stepRecord(1);
    assert.equal(api.state.selectedKey, "step-c");
    assert.equal(api.state.page, 2, "the table turns to the page that shows the record");
    assert.equal(nextButton.disabled, true, "the last record has no next one");
    assert.equal(document.activeElement, previousButton, "at the end the focus goes to Previous");
    await api.stepRecord(1);
    assert.equal(api.state.selectedKey, "step-c", "nothing after the last record");
    await api.stepRecord(-1);
    assert.equal(api.state.selectedKey, "step-b");
    assert.equal(api.state.page, 1);
    // Results that no longer hold the open record (new filters): neither button opens anything.
    api.state.filtered = [stepRows[0]];
    api.renderRows();
    assert.deepEqual([previousButton.disabled, nextButton.disabled], [true, true]);
    assert.deepEqual(JSON.parse(JSON.stringify(api.recordStepTargets())), { position: -1, previous: null, next: null });
  } finally {
    api.state.pageSize = previousPageSize;
    api.state.page = 1;
    api.state.selectedKey = "";
    document.body.classList.remove("detail-open");
  }
}

// A search typed while the record index still downloads (some records in, none matching yet) keeps the skeleton rows
// with a line saying why, never a blank list; with no record in yet, the skeleton alone.
{
  const previous = { records: api.state.records, filtered: api.state.filtered, recordsReady: api.state.recordsReady };
  try {
    api.state.records = [row({ record_key: "early" })];
    api.state.filtered = [];
    api.state.recordsReady = false;
    api.renderRows();
    assert.match(element("recordsBody").innerHTML, /^(?:<tr class="skeleton-row" aria-hidden="true">[\s\S]*?<\/tr>){10}<tr class="loading-row notice-row"><td colspan="\d+"><div class="load-notice" role="status"><strong>Still loading the records<\/strong><span>The search runs on every record once they are all in\.<\/span><\/div><\/td><\/tr>$/);
    api.state.records = [];
    api.renderRows();
    assert.match(element("recordsBody").innerHTML, /skeleton-row/);
    assert.doesNotMatch(element("recordsBody").innerHTML, /loading-row/);
  } finally {
    Object.assign(api.state, previous);
    api.renderRows();
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

// × on a record whose row the page does not show (another page of the results, after its paper's link): focus goes to
// the results, the table's current row or the table itself, never the page body. Closed while new filters' results are on
// their way (Back to other filters), focus goes to the record's row again once they are drawn; a record the new results
// close takes focus in it to the results.
{
  const previousQuery = document.querySelector;
  const detailPanel = element("detailPanel");
  const previousContains = detailPanel.contains;
  try {
    api.state.selectedKey = "elsewhere";
    document.activeElement = document.body;
    api.closeDetailAndRestoreFocus();
    assert.equal(document.activeElement, element("recordTableWrap"), "no row on the page: the table");
    document.querySelector = (selector) => (selector === '#recordsBody tr[tabindex="0"]' ? firstRowElement : previousQuery(selector));
    api.state.selectedKey = "elsewhere";
    document.activeElement = document.body;
    api.closeDetailAndRestoreFocus();
    assert.equal(document.activeElement, firstRowElement, "the page's current row");
    api.state.selectedKey = "second";
    api.closeDetailAndRestoreFocus({ resultsPending: true });
    assert.equal(document.activeElement, secondRowElement);
    assert.equal(api.state.refocusAfterFilters, "second");
    document.activeElement = document.body;
    assert.ok(await api.applyFilters());
    assert.equal(document.activeElement, secondRowElement, "the new results' row of the closed record");
    assert.equal(api.state.refocusAfterFilters, null);
    document.activeElement = element("globalSearchInput");
    api.state.refocusAfterFilters = "second";
    await api.applyFilters();
    assert.equal(document.activeElement, element("globalSearchInput"), "focus the visitor moved meanwhile stays");
    api.state.selectedKey = "not-in-results";
    detailPanel.contains = () => true;
    document.activeElement = element("detailHeading");
    await api.applyFilters();
    assert.equal(api.state.selectedKey, "");
    assert.equal(document.activeElement, firstRowElement, "the record closed by the results: focus to the results");
  } finally {
    document.querySelector = previousQuery;
    detailPanel.contains = previousContains;
    api.state.selectedKey = "";
    api.state.refocusAfterFilters = null;
    document.activeElement = document.body;
  }
}

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

function referenceNameSort(a, b) {
  if (!a || !b) return (a ? 0 : 1) - (b ? 0 : 1);
  const fold = (text) => text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  const [left, right] = [fold(a), fold(b)];
  return left < right ? -1 : left > right ? 1 : 0;
}

function referencePaper(row) {
  const first = Array.isArray(row._pmids) ? row._pmids[0] : row._pmids;
  return typeof first === "number" ? first : Number.MAX_SAFE_INTEGER;
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
    // The default order: review result, tier, then the enzyme's name (A-Z folded to a-z, then by code unit, unnamed
    // last) and the paper (first PMID, none last); the load order breaks the rest.
    evidence: (a, b) => (
      (a._stateRank - b._stateRank)
      || (a._tierRank - b._tierRank)
      || referenceNameSort(a._sortEnzyme, b._sortEnzyme)
      || (referencePaper(a) - referencePaper(b))
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

// The A to Z sorts skip a name's leading quotes and brackets; a name of marks only keeps them.
api.indexLoadedRecords([
  row({ record_key: "quoted", organism: '"Chelatobacter" strain ATCC 29600', enzyme_display_name: "(S)-Lactate oxidase", substrate_name: "'Xylose'" }),
  row({ record_key: "bracketed", organism: "[Bacillus] caldolyticus", enzyme_display_name: "Alcohol dehydrogenase", substrate_name: "[3H]Water" }),
  row({ record_key: "plain-a", organism: "Azotobacter vinelandii", enzyme_display_name: "Malate dehydrogenase", substrate_name: "ATP" }),
  row({ record_key: "plain-d", organism: "Danio rerio", enzyme_display_name: "Tyrosinase", substrate_name: "D-Glucose" }),
  row({ record_key: "marks", organism: "-", enzyme_display_name: "-", substrate_name: "-" }),
]);
assert.deepEqual(Array.from(await api.orderedRecordsFor("organism"), (item) => item.record_key),
  ["marks", "plain-a", "bracketed", "quoted", "plain-d"], "organism sorts skip leading quotes and brackets");
assert.deepEqual(Array.from(await api.orderedRecordsFor("enzyme"), (item) => item.record_key),
  ["marks", "bracketed", "plain-a", "quoted", "plain-d"], "enzyme sorts skip a leading bracket");
assert.deepEqual(Array.from(await api.orderedRecordsFor("substrate"), (item) => item.record_key),
  ["marks", "bracketed", "plain-a", "plain-d", "quoted"], "substrate sorts skip leading quotes and brackets");

// The default order (the one the index is built in, 2026-10-15): accepted first, then the enzyme's name A to Z with A-Z
// folded to a-z and the rest by code unit (digits before letters, leading marks skipped), a nameless record last; within
// one name the paper's first PMID (none last), so a paper's records of one enzyme stand together; then the load order.
api.indexLoadedRecords([
  row({ record_key: "unnamed", verification_status: "verified", enzyme_display_name: "", _pmids: 1 }),
  row({ record_key: "lipase-paper2", verification_status: "verified", enzyme_display_name: "lipase", _pmids: 200 }),
  row({ record_key: "Lipase-paper1", verification_status: "verified", enzyme_display_name: "Lipase", _pmids: 100 }),
  row({ record_key: "quoted", verification_status: "verified", enzyme_display_name: '"Chelatobacter" amidase', _pmids: 5 }),
  row({ record_key: "digit", verification_status: "verified", enzyme_display_name: "1,3-glucanase", _pmids: 7 }),
  row({ record_key: "lipase-paper1-again", verification_status: "verified", enzyme_display_name: "lipase", _pmids: [100, 300] }),
  row({ record_key: "lipase-no-paper", verification_status: "verified", enzyme_display_name: "lipase", _pmids: null }),
  row({ record_key: "unverified-a", verification_status: "unverified", enzyme_display_name: "aldolase", _pmids: 1 }),
]);
assert.deepEqual(Array.from(await api.orderedRecordsFor("evidence"), (item) => item.record_key),
  ["digit", "quoted", "Lipase-paper1", "lipase-paper1-again", "lipase-paper2", "lipase-no-paper", "unnamed", "unverified-a"],
  "the default order: review result, enzyme name, paper, load order");

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
  // Before the records load, the Source choices count from the same snapshot figure as the counts band (the databases
  // the rest), so the group is complete at first paint; once loaded they count the records.
  const ready = api.state.recordsReady;
  api.state.recordsReady = false;
  assert.deepEqual(["source:all", "source:paper", "source:databases", "source:brenda"].map((key) => api.filterCountValue(key, null)), [100, 74, 26, null]);
  runtimeManifest.summary.overview = { ...runtimeManifest.summary.overview, records: 99 };
  assert.deepEqual(["source:paper", "source:databases"].map((key) => api.filterCountValue(key, null)), [null, null],
    "an overview counted from other records is not used");
  api.state.recordsReady = ready;
  runtimeManifest.summary = {};
  assert.deepEqual(api.sourceAttributionRows([paperSource]).map((item) => item.name), ["Read from the paper (by CatLog, or earlier extractions)"],
    "without the snapshot's count, one row names both groups");
  Object.assign(runtimeManifest, { total_rows: saved.total, summary: saved.summary, enriched_download: saved.enriched, source_sha256: saved.source });
}

// The sidebar keeps one short line per option; the explanations are behind each group's "?" (aboutSource, aboutStatus).
{
  const source = element("sourceChecklist").innerHTML;
  // Each record by what happened to it (the user, 2026-10-13, round 8): Read from the paper and Not yet re-read, one line
  // each beside its count; CatLog is the one name, never v1 or v2.
  assert.match(source, /<label class="check-row radio-row" title="Read from the paper by an AI model; a second, separate AI check compared each value with the paper\.">\s*<input type="radio" name="sourceMode" value="paper" \/>\s*<span>Read from the paper<\/span>\s*<strong data-count="source:paper">/);
  assert.match(source, /value="databases" \/>\s*<span>Not yet re-read<\/span>\s*<strong data-count="source:databases">/);
  assert.doesNotMatch(source + element("aboutSource").innerHTML, /\bv[12]\b|source-mode-what/);
  assert.match(source, /value="all" checked \/>\s*<span>All records<\/span>\s*<strong/);
  assert.doesNotMatch(source, /source-help|aria-describedby|<p class="filter-note/);
  // The longest names are short in the sidebar (one line at 256px): OED as the table's tag, its name read out and on hover;
  // the caution without "Possible", which its chip and the Guide keep.
  assert.match(source, /<label class="check-row" title="Open Enzyme Database \(OED\)">\s*<input type="checkbox" name="source" value="oed" \/>\s*<span>OED<span class="visually-hidden"> \(Open Enzyme Database\)<\/span><\/span>/);
  assert.match(source, /value="earlier_paper" \/>\s*<span>Earlier<span class="visually-hidden"> paper<\/span> extractions<\/span>/,
    "Earlier paper extractions shows as the table's tag, its name read out in full");
  // Earlier extractions are CatLog's too, from its earlier version (one CatLog, round 8): never "not by CatLog".
  assert.match(source, /<label class="check-row" title="Read from a paper by CatLog&#39;s earlier version, an automated pipeline of AI models and code checks\.">\s*<input type="checkbox" name="source" value="earlier_paper"/);
  assert.doesNotMatch(source, /not by CatLog/);
  assert.match(element("cautionChecklist").innerHTML, /value="units" \/>\s*<span>Unit or magnitude error<\/span>/);
  // What each label means: the earlier version is named only here, in the help (only part of its entries were checked
  // against their papers).
  assert.match(element("aboutSource").innerHTML, /<strong>Read from the paper<\/strong>: by an AI model; a second, separate AI check compared each value with the paper\./);
  assert.match(element("aboutSource").innerHTML, /<strong>Not yet re-read<\/strong>: from CatLog&#39;s earlier version, which started from enzyme database entries and checked part of them against their papers; when CatLog reads a paper, its records replace these\./);
  assert.match(source, /<label class="check-row radio-row" title="From CatLog&#39;s earlier version, which started from enzyme database entries and checked part of them/);
  assert.match(element("aboutSource").innerHTML, /href="#guide-method"/);
  const status = element("statusChecklist").innerHTML;
  assert.doesNotMatch(status, /status-guide|Review result definitions/);
  assert.match(status, /<span class="visually-hidden">Only <\/span><span class="human-checked-word">/);
  // The Review result "?" is a short line per result and for human-checked, then the Guide (the tags are defined there),
  // so the box never pushes the options out of view.
  const aboutStatus = element("aboutStatus").innerHTML;
  // "Accepted — passed review: ...": one dash, no double colon, the line in lower case after it.
  assert.match(aboutStatus, /<strong>Accepted<\/strong> — passed review: read from the paper by CatLog/);
  assert.match(aboutStatus, /<strong>Not confirmed<\/strong> — the earlier automated review left a question open\./);
  assert.match(aboutStatus, /<strong>Not checked<\/strong> — no review result\./);
  assert.match(aboutStatus, /<strong>Disputed<\/strong> — a check found a problem; not accepted\./);
  assert.match(aboutStatus, /<strong>human-checked<\/strong> — a human reviewer approved every kcat and Km shown/);
  assert.doesNotMatch(aboutStatus, /<\/strong>: /, "no result reads 'Accepted: Passed review:'");
  assert.match(aboutStatus, /<strong>human-checked<\/strong> — a human reviewer approved every kcat and Km shown; the kcat\/Km was approved too or agrees with kcat ÷ Km\./);
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
