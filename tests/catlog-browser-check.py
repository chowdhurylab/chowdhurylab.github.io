"""Unmocked public-site checks on disposable Chrome and macOS Safari runners."""

import argparse
import functools
import http.server
import json
import os
from pathlib import Path
import threading
import urllib.request

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "browser-checks"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def check(driver, browser, url):
    wait = WebDriverWait(driver, 120)
    driver.set_window_size(1440, 1000)
    driver.get(url + "#stats")
    wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".stats-review-legend li")) >= 5)
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
    assert len(driver.find_elements(By.CSS_SELECTOR, ".stats-followup-coverage dl > div")) == 4
    assert f'{coverage["with_kinetic_value"]:,}' in driver.find_element(By.CLASS_NAME, "stats-followup-coverage").text
    assert "Illustrative checks" in driver.find_element(By.CLASS_NAME, "stats-followup-section").text
    for key in ("verified", "corrected"):
        row = driver.find_element(By.CSS_SELECTOR, f'.stats-accepted-split [data-stat-key="{key}"]')
        assert int(row.get_attribute("data-count")) == expected[key]

    def capture(label):
        assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth + 1"), "Horizontal page overflow"
        overflow = driver.execute_script("""
            return [...document.querySelectorAll('.stats-outcome-label, .stats-check-examples dd, .stats-followup-coverage dd')]
                .filter(e => e.getBoundingClientRect().width && e.scrollWidth > e.clientWidth + 1)
                .map(e => e.textContent);
        """)
        assert not overflow, f"Clipped Stats text: {overflow}"
        driver.save_screenshot(str(OUTPUT / f"{browser}-{label}.png"))

    capture("stats-desktop")
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
    search.send_keys("laccase", Keys.ESCAPE)
    wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]") and all("laccase" in row.text.lower() for row in d.find_elements(By.CSS_SELECTOR, "#recordsBody tr[data-key]")))
    result_count = driver.find_element(By.ID, "activeSummary").text
    driver.find_element(By.ID, "statsButton").click()
    assert driver.find_element(By.ID, "statsScope").text == f"All {total:,} records, before filtering."
    driver.find_element(By.ID, "browseButton").click()
    assert driver.find_element(By.ID, "globalSearchInput").get_attribute("value") == "laccase"
    assert driver.find_element(By.ID, "activeSummary").text == result_count
    driver.find_element(By.CSS_SELECTOR, "#recordsBody tr[data-key]").click()
    wait.until(lambda d: d.find_element(By.ID, "detailHeading").is_displayed())
    assert "laccase" in driver.find_element(By.ID, "detailHeading").text.lower()
    driver.save_screenshot(str(OUTPUT / f"{browser}-browse-detail.png"))
    driver.find_element(By.ID, "detailHeading").send_keys(Keys.ESCAPE)
    driver.find_element(By.ID, "guideButton").click()
    assert driver.find_element(By.ID, "guideView").is_displayed()
    driver.find_element(By.ID, "statsButton").click()
    driver.execute_script("window.scrollTo(0, 0)")
    driver.set_window_size(1080, 900)
    capture("stats-compact")
    if browser == "chrome":
        driver.set_window_size(390, 844)
        capture("stats-mobile")
        driver.execute_script("document.querySelector('.stats-followup-section').scrollIntoView()")
        capture("stats-mobile-followup")
    assert not driver.find_elements(By.CSS_SELECTOR, ".catalog-load-failed"), "Browser reported a load failure"
    return {"browser": browser, "version": driver.capabilities.get("browserVersion"), "url": url,
            "total": total, "accepted": accepted, "source_sha256": manifest["source_sha256"], "passed": True}


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
