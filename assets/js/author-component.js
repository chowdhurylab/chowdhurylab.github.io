(function () {
  var PIE_COLORS = ['#ff8300', '#BE531C', '#f59e0b', '#f97316', '#fbbf24'];

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function slugify(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/,?\s*ph\.?d\.?/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function getQueryParam(name) {
    var params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
  }

  function normalizeCitationName(text) {
    return String(text || '')
      .replace(/\s+et al\.?$/i, '')
      .trim();
  }

  function buildMemberLookup(members) {
    var map = {};
    members.forEach(function (member) {
      map[member.fullName] = member;
      map[slugify(member.fullName)] = member;
      (member.aliases || []).forEach(function (alias) {
        map[alias] = member;
      });
    });
    return map;
  }

  function buildAuthorRegistryLookup(authorRegistry) {
    var map = {};
    (authorRegistry || []).forEach(function (author) {
      map[author.id] = author;
      (author.publicationNames || []).forEach(function (name) {
        map['pub:' + normalizeCitationName(name)] = author;
      });
      (author.fullNameVariants || []).forEach(function (name) {
        map['full:' + normalizeCitationName(name)] = author;
      });
    });
    return map;
  }

  function flattenMembers(membersData) {
    var buckets = ['pi', 'postdocs', 'graduates', 'undergraduates', 'remoteInterns'];
    var flat = [];

    function buildMemberAliases(member) {
      var aliases = [];
      var fullName = String(member.name || '').replace(/,?\s*PhD/gi, '').trim();
      var parts = fullName.split(/\s+/).filter(Boolean);

      aliases.push(slugify(fullName));

      if (parts.length >= 2) {
        var surname = parts[parts.length - 1];
        var given = parts[0];
        aliases.push(slugify(surname + ' ' + given.charAt(0)));
        aliases.push(slugify(surname + ', ' + given.charAt(0) + '.'));
      }

      return aliases.filter(Boolean).filter(function (value, index, array) {
        return array.indexOf(value) === index;
      });
    }

    buckets.forEach(function (bucket) {
      (membersData[bucket] || []).forEach(function (member) {
        flat.push({
          fullName: member.name,
          name: member.name,
          slug: slugify(member.name),
          aliases: buildMemberAliases(member),
          image: member.image,
          email: member.email,
          role: member.role || (bucket === 'pi' ? 'Principal Investigator' : ''),
          affiliation: member.affiliation || (member.positionLines ? member.positionLines.join(' · ') : ''),
          bio: member.research ? 'Research focus: ' + member.research + (member.loves ? '. Loves: ' + member.loves + '.' : '.') : (member.positionLines ? member.positionLines.join('. ') + '.' : ''),
          research: member.research || '',
          loves: member.loves || '',
          links: member.links || {},
          positionLines: member.positionLines || []
        });
      });
    });

    return flat;
  }

  function buildFallbackAuthorProfile(authorEntry) {
    return {
      fullName: authorEntry.displayName || authorEntry.id,
      name: authorEntry.displayName || authorEntry.id,
      slug: authorEntry.id,
      image: 'images/rz.png',
      email: '',
      role: 'Author profile',
      affiliation: '',
      bio: 'This profile was generated from the author registry because no matching member profile was found on the Members page.',
      research: '',
      loves: '',
      links: {}
    };
  }

  function summarizeExpertise(author, expertiseData) {
    var slug = author.slug;
    var curated = expertiseData && expertiseData.authors && expertiseData.authors[slug];
    if (curated && curated.expertise && curated.expertise.length) {
      return {
        items: curated.expertise.slice(0, 5),
        note: curated.notes || 'Expertise distribution is currently curated from available profile and publication context.'
      };
    }

    var researchText = String(author.research || '').trim();
    if (!researchText) {
      return {
        items: [
          { label: 'General research', value: 100 }
        ],
        note: 'No structured contribution metadata is available yet, so this chart falls back to profile information.'
      };
    }

    var parts = researchText
      .split(/,|;| and /i)
      .map(function (item) { return item.trim(); })
      .filter(Boolean)
      .slice(0, 5);

    var base = Math.floor(100 / Math.max(parts.length, 1));
    var items = parts.map(function (label, index) {
      return {
        label: label,
        value: index === parts.length - 1 ? 100 - base * (parts.length - 1) : base
      };
    });

    return {
      items: items,
      note: 'This expertise chart is auto-generated from the member profile for now. It can be upgraded with paper-level author-contribution metadata later.'
    };
  }

  function buildPieGradient(items) {
    var total = items.reduce(function (sum, item) { return sum + (Number(item.value) || 0); }, 0) || 1;
    var current = 0;
    var stops = items.map(function (item, index) {
      var value = Number(item.value) || 0;
      var start = (current / total) * 100;
      current += value;
      var end = (current / total) * 100;
      var color = PIE_COLORS[index % PIE_COLORS.length];
      return color + ' ' + start + '% ' + end + '%';
    });
    return 'conic-gradient(' + stops.join(', ') + ')';
  }

  function renderLinks(author) {
    var links = [];
    if (author.email) links.push('<a class="author-link-chip" href="mailto:' + escapeHtml(author.email) + '"><span class="icon solid fa-envelope"></span><span>Email</span></a>');
    if (author.links && author.links.scholar) links.push('<a class="author-link-chip" href="' + escapeHtml(author.links.scholar) + '" target="_blank" rel="noopener noreferrer"><span class="icon solid fa-graduation-cap"></span><span>Scholar</span></a>');
    if (author.links && author.links.linkedin) links.push('<a class="author-link-chip" href="' + escapeHtml(author.links.linkedin) + '" target="_blank" rel="noopener noreferrer"><span class="icon brands fa-linkedin"></span><span>LinkedIn</span></a>');
    if (author.links && author.links.twitter) links.push('<a class="author-link-chip" href="' + escapeHtml(author.links.twitter) + '" target="_blank" rel="noopener noreferrer"><span class="icon brands fa-twitter"></span><span>Twitter</span></a>');
    return links.join('');
  }

  function renderBarChart(stats) {
    var max = Math.max(stats.firstAuthor, stats.coAuthor, 1);
    var rows = [
      { label: 'First-author papers', value: stats.firstAuthor },
      { label: 'Co-author papers', value: stats.coAuthor }
    ];

    return '<div class="author-bar-chart">' + rows.map(function (row) {
      var width = (row.value / max) * 100;
      return '' +
        '<div class="author-bar-row">' +
        '  <div class="author-bar-label">' + escapeHtml(row.label) + '</div>' +
        '  <div class="author-bar-track"><div class="author-bar-fill" style="width:' + width + '%"></div></div>' +
        '  <div class="author-bar-value">' + escapeHtml(String(row.value)) + '</div>' +
        '</div>';
    }).join('') + '</div>';
  }

  function renderPieChart(expertise) {
    var items = expertise.items || [];
    return '' +
      '<div class="author-pie-wrap">' +
      '  <div class="author-pie" style="background:' + buildPieGradient(items) + '"></div>' +
      '  <div class="author-pie-legend">' + items.map(function (item, index) {
        return '' +
          '<div class="author-pie-legend-item">' +
          '  <span class="author-pie-swatch" style="background:' + PIE_COLORS[index % PIE_COLORS.length] + '"></span>' +
          '  <span class="author-pie-label">' + escapeHtml(item.label) + '</span>' +
          '  <span class="author-pie-value">' + escapeHtml(String(item.value)) + '%</span>' +
          '</div>';
      }).join('') + '</div>' +
      '</div>' +
      '<p class="author-note">' + escapeHtml(expertise.note || '') + '</p>';
  }

  function renderPaperList(list) {
    if (!list.length) return '<p class="author-empty">No papers in this category yet.</p>';

    return '<div class="author-paper-group">' + list.map(function (pub) {
      var authorLine = (pub.fullAuthors && pub.fullAuthors.length) ? pub.fullAuthors.join(', ') : pub.authors;
      var labLine = (pub.labMemberAuthors && pub.labMemberAuthors.length) ? '<div class="author-paper-meta">Lab members: ' + escapeHtml(pub.labMemberAuthors.join(', ')) + '</div>' : '';
      return '' +
        '<article class="author-paper-card">' +
        '  <div class="author-paper-meta">' + escapeHtml(pub.year) + ' · ' + escapeHtml(pub.journal) + '</div>' +
        '  <h3 class="author-paper-title">' + escapeHtml(pub.title) + '</h3>' +
        '  <div class="author-paper-meta">' + escapeHtml(authorLine) + '</div>' +
        labLine +
        '  <a class="author-paper-link" href="' + escapeHtml(pub.link) + '" target="_blank" rel="noopener noreferrer">View publication ↗</a>' +
        '</article>';
    }).join('') + '</div>';
  }

  function renderAuthorPage(author, papers, expertise, mount) {
    var totalPapers = papers.firstAuthor.length + papers.coAuthor.length;

    mount.innerHTML = '' +
      '<a class="author-back-link" href="publications.html"><span class="icon solid fa-arrow-left"></span><span>Back to Publications</span></a>' +
      '<div class="author-hero">' +
      '  <img class="author-hero-image" src="' + escapeHtml(author.image || 'images/rz.png') + '" alt="' + escapeHtml(author.fullName || author.name) + '">' +
      '  <div class="author-hero-copy">' +
      '    <h1 class="author-name">' + escapeHtml(author.fullName || author.name) + '</h1>' +
      '    <p class="author-role">' + escapeHtml(author.role || 'Author') + '</p>' +
      (author.affiliation ? '<p class="author-affiliation">' + escapeHtml(author.affiliation) + '</p>' : '') +
      '    <p class="author-bio">' + escapeHtml(author.bio || '') + '</p>' +
      '    <div class="author-links">' + renderLinks(author) + '</div>' +
      '  </div>' +
      '</div>' +
      '<div class="author-stats-grid">' +
      '  <div class="author-stat-card"><span class="author-stat-label">Total papers</span><div class="author-stat-value">' + totalPapers + '</div></div>' +
      '  <div class="author-stat-card"><span class="author-stat-label">First-author</span><div class="author-stat-value">' + papers.firstAuthor.length + '</div></div>' +
      '  <div class="author-stat-card"><span class="author-stat-label">Co-author</span><div class="author-stat-value">' + papers.coAuthor.length + '</div></div>' +
      '</div>' +
      '<p class="author-note">These stats use full author metadata behind the scenes, while the Publications page keeps its abbreviated citation style.</p>' +
      '<div class="author-charts-grid">' +
      '  <section class="author-panel">' +
      '    <h2 class="author-panel-title">Publication role summary</h2>' +
      renderBarChart({ firstAuthor: papers.firstAuthor.length, coAuthor: papers.coAuthor.length }) +
      '  </section>' +
      '  <section class="author-panel">' +
      '    <h2 class="author-panel-title">Top 5 research expertise</h2>' +
      renderPieChart(expertise) +
      '  </section>' +
      '</div>' +
      '<div class="author-sections-grid">' +
      '  <section class="author-panel">' +
      '    <h2 class="author-panel-title">First-author papers</h2>' +
      renderPaperList(papers.firstAuthor) +
      '  </section>' +
      '  <section class="author-panel">' +
      '    <h2 class="author-panel-title">Co-author papers</h2>' +
      renderPaperList(papers.coAuthor) +
      '  </section>' +
      '</div>';
  }

  function computeAuthorPapers(authorEntry, publications) {
    var firstAuthor = [];
    var coAuthor = [];
    var citationNames = (authorEntry.publicationNames || []).map(normalizeCitationName);
    var fullNames = (authorEntry.fullNameVariants || []).map(normalizeCitationName);
    var memberName = normalizeCitationName(authorEntry.memberName || '');

    publications.forEach(function (pub) {
      var citation = normalizeCitationName(pub.authors || '');
      var fullAuthors = (pub.fullAuthors || []).map(normalizeCitationName);
      var labMembers = (pub.labMemberAuthors || []).map(normalizeCitationName);

      var isFirstAuthor = (citationNames.length && citationNames.some(function (name) {
        return citation.indexOf(name) === 0;
      })) || (fullNames.length && fullAuthors.length && fullNames.indexOf(fullAuthors[0]) !== -1);

      if (isFirstAuthor) {
        firstAuthor.push(pub);
        return;
      }

      var appearsAsFullAuthor = fullNames.some(function (name) {
        return fullAuthors.indexOf(name) !== -1;
      });
      var appearsAsLabMember = memberName && labMembers.indexOf(memberName) !== -1;
      var appearsInCitation = citationNames.some(function (name) {
        return citation.indexOf(name) !== -1;
      });

      if (appearsAsFullAuthor || appearsAsLabMember || appearsInCitation) {
        coAuthor.push(pub);
      }
    });

    return { firstAuthor: firstAuthor, coAuthor: coAuthor };
  }

  async function loadAuthorPage() {
    var mount = document.getElementById('author-profile-root');
    if (!mount) return;

    var authorId = getQueryParam('author');
    if (!authorId) {
      mount.innerHTML = '<p class="author-empty">No author selected.</p>';
      return;
    }

    try {
      var results = await Promise.all([
        fetch('assets/data/members.json').then(function (res) { return res.json(); }),
        fetch('assets/data/publications.json').then(function (res) { return res.json(); }),
        fetch('assets/data/author-expertise.json').then(function (res) { return res.json(); }).catch(function () { return {}; }),
        fetch('assets/data/authors.json').then(function (res) { return res.json(); }).catch(function () { return { authors: [] }; })
      ]);

      var members = flattenMembers(results[0]);
      var publications = results[1].publications || [];
      var expertiseData = results[2] || {};
      var authorRegistry = results[3].authors || [];

      var memberLookup = buildMemberLookup(members);
      var authorLookup = buildAuthorRegistryLookup(authorRegistry);
      var authorEntry = authorLookup[authorId] || authorLookup['pub:' + normalizeCitationName(authorId)] || authorLookup['full:' + normalizeCitationName(authorId)] || {
        id: authorId,
        displayName: authorId.replace(/-/g, ' '),
        publicationNames: [authorId],
        memberName: ''
      };

      var author = (authorEntry.memberName && memberLookup[authorEntry.memberName]) || memberLookup[authorId] || buildFallbackAuthorProfile(authorEntry);
      author.slug = authorEntry.id || author.slug;
      author.fullName = author.fullName || authorEntry.displayName;
      author.name = author.name || authorEntry.displayName;

      if ((!authorEntry.fullNameVariants || !authorEntry.fullNameVariants.length) && author.fullName) {
        authorEntry.fullNameVariants = [author.fullName.replace(/,?\s*PhD/gi, '').trim()];
      }
      if (!authorEntry.memberName && author.fullName) {
        authorEntry.memberName = author.fullName;
      }

      var papers = computeAuthorPapers(authorEntry, publications);
      var expertise = summarizeExpertise(author, expertiseData);

      renderAuthorPage(author, papers, expertise, mount);
    } catch (err) {
      console.error('Author profile load error:', err);
      mount.innerHTML = '<p class="author-empty">Could not load the author profile.</p>';
    }
  }

  document.addEventListener('DOMContentLoaded', loadAuthorPage);
})();
