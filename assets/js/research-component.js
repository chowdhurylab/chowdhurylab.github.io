(function () {
  var currentSlide = 0;
  var totalSlides = 0;

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function updateCarousel() {
    var track = document.getElementById('carousel-track');
    if (!track) return;

    track.style.transform = 'translateX(-' + currentSlide * 100 + '%)';

    var dots = document.querySelectorAll('.carousel-dot');
    dots.forEach(function (dot, idx) {
      dot.classList.toggle('active', idx === currentSlide);
    });
  }

  function moveCarousel(direction) {
    if (!totalSlides) return;
    currentSlide = (currentSlide + direction + totalSlides) % totalSlides;
    updateCarousel();
  }

  function goToSlide(index) {
    if (!totalSlides) return;
    currentSlide = ((index % totalSlides) + totalSlides) % totalSlides;
    updateCarousel();
  }

  function renderIntro(paragraphs, container) {
    if (!container) return;
    if (!paragraphs || !paragraphs.length) {
      container.innerHTML = '<p class="research-empty">No research overview available yet.</p>';
      return;
    }

    container.innerHTML = paragraphs
      .map(function (p) {
        return '<p class="research-intro-paragraph">' + escapeHtml(p) + '</p>';
      })
      .join('');
  }

  function buildAreaSlide(area) {
    return (
      '<div class="carousel-slide">' +
      '  <div class="posts">' +
      '    <article>' +
      '      <a class="image"><img src="' + escapeHtml(area.image) + '" alt="' + escapeHtml(area.title || 'Research area image') + '"></a>' +
      '    </article>' +
      '    <article>' +
      '      <h3 class="research-area-title">' + escapeHtml(area.title) + '</h3>' +
      '      <p class="research-area-text">' + escapeHtml(area.text) + '</p>' +
      '      <p class="research-area-applications"><span class="research-area-app-label">Applications</span>: ' + escapeHtml(area.applications) + '</p>' +
      '    </article>' +
      '  </div>' +
      '</div>'
    );
  }

  function renderAreas(areas, container) {
    if (!container) return;
    if (!areas || !areas.length) {
      container.innerHTML = '<p class="research-empty">No research areas listed yet.</p>';
      return;
    }

    totalSlides = areas.length;
    currentSlide = 0;

    var slidesHTML = areas.map(buildAreaSlide).join('');
    var dotsHTML = areas
      .map(function (_, i) {
        var cls = i === 0 ? 'carousel-dot active' : 'carousel-dot';
        return '<button type="button" class="' + cls + '" data-dot-index="' + i + '" aria-label="Go to research area ' + (i + 1) + '"></button>';
      })
      .join('');

    container.innerHTML =
      '<div class="carousel-container">' +
      '  <button type="button" class="carousel-btn left" id="research-prev" aria-label="Previous research area">&#8592;</button>' +
      '  <div class="carousel-track-wrapper">' +
      '    <div class="carousel-track" id="carousel-track">' +
      slidesHTML +
      '    </div>' +
      '  </div>' +
      '  <button type="button" class="carousel-btn right" id="research-next" aria-label="Next research area">&#8594;</button>' +
      '</div>' +
      '<div class="carousel-dots" id="research-dots">' + dotsHTML + '</div>';

    var prevBtn = document.getElementById('research-prev');
    var nextBtn = document.getElementById('research-next');
    var dots = document.getElementById('research-dots');

    if (prevBtn) prevBtn.addEventListener('click', function () { moveCarousel(-1); });
    if (nextBtn) nextBtn.addEventListener('click', function () { moveCarousel(1); });
    if (dots) {
      dots.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-dot-index]');
        if (!btn) return;
        goToSlide(Number(btn.getAttribute('data-dot-index')));
      });
    }

    updateCarousel();
  }

  async function loadResearch() {
    var introContainer = document.getElementById('research-intro');
    var areaContainer = document.getElementById('research-areas');
    if (!introContainer || !areaContainer) return;

    try {
      var res = await fetch('assets/data/research.json');
      var data = await res.json();
      renderIntro(data.introParagraphs || [], introContainer);
      renderAreas(data.researchAreas || [], areaContainer);
    } catch (err) {
      console.error('Research load error:', err);
      introContainer.innerHTML = '<p class="research-empty">Could not load research overview.</p>';
      areaContainer.innerHTML = '<p class="research-empty">Could not load research areas.</p>';
    }
  }

  document.addEventListener('DOMContentLoaded', loadResearch);
})();
