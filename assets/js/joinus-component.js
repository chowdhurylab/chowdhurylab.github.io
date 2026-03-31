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
        '>' + escapeHtml(item.label) + '</a>';
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

    var actions = (hero.actions || []).map(function (action) {
      var isExternal = (action.href || '').indexOf('mailto:') !== 0 && (action.href || '').indexOf('http') === 0;
      return '<a class="joinus-action joinus-action-' + escapeHtml(action.variant || 'secondary') + '" href="' + escapeHtml(action.href || '#') + '"' +
        (isExternal ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + escapeHtml(action.label || 'Learn more') + '</a>';
    }).join('');

    var highlights = (hero.highlights || []).map(function (item) {
      return '<li>' + escapeHtml(item) + '</li>';
    }).join('');

    mount.innerHTML = '' +
      '<div class="joinus-hero-panel">' +
      '  <p class="joinus-eyebrow">' + escapeHtml(hero.eyebrow || '') + '</p>' +
      '  <header class="main">' +
      '    <h1 class="joinus-page-title">' + escapeHtml(hero.title || 'Join Us') + '</h1>' +
      '    <p class="joinus-page-subtitle">' + escapeHtml(hero.subtitle || '') + '</p>' +
      '  </header>' +
      '  <h3 class="joinus-section-title">' + escapeHtml(hero.heading || '') + '</h3>' +
      '  <div class="joinus-intro">' + intro + '</div>' +
      '  <div class="joinus-actions">' + actions + '</div>' +
      '  <ul class="joinus-highlights">' + highlights + '</ul>' +
      '</div>';
  }

  function renderWhyJoin(data) {
    var mount = document.getElementById('joinus-why');
    if (!mount) return;

    var section = (data && data.whyJoin) || {};
    var items = section.items || [];
    if (!items.length) {
      mount.innerHTML = '';
      return;
    }

    mount.innerHTML = '' +
      '<div class="joinus-section-block">' +
      '  <h2 class="joinus-block-title">' + escapeHtml(section.title || 'Why join this lab?') + '</h2>' +
      '  <div class="joinus-value-grid">' +
      items.map(function (item) {
        return '' +
          '<article class="joinus-value-card">' +
          '  <h3>' + escapeHtml(item.title || '') + '</h3>' +
          '  <p>' + escapeHtml(item.text || '') + '</p>' +
          '</article>';
      }).join('') +
      '  </div>' +
      '</div>';
  }

  function renderResearchPreview(data) {
    var mount = document.getElementById('joinus-research-preview');
    if (!mount) return;

    var section = (data && data.researchPreview) || {};
    var items = section.items || [];
    if (!items.length) {
      mount.innerHTML = '';
      return;
    }

    mount.innerHTML = '' +
      '<div class="joinus-section-block joinus-section-block-accent">' +
      '  <h2 class="joinus-block-title">' + escapeHtml(section.title || 'What you could work on') + '</h2>' +
      '  <div class="joinus-pill-grid">' +
      items.map(function (item) {
        return '<span class="joinus-pill">' + escapeHtml(item) + '</span>';
      }).join('') +
      '  </div>' +
      '</div>';
  }

  function renderOpportunities(data) {
    var mount = document.getElementById('joinus-opportunities');
    if (!mount) return;

    var opportunities = (data && data.opportunities) || [];
    if (!opportunities.length) {
      mount.innerHTML = '<p class="joinus-empty">No openings listed yet.</p>';
      return;
    }

    mount.innerHTML = '' +
      '<div class="joinus-section-block">' +
      '  <h2 class="joinus-block-title">Open pathways</h2>' +
      '  <div class="joinus-grid">' + opportunities.map(function (item) {
        return '' +
          '<article class="joinus-card">' +
          '  <div class="joinus-card-top">' +
          '    <span class="joinus-card-tag">' + escapeHtml(item.tag || '') + '</span>' +
          '    <h3 class="joinus-card-title">' + escapeHtml(item.title || '') + '</h3>' +
          '  </div>' +
          '  <p class="joinus-card-summary">' + escapeHtml(item.summary || '') + '</p>' +
          '  <p>' + renderBodyWithLinks(item.body || '', item.links || {}) + '</p>' +
          '</article>';
      }).join('') + '</div>' +
      '</div>';
  }

  function renderApply(data) {
    var mount = document.getElementById('joinus-apply');
    if (!mount) return;

    var section = (data && data.apply) || {};
    var steps = section.steps || [];
    if (!steps.length) {
      mount.innerHTML = '';
      return;
    }

    mount.innerHTML = '' +
      '<div class="joinus-section-block joinus-apply-block">' +
      '  <div class="joinus-apply-copy">' +
      '    <h2 class="joinus-block-title">' + escapeHtml(section.title || 'How to apply') + '</h2>' +
      '    <ol class="joinus-apply-steps">' +
      steps.map(function (step) {
        return '<li>' + escapeHtml(step) + '</li>';
      }).join('') +
      '    </ol>' +
      '  </div>' +
      '  <div class="joinus-apply-card">' +
      '    <p class="joinus-apply-label">Primary contact</p>' +
      '    <a class="joinus-apply-email" href="mailto:' + escapeHtml(section.email || '') + '">' + escapeHtml(section.email || '') + '</a>' +
      '    <p class="joinus-apply-note">A short, thoughtful note plus your CV is a great place to start.</p>' +
      '  </div>' +
      '</div>';
  }

  async function loadJoinUs() {
    var heroMount = document.getElementById('joinus-hero');
    var whyMount = document.getElementById('joinus-why');
    var previewMount = document.getElementById('joinus-research-preview');
    var opportunitiesMount = document.getElementById('joinus-opportunities');
    var applyMount = document.getElementById('joinus-apply');
    if (!heroMount || !whyMount || !previewMount || !opportunitiesMount || !applyMount) return;

    try {
      var res = await fetch('assets/data/joinus.json');
      var data = await res.json();
      renderHero(data);
      renderWhyJoin(data);
      renderResearchPreview(data);
      renderOpportunities(data);
      renderApply(data);
    } catch (err) {
      console.error('Join Us load error:', err);
      heroMount.innerHTML = '<p class="joinus-empty">Could not load Join Us overview.</p>';
      whyMount.innerHTML = '';
      previewMount.innerHTML = '';
      opportunitiesMount.innerHTML = '<p class="joinus-empty">Could not load opportunities.</p>';
      applyMount.innerHTML = '';
    }
  }

  document.addEventListener('DOMContentLoaded', loadJoinUs);
})();
