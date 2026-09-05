(function () {
  const appScript = document.currentScript;
  const catalogBaseUrl = appScript?.src
    ? new URL("../", appScript.src)
    : new URL(appScript?.dataset.catalogBase || "./", document.baseURI);
  const manifest = window.CATLOG_STATIC_MANIFEST || {};
  const assetVersion = String(manifest.asset_version || manifest.source_sha256 || manifest.generated_at || "20260709")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 16) || "20260709";
  const state = {
    records: [],
    filtered: [],
    page: 1,
    pageSize: 25,
    selectedKey: "",
    activeRowKey: "",
    selectedDetail: null,
    pageDownloadPending: false,
    recordChunksLoaded: 0,
    recordChunksTotal: 0,
    loadProgressUnit: "chunks",
    recordsReady: false,
    recordsGeneration: 0,
    sortCache: new Map(),
    filterRunId: 0,
    filterFailure: "",
    filterTimer: null,
    loadedScripts: new Set(),
    loadingScripts: new Map(),
    detailShardLru: new Map(),
    suggestionHideTimer: null,
    suggestionIndex: -1,
    suggestionInputId: "",
  };
  const EMPTY_VALUE = "—";
  const LOAD_RETRY_DELAYS = [2000, 5000, 10000];
  const SORT_RUN_SIZE = 4096;
  const SORT_CACHE_LIMIT = 2;
  const DETAIL_SHARD_CACHE_LIMIT = 8;
  const FILTER_FAILURE_MAX_LENGTH = 160;
  const narrowFilterMedia = window.matchMedia("(max-width: 1180px)");
  const DETAIL_INERT_SELECTOR = [
    ".app-header",
    "#catalogLoadProgress",
    "#searchSuggestions",
    "#catalogView > .snapshot-band",
    "#catalogFooter",
    ".workbench > :not(.detail-panel)",
  ].join(", ");

  const recordStates = [
    {
      value: "accepted",
      label: "Accepted",
      shortLabel: "Accepted",
      className: "accepted",
    },
    {
      value: "curation_pending",
      label: "Further checks",
      shortLabel: "Further checks",
      className: "review",
    },
    {
      value: "not_verified",
      label: "Unreviewed or excluded",
      shortLabel: "Other",
      className: "unresolved",
    },
  ];

  const stateDescriptions = {
    accepted: "The kinetic value and enzyme identity passed the required CatLog checks. Some accepted rows rely on source-database evidence rather than a paper.",
    curation_pending: "A specific check remains open, commonly the protein sequence, substrate structure, or match to the reported source.",
    not_verified: "Includes unreviewed rows, values calculated from other reported measurements, and disputed rows.",
  };

  const evidenceGroups = [
    {
      value: "paper_evidence",
      label: "Paper evidence",
      className: "paper",
      description: "Structured paper values with a saved table or measurement excerpt.",
    },
    {
      value: "source_note",
      label: "Source note",
      className: "note",
      description: "A plain source or database note, not a structured paper-value excerpt.",
    },
    {
      value: "literature_id",
      label: "Publication ID",
      className: "linked",
      description: "A publication identifier is linked, but no structured value excerpt is saved.",
    },
    {
      value: "source_records",
      label: "Source record",
      className: "source",
      description: "The public row is backed by its source-database record only.",
    },
  ];

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

  const sourceDatabaseLabels = {
    oed: "Open Enzyme Database (OED)",
    brenda: "BRENDA",
    sabio_rk: "SABIO-RK",
    sabio: "SABIO-RK",
    skid: "SKiD",
    uniprot: "UniProt",
  };

  function sourceDatabaseLabel(value) {
    const text = String(value || "").trim();
    const key = text.toLowerCase().replace(/[\s-]+/g, "_");
    return sourceDatabaseLabels[key] || text || EMPTY_VALUE;
  }

  const identityLabels = {
    accession_resolved: "Accession resolved",
    sequence_resolved_no_accession: "Sequence resolved; accession unavailable",
    candidate_pool: "Candidate match",
    identity_unresolved: "Unresolved",
  };

  const identityOnlyTrustNote = "Sequence and identity were verified; the kinetic value has no literature reference in CatLog.";

  const conditionFlagLabels = {
    kcat_over_km_quotient_mismatch: "Reported kcat/Km differs from kcat ÷ Km",
    kcat_over_km_unit_mismatch: "kcat/Km unit mismatch (×1000 class)",
    km_magnitude_needs_check: "Km above 10 M — check units",
    kcat_magnitude_needs_check: "kcat above 10⁷ s⁻¹ — check units",
    efficiency_above_diffusion_limit: "kcat/Km above the diffusion limit",
    temperature_value_needs_check: "Temperature value needs check",
    temperature_unit_needs_check: "Temperature unit needs check",
    temperature_invalid: "Temperature value is not usable",
    temperature_zero_celsius_needs_check: "Temperature recorded as exactly 0 °C — check source",
    ph_outside_0_14: "pH outside 0–14",
    ph_invalid: "pH value is not usable",
    unit_not_recorded: "Unit not recorded",
    unit_not_recorded_kcat: "kcat unit not recorded",
    unit_not_recorded_km: "Km unit not recorded",
    unit_not_recorded_kcat_over_km: "kcat/Km unit not recorded",
    unit_not_recorded_ki: "Ki unit not recorded",
  };

  // Flags that question the value itself; each is surfaced beside the metric it concerns.
  const valueIntegrityFlags = {
    kcat_over_km_quotient_mismatch: { field: "kcat_over_km", short: "values differ" },
    kcat_over_km_unit_mismatch: { field: "kcat_over_km", short: "unit mismatch" },
    efficiency_above_diffusion_limit: { field: "kcat_over_km", short: "above limit" },
    km_magnitude_needs_check: { field: "km", short: "check units" },
    kcat_magnitude_needs_check: { field: "kcat", short: "check units" },
  };

  function conditionFlags(...rows) {
    const flags = new Set();
    rows.forEach((row) => {
      (Array.isArray(row?.condition_flags) ? row.condition_flags : []).forEach((flag) => {
        const key = String(flag || "").trim();
        if (key) flags.add(key);
      });
    });
    if (
      flags.has("kcat_over_km_quotient_mismatch")
      && rows.some((row) => efficiencyMatchesReportedPrecision(row))
    ) {
      flags.delete("kcat_over_km_quotient_mismatch");
    }
    return flags;
  }

  function conditionFlagLabel(flag) {
    if (conditionFlagLabels[flag]) return conditionFlagLabels[flag];
    if (String(flag || "").startsWith("unit_not_recorded")) return conditionFlagLabels.unit_not_recorded;
    const text = String(flag || "").replace(/_/g, " ").trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
  }

  function valueFlagBadgeHtml(flags, field) {
    const matched = [...flags].filter((flag) => valueIntegrityFlags[flag]?.field === field);
    if (!matched.length) return "";
    const labels = [...new Set(matched.map(conditionFlagLabel).filter(Boolean))];
    const shortText = [...new Set(matched.map((flag) => valueIntegrityFlags[flag].short))].join(" · ");
    const summary = `Check against source: ${labels.join("; ")}`;
    return `<span class="value-flag" role="img" title="${escapeHtml(summary)}" aria-label="${escapeHtml(summary)}">${escapeHtml(shortText)}</span>`;
  }

  function conditionFlagsHtml(flags) {
    const labels = [...new Set([...flags].map(conditionFlagLabel).filter(Boolean))];
    if (!labels.length) return "";
    return `<div class="kv-line condition-flag-line"><span>Check against source</span><ul class="condition-flag-list">${labels.map((label) => `<li>${escapeHtml(label)}</li>`).join("")}</ul></div>`;
  }

  // The exporter replaces internal file references with this marker; a string that still
  // carries it is not fit to show, so the viewer renders nothing for it.
  const INTERNAL_REFERENCE_PLACEHOLDER = "[internal reference removed]";

  function hasInternalPlaceholder(value) {
    return typeof value === "string" && value.includes(INTERNAL_REFERENCE_PLACEHOLDER);
  }

  function publicEvidenceString(value) {
    if (value === null || value === undefined) return "";
    return hasInternalPlaceholder(value) ? "" : value;
  }

  const CURATION_LICENSE_NOTE = "For reuse of CatLog review notes and corrections, contact the Chowdhury Lab.";

  const fallbackSourceDatabases = [
    { key: "brenda", name: "BRENDA", license: "CC BY 4.0", citation_url: "https://www.brenda-enzymes.org/" },
    { key: "sabio_rk", name: "SABIO-RK", license: "", citation_url: "https://sabiork.h-its.org/" },
    { key: "skid", name: "SKiD", license: "CC BY-NC-ND 4.0", citation_url: "" },
    { key: "oed", name: "Open Enzyme Database (OED)", license: "", citation_url: "" },
    { key: "uniprot", name: "UniProt", license: "CC BY 4.0", citation_url: "https://www.uniprot.org/" },
  ];
  const displayedSourceDatabaseKeys = new Set([
    "brenda",
    "oed",
    "uniprot",
    "sabio_rk",
    "skid",
    "primary_paper_direct",
    "strenda",
  ]);

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

  function viewFromLocation() {
    return window.location.hash === "#guide" ? "guide" : "browse";
  }

  function renderView(view, { scroll = false } = {}) {
    const guideOpen = view === "guide";
    $("catalogView").hidden = guideOpen;
    $("guideView").hidden = !guideOpen;
    document.body.classList.toggle("guide-open", guideOpen);
    $("browseButton").classList.toggle("active", !guideOpen);
    $("guideButton").classList.toggle("active", guideOpen);
    $("browseButton").setAttribute("aria-current", guideOpen ? "false" : "page");
    $("guideButton").setAttribute("aria-current", guideOpen ? "page" : "false");
    document.title = guideOpen
      ? "Guide | CatLog"
      : "CatLog | Enzyme Kinetics Catalog";
    if (guideOpen) {
      setFiltersOpen(false);
      resetDetail();
      hideSuggestions();
    } else {
      window.requestAnimationFrame(updateTableScrollControls);
    }
    if (scroll) {
      window.scrollTo({
        top: 0,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    }
  }

  function navigateTo(view) {
    const targetHash = view === "guide" ? "#guide" : "";
    if (window.location.hash !== targetHash) {
      const url = new URL(window.location.href);
      url.hash = targetHash;
      window.history.pushState({ catlogView: view }, "", url);
    }
    renderView(view, { scroll: true });
  }

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
      .replace(/\bverified\s+or\s+corrected\b/gi, "accepted or updated")
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

  function formatFileSize(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return "";
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function shortHash(value) {
    return String(value || "").trim().slice(0, 10) || EMPTY_VALUE;
  }

  function renderDownloadMetadata() {
    const total = formatCount(manifest.total_rows || 0);
    const enrichedSize = formatFileSize(manifest.enriched_download?.size_bytes);
    const tableSize = formatFileSize(manifest.table_download?.size_bytes);
    if ($("enrichedDataDescription")) {
      $("enrichedDataDescription").textContent = [
        `${total} rows`,
        "available sequences, SMILES, references, and source details",
        enrichedSize,
      ].filter(Boolean).join(" · ");
    }
    if ($("tableIndexDescription")) {
      $("tableIndexDescription").textContent = [
        `${total} rows`,
        "without protein or structure strings",
        tableSize,
      ].filter(Boolean).join(" · ");
    }
    if ($("datasetNotesLink")) {
      $("datasetNotesLink").href = new URL("README_FIRST.txt", catalogBaseUrl).href;
    }
    const snapshotDate = manifest.generated_at ? formatDate(manifest.generated_at) : EMPTY_VALUE;
    const sourceId = shortHash(manifest.content_sha256 || manifest.source_sha256);
    const exportId = shortHash(manifest.exporter_commit);
    if ($("guideSnapshotDate")) $("guideSnapshotDate").textContent = snapshotDate;
    if ($("guideSourceId")) {
      $("guideSourceId").textContent = sourceId;
      $("guideSourceId").title = manifest.content_sha256 || manifest.source_sha256 || "";
    }
    if ($("guideExportId")) {
      $("guideExportId").textContent = exportId;
      $("guideExportId").title = manifest.exporter_commit || "";
    }
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
    if (typeof value !== "object") return publicEvidenceString(String(value));
    const raw = [
      value.table_label,
      value.row_label,
      value.column_label,
      value.raw_value_unit_evidence,
      value.normalized_value_unit_evidence,
    ].filter(Boolean);
    const parts = raw.map(publicEvidenceString).filter(Boolean);
    if (parts.length) return parts.join(" | ");
    return raw.length ? "" : "Evidence details unavailable";
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
      const text = publicEvidenceString(String(value));
      return text ? `<p class="evidence-note-plain">${escapePublic(text)}</p>` : "";
    }

    const location = [value.table_label, value.row_label].map(publicEvidenceString).filter(Boolean).join(" · ");
    const reported = publicEvidenceString(value.raw_value_unit_evidence
      || (!value.normalized_value_unit_evidence ? value.column_label : ""));
    const normalized = publicEvidenceString(value.normalized_value_unit_evidence);
    const rows = [
      location ? ["Location", location] : null,
      reported ? ["Reported", cleanEvidenceValue(reported)] : null,
      normalized ? ["Normalized", cleanEvidenceValue(normalized)] : null,
    ].filter(Boolean);

    if (!rows.length) {
      const fallback = evidenceText(value);
      return fallback ? `<p class="evidence-note-plain">${escapePublic(fallback)}</p>` : "";
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
    const items = Array.isArray(values) ? values.filter(Boolean) : [];
    return items.map(evidenceNoteHtml).filter(Boolean).slice(0, limit).join("");
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

  const UNIT_NOT_RECORDED_LABEL = "unit not recorded";
  const UNIT_NOT_RECORDED_NOTE = "The source did not record a unit for this value, so the column unit does not apply.";

  const canonicalMetricUnitKeys = {
    kcat: new Set(["s-1"]),
    km: new Set(["mm"]),
    kcat_over_km: new Set(["s-1mm-1", "mm-1s-1"]),
  };

  function normalizedUnitKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\u2212/g, "-")
      .replace(/liters?/g, "l")
      .replace(/[\s()*^\u00b7]/g, "");
  }

  function reportedInterval(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const text = String(value).trim().toLowerCase();
    const [mantissa, exponentText] = text.split("e", 2);
    const exponent = exponentText === undefined ? 0 : Number(exponentText);
    if (!Number.isInteger(exponent)) return null;
    const decimalPlaces = mantissa.includes(".") ? mantissa.split(".", 2)[1].length : 0;
    const halfStep = 0.5 * (10 ** (exponent - decimalPlaces));
    if (!Number.isFinite(halfStep)) return null;
    return [numeric - halfStep, numeric + halfStep];
  }

  function efficiencyMatchesReportedPrecision(row) {
    if (!row) return false;
    const fields = ["kcat", "km", "kcat_over_km"];
    if (!fields.every((field) => canonicalMetricUnitKeys[field].has(normalizedUnitKey(metricUnit(row, field))))) {
      return false;
    }
    const intervals = fields.map((field) => reportedInterval(row[field]));
    if (intervals.some((interval) => interval === null)) return false;
    const [[kcatLow, kcatHigh], [kmLow, kmHigh], [ratioLow, ratioHigh]] = intervals;
    if (kcatHigh <= 0 || kmHigh <= 0 || ratioHigh <= 0) return false;
    const computedLow = Math.max(kcatLow, 0) / kmHigh;
    const computedHigh = kmLow > 0 ? kcatHigh / kmLow : Number.POSITIVE_INFINITY;
    return Math.max(ratioLow, 0) <= computedHigh && computedLow <= ratioHigh;
  }

  function metricUnit(row, field) {
    return String(row[`${field}_unit`] || "").trim();
  }

  function metricHasValue(row, field) {
    return metricDisplay(row, field) !== EMPTY_VALUE;
  }

  function metricUnitMissing(row, field, flags = conditionFlags(row)) {
    if (!metricHasValue(row, field)) return false;
    return !metricUnit(row, field) || flags.has(`unit_not_recorded_${field}`);
  }

  function unitMissingHtml() {
    return `<small class="metric-unit-missing" title="${escapeHtml(UNIT_NOT_RECORDED_NOTE)}">${escapeHtml(UNIT_NOT_RECORDED_LABEL)}</small>`;
  }

  function unitHtml(value) {
    return escapeHtml(value)
      .replace(/\^?\(-1\)|\^-1/g, "<sup>-1</sup>")
      .replace(/\*/g, " ");
  }

  function metricUnitHtml(row, field) {
    if (!metricHasValue(row, field) || metricUnitMissing(row, field)) return "";
    return unitHtml(metricUnit(row, field));
  }

  function metricDisplayWithUnitHtml(row, field) {
    const display = metricDisplay(row, field);
    const displayHtml = scientificValueHtml(display);
    if (display === EMPTY_VALUE) return displayHtml;
    if (metricUnitMissing(row, field)) return `${displayHtml}${unitMissingHtml()}`;
    const storedUnit = metricUnit(row, field);
    if (canonicalMetricUnitKeys[field]?.has(normalizedUnitKey(storedUnit))) {
      return displayHtml;
    }
    return `${displayHtml}<small class="metric-inline-unit">${unitHtml(storedUnit)}</small>`;
  }

  function efficiencyOriginHtml(row) {
    return row.kcat_over_km_origin === "calculated"
      ? '<small class="metric-origin">calculated</small>'
      : "";
  }

  function mutationSignature(row) {
    const signature = String(row?.mutation_signature || "").trim();
    const key = signature.toLowerCase().replace(/[\s_-]+/g, "");
    if (!signature || ["unknown", "wt", "wildtype", "none", "na", "n/a"].includes(key)) return "";
    return signature;
  }

  function enzymeFormLabel(row, { showUnknown = false } = {}) {
    const signature = mutationSignature(row);
    if (signature) return `Variant: ${signature}`;
    const mutationType = String(row?.mutation_type || "").trim().toLowerCase();
    const variantStatus = String(row?.sequence_variant_status || "").trim().toLowerCase();
    const isVariant = row?.wild_type === false
      || /variant|mutant|mutation/.test(mutationType)
      || /variant|mutation/.test(variantStatus);
    if (isVariant) return "Variant (unspecified)";
    const isWildType = row?.wild_type === true
      || /wild[ _-]?type/.test(mutationType)
      || /wild[ _-]?type/.test(variantStatus);
    if (isWildType) return "Wild type";
    return showUnknown ? "Not recorded" : "";
  }

  function enzymeFormHtml(row) {
    const label = enzymeFormLabel(row);
    if (!label || label === "Wild type") return "";
    return `<span class="enzyme-form" title="Measured enzyme form">${escapePublic(label)}</span>`;
  }

  function formatTemperature(row) {
    const display = row.temperature_display;
    if (hasDisplayValue(display)) return display;
    if (row.temperature_k == null || row.temperature_k === "") return EMPTY_VALUE;
    const kelvin = Number(row.temperature_k);
    if (!Number.isFinite(kelvin) || kelvin <= 170 || kelvin > 1000) return EMPTY_VALUE;
    return formatNumber(kelvin - 273.15, { maximumFractionDigits: 1 });
  }

  function formatPh(row) {
    const value = row.ph_display;
    if (value == null || value === "") return EMPTY_VALUE;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 14) return EMPTY_VALUE;
    return formatNumber(number, { maximumFractionDigits: 1 });
  }

  function stateConfig(value) {
    return recordStates.find((item) => item.value === value) || recordStates[2];
  }

  function recordStateForRow(row) {
    const status = row.verification_status;
    if (status === "verified" || status === "corrected") return "accepted";
    if (status === "manual_review_required") return "curation_pending";
    return "not_verified";
  }

  function manifestDistribution(key) {
    const rows = (((manifest.summary || {}).distributions || {})[key] || []);
    return Object.fromEntries(rows.map((row) => [row.label, Number(row.count || 0)]));
  }

  function recordStateCounts(rows) {
    const counts = Object.fromEntries(recordStates.map((item) => [item.value, 0]));
    if (!state.recordsReady) {
      const statuses = manifestDistribution("verification_status");
      counts.accepted = (statuses.verified || 0) + (statuses.corrected || 0);
      counts.curation_pending = statuses.manual_review_required || 0;
      counts.not_verified = Object.entries(statuses).reduce(
        (total, [status, count]) => total + (["verified", "corrected", "manual_review_required"].includes(status) ? 0 : count),
        0,
      );
      return counts;
    }
    rows.forEach((row) => {
      counts[row._recordState || recordStateForRow(row)] += 1;
    });
    return counts;
  }

  function evidenceGroupForRow(row) {
    if (row.proof_kind === "paper_evidence" || row.has_proof_excerpt) return "paper_evidence";
    if (row.proof_kind === "source_note") return "source_note";
    if (row.has_literature_id) return "literature_id";
    return "source_records";
  }

  function evidenceGroupCounts(rows) {
    const counts = Object.fromEntries(evidenceGroups.map((item) => [item.value, 0]));
    if (!state.recordsReady) {
      const publicEvidence = manifestDistribution("public_evidence_group");
      counts.paper_evidence = publicEvidence.paper_excerpt || 0;
      counts.source_note = publicEvidence.source_note || 0;
      counts.literature_id = publicEvidence.paper_id || 0;
      counts.source_records = publicEvidence.database_record || 0;
      return counts;
    }
    rows.forEach((row) => {
      counts[evidenceGroupForRow(row)] += 1;
    });
    return counts;
  }

  function evidenceLabel(row, proofLines = []) {
    if (row.proof_kind === "paper_evidence" || row.has_proof_excerpt) return "Saved paper evidence";
    if (row.proof_kind === "source_note" || proofLines.length) return "Source note";
    if (row.evidence_confidence_tier === "cross_source_supported") {
      return "Cross-source match";
    }
    return row.has_literature_id ? "Reference available" : "Source record";
  }

  function sourceLicense(summary, detail) {
    return detail.source_license || summary.source_license;
  }

  function isIdentityOnlyAccepted(row) {
    return (row._recordState || recordStateForRow(row)) === "accepted"
      && String(row.public_trust_basis || "").trim() === "identity_only";
  }

  function reviewOutcomeBase(summary) {
    switch (summary.verification_status) {
      case "corrected":
        return "Accepted after a recorded correction.";
      case "verified":
        return "Accepted as reported.";
      case "manual_review_required":
        return "One or more required checks are still open.";
      case "mathematically_inferred":
        return "Calculated from reported values rather than stated directly in the source.";
      case "disputed":
        return "Conflicting source values; no single value has been accepted.";
      default:
        return "Not reviewed or outside the accepted set.";
    }
  }

  function reviewOutcome(summary) {
    const outcome = reviewOutcomeBase(summary);
    return isIdentityOnlyAccepted(summary) ? `${outcome} ${identityOnlyTrustNote}` : outcome;
  }

  function rowStatusLabel(row) {
    if (row.verification_status === "disputed") return "Disputed";
    if (row.verification_status === "mathematically_inferred") return "Calculated";
    if (row.verification_status === "unverified") return "Not reviewed";
    if (isIdentityOnlyAccepted(row)) return "Accepted (identity only)";
    if (row.verification_status === "corrected") return "Accepted";
    if (row.verification_status === "verified") return "Accepted";
    if (row.verification_status === "manual_review_required") return "Further checks";
    return stateConfig(row._recordState || recordStateForRow(row)).shortLabel;
  }

  function statusBadge(row) {
    const config = stateConfig(row._recordState || recordStateForRow(row));
    const isDisputed = row.verification_status === "disputed";
    const isCorrected = row.verification_status === "corrected";
    const identityOnly = isIdentityOnlyAccepted(row);
    const description = isDisputed
      ? "Conflicting source values; no single value has been accepted."
      : (identityOnly
          ? identityOnlyTrustNote
          : (isCorrected
              ? "Accepted after a recorded correction."
              : (stateDescriptions[config.value] || config.label)));
    const label = rowStatusLabel(row);
    const visibleLabel = identityOnly ? "Accepted" : label;
    const qualifierText = identityOnly
      ? `(${isCorrected ? "corrected, identity only" : "identity only"})`
      : (isCorrected ? "corrected" : "");
    const qualifier = qualifierText ? `<small>${escapeHtml(qualifierText)}</small>` : "";
    const className = `${isDisputed ? "disputed" : config.className}${identityOnly ? " identity-only" : ""}`;
    return `<span class="state-badge ${className}" title="${escapeHtml(description)}" aria-label="${escapeHtml(`${label}. ${description}`)}"><span class="state-badge-copy">${escapeHtml(visibleLabel)}${qualifier}</span></span>`;
  }

  function versionedAssetUrl(src, retryAttempt = 0) {
    if (!src || /^(?:https?:)?\/\//.test(src) || src.startsWith("data:")) return src;
    const url = new URL(src, catalogBaseUrl);
    url.searchParams.set("v", assetVersion);
    if (retryAttempt > 0) url.searchParams.set("retry", String(retryAttempt));
    return url.href;
  }

  function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function loadScriptAttempt(src, ordered, retryAttempt) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = versionedAssetUrl(src, retryAttempt);
      script.async = !ordered;
      script.onload = () => {
        script.remove();
        resolve();
      };
      script.onerror = () => {
        script.remove();
        reject(new Error(`Could not load ${src}`));
      };
      document.body.appendChild(script);
    });
  }

  function loadScript(src, ordered = false, { onRetry = null } = {}) {
    if (state.loadedScripts.has(src)) return Promise.resolve();
    if (state.loadingScripts.has(src)) return state.loadingScripts.get(src);
    const pending = (async () => {
      let lastError = null;
      for (let attempt = 0; attempt <= LOAD_RETRY_DELAYS.length; attempt += 1) {
        try {
          await loadScriptAttempt(src, ordered, attempt);
          state.loadedScripts.add(src);
          return;
        } catch (error) {
          lastError = error;
          if (attempt >= LOAD_RETRY_DELAYS.length) break;
          if (typeof onRetry === "function") onRetry(attempt + 1, LOAD_RETRY_DELAYS[attempt]);
          await wait(LOAD_RETRY_DELAYS[attempt]);
        }
      }
      throw lastError || new Error(`Could not load ${src}`);
    })().finally(() => {
      state.loadingScripts.delete(src);
    });
    state.loadingScripts.set(src, pending);
    return pending;
  }

  function retainDetailShard(src) {
    const shards = window.CATLOG_DETAIL_SHARDS || {};
    if (!src || !Object.prototype.hasOwnProperty.call(shards, src)) return;
    state.detailShardLru.delete(src);
    state.detailShardLru.set(src, true);
    while (state.detailShardLru.size > DETAIL_SHARD_CACHE_LIMIT) {
      const oldest = state.detailShardLru.keys().next().value;
      state.detailShardLru.delete(oldest);
      delete shards[oldest];
      state.loadedScripts.delete(oldest);
    }
  }

  function indexLoadedRecords(records = null) {
    state.sortCache.forEach((entry) => {
      entry.cancelled = true;
    });
    state.records = records || (window.CATLOG_RECORD_CHUNKS || []).flat();
    state.recordsGeneration += 1;
    state.filterRunId += 1;
    state.sortCache.clear();
    state.records.forEach((row, index) => {
      row._loadIndex = index;
      row._recordState = recordStateForRow(row);
      row._stateRank = recordStates.findIndex((item) => item.value === row._recordState);
      row._tierRank = tierOrder[row.evidence_confidence_tier] ?? 99;
      row._sourceCount = Number(row.source_record_count || 0);
      row._ecSort = String(row.ec_number || "").split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : Number.MAX_SAFE_INTEGER));
      row._sortEnzyme = String(row.enzyme_display_name || "");
      row._sortOrganism = String(row.organism || "");
      row._sortSubstrate = String(row.substrate_name || "");
      row._search = row._search || String(row._search_text || [
        row.measurement_key,
        row.review_key,
        row.ec_number,
        row.enzyme_display_name,
        row.organism,
        row.substrate_name,
        row.mutation_signature,
        row.source_db,
        row.primary_uniprot_id,
        row.protein_accession,
      ].join(" ")).toLowerCase();
    });
  }

  function updateLoadProgress() {
    const total = Math.max(1, state.recordChunksTotal);
    const progress = state.recordsReady
      ? 100
      : Math.min(100, Math.round((state.recordChunksLoaded / total) * 100));
    const rail = $("catalogLoadProgress");
    if (!rail) return;
    rail.style.setProperty("--load-progress", String(progress / 100));
    rail.setAttribute("aria-valuenow", String(progress));
    rail.setAttribute(
      "aria-valuetext",
      state.recordsReady
        ? "CatLog ready"
        : `${formatInteger(state.recordChunksLoaded)} of ${formatInteger(state.recordChunksTotal)} ${state.loadProgressUnit === "records" ? "CatLog records" : "data chunks"} loaded`,
    );
    rail.classList.toggle("complete", state.recordsReady);
    if (state.recordChunksLoaded || state.recordsReady) rail.classList.remove("stalled");
  }

  function recordIndexPath() {
    return manifest.viewer_index?.path || manifest.table_download?.path || "";
  }

  function canStreamCompressedIndex() {
    return window.location.protocol !== "file:"
      && Boolean(recordIndexPath())
      && typeof window.DecompressionStream === "function";
  }

  // requestAnimationFrame never fires in a hidden tab, so the loader must not wait on it.
  // While the document is hidden there is nothing to paint, so the loop continues without a pause.
  function yieldToBrowser() {
    if (document.hidden) return Promise.resolve();
    if (window.scheduler && typeof window.scheduler.yield === "function") {
      return window.scheduler.yield();
    }
    if (typeof window.MessageChannel === "function") {
      return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          channel.port1.close();
          resolve();
        };
        channel.port2.postMessage(null);
      });
    }
    return new Promise((resolve) => window.setTimeout(resolve, 0));
  }

  function showLoadNotice(title, message, { actionLabel = "", onAction = null } = {}) {
    const body = $("recordsBody");
    if (body) {
      body.innerHTML = `
        <tr class="loading-row notice-row">
          <td colspan="11">
            <div class="load-notice" role="alert">
              <strong>${escapeHtml(title)}</strong>
              <span>${escapeHtml(message)}</span>
              ${actionLabel ? `<button id="loadNoticeAction" class="button secondary" type="button">${escapeHtml(actionLabel)}</button>` : ""}
            </div>
          </td>
        </tr>
      `;
    }
    $("activeSummary").textContent = title;
    $("pageSummary").textContent = message;
    $("pageLabel").textContent = "No records";
    $("prevButton").disabled = true;
    $("nextButton").disabled = true;
    $("downloadPageButton").disabled = true;
    const rail = $("catalogLoadProgress");
    if (rail) {
      rail.classList.add("stalled");
      rail.setAttribute("aria-valuetext", `${title}. ${message}`);
    }
    const action = $("loadNoticeAction");
    if (action && typeof onAction === "function") {
      action.addEventListener("click", () => {
        action.disabled = true;
        action.textContent = "Trying again...";
        onAction();
      }, { once: true });
    }
  }

  async function streamCompressedRecordIndexAttempt(retryAttempt = 0) {
    const tablePath = recordIndexPath();
    if (!canStreamCompressedIndex()) return null;

    const response = await fetch(versionedAssetUrl(tablePath, retryAttempt));
    if (!response.ok || !response.body) {
      throw new Error(`The table data could not be downloaded (HTTP ${response.status || "error"})`);
    }

    const totalRows = Number(manifest.total_rows || 0);
    const detailsPerShard = Math.max(1, Number(manifest.details_per_shard || 1000));
    const detailShards = Array.isArray(manifest.detail_shards) ? manifest.detail_shards : [];
    const reader = response.body
      .pipeThrough(new DecompressionStream("gzip"))
      .getReader();
    const decoder = new TextDecoder();
    const records = [];
    let buffer = "";
    let lastProgress = 0;

    state.loadProgressUnit = "records";
    state.recordChunksLoaded = 0;
    state.recordChunksTotal = totalRows || 1;
    updateLoadProgress();

    const consumeLines = (final = false) => {
      const lines = buffer.split("\n");
      buffer = final ? "" : (lines.pop() || "");
      lines.forEach((line) => {
        if (!line.trim()) return;
        const row = JSON.parse(line);
        row.detail_shard = detailShards[Math.floor(records.length / detailsPerShard)] || "";
        records.push(row);
      });
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      consumeLines();
      if (records.length - lastProgress >= 2500) {
        state.recordChunksLoaded = records.length;
        lastProgress = records.length;
        updateLoadProgress();
        await yieldToBrowser();
      }
    }
    buffer += decoder.decode();
    consumeLines(true);

    if (totalRows && records.length !== totalRows) {
      throw new Error(`Expected ${totalRows} CatLog rows, received ${records.length}`);
    }
    state.recordChunksLoaded = records.length;
    return records;
  }

  async function streamCompressedRecordIndex() {
    let lastError = null;
    for (let attempt = 0; attempt <= LOAD_RETRY_DELAYS.length; attempt += 1) {
      try {
        return await streamCompressedRecordIndexAttempt(attempt);
      } catch (error) {
        lastError = error;
        if (attempt >= LOAD_RETRY_DELAYS.length) break;
        const delaySeconds = Math.round(LOAD_RETRY_DELAYS[attempt] / 1000);
        showLoadNotice(
          "CatLog is updating",
          `The table index is not ready yet. Trying again in ${delaySeconds} seconds.`,
        );
        await wait(LOAD_RETRY_DELAYS[attempt]);
      }
    }
    throw lastError || new Error("The table data could not be downloaded");
  }

  function reloadCatalogPage() {
    const url = new URL(window.location.href);
    url.searchParams.set("retry", String(Date.now()));
    window.location.replace(url.href);
  }

  async function loadRecordChunks() {
    const chunks = Array.isArray(manifest.record_chunks) ? manifest.record_chunks : [];
    let streamedRecords = null;
    let streamError = null;
    try {
      streamedRecords = await streamCompressedRecordIndex();
    } catch (error) {
      streamedRecords = null;
      streamError = error;
    }
    if (streamedRecords) {
      indexLoadedRecords(streamedRecords);
      state.recordsReady = true;
      updateLoadProgress();
      setupFilters();
      await ensureCurrentFiltersAndSelectFirst();
      updateTableScrollControls();
      return;
    }

    state.loadProgressUnit = "chunks";
    state.recordChunksLoaded = 0;
    state.recordChunksTotal = chunks.length;
    updateLoadProgress();

    if (!chunks.length) {
      if (!Number(manifest.total_rows || 0)) {
        state.recordsReady = true;
        updateLoadProgress();
        setupFilters();
        await ensureCurrentFilters();
        return;
      }
      // A web-only bundle ships no records-*.js; without the streamed index there is nothing to show.
      if (!canStreamCompressedIndex()) {
        if (window.location.protocol === "file:") {
          showLoadNotice(
            "This copy needs a web server",
            "Open the hosted CatLog site, or use the offline snapshot to browse from disk.",
          );
        } else {
          showLoadNotice(
            "This browser cannot open the CatLog index",
            "Use a current version of Safari, Chrome, Edge, or Firefox, or download the table index.",
          );
        }
      } else {
        showLoadNotice(
          "CatLog records are temporarily unavailable",
          `${streamError?.message || "The table data could not be downloaded"}.`,
          { actionLabel: "Try again", onAction: reloadCatalogPage },
        );
      }
      return;
    }

    await loadScript(chunks[0], true);
    state.recordChunksLoaded = 1;
    indexLoadedRecords();
    updateLoadProgress();
    setupFilters();
    await ensureCurrentFilters();
    updateTableScrollControls();

    for (let index = 1; index < chunks.length; index += 3) {
      const batch = chunks.slice(index, index + 3);
      await Promise.all(batch.map((chunk) => loadScript(chunk, true)));
      state.recordChunksLoaded += batch.length;
      updateLoadProgress();
      await yieldToBrowser();
    }

    indexLoadedRecords();
    state.recordsReady = true;
    updateLoadProgress();
    setupFilters();
    await ensureCurrentFiltersAndSelectFirst({ resetPage: false });
    updateTableScrollControls();
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
      _stateRank,
      _tierRank,
      _sourceCount,
      _loadIndex,
      _ecSort,
      _sortEnzyme,
      _sortOrganism,
      _sortSubstrate,
      _search,
      _search_text,
      next_best_action,
      next_best_action_reason,
      status_conflict_warning,
      anomaly_count,
      ...record
    } = row;
    return record;
  }

  function currentPageRows() {
    const start = (state.page - 1) * state.pageSize;
    return state.filtered.slice(start, start + state.pageSize);
  }

  async function detailForRow(row, { onRetry = null } = {}) {
    await loadScript(row.detail_shard, false, { onRetry });
    const shard = (window.CATLOG_DETAIL_SHARDS || {})[row.detail_shard] || {};
    retainDetailShard(row.detail_shard);
    const detail = shard[row.record_key];
    if (!detail || typeof detail !== "object") {
      state.loadedScripts.delete(row.detail_shard);
      throw new Error(`Detail shard ${row.detail_shard} does not contain ${row.record_key}`);
    }
    return detail;
  }

  async function handlePageDownload() {
    const button = $("downloadPageButton");
    const originalTitle = button?.title || "";
    const rows = currentPageRows();
    if (!rows.length || state.pageDownloadPending || button?.disabled) return;
    const page = state.page;
    state.pageDownloadPending = true;
    if (button) {
      button.disabled = true;
      button.textContent = "Preparing...";
    }
    let failed = false;
    try {
      const details = await Promise.all(rows.map(detailForRow));
      const records = rows.map((row, index) => publicSummaryRecord({
        ...details[index],
        ...row,
      }));
      const payload = {
        metadata: {
          name: "CatLog page export",
          generated_at: new Date().toISOString(),
          snapshot_generated_at: manifest.generated_at || null,
          source_sha256: manifest.source_sha256 || null,
          export_scope: "current_page_public_records",
          page,
          row_count: records.length,
          note: "Raw internal source-record payloads are not included in the public static package.",
        },
        records,
      };
      const filenameDate = String(manifest.generated_at || new Date().toISOString()).replace(/[:]/g, "-");
      triggerBlobDownload(`catlog-page-${page}-${filenameDate}.json`, JSON.stringify(payload, null, 2));
    } catch (error) {
      failed = true;
      if (button) {
        button.textContent = "Download failed";
        button.title = error?.message || "Could not prepare this page download.";
      }
    } finally {
      state.pageDownloadPending = false;
      if (button) {
        button.disabled = !state.recordsReady || !currentPageRows().length;
        if (!failed) button.textContent = "Download page";
        if (failed) {
          window.setTimeout(() => {
            button.textContent = "Download page";
            button.title = originalTitle;
          }, 2500);
        }
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
    const isLoaded = state.recordsReady;
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
      ${manifest.generated_at ? `<span class="snapshot-date">Snapshot ${escapeHtml(formatDate(manifest.generated_at))}${manifest.content_sha256 || manifest.source_sha256 ? ` · ID <code title="${escapeHtml(manifest.content_sha256 || manifest.source_sha256)}">${escapeHtml(shortHash(manifest.content_sha256 || manifest.source_sha256))}</code>` : ""}</span>` : ""}
    `;
  }

  function renderEvidenceSummary(rows) {
    const isLoaded = state.recordsReady;
    const totalRows = isLoaded ? rows.length : Number(manifest.total_rows || 0);
    const total = Math.max(1, totalRows);
    const counts = recordStateCounts(rows);
    const evidenceCounts = evidenceGroupCounts(rows);
    const statusLabel = recordStates.map((item) => {
      const pct = totalRows ? (((counts[item.value] || 0) / total) * 100).toFixed(1) : "0.0";
      return `${item.label} ${pct}%`;
    }).join(", ");
    const evidenceLabelText = evidenceGroups.map((item) => {
      const pct = totalRows ? (((evidenceCounts[item.value] || 0) / total) * 100).toFixed(1) : "0.0";
      return `${item.label} ${pct}%`;
    }).join(", ");
    $("evidenceSummary").innerHTML = `
      <div class="evidence-summary-title">Review status</div>
      <div class="evidence-segment-row">
        ${recordStates.map((item) => {
          const count = counts[item.value] || 0;
          const pct = totalRows ? ((count / total) * 100).toFixed(1) : "0.0";
          return `
            <div class="evidence-segment ${item.className}">
              <span class="evidence-dot ${item.className}"></span>
              <span>${escapeHtml(item.label)}</span>
              <div class="evidence-stat">
                <strong>${formatInteger(count)}</strong>
                <span>${pct}%</span>
              </div>
            </div>
          `;
        }).join("")}
      </div>
      ${totalRows ? `
        <div class="summary-distribution review-distribution" role="img" aria-label="${escapeHtml(statusLabel)}">
          ${recordStates.map((item) => {
            const pct = ((counts[item.value] || 0) / total) * 100;
            return `<span class="${item.className}" style="flex-basis:${pct.toFixed(3)}%"></span>`;
          }).join("")}
        </div>
      ` : ""}
      <div class="evidence-axis">
        <div class="evidence-summary-title">Evidence available</div>
        <div class="evidence-axis-items">
          ${evidenceGroups.map((item) => {
            const count = evidenceCounts[item.value] || 0;
            const pct = totalRows ? ((count / total) * 100).toFixed(1) : "0.0";
            const accessibleLabel = `${item.label}: ${item.description} ${pct}%`;
            return `<span tabindex="0" title="${escapeHtml(item.description)}" aria-label="${escapeHtml(accessibleLabel)}"><i class="${item.className}"></i>${escapeHtml(item.label)} <strong>${pct}%</strong></span>`;
          }).join("")}
        </div>
        ${totalRows ? `
          <div class="summary-distribution evidence-distribution" role="img" aria-label="${escapeHtml(evidenceLabelText)}">
            ${evidenceGroups.map((item) => {
              const pct = ((evidenceCounts[item.value] || 0) / total) * 100;
              return `<span class="${item.className}" style="flex-basis:${pct.toFixed(3)}%"></span>`;
            }).join("")}
          </div>
        ` : ""}
      </div>
    `;
  }

  function countsByState() {
    return recordStateCounts(state.records);
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
    const input = state.suggestionInputId ? $(state.suggestionInputId) : null;
    input?.setAttribute("aria-expanded", "false");
    input?.removeAttribute("aria-activedescendant");
    box.classList.add("hidden");
    box.innerHTML = "";
    state.suggestionIndex = -1;
    state.suggestionInputId = "";
  }

  function chooseSuggestion(input, value) {
    input.value = value || "";
    hideSuggestions();
    input.focus();
    applyFiltersInBackground();
  }

  function moveSuggestionSelection(input, direction) {
    const box = $("searchSuggestions");
    if (!box || box.classList.contains("hidden")) showSuggestions(input);
    const buttons = [...box.querySelectorAll("button[data-value]")];
    if (!buttons.length) return;
    state.suggestionIndex = (state.suggestionIndex + direction + buttons.length) % buttons.length;
    buttons.forEach((button, index) => button.setAttribute("aria-selected", String(index === state.suggestionIndex)));
    const selected = buttons[state.suggestionIndex];
    input.setAttribute("aria-activedescendant", selected.id);
    selected.scrollIntoView({ block: "nearest" });
  }

  function showSuggestions(input) {
    const kind = suggestionInputs[input.id];
    const box = $("searchSuggestions");
    if (!kind || !box || !state.records.length) return;
    if (String(input.value || "").trim()) {
      hideSuggestions();
      return;
    }
    window.clearTimeout(state.suggestionHideTimer);
    if (state.suggestionInputId && state.suggestionInputId !== input.id) hideSuggestions();
    const suggestions = randomSuggestions(kind);
    if (!suggestions.length) return;
    const rect = input.getBoundingClientRect();
    box.style.left = `${Math.round(rect.left)}px`;
    box.style.top = `${Math.round(rect.bottom + 6)}px`;
    box.style.width = `${Math.max(240, Math.round(rect.width))}px`;
    box.innerHTML = `
      <div class="suggestion-title">${escapeHtml(suggestionTitles[kind] || "Try a search")}</div>
      ${suggestions.map((value, index) => (
        `<button id="catlog-suggestion-${index}" type="button" role="option" aria-selected="false" data-value="${escapeHtml(value)}">${escapePublic(value)}</button>`
      )).join("")}
    `;
    box.classList.remove("hidden");
    state.suggestionIndex = -1;
    state.suggestionInputId = input.id;
    input.setAttribute("aria-controls", "searchSuggestions");
    input.setAttribute("aria-expanded", "true");
    [...box.querySelectorAll("button[data-value]")].forEach((button) => {
      button.addEventListener("click", () => chooseSuggestion(input, button.dataset.value));
    });
  }

  function setupFilters() {
    const hadStateFilters = Boolean(document.querySelector('input[name="recordState"]'));
    const hadMeasurementFilters = Boolean(document.querySelector('input[name="measurement"]'));
    const selectedStates = new Set(selectedCheckboxes("recordState"));
    const selectedMeasurements = new Set(selectedCheckboxes("measurement"));
    const stateCounts = countsByState();
    const statusCounts = manifestDistribution("verification_status");
    const statusBreakdown = [
      ["Accepted as reported", statusCounts.verified],
      ["Accepted after correction", statusCounts.corrected],
      ["Further checks", statusCounts.manual_review_required],
      ["Not reviewed", statusCounts.unverified],
      ["Calculated from reported values", statusCounts.mathematically_inferred],
      ["Disputed", statusCounts.disputed],
    ].filter((item) => Number(item[1] || 0) > 0);
    $("statusChecklist").innerHTML = recordStates.map((item) => `
      <label class="check-row ${item.className}" title="${escapeHtml(stateDescriptions[item.value])}">
        <input type="checkbox" name="recordState" value="${escapeHtml(item.value)}" ${!hadStateFilters || selectedStates.has(item.value) ? "checked" : ""} />
        <span>${escapeHtml(item.label)}</span>
        <strong>${state.recordsReady ? formatInteger(stateCounts[item.value] || 0) : EMPTY_VALUE}</strong>
      </label>
    `).join("") + `
      <details class="status-guide">
        <summary>Status definitions</summary>
        <div class="status-guide-body">
          ${recordStates.map((item) => `<p><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(stateDescriptions[item.value])}</p>${item.value === "accepted" ? `<p><strong>Accepted (identity only):</strong> ${escapeHtml(identityOnlyTrustNote)}</p>` : ""}`).join("")}
          ${statusBreakdown.length ? `
            <div class="review-profile">
              <span>Snapshot breakdown</span>
              ${statusBreakdown.map(([label, count]) => `<p><span>${escapeHtml(label)}</span><strong>${formatInteger(count)}</strong></p>`).join("")}
            </div>
          ` : ""}
        </div>
      </details>
    `;
    const coverage = (manifest.summary || {}).coverage || {};
    const manifestMetricCounts = {
      kcat: coverage.with_kcat,
      km: coverage.with_km,
      kcat_over_km: coverage.with_kcat_over_km,
    };
    $("measurementChecklist").innerHTML = measurementFilters.map((item) => `
      <label class="check-row">
        <input type="checkbox" name="measurement" value="${escapeHtml(item.value)}" ${hadMeasurementFilters && selectedMeasurements.has(item.value) ? "checked" : ""} />
        <span>${escapeHtml(item.label)}</span>
        <strong>${formatCount(state.recordsReady ? metricCoverage(state.records, item.field) : manifestMetricCounts[item.field])}</strong>
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
        kcat_over_km: "kcat_over_km",
      };
      if (!filters.metrics.some((metric) => row[metricFields[metric]] != null)) return false;
    }
    return true;
  }

  function ecSort(a, b) {
    const left = a._ecSort || [];
    const right = b._ecSort || [];
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      const delta = (left[index] ?? -1) - (right[index] ?? -1);
      if (delta !== 0) return delta;
    }
    return String(a.ec_number || "").localeCompare(String(b.ec_number || ""));
  }

  function rowComparator(sort) {
    const textKey = (field) => (a, b) => a[field].localeCompare(b[field]);
    const numericDesc = (field) => (a, b) => {
      const av = a[field] == null ? Number.NEGATIVE_INFINITY : Number(a[field]);
      const bv = b[field] == null ? Number.NEGATIVE_INFINITY : Number(b[field]);
      return bv - av;
    };
    const sorters = {
      ec_number: ecSort,
      enzyme: textKey("_sortEnzyme"),
      organism: textKey("_sortOrganism"),
      substrate: textKey("_sortSubstrate"),
      kcat: numericDesc("kcat"),
      km: numericDesc("km"),
      kcat_over_km: numericDesc("kcat_over_km"),
      evidence: (a, b) => {
        const stateDelta = a._stateRank - b._stateRank;
        if (stateDelta !== 0) return stateDelta;
        const tierDelta = a._tierRank - b._tierRank;
        if (tierDelta !== 0) return tierDelta;
        return (b._sourceCount - a._sourceCount) || ecSort(a, b);
      },
    };
    const primaryComparator = sorters[sort] || sorters.evidence;
    return (a, b) => primaryComparator(a, b) || (a._loadIndex - b._loadIndex);
  }

  function isSortEntryCurrent(entry) {
    return !entry.cancelled && entry.recordsGeneration === state.recordsGeneration;
  }

  async function yieldDuringSort(entry) {
    if (!isSortEntryCurrent(entry)) return false;
    await yieldToBrowser();
    return isSortEntryCurrent(entry);
  }

  async function mergeSortedRuns(left, right, comparator, entry) {
    if (!isSortEntryCurrent(entry)) return null;
    const merged = new Array(left.length + right.length);
    let leftIndex = 0;
    let rightIndex = 0;
    let mergedIndex = 0;

    while (leftIndex < left.length || rightIndex < right.length) {
      if (
        rightIndex >= right.length
        || (leftIndex < left.length && comparator(left[leftIndex], right[rightIndex]) <= 0)
      ) {
        merged[mergedIndex] = left[leftIndex];
        leftIndex += 1;
      } else {
        merged[mergedIndex] = right[rightIndex];
        rightIndex += 1;
      }
      mergedIndex += 1;
      if (mergedIndex % SORT_RUN_SIZE === 0 && !(await yieldDuringSort(entry))) {
        return null;
      }
    }
    return isSortEntryCurrent(entry) ? merged : null;
  }

  async function cooperativeStableSort(rows, comparator, entry) {
    if (!isSortEntryCurrent(entry)) return null;
    let runs = [];
    for (let start = 0; start < rows.length; start += SORT_RUN_SIZE) {
      if (!isSortEntryCurrent(entry)) return null;
      runs.push(rows.slice(start, start + SORT_RUN_SIZE).sort(comparator));
      if (!(await yieldDuringSort(entry))) return null;
    }

    while (runs.length > 1) {
      const mergedRuns = [];
      for (let index = 0; index < runs.length; index += 2) {
        if (index + 1 >= runs.length) {
          mergedRuns.push(runs[index]);
          continue;
        }
        const merged = await mergeSortedRuns(
          runs[index],
          runs[index + 1],
          comparator,
          entry,
        );
        if (!merged) return null;
        mergedRuns.push(merged);
      }
      runs = mergedRuns;
    }
    return isSortEntryCurrent(entry) ? (runs[0] || []) : null;
  }

  function normalizedSortName(sort) {
    return [
      "evidence",
      "ec_number",
      "enzyme",
      "organism",
      "substrate",
      "kcat",
      "km",
      "kcat_over_km",
    ].includes(sort) ? sort : "evidence";
  }

  function retainSortEntry(sort, entry) {
    state.sortCache.delete(sort);
    state.sortCache.set(sort, entry);
    while (state.sortCache.size > SORT_CACHE_LIMIT) {
      const oldestSort = state.sortCache.keys().next().value;
      const oldestEntry = state.sortCache.get(oldestSort);
      if (oldestEntry) oldestEntry.cancelled = true;
      state.sortCache.delete(oldestSort);
    }
  }

  function orderedRecordsFor(sort) {
    const sortName = normalizedSortName(sort);
    const recordsGeneration = state.recordsGeneration;
    const cached = state.sortCache.get(sortName);
    if (cached?.recordsGeneration === recordsGeneration) {
      retainSortEntry(sortName, cached);
      return cached.promise;
    }

    const entry = { recordsGeneration, cancelled: false, promise: null };
    entry.promise = cooperativeStableSort(
      state.records,
      rowComparator(sortName),
      entry,
    ).catch((error) => {
      if (state.sortCache.get(sortName) === entry) state.sortCache.delete(sortName);
      throw error;
    });
    retainSortEntry(sortName, entry);
    return entry.promise;
  }

  async function applyFilters({ resetPage = true, runId = null } = {}) {
    const filterRunId = runId == null ? ++state.filterRunId : runId;
    const recordsGeneration = state.recordsGeneration;
    const filters = currentFilters();
    const orderedRecords = await orderedRecordsFor(filters.sort);
    if (
      !orderedRecords
      || filterRunId !== state.filterRunId
      || recordsGeneration !== state.recordsGeneration
    ) return false;

    state.filterFailure = "";
    renderActiveFilterCount(filters);
    state.filtered = orderedRecords.filter((row) => rowMatches(row, filters));
    if (resetPage) state.page = 1;
    if (state.selectedKey && !state.filtered.some((row) => row.record_key === state.selectedKey)) {
      resetDetail();
    }
    renderSummary();
    renderRows();
    return true;
  }

  async function ensureCurrentFilters(options = {}) {
    while (!(await applyFilters(options))) {
      // A newer filter request or record generation won the race. Re-read the
      // controls and full-order cache before load-time code uses state.filtered.
    }
    return true;
  }

  async function ensureCurrentFiltersAndSelectFirst(options = {}) {
    await ensureCurrentFilters(options);
    if (!state.selectedKey && state.filtered.length && usesEmbeddedDetailPanel()) {
      await selectRecord(state.filtered[0].record_key, { focusDetail: false });
    }
  }

  function boundedFilterFailure(error) {
    const detail = String(error?.message || error || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!detail) return "The current results could not be updated. Try again.";
    if (detail.length <= FILTER_FAILURE_MAX_LENGTH) return detail;
    return `${detail.slice(0, FILTER_FAILURE_MAX_LENGTH - 3)}...`;
  }

  async function applyFiltersInBackground(options = {}) {
    try {
      const applied = await applyFilters(options);
      return applied;
    } catch (error) {
      state.filterFailure = boundedFilterFailure(error);
      showLoadNotice(
        "CatLog could not update results",
        state.filterFailure,
        { actionLabel: "Try again", onAction: () => applyFiltersInBackground() },
      );
      return false;
    }
  }

  function scheduleFilters() {
    window.clearTimeout(state.filterTimer);
    const runId = ++state.filterRunId;
    state.filterTimer = window.setTimeout(() => {
      applyFiltersInBackground({ runId });
    }, 120);
  }

  function activeTableRowKey(pageRows) {
    if (pageRows.some((row) => row.record_key === state.activeRowKey)) return state.activeRowKey;
    if (pageRows.some((row) => row.record_key === state.selectedKey)) return state.selectedKey;
    return pageRows[0]?.record_key || "";
  }

  function setActiveTableRow(rowElement, rowElements) {
    state.activeRowKey = rowElement.dataset.key || "";
    rowElements.forEach((candidate) => {
      candidate.tabIndex = candidate === rowElement ? 0 : -1;
    });
  }

  function moveTableRowFocus(rowElement, direction, rowElements) {
    const currentIndex = rowElements.indexOf(rowElement);
    const nextIndex = Math.min(Math.max(currentIndex + direction, 0), rowElements.length - 1);
    const nextRow = rowElements[nextIndex];
    if (!nextRow) return;
    setActiveTableRow(nextRow, rowElements);
    nextRow.focus();
  }

  function renderRows() {
    const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
    state.page = Math.min(Math.max(1, state.page), totalPages);
    const start = (state.page - 1) * state.pageSize;
    const pageRows = currentPageRows();
    const activeRowKey = activeTableRowKey(pageRows);
    state.activeRowKey = activeRowKey;
    const range = pageRows.length
      ? `${formatInteger(start + 1)}–${formatInteger(Math.min(start + pageRows.length, state.filtered.length))} of ${formatInteger(state.filtered.length)}`
      : "";
    const loadingNote = state.recordsReady
      ? ""
      : ` · Loading full index ${formatInteger(state.recordChunksLoaded)}/${formatInteger(state.recordChunksTotal)}`;
    $("activeSummary").textContent = state.recordsReady
      ? `${formatInteger(state.filtered.length)} records`
      : `${formatInteger(state.filtered.length)} available`;
    $("pageSummary").textContent = pageRows.length
      ? `${range}${loadingNote}`
      : (state.recordsReady ? "No rows match the selected filters" : "Loading first records...");
    $("pageLabel").textContent = pageRows.length
      ? range
      : "No records";
    $("prevButton").disabled = state.page <= 1;
    $("nextButton").disabled = state.page >= totalPages;
    $("downloadPageButton").disabled = state.pageDownloadPending || !pageRows.length;
    $("recordsBody").innerHTML = pageRows.map((row) => `
      <tr data-key="${escapeHtml(row.record_key)}" class="${row.record_key === state.selectedKey ? "selected" : ""}" tabindex="${row.record_key === activeRowKey ? "0" : "-1"}" aria-selected="${row.record_key === state.selectedKey ? "true" : "false"}">
        <td class="primary-cell">
          <strong>${escapePublic(row.enzyme_display_name || "Name not preserved")}</strong>
          <span class="primary-meta">
            <span class="name-source">${escapePublic(sourceLabels[row.enzyme_label_source] || row.enzyme_label_source || sourceDatabaseLabel(row.source_db) || "source")}</span>
            ${enzymeFormHtml(row)}
          </span>
        </td>
        <td>${escapeHtml(row.ec_number || EMPTY_VALUE)}</td>
        <td class="organism-cell">${escapePublic(row.organism || EMPTY_VALUE)}</td>
        <td class="substrate-cell">${escapePublic(row.substrate_name || EMPTY_VALUE)}</td>
        <td class="metric-cell"><span class="metric-with-note"><strong>${metricDisplayWithUnitHtml(row, "kcat")}</strong>${valueFlagBadgeHtml(conditionFlags(row), "kcat")}</span></td>
        <td class="metric-cell"><span class="metric-with-note">${metricDisplayWithUnitHtml(row, "km")}${valueFlagBadgeHtml(conditionFlags(row), "km")}</span></td>
        <td class="metric-cell"><span class="metric-with-note">${metricDisplayWithUnitHtml(row, "kcat_over_km")}${efficiencyOriginHtml(row)}${valueFlagBadgeHtml(conditionFlags(row), "kcat_over_km")}</span></td>
        <td>${escapeHtml(formatTemperature(row))}</td>
        <td>${escapeHtml(formatPh(row))}</td>
        <td>${statusBadge(row)}</td>
        <td class="row-arrow" aria-hidden="true">&rsaquo;</td>
      </tr>
    `).join("");
    const rowElements = [...$("recordsBody").querySelectorAll("tr[data-key]")];
    rowElements.forEach((rowElement) => {
      rowElement.addEventListener("focus", () => setActiveTableRow(rowElement, rowElements));
      rowElement.addEventListener("click", () => selectRecord(rowElement.dataset.key));
      rowElement.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          moveTableRowFocus(rowElement, event.key === "ArrowDown" ? 1 : -1, rowElements);
          return;
        }
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        selectRecord(rowElement.dataset.key);
      });
    });
  }

  function setDetailOpen(isOpen) {
    document.body.classList.toggle("detail-open", Boolean(isOpen));
    syncDetailPanelAccessibility();
  }

  function focusAfterPanelTransition(id) {
    window.setTimeout(() => $(id)?.focus(), 180);
  }

  function syncDetailPanelAccessibility() {
    const panel = $("detailPanel");
    const isModal = Boolean(narrowFilterMedia.matches && document.body.classList.contains("detail-open"));
    if (isModal) {
      panel?.setAttribute("role", "dialog");
      panel?.setAttribute("aria-modal", "true");
    } else {
      panel?.removeAttribute("role");
      panel?.removeAttribute("aria-modal");
    }
    document.querySelectorAll(DETAIL_INERT_SELECTOR).forEach((element) => {
      element.inert = isModal;
    });
    if (isModal && panel && !panel.contains(document.activeElement)) panel.focus();
  }

  function openedRecordMessage(row) {
    const enzymeName = String(row?.enzyme_display_name || "").trim() || "record";
    return `Opened ${enzymeName}`;
  }

  function announceOpenedRecord(row) {
    const status = $("detailStatus");
    if (status) status.textContent = openedRecordMessage(row);
  }

  function focusDetailHeading(key) {
    const focusCurrentHeading = () => {
      if (state.selectedKey !== key || !document.body.classList.contains("detail-open")) return;
      $("detailHeading")?.focus();
    };
    if (narrowFilterMedia.matches) window.setTimeout(focusCurrentHeading, 180);
    else focusCurrentHeading();
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

  function updateTableScrollControls() {
    const wrap = $("recordTableWrap");
    if (!wrap) return;
    const hasOverflow = wrap.scrollWidth > wrap.clientWidth + 2;
    const canScrollLeft = wrap.scrollLeft > 2;
    const canScrollRight = wrap.scrollLeft + wrap.clientWidth < wrap.scrollWidth - 2;
    $("scrollTableLeftButton")?.closest(".table-scroll-controls")?.classList.toggle("hidden", !hasOverflow);
    $("scrollTableLeftButton").disabled = !canScrollLeft;
    $("scrollTableRightButton").disabled = !canScrollRight;
    wrap.classList.toggle("can-scroll-left", canScrollLeft);
    wrap.classList.toggle("can-scroll-right", canScrollRight);
  }

  function scrollTableColumns(direction) {
    const wrap = $("recordTableWrap");
    const headers = [...wrap.querySelectorAll("thead th")];
    const stickyWidth = headers[0]?.offsetWidth || 0;
    const stops = headers.slice(1).map((header) => Math.max(0, header.offsetLeft - stickyWidth));
    const ordered = direction > 0 ? stops : [...stops].reverse();
    const target = ordered.find((stop) => direction > 0
      ? stop > wrap.scrollLeft + 2
      : stop < wrap.scrollLeft - 2) ?? (direction > 0 ? wrap.scrollWidth : 0);
    wrap.scrollTo({
      left: target,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }

  function resetDetail() {
    state.selectedKey = "";
    state.selectedDetail = null;
    $("detailStatus").textContent = "";
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

  async function selectRecord(key, { focusDetail = true } = {}) {
    const row = state.records.find((item) => item.record_key === key);
    if (!row) {
      resetDetail();
      renderRows();
      return;
    }
    state.selectedKey = key;
    state.activeRowKey = key;
    setFiltersOpen(false);
    setDetailOpen(true);
    if (focusDetail) announceOpenedRecord(row);
    renderRows();
    $("detailEmpty").classList.add("hidden");
    $("detailContent").classList.remove("hidden");
    $("detailContent").innerHTML = `
      <div class="detail-top">
        <button id="closeDetailButton" class="icon-button close-detail" type="button" aria-label="Close detail">&times;</button>
        <h2 id="detailHeading" tabindex="-1">${escapePublic(row.enzyme_display_name || "Name not preserved")}</h2>
      </div>
      <p id="detailLoadStatus" class="muted" role="status">Loading record...</p>
    `;
    $("closeDetailButton").addEventListener("click", closeDetailAndRestoreFocus);
    if (focusDetail) focusDetailHeading(key);
    try {
      const detail = await detailForRow(row, {
        onRetry: (attempt, delay) => {
          if (state.selectedKey !== key) return;
          $("detailLoadStatus").textContent = `Could not load this record. Retrying in ${Math.round(delay / 1000)} seconds (${attempt} of ${LOAD_RETRY_DELAYS.length}).`;
        },
      });
      if (state.selectedKey !== key) return;
      state.selectedDetail = detail;
      renderDetail(row, detail);
      if (focusDetail) focusDetailHeading(key);
    } catch (error) {
      if (state.selectedKey !== key) return;
      $("detailContent").innerHTML = `
        <div class="detail-top">
          <button id="closeDetailButton" class="icon-button close-detail" type="button" aria-label="Close detail">&times;</button>
          <h2 id="detailHeading" tabindex="-1">${escapePublic(row.enzyme_display_name || "Name not preserved")}</h2>
          <p>${escapeHtml(row.ec_number || EMPTY_VALUE)} &middot; ${escapePublic(row.organism || EMPTY_VALUE)}</p>
        </div>
        <div class="detail-load-error" role="alert">
          <strong>Record details could not be loaded.</strong>
          <span>The summary row is still available in the table.</span>
          <button id="retryDetailButton" class="button secondary" type="button">Try again</button>
        </div>
      `;
      $("closeDetailButton").addEventListener("click", closeDetailAndRestoreFocus);
      $("retryDetailButton").addEventListener("click", () => selectRecord(key));
      if (focusDetail) focusDetailHeading(key);
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

  function proteinAccessionLink(value, database) {
    const accession = String(value || "").trim();
    if (!accession) return EMPTY_VALUE;
    if (database === "UniProt") return uniprotLink(accession);
    if (database === "NCBI Protein") {
      return `<a class="reference-link" href="https://www.ncbi.nlm.nih.gov/protein/${encodeURIComponent(accession)}" target="_blank" rel="noreferrer" aria-label="Open NCBI Protein entry ${escapeHtml(accession)}">${escapeHtml(accession)}</a>`;
    }
    return escapeHtml(accession);
  }

  const sequenceSourceLabels = {
    uniprot_accession: "UniProt accession",
    source_record: "Source database",
    uniprot_accession_inactive_uniparc: "UniProt / UniParc archive",
    uniprot_ec_organism_mutation_ranked_match: "Ranked UniProt match from EC, organism, and variant",
    unresolved_ec_organism: "No sequence match from EC and organism",
    manual_literature_uniprot_resolution: "UniProt match from the cited paper",
    uniprot_ec_organism_unique: "Unique UniProt match from EC and organism",
    multiple: "Multiple sources",
  };

  function sequenceSourceLabel(value) {
    const key = String(value || "").trim().toLowerCase();
    if (!key) return "";
    if (sequenceSourceLabels[key]) return sequenceSourceLabels[key];
    return key.replace(/_/g, " ").replace(/^./, (character) => character.toUpperCase());
  }

  function uniqueReferenceValues(values, { caseInsensitive = false } = {}) {
    const seen = new Set();
    return values.filter((value) => {
      const text = String(value || "").trim();
      if (!text) return false;
      const key = caseInsensitive ? text.toLowerCase() : text;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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

  function sourceEfficiencyRow(summary, detail) {
    if (!summary.kcat_over_km_source_differs && !detail.kcat_over_km_source_differs) return "";
    const values = Array.isArray(detail.source_kcat_over_km_values)
      ? detail.source_kcat_over_km_values.filter((item) => item && item.value != null)
      : [];
    if (!values.length) return "";
    const valueHtml = values.map((item) => {
      const unit = item.unit ? ` ${unitHtml(item.unit)}` : "";
      const source = item.source_db ? ` <small>${escapePublic(sourceDatabaseLabel(item.source_db))}</small>` : "";
      return `<span class="source-efficiency-value">${scientificValueHtml(item.value)}${unit}${source}</span>`;
    }).join("");
    return linkedKv("Source-listed kcat/Km", valueHtml);
  }

  function measurementSection(summary, detail) {
    const metricSummary = {
      ...summary,
      has_ki: detail.has_ki ?? summary.has_ki,
      ki_display: detail.ki_display ?? summary.ki_display,
      ki_unit: detail.ki_unit ?? summary.ki_unit,
    };
    const temperature = formatTemperature(summary);
    const flags = conditionFlags(summary, detail);
    const hasTemperatureFlag = [...flags].some((flag) => flag.startsWith("temperature_"));
    const hasPhFlag = [...flags].some((flag) => flag.startsWith("ph_"));
    const temperatureValue = temperature !== EMPTY_VALUE
      ? `${temperature} °C`
      : (hasTemperatureFlag && (detail.temperature_k ?? summary.temperature_k) != null
          ? `${compactValue(detail.temperature_k ?? summary.temperature_k)} K (stored)`
          : EMPTY_VALUE);
    const ph = formatPh(summary);
    const phValue = ph !== EMPTY_VALUE
      ? ph
      : (hasPhFlag && (detail.ph ?? summary.ph) != null
          ? `${compactValue(detail.ph ?? summary.ph)} (stored)`
          : EMPTY_VALUE);
    const metrics = [
      ["<i>k</i><sub>cat</sub>", "kcat", metricDisplay(metricSummary, "kcat")],
      ["<i>K</i><sub>m</sub>", "km", metricDisplay(metricSummary, "km")],
      ["<i>k</i><sub>cat</sub>/<i>K</i><sub>m</sub>", "kcat_over_km", metricDisplay(metricSummary, "kcat_over_km")],
    ];
    if (metricSummary.has_ki) {
      metrics.push(["<i>K</i><sub>i</sub>", "ki", metricDisplay(metricSummary, "ki")]);
    }
    const conditionsSummary = publicEvidenceString(detail.assay_conditions_summary);
    return `
      <section class="detail-section measurement-section">
        <h3>Kinetic measurement</h3>
        <div class="measurement-strip${metrics.length > 3 ? " has-ki" : ""}">
          ${metrics.map(([label, field, value]) => {
            const unitMissing = metricUnitMissing(metricSummary, field, flags);
            const unit = unitMissing ? "" : metricUnitHtml(metricSummary, field);
            return `
            <div class="measurement-value${unitMissing ? " unit-missing" : ""}">
              <span>${label}${unitMissing ? unitMissingHtml() : (unit ? `<small>${unit}</small>` : "")}${field === "kcat_over_km" ? efficiencyOriginHtml(summary) : ""}</span>
              <strong>${scientificValueHtml(value)}${valueFlagBadgeHtml(flags, field)}</strong>
            </div>
          `;
          }).join("")}
        </div>
        <div class="detail-kv measurement-conditions">
          ${kv("Substrate", summary.substrate_name)}
          ${kv("Temperature", temperatureValue)}
          ${kv("pH", phValue)}
          ${sourceEfficiencyRow(summary, detail)}
          ${conditionFlagsHtml(flags)}
          ${conditionsSummary ? kv("Conditions", conditionsSummary) : ""}
        </div>
      </section>
    `;
  }

  function sequenceDisclosure(label, sequence, targetId) {
    if (!sequence) return "";
    return `
      <details class="sequence-disclosure">
        <summary>${escapeHtml(label)} <span>${formatInteger(sequence.length)} aa</span></summary>
        <div class="copy-field sequence-field">
          <div class="copy-field-heading">
            <span>Amino-acid sequence</span>
            <button class="copy-button" type="button" data-copy-target="${escapeHtml(targetId)}">Copy</button>
          </div>
          <code id="${escapeHtml(targetId)}">${escapeHtml(sequence)}</code>
        </div>
      </details>
    `;
  }

  function molecularIdentitySection(summary, detail) {
    const uniprot = detail.uniprot_id || summary.primary_uniprot_id || "";
    const proteinAccession = detail.protein_accession || summary.protein_accession || uniprot;
    const proteinAccessionDatabase = detail.protein_accession_database
      || summary.protein_accession_database
      || (uniprot ? "UniProt" : "");
    const accessionCandidates = [...new Set(
      (detail.uniprot_candidate_ids || summary.uniprot_candidate_ids || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    )];
    const smiles = String(detail.smiles || "").trim();
    const sequence = String(detail.sequence || detail.canonical_sequence || "").trim();
    const variantStatus = String(detail.sequence_variant_status || "").trim();
    const wildTypeSequence = String(
      detail.wild_type_sequence
      || detail.canonical_sequence
      || ((detail.wild_type === true || [
        "canonical_wild_type_sequence",
        "canonical_wild_type",
        "canonical_sequence_with_mutation_annotation",
        "canonical_sequence_pending_mutation_application",
      ].includes(variantStatus)) ? sequence : ""),
    ).trim();
    const variantSequence = String(
      detail.variant_sequence
      || (["reconstructed_variant_sequence", "source_provided_variant_sequence"].includes(variantStatus) ? sequence : ""),
    ).trim();
    const variant = mutationSignature(detail) || mutationSignature(summary);
    const sourceProteinAccession = String(detail.source_protein_accession || summary.source_protein_accession || "").trim();
    const enzymeForm = enzymeFormLabel({ ...summary, ...detail }, { showUnknown: true });
    const sequenceVariantNote = String(detail.sequence_variant_note || summary.sequence_variant_note || "").trim();
    const sequenceSource = sequenceSourceLabel(detail.sequence_source || summary.sequence_source);
    if (!proteinAccession && !sourceProteinAccession && !accessionCandidates.length && !smiles && !sequence && !wildTypeSequence && !variantSequence && !variant && !sequenceVariantNote && enzymeForm === "Not recorded") return "";
    const accessionLabel = proteinAccessionDatabase === "UniProt"
      ? "UniProt"
      : (proteinAccessionDatabase === "NCBI Protein" ? "NCBI Protein" : "Protein accession");
    const sequenceHtml = variantSequence
      ? `${sequenceDisclosure("Wild-type sequence", wildTypeSequence, "detailWildTypeSequence")}${sequenceDisclosure("Variant sequence", variantSequence, "detailVariantSequence")}`
      : sequenceDisclosure(wildTypeSequence ? "Wild-type sequence" : "Protein sequence", wildTypeSequence || sequence, "detailSequence");
    return `
      <section class="detail-section identity-section">
        <h3>Molecular identity</h3>
        <div class="detail-kv">
          ${kv("Enzyme form", enzymeForm)}
          ${sequenceVariantNote ? kv("Form note", sequenceVariantNote) : ""}
          ${proteinAccession ? linkedKv(accessionLabel, proteinAccessionLink(proteinAccession, proteinAccessionDatabase)) : ""}
          ${sourceProteinAccession ? kv("Source-listed accession", sourceProteinAccession) : ""}
          ${!proteinAccession && accessionCandidates.length ? linkedKv("Candidate UniProt IDs", referenceList(accessionCandidates, uniprotLink)) : ""}
          ${sequenceSource ? kv("Sequence source", sequenceSource) : ""}
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
        ${sequenceHtml}
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
    const pmidsRaw = Array.isArray(detail.supporting_pmids)
      ? detail.supporting_pmids.filter(Boolean)
      : (detail.pubmed_id ? [detail.pubmed_id] : []);
    const doisRaw = Array.isArray(detail.supporting_dois)
      ? detail.supporting_dois.filter(Boolean)
      : (detail.doi ? [detail.doi] : []);
    const pmids = uniqueReferenceValues(pmidsRaw);
    const dois = uniqueReferenceValues(doisRaw, { caseInsensitive: true });
    const rawProofLines = Array.isArray(detail.proof_lines)
      ? detail.proof_lines.filter(Boolean)
      : (Array.isArray(detail.paper_mentions) ? detail.paper_mentions.filter(Boolean) : []);
    const proofLines = rawProofLines.filter((line) => Boolean(evidenceNoteHtml(line)));
    const proofHeading = (summary.proof_kind || detail.proof_kind) === "source_note"
      ? "Source note"
      : "Values in source";
    const firstPmid = pmids[0] || "";
    const firstDoi = dois[0] || "";
    const hasSourceEvidence = proofLines.length > 0;
    const referenceRows = firstPmid || firstDoi
      ? [
          dois.length ? linkedKv(dois.length === 1 ? "DOI" : "DOIs", referenceList(dois, doiLink)) : "",
          pmids.length ? linkedKv(pmids.length === 1 ? "PubMed" : "PubMed IDs", referenceList(pmids, pmidLink)) : "",
        ]
      : [kv("Identifier", "Not available")];
    $("detailContent").innerHTML = `
      <div class="detail-top">
        <button id="closeDetailButton" class="icon-button close-detail" type="button" aria-label="Close detail">&times;</button>
        <h2 id="detailHeading" tabindex="-1">${escapePublic(summary.enzyme_display_name || "Name not preserved")}</h2>
        <p>${escapeHtml(summary.ec_number || EMPTY_VALUE)} &middot; ${escapePublic(summary.organism || EMPTY_VALUE)}</p>
        <div class="detail-status-line">
          ${statusBadge(summary)}
          <span class="evidence-source">${escapeHtml(evidenceLabel(summary, proofLines))}</span>
        </div>
      </div>

      ${measurementSection(summary, detail)}
      <section class="detail-section review-outcome-section">
        <h3>Review status</h3>
        <p>${escapeHtml(reviewOutcome(summary))}</p>
      </section>
      ${molecularIdentitySection(summary, detail)}
      ${detailSection("Reference", referenceRows)}
      ${proofLines.length ? `
        <section class="detail-section evidence-note-section">
          <h3>${escapeHtml(proofHeading)}</h3>
          <div class="evidence-note-list">${evidenceNotesHtml(proofLines, 3)}</div>
        </section>
      ` : ""}
      ${detailDisclosure("Source details", [
        kv("Source", sourceDatabaseLabel(summary.source_db || detail.source_db)),
        kv("Source license", sourceLicense(summary, detail)),
        kv("CatLog record ID", summary.measurement_key || detail.measurement_key),
        kv("Database rows", detail.source_record_count || summary.source_record_count),
        detail.source_databases_merged?.length ? kv("Databases", detail.source_databases_merged.map(sourceDatabaseLabel).join(", ")) : "",
        publicEvidenceString(detail.data_origin) ? kv("Data origin", publicEvidenceString(detail.data_origin)) : "",
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
      const payload = {
        summary: publicSummaryRecord(summary),
        detail: publicSummaryRecord(detail),
      };
      triggerBlobDownload(`${summary.record_key || "catlog-row"}.json`, JSON.stringify(payload, null, 2));
    });
  }

  function sourceDatabases() {
    const listed = Array.isArray(manifest.source_databases) ? manifest.source_databases : [];
    const rows = listed
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        key: String(item.key || "").trim(),
        name: String(item.name || "").trim() || (item.key ? sourceDatabaseLabel(item.key) : ""),
        license: String(item.license || "").trim(),
        citation_url: String(item.citation_url || "").trim(),
        row_count: item.row_count,
      }))
      .filter((item) => (
        item.name
        && item.name !== EMPTY_VALUE
        && displayedSourceDatabaseKeys.has(item.key.toLowerCase())
      ));
    return rows.length ? rows : fallbackSourceDatabases;
  }

  function safeHttpUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(String(value), document.baseURI);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
    } catch (error) {
      return "";
    }
  }

  function sourceNameHtml(item) {
    const href = safeHttpUrl(item.citation_url);
    const name = escapeHtml(item.name);
    return href
      ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${name}</a>`
      : name;
  }

  function renderSourceAttribution() {
    const sources = sourceDatabases();
    const footer = $("catalogFooter");
    if (footer) {
      footer.innerHTML = `
        <span class="footer-label">Data sources</span>
        <span class="footer-sources">${sources.map((item) => (
          `<span class="footer-source">${sourceNameHtml(item)}${item.license ? ` <small>${escapeHtml(item.license)}</small>` : ""}</span>`
        )).join("")}</span>
        <span class="footer-license">For reuse of CatLog review notes or corrections, <a href="mailto:ratul@iastate.edu?cc=supantha@iastate.edu&amp;subject=CatLog%20reuse%20question">contact the Chowdhury Lab</a>. <a class="footer-report" href="mailto:ratul@iastate.edu?cc=supantha@iastate.edu&amp;subject=CatLog%20data%20issue">Report a data issue</a>.</span>
      `;
    }
    const guideList = $("guideSourceList");
    if (guideList) {
      guideList.innerHTML = sources.map((item) => {
        const rowCount = item.row_count == null || item.row_count === "" ? "" : `${formatInteger(item.row_count)} rows in this snapshot`;
        const license = item.license ? `License: ${escapeHtml(item.license)}` : "See the source site for license terms";
        return `
          <div>
            <dt>${sourceNameHtml(item)}</dt>
            <dd>${[license, escapeHtml(rowCount)].filter(Boolean).join(" · ")}</dd>
          </div>
        `;
      }).join("");
    }
    const guideNote = $("guideCurationLicense");
    if (guideNote) guideNote.textContent = CURATION_LICENSE_NOTE;
  }

  function clearFilters() {
    window.clearTimeout(state.filterTimer);
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
    applyFiltersInBackground();
  }

  function applyPageSize(value) {
    resetDetail();
    state.pageSize = Number(value) || 25;
    state.page = 1;
    renderRows();
  }

  function bindControls() {
    [
      "globalSearchInput",
      "ecFilterInput",
      "enzymeFilterInput",
      "organismFilterInput",
      "substrateFilterInput",
    ].forEach((id) => {
      $(id).addEventListener("input", () => {
        if (id === "globalSearchInput" && viewFromLocation() === "guide") navigateTo("browse");
        if ($(id).value.trim()) hideSuggestions();
        scheduleFilters();
      });
    });
    $("sortSelect").addEventListener("change", () => {
      applyFiltersInBackground();
    });
    Object.keys(suggestionInputs).forEach((id) => {
      const input = $(id);
      if (!input) return;
      input.setAttribute("role", "combobox");
      input.setAttribute("aria-autocomplete", "list");
      input.setAttribute("aria-expanded", "false");
      input.addEventListener("focus", () => {
        if (id === "globalSearchInput" && viewFromLocation() === "guide") navigateTo("browse");
        showSuggestions(input);
      });
      input.addEventListener("click", () => showSuggestions(input));
      input.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          moveSuggestionSelection(input, event.key === "ArrowDown" ? 1 : -1);
          return;
        }
        if (event.key === "Enter" && state.suggestionIndex >= 0) {
          const option = $("searchSuggestions")?.querySelectorAll("button[data-value]")[state.suggestionIndex];
          if (option) {
            event.preventDefault();
            chooseSuggestion(input, option.dataset.value);
          }
          return;
        }
        if (event.key === "Escape" && !$("searchSuggestions")?.classList.contains("hidden")) {
          event.preventDefault();
          event.stopPropagation();
          hideSuggestions();
        }
      });
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
    $("brandHomeButton").addEventListener("click", () => navigateTo("browse"));
    $("browseButton").addEventListener("click", () => navigateTo("browse"));
    $("guideButton").addEventListener("click", () => navigateTo("guide"));
    document.addEventListener("click", (event) => {
      const menu = $("downloadMenu");
      if (menu?.open && !menu.contains(event.target)) menu.removeAttribute("open");
    });
    window.addEventListener("popstate", () => renderView(viewFromLocation()));
    window.addEventListener("scroll", hideSuggestions, { passive: true });
    window.addEventListener("resize", () => {
      hideSuggestions();
      syncFilterPanel();
      updateTableScrollControls();
    });
    narrowFilterMedia.addEventListener?.("change", () => {
      syncFilterPanel();
      syncDetailPanelAccessibility();
    });
    $("statusChecklist").addEventListener("change", () => {
      applyFiltersInBackground();
    });
    $("measurementChecklist").addEventListener("change", () => {
      applyFiltersInBackground();
    });
    $("clearButton").addEventListener("click", clearFilters);
    $("openFiltersButton").addEventListener("click", () => setFiltersOpen(true));
    $("closeFiltersButton").addEventListener("click", () => {
      setFiltersOpen(false);
      $("openFiltersButton")?.focus();
    });
    $("filterBackdrop").addEventListener("click", () => setFiltersOpen(false));
    $("pageSizeSelect").addEventListener("change", () => {
      applyPageSize($("pageSizeSelect").value);
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
    $("downloadPageButton").addEventListener("click", handlePageDownload);
    $("recordTableWrap").addEventListener("scroll", updateTableScrollControls, { passive: true });
    $("scrollTableLeftButton").addEventListener("click", () => scrollTableColumns(-1));
    $("scrollTableRightButton").addEventListener("click", () => scrollTableColumns(1));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && $("downloadMenu")?.open) {
        $("downloadMenu").removeAttribute("open");
        $("downloadMenu").querySelector("summary")?.focus();
        return;
      }
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
        navigateTo("browse");
        $("globalSearchInput").focus();
      }
    });
  }

  async function init() {
    try {
      renderSummary();
      renderDownloadMetadata();
      renderSourceAttribution();
      bindControls();
      renderView(viewFromLocation());
      syncFilterPanel();
      syncDetailPanelAccessibility();
      await loadRecordChunks();
    } catch (error) {
      showLoadNotice(
        "CatLog could not start",
        error?.message || String(error),
        { actionLabel: "Try again", onAction: reloadCatalogPage },
      );
    }
  }

  if (window.CATLOG_STATIC_TEST_MODE) {
    window.CATLOG_STATIC_TEST_API = {
      SORT_CACHE_LIMIT,
      DETAIL_SHARD_CACHE_LIMIT,
      state,
      loadScript,
      retainDetailShard,
      detailForRow,
      recordIndexPath,
      publicSummaryRecord,
      sourceLicense,
      indexLoadedRecords,
      rowComparator,
      cooperativeStableSort,
      orderedRecordsFor,
      applyFilters,
      ensureCurrentFilters,
      ensureCurrentFiltersAndSelectFirst,
      applyFiltersInBackground,
      applyPageSize,
      conditionFlags,
      enzymeFormLabel,
      enzymeFormHtml,
      measurementSection,
      molecularIdentitySection,
      showSuggestions,
      activeTableRowKey,
      setActiveTableRow,
      moveTableRowFocus,
      openedRecordMessage,
      announceOpenedRecord,
      focusDetailHeading,
      closeDetailAndRestoreFocus,
      syncDetailPanelAccessibility,
    };
  } else {
    init();
  }
})();
