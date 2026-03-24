(function () {
  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderIntro(mount) {
    if (!mount) return;

    mount.innerHTML =
      '<p class="outreach-intro-text">The chance to <span class="outreach-highlight outreach-highlight-teach">teach</span> and <span class="outreach-highlight outreach-highlight-train">train</span> young individuals is a big part of what motivates us.</p>';
  }

  function renderTeaching(list, container) {
    if (!container) return;

    if (!list || !list.length) {
      container.innerHTML = '<p class="outreach-empty">No teaching entries available yet.</p>';
      return;
    }

    container.innerHTML =
      '<div class="teaching-cards">' +
      list
        .map(function (item) {
          return (
            '<a class="teaching-card" href="' +
            escapeHtml(item.link) +
            '" target="_blank" rel="noopener noreferrer">' +
            '  <span class="teaching-card-term">' + escapeHtml(item.term) + '</span>' +
            '  <h3 class="teaching-card-course">' + escapeHtml(item.course) + '</h3>' +
            '  <span class="teaching-card-link">View course ↗</span>' +
            '</a>'
          );
        })
        .join("") +
      '</div>';
  }

  function renderTraining(list, container) {
    if (!container) return;

    if (!list || !list.length) {
      container.innerHTML = '<p class="outreach-empty">No training entries available yet.</p>';
      return;
    }

    var sections = list
      .filter(function (section) {
        return section.participants;
      })
      .map(function (section) {
        return (
          '<section class="training-card">' +
          '  <div class="training-card-header">' +
          '    <span class="training-card-year">' + escapeHtml(section.year) + '</span>' +
          '    <h3 class="training-card-title">' + escapeHtml(section.program) + '</h3>' +
          '  </div>' +
          '  <div class="training-participants">' +
          (section.participants || [])
            .map(function (participant) {
              return (
                '<article class="training-participant">' +
                '  <img class="training-participant-image" src="' + escapeHtml(participant.image) + '" alt="' + escapeHtml(participant.name) + '">' +
                '  <div class="training-participant-copy">' +
                '    <h4>' + escapeHtml(participant.name) + '</h4>' +
                '    <p>' + escapeHtml(participant.role) + '</p>' +
                '  </div>' +
                '</article>'
              );
            })
            .join("") +
          '  </div>' +
          '</section>'
        );
      })
      .join("");

    container.innerHTML = sections || '<p class="outreach-empty">No training entries available yet.</p>';
  }

  function findImmuneInvadersProject(trainingList) {
    return (trainingList || []).find(function (section) {
      return section.description;
    });
  }

  function renderImmuneInvadersSection(project, team, container) {
    if (!container) return;

    if (!project && (!team || !team.length)) {
      container.innerHTML = '<p class="outreach-empty">No Immune Invaders details available yet.</p>';
      return;
    }

    var descriptionMarkup = project && project.description && project.description.length
      ? '<ul class="immune-hero-list">' +
        project.description
          .map(function (line) {
            return '<li>' + escapeHtml(line) + '</li>';
          })
          .join("") +
        '</ul>'
      : '';

    var teamMarkup = team && team.length
      ? '<div class="immune-team-grid">' +
        team
          .map(function (member) {
            return (
              '<article class="immune-team-card">' +
              '  <img class="immune-team-image" src="' + escapeHtml(member.image) + '" alt="' + escapeHtml(member.name) + '">' +
              '  <div class="immune-team-copy">' +
              '    <h3 class="immune-team-name">' + escapeHtml(member.name) + '</h3>' +
              '    <p class="immune-team-meta">' + escapeHtml(member.field) + ', ' + escapeHtml(member.years) + '</p>' +
              '    <p class="immune-team-role">' + escapeHtml(member.contribution) + '</p>' +
              '  </div>' +
              '</article>'
            );
          })
          .join("") +
        '</div>'
      : '';

    container.innerHTML =
      '<section class="immune-section">' +
      '  <div class="immune-section-header">' +
      '    <span class="outreach-section-kicker immune-kicker">Immune Invaders</span>' +
      '    <h2 class="immune-section-title">Edu-game development</h2>' +
      '    <p class="immune-section-subtitle">A single outreach project, from concept to implementation.</p>' +
      '  </div>' +
      '  <div class="immune-section-shell">' +
      '    <div class="immune-hero">' +
      '      <div class="immune-hero-copy">' +
      '        <span class="immune-eyebrow">Project overview</span>' +
      '        <h3 class="immune-hero-title">' + escapeHtml((project && project.year) || 'Immune Invaders Edu-Game') + '</h3>' +
      descriptionMarkup +
      '      </div>' +
      '    </div>' +
      '    <div class="immune-team-block">' +
      '      <div class="immune-team-header">' +
      '        <span class="immune-eyebrow">Development team</span>' +
      '        <h3 class="immune-team-title">The people behind the build</h3>' +
      '      </div>' +
      teamMarkup +
      '    </div>' +
      '  </div>' +
      '</section>';
  }

  async function loadOutreach() {
    var introMount = document.getElementById("outreach-intro");
    var teachingContainer = document.getElementById("teaching-container");
    var trainingContainer = document.getElementById("training-container");
    var teamContainer = document.getElementById("immuneinvaders-team");

    if (!introMount || !teachingContainer || !trainingContainer || !teamContainer) return;

    try {
      var res = await fetch("assets/data/outreach.json");
      var data = await res.json();
      var immuneProject = findImmuneInvadersProject(data.training || []);

      renderIntro(introMount);
      renderTeaching(data.teaching, teachingContainer);
      renderTraining(data.training, trainingContainer);
      renderImmuneInvadersSection(immuneProject, data.immuneInvadersTeam, teamContainer);
    } catch (err) {
      console.error("Outreach load error:", err);
      introMount.innerHTML = '<p class="outreach-empty">Could not load outreach overview.</p>';
      teachingContainer.innerHTML = '<p class="outreach-empty">Could not load teaching.</p>';
      trainingContainer.innerHTML = '<p class="outreach-empty">Could not load training.</p>';
      teamContainer.innerHTML = '<p class="outreach-empty">Could not load Immune Invaders section.</p>';
    }
  }

  document.addEventListener("DOMContentLoaded", loadOutreach);
})();
