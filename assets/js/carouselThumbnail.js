/* pagination update here 7/25/2024*/
// Pagination click

const pages = document.querySelectorAll(".carousel-page");
pages.forEach((page, i) => {
  page.addEventListener("click", () => {
    const slidesContainer = document.querySelector(".carousel-slides");
    const paginationContainer = document.querySelector(".carousel-pagination");

    const activeSlides = document.querySelectorAll("[slide-active]");
    activeSlides.forEach((activeSlide) =>
      activeSlide.removeAttribute("slide-active")
    );

    slidesContainer.children[i].setAttribute("slide-active", "");
    paginationContainer.children[i].setAttribute("slide-active", "");
  });
});

// JS to handle auto carousel
window.onload = function () {
  const slides = document.querySelector(".carousel-slides").children;
  // const thumbnailsContainer = document.querySelector(".carousel-thumbnail");
  // const thumbnails = thumbnailsContainer.children;

  /* pagination update here 7/25/2024*/
  const paginationContainer = document.querySelector(".carousel-pagination");
  const pages = paginationContainer.children;

  /* pagination update here 7/25/2024*/
  /*  removed
        slides.length !== thumbnails.length || 
  */
  if (slides.length !== pages.length)
    throw Error("Mismatch number of slides and thumbnails/pages.");

  function addActive(itemElem) {
    itemElem.setAttribute("slide-active", "");
  }

  function removeActive(itemElem) {
    itemElem.removeAttribute("slide-active");
  }

  setInterval(function () {
    for (let i = 0; i < slides.length; i++) {
      if (slides[i].hasAttribute("slide-active")) {
        if (i + 1 >= slides.length) {
          // when slide is the last
          setTimeout(removeActive(slides[i]), 350);
          // setTimeout(removeActive(thumbnails[i]), 350);
          addActive(slides[0]);
          // addActive(thumbnails[0]);

          // const distance =
          // thumbnails[i].getBoundingClientRect().left -
          // thumbnails[0].getBoundingClientRect().left;
          // thumbnailsContainer.scrollLeft -= Math.abs(distance);

          /* pagination update here 7/25/2024*/
          setTimeout(removeActive(pages[i]), 350);
          addActive(pages[0]);

          break;
        } else {
          setTimeout(removeActive(slides[i]), 350);
          // setTimeout(removeActive(thumbnails[i]), 350);
          addActive(slides[i + 1]);
          // addActive(thumbnails[i + 1]);

          // const distance =
          // thumbnails[i].getBoundingClientRect().left -
          // thumbnails[i + 1].getBoundingClientRect().left;
          // thumbnailsContainer.scrollLeft += Math.abs(distance);
          
          /* pagination update here 7/25/2024*/
          setTimeout(removeActive(pages[i]), 350);
          addActive(pages[i + 1]);
          break;
        }
      }
    }
  }, 3000);
};

// Javscript handling button left and right.
const buttons = document.querySelectorAll(".carousel-button");

buttons.forEach((button) => {
  button.addEventListener("click", () => {
    const offset = button.classList[1] === "next" ? 1 : -1;

    const slidesContainer = document.querySelector(".carousel-slides");
    // const thumbnailsContainer = document.querySelector(".carousel-thumbnail");
    
    /* pagination update here 7/25/2024*/
    const paginationContainer = document.querySelector(".carousel-pagination");

    const activeSlides = document.querySelectorAll("[slide-active]");

    const oldIndex = [...slidesContainer.children].indexOf(activeSlides[0]);
    let newIndex = oldIndex + offset;
    if (newIndex < 0) return;
    if (newIndex >= slidesContainer.children.length) return;

    activeSlides.forEach((activeSlide) =>
      activeSlide.removeAttribute("slide-active")
    );

    // activeSlide.removeAttribute("slide-active");
    slidesContainer.children[newIndex].setAttribute("slide-active", "");
    // thumbnailsContainer.children[newIndex].setAttribute("slide-active", "");

    // const distance =
    //   thumbnailsContainer.children[newIndex].getBoundingClientRect().left -
    //   thumbnailsContainer.children[oldIndex].getBoundingClientRect().left;

    // if (button.classList[1] === "next") {
    //   thumbnailsContainer.scrollLeft += Math.abs(distance);
    // } else {
    //   thumbnailsContainer.scrollLeft -= Math.abs(distance);
    // }

    /* pagination update here 7/25/2024*/
    paginationContainer.children[newIndex].setAttribute("slide-active", "");
  });
});

// thumbnail onclick
// const thumbnails = document.querySelectorAll(".carousel-thumbnail-item");
// thumbnails.forEach((thumbnail, i) => {
//   thumbnail.addEventListener("click", () => {
//     const slidesContainer = document.querySelector(".carousel-slides");
//     const thumbnailsContainer = document.querySelector(".carousel-thumbnail");

//     const activeSlides = document.querySelectorAll("[slide-active]");
//     activeSlides.forEach((activeSlide) =>
//       activeSlide.removeAttribute("slide-active")
//     );

//     slidesContainer.children[i].setAttribute("slide-active", "");
//     thumbnailsContainer.children[i].setAttribute("slide-active", "");
//   });
// });


