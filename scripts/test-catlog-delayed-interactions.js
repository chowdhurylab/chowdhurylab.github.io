async (page) => {
  const rows = Array.from({ length: 50 }, (_, index) => ({
    record_key: `fixture-${index}`,
    measurement_key: `fixture-${index}`,
    enzyme_display_name: `Enzyme ${String(index).padStart(2, "0")}`,
    ec_number: "1.1.1.1",
    organism: "Test organism",
    substrate_name: "Test substrate",
    verification_status: "verified",
    source_db: "brenda",
    kcat: index + 1,
    kcat_unit: "s^(-1)",
    km: 1,
    km_unit: "mM",
    detail_shard: `data/details-fixture-${index < 25 ? 0 : 1}.js`,
  }));
  const manifest = {
    total_rows: rows.length,
    generated_at: "2026-09-04T00:00:00Z",
    record_chunks: ["data/records-fixture.js"],
    source_databases: [],
  };
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.route("**/assets/catlog-static.js*", route => route.fulfill({
    path: "tools/catlog-static/assets/catlog-static.js",
    contentType: "application/javascript",
  }));
  await page.route("**/data/manifest.js*", route => route.fulfill({
    body: `window.CATLOG_STATIC_MANIFEST = ${JSON.stringify(manifest)};`,
    contentType: "application/javascript",
  }));
  await page.route("**/data/records-fixture.js*", route => route.fulfill({
    body: `window.CATLOG_RECORD_CHUNKS = [${JSON.stringify(rows)}];`,
    contentType: "application/javascript",
  }));
  let releaseFirst;
  let releaseSecond;
  const gates = [new Promise(resolve => { releaseFirst = resolve; }),
    new Promise(resolve => { releaseSecond = resolve; })];
  const requested = [0, 0];
  await page.route("**/data/details-fixture-*.js*", async route => {
    const shardIndex = Number(route.request().url().match(/details-fixture-(\d)/)[1]);
    requested[shardIndex] += 1;
    await gates[shardIndex];
    const shard = Object.fromEntries(rows.filter(row => row.detail_shard.includes(`-${shardIndex}.js`))
      .map(row => [row.record_key, { ...row, sequence: "fixture-sequence", smiles: "fixture-smiles" }]));
    await route.fulfill({ contentType: "application/javascript", body:
      `window.CATLOG_DETAIL_SHARDS = window.CATLOG_DETAIL_SHARDS || {}; window.CATLOG_DETAIL_SHARDS["data/details-fixture-${shardIndex}.js"] = ${JSON.stringify(shard)};` });
  });
  await page.goto("https://chowdhurylab.github.io/tools/catlog-latest.html?qa=delayed-interactions");
  await page.locator("#recordsBody tr[data-key]").first().waitFor();

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#downloadPageButton").click();
  await page.locator("#nextButton").click();
  await page.locator('#recordsBody tr[data-key="fixture-25"]').waitFor();
  if (await page.locator("#downloadPageButton").isEnabled()) throw new Error("Download re-enabled during pending page export");
  releaseFirst();
  const download = await downloadPromise;
  if (!download.suggestedFilename().startsWith("catlog-page-1-")) throw new Error("Download filename changed with page navigation");
  const stream = await download.createReadStream();
  let content = "";
  for await (const chunk of stream) content += chunk.toString();
  const exported = JSON.parse(content);
  if (exported.metadata.page !== 1 || exported.records.length !== 25
      || exported.records[0].record_key !== "fixture-0") throw new Error("Export rows and metadata disagree");
  if (exported.records.some(row => "_loadIndex" in row || row.sequence !== "fixture-sequence" || row.smiles !== "fixture-smiles")) {
    throw new Error("Export leaked runtime fields or lost molecular details");
  }

  await page.locator('#recordsBody tr[data-key="fixture-25"]').click();
  await page.locator("#detailLoadStatus").waitFor();
  if (!await page.locator("#closeDetailButton").isVisible()) throw new Error("No close control during detail load");
  await page.locator("#closeDetailButton").click();
  if (await page.locator("body").evaluate(element => element.classList.contains("detail-open"))) throw new Error("Loading drawer did not close");
  releaseSecond();
  await page.locator('#recordsBody tr[data-key="fixture-26"]').click();
  await page.locator("#downloadSelectedJson").waitFor();
  if (!await page.locator("#detailHeading").innerText().then(text => text.includes("Enzyme 26"))) throw new Error("Stale record overwrote new selection");
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) throw new Error("Mobile page overflows viewport");
  if (errors.length) throw new Error(errors.join("\n"));
  return { passed: true, page: exported.metadata.page, records: exported.records.length,
    detail_requests: requested, close_while_loading: true, newest_selection: "Enzyme 26", mobile_overflow: overflow, errors };
}
