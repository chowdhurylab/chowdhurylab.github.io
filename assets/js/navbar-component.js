(function () {
  var container = document.getElementById('nav-component');
  if (!container) return;

  container.innerHTML = `
    <nav id="menu">
      <header class="major"></header>
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
    </nav>
  `;
})();
