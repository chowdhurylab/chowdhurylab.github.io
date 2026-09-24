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
    statsCohort: "manual_review_required",
    statsField: "",
  };
  const EMPTY_VALUE = "—";
  const SOURCE_LICENSE_NOTE = "Source licenses are recorded in source_license; merged records may list multiple licenses. Check those terms before reuse.";
  const LOAD_RETRY_DELAYS = [2000, 5000, 10000];
  const SORT_RUN_SIZE = 4096;
  const SORT_CACHE_LIMIT = 2;
  const DETAIL_SHARD_CACHE_LIMIT = 8;
  const DETAIL_REQUEST_TIMEOUT_MS = 30000;
  const FILTER_FAILURE_MAX_LENGTH = 160;
  const narrowDetailMedia = window.matchMedia("(max-width: 1180px)");
  const DETAIL_INERT_SELECTOR = [
    ".app-header",
    "#catalogLoadProgress",
    "#searchSuggestions",
    "#catalogView > .snapshot-band",
    "#catalogFooter",
    ".workbench > :not(.detail-panel)",
  ].join(", ");
  const FILTER_INERT_SELECTOR = ".app-header, #catalogLoadProgress, #catalogView > .snapshot-band, .table-panel, .detail-panel";

  const recordStates = [
    {
      value: "accepted",
      label: "Accepted",
      shortLabel: "Accepted",
      className: "accepted",
    },
    {
      value: "curation_pending",
      label: "Checks pending",
      shortLabel: "Checks pending",
      className: "review",
    },
    {
      value: "not_verified",
      label: "Other records",
      shortLabel: "Other",
      className: "unresolved",
    },
  ];

  const stateDescriptions = {
    accepted: "Verified and Corrected records. Identity-only records are labelled separately.",
    curation_pending: "Additional checks are required before acceptance.",
    not_verified: "Unverified, pre-review, or disputed records. These are separate outcomes, not a single rejected group.",
  };

  const reviewStatuses = [
    { value: "verified", label: "Verified", description: "Accepted as reported." },
    { value: "corrected", label: "Corrected", description: "Accepted after correction." },
    { value: "manual_review_required", label: "Checks pending", description: "Additional checks required." },
    { value: "unverified", label: "Unverified", description: "No verified or corrected outcome recorded." },
    { value: "mathematically_inferred", label: "Pre-review", description: "Prepared from source records, without an accepted review outcome." },
    { value: "disputed", label: "Disputed", description: "Outside the accepted set." },
  ];

  const evidenceGroups = [
    {
      value: "paper_evidence",
      label: "Paper excerpt",
      className: "paper",
      description: "A value and unit saved with a table or measurement excerpt.",
    },
    {
      value: "source_note",
      label: "Database note",
      className: "note",
      description: "A database note, without a paper-value excerpt.",
    },
    {
      value: "literature_id",
      label: "Reference only",
      className: "linked",
      description: "A PMID or DOI is linked; no paper-value excerpt is saved.",
    },
    {
      value: "source_records",
      label: "Database record only",
      className: "source",
      description: "Only the source database record is available.",
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

  const identityOnlyTrustNote = "Accepted on identity checks only; this does not establish literature verification of the kinetic value.";

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
    if (["#browse", "#guide", "#stats"].includes(window.location.hash)) return window.location.hash.slice(1);
    return new URL(window.location.href).pathname.endsWith("/catlog-stats.html") ? "stats" : "browse";
  }

  function renderView(view, { scroll = false } = {}) {
    const guideOpen = view === "guide";
    const statsOpen = view === "stats";
    const browseOpen = !guideOpen && !statsOpen;
    $("catalogView").hidden = !browseOpen;
    $("guideView").hidden = !guideOpen;
    $("statsView").hidden = !statsOpen;
    document.body.classList.toggle("guide-open", guideOpen);
    document.body.classList.toggle("stats-open", statsOpen);
    for (const name of ["browse", "stats", "guide"]) {
      const active = name === view;
      $(`${name}Button`).classList.toggle("active", active);
      $(`${name}Button`).setAttribute("aria-current", active ? "page" : "false");
    }
    document.title = guideOpen
      ? "Guide | CatLog"
      : statsOpen ? "Stats | CatLog" : "CatLog | Enzyme Kinetics Catalog";
    const currentUrl = new URL(window.location.href);
    if (/^https?:$/.test(currentUrl.protocol) && /\/catlog-(latest|stats)\.html$/.test(currentUrl.pathname)) {
      const publicUrl = new URL(statsOpen ? "./catlog-stats.html" : "./catlog-latest.html", currentUrl);
      document.querySelector('link[rel="canonical"]')?.setAttribute("href", publicUrl.href);
      document.querySelector('meta[property="og:url"]')?.setAttribute("content", publicUrl.href);
      document.querySelector('meta[property="og:title"]')?.setAttribute("content", document.title);
    }
    if (!browseOpen) {
      setFiltersOpen(false);
      resetDetail();
      hideSuggestions();
    } else {
      window.requestAnimationFrame(updateTableScrollControls);
    }
    if (scroll) {
      if (guideOpen) $("guideView").scrollTop = 0;
      if (statsOpen) {
        $("statsView").scrollTop = 0;
        $("statsHeading").focus({ preventScroll: true });
      }
      window.scrollTo({
        top: 0,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    }
  }

  function viewUrl(view) {
    const url = new URL(window.location.href);
    // Deployment checks belong in requests, not copied navigation links.
    url.searchParams.delete("release");
    url.searchParams.delete("browser-check");
    url.hash = view === "browse" ? "" : `#${view}`;
    // Portable exports keep hash navigation; the two published entry pages share one app.
    if (/\/catlog-(latest|stats)\.html$/.test(url.pathname)) {
      url.pathname = url.pathname.replace(/catlog-(latest|stats)\.html$/, view === "stats" ? "catlog-stats.html" : "catlog-latest.html");
      if (view === "stats") url.hash = "";
    }
    return url;
  }

  function navigateTo(view) {
    const url = viewUrl(view);
    if (window.location.href !== url.href) {
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
        "without sequences or SMILES",
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
  const UNIT_NOT_RECORDED_NOTE = "No unit is recorded here, so the column unit does not apply.";

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

  function reviewStatusCounts(rows) {
    if (!state.recordsReady) return manifestDistribution("verification_status");
    const counts = {};
    rows.forEach((row) => {
      const status = row.verification_status || "unknown";
      counts[status] = (counts[status] || 0) + 1;
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
        return "Prepared from source records; no accepted review outcome is recorded.";
      case "disputed":
        return "Disputed; outside the accepted set.";
      default:
        return "No verified or corrected outcome recorded.";
    }
  }

  function reviewOutcome(summary) {
    const outcome = reviewOutcomeBase(summary);
    return isIdentityOnlyAccepted(summary) ? `${outcome} ${identityOnlyTrustNote}` : outcome;
  }

  function rowStatusLabel(row) {
    if (row.verification_status === "disputed") return "Disputed";
    if (row.verification_status === "mathematically_inferred") return "Pre-review";
    if (row.verification_status === "unverified") return "Unverified";
    if (isIdentityOnlyAccepted(row)) return "Accepted (identity only)";
    if (row.verification_status === "corrected") return "Accepted";
    if (row.verification_status === "verified") return "Accepted";
    if (row.verification_status === "manual_review_required") return "Checks pending";
    return stateConfig(row._recordState || recordStateForRow(row)).shortLabel;
  }

  function statusBadge(row) {
    const config = stateConfig(row._recordState || recordStateForRow(row));
    const isDisputed = row.verification_status === "disputed";
    const isCorrected = row.verification_status === "corrected";
    const identityOnly = isIdentityOnlyAccepted(row);
    const description = isDisputed
      ? "Disputed; outside the accepted set."
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

  function isContentHashedDataAsset(src) {
    if (!src || src.startsWith("data:")) return false;
    const pathname = new URL(src, catalogBaseUrl).pathname;
    return /\/data\/(?:(?:details|records)-\d+\.[a-f0-9]{12}\.js|details-\d+\.[a-f0-9]{12}\.jsonl\.gz|catlog-(?:table|enriched|viewer-index)\.[a-f0-9]{12}\.jsonl\.gz)$/i.test(pathname);
  }

  function isContentHashedDetailShard(src) {
    if (!src || src.startsWith("data:")) return false;
    const pathname = new URL(src, catalogBaseUrl).pathname;
    return /\/data\/details-\d+\.[a-f0-9]{12}\.js$/i.test(pathname);
  }

  function isCompressedDetailShard(src) {
    if (!src || src.startsWith("data:")) return false;
    const pathname = new URL(src, catalogBaseUrl).pathname;
    return /\/data\/details-\d+\.[a-f0-9]{12}\.jsonl\.gz$/i.test(pathname);
  }

  function discardDetailShard(src) {
    delete (window.CATLOG_DETAIL_SHARDS || {})[src];
    delete (window.CATLOG_DETAIL_SHARD_GENERATIONS || {})[src];
    state.loadedScripts.delete(src);
    state.detailShardLru.delete(src);
  }

  function versionedAssetUrl(src, retryAttempt = 0) {
    if (!src || /^(?:https?:)?\/\//.test(src) || src.startsWith("data:")) return src;
    const url = new URL(src, catalogBaseUrl);
    if (!isContentHashedDataAsset(src)) url.searchParams.set("v", assetVersion);
    if (retryAttempt > 0) url.searchParams.set("retry", String(retryAttempt));
    return url.href;
  }

  function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function loadScriptAttempt(src, ordered, retryAttempt) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.dataset.catlogShard = src;
      script.src = versionedAssetUrl(src, retryAttempt);
      script.async = !ordered;
      script.onload = () => {
        if (isContentHashedDetailShard(src)) {
          const expectedGeneration = String(manifest.source_sha256 || "");
          const actualGeneration = String(
            (window.CATLOG_DETAIL_SHARD_GENERATIONS || {})[src] || "",
          );
          if (!expectedGeneration || actualGeneration !== expectedGeneration) {
            discardDetailShard(src);
            script.remove();
            reject(new Error(`Detail shard ${src} does not match the CatLog source generation`));
            return;
          }
        }
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

  function parseCompressedDetailShard(payload, src) {
    const lines = String(payload || "").split(/\r?\n/);
    if (lines.at(-1) === "") lines.pop();
    if (!lines.length || lines.some((line) => !line)) {
      throw new Error(`Detail shard ${src} has an invalid JSONL layout`);
    }

    let header;
    try {
      header = JSON.parse(lines[0]);
    } catch (_error) {
      throw new Error(`Detail shard ${src} has an invalid JSON header`);
    }
    const headerKeys = header && typeof header === "object" && !Array.isArray(header)
      ? Object.keys(header).sort()
      : [];
    const expectedHeaderKeys = ["kind", "record_count", "schema_version", "source_sha256"];
    if (headerKeys.length !== expectedHeaderKeys.length
        || headerKeys.some((key, index) => key !== expectedHeaderKeys[index])
        || header.kind !== "catlog_detail_shard"
        || header.schema_version !== 1
        || !Number.isInteger(header.record_count)
        || header.record_count < 0
        || !/^[a-f0-9]{64}$/.test(header.source_sha256 || "")) {
      throw new Error(`Detail shard ${src} has an invalid header`);
    }
    if (header.source_sha256 !== String(manifest.source_sha256 || "")) {
      throw new Error(`Detail shard ${src} does not match the CatLog source generation`);
    }

    const shard = Object.create(null);
    for (const line of lines.slice(1)) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch (_error) {
        throw new Error(`Detail shard ${src} contains invalid JSON`);
      }
      if (!Array.isArray(entry)
          || entry.length !== 2
          || typeof entry[0] !== "string"
          || !entry[0]
          || !entry[1]
          || typeof entry[1] !== "object"
          || Array.isArray(entry[1])) {
        throw new Error(`Detail shard ${src} contains an invalid record entry`);
      }
      if (Object.prototype.hasOwnProperty.call(shard, entry[0])) {
        throw new Error(`Detail shard ${src} contains a duplicate record key`);
      }
      shard[entry[0]] = entry[1];
    }
    if (Object.keys(shard).length !== header.record_count) {
      throw new Error(`Detail shard ${src} record count does not match its header`);
    }
    return { shard, sourceSha256: header.source_sha256 };
  }

  async function loadCompressedDetailShardAttempt(src, retryAttempt) {
    if (typeof window.fetch !== "function"
        || typeof window.DecompressionStream !== "function"
        || typeof window.TextDecoder !== "function"
        || typeof window.AbortController !== "function") {
      throw new Error("This browser cannot read compressed CatLog detail shards");
    }
    discardDetailShard(src);
    const controller = new window.AbortController();
    const timeoutError = new Error("The record download took too long. Try again.");
    let timer;
    let reader;
    const deadline = new Promise((_, reject) => {
      timer = window.setTimeout(() => {
        controller.abort();
        reject(timeoutError);
      }, DETAIL_REQUEST_TIMEOUT_MS);
    });
    try {
      const response = await Promise.race([
        window.fetch(versionedAssetUrl(src, retryAttempt), { signal: controller.signal }),
        deadline,
      ]);
      if (!response?.ok || !response.body) {
        throw new Error(`Could not load ${src} (HTTP ${response?.status || "error"})`);
      }

      reader = response.body.pipeThrough(new window.DecompressionStream("gzip")).getReader();
      let payload = "";
      try {
        const decoder = new window.TextDecoder("utf-8", { fatal: true });
        while (true) {
          const { value, done } = await Promise.race([reader.read(), deadline]);
          if (done) break;
          payload += decoder.decode(value, { stream: true });
        }
        payload += decoder.decode();
      } catch (_error) {
        try {
          // A stalled cancellation must not hold up the existing retry flow.
          await Promise.race([reader.cancel(), deadline]);
        } catch (_cancelError) {
          // The decompressor may already be in an errored state.
        }
        if (controller.signal.aborted) throw timeoutError;
        throw new Error(`Detail shard ${src} could not be decompressed or decoded`);
      }

      const parsed = parseCompressedDetailShard(payload, src);
      window.CATLOG_DETAIL_SHARDS = window.CATLOG_DETAIL_SHARDS || {};
      window.CATLOG_DETAIL_SHARD_GENERATIONS = window.CATLOG_DETAIL_SHARD_GENERATIONS || {};
      window.CATLOG_DETAIL_SHARDS[src] = parsed.shard;
      window.CATLOG_DETAIL_SHARD_GENERATIONS[src] = parsed.sourceSha256;
    } finally {
      window.clearTimeout(timer);
      try {
        reader?.releaseLock();
      } catch (_releaseError) {
        // A failed reader still must not replace the original load error.
      }
    }
  }

  function loadWithRetries(src, attemptLoader, { onRetry = null } = {}) {
    if (state.loadedScripts.has(src)) return Promise.resolve();
    if (state.loadingScripts.has(src)) return state.loadingScripts.get(src);
    const pending = (async () => {
      let lastError = null;
      for (let attempt = 0; attempt <= LOAD_RETRY_DELAYS.length; attempt += 1) {
        try {
          await attemptLoader(src, attempt);
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

  function loadScript(src, ordered = false, { onRetry = null } = {}) {
    return loadWithRetries(
      src,
      (assetSrc, retryAttempt) => loadScriptAttempt(assetSrc, ordered, retryAttempt),
      { onRetry },
    );
  }

  function loadDetailShard(src, { onRetry = null } = {}) {
    if (isCompressedDetailShard(src)) {
      return loadWithRetries(src, loadCompressedDetailShardAttempt, { onRetry });
    }
    return loadScript(src, false, { onRetry });
  }

  function retainDetailShard(src) {
    const shards = window.CATLOG_DETAIL_SHARDS || {};
    if (!src || !Object.prototype.hasOwnProperty.call(shards, src)) return;
    state.detailShardLru.delete(src);
    state.detailShardLru.set(src, true);
    while (state.detailShardLru.size > DETAIL_SHARD_CACHE_LIMIT) {
      const oldest = state.detailShardLru.keys().next().value;
      state.detailShardLru.delete(oldest);
      discardDetailShard(oldest);
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
    document.body.classList.add("catalog-load-failed");
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
    if ($("clearResultsButton")) $("clearResultsButton").hidden = true;
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

    try {
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
    } catch (error) {
      try {
        await reader.cancel();
      } catch (_cancelError) {
        // The decompressor may already be in an errored state.
      }
      throw error;
    } finally {
      try {
        reader.releaseLock();
      } catch (_releaseError) {
        // Keep the original download or parse error.
      }
    }
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
          "Retrying table download",
          `The download was interrupted. Trying again in ${delaySeconds} seconds.`,
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

  async function retryRecordChunks() {
    state.recordsReady = false;
    state.recordChunksLoaded = 0;
    state.recordChunksTotal = Number(manifest.total_rows || 0);
    state.loadProgressUnit = "records";
    $("catalogLoadProgress")?.classList.remove("stalled", "complete");
    updateLoadProgress();
    try {
      await loadRecordChunks();
      syncDetailPanelAccessibility();
    } catch (error) {
      state.recordsReady = false;
      state.recordChunksLoaded = 0;
      updateLoadProgress();
      showLoadNotice(
        "CatLog records are temporarily unavailable",
        error?.message || String(error),
        { actionLabel: "Try again", onAction: retryRecordChunks },
      );
    }
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
      await ensureCurrentFilters();
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
            "Open the hosted CatLog site, or serve this folder over HTTP. This web-only copy does not include an offline snapshot.",
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
          { actionLabel: "Try again", onAction: retryRecordChunks },
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
    await ensureCurrentFilters({ resetPage: false });
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
    await loadDetailShard(row.detail_shard, { onRetry });
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
        source_license: sourceLicense(row, details[index]) || null,
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
          license_note: SOURCE_LICENSE_NOTE,
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
    const coverage = summary.coverage || {};
    const rows = Array.isArray(rowsForSummary()) ? rowsForSummary() : [];
    const isLoaded = state.recordsReady;
    const totalRows = isLoaded ? rows.length : (manifest.total_rows || 0);
    const cards = [
      [isLoaded && rows.length !== state.records.length ? "Matching records" : "Records", totalRows],
      ["Accepted", recordStateCounts(rows).accepted || 0],
    ];
    const countHtml = ([label, value]) => `
      <div class="summary-card">
        <span>${escapeHtml(label)}</span>
        <strong>${formatCount(value)}</strong>
      </div>
    `;
    $("summaryGrid").innerHTML = cards.map(countHtml).join("");
    const kcatRows = isLoaded ? metricCoverage(rows, "kcat") : coverage.with_kcat;
    const kmRows = isLoaded ? metricCoverage(rows, "km") : coverage.with_km;
    const efficiencyRows = isLoaded ? metricCoverage(rows, "kcat_over_km") : coverage.with_kcat_over_km;
    $("snapshotMeta").innerHTML = `
      <span class="snapshot-title">Rows with values</span>
      <span class="snapshot-line"><span><i>k</i><sub>cat</sub></span><strong>${formatCount(kcatRows)}</strong></span>
      <span class="snapshot-line"><span><i>K</i><sub>m</sub></span><strong>${formatCount(kmRows)}</strong></span>
      <span class="snapshot-line"><span><i>k</i><sub>cat</sub>/<i>K</i><sub>m</sub></span><strong>${formatCount(efficiencyRows)}</strong></span>
    `;
    $("snapshotDate").textContent = manifest.generated_at ? `Snapshot ${formatDate(manifest.generated_at)}` : "Snapshot date unavailable";
    $("snapshotDate").title = manifest.content_sha256 || manifest.source_sha256 || "";
  }

  function statsShare(count, total) {
    if (!total) return EMPTY_VALUE;
    const percent = count / total * 100;
    return percent > 0 && percent < 0.1 ? "<0.1%" : `${percent.toFixed(1)}%`;
  }

  function statsBarRows(items, total, { missing = false } = {}) {
    return `<ol class="stats-bars${missing ? " stats-bars-coverage" : ""}">${items.map((item) => {
      const width = total ? Math.max(0, Math.min(100, item.count / total * 100)) : 0;
      return `<li data-stat-key="${escapeHtml(item.value)}" data-count="${item.count}">
        <span class="stats-bar-label">${escapeHtml(item.label)}${item.description ? `<small>${escapeHtml(item.description)}</small>` : ""}</span>
        <span class="stats-bar-track" aria-hidden="true"><span class="stats-bar-fill stats-color-${item.color || "source"}" style="width:${width}%"></span></span>
        <span class="stats-bar-count">${formatInteger(item.count)}<span class="visually-hidden"> records</span></span>
        <span class="stats-bar-share">${escapeHtml(statsShare(item.count, total))}<span class="visually-hidden"> of all records</span></span>
        ${missing ? `<span class="stats-bar-missing">${formatInteger(total - item.count)}<span class="visually-hidden"> not included</span></span>` : ""}
      </li>`;
    }).join("")}</ol>`;
  }

  function statsReviewRing(items, total, center = formatInteger(total), caption = "records") {
    // Exact angular shares; tiny categories remain in the adjacent count list.
    let offset = 0;
    const slices = items.map((item) => {
      const share = total > 0 ? item.count / total * 100 : 0;
      const slice = `<circle class="stats-ring-${item.color}" cx="100" cy="100" r="82" pathLength="100" stroke-dasharray="${share} ${100 - share}" stroke-dashoffset="${-offset}"><title>${escapeHtml(item.label || (item.color === "base" ? "Without this field" : "Included"))}: ${formatInteger(item.count)} of ${formatInteger(total)}</title></circle>`;
      offset += share;
      return share > 0 ? slice : "";
    }).join("");
    const complete = items.reduce((sum, item) => sum + item.count, 0) === total;
    return `<div class="stats-review-ring" aria-hidden="true">
      <svg viewBox="0 0 200 200"><circle class="stats-ring-base" cx="100" cy="100" r="82" />${complete ? slices : ""}</svg>
      <div><strong>${escapeHtml(center)}</strong><span>${escapeHtml(caption)}</span></div>
    </div>`;
  }

  function statsLegend(items, total, className = "", scope = "of all records") {
    return `<div class="stats-chart-legend ${className}"><div class="stats-outcome-head" aria-hidden="true"><span></span><span>Records</span><span>Share</span></div><ul>${items.map((item) => `<li data-stat-key="${escapeHtml(item.value)}" data-count="${item.count}">
      <span class="stats-outcome-label"><i class="stats-color-${item.color}" aria-hidden="true"></i>${className === "stats-review-legend" ? `<button type="button" class="stats-status-link" data-stats-cohort="${escapeHtml(item.value)}" aria-controls="statsReviewDetails" aria-pressed="${item.value === state.statsCohort}">${escapeHtml(item.label)}</button>` : className === "stats-combination-legend" ? `<button type="button" class="stats-status-link" data-stats-cohort="${escapeHtml(state.statsCohort)}" data-stats-field="${item.value}" aria-controls="statsReviewFigure" aria-pressed="${item.value === state.statsField}">${escapeHtml(item.label)}</button>` : escapeHtml(item.label)}</span>
      <strong>${formatInteger(item.count)}<span class="visually-hidden"> records</span></strong>
      <span>${escapeHtml(statsShare(item.count, total))}<span class="visually-hidden"> ${escapeHtml(scope)}</span></span>
    </li>`).join("")}</ul></div>`;
  }

  function statsFieldRings(fields, total) {
    return `<div class="stats-field-rings">${fields.map((item) => `<figure data-stat-key="${escapeHtml(item.value)}" data-count="${item.count}" data-total="${total}">
      <figcaption>${escapeHtml(item.label)}</figcaption>
      ${statsReviewRing([{ count: item.count, color: item.color }, { count: total - item.count, color: "base" }], total, statsShare(item.count, total), "included")}
      <div class="stats-field-count">${formatInteger(item.count)} records</div>
      <div class="stats-field-remainder">${formatInteger(total - item.count)} without this field</div>
      <span class="visually-hidden">${escapeHtml(statsShare(item.count, total))} included, out of ${formatInteger(total)} records. Without this field means no value in this download.</span>
    </figure>`).join("")}</div>`;
  }

  function statsFollowupCoverage(total) {
    const audit = manifest.summary?.followup_coverage;
    if (!audit || audit.cohort !== "manual_review_required" || !audit.source_sha256 || !audit.download_sha256 || audit.source_sha256 !== manifest.source_sha256
      || audit.download_sha256 !== manifest.enriched_download?.sha256 || audit.total !== total) return "";
    const fields = [["with_kinetic_value", "Kinetic value", "kinetic"], ["with_literature_id", "Paper ID", "reference"], ["with_sequence", "Protein sequence", "protein"], ["with_smiles", "Substrate SMILES", "structure"]];
    if (!fields.every(([key]) => Number.isInteger(audit[key]) && audit[key] >= 0 && audit[key] <= total)) return "";
    return `<div class="stats-followup-coverage"><p>All ${formatInteger(total)} follow-up records.</p>
      ${statsFieldRings(fields.map(([key, label, color]) => ({ value: key, label, color, count: audit[key] })), total)}
      <p>Fields included, not reasons for follow-up. Kinetic value means kcat, Km, Ki or kcat/Km.</p></div>`;
  }

  function statsCohortData(cohort, total) {
    const audit = manifest.summary?.review_details;
    if (!audit?.source_sha256 || !audit.download_sha256 || audit.source_sha256 !== manifest.source_sha256
      || audit.download_sha256 !== manifest.enriched_download?.sha256) return null;
    const group = audit.groups?.[cohort];
    const fields = ["with_kinetic_value", "with_literature_id", "with_sequence", "with_smiles"];
    const material = ["paper_excerpt", "source_note", "paper_id", "database_record"];
    if (!group || group.total !== total || !fields.every((key) => Number.isInteger(group[key]) && group[key] >= 0 && group[key] <= total)
      || !material.every((key) => Number.isInteger(group.material?.[key]) && group.material[key] >= 0)
      || material.reduce((sum, key) => sum + group.material[key], 0) !== total) return null;
    return group;
  }

  function statsCoverageParts(group) {
    const fields = [
      ["sequence", "Protein sequence", "with_sequence", "protein"],
      ["smiles", "Substrate SMILES", "with_smiles", "structure"],
      ["paper_id", "Paper ID", "with_literature_id", "reference"],
      ["kinetic_value", "Kinetic value", "with_kinetic_value", "measurement"],
    ];
    const combinations = group.field_combinations;
    if (!Array.isArray(combinations)) return "";
    const keys = new Set();
    const valid = combinations.every((item) => {
      if (!Array.isArray(item.missing) || !Number.isInteger(item.count) || item.count < 1
        || new Set(item.missing).size !== item.missing.length
        || !item.missing.every((key) => fields.some(([field]) => field === key))) return false;
      const key = [...item.missing].sort().join("+");
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    });
    if (!valid || combinations.reduce((sum, item) => sum + item.count, 0) !== group.total
      || !fields.every(([key, , countKey]) => combinations.reduce((sum, item) => sum + (item.missing.includes(key) ? item.count : 0), 0) === group.total - group[countKey])) return "";
    const complete = combinations.find((item) => !item.missing.length)?.count || 0;
    const multiple = combinations.filter((item) => item.missing.length > 1).sort((a, b) => b.count - a.count);
    const multipleCount = multiple.reduce((sum, item) => sum + item.count, 0);
    const slices = [
      { value: "complete", label: "All four fields available", count: complete, color: "kinetic" },
      ...fields.map(([key, , , color]) => ({ value: `only_${key}`,
        label: ({ sequence: "Only sequence missing", smiles: "Only SMILES missing", paper_id: "Only paper ID missing", kinetic_value: "Only kinetic value missing" })[key], color,
        count: combinations.find((item) => item.missing.length === 1 && item.missing[0] === key)?.count || 0 })),
      { value: "multiple", label: "Two or more fields missing", count: multipleCount, color: "calculated" },
    ];
    const names = Object.fromEntries(fields.map(([key, label]) => [key, label]));
    return { fields, slices, multiple, multipleCount, names };
  }

  function statsCombinedCoverage(group) {
    const parts = statsCoverageParts(group);
    if (!parts) return "";
    const { fields, slices, multiple, multipleCount, names } = parts;
    return `${statsLegend(slices, group.total, "stats-combination-legend", "of this group")}
      <p>Available fields do not mean the record is accepted. Missing means absent from this download, not rejected.</p>
      <details class="stats-explanation stats-missing-totals"><summary>Missing by field</summary><table class="stats-detail-table">
        <thead><tr><th>Field</th><th>Records</th><th>Share</th></tr></thead><tbody>
          ${fields.map(([key, label, countKey]) => `<tr data-field="${key}" data-missing="${group.total - group[countKey]}"><th scope="row">${label}</th><td>${formatInteger(group.total - group[countKey])}</td><td>${statsShare(group.total - group[countKey], group.total)}</td></tr>`).join("")}
        </tbody></table><p>These totals overlap: a row can lack both a sequence and SMILES.</p>
      </details>${multipleCount ? `<details class="stats-explanation stats-combination-details"><summary>Missing together: ${formatInteger(multipleCount)} records</summary>
      <table class="stats-detail-table"><thead><tr><th>Missing fields</th><th>Records</th></tr></thead><tbody>
        ${multiple.map((item) => `<tr><th scope="row">${item.missing.map((key) => names[key]).join(" + ")}</th><td>${formatInteger(item.count)}</td></tr>`).join("")}
      </tbody></table></details>` : ""}`;
  }

  function statsNestedReviewRing(outcomes, total) {
    if (!total || outcomes.reduce((sum, item) => sum + item.count, 0) !== total) return statsReviewRing(outcomes, total);
    let offset = 0;
    const arcs = outcomes.map((item) => {
      const start = offset;
      const share = item.count / total * 100;
      offset += share;
      if (!share) return "";
      const group = statsCohortData(item.value, item.count);
      const parts = group && statsCoverageParts(group);
      const label = `${item.label}: ${formatInteger(item.count)} records, ${statsShare(item.count, total)} of all records`;
      const inner = `<circle class="stats-ring-${item.color}" data-outcome="${escapeHtml(item.value)}" data-count="${item.count}" data-chart-cohort="${escapeHtml(item.value)}" role="button" tabindex="0" aria-controls="statsReviewDetails" aria-label="${escapeHtml(label)}" aria-pressed="${item.value === state.statsCohort}" cx="120" cy="120" r="73" pathLength="100" stroke-width="24" stroke-dasharray="${share} ${100 - share}" stroke-dashoffset="${-start}"><title>${escapeHtml(label)}</title></circle>`;
      let fieldOffset = start;
      const outer = parts ? parts.slices.map((field) => {
        const fieldShare = field.count / total * 100;
        const fieldStart = fieldOffset;
        fieldOffset += fieldShare;
        const fieldLabel = `${item.label}: ${field.label}, ${formatInteger(field.count)} records, ${statsShare(field.count, item.count)} of this group`;
        return field.count ? `<circle class="stats-ring-${field.color}" data-field-group="${escapeHtml(item.value)}" data-field-slice="${field.value}" data-count="${field.count}" data-chart-cohort="${escapeHtml(item.value)}" data-chart-field="${field.value}" role="button" tabindex="0" aria-controls="statsReviewDetails" aria-label="${escapeHtml(fieldLabel)}" aria-pressed="${item.value === state.statsCohort && field.value === state.statsField}" cx="120" cy="120" r="104" pathLength="100" stroke-width="22" stroke-dasharray="${fieldShare} ${100 - fieldShare}" stroke-dashoffset="${-fieldStart}"><title>${escapeHtml(fieldLabel)}</title></circle>` : "";
      }).join("") : "";
      return `${inner}<g data-review-group="${escapeHtml(item.value)}" class="stats-outer-group${item.value === state.statsCohort ? " selected" : ""}">${outer}</g>`;
    }).join("");
    return `<div class="stats-nested-ring"><svg viewBox="0 0 240 240" role="group" aria-label="Review outcomes and available fields">${arcs}</svg>
      <div aria-hidden="true"><strong id="statsRingCount">${formatInteger(total)}</strong><span id="statsRingLabel">records</span></div></div>`;
  }

  function syncStatsRingSelection() {
    document.querySelectorAll(".stats-outer-group").forEach((group) => {
      group.classList.toggle("selected", group.dataset.reviewGroup === state.statsCohort);
    });
    document.querySelectorAll("[data-stats-cohort], [data-chart-cohort]").forEach((button) => {
      const cohort = button.dataset.statsCohort || button.dataset.chartCohort;
      const field = button.dataset.statsField || button.dataset.chartField;
      button.setAttribute("aria-pressed", String(cohort === state.statsCohort && (!field || field === state.statsField)));
    });
    document.querySelectorAll(".stats-combination-legend li").forEach((row) => {
      row.classList.toggle("is-selected", row.dataset.statKey === state.statsField);
    });
  }

  function selectStatsGroup(cohort, field = "") {
    const changed = cohort !== state.statsCohort;
    state.statsCohort = cohort;
    state.statsField = field;
    const panel = $("statsReviewDetails");
    if (changed) {
      const openClasses = [...panel.querySelectorAll("details[open]")].map((item) => item.className);
      panel.innerHTML = statsReviewDetails(manifestDistribution("verification_status"));
      panel.querySelectorAll("details").forEach((item) => { item.open = openClasses.includes(item.className); });
    }
    panel.querySelectorAll('input[name="statsCohort"]').forEach((input) => { input.checked = input.value === cohort; });
    if (field === "multiple") {
      const details = panel.querySelector(".stats-combination-details");
      if (details) details.open = true;
    }
    syncStatsRingSelection();
    const arc = [...document.querySelectorAll("[data-chart-cohort]")].find((item) =>
      item.dataset.chartCohort === cohort && (item.dataset.chartField || "") === field);
    $("statsChartAnnouncement").textContent = arc?.getAttribute("aria-label") || "";
    const legend = field ? ".stats-combination-legend" : ".stats-review-legend";
    const row = [...document.querySelectorAll(`${legend} li`)].find((item) => item.dataset.statKey === (field || cohort));
    if (row) {
      $("statsRingCount").textContent = formatInteger(Number(row.dataset.count));
      $("statsRingLabel").textContent = row.querySelector(".stats-status-link").textContent;
    }
  }

  function statsReviewDetails(counts) {
    if (state.statsCohort === "accepted") {
      const accepted = (counts.verified || 0) + (counts.corrected || 0);
      const identityOnly = manifestDistribution("public_trust_basis").identity_only || 0;
      return `<h3 id="fieldsGroupHeading">Accepted records</h3><p>${formatInteger(accepted)} records: verified or corrected.</p>
        <table class="stats-detail-table"><tbody>
          <tr><th scope="row">Accepted as reported</th><td>${formatInteger(counts.verified || 0)}</td></tr>
          <tr><th scope="row">Accepted after a change</th><td>${formatInteger(counts.corrected || 0)}</td></tr>
        </tbody></table><p>A change may concern the value, sequence or another field.</p>
        ${identityOnly ? `<p class="stats-note">${formatInteger(identityOnly)} have identity checks only; that status does not confirm their kinetic values.</p>` : ""}`;
    }
    if (["disputed", "other_status"].includes(state.statsCohort)) {
      const disputed = state.statsCohort === "disputed";
      const known = new Set(reviewStatuses.map((item) => item.value));
      const total = disputed ? counts.disputed || 0 : Object.entries(counts).reduce((sum, [key, count]) => sum + (known.has(key) ? 0 : count), 0);
      return `<h3 id="fieldsGroupHeading">${disputed ? "Disputed records" : "Other review statuses"}</h3>
        <p>${formatInteger(total)} records.</p><p>${disputed ? "Flagged during review. This is separate from records awaiting a check." : "Statuses outside the named review groups."}</p>`;
    }
    const cohort = ["unverified", "mathematically_inferred"].includes(state.statsCohort) ? state.statsCohort : "manual_review_required";
    const total = counts[cohort] || 0;
    const group = statsCohortData(cohort, total);
    const label = ({ unverified: "Unverified", mathematically_inferred: "Pre-review", manual_review_required: "Follow-up" })[cohort];
    const fields = [["with_kinetic_value", "Kinetic value", "kinetic"], ["with_literature_id", "Paper ID", "reference"],
      ["with_sequence", "Protein sequence", "protein"], ["with_smiles", "Substrate SMILES", "structure"]];
    return `<h3 id="fieldsGroupHeading">Fields in these records</h3><fieldset class="stats-cohort-switch"><legend class="visually-hidden">Record group</legend>
      ${[["manual_review_required", "Follow-up"], ["unverified", "Unverified"], ["mathematically_inferred", "Pre-review"]].map(([value, name]) => `<label>
        <input type="radio" name="statsCohort" value="${value}" ${cohort === value ? "checked" : ""}>
        <span>${name}<small>${formatInteger(counts[value] || 0)}</small></span></label>`).join("")}</fieldset>
      <div class="stats-followup-coverage" data-cohort="${cohort}">
        <p class="stats-coverage-intro">${escapeHtml(label)}: ${formatInteger(total)} records. Share within this group.</p>
        ${group ? statsCombinedCoverage(group) || statsFieldRings(fields.map(([key, name, color]) => ({ value: key, label: name, color, count: group[key] })), total)
          : cohort === "manual_review_required" ? statsFollowupCoverage(total) : "<p>This snapshot has no checked field breakdown for this group.</p>"}
      </div>
      <p class="stats-cohort-meaning">${cohort === "mathematically_inferred"
        ? "Prepared from source records, without an accepted review. This does not mean every value was calculated. Accepted records can also have calculated ratios."
        : cohort === "unverified"
        ? "No acceptance is recorded. Unverified does not mean rejected. Review may have been attempted."
        : "Another check is needed before acceptance, for example on a value, protein or substrate."}</p>
      <details class="stats-explanation stats-cohort-example"><summary>Example checks</summary><dl class="stats-check-examples">
          <div><dt>Protein</dt><dd>For L431F, does the sequence contain that change?</dd></div>
          <div><dt>Substrate</dt><dd>Does the SMILES match the named compound and isomer?</dd></div>
          <div><dt>Measurement</dt><dd>Is 0.82 &micro;M from the same enzyme and assay? In mM, it is 0.00082.</dd></div>
        </dl><p>Illustrative checks. The snapshot does not contain a reason-by-reason tally.</p></details>
      <p class="stats-note">Fields do not explain the review decision. Paper ID means DOI or PMID; kinetic value means kcat, Km, Ki or kcat/Km.</p>`;
  }

  function renderStats() {
    // Immutable snapshot metadata: Stats must not mix filtered and full-download counts.
    const total = Number(manifest.total_rows || 0);
    const counts = manifestDistribution("verification_status");
    const statuses = [...reviewStatuses];
    const knownStatuses = new Set(statuses.map((item) => item.value));
    const otherCount = Object.entries(counts).reduce((total, [key, count]) => total + (knownStatuses.has(key) ? 0 : count), 0);
    if (otherCount) {
      counts.other_status = otherCount;
      statuses.push({ value: "other_status", label: "Other status", description: "Not in the six outcomes listed above." });
    }
    const colors = { verified: "verified", corrected: "corrected", manual_review_required: "pending", unverified: "neutral", mathematically_inferred: "calculated", disputed: "disputed" };
    const accepted = (counts.verified || 0) + (counts.corrected || 0);
    const outcomes = [
      { value: "accepted", label: "Accepted", count: accepted, color: "verified", description: "Verified or corrected" },
      ...statuses.filter((item) => !["verified", "corrected"].includes(item.value)).map((item) => ({
        ...item, label: item.value === "manual_review_required" ? "Follow-up" : item.label,
        description: item.value === "manual_review_required" ? "Additional checks; not rejected" : item.value === "unverified" ? "No accepted decision recorded" : "",
        count: counts[item.value] || 0, color: colors[item.value] || "neutral",
      })),
    ];
    const summary = manifest.summary || {};
    const metrics = summary.coverage || {};
    const fullCoverage = manifest.enriched_download?.coverage || {};
    const fields = [
      ["kcat", "kcat", metrics.with_kcat, "kinetic"], ["km", "Km", metrics.with_km, "kinetic"], ["kcat_over_km", "kcat/Km", metrics.with_kcat_over_km, "kinetic"],
      ["sequence", "Protein sequence", fullCoverage.sequence, "protein"], ["smiles", "Substrate SMILES", fullCoverage.smiles, "structure"],
    ].filter(([, , count]) => Number.isInteger(count) && count >= 0 && count <= total)
      .map(([value, label, count, color]) => ({ value, label, count, color }));
    const sequences = [["Protein sequence", fullCoverage.sequence], ["Wild-type sequence", fullCoverage.wild_type_sequence], ["Variant sequence", fullCoverage.variant_sequence]]
      .filter(([, count]) => Number.isInteger(count) && count >= 0 && count <= total);
    // Exclusive source_db values, not the overlapping source-database link totals.
    const recordedSources = manifestDistribution("source_db");
    const sourceNames = [["brenda", "BRENDA", "reference"], ["oed", "Open Enzyme Database", "kinetic"], ["uniprot", "UniProt", "protein"], ["sabio_rk", "SABIO-RK", "structure"], ["skid", "SKiD", "calculated"]];
    const namedSources = new Set(sourceNames.map(([key]) => key));
    const databases = sourceNames.filter(([key]) => recordedSources[key] > 0)
      .map(([key, label, color]) => ({ value: `source_${key}`, label: `${label} only`, count: recordedSources[key], color }));
    const otherSources = Object.entries(recordedSources).filter(([key, count]) => !namedSources.has(key) && count > 0);
    const otherSourcesCount = otherSources.reduce((sum, [, count]) => sum + count, 0);
    const otherSourceGroups = new Map();
    for (const [key, count] of otherSources) {
      const namedParts = key.split(/[;,/+\s]+/).filter(Boolean);
      const label = ({ primary_paper_direct: "Directly from papers", unknown: "Unspecified", strenda: "STRENDA DB", merged: "Mixed, without named databases", mixed: "Mixed, without named databases" })[key]
        || (namedParts.length > 1 && namedParts.every((part) => namedSources.has(part)) ? "Multiple named databases" : key);
      otherSourceGroups.set(label, (otherSourceGroups.get(label) || 0) + count);
    }
    if (otherSourcesCount) databases.push({ value: "source_other", label: "Other or multiple", count: otherSourcesCount, color: "neutral" });
    const identityOnly = manifestDistribution("public_trust_basis").identity_only || 0;
    const totals = summary.totals || {};
    $("statsScope").textContent = `All ${formatInteger(total)} records, before filtering.`;
    $("statsDate").textContent = manifest.generated_at ? `Snapshot ${formatDate(manifest.generated_at)}` : "Snapshot date unavailable";
    $("statsTotals").innerHTML = [["Records", total], ["Accepted", accepted], ["Enzyme names", totals.unique_enzymes], ["EC numbers", totals.unique_ec_numbers], ["Organisms", totals.unique_organisms]]
      .map(([label, value]) => `<div><dt>${label}</dt><dd>${formatCount(value)}</dd></div>`).join("");
    $("statsCharts").innerHTML = `
      <section class="stats-section stats-review-section stats-wide" aria-labelledby="reviewChartTitle">
        <h2 id="reviewChartTitle">Review outcomes</h2>
        <p>Record status, not a measure of work completed.</p>
        <div class="stats-review-workspace">
          <div class="stats-review-overview"><div class="stats-review-layout">
            <div class="stats-nested-figure"><div id="statsReviewFigure">${statsNestedReviewRing(outcomes, total)}</div>
              <div id="statsChartAnnouncement" class="visually-hidden" role="status" aria-atomic="true"></div>
              <p>Outcomes inside; fields outside.</p>
              <p class="stats-note">Field splits are available for Follow-up, Unverified and Pre-review.</p>
            </div>
            ${statsLegend(outcomes, total, "stats-review-legend")}
          </div>
        <div class="stats-accepted-split"><h3>Both count as accepted</h3><dl>
          <div data-stat-key="verified" data-count="${counts.verified || 0}"><dt>Accepted as reported</dt><dd>${formatInteger(counts.verified || 0)}</dd></div>
          <div data-stat-key="corrected" data-count="${counts.corrected || 0}"><dt>Accepted after a change</dt><dd>${formatInteger(counts.corrected || 0)}</dd></div>
        </dl><p>A change may concern the value, sequence or another field.</p></div>
        <p class="stats-note">${identityOnly ? `${formatInteger(identityOnly)} accepted records have identity checks only; their kinetic values are not confirmed by that status.` : ""}</p>
        <details class="stats-explanation"><summary>How these groups differ</summary><p>Accepted combines Verified and Corrected. Follow-up requests another check. Unverified has no accepted result recorded. Pre-review is the legacy source-preparation status, previously labelled Calculated. Disputed records were flagged by review.</p></details>
          </div>
          <div id="statsReviewDetails" class="stats-followup-section" aria-labelledby="fieldsGroupHeading">${statsReviewDetails(counts)}</div>
        </div>
      </section>
      <section class="stats-section stats-field-section stats-wide" aria-labelledby="fieldsChartTitle">
        <h2 id="fieldsChartTitle">Included in the full download</h2>
        <p>All ${formatInteger(total)} records.</p>
        ${statsFieldRings(fields, total)}
        <p class="stats-note">The pale remainder means no value in this download, not rejection.</p>
        <details class="stats-explanation"><summary>Sequence fields</summary><table class="stats-detail-table">
          <thead><tr><th>Field</th><th>Included</th><th>Share of all records</th></tr></thead>
          <tbody>${sequences.map(([label, count]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${formatInteger(count)}</td><td>${escapeHtml(statsShare(count, total))}</td></tr>`).join("")}</tbody>
        </table><p>These fields overlap. A wild-type record need not have a variant sequence.</p></details>
      </section>
      <section class="stats-section stats-database-section stats-wide" aria-labelledby="databaseChartTitle">
        <h2 id="databaseChartTitle">Recorded database source</h2>
        <p>One group per record, using its recorded source field.</p>
        ${databases.length ? `<div class="stats-review-layout">${statsReviewRing(databases, total)}${statsLegend(databases, total)}</div>` : "<p>Source breakdown unavailable in this snapshot.</p>"}
        ${otherSourcesCount ? `<details class="stats-explanation"><summary>Other or multiple sources: ${formatInteger(otherSourcesCount)} records</summary><table class="stats-detail-table"><tbody>
          ${[...otherSourceGroups].map(([label, count]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${formatInteger(count)}</td></tr>`).join("")}
        </tbody></table></details>` : ""}
        <p class="stats-note">This is not a count of every database that contributed to a record.</p>
      </section>
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
    window.clearTimeout(state.suggestionHideTimer);
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

  function scheduleSuggestionHide() {
    window.clearTimeout(state.suggestionHideTimer);
    state.suggestionHideTimer = window.setTimeout(() => {
      const box = $("searchSuggestions");
      const input = state.suggestionInputId ? $(state.suggestionInputId) : null;
      if (document.activeElement !== input && !box?.contains(document.activeElement)) {
        hideSuggestions();
      }
    }, 140);
  }

  function chooseSuggestion(input, value) {
    input.value = value || "";
    if (input.id === "globalSearchInput" && viewFromLocation() !== "browse") navigateTo("browse");
    hideSuggestions();
    input.focus();
    applyFiltersInBackground();
  }

  function moveSuggestionSelection(input, direction) {
    const box = $("searchSuggestions");
    if (!box || box.classList.contains("hidden")) showSuggestions(input);
    const buttons = [...box.querySelectorAll("button[data-value]")];
    if (!buttons.length) return;
    state.suggestionIndex = state.suggestionIndex < 0
      ? (direction < 0 ? buttons.length - 1 : 0)
      : (state.suggestionIndex + direction + buttons.length) % buttons.length;
    buttons.forEach((button, index) => button.setAttribute("aria-selected", String(index === state.suggestionIndex)));
    const selected = buttons[state.suggestionIndex];
    input.setAttribute("aria-activedescendant", selected.id);
    selected.scrollIntoView({ block: "nearest" });
  }

  function positionSuggestions(input, box) {
    const rect = input.getBoundingClientRect();
    const width = Math.min(Math.max(240, Math.round(rect.width)), window.innerWidth - 16);
    const below = Math.max(0, window.innerHeight - rect.bottom - 14);
    const above = Math.max(0, rect.top - 14);
    const openAbove = below < 160 && above > below;
    box.style.left = `${Math.max(8, Math.min(Math.round(rect.left), window.innerWidth - width - 8))}px`;
    box.style.width = `${width}px`;
    box.style.maxHeight = `${Math.min(320, openAbove ? above : below)}px`;
    box.style.top = openAbove ? "auto" : `${Math.round(rect.bottom + 6)}px`;
    box.style.bottom = openAbove ? `${Math.round(window.innerHeight - rect.top + 6)}px` : "auto";
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
    positionSuggestions(input, box);
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
    document.body.classList.remove("catalog-load-failed");
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
      : (state.recordsReady ? "No matching records" : "Loading first records...");
    if ($("clearResultsButton")) $("clearResultsButton").hidden = !state.recordsReady || pageRows.length > 0;
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
          ${enzymeFormHtml(row) ? `<span class="primary-meta">${enzymeFormHtml(row)}</span>` : ""}
        </td>
        <td>${escapeHtml(row.ec_number || EMPTY_VALUE)}</td>
        <td class="organism-cell">${escapePublic(row.organism || EMPTY_VALUE)}</td>
        <td class="substrate-cell">${escapePublic(row.substrate_name || EMPTY_VALUE)}</td>
        <td class="metric-cell"><span class="metric-with-note">${metricDisplayWithUnitHtml(row, "kcat")}${valueFlagBadgeHtml(conditionFlags(row), "kcat")}</span></td>
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
    if (isOpen) setFiltersOpen(false);
    document.body.classList.toggle("detail-open", Boolean(isOpen));
    syncDetailPanelAccessibility();
  }

  function syncDetailPanelAccessibility() {
    const panel = $("detailPanel");
    const filtersOpen = document.body.classList.contains("filters-open");
    const isModal = Boolean(!filtersOpen && narrowDetailMedia.matches && document.body.classList.contains("detail-open"));
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
    document.querySelectorAll(FILTER_INERT_SELECTOR).forEach((element) => {
      element.inert = filtersOpen || (element.id !== "detailPanel" && isModal);
    });
    const rail = $("catalogFilters");
    if (rail) rail.inert = !filtersOpen;
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
    const activeElement = document.activeElement;
    const focusCurrentHeading = () => {
      if (state.selectedKey !== key || !document.body.classList.contains("detail-open")) return;
      if (document.activeElement !== activeElement) return;
      $("detailHeading")?.focus();
    };
    if (narrowDetailMedia.matches) window.setTimeout(focusCurrentHeading, 180);
    else focusCurrentHeading();
  }

  function setFiltersOpen(isOpen) {
    const shouldOpen = Boolean(isOpen);
    hideSuggestions();
    document.body.classList.toggle("filters-open", shouldOpen);
    $("openFiltersButton")?.setAttribute("aria-expanded", String(shouldOpen));
    const rail = $("catalogFilters");
    if (rail) {
      rail.setAttribute("aria-hidden", String(!shouldOpen));
      if (shouldOpen) {
        rail.setAttribute("role", "dialog");
        rail.setAttribute("aria-modal", "true");
      } else {
        rail.removeAttribute("role");
        rail.removeAttribute("aria-modal");
      }
    }
    syncDetailPanelAccessibility();
    if (shouldOpen) {
      window.setTimeout(() => {
        if (document.body.classList.contains("filters-open") && !rail?.contains(document.activeElement)) {
          $("closeFiltersButton")?.focus({ preventScroll: true });
        }
      }, 180);
    }
  }

  function syncFilterPanel() {
    const isOpen = document.body.classList.contains("filters-open");
    $("catalogFilters")?.setAttribute("aria-hidden", String(!isOpen));
    syncDetailPanelAccessibility();
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
      const restoreFocus = focusDetail && $("detailContent").contains(document.activeElement);
      renderDetail(row, detail);
      if (restoreFocus) focusDetailHeading(key);
    } catch (error) {
      if (state.selectedKey !== key) return;
      const restoreFocus = focusDetail && $("detailContent").contains(document.activeElement);
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
      if (restoreFocus) focusDetailHeading(key);
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
    uniprot_ec_organism_mutation_ranked_match: "UniProt accession inferred from EC, organism, and variant",
    unresolved_ec_organism: "No sequence match from EC and organism",
    manual_literature_uniprot_resolution: "UniProt match from the cited paper",
    uniprot_ec_organism_unique: "UniProt accession inferred from EC and organism",
    brenda_getsequence_unique_ec_organism: "UniProt accession inferred from BRENDA EC and organism",
    multiple: "Multiple sources",
  };

  function sequenceSourceKey(value) {
    return String(value || "").trim().toLowerCase();
  }

  function isEcOrganismInferredSequenceSource(value) {
    const key = sequenceSourceKey(value);
    return key.startsWith("uniprot_ec_organism_")
      || key === "brenda_getsequence_unique_ec_organism";
  }

  function sequenceSourceLabel(value, confidence) {
    const key = sequenceSourceKey(value);
    if (!key) return "";
    const label = sequenceSourceLabels[key]
      || (key.startsWith("uniprot_ec_organism_") ? "UniProt accession inferred from EC and organism" : "")
      || key.replace(/_/g, " ").replace(/^./, (character) => character.toUpperCase());
    return typeof confidence === "number" && Number.isFinite(confidence)
      ? `${label} · confidence ${confidence}`
      : label;
  }

  function identityResolutionLabel(row) {
    const state = String(row?.identity_resolution_state || "").trim();
    if (state === "accession_resolved" && isEcOrganismInferredSequenceSource(row?.sequence_source)) {
      return "Accession inferred (EC/organism)";
    }
    return identityLabels[state] || state;
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
      return `<span class="source-efficiency-value"><span>${scientificValueHtml(item.value)}${unit}</span>${source}</span>`;
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
        <h3>Measurement</h3>
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
            <button class="copy-button" type="button" aria-live="polite" data-copy-target="${escapeHtml(targetId)}">Copy</button>
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
    const sourceProteinAccession = String(detail.source_protein_accession || summary.source_protein_accession || "").trim();
    const enzymeForm = enzymeFormLabel({ ...summary, ...detail }, { showUnknown: true });
    const sequenceVariantNote = String(detail.sequence_variant_note || summary.sequence_variant_note || "").trim();
    const sequenceSourceRecord = detail.sequence_source ? detail : summary;
    const sequenceSource = sequenceSourceLabel(sequenceSourceRecord.sequence_source, sequenceSourceRecord.sequence_source_confidence);
    const accessionLabel = proteinAccessionDatabase === "UniProt"
      ? "UniProt"
      : (proteinAccessionDatabase === "NCBI Protein" ? "NCBI Protein" : "Protein accession");
    const sequenceHtml = variantSequence
      ? `${sequenceDisclosure("Wild-type sequence", wildTypeSequence, "detailWildTypeSequence")}${sequenceDisclosure("Variant sequence", variantSequence, "detailVariantSequence")}`
      : sequenceDisclosure(wildTypeSequence ? "Wild-type sequence" : "Protein sequence", wildTypeSequence || sequence, "detailSequence");
    return `
      <section class="detail-section identity-section">
        <h3>Protein and substrate</h3>
        <div class="detail-kv">
          ${kv("Enzyme form", enzymeForm)}
          ${sequenceVariantNote ? kv("Form note", sequenceVariantNote) : ""}
          ${proteinAccession ? linkedKv(accessionLabel, proteinAccessionLink(proteinAccession, proteinAccessionDatabase)) : ""}
          ${sourceProteinAccession ? kv("Source-listed accession", sourceProteinAccession) : ""}
          ${!proteinAccession && accessionCandidates.length ? linkedKv("Candidate UniProt IDs", referenceList(accessionCandidates, uniprotLink)) : ""}
          ${sequenceSource ? kv("Sequence source", sequenceSource) : ""}
        </div>
        ${sequenceHtml}
        ${smiles ? `
          <details class="sequence-disclosure">
            <summary>SMILES</summary>
            <div class="copy-field">
              <div class="copy-field-heading">
                <span>SMILES</span>
                <button class="copy-button" type="button" aria-live="polite" data-copy-target="detailSmiles">Copy</button>
              </div>
              <code id="detailSmiles">${escapeHtml(smiles)}</code>
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
    let copied = false;
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
    } catch (error) {
      const input = document.createElement("textarea");
      input.value = value;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      try {
        input.select();
        copied = document.execCommand("copy");
      } catch (fallbackError) {
        copied = false;
      } finally {
        if (document.activeElement === input) button.focus({ preventScroll: true });
        input.remove();
      }
    }
    button.textContent = copied ? "Copied" : "Copy failed";
    window.setTimeout(() => { button.textContent = "Copy"; }, copied ? 1200 : 3000);
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
      ${molecularIdentitySection(summary, detail)}
      ${detailSection("Paper", referenceRows)}
      <details class="detail-disclosure review-notes">
        <summary>Review notes</summary>
        <p>${escapeHtml(reviewOutcome(summary))}</p>
        ${proofLines.length ? `
        <div class="evidence-note-section">
          <h3>${escapeHtml(proofHeading)}</h3>
          <div class="evidence-note-list">${evidenceNotesHtml(proofLines, 3)}</div>
        </div>` : ""}
      </details>
      ${detailDisclosure("Source details", [
        kv("Enzyme name", sourceLabels[summary.enzyme_label_source] || summary.enzyme_label_source || "Not recorded"),
        kv("Source", sourceDatabaseLabel(summary.source_db || detail.source_db)),
        kv("Source license", sourceLicense(summary, detail)),
        kv("CatLog record ID", summary.measurement_key || detail.measurement_key),
        kv("Database rows", detail.source_record_count || summary.source_record_count),
        detail.source_databases_merged?.length ? kv("Databases", detail.source_databases_merged.map(sourceDatabaseLabel).join(", ")) : "",
        publicEvidenceString(detail.data_origin) ? kv("Data origin", publicEvidenceString(detail.data_origin)) : "",
        kv("Protein identity", identityResolutionLabel({
          identity_resolution_state: detail.identity_resolution_state || summary.identity_resolution_state,
          sequence_source: detail.sequence_source || summary.sequence_source,
        })),
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
        metadata: {
          source_license: sourceLicense(summary, detail) || null,
          license_note: SOURCE_LICENSE_NOTE,
        },
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
    $("statsCharts").addEventListener("change", (event) => {
      if (event.target.name !== "statsCohort") return;
      selectStatsGroup(event.target.value);
      document.querySelector(`input[name="statsCohort"][value="${state.statsCohort}"]`)?.focus({ preventScroll: true });
    });
    $("statsCharts").addEventListener("click", (event) => {
      const button = event.target.closest("[data-stats-cohort], [data-chart-cohort]");
      if (!button) return;
      selectStatsGroup(button.dataset.statsCohort || button.dataset.chartCohort, button.dataset.statsField || button.dataset.chartField || "");
      if (button.hasAttribute("data-chart-cohort")) button.focus({ preventScroll: true });
      else if (!button.hasAttribute("data-stats-field")) document.querySelector(`input[name="statsCohort"][value="${state.statsCohort}"]`)?.focus({ preventScroll: true });
    });
    $("statsCharts").addEventListener("keydown", (event) => {
      const arc = event.target.closest("[data-chart-cohort]");
      if (!arc || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      arc.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    [
      "globalSearchInput",
      "ecFilterInput",
      "enzymeFilterInput",
      "organismFilterInput",
      "substrateFilterInput",
    ].forEach((id) => {
      $(id).addEventListener("input", () => {
        if (id === "globalSearchInput" && viewFromLocation() !== "browse") navigateTo("browse");
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
      input.addEventListener("blur", scheduleSuggestionHide);
    });
    const suggestionBox = $("searchSuggestions");
    suggestionBox?.addEventListener("focusin", () => window.clearTimeout(state.suggestionHideTimer));
    suggestionBox?.addEventListener("focusout", scheduleSuggestionHide);
    suggestionBox?.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      const input = state.suggestionInputId ? $(state.suggestionInputId) : null;
      input?.focus();
      hideSuggestions();
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
    for (const view of ["browse", "guide", "stats"]) {
      const link = $(`${view}Button`);
      link.setAttribute("href", viewUrl(view).href);
      link.addEventListener("click", (event) => {
        if (event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigateTo(view);
      });
    }
    $("snapshotStatsButton").addEventListener("click", () => navigateTo("stats"));
    document.addEventListener("click", (event) => {
      const menu = $("downloadMenu");
      if (menu?.open && !menu.contains(event.target)) menu.removeAttribute("open");
    });
    window.addEventListener("popstate", () => renderView(viewFromLocation()));
    window.addEventListener("hashchange", () => renderView(viewFromLocation()));
    window.addEventListener("scroll", hideSuggestions, { passive: true });
    $("catalogFilters").addEventListener("scroll", () => {
      const rail = $("catalogFilters");
      const input = state.suggestionInputId ? $(state.suggestionInputId) : null;
      const box = $("searchSuggestions");
      if (!input || box.classList.contains("hidden")) return;
      if (!rail.contains(input)) {
        hideSuggestions();
        return;
      }
      const rect = input.getBoundingClientRect();
      const bounds = rail.getBoundingClientRect();
      if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) hideSuggestions();
      else positionSuggestions(input, box);
    }, { passive: true });
    window.addEventListener("resize", () => {
      hideSuggestions();
      syncFilterPanel();
      updateTableScrollControls();
    });
    narrowDetailMedia.addEventListener?.("change", () => {
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
    $("clearResultsButton")?.addEventListener("click", () => {
      clearFilters();
      $("globalSearchInput").focus({ preventScroll: true });
    });
    $("openFiltersButton").addEventListener("click", () => setFiltersOpen(true));
    $("closeFiltersButton").addEventListener("click", () => {
      setFiltersOpen(false);
      $("openFiltersButton")?.focus();
    });
    $("filterBackdrop").addEventListener("click", () => {
      setFiltersOpen(false);
      $("openFiltersButton")?.focus();
    });
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
      // An older cached page can request the current script after a deployment.
      if (!$("statsView")) {
        const url = new URL(window.location.href);
        if (/^https?:$/.test(url.protocol) && url.searchParams.get("layout") !== "stats") {
          url.searchParams.set("layout", "stats");
          window.location.replace(url.href);
          return;
        }
        throw new Error("This tab has an older CatLog page. Reload to get the current layout.");
      }
      renderSummary();
      renderStats();
      renderDownloadMetadata();
      renderSourceAttribution();
      const cleanUrl = viewUrl(viewFromLocation());
      if (!["#browse", "#guide", "#stats"].includes(window.location.hash)) cleanUrl.hash = window.location.hash;
      if (cleanUrl.href !== window.location.href) window.history.replaceState(window.history.state, "", cleanUrl);
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
      DETAIL_REQUEST_TIMEOUT_MS,
      state,
      init,
      loadScript,
      loadDetailShard,
      parseCompressedDetailShard,
      retainDetailShard,
      detailForRow,
      selectRecord,
      handlePageDownload,
      renderDetail,
      rowStatusLabel,
      reviewOutcome,
      recordIndexPath,
      loadRecordChunks,
      publicSummaryRecord,
      sourceLicense,
      indexLoadedRecords,
      rowComparator,
      cooperativeStableSort,
      orderedRecordsFor,
      applyFilters,
      ensureCurrentFilters,
      applyFiltersInBackground,
      applyPageSize,
      conditionFlags,
      enzymeFormLabel,
      enzymeFormHtml,
      sequenceSourceLabel,
      identityResolutionLabel,
      measurementSection,
      molecularIdentitySection,
      copyDetailValue,
      showSuggestions,
      hideSuggestions,
      moveSuggestionSelection,
      scheduleSuggestionHide,
      bindControls,
      activeTableRowKey,
      setActiveTableRow,
      moveTableRowFocus,
      openedRecordMessage,
      announceOpenedRecord,
      focusDetailHeading,
      closeDetailAndRestoreFocus,
      syncDetailPanelAccessibility,
      renderSummary,
      renderStats,
      statsReviewRing,
      statsFollowupCoverage,
      statsCohortData,
      statsCombinedCoverage,
      statsNestedReviewRing,
      statsReviewDetails,
      statsShare,
      statsBarRows,
      renderView,
      navigateTo,
      viewUrl,
      viewFromLocation,
      setFiltersOpen,
    };
  } else {
    init();
  }
})();
