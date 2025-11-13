async function loadResearch() {
    const introContainer = document.getElementById("research-intro");
    const areaContainer = document.getElementById("research-areas");

    if (!introContainer || !areaContainer) return;

    try {
        const res = await fetch("assets/data/research.json");
        const data = await res.json();

        // Render intro paragraphs
        introContainer.innerHTML = data.introParagraphs
            .map(p => `<p>${p}</p><br>`)
            .join("");

        // Render research areas
        let html = "";

        data.researchAreas.forEach(area => {
            html += `
                <div class="posts">
                    <article>
                        <a class="image"><img src="${area.image}" alt=""></a><br>
                    </article>

                    <article>
                        <h3 style="color:#7e7e7e" align="left">${area.title}</h3>
                        <p>
                            ${area.text}<br>
                            <b style="color:#5680e9">Applications</b> :
                            ${area.applications}
                        </p><br>
                    </article>
                </div>
            `;
        });

        areaContainer.innerHTML = html;

    } catch (err) {
        console.error("Research load error:", err);
    }
}

document.addEventListener("DOMContentLoaded", loadResearch);
