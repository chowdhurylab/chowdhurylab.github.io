"""Unmocked public-site checks on disposable Chrome and macOS Safari runners."""

import argparse
import functools
import hashlib
from html.parser import HTMLParser
import http.server
import json
import os
from pathlib import Path
import re
import threading
import urllib.request
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

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
    guide_text = driver.find_element(By.ID, "guideView").text
    for word in ("CatLog v2", "independent", "AI run", "Checks pending", "Exporter", "exporter"):
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
        assert f"{from_paper:,} records in this snapshot" in source_rows.get("Read from the paper by CatLog", ""), source_rows
        assert "CC BY 4.0" in source_rows["Read from the paper by CatLog"]
        if "Earlier paper extractions" in source_rows:
            assert "as published (see paper)" in source_rows["Earlier paper extractions"]
    tag = driver.find_element(By.CSS_SELECTOR, "#guide-status .state-tag.human-checked")
    assert tag.find_elements(By.CSS_SELECTOR, "svg.check-icon") and tag.text.strip() == "human-checked"
    assert driver.execute_script("""
        const checked = getComputedStyle(arguments[0]).color;
        return [...document.querySelectorAll('#guide-status .state-tag:not(.human-checked)')]
            .every(other => getComputedStyle(other).color !== checked);
    """, tag), "human-checked needs its own colour"
    links[GUIDE_SECTIONS.index("guide-units")].click()
    wait.until(lambda d: urlsplit(d.current_url).fragment == "guide-units")
    assert driver.find_element(By.ID, "guideView").is_displayed()
    assert not driver.find_element(By.ID, "catalogView").is_displayed()
    wait.until(lambda d: d.execute_script("""
        const view = document.querySelector('#guideView').getBoundingClientRect();
        const top = document.querySelector('#guide-units').getBoundingClientRect().top;
        return top >= view.top - 1 && top <= view.top + 48;
    """))
    assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth + 1"), "Guide overflows sideways"


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
    return int(count.replace(",", ""))


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
        # The counts band: Read from the paper N opens those records (source=paper), N being their number; the snapshot
        # date's title is the Data ID.
        set_browse_viewport(driver, browser, 1440, 1000)
        paper_link = driver.find_element(By.ID, "fromPaperLink")
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


LEAD_FIRST_JS = """
    const lead = document.getElementById('statsLead'), totals = document.getElementById('statsTotals');
    return Boolean(lead && !lead.hidden && lead.querySelector('[data-figure="agreement"]')
        && (lead.compareDocumentPosition(totals) & Node.DOCUMENT_POSITION_FOLLOWING)
        && !document.querySelector('#statsCharts [data-figure="agreement"]'));
"""


def check_quality(driver, browser, url, quality=None):
    """Stats' checks table and the Guide's method section give the audit and human-review numbers of overview.quality;
    the agreement with human reviewers leads Stats when the snapshot has it. Without a quality object in the snapshot, a
    copy of the manifest with QUALITY_FIXTURE (set in Chrome before the page starts; the data files are not changed) is
    checked instead."""
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
    compared = all(isinstance(quality.get(key), int) for key in ("compared_values_v1", "wrong_v1", "label_or_annotation_v1")) \
        and quality["compared_values_v1"] > 0
    correct = f"{(quality['compared_values_v1'] - quality['wrong_v1']) / quality['compared_values_v1'] * 100:.1f}% correct" if compared else ""
    agreement = quality.get("agreement") or {}
    try:
        set_browse_viewport(driver, browser, 1440, 1000)
        driver.get("about:blank")
        driver.get(url.replace("catlog-latest.html", "catlog-stats.html"))
        wait.until(lambda d: d.find_elements(By.ID, "statsChecksTitle"))
        if audited:
            audit = driver.find_element(By.CSS_SELECTOR, "tr[data-check='audit']").text
            assert f"{quality['audit_values']:,} values" in audit and f"{quality['audit_values'] - quality['audit_wrong']:,} kept" in audit, audit
            assert "independent" not in audit.lower(), audit
        if compared:
            # The share correct is shown only with the label errors beside it.
            earlier = driver.find_element(By.CSS_SELECTOR, "tr[data-check='earlier']").text
            assert correct in earlier and f"{quality['label_or_annotation_v1']:,} wrong label" in earlier, earlier
        if isinstance(agreement.get("values_approved"), int) and agreement["values_approved"]:
            assert driver.execute_script(LEAD_FIRST_JS), "The agreement leads Stats, above the headline counts"
            assert f"{agreement['agree']:,}" in driver.find_element(By.CSS_SELECTOR, "tr[data-check='agreement']").text
        else:
            assert not driver.find_elements(By.CSS_SELECTOR, ".stats-lead"), "No lead without agreement counts"
        stats_text = driver.find_element(By.ID, "statsLead").text + driver.find_element(By.ID, "statsCharts").text
        for word in ("independent", "AI run", "Claude", "Codex", "CatLog v2"):
            assert word not in stats_text, f"Stats says {word}"
        assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth + 1")
        driver.get("about:blank")
        driver.get(url + "#guide-method")
        wait.until(lambda d: d.find_element(By.ID, "guideView").is_displayed())
        if audited:
            guide = driver.find_element(By.ID, "guideMethodAudits").text
            assert guide.startswith(f"{quality['audit_values']:,} values re-checked against their papers by a separate AI auditor"), guide
        if compared:
            assert correct in driver.find_element(By.ID, "guideMethodHuman").text
    finally:
        if injected:
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
                 "Earlier records of papers CatLog has read")


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
            headings = [h.text for h in driver.find_elements(By.CSS_SELECTOR, "#statsCharts h2")]
            assert headings[2:5] == list(FIGURE_TITLES), headings
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
            assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth + 1"), f"Stats overflows at {width}px"
            assert driver.execute_script("const p=document.querySelector('#statsView'); return p.scrollWidth <= p.clientWidth + 1"), f"Stats overflows inside at {width}px"
            driver.execute_script("document.querySelector('[data-figure=\"db-compare\"]').scrollIntoView()")
            driver.save_screenshot(str(OUTPUT / f"{browser}-stats-figures-{width}.png"))
    finally:
        driver.execute_cdp_cmd("Page.removeScriptToEvaluateOnNewDocument", {"identifier": injected["identifier"]})
        driver.execute_cdp_cmd("Emulation.clearDeviceMetricsOverride", {})
    return {"route": "stats-figures", "passed": True}


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
    # Focus on a legend line (Aarna and Erin) lights Human check only.
    legend = driver.find_element(By.CSS_SELECTOR, ".team-legend-item[data-actor='aarna erin']")
    driver.execute_script("arguments[0].focus()", legend)
    lit = driver.execute_script("return [...document.querySelectorAll('svg.team-loop-wide [data-station].is-lit')].map(e => e.dataset.station)")
    assert lit == ["human"], lit
    # Supantha's line meets Rules updated; his legend line also lights Papers, CatLog and the website.
    driver.execute_script("arguments[0].focus()", driver.find_element(By.CSS_SELECTOR, ".team-legend-item[data-actor='supantha']"))
    lit = driver.execute_script("return [...document.querySelectorAll('svg.team-loop-wide [data-station].is-lit')].map(e => e.dataset.station)")
    assert sorted(lit) == ["catlog", "papers", "rules", "website"], lit
    # Pointing at an agent on the figure lights its station.
    chip = wide.find_element(By.CSS_SELECTOR, ".team-actor[data-actor='reading'] rect")
    if browser == "chrome":
        ActionChains(driver).move_to_element(chip).perform()
    else:
        driver.execute_script("arguments[0].dispatchEvent(new PointerEvent('pointerover', {bubbles: true}))", chip)
    wait.until(lambda d: d.execute_script("return [...document.querySelectorAll('svg.team-loop-wide [data-station].is-lit')].map(e => e.dataset.station).join()") == "reading")
    driver.save_screenshot(str(OUTPUT / f"{browser}-team-desktop.png"))
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
            assert driver.execute_script("""
                return [...document.querySelectorAll('svg.team-loop-narrow text')].every(e => parseFloat(getComputedStyle(e).fontSize) * e.ownerSVGElement.getScreenCTM().a >= 11);
            """), "Team labels read at phone width"
            assert not driver.find_elements(By.CSS_SELECTOR, ".team-dots circle"), "No moving dots for reduced motion"
            # The phone header as on Stats: the links out beside Download, the four tabs on their own line under it.
            assert driver.execute_script("""
                const top = (s) => document.querySelector(s).getBoundingClientRect();
                const links = top('.external-nav'), actions = top('.header-actions'), nav = top('.top-nav');
                return Math.abs(links.top - actions.top) < 24 && nav.top >= links.bottom - 1;
            """), "Team header: links out beside Download, tabs below"
            driver.save_screenshot(str(OUTPUT / f"{browser}-team-mobile.png"))
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
        assert all(20 <= float(value) <= 30 for value in cells("c-temp")), cells("c-temp")
        filtered = summary()
        first_keys = [row.get_attribute("data-key") for row in rows]
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
        ph_values = cells("c-ph")
        assert ph_values and all(7 <= float(value) <= 7.5 for value in ph_values), ph_values
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

        # 4. Source: the older status=v2 opens Read from the paper by CatLog (source=paper), every row tagged "from
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
            return {numbers: px('.snapshot-overview strong', 'fontSize'), labels: px('.summary-card > span, .snapshot-paper > span, .snapshot-checked > span', 'fontSize'),
                    th: px('#recordTableWrap thead th', 'fontSize'), thWeight: px('#recordTableWrap thead th', 'fontWeight'),
                    td: px('#recordsBody td.c-organism', 'fontSize')};
        """)
        assert set(sizes["numbers"]) == {"20px"} and set(sizes["labels"]) == {"13px"}, sizes
        assert set(sizes["th"]) == {"12px"} and set(sizes["thWeight"]) == {"600"} and set(sizes["td"]) == {"13px"}, sizes
        date, records = box("#snapshotDate"), box(".summary-card strong")
        assert date["top"] < records["bottom"], "At 1440px the snapshot date stays on the counts' line"
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
        results["row-height"] = True
        # The one-line header (from 1181px) never cuts the search box's placeholder.
        for width in (1181, 1259, 1260, 1280, 1440):
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
        # 1280: the sidebar is 272px; a record takes its place (the rail) and closing it brings it back.
        set_browse_viewport(driver, browser, 1280, 900)
        open_page()
        assert is_open() and box(".filter-column")["width"] == 272, box(".filter-column")
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
        assert box(".filter-column")["width"] == 272
        results["record-1280"] = True
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
        # The table scrolls anyway, so the sticky Enzyme column narrows to its 160px minimum or its longest word.
        enzyme = driver.execute_script("""
            const names = [...document.querySelectorAll('#recordsBody tr[data-key] td.c-enzyme strong')];
            const font = getComputedStyle(names[0]);
            const context = document.createElement('canvas').getContext('2d');
            context.font = `${font.fontStyle} ${font.fontWeight} ${font.fontSize} ${font.fontFamily}`;
            const word = Math.max(...names.flatMap(name => name.textContent.split(/\\s+|(?<=[-,/])/)).map(part => context.measureText(part).width));
            const cell = getComputedStyle(document.querySelector('#recordsBody td.c-enzyme'));
            const padding = parseFloat(cell.paddingLeft) + parseFloat(cell.paddingRight) + 2;
            return {width: document.querySelector('#recordTableWrap thead th.c-enzyme').getBoundingClientRect().width,
                    limit: Math.max(160, Math.ceil(word + padding))};
        """)
        assert enzyme["width"] <= enzyme["limit"] + 1, enzyme
        ActionChains(driver).send_keys(Keys.ESCAPE).perform()
        wait.until(lambda d: not detail_open())
        driver.execute_script("try { localStorage.removeItem('catlog.filtersCollapsed'); } catch (e) {}")
        results["record-1024"] = True
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
            return wrap.scrollWidth <= wrap.clientWidth + 2;
        """), "Beside the rail at 1100px the first page fits without scrolling sideways"
        driver.find_element(By.ID, "filterRailButton").click()
        wait.until(lambda d: is_open() and box(".filter-column")["width"] == 256)
        assert stored() in ("0", "unavailable")
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
            results["phone-320-toolbar"] = True
    except Exception:
        driver.save_screenshot(str(OUTPUT / f"{browser}-{route_label}-layout-failure.png"))
        raise
    finally:
        driver.execute_script("try { localStorage.removeItem('catlog.filtersCollapsed'); } catch (e) {}")
        set_browse_viewport(driver, browser, 1440, 1000)
    return {"route": route_label, "checked": results, "passed": True}


# Words of the earlier pipeline and of CatLog's tooling that a record must never show.
RECORD_PANEL_FORBIDDEN = re.compile(r"independent|AI run|second run|Protein identity|Accession resolved|Normalized|Values in source|Detail shard|CatLog v2")


RECORD_SECTIONS = ["Values", "Source", "Conditions", "Protein and substrate", "Paper", "Against the databases", "Review and audit",
                   "Source details"]

# A malic enzyme variant with 28 substitutions (PMID 24998673): its sequence line is one long run with no spaces.
LONG_VARIANT_RECORD = "e15d2d23d7f3db24"
# A triose phosphate isomerase read from the paper whose calculated kcat/Km (8.49 × 10⁷) carries calc. and a "!".
CALC_FLAG_RECORD = "1704dd2d6297af79"


def check_record_panel(driver, browser, url, route_label):
    """The record (design spec 5): header lines, then Values, Source, Conditions, Protein and substrate, Paper, Against the
    databases (only when it has something to say), Review and audit, and Source details last; a record read from the paper
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
                sections: [...content.querySelectorAll('.detail-section > h3, .detail-disclosure > summary')].map(e => e.textContent.trim()),
                // The status line's dot and the selected row's dot (the same status colour), the definition lists' label
                // column (112px, 96px on phones) and what section G says.
                dotColor: status ? getComputedStyle(status, '::before').backgroundColor : null,
                rowDotColor: selectedDot && selectedDot.getBoundingClientRect().width > 0
                    ? getComputedStyle(selectedDot, '::before').backgroundColor : null,
                labelColumn: getComputedStyle(content.querySelector('.detail-section .kv-line')).gridTemplateColumns.split(' ')[0],
                databasesText: databases ? databases.innerText : null,
                headingSize: getComputedStyle(content.querySelector('.detail-section > h3')).fontSize,
                subtitle: content.querySelector('.detail-top .detail-subtitle')?.textContent || '',
                substrate: content.querySelector('.detail-top .detail-substrate')?.textContent || '',
                status: content.querySelector('.detail-top .detail-status')?.textContent || '',
                recordKey: content.querySelector('.detail-top #detailRecordKey')?.textContent || '',
                dashes: [...content.querySelectorAll('.kv-line > dd')].filter(e => e.textContent.trim() === '—').length,
                method: method ? method.textContent : null,
                methodLink: method?.querySelector('a.method-link')?.getAttribute('href') || null,
                review: row('Status')[0]?.textContent || null,
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
                assert panel["labelColumn"] == ("96px" if width <= 720 else "112px"), panel["labelColumn"]
                assert panel["dotColor"] and panel["dotColor"] not in ("rgba(0, 0, 0, 0)", "transparent"), panel["dotColor"]
                if panel["rowDotColor"]:
                    assert panel["dotColor"] == panel["rowDotColor"], (panel["dotColor"], panel["rowDotColor"])
                if kind.startswith("database") and panel["databasesText"] is not None:
                    # Today's snapshot has no comparison for a database record: only an unsettled one says its values are
                    # the database's.
                    assert "Not yet checked against the paper: the values are the database's." in panel["databasesText"], panel["databasesText"]
                if kind == "database-pending":
                    assert panel["status"].startswith("Not confirmed"), panel["status"]
                    assert "Against the databases" in panel["sections"], panel["sections"]
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
    except Exception:
        driver.save_screenshot(str(OUTPUT / f"{browser}-{route_label}-record-panel-failure.png"))
        raise
    return {"route": route_label, "checked": results, "passed": True}


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
    assert [link.text.replace("\u00a0", " ") for link in external] == ["CatRange paper ↗", "Chowdhury Lab ↗"]
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
    assert len(donut.find_elements(By.CSS_SELECTOR, "path")) == sum(1 for key in ("manual_review_required", "unverified",
        "mathematically_inferred", "disputed") if expected.get(key, 0)) + bool(accepted)
    if overview:
        # Accepted splits into the records read from the paper by CatLog and the earlier catalog's.
        read = overview["from_paper"]["records"]
        assert f"{read:,} read from the paper by CatLog; {accepted - read:,} from the earlier catalog" in accepted_split
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
            assert "Human-checked" in headline and f"{human:,}" in headline
            assert any(href.endswith("#browse?checked=1") for href in hrefs)
        assert f"{overview['from_paper']['records']:,}" in headline and f"from {overview['from_paper']['papers']:,} papers" in headline
        assert any(href.endswith("#browse?source=paper") for href in hrefs)
        forms = stat_rows(".stats-section[aria-labelledby='statsFormTitle'] tr[data-stat-key]")
        assert sum(forms.values()) == total and forms == {key: overview["enzyme_form"][key] for key in ("wild", "variant", "not_stated")}
        classes = stat_rows(".stats-section[aria-labelledby='statsClassesTitle'] [data-stat-key]")
        assert classes == {f"ec_{item['class']}": item["count"] for item in overview["ec_classes"]}
        cautions = stat_rows(".stats-section[aria-labelledby='statsCautionsTitle'] tr[data-stat-key]")
        # Figure 2: each record once under its main source (its bars add up to all records).
        main_rows = {row.get_attribute("data-row"): int(row.get_attribute("data-count"))
                     for row in driver.find_elements(By.CSS_SELECTOR, ".stats-section[aria-labelledby='statsSourcesTitle'] .stats-chart-row")}
        assert sum(main_rows.values()) == total, f"Main sources add up to all records: {main_rows}"
        # The lead: agreement with human reviewers comes first, when the snapshot has its counts.
        agreement = (overview.get("quality") or {}).get("agreement") or {}
        if isinstance(agreement.get("values_approved"), int) and agreement["values_approved"] > 0:
            lead = driver.find_element(By.CSS_SELECTOR, "#statsLead .stats-lead")
            assert driver.execute_script(LEAD_FIRST_JS), "Agreement comes first on Stats, above the headline counts"
            blind = agreement.get("first_agree_unexposed_pct")
            headline = f"{blind:.1f}%" if isinstance(blind, (int, float)) else f"{agreement['agree'] / agreement['values_approved'] * 100:.1f}%"
            assert lead.find_element(By.CSS_SELECTOR, ".stats-lead-figure strong").text == headline
            assert f"{agreement['values_approved']:,}" in lead.text
            # The headline's 95% range under the number when the snapshot gives one.
            ci95 = agreement.get("first_agree_unexposed_ci95")
            if isinstance(blind, (int, float)) and isinstance(ci95, str) and re.match(r"^\d+(\.\d+)?-\d+(\.\d+)?$", ci95):
                assert "95% range" in lead.find_element(By.CSS_SELECTOR, ".stats-lead-figure").text
            # How many differences were checked against the paper, and CatLog wrong in them, even when that is none.
            if all(isinstance(agreement.get(key), int) for key in ("differ", "differ_not_adjudicated", "differ_catlog_wrong")) \
                    and agreement["differ"] > 0 and agreement["differ_catlog_wrong"] <= agreement["differ"] - agreement["differ_not_adjudicated"]:
                checked = agreement["differ"] - agreement["differ_not_adjudicated"]
                assert f"{checked:,} of {agreement['differ']:,}; CatLog wrong in" in lead.text, lead.text
        assert cautions == {f"caution_{key}": count for key, count in overview["cautions"].items()}
        ranges = driver.find_elements(By.CSS_SELECTOR, ".stats-range")
        assert len(ranges) == sum(1 for summary in overview["metrics"].values() if summary.get("n"))
        for figure in ranges:
            summary = overview["metrics"][figure.get_attribute("data-metric")]
            assert int(figure.get_attribute("data-count")) == summary["n"] == sum(summary["counts"])
            assert len(figure.find_elements(By.CSS_SELECTOR, ".stats-histogram-bars > span")) == len(summary["counts"])
            assert figure.find_element(By.CSS_SELECTOR, ".stats-histogram").get_attribute("aria-label").startswith(("kcat", "Km"))
    else:
        assert "Human-checked" not in headline and "CatLog v2" not in headline
        assert not driver.find_elements(By.CSS_SELECTOR, ".stats-range")
    for heading in driver.find_elements(By.CSS_SELECTOR, "#statsCharts h2"):
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
    for width in (1700, 1280, 884, 760):
        driver.set_window_size(width, 1000)
        driver.execute_script("document.querySelector('#statsView').scrollTop=0")
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
        assert driver.execute_script("""
            return [...document.querySelectorAll('.stats-chart')].every(chart => {
                const tracks = [...chart.querySelectorAll('.stats-track')].map(track => track.getBoundingClientRect());
                return tracks.every(box => Math.abs(box.left - tracks[0].left) <= 1 && Math.abs(box.width - tracks[0].width) <= 1);
            });
        """), "Bars of one chart share one scale on phones"
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
        result["stats_figures"] = check_stats_figures(driver, args.browser, url)
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
