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
import urllib.request
from urllib.parse import parse_qsl, unquote_plus, urlencode, urljoin, urlsplit, urlunsplit

from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.common.exceptions import StaleElementReferenceException
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
        driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {
            "width": width, "height": height, "deviceScaleFactor": 1, "mobile": width == 390,
        })
        driver.execute_cdp_cmd("Emulation.setTouchEmulationEnabled", {"enabled": width == 390})
    else:
        driver.set_window_size(width, height)
        inner = driver.execute_script("return {width: innerWidth, height: innerHeight}")
        driver.set_window_size(width + width - inner["width"], height + height - inner["height"])
    assert driver.execute_script("return [innerWidth, innerHeight]") == [width, height], "Requested viewport is not the actual viewport"


GUIDE_SECTIONS = ("guide-method", "guide-find", "guide-record", "guide-status", "guide-units", "guide-downloads", "guide-caveats",
                  "guide-cite", "guide-sources", "guide-questions")


def assert_document_stays(driver, view):
    """Stats, the Guide and Team scroll inside their own view under a header that stays put: the document itself never
    scrolls (hidden screen-reader text placed against the page once made it ~4,000px tall and scrolled the header away)."""
    state = driver.execute_script("const page = document.scrollingElement; return [page.scrollHeight, page.clientHeight]")
    assert state[0] <= state[1] + 1, f"{view} makes the whole document scroll: {state}"


def check_guide(driver, wait):
    """Guide: the contents list reaches every section, a section's link keeps the Guide open at that section, the
    example views use the #browse? links Browse reads, and human-checked is drawn as in the table."""
    links = driver.find_elements(By.CSS_SELECTOR, ".guide-contents a")
    assert [urlsplit(link.get_attribute("href")).fragment for link in links] == list(GUIDE_SECTIONS)
    for section in GUIDE_SECTIONS:
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
    # Against the databases (Browse's group and the record's section) is described only when the snapshot carries the
    # comparison, as Browse shows the group.
    comparison = driver.execute_script(
        "return (window.CATLOG_STATIC_MANIFEST?.viewer_index?.optional_fields || []).includes('database_summary')")
    database_lines = driver.execute_script(
        "return [...document.querySelectorAll('#guideView [data-guide-databases]')].map(e => e.getClientRects().length > 0)")
    assert len(database_lines) == 2 and all(shown == comparison for shown in database_lines), (comparison, database_lines)
    guide_text = driver.find_element(By.ID, "guideView").text
    for word in ("independent", "AI run", "Checks pending", "Exporter", "exporter", *DROPPED_WORDING):
        assert word not in guide_text, f"The Guide still says {word}"
    # Cite: the downloads save under the snapshot's date, and the Data ID check names that file.
    day = driver.execute_script("return new Date(window.CATLOG_STATIC_MANIFEST.generated_at).toISOString().slice(0, 10)")
    for identifier, part in (("guideFullDataLink", "full"), ("enrichedDataButton", "full"), ("exportSnapshotButton", "table")):
        assert driver.find_element(By.ID, identifier).get_attribute("download") == f"catlog-{day}-{part}.jsonl.gz", identifier
    assert driver.find_element(By.ID, "guideDataIdFile").get_attribute("textContent") == f"catlog-{day}-full.jsonl.gz"
    # Sources and licenses: the records read by CatLog have the count Browse and Stats give them, with CatLog's licence;
    # the earlier paper extractions are a row of their own.
    from_paper = driver.execute_script("return window.CATLOG_STATIC_MANIFEST?.summary?.overview?.from_paper?.records ?? null")
    source_rows = driver.execute_script("""
        return Object.fromEntries([...document.querySelectorAll('#guideSourceList > div')]
            .map(row => [row.querySelector('dt').textContent.trim(), row.querySelector('dd').textContent.trim()]));
    """)
    if isinstance(from_paper, int):
        assert f"{from_paper:,} records in this snapshot" in source_rows.get("CatLog v2", ""), source_rows
        assert "CC BY 4.0" in source_rows["CatLog v2"]
        if "Earlier paper extractions" in source_rows:
            assert "as published (see paper)" in source_rows["Earlier paper extractions"]
    # Every database's licence is said one way, "License: ...", a database without one "License: see the source's terms"
    # (as a record from it reads).
    for name, text in source_rows.items():
        if not name.startswith(("CatLog v2", "Read from the paper")):
            assert text.startswith("License: "), (name, text)
    tag = driver.find_element(By.CSS_SELECTOR, "#guide-status .state-tag.human-checked")
    assert tag.find_elements(By.CSS_SELECTOR, "svg.check-icon") and tag.text.strip() == "human-checked"
    assert driver.execute_script("""
        const checked = getComputedStyle(arguments[0]).color;
        return [...document.querySelectorAll('#guide-status .state-tag:not(.human-checked)')]
            .every(other => getComputedStyle(other).color !== checked);
    """, tag), "human-checked needs its own colour"
    links[GUIDE_SECTIONS.index("guide-units")].click()
    wait.until(lambda d: urlsplit(d.current_url).fragment == "guide-units")
    # The section's heading takes focus, so the next Tab goes on from the section.
    wait.until(lambda d: d.execute_script("return document.activeElement?.id") == "guide-units-title")
    assert driver.find_element(By.ID, "guideView").is_displayed()
    assert not driver.find_element(By.ID, "catalogView").is_displayed()
    wait.until(lambda d: d.execute_script("""
        const view = document.querySelector('#guideView').getBoundingClientRect();
        const top = document.querySelector('#guide-units').getBoundingClientRect().top;
        return top >= view.top - 1 && top <= view.top + 48;
    """))
    assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth + 1"), "Guide overflows sideways"
    assert_document_stays(driver, "Guide")


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
    driver.execute_script("location.hash = arguments[0]", f"#browse?checked=1&sort=kcat_over_km&rows=100&page={(total + 99) // 100}")
    wait.until(lambda d: d.find_element(By.ID, "pageLabel").text.endswith(f"of {count}"))
    no_ratio = driver.execute_script("""
        return [...document.querySelectorAll('#recordsBody tr[data-key]')]
            .filter(tr => tr.querySelector('td.c-eff .metric-with-note')?.innerText.trim() === '—').map(tr => tr.dataset.key).slice(-3);
    """)
    for key in no_ratio:
        driver.find_element(By.CSS_SELECTOR, f'#recordsBody tr[data-key="{key}"] td.c-enzyme').click()
        wait.until(lambda d: d.execute_script(
            "return document.querySelector('#detailContent #detailRecordKey')?.textContent === arguments[0]"
            " && Boolean(document.querySelector('#detailContent .human-review-line dd'))", key))
        line = driver.find_element(By.CSS_SELECTOR, "#detailContent .human-review-line dd").get_attribute("innerText")
        assert "approved every kcat and Km" not in line and "agrees with kcat ÷ Km" not in line, (key, line)
        ActionChains(driver).send_keys(Keys.ESCAPE).perform()
        wait.until(lambda d: not d.execute_script("return document.body.classList.contains('detail-open')"))
    return total


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
            # Both exports name each record's source the same way ("CatLog v2" for a record read from the paper by CatLog).
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
            wait.until(lambda d: d.find_element(By.ID, "activeSummary").text == "0 records")
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
        # The counts band: CatLog v2 N (the name Stats and the Source filter give that count) opens those records
        # (source=paper), N being their number; the snapshot date's title is the Data ID.
        set_browse_viewport(driver, browser, 1440, 1000)
        paper_link = driver.find_element(By.ID, "fromPaperLink")
        assert driver.execute_script("return arguments[0].querySelector('span').innerText.trim()", paper_link) == "CatLog v2"
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
                   "phmin", "phmax", "caution", "source", "sort"}


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


# The human review leads Quality, the first numbered part after the headline band (part 1), and is shown once.
LEAD_FIRST_JS = """
    const band = document.querySelector('#statsTotals > .stats-band');
    const quality = document.querySelector('#statsCharts > .stats-part');
    const lead = document.querySelector('#statsCharts .stats-lead[data-figure="review"]');
    return Boolean(band && quality && quality.dataset.part === 'quality' && lead
        && quality.querySelector('.stats-part-grid').firstElementChild === lead
        && document.querySelectorAll('[data-figure="review"]').length === 1);
"""


# The Guide's human-review line, when shown: its text, whether it comes right after the section's heading, its Stats link.
GUIDE_LEAD_JS = """
    const lead = document.getElementById('guideMethodLead');
    if (!lead || lead.hidden || !lead.getClientRects().length) return null;
    return {text: lead.textContent, first: lead.previousElementSibling?.id === 'guide-method-title',
            stats: Boolean(lead.querySelector('a[href$="catlog-stats.html"], a[href$="#stats"]'))};
"""

# The strict wording the user dropped on 2026-10-13 (first comparison, read blind, the 95% range) and the catalog names
# that CatLog v1 and v2 replace; no human-review text says them.
DROPPED_WORDING = ("first comparison", "read blind", "fully blind", "95% range", "earlier catalog", "old catalog")


def review_share(part, whole):
    """A share as the page writes it (qualityShare): one decimal, <0.1% and >99.9% at the ends."""
    percent = part / whole * 100
    if 0 < percent < 0.1:
        return "<0.1%"
    if 99.9 < percent < 100:
        return ">99.9%"
    return f"{percent:.1f}%"


def review_headline(quality):
    """The share the human-review lead gives: the values correct in CatLog v1 entries (quality.review.v1), else the
    reviewers' approved values CatLog v2 has (quality.agreement, else v2_found of v2_approved_total); None without them."""
    review = (quality.get("review") or {}).get("v1") or {}
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
            assert audit.find_element(By.CSS_SELECTOR, ".stats-check-number").get_attribute("innerText") == f"{quality['audit_values']:,}"
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
                assert correct in earlier and f"{quality['label_or_annotation_v1']:,} wrong label" in earlier, earlier
                assert "approved or not" in earlier, earlier
        if headline:
            assert driver.execute_script(LEAD_FIRST_JS), "The human review leads Quality, right after the headline band"
            figure = driver.find_element(By.CSS_SELECTOR, "#statsCharts .stats-lead .stats-lead-figure strong").text
            assert figure == headline, (figure, headline)
            # The band's Human review gives the same share.
            band = driver.find_element(By.CSS_SELECTOR, ".stats-total[data-total='review'] .stats-total-value").get_attribute("innerText")
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
        # The method section opens with the human review, as Stats does (the user's headline).
        lead = driver.execute_script(GUIDE_LEAD_JS)
        if headline:
            assert lead and lead["first"] and headline in lead["text"] and lead["stats"], lead
        else:
            assert not lead, "No human-review line in the Guide without its counts"
        if audited:
            guide = driver.find_element(By.ID, "guideMethodAudits").text
            assert guide.startswith(f"{quality['audit_values']:,} values re-checked against their papers by a separate AI auditor"), guide
        if compared:
            assert correct in driver.find_element(By.ID, "guideMethodHuman").text
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
REVIEW_SENTENCE = ("Human reviewers checked 2,674 CatLog v1 entries from 408 papers: a reviewer disputed a kcat, Km or kcat/Km "
                   "value on 3 of them, and all 3 are as printed in the paper.")
# The Guide's Human review item, under the Guide's lead that already says how many entries reviewers checked, starts with
# what the lead does not say (never the same sentence twice).
REVIEW_ITEM_START = "A reviewer disputed a kcat, Km or kcat/Km value on 3 of the 2,674 entries, and all 3 are as printed in the paper."
REVIEW_SIDE_LINE = ("CatLog v2 has re-read 311 of these papers: the same value as the reviewers for 3,625 of 4,074 approved "
                    "values (89.0%); wrong CatLog values found: 0.")


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


def check_review_headline(driver, browser, url):
    """With the reviewers' own counts in the snapshot, Stats' lead says the human review of CatLog v1 entries (values
    correct, values missing, other disagreements by kind) with CatLog v2's match as a side line; the Guide's method
    section and Team's Human check say it shortened; the first-comparison and blind fields are never shown. The fixture
    is set in Chrome before the page starts (the data files are not changed)."""
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
            assert lead.find_element(By.CSS_SELECTOR, "h3").get_attribute("innerText") == "Human review of CatLog v1 entries"
            band = driver.find_element(By.CSS_SELECTOR, ".stats-total[data-total='review']").get_attribute("innerText")
            assert "99.9%" in band and "values correct in CatLog v1 entries" in band, band
            assert lead.find_element(By.CSS_SELECTOR, ".stats-lead-figure strong").get_attribute("innerText") == "99.9%"
            assert lead.find_element(By.CSS_SELECTOR, ".stats-lead-sentence").get_attribute("innerText") == REVIEW_SENTENCE
            # The lead writes kcat, Km and kcat/Km as the Values lines and the Guide do: italic, with a subscript.
            assert len(lead.find_elements(By.CSS_SELECTOR, ".stats-lead-figure i + sub, .stats-lead-sentence i + sub")) >= 7
            text = lead.get_attribute("innerText")
            assert "31 entries (1.2%)" in text and "177 entries (6.6%)" in text and "CatLog v2 has 53 of the 58 values reviewers named" in text, text
            assert "could not find the value 153, organism name 13, DOI 5" in text, text
            assert lead.find_element(By.CSS_SELECTOR, ".stats-lead-side").get_attribute("innerText") == REVIEW_SIDE_LINE
            for word in (*DROPPED_WORDING, "85.9", "81.6", "87.0%"):
                assert word not in text, f"The lead says {word}"
            assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth + 1"), f"Stats scrolls sideways at {width}px"
            driver.get("about:blank")
            driver.get(url + "#guide-method")
            wait.until(lambda d: d.find_element(By.ID, "guideView").is_displayed())
            guide = driver.execute_script(GUIDE_LEAD_JS)
            assert guide and "values correct (kcat, Km, kcat/Km) 99.9%" in guide["text"] and REVIEW_SIDE_LINE in guide["text"], guide
            human = driver.find_element(By.ID, "guideMethodHuman").get_attribute("innerText")
            assert human.startswith(REVIEW_ITEM_START) and "approved every kcat and Km they show; the kcat/Km was approved too or agrees with kcat ÷ Km" in human, human
            assert "Human reviewers checked 2,674" not in human, "The Human review item repeats the Guide's lead"
            # kcat, Km and kcat/Km in the site's italic markup in the lead and the Human review item, as Stats' lead
            assert driver.execute_script("""return ['guideMethodLead', 'guideMethodHuman'].every((id) =>
                document.getElementById(id).querySelectorAll('i + sub').length >= 3)"""), "kcat, Km and kcat/Km are in italics"
            assert_document_stays(driver, "Guide with the human review")
            # Team's Human check says the values correct, on the wide and the upright loop, and its lines touch no other
            # station's.
            layout = "wide" if width >= 960 else "narrow"
            driver.get("about:blank")
            driver.get(url + "#team")
            station = wait.until(lambda d: d.find_element(By.CSS_SELECTOR, f"svg.team-loop-{layout} [data-station='human']"))
            assert "99.9% values correct in 2,674 CatLog v1 entries" in station.get_attribute("aria-label"), station.get_attribute("aria-label")
            assert driver.execute_script(TEAM_TEXT_APART, layout), f"Team's {layout} loop: station texts overlap"
    finally:
        driver.execute_cdp_cmd("Emulation.clearDeviceMetricsOverride", {})
        driver.execute_cdp_cmd("Page.removeScriptToEvaluateOnNewDocument", {"identifier": injected["identifier"]})


# Figures 3-5 as the CatLog side will write them into overview.quality (the design spec's counts); no snapshot has them yet.
FIGURES_FIXTURE = {
    "db_compare": {"kcat": {"same": 28743, "differs": 2964, "absent": 494}, "km": {"same": 32551, "differs": 2867, "absent": 307},
                   "kcat_over_km": {"same": 20243, "differs": 3694, "absent": 5425}, "calculated": 4486,
                   "papers_all_absent": 9, "papers_some_absent": 171},
    "earlier_corrections": {"records": 5838, "before_listed": [5513, 7449], "values": {
        "kcat": {"rounding": 960, "different": 450, "magnitude": 56, "added": 467},
        "km": {"rounding": 453, "different": 645, "magnitude": 130, "added": 565},
        "kcat_over_km": {"rounding": 3092, "different": 1569, "magnitude": 94, "added": 443}}},
    "replaced": {"records": 24433, "accepted": 3889, "papers": 1313,
                 "values": {"kcat": [19250, 21222], "km": [21071, 23351], "kcat_over_km": [1109, 1234]}},
}
FIGURE_TITLES = ("Values read from the paper against the databases", "Corrections on records accepted after a correction",
                 "CatLog v1 entries of papers CatLog v2 has read")


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


def check_stats_figures(driver, browser, url):
    """Figures 3-5 and figure 2 by review result, from a copy of the manifest set in Chrome before the page starts (the
    data files are not changed): figures 3-5 follow figure 2 in order, their bars fill 100% per parameter with the shares
    under them, figure 2 stacks each main source by review result, and nothing overflows at 1440 or 375px."""
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
            Object.defineProperty(window, "CATLOG_STATIC_MANIFEST", { value, writable: true, configurable: true });
          } });
    """ % json.dumps(FIGURES_FIXTURE)})
    try:
        for width, height in ((1440, 1000), (375, 812)):
            driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": width < 640})
            driver.get("about:blank")
            driver.get(url.replace("catlog-latest.html", "catlog-stats.html"))
            wait.until(lambda d: d.find_elements(By.ID, "statsReplacedTitle"))
            # The comparison with the databases is the last numbered part, its three figures in order.
            part = driver.find_element(By.CSS_SELECTOR, "#statsCharts > .stats-part:last-of-type")
            assert part.get_attribute("data-part") == "databases", part.get_attribute("data-part")
            headings = [h.get_attribute("innerText") for h in part.find_elements(By.CSS_SELECTOR, ".stats-fig-title")]
            assert headings == list(FIGURE_TITLES), headings
            figures = driver.execute_script("""
                return [...document.querySelectorAll('.stats-chart-percent')].map(chart => ({
                    key: chart.dataset.chart,
                    rows: [...chart.querySelectorAll('.stats-chart-row')].map(row => ({
                        key: row.dataset.row, count: +row.dataset.count,
                        width: [...row.querySelectorAll('.stats-seg')].reduce((sum, seg) => sum + parseFloat(seg.style.width), 0)}))}));
            """)
            assert [figure["key"] for figure in figures] == ["db-compare", "earlier-corrections", "replaced"], figures
            for figure in figures:
                for row in figure["rows"]:
                    assert abs(row["width"] - 100) < 0.01, f"{figure['key']} {row['key']} fills {row['width']}%"
            rows = {row["key"]: row["count"] for row in figures[0]["rows"]}
            assert rows["all"] == sum(sum(FIGURES_FIXTURE["db_compare"][key].values()) for key in ("kcat", "km", "kcat_over_km")), rows
            assert driver.find_elements(By.CSS_SELECTOR, "[data-figure='db-compare'] .stats-share-lines dd span"), "Shares under the bars"
            caption = driver.find_element(By.CSS_SELECTOR, "[data-figure='db-compare'] figcaption").text
            assert "a different number does not mean the database is wrong" in caption, caption
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
            driver.execute_script("document.querySelector('[data-figure=\"db-compare\"]').scrollIntoView()")
            driver.save_screenshot(str(OUTPUT / f"{browser}-stats-figures-{width}.png"))
    finally:
        driver.execute_cdp_cmd("Page.removeScriptToEvaluateOnNewDocument", {"identifier": injected["identifier"]})
        driver.execute_cdp_cmd("Emulation.clearDeviceMetricsOverride", {})
    return {"route": "stats-figures", "passed": True}


# Value labels of several numbers (count, then share; Figure 5's records, accepted, CatLog v2 entries) stand in columns:
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
    const marks = rest.flatMap((row) => row.matches('path') ? [row] : [...row.querySelectorAll('.stats-seg, .stats-ridge-svg')]);
    const texts = rest.flatMap((row) => [...row.querySelectorAll('*')]).filter((node) => [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim()));
    return {marks: Math.max(0, ...marks.map(shown)), text: Math.min(1, ...texts.map(shown))};
"""


def check_stats_more(driver, browser, overview, total):
    """The figures the overview can add (each only when the snapshot counts it), and that their numbers add up: CatLog
    v2 and v1 entries make all records, values per paper make CatLog v2's papers, each class's CatLog v2 entries and its
    values by class stay within its records, the small multiples draw one ridge per class with values. In Chrome,
    pointing at a mark lights it and gives its exact count in the tooltip line."""
    read = overview["from_paper"]["records"]
    versions = {row.get_attribute("data-row"): int(row.get_attribute("data-count"))
                for row in driver.find_elements(By.CSS_SELECTOR, "[data-figure='versions'] .stats-chart-row")}
    if versions:
        assert versions == {"catlog": read, "v1": total - read}, versions
    per_paper = overview.get("from_paper_values")
    rows = [int(row.get_attribute("data-count")) for row in driver.find_elements(By.CSS_SELECTOR, "[data-figure='values-per-paper'] .stats-chart-row")]
    if per_paper:
        assert rows and sum(rows) + per_paper.get("no_values", 0) == overview["from_paper"]["papers"], (rows, per_paper)
    else:
        assert not rows
    classes = {item["class"]: item for item in overview.get("ec_classes") or []}
    if all(isinstance(item.get("from_paper"), int) for item in classes.values()) and classes:
        shown = [int(span.get_attribute("innerText").replace(",", "")) for span in driver.find_elements(By.CSS_SELECTOR, "[data-figure='ec-classes'] .stats-v2-count")]
        assert shown == [item["from_paper"] for item in classes.values()] and all(item["from_paper"] <= item["count"] for item in classes.values()), shown
        # The CatLog v2 stripe parts from its accepted bar by a 1px white gap above and below (not by lightness alone),
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
        # (CatLog v2 entries are accepted, so a stripe ends within its accepted bar.)
        assert all(item["inside"] for item in stripes if classes[int(item["row"][3:])]["from_paper"] <= classes[int(item["row"][3:])]["accepted"]), stripes
    if classes:
        # Figure 5 names its value columns in the legend's order, each heading over its numbers (STATS_VALUE_COLUMNS_JS
        # below checks they end at one x), and no class name runs into them.
        heads = [part.get_attribute("innerText") for part in driver.find_elements(By.CSS_SELECTOR, "[data-figure='ec-classes'] .stats-chart-head .stats-value-part")]
        with_v2 = all(isinstance(item.get("from_paper"), int) for item in classes.values())
        assert heads == ["Records", "Accepted"] + (["CatLog v2"] if with_v2 else []), heads
        crowded = driver.execute_script("""return [...document.querySelectorAll('[data-figure="ec-classes"] .stats-chart-row')].filter((row) => {
            const name = document.createRange(); name.selectNodeContents(row.querySelector('.stats-chart-label'));
            return Math.max(...[...name.getClientRects()].map((box) => box.right)) > row.querySelector('.stats-value-part').getBoundingClientRect().left - 4;
        }).map((row) => row.dataset.row)""")
        assert not crowded, f"Class names run into Figure 5's numbers: {crowded}"
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
    # Value ranges and Values by enzyme class share one log axis per parameter: the same ticks at the same x, so 10⁰
    # stands at one x in both; each histogram then has a bar per decade of that axis, still holding every value.
    for metric, range_ticks, ridge_ticks in driver.execute_script(STATS_SHARED_AXIS_JS):
        summary = overview["metrics"][metric]
        if stats_value_axis(summary):
            start, end = stats_value_axis(summary)
            assert range_ticks == ridge_ticks, (metric, range_ticks, ridge_ticks)
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
    # Every figure is named and described: its heading, one numbered caption, a data line.
    for figure in driver.find_elements(By.CSS_SELECTOR, "#statsCharts figure.stats-fig"):
        assert figure.get_attribute("aria-labelledby") and figure.find_elements(By.CSS_SELECTOR, "figcaption .stats-fig-caption strong")
    if browser != "chrome":
        return
    # Pointing at the Not confirmed slice lights it and its table row, dims the rest and gives its exact count.
    slice_ = driver.find_elements(By.CSS_SELECTOR, ".stats-donut path[data-hl='manual_review_required']")
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
        assert sorted(lit) == ["path", "tr"], lit
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
          // CatLog v2 entries are accepted: a class has no more of them than accepted records
          overview.ec_classes = (overview.ec_classes || []).map((item) => ({ ...item, from_paper: Math.min(item.accepted, Math.floor(item.count / 4)) }));
          const counts = (n) => { const list = new Array(16).fill(0); list[5] = n - 2; list[6] = 1; list[15] = 1; return list; };
          overview.metrics.kcat.by_class = { log10_start: -4, bin_width: 0.5, classes: (overview.ec_classes || []).slice(0, 3)
            .map((item) => ({ class: item.class, n: 20, median: 0.5, p10: 0.02, p90: 4, counts: counts(20) })) };
          overview.top_organisms_from_paper = (overview.top_organisms || []).slice(0, 3).map((item) => ({ ...item, count: Math.min(item.count, overview.from_paper.records) }));
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
# the two can be compared: one shared log axis puts every power of ten at one x in both figures.
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
    wide fallback font keeps the donut's total and every value label inside their figures."""
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
            titles = [h.get_attribute("innerText") for h in driver.find_elements(By.CSS_SELECTOR, "#statsCharts .stats-fig-title")]
            for title in ("Values per paper in CatLog v2", "Organisms with the most CatLog v2 entries", "Values by enzyme class"):
                assert title in titles, titles
            assert titles.index("Value ranges") < titles.index("Values by enzyme class"), titles
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
        # The key numbers glow on screen and not on paper; with less motion asked for, nothing moves.
        glow = "return getComputedStyle(document.querySelector('.stats-totals-main .stats-total-value')).textShadow"
        assert driver.execute_script(glow) not in ("", "none")
        driver.execute_cdp_cmd("Emulation.setEmulatedMedia", {"media": "print"})
        assert driver.execute_script(glow) == "none"
        driver.execute_cdp_cmd("Emulation.setEmulatedMedia", {"media": "", "features": [{"name": "prefers-reduced-motion", "value": "reduce"}]})
        assert driver.execute_script("return getComputedStyle(document.querySelector('.stats-seg')).transitionDuration") in ("0s", "")
        driver.execute_cdp_cmd("Emulation.setEmulatedMedia", {"media": "", "features": []})
        assert driver.execute_script("return getComputedStyle(document.querySelector('.stats-seg')).transitionDuration") != "0s"
        # A wide fallback font from the start (Verdana, letter-spacing 0.5px): the donut's total is set smaller to stay
        # inside its hole, and every value label stays inside its figure.
        wide = driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": WIDE_FONT_JS})
        try:
            driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 900, "deviceScaleFactor": 1, "mobile": False})
            driver.get("about:blank")
            driver.get(url.replace("catlog-latest.html", "catlog-stats.html"))
            wait.until(lambda d: d.find_elements(By.ID, "statsClassValuesTitle"))
            fit = driver.execute_script("""const t = document.querySelector('.stats-donut-total');
                return {family: getComputedStyle(t).fontFamily, width: t.getComputedTextLength(), room: Number(t.getAttribute('data-room')),
                        spill: [...document.querySelectorAll('.stats-chart-value, .stats-ridge-value, .stats-ridge-n')].filter(v =>
                          v.getBoundingClientRect().right > v.closest('.stats-section').getBoundingClientRect().right + 1).map(v => v.innerText)};""")
            assert "Verdana" in fit["family"] and fit["width"] <= fit["room"] + 0.5 and not fit["spill"], fit
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


TEAM_STATIONS = ("papers", "reading", "check", "catlog", "human", "rules", "website", "paper")


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
    wide = driver.find_element(By.CSS_SELECTOR, "svg.team-loop-wide")
    assert wide.is_displayed()
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
    # Legend lines are toggle buttons, not bare focusable list items: pressing Aarna and Erin's keeps Human check lit,
    # pressing Supantha's moves the light to his stations, and pressing it again turns it off.
    lit_js = "return [...document.querySelectorAll('svg.team-loop-wide [data-station].is-lit')].map(e => e.dataset.station)"
    assert not driver.find_elements(By.CSS_SELECTOR, ".team-legend-item[tabindex]")
    legend = driver.find_element(By.CSS_SELECTOR, ".team-legend-item[data-actor='aarna erin'] button[aria-pressed]")
    driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", legend)
    legend.click()
    driver.execute_script("document.querySelector('#teamHeading').focus()")
    assert driver.execute_script(lit_js) == ["human"], driver.execute_script(lit_js)
    assert legend.get_attribute("aria-pressed") == "true"
    # Supantha's line meets Rules updated; his legend line also lights Papers, CatLog and the website.
    supantha = driver.find_element(By.CSS_SELECTOR, ".team-legend-item[data-actor='supantha'] button")
    supantha.click()
    assert sorted(driver.execute_script(lit_js)) == ["catlog", "papers", "rules", "website"], driver.execute_script(lit_js)
    assert legend.get_attribute("aria-pressed") == "false" and supantha.get_attribute("aria-pressed") == "true"
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
            assert not driver.find_elements(By.CSS_SELECTOR, ".team-dots circle"), "No moving dots for reduced motion"
            # The upright loop draws no people or agents, so its caption points to the list instead.
            caption = driver.execute_script("return arguments[0].innerText", driver.find_element(By.CSS_SELECTOR, ".team-figure figcaption"))
            assert "The list of people and AI agents" in caption and "Point at" not in caption, caption
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
        row = driver.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")[index]
        key = row.get_attribute("data-key")
        row.find_element(By.CSS_SELECTOR, ".primary-cell").click()
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

    total_records = driver.execute_script("return window.CATLOG_STATIC_MANIFEST?.total_rows") or 0
    try:
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
        # With no chip left, focus goes to the search box, never to « Hide filters (the next Enter would press it).
        assert driver.switch_to.active_element.get_attribute("id") == "globalSearchInput", "Focus after Clear all"
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

        # Against the databases shows only when the snapshot carries the comparison; without it a db= address is ignored.
        indexed = driver.execute_script(
            "return (window.CATLOG_STATIC_MANIFEST?.viewer_index?.optional_fields || []).includes('database_summary')")
        open_page(base + "#browse?db=corrects")
        section_hidden = driver.execute_script("return document.getElementById('databaseFilterSection').hidden")
        if indexed:
            assert not section_hidden and chip_keys() == ["db:corrects"], (section_hidden, chip_keys())
            assert driver.execute_script("return document.querySelectorAll('#databaseChecklist .check-row').length") >= 5
        else:
            assert section_hidden and not chip_keys() and "db=" not in fragment(), (section_hidden, chip_keys(), fragment())
        # 4. Source: the older status=v2 opens CatLog v2 (source=paper), every row tagged "from
        # paper"; a database narrows the enzyme databases, and the status cell names it.
        def first_tags():
            return driver.execute_script(
                "return [...document.querySelectorAll('#recordsBody tr[data-key] .state-tags > .state-tag:first-child')].map(e => e.textContent)")
        overview = stats_overview(driver.execute_script("return window.CATLOG_STATIC_MANIFEST"))
        open_page(base + "#browse?status=v2")
        wait.until(lambda d: fragment() == "browse?source=paper")
        if overview:
            assert summary() == f"{overview['from_paper']['records']:,} records", summary()
        assert first_tags() and all(tag == "from paper" for tag in first_tags()), first_tags()
        assert chip_keys() == ["source:paper"]
        open_page(base + "#browse?source=skid")
        assert driver.execute_script("return document.querySelector('input[name=\"sourceMode\"][value=\"databases\"]').checked")
        assert first_tags() and all("SKiD" in tag for tag in first_tags()), first_tags()
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
        driver.find_element(By.CSS_SELECTOR, "#activeFilters [data-filter-clear]").click()
        wait.until(lambda d: not fragment())

        # 8. No more precision than was measured: a value shows at most 4 significant figures (a whole number keeps its
        # digits); its tooltip keeps the stored digits.
        for address in ("#browse?enzyme=aldolase&rows=100", "#browse?sort=kcat_over_km_asc"):
            open_page(base + address)
            shown = driver.execute_script("""
                return [...document.querySelectorAll('#recordsBody tr[data-key] :is(.c-kcat,.c-km,.c-eff) .metric-with-note')]
                    .map(e => [(e.innerText.match(/^-?[\\d.]+/) || [''])[0], e.title]).filter(([text]) => text);
            """)
            assert shown, address
            for text, title in shown:
                digits = text.replace(".", "").lstrip("0")
                assert len(digits) <= 4 or "." not in text, (text, title)
                assert title, text
    except Exception:
        driver.save_screenshot(str(OUTPUT / f"{browser}-{route_label}-filters-failure.png"))
        raise
    return {"route": route_label, "human_checked": checked, "passed": True}


def check_layout(driver, browser, url, route_label):
    """The page grid: a 56px header, a 64px counts band (20px numbers, 13px labels), the filter sidebar beside the table
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
        assert 64 <= band["height"] <= 66, f"The counts band is one 64px line: {band}"
        sizes = driver.execute_script("""
            const px = (selector, prop) => [...document.querySelectorAll(selector)].filter(e => e.getClientRects().length)
                .map(e => getComputedStyle(e)[prop]);
            return {numbers: px('.summary-card strong, .snapshot-paper > strong, .snapshot-checked > strong', 'fontSize'),
                    with: px('.snapshot-line strong', 'fontSize'), labels: px('.summary-card > span, .snapshot-paper > span, .snapshot-checked > span', 'fontSize'),
                    th: px('#recordTableWrap thead th', 'fontSize'), thWeight: px('#recordTableWrap thead th', 'fontWeight'),
                    td: px('#recordsBody td.c-organism', 'fontSize')};
        """)
        # the key numbers 20px; the With counts (kcat, Km, kcat/Km) are secondary at 16px
        assert set(sizes["numbers"]) == {"20px"} and set(sizes["with"]) == {"16px"} and set(sizes["labels"]) == {"13px"}, sizes
        assert set(sizes["th"]) == {"12px"} and set(sizes["thWeight"]) == {"600"} and set(sizes["td"]) == {"13px"}, sizes
        date, records = box("#snapshotDate"), box(".summary-card strong")
        # on the counts' line where the fonts allow, else under them; always inside the 64px band (Linux fonts are wider)
        assert band["top"] - 1 <= date["top"] and date["bottom"] <= band["top"] + band["height"] + 1, "At 1440px the snapshot date stays inside the counts band"
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
        overlaps = driver.execute_script("""
            const bad = [];
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
            return bad;
        """)
        assert not overlaps, f"Sidebar options overlap: {overlaps}"
        # A group's chevron and "?" stay level with its title's first line, also when a wide font wraps the title.
        misaligned = driver.execute_script("""
            const bad = [];
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
            return bad;
        """)
        assert not misaligned, f"Group chevron or '?' off its title's first line: {misaligned}"
        # The Source radios say what each version is: "CatLog v2" beside its count with "read from the paper" on one
        # quieter line under it, "CatLog v1" with "from enzyme databases"; neither line wraps, also in a wide font at the
        # sidebar's 256px (1280px window).
        set_browse_viewport(driver, browser, 1280, 1000)
        source_rows = driver.execute_script("""
            const style = document.createElement('style');
            style.id = 'wideSourceFont';
            style.textContent = "#sourceChecklist, #sourceChecklist * {font-family: Verdana, 'DejaVu Sans', sans-serif !important; letter-spacing: 0.5px !important}";
            document.head.appendChild(style);
            const lines = (e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight));
            const rows = [...document.querySelectorAll('#sourceChecklist .radio-row')].map(row => {
                const [label, what] = [row.querySelector(':scope > span:not(.source-mode-what)'), row.querySelector('.source-mode-what')];
                return {label: label.innerText, labelLines: lines(label), what: what ? what.innerText : null, whatLines: what ? lines(what) : 0,
                        countLevel: Math.abs(row.querySelector('strong').getBoundingClientRect().top - label.getBoundingClientRect().top) < 3};
            });
            style.remove();
            return rows;
        """)
        assert [(row["label"], row["what"]) for row in source_rows] == [
            ("All records", None), ("CatLog v2", "read from the paper"), ("CatLog v1", "from enzyme databases")], source_rows
        assert all(row["labelLines"] == 1 and row["whatLines"] in (0, 1) and row["countLevel"] for row in source_rows), source_rows
        set_browse_viewport(driver, browser, 1440, 1000)
        about = driver.find_element(By.CSS_SELECTOR, '#catalogFilters .section-about[aria-controls="aboutSource"]')
        assert not driver.find_element(By.ID, "aboutSource").is_displayed()
        about.click()
        assert about.get_attribute("aria-expanded") == "true" and driver.find_element(By.ID, "aboutSource").is_displayed()
        about_text = driver.execute_script("return document.getElementById('aboutSource').innerText")
        assert "a second, separate AI check" in about_text and "part of them were checked against their papers" in about_text, about_text
        about.click()
        assert about.get_attribute("aria-expanded") == "false" and not driver.find_element(By.ID, "aboutSource").is_displayed()
        # In a short window, opening Review result's "?" scrolls the sidebar just enough to keep its options in view, never
        # taking its title under the sticky heading; closing it again leaves the sidebar where it is.
        set_browse_viewport(driver, browser, 1440, 700)
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
            return {lastShown: last.bottom <= rail.bottom + 0.5, titleClear: title.top >= heading.bottom - 0.5,
                    scrolled: document.getElementById('catalogFilters').scrollTop};
        """
        positions = []

        def scroll_settled(d):
            positions.append(d.execute_script(reveal)["scrolled"])
            return len(positions) > 2 and positions[-1] == positions[-2] == positions[-3]

        WebDriverWait(driver, 5, poll_frequency=0.1).until(scroll_settled)
        shown = driver.execute_script(reveal)
        assert shown["lastShown"] and shown["titleClear"] and shown["scrolled"] > 0, f"Review result's '?' hides its options: {shown}"
        status_about.click()
        assert not driver.find_element(By.ID, "aboutStatus").is_displayed()
        assert driver.execute_script(reveal)["scrolled"] == shown["scrolled"], "Closing a '?' moved the sidebar"
        driver.execute_script("document.getElementById('catalogFilters').scrollTop = 0")
        set_browse_viewport(driver, browser, 1440, 1000)
        # The browser's own colour (theme-color) is the accent token.
        theme = driver.execute_script("""
            return {meta: document.querySelector('meta[name="theme-color"]').content.toLowerCase(),
                    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toLowerCase()};
        """)
        assert theme["meta"] == theme["accent"] == "#245f58", theme
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
        # The Sort menu reads its longest option whole ("kcat/Km, high to low" was cut in a wider font): it is 180px or as
        # wide as that option needs.
        set_browse_viewport(driver, browser, 1280, 900)
        open_page("#browse?sort=kcat_over_km")
        sort = driver.execute_script("""
            const select = document.getElementById('sortSelect');
            const style = getComputedStyle(select);
            const probe = document.createElement('span');
            probe.textContent = select.options[select.selectedIndex].text;
            probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            document.body.appendChild(probe);
            const text = probe.getBoundingClientRect().width;
            probe.remove();
            return {text: select.options[select.selectedIndex].text, width: select.getBoundingClientRect().width,
                    need: text + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 2 + 20};
        """)
        assert sort["text"] == "kcat/Km, high to low" and sort["width"] >= max(180, sort["need"]) - 2, f"The Sort menu reads whole: {sort}"
        results["sort-menu-whole"] = True
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
            driver.find_element(By.CSS_SELECTOR, "#recordsBody tr[data-key]").click()
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
        # While the header is in rows (641-1180px) the counts band always takes the same two lines: Records to
        # Human-checked, then the With counts and the date, with no divider at the start of a line.
        band_heights = set()
        for width in (1180, 1024, 744):
            set_browse_viewport(driver, browser, width, 900)
            band = driver.execute_script("""
                const top = selector => Math.round(document.querySelector(selector).getBoundingClientRect().top);
                return {height: Math.round(document.querySelector('.snapshot-band').getBoundingClientRect().height),
                        records: top('.summary-card'), checked: top('#humanCheckedLink'), meta: top('#snapshotMeta .snapshot-line'),
                        date: top('#snapshotDate'), divider: getComputedStyle(document.getElementById('snapshotMeta')).borderLeftWidth};
            """)
            assert (band["checked"] == band["records"] and band["meta"] > band["records"] + 12
                    and abs(band["date"] - band["meta"]) < 12 and band["divider"] == "0px"), (
                f"At {width}px the counts band takes two lines: {band}")
            band_heights.add(band["height"])
        assert len(band_heights) == 1, f"The two-line counts band keeps one height: {band_heights}"
        # The band's key numbers glow softly in accent ink (Human-checked in its green); a linked count's hover tint is
        # drawn around it, so it never moves the line.
        glow = driver.execute_script("""
            const shadow = selector => getComputedStyle(document.querySelector(selector)).textShadow;
            const font = selector => { const style = getComputedStyle(document.querySelector(selector));
              return {size: parseFloat(style.fontSize), weight: Number(style.fontWeight), color: style.color}; };
            return {records: shadow('.summary-card strong'), checked: shadow('#humanCheckedLink > strong'),
                    tint: getComputedStyle(document.getElementById('humanCheckedLink'), '::before').position,
                    key: font('.summary-card strong'), with: font('#snapshotMeta .snapshot-line strong'), withShadow: shadow('#snapshotMeta .snapshot-line strong')};
        """)
        assert glow["records"] not in ("", "none") and glow["checked"] not in ("", "none") and glow["tint"] == "absolute", glow
        # The With counts are secondary: smaller, lighter and without the glow, so the key numbers lead the band.
        assert (glow["with"]["size"] < glow["key"]["size"] and glow["with"]["weight"] < glow["key"]["weight"]
                and glow["withShadow"] in ("", "none")), glow
        results["band-two-lines"] = True
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
                return {filters: top('#openFiltersButton'), export: top('#exportMenu > summary'), sort: top('#sortSelect'),
                        width: Math.round(select.getBoundingClientRect().width), name: select.labels[0]?.textContent.trim(),
                        scroll: document.documentElement.scrollWidth > innerWidth + 1};
            """)
            tops = [toolbar["filters"], toolbar["export"], toolbar["sort"]]
            assert (max(tops) - min(tops) <= 2 and toolbar["width"] >= 108
                    and toolbar["name"].startswith("Sort") and not toolbar["scroll"]), f"At 320px the toolbar is one row: {toolbar}"
            # The links out never run into the brand (a wide font puts them on two lines instead).
            brand, links = box(".brand-lockup strong"), box(".external-nav")
            assert brand["left"] + brand["width"] <= links["left"] + 1, f"At 320px the links out overlap the brand: {brand} {links}"
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
            # 360-389px with a filter on (the Filters count): the buttons narrow so the menu still shows "Review result"
            # whole (its text, padding and arrow), with "Sort" shown beside it.
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
                            label: document.querySelector('.sort-control label').getBoundingClientRect().width > 2,
                            tops: [top('#openFiltersButton'), top('#exportMenu > summary'), top('#sortSelect')],
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


RECORD_SECTIONS = ["Values", "Against the databases", "Source", "Conditions", "Protein and substrate", "Paper", "Review and audit"]

# A malic enzyme variant with 28 substitutions (PMID 24998673): its sequence line is one long run with no spaces.
LONG_VARIANT_RECORD = "e15d2d23d7f3db24"
# A triose phosphate isomerase read from the paper whose calculated kcat/Km (8.49 × 10⁷) carries calc. and a "!".
CALC_FLAG_RECORD = "1704dd2d6297af79"
# A biotinidase read from the paper (its Method line's Guide link once ran past the panel at 361-389px) and an older alcohol
# dehydrogenase whose SABIO-RK kcat/Km range (6.7 × 10⁻⁴–2.3 × 10³ s⁻¹ mM⁻¹, 115 values) once ran past it at 320px.
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
    """The record (design spec 5): header lines, then Values, Against the databases (only when it has something to say),
    Source, Conditions, Protein and substrate, Paper, Review and audit with the record's actions last (the source's own
    details are rows of Source, nothing to open at the end); a record read from the paper
    says how in its Method line (with the Guide link) and gives its values as printed; an older record names the earlier
    automated review; no labelled row shows a bare dash; Show opens a sequence under its row."""
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
                expected = [name for name in RECORD_SECTIONS if name != "Against the databases" or name in panel["sections"]]
                assert panel["sections"] == expected, panel["sections"]
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
                    # database's in Review and audit's Paper check row, never under Against the databases.
                    assert panel["databasesText"] is None, panel["databasesText"]
                if kind == "database-pending":
                    assert panel["status"].startswith("Not confirmed"), panel["status"]
                    assert panel["paperCheck"] == "Not yet checked against the paper: the values are the database's.", panel["paperCheck"]
                if kind == "from-paper":
                    assert panel["paperCheck"] is None, panel["paperCheck"]
                if kind == "from-paper":
                    assert "read from the paper" in panel["status"], panel["status"]
                    assert panel["method"] and panel["method"].startswith(
                        "Read from the paper by an AI model; a second, separate AI check compared each value with the paper;"), panel["method"]
                    assert panel["methodLink"] == "#guide-method"
                    assert panel["review"] == "Accepted: read from the paper by CatLog.", panel["review"]
                else:
                    assert panel["method"] is None and "earlier automated review" in (panel["review"] or ""), panel["review"]
                if label == "desktop":
                    # With a record open the table's Status cells keep their source line (innerText: what is shown).
                    status_lines = driver.execute_script("""
                        return [...document.querySelectorAll('#recordsBody tr[data-key] .state-badge')].slice(0, 5)
                            .map(badge => badge.innerText.trim().split('\\n').map(line => line.trim()).filter(Boolean));
                    """)
                    assert status_lines and all(len(lines) >= 2 for lines in status_lines), status_lines
                    if kind == "from-paper":
                        assert all(lines[1] == "from paper" for lines in status_lines), status_lines
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
                # On phones calc. and "!" go under the number, so the Values table stays inside its section and As printed
                # keeps room (at 390 and at 320px; skipped when this snapshot does not have that record).
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
                        return {over: table.getBoundingClientRect().right - contentRight,
                                printed: (heads.find(([name]) => name === 'As printed') || [, 0])[1],
                                below: cell.querySelector('.metric-origin:not(.vt-ghost)').getBoundingClientRect().top
                                    >= cell.querySelector('.vt-number').getBoundingClientRect().bottom - 1,
                                sideways: panel.scrollWidth - panel.clientWidth};
                    """)
                    assert fit["over"] <= 1 and fit["sideways"] <= 1, f"The Values table runs past its section at {phone_width}px: {fit}"
                    assert fit["below"], f"calc. stays beside the number at {phone_width}px: {fit}"
                    assert fit["printed"] >= (90 if phone_width == 390 else 48), f"As printed is squeezed at {phone_width}px: {fit}"
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
                            return {rows, headRight: Math.max(...head.map(r => r.right))};
                        """)
                        driver.execute_script("document.getElementById('wideFontCheck')?.remove()")
                        rows = measured["rows"]
                        for row in rows:
                            assert row["numberRight"] < row["unitLeft"], f"{row['name']}'s value runs into Unit at 320px: {row}"
                            assert row["checkBeside"] is not False and row["checkInside"] is not False, f"{row['name']}'s check leaves its number at 320px: {row}"
                        ends = [row["numberRight"] for row in rows]
                        assert max(ends) - min(ends) <= 1, f"The Value column's numbers do not line up at 320px: {rows}"
                        # The heading keeps the checks' space too, so it ends where the numbers end.
                        assert abs(measured["headRight"] - max(ends)) <= 1, f"Value does not end over the numbers at 320px: {measured}"
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
                # No record scrolls sideways on a phone: a record read from the paper (its Method line's Guide link wraps),
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
    except Exception:
        driver.save_screenshot(str(OUTPUT / f"{browser}-{route_label}-record-panel-failure.png"))
        raise
    return {"route": route_label, "checked": results, "passed": True}


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
            return {names: checks.map(e => e.getAttribute('aria-label')),
                    colour: checks.length ? getComputedStyle(checks[0]).color : null,
                    legend: key ? key.closest('li').innerText.trim() : null,
                    edges: [...table.querySelectorAll('.vt-number')].map(e => Math.round(e.getBoundingClientRect().right)),
                    sideways: panel.scrollWidth - panel.clientWidth};
        """)
        assert marks["names"] and set(marks["names"]) == {"approved by a human reviewer"}, marks
        assert marks["colour"] == "rgb(23, 115, 58)", marks["colour"]
        assert (marks["legend"] or "").startswith("Approved by a human reviewer"), marks["legend"]
        assert max(marks["edges"]) - min(marks["edges"]) <= 1, f"The Value column's numbers do not line up: {marks['edges']}"
        assert marks["sideways"] <= 1, marks
        results["value-approved-checks"] = True
        # "see Human review below" shows that row of Review and audit: scrolled into the panel's view and focused.
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
    driver.find_element(By.CSS_SELECTOR, "#recordsBody tr[data-key] .primary-cell").click()
    wait.until(lambda d: d.execute_script("return document.body.classList.contains('detail-open')"))
    driver.find_element(By.ID, "closeDetailButton").click()
    wait.until(lambda d: not d.execute_script("return document.body.classList.contains('detail-open')")
               and "record=" not in urlsplit(d.current_url).fragment)
    driver.back()
    wait.until(lambda d: urlsplit(d.current_url).path != urlsplit(base).path)
    assert driver.execute_script("return history.length") == length, "Closing a record left an entry behind"
    results["record-close-history"] = True
    # A link followed from a record (here its Method line's Guide link), then Back: the record opens where it was left,
    # not at its top.
    driver.get("about:blank")
    driver.get(base + "#browse?source=paper")
    wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")
               and not d.find_elements(By.CSS_SELECTOR, "#recordsBody tr.skeleton-row"))
    first = driver.find_element(By.CSS_SELECTOR, "#recordsBody tr[data-key]")
    opened = first.get_attribute("data-key")
    first.find_element(By.CSS_SELECTOR, ".primary-cell").click()
    wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, "#detailContent .source-section a.method-link")
               and not d.find_elements(By.ID, "detailLoadStatus"))
    method_link = driver.find_element(By.CSS_SELECTOR, "#detailContent .source-section a.method-link")
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
        const heading = document.getElementById('detailHeading').getBoundingClientRect();
        const buttons = [...document.querySelectorAll('#detailContent .detail-title-buttons button')].map(b => b.getBoundingClientRect());
        return {apart: buttons.every(b => b.left >= heading.right - 1), inside: buttons.every(b => b.right <= innerWidth && b.top >= title.top - 1),
                sideways: document.getElementById('detailPanel').scrollWidth - document.getElementById('detailPanel').clientWidth};
    """)
    assert header["apart"] and header["inside"] and header["sideways"] <= 1, f"The record's ‹ › × overlap its name: {header}"
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
    # The donut: one slice per review result with records, in the snapshot's numbers.
    donut = driver.find_element(By.CSS_SELECTOR, ".stats-status-section svg.stats-donut")
    assert donut.get_attribute("role") == "img" and f"{total:,} records" in donut.get_attribute("aria-label")
    # Its slices say the review result's word, as the record does: Not checked (Unverified), Not checked (Not reviewed).
    for key, word in (("unverified", "Unverified"), ("mathematically_inferred", "Not reviewed")):
        if expected.get(key, 0):
            assert f"Not checked ({word}) {expected[key]:,}" in donut.get_attribute("aria-label"), donut.get_attribute("aria-label")
    assert len(donut.find_elements(By.CSS_SELECTOR, "path")) == sum(1 for key in ("manual_review_required", "unverified",
        "mathematically_inferred", "disputed") if expected.get(key, 0)) + bool(accepted)
    if overview:
        # Accepted splits into the CatLog v2 entries (read from the paper by CatLog) and the CatLog v1 entries.
        read = overview["from_paper"]["records"]
        assert f"{read:,} CatLog v2 entries, read from the paper; {accepted - read:,} CatLog v1 entries" in accepted_split
        # records accepted on a human review (accepted_basis "human review") are named apart from "as printed"
        human = {item["label"]: item["count"] for item in manifest["summary"]["distributions"].get("accepted_basis", [])}.get("human review", 0)
        assert f"({expected.get('verified', 0) - read - human:,} as printed" in accepted_split
        assert detail_rows.get("accepted_catlog") == read
    else:
        assert f"{expected.get('verified', 0):,}" in accepted_split
    identity_only = {item["label"]: item["count"] for item in manifest["summary"]["distributions"].get("public_trust_basis", [])}.get("identity_only", 0)
    if identity_only:
        # since 2026-10-12 (D1) records with no PMID or DOI are not accepted; Stats still names them
        assert f"{identity_only:,} records have no PMID or DOI linked" in driver.find_element(By.CLASS_NAME, "stats-status-section").text

    # Every Stats link opens Browse with the shared #browse? filters.
    links = driver.find_elements(By.CSS_SELECTOR, "#statsCharts a.stats-link")
    assert links, "Stats links into Browse"
    for link in links:
        target = urlsplit(link.get_attribute("href"))
        assert target.path == urlsplit(url).path, f"Stats links open Browse: {target.path}"
        assert target.fragment.startswith("browse?"), target.fragment
        params = parse_qsl(target.fragment[len("browse?"):], keep_blank_values=True)
        assert params and {key for key, _value in params} <= STATS_LINK_KEYS, f"Unknown Browse filter: {params}"
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

    # The overview, when this snapshot has one; otherwise no section or headline without its numbers.
    headline = driver.find_element(By.ID, "statsTotals").text
    stats_text = driver.find_element(By.ID, "statsCharts").get_attribute("textContent")
    if overview:
        human = overview.get("human_checked_accepted")
        if human is not None:
            # Human-checked is a check under Quality, linked to those records.
            card = driver.find_element(By.CSS_SELECTOR, "[data-check='human_checked']")
            assert card.find_element(By.CSS_SELECTOR, ".stats-check-number").get_attribute("innerText") == f"{human:,}"
            assert any(href.endswith("#browse?checked=1") for href in hrefs)
        assert f"{overview['from_paper']['records']:,}" in headline and f"from {overview['from_paper']['papers']:,} papers" in headline
        assert any(href.endswith("#browse?source=paper") for href in hrefs)
        # The band's key numbers link into Browse: Accepted and the CatLog v2 entries.
        band_links = {item.get_attribute("data-total"): urlsplit(item.find_element(By.CSS_SELECTOR, "a.stats-total-value").get_attribute("href")).fragment
                      for item in driver.find_elements(By.CSS_SELECTOR, ".stats-totals-main .stats-total") if item.find_elements(By.CSS_SELECTOR, "a")}
        assert band_links.get("accepted") == "browse?status=accepted" and band_links.get("catlog") == "browse?source=paper", band_links
        # Numbered parts in order, from the band's 1.
        parts = [heading.get_attribute("innerText").split("\n") for heading in driver.find_elements(By.CSS_SELECTOR, ".stats-part-title")]
        assert [int(number) for number, *_rest in parts] == list(range(1, len(parts) + 1)), parts
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
            assert lead.find_element(By.CSS_SELECTOR, ".stats-lead-figure strong").get_attribute("innerText") == lead_share
            for word in DROPPED_WORDING:
                assert word not in lead.get_attribute("innerText"), f"The lead says {word}"
        assert cautions == {f"caution_{key}": count for key, count in overview["cautions"].items()}
        ranges = driver.find_elements(By.CSS_SELECTOR, ".stats-range")
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
        assert "Human-checked" not in headline and "CatLog v2" not in headline
        assert not driver.find_elements(By.CSS_SELECTOR, ".stats-range")
    for heading in driver.find_elements(By.CSS_SELECTOR, "#statsCharts h2, #statsCharts h3"):
        section = heading.find_element(By.XPATH, "..")
        assert section.find_elements(By.CSS_SELECTOR, "li, figure, p"), f"Empty Stats section: {heading.text}"
    # Figures and tables are numbered in reading order, each with one caption and a data line.
    for kind in ("Figure", "Table"):
        numbers = [int(match) for match in re.findall(kind + r" (\d+)\.", " ".join(
            caption.text for caption in driver.find_elements(By.CSS_SELECTOR, ".stats-fig > figcaption .stats-fig-caption")))]
        assert numbers == list(range(1, len(numbers) + 1)), f"{kind} numbers: {numbers}"
    assert "Not saved" not in stats_text and "tokens" not in stats_text.lower()
    for removed in ("not split by field", "How these groups differ", "Example checks", "Fields in these records"):
        assert removed not in stats_text, f"Removed Stats text is back: {removed}"
    assert not driver.find_elements(By.CSS_SELECTOR, ".stats-nested-ring, .stats-review-ring, .stats-material-section, #statsCharts svg circle")
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
            return size('.stats-totals-main dd') >= (innerWidth <= 640 ? 24 : 32) && size('.stats-totals-scope dd') >= (innerWidth <= 640 ? 18 : 20);
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
            return [...document.querySelectorAll('.stats-chart-label, .stats-chart-value, .stats-table .stats-num, .stats-totals dd, .stats-range-numbers dd, .stats-lead-figure strong')]
                .filter(e => e.getBoundingClientRect().width && e.scrollWidth > e.clientWidth + 1)
                .map(e => e.textContent);
        """)
        assert not overflow, f"Clipped Stats text: {overflow}"
        driver.save_screenshot(str(OUTPUT / f"{browser}-{label}.png"))

    capture("stats-desktop")
    driver.execute_script("document.querySelector('#statsView').scrollTop=0")
    for element in driver.find_elements(By.CSS_SELECTOR, "#statsView details > summary"):
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
    for identifier in ("enrichedDataButton", "exportSnapshotButton"):
        link = driver.find_element(By.ID, identifier)
        assert link.is_displayed()
        with urllib.request.urlopen(urllib.request.Request(link.get_attribute("href"), method="HEAD"), timeout=30) as response:
            assert response.status == 200 and int(response.headers["Content-Length"]) > 1_000_000
    driver.find_element(By.ID, "downloadMenu").find_element(By.TAG_NAME, "summary").click()

    # A linked Stats count is the number of records its link opens: the most common organism (with its strains),
    # BRENDA (records merged from several databases count under each), the records read from the paper by CatLog and
    # the earlier paper extractions.
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
    search = driver.find_element(By.ID, "globalSearchInput")
    search.send_keys("zzzz-no-match-catlog", Keys.TAB)
    wait.until(lambda d: d.find_element(By.ID, "activeSummary").text == "0 records")
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
        const donut = box('.stats-status-section .stats-donut'), table = box('.stats-status-table');
        return {wide: Math.abs(status.width - charts.width) <= 1 && Math.abs(sources.width - charts.width) <= 1 && sources.top >= status.bottom,
                paired: Math.abs(status.top - sources.top) <= 1 && sources.left >= status.right,
                beside: table.left >= donut.right && Math.abs(table.top - donut.top) <= 1, donut: [donut.width, donut.height]};
    """
    # 1024-1279px: Figure 1 takes the row (its legend table beside the 200px donut) and Figure 2 the next one.
    layout = driver.execute_script(first_figures)
    assert layout["wide"] and layout["beside"] and all(abs(size - 200) <= 0.5 for size in layout["donut"]), f"Figures 1 and 2 at 1080px: {layout}"
    for width in (1700, 1280, 884, 760):
        driver.set_window_size(width, 1000)
        driver.execute_script("document.querySelector('#statsView').scrollTop=0")
        if width >= 1280:
            layout = driver.execute_script(first_figures)
            assert layout["paired"] and layout["beside"], f"Figures 1 and 2 stand side by side at {width}px: {layout}"
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
            // line: its last line, or the first one when a breakdown follows the name (Figure 2's Other).
            return [...document.querySelectorAll('.stats-chart-row')].filter(row => row.getBoundingClientRect().width).filter(row => {
                const box = row.getBoundingClientRect(), track = row.querySelector('.stats-track').getBoundingClientRect();
                const label = row.querySelector('.stats-chart-label'), value = row.querySelector('.stats-chart-value').getBoundingClientRect();
                const name = document.createRange(); name.selectNodeContents(row.classList.contains('has-note') ? label.firstChild : label);
                const lines = [...name.getClientRects()].filter(line => line.width), line = row.classList.contains('has-note') ? lines[0] : lines[lines.length - 1];
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
        for element in driver.find_elements(By.CSS_SELECTOR, "#statsView details > summary"):
            driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", element)
            element.click()
            check_panel_width()
            element.click()
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
            driver = webdriver.Chrome(options=options)
        result = check(driver, args.browser, url)
        manifest = driver.execute_script("return window.CATLOG_STATIC_MANIFEST")
        quality = (stats_overview(manifest) or {}).get("quality")
        if quality or args.browser == "chrome":
            check_quality(driver, args.browser, url, quality)
        check_review_headline(driver, args.browser, url)
        result["stats_figures"] = check_stats_figures(driver, args.browser, url)
        result["stats_new_figures"] = check_stats_new_figures(driver, args.browser, url)
        result["team"] = check_team(driver, args.browser, url)
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
