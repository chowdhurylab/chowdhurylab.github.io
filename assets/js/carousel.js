// JS to handle auto carousel
window.onload = function () { 
    const slides = document.querySelector(".carousel-slides").children;

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
                    addActive(slides[0]); 
                    break;
                    
                } else {
                    setTimeout(removeActive(slides[i]), 350); 
                    addActive(slides[i + 1]);
                    break;
                }
            }
        } 
    }, 5000); 
};

// Javscript handling button left and right.
const buttons = document.querySelectorAll(".carousel-button")

buttons.forEach((button) => {
    button.addEventListener("click", () => {
        //console.log(button);
        const offset = (button.classList[1] === "next") ? 1 : -1;
        //console.log(offset);

        const slides = button
            .closest(".carousel")
            .querySelector(".carousel-slides")

        //console.log(slides);

        const activeSlide = slides.querySelector("[slide-active]")
        //console.log(activeSlide);

        let newIndex = [...slides.children].indexOf(activeSlide) + offset;
        if (newIndex < 0) newIndex = slides.children.length - 1;
        if (newIndex >= slides.children.length) newIndex = 0;

        //console.log(newIndex);
        activeSlide.removeAttribute("slide-active");
        slides.children[newIndex].setAttribute("slide-active", "");
    })
})