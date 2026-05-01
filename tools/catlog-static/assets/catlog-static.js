(function () {
  const manifest = window.CATLOG_STATIC_MANIFEST || {};
  const state = {
    records: [],
    filtered: [],
    page: 1,
    pageSize: 50,
    selectedKey: "",
    loadedScripts: new Set(["data/manifest.js"]),
  };

  const tierOrder = {
    paper_grounded_high_confidence: 0,
    paper_grounded: 1,
    literature_linked: 2,
    cross_source_supported: 3,
    candidate_only: 4,
  };

  const statusLabels = {
    corrected: "accepted (corrected)",
    verified: "accepted",
    mathematically_inferred: "pending draft",
    manual_review_required: "manual follow-up",
    unverified: "final check missing",
    disputed: "disputed",
  };

  const tierLabels = {
    paper_grounded_high_confidence: "paper-backed (full-text verified)",
    paper_grounded: "paper-backed",
    literature_linked: "paper linked",
    cross_source_supported: "multi-source",
    candidate_only: "single-source draft",
  };

  const identityLabels = {
    accession_resolved: "accession resolved",
    sequence_resolved_no_accession: "sequence only",
    candidate_pool: "candidate pool",
    identity_unresolved: "identity unresolved",
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

  function formatInteger(value) {
    return new Intl.NumberFormat().format(Number(value || 0));
  }

  function compactValue(value) {
    if (value === null || value === undefined || value === "") return "n/a";
    if (Array.isArray(value)) return value.length ? value.join(", ") : "n/a";
    return String(value);
  }

  function normalizeSequence(value) {
    return String(value || "").replace(/\s+/g, "").trim();
  }

  function sequenceLengthLabel(sequence) {
    return sequence ? `${formatInteger(sequence.length)} aa` : "not preserved";
  }

  function formatSequenceForDisplay(sequence) {
    const chunks = String(sequence || "").match(/.{1,60}/g) || [];
    return chunks.map((line) => (line.match(/.{1,10}/g) || [line]).join(" ")).join("\n");
  }

  function labelFromToken(value, fallback = "not preserved") {
    const text = String(value || "").trim();
    if (!text) return fallback;
    return text.replaceAll("_", " ").replace(/\b([a-z])/g, (match) => match.toUpperCase());
  }

  function displayKinetic(row, field, label) {
    const display = row[`${field}_display`];
    if (!display || display === "n/a") return "";
    return `<span class="metric-line">${label}: ${escapeHtml(display)}</span>`;
  }

  function badgeClassForStatus(status) {
    if (status === "verified" || status === "corrected") return "ok";
    if (status === "manual_review_required" || status === "disputed") return "warn";
    return "";
  }

  function badgeClassForTier(tier) {
    if (tier === "paper_grounded" || tier === "paper_grounded_high_confidence") return "paper";
    if (tier === "candidate_only") return "warn";
    return "";
  }

  function loadScript(src) {
    if (state.loadedScripts.has(src)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
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

  function uniqueValues(field) {
    return [...new Set(state.records.map((row) => row[field]).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b)));
  }

  function fillSelect(id, values, labels = {}) {
    const select = $(id);
    select.innerHTML = '<option value="">All</option>' + values.map((value) => (
      `<option value="${escapeHtml(value)}">${escapeHtml(labels[value] || value)}</option>`
    )).join("");
  }

  function renderSummary() {
    const summary = manifest.summary || {};
    const totals = summary.totals || {};
    const coverage = summary.coverage || {};
    const trust = summary.trust_snapshot || {};
    $("snapshotLabel").textContent = manifest.generated_at ? `Generated ${manifest.generated_at}` : "Static snapshot";
    $("rowCountLabel").textContent = `${formatInteger(manifest.total_rows || state.records.length)} rows`;
    $("summaryGrid").innerHTML = [
      ["Rows", totals.records || manifest.total_rows || state.records.length, "records in this snapshot"],
      ["EC numbers", totals.unique_ec_numbers || 0, "distinct catalytic classes"],
      ["Claim-verified", trust.claim_verified_rows || 0, "accepted or corrected rows"],
      ["Sequence-resolved", coverage.sequence_resolved || 0, "rows with sequence context"],
    ].map(([label, value, note]) => `
      <article class="summary-card">
        <span>${escapeHtml(label)}</span>
        <strong>${formatInteger(value)}</strong>
        <span>${escapeHtml(note)}</span>
      </article>
    `).join("");
  }

  function setupFilters() {
    fillSelect("statusSelect", uniqueValues("verification_status"), statusLabels);
    fillSelect("tierSelect", uniqueValues("evidence_confidence_tier"), tierLabels);
    fillSelect("sourceSelect", uniqueValues("source_db"));
    fillSelect("identitySelect", uniqueValues("identity_resolution_state"), identityLabels);
  }

  function currentFilters() {
    return {
      q: $("searchInput").value.trim().toLowerCase(),
      status: $("statusSelect").value,
      tier: $("tierSelect").value,
      source: $("sourceSelect").value,
      identity: $("identitySelect").value,
      sort: $("sortSelect").value,
    };
  }

  function rowMatches(row, filters) {
    if (filters.q && !row._search.includes(filters.q)) return false;
    if (filters.status && row.verification_status !== filters.status) return false;
    if (filters.tier && row.evidence_confidence_tier !== filters.tier) return false;
    if (filters.source && row.source_db !== filters.source) return false;
    if (filters.identity && row.identity_resolution_state !== filters.identity) return false;
    return true;
  }

  function sortRows(rows, sort) {
    const textKey = (field) => (a, b) => String(a[field] || "").localeCompare(String(b[field] || ""));
    const numericDesc = (field) => (a, b) => {
      const av = a[field] == null ? Number.NEGATIVE_INFINITY : Number(a[field]);
      const bv = b[field] == null ? Number.NEGATIVE_INFINITY : Number(b[field]);
      return bv - av;
    };
    const sorters = {
      ec_number: textKey("ec_number"),
      enzyme: textKey("enzyme_display_name"),
      organism: textKey("organism"),
      substrate: textKey("substrate_name"),
      source: textKey("source_db"),
      kcat: numericDesc("kcat"),
      km: numericDesc("km"),
      ki: numericDesc("ki"),
      evidence: (a, b) => {
        const tierDelta = (tierOrder[a.evidence_confidence_tier] ?? 99) - (tierOrder[b.evidence_confidence_tier] ?? 99);
        if (tierDelta !== 0) return tierDelta;
        return (Number(b.source_record_count || 0) - Number(a.source_record_count || 0))
          || String(a.ec_number || "").localeCompare(String(b.ec_number || ""));
      },
    };
    rows.sort(sorters[sort] || sorters.evidence);
  }

  function applyFilters({ resetPage = true } = {}) {
    const filters = currentFilters();
    state.filtered = state.records.filter((row) => rowMatches(row, filters));
    sortRows(state.filtered, filters.sort);
    if (resetPage) state.page = 1;
    renderRows();
  }

  function renderRows() {
    const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
    state.page = Math.min(Math.max(1, state.page), totalPages);
    const start = (state.page - 1) * state.pageSize;
    const pageRows = state.filtered.slice(start, start + state.pageSize);
    $("activeSummary").textContent = `${formatInteger(state.filtered.length)} matching rows, showing ${formatInteger(start + 1)}-${formatInteger(Math.min(start + pageRows.length, state.filtered.length))}`;
    $("pageLabel").textContent = `Page ${formatInteger(state.page)} of ${formatInteger(totalPages)}`;
    $("prevButton").disabled = state.page <= 1;
    $("nextButton").disabled = state.page >= totalPages;
    $("recordsBody").innerHTML = pageRows.map((row) => {
      const kineticLines = [
        displayKinetic(row, "kcat", "kcat"),
        displayKinetic(row, "km", "Km"),
        displayKinetic(row, "ki", "Ki"),
        displayKinetic(row, "kcat_over_km", "kcat/Km"),
      ].filter(Boolean).join("<br>");
      return `
        <tr data-key="${escapeHtml(row.record_key)}" class="${row.record_key === state.selectedKey ? "selected" : ""}">
          <td class="primary-cell">
            <strong>${escapeHtml(row.enzyme_display_name || "Name not preserved")}</strong>
            <span class="muted">${escapeHtml(row.ec_number || "n/a")}</span>
          </td>
          <td class="context-cell">
            <strong>${escapeHtml(row.organism || "n/a")}</strong>
            <span class="muted">${escapeHtml(row.substrate_name || "n/a")}</span>
          </td>
          <td>${kineticLines || '<span class="muted">No kinetic value shown</span>'}</td>
          <td><span class="badge ${badgeClassForStatus(row.verification_status)}">${escapeHtml(statusLabels[row.verification_status] || row.verification_status || "n/a")}</span></td>
          <td><span class="badge ${badgeClassForTier(row.evidence_confidence_tier)}">${escapeHtml(tierLabels[row.evidence_confidence_tier] || row.evidence_confidence_tier || "n/a")}</span></td>
          <td class="muted">${formatInteger(row.literature_id_count || 0)} ids<br>${escapeHtml(row.source_db || "unknown")}</td>
        </tr>
      `;
    }).join("");
    [...$("recordsBody").querySelectorAll("tr")].forEach((rowElement) => {
      rowElement.addEventListener("click", () => selectRecord(rowElement.dataset.key));
    });
  }

  async function selectRecord(key) {
    state.selectedKey = key;
    renderRows();
    const row = state.records.find((item) => item.record_key === key);
    if (!row) return;
    $("detailEmpty").classList.add("hidden");
    $("detailContent").classList.remove("hidden");
    $("detailContent").innerHTML = '<p class="muted">Loading row details...</p>';
    await loadScript(row.detail_shard);
    const shard = (window.CATLOG_DETAIL_SHARDS || {})[row.detail_shard] || {};
    renderDetail(row, shard[key] || {});
  }

  function kv(label, value) {
    return `<article class="kv"><span>${escapeHtml(label)}</span><strong>${escapeHtml(compactValue(value))}</strong></article>`;
  }

  function listItems(values, fallback) {
    const items = Array.isArray(values) ? values.filter(Boolean) : [];
    if (!items.length) return `<p class="muted">${escapeHtml(fallback)}</p>`;
    return `<ul class="proof-list">${items.slice(0, 12).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }

  function sequenceCard(label, sequence, note) {
    if (!sequence) {
      return `
        <article class="sequence-card">
          <div class="sequence-card-head">
            <strong>${escapeHtml(label)}</strong>
            <span>not preserved</span>
          </div>
          <p class="muted">${escapeHtml(note || "No sequence string was preserved for this row.")}</p>
        </article>
      `;
    }
    return `
      <article class="sequence-card">
        <div class="sequence-card-head">
          <strong>${escapeHtml(label)}</strong>
          <span>${sequenceLengthLabel(sequence)}</span>
        </div>
        ${note ? `<p class="muted">${escapeHtml(note)}</p>` : ""}
        <pre class="sequence-text">${escapeHtml(formatSequenceForDisplay(sequence))}</pre>
      </article>
    `;
  }

  function renderSequenceSection(summary, detail) {
    const preservedSequence = normalizeSequence(detail.sequence);
    const canonicalSequence = normalizeSequence(detail.canonical_sequence);
    const confirmation = detail.sequence_confirmation || {};
    const variantLabel = confirmation.variant_label || labelFromToken(detail.sequence_variant_status);
    const sourceLabel = confirmation.sequence_source_label || labelFromToken(detail.sequence_source);
    const confidenceLabel = confirmation.sequence_confidence_label || compactValue(detail.sequence_source_confidence);
    const connectionLabel = confirmation.connection_label || detail.sequence_variant_note || "No sequence interpretation note was preserved.";
    const mutationLabel = confirmation.mutation_label || detail.mutation_signature || (detail.wild_type === true ? "wild type" : "n/a");
    const alignmentLabel = confirmation.alignment_label || "independent BLAST/alignment not stored in this row";
    return `
      <section class="detail-section">
        <h3>Sequence check</h3>
        <div class="kv-grid">
          ${kv("primary UniProt", summary.primary_uniprot_id || detail.uniprot_id)}
          ${kv("variant state", variantLabel)}
          ${kv("sequence source", sourceLabel)}
          ${kv("source confidence", confidenceLabel)}
          ${kv("mutation", mutationLabel)}
          ${kv("sequence link", connectionLabel)}
          ${kv("preserved length", sequenceLengthLabel(preservedSequence))}
          ${kv("canonical length", sequenceLengthLabel(canonicalSequence))}
        </div>
        <p class="detail-note">${escapeHtml(alignmentLabel)}</p>
        <div class="sequence-stack">
          ${sequenceCard("Preserved sequence", preservedSequence, connectionLabel)}
          ${canonicalSequence && canonicalSequence !== preservedSequence ? sequenceCard("Canonical reference", canonicalSequence, "Reference sequence preserved separately for comparison.") : ""}
        </div>
      </section>
    `;
  }

  function traceBlock(title, values) {
    const items = Array.isArray(values) ? values.filter(Boolean) : [];
    if (!items.length) return "";
    return `
      <article class="trace-card">
        <h4>${escapeHtml(title)}</h4>
        <ul class="proof-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </article>
    `;
  }

  function renderTraceabilitySection(summary, detail) {
    const trace = detail.decision_trace || {};
    const traceBlocks = [
      traceBlock("Context", trace.context),
      traceBlock("Identity", trace.identity),
      traceBlock("Literature", trace.literature),
      traceBlock("Review", trace.review),
      traceBlock("Preserved snapshot", trace.preserved_snapshot),
      traceBlock("Notes", trace.notes_summary),
    ].filter(Boolean).join("");
    const fallbackTrace = `
      <div class="kv-grid">
        ${kv("measurement key", summary.measurement_key || detail.measurement_key)}
        ${kv("review key", summary.review_key || detail.review_key)}
        ${kv("source", summary.source_db || detail.source_db)}
        ${kv("source rows", detail.source_record_count)}
        ${kv("next action", detail.next_best_action)}
        ${kv("why", detail.next_best_action_reason)}
      </div>
    `;
    return `
      <section class="detail-section">
        <h3>Traceability</h3>
        <div class="trace-stack">
          <h4>Decision trace</h4>
          ${traceBlocks || fallbackTrace}
        </div>
        <details class="raw-json">
          <summary>Raw row JSON</summary>
          <pre>${escapeHtml(JSON.stringify(detail, null, 2))}</pre>
        </details>
      </section>
    `;
  }

  function renderDetail(summary, detail) {
    const pmids = detail.supporting_pmids || (detail.pubmed_id ? [detail.pubmed_id] : []);
    const dois = detail.supporting_dois || (detail.doi ? [detail.doi] : []);
    const proofLines = detail.proof_lines || detail.paper_mentions || [];
    $("detailContent").innerHTML = `
      <h2 class="detail-title">${escapeHtml(summary.enzyme_display_name || "Name not preserved")}</h2>
      <p class="detail-subtitle">${escapeHtml(summary.ec_number || "n/a")} / ${escapeHtml(summary.organism || "n/a")} / ${escapeHtml(summary.substrate_name || "n/a")}</p>

      <section class="detail-section">
        <h3>Core fields</h3>
        <div class="kv-grid">
          ${kv("measurement key", summary.measurement_key)}
          ${kv("review key", summary.review_key)}
          ${kv("source", summary.source_db)}
          ${kv("claim status", statusLabels[summary.verification_status] || summary.verification_status)}
          ${kv("paper evidence", tierLabels[summary.evidence_confidence_tier] || summary.evidence_confidence_tier)}
          ${kv("identity", identityLabels[summary.identity_resolution_state] || summary.identity_resolution_state)}
          ${kv("UniProt", summary.primary_uniprot_id)}
          ${kv("mutation", detail.mutation_signature)}
        </div>
      </section>

      <section class="detail-section">
        <h3>Kinetics</h3>
        <div class="kv-grid">
          ${kv("kcat", summary.kcat_display)}
          ${kv("Km", summary.km_display)}
          ${kv("Ki", summary.ki_display)}
          ${kv("kcat/Km", summary.kcat_over_km_display)}
        </div>
      </section>

      ${renderSequenceSection(summary, detail)}

      <section class="detail-section">
        <h3>Literature and evidence</h3>
        <div class="kv-grid">
          ${kv("PMIDs", pmids.join(", "))}
          ${kv("DOIs", dois.join(", "))}
          ${kv("literature linkage", detail.literature_linkage)}
          ${kv("next action", detail.next_best_action)}
        </div>
        ${listItems(proofLines, "No proof excerpt preserved in this row.")}
      </section>

      ${renderTraceabilitySection(summary, detail)}
    `;
  }

  function bindControls() {
    ["searchInput", "statusSelect", "tierSelect", "sourceSelect", "identitySelect", "sortSelect"].forEach((id) => {
      $(id).addEventListener("input", () => applyFilters());
      $(id).addEventListener("change", () => applyFilters());
    });
    $("clearButton").addEventListener("click", () => {
      $("searchInput").value = "";
      $("statusSelect").value = "";
      $("tierSelect").value = "";
      $("sourceSelect").value = "";
      $("identitySelect").value = "";
      $("sortSelect").value = "evidence";
      state.selectedKey = "";
      $("detailContent").classList.add("hidden");
      $("detailEmpty").classList.remove("hidden");
      applyFilters();
    });
    $("prevButton").addEventListener("click", () => {
      state.page -= 1;
      renderRows();
    });
    $("nextButton").addEventListener("click", () => {
      state.page += 1;
      renderRows();
    });
  }

  async function init() {
    try {
      renderSummary();
      bindControls();
      await loadRecordChunks();
      renderSummary();
      setupFilters();
      applyFilters();
    } catch (error) {
      $("activeSummary").innerHTML = `<span class="badge warn">${escapeHtml(error.message || error)}</span>`;
    }
  }

  init();
})();
