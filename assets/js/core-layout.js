/*
  Shared layout bootstrapping extracted from main.js
*/
(function ($) {
  var $window = $(window),
    $body = $('body');

  breakpoints({
    xlarge: ['1281px', '1680px'],
    large: ['981px', '1280px'],
    medium: ['737px', '980px'],
    small: ['481px', '736px'],
    xsmall: ['361px', '480px'],
    xxsmall: [null, '360px']
  });

  $window.on('load', function () {
    window.setTimeout(function () {
      $body.removeClass('is-preload');
    }, 100);
  });

  var resizeTimeout;
  $window.on('resize', function () {
    $body.addClass('is-resizing');
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(function () {
      $body.removeClass('is-resizing');
    }, 100);
  });

  if (!browser.canUse('object-fit') || browser.name == 'safari') {
    $('.image.object').each(function () {
      var $this = $(this),
        $img = $this.children('img');
      $img.css('opacity', '0');
      $this
        .css('background-image', 'url("' + $img.attr('src') + '")')
        .css('background-size', $img.css('object-fit') ? $img.css('object-fit') : 'cover')
        .css('background-position', $img.css('object-position') ? $img.css('object-position') : 'center');
    });
  }
})(jQuery);
