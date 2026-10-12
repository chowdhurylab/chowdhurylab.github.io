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
    assert driver.find_elements(By.CSS_SELECTOR, '#guide-status a[href="#guide-method"]'), "The from-paper tag links to the method"
    guide_text = driver.find_element(By.ID, "guideView").text
    for word in ("CatLog v2", "independent", "AI run", "Checks pending", "Exporter", "exporter"):
        assert word not in guide_text, f"The Guide still says {word}"
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

    def exact_pair(record):
        pair = [record.get("measurement_key"), record.get("review_key")]
        assert all(isinstance(value, str) and value and value == value.strip() for value in pair)
        return pair

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
            driver.find_element(By.ID, "nextButton").click()
            wait.until(lambda _d: row_keys() != first_keys)
            page_keys = row_keys()
            assert len(page_keys) == len(set(page_keys)) == 25 and not set(first_keys) & set(page_keys)
            assert driver.find_element(By.ID, "pageLabel").text == f"26–50 of {total:,}"
            assert driver.find_element(By.ID, "prevButton").is_enabled()
            screenshots.append(capture(viewport, "page-2"))
            page_payload = downloaded_payload("downloadPageButton")
            assert [record.get("record_key") for record in page_payload["records"]] == page_keys
            page_pairs = [exact_pair(record) for record in page_payload["records"]]
            assert len({tuple(pair) for pair in page_pairs}) == 25
            assert page_payload["metadata"]["page"] == 2 and page_payload["metadata"]["row_count"] == 25
            assert page_payload["metadata"]["export_scope"] == "current_page_public_records"
            assert page_payload["metadata"]["source_sha256"] == manifest["source_sha256"]
            assert page_payload["metadata"]["snapshot_generated_at"] == manifest["generated_at"]
            # Export results as CSV: this page, one line per record shown, in order.
            header, csv_rows = downloaded_csv("exportPageCsvButton")
            assert header[0] == "record_key" and {"kcat_unit", "review_result", "source", "pubmed_id", "doi"} <= set(header)
            assert [line.split(",", 1)[0] for line in csv_rows] == page_keys
            driver.find_element(By.ID, "prevButton").click()
            wait.until(lambda _d: row_keys() == first_keys)

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
            assert record_payload["summary"]["record_key"] == selected_key
            selected_pair = exact_pair(record_payload["summary"])
            assert exact_pair(record_payload["detail"]) == exact_pair(loaded_detail) == selected_pair
            displayed_id = driver.execute_script("""
                return [...document.querySelectorAll('#detailContent .kv-line')]
                    .filter(e => e.querySelector('span')?.textContent === 'CatLog record ID')
                    .map(e => e.querySelector('strong').textContent);
            """)
            assert displayed_id == [selected_pair[0]]
            ActionChains(driver).send_keys(Keys.ESCAPE).perform()
            wait.until(lambda d: not d.execute_script("return document.body.classList.contains('detail-open')"))
            assert driver.switch_to.active_element.get_attribute("data-key") == selected_key
            assert "hidden" in driver.find_element(By.ID, "detailContent").get_attribute("class").split()

            search = driver.find_element(By.ID, "globalSearchInput")
            search.send_keys(selected_pair[0], Keys.TAB)
            wait.until(lambda _d: selected_key in row_keys() and row_keys() != first_keys)
            assert search.get_attribute("value") == selected_pair[0]
            assert driver.find_element(By.ID, "activeSummary").text.endswith((" record", " records"))
            # Export results as CSV: every matching record, as many lines as the count says.
            matching = int(driver.find_element(By.ID, "activeSummary").text.split()[0].replace(",", ""))
            assert driver.find_element(By.ID, "exportAllCsvLabel").get_attribute("textContent").startswith(f"All {matching:,} matching")
            _header, csv_rows = downloaded_csv("exportAllCsvButton")
            assert len(csv_rows) == matching and selected_key in {line.split(",", 1)[0] for line in csv_rows}
            screenshots.append(capture(viewport, "search"))
            search.clear()
            search.send_keys("zzzz-no-match-catlog-browser-check", Keys.TAB)
            wait.until(lambda d: d.find_element(By.ID, "activeSummary").text == "0 records")
            assert row_keys() == []
            assert driver.find_element(By.ID, "pageLabel").text == "No records"
            for identifier in ("downloadPageButton", "exportPageCsvButton", "exportAllCsvButton", "prevButton", "nextButton"):
                assert not driver.find_element(By.ID, identifier).is_enabled()
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
                "selected_record_key": selected_key, "selected_identity": selected_pair,
                "page_download_identities": page_pairs, "screenshots": screenshots, "passed": True}
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


def check_quality(driver, browser, url, quality=None):
    """Stats' AI audits and Human review boxes and the Guide's method section give the audit and human-review numbers
    of overview.quality. Without a quality object in the snapshot, a copy of the manifest with QUALITY_FIXTURE (set in
    Chrome before the page starts; the data files are not changed) is checked instead."""
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
    try:
        set_browse_viewport(driver, browser, 1440, 1000)
        driver.get("about:blank")
        driver.get(url.replace("catlog-latest.html", "catlog-stats.html"))
        wait.until(lambda d: d.find_elements(By.ID, "statsHumanTitle"))
        if audited:
            audit = driver.find_element(By.CSS_SELECTOR, "[aria-labelledby='statsAuditTitle']").text
            assert f"{quality['audit_values']:,} values re-checked against their papers" in audit, audit
            assert "independent" not in audit.lower(), audit
        human = driver.find_element(By.CSS_SELECTOR, "[aria-labelledby='statsHumanTitle']").text
        if compared:
            # The share correct is shown only with the label errors beside it.
            assert correct in human and f"and {quality['label_or_annotation_v1']:,} had a wrong enzyme, organism" in human, human
        boxes = driver.execute_script("""
            return [...document.querySelectorAll('.stats-boxes > .stats-section')].map(box => box.getBoundingClientRect().top);
        """)
        assert len(boxes) == 2 + audited and max(boxes) - min(boxes) < 2, f"The boxes stand side by side: {boxes}"
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

        # 2. Human-checked: open the docked panel (wide screens: no dialog, the table stays usable), tick it, and every row
        # shown carries the "human-checked" tag; the count beside it is the number of records.
        driver.find_element(By.ID, "openFiltersButton").click()
        wait.until(lambda d: d.find_element(By.ID, "humanCheckedFilter").is_displayed())
        assert driver.find_element(By.ID, "catalogFilters").get_attribute("role") is None, "Wide screens dock the filters"
        assert not driver.execute_script("return document.querySelector('.table-panel').inert")
        assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth + 1"), "Docked filters overflow the page"
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

        # 3. A pH range typed into the panel: every row shown has a pH inside it, and the address carries it.
        open_page(base)
        driver.find_element(By.ID, "openFiltersButton").click()
        wait.until(lambda d: d.find_element(By.ID, "phMinInput").is_displayed())
        driver.find_element(By.ID, "phMinInput").send_keys("7")
        driver.find_element(By.ID, "phMaxInput").send_keys("7.5", Keys.TAB)
        wait.until(lambda d: fragment() == "browse?phmin=7&phmax=7.5")
        wait_ready()
        assert chip_keys() == ["ph"]
        ph_values = cells("c-ph")
        assert ph_values and all(7 <= float(value) <= 7.5 for value in ph_values), ph_values
        ActionChains(driver).send_keys(Keys.ESCAPE).perform()
        wait.until(lambda d: not d.execute_script("return document.body.classList.contains('filters-open')"))
        if browser == "chrome":
            # Phones keep the filters as a sheet that ends with "Show N records".
            set_browse_viewport(driver, browser, 390, 844)
            driver.find_element(By.ID, "openFiltersButton").click()
            wait.until(lambda d: d.find_element(By.ID, "showResultsButton").is_displayed())
            assert driver.find_element(By.ID, "catalogFilters").get_attribute("role") == "dialog"
            assert driver.find_element(By.ID, "showResultsButton").text == f"Show {summary()}"
            assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth + 1")
            driver.find_element(By.ID, "showResultsButton").click()
            wait.until(lambda d: not d.execute_script("return document.body.classList.contains('filters-open')"))
            set_browse_viewport(driver, browser, 1440, 1000)
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
        driver.find_element(By.ID, "openFiltersButton").click()
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


# Words of the earlier pipeline and of CatLog's tooling that a record must never show.
RECORD_PANEL_FORBIDDEN = re.compile(r"independent|AI run|second run|Protein identity|Accession resolved|Normalized|Values in source|Detail shard|CatLog v2")


def check_record_panel(driver, browser, url, route_label):
    """The record: header lines, then Measurement, Assay conditions, Paper and review, Protein and structure and Source
    details; a record read from the paper says how in its Method line (with the Guide link) and gives its values as
    printed; an older record names the earlier automated review; no labelled row shows a bare dash."""
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
                .filter(e => e.querySelector('span')?.textContent === label).map(e => e.querySelector('strong'));
            const method = row('Method')[0];
            return {
                sections: [...content.querySelectorAll('.detail-section > h3, .detail-disclosure > summary')].map(e => e.textContent.trim()),
                subtitle: content.querySelector('.detail-top .detail-subtitle')?.textContent || '',
                substrate: content.querySelector('.detail-top .detail-substrate')?.textContent || '',
                status: content.querySelector('.detail-top .detail-status')?.textContent || '',
                dashes: [...content.querySelectorAll('.kv-line > strong')].filter(e => e.textContent.trim() === '—').length,
                method: method ? method.textContent : null,
                methodLink: method?.querySelector('a.method-link')?.getAttribute('href') || null,
                review: row('Review')[0]?.textContent || null,
                valuesHead: [...content.querySelectorAll('.values-table thead th')].map(e => e.textContent),
                text: content.innerText,
                overflow: document.documentElement.scrollWidth > innerWidth + 1
                    || document.querySelector('.detail-panel').scrollWidth > document.querySelector('.detail-panel').clientWidth + 1,
            };
        """)

    sizes = [("desktop", 1440, 1000)] + ([("mobile", 390, 844)] if browser == "chrome" else [])
    try:
        for label, width, height in sizes:
            set_browse_viewport(driver, browser, width, height)
            for kind, address in (("from-paper", "#browse?source=paper&status=accepted"), ("database", "#browse?source=brenda")):
                panel = open_first_record(address)
                assert panel["sections"] == ["Measurement", "Assay conditions", "Paper and review", "Protein and structure",
                                             "Source details"], panel["sections"]
                assert panel["subtitle"].startswith("EC "), panel["subtitle"]
                assert panel["substrate"].startswith("Substrate: "), panel["substrate"]
                assert panel["dashes"] == 0, "A labelled row shows a bare dash"
                assert not RECORD_PANEL_FORBIDDEN.search(panel["text"]), RECORD_PANEL_FORBIDDEN.search(panel["text"]).group(0)
                assert not panel["overflow"], f"The {kind} record overflows sideways at {width}px"
                if kind == "from-paper":
                    assert "from paper" in panel["status"], panel["status"]
                    assert panel["method"] and panel["method"].startswith(
                        "Read from the paper by an AI model; a second, separate AI check compared each value with the paper;"), panel["method"]
                    assert panel["methodLink"] == "#guide-method"
                    assert panel["valuesHead"][1:3] == ["As printed", "In catalog units"], panel["valuesHead"]
                    assert panel["review"] is None
                else:
                    assert panel["method"] is None and "earlier automated review" in (panel["review"] or ""), panel["review"]
                driver.save_screenshot(str(OUTPUT / f"{browser}-{route_label}-record-{kind}-{label}.png"))
                results[f"{kind}-{label}"] = True
                ActionChains(driver).send_keys(Keys.ESCAPE).perform()
                wait.until(lambda d: not d.execute_script("return document.body.classList.contains('detail-open')"))
        set_browse_viewport(driver, browser, 1440, 1000)
    except Exception:
        driver.save_screenshot(str(OUTPUT / f"{browser}-{route_label}-record-panel-failure.png"))
        raise
    return {"route": route_label, "checked": results, "passed": True}


def check(driver, browser, url):
    wait = WebDriverWait(driver, 120, ignored_exceptions=(StaleElementReferenceException,))
    expected_query = parse_qsl(urlsplit(url).query, keep_blank_values=True)
    driver.set_window_size(1440, 1000)
    driver.get(url + ("&" if "?" in url else "?") + "release=link-check#stats")
    wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".stats-status-section .stats-bars li")) >= 5)
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
    for view in ("browse", "guide", "stats"):
        link = driver.find_element(By.ID, view + "Button")
        reported_tag = link.tag_name
        print(f"{browser} {view} link tag: {reported_tag!r}", flush=True)
        assert reported_tag.lower() == "a", f"Expected a navigation link, got {reported_tag!r}"
        target = urlsplit(link.get_attribute("href"))
        assert target.path == (stats_path if view == "stats" else urlsplit(url).path)
        assert parse_qsl(target.query, keep_blank_values=True) == expected_query
        assert target.fragment == ("guide" if view == "guide" else "")
    # The catalog's own tabs, then the links out apart at the right.
    assert [link.text for link in driver.find_elements(By.CSS_SELECTOR, ".top-nav a")] == ["Browse", "Stats", "Guide"]
    external = driver.find_elements(By.CSS_SELECTOR, ".external-nav a")
    assert [link.text.replace("\u00a0", " ") for link in external] == ["CatRange paper ↗", "Chowdhury Lab ↗"]
    assert external[0].location["x"] > driver.find_element(By.ID, "guideButton").location["x"]
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
    status_rows = stat_rows(".stats-status-section .stats-bars li:not([data-group])")
    assert sum(status_rows.values()) == total, "Status rows must add up to all records"
    assert status_rows["accepted"] == accepted
    assert status_rows["manual_review_required"] == expected.get("manual_review_required", 0)
    for key in ("unverified", "mathematically_inferred", "disputed"):
        assert status_rows[key] == expected.get(key, 0)
    group = driver.find_element(By.CSS_SELECTOR, '.stats-status-section li[data-group][data-stat-key="not_verified"]')
    assert int(group.get_attribute("data-count")) == expected.get("unverified", 0) + expected.get("mathematically_inferred", 0)
    assert "Not checked" in group.text and "Other records" not in driver.find_element(By.CLASS_NAME, "stats-status-section").text
    pending_row = driver.find_element(By.CSS_SELECTOR, '.stats-status-section [data-stat-key="manual_review_required"]')
    assert "Not confirmed" in pending_row.text and "Checks pending" not in pending_row.text
    accepted_row = driver.find_element(By.CSS_SELECTOR, '.stats-status-section [data-stat-key="accepted"]')
    assert f"{accepted / total * 100:.1f}%" in accepted_row.text
    assert f"{expected.get('corrected', 0):,} after a correction" in accepted_row.text
    if overview:
        # Accepted splits into the records read from the paper by CatLog and the earlier catalog's.
        read = overview["from_paper"]["records"]
        assert f"{read:,} read from the paper by CatLog; {accepted - read:,} from the earlier catalog" in accepted_row.text
        assert f"({expected.get('verified', 0) - read:,} as printed" in accepted_row.text
    else:
        assert f"{expected.get('verified', 0):,}" in accepted_row.text
    identity_only = {item["label"]: item["count"] for item in manifest["summary"]["distributions"].get("public_trust_basis", [])}.get("identity_only", 0)
    if identity_only:
        assert f"{identity_only:,} accepted records have no PMID or DOI linked" in driver.find_element(By.CLASS_NAME, "stats-status-section").text

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
    for fragment in ("#browse?status=accepted", "#browse?status=curation_pending", "#browse?status=not_verified"):
        assert any(href.endswith(fragment) for href in hrefs), f"Missing Stats link {fragment}"

    # Main source: counted as the Browse source filter finds records (a record merged from several databases counts
    # under each), so every record is counted at least once; the Guide's source list gives the same numbers.
    source_rows = stat_rows(".stats-section[aria-labelledby='statsSourcesTitle'] .stats-bars li")
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
        forms = stat_rows(".stats-section[aria-labelledby='statsFormTitle'] .stats-bars li")
        assert sum(forms.values()) == total and forms == {key: overview["enzyme_form"][key] for key in ("wild", "variant", "not_stated")}
        classes = stat_rows(".stats-section[aria-labelledby='statsClassesTitle'] .stats-bars li")
        assert classes == {f"ec_{item['class']}": item["count"] for item in overview["ec_classes"]}
        cautions = stat_rows(".stats-section[aria-labelledby='statsCautionsTitle'] .stats-bars li")
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
            return [...document.querySelectorAll('.stats-bars-head')].every(head => {
                const row = head.nextElementSibling?.querySelector('li');
                if (!head.getBoundingClientRect().width || !row) return true;
                return [2, 3].every(i => Math.abs(head.children[i].getBoundingClientRect().right
                    - row.children[i].getBoundingClientRect().right) <= 1);
            });
        """), "Stats count headings must align with their values"
        assert driver.execute_script("""
            return [...document.querySelectorAll('.stats-bars li')].every(row => {
                const style = getComputedStyle(row);
                return parseFloat(style.fontSize) >= 15;
            });
        """), "Stats rows keep 15px labels"
        viewports[label] = driver.execute_script("""
            const page = document.scrollingElement, stats = document.querySelector('#statsView');
            return {width: innerWidth, height: innerHeight,
                document_scrolls: page.scrollHeight > page.clientHeight + 1,
                stats_scrolls: stats.scrollHeight > stats.clientHeight + 1};
        """)
        assert not (viewports[label]["document_scrolls"] and viewports[label]["stats_scrolls"]), "Nested vertical page scrolling"
        check_panel_width()
        overflow = driver.execute_script("""
            return [...document.querySelectorAll('.stats-bar-label, .stats-bar-count, .stats-bar-share, .stats-totals dd, .stats-range-numbers dd')]
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

    # A linked Stats count is the number of records its link opens: the most common organism (with its strains) and
    # BRENDA (records merged from several databases count under each).
    for selector in (".stats-section[aria-labelledby='statsOrganismsTitle'] .stats-bars li",
                     ".stats-section[aria-labelledby='statsSourcesTitle'] .stats-bars li[data-stat-key='source_brenda']"):
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
                   and len(d.find_elements(By.CSS_SELECTOR, ".stats-status-section .stats-bars li")) >= 5)

    # A Stats link opens Browse; Back returns to Stats.
    pending_link = driver.find_element(By.CSS_SELECTOR, '.stats-status-section [data-stat-key="manual_review_required"] a.stats-link')
    driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", pending_link)
    pending_link.click()
    wait.until(lambda d: d.find_element(By.ID, "catalogView").is_displayed())
    assert urlsplit(driver.current_url).path == urlsplit(url).path
    driver.back()
    wait.until(lambda d: d.find_element(By.ID, "statsView").is_displayed()
               and len(d.find_elements(By.CSS_SELECTOR, ".stats-status-section .stats-bars li")) >= 5)

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
    assert driver.find_element(By.ID, "statsScope").text == f"All {total:,} records, before filtering."
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
            return [...document.querySelectorAll('.stats-bars li')].filter(row => row.getBoundingClientRect().width).every(row => {
                const label = row.querySelector('.stats-bar-label').getBoundingClientRect();
                const track = row.querySelector('.stats-bar-track').getBoundingClientRect();
                const count = row.querySelector('.stats-bar-count').getBoundingClientRect();
                return label.right <= track.left + 1 && track.right <= count.left + 1;
            });
        """), "Each bar sits between its name and its count"
        capture(f"stats-{width}")
    if browser == "chrome":
        driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": 375, "height": 812, "deviceScaleFactor": 1, "mobile": True})
        assert driver.execute_script("return innerWidth") == 375
        assert driver.execute_script("return matchMedia('(max-width: 520px)').matches")
        driver.execute_script("document.querySelector('#statsView').scrollTop=0")
        capture("stats-mobile")
        assert driver.execute_script("""
            return [...document.querySelectorAll('.stats-bars li:not([data-group])')].filter(row => row.getBoundingClientRect().width).every(row => {
                const label = row.querySelector('.stats-bar-label').getBoundingClientRect();
                const track = row.querySelector('.stats-bar-track').getBoundingClientRect();
                return label.bottom <= track.top + 1;
            });
        """), "On phones each name sits above its bar"
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
    wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".stats-status-section .stats-bars li")) >= 5)
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
