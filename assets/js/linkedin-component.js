(function () {
  var shell = null;
  var track = null;
  var isPointerDown = false;
  var startX = 0;
  var startScrollLeft = 0;
  var singleBatchWidth = 0;

  function renderCard(item, hidden) {
    var hiddenAttr = hidden ? ' aria-hidden="true"' : '';
    return '' +
      '<article class="linkedin-loop-card"' + hiddenAttr + '>' +
      '  <a class="linkedin-loop-media-link" href="' + (item.href || '#') + '" target="_blank" rel="noopener noreferrer" aria-label="Open ' + (item.title || 'LinkedIn update') + '">' +
      '    <div class="linkedin-loop-media">' +
      '      <img src="' + (item.image || '') + '" alt="' + (item.imageAlt || item.title || 'LinkedIn update image') + '" />' +
      '    </div>' +
      '  </a>' +
      '  <div class="linkedin-loop-content">' +
      '    <h3>' + (item.title || '') + '</h3>' +
      '    <p>' + (item.description || '') + '</p>' +
      '    <a href="' + (item.href || '#') + '" target="_blank" rel="noopener noreferrer">View post</a>' +
      '  </div>' +
      '</article>';
  }

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
    shell.classList.add('is-dragging', 'is-interacting');
    startX = getClientX(event);
    startScrollLeft = shell.scrollLeft;
  }

  function onPointerMove(event) {
    if (!shell || !isPointerDown) return;
    var currentX = getClientX(event);
    var walk = currentX - startX;
    shell.scrollLeft = startScrollLeft - walk;
    normalizeScroll();
  }

  function stopDragging() {
    if (!shell) return;
    isPointerDown = false;
    shell.classList.remove('is-dragging');
    window.setTimeout(function () {
      if (shell) shell.classList.remove('is-interacting');
    }, 1200);
  }

  function renderCarousel(items) {
    var mount = document.getElementById('linkedin-carousel-mount');
    if (!mount) return;

    if (!items || !items.length) {
      mount.innerHTML = '<p class="carousel-empty">No LinkedIn highlights available.</p>';
      return;
    }

    var firstBatch = items.map(function (item) { return renderCard(item, false); }).join('');
    var secondBatch = items.map(function (item) { return renderCard(item, true); }).join('');

    mount.innerHTML = '' +
      '<div class="linkedin-loop-shell">' +
      '  <div class="linkedin-loop-track" id="linkedinLoopTrack">' + firstBatch + secondBatch + '</div>' +
      '</div>';

    shell = mount.querySelector('.linkedin-loop-shell');
    track = document.getElementById('linkedinLoopTrack');
    updateBatchWidth();
    shell.scrollLeft = 1;
    bindControls();
  }

  function bindControls() {
    if (!shell) return;

    shell.addEventListener('scroll', function () {
      if (!isPointerDown) normalizeScroll();
    });

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

    window.addEventListener('resize', updateBatchWidth);
  }

  async function loadLinkedInData() {
    try {
      var res = await fetch('assets/data/linkedin.json');
      var data = await res.json();
      renderCarousel((data && data.items) || []);
    } catch (err) {
      var mount = document.getElementById('linkedin-carousel-mount');
      if (mount) {
        mount.innerHTML = '<p class="carousel-empty">Could not load LinkedIn highlights.</p>';
      }
      console.error('LinkedIn content load error:', err);
    }
  }

  document.addEventListener('DOMContentLoaded', loadLinkedInData);
})();
