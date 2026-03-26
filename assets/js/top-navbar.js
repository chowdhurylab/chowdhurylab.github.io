/*
  Top navbar behavior: always visible on desktop, collapses to hamburger on smaller screens.
*/
(function ($) {
  var $body = $('body'),
    $topNavbar = $('#top-navbar');

  if (!$topNavbar.length) return;

  var mobileToggle = document.getElementById('mobile-nav-toggle');
  var mobileQuery = window.matchMedia('(max-width: 900px)');

  function isMobileNav() {
    return mobileQuery.matches;
  }

  function syncToggleState() {
    if (!mobileToggle) return;
    var isOpen = $body.hasClass('top-navbar-open');
    mobileToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    mobileToggle.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
  }

  function openTopNav() {
    if (!isMobileNav()) return;
    $body.addClass('top-navbar-open');
    syncToggleState();
  }

  function closeTopNav() {
    $body.removeClass('top-navbar-open');
    syncToggleState();
  }

  function syncViewportMode() {
    if (!isMobileNav()) {
      $body.removeClass('top-navbar-open');
    }
    syncToggleState();
  }

  if (mobileToggle) {
    mobileToggle.addEventListener('click', function () {
      if (!isMobileNav()) return;
      if ($body.hasClass('top-navbar-open')) closeTopNav();
      else openTopNav();
    });
  }

  $(document).on('click.topnav-mobile', function (event) {
    if (!isMobileNav()) return;
    var target = event.target;
    if (target.closest('#mobile-nav-toggle') || target.closest('#top-navbar')) return;
    if ($body.hasClass('top-navbar-open')) closeTopNav();
  });

  if (typeof mobileQuery.addEventListener === 'function') {
    mobileQuery.addEventListener('change', syncViewportMode);
  } else if (typeof mobileQuery.addListener === 'function') {
    mobileQuery.addListener(syncViewportMode);
  }

  var $menu = $('#top-menu'),
    $menuOpeners = $menu.children('ul').find('.opener');

  $menuOpeners.each(function () {
    var $this = $(this);
    $this.on('click', function (event) {
      event.preventDefault();
      $menuOpeners.not($this).removeClass('active');
      $this.toggleClass('active');
    });
  });

  syncViewportMode();

  var currentPath = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
  $menu.find('a[href]').each(function () {
    var $a = $(this),
      href = ($a.attr('href') || '').toLowerCase();
    if (!href || href === '#' || href.indexOf('http') === 0) return;
    if (href === currentPath) $a.addClass('active').attr('aria-current', 'page');
  });
})(jQuery);
