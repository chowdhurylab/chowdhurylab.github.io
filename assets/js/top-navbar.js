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
    closeDropdowns();
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

  var $menu = $('#top-menu');

  function closeDropdowns() {
    var dropdowns = document.querySelectorAll('.top-nav-dropdown');
    dropdowns.forEach(function (dropdown) {
      dropdown.classList.remove('is-open');
      var toggle = dropdown.querySelector('.top-nav-dropdown-toggle');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    });
  }

  $(document).on('click.topnav-dropdown', '.top-nav-dropdown-toggle', function (event) {
    event.preventDefault();
    event.stopPropagation();
    var dropdown = event.currentTarget.closest('.top-nav-dropdown');
    if (!dropdown) return;
    var isOpen = dropdown.classList.contains('is-open');
    closeDropdowns();
    if (!isOpen) {
      dropdown.classList.add('is-open');
      event.currentTarget.setAttribute('aria-expanded', 'true');
    }
  });

  $(document).on('click.topnav-dropdown-outside', function (event) {
    if (event.target.closest('.top-nav-dropdown')) return;
    closeDropdowns();
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
