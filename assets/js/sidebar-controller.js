/*
  Sidebar behavior isolated from main.js
*/
(function ($) {
  var $window = $(window),
    $head = $('head'),
    $body = $('body'),
    $sidebar = $('#sidebar'),
    $sidebarInner = $sidebar.children('.inner');

  if (!$sidebar.length) return;

  breakpoints.on('<=large', function () {
    $sidebar.addClass('inactive');
  });

  breakpoints.on('>large', function () {
    $sidebar.removeClass('inactive');
  });

  if (browser.os == 'android' && browser.name == 'chrome') {
    $('<style>#sidebar .inner::-webkit-scrollbar { display: none; }</style>').appendTo($head);
  }

  var lastToggleAt = 0;
  if (!$sidebar.children('.toggle').length) {
    $('<a href="#sidebar" class="toggle">Toggle</a>')
      .appendTo($sidebar)
      .on('pointerdown click', function (event) {
        var now = Date.now();
        if (now - lastToggleAt < 220) return;
        lastToggleAt = now;
        event.preventDefault();
        event.stopPropagation();
        $sidebar.toggleClass('inactive');
      });
  }

  $sidebar.on('click', 'a', function (event) {
    if (breakpoints.active('>large')) return;

    var $a = $(this),
      href = $a.attr('href'),
      target = $a.attr('target');

    event.preventDefault();
    event.stopPropagation();

    if (!href || href == '#' || href == '') return;

    $sidebar.addClass('inactive');

    setTimeout(function () {
      if (target == '_blank') window.open(href);
      else window.location.href = href;
    }, 500);
  });

  $sidebar.on('click touchend touchstart touchmove', function (event) {
    if (breakpoints.active('>large')) return;
    event.stopPropagation();
  });

  $body.on('click touchend', function () {
    if (breakpoints.active('>large')) return;
    $sidebar.addClass('inactive');
  });

  $window.on('load.sidebar-lock', function () {
    var sh, wh;

    if ($window.scrollTop() == 1) $window.scrollTop(0);

    $window
      .on('scroll.sidebar-lock', function () {
        var x, y;

        if (breakpoints.active('<=large')) {
          $sidebarInner.data('locked', 0).css('position', '').css('top', '');
          return;
        }

        x = Math.max(sh - wh, 0);
        y = Math.max(0, $window.scrollTop() - x);

        if ($sidebarInner.data('locked') == 1) {
          if (y <= 0) $sidebarInner.data('locked', 0).css('position', '').css('top', '');
          else $sidebarInner.css('top', -1 * x);
        } else {
          if (y > 0) $sidebarInner.data('locked', 1).css('position', 'fixed').css('top', -1 * x);
        }
      })
      .on('resize.sidebar-lock', function () {
        wh = $window.height();
        sh = $sidebarInner.outerHeight() + 30;
        $window.trigger('scroll.sidebar-lock');
      })
      .trigger('resize.sidebar-lock');
  });
})(jQuery);
