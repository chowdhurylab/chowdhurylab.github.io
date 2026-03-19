// async function loadResearch() {
//     const introContainer = document.getElementById("research-intro");
//     const areaContainer = document.getElementById("research-areas");

//     if (!introContainer || !areaContainer) return;

//     try {
//         const res = await fetch("assets/data/research.json");
//         const data = await res.json();

//         // Render intro paragraphs
//         introContainer.innerHTML = data.introParagraphs
//             .map(p => `<p>${p}</p><br>`)
//             .join("");

//         // Render research areas
//         let html = "";

//         data.researchAreas.forEach(area => {
//             html += `
//                 <div class="posts">
//                     <article>
//                         <a class="image"><img src="${area.image}" alt=""></a><br>
//                     </article>

//                     <article>
//                         <h3 style="color:#7e7e7e" align="left">${area.title}</h3>
//                         <p>
//                             ${area.text}<br>
//                             <b style="color:#5680e9">Applications</b> :
//                             ${area.applications}
//                         </p><br>
//                     </article>
//                 </div>
//             `;
//         });

//         areaContainer.innerHTML = html;

//     } catch (err) {
//         console.error("Research load error:", err);
//     }
// }

// document.addEventListener("DOMContentLoaded", loadResearch);

let currentSlide = 0;

function moveCarousel(direction) {
  const track = document.getElementById("carousel-track");
  const slides = track.querySelectorAll(".carousel-slide");
  const total = slides.length;

  currentSlide = (currentSlide + direction + total) % total;
  track.style.transform = `translateX(-${currentSlide * 100}%)`;

  // Update dot indicators
  document.querySelectorAll(".carousel-dot").forEach((dot, i) => {
    dot.classList.toggle("active", i === currentSlide);
  });
}

async function loadResearch() {
  const introContainer = document.getElementById("research-intro");
  const areaContainer = document.getElementById("research-areas");

  if (!introContainer || !areaContainer) return;

  try {
    const res = await fetch("assets/data/research.json");
    const data = await res.json();

    // Render intro paragraphs
    introContainer.innerHTML = data.introParagraphs
      .map((p) => `<p>${p}</p><br>`)
      .join("");

    // Build carousel slides
    const slidesHTML = data.researchAreas
      .map(
        (area, i) => `
            <div class="carousel-slide">
                <div class="posts">
                    <article>
                        <a class="image"><img src="${area.image}" alt=""></a>
                    </article>
                    <article>
                        <h3 style="color:#7e7e7e">${area.title}</h3>
                        <p>
                            ${area.text}<br><br>
                            <b style="color:#5680e9">Applications</b>:
                            ${area.applications}
                        </p>
                    </article>
                </div>
            </div>
        `,
      )
      .join("");

    // Build dot indicators
    const dotsHTML = data.researchAreas
      .map(
        (_, i) => `
            <span class="carousel-dot ${i === 0 ? "active" : ""}" onclick="moveCarousel(${i} - currentSlide)"></span>
        `,
      )
      .join("");

    areaContainer.innerHTML = `
            <div class="carousel-container">
                <button class="carousel-btn left" onclick="moveCarousel(-1)">&#8592;</button>
                <div class="carousel-track-wrapper">
                    <div class="carousel-track" id="carousel-track">
                        ${slidesHTML}
                    </div>
                </div>
                <button class="carousel-btn right" onclick="moveCarousel(1)">&#8594;</button>
            </div>
            <div class="carousel-dots">${dotsHTML}</div>
        `;
  } catch (err) {
    console.error("Research load error:", err);
  }
}

document.addEventListener("DOMContentLoaded", loadResearch);
