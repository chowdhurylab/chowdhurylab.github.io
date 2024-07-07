// JS to handle auto carousel
window.onload = function () { 
    const slides = document.querySelector(".carousel-slides").children;
    const thumbnailsContainer = document.querySelector(".carousel-thumbnail").children;

    if (slides.length !== thumbnailsContainer.length) throw Error("Mismatch number of slides and thumbnails.")

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
                    setTimeout(removeActive(slides[i]), 350);
                    setTimeout(removeActive(thumbnailsContainer[i]), 350);
                    addActive(slides[0]); 
                    addActive(thumbnailsContainer[0]); 
                    break;
                    
                } else {
                    setTimeout(removeActive(slides[i]), 350); 
                    setTimeout(removeActive(thumbnailsContainer[i]), 350); 
                    addActive(slides[i + 1]);
                    addActive(thumbnailsContainer[i + 1]);
                    break;
                }
            }
        } 
    }, 3000); 
};

// Javscript handling button left and right.
const buttons = document.querySelectorAll(".carousel-button")

buttons.forEach((button) => {
    button.addEventListener("click", () => {
        const offset = (button.classList[1] === "next") ? 1 : -1;

        const slidesContainer = document.querySelector(".carousel-slides")
        const thumbnailsContainer = document.querySelector(".carousel-thumbnail")

        const activeSlides = document.querySelectorAll("[slide-active]")
        activeSlides.forEach((activeSlide) => activeSlide.removeAttribute("slide-active"))

        let newIndex = [...slidesContainer.children].indexOf(activeSlides[0]) + offset;
        if (newIndex < 0) newIndex = slidesContainer.children.length - 1;
        if (newIndex >= slidesContainer.children.length) newIndex = 0;

        // activeSlide.removeAttribute("slide-active");
        slidesContainer.children[newIndex].setAttribute("slide-active", "");
        thumbnailsContainer.children[newIndex].setAttribute("slide-active", "");
    })
})

// thumbnail onclick
const thumbnails = document.querySelectorAll(".carousel-thumbnail-item");
thumbnails.forEach((thumbnail, i) => {
    thumbnail.addEventListener("click", () => {
        const slidesContainer = document.querySelector(".carousel-slides")
        const thumbnailsContainer = document.querySelector(".carousel-thumbnail")

        const activeSlides = document.querySelectorAll("[slide-active]")
        activeSlides.forEach((activeSlide) => activeSlide.removeAttribute("slide-active"))

        slidesContainer.children[i].setAttribute("slide-active", "");
        thumbnailsContainer.children[i].setAttribute("slide-active", "");
    })
})