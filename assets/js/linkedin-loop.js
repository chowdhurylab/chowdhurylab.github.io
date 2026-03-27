(function () {
  var shell = null;
  var track = null;
  var isPointerDown = false;
  var startX = 0;
  var startScrollLeft = 0;
  var singleBatchWidth = 0;
  var dragOffset = 0;

  function updateBatchWidth() {
    if (!track) return;
    singleBatchWidth = track.scrollWidth / 2;
  }

  function normalizeScroll() {
    if (!shell || !singleBatchWidth) return;

    if (shell.scrollLeft >= singleBatchWidth) {
      shell.scrollLeft -= singleBatchWidth;
      if (isPointerDown) startScrollLeft -= singleBatchWidth;
    } else if (shell.scrollLeft <= 0) {
      shell.scrollLeft += singleBatchWidth;
      if (isPointerDown) startScrollLeft += singleBatchWidth;
    }
  }

  function getClientX(event) {
    return event.pageX || (event.touches && event.touches[0] && event.touches[0].pageX) || 0;
  }

  function onPointerDown(event) {
    if (!shell) return;
    isPointerDown = true;
    dragOffset = 0;
    shell.classList.add('is-dragging', 'is-interacting');
    startX = getClientX(event);
    startScrollLeft = shell.scrollLeft;
  }

  function onPointerMove(event) {
    if (!shell || !isPointerDown) return;
    var currentX = getClientX(event);
    var walk = currentX - startX;
    dragOffset = walk;
    shell.scrollLeft = startScrollLeft - walk;
    normalizeScroll();
  }

  function stopDragging() {
    if (!shell) return;
    isPointerDown = false;
    dragOffset = 0;
    shell.classList.remove('is-dragging');
    window.setTimeout(function () {
      if (shell) shell.classList.remove('is-interacting');
    }, 1200);
  }

  function bindLoopRail() {
    shell = document.querySelector('.linkedin-loop-shell');
    track = document.getElementById('linkedinLoopTrack');
    if (!shell || !track) return;

    updateBatchWidth();
    shell.scrollLeft = 1;

    shell.addEventListener('scroll', function () {
      if (!isPointerDown) normalizeScroll();
    });
    window.addEventListener('resize', updateBatchWidth);

    shell.addEventListener('mousedown', onPointerDown);
    shell.addEventListener('touchstart', onPointerDown, { passive: true });
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('touchmove', onPointerMove, { passive: true });
    window.addEventListener('mouseup', stopDragging);
    window.addEventListener('touchend', stopDragging);
    window.addEventListener('touchcancel', stopDragging);

    shell.addEventListener('wheel', function (event) {
      shell.classList.add('is-interacting');
      shell.scrollLeft += event.deltaY;
      normalizeScroll();
      window.clearTimeout(shell._wheelTimer);
      shell._wheelTimer = window.setTimeout(function () {
        shell.classList.remove('is-interacting');
      }, 900);
    }, { passive: true });
  }

  document.addEventListener('DOMContentLoaded', bindLoopRail);
})();
