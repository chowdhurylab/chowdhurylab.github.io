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
      images.map(function (item, index) {
        var widthClass = index % 6 === 0 ? ' is-wide' : index % 5 === 0 ? ' is-tall' : '';
        return (
          '<figure class="justified-grid-item' + widthClass + '">' +
          '  <img src="' + escapeHtml(item.src) + '" alt="' + escapeHtml(item.alt || 'moment image') + '">' +
          '</figure>'
        );
      }).join('') +
      '</div>'
    );
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
    } catch (err) {
      console.error('Moments load error:', err);
      introMount.innerHTML = '<p class="moments-empty">Could not load moments intro.</p>';
      collageMount.innerHTML = '<p class="moments-empty">Could not load collage.</p>';
    }
  }

  document.addEventListener('DOMContentLoaded', loadMoments);
})();
