(function () {
  var wrapper = null;

  function renderCards(cards) {
    if (!wrapper) return;

    if (!cards || !cards.length) {
      wrapper.innerHTML = '<p class="carousel-empty">No highlights available.</p>';
      return;
    }

    wrapper.innerHTML = cards.map(function (card) {
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
        <div class="card-wrapper">
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
    }).join('');
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
    if (!wrapper) return;

    var card = wrapper.querySelector('.card-wrapper');
    if (!card) return;
    var style = window.getComputedStyle(wrapper);
    var gap = parseFloat(style.columnGap || style.gap || '0') || 0;
    var cardWidth = card.offsetWidth + gap;
    wrapper.scrollBy({ left: direction * cardWidth, behavior: 'smooth' });
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
        wrapper.scrollLeft += event.deltaY;
      }, { passive: false });
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    wrapper = document.getElementById('carouselWrapper');
    if (!wrapper) return;
    bindControls();
    loadCarouselData();
  });
})();
