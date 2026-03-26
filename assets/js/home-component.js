(function () {
  function buildAffiliations(hero) {
    var affiliations = hero.affiliations || [];
    if (!affiliations.length) return '';

    var findLink = function (label) {
      var item = affiliations.find(function (entry) { return entry.label === label; });
      if (!item) return '';
      return '<a href="' + item.href + '" target="_blank" rel="noopener noreferrer"><b>' + item.label + '</b></a>';
    };

    var nanovaccine = findLink('Nanovaccine Institute');
    var cbe = findLink('Chemical & Biological Engineering');
    var iastate = findLink('Iowa State');
    var ames = findLink('Ames National Laboratory');
    var cmi = findLink('Critical Mineral Innovation Hub');

    if (nanovaccine && cbe && iastate && ames && cmi) {
      return nanovaccine +
        ' and affiliated to the ' + cbe +
        ' department at ' + iastate +
        ', and ' + ames + ' (' + cmi + ')';
    }

    var links = affiliations.map(function (item) {
      return '<a href="' + item.href + '" target="_blank" rel="noopener noreferrer"><b>' + item.label + '</b></a>';
    });

    if (links.length === 1) return links[0];
    if (links.length === 2) return links[0] + ' and affiliated to the ' + links[1];
    if (links.length === 3) return links[0] + ' and affiliated to the ' + links[1] + ' department at ' + links[2];

    return links.join(', ');
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
