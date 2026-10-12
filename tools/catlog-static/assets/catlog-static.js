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
    selectedShard: "",
    activeRowKey: "",
    selectedDetail: null,
    pageDownloadPending: false,
    recordChunksLoaded: 0,
    recordChunksTotal: 0,
    loadProgressUnit: "chunks",
    recordsReady: false,
    // Page 1 is on screen while the rest of the index downloads (an index already in the default order).
    firstRowsShown: false,
    // The row order the loaded index declares ("default_review_status": the Review-status sort), or "".
    indexOrder: "",
    preserveRenderedRows: false,
    statsRendered: false,
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
    // The record a #record= address names, until the index has loaded far enough to open it.
    pendingRecordKey: "",
    missingRecordKey: "",
    // The page an address names (#browse?...&page=), until the records it counts have loaded.
    pendingPage: 0,
    // Active filter keys, the one changed last at the end.
    filterOrder: [],
    // Human review marks (data/human-review-marks.json): loaded, and how many times they arrived (for the counts).
    humanMarksLoaded: false,
    humanMarksVersion: 0,
    // Docked filters closed for a record (below 1600px), with their scroll position: they come back when it closes.
    filtersAwayForRecord: null,
  };
  const EMPTY_VALUE = "—";
  const SOURCE_LICENSE_NOTE = "Source licenses are recorded in source_license; merged records may list multiple licenses. Check those terms before reuse.";
  const LOAD_RETRY_DELAYS = [2000, 5000, 10000];
  const SORT_RUN_SIZE = 4096;
  const SORT_CACHE_LIMIT = 2;
  const DETAIL_SHARD_CACHE_LIMIT = 8;
  const DETAIL_REQUEST_TIMEOUT_MS = 30000;
  // Page 1 is drawn once the default-order index has given this many rows.
  const FIRST_ROWS_MIN = 100;
  // Hovering or focusing a row this long starts loading its record.
  const DETAIL_PREFETCH_DELAY_MS = 120;
  const SORT_LOADING_TITLE = "Sorting is available when all records have loaded";
  const DEFAULT_INDEX_ORDER = "default_review_status";
  const FILTER_FAILURE_MAX_LENGTH = 160;
  const FILTER_TYPING_DELAY_MS = 180;
  const narrowDetailMedia = window.matchMedia("(max-width: 1180px)");
  // Wide screens: the filters are a column beside the table (not an overlay), and from 1600px they stay open beside
  // an open record. Below 1440px a column would leave the table too narrow for its names, so they are an overlay.
  const dockedFiltersMedia = window.matchMedia("(min-width: 1440px)");
  const filtersBesideRecordMedia = window.matchMedia("(min-width: 1600px)");
  const DETAIL_INERT_SELECTOR = [
    ".app-header",
    "#catalogLoadProgress",
    "#searchSuggestions",
    "#catalogView > .snapshot-band",
    ".workbench > :not(.detail-panel)",
  ].join(", ");
  const FILTER_INERT_SELECTOR = ".app-header, #catalogLoadProgress, #catalogView > .snapshot-band, .table-panel, .detail-panel";

  // Review result: the four words the filter, the badges, the definitions, the Guide and Stats use. The address keys
  // stay (status=accepted,curation_pending,not_verified,disputed). Not checked holds Unverified, Not reviewed and any
  // other status the earlier review left; the record names the exact one ("Not checked (Unverified)").
  const recordStates = [
    { value: "accepted", label: "Accepted", className: "accepted" },
    { value: "curation_pending", label: "Not confirmed", className: "review" },
    { value: "not_verified", label: "Not checked", className: "unresolved" },
    { value: "disputed", label: "Disputed", className: "disputed" },
  ];

  const stateDescriptions = {
    accepted: "Passed review: read from the paper by CatLog, or accepted by the earlier automated review as printed or after a correction.",
    curation_pending: "The earlier automated review left a question open on the value, unit, protein or substrate. The record is replaced when CatLog reads its paper.",
    not_verified: "No review result. Unverified: the earlier review recorded no final check. Not reviewed: a database record without a PMID or DOI (SKiD or BRENDA) that was never reviewed.",
    disputed: "A check found a problem; not accepted.",
  };
  const HUMAN_CHECKED_DESCRIPTION = "A human reviewer approved every value shown.";

  // The verification_status values; label is the exact value a record names after its review result.
  const reviewStatuses = [
    { value: "verified", label: "Verified", description: "Accepted by the earlier automated review as printed." },
    { value: "corrected", label: "Corrected", description: "Accepted by the earlier automated review after a correction." },
    { value: "manual_review_required", label: "Not confirmed", description: stateDescriptions.curation_pending },
    { value: "unverified", label: "Unverified", description: "The earlier review recorded no final check." },
    { value: "mathematically_inferred", label: "Not reviewed", description: "A database record without a PMID or DOI that was never reviewed." },
    { value: "disputed", label: "Disputed", description: stateDescriptions.disputed },
  ];

  const measurementFilters = [
    { value: "kcat", label: "Has kcat", labelHtml: "Has <i>k</i><sub>cat</sub>", field: "kcat" },
    { value: "km", label: "Has Km", labelHtml: "Has <i>K</i><sub>m</sub>", field: "km" },
    { value: "kcat_over_km", label: "Has kcat/Km", labelHtml: "Has <i>k</i><sub>cat</sub>/<i>K</i><sub>m</sub>", field: "kcat_over_km" },
  ];

  // Wild type or variant, as the table's enzyme-form tag says it; records that do not say are in neither.
  const variantFilters = [
    { value: "wild", label: "Wild type", bit: 1 },
    { value: "variant", label: "Variant", bit: 2 },
  ];

  // Cautions, grouped as the table's "!" markers and the record's notes show them (conditionFlags).
  // Each caution states the problem; the record's note gives the numbers.
  const cautionFilters = [
    { value: "differs", label: "kcat/Km mismatch", labelHtml: "<i>k</i><sub>cat</sub>/<i>K</i><sub>m</sub> mismatch", bit: 1, title: "The printed or listed kcat/Km differs from kcat ÷ Km" },
    { value: "units", label: "Possible unit or magnitude error", bit: 2, title: "Km above 10 M, kcat above 10⁷ s⁻¹, a kcat/Km unit that may be off by 1000× or kcat/Km above the diffusion limit" },
    { value: "unit_missing", label: "No unit given", bit: 4, title: "A kcat or Km without a recorded unit" },
    { value: "temperature", label: "Temperature questionable", bit: 8, title: "A temperature value or unit that may be wrong" },
    { value: "none", label: "No cautions", bit: 16, title: "Records without any caution" },
  ];
  const CAUTION_FLAG_BITS = {
    kcat_over_km_quotient_mismatch: 1,
    km_magnitude_needs_check: 2,
    kcat_magnitude_needs_check: 2,
    kcat_over_km_unit_mismatch: 2,
    efficiency_above_diffusion_limit: 2,
  };

  // Source, the first filter: every record is either read from the paper by CatLog (isV2Row) or comes from the enzyme
  // databases. "By database" narrows the second group by source_db; a merged value such as "sabio_rk;brenda" counts for
  // each database it names (Stats counts the same way), and the table's status cell names them (sourceTagText).
  const SOURCE_CATLOG_LABEL = "Read from the paper by CatLog";
  const SOURCE_DATABASES_LABEL = "From enzyme databases";
  const SOURCE_CATLOG_HELP = "Read by an AI model; a second, separate AI check compared each value with the paper.";
  const SOURCE_DATABASES_HELP = "BRENDA, SABIO-RK, the Open Enzyme Database, UniProt and SKiD, plus earlier paper extractions and records with no source recorded; screened by an earlier automated pipeline.";
  const sourceModes = [
    { value: "all", label: "All records" },
    { value: "paper", label: SOURCE_CATLOG_LABEL, help: SOURCE_CATLOG_HELP, guide: true },
    { value: "databases", label: SOURCE_DATABASES_LABEL, help: SOURCE_DATABASES_HELP },
  ];
  // The databases of the second group; tag is the word the status cell uses.
  const sourceFilters = [
    { value: "brenda", label: "BRENDA", tag: "BRENDA", bit: 2 },
    { value: "sabio_rk", label: "SABIO-RK", tag: "SABIO-RK", bit: 4 },
    { value: "oed", label: "Open Enzyme Database", tag: "OED", bit: 8 },
    { value: "uniprot", label: "UniProt", tag: "UniProt", bit: 16 },
    { value: "skid", label: "SKiD", tag: "SKiD", bit: 32 },
    { value: "strenda", label: "STRENDA DB", tag: "STRENDA DB", bit: 64 },
    { value: "earlier_paper", label: "Earlier paper extractions", tag: "earlier extraction", bit: 128,
      title: "Records read from a paper by the earlier pipeline, not by CatLog" },
    { value: "unrecorded", label: "Source not recorded", tag: "source not recorded", bit: 256 },
  ];
  const SOURCE_UNRECORDED_BIT = 256;
  const SOURCE_TOKENS = {
    primary_paper_direct: "earlier_paper", primary_literature: "earlier_paper", paper: "earlier_paper", brenda: "brenda",
    sabio_rk: "sabio_rk", sabio: "sabio_rk", sabiork: "sabio_rk", oed: "oed", open_enzyme_database: "oed", uniprot: "uniprot",
    skid: "skid", strenda: "strenda",
  };

  const tierOrder = {
    paper_grounded_high_confidence: 0,
    paper_grounded: 1,
    cross_source_supported: 2,
    literature_linked: 3,
    candidate_only: 4,
  };

  // Where a record's enzyme name comes from, read after "Enzyme name from" (a CatLog v2 record's: the paper).
  const sourceLabels = {
    source_record: "the source record",
    explicit_enzyme_name: "the source record",
    brenda_recommended_name: "BRENDA (recommended name)",
    protein_name_fallback: "the protein name",
    uniprot_name_fallback: "UniProt",
    ec_accepted_name_fallback: "the EC list (accepted name)",
    ec_name_fallback: "the EC list",
    uniprot_fallback: "UniProt (accession only)",
    name_not_preserved: "not recorded",
  };

  const sourceDatabaseLabels = {
    oed: "Open Enzyme Database (OED)",
    brenda: "BRENDA",
    sabio_rk: "SABIO-RK",
    sabio: "SABIO-RK",
    skid: "SKiD",
    uniprot: "UniProt",
    primary_paper_direct: "Primary literature",
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

  const identityOnlyTrustNote = "Accepted, but no PMID or DOI is linked, so the value cannot be traced to a paper.";

  const conditionFlagLabels = {
    kcat_over_km_quotient_mismatch: "kcat/Km differs from kcat ÷ Km",
    kcat_over_km_unit_mismatch: "kcat/Km unit may be off by 1000×",
    km_magnitude_needs_check: "Km above 10 M; the unit may be wrong",
    kcat_magnitude_needs_check: "kcat above 10⁷ s⁻¹; the unit may be wrong",
    efficiency_above_diffusion_limit: "kcat/Km above the diffusion limit",
    temperature_value_needs_check: "Temperature value questionable",
    temperature_unit_needs_check: "Temperature unit questionable",
    temperature_invalid: "Temperature value is not usable",
    temperature_zero_celsius_needs_check: "Temperature recorded as exactly 0 °C; may stand for a missing value",
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
    kcat_over_km_quotient_mismatch: { field: "kcat_over_km", short: "kcat/Km mismatch" },
    kcat_over_km_unit_mismatch: { field: "kcat_over_km", short: "possible 1000× unit error" },
    efficiency_above_diffusion_limit: { field: "kcat_over_km", short: "above diffusion limit" },
    km_magnitude_needs_check: { field: "km", short: "Km > 10 M" },
    kcat_magnitude_needs_check: { field: "kcat", short: "kcat > 10⁷ s⁻¹" },
  };

  // A magnitude caution says which bound the stored value passes: Km above 10 M (or below 1 nM), kcat above 10⁷ s⁻¹ (or
  // 10⁸ s⁻¹), so its words stay true whichever bound the export used.
  function magnitudeBound(flag, row) {
    const value = Number(row ? metricDisplay(row, valueIntegrityFlags[flag]?.field || "") : NaN);
    if (flag === "km_magnitude_needs_check") {
      return Number.isFinite(value) && value > 0 && value < 1e-6
        ? { short: "Km < 1 nM", label: "Km below 1 nM; the unit may be wrong", note: "Km is below 1 nM; the unit may be wrong." }
        : { short: "Km > 10 M", label: conditionFlagLabels.km_magnitude_needs_check, note: "Km is above 10 M; the unit may be wrong." };
    }
    if (flag === "kcat_magnitude_needs_check") {
      const power = Number.isFinite(value) && value > 1e8 ? "10⁸" : "10⁷";
      return { short: `kcat > ${power} s⁻¹`, label: `kcat above ${power} s⁻¹; the unit may be wrong`, note: `kcat is above ${power} s⁻¹; the unit may be wrong.` };
    }
    return null;
  }

  function flagShortText(flag, row) {
    return magnitudeBound(flag, row)?.short || valueIntegrityFlags[flag]?.short || "";
  }

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

  // With the record (row), a kcat/Km flag says what differs: both numbers, how far apart, and what a familiar factor is;
  // with its detail, also whether the paper's own numbers agree.
  function conditionFlagLabel(flag, row, detail = null) {
    const comparison = row && KCAT_KM_FLAGS.has(flag) ? kcatKmComparisonText(row, detail) : "";
    if (comparison) return comparison;
    const bound = row ? magnitudeBound(flag, row) : null;
    if (bound) return bound.label;
    if (conditionFlagLabels[flag]) return conditionFlagLabels[flag];
    if (String(flag || "").startsWith("unit_not_recorded")) return conditionFlagLabels.unit_not_recorded;
    const text = String(flag || "").replace(/_/g, " ").trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
  }

  // kcat/Km against kcat ÷ Km in the units the record shows (both flags, quotient and unit mismatch, are about this).
  const KCAT_KM_FLAGS = new Set(["kcat_over_km_quotient_mismatch", "kcat_over_km_unit_mismatch"]);
  // A familiar factor, stated as a fact; "time" and "concentration" name the unit it belongs to.
  const KCAT_KM_FACTORS = [
    [10, "The factor is close to 10, one shifted decimal place."],
    [60, "The factor is close to 60, the factor between per minute and per second.", "time"],
    [100, "The factor is close to 100, two shifted decimal places."],
    [1000, "The factor is close to 1000, the factor between per mM and per M.", "concentration"],
    [1e6, "The factor is close to 10⁶, the factor between per µM and per M.", "concentration"],
  ];

  // kcat/Km against kcat ÷ Km, in the units the record shows; null when a unit is not the catalog's or a value is missing.
  // The quotient keeps the significant figures of kcat and Km (at least 2), like every number CatLog works out.
  function kcatKmCheck(row) {
    const fields = ["kcat", "km", "kcat_over_km"];
    if (!fields.every((field) => canonicalMetricUnitKeys[field].has(normalizedUnitKey(metricUnit(row, field))))) return null;
    const [kcat, km, reported] = fields.map((field) => Number(metricDisplay(row, field)));
    if (!(kcat > 0 && km > 0 && reported > 0)) return null;
    const quotient = kcat / km;
    const fold = Math.max(reported / quotient, quotient / reported);
    return {
      quotient,
      quotientText: numberText(quotient, { figures: quotientFigures(row) }),
      fold,
      foldText: `${fold < 10 ? fold.toFixed(1) : formatInteger(Math.round(fold))}-fold`,
      direction: reported > quotient ? "above" : "below",
      factor: KCAT_KM_FACTORS.find(([target]) => Math.abs(fold / target - 1) <= 0.1),
      unit: unitText(metricUnit(row, "kcat_over_km")),
      v2: isV2Row(row) || String(row.verification_method || "").startsWith(v2Method),
    };
  }

  // "Printed kcat/Km (2.2 s⁻¹ mM⁻¹) is 1.6-fold above kcat ÷ Km (1.3 s⁻¹ mM⁻¹). All three are stored as the paper gives
  // them." A familiar factor is named; for a unit factor on a record read from the paper, the printed numbers' own
  // arithmetic shows whether they agree in one unit.
  function kcatKmComparisonText(row, detail = null) {
    const check = kcatKmCheck(row);
    if (!check) return "";
    const { quotientText, foldText, direction, factor, unit, v2 } = check;
    const sentences = [`${v2 ? "Printed kcat/Km" : "The source's kcat/Km"} (${numberText(metricDisplay(row, "kcat_over_km"))} ${unit}) is `
      + `${foldText} ${direction} kcat ÷ Km (${quotientText} ${unit}).`];
    if (factor) sentences.push(factor[1]);
    if (v2 && factor?.[2]) sentences.push(printedQuotientText(detail, factor[2]));
    sentences.push(v2 ? "All three are stored as the paper gives them." : "All three are stored as the source lists them.");
    return sentences.filter(Boolean).join(" ");
  }

  // The paper's printed kcat ÷ Km against its printed kcat/Km (from the record's printed lines): when they agree, the
  // difference is the unit, and the note says so with the arithmetic.
  function printedQuotientText(detail, kind) {
    const lines = Array.isArray(detail?.proof_lines) ? detail.proof_lines : [];
    const printed = (metric) => {
      const line = lines.find((item) => item && typeof item === "object" && item.metric === metric);
      const match = String(line?.raw_value ?? "").trim().match(/^(\d+(?:\.\d+)?)(?![\d.]|\s*[×x*]\s*10)/);
      return match ? match[1] : "";
    };
    const [kcat, km, ratio] = ["kcat", "Km", "kcat/Km"].map(printed);
    if (!(Number(kcat) > 0 && Number(km) > 0 && Number(ratio) > 0)) return "";
    const quotient = Number(kcat) / Number(km);
    if (Math.abs(quotient / Number(ratio) - 1) > 0.05) return "";
    const figures = Math.max(2, numberParts(ratio)?.significant || 2);
    const units = kind === "time" ? "kcat and kcat/Km share one time unit" : "Km and kcat/Km share one concentration unit";
    return `The printed numbers agree (${kcat} ÷ ${km} = ${numberText(quotient, { figures })}) only if ${units}.`;
  }

  // A small amber "!" beside the value; its words are in the tooltip, the accessible name and hidden text.
  function valueFlagBadgeHtml(flags, field, row) {
    const matched = [...flags].filter((flag) => valueIntegrityFlags[flag]?.field === field);
    if (!matched.length) return "";
    const labels = [...new Set(matched.map((flag) => conditionFlagLabel(flag, row)).filter(Boolean))];
    const shortText = [...new Set(matched.map((flag) => flagShortText(flag, row)))].join(" · ");
    const summary = labels.join("; ");
    return `<span class="value-flag" role="img" title="${escapeHtml(summary)}" aria-label="${escapeHtml(summary)}"><span class="visually-hidden">${escapeHtml(shortText)}</span></span>`;
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

  // CatLog's own compilation (the rows CatLog read from papers) is CC BY 4.0; quoted paper text remains the publisher's.
  const PRIMARY_LITERATURE_NAME = "Primary literature (read by CatLog)";
  const PRIMARY_LITERATURE_LICENSE = "CatLog compilation CC BY 4.0; quoted paper text remains the publisher’s";

  const fallbackSourceDatabases = [
    { key: "primary_paper_direct", name: PRIMARY_LITERATURE_NAME, license: "", citation_url: "" },
    { key: "brenda", name: "BRENDA", license: "CC BY 4.0", citation_url: "https://www.brenda-enzymes.org/" },
    { key: "sabio_rk", name: "SABIO-RK", license: "", citation_url: "https://sabiork.h-its.org/" },
    { key: "skid", name: "SKiD", license: "CC BY-NC-ND 4.0", citation_url: "" },
    { key: "oed", name: "Open Enzyme Database (OED)", license: "CC BY 4.0", citation_url: "https://openenzymedb.platform.moleculemaker.org/" },
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

  // An empty search box (or name field) offers one fixed line of examples, each a search that finds records.
  const searchExamples = {
    mixed: ["hexokinase", "1.1.1.1", "Escherichia coli", "NADH", "P00330", "PMID 15989682"],
    ec_number: ["1.1.1.1", "2.7.1.1", "3.2.1"],
    enzyme_display_name: ["hexokinase", "laccase", "lipase"],
    organism: ["Escherichia coli", "human", "yeast"],
    substrate_name: ["NADH", "ATP", "glucose"],
  };

  const $ = (id) => document.getElementById(id);

  // Search text: lower case, accents dropped, Greek letters spelled out (β-lactamase = beta-lactamase), µ, "micro-" and
  // "u-" as "mu-", every dash a hyphen and every prime an apostrophe. Words are then matched with spaces, hyphens and
  // underscores (and commas) left out (compactSearch), so "4-nitrophenyl" and "4nitrophenyl" find each other.
  const greekNames = {
    α: "alpha", β: "beta", γ: "gamma", δ: "delta", ε: "epsilon", ζ: "zeta", η: "eta", θ: "theta", ι: "iota", κ: "kappa",
    λ: "lambda", μ: "mu", ν: "nu", ξ: "xi", ο: "omicron", π: "pi", ρ: "rho", σ: "sigma", ς: "sigma", τ: "tau", υ: "upsilon",
    φ: "phi", χ: "chi", ψ: "psi", ω: "omega",
  };
  function foldSearch(value) {
    let text = String(value ?? "").toLowerCase();
    if (/[^\x00-\x7f]/.test(text)) {
      text = text.normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .replace(/∆/g, "δ")
        .replace(/[α-ω]/g, (letter) => greekNames[letter] || letter)
        .replace(/[‐-―⁃−﹘﹣－]/g, "-")
        .replace(/[‘’‛′‵´`]/g, "'");
    }
    return text.replace(/(^|[^a-z0-9])(?:micro|u)(?=-)/g, "$1mu");
  }
  const compactSearch = (text) => String(text ?? "").replace(/[\s\-_,]+/g, "");

  // A Guide section's own address (#guide-units, ...) opens the Guide at that section.
  const GUIDE_SECTION_HASH = /^#guide-[a-z-]+$/;

  function viewFromLocation() {
    if (["#browse", "#guide", "#stats"].includes(window.location.hash)) return window.location.hash.slice(1);
    if (GUIDE_SECTION_HASH.test(window.location.hash)) return "guide";
    // Browse with filters: #browse?q=...&ec=... (see browseParamsFromLocation).
    if (/^#browse\?/.test(window.location.hash || "")) return "browse";
    return new URL(window.location.href).pathname.endsWith("/catlog-stats.html") ? "stats" : "browse";
  }

  function renderView(view, { scroll = false } = {}) {
    const guideOpen = view === "guide";
    const statsOpen = view === "stats";
    const browseOpen = !guideOpen && !statsOpen;
    $("catalogView").hidden = !browseOpen;
    $("guideView").hidden = !guideOpen;
    $("statsView").hidden = !statsOpen;
    // Stats come from the manifest alone: drawn the first time they are shown, never from the record index.
    if (statsOpen && !state.statsRendered) {
      renderStats();
      state.statsRendered = true;
    }
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
    // A section address (#guide-units) shows that section, also when the page opens at it.
    const guideSection = guideOpen && GUIDE_SECTION_HASH.test(window.location.hash)
      ? document.getElementById(window.location.hash.slice(1))
      : null;
    if (guideSection) window.requestAnimationFrame?.(() => guideSection.scrollIntoView?.({ block: "start" }));
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

  // An open record is in the address, so it can be shared and reloaded: #record=<record_key> when no filter is set, else
  // after the filters (#browse?checked=1&...&record=<record_key>), so reloading or copying it keeps them. The page is left
  // out: the record's place in the results decides it. Opening a record writes the address (replacing the entry, so Back
  // still leaves the page) and closing the record gives it back to the filters (#browse?..., or none).
  const RECORD_HASH = /^#record=([^&#]+)$/;

  function recordKeyFromLocation() {
    const match = window.location.hash.match(RECORD_HASH);
    if (match) {
      try {
        return decodeURIComponent(match[1]).trim();
      } catch (_error) {
        return "";
      }
    }
    const params = BROWSE_HASH.test(window.location.hash || "") ? browseParamsFromLocation() : null;
    return String(params?.get("record") || "").trim();
  }

  function recordHash(key) {
    const params = browseParamsFromControls().filter(([name]) => name !== "page");
    const record = encodeURIComponent(key);
    return params.length ? `${browseHash(params)}&record=${record}` : `#record=${record}`;
  }

  function syncRecordUrl(key) {
    if (!key && !recordKeyFromLocation()) return;
    const url = new URL(window.location.href);
    url.hash = key ? recordHash(key) : browseHash();
    if (url.href === window.location.href) return;
    try {
      window.history.replaceState(window.history.state, "", url);
    } catch (_error) {
      // A page opened from a file may not allow it; the record still opens.
    }
  }

  // Opens the record a #record= address names once the loaded index holds it, on the table page that shows it. A key
  // the snapshot does not have goes into the search box, so the table says that no record matches it.
  function openRecordFromLocation() {
    const key = state.pendingRecordKey;
    if (!key || viewFromLocation() !== "browse") return;
    const position = state.filtered.findIndex((row) => row.record_key === key);
    // Human-checked results wait for the review marks: the record opens on its page once they are here.
    const awaitingMarks = Boolean($("humanCheckedFilter")?.checked) && !state.humanMarksLoaded;
    if (position < 0 && (!state.recordsReady || awaitingMarks)) return;
    state.pendingRecordKey = "";
    if (position >= 0) {
      state.page = Math.floor(position / state.pageSize) + 1;
      selectRecord(key);
    } else if (state.records.some((row) => row.record_key === key)) {
      selectRecord(key);
    } else {
      syncRecordUrl("");
      state.missingRecordKey = key;
      $("globalSearchInput").value = key;
      applyFiltersInBackground();
    }
  }

  function navigateTo(view) {
    const url = viewUrl(view);
    // Back to Browse keeps the filters in the address.
    if (view === "browse") url.hash = browseHash();
    if (window.location.href !== url.href) {
      window.history.pushState({ catlogView: view }, "", url);
    }
    if (view === "browse") ensureRecordsLoaded();
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
        "Every field, including sequences, SMILES and paper links",
        `${total} rows`,
        enrichedSize,
      ].filter(Boolean).join(" · ");
    }
    if ($("tableIndexDescription")) {
      $("tableIndexDescription").textContent = [
        "Table columns only: no sequences, SMILES or paper links",
        `${total} rows`,
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
    // One citation line, selectable as a whole (no copy button): snapshot date (UTC) and the Data ID shown above.
    const generated = manifest.generated_at ? new Date(manifest.generated_at) : null;
    if ($("guideCitationLine") && generated && !Number.isNaN(generated.getTime()) && sourceId !== EMPTY_VALUE) {
      $("guideCitationLine").textContent = `CatLog snapshot ${generated.toISOString().slice(0, 10)} (data ID ${sourceId}), Chowdhury Lab, https://chowdhurylab.github.io/tools/catlog-latest.html`;
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

  // Source text in the record panel: caret exponents as superscripts, "1.3 x 10^-2" written 1.3 × 10^-2, the earlier
  // pipeline's code quotes (`Butanol`) and arrows (->) as plain text.
  function evidenceTextHtml(text) {
    const plain = String(text)
      .replace(/`([^`]*)`/g, "$1")
      .replace(/`/g, "")
      .replace(/\s*->\s*/g, " → ")
      .replace(/(\d)\s*[x×]\s*10\^/g, "$1 × 10^");
    return caretHtml(escapePublic(plain));
  }

  function evidenceNoteHtml(value) {
    if (value === null || value === undefined || value === "") return "";
    if (typeof value !== "object") {
      const text = publicEvidenceString(String(value));
      return text ? `<p class="evidence-note-plain">${evidenceTextHtml(text)}</p>` : "";
    }

    const location = [value.table_label, value.row_label].map(publicEvidenceString).filter(Boolean).join(" · ");
    const reported = publicEvidenceString(value.raw_value_unit_evidence
      || (!value.normalized_value_unit_evidence ? value.column_label : ""));
    const normalized = publicEvidenceString(value.normalized_value_unit_evidence);
    const rows = [
      location ? ["Where", location] : null,
      reported ? ["As printed", cleanEvidenceValue(reported)] : null,
      normalized ? ["Conversion", cleanEvidenceValue(normalized)] : null,
    ].filter(Boolean);

    if (!rows.length) {
      const fallback = evidenceText(value);
      return fallback ? `<p class="evidence-note-plain">${evidenceTextHtml(fallback)}</p>` : "";
    }
    return `<div class="evidence-note-item detail-kv">${rows.map(([label, text]) => linkedKv(label, evidenceTextHtml(text))).join("")}</div>`;
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

  const UNIT_NOT_RECORDED_LABEL = "no unit";
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

  // Escaped text with caret exponents (s^-1, mM^(-1), M^{-2}): the exponent becomes a superscript; the numbers stay as printed.
  function caretHtml(html) {
    return html
      .replace(/\^\(([−-]?\d+(?:\.\d+)?)\)|\^\{([−-]?\d+(?:\.\d+)?)\}|\^([−-]?\d+(?:\.\d+)?)/g, (_m, a, b, c) => `<sup>${a ?? b ?? c}</sup>`)
      .replace(/<\/sup>\*(?=[A-Za-zµμ])/g, "</sup> ");
  }

  function metricUnitHtml(row, field) {
    if (!metricHasValue(row, field) || metricUnitMissing(row, field)) return "";
    return unitHtml(metricUnit(row, field));
  }

  const STORED_UNIT_NOTE = "stored in this unit, not converted to the column unit";

  // A kcat, Km or kcat/Km kept in a unit other than the catalog's (min^-1, mg/mL, ...): shown after the value.
  function storedUnitDiffers(row, field) {
    const storedUnit = metricUnit(row, field);
    return Boolean(canonicalMetricUnitKeys[field] && storedUnit && metricHasValue(row, field))
      && !canonicalMetricUnitKeys[field].has(normalizedUnitKey(storedUnit));
  }

  function storedUnitHtml(row, field) {
    return `<small class="metric-inline-unit" title="${escapeHtml(STORED_UNIT_NOTE)}">${unitHtml(metricUnit(row, field))}</small>`;
  }

  // A table number with the digits as stored: a × 10ⁿ at or above 10⁵ and below 10⁻³, a plain decimal in between. Values
  // with more digits than were measured are rounded first (displayFigures, numberHtml); the downloads keep the stored text.
  function tableNumberHtml(value) {
    const text = compactValue(value).trim();
    const match = text.match(/^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
    const magnitude = Math.abs(Number(text));
    if (!match || !(match[2] || match[3]) || !Number.isFinite(magnitude) || magnitude === 0) return scientificValueHtml(text);
    const [, sign, whole = "", fraction = "", exponentText] = match;
    let digits = whole + fraction;
    let point = whole.length + Number(exponentText || 0);
    const leadingZeros = digits.match(/^0*/)[0].length;
    digits = digits.slice(leadingZeros);
    point -= leadingZeros;
    if (magnitude >= 1e5 || magnitude < 1e-3) {
      // Trailing zeros of a plain integer (123000) are not printed digits.
      const significant = fraction || exponentText ? digits : digits.replace(/0+$/, "") || "0";
      const coefficient = significant.length > 1 ? `${significant[0]}.${significant.slice(1)}` : significant;
      return scientificValueHtml(`${sign}${coefficient}e${point - 1}`);
    }
    if (!exponentText) return escapePublic(text);
    if (point <= 0) return escapePublic(`${sign}0.${"0".repeat(-point)}${digits}`);
    if (point >= digits.length) return escapePublic(`${sign}${digits}${"0".repeat(point - digits.length)}`);
    return escapePublic(`${sign}${digits.slice(0, point)}.${digits.slice(point)}`);
  }

  const SUPERSCRIPT_DIGITS = { "-": "⁻", "−": "⁻", "+": "⁺", ".": "·", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };

  // A unit as plain text for a tooltip: s^(-1)*mM^(-1) -> s⁻¹ mM⁻¹.
  function unitText(value) {
    return String(value || "")
      .replace(/\^\(([−+-]?[\d.]+)\)|\^\{([−+-]?[\d.]+)\}|\^([−+-]?[\d.]+)/g, (_m, a, b, c) => [...(a ?? b ?? c)].map((ch) => SUPERSCRIPT_DIGITS[ch] ?? ch).join(""))
      .replace(/\*/g, " ")
      .trim();
  }

  // The stored value and its unit, for the tooltip of a table value.
  function valueTitle(row, field) {
    const display = metricDisplay(row, field);
    if (display === EMPTY_VALUE) return "";
    const unit = metricUnitMissing(row, field) ? "" : unitText(metricUnit(row, field));
    return ` title="${escapeHtml([display, unit].filter(Boolean).join(" "))}"`;
  }

  function metricDisplayWithUnitHtml(row, field, { table = false } = {}) {
    const display = metricDisplay(row, field);
    // Shown with no more precision than was measured (displayFigures), as in the record; the stored digits stay in the
    // tooltip, the sort and the downloads.
    const figures = display === EMPTY_VALUE ? 0 : displayFigures(row, field);
    const displayHtml = figures ? numberHtml(display, { figures }) : table ? tableNumberHtml(display) : scientificValueHtml(display);
    if (display === EMPTY_VALUE) return displayHtml;
    if (metricUnitMissing(row, field)) return `${displayHtml}${unitMissingHtml()}`;
    return storedUnitDiffers(row, field) ? `${displayHtml}${storedUnitHtml(row, field)}` : displayHtml;
  }

  const CALCULATED_NOTE = "kcat ÷ Km, not printed in the source";
  const EQUALS_QUOTIENT_NOTE = "Equals kcat ÷ Km; the source does not say whether it was printed or calculated. Shown with the significant figures of kcat and Km.";

  // A kcat/Km worked out from kcat and Km: "calc." beside the table value, "calculated" in the record. An earlier-catalog
  // kcat/Km of unstated origin that equals kcat ÷ Km (within 0.1%) is tagged the same way, its title saying so.
  function efficiencyOriginHtml(row, { short = false } = {}) {
    const note = row.kcat_over_km_origin === "calculated" ? CALCULATED_NOTE : (efficiencyLooksCalculated(row) ? EQUALS_QUOTIENT_NOTE : "");
    return note ? `<small class="metric-origin" title="${escapeHtml(note)}">${short ? "calc." : "calculated"}</small>` : "";
  }

  // An earlier-catalog kcat/Km whose origin is not stated and that equals kcat ÷ Km to 0.1% (a database's own quotient).
  function efficiencyLooksCalculated(row) {
    if (row?.kcat_over_km_origin !== "not_specified" || isV2Row(row)) return false;
    const check = kcatKmCheck(row);
    return Boolean(check) && Math.abs(Number(metricDisplay(row, "kcat_over_km")) / check.quotient - 1) <= 0.001;
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

  // The table's variant line: the bare mutation ("D102E", "H254Q/H257F"), "variant, not specified" without one, and
  // nothing for wild type or a record that does not say.
  function enzymeFormText(row) {
    const label = enzymeFormLabel(row);
    if (!label.startsWith("Variant")) return "";
    return mutationSignature(row) || "variant, not specified";
  }

  function enzymeFormHtml(row, { className = "enzyme-form" } = {}) {
    const text = enzymeFormText(row);
    return text ? `<span class="${className}" title="Variant: ${escapeHtml(text)}">${escapePublic(text)}</span>` : "";
  }

  // The temperature (°C) and pH the table shows, as numbers for sorting (null when the table shows a dash).
  function temperatureValue(row) {
    if (hasDisplayValue(row.temperature_display)) {
      const value = Number(row.temperature_display);
      return Number.isFinite(value) ? value : null;
    }
    const kelvin = row.temperature_k == null || row.temperature_k === "" ? NaN : Number(row.temperature_k);
    return Number.isFinite(kelvin) && kelvin > 170 && kelvin <= 1000 ? kelvin - 273.15 : null;
  }

  function phValue(row) {
    const value = row.ph_display == null || row.ph_display === "" ? NaN : Number(row.ph_display);
    return Number.isFinite(value) && value >= 0 && value <= 14 ? value : null;
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

  // The table's T and pH cells: the number alone, or a dash (marked empty, so a phone card leaves it out).
  function conditionCellHtml(className, value) {
    return value === EMPTY_VALUE
      ? `<td class="${className} num" data-empty=""><span>${EMPTY_VALUE}</span></td>`
      : `<td class="${className} num"><span>${escapeHtml(value)}</span></td>`;
  }

  function stateConfig(value) {
    return recordStates.find((item) => item.value === value) || recordStates[2];
  }

  function recordStateForRow(row) {
    const status = row.verification_status;
    if (status === "verified" || status === "corrected") return "accepted";
    if (status === "manual_review_required") return "curation_pending";
    if (status === "disputed") return "disputed";
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
      counts.disputed = statuses.disputed || 0;
      counts.not_verified = Object.entries(statuses).reduce(
        (total, [status, count]) => total + (["verified", "corrected", "manual_review_required", "disputed"].includes(status) ? 0 : count),
        0,
      );
      return counts;
    }
    rows.forEach((row) => {
      counts[row._recordState || recordStateForRow(row)] += 1;
    });
    return counts;
  }

  function evidenceLabel(row, proofLines = []) {
    if (row.proof_kind === "paper_evidence" || row.has_proof_excerpt) return "Located in the paper";
    if (row.proof_kind === "source_note" || proofLines.length) return "Database note";
    if (row.evidence_confidence_tier === "cross_source_supported") {
      return "Several database records";
    }
    return row.has_literature_id ? "Paper cited (values not located)" : "Database record only";
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
        return "Accepted after a correction in an earlier review; the change is not recorded.";
      case "verified":
        return "Accepted as reported.";
      case "manual_review_required":
        return "Not accepted: at least one check is still open.";
      case "mathematically_inferred":
        return "Prepared from source records; no accepted review outcome is recorded.";
      case "disputed":
        return "Disputed: flagged in an earlier review and not accepted; the reason is not recorded.";
      default:
        return "No accepted result is recorded.";
    }
  }

  // CatLog v2 rows: every value read from the paper by an AI model, and a second, separate AI check compared each value
  // with the paper. The short form (badges, filter); the Guide says it in full (#guide-method). The method token is the
  // exporter's and stays as it is.
  const v2Method = "catlog_v2_read_and_independent_verify";
  const v2Sentence = "Read from the paper by an AI model; a second, separate AI check compared each value with the paper.";

  // A CatLog v2 row in the table index (no verification_method there). The frozen Oct 7 base's own paper-read rows
  // carry ec_name_fallback, so the enzyme-name source tells them apart.
  function isV2Row(row) {
    return row?.source_db === "primary_paper_direct"
      && row.verification_status === "verified"
      && row.enzyme_label_source === "explicit_enzyme_name";
  }

  // Human review (CatLog v2 HUMAN_REVIEW.md "Guideline"): records a human reviewer checked, and neutral notes on what a
  // reviewer assessed. data/human-review-marks.json is keyed by the record key; the page works without it.
  let humanReviewMarks = {};

  async function loadHumanReviewMarks() {
    if (typeof window.fetch !== "function") return;
    try {
      const response = await window.fetch(versionedAssetUrl("data/human-review-marks.json"));
      if (response.ok) humanReviewMarks = (await response.json()).marks || {};
    } catch (error) {
      humanReviewMarks = {};
    }
  }

  function humanReviewMark(row) {
    const key = String(row?.measurement_key || row?.record_key || "");
    return humanReviewMarks[key] || null;  // exact key only: a suffixed duplicate is a different record
  }

  // When the marks arrive, the visible status badges are updated in place (rows are not redrawn: a reader, or a test,
  // holding a row keeps it).
  function applyHumanReviewMarks() {
    // The counts band's Human-checked count follows the results once the marks are here.
    if (Object.keys(humanReviewMarks).length) renderSummary();
    if (!state.filtered.length || !Object.keys(humanReviewMarks).length
      || document.body.classList.contains("catalog-load-failed")) return;
    const pageRows = new Map(currentPageRows().map((row) => [row.record_key, row]));
    document.querySelectorAll("#recordsBody tr[data-key]").forEach((tr) => {
      const row = pageRows.get(tr.dataset.key);
      const badge = tr.querySelector(".state-badge");
      if (row && badge) badge.outerHTML = statusBadge(row);
    });
    fitTableColumns();
    // A record opened before the marks arrived (a deep link) gets its human-review lines too, redrawn in place: the rows
    // stay, and focus inside the record stays there. A record still loading draws them when it arrives.
    const row = state.selectedKey && document.body.classList.contains("detail-open") && state.selectedDetail
      ? state.records.find((item) => item.record_key === state.selectedKey)
      : null;
    if (row) {
      const focusInside = $("detailContent").contains(document.activeElement);
      renderDetail(summaryWithDetail(row, state.selectedDetail), state.selectedDetail);
      if (focusInside) $("detailHeading")?.focus({ preventScroll: true });
    }
  }

  // The record index (and the human-review marks) load the first time Browse is shown or about to be: Stats and Guide
  // never download them.
  let recordsLoad = null;
  function ensureRecordsLoaded() {
    if (!recordsLoad) {
      recordsLoad = loadRecordChunks().catch((error) => {
        showLoadNotice(
          "CatLog could not start",
          error?.message || String(error),
          { actionLabel: "Try again", onAction: reloadCatalogPage },
        );
      });
      loadHumanReviewMarks().then(() => {
        humanReviewMarksArrived();
        applyHumanReviewMarks();
      }).catch(() => {});
    }
    return recordsLoad;
  }

  function humanReviewNote(row) {
    const mark = humanReviewMark(row);
    // A checked mark on a record that is not accepted: the reviewer approved its values, other checks are still open.
    const accepted = (row._recordState || recordStateForRow(row)) === "accepted";
    // Facts only: a note's review year is left out.
    const note = String(mark?.note || "").replace(/\bCatLog(['’]s) (?:19|20)\d\d review\b/g, "CatLog$1 review");
    return note || (mark?.checked
      ? (accepted
          ? "A human reviewer approved every value this record shows, in CatLog's review of the catalog."
          : "A human reviewer approved these values in CatLog's review of the catalog; other checks on this record are still open.")
      : "");
  }

  // "human-checked" is shown only on accepted records a human reviewer checked.
  function isHumanChecked(row) {
    return (row._recordState || recordStateForRow(row)) === "accepted" && Boolean(humanReviewMark(row)?.checked);
  }

  // The small check drawn before "human-checked" (badges, the record's status line, the counts band, the Guide).
  const CHECK_ICON_HTML = '<svg class="check-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2.4 6.5 4.9 9 9.6 3.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // A record read by CatLog: the method in one line, ending with whether code converted any value's unit (facts: the
  // record's proof-line facts; without them nothing is said about units).
  function v2MethodSentence(facts = null) {
    const base = v2Sentence.replace(/\.$/, "");
    if (!facts?.length) return `${base}.`;
    return facts.some((fact) => /converted by code/.test(fact.conversion || ""))
      ? `${base}; units converted by code.`
      : `${base}; values stored as printed.`;
  }

  // The paper prints no EC number: the EC shown is the one the enzyme databases list for this paper's values.
  function ecFromDatabases(detail = {}) {
    return String(detail.verification_method || "").includes("ec_from_databases");
  }

  function reviewOutcome(summary, detail = {}) {
    const method = String(detail.verification_method || "");
    if (summary.verification_status === "verified" && method.startsWith(v2Method)) return v2MethodSentence();
    const outcome = reviewOutcomeBase(summary);
    return isIdentityOnlyAccepted(summary) ? `${outcome} No PMID or DOI is linked, so the value cannot be checked against a paper.` : outcome;
  }

  // The review result; with exact, a Not checked record also names its own status ("Not checked (Unverified)").
  function rowStatusLabel(row, { exact = false } = {}) {
    const result = stateConfig(row._recordState || recordStateForRow(row)).label;
    if (!exact || result !== "Not checked") return result;
    const status = String(row.verification_status || "").trim();
    const own = reviewStatuses.find((item) => item.value === status)?.label
      || (status ? status.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase()) : "");
    return own ? `${result} (${own})` : result;
  }

  // One badge for the table: a dot and the review result, then whole-word tags: the source (from paper, BRENDA, ...), then
  // corrected, no paper linked, human-checked. The tag line is always present, so every badge has the same height. Its
  // title says what the result means for this record; its accessible name is the words alone ("Accepted, from paper").
  function statusBadge(row) {
    const config = stateConfig(row._recordState || recordStateForRow(row));
    const isCorrected = row.verification_status === "corrected";
    const identityOnly = isIdentityOnlyAccepted(row);
    const fromPaper = isV2Row(row);
    // A Not checked record describes its own status (Unverified, Not reviewed).
    const ownStatus = config.value === "not_verified"
      ? reviewStatuses.find((item) => item.value === row.verification_status)?.description
      : "";
    const description = fromPaper
      ? v2Sentence
      : (identityOnly
          ? identityOnlyTrustNote
          : (config.value === "accepted"
              ? reviewStatuses.find((item) => item.value === row.verification_status)?.description
              : (ownStatus ? `${rowStatusLabel(row, { exact: true })}: ${ownStatus}` : stateDescriptions[config.value])))
      || config.label;
    const label = rowStatusLabel(row);
    // "human-checked" only on accepted rows, with a check in its own colour; the record's Human review line shows for
    // every marked row.
    const checked = isHumanChecked(row);
    const tags = [
      sourceTagText(row),
      isCorrected ? "corrected" : "",
      identityOnly ? "no paper linked" : "",
    ].filter(Boolean);
    const fullDescription = checked
      ? `${description} Human-checked: ${fromPaper ? "a human reviewer approved the same values in the earlier catalog." : "a human reviewer approved every value shown."}`
      : description;
    const className = `${config.className}${identityOnly ? " identity-only" : ""}`;
    const tagsHtml = tags.map((tag) => `<span class="state-tag">${escapeHtml(tag)}</span>`).join("")
      + (checked ? `<span class="state-tag human-checked">${CHECK_ICON_HTML}human-checked</span>` : "");
    const name = [label, ...tags, checked ? "human-checked" : ""].filter(Boolean).join(", ");
    return `<span class="state-badge ${className}" data-status="${escapeHtml(row.verification_status || "")}" title="${escapeHtml(fullDescription)}" aria-label="${escapeHtml(name)}"><span class="state-label">${escapeHtml(label)}</span><span class="state-tags">${tagsHtml}</span></span>`;
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
    // the open record's shard is never evicted (a hover prefetch must not unload the record being read)
    const keep = state.selectedKey ? state.selectedShard : "";
    while (state.detailShardLru.size > DETAIL_SHARD_CACHE_LIMIT) {
      const oldest = [...state.detailShardLru.keys()].find((key) => key !== keep && key !== src);
      if (!oldest) break;
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
    // Disputed sorts with Not checked, as the index's Review-status order has it.
    const stateRanks = { accepted: 0, curation_pending: 1, not_verified: 2, disputed: 2 };
    state.records.forEach((row, index) => {
      row._loadIndex = index;
      row._recordState = recordStateForRow(row);
      row._stateRank = stateRanks[row._recordState];
      // Review-status sort: CatLog v2 accepted rows (read from the paper) lead the accepted block.
      row._tierRank = isV2Row(row)
        ? -1
        : (tierOrder[row.evidence_confidence_tier] ?? 99);
      row._sourceCount = Number(row.source_record_count || 0);
      row._sortEnzyme = String(row.enzyme_display_name || "");
      row._sortOrganism = String(row.organism || "");
      row._sortSubstrate = String(row.substrate_name || "");
      row._sortTemperature = temperatureValue(row);
      row._sortPh = phValue(row);
      // _ecSort and _search are filled on first use (ecParts, searchText): most rows never need them.
    });
  }

  function ecParts(row) {
    row._ecSort ??= String(row.ec_number || "").split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : Number.MAX_SAFE_INTEGER));
    return row._ecSort;
  }

  // Common names the search box understands (catlog-v2 enrich.COMMON, plus yeast), keyed by genus and species.
  const commonOrganismNames = {
    "homo sapiens": "human",
    "rattus norvegicus": "rat",
    "mus musculus": "mouse",
    "oryctolagus cuniculus": "rabbit",
    "bos taurus": "bovine cow",
    "sus scrofa": "porcine pig",
    "canis lupus": "dog",
    "gallus gallus": "chicken",
    "zea mays": "maize",
    "sorghum bicolor": "sorghum",
    "saccharomyces cerevisiae": "yeast",
  };
  const organismSearchExtras = new Map();

  // "Escherichia coli" also answers to "E. coli" and "E.coli"; "Homo sapiens" to "human".
  function organismSearchText(organism) {
    const text = String(organism || "").trim();
    if (!text) return "";
    let extra = organismSearchExtras.get(text);
    if (extra === undefined) {
      const words = text.replace(/[()]/g, " ").split(/\s+/).filter(Boolean);
      const [genus = "", species = ""] = words;
      const parts = [];
      if (/^[A-Z][a-z]+$/.test(genus) && /^[a-z][a-z-]+$/.test(species) && species !== "sp.") {
        parts.push(`${genus[0]}. ${species}`, `${genus[0]}.${species}`);
      }
      const common = commonOrganismNames[`${genus} ${species}`.toLowerCase()];
      if (common) parts.push(common);
      extra = parts.join("|");
      organismSearchExtras.set(text, extra);
    }
    return extra;
  }

  // The folded text the search box matches, built the first time a search needs it.
  function searchText(row) {
    row._search ??= compactSearch(foldSearch(row._search_text || [
      row.measurement_key,
      row.review_key,
      row.ec_number,
      row.enzyme_display_name,
      row.organism,
      organismSearchText(row.organism),
      row.substrate_name,
      row.mutation_signature === "Unknown" ? "" : row.mutation_signature,
      row.source_db,
      row.primary_uniprot_id,
      row.protein_accession,
    ].join("|")));
    return row._search;
  }

  // The search text of every record is prepared in idle moments once a search looks likely (the search box or the
  // filters get focus), so the first word typed is filtered as fast as the next.
  const searchWarmup = { wanted: false, generation: -1, index: 0, running: false };

  function warmSearchText() {
    searchWarmup.wanted = true;
    if (searchWarmup.running || !state.recordsReady) return;
    if (searchWarmup.generation !== state.recordsGeneration) {
      searchWarmup.generation = state.recordsGeneration;
      searchWarmup.index = 0;
    }
    if (searchWarmup.index >= state.records.length) return;
    searchWarmup.running = true;
    const schedule = (callback) => (typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback(callback, { timeout: 400 })
      : window.setTimeout(callback, 16));
    const step = () => {
      const records = state.records;
      if (searchWarmup.generation !== state.recordsGeneration) {
        searchWarmup.running = false;
        warmSearchText();
        return;
      }
      const end = Math.min(records.length, searchWarmup.index + 5000);
      for (; searchWarmup.index < end; searchWarmup.index += 1) searchText(records[searchWarmup.index]);
      if (searchWarmup.index < records.length) schedule(step);
      else searchWarmup.running = false;
    };
    schedule(step);
  }

  // An EC number or class typed in full parts ("1.1.1", "EC 2.7.1.1", "ec:1.1.1.1", "1.", "1.1.1.-"): it matches that
  // number and every number under it, never 3.1.1.1 or 1.1.1.10 for 1.1.1.1. In the search box a number is an EC number
  // when it has two parts or more, a dot after it ("1.") or EC in front ("EC 1"); in the EC field every number is.
  const EC_QUERY = /^(e\.?c\.?:?)?(\d+(?:\.(?:\d+|-)){0,3})(\.)?$/;
  const EC_WORD = /^e\.?c\.?:?$/;

  function ecQuery(word, { anyNumber = false } = {}) {
    const match = String(word || "").toLowerCase().match(EC_QUERY);
    if (!match) return "";
    const number = match[2].replace(/(\.-)+$/, "");
    return anyNumber || match[1] || match[3] || number.includes(".") ? number : "";
  }

  // A locant or prefix typed as its own word joins the word after it, so "4 nitrophenyl" is "4-nitrophenyl",
  // "beta galactosidase" is "β-galactosidase" and "D glucose" is "D-glucose" (in "galactosidase beta" the words stay
  // apart and match in any order).
  const LOCANT_WORD = new RegExp(`^(?:\\d{1,2}'*(?:,\\d{1,2}'*)*|[dlpomn](?:,[dl])?|${[...new Set(Object.values(greekNames))].join("|")})$`);

  function joinLocantWords(words) {
    const joined = [];
    for (let index = 0; index < words.length; index += 1) {
      let word = words[index];
      while (LOCANT_WORD.test(word) && index + 1 < words.length) {
        const next = words[index + 1];
        if (!/^[\p{L}\p{N}(]/u.test(next) || ecQuery(next) || DOI_WORD.test(next) || /^\d{3,}$/.test(next)) break;
        word += next;
        index += 1;
      }
      joined.push(word);
    }
    return joined;
  }

  // "EC 1.1.1.1" and "E.C.: 2.7" typed as two words become one.
  function joinEcWords(words) {
    const joined = [];
    for (let index = 0; index < words.length; index += 1) {
      const next = words[index + 1];
      if (EC_WORD.test(words[index]) && next !== undefined && /^\d+(?:\.(?:\d+|-))*\.?$/.test(next)) {
        joined.push(`ec${next}`);
        index += 1;
      } else {
        joined.push(words[index]);
      }
    }
    return joined;
  }

  function ecMatches(row, query) {
    return String(row.ec_number || "").toLowerCase().split(/[;,\s]+/)
      .some((ec) => ec === query || ec.startsWith(`${query}.`));
  }

  // The DOIs of the loaded index (header.dois), which rows name by position.
  let paperDois = Object.freeze([]);
  const PMID_WORD = /^(pmid:)?([1-9]\d{0,9})$/;
  const DOI_WORD = /^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:)?(10\.\d{4,9}\/\S+)$/;

  function rowHasPmid(row, pmid) {
    const value = row._pmids;
    return value === pmid || (Array.isArray(value) && value.includes(pmid));
  }

  // A DOI typed in full or in part (its beginning) matches the records of that paper.
  function rowHasDoi(row, doi) {
    const value = row._dois;
    if (value == null) return false;
    return (Array.isArray(value) ? value : [value]).some((position) => paperDois[position]?.startsWith(doi));
  }

  // Search words: every word must match, in any order, and in any case, with or without accents, hyphens or spaces
  // inside a name (foldSearch). Words split at spaces only, so a chemical name keeps its commas ("2,4-dinitrophenol" is
  // one word); a comma or semicolon typed after a word is dropped. An EC number matches EC parts (ecQuery); "EC" in
  // front of one is part of it. A number also matches the records of that PMID, and a DOI (10.xxxx/...) the records of
  // that paper; "PMID" or "DOI" in front of one is dropped.
  function searchWords(query) {
    const words = joinLocantWords(joinEcWords(foldSearch(query).split(/\s+/)
      .map((word) => word.replace(/^[,;]+|[,;]+$/g, ""))
      .filter((word) => /[\p{L}\p{N}]/u.test(word))));
    const hasPaperId = words.some((word) => PMID_WORD.test(word) || DOI_WORD.test(word));
    return words
      .filter((word) => !(hasPaperId && /^(pmid|doi):?$/.test(word)))
      .map((word) => {
        const ec = ecQuery(word);
        if (ec) return { ec };
        const doi = word.match(DOI_WORD);
        if (doi) return { doi: doi[1].replace(/;.*$/, "") };
        const pmid = word.match(PMID_WORD);
        if (pmid) return pmid[1] ? { pmid: Number(pmid[2]) } : { pmid: Number(pmid[2]), text: word };
        return { text: compactSearch(word) };
      })
      .filter((word) => word.ec || word.doi || word.pmid || word.text);
  }

  // The EC field: one or more EC numbers or classes ("1.1.1", "1.1.1.1 1.1.1.2"); a record matches any of them. Text
  // that is not a number is looked for in the EC as written.
  function ecFilterQueries(text) {
    // "EC" typed on its own (on the way to "EC 1.1") filters nothing yet.
    return joinEcWords(foldSearch(text).split(/[\s,;]+/).filter(Boolean)).filter((word) => !EC_WORD.test(word)).map((word) => {
      const ec = ecQuery(word, { anyNumber: true });
      return ec ? { ec } : { text: compactSearch(word) };
    }).filter((query) => query.ec || query.text);
  }

  // A field filter (enzyme, organism, substrate): every word typed is in the field, in any order.
  function fieldWords(text) {
    return joinLocantWords(foldSearch(text).split(/\s+/).filter(Boolean)).map(compactSearch).filter(Boolean);
  }

  function wordMatches(row, word, text) {
    if (word.ec) return ecMatches(row, word.ec);
    if (word.doi) return rowHasDoi(row, word.doi);
    if (word.pmid && rowHasPmid(row, word.pmid)) return true;
    return word.text !== undefined && text.includes(word.text);
  }

  // A value sort (from an address) waits for every record: a top 25 of the records loaded so far would change.
  function sortWaitsForRecords() {
    return !state.recordsReady && ($("sortSelect")?.value || "evidence") !== "evidence";
  }

  function loadProgressText() {
    const text = state.loadProgressUnit === "records"
      ? `Loading ${formatInteger(state.recordChunksLoaded)} of ${formatInteger(state.recordChunksTotal)} records`
      : "Loading records";
    return sortWaitsForRecords() ? `${text}, then sorting` : `${text}${state.loadProgressUnit === "records" ? "" : "…"}`;
  }

  function updateLoadProgress() {
    const total = Math.max(1, state.recordChunksTotal);
    const progress = state.recordsReady
      ? 100
      : Math.min(100, Math.round((state.recordChunksLoaded / total) * 100));
    const rail = $("catalogLoadProgress");
    if (rail) {
      rail.style.setProperty("--load-progress", String(progress / 100));
      rail.setAttribute("aria-valuenow", String(progress));
      rail.setAttribute(
        "aria-valuetext",
        state.recordsReady
          ? "CatLog ready"
          : (state.loadProgressUnit === "records"
              ? `${formatInteger(state.recordChunksLoaded)} of ${formatInteger(state.recordChunksTotal)} CatLog records loaded`
              : "Loading CatLog records"),
      );
      rail.classList.toggle("complete", state.recordsReady);
      if (state.recordChunksLoaded || state.recordsReady) rail.classList.remove("stalled");
    }
    // The count beside Filters says how many records have loaded only until the first rows are drawn. After that it
    // keeps the page range, so its width (and the toolbar's wrapping) does not change when the rest arrives; the bar's
    // aria-valuetext keeps the count.
    const summary = $("pageSummary");
    if (!summary || state.recordsReady || document.body.classList.contains("catalog-load-failed")) return;
    if (!document.querySelector?.("#recordsBody tr[data-key]")) summary.textContent = loadProgressText();
  }

  function markPerformance(name) {
    try {
      window.performance?.mark?.(name);
    } catch (_error) {
      // Timing marks are optional.
    }
  }

  function setSortAvailable(available) {
    const select = $("sortSelect");
    if (!select) return;
    select.disabled = !available;
    select.title = available ? "" : SORT_LOADING_TITLE;
    document.querySelectorAll?.(".sort-button").forEach((button) => { button.disabled = !available; });
    syncSortHeaders();
  }

  // The numeric columns sort both ways: "kcat" is high to low, "kcat_asc" low to high. A column header shows the
  // direction of the current sort (aria-sort and an arrow); clicking it sorts high to low, then low to high.
  const SORT_HEADER_NAMES = { kcat: "kcat", km: "Km", kcat_over_km: "kcat/Km", temperature: "assay temperature", ph: "assay pH" };

  function syncSortHeaders() {
    const sort = $("sortSelect")?.value || "evidence";
    const loading = Boolean($("sortSelect")?.disabled);
    document.querySelectorAll?.(".sort-button").forEach((button) => {
      const key = button.dataset.sort;
      const direction = sort === key ? "descending" : sort === `${key}_asc` ? "ascending" : "";
      const th = button.closest("th");
      if (direction) th.setAttribute("aria-sort", direction);
      else th.removeAttribute("aria-sort");
      button.title = loading
        ? SORT_LOADING_TITLE
        : `Sort by ${SORT_HEADER_NAMES[key]}, ${direction === "descending" ? "low to high" : "high to low"}`;
    });
  }

  function sortByColumn(key) {
    const select = $("sortSelect");
    if (!select || select.disabled) return;
    select.value = select.value === key ? `${key}_asc` : key;
    syncSortHeaders();
    announceSort();
    applyFiltersInBackground();
  }

  // A screen reader hears the new order (the counts, which it also hears, do not change).
  function announceSort() {
    const select = $("sortSelect");
    const status = $("tableStatus");
    if (!select || !status) return;
    const label = select.options?.[select.selectedIndex]?.textContent || select.value;
    status.textContent = `Sorted by ${label}`;
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

  // The number of table columns (the test harness has no table, hence the fallback).
  function tableColumnCount() {
    return document.querySelectorAll?.("#recordTableWrap thead th").length || 11;
  }

  // What a visitor reads when loading fails: a page older than the data it finds says so plainly; the technical detail
  // (which file, which check) stays in the console.
  const OUT_OF_DATE_MESSAGE = "This page is out of date. Reload to update it.";

  function publicLoadMessage(message) {
    const text = String(message || "");
    if (/does not match the CatLog source generation|cannot read CatLog index version|use different shard sizes|CatLog index is missing/.test(text)) {
      if (text !== OUT_OF_DATE_MESSAGE) console.warn(`CatLog: ${text}`);
      return OUT_OF_DATE_MESSAGE;
    }
    if (/^Detail shard /.test(text)) {
      console.warn(`CatLog: ${text}`);
      return "This record could not be loaded.";
    }
    return text;
  }

  function showLoadNotice(title, rawMessage, { actionLabel = "", onAction = null } = {}) {
    const message = publicLoadMessage(rawMessage);
    document.body.classList.add("catalog-load-failed");
    const body = $("recordsBody");
    if (body) {
      body.innerHTML = `
        <tr class="loading-row notice-row">
          <td colspan="${tableColumnCount()}">
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
    $("pageSummary").classList.remove("visually-hidden");
    if ($("clearResultsButton")) $("clearResultsButton").hidden = true;
    $("pageLabel").textContent = "No records";
    $("prevButton").disabled = true;
    $("nextButton").disabled = true;
    $("downloadPageButton").disabled = true;
    if ($("exportAllCsvButton")) $("exportAllCsvButton").disabled = true;
    if ($("exportPageCsvButton")) $("exportPageCsvButton").disabled = true;
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

  // Schema 2 of the record index: a header line, then one JSON array per row in header.fields order. Fields named in
  // header.enums hold an index into that list; fields named in header.texts hold either text or an index into that
  // list; kcat, km and kcat_over_km hold true when Number(their *_display) is the value; review_key and
  // protein_accession hold true when equal to record_key and primary_uniprot_id; s is the detail-shard number.
  const VIEWER_INDEX_ENUM_FIELDS = [
    "enzyme_label_source", "source_db", "verification_status", "evidence_confidence_tier", "sequence_variant_status",
    "kcat_over_km_origin", "public_trust_basis", "temperature_display", "condition_flags", "kcat_unit", "km_unit",
    "kcat_over_km_unit", "wild_type",
  ];
  const VIEWER_INDEX_TEXT_FIELDS = [
    "enzyme_display_name", "ec_number", "organism", "substrate_name", "mutation_signature", "primary_uniprot_id",
    "kcat_display", "km_display", "kcat_over_km_display",
  ];
  const VIEWER_INDEX_FIELDS = [
    "record_key", "review_key", ...VIEWER_INDEX_TEXT_FIELDS, "protein_accession", "kcat", "km", "kcat_over_km",
    "ph_display", "temperature_k", "source_record_count", ...VIEWER_INDEX_ENUM_FIELDS, "s",
  ];
  // Optional paper identifiers (an index built with the Full data download next to the table): "pmids" holds a PMID, a
  // list of them or null; "dois" an index into header.dois (lower-case DOIs), a list of them or null. The rows keep
  // them as _pmids and _dois, for the search box only.
  const VIEWER_INDEX_PAPER_FIELDS = ["pmids", "dois"];
  // Record-panel fields a schema-2 row leaves to the record's detail entry.
  const DETAIL_ONLY_FIELDS = [
    "identity_resolution_state", "uniprot_candidate_ids", "sequence_resolved", "has_proof_excerpt", "proof_kind",
    "has_literature_id", "protein_accession_database", "source_protein_accession", "kcat_over_km_source_differs",
  ];

  function isViewerIndexHeader(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) && value.kind === "catlog_viewer_index";
  }

  function checkedViewerIndexHeader(header, detailsPerShard) {
    if (header.schema_version !== 2) {
      throw new Error(`This page cannot read CatLog index version ${header.schema_version}. Reload the page.`);
    }
    const fields = Array.isArray(header.fields) ? header.fields : [];
    const missing = VIEWER_INDEX_FIELDS.filter((field) => !fields.includes(field));
    const enums = header.enums && typeof header.enums === "object" ? header.enums : {};
    const missingEnums = VIEWER_INDEX_ENUM_FIELDS.filter((field) => !Array.isArray(enums[field]));
    if (missing.length || missingEnums.length) {
      throw new Error(`The CatLog index is missing ${[...missing, ...missingEnums].join(", ")}`);
    }
    if (Number(header.details_per_shard) !== detailsPerShard) {
      throw new Error("The CatLog index and its record files use different shard sizes");
    }
    return header;
  }

  // One constructor for every row: rows share one compact shape (169k plain objects with these fields would use far
  // more memory and sort slower), and the shared values are frozen because many rows hold the same object.
  function viewerRowConstructor(header, detailShards) {
    const at = Object.fromEntries(VIEWER_INDEX_FIELDS.map((field) => [field, header.fields.indexOf(field)]));
    const shared = (values) => Object.freeze((Array.isArray(values) ? values : []).map(
      (value) => (value && typeof value === "object" ? Object.freeze(value) : value),
    ));
    const enums = Object.fromEntries(VIEWER_INDEX_ENUM_FIELDS.map((field) => [field, shared(header.enums[field])]));
    const texts = Object.fromEntries(VIEWER_INDEX_TEXT_FIELDS.map((field) => [field, shared(header.texts?.[field])]));
    const text = (field, v) => {
      const value = v[at[field]];
      return typeof value === "number" ? texts[field][value] : value;
    };
    const item = (field, v) => enums[field][v[at[field]]];
    const number = (field, v, display) => (v[at[field]] === true ? Number(display) : v[at[field]]);
    const [pmidsAt, doisAt] = VIEWER_INDEX_PAPER_FIELDS.map((field) => header.fields.indexOf(field));
    paperDois = Object.freeze(Array.isArray(header.dois) ? header.dois.map(String) : []);
    function ViewerRow(v) {
      this.record_key = v[at.record_key];
      this.review_key = v[at.review_key] === true ? this.record_key : v[at.review_key];
      this.enzyme_display_name = text("enzyme_display_name", v);
      this.ec_number = text("ec_number", v);
      this.organism = text("organism", v);
      this.substrate_name = text("substrate_name", v);
      this.mutation_signature = text("mutation_signature", v);
      this.primary_uniprot_id = text("primary_uniprot_id", v);
      this.protein_accession = v[at.protein_accession] === true ? this.primary_uniprot_id : v[at.protein_accession];
      this.kcat_display = text("kcat_display", v);
      this.km_display = text("km_display", v);
      this.kcat_over_km_display = text("kcat_over_km_display", v);
      this.kcat = number("kcat", v, this.kcat_display);
      this.km = number("km", v, this.km_display);
      this.kcat_over_km = number("kcat_over_km", v, this.kcat_over_km_display);
      this.ph_display = v[at.ph_display];
      this.temperature_k = v[at.temperature_k];
      this.source_record_count = v[at.source_record_count];
      this.enzyme_label_source = item("enzyme_label_source", v);
      this.source_db = item("source_db", v);
      this.verification_status = item("verification_status", v);
      this.evidence_confidence_tier = item("evidence_confidence_tier", v);
      this.sequence_variant_status = item("sequence_variant_status", v);
      this.kcat_over_km_origin = item("kcat_over_km_origin", v);
      this.public_trust_basis = item("public_trust_basis", v);
      this.temperature_display = item("temperature_display", v);
      this.condition_flags = item("condition_flags", v);
      this.kcat_unit = item("kcat_unit", v);
      this.km_unit = item("km_unit", v);
      this.kcat_over_km_unit = item("kcat_over_km_unit", v);
      this.wild_type = item("wild_type", v);
      this.detail_shard = detailShards[v[at.s]] || "";
      this.measurement_key = this.record_key;
      this.ph = this.ph_display;
      this._loadIndex = 0;
      this._recordState = null;
      this._stateRank = 0;
      this._tierRank = 0;
      this._sourceCount = 0;
      this._ecSort = null;
      this._sortEnzyme = "";
      this._sortOrganism = "";
      this._sortSubstrate = "";
      this._sortTemperature = null;
      this._sortPh = null;
      this._search = null;
      this._variantBits = null;
      this._cautionBits = null;
      this._pmids = pmidsAt >= 0 ? v[pmidsAt] : null;
      this._dois = doisAt >= 0 ? v[doisAt] : null;
    }
    return ViewerRow;
  }

  async function streamCompressedRecordIndexAttempt(retryAttempt = 0, { onFirstRows = null } = {}) {
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
    // Schema 2 starts with a header line; schema 1 (an older page's manifest) is one keyed object per row.
    let layoutKnown = false;
    let header = null;
    let ViewerRow = null;
    let firstRowsSent = false;

    state.loadProgressUnit = "records";
    state.recordChunksLoaded = 0;
    state.recordChunksTotal = totalRows || 1;
    state.indexOrder = "";
    updateLoadProgress();

    const consumeLines = (final = false) => {
      const lines = buffer.split("\n");
      buffer = final ? "" : (lines.pop() || "");
      lines.forEach((line) => {
        if (!line.trim()) return;
        const value = JSON.parse(line);
        if (!layoutKnown) {
          layoutKnown = true;
          if (isViewerIndexHeader(value)) {
            header = checkedViewerIndexHeader(value, detailsPerShard);
            ViewerRow = viewerRowConstructor(header, detailShards);
            state.indexOrder = header.order === DEFAULT_INDEX_ORDER ? DEFAULT_INDEX_ORDER : "";
            return;
          }
        }
        if (ViewerRow) {
          if (!Array.isArray(value)) throw new Error("The CatLog index contains an invalid row");
          records.push(new ViewerRow(value));
          return;
        }
        value.detail_shard = detailShards[Math.floor(records.length / detailsPerShard)] || "";
        records.push(value);
      });
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        consumeLines();
        if (!firstRowsSent && onFirstRows && state.indexOrder === DEFAULT_INDEX_ORDER
            && records.length >= FIRST_ROWS_MIN) {
          // Page 1 of the default order is final already: draw it now, then keep reading.
          firstRowsSent = true;
          state.recordChunksLoaded = records.length;
          lastProgress = records.length;
          updateLoadProgress();
          await onFirstRows(records.slice());
          await yieldToBrowser();
        } else if (records.length - lastProgress >= 2500) {
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
      if (header && header.row_count !== records.length) {
        throw new Error(`Expected ${header.row_count} CatLog rows, received ${records.length}`);
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

  async function streamCompressedRecordIndex({ onFirstRows = null } = {}) {
    let lastError = null;
    for (let attempt = 0; attempt <= LOAD_RETRY_DELAYS.length; attempt += 1) {
      try {
        return await streamCompressedRecordIndexAttempt(attempt, { onFirstRows });
      } catch (error) {
        lastError = error;
        if (attempt >= LOAD_RETRY_DELAYS.length) break;
        const delaySeconds = Math.round(LOAD_RETRY_DELAYS[attempt] / 1000);
        const message = `The download was interrupted. Trying again in ${delaySeconds} seconds.`;
        if (state.firstRowsShown) {
          // Page 1 stays on screen; only the counts say that the rest is being downloaded again.
          $("activeSummary").textContent = "Retrying table download";
          $("pageSummary").textContent = message;
          $("pageSummary").classList.remove("visually-hidden");
          $("catalogLoadProgress")?.classList.add("stalled");
        } else {
          showLoadNotice("Retrying table download", message);
        }
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
    // Page 1 is drawn once from the first rows of an index in the default order; a retried download never redraws it.
    let firstPainted = false;
    const onFirstRows = async (rows) => {
      if (firstPainted || state.recordsReady) return;
      firstPainted = true;
      try {
        indexLoadedRecords(rows);
        setupFilters();
        setSortAvailable(false);
        await ensureCurrentFilters();
        updateTableScrollControls();
        state.firstRowsShown = true;
        markPerformance("catlog:first-rows");
      } catch (error) {
        // The complete index still renders when it arrives.
        state.firstRowsShown = false;
        console.warn("CatLog could not show the first rows early", error);
      }
    };
    try {
      streamedRecords = await streamCompressedRecordIndex({ onFirstRows });
    } catch (error) {
      streamedRecords = null;
      streamError = error;
    }
    if (streamedRecords) {
      indexLoadedRecords(streamedRecords);
      state.recordsReady = true;
      updateLoadProgress();
      setupFilters();
      setSortAvailable(true);
      // The page already drawn from the first rows stays as it is when it is the same page.
      state.preserveRenderedRows = state.firstRowsShown;
      try {
        await ensureCurrentFilters({ resetPage: !state.firstRowsShown });
      } finally {
        state.preserveRenderedRows = false;
        state.firstRowsShown = false;
      }
      markPerformance("catlog:ready");
      updateTableScrollControls();
      return;
    }
    state.firstRowsShown = false;
    setSortAvailable(true);

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
            "This browser cannot open the CatLog records",
            "Use a current version of Safari, Chrome, Edge or Firefox, or use the Table download.",
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

  function triggerBlobDownload(filename, payload, type = "application/json;charset=utf-8") {
    const blob = new Blob(Array.isArray(payload) ? payload : [payload], { type });
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
      _sortTemperature,
      _sortPh,
      _search,
      _search_text,
      _variantBits,
      _cautionBits,
      _pmids,
      _dois,
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

  // Export results: the filtered records as CSV (all of them, or this page) built here from the loaded index, or this
  // page as JSON with every field (from the records' detail files). The CSV keeps the stored digits, the catalog units
  // and the words the table shows.
  const DOWNLOAD_PAGE_LABEL = "<strong>This page (JSON)</strong><span>Every field of the records on this page</span>";
  const CSV_COLUMNS = [
    ["record_key", (row) => row.record_key],
    ["enzyme_display_name", (row) => row.enzyme_display_name],
    ["ec_number", (row) => row.ec_number],
    ["organism", (row) => row.organism],
    ["substrate_name", (row) => row.substrate_name],
    ["variant", (row) => enzymeFormText(row) || (rowVariantBits(row) === 1 ? "wild type" : "")],
    ...["kcat", "km", "kcat_over_km"].flatMap((field) => [
      [field, (row) => (metricHasValue(row, field) ? metricDisplay(row, field) : "")],
      [`${field}_unit`, (row) => (metricHasValue(row, field) ? plainUnit(metricUnit(row, field)) : "")],
    ]),
    ["kcat_over_km_origin", (row) => (metricHasValue(row, "kcat_over_km") ? row.kcat_over_km_origin : "")],
    ["temperature_c", (row) => csvCondition(formatTemperature(row))],
    ["ph", (row) => csvCondition(formatPh(row))],
    ["review_result", (row) => rowStatusLabel(row, { exact: true })],
    ["human_checked", (row) => (state.humanMarksLoaded ? (isHumanChecked(row) ? "yes" : "no") : "")],
    ["source", (row) => sourceTagText(row)],
    ["source_db", (row) => row.source_db],
    ["pubmed_id", (row) => paperIdsOf(row._pmids, (value) => String(value))],
    ["doi", (row) => paperIdsOf(row._dois, (position) => paperDois[position] || "")],
    ["primary_uniprot_id", (row) => row.primary_uniprot_id],
  ];

  function csvCondition(value) {
    return value === EMPTY_VALUE ? "" : value;
  }

  function paperIdsOf(value, toText) {
    if (value == null) return "";
    return (Array.isArray(value) ? value : [value]).map(toText).filter(Boolean).join("; ");
  }

  // One CSV cell (RFC 4180); a cell a spreadsheet would read as a formula starts with an apostrophe.
  function csvCell(value) {
    let text = value == null ? "" : String(value);
    if (/^[=@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function csvLine(row) {
    return `${CSV_COLUMNS.map(([, value]) => csvCell(value(row))).join(",")}\r\n`;
  }

  function exportFileStem() {
    const date = manifest.generated_at ? String(manifest.generated_at).slice(0, 10) : new Date().toISOString().slice(0, 10);
    return `catlog-${date}`;
  }

  // The CSV of the given rows, in parts (a slice at a time, the page staying responsive for 169k records).
  async function csvParts(rows) {
    const parts = ["\ufeff", `${CSV_COLUMNS.map(([name]) => name).join(",")}\r\n`];
    for (let start = 0; start < rows.length; start += 5000) {
      let chunk = "";
      for (const row of rows.slice(start, start + 5000)) chunk += csvLine(row);
      parts.push(chunk);
      if (start + 5000 < rows.length) await yieldToBrowser();
    }
    return parts;
  }

  async function handleCsvExport(scope) {
    const button = $(scope === "all" ? "exportAllCsvButton" : "exportPageCsvButton");
    const rows = scope === "all" ? state.filtered : currentPageRows();
    if (!rows.length || button?.disabled) return;
    const label = button?.querySelector?.("strong");
    const original = label?.textContent || "";
    if (button) button.disabled = true;
    if (label) label.textContent = "Preparing…";
    try {
      const parts = await csvParts(rows);
      const name = scope === "all" ? `${exportFileStem()}-results.csv` : `${exportFileStem()}-page-${state.page}.csv`;
      triggerBlobDownload(name, parts, "text/csv;charset=utf-8");
      $("exportMenu")?.removeAttribute("open");
    } finally {
      if (label) label.textContent = original;
      syncExportControls();
    }
  }

  // The export choices follow the results: "All N matching records (CSV)", each disabled when it has nothing to give.
  function syncExportControls(pageRows = currentPageRows()) {
    const count = state.filtered.length;
    const all = $("exportAllCsvButton");
    if (all) {
      all.disabled = !state.recordsReady || !count;
      const label = $("exportAllCsvLabel");
      if (label && label.textContent !== "Preparing…") {
        label.textContent = state.recordsReady
          ? `All ${formatInteger(count)} matching ${count === 1 ? "record" : "records"} (CSV)`
          : "All matching records (CSV)";
      }
    }
    if ($("exportPageCsvButton")) $("exportPageCsvButton").disabled = !pageRows.length;
    if ($("downloadPageButton")) $("downloadPageButton").disabled = state.pageDownloadPending || !pageRows.length;
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
      button.innerHTML = "<strong>Preparing…</strong>";
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
          note: "Database source records are not included.",
          license_note: SOURCE_LICENSE_NOTE,
        },
        records,
      };
      triggerBlobDownload(`${exportFileStem()}-page-${page}.json`, JSON.stringify(payload, null, 2));
      $("exportMenu")?.removeAttribute("open");
    } catch (error) {
      failed = true;
      if (button) {
        button.innerHTML = "<strong>This page could not be exported</strong><span>Try again in a moment.</span>";
        button.title = publicLoadMessage(error?.message);
      }
    } finally {
      state.pageDownloadPending = false;
      if (button) {
        button.disabled = !state.recordsReady || !currentPageRows().length;
        if (!failed) button.innerHTML = DOWNLOAD_PAGE_LABEL;
        if (failed) {
          window.setTimeout(() => {
            button.innerHTML = DOWNLOAD_PAGE_LABEL;
            button.title = originalTitle;
          }, 2500);
        }
      }
    }
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
      <span class="snapshot-title">With</span>
      <span class="snapshot-line"><span><i>k</i><sub>cat</sub></span><strong>${formatCount(kcatRows)}</strong></span>
      <span class="snapshot-line"><span><i>K</i><sub>m</sub></span><strong>${formatCount(kmRows)}</strong></span>
      <span class="snapshot-line"><span><i>k</i><sub>cat</sub>/<i>K</i><sub>m</sub></span><strong>${formatCount(efficiencyRows)}</strong></span>
    `;
    renderFromPaperCount(rows);
    renderHumanCheckedCount(rows);
    $("snapshotDate").textContent = manifest.generated_at ? `Snapshot ${formatDate(manifest.generated_at)}` : "Snapshot date unavailable";
    const dataId = shortHash(manifest.content_sha256 || manifest.source_sha256);
    $("snapshotDate").title = dataId === EMPTY_VALUE ? "" : `Data ID ${dataId}`;
  }

  // "Read from the paper N" in the counts band: the records read from the paper by CatLog among the current results, a
  // link to them (the filters set now, Source: Read from the paper by CatLog). Before the records load, N is the
  // snapshot's own count (summary.overview.from_paper, bound to this snapshot) on an unfiltered view; a count of 0 (or
  // none yet) is plain text.
  function fromPaperHref() {
    const params = browseParamsFromControls({ ...filterControlState(), sourceMode: "paper", sources: [] }).filter(([key]) => key !== "page");
    return browseHash(params);
  }

  function renderFromPaperCount(rows) {
    const link = $("fromPaperLink");
    if (!link) return;
    const snapshotCount = statsCount(statsOverview(Number(manifest.total_rows || 0))?.from_paper?.records);
    let count;
    if (state.recordsReady) count = rows.reduce((total, row) => total + (isV2Row(row) ? 1 : 0), 0);
    else count = activeFilterItems().length ? null : snapshotCount;
    if (count === null && snapshotCount === null && !state.recordsReady) {
      link.hidden = true;
      return;
    }
    link.hidden = false;
    if (count) link.setAttribute("href", fromPaperHref());
    else link.removeAttribute("href");
    if ($("fromPaperCount")) $("fromPaperCount").textContent = formatCount(count);
  }

  // "Human-checked N" in the counts band links to the human-checked records among the current results. Before the
  // records and marks load, N is the snapshot's count (summary.overview.human_checked_accepted of this same snapshot, as
  // Stats uses it); without it the item is hidden. A filtered view whose marks have not arrived shows a dash, and a count
  // of 0 (or a dash) is plain text, not a link to an empty table.
  function humanCheckedHref() {
    // The filters set now (read from the controls, so it is never one change behind the address), from the first page.
    const params = browseParamsFromControls({ ...filterControlState(), checked: true }).filter(([key]) => key !== "page");
    return browseHash(params);
  }

  function renderHumanCheckedCount(rows) {
    const link = $("humanCheckedLink");
    if (!link) return;
    const snapshotCount = statsCount(statsOverview(Number(manifest.total_rows || 0))?.human_checked_accepted);
    if (snapshotCount === null) {
      link.hidden = true;
      return;
    }
    let count = snapshotCount;
    if (state.recordsReady && Object.keys(humanReviewMarks).length) {
      count = rows.reduce((total, row) => total + (isHumanChecked(row) ? 1 : 0), 0);
    } else if (state.recordsReady && rows.length !== state.records.length) {
      count = null;
    }
    link.hidden = false;
    if (count) link.setAttribute("href", humanCheckedHref());
    else link.removeAttribute("href");
    if ($("humanCheckedCount")) $("humanCheckedCount").textContent = formatCount(count);
  }

  function statsShare(count, total) {
    if (!total) return EMPTY_VALUE;
    const percent = count / total * 100;
    return percent > 0 && percent < 0.1 ? "<0.1%" : `${percent.toFixed(1)}%`;
  }

  // A whole count from 0 to max, or null (an older or damaged manifest never draws a bar from a wrong number).
  function statsCount(value, max = Infinity) {
    return Number.isInteger(value) && value >= 0 && value <= max ? value : null;
  }

  // The overview counted from the Full data download of this same snapshot (summary.overview), or null: an older
  // manifest has none, and one counted from another download is not used.
  function statsOverview(total) {
    const overview = manifest.summary?.overview;
    if (!overview || typeof overview !== "object" || !overview.download_sha256
      || overview.download_sha256 !== manifest.enriched_download?.sha256
      || overview.source_sha256 !== manifest.source_sha256 || overview.records !== total) return null;
    return overview;
  }

  // A Browse address with filters (the shared #browse? contract); Stats links open Browse showing those records.
  function statsBrowseHref(params) {
    const url = viewUrl("browse");
    const query = new URL("https://catlog.invalid/");
    for (const [key, value] of Object.entries(params)) query.searchParams.set(key, value);
    url.hash = `browse${query.search}`;
    return url.href;
  }

  function statsNameHtml(item) {
    const label = item.labelHtml || escapeHtml(item.label);
    return item.params ? `<a class="stats-link" href="${escapeHtml(statsBrowseHref(item.params))}">${label}</a>` : label;
  }

  // One row per item: its name (a link into Browse when there is one) and an optional one-line meaning, a bar, the count,
  // and its share of all records (or a second count). Bars are drawn against the total, or against `scale`.
  function statsBarRows(items, total, { scale = total, extra = null, head = null } = {}) {
    const header = head
      ? `<div class="stats-bars-head" aria-hidden="true"><span></span><span></span>${head.map((text) => `<span>${escapeHtml(text)}</span>`).join("")}</div>`
      : "";
    return `${header}<ul class="stats-bars">${items.map((item) => {
      const width = scale > 0 ? Math.max(0, Math.min(100, item.count / scale * 100)) : 0;
      const last = extra
        ? `<span class="stats-bar-share">${formatInteger(item[extra.key])}<span class="visually-hidden"> ${escapeHtml(extra.label)}</span></span>`
        : `<span class="stats-bar-share">${escapeHtml(statsShare(item.count, total))}<span class="visually-hidden"> of all records</span></span>`;
      return `<li class="${item.sub ? "stats-bar-sub" : item.group ? "stats-bar-group" : ""}"${item.group ? ' data-group=""' : ""} data-stat-key="${escapeHtml(item.value)}" data-count="${item.count}">
        <span class="stats-bar-label">${item.color ? `<i class="stats-dot stats-color-${item.color}" aria-hidden="true"></i>` : ""}<span>${statsNameHtml(item)}${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}</span></span>
        <span class="stats-bar-track" aria-hidden="true"><span class="stats-bar-fill${item.color ? ` stats-color-${item.color}` : ""}" style="width:${width}%"></span></span>
        <span class="stats-bar-count">${formatInteger(item.count)}<span class="visually-hidden"> records</span></span>
        ${last}
      </li>`;
    }).join("")}</ul>`;
  }

  function statsSection(id, title, body, { note = "", wide = false, className = "" } = {}) {
    return `<section class="stats-section${wide ? " stats-wide" : ""}${className ? ` ${className}` : ""}" aria-labelledby="${id}">
      <h2 id="${id}">${title}</h2>${note ? `<p>${note}</p>` : ""}${body}</section>`;
  }

  // The hash-bound field counts of one review group (summary.review_details), or null.
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

  // The fields saved in records that are not accepted, per review group: a plain table in a disclosure.
  function statsUnacceptedFields(counts) {
    const cohorts = [["manual_review_required", "Checks pending"], ["unverified", "Unverified"], ["mathematically_inferred", "Not reviewed"]]
      .map(([value, label]) => ({ value, label, group: statsCohortData(value, counts[value] || 0) }))
      .filter((item) => item.group && item.group.total > 0);
    if (!cohorts.length) return "";
    const fields = [["with_kinetic_value", "Kinetic value"], ["with_literature_id", "Paper ID"], ["with_sequence", "Protein sequence"], ["with_smiles", "Substrate SMILES"]];
    return `<details class="stats-explanation stats-unaccepted-fields"><summary>Fields saved in records that are not accepted</summary>
      <table class="stats-detail-table"><thead><tr><th scope="col">Field</th>${cohorts.map((item) => `<th scope="col">${escapeHtml(item.label)}<small>${formatInteger(item.group.total)}</small></th>`).join("")}</tr></thead>
      <tbody>${fields.map(([key, label]) => `<tr data-field="${key}"><th scope="row">${label}</th>${cohorts.map((item) => `<td data-cohort="${item.value}" data-count="${item.group[key]}">${formatInteger(item.group[key])}<small>${escapeHtml(statsShare(item.group[key], item.group.total))}</small></td>`).join("")}</tr>`).join("")}</tbody></table>
      <p>Kinetic value: kcat, Km, Ki or kcat/Km. Paper ID: PMID or DOI. Shares are of each group. A missing field does not give the reason for a status.</p></details>`;
  }

  const STATS_METRICS = [
    { key: "kcat", html: "<i>k</i><sub>cat</sub>", unit: "s⁻¹" },
    { key: "km", html: "<i>K</i><sub>m</sub>", unit: "mM" },
    { key: "kcat_over_km", html: "<i>k</i><sub>cat</sub>/<i>K</i><sub>m</sub>", unit: "s⁻¹ mM⁻¹" },
  ];

  function statsPowerOfTen(exponent) {
    return `10${[...String(exponent)].map((character) => SUPERSCRIPT_DIGITS[character] ?? character).join("")}`;
  }

  // One metric's values on a log scale: bars per power of ten (the end bars hold everything beyond them), the median and
  // the 10–90% range beneath. Returns "" for a summary that does not hold together.
  function statsValueRange(metric, summary) {
    const counts = summary?.counts;
    const n = statsCount(summary?.n);
    const start = summary?.log10_start;
    if (!n || !Array.isArray(counts) || counts.length < 2 || !Number.isInteger(start)
      || !counts.every((count) => statsCount(count) !== null) || counts.reduce((sum, count) => sum + count, 0) !== n
      || ![summary.median, summary.p10, summary.p90].every((value) => Number.isFinite(value) && value > 0)
      || !(summary.p10 <= summary.median && summary.median <= summary.p90)) return "";
    const bins = counts.length;
    const position = (value) => Math.max(0, Math.min(100, (Math.log10(value) - start) / bins * 100));
    const highest = Math.max(...counts);
    const step = Math.ceil((bins - 1) / 5);
    const ticks = [];
    for (let edge = 1; edge < bins; edge += step) ticks.push(edge);
    const median = position(summary.median);
    const low = position(summary.p10);
    const high = position(summary.p90);
    const unit = escapeHtml(metric.unit);
    const label = `${metric.key === "kcat_over_km" ? "kcat/Km" : metric.key === "km" ? "Km" : "kcat"}: median ${numberText(summary.median)} ${metric.unit}; `
      + `10% of values are below ${numberText(summary.p10)} and 10% above ${numberText(summary.p90)}; ${formatInteger(n)} values.`;
    return `<figure class="stats-range" data-metric="${metric.key}" data-count="${n}">
      <figcaption>${metric.html} <span class="stats-range-unit">(${unit})</span></figcaption>
      <dl class="stats-range-numbers">
        <div><dt>Median</dt><dd>${numberHtml(summary.median)}</dd></div>
        <div><dt>10–90%</dt><dd>${numberHtml(summary.p10)} – ${numberHtml(summary.p90)}</dd></div>
      </dl>
      <div class="stats-histogram" role="img" aria-label="${escapeHtml(label)}">
        <div class="stats-histogram-bars">${counts.map((count, index) => `<span${count ? ' class="has-values"' : ""} style="height:${highest ? count / highest * 100 : 0}%" title="${escapeHtml(`${index === 0 ? "below " + statsPowerOfTen(start + 1) : index === bins - 1 ? statsPowerOfTen(start + index) + " and above" : `${statsPowerOfTen(start + index)} to ${statsPowerOfTen(start + index + 1)}`}: ${formatInteger(count)}`)}"></span>`).join("")}</div>
        <div class="stats-histogram-range" aria-hidden="true"><span style="left:${low}%;width:${Math.max(high - low, 0.5)}%"></span><i style="left:${median}%"></i></div>
        <div class="stats-histogram-axis" aria-hidden="true">${ticks.map((edge) => `<span style="left:${edge / bins * 100}%">10<sup>${String(start + edge).replace("-", "−")}</sup></span>`).join("")}</div>
      </div>
      <p class="stats-range-count">${formatInteger(n)} values</p>
    </figure>`;
  }

  // Records per source, counted as the Browse source filter finds them (rowSourceBits): a record merged from several
  // databases counts under each; a record that names none of them is Other. Papers holds the records read from the paper
  // by CatLog and the few earlier paper extractions.
  const statsSourceNames = [
    ["paper", "Read from papers"], ["brenda", "BRENDA"], ["oed", "Open Enzyme Database (OED)"],
    ["uniprot", "UniProt"], ["sabio_rk", "SABIO-RK"], ["skid", "SKiD"],
  ];
  const STATS_SOURCE_KEYS = { earlier_paper: "paper", strenda: "other", unrecorded: "other" };

  function statsSources(overview) {
    const counts = {};
    const given = overview?.sources;
    if (given && typeof given === "object") {
      for (const [key] of statsSourceNames) counts[key] = statsCount(given[key]) || 0;
      counts.other = statsCount(given.other) || 0;
    } else {
      for (const [label, count] of Object.entries(manifestDistribution("source_db"))) {
        const bits = rowSourceBits({ source_db: label });
        const keys = [...new Set(sourceFilters.filter((item) => bits & item.bit).map((item) => STATS_SOURCE_KEYS[item.value] || item.value))];
        for (const key of keys.length ? keys : ["other"]) counts[key] = (counts[key] || 0) + count;
      }
    }
    const v2 = statsCount(overview?.from_paper?.records, counts.paper || 0);
    const paperNote = v2 !== null && counts.paper > v2
      ? `${formatInteger(v2)} read from the paper by CatLog; ${formatInteger(counts.paper - v2)} from earlier paper extractions.`
      : "";
    return [
      ...statsSourceNames.map(([key, label]) => ({ value: `source_${key}`, label, count: counts[key] || 0, params: { source: key },
        note: key === "paper" ? paperNote : "" })),
      { value: "source_other", label: "Other", note: "Another database, or not recorded", count: counts.other || 0 },
    ].filter((item) => item.count > 0);
  }

  function renderStats() {
    // Immutable snapshot metadata: Stats never mixes filtered and full-download counts, and never loads the record index.
    const total = Number(manifest.total_rows || 0);
    const summary = manifest.summary || {};
    const counts = manifestDistribution("verification_status");
    const overview = statsOverview(total);
    const totals = summary.totals || {};
    const accepted = (counts.verified || 0) + (counts.corrected || 0);
    const identityOnly = manifestDistribution("public_trust_basis").identity_only || 0;
    const known = new Set(reviewStatuses.map((item) => item.value));
    const otherStatus = Object.entries(counts).reduce((sum, [key, count]) => sum + (known.has(key) ? 0 : count), 0);
    const notVerified = (counts.unverified || 0) + (counts.mathematically_inferred || 0) + (counts.disputed || 0) + otherStatus;

    $("statsScope").textContent = `All ${formatInteger(total)} records, before filtering.`;
    $("statsDate").textContent = manifest.generated_at ? `Snapshot ${formatDate(manifest.generated_at)}` : "Snapshot date unavailable";
    const humanChecked = statsCount(overview?.human_checked_accepted, accepted);
    const fromPaper = overview?.from_paper && statsCount(overview.from_paper.records, total);
    const main = [
      ["Records", total],
      ["Accepted", accepted],
      ["Human-checked", humanChecked],
      [SOURCE_CATLOG_LABEL, fromPaper, statsCount(overview?.from_paper?.papers) !== null ? `from ${formatInteger(overview.from_paper.papers)} papers` : ""],
    ].filter(([, value]) => value !== null && value !== undefined);
    const scope = [
      ["Papers", statsCount(overview?.papers)],
      ["Enzymes", statsCount(overview?.enzymes) ?? statsCount(totals.unique_enzymes)],
      ["EC numbers", statsCount(overview?.ec_numbers) ?? statsCount(totals.unique_ec_numbers)],
      ["Organisms", statsCount(overview?.organisms) ?? statsCount(totals.unique_organisms)],
      ["Substrates", statsCount(overview?.substrates) ?? statsCount(totals.unique_substrates)],
    ].filter(([, value]) => value !== null);
    const totalsHtml = (items, className) => `<dl class="${className}" style="--stats-columns:${items.length}">${items.map(([label, value, note]) => `<div><dt>${escapeHtml(label)}</dt><dd>${formatCount(value)}${note ? `<small>${escapeHtml(note)}</small>` : ""}</dd></div>`).join("")}</dl>`;
    $("statsTotals").innerHTML = totalsHtml(main, "stats-totals-main") + (scope.length ? totalsHtml(scope, "stats-totals-scope") : "");

    const sections = [];
    // Review status: the three groups Browse filters on, with the three kinds of other record listed under them.
    const statusItems = [
      { value: "accepted", label: "Accepted", color: "verified", count: accepted, params: { status: "accepted" },
        note: `As reported (${formatInteger(counts.verified || 0)}) or after a correction (${formatInteger(counts.corrected || 0)}).` },
      { value: "manual_review_required", label: "Checks pending", color: "pending", count: counts.manual_review_required || 0,
        params: { status: "curation_pending" }, note: "Not accepted: at least one check is still open." },
      { value: "not_verified", label: "Other records", group: true, count: notVerified, params: { status: "not_verified" },
        note: "Browse shows these together:" },
      { value: "unverified", label: "Unverified", color: "neutral", sub: true, count: counts.unverified || 0, note: "No accepted result is recorded." },
      { value: "mathematically_inferred", label: "Not reviewed", color: "calculated", sub: true, count: counts.mathematically_inferred || 0,
        note: "Prepared from source records, without an accepted review outcome." },
      { value: "disputed", label: "Disputed", color: "disputed", sub: true, count: counts.disputed || 0, note: "Flagged during review; not accepted." },
      ...(otherStatus ? [{ value: "other_status", label: "Other status", color: "neutral", sub: true, count: otherStatus, note: "Not one of the statuses above." }] : []),
    ];
    sections.push(statsSection("statsStatusTitle", "Review status", `${statsBarRows(statusItems, total)}
      ${identityOnly ? `<p class="stats-note">${formatInteger(identityOnly)} accepted records have no PMID or DOI linked, so their values cannot be checked against a paper.</p>` : ""}
      ${statsUnacceptedFields(counts)}`, { wide: true, className: "stats-status-section", note: "Each record has one status. Select a linked name to see those records in Browse." }));

    if (fromPaper !== null && fromPaper !== undefined) {
      sections.push(statsSection("statsV2Title", SOURCE_CATLOG_LABEL, `<p class="stats-figure"><strong>${formatInteger(fromPaper)}</strong> records${statsCount(overview.from_paper.papers) !== null ? ` from <strong>${formatInteger(overview.from_paper.papers)}</strong> papers` : ""}</p>
        <p>${escapeHtml(v2Sentence)}</p>
        <p><a class="stats-link" href="${escapeHtml(statsBrowseHref({ source: "paper" }))}">Browse these records</a></p>`, { className: "stats-box-section" }));
    }
    if (humanChecked !== null) {
      const marked = statsCount(overview.human_marked, total);
      sections.push(statsSection("statsHumanTitle", "Human review", `<p class="stats-figure"><strong>${formatInteger(humanChecked)}</strong> accepted records checked by a person</p>
        <p>A human reviewer approved the values these records print; their status carries the tag human-checked.${marked !== null && marked > humanChecked ? ` Reviewers left a mark or a note on ${formatInteger(marked)} records in all; the tag shows only on accepted records whose values they approved.` : ""}</p>
        <p><a class="stats-link" href="${escapeHtml(statsBrowseHref({ checked: "1" }))}">Browse these records</a></p>`, { className: "stats-box-section" }));
    }

    // What the records contain.
    const coverage = summary.coverage || {};
    const download = manifest.enriched_download?.coverage || {};
    const conditions = overview?.conditions || {};
    const contents = [
      { value: "kcat", label: "kcat", labelHtml: "<i>k</i><sub>cat</sub>", count: statsCount(coverage.with_kcat, total), params: { metric: "kcat" } },
      { value: "km", label: "Km", labelHtml: "<i>K</i><sub>m</sub>", count: statsCount(coverage.with_km, total), params: { metric: "km" } },
      { value: "kcat_over_km", label: "kcat/Km", labelHtml: "<i>k</i><sub>cat</sub>/<i>K</i><sub>m</sub>", count: statsCount(coverage.with_kcat_over_km, total), params: { metric: "kcat_over_km" } },
      { value: "sequence", label: "Protein sequence", count: statsCount(download.sequence, total) },
      { value: "smiles", label: "Substrate SMILES", count: statsCount(download.smiles, total) },
      { value: "temperature", label: "Temperature", count: statsCount(conditions.temperature, total) },
      { value: "ph", label: "pH", count: statsCount(conditions.ph, total) },
    ].filter((item) => item.count !== null);
    const calculated = statsCount(coverage.calculated_kcat_over_km, coverage.with_kcat_over_km);
    const both = statsCount(conditions.both, total);
    const sequences = [["Wild-type sequence", download.wild_type_sequence], ["Variant sequence", download.variant_sequence]]
      .filter(([, count]) => statsCount(count, total) !== null);
    if (contents.length) {
      const notes = [
        calculated ? `${formatInteger(calculated)} kcat/Km values were calculated as kcat ÷ Km (marked calc. in the table).` : "",
        both !== null ? `${formatInteger(both)} records give both temperature and pH.` : "",
      ].filter(Boolean).join(" ");
      sections.push(statsSection("statsContentsTitle", "What the records contain", `${statsBarRows(contents, total)}
        ${notes ? `<p class="stats-note">${notes}</p>` : ""}
        ${sequences.length ? `<details class="stats-explanation"><summary>Sequence fields</summary><table class="stats-detail-table"><tbody>
          ${sequences.map(([label, count]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${formatInteger(count)}</td><td>${escapeHtml(statsShare(count, total))}</td></tr>`).join("")}
        </tbody></table><p>These overlap: a variant record can have both a wild-type and a variant sequence.</p></details>` : ""}`,
      { note: "Records with each value or field; a record usually has several." }));
    }

    // Enzyme classes.
    const classes = Array.isArray(overview?.ec_classes) ? overview.ec_classes.filter((item) => Number.isInteger(item?.class)
      && statsCount(item.count, total) !== null && statsCount(item.accepted, item.count) !== null) : [];
    if (classes.length) {
      const none = statsCount(overview.ec_class_none, total);
      const multiple = statsCount(overview.ec_class_multiple, total);
      const items = classes.map((item) => ({ value: `ec_${item.class}`, label: `EC ${item.class} ${item.name || ""}`.trim(),
        labelHtml: `EC ${item.class}<span class="stats-ec-name"> ${escapeHtml(item.name || "")}</span>`, count: item.count, accepted: item.accepted, params: { ec: `${item.class}.` } }));
      const notes = [
        multiple ? `${formatInteger(multiple)} records name EC numbers in more than one class and count in each.` : "",
        none ? `${formatInteger(none)} records have no EC class.` : "",
      ].filter(Boolean).join(" ");
      sections.push(statsSection("statsClassesTitle", "Enzyme classes", `${statsBarRows(items, total, { extra: { key: "accepted", label: "accepted" }, head: ["Records", "Accepted"] })}
        ${notes ? `<p class="stats-note">${notes}</p>` : ""}`));
    }

    // Most common organisms and EC numbers.
    const topItems = (list, toItem) => (Array.isArray(list) ? list : []).filter((item) => statsCount(item?.count, total) !== null).map(toItem);
    const organisms = topItems(overview?.top_organisms, (item, index) => ({ value: `organism_${index}`, label: String(item.name || ""),
      labelHtml: `<i>${escapeHtml(item.name || "")}</i>`, count: item.count, params: { organism: String(item.name || "") } }));
    const ecNumbers = topItems(overview?.top_ec, (item) => ({ value: `ec_${item.ec}`, label: `${item.ec} ${item.name || ""}`.trim(),
      labelHtml: `<span class="stats-ec-number">${escapeHtml(item.ec)}</span> ${escapeHtml(item.name || "")}`, count: item.count, params: { ec: String(item.ec || "") } }));
    if (organisms.length) {
      sections.push(statsSection("statsOrganismsTitle", "Most common organisms", statsBarRows(organisms, total, { scale: organisms[0].count }),
        { note: "Records whose organism name contains this name, as Browse finds them, so strains count with their species." }));
    }
    if (ecNumbers.length) {
      sections.push(statsSection("statsEcTitle", "Most common EC numbers", statsBarRows(ecNumbers, total, { scale: ecNumbers[0].count }),
        { note: "Each with the enzyme name its records use most." }));
    }

    // Value ranges.
    const ranges = STATS_METRICS.map((metric) => statsValueRange(metric, overview?.metrics?.[metric.key])).filter(Boolean);
    if (ranges.length) {
      sections.push(statsSection("statsRangesTitle", "Value ranges", `<div class="stats-ranges">${ranges.join("")}</div>`, { wide: true,
        note: "Catalog units on a log scale; the end bars include all values beyond them. Dot: median; line: middle 80% of values. Values without a recorded unit, or in a unit other than the catalog's, are left out." }));
    }

    // Wild type and variants.
    const form = overview?.enzyme_form || {};
    const forms = [
      { value: "wild", label: "Wild type", count: statsCount(form.wild, total), params: { variant: "wild" } },
      { value: "variant", label: "Variant", count: statsCount(form.variant, total), params: { variant: "variant" }, note: "A mutation is named, or the source marks the enzyme as not wild type." },
      { value: "not_stated", label: "Not stated", count: statsCount(form.not_stated, total) },
    ];
    // The last four sections stand two to a column (each column one grid item), so a short section leaves no gap
    // beside a taller one.
    const stack = (...items) => {
      const present = items.filter(Boolean);
      return present.length > 1 ? `<div class="stats-stack">${present.join("")}</div>` : present.join("");
    };
    const formSection = forms.every((item) => item.count !== null) && forms.reduce((sum, item) => sum + item.count, 0) === total
      ? statsSection("statsFormTitle", "Wild type and variants", statsBarRows(forms, total))
      : "";

    // Cautions.
    const caution = overview?.cautions || {};
    const cautions = [
      // The same names as the Cautions filter.
      ...cautionFilters.map((item) => ({ value: `caution_${item.value}`, label: item.label, labelHtml: item.labelHtml,
        count: statsCount(caution[item.value], total), params: { caution: item.value } })),
    ];
    sections.push(stack(formSection, cautions.every((item) => item.count !== null)
      ? statsSection("statsCautionsTitle", "Cautions", statsBarRows(cautions, total),
        { note: "A caution marks a value to check against the source; a record can carry more than one." })
      : ""));

    // Main source.
    const sources = statsSources(overview);
    const sourceSection = statsSection("statsSourcesTitle", "Main source", sources.length ? statsBarRows(sources, total) : "<p>Source breakdown unavailable in this snapshot.</p>",
      { note: "A record merged from several databases counts under each of them, so the counts can add up to more than all records. Select a name to see those records in Browse." });

    if (!overview) {
      sections.push(sourceSection);
    } else {
      sections.push(stack(sourceSection, `<details class="stats-explanation stats-method"><summary>How these numbers are counted</summary><dl>
        <div><dt>Papers</dt><dd>Distinct PMIDs; a record without a PMID counts by its DOI.</dd></div>
        <div><dt>Names</dt><dd>Enzymes, organisms and substrates are distinct names, ignoring capitals; "Unknown" is not a name. EC numbers are complete four-part numbers.</dd></div>
        <div><dt>Human-checked</dt><dd>Accepted records a human reviewer checked, as the status tag shows.</dd></div>
        <div><dt>Source</dt><dd>All numbers come from the Full data download of this snapshot; Human-checked also uses the human-review marks published with it.</dd></div>
      </dl></details>`));
    }
    $("statsCharts").innerHTML = sections.join("");
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
    const suggestions = searchExamples[kind] || [];
    if (!suggestions.length) return;
    positionSuggestions(input, box);
    box.innerHTML = `<span class="suggestion-title" aria-hidden="true">Try:</span>${suggestions.map((value, index) => (
      `${index ? '<span class="suggestion-sep" aria-hidden="true">·</span>' : ""}<button id="catlog-suggestion-${index}" type="button" role="option" aria-selected="false" data-value="${escapeHtml(value)}">${escapePublic(value)}</button>`
    )).join("")}`;
    box.classList.remove("hidden");
    state.suggestionIndex = -1;
    state.suggestionInputId = input.id;
    input.setAttribute("aria-controls", "searchSuggestions");
    input.setAttribute("aria-expanded", "true");
    [...box.querySelectorAll("button[data-value]")].forEach((button) => {
      button.addEventListener("click", () => chooseSuggestion(input, button.dataset.value));
    });
  }

  // Human-checked (isHumanChecked, beside statusBadge): the marks arrive after the index; until then the count waits.
  function humanReviewMarksArrived() {
    state.humanMarksLoaded = true;
    state.humanMarksVersion += 1;
    updateFilterCounts();
    if ($("humanCheckedFilter")?.checked && state.records.length) applyFiltersInBackground({ resetPage: false });
  }

  function rowVariantBits(row) {
    if (row._variantBits == null) {
      const label = enzymeFormLabel(row);
      row._variantBits = label === "Wild type" ? 1 : label.startsWith("Variant") ? 2 : 0;
    }
    return row._variantBits;
  }

  // The caution groups of a record's flags (as the table shows them), or "No caution" when it has none.
  function rowCautionBits(row) {
    if (row._cautionBits == null) {
      const flags = conditionFlags(row);
      let bits = 0;
      flags.forEach((flag) => {
        bits |= CAUTION_FLAG_BITS[flag]
          || (flag.startsWith("unit_not_recorded") ? 4 : 0)
          || (flag.startsWith("temperature_") ? 8 : 0);
      });
      row._cautionBits = flags.size ? bits : 16;
    }
    return row._cautionBits;
  }

  const sourceBitsByValue = new Map();

  // The databases a record comes from, as "By database" bits; 0 for a record read from the paper by CatLog. A source_db
  // that names none of them ("unknown", "mixed", empty) is "Source not recorded".
  function rowSourceBits(row) {
    if (isV2Row(row)) return 0;
    const value = String(row.source_db || "");
    let bits = sourceBitsByValue.get(value);
    if (bits === undefined) {
      bits = 0;
      value.toLowerCase().split(/[;,+/|]+/).forEach((part) => {
        const key = SOURCE_TOKENS[part.trim().replace(/[\s-]+/g, "_")];
        if (key) bits |= sourceFilters.find((item) => item.value === key).bit;
      });
      sourceBitsByValue.set(value, bits || SOURCE_UNRECORDED_BIT);
      bits = bits || SOURCE_UNRECORDED_BIT;
    }
    return bits;
  }

  // The status cell's second line names the source: "from paper" for CatLog's own records, otherwise the databases
  // (BRENDA, SABIO-RK, OED, ...), "earlier extraction" or "source not recorded".
  const sourceTagByBits = new Map();

  function sourceTagText(row) {
    if (isV2Row(row)) return "from paper";
    const bits = rowSourceBits(row);
    let text = sourceTagByBits.get(bits);
    if (text === undefined) {
      text = sourceFilters.filter((item) => bits & item.bit).map((item) => item.tag).join(", ");
      sourceTagByBits.set(bits, text);
    }
    return text;
  }

  // Counts beside the filters follow the current results: each option is counted over the records that match every
  // other filter, its own group's set aside (ticking it would show that many, or add that many). One pass over the
  // records, in idle moments and in slices, so typing never waits for it; a newer change restarts it.
  function emptyFacetCounts() {
    return {
      temperature: 0, ph: 0, checked: 0,
      state: Object.fromEntries(recordStates.map((item) => [item.value, 0])),
      metric: Object.fromEntries(measurementFilters.map((item) => [item.value, 0])),
      variant: { wild: 0, variant: 0, none: 0 },
      caution: Object.fromEntries(cautionFilters.map((item) => [item.value, 0])),
      source: Object.fromEntries([...sourceModes, ...sourceFilters].map((item) => [item.value, 0])),
    };
  }

  // Adds a record to the counts of one group (or of every group).
  function addFacetCounts(counts, row, group) {
    const every = group === undefined;
    if (every || group === "state") counts.state[row._recordState || recordStateForRow(row)] += 1;
    if ((every || group === "checked") && isHumanChecked(row)) counts.checked += 1;
    if (every || group === "metric") {
      measurementFilters.forEach((item) => {
        if (row[item.field] != null) counts.metric[item.value] += 1;
      });
    }
    if (every || group === "variant") {
      const variant = rowVariantBits(row);
      counts.variant[variant === 1 ? "wild" : variant === 2 ? "variant" : "none"] += 1;
    }
    if ((every || group === "temperature") && (row._sortTemperature ?? temperatureValue(row)) != null) counts.temperature += 1;
    if ((every || group === "ph") && (row._sortPh ?? phValue(row)) != null) counts.ph += 1;
    if (every || group === "caution") {
      const caution = rowCautionBits(row);
      cautionFilters.forEach((item) => {
        if (caution & item.bit) counts.caution[item.value] += 1;
      });
    }
    if (every || group === "source") {
      counts.source.all += 1;
      counts.source[isV2Row(row) ? "paper" : "databases"] += 1;
      const source = rowSourceBits(row);
      if (source) {
        sourceFilters.forEach((item) => {
          if (source & item.bit) counts.source[item.value] += 1;
        });
      }
    }
  }

  // The counts of the given filters over every loaded record: { counts } once done, or null when a newer pass took over.
  const facetCountJob = { key: "", counts: null, run: 0, pendingKey: "", waiting: [] };

  function facetCountKey(controls) {
    const { sort: _sort, ...filters } = controls;
    return `${state.recordsGeneration}:${state.humanMarksVersion}:${JSON.stringify(filters)}`;
  }

  function scheduleIdle(callback) {
    return typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback(callback, { timeout: 600 })
      : window.setTimeout(() => callback(null), 16);
  }

  function countFacets(controls, onDone) {
    const key = facetCountKey(controls);
    if (facetCountJob.key === key && facetCountJob.counts) {
      onDone(facetCountJob.counts);
      return;
    }
    if (facetCountJob.pendingKey === key) {
      facetCountJob.waiting.push(onDone);
      return;
    }
    const run = ++facetCountJob.run;
    facetCountJob.pendingKey = key;
    facetCountJob.waiting = [onDone];
    const filters = currentFilters(controls);
    const records = state.records;
    const counts = emptyFacetCounts();
    let index = 0;
    const step = (deadline) => {
      if (run !== facetCountJob.run) return;
      // A slice of records per idle moment (more when the browser says it has time to spare).
      let budget = deadline ? 2000 : 6000;
      while (index < records.length) {
        const end = Math.min(records.length, index + budget);
        for (; index < end; index += 1) {
          const row = records[index];
          const failed = rowFacetFailures(row, filters);
          if (failed === null) continue;
          if (!failed.length) addFacetCounts(counts, row);
          else if (failed.length === 1) addFacetCounts(counts, row, failed[0]);
        }
        if (!deadline || deadline.didTimeout || deadline.timeRemaining() < 4) break;
        budget = 2000;
      }
      if (index < records.length) {
        scheduleIdle(step);
        return;
      }
      facetCountJob.key = key;
      facetCountJob.counts = counts;
      facetCountJob.pendingKey = "";
      const waiting = facetCountJob.waiting;
      facetCountJob.waiting = [];
      waiting.forEach((callback) => callback(counts));
    };
    scheduleIdle(step);
  }

  function checkRowHtml({ name, value, label, labelHtml, title = "", checked = false, count, className = "", id = "" }) {
    return `
      <label class="check-row${className ? ` ${className}` : ""}"${title ? ` title="${escapeHtml(title)}"` : ""}>
        <input${id ? ` id="${id}"` : ""} type="checkbox" name="${name}" value="${escapeHtml(value)}"${checked ? " checked" : ""} />
        <span>${labelHtml || escapeHtml(label)}</span>
        <strong data-count="${escapeHtml(count)}">${EMPTY_VALUE}</strong>
      </label>`;
  }

  // The checklists are built once (so a ticked box keeps its focus); their counts follow the loaded records.
  let filterChecklistsBuilt = false;

  function setupFilters() {
    if (!filterChecklistsBuilt) {
      filterChecklistsBuilt = true;
      // Review result: the four results, "Only human-checked" nested under Accepted, then their definitions and the
      // tags' (the method in one line, with the Guide's full account a link away).
      $("statusChecklist").innerHTML = recordStates.map((item) => checkRowHtml({
        name: "recordState", value: item.value, label: item.label, title: stateDescriptions[item.value],
        checked: true, count: `state:${item.value}`, className: item.className,
      }) + (item.value === "accepted" ? checkRowHtml({
        name: "humanChecked", value: "1", id: "humanCheckedFilter", labelHtml: `Only <span class="human-checked-word">${CHECK_ICON_HTML}human-checked</span>`,
        label: "Only human-checked", title: HUMAN_CHECKED_DESCRIPTION, count: "checked", className: "human-checked nested",
      }) : "")).join("") + `
      <details class="status-guide">
        <summary>Status definitions</summary>
        <div class="status-guide-body">
          ${recordStates.map((item) => `<p><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(stateDescriptions[item.value])}</p>`).join("")}
          <p><strong>human-checked:</strong> ${escapeHtml(HUMAN_CHECKED_DESCRIPTION)} Shown on accepted records only.</p>
          <p><strong>from paper:</strong> ${escapeHtml(v2Sentence)} <a href="#guide-method">How CatLog reads papers&nbsp;&rarr;</a></p>
          <p><strong>corrected:</strong> Accepted by the earlier automated review after a correction.</p>
          <p><strong>no paper linked:</strong> ${escapeHtml(identityOnlyTrustNote)}</p>
        </div>
      </details>
    `;
      $("measurementChecklist").innerHTML = measurementFilters.map((item) => checkRowHtml({
        name: "measurement", value: item.value, labelHtml: item.labelHtml, count: `metric:${item.value}`,
      })).join("") + `<p class="filter-note">Ticking more than one shows records with all of them.</p>`;
      if ($("variantChecklist")) {
        $("variantChecklist").innerHTML = variantFilters.map((item) => checkRowHtml({
          name: "variant", value: item.value, label: item.label, count: `variant:${item.value}`,
        })).join("") + `<p class="filter-note"><span data-count="variant:none">${EMPTY_VALUE}</span> records do not state wild type or variant.</p>`;
      }
      if ($("cautionChecklist")) {
        $("cautionChecklist").innerHTML = cautionFilters.map((item) => checkRowHtml({
          name: "caution", value: item.value, label: item.label, labelHtml: item.labelHtml, title: item.title,
          count: `caution:${item.value}`,
        })).join("");
      }
      if ($("sourceChecklist")) {
        $("sourceChecklist").innerHTML = `<div class="source-modes" role="radiogroup" aria-label="Source">${sourceModes.map((item) => `
          <label class="check-row radio-row">
            <input type="radio" name="sourceMode" value="${item.value}"${item.value === "all" ? " checked" : ""}${item.help ? ` aria-describedby="sourceHelp-${item.value}"` : ""} />
            <span>${escapeHtml(item.label)}</span>
            <strong data-count="source:${item.value}">${EMPTY_VALUE}</strong>
          </label>${item.help ? `
          <p class="filter-note source-help" id="sourceHelp-${item.value}">${escapeHtml(item.help)}${item.guide ? ` <a href="#guide-method">How CatLog reads papers&nbsp;&rarr;</a>` : ""}</p>` : ""}`).join("")}
        </div>
        <details class="source-databases" id="sourceDatabases">
          <summary>By database</summary>
          <div class="check-stack">${sourceFilters.map((item) => checkRowHtml({
            name: "source", value: item.value, label: item.label, title: item.title || "", count: `source:${item.value}`,
          })).join("")}
            <p class="filter-note">A merged record counts under each database it came from.</p>
          </div>
        </details>`;
      }
    }
    updateFilterCounts();
    if (searchWarmup.wanted && state.recordsReady) warmSearchText();
  }

  // A count's text: from the snapshot's counts before the records load (review results, measurement types), then from the
  // counts of the current results; Only human-checked waits for the review marks.
  function filterCountValue(key, counts) {
    const coverage = (manifest.summary || {}).coverage || {};
    const [group, value] = String(key).split(":");
    if (!state.recordsReady) {
      if (group === "metric") return { kcat: coverage.with_kcat, km: coverage.with_km, kcat_over_km: coverage.with_kcat_over_km }[value] ?? null;
      if (group === "state") return recordStateCounts([])[value] ?? null;
      if (group === "source" && value === "all") return Number(manifest.total_rows || 0) || null;
      return null;
    }
    if (!counts || (group === "checked" && !state.humanMarksLoaded)) return null;
    if (group === "range") return counts[value] || 0;
    if (value === undefined) return counts[group] || 0;
    return counts[group]?.[value] || 0;
  }

  // Draws the counts: an option at 0 is greyed (it stays clickable). While newer counts are worked out the panel is
  // marked busy (data-counts="pending"; the numbers fade if that takes a moment).
  function drawFilterCounts(counts) {
    const rail = $("catalogFilters");
    if (rail?.dataset) delete rail.dataset.counts;
    rail?.removeAttribute?.("aria-busy");
    document.querySelectorAll?.("#catalogFilters [data-count]").forEach((element) => {
      const count = filterCountValue(element.dataset.count, counts);
      element.textContent = formatCount(count);
      element.closest?.(".check-row, .range-row")?.classList.toggle("is-zero", count === 0);
    });
  }

  // The counts follow every change of the records, the marks or the filters; they are worked out in idle moments.
  function updateFilterCounts() {
    if (!state.recordsReady) {
      drawFilterCounts(null);
      return;
    }
    const controls = filterControlState();
    if (facetCountJob.key !== facetCountKey(controls)) {
      const rail = $("catalogFilters");
      if (rail?.dataset) rail.dataset.counts = "pending";
      rail?.setAttribute?.("aria-busy", "true");
    }
    countFacets(controls, drawFilterCounts);
  }

  function selectedCheckboxes(name) {
    return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((item) => item.value);
  }

  // The filter controls as typed and ticked (text trimmed, not folded). The address and the filter chips are written
  // from this; currentFilters() prepares it for matching.
  function filterControlState() {
    const text = (id) => String($(id)?.value ?? "").trim();
    // Before the checklists are built every review status counts as ticked.
    const statesBuilt = (document.querySelectorAll?.('input[name="recordState"]') || []).length > 0;
    return {
      q: text("globalSearchInput"),
      states: statesBuilt ? selectedCheckboxes("recordState") : recordStates.map((item) => item.value),
      checked: Boolean($("humanCheckedFilter")?.checked),
      ec: text("ecFilterInput"),
      enzyme: text("enzymeFilterInput"),
      organism: text("organismFilterInput"),
      substrate: text("substrateFilterInput"),
      metrics: selectedCheckboxes("measurement"),
      variants: selectedCheckboxes("variant"),
      tmin: text("temperatureMinInput"),
      tmax: text("temperatureMaxInput"),
      phmin: text("phMinInput"),
      phmax: text("phMaxInput"),
      cautions: selectedCheckboxes("caution"),
      ...sourceControlState(),
      sort: $("sortSelect")?.value || "evidence",
    };
  }

  // Source: one of All records, Read from the paper by CatLog or From enzyme databases; databases ticked under "By
  // database" narrow the last (and select it).
  function sourceControlState() {
    const sources = selectedCheckboxes("source");
    const mode = selectedCheckboxes("sourceMode")[0];
    return { sourceMode: sources.length ? "databases" : (["paper", "databases"].includes(mode) ? mode : "all"), sources };
  }

  function setSourceControls(mode, sources = []) {
    const databases = sources.filter((value) => sourceFilters.some((item) => item.value === value));
    const nextMode = databases.length ? "databases" : (["paper", "databases"].includes(mode) ? mode : "all");
    document.querySelectorAll?.('input[name="sourceMode"]').forEach((input) => {
      input.checked = input.value === nextMode;
    });
    setCheckboxes("source", databases);
    if (databases.length && $("sourceDatabases")) $("sourceDatabases").open = true;
  }

  // A typed bound: "25", "25.5", "25,5" or "-4"; null when empty, NaN when it is not a number.
  function parseFilterNumber(text) {
    const value = String(text ?? "").trim().replace(/\s+/g, "").replace(/[\u2212\u2013]/g, "-").replace(",", ".")
      .replace(/(°c|°|c)$/i, "");
    if (!value) return null;
    return /^-?(\d+\.?\d*|\.\d+)$/.test(value) ? Number(value) : Number.NaN;
  }

  // A range from two typed bounds (either may be empty), low to high whichever way they were typed; null when neither
  // is a number.
  function numberRange(minText, maxText) {
    let min = parseFilterNumber(minText);
    let max = parseFilterNumber(maxText);
    if (!Number.isFinite(min)) min = null;
    if (!Number.isFinite(max)) max = null;
    if (min == null && max == null) return null;
    if (min != null && max != null && min > max) [min, max] = [max, min];
    return { min, max };
  }

  function inRange(value, range) {
    if (value == null || !Number.isFinite(value)) return false;
    return (range.min == null || value >= range.min - 1e-9) && (range.max == null || value <= range.max + 1e-9);
  }

  function bitsFor(items, values) {
    return items.reduce((bits, item) => bits | (values.includes(item.value) ? item.bit : 0), 0);
  }

  function currentFilters(controls = filterControlState()) {
    const q = foldSearch(controls.q);
    return {
      q,
      qWords: searchWords(q),
      ec: foldSearch(controls.ec),
      ecQueries: ecFilterQueries(controls.ec),
      enzyme: foldSearch(controls.enzyme),
      enzymeWords: fieldWords(controls.enzyme),
      organism: foldSearch(controls.organism),
      organismWords: fieldWords(controls.organism),
      substrate: foldSearch(controls.substrate),
      substrateWords: fieldWords(controls.substrate),
      recordStates: controls.states,
      sourceMode: controls.sourceMode,
      humanChecked: controls.checked,
      metrics: controls.metrics,
      variantBits: bitsFor(variantFilters, controls.variants),
      temperature: numberRange(controls.tmin, controls.tmax),
      ph: numberRange(controls.phmin, controls.phmax),
      cautionBits: bitsFor(cautionFilters, controls.cautions),
      sourceBits: bitsFor(sourceFilters, controls.sources),
      sort: controls.sort,
    };
  }

  // Browse with filters has the address #browse?key=value&... (keys: q, status, checked, ec, enzyme, organism, substrate,
  // metric, variant, tmin, tmax, phmin, phmax, caution, source, sort, rows, page, record; lists are comma separated;
  // unknown keys are ignored). It is read when the page opens and on Back
  // and Forward, and rewritten in place (never added to history) whenever the filters, search, sort, page size or page
  // change, so a copied address opens the same records. Browse without filters has no hash. While a record is open the
  // address names it after the filters (recordHash); closing it gives the address back to the filters.
  const BROWSE_HASH = /^#browse(?:\?(.*))?$/;
  const PAGE_SIZES = [25, 50, 100];
  const PAGE_SIZE_STORAGE_KEY = "catlog-rows-per-page";

  function decodeBrowseText(value) {
    try {
      return decodeURIComponent(String(value).replace(/\+/g, " "));
    } catch (_error) {
      return "";
    }
  }

  function parseBrowseParams(text) {
    const params = new Map();
    String(text || "").split("&").forEach((part) => {
      const at = part.indexOf("=");
      const key = decodeBrowseText(at < 0 ? part : part.slice(0, at)).trim().toLowerCase();
      if (key) params.set(key, decodeBrowseText(at < 0 ? "" : part.slice(at + 1)));
    });
    return params;
  }

  // The filters the address names: a Map (empty for plain Browse), or null when the address is not about filters
  // (another view, or an open record).
  function browseParamsFromLocation() {
    if (viewFromLocation() !== "browse") return null;
    const hash = window.location.hash || "";
    if (!hash || hash === "#") return new Map();
    const match = hash.match(BROWSE_HASH);
    return match ? parseBrowseParams(match[1]) : null;
  }

  function listParam(value, aliases = {}) {
    return String(value ?? "").split(/[,|]/)
      .map((item) => item.trim().toLowerCase().replace(/[\s-]+/g, "_"))
      .filter(Boolean)
      .map((item) => aliases[item] || item);
  }

  const METRIC_ALIASES = { "kcat/km": "kcat_over_km", kcatkm: "kcat_over_km", kcat_km: "kcat_over_km", efficiency: "kcat_over_km" };
  const VARIANT_ALIASES = { wild_type: "wild", wildtype: "wild", wt: "wild", mutant: "variant", variants: "variant" };
  const CAUTION_ALIASES = {
    differ: "differs", kcat_over_km_quotient_mismatch: "differs", unit: "units", magnitude: "units",
    unit_not_recorded: "unit_missing", no_unit: "unit_missing", temp: "temperature", no_caution: "none",
  };
  const SOURCE_ALIASES = {
    primary_paper_direct: "paper", primary_literature: "paper", v2: "paper", catlog: "paper", database: "databases",
    db: "databases", sabio: "sabio_rk", sabiork: "sabio_rk", open_enzyme_database: "oed", earlier: "earlier_paper",
    unknown: "unrecorded", not_recorded: "unrecorded", none: "unrecorded",
  };

  function encodeBrowseValue(value) {
    return encodeURIComponent(value)
      .replace(/%20/g, "+")
      .replace(/%2C/gi, ",")
      .replace(/%3A/gi, ":")
      .replace(/%2F/gi, "/");
  }

  // The current controls as address keys, in a fixed order.
  function browseParamsFromControls(controls = filterControlState()) {
    const params = [];
    const add = (key, value) => {
      if (value !== "" && value != null) params.push([key, String(value)]);
    };
    add("q", controls.q);
    const allStates = controls.states.length === recordStates.length;
    if (!controls.states.length) params.push(["status", ""]);
    else if (!allStates) add("status", controls.states.join(","));
    if (controls.checked) add("checked", "1");
    add("ec", controls.ec);
    add("enzyme", controls.enzyme);
    add("organism", controls.organism);
    add("substrate", controls.substrate);
    add("metric", controls.metrics.join(","));
    add("variant", controls.variants.join(","));
    const bound = (text) => {
      const value = parseFilterNumber(text);
      return Number.isFinite(value) ? String(value) : "";
    };
    add("tmin", bound(controls.tmin));
    add("tmax", bound(controls.tmax));
    add("phmin", bound(controls.phmin));
    add("phmax", bound(controls.phmax));
    add("caution", controls.cautions.join(","));
    add("source", controls.sources.length ? controls.sources.join(",") : (controls.sourceMode === "all" ? "" : controls.sourceMode));
    if (controls.sort && controls.sort !== "evidence") add("sort", controls.sort);
    if (state.pageSize !== PAGE_SIZES[0]) add("rows", state.pageSize);
    const page = state.pendingPage || state.page;
    if (page > 1) add("page", page);
    return params;
  }

  function browseHash(params = browseParamsFromControls()) {
    return params.length ? `#browse?${params.map(([key, value]) => `${key}=${encodeBrowseValue(value)}`).join("&")}` : "";
  }

  function setCheckboxes(name, values) {
    document.querySelectorAll?.(`input[name="${name}"]`).forEach((input) => {
      input.checked = values.includes(input.value);
    });
  }

  const RANGE_INPUT_IDS = ["temperatureMinInput", "temperatureMaxInput", "phMinInput", "phMaxInput"];

  // A bound that is not a number is marked (and left out of the filter).
  function syncRangeValidity() {
    RANGE_INPUT_IDS.forEach((id) => {
      const input = $(id);
      if (!input) return;
      if (Number.isNaN(parseFilterNumber(input.value))) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    });
  }

  // A section a filter is set in opens, so nothing active is hidden in a closed section.
  function openActiveFilterSections() {
    document.querySelectorAll?.("#catalogFilters .filter-section").forEach((section) => {
      const active = [...section.querySelectorAll("input")].some((input) => {
        if (input.type === "radio") return input.checked && input.value !== "all";
        return input.type === "checkbox" ? input.checked && input.name !== "recordState" : Boolean(String(input.value || "").trim());
      });
      if (!active || section.classList.contains("open")) return;
      section.classList.add("open");
      section.querySelector(".filter-section-title")?.setAttribute("aria-expanded", "true");
    });
  }

  // Sets every control from an address (keys it leaves out are cleared); the caller applies the filters.
  function applyBrowseParams(params) {
    const setText = (id, value) => {
      const input = $(id);
      if (input) input.value = String(value ?? "").trim();
    };
    setText("globalSearchInput", params.get("q"));
    const status = params.has("status") ? listParam(params.get("status")) : [];
    const states = status.filter((value) => recordStates.some((item) => item.value === value));
    const noStates = params.has("status") && !String(params.get("status")).trim();
    document.querySelectorAll?.('input[name="recordState"]').forEach((input) => {
      input.checked = !noStates && (!states.length || states.includes(input.value));
    });

    if ($("humanCheckedFilter")) {
      $("humanCheckedFilter").checked = ["1", "true", "yes", "on"].includes(String(params.get("checked") ?? "").trim().toLowerCase());
    }
    setText("ecFilterInput", params.get("ec"));
    setText("enzymeFilterInput", params.get("enzyme"));
    setText("organismFilterInput", params.get("organism"));
    setText("substrateFilterInput", params.get("substrate"));
    setCheckboxes("measurement", listParam(params.get("metric"), METRIC_ALIASES));
    setCheckboxes("variant", listParam(params.get("variant"), VARIANT_ALIASES));
    setText("temperatureMinInput", params.get("tmin"));
    setText("temperatureMaxInput", params.get("tmax"));
    setText("phMinInput", params.get("phmin"));
    setText("phMaxInput", params.get("phmax"));
    syncRangeValidity();
    setCheckboxes("caution", listParam(params.get("caution"), CAUTION_ALIASES));
    // source=paper (or the older status=v2) is Read from the paper by CatLog; source=databases, or databases by name, the
    // enzyme databases.
    const sources = listParam(params.get("source"), SOURCE_ALIASES);
    const databases = sources.filter((value) => sourceFilters.some((item) => item.value === value));
    setSourceControls(databases.length || sources.includes("databases") ? "databases" : (sources.includes("paper") || status.includes("v2") ? "paper" : "all"), databases);
    openActiveFilterSections();
    if ($("sortSelect")) {
      $("sortSelect").value = normalizedSortName(String(params.get("sort") || "evidence").trim().toLowerCase());
      syncSortHeaders();
    }
    const rows = Number(params.get("rows"));
    if (PAGE_SIZES.includes(rows)) setPageSize(rows);
    const page = Number(params.get("page"));
    state.pendingPage = Number.isInteger(page) && page > 1 ? page : 0;
  }

  // Back, Forward or an edited address: the controls follow the address, and the records follow when it changed them.
  function applyLocationFilters() {
    const params = browseParamsFromLocation();
    if (!params) return false;
    const before = browseHash();
    applyBrowseParams(params);
    if (browseHash() === before) return false;
    if (state.records.length) applyFiltersInBackground({ resetPage: !state.pendingPage });
    return true;
  }

  // Writes the current filters into the address, replacing the current history entry.
  function syncBrowseUrl() {
    if (!window.history?.replaceState || viewFromLocation() !== "browse") return;
    // A record the address names waits for the index; until it opens, the address keeps it.
    if (state.pendingRecordKey || (!state.selectedKey && recordKeyFromLocation())) return;
    const url = viewUrl("browse");
    url.hash = state.selectedKey ? recordHash(state.selectedKey) : browseHash();
    if (url.href === window.location.href) return;
    try {
      window.history.replaceState(window.history.state, "", url);
    } catch (_error) {
      // A page opened from a file may not allow it; the filters still apply.
    }
  }

  // Rows per page: the address's rows= first, else the viewer's last choice (kept in this browser only).
  function setPageSize(value) {
    const size = PAGE_SIZES.includes(Number(value)) ? Number(value) : PAGE_SIZES[0];
    state.pageSize = size;
    if ($("pageSizeSelect")) $("pageSizeSelect").value = String(size);
  }

  function rememberPageSize(size) {
    try {
      window.localStorage?.setItem(PAGE_SIZE_STORAGE_KEY, String(size));
    } catch (_error) {
      // Storage can be blocked (private windows, previews); the page size still applies.
    }
  }

  function restorePageSize() {
    try {
      const saved = Number(window.localStorage?.getItem(PAGE_SIZE_STORAGE_KEY));
      if (PAGE_SIZES.includes(saved)) setPageSize(saved);
    } catch (_error) {
      // Nothing remembered.
    }
  }

  function rangeLabel(name, range, unit = "") {
    if (range.min != null && range.max != null) {
      return range.min === range.max ? `${name} ${range.min}${unit}` : `${name} ${range.min}–${range.max}${unit}`;
    }
    return range.min != null ? `${name} ≥ ${range.min}${unit}` : `${name} ≤ ${range.max}${unit}`;
  }

  function uncheck(name, value) {
    document.querySelectorAll?.(`input[name="${name}"]`).forEach((input) => {
      if (input.value === value) input.checked = false;
    });
  }

  function clearInputs(...ids) {
    ids.forEach((id) => {
      if ($(id)) $(id).value = "";
    });
    syncRangeValidity();
  }

  // Every active filter and the search, in panel order, each with a way to remove it (the chips above the table, the
  // count beside Filters and the empty-results note).
  function activeFilterItems(controls = filterControlState()) {
    const items = [];
    const add = (key, label, clear, labelHtml = "") => items.push({ key, label, labelHtml: labelHtml || escapeHtml(label), clear });
    if (controls.q) add("q", `Search: ${controls.q}`, () => clearInputs("globalSearchInput"));
    if (controls.states.length !== recordStates.length) {
      const names = controls.states.map((value) => stateConfig(value).label);
      add("status", `Status: ${names.length ? names.join(", ") : "none"}`, () => setCheckboxes("recordState", recordStates.map((item) => item.value)));
    }
    if (controls.sourceMode !== "all" && !controls.sources.length) {
      add(`source:${controls.sourceMode}`, `Source: ${controls.sourceMode === "paper" ? "read from the paper by CatLog" : "from enzyme databases"}`,
        () => setSourceControls("all"));
    }
    if (controls.checked) add("checked", "Only human-checked", () => uncheck("humanChecked", "1"));
    if (ecFilterQueries(controls.ec).length) add("ec", `EC ${controls.ec.replace(/^e\.?c\.?[\s:]*/i, "")}`, () => clearInputs("ecFilterInput"));
    if (controls.enzyme) add("enzyme", `Enzyme: ${controls.enzyme}`, () => clearInputs("enzymeFilterInput"));
    if (controls.organism) add("organism", `Organism: ${controls.organism}`, () => clearInputs("organismFilterInput"));
    if (controls.substrate) add("substrate", `Substrate: ${controls.substrate}`, () => clearInputs("substrateFilterInput"));
    measurementFilters.filter((item) => controls.metrics.includes(item.value)).forEach((item) => {
      add(`metric:${item.value}`, item.label, () => uncheck("measurement", item.value), item.labelHtml);
    });
    variantFilters.filter((item) => controls.variants.includes(item.value)).forEach((item) => {
      add(`variant:${item.value}`, item.label, () => uncheck("variant", item.value));
    });
    const temperature = numberRange(controls.tmin, controls.tmax);
    if (temperature) add("temperature", rangeLabel("T", temperature, " °C"), () => clearInputs("temperatureMinInput", "temperatureMaxInput"));
    const ph = numberRange(controls.phmin, controls.phmax);
    if (ph) add("ph", rangeLabel("pH", ph), () => clearInputs("phMinInput", "phMaxInput"));
    cautionFilters.filter((item) => controls.cautions.includes(item.value)).forEach((item) => {
      const label = item.value === "none" ? item.label : `Caution: ${item.label}`;
      const labelHtml = item.value === "none" ? "" : `Caution: ${item.labelHtml || escapeHtml(item.label)}`;
      add(`caution:${item.value}`, label, () => uncheck("caution", item.value), labelHtml);
    });
    sourceFilters.filter((item) => controls.sources.includes(item.value)).forEach((item) => {
      const others = controls.sources.filter((value) => value !== item.value);
      add(`source:${item.value}`, `Source: ${item.label}`, () => setSourceControls(others.length ? "databases" : "all", others));
    });
    return items;
  }

  // The control a change came from, as the key of its filter (activeFilterItems).
  const FILTER_KEYS_BY_ID = {
    globalSearchInput: "q", ecFilterInput: "ec", enzymeFilterInput: "enzyme", organismFilterInput: "organism",
    substrateFilterInput: "substrate", temperatureMinInput: "temperature", temperatureMaxInput: "temperature",
    phMinInput: "ph", phMaxInput: "ph", humanCheckedFilter: "checked",
  };
  const FILTER_KEY_PREFIXES = {
    recordState: "status", measurement: "metric", variant: "variant", caution: "caution", source: "source", sourceMode: "source",
  };

  function filterKeyForControl(element) {
    if (!element) return "";
    if (FILTER_KEYS_BY_ID[element.id]) return FILTER_KEYS_BY_ID[element.id];
    const prefix = FILTER_KEY_PREFIXES[element.name];
    if (!prefix) return "";
    return prefix === "status" ? prefix : `${prefix}:${element.value}`;
  }

  // The filter changed last goes to the end of the order, so "remove the last filter" removes it.
  function noteFilterChange(element) {
    const key = filterKeyForControl(element);
    state.pendingPage = 0;
    if (!key) return;
    state.filterOrder = state.filterOrder.filter((item) => item !== key);
    state.filterOrder.push(key);
  }

  const CHIP_CLOSE_ICON = '<svg class="chip-x" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3.5 3.5l5 5M8.5 3.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

  // The count beside Filters and one removable chip per active filter above the table, with Clear all.
  function renderActiveFilters(items = activeFilterItems()) {
    const keys = items.map((item) => item.key);
    state.filterOrder = state.filterOrder.filter((key) => keys.includes(key));
    keys.forEach((key) => {
      if (!state.filterOrder.includes(key)) state.filterOrder.push(key);
    });
    const count = items.length;
    const badge = $("activeFilterCount");
    if (badge) {
      badge.textContent = count ? String(count) : "";
      badge.classList.toggle("hidden", count === 0);
    }
    $("openFiltersButton")?.setAttribute("aria-label", count ? `Filters, ${count} active` : "Filters");
    const bar = $("activeFilters");
    if (!bar) return;
    const html = count
      ? items.map((item) => `<button class="filter-chip" type="button" data-filter-key="${escapeHtml(item.key)}" title="Remove this filter" aria-label="Remove filter: ${escapeHtml(item.label)}"><span>${item.labelHtml}</span>${CHIP_CLOSE_ICON}</button>`).join("")
        + `<button class="text-button filter-chips-clear" type="button" data-filter-clear="">Clear all</button>`
      : "";
    if (html === renderedChipsHtml) return;
    // A chip with focus keeps it when the chips are redrawn (or the one now in its place takes it).
    const focused = bar.contains?.(document.activeElement) ? document.activeElement : null;
    const focusedKey = focused?.dataset?.filterKey || "";
    const focusedIndex = focused ? [...bar.querySelectorAll("button")].indexOf(focused) : -1;
    renderedChipsHtml = html;
    bar.hidden = !count;
    bar.innerHTML = html;
    if (focused) {
      const buttons = [...bar.querySelectorAll("button")];
      const target = (focusedKey && buttons.find((button) => button.dataset.filterKey === focusedKey))
        || buttons[Math.min(focusedIndex, buttons.length - 1)]
        || $("openFiltersButton");
      target?.focus({ preventScroll: true });
    }
  }

  let renderedChipsHtml = "";

  // Removing a filter (a chip, or the empty-results button): focus stays in the chips, or returns to Filters.
  function removeActiveFilter(key, { focusIndex = -1 } = {}) {
    const item = activeFilterItems().find((candidate) => candidate.key === key);
    if (!item) return;
    item.clear();
    state.pendingPage = 0;
    renderActiveFilters();
    const chips = [...($("activeFilters")?.querySelectorAll?.(".filter-chip") || [])];
    if (focusIndex >= 0) (chips[Math.min(focusIndex, chips.length - 1)] || $("openFiltersButton"))?.focus({ preventScroll: true });
    applyFiltersInBackground();
  }

  function renderActiveFilterCount() {
    renderActiveFilters();
  }

  // Field filters fold each distinct value once per loaded generation (not once per row and keystroke).
  const foldedFields = { generation: -1, values: new Map() };

  function foldedFieldCache() {
    if (foldedFields.generation !== state.recordsGeneration) {
      foldedFields.generation = state.recordsGeneration;
      foldedFields.values = new Map();
    }
    return foldedFields.values;
  }

  function foldedField(value, field = "") {
    const cache = foldedFieldCache();
    // An organism also answers to its short and common names ("E. coli", "human").
    const key = field === "organism" ? `organism|${value}` : value;
    let folded = cache.get(key);
    if (folded === undefined) {
      folded = compactSearch(foldSearch(field === "organism" ? `${value}|${organismSearchText(value)}` : value));
      cache.set(key, folded);
    }
    return folded;
  }

  // A common organism name typed in the Organism field (rat, pig, dog, ...) matches as a whole word, so "rat" finds rats,
  // not Serratia or Mesocricetus auratus.
  const COMMON_ORGANISM_WORDS = new Set(Object.values(commonOrganismNames).flatMap((names) => names.split(" ")));

  function organismWordSet(value) {
    const cache = foldedFieldCache();
    const key = `organism-words|${value}`;
    let words = cache.get(key);
    if (words === undefined) {
      words = new Set(foldSearch(`${value}|${organismSearchText(value)}`).split(/[^a-z0-9]+/).filter(Boolean));
      cache.set(key, words);
    }
    return words;
  }

  function fieldContains(row, field, words) {
    if (!words?.length) return true;
    const value = foldedField(row[field] || "", field);
    if (field !== "organism") return words.every((word) => value.includes(word));
    return words.every((word) => (COMMON_ORGANISM_WORDS.has(word) ? organismWordSet(row[field] || "").has(word) : value.includes(word)));
  }

  // The search and the name fields: every count and every result needs them.
  function rowBaseMatches(row, filters) {
    if (filters.q) {
      const words = filters.qWords || searchWords(filters.q);
      const text = searchText(row);
      if (!words.every((word) => wordMatches(row, word, text))) return false;
    }
    // The EC filter matches whole EC parts: "1.1.1" is EC 1.1.1 and every number under it.
    const ecQueries = filters.ecQueries || (filters.ec ? ecFilterQueries(filters.ec) : null);
    if (ecQueries?.length && !ecQueries.some((query) => (
      query.ec ? ecMatches(row, query.ec) : foldedField(row.ec_number || "").includes(query.text)
    ))) return false;
    if (!fieldContains(row, "enzyme_display_name", filters.enzymeWords || fieldWords(filters.enzyme))) return false;
    if (!fieldContains(row, "organism", filters.organismWords || fieldWords(filters.organism))) return false;
    if (!fieldContains(row, "substrate_name", filters.substrateWords || fieldWords(filters.substrate))) return false;
    return true;
  }

  // The filter groups whose options are counted, each with its test.
  const FACET_GROUP_TESTS = [
    ["state", (row, filters) => filters.recordStates.includes(row._recordState || recordStateForRow(row))],
    ["source", (row, filters) => (filters.sourceMode !== "paper" || isV2Row(row))
      && (filters.sourceMode !== "databases" || !isV2Row(row))
      && (!filters.sourceBits || Boolean(rowSourceBits(row) & filters.sourceBits))],
    // Has kcat, Has Km, Has kcat/Km: a record has every value ticked.
    ["metric", (row, filters) => !filters.metrics?.length || filters.metrics.every((metric) => row[metric] != null)],
    ["checked", (row, filters) => !filters.humanChecked || isHumanChecked(row)],
    ["variant", (row, filters) => !filters.variantBits || Boolean(rowVariantBits(row) & filters.variantBits)],
    ["temperature", (row, filters) => !filters.temperature || inRange(row._sortTemperature ?? temperatureValue(row), filters.temperature)],
    ["ph", (row, filters) => !filters.ph || inRange(row._sortPh ?? phValue(row), filters.ph)],
    ["caution", (row, filters) => !filters.cautionBits || Boolean(rowCautionBits(row) & filters.cautionBits)],
  ];

  // The groups a record fails (stopping at two: it then counts nowhere), or null when the search or a name field rules
  // it out.
  function rowFacetFailures(row, filters) {
    if (!rowBaseMatches(row, filters)) return null;
    const failed = [];
    for (const [group, test] of FACET_GROUP_TESTS) {
      if (!test(row, filters)) {
        failed.push(group);
        if (failed.length > 1) break;
      }
    }
    return failed;
  }

  function rowMatches(row, filters) {
    if (!rowBaseMatches(row, filters)) return false;
    return FACET_GROUP_TESTS.every(([, test]) => test(row, filters));
  }

  function ecSort(a, b) {
    const left = ecParts(a);
    const right = ecParts(b);
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
    // Low to high; rows without the value stay last.
    const numericAsc = (field) => (a, b) => {
      const av = a[field] == null ? Number.POSITIVE_INFINITY : Number(a[field]);
      const bv = b[field] == null ? Number.POSITIVE_INFINITY : Number(b[field]);
      return av - bv;
    };
    const sorters = {
      ec_number: ecSort,
      enzyme: textKey("_sortEnzyme"),
      organism: textKey("_sortOrganism"),
      substrate: textKey("_sortSubstrate"),
      kcat: numericDesc("kcat"),
      kcat_asc: numericAsc("kcat"),
      km: numericDesc("km"),
      km_asc: numericAsc("km"),
      kcat_over_km: numericDesc("kcat_over_km"),
      kcat_over_km_asc: numericAsc("kcat_over_km"),
      temperature: numericDesc("_sortTemperature"),
      temperature_asc: numericAsc("_sortTemperature"),
      ph: numericDesc("_sortPh"),
      ph_asc: numericAsc("_sortPh"),
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

  let indexOrderWarned = false;

  async function confirmIndexOrder(records, comparator, entry) {
    for (let index = 1; index < records.length; index += 1) {
      if (comparator(records[index - 1], records[index]) > 0) {
        if (!indexOrderWarned) {
          indexOrderWarned = true;
          console.warn(`CatLog index rows ${index - 1} and ${index} are out of the default order; sorting in the browser instead.`);
        }
        return cooperativeStableSort(records, comparator, entry);
      }
      if (index % (SORT_RUN_SIZE * 4) === 0 && !(await yieldDuringSort(entry))) return null;
    }
    return isSortEntryCurrent(entry) ? records.slice() : null;
  }

  function normalizedSortName(sort) {
    return [
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
      "temperature",
      "temperature_asc",
      "ph",
      "ph_asc",
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
    const comparator = rowComparator(sortName);
    const records = state.records;
    // An index that arrives in the default order needs one check, not a sort.
    const sorted = sortName === "evidence" && state.indexOrder === DEFAULT_INDEX_ORDER
      ? confirmIndexOrder(records, comparator, entry)
      : cooperativeStableSort(records, comparator, entry);
    entry.promise = sorted.catch((error) => {
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
    renderActiveFilterCount();
    state.filtered = orderedRecords.filter((row) => rowMatches(row, filters));
    if (resetPage) state.page = 1;
    if (state.pendingPage && state.recordsReady) {
      state.page = state.pendingPage;
      state.pendingPage = 0;
    }
    if (state.selectedKey && !state.filtered.some((row) => row.record_key === state.selectedKey)) {
      resetDetail();
    }
    renderSummary();
    renderRows();
    openRecordFromLocation();
    updateFilterCounts();
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
    // Typing waits this long after the last key, so 169k records are filtered once per pause, not per keystroke.
    state.filterTimer = window.setTimeout(() => {
      applyFiltersInBackground({ runId });
    }, FILTER_TYPING_DELAY_MS);
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

  // Records of one paper that read the same in every column but differ in their assay: the short condition note the
  // export gives (condition_note: "+10 mM FBP", "no effector") goes under the substrate. Without one, two records on
  // this page that share a paper and every column say that their conditions differ.
  const VISIBLE_ROW_FIELDS = ["enzyme_display_name", "mutation_signature", "ec_number", "organism", "substrate_name",
    "kcat_display", "kcat_unit", "km_display", "km_unit", "kcat_over_km_display", "kcat_over_km_unit", "verification_status",
    "source_db"];

  function conditionNoteText(...rows) {
    for (const row of rows) {
      const note = publicEvidenceString(String(row?.condition_note ?? "")).trim();
      if (note) return note;
    }
    return "";
  }

  function lookAlikeRowKeys(pageRows) {
    const groups = new Map();
    pageRows.forEach((row) => {
      if (conditionNoteText(row)) return;
      const papers = [row._pmids, row._dois].map((value) => JSON.stringify(value ?? null)).join("|");
      if (papers === "null|null") return;
      const key = JSON.stringify([...VISIBLE_ROW_FIELDS.map((field) => row[field] ?? null), formatTemperature(row), formatPh(row), papers]);
      groups.set(key, [...(groups.get(key) || []), row.record_key]);
    });
    return new Set([...groups.values()].filter((keys) => keys.length > 1).flat());
  }

  function substrateNoteHtml(row, lookAlikes) {
    const note = conditionNoteText(row) || (lookAlikes.has(row.record_key) ? "conditions differ, see record" : "");
    return note ? `<small class="condition-note" title="${escapePublic(note)}">${escapePublic(note)}</small>` : "";
  }

  function renderRows() {
    document.body.classList.remove("catalog-load-failed");
    const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
    state.page = Math.min(Math.max(1, state.page), totalPages);
    syncBrowseUrl();
    const start = (state.page - 1) * state.pageSize;
    const loading = !state.recordsReady;
    const sortWaits = sortWaitsForRecords();
    const pageRows = sortWaits ? [] : currentPageRows();
    const activeRowKey = activeTableRowKey(pageRows);
    state.activeRowKey = activeRowKey;
    // While the index loads in the default order with nothing filtered, the pages already drawn are final: count them
    // against every record. Otherwise the count is what has loaded so far.
    const finalPages = loading && showsWholeIndexOrder();
    const shownTotal = finalPages
      ? Math.max(Number(manifest.total_rows || 0), state.filtered.length)
      : state.filtered.length;
    const range = pageRows.length
      ? `${formatInteger(start + 1)}–${formatInteger(Math.min(start + pageRows.length, shownTotal))} of ${formatInteger(shownTotal)}`
      : "";
    // While loading, a page that is already final shows its range ("1–25 of 169,309"); a filtered one, how many
    // records match so far ("312 available").
    const loadingSummary = finalPages ? range : `${formatInteger(state.filtered.length)} available`;
    $("activeSummary").textContent = state.recordsReady
      ? `${formatInteger(state.filtered.length)} ${state.filtered.length === 1 ? "record" : "records"}`
      : `${formatInteger(state.filtered.length)} available`;
    // Human-checked needs the review marks, which arrive after the index: until then the table waits for them.
    const awaitingMarks = !pageRows.length && state.recordsReady && !state.humanMarksLoaded && Boolean($("humanCheckedFilter")?.checked);
    $("pageSummary").textContent = pageRows.length
      ? (loading ? loadingSummary : range)
      : (awaitingMarks ? "Loading human-review results" : state.recordsReady ? "No matching records" : loadProgressText());
    if ($("clearResultsButton")) $("clearResultsButton").hidden = !state.recordsReady || pageRows.length > 0 || awaitingMarks;
    $("pageLabel").textContent = pageRows.length
      ? range
      : state.recordsReady ? "No records" : "Loading";
    // The count beside Filters is read out when it changes; it is shown only when it says more than the page range.
    $("pageSummary").classList.toggle("visually-hidden", $("pageSummary").textContent === $("pageLabel").textContent);
    const showResults = $("showResultsButton");
    if (showResults) {
      showResults.textContent = state.recordsReady
        ? `Show ${formatInteger(state.filtered.length)} ${state.filtered.length === 1 ? "record" : "records"}`
        : "Show records";
    }
    $("prevButton").disabled = state.page <= 1;
    // While loading, the next page opens once its rows have loaded.
    $("nextButton").disabled = loading
      ? sortWaits || (state.page + 1) * state.pageSize > state.filtered.length
      : state.page >= totalPages;
    syncExportControls(pageRows);
    const body = $("recordsBody");
    if (state.preserveRenderedRows && pageRows.length) {
      // The complete index arrived: the page drawn from its first rows stays (focus, hover and selection intact)
      // when it shows the same records.
      const shownKeys = [...body.querySelectorAll("tr[data-key]")].map((rowElement) => rowElement.dataset.key);
      if (shownKeys.length === pageRows.length && pageRows.every((row, index) => row.record_key === shownKeys[index])) {
        return;
      }
    }
    const focusedRowKey = state.preserveRenderedRows && body.contains?.(document.activeElement) ? state.activeRowKey : "";
    if ((loading && !pageRows.length && !state.records.length) || awaitingMarks || sortWaits) {
      body.innerHTML = skeletonRowsHtml();
      fitTableColumns();
      return;
    }
    if (!pageRows.length && state.recordsReady) {
      body.innerHTML = emptyResultsHtml();
      fitTableColumns();
      body.querySelector?.('[data-action="clear-filters"]')?.addEventListener("click", () => {
        clearFilters();
        $("globalSearchInput").focus({ preventScroll: true });
      });
      const removeLast = body.querySelector?.('[data-action="remove-last-filter"]');
      removeLast?.addEventListener("click", () => {
        removeActiveFilter(removeLast.dataset.filterKey);
        ($("activeFilters")?.querySelector?.(".filter-chip") || $("openFiltersButton"))?.focus({ preventScroll: true });
      });
      return;
    }
    const lookAlikes = lookAlikeRowKeys(pageRows);
    body.innerHTML = pageRows.map((row) => {
      const flags = conditionFlags(row);
      const substrateNote = substrateNoteHtml(row, lookAlikes);
      const enzymeName = row.enzyme_display_name || "Name not recorded";
      // A variant's mutation has its own line, never clipped: the name keeps one line beside it (rows stay one height).
      const enzymeForm = enzymeFormHtml(row);
      const enzymeTitle = [enzymeName, enzymeFormText(row)].filter(Boolean).join(" · ");
      return `
      <tr data-key="${escapeHtml(row.record_key)}" class="${row.record_key === state.selectedKey ? "selected" : ""}" tabindex="${row.record_key === activeRowKey ? "0" : "-1"}" aria-selected="${row.record_key === state.selectedKey ? "true" : "false"}">
        <td class="c-enzyme primary-cell"><span class="clamp-2${enzymeForm ? " has-form" : ""}" title="${escapePublic(enzymeTitle)}"><strong>${escapePublic(enzymeName)}</strong></span>${enzymeForm}</td>
        <td class="c-ec"><span class="clamp-2"${String(row.ec_number || "").includes(" ") ? ` title="${escapeHtml(row.ec_number)}"` : ""}>${escapeHtml(row.ec_number || EMPTY_VALUE)}</span></td>
        <td class="c-organism"><span class="clamp-2" title="${escapePublic(row.organism || "")}">${escapePublic(row.organism || EMPTY_VALUE)}</span></td>
        <td class="c-substrate${substrateNote ? " has-note" : ""}"><span class="clamp-2" title="${escapePublic(row.substrate_name || "")}">${escapePublic(row.substrate_name || EMPTY_VALUE)}</span>${substrateNote}</td>
        ${enzymeForm ? `<td class="c-form">${enzymeFormHtml(row, { className: "enzyme-form card-form" })}</td>` : ""}
        <td class="c-kcat num" data-label="kcat (s⁻¹)"><span class="metric-with-note"${valueTitle(row, "kcat")}>${metricDisplayWithUnitHtml(row, "kcat", { table: true })}${valueFlagBadgeHtml(flags, "kcat", row)}</span></td>
        <td class="c-km num" data-label="Km (mM)"><span class="metric-with-note"${valueTitle(row, "km")}>${metricDisplayWithUnitHtml(row, "km", { table: true })}${valueFlagBadgeHtml(flags, "km", row)}</span></td>
        <td class="c-eff num" data-label="kcat/Km (s⁻¹ mM⁻¹)"><span class="metric-with-note"${valueTitle(row, "kcat_over_km")}>${metricDisplayWithUnitHtml(row, "kcat_over_km", { table: true })}${efficiencyOriginHtml(row, { short: true })}${valueFlagBadgeHtml(flags, "kcat_over_km", row)}</span></td>
        ${conditionCellHtml("c-temp", formatTemperature(row))}
        ${conditionCellHtml("c-ph", formatPh(row))}
        <td class="c-status">${statusBadge(row)}</td>
        <td class="c-open row-arrow" aria-hidden="true">&rsaquo;</td>
      </tr>
    `;
    }).join("");
    fitTableColumns();
    const rowElements = [...body.querySelectorAll("tr[data-key]")];
    rowElements.forEach((rowElement) => {
      // Hovering or focusing a row a moment starts loading its record, so opening it is immediate.
      let prefetchTimer = 0;
      const startPrefetch = () => {
        window.clearTimeout(prefetchTimer);
        prefetchTimer = window.setTimeout(() => prefetchDetail(rowElement.dataset.key), DETAIL_PREFETCH_DELAY_MS);
      };
      const cancelPrefetch = () => window.clearTimeout(prefetchTimer);
      rowElement.addEventListener("pointerenter", startPrefetch);
      rowElement.addEventListener("pointerleave", cancelPrefetch);
      rowElement.addEventListener("blur", cancelPrefetch);
      rowElement.addEventListener("focus", () => {
        setActiveTableRow(rowElement, rowElements);
        startPrefetch();
      });
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
    if (focusedRowKey) rowElements.find((rowElement) => rowElement.dataset.key === focusedRowKey)?.focus();
  }

  function showsWholeIndexOrder() {
    if (state.indexOrder !== DEFAULT_INDEX_ORDER) return false;
    const controls = filterControlState();
    return controls.sort === "evidence" && !activeFilterItems(controls).length;
  }

  // Column widths follow the page. Values, EC, T, pH and Status are as wide as their widest entry and never wrap. A name
  // column (Enzyme, Organism, Substrate) starts as wide as three in four of its names, within a minimum and a cap.
  // The room left in the window goes to the name columns: first until each of their names fits on one line, then the
  // rest in proportion to their widths, so the table fills the window and the arrow sits right after Status. When the
  // window is too narrow, the names give way (they wrap to two lines, between words while they can; the full name is in
  // the tooltip); when even that is not enough, the table scrolls sideways. Phones show cards, and placeholder or empty
  // tables keep the stylesheet's widths.
  const FIT_COLUMNS = [
    { key: "enzyme", cell: ".c-enzyme", min: 160, narrowMin: 150, cap: 340, shrink: 1 },
    { key: "ec", cell: ".c-ec", min: 64, narrowMin: 60, cap: 120 },
    // About 13 characters, so a genus such as Chromobacterium is not cut mid-word.
    { key: "organism", cell: ".c-organism", min: 124, narrowMin: 118, cap: 200, shrink: 1 },
    { key: "substrate", cell: ".c-substrate", min: 120, narrowMin: 112, cap: 220, shrink: 1 },
    { key: "kcat", cell: ".c-kcat", min: 64, narrowMin: 60, cap: 200 },
    { key: "km", cell: ".c-km", min: 60, narrowMin: 56, cap: 200 },
    { key: "efficiency", cell: ".c-eff", min: 88, narrowMin: 84, cap: 220 },
    { key: "temp", cell: ".c-temp", min: 44, narrowMin: 40, cap: 90 },
    { key: "ph", cell: ".c-ph", min: 44, narrowMin: 40, cap: 80 },
    { key: "state", cell: ".c-status", min: 96, narrowMin: 96, cap: 400 },
  ];
  // A name column grows toward one line for its names up to this many times its cap; longer names keep two lines.
  const FIT_ONE_LINE_LIMIT = 2;
  let fitTextContext = null;

  // The widest word of a name, so a narrow window breaks names between words before it breaks a word.
  function widestWordWidth(element) {
    fitTextContext ??= document.createElement("canvas").getContext("2d");
    const text = element.querySelector("strong") || element;
    // The font from its parts: the computed shorthand can be empty (then the canvas would measure 10px sans-serif).
    const font = window.getComputedStyle(text);
    fitTextContext.font = font.font || `${font.fontStyle} ${font.fontWeight} ${font.fontSize} ${font.fontFamily}`;
    // A line can also break after a hyphen, comma or slash, so a chemical name's parts count as its words.
    return Math.max(0, ...String(text.textContent || "").split(/\s+|(?<=[-,/])/).map((word) => fitTextContext.measureText(word).width));
  }

  function fitTableColumns() {
    const table = $("recordTableWrap")?.querySelector?.("table");
    const style = window.getComputedStyle;
    if (!table || typeof style !== "function") return;
    const cols = {};
    table.querySelectorAll("col").forEach((col) => { cols[col.className.replace(/^col-/, "")] = col; });
    if (!cols.open || FIT_COLUMNS.some((column) => !cols[column.key])) return;
    Object.values(cols).forEach((col) => { col.style.width = ""; });
    table.style.minWidth = "";
    const rows = [...table.querySelectorAll("#recordsBody tr[data-key]")];
    if (!rows.length || style(table).display !== "table") return;
    const visible = (element) => style(element).display !== "none";
    const narrow = narrowDetailMedia.matches;
    // Beside docked filters a name column is never narrower than its longest word: the table scrolls sideways instead
    // (with the Columns control and the Enzyme column kept in view).
    const docked = filtersDocked() && document.body.classList.contains("filters-open");
    // Each cell's natural width, read once with wrapping switched off (table.measuring in the stylesheet).
    table.classList.add("measuring");
    const widths = FIT_COLUMNS.filter((column) => visible(cols[column.key])).map((column) => {
      const cells = rows.map((row) => row.querySelector(column.cell)).filter(Boolean);
      const first = style(cells[0]);
      const padding = parseFloat(first.paddingLeft) + parseFloat(first.paddingRight) + 2;
      const natural = cells.map((cell) => cell.firstElementChild?.getBoundingClientRect().width || 0).sort((a, b) => a - b);
      // A value column is also as wide as its header (with the sort arrow).
      const header = table.querySelector(`thead ${column.cell} .sort-button`)?.getBoundingClientRect().width || 0;
      const widest = Math.max(natural[natural.length - 1], header);
      const content = column.shrink === 1 ? natural[Math.floor((natural.length - 1) * 0.75)] : widest;
      const min = narrow ? column.narrowMin : column.min;
      const wordWidth = column.shrink
        ? Math.ceil(Math.max(...cells.map((cell) => widestWordWidth(cell.firstElementChild || cell))) + padding)
        : min;
      let width = Math.max(min, Math.min(column.cap, Math.ceil(content + padding)));
      if (docked && column.shrink) width = Math.max(width, Math.min(column.cap, wordWidth));
      // A name column's width with every name on one line, and the narrowest that breaks no word.
      const oneLine = Math.max(width, Math.min(column.cap * FIT_ONE_LINE_LIMIT, Math.ceil(widest + padding)));
      const words = column.shrink ? Math.min(width, wordWidth) : min;
      return { ...column, min, width, oneLine, words };
    });
    table.classList.remove("measuring");
    const arrow = visible(cols.open) ? parseFloat(style(cols.open).width) || 24 : 0;
    const total = () => widths.reduce((sum, column) => sum + column.width, 0);
    const available = table.parentElement.clientWidth - arrow;
    const shrinkable = widths.filter((column) => column.shrink);
    const floor = total() - shrinkable.reduce((sum, column) => sum + column.width - column.min, 0);
    if (total() > available && (available >= floor || docked)) {
      // Too wide for the window: the names give way, first to two lines broken between words, then (not beside docked
      // filters) to their minimums.
      const targets = [(column) => Math.max(column.min, column.words), (column) => column.min];
      for (const target of docked ? targets.slice(0, 1) : targets) {
        const excess = total() - available;
        const slack = shrinkable.reduce((sum, column) => sum + Math.max(0, column.width - target(column)), 0);
        if (excess <= 0 || !slack) continue;
        const share = Math.min(1, excess / slack);
        shrinkable.forEach((column) => { column.width = Math.floor(column.width - share * Math.max(0, column.width - target(column))); });
      }
    }
    const names = widths.filter((column) => column.shrink === 1);
    if (available > total() && names.length) {
      // Room to spare: the name columns widen until their names fit on one line, each in proportion to what it lacks,
      const lacking = names.map((column) => column.oneLine - column.width);
      const lackingTotal = lacking.reduce((sum, value) => sum + value, 0);
      const toOneLine = Math.min(available - total(), lackingTotal);
      if (toOneLine > 0) names.forEach((column, index) => { column.width += Math.floor(toOneLine * lacking[index] / lackingTotal); });
      // then share what is still left in proportion to their widths; the rounding remainder goes to Enzyme.
      const rest = available - total();
      const base = names.reduce((sum, column) => sum + column.width, 0);
      names.forEach((column) => { column.width += Math.floor(rest * column.width / base); });
      names[0].width += Math.max(0, available - total());
    }
    widths.forEach((column) => { cols[column.key].style.width = `${column.width}px`; });
    table.style.minWidth = `${Math.ceil(total() + arrow)}px`;
  }

  // Placeholder rows while nothing has loaded: the table keeps its shape and the count says how far loading is. Each
  // cell takes its column's role class from the header, so number placeholders sit on the right.
  function skeletonRowsHtml(count = 10) {
    const headers = [...(document.querySelectorAll?.("#recordTableWrap thead th") || [])];
    const cells = headers.length
      ? headers.map((th) => `<td class="${escapeHtml(th.className || "")}"><span></span></td>`).join("")
      : "<td><span></span></td>".repeat(tableColumnCount());
    return `<tr class="skeleton-row" aria-hidden="true">${cells}</tr>`.repeat(count);
  }

  // The controls without one active filter (activeFilterItems keys), to count what removing it would show.
  function controlsWithout(controls, key) {
    const next = { ...controls };
    const [group, value] = key.split(":");
    const lists = { metric: "metrics", variant: "variants", caution: "cautions", source: "sources" };
    if (lists[group]) next[lists[group]] = controls[lists[group]].filter((item) => item !== value);
    if (group === "source" && !next.sources.length) next.sourceMode = "all";
    else if (group === "status") next.states = recordStates.map((item) => item.value);
    else if (group === "temperature") Object.assign(next, { tmin: "", tmax: "" });
    else if (group === "ph") Object.assign(next, { phmin: "", phmax: "" });
    else if (["q", "ec", "enzyme", "organism", "substrate"].includes(group)) next[group] = "";
    else if (group === "checked") next[group] = false;
    return next;
  }

  // No record matches: say so in the table, name the filters that are on, and offer to remove the one set last that
  // brings records back (with how many) or to clear everything.
  function emptyResultsHtml() {
    const query = String($("globalSearchInput")?.value || "").trim();
    // A shared record link (#record=) whose record this snapshot does not have.
    const missingRecord = Boolean(query) && query === state.missingRecordKey;
    const controls = filterControlState();
    const items = activeFilterItems(controls);
    const searchOnly = items.length === 1 && items[0].key === "q";
    const heading = missingRecord
      ? `Record ${query} is not in this snapshot`
      : searchOnly ? `No records match "${query}"` : "No records match these filters";
    const hint = missingRecord
      ? "Records change between snapshots. Search for the enzyme, organism, substrate or PMID to find the current ones."
      : items.length > 1
        ? `Filters on: ${items.map((item) => item.label).join(" · ")}.`
        : searchOnly || !items.length
          ? "Check the spelling, or try an EC number (1.1.1.1), a UniProt accession (P11509) or a PMID."
          : `Filter on: ${items[0].label}.`;
    // The filter set last whose removal shows records (of the last four set), if there is one.
    let removeLast = "";
    if (!missingRecord && items.length > 1) {
      const order = [...state.filterOrder.filter((key) => items.some((item) => item.key === key)),
        ...items.map((item) => item.key).filter((key) => !state.filterOrder.includes(key))];
      for (const key of order.reverse().slice(0, 4)) {
        const filters = currentFilters(controlsWithout(controls, key));
        const count = state.records.reduce((total, row) => total + (rowMatches(row, filters) ? 1 : 0), 0);
        if (!count) continue;
        const item = items.find((candidate) => candidate.key === key);
        removeLast = `<button class="button secondary" type="button" data-action="remove-last-filter" data-filter-key="${escapeHtml(key)}">Remove ${escapeHtml(item.label)} (${formatInteger(count)} ${count === 1 ? "record" : "records"})</button>`;
        break;
      }
    }
    return `
      <tr class="empty-row">
        <td colspan="${tableColumnCount()}">
          <div class="load-notice empty-notice">
            <strong>${escapeHtml(heading)}</strong>
            <span>${escapeHtml(hint)}</span>
            <div class="empty-actions">
              ${removeLast}
              <button class="button secondary" type="button" data-action="clear-filters">Clear search and filters</button>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  function prefetchDetail(key) {
    const row = currentPageRows().find((item) => item.record_key === key);
    if (!row?.detail_shard) return;
    loadDetailShard(row.detail_shard).then(() => retainDetailShard(row.detail_shard)).catch(() => {});
  }

  function filtersDocked() {
    return Boolean(dockedFiltersMedia.matches);
  }

  // Docked filters and an open record share the screen from 1600px; below that, opening one closes the other.
  function filtersFitBesideRecord() {
    return filtersDocked() && Boolean(filtersBesideRecordMedia.matches);
  }

  function setDetailOpen(isOpen) {
    if (isOpen && !filtersFitBesideRecord()) {
      const docked = filtersDocked() && document.body.classList.contains("filters-open");
      const scrollTop = $("catalogFilters")?.scrollTop || 0;
      setFiltersOpen(false);
      if (docked) state.filtersAwayForRecord = { scrollTop };
    }
    document.body.classList.toggle("detail-open", Boolean(isOpen));
    syncDetailPanelAccessibility();
    const away = state.filtersAwayForRecord;
    if (!isOpen && away) {
      state.filtersAwayForRecord = null;
      // Closing the record brings the docked filters back where they were (not when Browse itself was left).
      if (filtersDocked() && !$("catalogView")?.hidden) {
        setFiltersOpen(true, { focus: false });
        if ($("catalogFilters")) $("catalogFilters").scrollTop = away.scrollTop;
      }
    }
  }

  function syncDetailPanelAccessibility() {
    const panel = $("detailPanel");
    const filtersOpen = document.body.classList.contains("filters-open");
    // Docked filters (wide screens) leave the table usable; the overlay is a modal dialog.
    const filtersModal = filtersOpen && !filtersDocked();
    const isModal = Boolean(!filtersModal && narrowDetailMedia.matches && document.body.classList.contains("detail-open"));
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
      element.inert = filtersModal || (element.id !== "detailPanel" && isModal);
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

  function syncFilterRailRole() {
    const rail = $("catalogFilters");
    if (!rail) return;
    const isOpen = document.body.classList.contains("filters-open");
    rail.setAttribute("aria-hidden", String(!isOpen));
    if (isOpen && !filtersDocked()) {
      rail.setAttribute("role", "dialog");
      rail.setAttribute("aria-modal", "true");
    } else {
      rail.removeAttribute("role");
      rail.removeAttribute("aria-modal");
    }
  }

  function setFiltersOpen(isOpen, { focus = true } = {}) {
    const shouldOpen = Boolean(isOpen);
    const wasOpen = document.body.classList.contains("filters-open");
    // Filters opened (or closed) by hand are not brought back when a record closes.
    if (shouldOpen || !document.body.classList.contains("detail-open")) state.filtersAwayForRecord = null;
    hideSuggestions();
    // Docked filters below 1600px take the record's place.
    if (shouldOpen && filtersDocked() && !filtersFitBesideRecord() && document.body.classList.contains("detail-open")) {
      resetDetail();
    }
    document.body.classList.toggle("filters-open", shouldOpen);
    $("openFiltersButton")?.setAttribute("aria-expanded", String(shouldOpen));
    if (shouldOpen && !wasOpen) updateFilterCounts();
    const rail = $("catalogFilters");
    syncFilterRailRole();
    syncDetailPanelAccessibility();
    // A docked panel changes the table's width.
    if (wasOpen !== shouldOpen && filtersDocked()) {
      fitTableColumns();
      updateTableScrollControls();
    }
    if (shouldOpen && focus) {
      window.setTimeout(() => {
        if (document.body.classList.contains("filters-open") && !rail?.contains(document.activeElement)) {
          $("closeFiltersButton")?.focus({ preventScroll: true });
        }
      }, 180);
    }
  }

  function syncFilterPanel() {
    // A window narrowed below 1600px with docked filters and a record both open keeps the record.
    if (document.body.classList.contains("filters-open") && document.body.classList.contains("detail-open")
      && filtersDocked() && !filtersFitBesideRecord()) {
      setFiltersOpen(false);
      return;
    }
    syncFilterRailRole();
    syncDetailPanelAccessibility();
  }

  function updateTableScrollControls() {
    const wrap = $("recordTableWrap");
    if (!wrap) return;
    // Placeholder rows have no columns to show: Columns stays hidden until the first rows are drawn. Beside the loading
    // count it would wrap the toolbar at some tablet widths, and the table would move up when the rows arrive.
    const placeholdersOnly = !state.recordsReady && !wrap.querySelector?.("tr[data-key]");
    const hasOverflow = !placeholdersOnly && wrap.scrollWidth > wrap.clientWidth + 2;
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
    if (state.selectedKey) syncRecordUrl("");
    state.selectedKey = "";
    state.selectedShard = "";
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
    syncRecordUrl(key);
    state.selectedShard = row.detail_shard || "";
    state.activeRowKey = key;
    setDetailOpen(true);
    if (focusDetail) announceOpenedRecord(row);
    renderRows();
    $("detailEmpty").classList.add("hidden");
    $("detailContent").classList.remove("hidden");
    $("detailContent").innerHTML = `
      <div class="detail-top">
        <button id="closeDetailButton" class="icon-button close-detail" type="button" aria-label="Close record">&times;</button>
        ${detailHeadingHtml(row)}
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
      renderDetail(summaryWithDetail(row, detail), detail);
      if (restoreFocus) focusDetailHeading(key);
    } catch (error) {
      if (state.selectedKey !== key) return;
      const restoreFocus = focusDetail && $("detailContent").contains(document.activeElement);
      $("detailContent").innerHTML = `
        <div class="detail-top">
          <button id="closeDetailButton" class="icon-button close-detail" type="button" aria-label="Close record">&times;</button>
          ${detailHeadingHtml(row)}
          ${detailSubtitleHtml(row)}
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

  // A schema-2 index row leaves the record-panel fields to the record's detail entry: the panel gets both.
  function summaryWithDetail(row, detail) {
    const missing = DETAIL_ONLY_FIELDS.filter((field) => !(field in row) && detail && field in detail);
    if (!missing.length) return row;
    const summary = { ...row };
    missing.forEach((field) => {
      summary[field] = detail[field];
    });
    return summary;
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

  // A PubMed ID is digits only; other paper IDs (CatLog's stand-in NP ids) get no PubMed link.
  function isPubMedId(value) {
    return /^\d+$/.test(String(value ?? "").trim());
  }

  function pmidLink(value) {
    const pmid = String(value || "").trim();
    if (!pmid) return EMPTY_VALUE;
    if (!isPubMedId(pmid)) return escapeHtml(pmid);
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
    uniprot_ec_organism_mutation_ranked_match: "UniProt accession inferred from EC, organism and variant",
    unresolved_ec_organism: "No sequence match from EC and organism",
    manual_literature_uniprot_resolution: "UniProt match from the cited paper",
    manual_literature_structure_uniprot_resolution: "UniProt match from the cited paper's structure",
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

  // Accessions inside older rows' free-text lookup notes ("UniProtKB:P00469 direct REST lookup on 2026-06-18").
  const UNIPROT_ACCESSION = /(?:^|[^A-Z0-9])([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})(?![A-Z0-9])/;
  const NCBI_ACCESSION = /(?:^|[^A-Z0-9])([A-Z]{2}_\d{5,9}\.\d+|[A-Z]{1,3}\d{5,9}\.\d+)(?![A-Z0-9])/;

  // The sequence a reference names: a UniProt or NCBI accession, else the database, else none.
  function sequenceReference(text) {
    const value = String(text || "");
    const uniprot = /uniprot/i.test(value) ? value.match(UNIPROT_ACCESSION) : null;
    if (uniprot) return { database: "UniProt", accession: uniprot[1] };
    const ncbi = /ncbi|refseq|genbank|embl/i.test(value) ? value.match(NCBI_ACCESSION) : null;
    if (ncbi) return { database: "NCBI", accession: ncbi[1] };
    if (/uniprot/i.test(value)) return { database: "UniProt", accession: "" };
    if (/ncbi|refseq|genbank|embl/i.test(value)) return { database: "NCBI", accession: "" };
    return null;
  }

  // Sequence source: a fixed label, never the lookup trace (dates, worker runs, URLs) older rows carry.
  function sequenceSourceLabel(value) {
    if (value && typeof value === "object") return "";
    const text = String(value ?? "").trim();
    const key = sequenceSourceKey(text);
    if (!key) return "";
    const firstToken = key.split(";", 1)[0].trim();
    if (sequenceSourceLabels[key] || sequenceSourceLabels[firstToken]) return sequenceSourceLabels[key] || sequenceSourceLabels[firstToken];
    if (key.startsWith("uniprot_ec_organism_")) return "UniProt accession inferred from EC and organism";
    const reference = sequenceReference(text);
    if (reference) return [reference.database, reference.accession].filter(Boolean).join(" ");
    if (/(?:^|[^a-z])(?:pdb|rcsb)(?![a-z])/i.test(text)) {
      const pdbId = (text.match(/(?:^|[^A-Za-z0-9])[0-9][A-Za-z0-9]{3}(?![A-Za-z0-9])/g) || [])
        .map((item) => item.replace(/^[^A-Za-z0-9]/, "")).find((item) => /[A-Za-z]/.test(item));
      return pdbId ? `PDB ${pdbId.toUpperCase()}` : "PDB";
    }
    const accession = text.match(UNIPROT_ACCESSION) || text.match(NCBI_ACCESSION);
    if (accession) return `Accession ${accession[1]}`;
    // A route token (identity_matching) reads as words; free text stays as written.
    if (/\s/.test(text)) return text;
    return text.replace(/_/g, " ").replace(/^./, (character) => character.toUpperCase());
  }

  // A free-text lookup trace on a record that shows no sequence names no shown sequence's source.
  function showsSequenceSource(value, hasSequence) {
    return hasSequence || !/\s/.test(String(value ?? "").trim());
  }

  // Older rows' Sequence note: the importer's boilerplate in short public words (same meaning); other notes as
  // written. A note that only repeats Enzyme form is not shown.
  function sequenceNoteText(note, enzymeForm = "") {
    const text = String(note || "").trim();
    let match;
    if (/^Sequence is treated as wild-type because the source explicitly marked the record as wild-type\.?$/.test(text)) {
      return enzymeForm === "Wild type" ? "" : "The source marks this record as wild type.";
    }
    if (/^Sequence identity was resolved, but no explicit wild-type or mutant call was captured\.?$/.test(text)) {
      return enzymeForm === "Not recorded" ? "" : "The source does not say whether this is wild type or a variant.";
    }
    if (/^No sequence was resolved for this record, so variant-aware sequence handling could not be applied\.?$/.test(text)) {
      return "No sequence was found for this record.";
    }
    if (/^Mutation context is present, but no sequence was resolved for this record\.?$/.test(text)) {
      return "No sequence was found for this variant.";
    }
    match = text.match(/^Resolved canonical sequence from (.+?) and applied mutation signature (\S+)(?: with inferred residue-numbering offset ([+-]\d+))? to reconstruct the assayed variant sequence\.?$/);
    if (match) {
      const reference = sequenceReference(match[1]);
      const target = reference?.database === "UniProt"
        ? `the UniProt sequence${reference.accession ? ` ${reference.accession}` : ""}`
        : (reference?.accession ? `the NCBI sequence ${reference.accession}` : "the reference sequence");
      return `${match[2]} applied to ${target}${match[3] ? ` (residue numbering offset ${match[3]})` : ""}`;
    }
    match = text.match(/^Resolved sequence already matches the mutant residue\(s\)(?: after applying an inferred residue-numbering offset ([+-]\d+))?, so it is treated as a source-provided variant sequence\.?$/);
    if (match) {
      return `The sequence already carries the mutant residue(s)${match[1] ? ` (residue numbering offset ${match[1]})` : ""}; shown as the variant sequence.`;
    }
    if (/^Source notes indicate a mutant or variant enzyme, but no machine-applicable substitution signature was available\.?$/.test(text)) {
      return "The source names a variant but no exact substitution, so no variant sequence was built.";
    }
    if (/^Canonical sequence is preserved, but mutation context is present; variant sequence was not attached without safely applying the mutation\.?$/.test(text)) {
      return "The mutation could not be placed on this sequence, so only the wild-type sequence is shown.";
    }
    if (/^Mutation context was captured, but the signature could not be translated into an exact residue substitution safely\.?$/.test(text)) {
      return "The mutation could not be read as an exact residue substitution, so no variant sequence was built.";
    }
    if (/^Mutation context was captured, but conflicting substitutions targeted the same residue position\.?$/.test(text)) {
      return "Two substitutions name the same residue, so no variant sequence was built.";
    }
    match = text.match(/^Mutation signature (\S+) could not be applied safely because the resolved sequence does not match the expected reference residue\(s\)\.?$/);
    if (match) return `${match[1]} not applied: the sequence does not have the expected wild-type residue(s).`;
    match = text.match(/^Mutation signature (\S+) matches the mutant residue at offset [+-]\d+ and the reference residue at offset [+-]\d+; variant reconstruction was not applied because multiple plausible residue-numbering offsets are present\.?$/);
    if (match) return `${match[1]} not applied: more than one residue numbering fits the sequence.`;
    match = text.match(/^Mutation signature (\S+) references residue (\d+), which is outside the resolved sequence length\.?$/);
    if (match) return `${match[1]} not applied: residue ${match[2]} is beyond the sequence length.`;
    // CatLog v2 notes, in short plain words (same meaning).
    match = text.match(/^no sequence: (.+) share UniProt (\S+): which sequence is which is not known\.?$/)
      || text.match(/^No sequence shown: (.+) (?:all|both) map to UniProt (\S+), which does not say which is which\.?$/);
    if (match) return `No sequence: ${match[1]} share one UniProt entry (${match[2]}), which does not say which is which.`;
    if (/^no sequence: the measured construct could not be placed on UniProt\.?$/.test(text)) {
      return "No sequence: the measured construct could not be matched to UniProt.";
    }
    if (/^UniProt canonical sequence shown: the sequence of this variant is not known\.?$/.test(text)) {
      return "Wild-type sequence shown; the variant's own sequence is not known.";
    }
    if (/^UniProt canonical sequence shown: the measured construct could not be placed on it\.?$/.test(text)) {
      return "Full UniProt sequence shown; the measured construct could not be matched to it.";
    }
    match = text.match(/^UniProt canonical sequence shown without (.+): the paper's residue numbers do not match it\.?$/);
    if (match) return `Wild-type sequence shown, without ${match[1]} (the paper numbers residues differently).`;
    match = text.match(/^UniProt canonical sequence shown without (.+): the measured construct could not be placed on it\.?$/);
    if (match) return `Wild-type sequence shown, without ${match[1]} (the measured construct could not be matched to UniProt).`;
    match = text.match(/^measured construct: (.+)$/);
    if (match) return `Measured construct: ${match[1]}`;
    // How the paper's residue numbers were matched, in fewer words.
    return text
      .replace(/ \(the paper numbers the chain after the ([^:()]+): its residue 1 is UniProt residue (\d+)\)/, " (the paper's residue 1 is UniProt residue $2, after the $1)")
      .replace(/ \(the paper numbers residues as PDB (\S+) chain (\S+)\)/, " (numbered as in PDB $1 chain $2)")
      .replace(/ \(positions matched through the paper's printed mutagenesis primers\)/, " (positions found from the paper's primers)");
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

  // ---- Record panel: numbers ----
  // One number style for the record panel (the table's notation; the table can use it too): the stored digits, as
  // a × 10ⁿ at or above 10⁵ and below 10⁻³ and as a plain decimal in between. With `figures`, a number CatLog worked out
  // (kcat ÷ Km) is first rounded to that many significant figures, so it never shows more precision than the values it
  // comes from; a rounded number of 1000 or more whose last digits would be zeros that are not significant keeps the
  // × 10ⁿ form (5.0 × 10³, not 5000).
  function numberParts(value, { figures = 0 } = {}) {
    let text = compactValue(value).trim();
    const number = Number(text);
    if (!text || !Number.isFinite(number) || number === 0) return null;
    if (figures > 0) text = number.toPrecision(Math.min(Math.max(Math.round(figures), 1), 21));
    const match = text.match(/^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
    if (!match || !(match[2] || match[3])) return null;
    const [, signText, whole = "", fraction = "", exponentText] = match;
    const sign = signText === "-" ? "-" : "";
    let digits = whole + fraction;
    let point = whole.length + Number(exponentText || 0);
    const leadingZeros = digits.match(/^0*/)[0].length;
    digits = digits.slice(leadingZeros);
    point -= leadingZeros;
    // Trailing zeros of a plain integer (123000) are not printed digits.
    const significant = fraction || exponentText ? digits : digits.replace(/0+$/, "") || "0";
    const magnitude = Math.abs(Number(text));
    if (magnitude >= 1e5 || magnitude < 1e-3 || (figures > 0 && magnitude >= 1000 && significant.length < point)) {
      const coefficient = significant.length > 1 ? `${significant[0]}.${significant.slice(1)}` : significant;
      return { sign, coefficient, exponent: point - 1, significant: significant.length };
    }
    let plain = text.replace(/^\+/, "");
    if (exponentText) {
      if (point <= 0) plain = `${sign}0.${"0".repeat(-point)}${digits}`;
      else if (point >= digits.length) plain = `${sign}${digits}${"0".repeat(point - digits.length)}`;
      else plain = `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
    }
    return { plain, significant: significant.length };
  }

  function numberHtml(value, options) {
    const parts = numberParts(value, options);
    if (!parts) return scientificValueHtml(value);
    if (parts.plain !== undefined) return escapePublic(parts.plain);
    return scientificValueHtml(`${parts.sign}${parts.coefficient}e${parts.exponent}`);
  }

  function numberText(value, options) {
    const parts = numberParts(value, options);
    if (!parts) return compactValue(value);
    if (parts.plain !== undefined) return parts.plain;
    const exponent = [...String(parts.exponent)].map((character) => SUPERSCRIPT_DIGITS[character] ?? character).join("");
    return `${parts.sign}${parts.coefficient} × 10${exponent}`;
  }

  // Significant figures for kcat ÷ Km: the fewer of kcat's and Km's, at least 2 (databases drop trailing zeros).
  function quotientFigures(row) {
    const figures = ["kcat", "km"].map((field) => numberParts(metricDisplay(row, field))?.significant || 0);
    return Math.max(2, Math.min(...figures));
  }

  // A kcat/Km calculated from kcat and Km keeps their significant figures (5038.5 from 65.5 ÷ 0.013 is 5.0 × 10³): the
  // number of figures to show, or 0 for any other value. A kcat/Km that only equals kcat ÷ Km counts as calculated.
  function calculatedFigures(row, field) {
    return field === "kcat_over_km" && (row.kcat_over_km_origin === "calculated" || efficiencyLooksCalculated(row))
      ? quotientFigures(row)
      : 0;
  }

  // The display rule: no more precision than was measured. A stored value shows at most 4 significant figures, 3 when its
  // digits from the fourth on are a ÷60 artefact (30.333, 5.1667: a repeating 3 or 6), and never fewer than its integer
  // digits below 10⁵ (12345.6 shows 12346). Printed digits up to 4 stay as stored (135.0, 0.030). Returns the figures to
  // round to, or 0 to show the stored text. Tooltips, the record's "In catalog units" and the downloads keep the stored
  // digits.
  const DISPLAY_FIGURES = 4;
  const DIVIDED_BY_60_TAIL = /^(?:3{2,}|6{2,}|6+7)$/;

  function roundingFigures(value) {
    const text = compactValue(value).trim();
    const match = text.match(/^[+-]?(\d*)(?:\.(\d*))?(?:[eE][+-]?\d+)?$/);
    const magnitude = Math.abs(Number(text));
    if (!match || !Number.isFinite(magnitude) || magnitude === 0) return 0;
    const fraction = match[2] || "";
    const digits = `${match[1] || ""}${fraction}`.replace(/^0+/, "");
    // Trailing zeros of a plain integer are not printed digits.
    const significant = fraction || /e/i.test(text) ? digits : digits.replace(/0+$/, "");
    if (significant.length <= DISPLAY_FIGURES) return 0;
    let figures = DIVIDED_BY_60_TAIL.test(significant.slice(3)) ? 3 : DISPLAY_FIGURES;
    if (magnitude >= 1 && magnitude < 1e5) figures = Math.max(figures, Math.floor(Math.log10(magnitude)) + 1);
    return figures < significant.length ? figures : 0;
  }

  function displayFigures(row, field) {
    return calculatedFigures(row, field) || roundingFigures(metricDisplay(row, field));
  }

  // A value as the panel shows it (as the table does).
  function panelValueHtml(row, field) {
    const figures = displayFigures(row, field);
    return numberHtml(metricDisplay(row, field), figures ? { figures } : undefined);
  }

  // ---- Record panel: kcat/Km as the sources list it ----
  // A merged older record whose sources list their own kcat/Km: those values, by source and unit, in the source's name.
  const LISTED_EFFICIENCY_UNIT_KEYS = new Set(["s-1mm-1", "mm-1s-1", "1/mm1/s", "1/s1/mm", "1/mm/s", "1/(mms)", "1/(smm)"]);
  const sourceShortNames = { oed: "OED", brenda: "BRENDA", sabio_rk: "SABIO-RK", sabio: "SABIO-RK", skid: "SKiD", uniprot: "UniProt", strenda: "STRENDA DB" };

  function listedEfficiencyInCatalogUnit(unit) {
    return LISTED_EFFICIENCY_UNIT_KEYS.has(normalizedUnitKey(unit));
  }

  function sourceShortName(value) {
    const key = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    return sourceShortNames[key] || sourceDatabaseLabel(value);
  }

  function listedEfficiencies(summary, detail) {
    if (!summary.kcat_over_km_source_differs && !detail.kcat_over_km_source_differs) return [];
    const seen = new Set();
    return (Array.isArray(detail.source_kcat_over_km_values) ? detail.source_kcat_over_km_values : [])
      .filter((item) => {
        const key = item && item.value != null && Number.isFinite(Number(item.value))
          ? JSON.stringify([item.value, item.unit || "", item.source_db || ""])
          : "";
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  // A range of listed values to two significant figures (three when two would make its ends equal).
  function listedRangeText(values) {
    const low = Math.min(...values);
    const high = Math.max(...values);
    if (values.length === 1 || low === high) return numberText(String(low));
    let figures = 2;
    while (figures < 4 && numberText(low, { figures }) === numberText(high, { figures })) figures += 1;
    return `${numberText(low, { figures })}–${numberText(high, { figures })}`;
  }

  // "kcat/Km listed by OED: 3.0–6.1 s⁻¹ mM⁻¹ (5 values)", one line per source.
  function sourceEfficiencyRow(summary, detail) {
    const values = listedEfficiencies(summary, detail);
    if (!values.length) return "";
    const groups = new Map();
    values.forEach((item) => {
      const source = sourceShortName(item.source_db) || "the source";
      const catalogUnit = listedEfficiencyInCatalogUnit(item.unit);
      const unitKey = catalogUnit ? "catalog" : String(item.unit || "");
      const key = JSON.stringify([source, unitKey]);
      if (!groups.has(key)) groups.set(key, { source, unit: catalogUnit ? "s^(-1)*mM^(-1)" : String(item.unit || ""), values: [] });
      groups.get(key).values.push(Number(item.value));
    });
    const bySource = new Map();
    groups.forEach((group) => {
      const unit = group.unit ? ` ${unitHtml(group.unit)}` : ` ${unitMissingHtml()}`;
      const number = group.values.length === 1 ? numberHtml(String(group.values[0])) : escapePublic(listedRangeText(group.values));
      const count = group.values.length > 1 ? `<small>${formatInteger(group.values.length)} values</small>` : "";
      const html = `<span class="source-efficiency-value"><span>${number}${unit}</span>${count}</span>`;
      bySource.set(group.source, [...(bySource.get(group.source) || []), html]);
    });
    return [...bySource].map(([source, items]) => linkedKv(`kcat/Km listed by ${source}`, items.join(""))).join("");
  }

  // kcat ÷ Km against every kcat/Km the sources list (in catalog units): a note when all are more than 2-fold away.
  function listedEfficiencyNote(summary, detail, flags) {
    if ([...KCAT_KM_FLAGS].some((flag) => flags.has(flag))) return "";
    const listed = listedEfficiencies(summary, detail).filter((item) => listedEfficiencyInCatalogUnit(item.unit) && Number(item.value) > 0);
    if (!listed.length) return "";
    const kcat = Number(metricDisplay(summary, "kcat"));
    const km = Number(metricDisplay(summary, "km"));
    if (!(kcat > 0 && km > 0) || !canonicalMetricUnitKeys.kcat.has(normalizedUnitKey(metricUnit(summary, "kcat")))
      || !canonicalMetricUnitKeys.km.has(normalizedUnitKey(metricUnit(summary, "km")))) return "";
    const quotient = kcat / km;
    const folds = listed.map((item) => quotient / Number(item.value));
    if (!folds.every((fold) => fold > 2 || fold < 0.5)) return "";
    const above = folds.every((fold) => fold > 2);
    const below = folds.every((fold) => fold < 0.5);
    const sizes = folds.map((fold) => Math.max(fold, 1 / fold));
    const foldText = (value) => (value < 10 ? value.toFixed(1) : formatInteger(Math.round(value)));
    const low = Math.min(...sizes);
    const high = Math.max(...sizes);
    const fold = low.toFixed(1) === high.toFixed(1) || (low >= 10 && Math.round(low) === Math.round(high)) ? foldText(low) : `${foldText(low)}–${foldText(high)}`;
    const sources = [...new Set(listed.map((item) => sourceShortName(item.source_db) || "the source"))];
    const lists = `${sources.join(" and ")} ${sources.length > 1 ? "list" : "lists"}`;
    const unit = unitText("s^(-1)*mM^(-1)");
    const direction = above ? `${fold}-fold above` : (below ? `${fold}-fold below` : "more than 2-fold away from");
    return `kcat ÷ Km (${numberText(quotient, { figures: quotientFigures(summary) })} ${unit}) is ${direction} `
      + `${listed.length > 1 ? "every" : "the"} kcat/Km ${lists} for this record (${listedRangeText(listed.map((item) => Number(item.value)))}).`;
  }

  // ---- Record panel: flags ----
  // An older record whose stored kcat/Km is a unit factor away from kcat ÷ Km (flag kcat_over_km_unit_mismatch) while
  // the source also lists a kcat/Km in the same unit that agrees with kcat ÷ Km (within 10%): the panel shows that value.
  function consistentEfficiency(summary, detail, flags) {
    if (!flags.has("kcat_over_km_unit_mismatch")) return null;
    const check = kcatKmCheck(summary);
    if (!check) return null;
    const listed = (Array.isArray(detail.source_kcat_over_km_values) ? detail.source_kcat_over_km_values : [])
      .filter((item) => item && Number(item.value) > 0
        && canonicalMetricUnitKeys.kcat_over_km.has(normalizedUnitKey(item.unit))
        && Math.abs(Number(item.value) / check.quotient - 1) <= 0.1)
      .sort((a, b) => Math.abs(a.value / check.quotient - 1) - Math.abs(b.value / check.quotient - 1));
    return listed.length ? { value: listed[0].value, check } : null;
  }

  const metricNames = { kcat: "kcat", km: "Km", kcat_over_km: "kcat/Km", ki: "Ki" };
  const flagNoteTexts = {
    efficiency_above_diffusion_limit: "kcat/Km is above the diffusion limit; a unit may be wrong.",
  };

  // Each flag on the record once, as a plain sentence; the value it questions gets a marker that points to it. A
  // missing unit the values already show as "no unit" needs no second note.
  function flagNotes(summary, detail, flags, consistent) {
    const order = ["kcat", "km", "kcat_over_km"];
    const notes = [];
    [...flags]
      .map((flag) => ({ flag, field: valueIntegrityFlags[flag]?.field || "" }))
      .sort((a, b) => (a.field ? order.indexOf(a.field) : 9) - (b.field ? order.indexOf(b.field) : 9))
      .forEach(({ flag, field }) => {
        const unitField = (String(flag).match(/^unit_not_recorded_(\w+)$/) || [])[1];
        if (unitField && metricUnitMissing(summary, unitField, flags)) return;
        // With the source's own kcat/Km shown, the stored value's diffusion-limit flag is the same unit factor.
        if (consistent && flag === "efficiency_above_diffusion_limit") return;
        let text = magnitudeBound(flag, summary)?.note || flagNoteTexts[flag] || conditionFlagLabel(flag, summary, detail);
        if (unitField) text = `No unit is recorded for ${metricNames[unitField] || unitField}.`;
        if (consistent && KCAT_KM_FLAGS.has(flag)) {
          const { check } = consistent;
          text = `The stored kcat/Km (${numberText(metricDisplay(summary, "kcat_over_km"))} ${check.unit}) is `
            + `${check.foldText} ${check.direction} kcat ÷ Km (${check.quotientText} ${check.unit}). The source's own kcat/Km, `
            + `${numberText(consistent.value)} ${check.unit}${summary.kcat_over_km_source_differs || detail.kcat_over_km_source_differs ? " (listed above)" : ""}, `
            + "agrees with kcat ÷ Km and is shown above."
            + (check.factor ? ` ${check.factor[1]}` : "");
        }
        if (text && !notes.some((note) => note.text === text)) {
          notes.push({ id: `detailFlagNote${notes.length + 1}`, field, short: flagShortText(flag, summary), text });
        }
      });
    return notes;
  }

  // The marker beside a flagged value: a small "!" button that moves to its note (mouse, touch and keyboard).
  function flagMarkerHtml(field, notes) {
    const own = notes.filter((note) => note.field === field);
    if (!own.length) return "";
    const name = `${metricNames[field]}: ${[...new Set(own.map((note) => note.short).filter(Boolean))].join(", ")}. Show the note.`;
    return `<button class="value-flag" type="button" data-flag-note="${own[0].id}" aria-describedby="${own.map((note) => note.id).join(" ")}" aria-label="${escapeHtml(name)}" title="Show the note"></button>`;
  }

  function flagNotesHtml(notes) {
    if (!notes.length) return "";
    return `<ul class="flag-notes" aria-label="Notes on these values">${notes.map((note) => `<li id="${note.id}" tabindex="-1"><span class="value-flag" aria-hidden="true"></span><span>${escapeHtml(note.text)}</span></li>`).join("")}</ul>`;
  }

  function showFlagNote(id) {
    const note = $(id);
    if (!note) return;
    note.scrollIntoView?.({ block: "nearest" });
    note.focus?.({ preventScroll: true });
    note.classList.add("is-target");
    window.setTimeout(() => note.classList.remove("is-target"), 1600);
  }

  // ---- Record panel: the paper's values ----
  // A power of ten printed as the unit ("0.002" with "10^6 M^-1 min^-1") multiplies the number, as CatLog's converter
  // reads it: 0.002 × 10^6 M^-1 min^-1. Units that already carry the sign, or say more ("10^-6 × kcat/Km"), stay as printed.
  function printedValueText(value, unit) {
    const number = String(value ?? "").trim();
    const printedUnit = String(unit ?? "").trim();
    const times = /^10\^[({]?[−-]?\d+[)}]?\s+[A-Za-zµμ]/.test(printedUnit) && !/[×x]|kcat/i.test(printedUnit) ? " × " : " ";
    return [number, printedUnit].filter(Boolean).join(times);
  }

  // A CatLog v2 proof line's facts: from the fields CatLog writes (printed, printed_line, check, conversion) or, in older
  // data, from the two sentences it wrote before (same facts, fixed wording).
  // An AI audit of a value, from its own fields (audit_date, audit_result: "kept" or "unit corrected") or, in data written
  // before them, from the end of the check or of the reported sentence; null when the value was not audited.
  const AUDIT_CHECK_SUFFIX = /;\s*(unit corrected|re-checked) in an? (?:independent |AI )?audit \(([^()]+)\)\s*$/;
  const AUDIT_SENTENCE = /\s*An? (?:independent |AI )?audit re-checked it against the paper \(([^()]+)\)( and corrected its unit)?\.\s*$/;

  function v2LineFacts(line) {
    const clean = (value) => publicEvidenceString(String(value ?? "")).trim();
    let reported = clean(line.raw_value_unit_evidence);
    const normalized = clean(line.normalized_value_unit_evidence);
    let audit = clean(line.audit_date) || clean(line.audit_result)
      ? { date: clean(line.audit_date), result: clean(line.audit_result) }
      : null;
    const auditSentence = reported.match(AUDIT_SENTENCE);
    if (auditSentence) {
      reported = reported.slice(0, auditSentence.index);
      audit = audit || { date: auditSentence[1], result: auditSentence[2] ? "unit corrected" : "kept" };
    }
    let check = "check" in line ? clean(line.check) : "";
    const auditSuffix = check.match(AUDIT_CHECK_SUFFIX);
    if (auditSuffix) {
      check = check.slice(0, auditSuffix.index);
      audit = audit || { date: auditSuffix[2], result: auditSuffix[1] === "unit corrected" ? "unit corrected" : "kept" };
    }
    const result = reported.match(/A second, separate AI run (confirmed it|corrected: (.+?))\.?$/);
    const readAs = normalized.match(/in units of (.+)\)$/);
    return {
      printed: clean(line.printed) || printedValueText(line.raw_value, line.raw_unit),
      printedLine: "printed_line" in line ? clean(line.printed_line) : ((reported.match(/in the line “(.+)”/) || [])[1] || ""),
      check: "check" in line ? check : (result ? (result[2] ? `corrected: ${result[2]}` : "confirmed") : ""),
      conversion: "conversion" in line
        ? clean(line.conversion)
        : (/converted by code/.test(normalized) ? "converted by code" : (readAs ? `printed unit read as ${readAs[1]}` : "")),
      audit,
    };
  }

  // "11 Oct 2026" from an ISO date (or the text as it is).
  function auditDateText(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return String(value || "").trim();
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return Number.isNaN(date.getTime())
      ? String(value).trim()
      : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }

  // The AI audit line: the date and the verdict only ("11 Oct 2026: re-checked against the paper and kept."), naming
  // the values when the audit did not cover them all alike.
  function v2AuditText(lines, facts) {
    const groups = new Map();
    facts.forEach((fact, index) => {
      if (!fact.audit) return;
      const key = JSON.stringify([fact.audit.date, fact.audit.result]);
      if (!groups.has(key)) groups.set(key, { ...fact.audit, metrics: [] });
      groups.get(key).metrics.push(lines[index].metric);
    });
    if (!groups.size) return "";
    const everyValueAlike = groups.size === 1 && facts.every((fact) => fact.audit);
    return [...groups.values()].map(({ date, result, metrics }) => {
      const verdict = /^unit corrected$/i.test(result)
        ? "re-checked against the paper; the unit was corrected."
        : (/^kept$/i.test(result) ? "re-checked against the paper and kept." : "re-checked against the paper.");
      const names = everyValueAlike ? "" : `${[...new Set(metrics)].join(" and ").replace(/ and (?=.* and )/g, ", ")} `;
      const when = auditDateText(date);
      const text = `${when ? `${when}: ` : ""}${names}${verdict}`;
      return text.charAt(0).toUpperCase() + text.slice(1);
    }).join(" ");
  }

  // ---- Record panel: a printed unit CatLog did not use ----
  // The concentration prefix of a unit (n, µ, m, "" for molar, p), or null when it names no molar concentration.
  const CONCENTRATION_UNIT = /(?:^|[^A-Za-z])(n|µ|μ|u|m|p)?M(?![a-z])/;
  const CONCENTRATION_POWER = { p: -12, n: -9, "µ": -6, m: -3, "": 0 };

  function concentrationPrefix(unit) {
    const match = String(unit || "").match(CONCENTRATION_UNIT);
    if (!match) return null;
    const prefix = match[1] || "";
    return prefix === "μ" || prefix === "u" ? "µ" : prefix;
  }

  function foldWords(power) {
    if (power === 3) return "1000-fold";
    return `10${[...String(power)].map((character) => SUPERSCRIPT_DIGITS[character] ?? character).join("")}-fold`;
  }

  // Values whose printed concentration unit (µM) is not the unit CatLog read the number in (mM): an amber note each. When
  // only one value was read that way and the record has a printed kcat, Km and kcat/Km, kcat ÷ Km shows which unit is
  // right; otherwise the note says it cannot.
  function unitPrefixCautions(summary, proof) {
    if (!proof) return [];
    const metricOf = (line) => (v2MetricLabels[line.metric] || [""])[0];
    const changed = proof.lines.map((line, index) => {
      const fact = proof.facts[index];
      const readAs = (String(fact.conversion || "").match(/printed unit read as (.+)$/) || [])[1] || "";
      const printedUnit = String(line.raw_unit || "").trim() || fact.printed;
      const printedPrefix = concentrationPrefix(printedUnit);
      const usedPrefix = concentrationPrefix(readAs);
      if (!readAs || printedPrefix === null || usedPrefix === null || printedPrefix === usedPrefix) return null;
      return { line, fact, field: metricOf(line), readAs, printedUnit, power: Math.abs(CONCENTRATION_POWER[printedPrefix] - CONCENTRATION_POWER[usedPrefix]) };
    }).filter((item) => item && item.field);
    if (!changed.length) return [];
    const printedMetrics = new Set(proof.lines.map((line) => line.metric));
    const check = kcatKmCheck(summary);
    const confirmed = changed.length === 1 && check && check.fold < 1.3
      && ["kcat", "Km", "kcat/Km"].every((metric) => printedMetrics.has(metric));
    return changed.map(({ line, fact, field, readAs, printedUnit, power }) => {
      const printed = unitText(printedUnit);
      const used = unitText(readAs);
      const metric = metricNames[field];
      let text;
      if (confirmed && field === "kcat_over_km") {
        // kcat ÷ Km in the unit CatLog used: the stored quotient times what the printed number gains in that unit.
        const printedNumber = (String(line.raw_value ?? "").match(/[+-]?\d*\.?\d+(?:[eE][+-]?\d+)?/) || [""])[0];
        const stored = Number(metricDisplay(summary, "kcat_over_km"));
        const inUsedUnit = Number(printedNumber) > 0 && stored > 0 ? check.quotient * (Number(printedNumber) / stored) : NaN;
        text = Number.isFinite(inUsedUnit)
          ? `The paper prints ${printed}; CatLog uses ${used}, the unit in which the printed kcat/Km (${numberText(printedNumber)}) `
            + `agrees with kcat ÷ Km (${numberText(inUsedUnit, { figures: quotientFigures(summary) })}).`
          : `The paper prints ${printed}; CatLog uses ${used}, the unit in which the printed kcat/Km agrees with kcat ÷ Km.`;
      } else if (confirmed) {
        text = `The paper prints ${printed}; CatLog uses ${used}, the unit in which kcat ÷ Km (${check.quotientText} ${check.unit}) `
          + `agrees with the paper's kcat/Km (${numberText(metricDisplay(summary, "kcat_over_km"))} ${check.unit}).`;
      } else {
        const verb = /converted by code/.test(fact.conversion) ? "uses" : "stores";
        text = `The paper prints ${printed}; CatLog ${verb} ${used}, ${foldWords(power)} apart, and kcat ÷ Km cannot show which is right.`;
      }
      return { field, metric, text, printed, used };
    });
  }

  // A CatLog v2 record's values, one row each: as printed, as stored in the catalog's units ("converted by code" when code
  // converted it) and what the second AI run found; under it each printed line once, with where it is printed. Facts
  // only (where, what was printed, what was corrected, how it was converted), never reasoning.
  const v2MetricLabels = {
    kcat: ["kcat", "<i>k</i><sub>cat</sub>"],
    Km: ["km", "<i>K</i><sub>m</sub>"],
    "kcat/Km": ["kcat_over_km", "<i>k</i><sub>cat</sub>/<i>K</i><sub>m</sub>"],
  };

  // Where a proof line's value is printed ("Table 2", "Table 2, row 3").
  function v2LinePlace(line) {
    return [line.table_label, line.row_label].map((value) => publicEvidenceString(String(value ?? "")).trim()).filter(Boolean).join(", ");
  }

  // A CatLog v2 record's proof lines and their facts, in kcat, Km, kcat/Km order; null for an older record (its notes
  // are the earlier review's text).
  function v2ProofFacts(summary, detail) {
    const v2Record = isV2Row(summary) || String(detail.verification_method || "").startsWith(v2Method);
    const lines = (Array.isArray(detail.proof_lines) ? detail.proof_lines : []).filter(Boolean);
    if (!v2Record || !lines.length || !lines.every((line) => typeof line === "object" && line.metric)) return null;
    const order = Object.keys(v2MetricLabels);
    const rank = (line) => (order.includes(line.metric) ? order.indexOf(line.metric) : order.length);
    const sorted = [...lines].sort((a, b) => rank(a) - rank(b));
    return { lines: sorted, facts: sorted.map(v2LineFacts) };
  }

  // The values as the paper prints them, in Measurement right under the values: one row per value, "As printed" and
  // "In catalog units" (with how code converted it); a Check column only when the values' results differ (one result for
  // all is said once, in Paper and review). The place is in the heading when every value shares it.
  function v2ValuesHtml(summary, lines, facts = lines.map(v2LineFacts), cautions = [], context = {}) {
    const text = (value) => caretHtml(escapePublic(value));
    const places = new Set(lines.map(v2LinePlace));
    const shared = places.size === 1 ? [...places][0] : "";
    const checks = facts.some((fact) => fact.check) && !v2SharedCheck(facts, context);
    const rows = lines.map((line, index) => {
      const fact = facts[index];
      const [field, label] = v2MetricLabels[line.metric] || ["", escapePublic(line.metric)];
      const clean = (value) => publicEvidenceString(String(value ?? "")).trim();
      const stored = field && metricHasValue(summary, field)
        ? `${numberHtml(metricDisplay(summary, field))} ${unitHtml(metricUnit(summary, field))}`
        : `${numberHtml(clean(line.normalized_value))} ${unitHtml(clean(line.normalized_unit))}`;
      const place = !shared && v2LinePlace(line) ? `<small>${escapePublic(v2LinePlace(line))}</small>` : "";
      // A unit CatLog did not take from the paper: amber, beside the value (its note is under the values).
      const caution = cautions.find((item) => item.field === field);
      const conversion = caution ? String(fact.conversion || "").replace(/,?\s*printed unit read as .+$/, "") : fact.conversion;
      const how = (conversion ? `<small>${text(conversion)}</small>` : "")
        + (caution ? `<small class="unit-caution"><span class="value-flag" aria-hidden="true"></span>${escapePublic(`CatLog uses ${caution.used}, not the printed ${caution.printed}`)}</small>` : "");
      return `<tr><th scope="row">${label}</th><td>${text(fact.printed)}${place}</td><td>${stored.trim()}${how}</td>${checks ? `<td>${text(valueCheckText(fact, context))}</td>` : ""}</tr>`;
    }).join("");
    // Each printed line once; a "line" that is only the printed number itself adds nothing.
    const notes = lines.map((line, index) => [v2LinePlace(line), facts[index].printedLine, facts[index].printed])
      .filter(([, printedLine, printed], index, all) => printedLine && !printed.startsWith(printedLine)
        && all.findIndex(([, other]) => other === printedLine) === index)
      .map(([place, printedLine]) => printedLineNoteHtml(place, printedLine));
    const heading = `As printed in the paper${shared ? ` (${shared})` : ""}`;
    return `<div class="detail-values"><h4>${escapePublic(heading)}</h4>`
      + `<table class="values-table"><thead><tr><th scope="col">Value</th><th scope="col">As printed</th><th scope="col">In catalog units</th>${checks ? '<th scope="col">AI check</th>' : ""}</tr></thead><tbody>${rows}</tbody></table>`
      + notes.join("")
      + "</div>";
  }

  // A line quoted from the paper's text, as extraction left it, made readable: table markers ([rowspan]) go, _{...} and
  // ^{...} become sub- and superscripts, K_M and k_cat read as K<sub>m</sub> and k<sub>cat</sub>, and LaTeX symbols
  // their characters. The characters themselves are not changed.
  function printedLineHtml(value) {
    const text = String(value ?? "")
      .replace(/\s*\[(?:rowspan|colspan)[^\]]*\]/gi, "")
      .replace(/\\pm\b\s*/g, "± ")
      .replace(/\\times\b\s*/g, "× ")
      .replace(/\\(?:mu|micro)\b\s*/g, "µ")
      .replace(/\$/g, "");
    const sub = (content) => content.replace(/^M(?=$|\s)/, "m");
    return caretHtml(escapePublic(text)
      .replace(/\b([Kk])_\{((?:cat|m|M|i|d)\b[^{}]*)\}/g, (_match, letter, content) => `<i>${letter}</i><sub>${sub(content)}</sub>`)
      .replace(/\b([Kk])_(cat|m|M|i|d)\b/g, (_match, letter, content) => `<i>${letter}</i><sub>${sub(content)}</sub>`)
      .replace(/_\{([^{}]{1,24})\}/g, "<sub>$1</sub>")
      .replace(/\^\{([^{}]{1,12})\}/g, "<sup>$1</sup>"));
  }

  // Where the line is, "Table 2 row" for a table, then the line; a long table row (more than four cells) or one whose
  // ± signs extraction dropped ("1.1 ( 0.070") is folded away, with that warning.
  function printedLineNoteHtml(place, printedLine) {
    const where = /^(?:supplementary )?table\s+\S+$/i.test(place) ? `${place} row` : place;
    const label = `${where ? `${where}, as` : "As"} extracted from the paper’s text:`;
    const quote = `<p class="evidence-note-plain">${escapePublic(label)} “${printedLineHtml(printedLine)}”</p>`;
    const cells = String(printedLine).split("|").length;
    if (cells <= 4 && !/\d \( \d/.test(printedLine)) return quote;
    return `<details class="printed-line-disclosure"><summary>Show the line as extracted</summary>${quote}`
      + `<p class="printed-line-note">Text extraction can drop symbols such as ±.</p></details>`;
  }

  // ---- Record panel: what the AI check found ----
  // A check ("confirmed", "corrected: <what>; <what>", or plain phrases) as phrases that give the new state: those about
  // a value ("unit set to mM") and those about the whole record ("EC 2.7.2.12 removed"). Older data name the fields
  // ("unit used for the conversion (was none, now mM)"); they are said the same way.
  const CHECK_FIELD_PHRASES = [
    [/^unit used for the conversion \(was (.*), now (.*)\)$/, (was, now) => (now === "none" ? "unit for the conversion removed" : `unit set to ${now}`)],
    [/^printed unit \(was (.*), now (.*)\)$/, (was, now) => `printed unit corrected to ${now}`],
    [/^printed value \(was (.*), now (.*)\)$/, (was, now) => `printed value corrected to ${now}`],
    [/^qualifier \(apparent, Hill fit or similar\)$/, () => "qualifier corrected"],
    [/^(?:location in the paper|printed line)$/, () => "location in the paper corrected"],
    [/^EC number \(was (.*), now (.*)\)$/, (was, now) => (now === "none" ? `EC ${was} removed` : (was === "none" ? `EC ${now} added` : `EC corrected to ${now}`))],
    [/^pH \(was (.*), now (.*)\)$/, (was, now) => (now === "not printed" ? "pH removed (not printed in the paper)" : `pH corrected to ${now}`)],
    [/^temperature \(was (.*), now (.*)\)$/, (was, now) => (now === "not printed" ? "temperature removed (not printed in the paper)" : `temperature corrected to ${now} °C`)],
    [/^enzyme variant \(was (.*), now (.*)\)$/, (was, now) => (now === "none" ? "variant removed" : `variant corrected to ${now}`)],
    [/^organism \(was (.*), now (.*)\)$/, (was, now) => `organism corrected to ${now}`],
    [/^substrate name$/, () => "substrate name corrected"],
    [/^cosubstrate$/, () => "cosubstrate corrected"],
    [/^construct description$/, () => "construct description corrected (see Preparation)"],
    [/^assay conditions$/, () => "assay conditions corrected (see Conditions)"],
    [/^protein IDs$/, () => "UniProt ID corrected"],
  ];
  const VALUE_CHECK_PHRASE = /^(?:unit\b|printed (?:unit|value)\b|qualifier\b|location in the paper\b)/i;

  function checkPhrases(check, { hasPreparation = true, hasConditions = true } = {}) {
    const text = String(check || "").trim();
    if (!text || /^confirmed$/i.test(text)) return { value: [], record: [] };
    const items = text.replace(/^corrected(?::\s*|$)/i, "").split(/;\s*/).map((item) => item.trim().replace(/\.$/, "")).filter(Boolean);
    const phrases = items.length ? items.map((item) => {
      const known = CHECK_FIELD_PHRASES.find(([pattern]) => pattern.test(item));
      return known ? known[1](...item.match(known[0]).slice(1)) : item;
    }) : ["corrected"];
    const placed = phrases
      .map((phrase) => (hasPreparation ? phrase : phrase.replace(/ \(see Preparation\)$/, "")))
      .map((phrase) => (hasConditions ? phrase : phrase.replace(/ \(see Conditions\)$/, "")));
    const unique = [...new Set(placed)];
    return { value: unique.filter((phrase) => VALUE_CHECK_PHRASE.test(phrase)), record: unique.filter((phrase) => !VALUE_CHECK_PHRASE.test(phrase)) };
  }

  // A record-level phrase as the AI check's action: "EC 2.7.2.12 removed" -> "removed EC 2.7.2.12", "assay conditions
  // corrected (see Conditions)" -> "corrected the assay conditions (see Conditions)".
  function checkAction(phrase) {
    let match = phrase.match(/^(EC \S+) (removed|added)$/);
    if (match) return `${match[2]} ${match[1]}`;
    match = phrase.match(/^EC corrected to (.+)$/);
    if (match) return `corrected the EC number to ${match[1]}`;
    match = phrase.match(/^(.+?) (corrected|removed|added)(?: (to .+?))?( \(.+\))?$/);
    if (match) return `${match[2]} the ${match[1]}${match[3] ? ` ${match[3]}` : ""}${match[4] || ""}`;
    return phrase;
  }

  function sentenceList(items) {
    return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
  }

  // The value-level result a value's Check cell shows: "Confirmed" or what was changed.
  function valueCheckText(fact, context) {
    const { value } = checkPhrases(fact.check, context);
    const text = value.length ? value.join("; ") : (fact.check ? "confirmed" : "");
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
  }

  // The value-level result when it is the same for every value, else "".
  function v2SharedCheck(facts, context) {
    const results = new Set(facts.map((fact) => valueCheckText(fact, context)));
    return results.size === 1 ? [...results][0] : "";
  }

  // The Check line: one result for every value (or a pointer to the Check column when they differ), then once what the
  // AI check changed on the record, and, when a value carries a caution, where its note is.
  function v2CheckText(facts, { context = {}, cautionFields = [] } = {}) {
    if (!facts.some((fact) => fact.check)) return "";
    const shared = v2SharedCheck(facts, context);
    const note = cautionFields.length
      ? `see the ${cautionFields.length > 1 ? "notes" : "note"} on ${sentenceList(cautionFields.map((field) => metricNames[field]))}`
      : "";
    let head;
    if (!shared) head = "The results differ by value: see the AI check column under the values.";
    else if (shared === "Confirmed") head = note ? `All values confirmed as printed; ${note}.` : "All values confirmed.";
    else head = `${shared} for every value.`;
    if (note && shared !== "Confirmed") head += ` See the ${cautionFields.length > 1 ? "notes" : "note"} on ${sentenceList(cautionFields.map((field) => metricNames[field]))}.`;
    const record = [...new Set(facts.flatMap((fact) => checkPhrases(fact.check, context).record))];
    // "corrected the cosubstrate and corrected the assay conditions" reads "corrected the cosubstrate and the assay conditions".
    const actions = record.map(checkAction).reduce((merged, action) => {
      const verb = (action.match(/^(?:corrected|removed|added) the /) || [""])[0];
      const last = merged.at(-1);
      if (verb && last?.verb === verb) last.objects.push(action.slice(verb.length));
      else merged.push({ verb, objects: [verb ? action.slice(verb.length) : action] });
      return merged;
    }, []).map(({ verb, objects }) => `${verb}${sentenceList(objects.map((object, index) => (index && verb ? `the ${object}` : object)))}`);
    return actions.length ? `${head} The AI check also ${sentenceList(actions)}.` : head;
  }

  // ---- Record panel: measurement and assay conditions ----
  // Two sections: Measurement (the values, each caution once, then, for a record read from the paper, the values as
  // printed) and Assay conditions (cosubstrate, temperature, pH, the other conditions and the preparation).
  // The record's values with the Ki fields of its detail.
  function metricSummaryFor(summary, detail) {
    return {
      ...summary,
      has_ki: detail.has_ki ?? summary.has_ki,
      ki_display: detail.ki_display ?? summary.ki_display,
      ki_unit: detail.ki_unit ?? summary.ki_unit,
    };
  }

  // Every note under the values, each once: the flags, the sources' listed kcat/Km, a printed unit CatLog did not use.
  function measurementNotes(summary, detail, { proof = v2ProofFacts(summary, detail) } = {}) {
    const metricSummary = metricSummaryFor(summary, detail);
    const flags = conditionFlags(summary, detail);
    const consistent = consistentEfficiency(metricSummary, detail, flags);
    const unitCautions = unitPrefixCautions(metricSummary, proof);
    const notes = flagNotes(metricSummary, detail, flags, consistent);
    const listedNote = listedEfficiencyNote(metricSummary, detail, flags);
    if (listedNote) notes.push({ id: `detailFlagNote${notes.length + 1}`, field: "kcat_over_km", short: "listed values differ", text: listedNote });
    unitCautions.forEach(({ field, text }) => {
      notes.push({ id: `detailFlagNote${notes.length + 1}`, field, short: "printed unit differs", text });
    });
    return { notes, unitCautions, consistent, flags };
  }

  function measurementSection(summary, detail) {
    const metricSummary = metricSummaryFor(summary, detail);
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
      ["<i>k</i><sub>cat</sub>", "kcat"],
      ["<i>K</i><sub>m</sub>", "km"],
      ["<i>k</i><sub>cat</sub>/<i>K</i><sub>m</sub>", "kcat_over_km"],
    ];
    if (metricSummary.has_ki) metrics.push(["<i>K</i><sub>i</sub>", "ki"]);
    // A record read from the paper: its values as printed, right under the values they give.
    const proof = v2ProofFacts(summary, detail);
    const { notes, unitCautions, consistent } = measurementNotes(summary, detail, { proof });
    const conditions = conditionLines(publicEvidenceString(detail.assay_conditions_summary), summary);
    const checkContext = { hasPreparation: Boolean(conditions.preparation), hasConditions: Boolean(conditions.conditions) };
    // A record with three dashes says so in words (some keep a Ki only).
    const noKinetics = ["kcat", "km", "kcat_over_km"].every((field) => !metricHasValue(metricSummary, field));
    const emptyNote = !noKinetics
      ? ""
      : (metricSummary.has_ki && metricHasValue(metricSummary, "ki")
          ? "This record stores a Ki (inhibition constant) only, no kcat, Km or kcat/Km."
          : "No kcat, Km or kcat/Km is stored for this record.");
    // The header shows the substrate; a long name it cuts short is given in full here.
    const substrate = String(summary.substrate_name || "").trim();
    // A merged older record's kcat/Km values as its sources list them, under the values.
    const listed = sourceEfficiencyRow(summary, detail);
    return `
      <section class="detail-section measurement-section">
        <h3>Measurement</h3>
        <div class="measurement-strip${metrics.length > 3 ? " has-ki" : ""}">
          ${metrics.map(([label, field]) => {
            const unitMissing = metricUnitMissing(metricSummary, field, flags);
            // A non-catalog stored unit goes after the value, like in the table; the label then shows none.
            const storedUnit = !unitMissing && storedUnitDiffers(metricSummary, field);
            const unit = unitMissing || storedUnit ? "" : metricUnitHtml(metricSummary, field);
            const value = field === "kcat_over_km" && consistent ? numberHtml(consistent.value) : panelValueHtml(metricSummary, field);
            return `
            <div class="measurement-value${unitMissing ? " unit-missing" : ""}">
              <span>${label}${unitMissing ? unitMissingHtml() : `<small>${unit || "&nbsp;"}</small>`}${field === "kcat_over_km" ? efficiencyOriginHtml(summary) : ""}</span>
              <strong>${value}${storedUnit ? storedUnitHtml(metricSummary, field) : ""}${flagMarkerHtml(field, notes)}</strong>
            </div>
          `;
          }).join("")}
        </div>
        ${listed ? `<div class="detail-kv measurement-listed">${listed}</div>` : ""}
        ${emptyNote ? `<p class="measurement-empty-note">${escapeHtml(emptyNote)}</p>` : ""}
        ${flagNotesHtml(notes)}
        ${proof ? v2ValuesHtml(summary, proof.lines, proof.facts, unitCautions, checkContext) : ""}
      </section>
      <section class="detail-section conditions-section">
        <h3>Assay conditions</h3>
        <div class="detail-kv">
          ${substrate.length > LONG_DETAIL_SUBSTRATE ? kv("Substrate", substrate) : ""}
          ${conditions.cosubstrate}
          ${kv("Temperature", temperatureValue)}
          ${kv("pH", phValue)}
          ${conditions.conditions}
          ${conditions.preparation}
        </div>
      </section>
    `;
  }

  // An assay summary, split at "; " outside brackets.
  function conditionSegments(text) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (character === "(" || character === "[") depth += 1;
      else if ((character === ")" || character === "]") && depth > 0) depth -= 1;
      else if (character === ";" && depth === 0 && text[index + 1] === " ") {
        parts.push(text.slice(start, index));
        start = index + 2;
      }
    }
    parts.push(text.slice(start));
    return parts.map((part) => part.trim()).filter(Boolean);
  }

  // Assay conditions as short labelled lines: "cosubstrate X" / "cofactor X" and "preparation: ..." get their own line,
  // the rest is a short list; a pH or temperature that only repeats the lines above ("pH 7.5", "298.15 K") is left out.
  function conditionLines(text, summary = {}) {
    const cosubstrates = [];
    const cofactors = [];
    const preparations = [];
    const rest = [];
    const qualified = new Map();
    const ph = formatPh(summary);
    const temperature = formatTemperature(summary);
    conditionSegments(String(compactValue(text) === EMPTY_VALUE ? "" : compactValue(text)).trim()).forEach((segment) => {
      let match = segment.match(/^preparation:\s*(.+)$/i);
      if (match) {
        preparations.push(match[1]);
        return;
      }
      match = segment.match(/^(cosubstrates?|cofactors?):?\s+(.+)$/i);
      if (match) {
        (/^cof/i.test(match[1]) ? cofactors : cosubstrates).push(match[2]);
        return;
      }
      // Per-value qualifiers ("apparent kcat", "apparent Km") become one item: "apparent kcat, Km".
      match = segment.match(/^(apparent|estimated|approximate) (kcat|Km|kcat\/Km)$/);
      if (match) {
        if (!qualified.has(match[1])) {
          qualified.set(match[1], { qualifier: match[1], metrics: [] });
          rest.push(qualified.get(match[1]));
        }
        qualified.get(match[1]).metrics.push(match[2]);
        return;
      }
      // Older data list "printed kcat/Km differs from kcat ÷ Km by N×" here; the flag note under the values says it.
      if (/^printed kcat\/Km differs from kcat ÷ Km by /.test(segment)) return;
      match = segment.match(/^pH\s*(\d+(?:\.\d+)?)$/i);
      if (match && ph !== EMPTY_VALUE && Number(match[1]) === Number(ph)) return;
      match = segment.match(/^(\d+(?:\.\d+)?)\s*K$/);
      if (match && temperature !== EMPTY_VALUE && formatNumber(Number(match[1]) - 273.15, { maximumFractionDigits: 1 }) === temperature) return;
      rest.push(segment);
    });
    const items = rest.map((item) => (typeof item === "string" ? item : `${item.qualifier} ${item.metrics.join(", ")}`));
    const html = (value) => caretHtml(escapePublic(value));
    return {
      cosubstrate: (cosubstrates.length ? linkedKv("Cosubstrate", html(cosubstrates.join("; "))) : "")
        + (cofactors.length ? linkedKv("Cofactor", html(cofactors.join("; "))) : ""),
      conditions: !items.length
        ? ""
        : (items.length === 1
          ? linkedKv("Conditions", html(items[0]))
          : `<div class="kv-line"><span>Conditions</span><ul class="condition-list">${items.map((item) => `<li>${html(item)}</li>`).join("")}</ul></div>`),
      preparation: preparations.length ? linkedKv("Preparation", html(preparations.join("; "))) : "",
    };
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
    const sequenceVariantNote = sequenceNoteText(detail.sequence_variant_note || summary.sequence_variant_note, enzymeForm);
    const sequenceSourceValue = detail.sequence_source || summary.sequence_source;
    const accessionLabel = proteinAccessionDatabase === "UniProt"
      ? "UniProt"
      : (proteinAccessionDatabase === "NCBI Protein" ? "NCBI Protein" : "Protein accession");
    const sequenceHtml = variantSequence
      ? `${sequenceDisclosure("Wild-type sequence", wildTypeSequence, "detailWildTypeSequence")}${sequenceDisclosure("Variant sequence", variantSequence, "detailVariantSequence")}`
      : sequenceDisclosure(wildTypeSequence ? "Wild-type sequence" : "Protein sequence", wildTypeSequence || sequence, "detailSequence");
    // "UniProt", "UniProt accession" or "UniProt P12345" only repeats the UniProt line above it.
    const sequenceSourceText = showsSequenceSource(sequenceSourceValue, Boolean(sequenceHtml.trim()))
      ? sequenceSourceLabel(sequenceSourceValue)
      : "";
    const sequenceSource = accessionLabel === "UniProt" && ["UniProt", "UniProt accession", `UniProt ${proteinAccession}`].includes(sequenceSourceText)
      ? ""
      : sequenceSourceText;
    return `
      <section class="detail-section identity-section">
        <h3>Protein and structure</h3>
        <div class="detail-kv">
          ${kv("Enzyme form", enzymeForm)}
          ${sequenceVariantNote ? kv("Sequence note", sequenceVariantNote) : ""}
          ${proteinAccession ? linkedKv(accessionLabel, proteinAccessionLink(proteinAccession, proteinAccessionDatabase)) : ""}
          ${sourceProteinAccession ? kv("Source-listed accession", sourceProteinAccession) : ""}
          ${!proteinAccession && accessionCandidates.length ? linkedKv("Candidate UniProt IDs", referenceList(accessionCandidates, uniprotLink)) : ""}
          ${sequenceSource ? kv("Sequence source", sequenceSource) : ""}
          ${!sequenceHtml.trim() && !/sequence/i.test(sequenceVariantNote || "") ? kv("Sequence", "None recorded") : ""}
          ${smiles ? "" : kv("SMILES", "None recorded")}
        </div>
        ${sequenceHtml}
        ${smiles ? `
          <details class="sequence-disclosure">
            <summary>SMILES</summary>
            <div class="copy-field">
              <div class="copy-field-heading">
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

  // The databases a record merges, unless that only repeats its Source.
  function mergedDatabasesRow(summary, detail) {
    const names = [...new Set((detail.source_databases_merged || []).map(sourceDatabaseLabel))];
    if (!names.length || (names.length === 1 && names[0] === sourceDatabaseLabel(summary.source_db || detail.source_db))) return "";
    return kv("Databases", names.join(", "));
  }

  function detailDisclosure(title, rows) {
    return `
      <details class="detail-disclosure">
        <summary>${escapeHtml(title)}</summary>
        <div class="detail-kv">${rows.filter(Boolean).join("")}</div>
      </details>
    `;
  }

  // Plain-text unit for an e-mail: s^(-1)*mM^(-1) -> s^-1 mM^-1.
  function plainUnit(value) {
    return String(value || "").replace(/\^\(([−-]?\d+(?:\.\d+)?)\)/g, "^$1").replace(/\*/g, " ").trim();
  }

  // "Report a problem": an e-mail to the lab with the record ID, the snapshot and the values shown.
  function reportProblemHref(summary, pmids, { dois = [], standInIds = [] } = {}) {
    const key = summary.record_key || summary.measurement_key || "";
    const values = [["kcat", "kcat"], ["km", "Km"], ["kcat_over_km", "kcat/Km"]]
      .filter(([field]) => metricHasValue(summary, field))
      .map(([field, label]) => [label, metricDisplay(summary, field), plainUnit(metricUnit(summary, field))].filter(Boolean).join(" "));
    const about = [
      summary.enzyme_display_name,
      summary.organism,
      summary.substrate_name,
      ...values,
      pmids.length ? `PMID ${pmids.slice(0, 5).join(", ")}${pmids.length > 5 ? ` and ${pmids.length - 5} more` : ""}` : "",
      // Without a PMID the paper is named by its DOI (and a paper's stand-in ID).
      pmids.length ? "" : [...dois.slice(0, 3).map((doi) => `DOI ${doi}`), ...standInIds.slice(0, 3).map((id) => `paper ${id}`)].join(", "),
    ].map((part) => String(part || "").trim()).filter(Boolean).join("; ");
    const snapshot = manifest.generated_at ? String(manifest.generated_at).slice(0, 10) : "";
    const dataId = shortHash(manifest.content_sha256 || manifest.source_sha256);
    const body = `Record ${key}, CatLog snapshot ${snapshot} (data ID ${dataId}): ${about}.\n\nWhat looks wrong:\n`;
    return `mailto:ratul@iastate.edu?cc=supantha@iastate.edu&subject=${encodeURIComponent(`CatLog record ${key}`)}&body=${encodeURIComponent(body)}`;
  }

  // ---- Record panel: header and source details ----
  // The record's status as one line, in the table's words and colours: a dot, the review result (a Not checked record
  // keeps its exact earlier status in brackets, "Not checked (Unverified)"), the source ("from paper", "BRENDA", ...), then
  // "corrected", "no paper linked" or "human-checked".
  function detailStatusHtml(row, { v2Record = isV2Row(row) } = {}) {
    const config = stateConfig(row._recordState || recordStateForRow(row));
    const status = row.verification_status;
    const identityOnly = isIdentityOnlyAccepted(row);
    const colour = { accepted: "accepted", curation_pending: "pending", disputed: "disputed" }[config.value] || "unverified";
    const words = [
      rowStatusLabel(row, { exact: true }),
      v2Record ? "from paper" : sourceTagText(row),
      status === "corrected" ? "corrected" : "",
      identityOnly ? "no paper linked" : "",
    ].filter(Boolean);
    const checkedHtml = isHumanChecked(row) ? `<span class="detail-status-checked">${CHECK_ICON_HTML}human-checked</span>` : "";
    return `<p class="detail-status" style="--status-color:var(--status-${colour})">${words.map((word, index) => `<span${index ? "" : ' class="detail-status-word"'}>${escapeHtml(word)}</span>`).join("")}${checkedHtml}</p>`;
  }

  // The record's name; a long one (several names in brackets) is set smaller, so the header that stays in view while the
  // record scrolls does not fill the panel. The whole name is always shown.
  const LONG_DETAIL_NAME = 64;
  function detailHeadingHtml(row) {
    const name = String(row.enzyme_display_name || "").trim() || "Enzyme name not recorded";
    return `<h2 id="detailHeading" tabindex="-1"${name.length > LONG_DETAIL_NAME ? ' class="long-name"' : ""}>${escapePublic(name)}</h2>`;
  }

  // The variant as the header names it: "N145A variant", "variant, not specified", or nothing for wild type (and for a
  // record that does not say).
  function detailVariantText(row) {
    const signature = mutationSignature(row);
    if (signature) return `${signature} variant`;
    return enzymeFormLabel(row) === "Variant (unspecified)" ? "variant, not specified" : "";
  }

  // "EC 1.4.1.20 · Bacillus sphaericus · N145A variant", leaving out what is not recorded, so records of one paper
  // differ at the top; "Unknown" (not stated in the paper or the source database) says which of the two it is.
  function detailSubtitleHtml(row, { ecFromDatabases = false } = {}) {
    const ec = String(row.ec_number || "").trim();
    const organism = String(row.organism || "").trim();
    // A record read from a paper that prints no EC number: the EC the enzyme databases list for this paper's values.
    const ecNote = ecFromDatabases ? " (from enzyme databases; not printed in the paper)" : "";
    const parts = [
      /^unknown$/i.test(ec) ? "EC unknown" : (hasDisplayValue(ec) ? `EC ${ec}${ecNote}` : ""),
      /^unknown$/i.test(organism) ? "organism unknown" : (hasDisplayValue(organism) ? organism : ""),
      detailVariantText(row),
    ].filter(Boolean);
    return parts.length ? `<p class="detail-subtitle">${parts.map(escapePublic).join(" &middot; ")}</p>` : "";
  }

  // "Substrate: ...", under the EC line. A long name is cut to two lines here and given in full under Assay conditions.
  const LONG_DETAIL_SUBSTRATE = 90;
  function detailSubstrateHtml(row, detail = {}) {
    const text = String(row.substrate_name || "").trim();
    const name = hasDisplayValue(text) && !/^unknown$/i.test(text) ? text : "Not recorded";
    // What tells this record from others of its paper that read the same (condition_note), in grey under it.
    const note = conditionNoteText(row, detail);
    return `<p class="detail-substrate"><span>Substrate:</span> <span class="detail-substrate-name">${escapePublic(name)}</span></p>`
      + (note ? `<p class="detail-condition-note">${escapePublic(note)}</p>` : "");
  }

  // One licence line: CatLog's own compilation for a CatLog v2 record, otherwise the source database's terms.
  function detailLicense(summary, detail, v2Record) {
    if (v2Record) return "CC BY 4.0 (CatLog compilation)";
    const license = String(sourceLicense(summary, detail) || "").trim();
    return license && !/^see source$/i.test(license) ? license : "See the source database's terms";
  }

  // A protein identity that does not contradict the sequence note: several forms sharing one UniProt entry are a shared
  // accession, not a resolved one.
  function detailIdentityLabel(summary, detail) {
    const note = String(detail.sequence_variant_note || summary.sequence_variant_note || "");
    if (/(?:all|both) map to UniProt \S+, which does not say which is which|share UniProt \S+: which sequence is which/.test(note)) {
      return "Shared accession (one UniProt entry for several forms)";
    }
    return identityResolutionLabel({
      identity_resolution_state: detail.identity_resolution_state || summary.identity_resolution_state,
      sequence_source: detail.sequence_source || summary.sequence_source,
    });
  }

  // What the Check line needs: whether Preparation and Conditions rows exist (corrections point to them) and which values
  // carry a caution (the line points to their notes).
  function v2CheckOptions(summary, detail, proof) {
    const conditions = conditionLines(publicEvidenceString(detail.assay_conditions_summary), summary);
    const { notes } = measurementNotes(summary, detail, { proof });
    return {
      context: { hasPreparation: Boolean(conditions.preparation), hasConditions: Boolean(conditions.conditions) },
      cautionFields: ["kcat", "km", "kcat_over_km"].filter((field) => notes.some((note) => note.field === field)),
    };
  }

  function renderDetail(summary, detail) {
    const pmidsRaw = Array.isArray(detail.supporting_pmids)
      ? detail.supporting_pmids.filter(Boolean)
      : (detail.pubmed_id ? [detail.pubmed_id] : []);
    const doisRaw = Array.isArray(detail.supporting_dois)
      ? detail.supporting_dois.filter(Boolean)
      : (detail.doi ? [detail.doi] : []);
    // A paper without a PMID has a stand-in ID (NP and 8 hex digits): shown as text, never as a PubMed link.
    const paperIds = uniqueReferenceValues(pmidsRaw);
    const pmids = paperIds.filter(isPubMedId);
    const standInIds = paperIds.filter((value) => !isPubMedId(value));
    const dois = uniqueReferenceValues(doisRaw, { caseInsensitive: true });
    const rawProofLines = Array.isArray(detail.proof_lines)
      ? detail.proof_lines.filter(Boolean)
      : (Array.isArray(detail.paper_mentions) ? detail.paper_mentions.filter(Boolean) : []);
    const proofLines = rawProofLines.filter((line) => Boolean(evidenceNoteHtml(line)));
    const proofHeading = (summary.proof_kind || detail.proof_kind) === "source_note"
      ? "Database note"
      : "Earlier automated review: where the values are printed";
    const v2Record = isV2Row(summary) || String(detail.verification_method || "").startsWith(v2Method);
    const mergedRows = Number(detail.source_record_count || summary.source_record_count || 0);
    // What stands behind an older record's values (a CatLog v2 record's status already says "read from the paper").
    const evidenceRow = isV2Row(summary)
      ? ""
      : kv("Evidence", String(detail.verification_method || "").startsWith(v2Method) ? "Read from the paper" : evidenceLabel(summary, proofLines));
    const humanNote = humanReviewNote(summary);
    // A CatLog v2 record's values are one table, in Measurement; an older record keeps its notes, here.
    const v2Proof = v2ProofFacts(summary, detail);
    const v2Facts = v2Proof?.facts || null;
    const paperRows = [
      ...(paperIds.length || dois.length
        ? [
            dois.length ? linkedKv(dois.length === 1 ? "DOI" : "DOIs", referenceList(dois, doiLink)) : "",
            pmids.length ? linkedKv(pmids.length === 1 ? "PubMed" : "PubMed IDs", referenceList(pmids, pmidLink)) : "",
            standInIds.length ? kv(standInIds.length === 1 ? "Paper ID" : "Paper IDs", `${standInIds.join(", ")} (no PMID)`) : "",
          ]
        : [kv("PMID or DOI", "None recorded")]),
      evidenceRow,
      // A record read by CatLog: how (Method) and what the second check found (Check); an older record: its review.
      ...(v2Record
        ? [
            linkedKv("Method", `${escapePublic(v2MethodSentence(v2Facts))} <a class="method-link" href="#guide-method">How CatLog reads papers →</a>`),
            v2Facts ? kv("Check", v2CheckText(v2Facts, v2CheckOptions(summary, detail, v2Proof))) : "",
            v2Facts && v2AuditText(v2Proof.lines, v2Facts) ? kv("AI audit", v2AuditText(v2Proof.lines, v2Facts)) : "",
          ]
        : [kv("Review", reviewOutcome(summary, detail))]),
      // What a human reviewer found, on every record with a mark; the check only where the record shows "human-checked".
      humanNote
        ? `<div class="kv-line human-review-line"><span>Human review</span><strong>${isHumanChecked(summary) ? CHECK_ICON_HTML : ""}${escapePublic(humanNote)}</strong></div>`
        : "",
      // How many database rows a record merges is said once, here; Source details then names the databases only when
      // they are not just the source.
      mergedRows > 1
        ? kv("Merged from", `${formatInteger(mergedRows)} database rows${paperIds.length ? `, ${formatInteger(paperIds.length)} ${paperIds.length === 1 ? "paper" : "papers"}` : ""}`)
        : "",
    ];
    // An older record's notes (the earlier catalog's review text) expand on request.
    const notesHtml = !proofLines.length || v2Facts
      ? ""
      : `<details class="sequence-disclosure detail-notes"><summary>${escapeHtml(proofHeading)}</summary><div class="evidence-note-list">${evidenceNotesHtml(proofLines, 3)}</div></details>`;
    const dataOrigin = publicEvidenceString(detail.data_origin);
    // The order: what was measured (values, cautions, the paper's own numbers), under which conditions, where it comes
    // from and how it was checked, which protein and substrate structure, then the source details.
    $("detailContent").innerHTML = `
      <div class="detail-top">
        <button id="closeDetailButton" class="icon-button close-detail" type="button" aria-label="Close record">&times;</button>
        ${detailHeadingHtml(summary)}
        ${detailSubtitleHtml(summary, { ecFromDatabases: v2Record && ecFromDatabases(detail) })}
        ${detailSubstrateHtml(summary, detail)}
        ${detailStatusHtml(summary, { v2Record })}
      </div>

      ${measurementSection(summary, detail)}
      <section class="detail-section paper-section">
        <h3>Paper and review</h3>
        <div class="detail-kv">${paperRows.filter(Boolean).join("")}</div>
        ${notesHtml}
      </section>
      ${molecularIdentitySection(summary, detail)}
      ${detailDisclosure("Source details", [
        kv("Enzyme name from", v2Record ? "the paper" : sourceLabels[summary.enzyme_label_source] || summary.enzyme_label_source || "not recorded"),
        kv("Source", sourceDatabaseLabel(summary.source_db || detail.source_db)),
        kv("License", detailLicense(summary, detail, v2Record)),
        kv("CatLog record ID", summary.measurement_key || detail.measurement_key),
        mergedDatabasesRow(summary, detail),
        // Only a plain origin other than the usual "experimental" (internal tokens are not shown).
        dataOrigin && !/^experimental$/i.test(dataOrigin) && !/[_\d]/.test(dataOrigin) ? kv("Data origin", dataOrigin) : "",
        kv("Protein identity", detailIdentityLabel(summary, detail)),
      ])}

      <div class="detail-actions">
        <button id="downloadSelectedJson" class="button secondary" type="button">Download record</button>
        <a id="reportRecordProblem" class="button secondary" href="${escapeHtml(reportProblemHref(summary, pmids, { dois, standInIds }))}">Report a problem</a>
      </div>
    `;
    $("closeDetailButton").addEventListener("click", closeDetailAndRestoreFocus);
    document.querySelectorAll("#detailContent [data-flag-note]").forEach((button) => {
      button.addEventListener("click", () => showFlagNote(button.dataset.flagNote));
    });
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
        name: String(item.key || "").trim() === "primary_paper_direct"
          ? PRIMARY_LITERATURE_NAME
          : String(item.name || "").trim() || (item.key ? sourceDatabaseLabel(item.key) : ""),
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
    const guideList = $("guideSourceList");
    if (guideList) {
      guideList.innerHTML = sources.map((item) => {
        const rowCount = item.row_count == null || item.row_count === "" ? "" : `${formatInteger(item.row_count)} rows in this snapshot`;
        const license = item.key === "primary_paper_direct"
          ? escapeHtml(PRIMARY_LITERATURE_LICENSE)
          : (item.license && !/^see source$/i.test(item.license) ? `License: ${escapeHtml(item.license)}` : "See the source site for license terms");
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
    ["variant", "caution"].forEach((name) => setCheckboxes(name, []));
    clearInputs(...RANGE_INPUT_IDS);
    if ($("humanCheckedFilter")) $("humanCheckedFilter").checked = false;
    setSourceControls("all");
    $("sortSelect").value = "evidence";
    syncSortHeaders();
    resetDetail();
    applyFiltersInBackground();
  }

  function applyPageSize(value) {
    resetDetail();
    setPageSize(value);
    rememberPageSize(state.pageSize);
    state.page = 1;
    state.pendingPage = 0;
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
        if (id === "globalSearchInput" && viewFromLocation() !== "browse") navigateTo("browse");
        if ($(id).value.trim()) hideSuggestions();
        scheduleFilters();
      });
    });
    $("sortSelect").addEventListener("change", () => {
      syncSortHeaders();
      announceSort();
      applyFiltersInBackground();
    });
    document.querySelectorAll(".sort-button").forEach((button) => {
      button.addEventListener("click", () => sortByColumn(button.dataset.sort));
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
      });
    });
    // Phones: the filters' "Show N records" button closes the panel.
    $("showResultsButton")?.addEventListener("click", () => {
      setFiltersOpen(false);
      $("openFiltersButton")?.focus({ preventScroll: true });
    });
    // Phones: the counts band shows the two main counts; More shows the rest.
    $("snapshotMoreButton")?.addEventListener("click", (event) => {
      const band = event.currentTarget.closest(".snapshot-band");
      const expanded = !band.classList.contains("expanded");
      band.classList.toggle("expanded", expanded);
      event.currentTarget.setAttribute("aria-expanded", String(expanded));
      event.currentTarget.firstChild.textContent = expanded ? "Less " : "More ";
    });
    // The Human-checked and Read from the paper counts keep the current filters in their links (read again when used:
    // rows per page can change without a new count).
    for (const [link, href] of [[$("humanCheckedLink"), humanCheckedHref], [$("fromPaperLink"), fromPaperHref]]) {
      for (const type of ["pointerenter", "focus", "click"]) {
        link?.addEventListener(type, () => {
          if (link.hasAttribute("href")) link.setAttribute("href", href());
        });
      }
    }
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
    document.addEventListener("click", (event) => {
      for (const menu of [$("downloadMenu"), $("exportMenu")]) {
        if (menu?.open && !menu.contains(event.target)) menu.removeAttribute("open");
      }
    });
    const showLocationView = () => {
      const view = viewFromLocation();
      if (view === "browse") ensureRecordsLoaded();
      renderView(view);
      applyLocationFilters();
      const recordKey = recordKeyFromLocation();
      if (recordKey && recordKey !== state.selectedKey) {
        state.pendingRecordKey = recordKey;
        openRecordFromLocation();
      } else if (!recordKey && state.selectedKey && view === "browse") {
        // An address without a record (Back, Forward, a link to filtered Browse) closes the open one.
        resetDetail();
        if (state.records.length) renderRows();
      }
    };
    window.addEventListener("popstate", showLocationView);
    window.addEventListener("hashchange", showLocationView);
    // A link to Browse with filters (#browse?..., from Stats or the Guide) opens in this page, without reloading the
    // records, and Back returns to where it was followed.
    document.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target?.closest?.("a[href]");
      if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      let target;
      try {
        target = new URL(link.href, window.location.href);
      } catch (_error) {
        return;
      }
      const here = new URL(window.location.href);
      const folder = (path) => path.replace(/[^/]*$/, "");
      const file = target.pathname.split("/").pop();
      if (target.origin !== here.origin || folder(target.pathname) !== folder(here.pathname)) return;
      if (!/^#browse\?/.test(target.hash) || ![here.pathname.split("/").pop(), "catlog-latest.html", "catlog-stats.html", "index.html", ""].includes(file)) return;
      event.preventDefault();
      const url = viewUrl("browse");
      url.hash = target.hash;
      window.history.pushState({ catlogView: "browse" }, "", url);
      showLocationView();
    });
    // From Stats or Guide, resting on the way back to Browse for a moment (pointer or keyboard focus), or focusing the
    // search box, starts the download. Passing over the link on the way to another tab does not.
    for (const id of ["browseButton", "brandHomeButton"]) {
      let prefetchTimer = 0;
      const startPrefetch = () => {
        window.clearTimeout(prefetchTimer);
        prefetchTimer = window.setTimeout(() => ensureRecordsLoaded(), DETAIL_PREFETCH_DELAY_MS);
      };
      const cancelPrefetch = () => window.clearTimeout(prefetchTimer);
      $(id).addEventListener("pointerenter", startPrefetch);
      $(id).addEventListener("focus", startPrefetch);
      $(id).addEventListener("pointerleave", cancelPrefetch);
      $(id).addEventListener("blur", cancelPrefetch);
    }
    $("globalSearchInput").addEventListener("focus", () => {
      ensureRecordsLoaded();
      warmSearchText();
    });
    $("catalogFilters").addEventListener("focusin", warmSearchText);
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
      fitTableColumns();
      updateTableScrollControls();
    });
    narrowDetailMedia.addEventListener?.("change", () => {
      syncFilterPanel();
      syncDetailPanelAccessibility();
    });
    dockedFiltersMedia.addEventListener?.("change", syncFilterPanel);
    filtersBesideRecordMedia.addEventListener?.("change", syncFilterPanel);
    // "Only human-checked" sits under Accepted: ticking it ticks Accepted too.
    $("statusChecklist").addEventListener("change", (event) => {
      if (event.target?.id === "humanCheckedFilter" && event.target.checked) {
        const accepted = [...document.querySelectorAll('input[name="recordState"]')].find((input) => input.value === "accepted");
        if (accepted) accepted.checked = true;
      }
      applyFiltersInBackground();
    });
    $("measurementChecklist").addEventListener("change", () => {
      applyFiltersInBackground();
    });
    ["variantChecklist", "cautionChecklist"].forEach((id) => {
      $(id)?.addEventListener("change", () => applyFiltersInBackground());
    });
    // Source: ticking a database selects From enzyme databases; All records or Read from the paper clears the databases.
    $("sourceChecklist")?.addEventListener("change", (event) => {
      const input = event.target;
      if (input?.name === "sourceMode" && input.value !== "databases") setCheckboxes("source", []);
      if (input?.name === "source" && input.checked) setSourceControls("databases", selectedCheckboxes("source"));
      applyFiltersInBackground();
    });
    // Range bounds apply a moment after typing stops, and at once on Enter or when the field is left.
    RANGE_INPUT_IDS.forEach((id) => {
      const input = $(id);
      if (!input) return;
      input.addEventListener("input", () => {
        syncRangeValidity();
        scheduleFilters();
      });
      input.addEventListener("change", () => {
        window.clearTimeout(state.filterTimer);
        applyFiltersInBackground();
      });
    });
    $("clearButton").addEventListener("click", clearFilters);
    $("activeFilters")?.addEventListener("click", (event) => {
      const chip = event.target?.closest?.("[data-filter-key]");
      if (chip) {
        const chips = [...$("activeFilters").querySelectorAll(".filter-chip")];
        removeActiveFilter(chip.dataset.filterKey, { focusIndex: chips.indexOf(chip) });
        return;
      }
      if (event.target?.closest?.("[data-filter-clear]")) {
        clearFilters();
        $("openFiltersButton")?.focus({ preventScroll: true });
      }
    });
    // The filter changed last is the one the empty-results note offers to remove.
    for (const type of ["input", "change"]) {
      $("catalogFilters").addEventListener(type, (event) => noteFilterChange(event.target));
      $("globalSearchInput").addEventListener(type, (event) => noteFilterChange(event.target));
    }
    $("clearResultsButton")?.addEventListener("click", () => {
      clearFilters();
      $("globalSearchInput").focus({ preventScroll: true });
    });
    // On wide screens the Filters button opens and closes the docked panel.
    $("openFiltersButton").addEventListener("click", () => {
      setFiltersOpen(!(filtersDocked() && document.body.classList.contains("filters-open")));
    });
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
      state.pendingPage = 0;
      state.page -= 1;
      renderRows();
    });
    $("nextButton").addEventListener("click", () => {
      resetDetail();
      state.pendingPage = 0;
      state.page += 1;
      renderRows();
    });
    $("downloadPageButton").addEventListener("click", handlePageDownload);
    $("exportAllCsvButton")?.addEventListener("click", () => handleCsvExport("all"));
    $("exportPageCsvButton")?.addEventListener("click", () => handleCsvExport("page"));
    // "Skip to records" moves focus to the table without changing the address (the hash names the view).
    document.querySelector(".skip-link")?.addEventListener("click", (event) => {
      event.preventDefault();
      if (viewFromLocation() !== "browse") navigateTo("browse");
      (document.querySelector('#recordsBody tr[tabindex="0"]') || $("recordTableWrap"))?.focus();
    });
    $("recordTableWrap").addEventListener("scroll", updateTableScrollControls, { passive: true });
    $("scrollTableLeftButton").addEventListener("click", () => scrollTableColumns(-1));
    $("scrollTableRightButton").addEventListener("click", () => scrollTableColumns(1));
    document.addEventListener("keydown", (event) => {
      const openMenu = [$("downloadMenu"), $("exportMenu")].find((menu) => menu?.open);
      if (event.key === "Escape" && openMenu) {
        openMenu.removeAttribute("open");
        openMenu.querySelector("summary")?.focus();
        return;
      }
      if (event.key === "Escape" && document.body.classList.contains("filters-open")) {
        const activeElement = document.activeElement;
        if (activeElement?.matches?.('input[type="search"]') && activeElement.value) return;
        // Docked beside an open record, Escape closes whichever holds the focus (the record when neither does).
        const recordFirst = filtersDocked() && document.body.classList.contains("detail-open")
          && !$("catalogFilters")?.contains(activeElement);
        if (!recordFirst) {
          setFiltersOpen(false);
          $("openFiltersButton")?.focus();
          return;
        }
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
        throw new Error(OUT_OF_DATE_MESSAGE);
      }
      renderSummary();
      renderDownloadMetadata();
      renderSourceAttribution();
      const cleanUrl = viewUrl(viewFromLocation());
      if (!["#browse", "#guide", "#stats"].includes(window.location.hash)) cleanUrl.hash = window.location.hash;
      if (cleanUrl.href !== window.location.href) window.history.replaceState(window.history.state, "", cleanUrl);
      bindControls();
      // The checklists exist from the start, so an address with filters (#browse?...) can set them before the records load.
      setupFilters();
      restorePageSize();
      state.pendingRecordKey = recordKeyFromLocation();
      const addressFilters = browseParamsFromLocation();
      if (addressFilters?.size) applyBrowseParams(addressFilters);
      renderActiveFilters();
      renderView(viewFromLocation());
      syncFilterPanel();
      syncDetailPanelAccessibility();
      // Stats and Guide never download the record index; it loads when Browse is first shown or about to be.
      if (viewFromLocation() === "browse") await ensureRecordsLoaded();
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
      handleCsvExport,
      csvParts,
      renderDetail,
      rowStatusLabel,
      statusBadge,
      sourceTagText,
      applyBrowseParams,
      browseHash,
      activeFilterItems,
      countFacets,
      filterControlState,
      humanCheckedHref,
      fromPaperHref,
      setHumanReviewMarks: (marks) => { humanReviewMarks = marks || {}; },
      reviewOutcome,
      recordIndexPath,
      loadRecordChunks,
      isViewerIndexHeader,
      checkedViewerIndexHeader,
      viewerRowConstructor,
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
      valueFlagBadgeHtml,
      publicLoadMessage,
      enzymeFormLabel,
      enzymeFormHtml,
      sequenceSourceLabel,
      sequenceNoteText,
      isV2Row,
      identityResolutionLabel,
      measurementSection,
      lookAlikeRowKeys,
      substrateNoteHtml,
      molecularIdentitySection,
      numberHtml,
      numberText,
      metricDisplayWithUnitHtml,
      roundingFigures,
      panelValueHtml,
      efficiencyOriginHtml,
      printedValueText,
      v2LineFacts,
      conditionLines,
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
      statsCohortData,
      statsOverview,
      statsBrowseHref,
      statsValueRange,
      statsUnacceptedFields,
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
