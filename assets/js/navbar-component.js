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
})();
