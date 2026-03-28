(function () {
  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderBodyWithLinks(text, links) {
    var html = escapeHtml(text || '');
    Object.keys(links || {}).forEach(function (key) {
      var item = links[key];
      var token = '{' + key + '}';
      var anchor = '<a href="' + escapeHtml(item.href) + '"' +
        (item.href.indexOf('mailto:') === 0 ? '' : ' target="_blank" rel="noopener noreferrer"') +
        '><b>' + escapeHtml(item.label) + '</b></a>';
      html = html.replace(token, anchor);
    });
    return html;
  }

  function renderHero(data) {
    var mount = document.getElementById('joinus-hero');
    if (!mount) return;

    var hero = (data && data.hero) || {};
    var intro = (hero.intro || []).map(function (paragraph) {
      return '<p class="joinus-intro-paragraph">' + escapeHtml(paragraph) + '</p>';
    }).join('');

    mount.innerHTML = '' +
      '<header class="main">' +
      '  <h1 class="joinus-page-title">' + escapeHtml(hero.title || 'Join Us') + '</h1>' +
      '  <p class="joinus-page-subtitle">' + escapeHtml(hero.subtitle || '') + '</p>' +
      '</header>' +
      '<h3 class="joinus-section-title">' + escapeHtml(hero.heading || '') + '</h3>' +
      '<div class="joinus-intro">' + intro + '</div>';
  }

  function renderOpportunities(data) {
    var mount = document.getElementById('joinus-opportunities');
    if (!mount) return;

    var opportunities = (data && data.opportunities) || [];
    if (!opportunities.length) {
      mount.innerHTML = '<p class="joinus-empty">No openings listed yet.</p>';
      return;
    }

    mount.innerHTML = '<div class="joinus-grid">' + opportunities.map(function (item) {
      return '' +
        '<blockquote class="joinus-card">' +
        '  <span class="joinus-card-title">' + escapeHtml(item.title || '') + '</span>' +
        '  <p>' + renderBodyWithLinks(item.body || '', item.links || {}) + '</p>' +
        '</blockquote>';
    }).join('') + '</div>';
  }

  async function loadJoinUs() {
    var heroMount = document.getElementById('joinus-hero');
    var opportunitiesMount = document.getElementById('joinus-opportunities');
    if (!heroMount || !opportunitiesMount) return;

    try {
      var res = await fetch('assets/data/joinus.json');
      var data = await res.json();
      renderHero(data);
      renderOpportunities(data);
    } catch (err) {
      console.error('Join Us load error:', err);
      heroMount.innerHTML = '<p class="joinus-empty">Could not load Join Us intro.</p>';
      opportunitiesMount.innerHTML = '<p class="joinus-empty">Could not load opportunities.</p>';
    }
  }

  document.addEventListener('DOMContentLoaded', loadJoinUs);
})();
