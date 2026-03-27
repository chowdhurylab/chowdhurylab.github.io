(function () {
  function ensureButton() {
    if (document.getElementById('backToTopButton')) return;

    var button = document.createElement('button');
    button.type = 'button';
    button.id = 'backToTopButton';
    button.className = 'back-to-top-button';
    button.setAttribute('aria-label', 'Back to top');
    button.innerHTML = '<span class="icon solid fa-chevron-up" aria-hidden="true"></span>';

    button.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    document.body.appendChild(button);
  }

  function syncVisibility() {
    var button = document.getElementById('backToTopButton');
    if (!button) return;

    if (window.innerWidth <= 900) {
      button.classList.remove('is-visible');
      return;
    }

    if (window.scrollY > 320) {
      button.classList.add('is-visible');
    } else {
      button.classList.remove('is-visible');
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    ensureButton();
    syncVisibility();
    window.addEventListener('scroll', syncVisibility, { passive: true });
    window.addEventListener('resize', syncVisibility);
  });
})();
