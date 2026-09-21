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
from urllib.parse import urljoin, urlsplit

from selenium import webdriver
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


def check(driver, browser, url):
    wait = WebDriverWait(driver, 120)
    driver.set_window_size(1440, 1000)
    driver.get(url + "#stats")
    wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".stats-review-legend li")) >= 5)
    assets = AssetReferences()
    assets.feed((ROOT / "tools/catlog-latest.html").read_text())
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
    coverage = manifest["summary"]["followup_coverage"]
    assert len(driver.find_elements(By.CSS_SELECTOR, ".stats-followup-coverage figure")) == 4
    assert f'{coverage["with_kinetic_value"]:,}' in driver.find_element(By.CLASS_NAME, "stats-followup-coverage").text
    assert "Illustrative checks" in driver.find_element(By.CLASS_NAME, "stats-followup-section").get_attribute("textContent")
    for figure in driver.find_elements(By.CSS_SELECTOR, ".stats-followup-coverage figure"):
        assert int(figure.get_attribute("data-total")) == coverage["total"]
        assert int(figure.get_attribute("data-count")) == coverage[figure.get_attribute("data-stat-key")]
    assert len(driver.find_elements(By.CSS_SELECTOR, "#statsCharts .stats-review-ring svg")) == 13
    assert sum(int(row.get_attribute("data-count")) for row in driver.find_elements(By.CSS_SELECTOR, ".stats-material-section li")) == total
    assert sum(int(row.get_attribute("data-count")) for row in driver.find_elements(By.CSS_SELECTOR, ".stats-database-section li")) == total
    stats_text = driver.find_element(By.ID, "statsCharts").get_attribute("textContent")
    assert "Not saved" not in stats_text and "tokens" not in stats_text.lower()
    for key in ("verified", "corrected"):
        row = driver.find_element(By.CSS_SELECTOR, f'.stats-accepted-split [data-stat-key="{key}"]')
        assert int(row.get_attribute("data-count")) == expected[key]

    viewports = {}

    def capture(label):
        viewports[label] = driver.execute_script("""
            const page = document.scrollingElement, stats = document.querySelector('#statsView');
            return {width: innerWidth, height: innerHeight,
                document_scrolls: page.scrollHeight > page.clientHeight + 1,
                stats_scrolls: stats.scrollHeight > stats.clientHeight + 1};
        """)
        assert not (viewports[label]["document_scrolls"] and viewports[label]["stats_scrolls"]), "Nested vertical page scrolling"
        assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth + 1"), "Horizontal page overflow"
        overflow = driver.execute_script("""
            return [...document.querySelectorAll('.stats-outcome-label, .stats-check-examples dt, .stats-check-examples dd, .stats-field-rings figure, .stats-field-remainder')]
                .filter(e => e.getBoundingClientRect().width && e.scrollWidth > e.clientWidth + 1)
                .map(e => e.textContent);
        """)
        assert not overflow, f"Clipped Stats text: {overflow}"
        driver.save_screenshot(str(OUTPUT / f"{browser}-{label}.png"))

    capture("stats-desktop")
    for cohort in ("unverified", "mathematically_inferred", "manual_review_required"):
        driver.find_element(By.CSS_SELECTOR, f'[data-stats-cohort="{cohort}"]').click()
        group = manifest["summary"]["review_details"]["groups"][cohort]
        radio = driver.find_element(By.CSS_SELECTOR, f'input[name="statsCohort"][value="{cohort}"]')
        assert radio.is_selected() and driver.switch_to.active_element == radio
        for figure in driver.find_elements(By.CSS_SELECTOR, ".stats-followup-coverage figure"):
            assert int(figure.get_attribute("data-total")) == group["total"]
            assert int(figure.get_attribute("data-count")) == group[figure.get_attribute("data-stat-key")]
        assert sum(int(row.get_attribute("data-count")) for row in driver.find_elements(By.CSS_SELECTOR, ".stats-cohort-material li")) == group["total"]
        capture("stats-" + cohort)
    selected = driver.find_element(By.CSS_SELECTOR, 'input[name="statsCohort"]:checked')
    selected.send_keys(Keys.ARROW_RIGHT)
    assert driver.find_element(By.CSS_SELECTOR, 'input[name="statsCohort"][value="unverified"]').is_selected()
    driver.find_element(By.CSS_SELECTOR, 'input[name="statsCohort"][value="manual_review_required"]').find_element(By.XPATH, "..").click()
    driver.execute_script("document.querySelector('#statsView').scrollTop=0")
    for element in driver.find_elements(By.CSS_SELECTOR, "#statsView details > summary"):
        element.click()
        assert element.find_element(By.XPATH, "..").get_attribute("open") is not None
        element.click()
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
    assert len(driver.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")) == 25
    search = driver.find_element(By.ID, "globalSearchInput")
    search.send_keys("laccase", Keys.TAB)
    assert search.get_attribute("value") == "laccase"
    wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]") and all("laccase" in row.text.lower() for row in d.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")))
    result_count = driver.find_element(By.ID, "activeSummary").text
    driver.find_element(By.ID, "statsButton").click()
    assert driver.find_element(By.ID, "statsScope").text == f"All {total:,} records, before filtering."
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
    driver.find_element(By.ID, "statsButton").click()
    driver.execute_script("window.scrollTo(0, 0)")
    driver.set_window_size(1080, 900)
    capture("stats-compact")
    if browser == "chrome":
        driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True})
        assert driver.execute_script("return innerWidth") == 390
        assert driver.execute_script("return matchMedia('(max-width: 520px)').matches")
        capture("stats-mobile")
        driver.execute_script("document.querySelector('.stats-followup-section').scrollIntoView()")
        capture("stats-mobile-followup")
        for cohort in ("unverified", "mathematically_inferred"):
            driver.find_element(By.CSS_SELECTOR, f'input[name="statsCohort"][value="{cohort}"]').find_element(By.XPATH, "..").click()
            driver.execute_script("document.querySelector('#statsReviewDetails').scrollIntoView()")
            capture("stats-mobile-" + cohort)
        driver.execute_script("document.querySelector('.stats-cohort-context').scrollIntoView()")
        assert driver.execute_script("""
            const chart = document.querySelector('.stats-cohort-material .stats-review-ring').getBoundingClientRect();
            const legend = document.querySelector('.stats-cohort-material .stats-chart-legend').getBoundingClientRect();
            return legend.top >= chart.bottom;
        """)
        capture("stats-mobile-source-material")
    assert not driver.find_elements(By.CSS_SELECTOR, ".catalog-load-failed"), "Browser reported a load failure"
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
    url = f"http://127.0.0.1:{server.server_port}/tools/catlog-latest.html"
    if os.environ.get("CHECK_LIVE") == "true":
        url = "https://chowdhurylab.github.io/tools/catlog-latest.html?browser-check=" + os.environ["GITHUB_SHA"][:12]
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
