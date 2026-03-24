/*
  Navigation markup injection only.
*/
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

  var legacy = document.getElementById('nav-component');
  if (legacy) {
    legacy.innerHTML = `<nav id="menu"><header class="major"></header>${links}</nav>`;
  }

  if (!document.getElementById('top-navbar')) {
    var top = document.createElement('div');
    top.id = 'top-navbar';
    top.innerHTML = `<nav id="top-menu"><header class="major"></header>${links}</nav>`;
    document.body.appendChild(top);
  }

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
        <div class="latest-lab-filters" id="latest-lab-filters" role="group" aria-label="Filter latest updates">
          <button type="button" class="latest-lab-filter is-active" data-filter="all">All</button>
          <button type="button" class="latest-lab-filter" data-filter="achievements">Achievements</button>
          <button type="button" class="latest-lab-filter" data-filter="members">New Members</button>
          <button type="button" class="latest-lab-filter" data-filter="publications">Publications</button>
        </div>
        <div id="latest-lab-list" class="latest-lab-list">Loading updates…</div>
      </div>
    `;
    document.body.appendChild(panel);
  }
})();
