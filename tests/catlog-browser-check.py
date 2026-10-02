"""Unmocked public-site checks on disposable Chrome and macOS Safari runners."""

import argparse
import functools
import hashlib
from html.parser import HTMLParser
import http.server
import json
import os
from pathlib import Path
import threading
import urllib.request
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
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


def check_browse(driver, browser, url, route_label):
    """Exercise public Browse, using only rendered rows and generated JSON Blobs."""
    wait = WebDriverWait(driver, 120)
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
        return [row.get_attribute("data-key") for row in driver.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")]

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

    def downloaded_payload(button_id):
        index = driver.execute_script("return window.__catlogBrowserDownloadCapture.downloads.length")
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
            driver.find_element(By.ID, "prevButton").click()
            wait.until(lambda _d: row_keys() == first_keys)

            # Roving row focus, keyboard activation, loaded exact-key details,
            # and Escape must all refer to the same displayed identity.
            rows = driver.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")
            driver.execute_script("arguments[0].focus()", rows[0])
            rows[0].send_keys(Keys.ARROW_DOWN)
            selected_key = first_keys[1]
            assert driver.switch_to.active_element.get_attribute("data-key") == selected_key
            driver.switch_to.active_element.send_keys(Keys.ENTER)
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
            assert driver.find_element(By.ID, "activeSummary").text.endswith(" records")
            screenshots.append(capture(viewport, "search"))
            search.clear()
            search.send_keys("zzzz-no-match-catlog-browser-check", Keys.TAB)
            wait.until(lambda d: d.find_element(By.ID, "activeSummary").text == "0 records")
            assert row_keys() == []
            assert driver.find_element(By.ID, "pageLabel").text == "No records"
            for identifier in ("downloadPageButton", "prevButton", "nextButton"):
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
    return {"url": url, "route": route_label, "total": total,
            "source_sha256": manifest["source_sha256"], "asset_sha256": asset_hashes,
            "viewports": viewports, "passed": True}


def check(driver, browser, url):
    wait = WebDriverWait(driver, 120)
    driver.set_window_size(1440, 1000)
    driver.get(url + ("&" if "?" in url else "?") + "release=link-check#stats")
    wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".stats-review-legend li")) >= 5)
    wait.until(lambda d: not urlsplit(d.current_url).query)
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
        assert target.path == (stats_path if view == "stats" else urlsplit(url).path) and not target.query
        assert target.fragment == ("guide" if view == "guide" else "")
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
    accepted_row = driver.find_element(By.CSS_SELECTOR, '.stats-review-legend [data-stat-key="accepted"]')
    assert int(accepted_row.get_attribute("data-count")) == accepted
    assert f"{accepted / total * 100:.1f}%" in accepted_row.text
    assert not driver.find_element(By.ID, "globalSearchInput").is_displayed()
    assert driver.find_element(By.ID, "statsButton").get_attribute("aria-current") == "page"
    assert sum(int(row.get_attribute("data-count")) for row in driver.find_elements(By.CSS_SELECTOR, ".stats-review-legend li")) == total
    def check_combined_coverage(group):
        slices = {"complete": 0, "only_sequence": 0, "only_smiles": 0, "only_paper_id": 0, "only_kinetic_value": 0, "multiple": 0}
        for item in group["field_combinations"]:
            key = "complete" if not item["missing"] else "only_" + item["missing"][0] if len(item["missing"]) == 1 else "multiple"
            slices[key] += item["count"]
        displayed = {row.get_attribute("data-stat-key"): int(row.get_attribute("data-count"))
                     for row in driver.find_elements(By.CSS_SELECTOR, ".stats-combination-legend li")}
        assert displayed == slices and sum(displayed.values()) == group["total"]
        assert "Available fields do not mean the record is accepted." in driver.find_element(By.CLASS_NAME, "stats-followup-coverage").text
        assert not driver.find_elements(By.CSS_SELECTOR, ".stats-followup-coverage svg"), "Field split belongs in the outcome chart"
        cohort = driver.find_element(By.CSS_SELECTOR, ".stats-followup-coverage").get_attribute("data-cohort")
        outer = {row.get_attribute("data-field-slice"): int(row.get_attribute("data-count"))
                 for row in driver.find_elements(By.CSS_SELECTOR, f'#statsReviewFigure [data-field-group="{cohort}"]')}
        assert outer == {key: count for key, count in slices.items() if count}
        assert sum(outer.values()) == group["total"]
        for field, count_key in (("sequence", "with_sequence"), ("smiles", "with_smiles"), ("paper_id", "with_literature_id"), ("kinetic_value", "with_kinetic_value")):
            row = driver.find_element(By.CSS_SELECTOR, f'.stats-missing-totals [data-field="{field}"]')
            assert int(row.get_attribute("data-missing")) == group["total"] - group[count_key]
        assert driver.execute_script("return parseFloat(getComputedStyle(document.querySelector('.stats-combination-legend li')).fontSize)") >= 15

    check_combined_coverage(manifest["summary"]["review_details"]["groups"]["manual_review_required"])
    assert "Illustrative checks" in driver.find_element(By.CLASS_NAME, "stats-followup-section").get_attribute("textContent")
    assert len(driver.find_elements(By.CSS_SELECTOR, "#statsCharts svg")) == 7
    assert sum(int(row.get_attribute("data-count")) for row in driver.find_elements(By.CSS_SELECTOR, "#statsReviewFigure [data-outcome]")) == total
    assert not driver.find_elements(By.CSS_SELECTOR, ".stats-material-section, .stats-cohort-material"), "Remove material charts, not source records"
    assert driver.execute_script("return document.querySelector('.stats-review-section').contains(document.querySelector('#statsReviewDetails'))")
    assert sum(int(row.get_attribute("data-count")) for row in driver.find_elements(By.CSS_SELECTOR, ".stats-database-section li")) == total
    stats_text = driver.find_element(By.ID, "statsCharts").get_attribute("textContent")
    assert "Not saved" not in stats_text and "tokens" not in stats_text.lower()
    for key in ("verified", "corrected"):
        row = driver.find_element(By.CSS_SELECTOR, f'.stats-accepted-split [data-stat-key="{key}"]')
        assert int(row.get_attribute("data-count")) == expected[key]

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
            return [...document.querySelectorAll('.stats-chart-legend')].every(legend => {
                const head = legend.querySelector('.stats-outcome-head');
                const row = legend.querySelector('li');
                if (!head.getBoundingClientRect().width || !row) return true;
                return [1, 2].every(i => Math.abs(head.children[i].getBoundingClientRect().right
                    - row.children[i].getBoundingClientRect().right) <= 1);
            });
        """), "Stats count headings must align with their values"
        viewports[label] = driver.execute_script("""
            const page = document.scrollingElement, stats = document.querySelector('#statsView');
            return {width: innerWidth, height: innerHeight,
                document_scrolls: page.scrollHeight > page.clientHeight + 1,
                stats_scrolls: stats.scrollHeight > stats.clientHeight + 1};
        """)
        assert not (viewports[label]["document_scrolls"] and viewports[label]["stats_scrolls"]), "Nested vertical page scrolling"
        check_panel_width()
        overflow = driver.execute_script("""
            return [...document.querySelectorAll('.stats-outcome-label, .stats-check-examples dt, .stats-check-examples dd, .stats-field-rings figure, .stats-field-remainder')]
                .filter(e => e.getBoundingClientRect().width && e.scrollWidth > e.clientWidth + 1)
                .map(e => e.textContent);
        """)
        assert not overflow, f"Clipped Stats text: {overflow}"
        driver.save_screenshot(str(OUTPUT / f"{browser}-{label}.png"))

    capture("stats-desktop")
    assert driver.execute_script("""
        const arc = document.querySelector('#statsReviewFigure [data-field-group="manual_review_required"]');
        const rect = arc.ownerSVGElement.getBoundingClientRect();
        const length = parseFloat(arc.getAttribute('stroke-dasharray'));
        const start = -Number(arc.getAttribute('stroke-dashoffset'));
        const angle = (start + length / 2) / 100 * Math.PI * 2 - Math.PI / 2;
        const radius = Number(arc.getAttribute('r')) / 240 * rect.width;
        return document.elementFromPoint(rect.left + rect.width / 2 + Math.cos(angle) * radius,
            rect.top + rect.height / 2 + Math.sin(angle) * radius) === arc;
    """), "The chart center must not block segment labels on hover"
    examples = driver.find_element(By.CSS_SELECTOR, ".stats-review-overview details")
    examples.find_element(By.TAG_NAME, "summary").click()
    for cohort in ("unverified", "mathematically_inferred", "manual_review_required"):
        driver.find_element(By.CSS_SELECTOR, f'[data-stats-cohort="{cohort}"]').click()
        group = manifest["summary"]["review_details"]["groups"][cohort]
        radio = driver.find_element(By.CSS_SELECTOR, f'input[name="statsCohort"][value="{cohort}"]')
        assert radio.is_selected() and driver.switch_to.active_element == radio
        assert examples.get_attribute("open") is not None, "Group selection must preserve open explanations"
        check_combined_coverage(group)
        assert driver.find_element(By.CSS_SELECTOR, ".stats-outer-group.selected").get_attribute("data-review-group") == cohort
        assert driver.find_element(By.CSS_SELECTOR, f'[data-stats-cohort="{cohort}"]').get_attribute("aria-pressed") == "true"
        capture("stats-" + cohort)
    examples.find_element(By.TAG_NAME, "summary").click()
    def click_arc(selector, touch=False):
        arc = driver.find_element(By.CSS_SELECTOR, selector)
        point = driver.execute_script("""
            const arc = arguments[0];
            arc.scrollIntoView({block: 'center'});
            const rect = arc.ownerSVGElement.getBoundingClientRect();
            const share = parseFloat(arc.getAttribute('stroke-dasharray'));
            const start = -Number(arc.getAttribute('stroke-dashoffset'));
            const angle = (start + share / 2) / 100 * Math.PI * 2 - Math.PI / 2;
            const radius = Number(arc.getAttribute('r')) / 240 * rect.width;
            const x = Math.round(rect.left + rect.width / 2 + Math.cos(angle) * radius);
            const y = Math.round(rect.top + rect.height / 2 + Math.sin(angle) * radius);
            return {x, y, hit: document.elementFromPoint(x, y) === arc};
        """, arc)
        assert point["hit"], f"Another element blocks the chart segment: {selector}"
        if touch:
            driver.execute_cdp_cmd("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": point["x"], "y": point["y"]}]})
            driver.execute_cdp_cmd("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        else:
            actions = ActionChains(driver)
            actions.w3c_actions.pointer_action.move_to_location(point["x"], point["y"])
            actions.w3c_actions.pointer_action.click()
            actions.perform()
        assert arc.get_attribute("aria-pressed") == "true"
        assert arc == driver.switch_to.active_element, "Keep chart focus on the selected segment"
        assert driver.execute_script("return getComputedStyle(arguments[0]).outlineStyle", arc) == "none", "Do not draw a full-circle focus rectangle for pointer input"
        return arc

    click_arc('#statsReviewFigure [data-outcome="accepted"]')
    assert driver.find_element(By.ID, "fieldsGroupHeading").text == "Accepted records"
    assert f"{accepted:,} records" in driver.find_element(By.ID, "statsReviewDetails").text
    assert not driver.find_elements(By.CSS_SELECTOR, ".stats-combination-legend")
    # Tiny outcomes remain keyboard accessible without inflating their visual share.
    disputed = driver.find_element(By.CSS_SELECTOR, '#statsReviewFigure [data-outcome="disputed"]')
    driver.execute_script("arguments[0].focus({preventScroll: true})", disputed)
    assert disputed == driver.switch_to.active_element
    ActionChains(driver).send_keys(Keys.ENTER).perform()
    assert driver.find_element(By.ID, "fieldsGroupHeading").text == "Disputed records"
    for cohort in ("unverified", "mathematically_inferred", "manual_review_required"):
        click_arc(f'#statsReviewFigure [data-outcome="{cohort}"]')
        check_combined_coverage(manifest["summary"]["review_details"]["groups"][cohort])
        for field in ("complete", "only_sequence", "multiple"):
            selector = f'#statsReviewFigure [data-field-group="{cohort}"][data-field-slice="{field}"]'
            if not driver.find_elements(By.CSS_SELECTOR, selector):
                row = driver.find_element(By.CSS_SELECTOR, f'.stats-combination-legend [data-stat-key="{field}"]')
                assert row.get_attribute("data-count") == "0", "Only zero-count categories may omit an arc"
                continue
            arc = click_arc(selector)
            row = driver.find_element(By.CSS_SELECTOR, ".stats-combination-legend li.is-selected")
            assert row.get_attribute("data-stat-key") == field
            assert row.get_attribute("data-count") == arc.get_attribute("data-count")
            assert driver.find_element(By.ID, "statsChartAnnouncement").get_attribute("textContent") == arc.get_attribute("aria-label")
            assert driver.find_element(By.ID, "statsRingCount").text == f"{int(arc.get_attribute('data-count')):,}"
            if field == "multiple":
                assert driver.find_element(By.CSS_SELECTOR, ".stats-combination-details").get_attribute("open") is not None
    capture("stats-chart-selection")
    keyboard_arc = driver.find_element(By.CSS_SELECTOR, '#statsReviewFigure [data-field-group="unverified"][data-field-slice="only_sequence"]')
    driver.execute_script("arguments[0].focus({preventScroll: true})", keyboard_arc)
    assert keyboard_arc == driver.switch_to.active_element
    before_scroll = driver.execute_script("return document.querySelector('#statsView').scrollTop")
    ActionChains(driver).send_keys(Keys.SPACE).perform()
    assert keyboard_arc.get_attribute("aria-pressed") == "true"
    assert driver.execute_script("return getComputedStyle(arguments[0]).stroke", keyboard_arc) == "rgb(23, 44, 58)", "Keyboard focus must have a visible segment indicator"
    assert driver.execute_script("return document.querySelector('#statsView').scrollTop") == before_scroll
    assert driver.find_element(By.CSS_SELECTOR, ".stats-combination-legend li.is-selected").get_attribute("data-stat-key") == "only_sequence"
    driver.find_element(By.CSS_SELECTOR, '.stats-review-legend [data-stats-cohort="manual_review_required"]').click()
    selected = driver.find_element(By.CSS_SELECTOR, 'input[name="statsCohort"]:checked')
    selected.send_keys(Keys.ARROW_RIGHT)
    assert driver.find_element(By.CSS_SELECTOR, 'input[name="statsCohort"][value="unverified"]').is_selected()
    driver.find_element(By.CSS_SELECTOR, 'input[name="statsCohort"][value="manual_review_required"]').find_element(By.XPATH, "..").click()
    driver.execute_script("document.querySelector('#statsView').scrollTop=0")
    for element in driver.find_elements(By.CSS_SELECTOR, "#statsView details > summary"):
        parent = element.find_element(By.XPATH, "..")
        was_open = parent.get_attribute("open") is not None
        element.click()
        assert (parent.get_attribute("open") is not None) != was_open
        check_panel_width()
        element.click()
        assert (parent.get_attribute("open") is not None) == was_open
    driver.execute_script("window.scrollTo(0, 0)")
    driver.find_element(By.ID, "downloadMenu").find_element(By.TAG_NAME, "summary").click()
    for identifier in ("enrichedDataButton", "exportSnapshotButton"):
        link = driver.find_element(By.ID, identifier)
        assert link.is_displayed()
        with urllib.request.urlopen(urllib.request.Request(link.get_attribute("href"), method="HEAD"), timeout=30) as response:
            assert response.status == 200 and int(response.headers["Content-Length"]) > 1_000_000
    driver.find_element(By.ID, "downloadMenu").find_element(By.TAG_NAME, "summary").click()

    driver.find_element(By.ID, "browseButton").click()
    wait.until(lambda d: d.find_element(By.ID, "activeSummary").text == f"{total:,} records")
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
    driver.find_element(By.ID, "statsButton").click()
    driver.execute_script("window.scrollTo(0, 0)")
    driver.set_window_size(1080, 900)
    capture("stats-compact")
    for width in (1080, 884, 760):
        driver.set_window_size(width, 1000)
        driver.execute_script("document.querySelector('#statsView').scrollTop=0")
        assert driver.execute_script("""
            const chart = document.querySelector('.stats-nested-ring').getBoundingClientRect();
            const fields = document.querySelector('.stats-combination-legend').getBoundingClientRect();
            const first = document.querySelector('.stats-combination-legend li').getBoundingClientRect();
            return fields.left >= chart.right && first.top < chart.bottom && fields.bottom > chart.top;
        """), "Field counts must stay beside the chart at laptop and in-app browser widths"
        assert driver.execute_script("""
            const group = document.querySelector('.stats-followup-coverage').dataset.cohort;
            return [...document.querySelectorAll('.stats-combination-legend li')].every(row => {
                const arc = document.querySelector(`[data-field-group="${group}"][data-field-slice="${row.dataset.statKey}"]`);
                return !arc || getComputedStyle(arc).stroke === getComputedStyle(row.querySelector('i')).backgroundColor;
            });
        """), "Field colors must match between chart and count list"
        capture(f"stats-adjacent-{width}")
    if browser == "chrome":
        driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True})
        assert driver.execute_script("return innerWidth") == 390
        assert driver.execute_script("return matchMedia('(max-width: 520px)').matches")
        driver.execute_cdp_cmd("Emulation.setTouchEmulationEnabled", {"enabled": True})
        click_arc('#statsReviewFigure [data-field-group="manual_review_required"][data-field-slice="only_sequence"]', touch=True)
        assert driver.find_element(By.CSS_SELECTOR, ".stats-combination-legend li.is-selected").get_attribute("data-stat-key") == "only_sequence"
        capture("stats-mobile-chart-selection")
        capture("stats-mobile")
        driver.execute_script("document.querySelector('.stats-followup-section').scrollIntoView()")
        capture("stats-mobile-followup")
        for cohort in ("unverified", "mathematically_inferred"):
            driver.find_element(By.CSS_SELECTOR, f'input[name="statsCohort"][value="{cohort}"]').find_element(By.XPATH, "..").click()
            driver.execute_script("document.querySelector('#statsReviewDetails').scrollIntoView()")
            capture("stats-mobile-" + cohort)
            for element in driver.find_elements(By.CSS_SELECTOR, "#statsReviewDetails details > summary"):
                element.click()
                check_panel_width()
                element.click()
        assert driver.execute_script("""
            const chart = document.querySelector('.stats-nested-figure').getBoundingClientRect();
            const legend = document.querySelector('.stats-review-legend').getBoundingClientRect();
            return legend.top >= chart.bottom;
        """)
        capture("stats-mobile-source-material")
    assert not driver.find_elements(By.CSS_SELECTOR, ".catalog-load-failed"), "Browser reported a load failure"
    # A clean Stats address must also survive a fresh page load, not just history navigation.
    driver.refresh()
    wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".stats-combination-legend li")) == 6)
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
