(function () {
  var sectionConfig = [
    { key: 'postdocs', containerId: 'postdocs-container' },
    { key: 'graduates', containerId: 'graduates-container' },
    { key: 'undergraduates', containerId: 'undergraduates-container' },
    { key: 'remoteInterns', containerId: 'remoteinterns-container' }
  ];

  var authorRegistry = [];

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function lookupAuthorId(memberName) {
    var match = authorRegistry.find(function (author) {
      return author.memberName && author.memberName === memberName;
    });
    return match ? match.id : '';
  }

  function renderResearchStatsLink(memberName) {
    if (memberName === 'Ratul Chowdhury, PhD') return '';
    var authorId = lookupAuthorId(memberName);
    if (!authorId) return '';
    return '<p class="members-stats-link-wrap"><a class="members-stats-link" href="author.html?author=' + encodeURIComponent(authorId) + '">Research Stats</a></p>';
  }

  function renderProfileLinks(links) {
    if (!links) return '';
    var parts = [];

    if (links.twitter) {
      parts.push('<a href="' + links.twitter + '" target="_blank" rel="noopener noreferrer" class="icon brands fa-twitter" aria-label="Twitter"></a>');
    }
    if (links.scholar) {
      parts.push('<a href="' + links.scholar + '" target="_blank" rel="noopener noreferrer" class="icon solid fa-graduation-cap" aria-label="Google Scholar"></a>');
    }
    if (links.linkedin) {
      parts.push('<a href="' + links.linkedin + '" target="_blank" rel="noopener noreferrer" class="icon brands fa-linkedin" aria-label="LinkedIn"></a>');
    }

    return parts.join(' <span class="members-sep">|</span> ');
  }

  function renderPI(piList) {
    var container = document.getElementById('pi-container');
    if (!container) return;
    if (!piList || !piList.length) {
      container.innerHTML = '<p class="members-empty">No principal investigator listed.</p>';
      return;
    }

    container.innerHTML = piList
      .map(function (pi) {
        var positionLines = (pi.positionLines || [])
          .map(function (line) {
            return '<div>' + escapeHtml(line) + '</div>';
          })
          .join('');

        var contact = [
          '<a href="mailto:' + escapeHtml(pi.email || '') + '"><b>Email</b></a>',
          renderProfileLinks(pi.links)
        ]
          .filter(Boolean)
          .join(' <span class="members-sep">|</span> ');

        return (
          '<article class="members-pi-card">' +
          '  <img class="members-pi-avatar" src="' + escapeHtml(pi.image) + '" alt="' + escapeHtml(pi.name) + '" />' +
          '  <div class="members-pi-content">' +
          '    <h2 class="members-name">' + escapeHtml(pi.name) + '</h2>' +
          renderResearchStatsLink(pi.name) +
          '    <div class="members-details">' + positionLines + '</div>' +
          '    <p class="members-links">' + contact + '</p>' +
          '  </div>' +
          '</article>'
        );
      })
      .join('');
  }

  function renderMemberCard(member) {
    var lines = [];

    if (member.role || member.email || member.links) {
      var top = [];
      if (member.role) top.push(escapeHtml(member.role));
      if (member.email) top.push('<a href="mailto:' + escapeHtml(member.email) + '"><b>Email</b></a>');
      var linkIcons = renderProfileLinks(member.links);
      if (linkIcons) top.push(linkIcons);
      lines.push(top.join(' <span class="members-sep">|</span> '));
    }

    if (member.affiliation) lines.push(escapeHtml(member.affiliation));
    if (member.research) lines.push('<span class="members-accent-label">Research</span> // ' + escapeHtml(member.research));
    if (member.loves) lines.push('<span class="members-accent-label">Loves</span> // ' + escapeHtml(member.loves));

    return (
      '<article class="members-card">' +
      '  <img class="members-avatar" src="' + escapeHtml(member.image) + '" alt="' + escapeHtml(member.name) + '" />' +
      '  <figcaption>' +
      '    <h2 class="members-name">' + escapeHtml(member.name) + '</h2>' +
      renderResearchStatsLink(member.name) +
      '    <div class="members-details">' + lines.map(function (line) { return '<div>' + line + '</div>'; }).join('') + '</div>' +
      '  </figcaption>' +
      '</article>'
    );
  }

  function renderSection(list, containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    if (!list || !list.length) {
      container.innerHTML = '<p class="members-empty">No members listed.</p>';
      return;
    }

    container.innerHTML = list.map(renderMemberCard).join('');
  }

  function descriptionNow(item) {
    if (item.now && item.now.length > 0) {
      return '<span class="members-now-label">Now:</span> ' + escapeHtml(item.now);
    }
    return '';
  }

  function renderAlumni(list) {
    var container = document.getElementById('alumni-container');
    if (!container) return;
    if (!list || !list.length) {
      container.innerHTML = '<p class="members-empty">No alumni listed.</p>';
      return;
    }

    function renderCategory(category, title) {
      var items = list.filter(function (a) {
        return a.category === category;
      });
      if (!items.length) return '';

      return (
        '<div class="members-alumni-group">' +
        '  <h3 class="members-alumni-title">' + title + '</h3>' +
        '  <ul class="members-alumni-list">' +
        items
          .map(function (a) {
            var desc = a.description ? ' (' + escapeHtml(a.description) + ')' : '';
            var now = descriptionNow(a);
            return '<li><span class="members-alumni-entry">' + escapeHtml(a.period) + ' - ' + escapeHtml(a.name) + desc + '</span>' + (now ? ' <span class="members-alumni-now">' + now + '</span>' : '') + '</li>';
          })
          .join('') +
        '  </ul>' +
        '</div>'
      );
    }

    container.innerHTML = renderCategory('graduate', 'Graduate Students') + renderCategory('reu', 'REUs');
  }

  async function loadMembers() {
    try {
      var results = await Promise.all([
        fetch('assets/data/members.json').then(function (res) { return res.json(); }),
        fetch('assets/data/authors.json').then(function (res) { return res.json(); }).catch(function () { return { authors: [] }; })
      ]);

      var data = results[0];
      authorRegistry = results[1].authors || [];

      renderPI(data.pi || []);
      sectionConfig.forEach(function (section) {
        renderSection(data[section.key] || [], section.containerId);
      });
      renderAlumni(data.alumni || []);
    } catch (err) {
      console.error('Members load error:', err);
    }
  }

  document.addEventListener('DOMContentLoaded', loadMembers);
})();
