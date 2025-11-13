async function loadMembers() {
    const res = await fetch("assets/data/members.json");
    const data = await res.json();

    renderPI(data.pi);
    renderSection(data.postdocs, "postdocs-container");
    renderSection(data.graduates, "graduates-container");
    renderSection(data.undergraduates, "undergraduates-container");
    renderSection(data.remoteInterns, "remoteinterns-container");
    renderAlumni(data.alumni);
}

// Render Principal Investigator
function renderPI(piList) {
    const container = document.getElementById("pi-container");
    if (!container) return;

    let html = "";

    piList.forEach(pi => {
        html += `
            <article>
                <img style="border-radius:50%" src="${pi.image}" width="200" height="200" alt="${pi.name}" id="hp" />
                </br>

                <h2 style="font-family: Helvetica Neue, Helvetica, Arial, sans-serif; 
                           margin: 0 0 0.5em 0; font-weight:normal; color:#000000;">
                    ${pi.name}
                </h2>

                <p style="font-family: Helvetica Neue, Helvetica, Arial, sans-serif; color:#000000; font-weight:300;">
                    ${pi.positionLines.map(line => `${line} <br/>`).join("")}
                    <a href="mailto:${pi.email}"><b>Email</b></a> |
                    <a href="${pi.links.twitter}" target="_blank" rel="noopener noreferrer" class="icon brands fa-twitter"></a> |
                    <a href="${pi.links.scholar}" target="_blank" rel="noopener noreferrer" class="icon solid fa-graduation-cap"></a> |
                    <a href="${pi.links.linkedin}" target="_blank" rel="noopener noreferrer" class="icon brands fa-linkedin"></a>
                </p>
            </article>
        `;
    });

    container.innerHTML = html;
}

// Render Postdocs/Grads/Undergrads/Interns
function renderSection(list, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let html = "";

    list.forEach(member => {
        html += `
        <article>
            <img style="border-radius: 50%" src="${member.image}" width="175" height="175" alt="${member.name}" id="hp"/>
            <figcaption>
                <div>
                    <h2 style="font-family: Helvetica Neue, Helvetica, Arial, sans-serif; 
                               margin: 0 0 0.5em 0; font-weight:normal; color:#000000;">
                        ${member.name}
                    </h2>
                    <h5 style="color:#000000">
                        <p style="font-family: Helvetica Neue, Helvetica, Arial, sans-serif">
                            ${formatRoleEmail(member)}
                            ${formatAffiliation(member)}
                            ${formatResearch(member)}
                            ${formatLoves(member)}
                        </p>
                    </h5>
                </div>
            </figcaption>
        </article>
        `;
    });

    container.innerHTML = html;
}

// Helpers for formatting fields
function formatRoleEmail(m) {
    let part = "";

    if (m.role) part += `${m.role}`;
    if (m.email) part += ` | <a href="mailto:${m.email}"><b>Email</b></a>`;

    if (m.links) {
        if (m.links.scholar) part += ` | <a href="${m.links.scholar}" target="_blank" rel="noopener noreferrer" class="icon solid fa-graduation-cap"></a>`;
        if (m.links.linkedin) part += ` | <a href="${m.links.linkedin}" target="_blank" rel="noopener noreferrer" class="icon brands fa-linkedin"></a>`;
    }

    return part + `<br/>`;
}

function formatAffiliation(m) {
    return m.affiliation ? `${m.affiliation}<br/>` : "";
}

function formatResearch(m) {
    return m.research ? `Research // ${m.research}<br/>` : "";
}

function formatLoves(m) {
    return m.loves ? `<b style="color:#000000; font-weight:normal">Loves // </b> ${m.loves}<br/>` : "";
}

// Render Alumni
function renderAlumni(list) {
    const container = document.getElementById("alumni-container");
    if (!container) return;

    let html = `
        <h5 style="color:#000000">
        <p style="font-family: Helvetica Neue, Helvetica, Arial, sans-serif">
    `;

    html += `<b>Graduate Students:</b><br><br>`;
    list.filter(a => a.category === "graduate").forEach(a => {
        html += `${a.period} - ${a.name}. ${descriptionNow(a)} <br><br>`;
    });

    html += `<br><br><b>REUs:</b><br><br>`;
    list.filter(a => a.category === "reu").forEach(a => {
        html += `${a.period} - ${a.name} (${a.description}) ${descriptionNow(a)} <br><br>`;
    });

    html += `</p></h5>`;
    container.innerHTML = html;
}

function descriptionNow(a) {
    if (a.now && a.now.length > 0) {
        return `<span style="font-weight:bold;">Now</span>: ${a.now}`;
    }
    return "";
}

// INIT
document.addEventListener("DOMContentLoaded", loadMembers);
