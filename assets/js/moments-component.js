(function () {
  var currentSlide = 0;
  var totalSlides = 0;

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function updateCarousel() {
    var slides = document.querySelectorAll("#moments-carousel .carousel-item");
    var pages = document.querySelectorAll("#moments-carousel .carousel-page");

    slides.forEach(function (slide, idx) {
      if (idx === currentSlide) {
        slide.setAttribute("slide-active", "");
      } else {
        slide.removeAttribute("slide-active");
      }
    });

    pages.forEach(function (page, idx) {
      if (idx === currentSlide) {
        page.setAttribute("slide-active", "");
      } else {
        page.removeAttribute("slide-active");
      }
    });
  }

  function moveSlide(direction) {
    if (!totalSlides) return;
    var next = currentSlide + direction;
    if (next < 0 || next >= totalSlides) return;
    currentSlide = next;
    updateCarousel();
  }

  function goToSlide(index) {
    if (!totalSlides) return;
    if (index < 0 || index >= totalSlides) return;
    currentSlide = index;
    updateCarousel();
  }

  function renderIntro(text, mount) {
    if (!mount) return;
    if (!text) {
      mount.innerHTML = '<p class="moments-empty">No intro available yet.</p>';
      return;
    }

    mount.innerHTML = '<p class="moments-intro-paragraph">' + escapeHtml(text) + '</p>';
  }

  function buildCarousel(slides) {
    if (!slides || !slides.length) {
      return '<p class="moments-empty">No carousel items yet.</p>';
    }

    var slideHTML = slides
      .map(function (item, idx) {
        var active = idx === 0 ? ' slide-active' : '';
        return (
          '<div class="carousel-item c-thumbnail"' + active + '>' +
          '  <img src="' + escapeHtml(item.image) + '" alt="' + escapeHtml(item.alt || "moment image") + '">' +
          "</div>"
        );
      })
      .join("");

    var pageHTML = slides
      .map(function (_, idx) {
        var active = idx === 0 ? ' slide-active' : '';
        return '<div class="carousel-page" data-page-index="' + idx + '"' + active + '></div>';
      })
      .join("");

    return (
      '<div class="carousel moments-carousel" style="margin-bottom: 20px;">' +
      '  <button type="button" class="carousel-button prev" aria-label="Previous slide">' +
      '    <a class="icon solid fa-chevron-circle-left" style="color:#007cff;font-family: Helvetica Neue, Helvetica, Arial, sans-serif"></a>' +
      "  </button>" +
      '  <button type="button" class="carousel-button next" aria-label="Next slide">' +
      '    <a class="icon solid fa-chevron-circle-right" style="color:#007cff;font-family: Helvetica Neue, Helvetica, Arial, sans-serif"></a>' +
      "  </button>" +
      '  <div class="carousel-slides">' + slideHTML + "</div>" +
      '  <div class="carousel-pagination">' + pageHTML + "</div>" +
      "</div>"
    );
  }

  function buildBulletList(item) {
    var bullets = item.bullets || [];

    if (!bullets.length) {
      return '<p class="moment-card-summary">No details available yet.</p>';
    }

    return (
      '<ul class="moment-card-bullets">' +
      bullets
        .map(function (bullet) {
          return '<li>' + escapeHtml(bullet) + '</li>';
        })
        .join("") +
      "</ul>"
    );
  }

  function buildMedia(item, isFeature) {
    var mediaClass = isFeature ? "moment-card-media feature-media" : "moment-card-media";

    if (item.type === "video") {
      return (
        '<div class="' + mediaClass + '">' +
        '  <iframe src="' +
        escapeHtml(item.src) +
        '" title="' +
        escapeHtml(item.title || "video") +
        '" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>' +
        "</div>"
      );
    }

    return (
      '<div class="' + mediaClass + '">' +
      '  <img src="' +
      escapeHtml(item.src) +
      '" alt="' +
      escapeHtml(item.alt || "moment image") +
      '">' +
      "</div>"
    );
  }

  function buildMomentCard(item, options) {
    var opts = options || {};
    var isFeature = !!opts.feature;
    var cardClass = isFeature ? "moment-card feature-card" : "moment-card";
    var yearBadge = item.year ? '<span class="moment-card-year">' + escapeHtml(item.year) + '</span>' : "";
    var tag = item.tag ? '<span class="moment-card-tag">' + escapeHtml(item.tag) + '</span>' : "";
    var eyebrow = yearBadge || tag ? '<div class="moment-card-meta">' + yearBadge + tag + '</div>' : "";
    var titleTag = isFeature ? "h2" : "h3";
    var subtitle = item.summary ? '<p class="moment-card-summary">' + escapeHtml(item.summary) + '</p>' : "";

    return (
      '<article class="' + cardClass + '">' +
      buildMedia(item, isFeature) +
      '<div class="moment-card-copy">' +
      eyebrow +
      '<' +
      titleTag +
      ' class="moment-card-title">' +
      escapeHtml(item.heading || "") +
      '</' +
      titleTag +
      '>' +
      subtitle +
      buildBulletList(item) +
      "</div>" +
      "</article>"
    );
  }

  function flattenPostItems(groups) {
    return (groups || []).reduce(function (all, group) {
      return all.concat(group.items || []);
    }, []);
  }

  function renderPosts(groups, mount) {
    if (!mount) return;

    var items = flattenPostItems(groups);
    if (!items.length) {
      mount.innerHTML = '<p class="moments-empty">No moments available yet.</p>';
      return;
    }

    var feature = items[0];
    var supporting = items.slice(1);

    var supportingMarkup = supporting.length
      ? '<div class="moments-supporting-grid">' +
        supporting
          .map(function (item) {
            return buildMomentCard(item, { feature: false });
          })
          .join("") +
        "</div>"
      : "";

    mount.innerHTML =
      '<div class="moments-editorial-layout">' +
      '  <div class="moments-feature-wrap">' +
      buildMomentCard(feature, { feature: true }) +
      "  </div>" +
      supportingMarkup +
      "</div>";
  }

  function bindCarouselEvents() {
    var root = document.getElementById("moments-carousel");
    if (!root) return;

    root.addEventListener("click", function (event) {
      var nextBtn = event.target.closest(".carousel-button.next");
      var prevBtn = event.target.closest(".carousel-button.prev");
      var page = event.target.closest(".carousel-page[data-page-index]");

      if (nextBtn) {
        moveSlide(1);
        return;
      }

      if (prevBtn) {
        moveSlide(-1);
        return;
      }

      if (page) {
        var idx = Number(page.getAttribute("data-page-index"));
        goToSlide(idx);
      }
    });

    setInterval(function () {
      if (!totalSlides) return;
      currentSlide = (currentSlide + 1) % totalSlides;
      updateCarousel();
    }, 3000);
  }

  async function loadMoments() {
    var introMount = document.getElementById("moments-intro");
    var carouselMount = document.getElementById("moments-carousel");
    var postsMount = document.getElementById("moments-posts");

    if (!introMount || !carouselMount || !postsMount) return;

    try {
      var res = await fetch("assets/data/moments.json");
      var data = await res.json();

      renderIntro(data.introText || "", introMount);

      var slides = data.carousel || [];
      totalSlides = slides.length;
      currentSlide = 0;
      carouselMount.innerHTML = buildCarousel(slides);
      updateCarousel();
      bindCarouselEvents();

      renderPosts(data.postGroups || [], postsMount);
    } catch (err) {
      console.error("Moments load error:", err);
      introMount.innerHTML = '<p class="moments-empty">Could not load moments intro.</p>';
      carouselMount.innerHTML = '<p class="moments-empty">Could not load carousel.</p>';
      postsMount.innerHTML = '<p class="moments-empty">Could not load moments.</p>';
    }
  }

  document.addEventListener("DOMContentLoaded", loadMoments);
})();
