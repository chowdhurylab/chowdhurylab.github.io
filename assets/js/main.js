/*
	Editorial by HTML5 UP
	html5up.net | @ajlkn
	Free for personal and commercial use under the CCA 3.0 license (html5up.net/license)
*/

(function($) {

	var	$window = $(window),
		$head = $('head'),
		$body = $('body');

	// Breakpoints.
		breakpoints({
			xlarge:   [ '1281px',  '1680px' ],
			large:    [ '981px',   '1280px' ],
			medium:   [ '737px',   '980px'  ],
			small:    [ '481px',   '736px'  ],
			xsmall:   [ '361px',   '480px'  ],
			xxsmall:  [ null,      '360px'  ]
		});

	// Stops animations/transitions until the page has ...
		$window.on('load', function() {
			window.setTimeout(function() { $body.removeClass('is-preload'); }, 100);
		});

		var resizeTimeout;
		$window.on('resize', function() {
			$body.addClass('is-resizing');
			clearTimeout(resizeTimeout);
			resizeTimeout = setTimeout(function() { $body.removeClass('is-resizing'); }, 100);
		});

	// Fixes.
		if (!browser.canUse('object-fit') || browser.name == 'safari')
			$('.image.object').each(function() {
				var $this = $(this), $img = $this.children('img');
				$img.css('opacity', '0');
				$this
					.css('background-image', 'url("' + $img.attr('src') + '")')
					.css('background-size', $img.css('object-fit') ? $img.css('object-fit') : 'cover')
					.css('background-position', $img.css('object-position') ? $img.css('object-position') : 'center');
			});

	// Sidebar (match Backup behavior, independent from top navbar).
		var $sidebar = $('#sidebar'),
			$sidebar_inner = $sidebar.children('.inner');

		breakpoints.on('<=large', function() {
			$sidebar.addClass('inactive');
		});

		breakpoints.on('>large', function() {
			$sidebar.removeClass('inactive');
		});

		if (browser.os == 'android' && browser.name == 'chrome')
			$('<style>#sidebar .inner::-webkit-scrollbar { display: none; }</style>').appendTo($head);

		var _lastToggleAt = 0;
		$('<a href="#sidebar" class="toggle">Toggle</a>')
			.appendTo($sidebar)
			.on('pointerdown click', function(event) {
				var now = Date.now();
				if (now - _lastToggleAt < 220) return;
				_lastToggleAt = now;
				event.preventDefault();
				event.stopPropagation();
				$sidebar.toggleClass('inactive');
			});

		$sidebar.on('click', 'a', function(event) {
			if (breakpoints.active('>large')) return;

			var $a = $(this),
				href = $a.attr('href'),
				target = $a.attr('target');

			event.preventDefault();
			event.stopPropagation();

			if (!href || href == '#' || href == '') return;

			$sidebar.addClass('inactive');

			setTimeout(function() {
				if (target == '_blank') window.open(href);
				else window.location.href = href;
			}, 500);
		});

		$sidebar.on('click touchend touchstart touchmove', function(event) {
			if (breakpoints.active('>large')) return;
			event.stopPropagation();
		});

		$body.on('click touchend', function() {
			if (breakpoints.active('>large')) return;
			$sidebar.addClass('inactive');
		});

		$window.on('load.sidebar-lock', function() {
			var sh, wh;

			if ($window.scrollTop() == 1)
				$window.scrollTop(0);

			$window
				.on('scroll.sidebar-lock', function() {
					var x, y;

					if (breakpoints.active('<=large')) {
						$sidebar_inner
							.data('locked', 0)
							.css('position', '')
							.css('top', '');
						return;
					}

					x = Math.max(sh - wh, 0);
					y = Math.max(0, $window.scrollTop() - x);

					if ($sidebar_inner.data('locked') == 1) {
						if (y <= 0)
							$sidebar_inner.data('locked', 0).css('position', '').css('top', '');
						else
							$sidebar_inner.css('top', -1 * x);
					}
					else {
						if (y > 0)
							$sidebar_inner.data('locked', 1).css('position', 'fixed').css('top', -1 * x);
					}
				})
				.on('resize.sidebar-lock', function() {
					wh = $window.height();
					sh = $sidebar_inner.outerHeight() + 30;
					$window.trigger('scroll.sidebar-lock');
				})
				.trigger('resize.sidebar-lock');
		});

		// Keep top navbar independent from sidebar state.
		var $topNavbar = $('#top-navbar');

		// Top navbar (opens on edge hover only, independent from sidebar).
		if ($topNavbar.length) {
			var edgeThreshold = 8,
				navCloseDelay = 250,
				navTimer = null;

			function openTopNav() {
				if ($body.hasClass('sidebar-panel-open')) return;
				$body.addClass('top-navbar-open');
			}

			function closeTopNavSoon() {
				clearTimeout(navTimer);
				navTimer = setTimeout(function() {
					if (!$topNavbar.is(':hover') && !$body.hasClass('sidebar-panel-open'))
						$body.removeClass('top-navbar-open');
				}, navCloseDelay);
			}

			$(document).on('mousemove.topnav-edge', function(event) {
				if (breakpoints.active('<=medium')) return;
				if (event.clientY <= edgeThreshold) openTopNav();
				else if ($body.hasClass('top-navbar-open') && !$topNavbar.is(':hover')) closeTopNavSoon();
			});

			$topNavbar.on('mouseenter', function() { clearTimeout(navTimer); });
			$topNavbar.on('mouseleave', function() { closeTopNavSoon(); });
		}

	// Top menu interactions.
		var $menu = $('#top-menu'),
			$menu_openers = $menu.children('ul').find('.opener');

		$menu_openers.each(function() {
			var $this = $(this);
			$this.on('click', function(event) {
				event.preventDefault();
				$menu_openers.not($this).removeClass('active');
				$this.toggleClass('active');
			});
		});

		var currentPath = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
		$menu.find('a[href]').each(function() {
			var $a = $(this), href = ($a.attr('href') || '').toLowerCase();
			if (!href || href === '#' || href.indexOf('http') === 0) return;
			if (href === currentPath) $a.addClass('active').attr('aria-current', 'page');
		});

})(jQuery);
