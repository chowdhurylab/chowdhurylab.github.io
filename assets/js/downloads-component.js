(function () {
  var allDownloads = [];
  var countsMap = {};

  var COUNTER_ENDPOINT = window.DOWNLOADS_COUNTER_ENDPOINT || '';

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

  function makeCounterKey(cardId, btn, index) {
    var base = String(cardId || 'card') + '::' + String(btn.label || ('button-' + index));
    return base.toLowerCase().replace(/[^a-z0-9:_-]+/g, '-');
  }

  function getCountValue(key, fallback) {
    if (Object.prototype.hasOwnProperty.call(countsMap, key)) {
      return countsMap[key];
    }
    return fallback;
  }

  function renderButton(btn, cardId, index) {
    var metricLabel = btn.downloads !== undefined ? 'Downloads' : 'Views';
    var metricValueRaw = btn.downloads !== undefined ? btn.downloads : btn.views;
    var metricValue = Number(metricValueRaw) || 0;
    var type = inferBtnType(btn);
    var href = btn.url || '#';
    var disabled = !btn.url;
    var counterKey = makeCounterKey(cardId, btn, index);
    var liveValue = getCountValue(counterKey, metricValue);
    var attrs = [];

    if (!disabled) {
      attrs.push('href="' + escapeHtml(href) + '"');
      if (isExternal(href)) attrs.push('target="_blank" rel="noopener noreferrer"');
      if (isDownloadLink(href)) attrs.push('download');
    }

    return (
      '<div class="db-button-container">' +
      '  <a class="db-button' + (disabled ? ' is-disabled' : '') + '" data-type="' + type + '" data-counter-key="' + escapeHtml(counterKey) + '" ' + attrs.join(' ') + '>' + escapeHtml(btn.label || 'Open') + '</a>' +
      '  <div class="db-button-meta">' +
      '    <span>' + metricLabel + ':</span> <b class="db-metric-value" data-counter-key="' + escapeHtml(counterKey) + '">' + escapeHtml(String(liveValue)) + '</b>' +
      '    <span class="db-meta-sep">·</span>' +
      '    <span>as of ' + escapeHtml(btn.date || '') + '</span>' +
      '  </div>' +
      '</div>'
    );
  }

  function renderCard(db) {
    var description = (db.description || [])
      .map(function (p) {
        return '<p>' + escapeHtml(p) + '</p>';
      })
      .join('');

    var bullets = db.bulletPoints && db.bulletPoints.length
      ? '<ul class="db-bullets">' + db.bulletPoints.map(function (b) { return '<li>' + escapeHtml(b) + '</li>'; }).join('') + '</ul>'
      : '';

    var buttons = (db.buttons || [])
      .map(function (btn, index) {
        return renderButton(btn, db.id || 'card', index);
      })
      .join('');

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
    return buttons.some(function (btn) {
      return inferBtnType(btn) === type;
    });
  }

  function cardMatchesSearch(card, query) {
    if (!query) return true;
    var haystack = [
      card.title,
      (card.description || []).join(' '),
      (card.bulletPoints || []).join(' '),
      (card.buttons || [])
        .map(function (b) {
          return [b.label, b.url].join(' ');
        })
        .join(' ')
    ]
      .join(' ')
      .toLowerCase();

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

  function updateCounterInDom(key, value) {
    var nodes = document.querySelectorAll('.db-metric-value[data-counter-key="' + key.replace(/"/g, '\\"') + '"]');
    nodes.forEach(function (node) {
      node.textContent = String(value);
    });
  }

  function incrementCount(key) {
    if (!COUNTER_ENDPOINT || !key) return;

    fetch(COUNTER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'increment', key: key }),
      keepalive: true
    }).catch(function () {
      // Silent fail by design.
    });
  }

  function bindCountTracking() {
    var container = document.getElementById('downloads-container');
    if (!container) return;

    container.addEventListener('click', function (event) {
      var link = event.target.closest('.db-button[data-counter-key]');
      if (!link || link.classList.contains('is-disabled')) return;

      var key = link.getAttribute('data-counter-key');
      if (!key) return;

      var current = Number(getCountValue(key, 0)) || 0;
      var next = current + 1;
      countsMap[key] = next;
      updateCounterInDom(key, next);
      incrementCount(key);
    });
  }

  function normalizeCountsResponse(payload) {
    if (!payload) return {};
    if (payload.counts && typeof payload.counts === 'object') return payload.counts;
    if (typeof payload === 'object') return payload;
    return {};
  }

  async function loadRemoteCounts() {
    if (!COUNTER_ENDPOINT) return;

    try {
      var res = await fetch(COUNTER_ENDPOINT + '?action=get', { method: 'GET' });
      if (!res.ok) return;
      var payload = await res.json();
      countsMap = normalizeCountsResponse(payload) || {};
    } catch (_err) {
      // Silent fail; static fallback remains.
    }
  }

  async function loadDownloads() {
    var container = document.getElementById('downloads-container');
    if (!container) return;

    try {
      var response = await fetch('assets/data/downloads.json');
      var data = await response.json();
      allDownloads = data.downloads || [];

      bindFilters();
      bindCountTracking();
      await loadRemoteCounts();
      applyFilters();
    } catch (err) {
      console.error('Downloads load error:', err);
      container.innerHTML = '<p class="downloads-empty">Could not load downloads.</p>';
    }
  }

  document.addEventListener('DOMContentLoaded', loadDownloads);
})();
