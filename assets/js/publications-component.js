(function () {
  var allPublications = [];
  var activeType = 'all';
  var authorRegistry = [];

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function slugify(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/,?\s*ph\.?d\.?/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function normalizeCitationName(text) {
    return String(text || '')
      .replace(/\s+et al\.?$/i, '')
      .trim();
  }

  function lookupAuthorId(display) {
    var citation = normalizeCitationName(display);
    var match = authorRegistry.find(function (author) {
      return (author.publicationNames || []).some(function (name) {
        return normalizeCitationName(name) === citation;
      });
    });

    return match ? match.id : '';
  }

  function renderExtraLinks(pub) {
    if (!pub.extraLinks || !pub.extraLinks.length) return '';

    var links = pub.extraLinks
      .map(function (link) {
        return '<a href="' + escapeHtml(link.url) + '" target="_blank" rel="noopener noreferrer" class="publication-extra-link">' + escapeHtml(link.label) + '</a>';
      })
      .join('<span class="publication-sep">|</span>');

    return (
      '<div class="publication-extra-links">' +
      '  <span class="icon solid fa-quote-left publication-extra-icon" aria-hidden="true"></span>' +
      '  ' + links +
      '</div>'
    );
  }

  function renderAuthors(authorsText) {
    var text = String(authorsText || '').trim();
    if (!text) return '';

    var cleaned = normalizeCitationName(text);
    var parts = cleaned.split(',').map(function (part) {
      return part.trim();
    }).filter(Boolean);

    if (!parts.length) return escapeHtml(text);

    if (parts.length >= 2) {
      var surname = parts[0];
      var initials = parts.slice(1).join(', ');
      var display = surname + ', ' + initials;
      var authorId = lookupAuthorId(display);
      var html = authorId
        ? '<a class="publication-author-link" href="author.html?author=' + encodeURIComponent(authorId) + '&from=publications">' + escapeHtml(display) + '</a>'
        : escapeHtml(display);
      if (/et al\.?$/i.test(text)) html += ', et al.';
      return html;
    }

    var singleId = lookupAuthorId(parts[0]);
    return (singleId
      ? '<a class="publication-author-link" href="author.html?author=' + encodeURIComponent(singleId) + '&from=publications">' + escapeHtml(parts[0]) + '</a>'
      : escapeHtml(parts[0])) + (/et al\.?$/i.test(text) ? ', et al.' : '');
  }

  function renderPublication(pub) {
    return (
      '<article class="publication-item">' +
      '  <div class="publication-meta">' +
      '    <span class="publication-journal">' + escapeHtml(pub.journal) + '</span>' +
      '    <span class="publication-meta-sep">—</span>' +
      '    <span class="publication-authors">' + renderAuthors(pub.authors) + '</span>' +
      '  </div>' +
      '  <h3 class="publication-title">' + escapeHtml(pub.title) + '</h3>' +
      '  <div class="publication-links-row">' +
      '    <a href="' + escapeHtml(pub.link) + '" target="_blank" rel="noopener noreferrer" class="publication-main-link">' +
      '      <span class="icon solid fa-chevron-circle-right" aria-hidden="true"></span>' +
      '      <span>' + escapeHtml(pub.articleType || 'Article') + '</span>' +
      '    </a>' +
      renderExtraLinks(pub) +
      '  </div>' +
      '</article>'
    );
  }

  function groupByYear(publications) {
    var grouped = {};
    publications.forEach(function (pub) {
      var year = pub.year || 'Unknown';
      if (!grouped[year]) grouped[year] = [];
      grouped[year].push(pub);
    });
    return grouped;
  }

  function renderPublications(publications, container) {
    if (!publications || !publications.length) {
      container.innerHTML = '<p class="publications-empty">No publications match the current filters.</p>';
      return;
    }

    var grouped = groupByYear(publications);
    var years = Object.keys(grouped).sort(function (a, b) {
      return Number(b) - Number(a);
    });

    container.innerHTML = years
      .map(function (year) {
        var items = grouped[year].map(renderPublication).join('');
        return (
          '<section class="publication-year-group">' +
          '  <h2 class="publication-year-heading">' + escapeHtml(year) + '</h2>' +
          '  <div class="publication-year-list">' + items + '</div>' +
          '</section>'
        );
      })
      .join('');
  }

  function populateYearFilter(publications) {
    var select = document.getElementById('pub-filter-year');
    if (!select) return;

    var years = Array.from(
      new Set(
        publications
          .map(function (p) { return p.year; })
          .filter(function (y) { return y !== undefined && y !== null && y !== ''; })
      )
    ).sort(function (a, b) {
      return Number(b) - Number(a);
    });

    select.innerHTML = '<option value="all">All years</option>' +
      years.map(function (y) {
        return '<option value="' + escapeHtml(String(y)) + '">' + escapeHtml(String(y)) + '</option>';
      }).join('');
  }

  function applyFilters() {
    var container = document.getElementById('publications-container');
    var yearSelect = document.getElementById('pub-filter-year');
    var searchInput = document.getElementById('pub-filter-search');
    var mediaOnly = document.getElementById('pub-filter-media');

    if (!container) return;

    var yearValue = yearSelect ? yearSelect.value : 'all';
    var query = (searchInput && searchInput.value ? searchInput.value : '').trim().toLowerCase();
    var mediaOnlyChecked = !!(mediaOnly && mediaOnly.checked);

    var filtered = allPublications.filter(function (pub) {
      if (yearValue !== 'all' && String(pub.year) !== yearValue) return false;
      if (activeType !== 'all' && (pub.articleType || '') !== activeType) return false;
      if (mediaOnlyChecked && !(pub.extraLinks && pub.extraLinks.length)) return false;

      if (query) {
        var haystack = [pub.title, pub.authors, pub.journal, pub.articleType]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (haystack.indexOf(query) === -1) return false;
      }

      return true;
    });

    renderPublications(filtered, container);
  }

  function bindFilters() {
    var yearSelect = document.getElementById('pub-filter-year');
    var searchInput = document.getElementById('pub-filter-search');
    var mediaOnly = document.getElementById('pub-filter-media');
    var typeWrap = document.getElementById('pub-filter-type');

    if (yearSelect) yearSelect.addEventListener('change', applyFilters);
    if (searchInput) searchInput.addEventListener('input', applyFilters);
    if (mediaOnly) mediaOnly.addEventListener('change', applyFilters);

    if (typeWrap) {
      typeWrap.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-type]');
        if (!btn) return;

        activeType = btn.getAttribute('data-type') || 'all';
        var chips = typeWrap.querySelectorAll('[data-type]');
        chips.forEach(function (chip) {
          chip.classList.toggle('is-active', chip === btn);
        });

        applyFilters();
      });
    }
  }

  async function loadPublications() {
    var container = document.getElementById('publications-container');
    if (!container) return;

    try {
      var results = await Promise.all([
        fetch('assets/data/publications.json').then(function (res) { return res.json(); }),
        fetch('assets/data/authors.json').then(function (res) { return res.json(); }).catch(function () { return { authors: [] }; })
      ]);

      allPublications = results[0].publications || [];
      authorRegistry = results[1].authors || [];

      populateYearFilter(allPublications);
      bindFilters();
      applyFilters();
    } catch (err) {
      console.error('Publications load error:', err);
      container.innerHTML = '<p class="publications-empty">Could not load publications.</p>';
    }
  }

  document.addEventListener('DOMContentLoaded', loadPublications);
})();
