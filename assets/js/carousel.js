(function () {
  var wrapper = null;
  var track = null;
  var cards = [];
  var batchCopies = 5;
  var stepWidth = 0;
  var currentVirtualIndex = 0;
  var isAnimating = false;
  var recenterTimer = null;
  var lastKnownScrollLeft = 0;

  function renderCard(card, hidden) {
    var hiddenAttr = hidden ? ' aria-hidden="true"' : '';
    var date = card.date ? `<div class="carousel-card-date">${card.date}</div>` : '';
    var github = card.github
      ? `<a href="${card.github}" target="_blank" rel="noopener noreferrer" class="carousel-card-meta-link"><span class="icon brands fa-github" aria-hidden="true"></span><span>GitHub</span></a>`
      : '';
    var media = card.media
      ? `<a href="${card.media}" target="_blank" rel="noopener noreferrer" class="carousel-card-meta-link"><span class="icon solid fa-photo-video" aria-hidden="true"></span><span>Media</span></a>`
      : '';
    var hasMeta = !!(github || media);
    var metaLinks = hasMeta
      ? `<div class="carousel-card-meta-links">${github}${media}</div>`
      : '';
    var headerClass = hasMeta ? 'carousel-card-header has-meta' : 'carousel-card-header';

    return `
      <div class="card-wrapper"${hiddenAttr}>
        <article class="card-inner">
          <header class="${headerClass}">
            <div class="carousel-card-header-left">
              ${metaLinks}
            </div>
            <div class="carousel-card-header-main">
              <div class="journal-header">${card.journal || ''}</div>
              <div class="journal-category">${card.category || ''}</div>
            </div>
            ${date}
          </header>

          <div class="carousel-card-media">
            <img src="${card.image || ''}" alt="${card.imageAlt || card.title || 'carousel image'}">
          </div>

          <div class="carousel-card-body">
            <p class="card-title">${card.title || ''}</p>
            <p class="carousel-card-description">${card.description || ''}</p>
            <div class="carousel-card-actions">
              <a href="${card.link || '#'}" target="_blank" rel="noopener noreferrer" class="carousel-card-link"><span class="carousel-card-link-label">Read</span><span class="carousel-card-link-arrow" aria-hidden="true">→</span></a>
            </div>
          </div>
        </article>
      </div>
    `;
  }

  function updateMeasurements() {
    if (!track || !cards.length) return;
    var card = track.querySelector('.card-wrapper');
    if (!card) return;
    var style = window.getComputedStyle(track);
    var gap = parseFloat(style.columnGap || style.gap || '0') || 0;
    stepWidth = card.offsetWidth + gap;
  }

  function getMiddleBatchStart() {
    return cards.length * Math.floor(batchCopies / 2);
  }

  function setPositionForVirtualIndex(index, behavior) {
    if (!track || !stepWidth) return;
    currentVirtualIndex = index;
    lastKnownScrollLeft = currentVirtualIndex * stepWidth;
    track.style.transition = behavior === 'smooth' ? 'transform 0.4s ease' : 'none';
    track.style.transform = 'translate3d(' + (-lastKnownScrollLeft) + 'px, 0, 0)';
  }

  function getVisibleIndex() {
    if (!stepWidth) return currentVirtualIndex;
    return Math.round(lastKnownScrollLeft / stepWidth);
  }

  function recenterIfNeeded() {
    if (!cards.length || !stepWidth) return;

    var visibleIndex = getVisibleIndex();
    var middleBatchStart = getMiddleBatchStart();
    var safeMin = cards.length;
    var safeMax = cards.length * (batchCopies - 1) - 1;

    currentVirtualIndex = visibleIndex;

    if (visibleIndex < safeMin || visibleIndex > safeMax) {
      var offsetWithinBatch = ((visibleIndex % cards.length) + cards.length) % cards.length;
      var normalizedIndex = middleBatchStart + offsetWithinBatch;
      setPositionForVirtualIndex(normalizedIndex, 'auto');
    }
  }

  function queueRecentering() {
    if (recenterTimer) {
      window.clearTimeout(recenterTimer);
    }
    recenterTimer = window.setTimeout(function () {
      recenterTimer = null;
      recenterIfNeeded();
    }, 40);
  }

  function renderCards(nextCards) {
    if (!wrapper) return;

    cards = nextCards || [];
    currentVirtualIndex = getMiddleBatchStart();
    stepWidth = 0;
    lastKnownScrollLeft = 0;

    if (!cards.length) {
      wrapper.innerHTML = '<p class="carousel-empty">No highlights available.</p>';
      return;
    }

    var html = '';
    for (var copy = 0; copy < batchCopies; copy += 1) {
      var hidden = copy !== Math.floor(batchCopies / 2);
      html += cards.map(function (card) {
        return renderCard(card, hidden);
      }).join('');
    }

    wrapper.innerHTML = '<div class="carousel-track">' + html + '</div>';
    track = wrapper.querySelector('.carousel-track');

    window.requestAnimationFrame(function () {
      updateMeasurements();
      setPositionForVirtualIndex(getMiddleBatchStart(), 'auto');
    });
  }

  async function loadCarouselData() {
    try {
      var res = await fetch('assets/data/carousel.json');
      var data = await res.json();
      renderCards((data && data.cards) || []);
    } catch (err) {
      if (wrapper) {
        wrapper.innerHTML = '<p class="carousel-empty">Could not load highlights.</p>';
      }
      console.error('Carousel load error:', err);
    }
  }

  window.scrollCarousel = function (direction) {
    if (!cards.length || !stepWidth || isAnimating) return;

    isAnimating = true;
    currentVirtualIndex += direction;
    setPositionForVirtualIndex(currentVirtualIndex, 'smooth');

    window.setTimeout(function () {
      isAnimating = false;
      queueRecentering();
    }, 420);
  };

  function bindControls() {
    var controls = document.querySelectorAll('[data-carousel-direction]');
    controls.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var dir = Number(btn.getAttribute('data-carousel-direction') || '0');
        if (dir) window.scrollCarousel(dir);
      });
    });

    if (wrapper) {
      wrapper.addEventListener('wheel', function (event) {
        event.preventDefault();
        if (isAnimating) return;
        if (Math.abs(event.deltaY) < 4) return;
        window.scrollCarousel(event.deltaY > 0 ? 1 : -1);
      }, { passive: false });

      window.addEventListener('resize', function () {
        updateMeasurements();
        recenterIfNeeded();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    wrapper = document.getElementById('carouselWrapper');
    if (!wrapper) return;
    bindControls();
    loadCarouselData();
  });
})();
