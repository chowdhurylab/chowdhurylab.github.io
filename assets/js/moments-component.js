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
      '    <a class="icon solid fa-chevron-circle-left" style="color:#ff8300;font-family: Helvetica Neue, Helvetica, Arial, sans-serif"></a>' +
      "  </button>" +
      '  <button type="button" class="carousel-button next" aria-label="Next slide">' +
      '    <a class="icon solid fa-chevron-circle-right" style="color:#ff8300;font-family: Helvetica Neue, Helvetica, Arial, sans-serif"></a>' +
      "  </button>" +
      '  <div class="carousel-slides">' + slideHTML + "</div>" +
      '  <div class="carousel-pagination">' + pageHTML + "</div>" +
      "</div>"
    );
  }

  function buildBulletList(item) {
    var bullets = item.bullets || [];

    if (!bullets.length) {
      return "";
    }

    return (
      '<ul class="timeline-card-bullets">' +
      bullets
        .map(function (bullet) {
          return '<li>' + escapeHtml(bullet) + '</li>';
        })
        .join("") +
      "</ul>"
    );
  }

  function buildTimelineMedia(item) {
    if (item.type === "video") {
      return (
        '<div class="timeline-card-media timeline-card-media-video">' +
        '  <iframe src="' +
        escapeHtml(item.src) +
        '" title="' +
        escapeHtml(item.title || "video") +
        '" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>' +
        "</div>"
      );
    }

    return (
      '<div class="timeline-card-media">' +
      '  <img src="' +
      escapeHtml(item.src) +
      '" alt="' +
      escapeHtml(item.alt || "moment image") +
      '">' +
      "</div>"
    );
  }

  function buildTimelineItem(item, index) {
    var alignment = index % 2 === 0 ? "timeline-item-left" : "timeline-item-right";
    var year = item.year ? '<div class="timeline-year">' + escapeHtml(item.year) + '</div>' : '<div class="timeline-year timeline-year-empty"></div>';
    var tag = item.tag ? '<span class="timeline-tag">' + escapeHtml(item.tag) + '</span>' : "";
    var summary = item.summary ? '<p class="timeline-summary">' + escapeHtml(item.summary) + '</p>' : "";

    return (
      '<article class="timeline-item ' + alignment + '">' +
      '  <div class="timeline-item-rail">' +
      year +
      '    <span class="timeline-dot" aria-hidden="true"></span>' +
      '  </div>' +
      '  <div class="timeline-card">' +
      buildTimelineMedia(item) +
      '    <div class="timeline-card-copy">' +
      tag +
      '      <h3 class="timeline-card-title">' + escapeHtml(item.heading || "") + '</h3>' +
      summary +
      buildBulletList(item) +
      '    </div>' +
      '  </div>' +
      '</article>'
    );
  }

  function flattenPostItems(groups) {
    return (groups || []).reduce(function (all, group) {
      return all.concat(group.items || []);
    }, []);
  }

  function sortTimelineItems(items) {
    return items.slice().sort(function (a, b) {
      var yearA = Number(a.year) || 0;
      var yearB = Number(b.year) || 0;
      return yearB - yearA;
    });
  }

  function renderPosts(groups, mount) {
    if (!mount) return;

    var items = sortTimelineItems(flattenPostItems(groups));
    if (!items.length) {
      mount.innerHTML = '<p class="moments-empty">No moments available yet.</p>';
      return;
    }

    mount.innerHTML =
      '<div class="moments-timeline-gallery">' +
      '  <div class="moments-timeline-intro">' +
      '    <p class="moments-timeline-kicker">A lab story in moments</p>' +
      '    <h2 class="moments-timeline-title">Milestones, talks, and snapshots over time</h2>' +
      '  </div>' +
      '  <div class="moments-timeline-track">' +
      items
        .map(function (item, index) {
          return buildTimelineItem(item, index);
        })
        .join("") +
      '  </div>' +
      '</div>';
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
