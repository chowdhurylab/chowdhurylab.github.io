/*
  Top hover navbar behavior isolated from main.js
*/
(function ($) {
  var $body = $('body'),
    $topNavbar = $('#top-navbar');

  if (!$topNavbar.length) return;

  var edgeThreshold = 4,
    navCloseDelay = 180,
    navTimer = null;

  function openTopNav() {
    $body.addClass('top-navbar-open');
  }

  function closeTopNavSoon() {
    clearTimeout(navTimer);
    navTimer = setTimeout(function () {
      if (!$topNavbar.is(':hover')) $body.removeClass('top-navbar-open');
    }, navCloseDelay);
  }

  $(document).on('mousemove.topnav-edge', function (event) {
    if (breakpoints.active('<=medium')) return;
    if (event.clientY <= edgeThreshold && event.clientX > 72) openTopNav();
    else if ($body.hasClass('top-navbar-open') && !$topNavbar.is(':hover')) closeTopNavSoon();
  });

  $topNavbar.on('mouseenter', function () {
    clearTimeout(navTimer);
  });

  $topNavbar.on('mouseleave', function () {
    closeTopNavSoon();
  });

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

  var currentPath = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
  $menu.find('a[href]').each(function () {
    var $a = $(this),
      href = ($a.attr('href') || '').toLowerCase();
    if (!href || href === '#' || href.indexOf('http') === 0) return;
    if (href === currentPath) $a.addClass('active').attr('aria-current', 'page');
  });
})(jQuery);
