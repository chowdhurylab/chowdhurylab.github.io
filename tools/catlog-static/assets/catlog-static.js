(function () {
  const manifest = window.CATLOG_STATIC_MANIFEST || {};
  const assetVersion = String(manifest.source_sha256 || manifest.generated_at || "20260709")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 16) || "20260709";
  const state = {
    records: [],
    filtered: [],
    page: 1,
    pageSize: 25,
    selectedKey: "",
    selectedDetail: null,
    downloadInProgress: false,
    loadedScripts: new Set(["data/manifest.js"]),
    loadingScripts: new Map(),
    suggestionHideTimer: null,
  };
  const EMPTY_VALUE = "—";
  const narrowFilterMedia = window.matchMedia("(max-width: 1180px)");

  const recordStates = [
    {
      value: "accepted",
      label: "Accepted",
      shortLabel: "Accepted",
      className: "accepted",
    },
    {
      value: "needs_review",
      label: "Needs review",
      shortLabel: "Needs review",
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
    accepted: "Reviewed and accepted as reported, or retained with a documented correction.",
    needs_review: "Source data are present, but at least one identity, measurement, or provenance field still requires curator review.",
    unresolved_issues: "The record does not yet meet the evidence requirements for the accepted set.",
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
    source_record: "Reported name",
    explicit_enzyme_name: "Reported name",
    brenda_recommended_name: "BRENDA name",
    protein_name_fallback: "Protein name",
    uniprot_name_fallback: "UniProt name",
    ec_accepted_name_fallback: "EC accepted name",
    ec_name_fallback: "EC name",
    uniprot_fallback: "UniProt name",
    name_not_preserved: "Name unavailable",
  };

  const identityLabels = {
    accession_resolved: "Accession resolved",
    sequence_resolved_no_accession: "Sequence resolved; accession unavailable",
    candidate_pool: "Candidate match",
    identity_unresolved: "Unresolved",
  };

  const tierLabels = {
    paper_grounded_high_confidence: "Full-text source",
    paper_grounded: "Paper excerpt",
    literature_linked: "Publication linked",
    cross_source_supported: "Cross-source match",
    candidate_only: "Source record",
  };

  const suggestionInputs = {
    globalSearchInput: "mixed",
    ecFilterInput: "ec_number",
    enzymeFilterInput: "enzyme_display_name",
    organismFilterInput: "organism",
    substrateFilterInput: "substrate_name",
  };

  const suggestionTitles = {
    mixed: "Suggestions",
    ec_number: "EC number suggestions",
    enzyme_display_name: "Enzyme suggestions",
    organism: "Organism suggestions",
    substrate_name: "Substrate suggestions",
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
      .replace(/\bpaper[- ]backed\b/gi, "paper linked")
      .replace(/\bclaim\s+status\b/gi, "review status")
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

  function formatCount(value) {
    if (value === null || value === undefined || value === "") return EMPTY_VALUE;
    return formatInteger(value);
  }

  function hasDisplayValue(value) {
    const key = String(value == null ? "" : value).trim().toLowerCase();
    return Boolean(key) && key !== "n/a" && key !== "not reported" && key !== "not_reported" && key !== EMPTY_VALUE;
  }

  function formatNumber(value, options = {}) {
    const number = Number(value);
    if (!Number.isFinite(number)) return EMPTY_VALUE;
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
    if (value === null || value === undefined || value === "") return EMPTY_VALUE;
    if (Array.isArray(value)) return value.length ? value.map(evidenceText).join(", ") : EMPTY_VALUE;
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
    ].filter(Boolean);
    return parts.length ? parts.join(" | ") : "Evidence details unavailable";
  }

  function cleanEvidenceValue(value) {
    return publicText(value)
      .replace(/\braw_value=/gi, "")
      .replace(/\braw_unit=/gi, "")
      .replace(/\bnormalized_value=/gi, "")
      .replace(/\bnormalized_unit=/gi, "")
      .replace(/\bmicroM\b/g, "µM")
      .replace(/\s+/g, " ")
      .trim();
  }

  function evidenceNoteHtml(value) {
    if (value === null || value === undefined || value === "") return "";
    if (typeof value !== "object") {
      return `<p class="evidence-note-plain">${escapePublic(value)}</p>`;
    }

    const location = [value.table_label, value.row_label].filter(Boolean).join(" · ");
    const reported = value.raw_value_unit_evidence
      || (!value.normalized_value_unit_evidence ? value.column_label : "");
    const normalized = value.normalized_value_unit_evidence;
    const rows = [
      location ? ["Location", location] : null,
      reported ? ["Reported", cleanEvidenceValue(reported)] : null,
      normalized ? ["Normalized", cleanEvidenceValue(normalized)] : null,
    ].filter(Boolean);

    if (!rows.length) {
      return `<p class="evidence-note-plain">${escapePublic(evidenceText(value))}</p>`;
    }
    return `
      <div class="evidence-note-item">
        ${rows.map(([label, text]) => `
          <div class="evidence-note-line">
            <span>${escapeHtml(label)}</span>
            <p>${escapePublic(text)}</p>
          </div>
        `).join("")}
      </div>
    `;
  }

  function evidenceNotesHtml(values, limit = 3) {
    const items = Array.isArray(values) ? values.filter(Boolean).slice(0, limit) : [];
    return items.map(evidenceNoteHtml).join("");
  }

  function formatDate(value) {
    if (!value) return "Static snapshot";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }

  function metricDisplay(row, field) {
    const display = row[`${field}_display`];
    return hasDisplayValue(display) ? display : EMPTY_VALUE;
  }

  function scientificValueHtml(value) {
    const text = compactValue(value).trim();
    const match = text.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))[eE]([+-]?\d+)$/);
    if (!match) return escapePublic(text);
    const coefficient = match[1];
    const exponent = String(Number(match[2]));
    const accessibleValue = `${coefficient} times 10 to the power of ${exponent}`;
    return `<span class="scientific-number" aria-label="${escapeHtml(accessibleValue)}"><span aria-hidden="true">${escapeHtml(coefficient)} &times; 10<sup>${escapeHtml(exponent)}</sup></span></span>`;
  }

  function metricDisplayHtml(row, field) {
    return scientificValueHtml(metricDisplay(row, field));
  }

  function formatTemperature(row) {
    const display = row.temperature_display;
    if (hasDisplayValue(display)) return display;
    const kelvin = Number(row.temperature_k);
    if (!Number.isFinite(kelvin)) return EMPTY_VALUE;
    const celsius = kelvin > 170 ? kelvin - 273.15 : kelvin;
    return formatNumber(celsius, { maximumFractionDigits: 1 });
  }

  function formatPh(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return EMPTY_VALUE;
    return formatNumber(number, { maximumFractionDigits: 1 });
  }

  function stateConfig(value) {
    return recordStates.find((item) => item.value === value) || recordStates[2];
  }

  function recordStateForRow(row) {
    const status = row.verification_status;
    const tier = row.evidence_confidence_tier;
    if (status === "verified" || status === "corrected") return "accepted";
    if (
      status === "manual_review_required"
      || status === "mathematically_inferred"
      || tier === "paper_grounded"
      || tier === "paper_grounded_high_confidence"
      || tier === "literature_linked"
      || tier === "cross_source_supported"
      || row.has_literature_id
    ) {
      return "needs_review";
    }
    return "unresolved_issues";
  }

  function evidenceLabel(row) {
    const tier = row.evidence_confidence_tier;
    if (tierLabels[tier]) return tierLabels[tier];
    return row.has_literature_id ? "Publication linked" : "Source record";
  }

  function rowStatusLabel(row) {
    if (row.verification_status === "corrected") return "Corrected";
    return stateConfig(row._recordState || recordStateForRow(row)).shortLabel;
  }

  function statusBadge(row) {
    const config = stateConfig(row._recordState || recordStateForRow(row));
    const description = stateDescriptions[config.value] || config.label;
    const label = rowStatusLabel(row);
    return `<span class="state-badge ${config.className}" title="${escapeHtml(description)}" aria-label="${escapeHtml(`${label}. ${description}`)}">${escapeHtml(label)}</span>`;
  }

  function versionedAssetUrl(src) {
    if (!src || /^(?:https?:)?\/\//.test(src) || src.startsWith("data:")) return src;
    const separator = src.includes("?") ? "&" : "?";
    return `${src}${separator}v=${encodeURIComponent(assetVersion)}`;
  }

  function loadScript(src) {
    if (state.loadedScripts.has(src)) return Promise.resolve();
    if (state.loadingScripts.has(src)) return state.loadingScripts.get(src);
    const pending = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = versionedAssetUrl(src);
      script.onload = () => {
        state.loadedScripts.add(src);
        state.loadingScripts.delete(src);
        resolve();
      };
      script.onerror = () => {
        state.loadingScripts.delete(src);
        reject(new Error(`Could not load ${src}`));
      };
      document.body.appendChild(script);
    });
    state.loadingScripts.set(src, pending);
    return pending;
  }

  async function loadRecordChunks() {
    const chunks = Array.isArray(manifest.record_chunks) ? manifest.record_chunks : [];
    $("activeSummary").textContent = `Loading ${formatInteger(chunks.length)} data chunk${chunks.length === 1 ? "" : "s"}...`;
    for (const chunk of chunks) await loadScript(chunk);
    state.records = (window.CATLOG_RECORD_CHUNKS || []).flat();
    state.records.forEach((row) => {
      row._recordState = recordStateForRow(row);
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

  function publicSummaryRecord(row) {
    const {
      detail_shard,
      _recordState,
      _search,
      _search_text,
      ...record
    } = row;
    return record;
  }

  async function handleSnapshotDownload() {
    if (state.downloadInProgress) return;
    state.downloadInProgress = true;
    const button = $("exportSnapshotButton");
    if (button) button.textContent = "Preparing file...";
    try {
      const payload = {
        metadata: {
          name: "CatLog table index",
          generated_at: new Date().toISOString(),
          snapshot_generated_at: manifest.generated_at || null,
          source_file: manifest.source_file || null,
          source_size_bytes: manifest.source_size_bytes || null,
          source_sha256: manifest.source_sha256 || null,
          total_rows: manifest.total_rows || state.records.length,
          export_scope: "compact_all_row_index",
          excluded_fields: ["sequence", "smiles", "source_records"],
        },
        records: state.records.map(publicSummaryRecord),
      };
      const filenameDate = String(manifest.generated_at || new Date().toISOString()).replace(/[:]/g, "-");
      triggerBlobDownload(`catlog-table-index-${filenameDate}.json`, JSON.stringify(payload, null, 2));
    } finally {
      state.downloadInProgress = false;
      if (button) button.textContent = "Download table";
    }
  }

  function currentPageRows() {
    const start = (state.page - 1) * state.pageSize;
    return state.filtered.slice(start, start + state.pageSize);
  }

  async function detailForRow(row) {
    await loadScript(row.detail_shard);
    const shard = (window.CATLOG_DETAIL_SHARDS || {})[row.detail_shard] || {};
    return shard[row.record_key] || {};
  }

  async function handlePageDownload() {
    const button = $("downloadPageButton");
    const rows = currentPageRows();
    if (!rows.length || button?.disabled) return;
    if (button) {
      button.disabled = true;
      button.textContent = "Preparing...";
    }
    try {
      const details = await Promise.all(rows.map(detailForRow));
      const records = rows.map((row, index) => ({
        ...details[index],
        ...publicSummaryRecord(row),
      }));
      const payload = {
        metadata: {
          name: "CatLog page export",
          generated_at: new Date().toISOString(),
          snapshot_generated_at: manifest.generated_at || null,
          source_sha256: manifest.source_sha256 || null,
          export_scope: "current_page_public_records",
          page: state.page,
          row_count: records.length,
          note: "Raw internal source-record payloads are not included in the public static package.",
        },
        records,
      };
      const filenameDate = String(manifest.generated_at || new Date().toISOString()).replace(/[:]/g, "-");
      triggerBlobDownload(`catlog-page-${state.page}-${filenameDate}.json`, JSON.stringify(payload, null, 2));
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Download page";
      }
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
    const coverage = summary.coverage || {};
    const rows = Array.isArray(rowsForSummary()) ? rowsForSummary() : [];
    const isLoaded = state.records.length > 0;
    const totalRows = isLoaded ? rows.length : (manifest.total_rows || 0);
    const cards = [
      ["Records", totalRows],
      ["Enzymes", isLoaded ? uniqueCount(rows, "enzyme_display_name") : (totals.unique_enzymes ?? null), "", ""],
      ["EC numbers", isLoaded ? uniqueCount(rows, "ec_number") : (totals.unique_ec_numbers ?? null), "", ""],
      ["Organisms", isLoaded ? uniqueCount(rows, "organism") : (totals.unique_organisms ?? null), "", ""],
    ];
    $("summaryGrid").innerHTML = cards.map(([label, value, note, className]) => `
      <article class="summary-card ${escapeHtml(className || "")}">
        <span>${escapeHtml(label)}</span>
        <strong>${formatCount(value)}</strong>
        ${note ? `<span>${escapeHtml(note)}</span>` : ""}
      </article>
    `).join("");
    renderEvidenceSummary(rows);
    const kcatRows = isLoaded ? metricCoverage(rows, "kcat") : coverage.with_kcat;
    const kmRows = isLoaded ? metricCoverage(rows, "km") : coverage.with_km;
    const efficiencyRows = isLoaded ? metricCoverage(rows, "kcat_over_km") : coverage.with_kcat_over_km;
    $("snapshotMeta").innerHTML = `
      <span class="snapshot-title">Rows with values</span>
      <span class="snapshot-line"><strong>${formatCount(kcatRows)}</strong><span>kcat</span></span>
      <span class="snapshot-line"><strong>${formatCount(kmRows)}</strong><span>Km</span></span>
      <span class="snapshot-line"><strong>${formatCount(efficiencyRows)}</strong><span>kcat/Km</span></span>
      ${manifest.generated_at ? `<span class="snapshot-date">Snapshot ${escapeHtml(formatDate(manifest.generated_at))}</span>` : ""}
    `;
  }

  function renderEvidenceSummary(rows) {
    const isLoaded = state.records.length > 0;
    const total = Math.max(1, rows.length || 0);
    const counts = Object.fromEntries(recordStates.map((item) => [item.value, 0]));
    rows.forEach((row) => {
      counts[row._recordState || recordStateForRow(row)] += 1;
    });
    $("evidenceSummary").innerHTML = `
      <div class="evidence-summary-title">Review status</div>
      <div class="evidence-segment-row">
        ${recordStates.map((item) => {
          const count = counts[item.value] || 0;
          const pct = rows.length ? ((count / total) * 100).toFixed(1) : "0.0";
          return `
            <div class="evidence-segment ${item.className}">
              <span class="evidence-dot ${item.className}"></span>
              <span>${escapeHtml(item.shortLabel)}</span>
              <div class="evidence-stat">
                <strong>${isLoaded ? formatInteger(count) : EMPTY_VALUE}</strong>
                <span>${isLoaded ? `${pct}%` : ""}</span>
              </div>
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
      && key !== "not_reported"
      && key !== EMPTY_VALUE;
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
      <details class="status-guide">
        <summary>Status definitions</summary>
        <div class="status-guide-body">
          ${recordStates.map((item) => `<p><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(stateDescriptions[item.value])}</p>`).join("")}
        </div>
      </details>
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

  function renderActiveFilterCount(filters) {
    const textFilterCount = [filters.q, filters.ec, filters.enzyme, filters.organism, filters.substrate]
      .filter(Boolean).length;
    const statusFilterCount = filters.recordStates.length === recordStates.length ? 0 : 1;
    const count = textFilterCount + statusFilterCount + filters.metrics.length;
    const badge = $("activeFilterCount");
    if (!badge) return;
    badge.textContent = count ? String(count) : "";
    badge.classList.toggle("hidden", count === 0);
    $("openFiltersButton")?.setAttribute("aria-label", count ? `Filters, ${count} active` : "Filters");
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
    renderActiveFilterCount(filters);
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
    const pageRows = currentPageRows();
    const range = pageRows.length
      ? `${formatInteger(start + 1)}–${formatInteger(Math.min(start + pageRows.length, state.filtered.length))} of ${formatInteger(state.filtered.length)}`
      : "";
    $("activeSummary").textContent = `${formatInteger(state.filtered.length)} records`;
    $("pageSummary").textContent = pageRows.length
      ? range
      : "No rows match the selected filters";
    $("pageLabel").textContent = pageRows.length
      ? range
      : "No records";
    $("prevButton").disabled = state.page <= 1;
    $("nextButton").disabled = state.page >= totalPages;
    $("downloadPageButton").disabled = !pageRows.length;
    $("recordsBody").innerHTML = pageRows.map((row) => `
      <tr data-key="${escapeHtml(row.record_key)}" class="${row.record_key === state.selectedKey ? "selected" : ""}" tabindex="0" aria-selected="${row.record_key === state.selectedKey ? "true" : "false"}">
        <td class="primary-cell">
          <strong>${escapePublic(row.enzyme_display_name || "Name not preserved")}</strong>
          <span>${escapePublic(sourceLabels[row.enzyme_label_source] || row.enzyme_label_source || row.source_db || "source")}</span>
        </td>
        <td>${escapeHtml(row.ec_number || EMPTY_VALUE)}</td>
        <td class="organism-cell">${escapePublic(row.organism || EMPTY_VALUE)}</td>
        <td class="substrate-cell">${escapePublic(row.substrate_name || EMPTY_VALUE)}</td>
        <td class="metric-cell"><strong>${metricDisplayHtml(row, "kcat")}</strong></td>
        <td class="metric-cell">${metricDisplayHtml(row, "km")}</td>
        <td class="metric-cell">${metricDisplayHtml(row, "kcat_over_km")}</td>
        <td>${escapeHtml(formatTemperature(row))}</td>
        <td>${escapeHtml(formatPh(row.ph))}</td>
        <td>${statusBadge(row)}</td>
        <td class="row-arrow" aria-hidden="true">&rsaquo;</td>
      </tr>
    `).join("");
    [...$("recordsBody").querySelectorAll("tr")].forEach((rowElement) => {
      rowElement.addEventListener("click", () => selectRecord(rowElement.dataset.key));
      rowElement.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        selectRecord(rowElement.dataset.key);
      });
    });
  }

  function setDetailOpen(isOpen) {
    document.body.classList.toggle("detail-open", Boolean(isOpen));
  }

  function focusAfterPanelTransition(id) {
    window.setTimeout(() => $(id)?.focus(), 180);
  }

  function setFiltersOpen(isOpen) {
    const shouldOpen = Boolean(isOpen) && narrowFilterMedia.matches;
    document.body.classList.toggle("filters-open", shouldOpen);
    $("openFiltersButton")?.setAttribute("aria-expanded", String(shouldOpen));
    const rail = $("catalogFilters");
    if (rail) {
      if (narrowFilterMedia.matches) rail.setAttribute("aria-hidden", String(!shouldOpen));
      else rail.removeAttribute("aria-hidden");
    }
    if (shouldOpen) {
      focusAfterPanelTransition("closeFiltersButton");
    }
  }

  function syncFilterPanel() {
    if (!narrowFilterMedia.matches) {
      document.body.classList.remove("filters-open");
      $("openFiltersButton")?.setAttribute("aria-expanded", "false");
      $("catalogFilters")?.removeAttribute("aria-hidden");
      return;
    }
    const isOpen = document.body.classList.contains("filters-open");
    $("catalogFilters")?.setAttribute("aria-hidden", String(!isOpen));
  }

  function resetDetail() {
    state.selectedKey = "";
    state.selectedDetail = null;
    $("detailContent").classList.add("hidden");
    $("detailEmpty").classList.remove("hidden");
    setDetailOpen(false);
  }

  function closeDetailAndRestoreFocus() {
    const selectedKey = state.selectedKey;
    resetDetail();
    renderRows();
    const selectedRow = [...$("recordsBody").querySelectorAll("tr[data-key]")]
      .find((row) => row.dataset.key === selectedKey);
    selectedRow?.focus();
  }

  function usesEmbeddedDetailPanel() {
    return window.matchMedia("(min-width: 1681px)").matches;
  }

  async function selectRecord(key) {
    const row = state.records.find((item) => item.record_key === key);
    if (!row) {
      resetDetail();
      renderRows();
      return;
    }
    state.selectedKey = key;
    setFiltersOpen(false);
    setDetailOpen(true);
    renderRows();
    $("detailEmpty").classList.add("hidden");
    $("detailContent").classList.remove("hidden");
    $("detailContent").innerHTML = '<p class="muted">Loading row details...</p>';
    try {
      state.selectedDetail = await detailForRow(row);
      if (state.selectedKey !== key) return;
      renderDetail(row, state.selectedDetail);
    } catch (error) {
      if (state.selectedKey !== key) return;
      $("detailContent").innerHTML = `
        <div class="detail-top">
          <button id="closeDetailButton" class="icon-button close-detail" type="button" aria-label="Close detail">&times;</button>
          <h2>${escapePublic(row.enzyme_display_name || "Name not preserved")}</h2>
          <p>${escapeHtml(row.ec_number || EMPTY_VALUE)} &middot; ${escapePublic(row.organism || EMPTY_VALUE)}</p>
        </div>
        <div class="detail-load-error" role="alert">
          <strong>Record details could not be loaded.</strong>
          <span>The summary row is still available in the table.</span>
        </div>
      `;
      $("closeDetailButton").addEventListener("click", closeDetailAndRestoreFocus);
      if (narrowFilterMedia.matches) focusAfterPanelTransition("closeDetailButton");
    }
  }

  function kv(label, value) {
    return `<div class="kv-line"><span>${escapePublic(label)}</span><strong>${escapePublic(compactValue(value))}</strong></div>`;
  }

  function doiLink(value) {
    const doi = String(value || "").trim();
    if (!doi) return EMPTY_VALUE;
    const href = doi.startsWith("http") ? doi : `https://doi.org/${encodeURI(doi)}`;
    return `<a class="reference-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer" aria-label="Open DOI ${escapeHtml(doi)}">${escapeHtml(doi)}</a>`;
  }

  function pmidLink(value) {
    const pmid = String(value || "").trim();
    if (!pmid) return EMPTY_VALUE;
    return `<a class="reference-link" href="https://pubmed.ncbi.nlm.nih.gov/${escapeHtml(pmid)}/" target="_blank" rel="noreferrer" aria-label="Open PubMed record ${escapeHtml(pmid)}">${escapeHtml(pmid)}</a>`;
  }

  function uniprotLink(value) {
    const accession = String(value || "").trim();
    if (!accession) return EMPTY_VALUE;
    return `<a class="reference-link" href="https://www.uniprot.org/uniprotkb/${encodeURIComponent(accession)}/entry" target="_blank" rel="noreferrer" aria-label="Open UniProt entry ${escapeHtml(accession)}">${escapeHtml(accession)}</a>`;
  }

  function referenceList(values, linkBuilder) {
    return `<div class="reference-list">${values.map((value) => linkBuilder(value)).join("")}</div>`;
  }

  function linkedKv(label, valueHtml) {
    return `<div class="kv-line"><span>${escapePublic(label)}</span><strong>${valueHtml}</strong></div>`;
  }

  function detailSection(title, rows) {
    const contentRows = rows.filter(Boolean);
    return `
      <section class="detail-section">
        <h3>${escapeHtml(title)}</h3>
        <div class="detail-kv">${contentRows.join("")}</div>
      </section>
    `;
  }

  function measurementSection(summary, detail) {
    const temperature = formatTemperature(summary);
    const metrics = [
      ["<i>k</i><sub>cat</sub>", metricDisplay(summary, "kcat")],
      ["<i>K</i><sub>m</sub>", metricDisplay(summary, "km")],
      ["<i>k</i><sub>cat</sub>/<i>K</i><sub>m</sub>", metricDisplay(summary, "kcat_over_km")],
    ];
    return `
      <section class="detail-section measurement-section">
        <h3>Kinetic measurement</h3>
        <div class="measurement-strip">
          ${metrics.map(([label, value]) => `
            <div class="measurement-value">
              <span>${label}</span>
              <strong>${scientificValueHtml(value)}</strong>
            </div>
          `).join("")}
        </div>
        <div class="detail-kv measurement-conditions">
          ${kv("Substrate", summary.substrate_name)}
          ${kv("Assay", metricDisplay(summary, "kcat") !== EMPTY_VALUE ? "steady-state kcat" : "kinetic measurement")}
          ${kv("Temperature", temperature === EMPTY_VALUE ? EMPTY_VALUE : `${temperature} °C`)}
          ${kv("pH", formatPh(summary.ph))}
          ${detail.assay_conditions_summary ? kv("Conditions", detail.assay_conditions_summary) : ""}
        </div>
      </section>
    `;
  }

  function molecularIdentitySection(summary, detail) {
    const uniprot = detail.uniprot_id || summary.primary_uniprot_id || "";
    const smiles = String(detail.smiles || "").trim();
    const sequence = String(detail.sequence || detail.canonical_sequence || "").trim();
    if (!uniprot && !smiles && !sequence) return "";
    return `
      <section class="detail-section identity-section">
        <h3>Molecular identity</h3>
        <div class="detail-kv">
          ${uniprot ? linkedKv("UniProt", uniprotLink(uniprot)) : ""}
          ${smiles ? `
            <div class="copy-field">
              <div class="copy-field-heading">
                <span>SMILES</span>
                <button class="copy-button" type="button" data-copy-target="detailSmiles">Copy</button>
              </div>
              <code id="detailSmiles">${escapeHtml(smiles)}</code>
            </div>
          ` : ""}
        </div>
        ${sequence ? `
          <details class="sequence-disclosure">
            <summary>Protein sequence <span>${formatInteger(sequence.length)} aa</span></summary>
            <div class="copy-field sequence-field">
              <div class="copy-field-heading">
                <span>Amino-acid sequence</span>
                <button class="copy-button" type="button" data-copy-target="detailSequence">Copy</button>
              </div>
              <code id="detailSequence">${escapeHtml(sequence)}</code>
            </div>
          </details>
        ` : ""}
      </section>
    `;
  }

  async function copyDetailValue(button) {
    const target = $(button.dataset.copyTarget);
    const value = target?.textContent || "";
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch (error) {
      const input = document.createElement("textarea");
      input.value = value;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    button.textContent = "Copied";
    window.setTimeout(() => { button.textContent = "Copy"; }, 1200);
  }

  function detailDisclosure(title, rows) {
    return `
      <details class="detail-disclosure">
        <summary>${escapeHtml(title)}</summary>
        <div class="detail-kv">${rows.filter(Boolean).join("")}</div>
      </details>
    `;
  }

  function renderDetail(summary, detail) {
    const pmids = Array.isArray(detail.supporting_pmids)
      ? detail.supporting_pmids.filter(Boolean)
      : (detail.pubmed_id ? [detail.pubmed_id] : []);
    const dois = Array.isArray(detail.supporting_dois)
      ? detail.supporting_dois.filter(Boolean)
      : (detail.doi ? [detail.doi] : []);
    const proofLines = Array.isArray(detail.proof_lines)
      ? detail.proof_lines.filter(Boolean)
      : (Array.isArray(detail.paper_mentions) ? detail.paper_mentions.filter(Boolean) : []);
    const firstPmid = pmids[0] || "";
    const firstDoi = dois[0] || "";
    const referenceRows = firstPmid || firstDoi
      ? [
          dois.length ? linkedKv(dois.length === 1 ? "DOI" : "DOIs", referenceList(dois, doiLink)) : "",
          pmids.length ? linkedKv(pmids.length === 1 ? "PubMed" : "PubMed IDs", referenceList(pmids, pmidLink)) : "",
        ]
      : [kv("Identifier", "Not available")];
    $("detailContent").innerHTML = `
      <div class="detail-top">
        <button id="closeDetailButton" class="icon-button close-detail" type="button" aria-label="Close detail">&times;</button>
        <h2>${escapePublic(summary.enzyme_display_name || "Name not preserved")}</h2>
        <p>${escapeHtml(summary.ec_number || EMPTY_VALUE)} &middot; ${escapePublic(summary.organism || EMPTY_VALUE)}</p>
        <div class="detail-status-line">
          ${statusBadge(summary)}
          <span class="evidence-source">${escapeHtml(evidenceLabel(summary))}</span>
        </div>
      </div>

      ${measurementSection(summary, detail)}
      ${molecularIdentitySection(summary, detail)}
      ${detailSection("Reference", referenceRows)}
      ${proofLines.length ? `
        <section class="detail-section evidence-note-section">
          <h3>Source evidence</h3>
          <div class="evidence-note-list">${evidenceNotesHtml(proofLines, 3)}</div>
        </section>
      ` : ""}
      ${detailDisclosure("Provenance", [
        kv("Source", summary.source_db || detail.source_db),
        kv("Source ID", summary.measurement_key || detail.measurement_key),
        kv("Source records", detail.source_record_count || summary.source_record_count),
        detail.source_databases_merged?.length ? kv("Databases", detail.source_databases_merged.join(", ")) : "",
        detail.data_origin ? kv("Data origin", detail.data_origin) : "",
        detail.verification_method ? kv("Review method", detail.verification_method) : "",
        kv("Protein identity", identityLabels[summary.identity_resolution_state] || summary.identity_resolution_state),
      ])}

      <div class="detail-actions">
        <button id="downloadSelectedJson" class="button secondary" type="button">Download record</button>
      </div>
    `;
    $("closeDetailButton").addEventListener("click", closeDetailAndRestoreFocus);
    document.querySelectorAll(".copy-button").forEach((button) => {
      button.addEventListener("click", () => copyDetailValue(button));
    });
    $("downloadSelectedJson").addEventListener("click", () => {
      const payload = { summary, detail };
      triggerBlobDownload(`${summary.record_key || "catlog-row"}.json`, JSON.stringify(payload, null, 2));
    });
    if (narrowFilterMedia.matches) focusAfterPanelTransition("closeDetailButton");
  }

  function clearFilters() {
    [
      "globalSearchInput",
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
    window.addEventListener("resize", () => {
      hideSuggestions();
      syncFilterPanel();
    });
    narrowFilterMedia.addEventListener?.("change", syncFilterPanel);
    $("statusChecklist").addEventListener("change", () => applyFilters());
    $("measurementChecklist").addEventListener("change", () => applyFilters());
    $("clearButton").addEventListener("click", clearFilters);
    $("openFiltersButton").addEventListener("click", () => setFiltersOpen(true));
    $("closeFiltersButton").addEventListener("click", () => {
      setFiltersOpen(false);
      $("openFiltersButton")?.focus();
    });
    $("filterBackdrop").addEventListener("click", () => setFiltersOpen(false));
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
    $("downloadPageButton").addEventListener("click", handlePageDownload);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.body.classList.contains("filters-open")) {
        const activeElement = document.activeElement;
        if (activeElement?.matches?.('input[type="search"]') && activeElement.value) return;
        setFiltersOpen(false);
        $("openFiltersButton")?.focus();
        return;
      }
      if (event.key === "Escape" && document.body.classList.contains("detail-open")) {
        closeDetailAndRestoreFocus();
        return;
      }
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
      syncFilterPanel();
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
