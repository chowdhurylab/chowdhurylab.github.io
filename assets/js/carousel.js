(function () {
  var wrapper = null;

  function renderCards(cards) {
    if (!wrapper) return;

    if (!cards || !cards.length) {
      wrapper.innerHTML = '<p style="color:#666; margin: 0;">No highlights available.</p>';
      return;
    }

    wrapper.innerHTML = cards.map(function (card) {
      return `
        <div class="card-wrapper" style="flex: 0 0 calc(100% - 1px);">
          <div class="card-inner" style="
            scroll-snap-align: start;
            width: 100%;
            max-width: 900px;
            margin: 0 auto;
            border-radius: 16px;
            border: 1px solid rgba(0, 0, 0, 0.08);
            background-color: #fff;
            overflow: hidden;
            padding: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            box-sizing: border-box;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07);
          ">
            <div style="width: 100%; background-color: #fff; padding: 12px 16px 4px 16px; text-align: center; box-sizing: border-box;">
              <div class="journal-header" style="font-size: 2rem; font-weight: bold; color: #000;">${card.journal || ''}</div>
              <div class="journal-category" style="font-size: 1.25rem; font-weight: normal; color: #000; letter-spacing: 0.5px;">${card.category || ''}</div>
            </div>
            <div style="width: 100%; aspect-ratio: 3 / 2; position: relative; background-color: #FFFFFF; overflow: hidden;">
              <img src="${card.image || ''}" alt="${card.imageAlt || card.title || 'carousel image'}" style="
                width: 100%;
                height: 100%;
                object-fit: contain;
                object-position: center;
                position: absolute;
                top: 0;
                left: 0;
              ">
            </div>
            <div style="padding: 24px; text-align: center;">
              <p class="card-title" style="color: #000; font-weight: bold; margin-bottom: 12px; font-size: 2rem;">${card.title || ''}</p>
              <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">${card.description || ''}</p>
              <a href="${card.link || '#'}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 10px 24px; background-color: #007AFF; color: #FFFFFF; text-decoration: none; border-radius: 6px; font-weight: 500; transition: background-color 0.3s ease;">Read ⟶</a>
            </div>
          </div>
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
        wrapper.innerHTML = '<p style="color:#666; margin: 0;">Could not load highlights.</p>';
      }
      console.error('Carousel load error:', err);
    }
  }

  window.scrollCarousel = function (direction) {
    if (!wrapper) return;
    var isDesktop = window.innerWidth >= 1024;

    if (isDesktop) {
      wrapper.scrollBy({ left: direction * 424, behavior: 'smooth' });
      return;
    }

    var card = wrapper.querySelector('.card-wrapper');
    if (!card) return;
    var cardWidth = card.offsetWidth + 24;
    wrapper.scrollBy({ left: direction * cardWidth, behavior: 'smooth' });
  };

  document.addEventListener('DOMContentLoaded', function () {
    wrapper = document.getElementById('carouselWrapper');
    if (!wrapper) return;
    loadCarouselData();
  });
})();
