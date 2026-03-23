(function () {
  function buildAffiliations(hero) {
    var links = (hero.affiliations || []).map(function (item) {
      return '<a href="' + item.href + '" target="_blank" rel="noopener noreferrer"><b>' + item.label + '</b></a>';
    });

    if (!links.length) return '';
    if (links.length === 1) return links[0];
    if (links.length === 2) return links[0] + ' and affiliated to the ' + links[1];

    return links[0] + ' and affiliated to the ' + links[1] + ' department at ' + links[2];
  }

  function renderHero(data) {
    var mount = document.getElementById('home-hero-content');
    var imageMount = document.getElementById('home-hero-image');
    if (!mount || !imageMount) return;

    var hero = (data && data.hero) || {};
    var cta = hero.cta || {};
    var image = hero.image || {};

    var affiliationBody = buildAffiliations(hero);
    var affiliationPrefix = hero.affiliationsText ? hero.affiliationsText + ' ' : '';
    var affiliationSuffix = hero.affiliationsSuffix || '';

    mount.innerHTML = '' +
      '<header>' +
      '  <h1 class="home-hero-title">' + (hero.title || '') + '</h1>' +
      '  <p class="home-hero-subtitle">' + (hero.subtitle || '') + '</p>' +
      '</header>' +
      '<p class="home-hero-description">' + (hero.description || '') + '</p>' +
      '<p class="home-hero-affiliations">' + affiliationPrefix + affiliationBody + affiliationSuffix + '</p>' +
      '<ul class="actions">' +
      '  <li><a href="' + (cta.href || '#') + '" class="button big">' + (cta.label || 'Learn more') + '</a></li>' +
      '</ul>';

    imageMount.innerHTML = '<img src="' + (image.src || '') + '" alt="' + (image.alt || '') + '" />';
  }

  function renderResearchAreas(data) {
    var mount = document.getElementById('home-research-areas');
    if (!mount) return;

    var areas = (data && data.researchAreas) || [];
    mount.innerHTML = areas.map(function (area) {
      var items = (area.items || []).map(function (item) {
        return '<li>' + item + '</li>';
      }).join('');

      return '' +
        '<article>' +
        '  <span class="icon solid ' + (area.icon || 'fa-star') + '"></span>' +
        '  <div class="content">' +
        '    <h3 class="home-research-title">' + (area.title || '') + '</h3>' +
        '    <ul class="home-research-list">' + items + '</ul>' +
        '  </div>' +
        '</article>';
    }).join('');
  }

  async function loadHomeData() {
    try {
      var res = await fetch('assets/data/home.json');
      var data = await res.json();
      renderHero(data);
      renderResearchAreas(data);
    } catch (err) {
      console.error('Home content load error:', err);
    }
  }

  document.addEventListener('DOMContentLoaded', loadHomeData);
})();
