(function () {
  var links = `
    <ul>
      <li><a href="index.html">Home</a></li>
      <li><a href="members.html">Members</a></li>
      <li><a href="research.html">Research</a></li>
      <li><a href="publications.html">Publications</a></li>
      <li><a href="downloads.html">Software</a></li>
      <li><a href="moments.html">Moments</a></li>
      <li><a href="outreach.html">Outreach+</a></li>
      <!-- <li><a href="joinus.html">Join Us</a></li> -->
    </ul>
  `;

  // Keep legacy mount in sidebar DOM for compatibility (hidden by CSS in panel mode).
  var legacy = document.getElementById('nav-component');
  if (legacy) {
    legacy.innerHTML = `<nav id="menu"><header class="major"></header>${links}</nav>`;
  }

  // Independent top-navbar component.
  if (!document.getElementById('top-navbar')) {
    var top = document.createElement('div');
    top.id = 'top-navbar';
    top.innerHTML = `<nav id="top-menu"><header class="major"></header>${links}</nav>`;
    document.body.appendChild(top);
  }

  // Global right floating "Latest in Lab" mini-panel.
  if (!document.getElementById('latest-lab-panel')) {
    var panel = document.createElement('aside');
    panel.id = 'latest-lab-panel';
    panel.className = 'latest-lab-panel is-collapsed';
    panel.innerHTML = `
      <button type="button" id="latest-lab-toggle" class="latest-lab-toggle" aria-expanded="false" aria-controls="latest-lab-panel-body">Latest in Lab</button>
      <div id="latest-lab-panel-body" class="latest-lab-panel-body">
        <div class="latest-lab-panel-head">
          <h3>Latest in Lab</h3>
          <button type="button" class="latest-lab-close" id="latest-lab-close" aria-label="Close">✕</button>
        </div>
        <div id="latest-lab-list" class="latest-lab-list">Loading updates…</div>
      </div>
    `;
    document.body.appendChild(panel);
  }

  function renderLatestList(data) {
    var container = document.getElementById('latest-lab-list');
    if (!container) return;
    var items = (data && data.latestInLab) || [];
    if (!items.length) {
      container.innerHTML = '<p>No updates found.</p>';
      return;
    }

    container.innerHTML = items.map(function (item) {
      var link = (item.link && item.linkText)
        ? ` <a href="${item.link}" target="_blank" rel="noopener noreferrer">${item.linkText}</a>`
        : '';
      var icon = item.icon
        ? ` <span class="latest-lab-icon icon fa solid ${item.icon}" aria-hidden="true"></span>`
        : '';
      var image = item.image
        ? `<div class="latest-lab-image-wrap"><img class="latest-lab-image" src="${item.image}" alt="Latest in Lab update image" loading="lazy"></div>`
        : '';
      return `
        <article class="latest-lab-row">
          <div class="latest-lab-date">${item.date || ''}</div>
          <div class="latest-lab-text">${item.text || ''}${link}${icon}</div>
          ${image}
        </article>
      `;
    }).join('');
  }

  var latestLoaded = false;
  async function loadLatest() {
    if (latestLoaded) return;
    try {
      var res = await fetch('assets/data/sidebar.json');
      var data = await res.json();
      renderLatestList(data);
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
    }
  });
})();
