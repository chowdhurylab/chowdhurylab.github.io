# Stats view

UI-only update to the September 20 snapshot. No manifest, data shards,
download files, record values or review decisions change.

## Follow-up polish

- Navigation is Browse, Guide, Paper, ChowdhuryLab, Stats.
- Search appears only on Browse. Stats and Guide keep navigation and downloads.
- Independent chart columns remove shared-row whitespace. Percentages use
  aligned 0-100% axes; the middle tick is hidden on narrow screens.
- Short labels and optional examples replace the longer explanations. The
  identity-only limitation and overlapping counts remain explicit.
- The Guide starts with three plain tasks and a real laccase/EC search example,
  without numbered circles or a redundant workflow diagram.
- Independent source review passed after fixing an overstatement about prior
  paper checks and centering the middle axis tick.
- Chrome visual checks covered desktop, 820, 390 and 320 px widths; confirmed
  single-line navigation at 320 px, no chart overflow, access to the final
  Stats section, Browse search retention and full-snapshot Stats counts.
- Actual Safari rendered Stats and Guide, and navigation between them worked.
  This does not resolve or re-test the earlier unrelated Filters automation
  uncertainty described below.

- `#stats` has four labelled bar-chart sections: review outcomes, saved
  source material, fields in the full download, and database links.
- All denominators are the manifest's 156,431 records, independent of Browse
  filters. Exact counts remain visible; tiny nonzero shares show `<0.1%`.
- Accepted is Verified + Corrected (16,677), with the 175 identity-only
  records explicitly noted. No missing-field count is presented as a count
  of pending-review reasons.
- Sequence fields are counted separately and may overlap. Database link
  counts may overlap too. The source-material groups are mutually exclusive.
- Browse retains the compact summary, 25-row default, search and downloads.
  Its former expanding review panel is replaced by a link to Stats.

Validation:

- Focused JavaScript viewer behavior checks passed, including Stats before
  index loading, filter invariance, zero totals, unknown review outcomes,
  invalid coverage, tiny percentages, escaping, navigation and heading focus.
- Fifteen focused Python alias and source-value layout tests passed.
- Independent read-only source review found no material issue; it did not
  independently execute runtime tests.
- Actual Chrome checks covered 320, 390, 820 and 1190 px widths and the native
  desktop viewport. Stats has one scrolling surface, no horizontal overflow
  or chart-row overflow at those widths. Browse search, empty results,
  navigation/back, filters and keyboard record details were exercised.
- Actual Safari rendered Stats and returned to Browse correctly. The earlier
  automated Filters issue remains unresolved: the page becomes inert without
  showing the drawer. This behavior is unchanged by this UI update, and has
  not been distinguished from the native background-window automation issue.
  Do not describe Safari as fully cleared.

Future snapshot exports must preserve the site's current viewer HTML, CSS and
JavaScript together. Regenerate `tools/catlog-latest.html` with the existing
synchronizer after replacing the canonical page. Do not restore the removed
Browse breakdown from an older standalone-export template.
