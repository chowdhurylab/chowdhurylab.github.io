async function loadDownloads() {
    const container = document.getElementById("downloads-container");
    if (!container) return;

    try {
        const response = await fetch("assets/data/downloads.json");
        const data = await response.json();

        let html = "";

        data.downloads.forEach(db => {
            html += `
                <div id="${db.id}" class="db--posts">
                    <h3>${db.title}</h3>

                    ${db.description.map(p => `<p>${p}</p>`).join("")}

                    ${db.bulletPoints ? `
                        <ul style="padding-left:4rem;">
                            ${db.bulletPoints.map(b => `<li>${b}</li>`).join("")}
                        </ul>
                    ` : ""}

                    <div style="display:flex;justify-content:center;align-items:center;">
                        <img style="object-fit:contain;width:100%;max-width:500px;" src="${db.image}">
                    </div>

                    <div class="db--button--flexbox">
                        ${db.buttons.map(btn => renderButton(btn)).join("")}
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;

    } catch (err) {
        console.error("Downloads load error:", err);
    }
}

function renderButton(btn) {
    const metricLabel = btn.downloads !== undefined ? "Downloads" : "Views";
    const metricValue = btn.downloads !== undefined ? btn.downloads : btn.views;

    return `
        <div class="db--button--container">
            <a href="${btn.url}" ${btn.url ? `target="_blank"` : ""} download="">
                <button>${btn.label}</button>
            </a>
            <div>
                ${metricLabel} = 
                <b style="color:#5680e9;font-family: Helvetica Neue, Helvetica, Arial, sans-serif">${metricValue}</b>;
                as of: ${btn.date}
            </div>
        </div>
    `;
}

document.addEventListener("DOMContentLoaded", loadDownloads);
