async function loadPublications() {
    const container = document.getElementById("publications-container");
    if (!container) return;

    try {
        const res = await fetch("assets/data/publications.json");
        const data = await res.json();

        const pubs = data.publications;

        // Group by year (descending)
        const grouped = {};
        pubs.forEach(pub => {
            if (!grouped[pub.year]) grouped[pub.year] = [];
            grouped[pub.year].push(pub);
        });

        const years = Object.keys(grouped).sort((a, b) => b - a);

        let html = "";

        years.forEach(year => {
            grouped[year].forEach(pub => {
                html += `
                    <div style="margin-bottom: 2rem;">
                        <br>
                        <span style="font-weight: 200; font-family: Helvetica Neue, Helvetica, Arial, sans-serif">
                            ${pub.year} // ${pub.journal} —
                        </span>
                        <span style="font-size:0.8em;color:#ff8300;font-family: Helvetica Neue, Helvetica, Arial, sans-serif">
                            ${pub.authors}
                        </span>

                        <b style="color:#7e7e7e;font-family: Helvetica Neue, Helvetica, Arial, sans-serif;">
                            <p>${pub.title}</p>
                        </b>

                        <a href="${pub.link}" target="_blank" rel="noopener noreferrer"
                           class="icon solid fa-chevron-circle-right"
                           style="color:#007cff;font-family: Helvetica Neue, Helvetica, Arial, sans-serif"></a>

                        <a href="${pub.link}" target="_blank" rel="noopener noreferrer"
                           style="font-size:0.9em;color:#007cff">
                            ${pub.articleType}&emsp;
                        </a>

                        ${renderExtraLinks(pub)}
                    </div>
                `;
            });
        });

        container.innerHTML = html;

    } catch (err) {
        console.error("Publications load error:", err);
    }
}

function renderExtraLinks(pub) {
    if (!pub.extraLinks) return "";

    let html = `
        <a class="icon solid fa-quote-left"
           style="font-size:0.9em;color:#007cff;font-family: Helvetica Neue, Helvetica, Arial, sans-serif">
           &emsp;
        </a>
    `;

    html += pub.extraLinks
        .map(link => {
            return `
                <a href="${link.url}" target="_blank" rel="noopener noreferrer"
                   style="font-size:0.9em;color:#007cff;font-family: Helvetica Neue, Helvetica, Arial, sans-serif">
                    ${link.label}
                </a>
            `;
        })
        .join(" |");

    return html;
}

document.addEventListener("DOMContentLoaded", loadPublications);
