import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DecompressionStream, ReadableStream } from "node:stream/web";
import { TextDecoder } from "node:util";
import vm from "node:vm";
import { gzipSync } from "node:zlib";

const viewerSource = await readFile(
  new URL("../tools/catlog-static/assets/catlog-static.js", import.meta.url),
  "utf8",
);
const testModeStart = viewerSource.lastIndexOf("\n  if (window.CATLOG_STATIC_TEST_MODE) {");
assert.ok(testModeStart > 0, "viewer should expose its test-mode boundary");

async function runRetryCase(route, failure, { pendingSort = false } = {}) {
  const elements = new Map();
  const requests = [];
  const delays = [];
  const navigations = [];
  const progress = [];
  const classList = () => {
    const values = new Set();
    return {
      add: (...names) => names.forEach((name) => values.add(name)),
      remove: (...names) => names.forEach((name) => values.delete(name)),
      contains: (name) => values.has(name),
      toggle(name, enabled) {
        if (enabled) values.add(name);
        else values.delete(name);
      },
    };
  };
  const element = () => ({
    disabled: false,
    textContent: "",
    classList: classList(),
    style: { setProperty() {} },
    setAttribute() {},
    addEventListener(type, callback, options) {
      assert.equal(type, "click");
      assert.equal(options.once, true);
      this.callback = callback;
    },
    click() {
      if (this.disabled || !this.callback) return;
      const callback = this.callback;
      this.callback = null;
      callback();
    },
  });
  const body = element();
  Object.defineProperty(body, "innerHTML", {
    set(html) {
      this.html = html;
      elements.delete("loadNoticeAction");
      if (html.includes('id="loadNoticeAction"')) {
        elements.set("loadNoticeAction", element());
      }
    },
  });
  elements.set("recordsBody", body);
  for (const id of [
    "activeSummary",
    "pageSummary",
    "pageLabel",
    "prevButton",
    "nextButton",
    "downloadPageButton",
    "catalogLoadProgress",
  ]) {
    elements.set(id, element());
  }
  for (const id of [
    "globalSearchInput",
    "ecFilterInput",
    "enzymeFilterInput",
    "organismFilterInput",
    "substrateFilterInput",
    "sortSelect",
  ]) {
    const input = element();
    input.value = id === "sortSelect" ? "evidence" : "";
    elements.set(id, input);
  }
  const checkedRecordStates = ["accepted", "curation_pending", "not_verified"]
    .map((value) => ({ value }));

  const document = {
    body: { classList: classList() },
    hidden: false,
    currentScript: {
      src: "https://example.test/tools/catlog-static/assets/catlog-static.js",
      dataset: {},
    },
    baseURI: `https://example.test/${route}`,
    getElementById: (id) => elements.get(id),
    querySelectorAll: (selector) => (
      selector === 'input[name="recordState"]:checked' ? checkedRecordStates : []
    ),
  };
  const manifest = {
    total_rows: pendingSort ? 2 : 1,
    record_chunks: [],
    details_per_shard: 250,
    viewer_index: { path: "data/catlog-viewer.abcdef123456.jsonl.gz" },
    detail_shards: ["data/details-000.abcdef123456.jsonl.gz"],
  };
  let releaseOldSort;
  let oldSortYielded = false;
  const window = {
    CATLOG_STATIC_MANIFEST: manifest,
    DecompressionStream,
    matchMedia: () => ({ matches: false }),
    location: {
      href: document.baseURI,
      protocol: "https:",
      replace: (url) => navigations.push(url),
    },
    setTimeout(callback, delay) {
      delays.push(delay);
      queueMicrotask(callback);
    },
    scheduler: pendingSort ? {
      yield() {
        if (!oldSortYielded) {
          oldSortYielded = true;
          return new Promise((resolve) => { releaseOldSort = resolve; });
        }
        return Promise.resolve();
      },
    } : undefined,
  };
  let healthy = false;
  let synchronizeCount = 0;
  let rejectRender = !pendingSort;
  const fetch = async (url) => {
    requests.push(new URL(url));
    const state = window.loaderTest.state;
    const rail = elements.get("catalogLoadProgress");
    progress.push({
      ready: state.recordsReady,
      loaded: state.recordChunksLoaded,
      total: state.recordChunksTotal,
      unit: state.loadProgressUnit,
      stalled: rail.classList.contains("stalled"),
      complete: rail.classList.contains("complete"),
    });
    assert.equal(
      requests.at(-1).pathname,
      "/tools/catlog-static/data/catlog-viewer.abcdef123456.jsonl.gz",
    );
    if (!healthy && failure === "network") throw new Error("network unavailable");
    if (!healthy && failure === "http") return { ok: false, status: 503 };
    const healthyText = pendingSort
      ? '{"record_key":"new-match","verification_status":"verified","_search_text":"needle"}\n'
        + '{"record_key":"new-other","verification_status":"verified","_search_text":"other"}\n'
      : '{"record_key":"fixture"}\n';
    const text = !healthy && failure === "count"
      ? ""
      : !healthy && failure === "json"
        ? "{broken json\n"
        : healthyText;
    return {
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(gzipSync(text));
          controller.close();
        },
      }),
    };
  };
  const context = vm.createContext({
    window,
    document,
    URL,
    console,
    fetch,
    DecompressionStream,
    TextDecoder,
  });
  const filterOverrides = pendingSort ? `
    setupFilters = () => {};
    renderActiveFilterCount = () => {};
    renderSummary = () => {};
    renderRows = () => window.renderRows();
  ` : `
    setupFilters = () => {};
    ensureCurrentFilters = async () => window.renderRows();
  `;
  vm.runInContext(`${viewerSource.slice(0, testModeStart)}
    ${filterOverrides}
    updateTableScrollControls = () => {};
    syncDetailPanelAccessibility = () => window.synchronize();
    window.loaderTest = {state, loadRecordChunks, indexLoadedRecords, orderedRecordsFor};
  })();`, context);
  window.synchronize = () => { synchronizeCount += 1; };
  window.renderRows = () => {
    if (rejectRender) {
      rejectRender = false;
      throw new Error("render interrupted");
    }
    document.body.classList.remove("catalog-load-failed");
  };

  const { state, loadRecordChunks, indexLoadedRecords, orderedRecordsFor } = window.loaderTest;
  let oldSort;
  if (pendingSort) {
    indexLoadedRecords([
      { record_key: "old-a", verification_status: "verified", _search_text: "old" },
      { record_key: "old-b", verification_status: "verified", _search_text: "old" },
    ]);
    oldSort = orderedRecordsFor("evidence");
    for (let attempt = 0; attempt < 20 && !oldSortYielded; attempt += 1) {
      await Promise.resolve();
    }
    assert.equal(oldSortYielded, true, "the prior generation sort should still be pending");
  }
  await loadRecordChunks();
  assert.equal(requests.length, 4);
  assert.deepEqual(delays, [2000, 5000, 10000]);
  assert.equal(state.recordsReady, false);
  if (failure === "http") {
    assert.match(elements.get("pageSummary").textContent, /HTTP 503/);
  }
  const settle = async (predicate) => {
    for (let attempt = 0; attempt < 200 && !predicate(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert.ok(predicate(), "retry did not settle");
  };

  const first = elements.get("loadNoticeAction");
  assert.ok(first);
  state.recordChunksLoaded = 5;
  elements.get("catalogLoadProgress").classList.add("complete");
  if (pendingSort) {
    elements.get("globalSearchInput").value = "needle";
    healthy = true;
  }
  first.click();
  first.click();
  assert.equal(first.disabled, true);
  assert.deepEqual(navigations, [], "manual retry must not reload the page");
  assert.deepEqual(
    progress[4],
    {
      ready: false,
      loaded: 0,
      total: pendingSort ? 2 : 1,
      unit: "records",
      stalled: false,
      complete: false,
    },
    "manual retry must reset progress before fetching",
  );
  if (pendingSort) {
    await settle(() => state.recordsReady && state.filtered.length === 1);
    assert.equal(state.recordsGeneration, 2);
    assert.equal(elements.get("globalSearchInput").value, "needle");
    assert.deepEqual(Array.from(state.filtered, (row) => row.record_key), ["new-match"]);
    assert.equal(state.sortCache.get("evidence")?.recordsGeneration, state.recordsGeneration);
    releaseOldSort();
    assert.equal(await oldSort, null, "the superseded generation must not publish its ordering");
    assert.deepEqual(navigations, []);
    return;
  }
  await settle(() => elements.has("loadNoticeAction") && elements.get("loadNoticeAction") !== first);
  assert.equal(requests.length, 8, "a second click must not launch a competing loader");
  assert.deepEqual(delays, [2000, 5000, 10000, 2000, 5000, 10000]);
  assert.deepEqual(
    requests.map((url) => url.searchParams.get("retry")),
    [null, "1", "2", "3", null, "1", "2", "3"],
  );

  const second = elements.get("loadNoticeAction");
  assert.equal(second.disabled, false, "another failed cycle must offer a usable retry");
  healthy = true;
  second.click();
  second.click();
  await settle(() => elements.has("loadNoticeAction") && elements.get("loadNoticeAction") !== second);
  assert.equal(requests.length, 9);
  assert.match(elements.get("pageSummary").textContent, /render interrupted/);
  assert.equal(state.recordsReady, false);
  assert.equal(state.recordChunksLoaded, 0);
  assert.equal(elements.get("catalogLoadProgress").classList.contains("stalled"), true);
  assert.equal(elements.get("catalogLoadProgress").classList.contains("complete"), false);

  const third = elements.get("loadNoticeAction");
  assert.equal(third.disabled, false, "unexpected rejection must restore a usable control");
  third.click();
  third.click();
  await settle(() => state.recordsReady && synchronizeCount > 0);
  assert.equal(requests.length, 10);
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].record_key, "fixture");
  assert.equal(state.recordChunksLoaded, 1);
  assert.equal(document.body.classList.contains("catalog-load-failed"), false);
  assert.equal(elements.get("catalogLoadProgress").classList.contains("stalled"), false);
  assert.deepEqual(navigations, []);
}

for (const route of ["tools/catlog-static/", "tools/catlog-latest.html"]) {
  for (const failure of ["http", "network", "count", "json"]) {
    await runRetryCase(route, failure);
  }
}
await runRetryCase("tools/catlog-static/", "http", { pendingSort: true });

// Schema 2: a header line, then one array per row (shared values by number, numbers read from their display text).
async function runSchemaTwoCase() {
  const elements = new Map();
  const delays = [];
  const element = () => ({
    disabled: false,
    textContent: "",
    title: "",
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    style: { setProperty() {} },
    setAttribute() {},
  });
  for (const id of ["recordsBody", "activeSummary", "pageSummary", "pageLabel", "prevButton", "nextButton",
    "downloadPageButton", "catalogLoadProgress", "sortSelect"]) {
    elements.set(id, element());
  }
  const fields = [
    "record_key", "review_key", "enzyme_display_name", "ec_number", "organism", "substrate_name", "mutation_signature",
    "primary_uniprot_id", "protein_accession", "kcat_display", "km_display", "kcat_over_km_display", "kcat", "km",
    "kcat_over_km", "ph_display", "temperature_k", "source_record_count", "enzyme_label_source", "source_db",
    "verification_status", "evidence_confidence_tier", "sequence_variant_status", "kcat_over_km_origin",
    "public_trust_basis", "temperature_display", "condition_flags", "kcat_unit", "km_unit", "kcat_over_km_unit",
    "wild_type", "pmids", "dois", "s",
  ];
  const header = {
    kind: "catlog_viewer_index", schema_version: 2, row_count: 3, order: "default_review_status",
    details_per_shard: 2, fields,
    enums: {
      enzyme_label_source: ["explicit_enzyme_name", "ec_name_fallback"],
      source_db: ["primary_paper_direct", "brenda"],
      verification_status: ["verified", "manual_review_required", "unverified"],
      evidence_confidence_tier: ["paper_grounded", "literature_linked"],
      sequence_variant_status: ["canonical_wild_type_sequence"],
      kcat_over_km_origin: ["paper_reported", null],
      public_trust_basis: [null],
      temperature_display: ["25", "n/a"],
      condition_flags: [[], ["unit_not_recorded_km"]],
      kcat_unit: ["s^(-1)", null],
      km_unit: ["mM"],
      kcat_over_km_unit: ["s^(-1)*mM^(-1)", null],
      wild_type: [true, null],
    },
    texts: { organism: ["Homo sapiens"], kcat_over_km_display: ["Not reported"], kcat_display: ["Not reported"] },
    dois: ["10.1021/bi101056m"],
  };
  const rows = [
    ["k1", true, "laccase", "1.10.3.2", 0, "ABTS", "Unknown", "P11509", true, "12.5", "0.25", "50", true, true, 50.0001,
      7.5, 298.15, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 12514023, 0, 0],
    ["k2", "r2", "hexokinase", "2.7.1.1", "Escherichia coli", "glucose", "D10A", null, "Q99999", 0, "0.1", 0, null,
      true, null, 7, null, 3, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, [2936344, 7999766], null, 0],
    ["k3", true, "esterase", "3.1.1.1", 0, "pNPA", "Unknown", null, null, 0, "2", 0, null, true, null, null, null, 1,
      1, 1, 2, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, null, null, 1],
  ];
  const text = `${[header, ...rows].map((line) => JSON.stringify(line)).join("\n")}\n`;
  const manifest = {
    total_rows: 3,
    record_chunks: [],
    details_per_shard: 2,
    viewer_index: { path: "data/catlog-viewer-index.abcdef123456.jsonl.gz" },
    detail_shards: ["data/details-000.abcdef123456.jsonl.gz", "data/details-001.abcdef123456.jsonl.gz"],
  };
  const window = {
    CATLOG_STATIC_MANIFEST: manifest,
    DecompressionStream,
    matchMedia: () => ({ matches: false }),
    location: { href: "https://example.test/tools/catlog-static/", protocol: "https:", replace() {} },
    setTimeout(callback, delay) {
      delays.push(delay);
      queueMicrotask(callback);
    },
  };
  const document = {
    body: { classList: { add() {}, remove() {}, contains: () => false } },
    hidden: false,
    currentScript: { src: "https://example.test/tools/catlog-static/assets/catlog-static.js", dataset: {} },
    baseURI: "https://example.test/tools/catlog-static/",
    getElementById: (id) => elements.get(id),
    querySelectorAll: () => [],
  };
  const fetch = async () => ({
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(gzipSync(text));
        controller.close();
      },
    }),
  });
  const context = vm.createContext({ window, document, URL, console, fetch, DecompressionStream, TextDecoder });
  vm.runInContext(`${viewerSource.slice(0, testModeStart)}
    setupFilters = () => {};
    ensureCurrentFilters = async () => true;
    updateTableScrollControls = () => {};
    syncDetailPanelAccessibility = () => {};
    window.loaderTest = {state, loadRecordChunks, orderedRecordsFor, publicSummaryRecord, rowMatches, searchWords,
      foldSearch, compactSearch, parseBrowseParams, numberRange};
  })();`, context);
  const { state, loadRecordChunks, orderedRecordsFor, publicSummaryRecord, rowMatches, searchWords } = window.loaderTest;
  await loadRecordChunks();
  return { state, delays, elements, orderedRecordsFor, publicSummaryRecord, rowMatches, searchWords, helpers: window.loaderTest };
}

{
  const { state, delays, orderedRecordsFor, publicSummaryRecord, rowMatches, searchWords, helpers } = await runSchemaTwoCase();
  assert.equal(state.recordsReady, true);
  assert.deepEqual(delays, [], "a healthy schema-2 index needs no retry");
  assert.equal(state.indexOrder, "default_review_status");
  const [first, second, third] = state.records;
  // arrays come from the viewer's realm: compare their items
  const pick = (row, keys) => Object.fromEntries(keys.map((key) => [key, Array.isArray(row[key]) ? [...row[key]] : row[key]]));
  assert.deepEqual(pick(first, ["record_key", "measurement_key", "review_key", "organism", "protein_accession",
    "kcat", "km", "kcat_over_km", "kcat_over_km_display", "ph", "ph_display", "source_db", "verification_status",
    "public_trust_basis", "wild_type", "detail_shard"]), {
    record_key: "k1", measurement_key: "k1", review_key: "k1", organism: "Homo sapiens", protein_accession: "P11509",
    kcat: 12.5, km: 0.25, kcat_over_km: 50.0001, kcat_over_km_display: "50", ph: 7.5, ph_display: 7.5,
    source_db: "primary_paper_direct", verification_status: "verified", public_trust_basis: null, wild_type: true,
    detail_shard: "data/details-000.abcdef123456.jsonl.gz",
  });
  assert.deepEqual(pick(second, ["review_key", "organism", "primary_uniprot_id", "protein_accession", "kcat_display",
    "kcat", "km", "kcat_over_km_display", "kcat_over_km", "condition_flags", "kcat_unit", "detail_shard"]), {
    review_key: "r2", organism: "Escherichia coli", primary_uniprot_id: null, protein_accession: "Q99999",
    kcat_display: "Not reported", kcat: null, km: 0.1, kcat_over_km_display: "Not reported", kcat_over_km: null,
    condition_flags: ["unit_not_recorded_km"], kcat_unit: null, detail_shard: "data/details-000.abcdef123456.jsonl.gz",
  });
  assert.equal(third.detail_shard, "data/details-001.abcdef123456.jsonl.gz");
  assert.equal(third.verification_status, "unverified");
  assert.ok(Object.isFrozen(second.condition_flags), "shared values are frozen");
  assert.strictEqual(second.condition_flags, third.condition_flags, "rows share one value object");
  const exported = publicSummaryRecord(first);
  assert.equal(exported.measurement_key, "k1");
  assert.ok(!Object.keys(exported).some((key) => key.startsWith("_") || key === "detail_shard"),
    "downloads keep only public fields");
  assert.deepEqual(Array.from(await orderedRecordsFor("evidence"), (row) => row.record_key), ["k1", "k2", "k3"]);
  // A PMID or a DOI (in full or its beginning) finds its paper's records; the identifiers stay out of downloads.
  const found = (query) => Array.from(state.records.filter((row) => rowMatches(row, {
    q: query, qWords: searchWords(query), recordStates: ["accepted", "curation_pending", "not_verified"], metrics: [],
  })), (row) => row.record_key);
  assert.deepEqual(found("12514023"), ["k1"]);
  assert.deepEqual(found("pmid 7999766"), ["k2"]);
  assert.deepEqual(found("doi:10.1021/bi101056m"), ["k1"]);
  assert.deepEqual(found("https://doi.org/10.1021/bi1010"), ["k1"]);
  assert.deepEqual(found("hexokinase 2936344"), ["k2"]);
  assert.deepEqual(found("1.10.3.2"), ["k1"]);
  assert.ok(!("_pmids" in exported) && !("pmids" in exported) && !("dois" in exported));

  // Search edge cases: case, spaces, accents, word order, hyphens and spaces inside a name, common organism names, and
  // EC numbers written in every usual way; an EC class or subclass matches whole parts only.
  assert.deepEqual(found("  LACCASE "), ["k1"]);
  assert.deepEqual(found("lāccase"), ["k1"]);
  assert.deepEqual(found("coli hexokinase"), ["k2"]);
  assert.deepEqual(found("hexo-kinase"), ["k2"]);
  assert.deepEqual(found("hexo kinase e.coli"), ["k2"]);
  assert.deepEqual(found("human"), ["k1", "k3"]);
  for (const query of ["EC 2.7.1.1", "ec:2.7.1.1", "EC2.7.1.1", "E.C. 2.7", "2.7.1.-", "ec 2"]) {
    assert.deepEqual(found(query), ["k2"], query);
  }
  assert.deepEqual(found("1."), ["k1"], "a class typed with its dot is an EC class");
  assert.deepEqual(found("1.1"), [], "EC 1.1 is not EC 1.10");
  const { foldSearch, compactSearch, parseBrowseParams, numberRange } = helpers;
  const same = (a, b) => assert.equal(compactSearch(foldSearch(a)), compactSearch(foldSearch(b)), `${a} = ${b}`);
  same("β-Galactosidase", "beta galactosidase");
  same("α-amylase", "Alpha-Amylase");
  same("κ-casein", "kappa casein");
  same("µ-calpain", "micro-calpain");
  same("μ-calpain", "u-calpain");
  same("5′-AMP", "5'-AMP");
  same("4–nitrophenyl phosphate", "4-nitrophenyl phosphate");
  same("4 nitrophenyl", "4-nitrophenyl");
  same("∆1-pyrroline", "Δ1-pyrroline");
  same("Ñ-acétyl", "n-acetyl");
  // A locant or prefix typed as its own word belongs to the next word.
  const words = (query) => JSON.stringify(searchWords(query));
  assert.equal(words("4 nitrophenyl phosphate"), words("4-nitrophenyl phosphate"));
  assert.equal(words("beta galactosidase"), words("β-galactosidase"));
  assert.equal(words("2,4 dinitrophenol"), words("2,4-dinitrophenol"));
  assert.equal(words("D glucose"), words("D-glucose"));
  assert.equal(words("hexokinase 2936344"), JSON.stringify([{ text: "hexokinase" }, { pmid: 2936344, text: "2936344" }]));
  // The EC field matches whole parts: 1.1.1.1 is not 1.1.1.10, and 1.1.1 covers both.
  const ecRow = (ec) => ({ record_key: ec, ec_number: ec, verification_status: "verified" });
  const ecFound = (ec) => ["1.1.1.1", "1.1.1.10", "1.1.11.1", "2.1.1.1"].filter((value) => rowMatches(ecRow(value), {
    ec, recordStates: ["accepted", "curation_pending", "not_verified"], metrics: [],
  }));
  assert.deepEqual(ecFound("1.1.1.1"), ["1.1.1.1"]);
  assert.deepEqual(ecFound("EC 1.1.1"), ["1.1.1.1", "1.1.1.10"]);
  assert.deepEqual(ecFound("1."), ["1.1.1.1", "1.1.1.10", "1.1.11.1"]);
  assert.deepEqual(ecFound("ec:2"), ["2.1.1.1"]);
  assert.deepEqual(ecFound("1.1.1.1, 2.1.1.1"), ["1.1.1.1", "2.1.1.1"]);
  assert.deepEqual(ecFound("EC "), ["1.1.1.1", "1.1.1.10", "1.1.11.1", "2.1.1.1"], "EC alone filters nothing yet");
  // Address values: + and %20 are spaces, unknown keys stay (and are ignored by the page), and a range reads either way.
  const params = parseBrowseParams("q=lactate+dehydrogenase&organism=E.%20coli&status=accepted%2Cv2&bad=%E0");
  assert.equal(params.get("q"), "lactate dehydrogenase");
  assert.equal(params.get("organism"), "E. coli");
  assert.equal(params.get("status"), "accepted,v2");
  assert.equal(params.get("bad"), "");
  assert.deepEqual({ ...numberRange("37", "20") }, { min: 20, max: 37 });
  assert.deepEqual({ ...numberRange("7,5", "") }, { min: 7.5, max: null });
  assert.equal(numberRange("abc", ""), null);
}
console.log("catlog-static-index-retry: ok");
