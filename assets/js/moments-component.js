(function () {
  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderIntro(text, mount) {
    if (!mount) return;
    if (!text) {
      mount.innerHTML = '<p class="moments-empty">No intro available yet.</p>';
      return;
    }

    mount.innerHTML = '<p class="moments-intro-paragraph">' + escapeHtml(text) + '</p>';
  }

  function shuffle(items) {
    var copy = (items || []).slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = copy[i];
      copy[i] = copy[j];
      copy[j] = temp;
    }
    return copy;
  }

  function collectCollageImages(data) {
    var carouselImages = (data.carousel || []).map(function (item) {
      return {
        src: item.image,
        alt: item.alt || 'moment image'
      };
    });

    var timelineImages = (data.postGroups || []).reduce(function (all, group) {
      return all.concat((group.items || []).filter(function (item) {
        return item.type === 'image' && item.src;
      }).map(function (item) {
        return {
          src: item.src,
          alt: item.alt || item.heading || 'moment image'
        };
      }));
    }, []);

    var deduped = [];
    var seen = {};

    carouselImages.concat(timelineImages).forEach(function (item) {
      if (!item.src || seen[item.src]) return;
      seen[item.src] = true;
      deduped.push(item);
    });

    return shuffle(deduped);
  }

  function buildCollage(images) {
    if (!images || !images.length) {
      return '<p class="moments-empty">No collage items yet.</p>';
    }

    return (
      '<div class="moments-justified-grid">' +
      images.map(function (item) {
        return (
          '<figure class="justified-grid-item">' +
          '  <button type="button" class="moments-lightbox-trigger" data-full-src="' + escapeHtml(item.src) + '" data-full-alt="' + escapeHtml(item.alt || 'moment image') + '" aria-label="Open full image">' +
          '    <img src="' + escapeHtml(item.src) + '" alt="' + escapeHtml(item.alt || 'moment image') + '">' +
          '  </button>' +
          '</figure>'
        );
      }).join('') +
      '</div>'
    );
  }

  function ensureLightbox() {
    var existing = document.getElementById('moments-lightbox');
    if (existing) return existing;

    var lightbox = document.createElement('div');
    lightbox.id = 'moments-lightbox';
    lightbox.className = 'moments-lightbox';
    lightbox.setAttribute('hidden', 'hidden');
    lightbox.innerHTML = '' +
      '<div class="moments-lightbox-backdrop" data-close-lightbox="true"></div>' +
      '<div class="moments-lightbox-dialog" role="dialog" aria-modal="true" aria-label="Full image preview">' +
      '  <button type="button" class="moments-lightbox-close" aria-label="Close image"><span class="moments-lightbox-close-icon" aria-hidden="true">×</span></button>' +
      '  <img class="moments-lightbox-image" src="" alt="" />' +
      '</div>';

    document.body.appendChild(lightbox);
    return lightbox;
  }

  function bindLightbox() {
    var collageMount = document.getElementById('moments-collage');
    if (!collageMount) return;

    var lightbox = ensureLightbox();
    var lightboxImage = lightbox.querySelector('.moments-lightbox-image');
    var closeBtn = lightbox.querySelector('.moments-lightbox-close');

    function closeLightbox() {
      lightbox.setAttribute('hidden', 'hidden');
      document.body.classList.remove('moments-lightbox-open');
      lightboxImage.src = '';
      lightboxImage.alt = '';
    }

    function openLightbox(src, alt) {
      lightboxImage.src = src;
      lightboxImage.alt = alt || 'moment image';
      lightbox.removeAttribute('hidden');
      document.body.classList.add('moments-lightbox-open');
    }

    collageMount.addEventListener('click', function (event) {
      var trigger = event.target.closest('.moments-lightbox-trigger');
      if (!trigger) return;
      openLightbox(trigger.getAttribute('data-full-src') || '', trigger.getAttribute('data-full-alt') || '');
    });

    lightbox.addEventListener('click', function (event) {
      if (event.target.closest('[data-close-lightbox="true"]') || event.target.closest('.moments-lightbox-close')) {
        closeLightbox();
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !lightbox.hasAttribute('hidden')) {
        closeLightbox();
      }
    });

    closeBtn.addEventListener('click', closeLightbox);
  }

  async function loadMoments() {
    var introMount = document.getElementById('moments-intro');
    var collageMount = document.getElementById('moments-collage');

    if (!introMount || !collageMount) return;

    try {
      var res = await fetch('assets/data/moments.json');
      var data = await res.json();

      renderIntro(data.introText || '', introMount);
      collageMount.innerHTML = buildCollage(collectCollageImages(data));
      bindLightbox();
    } catch (err) {
      console.error('Moments load error:', err);
      introMount.innerHTML = '<p class="moments-empty">Could not load moments intro.</p>';
      collageMount.innerHTML = '<p class="moments-empty">Could not load collage.</p>';
    }
  }

  document.addEventListener('DOMContentLoaded', loadMoments);
})();
