async function loadSidebar() {
    const container = document.getElementById("sidebar-latest");
    if (!container) return;

    try {
        const res = await fetch("assets/data/sidebar.json");
        const data = await res.json();

        let html = "";

        data.latestInLab.forEach(item => {
            html += `
                <b style="color:#5680e9;font-family: Helvetica Neue, Helvetica, Arial, sans-serif">
                    ${item.date}
                </b>
                <span style="color:#7e7e7e;font-family: Helvetica Neue, Helvetica, Arial, sans-serif">
                    ${formatText(item)}
                </span>
                <span style="color:#818589" class="icon fa solid ${item.icon}"></span>
                <br><br>
                ${formatImage(item)}
            `;
        });

        container.innerHTML = html;

    } catch (err) {
        console.error("Sidebar load error:", err);
    }
}

function formatText(item) {
    let t = item.text;

    if (item.link && item.linkText) {
        t += ` <a href="${item.link}" target="_blank" style="color:blue; text-decoration:none;">${item.linkText}</a>`;
    }

    return t;
}

function formatImage(item) {
    if (!item.image) return "";
    return `
        <img src="${item.image}" width="100%" alt="" id="hp" />
        <br><br>
    `;
}

document.addEventListener("DOMContentLoaded", loadSidebar);
