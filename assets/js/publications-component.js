(function () {
  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  function renderPublication(pub) {
    return (
      '<article class="publication-item">' +
      '  <div class="publication-meta">' +
      '    <span class="publication-journal">' + escapeHtml(pub.journal) + '</span>' +
      '    <span class="publication-meta-sep">—</span>' +
      '    <span class="publication-authors">' + escapeHtml(pub.authors) + '</span>' +
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

  function renderPublications(publications, container) {
    if (!publications || !publications.length) {
      container.innerHTML = '<p class="publications-empty">No publications found.</p>';
      return;
    }

    var grouped = {};
    publications.forEach(function (pub) {
      var year = pub.year || 'Unknown';
      if (!grouped[year]) grouped[year] = [];
      grouped[year].push(pub);
    });

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

  async function loadPublications() {
    var container = document.getElementById('publications-container');
    if (!container) return;

    try {
      var res = await fetch('assets/data/publications.json');
      var data = await res.json();
      renderPublications(data.publications || [], container);
    } catch (err) {
      console.error('Publications load error:', err);
      container.innerHTML = '<p class="publications-empty">Could not load publications.</p>';
    }
  }

  document.addEventListener('DOMContentLoaded', loadPublications);
})();
