"""Unmocked public-site checks on disposable Chrome and macOS Safari runners."""

import argparse
import csv
import functools
import hashlib
from html.parser import HTMLParser
import http.server
import json
import math
import os
from pathlib import Path
import re
import threading
import time
import urllib.request
from urllib.parse import parse_qsl, quote, unquote_plus, urlencode, urljoin, urlsplit, urlunsplit

from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.actions.action_builder import ActionBuilder
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.common.exceptions import StaleElementReferenceException, TimeoutException
from selenium.webdriver.support.ui import WebDriverWait


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "browser-checks"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class AssetReferences(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        value = attrs.get("src") if tag == "script" else attrs.get("href") if tag == "link" else None
        if value and ("data/manifest." in value or "assets/catlog-static." in value):
            self.paths.append(value)


def cache_tagged(url, release):
    parts = urlsplit(url)
    query = [(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True) if key != "nocache"]
    return urlunsplit(parts._replace(query=urlencode([*query, ("nocache", release)])))


def check_browse_assets(driver, url):
    """Bind the served route and its three release assets to this checkout."""
    page_path = ROOT / urlsplit(url).path.lstrip("/")
    if urlsplit(url).path.endswith("/"):
        page_path /= "index.html"
    release = os.environ.get("GITHUB_SHA", "local-browser-check")[:12]

    def bound_bytes(asset_url, path):
        expected_bytes = path.read_bytes()
        request = urllib.request.Request(cache_tagged(asset_url, release), headers={"Cache-Control": "no-cache"})
        with urllib.request.urlopen(request, timeout=30) as response:
            actual = response.read(len(expected_bytes) + 1)
        assert len(actual) == len(expected_bytes) and hashlib.sha256(actual).digest() == hashlib.sha256(expected_bytes).digest(), f"Release bytes differ: {asset_url}"
        return expected_bytes

    page_bytes = bound_bytes(url, page_path)
    assets = AssetReferences()
    assets.feed(page_bytes.decode("utf-8"))
    assert len(assets.paths) == 3, "Expected exactly the manifest, stylesheet and application script"
    loaded_urls = driver.execute_script("return [...document.querySelectorAll('script[src], link[href]')].map(e => e.src || e.href)")
    hashes = {"page": hashlib.sha256(page_bytes).hexdigest()}
    expected_manifest = None
    for reference in assets.paths:
        asset_url = urljoin(url, reference)
        assert asset_url in loaded_urls, f"Page loaded a different release asset: {reference}"
        asset_bytes = bound_bytes(asset_url, ROOT / urlsplit(asset_url).path.lstrip("/"))
        expected_sha256 = hashlib.sha256(asset_bytes).hexdigest()
        # Check the browser's same-URL cached bytes too, not only a separate
        # cache-busted HTTP request made by the test runner.
        browser_bytes = driver.execute_async_script("""
            const done = arguments[arguments.length - 1];
            fetch(arguments[0], {cache: 'force-cache'}).then(async response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const bytes = await response.arrayBuffer();
                const digest = await crypto.subtle.digest('SHA-256', bytes);
                done({size: bytes.byteLength,
                    sha256: [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('')});
            }).catch(error => done({error: String(error)}));
        """, asset_url)
        assert browser_bytes == {"size": len(asset_bytes), "sha256": expected_sha256}, f"Browser asset bytes differ: {reference}"
        hashes[urlsplit(asset_url).path] = expected_sha256
        if "data/manifest." in reference:
            expected_manifest, _end = json.JSONDecoder().raw_decode(
                asset_bytes.decode("utf-8").split("=", 1)[1].lstrip()
            )
    assert expected_manifest is not None
    assert driver.execute_script("return window.CATLOG_STATIC_MANIFEST") == expected_manifest
    return expected_manifest, hashes


def set_browse_viewport(driver, browser, width, height):
    if browser == "chrome":
        # A phone width is emulated as a phone (overlay scrollbars, as every other phone check here does): in desktop mode
        # Browse, which scrolls as a whole page on phones, gets a 15px classic scrollbar no phone has, and at 320px that
        # left the Sort menu 104px instead of 119px.
        driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {
            "width": width, "height": height, "deviceScaleFactor": 1, "mobile": width < 640,
        })
        driver.execute_cdp_cmd("Emulation.setTouchEmulationEnabled", {"enabled": width == 390})
    else:
        driver.set_window_size(width, height)
        inner = driver.execute_script("return {width: innerWidth, height: innerHeight}")
        driver.set_window_size(width + width - inner["width"], height + height - inner["height"])
    assert driver.execute_script("return [innerWidth, innerHeight]") == [width, height], "Requested viewport is not the actual viewport"


# (round 17, the user: the words first: Records and values, with the labels; then how CatLog works, a record's parts, the
# other marks and the cautions and what to mind; the Reference's folded parts; License and citation, said once, which
# Browse's footer line links to)
GUIDE_SECTIONS = ("guide-words", "guide-method", "guide-record", "guide-marks", "guide-caveats", "guide-find", "guide-units",
                  "guide-downloads", "guide-licence", "guide-questions")
# (the folded parts: the Reference's three, the cautions and evidence labels under Marks and cautions, and More on citing and
# the sources' licenses under License and citation)
GUIDE_REFERENCE = ("guide-find", "guide-units", "guide-downloads", "guide-cautions", "guide-evidence", "guide-cite", "guide-sources")


# The Guide's pictures (round 13, the user: "visuals help more"; round 14: no icons): the four steps side by side on a
# desktop and one under another below 900px, the numbered record beside its key (under it below 900px) with as many numbers as parts and
# key lines, the legend groups, all inside the view; a list of what is wrong, empty when all is right.
GUIDE_PICTURES_JS = """
    const bad = [];
    const view = document.getElementById('guideView').getBoundingClientRect();
    const wide = innerWidth >= 900;
    const steps = [...document.querySelectorAll('#guide-how-read .guide-flow-step')].map(step => step.getBoundingClientRect());
    if (steps.length !== 4) bad.push(`steps: ${steps.length}`);
    steps.forEach((box, index) => {
      if (box.left < view.left - 1 || box.right > view.right + 1) bad.push(`step ${index + 1} outside`);
      if (index && wide && Math.abs(box.top - steps[0].top) > 1) bad.push(`step ${index + 1} not in the row`);
      if (index && !wide && box.top < steps[index - 1].bottom) bad.push(`step ${index + 1} not under step ${index}`);
    });
    const parts = [...document.querySelectorAll('.guide-anatomy-card > .guide-anatomy-part')].filter(part => part.getClientRects().length);
    const keys = [...document.querySelectorAll('.guide-anatomy-key li')].filter(item => item.getClientRects().length);
    if (!parts.length || parts.length !== keys.length) bad.push(`parts ${parts.length}, key lines ${keys.length}`);
    // (the numbers are CSS counters of the shown parts and key lines, so equal counts give the same numbers)
    if (parts.some(part => !part.querySelector('.guide-pin')?.getBoundingClientRect().width)) bad.push('a part without its number');
    const card = document.querySelector('.guide-anatomy-card').getBoundingClientRect();
    const key = document.querySelector('.guide-anatomy-key').getBoundingClientRect();
    if (wide ? key.left < card.right : key.top < card.bottom) bad.push('the key overlaps the record');
    for (const element of document.querySelectorAll('.guide-anatomy-card, .guide-anatomy-key, .guide-legend-group, .guide-unit-cards li, .guide-db-table, .guide-caution-table, .guide-row, .guide-row > *')) {
      const box = element.getBoundingClientRect();
      if (box.width && (box.left < view.left - 1 || box.right > view.right + 1)) bad.push(`${element.className} outside`);
    }
    // Records and values (round 17): the bracket "3 values" spans exactly the three value cells and "1 record" the whole
    // row, under its cells; on a desktop the row is one line of cells, under 900px a card with the three values side by side.
    const at = (selector) => document.querySelector(`.guide-row ${selector}`).getBoundingClientRect();
    const [kcat, km, eff, values, record, enzyme, result] = ['.gr-kcat', '.gr-km', '.gr-eff', '.gr-values-span', '.gr-record-span', '.gr-enzyme', '.gr-result'].map(at);
    if (Math.abs(values.left - kcat.left) > 1 || Math.abs(values.right - eff.right) > 1 || values.bottom > kcat.top) bad.push('3 values does not span the values');
    if (Math.abs(km.top - kcat.top) > 1 || Math.abs(eff.top - kcat.top) > 1) bad.push('the values are not side by side');
    if (record.top < Math.max(kcat.bottom, enzyme.bottom, result.bottom) - 1) bad.push('1 record is not under the row');
    if (Math.abs(record.left - document.querySelector('.guide-row').getBoundingClientRect().left) > 1) bad.push('1 record does not span the row');
    if (wide && (Math.abs(enzyme.top - kcat.top) > 1 || Math.abs(result.top - kcat.top) > 1)) bad.push('the row is not one line');
    return bad;
"""


# A Guide section a link opened: its top just under the view's top, or, where the page ends too soon for that, the view
# scrolled to its end with the section's top in sight.
GUIDE_AT_SECTION_JS = """
    const view = document.querySelector('#guideView');
    const box = view.getBoundingClientRect();
    const top = document.getElementById(arguments[0]).getBoundingClientRect().top;
    const atEnd = view.scrollTop + view.clientHeight >= view.scrollHeight - 2;
    return top >= box.top - 1 && (top <= box.top + 48 || (atEnd && top < box.bottom - 48));
"""


def assert_document_stays(driver, view):
    """Stats, the Guide and Team scroll inside their own view under a header that stays put: the document itself never
    scrolls (hidden screen-reader text placed against the page once made it ~4,000px tall and scrolled the header away)."""
    state = driver.execute_script("const page = document.scrollingElement; return [page.scrollHeight, page.clientHeight]")
    assert state[0] <= state[1] + 1, f"{view} makes the whole document scroll: {state}"


def guide_heading_text(driver):
    return " ".join(driver.find_element(By.CSS_SELECTOR, "#guideView .guide-heading").get_attribute("innerText").split())


def check_guide(driver, wait):
    """Guide: the contents list reaches every section, a section's link keeps the Guide open at that section, the
    example views use the #browse? links Browse reads, and human-checked is drawn as in the table."""
    # Compared with databases has a section of its own (and a line in the contents) when the snapshot carries the
    # comparison: the manifest's summary, or the record index's field.
    sections = list(GUIDE_SECTIONS)
    if driver.execute_script("""const m = window.CATLOG_STATIC_MANIFEST;
        return Boolean(m?.summary?.database_comparison) || (m?.viewer_index?.optional_fields || []).includes('database_summary')"""):
        sections.insert(sections.index("guide-marks") + 1, "guide-databases")
    links = [link for link in driver.find_elements(By.CSS_SELECTOR, ".guide-contents a") if link.is_displayed()]
    assert [urlsplit(link.get_attribute("href")).fragment for link in links] == sections
    for section in sections:
        assert driver.find_element(By.ID, section).is_displayed(), f"Guide section {section} is not shown"
    examples = [urlsplit(link.get_attribute("href")).fragment
                for link in driver.find_elements(By.CSS_SELECTOR, "#guide-find .guide-link-list a")]
    assert "browse?checked=1" in examples and all(fragment.startswith("browse?") for fragment in examples)
    # The method is said once, in full, in its own section; the from-paper tag points to it.
    method = driver.find_element(By.ID, "guide-method").text
    assert "Claude, Anthropic" in method and "A second, separate AI check compares every value with the paper." in method
    assert driver.find_elements(By.CSS_SELECTOR, '#guide-method a[href="#team"], #guide-method a[href$="catlog-latest.html#team"]'), \
        "The method section links to the Team page"
    assert driver.find_elements(By.CSS_SELECTOR, '#guide-status a[href="#guide-method"]'), "The from-paper tag links to the method"
    # (round 17) The words come first: record, value and paper beside one record whose three values are bracketed, and the
    # labels it carries (#guide-status) inside the same section.
    words = driver.find_element(By.ID, "guide-words")
    assert [term.text for term in words.find_elements(By.CSS_SELECTOR, ".guide-words-list dt")] == ["Record", "Value", "Paper"]
    assert driver.execute_script("return document.getElementById('guide-words').contains(document.getElementById('guide-status'))")
    assert driver.execute_script("return document.querySelector('.guide-section').id") == "guide-words"
    # Compared with databases (Browse's group and the record's section) is described only when the snapshot carries the
    # comparison, as Browse shows the group.
    comparison = driver.execute_script(
        "return (window.CATLOG_STATIC_MANIFEST?.viewer_index?.optional_fields || []).includes('database_summary')")
    database_lines = driver.execute_script(
        "return [...document.querySelectorAll('#guideView [data-guide-databases]')].map(e => e.getClientRects().length > 0)")
    assert len(database_lines) >= 2 and all(shown == comparison for shown in database_lines), (comparison, database_lines)
    # How CatLog reads a value (#guide-how-read, the record's link to it): the four steps (round 14: read, check, compare,
    # review), their numbers drawn by CSS.
    steps = driver.execute_script("return [...document.querySelectorAll('#guide-how-read .guide-flow-name')].map(e => e.textContent)")
    assert steps == ["Read", "Check", "Compare", "Review"], steps
    # The earlier version and its automated review, which a record not yet re-read links (#guide-earlier, round 14),
    # under the four steps, with its own heading.
    earlier = driver.find_element(By.ID, "guide-earlier")
    assert earlier.is_displayed() and "earlier version built them from the enzyme databases" in earlier.text, earlier.text
    assert driver.execute_script("return document.getElementById('guide-method').contains(document.getElementById('guide-earlier'))")
    # (fix pass after round 16b: CatLog also reads papers no database cites, found by a literature search)
    assert "CatLog reads enzyme kinetics" in guide_heading_text(driver) and "from the original papers, mostly those the enzyme databases cite" in guide_heading_text(driver)
    assert driver.execute_script(GUIDE_PICTURES_JS) == [], driver.execute_script(GUIDE_PICTURES_JS)
    # Round 15 polish: the Guide sits in Stats' and Team's container (a view's title keeps its place when the tabs change),
    # and no paragraph outside a table runs past 68 characters of its own size.
    measure = driver.execute_script("""
        const shell = document.querySelector('#guideView .guide-shell');
        const box = e => { const style = getComputedStyle(e); return [style.maxWidth, style.boxSizing, style.paddingLeft, style.marginLeft === style.marginRight]; };
        // (68ch of the paragraph's own font: its max-width, which every paragraph outside a table has)
        const wide = [...shell.querySelectorAll('p')].filter(p => !p.closest('table') && p.getClientRects().length
            && (getComputedStyle(p).maxWidth === 'none' || p.getBoundingClientRect().width > 0.7 * 68 * parseFloat(getComputedStyle(p).fontSize) + 1))
            .map(p => p.textContent.trim().slice(0, 50));
        return {guide: box(shell), stats: box(document.querySelector('.stats-shell')), team: box(document.querySelector('.team-shell')), wide,
                desktop: innerWidth >= 1024};
    """)
    assert (not measure["desktop"] or measure["guide"] == measure["stats"] == measure["team"]) and not measure["wide"], measure
    # Labels and colours: one term width, so the definitions of the groups in one column start at one x; every
    # disclosure opens with the same muted + (Reference's too).
    slips = driver.execute_script("""
        const lefts = [...document.querySelectorAll('#guideView .guide-legend-group dd')].filter(dd => dd.getClientRects().length)
            .map(dd => [Math.round(dd.closest('.guide-legend-group').getBoundingClientRect().left), Math.round(dd.getBoundingClientRect().left)]);
        const columns = {};
        lefts.forEach(([group, dd]) => { (columns[group] = columns[group] || new Set()).add(dd); });
        const plus = [...document.querySelectorAll('#guideView :is(.guide-ref, .guide-details) > summary')]
            .filter(s => s.getClientRects().length).map(s => getComputedStyle(s, '::before').color);
        return {columns: Object.values(columns).map(set => [...set]), plus: [...new Set(plus)]};
    """)
    assert all(len(column) == 1 for column in slips["columns"]) and len(slips["plus"]) == 1, slips
    guide_text = driver.find_element(By.ID, "guideView").text
    for word in ("independent", "AI run", "Checks pending", "Exporter", "exporter", *DROPPED_WORDING):
        assert word not in guide_text, f"The Guide still says {word}"
    # (round 17: the site's counting words are value, record and paper; a UniProt entry is UniProt's own word)
    assert not re.search(r"\b(?:entry|entries|measurements?|slots?)\b", guide_text.replace("UniProt entry", ""), re.I), \
        re.findall(r".{0,40}\b(?:entry|entries|measurements?|slots?)\b.{0,40}", guide_text.replace("UniProt entry", ""), re.I)
    # Cite: the downloads save under the snapshot's date, and the Data ID check names that file.
    day = driver.execute_script("return new Date(window.CATLOG_STATIC_MANIFEST.generated_at).toISOString().slice(0, 10)")
    for identifier, part in (("guideFullDataLink", "full"), ("enrichedDataButton", "full"), ("exportSnapshotButton", "table")):
        assert driver.find_element(By.ID, identifier).get_attribute("download") == f"catlog-{day}-{part}.jsonl.gz", identifier
    # The Reference's parts fold, closed at first (round 13: a short Guide); the checks below read them open.
    assert driver.execute_script("return arguments[0].map(id => document.getElementById(id)).every(e => e.tagName === 'DETAILS' && !e.open)",
                                 list(GUIDE_REFERENCE)), "The Reference's parts start closed"
    driver.execute_script("arguments[0].forEach(id => { document.getElementById(id).open = true; })", list(GUIDE_REFERENCE))
    # The comparison with the databases as a file: the Guide's Downloads item and link show only with the manifest's
    # database_comparison_download, named after the snapshot's date like the other downloads.
    comparison_download = driver.execute_script("return window.CATLOG_STATIC_MANIFEST.database_comparison_download?.path || null")
    comparison_item = driver.find_element(By.ID, "guideComparisonDownload")
    assert comparison_item.is_displayed() == bool(comparison_download), comparison_download
    if comparison_download:
        link = driver.find_element(By.ID, "guideComparisonLink")
        assert link.get_attribute("download") == f"catlog-{day}-database-comparison.csv.gz"
        assert link.get_attribute("href").endswith(comparison_download), link.get_attribute("href")
    assert driver.find_element(By.ID, "guideDataIdFile").get_attribute("textContent") == f"catlog-{day}-full.jsonl.gz"
    # Sources and licenses: the records read by CatLog have the count Browse and Stats give them, with CatLog's licence;
    # the earlier paper extractions are a row of their own.
    from_paper = driver.execute_script("return window.CATLOG_STATIC_MANIFEST?.summary?.overview?.from_paper?.records ?? null")
    source_rows = driver.execute_script("""
        return Object.fromEntries([...document.querySelectorAll('#guideSourceList > div')]
            .map(row => [row.querySelector('dt').textContent.trim(), row.querySelector('dd').textContent.trim()]));
    """)
    if isinstance(from_paper, int):
        assert f"{from_paper:,} records" in source_rows.get("Read from the paper", ""), source_rows
        assert "CC BY 4.0" in source_rows["Read from the paper"]
        if "Earlier paper extractions" in source_rows:
            assert "as published (see paper)" in source_rows["Earlier paper extractions"]
    # Every database's license is said one way under "Sources and their licenses" (round 17: the section names it, so no
    # "License:" before each), a database without one "See the source's terms".
    for name, text in source_rows.items():
        if name != "Read from the paper":
            assert text and not text.startswith("License") and text[0].isupper(), (name, text)
    tag = driver.find_element(By.CSS_SELECTOR, "#guide-status .state-tag.human-checked")
    assert tag.find_elements(By.CSS_SELECTOR, "svg.check-icon") and tag.text.strip() == "human-checked"
    assert driver.execute_script("""
        const checked = getComputedStyle(arguments[0]).color;
        return [...document.querySelectorAll('#guide-status .state-tag:not(.human-checked)')]
            .every(other => getComputedStyle(other).color !== checked);
    """, tag), "human-checked needs its own colour"
    driver.execute_script("arguments[0].forEach(id => { document.getElementById(id).open = false; })", list(GUIDE_REFERENCE))
    links[sections.index("guide-units")].click()
    wait.until(lambda d: urlsplit(d.current_url).fragment == "guide-units")
    # A link to a folded part opens it.
    assert driver.execute_script("return document.getElementById('guide-units').open"), "The contents' link opens Units"
    # The section's heading takes focus, so the next Tab goes on from the section.
    wait.until(lambda d: d.execute_script("return document.activeElement?.id") == "guide-units-title")
    assert driver.find_element(By.ID, "guideView").is_displayed()
    assert not driver.find_element(By.ID, "catalogView").is_displayed()
    # (round 14: a short Guide can end before Units reaches the top of a tall window; then the view is scrolled to its end
    # with Units in sight)
    wait.until(lambda d: d.execute_script(GUIDE_AT_SECTION_JS, "guide-units"))
    assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth + 1"), "Guide overflows sideways"
    assert_document_stays(driver, "Guide")
    # How CatLog reads a value (#guide-how-read, which a record links to): a link to it opens the Guide there with focus
    # on its heading, as a section's link does.
    driver.execute_script("""const link = document.createElement('a'); link.id = 'howReadProbe'; link.href = '#guide-how-read';
        link.textContent = 'How CatLog reads a value'; document.getElementById('guide-units').append(link);""")
    driver.execute_script("document.getElementById('howReadProbe').click()")
    wait.until(lambda d: urlsplit(d.current_url).fragment == "guide-how-read")
    wait.until(lambda d: d.execute_script("return document.activeElement?.id") == "guide-how-read-title")
    wait.until(lambda d: d.execute_script("""
        const view = document.querySelector('#guideView').getBoundingClientRect();
        const top = document.querySelector('#guide-how-read').getBoundingClientRect().top;
        return top >= view.top - 1 && top <= view.top + 48;
    """))
    driver.execute_script("document.getElementById('howReadProbe').remove()")


# (in Figure 7's order, as the sidebar since round 14's fix pass: one order everywhere)
GUIDE_DB_RESULTS = ("All values the same", "Same, other label", "Corrects a value", "Different number", "Not in the databases",
                    "Corrected earlier")
# (round 14: the results as one table; what is compared and the three small tables in one disclosure, headed by its h3)
GUIDE_DB_HEADINGS = ["Results", "How the comparison works"]
# Each row of a Guide table: its name left of its numbers, never under or over them, all inside the view.
GUIDE_DB_ROWS_CLEAR = """
    const bad = [];
    const view = document.getElementById('guideView').getBoundingClientRect();
    for (const row of document.querySelectorAll('#guideDatabasesBody .guide-db-table tbody tr')) {
      const th = row.querySelector(':scope > th').getBoundingClientRect();
      for (const td of row.querySelectorAll(':scope > td')) {
        const box = td.getBoundingClientRect();
        if (box.left < th.right - 1 || Math.abs(box.top - th.top) > th.height) bad.push(row.querySelector('th').innerText.trim());
        if (box.right > view.right + 1) bad.push('outside: ' + row.querySelector('th').innerText.trim());
      }
      if (th.right > view.right + 1) bad.push('outside: ' + row.querySelector('th').innerText.trim());
    }
    return bad;
"""


def check_guide_databases(driver, browser, url):
    """The Guide's Compared with databases (#guide-databases), from the manifest only: shown with its line in the contents
    when the snapshot carries the comparison (hidden otherwise); the six results in Browse's order as one table, each
    after the square of its colour (none on Corrected earlier) with the values and records Browse's options give; the
    causes, how a correction is found and why no database lists a value in one disclosure; no sideways scroll at 375 and
    320px; and a records count opens Browse at those records."""
    wait = WebDriverWait(driver, 120, ignored_exceptions=(StaleElementReferenceException,))
    set_browse_viewport(driver, browser, 1440, 1000)
    driver.get("about:blank")
    driver.get(url + "#guide-databases")
    wait.until(lambda d: d.find_element(By.ID, "guideView").is_displayed())
    manifest = driver.execute_script("return window.CATLOG_STATIC_MANIFEST")
    comparison = (manifest.get("summary") or {}).get("database_comparison")
    indexed = "database_summary" in ((manifest.get("viewer_index") or {}).get("optional_fields") or [])
    section = driver.find_element(By.ID, "guide-databases")
    contents = driver.find_element(By.CSS_SELECTOR, '.guide-contents a[href="#guide-databases"]')
    # (the question's answer sits in a closed disclosure: its line is read by its own hidden attribute)
    question = driver.execute_script(
        "return !document.querySelector('#guide-questions a[href=\"#guide-databases\"]').closest('[data-guide-database-section]').hidden")
    if not comparison and not indexed:
        assert not section.is_displayed() and not contents.is_displayed() and not question
        return {"route": "guide-databases", "passed": True, "shown": False}
    assert section.is_displayed() and contents.is_displayed() and question
    assert not driver.execute_script(
        "return performance.getEntriesByType('resource').some(e => /catlog-viewer-index|catlog-table|details-\\d+/.test(e.name))"
    ), "The Guide must not download the record index or detail shards"
    # The address opens the Guide at the section.
    wait.until(lambda d: d.execute_script("""
        const view = document.querySelector('#guideView').getBoundingClientRect();
        const top = document.querySelector('#guide-databases').getBoundingClientRect().top;
        return top >= view.top - 1 && top <= view.top + 48;
    """))
    body = driver.find_element(By.ID, "guideDatabasesBody")
    headings = [heading.text.strip() for heading in body.find_elements(By.CSS_SELECTOR, "h3")]
    assert headings == GUIDE_DB_HEADINGS, headings
    # (a row under its parent, .guide-db-nested, narrows it: every value, an exact factor not yet checked)
    all_rows = driver.execute_script("""
        return [...document.querySelectorAll('#guideDatabasesBody .guide-db-results tbody tr')].map(row => ({
          key: row.dataset.key,
          nested: row.classList.contains('guide-db-nested'),
          label: row.querySelector('.guide-db-result > span:not(.guide-db-mark), .guide-db-sub').innerText.trim(),
          cells: [...row.querySelectorAll('td')].map(td => td.innerText.trim()),
          mark: (() => { const mark = row.querySelector('.guide-db-mark'); if (!mark) return null; const box = mark.getBoundingClientRect();
            return [mark.dataset.result || '', getComputedStyle(mark).backgroundColor, Math.round(box.width), Math.round(box.height)]; })(),
        }));
    """)
    rows = [row for row in all_rows if not row["nested"]]
    labels = [row["label"] for row in rows]
    assert labels in (list(GUIDE_DB_RESULTS), list(GUIDE_DB_RESULTS[:-1])), labels
    marks = [row["mark"] for row in rows]
    assert [mark[0] for mark in marks[:5]] == ["same", "other_label", "corrects", "differs", "not_listed"], marks
    assert all(mark and mark[2:] == [10, 10] for mark in marks), marks
    assert len({mark[1] for mark in marks[:5]}) == 5 and all(mark[1] not in ("rgba(0, 0, 0, 0)", "transparent") for mark in marks[:5]), marks
    if len(marks) == 6:
        assert marks[5][0] == "" and marks[5][1] in ("rgba(0, 0, 0, 0)", "transparent"), marks[5]
    words = lambda count, one, many: f"{count:,} {one if count == 1 else many}"
    result = {"route": "guide-databases", "passed": True, "shown": True}
    if comparison:
        text = body.get_attribute("innerText").strip()
        values = (comparison.get("values") or {}).get("all") or {}
        kinds = comparison.get("records_with_kind") or {}
        records = comparison.get("records") or {}
        compared = sum(count for key, count in values.items() if key != "not_compared")
        # One paper count per set: the papers with a compared value (papers_compared), as Stats' lead names them.
        lead_papers = comparison.get("papers_compared", comparison.get("papers"))
        assert f"This snapshot compares {words(compared, 'value', 'values')} from {words(lead_papers, 'paper', 'papers')}." in text, text[:400]
        counts = {row["label"]: row["cells"] for row in rows}
        # An exact factor nothing has yet checked against the paper is Different number, never a correction: a
        # comparison that counts such values among its corrections (by_cause_found_by[cause].factor_only) has them
        # moved in the Guide's words, and the line under Different number counts them.
        found_by = (comparison.get("corrections") or {}).get("by_cause_found_by") or {}
        factor_only = sum(ways.get("factor_only", 0) for ways in found_by.values() if isinstance(ways, dict)) \
            if "factor_only" not in found_by else sum(found_by["factor_only"].values())
        differs_extra = sum(values.get(key, 0) for key in ("differs_factor_only", "differs_exact_factor"))
        expected = {
            "Corrects a value": [f"{values['corrected'] - factor_only:,}", f"{kinds['corrected']:,}"],
            "Different number": [f"{values['differs'] + factor_only + differs_extra:,}", f"{kinds['differs']:,}"],
            "Same, other label": [f"{values['same_number_other_label']:,}", f"{kinds['other_label']:,}"],
            "Not in the databases": [f"{values['new'] + values.get('new_ratio_only', 0) + values.get('new_paper_not_in_databases', 0):,}", f"{kinds['new']:,}"],
            # (a cell with no count shows the dash: round 15 polish)
            "All values the same": ["—", f"{records['every_value_confirmed']:,}"],
        }
        assert {key: counts[key] for key in expected} == expected, counts
        nested = {row["key"]: row["cells"] for row in all_rows if row["nested"]}
        assert nested.get("all_not_listed") == ["—", f"{records['every_value_new']:,}"], nested
        if factor_only or differs_extra:
            assert nested.get("differs_factor_only") == [f"{factor_only or differs_extra:,}", "—"], nested
        assert "Exact factor only" not in text and "nothing else was checked" not in text, "an exact factor alone is no correction"
        # The databases named in the lead come from the manifest; no hard-coded number of them.
        for name in (comparison.get("values_by_database") or {}):
            assert ("STRENDA DB" if name == "STRENDA" else name) in text.split("\n", 1)[0], (name, text[:300])
        for word in ("five", "v1", "v2", "independent", "claim", "agentic", "blind", "undefined", "NaN"):
            assert not re.search(rf"\b{word}\b", text, re.I), f"The Guide's section says {word}"
        assert "it does not by itself mean a database is wrong." in text
        result["counts"] = counts
    # The disclosures open (a scripted open, as every driver supports), so their rows are measured too.
    driver.execute_script("document.querySelectorAll('#guideDatabasesBody details').forEach(d => { d.open = true; })")
    assert driver.execute_script(GUIDE_DB_ROWS_CLEAR) == [], driver.execute_script(GUIDE_DB_ROWS_CLEAR)
    assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth + 1"), "Guide overflows sideways"
    driver.execute_script("arguments[0].scrollIntoView({block: 'start'})", section)
    driver.save_screenshot(str(OUTPUT / f"{browser}-guide-databases.png"))
    if browser == "chrome":
        try:
            for width, height in ((375, 812), (320, 640)):
                driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": True})
                wait.until(lambda d: d.execute_script("return innerWidth") == width)
                assert driver.execute_script("""
                    const view = document.getElementById('guideView');
                    return document.documentElement.scrollWidth <= innerWidth + 1 && view.scrollWidth <= view.clientWidth + 1;
                """), f"The Guide overflows sideways at {width}px"
                assert driver.execute_script(GUIDE_DB_ROWS_CLEAR) == [], (width, driver.execute_script(GUIDE_DB_ROWS_CLEAR))
                assert driver.execute_script(GUIDE_PICTURES_JS) == [], (width, driver.execute_script(GUIDE_PICTURES_JS))
                driver.execute_script("arguments[0].scrollIntoView({block: 'start'})", section)
                driver.save_screenshot(str(OUTPUT / f"{browser}-guide-databases-{width}.png"))
        finally:
            driver.execute_cdp_cmd("Emulation.clearDeviceMetricsOverride", {})
        set_browse_viewport(driver, browser, 1440, 1000)
    # A records count opens Browse at those records (only where Browse can filter by that result).
    link = body.find_elements(By.CSS_SELECTOR, '.guide-db-results a[href$="#browse?db=corrects"]')
    if indexed and comparison and link:
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", link[0])
        link[0].click()
        wait.until(lambda d: urlsplit(d.current_url).fragment == "browse?db=corrects")
        wait.until(lambda d: d.find_element(By.ID, "catalogView").is_displayed())
        corrected = comparison["records_with_kind"]["corrected"]
        wait.until(lambda d: (d.find_element(By.ID, "activeSummary").text or "").strip() == words(corrected, "record", "records"))
        result["browse_link"] = words(corrected, "record", "records")
    return result


def check_human_checked(driver, url):
    """Human-checked: the counts band links to those records (#browse?checked=1), and every record that link shows
    carries the human-checked tag with its check."""
    wait = WebDriverWait(driver, 120, ignored_exceptions=(StaleElementReferenceException,))
    manifest = driver.execute_script("return window.CATLOG_STATIC_MANIFEST")
    snapshot_count = ((manifest.get("summary") or {}).get("overview") or {}).get("human_checked_accepted")
    link = driver.find_element(By.ID, "humanCheckedLink")
    if not isinstance(snapshot_count, int):
        assert not link.is_displayed(), "Without a snapshot count the Human-checked item stays hidden"
        return None
    assert link.is_displayed() and link.find_elements(By.CSS_SELECTOR, "svg.check-icon")
    assert urlsplit(link.get_attribute("href")).fragment == "browse?checked=1"
    # Once the marks have loaded, the count is the loaded records' own.
    wait.until(lambda d: d.execute_script(
        "return performance.getEntriesByType('resource').some(entry => entry.name.includes('human-review-marks.json'))"))
    driver.execute_script("return new Promise(resolve => setTimeout(resolve, 500))")
    count = driver.find_element(By.ID, "humanCheckedCount").text
    assert count and count.replace(",", "").isdigit() and int(count.replace(",", "")) > 0
    # The search box keeps focus after "Clear search and filters", and an empty search box shows its "Try:" line of
    # examples over the counts band: leave the box first, as a visitor clicking elsewhere would.
    driver.execute_script("document.activeElement && document.activeElement.blur()")
    wait.until(lambda d: "hidden" in (d.find_element(By.ID, "searchSuggestions").get_attribute("class") or "").split())
    link.click()
    wait.until(lambda d: d.find_element(By.ID, "activeSummary").text == f"{count} records")
    rows = driver.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")
    assert rows, "The human-checked link shows no records"
    wait.until(lambda d: all(
        row.find_elements(By.CSS_SELECTOR, ".state-badge .state-tag.human-checked svg.check-icon")
        for row in d.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")))
    assert all(row.find_element(By.CSS_SELECTOR, ".state-label").text == "Accepted" for row in rows)
    # Each badge's title says human-checked's rule (the user, 2026-10-13): every kcat and Km, and the kcat/Km approved
    # too or agreeing with kcat / Km; never "every value".
    titles = driver.execute_script(
        "return [...document.querySelectorAll('#recordsBody tr[data-key] .state-badge')].map(badge => badge.title)")
    rule = "Human-checked: a human reviewer approved every kcat and Km shown"
    assert titles and all(rule in title and "the kcat/Km was approved too or agrees with kcat \u00f7 Km." in title
                          for title in titles), titles[:3]
    assert not any("every value" in title or "earlier catalog" in title for title in titles), titles[:3]
    # A human-checked record that shows no kcat/Km: its Human review line names only the values it shows ("A human
    # reviewer approved the Km shown."), never the rule's kcat/Km. Sorted by kcat/Km, those records come last.
    total = int(count.replace(",", ""))
    # Sorting waits for the whole index (the Sort menu is disabled until then): pick rows only once the page is sorted,
    # or a slower browser (Safari on CI) reorders the page under the test.
    wait.until(lambda d: not d.find_element(By.ID, "sortSelect").get_attribute("disabled"))
    page_hash = f"#browse?checked=1&sort=kcat_over_km&rows=100&page={(total + 99) // 100}"
    driver.execute_script("location.hash = arguments[0]", page_hash)
    # (page 1 also ends "of {count}": wait for the last page, sorted)
    first_on_last = f"{((total + 99) // 100 - 1) * 100 + 1:,}"
    wait.until(lambda d: d.find_element(By.ID, "sortSelect").get_attribute("value") == "kcat_over_km"
               and (lambda label: label.startswith(first_on_last) and label.endswith(f"of {count}"))(
                   d.find_element(By.ID, "pageLabel").get_attribute("innerText").strip()))
    no_ratio = driver.execute_script("""
        return [...document.querySelectorAll('#recordsBody tr[data-key]')]
            .filter(tr => tr.querySelector('td.c-eff .metric-with-note')?.innerText.trim() === '—').map(tr => tr.dataset.key).slice(-3);
    """)
    for key in no_ratio:
        # (Safari redraws the table after the previous record closes: back on the same page, wait for the row, click it.)
        driver.execute_script("if (!document.querySelector(`#recordsBody tr[data-key='${arguments[1]}']`)) location.hash = arguments[0]", page_hash, key)
        # The last rows of a page sit under the sticky pagination bar, where Safari's driver clicks the bar instead: bring
        # the row to the middle first, as the other checks do.
        cell = wait.until(lambda d: d.find_element(By.CSS_SELECTOR, f'#recordsBody tr[data-key="{key}"] td.c-enzyme'))
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", cell)
        wait.until(lambda d: d.find_element(By.CSS_SELECTOR, f'#recordsBody tr[data-key="{key}"] td.c-enzyme').click() is None)
        wait.until(lambda d: d.execute_script(
            "return document.querySelector('#detailContent #detailRecordKey')?.textContent === arguments[0]"
            " && Boolean(document.querySelector('#detailContent .human-review-line dd'))", key))
        line = driver.find_element(By.CSS_SELECTOR, "#detailContent .human-review-line dd").get_attribute("innerText")
        assert "approved every kcat and Km" not in line and "agrees with kcat ÷ Km" not in line, (key, line)
        ActionChains(driver).send_keys(Keys.ESCAPE).perform()
        wait.until(lambda d: not d.execute_script("return document.body.classList.contains('detail-open')"))
    return total


# The search's chip as it reads now ("Search: lipase"), or null.
SEARCH_CHIP_JS = "return document.querySelector('#activeFilters [data-filter-key=\"q\"]')?.textContent.trim() ?? null"


def check_browse(driver, browser, url, route_label):
    """Exercise public Browse, using only rendered rows and generated JSON Blobs."""
    wait = WebDriverWait(driver, 120, ignored_exceptions=(StaleElementReferenceException,))
    try:
        set_browse_viewport(driver, browser, 1440, 1000)
        driver.get(url)
        wait.until(lambda d: d.execute_script("return Boolean(window.CATLOG_STATIC_MANIFEST?.total_rows)"))
        manifest, asset_hashes = check_browse_assets(driver, url)
        total = manifest["total_rows"]
        assert isinstance(total, int) and total > 50
        wait.until(lambda d: d.find_element(By.ID, "activeSummary").text == f"{total:,} records")
        assert urlsplit(driver.current_url).path == urlsplit(url).path
        assert driver.find_element(By.ID, "catalogView").is_displayed()
        assert driver.find_element(By.ID, "browseButton").get_attribute("aria-current") == "page"
    except Exception:
        driver.save_screenshot(str(OUTPUT / f"{browser}-{route_label}-desktop-1440x1000-failure.png"))
        raise

    # Keep the real Blob and object URL, suppress only the anchor's download
    # navigation, and restore both hooks even when an assertion fails.
    driver.execute_script("""
        const original = URL.createObjectURL;
        const downloads = [];
        const captureClick = event => {
            const anchor = event.target.closest?.('a[download]');
            const captured = anchor && downloads.find(item => item.url === anchor.href);
            if (captured) {
                captured.filename = anchor.download;
                event.preventDefault();
            }
        };
        window.__catlogBrowserDownloadCapture = {original, downloads, captureClick};
        URL.createObjectURL = function(blob) {
            const entry = {url: original.call(URL, blob), type: blob.type};
            downloads.push(entry);
            blob.text().then(text => {entry.text = text;}, error => {entry.error = String(error);});
            return entry.url;
        };
        document.addEventListener('click', captureClick, true);
    """)
    viewports = {}

    def row_keys():
        return driver.execute_script("""
            return [...document.querySelectorAll('#recordsBody tr[data-key]')]
                .map(row => row.getAttribute('data-key'));
        """)

    def capture(viewport, state):
        assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth + 1"), f"Page overflow: {route_label}/{viewport}/{state}"
        assert driver.execute_script("""
            const wrap = document.querySelector('#recordTableWrap');
            const box = wrap.getBoundingClientRect();
            return box.left >= -1 && box.right <= innerWidth + 1
                && (wrap.scrollWidth <= wrap.clientWidth + 1
                    || ['auto', 'scroll'].includes(getComputedStyle(wrap).overflowX));
        """), "Wide table must scroll inside its bounded wrapper"
        clipped = driver.execute_script("""
            return [...document.querySelectorAll('.app-header, .records-header, .pagination, #detailContent')]
                .filter(e => e.getBoundingClientRect().width && e.scrollWidth > e.clientWidth + 1)
                .map(e => e.id || e.className);
        """)
        assert not clipped, f"Clipped Browse panels: {clipped}"
        path = OUTPUT / f"{browser}-{route_label}-{viewport}-{state}.png"
        assert driver.save_screenshot(str(path))
        return path.name

    def check_status_column(width):
        """Status cells: the badge starts at the cell's content edge, tags never break, one badge height; on
        desktop every row has the same height."""
        geometry = driver.execute_script("""
            const rows = [...document.querySelectorAll('#recordsBody tr[data-key]')];
            const out = {rows: rows.length, offsets: [], brokenTags: 0, badgeHeights: [], rowHeights: []};
            for (const row of rows) {
                out.rowHeights.push(Math.round(row.getBoundingClientRect().height * 10) / 10);
                const badge = row.querySelector('.state-badge');
                if (!badge) continue;
                const cell = badge.closest('td');
                const style = getComputedStyle(cell);
                const contentLeft = cell.getBoundingClientRect().left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
                out.offsets.push(Math.abs(badge.getBoundingClientRect().left - contentLeft));
                out.badgeHeights.push(Math.round(badge.getBoundingClientRect().height * 10) / 10);
                badge.querySelectorAll('.state-tag').forEach(tag => { if (tag.getClientRects().length !== 1) out.brokenTags += 1; });
            }
            return out;
        """)
        assert geometry["rows"] == 25 and len(geometry["offsets"]) == 25, "Every row needs a status badge"
        assert max(geometry["offsets"]) <= 1, f"Status badges must start at the cell's content edge: {geometry['offsets']}"
        assert geometry["brokenTags"] == 0, "A status tag broke across lines"
        assert len(set(geometry["badgeHeights"])) == 1, f"Status badges differ in height: {set(geometry['badgeHeights'])}"
        if width >= 1024:
            assert len(set(geometry["rowHeights"])) == 1, f"Table rows differ in height: {set(geometry['rowHeights'])}"

    def open_menu_for(button_id):
        # Export results is a menu: open it (a scripted click on its summary, which every driver supports).
        driver.execute_script("""
            const menu = document.getElementById(arguments[0]).closest('details');
            if (menu && !menu.open) menu.querySelector('summary').click();
        """, button_id)
        wait.until(lambda d: d.find_element(By.ID, button_id).is_displayed())

    def downloaded_csv(button_id):
        index = driver.execute_script("return window.__catlogBrowserDownloadCapture.downloads.length")
        open_menu_for(button_id)
        driver.find_element(By.ID, button_id).click()
        wait.until(lambda d: d.execute_script("""
            const item = window.__catlogBrowserDownloadCapture.downloads[arguments[0]];
            return Boolean(item && (typeof item.text === 'string' || item.error));
        """, index))
        download = driver.execute_script("return window.__catlogBrowserDownloadCapture.downloads[arguments[0]]", index)
        assert not download.get("error")
        assert download["type"].startswith("text/csv")
        assert re.fullmatch(r"catlog-\d{4}-\d{2}-\d{2}-(results|page-\d+)\.csv", download.get("filename", "")), download.get("filename")
        lines = [line for line in download["text"].lstrip("\ufeff").split("\r\n") if line]
        return lines[0].split(","), lines[1:]

    def downloaded_payload(button_id):
        index = driver.execute_script("return window.__catlogBrowserDownloadCapture.downloads.length")
        open_menu_for(button_id)
        driver.find_element(By.ID, button_id).click()
        wait.until(lambda d: d.execute_script("""
            const item = window.__catlogBrowserDownloadCapture.downloads[arguments[0]];
            return Boolean(item && (typeof item.text === 'string' || item.error));
        """, index))
        download = driver.execute_script("return window.__catlogBrowserDownloadCapture.downloads[arguments[0]]", index)
        assert not download.get("error")
        assert download["type"].startswith("application/json")
        assert download.get("filename", "").endswith(".json")
        assert driver.execute_script("return window.__catlogBrowserDownloadCapture.downloads.length") == index + 1
        return json.loads(download["text"])

    def exact_key(record):
        key = record.get("record_key")
        assert isinstance(key, str) and key and key == key.strip()
        # One flat public object: the record's words, none of the earlier pipeline's internal fields or words.
        for internal in ("review_key", "verification_method", "identity_resolution_state", "evidence_confidence_tier",
                         "proof_lines", "summary", "detail"):
            assert internal not in record, internal
        assert not re.search(r"independent|AI run|catlog_v2|accession_resolved", json.dumps(record)), key
        return key

    try:
        sizes = [("desktop-1440x1000", 1440, 1000)]
        if browser == "chrome":
            sizes.append(("mobile-390x844", 390, 844))
        for viewport, width, height in sizes:
            set_browse_viewport(driver, browser, width, height)
            driver.execute_script("window.scrollTo(0, 0)")
            # The "/" shortcut badge in the search box shows only where there is a keyboard: not on a touch screen
            # (pointer: coarse; the 390px viewport emulates one).
            coarse, badge = driver.execute_script(
                "const k = document.querySelector('.global-search kbd'); return [matchMedia('(pointer: coarse)').matches, k && getComputedStyle(k).display]")
            assert coarse == (width == 390) and (badge == "none") == coarse, (viewport, coarse, badge)
            assert driver.find_element(By.ID, "pageSizeSelect").get_attribute("value") == "25"
            first_keys = row_keys()
            assert len(first_keys) == len(set(first_keys)) == 25
            assert driver.find_element(By.ID, "pageLabel").text == f"1–25 of {total:,}"
            assert not driver.find_element(By.ID, "prevButton").is_enabled()
            screenshots = [capture(viewport, "browse")]
            check_status_column(width)
            # A new page opens at its first row, wherever the table was scrolled to.
            scroll_table_to_bottom = "const w = document.getElementById('recordTableWrap'); w.scrollTop = w.scrollHeight; return w.scrollTop"
            driver.execute_script(scroll_table_to_bottom)
            driver.find_element(By.ID, "nextButton").click()
            wait.until(lambda _d: row_keys() != first_keys)
            assert driver.execute_script("return document.getElementById('recordTableWrap').scrollTop") == 0
            page_keys = row_keys()
            assert len(page_keys) == len(set(page_keys)) == 25 and not set(first_keys) & set(page_keys)
            assert driver.find_element(By.ID, "pageLabel").text == f"26–50 of {total:,}"
            assert driver.find_element(By.ID, "prevButton").is_enabled()
            screenshots.append(capture(viewport, "page-2"))
            page_payload = downloaded_payload("downloadPageButton")
            assert [record.get("record_key") for record in page_payload["records"]] == page_keys
            page_ids = [exact_key(record) for record in page_payload["records"]]
            assert len(set(page_ids)) == 25 and all(record.get("review_result") for record in page_payload["records"])
            assert page_payload["metadata"]["page"] == 2 and page_payload["metadata"]["row_count"] == 25
            assert page_payload["metadata"]["export_scope"] == "current_page_public_records"
            assert page_payload["metadata"]["source_sha256"] == manifest["source_sha256"]
            assert page_payload["metadata"]["snapshot_generated_at"] == manifest["generated_at"]
            # Export results as CSV: this page, one line per record shown, in order.
            header, csv_rows = downloaded_csv("exportPageCsvButton")
            assert header[0] == "record_key" and {"kcat_unit", "review_result", "source", "pubmed_id", "doi"} <= set(header)
            assert [line.split(",", 1)[0] for line in csv_rows] == page_keys
            # Both exports name each record's source the same way ("CatLog (read from the paper)" for a record read from
            # the paper by CatLog).
            csv_sources = {cells[0]: cells[header.index("source")] for cells in csv.reader(csv_rows)}
            assert csv_sources == {record["record_key"]: record.get("source") for record in page_payload["records"]}, csv_sources
            driver.execute_script(scroll_table_to_bottom)
            driver.find_element(By.ID, "prevButton").click()
            wait.until(lambda _d: row_keys() == first_keys)
            assert driver.execute_script("return document.getElementById('recordTableWrap').scrollTop") == 0

            # Roving row focus, keyboard activation, loaded exact-key details,
            # and Escape must all refer to the same displayed identity.
            rows = driver.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")
            driver.execute_script("arguments[0].focus()", rows[0])
            assert driver.switch_to.active_element.get_attribute("data-key") == first_keys[0]
            ActionChains(driver).send_keys(Keys.ARROW_DOWN).perform()
            selected_key = first_keys[1]
            assert driver.switch_to.active_element.get_attribute("data-key") == selected_key
            ActionChains(driver).send_keys(Keys.ENTER).perform()
            wait.until(lambda d: d.find_elements(By.ID, "downloadSelectedJson") and d.find_element(By.ID, "downloadSelectedJson").is_displayed())
            wait.until(lambda d: d.switch_to.active_element.get_attribute("id") == "detailHeading")
            assert not driver.find_elements(By.CSS_SELECTOR, ".detail-load-error, #detailLoadStatus")
            assert driver.find_element(By.CSS_SELECTOR, '#recordsBody tr[aria-selected="true"]').get_attribute("data-key") == selected_key
            loaded_detail = driver.execute_script("""
                return Object.values(window.CATLOG_DETAIL_SHARDS || {})
                    .map(shard => shard[arguments[0]]).find(Boolean) || null;
            """, selected_key)
            assert loaded_detail is not None, "The selected exact key has no loaded detail"
            screenshots.append(capture(viewport, "detail"))
            record_payload = downloaded_payload("downloadSelectedJson")
            assert exact_key(record_payload) == selected_key == loaded_detail.get("measurement_key")
            assert record_payload.get("source_license") and record_payload.get("review_result")
            # The header gives the record ID and a Copy link to this record, at least 24px tall to touch.
            displayed_id = driver.execute_script("""
                const button = document.querySelector('#detailContent .detail-top .copy-link');
                return [document.querySelector('#detailContent .detail-top #detailRecordKey')?.textContent,
                        button?.dataset.copyText || '', Math.round(button?.getBoundingClientRect().height || 0)];
            """)
            assert displayed_id[0] == selected_key, displayed_id
            assert displayed_id[1].endswith(f"#record={selected_key}"), displayed_id
            assert displayed_id[2] >= 24, displayed_id
            ActionChains(driver).send_keys(Keys.ESCAPE).perform()
            wait.until(lambda d: not d.execute_script("return document.body.classList.contains('detail-open')"))
            assert driver.switch_to.active_element.get_attribute("data-key") == selected_key
            assert "hidden" in driver.find_element(By.ID, "detailContent").get_attribute("class").split()

            search = driver.find_element(By.ID, "globalSearchInput")
            search.send_keys(selected_key, Keys.TAB)
            wait.until(lambda _d: selected_key in row_keys() and row_keys() != first_keys)
            assert search.get_attribute("value") == selected_key
            assert driver.find_element(By.ID, "activeSummary").text.endswith((" record", " records"))
            # Export results as CSV: every matching record, as many lines as the count says.
            matching = int(driver.find_element(By.ID, "activeSummary").text.split()[0].replace(",", ""))
            assert driver.find_element(By.ID, "exportAllCsvLabel").get_attribute("textContent").startswith(f"All {matching:,} matching")
            header, csv_rows = downloaded_csv("exportAllCsvButton")
            assert len(csv_rows) == matching and selected_key in {line.split(",", 1)[0] for line in csv_rows}
            # The table's grey note under the substrate is a column too, so look-alike records stay apart.
            assert header[header.index("substrate_name") + 1] == "condition_note", header
            screenshots.append(capture(viewport, "search"))
            search.clear()
            search.send_keys("zzzz-no-match-catlog-browser-check", Keys.TAB)
            # The whole word, not a pass for its first keys (Safari types key by key; "zzzz" already finds nothing, and
            # the chip then widens under a click that follows too soon).
            wait.until(lambda d: d.find_element(By.ID, "activeSummary").text == "0 records"
                       and d.execute_script(SEARCH_CHIP_JS) == "Search: zzzz-no-match-catlog-browser-check")
            assert row_keys() == []
            assert driver.find_element(By.ID, "pageLabel").text == "No records"
            for identifier in ("downloadPageButton", "exportPageCsvButton", "exportAllCsvButton", "prevButton", "nextButton"):
                assert not driver.find_element(By.ID, identifier).is_enabled()
            # One clear button in the toolbar: "Clear search and filters" stands in for the chips' Clear all.
            assert driver.find_element(By.ID, "clearResultsButton").is_displayed()
            assert not any(button.is_displayed() for button in driver.find_elements(By.CSS_SELECTOR, "#activeFilters [data-filter-clear]"))
            screenshots.append(capture(viewport, "empty"))
            driver.find_element(By.ID, "clearResultsButton").click()
            wait.until(lambda d: d.find_element(By.ID, "activeSummary").text == f"{total:,} records" and row_keys() == first_keys)
            assert search.get_attribute("value") == ""
            assert driver.find_element(By.ID, "downloadPageButton").is_enabled()
            assert driver.find_element(By.ID, "pageLabel").text == f"1–25 of {total:,}"
            assert not driver.find_elements(By.CSS_SELECTOR, ".catalog-load-failed")
            screenshots.append(capture(viewport, "cleared"))
            viewports[viewport] = {"width": width, "height": height, "rows": 25,
                "first_page_keys": first_keys, "second_page_keys": page_keys,
                "selected_record_key": selected_key, "selected_identity": selected_key,
                "page_download_identities": page_ids, "screenshots": screenshots, "passed": True}
    except Exception:
        driver.save_screenshot(str(OUTPUT / f"{browser}-{route_label}-{viewport}-failure.png"))
        raise
    finally:
        driver.execute_script("""
            const capture = window.__catlogBrowserDownloadCapture;
            if (capture) {
                URL.createObjectURL = capture.original;
                document.removeEventListener('click', capture.captureClick, true);
                capture.downloads.forEach(item => URL.revokeObjectURL(item.url));
                delete window.__catlogBrowserDownloadCapture;
            }
        """)
    try:
        # The counts band: Read from the paper N (the name Stats and the Source filter give that count) opens those
        # records (source=paper), N being their number; the snapshot date's title is the Data ID.
        set_browse_viewport(driver, browser, 1440, 1000)
        paper_link = driver.find_element(By.ID, "fromPaperLink")
        assert driver.execute_script("return arguments[0].querySelector('span').innerText.trim()", paper_link) == "Read from the paper"
        overview = stats_overview(manifest)
        if overview:
            assert paper_link.is_displayed() and driver.find_element(By.ID, "fromPaperCount").text == f"{overview['from_paper']['records']:,}"
            assert urlsplit(paper_link.get_attribute("href")).fragment == "browse?source=paper"
        assert re.fullmatch(r"Data ID [0-9a-f]{10}", driver.find_element(By.ID, "snapshotDate").get_attribute("title") or "")
        human_checked = check_human_checked(driver, url)
    except Exception:
        driver.save_screenshot(str(OUTPUT / f"{browser}-{route_label}-human-checked-failure.png"))
        raise
    return {"url": url, "route": route_label, "total": total,
            "source_sha256": manifest["source_sha256"], "asset_sha256": asset_hashes,
            "viewports": viewports, "human_checked": human_checked, "passed": True}


STATS_LINK_KEYS = {"q", "status", "checked", "ec", "enzyme", "organism", "substrate", "metric", "variant", "tmin", "tmax",
                   "phmin", "phmax", "caution", "source", "sort", "db", "dbsrc", "dbwhy", "dbpar"}
# Compared with databases in the address (round 9 brief sections 2-3): the results, the compared parameter and the cause
# families Stats links with.
STATS_DATABASE_LINK_VALUES = {"db": {"corrects", "differs", "other_label", "not_listed", "all_not_listed", "all_same", "earlier"},
                              "dbpar": {"kcat", "km", "kcatkm"}, "dbwhy": {"unit", "decimal", "elsewhere", "misprint"}}


def stats_overview(manifest):
    """The overview the page uses: counted from this snapshot's own download, or None."""
    overview = manifest["summary"].get("overview")
    if not overview or overview.get("download_sha256") != manifest.get("enriched_download", {}).get("sha256") \
            or overview.get("source_sha256") != manifest.get("source_sha256") or overview.get("records") != manifest["total_rows"]:
        return None
    return overview


# Audit and human-review results as the CatLog side will write them (overview.quality); no snapshot has them yet.
QUALITY_FIXTURE = {"as_of": "2026-10-11", "audit_values": 742, "audit_wrong": 2, "compared_values_v1": 2431,
                   "compared_papers_v1": 312, "wrong_v1": 9, "label_or_annotation_v1": 114, "v2_found": 2160,
                   "v2_approved_total": 2380, "v2_differences_checked": 504, "v2_wrong": 0}


# The headline band is Stats' focal point by size, weight and meaning colour alone (round 14, the user's colleague: "a
# bit AI-ish, with the glow"): no halo behind a number, no text-shadow, a plain white card with a 1px hairline and no
# glow, wash or gradient rule, on screen and on paper.
STATS_BAND_GLOW_JS = """
    const value = document.querySelector('.stats-totals-main .stats-total-value');
    const band = document.querySelector('#statsTotals > .stats-band');
    if (!value || !band) return null;
    const v = getComputedStyle(value), b = getComputedStyle(band), rule = getComputedStyle(band, '::before');
    return {halo: v.backgroundImage !== 'none' || v.boxShadow !== 'none', crisp: v.textShadow === 'none',
            card: b.boxShadow !== 'none' || b.backgroundImage !== 'none' || !['none', ''].includes(rule.backgroundImage)};
"""

# The band's numbers stand still: no fade or rise, whatever the motion setting (is-entering no longer animates).
STATS_BAND_RISE_JS = """
    const band = document.querySelector('#statsTotals > .stats-band');
    band.classList.add('is-entering');
    const name = getComputedStyle(document.querySelector('.stats-totals-main dd')).animationName;
    band.classList.remove('is-entering');
    return name;
"""


# The human review leads Quality, the first numbered part after the headline band (part 1), and is shown once.
LEAD_FIRST_JS = """
    const band = document.querySelector('#statsTotals > .stats-band');
    const quality = document.querySelector('#statsCharts > .stats-part');
    const lead = document.querySelector('#statsCharts .stats-lead[data-figure="review"]');
    return Boolean(band && quality && quality.dataset.part === 'quality' && lead
        && quality.querySelector('.stats-part-grid').firstElementChild === lead
        && document.querySelectorAll('[data-figure="review"]').length === 1);
"""


# The Guide's method section repeats none of the checks' numbers (round 13: a to-the-point Guide): one link to Stats'
# Quality part, "Checks so far on Stats", which opens Stats there.
GUIDE_LEAD_JS = """
    const method = document.getElementById('guide-method');
    const link = method.querySelector('a[href="#stats-quality"]');
    return {tiles: method.querySelectorAll('.guide-check, #guideMethodLead, #guideMethodMore').length, link: link ? link.textContent.trim() : null,
            numbers: /\\d+(?:\\.\\d+)?%/.test(method.innerText)};
"""

# The strict wording the user dropped on 2026-10-13 (first comparison, read blind, the 95% range) and the catalog names
# round 8 dropped (CatLog is the one name; records say what happened to them); no human-review text says them.
DROPPED_WORDING = ("first comparison", "read blind", "fully blind", "95% range", "earlier catalog", "old catalog", "CatLog v1",
                   "CatLog v2")


def review_share(part, whole):
    """A share as the page writes it (qualityShare): one decimal, <0.1% and >99.9% at the ends."""
    percent = part / whole * 100
    if 0 < percent < 0.1:
        return "<0.1%"
    if 99.9 < percent < 100:
        return ">99.9%"
    return f"{percent:.1f}%"


def review_headline(quality):
    """The share the human-review lead gives: the values correct of the earlier version's entries (quality.review.v1),
    else the reviewers' approved values the same, read from the paper again (quality.agreement, else v2_found of
    v2_approved_total); None without them."""
    review = (quality.get("review") or {}).get("v1") or {}
    # (round 16b) over the entries a reviewer could check against a paper when the snapshot gives them and they add up
    checkable = review.get("checkable") if isinstance(review.get("checkable"), dict) else {}
    if isinstance(checkable.get("entries"), int) and isinstance(review.get("entries"), int) \
            and checkable["entries"] + (review.get("entries_without_paper") or 0) == review["entries"]:
        review = checkable
    entries, disputed = review.get("entries"), review.get("value_disputed")
    if isinstance(entries, int) and entries > 0 and isinstance(disputed, int) and 0 <= disputed <= entries:
        return review_share(entries - disputed, entries)
    agreement = quality.get("agreement") or {}
    for approved, same in ((agreement.get("values_approved"), agreement.get("agree")),
                           (quality.get("v2_approved_total"), quality.get("v2_found"))):
        if isinstance(approved, int) and approved > 0 and isinstance(same, int) and 0 <= same <= approved:
            return review_share(same, approved)
    return None


def check_quality(driver, browser, url, quality=None):
    """Stats' checks table and the Guide's method section give the audit and human-review numbers of overview.quality;
    the human review leads Stats when the snapshot has it. Without a quality object in the snapshot, a copy of the
    manifest with QUALITY_FIXTURE (set in Chrome before the page starts; the data files are not changed) is checked
    instead."""
    wait = WebDriverWait(driver, 60, ignored_exceptions=(StaleElementReferenceException,))
    injected = None
    if quality is None:
        quality = QUALITY_FIXTURE
        injected = driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": """
            Object.defineProperty(window, "CATLOG_STATIC_MANIFEST", { configurable: true, get() { return undefined; },
              set(value) {
                if (value?.summary?.overview) value.summary.overview.quality = %s;
                Object.defineProperty(window, "CATLOG_STATIC_MANIFEST", { value, writable: true, configurable: true });
              } });
        """ % json.dumps(QUALITY_FIXTURE)})
    audited = isinstance(quality.get("audit_values"), int) and quality["audit_values"] > 0
    reviewed = bool(((quality.get("review") or {}).get("v1") or {}).get("entries"))
    # Without the reviewers' own counts, the share correct of every value reviewers compared (with the label errors).
    compared = not reviewed and all(isinstance(quality.get(key), int) for key in ("compared_values_v1", "wrong_v1", "label_or_annotation_v1")) \
        and quality["compared_values_v1"] > 0
    correct = f"{(quality['compared_values_v1'] - quality['wrong_v1']) / quality['compared_values_v1'] * 100:.1f}% correct" if compared else ""
    headline = review_headline(quality)
    try:
        set_browse_viewport(driver, browser, 1440, 1000)
        driver.get("about:blank")
        driver.get(url.replace("catlog-latest.html", "catlog-stats.html"))
        wait.until(lambda d: d.find_elements(By.ID, "statsChecksTitle"))
        if audited:
            audit = driver.find_element(By.CSS_SELECTOR, "[data-check='audit']")
            # ("drawn at random" when the snapshot counts the follow-up audits apart, from 2026-10-22)
            assert re.fullmatch(rf"{quality['audit_values']:,} values( drawn at random)?",
                                audit.find_element(By.CSS_SELECTOR, ".stats-check-covered").get_attribute("innerText").strip()), audit.text
            assert f"{quality['audit_values'] - quality['audit_wrong']:,} kept" in audit.get_attribute("innerText"), audit.text
            assert "independent" not in audit.get_attribute("innerText").lower(), audit.text
        if compared:
            # The share correct is shown only with the label errors beside it: in the lead, or in a check of its own
            # when there is no lead. Its group is every value compared, not the lead's approved values.
            leads = driver.find_elements(By.CSS_SELECTOR, "#statsCharts .stats-lead")
            earlier = (leads[0] if leads else driver.find_element(By.CSS_SELECTOR, "[data-check='review']")).get_attribute("innerText")
            if leads:
                assert correct in earlier and f"and {quality['label_or_annotation_v1']:,} had a wrong enzyme" in earlier, earlier
                assert f"of {quality['compared_values_v1']:,} values reviewers compared" in earlier, earlier
            else:
                assert correct in earlier and f"{quality['label_or_annotation_v1']:,} with a wrong label" in earlier, earlier
        if headline:
            assert driver.execute_script(LEAD_FIRST_JS), "The human review leads Quality, right after the headline band"
            # The share is At a glance's alone (round 14: stated once); Quality has no second big number.
            assert not driver.find_elements(By.CSS_SELECTOR, "#statsCharts .stats-lead-figure"), "The headline is said once"
            band = driver.find_element(By.CSS_SELECTOR, ".stats-total[data-total='review'] .stats-total-value").get_attribute("innerText").strip()
            assert band == headline, (band, headline)
        else:
            assert not driver.find_elements(By.CSS_SELECTOR, ".stats-lead"), "No lead without the human review's counts"
        stats_text = driver.find_element(By.ID, "statsTotals").get_attribute("innerText") + driver.find_element(By.ID, "statsCharts").get_attribute("innerText")
        for word in ("independent", "AI run", "Claude", "Codex", *DROPPED_WORDING):
            assert word not in stats_text, f"Stats says {word}"
        assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth + 1")
        # Stats' link to the method opens the Guide in this page with focus on the section's heading.
        method_link = driver.find_element(By.CSS_SELECTOR, '#statsView a[href$="#guide-method"]')
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", method_link)
        method_link.click()
        wait.until(lambda d: d.execute_script(
            "return document.body.classList.contains('guide-open') && document.activeElement?.id === 'guide-method-title'"))
        assert urlsplit(driver.current_url).fragment == "guide-method"
        driver.get("about:blank")
        driver.get(url + "#guide-method")
        wait.until(lambda d: d.find_element(By.ID, "guideView").is_displayed())
        # The method section links Stats' Quality part for what the checks found, and says no share of its own.
        lead = driver.execute_script(GUIDE_LEAD_JS)
        assert lead == {"tiles": 0, "link": "Checks so far on Stats", "numbers": False}, lead
        link = driver.find_element(By.CSS_SELECTOR, '#guide-method a[href="#stats-quality"]')
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", link)
        link.click()
        wait.until(lambda d: d.execute_script("""const part = document.getElementById('stats-quality');
            return document.body.classList.contains('stats-open') && Boolean(part) && part.getBoundingClientRect().height > 0"""))
        method = driver.find_element(By.ID, "guide-method").get_attribute("innerText")
        for word in DROPPED_WORDING:
            assert word not in method, f"The Guide's method says {word}"
    finally:
        if injected:
            driver.execute_cdp_cmd("Page.removeScriptToEvaluateOnNewDocument", {"identifier": injected["identifier"]})


# The human-review headline as the CatLog side writes it from 2026-10-13 (quality.review.v1: the reviewers' own files;
# these are that day's numbers), beside the first-comparison and blind fields, which are reference only and never shown.
REVIEW_FIXTURE = {
    "review": {"v1": {"entries": 2674, "papers": 408, "value_disputed": 3, "value_correct_pct": 99.9,
                      "value_disputed_checked_as_printed": 3, "value_missing": 31, "value_missing_pct": 1.2,
                      "other_disputed": 177, "other_disputed_pct": 6.6,
                      "other_by_kind": {"could not find the value": 153, "organism name": 13, "DOI": 5, "substrate name": 3,
                                        "duplicate": 2, "paper evidence mismatch": 1}}},
    "v2_found": 3625, "v2_approved_total": 4074,
    "agreement": {"papers_compared": 311, "values_approved": 4074, "agree": 3625, "first_agree": 3545, "first_agree_pct": 87.0,
                  "papers_unexposed": 291, "first_agree_unexposed_pct": 85.9, "first_agree_unexposed_ci95": "81.6-89.7",
                  "catlog_value_wrong": 0, "stated_values": 58, "stated_values_catlog_has": 53},
}
# The headline (the user's words, 2026-10-15): "Human review: 99.9%", no value disputed on 2,671 of 2,674 entries from
# the earlier version (408 papers); the sentence under it says what a check of the paper found for the disputed values and the entries whose
# value the reviewer could not find, never the base again.
# At a glance's Human review note (round 14: the headline stated once, the not-found entries beside it).
# Round 16b: the word "entries" glossed where Stats first uses it.
# Fix pass after round 16b: the note is one line, and the gloss is Quality's lead's, Stats' first use of "entries".
REVIEW_HEADLINE_NOTE = "no value disputed, 2,671 of 2,674; 153 (5.7%) not found in the paper"
REVIEW_SENTENCE = "People checked 2,674 entries from the earlier version (408 papers), each a record as reviewers saw it; a check of the paper found all 3 disputed values printed as the entry gives them."
# The base's "(408 papers)" in the given places: its text and how many lines it takes.
REVIEW_BASE_PARENS = """
    return [...document.querySelectorAll(arguments[0])].flatMap(place => [...place.querySelectorAll('.nowrap')])
        .map(e => [e.textContent, new Set([...e.getClientRects()].map(box => Math.round(box.top))).size]);
"""


# Every drawn text of one Team loop keeps clear of the texts of the other stations (2px apart at least).
TEAM_TEXT_APART = """
    const texts = [...document.querySelectorAll(`svg.team-loop-${arguments[0]} .team-station text`)]
        .map(text => ({station: text.closest('[data-station]').dataset.station, box: text.getBoundingClientRect()}));
    return texts.every(a => texts.every(b => a.station === b.station || a.box.right + 2 <= b.box.left
        || b.box.right + 2 <= a.box.left || a.box.bottom <= b.box.top || b.box.bottom <= a.box.top));
"""


# Each Team station's label (its name and numbers) keeps 12px or more from every other station's label, from the track and
# from the people's and agents' chips and lines (the branch lines too, for the stations off the loop's track): a list of
# what is closer, empty when all is clear.
TEAM_LABELS_CLEAR = """
    const [layout, min] = arguments;
    const svg = document.querySelector(`svg.team-loop-${layout}`);
    const ctm = svg.getScreenCTM();
    const blocks = [...svg.querySelectorAll('.team-station')].map(g => {
        const boxes = [...g.querySelectorAll('text')].map(t => t.getBoundingClientRect());
        return {station: g.dataset.station, boxes, box: boxes.length && {left: Math.min(...boxes.map(b => b.left)),
            right: Math.max(...boxes.map(b => b.right)), top: Math.min(...boxes.map(b => b.top)), bottom: Math.max(...boxes.map(b => b.bottom))}};
    }).filter(block => block.boxes.length);
    const gap = (a, b) => Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom);
    const from = (box, points) => Math.min(...points.map(([x, y]) => Math.hypot(Math.max(box.left - x, 0, x - box.right), Math.max(box.top - y, 0, y - box.bottom))));
    const screen = (x, y) => { const p = new DOMPoint(x, y).matrixTransform(ctm); return [p.x, p.y]; };
    const track = svg.querySelector('.team-track');
    const trackPoints = [];
    for (let s = 0; s <= track.getTotalLength(); s += 2) { const p = track.getPointAtLength(s); trackPoints.push(screen(p.x, p.y)); }
    const linePoints = (line) => {
        const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map(name => Number(line.getAttribute(name)));
        const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 2);
        return Array.from({length: steps + 1}, (_, k) => screen(x1 + (x2 - x1) * k / steps, y1 + (y2 - y1) * k / steps));
    };
    const links = [...svg.querySelectorAll('.team-link')].flatMap(linePoints);
    const branches = [...svg.querySelectorAll('.team-branch')].flatMap(linePoints);
    const chips = [...svg.querySelectorAll('.team-chip')].map(chip => chip.getBoundingClientRect());
    const close = [];
    blocks.forEach((a, i) => blocks.slice(i + 1).forEach(b => {
        if (gap(a.box, b.box) < min) close.push(`${a.station}/${b.station} ${Math.round(gap(a.box, b.box))}px`);
    }));
    for (const block of blocks) {
        const offTrack = ['website', 'paper'].includes(block.station);
        for (const box of block.boxes) {
            const near = [['track', trackPoints], ['link', links], ['branch', offTrack ? [] : branches]]
                .filter(([, points]) => points.length).map(([name, points]) => [name, from(box, points)])
                .concat(chips.map(chip => ['chip', gap(box, chip)]));
            for (const [name, distance] of near) if (distance < min) close.push(`${block.station} ${name} ${Math.round(distance)}px`);
        }
    }
    return close;
"""


# Where Team's AI critique stands (round 14): outside the loop's track, left of and below Rules updated, Vaishnavey's chip
# under its dot and level with the other people's chips (wide loop), its branch's chevron pointing at Rules updated, and
# every part inside the drawing's own box.
TEAM_CRITIQUE_JS = """
    const svg = document.querySelector(`svg.team-loop-${arguments[0]}`);
    const box = (e) => e.getBoundingClientRect();
    const dot = (key) => box(svg.querySelector(`[data-station="${key}"] .team-station-dot`));
    const centre = (r) => [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
    const [cx, cy] = centre(dot('critique')), [rx, ry] = centre(dot('rules'));
    const track = svg.querySelector('.team-track');
    const point = new DOMPoint(cx, cy).matrixTransform(svg.getScreenCTM().inverse());
    const chip = svg.querySelector('.team-actor[data-actor="vaishnavey"] .team-chip');
    const people = [...svg.querySelectorAll('.team-actor-person:not(.team-actor-also) .team-chip')].filter(e => e !== chip).map(box);
    // the chevron nearest AI critique's dot, as drawn: its tip (4, 0) and its back (-5, 0) in screen space
    const arrows = [...svg.querySelectorAll('.team-arrow')].map(arrow => {
        const m = arrow.getScreenCTM();
        const tip = new DOMPoint(4, 0).matrixTransform(m), back = new DOMPoint(-5, 0).matrixTransform(m);
        return {tip, back, distance: Math.hypot(tip.x - cx, tip.y - cy)};
    }).sort((a, b) => a.distance - b.distance);
    const arrow = arrows[0];
    const towards = arrow && Math.hypot(arrow.tip.x - rx, arrow.tip.y - ry) < Math.hypot(arrow.back.x - rx, arrow.back.y - ry);
    const figure = box(svg);
    const label = box(svg.querySelector('[data-station="critique"] .team-station-name'));
    return {outside: !track.isPointInFill(point), leftOfRules: cx < rx, belowTrack: cy > ry || arguments[0] === 'narrow',
            chipUnder: chip ? Math.abs(centre(box(chip))[0] - cx) < 2 && box(chip).top > cy : arguments[0] === 'narrow',
            rowLevel: chip ? people.some(other => Math.abs(other.top - box(chip).top) < 1) : arguments[0] === 'narrow',
            towardsRules: Boolean(towards),
            inFigure: [label, chip ? box(chip) : label].every(r => r.left >= figure.left - 0.5 && r.right <= figure.right + 0.5
                && r.top >= figure.top - 0.5 && r.bottom <= figure.bottom + 0.5)};
"""


def check_review_headline(driver, browser, url):
    """With the reviewers' own counts in the snapshot, At a glance gives the human review's share once and Quality says
    the review of the earlier version's entries in one sentence over a table of its verdicts (no value disputed, a value
    disputed, then values missing and other disagreements with the entries whose value the reviewer could not find); the
    kinds of disagreement and the match where CatLog has re-read the paper are the supplement's; the Guide's
    method section and Team's Human check say it shortened; the first-comparison and blind fields are never shown. The
    fixture is set in Chrome before the page starts (the data files are not changed)."""
    if browser != "chrome":
        return
    wait = WebDriverWait(driver, 60, ignored_exceptions=(StaleElementReferenceException,))
    injected = driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": """
        Object.defineProperty(window, "CATLOG_STATIC_MANIFEST", { configurable: true, get() { return undefined; },
          set(value) {
            if (value?.summary?.overview) value.summary.overview.quality = { ...(value.summary.overview.quality || {}), ...%s };
            Object.defineProperty(window, "CATLOG_STATIC_MANIFEST", { value, writable: true, configurable: true });
          } });
    """ % json.dumps(REVIEW_FIXTURE)})
    try:
        for width, height in ((1440, 1000), (375, 812)):
            driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": 1,
                                                                          "mobile": width < 768})
            driver.get("about:blank")
            driver.get(url.replace("catlog-latest.html", "catlog-stats.html"))
            lead = wait.until(lambda d: d.find_element(By.CSS_SELECTOR, "#statsCharts .stats-lead"))
            assert driver.execute_script(LEAD_FIRST_JS), "The human review leads Quality, right after the headline band"
            assert lead.find_element(By.CSS_SELECTOR, "h3").get_attribute("innerText").strip() == "Human review"
            band = driver.find_element(By.CSS_SELECTOR, ".stats-total[data-total='review']").get_attribute("innerText")
            assert "99.9%" in band and REVIEW_HEADLINE_NOTE in " ".join(band.split()) and "values correct" not in band, band
            # Quality has no second big number (round 14): one sentence, then the verdicts in a small table.
            assert not lead.find_elements(By.CSS_SELECTOR, ".stats-lead-figure")
            # The base's parenthesis never breaks inside: "(408" ending one line and "papers)" starting the next.
            parens = driver.execute_script(REVIEW_BASE_PARENS, "#statsCharts .stats-lead-sentence")
            assert len(parens) == 1 and all(text == "(408 papers)" and lines == 1 for text, lines in parens), parens
            assert " ".join(lead.find_element(By.CSS_SELECTOR, ".stats-lead-sentence").get_attribute("innerText").split()) == REVIEW_SENTENCE
            rows = driver.execute_script("""return [...arguments[0].querySelectorAll('.stats-review-table tbody tr')]
                .map(row => [...row.children].map(cell => cell.innerText.trim()))""", lead)
            assert rows == [["No value disputed", "2,671", "99.9%"], ["A value disputed", "3", "0.1%"], ["Also noted, with either verdict"],
                            ["Value missing", "31", "1.2%"], ["Other disagreement", "177", "6.6%"],
                            ["of them, value not found in the paper", "153", "5.7%"]], rows
            text = lead.get_attribute("innerText")
            assert not re.search(r"\bv[12]\b", text + band), "CatLog is the one name: no v1 or v2"
            assert "could not find" not in text and "values correct" not in text, text
            # The kinds of other disagreement and the match read from the paper again are the supplement's Quality tables.
            open_stats_supplement(driver)
            kinds = driver.find_element(By.CSS_SELECTOR, ".stats-supp-item[data-supp='review-kinds']").get_attribute("innerText")
            assert "Organism name" in kinds and "CatLog has since read 53 of the 58 values the reviewers named" in kinds, kinds
            match = " ".join(driver.find_element(By.CSS_SELECTOR, ".stats-supp-item[data-supp='review-match']").get_attribute("innerText").split())
            assert "3,625" in match and "4,074 values reviewers approved" in match, match
            for word in (*DROPPED_WORDING, "85.9", "81.6", "87.0%"):
                assert word not in text, f"The lead says {word}"
            assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth + 1"), f"Stats scrolls sideways at {width}px"
            driver.get("about:blank")
            driver.get(url + "#guide-method")
            wait.until(lambda d: d.find_element(By.ID, "guideView").is_displayed())
            # The Guide leaves the review's numbers to Stats (round 13): no tile, no share, one link.
            guide = driver.execute_script(GUIDE_LEAD_JS)
            assert guide == {"tiles": 0, "link": "Checks so far on Stats", "numbers": False}, guide
            assert_document_stays(driver, "Guide with the human review")
            # Team's Human check says no value disputed, on the wide and the upright loop, and its lines touch no other
            # station's.
            layout = "wide" if width >= 960 else "narrow"
            driver.get("about:blank")
            driver.get(url + "#team")
            station = wait.until(lambda d: d.find_element(By.CSS_SELECTOR, f"svg.team-loop-{layout} [data-station='human']"))
            assert "no value disputed on 2,671 of 2,674 entries (99.9%) from the earlier version" in station.get_attribute("aria-label"), station.get_attribute("aria-label")
            assert driver.execute_script(TEAM_TEXT_APART, layout), f"Team's {layout} loop: station texts overlap"
    finally:
        driver.execute_cdp_cmd("Emulation.clearDeviceMetricsOverride", {})
        driver.execute_cdp_cmd("Page.removeScriptToEvaluateOnNewDocument", {"identifier": injected["identifier"]})


# Round 16b (catlog-v2's publication review, items 1-7): the CatLog side's 2026-10-21 quality fields, with that day's
# numbers: the review's counts over the entries a reviewer could check against a paper, the audit's 95% interval and the
# two papers most of its wrong values sit in, CatLog's own errors by route, and the papers read or checked with database
# values in view; overview.human_checked_values and the comparison's checked_from_factor beside them.
QUALITY_16B_FIXTURE = {
    # (from 2026-10-22 the random audit alone, its follow-ups apart, and no two-papers count while those two do not
    # hold most of the drops)
    "as_of": "2026-10-21", "audit_values": 6477, "audit_wrong": 28, "audit_wrong_ci95": "0.30-0.62",
    "audit_wrong_papers": 22, "audit_targeted_values": 188, "audit_targeted_wrong": 46,
    "review": {"v1": {"entries": 2770, "papers": 431, "entries_without_paper": 166, "value_disputed": 3,
                      "value_correct_pct": 99.9, "value_disputed_checked_as_printed": 3, "value_missing": 27,
                      "value_missing_pct": 1.0, "other_disputed": 177, "other_disputed_pct": 6.4,
                      "other_by_kind": {"could not find the value": 153, "organism name": 13, "DOI": 5, "substrate name": 3,
                                        "duplicate": 2, "paper evidence mismatch": 1},
                      "checkable": {"entries": 2604, "papers": 431, "value_disputed": 3, "value_correct_pct": 99.9,
                                    "value_disputed_checked_as_printed": 3, "value_missing": 27, "value_missing_pct": 1.0,
                                    "other_disputed": 24, "other_disputed_pct": 0.9,
                                    "other_by_kind": {"organism name": 13, "DOI": 5, "substrate name": 3, "duplicate": 2,
                                                      "paper evidence mismatch": 1}}}},
    "agreement": {"papers_compared": 383, "values_approved": 4522, "agree": 3967, "differ": 555, "catlog_value_wrong": 0,
                  "differ_same_value_other_name": 134, "differ_catlog_right": 142, "differ_rounding": 3,
                  "differ_catlog_wrong": 0, "differ_not_comparable": 44, "differ_not_adjudicated": 232,
                  "stated_values": 77, "stated_values_catlog_has": 71},
    "catlog_errors": {"audit": {"values": 74, "papers": 26},
                      "sweep": {"values": 1254, "papers": 97, "reprinted": 1058, "partial_constant": 103, "other": 93},
                      "unit_fix": {"values": 108, "papers": 13},
                      "difference_check": {"values": 12, "papers": 4, "removed": 5, "corrected": 2},
                      "all": {"values": 1435, "papers": 127}},
    "exposed": {"papers": 309, "reader": 173, "checker_only": 136, "first": "2026-10-09", "last": "2026-10-21",
                "reread_blind": 303, "reread_blind_on": "2026-10-21", "reread_blind_done": 0},
}
QUALITY_16B_JS = """
    Object.defineProperty(window, "CATLOG_STATIC_MANIFEST", { configurable: true, get() { return undefined; },
      set(value) {
        const overview = value?.summary?.overview;
        if (overview) {
          overview.quality = { ...(overview.quality || {}), ...%s };
          if (Number.isInteger(overview.human_checked_accepted)) overview.human_checked_values = 3486;
        }
        if (value?.summary?.database_comparison) value.summary.database_comparison.checked_from_factor = 1.5;
        Object.defineProperty(window, "CATLOG_STATIC_MANIFEST", { value, writable: true, configurable: true });
      } });
""" % json.dumps(QUALITY_16B_FIXTURE)


def check_quality_round16b(driver, browser, url):
    """Stats with the CatLog side's 2026-10-21 quality fields (round 16b): the human review's share over the 2,604
    entries a reviewer could check, the 166 without a paper said beside it, and "entries" glossed where Stats first uses
    it; the random audit's share with its 95% interval, its follow-up audits apart (from 2026-10-22; the two-papers
    sentence only with its count, which this fixture leaves out as catlog-v2 now does); human-checked records with
    their values; the papers read or checked with database values in view; Errors found in CatLog by route; the
    differences checked by AI agents, X of Y; the corrections split by how found and called a lower bound. Chrome only:
    the fixture is set before the page starts (the data files are not changed)."""
    if browser != "chrome":
        return
    wait = WebDriverWait(driver, 60, ignored_exceptions=(StaleElementReferenceException,))
    injected = driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": QUALITY_16B_JS})
    text = lambda element: " ".join(element.get_attribute("innerText").split())
    try:
        for width, height in ((1440, 1000), (375, 812)):
            driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": 1,
                                                                          "mobile": width < 768})
            driver.get("about:blank")
            driver.get(url.replace("catlog-latest.html", "catlog-stats.html"))
            lead = wait.until(lambda d: d.find_element(By.CSS_SELECTOR, "#statsCharts .stats-lead"))
            band = text(driver.find_element(By.CSS_SELECTOR, ".stats-total[data-total='review']"))
            assert "99.9%" in band and band.endswith("no value disputed, 2,601 of 2,604"), band
            # the note keeps one line wherever a column has the room (fix pass after round 16b), and the key numbers of a
            # row start at one height whatever wraps above them
            tops = driver.execute_script("""return [...document.querySelectorAll('.stats-totals-main .stats-total')].map(item =>
                [Math.round(item.querySelector('.stats-total-value').getBoundingClientRect().top), item.querySelector('small')
                  ? item.querySelector('small').getClientRects().length && Math.round(item.querySelector('small').getBoundingClientRect().height) : 0])""")
            assert len({top for top, _ in (tops if width >= 721 else tops[2:])}) == 1, tops
            if width >= 1280:
                assert all(height <= 20 for _, height in tops), tops
            assert text(lead.find_element(By.CSS_SELECTOR, ".stats-lead-sentence")) == (
                "People checked 2,770 entries from the earlier version (431 papers), each a record as reviewers saw it; 166 had "
                "no paper and could not be checked. "
                "A check of the paper found all 3 disputed values printed as the entry gives them."), text(lead)
            rows = driver.execute_script("""return [...arguments[0].querySelectorAll('.stats-review-table tbody tr')]
                .map(row => [...row.children].map(cell => cell.innerText.trim()))""", lead)
            assert rows == [["No value disputed", "2,601", "99.9%"], ["A value disputed", "3", "0.1%"], ["Also noted, with either verdict"],
                            ["Value missing", "27", "1.0%"], ["Other disagreement", "24", "0.9%"]], rows
            assert "Shares are of the 2,604 entries with a paper." in text(lead), text(lead)
            method = " ".join(driver.execute_script("return document.querySelector('.stats-method').textContent").split())
            assert "An entry with no PMID or DOI could not be checked against a paper, so the shares leave it out." in method, method
            assert "Their values are the kcat, Km and kcat/Km values a reviewer approved on them" in method, method
            audit = text(driver.find_element(By.CSS_SELECTOR, "[data-check='audit'] .stats-check-result"))
            assert audit.startswith("6,449 kept, 28 removed as wrong (0.4%; 95% interval 0.30–0.62%)") and "two papers" not in audit \
                and audit.endswith(". Follow-up audits of whole papers and of values a check had questioned checked 188 more values and "
                                   "removed 46, counted under Errors found in CatLog."), audit
            covered = text(driver.find_element(By.CSS_SELECTOR, "[data-check='audit'] .stats-check-covered"))
            assert covered == "6,477 values drawn at random", covered
            human = text(driver.find_element(By.CSS_SELECTOR, "[data-check='human_checked'] .stats-check-result"))
            assert re.fullmatch(r"[\d,]+ \([\d.]+%\) accepted with every value approved \(3,486 values\)", human), human
            covered = text(driver.find_element(By.CSS_SELECTOR, "[data-check='human_checked'] .stats-check-covered"))
            assert re.fullmatch(r"[\d,]+ records with a reviewer’s verdict", covered), covered
            assert text(driver.find_element(By.CSS_SELECTOR, "[data-note='exposure']")) == (
                "CatLog’s reading and checking agents are meant to work without database values, so that agreement with the "
                "databases is a fair test. Between Oct 9 and Oct 21, 2026, agents saw such values, or files of CatLog’s earlier "
                "version, on 309 papers: the reading agent on 173 and only a checking agent on 136. 303 of them were sent back "
                "on Oct 21, 2026 to be read or checked again without them (none finished yet); the other 6 have not been sent "
                "back. Until then their values stay in CatLog and in the comparison with the databases."), \
                text(driver.find_element(By.CSS_SELECTOR, "[data-note='exposure']"))
            errors = driver.execute_script("""return [...document.querySelectorAll('.stats-errors-table tbody tr')]
                .map(row => [row.dataset.route, ...[...row.children].map(cell => cell.innerText.trim().split('\\n')[0])])""")
            assert errors == [["audit", "AI audit", "74", "26"], ["sweep", "Searches for an error an audit or check had found", "1,254", "97"],
                              ["unit_fix", "Unit misprinted in the paper, corrected", "108", "13"],
                              ["difference_check", "Check of a database difference against the paper", "12", "4"],
                              ["all", "All, each value once", "1,435", "127"]], errors
            assert "1,058 reprinted from an earlier paper, 103 per-product (partial) rate constants, 93 others" in text(driver.find_element(By.CSS_SELECTOR, ".stats-errors-table [data-route='sweep'] th"))
            assert "5 removed, 2 corrected, 5 awaiting a further check" in text(driver.find_element(By.CSS_SELECTOR, ".stats-errors-table [data-route='difference_check'] th"))
            # Quality's three tables share one measure, and the checks have no meters (fix pass after round 16b); on a
            # phone each check stands stacked, its name over what it covered and what it found.
            widths = driver.execute_script("return [...document.querySelectorAll('#stats-quality table')].map(t => Math.round(t.getBoundingClientRect().width))")
            assert len(widths) == 3 and len(set(widths)) == 1 and widths[0] <= 640, widths
            assert not driver.find_elements(By.CSS_SELECTOR, ".stats-checks-table .stats-minibar")
            if width <= 640:
                lefts = driver.execute_script("return [...document.querySelector(\"[data-check='audit']\").children].map(c => Math.round(c.getBoundingClientRect().left))")
                assert len(set(lefts)) == 1, lefts
            databases = driver.find_elements(By.CSS_SELECTOR, "[data-lead='databases']")
            if databases:
                words = text(databases[0])
                assert "; a lower bound, as only differences of 1.5-fold or more are checked)" in words, words
            open_stats_supplement(driver)
            kinds = text(driver.find_element(By.CSS_SELECTOR, ".stats-supp-item[data-supp='review-kinds']"))
            assert "Flags on the 2,604 entries people could check against a paper" in kinds and "Could not find" not in kinds, kinds
            match = text(driver.find_element(By.CSS_SELECTOR, ".stats-supp-item[data-supp='review-match']"))
            assert "AI agents checked 323 of the 555 values that still differ against the paper; 232 are still to check." in match, match
            # A correction count per database says it is a lower bound, as the part's lead does (fix pass after round 16b).
            for key in ("db-paired", "db-causes"):
                found = driver.find_elements(By.CSS_SELECTOR, f".stats-supp-item[data-supp='{key}']")
                assert not found or "Corrects is a lower bound, since only differences of 1.5-fold or more are checked." in text(found[0]), key
            assert "Left out by CatLog’s rules (reprint, Hill fit)" in match and "Cannot be compared" not in match, match
            assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth + 1"), f"Stats scrolls sideways at {width}px"
            driver.execute_script("document.querySelector('[data-figure=errors]').scrollIntoView()")
            driver.save_screenshot(str(OUTPUT / f"{browser}-stats-quality-16b-{width}.png"))
            # Team's Human check gives the same share over the same entries.
            layout = "wide" if width >= 960 else "narrow"
            driver.get("about:blank")
            driver.get(url + "#team")
            station = wait.until(lambda d: d.find_element(By.CSS_SELECTOR, f"svg.team-loop-{layout} [data-station='human']"))
            assert "no value disputed on 2,601 of 2,604 entries (99.9%) from the earlier version" in station.get_attribute("aria-label"), station.get_attribute("aria-label")
            assert driver.execute_script(TEAM_TEXT_APART, layout), f"Team's {layout} loop: station texts overlap"
    finally:
        driver.execute_cdp_cmd("Emulation.clearDeviceMetricsOverride", {})
        driver.execute_cdp_cmd("Page.removeScriptToEvaluateOnNewDocument", {"identifier": injected["identifier"]})


# Part 7's earlier figures as the CatLog side writes them into overview.quality (the design spec's counts); a snapshot
# whose overview counts the earlier corrections itself (overview.earlier_corrections) draws those instead.
FIGURES_FIXTURE = {
    "earlier_corrections": {"records": 5838, "before_listed": [5513, 7449], "values": {
        "kcat": {"rounding": 960, "different": 450, "magnitude": 56, "added": 467},
        "km": {"rounding": 453, "different": 645, "magnitude": 130, "added": 565},
        "kcat_over_km": {"rounding": 3092, "different": 1569, "magnitude": 94, "added": 443}}},
    "replaced": {"records": 24433, "accepted": 3889, "papers": 1313,
                 "values": {"kcat": [19250, 21222], "km": [21071, 23351], "kcat_over_km": [1109, 1234]}},
}
# The comparison with the databases (manifest summary.database_comparison) of the test bundle of 2026-10-13, used when
# the snapshot under test has none.
DATABASE_COMPARISON_FIXTURE = {
    "values": {
        "kcat": {"new_paper_not_in_databases": 411, "confirmed": 34186, "differs": 269, "new": 4689, "same_number_other_label": 1658, "corrected": 328},
        "Km": {"new_paper_not_in_databases": 635, "confirmed": 40117, "new": 4245, "same_number_other_label": 2467, "corrected": 381, "differs": 221},
        "kcat/Km": {"new_paper_not_in_databases": 336, "confirmed": 23488, "not_compared": 5946, "same_number_other_label": 1449, "new": 5798,
                    "differs": 561, "new_ratio_only": 4873, "corrected": 839},
        "all": {"new_paper_not_in_databases": 1382, "confirmed": 97791, "not_compared": 5946, "differs": 1051, "new": 14732,
                "same_number_other_label": 5574, "corrected": 1548, "new_ratio_only": 4873},
    },
    "corrections": {
        "values": 1548,
        "by_cause": {"power_of_ten": 557, "printed_number_unit_not_applied": 253, "header_scale_inverted": 179, "unit_not_converted": 126,
                     "paper_unit_misprint": 91, "decimal_or_exponent_slip": 86, "time_factor": 82, "header_scale_ignored": 56,
                     "mM_entered_as_uM": 28, "value_from_other_row": 22, "recomputed_ratio": 21, "time_unit": 21, "uM_entered_as_mM": 18,
                     "value_not_in_paper": 8},
        "by_database": {"BRENDA": 1156, "OED": 616, "SABIO-RK": 368, "SKiD": 130, "STRENDA": 12},
        "by_cause_database": {
            "power_of_ten": {"SABIO-RK": 97, "BRENDA": 456, "OED": 259, "SKiD": 51},
            "header_scale_inverted": {"SABIO-RK": 130, "OED": 9, "BRENDA": 49},
            "header_scale_ignored": {"SABIO-RK": 1, "BRENDA": 55, "OED": 8, "SKiD": 2},
            "decimal_or_exponent_slip": {"BRENDA": 85, "OED": 48, "SKiD": 3},
            "paper_unit_misprint": {"SABIO-RK": 43, "OED": 25, "BRENDA": 46, "SKiD": 4},
            "mM_entered_as_uM": {"BRENDA": 28, "OED": 4, "SKiD": 1},
            "time_factor": {"BRENDA": 82, "OED": 29, "SKiD": 6},
            "value_from_other_row": {"BRENDA": 22, "OED": 5},
            "recomputed_ratio": {"BRENDA": 21, "OED": 6},
            "printed_number_unit_not_applied": {"BRENDA": 229, "OED": 133, "SABIO-RK": 24, "SKiD": 63},
            "unit_not_converted": {"BRENDA": 48, "OED": 73, "STRENDA": 12, "SABIO-RK": 66},
            "uM_entered_as_mM": {"SABIO-RK": 7, "BRENDA": 11, "OED": 11},
            "value_not_in_paper": {"BRENDA": 3, "OED": 6},
            "time_unit": {"BRENDA": 21},
        },
        "by": {"code": 892, "paper_check": 656},
    },
    "values_by_database": {
        "BRENDA": {"same": 63221, "paper_absent": 25603, "value_absent": 18746, "parameter_absent": 6268, "other_values_only": 5433,
                   "same_number_other_label": 4731, "corrected": 1156, "differs": 813, "same_rounded": 706, "other_number": 274},
        "SABIO-RK": {"paper_absent": 76540, "same": 44991, "same_number_other_label": 3297, "value_absent": 1131, "corrected": 368,
                     "other_values_only": 291, "parameter_absent": 136, "differs": 120, "other_number": 47, "same_rounded": 30},
        "OED": {"paper_absent": 52172, "same": 45964, "other_values_only": 14719, "value_absent": 8126, "same_number_other_label": 2876,
                "same_rounded": 1771, "corrected": 616, "differs": 478, "parameter_absent": 133, "other_number": 96},
        "SKiD": {"paper_absent": 99102, "same": 8511, "other_values_only": 7141, "parameter_absent": 6219, "value_absent": 4762,
                 "same_number_other_label": 844, "corrected": 130, "same_rounded": 107, "differs": 79, "other_number": 56},
        "STRENDA": {"paper_absent": 126567, "same": 216, "same_number_other_label": 82, "other_values_only": 38, "value_absent": 34,
                    "corrected": 12, "differs": 2},
    },
    "not_reproduced": {"distinct": {"paired_with_different_number": 5635, "reprinted_from_other_work": 2372}},
    "papers": 2650,
}
# Compared with databases (round 14): the part keeps the values compared with databases and the corrections by cause; the
# rest stands in the supplement's group of the same name (SUPPLEMENT_DATABASES), each item's title in its summary.
DATABASE_TITLES = ("Values compared with databases", "Corrections by cause and how found")
# (the supplement's group lists its figures first, then its tables: round 14's fix pass)
FIGURE_MORE_TITLES = ("Results by database", "Corrections on records not yet re-read", "Entries replaced by reading the paper",
                      "Paired values by database", "Corrections by cause and database")
# The database results by enzyme class open the supplement's group when the overview counts them.
DATABASE_CLASS_TITLE = "Compared with databases by enzyme class"
SUPPLEMENT_DATABASES = "#statsCharts .stats-supp-group[aria-labelledby='statsSupplementDatabasesTitle']"


def with_class_figure(titles, driver):
    """The supplement's database titles, with the class figure first when the page draws it."""
    titles = list(titles)
    if driver.find_elements(By.CSS_SELECTOR, "[data-figure='db-classes']"):
        titles.insert(0, DATABASE_CLASS_TITLE)
    return titles


# Supplementary figures and tables (round 14): each item is closed (one line) until opened, and a closed item has no
# layout. open_stats_supplement opens every item (or closes them) and waits two frames, so the page has fitted the opened
# figures' value columns (it does on each item's toggle).
SUPPLEMENT_OPEN_JS = """
    const items = [...document.querySelectorAll('#statsCharts .stats-supp-item')];
    items.forEach((item) => { item.open = arguments[0]; });
    return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(items.length))));
"""


def open_stats_supplement(driver, opened=True):
    return driver.execute_script(SUPPLEMENT_OPEN_JS, opened)


def stats_figure_titles(driver):
    """Every figure and table title in reading order: the main parts' headings, then the supplement's items."""
    return [h.get_attribute("textContent").strip() for h in driver.find_elements(By.CSS_SELECTOR, "#statsCharts .stats-fig-title, #statsCharts .stats-supp-name")]
# Before the page starts: the snapshot's comparison with the databases, or the fixture when it has none.
DATABASE_COMPARISON_JS = """
    Object.defineProperty(window, "CATLOG_STATIC_MANIFEST", { configurable: true, get() { return undefined; },
      set(value) {
        if (value?.summary && !value.summary.database_comparison) value.summary.database_comparison = %s;
        Object.defineProperty(window, "CATLOG_STATIC_MANIFEST", { value, writable: true, configurable: true });
      } });
""" % json.dumps(DATABASE_COMPARISON_FIXTURE)


# The axis ticks shown are evenly spaced, each label after "0" is centred on its tick (the end one too), no two labels
# touch, and the gridlines drawn in the bars are exactly at the labels shown (a label that gives way takes its gridline
# with it, so no gridline is unlabelled).
STATS_AXIS_EVEN = """
    return [...document.querySelectorAll('.stats-axis-ticks')].filter(axis => axis.getBoundingClientRect().width).every(axis => {
        const area = axis.getBoundingClientRect();
        const shown = [...axis.children].filter(tick => getComputedStyle(tick).visibility === 'visible');
        const places = shown.map(tick => parseFloat(tick.style.left));
        const track = axis.closest('.stats-chart').querySelector('.stats-chart-row .stats-track');
        const lines = [...track.querySelectorAll('.stats-ref')].filter(line => line.getClientRects().length && getComputedStyle(line).visibility === 'visible')
            .map(line => parseFloat(line.style.left));
        if (JSON.stringify(lines) !== JSON.stringify(places)) return false;
        const steps = places.slice(1).map((place, index) => place - places[index]);
        const boxes = shown.map(tick => tick.getBoundingClientRect());
        // each label centred on its tick; on phones the end label ends at its tick (the axis spans the row, with no
        // empty column to reach into)
        const phone = matchMedia('(max-width: 640px)').matches;
        const placed = (box, index) => { const at = area.left + area.width * places[index] / 100;
            return Math.abs((box.left + box.right) / 2 - at) <= 1
                || (index === boxes.length - 1 && phone && places[index] === 100 && Math.abs(box.right - at) <= 1); };
        return steps.every(step => Math.abs(step - steps[0]) < 0.5)
            && boxes.every((box, index) => index === 0 || placed(box, index))
            && boxes.every((box, index) => index === 0 || box.left >= boxes[index - 1].right + 4);
    });
"""


def check_stats_contents(driver, width):
    """On this page, under the Stats title: the parts as their headings number them, each a link to its own address
    (#stats-<key>); the line fits the window, wrapping between parts only; following the last link scrolls that part to
    the top of the Stats view (the page itself never scrolls) with its heading focused, and the address names it."""
    contents = driver.find_element(By.ID, "statsContents")
    assert contents.is_displayed()
    items = driver.execute_script("""
        return [...document.querySelectorAll('#statsContents li')].map(li => ({text: li.innerText.replace(/\\s+/g, ' ').trim(),
            href: li.querySelector('a').getAttribute('href'), box: li.getBoundingClientRect()}));
    """)
    headings = [h.get_attribute("innerText").replace("\n", " ").strip()
                for h in driver.find_elements(By.CSS_SELECTOR, "#statsTotals .stats-part-title, #statsCharts .stats-part-title")]
    assert [item["text"].rstrip(" ·").strip() for item in items] == headings, (items, headings)
    assert all(item["href"] == f"#stats-{driver.execute_script('return arguments[0]', item['href'])[7:]}" for item in items)
    assert all(item["box"]["left"] >= 0 and item["box"]["right"] <= width + 1 for item in items), (width, items)
    assert all(item["box"]["height"] < 40 for item in items), "a part keeps its number and name on one line"
    # The Guide's contents look (round 15 polish): the label on its own line above the links, no "·" between them (it
    # had ended every wrapped line on a phone).
    look = driver.execute_script("""
        const title = document.querySelector('#statsContents .stats-contents-title').getBoundingClientRect();
        const first = document.querySelector('#statsContents li').getBoundingClientRect();
        return {above: title.bottom <= first.top + 1, separators: [...document.querySelectorAll('#statsContents li')]
            .filter(li => !['none', 'normal'].includes(getComputedStyle(li, '::after').content)).length};
    """)
    assert look["above"] and not look["separators"], look
    last = items[-1]["href"][1:]
    assert driver.execute_script("return !!document.getElementById(arguments[0])", last), last
    driver.find_element(By.CSS_SELECTOR, f'#statsContents a[href="#{last}"]').click()
    WebDriverWait(driver, 10).until(lambda d: urlsplit(d.current_url).fragment == last)
    assert driver.find_element(By.ID, "statsView").is_displayed()
    # The view scrolls to the part on the next animation frame after the address changes.
    part_top = """
        const view = document.getElementById('statsView').getBoundingClientRect();
        return document.getElementById(arguments[0]).getBoundingClientRect().top - view.top;
    """
    try:
        WebDriverWait(driver, 10).until(lambda d: -2 <= d.execute_script(part_top, last) <= 48)
    except TimeoutException:
        raise AssertionError(f"{last} scrolled to {driver.execute_script(part_top, last)}px from the top of the Stats view")
    assert driver.execute_script("return document.activeElement && document.activeElement.classList.contains('stats-part-title')")
    assert_document_stays(driver, "stats")
    driver.execute_script("document.getElementById('statsView').scrollTop = 0")


def check_stats_figures(driver, browser, url):
    """Part 7 and figure 2 by review result, from a copy of the manifest set in Chrome before the page starts (the data
    files are not changed; the comparison with the databases is the snapshot's own, or the test bundle's when it has
    none): part 7's figures follow in order, its lead links into Browse, its 100% bars fill 100% with the shares under
    them, its All row counts every value compared, a segment opens Browse at its records, figure 2 stacks each main
    source by review result, and nothing overflows at 1440 or 375px."""
    if browser != "chrome":
        return {"route": "stats-figures", "skipped": "Chrome only"}
    wait = WebDriverWait(driver, 60, ignored_exceptions=(StaleElementReferenceException,))
    # Main sources: every record under BRENDA, split as the snapshot's review results are (so the counts add up).
    injected = driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": """
        Object.defineProperty(window, "CATLOG_STATIC_MANIFEST", { configurable: true, get() { return undefined; },
          set(value) {
            const overview = value?.summary?.overview;
            if (overview) {
              overview.quality = { ...(overview.quality || {}), ...%s };
              const statuses = {};
              for (const item of value.summary.distributions?.verification_status || []) statuses[item.label] = item.count;
              overview.main_sources = { brenda: statuses };
            }
            if (value?.summary && !value.summary.database_comparison) value.summary.database_comparison = %s;
            Object.defineProperty(window, "CATLOG_STATIC_MANIFEST", { value, writable: true, configurable: true });
          } });
    """ % (json.dumps(FIGURES_FIXTURE), json.dumps(DATABASE_COMPARISON_FIXTURE))})
    try:
        for width, height in ((1440, 1000), (375, 812)):
            driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": width < 640})
            driver.get("about:blank")
            driver.get(url.replace("catlog-latest.html", "catlog-stats.html"))
            wait.until(lambda d: d.find_elements(By.ID, "statsReplacedTitle"))
            check_stats_contents(driver, width)
            open_stats_supplement(driver)
            # The comparison with the databases is the last numbered part before the supplement, its figures in order; the
            # supplement's group of the same name holds the rest.
            part = driver.find_element(By.CSS_SELECTOR, "#statsCharts > .stats-part[data-part='databases']")
            assert driver.execute_script("return arguments[0].nextElementSibling?.dataset.part", part) == "supplement"
            headings = [h.get_attribute("innerText").strip() for h in part.find_elements(By.CSS_SELECTOR, ".stats-fig-title")]
            assert headings == list(DATABASE_TITLES), headings
            more = [h.get_attribute("innerText").strip() for h in driver.find_elements(By.CSS_SELECTOR, f"{SUPPLEMENT_DATABASES} .stats-supp-name")]
            assert more == with_class_figure(FIGURE_MORE_TITLES, driver), more
            comparison = driver.execute_script("return window.CATLOG_STATIC_MANIFEST.summary.database_comparison")
            compared = sum(count for status, count in comparison["values"]["all"].items() if status != "not_compared")
            lead = part.find_element(By.CSS_SELECTOR, ".stats-part-lead")
            lead_text = lead.get_attribute("innerText").strip()
            assert lead_text.startswith(f"CatLog compared {compared:,} values read from"), lead_text
            # The papers named are those with a compared value, never more than CatLog has read.
            lead_papers = comparison.get("papers_compared", comparison.get("papers"))
            if isinstance(lead_papers, int):
                assert f"values read from {lead_papers:,} paper" in lead_text, (lead_papers, lead_text)
            # The caveat is said once in part 7, at the end of its two-sentence lead (round 14), never under each figure.
            caveats = ("some may be other measurements in the paper rather than database errors.", "it does not by itself mean a database is wrong.")
            assert any(text in lead_text for text in caveats) and sum(part.get_attribute("innerText").count(text) for text in caveats) == 1, lead_text
            assert len(re.findall(r"[.!?](?:\s|$)", lead_text)) <= 2, f"The lead runs to two sentences: {lead_text}"
            # Its corrections and different numbers link into Browse (a result with no values has none), each titled with
            # the records it opens where the comparison counts them; the other results are Figure 7's legend links.
            links = [urlsplit(a.get_attribute("href")).fragment for a in lead.find_elements(By.CSS_SELECTOR, "a")]
            results = (("corrects", ("corrected",)), ("differs", ("differs",)))
            assert links == [f"browse?db={db}" for db, statuses in results
                             if sum(comparison["values"]["all"].get(status, 0) for status in statuses)], links
            if comparison.get("records_with_kind"):
                titles = [a.get_attribute("title") for a in lead.find_elements(By.CSS_SELECTOR, "a")]
                assert all(re.fullmatch(r"[\d,]+ values? in [\d,]+ records?", title or "") for title in titles), titles
            figures = driver.execute_script("""
                return [...document.querySelectorAll('.stats-chart-percent')].map(chart => ({
                    key: chart.dataset.chart,
                    rows: [...chart.querySelectorAll('.stats-chart-row')].map(row => ({
                        key: row.dataset.row, count: +row.dataset.count,
                        width: [...row.querySelectorAll('.stats-seg')].reduce((sum, seg) => sum + parseFloat(seg.style.width), 0)}))}));
            """)
            # Every 100% bar has one length wherever it stands (fix pass after round 16b: 900 to 580px at 1440).
            lengths = driver.execute_script("""return [...document.querySelectorAll('.stats-chart-percent')].filter(c => c.getClientRects().length)
                .map(c => Math.round(c.querySelector('.stats-track').getBoundingClientRect().width))""")
            assert len(set(lengths)) <= 1, lengths
            percent_keys = ["db-values", "db-sources", "earlier-corrections", "replaced"]
            if driver.find_elements(By.CSS_SELECTOR, "[data-figure='db-classes']"):
                percent_keys.insert(1, "db-classes")
            assert [figure["key"] for figure in figures] == percent_keys, figures
            for figure in figures:
                for row in figure["rows"]:
                    assert abs(row["width"] - 100) < 0.01, f"{figure['key']} {row['key']} fills {row['width']}%"
            rows = {row["key"]: row["count"] for row in figures[0]["rows"]}
            assert rows["all"] == compared, rows
            shares = driver.execute_script("""
                const table = document.querySelector("[data-figure='db-values'] .stats-share-table:not([style*=none])");
                const shown = [...document.querySelectorAll("[data-figure='db-values'] .stats-share-table")].filter(t => t.getClientRects().length);
                return shown.map(t => ({heads: [...t.querySelectorAll('thead th')].map(th => th.textContent.trim()),
                                        rows: [...t.querySelectorAll('tbody th')].map(th => th.textContent.trim()),
                                        cells: t.querySelectorAll('tbody td').length, swatchesInCells: t.querySelectorAll('.stats-swatch').length}));
            """)
            # Shares under the bars: one table in view, its results named by the legend's words (colour never the only
            # key): the column heads, or on a phone (the table turned round) the row heads; the colours are the legend's
            # alone (fix pass after round 16b: no swatch in the table, none before the counts beside the bars).
            names = ["Same number", "Same, other label"]
            assert len(shares) == 1 and names in (shares[0]["heads"][:2], shares[0]["rows"][:2]) and shares[0]["cells"] and not shares[0]["swatchesInCells"], shares
            # The numbers beside the bars are named: Figure 8's two counts stand right-aligned under Corrects a value and Different number
            # (each count inside its column), Figure 9's under Values.
            assert not driver.find_elements(By.CSS_SELECTOR, "[data-chart='db-values'] .stats-chart-row .stats-db-thin .stats-swatch")
            columns = driver.execute_script("""
                return ['db-values', 'db-sources'].map((key) => {
                    const chart = document.querySelector(`[data-chart="${key}"]`);
                    const rights = (line) => [...line.querySelectorAll('.stats-value-part')].map((part) => {
                        const box = part.getBoundingClientRect(), inner = part.firstElementChild.getBoundingClientRect();
                        return { right: box.right, inside: inner.left >= box.left - 1 && inner.right <= box.right + 1 };
                    });
                    return { key, head: chart.querySelector('.stats-chart-head').innerText.replace(/\\s+/g, ' ').trim(),
                             lines: [chart.querySelector('.stats-chart-head'), ...chart.querySelectorAll('.stats-chart-row')].map(rights) };
                });
            """)
            assert [column["head"] for column in columns] == ["Corrects a value Different number", "Values"], columns
            for column in columns:
                for line in column["lines"]:
                    assert len(line) == len(column["lines"][0]) and all(part["inside"] for part in line), column
                    assert all(abs(part["right"] - head["right"]) <= 1 for part, head in zip(line, column["lines"][0])), column
            # The caveat is the lead's last sentence, said once, not repeated under the figures.
            for key in ("db-values", "db-sources", "db-found"):
                caption = driver.find_element(By.CSS_SELECTOR, f"[data-figure='{key}'] figcaption").get_attribute("innerText").strip()
                assert "by itself mean a database is wrong" not in caption and "rather than database errors" not in caption, caption
            # ...and stands right after the different numbers (under Different number only).
            lead_sentences = lead.get_attribute("innerText").strip()
            # (fix pass after round 16b: the corrections, then "the remaining N differ for a reason not yet known", unspliced)
            assert re.search(r"differs? for a reason not yet known[^.]*(?:, and|;) some may be other measurements in the paper rather than database errors\.$", lead_sentences), lead_sentences
            # Figure 2: stacked by review result, with its legend.
            legend = driver.find_element(By.CSS_SELECTOR, "[data-figure='main-source'] .stats-legend").text
            for word in ("Accepted", "Not confirmed", "Not checked"):
                assert word in legend, legend
            brenda = driver.find_element(By.CSS_SELECTOR, "[data-figure='main-source'] .stats-chart-row[data-row='brenda']")
            assert int(brenda.get_attribute("data-count")) == driver.execute_script("return window.CATLOG_STATIC_MANIFEST.total_rows")
            assert len(brenda.find_elements(By.CSS_SELECTOR, ".stats-seg")) >= 3
            # Records | Share: Share draws each source as 100% of itself (with its own axis), Records goes back.
            bar_width = "return [...arguments[0].querySelectorAll('.stats-seg')].reduce((sum, seg) => sum + parseFloat(seg.style.width), 0)"
            share = driver.find_element(By.CSS_SELECTOR, "[data-figure='main-source'] [data-stats-mode='share']")
            driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", share)
            share.click()
            assert share.get_attribute("aria-pressed") == "true"
            assert abs(driver.execute_script(bar_width, brenda) - 100) < 0.01, driver.execute_script(bar_width, brenda)
            assert driver.find_element(By.CSS_SELECTOR, "[data-figure='main-source'] [data-axis-mode='share']").is_displayed()
            assert not driver.find_element(By.CSS_SELECTOR, "[data-figure='main-source'] [data-axis-mode='records']").is_displayed()
            driver.find_element(By.CSS_SELECTOR, "[data-figure='main-source'] [data-stats-mode='records']").click()
            assert driver.find_element(By.CSS_SELECTOR, "[data-figure='main-source'] [data-axis-mode='records']").is_displayed()
            assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth + 1"), f"Stats overflows at {width}px"
            assert driver.execute_script("const p=document.querySelector('#statsView'); return p.scrollWidth <= p.clientWidth + 1"), f"Stats overflows inside at {width}px"
            driver.execute_script("document.querySelector('[data-figure=\"db-values\"]').scrollIntoView()")
            driver.save_screenshot(str(OUTPUT / f"{browser}-stats-figures-{width}.png"))
        # A segment that has a Browse filter opens Browse there: the kcat values in none of the databases (once Browse
        # matches a compared parameter; until then, all values in none of the databases, the kcat segment unlinked). The
        # address Browse opens with is read as the new page starts (sessionStorage), whatever Browse then makes of it.
        first = driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
            "source": "try { sessionStorage.setItem('catlogFirstAddress', location.href); } catch (error) {}"})
        try:
            driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 1000, "deviceScaleFactor": 1, "mobile": False})
            driver.get("about:blank")
            driver.get(url.replace("catlog-latest.html", "catlog-stats.html"))
            wait.until(lambda d: d.find_elements(By.ID, "statsDbValuesTitle"))
            segment = driver.find_element(By.CSS_SELECTOR, "[data-figure='db-values'] .stats-chart-row[data-row='kcat'] .stats-seg.stats-part-not-listed")
            expected = "browse?db=not_listed&dbpar=kcat"
            if not segment.get_attribute("data-href"):
                segment = driver.find_element(By.CSS_SELECTOR, "[data-figure='db-values'] .stats-chart-row[data-row='all'] .stats-seg.stats-part-not-listed")
                expected = "browse?db=not_listed"
            driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", segment)
            segment.click()
            wait.until(lambda d: urlsplit(d.current_url).path.endswith("catlog-latest.html"))
            opened = driver.execute_script("return sessionStorage.getItem('catlogFirstAddress')")
            assert urlsplit(opened).fragment == expected, opened
        finally:
            driver.execute_cdp_cmd("Page.removeScriptToEvaluateOnNewDocument", {"identifier": first["identifier"]})
    finally:
        driver.execute_cdp_cmd("Page.removeScriptToEvaluateOnNewDocument", {"identifier": injected["identifier"]})
        driver.execute_cdp_cmd("Emulation.clearDeviceMetricsOverride", {})
    return {"route": "stats-figures", "passed": True}


# Part 7's layout at one width: per bar chart row, the label, bar, value and the line under the bar (a database's values
# from papers it does not list) never overlap and stay inside the row; legend entries never overlap; every figure and
# table stays inside its column; Corrections by cause and database is either its table (when it fits) or a line per
# database, always the lines on phones. Returns the problems found.
STATS_DATABASES_LAYOUT_JS = """
    const main = document.querySelector("#statsCharts [data-part='databases']");
    if (!main) return ['no part 7'];
    // the part and the supplement's group of the same name, its items opened (open_stats_supplement)
    const more = document.querySelector("#statsCharts .stats-supp-group[aria-labelledby='statsSupplementDatabasesTitle']");
    const roots = [main, more].filter(Boolean);
    const part = { querySelectorAll: (selector) => roots.flatMap((root) => [...root.querySelectorAll(selector)]),
                   querySelector: (selector) => roots.map((root) => root.querySelector(selector)).find(Boolean) || null };
    const problems = [];
    const box = (element) => element && element.getClientRects().length ? element.getBoundingClientRect() : null;
    const overlap = (a, b) => a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    part.querySelectorAll('.stats-chart-row').forEach((row) => {
        const name = row.closest('.stats-chart').dataset.chart + ' ' + row.dataset.row;
        const parts = ['.stats-chart-label', '.stats-track', '.stats-chart-value', '.stats-chart-aside'].map((selector) => box(row.querySelector(':scope > ' + selector)));
        const own = box(row);
        parts.forEach((a, i) => parts.forEach((b, j) => { if (i < j && overlap(a, b)) problems.push(name + ': parts ' + i + ' and ' + j + ' overlap'); }));
        parts.forEach((a, i) => { if (a && (a.left < own.left - 1 || a.right > own.right + 1)) problems.push(name + ': part ' + i + ' leaves its row'); });
        const thin = box(row.querySelector('.stats-db-thin'));
        if (thin && thin.right > own.right + 1) problems.push(name + ': its counts leave the row');
    });
    part.querySelectorAll('.stats-legend').forEach((legend) => {
        const items = [...legend.children].map(box);
        items.forEach((a, i) => items.forEach((b, j) => { if (i < j && overlap(a, b)) problems.push('legend items overlap: ' + legend.innerText.trim().slice(0, 40)); }));
    });
    part.querySelectorAll('.stats-figure-section').forEach((section) => {
        const figure = section.querySelector('.stats-fig');
        if (figure.scrollWidth > figure.clientWidth + 1) problems.push(section.dataset.figure + ' is wider than its column');
        section.querySelectorAll('table').forEach((table) => {
            if (table.getClientRects().length && box(table).right > box(section).right + 1) problems.push(section.dataset.figure + ': table leaves the column');
        });
    });
    const phone = matchMedia('(max-width: 640px)').matches;
    const table = part.querySelector('.stats-db-cause-table'), blocks = part.querySelector('.stats-db-blocks');
    if (table && blocks) {
        const shown = [Boolean(box(table)), Boolean(box(blocks))];
        if (shown[0] === shown[1]) problems.push('Corrections by cause and database: table shown ' + shown[0] + ', lines shown ' + shown[1]);
        if (phone && shown[0]) problems.push('Corrections by cause and database: a table on a phone');
    }
    // A database's name never breaks across lines ("SABIO-" / "RK", "STRENDA" / "DB"), a wide font included.
    const names = ['SABIO-RK', 'STRENDA DB', 'BRENDA', 'SKiD', 'UniProt'];
    for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!parent.getClientRects().length || parent.closest('.visually-hidden')) continue;
        for (const name of names) {
            for (let i = node.data.indexOf(name); i >= 0; i = node.data.indexOf(name, i + 1)) {
                const range = document.createRange();
                range.setStart(node, i);
                range.setEnd(node, i + name.length);
                const lines = new Set([...range.getClientRects()].filter((line) => line.width > 0).map((line) => Math.round(line.top)));
                if (lines.size > 1) problems.push(name + ' breaks across lines in ' + ((parent.closest('[data-figure]') || {dataset: {figure: 'the lead'}}).dataset.figure));
            }
        }
    }
    }
    if (document.documentElement.scrollWidth > innerWidth + 1) problems.push('the page scrolls sideways');
    const view = document.querySelector('#statsView');
    if (view.scrollWidth > view.clientWidth + 1) problems.push('Stats scrolls sideways');
    return problems;
"""


def check_stats_databases(driver, browser, url):
    """Part 7, Compared with databases, holds its layout at 1440, 1280, 1024, 375 and 320px (STATS_DATABASES_LAYOUT_JS),
    in the viewer's own font (a wide one too: the DejaVu run), with the snapshot's comparison or, in Chrome, the test
    bundle's when the snapshot has none; its figures stand in order, two to a row from 1024px."""
    wait = WebDriverWait(driver, 60, ignored_exceptions=(StaleElementReferenceException,))
    injected = None
    if browser == "chrome":
        injected = driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": DATABASE_COMPARISON_JS})
    try:
        driver.get("about:blank")
        driver.get(url.replace("catlog-latest.html", "catlog-stats.html"))
        wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, ".stats-status-section"))
        if not driver.execute_script("return Boolean(window.CATLOG_STATIC_MANIFEST.summary?.database_comparison)"):
            return {"route": "stats-databases", "skipped": "no comparison with the databases in this snapshot"}
        if browser != "chrome":  # Safari reloads the whole page per width (slow on CI); Chrome checks every width and font
            return {"route": "stats-databases", "skipped": "layout and links checked in Chrome"}
        sizes = ((1440, 1000), (1280, 900), (1024, 800), (375, 812), (320, 700))
        for width, height in sizes:
            if browser == "chrome":
                driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": width < 640})
            else:
                set_browse_viewport(driver, browser, width, height)
            driver.get("about:blank")
            driver.get(url.replace("catlog-latest.html", "catlog-stats.html"))
            wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, "#statsCharts [data-part='databases'] .stats-fig-title"))
            # Late fonts: measure once they are in.
            driver.execute_script("return document.fonts ? document.fonts.ready.then(() => true) : true")
            open_stats_supplement(driver)
            titles = [h.get_attribute("innerText").strip() for h in driver.find_elements(By.CSS_SELECTOR, "#statsCharts [data-part='databases'] .stats-fig-title")]
            assert titles == list(DATABASE_TITLES), titles
            problems = driver.execute_script(STATS_DATABASES_LAYOUT_JS)
            assert not problems, f"Compared with databases at {width}px: {problems}"
            # In the supplement each item stands on its own line: each database above the values it pairs.
            tops = driver.execute_script("""return ['db-sources', 'db-paired'].map(key => document.querySelector(`[data-figure='${key}']`).getBoundingClientRect().top)""")
            assert tops[1] > tops[0] + 1, f"At {width}px Figure and Table rows: {tops}"
            if browser == "chrome" and width == 1440:
                # Corrections by cause and database gives a line per database wherever its table does not fit (here
                # its figure is made 300px wide, as more databases or a wider font would make the table too wide).
                lines_shown = "return Boolean(document.querySelector(\"[data-figure='db-causes'] .stats-db-blocks\").getClientRects().length)"
                assert not driver.execute_script(lines_shown)
                driver.execute_script("document.querySelector(\"[data-figure='db-causes']\").style.width = '300px'; window.dispatchEvent(new Event('resize'))")
                wait.until(lambda d: d.execute_script(lines_shown))
                assert not driver.execute_script("return Boolean(document.querySelector('.stats-db-cause-table').getClientRects().length)")
            driver.execute_script("document.querySelector(\"#statsCharts [data-part='databases']\").scrollIntoView()")
            driver.save_screenshot(str(OUTPUT / f"{browser}-stats-databases-{width}.png"))
        # Every part-7 link (and linked bar segment) opens Browse at an address Browse keeps: one that named a key Browse
        # does not match yet would be cut back to a wider list than its count. One link per set of address keys; only
        # where the snapshot's record index carries the comparison (Browse has the group).
        set_browse_viewport(driver, browser, 1440, 1000)
        addresses = driver.execute_script("""
            return [...document.querySelectorAll(":is(#statsCharts [data-part='databases'], %s) :is(a[href*='#browse'], [data-href*='#browse'])")]
                .map((element) => element.getAttribute('href') || element.getAttribute('data-href'));
        """ % SUPPLEMENT_DATABASES)
        assert addresses, "Part 7 links into Browse"
        indexed = driver.execute_script(
            "return (window.CATLOG_STATIC_MANIFEST?.viewer_index?.optional_fields || []).includes('database_summary')")
        by_keys = {}
        for address in addresses:
            fragment = urlsplit(urljoin(driver.current_url, address)).fragment
            by_keys.setdefault(tuple(sorted(key for key, _value in parse_qsl(fragment.partition("?")[2]))), fragment)
        browse = url.split("#", 1)[0]
        summary = "const e = document.getElementById('activeSummary'); return e ? e.textContent.trim() : ''"
        for fragment in by_keys.values() if indexed else ():
            driver.get("about:blank")
            driver.get(f"{browse}#{fragment}")
            wait.until(lambda d: re.fullmatch(r"[\d,]+ records?", d.execute_script(summary)))
            kept = urlsplit(driver.current_url).fragment
            assert sorted(parse_qsl(kept.partition("?")[2])) == sorted(parse_qsl(fragment.partition("?")[2])), \
                f"Stats links to #{fragment}; Browse keeps #{kept}"
    finally:
        if injected:
            driver.execute_cdp_cmd("Page.removeScriptToEvaluateOnNewDocument", {"identifier": injected["identifier"]})
        if browser == "chrome":
            driver.execute_cdp_cmd("Emulation.clearDeviceMetricsOverride", {})
    return {"route": "stats-databases", "passed": True}


# Value labels of several numbers (count, then share; Figure 5's records, accepted, read from the paper) stand in columns:
# within a chart each column's numbers end at one x. Returns the charts whose labels are ragged.
STATS_VALUE_COLUMNS_JS = """
    return [...document.querySelectorAll('.stats-chart')].filter(chart => chart.querySelector('.stats-chart-value.has-parts')).filter(chart => {
        const rows = [...chart.querySelectorAll('.stats-chart-value.has-parts')].filter(v => v.getBoundingClientRect().width)
            .map(v => [...v.children].map(part => part.getBoundingClientRect().right));
        return rows.some(row => row.length !== rows[0].length || row.some((right, i) => Math.abs(right - rows[0][i]) > 1));
    }).map(chart => chart.dataset.chart);
"""


# While a mark is lit, in figure `key`: the highest effective opacity of the other marks (bars, slices, ridges) and the
# lowest of any text in the other rows (1 when names and counts keep full ink).
STATS_DIMMED_JS = """
    const figure = document.querySelector(`[data-figure="${arguments[0]}"] .stats-fig`);
    const shown = (node) => { let o = 1; for (let n = node; n && n !== figure.parentElement; n = n.parentElement) o *= +getComputedStyle(n).opacity; return o; };
    const rest = [...figure.querySelectorAll('[data-hl]:not(.is-active)')];
    const marks = rest.flatMap((row) => row.matches('path, .stats-seg') ? [row] : [...row.querySelectorAll('.stats-seg, .stats-ridge-svg')]);
    const texts = rest.flatMap((row) => [...row.querySelectorAll('*')]).filter((node) => [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim()));
    return {marks: Math.max(0, ...marks.map(shown)), text: Math.min(1, ...texts.map(shown))};
"""


# What the values show, as drawn: the map's cells and dots, each histogram's bars (their counts from the tooltip lines),
# the condition links, the class figure's rows; and whether any label leaves its figure.
STATS_INSIGHTS_JS = """
    const tips = (selector) => [...document.querySelectorAll(selector)].map((mark) => mark.dataset.tip || '');
    const count = (tip) => { const m = tip.match(/: ([\\d,]+) (?:records?|variants?)/); return m ? Number(m[1].replace(/,/g, '')) : 0; };
    const box = (element) => element.getBoundingClientRect();
    const out = [];
    const map = document.querySelector('[data-figure="kcat-km"]');
    let mapFacts = null;
    if (map) {
      const plot = box(map.querySelector('.stats-map-plot'));
      const svg = map.querySelector('.stats-map-svg').viewBox.baseVal;
      mapFacts = { cells: tips('[data-figure="kcat-km"] .stats-map-cells rect').reduce((sum, tip) => sum + count(tip), 0),
        dots: [...map.querySelectorAll('.stats-map-dot')].map((dot) => { const b = box(dot);
          return { key: dot.dataset.hl, inside: b.left + b.width / 2 >= plot.left - 1 && b.right - b.width / 2 <= plot.right + 1
            && b.top + b.height / 2 >= plot.top - 1 && b.bottom - b.height / 2 <= plot.bottom + 1 }; }),
        rows: [...map.querySelectorAll('.stats-map-classes tbody tr')].map((row) => row.dataset.hl),
        shape: Math.abs(plot.width / plot.height - svg.width / svg.height) < 0.02,
        records: map.querySelector('.stats-map-facts dd').innerText.trim() };
    }
    const panels = (selector) => [...document.querySelectorAll(selector)].map((panel) => ({
      key: panel.dataset.metric || panel.dataset.condition, n: Number(panel.dataset.count),
      sum: [...panel.querySelectorAll('[data-tip]')].filter((bar) => bar.matches('.stats-histogram-bars > span, .stats-condition-bars > span'))
        .reduce((sum, bar) => sum + count(bar.dataset.tip), 0),
      links: [...panel.querySelectorAll('.stats-condition-top a')].map((link) => link.getAttribute('href').split('#')[1]),
      hrefs: [...panel.querySelectorAll('[data-href]')].length }));
    const fold = document.querySelector('[data-figure="mutations"] .stats-fold');
    let zero = null;
    if (fold) {
      // the dashed line stands at the middle of the bar that holds the wild type's own value
      const line = box(fold.querySelector('.stats-fold-zero'));
      const bars = [...fold.querySelectorAll('.stats-histogram-bars > span')];
      const middle = bars.find((bar) => /0\\.75 to 1\\.3 times/.test(bar.dataset.tip));
      zero = middle ? Math.abs(line.left - (box(middle).left + box(middle).width / 2)) : null;
    }
    for (const section of document.querySelectorAll('[data-figure="kcat-km"], [data-figure="mutations"], [data-figure="conditions"], [data-figure="db-classes"], [data-figure="between-papers"], [data-figure="substrate-range"], [data-figure="km-size"], [data-figure="kcat-temperature"], [data-figure="typical"]')) {
      const own = box(section);
      section.querySelectorAll('.stats-map-iso-label, .stats-map-limit-label, .stats-map-x > span, .stats-map-y > span, .stats-histogram-axis > span, .stats-condition-axis > span, .stats-ridge-ticks > span, .stats-chart-value, .stats-fold-zero > span, .stats-table td, .stats-table th')
        .forEach((label) => { const b = box(label); if (b.width && (b.left < own.left - 1 || b.right > own.right + 1)) out.push(section.dataset.figure + ': ' + label.textContent.trim() + ' leaves its figure'); });
    }
    // What the wild-type values show (round 16): per panel its own count and what its bars' tooltip lines (or its rows) add
    // up to; the typical table's rows; where each figure stands (a main part or the supplement).
    const wild = {};
    for (const panel of document.querySelectorAll('#statsCharts [data-panel]')) {
      const bars = [...panel.querySelectorAll('.stats-histogram-bars > span')].map((bar) => bar.dataset.tip || '');
      const rows = [...panel.querySelectorAll('.stats-ridge-row')].map((row) => Number(row.dataset.count));
      wild[panel.dataset.panel] = { n: Number(panel.dataset.count), sum: bars.length
        ? bars.reduce((sum, tip) => { const m = tip.match(/: ([\\d,]+) (?:pairs? of papers|panels?|series) \\(/); return sum + (m ? Number(m[1].replace(/,/g, '')) : 0); }, 0)
        : rows.reduce((sum, count) => sum + count, 0), bars: bars.length };
    }
    const typical = Object.fromEntries([...document.querySelectorAll('[data-figure="typical"] tr[data-stat-key]')].map((row) => [row.dataset.statKey, Number(row.dataset.count)]));
    // Bar-Even et al.'s kcat/Km stands in the Median column, its right edge under CatLog's median kcat/Km (when shown).
    const refCell = document.querySelector('[data-figure="typical"] .stats-row-reference td');
    const ownCell = document.querySelector('[data-figure="typical"] tr[data-stat-key="typical_kcat_over_km"] td');
    const referenceGap = refCell && ownCell && box(refCell).width && box(ownCell).width ? Math.abs(box(refCell).right - box(ownCell).right) : null;
    const where = Object.fromEntries(['between-papers', 'substrate-range', 'km-size', 'kcat-temperature', 'typical'].map((key) => {
      const section = document.querySelector(`[data-figure="${key}"]`);
      return [key, section ? (section.closest('.stats-supp-item') ? 'supplement' : section.closest('[data-part]')?.dataset.part) : null];
    }));
    return { map: mapFacts, folds: panels('[data-figure="mutations"] .stats-fold'), conditions: panels('[data-figure="conditions"] .stats-condition'),
      zero, classes: [...document.querySelectorAll('[data-figure="db-classes"] .stats-chart-row')].map((row) => [row.dataset.row, Number(row.dataset.count)]),
      wild, typical, where, referenceGap, out };
"""


def check_stats_insights(driver, browser, overview):
    """What the values show (overview.from_paper_insights), each figure only when the overview counts it: the map's cells
    hold its records and a dot per class stands in the plot, drawn with equal decades; each histogram's bars hold its
    values; the dashed line stands on the wild type's own bar; the condition links open Browse at records read from
    the paper in a temperature or pH range; the class figure counts each class's values; no label leaves its figure.
    In Chrome, focusing a class's link in the map's table lights its dot and dims the others."""
    insights = overview.get("from_paper_insights") or {}
    drawn = driver.execute_script(STATS_INSIGHTS_JS)
    assert not drawn["out"], drawn["out"]
    grid = insights.get("kcat_km")
    if grid:
        facts = drawn["map"]
        assert facts and facts["cells"] == grid["records"] and facts["shape"], facts
        classes = [f"ec_{item['class']}" for item in grid.get("classes") or [] if 1 <= item["class"] <= 7]
        assert [dot["key"] for dot in facts["dots"]] == classes == facts["rows"] and all(dot["inside"] for dot in facts["dots"]), facts
        assert facts["records"] == f"{grid['records']:,}", facts
    else:
        assert drawn["map"] is None
    metrics = (insights.get("mutations") or {}).get("metrics") or {}
    assert [panel["key"] for panel in drawn["folds"]] == [key for key in ("kcat", "km", "kcat_over_km") if key in metrics], drawn["folds"]
    assert all(panel["sum"] == panel["n"] == metrics[panel["key"]]["n"] for panel in drawn["folds"]), drawn["folds"]
    if drawn["folds"]:
        assert drawn["zero"] is not None and drawn["zero"] <= 1.5, drawn["zero"]
    conditions = insights.get("conditions") or {}
    assert [panel["key"] for panel in drawn["conditions"]] == [key for key in ("temperature", "ph") if key in conditions], drawn["conditions"]
    for panel in drawn["conditions"]:
        assert panel["sum"] == panel["n"] == conditions[panel["key"]]["n"], panel
        keys = ("tmin", "tmax") if panel["key"] == "temperature" else ("phmin", "phmax")
        assert panel["links"] and panel["hrefs"], panel
        for link in panel["links"]:
            params = dict(parse_qsl(link.partition("?")[2]))
            assert link.startswith("browse?") and params.get("source") == "paper" and set(params) - {"source"} <= set(keys), link
    # What the wild-type values show (round 16): Between papers and Substrate specificity in Values, the rest in the
    # supplement; each histogram's bars hold its pairs of papers, panels or series and each medians panel's rows its
    # records, as the overview counts them; the typical table gives each parameter's records.
    wild, where = drawn["wild"], drawn["where"]
    expected = {}
    between = insights.get("between_papers") or {}
    for metric, summary in (between.get("metrics") or {}).items():
        expected[f"pairs-{metric}"] = summary["pairs"]
    if insights.get("substrate_range"):
        expected["substrate-range"] = insights["substrate_range"]["panels"]
    if insights.get("km_by_size"):
        expected["km-size"] = insights["km_by_size"]["records"]
        if insights["km_by_size"].get("panels"):
            expected["km-size-rho"] = insights["km_by_size"]["panels"]["panels"]
    if insights.get("temperature"):
        expected["kcat-temperature"] = insights["temperature"]["records"]
        if insights["temperature"].get("series"):
            expected["q10"] = insights["temperature"]["series"]["series"]
    assert {key: panel["n"] for key, panel in wild.items()} == expected, (wild, expected)
    assert all(panel["sum"] == panel["n"] for panel in wild.values()), wild
    assert where == {"between-papers": "values" if between else None, "substrate-range": "values" if insights.get("substrate_range") else None,
                     "km-size": "supplement" if insights.get("km_by_size") else None,
                     "kcat-temperature": "supplement" if insights.get("temperature") else None,
                     "typical": "supplement" if insights.get("typical") else None}, where
    assert drawn["typical"] == {f"typical_{metric}": item["n"] for metric, item in (insights.get("typical") or {}).items()}, drawn["typical"]
    assert drawn["referenceGap"] is None or drawn["referenceGap"] <= 1, f"Bar-Even's kcat/Km is not under CatLog's median: {drawn['referenceGap']}"
    by_class = insights.get("database_by_class") or []
    if driver.find_elements(By.CSS_SELECTOR, "[data-figure='db-classes']"):
        assert drawn["classes"] == [[f"ec_{item['class']}", sum(item[key] for key in ("same", "other_label", "corrects", "differs", "not_listed"))]
                                    for item in by_class if sum(item[key] for key in ("same", "other_label", "corrects", "differs", "not_listed"))], drawn["classes"]
    if browser == "chrome" and grid and drawn["map"]["dots"]:
        # (a headless window without the system's focus gets no focus events from a scripted focus in some Chrome builds,
        # Chrome for Testing 143 among them: the page is told it has the focus, as a visitor's window has)
        driver.execute_cdp_cmd("Emulation.setFocusEmulationEnabled", {"enabled": True})
        link = driver.find_element(By.CSS_SELECTOR, "[data-figure='kcat-km'] .stats-map-classes tbody tr a.stats-link")
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'}); arguments[0].focus()", link)
        lit = driver.execute_script("""const figure = document.querySelector('[data-figure="kcat-km"]');
            return [...figure.querySelectorAll('.stats-map-dot')].map((dot) => [dot.classList.contains('is-active'), +getComputedStyle(dot).opacity]);""")
        assert lit[0][0] and all(not on for on, _opacity in lit[1:]), lit
        WebDriverWait(driver, 5).until(lambda d: all(opacity < 0.5 for _on, opacity in d.execute_script(
            "return [...document.querySelectorAll('[data-figure=\"kcat-km\"] .stats-map-dot')].slice(1).map((dot) => [0, +getComputedStyle(dot).opacity])")))
        driver.execute_script("document.activeElement.blur()")


def check_stats_more(driver, browser, overview, total):
    """The figures the overview can add (each only when the snapshot counts it), and that their numbers add up: the
    records read from the paper and those not yet re-read make all records, values per paper make the papers CatLog read,
    each class's records read from the paper and its values by class stay within its records, the small multiples draw one ridge per class with values. In Chrome,
    pointing at a mark lights it and gives its exact count in the tooltip line."""
    # The supplement's figures are measured opened (they stay open for the checks after this one).
    open_stats_supplement(driver)
    read = overview["from_paper"]["records"]
    versions = {row.get_attribute("data-row"): int(row.get_attribute("data-count"))
                for row in driver.find_elements(By.CSS_SELECTOR, "[data-figure='versions'] .stats-chart-row")}
    if versions:
        assert versions == {"catlog": read, "v1": total - read}, versions
    per_paper = overview.get("from_paper_values")
    rows = [int(row.get_attribute("data-count")) for row in driver.find_elements(By.CSS_SELECTOR, "[data-figure='values-per-paper'] .stats-chart-row")]
    if per_paper:
        assert rows and sum(rows) + per_paper.get("no_values", 0) == overview["from_paper"]["papers"], (rows, per_paper)
        # The screen reader's line per bar says one value and one paper in the singular ("1 value: 6 papers.").
        lines = driver.execute_script(
            "return [...document.querySelectorAll(\"[data-figure='values-per-paper'] .stats-chart-row .visually-hidden\")].map(e => e.textContent)")
        assert len(lines) == len(rows) and not any(re.search(r"^1 values\b|\b1 papers\b", line) for line in lines), lines
    else:
        assert not rows
    classes = {item["class"]: item for item in overview.get("ec_classes") or []}
    if all(isinstance(item.get("from_paper"), int) for item in classes.values()) and classes:
        shown = [int(span.get_attribute("innerText").replace(",", "")) for span in driver.find_elements(By.CSS_SELECTOR, "[data-figure='ec-classes'] .stats-v2-count")]
        assert shown == [item["from_paper"] for item in classes.values()] and all(item["from_paper"] <= item["count"] for item in classes.values()), shown
        # The read-from-the-paper stripe parts from its accepted bar by a 1px white gap above and below (not by lightness alone),
        # never glows, not even in a lit row, and a nonzero count shows at least 2px wide within its accepted bar.
        stripes = driver.execute_script("""return [...document.querySelectorAll('[data-figure="ec-classes"] .stats-chart-row')].map((row) => {
            const stripe = row.querySelector('.stats-part-catlog-mark'), accepted = row.querySelector('.stats-part-accepted');
            if (!stripe || !accepted) return null;
            const box = stripe.getBoundingClientRect(), bar = accepted.getBoundingClientRect();
            row.classList.add('is-active'); const lit = getComputedStyle(stripe).filter; row.classList.remove('is-active');
            return {row: row.dataset.row, width: box.width, inside: box.left >= bar.left - 0.5 && box.right <= bar.right + 0.5,
                    gap: getComputedStyle(stripe).boxShadow, lit};
        }).filter(Boolean)""")
        assert len(stripes) == sum(item["from_paper"] > 0 for item in classes.values()), stripes
        assert all(item["width"] >= 1.9 and item["lit"] == "none" and "rgb(255, 255, 255) 0px -1px 0px" in item["gap"]
                   and "rgb(255, 255, 255) 0px 1px 0px" in item["gap"] for item in stripes), stripes
        # (Records read from the paper are accepted, so a stripe ends within its accepted bar.)
        assert all(item["inside"] for item in stripes if classes[int(item["row"][3:])]["from_paper"] <= classes[int(item["row"][3:])]["accepted"]), stripes
    if classes:
        # Figure 5 names its value columns in the legend's order, each heading over its numbers (STATS_VALUE_COLUMNS_JS
        # below checks they end at one x), and no class name runs into them.
        heads = [part.get_attribute("innerText").replace("\n", " ").strip() for part in driver.find_elements(By.CSS_SELECTOR, "[data-figure='ec-classes'] .stats-chart-head .stats-value-part")]
        with_v2 = all(isinstance(item.get("from_paper"), int) for item in classes.values())
        # (the legend's words, Read from the paper, in two lines: round 15 polish)
        assert heads == ["Records", "Accepted"] + (["Read from the paper"] if with_v2 else []), heads
        crowded = driver.execute_script("""return [...document.querySelectorAll('[data-figure="ec-classes"] .stats-chart-row')].filter((row) => {
            const name = document.createRange(); name.selectNodeContents(row.querySelector('.stats-chart-label'));
            return Math.max(...[...name.getClientRects()].map((box) => box.right)) > row.querySelector('.stats-value-part').getBoundingClientRect().left - 4;
        }).map((row) => row.dataset.row)""")
        assert not crowded, f"Class names run into Figure 5's numbers: {crowded}"
    check_stats_insights(driver, browser, overview)
    ridges = driver.find_elements(By.CSS_SELECTOR, "[data-figure='class-values'] .stats-ridges")
    expected = [key for key in ("kcat", "km", "kcat_over_km") if (overview["metrics"].get(key) or {}).get("by_class")]
    assert [panel.get_attribute("data-metric") for panel in ridges] == expected, [panel.get_attribute("data-metric") for panel in ridges]
    for panel in ridges:
        grid = overview["metrics"][panel.get_attribute("data-metric")]["by_class"]
        drawn = {int(row.get_attribute("data-class")): int(row.get_attribute("data-count")) for row in panel.find_elements(By.CSS_SELECTOR, ".stats-ridge-row")}
        assert drawn == {item["class"]: item["n"] for item in grid["classes"]}, drawn
        # a record has at most one value per metric, so a class has no more values than records
        for number, n in drawn.items():
            assert number not in classes or n <= classes[number]["count"], (number, n)
        assert all(svg.get_attribute("role") == "img" and svg.get_attribute("aria-label") for svg in panel.find_elements(By.CSS_SELECTOR, "svg.stats-ridge-svg"))
        # each class links to its records with the panel's parameter (any unit, so Browse can list more than n: the
        # tooltip line says so)
        metric = panel.get_attribute("data-metric")
        for row in panel.find_elements(By.CSS_SELECTOR, ".stats-ridge-row"):
            fragment = urlsplit(row.find_element(By.CSS_SELECTOR, ".stats-ridge-label a.stats-link").get_attribute("href")).fragment
            assert dict(parse_qsl(fragment[len("browse?"):])) == {"ec": f"{row.get_attribute('data-class')}.", "metric": metric}, fragment
            assert row.get_attribute("data-tip").endswith(f"record with a {'kcat/Km' if metric == 'kcat_over_km' else 'Km' if metric == 'km' else 'kcat'}, in any unit."), row.get_attribute("data-tip")
        # each class's number of values in the n column; fewer than 300 draw lighter and dashed
        ns = [int(cell.get_attribute("innerText").replace(",", "")) for cell in panel.find_elements(By.CSS_SELECTOR, ".stats-ridge-n")]
        assert ns == [item["n"] for item in grid["classes"]], ns
        few = [int(row.get_attribute("data-class")) for row in panel.find_elements(By.CSS_SELECTOR, ".stats-ridge-row.is-few")]
        assert few == [item["class"] for item in grid["classes"] if item["n"] < 300], few
        # the open-ended end bins are not in the curves: a hatched stub marks each end bin with values
        stubs = len(panel.find_elements(By.CSS_SELECTOR, ".stats-ridge-end"))
        assert stubs == sum((item["counts"][0] > 0) + (item["counts"][-1] > 0) for item in grid["classes"]), stubs
    # Value ranges and Values by enzyme class share one log axis per parameter: the same decades and ticks (round 15
    # polish: Value ranges' histograms fill their column, as Figure 6's do, so the x of a tick is each figure's own);
    # each histogram then has a bar per decade of that axis, still holding every value.
    for metric, range_ticks, ridge_ticks in driver.execute_script(STATS_SHARED_AXIS_JS):
        summary = overview["metrics"][metric]
        if stats_value_axis(summary):
            start, end = stats_value_axis(summary)
            assert [text for text, _x in range_ticks] == [text for text, _x in ridge_ticks], (metric, range_ticks, ridge_ticks)
            # 10⁰ (text "100": 10 and its exponent) is labelled whenever it is on the axis
            assert not start <= 0 <= end or "100" in [text for text, _x in range_ticks], range_ticks
            figure = driver.find_element(By.CSS_SELECTOR, f".stats-range[data-metric='{metric}']")
            bars = figure.find_elements(By.CSS_SELECTOR, ".stats-histogram-bars > span")
            assert len(bars) == end - start, (metric, len(bars))
            assert sum(int(re.search(r": ([\d,]+) values$", bar.get_attribute("data-tip")).group(1).replace(",", "")) for bar in bars) == summary["n"]
    # A name with a breakdown under it (Figure 2's Other): beside the bar, the bar and its numbers stand on the name's
    # line, not on the breakdown's (on phones the name sits above its bar).
    off_line = driver.execute_script("""return [...document.querySelectorAll('.stats-chart-row.has-note')].filter((row) => row.offsetParent).filter((row) => {
        const label = row.querySelector('.stats-chart-label'); const track = row.querySelector('.stats-track').getBoundingClientRect();
        const name = document.createRange(); name.selectNodeContents(label.firstChild); const line = name.getClientRects()[0];
        if (label.getBoundingClientRect().right > track.left) return false;
        return Math.abs(track.top - line.top) > 1 || Math.abs(row.querySelector('.stats-chart-value').getBoundingClientRect().top - line.top) > 1;
    }).map((row) => row.dataset.row)""")
    assert not off_line, f"Bars sit below their names: {off_line}"
    # The counts of a chart line up whatever the shares beside them.
    if driver.find_elements(By.CSS_SELECTOR, "[data-figure='main-source'] .stats-switch"):
        assert driver.find_elements(By.CSS_SELECTOR, "[data-figure='main-source'] .stats-chart-value.has-parts")
    ragged = driver.execute_script(STATS_VALUE_COLUMNS_JS)
    assert not ragged, f"Value labels do not line up: {ragged}"
    # Every figure is named and described: its heading and one numbered caption (its accessible description); no data
    # line under it (said once in How these numbers are counted).
    for figure in driver.find_elements(By.CSS_SELECTOR, "#statsCharts figure.stats-fig"):
        assert figure.get_attribute("aria-labelledby") and figure.find_elements(By.CSS_SELECTOR, "figcaption .stats-fig-caption strong")
        assert driver.execute_script("const d = document.getElementById(arguments[0].getAttribute('aria-describedby')); return Boolean(d && d.textContent.trim())", figure)
    assert not driver.find_elements(By.CSS_SELECTOR, "#statsCharts .stats-fig-data")
    if browser != "chrome":
        return
    # Pointing at the Not confirmed segment lights it and its table row, dims the rest and gives its exact count.
    slice_ = driver.find_elements(By.CSS_SELECTOR, ".stats-status-bar .stats-seg[data-hl='manual_review_required']")
    if slice_:
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", slice_[0])
        box = driver.execute_script("const r = arguments[0].getBoundingClientRect(); return [r.left + r.width * 0.3, r.top + r.height * 0.6]", slice_[0])
        for x in (box[0] - 2, box[0]):
            driver.execute_cdp_cmd("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": box[1]})
        WebDriverWait(driver, 5).until(lambda d: d.execute_script("const t = document.getElementById('statsTip'); return t && !t.hidden"))
        tip = driver.execute_script("return document.getElementById('statsTip').textContent")
        pending = int(driver.find_element(By.CSS_SELECTOR, ".stats-status-section tr[data-stat-key='manual_review_required']").get_attribute("data-count"))
        assert tip.startswith(f"Not confirmed: {pending:,} ("), tip
        lit = driver.execute_script("return [...document.querySelectorAll('[data-figure=\"status\"] .is-active')].map(e => e.tagName.toLowerCase())")
        assert sorted(lit) == ["span", "tr"], lit
        assert driver.execute_script("return document.querySelector('[data-figure=\"status\"] .stats-fig').classList.contains('has-active')")
        # Only the other marks dim: the legend table's names and counts keep full ink.
        WebDriverWait(driver, 5).until(lambda d: d.execute_script(STATS_DIMMED_JS, "status")["marks"] < 0.5)
        assert driver.execute_script(STATS_DIMMED_JS, "status")["text"] == 1, "Pointing at a slice dims names or counts"
        # Escape puts the line and the light out with the pointer still on the slice (WCAG 1.4.13), and moving within
        # the slice does not bring them back.
        ActionChains(driver).send_keys(Keys.ESCAPE).perform()
        driver.execute_cdp_cmd("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": box[0] + 1, "y": box[1]})
        assert driver.execute_script("return document.getElementById('statsTip').hidden && !document.querySelector('#statsCharts .has-active')"), "Escape leaves the tooltip line"
        driver.execute_cdp_cmd("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": 2, "y": 2})
    # Pointing at Not checked in the legend table lights both of its slices (Unverified, Not reviewed) with their rows,
    # each lit row tinted; the other slices dim. (Pointing at Not confirmed above lit only its own slice and row.)
    group = driver.find_elements(By.CSS_SELECTOR, ".stats-status-section tr.stats-row-group[data-hl]")
    if group:
        parts = group[0].get_attribute("data-hl").split()
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", group[0])
        x, y = driver.execute_script("const r = arguments[0].querySelector('.stats-name').getBoundingClientRect(); return [r.left + 4, r.top + 4]", group[0])
        for dx in (0, 1):
            driver.execute_cdp_cmd("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x + dx, "y": y})
        lit = driver.execute_script("""const figure = document.querySelector('[data-figure="status"]');
            return {paths: [...figure.querySelectorAll('path.is-active')].map((path) => path.dataset.hl),
                    slices: [...figure.querySelectorAll('path[data-hl]')].map((path) => path.dataset.hl),
                    rows: [...figure.querySelectorAll('tr.is-active')].map((row) => row.dataset.statKey || row.dataset.part),
                    tinted: [...figure.querySelectorAll('tr.is-active > th')].every((cell) => getComputedStyle(cell).backgroundColor !== 'rgba(0, 0, 0, 0)')};""")
        assert parts and sorted(lit["paths"]) == sorted(key for key in parts if key in lit["slices"]), lit
        assert sorted(lit["rows"]) == sorted(["not_verified", *parts]) and lit["tinted"], lit
        WebDriverWait(driver, 5).until(lambda d: d.execute_script(STATS_DIMMED_JS, "status")["marks"] < 0.5)
        driver.execute_cdp_cmd("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": 2, "y": 2})
    # Focusing a name in a bar chart or a ridge panel dims the other bars or ridges, never the other names and counts.
    for key in ("ec-classes", "class-values"):
        link = driver.find_elements(By.CSS_SELECTOR, f"[data-figure='{key}'] [data-hl] a.stats-link")
        if not link:
            continue
        driver.execute_script("arguments[0].focus()", link[0])
        WebDriverWait(driver, 5).until(lambda d: d.execute_script(STATS_DIMMED_JS, key)["marks"] < 0.5)
        assert driver.execute_script(STATS_DIMMED_JS, key)["text"] == 1, f"Focusing a name in {key} dims names or counts"
        driver.execute_script("document.activeElement.blur()")
    # Tab onto a mark below the fold: the view scrolls to it right after focusin, and its tooltip line stays, beside it.
    expected_tip = driver.execute_script("""
        const view = document.getElementById('statsView');
        const marks = [...document.querySelectorAll('#statsCharts [data-tip] a.stats-link')].filter((link) => link.offsetParent);
        const target = marks[marks.length - 1];
        const stops = [...view.querySelectorAll('a[href], button, summary')].filter((item) => item.offsetParent && item.tabIndex >= 0);
        const before = target ? stops[stops.indexOf(target) - 1] : null;
        if (!before) return null;
        view.scrollTop = 0;
        before.focus({ preventScroll: true });
        return target.getBoundingClientRect().top > innerHeight ? target.closest('[data-tip]').dataset.tip : null;
    """)
    if expected_tip:
        ActionChains(driver).send_keys(Keys.TAB).perform()
        WebDriverWait(driver, 5).until(lambda d: d.execute_script("return document.getElementById('statsView').scrollTop > 0"))
        # read it two frames later, after the view's scroll event has run
        focus_tip = driver.execute_async_script("""const done = arguments[arguments.length - 1];
            requestAnimationFrame(() => requestAnimationFrame(() => {
              const tip = document.getElementById('statsTip'); const mark = document.activeElement.closest('[data-tip]').getBoundingClientRect();
              const box = tip.getBoundingClientRect();
              done({hidden: tip.hidden, text: tip.textContent, gap: Math.min(Math.abs(mark.top - box.bottom), Math.abs(box.top - mark.bottom))});
            }));""")
        assert not focus_tip["hidden"] and focus_tip["text"] == expected_tip and focus_tip["gap"] <= 20, focus_tip
        # Escape puts a focused mark's line out and keeps the focus where it is.
        focused = driver.execute_script("return document.activeElement")
        ActionChains(driver).send_keys(Keys.ESCAPE).perform()
        assert driver.execute_script("return document.getElementById('statsTip').hidden && document.activeElement === arguments[0] && !document.querySelector('#statsCharts .has-active')", focused), "Escape leaves a focused mark's tooltip line"
        driver.execute_script("document.activeElement.blur()")


# The figures a newer overview adds, as build_overview counts them, set in Chrome before the page starts (the data files
# are not changed); derived from the snapshot's own counts so they add up.
MORE_FIXTURE_JS = """
    Object.defineProperty(window, "CATLOG_STATIC_MANIFEST", { configurable: true, get() { return undefined; },
      set(value) {
        const overview = value?.summary?.overview;
        if (overview?.from_paper) {
          const papers = overview.from_paper.papers;
          overview.from_paper_values = { values: papers * 3, bins: [1, 2, 5], papers: [papers - 2, 1, 1] };
          // Records read from the paper are accepted: a class has no more of them than accepted records
          overview.ec_classes = (overview.ec_classes || []).map((item) => ({ ...item, from_paper: Math.min(item.accepted, Math.floor(item.count / 4)) }));
          const counts = (n) => { const list = new Array(16).fill(0); list[5] = n - 2; list[6] = 1; list[15] = 1; return list; };
          overview.metrics.kcat.by_class = { log10_start: -4, bin_width: 0.5, classes: (overview.ec_classes || []).slice(0, 3)
            .map((item) => ({ class: item.class, n: 20, median: 0.5, p10: 0.02, p90: 4, counts: counts(20) })) };
          overview.top_organisms_from_paper = (overview.top_organisms || []).slice(0, 3).map((item) => ({ ...item, count: Math.min(item.count, overview.from_paper.records) }));
          // What the values show: a 9 x 8 decade map of 6 records, three classes' medians; variants against their wild
          // type; temperature and pH (within the records read from the paper); database results for three classes.
          const grid = Array.from({ length: 36 }, () => new Array(32).fill(0));
          grid[17][18] = 3; grid[20][14] = 2; grid[35][0] = 1;
          const classes = (overview.ec_classes || []).slice(0, 3);
          const fold = (n) => ({ n, median: 0.3, lower: n - 1, higher: 1, tenfold_lower: 1, tenfold_higher: 0,
            counts: [1, ...new Array(15).fill(0), n - 2, 1, ...new Array(11).fill(0)] });
          const bins = (n, at) => Array.from({ length: 101 }, (_value, index) => (index === at ? n - 1 : index === 100 ? 1 : 0));
          const read = Math.max(2, Math.min(overview.from_paper.records, 50));
          overview.from_paper_insights = {
            kcat_km: { records: 6, linked: 6, bin_width: 0.25, kcat_log10_start: -4, km_log10_start: -5, counts: grid,
              ratio_median: 17.3, at_diffusion_limit: [1, 0],
              classes: classes.map((item, index) => ({ class: item.class, n: 2, kcat_median: [4.4, 1.2, 6.1][index], km_median: [0.23, 0.16, 0.13][index] })) },
            mutations: { variants: 6, papers: 2, ambiguous: 3, no_wild_type: 1, bin_width: 0.25, log10_start: -4,
              metrics: { kcat: fold(5), km: fold(4), kcat_over_km: fold(6) } },
            conditions: { temperature: { n: read, start: 0, width: 1, decimals: 1, counts: bins(read, 25) },
              ph: { n: read, start: 2, width: 0.1, decimals: 2, counts: bins(read, 55) } },
            database_by_class: classes.map((item) => ({ class: item.class, same: 1200, other_label: 40, corrects: 9, differs: 7, not_listed: 300 })),
            // Round 16: the wild-type analyses, small counts that add up.
            between_papers: { records: 30, papers: 9, proteins: 4, bin_width: 0.25,
              metrics: Object.fromEntries(["kcat", "km", "kcat_over_km"].map((key) => [key, { pairs: 12, groups: 5, median: 1.9, within_2: 6, within_10: 11,
                identical_left_out: 1, counts: [5, 3, 2, 1, 0, 0, 0, 0, 1] }])),
              same_conditions: { records: 8, papers: 4, proteins: 2, metrics: { kcat: { pairs: 3, groups: 2, median: 1.5, within_2: 2, within_10: 3 } } } },
            substrate_range: { panels: 10, records: 40, papers: 6, enzymes: 7, median: 110, p25: 16, p75: 1100, at_least_10: 8, at_least_1000: 3,
              bin_width: 0.5, counts: [1, 1, 2, 2, 1, 0, 1, 1, 0, 0, 0, 0, 1],
              by_substrates: [{ from: 3, to: 3, panels: 6, median: 22 }, { from: 10, to: null, panels: 4, median: 830 }] },
            km_by_size: { records: 12, papers: 5, enzymes: 6,
              bins: [{ from: 1, to: 5, n: 5, papers: 2, median: 1.2, p10: 0.13, p90: 8.7 }, { from: 51, to: null, n: 7, papers: 3, median: 0.034, p10: 0.009, p90: 0.19 }],
              panels: { panels: 6, records: 30, papers: 3, enzymes: 3, falls: 4, rises: 2, median_rho: -0.22, bin_width: 0.25, counts: [1, 1, 1, 1, 0, 1, 1, 0, 0] } },
            temperature: { records: 9, papers: 4, enzymes: 4,
              bins: [{ from: 20, below: 30, n: 4, papers: 2, median: 4.5, p10: 0.43, p90: 29 }, { from: 80, below: null, n: 5, papers: 2, median: 24, p10: 2.8, p90: 200 }],
              series: { series: 5, records: 11, papers: 2, enzymes: 2, median: 1.7, p25: 1.4, p75: 2.1, rising: 4, falling: 1, bin_width: 0.1, log10_start: -0.5,
                counts: [0, 0, 0, 0, 1, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0] } },
            typical: { kcat: { n: 31, papers: 4, enzymes: 5, median: 4.7, p10: 0.042, p90: 190 },
              km: { n: 40, papers: 4, enzymes: 6, median: 0.16, p10: 0.003, p90: 7.7 },
              kcat_over_km: { n: 32, papers: 4, enzymes: 5, median: 28, p10: 0.11, p90: 3000 } },
          };
        }
        Object.defineProperty(window, "CATLOG_STATIC_MANIFEST", { value, writable: true, configurable: true });
      } });
"""


# The value figures' log axes' labels as drawn (ridges and histograms): per axis, each tick's text from only the parts that take room on screen (the "10"
# and its exponent are measured apart, so a hidden "10" with a visible exponent shows as the bare exponent).
RIDGE_TICKS_JS = """
    const shown = (node) => { const range = document.createRange(); range.selectNodeContents(node);
      const box = range.getBoundingClientRect(); return box.width > 0.5 && box.height > 0.5; };
    return [...document.querySelectorAll('.stats-ridge-ticks, .stats-histogram-axis')].map((axis) => [...axis.children]
      .map((tick) => [...tick.childNodes].filter(shown).map((node) => node.textContent).join('').trim()).filter(Boolean));
"""


# Per parameter drawn in both Value ranges and Values by enzyme class: each axis's ticks as drawn (label, centre x), so
# the two can be compared: one shared log axis gives both figures the same powers of ten.
STATS_SHARED_AXIS_JS = """
    const ticks = (axis) => [...axis.children].map((tick) => { const box = tick.getBoundingClientRect();
      return [tick.textContent, Math.round((box.left + box.right) / 2 * 2) / 2]; });
    return ['kcat', 'km', 'kcat_over_km'].map((metric) => {
      const range = document.querySelector(`.stats-range[data-metric="${metric}"] .stats-histogram-axis`);
      const ridges = document.querySelector(`.stats-ridges[data-metric="${metric}"] .stats-ridge-ticks`);
      return range && ridges ? [metric, ticks(range), ticks(ridges)] : null;
    }).filter(Boolean);
"""


def stats_value_axis(summary):
    """The (start, end) decades of the log axis Value ranges shares with Values by enzyme class (statsValueAxis), or
    None: the whole decades around the class grid, when the whole-distribution histogram reaches that far."""
    grid = summary.get("by_class") or {}
    if not grid.get("classes"):
        return None
    start = math.floor(grid["log10_start"] + 1e-9)
    end = math.ceil(grid["log10_start"] + len(grid["classes"][0]["counts"]) * grid["bin_width"] - 1e-9)
    first, bins = summary["log10_start"], len(summary["counts"])
    return (start, end) if first <= start and first + bins >= end else None


# The lowest contrast against the page of the edges that give the value figures their shapes (each histogram bar's 1px
# outline, each ridge line), as drawn: WCAG 1.4.11 asks 3:1, since the per-bin counts show only on pointing.
STATS_EDGE_CONTRAST_JS = """
    const paint = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const rgb = (colour) => { paint.clearRect(0, 0, 1, 1); paint.fillStyle = '#000'; paint.fillStyle = colour; paint.fillRect(0, 0, 1, 1); return [...paint.getImageData(0, 0, 1, 1).data].slice(0, 3); };
    const lum = (colour) => rgb(colour).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const page = lum(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
    const ratio = (colour) => { const l = lum(colour); return (Math.max(l, page) + 0.05) / (Math.min(l, page) + 0.05); };
    const edges = [...document.querySelectorAll('.stats-histogram-bars > span')].map((bar) => getComputedStyle(bar).boxShadow.match(/(?:rgba?|color)\\([^)]*\\)/)[0])
      .concat([...document.querySelectorAll('.stats-ridge-line')].map((line) => getComputedStyle(line).stroke));
    return edges.length ? Math.min(...edges.map(ratio)) : null;
"""


# The bar charts' axis labels that touch (less than 2px apart) as drawn: per axis, the pairs of neighbouring labels.
STATS_AXIS_TOUCHING_JS = """
    return [...document.querySelectorAll('.stats-axis-ticks')].filter((axis) => axis.offsetParent).flatMap((axis) => {
      const labels = [...axis.children].filter((tick) => getComputedStyle(tick).visibility !== 'hidden' && tick.textContent.trim())
        .map((tick) => [tick.textContent, tick.getBoundingClientRect()]);
      return labels.slice(1).map((label, index) => [labels[index], label]).filter(([before, after]) => after[1].left < before[1].right + 2)
        .map(([before, after]) => `${axis.closest('[data-figure]')?.dataset.figure}: ${before[0]} | ${after[0]}`);
    });
"""


# A viewer whose system draws text wider (Verdana, letter-spacing 0.5px), set before the page's script runs.
WIDE_FONT_JS = """
    new MutationObserver((list, observer) => {
      if (!document.head) return;
      const style = document.createElement("style");
      style.textContent = "html { --font: Verdana, sans-serif !important } body, body * { letter-spacing: 0.5px !important }";
      document.head.appendChild(style);
      observer.disconnect();
    }).observe(document, { childList: true, subtree: true });
"""


def check_stats_new_figures(driver, browser, url):
    """Chrome: with a newer overview's counts (MORE_FIXTURE_JS) Stats draws the added figures in order and they add up
    (check_stats_more) at 1440 and 375px; the motion respects a reduced-motion setting, print drops every glow, and a
    wide fallback font keeps every value label inside its figure."""
    if browser != "chrome":
        return {"route": "stats-new-figures", "skipped": "Chrome only"}
    wait = WebDriverWait(driver, 60, ignored_exceptions=(StaleElementReferenceException,))
    injected = driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": MORE_FIXTURE_JS})
    try:
        for width, height in ((1440, 1000), (375, 812)):
            driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": width < 640})
            driver.get("about:blank")
            driver.get(url.replace("catlog-latest.html", "catlog-stats.html"))
            wait.until(lambda d: d.find_elements(By.ID, "statsClassValuesTitle"))
            manifest = driver.execute_script("return window.CATLOG_STATIC_MANIFEST")
            overview = stats_overview(manifest)
            check_stats_more(driver, browser, overview, manifest["total_rows"])
            titles = stats_figure_titles(driver)
            for title in ("Values per paper", "Most common organisms among records read from the paper", "Values by enzyme class",
                          "kcat against Km", "Variants against their wild type", "Assay temperature and pH", "Between papers",
                          "Substrate specificity", "kcat and assay temperature", "Km and substrate size", "The typical wild-type enzyme"):
                assert title in titles, titles
            # The main parts' figures first, then the supplement's in its groups' order (its figures before its tables).
            assert titles.index("Value ranges") < titles.index("Between papers") < titles.index("kcat against Km") \
                < titles.index("Substrate specificity") < titles.index("Variants against their wild type") \
                < titles.index("Values by enzyme class") < titles.index("Assay temperature and pH") < titles.index("kcat and assay temperature") \
                < titles.index("Km and substrate size") < titles.index("The typical wild-type enzyme") < titles.index("Cautions on values"), titles
            if driver.find_elements(By.CSS_SELECTOR, "#statsCharts [data-part='databases']"):
                assert titles.index("Cautions on values") < titles.index(DATABASE_CLASS_TITLE) < titles.index("Results by database"), titles
            # Each enzyme class wears its own colour in Values by enzyme class (a ridge line per class, none alike).
            strokes = driver.execute_script("return [...document.querySelectorAll('[data-figure=\"class-values\"] .stats-ridges:first-of-type .stats-ridge-line')].map((line) => getComputedStyle(line).stroke)")
            assert len(strokes) == len(set(strokes)) >= 2, strokes
            assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth + 1"), f"Stats overflows at {width}px"
            assert driver.execute_script("const p=document.querySelector('#statsView'); return p.scrollWidth <= p.clientWidth + 1"), f"Stats overflows inside at {width}px"
            # Figure 3's six ticks (0-125,000) thin to every other one where they would touch, gridlines with them.
            assert driver.execute_script(STATS_AXIS_EVEN), f"Axis labels sit unevenly, touch or leave a gridline unlabelled at {width}px"
            edge = driver.execute_script(STATS_EDGE_CONTRAST_JS)
            assert edge is None or edge >= 3, f"A histogram outline or ridge line has {edge:.2f}:1 against the page"
            # The ridges of one panel share one plot width; on phones the class number stands alone.
            widths = driver.execute_script("return [...document.querySelectorAll('.stats-ridges')].map(panel => [...panel.querySelectorAll('.stats-ridge-plot')].map(plot => Math.round(plot.getBoundingClientRect().width)))")
            assert all(len(set(panel)) == 1 and panel[0] >= 120 for panel in widths), widths
            driver.execute_script("document.querySelector('[data-figure=\"class-values\"]').scrollIntoView()")
            driver.save_screenshot(str(OUTPUT / f"{browser}-stats-new-figures-{width}.png"))
        # Every ridge axis label that shows reads as a power of ten, whole: a narrow axis drops every second label with
        # its exponent, never leaving a bare "−2" that reads as a value (narrow phones and the three-panel row at 1024px).
        for narrow in (320, 360, 1024):
            driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": narrow, "height": 900, "deviceScaleFactor": 1, "mobile": narrow < 640})
            labels = driver.execute_script(RIDGE_TICKS_JS)
            assert labels and all(axis and all(label.startswith("10") and len(label) > 2 for label in axis) for axis in labels), (
                f"At {narrow}px a ridge axis label is not a whole power of ten: {labels}")
        # The key numbers never glow (no halo, no text-shadow), on screen or on paper, and no figure mark has a glow or
        # a gradient fill (the hatched kinds are a pattern of 135° lines, never a wash); with less motion asked for,
        # nothing moves.
        glow = """const hatched = '.stats-part-corrects-2, .stats-part-unverified, .stats-part-not-reviewed, .stats-part-not-checked, .stats-part-not-listed-hatch';
            return [...document.querySelectorAll('.stats-totals-main .stats-total-value')].map(e => getComputedStyle(e))
            .some(c => c.boxShadow !== 'none' || c.textShadow !== 'none' || c.backgroundImage !== 'none')
            || [...document.querySelectorAll('.stats-seg, .stats-swatch:not(.stats-part-catlog-mark), .stats-histogram-bars > span, .stats-meter > span')]
                .some(e => (e.matches(hatched) ? !/^repeating-linear-gradient\\(135deg/.test(getComputedStyle(e).backgroundImage)
                    : getComputedStyle(e).backgroundImage !== 'none') || getComputedStyle(e).filter !== 'none')"""
        assert driver.execute_script(glow) is False
        # One meaning per colour on one page (round 14): a correction never looks like Not confirmed's salmon, and Not
        # checked never like Accepted's navy a step lighter. Corrects a value is the sidebar square's opaque red, far
        # (CIE76 > 20) from salmon at 60%; the exact-factor kind and Not checked are hatched, not lighter fills.
        fills = driver.execute_script("""
            const rgb = text => { const v = (text.match(/[\\d.]+/g) || []).slice(0, 3).map(Number); return text.startsWith('color(') ? v.map(x => x * 255) : v; };
            const lab = c => { const [r, g, b] = rgb(c).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
              const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
              const [x, y, z] = [(0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, 0.2126 * r + 0.7152 * g + 0.0722 * b, (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883].map(f);
              return [116 * y - 16, 500 * (x - y), 200 * (y - z)]; };
            const de = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
            const fill = sel => { const e = document.querySelector(sel); return e ? getComputedStyle(e) : null; };
            const pending = fill('.stats-seg.stats-part-pending'), corrects = fill('.stats-seg.stats-part-corrects');
            const second = fill('.stats-swatch.stats-part-corrects-2'), unchecked = fill('.stats-seg.stats-part-not-checked, .stats-seg.stats-part-unverified');
            return {de: pending && corrects ? de(pending.backgroundColor, corrects.backgroundColor) : null,
                    second: second && second.backgroundImage, unchecked: unchecked && unchecked.backgroundImage,
                    bar: [...document.querySelectorAll('.stats-status-bar .stats-seg:is(.stats-part-unverified, .stats-part-not-reviewed)')].map(e => getComputedStyle(e).backgroundImage)};
        """)
        assert fills["de"] is None or fills["de"] > 20, fills
        assert all(value is None or value.startswith("repeating-linear-gradient") for value in (fills["second"], fills["unchecked"])), fills
        assert all(value.startswith("repeating-linear-gradient") for value in fills["bar"]), fills
        driver.execute_cdp_cmd("Emulation.setEmulatedMedia", {"media": "print"})
        assert driver.execute_script(glow) is False
        driver.execute_cdp_cmd("Emulation.setEmulatedMedia", {"media": "", "features": [{"name": "prefers-reduced-motion", "value": "reduce"}]})
        assert driver.execute_script("return getComputedStyle(document.querySelector('.stats-seg')).transitionDuration") in ("0s", "")
        driver.execute_cdp_cmd("Emulation.setEmulatedMedia", {"media": "", "features": []})
        assert driver.execute_script("return getComputedStyle(document.querySelector('.stats-seg')).transitionDuration") != "0s"
        # A wide fallback font from the start (Verdana, letter-spacing 0.5px): every value label stays inside its figure.
        wide = driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": WIDE_FONT_JS})
        try:
            driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 900, "deviceScaleFactor": 1, "mobile": False})
            driver.get("about:blank")
            driver.get(url.replace("catlog-latest.html", "catlog-stats.html"))
            wait.until(lambda d: d.find_elements(By.ID, "statsClassValuesTitle"))
            open_stats_supplement(driver)
            fit = driver.execute_script("""const t = document.querySelector('.stats-status-table th');
                return {family: getComputedStyle(t).fontFamily,
                        spill: [...document.querySelectorAll('.stats-chart-value, .stats-ridge-value, .stats-ridge-n')].filter(v =>
                          v.getBoundingClientRect().right > v.closest('.stats-section').getBoundingClientRect().right + 1).map(v => v.innerText)};""")
            assert "Verdana" in fit["family"] and not fit["spill"], fit
            ragged = driver.execute_script(STATS_VALUE_COLUMNS_JS)
            assert not ragged, f"Value labels do not line up in a wide font: {ragged}"
            # No two labels on a bar chart's axis touch in the wide font, on a 320px phone, at 660px (where Figure 5's
            # name and three value columns leave its bars narrowest) and on a desktop.
            for narrow in (1280, 660, 320):
                driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": narrow, "height": 900, "deviceScaleFactor": 1, "mobile": narrow < 640})
                touching = driver.execute_script(STATS_AXIS_TOUCHING_JS)
                assert not touching, f"At {narrow}px in a wide font axis labels touch: {touching}"
                assert driver.execute_script(STATS_AXIS_EVEN), f"At {narrow}px in a wide font a gridline is unlabelled or labels sit unevenly"
        finally:
            driver.execute_cdp_cmd("Page.removeScriptToEvaluateOnNewDocument", {"identifier": wide["identifier"]})
    finally:
        driver.execute_cdp_cmd("Page.removeScriptToEvaluateOnNewDocument", {"identifier": injected["identifier"]})
        driver.execute_cdp_cmd("Emulation.clearDeviceMetricsOverride", {})
        driver.execute_cdp_cmd("Emulation.setEmulatedMedia", {"media": "", "features": []})
    return {"route": "stats-new-figures", "passed": True}


TEAM_STATIONS = ("papers", "reading", "check", "catlog", "human", "critique", "rules", "website", "paper")


# Words in visible text under a root that span two line boxes (a Range over the word has rects on two lines); details
# under the root are opened first when asked, so their text is laid out.
SPLIT_WORDS_JS = """
const [root, pattern, open] = arguments;
if (!root) return null;
if (open) root.querySelectorAll('details').forEach((d) => { d.open = true; });
const found = [];
const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
for (let node = walker.nextNode(); node; node = walker.nextNode()) {
  const re = new RegExp(pattern, 'g');
  for (let m = re.exec(node.nodeValue); m; m = re.exec(node.nodeValue)) {
    const range = document.createRange();
    range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
    const tops = [];
    for (const r of range.getClientRects()) if (r.width > 0.5 && r.height > 0.5 && !tops.some((t) => Math.abs(t - r.top) < 2)) tops.push(r.top);
    if (tops.length > 1) found.push(`${m[0]} in "${node.nodeValue.trim().slice(0, 60)}"`);
  }
}
return found;
"""

# Figure 5 (enzyme classes) on a phone: each value heading's lines and widths, whether the value headings fit their
# column, and each class name's lines and full width against its label column.
FIG5_JS = """
const sec = document.querySelector('[data-chart="ec-classes"]');
if (!sec) return null;
const lines = (range) => { const tops = []; for (const r of range.getClientRects()) if (r.width > 0.5 && r.height > 0.5 && !tops.some((t) => Math.abs(t - r.top) < 2)) tops.push(r.top); return tops.length; };
const width = (range) => [...range.getClientRects()].reduce((sum, r) => sum + r.width, 0);
const label = sec.querySelector('.stats-chart-row .stats-chart-label').getBoundingClientRect().width;
const line = sec.querySelector('.stats-chart-head .stats-chart-value');
const parts = [...line.children];
const gap = parseFloat(getComputedStyle(line).columnGap) || 0;
const heads = parts.map((part) => { const r = document.createRange(); r.selectNodeContents(part.querySelector('span')); return { text: part.innerText.replace(/\\s+/g, ' ').trim(), lines: lines(r) }; });
const names = [...sec.querySelectorAll('.stats-ec-name')].map((el) => {
  const node = [...el.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim());
  const word = node.nodeValue.trim(), start = node.nodeValue.indexOf(word), r = document.createRange();
  r.setStart(node, start); r.setEnd(node, start + word.length);
  return { name: word, lines: lines(r), width: width(r) };
});
return { label, heads, names, column: line.getBoundingClientRect().width,
         used: parts.reduce((sum, part) => sum + part.getBoundingClientRect().width, 0) + gap * (parts.length - 1) };
"""


def assert_fig5_fits(fig5, width):
    """Below 360px a value heading of two words (From paper, Read from the paper's short tag) takes two lines, so its
    column is no wider than its longest word or count and the class names keep their room; from 360px Read from the paper
    takes two lines (Read from / the paper) and the other headings one. The headings fit their
    column, and a class name that fits its label column is never cut inside the word (only one wider than the whole
    column may break, as Oxidoreductases does at 320px in DejaVu Sans)."""
    if not fig5:
        return
    for head in fig5["heads"]:
        # (Read from the paper takes two lines from 360px, and its short tag, From paper, two below: round 15 polish)
        assert head["lines"] == (2 if " " in head["text"] else 1), (width, fig5["heads"])
    assert fig5["used"] <= fig5["column"] + 1, f"Figure 5's value headings overflow their column at {width}px: {fig5}"
    cut = [name for name in fig5["names"] if name["lines"] > 1 and name["width"] <= fig5["label"] - 1]
    assert not cut, f"Figure 5 cuts class names that fit their {fig5['label']:.0f}px column at {width}px: {cut}"


# CatLog and BRENDA by publication year (round 16): the manifest's summary.publication_years as catlog-v2's build writes it
# (here the approved figure's numbers of 2026-10-21: BRENDA 2026.1's values per publication year, CatLog's values read so
# far), set before the page starts in Chrome when the snapshot has none, or taken out, or damaged.
_YEARS_BRENDA = (6561, 6408, 6983, 9419, 10460, 11154, 11031, 11875, 13934, 14970, 14254, 11139, 12116, 11563, 11583, 11222,
                 9859, 10469, 10163, 9133, 8819, 6641, 3997, 2307, 1292, 500)
_YEARS_CATLOG = (5746, 5015, 6971, 8404, 10309, 9120, 8618, 10001, 9386, 10167, 9685, 7358, 8599, 7971, 8111, 7133, 5569, 7071,
                 6851, 5906, 4541, 3415, 1812, 1076, 791, 447)
_YEARS_PAPERS = (161, 146, 157, 246, 273, 255, 209, 255, 250, 265, 263, 217, 230, 206, 228, 200, 182, 187, 204, 164, 134, 89, 48,
                 26, 22, 22)
# BRENDA's papers per year (catlog-v2 from 2026-10-22, sources/brenda_values_by_year_2026_1.tsv's brenda_papers)
_YEARS_BRENDA_PAPERS = (906, 838, 945, 1085, 1254, 1205, 1218, 1324, 1452, 1317, 1200, 946, 898, 928, 876, 874, 833, 770, 815, 751,
                        705, 517, 372, 224, 123, 39)
PUBLICATION_YEARS_FIXTURE = {
    "brenda_release": "BRENDA 2026.1", "as_of": "2026-10-21", "first_year": 2000, "last_year": 2025,
    "years": [{"year": 2000 + index, "brenda_values": brenda, "brenda_papers": brenda_papers, "catlog_values": catlog, "catlog_papers": papers}
              for index, (brenda, brenda_papers, catlog, papers) in enumerate(zip(_YEARS_BRENDA, _YEARS_BRENDA_PAPERS, _YEARS_CATLOG, _YEARS_PAPERS))],
    "brenda_papers_total": 22415,
    "catlog_values_total": 217969, "catlog_papers_total": 6116, "catlog_values_without_year": 5607,
    "catlog_after_last_year": {"values": 9086, "papers": 349},
    # what catlog-v2's build adds (tools/publication_years.py): the parts then make the totals exactly
    "catlog_papers_without_year": 172, "catlog_before_first_year": {"values": 33203, "papers": 956},
    "definition": "kcat, Km and kcat/Km values per publication year of the source paper, 2000-2025.",
}
PUBLICATION_YEARS_JS = """
    Object.defineProperty(window, "CATLOG_STATIC_MANIFEST", { configurable: true, get() { return undefined; },
      set(value) {
        const summary = value?.summary;
        if (summary) { %s }
        Object.defineProperty(window, "CATLOG_STATIC_MANIFEST", { value, writable: true, configurable: true });
      } });
"""
# The layout facts: the placed labels (inside the plot, apart from each other, clear of every dot and of both lines, each
# count over or under its own dot), the key shown only while a name has no place, the marks per year, the strokes'
# contrast on white and on the band, and the figure's place in What is in the catalog.
PUBLICATION_YEARS_LAYOUT_JS = """
const section = document.querySelector('[data-figure="publication-years"]');
if (!section) return null;
const plot = section.querySelector('.stats-years-plot');
const frame = plot.getBoundingClientRect();
const box = (e) => { const r = e.getBoundingClientRect(); return {l: r.left - frame.left, t: r.top - frame.top, r: r.right - frame.left, b: r.bottom - frame.top}; };
const dots = [...section.querySelectorAll('.stats-years-dot')].map((dot) => { const b = box(dot); return {series: dot.dataset.series, x: (b.l + b.r) / 2, y: (b.t + b.b) / 2, open: dot.classList.contains('is-open'), year: dot.dataset.hl}; });
const lines = {};
dots.forEach((dot) => (lines[dot.series] = lines[dot.series] || []).push(dot));
const crosses = (r, a, b) => {
  let lo = 0, hi = 1; const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - r.l], [dx, r.r - a.x], [-dy, a.y - r.t], [dy, r.b - a.y]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p; if (p < 0) { if (t > hi) return false; lo = Math.max(lo, t); } else { if (t < lo) return false; hi = Math.min(hi, t); }
  }
  return true;
};
const problems = [];
const labels = [...section.querySelectorAll('.stats-years-label.is-placed')].map((label) => ({label, text: label.textContent, ...box(label)}));
labels.forEach((one, index) => {
  if (one.l < -1 || one.t < -1 || one.r > frame.width + 1 || one.b > frame.height + 1) problems.push(`${one.text} leaves the plot`);
  labels.slice(index + 1).forEach((other) => { if (one.l < other.r && other.l < one.r && one.t < other.b && other.t < one.b) problems.push(`${one.text} covers ${other.text}`); });
  if (dots.some((dot) => dot.x > one.l && dot.x < one.r && dot.y > one.t && dot.y < one.b)) problems.push(`${one.text} covers a dot`);
  Object.values(lines).forEach((list) => list.slice(1).forEach((point, i) => { if (crosses({l: one.l + 1, t: one.t + 1, r: one.r - 1, b: one.b - 1}, list[i], point)) problems.push(`${one.text} crosses a line`); }));
  if (one.label.classList.contains('stats-years-count')) {
    const dot = lines.brenda[Number(one.label.dataset.index)];
    if (!(dot.x >= one.l && dot.x <= one.r && (dot.y <= one.t || dot.y >= one.b)) || dot.year === undefined) problems.push(`${one.text} stands away from its dot`);
    const tip = section.querySelectorAll('.stats-years-col')[Number(one.label.dataset.index)].dataset.tip.split(';')[0];
    if (!tip.endsWith(`, ${one.text} values`) && !tip.includes(`, ${one.text} values from `)) problems.push(`${one.text} is not its year's count`);
  }
});
const figure = section.querySelector('.stats-fig');
const key = section.querySelector('.stats-years-key');
const rgb = (text) => (text.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const band = section.querySelector('.stats-years-band');
const bandColour = band ? rgb(getComputedStyle(band).backgroundColor) : [255, 255, 255];
const strokes = [...section.querySelectorAll('.stats-years-line')].map((line) => rgb(getComputedStyle(line).stroke));
const order = [...document.querySelectorAll("#statsCharts [data-part='catalog'] .stats-figure-section")].map((e) => e.dataset.figure);
return {problems, labelled: figure.classList.contains('is-labelled'), keyShown: Boolean(key.getClientRects().length),
  placed: labels.map((one) => one.text), names: [...section.querySelectorAll('.stats-years-name')].map((e) => e.textContent),
  dots: dots.length, open: dots.filter((dot) => dot.open).length, columns: [...section.querySelectorAll('.stats-years-col')].map((col) => col.dataset.tip),
  columnWidths: [...section.querySelectorAll('.stats-years-col')].map((col) => Math.round(col.getBoundingClientRect().width * 10) / 10),
  plotWidth: frame.width, bandLeft: band ? box(band).l : null,
  contrast: strokes.map((stroke) => [contrast(stroke, [255, 255, 255]), contrast(stroke, bandColour)]),
  between: strokes.length === 2 ? contrast(strokes[0], strokes[1]) : 0,
  note: section.querySelector('.stats-years-note').textContent, caption: section.querySelector('.stats-fig-caption').textContent,
  aria: plot.getAttribute('role') === 'img' ? plot.getAttribute('aria-label') : '', order,
  overflow: document.documentElement.scrollWidth > innerWidth + 1 || (v => v.scrollWidth > v.clientWidth + 1)(document.getElementById('statsView')),
  lastTick: (() => { const t = [...section.querySelectorAll('.stats-years-x > span')].pop().getBoundingClientRect(); return t.right <= section.getBoundingClientRect().right + 1; })(),
  rules: [...document.querySelectorAll('.stats-method-figures > div')].map((row) => row.textContent.replace(/\\s+/g, ' ').trim()).find((text) => /by publication year/.test(text)) || ''};
"""


def publication_years_valid(field):
    """Whether the page draws CatLog and BRENDA by publication year from this field (statsPublicationYears' rules)."""
    whole = lambda value, top=None: isinstance(value, int) and not isinstance(value, bool) and value >= 0 and (top is None or value <= top)
    if not isinstance(field, dict):
        return False
    first, last, years = field.get("first_year"), field.get("last_year"), field.get("years")
    if not (isinstance(first, int) and isinstance(last, int) and last - first >= 4 and isinstance(years, list) and len(years) == last - first + 1):
        return False
    if not all(isinstance(item, dict) and item.get("year") == first + index and whole(item.get("brenda_values")) and whole(item.get("catlog_values"))
               and whole(item.get("catlog_papers"), item.get("catlog_values")) for index, item in enumerate(years)):
        return False
    after = field.get("catlog_after_last_year") or {}
    numbers = [field.get("catlog_values_total"), field.get("catlog_papers_total"), field.get("catlog_values_without_year"), after.get("values"), after.get("papers")]
    if not str(field.get("brenda_release") or "").strip() or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(field.get("as_of") or "")) or not all(map(whole, numbers)):
        return False
    values, papers, undated = numbers[:3]
    drawn_values, drawn_papers = sum(item["catlog_values"] for item in years), sum(item["catlog_papers"] for item in years)
    if not (after["papers"] <= after["values"] and drawn_values + after["values"] + undated <= values
            and drawn_papers + after["papers"] <= papers and any(item["brenda_values"] for item in years)):
        return False
    # catlog-v2's build also gives the values before first_year and the papers with no year: then the parts make the totals.
    before = field.get("catlog_before_first_year")
    if "catlog_before_first_year" in field:
        if not (isinstance(before, dict) and whole(before.get("values")) and whole(before.get("papers"), before.get("values"))
                and drawn_values + after["values"] + undated + before["values"] == values):
            return False
    if "catlog_papers_without_year" in field:
        undated_papers = field["catlog_papers_without_year"]
        if not whole(undated_papers, undated) or (undated > 0) != (undated_papers > 0):
            return False
        parts = drawn_papers + after["papers"] + undated_papers + (before["papers"] if isinstance(before, dict) else 0)
        if parts > papers or (isinstance(before, dict) and parts != papers):
            return False
    return True


def publication_years_brenda_papers(field):
    """BRENDA's papers over the years drawn when every year has its count (no more than its values) and they make
    brenda_papers_total, else None (statsPublicationYears' rule)."""
    whole = lambda value, top=None: isinstance(value, int) and not isinstance(value, bool) and value >= 0 and (top is None or value <= top)
    total, years = field.get("brenda_papers_total"), field["years"]
    if not whole(total) or not total or not all(whole(item.get("brenda_papers"), item["brenda_values"]) for item in years):
        return None
    return total if sum(item["brenda_papers"] for item in years) == total else None


def publication_years_caption(field):
    """The figure's caption, from the field: the reading order (round 16b), then the band, then CatLog's values before the
    first year (when the build gives them) and after the last year, so the lines and the caption add up to the note above
    the plot."""
    order = ("CatLog reads the papers the databases cite for the most values first, and papers no database cites as well, "
             "so its line does not show how much of BRENDA it covers. ")
    shade = field.get("shaded_from") if isinstance(field.get("shaded_from"), int) else 2020
    plural = lambda count, word: f"{count:,} {word}{'' if count == 1 else 's'}"
    parts = [(part, when) for part, when in ((field.get("catlog_before_first_year"), f"published before {field['first_year']}"),
                                             (field["catlog_after_last_year"], f"published after {field['last_year']}")) if part and part["values"]]
    outside = [f"{plural(part['values'], 'value') if not index else format(part['values'], ',')} from {plural(part['papers'], 'paper')} {when}"
               for index, (part, when) in enumerate(parts)]
    words = ([f"BRENDA is still adding papers from the shaded years ({shade} on)"] if field["first_year"] < shade <= field["last_year"] else []) \
        + ([f"CatLog also has {' and '.join(outside)}"] if outside else [])
    return order + ("; ".join(words) + "." if words else f"Values per publication year of their paper in {field['brenda_release']} and read by CatLog.")


def check_stats_years(driver, browser, url):
    """CatLog and BRENDA by publication year: drawn from the manifest's summary.publication_years when its counts hold
    together, else left out with the rest of Stats unchanged (no field, a year missing, more values in the parts than in
    CatLog's total, or, with the build's values before the first year, parts that do not make the total). In What is in
    the catalog after Records by main source; the caption, the note above the plot, the tooltip line per year, open dots for the shaded years, the lines' contrast on white and on the band, the counting
    rules in How these numbers are counted; the labels placed apart and clear of the lines and dots at 1440, 375 and
    320px, the key shown only when a name finds no room; pointing at a year (Chrome) gives its line and grows its dots.
    Chrome sets the approved figure's numbers when the snapshot has none and also checks the figure left out; Safari
    checks the snapshot's own field, at its window size."""
    wait = WebDriverWait(driver, 60, ignored_exceptions=(StaleElementReferenceException,))
    stats_url = url.replace("catlog-latest.html", "catlog-stats.html")
    fill = "if (!summary.publication_years) summary.publication_years = %s;" % json.dumps(PUBLICATION_YEARS_FIXTURE)
    variants = [("filled", fill), ("missing", "delete summary.publication_years;"), ("short", fill + " summary.publication_years.years.pop();"),
                ("too many", fill + " summary.publication_years.catlog_values_total = 1;"),
                ("parts", fill + " summary.publication_years.catlog_before_first_year.values += 1;"),
                ("no BRENDA papers", fill + " delete summary.publication_years.brenda_papers_total;")] if browser == "chrome" else [("snapshot", "")]
    results = {}
    for name, patch in variants:
        injected = driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": PUBLICATION_YEARS_JS % patch}) if patch else None
        try:
            sizes = ((1440, 1000), (375, 812), (320, 700)) if name == "filled" else ((1440, 1000),) if browser == "chrome" else ((0, 0),)
            for width, height in sizes:
                if browser == "chrome":
                    driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": width < 640})
                    driver.get_log("browser")
                driver.get("about:blank")
                driver.get(stats_url)
                wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, "#statsCharts [data-figure='status']"))
                driver.execute_script("return document.fonts ? document.fonts.ready.then(() => true) : true")
                field = driver.execute_script("return window.CATLOG_STATIC_MANIFEST.summary.publication_years || null")
                drawn = publication_years_valid(field)
                if browser == "chrome":
                    errors = [entry["message"] for entry in driver.get_log("browser") if entry["level"] == "SEVERE" and entry.get("source") != "network"]
                    assert not errors, f"{name}: {errors}"
                assert driver.find_elements(By.CSS_SELECTOR, "#statsCharts [data-figure='ec-classes']"), f"{name}: Stats stops short"
                section = driver.find_elements(By.CSS_SELECTOR, "#statsCharts [data-figure='publication-years']")
                assert bool(section) == drawn, f"{name}: figure drawn {bool(section)}, field usable {drawn}"
                if name == "filled":
                    assert drawn
                if not section:
                    results[name] = "left out"
                    break
                driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", section[0])
                facts = wait.until(lambda d: d.execute_script(PUBLICATION_YEARS_LAYOUT_JS))
                years, release, last = field["years"], field["brenda_release"], field["last_year"]
                shade = field.get("shaded_from") if isinstance(field.get("shaded_from"), int) else 2020
                assert not facts["problems"], f"{name} at {width}px: {facts['problems']}"
                assert facts["order"].index("main-source") < facts["order"].index("publication-years") < facts["order"].index("ec-classes"), facts["order"]
                assert facts["caption"] == f"Figure {facts['order'].index('publication-years') + 1}. {publication_years_caption(field)}", facts["caption"]
                brenda_papers = publication_years_brenda_papers(field)
                beside = (f" From {field['first_year']} to {last}, CatLog’s values come from {sum(item['catlog_papers'] for item in years):,} papers and "
                          f"{release}’s from {brenda_papers:,}.") if brenda_papers else ""
                assert facts["note"].startswith("CatLog on ") and facts["note"].endswith(f": {field['catlog_values_total']:,} values from {field['catlog_papers_total']:,} papers{beside}"), facts["note"]
                assert (name != "filled" or beside) and (name != "no BRENDA papers" or not beside), (name, facts["note"])
                assert facts["dots"] == 2 * len(years) and facts["open"] == (2 * (last - shade + 1) if field["first_year"] < shade <= last else 0), facts
                assert facts["columns"] == [f"{item['year']}: {release}, {item['brenda_values']:,} value{'' if item['brenda_values'] == 1 else 's'}"
                                            f"{(' from ' + format(item['brenda_papers'], ',') + ' paper' + ('' if item['brenda_papers'] == 1 else 's')) if brenda_papers else ''}; CatLog, "
                                            f"{item['catlog_values']:,} value{'' if item['catlog_values'] == 1 else 's'} from {item['catlog_papers']:,} "
                                            f"paper{'' if item['catlog_papers'] == 1 else 's'}" for item in years], facts["columns"][:2]
                assert max(facts["columnWidths"]) - min(facts["columnWidths"]) <= 1 and abs(sum(facts["columnWidths"]) - facts["plotWidth"]) <= 2, facts["columnWidths"]
                assert all(on_white >= 3 and on_band >= 3 for on_white, on_band in facts["contrast"]), facts["contrast"]
                # the two lines differ in lightness too, so they stay apart in print and greyscale where they cross
                assert facts["between"] >= 2, facts["between"]
                assert facts["keyShown"] != facts["labelled"], facts
                assert not facts["labelled"] or set(facts["names"]) <= set(facts["placed"]), facts
                assert facts["lastTick"] and not facts["overflow"], f"{name} overflows at {width}px"
                assert f"{release}: " in facts["aria"] and f"{last}" in facts["aria"], facts["aria"]
                assert facts["rules"].startswith(f"Figure {facts['order'].index('publication-years') + 1}") and "PubMed publication year" in facts["rules"] \
                    and "a paper without a PubMed ID in the year BRENDA gives, for CatLog and BRENDA alike" in facts["rules"], facts["rules"]
                undated = field["catlog_values_without_year"]
                assert (f"{undated:,} value{'' if undated == 1 else 's'} from papers with no publication year" in facts["rules"]) == bool(undated), facts["rules"]
                if name == "filled":
                    # The approved numbers leave room for every label from 641px; on a phone both names fit in a narrow
                    # font, while a wide one (Linux's) may take the key instead (keyShown, checked above).
                    assert facts["labelled"] or width < 641, (width, facts["placed"])
                    if width >= 1024:
                        assert sorted(facts["placed"]) == sorted(["14,970", "9,133", release, "CatLog, read so far"]), facts["placed"]
                    if width == 1440 and browser == "chrome":
                        column = driver.find_elements(By.CSS_SELECTOR, "[data-figure='publication-years'] .stats-years-col")[9]
                        # (from the note above the plot first, so the pointer always moves into the column, wherever an
                        # earlier check left it)
                        note = driver.find_element(By.CSS_SELECTOR, "[data-figure='publication-years'] .stats-years-note")
                        ActionChains(driver).move_to_element(note).move_to_element(column).perform()
                        wait.until(lambda d: d.execute_script("const t = document.getElementById('statsTip'); return !t.hidden && t.textContent === arguments[0]", facts["columns"][9]))
                        lit = driver.execute_script("return [...document.querySelectorAll('[data-figure=\"publication-years\"] .is-active')].map((e) => e.className)")
                        assert sum("stats-years-dot" in item for item in lit) == 2 and any("stats-years-col" in item for item in lit), lit
                driver.save_screenshot(str(OUTPUT / f"{browser}-stats-years-{name.replace(' ', '-')}-{width}.png"))
                results[name] = "drawn"
        finally:
            if injected:
                driver.execute_cdp_cmd("Page.removeScriptToEvaluateOnNewDocument", {"identifier": injected["identifier"]})
            if browser == "chrome":
                driver.execute_cdp_cmd("Emulation.clearDeviceMetricsOverride", {})
    return {"route": "stats-years", **results}


def check_word_breaks(driver, browser, url):
    """Round 8's labels never break inside a word: "re-read" never splits at its hyphen ("re-" at the end of one line,
    "read" on the next) in Stats' figure titles and captions or in the Guide, at a phone, a small phone and a tablet;
    Figure 5's class names stay whole beside its value headings (assert_fig5_fits), also when a 320px phone turns to
    375px (the value columns are fitted again)."""
    if browser != "chrome":
        return "skipped (Chrome only: phone widths by device emulation)"
    wait = WebDriverWait(driver, 60, ignored_exceptions=(StaleElementReferenceException,))
    checked = []
    try:
        for width in (320, 375, 768):
            driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": width, "height": 900, "deviceScaleFactor": 1,
                                                                          "mobile": width < 768})
            driver.get("about:blank")
            driver.get(url.replace("catlog-latest.html", "catlog-stats.html"))
            wait.until(lambda d: d.find_elements(By.ID, "statsVersionsTitle"))
            driver.execute_async_script("const done = arguments[arguments.length - 1]; document.fonts.ready.then(() => setTimeout(done, 300))")
            assert driver.execute_script(SPLIT_WORDS_JS, driver.find_element(By.ID, "statsVersionsTitle"), "re-read", False) == [], width
            # (the supplement's captions too, its items opened)
            open_stats_supplement(driver)
            split = driver.execute_script(SPLIT_WORDS_JS, driver.find_element(By.ID, "statsCharts"), "re-read", False)
            assert split == [], f"re-read splits at its hyphen on Stats at {width}px: {split}"
            assert_fig5_fits(driver.execute_script(FIG5_JS), width)
            driver.get("about:blank")
            driver.get(url + "#guide-method")
            wait.until(lambda d: d.find_element(By.ID, "guideView").is_displayed())
            driver.execute_async_script("const done = arguments[arguments.length - 1]; document.fonts.ready.then(() => setTimeout(done, 300))")
            split = driver.execute_script(SPLIT_WORDS_JS, driver.find_element(By.ID, "guideView"), "re-read", True)
            assert split == [], f"re-read splits at its hyphen in the Guide at {width}px: {split}"
            checked.append(width)
        # A phone turned from 320 to 375px: From paper gives way to Read from / the paper and the value columns are fitted again.
        driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": 320, "height": 900, "deviceScaleFactor": 1, "mobile": True})
        driver.get("about:blank")
        driver.get(url.replace("catlog-latest.html", "catlog-stats.html"))
        wait.until(lambda d: d.find_elements(By.ID, "statsVersionsTitle"))
        driver.execute_async_script("const done = arguments[arguments.length - 1]; document.fonts.ready.then(() => setTimeout(done, 300))")
        driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": 375, "height": 900, "deviceScaleFactor": 1, "mobile": True})
        driver.execute_async_script("const done = arguments[arguments.length - 1]; requestAnimationFrame(() => setTimeout(done, 300))")
        assert_fig5_fits(driver.execute_script(FIG5_JS), 375)
    finally:
        driver.execute_cdp_cmd("Emulation.clearDeviceMetricsOverride", {})
    return {"re_read_whole_at": checked, "fig5_whole_at": checked + ["320 to 375"]}


def check_team(driver, browser, url):
    """Team (#team): its own view from the Team tab, never loading the record index; the loop names every station, its
    numbers come from the manifest, a person or agent lights their stations when pointed at or focused, it reads at
    375px with no sideways scroll, and the dots stay still when the viewer asks for less motion."""
    wait = WebDriverWait(driver, 60, ignored_exceptions=(StaleElementReferenceException,))
    set_browse_viewport(driver, browser, 1440, 1000)
    driver.get("about:blank")
    driver.get(url + "#team")
    wait.until(lambda d: d.find_element(By.ID, "teamView").is_displayed() and d.find_elements(By.CSS_SELECTOR, ".team-legend-item"))
    assert driver.title == "Team | CatLog"
    assert driver.find_element(By.ID, "teamButton").get_attribute("aria-current") == "page"
    assert not driver.find_element(By.ID, "catalogView").is_displayed()
    assert not driver.execute_script(
        "return performance.getEntriesByType('resource').some(e => /catlog-viewer-index|catlog-table|details-\\d+|human-review-marks/.test(e.name))"
    ), "Team must not download the record index, detail shards or review marks"
    assert driver.find_element(By.ID, "teamHeading").text == "People behind CatLog"
    text = driver.find_element(By.ID, "teamView").text
    for word in ("Claude", "Codex", "Anthropic", "OpenAI", "independent", "Dr.", "Professor"):
        assert word not in text, f"Team says {word}"
    # CatLog re-verifies published values: no agent downloads, fetches or collects papers (round 13).
    assert "reads enzyme kinetics from the original papers, mostly those the enzyme databases cite" in text and not re.search(r"(?i)download|fetch|collect", text), text[:600]
    wide = driver.find_element(By.CSS_SELECTOR, "svg.team-loop-wide")
    assert wide.is_displayed()
    # Supantha also stands at Website (he builds the website): a second chip with its own line to that station, lit with
    # his first, with no tab stop of its own.
    also = wide.find_elements(By.CSS_SELECTOR, ".team-actor-also[data-actor='supantha']")
    assert len(also) == 1 and also[0].get_attribute("aria-hidden") == "true" and also[0].get_attribute("tabindex") is None, \
        "Supantha's second chip stands at Website"
    assert driver.execute_script("""
        const chip = arguments[0].querySelector('.team-chip').getBoundingClientRect();
        const dot = document.querySelector("svg.team-loop-wide [data-station='website'] .team-station-dot").getBoundingClientRect();
        return Math.abs((chip.left + chip.right) / 2 - (dot.left + dot.right) / 2) < 4 && chip.bottom < dot.top;
    """, also[0]), "Supantha's second chip stands above the Website station"
    # Each chip is as wide as its name in the page's own font plus room each side (fix pass after round 16b: a width
    # guessed from the letters left "Mohammad" about 3px a side in DejaVu Sans).
    pads = driver.execute_script("""return [...document.querySelectorAll('svg.team-loop-wide .team-actor')].map(actor => {
        const chip = actor.querySelector('.team-chip').getBoundingClientRect(), text = actor.querySelector('text').getBoundingClientRect();
        return [actor.dataset.actor, Math.round(text.left - chip.left), Math.round(chip.right - text.right)]; })""")
    assert pads and all(min(left, right) >= 8 and abs(left - right) <= 2 for _, left, right in pads), pads
    assert sorted(g.get_attribute("data-station") for g in wide.find_elements(By.CSS_SELECTOR, "[data-station]")) == sorted(TEAM_STATIONS)
    manifest = driver.execute_script("return window.CATLOG_STATIC_MANIFEST")
    overview = stats_overview(manifest)
    if overview:
        reading = wide.find_element(By.CSS_SELECTOR, "[data-station='reading']").get_attribute("aria-label")
        assert f"{overview['from_paper']['records']:,} records" in reading and f"{overview['from_paper']['papers']:,} papers read" in reading
    assert f"{manifest['total_rows']:,} records" in wide.find_element(By.CSS_SELECTOR, "[data-station='website']").get_attribute("aria-label")
    # The svg is named without a <title>, which would show as a tooltip over the whole drawing; a station's label reads
    # a wrapped fact as one phrase.
    assert not driver.find_elements(By.CSS_SELECTOR, "svg.team-loop > title") and wide.get_attribute("aria-label")
    assert ", by " not in wide.find_element(By.CSS_SELECTOR, "[data-station='catlog']").get_attribute("aria-label")
    # No station's label crowds another's, the track or the chips: Human check's lines stand apart from CatLog's.
    assert driver.execute_script(TEAM_LABELS_CLEAR, "wide", 12) == [], driver.execute_script(TEAM_LABELS_CLEAR, "wide", 12)
    # AI critique (round 14): in the lower-left corner, outside the loop, Vaishnavey's chip under it in the people's row,
    # its dashed line rising to Rules updated with a chevron pointing there; Vaishnavey's legend line lights it.
    critique = driver.execute_script(TEAM_CRITIQUE_JS, "wide")
    assert critique["outside"] and critique["leftOfRules"] and critique["belowTrack"] and critique["chipUnder"] \
        and critique["rowLevel"] and critique["towardsRules"] and critique["inFigure"], critique
    # Legend lines are toggle buttons, not bare focusable list items: pressing Aarna and Erin's keeps Human check lit,
    # pressing Supantha's moves the light to his stations, and pressing it again turns it off.
    lit_js = "return [...document.querySelectorAll('svg.team-loop-wide [data-station].is-lit')].map(e => e.dataset.station)"
    assert not driver.find_elements(By.CSS_SELECTOR, ".team-legend-item[tabindex]")
    legend = driver.find_element(By.CSS_SELECTOR, ".team-legend-item[data-actor='aarna erin'] button[aria-pressed]")
    driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", legend)
    legend.click()
    # Focus leaves the button without scrolling the page: a scroll would slide another legend line (Supantha's, whose
    # line grew in round 13) under the resting pointer, and Chrome's pointerover after a scroll would light his stations.
    driver.execute_script("document.querySelector('#teamHeading').focus({preventScroll: true})")
    assert driver.execute_script(lit_js) == ["human"], driver.execute_script(lit_js)
    assert legend.get_attribute("aria-pressed") == "true"
    # Supantha's line meets Rules updated; his legend line also lights Papers, CatLog and the website.
    supantha = driver.find_element(By.CSS_SELECTOR, ".team-legend-item[data-actor='supantha'] button")
    supantha.click()
    assert sorted(driver.execute_script(lit_js)) == ["catlog", "papers", "rules", "website"], driver.execute_script(lit_js)
    assert legend.get_attribute("aria-pressed") == "false" and supantha.get_attribute("aria-pressed") == "true"
    vaishnavey = driver.find_element(By.CSS_SELECTOR, ".team-legend-item[data-actor='vaishnavey'] button")
    driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", vaishnavey)
    vaishnavey.click()
    assert driver.execute_script(lit_js) == ["critique"], driver.execute_script(lit_js)
    assert vaishnavey.get_attribute("aria-pressed") == "true" and supantha.get_attribute("aria-pressed") == "false"
    supantha.send_keys(Keys.SPACE)
    wait.until(lambda d: supantha.get_attribute("aria-pressed") == "true")
    supantha.send_keys(Keys.SPACE)
    wait.until(lambda d: supantha.get_attribute("aria-pressed") == "false")
    driver.execute_script("arguments[0].dispatchEvent(new PointerEvent('pointerout', {bubbles: true}))", supantha)
    assert driver.execute_script(lit_js) == [], driver.execute_script(lit_js)
    # Pointing at an agent on the figure lights its station.
    chip = wide.find_element(By.CSS_SELECTOR, ".team-actor[data-actor='reading'] rect")
    if browser == "chrome":
        ActionChains(driver).move_to_element(chip).perform()
    else:
        driver.execute_script("arguments[0].dispatchEvent(new PointerEvent('pointerover', {bubbles: true}))", chip)
    wait.until(lambda d: d.execute_script("return [...document.querySelectorAll('svg.team-loop-wide [data-station].is-lit')].map(e => e.dataset.station).join()") == "reading")
    # the visible text only (Safari's driver also returns the hidden phone sentence)
    caption = driver.execute_script("return arguments[0].innerText", driver.find_element(By.CSS_SELECTOR, ".team-figure figcaption"))
    assert "Point at or tab to a person" in caption and "The list of" not in caption, caption
    assert_document_stays(driver, "Team")
    driver.save_screenshot(str(OUTPUT / f"{browser}-team-desktop.png"))
    # The Guide's link to Team opens it as the tab does, with focus on its heading (not left on the page body).
    driver.get("about:blank")
    driver.get(url + "#guide-method")
    link = wait.until(lambda d: d.find_element(By.CSS_SELECTOR, '#guide-method a[href$="#team"]'))
    driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", link)
    link.click()
    wait.until(lambda d: d.execute_script("return document.body.classList.contains('team-open') && document.activeElement?.id === 'teamHeading'"))
    if browser == "chrome":
        driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": 375, "height": 812, "deviceScaleFactor": 1, "mobile": True})
        driver.execute_cdp_cmd("Emulation.setEmulatedMedia", {"features": [{"name": "prefers-reduced-motion", "value": "reduce"}]})
        try:
            driver.get("about:blank")
            driver.get(url + "#team")
            wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, ".team-legend-item"))
            assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth + 1"), "Team overflows sideways"
            narrow = driver.find_element(By.CSS_SELECTOR, "svg.team-loop-narrow")
            assert narrow.is_displayed() and not driver.find_element(By.CSS_SELECTOR, "svg.team-loop-wide").is_displayed()
            assert narrow.size["width"] <= 375 and narrow.size["width"] >= 300
            # Every label of the upright loop prints at 12px or more, down to a 320px phone.
            labels_px = """
                return Math.min(...[...document.querySelectorAll('svg.team-loop-narrow text')].map(e => parseFloat(getComputedStyle(e).fontSize) * e.ownerSVGElement.getScreenCTM().a));
            """
            assert driver.execute_script(labels_px) >= 12 - 0.05, f"Team labels read at phone width: {driver.execute_script(labels_px)}px"
            assert driver.execute_script(TEAM_LABELS_CLEAR, "narrow", 12) == [], driver.execute_script(TEAM_LABELS_CLEAR, "narrow", 12)
            assert not driver.find_elements(By.CSS_SELECTOR, ".team-dots circle, .team-loop animateMotion"), "Nothing moves round the loop"
            # The upright loop draws no people or agents, so its caption points to the list instead.
            caption = driver.execute_script("return arguments[0].innerText", driver.find_element(By.CSS_SELECTOR, ".team-figure figcaption"))
            assert "The list says where each person and agent works" in caption and "Point at" not in caption, caption
            critique = driver.execute_script(TEAM_CRITIQUE_JS, "narrow")
            assert critique["towardsRules"] and critique["inFigure"], critique
            # The phone header as on Stats: the links out beside Download, the four tabs on their own line under it.
            assert driver.execute_script("""
                const top = (s) => document.querySelector(s).getBoundingClientRect();
                const links = top('.external-nav'), actions = top('.header-actions'), nav = top('.top-nav');
                return Math.abs(links.top - actions.top) < 24 && nav.top >= links.bottom - 1;
            """), "Team header: links out beside Download, tabs below"
            assert_document_stays(driver, "Team at 375px")
            driver.save_screenshot(str(OUTPUT / f"{browser}-team-mobile.png"))
            driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": 320, "height": 640, "deviceScaleFactor": 1, "mobile": True})
            wait.until(lambda d: d.execute_script("return innerWidth") == 320)
            assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth + 1"), "Team overflows sideways at 320px"
            assert driver.execute_script(labels_px) >= 12 - 0.05, f"Team labels at 320px: {driver.execute_script(labels_px)}px"
            assert driver.execute_script(TEAM_LABELS_CLEAR, "narrow", 12) == [], driver.execute_script(TEAM_LABELS_CLEAR, "narrow", 12)
        finally:
            driver.execute_cdp_cmd("Emulation.setEmulatedMedia", {"features": []})
            driver.execute_cdp_cmd("Emulation.clearDeviceMetricsOverride", {})
    return {"route": "team", "passed": True}


def check_filters(driver, browser, url, route_label):
    """Filters in the address (#browse?...), the Human-checked filter and a range filter, on fresh page loads."""
    wait = WebDriverWait(driver, 120, ignored_exceptions=(StaleElementReferenceException,))
    base = url.split("#", 1)[0]

    def open_page(address):
        # A blank page first, so a new fragment is a full load (read on load), not an in-page jump.
        driver.get("about:blank")
        driver.get(address)
        wait.until(lambda d: d.execute_script("return Boolean(window.CATLOG_STATIC_MANIFEST?.total_rows)"))
        wait_ready()

    def wait_ready():
        wait.until(lambda d: re.fullmatch(r"[\d,]+ records?", d.find_element(By.ID, "activeSummary").text or ""))

    def summary():
        return driver.find_element(By.ID, "activeSummary").text

    def fragment():
        return urlsplit(driver.current_url).fragment

    def cells(column):
        return driver.execute_script("""
            return [...document.querySelectorAll('#recordsBody tr[data-key] td.' + arguments[0])]
                .map(cell => cell.textContent.trim());
        """, column)

    def chip_keys():
        return driver.execute_script("return [...document.querySelectorAll('#activeFilters [data-filter-key]')].map(e => e.dataset.filterKey)")

    def record_number(label, index=0):
        # The table shows no temperature or pH: a row's are read from its record (the Conditions line named label).
        # (inside waits: Safari redraws the table after a record closes; centred: the last row sits under the pagination bar)
        key = wait.until(lambda d: (lambda rows: rows[index].get_attribute("data-key") if len(rows) > index else None)(
            d.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")))
        cell_css = f'#recordsBody tr[data-key="{key}"] .primary-cell'
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", wait.until(lambda d: d.find_element(By.CSS_SELECTOR, cell_css)))
        wait.until(lambda d: d.find_element(By.CSS_SELECTOR, cell_css).click() is None)
        text = wait.until(lambda d: d.execute_script("""
            if (!document.body.classList.contains('detail-open') || !location.hash.includes(arguments[1])) return null;
            const dt = [...document.querySelectorAll('#detailContent .kv-line > dt')].find(e => e.textContent.trim() === arguments[0]);
            return dt ? dt.nextElementSibling.innerText.trim() : null;
        """, label, key))
        driver.find_element(By.ID, "closeDetailButton").click()
        wait.until(lambda d: not d.execute_script("return document.body.classList.contains('detail-open')"))
        match = re.match(r"-?\d+(?:\.\d+)?", text)
        return float(match.group(0)) if match else None

    def count_of(key):
        # Counts follow the results; while newer ones are worked out the panel says so (data-counts="pending").
        if driver.find_element(By.ID, "catalogFilters").get_attribute("data-counts") == "pending":
            return None
        text = driver.find_element(By.CSS_SELECTOR, f'#catalogFilters [data-count="{key}"]').get_attribute("textContent").strip()
        return int(text.replace(",", "")) if re.fullmatch(r"[\d,]+", text) else None

    def open_more(section_id=None):
        """Opens More filters, and one of its groups, by their titles as a visitor does (a scripted click on the summary in
        Safari, whose driver may not click a <summary>)."""
        for selector in ["#moreFilters"] + ([f"#{section_id}"] if section_id else []):
            if driver.execute_script("return document.querySelector(arguments[0]).open", selector):
                continue
            title = driver.find_element(By.CSS_SELECTOR, f"{selector} > summary")
            driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", title)
            if browser == "safari":
                driver.execute_script("arguments[0].click()", title)
            else:
                title.click()
            wait.until(lambda d: d.execute_script("return document.querySelector(arguments[0]).open", selector))

    def database_ticked():
        return driver.execute_script("return [...document.querySelectorAll('#databaseChecklist input:checked')].map(e => e.value)")

    def click_database_option(value):
        # Centred first (Safari clicks what is at the element's centre), then the box itself.
        box = driver.find_element(By.CSS_SELECTOR, f'#databaseChecklist input[value="{value}"]')
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", box)
        box.click()

    def check_database_group():
        """Round 9: Compared with databases is the second group, after Source: Corrects a value, Different number, Same, other
        label, Not in the databases with "every value" nested under it, All values the same, a rule, Corrected earlier;
        each result's square, its definition as title; counts at rest are the manifest's keys; earlier addresses keep
        their records; "every value" brings Not in the databases and is one chip with it; the names keep one line at
        256px beside a five-digit count."""
        found = {}
        comparison = driver.execute_script("return window.CATLOG_STATIC_MANIFEST?.summary?.database_comparison || null") or {}
        open_page(base + "#browse")
        # Round 13: the group is under More filters (round 14: the fourth, after Source, Wild type or variant and Assay
        # conditions), closed at rest with More filters; a visitor opens both by their titles.
        place = driver.execute_script("""
            const more = document.getElementById('moreFilters'), section = document.getElementById('databaseFilterSection');
            return {inMore: section.parentElement === more, index: [...more.querySelectorAll(':scope > .filter-section')].indexOf(section),
                    moreOpen: more.open, open: section.open};
        """)
        assert place == {"inMore": True, "index": 3, "moreOpen": False, "open": False}, place
        open_more("databaseFilterSection")
        rows = driver.execute_script("""
            return [...document.querySelectorAll('#databaseChecklist .check-row')].map(row => {
                const label = row.querySelector(':scope > span');
                const shown = [...label.childNodes].filter(node => !(node.nodeType === 1 && node.matches('.visually-hidden, .db-mark')))
                    .map(node => node.textContent).join('').trim();
                const mark = label.querySelector('.db-mark:not(.db-mark-none)');
                return {value: row.querySelector('input').value, shown, nested: row.classList.contains('nested'),
                        divided: row.classList.contains('after-divider'), title: row.title,
                        name: label.textContent.replace(/\\s+/g, ' ').trim(),
                        mark: mark ? {hidden: mark.getAttribute('aria-hidden'), colour: getComputedStyle(mark).backgroundColor,
                                      size: [mark.getBoundingClientRect().width, mark.getBoundingClientRect().height]} : null};
            });
        """)
        assert [row["value"] for row in rows] == ["all_same", "other_label", "corrects", "differs", "not_listed", "all_not_listed", "earlier"], rows
        assert [row["shown"] for row in rows] == ["All values the same", "Same, other label", "Corrects a value", "Different number",
                                                   "Not in the databases", "every value", "Corrected earlier"], rows
        assert [row["nested"] for row in rows] == [False] * 5 + [True, False], rows
        assert [row["divided"] for row in rows] == [False] * 6 + [True], rows
        assert rows[5]["name"] == "Not in the databases: every value", rows[5]
        colours = driver.execute_script("""
            const probe = document.createElement('span');
            document.body.appendChild(probe);
            const colour = (token) => { probe.style.color = `var(${token})`; return getComputedStyle(probe).color; };
            const out = ['--cmp-same', '--cmp-other', '--chg-magnitude', '--cmp-differs', '--cmp-new', '--cmp-new'].map(colour);
            probe.remove();
            return out;
        """)
        assert [row["mark"]["colour"] for row in rows[:6]] == colours and rows[6]["mark"] is None, rows
        assert all(row["mark"]["hidden"] == "true" and row["mark"]["size"] == [10, 10] for row in rows[:6]), rows
        # Round 15 polish: one pattern in the sidebar. Every box is neutral (the accent), each option with a meaning colour
        # shows its own mark between box and words (a review result its dot, a caution its "!", a database result its
        # square), and the words of those groups' top-level options start at one edge (No cautions and Corrected earlier
        # keep the mark's room); the Cautions title carries no dot.
        open_more("cautionFilterSection")
        pattern = driver.execute_script("""
            const probe = document.createElement('span'); document.body.appendChild(probe);
            probe.style.color = 'var(--accent)'; const accent = getComputedStyle(probe).color; probe.remove();
            const words = row => { const walker = document.createTreeWalker(row.querySelector(':scope > span'), NodeFilter.SHOW_TEXT);
                while (walker.nextNode()) { const node = walker.currentNode;
                    if (node.data.trim() && !node.parentElement.closest('.visually-hidden')) { const range = document.createRange();
                        const at = node.data.search(/\\S/); range.setStart(node, at); range.setEnd(node, at + 1); return range.getBoundingClientRect().left; } } return null; };
            const rows = [...document.querySelectorAll('#statusChecklist .check-row:not(.nested), #databaseChecklist .check-row:not(.nested), #cautionChecklist .check-row')];
            return {edges: rows.map(words), marks: rows.map(row => Boolean(row.querySelector(':scope > span > :is(.option-mark, .db-mark)'))),
                    boxes: [...document.querySelectorAll('#catalogFilters .check-row input')].map(input => getComputedStyle(input).accentColor),
                    accent, titleDots: [...document.querySelectorAll('#cautionFilterSection > summary .group-dot')].length};
        """)
        assert all(pattern["marks"]) and max(pattern["edges"]) - min(pattern["edges"]) <= 1, pattern
        assert set(pattern["boxes"]) == {pattern["accent"]} and pattern["titleDots"] == 0, pattern
        definitions = ("Every compared value is the number a database lists for it.",
                       "A database lists this number for the paper under another substrate, variant or organism.",
                       "A database lists another number; CatLog’s is the paper’s",
                       "A database lists another number and the cause is not yet known;",
                       "No compared database lists this value for this paper;",
                       "No compared database lists any value of the record.",
                       "Records not yet re-read whose values CatLog’s earlier version changed")
        assert all(row["title"].startswith(text) for row, text in zip(rows, definitions)), rows
        # The counts at rest are the manifest's keys; the titles add its values and records.
        kinds, records = comparison.get("records_with_kind") or {}, comparison.get("records") or {}
        expected = {"corrects": kinds.get("corrected"), "differs": kinds.get("differs"), "other_label": kinds.get("other_label"),
                    "not_listed": kinds.get("new"), "all_not_listed": records.get("every_value_new"),
                    "all_same": records.get("every_value_confirmed")}
        expected = {key: value for key, value in expected.items() if isinstance(value, int)}
        wait.until(lambda d: all(count_of(f"database:{key}") is not None for key in expected))
        counted = {key: count_of(f"database:{key}") for key in expected}
        assert counted == expected, (counted, expected)
        found["counts"] = counted
        # (the titles count a database's number at an exact factor nothing has yet checked under Different number, as
        # the Guide does: an older comparison's factor_only among its corrections is moved; its own status is added)
        values_all = (comparison.get("values") or {}).get("all") or {}
        found_by = (comparison.get("corrections") or {}).get("by_cause_found_by") or {}
        factor_only = sum(ways.get("factor_only", 0) for ways in found_by.values() if isinstance(ways, dict)) \
            if "factor_only" not in found_by else sum(found_by["factor_only"].values())
        differs_extra = sum(values_all.get(key, 0) for key in ("differs_factor_only", "differs_exact_factor"))
        corrected_values = values_all.get("corrected")
        if isinstance(corrected_values, int) and "corrects" in expected:
            assert rows[2]["title"].endswith(f" {corrected_values - factor_only:,} values in {expected['corrects']:,} records."), rows[2]["title"]
        differs_values = values_all.get("differs")
        if isinstance(differs_values, int) and "differs" in expected:
            assert rows[3]["title"].endswith(f" {differs_values + factor_only + differs_extra:,} values in {expected['differs']:,} records."), rows[3]["title"]
        # The "?" names the databases compared and defines every option.
        about = driver.find_element(By.CSS_SELECTOR, '#catalogFilters .section-about[aria-controls="aboutDatabases"]')
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", about)
        about.click()
        about_text = driver.execute_script("return document.getElementById('aboutDatabases').innerText.trim()")
        assert "with what BRENDA" in about_text and "Every value (under Not in the databases)" in about_text, about_text
        # Each database's name keeps one line (SABIO-RK never breaks at its hyphen, STRENDA DB at its space).
        compared = re.match(r"CatLog compares each value read from a paper with what (.+?) lists? for that paper", about_text)
        assert compared, about_text
        names = "|".join(re.escape(name) for name in re.split(r", | and ", compared.group(1)))
        split = driver.execute_script(SPLIT_WORDS_JS, driver.find_element(By.ID, "aboutDatabases"), names, False)
        assert split == [], f"A database's name breaks across lines in Browse's \"?\": {split}"
        for word in ("v1", "v2", "independent", "claim", "agentic", "blind", "five"):
            assert not re.search(rf"\b{word}\b", about_text, re.I), (word, about_text)
        about.click()
        # The names keep one line in the 256px sidebar (1280px window) beside today's counts and five-digit ones, in this
        # browser's font (DejaVu Sans on Linux), also beside a scrollbar that takes room (11px, as in Chrome on Linux and
        # Windows; where this browser's floats over the page, the room is taken for the measure); the nested name may
        # wrap but never runs into its count.
        set_browse_viewport(driver, browser, 1280, 1000)
        lines = driver.execute_script("""
            const rail = document.getElementById('catalogFilters');
            const floating = rail.offsetWidth - rail.clientWidth < 1;
            if (floating) rail.style.paddingRight = '11px';
            const rows = [...document.querySelectorAll('#databaseChecklist .check-row')].filter(row => row.getClientRects().length);
            const measure = () => rows.map(row => {
                const label = row.querySelector(':scope > span');
                const count = row.querySelector(':scope > strong').getBoundingClientRect();
                const box = label.getBoundingClientRect();
                return {value: row.querySelector('input').value, lines: Math.round(box.height / parseFloat(getComputedStyle(label).lineHeight)),
                        apart: box.right <= count.left + 0.5, level: Math.abs(count.top - box.top) < 3};
            });
            const now = measure();
            const counts = rows.map(row => row.querySelector('strong').textContent);
            rows.forEach(row => { row.querySelector('strong').textContent = '88,888'; });
            const grown = measure();
            rows.forEach((row, index) => { row.querySelector('strong').textContent = counts[index]; });
            rail.style.paddingRight = '';
            return now.concat(grown);
        """)
        assert all(row["apart"] and row["level"] for row in lines), lines
        assert all(row["lines"] == 1 for row in lines if row["value"] != "all_not_listed"), lines
        set_browse_viewport(driver, browser, 1440, 1000)
        # Earlier addresses keep their records: adds is Not in the databases, new no database listing any value (with
        # Not in the databases, one chip), same All values the same.
        for address, ticked, written, chips, key in () if browser != "chrome" else (  # address parsing: Chrome covers it
                ("db=adds", ["not_listed"], "db=not_listed", ["db:not_listed"], "not_listed"),
                ("db=new", ["not_listed", "all_not_listed"], "db=not_listed,all_not_listed", ["db:all_not_listed"], "all_not_listed"),
                ("db=same", ["all_same"], "db=all_same", ["db:all_same"], "all_same")):
            open_page(base + "#browse?" + address)
            assert database_ticked() == ticked and fragment() == "browse?" + written and chip_keys() == chips, \
                (address, database_ticked(), fragment(), chip_keys())
            if key in expected:
                assert summary() == f"{expected[key]:,} records", (address, summary(), expected[key])
            # (on the db=same page only: in Safari the loop is skipped and no page has the chip)
            if key == "all_same":
                chip = driver.execute_script("return document.querySelector('#activeFilters [data-filter-key=\"db:all_same\"]').innerText.trim()")
                assert chip == "Databases: All values the same", chip
        # Ticking "every value" ticks Not in the databases; the pair is one chip that removes both; unticking Not in the
        # databases unticks "every value".
        open_page(base + "#browse")
        open_more("databaseFilterSection")
        click_database_option("all_not_listed")
        wait.until(lambda d: fragment() == "browse?db=not_listed,all_not_listed")
        wait_ready()
        assert database_ticked() == ["not_listed", "all_not_listed"] and chip_keys() == ["db:all_not_listed"], (database_ticked(), chip_keys())
        chip = driver.execute_script("return document.querySelector('#activeFilters [data-filter-key=\"db:all_not_listed\"]').innerText.trim()")
        assert chip == "Not in the databases: every value", chip
        if "all_not_listed" in expected:
            assert summary() == f"{expected['all_not_listed']:,} records", summary()
        click_database_option("not_listed")
        wait.until(lambda d: not fragment())
        assert database_ticked() == [] and not chip_keys(), (database_ticked(), chip_keys())
        click_database_option("all_not_listed")
        wait.until(lambda d: chip_keys() == ["db:all_not_listed"])
        driver.find_element(By.CSS_SELECTOR, '#activeFilters [data-filter-key="db:all_not_listed"]').click()
        wait.until(lambda d: not fragment())
        assert database_ticked() == [] and not chip_keys(), (database_ticked(), chip_keys())
        # Every link of Stats' Compared with databases opens a Browse list that keeps all of its keys: Browse drops a key
        # it does not read (dbsrc, dbwhy or dbpar before value-level matching) and would then show a wider list than the
        # link names. One link for each set of keys the part's links use; once, on the published page.
        if base.endswith("catlog-latest.html") and browser == "chrome":  # one reload per link set: Chrome covers it
            driver.get("about:blank")
            driver.get(base.replace("catlog-latest.html", "catlog-stats.html"))
            wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, "#statsCharts .stats-part"))
            targets = driver.execute_script("""
                const part = document.querySelector("#statsCharts [data-part='databases']");
                if (!part) return [];
                // (a reference link, such as the Dataset notes, opens a file, not Browse)
                return [...part.querySelectorAll('a[href]:not(.stats-ref-link)')].map(a => a.href)
                    .concat([...part.querySelectorAll('[data-href]')].map(e => new URL(e.dataset.href, location.href).href));
            """)
            by_keys = {}
            for href in targets:
                target = urlsplit(href).fragment
                assert target.startswith("browse?"), href
                by_keys.setdefault(frozenset(key for key, _value in parse_qsl(target[len("browse?"):], keep_blank_values=True)), href)
            for _keys, href in sorted(by_keys.items(), key=lambda item: sorted(item[0])):
                open_page(href)
                assert fragment() == urlsplit(href).fragment, f"Browse drops part of a Stats link: {urlsplit(href).fragment} opens {fragment()}"
            found["stats_links"] = sorted("&".join(sorted(keys)) for keys in by_keys) if by_keys else "no part 7"
            open_page(base + "#browse")
        # A record matches any result ticked: Corrects a value and Different number together give the records with either.
        if "corrects" in expected and "differs" in expected:
            open_page(base + "#browse?db=corrects,differs")
            either = int(summary().split()[0].replace(",", ""))
            assert max(expected["corrects"], expected["differs"]) <= either <= expected["corrects"] + expected["differs"], (summary(), expected)
            assert chip_keys() == ["db:corrects", "db:differs"], chip_keys()
        if browser == "chrome":
            # Phones: the group in the sheet, its rows 44px targets, nothing wider than the screen.
            for width in (390, 320):
                set_browse_viewport(driver, browser, width, 844)
                if not driver.execute_script("return document.body.classList.contains('filters-open')"):
                    driver.find_element(By.ID, "openFiltersButton").click()
                wait.until(lambda d: d.find_element(By.ID, "showResultsButton").is_displayed())
                phone = driver.execute_script("""
                    const rows = [...document.querySelectorAll('#databaseChecklist .check-row')].filter(row => row.getClientRects().length);
                    return {heights: rows.map(row => row.getBoundingClientRect().height),
                            wide: document.documentElement.scrollWidth <= innerWidth + 1,
                            inside: rows.every(row => row.getBoundingClientRect().right <= innerWidth + 0.5)};
                """)
                # 44px to a hundredth: a row below a wrapped label can measure 43.99997 (sub-pixel layout, DejaVu Sans at 320).
                assert phone["heights"] and all(height >= 43.99 for height in phone["heights"]) and phone["wide"] and phone["inside"], (width, phone)
                driver.find_element(By.ID, "showResultsButton").click()
                wait.until(lambda d: not d.execute_script("return document.body.classList.contains('filters-open')"))
            set_browse_viewport(driver, browser, 1440, 1000)
            wait.until(lambda d: d.execute_script("return document.body.classList.contains('filters-open')"))
        driver.find_element(By.CSS_SELECTOR, "#activeFilters [data-filter-clear]").click()
        wait.until(lambda d: not fragment())
        return found

    total_records = driver.execute_script("return window.CATLOG_STATIC_MANIFEST?.total_rows") or 0
    database_results = None
    try:
        set_browse_viewport(driver, browser, 1440, 1000)
        # 0. Round 13 (the user, 2026-10-18: "too many options and a bit confusing"): in view, the filters most visitors use
        # (Enzyme, organism, substrate; Measurement type; Review result), then one closed More filters holding the
        # specialist groups, Source first (round 14, the user 2026-10-20: "source can go to the extra filters"); no help
        # text in view (each group's "?" holds it); no option removed.
        open_page(base + "#browse")
        rest = driver.execute_script(SIDEBAR_GROUPS_JS)
        assert rest["top"] == ["Enzyme, organism, substrate", "Measurement type", "Review result", "More filters"], rest
        assert rest["more"] == ["Source", "Wild type or variant", "Assay conditions", "Compared with databases", "Cautions", "Source database"], rest
        assert rest["moreOpen"] is False and rest["moreOpenInside"] == [True, True, True, False, False, False], rest
        assert rest["countHidden"] and rest["words"] == "", rest
        assert rest["notes"] == [], f"Help text in view: {rest['notes']}"
        assert rest["inputs"] == {"checkbox": 30, "radio": 3, "search": 4, "text": 4}, rest["inputs"]
        # Every group has its "?" but the enzyme fields (labelled, with examples; the EC field's title says the rest).
        assert rest["withAbout"] == [False, True, True, True, True, True, True, True, True], rest["withAbout"]
        # At 1440 x 1000 the groups in view and More filters' title show without scrolling the sidebar; closed, a muted line
        # under its title names what is inside, Source first (round 14: a newcomer could not see that Source moved there).
        assert rest["moreTitleShown"] and rest["groupsLine"] == "Source, variant, assay and more", rest
        # An address that sets a filter under More filters opens it and the group (Cautions and Source database start
        # closed); closed again, its title counts them: "More filters, 3 active" (the badge 3, then hidden words).
        open_page(base + "#browse?caution=units&variant=wild&source=brenda")
        opened = driver.execute_script(SIDEBAR_GROUPS_JS)
        assert opened["moreOpen"] and opened["moreOpenInside"] == [True, True, True, False, True, True], opened
        assert not opened["countHidden"] and opened["count"] == "3" and opened["words"] == ", 3 active" and opened["groupsLine"] is None, opened
        driver.execute_script("document.getElementById('moreFilters').open = false")
        closed = driver.execute_script(SIDEBAR_GROUPS_JS)
        assert closed["count"] == "3" and closed["countShown"] and closed["name"] == "More filters, 3 active", closed
        assert chip_keys() == ["variant:wild", "caution:units", "source:brenda"], chip_keys()
        # A chip removed leaves the count right; Clear all empties it.
        driver.find_element(By.CSS_SELECTOR, '#activeFilters [data-filter-key="caution:units"]').click()
        wait.until(lambda d: d.execute_script(SIDEBAR_GROUPS_JS)["count"] == "2")
        driver.find_element(By.CSS_SELECTOR, "#activeFilters [data-filter-clear]").click()
        wait.until(lambda d: not fragment() and d.execute_script(SIDEBAR_GROUPS_JS)["countHidden"])
        # Read from the paper (the counts band's link, an address) opens More filters with Source in it, its radio set; its
        # chip is counted on More filters' title; Undo and the chip's colour are as before.
        open_page(base + "#browse?source=paper")
        paper = driver.execute_script(SIDEBAR_GROUPS_JS)
        assert paper["moreOpen"] and paper["moreOpenInside"][0] and paper["count"] == "1" and paper["words"] == ", 1 active", paper
        assert driver.execute_script("return document.querySelector('input[name=\"sourceMode\"][value=\"paper\"]').checked")
        assert driver.find_element(By.CSS_SELECTOR, 'input[name="sourceMode"][value="paper"]').is_displayed()
        assert chip_keys() == ["source:paper"], chip_keys()
        driver.find_element(By.CSS_SELECTOR, "#activeFilters [data-filter-clear]").click()
        wait.until(lambda d: not fragment() and d.execute_script(SIDEBAR_GROUPS_JS)["countHidden"])
        if browser == "chrome":
            # Opened by its title in a short window, More filters scrolls just enough to show its groups, never taking its
            # title under the sticky heading.
            set_browse_viewport(driver, browser, 1440, 700)
            open_page(base + "#browse")
            driver.execute_script("document.getElementById('catalogFilters').scrollTop = 0")
            driver.find_element(By.CSS_SELECTOR, "#moreFilters > summary").click()
            positions = []

            def settled(d):
                positions.append(d.execute_script("return document.getElementById('catalogFilters').scrollTop"))
                return len(positions) > 2 and positions[-1] == positions[-2] == positions[-3]

            WebDriverWait(driver, 5, poll_frequency=0.1).until(settled)
            shown = driver.execute_script("""
                const rail = document.getElementById('catalogFilters').getBoundingClientRect();
                const heading = document.querySelector('.rail-heading').getBoundingClientRect();
                const title = document.querySelector('#moreFilters > summary').getBoundingClientRect();
                const first = document.querySelector('#sourceChecklist .radio-row').getBoundingClientRect();
                return {scrolled: document.getElementById('catalogFilters').scrollTop, titleClear: title.top >= heading.bottom - 0.5,
                        firstShown: first.bottom <= rail.bottom + 0.5};
            """)
            assert shown["scrolled"] > 0 and shown["titleClear"] and shown["firstShown"], shown
            set_browse_viewport(driver, browser, 1440, 1000)
        # 1. An address with filters opens with them set, writes itself back in the same order, and shows one chip per
        # filter; every row fits the filters.
        address = "#browse?ec=1.1.1&tmin=20&tmax=30&sort=kcat&rows=50"
        open_page(base + address)
        assert fragment() == address[1:], f"The address changed: {fragment()}"
        values = driver.execute_script("""
            return ['ecFilterInput', 'temperatureMinInput', 'temperatureMaxInput', 'sortSelect', 'pageSizeSelect']
                .map(id => document.getElementById(id).value);
        """)
        assert values == ["1.1.1", "20", "30", "kcat", "50"], values
        assert driver.find_element(By.CSS_SELECTOR, "th.c-kcat").get_attribute("aria-sort") == "descending"
        assert chip_keys() == ["ec", "temperature"]
        rows = driver.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")
        assert 0 < len(rows) <= 50
        assert all(any(part == "1.1.1" or part.startswith("1.1.1.") for part in re.split(r"[;,\s]+", ec)) for ec in cells("c-ec"))
        first_keys = [row.get_attribute("data-key") for row in rows]
        assert not cells("c-temp") and not cells("c-ph"), "The table shows no temperature or pH"
        temperatures = [record_number("Temperature", index) for index in (0, len(rows) - 1)]
        assert all(value is not None and 20 <= value <= 30 for value in temperatures), temperatures
        wait.until(lambda d: fragment() == address[1:])
        filtered = summary()
        # The copied address opens the same records.
        copied = driver.current_url
        open_page(copied)
        assert summary() == filtered
        assert [row.get_attribute("data-key") for row in driver.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")] == first_keys
        # Back and Forward bring the filters back with the address.
        driver.find_element(By.ID, "statsButton").click()
        wait.until(lambda d: d.find_element(By.ID, "statsView").is_displayed())
        driver.back()
        wait.until(lambda d: d.find_element(By.ID, "catalogView").is_displayed())
        wait_ready()
        assert summary() == filtered and fragment() == address[1:]
        # Removing a chip removes its filter from the table and the address.
        driver.find_element(By.CSS_SELECTOR, '#activeFilters [data-filter-key="temperature"]').click()
        wait.until(lambda d: "tmin" not in fragment() and summary() != filtered)
        assert chip_keys() == ["ec"]
        driver.find_element(By.CSS_SELECTOR, "#activeFilters [data-filter-clear]").click()
        wait.until(lambda d: fragment() == "browse?rows=50" and not chip_keys())
        # Clear all hands the focus to Undo, the likely next step (never to « Hide filters, nor to the search box, whose
        # examples would open over the counts).
        wait.until(lambda d: d.execute_script("return document.activeElement.hasAttribute('data-filter-undo')"))
        driver.execute_script("document.activeElement.blur()")

        # 2. Human-checked: the filter sidebar is open beside the table (no dialog, the table stays usable); tick it, and
        # every row shown carries the "human-checked" tag; the count beside it is the number of records.
        wait.until(lambda d: d.find_element(By.ID, "humanCheckedFilter").is_displayed())
        assert driver.find_element(By.ID, "catalogFilters").get_attribute("role") is None, "Wide screens show the filters as a sidebar"
        assert not driver.execute_script("return document.querySelector('.table-panel').inert")
        assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth + 1"), "The filter sidebar overflows the page"
        wait.until(lambda d: count_of("checked") is not None)
        checked = count_of("checked")
        assert checked > 0, "No human-checked records counted"
        driver.find_element(By.ID, "humanCheckedFilter").click()
        wait.until(lambda d: summary() == f"{checked:,} records")
        assert "checked=1" in fragment()
        badges = driver.execute_script("return [...document.querySelectorAll('#recordsBody tr[data-key] .state-badge')].map(b => b.textContent)")
        assert badges and all("human-checked" in badge for badge in badges), "A row without the human-checked tag"
        driver.save_screenshot(str(OUTPUT / f"{browser}-{route_label}-filters-human-checked.png"))
        # The marks load after the index: an address with checked=1 still opens with the same records.
        open_page(base + "#browse?checked=1")
        wait.until(lambda d: summary() == f"{checked:,} records")
        # An open record keeps the filters in the address: a reload shows the same record with the same filters, and
        # closing it leaves the filters.
        record_key = driver.find_element(By.CSS_SELECTOR, "#recordsBody tr[data-key]").get_attribute("data-key")
        driver.find_element(By.CSS_SELECTOR, "#recordsBody tr[data-key] .primary-cell").click()
        wait.until(lambda d: fragment() == f"browse?checked=1&record={record_key}")
        driver.refresh()
        wait.until(lambda d: d.execute_script("return document.body.classList.contains('detail-open')")
                   and summary() == f"{checked:,} records")
        assert chip_keys() == ["checked"] and fragment() == f"browse?checked=1&record={record_key}"
        assert driver.find_element(By.CSS_SELECTOR, '#recordsBody tr[aria-selected="true"]').get_attribute("data-key") == record_key
        driver.find_element(By.ID, "closeDetailButton").click()
        wait.until(lambda d: fragment() == "browse?checked=1")

        # 3. A pH range typed into the sidebar: every row shown has a pH inside it, and the address carries it.
        open_page(base)
        assert not driver.find_element(By.ID, "phMinInput").is_displayed(), "pH is under More filters, closed at rest"
        open_more()
        wait.until(lambda d: d.find_element(By.ID, "phMinInput").is_displayed())
        driver.find_element(By.ID, "phMinInput").send_keys("7")
        driver.find_element(By.ID, "phMaxInput").send_keys("7.5", Keys.TAB)
        wait.until(lambda d: fragment() == "browse?phmin=7&phmax=7.5")
        wait_ready()
        assert chip_keys() == ["ph"]
        ph_values = [record_number("pH", index) for index in (0, 1)]
        assert all(value is not None and 7 <= value <= 7.5 for value in ph_values), ph_values
        wait.until(lambda d: fragment() == "browse?phmin=7&phmax=7.5")
        # The sidebar is part of the page: Escape leaves it open (« collapses it).
        ActionChains(driver).send_keys(Keys.ESCAPE).perform()
        assert driver.execute_script("return document.body.classList.contains('filters-open')")
        if browser == "chrome":
            # Escape in a filled search box empties it and the results follow (the box and the results never disagree);
            # an open record stays open until the next Escape. (The first Escape may only close the suggestions.)
            search = driver.find_element(By.ID, "globalSearchInput")
            search.send_keys("dehydrogenase")
            wait.until(lambda d: "q" in chip_keys())
            driver.find_element(By.CSS_SELECTOR, "#recordsBody tr[data-key] .primary-cell").click()
            wait.until(lambda d: d.execute_script("return document.body.classList.contains('detail-open')"))
            search.click()
            ActionChains(driver).send_keys(Keys.ESCAPE).perform()
            if search.get_attribute("value"):
                ActionChains(driver).send_keys(Keys.ESCAPE).perform()
            wait.until(lambda d: "q" not in chip_keys())
            assert search.get_attribute("value") == "" and "q=" not in fragment(), fragment()
            assert driver.execute_script("return document.body.classList.contains('detail-open')"), "The record stays open"
            ActionChains(driver).send_keys(Keys.ESCAPE).perform()
            wait.until(lambda d: not d.execute_script("return document.body.classList.contains('detail-open')"))
            wait_ready()
        if browser == "chrome":
            # Phones keep the filters as a full-screen sheet that ends with "Show N records".
            set_browse_viewport(driver, browser, 390, 844)
            wait.until(lambda d: not d.execute_script("return document.body.classList.contains('filters-open')"))
            driver.find_element(By.ID, "openFiltersButton").click()
            wait.until(lambda d: d.find_element(By.ID, "showResultsButton").is_displayed())
            assert driver.find_element(By.ID, "catalogFilters").get_attribute("role") == "dialog"
            assert driver.find_element(By.ID, "showResultsButton").text == f"Show {summary()}"
            assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth + 1")
            sheet = driver.execute_script("const r = document.querySelector('#catalogFilters').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]")
            assert sheet == [0, 0, 390, 844], f"The phone sheet fills the screen: {sheet}"
            driver.find_element(By.ID, "showResultsButton").click()
            wait.until(lambda d: not d.execute_script("return document.body.classList.contains('filters-open')"))
            set_browse_viewport(driver, browser, 1440, 1000)
            wait.until(lambda d: d.execute_script("return document.body.classList.contains('filters-open')"))
        driver.find_element(By.CSS_SELECTOR, "#activeFilters [data-filter-clear]").click()
        wait.until(lambda d: not fragment())

        # Compared with databases shows only when the snapshot carries the comparison; without it a db= address is ignored.
        indexed = driver.execute_script(
            "return (window.CATLOG_STATIC_MANIFEST?.viewer_index?.optional_fields || []).includes('database_summary')")
        open_page(base + "#browse?db=corrects")
        section_hidden = driver.execute_script("return document.getElementById('databaseFilterSection').hidden")
        if indexed:
            assert not section_hidden and chip_keys() == ["db:corrects"], (section_hidden, chip_keys())
            # (in Safari once, on the published entry page: each run reloads the whole catalog about six times)
            database_results = check_database_group() if browser == "chrome" or route_label == "local-latest" else None
        else:
            assert section_hidden and not chip_keys() and "db=" not in fragment(), (section_hidden, chip_keys(), fragment())
        # 4. Source: the older status=v2 opens Read from the paper (source=paper), every row tagged "from
        # paper"; a database narrows the records not yet re-read, each tagged "not re-read" (read out in full), and the
        # status cell names the database after it.
        def first_tags():
            return driver.execute_script(
                "return [...document.querySelectorAll('#recordsBody tr[data-key] .state-tags > .state-tag:first-child')].map(e => e.textContent)")

        def second_tags():
            return driver.execute_script(
                "return [...document.querySelectorAll('#recordsBody tr[data-key] .state-tags > .state-tag:nth-child(2)')].map(e => e.textContent)")
        overview = stats_overview(driver.execute_script("return window.CATLOG_STATIC_MANIFEST"))
        open_page(base + "#browse?status=v2")
        wait.until(lambda d: fragment() == "browse?source=paper")
        if overview:
            assert summary() == f"{overview['from_paper']['records']:,} records", summary()
        assert first_tags() and all(tag == "from paper" for tag in first_tags()), first_tags()
        assert chip_keys() == ["source:paper"]
        open_page(base + "#browse?source=skid")
        assert driver.execute_script("return document.querySelector('input[name=\"sourceMode\"][value=\"databases\"]').checked")
        assert first_tags() and all(tag == "not re-read" for tag in first_tags()), first_tags()
        assert len(second_tags()) == len(first_tags()) and all("SKiD" in tag for tag in second_tags()), second_tags()
        names = driver.execute_script("return [...document.querySelectorAll('#recordsBody tr[data-key] .state-badge')].map(e => e.getAttribute('aria-label'))")
        assert all(", Not yet re-read, " in name and "not re-read" not in name for name in names), names
        # None of these is read from the paper: the counts band's Read from the paper 0 is plain text, not a link.
        zero = driver.execute_script("""const link = document.getElementById('fromPaperLink');
            return [document.getElementById('fromPaperCount').textContent, link.getAttribute('href'), link.getAttribute('title'),
                    link.matches(':any-link')];""")
        assert zero == ["0", None, None, False], zero
        driver.find_element(By.CSS_SELECTOR, "#activeFilters [data-filter-clear]").click()
        wait.until(lambda d: not fragment())

        # 5. Review result: four words, Disputed apart from Not checked (Unverified and Not reviewed); the counts are the
        # manifest's.
        statuses = {item["label"]: item["count"] for item in
                    driver.execute_script("return window.CATLOG_STATIC_MANIFEST").get("summary", {}).get("distributions", {}).get("verification_status", [])}
        open_page(base + "#browse?status=disputed")
        assert summary() == f"{statuses.get('disputed', 0):,} records", summary()
        labels = driver.execute_script("return [...document.querySelectorAll('#recordsBody tr[data-key] .state-label')].map(e => e.textContent)")
        assert all(label == "Disputed" for label in labels), labels
        open_page(base + "#browse?status=not_verified")
        not_checked = sum(count for label, count in statuses.items()
                          if label not in ("verified", "corrected", "manual_review_required", "disputed"))
        assert summary() == f"{not_checked:,} records", summary()
        labels = driver.execute_script("return [...document.querySelectorAll('#recordsBody tr[data-key] .state-label')].map(e => e.textContent)")
        assert labels and all(label == "Not checked" for label in labels), labels
        driver.find_element(By.CSS_SELECTOR, "#activeFilters [data-filter-clear]").click()
        wait.until(lambda d: not fragment())

        # 6. Variants: the mutation has its own line under the name (never clipped with it), and rows keep one height.
        open_page(base + "#browse?variant=variant")
        forms = driver.execute_script("""
            return [...document.querySelectorAll('#recordsBody tr[data-key]')].map(row => {
                const form = row.querySelector('.primary-cell > .enzyme-form');
                const name = row.querySelector('.primary-cell > .clamp-2');
                return {text: form ? form.textContent : null, below: form ? form.getBoundingClientRect().top >= name.getBoundingClientRect().bottom - 1 : false,
                        height: Math.round(row.getBoundingClientRect().height)};
            });
        """)
        assert forms and all(item["text"] and not item["text"].startswith("Variant") and item["below"] for item in forms), forms[:3]
        assert len({item["height"] for item in forms}) == 1, {item["height"] for item in forms}
        driver.find_element(By.CSS_SELECTOR, "#activeFilters [data-filter-clear]").click()
        wait.until(lambda d: not fragment())

        # 7. Counts follow the results: after a search, an option's count is the number of records ticking it shows.
        def summary_count():
            return int(summary().split()[0].replace(",", ""))
        open_page(base + "#browse?q=laccase")
        found = summary_count()
        wait.until(lambda d: count_of("source:all") == found and count_of("state:accepted") is not None)
        accepted, paper = count_of("state:accepted"), count_of("source:paper")
        assert accepted < total_records and paper <= found
        open_page(base + "#browse?q=laccase&status=accepted")
        assert summary_count() == accepted, (summary(), accepted)
        open_page(base + "#browse?q=laccase&source=paper")
        assert summary_count() == paper, (summary(), paper)
        # A view whose counts are already worked out (this one) is drawn at once when the address goes to another view
        # and back within a moment; the other view's count, still running, is dropped and never overwrites it (a typed
        # address while a record was open had left the sidebar with the earlier view's counts).
        driver.execute_script("""
            location.hash = '#browse?q=dehydrogenase';
            setTimeout(() => { location.hash = '#browse?q=laccase&source=paper'; }, 40);
        """)
        wait.until(lambda d: fragment() == "browse?q=laccase&source=paper" and summary_count() == paper)
        time.sleep(3)
        # This view's counts: All records is what ticking it would show (every laccase record), Read from the paper the
        # records shown; the other view's would count dehydrogenase records.
        assert count_of("source:all") == found and count_of("source:paper") == paper, (count_of("source:all"), found, count_of("source:paper"), paper)
        driver.find_element(By.CSS_SELECTOR, "#activeFilters [data-filter-clear]").click()
        wait.until(lambda d: not fragment())

        # 8. No more precision than was measured: a value shows at most 4 significant figures (a whole number keeps its
        # digits); its tooltip keeps the stored digits. Round 15 polish: one rule for printed and calc. values, so a plain
        # whole number from 1000 never ends in a zero that is not a figure (35000 reads 3.5 × 10⁴, like a calc.
        # 4.1 × 10⁴), and five integer digits are grouped (12,346).
        for address in ("#browse?enzyme=aldolase&rows=100", "#browse?sort=kcat_over_km_asc", "#browse?sort=kcat_over_km&rows=100"):
            open_page(base + address)
            shown = driver.execute_script("""
                return [...document.querySelectorAll('#recordsBody tr[data-key] :is(.c-kcat,.c-km,.c-eff) .metric-with-note')]
                    .map(e => [(e.innerText.match(/^-?[\\d.,]+/) || [''])[0], e.title, /^-?[\\d.,]+\\s*×/.test(e.innerText)])
                    .filter(([text]) => text);
            """)
            assert shown, address
            for text, title, scientific in shown:
                digits = text.replace(",", "").replace(".", "").lstrip("0")
                assert len(digits) <= 4 or "." not in text, (text, title)
                assert title, text
                if scientific:
                    continue
                whole = text.split(".")[0].lstrip("-")
                assert "." in text or len(whole.replace(",", "")) < 4 or not whole.endswith("0"), (address, text, title)
                assert len(whole.replace(",", "")) < 5 or "," in whole, (address, text, title)
        # 9. Each chip wears a colour (a 3px bar and a quiet tint keeping its words at 4.5:1 or more): a review result's or
        # database result's own colour, a caution's tan, else the colour of the dot beside its group in the sidebar;
        # Undo, first in the bar, restores the filter set before the last change (Clear all too), by mouse and by
        # keyboard, keeps its place and is dimmed when there is nothing left to undo.
        undo_results = check_chip_colours_and_undo(driver, browser, base, wait, open_page, chip_keys, fragment)
    except Exception:
        driver.save_screenshot(str(OUTPUT / f"{browser}-{route_label}-filters-failure.png"))
        raise
    return {"route": route_label, "human_checked": checked, "database_counts": database_results and database_results.get("counts"),
            "chips_undo": undo_results,
            "database_stats_links": database_results and database_results.get("stats_links"),
            "passed": True}


SIDEBAR_GROUPS_JS = """
    // The sidebar's groups in view and under More filters, More filters' count, text shown outside the "?" boxes, and the
    // controls (every option, whether in view or not).
    const rail = document.getElementById('catalogFilters');
    const more = document.getElementById('moreFilters');
    const name = (group) => [...group.querySelector(':scope > summary > span').childNodes]
        .filter(node => node.nodeType === 3 || !node.matches('.filter-count, .visually-hidden, .group-dot, .filter-more-groups')).map(node => node.textContent).join('').trim();
    const top = [...rail.querySelectorAll(':scope > :is(.filter-section, .filter-more)')].filter(group => !group.hidden).map(name);
    const inside = [...more.querySelectorAll(':scope > .filter-section')];
    const badge = document.getElementById('moreFiltersCount');
    const notes = [...rail.querySelectorAll('p, .filter-note')].filter(e => e.getClientRects().length && !e.closest('.filter-about'))
        .map(e => e.textContent.trim());
    const inputs = {};
    rail.querySelectorAll('input').forEach(input => { inputs[input.type] = (inputs[input.type] || 0) + 1; });
    const view = rail.getBoundingClientRect(), moreTitle = more.querySelector(':scope > summary').getBoundingClientRect();
    // the name a screen reader gives the title: its words without the aria-hidden badge
    const spoken = [...more.querySelector(':scope > summary > span').childNodes].filter(node => node.nodeType === 3 || node.getAttribute('aria-hidden') !== 'true')
        .map(node => node.textContent).join('').trim();
    const groupsLine = more.querySelector('.filter-more-groups');
    return {top, more: inside.map(name), moreOpen: more.open, moreOpenInside: inside.map(group => group.open),
            count: badge.textContent, countHidden: badge.classList.contains('hidden'), countShown: badge.getBoundingClientRect().width > 0,
            words: document.getElementById('moreFiltersWords').textContent, name: spoken, notes, inputs,
            withAbout: [...rail.querySelectorAll('.filter-section')].map(group => Boolean(group.querySelector(':scope > .section-about'))),
            moreTitleShown: moreTitle.bottom <= view.bottom + 0.5 && moreTitle.top >= view.top,
            groupsLine: groupsLine && groupsLine.getClientRects().length ? groupsLine.textContent : null};
"""
CHIP_COLOURS_JS = """
    // rgb(...) or, for a tint mixed in CSS (color-mix), color(srgb r g b) with 0-1 channels.
    const rgb = text => (text.match(/[\\d.]+/g) || []).slice(0, 3).map(Number).map(v => text.startsWith('color(') ? v * 255 : v);
    const luminance = c => { const [r, g, b] = rgb(c).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
                             return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    const token = name => { probe.style.color = `var(${name})`; return getComputedStyle(probe).color; };
    const tokens = Object.fromEntries(['--st-accepted', '--st-pending', '--st-unverified', '--st-not-reviewed', '--st-disputed',
        '--cmp-same', '--cmp-other', '--cmp-differs', '--cmp-new', '--chg-magnitude', '--chg-precision', '--caution', '--caution-mark',
        '--checked', '--accent', '--bar-neutral', '--src-paper'].map(name => [name, token(name)]));
    probe.remove();
    const square = mark => { const e = document.querySelector(`#databaseChecklist .db-mark-${mark}`); return e ? getComputedStyle(e).backgroundColor : null; };
    const chips = [...document.querySelectorAll('#activeFilters .filter-chip')].map(chip => {
        const style = getComputedStyle(chip);
        const tone = [...chip.classList].find(name => name.startsWith('tone-')) || null;
        // (Read from the paper's chip: the Source group's dot, which wears its colour while that option is chosen)
        const dots = tone === 'tone-paper' ? [...document.querySelectorAll('#catalogFilters .filter-section:has(input[name="sourceMode"]) > .filter-section-title .group-dot')]
            : tone ? [...document.querySelectorAll(`#catalogFilters .group-dot.${tone}`)] : [];
        return {key: chip.dataset.filterKey, tone, bar: style.borderLeftColor, barWidth: style.borderLeftWidth, tint: style.backgroundColor,
                edges: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
                lines: new Set([style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor]).size,
                text: Math.round(contrast(style.color, style.backgroundColor) * 10) / 10,
                cross: Math.round(contrast(getComputedStyle(chip.querySelector('.chip-x')).color, style.backgroundColor) * 10) / 10,
                dots: dots.map(dot => ({colour: getComputedStyle(dot).backgroundColor, hidden: dot.getAttribute('aria-hidden'),
                                        shown: dot.getBoundingClientRect().width === 8})),
                states: [...chip.querySelectorAll('.chip-state')].map(e => getComputedStyle(e, '::before').backgroundColor),
                // the option's own mark before its name: the status dot, human-checked's tick, a caution's "!", a database
                // result's square, each in its colour (none for Source, the enzyme fields and the measurement)
                mark: chip.querySelector('.chip-state') ? 'dot' : chip.querySelector('.chip-check') ? 'tick'
                    : chip.querySelector('.chip-flag') ? 'flag' : chip.querySelector('.db-mark') ? 'square' : chip.querySelector('.src-mark') ? 'source' : null,
                markColour: (e => e ? (e.matches('.chip-check') ? getComputedStyle(e).color : getComputedStyle(e).backgroundColor) : null)(
                    chip.querySelector('.chip-check, .chip-flag, .db-mark, .src-mark')),
                words: chip.textContent.trim()};
    });
    probe.style.color = 'var(--line-strong)'; document.body.appendChild(probe); tokens['--line-strong'] = getComputedStyle(probe).color;
    probe.style.color = 'var(--bg)'; tokens['--bg'] = getComputedStyle(probe).color; probe.remove();
    return {chips, tokens, squares: {differs: square('differs'), notListed: square('not-listed'), otherLabel: square('other-label')},
            plainDots: [...document.querySelectorAll('#catalogFilters .filter-section-title')].filter(title => /^(Review result|Compared with databases)/.test(title.textContent.trim()))
                .map(title => title.querySelectorAll('.group-dot').length)};
"""
UNDO_STATE_JS = """
    const bar = document.getElementById('activeFilters');
    const undo = bar.querySelector('[data-filter-undo]');
    const clear = bar.querySelector('[data-filter-clear]');
    const buttons = [...bar.querySelectorAll('button')];
    const box = undo && undo.getBoundingClientRect();
    return {hidden: bar.hidden, undo: undo && !undo.disabled ? undo.getAttribute('aria-label') : null, undoTitle: undo ? undo.title : null,
            undoShown: Boolean(undo && box.width), undoDisabled: Boolean(undo && undo.disabled),
            undoHeight: undo ? box.height : null, undoAt: undo ? [box.left + box.width / 2, box.top + box.height / 2] : null,
            first: Boolean(undo && buttons[0] === undo), clearLast: Boolean(clear && buttons[buttons.length - 1] === clear),
            chips: bar.querySelectorAll('.filter-chip').length,
            focused: document.activeElement && bar.contains(document.activeElement)
                ? (document.activeElement.hasAttribute('data-filter-undo') ? 'undo' : document.activeElement.hasAttribute('data-filter-clear') ? 'clear' : 'chip') : null,
            status: (document.getElementById('tableStatus').textContent || '').trim()};
"""


def check_chip_colours_and_undo(driver, browser, base, wait, open_page, chip_keys, fragment):
    """The active-filter chips are plain (round 14: a tint, a tinted line and a 3px stripe showed one colour three times,
    a template look): a 1px hairline on white, the words, and the option's own mark in its meaning colour where it has
    one, so the colour coding the user asked for (2026-10-15: "can the filters be different color or sth so that its
    user friendly to keep track to undo") lives on the mark: a review result its status dot, human-checked its green
    tick, Read from the paper its cyan square, a database result its square, a caution its tan "!". The filters with no
    meaning colour have no mark and no group dot. Undo, first in the bar, works once a change is made, says what it gives
    back, restores the filter set before the last change (a removed chip, Clear all; Enter on it too) and is dimmed when
    there is nothing more to undo. It keeps its place, so clicking it again at the same point undoes one more change,
    never a chip or Clear all. On a phone the filter sheet's heading has it too, right before × ("Filters · Clear all ·
    Undo · ×"), nothing overlapping. Clicks are centred first (Safari)."""
    results = {}

    def state():
        return driver.execute_script(UNDO_STATE_JS)

    def click(selector):
        element = driver.find_element(By.CSS_SELECTOR, selector)
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", element)
        element.click()

    def plain_chip(chip, tokens):
        return (chip["edges"] == ["1px"] * 4 and chip["lines"] == 1 and chip["bar"] == tokens["--line-strong"]
                and chip["tint"] == tokens["--bg"] and chip["text"] >= 4.5 and chip["cross"] >= 3)

    # Every group at once (no record has them all: the bar then has no Clear all, "Clear search and filters" stands in).
    open_page(base + "#browse?source=paper&checked=1&db=differs&ec=1.1&organism=coli&metric=kcat&tmin=20")
    keys = chip_keys()
    wait.until(lambda d: len(d.execute_script(CHIP_COLOURS_JS)["chips"]) == len(keys))
    page = driver.execute_script(CHIP_COLOURS_JS)
    chips, tokens = page["chips"], page["tokens"]
    tones = {chip["key"]: chip["tone"] for chip in chips}
    assert tones == {"source:paper": "tone-paper", "checked": "tone-checked", "db:differs": "tone-cmp-differs", "ec": "tone-identity",
                     "organism": "tone-identity", "metric:kcat": "tone-measurement", "temperature": "tone-measurement"}, tones
    assert all(plain_chip(chip, tokens) for chip in chips), chips
    # Colour sits on the option's own mark only: Read from the paper's cyan square, human-checked's tick, a database
    # result's square (the sidebar's); the enzyme fields and the measurement have none.
    marks = {chip["key"]: (chip["mark"], chip["markColour"]) for chip in chips}
    assert marks == {"source:paper": ("source", tokens["--src-paper"]), "checked": ("tick", tokens["--checked"]),
                     "db:differs": ("square", tokens["--cmp-differs"]), "ec": (None, None), "organism": (None, None),
                     "metric:kcat": (None, None), "temperature": (None, None)}, marks
    assert page["squares"]["differs"] == tokens["--cmp-differs"], page["squares"]
    # The sidebar's group marks: Source's cyan square while Read from the paper is chosen; no mark beside the groups with
    # no meaning colour (an ink dot there was decoration), nor beside Review result and Compared with databases.
    by_key = {chip["key"]: chip for chip in chips}
    assert by_key["source:paper"]["dots"] and all(dot["shown"] and dot["colour"] == tokens["--src-paper"] for dot in by_key["source:paper"]["dots"]), by_key["source:paper"]
    assert all(not any(dot["shown"] for dot in by_key[key]["dots"]) for key in ("ec", "organism", "metric:kcat", "temperature")), by_key
    assert page["plainDots"] == [0, 0], page["plainDots"]
    open_page(base + "#browse?source=brenda")
    wait.until(lambda d: len(d.execute_script(CHIP_COLOURS_JS)["chips"]) == 1)
    source_chip = driver.execute_script(CHIP_COLOURS_JS)["chips"][0]
    assert source_chip["tone"] == "tone-source" and plain_chip(source_chip, tokens) and source_chip["mark"] is None, source_chip
    assert not any(dot["shown"] for dot in source_chip["dots"]), source_chip
    # A Review result chip names each result after its status dot; a caution its tan "!" (Cautions' title has no dot:
    # each caution option shows its "!", round 15 polish); Not in the databases its square's cyan, Same, other label its
    # square's mint.
    open_page(base + "#browse?status=accepted,curation_pending&caution=units&db=not_listed,other_label")
    wait.until(lambda d: len(d.execute_script(CHIP_COLOURS_JS)["chips"]) == 4)
    page = driver.execute_script(CHIP_COLOURS_JS)
    by_key = {chip["key"]: chip for chip in page["chips"]}
    assert all(plain_chip(chip, tokens) for chip in page["chips"]), page["chips"]
    assert by_key["status"]["states"] == [tokens["--st-accepted"], tokens["--st-pending"]], by_key["status"]
    assert not by_key["caution:units"]["dots"], by_key["caution:units"]
    assert page["squares"]["notListed"] == tokens["--cmp-new"] and page["squares"]["otherLabel"] == tokens["--cmp-other"], page["squares"]
    assert {key: (chip["mark"], chip["markColour"]) for key, chip in by_key.items()} == {
        "status": ("dot", None), "caution:units": ("flag", tokens["--caution-mark"]), "db:not_listed": ("square", tokens["--cmp-new"]),
        "db:other_label": ("square", tokens["--cmp-other"])}, by_key
    results["colours"] = {chip["key"]: chip["markColour"] for chip in page["chips"]}
    # Nothing to undo on a fresh page: the address's filters are the start; Undo is in its place, first, dimmed. (A set
    # with records, so Clear all shows.)
    start = "browse?source=paper&ec=1.1&organism=coli&metric=kcat&tmin=20"
    open_page(base + "#" + start)
    keys = chip_keys()
    now = state()
    assert now["undo"] is None and now["undoShown"] and now["undoDisabled"] and now["first"] and now["clearLast"], now
    assert now["undoTitle"] == "Nothing to undo", now
    # Removing a chip can be undone; Undo, first in the bar, names what it gives back.
    click('#activeFilters .filter-chip[data-filter-key="ec"]')
    wait.until(lambda d: "ec" not in chip_keys() and state()["undo"])
    now = state()
    assert now["first"] and now["clearLast"] and now["undoHeight"] >= 24 and now["undo"] == now["undoTitle"], now
    assert now["undo"].startswith("Undo the last filter change, back to ") and "EC 1.1" in now["undo"], now
    click('#activeFilters [data-filter-undo]')
    wait.until(lambda d: chip_keys() == keys and "ec=1.1" in fragment())
    wait.until(lambda d: state()["undo"] is None)
    assert state()["status"].startswith("Filters restored: "), state()
    results["undo-chip"] = True
    # Clear all can be undone: Undo stays alone in the bar and takes the focus (the likely next step; not the search box,
    # whose examples would open over the counts), and Enter on it brings every filter back.
    click('#activeFilters [data-filter-clear]')
    wait.until(lambda d: not fragment() and state()["undo"] and state()["chips"] == 0)
    assert state()["hidden"] is False, state()
    wait.until(lambda d: state()["focused"] == "undo")
    assert not driver.execute_script("return Boolean(document.getElementById('searchSuggestions')?.getClientRects().length)")
    ActionChains(driver).send_keys(Keys.ENTER).perform()
    wait.until(lambda d: chip_keys() == keys)
    wait.until(lambda d: state()["undo"] is None)
    # The focus stays in the bar (Undo is dimmed: Clear all takes it).
    assert state()["focused"] == "clear", state()
    results["undo-clear-all"] = True

    # Pressing Undo again at the same point undoes one more change and never lands on a chip or Clear all: Undo keeps
    # its place however many chips come back, and stays there dimmed once nothing is left to undo (the reviewer's case).
    def click_at(point):
        actions = ActionBuilder(driver)
        actions.pointer_action.move_to_location(round(point[0]), round(point[1]))
        actions.pointer_action.click()
        actions.perform()

    first = "browse?source=paper&metric=kcat,km&variant=wild&ec=1.1"
    open_page(base + "#" + first)
    keys = chip_keys()
    click('#activeFilters .filter-chip[data-filter-key="variant:wild"]')
    wait.until(lambda d: "variant:wild" not in chip_keys() and state()["undo"])
    click('#activeFilters .filter-chip[data-filter-key="ec"]')
    # (the second change is kept: Undo now goes back to the set with EC and without Wild type)
    wait.until(lambda d: "ec" not in chip_keys() and (lambda undo: "EC 1.1" in undo and "Wild type" not in undo)(state()["undo"] or ""))
    point = state()["undoAt"]
    seen = []
    for expected in (["ec"], ["ec", "variant:wild"], ["ec", "variant:wild"]):
        click_at(point)
        wait.until(lambda d: all(key in chip_keys() for key in expected))
        now = state()
        seen.append(chip_keys())
        assert now["undoAt"] == point and now["first"], (point, now)
    assert sorted(seen[-1]) == sorted(keys) and state()["undoDisabled"], (seen, keys, state())
    assert "km" in fragment() and "variant=wild" in fragment(), fragment()
    results["undo-same-point"] = True
    # Back then Forward is no change for Undo (the reviewer's case): a record opened from Source and EC 1.1, EC removed,
    # Back (onto the set Undo would bring back: that step comes off) and Forward again leave one step, EC 1.1, and Undo
    # then has nothing more to undo instead of taking EC off again.
    open_page(base + "#browse?source=paper&ec=1.1")
    click("#recordsBody tr[data-key] .primary-cell")
    wait.until(lambda d: "record=" in fragment() and d.execute_script("return document.body.classList.contains('detail-open')"))
    click('#activeFilters .filter-chip[data-filter-key="ec"]')
    wait.until(lambda d: "ec" not in chip_keys() and "ec=" not in fragment() and state()["undo"])
    driver.back()
    wait.until(lambda d: "ec=1.1" in fragment() and "ec" in chip_keys())
    wait.until(lambda d: state()["undo"] is None)
    driver.forward()
    wait.until(lambda d: "ec=" not in fragment() and "ec" not in chip_keys() and state()["undo"])
    assert state()["undo"] == "Undo the last filter change, back to Source: Read from the paper; EC 1.1", state()
    click('#activeFilters [data-filter-undo]')
    wait.until(lambda d: "ec" in chip_keys() and "ec=1.1" in fragment())
    wait.until(lambda d: state()["undoDisabled"])
    results["undo-back-forward"] = True
    if browser == "chrome":
        # Typing a word at an ordinary pace (250ms a key: a filter pass after each pause) is one Undo step, not one per
        # pause (lipas, lipa, lip, li, l).
        open_page(base + "#browse?source=paper")
        click('#measurementChecklist input[value="km"]')
        wait.until(lambda d: "metric=km" in fragment() and state()["undo"])
        field = driver.find_element(By.ID, "enzymeFilterInput")
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'}); arguments[0].focus()", field)
        typing = ActionChains(driver)
        for key in "lipase":
            typing.send_keys(key).pause(0.25)
        typing.perform()
        wait.until(lambda d: "enzyme=lipase" in fragment())
        click('#activeFilters [data-filter-undo]')
        wait.until(lambda d: "enzyme" not in fragment() and "metric=km" in fragment())
        # (the next Undo takes back the ticked Km)
        assert field.get_attribute("value") == "" and state()["undo"] == "Undo the last filter change, back to Source: Read from the paper", state()
        results["undo-typing"] = True
        # A bound typed and Undo pressed at once: the bound applies as it loses the focus, between press and release, and
        # the chips are redrawn; the press still reaches Undo and takes back the bound only (one press, one change).
        open_page(base + "#browse?source=paper")
        click('#measurementChecklist input[value="km"]')
        wait.until(lambda d: "metric=km" in fragment() and state()["undo"])
        bound = driver.find_element(By.ID, "temperatureMinInput")
        driver.execute_script("for (let group = arguments[0].closest('details'); group; group = group.parentElement.closest('details'))"
                              " group.open = true; arguments[0].scrollIntoView({block: 'center'}); arguments[0].focus()", bound)
        x, y = state()["undoAt"]
        ActionChains(driver).send_keys("25").perform()
        driver.execute_cdp_cmd("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1})
        wait.until(lambda d: "tmin=25" in fragment())
        driver.execute_cdp_cmd("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1})
        wait.until(lambda d: "tmin" not in fragment())
        assert "metric=km" in fragment() and bound.get_attribute("value") == "", fragment()
        assert state()["undo"] == "Undo the last filter change, back to Source: Read from the paper", state()
        results["undo-bound-press"] = True
    if browser == "chrome":
        # The phone sheet's heading: Filters, the count, Clear all, Undo and × on one line, none overlapping; Undo always
        # shows right before × (dimmed with nothing to undo), so Clear all coming and going never moves it: a second tap
        # on Undo after Clear all and Undo does nothing.
        for width in (390, 320):
            set_browse_viewport(driver, browser, width, 844)
            open_page(base + "#" + start)
            keys = chip_keys()
            driver.find_element(By.ID, "openFiltersButton").click()
            wait.until(lambda d: d.find_element(By.ID, "showResultsButton").is_displayed())
            # Source is under More filters in the sheet too (round 14), opened by the address's source=paper.
            assert driver.execute_script("return document.getElementById('moreFilters').open"
                                         " && document.querySelector('#moreFilters input[name=\"sourceMode\"][value=\"paper\"]').checked"), width
            sheet_undo = driver.find_element(By.ID, "undoFiltersButton")
            assert sheet_undo.is_displayed() and not sheet_undo.is_enabled(), width
            click('#measurementChecklist input[value="km"]')
            wait.until(lambda d: d.find_element(By.ID, "undoFiltersButton").is_enabled())
            heading = driver.execute_script("""
                const items = [...document.querySelector('#catalogFilters .rail-heading').children]
                    .filter(e => e.getClientRects().length && getComputedStyle(e).display !== 'none').map(e => e.getBoundingClientRect());
                const overlap = items.some((a, i) => items.slice(i + 1).some(b => a.left < b.right - 0.5 && b.left < a.right - 0.5));
                const ids = [...document.querySelector('#catalogFilters .rail-heading').children]
                    .filter(e => e.getClientRects().length && getComputedStyle(e).display !== 'none').map(e => e.id || e.className);
                const undo = document.getElementById('undoFiltersButton');
                return {overlap, ids, inside: items.every(r => r.right <= innerWidth + 0.5 && r.left >= -0.5),
                        oneLine: Math.max(...items.map(r => r.top)) - Math.min(...items.map(r => r.top)) < 20,
                        label: undo.getAttribute('aria-label'), height: undo.getBoundingClientRect().height};
            """)
            assert not heading["overlap"] and heading["inside"] and heading["oneLine"] and heading["height"] >= 24, (width, heading)
            assert heading["ids"][-3:] == ["clearButton", "undoFiltersButton", "closeFiltersButton"], heading
            assert heading["label"].startswith("Undo the last filter change, back to "), heading
            # Each group's "?" in the sheet keeps its 24px circle and is a 44px target (every group opened, More filters too).
            driver.execute_script("document.querySelectorAll('#catalogFilters details').forEach(group => { group.open = true; })")
            # (each group opened scrolls the sheet smoothly to show it, revealFilterSection: a "?" is measured once that
            # scrolling has stopped, else a probe can land on the sticky heading or the Show records bar)
            settled = "const r = arguments[0].getBoundingClientRect(); return [Math.round(r.top * 2), document.getElementById('catalogFilters').scrollTop]"
            for about in [e for e in driver.find_elements(By.CSS_SELECTOR, "#catalogFilters .filter-section > .section-about") if e.is_displayed()]:
                for _ in range(20):
                    driver.execute_script("arguments[0].scrollIntoView({block: 'center', behavior: 'instant'})", about)
                    before = driver.execute_script(settled, about)
                    time.sleep(0.15)
                    if driver.execute_script(settled, about) == before:
                        break
                size = driver.execute_script("const r = arguments[0].getBoundingClientRect(); return [r.width, r.height]", about)
                assert size == [24, 24] and driver.execute_script(ABOUT_TARGET_JS, about) == 44, (width, about.get_attribute("aria-controls"), size)
            sheet_at = driver.execute_script("const r = document.getElementById('undoFiltersButton').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]")
            driver.find_element(By.ID, "undoFiltersButton").click()
            wait.until(lambda d: not d.find_element(By.ID, "undoFiltersButton").is_enabled())
            assert not driver.find_element(By.CSS_SELECTOR, '#measurementChecklist input[value="km"]').is_selected()
            assert sorted(chip_keys()) == sorted(keys), chip_keys()
            driver.find_element(By.ID, "clearButton").click()
            wait.until(lambda d: not fragment() and d.find_element(By.ID, "undoFiltersButton").is_enabled())
            # Clear all hands the focus to Undo beside it, not to the sheet.
            wait.until(lambda d: d.execute_script("return document.activeElement.id") == "undoFiltersButton")
            for _ in range(2):
                click_at(sheet_at)
                wait.until(lambda d: sorted(chip_keys()) == sorted(keys) and not d.find_element(By.ID, "undoFiltersButton").is_enabled())
                assert driver.execute_script("const r = document.getElementById('undoFiltersButton').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]") == sheet_at
            assert driver.find_element(By.ID, "clearButton").is_displayed()
            driver.find_element(By.ID, "showResultsButton").click()
            # (the sheet slides away in 200ms: the screenshot below shows the page without it)
            wait.until(lambda d: d.execute_script("return !document.body.classList.contains('filters-open')"
                                                  " && getComputedStyle(document.getElementById('catalogFilters')).visibility === 'hidden'"))
            # The chips wrap within the width, Undo and Clear all with them, nothing overlapping or wider than the screen.
            click('#activeFilters .filter-chip[data-filter-key="organism"]')
            wait.until(lambda d: state()["undo"])
            wrap = driver.execute_script("""
                const bar = document.getElementById('activeFilters');
                const items = [...bar.children].map(e => e.getBoundingClientRect());
                const overlap = items.some((a, i) => items.slice(i + 1).some(b => a.left < b.right - 0.5 && b.left < a.right - 0.5
                    && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5));
                // Each line starts where the bar does (a wrapped Undo or Clear all is not set 4px in).
                const starts = items.filter((r, i) => i === 0 || r.top >= items[i - 1].bottom - 0.5).map(r => r.left - bar.getBoundingClientRect().left);
                return {overlap, inside: items.every(r => r.right <= innerWidth + 0.5), wide: document.documentElement.scrollWidth <= innerWidth + 1,
                        starts};
            """)
            assert not wrap["overlap"] and wrap["inside"] and wrap["wide"], (width, wrap)
            assert all(abs(start) <= 0.5 for start in wrap["starts"]), (width, wrap)
            driver.save_screenshot(str(OUTPUT / f"{browser}-chips-undo-{width}.png"))
            results[f"phone-{width}"] = True
        set_browse_viewport(driver, browser, 1440, 1000)
    open_page(base + "#browse")
    return results


def check_phone_scroll(driver, browser, url):
    """Phones (2026-10-15): the page scrolls as a whole, never a letterbox of one or two cards under a pinned header; the
    pager sticks to the foot of the window and is in reach on an iPhone SE (320x568); a new page opens at the table's
    top; the page keeps its place while a record is open. From 641px the table scrolls inside its box as before."""
    if browser != "chrome":
        return {"route": "phone-scroll", "skipped": "Chrome only"}
    wait = WebDriverWait(driver, 120, ignored_exceptions=(StaleElementReferenceException,))
    loaded = lambda d: d.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]") and not d.find_elements(By.CSS_SELECTOR, "#recordsBody tr.skeleton-row")
    state_js = """
        const page = document.scrollingElement, wrap = document.getElementById('recordTableWrap');
        const pager = document.querySelector('.pagination'), box = pager.getBoundingClientRect();
        return {pageScrolls: page.scrollHeight > page.clientHeight + 1, wrapOverflow: getComputedStyle(wrap).overflowY,
                sticky: getComputedStyle(pager).position, pagerInView: box.top >= 0 && box.bottom <= innerHeight + 1,
                nextInView: document.getElementById('nextButton').getBoundingClientRect().bottom <= innerHeight + 1,
                scrollTop: page.scrollTop, wrapTop: wrap.getBoundingClientRect().top + page.scrollTop};
    """
    results = {}
    try:
        for width, height in ((320, 568), (390, 664)):
            driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": True})
            driver.get("about:blank")
            driver.get(url + "#browse")
            wait.until(loaded)
            top = driver.execute_script(state_js)
            assert top["pageScrolls"] and top["wrapOverflow"] == "visible" and top["sticky"] == "sticky", (width, top)
            assert top["pagerInView"] and top["nextInView"], f"The pager is out of reach at {width}x{height}: {top}"
            driver.execute_script("window.scrollTo(0, document.scrollingElement.scrollHeight)")
            bottom = driver.execute_script(state_js)
            assert bottom["scrollTop"] > 0 and bottom["pagerInView"], (width, bottom)
            # Next opens the new page at the table's top (the window, not the table's box, scrolls here).
            first_keys = [row.get_attribute("data-key") for row in driver.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")]
            driver.find_element(By.ID, "nextButton").click()
            wait.until(lambda d: loaded(d) and [row.get_attribute("data-key") for row in d.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")] != first_keys)
            turned = driver.execute_script(state_js)
            assert abs(turned["scrollTop"] - turned["wrapTop"]) <= 2, (width, turned)
            # A record keeps the page where it was.
            driver.execute_script("window.scrollTo(0, document.scrollingElement.scrollHeight)")
            before = driver.execute_script("return document.scrollingElement.scrollTop")
            cards = driver.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key] .primary-cell")
            cards[-1].click()
            wait.until(lambda d: d.execute_script("return document.body.classList.contains('detail-open') && !document.querySelector('#detailLoadStatus')"))
            assert driver.execute_script("return document.scrollingElement.scrollTop") == before, "The page moved under the record"
            driver.find_element(By.ID, "closeDetailButton").click()
            wait.until(lambda d: not d.execute_script("return document.body.classList.contains('detail-open')"))
            assert abs(driver.execute_script("return document.scrollingElement.scrollTop") - before) <= 2, "The page moved while the record was open"
            driver.save_screenshot(str(OUTPUT / f"{browser}-phone-scroll-{width}x{height}.png"))
            results[f"{width}x{height}"] = True
        # From 641px the table scrolls inside its box and the page does not.
        driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": 800, "height": 600, "deviceScaleFactor": 1, "mobile": False})
        driver.get("about:blank")
        driver.get(url + "#browse")
        wait.until(loaded)
        wide = driver.execute_script(state_js)
        assert not wide["pageScrolls"] and wide["wrapOverflow"] == "auto", wide
        results["800x600"] = True
        # Nor on a desktop (round 13: a label hidden for screen readers in More filters once lengthened the page by 187px,
        # so a wheel over the header slid the header, the counts band and the toolbar away).
        for width, height in ((1280, 708), (1440, 708)):
            driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": False})
            driver.get("about:blank")
            driver.get(url + "#browse")
            wait.until(loaded)
            wide = driver.execute_script(state_js)
            assert not wide["pageScrolls"], (width, height, wide)
            results[f"{width}x{height}"] = True
    finally:
        driver.execute_cdp_cmd("Emulation.clearDeviceMetricsOverride", {})
    return {"route": "phone-scroll", "passed": True, "checked": results}


# The counts band's lines of context (round 15) as shown, and as the page should write them from the counts the band
# shows (read in the same call): the share rounded as the page rounds it (bandShare: one decimal; 100% and 0% only when
# exact; <0.1% and >99.9% at the ends), the papers from the snapshot (an unfiltered view). textContent, whitespace
# collapsed: a screen reader's text, the share's "of records" included where the cell is narrow.
BAND_NOTES_JS = """
const [papers, fromPaperPapers] = arguments;
const share = (count, total) => {
  if (!(total > 0) || !(count >= 0) || count > total) return '';
  if (count === 0) return '0%';
  if (count === total) return '100%';
  const percent = count / total * 100;
  return percent < 0.1 ? '<0.1%' : percent > 99.9 ? '>99.9%' : `${percent.toFixed(1)}%`;
};
const text = selector => (document.querySelector(selector)?.textContent || '').replace(/\\s+/g, ' ').trim();
const number = selector => Number(text(selector).replace(/,/g, '')) || 0;
const words = count => `${count.toLocaleString('en-US')} ${count === 1 ? 'paper' : 'papers'}`;
const records = number('.summary-records > strong'), accepted = number('.summary-accepted > strong');
const fromPaper = number('#fromPaperCount'), checked = number('#humanCheckedCount');
const paperShare = fromPaper > 0 ? share(fromPaper, records) : '';
return {
  shown: {records: text('.summary-records > .snapshot-note'), accepted: text('.summary-accepted > .snapshot-note'),
          paper: text('#fromPaperNote'), checked: text('#humanCheckedNote')},
  expected: {records: papers > 0 ? words(papers) : '', accepted: accepted > 0 ? `${share(accepted, records)} of records` : '',
             paper: !paperShare ? '' : paperShare === '100%' ? words(fromPaperPapers) : `${paperShare} of records · ${words(fromPaperPapers)}`,
             checked: checked > 0 && accepted > 0 ? `${share(checked, accepted)} of accepted` : ''},
};
"""

# Where the counts band's rule before the parameters sits, whether every key number and parameter count has a width
# inside its own cell, and two lines of context (round 15: a filter never moves the columns).
BAND_SPOTS_JS = """
const meta = document.getElementById('snapshotMeta');
const cells = [...document.querySelectorAll('.summary-records, .summary-accepted, #fromPaperLink, #humanCheckedLink, #snapshotMeta')];
const numbers = cells.every(cell => [...cell.querySelectorAll('strong')].filter(e => e.getClientRects().length).every(strong => {
  const r = strong.getBoundingClientRect(), c = cell.getBoundingClientRect();
  return r.width > 0 && r.left >= c.left - 0.5 && r.right <= c.right + 0.5;
}));
return {rule: meta.getBoundingClientRect().left, numbers,
        paperNote: (document.getElementById('fromPaperNote')?.textContent || '').replace(/\\s+/g, ' ').trim(),
        acceptedNote: (document.querySelector('.summary-accepted > .snapshot-note')?.textContent || '').replace(/\\s+/g, ' ').trim()};
"""


def check_layout(driver, browser, url, route_label):
    """The page grid: a 56px header, the counts band (28px numbers, 13px labels, a 12px line of context), the filter sidebar beside the table
    (open from 1200px and the rail from 1024 to 1199px, a viewer's other choice remembered; the rail while a record is
    open below 1600px; side by side from 1600px; the rail on tablets) and the record as a column from 1024px, a dialog
    below."""
    wait = WebDriverWait(driver, 120, ignored_exceptions=(StaleElementReferenceException,))
    base = url.split("#", 1)[0]

    def open_page(address=""):
        driver.get("about:blank")
        driver.get(base + address)
        wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")
                   and not d.find_elements(By.CSS_SELECTOR, "#recordsBody tr.skeleton-row"))

    def box(selector):
        return driver.execute_script("""
            const e = document.querySelector(arguments[0]);
            if (!e) return null;
            const r = e.getBoundingClientRect();
            return {left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom),
                    width: Math.round(r.width), height: Math.round(r.height)};
        """, selector)

    def is_open():
        return driver.execute_script("return document.body.classList.contains('filters-open')")

    def detail_open():
        return driver.execute_script("return document.body.classList.contains('detail-open')")

    def stored():
        return driver.execute_script("try { return localStorage.getItem('catlog.filtersCollapsed'); } catch (e) { return 'unavailable'; }")

    def side_by_side(*selectors):
        boxes = [box(selector) for selector in selectors]
        return all(left["right"] <= right["left"] + 1 for left, right in zip(boxes, boxes[1:])), boxes

    def record_header_scrolled():
        # Scrolls the open record; says whether the name and × stay at its top and whether the status line stays in view.
        return driver.execute_script("""
            const panel = document.getElementById('detailPanel');
            panel.scrollTop = 600;
            const top = panel.getBoundingClientRect().top;
            const title = panel.querySelector('.detail-title').getBoundingClientRect();
            const close = document.getElementById('closeDetailButton').getBoundingClientRect();
            const status = panel.querySelector('.detail-status').getBoundingClientRect();
            const result = {scrolled: panel.scrollTop, titleTop: Math.round(title.top - top), closeShown: close.top >= top - 1,
                            statusShown: status.top >= top - 1, share: Math.round(title.height / panel.clientHeight * 100) / 100};
            panel.scrollTop = 0;
            return result;
        """)

    results = {}
    try:
        set_browse_viewport(driver, browser, 1440, 1000)
        open_page()
        driver.execute_script("try { localStorage.removeItem('catlog.filtersCollapsed'); } catch (e) {}")
        open_page()
        # Header and counts band.
        assert box(".app-header")["height"] == 56, box(".app-header")
        band = box(".snapshot-band")
        # One line on what CatLog is opens the band (round 13: the visitors' "what is this?"), then the card. Round 15: the
        # line no longer repeats the band's numbers, and the snapshot date ends it at the right.
        lead = box(".snapshot-lead")
        lead_text = driver.find_element(By.CSS_SELECTOR, ".snapshot-lead").get_attribute("innerText").strip()
        date_text = driver.find_element(By.ID, "snapshotDate").get_attribute("innerText").strip()
        assert (abs(lead["height"] - 18) <= 1 and "being read from their papers." in lead_text and date_text.startswith("Snapshot ")
                and not re.search(r"\d", lead_text.replace(date_text, ""))), (lead, lead_text)
        # one row: a label, a number and a line of context in each cell, about as tall as the round 14 band (72-78px then)
        assert 82 <= band["height"] - lead["height"] - 4 <= 90, f"The counts band is one row of key numbers in its card: {band}"
        sizes = driver.execute_script("""
            const px = (selector, prop) => [...document.querySelectorAll(selector)].filter(e => e.getClientRects().length)
                .map(e => getComputedStyle(e)[prop]);
            return {numbers: px('.summary-card strong, .snapshot-paper > strong, .snapshot-checked > strong', 'fontSize'),
                    with: px('.snapshot-line strong', 'fontSize'), labels: px('.summary-card > span, .snapshot-paper > span, .snapshot-checked > span', 'fontSize'),
                    notes: px('.snapshot-overview .snapshot-note', 'fontSize'), withLabels: px('.snapshot-line > span', 'fontSize'),
                    th: px('#recordTableWrap thead th', 'fontSize'), thWeight: px('#recordTableWrap thead th', 'fontWeight'),
                    td: px('#recordsBody td.c-organism', 'fontSize')};
        """)
        # the key numbers 28px (round 13: a focal point); the parameters' counts (kcat, Km, kcat/Km) are secondary at 16px
        # under labels like the others; a 12px line of context under each (round 15: no bare numbers)
        assert (set(sizes["numbers"]) == {"28px"} and set(sizes["with"]) == {"16px"} and set(sizes["labels"]) == {"13px"}
                and set(sizes["withLabels"]) == {"13px"} and set(sizes["notes"]) == {"12px"} and len(sizes["notes"]) >= 4), sizes
        # Each line of context is a fact from the snapshot and the counts beside it: the papers behind the records,
        # Accepted's share of the records, Read from the paper's share and papers, Human-checked's share of the accepted
        # records. The shares are worked out here as the page does (one decimal, 100% and 0% only when exact, <0.1% and
        # >99.9% at the ends), from the numbers the band shows, in one read.
        overview_now = stats_overview(driver.execute_script("return window.CATLOG_STATIC_MANIFEST")) or {}
        if overview_now:
            notes = driver.execute_script(BAND_NOTES_JS, overview_now.get("papers"), (overview_now.get("from_paper") or {}).get("papers"))
            assert notes["shown"] == notes["expected"] and notes["shown"]["records"], notes
        # Each key number in its meaning's colour (Records the page's ink, Accepted the status navy, Read from the paper
        # the darker BPG cyan, Human-checked the darker BPG green), on a plain white card with a 1px hairline: no glow,
        # wash or gradient (round 14).
        colours = driver.execute_script("""
            const css = getComputedStyle(document.documentElement), probe = document.createElement('i');
            document.body.appendChild(probe);
            const resolve = name => { probe.style.color = css.getPropertyValue(name).trim(); return getComputedStyle(probe).color; };
            const ink = selector => getComputedStyle(document.querySelector(selector)).color;
            const card = getComputedStyle(document.querySelector('.snapshot-overview'));
            const result = {records: [ink('.summary-records strong'), resolve('--text')], accepted: [ink('.summary-accepted strong'), resolve('--st-accepted')],
                paper: [ink('#fromPaperCount'), resolve('--src-paper-ink')], checked: [ink('#humanCheckedCount'), resolve('--checked')],
                shadow: card.boxShadow, wash: card.backgroundImage, border: card.borderTopWidth, line: [card.borderTopColor, resolve('--line')]};
            probe.remove();
            return result;
        """)
        for key in ("records", "accepted", "paper", "checked"):
            assert colours[key][0] == colours[key][1], (key, colours)
        # Every label is muted (round 14: three dark teals had read as one family); the colour is on the mark before it,
        # Accepted's navy dot, Read from the paper's BPG cyan square and Human-checked's green tick, and on the number.
        marks = driver.execute_script("""
            const probe = document.createElement('i'); document.body.appendChild(probe);
            const resolve = name => { probe.style.color = `var(${name})`; return getComputedStyle(probe).color; };
            const result = {labels: [...document.querySelectorAll('.summary-card > span, .snapshot-paper > span, .snapshot-checked > span')].map(e => getComputedStyle(e).color),
                muted: resolve('--muted'), dot: getComputedStyle(document.querySelector('.summary-accepted > span'), '::before').backgroundColor,
                square: getComputedStyle(document.querySelector('.snapshot-paper > span'), '::before').backgroundColor,
                tick: getComputedStyle(document.querySelector('.snapshot-checked .check-icon')).color,
                want: [resolve('--st-accepted'), resolve('--src-paper'), resolve('--checked')]};
            probe.remove();
            return result;
        """)
        assert set(marks["labels"]) == {marks["muted"]} and [marks["dot"], marks["square"], marks["tick"]] == marks["want"], marks
        assert len({colours[key][0] for key in ("records", "accepted", "paper", "checked")}) == 4, colours
        assert colours["shadow"] == "none" and colours["wash"] == "none" and colours["border"] == "1px" and colours["line"][0] == colours["line"][1], colours
        # Type set in columns, not tiles (round 15): one thin rule, before the parameters; none between the key numbers.
        rules = driver.execute_script("""return [...document.querySelectorAll('.snapshot-overview *')].filter(e => e.getClientRects().length
            && parseFloat(getComputedStyle(e).borderLeftWidth) > 0).map(e => e.id || e.className)""")
        assert rules == ["snapshotMeta"], rules
        assert set(sizes["th"]) == {"12px"} and set(sizes["thWeight"]) == {"600"} and set(sizes["td"]) == {"13px"}, sizes
        date, card = box("#snapshotDate"), box(".snapshot-overview")
        # at the right end of the line over the card, its right edge on the card's (round 15)
        assert (abs(date["top"] - lead["top"]) <= 1 and abs(date["left"] + date["width"] - card["left"] - card["width"]) <= 1
                and band["top"] - 1 <= date["top"] and date["bottom"] <= band["top"] + band["height"] + 1), (
            f"At 1440px the snapshot date ends the line over the counts band: {date} {card}")
        # The sidebar: open beside the table, never over it.
        assert is_open() and box(".filter-column")["width"] == 288, box(".filter-column")
        ok, boxes = side_by_side(".filter-column", ".table-panel")
        assert ok, f"The sidebar sits beside the table: {boxes}"
        assert driver.find_element(By.ID, "catalogFilters").get_attribute("role") is None
        assert not driver.find_element(By.ID, "openFiltersButton").is_displayed()
        # « collapses it to the 48px rail, remembered on reload; the rail's Filters opens it again.
        driver.find_element(By.ID, "collapseFiltersButton").click()
        wait.until(lambda d: not is_open())
        assert box(".filter-column")["width"] == 48 and driver.find_element(By.ID, "filterRailButton").is_displayed()
        assert driver.switch_to.active_element.get_attribute("id") == "filterRailButton"
        assert stored() in ("1", "unavailable")
        open_page()
        if stored() == "1":
            assert not is_open() and box(".filter-column")["width"] == 48, "A collapsed sidebar stays collapsed on reload"
        if not is_open():
            driver.find_element(By.ID, "filterRailButton").click()
        wait.until(lambda d: is_open() and box(".filter-column")["width"] == 288)
        assert stored() in (None, "unavailable")
        results["sidebar-1440"] = True
        # The sidebar is compact: no option's text runs past its row or into the next one, and a group's "?" shows its
        # explanations under its title (and hides them again).
        # (every group opened, More filters' too, then put back as it was)
        overlaps = driver.execute_script("""
            const bad = [];
            const groups = [...document.querySelectorAll('#catalogFilters details')];
            const was = groups.map(group => group.open);
            groups.forEach(group => { group.open = true; });
            const rows = [...document.querySelectorAll('#catalogFilters :is(.check-row, .range-row, .field-grid label)')].filter(e => e.getClientRects().length);
            rows.forEach((row, i) => {
                const r = row.getBoundingClientRect();
                [...row.children].filter(c => c.getClientRects().length).forEach(c => {
                    const b = c.getBoundingClientRect();
                    if (b.bottom > r.bottom + 0.5 || b.right > r.right + 0.5) bad.push(row.innerText.trim());
                });
                const next = rows[i + 1]?.getBoundingClientRect();
                if (next && Math.abs(next.left - r.left) < 1 && next.top < r.bottom - 0.5 && !row.matches('label')) bad.push(row.innerText.trim());
            });
            groups.forEach((group, index) => { group.open = was[index]; });
            return bad;
        """)
        assert not overlaps, f"Sidebar options overlap: {overlaps}"
        # A group's chevron and "?" stay level with its title's first line, also when a wide font wraps the title.
        # (every group opened, More filters' too, then put back as it was)
        misaligned = driver.execute_script("""
            const bad = [];
            const groups = [...document.querySelectorAll('#catalogFilters details')];
            const was = groups.map(group => group.open);
            groups.forEach(group => { group.open = true; });
            document.querySelectorAll('#catalogFilters .filter-section').forEach(section => {
                if (!section.getClientRects().length) return;
                const summary = section.querySelector(':scope > summary');
                const text = [...summary.childNodes].find(node => node.textContent.trim());
                const range = document.createRange();
                range.selectNodeContents(text);
                const first = [...range.getClientRects()].find(r => r.width > 0.5);
                const centre = (r) => (r.top + r.bottom) / 2;
                const marks = [summary.querySelector('.chevron'), section.querySelector(':scope > .section-about')]
                    .filter(e => e && e.getClientRects().length);
                if (marks.some(e => Math.abs(centre(e.getBoundingClientRect()) - centre(first)) > 1.5)) bad.push(summary.innerText.trim());
            });
            groups.forEach((group, index) => { group.open = was[index]; });
            return bad;
        """)
        assert not misaligned, f"Group chevron or '?' off its title's first line: {misaligned}"
        # The Source radios name what happened to each record, Read from the paper and Not yet re-read, one line each
        # beside its count, also in a wide font (Verdana here, DejaVu Sans on Linux) at the sidebar's 256px (1280px
        # window), with today's counts and with a six-figure count the catalog will reach; the help is behind the "?".
        # (Source is under More filters since round 14: a visitor opens it by its title; a scripted click in Safari,
        # whose driver may not click a <summary>.)
        set_browse_viewport(driver, browser, 1280, 1000)
        more_title = driver.find_element(By.CSS_SELECTOR, "#moreFilters > summary")
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", more_title)
        if not driver.execute_script("return document.getElementById('moreFilters').open"):
            if browser == "safari":
                driver.execute_script("arguments[0].click()", more_title)
            else:
                more_title.click()
        wait.until(lambda d: d.execute_script("return document.getElementById('moreFilters').open"))
        source_rows = driver.execute_script("""
            const style = document.createElement('style');
            style.id = 'wideSourceFont';
            style.textContent = "#sourceChecklist, #sourceChecklist * {font-family: Verdana, 'DejaVu Sans', sans-serif !important}";
            document.head.appendChild(style);
            const lines = (e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight));
            const rows = [...document.querySelectorAll('#sourceChecklist .radio-row')];
            const measure = () => rows.map(row => {
                const label = row.querySelector(':scope > span');
                return {label: label.innerText.trim(), labelLines: lines(label), spans: row.querySelectorAll(':scope > span').length,
                        countLevel: Math.abs(row.querySelector('strong').getBoundingClientRect().top - label.getBoundingClientRect().top) < 3};
            });
            const now = measure();
            const counts = rows.map(row => row.querySelector('strong').textContent);
            rows.forEach(row => { row.querySelector('strong').textContent = '888,888'; });
            const grown = measure();
            rows.forEach((row, index) => { row.querySelector('strong').textContent = counts[index]; });
            style.remove();
            return now.concat(grown);
        """)
        assert [row["label"] for row in source_rows] == ["All records", "Read from the paper", "Not yet re-read"] * 2, source_rows
        assert all(row["labelLines"] == 1 and row["spans"] == 1 and row["countLevel"] for row in source_rows), source_rows
        set_browse_viewport(driver, browser, 1440, 1000)
        about = driver.find_element(By.CSS_SELECTOR, '#catalogFilters .section-about[aria-controls="aboutSource"]')
        assert not driver.find_element(By.ID, "aboutSource").is_displayed()
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", about)
        about.click()
        assert about.get_attribute("aria-expanded") == "true" and driver.find_element(By.ID, "aboutSource").is_displayed()
        about_text = driver.execute_script("return document.getElementById('aboutSource').innerText")
        assert "a second, separate AI check" in about_text and "partly checked against the papers" in about_text, about_text
        assert "replaced when CatLog reads the paper" in about_text and not re.search(r"\bv[12]\b", about_text), about_text
        about.click()
        assert about.get_attribute("aria-expanded") == "false" and not driver.find_element(By.ID, "aboutSource").is_displayed()
        driver.execute_script("document.getElementById('moreFilters').open = false")
        # In a short window, opening Review result's "?" scrolls the sidebar just enough to keep its options in view, never
        # taking its title under the sticky heading; closing it again leaves the sidebar where it is. (720px: the counts
        # band's card, round 13, is 11px taller than the old 64px band, so the sidebar is as tall as it was at 700px.)
        set_browse_viewport(driver, browser, 1440, 720)
        driver.execute_script("document.getElementById('catalogFilters').scrollTop = 0")
        status_about = driver.find_element(By.CSS_SELECTOR, '#catalogFilters .section-about[aria-controls="aboutStatus"]')
        status_about.click()
        reveal = """
            const rail = document.getElementById('catalogFilters').getBoundingClientRect();
            const heading = document.querySelector('.rail-heading').getBoundingClientRect();
            const section = document.querySelector('[aria-controls="aboutStatus"]').closest('.filter-section');
            const rows = [...section.querySelectorAll('.check-row')].filter(e => e.getClientRects().length);
            const last = rows[rows.length - 1].getBoundingClientRect();
            const title = section.querySelector(':scope > summary').getBoundingClientRect();
            // a group taller than the sidebar's view (a wide font's longer "?" box in a short window) scrolls until its
            // title meets the scroll padding under the heading, and no further
            const pad = parseFloat(getComputedStyle(document.getElementById('catalogFilters')).scrollPaddingTop) || 0;
            return {lastShown: last.bottom <= rail.bottom + 0.5, titleClear: title.top >= heading.bottom - 0.5,
                    tall: last.bottom - title.top > rail.bottom - (rail.top + pad), titleAtPad: Math.abs(title.top - (rail.top + pad)) < 1.5,
                    scrolled: document.getElementById('catalogFilters').scrollTop};
        """
        positions = []

        def scroll_settled(d):
            positions.append(d.execute_script(reveal)["scrolled"])
            return len(positions) > 2 and positions[-1] == positions[-2] == positions[-3]

        WebDriverWait(driver, 5, poll_frequency=0.1).until(scroll_settled)
        shown = driver.execute_script(reveal)
        assert (shown["lastShown"] or (shown["tall"] and shown["titleAtPad"])) and shown["titleClear"] and shown["scrolled"] > 0, \
            f"Review result's '?' hides its options: {shown}"
        status_about.click()
        assert not driver.find_element(By.ID, "aboutStatus").is_displayed()
        # (unless the sidebar, shorter now, ends above that: then it stays at its end)
        end = driver.execute_script("const rail = document.getElementById('catalogFilters'); return rail.scrollHeight - rail.clientHeight")
        assert driver.execute_script(reveal)["scrolled"] == min(shown["scrolled"], end), "Closing a '?' moved the sidebar"
        driver.execute_script("document.getElementById('catalogFilters').scrollTop = 0")
        set_browse_viewport(driver, browser, 1440, 1000)
        # The browser's own colour (theme-color) is the page's white (round 14: no teal; the accent is ink).
        theme = driver.execute_script("""
            return {meta: document.querySelector('meta[name="theme-color"]').content.toLowerCase(),
                    bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toLowerCase()};
        """)
        assert theme["meta"] == theme["bg"] == "#ffffff", theme
        # Every row is 44px: a variant's tag under the name and a condition note under the substrate add no height.
        for width in (1440, 1024):
            set_browse_viewport(driver, browser, width, 1000)
            open_page("#browse?variant=variant")
            heights = driver.execute_script("""
                const rows = [...document.querySelectorAll('#recordsBody tr[data-key]')];
                const tagged = rows.filter(row => row.querySelector('.primary-cell .enzyme-form'));
                // The note as the table writes it, under the first variant row's substrate.
                const cell = tagged[0]?.querySelector('td.c-substrate');
                if (cell && !cell.querySelector('.condition-note')) {
                  cell.classList.add('has-note');
                  cell.insertAdjacentHTML('beforeend', '<small class="condition-note">+10 mM fructose 1,6-bisphosphate</small>');
                }
                return {tagged: tagged.length, noted: rows.filter(row => row.querySelector('.condition-note')).length,
                        heights: [...new Set(rows.map(row => Math.round(row.getBoundingClientRect().height)))]};
            """)
            assert heights["tagged"] and heights["noted"] and heights["heights"] == [44], (
                f"At {width}px rows with a variant tag or a condition note stay 44px: {heights}")
        # The table has no temperature column: a temperature caution's "!" and its words, T questionable, open the line
        # under the substrate of every row the Temperature questionable caution finds (the rows stay 44px).
        overview = ((driver.execute_script("return window.CATLOG_STATIC_MANIFEST") or {}).get("summary") or {}).get("overview") or {}
        if ((overview.get("cautions") or {}).get("temperature") or 0) > 0:
            set_browse_viewport(driver, browser, 1440, 1000)
            open_page("#browse?caution=temperature")
            marks = driver.execute_script("""
                const rows = [...document.querySelectorAll('#recordsBody tr[data-key]')];
                const marked = rows.filter(row => {
                  const flag = row.querySelector('td.c-substrate .condition-note .value-flag');
                  return flag && /temperature/i.test(flag.getAttribute('aria-label') || '') && flag.innerText.trim() === 'T questionable';
                });
                return {rows: rows.length, marked: marked.length,
                        heights: [...new Set(rows.map(row => Math.round(row.getBoundingClientRect().height)))]};
            """)
            assert marks["rows"] and marks["marked"] == marks["rows"] and marks["heights"] == [44], (
                f"Every Temperature questionable row says so under its substrate: {marks}")
        # The phone cards' value labels stay hidden in the table (its headings name the columns).
        assert driver.execute_script("""
            const labels = [...document.querySelectorAll('#recordsBody .card-label')];
            return labels.length > 0 && labels.every(label => getComputedStyle(label).display === 'none');
        """), "The table shows no card labels"
        results["row-height"] = True
        # The one-line header (from 1024px) never cuts the search box's placeholder.
        for width in (1024, 1180, 1181, 1259, 1260, 1279, 1280, 1440):
            set_browse_viewport(driver, browser, width, 900)
            fit = driver.execute_script("""
                const input = document.getElementById('globalSearchInput');
                const style = getComputedStyle(input);
                const probe = document.createElement('span');
                probe.textContent = input.placeholder;
                probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
                document.body.appendChild(probe);
                const need = probe.getBoundingClientRect().width;
                probe.remove();
                return {need: Math.ceil(need), room: Math.floor(input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))};
            """)
            assert fit["need"] <= fit["room"], f"At {width}px the search placeholder fits: {fit}"
        results["search-placeholder"] = True
        # Round 17: every column header sorts, like a spreadsheet: a first click its natural way (names A to Z, values
        # high to low, Review result accepted first), a second click the other way; aria-sort and the arrow sit on the
        # sorted column only, the address names every order but the default, and the Sort menu shows only on phones.
        set_browse_viewport(driver, browser, 1280, 900)
        open_page()
        wait.until(lambda d: not d.find_element(By.ID, "sortSelect").get_attribute("disabled"))

        def header_state():
            return driver.execute_script("""
                return {sorted: [...document.querySelectorAll('#recordTableWrap thead th[aria-sort]')]
                          .map(th => [th.className.split(' ')[0], th.getAttribute('aria-sort')]),
                        buttons: document.querySelectorAll('#recordTableWrap thead th.sortable > .sort-button').length,
                        menu: getComputedStyle(document.querySelector('.sort-control')).display,
                        arrow: [...document.querySelectorAll('#recordTableWrap thead .sort-icon')]
                          .filter(icon => getComputedStyle(icon).visibility === 'visible').length,
                        hash: location.hash};
            """)

        def click_header(cell, sort):
            button = driver.find_element(By.CSS_SELECTOR, f"#recordTableWrap thead th.{cell} > .sort-button")
            driver.execute_script("arguments[0].scrollIntoView({block: 'center', inline: 'center'})", button)
            # Away from the headers first, so no hover arrow is left on another heading.
            ActionChains(driver).move_to_element(driver.find_element(By.ID, "pageLabel")).perform()
            button.click()
            wait.until(lambda d: header_state()["hash"] in ((f"#browse?sort={sort}",) if sort else ("", "#browse"))
                       and not d.find_elements(By.CSS_SELECTOR, "#recordsBody tr.skeleton-row"))
            ActionChains(driver).move_to_element(driver.find_element(By.ID, "pageLabel")).perform()
            return header_state()

        start = header_state()
        assert (start["buttons"] == 8 and start["sorted"] == [["c-status", "ascending"]] and start["menu"] == "none"
                and start["arrow"] == 1), f"Every header sorts, Review result is the default order: {start}"
        walk = [("c-enzyme", "enzyme", "ascending"), ("c-enzyme", "enzyme_desc", "descending"),
                ("c-km", "km", "descending"), ("c-km", "km_asc", "ascending"),
                ("c-status", "", "ascending"), ("c-status", "evidence_desc", "descending")]
        for cell, sort, direction in walk:
            now = click_header(cell, sort)
            assert now["sorted"] == [[cell, direction]] and now["arrow"] == 1, f"{cell} sorts {sort or 'the default way'}: {now}"
        statuses = [text.strip() for text in driver.execute_script(
            "return [...document.querySelectorAll('#recordsBody tr[data-key] .c-status .state-label')].map(e => e.textContent)")]
        assert statuses and all(text == "Not checked" for text in statuses), f"Review result reversed puts Not checked first: {statuses[:5]}"
        enzymes = [text.strip() for text in driver.execute_script(
            "return [...document.querySelectorAll('#recordsBody tr[data-key] .c-enzyme strong')].map(e => e.textContent)")]
        # The keyboard: a header is a button (Enter sorts).
        organism = driver.find_element(By.CSS_SELECTOR, "#recordTableWrap thead th.c-organism > .sort-button")
        driver.execute_script("arguments[0].focus()", organism)
        organism.send_keys(Keys.ENTER)
        wait.until(lambda d: header_state()["hash"] == "#browse?sort=organism")
        results["header-sort"] = {"steps": len(walk) + 1, "first_enzymes": enzymes[:2]}
        # The license and how to cite, said once: one quiet line in the footer bar between Records per page and the page
        # range, linking to the Guide's Licence and citation; not shown where the bar has no room for it (phones, a table
        # beside an open record at 1024px).
        footer = driver.execute_script("""
            const note = document.querySelector('.pagination .table-licence');
            const r = (e) => e.getBoundingClientRect();
            return {text: note.innerText.replace(/\\s+/g, ' ').trim(), href: note.querySelector('a')?.getAttribute('href'),
                    shown: getComputedStyle(note).display !== 'none',
                    between: r(document.getElementById('pageSizeSelect')).right < r(note).left
                      && r(note).right < r(document.getElementById('pageLabel')).left,
                    whole: note.scrollWidth <= note.clientWidth + 1, bar: Math.round(r(document.querySelector('.pagination')).height)};
        """)
        assert (footer["shown"] and footer["text"] == "CC BY 4.0 · How to cite" and footer["href"] == "#guide-licence"
                and footer["between"] and footer["whole"] and footer["bar"] == 48), f"The footer's license line: {footer}"
        results["footer-license"] = True
        # 1280: the sidebar is 256px; a record takes its place (the rail) and closing it brings it back.
        set_browse_viewport(driver, browser, 1280, 900)
        open_page()
        assert is_open() and box(".filter-column")["width"] == 256, box(".filter-column")
        driver.find_element(By.CSS_SELECTOR, "#recordsBody tr[data-key] .primary-cell").click()
        wait.until(lambda d: detail_open() and not is_open())
        assert box(".filter-column")["width"] == 48 and box("#detailPanel")["width"] == 440, (box(".filter-column"), box("#detailPanel"))
        ok, boxes = side_by_side(".filter-column", ".table-panel", "#detailPanel")
        assert ok, f"Rail, table and record sit side by side: {boxes}"
        assert driver.find_element(By.ID, "detailPanel").get_attribute("role") is None, "From 1024px the record is a column"
        # A screen 900px tall or less keeps only the record's name and × in view as it scrolls; the status line scrolls away.
        stuck = record_header_scrolled()
        if stuck["scrolled"] >= 300:
            assert abs(stuck["titleTop"]) <= 1 and stuck["closeShown"] and not stuck["statusShown"], stuck
            assert stuck["share"] < 0.25, f"The record's name in view takes {stuck['share']:.0%} of the record at 1280x900"
        driver.save_screenshot(str(OUTPUT / f"{browser}-{route_label}-layout-1280-record.png"))
        ActionChains(driver).send_keys(Keys.ESCAPE).perform()
        wait.until(lambda d: not detail_open() and is_open())
        assert box(".filter-column")["width"] == 256
        results["record-1280"] = True
        # With two filters on and a record open at 1280, the chips share the toolbar's one row while they fit beside
        # Export and Sort (48px, Clear all last); a wider font puts them, with Clear all, on the full width under it.
        # Never a chip cut, over the toolbar or Clear all alone on a line.
        open_page("#browse?source=databases&checked=1")
        wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, "#activeFilters .filter-chip")) == 2)
        driver.find_element(By.CSS_SELECTOR, "#recordsBody tr[data-key] .primary-cell").click()
        wait.until(lambda d: detail_open())
        toolbar = driver.execute_script("""
            const rect = e => e.getBoundingClientRect();
            const tools = rect(document.querySelector('.records-tools'));
            const chips = [...document.querySelectorAll('#activeFilters .filter-chip')];
            const clear = rect(document.querySelector('#activeFilters .filter-chips-clear'));
            const last = rect(chips[chips.length - 1]);
            const mid = r => (r.top + r.bottom) / 2;
            return {header: Math.round(rect(document.querySelector('.records-header')).height),
                    beside: chips.every(chip => rect(chip).right <= tools.left + 1 && Math.abs(mid(rect(chip)) - mid(tools)) <= 2),
                    under: chips.every(chip => rect(chip).top >= tools.bottom - 1),
                    cut: chips.filter(chip => { const label = chip.querySelector('span'); return label.scrollWidth > label.clientWidth + 1; }).length,
                    clearWithLast: Math.abs(mid(clear) - mid(last)) <= 2 && clear.left >= last.right};
        """)
        assert not toolbar["cut"] and toolbar["clearWithLast"] and (
            (toolbar["beside"] and toolbar["header"] <= 49) or toolbar["under"]), f"Chips beside an open record at 1280: {toolbar}"
        ActionChains(driver).send_keys(Keys.ESCAPE).perform()
        wait.until(lambda d: not detail_open())
        results["chips-record-1280"] = True
        # Beside the open sidebar from 1280px Review result stays in view without sideways scrolling, in the filtered views
        # whose wide tags and values once pushed it out (database sources, Not confirmed, a caution): the names give way,
        # then the tags (ending in an ellipsis), never the review result's word. Only the arrow may scroll out of view.
        fit_views = ("#browse?status=curation_pending", "#browse?source=brenda", "#browse?source=sabio_rk",
                     "#browse?source=uniprot", "#browse?caution=units")
        for width in (1280, 1366, 1440):
            set_browse_viewport(driver, browser, width, 900)
            for view in fit_views:
                open_page(view)
                wait.until(lambda d: is_open())
                fit = driver.execute_script("""
                    const wrap = document.getElementById('recordTableWrap');
                    const view = wrap.getBoundingClientRect();
                    const status = wrap.querySelector('thead th.c-status').getBoundingClientRect();
                    const words = [...wrap.querySelectorAll('#recordsBody .state-label')]
                        .filter(word => word.getBoundingClientRect().right > word.closest('td').getBoundingClientRect().right + 1);
                    return {statusRight: status.right, viewRight: view.left + wrap.clientWidth, overflow: wrap.scrollWidth - wrap.clientWidth,
                            sidebar: document.querySelector('.filter-column').getBoundingClientRect().width,
                            cutWords: words.length, scrollLeft: wrap.scrollLeft};
                """)
                assert fit["scrollLeft"] == 0 and fit["statusRight"] <= fit["viewRight"] + 1 and fit["cutWords"] == 0, (
                    f"At {width}px {view} keeps Review result in view beside the sidebar: {fit}")
                assert fit["overflow"] <= 28, f"At {width}px {view} scrolls sideways by more than the arrow: {fit}"
                assert fit["sidebar"] == (256 if width < 1440 else 288), fit
        results["status-in-view-1280-1440"] = True
        # In the 256px sidebar no label runs into its count, in a wide font (Verdana) too: "✓ human-checked" breaks after
        # its hyphen rather than touch its count (it once read "✓human-checked1,543"). The caution chip stays on for the
        # Clear all check below.
        set_browse_viewport(driver, browser, 1280, 900)
        open_page("#browse?caution=units")
        wait.until(lambda d: is_open() and d.execute_script(
            "return !!document.querySelector('#statusChecklist [data-count=\"checked\"]')?.textContent.trim()"))
        tight = driver.execute_script("""
            const style = document.createElement('style');
            style.textContent = '* { font-family: Verdana, sans-serif !important; letter-spacing: 0.5px !important }';
            document.head.appendChild(style);
            // every group opened (More filters' too), then put back as it was
            const groups = [...document.querySelectorAll('#catalogFilters details')];
            const was = groups.map(group => group.open);
            groups.forEach(group => { group.open = true; });
            const out = [];
            let rows = 0;
            for (const row of document.querySelectorAll('#catalogFilters .check-row')) {
              const count = row.querySelector(':scope > strong'), label = row.querySelector(':scope > span');
              if (!count || !label || !row.getClientRects().length || !count.textContent.trim()) continue;
              rows += 1;
              const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
              let right = label.getBoundingClientRect().left;
              while (walker.nextNode()) {
                if (walker.currentNode.parentElement.closest('.visually-hidden')) continue;
                const range = document.createRange();
                range.selectNodeContents(walker.currentNode);
                for (const box of range.getClientRects()) right = Math.max(right, box.right);
              }
              const gap = count.getBoundingClientRect().left - right;
              if (gap < 4) out.push([label.textContent.trim(), Math.round(gap * 10) / 10]);
            }
            // A group's title stops before its "?" and chevron (it wraps rather than run under them).
            const covered = [];
            document.querySelectorAll('#catalogFilters :is(.filter-section, .filter-more) > summary').forEach(summary => {
              if (!summary.getClientRects().length) return;
              const marks = [summary.querySelector('.chevron'), summary.parentElement.querySelector(':scope > .section-about')]
                .filter(e => e && e.getClientRects().length).map(e => e.getBoundingClientRect());
              const range = document.createRange();
              range.selectNodeContents(summary.querySelector(':scope > span'));
              const runs = [...range.getClientRects()].filter(r => r.width > 0.5);
              if (runs.some(r => marks.some(m => r.right > m.left - 0.5 && r.left < m.right && r.top < m.bottom && m.top < r.bottom)))
                covered.push(summary.textContent.replace(/\\s+/g, ' ').trim());
            });
            const word = document.querySelector('#statusChecklist .human-checked-word').getBoundingClientRect();
            style.remove();
            groups.forEach((group, index) => { group.open = was[index]; });
            return {rows, tight: out, covered, humanChecked: word.width > 20};
        """)
        assert not tight["covered"], f"At 1280px in a wide font a group's title runs under its '?' or chevron: {tight['covered']}"
        assert tight["rows"] >= 8 and tight["humanChecked"] and not tight["tight"], (
            f"At 1280px in a wide font every sidebar label stays clear of its count: {tight}")
        results["sidebar-labels-wide-font-1280"] = True
        # Clear all, beside the chips and in the sidebar's heading, is a target at least 24px tall.
        targets = driver.execute_script("""
            return ['.filter-chips-clear', '#clearButton'].map(selector => document.querySelector(selector).getBoundingClientRect().height);
        """)
        assert min(targets) >= 24, f"Clear all is at least 24px tall: {targets}"
        # The human-review marks widen Status with the human-checked tag after the rows are drawn: a table that then
        # scrolls sideways shows it at once (scroll buttons, sticky Enzyme column, edge cue), before any scroll.
        manifest = driver.execute_script("return window.CATLOG_STATIC_MANIFEST")
        if isinstance(((manifest.get("summary") or {}).get("overview") or {}).get("human_checked_accepted"), int):
            open_page("#browse?checked=1")
            wait.until(lambda d: all(
                row.find_elements(By.CSS_SELECTOR, ".state-tag.human-checked")
                for row in d.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")))
            cues = driver.execute_script("""
                const wrap = document.getElementById('recordTableWrap');
                const enzyme = wrap.querySelector('#recordsBody td.c-enzyme');
                return {overflow: wrap.scrollWidth > wrap.clientWidth + 2, scrollLeft: wrap.scrollLeft,
                        right: wrap.classList.contains('can-scroll-right'),
                        controls: !document.querySelector('.table-scroll-controls').classList.contains('hidden'),
                        sticky: getComputedStyle(enzyme).position === 'sticky'};
            """)
            assert cues["scrollLeft"] == 0 and cues["overflow"] == cues["right"] == cues["controls"] == cues["sticky"], (
                f"The scroll cues follow the table's width once the marks are in: {cues}")
            results["scroll-cues-1280"] = True
            # A table short of room shows human-checked as a green check right after the review result ("Accepted ✓", named
            # "human-checked") and gives its tag's room to the names; a table with room shows the tag whole. Either way the
            # mark is in view, never cut by the tag line's "…" nor hidden beside an open record. 1024 beside the open
            # sidebar is short of room.
            def checked_tags():
                return driver.execute_script("""
                    const table = document.querySelector('#recordTableWrap table');
                    const shown = (element) => !!element && element.getBoundingClientRect().width > 0;
                    return {compact: table.classList.contains('status-compact'),
                            tags: [...document.querySelectorAll('#recordsBody .state-badge')].filter(badge =>
                                badge.querySelector('.state-tag.human-checked')).map(badge => {
                                const cell = badge.closest('td').getBoundingClientRect();
                                const tag = badge.querySelector('.state-tag.human-checked');
                                const up = badge.querySelector('.state-label .state-check');
                                const icon = [tag, up].filter(shown).map(mark => mark.querySelector('svg.check-icon').getBoundingClientRect());
                                return {marks: icon.length, icon: icon.length === 1 && icon[0].width >= 8 && icon[0].right <= cell.right + 1,
                                        up: shown(up), word: shown(tag) ? Math.round(tag.getBoundingClientRect().width) : 0,
                                        wordIn: !shown(tag) || tag.getBoundingClientRect().right <= cell.right + 1,
                                        named: up && up.getAttribute('aria-label') === 'human-checked'
                                            && /human-checked/.test(badge.getAttribute('aria-label'))};
                            })};
                """)
            tags = checked_tags()
            assert tags["tags"] and all(tag["icon"] and tag["named"] for tag in tags["tags"]), tags
            if not tags["compact"]:
                assert all(not tag["up"] and tag["word"] > 20 and tag["wordIn"] for tag in tags["tags"]), (
                    f"With room human-checked shows whole: {tags}")
            set_browse_viewport(driver, browser, 1024, 900)
            open_page("#browse?checked=1")
            if not is_open():
                driver.find_element(By.ID, "filterRailButton").click()
                wait.until(lambda d: is_open())
            wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, "#recordsBody .state-tag.human-checked"))
            tags = checked_tags()
            assert tags["compact"] and tags["tags"] and all(
                tag["icon"] and tag["named"] and tag["up"] and not tag["word"] for tag in tags["tags"]), (
                f"At 1024px beside the sidebar human-checked is a check after the review result: {tags}")
            # Beside an open record the tag line keeps only the source; human-checked stays as the check after Accepted.
            driver.find_element(By.CSS_SELECTOR, "#recordsBody tr[data-key] .primary-cell").click()  # (Safari cannot click a whole row)
            wait.until(lambda d: d.execute_script("return document.body.classList.contains('detail-open')"))
            tags = checked_tags()
            assert tags["tags"] and all(tag["icon"] and tag["up"] and not tag["word"] for tag in tags["tags"]), (
                f"Beside an open record human-checked is a check after the review result: {tags}")
            driver.find_element(By.ID, "closeDetailButton").click()
            wait.until(lambda d: not d.execute_script("return document.body.classList.contains('detail-open')"))
            results["human-checked-compact"] = True
            set_browse_viewport(driver, browser, 1280, 900)
        # 1024 with the sidebar collapsed: the table fits until a record opens beside it; then it scrolls sideways, and the
        # Columns control and the right edge cue say so at once (not only after the window is resized).
        set_browse_viewport(driver, browser, 1024, 900)
        driver.execute_script("try { localStorage.setItem('catlog.filtersCollapsed', '1'); } catch (e) {}")
        open_page()
        if is_open():
            driver.find_element(By.ID, "collapseFiltersButton").click()
            wait.until(lambda d: not is_open())
        driver.find_element(By.CSS_SELECTOR, "#recordsBody tr[data-key] .primary-cell").click()
        wait.until(lambda d: detail_open())
        table_scroll = driver.execute_script("""
            const wrap = document.getElementById('recordTableWrap');
            return {overflow: wrap.scrollWidth > wrap.clientWidth + 2, scrollWidth: wrap.scrollWidth, clientWidth: wrap.clientWidth,
                    controls: !document.querySelector('.table-scroll-controls').classList.contains('hidden'),
                    cue: wrap.classList.contains('can-scroll-right')};
        """)
        assert table_scroll["overflow"] == table_scroll["controls"] == table_scroll["cue"] == True, table_scroll
        # The right edge's shadow is drawn inside the visible area, ending where the rows end (before the vertical
        # scrollbar), over the rows and not under them.
        cue = driver.execute_script("""
            const wrap = document.getElementById('recordTableWrap');
            const panel = wrap.parentElement;
            const after = getComputedStyle(panel, '::after');
            const outer = panel.getBoundingClientRect();
            const box = wrap.getBoundingClientRect();
            return {shown: after.visibility === 'visible', cueRight: outer.right - parseFloat(after.right),
                    viewRight: box.left + wrap.clientLeft + wrap.clientWidth, cueTop: outer.top + parseFloat(after.top),
                    viewTop: box.top + wrap.clientTop, width: parseFloat(after.width), z: after.zIndex};
        """)
        assert cue["shown"] and abs(cue["cueRight"] - cue["viewRight"]) <= 1 and abs(cue["cueTop"] - cue["viewTop"]) <= 1, cue
        # The table scrolls anyway, so the sticky Enzyme column narrows to its 136px minimum or its longest word.
        enzyme = driver.execute_script("""
            const names = [...document.querySelectorAll('#recordsBody tr[data-key] td.c-enzyme strong')];
            const font = getComputedStyle(names[0]);
            const context = document.createElement('canvas').getContext('2d');
            context.font = `${font.fontStyle} ${font.fontWeight} ${font.fontSize} ${font.fontFamily}`;
            const word = Math.max(...names.flatMap(name => name.textContent.split(/\\s+|(?<=[-,/])/)).map(part => context.measureText(part).width));
            const cell = getComputedStyle(document.querySelector('#recordsBody td.c-enzyme'));
            const padding = parseFloat(cell.paddingLeft) + parseFloat(cell.paddingRight) + 2;
            return {width: document.querySelector('#recordTableWrap thead th.c-enzyme').getBoundingClientRect().width,
                    limit: Math.max(136, Math.ceil(word + padding))};
        """)
        assert enzyme["width"] <= enzyme["limit"] + 1, enzyme
        # › steps one column: the next column's left edge meets the sticky Enzyme column (stops measured in the table's
        # own coordinates, not the page's with the rail before it).
        driver.find_element(By.ID, "scrollTableRightButton").click()
        step = {}
        def stepped(d):
            step.update(d.execute_script("""
                const wrap = document.getElementById('recordTableWrap');
                const left = wrap.getBoundingClientRect().left;
                const headers = [...wrap.querySelectorAll('thead th')].filter(th => th.getClientRects().length);
                const sticky = headers[0].getBoundingClientRect().right - left;
                return {scrollLeft: wrap.scrollLeft, sticky, end: wrap.scrollWidth - wrap.clientWidth,
                        edges: headers.slice(1).map(th => Math.round(th.getBoundingClientRect().left - left))};
            """))
            settled = step["scrollLeft"] > 0 and step["scrollLeft"] == step.get("previous")
            step["previous"] = step["scrollLeft"]
            return settled
        WebDriverWait(driver, 10, poll_frequency=0.25).until(stepped)
        assert (any(abs(edge - step["sticky"]) <= 1 for edge in step["edges"])
                or step["scrollLeft"] >= step["end"] - 1), f"› stops at a column's edge (or the table's end): {step}"
        ActionChains(driver).send_keys(Keys.ESCAPE).perform()
        wait.until(lambda d: not detail_open())
        driver.execute_script("try { localStorage.removeItem('catlog.filtersCollapsed'); } catch (e) {}")
        results["record-1024"] = True
        # 1024: the header is still one 56px line (the short links out, no tagline), on Browse and on Team.
        set_browse_viewport(driver, browser, 1024, 768)
        open_page()
        assert box(".app-header")["height"] == 56, f"At 1024px the header is one line: {box('.app-header')}"
        assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth + 1")
        # Review result is as wide as its heading too, whatever the system font.
        heading = driver.execute_script("""
            const th = document.querySelector('#recordTableWrap thead th.c-status');
            const range = document.createRange(); range.selectNodeContents(th);
            const style = getComputedStyle(th);
            return {text: range.getBoundingClientRect().width, room: th.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)};
        """)
        assert heading["text"] <= heading["room"] + 1, f"At 1024px the Review result heading is cut: {heading}"
        driver.execute_script("location.hash = '#team'")
        wait.until(lambda d: d.execute_script("return document.body.classList.contains('team-open')"))
        assert box(".app-header")["height"] == 56, f"At 1024px the Team header is one line: {box('.app-header')}"
        results["header-1024"] = True
        # 1700: sidebar, table and record side by side (Safari only where the screen is that wide).
        if browser == "chrome" or driver.execute_script("return screen.availWidth") >= 1720:
            set_browse_viewport(driver, browser, 1700, 1000)
            open_page()
            driver.find_element(By.CSS_SELECTOR, "#recordsBody tr[data-key] .primary-cell").click()
            wait.until(lambda d: detail_open())
            assert is_open() and box(".filter-column")["width"] == 288 and box("#detailPanel")["width"] == 480
            ok, boxes = side_by_side(".filter-column", ".table-panel", "#detailPanel")
            assert ok, f"Sidebar, table and record sit side by side: {boxes}"
            assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth + 1")
            # Taller than 900px, the whole header stays in view, status line included.
            stuck = record_header_scrolled()
            if stuck["scrolled"] >= 300:
                assert stuck["closeShown"] and stuck["statusShown"], stuck
            driver.save_screenshot(str(OUTPUT / f"{browser}-{route_label}-layout-1700-record.png"))
            # Narrowed below 1600px the record takes the sidebar's place; widened again, the sidebar comes back beside it.
            set_browse_viewport(driver, browser, 1280, 1000)
            wait.until(lambda d: not is_open() and box(".filter-column")["width"] == 48 and detail_open())
            set_browse_viewport(driver, browser, 1700, 1000)
            wait.until(lambda d: is_open() and box(".filter-column")["width"] == 288 and detail_open())
            ActionChains(driver).send_keys(Keys.ESCAPE).perform()
            wait.until(lambda d: not detail_open())
            results["record-1700"] = True
        # 1100: the table's columns do not fit beside the sidebar, so it starts as the rail and the table fits; a viewer
        # who opens it keeps it open, and collapsing it again goes back to the default.
        set_browse_viewport(driver, browser, 1100, 900)
        driver.execute_script("try { localStorage.removeItem('catlog.filtersCollapsed'); } catch (e) {}")
        open_page()
        assert not is_open() and box(".filter-column")["width"] == 48, box(".filter-column")
        assert driver.execute_script("""
            const wrap = document.getElementById('recordTableWrap');
            return wrap.scrollWidth <= wrap.clientWidth + 24;
        """), "Beside the rail at 1100px the first page fits (within Safari's measuring differences)"
        driver.find_element(By.ID, "filterRailButton").click()
        wait.until(lambda d: is_open() and box(".filter-column")["width"] == 256)
        assert stored() in ("0", "unavailable")
        # Nothing matches beside the open sidebar: Enzyme's heading keeps its room, clear of EC's (the stylesheet's widths
        # had left it 0px wide), and the active filters, too long to sit beside the toolbar, take the full width under it,
        # none cut, each chip's tooltip naming its whole filter.
        driver.execute_script("location.hash = arguments[0]", "#browse?ec=9.9.9.9&source=paper&organism=Escherichia%20coli")
        wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, "#recordsBody .empty-notice")
                   and len(d.find_elements(By.CSS_SELECTOR, "#activeFilters .filter-chip")) == 3)
        empty = driver.execute_script("""
            const text = (th) => { const range = document.createRange(); range.selectNodeContents(th); return range.getBoundingClientRect(); };
            const enzyme = document.querySelector('#recordTableWrap thead th.c-enzyme');
            const ec = document.querySelector('#recordTableWrap thead th.c-ec');
            const wrap = document.getElementById('recordTableWrap');
            const chips = [...document.querySelectorAll('#activeFilters .filter-chip')];
            const tools = document.querySelector('.records-tools').getBoundingClientRect();
            return {enzyme: enzyme.getBoundingClientRect().width, enzymeText: text(enzyme).right, ecText: text(ec).left,
                    scrollWidth: wrap.scrollWidth, clientWidth: wrap.clientWidth,
                    cut: chips.filter(chip => { const label = chip.querySelector('span'); return label.scrollWidth > label.clientWidth + 1; }).map(chip => chip.innerText),
                    titles: chips.map(chip => chip.title), named: chips.every(chip => chip.title === chip.getAttribute('aria-label') && chip.title.startsWith('Remove filter: ')),
                    under: chips.every(chip => chip.getBoundingClientRect().top >= tools.bottom - 1)};
        """)
        assert empty["enzyme"] >= 60 and empty["enzymeText"] <= empty["ecText"], f"With nothing to show, Enzyme's heading keeps its room: {empty}"
        assert empty["scrollWidth"] <= empty["clientWidth"] + 24, f"With nothing to show, the table fits beside the sidebar: {empty}"
        assert not empty["cut"] and empty["named"] and empty["under"], f"The chips take the full width under the toolbar: {empty}"
        results["empty-table-1100"] = True
        open_page()
        if stored() == "0":
            assert is_open(), "A sidebar opened below 1200px stays open on reload"
            driver.find_element(By.ID, "collapseFiltersButton").click()
            wait.until(lambda d: not is_open())
            assert stored() is None, "Collapsing it again below 1200px goes back to the default"
        results["laptop-1100"] = True
        # From 1024px up the counts band is one even row that never wraps or moves as the window widens: the key numbers,
        # then the parameters behind one thin rule, their labels, numbers and lines of context each on one line across the
        # card (within 1px), no wide empty stretch at its end, and the date at the right end of the line above, all inside
        # the card; on tablets (641-1023px) two rows, the parameters and the date (the card's copy) under the key numbers,
        # with no rule. Each range keeps one height; Read from the paper keeps its whole label (a phone under 360px takes
        # From paper).
        band_heights = {"row": set(), "tablet": set()}
        for width in (1700, 1280, 1180, 1024, 1023, 800, 744, 641):
            set_browse_viewport(driver, browser, width, 900)
            band = driver.execute_script("""
                const rect = selector => document.querySelector(selector).getBoundingClientRect();
                const top = selector => Math.round(rect(selector).top);
                const card = rect('.snapshot-overview');
                const inside = [...document.querySelectorAll('.snapshot-overview > *, .summary-grid > *')].filter(e => e.getClientRects().length)
                    .every(e => { const r = e.getBoundingClientRect(); return r.left >= card.left - 0.5 && r.right <= card.right + 0.5 && r.bottom <= card.bottom + 0.5; });
                const cells = ['.summary-records', '.summary-accepted', '#fromPaperLink', '#humanCheckedLink', '#snapshotMeta']
                    .map(selector => document.querySelector(selector)).filter(e => e.getClientRects().length);
                const lines = part => { const tops = cells.map(e => [...e.querySelectorAll(part)].filter(c => c.getClientRects().length)
                    .map(c => c.getBoundingClientRect().top)).flat(); return tops.length ? Math.max(...tops) - Math.min(...tops) : -1; };
                const date = [...document.querySelectorAll('#snapshotDate, #snapshotDateCard')].find(e => e.getClientRects().length);
                const dateBox = date ? date.getBoundingClientRect() : {top: -999, right: -999, bottom: -999};
                return {height: Math.round(rect('.snapshot-band').height),
                        records: top('.summary-card'), checked: top('#humanCheckedLink'), meta: top('#snapshotMeta'), metaRight: Math.round(rect('#snapshotMeta').right),
                        date: Math.round(dateBox.top), dateId: date ? date.id : null, lead: top('.snapshot-lead'), dateRight: Math.round(dateBox.right),
                        dateBottom: Math.round(dateBox.bottom), cardTop: Math.round(card.top), cardBottom: Math.round(card.bottom), inside,
                        cardRight: Math.round(card.right), cardWidth: Math.round(card.width),
                        labels: lines(':scope > span, .snapshot-line > span'), notes: lines(':scope > .snapshot-note'),
                        divider: getComputedStyle(document.getElementById('snapshotMeta')).borderLeftWidth};
            """)
            assert band["inside"], f"At {width}px everything in the counts band stays inside its card: {band}"
            if width >= 1024:
                assert (abs(band["checked"] - band["records"]) <= 1 and abs(band["meta"] - band["records"]) <= 1
                        and band["dateId"] == "snapshotDate" and abs(band["date"] - band["lead"]) <= 1
                        and abs(band["dateRight"] - band["cardRight"]) <= 1 and 0 <= band["labels"] <= 1 and 0 <= band["notes"] <= 1
                        and band["cardRight"] - band["metaRight"] <= band["cardWidth"] * 0.1 and band["divider"] == "1px"), (
                    f"At {width}px the counts band is one row: {band}")
                band_heights["row"].add(band["height"])
            else:
                assert (abs(band["checked"] - band["records"]) <= 1 and band["meta"] > band["records"] + 24
                        and band["dateId"] == "snapshotDateCard" and abs(band["date"] - band["meta"]) < 6
                        and band["dateRight"] <= band["cardRight"] and band["dateBottom"] <= band["cardBottom"]
                        and band["divider"] == "0px"), (
                    f"At {width}px the counts band takes two rows, the date in the card: {band}")
                band_heights["tablet"].add(band["height"])
            shown = driver.execute_script("""const link = document.getElementById('fromPaperLink');
                return [...link.querySelectorAll('.snapshot-paper-long, .snapshot-paper-short')]
                    .filter(e => e.getBoundingClientRect().width > 1).map(e => e.textContent)""")
            if driver.find_element(By.ID, "fromPaperLink").is_displayed():
                assert shown == ["Read from the paper"], (width, shown)
        assert all(len(heights) == 1 for heights in band_heights.values()), f"Each layout of the counts band keeps one height: {band_heights}"
        # A filter never moves the band's columns (round 15): each count keeps a seven-character room, so the rule before
        # the parameters stays put within 1px, every number keeps a width inside its own cell, and the lines of context
        # follow the results (#browse?source=paper: all of them read from the paper, so its line gives only the papers).
        for width in (1440, 1024):
            set_browse_viewport(driver, browser, width, 900)
            spots = {}
            for address in ("", "#browse?source=paper"):
                open_page(address)
                if address:
                    wait.until(lambda d: d.execute_script(
                        "return document.querySelector('.summary-records > span')?.textContent.trim() === 'Matching records'"
                        " && /\\d/.test(document.getElementById('fromPaperNote')?.textContent || '')"))
                spots[address] = driver.execute_script(BAND_SPOTS_JS)
            plain, filtered = spots[""], spots["#browse?source=paper"]
            assert (abs(plain["rule"] - filtered["rule"]) <= 1 and all(spot["numbers"] for spot in spots.values())
                    and re.fullmatch(r"[\d,]+ papers?", filtered["paperNote"]) and filtered["acceptedNote"].endswith("of records")), (
                f"At {width}px a filter leaves the band's columns in place: {spots}")
        # A short window wider than a phone keeps the table's 340px: the line over the card gives way, and the snapshot
        # date (the card's copy, its title the Data ID) ends the parameters' line inside the card; from 1100px after
        # "records with each parameter", below that alone (a wide font has no room for both at 1024px).
        for width, height in ((1280, 600), (1024, 600), (800, 600)):
            set_browse_viewport(driver, browser, width, height)
            open_page()
            short = driver.execute_script("""
                const shown = e => Boolean(e && e.getClientRects().length);
                const card = document.querySelector('.snapshot-overview').getBoundingClientRect();
                const date = document.getElementById('snapshotDateCard'), r = date ? date.getBoundingClientRect() : null;
                return {lead: shown(document.querySelector('.snapshot-lead')), date: shown(date), title: date ? date.title : '',
                        inside: Boolean(r) && r.left >= card.left - 0.5 && r.right <= card.right + 0.5 && r.top >= card.top && r.bottom <= card.bottom + 0.5,
                        caption: (document.querySelector('#snapshotMeta > .snapshot-note')?.innerText || '').trim(),
                        workbench: Math.round(document.querySelector('.workbench').getBoundingClientRect().height),
                        scroll: document.documentElement.scrollWidth > innerWidth + 1};
            """)
            assert (not short["lead"] and short["date"] and short["inside"] and re.fullmatch(r"Data ID [0-9a-f]{10}", short["title"] or "")
                    and short["workbench"] >= 340 and not short["scroll"]
                    and (short["caption"].startswith("records with each parameter") if width >= 1100 else short["caption"].startswith("Snapshot "))), (
                f"At {width}x{height} the snapshot date stays in view in the card: {short}")
        # The band's key numbers have no glow (no text-shadow), each in its own colour; a linked count's hover tint is drawn
        # around it, so it never moves the line.
        glow = driver.execute_script("""
            const shadow = selector => getComputedStyle(document.querySelector(selector)).textShadow;
            const font = selector => { const style = getComputedStyle(document.querySelector(selector));
              return {size: parseFloat(style.fontSize), weight: Number(style.fontWeight), color: style.color}; };
            return {records: shadow('.summary-card strong'), checked: shadow('#humanCheckedLink > strong'),
                    tint: getComputedStyle(document.getElementById('humanCheckedLink'), '::before').position,
                    key: font('.summary-card strong'), with: font('#snapshotMeta .snapshot-line strong'), withShadow: shadow('#snapshotMeta .snapshot-line strong')};
        """)
        assert glow["records"] in ("", "none") and glow["checked"] in ("", "none") and glow["tint"] == "absolute", glow
        # The With counts are secondary: smaller and lighter, so the key numbers lead the band.
        assert (glow["with"]["size"] < glow["key"]["size"] and glow["with"]["weight"] < glow["key"]["weight"]
                and glow["withShadow"] in ("", "none")), glow
        results["band-rows"] = True
        # Tablets: the rail; the record is a dialog.
        set_browse_viewport(driver, browser, 800, 1000)
        open_page()
        assert not is_open() and box(".filter-column")["width"] == 48
        driver.find_element(By.ID, "filterRailButton").click()
        wait.until(lambda d: is_open() and box(".filter-column")["width"] == 256)
        ok, boxes = side_by_side(".filter-column", ".table-panel")
        assert ok and driver.execute_script("return document.documentElement.scrollWidth <= innerWidth + 1"), boxes
        driver.find_element(By.CSS_SELECTOR, "#recordsBody tr[data-key] .primary-cell").click()
        wait.until(lambda d: detail_open())
        assert driver.find_element(By.ID, "detailPanel").get_attribute("role") == "dialog"
        ActionChains(driver).send_keys(Keys.ESCAPE).perform()
        wait.until(lambda d: not detail_open())
        results["tablet-800"] = True
        # The smallest phones: Filters (with its count), Export and the Sort menu stay on one row, the menu shows
        # "Review result" whole, and "Sort" is still the menu's name for screen readers.
        if browser == "chrome":
            set_browse_viewport(driver, browser, 320, 800)
            open_page("#browse?metric=kcat")
            toolbar = driver.execute_script("""
                const top = selector => Math.round(document.querySelector(selector).getBoundingClientRect().top);
                const select = document.getElementById('sortSelect');
                const toggle = document.getElementById('sortDirectionButton');
                return {filters: top('#openFiltersButton'), export: top('#exportMenu > summary'), sort: top('#sortSelect'),
                        toggle: top('#sortDirectionButton'), toggleWidth: Math.round(toggle.getBoundingClientRect().width),
                        width: Math.round(select.getBoundingClientRect().width), name: select.getAttribute('aria-label'),
                        toggleName: toggle.getAttribute('aria-label'),
                        scroll: document.documentElement.scrollWidth > innerWidth + 1};
            """)
            tops = [toolbar["filters"], toolbar["export"], toolbar["sort"], toolbar["toggle"]]
            assert (max(tops) - min(tops) <= 2 and toolbar["width"] >= 108 and toolbar["toggleWidth"] >= 20
                    and toolbar["name"] == "Sort by" and toolbar["toggleName"].startswith("Reverse the order")
                    and not toolbar["scroll"]), f"At 320px the toolbar is one row: {toolbar}"
            # The links out never run into the brand (a wide font puts them on two lines instead).
            brand, links = box(".brand-lockup strong"), box(".external-nav")
            assert brand["left"] + brand["width"] <= links["left"] + 1, f"At 320px the links out overlap the brand: {brand} {links}"
            # Phones: the counts band's four key numbers (20px) stand two by two in their card, More at the first row's
            # right; More shows their lines of context and the parameters under them, and closes them again. The snapshot
            # date ends the line over the card from 360px (round 15), shown either way; below 360px that line has no room
            # for it, so it ends the parameters under More. At 320px with a filter ("Matching records") and at 375px
            # nothing leaves the card or the window.
            band_js = """
                const rect = selector => document.querySelector(selector).getBoundingClientRect();
                const card = rect('.snapshot-overview');
                const shown = selector => document.querySelector(selector).getClientRects().length > 0;
                const items = ['.summary-records', '.summary-accepted', '#fromPaperLink', '#humanCheckedLink', '#snapshotMoreButton'].map(rect);
                return {tops: items.map(r => Math.round(r.top)), lefts: items.map(r => Math.round(r.left)),
                        inside: items.every(r => r.left >= card.left - 0.5 && r.right <= card.right + 0.5),
                        size: getComputedStyle(document.querySelector('.summary-records strong')).fontSize,
                        meta: shown('#snapshotMeta'), notes: shown('.summary-records .snapshot-note') && shown('#fromPaperNote'),
                        date: shown('#snapshotDate') && rect('#snapshotDate').right <= card.right + 0.5 && rect('#snapshotDate').bottom <= card.top,
                        cardDate: Boolean(document.getElementById('snapshotDateCard')) && shown('#snapshotDateCard')
                            && rect('#snapshotDateCard').right <= card.right + 0.5 && rect('#snapshotDateCard').bottom <= card.bottom + 0.5,
                        scroll: document.documentElement.scrollWidth > innerWidth + 1};
            """
            for width, address in ((320, "#browse?metric=kcat"), (375, "")):
                if width == 375:
                    set_browse_viewport(driver, browser, 375, 800)
                    open_page(address)
                phone_band = driver.execute_script(band_js)
                tops, lefts = phone_band["tops"], phone_band["lefts"]
                assert (tops[0] == tops[1] and tops[2] == tops[3] and tops[2] > tops[0] + 24 and lefts[0] == lefts[2]
                        and lefts[1] == lefts[3] and lefts[4] > lefts[1] and tops[4] < tops[2] and phone_band["inside"]
                        and phone_band["size"] == "20px" and not phone_band["meta"] and not phone_band["notes"]
                        and phone_band["date"] == (width >= 360) and not phone_band["cardDate"]
                        and not phone_band["scroll"]), f"At {width}px the counts band is two by two: {phone_band}"
                more = driver.find_element(By.ID, "snapshotMoreButton")
                more.click()
                wait.until(lambda d: d.execute_script(band_js)["meta"])
                expanded = driver.execute_script(band_js)
                assert (expanded["date"] == (width >= 360) and expanded["cardDate"] == (width < 360) and expanded["notes"]
                        and expanded["inside"] and more.get_attribute("aria-expanded") == "true"), expanded
                assert not driver.execute_script(band_js)["scroll"], f"At {width}px More keeps the band in the window"
                more.click()
                wait.until(lambda d: not d.execute_script(band_js)["meta"])
            results["phone-band"] = True
            # back to the 320px page the checks below look at
            set_browse_viewport(driver, browser, 320, 800)
            open_page("#browse?metric=kcat")
            # Phone cards at 320px: each value label puts its unit on a second line, so kcat, Km and kcat/Km start on one
            # line, and no value (1.667 × 10⁻⁶ among the lowest lipase Km) runs past its third of the card.
            open_page("#browse?q=lipase&sort=km_asc")
            values = driver.execute_script("""
                return [...document.querySelectorAll('#recordsBody tr[data-key]')].slice(0, 10).map(card => {
                  const cells = ['c-kcat', 'c-km', 'c-eff'].map(name => card.querySelector('td.' + name));
                  const tops = cells.map(cell => Math.round(cell.querySelector('.metric-with-note').getBoundingClientRect().top));
                  const over = cells.map(cell => Math.max(...[...cell.querySelectorAll('.metric-with-note > *')]
                    .map(item => item.getBoundingClientRect().right)) - cell.getBoundingClientRect().right);
                  return {tops, over: Math.round(Math.max(...over))};
                });
            """)
            assert values and all(max(card["tops"]) - min(card["tops"]) <= 2 and card["over"] <= 1 for card in values), (
                f"At 320px a card's three values line up and stay in their cells: {values}")
            # Each value's label is written as the table's headings write it (italic k or K and a subscript), above the value.
            labels = driver.execute_script("""
                const card = document.querySelector('#recordsBody tr[data-key]');
                return ['c-kcat', 'c-km', 'c-eff'].map(name => {
                  const cell = card.querySelector('td.' + name), label = cell.querySelector('.card-label');
                  return {shown: !!label && getComputedStyle(label).display !== 'none', italic: !!label?.querySelector('i'),
                          sub: !!label?.querySelector('sub'), unit: label?.querySelector('.card-label-unit')?.textContent || '',
                          above: !!label && label.getBoundingClientRect().bottom <= cell.querySelector('.metric-with-note').getBoundingClientRect().top + 1};
                });
            """)
            assert all(label["shown"] and label["italic"] and label["sub"] and label["unit"].startswith("(") and label["above"]
                       for label in labels), f"At 320px each card value is labelled with italic k and its subscript: {labels}"
            # Round 15 polish: the values lead the card (16px, 500, larger than the organism line), and an organism that
            # takes two lines beside its substrate puts the substrate on its own line without the "·": no card's substrate
            # opens a line with the dot (long bacterial names at 375px).
            set_browse_viewport(driver, browser, 375, 800)
            open_page("#browse?organism=bacterium&rows=100")
            cards = driver.execute_script("""
                const rows = [...document.querySelectorAll('#recordsBody tr[data-key]')];
                const lines = e => Math.round(e.getBoundingClientRect().height / (parseFloat(getComputedStyle(e).lineHeight) || 17));
                return {count: rows.length, wrapped: rows.filter(row => row.classList.contains('organism-wraps')).length,
                        dangling: rows.filter(row => {
                            const name = row.querySelector('td.c-organism .clamp-2'), substrate = row.querySelector('td.c-substrate .clamp-2');
                            const dot = getComputedStyle(substrate, '::before').content !== 'none';
                            const ownLine = substrate.getBoundingClientRect().top >= name.getBoundingClientRect().bottom - 1;
                            return dot && (ownLine || lines(name) > 1);
                        }).map(row => row.dataset.key),
                        value: (e => [getComputedStyle(e).fontSize, getComputedStyle(e).fontWeight])(rows[0].querySelector('td.c-kcat .metric-with-note')),
                        organism: getComputedStyle(rows[0].querySelector('td.c-organism')).fontSize};
            """)
            assert cards["count"] and cards["wrapped"] and not cards["dangling"], f"At 375px a card's substrate opens a line with '·': {cards}"
            assert cards["value"] == ["16px", "500"] and float(cards["organism"][:-2]) < 16, f"The card's values do not lead it: {cards}"
            set_browse_viewport(driver, browser, 320, 800)
            # A caution's short words beside its "!" ("above diffusion limit · kcat/Km mismatch") wrap inside the value's
            # third of the card, never past it, in the system font at 320px and in a wide font (Verdana) at 375px. (Records
            # not yet re-read: a record read from the paper is also in this group when the paper prints another unit,
            # which its record says, not the table.)
            for width, wide in ((320, False), (375, True)):
                set_browse_viewport(driver, browser, width, 800)
                open_page("#browse?caution=units&source=databases&rows=100")
                flags = driver.execute_script("""
                    if (arguments[0]) {
                      const style = document.createElement('style');
                      style.textContent = '* { font-family: Verdana, sans-serif !important; letter-spacing: 0.5px !important }';
                      document.head.appendChild(style);
                    }
                    const over = [];
                    let words = 0;
                    for (const flag of document.querySelectorAll('#recordsBody .value-flag')) {
                      const text = flag.querySelector('.visually-hidden');
                      const range = document.createRange();
                      range.selectNodeContents(text || flag);
                      const right = Math.max(flag.getBoundingClientRect().right, ...[...range.getClientRects()].map(box => box.right));
                      const cell = flag.closest('td').getBoundingClientRect().right;
                      if (text && text.getBoundingClientRect().width > 2) words += 1;
                      if (right > cell + 1 || right > innerWidth) over.push([flag.closest('tr').dataset.key, text?.textContent, Math.round(right - cell)]);
                    }
                    return {words, over: over.slice(0, 5), scroll: document.documentElement.scrollWidth > innerWidth + 1};
                """, wide)
                assert flags["words"] >= 10 and not flags["over"] and not flags["scroll"], (
                    f"At {width}px{' in a wide font' if wide else ''} every caution's words stay inside their card value: {flags}")
            set_browse_viewport(driver, browser, 320, 800)
            # A card reads name, variant, organism · substrate, then the note under the substrate: a note never parts a
            # variant from its enzyme (the note as the table writes it, under the first variant card's substrate).
            open_page("#browse?variant=variant")
            order = driver.execute_script("""
                const card = [...document.querySelectorAll('#recordsBody tr[data-key]')].find(row => row.querySelector('td.c-form'));
                if (!card) return null;
                const cell = card.querySelector('td.c-substrate');
                if (!cell.querySelector('.condition-note')) {
                  cell.classList.add('has-note');
                  cell.insertAdjacentHTML('beforeend', '<small class="condition-note">+10 mM fructose 1,6-bisphosphate</small>');
                }
                const box = selector => card.querySelector(selector).getBoundingClientRect();
                return {name: box('td.c-enzyme').bottom, form: [box('td.c-form').top, box('td.c-form').bottom],
                        organism: box('td.c-organism').top, substrate: box('td.c-substrate .clamp-2').bottom,
                        note: box('td.c-substrate .condition-note').top};
            """)
            assert order and order["name"] <= order["form"][0] + 1 and order["form"][1] <= order["organism"] + 1 and (
                order["substrate"] <= order["note"] + 1), f"At 320px a card reads name, variant, organism · substrate, note: {order}"
            # With nothing to show, the notice's long "Remove Organism: ... (N records)" button wraps inside the table
            # area (it once ran past the right edge at 320px, its end cut off); the table does not scroll sideways.
            driver.get("about:blank")
            driver.get(base + "#browse?caution=units&organism=" + quote("an organism name that no record in CatLog has"))
            wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, '#recordsBody .empty-notice [data-action="remove-last-filter"]'))
            notice = driver.execute_script("""
                const wrap = document.getElementById('recordTableWrap');
                const box = document.querySelector('#recordsBody .empty-notice').getBoundingClientRect();
                const buttons = [...document.querySelectorAll('#recordsBody .empty-notice button')].map(e => e.getBoundingClientRect());
                const remove = document.querySelector('#recordsBody .empty-notice [data-action="remove-last-filter"]');
                return {inside: box.left >= wrap.getBoundingClientRect().left - 0.5 && box.right <= wrap.getBoundingClientRect().right + 0.5
                            && buttons.every(r => r.left >= box.left - 0.5 && r.right <= box.right + 0.5),
                        wrapped: remove.getBoundingClientRect().height > 40, text: remove.textContent.trim(),
                        sideways: wrap.scrollWidth - wrap.clientWidth, page: document.documentElement.scrollWidth - innerWidth};
            """)
            assert notice["inside"] and notice["wrapped"] and notice["sideways"] <= 1 and notice["page"] <= 1, (
                f"At 320px the empty-results notice and its buttons wrap inside the table: {notice}")
            results["phone-320-empty-notice"] = True
            # A card's tag line starts "not re-read" for a record not yet re-read; where the line is too long for the card
            # (with human-checked at 320px), human-checked is the check after the review result, never cut by the "…".
            if isinstance(((manifest.get("summary") or {}).get("overview") or {}).get("human_checked_accepted"), int):
                set_browse_viewport(driver, browser, 320, 800)
                open_page("#browse?source=databases&checked=1")
                wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, "#recordsBody .state-tag.human-checked"))
                marks = driver.execute_script("""
                    const shown = (element) => !!element && element.getBoundingClientRect().width > 0;
                    return [...document.querySelectorAll('#recordsBody tr[data-key] .state-badge')].map(badge => {
                        const line = badge.querySelector('.state-tags'), tag = badge.querySelector('.state-tag.human-checked');
                        const up = badge.querySelector('.state-label .state-check');
                        return {first: line.querySelector('.state-tag').textContent, up: shown(up), tag: shown(tag),
                                tagIn: !shown(tag) || tag.getBoundingClientRect().right <= line.getBoundingClientRect().right + 1};
                    });
                """)
                assert marks and all(mark["first"] == "not re-read" and (mark["up"] != mark["tag"]) and mark["tagIn"]
                                     for mark in marks), f"At 320px each card shows human-checked whole or as a check: {marks}"
                results["phone-320-card-tags"] = True
            # 360-389px with a filter on (the Filters count): the buttons narrow so the menu still shows "Review result"
            # whole (its text, padding and arrow), with Sort's arrow beside it (the word "Sort" from 390px, or with no filter).
            for width in (360, 372, 389):
                set_browse_viewport(driver, browser, width, 800)
                open_page("#browse?metric=kcat")
                sort = driver.execute_script("""
                    const top = selector => Math.round(document.querySelector(selector).getBoundingClientRect().top);
                    const select = document.getElementById('sortSelect');
                    const style = getComputedStyle(select);
                    const probe = document.createElement('span');
                    probe.textContent = select.options[select.selectedIndex].text;
                    probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
                    document.body.appendChild(probe);
                    const text = probe.getBoundingClientRect().width;
                    probe.remove();
                    return {text: select.options[select.selectedIndex].text, width: select.getBoundingClientRect().width,
                            need: text + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 2 + 20,
                            label: document.querySelector('#sortDirectionButton .sort-icon').getBoundingClientRect().width > 2,
                            tops: [top('#openFiltersButton'), top('#exportMenu > summary'), top('#sortSelect'), top('#sortDirectionButton')],
                            scroll: document.documentElement.scrollWidth > innerWidth + 1};
                """)
                assert (sort["text"] == "Review result" and sort["width"] >= sort["need"] and sort["label"]
                        and max(sort["tops"]) - min(sort["tops"]) <= 2 and not sort["scroll"]), (
                    f"At {width}px with a filter the Sort menu fits: {sort}")
            results["phone-320-toolbar"] = True
    except Exception:
        driver.save_screenshot(str(OUTPUT / f"{browser}-{route_label}-layout-failure.png"))
        raise
    finally:
        driver.execute_script("try { localStorage.removeItem('catlog.filtersCollapsed'); } catch (e) {}")
        set_browse_viewport(driver, browser, 1440, 1000)
    return {"route": route_label, "checked": results, "passed": True}


# Words of the earlier pipeline and of CatLog's tooling that a record must never show.
RECORD_PANEL_FORBIDDEN = re.compile(r"independent|AI run|second run|Protein identity|Accession resolved|Normalized|Values in source|Detail shard|earlier catalog|old catalog", re.I)


RECORD_SECTIONS = ["Values", "Compared with databases", "Checks", "Source", "Conditions", "Protein and substrate", "Paper"]
# Round 13 (a curated entry, not a log): what is the same on every record is the Guide's (one link under Checks), never a
# sentence of the record.
RECORD_BOILERPLATE = re.compile(r"converted by code|as extracted from the paper|Read from the paper by an AI model|"
                                r"Accepted: read from the paper by CatLog|CatLog has not read this paper again yet", re.I)

# A malic enzyme variant with 28 substitutions (PMID 24998673): its sequence line is one long run with no spaces.
LONG_VARIANT_RECORD = "e15d2d23d7f3db24"
# A triose phosphate isomerase read from the paper whose calculated kcat/Km (8.49 × 10⁷) carries calc. and a "!".
CALC_FLAG_RECORD = "1704dd2d6297af79"
# A biotinidase read from the paper (its Guide link once ran past the panel at 361-389px) and an older alcohol
# dehydrogenase whose SABIO-RK kcat/Km range (6.7 × 10⁻⁴–2.3 × 10³ mM⁻¹ s⁻¹, 115 values) once ran past it at 320px.
PHONE_PAPER_RECORD = "50abd2bbc472636a"
# An older laccase record (OED) with no As printed column whose calculated kcat/Km (1.3 × 10⁴) carries calc., and an older
# record without As printed whose Km carries a caution "!" beside a calc. kcat/Km (the "!"'s unseen copy keeps its width).
OLDER_CALC_RECORD = "d9e74e6231c6815d"
OLDER_FLAG_RECORD = "fc4516156e0894cf"
PHONE_LISTED_RANGE_RECORD = "1d970ee6bc6d9538"
# An APH(2'')-Ia variant whose Assay list holds "phosphoenolpyruvate/pyruvate kinase/lactate dehydrogenase/NADH" (wider
# than the list at 320px until the item could break it).
PHONE_LONG_WORD_RECORD = "2479abbe2effcc47"
# A vSET read from the paper whose three values a human reviewer approved, two of them written as × 10ⁿ (8.0 × 10⁻⁶ and
# 1.28 × 10⁻⁴): at 320px in a wide font they once ran into Unit and their checks dropped onto lines of their own.
PHONE_APPROVED_SCIENTIFIC_RECORD = "9f56345af45ee06e"


def check_record_panel(driver, browser, url, route_label):
    """The record (design spec 5, round 13): header lines, then Values, Compared with databases (only when it has something
    to say), Checks, Source (an older record's database; a record read from the paper has none), Conditions, Protein and
    substrate, Paper, then the record's actions and its footnote (license, snapshot, data ID); a record read from the
    paper gives its values as printed and one Guide link under Checks ("How CatLog reads a value"), no method sentence;
    an older record names the earlier automated review; no labelled row shows a bare dash; Show opens a sequence under
    its row."""
    wait = WebDriverWait(driver, 120, ignored_exceptions=(StaleElementReferenceException,))
    base = url.split("#", 1)[0]
    results = {}

    def open_first_record(address):
        driver.get("about:blank")
        driver.get(base + address)
        wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")
                   and not d.find_elements(By.CSS_SELECTOR, "#recordsBody tr.skeleton-row"))
        driver.find_element(By.CSS_SELECTOR, "#recordsBody tr[data-key] .primary-cell").click()
        wait.until(lambda d: d.execute_script(
            "return document.body.classList.contains('detail-open') && !document.querySelector('#detailLoadStatus')"
            " && Boolean(document.querySelector('#detailContent .detail-section'))"))
        return driver.execute_script("""
            const content = document.querySelector('#detailContent');
            const row = (label) => [...content.querySelectorAll('.kv-line')]
                .filter(e => e.querySelector('dt')?.textContent === label).map(e => e.querySelector('dd'));
            const method = row('Method')[0];
            const guideLink = content.querySelector('.checks-section .section-link a.method-link');
            const footnote = content.querySelector('.detail-footer .detail-footnote');
            // Show opens the first sequence (or SMILES) under its row and says Hide.
            const reveal = content.querySelector('[data-reveal-target]');
            let revealed = null;
            if (reveal) {
                const box = document.getElementById(reveal.dataset.revealTarget);
                const before = box.hidden;
                reveal.click();
                revealed = [before, box.hidden, reveal.getAttribute('aria-expanded'), reveal.textContent,
                    box.getBoundingClientRect().height > 0];
                reveal.click();
            }
            const status = content.querySelector('.detail-top .detail-status');
            const selectedDot = document.querySelector('#recordsBody tr[aria-selected="true"] .state-label');
            const databases = content.querySelector('.databases-section');
            return {
                sections: [...content.querySelectorAll('.detail-section > h3, details.detail-disclosure > summary')].map(e => e.textContent.trim()),
                // The status line's dot and the selected row's dot (the same status colour), the definition lists' columns
                // (112px labels, 96px on phones, one column with each label above its value up to 400px) and what
                // section G says.
                dotColor: status ? getComputedStyle(status, '::before').backgroundColor : null,
                rowDotColor: selectedDot && selectedDot.getBoundingClientRect().width > 0
                    ? getComputedStyle(selectedDot, '::before').backgroundColor : null,
                kvColumns: getComputedStyle(content.querySelector('.detail-section .kv-line')).gridTemplateColumns.split(' '),
                databasesText: databases ? databases.innerText : null,
                headingSize: getComputedStyle(content.querySelector('.detail-section > h3')).fontSize,
                subtitle: content.querySelector('.detail-top .detail-subtitle')?.textContent || '',
                substrate: content.querySelector('.detail-top .detail-substrate')?.textContent || '',
                status: content.querySelector('.detail-top .detail-status')?.textContent || '',
                recordKey: content.querySelector('.detail-top #detailRecordKey')?.textContent || '',
                dashes: [...content.querySelectorAll('.kv-line > dd')].filter(e => e.textContent.trim() === '—').length,
                method: method ? method.textContent : null,
                methodLink: method?.querySelector('a.method-link')?.getAttribute('href') || null,
                guideLink: guideLink ? [guideLink.textContent.trim(), guideLink.getAttribute('href')] : null,
                howReadInGuide: Boolean(document.getElementById('guide-how-read')),
                footnote: footnote ? footnote.innerText.trim() : null,
                lastPart: content.lastElementChild ? content.lastElementChild.className : null,
                quotes: [...content.querySelectorAll('.values-section .printed-lines .evidence-note-plain')].map(e => e.textContent.trim().slice(0, 40)),
                review: row('Review result')[0]?.textContent || null,
                paperCheck: row('Paper check')[0]?.textContent || null,
                valuesHead: [...content.querySelectorAll('.values-section .values-table thead th')].map(e => e.textContent),
                valueCells: [...content.querySelectorAll('.values-section .values-table td.vt-value')].map(e => getComputedStyle(e).textAlign),
                revealed,
                text: content.innerText,
                overflow: document.documentElement.scrollWidth > innerWidth + 1
                    || document.querySelector('.detail-panel').scrollWidth > document.querySelector('.detail-panel').clientWidth + 1,
            };
        """)

    sizes = [("desktop", 1440, 1000)] + ([("mobile", 390, 844)] if browser == "chrome" else [])
    try:
        for label, width, height in sizes:
            set_browse_viewport(driver, browser, width, height)
            for kind, address in (("from-paper", "#browse?source=paper&status=accepted"), ("database", "#browse?source=brenda"),
                                  ("database-pending", "#browse?source=brenda&status=curation_pending")):
                panel = open_first_record(address)
                # (an earlier corrected record's section in that slot is headed Corrected earlier: no database is compared there)
                sections = ["Compared with databases" if name == "Corrected earlier" else name for name in panel["sections"]]
                expected = [name for name in RECORD_SECTIONS if (name != "Compared with databases" or name in sections)
                            and (name != "Source" or kind != "from-paper" or name in sections)]
                assert sections == expected, panel["sections"]
                if kind != "from-paper":
                    assert "Source" in sections, panel["sections"]
                assert not RECORD_BOILERPLATE.search(panel["text"]), RECORD_BOILERPLATE.search(panel["text"]).group(0)
                # The actions close the record. The license and the snapshot hold for every record and are said once (the
                # table's footer, the counts band, the Guide); only a record under other terms than CC BY 4.0 says its own.
                assert panel["lastPart"] == "detail-footer", panel["lastPart"]
                assert panel["footnote"] is None or panel["footnote"].startswith("License for this record: "), panel["footnote"]
                assert not re.search(r"Data ID|Snapshot [A-Z]", panel["text"]), "The record repeats no snapshot line"
                assert all(quote.startswith("In the paper") for quote in panel["quotes"]), panel["quotes"]
                assert panel["headingSize"] == "14px", panel["headingSize"]
                assert panel["subtitle"].startswith("EC "), panel["subtitle"]
                assert panel["substrate"].startswith("Substrate: "), panel["substrate"]
                assert re.fullmatch(r"[0-9a-f]{16}(?:-\d+)?", panel["recordKey"]), panel["recordKey"]
                if kind == "from-paper":
                    assert panel["valuesHead"][:4] == ["Parameter", "Value", "Unit", "As printed"], panel["valuesHead"]
                else:
                    # An older record prints nothing in As printed, so it has no such column (dashes would read "not printed").
                    assert panel["valuesHead"] == ["Parameter", "Value", "Unit"], panel["valuesHead"]
                assert panel["valueCells"] and set(panel["valueCells"]) == {"right"}, panel["valueCells"]
                if panel["revealed"] is not None:
                    assert panel["revealed"] == [True, False, "true", "Hide", True], panel["revealed"]
                assert panel["dashes"] == 0, "A labelled row shows a bare dash"
                assert not RECORD_PANEL_FORBIDDEN.search(panel["text"]), RECORD_PANEL_FORBIDDEN.search(panel["text"]).group(0)
                assert not panel["overflow"], f"The {kind} record overflows sideways at {width}px"
                if width <= 400:
                    assert len(panel["kvColumns"]) == 1, panel["kvColumns"]
                else:
                    assert panel["kvColumns"][0] == ("96px" if width <= 720 else "112px"), panel["kvColumns"]
                assert panel["dotColor"] and panel["dotColor"] not in ("rgba(0, 0, 0, 0)", "transparent"), panel["dotColor"]
                if panel["rowDotColor"]:
                    assert panel["dotColor"] == panel["rowDotColor"], (panel["dotColor"], panel["rowDotColor"])
                if kind.startswith("database"):
                    # A database record compares nothing with the databases: an unsettled one says its values are the
                    # database's in Checks' Paper check row, never under Compared with databases. Only a record
                    # the earlier review corrected has the section, when the snapshot lists what that review changed.
                    if panel["databasesText"] is not None:
                        assert "corrected" in panel["status"] and "Corrected earlier" in panel["databasesText"], \
                            (panel["status"], panel["databasesText"])
                if kind == "database-pending":
                    assert panel["status"].startswith("Not confirmed"), panel["status"]
                    assert panel["paperCheck"] == "Not yet checked; the values are the database’s.", panel["paperCheck"]
                if kind == "from-paper":
                    assert panel["paperCheck"] is None, panel["paperCheck"]
                if kind == "from-paper":
                    assert "from paper" in panel["status"] and "read from the paper" not in panel["status"], panel["status"]
                    # No method sentence and no review sentence repeating the header: one Guide link under Checks.
                    assert panel["method"] is None and panel["review"] is None, (panel["method"], panel["review"])
                    assert panel["guideLink"] == ["How CatLog reads a value →",
                                                  "#guide-how-read" if panel["howReadInGuide"] else "#guide-method"], panel["guideLink"]
                else:
                    assert panel["method"] is None and "earlier automated review" in (panel["review"] or ""), panel["review"]
                    # (at the Guide's lines on the earlier version, round 14; an older Guide's method otherwise)
                    assert panel["guideLink"] == ["How the earlier review worked →", "#guide-earlier"], panel["guideLink"]
                if label == "desktop":
                    # With a record open the table's Status cells keep their source line (innerText: what is shown).
                    status_lines = driver.execute_script("""
                        return [...document.querySelectorAll('#recordsBody tr[data-key] .state-badge')].slice(0, 5)
                            .map(badge => badge.innerText.trim().split('\\n').map(line => line.trim()).filter(Boolean));
                    """)
                    assert status_lines and all(len(lines) >= 2 for lines in status_lines), status_lines
                    if kind == "from-paper":
                        assert all(lines[1] == "from paper" for lines in status_lines), status_lines
                    else:
                        assert all(lines[1] == "not re-read" for lines in status_lines), status_lines
                driver.save_screenshot(str(OUTPUT / f"{browser}-{route_label}-record-{kind}-{label}.png"))
                results[f"{kind}-{label}"] = True
                ActionChains(driver).send_keys(Keys.ESCAPE).perform()
                wait.until(lambda d: not d.execute_script("return document.body.classList.contains('detail-open')"))
            # A variant written as one long run with no spaces (28 substitutions joined by "/") wraps inside the record
            # instead of widening it (skipped when this snapshot does not have that record).
            driver.get("about:blank")
            driver.get(base + f"#record={LONG_VARIANT_RECORD}")
            wait.until(lambda d: d.execute_script(
                "return Boolean(document.querySelector('#detailContent .reveal-summary') || document.querySelector('#recordsBody .empty-notice'))"))
            if driver.find_elements(By.CSS_SELECTOR, "#detailContent .reveal-summary"):
                wide = driver.execute_script("const panel = document.getElementById('detailPanel'); return [panel.scrollWidth, panel.clientWidth]")
                assert wide[0] <= wide[1] + 1, f"The long variant record overflows sideways at {width}px: {wide}"
                results[f"long-variant-{label}"] = True
            if label != "mobile":
                # Every number in the Value column ends at the same place, also beside calc. and a "!".
                driver.get("about:blank")
                driver.get(base + f"#record={CALC_FLAG_RECORD}")
                wait.until(lambda d: d.execute_script(
                    "return Boolean(document.querySelector('#detailContent .values-section') || document.querySelector('#recordsBody .empty-notice'))"))
                if driver.find_elements(By.CSS_SELECTOR, "#detailContent .values-table .metric-origin:not(.vt-ghost)"):
                    edges = driver.execute_script(
                        "return [...document.querySelectorAll('#detailContent .values-table .vt-number')].map(e => e.getBoundingClientRect().right)")
                    assert len(edges) > 1 and max(edges) - min(edges) <= 1, f"The Value column's numbers do not line up at {width}px: {edges}"
                    results[f"values-aligned-{label}"] = True
            if label == "mobile":
                # On phones the values read as the Guide's phone mock (round 15 polish): parameter, value and unit on one
                # line, "As printed: ..." on its own line under them across the row, calc. and "!" beside their number
                # (under it below 340px, where Value is too narrow), every number ending at one place; the table stays
                # inside its section (at 390 and at 320px; skipped when this snapshot does not have that record).
                for phone_width in (390, 320):
                    set_browse_viewport(driver, browser, phone_width, height)
                    driver.get("about:blank")
                    driver.get(base + f"#record={CALC_FLAG_RECORD}")
                    wait.until(lambda d: d.execute_script(
                        "return Boolean(document.querySelector('#detailContent .values-section') || document.querySelector('#recordsBody .empty-notice'))"))
                    if not driver.find_elements(By.CSS_SELECTOR, "#detailContent .values-table .metric-origin"):
                        continue
                    fit = driver.execute_script("""
                        const section = document.querySelector('#detailContent .values-section');
                        const table = section.querySelector('.values-table');
                        const contentRight = section.getBoundingClientRect().right - parseFloat(getComputedStyle(section).paddingRight);
                        const heads = [...table.querySelectorAll('thead th')].map(th => [th.textContent, th.getBoundingClientRect().width]);
                        const cell = section.querySelector('td.vt-value .metric-origin:not(.vt-ghost)').closest('td');
                        const panel = document.getElementById('detailPanel');
                        const flag = cell.querySelector('.value-flag:not(.vt-ghost)');
                        const cellRight = cell.getBoundingClientRect().right - parseFloat(getComputedStyle(cell).paddingRight);
                        const rows = [...table.querySelectorAll('tbody tr')];
                        const box = (row, sel) => row.querySelector(sel).getBoundingClientRect();
                        return {over: table.getBoundingClientRect().right - contentRight,
                                flagGap: flag ? cellRight - flag.getBoundingClientRect().right : null,
                                below: cell.querySelector('.metric-origin:not(.vt-ghost)').getBoundingClientRect().top
                                    >= cell.querySelector('.vt-number').getBoundingClientRect().bottom - 1,
                                // As printed: its own line under value and unit, across the row, named by its label
                                printedRows: rows.map(row => ({own: box(row, 'td.vt-printed').top >= Math.max(box(row, 'td.vt-value').bottom, box(row, 'td.vt-unit').bottom) - 1,
                                    wide: box(row, 'td.vt-printed').width >= table.getBoundingClientRect().width - 1,
                                    label: getComputedStyle(row.querySelector('td.vt-printed'), '::before').content})),
                                unitAfter: rows.every(row => box(row, 'td.vt-unit').left >= box(row, 'td.vt-value').right),
                                spread: Math.max(...rows.map(row => box(row, '.vt-number').right)) - Math.min(...rows.map(row => box(row, '.vt-number').right)),
                                headsHidden: table.querySelector('thead').getBoundingClientRect().width <= 1 && heads.length === 4,
                                sideways: panel.scrollWidth - panel.clientWidth};
                    """)
                    assert fit["over"] <= 1 and fit["sideways"] <= 1, f"The Values table runs past its section at {phone_width}px: {fit}"
                    assert fit["below"] == (phone_width < 340), f"calc. is {'beside' if not fit['below'] else 'under'} the number at {phone_width}px: {fit}"
                    assert all(r["own"] and r["wide"] and "As printed" in r["label"] for r in fit["printedRows"]), f"As printed is not a line of its own at {phone_width}px: {fit}"
                    assert fit["unitAfter"] and fit["headsHidden"] and fit["spread"] <= 1, f"The phone Values rows do not line up at {phone_width}px: {fit}"
                    # The "!" ends at the right of Value, beside or under its number, never at the cell's left edge.
                    assert fit["flagGap"] is None or abs(fit["flagGap"]) <= 1, f"The '!' is not at its number at {phone_width}px: {fit}"
                    results[f"values-table-{phone_width}"] = True
                    if phone_width == 390:
                        # Only the name and × stay in view when the record scrolls; the status line scrolls away.
                        stuck = driver.execute_script("""
                            const panel = document.getElementById('detailPanel');
                            panel.scrollTop = 600;
                            const title = panel.querySelector('.detail-title').getBoundingClientRect();
                            const close = document.getElementById('closeDetailButton').getBoundingClientRect();
                            return {top: title.top - panel.getBoundingClientRect().top, share: title.height / panel.clientHeight,
                                    closeShown: close.top >= 0 && close.bottom <= innerHeight,
                                    statusGone: panel.querySelector('.detail-status').getBoundingClientRect().bottom <= title.top + 1};
                        """)
                        assert abs(stuck["top"]) <= 1 and stuck["closeShown"] and stuck["statusGone"], stuck
                        assert stuck["share"] < 0.15, f"The record's sticky header takes {stuck['share']:.0%} of a phone screen"
                # A record without As printed (an older record) has the room: from 361px its calc. and "!" stay beside the
                # number, every number still ends at the same place (with or without a "!") and the table stays inside its
                # section (skipped when this snapshot does not have that record).
                set_browse_viewport(driver, browser, 390, height)
                for older_record in (OLDER_CALC_RECORD, OLDER_FLAG_RECORD):
                    driver.get("about:blank")
                    driver.get(base + f"#record={older_record}")
                    wait.until(lambda d: d.execute_script(
                        "return Boolean(document.querySelector('#detailContent .values-section') || document.querySelector('#recordsBody .empty-notice'))"))
                    if not driver.find_elements(By.CSS_SELECTOR, "#detailContent .values-table.vt-no-printed .metric-origin:not(.vt-ghost)"):
                        continue
                    beside = driver.execute_script("""
                        const section = document.querySelector('#detailContent .values-section');
                        const table = section.querySelector('.values-table');
                        const contentRight = section.getBoundingClientRect().right - parseFloat(getComputedStyle(section).paddingRight);
                        const cell = section.querySelector('td.vt-value .metric-origin:not(.vt-ghost)').closest('td');
                        const number = cell.querySelector('.vt-number').getBoundingClientRect();
                        const calc = cell.querySelector('.metric-origin:not(.vt-ghost)').getBoundingClientRect();
                        const edges = [...table.querySelectorAll('.vt-number')].map(e => e.getBoundingClientRect().right);
                        return {over: table.getBoundingClientRect().right - contentRight,
                                beside: calc.top < number.bottom && calc.left >= number.right - 1,
                                spread: Math.max(...edges) - Math.min(...edges)};
                    """)
                    assert beside["over"] <= 1, f"The older record {older_record}'s Values table runs past its section at 390px: {beside}"
                    assert beside["beside"], f"The older record {older_record}'s calc. goes under its number at 390px: {beside}"
                    assert beside["spread"] <= 1, f"The older record {older_record}'s numbers do not line up at 390px: {beside}"
                    results[f"older-calc-beside-390-{older_record}"] = True
                if browser == "chrome":
                    # At 320px in a wide font (Linux Chrome's are wider) a number written as × 10ⁿ wraps before "× 10" inside
                    # Value, never into Unit; its check stays beside its last line; every number ends at the same place
                    # (skipped when this snapshot does not have that record).
                    set_browse_viewport(driver, browser, 320, height)
                    driver.get("about:blank")
                    driver.get(base + f"#record={PHONE_APPROVED_SCIENTIFIC_RECORD}")
                    wait.until(lambda d: d.execute_script(
                        "return Boolean(document.querySelector('#detailContent .values-section') || document.querySelector('#recordsBody .empty-notice'))"))
                    if driver.find_elements(By.CSS_SELECTOR, "#detailContent .detail-status"):
                        # Its status line (Accepted · read from the paper · ✓ human-checked) wraps here in a wide font: the
                        # tag that starts the next line shows no "·" before it and the line above ends without one.
                        status = driver.execute_script("""
                            const style = document.createElement('style');
                            style.id = 'wideStatusCheck';
                            style.textContent = "#detailPanel .detail-status, #detailPanel .detail-status * {font-family: Verdana, 'DejaVu Sans', sans-serif !important; letter-spacing: 0.5px !important}";
                            document.head.appendChild(style);
                            const line = document.querySelector('#detailContent .detail-status');
                            const clipLeft = line.getBoundingClientRect().left + parseFloat(getComputedStyle(line).borderLeftWidth);
                            const tags = [...line.children];
                            const tops = tags.map(tag => tag.getBoundingClientRect().top);
                            // A "·" before a tag that starts a line has no room left of it inside the line's clipped box.
                            const dotStarts = tags.filter((tag, i) => i > 0 && tops[i] > tops[i - 1] + 1
                                && getComputedStyle(tag, '::before').content !== 'none'
                                && tag.getBoundingClientRect().left - clipLeft > 1).map(tag => tag.textContent);
                            const dotEnds = tags.filter(tag => !['none', 'normal'].includes(getComputedStyle(tag, '::after').content)).map(tag => tag.textContent);
                            const result = {lines: new Set(tops.map(Math.round)).size, dotStarts, dotEnds, text: line.textContent};
                            style.remove();
                            return result;
                        """)
                        assert not status["dotStarts"] and not status["dotEnds"], f"The record's status line leaves a dangling '·' at 320px: {status}"
                        results["status-line-wrap-320"] = True
                    if driver.find_elements(By.CSS_SELECTOR, "#detailContent .values-table .scientific-number"):
                        wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, "#detailContent .values-table .value-approved[role='img']"))
                        driver.execute_script("""
                            const style = document.createElement('style');
                            style.id = 'wideFontCheck';
                            style.textContent = "#detailPanel, #detailPanel * {font-family: Verdana, 'DejaVu Sans', sans-serif !important; letter-spacing: 0.5px !important}";
                            document.head.appendChild(style);
                        """)
                        measured = driver.execute_script("""
                            const glyphs = (element, skip) => {
                                const rects = [];
                                const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
                                while (walker.nextNode()) {
                                    const node = walker.currentNode;
                                    if (skip && node.parentElement.closest(skip)) continue;
                                    for (let i = 0; i < node.length; i++) {
                                        if (!node.data[i].trim() || node.data[i] === '\u2060') continue;
                                        const range = document.createRange();
                                        range.setStart(node, i);
                                        range.setEnd(node, i + 1);
                                        const rect = range.getBoundingClientRect();
                                        if (rect.width > 0) rects.push(rect);
                                    }
                                }
                                return rects;
                            };
                            const head = glyphs(document.querySelector('#detailContent .values-table thead th.vt-value'), '.vt-ghost');
                            const rows = [...document.querySelectorAll('#detailContent .values-table tbody tr')].map(row => {
                                const number = glyphs(row.querySelector('td.vt-value .vt-number'), '.value-approved');
                                const unit = glyphs(row.querySelector('td.vt-unit'));
                                const check = row.querySelector('td.vt-value .value-approved[role="img"]');
                                const last = number[number.length - 1];
                                const checkRect = check && check.getBoundingClientRect();
                                return {
                                    name: row.cells[0].innerText.trim(),
                                    numberRight: Math.max(...number.map(r => r.right)),
                                    unitLeft: Math.min(...unit.map(r => r.left)),
                                    cellRight: row.querySelector('td.vt-value').getBoundingClientRect().right,
                                    checkBeside: checkRect ? checkRect.left >= last.right - 1 && checkRect.top < last.bottom && checkRect.bottom > last.top : null,
                                    checkInside: checkRect ? checkRect.right <= row.querySelector('td.vt-value').getBoundingClientRect().right + 1 : null,
                                };
                            });
                            const headCell = document.querySelector('#detailContent .values-table thead th.vt-value');
                            return {rows, headRight: Math.max(...head.map(r => r.right)), headShown: headCell.closest('thead').getBoundingClientRect().width > 1};
                        """)
                        driver.execute_script("document.getElementById('wideFontCheck')?.remove()")
                        rows = measured["rows"]
                        for row in rows:
                            assert row["numberRight"] < row["unitLeft"], f"{row['name']}'s value runs into Unit at 320px: {row}"
                            assert row["checkBeside"] is not False and row["checkInside"] is not False, f"{row['name']}'s check leaves its number at 320px: {row}"
                        ends = [row["numberRight"] for row in rows]
                        assert max(ends) - min(ends) <= 1, f"The Value column's numbers do not line up at 320px: {rows}"
                        # The heading keeps the checks' space too, so it ends where the numbers end (when it shows: a record
                        # with As printed keeps its column heads for screen readers only on a phone, round 15 polish).
                        assert not measured["headShown"] or abs(measured["headRight"] - max(ends)) <= 1, f"Value does not end over the numbers at 320px: {measured}"
                        results["values-approved-scientific-320"] = True
                    # At 375 and 390px in a wide font the check's 16px once broke its As printed "0.00048 min⁻¹" into
                    # "0.0004" over "8": each printed number stays whole and the table inside its section.
                    for phone_width in (375, 390):
                        set_browse_viewport(driver, browser, phone_width, height)
                        driver.get("about:blank")
                        driver.get(base + f"#record={PHONE_APPROVED_SCIENTIFIC_RECORD}")
                        wait.until(lambda d: d.execute_script(
                            "return Boolean(document.querySelector('#detailContent .values-section') || document.querySelector('#recordsBody .empty-notice'))"))
                        if not driver.find_elements(By.CSS_SELECTOR, "#detailContent .values-table .vt-printed"):
                            continue
                        wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, "#detailContent .values-table .value-approved[role='img']"))
                        printed = driver.execute_script("""
                            const style = document.createElement('style');
                            style.id = 'widePrintedCheck';
                            style.textContent = "#detailPanel, #detailPanel * {font-family: Verdana, 'DejaVu Sans', sans-serif !important; letter-spacing: 0.5px !important}";
                            document.head.appendChild(style);
                            const table = document.querySelector('#detailContent .values-table');
                            const lines = (element) => {
                                const range = document.createRange();
                                range.selectNodeContents(element);
                                return new Set([...range.getClientRects()].filter(r => r.width > 0.5).map(r => Math.round(r.top))).size;
                            };
                            const split = [...table.querySelectorAll('.vt-printed .vt-whole')].filter(e => lines(e) > 1).map(e => e.textContent);
                            const section = table.parentElement;
                            const inner = section.getBoundingClientRect().right - parseFloat(getComputedStyle(section).paddingRight);
                            const result = {split, figures: table.querySelectorAll('.vt-printed .vt-whole').length,
                                            past: Math.round(table.getBoundingClientRect().right - inner)};
                            style.remove();
                            return result;
                        """)
                        assert printed["figures"] and not printed["split"], f"As printed breaks a number at {phone_width}px in a wide font: {printed}"
                        assert printed["past"] <= 1, f"The Values table runs past its section at {phone_width}px in a wide font: {printed}"
                        results[f"values-printed-whole-{phone_width}"] = True
                # No record scrolls sideways on a phone: a record read from the paper (its Guide link wraps),
                # a long listed kcat/Km range (it breaks after its dash) and an Assay item with a long word, from 320 to
                # 389px (skipped when this snapshot does not have the record).
                for phone_width in (375, 361, 320):
                    set_browse_viewport(driver, browser, phone_width, height)
                    for key in (PHONE_PAPER_RECORD, PHONE_LISTED_RANGE_RECORD, PHONE_LONG_WORD_RECORD):
                        driver.get("about:blank")
                        driver.get(base + f"#record={key}")
                        wait.until(lambda d: d.execute_script(
                            "return Boolean(document.querySelector('#detailContent .values-section') || document.querySelector('#recordsBody .empty-notice'))"))
                        if not driver.find_elements(By.CSS_SELECTOR, "#detailContent .values-section"):
                            continue
                        sideways = driver.execute_script("""
                            const panel = document.getElementById('detailPanel');
                            const right = panel.getBoundingClientRect().left + panel.clientWidth;
                            const past = [...panel.querySelectorAll('.method-link, .source-efficiency-value, .listed-end, .condition-list > li')]
                                .filter(e => e.getBoundingClientRect().right > right + 1).map(e => e.textContent);
                            return {sideways: panel.scrollWidth - panel.clientWidth, past};
                        """)
                        assert sideways["sideways"] <= 1 and not sideways["past"], f"Record {key} scrolls sideways at {phone_width}px: {sideways}"
                        results[f"phone-{phone_width}-{key}"] = True
                set_browse_viewport(driver, browser, width, height)
        set_browse_viewport(driver, browser, 1440, 1000)
        # A link to filtered results with a record, followed inside the open page, opens that record on its page.
        driver.get("about:blank")
        driver.get(base + "#browse?status=disputed")
        wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")
                   and not d.find_elements(By.CSS_SELECTOR, "#recordsBody tr.skeleton-row")
                   and re.fullmatch(r"[\d,]+ records?", d.find_element(By.ID, "activeSummary").text))
        disputed = driver.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")[-1].get_attribute("data-key")
        driver.execute_script("location.hash = '#browse?q=hexokinase'")
        wait.until(lambda d: disputed not in [row.get_attribute("data-key") for row in d.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")])
        driver.execute_script("location.hash = arguments[0]", f"#browse?status=disputed&record={disputed}")
        wait.until(lambda d: d.execute_script(
            "return document.body.classList.contains('detail-open') && Boolean(document.querySelector('#detailContent .detail-section'))"))
        assert f"record={disputed}" in driver.current_url, driver.current_url
        assert driver.find_element(By.CSS_SELECTOR, '#recordsBody tr[aria-selected="true"]').get_attribute("data-key") == disputed
        results["in-page-record-link"] = True
        # The record is the last of its page: the table scrolls its row into view, below the column headings.
        row_in_view = """
            const wrap = document.getElementById('recordTableWrap');
            const row = document.querySelector('#recordsBody tr[aria-selected="true"]');
            if (!wrap || !row) return null;
            const box = wrap.getBoundingClientRect();
            const head = wrap.querySelector('thead th').getBoundingClientRect();
            const rect = row.getBoundingClientRect();
            return rect.top >= head.bottom - 1 && rect.bottom <= Math.min(box.top + wrap.clientTop + wrap.clientHeight, innerHeight) + 1;
        """
        wait.until(lambda d: d.execute_script(row_in_view))
        results["record-link-row-in-view"] = True
        results.update(check_record_marks_and_paper_link(driver, browser, base, wait))
        results.update(check_record_databases(driver, browser, base, wait))
    except Exception:
        driver.save_screenshot(str(OUTPUT / f"{browser}-{route_label}-record-panel-failure.png"))
        raise
    return {"route": route_label, "checked": results, "passed": True}


# Section G's records in the test snapshot of 2026-10-13 (each check is skipped when a snapshot does not have it): an
# orotidine 5'-monophosphate decarboxylase variant (PMID 24958125) whose kcat and Km correct OED's numbers and whose
# kcat/Km no database lists; a glutamate racemase (PMID 19552402) with the paper's note on BRENDA; an earlier
# methylglyoxal synthase record (PMID 23261063) whose kcat/Km the earlier version changed from 0.546667 to 0.544; a
# record (PMID 24358164) whose kcat/Km no compared database lists, next to a Km that differs; a record (PMID 11876827)
# whose kcat/Km CatLog calculated, with a kcat that differs and a Km no database lists.
DATABASE_NOTES_RECORD = "97138dce57908fb0"
DATABASE_NOT_LISTED_RECORD = "8090b6354d18037c"
DATABASE_CALCULATED_RECORD = "8db79c81e62be8af"
DATABASE_PAPER_NOTE_RECORD = "d93a98fb48b46766"
EARLIER_CORRECTIONS_RECORD = "a6b6214047f31410"
# A 3alpha-HSD record (PMID 16788056) whose Km SABIO-RK lists 1,000× lower, found by the exact factor alone: its result,
# "Different number (exact factor, not yet checked)", is wider than a 320px phone's note in any font (375px in DejaVu).
EXACT_FACTOR_RECORD = "4719b1575bee89df"
DATABASE_RESULT_WORDS = ("Corrects a value", "Different number", "Different number (exact factor, not yet checked)", "Same, other label",
                         "Not in the databases")
DATABASE_CAPTION_END = "A different number can belong to another record of the paper; it does not by itself mean a database is wrong."
# (A record whose every value the earlier version added says so instead: "... added these values from the paper; ...".)
EARLIER_CORRECTIONS_INTRO = ("Changed by CatLog’s earlier version:",
                             "CatLog’s earlier version added these values from the paper; the source had none.")
DATABASE_SECTION_STATE = """
    const strip = (text) => (text || '').trim();
    const section = document.querySelector('#detailContent .databases-section');
    const panel = document.getElementById('detailPanel');
    return {
        order: [...document.querySelectorAll('#detailContent .detail-section > h3')].map(h => strip(h.textContent)),
        notes: [...section.querySelectorAll('.cmp-note')].map(note => ({field: note.dataset.cmpField, details: note.tagName === 'DETAILS',
            open: note.tagName === 'DETAILS' ? note.open : null, word: strip(note.querySelector('.cmp-result strong')?.textContent)})),
        pointers: [...document.querySelectorAll('#detailContent .values-section .cmp-pointer-link')].map(button => button.dataset.showNote),
        pointerLines: [...document.querySelectorAll('#detailContent .values-section .cmp-pointer')].map(line => strip(line.innerText)),
        about: strip(section.querySelector('.detail-about .cmp-compared')?.textContent),
        aboutButton: (() => {
            const button = section.querySelector(':scope > .section-about');
            const box = button && document.getElementById(button.getAttribute('aria-controls'));
            return button ? {expanded: button.getAttribute('aria-expanded'), hidden: Boolean(box?.hidden), inSection: Boolean(box && section.contains(box)),
                             afterHeading: button.previousElementSibling?.tagName === 'H3'} : null;
        })(),
        footers: section.querySelectorAll('.cmp-footer').length,
        cautions: [...section.querySelectorAll('.cmp-caution-line')].map(e => strip(e.textContent)),
        box: strip(section.querySelector('.cmp-paper-note')?.innerText),
        boxLink: section.querySelector('.cmp-paper-note a')?.getAttribute('href') || null,
        intro: strip(section.querySelector('.cmp-intro')?.textContent),
        stored: [...section.querySelectorAll('.cmp-value [title]')].map(e => [strip(e.textContent), e.getAttribute('title')]),
        before: [...section.querySelectorAll('.cmp-before')].map(e => strip(e.textContent)),
        text: strip(section.innerText),
        all: strip(section.textContent).replace(/\\s+/g, ' '),
        sequence: [...section.querySelectorAll('.cmp-same-line, .cmp-note, .cmp-caution-line, .cmp-calc-line')]
            .map(e => e.matches('.cmp-caution-line') ? 'caution' : e.matches('.cmp-calc-line') ? 'calculated' : e.matches('.cmp-note') ? 'note' : 'same'),
        calculatedMarks: [...section.querySelectorAll('.cmp-calc-line .cmp-mark')].length,
        sideways: panel.scrollWidth - panel.clientWidth,
    };
"""
# A snapshot whose lines predate the round 9 brief's C9 (the 2026-10-13 test bundle says "None of the five databases" and
# "STRENDA"): set to 1 for such a test bundle only, and the check lists what it found instead of failing. Never in CI.
PRE_C9_LINES = os.environ.get("CATLOG_CHECK_PRE_C9_LINES") == "1"


def footer_database_names(about):
    """The compared databases a record's "?" box names ("Compared with the values BRENDA, ... and STRENDA DB list for the
    same paper."; until 2026-10-15 a footer on every record), as it names them."""
    match = re.match(r"Compared with the values (.+?) lists? for the same paper\.", about)
    assert match, about
    return re.split(r", | and ", match.group(1))


def database_names_problems(state):
    """How section G names the databases, against its "?" box (the snapshot's list of compared databases, by their display
    names), over the whole section with its closed notes: no count of them in words ("None of the five databases": the
    lines say "the compared databases", round 9 brief C9) and every database named as the box names it ("STRENDA
    DB", never "STRENDA" alone)."""
    text = state["all"]
    problems = []
    counted = re.search(r"\b(?:two|three|four|five|six|seven|eight|nine|ten)\s+(?:compared\s+|core\s+)?databases\b", text, re.I)
    if counted:
        problems.append(f"counts the databases: {counted.group(0)!r}")
    for name in footer_database_names(state["about"]):
        first, _, rest = name.partition(" ")
        if rest and re.search(rf"\b{re.escape(first)}\b(?! {re.escape(rest)})", text):
            problems.append(f"names {first} without {rest!r} (the \"?\" box: {name})")
    return problems


def check_database_caution(state):
    """The caption's caution ("A different number can mean a different measurement; ...") shows under the notes as one
    line only on a record with a Different number (the user, 2026-10-15: not on every record); the "?" box says it only
    when that line does not, so the record says it once (the reviewer saw it twice with the box open)."""
    differs = any(note["word"].startswith("Different number") for note in state["notes"])
    assert state["cautions"] == ([DATABASE_CAPTION_END] if differs else []), (state["cautions"], state["notes"])
    # The "?" box never says it (the caveat stands under Different number only, the user 2026-10-15).
    if state["about"]:
        assert state["about"].endswith(" for the same paper."), state["about"]
    assert state["all"].count(DATABASE_CAPTION_END) == (1 if differs else 0), state["all"]


# The side of the square, centred on a "?", that a tap anywhere in reaches it: 44 (a 44px target round the 24px circle,
# on phones and touch screens), 24 (the circle alone) or 0. The "?" is scrolled into view first.
ABOUT_TARGET_JS = """
    const button = arguments[0];
    const r = button.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    // (the circle's corners are outside it: only its edges are probed)
    const hits = (half, points) => points.every(([x, y]) => {
        const e = document.elementFromPoint(cx + x * half, cy + y * half);
        return Boolean(e && button.contains(e));
    });
    const edges = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    return hits(21.5, [[-1, -1], [1, -1], [-1, 1], [1, 1], ...edges]) ? 44 : hits(11.5, edges) ? 24 : 0;
"""


def open_database_about(driver, wait, width):
    """Opens the record's Compared with databases "?" box (centred first, for Safari) and returns where the "?" and the box
    sit: the "?" on the heading's line just after its words, the box under the heading, inside the panel."""
    button = driver.find_element(By.CSS_SELECTOR, "#detailContent .databases-section > .section-about")
    driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", button)
    # On phones the "?" is a 44px target round its 24px circle, as the record's ‹ › × are 44px there.
    target = driver.execute_script(ABOUT_TARGET_JS, button)
    assert target == (44 if width <= 640 else 24), f"The record's \"?\" target at {width}px: {target}px"
    button.click()
    wait.until(lambda d: d.execute_script("""
        const button = document.querySelector('#detailContent .databases-section > .section-about');
        const box = document.getElementById(button.getAttribute('aria-controls'));
        return button.getAttribute('aria-expanded') === 'true' && !box.hidden && box.getBoundingClientRect().height > 0;"""))
    place = driver.execute_script("""
        const section = document.querySelector('#detailContent .databases-section');
        const heading = section.querySelector(':scope > h3').getBoundingClientRect();
        const words = document.createRange();
        words.selectNodeContents(section.querySelector(':scope > h3'));
        const text = words.getBoundingClientRect();
        const button = section.querySelector(':scope > .section-about').getBoundingClientRect();
        const box = section.querySelector('.detail-about');
        const boxRect = box.getBoundingClientRect();
        const panel = document.getElementById('detailPanel');
        return {gap: Math.round(button.left - text.right), middle: Math.abs((button.top + button.bottom) / 2 - (heading.top + heading.bottom) / 2),
                below: Math.round(boxRect.top - heading.bottom), size: [Math.round(button.width), Math.round(button.height)],
                guide: box.querySelector('a') ? box.querySelector('a').getAttribute('href') : null,
                sideways: panel.scrollWidth - panel.clientWidth};""")
    assert 4 <= place["gap"] <= 12 and place["middle"] <= 1.5 and place["size"] == [24, 24], f"The record's \"?\" at {width}px: {place}"
    assert place["below"] >= 0 and place["sideways"] <= 1, f"The record's \"?\" box at {width}px: {place}"
    return place


def check_record_databases(driver, browser, base, wait):
    """Section G, Compared with databases (round 9 brief, section 4): a folding note for each value that is not the same,
    the result's word in its summary; notes on a correction or a different number open (every one from 641px, only the
    first on a phone); one line under the Values table for each of those values, whose button opens its note in view;
    the compared databases and the caption once, in the heading's "?" box (the "?" on the heading's line; the box's link
    opens the Guide's section), never a footer; the caption under the notes only on a record with a Different number; the paper's note in a box with its link into Browse; an earlier
    record's intro, numbers to at most 4 figures (the stored digits in the title) and Before line; the lines (a value no
    database lists too) name the databases as the footer does, never counted in words; a calculated kcat/Km comes last,
    without a square. No record scrolls sideways.
    Skipped where the snapshot does not have the record."""
    results = {}

    def open_record(key):
        driver.get("about:blank")
        driver.get(base + f"#record={key}")
        wait.until(lambda d: d.execute_script(
            "return Boolean(document.querySelector('#detailContent .values-section') || document.querySelector('#recordsBody .empty-notice'))"))
        return bool(driver.find_elements(By.CSS_SELECTOR, "#detailContent .databases-section"))

    def check_database_names(state, key):
        problems = database_names_problems(state)
        if problems and PRE_C9_LINES:
            results.setdefault("databases-names-pre-c9", {})[key] = problems
            return "waived (lines before C9)"
        assert not problems, (f"Record {key}: Compared with databases names the databases unlike its \"?\" box: {problems}. The "
                              "snapshot's database_line predates C9 (catlog-v2 tools/site_release.py: 'None of the compared "
                              "databases', display names such as STRENDA DB); publish this section only with C9. For a pre-C9 "
                              "test bundle only, CATLOG_CHECK_PRE_C9_LINES=1 lists this instead of failing.")
        return True

    sizes = [("desktop", 1440, 1000)] + ([("phone-390", 390, 844), ("phone-320", 320, 800)] if browser == "chrome" else [])
    for label, width, height in sizes:
        set_browse_viewport(driver, browser, width, height)
        if open_record(DATABASE_NOTES_RECORD):
            state = driver.execute_script(DATABASE_SECTION_STATE)
            assert state["order"][:2] == ["Values", "Compared with databases"], state["order"]
            assert state["notes"] and all(note["word"] in DATABASE_RESULT_WORDS for note in state["notes"]), state["notes"]
            changed = [note for note in state["notes"] if note["word"] in ("Corrects a value", "Different number", "Different number (exact factor, not yet checked)")]
            assert changed and all(note["details"] for note in changed), state["notes"]
            # Notes on a correction or a different number are open: every one from 641px, only the first on a phone.
            expected = [width >= 641 or index == 0 for index, _ in enumerate(changed)]
            assert [note["open"] for note in changed] == expected, f"Open notes at {width}px: {state['notes']}"
            assert not any(note["open"] for note in state["notes"] if note not in changed), state["notes"]
            # One line under the Values table for each of them, in words.
            assert state["pointers"] == [note["field"] for note in changed], (state["pointers"], state["notes"])
            # ("kcat/Km: corrects SABIO-RK and OED ↓": the note names the numbers, once)
            # (spaces made plain first: a browser may break the line round the button's visually hidden words)
            assert all(re.fullmatch(r"\S+: (?:corrects|differs from) \S.* ↓", re.sub(r"\s+", " ", line).strip()) and "another number" not in line
                       for line in state["pointerLines"]), state["pointerLines"]
            # Each fact once: the summary says the parameter and the result (no databases), no note repeats its line's
            # cause, and the checker's notes are folded under "What the AI check found", never labelled "In the paper".
            assert "list another number" not in state["all"] and "lists another number" not in state["all"], state["all"]
            assert not re.search(r"\bIn the paper\b(?!:)", state["all"]), state["all"]
            # The compared databases and the caption are said once, in the heading's "?" box (closed at first), never as a
            # footer on every record; the caption shows under the notes only on a record with a Different number.
            assert state["about"].startswith("Compared with the values "), state["about"]
            assert state["aboutButton"] == {"expanded": "false", "hidden": True, "inSection": True, "afterHeading": True}, state["aboutButton"]
            assert state["footers"] == 0, "Compared with databases still ends with a footer"
            check_database_caution(state)
            assert not re.search(r"\bfive\b|Not in any database|Same number, other label|Adds a value", state["text"]), state["text"]
            assert state["sideways"] <= 1, f"Compared with databases scrolls sideways at {width}px: {state['sideways']}"
            # The "?" opens the box under the heading (on the heading's line, after its words), where each database's
            # name keeps one line (SABIO-RK never breaks at its hyphen, STRENDA DB at its space); it closes again.
            about = open_database_about(driver, wait, width)
            names = "|".join(re.escape(name) for name in footer_database_names(state["about"]))
            split = driver.execute_script(SPLIT_WORDS_JS, driver.find_element(By.CSS_SELECTOR, "#detailContent .detail-about .cmp-compared"), names, False)
            assert split == [], f"A database's name breaks across lines in the record's \"?\" box at {width}px: {split}"
            assert about["guide"] in (None, "#guide-databases"), about
            driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", driver.find_element(By.CSS_SELECTOR, "#detailContent .databases-section > .section-about"))
            driver.find_element(By.CSS_SELECTOR, "#detailContent .databases-section > .section-about").click()
            wait.until(lambda d: d.execute_script("""
                const button = document.querySelector('#detailContent .databases-section > .section-about');
                return button.getAttribute('aria-expanded') === 'false' && document.getElementById(button.getAttribute('aria-controls')).hidden;"""))
            if label == "desktop":
                check_database_names(state, DATABASE_NOTES_RECORD)
            # A pointer's button opens its note (a closed one where there is one) in view, its summary focused.
            closed = [note["field"] for note in changed if not note["open"]]
            target = (closed or state["pointers"])[0]
            button = driver.find_element(By.CSS_SELECTOR, f'#detailContent .cmp-pointer-link[data-show-note="{target}"]')
            driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", button)
            button.click()
            wait.until(lambda d: d.execute_script("""
                const note = document.querySelector(`#detailContent .cmp-note[data-cmp-field="${arguments[0]}"]`);
                const panel = document.getElementById('detailPanel').getBoundingClientRect();
                const box = note.querySelector('summary').getBoundingClientRect();
                return note.open && box.top >= panel.top - 1 && box.bottom <= Math.min(panel.bottom, innerHeight) + 1
                    && document.activeElement === note.querySelector('summary');
            """, target))
            assert driver.execute_script("const p = document.getElementById('detailPanel'); return p.scrollWidth - p.clientWidth") <= 1
            driver.save_screenshot(str(OUTPUT / f"{browser}-record-databases-{label}.png"))
            results[f"databases-notes-{label}"] = True
            if label == "desktop" and about["guide"]:
                # The box's link opens the Guide at its Compared with databases section.
                open_database_about(driver, wait, width)
                link = driver.find_element(By.CSS_SELECTOR, "#detailContent .detail-about a[href='#guide-databases']")
                driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", link)
                link.click()
                wait.until(lambda d: d.execute_script("""
                    const section = document.getElementById('guide-databases');
                    const view = document.getElementById('guideView');
                    return location.hash === '#guide-databases' && section && view && !view.hidden && section.getBoundingClientRect().height > 0;"""))
                results["databases-about-guide-link"] = True
        if label == "desktop" and open_record(DATABASE_NOT_LISTED_RECORD):
            # A value no compared database lists: its note's line (closed) names the databases as the footer does.
            state = driver.execute_script(DATABASE_SECTION_STATE)
            assert "Not in the databases" in [note["word"] for note in state["notes"]], state["notes"]
            check_database_caution(state)
            results["databases-not-listed-names"] = check_database_names(state, DATABASE_NOT_LISTED_RECORD)
        if label == "desktop" and open_record(DATABASE_CALCULATED_RECORD):
            # A kcat/Km CatLog calculated is said last, after the compared values, their notes and the caution line a
            # Different number brings, with no square (an empty one read as a box to tick).
            state = driver.execute_script(DATABASE_SECTION_STATE)
            sequence = state["sequence"]
            assert "calculated" in sequence and "note" in sequence, sequence
            assert sequence[-1] == "calculated" and sequence.count("calculated") == 1, sequence
            check_database_caution(state)
            if state["cautions"]:
                assert sequence[sequence.index("caution") - 1] == "note" and sequence.count("caution") == 1, sequence
            assert state["calculatedMarks"] == 0, "The calculated kcat/Km line carries a square"
            results["databases-calculated-last"] = True
        if open_record(DATABASE_PAPER_NOTE_RECORD):
            state = driver.execute_script(DATABASE_SECTION_STATE)
            assert state["box"].startswith("Across this paper: "), state["box"]
            assert state["sideways"] <= 1, f"The paper's note scrolls sideways at {width}px"
            if state["boxLink"]:
                # The records of this paper that correct a value, in Browse.
                assert "db=corrects" in state["boxLink"] and re.search(r"q=(?:pmid|doi):", state["boxLink"]), state["boxLink"]
                if label == "desktop":
                    link = driver.find_element(By.CSS_SELECTOR, "#detailContent .cmp-paper-note a")
                    driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", link)
                    link.click()
                    wait.until(lambda d: "db=corrects" in d.execute_script("return location.hash")
                               and d.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")
                               and not d.find_elements(By.CSS_SELECTOR, "#recordsBody tr.skeleton-row"))
                    results["databases-paper-note-link"] = True
            results[f"databases-paper-note-{label}"] = True
        if open_record(EARLIER_CORRECTIONS_RECORD):
            state = driver.execute_script(DATABASE_SECTION_STATE)
            assert state["intro"] in EARLIER_CORRECTIONS_INTRO, state["intro"]
            assert ["0.5467 mM⁻¹ s⁻¹", "As stored: 0.546667"] in state["stored"], state["stored"]
            # A database is named for the value before only when its number is that value (catlog-v2 export_site._listed,
            # 2026-10-14): a rounding correction whose database lists the corrected number reads as the earlier version's value.
            assert any(re.match(r"Before: (as \S.* lists it for this paper|the earlier version’s value)", x) for x in state["before"]), state["before"]
            assert state["sideways"] <= 1, f"The earlier corrections scroll sideways at {width}px"
            results[f"databases-earlier-{label}"] = True
    # The longest result wraps inside its note: the record never scrolls sideways on a 320 or 375px phone, and no result
    # ends past its note (the page's own overflow check cannot see an overflow inside the panel).
    for width in ((320, 375) if browser == "chrome" else ()):
        set_browse_viewport(driver, browser, width, 800)
        if not open_record(EXACT_FACTOR_RECORD):
            break
        fit = driver.execute_script("""
            const panel = document.getElementById('detailPanel');
            const results = [...panel.querySelectorAll('.cmp-note .cmp-result')].map(e => {
                const note = e.closest('.cmp-note').getBoundingClientRect();
                return [e.textContent.trim(), Math.round(e.getBoundingClientRect().right - note.right)];
            });
            return {sideways: panel.scrollWidth - panel.clientWidth, results};""")
        assert fit["sideways"] <= 1 and fit["results"] and all(past <= 1 for _, past in fit["results"]), \
            f"A database result runs past the record at {width}px: {fit}"
        results[f"databases-result-fits-{width}"] = True
    set_browse_viewport(driver, browser, 1440, 1000)
    return results


def check_record_marks_and_paper_link(driver, browser, base, wait):
    """A record a human reviewer checked shows a green check after each of its values, named "approved by a human
    reviewer", and one line under the table saying what it means (the numbers still end at the same place); its Paper
    section's In CatLog link opens Browse at the paper's records with the record kept open (on a phone, where the record
    covers the list, with the record closed; Back opens it again); Back after a link in a record opens it where it was
    left; the record's ‹ and › step to the record before or after it in the results, across the table's pages."""
    results = {}
    keys = driver.execute_async_script("""
        const done = arguments[arguments.length - 1];
        const app = document.querySelector('script[src*="catlog-static.js"]');
        const url = new URL('../data/human-review-marks.json', app.src);
        fetch(url).then(r => r.json()).then(d => done(Object.entries(d.marks || {})
            .filter(([, mark]) => mark && mark.checked === true).map(([key]) => key).slice(0, 12))).catch(() => done([]));
    """) or []
    for key in keys:
        driver.get("about:blank")
        driver.get(base + f"#record={key}")
        wait.until(lambda d: d.execute_script(
            "return Boolean(document.querySelector('#detailContent .values-section') && !document.querySelector('#detailLoadStatus'))"
            " || Boolean(document.querySelector('#recordsBody .empty-notice'))"))
        if not driver.find_elements(By.CSS_SELECTOR, "#detailContent .values-section"):
            continue
        # The marks may arrive after the record: it is redrawn in place.
        wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, "#detailContent .values-table .value-approved[role='img']"))
        marks = driver.execute_script("""
            const table = document.querySelector('#detailContent .values-table');
            const checks = [...table.querySelectorAll('.value-approved[role="img"]')];
            const key = document.querySelector('#detailContent .value-notes .value-approved-key');
            const panel = document.getElementById('detailPanel');
            return {names: checks.map(e => e.getAttribute('title')),
                    labels: checks.filter(e => e.hasAttribute('aria-label')).length,
                    colour: checks.length ? getComputedStyle(checks[0]).color : null,
                    legend: key ? key.closest('li').innerText.trim() : null,
                    edges: [...table.querySelectorAll('.vt-number')].map(e => Math.round(e.getBoundingClientRect().right)),
                    sideways: panel.scrollWidth - panel.clientWidth};
        """)
        # Named by its tooltip alone (role img): a title beside an aria-label is read out again as a description.
        assert marks["names"] and set(marks["names"]) == {"approved by a human reviewer"} and not marks["labels"], marks
        # human-checked's green: the darker shade of BPG green (#007664, round 14)
        assert marks["colour"] == "rgb(0, 118, 100)", marks["colour"]
        assert (marks["legend"] or "").startswith("Approved by a human reviewer"), marks["legend"]
        assert max(marks["edges"]) - min(marks["edges"]) <= 1, f"The Value column's numbers do not line up: {marks['edges']}"
        assert marks["sideways"] <= 1, marks
        results["value-approved-checks"] = True
        # "see Human review below" shows that row of Checks: scrolled into the panel's view and focused.
        review_link = driver.find_elements(By.CSS_SELECTOR, "#detailContent .value-notes .review-row-link")
        if review_link:
            driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", review_link[0])
            review_link[0].click()
            wait.until(lambda d: d.execute_script("""
                const row = document.querySelector('#detailContent .human-review-line');
                const panel = document.getElementById('detailPanel').getBoundingClientRect();
                const box = row && row.getBoundingClientRect();
                return Boolean(box) && document.activeElement === row && box.top >= panel.top - 1 && box.bottom <= panel.bottom + 1;
            """))
            results["review-row-link"] = True
        link = driver.find_elements(By.CSS_SELECTOR, "#detailContent .paper-section a.paper-records-link")
        if link:
            href = urlsplit(link[0].get_attribute("href")).fragment
            assert re.match(r"browse\?q=(?:pmid|doi):\S+&record=" + re.escape(key) + "$", href), href
            count = re.match(r"([\d,]+) records (?:from this paper|in CatLog)", link[0].text)
            query = re.match(r"browse\?q=([^&]+)", href).group(1)
            page_before = driver.find_element(By.ID, "pageLabel").text
            driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", link[0])  # (clear of the sticky header)
            link[0].click()
            wait.until(lambda d: d.find_element(By.ID, "globalSearchInput").get_attribute("value") == unquote_plus(query))
            if count:
                wait.until(lambda d: d.find_element(By.ID, "activeSummary").text == f"{count.group(1)} records")
            wait.until(lambda d: d.execute_script("return document.body.classList.contains('detail-open')")
                       and d.find_element(By.ID, "detailRecordKey").text == key)
            # The open record's row is shown, on its page of the paper's records, and Back gives the table its page again.
            selected_key = ("return document.querySelector('#recordsBody tr[aria-selected=\"true\"]')?.dataset.key || ''")
            wait.until(lambda d: d.execute_script(selected_key) == key)
            results["paper-records-link"] = True
            driver.back()
            wait.until(lambda d: urlsplit(d.current_url).fragment == f"record={key}")
            wait.until(lambda d: d.execute_script(selected_key) == key
                       and d.find_element(By.ID, "pageLabel").text == page_before)
            results["paper-records-back"] = True
            # × puts focus on the record's row, or on the results when the page does not show that row: never on the page
            # body.
            driver.find_element(By.ID, "closeDetailButton").click()
            wait.until(lambda d: not d.execute_script("return document.body.classList.contains('detail-open')"))
            focus = driver.execute_script("""
                const active = document.activeElement;
                return {tag: active ? active.tagName : null, id: active ? active.id : null,
                        key: active && active.dataset ? active.dataset.key || null : null,
                        inResults: Boolean(active && active.closest && active.closest('#recordsBody')),
                        shown: [...document.querySelectorAll('#recordsBody tr[data-key]')].map(r => r.dataset.key)};
            """)
            assert focus["tag"] not in (None, "BODY"), focus
            assert focus["id"] == "recordTableWrap" or (focus["inResults"] and focus["tag"] == "TR"), focus
            if key in focus["shown"]:
                assert focus["key"] == key, focus
            results["record-close-focus"] = True
            # On a phone the record covers the list: the link shows the paper's records instead (the record closes and the
            # address names none), and Back opens the record again.
            set_browse_viewport(driver, browser, 390, 844)
            driver.get("about:blank")
            driver.get(base + f"#record={key}")
            wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, "#detailContent .paper-section a.paper-records-link")
                       and d.execute_script("return document.body.classList.contains('detail-open')"))
            phone_link = driver.find_element(By.CSS_SELECTOR, "#detailContent .paper-section a.paper-records-link")
            driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", phone_link)
            phone_link.click()
            wait.until(lambda d: not d.execute_script("return document.body.classList.contains('detail-open')")
                       and d.find_element(By.ID, "globalSearchInput").get_attribute("value") == unquote_plus(query))
            assert "record=" not in urlsplit(driver.current_url).fragment, driver.current_url
            if count:
                wait.until(lambda d: d.find_element(By.ID, "activeSummary").text == f"{count.group(1)} records")
            driver.back()
            wait.until(lambda d: d.execute_script("return document.body.classList.contains('detail-open')")
                       and d.find_element(By.ID, "detailRecordKey").text == key)
            set_browse_viewport(driver, browser, 1440, 1000)
            results["paper-records-link-phone"] = True
        break
    # On a phone a record opened from the list covers it like a screen of its own: Back (the system's Back gesture) closes
    # it and stays in CatLog. On a wide screen × steps back over the record's entry, so Back from the list leaves no
    # closed record behind to step through.
    set_browse_viewport(driver, browser, 390, 844)
    driver.get("about:blank")
    driver.get(base)
    wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")
               and not d.find_elements(By.CSS_SELECTOR, "#recordsBody tr.skeleton-row"))
    first = driver.find_element(By.CSS_SELECTOR, "#recordsBody tr[data-key]")
    opened = first.get_attribute("data-key")
    first.find_element(By.CSS_SELECTOR, ".primary-cell").click()
    wait.until(lambda d: d.execute_script("return document.body.classList.contains('detail-open')")
               and f"record={opened}" in urlsplit(d.current_url).fragment)
    driver.back()
    wait.until(lambda d: not d.execute_script("return document.body.classList.contains('detail-open')"))
    assert urlsplit(driver.current_url).path == urlsplit(base).path, driver.current_url
    assert "record=" not in urlsplit(driver.current_url).fragment, driver.current_url
    assert driver.find_element(By.ID, "catalogView").is_displayed()
    results["record-back-phone"] = True
    set_browse_viewport(driver, browser, 1440, 1000)
    length = driver.execute_script("return history.length")
    cell = driver.find_element(By.CSS_SELECTOR, "#recordsBody tr[data-key] .primary-cell")
    driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", cell)
    cell.click()
    wait.until(lambda d: d.execute_script("return document.body.classList.contains('detail-open')"))
    driver.find_element(By.ID, "closeDetailButton").click()
    wait.until(lambda d: not d.execute_script("return document.body.classList.contains('detail-open')")
               and "record=" not in urlsplit(d.current_url).fragment)
    driver.back()
    wait.until(lambda d: urlsplit(d.current_url).path != urlsplit(base).path)
    assert driver.execute_script("return history.length") == length, "Closing a record left an entry behind"
    results["record-close-history"] = True
    # A link followed from a record (here its Guide link under Checks), then Back: the record opens where it was left,
    # not at its top.
    driver.get("about:blank")
    driver.get(base + "#browse?source=paper")
    wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")
               and not d.find_elements(By.CSS_SELECTOR, "#recordsBody tr.skeleton-row"))
    first = driver.find_element(By.CSS_SELECTOR, "#recordsBody tr[data-key]")
    opened = first.get_attribute("data-key")
    first.find_element(By.CSS_SELECTOR, ".primary-cell").click()
    wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, "#detailContent .checks-section a.method-link")
               and not d.find_elements(By.ID, "detailLoadStatus"))
    method_link = driver.find_element(By.CSS_SELECTOR, "#detailContent .checks-section a.method-link")
    driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", method_link)
    left_at = driver.execute_script("return document.getElementById('detailPanel').scrollTop")
    assert left_at > 0, "The record did not scroll"
    method_link.click()
    wait.until(lambda d: d.execute_script("return document.body.classList.contains('guide-open')"))
    driver.back()
    wait.until(lambda d: d.execute_script(
        "return document.body.classList.contains('detail-open') && !document.querySelector('#detailLoadStatus')"
        " && document.querySelector('#detailRecordKey')?.textContent === arguments[0]"
        " && Math.abs(document.getElementById('detailPanel').scrollTop - arguments[1]) <= 2", opened, left_at))
    results["record-back-scroll"] = True
    # The record's ‹ and › open the record before or after it in the results: from the last row of a page, › opens the
    # next page's first row and turns the table to that page, keeping the focus on › and adding no history entry; ‹ at the
    # first record is disabled. On a phone they step through the cards without closing the record.
    set_browse_viewport(driver, browser, 1440, 1000)
    driver.get("about:blank")
    driver.get(base)
    wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")) >= 2
               and not d.find_elements(By.CSS_SELECTOR, "#recordsBody tr.skeleton-row"))
    wait.until(lambda d: d.execute_script("return !document.getElementById('nextButton').disabled"))
    page_one = driver.execute_script("return [...document.querySelectorAll('#recordsBody tr[data-key]')].map(r => r.dataset.key)")
    last_row = driver.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key] .primary-cell")[-1]
    driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", last_row)
    last_row.click()
    loaded = ("return document.body.classList.contains('detail-open') && !document.querySelector('#detailLoadStatus')"
              " && document.querySelector('#detailRecordKey')?.textContent === arguments[0]")
    wait.until(lambda d: d.execute_script(loaded, page_one[-1]))
    length = driver.execute_script("return history.length")
    assert driver.find_element(By.ID, "previousRecordButton").is_enabled()
    driver.find_element(By.ID, "nextRecordButton").click()
    wait.until(lambda d: d.execute_script("return [...document.querySelectorAll('#recordsBody tr[data-key]')].every(r => !arguments[0].includes(r.dataset.key))", page_one))
    page_two_first = driver.execute_script("return document.querySelector('#recordsBody tr[data-key]').dataset.key")
    wait.until(lambda d: d.execute_script(loaded, page_two_first))
    stepped = driver.execute_script("""
        return {focus: document.activeElement && document.activeElement.id, hash: location.hash};
    """)
    assert stepped["focus"] == "nextRecordButton", stepped
    assert f"record={page_two_first}" in stepped["hash"], stepped
    assert driver.execute_script("return history.length") == length, "A step added a history entry"
    driver.find_element(By.ID, "previousRecordButton").click()
    wait.until(lambda d: d.execute_script(loaded, page_one[-1]))
    wait.until(lambda d: d.execute_script("return document.querySelector('#recordsBody tr[data-key]').dataset.key === arguments[0]", page_one[0]))
    driver.find_element(By.ID, "closeDetailButton").click()
    wait.until(lambda d: not d.execute_script("return document.body.classList.contains('detail-open')"))
    first_row = driver.find_element(By.CSS_SELECTOR, "#recordsBody tr[data-key] .primary-cell")
    driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", first_row)
    first_row.click()
    wait.until(lambda d: d.execute_script(loaded, page_one[0]))
    assert not driver.find_element(By.ID, "previousRecordButton").is_enabled(), "The first record has no previous one"
    results["record-steps"] = True
    set_browse_viewport(driver, browser, 390, 844)
    driver.get("about:blank")
    driver.get(base + f"#record={page_one[0]}")
    wait.until(lambda d: d.execute_script(loaded, page_one[0]))
    wait.until(lambda d: d.find_element(By.ID, "nextRecordButton").is_enabled())
    header = driver.execute_script("""
        const title = document.querySelector('#detailContent .detail-title').getBoundingClientRect();
        const buttons = [...document.querySelectorAll('#detailContent .detail-title-buttons button')].map(b => b.getBoundingClientRect());
        // (on a phone the name runs under the buttons after its first lines: its text, not its box, keeps clear of them)
        const range = document.createRange();
        range.selectNodeContents(document.getElementById('detailHeading'));
        const lines = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
        const clear = (l, b) => l.right <= b.left + 1 || l.left >= b.right - 1 || l.bottom <= b.top + 1 || l.top >= b.bottom - 1;
        return {apart: lines.length > 0 && buttons.every(b => lines.every(l => clear(l, b))), inside: buttons.every(b => b.right <= innerWidth && b.top >= title.top - 1),
                sideways: document.getElementById('detailPanel').scrollWidth - document.getElementById('detailPanel').clientWidth,
                targets: buttons.map(b => [Math.round(b.width), Math.round(b.height)]), closeGap: Math.round(buttons[2].left - buttons[1].right)};
    """)
    assert header["apart"] and header["inside"] and header["sideways"] <= 1, f"The record's ‹ › × overlap its name: {header}"
    # On a phone ‹ › × are 44px targets and × stands 8px from ›, so a near miss on › never closes the record.
    assert all(min(target) >= 44 for target in header["targets"]) and header["closeGap"] >= 8, (
        f"The record's ‹ › × are 44px targets with 8px before × on a phone: {header}")
    driver.find_element(By.ID, "nextRecordButton").click()
    wait.until(lambda d: d.execute_script(loaded, page_one[1]))
    assert driver.execute_script("return document.body.classList.contains('detail-open')")
    set_browse_viewport(driver, browser, 1440, 1000)
    results["record-steps-phone"] = True
    return results


def check(driver, browser, url):
    wait = WebDriverWait(driver, 120, ignored_exceptions=(StaleElementReferenceException,))
    expected_query = parse_qsl(urlsplit(url).query, keep_blank_values=True)
    driver.set_window_size(1440, 1000)
    driver.get(url + ("&" if "?" in url else "?") + "release=link-check#stats")
    wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".stats-status-section tr[data-stat-key]")) >= 5)
    wait.until(lambda d: parse_qsl(urlsplit(d.current_url).query, keep_blank_values=True) == expected_query)
    stats_path = urlsplit(url).path.replace("catlog-latest.html", "catlog-stats.html")
    assert urlsplit(driver.current_url).path == stats_path
    assert not urlsplit(driver.current_url).fragment

    def check_metadata(view):
        expected_path = stats_path if view == "stats" else urlsplit(url).path
        expected_url = urljoin(url, expected_path)
        assert driver.find_element(By.CSS_SELECTOR, 'link[rel="canonical"]').get_attribute("href") == expected_url
        assert driver.find_element(By.CSS_SELECTOR, 'meta[property="og:url"]').get_attribute("content") == expected_url
        assert driver.find_element(By.CSS_SELECTOR, 'meta[property="og:title"]').get_attribute("content") == driver.title

    check_metadata("stats")
    for view in ("browse", "guide", "stats", "team"):
        link = driver.find_element(By.ID, view + "Button")
        reported_tag = link.tag_name
        print(f"{browser} {view} link tag: {reported_tag!r}", flush=True)
        assert reported_tag.lower() == "a", f"Expected a navigation link, got {reported_tag!r}"
        target = urlsplit(link.get_attribute("href"))
        assert target.path == (stats_path if view == "stats" else urlsplit(url).path)
        assert parse_qsl(target.query, keep_blank_values=True) == expected_query
        assert target.fragment == (view if view in ("guide", "team") else "")
    # The catalog's own tabs (Browse · Stats · Guide · Team), then the links out apart at the right.
    assert [link.text for link in driver.find_elements(By.CSS_SELECTOR, ".top-nav a")] == ["Browse", "Stats", "Guide", "Team"]
    assert urlsplit(driver.find_element(By.ID, "teamButton").get_attribute("href")).fragment == "team"
    external = driver.find_elements(By.CSS_SELECTOR, ".external-nav a")
    # long names, or the short ones a narrower window shows (CI's Safari window)
    # (Safari's driver also returns the hidden short or long form, e.g. "CatRange paperPaper ↗": check the words, not the exact text)
    names = [link.text.replace("\u00a0", " ") for link in external]
    assert len(names) == 2 and all(name.endswith("↗") for name in names), names
    assert "aper" in names[0] and "Lab" in names[1], names
    assert external[0].location["x"] > driver.find_element(By.ID, "teamButton").location["x"]
    assets = AssetReferences()
    assets.feed((ROOT / "tools/catlog-stats.html").read_text())
    loaded_urls = driver.execute_script("return [...document.querySelectorAll('script[src], link[href]')].map(e => e.src || e.href)")
    assert len(assets.paths) == 3
    for reference in assets.paths:
        asset_url = urljoin(url, reference)
        assert asset_url in loaded_urls, f"Wrong release asset: {reference}"
        expected_bytes = (ROOT / "tools" / urlsplit(reference).path).read_bytes()
        with urllib.request.urlopen(asset_url, timeout=30) as response:
            assert hashlib.sha256(response.read()).digest() == hashlib.sha256(expected_bytes).digest(), f"Release asset mismatch: {reference}"
    manifest = driver.execute_script("return window.CATLOG_STATIC_MANIFEST")
    expected = {item["label"]: item["count"] for item in manifest["summary"]["distributions"]["verification_status"]}
    total = manifest["total_rows"]
    accepted = expected.get("verified", 0) + expected.get("corrected", 0)
    overview = stats_overview(manifest)
    assert not driver.find_element(By.ID, "globalSearchInput").is_displayed()
    assert driver.find_element(By.ID, "statsButton").get_attribute("aria-current") == "page"
    assert not driver.execute_script(
        "return performance.getEntriesByType('resource').some(e => /catlog-viewer-index|catlog-table|details-\\d+|human-review-marks/.test(e.name))"
    ), "Stats must not download the record index, detail shards or review marks"

    def stat_rows(selector):
        return {row.get_attribute("data-stat-key"): int(row.get_attribute("data-count"))
                for row in driver.find_elements(By.CSS_SELECTOR, selector)}

    # Review result: each record once; Not checked groups Unverified and Not reviewed, as Browse does.
    status_rows = stat_rows(".stats-status-section tr[data-stat-key]:not(.stats-row-group)")
    assert sum(status_rows.values()) == total, "Status rows must add up to all records"
    assert status_rows["accepted"] == accepted
    assert status_rows["manual_review_required"] == expected.get("manual_review_required", 0)
    for key in ("unverified", "mathematically_inferred", "disputed"):
        assert status_rows[key] == expected.get(key, 0)
    group = driver.find_element(By.CSS_SELECTOR, '.stats-status-section tr.stats-row-group[data-stat-key="not_verified"]')
    assert int(group.get_attribute("data-count")) == expected.get("unverified", 0) + expected.get("mathematically_inferred", 0)
    assert "Not checked" in group.text and "Other records" not in driver.find_element(By.CLASS_NAME, "stats-status-section").text
    pending_row = driver.find_element(By.CSS_SELECTOR, '.stats-status-section [data-stat-key="manual_review_required"]')
    assert "Not confirmed" in pending_row.text and "Checks pending" not in pending_row.text
    accepted_row = driver.find_element(By.CSS_SELECTOR, '.stats-status-section [data-stat-key="accepted"]')
    assert f"{accepted / total * 100:.1f}%" in accepted_row.text
    # Accepted is split in the rows under it; the row's title says the split in words.
    accepted_split = accepted_row.get_attribute("title") or ""
    assert f"{expected.get('corrected', 0):,} after a correction" in accepted_split
    detail_rows = {row.get_attribute("data-part"): int(row.get_attribute("data-count"))
                   for row in driver.find_elements(By.CSS_SELECTOR, ".stats-status-section tr[data-part]")}
    assert sum(detail_rows.values()) == accepted, f"Accepted's parts add up to Accepted: {detail_rows}"
    # The bar: one segment per review result with records, in the snapshot's numbers (fix pass after round 16b: no donut).
    donut = driver.find_element(By.CSS_SELECTOR, ".stats-status-section .stats-status-bar")
    assert donut.get_attribute("role") == "img" and f"{total:,} records" in donut.get_attribute("aria-label")
    # Its segments say the review result's word, as the record does: Not checked (Unverified), Not checked (Not reviewed).
    for key, word in (("unverified", "Unverified"), ("mathematically_inferred", "Not reviewed")):
        if expected.get(key, 0):
            assert f"Not checked ({word}) {expected[key]:,}" in donut.get_attribute("aria-label"), donut.get_attribute("aria-label")
    assert len(donut.find_elements(By.CSS_SELECTOR, ".stats-seg")) == sum(1 for key in ("manual_review_required", "unverified",
        "mathematically_inferred", "disputed") if expected.get(key, 0)) + bool(accepted)
    if overview:
        # Accepted splits into the records read from the paper by CatLog and those not yet re-read.
        read = overview["from_paper"]["records"]
        assert f"{read:,} read from the paper; {accepted - read:,} not yet re-read" in accepted_split
        # records accepted on a human review (accepted_basis "human review") are named apart from "as printed"
        human = {item["label"]: item["count"] for item in manifest["summary"]["distributions"].get("accepted_basis", [])}.get("human review", 0)
        assert f"({expected.get('verified', 0) - read - human:,} as printed" in accepted_split
        assert detail_rows.get("accepted_catlog") == read
    else:
        assert f"{expected.get('verified', 0):,}" in accepted_split
    identity_only = {item["label"]: item["count"] for item in manifest["summary"]["distributions"].get("public_trust_basis", [])}.get("identity_only", 0)
    if identity_only:
        # since 2026-10-12 (D1) records with no PMID or DOI are not accepted; Stats still names them, once (round 14): in
        # the Not reviewed row's definition (its title: the legend shows names only) under the review rules, else in the
        # note under the figure
        status_text = " ".join((driver.find_element(By.CLASS_NAME, "stats-status-section").text + " " + " ".join(
            row.get_attribute("title") or "" for row in driver.find_elements(By.CSS_SELECTOR, ".stats-status-section tr[title]"))).split())
        assert (f"({identity_only:,} of them the earlier review had accepted)" in status_text
                or f"{identity_only:,} accepted records have no PMID or DOI linked" in status_text), status_text
        assert status_text.count("the earlier review had accepted") + status_text.count("accepted records have no PMID") == 1, \
            "Stats names the records without a paper once"

    # Every Stats link opens Browse with the shared #browse? filters.
    links = driver.find_elements(By.CSS_SELECTOR, "#statsCharts a.stats-link")
    assert links, "Stats links into Browse"
    for link in links:
        target = urlsplit(link.get_attribute("href"))
        assert target.path == urlsplit(url).path, f"Stats links open Browse: {target.path}"
        assert target.fragment.startswith("browse?"), target.fragment
        params = parse_qsl(target.fragment[len("browse?"):], keep_blank_values=True)
        assert params and {key for key, _value in params} <= STATS_LINK_KEYS, f"Unknown Browse filter: {params}"
        assert all(value in STATS_DATABASE_LINK_VALUES[key] for key, value in params if key in STATS_DATABASE_LINK_VALUES), params
    hrefs = [link.get_attribute("href") for link in links]
    fragments = ["#browse?status=accepted", "#browse?status=curation_pending", "#browse?status=not_verified"]
    if expected.get("disputed", 0):
        fragments.append("#browse?status=disputed")
    for fragment in fragments:
        assert any(href.endswith(fragment) for href in hrefs), f"Missing Stats link {fragment}"

    # Main source: counted as the Browse source filter finds records (a record merged from several databases counts
    # under each), so every record is counted at least once; the Guide's source list gives the same numbers.
    source_rows = stat_rows(".stats-section[aria-labelledby='statsSourcesTitle'] .stats-by-database li[data-stat-key]")
    if source_rows:
        assert sum(source_rows.values()) >= total and max(source_rows.values()) <= total, "Main-source rows must cover all records"
        if overview:
            listed = {("paper" if item.get("key") == "primary_paper_direct" else item.get("key")): item.get("row_count")
                      for item in manifest.get("source_databases") or []}
            for key, count in source_rows.items():
                if isinstance(listed.get(key[len("source_"):]), int):
                    assert count == listed[key[len("source_"):]], f"Stats and the Guide count {key} differently"

    # The headline band has no glow, halo or wash, on screen or on paper, and its numbers never move.
    assert driver.execute_script(STATS_BAND_GLOW_JS) == {"halo": False, "crisp": True, "card": False}, driver.execute_script(STATS_BAND_GLOW_JS)
    WebDriverWait(driver, 5).until(lambda d: d.execute_script(
        "return !document.querySelector('#statsTotals > .stats-band').classList.contains('is-entering')"))
    if browser == "chrome":
        driver.execute_cdp_cmd("Emulation.setEmulatedMedia", {"media": "print"})
        try:
            assert driver.execute_script(STATS_BAND_GLOW_JS) == {"halo": False, "crisp": True, "card": False}
        finally:
            driver.execute_cdp_cmd("Emulation.setEmulatedMedia", {"media": ""})
        driver.execute_cdp_cmd("Emulation.setEmulatedMedia", {"media": "", "features": [{"name": "prefers-reduced-motion", "value": "reduce"}]})
        try:
            assert driver.execute_script(STATS_BAND_RISE_JS) == "none"
        finally:
            driver.execute_cdp_cmd("Emulation.setEmulatedMedia", {"media": "", "features": []})
        assert driver.execute_script(STATS_BAND_RISE_JS) == "none"

    # The overview, when this snapshot has one; otherwise no section or headline without its numbers.
    headline = driver.find_element(By.ID, "statsTotals").text
    stats_text = driver.find_element(By.ID, "statsCharts").get_attribute("textContent")
    if overview:
        human = overview.get("human_checked_accepted")
        if human is not None:
            # Human-checked is a row of Quality's checks table, its count linked to those records.
            card = driver.find_element(By.CSS_SELECTOR, "[data-check='human_checked']")
            assert card.find_element(By.CSS_SELECTOR, ".stats-check-result a").get_attribute("innerText").strip() == f"{human:,}"
            assert any(href.endswith("#browse?checked=1") for href in hrefs)
        assert f"{overview['from_paper']['records']:,}" in headline and f"from {overview['from_paper']['papers']:,} papers" in headline
        assert any(href.endswith("#browse?source=paper") for href in hrefs)
        # The band's key numbers link into Browse: Accepted and Read from the paper.
        band_links = {item.get_attribute("data-total"): urlsplit(item.find_element(By.CSS_SELECTOR, "a.stats-total-value").get_attribute("href")).fragment
                      for item in driver.find_elements(By.CSS_SELECTOR, ".stats-totals-main .stats-total") if item.find_elements(By.CSS_SELECTOR, "a")}
        assert band_links.get("accepted") == "browse?status=accepted" and band_links.get("catlog") == "browse?source=paper", band_links
        if browser == "chrome":
            # Under the pointer the flat tint darkens the item: its label and note step up to --text-2
            # (muted there measured 4.46:1), and go back once the pointer leaves.
            link = driver.find_element(By.CSS_SELECTOR, ".stats-total[data-total='accepted'] a.stats-total-value")
            driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", link)
            x, y = driver.execute_script("const r = arguments[0].getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]", link)
            label_colors = "return [...document.querySelectorAll(\".stats-total[data-total='accepted'] :is(dt, dd small)\")].map(e => getComputedStyle(e).color)"
            text_2 = driver.execute_script("const p = document.createElement('i'); p.style.color = 'var(--text-2)'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c")
            driver.execute_cdp_cmd("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y})
            try:
                hovered = driver.execute_script(label_colors)
                assert hovered and all(color == text_2 for color in hovered), (hovered, text_2)
            finally:
                driver.execute_cdp_cmd("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": 1, "y": 1})
            assert all(color != text_2 for color in driver.execute_script(label_colors)), driver.execute_script(label_colors)
        # Numbered parts in order, from the band's 1, then the supplement (S) last.
        parts = [heading.get_attribute("innerText").strip().split("\n") for heading in driver.find_elements(By.CSS_SELECTOR, ".stats-part-title")]
        labels = [number for number, *_rest in parts]
        numbered = [number for number in labels if number != "S"]
        assert [int(number) for number in numbered] == list(range(1, len(numbered) + 1)), parts
        assert labels.count("S") <= 1 and ("S" not in labels or labels[-1] == "S"), parts
        check_stats_more(driver, browser, overview, total)
        forms = stat_rows(".stats-section[aria-labelledby='statsFormTitle'] tr[data-stat-key]")
        assert sum(forms.values()) == total and forms == {key: overview["enzyme_form"][key] for key in ("wild", "variant", "not_stated")}
        classes = stat_rows(".stats-section[aria-labelledby='statsClassesTitle'] [data-stat-key]")
        assert classes == {f"ec_{item['class']}": item["count"] for item in overview["ec_classes"]}
        # Each record is in one class, in none or in several, and one in several counts in each of them (two to seven):
        # the class bars exceed the records with a class by at least one and at most six per record in several.
        none, several = overview.get("ec_class_none"), overview.get("ec_class_multiple")
        if isinstance(none, int) and isinstance(several, int) and classes:
            extra = sum(classes.values()) - (total - none)
            assert several <= extra <= 6 * several, (sum(classes.values()), none, several, total)
        cautions = stat_rows(".stats-section[aria-labelledby='statsCautionsTitle'] tr[data-stat-key]")
        # Figure 2: each record once under its main source (its bars add up to all records).
        main_rows = {row.get_attribute("data-row"): int(row.get_attribute("data-count"))
                     for row in driver.find_elements(By.CSS_SELECTOR, ".stats-section[aria-labelledby='statsSourcesTitle'] .stats-chart-row")}
        assert sum(main_rows.values()) == total, f"Main sources add up to all records: {main_rows}"
        # The lead: the human review comes first, when the snapshot has its counts (never the dropped wording).
        lead_share = review_headline(overview.get("quality") or {})
        if lead_share:
            lead = driver.find_element(By.CSS_SELECTOR, "#statsCharts .stats-lead")
            assert driver.execute_script(LEAD_FIRST_JS), "The human review leads Quality, right after the headline band"
            # (the share itself is At a glance's: Quality does not repeat it as a big number)
            band = driver.find_element(By.CSS_SELECTOR, ".stats-total[data-total='review'] .stats-total-value").get_attribute("innerText").strip()
            assert band == lead_share and not lead.find_elements(By.CSS_SELECTOR, ".stats-lead-figure"), band
            for word in DROPPED_WORDING:
                assert word not in lead.get_attribute("innerText"), f"The lead says {word}"
        assert cautions == {f"caution_{key}": count for key, count in overview["cautions"].items()}
        # (the value-range figures only: the variant-effect, assay-condition and round 16 wild-type panels reuse .stats-range)
        ranges = driver.find_elements(By.CSS_SELECTOR, ".stats-range:not(.stats-fold):not(.stats-condition):not(.stats-insight)")
        assert len(ranges) == sum(1 for summary in overview["metrics"].values() if summary.get("n"))
        for figure in ranges:
            summary = overview["metrics"][figure.get_attribute("data-metric")]
            assert int(figure.get_attribute("data-count")) == summary["n"] == sum(summary["counts"])
            # On the axis it shares with Values by enzyme class, the bars beyond it join the end bars: a bar per decade
            # of that axis, still holding every value.
            axis = stats_value_axis(summary)
            bars = figure.find_elements(By.CSS_SELECTOR, ".stats-histogram-bars > span")
            assert len(bars) == (axis[1] - axis[0] if axis else len(summary["counts"]))
            assert sum(int(re.search(r": ([\d,]+) values$", bar.get_attribute("data-tip")).group(1).replace(",", "")) for bar in bars) == summary["n"]
            assert figure.find_element(By.CSS_SELECTOR, ".stats-histogram").get_attribute("aria-label").startswith(("kcat", "Km"))
    else:
        assert "Human-checked" not in headline and "Read from the paper" not in headline
        assert not driver.find_elements(By.CSS_SELECTOR, ".stats-range")
    for heading in driver.find_elements(By.CSS_SELECTOR, "#statsCharts h2, #statsCharts h3"):
        section = heading.find_element(By.XPATH, "..")
        # (a table counts: Quality's checks are a table since round 14)
        assert section.find_elements(By.CSS_SELECTOR, "li, figure, p, table tbody tr"), f"Empty Stats section: {heading.text}"
    # Figures and tables are numbered in reading order, each with one caption and no data line: the snapshot, its Data ID
    # and the counting rules are said once, in How these numbers are counted, which closes the page.
    assert not driver.find_elements(By.CSS_SELECTOR, "#statsCharts .stats-fig-data")
    provenance = driver.execute_script("""
        const method = document.querySelector('#statsCharts > details.stats-method:last-child');
        const row = method && [...method.querySelectorAll('dl > div')].find((item) => item.querySelector('dt')?.textContent === 'Snapshot');
        return {text: row ? row.querySelector('dd').textContent : null,
                ids: (document.getElementById('statsView').textContent.match(/Data ID/g) || []).length};
    """)
    assert provenance["ids"] == 1 and re.search(r"Data ID [0-9a-f]{10}\. Counted from this snapshot’s Full data download",
                                                provenance["text"] or ""), provenance
    # Paper and PDF: the closed section prints open (its Data ID and rules), then closes again.
    printed = driver.execute_script("""
        const method = document.querySelector('#statsCharts > details.stats-method');
        const before = method.open;
        window.dispatchEvent(new Event('beforeprint'));
        const during = method.open;
        window.dispatchEvent(new Event('afterprint'));
        return [before, during, method.open];
    """)
    assert printed == [False, True, False], printed
    captions_text = " ".join(driver.execute_script("return [...document.querySelectorAll('.stats-fig > figcaption .stats-fig-caption')].map(e => e.textContent)"))
    for kind in ("Figure", "Table"):
        for series in ("", "S"):
            numbers = [int(match) for match in re.findall(kind + " " + series + r"(\d+)\.", captions_text)]
            assert numbers == list(range(1, len(numbers) + 1)), f"{kind} {series} numbers: {numbers}"
    # The supplement: each item's number in its summary is its caption's, and its address names it (#stats-s3 for
    # Figure S3, #stats-table-s2 for Table S2).
    items = driver.execute_script("""return [...document.querySelectorAll('#statsCharts .stats-supp-item')].map((item) => [item.id,
        item.querySelector('summary .stats-supp-number').textContent, item.querySelector('figcaption strong').textContent])""")
    for identifier, number, caption_number in items:
        kind, _space, label = number.partition(" ")
        assert caption_number == f"{number}." and identifier == ("stats-table-" if kind == "Table" else "stats-") + label.lower(), (identifier, number, caption_number)
    # An item a visitor opens puts its own address in the address bar (round 14: an open item can be copied and sent);
    # closing it gives back the address from before. (Its summary is centred before the click, for Safari.)
    if items:
        address = driver.execute_script("return location.href")
        before = driver.execute_script("return location.hash")
        summary = driver.find_element(By.CSS_SELECTOR, f"#{items[-1][0]} > summary")
        was_open = driver.execute_script("return arguments[0].parentElement.open", summary)
        if was_open:
            driver.execute_script("arguments[0].parentElement.open = false", summary)
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", summary)
        summary.click()
        WebDriverWait(driver, 10).until(lambda d: d.execute_script("return location.hash") == f"#{items[-1][0]}")
        summary.click()
        WebDriverWait(driver, 10).until(lambda d: d.execute_script("return location.hash") == before)
        if was_open:
            driver.execute_script("arguments[0].parentElement.open = true", summary)
        driver.execute_script("history.replaceState(history.state, '', arguments[0])", address)
    # Captions in plain words: no filler about where the numbers stand, never "in all", no stacked semicolons.
    for caption in driver.execute_script("return [...document.querySelectorAll('.stats-fig > figcaption .stats-fig-caption')].map(e => e.textContent)"):
        assert not re.search(r"\bin all\b|each label gives|beside each bar|Numbers compared for the same paper", caption) and caption.count(";") <= 1, caption
    assert "Not saved" not in stats_text and "tokens" not in stats_text.lower()
    for removed in ("not split by field", "How these groups differ", "Example checks", "Fields in these records"):
        assert removed not in stats_text, f"Removed Stats text is back: {removed}"
    # (no ring charts; the kcat against Km figure marks its class medians with small circles)
    assert not driver.execute_script("""return [...document.querySelectorAll('.stats-nested-ring, .stats-review-ring, .stats-material-section, #statsCharts svg circle')]
        .filter(e => !e.closest("[data-figure='kcat-km']")).length""")
    details = manifest["summary"].get("review_details")
    if details and details.get("download_sha256") == manifest.get("enriched_download", {}).get("sha256") \
            and details.get("source_sha256") == manifest.get("source_sha256"):
        for cohort, group_counts in details["groups"].items():
            for field in ("with_kinetic_value", "with_literature_id", "with_sequence", "with_smiles"):
                cells = driver.find_elements(By.CSS_SELECTOR, f'.stats-unaccepted-fields tr[data-field="{field}"] td[data-cohort="{cohort}"]')
                if cells:
                    assert int(cells[0].get_attribute("data-count")) == group_counts[field]

    viewports = {}

    def check_panel_width():
        assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth + 1"), "Horizontal page overflow"
        assert driver.execute_script("const p=document.querySelector('#statsView'); return p.scrollWidth <= p.clientWidth + 1"), "Horizontal overflow inside Stats"

    def capture(label):
        assert driver.execute_script("return parseFloat(getComputedStyle(document.querySelector('#statsDate')).fontSize)") >= 14
        assert driver.execute_script("""
            return [...document.querySelectorAll('#statsView .stats-explanation > summary')]
                .every(e => e.getBoundingClientRect().height >= 36);
        """), "Stats disclosures need a usable click target"
        assert driver.execute_script("""
            return [...document.querySelectorAll('#statsCharts .stats-table')].every(table => {
                const head = table.querySelector('thead tr'), row = table.querySelector('tbody tr:not(.stats-row-detail)');
                if (!table.getBoundingClientRect().width || !head || !row) return true;
                return [...head.children].every((cell, i) => !cell.classList.contains('stats-num') || !row.children[i]
                    || Math.abs(cell.getBoundingClientRect().right - row.children[i].getBoundingClientRect().right) <= 1);
            });
        """), "Stats count headings must align with their values"
        assert driver.execute_script("""
            return [...document.querySelectorAll('#statsCharts .stats-table tbody tr:not(.stats-row-detail) th, #statsCharts .stats-chart-label, .stats-fig-caption')]
                .every(cell => parseFloat(getComputedStyle(cell).fontSize) >= 12.9);
        """), "Stats labels and captions keep 13px"
        assert driver.execute_script("""
            const size = (selector) => parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
            return size('.stats-totals-main dd') >= (innerWidth <= 1199 ? 28 : 40) && size('.stats-totals-scope dd') >= (innerWidth <= 640 ? 18 : 20);
        """), "Stats headline numbers keep the type scale"
        viewports[label] = driver.execute_script("""
            const page = document.scrollingElement, stats = document.querySelector('#statsView');
            return {width: innerWidth, height: innerHeight,
                document_scrolls: page.scrollHeight > page.clientHeight + 1,
                stats_scrolls: stats.scrollHeight > stats.clientHeight + 1};
        """)
        assert not (viewports[label]["document_scrolls"] and viewports[label]["stats_scrolls"]), "Nested vertical page scrolling"
        assert_document_stays(driver, f"Stats ({label})")
        check_panel_width()
        overflow = driver.execute_script("""
            return [...document.querySelectorAll('.stats-chart-label, .stats-chart-value, .stats-table .stats-num, .stats-totals dd, .stats-range-numbers dd')]
                .filter(e => e.getBoundingClientRect().width && e.scrollWidth > e.clientWidth + 1)
                .map(e => e.textContent);
        """)
        assert not overflow, f"Clipped Stats text: {overflow}"
        driver.save_screenshot(str(OUTPUT / f"{browser}-{label}.png"))

    capture("stats-desktop")
    driver.execute_script("document.querySelector('#statsView').scrollTop=0")
    for element in driver.find_elements(By.CSS_SELECTOR, "#statsView details > summary"):
        # a disclosure inside a closed supplement item (Table S1's Sequence fields) shows once its item is open
        driver.execute_script("const item = arguments[0].parentElement.parentElement?.closest('.stats-supp-item'); if (item) item.open = true;", element)
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", element)
        parent = element.find_element(By.XPATH, "..")
        was_open = parent.get_attribute("open") is not None
        toggled = WebDriverWait(driver, 10)
        element.click()
        toggled.until(lambda _d: (parent.get_attribute("open") is not None) != was_open)
        check_panel_width()
        element.click()
        toggled.until(lambda _d: (parent.get_attribute("open") is not None) == was_open)
    driver.execute_script("window.scrollTo(0, 0)")
    driver.find_element(By.ID, "downloadMenu").find_element(By.TAG_NAME, "summary").click()
    comparison_download = driver.execute_script("return window.CATLOG_STATIC_MANIFEST.database_comparison_download?.path || null")
    for identifier in ("enrichedDataButton", "exportSnapshotButton", *(["comparisonDataButton"] if comparison_download else [])):
        link = driver.find_element(By.ID, identifier)
        assert link.is_displayed()
        with urllib.request.urlopen(urllib.request.Request(link.get_attribute("href"), method="HEAD"), timeout=30) as response:
            assert response.status == 200 and int(response.headers["Content-Length"]) > 1_000_000
    # Without the file in the snapshot the menu has no item for it.
    assert driver.find_element(By.ID, "comparisonDataButton").is_displayed() == bool(comparison_download)
    driver.find_element(By.ID, "downloadMenu").find_element(By.TAG_NAME, "summary").click()

    # A linked Stats count is the number of records its link opens: the most common organism (with its strains),
    # BRENDA (records merged from several databases count under each), the records read from the paper by CatLog and
    # the earlier paper extractions.
    # (the tables in the supplement are opened first: a closed item's links cannot be clicked)
    open_stats_supplement(driver)
    for selector in (".stats-section[aria-labelledby='statsOrganismsTitle'] tr[data-stat-key]",
                     ".stats-section[aria-labelledby='statsV2OrganismsTitle'] tr[data-stat-key]",
                     ".stats-section[aria-labelledby='statsV2EcTitle'] tr[data-stat-key]",
                     "[data-figure='versions'] .stats-chart-row[data-row='v1']",
                     ".stats-by-database li[data-stat-key='source_brenda']",
                     ".stats-by-database li[data-stat-key='source_catlog']",
                     ".stats-by-database li[data-stat-key='source_paper_earlier']",
                     ".stats-by-database li[data-stat-key='source_strenda']",
                     ".stats-by-database li[data-stat-key='source_unrecorded']"):
        found = driver.find_elements(By.CSS_SELECTOR, selector)
        if not found:
            continue
        count = int(found[0].get_attribute("data-count"))
        stat_link = found[0].find_element(By.CSS_SELECTOR, "a.stats-link")
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", stat_link)
        stat_link.click()
        wait.until(lambda d: d.find_element(By.ID, "activeSummary").text == f"{count:,} records")
        driver.back()
        wait.until(lambda d: d.find_element(By.ID, "statsView").is_displayed()
                   and len(d.find_elements(By.CSS_SELECTOR, ".stats-status-section tr[data-stat-key]")) >= 5)

    # A Stats link opens Browse; Back returns to Stats.
    pending_link = driver.find_element(By.CSS_SELECTOR, '.stats-status-section [data-stat-key="manual_review_required"] a.stats-link')
    driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", pending_link)
    pending_link.click()
    wait.until(lambda d: d.find_element(By.ID, "catalogView").is_displayed())
    assert urlsplit(driver.current_url).path == urlsplit(url).path
    driver.back()
    wait.until(lambda d: d.find_element(By.ID, "statsView").is_displayed()
               and len(d.find_elements(By.CSS_SELECTOR, ".stats-status-section tr[data-stat-key]")) >= 5)

    # Browse keeps the filters the Stats link set (shown as chips); Clear all shows every record again.
    pending = expected.get("manual_review_required", 0)
    driver.find_element(By.ID, "browseButton").click()
    wait.until(lambda d: urlsplit(d.current_url).fragment == "browse?status=curation_pending"
               and d.find_element(By.ID, "activeSummary").text == f"{pending:,} records")
    driver.find_element(By.CSS_SELECTOR, "#activeFilters [data-filter-clear]").click()
    wait.until(lambda d: d.find_element(By.ID, "activeSummary").text == f"{total:,} records")
    assert not urlsplit(driver.current_url).fragment
    check_metadata("browse")
    assert len(driver.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")) == 25
    # The Stats tab is the one thing that glows (the user, 2026-10-21: "only the Stats button"); the other tabs do not.
    tabs = driver.execute_script("return ['browseButton', 'statsButton', 'guideButton', 'teamButton']"
                                 ".map(id => getComputedStyle(document.getElementById(id)).textShadow)")
    assert tabs[1] != "none" and all(shadow == "none" for index, shadow in enumerate(tabs) if index != 1), tabs
    search = driver.find_element(By.ID, "globalSearchInput")
    search.send_keys("zzzz-no-match-catlog", Keys.TAB)
    # (the whole word applied, not a pass for its first keys: see check_browse)
    wait.until(lambda d: d.find_element(By.ID, "activeSummary").text == "0 records" and d.execute_script(SEARCH_CHIP_JS) == "Search: zzzz-no-match-catlog")
    assert not driver.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")
    for identifier in ("downloadPageButton", "prevButton", "nextButton"):
        assert not driver.find_element(By.ID, identifier).is_enabled()
    driver.find_element(By.ID, "clearResultsButton").click()
    wait.until(lambda d: d.find_element(By.ID, "activeSummary").text == f"{total:,} records")
    assert search.get_attribute("value") == ""
    assert driver.find_element(By.ID, "downloadPageButton").is_enabled()
    search.send_keys("laccase", Keys.TAB)
    assert search.get_attribute("value") == "laccase"
    wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]") and all("laccase" in row.text.lower() for row in d.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")))
    result_count = driver.find_element(By.ID, "activeSummary").text
    driver.find_element(By.ID, "statsButton").click()
    assert urlsplit(driver.current_url).path == stats_path and not urlsplit(driver.current_url).fragment
    check_metadata("stats")
    assert driver.find_element(By.ID, "statsScope").text == f"All {total:,} records in this snapshot. Select a name to see those records in Browse."
    driver.back()
    wait.until(lambda d: d.find_element(By.ID, "catalogView").is_displayed())
    check_metadata("browse")
    assert driver.find_element(By.ID, "activeSummary").text == result_count
    driver.forward()
    wait.until(lambda d: d.find_element(By.ID, "statsView").is_displayed())
    check_metadata("stats")
    driver.find_element(By.ID, "browseButton").click()
    assert driver.find_element(By.ID, "globalSearchInput").get_attribute("value") == "laccase"
    assert driver.find_element(By.ID, "activeSummary").text == result_count
    driver.find_element(By.CSS_SELECTOR, "#recordsBody tr[data-key] .primary-cell").click()
    wait.until(lambda d: d.find_element(By.ID, "downloadSelectedJson").is_displayed())
    assert not driver.find_elements(By.CSS_SELECTOR, ".detail-load-error, #detailLoadStatus")
    assert "laccase" in driver.find_element(By.ID, "detailHeading").text.lower()
    driver.save_screenshot(str(OUTPUT / f"{browser}-browse-detail.png"))
    driver.find_element(By.ID, "closeDetailButton").click()
    driver.find_element(By.ID, "guideButton").click()
    assert driver.find_element(By.ID, "guideView").is_displayed()
    check_metadata("guide")
    check_guide(driver, wait)
    check_metadata("guide")
    driver.find_element(By.ID, "statsButton").click()
    driver.execute_script("window.scrollTo(0, 0)")
    driver.set_window_size(1080, 900)
    capture("stats-compact")
    first_figures = """
        const box = (selector) => document.querySelector(selector).getBoundingClientRect();
        const charts = box('#statsCharts'), status = box('.stats-status-section'), sources = box('.stats-sources-section');
        const bar = box('.stats-status-section .stats-status-bar'), table = box('.stats-status-table');
        return {wide: Math.abs(status.width - charts.width) <= 1 && Math.abs(sources.width - charts.width) <= 1 && sources.top >= status.bottom,
                paired: Math.abs(status.top - sources.top) <= 1 && sources.left >= status.right,
                over: bar.bottom <= table.top && Math.abs(bar.left - table.left) <= 1 && Math.abs(bar.width - table.width) <= 1, bar: [bar.width, bar.height]};
    """
    # 1024-1279px: Figure 1 takes the row (its bar over its legend table) and Figure 2 the next one.
    layout = driver.execute_script(first_figures)
    assert layout["wide"] and layout["over"] and layout["bar"][1] >= 16, f"Figures 1 and 2 at 1080px: {layout}"
    if browser == "chrome":
        # The key numbers grow with the window, from the phones' 28px to 40px at 1200px: never smaller on a wider window,
        # no jump where the layout changes (720/721, 1023/1024, 1199/1200), and each number inside its item.
        sizes = []
        try:
            for width in (720, 721, 960, 1023, 1024, 1100, 1199, 1200):
                driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": width, "height": 900, "deviceScaleFactor": 1, "mobile": False})
                sizes.append(driver.execute_script("""
                    const items = [...document.querySelectorAll('.stats-totals-main .stats-total')];
                    const fits = items.every((item) => {
                        const box = item.getBoundingClientRect(), value = item.querySelector('.stats-total-value').getBoundingClientRect();
                        return value.left >= box.left - 0.5 && value.right <= box.right + 0.5;
                    });
                    return [innerWidth, parseFloat(getComputedStyle(items[0].querySelector('dd')).fontSize), fits];
                """))
        finally:
            driver.execute_cdp_cmd("Emulation.clearDeviceMetricsOverride", {})
        assert all(fits for _width, _size, fits in sizes), f"A key number leaves its item: {sizes}"
        assert sizes[0][1] == 28 and sizes[-1][1] == 40, sizes
        assert all(b[1] >= a[1] and (b[0] - a[0] > 1 or b[1] - a[1] <= 0.5) for a, b in zip(sizes, sizes[1:])), f"Key numbers jump or shrink: {sizes}"
    for width in (1700, 1280, 884, 760):
        driver.set_window_size(width, 1000)
        # Clearing the emulated viewport above lands a moment later: measured too soon, the page is still 1200px wide.
        wait.until(lambda d: d.execute_script("return innerWidth") == width)
        driver.execute_script("document.querySelector('#statsView').scrollTop=0")
        if width >= 1280:
            layout = driver.execute_script(first_figures)
            assert layout["paired"] and layout["over"], f"Figures 1 and 2 stand side by side at {width}px: {layout}"
        assert driver.execute_script("""
            return [...document.querySelectorAll('.stats-chart-row')].filter(row => row.getBoundingClientRect().width).every(row => {
                const label = row.querySelector('.stats-chart-label').getBoundingClientRect();
                const track = row.querySelector('.stats-track').getBoundingClientRect();
                const count = row.querySelector('.stats-chart-value').getBoundingClientRect();
                return label.right <= track.left + 1 && track.right <= count.left + 1;
            });
        """), "Each bar sits between its name and its count"
        assert driver.execute_script("""
            // Within a chart every bar shares one scale: the tracks are equally wide and start at one x.
            return [...document.querySelectorAll('.stats-chart')].every(chart => {
                const tracks = [...chart.querySelectorAll('.stats-track')].map(track => track.getBoundingClientRect());
                return tracks.every(box => Math.abs(box.left - tracks[0].left) <= 1 && Math.abs(box.width - tracks[0].width) <= 1);
            });
        """), "Bars of one chart share one scale"
        assert driver.execute_script(STATS_AXIS_EVEN), f"Axis labels sit unevenly or touch at {width}px"
        spacing = driver.execute_script("""
            // 16px bars 8px apart: rows whose name fits on one line are exactly as tall as their bar.
            const gaps = [];
            for (const list of document.querySelectorAll('.stats-chart-rows')) {
                const rows = [...list.children].filter(row => row.getBoundingClientRect().width);
                rows.slice(1).forEach((row, index) => {
                    if (rows[index].getBoundingClientRect().height > 16.5 || row.getBoundingClientRect().height > 16.5) return;
                    gaps.push(row.querySelector('.stats-track').getBoundingClientRect().top
                        - rows[index].querySelector('.stats-track').getBoundingClientRect().bottom);
                });
            }
            return gaps;
        """)
        assert spacing and all(abs(gap - 8) <= 0.5 for gap in spacing), f"Bars of one-line rows sit 8px apart at {width}px: {spacing}"
        if width < 1024:
            # Tablet header: Download ends where the links out under it end.
            edges = driver.execute_script("""
                return [document.querySelector('#downloadMenu > summary').getBoundingClientRect().right,
                        document.querySelector('.external-nav').getBoundingClientRect().right];
            """)
            assert abs(edges[0] - edges[1]) <= 1, f"Download ends with the links out at {width}px: {edges}"
        capture(f"stats-{width}")
    if browser == "chrome":
        driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": 375, "height": 812, "deviceScaleFactor": 1, "mobile": True})
        assert driver.execute_script("return innerWidth") == 375
        assert driver.execute_script("return matchMedia('(max-width: 520px)').matches")
        driver.execute_script("document.querySelector('#statsView').scrollTop=0")
        capture("stats-mobile")
        assert driver.execute_script("""
            return [...document.querySelectorAll('.stats-chart-row')].filter(row => row.getBoundingClientRect().width).every(row => {
                const label = row.querySelector('.stats-chart-label').getBoundingClientRect();
                const track = row.querySelector('.stats-track').getBoundingClientRect();
                return label.bottom <= track.top + 1;
            });
        """), "On phones each name sits above its bar"
        off_phone = driver.execute_script("""
            // On phones every bar spans its chart's row (the full width), and its numbers stand right-aligned on the name's
            // line: its last line, or the first one when a breakdown follows the name (Figure 2's Other). The line is
            // found from the name's own letters: a subscript (the cat of kcat) sits below the line and is left out.
            const letters = (node) => {
                if (node.nodeType === Node.TEXT_NODE) return node.parentElement.closest('sub, sup') ? [] : [node];
                return [...node.childNodes].flatMap(letters);
            };
            return [...document.querySelectorAll('.stats-chart-row')].filter(row => row.getBoundingClientRect().width).filter(row => {
                const box = row.getBoundingClientRect(), track = row.querySelector('.stats-track').getBoundingClientRect();
                const label = row.querySelector('.stats-chart-label'), value = row.querySelector('.stats-chart-value').getBoundingClientRect();
                const lines = letters(row.classList.contains('has-note') ? label.firstChild : label).flatMap((node) => {
                    const name = document.createRange(); name.selectNodeContents(node);
                    return [...name.getClientRects()].filter(line => line.width);
                });
                const line = row.classList.contains('has-note') ? lines[0] : lines[lines.length - 1];
                return Math.abs(track.left - box.left) > 1 || Math.abs(track.right - box.right) > 1 || Math.abs(value.right - box.right) > 1
                    || value.bottom > track.top + 1 || Math.abs(value.bottom - line.bottom) > 2;
            }).map(row => `${row.closest('.stats-chart').dataset.chart}:${row.dataset.row}`);
        """)
        assert not off_phone, f"On phones bars span the row with their numbers on the name's line: {off_phone}"
        assert driver.execute_script("""
            return [...document.querySelectorAll('.stats-chart')].every(chart => {
                const tracks = [...chart.querySelectorAll('.stats-track')].map(track => track.getBoundingClientRect());
                return tracks.every(box => Math.abs(box.left - tracks[0].left) <= 1 && Math.abs(box.width - tracks[0].width) <= 1);
            });
        """), "Bars of one chart share one scale on phones"
        assert driver.execute_script(STATS_AXIS_EVEN), "Axis labels sit unevenly or touch on phones"
        assert driver.execute_script("""
            // A legend name that wraps keeps its count right after its last line, not pushed to the far edge.
            return [...document.querySelectorAll('.stats-legend li')].filter(item => item.querySelector('.stats-legend-count')).every(item => {
                const count = item.querySelector('.stats-legend-count');
                const range = document.createRange();
                range.setStart(item.querySelector('.stats-swatch').nextSibling, 0);
                range.setEndBefore(count);
                const lines = [...range.getClientRects()].filter(box => box.width > 0);
                const last = lines[lines.length - 1];
                const box = count.getBoundingClientRect();
                return last && box.left - last.right <= 12 && Math.abs(box.top - last.top) <= 4
                    || last && box.left <= item.getBoundingClientRect().left + 40;
            });
        """), "A legend count follows its name on phones"
        for selector, label in ((".stats-ranges", "stats-mobile-ranges"), ("[aria-labelledby='statsSourcesTitle']", "stats-mobile-sources")):
            if driver.find_elements(By.CSS_SELECTOR, selector):
                driver.execute_script("document.querySelector(arguments[0]).scrollIntoView()", selector)
                capture(label)
        # (a supplement item opened by a click puts its own address in the bar: the clean address is put back after)
        address = driver.execute_script("return location.href")
        for element in driver.find_elements(By.CSS_SELECTOR, "#statsView details > summary"):
            driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", element)
            element.click()
            check_panel_width()
            element.click()
        driver.execute_script("history.replaceState(history.state, '', arguments[0])", address)
    assert not driver.find_elements(By.CSS_SELECTOR, ".catalog-load-failed"), "Browser reported a load failure"
    # A clean Stats address must also survive a fresh page load, not just history navigation.
    driver.refresh()
    wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".stats-status-section tr[data-stat-key]")) >= 5)
    assert driver.find_element(By.ID, "statsView").is_displayed()
    assert not driver.find_element(By.ID, "catalogView").is_displayed()
    assert urlsplit(driver.current_url).path == stats_path and not urlsplit(driver.current_url).fragment
    assert driver.title == "Stats | CatLog"
    return {"browser": browser, "version": driver.capabilities.get("browserVersion"), "url": url,
            "total": total, "accepted": accepted, "source_sha256": manifest["source_sha256"],
            "release_commit": os.environ.get("GITHUB_SHA"), "viewports": viewports, "passed": True}


def check_record_beside_table(driver, browser, url):
    """Fix pass after round 16b: with a record open below 1440px the toolbar keeps its one row (the title row takes no
    room when nothing in it shows) and Organism gives way to the record, so kcat, Km and kcat/Km stay in the table's
    view."""
    wait = WebDriverWait(driver, 60, ignored_exceptions=(StaleElementReferenceException,))
    found = []
    try:
        for width in (1024, 1280):
            set_browse_viewport(driver, browser, width, 800)
            driver.get("about:blank")
            driver.get(url + "#browse")
            key = wait.until(lambda d: d.find_element(By.CSS_SELECTOR, "#recordsBody tr[data-key]")).get_attribute("data-key")
            driver.get("about:blank")
            driver.get(url + f"#browse?record={key}")
            wait.until(lambda d: d.execute_script(
                "return document.body.classList.contains('detail-open') && Boolean(document.querySelector('#detailContent .detail-section'))"))
            layout = driver.execute_script("""
                const pane = document.getElementById('recordTableWrap').getBoundingClientRect();
                const box = (name) => { const th = document.querySelector(`#recordTableWrap thead th.${name}`);
                  return th && th.getClientRects().length && getComputedStyle(th).display !== 'none' ? th.getBoundingClientRect() : null; };
                return {header: Math.round(document.querySelector('.records-header').getBoundingClientRect().height), right: pane.right,
                        organism: Boolean(box('c-organism')), kcat: box('c-kcat') && box('c-kcat').right, eff: box('c-eff') && box('c-eff').right};""")
            assert layout["header"] <= 50 and not layout["organism"] and layout["eff"] and layout["eff"] <= layout["right"] + 1, (width, layout)
            found.append(layout)
    finally:
        if browser == "chrome":
            driver.execute_cdp_cmd("Emulation.clearDeviceMetricsOverride", {})
    return found


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--browser", choices=("chrome", "safari"), required=True)
    args = parser.parse_args()
    OUTPUT.mkdir(exist_ok=True)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    local_base = f"http://127.0.0.1:{server.server_port}/"
    url = urljoin(local_base, "tools/catlog-latest.html")
    if os.environ.get("CHECK_LIVE") == "true":
        url = cache_tagged("https://chowdhurylab.github.io/tools/catlog-latest.html", os.environ["GITHUB_SHA"][:12])
    driver = None
    try:
        if args.browser == "safari":
            driver = webdriver.Safari()
        else:
            options = webdriver.ChromeOptions()
            options.add_argument("--headless=new")
            options.add_argument("--no-sandbox")
            options.add_argument("--disable-dev-shm-usage")
            # On macOS every automated launch otherwise leaves a clone of Chrome.app in /var/folders (thousands pile up).
            options.add_argument("--disable-features=MacAppCodeSignClone")
            driver = webdriver.Chrome(options=options)
        result = check(driver, args.browser, url)
        manifest = driver.execute_script("return window.CATLOG_STATIC_MANIFEST")
        quality = (stats_overview(manifest) or {}).get("quality")
        if quality or args.browser == "chrome":
            check_quality(driver, args.browser, url, quality)
        check_review_headline(driver, args.browser, url)
        check_quality_round16b(driver, args.browser, url)
        result["stats_figures"] = check_stats_figures(driver, args.browser, url)
        result["stats_databases"] = check_stats_databases(driver, args.browser, url)
        result["stats_new_figures"] = check_stats_new_figures(driver, args.browser, url)
        result["stats_years"] = check_stats_years(driver, args.browser, url)
        result["team"] = check_team(driver, args.browser, url)
        result["guide_databases"] = check_guide_databases(driver, args.browser, url)
        result["word_breaks"] = check_word_breaks(driver, args.browser, url)
        result["phone_scroll"] = check_phone_scroll(driver, args.browser, url)
        result["record_beside_table"] = check_record_beside_table(driver, args.browser, url)
        browse = []
        bases = [("local", local_base)]
        if os.environ.get("CHECK_LIVE") == "true":
            bases.append(("live", "https://chowdhurylab.github.io/"))
        for environment, base in bases:
            for route, path in (("static", "tools/catlog-static/"), ("latest", "tools/catlog-latest.html")):
                browse_url = urljoin(base, path)
                if environment == "live":
                    browse_url = cache_tagged(browse_url, os.environ["GITHUB_SHA"][:12])
                browse.append(check_browse(driver, args.browser, browse_url, f"{environment}-{route}"))
                browse[-1]["filters"] = check_filters(driver, args.browser, browse_url, f"{environment}-{route}")
                browse[-1]["record_panel"] = check_record_panel(driver, args.browser, browse_url, f"{environment}-{route}")
                browse[-1]["layout"] = check_layout(driver, args.browser, browse_url, f"{environment}-{route}")
        result["browse_routes"] = browse
        (OUTPUT / f"{args.browser}-result.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result))
    except Exception:
        if driver:
            driver.save_screenshot(str(OUTPUT / f"{args.browser}-failure.png"))
        raise
    finally:
        if driver:
            driver.quit()
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == "__main__":
    main()
