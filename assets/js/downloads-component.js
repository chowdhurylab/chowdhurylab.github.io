(function () {
  var allDownloads = [];

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isExternal(url) {
    return /^https?:\/\//i.test(url || '');
  }

  function inferBtnType(btn) {
    var label = (btn.label || '').toLowerCase();
    var url = (btn.url || '').toLowerCase();

    if (label.includes('github') || url.includes('github.com')) return 'code';
    if (label.includes('website') || (isExternal(btn.url) && !url.includes('github.com'))) return 'site';
    return 'dataset';
  }

  function isDownloadLink(url) {
    if (!url || isExternal(url)) return false;
    return /\.(zip|csv|xlsx?|json|tsv|txt|pdf|tar|gz)$/i.test(url);
  }

  function renderButton(btn) {
    var metricLabel = btn.downloads !== undefined ? 'Downloads' : 'Views';
    var metricValue = btn.downloads !== undefined ? btn.downloads : btn.views;
    var type = inferBtnType(btn);
    var href = btn.url || '#';
    var disabled = !btn.url;
    var attrs = [];

    if (!disabled) {
      attrs.push('href="' + escapeHtml(href) + '"');
      if (isExternal(href)) attrs.push('target="_blank" rel="noopener noreferrer"');
      if (isDownloadLink(href)) attrs.push('download');
    }

    return (
      '<div class="db-button-container">' +
      '  <a class="db-button' + (disabled ? ' is-disabled' : '') + '" data-type="' + type + '" ' + attrs.join(' ') + '>' + escapeHtml(btn.label || 'Open') + '</a>' +
      '  <div class="db-button-meta">' +
      '    <span>' + metricLabel + ':</span> <b>' + escapeHtml(metricValue) + '</b>' +
      '    <span class="db-meta-sep">·</span>' +
      '    <span>as of ' + escapeHtml(btn.date || '') + '</span>' +
      '  </div>' +
      '</div>'
    );
  }

  function renderCard(db) {
    var description = (db.description || []).map(function (p) {
      return '<p>' + escapeHtml(p) + '</p>';
    }).join('');

    var bullets = (db.bulletPoints && db.bulletPoints.length)
      ? '<ul class="db-bullets">' + db.bulletPoints.map(function (b) { return '<li>' + escapeHtml(b) + '</li>'; }).join('') + '</ul>'
      : '';

    var buttons = (db.buttons || []).map(renderButton).join('');

    return (
      '<div id="' + escapeHtml(db.id || '') + '" class="db-post">' +
      '  <h3 class="db-title">' + escapeHtml(db.title) + '</h3>' +
      '  <div class="db-description">' + description + bullets + '</div>' +
      '  <div class="db-image-wrap">' +
      '    <img class="db-image" src="' + escapeHtml(db.image || '') + '" alt="' + escapeHtml(db.title || 'Download resource image') + '">' +
      '  </div>' +
      '  <div class="db-buttons">' + buttons + '</div>' +
      '</div>'
    );
  }

  function cardMatchesType(card, type) {
    if (type === 'all') return true;
    var buttons = card.buttons || [];
    return buttons.some(function (btn) { return inferBtnType(btn) === type; });
  }

  function cardMatchesSearch(card, query) {
    if (!query) return true;
    var haystack = [
      card.title,
      (card.description || []).join(' '),
      (card.bulletPoints || []).join(' '),
      (card.buttons || []).map(function (b) { return [b.label, b.url].join(' '); }).join(' ')
    ].join(' ').toLowerCase();

    return haystack.indexOf(query) !== -1;
  }

  function applyFilters() {
    var container = document.getElementById('downloads-container');
    var qInput = document.getElementById('downloads-search');
    var tSelect = document.getElementById('downloads-type');
    if (!container) return;

    var query = ((qInput && qInput.value) || '').trim().toLowerCase();
    var type = (tSelect && tSelect.value) || 'all';

    var filtered = allDownloads.filter(function (card) {
      return cardMatchesType(card, type) && cardMatchesSearch(card, query);
    });

    if (!filtered.length) {
      container.innerHTML = '<p class="downloads-empty">No downloads match the current filters.</p>';
      return;
    }

    container.innerHTML = filtered.map(renderCard).join('');
  }

  function bindFilters() {
    var qInput = document.getElementById('downloads-search');
    var tSelect = document.getElementById('downloads-type');

    if (qInput) qInput.addEventListener('input', applyFilters);
    if (tSelect) tSelect.addEventListener('change', applyFilters);
  }

  async function loadDownloads() {
    var container = document.getElementById('downloads-container');
    if (!container) return;

    try {
      var response = await fetch('assets/data/downloads.json');
      var data = await response.json();
      allDownloads = data.downloads || [];

      bindFilters();
      applyFilters();
    } catch (err) {
      console.error('Downloads load error:', err);
      container.innerHTML = '<p class="downloads-empty">Could not load downloads.</p>';
    }
  }

  document.addEventListener('DOMContentLoaded', loadDownloads);
})();
