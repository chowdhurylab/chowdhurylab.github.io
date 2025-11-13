async function loadOutreach() {
    const teachingContainer = document.getElementById("teaching-container");
    const trainingContainer = document.getElementById("training-container");
    const teamContainer = document.getElementById("immuneinvaders-team");

    if (!teachingContainer || !trainingContainer || !teamContainer) return;

    try {
        const res = await fetch("assets/data/outreach.json");
        const data = await res.json();

        renderTeaching(data.teaching, teachingContainer);
        renderTraining(data.training, trainingContainer);
        renderTeam(data.immuneInvadersTeam, teamContainer);

    } catch (err) {
        console.error("Outreach load error:", err);
    }
}

function renderTeaching(list, container) {
    let html = "<ul><h5>";

    list.forEach(item => {
        html += `
            <a style="font-family: Helvetica Neue, Helvetica, Arial, sans-serif; color:black;"
               href="${item.link}" target="_blank" rel="noopener noreferrer">
                <b>${item.term} &ensp;</b>${item.course}
            </a><br>
        `;
    });

    html += "</h5></ul>";
    container.innerHTML = html;
}

function renderTraining(list, container) {
    let html = "";

    list.forEach(section => {

        // If it is a year-based section with participants
        if (section.participants) {
            html += `
                <h4 style="font-family: Helvetica Neue, Helvetica, Arial, sans-serif;color:black;">
                    ⇣ ${section.year} / ${section.program}
                </h4><br>

                <div class="mini-posts2">
            `;

            section.participants.forEach(p => {
                html += `
                    <article style="display:flex;align-items:center;">
                        <h5 style="font-family: Helvetica Neue, Helvetica, Arial, sans-serif;color:black;line-height:1.5;">
                            <span>&rarr;</span> ${p.name} (${p.role})
                        </h5>
                    </article>

                    <article style="display:flex;align-items:center;">
                        <img style="border-radius:50%;" src="${p.image}" width="175" height="175">
                    </article>
                    <br>
                `;
            });

            html += `</div><br>`;
        }

        // If it is Immune Invaders description section
        if (section.description) {
            html += `
                <h4 style="font-family: Helvetica Neue, Helvetica, Arial, sans-serif;color:black;">
                    ⇣ Immune Invaders Edu-Game Development
                </h4>
                <h5 style="font-family: Helvetica Neue, Helvetica, Arial, sans-serif;color:black;line-height:1.5;">
            `;

            section.description.forEach(line => {
                html += `<span>&rarr;</span> ${line}<br>`;
            });

            html += "</h5>";
        }
    });

    container.innerHTML = html;
}

function renderTeam(list, container) {
    let html = `
        <br><br>
        <h4 style="font-family: Helvetica Neue, Helvetica, Arial, sans-serif;color:black;text-align:left;">
            Development Team
        </h4>

        <div class="posts3">
    `;

    list.forEach(member => {
        html += `
            <article>
                <img style="border-radius:50%;" src="${member.image}" width="175" height="175">
                <figcaption>
                    <div>
                        <h4 style="font-family: Helvetica Neue, Helvetica, Arial, sans-serif;
                                   margin:0 0 0.5em 0;font-weight:normal;color:#000000;">
                            ${member.name} <br>(${member.field}, ${member.years})
                        </h4>

                        <h5 style="color:#000000;">
                            <p style="font-family: Helvetica Neue, Helvetica, Arial, sans-serif;">
                                ${member.contribution}
                            </p>
                        </h5>
                    </div>
                </figcaption>
            </article>
        `;
    });

    html += "</div>";

    container.innerHTML = html;
}

document.addEventListener("DOMContentLoaded", loadOutreach);
