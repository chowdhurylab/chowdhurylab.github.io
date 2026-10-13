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
    teamRendered: false,
    teamBound: false,
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
    // The filter sidebar collapsed to its rail for a record (1024-1599px), with its scroll position: it comes back when
    // the record closes.
    filtersAwayForRecord: null,
  };
  const EMPTY_VALUE = "—";
  // What a reader sees when a record's file cannot be used: it belongs to another snapshot, or lacks the record.
  const PAGE_OUT_OF_DATE = "This page is out of date. Reload to update it.";
  const RECORD_NOT_LOADED = "This record could not be loaded.";
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
  // Below 1024px an open record is a full-height dialog; from 1024px it is a column beside the table.
  const narrowDetailMedia = window.matchMedia("(max-width: 1023px)");
  // From 641px the filters are a sidebar column beside the table, never over it: open, or a 48px rail when collapsed.
  // Phones (640px and below) get a full-screen sheet instead.
  const sidebarFiltersMedia = window.matchMedia("(min-width: 641px)");
  // From 1024px the sidebar is a desktop sidebar (a viewer's choice to open or collapse it is kept); tablets start with
  // the rail.
  const desktopMedia = window.matchMedia("(min-width: 1024px)");
  // From 1200px the sidebar starts open (unless this viewer collapsed it). From 1024 to 1199px the table's columns do not
  // fit beside it (about 905px with every name broken between words), so it starts as the rail unless this viewer
  // opened it.
  const filtersOpenByDefaultMedia = window.matchMedia("(min-width: 1200px)");
  // From 1600px the sidebar stays open beside an open record; from 1024 to 1599px the record takes its place.
  const filtersBesideRecordMedia = window.matchMedia("(min-width: 1600px)");
  // A viewer's choice on a desktop screen that differs from the default for its width: "1" collapsed, "0" open (a
  // convenience: storage may be unavailable).
  const FILTERS_COLLAPSED_STORAGE_KEY = "catlog.filtersCollapsed";
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

  // Tag definitions, said the same way in the filter, the badges and the Guide.
  const CORRECTED_DEFINITION = "Accepted after a correction in the earlier automated review; the record shows the changes when the snapshot lists them.";
  const EARLIER_EXTRACTION_DEFINITION = "Read from a paper by the earlier automated pipeline of AI models and code checks, not by CatLog.";

  const stateDescriptions = {
    // Under the review rules (followsReviewRules) a full human approval also accepts a record.
    get accepted() {
      return followsReviewRules()
        ? "Passed review: read from the paper by CatLog, accepted by the earlier automated review as printed or after a correction, or every value approved by a human reviewer."
        : "Passed review: read from the paper by CatLog, or accepted by the earlier automated review as printed or after a correction.";
    },
    curation_pending: "The earlier automated review left a question open on the value, unit, protein or substrate. The record is replaced when CatLog reads its paper.",
    not_verified: "No review result. Unverified: the earlier review recorded no final check. Not reviewed: a database record without a PMID or DOI (SKiD or BRENDA) that was never reviewed.",
    disputed: "A check found a problem; not accepted.",
  };
  const HUMAN_CHECKED_DESCRIPTION = "A human reviewer approved every value shown.";

  // The verification_status values; label is the exact value a record names after its review result.
  const reviewStatuses = [
    { value: "verified", label: "Verified", description: "Accepted by the earlier automated review as printed." },
    { value: "corrected", label: "Corrected", description: CORRECTED_DEFINITION },
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

  // Cautions, grouped as the table marks them ("!" beside a value or T, "no unit") and the record's notes show them
  // (conditionFlags).
  // Each caution states the problem; the record's note gives the numbers.
  const cautionFilters = [
    { value: "differs", label: "kcat/Km mismatch", labelHtml: "<i>k</i><sub>cat</sub>/<i>K</i><sub>m</sub> mismatch", bit: 1, title: "The printed or listed kcat/Km differs from kcat ÷ Km" },
    { value: "units", label: "Possible unit or magnitude error", bit: 2, title: "Km above 10 M or below 1 nM, kcat above 10⁸ s⁻¹, a kcat/Km unit that may be off by 1000× or kcat/Km above the diffusion limit" },
    { value: "unit_missing", label: "No unit given", bit: 4, title: "A kcat or Km without a recorded unit" },
    { value: "temperature", label: "Temperature questionable", bit: 8, title: "A temperature value or unit that may be wrong" },
    { value: "none", label: "No cautions", bit: 16, title: "Records without any caution" },
  ];
  const CAUTION_FLAG_BITS = {
    kcat_over_km_quotient_mismatch: 1,
    kcat_over_km_source_mismatch: 1,
    km_magnitude_needs_check: 2,
    kcat_magnitude_needs_check: 2,
    kcat_over_km_unit_mismatch: 2,
    efficiency_above_diffusion_limit: 2,
    printed_unit_prefix_differs: 2,
  };

  // Source, the first filter: every record is either read from the paper by CatLog (isV2Row) or comes from the enzyme
  // databases. "By database" narrows the second group by source_db; a merged value such as "sabio_rk;brenda" counts for
  // each database it names (Stats counts the same way), and the table's status cell names them (sourceTagText).
  const SOURCE_CATLOG_LABEL = "Read from the paper by CatLog";
  const SOURCE_DATABASES_LABEL = "From enzyme databases";
  // The method in one short form, said the same way in the filter, badges, Stats and the record; the Guide says it in
  // full (#guide-method).
  const v2Sentence = "Read from the paper by an AI model; a second, separate AI check compared each value with the paper.";
  const SOURCE_CATLOG_HELP = "Read by an AI model; a second, separate AI check compared each value with the paper.";
  const SOURCE_DATABASES_HELP = "BRENDA, SABIO-RK, the Open Enzyme Database, UniProt, SKiD and STRENDA DB, plus earlier paper extractions and records with no source recorded; screened by an earlier automated pipeline of AI models and code checks.";
  const sourceModes = [
    { value: "all", label: "All records" },
    { value: "paper", label: SOURCE_CATLOG_LABEL, help: SOURCE_CATLOG_HELP, guide: true },
    { value: "databases", label: SOURCE_DATABASES_LABEL, help: SOURCE_DATABASES_HELP },
  ];
  // The databases of the second group; tag is the word the status cell uses, name the record's Source line (label when
  // absent).
  const sourceFilters = [
    { value: "brenda", label: "BRENDA", tag: "BRENDA", bit: 2 },
    { value: "sabio_rk", label: "SABIO-RK", tag: "SABIO-RK", bit: 4 },
    { value: "oed", label: "Open Enzyme Database", tag: "OED", name: "Open Enzyme Database (OED)", bit: 8 },
    { value: "uniprot", label: "UniProt", tag: "UniProt", bit: 16 },
    { value: "skid", label: "SKiD", tag: "SKiD", bit: 32 },
    { value: "strenda", label: "STRENDA DB", tag: "STRENDA DB", bit: 64 },
    { value: "earlier_paper", label: "Earlier paper extractions", tag: "earlier extraction", name: "Earlier paper extraction", bit: 128,
      title: EARLIER_EXTRACTION_DEFINITION },
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

  // Where a record's enzyme name comes from, read after "Name from" (a CatLog v2 record's: the paper).
  const sourceLabels = {
    source_record: "Source record",
    explicit_enzyme_name: "Source record",
    brenda_recommended_name: "BRENDA recommended name",
    protein_name_fallback: "Protein name",
    uniprot_name_fallback: "UniProt",
    ec_accepted_name_fallback: "EC list (accepted name)",
    ec_name_fallback: "EC list",
    uniprot_fallback: "UniProt (accession only)",
    name_not_preserved: "Not recorded",
  };

  const sourceDatabaseLabels = {
    oed: "Open Enzyme Database (OED)",
    brenda: "BRENDA",
    sabio_rk: "SABIO-RK",
    sabio: "SABIO-RK",
    skid: "SKiD",
    uniprot: "UniProt",
    strenda: "STRENDA DB",
    primary_paper_direct: "Earlier paper extraction",
  };

  function sourceDatabaseLabel(value) {
    const text = String(value || "").trim();
    const key = text.toLowerCase().replace(/[\s-]+/g, "_");
    return sourceDatabaseLabels[key] || text || EMPTY_VALUE;
  }

  // How a record's protein is matched to UniProt, in the record's UniProt line.
  const identityLabels = {
    accession_resolved: "UniProt entry",
    sequence_resolved_no_accession: "Sequence known, no UniProt entry",
    candidate_pool: "Several possible UniProt entries",
    identity_unresolved: "Not matched to UniProt",
  };

  const identityOnlyTrustNote = "Accepted, but no PMID or DOI is linked, so the value cannot be traced to a paper.";
  // The user's review rules (website plan D1, D2), followed by an export that lists accepted_basis among its counts: an
  // accepted record needs a linked paper (a record without one is Not checked, tagged "no paper linked"), and a record
  // whose every value a human reviewer approved is accepted ("human review"). An older snapshot has neither rule.
  function followsReviewRules() {
    return Array.isArray(manifest?.summary?.distributions?.accepted_basis);
  }
  const NO_PAPER_NOT_ACCEPTED = "No PMID or DOI is linked, so the value cannot be traced to a paper; not counted as Accepted.";
  const NO_PAPER_RECORD_NOTE = "The earlier automated review accepted it, but no PMID or DOI is linked, so the value cannot be traced to a paper; not counted as Accepted.";
  function noPaperDefinition() {
    return followsReviewRules() ? NO_PAPER_NOT_ACCEPTED : identityOnlyTrustNote;
  }
  // Records accepted because a human reviewer approved every value (accepted_basis "human review").
  function humanAcceptedCount() {
    return manifestDistribution("accepted_basis")["human review"] || 0;
  }

  const conditionFlagLabels = {
    kcat_over_km_quotient_mismatch: "kcat/Km differs from kcat ÷ Km",
    kcat_over_km_unit_mismatch: "kcat/Km unit may be off by 1000×",
    kcat_over_km_source_mismatch: "Every kcat/Km the source databases list for this record is more than 2-fold from the kcat/Km shown",
    km_magnitude_needs_check: "Km above 10 M; the unit may be wrong",
    kcat_magnitude_needs_check: "kcat above 10⁸ s⁻¹; the unit may be wrong",
    efficiency_above_diffusion_limit: "kcat/Km above the diffusion limit",
    // CatLog's flag for a value stored in another concentration unit than the paper prints (name to be confirmed).
    printed_unit_prefix_differs: "The paper prints another concentration unit than the one CatLog uses (printed unit differs).",
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
    kcat_over_km_source_mismatch: { field: "kcat_over_km", short: "kcat/Km mismatch" },
    kcat_over_km_unit_mismatch: { field: "kcat_over_km", short: "possible 1000× unit error" },
    efficiency_above_diffusion_limit: { field: "kcat_over_km", short: "above diffusion limit" },
    km_magnitude_needs_check: { field: "km", short: "Km > 10 M" },
    kcat_magnitude_needs_check: { field: "kcat", short: "kcat > 10⁸ s⁻¹" },
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

  // The magnitude cautions' bounds (website plan P8): Km below 1 nM is flagged too, and kcat only above 10⁸ s⁻¹ (catalase
  // and carbonic anhydrases are measured at 1-3 × 10⁷). CatLog's export applies them to every record; an older snapshot's
  // flags are brought to the same bounds here, from values in catalog units (Stats counts the same way).
  const KM_LOW_BOUND_MM = 1e-6;
  const KCAT_HIGH_BOUND_PER_S = 1e8;

  function conditionFlags(...rows) {
    const flags = new Set();
    rows.forEach((row) => {
      (Array.isArray(row?.condition_flags) ? row.condition_flags : []).forEach((flag) => {
        const key = String(flag || "").trim();
        if (key) flags.add(key);
      });
    });
    const valueRow = rows.find((row) => row && typeof row === "object" && "km_display" in row) || rows[0];
    const catalogValue = (field) => (valueRow && canonicalMetricUnitKeys[field].has(normalizedUnitKey(metricUnit(valueRow, field)))
      ? Number(metricDisplay(valueRow, field))
      : NaN);
    const km = catalogValue("km");
    if (km > 0 && km < KM_LOW_BOUND_MM) flags.add("km_magnitude_needs_check");
    const kcat = catalogValue("kcat");
    if (flags.has("kcat_magnitude_needs_check") && Number.isFinite(kcat) && kcat <= KCAT_HIGH_BOUND_PER_S) flags.delete("kcat_magnitude_needs_check");
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
    [10, "The factor is close to 10, a shift of one decimal place."],
    [60, "The factor is close to 60, the factor between per minute and per second.", "time"],
    [100, "The factor is close to 100, a shift of two decimal places."],
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
      foldText: `${foldNumberText(fold)}-fold`,
      direction: reported > quotient ? "above" : "below",
      factor: KCAT_KM_FACTORS.find(([target]) => Math.abs(fold / target - 1) <= 0.1),
      unit: unitText(metricUnit(row, "kcat_over_km")),
      v2: isV2Row(row) || String(row.verification_method || "").startsWith(v2Method),
    };
  }

  // A fold as the notes write it: one decimal below 10 (1.6), a whole number from 10 on (never "10.0").
  function foldNumberText(fold) {
    return fold < 9.95 ? fold.toFixed(1) : formatInteger(Math.round(fold));
  }

  // A value in a note, in the same number style as the quotient beside it (38000 printed to 2 figures is 3.8 × 10⁴).
  function noteValueText(row, field) {
    const display = metricDisplay(row, field);
    const figures = displayFigures(row, field) || numberParts(display)?.significant || 0;
    return numberText(display, figures ? { figures } : undefined);
  }

  // "The paper's kcat/Km (2.2 s⁻¹ mM⁻¹) is 1.6-fold above kcat ÷ Km (1.3 s⁻¹ mM⁻¹). All three are stored as the paper gives
  // them." A familiar factor is named; for a unit factor on a record read from the paper, the printed numbers' own
  // arithmetic shows whether they agree in one unit.
  function kcatKmComparisonText(row, detail = null) {
    const check = kcatKmCheck(row);
    if (!check) return "";
    const { quotientText, foldText, direction, factor, unit, v2 } = check;
    const sentences = [`${v2 ? "The paper's kcat/Km" : "The source's kcat/Km"} (${noteValueText(row, "kcat_over_km")} ${unit}) is `
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
    return flagBadgeHtml(labels.join("; "), shortText);
  }

  // The T cell's "!" for a temperature caution (the Cautions filter's Temperature questionable group).
  function temperatureFlagBadgeHtml(flags) {
    const labels = [...new Set([...flags].filter((flag) => flag.startsWith("temperature_")).map((flag) => conditionFlagLabel(flag)))];
    return labels.length ? flagBadgeHtml(labels.join("; "), "T questionable") : "";
  }

  function flagBadgeHtml(summary, shortText) {
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
  const PRIMARY_LITERATURE_NAME = SOURCE_CATLOG_LABEL;
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
    if (["#browse", "#guide", "#stats", "#team"].includes(window.location.hash)) return window.location.hash.slice(1);
    if (GUIDE_SECTION_HASH.test(window.location.hash)) return "guide";
    // Browse with filters: #browse?q=...&ec=... (see browseParamsFromLocation).
    if (/^#browse\?/.test(window.location.hash || "")) return "browse";
    return new URL(window.location.href).pathname.endsWith("/catlog-stats.html") ? "stats" : "browse";
  }

  function renderView(view, { scroll = false } = {}) {
    const guideOpen = view === "guide";
    const statsOpen = view === "stats";
    const teamOpen = view === "team";
    const browseOpen = !guideOpen && !statsOpen && !teamOpen;
    $("catalogView").hidden = !browseOpen;
    $("guideView").hidden = !guideOpen;
    $("statsView").hidden = !statsOpen;
    if ($("teamView")) $("teamView").hidden = !teamOpen;
    // Stats come from the manifest alone: drawn the first time they are shown, never from the record index.
    if (statsOpen && !state.statsRendered) {
      renderStats();
      state.statsRendered = true;
    }
    // The Team page too: drawn from the manifest the first time it is shown.
    if (teamOpen && !state.teamRendered && $("teamFigure")) {
      renderTeam();
      state.teamRendered = true;
    }
    document.body.classList.toggle("guide-open", guideOpen);
    document.body.classList.toggle("stats-open", statsOpen);
    document.body.classList.toggle("team-open", teamOpen);
    // The catalog's tabs: Browse · Stats · Guide · Team.
    for (const name of ["browse", "stats", "guide", "team"]) {
      const link = $(`${name}Button`);
      if (!link) continue;
      const active = name === view;
      link.classList.toggle("active", active);
      link.setAttribute("aria-current", active ? "page" : "false");
    }
    document.title = guideOpen
      ? "Guide | CatLog"
      : statsOpen ? "Stats | CatLog" : teamOpen ? "Team | CatLog" : "CatLog | Enzyme Kinetics Catalog";
    const currentUrl = new URL(window.location.href);
    if (/^https?:$/.test(currentUrl.protocol) && /\/catlog-(latest|stats)\.html$/.test(currentUrl.pathname)) {
      const publicUrl = new URL(statsOpen ? "./catlog-stats.html" : "./catlog-latest.html", currentUrl);
      document.querySelector('link[rel="canonical"]')?.setAttribute("href", publicUrl.href);
      document.querySelector('meta[property="og:url"]')?.setAttribute("content", publicUrl.href);
      document.querySelector('meta[property="og:title"]')?.setAttribute("content", document.title);
    }
    if (!browseOpen) {
      // The phone sheet closes; the sidebar stays as it is (it is part of Browse, hidden with it).
      if (!filtersDocked()) setFiltersOpen(false, { focus: false });
      resetDetail();
      hideSuggestions();
    } else {
      // A sidebar a record had collapsed (the record closed when Browse was left) comes back with Browse.
      if (state.filtersAwayForRecord && !document.body.classList.contains("detail-open")) restoreFiltersAwayForRecord();
      window.requestAnimationFrame(updateTableScrollControls);
    }
    // A section address (#guide-units) shows that section, also when the page opens at it.
    const guideSection = guideOpen && GUIDE_SECTION_HASH.test(window.location.hash)
      ? document.getElementById(window.location.hash.slice(1))
      : null;
    if (guideSection) window.requestAnimationFrame?.(() => guideSection.scrollIntoView?.({ block: "start" }));
    if (scroll) {
      if (guideOpen) $("guideView").scrollTop = 0;
      if (teamOpen && $("teamView")) {
        $("teamView").scrollTop = 0;
        $("teamHeading")?.focus({ preventScroll: true });
      }
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
      .replace(/\bclaim\s+status\b/gi, "review result")
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

  // The snapshot's data ID (as the counts band and Cite give it), or null.
  function snapshotDataId() {
    const id = shortHash(manifest.content_sha256 || manifest.source_sha256);
    return id === EMPTY_VALUE ? null : id;
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
    if ($("guideSnapshotDate")) $("guideSnapshotDate").textContent = snapshotDate;
    if ($("guideSourceId")) {
      $("guideSourceId").textContent = sourceId;
      $("guideSourceId").title = manifest.content_sha256 || manifest.source_sha256 || "";
    }
    // One citation line, selectable as a whole (no copy button): snapshot date (UTC) and the Data ID shown above.
    const generated = manifest.generated_at ? new Date(manifest.generated_at) : null;
    const day = generated && !Number.isNaN(generated.getTime()) ? generated.toISOString().slice(0, 10) : "";
    if ($("guideCitationLine") && day && sourceId !== EMPTY_VALUE) {
      $("guideCitationLine").textContent = `CatLog snapshot ${day} (data ID ${sourceId}), Chowdhury Lab, https://chowdhurylab.github.io/tools/catlog-latest.html`;
    }
    // Downloads save under the snapshot's date (catlog-2026-10-12-full.jsonl.gz), so a kept file says which snapshot it
    // is; the Guide's Data ID check names the same file.
    if (day) {
      for (const [id, part] of [["enrichedDataButton", "full"], ["guideFullDataLink", "full"], ["exportSnapshotButton", "table"]]) {
        $(id)?.setAttribute("download", `catlog-${day}-${part}.jsonl.gz`);
      }
      if ($("guideDataIdFile")) $("guideDataIdFile").textContent = `catlog-${day}-full.jsonl.gz`;
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
      .replace(/\buM\b/g, "µM")
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

  // A database note as the record shows it: without an importer's "Raw STRENDA Extraction:" label, "(+/-)" as ±.
  function databaseNoteText(value) {
    return publicEvidenceString(String(value))
      .replace(/^\s*Raw STRENDA Extraction:\s*/i, "")
      .replace(/\s*\(\+\/-\)\s*/g, " ± ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // A database's name leading its note ("SKiD: 55°C, pH 8.9", as CatLog writes SKiD's raw conditions).
  const NOTE_SOURCE_LABEL = /^\s*(SKiD|BRENDA|SABIO-RK|OED|Open Enzyme Database|UniProt|STRENDA DB)\s*:\s*/i;

  // A database note without its leading database name when that is the one database the heading names ("Note from
  // SKiD"); a merged record's notes keep it, so each says where it comes from.
  function noteWithoutHeadingSource(value, source) {
    if (typeof value !== "string") return value;
    const match = value.match(NOTE_SOURCE_LABEL);
    return match && String(source || "").toLowerCase().split(/\s*\(/)[0] === match[1].toLowerCase() ? value.slice(match[0].length) : value;
  }

  // A database note that says only the temperature and pH the record's rows already give ("25°C", "pH 7.5, 30 °C",
  // "SKiD: 55°C, pH 8.9").
  function noteRepeatsConditions(value, summary) {
    if (typeof value !== "string") return false;
    const temperature = formatTemperature(summary);
    const ph = formatPh(summary);
    let rest = databaseNoteText(value).replace(NOTE_SOURCE_LABEL, "");
    let repeated = false;
    rest = rest.replace(/\bpH\s*(\d+(?:\.\d+)?)/gi, (match, number) => {
      if (ph === EMPTY_VALUE || Number(number) !== Number(ph)) return match;
      repeated = true;
      return "";
    });
    rest = rest.replace(/(-?\d+(?:\.\d+)?)\s*°\s*C\b/g, (match, number) => {
      if (temperature === EMPTY_VALUE || Number(number) !== Number(temperature)) return match;
      repeated = true;
      return "";
    });
    return repeated && !rest.replace(/\b(?:at|and)\b/gi, "").replace(/[\s,;.]/g, "");
  }

  // An older record's Conversion line (deviation 1 keeps it) as facts: each metric's printed value and the arithmetic,
  // without the earlier pipeline's reasoning. "Km: printed Table 1 cell 14.8 uM; 1 uM is 0.001 mM, so 14.8 / 1000 =
  // 0.0148 mM; kcat: printed Table 1 cell 0.610 s-1; the printed unit is already the canonical s-1, so no unit conversion
  // applies and the paper-side value is 0.61 s-1" reads "Km: printed Table 1 cell 14.8 µM; 14.8 / 1000 = 0.0148 mM.
  // kcat: printed Table 1 cell 0.610 s-1 (no conversion)." A clause that would lose its printed number stays as it was.
  const CONVERSION_METRIC_START = /(?:^|(?<=[.;]\s+))(?=(?:kcat\s*\/\s*K_?m|kcat_over_km|k_?cat|K_?m|Ki|Vmax)\s*[:=])/i;
  const CONVERSION_NONE = /(?:,\s*)?\b(?:(?:which|that)(?: unit)? (?:is|are) |(?:is|are) )?(?:already\b|the same unit as\b|(?:the )?canonical\b|so no (?:unit )?conversion|no (?:unit )?conversion (?:applies|is applied|is needed|was applied)\b|no conversion\b|no unit conversion\b)/i;
  const CONVERSION_DROP = /^(?:and )?(?:the (?:paper(?:-side)?|normali[sz]ed|canonical|stored) value is\b|carried exactly\b|(?:it|the printed cell) (?:reads|normali[sz]es to)\b|normali[sz]e[sd]?(?: to)?\s+[\d.]|the paper value is\b|(?:an |also )?exact(?: conversion)?\b|with no repeating decimal)/i;
  const CONVERSION_ASIDE = /\s*\((?=[^()]*(?:\bso no\b|is involved|this article prints|already|canonical|normali[sz]ed?))[^()]*\)/gi;
  const CONVERSION_FIELDS = /metric:\s*([^;]+?);\s*(?:raw value:\s*([^;]+?);\s*)?(?:raw unit:\s*([^;]+?);\s*)?normali[sz]ed value:\s*([^;]+?)(?:;\s*normali[sz]ed unit:\s*([^;.]+))?(?=;|\.?$)/gi;
  const CONVERSION_VALUE_DIGIT = /(?<![\^\-−⁻\w.])\d/;

  function conversionFirstNumber(text) {
    return (String(text).match(/\d+(?:\.\d+)?/) || [""])[0];
  }

  function conversionClause(clause) {
    const colon = clause.indexOf(":");
    const label = clause.slice(0, colon + 1);
    const body = clause.slice(colon + 1).replace(CONVERSION_ASIDE, "")
      .replace(/,\s*(?:an |also )?exact(?: conversion)?(?: with no repeating decimal)?/gi, "");
    const parts = body.split(/;\s+|\.\s+(?=[a-z0-9])/i).map((part) => part.trim().replace(/[.;,]+$/, "")).filter(Boolean);
    const kept = [];
    let none = false;
    for (let part of parts) {
      part = part.replace(/^the printed (.*?)\b(cell|value)s? is\s+/i, "printed $1$2 ").replace(/^the (?:paper's own )?printed\b/i, "printed");
      // "1 uM is 0.001 mM, so 14.8 / 1000 = 0.0148 mM", "the turnover column is per minute, so 1 / 60 = 0.0167": the arithmetic.
      const arithmetic = part.match(/^(?:so\s+)?[^;=]*?\b(?:is|are|equals)\b[^;=]*?,?\s+so\s+(?!no\b)(?=[^;]*[=→])(.+)$/i);
      if (arithmetic) part = arithmetic[1];
      part = part.replace(/^so\s+/i, "").replace(/^the printed cell (?:converts to|reads)\s+/i, "→ ");
      if (CONVERSION_DROP.test(part)) continue;
      const at = part.search(CONVERSION_NONE);
      if (at >= 0) {
        const head = part.slice(0, at).trim().replace(/[,;:]+$/, "");
        if (head && CONVERSION_VALUE_DIGIT.test(head) && !/^(?:the|1|one)\b/i.test(head)) kept.push(head);
        none = true;
        continue;
      }
      kept.push(part);
    }
    let text = kept.join("; ");
    if (none) text = text ? `${text} (no conversion)` : "no conversion";
    const result = `${label} ${text}`.replace(/\s+/g, " ").trim();
    const first = conversionFirstNumber(clause.slice(colon + 1));
    return !first || result.includes(first) ? result : clause.trim();
  }

  function conversionFacts(value) {
    let text = String(value || "").trim();
    if (!text) return "";
    text = text.replace(CONVERSION_FIELDS, (_m, metric, raw, unit, number, numberUnit) =>
      `${metric.trim()}: ${raw ? `${raw.trim()}${unit && !/[a-zµμ]/i.test(raw) ? ` ${unit.trim()}` : ""} → ` : ""}${number.trim()}${numberUnit ? ` ${numberUnit.trim()}` : ""}`)
      .replace(/^normali[sz]ed(?: explicit table cells)?:?\s+/i, "")
      .replace(/\bprinted_efficiency_normali[sz]ed=\s*/gi, "printed kcat/Km ")
      .replace(/\b(?:[a-z]+_)*normali[sz]ed_(?:value|unit)=\s*/gi, "");
    text = text.replace(CONVERSION_ASIDE, "");
    const clauses = text.split(CONVERSION_METRIC_START).map((clause) => clause.trim().replace(/[.;]+$/, "")).filter(Boolean);
    const cleaned = clauses.map((clause) => (/^[^:]{1,12}:/.test(clause) ? conversionClause(clause) : clause));
    return `${cleaned.join(". ")}.`
      .replace(/\s+normali[sz]es to\s+/gi, " → ")
      .replace(/\bnormali[sz]e to\b/gi, "in catalog units are")
      .replace(/\bnormali[sz]ation\b/gi, "conversion")
      .replace(/\bindependently\b/gi, "separately")
      .replace(/\bindependent\b/gi, "separate")
      .replace(/\bnormali[sz]e\b/gi, "convert")
      .replace(/\bnormali[sz]ed\s+(?=[\d.])/gi, "")
      .replace(/\bnormali[sz]ed value\b/gi, "value in catalog units")
      .replace(/\bnormali[sz]ed unit\b/gi, "unit")
      .replace(/\bnormali[sz]ed\b/gi, "converted")
      .replace(/\buM\b/g, "µM")
      .replace(/\s+/g, " ");
  }

  function evidenceNoteHtml(value) {
    if (value === null || value === undefined || value === "") return "";
    if (typeof value !== "object") {
      const text = databaseNoteText(value);
      return text ? `<p class="evidence-note-plain">${evidenceTextHtml(text)}</p>` : "";
    }

    const location = [value.table_label, value.row_label].map(publicEvidenceString).filter(Boolean).join(" · ");
    const reported = publicEvidenceString(value.raw_value_unit_evidence
      || (!value.normalized_value_unit_evidence ? value.column_label : ""));
    const normalized = publicEvidenceString(value.normalized_value_unit_evidence);
    const rows = [
      location ? ["Where", location] : null,
      reported ? ["As printed", cleanEvidenceValue(reported)] : null,
      // The earlier pipeline's own word for it ("Normalized paper Km: ...") is the label's.
      normalized ? ["Conversion", cleanEvidenceValue(conversionFacts(normalized)).replace(/^normali[sz]ed:?\s+/i, "")] : null,
    ].filter(Boolean);

    if (!rows.length) {
      const fallback = evidenceText(value);
      return fallback ? `<p class="evidence-note-plain">${evidenceTextHtml(fallback)}</p>` : "";
    }
    return kvList(rows.map(([label, text]) => linkedKv(label, evidenceTextHtml(text))), "evidence-note-item");
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
      .replace(/\^\(\s*([−–—-]?)\s*(\d+(?:\.\d+)?)\s*\)|\^\{\s*([−–—-]?)\s*(\d+(?:\.\d+)?)\s*\}|\^([−-]?\d+(?:\.\d+)?)/g,
        (_m, s1, d1, s2, d2, c) => `<sup>${c ?? `${s1 || s2 ? (s1 || s2).replace(/[–—]/, "−") : ""}${d1 ?? d2}`}</sup>`)
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
    // The stored digits in the page's notation (9.3333 × 10⁵, not 9.3333e+05).
    return ` title="${escapeHtml([numberText(display), unit].filter(Boolean).join(" "))}"`;
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

  // A kcat/Km worked out from kcat and Km: "calc." beside the table value, "calculated" in the record.
  function efficiencyOriginHtml(row, { short = false } = {}) {
    const note = row.kcat_over_km_origin === "calculated" ? CALCULATED_NOTE : (efficiencyLooksCalculated(row) ? EQUALS_QUOTIENT_NOTE : "");
    return note ? `<small class="metric-origin" title="${escapeHtml(note)}">${short ? "calc." : "calculated"}</small>` : "";
  }

  // An earlier-catalog kcat/Km whose origin is not stated is never called calculated, even when it equals kcat ÷ Km: of
  // the 7,502 that do, 531 say in their own record that the paper printed them (recheck, 2026-10-12).
  function efficiencyLooksCalculated(_row) {
    return false;
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

  // The table's T and pH cells: the number alone, or a dash (marked empty, so a phone card leaves it out unless a
  // caution's "!" follows it).
  function conditionCellHtml(className, value, flagHtml = "") {
    const flagged = flagHtml ? " data-flagged=\"\"" : "";
    return value === EMPTY_VALUE
      ? `<td class="${className} num" data-empty=""${flagged}><span>${EMPTY_VALUE}</span>${flagHtml}</td>`
      : `<td class="${className} num"${flagged}><span>${escapeHtml(value)}</span>${flagHtml}</td>`;
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
    return (row._recordState || recordStateForRow(row)) === "accepted" && hasNoPaperLinked(row);
  }

  // No PMID or DOI linked (public_trust_basis identity_only): accepted in an older snapshot, Not checked under the
  // review rules; tagged "no paper linked" either way.
  function hasNoPaperLinked(row) {
    return String(row?.public_trust_basis || "").trim() === "identity_only";
  }

  // An older record's review, said as what it was: the earlier automated review.
  function reviewOutcomeBase(summary) {
    switch (summary.verification_status) {
      case "corrected":
        return "Corrected and accepted in the earlier automated review; this snapshot does not list the changes.";
      case "verified":
        return "Accepted as printed, in the earlier automated review.";
      case "manual_review_required":
        return "Not confirmed: the earlier automated review left a question open on the value, unit, protein or substrate.";
      case "mathematically_inferred":
        return "Not checked: taken from the source database as listed.";
      case "disputed":
        return "Disputed in the earlier automated review; not accepted (no reason recorded).";
      default:
        return "Not checked: the earlier automated review recorded no final check.";
    }
  }

  // CatLog v2 rows: every value read from the paper by an AI model, and a second, separate AI check compared each value
  // with the paper (v2Sentence, defined with the Source filter). The method token is the exporter's and stays as it is.
  const v2Method = "catlog_v2_read_and_independent_verify";

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
    // Facts only: a note's review year is left out ("in CatLog's 2026 review", "in the 2026 review").
    const note = String(mark?.note || "").replace(/\b(CatLog['’]s|the) (?:19|20)\d\d review\b/g, "$1 review");
    return note || (mark?.checked
      ? (accepted
          ? "A human reviewer approved every value on this record."
          : "A human reviewer approved these values; the record's status comes from the automated review.")
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
  // unitChanged: a value is stored in another concentration unit than the paper prints (its caution note says which), so
  // "values stored as printed" would not be true.
  function v2MethodSentence(facts = null, { unitChanged = false } = {}) {
    const base = v2Sentence.replace(/\.$/, "");
    if (!facts?.length) return `${base}.`;
    if (facts.some((fact) => /converted by code/.test(fact.conversion || ""))) return `${base}; units converted by code.`;
    return unitChanged
      ? `${base}; not every value is stored in the unit the paper prints (see the notes).`
      : `${base}; values stored as printed.`;
  }

  // The paper prints no EC number: the EC shown is the one the enzyme databases list for this paper's values.
  function ecFromDatabases(detail = {}) {
    return String(detail.verification_method || "").includes("ec_from_databases");
  }

  function reviewOutcome(summary, detail = {}) {
    const method = String(detail.verification_method || "");
    if (summary.verification_status === "verified" && method.startsWith(v2Method)) return v2MethodSentence();
    if (String(detail.accepted_basis || summary.accepted_basis || "").trim() === "human review"
      && (summary._recordState || recordStateForRow(summary)) === "accepted") {
      return "Accepted because a human reviewer approved every value; the earlier automated review had not accepted it.";
    }
    if (isIdentityOnlyAccepted(summary)) {
      return "Accepted as listed by the source database; no paper is cited, so the value cannot be traced to a paper.";
    }
    return hasNoPaperLinked(summary)
      ? "Not checked: the earlier automated review accepted it, but no paper is cited, so the value cannot be traced to a paper."
      : reviewOutcomeBase(summary);
  }

  // The review result; with exact, a Not checked record also names its own status ("Not checked (Unverified)").
  function rowStatusLabel(row, { exact = false } = {}) {
    const result = stateConfig(row._recordState || recordStateForRow(row)).label;
    // A record without a linked paper is Not checked for that reason (its tag says so), not because nobody reviewed it.
    if (!exact || result !== "Not checked" || hasNoPaperLinked(row)) return result;
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
    const noPaper = hasNoPaperLinked(row);
    const fromPaper = isV2Row(row);
    // A Not checked record describes its own status (Unverified, Not reviewed).
    const ownStatus = config.value === "not_verified"
      ? reviewStatuses.find((item) => item.value === row.verification_status)?.description
      : "";
    // "human-checked" only on accepted rows, with a check in its own colour; the record's Human review line shows for
    // every marked row.
    const checked = isHumanChecked(row);
    // Under the review rules a human-checked record may be accepted for that approval alone (the table does not say
    // which), so its title does not name the earlier review.
    const acceptedHow = checked && !fromPaper && row.verification_status === "verified" && humanAcceptedCount()
      ? "Accepted as printed by the earlier automated review, or because a human reviewer approved every value."
      : reviewStatuses.find((item) => item.value === row.verification_status)?.description;
    const description = fromPaper
      ? v2Sentence
      : (identityOnly
          ? identityOnlyTrustNote
          : (noPaper
              ? `${config.label}: ${NO_PAPER_RECORD_NOTE.charAt(0).toLowerCase()}${NO_PAPER_RECORD_NOTE.slice(1)}`
              : (config.value === "accepted"
                  ? acceptedHow
                  : (ownStatus ? `${rowStatusLabel(row, { exact: true })}: ${ownStatus}` : stateDescriptions[config.value]))))
      || config.label;
    const label = rowStatusLabel(row);
    const tags = [
      sourceTagText(row),
      isCorrected ? "corrected" : "",
      noPaper ? "no paper linked" : "",
    ].filter(Boolean);
    const fullDescription = checked
      ? `${description} Human-checked: ${fromPaper ? "a human reviewer approved the same values in the earlier catalog." : "a human reviewer approved every value shown."}`
      : description;
    const className = `${config.className}${noPaper ? " identity-only" : ""}`;
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
            reject(new Error(PAGE_OUT_OF_DATE));
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
      throw new Error(PAGE_OUT_OF_DATE);
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

  // What a visitor reads when loading fails: a page older than the data it finds says so plainly (PAGE_OUT_OF_DATE);
  // the technical detail (which file, which check) stays in the console.

  function publicLoadMessage(message) {
    const text = String(message || "");
    if (/does not match the CatLog source generation|cannot read CatLog index version|use different shard sizes|CatLog index is missing/.test(text)) {
      if (text !== PAGE_OUT_OF_DATE) console.warn(`CatLog: ${text}`);
      return PAGE_OUT_OF_DATE;
    }
    if (/^Detail shard /.test(text)) {
      console.warn(`CatLog: ${text}`);
      return "This record could not be loaded.";
    }
    // The index's own checks and script errors are not for readers: the detail goes to the console.
    if (/CatLog index contains an invalid row|^Expected \d+ CatLog rows|is not a function|Cannot read propert|is not defined|is undefined|Unexpected token|^(?:Type|Reference|Syntax|Range)Error\b/.test(text)) {
      console.warn(`CatLog: ${text}`);
      return "The records could not be read. Reload the page to try again.";
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
    $("activeFilters")?.classList?.remove?.("results-empty");
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
        action.textContent = "Trying again…";
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
  // Optional text a snapshot may carry (an older index has no such column; rows without it hold null): condition_note
  // tells a record read by CatLog from a sibling of its paper that reads the same ("+10 mM FBP").
  const VIEWER_INDEX_OPTIONAL_TEXT_FIELDS = ["condition_note"];
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
    const [conditionNoteAt] = VIEWER_INDEX_OPTIONAL_TEXT_FIELDS.map((field) => header.fields.indexOf(field));
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
      this.condition_note = conditionNoteAt >= 0 && typeof v[conditionNoteAt] === "string" ? v[conditionNoteAt] : null;
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

  // One record as the downloads give it (Download record, This page as JSON): one flat object with the Full data's
  // field names for the data, the record's own words for its review result, method, check, cautions and human review,
  // and the license the record shows. The earlier pipeline's internal fields stay in the Full data only.
  function publicRecordObject(row, detail = {}) {
    const summary = summaryWithDetail({ ...detail, ...row }, detail);
    const metricSummary = metricSummaryFor(summary, detail);
    const v2Record = isV2Row(summary) || String(detail.verification_method || "").startsWith(v2Method);
    const proof = v2ProofFacts(summary, detail);
    const { notes, unitCautions } = measurementNotes(summary, detail, { proof });
    const text = (value) => {
      const clean = publicEvidenceString(value == null ? "" : String(value)).trim();
      return clean && !/^(?:unknown|not reported|n\/a)$/i.test(clean) ? clean : null;
    };
    const ids = (list, single) => uniqueReferenceValues(Array.isArray(list) ? list.filter(Boolean) : (single ? [single] : []),
      { caseInsensitive: list === detail.supporting_dois });
    const value = (field) => (metricHasValue(metricSummary, field) ? Number(shownValueText(metricSummary, field)) : null);
    const unit = (field) => (metricHasValue(metricSummary, field) ? plainUnit(metricUnit(metricSummary, field)) || null : null);
    const temperature = formatTemperature(summary);
    const ph = formatPh(summary);
    // Against the databases (section G), as the record says it: each value's result, or the earlier review's changes.
    const check = recordCheck(summary);
    const databaseComparison = (v2Record && proof ? proof.lines : []).map((line) => {
      const facts = databaseFacts(line) || sideFileDatabaseFacts(check?.db?.[line.metric], line.metric);
      if (!facts) return null;
      const result = databaseResult(facts.status);
      const phrase = facts.phraseOnly ? facts.sentence.charAt(0).toUpperCase() + facts.sentence.slice(1) : "";
      return {
        metric: line.metric,
        result: phrase || result?.word || null,
        line: phrase ? null : facts.sentence || null,
        databases: facts.databases || null,
        cause: facts.cause || null,
        evidence: facts.evidence || null,
      };
    }).filter(Boolean);
    const databaseNotes = (Array.isArray(detail.database_note) ? detail.database_note : [detail.database_note])
      .map((note) => shownText(note)).filter(Boolean);
    const earlierCorrections = v2Record ? [] : correctionItems(detail, check).map((item) => {
      const field = CORRECTION_FIELDS[item.field.toLowerCase().replace(/\s+/g, "")];
      const change = field ? changeWords(item) : null;
      return {
        field: item.field,
        before: item.before ?? null,
        after: item.after ?? null,
        unit: item.unit ? plainUnit(item.unit) || item.unit : null,
        change: change ? [change.word, change.factor].filter(Boolean).join(" ") : null,
        evidence: item.why && !looksLikeLocalPath(item.why) ? item.why : null,
      };
    });
    const record = {
      record_key: summary.record_key || summary.measurement_key || null,
      enzyme_display_name: text(summary.enzyme_display_name),
      ec_number: text(summary.ec_number),
      organism: text(summary.organism),
      substrate_name: text(summary.substrate_name),
      mutation_signature: mutationSignature(summary) || null,
      enzyme_form: enzymeFormLabel(summary) || null,
      kcat: value("kcat"),
      kcat_unit: unit("kcat"),
      km: value("km"),
      km_unit: unit("km"),
      kcat_over_km: value("kcat_over_km"),
      kcat_over_km_unit: unit("kcat_over_km"),
      kcat_over_km_origin: metricHasValue(metricSummary, "kcat_over_km") ? summary.kcat_over_km_origin || null : null,
      temperature_c: temperature === EMPTY_VALUE ? null : Number(temperature),
      ph: ph === EMPTY_VALUE ? null : Number(ph),
      assay_conditions_summary: text(detail.assay_conditions_summary),
      condition_note: conditionNoteText(summary, detail) || null,
      cautions: notes.map((note) => note.text),
      review_result: rowStatusLabel(summary, { exact: true }),
      source: v2Record ? SOURCE_CATLOG_LABEL : recordSourceName(summary.source_db || detail.source_db),
      tags: [
        summary.verification_status === "corrected" ? "corrected" : "",
        hasNoPaperLinked(summary) ? "no paper linked" : "",
        isHumanChecked(summary) ? "human-checked" : "",
      ].filter(Boolean),
      method: v2Record
        ? v2MethodSentence(proof?.facts, { unitChanged: unitCautions.length > 0 })
        : reviewOutcome(summary, detail),
      check: proof ? v2CheckText(proof.facts, v2CheckOptions(summary, detail, proof)) || null : null,
      ai_audit: (proof && v2AuditText(proof.lines, proof.facts)) || sideFileAuditText(check) || null,
      values_as_printed: proof ? proof.lines.map((line, index) => {
        const fact = proof.facts[index];
        return {
          metric: line.metric,
          as_printed: fact.printed || null,
          location: v2LinePlace(line) || null,
          conversion: fact.conversion || null,
          check: valueCheckText(fact, {}) || null,
        };
      }) : null,
      database_comparison: databaseComparison,
      database_note: databaseNotes.join(" ") || null,
      earlier_corrections: earlierCorrections,
      human_review: humanReviewNote(summary) || null,
      paper_title: paperTitleText(summary, detail) || null,
      pubmed_ids: ids(detail.supporting_pmids, detail.pubmed_id),
      dois: ids(detail.supporting_dois, detail.doi),
      primary_uniprot_id: text(summary.primary_uniprot_id || detail.uniprot_id),
      sequence: text(detail.sequence),
      smiles: text(detail.smiles),
      source_db: summary.source_db || detail.source_db || null,
      source_license: detailLicense(summary, detail, v2Record),
    };
    if (!proof) {
      delete record.check;
      delete record.values_as_printed;
    }
    // An older record has an AI audit line only when the snapshot's record checks give one.
    if (!proof && !record.ai_audit) delete record.ai_audit;
    // Only what the snapshot carries: no empty comparison or corrections.
    if (!databaseComparison.length) delete record.database_comparison;
    if (!record.database_note) delete record.database_note;
    if (!earlierCorrections.length) delete record.earlier_corrections;
    return record;
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
      throw new Error(RECORD_NOT_LOADED);
    }
    return detail;
  }

  // Export results: the filtered records as CSV (all of them, or this page) built here from the loaded index, or this
  // page as JSON, each record as Download record saves it (publicRecordObject, from the records' detail files). The CSV
  // keeps the stored digits, the catalog units and the words the table shows.
  const DOWNLOAD_PAGE_LABEL = "<strong>This page (JSON)</strong><span>Each record on this page as Download record saves it</span>";
  // Plain-text unit for a file: s^(-1)*mM^(-1) -> s^-1 mM^-1.
  function plainUnit(value) {
    return String(value || "").replace(/\^\(([−-]?\d+(?:\.\d+)?)\)/g, "^$1").replace(/\*/g, " ").trim();
  }
  const CSV_COLUMNS = [
    ["record_key", (row) => row.record_key],
    ["enzyme_display_name", (row) => row.enzyme_display_name],
    ["ec_number", (row) => row.ec_number],
    ["organism", (row) => row.organism],
    ["substrate_name", (row) => row.substrate_name],
    // The grey note under the substrate ("+10 mM FBP", "no effector"): what tells look-alike records of a paper apart.
    ["condition_note", (row) => conditionNoteText(row)],
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
    // A leading + or - is a formula too ("+G212"), unless the cell is a plain number.
    if (/^[=+\-@\t\r]/.test(text) && !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) text = `'${text}`;
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
    if (button?.disabled) return;
    // A search typed a moment ago (still waiting for its pause) is applied first, so the file holds what it finds.
    if (state.filterTimerPending && state.recordsReady) {
      window.clearTimeout(state.filterTimer);
      state.filterTimerPending = false;
      await ensureCurrentFilters();
    }
    const rows = scope === "all" ? state.filtered : currentPageRows();
    if (!rows.length) {
      syncExportControls();
      return;
    }
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
      const records = rows.map((row, index) => publicRecordObject(row, details[index] || {}));
      const payload = {
        metadata: {
          name: "CatLog page export",
          generated_at: new Date().toISOString(),
          snapshot_generated_at: manifest.generated_at || null,
          source_sha256: manifest.source_sha256 || null,
          export_scope: "current_page_public_records",
          page,
          row_count: records.length,
          data_id: snapshotDataId(),
          note: "One object per record, as Download record saves it. The Full data holds every field.",
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

  // Stats (design spec section 6): the agreement with human reviewers first, then numbered figures and tables. Every
  // count is exact and counted over all records. Colours are stylesheet tokens, named by the stats-part-* classes:
  // review results (stats-part-accepted, -pending, -unverified, -not-reviewed, -not-checked, -disputed), comparisons
  // (-same, -differs, -new, -rounding, -magnitude), -neutral and -open. Figures fill at 60% with a 1px opaque outline.
  function statsDataLine(definition = "") {
    const id = snapshotDataId();
    return [manifest.generated_at ? `Snapshot ${formatDate(manifest.generated_at)}` : "", id ? `Data ID ${id}` : "", definition]
      .filter(Boolean).map(escapeHtml).join(" · ");
  }

  // One numbered figure or table: its heading, the plot, then "Figure N." with one sentence and a data line (snapshot,
  // data ID, definition), then anything that belongs under it (a note, a disclosure).
  function statsFigureHtml({ id, key, title, body, caption, data = "", wide = false, kind = "Figure", number = 0, after = "", className = "" }) {
    return `<section class="stats-section stats-figure-section${wide ? " stats-wide" : ""}${className ? ` ${className}` : ""}" aria-labelledby="${id}" data-figure="${key}">
      <h2 id="${id}">${title}</h2>
      <figure class="stats-fig" aria-labelledby="${id}" aria-describedby="${id}Caption">
        ${body}
        <figcaption id="${id}Caption"><span class="stats-fig-caption"><strong>${kind} ${number}.</strong> ${caption}</span>${data ? `<span class="stats-fig-data">${data}</span>` : ""}</figcaption>
      </figure>${after}</section>`;
  }

  // An axis of three to five steps of 1, 2, 2.5, 3 or 5 × 10ⁿ: the one that ends closest above the largest value.
  function statsNiceScale(max) {
    if (!(max > 0)) return { max: 1, step: 1 };
    let best = null;
    for (let power = 10 ** (Math.floor(Math.log10(max)) - 2); power <= 10 ** Math.ceil(Math.log10(max)); power *= 10) {
      for (const factor of [1, 2, 2.5, 3, 5]) {
        const step = factor * power;
        if (!Number.isInteger(step)) continue;
        const steps = Math.ceil(max / step - 1e-9);
        if (steps < 3 || steps > 5) continue;
        const end = steps * step;
        if (!best || end < best.max - 1e-9 || (Math.abs(end - best.max) < 1e-9 && step > best.step)) best = { max: end, step };
      }
    }
    return best || { max, step: max };
  }

  // A 16px bar: segments left to right (or each from the left, `overlay`), each a share of `scale`, over 1px reference
  // lines at `refs` (percent of the axis).
  function statsTrack(segments, scale, { refs = [0], overlay = false } = {}) {
    let left = 0;
    const parts = segments.map((segment) => {
      const start = overlay ? 0 : left;
      const width = scale > 0 ? Math.max(0, Math.min(100 - start, segment.count / scale * 100)) : 0;
      if (!overlay) left += width;
      return width > 0
        ? `<span class="stats-seg stats-part-${segment.part}" style="left:${+start.toFixed(4)}%;width:${+width.toFixed(4)}%"${segment.title ? ` title="${escapeHtml(segment.title)}"` : ""}></span>`
        : "";
    }).join("");
    return `<span class="stats-track" aria-hidden="true">${refs.map((ref) => `<i class="stats-ref" style="left:${ref}%"></i>`).join("")}${parts}</span>`;
  }

  // Legend above a plot, in segment order: a 10×10 swatch and the name (and a count, when given).
  function statsLegend(items) {
    // Name and count share one span, so a name that wraps keeps its count right after it.
    return `<ul class="stats-legend">${items.map((item) => `<li><i class="stats-swatch stats-part-${item.part}" aria-hidden="true"></i><span>${item.label}${item.count !== undefined ? ` <span class="stats-legend-count">${formatInteger(item.count)}</span>` : ""}</span></li>`).join("")}</ul>`;
  }

  function statsAxis(scale, step, { percent = false } = {}) {
    const ticks = [];
    for (let value = 0; value <= scale + step / 2; value += step) ticks.push(value);
    return `<div class="stats-chart-axis" aria-hidden="true"><span></span><span class="stats-axis-ticks">${ticks.map((value) => `<span style="left:${+(value / scale * 100).toFixed(4)}%">${percent ? `${Math.round(value)}%` : formatInteger(value)}</span>`).join("")}</span><span></span></div>`;
  }

  // Horizontal bars: per row a label (a link into Browse when one filter opens exactly those records), a bar of one or
  // more segments and a value label; the legend above, an axis below. Percent charts draw each row as 100% of itself.
  function statsBarChart({ key, rows, scale = 0, legend = [], axis = "", percent = false, overlay = false }) {
    const refs = percent ? [0, 25, 50, 75, 100] : [0];
    return `<div class="stats-chart${percent ? " stats-chart-percent" : ""}" data-chart="${key}">
      ${legend.length ? statsLegend(legend) : ""}
      <ul class="stats-chart-rows">${rows.map((row) => `<li class="stats-chart-row" data-row="${escapeHtml(row.key)}" data-count="${row.count}">
        <span class="stats-chart-label">${row.label}${row.note ? `<small>${row.note}</small>` : ""}</span>
        ${statsTrack(row.segments, percent ? row.count : scale, { refs, overlay })}
        <span class="stats-chart-value">${row.value}</span>${row.text ? `<span class="visually-hidden">${escapeHtml(row.text)}</span>` : ""}
      </li>`).join("")}</ul>
      ${axis}
    </div>`;
  }

  // A donut of parts that make one whole (12 o'clock, clockwise, 1px white gaps), the total in its centre.
  function statsDonut(parts, total, { title, unit = "records" } = {}) {
    const cx = 100, cy = 100, outer = 88, inner = 56, full = 2 * Math.PI;
    const point = (radius, angle) => `${+(cx + radius * Math.sin(angle)).toFixed(3)} ${+(cy - radius * Math.cos(angle)).toFixed(3)}`;
    const arc = (from, to) => {
      const large = to - from > Math.PI ? 1 : 0;
      return `M${point(outer, from)}A${outer} ${outer} 0 ${large} 1 ${point(outer, to)}L${point(inner, to)}A${inner} ${inner} 0 ${large} 0 ${point(inner, from)}Z`;
    };
    let angle = 0;
    const paths = [];
    const cuts = new Set();
    for (const part of parts) {
      if (!(part.count > 0) || !(total > 0)) continue;
      const sweep = part.count / total * full;
      const whole = sweep >= full - 1e-9;
      // A whole ring is drawn as two halves: an arc cannot start and end at the same point.
      const d = whole ? `${arc(0, Math.PI)}${arc(Math.PI, full)}` : arc(angle, Math.min(full, angle + sweep));
      paths.push(`<path class="stats-part-${part.part}" d="${d}"><title>${escapeHtml(`${part.label}: ${formatInteger(part.count)} (${statsShare(part.count, total)})`)}</title></path>`);
      if (!whole) {
        cuts.add(+angle.toFixed(6));
        cuts.add(+Math.min(full, angle + sweep).toFixed(6) % +full.toFixed(6));
      }
      angle += sweep;
    }
    const gaps = [...cuts].map((cut) => {
      const [x1, y1] = point(inner - 1, cut).split(" ");
      const [x2, y2] = point(outer + 1, cut).split(" ");
      return `<line class="stats-donut-gap" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    }).join("");
    const description = parts.filter((part) => part.count > 0).map((part) => `${part.label} ${formatInteger(part.count)} (${statsShare(part.count, total)})`).join("; ");
    return `<svg class="stats-donut" viewBox="0 0 200 200" role="img" aria-label="${escapeHtml(`${title}: ${formatInteger(total)} ${unit}. ${description}.`)}">
      ${paths.join("")}${gaps}
      <text class="stats-donut-total" x="100" y="100">${formatInteger(total)}</text>
      <text class="stats-donut-unit" x="100" y="120">${escapeHtml(unit)}</text>
    </svg>`;
  }

  // A compact table (Stats tables 1-4): name (a link into Browse when there is one) with an optional one-line meaning,
  // an 80px bar, the count, and its share of all records (or a second count). Bars are drawn against `scale`.
  function statsTable(items, total, { scale = total, extra = null, head = "", part = "neutral" } = {}) {
    return `<table class="stats-table">
      <thead><tr><th scope="col">${escapeHtml(head)}</th><th scope="col" class="stats-col-bar"><span class="visually-hidden">Bar</span></th><th scope="col" class="stats-num">Records</th><th scope="col" class="stats-num">${escapeHtml(extra ? extra.head : "Share")}</th></tr></thead>
      <tbody>${items.map((item) => {
        const width = scale > 0 ? Math.max(0, Math.min(100, item.count / scale * 100)) : 0;
        const last = extra ? formatInteger(item[extra.key]) : escapeHtml(statsShare(item.count, total));
        return `<tr class="${item.sub ? "stats-row-sub" : item.group ? "stats-row-group" : ""}" data-stat-key="${escapeHtml(item.value)}" data-count="${item.count}">
          <th scope="row"><span class="stats-name"><span>${statsNameHtml(item)}${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}</span></span></th>
          <td class="stats-col-bar" aria-hidden="true">${item.group ? "" : `<span class="stats-minibar"><span class="stats-seg stats-part-${item.part || part}" style="width:${+width.toFixed(4)}%"></span></span>`}</td>
          <td class="stats-num">${formatInteger(item.count)}</td><td class="stats-num stats-muted">${last}</td></tr>`;
      }).join("")}</tbody></table>`;
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
    const cohorts = [["manual_review_required", "Not confirmed"], ["unverified", "Unverified"], ["mathematically_inferred", "Not reviewed"]]
      .map(([value, label]) => ({ value, label, group: statsCohortData(value, counts[value] || 0) }))
      .filter((item) => item.group && item.group.total > 0);
    if (!cohorts.length) return "";
    const fields = [["with_kinetic_value", "Kinetic value"], ["with_literature_id", "Paper ID"], ["with_sequence", "Protein sequence"], ["with_smiles", "Substrate SMILES"]];
    return `<details class="stats-explanation stats-unaccepted-fields"><summary>Fields saved in records that are not accepted</summary>
      <table class="stats-detail-table"><thead><tr><th scope="col">Field</th>${cohorts.map((item) => `<th scope="col">${escapeHtml(item.label)}<small>${formatInteger(item.group.total)}</small></th>`).join("")}</tr></thead>
      <tbody>${fields.map(([key, label]) => `<tr data-field="${key}"><th scope="row">${label}</th>${cohorts.map((item) => `<td data-cohort="${item.value}" data-count="${item.group[key]}">${formatInteger(item.group[key])}<small>${escapeHtml(statsShare(item.group[key], item.group.total))}</small></td>`).join("")}</tr>`).join("")}</tbody></table>
      <p>Kinetic value: kcat, Km, Ki or kcat/Km. Paper ID: PMID or DOI. Shares are of each group. A missing field does not give the reason for a review result.</p></details>`;
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
    ["uniprot", "UniProt"], ["sabio_rk", "SABIO-RK"], ["skid", "SKiD"], ["strenda", "STRENDA DB"],
  ];
  const STATS_SOURCE_KEYS = { earlier_paper: "paper", unrecorded: "other" };

  function statsSources(overview) {
    const counts = {};
    const given = overview?.sources;
    if (given && typeof given === "object") {
      for (const [key] of statsSourceNames) counts[key] = statsCount(given[key]) || 0;
      counts.other = statsCount(given.other) || 0;
      // An overview from before STRENDA DB had its own count holds it in "other".
      if (!("strenda" in given)) counts.unsplit = true;
    } else {
      for (const [label, count] of Object.entries(manifestDistribution("source_db"))) {
        const bits = rowSourceBits({ source_db: label });
        const keys = [...new Set(sourceFilters.filter((item) => bits & item.bit).map((item) => STATS_SOURCE_KEYS[item.value] || item.value))];
        for (const key of keys.length ? keys : ["other"]) counts[key] = (counts[key] || 0) + count;
      }
    }
    // Records read from the paper by CatLog (source=paper opens exactly these) apart from the earlier paper extractions
    // (source=earlier_paper, under By database). Without the snapshot's count of the first, papers are one row without a
    // link, since no single Browse filter opens both.
    const v2 = statsCount(overview?.from_paper?.records, counts.paper || 0);
    const paperItems = v2 !== null
      ? [{ value: "source_catlog", label: SOURCE_CATLOG_LABEL, count: v2, params: { source: "paper" } },
        { value: "source_paper_earlier", label: "Earlier paper extractions", count: (counts.paper || 0) - v2, params: { source: "earlier_paper" } }]
      : [{ value: "source_paper", label: "From papers", count: counts.paper || 0 }];
    return [
      ...paperItems,
      ...statsSourceNames.filter(([key]) => key !== "paper").map(([key, label]) => ({ value: `source_${key}`, label, count: counts[key] || 0, params: { source: key } })),
      counts.unsplit
        ? { value: "source_other", label: "Other", note: "Another database, or not recorded", count: counts.other || 0 }
        : { value: "source_unrecorded", label: "Source not recorded", count: counts.other || 0, params: { source: "unrecorded" } },
    ].filter((item) => item.count > 0);
  }

  // The main source of each record (figure 2), as build_overview counts it (main_sources): CatLog's own reading, one
  // database, several databases, or none. Without those counts in the snapshot, the same groups from the manifest's
  // source_db counts (no review result per group).
  const STATS_MAIN_SOURCES = [
    ["catlog", SOURCE_CATLOG_LABEL], ["brenda", "BRENDA"], ["oed", "OED"], ["uniprot", "UniProt"],
    ["sabio_rk", "SABIO-RK"], ["skid", "SKiD"], ["strenda", "STRENDA DB"], ["earlier_paper", "Earlier paper extractions"],
    ["several", "Several databases"], ["unrecorded", "Source not recorded"],
  ];
  // Groups too small for a bar of their own are counted together as Other (their counts are named in its note).
  const STATS_MAIN_OTHER = new Set(["strenda", "earlier_paper", "unrecorded"]);

  function statsMainSources(overview, total, counts) {
    const given = overview?.main_sources;
    const known = new Set(STATS_MAIN_SOURCES.map(([key]) => key));
    if (given && typeof given === "object" && Object.keys(given).every((key) => known.has(key))) {
      const statusSums = {};
      let sum = 0;
      const groups = {};
      for (const [key, statuses] of Object.entries(given)) {
        if (!statuses || typeof statuses !== "object") return null;
        const group = {};
        for (const [status, count] of Object.entries(statuses)) {
          if (statsCount(count, total) === null) return null;
          group[status] = count;
          statusSums[status] = (statusSums[status] || 0) + count;
          sum += count;
        }
        groups[key] = group;
      }
      const matches = sum === total && Object.entries(counts).every(([status, count]) => (statusSums[status] || 0) === count)
        && Object.keys(statusSums).every((status) => status in counts);
      if (matches) return { groups, byStatus: true };
    }
    // Fallback: the manifest's source_db counts, grouped the same way (CatLog's records are the from-paper count).
    const groups = {};
    const v2 = statsCount(overview?.from_paper?.records, total);
    for (const [label, count] of Object.entries(manifestDistribution("source_db"))) {
      const keys = [...new Set(String(label || "").toLowerCase().split(/[;,+/|]+/)
        .map((part) => SOURCE_TOKENS[part.trim().replace(/[\s-]+/g, "_")]).filter(Boolean))];
      const key = !keys.length ? "unrecorded" : keys.length > 1 ? "several" : keys[0];
      groups[key] = { records: (groups[key]?.records || 0) + count };
    }
    if (v2 !== null && (groups.earlier_paper?.records || 0) >= v2) {
      groups.earlier_paper.records -= v2;
      if (v2) groups.catlog = { records: v2 };
    }
    const sum = Object.values(groups).reduce((total_, group) => total_ + group.records, 0);
    return sum === total && total > 0 ? { groups, byStatus: false } : null;
  }

  // Audit and human-review results (overview.quality: copied at build time from the human-review marks file, which the
  // CatLog side writes from its audit record and review results). Each part is shown only when its numbers hold
  // together; Stats and the Guide's method section use the same sentences.
  function qualityShare(part, whole) {
    const percent = part / whole * 100;
    if (percent > 0 && percent < 0.1) return "<0.1%";
    if (percent < 100 && percent > 99.9) return ">99.9%";
    return `${percent.toFixed(1)}%`;
  }

  function auditFacts(overview) {
    const quality = overview?.quality;
    const values = statsCount(quality?.audit_values);
    const wrong = values ? statsCount(quality.audit_wrong, values) : null;
    if (!values || wrong === null) return null;
    const asOf = /^\d{4}-\d{2}-\d{2}/.test(String(quality.as_of || "")) ? formatDate(String(quality.as_of).slice(0, 10)) : "";
    return { values, wrong, date: asOf };
  }

  function auditOutcomeText(audit) {
    if (!audit.wrong) return "none was wrong";
    return `${formatInteger(audit.wrong)} ${audit.wrong === 1 ? "was" : "were"} wrong (${qualityShare(audit.wrong, audit.values)}) and removed`;
  }

  // The headline of the agreement with human reviewers (the user's success measure): the first comparison on the papers
  // CatLog read without any database or earlier-catalog values in view (first_agree_unexposed_pct), when the snapshot
  // has it; else the share of approved values CatLog has now. Null without agreement counts.
  function agreementHeadline(a) {
    const approved = statsCount(a?.values_approved);
    const agree = approved ? statsCount(a.agree, approved) : null;
    if (agree === null) return null;
    const blind = a.first_agree_unexposed_pct;
    const papers = statsCount(a.papers_compared);
    const exposed = papers ? statsCount(a.papers_exposed, papers) : null;
    if (typeof blind === "number" && Number.isFinite(blind) && blind >= 0 && blind <= 100) {
      return { percent: `${blind.toFixed(1)}%`, blind: true, blindPapers: exposed !== null ? papers - exposed : null, approved, agree, papers };
    }
    return { percent: qualityShare(agree, approved), blind: false, approved, agree, papers };
  }

  // How often CatLog and human reviewers agree (quality.agreement, catlog-v2 human_review.AGREEMENT_DEFINITIONS): the
  // reviewers' approved values CatLog has too, and what CatLog's own check against the paper found where they differ.
  function agreementText(a) {
    const headline = agreementHeadline(a);
    if (!headline) return "";
    const { approved, agree, papers } = headline;
    const first = statsCount(a.first_agree, approved);
    let text = headline.blind
      ? `At the first comparison, on ${headline.blindPapers !== null ? `the ${formatInteger(headline.blindPapers)} papers` : "the papers"} CatLog read without database or earlier-catalog values in view, CatLog had the same value as the reviewers for ${headline.percent} of the values they approved. `
      : "";
    if (headline.blind || first !== null) {
      text += `${papers ? `On all ${formatInteger(papers)} papers human reviewers checked that CatLog has since read, ` : ""}${first !== null ? `CatLog had ${formatInteger(first)} of the ${formatInteger(approved)} approved values at the first comparison (${qualityShare(first, approved)}) and has ${formatInteger(agree)} now, after fixes (${qualityShare(agree, approved)}).` : `CatLog has the same value for ${formatInteger(agree)} of the ${formatInteger(approved)} values the reviewers approved (${qualityShare(agree, approved)}).`}`;
    } else {
      text += `${papers ? `On ${formatInteger(papers)} papers human reviewers checked that CatLog has since read, CatLog` : "CatLog"} has the same value for ${formatInteger(agree)} of the ${formatInteger(approved)} values the reviewers approved (${qualityShare(agree, approved)}).`;
    }
    const differ = statsCount(a.differ, approved);
    const open = differ !== null ? statsCount(a.differ_not_adjudicated, differ) : null;
    const right = differ !== null ? statsCount(a.differ_catlog_right, differ) : null;
    const wrong = differ !== null ? statsCount(a.differ_catlog_wrong, differ) : null;
    if (differ && open !== null && right !== null && wrong !== null && right + wrong <= differ - open) {
      const checked = differ - open;
      const other = checked - right - wrong;
      text += ` Of the ${formatInteger(differ)} that differ, ${formatInteger(checked)} were checked against the paper: CatLog was right in ${formatInteger(right)} and wrong in ${wrong ? formatInteger(wrong) : "none"}${other ? `; ${formatInteger(other)} are the same value under another name, a rounding, or a value CatLog leaves out by its reading rules` : ""}${open ? `. ${formatInteger(open)} are not checked yet` : ""}.`;
    }
    return text;
  }

  // What reviewers found when they compared values with their papers. The share correct is never shown without the
  // label errors beside it.
  function earlierCatalogText(quality) {
    const compared = statsCount(quality?.compared_values_v1);
    const wrong = compared ? statsCount(quality.wrong_v1, compared) : null;
    const labels = compared ? statsCount(quality.label_or_annotation_v1, compared) : null;
    if (!compared || wrong === null || labels === null) return "";
    return `In the earlier catalog, ${formatInteger(wrong)} of ${formatInteger(compared)} values reviewers compared had a wrong number or unit (${qualityShare(compared - wrong, compared)} correct), and ${formatInteger(labels)} had a wrong enzyme, organism, substrate, variant or protein label.`;
  }

  function humanComparisonText(overview) {
    const quality = overview?.quality || {};
    const parts = [];
    const earlier = earlierCatalogText(quality);
    if (earlier) parts.push(earlier);
    const agreement = agreementText(quality.agreement);
    if (agreement) return [agreement, ...parts].join(" ");
    const approved = statsCount(quality.v2_approved_total);
    const found = approved ? statsCount(quality.v2_found, approved) : null;
    const differed = statsCount(quality.v2_differences_checked);
    const differedWrong = differed ? statsCount(quality.v2_wrong, differed) : null;
    if (approved && found !== null) {
      const differences = differedWrong !== null
        ? `; ${differedWrong ? formatInteger(differedWrong) : "none"} of the ${formatInteger(differed)} values where it differed ${differedWrong > 1 ? "were" : "was"} wrong against the paper`
        : "";
      parts.push(`CatLog found ${formatInteger(found)} of the ${formatInteger(approved)} values reviewers approved${differences}.`);
    }
    return parts.join(" ");
  }

  // The parts of the reviewers' approved values (the lead's bar): the same value, then the differences as CatLog's own
  // check against the paper split them. Null when the split does not add up (the bar then shows same and different only).
  function agreementParts(a, approved, agree) {
    const differ = statsCount(a.differ, approved);
    if (differ === null || agree + differ !== approved) return null;
    const pick = (key) => statsCount(a[key], differ);
    const parts = [
      { part: "same", label: "Same value", count: agree },
      { part: "differs", label: "The paper shows CatLog right", count: pick("differ_catlog_right") },
      { part: "rounding", label: "The same printed value, another name or rounded",
        count: pick("differ_same_value_other_name") === null || pick("differ_rounding") === null ? null : pick("differ_same_value_other_name") + pick("differ_rounding") },
      { part: "neutral", label: "Left out by CatLog's reading rules", count: pick("differ_not_comparable") },
      { part: "magnitude", label: "The paper shows CatLog wrong", count: pick("differ_catlog_wrong") },
      { part: "open", label: "Not checked against the paper yet", count: pick("differ_not_adjudicated") },
    ];
    if (parts.some((item) => item.count === null) || parts.slice(1).reduce((sum, item) => sum + item.count, 0) !== differ) return null;
    return parts;
  }

  // The lead of Stats (the user's headline measure, 2026-10-12): how often CatLog and human reviewers agree. Empty when
  // the snapshot has no agreement counts.
  function agreementLeadHtml(overview) {
    const a = overview?.quality?.agreement;
    const headline = agreementHeadline(a);
    if (!headline) return "";
    const { approved, agree, papers } = headline;
    const first = statsCount(a.first_agree, approved);
    const fixed = statsCount(a.fixed_after_comparison, approved);
    const wrong = statsCount(a.catlog_value_wrong);
    const stated = statsCount(a.stated_values);
    const statedHas = stated ? statsCount(a.stated_values_catlog_has, stated) : null;
    const lead = headline.blind
      ? `At the first comparison, on ${headline.blindPapers !== null ? `the ${formatInteger(headline.blindPapers)} papers` : "the papers"} CatLog read without database or earlier-catalog values in view, CatLog had the same value as the reviewers for ${headline.percent} of the values they approved.`
      : `CatLog has the same value for ${formatInteger(agree)} of the ${formatInteger(approved)} values human reviewers approved${papers ? `, on ${formatInteger(papers)} papers they checked that CatLog has since read` : ""}.`;
    const facts = [
      ["Values approved", `${formatInteger(approved)}${papers ? ` on ${formatInteger(papers)} papers` : ""}`],
      first !== null ? ["First comparison", `${formatInteger(first)} the same (${qualityShare(first, approved)})`] : null,
      // (without a first comparison, the big number and the sentence already give the same value count)
      first !== null || headline.blind ? ["Now, after fixes", `${formatInteger(agree)} (${qualityShare(agree, approved)})`] : null,
      fixed !== null ? ["Fixed after the comparison", formatInteger(fixed)] : null,
      wrong !== null ? ["Wrong number or unit in CatLog", formatInteger(wrong)] : null,
      stated && statedHas !== null ? ["Missing values reviewers named", `${formatInteger(stated)}; CatLog has ${formatInteger(statedHas)}`] : null,
    ].filter(Boolean);
    const parts = agreementParts(a, approved, agree)
      || [{ part: "same", label: "Same value", count: agree }, { part: "neutral", label: "Different or missing", count: approved - agree }];
    const shown = parts.filter((item) => item.count > 0);
    const bar = `<div class="stats-lead-bar">
        <p class="stats-lead-bar-title">${first !== null || headline.blind ? "Approved values now" : "Approved values"} <span class="stats-muted">(${formatInteger(approved)})</span>: the same in CatLog, or where CatLog differs, what its check against the paper found</p>
        ${statsTrack(shown.map((item) => ({ part: item.part, count: item.count, title: `${item.label}: ${formatInteger(item.count)}` })), approved, { refs: [0, 25, 50, 75, 100] })}
        ${statsLegend(shown)}
      </div>`;
    // Where the paper shows CatLog right, what was wrong in the earlier catalog (as the README says it).
    const right = statsCount(a.differ_catlog_right, approved);
    const valueError = right ? statsCount(a.differ_earlier_value_error, right) : null;
    const labelError = right ? statsCount(a.differ_earlier_label_error, right) : null;
    const rightText = valueError !== null && labelError !== null && valueError + labelError === right
      ? `In the ${formatInteger(right)} differences where the paper shows CatLog right, the earlier catalog's value is not printed in the paper (${formatInteger(valueError)}) or has a wrong enzyme, organism, substrate, variant or protein label (${formatInteger(labelError)}).`
      : "";
    // Values reviewers called wrong, and what became of them (each part only when the counts add up).
    const rejected = statsCount(a.rejected_values);
    let rejectedText = "";
    if (rejected) {
      const without = statsCount(a.rejected_catlog_also_without, rejected);
      const same = statsCount(a.rejected_catlog_has_same, rejected);
      const dropped = statsCount(a.rejected_dropped_after_audit, rejected);
      const kept = same !== null ? statsCount(a.rejected_kept_after_audit, same) : null;
      const cleared = same !== null ? statsCount(a.rejected_cleared_by_paper_check, same) : null;
      const pending = same !== null ? statsCount(a.rejected_pending, same) : null;
      if (without !== null && same !== null && dropped !== null && without + same + dropped === rejected) {
        const settled = kept !== null && cleared !== null && pending !== null && kept + cleared + pending <= same
          ? ` (an AI audit kept ${formatInteger(kept)}, a check against the paper found ${formatInteger(cleared)} right${pending ? `, ${formatInteger(pending)} not settled yet` : ""})`
          : "";
        rejectedText = `Reviewers called ${formatInteger(rejected)} values wrong on these papers: CatLog does not have ${formatInteger(without)} of them; it has ${formatInteger(same)} with the same number${settled}; ${formatInteger(dropped)} it had were dropped after an AI audit found them wrong.`;
      }
    }
    // Objections that dispute no value shown (a value missing, a duplicate, the DOI, a name): counted, never as failures.
    const notValue = statsCount(a.rejected_not_value);
    if (notValue) {
      rejectedText += `${rejectedText ? " " : ""}${formatInteger(notValue)} other ${notValue === 1 ? "objection disputes" : "objections dispute"} no value shown (a value missing, a duplicate, the DOI or a name).`;
    }
    // Records read by CatLog that reviewers checked directly.
    const direct = statsCount(a.direct_values_reviewed);
    let directText = "";
    if (direct) {
      const yes = statsCount(a.direct_values_agree, direct);
      const no = statsCount(a.direct_values_disagree, direct);
      const audited = no ? statsCount(a.direct_disagree_wrong_after_audit, no) : null;
      const waiting = no ? statsCount(a.direct_disagree_audit_pending, no) : null;
      if (yes !== null && no !== null && yes + no <= direct) {
        directText = `Reviewers checked ${formatInteger(direct)} values of CatLog's own records directly: they approved ${formatInteger(yes)} and disputed ${formatInteger(no)}${audited !== null && waiting !== null && audited + waiting <= no ? `; an AI audit found ${formatInteger(audited)} of those wrong${waiting ? ` and ${formatInteger(waiting)} are not audited yet` : ""}` : ""}.`;
      }
    }
    return `<section class="stats-section stats-lead stats-wide" aria-labelledby="statsAgreementTitle" data-figure="agreement">
      <h2 id="statsAgreementTitle">Agreement with human reviewers</h2>
      <div class="stats-lead-body">
        <div class="stats-lead-figure"><strong>${escapeHtml(headline.percent)}</strong><span>${headline.blind
          ? "the same value as the reviewers at the first comparison, on papers read without database values in view"
          : "of the values human reviewers approved are the same in CatLog"}</span></div>
        <div class="stats-lead-text">
          <p class="stats-lead-sentence">${escapeHtml(lead)}</p>
          ${bar}
          <dl class="stats-lead-facts">${facts.map(([term, value]) => `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
          ${rightText ? `<p class="stats-lead-note">${escapeHtml(rightText)}</p>` : ""}
          ${rejectedText ? `<p class="stats-lead-note">${escapeHtml(rejectedText)}</p>` : ""}
          ${directText ? `<p class="stats-lead-note">${escapeHtml(directText)}</p>` : ""}
          <p class="stats-fig-data">${statsDataLine(`${a && overview.quality.as_of ? `Counted ${formatDate(String(overview.quality.as_of).slice(0, 10))}. ` : ""}Approved values: kcat, Km and printed kcat/Km values a reviewer approved without objection in the 2026 review of the earlier catalog, on papers CatLog has since read. The same value: the same paper, metric, protein, variant and substrate, and a value within 2%. Differences are split by CatLog's own check against the paper, not by the reviewers.`)}</p>
          <p class="stats-lead-links"><a class="stats-guide-link" href="${escapeHtml(viewUrl("guide-method").href)}">How CatLog reads and checks values <span aria-hidden="true">→</span></a><a class="stats-guide-link" href="${escapeHtml(viewUrl("team").href)}">People behind CatLog <span aria-hidden="true">→</span></a></p>
        </div>
      </div>
    </section>`;
  }

  // The Guide's method section: the audit and human-review items get this snapshot's numbers when it has them (they
  // read without numbers otherwise). The Guide reads only the manifest, never the record index.
  function renderGuideMethod() {
    // The review rules this snapshot follows decide two definitions (Accepted, no paper linked).
    if ($("guideAcceptedDefinition")) $("guideAcceptedDefinition").textContent = stateDescriptions.accepted;
    if ($("guideNoPaperDefinition")) $("guideNoPaperDefinition").textContent = noPaperDefinition();
    const overview = statsOverview(Number(manifest.total_rows || 0));
    const audit = auditFacts(overview);
    if ($("guideMethodAudits") && audit) {
      $("guideMethodAudits").textContent = `${formatInteger(audit.values)} values re-checked against their papers by a separate AI auditor that tries to find errors; ${auditOutcomeText(audit)}.${audit.date ? ` As of ${audit.date}.` : ""}`;
    }
    const counts = manifestDistribution("verification_status");
    const humanChecked = statsCount(overview?.human_checked_accepted, (counts.verified || 0) + (counts.corrected || 0));
    if ($("guideMethodHuman") && humanChecked !== null) {
      const comparison = humanComparisonText(overview);
      // the agreement of CatLog with human reviewers comes first (the user, 2026-10-12)
      $("guideMethodHuman").textContent = `${comparison ? `${comparison} ` : ""}${formatInteger(humanChecked)} accepted records are human-checked: a human reviewer approved every value they show.`;
    }
  }

  // Figures 3-5 (design spec section 6) read counts the CatLog side computes at build time (overview.quality); each is
  // drawn only when its counts hold together, and an older snapshot shows none of them (never an empty heading).
  const STATS_PARAMETERS = [
    ["kcat", "<i>k</i><sub>cat</sub>", "kcat"], ["km", "<i>K</i><sub>m</sub>", "Km"],
    ["kcat_over_km", "<i>k</i><sub>cat</sub>/<i>K</i><sub>m</sub>", "kcat/Km"],
  ];

  function statsPercentRows(groups, partsOf) {
    return groups.map(([key, labelHtml, label, values]) => {
      const parts = partsOf(values);
      const count = parts.reduce((sum, item) => sum + item.count, 0);
      return {
        key, count, label: labelHtml,
        segments: parts.map((item) => ({ part: item.part, count: item.count, title: `${label}, ${item.label}: ${formatInteger(item.count)} (${statsShare(item.count, count)})` })),
        value: `${formatInteger(count)}`,
        text: `${label}: ${parts.map((item) => `${item.label} ${formatInteger(item.count)} (${statsShare(item.count, count)})`).join(", ")}.`,
        shares: parts,
      };
    });
  }

  // Under a percent chart, each row's shares in segment order (exact counts are in the row's hover titles and text).
  function statsShareLines(rows) {
    return `<dl class="stats-share-lines">${rows.map((row) => `<div><dt>${row.label}</dt><dd>${row.shares.map((item) => `<span><i class="stats-swatch stats-part-${item.part}" aria-hidden="true"></i>${escapeHtml(statsShare(item.count, row.count))}</span>`).join("")}</dd></div>`).join("")}</dl>`;
  }

  function statsDbCompareFigure(quality) {
    const data = quality?.db_compare;
    if (!data || typeof data !== "object") return null;
    const groups = [];
    const all = { same: 0, differs: 0, absent: 0 };
    for (const [key, html, label] of STATS_PARAMETERS) {
      const item = data[key];
      if (!item) continue;
      const values = ["same", "differs", "absent"].map((part) => statsCount(item[part]));
      if (values.includes(null)) return null;
      if (!values.some(Boolean)) continue;
      groups.push([key, html, label, values]);
      ["same", "differs", "absent"].forEach((part, index) => { all[part] += values[index]; });
    }
    if (!groups.length) return null;
    groups.push(["all", "All values", "All values", [all.same, all.differs, all.absent]]);
    const names = [["same", "Same number in a database"], ["differs", "A different number"], ["new", "No database value"]];
    const rows = statsPercentRows(groups, (values) => names.map(([part, label], index) => ({ part, label, count: values[index] })));
    const calculated = statsCount(data.calculated ?? data.calculated_not_compared);
    const papersNone = statsCount(data.papers_all_absent);
    const papersSome = statsCount(data.papers_some_absent);
    const notes = [
      "Numbers compared for the same paper and parameter; substrate, variant and conditions are not compared, and a different number does not mean the database is wrong.",
      calculated ? `${formatInteger(calculated)} kcat/Km calculated by CatLog are not compared.` : "",
      papersNone !== null && papersSome !== null ? `No database lists any of these parameters for ${formatInteger(papersNone)} papers, and at least one of them for ${formatInteger(papersSome)} more.` : "",
    ].filter(Boolean).join(" ");
    return {
      id: "statsDbCompareTitle", key: "db-compare", title: "Values read from the paper against the databases",
      body: statsBarChart({ key: "db-compare", rows, legend: names.map(([part, label]) => ({ part, label })), percent: true, axis: statsAxis(100, 25, { percent: true }) }) + statsShareLines(rows),
      caption: "Values CatLog read from the paper, compared with the numbers BRENDA, SABIO-RK, OED, SKiD and STRENDA DB list for the same paper and parameter.",
      data: statsDataLine(notes),
    };
  }

  function statsCorrectionsFigure(quality) {
    const data = quality?.earlier_corrections;
    const records = statsCount(data?.records);
    if (!records || !data.values || typeof data.values !== "object") return null;
    const names = [["rounding", "More digits or rounding"], ["differs", "A different number"], ["magnitude", "Unit or magnitude (× or ÷ 10ⁿ)"], ["new", "Added: the source had none"]];
    const fields = ["rounding", "different", "magnitude", "added"];
    const groups = [];
    for (const [key, html, label] of STATS_PARAMETERS) {
      const item = data.values[key];
      if (!item) continue;
      const values = fields.map((field) => statsCount(item[field]));
      if (values.includes(null)) return null;
      if (values.some(Boolean)) groups.push([key, html, label, values]);
    }
    if (!groups.length) return null;
    const rows = statsPercentRows(groups, (values) => names.map(([part, label], index) => ({ part, label, count: values[index] })));
    const listed = Array.isArray(data.before_listed) && data.before_listed.length === 2 ? data.before_listed : null;
    const listedText = listed && statsCount(listed[1]) && statsCount(listed[0], listed[1]) !== null
      ? `The value before the change equals a number a database lists for that paper for ${formatInteger(listed[0])} of ${formatInteger(listed[1])} changed values (${qualityShare(listed[0], listed[1])}).`
      : "";
    return {
      id: "statsCorrectionsTitle", key: "earlier-corrections", title: "Corrections on records accepted after a correction",
      body: statsBarChart({ key: "earlier-corrections", rows, legend: names.map(([part, label]) => ({ part, label })), percent: true, axis: statsAxis(100, 25, { percent: true }) }) + statsShareLines(rows),
      caption: `Values the earlier review changed to the value the paper prints, on the ${formatInteger(records)} records accepted after a correction, by kind of change.`,
      data: statsDataLine(listedText),
    };
  }

  function statsReplacedFigure(quality) {
    const data = quality?.replaced;
    const records = statsCount(data?.records);
    if (!records || !data.values || typeof data.values !== "object") return null;
    const groups = [];
    for (const [key, html, label] of STATS_PARAMETERS) {
      const pair = data.values[key];
      if (!pair) continue;
      if (!Array.isArray(pair) || pair.length !== 2 || statsCount(pair[1]) === null || statsCount(pair[0], pair[1]) === null) return null;
      if (pair[1]) groups.push([key, html, label, [pair[0], pair[1] - pair[0]]]);
    }
    if (!groups.length) return null;
    const names = [["same", "Same number in CatLog's reading"], ["differs", "Not found by CatLog"]];
    const rows = statsPercentRows(groups, (values) => names.map(([part, label], index) => ({ part, label, count: values[index] })));
    const accepted = statsCount(data.accepted, records);
    const papers = statsCount(data.papers);
    return {
      id: "statsReplacedTitle", key: "replaced", title: "Earlier records of papers CatLog has read",
      body: statsBarChart({ key: "replaced", rows, legend: names.map(([part, label]) => ({ part, label })), percent: true, axis: statsAxis(100, 25, { percent: true }) }) + statsShareLines(rows),
      caption: `The ${formatInteger(records)} earlier ${records === 1 ? "record" : "records"}${accepted !== null ? ` (${formatInteger(accepted)} accepted)` : ""}${papers !== null ? ` of the ${formatInteger(papers)} ${papers === 1 ? "paper" : "papers"}` : " of the papers"} CatLog has read: whether CatLog's reading has the same number for that paper and parameter.`,
      data: statsDataLine("CatLog's records replace a paper's earlier ones. kcat/Km calculated from kcat and Km are left out."),
    };
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
    const humanAccepted = humanAcceptedCount();
    const known = new Set(reviewStatuses.map((item) => item.value));
    const otherStatus = Object.entries(counts).reduce((sum, [key, count]) => sum + (known.has(key) ? 0 : count), 0);

    $("statsScope").textContent = `All ${formatInteger(total)} records in this snapshot. Select a name to see those records in Browse.`;
    $("statsDate").textContent = manifest.generated_at ? `Snapshot ${formatDate(manifest.generated_at)}` : "Snapshot date unavailable";
    const humanChecked = statsCount(overview?.human_checked_accepted, accepted);
    const fromPaper = overview?.from_paper && statsCount(overview.from_paper.records, total);
    const papersRead = statsCount(overview?.from_paper?.papers);
    const main = [
      ["Records", total],
      ["Accepted", accepted, total ? `${statsShare(accepted, total)} of records` : ""],
      [SOURCE_CATLOG_LABEL, fromPaper, papersRead !== null ? `from ${formatInteger(papersRead)} papers` : ""],
      ["Human-checked", humanChecked],
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

    // Figures in reading order; half-width ones stand two to a row from 1024px (an odd one out spans the row).
    const figures = [];

    // Figure 1. Review result: Accepted, Not confirmed, Not checked (Unverified and Not reviewed under it) and Disputed,
    // the words Browse uses; a donut (the one partition that is a true whole) and its legend table.
    const fromPaperAccepted = statsCount(overview?.from_paper?.records, counts.verified || 0);
    const noPaperRule = followsReviewRules();
    const notChecked = (counts.unverified || 0) + (counts.mathematically_inferred || 0);
    const acceptedParts = (fromPaperAccepted !== null
      ? [[SOURCE_CATLOG_LABEL, fromPaperAccepted, "accepted_catlog", { source: "paper" }],
        ["Earlier catalog, as printed", (counts.verified || 0) - fromPaperAccepted - humanAccepted, "accepted_printed"],
        ["Earlier catalog, after a correction", counts.corrected || 0, "accepted_corrected"],
        ["Earlier catalog, every value approved by a human reviewer", humanAccepted, "accepted_human"]]
      : [["As printed", (counts.verified || 0) - humanAccepted, "accepted_printed"], ["After a correction", counts.corrected || 0, "accepted_corrected"],
        ["Every value approved by a human reviewer", humanAccepted, "accepted_human"]])
      .filter(([, count]) => count > 0);
    // Accepted is split in the rows under it (the sentence is the row's title, for a copy of the numbers in words).
    const afterHuman = humanAccepted ? `, ${formatInteger(humanAccepted)} after a human reviewer approved every value` : "";
    const acceptedNote = fromPaperAccepted !== null
      ? `${formatInteger(fromPaperAccepted)} read from the paper by CatLog; ${formatInteger(accepted - fromPaperAccepted)} from the earlier catalog (${formatInteger((counts.verified || 0) - fromPaperAccepted - humanAccepted)} as printed, ${formatInteger(counts.corrected || 0)} after a correction${afterHuman}).`
      : `${formatInteger((counts.verified || 0) - humanAccepted)} as printed, ${formatInteger(counts.corrected || 0)} after a correction${afterHuman}.`;
    const notReviewed = reviewStatuses.find((item) => item.value === "mathematically_inferred");
    const statusItems = [
      { value: "accepted", label: "Accepted", part: "accepted", count: accepted, params: { status: "accepted" }, note: acceptedNote, splitNote: true },
      ...acceptedParts.map(([label, count, value, params]) => ({ value, label, count, params, sub: true, part: "accepted", detail: true })),
      { value: "manual_review_required", label: "Not confirmed", part: "pending", count: counts.manual_review_required || 0,
        params: { status: "curation_pending" }, note: stateDescriptions.curation_pending },
      { value: "not_verified", label: "Not checked", part: "not-checked", group: true, count: notChecked, params: { status: "not_verified" },
        note: "No review result." },
      { value: "unverified", label: "Unverified", part: "unverified", sub: true, count: counts.unverified || 0,
        note: reviewStatuses.find((item) => item.value === "unverified").description },
      { value: "mathematically_inferred", label: "Not reviewed", part: "not-reviewed", sub: true, count: counts.mathematically_inferred || 0,
        // Under the review rules, Not reviewed also holds the records accepted earlier that have no linked paper.
        note: noPaperRule && identityOnly
          ? `${notReviewed.description} Also ${formatInteger(identityOnly)} records the earlier review accepted that have no PMID or DOI linked (no paper linked).`
          : notReviewed.description },
      { value: "disputed", label: "Disputed", part: "disputed", count: counts.disputed || 0, params: { status: "disputed" },
        note: stateDescriptions.disputed },
      ...(otherStatus ? [{ value: "other_status", label: "Other status", part: "neutral", count: otherStatus, note: "Not one of the results above." }] : []),
    ];
    const donutParts = statusItems.filter((item) => !item.detail && !item.group).map((item) => ({ part: item.part, label: item.label, count: item.count }));
    const statusTable = `<table class="stats-table stats-status-table">
      <thead><tr><th scope="col">Review result</th><th scope="col" class="stats-num">Records</th><th scope="col" class="stats-num">Share</th></tr></thead>
      <tbody>${statusItems.map((item) => `<tr class="${item.detail ? "stats-row-detail" : item.sub ? "stats-row-sub" : item.group ? "stats-row-group" : ""}" ${item.detail ? `data-part="${item.value}"` : `data-stat-key="${item.value}"`} data-count="${item.count}"${item.splitNote ? ` title="${escapeHtml(item.note)}"` : ""}>
        <th scope="row"><span class="stats-name">${item.detail ? "" : `<i class="stats-swatch stats-part-${item.part}" aria-hidden="true"></i>`}<span>${statsNameHtml(item)}${item.note && !item.splitNote ? `<small>${escapeHtml(item.note)}</small>` : ""}</span></span></th>
        <td class="stats-num">${formatInteger(item.count)}</td><td class="stats-num stats-muted">${escapeHtml(statsShare(item.count, total))}</td></tr>`).join("")}</tbody></table>`;
    figures.push({
      id: "statsStatusTitle", key: "status", className: "stats-status-section", title: "Review result",
      body: `<div class="stats-donut-layout">${statsDonut(donutParts, total, { title: "Review result of all records" })}${statusTable}</div>`,
      caption: "Review result of every record in this snapshot; each record has exactly one.",
      data: statsDataLine("Shares of all records."),
      after: `${identityOnly ? `<p class="stats-note">${formatInteger(identityOnly)} ${noPaperRule ? "records have no PMID or DOI linked, so their values cannot be traced to a paper; they are counted under Not checked, not Accepted." : "accepted records have no PMID or DOI linked, so their values cannot be traced to a paper."}</p>` : ""}
        ${statsUnacceptedFields(counts)}`,
    });

    // Figure 2. Records by main source: each record once, coloured by review result when the snapshot counts it so.
    const mainSources = statsMainSources(overview, total, counts);
    const sources = statsSources(overview);
    const byDatabase = sources.length
      ? `<div class="stats-by-database"><p>In Browse, a record merged from several databases counts under each of them:</p>
        <ul>${sources.map((item) => `<li data-stat-key="${escapeHtml(item.value)}" data-count="${item.count}">${statsNameHtml(item)} <span class="stats-num">${formatInteger(item.count)}</span></li>`).join("")}</ul></div>`
      : "<p class=\"stats-note\">Source breakdown unavailable in this snapshot.</p>";
    if (mainSources) {
      const { groups, byStatus } = mainSources;
      const statusParts = [
        ["accepted", "Accepted", ["verified", "corrected"]], ["pending", "Not confirmed", ["manual_review_required"]],
        ["not-checked", "Not checked", ["unverified", "mathematically_inferred"]], ["disputed", "Disputed", ["disputed"]],
      ];
      const sumOf = (group, statuses) => statuses.reduce((sum, status) => sum + (group[status] || 0), 0);
      const known = new Set(statusParts.flatMap(([, , statuses]) => statuses));
      const otherKeys = STATS_MAIN_SOURCES.filter(([key]) => STATS_MAIN_OTHER.has(key) && groups[key]);
      const merged = {};
      for (const [key] of STATS_MAIN_SOURCES) {
        if (!groups[key]) continue;
        const target = STATS_MAIN_OTHER.has(key) && otherKeys.length > 1 ? "other" : key;
        merged[target] = merged[target] || {};
        for (const [status, count] of Object.entries(groups[key])) merged[target][status] = (merged[target][status] || 0) + count;
      }
      const recordsOf = (group) => Object.values(group).reduce((sum, count) => sum + count, 0);
      const labels = Object.fromEntries(STATS_MAIN_SOURCES);
      const order = Object.keys(merged).sort((a, b) => {
        const last = (key) => (key === "other" ? 2 : key === "several" ? 1 : 0);
        return last(a) - last(b) || recordsOf(merged[b]) - recordsOf(merged[a]);
      });
      const largest = Math.max(...order.map((key) => recordsOf(merged[key])));
      const { max, step } = statsNiceScale(largest);
      const rows = order.map((key) => {
        const group = merged[key];
        const records = recordsOf(group);
        const label = key === "other" ? "Other" : labels[key];
        const note = key === "other" ? otherKeys.map(([part, name]) => `${name} ${formatInteger(recordsOf(groups[part]))}`).join(", ") : "";
        // Only CatLog's records have one Browse filter that opens exactly them.
        const labelHtml = key === "catlog" && fromPaper === records
          ? `<a class="stats-link" href="${escapeHtml(statsBrowseHref({ source: "paper" }))}">${escapeHtml(label)}</a>` : escapeHtml(label);
        if (!byStatus) {
          return { key, count: records, label: labelHtml, note: escapeHtml(note), segments: [{ part: "neutral", count: records }],
            value: formatInteger(records), text: `${label}: ${formatInteger(records)} records.` };
        }
        const other = Object.entries(group).reduce((sum, [status, count]) => sum + (known.has(status) ? 0 : count), 0);
        const parts = [...statusParts.map(([part, name, statuses]) => ({ part, name, count: sumOf(group, statuses) })),
          ...(other ? [{ part: "neutral", name: "Other status", count: other }] : [])];
        const acceptedCount = parts[0].count;
        return {
          key, count: records, label: labelHtml, note: escapeHtml(note),
          segments: parts.map((item) => ({ part: item.part, count: item.count, title: `${label}, ${item.name}: ${formatInteger(item.count)}` })),
          value: `${formatInteger(records)} <span class="stats-muted">${escapeHtml(statsShare(acceptedCount, records))}</span>`,
          text: `${label}: ${formatInteger(records)} records; ${parts.filter((item) => item.count).map((item) => `${item.name} ${formatInteger(item.count)}`).join(", ")}.`,
        };
      });
      figures.push({
        id: "statsSourcesTitle", key: "main-source", className: "stats-sources-section", title: "Records by main source",
        body: statsBarChart({
          key: "main-source", rows, scale: max, axis: statsAxis(max, step),
          legend: byStatus ? statusParts.map(([part, label]) => ({ part, label })) : [],
        }),
        caption: byStatus
          ? "Records by main source, coloured by review result; each label gives the records, then the share accepted."
          : "Records by main source.",
        data: statsDataLine("Main source: CatLog's own reading of the paper, or the database a record came from; a record merged from several databases counts once, under Several databases."),
        after: byDatabase,
      });
    } else {
      figures.push({ id: "statsSourcesTitle", key: "main-source", className: "stats-sources-section", title: "Source", body: byDatabase,
        caption: "Records per source.", data: statsDataLine() });
    }

    // Figures 3-5: CatLog against the databases, the earlier corrections, and the earlier records CatLog replaced.
    for (const build of [statsDbCompareFigure, statsCorrectionsFigure, statsReplacedFigure]) {
      const figure = build(overview?.quality);
      if (figure) figures.push(figure);
    }

    // Checks on the records read from the paper: one row per kind of check, with a small bar.
    const audit = auditFacts(overview);
    const agreement = agreementHeadline(overview?.quality?.agreement);
    const marked = statsCount(overview?.human_marked, total);
    const quality = overview?.quality || {};
    const compared = statsCount(quality.compared_values_v1);
    const comparedWrong = compared ? statsCount(quality.wrong_v1, compared) : null;
    const labelErrors = compared ? statsCount(quality.label_or_annotation_v1, compared) : null;
    // An older snapshot without the agreement counts: what CatLog found of the reviewers' approved values.
    const approvedV2 = statsCount(quality.v2_approved_total);
    const found = approvedV2 ? statsCount(quality.v2_found, approvedV2) : null;
    const differed = statsCount(quality.v2_differences_checked);
    const foundWrong = differed ? statsCount(quality.v2_wrong, differed) : null;
    const checkRows = [
      fromPaper ? { key: "second_check", name: "Second AI check", count: `<a class="stats-link" href="${escapeHtml(statsBrowseHref({ source: "paper" }))}">${formatInteger(fromPaper)} records</a>${papersRead !== null ? ` from ${formatInteger(papersRead)} papers` : ""}`,
        result: "Every value compared with the paper", share: 1 } : null,
      audit ? { key: "audit", name: "AI audits", count: `${formatInteger(audit.values)} values`,
        result: `${formatInteger(audit.values - audit.wrong)} kept; ${auditOutcomeText(audit)}${audit.date ? ` (as of ${audit.date})` : ""}`, share: (audit.values - audit.wrong) / audit.values } : null,
      agreement ? { key: "agreement", name: "Human reviewers' approved values", count: `${formatInteger(agreement.approved)} values`,
        result: `${formatInteger(agreement.agree)} the same in CatLog (${qualityShare(agreement.agree, agreement.approved)})`, share: agreement.agree / agreement.approved }
        : found !== null ? { key: "agreement", name: "Human reviewers' approved values", count: `${formatInteger(approvedV2)} values`,
          result: `CatLog found ${formatInteger(found)}${foundWrong !== null ? `; ${foundWrong ? formatInteger(foundWrong) : "none"} of the ${formatInteger(differed)} where it differed ${foundWrong > 1 ? "were" : "was"} wrong against the paper` : ""}`, share: found / approvedV2 } : null,
      humanChecked !== null ? { key: "human_checked", name: "Human-checked records", count: `<a class="stats-link" href="${escapeHtml(statsBrowseHref({ checked: "1" }))}">${formatInteger(humanChecked)} accepted records</a>`,
        result: marked !== null && marked >= humanChecked ? `A reviewer approved every value; reviewers looked at ${formatInteger(marked)} records` : "A reviewer approved every value",
        share: marked ? humanChecked / marked : null } : null,
      compared && comparedWrong !== null && labelErrors !== null ? { key: "earlier", name: "Human review of the earlier catalog", count: `${formatInteger(compared)} values`,
        result: `${formatInteger(comparedWrong)} wrong number or unit (${qualityShare(compared - comparedWrong, compared)} correct); ${formatInteger(labelErrors)} wrong label`, share: (compared - comparedWrong) / compared } : null,
    ].filter(Boolean);
    if (checkRows.length) {
      figures.push({
        id: "statsChecksTitle", key: "checks", className: "stats-checks-section", title: "Checks on the values", kind: "Table",
        body: `<table class="stats-table stats-checks-table">
          <thead><tr><th scope="col">Check</th><th scope="col">Checked</th><th scope="col" class="stats-col-bar"><span class="visually-hidden">Share</span></th><th scope="col">Result</th></tr></thead>
          <tbody>${checkRows.map((row) => `<tr data-check="${row.key}"><th scope="row">${escapeHtml(row.name)}</th><td>${row.count}</td>
            <td class="stats-col-bar" aria-hidden="true">${row.share !== null && row.share !== undefined ? `<span class="stats-minibar"><span class="stats-seg stats-part-${row.key === "earlier" ? "neutral" : "same"}" style="width:${+(Math.max(0, Math.min(1, row.share)) * 100).toFixed(4)}%"></span></span>` : ""}</td>
            <td>${escapeHtml(row.result)}</td></tr>`).join("")}</tbody></table>`,
        caption: `${escapeHtml(v2Sentence)} AI audits and human reviewers then check samples against the papers.`,
        data: statsDataLine(),
        after: `<p class="stats-lead-links"><a class="stats-guide-link" href="${escapeHtml(viewUrl("guide-method").href)}">How CatLog reads papers <span aria-hidden="true">→</span></a></p>`,
      });
    }

    // Enzyme classes: records, with the accepted ones drawn over them.
    const classes = Array.isArray(overview?.ec_classes) ? overview.ec_classes.filter((item) => Number.isInteger(item?.class)
      && statsCount(item.count, total) !== null && statsCount(item.accepted, item.count) !== null) : [];
    if (classes.length) {
      const none = statsCount(overview.ec_class_none, total);
      const multiple = statsCount(overview.ec_class_multiple, total);
      const { max, step } = statsNiceScale(Math.max(...classes.map((item) => item.count)));
      const rows = classes.map((item) => ({
        key: `ec_${item.class}`, count: item.count,
        label: `<span class="stats-ec-label" data-stat-key="ec_${item.class}" data-count="${item.count}"><a class="stats-link" href="${escapeHtml(statsBrowseHref({ ec: `${item.class}.` }))}">EC ${item.class}</a><span class="stats-ec-name"> ${escapeHtml(item.name || "")}</span></span>`,
        segments: [{ part: "records", count: item.count, title: `EC ${item.class}: ${formatInteger(item.count)} records` },
          { part: "accepted", count: item.accepted, title: `EC ${item.class}: ${formatInteger(item.accepted)} accepted` }],
        value: `${formatInteger(item.count)} <span class="stats-muted">${formatInteger(item.accepted)}</span>`,
        text: `EC ${item.class} ${item.name || ""}: ${formatInteger(item.count)} records, ${formatInteger(item.accepted)} accepted.`,
      }));
      const notes = [
        multiple ? `${formatInteger(multiple)} records name EC numbers in more than one class and count in each.` : "",
        none ? `${formatInteger(none)} records have no EC class.` : "",
      ].filter(Boolean).join(" ");
      figures.push({
        id: "statsClassesTitle", key: "ec-classes", title: "Enzyme classes",
        body: statsBarChart({ key: "ec-classes", rows, scale: max, overlay: true, axis: statsAxis(max, step),
          legend: [{ part: "records", label: "Records" }, { part: "accepted", label: "Accepted" }] }),
        caption: "Records per enzyme class, with the accepted ones; each label gives the records, then the accepted.",
        data: statsDataLine(notes),
      });
    }

    // Value ranges (full width).
    const ranges = STATS_METRICS.map((metric) => statsValueRange(metric, overview?.metrics?.[metric.key])).filter(Boolean);
    const rangesFigure = ranges.length ? {
      id: "statsRangesTitle", key: "ranges", title: "Value ranges", wide: true,
      body: `<div class="stats-ranges">${ranges.join("")}</div>`,
      caption: "Values in catalog units on a log scale, one bar per power of ten; the end bars include all values beyond them. Dot: median; line: middle 80% of values.",
      data: statsDataLine("Values without a recorded unit, or in a unit other than the catalog's, are left out."),
    } : null;

    // Tables: what the records contain, the most common organisms and EC numbers, wild type and variants, cautions.
    const tables = [];
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
    const topItems = (list, toItem) => (Array.isArray(list) ? list : []).filter((item) => statsCount(item?.count, total) !== null).map(toItem);
    const organisms = topItems(overview?.top_organisms, (item, index) => ({ value: `organism_${index}`, label: String(item.name || ""),
      labelHtml: `<i>${escapeHtml(item.name || "")}</i>`, count: item.count, params: { organism: String(item.name || "") } }));
    const ecNumbers = topItems(overview?.top_ec, (item) => ({ value: `ec_${item.ec}`, label: `${item.ec} ${item.name || ""}`.trim(),
      labelHtml: `<span class="stats-ec-number">${escapeHtml(item.ec)}</span> ${escapeHtml(item.name || "")}`, count: item.count, params: { ec: String(item.ec || "") } }));
    if (organisms.length) {
      tables.push({ id: "statsOrganismsTitle", key: "organisms", title: "Most common organisms", kind: "Table",
        body: statsTable(organisms, total, { scale: organisms[0].count, head: "Organism" }),
        caption: `The ${formatInteger(organisms.length)} organisms with the most records; strains are counted with their species.`, data: statsDataLine("Bars against the most common organism.") });
    }
    if (ecNumbers.length) {
      tables.push({ id: "statsEcTitle", key: "ec-numbers", title: "Most common EC numbers", kind: "Table",
        body: statsTable(ecNumbers, total, { scale: ecNumbers[0].count, head: "EC number" }),
        caption: `The ${formatInteger(ecNumbers.length)} EC numbers with the most records, each with the enzyme name its records use most.`, data: statsDataLine("Bars against the most common EC number.") });
    }
    if (contents.length) {
      const notes = [
        calculated ? `${formatInteger(calculated)} kcat/Km values were calculated as kcat ÷ Km (marked calc. in the table, as is an older kcat/Km of unstated origin that equals kcat ÷ Km).` : "",
        both !== null ? `${formatInteger(both)} records give both temperature and pH.` : "",
      ].filter(Boolean).join(" ");
      tables.push({
        id: "statsContentsTitle", key: "contents", title: "What the records contain", kind: "Table",
        body: statsTable(contents, total, { head: "Value or field" }),
        caption: "Records with each value or field; a record usually has several.",
        data: statsDataLine(notes),
        after: sequences.length ? `<details class="stats-explanation"><summary>Sequence fields</summary><table class="stats-detail-table"><tbody>
          ${sequences.map(([label, count]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${formatInteger(count)}</td><td>${escapeHtml(statsShare(count, total))}</td></tr>`).join("")}
        </tbody></table><p>These overlap: a variant record can have both a wild-type and a variant sequence.</p></details>` : "",
      });
    }
    const form = overview?.enzyme_form || {};
    const forms = [
      { value: "wild", label: "Wild type", count: statsCount(form.wild, total), params: { variant: "wild" } },
      { value: "variant", label: "Variant", count: statsCount(form.variant, total), params: { variant: "variant" }, note: "A mutation is named, or the source marks the enzyme as not wild type." },
      { value: "not_stated", label: "Not stated", count: statsCount(form.not_stated, total) },
    ];
    const caution = overview?.cautions || {};
    // The same names as the Cautions filter.
    const cautions = cautionFilters.map((item) => ({ value: `caution_${item.value}`, label: item.label, labelHtml: item.labelHtml,
      count: statsCount(caution[item.value], total), params: { caution: item.value }, part: item.value === "none" ? "neutral" : "caution" }));
    const formOk = forms.every((item) => item.count !== null) && forms.reduce((sum, item) => sum + item.count, 0) === total;
    const cautionsOk = cautions.every((item) => item.count !== null);
    if (formOk) {
      tables.push({ id: "statsFormTitle", key: "forms", title: "Wild type and variants", kind: "Table", stack: cautionsOk,
        body: statsTable(forms, total, { head: "Enzyme form" }), caption: "Records by enzyme form, as the table's tag says it.", data: "" });
    }
    if (cautionsOk) {
      tables.push({ id: "statsCautionsTitle", key: "cautions", title: "Cautions", kind: "Table", stacked: formOk,
        body: statsTable(cautions, total, { head: "Caution" }), caption: "A caution marks a value that may be wrong; a record can carry more than one.", data: "" });
    }

    // Number in reading order, Figures and Tables apart; place the half-width ones two to a row.
    const numbers = { Figure: 0, Table: 0 };
    const halves = figures.filter((item) => !item.wide);
    if (halves.length % 2) halves[halves.length - 1].wide = true;
    const html = (item) => statsFigureHtml({ ...item, number: ++numbers[item.kind || "Figure"] });
    // The agreement with human reviewers stands first, above the headline counts (the user's success measure); a page
    // without its slot keeps it at the top of the figures.
    const lead = agreementLeadHtml(overview);
    const leadSlot = $("statsLead");
    if (leadSlot) {
      leadSlot.innerHTML = lead;
      leadSlot.hidden = !lead;
    }
    const parts = [leadSlot ? "" : lead, ...figures.map(html)];
    if (rangesFigure) parts.push(html(rangesFigure));
    const tableHtml = [];
    for (let index = 0; index < tables.length; index += 1) {
      const item = tables[index];
      // Wild type and variants stand above Cautions in one column, so a short table leaves no gap.
      if (item.stack && tables[index + 1]?.stacked) {
        tableHtml.push(`<div class="stats-stack">${html(item)}${html(tables[index + 1])}</div>`);
        index += 1;
      } else {
        tableHtml.push(html(item));
      }
    }
    if (tableHtml.length % 2 && tableHtml.length > 1) tableHtml[tableHtml.length - 1] = tableHtml[tableHtml.length - 1].replace('class="stats-section stats-figure-section', 'class="stats-section stats-figure-section stats-wide');
    parts.push(...tableHtml);
    if (overview) {
      parts.push(`<details class="stats-explanation stats-method stats-wide"><summary>How these numbers are counted</summary><dl>
        <div><dt>Papers</dt><dd>Distinct PMIDs; a record without a PMID counts by its DOI.</dd></div>
        <div><dt>Names</dt><dd>Enzymes, organisms and substrates are distinct names, ignoring capitals; "Unknown" is not a name. EC numbers are complete four-part numbers.</dd></div>
        <div><dt>Human-checked</dt><dd>Accepted records where a human reviewer approved every value, as the tag shows.</dd></div>
        <div><dt>Main source</dt><dd>The source a record came from: CatLog's own reading of the paper, one database, or several databases merged into one record.</dd></div>
        <div><dt>Source</dt><dd>All numbers are counted from this snapshot's Full data download and its human-review results.</dd></div>
      </dl></details>`);
    }
    $("statsCharts").innerHTML = parts.filter(Boolean).join("");
  }

  // Team (#team): the people and AI agents behind CatLog and the loop they work in. Drawn from the manifest the first time
  // it is shown, like Stats; never loads the record index. No model or vendor names, first names only, no titles.
  const TEAM_STATIONS = {
    papers: "Papers", reading: "AI reading", check: "AI check", catlog: "CatLog", human: "Human check",
    rules: "Rules updated", website: "Website", paper: "The paper",
  };
  const TEAM_ACTORS = [
    { key: "supantha", name: "Supantha", kind: "person", stations: ["rules", "papers", "catlog", "website"], phrase: "builds CatLog and turns findings into better rules" },
    { key: "aarna", name: "Aarna", kind: "person", stations: ["human"], phrase: "checks values against the papers" },
    { key: "erin", name: "Erin", kind: "person", stations: ["human"], phrase: "checks values against the papers" },
    { key: "mohammad", name: "Mohammad", kind: "person", stations: ["paper"], phrase: "writes the paper and docs" },
    { key: "reading", name: "Reading agents", kind: "ai", stations: ["reading"], phrase: "read each value" },
    { key: "checking", name: "Checking agents", kind: "ai", stations: ["check"], phrase: "check it again, separately" },
    { key: "audit", name: "Audit agents", kind: "ai", stations: ["catlog"], phrase: "re-check samples" },
    { key: "download", name: "Download agent", kind: "ai", stations: ["papers"], phrase: "fetches papers" },
  ];
  // The legend: one line per person or agent (Aarna and Erin share theirs), people first.
  const TEAM_LEGEND = [
    { actors: ["supantha"], text: "<strong>Supantha</strong> builds CatLog and turns findings into better rules" },
    { actors: ["aarna", "erin"], text: "<strong>Aarna</strong> and <strong>Erin</strong> check values against the papers" },
    { actors: ["mohammad"], text: "<strong>Mohammad</strong> writes the paper and docs" },
    { actors: ["reading"], text: "<strong>Reading agents</strong> (AI) read each value" },
    { actors: ["checking"], text: "<strong>Checking agents</strong> (AI) check it again, separately" },
    { actors: ["audit"], text: "<strong>Audit agents</strong> (AI) re-check samples" },
    { actors: ["download"], text: "<strong>Download agent</strong> (AI) fetches papers" },
  ];

  // Two drawings of one loop: wide (stations along a racetrack, AI agents above, people below) and narrow (an upright
  // track for phones and tablets, with the people and agents in the legend beside or under it).
  const TEAM_LAYOUTS = {
    wide: {
      viewBox: "130 30 870 440",
      track: "M270 140 H670 A110 110 0 0 1 670 360 H270 A110 110 0 0 1 270 140 Z",
      stations: {
        papers: { x: 290, y: 140, label: [290, 172, "middle"] },
        reading: { x: 470, y: 140, label: [470, 172, "middle"] },
        check: { x: 650, y: 140, label: [650, 172, "middle"] },
        catlog: { x: 780, y: 250, label: [762, 230, "end"] },
        // stations on the lower straight: their name and numbers stand just above the track
        human: { x: 560, y: 360, label: [560, 0, "middle"], above: true },
        rules: { x: 380, y: 360, label: [380, 0, "middle"], above: true },
        website: { x: 870, y: 160, label: [886, 165, "start"], branch: true },
        paper: { x: 870, y: 340, label: [886, 345, "start"], branch: true },
      },
      arrows: [[380, 140, 0], [470, 360, 180], [160, 250, 270]],
      actors: {
        download: [290, 58], reading: [470, 58], checking: [650, 58], audit: [810, 58],
        supantha: [380, 438], aarna: [515, 438], erin: [605, 438], mohammad: [870, 418],
      },
    },
    narrow: {
      viewBox: "0 0 360 720",
      track: "M80 170 A100 100 0 0 1 280 170 V480 A100 100 0 0 1 80 480 Z",
      stations: {
        papers: { x: 180, y: 70, label: [180, 44, "middle"] },
        reading: { x: 280, y: 210, label: [264, 206, "end"] },
        check: { x: 280, y: 370, label: [264, 366, "end"] },
        catlog: { x: 180, y: 580, label: [180, 508, "middle"] },
        human: { x: 80, y: 440, label: [96, 436, "start"] },
        rules: { x: 80, y: 285, label: [96, 281, "start"] },
        website: { x: 90, y: 650, label: [90, 678, "middle"], branch: true },
        paper: { x: 270, y: 650, label: [270, 678, "middle"], branch: true },
      },
      arrows: [[280, 290, 90], [80, 360, 270]],
      actors: null,
    },
  };

  // Live numbers at the stations, from this snapshot's manifest; a number the snapshot does not have is left out.
  function teamNumbers() {
    const total = Number(manifest.total_rows || 0);
    const overview = statsOverview(total);
    const numbers = {};
    const papers = statsCount(overview?.from_paper?.papers);
    const records = statsCount(overview?.from_paper?.records, total);
    numbers.reading = [papers !== null ? `${formatInteger(papers)} papers read` : "", records !== null ? `${formatInteger(records)} records` : ""].filter(Boolean);
    const audit = auditFacts(overview);
    numbers.catlog = audit ? [`${formatInteger(audit.values)} values re-checked`, "by AI audits"] : [];
    const counts = manifestDistribution("verification_status");
    const humanChecked = statsCount(overview?.human_checked_accepted, (counts.verified || 0) + (counts.corrected || 0));
    const headline = agreementHeadline(overview?.quality?.agreement);
    numbers.human = [humanChecked !== null ? `${formatInteger(humanChecked)} human-checked records` : "", headline ? `${headline.percent} agreement` : ""].filter(Boolean);
    numbers.website = total ? [`${formatInteger(total)} records`] : [];
    return numbers;
  }

  function teamFigureSvg(layoutKey, numbers) {
    const layout = TEAM_LAYOUTS[layoutKey];
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const trackId = `teamTrack-${layoutKey}`;
    const actorsFor = (station) => TEAM_ACTORS.filter((actor) => actor.stations.includes(station)).map((actor) => actor.key).join(" ");
    const branches = Object.entries(layout.stations).filter(([, station]) => station.branch)
      .map(([, station]) => `<line class="team-branch" x1="${layout.stations.catlog.x}" y1="${layout.stations.catlog.y}" x2="${station.x}" y2="${station.y}"/>`).join("");
    const arrows = layout.arrows.map(([x, y, angle]) => `<path class="team-arrow" d="M-5 -5 L4 0 L-5 5" transform="translate(${x} ${y}) rotate(${angle})"/>`).join("");
    const stations = Object.entries(layout.stations).map(([key, station]) => {
      const lines = numbers[key] || [];
      const [lx, at, anchor] = station.label;
      const ly = station.above ? station.y - 22 - lines.length * 18 : at;
      const name = escapeHtml(TEAM_STATIONS[key]);
      const text = `<text class="team-station-name" x="${lx}" y="${ly}" text-anchor="${anchor}">${name}</text>${lines.map((line, index) => `<text class="team-station-number" x="${lx}" y="${ly + (index + 1) * (layoutKey === "wide" ? 18 : 16)}" text-anchor="${anchor}">${escapeHtml(line)}</text>`).join("")}`;
      return `<g class="team-station${station.branch ? " team-station-branch" : ""}" data-station="${key}" data-actors="${actorsFor(key)}" role="img" aria-label="${escapeHtml(`${TEAM_STATIONS[key]}${lines.length ? `: ${lines.join(", ")}` : ""}`)}">
        <circle class="team-station-dot" cx="${station.x}" cy="${station.y}" r="${station.branch ? 6 : 8}"/>${text}</g>`;
    }).join("");
    const actors = layout.actors ? TEAM_ACTORS.map((actor) => {
      const [x, y] = layout.actors[actor.key];
      const width = Math.round(actor.name.length * 8.2 + 28);
      const height = 28;
      // A thin line from the chip to each of its stations on the track (Supantha's to Rules updated only).
      const target = layout.stations[actor.stations[0]];
      const fromY = target.y < y ? y - height / 2 : y + height / 2;
      return `<g class="team-actor team-actor-${actor.kind}" data-actor="${actor.key}" data-stations="${actor.stations.join(" ")}" tabindex="0" role="img" aria-label="${escapeHtml(`${actor.name}${actor.kind === "ai" ? " (AI)" : ""}: ${actor.phrase}. At ${actor.stations.map((key) => TEAM_STATIONS[key]).join(", ")}.`)}">
        <line class="team-link" x1="${x}" y1="${fromY}" x2="${target.x}" y2="${target.y + (target.y < y ? 9 : -9)}"/>
        <rect x="${x - width / 2}" y="${y - height / 2}" width="${width}" height="${height}" rx="${actor.kind === "ai" ? 4 : height / 2}"/>
        <text x="${x}" y="${y + 5}" text-anchor="middle">${escapeHtml(actor.name)}</text></g>`;
    }).join("") : "";
    const dots = reduced ? "" : `<g class="team-dots" aria-hidden="true">${[0, 1, 2, 3, 4, 5].map((index) => `<circle r="4"><animateMotion dur="24s" begin="-${index * 4}s" repeatCount="indefinite"><mpath href="#${trackId}" xlink:href="#${trackId}"/></animateMotion></circle>`).join("")}</g>`;
    const [, , width, height] = layout.viewBox.split(" ");
    return `<svg class="team-loop team-loop-${layoutKey}" viewBox="${layout.viewBox}" width="${width}" height="${height}" role="group" aria-labelledby="teamFigureTitle-${layoutKey}">
      <title id="teamFigureTitle-${layoutKey}">CatLog's loop: papers, AI reading, a separate AI check, CatLog, human check, rules updated, and back to papers; CatLog also feeds the website and the paper.</title>
      <path id="${trackId}" class="team-track" d="${layout.track}"/>
      ${arrows}${branches}${dots}${stations}${actors}
    </svg>`;
  }

  function renderTeam() {
    const numbers = teamNumbers();
    const legendItem = (item) => `<li class="team-legend-item team-legend-${TEAM_ACTORS.find((actor) => actor.key === item.actors[0]).kind}" tabindex="0" data-actor="${item.actors.join(" ")}" data-stations="${[...new Set(item.actors.flatMap((key) => TEAM_ACTORS.find((actor) => actor.key === key).stations))].join(" ")}">
      <i class="team-legend-mark" aria-hidden="true"></i><span>${item.text}<small>At ${escapeHtml([...new Set(item.actors.flatMap((key) => TEAM_ACTORS.find((actor) => actor.key === key).stations))].map((key) => TEAM_STATIONS[key]).join(", "))}</small></span></li>`;
    const people = TEAM_LEGEND.filter((item) => TEAM_ACTORS.find((actor) => actor.key === item.actors[0]).kind === "person");
    const agents = TEAM_LEGEND.filter((item) => TEAM_ACTORS.find((actor) => actor.key === item.actors[0]).kind === "ai");
    $("teamFigure").innerHTML = `${teamFigureSvg("wide", numbers)}${teamFigureSvg("narrow", numbers)}`;
    $("teamLegend").innerHTML = `<div><h2 id="teamPeopleTitle">People</h2><ul aria-labelledby="teamPeopleTitle">${people.map(legendItem).join("")}</ul></div>
      <div><h2 id="teamAgentsTitle">AI agents</h2><ul aria-labelledby="teamAgentsTitle">${agents.map(legendItem).join("")}</ul></div>`;
    const figure = $("teamFigure");
    const view = $("teamView");
    const light = (source) => {
      const actors = new Set(String(source?.dataset?.actor || "").split(" ").filter(Boolean));
      const stations = new Set(String(source?.dataset?.stations || "").split(" ").filter(Boolean));
      view.classList.toggle("team-highlight", Boolean(actors.size));
      for (const element of view.querySelectorAll("[data-station]")) element.classList.toggle("is-lit", stations.has(element.dataset.station));
      for (const element of view.querySelectorAll("[data-actor]")) {
        element.classList.toggle("is-lit", String(element.dataset.actor).split(" ").some((key) => actors.has(key)));
      }
    };
    if (!state.teamBound) {
      state.teamBound = true;
      for (const type of ["pointerover", "focusin"]) {
        view.addEventListener(type, (event) => {
          const source = event.target?.closest?.("[data-actor]");
          if (source && view.contains(source)) light(source);
        });
      }
      view.addEventListener("pointerout", (event) => {
        const source = event.target?.closest?.("[data-actor]");
        if (source && !source.contains(event.relatedTarget)) light(view.contains(document.activeElement) ? document.activeElement.closest?.("[data-actor]") : null);
      });
      view.addEventListener("focusout", (event) => {
        if (!event.relatedTarget?.closest?.("[data-actor]")) light(null);
      });
    }
    figure.dataset.ready = "true";
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
      `${index ? '<span class="suggestion-sep" aria-hidden="true">·</span>' : ""}<button id="catlog-suggestion-${index}" type="button" role="option" tabindex="-1" aria-selected="false" data-value="${escapeHtml(value)}">${escapePublic(value)}</button>`
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
      // A record whose flags belong to no group (a pH flag) has no caution, as Stats counts it.
      row._cautionBits = bits || 16;
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
          else if (failed.length === 1) {
            addFacetCounts(counts, row, failed[0]);
            // Ticking "Only human-checked" ticks Accepted too, so its count includes the human-checked (accepted)
            // records that only the review results chosen leave out.
            if (failed[0] === "state" && isHumanChecked(row)) counts.checked += 1;
          }
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
        <summary>Review result definitions</summary>
        <div class="status-guide-body">
          ${recordStates.map((item) => `<p><strong>${escapeHtml(item.label)}</strong>: ${escapeHtml(stateDescriptions[item.value].replace(/^Passed review: /, "passed review; "))}</p>`).join("")}
          <p><strong>earlier extraction</strong>: ${escapeHtml(EARLIER_EXTRACTION_DEFINITION)}</p>
          <p><strong>human-checked:</strong> ${escapeHtml(HUMAN_CHECKED_DESCRIPTION)} Shown on accepted records only.</p>
          <p><strong>from paper</strong>: ${escapeHtml(v2Sentence)} <a href="#guide-method">How CatLog reads papers<span aria-hidden="true">&nbsp;&rarr;</span></a></p>
          <p><strong>corrected</strong>: ${escapeHtml(CORRECTED_DEFINITION)}</p>
          <p><strong>no paper linked</strong>: ${escapeHtml(noPaperDefinition())}</p>
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
          <p class="filter-note source-help" id="sourceHelp-${item.value}">${escapeHtml(item.help)}${item.guide ? ` <a href="#guide-method">How CatLog reads papers<span aria-hidden="true">&nbsp;&rarr;</span></a>` : ""}</p>` : ""}`).join("")}
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
    differ: "differs", kcat_over_km_quotient_mismatch: "differs", kcat_over_km_source_mismatch: "differs", unit: "units", magnitude: "units",
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

  // A group a filter is set in opens (each group is a <details>), so nothing active is hidden in a closed group.
  function openActiveFilterSections() {
    document.querySelectorAll?.("#catalogFilters .filter-section").forEach((section) => {
      const active = [...section.querySelectorAll("input")].some((input) => {
        if (input.type === "radio") return input.checked && input.value !== "all";
        return input.type === "checkbox" ? input.checked && input.name !== "recordState" : Boolean(String(input.value || "").trim());
      });
      if (active && !section.open) section.open = true;
    });
  }

  // Sets every control from an address (keys it leaves out are cleared); the caller applies the filters.
  function applyBrowseParams(params) {
    const setText = (id, value) => {
      const input = $(id);
      if (input) input.value = String(value ?? "").trim();
    };
    setText("globalSearchInput", params.get("q"));
    // A search the address fills needs no examples over it.
    if ($("globalSearchInput")?.value) hideSuggestions();
    const status = params.has("status") ? listParam(params.get("status")) : [];
    const states = status.filter((value) => recordStates.some((item) => item.value === value));
    const noStates = params.has("status") && !String(params.get("status")).trim();
    // An older link that ticked the three results of its day (Disputed was then inside not_verified) meant all records.
    const olderAll = states.length === 3 && ["accepted", "curation_pending", "not_verified"].every((value) => states.includes(value));
    document.querySelectorAll?.('input[name="recordState"]').forEach((input) => {
      input.checked = !noStates && (!states.length || olderAll || states.includes(input.value));
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
    const anyDatabase = databases.length > 0 || sources.includes("databases");
    // An older link that combined the paper with databases (source=paper,brenda: either one) opens all records.
    const paper = sources.includes("paper") || status.includes("v2");
    if (paper && anyDatabase) setSourceControls("all", []);
    else setSourceControls(anyDatabase ? "databases" : (paper ? "paper" : "all"), databases);
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
  // A bare #record= address has no filters, as on a fresh load. Returns whether a filter pass started.
  function applyLocationFilters() {
    const params = RECORD_HASH.test(window.location.hash || "") ? new Map() : browseParamsFromLocation();
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
      add("status", `Review result: ${names.length ? names.join(", ") : "none"}`, () => setCheckboxes("recordState", recordStates.map((item) => item.value)));
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
      // "Source: BRENDA", "Source: earlier paper extractions", "Source: not recorded" (names keep their capitals).
      const chip = item.value === "unrecorded" ? "not recorded" : item.value === "earlier_paper" ? "earlier paper extractions" : item.label;
      add(`source:${item.value}`, `Source: ${chip}`, () => setSourceControls(others.length ? "databases" : "all", others));
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
    // The count beside Filters: on the phone button, the sidebar's heading and its rail.
    const badges = new Set([$("activeFilterCount"), ...(document.querySelectorAll?.("[data-filter-count]") || [])]);
    badges.forEach((badge) => {
      if (!badge) return;
      badge.textContent = count ? String(count) : "";
      badge.classList.toggle("hidden", count === 0);
    });
    $("openFiltersButton")?.setAttribute("aria-label", count ? `Filters, ${count} active` : "Filters");
    $("filterRailButton")?.setAttribute("aria-label", count ? `Show filters, ${count} active` : "Show filters");
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
        || buttons[Math.min(focusedIndex, buttons.length - 1)];
      if (target) target.focus({ preventScroll: true });
      else focusAfterLastFilter();
    }
  }

  let renderedChipsHtml = "";

  // Removing a filter (a chip, or the empty-results button): focus stays in the chips, or goes where
  // focusAfterLastFilter says when none is left.
  function removeActiveFilter(key, { focusIndex = -1 } = {}) {
    const item = activeFilterItems().find((candidate) => candidate.key === key);
    if (!item) return;
    item.clear();
    state.pendingPage = 0;
    renderActiveFilters();
    const chips = [...($("activeFilters")?.querySelectorAll?.(".filter-chip") || [])];
    if (focusIndex >= 0) {
      const chip = chips[Math.min(focusIndex, chips.length - 1)];
      if (chip) chip.focus({ preventScroll: true });
      else focusAfterLastFilter();
    }
    applyFiltersInBackground();
  }

  // With no filter chip left, focus goes to the search box beside the sidebar or its rail (never to « Hide filters,
  // which the next Enter would press), and to the Filters button on a phone.
  function focusAfterLastFilter() {
    (filtersDocked() ? $("globalSearchInput") : filtersToggleButton())?.focus({ preventScroll: true });
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
    state.filterTimerPending = true;
    // Typing waits this long after the last key, so 169k records are filtered once per pause, not per keystroke.
    state.filterTimer = window.setTimeout(() => {
      state.filterTimerPending = false;
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
  // export gives (condition_note: "+10 mM FBP", "no effector") goes under the substrate. Without one, two records with
  // values on this page that share a paper and every column say only that (the table cannot tell whether their
  // conditions, protein or nothing at all differ).
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
      if (!["kcat", "km", "kcat_over_km"].some((field) => metricHasValue(row, field))) return;
      const papers = [row._pmids, row._dois].map((value) => JSON.stringify(value ?? null)).join("|");
      if (papers === "null|null") return;
      const key = JSON.stringify([...VISIBLE_ROW_FIELDS.map((field) => row[field] ?? null), formatTemperature(row), formatPh(row), papers]);
      groups.set(key, [...(groups.get(key) || []), row.record_key]);
    });
    return new Set([...groups.values()].filter((keys) => keys.length > 1).flat());
  }

  const LOOK_ALIKE_NOTE = "same values as another record of this paper";

  function substrateNoteHtml(row, lookAlikes) {
    const note = conditionNoteText(row) || (lookAlikes.has(row.record_key) ? LOOK_ALIKE_NOTE : "");
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
    const clearResults = $("clearResultsButton");
    if (clearResults) clearResults.hidden = !state.recordsReady || pageRows.length > 0 || awaitingMarks;
    // With no results, "Clear search and filters" stands in for the chips' Clear all: one clear button, not two.
    $("activeFilters")?.classList?.toggle?.("results-empty", Boolean(clearResults && !clearResults.hidden));
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
        const chip = $("activeFilters")?.querySelector?.(".filter-chip");
        if (chip) chip.focus({ preventScroll: true });
        else focusAfterLastFilter();
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
        <td class="c-organism"><span class="clamp-2" title="${escapePublic(recordedName(row.organism))}">${escapePublic(recordedName(row.organism) || EMPTY_VALUE)}</span></td>
        <td class="c-substrate${substrateNote ? " has-note" : ""}"><span class="clamp-2" title="${escapePublic(recordedName(row.substrate_name))}">${escapePublic(recordedName(row.substrate_name) || EMPTY_VALUE)}</span>${substrateNote}</td>
        ${enzymeForm ? `<td class="c-form">${enzymeFormHtml(row, { className: "enzyme-form card-form" })}</td>` : ""}
        <td class="c-kcat num" data-label="kcat (s⁻¹)"><span class="metric-with-note"${valueTitle(row, "kcat")}>${metricDisplayWithUnitHtml(row, "kcat", { table: true })}${valueFlagBadgeHtml(flags, "kcat", row)}</span></td>
        <td class="c-km num" data-label="Km (mM)"><span class="metric-with-note"${valueTitle(row, "km")}>${metricDisplayWithUnitHtml(row, "km", { table: true })}${valueFlagBadgeHtml(flags, "km", row)}</span></td>
        <td class="c-eff num" data-label="kcat/Km (s⁻¹ mM⁻¹)"><span class="metric-with-note"${valueTitle(row, "kcat_over_km")}>${metricDisplayWithUnitHtml(row, "kcat_over_km", { table: true })}${efficiencyOriginHtml(row, { short: true })}${valueFlagBadgeHtml(flags, "kcat_over_km", row)}</span></td>
        ${conditionCellHtml("c-temp", formatTemperature(row), temperatureFlagBadgeHtml(flags))}
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

  // Every refit (new rows, the human-review marks widening Status, a record opening or closing, the sidebar, a resize)
  // also updates the sideways-scroll cues: the sticky Enzyme column, the edge shadows and the scroll buttons.
  function fitTableColumns() {
    fitColumnWidths();
    updateTableScrollControls();
  }

  function fitColumnWidths() {
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
      // Each name's longest word (a name column only), and the narrowest the column can be without breaking one.
      const cellWords = column.shrink ? cells.map((cell) => widestWordWidth(cell.firstElementChild || cell)) : [];
      const wordWidth = column.shrink ? Math.ceil(Math.max(...cellWords) + padding) : min;
      let width = Math.max(min, Math.min(column.cap, Math.ceil(content + padding)));
      if (docked && column.shrink) width = Math.max(width, Math.min(column.cap, wordWidth));
      // A name column's width with every name on one line, and the narrowest that breaks no word.
      const oneLine = Math.max(width, Math.min(column.cap * FIT_ONE_LINE_LIMIT, Math.ceil(widest + padding)));
      const words = column.shrink ? Math.min(width, wordWidth) : min;
      return { ...column, min, width, oneLine, words, cells, cellWords, padding };
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
    // Only a name with a word longer than its column is hyphenated; the others break between words.
    widths.filter((column) => column.shrink).forEach((column) => column.cells.forEach((cell, index) => {
      (cell.firstElementChild || cell).classList.toggle("hyphenate", column.cellWords[index] + column.padding > column.width);
    }));
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

  // From 641px the filters are a sidebar column (open, or its 48px rail); on phones a sheet over the page.
  function filtersDocked() {
    return Boolean(sidebarFiltersMedia.matches);
  }

  // From 1024 to 1599px an open record takes the sidebar's place: the sidebar collapses to its rail and comes back when
  // the record closes. From 1600px both stay open; below 1024px the record is a dialog over the page.
  function recordTakesSidebarPlace() {
    return Boolean(desktopMedia.matches) && !filtersBesideRecordMedia.matches;
  }

  // The viewer's own choice on a desktop screen (kept in this browser when it can be): true open, false collapsed, null
  // none (the width decides).
  function storedFiltersOpen() {
    try {
      const stored = window.localStorage?.getItem(FILTERS_COLLAPSED_STORAGE_KEY);
      return stored === "1" ? false : stored === "0" ? true : null;
    } catch (_error) {
      return null;
    }
  }

  // Only a choice that differs from this width's default is kept: collapsing at 1440px keeps the rail everywhere,
  // opening at 1100px keeps the sidebar open everywhere, and going back to the default forgets the choice.
  function storeFiltersOpen(open) {
    try {
      if (open === Boolean(filtersOpenByDefaultMedia.matches)) window.localStorage?.removeItem(FILTERS_COLLAPSED_STORAGE_KEY);
      else window.localStorage?.setItem(FILTERS_COLLAPSED_STORAGE_KEY, open ? "0" : "1");
    } catch (_error) {
      // Storage unavailable (private window, blocked site data): the sidebar simply starts as its width has it.
    }
  }

  // Where the sidebar should be with no record in the way: on a desktop screen the viewer's choice, else open from
  // 1200px and the rail below; the rail on a tablet; closed on a phone.
  function preferredFiltersOpen() {
    if (!desktopMedia.matches) return false;
    return storedFiltersOpen() ?? Boolean(filtersOpenByDefaultMedia.matches);
  }

  // The visible control that opens or collapses the filters (focus returns to it).
  function filtersToggleButton() {
    if (!filtersDocked()) return $("openFiltersButton");
    return document.body.classList.contains("filters-open") ? $("collapseFiltersButton") : $("filterRailButton");
  }

  function setDetailOpen(isOpen) {
    if (isOpen && filtersDocked() && recordTakesSidebarPlace() && document.body.classList.contains("filters-open")) {
      const scrollTop = $("catalogFilters")?.scrollTop || 0;
      setFiltersOpen(false, { focus: false });
      state.filtersAwayForRecord = { scrollTop };
    }
    document.body.classList.toggle("detail-open", Boolean(isOpen));
    syncDetailPanelAccessibility();
    // Closing the record brings the sidebar back where it was; when Browse itself was left, it comes back with Browse.
    if (!isOpen && state.filtersAwayForRecord && !$("catalogView")?.hidden) restoreFiltersAwayForRecord();
  }

  function restoreFiltersAwayForRecord() {
    const away = state.filtersAwayForRecord;
    state.filtersAwayForRecord = null;
    if (!away || !filtersDocked() || document.body.classList.contains("detail-open")) return;
    setFiltersOpen(true, { focus: false });
    if ($("catalogFilters")) $("catalogFilters").scrollTop = away.scrollTop;
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

  // Opens or collapses the filters: the sidebar (from 641px; collapsed, it is the rail) or the phone sheet. remember
  // keeps a desktop viewer's choice for their next visit.
  function setFiltersOpen(isOpen, { focus = true, remember = false } = {}) {
    const shouldOpen = Boolean(isOpen);
    const wasOpen = document.body.classList.contains("filters-open");
    const rail = $("catalogFilters");
    const focusInside = Boolean(rail?.contains?.(document.activeElement));
    // Filters opened (or closed) by hand are not brought back when a record closes.
    if (shouldOpen || !document.body.classList.contains("detail-open")) state.filtersAwayForRecord = null;
    hideSuggestions();
    // From 1024 to 1599px the sidebar takes the record's place.
    if (shouldOpen && filtersDocked() && recordTakesSidebarPlace() && document.body.classList.contains("detail-open")) {
      resetDetail();
    }
    if (remember && desktopMedia.matches) storeFiltersOpen(shouldOpen);
    document.body.classList.toggle("filters-open", shouldOpen);
    for (const id of ["openFiltersButton", "filterRailButton", "collapseFiltersButton"]) {
      $(id)?.setAttribute("aria-expanded", String(shouldOpen));
    }
    if (shouldOpen && !wasOpen) updateFilterCounts();
    syncFilterRailRole();
    syncDetailPanelAccessibility();
    // The sidebar changes the table's width.
    if (wasOpen !== shouldOpen && filtersDocked()) fitTableColumns();
    // Collapsing with the focus inside leaves it on the control that opens them again.
    if (!shouldOpen && wasOpen && focusInside && focus) filtersToggleButton()?.focus({ preventScroll: true });
    if (shouldOpen && focus) {
      window.setTimeout(() => {
        if (document.body.classList.contains("filters-open") && !rail?.contains(document.activeElement)) {
          (filtersDocked() ? $("collapseFiltersButton") : $("closeFiltersButton"))?.focus({ preventScroll: true });
        }
      }, 180);
    }
  }

  // The sidebar where it belongs for this window: the viewer's choice on a desktop screen (the rail while a record
  // takes its place), the rail on a tablet, closed on a phone.
  function applyFiltersLayout() {
    const open = document.body.classList.contains("filters-open");
    const detailOpen = document.body.classList.contains("detail-open");
    if (!filtersDocked()) {
      state.filtersAwayForRecord = null;
      if (open) setFiltersOpen(false, { focus: false });
      return;
    }
    let shouldOpen = preferredFiltersOpen();
    if (shouldOpen && detailOpen && recordTakesSidebarPlace()) {
      state.filtersAwayForRecord = state.filtersAwayForRecord || { scrollTop: 0 };
      shouldOpen = false;
    }
    if (shouldOpen !== open) setFiltersOpen(shouldOpen, { focus: false });
    else {
      syncFilterRailRole();
      syncDetailPanelAccessibility();
    }
  }

  function syncFilterPanel() {
    // A window narrowed below 1600px with the sidebar and a record both open keeps the record (the sidebar becomes
    // the rail and comes back when the record closes).
    if (document.body.classList.contains("filters-open") && document.body.classList.contains("detail-open")
      && filtersDocked() && recordTakesSidebarPlace()) {
      const scrollTop = $("catalogFilters")?.scrollTop || 0;
      setFiltersOpen(false, { focus: false });
      state.filtersAwayForRecord = { scrollTop };
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
    const left = $("scrollTableLeftButton");
    const right = $("scrollTableRightButton");
    left?.closest(".table-scroll-controls")?.classList.toggle("hidden", !hasOverflow);
    if (left) left.disabled = !canScrollLeft;
    if (right) right.disabled = !canScrollRight;
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
      ${detailTopHtml(row, {}, { withDetail: false })}
      <p id="detailLoadStatus" class="muted detail-load-status" role="status">Loading record…</p>
    `;
    bindDetailTop();
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
      // The snapshot's record checks (when it has a file of them) arrive once; the open record is drawn again with them.
      if (recordChecksPath() && !recordChecks) {
        ensureRecordChecks().then(() => {
          if (state.selectedKey !== key || state.selectedDetail !== detail || !recordCheck(row)) return;
          const focusInside = $("detailContent").contains(document.activeElement);
          renderDetail(summaryWithDetail(row, detail), detail);
          if (focusInside) $("detailHeading")?.focus({ preventScroll: true });
        });
      }
    } catch (error) {
      if (state.selectedKey !== key) return;
      const restoreFocus = focusDetail && $("detailContent").contains(document.activeElement);
      // A record file from another snapshot needs the page reloaded; anything else can be tried again.
      const outOfDate = String(error?.message || "") === PAGE_OUT_OF_DATE;
      $("detailContent").innerHTML = `
        ${detailTopHtml(row, {}, { withDetail: false })}
        <div class="detail-load-error" role="alert">
          <strong>${escapeHtml(outOfDate ? PAGE_OUT_OF_DATE : RECORD_NOT_LOADED)}</strong>
          <span>The table still shows its values.</span>
          <button id="retryDetailButton" class="button secondary" type="button">${outOfDate ? "Reload" : "Try again"}</button>
        </div>
      `;
      bindDetailTop();
      $("retryDetailButton").addEventListener("click", () => (outOfDate ? reloadCatalogPage() : selectRecord(key)));
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

  // A labelled row of the record (a term and its value in the section's list); a missing value reads "Not recorded",
  // never a bare dash.
  function kv(label, value) {
    const text = compactValue(value);
    return linkedKv(label, escapePublic(text === EMPTY_VALUE ? "Not recorded" : text));
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
      return "UniProt entry inferred from EC number and organism";
    }
    return identityLabels[state] || "Not matched to UniProt";
  }

  // How the record's UniProt entry was found, said after the accession ("inferred from EC number and organism"); "" when
  // the entry is simply the one the source names, or the source is a lookup trace.
  const uniprotHowTexts = {
    manual_literature_uniprot_resolution: "from the cited paper",
    manual_literature_structure_uniprot_resolution: "from the cited paper's structure",
    source_record: "from the source database",
    multiple: "from several sources",
    uniprot_accession_inactive_uniparc: "entry now in the UniParc archive",
  };

  function uniprotHowText(sequenceSource, accession) {
    if (sequenceSource && typeof sequenceSource === "object") return "";
    const key = sequenceSourceKey(sequenceSource);
    if (!key) return "";
    if (key === "uniprot_ec_organism_mutation_ranked_match") return "inferred from EC number, organism and variant";
    if (isEcOrganismInferredSequenceSource(sequenceSource)) return "inferred from EC number and organism";
    const fixed = uniprotHowTexts[key.split(";", 1)[0].trim()];
    if (fixed) return fixed;
    const label = sequenceSourceLabel(sequenceSource);
    if (/^(?:PDB|NCBI)\b/.test(label)) return `from ${label}`;
    const other = label.match(/^UniProt (\S+)$/);
    if (other && UNIPROT_ACCESSION.test(` ${other[1]}`) && other[1] !== accession) return `sequence from ${label}`;
    return "";
  }

  // The record's form, in the record as in its header: "Variant H150A", "Variant, not specified", "Wild type" or "Not
  // recorded".
  function panelEnzymeForm(row) {
    const signature = mutationSignature(row);
    if (signature) return `Variant ${signature}`;
    const label = enzymeFormLabel(row, { showUnknown: true });
    return label === "Variant (unspecified)" ? "Variant, not specified" : label;
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

  function linkedKv(label, valueHtml, { className = "" } = {}) {
    return `<div class="kv-line${className ? ` ${className}` : ""}"><dt>${escapePublic(label)}</dt><dd>${valueHtml}</dd></div>`;
  }

  // A section's rows as one definition list (112px terms, values beside them); "" when no row has anything to say.
  function kvList(rows, className = "") {
    const contentRows = rows.filter(Boolean);
    return contentRows.length ? `<dl class="detail-kv${className ? ` ${className}` : ""}">${contentRows.join("")}</dl>` : "";
  }

  // One section of the record panel (design spec 5, B-H): a 14px heading and what follows it.
  function detailSection(key, title, body) {
    return `<section class="detail-section ${key}-section" aria-labelledby="detail-${key}-title">`
      + `<h3 id="detail-${key}-title">${escapeHtml(title)}</h3>${body}</section>`;
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

  // A kcat/Km calculated from kcat and Km keeps their significant figures (5038.5 from 65.5 ÷ 0.013 is 5.0 × 10³), at
  // most DISPLAY_FIGURES: the number of figures to show, or 0 for any other value. A kcat/Km that only equals kcat ÷ Km
  // counts as calculated, but never shows more figures than it is stored with (0.56 stays 0.56, not 0.56000).
  function calculatedFigures(row, field) {
    if (field !== "kcat_over_km") return 0;
    const figures = Math.min(quotientFigures(row), DISPLAY_FIGURES);
    if (row.kcat_over_km_origin === "calculated") return figures;
    if (!efficiencyLooksCalculated(row)) return 0;
    const stored = numberParts(metricDisplay(row, field))?.significant || 0;
    return figures < stored ? figures : 0;
  }

  // The display rule: no more precision than was measured. A stored value shows at most 4 significant figures, 3 when its
  // digits from the fourth on are a ÷60 artefact (30.333, 5.1667: a repeating 3 or 6), and never fewer than its integer
  // digits below 10⁵ (12345.6 shows 12346). Printed digits up to 4 stay as stored (135.0, 0.030). Returns the figures to
  // round to, or 0 to show the stored text. Tooltips, the record's "In catalog units" and the downloads keep the stored
  // digits.
  const DISPLAY_FIGURES = 4;
  const DIVIDED_BY_60_TAIL = /^(?:3{2,}|6{2,}|6+7)$/;
  // A per-minute value stored with 4 figures shows its ÷60 repeat only in its ending: 7.333 (440/60), 0.1833 (11/60),
  // 4.167 (250/60). kcat and kcat/Km only (Km is never divided by 60).
  const DIVIDED_BY_60_ENDING = /(?:333|667|833|167)$/;

  function roundingFigures(value, { perMinute = false } = {}) {
    const text = compactValue(value).trim();
    const match = text.match(/^[+-]?(\d*)(?:\.(\d*))?(?:[eE][+-]?\d+)?$/);
    const magnitude = Math.abs(Number(text));
    if (!match || !Number.isFinite(magnitude) || magnitude === 0) return 0;
    const fraction = match[2] || "";
    const digits = `${match[1] || ""}${fraction}`.replace(/^0+/, "");
    // Trailing zeros of a plain integer are not printed digits.
    const significant = fraction || /e/i.test(text) ? digits : digits.replace(/0+$/, "");
    if (significant.length < DISPLAY_FIGURES) return 0;
    if (significant.length === DISPLAY_FIGURES && !(perMinute && DIVIDED_BY_60_ENDING.test(significant))) return 0;
    let figures = significant.length === DISPLAY_FIGURES || DIVIDED_BY_60_TAIL.test(significant.slice(3)) ? 3 : DISPLAY_FIGURES;
    if (magnitude >= 1 && magnitude < 1e5) figures = Math.max(figures, Math.floor(Math.log10(magnitude)) + 1);
    return figures < significant.length ? figures : 0;
  }

  function displayFigures(row, field) {
    return calculatedFigures(row, field)
      || roundingFigures(metricDisplay(row, field), { perMinute: field === "kcat" || field === "kcat_over_km" });
  }

  // CatLog's own text of a value it read from the paper, to the figures printed ("135.0" stays "135.0"; the proof line's
  // value_display), as a number this page writes ("8.20 × 10^-4" is 8.20e-4); "" when absent or not a number.
  function valueDisplayText(value) {
    const match = String(value ?? "").trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:\s*[×x]\s*10\^?\(?([+\-−]?\d+)\)?)?$/);
    if (!match) return "";
    return match[2] ? `${match[1]}e${match[2].replace("−", "-")}` : match[1];
  }

  // Per value field, the record's value_display when it is the stored number (a record read by CatLog).
  function printedFigureDisplays(summary, detail) {
    const displays = {};
    (Array.isArray(detail?.proof_lines) ? detail.proof_lines : []).forEach((line) => {
      if (!line || typeof line !== "object") return;
      const field = (v2MetricLabels[line.metric] || [])[0];
      const text = valueDisplayText(line.value_display);
      if (!field || !text || field in displays) return;
      const stored = Number(metricDisplay(summary, field));
      if (Number.isFinite(stored) && Math.abs(Number(text) - stored) <= Math.abs(stored) * 1e-9) displays[field] = text;
    });
    return displays;
  }

  // The value text the record shows: CatLog's figures as printed when it gives them, else the stored digits.
  function shownValueText(row, field) {
    return row._valueDisplays?.[field] || metricDisplay(row, field);
  }

  // A value as the panel shows it (as the table does; a value CatLog gives to the figures printed keeps them).
  function panelValueHtml(row, field) {
    const own = row._valueDisplays?.[field];
    const figures = own ? roundingFigures(own) : displayFigures(row, field);
    return numberHtml(shownValueText(row, field), figures ? { figures } : undefined);
  }

  // The same, as text (the report email quotes the numbers the record shows).
  function panelValueText(row, field) {
    const own = row._valueDisplays?.[field];
    const figures = own ? roundingFigures(own) : displayFigures(row, field);
    return numberText(shownValueText(row, field), figures ? { figures } : undefined);
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
    const foldText = foldNumberText;
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
    kcat_over_km_source_mismatch: "Every kcat/Km the source databases list for this record is more than 2-fold from the kcat/Km shown.",
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
        // A temperature or pH flag is said on its own row, under Conditions.
        if (/^(?:temperature|ph)_/.test(flag)) return;
        const unitField = (String(flag).match(/^unit_not_recorded_(\w+)$/) || [])[1];
        if (unitField && metricUnitMissing(summary, unitField, flags)) return;
        // With the source's own kcat/Km shown, the stored value's diffusion-limit flag is the same unit factor.
        if (consistent && flag === "efficiency_above_diffusion_limit") return;
        // The listed values' own note (both numbers and the fold, measurementNotes) says it better when it applies.
        if (flag === "kcat_over_km_source_mismatch" && listedEfficiencyNote(summary, detail, flags)) return;
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
    const shorts = [...new Set(own.map((note) => note.short).filter(Boolean))].join(", ");
    // "kcat/Km mismatch. Show the note.", not "kcat/Km: kcat/Km mismatch": the metric is named once.
    const name = `${shorts.startsWith(metricNames[field]) ? "" : `${metricNames[field]}: `}${shorts}. Show the note.`;
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
      metric: clean(line.metric),
      printed: clean(line.printed) || printedValueText(line.raw_value, line.raw_unit),
      printedLine: "printed_line" in line ? clean(line.printed_line) : ((reported.match(/in the line “(.+)”/) || [])[1] || ""),
      check: "check" in line ? check : (result ? (result[2] ? `corrected: ${result[2]}` : "confirmed") : ""),
      conversion: "conversion" in line
        ? clean(line.conversion)
        : (/converted by code/.test(normalized) ? "converted by code" : (readAs ? `printed unit read as ${readAs[1]}` : "")),
      valueDisplay: valueDisplayText(clean(line.value_display)),
      audit,
    };
  }

  // "Oct 11, 2026" (the snapshot's and Stats' date style) from an ISO date, or the text as it is.
  function auditDateText(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return String(value || "").trim();
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return Number.isNaN(date.getTime())
      ? String(value).trim()
      : formatDate(date.toISOString());  // as the snapshot and Stats write dates
  }

  // The AI audit line: the date and the verdict only ("Oct 11, 2026: re-checked against the paper and kept."), naming
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
    return [line.table_label, line.row_label].map((value) => publicEvidenceString(String(value ?? "")).trim()
      // CatLog's "read off the page image (scanned paper)" reads plainly inside a heading's brackets.
      .replace(/^read off the page image \(scanned paper\)$/i, "read from the page image"))
      .filter(Boolean).join(", ");
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

  // ---- Record panel: B. Values ----
  // One table, Parameter | Value | Unit | As printed | Where, in kcat, Km, kcat/Km (then Ki) order; a metric the record
  // lacks is not a row. A record read from the paper gives each value as printed and where it is printed; an older record
  // has a dash there (its earlier review's notes are under Paper). Under the table: the kcat/Km its sources list, each
  // caution once (amber, with the "!" the value carries), the grey notes (how code converted a unit, calc.), then each
  // line quoted from the paper once. Facts only (where, what was printed, how it was converted), never reasoning.
  const VALUE_FIELDS = [
    ["kcat", "<i>k</i><sub>cat</sub>"],
    ["km", "<i>K</i><sub>m</sub>"],
    ["kcat_over_km", "<i>k</i><sub>cat</sub>/<i>K</i><sub>m</sub>"],
    ["ki", "<i>K</i><sub>i</sub>"],
  ];
  const CALCULATED_V2_NOTE = "kcat ÷ Km, calculated by CatLog; not printed in the paper.";
  const CALCULATED_OLDER_NOTE = "kcat ÷ Km, not printed in the source.";

  // The proof line (a record read from the paper) that gives a field's value, or -1.
  function proofLineIndex(proof, field) {
    return proof ? proof.lines.findIndex((line) => (v2MetricLabels[line.metric] || [])[0] === field) : -1;
  }

  // "calc." beside a kcat/Km worked out from kcat and Km, its meaning in the title and in the note under the table.
  function calculatedNote(summary, v2Record) {
    if (summary.kcat_over_km_origin !== "calculated") return "";
    return v2Record ? CALCULATED_V2_NOTE : CALCULATED_OLDER_NOTE;
  }

  // How code converted each value (a record read from the paper): "kcat and Km: converted by code from the printed
  // units." once, and a value whose printed unit was read in a stated way on its own ("kcat/Km: converted by code, printed
  // unit read as 10³ M⁻¹ s⁻¹."). A value with a printed-unit caution says the rest in its amber note.
  function conversionNotesHtml(proof, unitCautions) {
    if (!proof) return [];
    const plain = [];
    const own = [];
    proof.lines.forEach((line, index) => {
      const field = (v2MetricLabels[line.metric] || [])[0];
      let conversion = String(proof.facts[index].conversion || "").trim();
      if (unitCautions.some((item) => item.field === field)) conversion = conversion.replace(/,?\s*printed unit read as .+$/, "").trim();
      if (!conversion) return;
      if (/^converted by code$/i.test(conversion)) {
        if (!plain.includes(line.metric)) plain.push(line.metric);
      } else {
        own.push(`${escapePublic(line.metric)}: ${caretHtml(escapePublic(conversion))}.`);
      }
    });
    const shared = plain.length
      ? [`${escapePublic(sentenceList(plain))}: converted by code from the printed ${plain.length > 1 ? "units" : "unit"}.`]
      : [];
    return [...shared, ...own];
  }

  function valuesSection(summary, detail, { proof = v2ProofFacts(summary, detail) } = {}) {
    const metricSummary = metricSummaryFor(summary, detail);
    const flags = conditionFlags(summary, detail);
    const { notes, unitCautions, consistent } = measurementNotes(summary, detail, { proof });
    const v2Record = isV2Row(summary) || String(detail.verification_method || "").startsWith(v2Method);
    const clean = (value) => publicEvidenceString(String(value ?? "")).trim();
    // A Ki only when the record's detail says it has one.
    const fields = VALUE_FIELDS.filter(([field]) => (field === "ki"
      ? Boolean(metricSummary.has_ki) && metricHasValue(metricSummary, field)
      : metricHasValue(metricSummary, field) || proofLineIndex(proof, field) >= 0));
    const calcNote = calculatedNote(summary, v2Record);
    // Where each value is printed: a column when the values' places differ, one caption above the table when every value
    // shares it, nothing for an older record (its notes are under Paper).
    const placeOf = (field) => {
      const index = proofLineIndex(proof, field);
      return index >= 0 ? v2LinePlace(proof.lines[index]) : "";
    };
    // (A kcat/Km CatLog calculated has no place of its own.)
    const places = fields.filter(([field]) => proofLineIndex(proof, field) >= 0).map(([field]) => placeOf(field));
    const sharedPlace = places.length && places[0] && places.every((place) => place === places[0]) ? places[0] : "";
    const whereColumn = !sharedPlace && places.some(Boolean);
    const rows = fields.map(([field, label]) => {
      const index = proofLineIndex(proof, field);
      const line = index >= 0 ? proof.lines[index] : null;
      const fact = index >= 0 ? proof.facts[index] : null;
      let valueHtml;
      let unitCell;
      if (metricHasValue(metricSummary, field)) {
        // A non-catalog stored unit is the record's unit (with what that means in its title); a missing one says so.
        valueHtml = field === "kcat_over_km" && consistent ? numberHtml(consistent.value) : panelValueHtml(metricSummary, field);
        unitCell = metricUnitMissing(metricSummary, field, flags)
          ? unitMissingHtml()
          : (storedUnitDiffers(metricSummary, field) ? storedUnitHtml(metricSummary, field) : metricUnitHtml(metricSummary, field));
      } else {
        // A value the paper prints that the record's own fields lack: the proof line's value in catalog units.
        valueHtml = numberHtml(clean(line.normalized_value));
        unitCell = unitHtml(clean(line.normalized_unit));
      }
      const calc = field === "kcat_over_km" && calcNote
        ? `<small class="metric-origin" title="${escapeHtml(calcNote)}">calc.</small>`
        : "";
      const place = whereColumn ? placeOf(field) : "";
      const printed = fact?.printed ? caretHtml(escapePublic(fact.printed)) : EMPTY_VALUE;
      return `<tr><th scope="row">${label}</th>`
        + `<td class="vt-value"><span class="vt-number">${valueHtml}</span>${calc}${flagMarkerHtml(field, notes)}</td>`
        + `<td class="vt-unit">${unitCell || EMPTY_VALUE}</td>`
        + `<td class="vt-printed">${printed}${place ? `<small class="vt-where-inline">${escapePublic(place)}</small>` : ""}</td>`
        + (whereColumn ? `<td class="vt-where${place.length <= 14 ? " vt-short" : ""}">${place ? escapePublic(place) : EMPTY_VALUE}</td>` : "")
        + "</tr>";
    });
    // A record with no kcat, Km or kcat/Km says so in words (some keep a Ki only).
    const noKinetics = ["kcat", "km", "kcat_over_km"].every((field) => !fields.some(([shown]) => shown === field));
    const emptyNote = !noKinetics
      ? ""
      : (fields.some(([field]) => field === "ki")
          ? "This record stores a Ki (inhibition constant) only, no kcat, Km or kcat/Km."
          : "No kcat, Km or kcat/Km is stored for this record.");
    // A merged older record's kcat/Km values as its sources list them.
    const listed = sourceEfficiencyRow(summary, detail);
    const greyNotes = [
      ...conversionNotesHtml(proof, unitCautions),
      calcNote && fields.some(([field]) => field === "kcat_over_km")
        ? `<span class="metric-origin">calc.</span> ${escapeHtml(calcNote)}`
        : "",
    ].filter(Boolean);
    // Each printed line once; a "line" that is only the printed number itself adds nothing.
    const quotes = !proof ? [] : proof.lines.map((line, index) => [v2LinePlace(line), proof.facts[index].printedLine, proof.facts[index].printed])
      .filter(([, printedLine, printed], index, all) => printedLine && !printed.startsWith(printedLine)
        && all.findIndex(([, other]) => other === printedLine) === index)
      .map(([place, printedLine]) => printedLineNoteHtml(place, printedLine));
    const table = rows.length
      ? `<table class="values-table">${sharedPlace ? `<caption>Printed in ${escapePublic(sharedPlace)}</caption>` : ""}`
        + `<thead><tr><th scope="col">Parameter</th><th scope="col" class="vt-value">Value</th>`
        + `<th scope="col">Unit</th><th scope="col">As printed</th>${whereColumn ? '<th scope="col" class="vt-where">Where</th>' : ""}</tr></thead>`
        + `<tbody>${rows.join("")}</tbody></table>`
      : "";
    return detailSection("values", "Values", [
      table,
      emptyNote ? `<p class="values-empty">${escapeHtml(emptyNote)}</p>` : "",
      listed ? kvList([listed], "measurement-listed") : "",
      flagNotesHtml(notes),
      greyNotes.length ? `<ul class="value-notes">${greyNotes.map((note) => `<li>${note}</li>`).join("")}</ul>` : "",
      quotes.length ? `<div class="printed-lines">${quotes.join("")}</div>` : "",
    ].filter(Boolean).join(""));
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
  // A quote longer than PRINTED_LINE_MAX characters ends at the last cell or word that fits, with an ellipsis (the record
  // download keeps the whole line).
  const PRINTED_LINE_MAX = 240;
  function shortPrintedLine(text) {
    const value = String(text ?? "");
    if (value.length <= PRINTED_LINE_MAX) return value;
    const head = value.slice(0, PRINTED_LINE_MAX - 1);
    const cut = Math.max(head.lastIndexOf(" | "), head.lastIndexOf(" "));
    return `${(cut > PRINTED_LINE_MAX / 2 ? head.slice(0, cut) : head).replace(/[\s|,;]+$/, "")}…`;
  }

  function printedLineNoteHtml(place, printedLine) {
    const where = /^(?:supplementary )?table\s+\S+$/i.test(place) ? `${place} row` : place;
    const label = `${where ? `${where}, as` : "As"} extracted from the paper’s text:`;
    const quote = `<p class="evidence-note-plain">${escapePublic(label)} “${printedLineHtml(shortPrintedLine(printedLine))}”</p>`;
    const cells = String(printedLine).split("|").length;
    const lostPlusMinus = /\d \( \d/.test(printedLine);
    if (cells <= 4 && !lostPlusMinus) return quote;
    // The warning only where the ± signs were lost; a long row is folded without it.
    return `<details class="printed-line-disclosure"><summary>Show the line as extracted</summary>${quote}`
      + `${lostPlusMinus ? '<p class="printed-line-note">Text extraction dropped the ± signs from this line.</p>' : ""}</details>`;
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
  // corrected (see Conditions)" -> "corrected the assay conditions (see Conditions)", CatLog's "pH left blank" -> "left the
  // pH blank" and "organism set to Carica papaya" (the reader gave none) -> "set the organism to Carica papaya".
  function checkAction(phrase) {
    let match = phrase.match(/^(EC \S+) (removed|added)$/);
    if (match) return `${match[2]} ${match[1]}`;
    match = phrase.match(/^EC (corrected|set) to (.+)$/);
    if (match) return `${match[1]} the EC number to ${match[2]}`;
    match = phrase.match(/^(.+?) left blank( \(.+\))?$/);
    if (match) return `left the ${match[1]} blank${match[2] || ""}`;
    match = phrase.match(/^(.+?) set to (.+)$/);
    if (match) return `set the ${match[1]} to ${match[2]}`;
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
    if (!shared) {
      // Each result once, with the values it is for: "kcat confirmed; Km and kcat/Km: unit set to mM."
      const results = new Map();
      facts.forEach((fact, index) => {
        const { value } = checkPhrases(fact.check, context);
        const text = value.length ? value.map(unitText).join(", ") : "confirmed";
        results.set(text, [...(results.get(text) || []), fact.metric || `value ${index + 1}`]);
      });
      head = `${[...results].map(([text, metrics]) => `${sentenceList(metrics)}: ${text}`).join("; ")}.`;
    }
    else if (shared === "Confirmed") head = note ? `All values confirmed as printed; ${note}.` : "All values confirmed.";
    else head = `${shared} for every value.`;
    if (note && shared !== "Confirmed") head += ` See the ${cautionFields.length > 1 ? "notes" : "note"} on ${sentenceList(cautionFields.map((field) => metricNames[field]))}.`;
    const record = [...new Set(facts.flatMap((fact) => checkPhrases(fact.check, context).record))];
    // "corrected the cosubstrate and corrected the assay conditions" reads "corrected the cosubstrate and the assay conditions";
    // actions with one verb are said together, in the order the verbs first appear.
    const actions = record.map(checkAction).reduce((merged, action) => {
      const verb = (action.match(/^(?:corrected|removed|added|set|left) the /) || [""])[0];
      const same = verb ? merged.find((item) => item.verb === verb) : null;
      if (same) same.objects.push(action.slice(verb.length));
      else merged.push({ verb, objects: [verb ? action.slice(verb.length) : action] });
      return merged;
    }, []).map(({ verb, objects }) => `${verb}${sentenceList(objects.map((object, index) => (index && verb ? `the ${object}` : object)))}`);
    return actions.length ? `${head} The AI check also ${sentenceList(actions)}.` : head;
  }

  // ---- Record panel: conditions ----
  // The Temperature and pH rows: the value, or why there is none, said on the row itself. A record read from the paper
  // says "Not stated in the paper", a database record "Not recorded"; a value a flag holds back says why, with what the
  // source's note gives ("Not shown, the source's temperature unit is unclear (source note: 30 °C)").
  const conditionFlagReasons = {
    temperature_unit_needs_check: "the source's temperature unit is unclear",
    temperature_value_needs_check: "the source's value is questionable",
    temperature_invalid: "the source's value is not usable",
    temperature_zero_celsius_needs_check: "recorded as exactly 0 °C, which may stand for a missing value",
    ph_outside_0_14: "the source's value is outside 0–14",
    ph_invalid: "the source's value is not usable",
  };

  function sourceNoteTemperatures(detail) {
    const notes = (Array.isArray(detail.proof_lines) ? detail.proof_lines : []).filter((line) => typeof line === "string");
    return [...new Set(notes.flatMap((note) => [...publicEvidenceString(note).matchAll(/(-?\d+(?:\.\d+)?)\s*°\s*C\b/g)].map((match) => `${match[1]} °C`)))];
  }

  function conditionRowValues(summary, detail, flags, reasons = {}) {
    const v2Record = isV2Row(summary) || String(detail.verification_method || "").startsWith(v2Method);
    const missing = v2Record ? "Not stated in the paper" : "Not recorded";
    const sentence = (text) => text.charAt(0).toUpperCase() + text.slice(1);
    const flagged = (prefix) => [...flags].map((flag) => (flag.startsWith(prefix) ? conditionFlagReasons[flag] : "")).find(Boolean) || "";
    const temperature = formatTemperature(summary);
    let temperatureText = temperature !== EMPTY_VALUE ? `${temperature} °C` : "";
    const temperatureFlag = flagged("temperature_");
    if (!temperatureText && temperatureFlag) {
      const kelvin = detail.temperature_k ?? summary.temperature_k;
      const noted = sourceNoteTemperatures(detail);
      temperatureText = kelvin != null && kelvin !== ""
        ? `${compactValue(kelvin)} K (as recorded); ${temperatureFlag}`
        : `Not shown, ${temperatureFlag}${noted.length ? ` (source note: ${noted.join(", ")})` : ""}`;
    }
    const ph = formatPh(summary);
    let phText = ph !== EMPTY_VALUE ? ph : "";
    const phFlag = flagged("ph_");
    if (!phText && phFlag) {
      const stored = detail.ph ?? summary.ph;
      phText = stored != null && stored !== "" ? `${compactValue(stored)} (as recorded); ${phFlag}` : `Not shown, ${phFlag}`;
    }
    return {
      temperature: temperatureText || (reasons.temperature ? sentence(reasons.temperature) : missing),
      ph: phText || (reasons.ph ? sentence(reasons.ph) : missing),
    };
  }

  // The record's values with the Ki fields of its detail.
  function metricSummaryFor(summary, detail) {
    return {
      ...summary,
      _valueDisplays: printedFigureDisplays(summary, detail),
      has_ki: detail.has_ki ?? summary.has_ki,
      ki_display: detail.ki_display ?? summary.ki_display,
      ki_unit: detail.ki_unit ?? summary.ki_unit,
    };
  }

  // Every note under the values, each once: the flags, the sources' listed kcat/Km, a printed unit CatLog did not use. Their
  // short words are the Guide's caution names (a listed kcat/Km far from kcat ÷ Km is a kcat/Km mismatch too).
  function measurementNotes(summary, detail, { proof = v2ProofFacts(summary, detail) } = {}) {
    const metricSummary = metricSummaryFor(summary, detail);
    const flags = conditionFlags(summary, detail);
    const consistent = consistentEfficiency(metricSummary, detail, flags);
    const unitCautions = unitPrefixCautions(metricSummary, proof);
    // CatLog's flag for a printed unit that differs: the notes on each such value (below) say which and why.
    const noteFlags = unitCautions.length ? new Set([...flags].filter((flag) => flag !== "printed_unit_prefix_differs")) : flags;
    const notes = flagNotes(metricSummary, detail, noteFlags, consistent);
    const listedNote = listedEfficiencyNote(metricSummary, detail, flags);
    if (listedNote) notes.push({ id: `detailFlagNote${notes.length + 1}`, field: "kcat_over_km", short: "kcat/Km mismatch", text: listedNote });
    // Named by its value ("Km: The paper prints µM; ..."), as the other notes name theirs.
    unitCautions.forEach(({ field, metric, text }) => {
      notes.push({ id: `detailFlagNote${notes.length + 1}`, field, short: "printed unit differs", text: `${metric}: ${text}` });
    });
    return { notes, unitCautions, consistent, flags };
  }

  // ---- Record panel: D. Conditions ----
  // Temperature and pH (or why there is none, on the row itself), the assay's other conditions, cosubstrate, cofactor
  // and preparation, each on its own row.
  function conditionsSection(summary, detail) {
    const flags = conditionFlags(summary, detail);
    const conditions = conditionLines(publicEvidenceString(detail.assay_conditions_summary), summary);
    const { temperature, ph } = conditionRowValues(summary, detail, flags, conditions.reasons);
    return detailSection("conditions", "Conditions", kvList([
      kv("Temperature", temperature),
      kv("pH", ph),
      conditions.conditions,
      conditions.cosubstrate,
      conditions.preparation,
    ]));
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

  // The AI reader's own remarks about its reading ("which is not part of the provided text", "so the assay temperature is
  // not pinned down", "(... which repeats Table 2's pH; the table columns give the assay pH)") are not facts about the
  // assay: a bracket or a trailing clause that holds one goes, the facts before it stay, and a segment that still holds
  // one is not shown. CatLog strips them when it builds the snapshot (website plan P3); this keeps older snapshots clean.
  const READER_REMARK = /provided text|not part of the (?:provided )?text|pinned down|\bwhich repeats\b|the table columns give|\bso the (?:assay )?\w+ is\b/i;
  function withoutReaderRemarks(segment) {
    let text = String(segment || "");
    if (!READER_REMARK.test(text)) return text;
    text = text.replace(/\s*[(\[][^()[\]]*[)\]]/g, (aside) => (READER_REMARK.test(aside) ? "" : aside));
    const clause = text.search(/,\s+(?:which|so|and|but|while|where)\b[^,]*$/i);
    if (clause >= 0 && READER_REMARK.test(text.slice(clause))) text = text.slice(0, clause);
    text = text.trim().replace(/[,;:]+$/, "").trim();
    return READER_REMARK.test(text) ? "" : text;
  }

  // Assay conditions as short labelled lines: "cosubstrate X" / "cofactor X" and "preparation: ..." get their own line,
  // the rest is a short list; a pH or temperature that only repeats the lines above ("pH 7.5", "298.15 K") is left out.
  function conditionLines(text, summary = {}) {
    const cosubstrates = [];
    const cofactors = [];
    const preparations = [];
    const rest = [];
    const qualified = new Map();
    const reasons = { ph: "", temperature: "" };
    const ph = formatPh(summary);
    const temperature = formatTemperature(summary);
    conditionSegments(String(compactValue(text) === EMPTY_VALUE ? "" : compactValue(text)).trim())
      .map(withoutReaderRemarks).filter(Boolean).forEach((segment) => {
      // Why a pH or temperature was left blank goes on that row ("pH: not confirmed in the paper text"); a segment that
      // only says it is not stated repeats the row.
      let match = segment.match(/^(pH|temperature) left blank: (.+)$/i);
      if (match) {
        const reason = match[2].replace(/^the printed value could not be confirmed in the paper text$/i, "not confirmed in the paper text");
        reasons[match[1].toLowerCase() === "ph" ? "ph" : "temperature"] = reason;
        return;
      }
      match = segment.match(/^(?:assay )?(pH|temperature)(?: of (?:the )?(?:kinetic )?assays?)? not stated(?: in (?:this|the) paper)?$/i);
      if (match && (match[1].toLowerCase() === "ph" ? ph : temperature) === EMPTY_VALUE) return;
      match = segment.match(/^preparation:\s*(.+)$/i);
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
    // A cofactor that is the substrate itself (NADH for NADH) is already the substrate.
    const substrate = String(summary.substrate_name || "").trim().toLowerCase();
    const ownCofactors = cofactors.filter((item) => item.trim().toLowerCase() !== substrate);
    return {
      cosubstrate: (cosubstrates.length ? linkedKv("Cosubstrate", html(cosubstrates.join("; "))) : "")
        + (ownCofactors.length ? linkedKv("Cofactor", html(ownCofactors.join("; "))) : ""),
      reasons,
      conditions: !items.length
        ? ""
        : (items.length === 1
          ? linkedKv("Assay", html(items[0]))
          : linkedKv("Assay", `<ul class="condition-list">${items.map((item) => `<li>${html(item)}</li>`).join("")}</ul>`)),
      preparation: preparations.length ? linkedKv("Preparation", html(preparations.join("; "))) : "",
    };
  }

  // ---- Record panel: E. Protein and substrate ----
  // A long text (a sequence, a SMILES) as one row: what it is ("605 aa"), then Show and Copy; Show opens it below.
  function revealRowHtml(label, text, id, { summary = "", note = "" } = {}) {
    if (!text) return "";
    return linkedKv(label, `<span class="reveal-line">${summary ? `<span class="reveal-summary">${escapePublic(summary)}</span>` : ""}`
      + `<span class="row-actions"><button class="text-button reveal-button" type="button" aria-expanded="false" aria-controls="${id}Box" data-reveal-target="${id}Box">Show</button>`
      + `<button class="text-button copy-button" type="button" aria-live="polite" data-copy-target="${id}">Copy</button></span></span>`
      + (note ? `<span class="reveal-note">${escapePublic(note)}</span>` : "")
      + `<span id="${id}Box" class="copy-field" hidden><code id="${id}">${escapeHtml(text)}</code></span>`, { className: "reveal-row" });
  }

  function proteinSection(summary, detail) {
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
    const enzymeForm = panelEnzymeForm({ ...summary, ...detail });
    const rawNote = String(detail.sequence_variant_note || summary.sequence_variant_note || "");
    let sequenceVariantNote = sequenceNoteText(rawNote, enzymeForm);
    const sequenceSourceValue = detail.sequence_source || summary.sequence_source;
    const isUniProt = proteinAccessionDatabase === "UniProt";
    const accessionLabel = isUniProt
      ? "UniProt"
      : (proteinAccessionDatabase === "NCBI Protein" ? "NCBI Protein" : "Protein accession");
    // "UniProt canonical sequence" only repeats the row; "H150A applied to the UniProt canonical sequence" names the
    // variant sequence instead: "Variant sequence: 489 aa, UniProt P22498 with H150A".
    if (/^UniProt canonical sequence\.?$/.test(sequenceVariantNote)) sequenceVariantNote = "";
    let variantSummary = "";
    const applied = sequenceVariantNote.match(/^(\S+) applied to the UniProt (?:canonical sequence|sequence(?: ([A-Z0-9]+))?)(?: \((.+)\))?$/);
    if (applied && variantSequence) {
      const accession = applied[2] || (isUniProt ? proteinAccession : "");
      variantSummary = `${accession ? `UniProt ${accession}` : "UniProt sequence"} with ${applied[1]}${applied[3] ? `; ${applied[3]}` : ""}`;
      sequenceVariantNote = "";
    }
    const length = (value) => `${formatInteger(value.length)} aa`;
    const sequenceRows = variantSequence
      ? [
          revealRowHtml("Wild-type sequence", wildTypeSequence, "detailWildTypeSequence", { summary: wildTypeSequence ? length(wildTypeSequence) : "" }),
          revealRowHtml("Variant sequence", variantSequence, "detailVariantSequence",
            { summary: [length(variantSequence), variantSummary].filter(Boolean).join(", "), note: sequenceVariantNote }),
        ]
      // A wild-type record's sequence is the Sequence (its form is said above); one of another form names it wild type.
      : [revealRowHtml(wildTypeSequence && enzymeForm !== "Wild type" ? "Wild-type sequence" : "Sequence", wildTypeSequence || sequence, "detailSequence",
          { summary: length(wildTypeSequence || sequence), note: sequenceVariantNote })];
    const hasSequence = Boolean(wildTypeSequence || variantSequence || sequence);
    // A note about a sequence that is not shown ("shown as the variant sequence") says nothing true here.
    if (!hasSequence && /\bshown\b| applied to /.test(sequenceVariantNote) && !/^No sequence/.test(sequenceVariantNote)) sequenceVariantNote = "";
    // One line says how the protein is matched to UniProt.
    const state = String(detail.identity_resolution_state || summary.identity_resolution_state || "").trim();
    const sharedEntry = /(?:all|both) map to UniProt \S+, which does not say which is which|share UniProt \S+: which sequence is which/.test(rawNote);
    let identityRow;
    if (proteinAccession) {
      const how = isUniProt ? (sharedEntry ? "one entry for several forms of this enzyme" : uniprotHowText(sequenceSourceValue, proteinAccession)) : "";
      identityRow = linkedKv(accessionLabel, `${proteinAccessionLink(proteinAccession, proteinAccessionDatabase)}${how ? ` <span class="identity-how">(${escapePublic(how)})</span>` : ""}`);
    } else if (accessionCandidates.length) {
      identityRow = linkedKv("UniProt", `${accessionCandidates.length > 1 ? identityLabels.candidate_pool : "Possible UniProt entry"}${referenceList(accessionCandidates, uniprotLink)}`);
    } else if (state === "sequence_resolved_no_accession" || hasSequence) {
      identityRow = kv("UniProt", identityLabels.sequence_resolved_no_accession);
    } else {
      identityRow = kv("UniProt", identityLabels.identity_unresolved);
    }
    const v2Record = isV2Row(summary) || String(detail.verification_method || "").startsWith(v2Method);
    const substrate = recordedName(summary.substrate_name) || (v2Record ? "Not stated in the paper" : "Not recorded");
    return detailSection("protein", "Protein and substrate", kvList([
      linkedKv("Enzyme form", detailFormHtml({ ...summary, ...detail }) || escapePublic(enzymeForm)),
      identityRow,
      sourceProteinAccession ? kv("Source-listed accession", sourceProteinAccession) : "",
      // No sequence: the row says why (the note) or None.
      ...(hasSequence ? sequenceRows : [kv("Sequence", sequenceVariantNote || "None recorded")]),
      kv("Substrate", substrate),
      smiles ? revealRowHtml("SMILES", smiles, "detailSmiles") : kv("SMILES", "None recorded"),
    ]));
  }

  // Copy: a sequence or SMILES (data-copy-target names the element) or a given text (data-copy-text, the record's link).
  async function copyDetailValue(button) {
    const value = button.dataset.copyText || $(button.dataset.copyTarget)?.textContent || "";
    const label = button.dataset.copyLabel || "Copy";
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
    window.setTimeout(() => { button.textContent = label; }, copied ? 1200 : 3000);
  }

  // A record's source in words: "The paper (read by CatLog)" for a record CatLog read, else the databases by name, read
  // from source_db as Browse's Source filter and the status line read it (rowSourceBits: "sabio_rk;brenda" is "BRENDA,
  // SABIO-RK"), never a raw key.
  function recordSourceName(value, v2Record = false) {
    if (v2Record) return "The paper (read by CatLog)";
    const bits = rowSourceBits({ source_db: value });
    if (bits === SOURCE_UNRECORDED_BIT) return "Not recorded";
    return sourceFilters.filter((item) => bits & item.bit).map((item) => item.name || item.label).join(", ");
  }

  // The databases a record merges, unless that only repeats its Source.
  function mergedDatabasesRow(summary, detail) {
    const names = [...new Set((detail.source_databases_merged || []).map((value) => recordSourceName(value)).filter((name) => name !== "Not recorded"))];
    if (!names.length || names.join(", ") === recordSourceName(summary.source_db || detail.source_db)) return "";
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



  // "Report a problem": an email to the lab with the record ID, the snapshot and the values as the record shows them
  // (shown: a value the record shows in place of the stored one, such as the source's own kcat/Km).
  function reportProblemHref(summary, pmids, { dois = [], standInIds = [], shown = {} } = {}) {
    const key = summary.record_key || summary.measurement_key || "";
    const values = [["kcat", "kcat"], ["km", "Km"], ["kcat_over_km", "kcat/Km"]]
      .filter(([field]) => metricHasValue(summary, field))
      .map(([field, label]) => [label, field in shown ? numberText(shown[field]) : panelValueText(summary, field), unitText(metricUnit(summary, field))].filter(Boolean).join(" "));
    const about = [
      recordedName(summary.enzyme_display_name) || "Name not recorded",
      recordedName(summary.organism) || "organism not recorded",
      recordedName(summary.substrate_name) || "substrate not recorded",
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
  // keeps its exact earlier status in brackets, "Not checked (Unverified)"), the source ("read from the paper", "BRENDA", ...), then
  // "corrected", "no paper linked" or "human-checked".
  function detailStatusHtml(row, { v2Record = isV2Row(row) } = {}) {
    const config = stateConfig(row._recordState || recordStateForRow(row));
    const status = row.verification_status;
    const identityOnly = hasNoPaperLinked(row);
    // The dot is the exact status's colour, as in the table: Not checked is slate (Unverified) or tan (Not reviewed).
    const colour = { accepted: "accepted", curation_pending: "pending", disputed: "disputed" }[config.value]
      || (status === "mathematically_inferred" ? "not-reviewed" : "unverified");
    const words = [
      rowStatusLabel(row, { exact: true }),
      v2Record ? "read from the paper" : sourceTagText(row),
      status === "corrected" ? "corrected" : "",
      identityOnly ? "no paper linked" : "",
    ].filter(Boolean);
    const checkedHtml = isHumanChecked(row) ? `<span class="detail-status-checked">${CHECK_ICON_HTML}human-checked</span>` : "";
    // The light salmon and tan dots get their darker rings (design spec 2).
    const ring = colour === "pending" || colour === "not-reviewed" ? `;--status-ring:var(--st-${colour}-ring)` : "";
    return `<p class="detail-status" style="--status-color:var(--st-${colour})${ring}">${words.map((word, index) => `<span${index ? "" : ' class="detail-status-word"'}>${escapeHtml(word)}</span>`).join("")}${checkedHtml}</p>`;
  }

  // The record's name; a long one (several names in brackets) is set smaller, so the header that stays in view while the
  // record scrolls does not fill the panel. The whole name is always shown.
  const LONG_DETAIL_NAME = 64;
  function detailHeadingHtml(row) {
    const name = String(row.enzyme_display_name || "").trim() || "Enzyme name not recorded";
    return `<h2 id="detailHeading" tabindex="-1"${name.length > LONG_DETAIL_NAME ? ' class="long-name"' : ""}>${escapePublic(name)}</h2>`;
  }

  // The organism with its binomial in italics ("<i>Escherichia coli</i> K-12", "<i>Bacillus</i> sp. A1"); a name that is
  // not a binomial (a virus, "unidentified bacterium") stays roman.
  function organismHtml(name) {
    const text = String(name || "").trim();
    if (/virus|phage|viroid/i.test(text)) return escapePublic(text);
    let match = text.match(/^([A-Z][a-z]+)(\s+spp?\.)(.*)$/);
    if (match) return `<i>${escapePublic(match[1])}</i>${escapePublic(match[2] + match[3])}`;
    match = text.match(/^([A-Z][a-z]+\s+[a-z][a-z-]+)(?![\w.])(.*)$/);
    return match ? `<i>${escapePublic(match[1])}</i>${escapePublic(match[2])}` : escapePublic(text);
  }

  // The form as the header names it: "Wild type", "Variant H150A" (the mutation in mono) or "Variant, not specified";
  // nothing for a record that does not say.
  function detailFormHtml(row) {
    const signature = mutationSignature(row);
    if (signature) return `<span class="detail-form">Variant <code class="mutation">${escapePublic(signature)}</code></span>`;
    const label = enzymeFormLabel(row);
    if (label === "Variant (unspecified)") return "Variant, not specified";
    return label === "Wild type" ? "Wild type" : "";
  }

  // "EC 1.4.1.20 · Bacillus sphaericus · Variant N145A", leaving out what is not recorded, so records of one paper differ
  // at the top; "Unknown" (not stated in the paper or the source database) says which of the two it is.
  function detailSubtitleHtml(row, { ecFromDatabases = false, v2Record = isV2Row(row) } = {}) {
    const ec = String(row.ec_number || "").trim();
    const organism = String(row.organism || "").trim();
    const missing = v2Record ? "not stated in the paper" : "not recorded";
    // A record read from a paper that prints no EC number: the EC the enzyme databases list for this paper's values.
    const ecNote = ecFromDatabases ? " (from enzyme databases; not printed in the paper)" : "";
    const parts = [
      /^unknown$/i.test(ec) ? "EC unknown" : (hasDisplayValue(ec) ? escapePublic(`EC ${ec}${ecNote}`) : ""),
      /^unknown$/i.test(organism) ? `organism ${missing}` : (hasDisplayValue(organism) ? organismHtml(organism) : ""),
      detailFormHtml(row),
    ].filter(Boolean);
    return parts.length ? `<p class="detail-subtitle">${parts.join(" &middot; ")}</p>` : "";
  }

  // The address of a record: this page with #record=<key> (what Copy link copies).
  function recordLink(key) {
    const url = new URL(window.location.href);
    url.hash = `#record=${encodeURIComponent(key)}`;
    return url.href;
  }

  // The record ID in mono and a Copy link button, the header's last line.
  function detailKeyHtml(row) {
    const key = String(row.record_key || row.measurement_key || "").trim();
    if (!key) return "";
    return `<p class="detail-key"><span class="visually-hidden">Record ID </span><code id="detailRecordKey">${escapeHtml(key)}</code>`
      + `<span class="detail-key-sep" aria-hidden="true">&middot;</span>`
      + `<button class="text-button copy-button copy-link" type="button" aria-live="polite" data-copy-text="${escapeHtml(recordLink(key))}" data-copy-label="Copy link">Copy link</button></p>`;
  }

  // "Substrate: ...", under the EC line. A long name is cut to two lines here and given in full under Protein and
  // substrate.
  // A name as the record gives it; "" when blank or "Unknown" (a missing name: a dash in the table, words in the record).
  function recordedName(value) {
    const text = String(value ?? "").trim();
    return hasDisplayValue(text) && !/^unknown$/i.test(text) ? text : "";
  }

  function detailSubstrateHtml(row, detail = {}) {
    const name = recordedName(row.substrate_name) || (isV2Row(row) ? "Not stated in the paper" : "Not recorded");
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

  // The paper's title and year, when the record carries them (paper_title; paper_year, year or publication_year).
  function paperTitleText(summary, detail) {
    const title = publicEvidenceString(String(detail.paper_title ?? summary.paper_title ?? "")).trim();
    if (!title) return "";
    const year = String(detail.paper_year ?? detail.year ?? detail.publication_year ?? summary.paper_year ?? "").trim();
    return /^\d{4}$/.test(year) ? `${title} (${year})` : title;
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

  // ---- Record panel: the snapshot's record checks (design spec 5G) ----
  // data/catlog-checks.<hash>.json, keyed by record key ({db, chg, audit}), when the manifest names one: loaded on the
  // first record opened, like the human-review marks. The page works without it; records carrying their own comparison
  // fields (database_status ... on each value, corrections) do not need it.
  let recordChecks = null;
  let recordChecksLoad = null;

  function recordChecksPath() {
    const entry = manifest.catlog_checks;
    const path = String((typeof entry === "string" ? entry : entry?.path) || "");
    return /^data\/catlog-checks\.[0-9a-f]{12}\.json$/.test(path) ? path : "";
  }

  function ensureRecordChecks() {
    const path = recordChecksPath();
    if (!path || typeof window.fetch !== "function") return Promise.resolve(null);
    if (!recordChecksLoad) {
      recordChecksLoad = window.fetch(versionedAssetUrl(path))
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          const records = data?.records && typeof data.records === "object" ? data.records : data;
          recordChecks = records && typeof records === "object" ? records : {};
          return recordChecks;
        })
        .catch(() => {
          recordChecks = {};
          return recordChecks;
        });
    }
    return recordChecksLoad;
  }

  function recordCheck(row) {
    if (!recordChecks) return null;
    const entry = recordChecks[row.record_key] || recordChecks[row.measurement_key];
    return entry && typeof entry === "object" ? entry : null;
  }

  // ---- Record panel: G. Against the databases ----
  // A record read from the paper: one row per value, what the enzyme databases list for the same paper (fixed phrases from
  // the snapshot, shown as given). An earlier "corrected" record: what its earlier review changed, Before and After. Any
  // other database record the earlier review did not settle: the values are the database's. Nothing else gets the
  // section (never an empty heading).
  const DATABASE_RESULTS = [
    { test: /other[\s_-]*label/i, word: "Other label", key: "neutral" },
    { test: /^(?:confirmed|same)/i, word: "Same number", key: "same" },
    { test: /^correct/i, word: "Corrects the database", key: "magnitude" },
    { test: /^(?:differ|different|not[\s_-]*among)/i, word: "Different number", key: "differs" },
    { test: /^(?:new|absent|none|not[\s_-]*(?:listed|in)\b|no[\s_-]*database)/i, word: "Not in the databases", key: "new" },
    { test: /^(?:not[\s_-]*compared|calc)/i, word: "Not compared", key: "" },
  ];
  // The fixed cause codes (CatLog's contribution report) in words; a phrase is shown as given.
  const DATABASE_CAUSES = {
    header_scale_inverted: "the table header's scale factor applied the wrong way",
    header_scale_ignored: "the table header's scale factor not applied",
    unit_not_converted: "the printed unit not converted",
    uM_entered_as_mM: "a µM value entered as mM",
    mM_entered_as_uM: "an mM value entered as µM",
    time_unit: "a per-minute or per-hour value not converted",
    decimal_or_exponent_slip: "a decimal point or exponent slip",
    value_from_other_row: "a value from another row",
    value_not_in_paper: "a value the paper does not print",
    paper_unit_misprint: "a unit the paper misprints",
    recomputed_ratio: "kcat ÷ Km recomputed from rounded values",
    different_measurement: "a different measurement",
  };
  const DATABASES_COMPARED_NOTE = "Compared with the values BRENDA, SABIO-RK, OED, SKiD and STRENDA DB list for the same paper. "
    + "A different number can mean a different measurement.";
  const DATABASE_VALUES_NOTE = "Not yet checked against the paper: the values are the database's.";
  const DATABASE_SOURCE_BITS = 2 | 4 | 8 | 16 | 32 | 64;

  // Text from the snapshot shown as given (internal placeholders removed), at most `max` characters.
  function shownText(value, max = PRINTED_LINE_MAX) {
    const text = publicEvidenceString(String(value ?? "")).replace(/\s+/g, " ").trim();
    return text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : text;
  }

  // A location that names a local file (a path, a .pdf) is never shown.
  function looksLikeLocalPath(value) {
    return /(?:^|[\s("'])(?:\/(?:Users|home|private|tmp|var|Volumes)\/|~\/|[A-Z]:\\)|file:\/\/|\.(?:pdf|txt|xml|json|tsv)\b/i.test(String(value || ""));
  }

  function databaseResult(status) {
    const text = String(status ?? "").trim();
    if (!text) return null;
    return DATABASE_RESULTS.find((item) => item.test.test(text))
      || { word: text.replace(/_/g, " ").replace(/^./, (character) => character.toUpperCase()), key: "" };
  }

  function databaseCauseText(value) {
    const text = shownText(value);
    if (!text) return "";
    if (DATABASE_CAUSES[text]) return DATABASE_CAUSES[text];
    return /^[A-Za-z]+(?:_[A-Za-z]+)+$/.test(text) ? text.replace(/_/g, " ") : text;
  }

  // One value's comparison from its own fields (database_status, database_line, database_cause, database_evidence, or
  // one database_check object), or null.
  function databaseFacts(line) {
    const check = line?.database_check && typeof line.database_check === "object" ? line.database_check : {};
    const status = shownText(line?.database_status ?? check.status);
    const sentence = shownText(line?.database_line ?? check.line);
    const causeCode = shownText(line?.database_cause ?? check.cause);
    const cause = databaseCauseText(causeCode);
    const evidence = shownText(line?.database_evidence ?? check.evidence);
    if (!status && !sentence && !cause && !evidence) return null;
    const sources = Array.isArray(check.sources) ? check.sources.map((item) => shownText(item)).filter(Boolean).join(", ") : shownText(check.sources);
    const number = check.database_value;
    const listed = number != null && number !== "" && Number.isFinite(Number(number))
      ? `${numberText(String(number))}${check.database_unit ? ` ${unitText(shownText(check.database_unit))}` : ""}`
      : "";
    return { status, sentence, cause, causeCode, evidence: looksLikeLocalPath(evidence) ? "" : evidence, databases: [sources, listed].filter(Boolean).join(": ") };
  }

  // The side file's comparison of one parameter (["same", "BRENDA,SABIO-RK"], ["differs", "BRENDA", 3]) in the spec's
  // fixed phrases.
  function sideFileDatabaseFacts(entry, metric) {
    if (!Array.isArray(entry) || !entry.length) return null;
    const [status, sourceText = "", count] = entry;
    const sources = String(sourceText || "").split(/\s*,\s*/).filter(Boolean);
    const names = sentenceList(sources);
    const result = databaseResult(status);
    let sentence = "";
    if (result?.key === "same") sentence = `same number in ${sources.join(", ")}`;
    else if (result?.key === "differs") {
      sentence = `not among the ${Number(count) > 0 ? `${formatInteger(count)} ` : ""}${metric} values ${names} ${sources.length > 1 ? "list" : "lists"} for this paper`;
    } else if (result?.key === "new") sentence = `no database lists a ${metric} for this paper`;
    else if (/^calc/i.test(String(status))) sentence = "calculated; not compared";
    // The phrase is the result (beside its square) and names the databases; no column repeats them.
    return { status: String(status), sentence, cause: "", evidence: "", databases: "", phraseOnly: Boolean(sentence) };
  }

  // The cause codes that are a unit or a power of ten (the red square of a unit or magnitude change); another correction
  // of the database is a different number (brown).
  const MAGNITUDE_CAUSES = new Set(["header_scale_inverted", "header_scale_ignored", "unit_not_converted", "uM_entered_as_mM",
    "mM_entered_as_uM", "time_unit", "decimal_or_exponent_slip", "paper_unit_misprint"]);

  function databaseResultHtml(facts) {
    let result = databaseResult(facts.status);
    if (result?.key === "magnitude" && facts.causeCode && !MAGNITUDE_CAUSES.has(facts.causeCode)) result = { ...result, key: "differs" };
    const mark = `<span class="cmp-mark${result?.key ? ` cmp-${result.key}` : ""}" aria-hidden="true"></span>`;
    if (facts.phraseOnly) {
      const phrase = facts.sentence.charAt(0).toUpperCase() + facts.sentence.slice(1);
      return `<span class="cmp-result">${mark}<span>${caretHtml(escapePublic(phrase))}</span></span>`;
    }
    const head = result ? `<span class="cmp-result">${mark}<strong>${escapeHtml(result.word)}</strong></span>` : "";
    return head
      + (facts.sentence ? `<span class="cmp-line">${caretHtml(escapePublic(facts.sentence))}</span>` : "")
      + (facts.cause ? `<small>Cause: ${escapePublic(facts.cause)}</small>` : "")
      + (facts.evidence ? `<small>${caretHtml(escapePublic(facts.evidence))}</small>` : "");
  }

  // A record read from the paper: its values against the databases, or "" when the snapshot carries no comparison.
  function v2DatabaseComparisonHtml(summary, detail, proof, check) {
    const metricSummary = metricSummaryFor(summary, detail);
    const rows = (proof?.lines || []).map((line) => {
      const field = (v2MetricLabels[line.metric] || [])[0];
      const facts = databaseFacts(line) || sideFileDatabaseFacts(check?.db?.[line.metric], line.metric);
      if (!field || !facts) return null;
      return { field, label: v2MetricLabels[line.metric][1], facts };
    }).filter(Boolean);
    const paperNotes = (Array.isArray(detail.database_note) ? detail.database_note : [detail.database_note])
      .map((note) => shownText(note)).filter(Boolean);
    if (!rows.length && !paperNotes.length) return "";
    const withDatabases = rows.some((row) => row.facts.databases);
    const table = rows.length
      ? `<table class="values-table compare-table"><thead><tr><th scope="col">Parameter</th><th scope="col">CatLog</th>`
        + `${withDatabases ? '<th scope="col">Databases for this paper</th>' : ""}<th scope="col">Result</th></tr></thead><tbody>`
        + rows.map(({ field, label, facts }) => `<tr><th scope="row">${label}</th>`
          + `<td class="cmp-catlog">${metricHasValue(metricSummary, field) ? `${panelValueHtml(metricSummary, field)} <small>${metricUnitHtml(metricSummary, field)}</small>` : EMPTY_VALUE}</td>`
          + `${withDatabases ? `<td>${facts.databases ? caretHtml(escapePublic(facts.databases)) : EMPTY_VALUE}</td>` : ""}`
          + `<td class="cmp-cell">${databaseResultHtml(facts)}</td></tr>`).join("")
        + "</tbody></table>"
      : "";
    return paperNotes.map((note) => `<p class="cmp-paper-note">${caretHtml(escapePublic(note))}</p>`).join("")
      + table
      + (rows.length ? `<p class="section-note">${escapeHtml(DATABASES_COMPARED_NOTE)}</p>` : "");
  }

  // An earlier "corrected" record's correction trail (corrections, corrected_fields or the side file's chg), each
  // item as {field, before, after, unit, kind, listed, why}.
  function correctionItems(detail, check) {
    const raw = [detail.corrections, detail.corrected_fields, detail.earlier_corrections, check?.chg].find(Array.isArray) || [];
    return raw.filter((item) => item && typeof item === "object").map((item) => ({
      field: String(item.field ?? item.f ?? "").trim(),
      before: item.old_value ?? item.before ?? item.b,
      after: item.new_value ?? item.after ?? item.a,
      unit: shownText(item.unit ?? item.u),
      kind: String(item.kind ?? item.change ?? item.k ?? "").trim(),
      listed: shownText(item.listed ?? item.before_listed),
      why: shownText(item.evidence_table_row ?? item.evidence ?? item.why ?? item.w),
    })).filter((item) => item.field);
  }

  const CORRECTION_FIELDS = { kcat: "kcat", km: "km", kcat_over_km: "kcat_over_km", "kcat/km": "kcat_over_km", ki: "ki" };
  const CHANGE_KINDS = [
    { test: /round|precision|digit/i, word: "more digits / rounding", key: "precision" },
    { test: /magnitude|power|scale|unit/i, word: "unit or magnitude", key: "magnitude" },
    { test: /^add/i, word: "added: the source had none", key: "new" },
    { test: /differ|number|value/i, word: "different number", key: "differs" },
  ];

  function powerFactorText(power) {
    const size = Math.abs(power);
    const factor = size <= 3 ? String(10 ** size) : `10${[...String(size)].map((character) => SUPERSCRIPT_DIGITS[character]).join("")}`;
    return `${power < 0 ? "÷" : "×"} ${factor}`;
  }

  // "unit or magnitude (÷ 1000)": the factor when After is Before times a power of ten.
  function changeWords(item) {
    const before = Number(item.before);
    const after = Number(item.after);
    let kind = CHANGE_KINDS.find((entry) => entry.test.test(item.kind));
    if (!kind && (item.before == null || item.before === "")) kind = CHANGE_KINDS[2];
    if (!kind) return { word: item.kind.replace(/_/g, " "), key: "" };
    if (kind.key === "magnitude" && before > 0 && after > 0) {
      const power = Math.round(Math.log10(after / before));
      if (power && Math.abs(Math.log10(after / before) - power) < 0.01) return { word: kind.word, factor: `(${powerFactorText(power)})`, key: kind.key };
    }
    return kind;
  }

  function correctionValueText(value, unit) {
    if (value == null || value === "") return "none";
    const number = Number(value);
    return `${Number.isFinite(number) && String(value).trim() !== "" ? numberText(String(value)) : shownText(value)}${unit ? ` ${unitText(unit)}` : ""}`;
  }

  function earlierCorrectionsHtml(items) {
    const valueItems = [];
    const identity = [];
    items.forEach((item) => {
      const key = item.field.toLowerCase().replace(/\s+/g, "");
      const field = CORRECTION_FIELDS[key];
      const name = field ? VALUE_FIELDS.find(([shown]) => shown === field)[1] : "";
      if (name) {
        // A field whose number did not change is not listed.
        if (item.before != null && item.before !== "" && Number(item.before) === Number(item.after)) return;
        valueItems.push({ ...item, name });
      } else if (/uniprot|accession/.test(key)) {
        identity.push(`UniProt ${shownText(item.before) || "none"} → ${shownText(item.after) || "none"}`);
      } else if (/sequence/.test(key)) identity.push("Sequence replaced");
      else if (/smiles/.test(key)) identity.push("SMILES replaced");
      else identity.push(`${item.field.replace(/_/g, " ").replace(/^./, (character) => character.toUpperCase())} changed`);
    });
    if (!valueItems.length && !identity.length) return "";
    const table = valueItems.length
      ? `<table class="values-table compare-table"><thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Change</th></tr></thead><tbody>`
        + valueItems.map((item) => {
          const change = changeWords(item);
          const hasBefore = item.before != null && item.before !== "";
          const where = !hasBefore ? "" : (item.listed ? `as in ${item.listed} for this paper` : "earlier catalog value");
          return `<tr><th scope="row">${item.name}</th>`
            + `<td>${escapePublic(correctionValueText(item.before, item.unit))}${where ? `<small>${escapePublic(where)}</small>` : ""}</td>`
            + `<td>${escapePublic(correctionValueText(item.after, item.unit))}</td>`
            + `<td class="cmp-cell"><span class="cmp-result"><span class="cmp-mark${change.key ? ` cmp-${change.key}` : ""}" aria-hidden="true"></span>`
            + `<span>${escapeHtml(change.word)}${change.factor ? ` <span class="cmp-factor">${escapeHtml(change.factor)}</span>` : ""}</span></span></td></tr>`;
        }).join("")
        + "</tbody></table>"
      : "";
    const reasons = [...new Set(items.map((item) => item.why).filter((why) => why && !looksLikeLocalPath(why)))];
    return table
      + (identity.length ? `<ul class="value-notes">${identity.map((text) => `<li>${escapePublic(text)}</li>`).join("")}</ul>` : "")
      + reasons.map((why) => `<p class="section-note">Why: changed in the earlier automated review to the value the paper prints — ${caretHtml(escapePublic(why.replace(/[.\s]+$/, "")))}.</p>`).join("");
  }

  function databasesSection(summary, detail, { proof = null, check = null, v2Record = false, hasPaper = true } = {}) {
    let body = "";
    if (v2Record) body = v2DatabaseComparisonHtml(summary, detail, proof, check);
    else {
      const corrections = correctionItems(detail, check);
      if (corrections.length) body = earlierCorrectionsHtml(corrections);
      else {
        const result = summary._recordState || recordStateForRow(summary);
        const fromDatabase = Boolean(rowSourceBits(summary) & DATABASE_SOURCE_BITS);
        // A database record the earlier review did not settle, with a paper to check it against (a record that names no
        // paper gets no such line: its Paper section says None).
        if (fromDatabase && hasPaper && !hasNoPaperLinked(summary) && (result === "curation_pending" || result === "not_verified")) {
          body = `<p class="section-text">${escapeHtml(DATABASE_VALUES_NOTE)}</p>`;
        }
      }
    }
    return body ? detailSection("databases", "Against the databases", body) : "";
  }

  // ---- Record panel: C. Source ----
  function sourceSection(summary, detail, { v2Record, proof, mergedRows, paperCount, evidence, sourceNoteHtml }) {
    const facts = proof?.facts || null;
    const dataId = snapshotDataId();
    return detailSection("source", "Source", kvList([
      kv("Source", recordSourceName(summary.source_db || detail.source_db, v2Record)),
      // How many database rows a record merges is said once, here.
      mergedRows > 1
        ? kv("Merged from", `${formatInteger(mergedRows)} database entries${paperCount ? `, ${formatInteger(paperCount)} ${paperCount === 1 ? "paper" : "papers"}` : ""}`)
        : "",
      // A record read by CatLog: how (Method) and what the second AI check found; an older record: what stands behind
      // its values.
      v2Record
        ? linkedKv("Method", `${escapePublic(v2MethodSentence(facts, { unitChanged: measurementNotes(summary, detail, { proof }).unitCautions.length > 0 }))} <a class="method-link" href="#guide-method">How CatLog reads papers<span aria-hidden="true"> →</span></a>`)
        : (evidence && evidence !== "Database note" ? kv("Evidence", evidence) : ""),
      v2Record && facts ? kv("Second check", v2CheckText(facts, v2CheckOptions(summary, detail, proof))) : "",
      kv("License", detailLicense(summary, detail, v2Record)),
      dataId ? kv("Data ID", `${dataId}${manifest.generated_at ? ` (snapshot ${formatDate(manifest.generated_at)})` : ""}`) : "",
    ]) + sourceNoteHtml);
  }

  // ---- Record panel: F. Paper ----
  function paperSection(summary, detail, { pmids, standInIds, dois, proof, notesHtml }) {
    const title = paperTitleText(summary, detail);
    const places = proof ? [...new Set(proof.lines.map((line) => v2LinePlace(line)).filter(Boolean))] : [];
    const noPaper = !pmids.length && !standInIds.length && !dois.length;
    return detailSection("paper", "Paper", kvList([
      title ? kv("Title", title) : "",
      pmids.length ? linkedKv(pmids.length === 1 ? "PubMed" : "PubMed IDs", referenceList(pmids, pmidLink)) : "",
      dois.length ? linkedKv(dois.length === 1 ? "DOI" : "DOIs", referenceList(dois, doiLink)) : "",
      standInIds.length ? kv(standInIds.length === 1 ? "Paper ID" : "Paper IDs", `${standInIds.join(", ")} (no PMID)`) : "",
      noPaper ? kv("PMID or DOI", "None") : "",
      places.length ? kv("Location", places.join("; ")) : "",
    ]) + notesHtml);
  }

  // ---- Record panel: H. Review and audit ----
  // The record's review in one sentence, the AI audit (date and result only), what a human reviewer found, then the
  // record's actions.
  const V2_STATUS_SENTENCE = "Accepted: read from the paper by CatLog.";
  const CORRECTED_LISTED_SENTENCE = "Corrected and accepted in the earlier automated review; the changes are listed under Against the databases.";

  function sideFileAuditText(check) {
    if (!Array.isArray(check?.audit) || !check.audit.length) return "";
    const [date, result] = check.audit;
    const verdict = /unit/i.test(String(result || ""))
      ? "re-checked against the paper; the unit was corrected."
      : (/^(?:kept|confirmed)$/i.test(String(result || "")) ? "re-checked against the paper and kept." : "re-checked against the paper.");
    const when = auditDateText(date);
    const text = `${when ? `${when}: ` : ""}${verdict}`;
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function reviewSection(summary, detail, { v2Record, proof, check, hasCorrections, reportHref }) {
    const humanNote = humanReviewNote(summary);
    const status = v2Record
      ? escapePublic(V2_STATUS_SENTENCE)
      // The earlier review was an automated pipeline of AI models and code checks: the Guide's method section says so.
      : `${escapePublic(hasCorrections && summary.verification_status === "corrected" ? CORRECTED_LISTED_SENTENCE : reviewOutcome(summary, detail))} <a class="method-link" href="#guide-method">How the earlier review worked<span aria-hidden="true"> →</span></a>`;
    const audit = (proof && v2AuditText(proof.lines, proof.facts)) || sideFileAuditText(check);
    return detailSection("review", "Review and audit", kvList([
      linkedKv("Status", status),
      audit ? kv("AI audit", audit) : "",
      // What a human reviewer found, on every record with a mark; the check only where the record shows "human-checked".
      humanNote
        ? linkedKv("Human review", `${isHumanChecked(summary) ? CHECK_ICON_HTML : ""}${escapePublic(humanNote)}`, { className: "human-review-line" })
        : "",
    ]) + `
      <div class="detail-actions">
        <button id="downloadSelectedJson" class="button primary" type="button">Download record</button>
        <a id="reportRecordProblem" class="button secondary" href="${escapeHtml(reportHref)}">Report a problem</a>
      </div>`);
  }

  // The header (section A): name, close, EC · organism · form, substrate (with its condition note), status, record ID.
  function detailTopHtml(summary, detail, { v2Record = isV2Row(summary), withDetail = true } = {}) {
    return `
      <div class="detail-top">
        <button id="closeDetailButton" class="icon-button close-detail" type="button" aria-label="Close record">&times;</button>
        ${detailHeadingHtml(summary)}
        ${detailSubtitleHtml(summary, { ecFromDatabases: withDetail && v2Record && ecFromDatabases(detail) })}
        ${withDetail ? detailSubstrateHtml(summary, detail) : ""}
        ${withDetail ? detailStatusHtml(summary, { v2Record }) : ""}
        ${detailKeyHtml(summary)}
      </div>`;
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
    const noteSource = recordSourceName(summary.source_db || detail.source_db);
    const proofLines = rawProofLines.filter((line) => Boolean(evidenceNoteHtml(line)) && !noteRepeatsConditions(line, summary))
      .map((line) => noteWithoutHeadingSource(line, noteSource));
    const v2Record = isV2Row(summary) || String(detail.verification_method || "").startsWith(v2Method);
    const v2Proof = v2ProofFacts(summary, detail);
    const isSourceNote = (summary.proof_kind || detail.proof_kind) === "source_note";
    const mergedRows = Number(detail.source_record_count || summary.source_record_count || 0);
    // What stands behind an older record's values (a record read by CatLog says so in its Method line).
    const evidence = v2Record ? "" : evidenceLabel(summary, proofLines);
    // An older record's notes expand on request: a database's own note under Source, the earlier review's notes on where
    // the paper prints the values under Paper.
    const notesDisclosure = (heading) => `<details class="sequence-disclosure detail-notes"><summary>${escapeHtml(heading)}</summary>`
      + `<div class="evidence-note-list">${evidenceNotesHtml(proofLines, 3)}</div></details>`;
    const showNotes = proofLines.length && !v2Proof;
    const sourceNoteHtml = showNotes && isSourceNote
      ? notesDisclosure(noteSource === "Not recorded" ? "Database note" : `Note from ${noteSource}`)
      : "";
    const paperNotesHtml = showNotes && !isSourceNote ? notesDisclosure("Earlier automated review: where the values are printed") : "";
    const dataOrigin = publicEvidenceString(detail.data_origin);
    const check = recordCheck(summary);
    const hasCorrections = correctionItems(detail, check).length > 0;
    // The values the record shows where they differ from the stored ones (the source's own kcat/Km), for the report email.
    const consistentShown = measurementNotes(summary, detail, { proof: v2Proof }).consistent;
    const shownValues = consistentShown ? { kcat_over_km: consistentShown.value } : {};
    const reportHref = reportProblemHref(metricSummaryFor(summary, detail), pmids, { dois, standInIds, shown: shownValues });
    // The order (design spec 5): what was measured, where it comes from and how it was checked, under which conditions,
    // which protein and substrate, the paper, the databases, the review; the source's own fields last.
    $("detailContent").innerHTML = `
      ${detailTopHtml(summary, detail, { v2Record })}
      ${valuesSection(summary, detail, { proof: v2Proof })}
      ${sourceSection(summary, detail, { v2Record, proof: v2Proof, mergedRows, paperCount: paperIds.length, evidence, sourceNoteHtml })}
      ${conditionsSection(summary, detail)}
      ${proteinSection(summary, detail)}
      ${paperSection(summary, detail, { pmids, standInIds, dois, proof: v2Proof, notesHtml: paperNotesHtml })}
      ${databasesSection(summary, detail, { proof: v2Proof, check, v2Record, hasPaper: paperIds.length + dois.length > 0 })}
      ${reviewSection(summary, detail, { v2Record, proof: v2Proof, check, hasCorrections, reportHref })}
      ${detailDisclosure("Source details", [
        kv("Name from", v2Record ? "Paper" : sourceLabels[summary.enzyme_label_source] || "Not recorded"),
        mergedDatabasesRow(summary, detail),
        // Only a plain origin other than the usual "experimental" (internal tokens are not shown).
        dataOrigin && !/^experimental$/i.test(dataOrigin) && !/[_\d]/.test(dataOrigin) ? kv("Data origin", dataOrigin) : "",
      ])}
    `;
    bindDetailTop();
    document.querySelectorAll("#detailContent [data-flag-note]").forEach((button) => {
      button.addEventListener("click", () => showFlagNote(button.dataset.flagNote));
    });
    document.querySelectorAll("#detailContent .detail-section .copy-button").forEach((button) => {
      button.addEventListener("click", () => copyDetailValue(button));
    });
    document.querySelectorAll("#detailContent [data-reveal-target]").forEach((button) => {
      button.addEventListener("click", () => toggleReveal(button));
    });
    $("downloadSelectedJson").addEventListener("click", () => {
      const payload = {
        ...publicRecordObject(summary, detail),
        snapshot: manifest.generated_at || null,
        data_id: snapshotDataId(),
        license_note: SOURCE_LICENSE_NOTE,
      };
      triggerBlobDownload(`${summary.record_key || "catlog-record"}.json`, JSON.stringify(payload, null, 2));
    });
  }

  // The header's buttons (close, Copy link), in every state of the record (loading, loaded, not loaded).
  function bindDetailTop() {
    $("closeDetailButton").addEventListener("click", closeDetailAndRestoreFocus);
    document.querySelectorAll("#detailContent .detail-top .copy-button").forEach((button) => {
      button.addEventListener("click", () => copyDetailValue(button));
    });
  }

  // Show / Hide a sequence or SMILES under its row.
  function toggleReveal(button) {
    const box = $(button.dataset.revealTarget);
    if (!box) return;
    const open = box.hidden;
    box.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    button.textContent = open ? "Hide" : "Show";
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

  // The paper-read records are two groups, as Browse and Stats name them: read from the paper by CatLog (its own
  // licence) and the earlier paper extractions (licensed as their papers are). Without the snapshot's count of the first,
  // one row names both.
  const EARLIER_EXTRACTIONS_LABEL = "Earlier paper extractions";
  const EARLIER_EXTRACTIONS_LICENSE = "as published (see paper)";
  function sourceAttributionRows(sources) {
    const fromPaper = Number(statsOverview(Number(manifest.total_rows || 0))?.from_paper?.records);
    return sources.flatMap((item) => {
      if (item.key !== "primary_paper_direct") return [item];
      const total = Number(item.row_count);
      if (!Number.isFinite(fromPaper) || !Number.isFinite(total) || fromPaper > total) {
        return [{ ...item, name: "Read from the paper (by CatLog, or earlier extractions)",
          licenseText: `${PRIMARY_LITERATURE_LICENSE} for the records CatLog read; earlier extractions: ${EARLIER_EXTRACTIONS_LICENSE}` }];
      }
      return [
        { ...item, row_count: fromPaper, licenseText: PRIMARY_LITERATURE_LICENSE },
        ...(total > fromPaper ? [{ ...item, name: EARLIER_EXTRACTIONS_LABEL, row_count: total - fromPaper,
          licenseText: `License: ${EARLIER_EXTRACTIONS_LICENSE}` }] : []),
      ];
    });
  }

  function renderSourceAttribution() {
    const sources = sourceAttributionRows(sourceDatabases());
    const guideList = $("guideSourceList");
    if (guideList) {
      guideList.innerHTML = sources.map((item) => {
        const rowCount = item.row_count == null || item.row_count === "" ? "" : `${formatInteger(item.row_count)} records in this snapshot`;
        const license = item.licenseText
          ? escapeHtml(item.licenseText)
          : (item.key === "primary_paper_direct"
              ? escapeHtml(PRIMARY_LITERATURE_LICENSE)
              : (item.license && !/^see source$/i.test(item.license) ? `License: ${escapeHtml(item.license)}` : "See the source site for license terms"));
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
    showTableTop();
  }

  // A new page (Previous, Next, another page size) opens at its first row: the table scrolls inside its own box, so
  // its offset would otherwise carry over and show the new page near its bottom. The sideways offset stays.
  function showTableTop() {
    const wrap = $("recordTableWrap");
    if (wrap) wrap.scrollTop = 0;
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
      // The examples are reached with the arrow keys, never with Tab (they follow the header in the page): Tab to
      // anything else closes them at once.
      input.addEventListener("blur", (event) => {
        if (event.relatedTarget && !$("searchSuggestions")?.contains(event.relatedTarget)) hideSuggestions();
        else scheduleSuggestionHide();
      });
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
    // Phones: the sheet's "Show N records" button closes it.
    $("showResultsButton")?.addEventListener("click", () => {
      setFiltersOpen(false, { focus: false });
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
    for (const view of ["browse", "guide", "stats", "team"]) {
      const link = $(`${view}Button`);
      if (!link) continue;
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
      const filtering = applyLocationFilters() && state.records.length > 0;
      const recordKey = recordKeyFromLocation();
      if (recordKey && recordKey !== state.selectedKey) {
        // With new filters the record opens when their results are ready (applyFilters ends by opening it), on the
        // page that shows it; looking it up now would use the previous results.
        state.pendingRecordKey = recordKey;
        if (!filtering) openRecordFromLocation();
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
    });
    narrowDetailMedia.addEventListener?.("change", () => {
      syncFilterPanel();
      syncDetailPanelAccessibility();
    });
    // Crossing into a phone, tablet or desktop width puts the filters where that width has them.
    sidebarFiltersMedia.addEventListener?.("change", applyFiltersLayout);
    desktopMedia.addEventListener?.("change", applyFiltersLayout);
    filtersOpenByDefaultMedia.addEventListener?.("change", applyFiltersLayout);
    filtersBesideRecordMedia.addEventListener?.("change", syncFilterPanel);
    // "Only human-checked" sits under Accepted: ticking it ticks Accepted too, and unticking Accepted unticks it (only
    // accepted records are human-checked, so it would leave no results).
    $("statusChecklist").addEventListener("change", (event) => {
      const accepted = [...document.querySelectorAll('input[name="recordState"]')].find((input) => input.value === "accepted");
      if (event.target?.id === "humanCheckedFilter" && event.target.checked && accepted) accepted.checked = true;
      if (event.target === accepted && !accepted.checked && $("humanCheckedFilter")) $("humanCheckedFilter").checked = false;
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
        focusAfterLastFilter();
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
    // Phones: Filters opens the sheet; its × and the backdrop close it.
    $("openFiltersButton").addEventListener("click", () => {
      setFiltersOpen(!document.body.classList.contains("filters-open"));
    });
    $("closeFiltersButton").addEventListener("click", () => {
      setFiltersOpen(false, { focus: false });
      filtersToggleButton()?.focus();
    });
    $("filterBackdrop").addEventListener("click", () => {
      setFiltersOpen(false, { focus: false });
      filtersToggleButton()?.focus();
    });
    // From 641px: the rail's Filters button opens the sidebar and « collapses it to the rail (remembered on a desktop
    // screen).
    $("filterRailButton")?.addEventListener("click", () => setFiltersOpen(true, { remember: true }));
    $("collapseFiltersButton")?.addEventListener("click", () => {
      setFiltersOpen(false, { remember: true, focus: false });
      $("filterRailButton")?.focus({ preventScroll: true });
    });
    $("pageSizeSelect").addEventListener("change", () => {
      applyPageSize($("pageSizeSelect").value);
    });
    $("prevButton").addEventListener("click", () => {
      resetDetail();
      state.pendingPage = 0;
      state.page -= 1;
      renderRows();
      showTableTop();
    });
    $("nextButton").addEventListener("click", () => {
      resetDetail();
      state.pendingPage = 0;
      state.page += 1;
      renderRows();
      showTableTop();
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
      // Escape closes the phone sheet; the sidebar is part of the page and stays (« collapses it).
      if (event.key === "Escape" && document.body.classList.contains("filters-open") && !filtersDocked()) {
        const activeElement = document.activeElement;
        if (activeElement?.matches?.('input[type="search"]') && activeElement.value) return;
        setFiltersOpen(false, { focus: false });
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
        throw new Error(PAGE_OUT_OF_DATE);
      }
      renderSummary();
      renderDownloadMetadata();
      renderSourceAttribution();
      renderGuideMethod();
      const cleanUrl = viewUrl(viewFromLocation());
      if (!["#browse", "#guide", "#stats", "#team"].includes(window.location.hash)) cleanUrl.hash = window.location.hash;
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
      // The sidebar starts open from 1200px (unless this viewer collapsed it), as the rail below (unless they opened it).
      applyFiltersLayout();
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
      publicRecordObject,
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
      rowCautionBits,
      valueFlagBadgeHtml,
      temperatureFlagBadgeHtml,
      conditionCellHtml,
      publicLoadMessage,
      enzymeFormLabel,
      enzymeFormHtml,
      sequenceSourceLabel,
      sequenceNoteText,
      isV2Row,
      identityResolutionLabel,
      valuesSection,
      conditionsSection,
      lookAlikeRowKeys,
      substrateNoteHtml,
      proteinSection,
      organismHtml,
      databasesSection,
      toggleReveal,
      recordLink,
      numberHtml,
      numberText,
      metricDisplayWithUnitHtml,
      roundingFigures,
      panelValueHtml,
      efficiencyOriginHtml,
      printedValueText,
      v2LineFacts,
      conversionFacts,
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
      renderDownloadMetadata,
      renderGuideMethod,
      sourceAttributionRows,
      humanComparisonText,
      agreementText,
      statsCohortData,
      statsOverview,
      statsBrowseHref,
      statsValueRange,
      statsUnacceptedFields,
      statsShare,
      statsTable,
      statsBarChart,
      statsDonut,
      statsNiceScale,
      statsMainSources,
      agreementHeadline,
      agreementLeadHtml,
      renderTeam,
      teamNumbers,
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
