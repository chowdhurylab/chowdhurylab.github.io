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

console.log("catlog-static-index-retry: ok");
