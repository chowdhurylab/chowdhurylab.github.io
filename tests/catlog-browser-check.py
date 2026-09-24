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
    assert driver.execute_script("return document.querySelector('#statsView').scrollTop") == before_scroll
    assert driver.find_element(By.CSS_SELECTOR, ".stats-combination-legend li.is-selected").get_attribute("data-stat-key") == "only_sequence"
    driver.find_element(By.CSS_SELECTOR, '.stats-review-legend [data-stats-cohort="manual_review_required"]').click()
    selected = driver.find_element(By.CSS_SELECTOR, 'input[name="statsCohort"]:checked')
    selected.send_keys(Keys.ARROW_RIGHT)
    assert driver.find_element(By.CSS_SELECTOR, 'input[name="statsCohort"][value="unverified"]').is_selected()
    driver.find_element(By.CSS_SELECTOR, 'input[name="statsCohort"][value="manual_review_required"]').find_element(By.XPATH, "..").click()
    driver.execute_script("document.querySelector('#statsView').scrollTop=0")
    for element in driver.find_elements(By.CSS_SELECTOR, "#statsView details > summary"):
        element.click()
        assert element.find_element(By.XPATH, "..").get_attribute("open") is not None
        check_panel_width()
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
