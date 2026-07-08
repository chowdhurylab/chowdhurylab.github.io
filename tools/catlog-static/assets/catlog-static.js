(function () {
  const manifest = window.CATLOG_STATIC_MANIFEST || {};
  const assetVersion = String(manifest.source_sha256 || manifest.generated_at || "20260707")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 16) || "20260707";
  const state = {
    records: [],
    filtered: [],
    page: 1,
    pageSize: 25,
    selectedKey: "",
    selectedDetail: null,
    downloadInProgress: false,
    loadedScripts: new Set(["data/manifest.js"]),
    suggestionHideTimer: null,
  };

  const recordStates = [
    {
      value: "paper_backed",
      label: "Literature support",
      shortLabel: "Literature support",
      className: "paper",
    },
    {
      value: "needs_review",
      label: "Needs curation",
      shortLabel: "Needs curation",
      className: "review",
    },
    {
      value: "unresolved_issues",
      label: "Unverified",
      shortLabel: "Unverified",
      className: "unresolved",
    },
  ];

  const stateDescriptions = {
    paper_backed: "Accepted, corrected, or backed by preserved paper evidence.",
    needs_review: "Evidence is present, but this measurement is not accepted yet.",
    unresolved_issues: "No public evidence strong enough for acceptance in this snapshot.",
  };

  const measurementFilters = [
    { value: "kcat", label: "Has kcat", field: "kcat" },
    { value: "km", label: "Has Km", field: "km" },
    { value: "kcat_over_km", label: "Has kcat/Km", field: "kcat_over_km" },
  ];

  const tierOrder = {
    paper_grounded_high_confidence: 0,
    paper_grounded: 1,
    cross_source_supported: 2,
    literature_linked: 3,
    candidate_only: 4,
  };

  const sourceLabels = {
    source_record: "source record",
    explicit_enzyme_name: "explicit name",
    brenda_recommended_name: "BRENDA recommended",
    protein_name_fallback: "preserved protein name",
    uniprot_name_fallback: "UniProt name",
    ec_accepted_name_fallback: "EC accepted name",
    ec_name_fallback: "EC canonical name",
    uniprot_fallback: "UniProt fallback",
    name_not_preserved: "name not preserved",
  };

  const identityLabels = {
    accession_resolved: "accession resolved",
    sequence_resolved_no_accession: "sequence only",
    candidate_pool: "candidate pool",
    identity_unresolved: "identity unresolved",
  };

  const tierLabels = {
    paper_grounded_high_confidence: "full-text literature support",
    paper_grounded: "literature-supported",
    literature_linked: "literature-linked",
    cross_source_supported: "multi-source support",
    candidate_only: "single-source entry",
  };

  const suggestionInputs = {
    globalSearchInput: "mixed",
    searchInput: "mixed",
    ecFilterInput: "ec_number",
    enzymeFilterInput: "enzyme_display_name",
    organismFilterInput: "organism",
    substrateFilterInput: "substrate_name",
  };

  const suggestionTitles = {
    mixed: "Try a catalog search",
    ec_number: "Try an EC number",
    enzyme_display_name: "Try an enzyme",
    organism: "Try an organism",
    substrate_name: "Try a substrate",
  };

  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]);
  }

  function publicText(value) {
    return String(value == null ? "" : value)
      .replace(/\bpaper[- ]backed\b/gi, "literature-supported")
      .replace(/\bclaim\s+status\b/gi, "record state")
      .replace(/\bclaim[- ]verified\b/gi, "accepted")
      .replace(/\bverified\s+or\s+corrected\b/gi, "accepted or corrected")
      .replace(/\baccepted\s+as[- ]is\b/gi, "accepted")
      .replace(/\bnot[_ ]labeled\b/gi, "not labeled");
  }

  function escapePublic(value) {
    return escapeHtml(publicText(value));
  }

  function formatInteger(value) {
    return new Intl.NumberFormat().format(Number(value || 0));
  }

  function formatNumber(value, options = {}) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "n/a";
    if (Math.abs(number) >= 1000) {
      return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(number);
    }
    if (Math.abs(number) >= 10) {
      return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(number);
    }
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: options.maximumFractionDigits ?? 2,
      minimumFractionDigits: options.minimumFractionDigits ?? 0,
    }).format(number);
  }

  function compactValue(value) {
    if (value === null || value === undefined || value === "") return "n/a";
    if (Array.isArray(value)) return value.length ? value.map(evidenceText).join(", ") : "n/a";
    if (typeof value === "object") return evidenceText(value);
    return String(value);
  }

  function evidenceText(value) {
    if (value === null || value === undefined || value === "") return "";
    if (typeof value !== "object") return String(value);
    const parts = [
      value.table_label,
      value.row_label,
      value.column_label,
      value.raw_value_unit_evidence,
      value.normalized_value_unit_evidence,
      value.retrieval_route,
    ].filter(Boolean);
    return parts.length ? parts.join(" | ") : JSON.stringify(value);
  }

  function metricDisplay(row, field) {
    const display = row[`${field}_display`];
    return display && display !== "n/a" ? display : "n/a";
  }

  function formatTemperature(row) {
    const display = row.temperature_display;
    if (display && display !== "n/a") return display;
    const kelvin = Number(row.temperature_k);
    if (!Number.isFinite(kelvin)) return "n/a";
    const celsius = kelvin > 170 ? kelvin - 273.15 : kelvin;
    return formatNumber(celsius, { maximumFractionDigits: 1 });
  }

  function formatPh(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "n/a";
    return formatNumber(number, { maximumFractionDigits: 1 });
  }

  function stateConfig(value) {
    return recordStates.find((item) => item.value === value) || recordStates[2];
  }

  function recordStateForRow(row) {
    const status = row.verification_status;
    const tier = row.evidence_confidence_tier;
    if (
      status === "verified"
      || status === "corrected"
      || tier === "paper_grounded"
      || tier === "paper_grounded_high_confidence"
    ) {
      return "paper_backed";
    }
    if (
      status === "manual_review_required"
      || status === "mathematically_inferred"
      || tier === "literature_linked"
      || tier === "cross_source_supported"
      || row.has_literature_id
    ) {
      return "needs_review";
    }
    return "unresolved_issues";
  }

  function evidenceLevel(row) {
    const tier = row.evidence_confidence_tier;
    const derivedState = row._recordState || recordStateForRow(row);
    if (tier === "paper_grounded_high_confidence") return 5;
    if (tier === "paper_grounded") return 4;
    if (tier === "cross_source_supported") return 4;
    if (tier === "literature_linked") return 3;
    if (derivedState === "needs_review") return 3;
    return 2;
  }

  function confidenceLabel(score) {
    if (score >= 5) return "Strong support";
    if (score >= 4) return "Literature support";
    if (score >= 3) return "Needs curation";
    return "Unverified";
  }

  function evidenceBars(row, label = "") {
    const derivedState = row._recordState || recordStateForRow(row);
    const config = stateConfig(derivedState);
    const score = Number(row._evidenceScore || evidenceLevel(row));
    const bars = [1, 2, 3, 4, 5].map((index) => (
      `<span class="${index <= score ? "filled" : ""}"></span>`
    )).join("");
    return `<span class="evidence-bars ${config.className}" aria-label="${escapeHtml(label || confidenceLabel(score))}">${bars}</span>`;
  }

  function statusBadge(row) {
    const config = stateConfig(row._recordState || recordStateForRow(row));
    return `<span class="state-badge ${config.className}" title="${escapeHtml(stateDescriptions[config.value] || config.label)}">${escapeHtml(config.shortLabel)}</span>`;
  }

  function versionedAssetUrl(src) {
    if (!src || /^(?:https?:)?\/\//.test(src) || src.startsWith("data:")) return src;
    const separator = src.includes("?") ? "&" : "?";
    return `${src}${separator}v=${encodeURIComponent(assetVersion)}`;
  }

  function loadScript(src) {
    if (state.loadedScripts.has(src)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = versionedAssetUrl(src);
      script.onload = () => {
        state.loadedScripts.add(src);
        resolve();
      };
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      document.body.appendChild(script);
    });
  }

  async function loadRecordChunks() {
    const chunks = Array.isArray(manifest.record_chunks) ? manifest.record_chunks : [];
    $("activeSummary").textContent = `Loading ${formatInteger(chunks.length)} data chunk${chunks.length === 1 ? "" : "s"}...`;
    await Promise.all(chunks.map(loadScript));
    state.records = (window.CATLOG_RECORD_CHUNKS || []).flat();
    state.records.forEach((row) => {
      row._recordState = recordStateForRow(row);
      row._evidenceScore = evidenceLevel(row);
      row._search = String(row._search_text || [
        row.measurement_key,
        row.review_key,
        row.ec_number,
        row.enzyme_display_name,
        row.organism,
        row.substrate_name,
        row.source_db,
        row.primary_uniprot_id,
      ].join(" ")).toLowerCase();
    });
  }

  function triggerBlobDownload(filename, payload) {
    const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleSnapshotDownload() {
    if (state.downloadInProgress) return;
    state.downloadInProgress = true;
    const button = $("exportSnapshotButton");
    if (button) button.textContent = "Preparing...";
    try {
      const payload = {
        metadata: {
          name: "CatLog static row index",
          generated_at: new Date().toISOString(),
          snapshot_generated_at: manifest.generated_at || null,
          source_file: manifest.source_file || null,
          source_size_bytes: manifest.source_size_bytes || null,
          source_sha256: manifest.source_sha256 || null,
          total_rows: manifest.total_rows || state.records.length,
          export_scope: "compact_visible_row_index",
        },
        records: state.records,
      };
      const filenameDate = String(manifest.generated_at || new Date().toISOString()).replace(/[:]/g, "-");
      triggerBlobDownload(`catlog-static-row-index-${filenameDate}.json`, JSON.stringify(payload, null, 2));
    } finally {
      state.downloadInProgress = false;
      if (button) button.textContent = "Export snapshot";
    }
  }

  function uniqueCount(rows, field) {
    return new Set(rows.map((row) => String(row[field] || "").trim()).filter(Boolean)).size;
  }

  function metricCoverage(rows, field) {
    return rows.reduce((count, row) => count + (row[field] != null ? 1 : 0), 0);
  }

  function rowsForSummary() {
    return state.records.length ? state.filtered : [];
  }

  function renderSummary() {
    const summary = manifest.summary || {};
    const totals = summary.totals || {};
    const trust = summary.trust_snapshot || {};
    const rows = Array.isArray(rowsForSummary()) ? rowsForSummary() : [];
    const totalRows = state.records.length ? rows.length : (manifest.total_rows || 0);
    const acceptedRows = Number(
      trust.accepted_rows
      || ((Number(trust.accepted_as_is_rows) || 0) + (Number(trust.corrected_rows) || 0))
      || 0
    );
    const cards = [
      ["Current view", totalRows, "records", ""],
      ["Accepted records", acceptedRows, "accepted or corrected", "accepted-card"],
      ["Enzymes", uniqueCount(rows, "enzyme_display_name") || totals.unique_enzymes || 0, "", ""],
      ["EC numbers", uniqueCount(rows, "ec_number") || totals.unique_ec_numbers || 0, "", ""],
      ["Organisms", uniqueCount(rows, "organism") || totals.unique_organisms || 0, "", ""],
    ];
    $("summaryGrid").innerHTML = cards.map(([label, value, note, className]) => `
      <article class="summary-card ${escapeHtml(className || "")}">
        <span>${escapeHtml(label)}</span>
        <strong>${formatInteger(value)}</strong>
        ${note ? `<span>${escapeHtml(note)}</span>` : ""}
      </article>
    `).join("");
    renderEvidenceSummary(rows);
    const kcatRows = metricCoverage(rows, "kcat");
    const kmRows = metricCoverage(rows, "km");
    const efficiencyRows = metricCoverage(rows, "kcat_over_km");
    $("snapshotMeta").innerHTML = `
      <span class="snapshot-title">Measured rows</span>
      <span class="snapshot-line"><strong>${formatInteger(kcatRows)}</strong><span>kcat</span></span>
      <span class="snapshot-line"><strong>${formatInteger(kmRows)}</strong><span>Km</span></span>
      <span class="snapshot-line"><strong>${formatInteger(efficiencyRows)}</strong><span>kcat/Km</span></span>
    `;
  }

  function renderEvidenceSummary(rows) {
    const total = Math.max(1, rows.length || 0);
    const counts = Object.fromEntries(recordStates.map((item) => [item.value, 0]));
    rows.forEach((row) => {
      counts[row._recordState || recordStateForRow(row)] += 1;
    });
    $("evidenceSummary").innerHTML = `
      <div class="evidence-summary-title">Evidence support</div>
      <div class="evidence-segment-row">
        ${recordStates.map((item) => {
          const count = counts[item.value] || 0;
          const pct = rows.length ? ((count / total) * 100).toFixed(1) : "0.0";
          return `
            <div class="evidence-segment">
              <span class="evidence-dot ${item.className}"></span>
              <span>${escapeHtml(item.shortLabel)}</span>
              <strong>${pct}% <span>(${formatInteger(count)})</span></strong>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function countsByState() {
    const counts = Object.fromEntries(recordStates.map((item) => [item.value, 0]));
    state.records.forEach((row) => {
      counts[row._recordState || recordStateForRow(row)] += 1;
    });
    return counts;
  }

  function countMetric(field) {
    return state.records.reduce((count, row) => count + (row[field] != null ? 1 : 0), 0);
  }

  function valueFromRow(row, field) {
    return String(row[field] || "").trim();
  }

  function isSuggestibleValue(value) {
    const key = value.toLowerCase();
    return Boolean(value)
      && key !== "n/a"
      && key !== "unknown"
      && key !== "not reported"
      && key !== "not_reported";
  }

  function randomSuggestions(kind, limit = 5) {
    if (!state.records.length) return [];
    const fields = kind === "mixed"
      ? ["enzyme_display_name", "ec_number", "organism", "substrate_name"]
      : [kind];
    const seen = new Set();
    const values = [];
    const maxAttempts = Math.min(state.records.length * fields.length, limit * 80);
    for (let attempt = 0; attempt < maxAttempts && values.length < limit; attempt += 1) {
      const row = state.records[Math.floor(Math.random() * state.records.length)];
      const field = fields[Math.floor(Math.random() * fields.length)];
      const value = valueFromRow(row, field);
      const key = value.toLowerCase();
      if (!isSuggestibleValue(value) || seen.has(key)) continue;
      seen.add(key);
      values.push(value);
    }
    return values;
  }

  function hideSuggestions() {
    const box = $("searchSuggestions");
    if (!box) return;
    box.classList.add("hidden");
    box.innerHTML = "";
  }

  function showSuggestions(input) {
    const kind = suggestionInputs[input.id];
    const box = $("searchSuggestions");
    if (!kind || !box || !state.records.length) return;
    window.clearTimeout(state.suggestionHideTimer);
    const suggestions = randomSuggestions(kind);
    if (!suggestions.length) return;
    const rect = input.getBoundingClientRect();
    box.style.left = `${Math.round(rect.left)}px`;
    box.style.top = `${Math.round(rect.bottom + 6)}px`;
    box.style.width = `${Math.max(240, Math.round(rect.width))}px`;
    box.innerHTML = `
      <div class="suggestion-title">${escapeHtml(suggestionTitles[kind] || "Try a search")}</div>
      ${suggestions.map((value) => (
        `<button type="button" role="option" data-value="${escapeHtml(value)}">${escapePublic(value)}</button>`
      )).join("")}
    `;
    box.classList.remove("hidden");
    [...box.querySelectorAll("button[data-value]")].forEach((button) => {
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        input.value = button.dataset.value || "";
        hideSuggestions();
        input.focus();
        applyFilters();
      });
    });
  }

  function setupFilters() {
    const stateCounts = countsByState();
    $("statusChecklist").innerHTML = recordStates.map((item) => `
      <label class="check-row ${item.className}" title="${escapeHtml(stateDescriptions[item.value])}">
        <input type="checkbox" name="recordState" value="${escapeHtml(item.value)}" checked />
        <span>${escapeHtml(item.label)}</span>
        <strong>${formatInteger(stateCounts[item.value] || 0)}</strong>
      </label>
    `).join("") + `
      <div class="status-help" aria-label="Record state definitions">
        <p><strong>Literature support:</strong> Accepted, corrected, or backed by preserved paper evidence.</p>
        <p><strong>Needs curation:</strong> Evidence is present, but the measurement is not accepted yet.</p>
        <p><strong>Unverified:</strong> No public evidence strong enough for acceptance here.</p>
      </div>
    `;
    $("measurementChecklist").innerHTML = measurementFilters.map((item) => `
      <label class="check-row">
        <input type="checkbox" name="measurement" value="${escapeHtml(item.value)}" />
        <span>${escapeHtml(item.label)}</span>
        <strong>${formatInteger(countMetric(item.field))}</strong>
      </label>
    `).join("");
  }

  function selectedCheckboxes(name) {
    return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((item) => item.value);
  }

  function currentFilters() {
    return {
      q: [
        $("globalSearchInput").value,
        $("searchInput").value,
      ].join(" ").trim().toLowerCase(),
      ec: $("ecFilterInput").value.trim().toLowerCase(),
      enzyme: $("enzymeFilterInput").value.trim().toLowerCase(),
      organism: $("organismFilterInput").value.trim().toLowerCase(),
      substrate: $("substrateFilterInput").value.trim().toLowerCase(),
      recordStates: selectedCheckboxes("recordState"),
      metrics: selectedCheckboxes("measurement"),
      sort: $("sortSelect").value,
    };
  }

  function fieldContains(row, field, value) {
    if (!value) return true;
    return String(row[field] || "").toLowerCase().includes(value);
  }

  function rowMatches(row, filters) {
    if (filters.q && !row._search.includes(filters.q)) return false;
    if (!filters.recordStates.includes(row._recordState || recordStateForRow(row))) return false;
    if (!fieldContains(row, "ec_number", filters.ec)) return false;
    if (!fieldContains(row, "enzyme_display_name", filters.enzyme)) return false;
    if (!fieldContains(row, "organism", filters.organism)) return false;
    if (!fieldContains(row, "substrate_name", filters.substrate)) return false;
    if (filters.metrics.length) {
      const metricFields = {
        kcat: "kcat",
        km: "km",
        ki: "ki",
        kcat_over_km: "kcat_over_km",
      };
      if (!filters.metrics.some((metric) => row[metricFields[metric]] != null)) return false;
    }
    return true;
  }

  function ecSort(a, b) {
    const parse = (value) => String(value || "").split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : Number.MAX_SAFE_INTEGER));
    const left = parse(a.ec_number);
    const right = parse(b.ec_number);
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      const delta = (left[index] ?? -1) - (right[index] ?? -1);
      if (delta !== 0) return delta;
    }
    return String(a.ec_number || "").localeCompare(String(b.ec_number || ""));
  }

  function sortRows(rows, sort) {
    const textKey = (field) => (a, b) => String(a[field] || "").localeCompare(String(b[field] || ""));
    const numericDesc = (field) => (a, b) => {
      const av = a[field] == null ? Number.NEGATIVE_INFINITY : Number(a[field]);
      const bv = b[field] == null ? Number.NEGATIVE_INFINITY : Number(b[field]);
      return bv - av;
    };
    const sorters = {
      ec_number: ecSort,
      enzyme: textKey("enzyme_display_name"),
      organism: textKey("organism"),
      substrate: textKey("substrate_name"),
      source: textKey("source_db"),
      kcat: numericDesc("kcat"),
      km: numericDesc("km"),
      kcat_over_km: numericDesc("kcat_over_km"),
      evidence: (a, b) => {
        const stateDelta = recordStates.findIndex((item) => item.value === a._recordState)
          - recordStates.findIndex((item) => item.value === b._recordState);
        if (stateDelta !== 0) return stateDelta;
        const tierDelta = (tierOrder[a.evidence_confidence_tier] ?? 99) - (tierOrder[b.evidence_confidence_tier] ?? 99);
        if (tierDelta !== 0) return tierDelta;
        return (Number(b.source_record_count || 0) - Number(a.source_record_count || 0)) || ecSort(a, b);
      },
    };
    rows.sort(sorters[sort] || sorters.evidence);
  }

  function applyFilters({ resetPage = true } = {}) {
    const filters = currentFilters();
    state.filtered = state.records.filter((row) => rowMatches(row, filters));
    sortRows(state.filtered, filters.sort);
    if (resetPage) state.page = 1;
    if (state.selectedKey && !state.filtered.some((row) => row.record_key === state.selectedKey)) {
      resetDetail();
    }
    renderSummary();
    renderRows();
  }

  function renderRows() {
    const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
    state.page = Math.min(Math.max(1, state.page), totalPages);
    const start = (state.page - 1) * state.pageSize;
    const pageRows = state.filtered.slice(start, start + state.pageSize);
    $("activeSummary").textContent = `${formatInteger(state.filtered.length)} records`;
    $("pageSummary").textContent = pageRows.length
      ? `${formatInteger(start + 1)}-${formatInteger(Math.min(start + pageRows.length, state.filtered.length))} of ${formatInteger(state.filtered.length)}`
      : "No rows match the selected filters";
    $("pageLabel").textContent = pageRows.length
      ? `${formatInteger(start + 1)}-${formatInteger(Math.min(start + pageRows.length, state.filtered.length))} of ${formatInteger(state.filtered.length)}`
      : "No records";
    $("prevButton").disabled = state.page <= 1;
    $("nextButton").disabled = state.page >= totalPages;
    $("recordsBody").innerHTML = pageRows.map((row) => `
      <tr data-key="${escapeHtml(row.record_key)}" class="${row.record_key === state.selectedKey ? "selected" : ""}">
        <td class="primary-cell">
          <strong>${escapePublic(row.enzyme_display_name || "Name not preserved")}</strong>
          <span>${escapePublic(sourceLabels[row.enzyme_label_source] || row.enzyme_label_source || row.source_db || "source")}</span>
        </td>
        <td>${escapeHtml(row.ec_number || "n/a")}</td>
        <td class="organism-cell">${escapePublic(row.organism || "n/a")}</td>
        <td class="substrate-cell">${escapePublic(row.substrate_name || "n/a")}</td>
        <td class="metric-cell"><strong>${escapeHtml(metricDisplay(row, "kcat"))}</strong></td>
        <td class="metric-cell">${escapeHtml(metricDisplay(row, "km"))}</td>
        <td class="metric-cell">${escapeHtml(metricDisplay(row, "kcat_over_km"))}</td>
        <td>${escapeHtml(formatTemperature(row))}</td>
        <td>${escapeHtml(formatPh(row.ph))}</td>
        <td>${evidenceBars(row)}</td>
        <td>${statusBadge(row)}</td>
        <td class="row-arrow" aria-hidden="true">&rsaquo;</td>
      </tr>
    `).join("");
    [...$("recordsBody").querySelectorAll("tr")].forEach((rowElement) => {
      rowElement.addEventListener("click", () => selectRecord(rowElement.dataset.key));
    });
  }

  function setDetailOpen(isOpen) {
    document.body.classList.toggle("detail-open", Boolean(isOpen));
  }

  function resetDetail() {
    state.selectedKey = "";
    state.selectedDetail = null;
    $("detailContent").classList.add("hidden");
    $("detailEmpty").classList.remove("hidden");
    setDetailOpen(false);
  }

  function usesEmbeddedDetailPanel() {
    return window.matchMedia("(min-width: 1501px)").matches;
  }

  async function selectRecord(key) {
    const row = state.records.find((item) => item.record_key === key);
    if (!row) {
      resetDetail();
      renderRows();
      return;
    }
    state.selectedKey = key;
    setDetailOpen(true);
    renderRows();
    $("detailEmpty").classList.add("hidden");
    $("detailContent").classList.remove("hidden");
    $("detailContent").innerHTML = '<p class="muted">Loading row details...</p>';
    await loadScript(row.detail_shard);
    const shard = (window.CATLOG_DETAIL_SHARDS || {})[row.detail_shard] || {};
    state.selectedDetail = shard[key] || {};
    renderDetail(row, state.selectedDetail);
  }

  function kv(label, value) {
    return `<div class="kv-line"><span>${escapePublic(label)}</span><strong>${escapePublic(compactValue(value))}</strong></div>`;
  }

  function doiLink(value) {
    const doi = String(value || "").trim();
    if (!doi) return "n/a";
    const href = doi.startsWith("http") ? doi : `https://doi.org/${encodeURI(doi)}`;
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(doi)}</a>`;
  }

  function pmidLink(value) {
    const pmid = String(value || "").trim();
    if (!pmid) return "n/a";
    return `<a href="https://pubmed.ncbi.nlm.nih.gov/${escapeHtml(pmid)}/" target="_blank" rel="noreferrer">${escapeHtml(pmid)}</a>`;
  }

  function listText(values, limit = 2) {
    const items = Array.isArray(values) ? values.filter(Boolean) : [];
    return items.slice(0, limit).map((item) => escapePublic(evidenceText(item))).join("<br>") || "n/a";
  }

  function detailSection(title, rows) {
    return `
      <section class="detail-section">
        <h3>${escapeHtml(title)}</h3>
        <div class="detail-kv">${rows.join("")}</div>
      </section>
    `;
  }

  function renderDetail(summary, detail) {
    const stateValue = summary._recordState || recordStateForRow(summary);
    const config = stateConfig(stateValue);
    const score = Number(summary._evidenceScore || evidenceLevel(summary));
    const pmids = detail.supporting_pmids || (detail.pubmed_id ? [detail.pubmed_id] : []);
    const dois = detail.supporting_dois || (detail.doi ? [detail.doi] : []);
    const proofLines = detail.proof_lines || detail.paper_mentions || [];
    const firstPmid = Array.isArray(pmids) ? pmids[0] : "";
    const firstDoi = Array.isArray(dois) ? dois[0] : "";
    $("detailContent").innerHTML = `
      <div class="detail-top">
        <button id="closeDetailButton" class="icon-button close-detail" type="button" aria-label="Close detail">&times;</button>
        <h2>${escapePublic(summary.enzyme_display_name || "Name not preserved")}</h2>
        <p>${escapeHtml(summary.ec_number || "n/a")} &middot; ${escapePublic(summary.organism || "n/a")}</p>
        <div class="detail-confidence">
          <span class="state-badge ${config.className}">${escapeHtml(config.shortLabel)}</span>
          ${evidenceBars(summary, confidenceLabel(score))}
          <span>${escapeHtml(confidenceLabel(score))}</span>
        </div>
      </div>

      ${detailSection("Source", [
        kv("Source ID", summary.measurement_key || detail.measurement_key),
        kv("Catalog", "CatLog"),
        kv("Source", summary.source_db || detail.source_db),
        kv("Source rows", detail.source_record_count || summary.source_record_count),
      ])}

      ${detailSection("Literature", [
        `<div class="kv-line"><span>DOI</span><strong>${doiLink(firstDoi)}</strong></div>`,
        `<div class="kv-line"><span>PMID</span><strong>${pmidLink(firstPmid)}</strong></div>`,
        kv("Paper IDs", [
          ...(Array.isArray(pmids) ? pmids : []),
          ...(Array.isArray(dois) ? dois : []),
        ].join(", ")),
      ])}

      ${detailSection("Measurement", [
        kv("Substrate", summary.substrate_name),
        kv("Assay type", metricDisplay(summary, "kcat") !== "n/a" ? "steady-state kcat" : "kinetic measurement"),
        kv("Temperature", `${formatTemperature(summary)} C`),
        kv("pH", formatPh(summary.ph)),
        kv("Condition", detail.assay_conditions_summary),
        kv("kcat", metricDisplay(summary, "kcat")),
        kv("Km", metricDisplay(summary, "km")),
        kv("kcat/Km", metricDisplay(summary, "kcat_over_km")),
      ])}

      ${detailSection("Evidence support", [
        kv("State meaning", stateDescriptions[stateValue] || config.label),
        kv("Evidence tier", tierLabels[summary.evidence_confidence_tier] || summary.evidence_confidence_tier),
        kv("Identity", identityLabels[summary.identity_resolution_state] || summary.identity_resolution_state),
        kv("Record state", config.label),
      ])}

      <section class="detail-section">
        <h3>Notes</h3>
        <p class="detail-note">${listText(proofLines, 3)}</p>
      </section>

      <div class="detail-actions">
        <button id="downloadSelectedJson" class="button secondary" type="button">Download JSON</button>
      </div>
    `;
    $("closeDetailButton").addEventListener("click", () => {
      resetDetail();
      renderRows();
    });
    $("downloadSelectedJson").addEventListener("click", () => {
      const payload = { summary, detail };
      triggerBlobDownload(`${summary.record_key || "catlog-row"}.json`, JSON.stringify(payload, null, 2));
    });
  }

  function clearFilters() {
    [
      "globalSearchInput",
      "searchInput",
      "ecFilterInput",
      "enzymeFilterInput",
      "organismFilterInput",
      "substrateFilterInput",
    ].forEach((id) => {
      $(id).value = "";
    });
    document.querySelectorAll('input[name="recordState"]').forEach((input) => {
      input.checked = true;
    });
    document.querySelectorAll('input[name="measurement"]').forEach((input) => {
      input.checked = false;
    });
    $("sortSelect").value = "evidence";
    resetDetail();
    applyFilters();
  }

  function bindControls() {
    [
      "globalSearchInput",
      "searchInput",
      "ecFilterInput",
      "enzymeFilterInput",
      "organismFilterInput",
      "substrateFilterInput",
      "sortSelect",
    ].forEach((id) => {
      $(id).addEventListener("input", () => applyFilters());
      $(id).addEventListener("change", () => applyFilters());
    });
    Object.keys(suggestionInputs).forEach((id) => {
      const input = $(id);
      if (!input) return;
      input.addEventListener("focus", () => showSuggestions(input));
      input.addEventListener("click", () => showSuggestions(input));
      input.addEventListener("blur", () => {
        state.suggestionHideTimer = window.setTimeout(hideSuggestions, 140);
      });
    });
    document.querySelectorAll(".filter-section-title").forEach((button) => {
      button.addEventListener("click", () => {
        const section = button.closest(".filter-section");
        const isOpen = !section.classList.contains("open");
        section.classList.toggle("open", isOpen);
        button.setAttribute("aria-expanded", String(isOpen));
        const marker = button.querySelector("span");
        if (marker) marker.textContent = isOpen ? "⌃" : "⌄";
      });
    });
    $("browseButton").addEventListener("click", () => {
      document.querySelector(".table-panel")?.scrollIntoView({ block: "start" });
    });
    window.addEventListener("scroll", hideSuggestions, { passive: true });
    window.addEventListener("resize", hideSuggestions);
    $("statusChecklist").addEventListener("change", () => applyFilters());
    $("measurementChecklist").addEventListener("change", () => applyFilters());
    $("clearButton").addEventListener("click", clearFilters);
    $("pageSizeSelect").addEventListener("change", () => {
      resetDetail();
      state.pageSize = Number($("pageSizeSelect").value) || 25;
      applyFilters();
    });
    $("prevButton").addEventListener("click", () => {
      resetDetail();
      state.page -= 1;
      renderRows();
    });
    $("nextButton").addEventListener("click", () => {
      resetDetail();
      state.page += 1;
      renderRows();
    });
    $("exportSnapshotButton").addEventListener("click", handleSnapshotDownload);
    document.addEventListener("keydown", (event) => {
      if (event.key === "/" && document.activeElement.tagName !== "INPUT") {
        event.preventDefault();
        $("globalSearchInput").focus();
      }
    });
  }

  async function init() {
    try {
      renderSummary();
      bindControls();
      await loadRecordChunks();
      setupFilters();
      applyFilters();
      if (state.filtered.length && usesEmbeddedDetailPanel()) {
        await selectRecord(state.filtered[0].record_key);
      }
    } catch (error) {
      $("activeSummary").innerHTML = `<span class="state-badge review">${escapeHtml(error.message || error)}</span>`;
    }
  }

  init();
})();
