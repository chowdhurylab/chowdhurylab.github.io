/*
  Latest in Lab panel extracted from navbar-component.js
*/
(function () {
  var latestLoaded = false;
  var latestData = null;
  var activeFilter = 'all';

  function inferCategory(item) {
    if (item && item.category) return String(item.category).toLowerCase();

    var icon = (item && item.icon) || '';
    if (icon.indexOf('fa-user-plus') !== -1) return 'members';

    var text = ((item && item.text) || '').toLowerCase();
    var publicationHints = ['now out in', 'published', 'publication', 'journal', 'cell systems'];
    for (var i = 0; i < publicationHints.length; i++) {
      if (text.indexOf(publicationHints[i]) !== -1) return 'publications';
    }

    return 'achievements';
  }

  function getFilteredItems(items, filter) {
    if (filter === 'all') return items;
    return items.filter(function (item) {
      return inferCategory(item) === filter;
    });
  }

  function renderLatestList(data) {
    var container = document.getElementById('latest-lab-list');
    if (!container) return;
    var items = (data && data.latestInLab) || [];
    var filtered = getFilteredItems(items, activeFilter);

    if (!items.length) {
      container.innerHTML = '<p>No updates found.</p>';
      return;
    }

    if (!filtered.length) {
      container.innerHTML = '<p>No updates in this filter yet.</p>';
      return;
    }

    container.innerHTML = filtered
      .map(function (item) {
        var link = item.link && item.linkText ? ' <a href="' + item.link + '" target="_blank" rel="noopener noreferrer">' + item.linkText + '</a>' : '';
        var icon = item.icon ? ' <span class="latest-lab-icon icon fa solid ' + item.icon + '" aria-hidden="true"></span>' : '';
        var image = item.image
          ? '<div class="latest-lab-image-wrap"><img class="latest-lab-image" src="' + item.image + '" alt="Latest in Lab update image" loading="lazy"></div>'
          : '';
        return '<article class="latest-lab-row"><div class="latest-lab-date">' + (item.date || '') + '</div><div class="latest-lab-text">' + (item.text || '') + link + icon + '</div>' + image + '</article>';
      })
      .join('');
  }

  function setActiveFilter(filter) {
    activeFilter = filter || 'all';

    var buttons = document.querySelectorAll('.latest-lab-filter');
    buttons.forEach(function (btn) {
      var isActive = btn.getAttribute('data-filter') === activeFilter;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    if (latestData) renderLatestList(latestData);
  }

  async function loadLatest() {
    if (latestLoaded) return;
    try {
      var res = await fetch('assets/data/latest.json');
      latestData = await res.json();
      renderLatestList(latestData);
      latestLoaded = true;
    } catch (e) {
      var c = document.getElementById('latest-lab-list');
      if (c) c.innerHTML = '<p>Could not load updates.</p>';
      console.error('Latest in Lab load error:', e);
    }
  }

  function setPanelOpen(open) {
    var panel = document.getElementById('latest-lab-panel');
    var toggle = document.getElementById('latest-lab-toggle');
    if (!panel || !toggle) return;

    panel.classList.toggle('is-collapsed', !open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) loadLatest();
  }

  document.addEventListener('click', function (event) {
    if (event.target.closest('#latest-lab-toggle')) {
      var panel = document.getElementById('latest-lab-panel');
      var willOpen = panel && panel.classList.contains('is-collapsed');
      setPanelOpen(!!willOpen);
      return;
    }

    if (event.target.closest('#latest-lab-close')) {
      setPanelOpen(false);
      return;
    }

    var filterBtn = event.target.closest('.latest-lab-filter');
    if (filterBtn) setActiveFilter(filterBtn.getAttribute('data-filter') || 'all');
  });
})();
