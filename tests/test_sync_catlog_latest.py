"""Tracker preservation checks using synthetic pages, never catalog data."""

from __future__ import annotations

import importlib.util
import io
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts/sync-catlog-latest.py"
EXPECTED_TRACKER_TAG = (
    '<script src="/assets/js/usage-tracker.js" data-usage-source="catlog"></script>'
)
RELATIVE_TRACKER_TAG = (
    '<script src="assets/js/usage-tracker.js" data-usage-source="catlog"></script>'
)


def synthetic_page(tracker: str = "") -> str:
    """Supply only the structural references required by build_alias()."""
    return (
        '<!doctype html>\n<html lang="en">\n<head>\n'
        '  <link rel="stylesheet" href="assets/catalog.css">\n'
        '</head>\n<body>\n'
        '  <!-- Preserve this synthetic μM label byte-for-byte. -->\n'
        '  <img src="assets/mark.svg" alt="">\n'
        '  <img src="assets/guide.svg" alt="">\n'
        '  <a href="README_FIRST.txt">Download notes</a>\n'
        '  <a href="README_FIRST.txt">Guide notes</a>\n'
        '  <script src="data/manifest.js"></script>\n'
        '  <script data-catalog-base="." src="assets/catlog-static.js"></script>\n'
        + (f"  {tracker}\n" if tracker else "")
        + '</body>\n</html>\n'
    )


class SyncCatlogLatestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        spec = importlib.util.spec_from_file_location("catlog_alias_sync_under_test", SCRIPT_PATH)
        if spec is None or spec.loader is None:
            raise RuntimeError("Cannot load the alias synchronizer")
        cls.sync = importlib.util.module_from_spec(spec)
        with patch.object(sys, "dont_write_bytecode", True):
            spec.loader.exec_module(cls.sync)

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="catlog-tracker-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / "tools/catlog-static/index.html"
        self.target = self.root / "tools/catlog-latest.html"
        self.source.parent.mkdir(parents=True)
        globals_patch = patch.multiple(
            self.sync, ROOT=self.root, SOURCE=self.source, TARGET=self.target
        )
        globals_patch.start()
        self.addCleanup(globals_patch.stop)

    def write_pages(self, source: str, alias: str | None = None) -> None:
        self.source.write_text(source, encoding="utf-8")
        if alias is not None:
            self.target.write_text(alias, encoding="utf-8")

    def run_main(self, *arguments: str) -> int:
        with patch.object(sys, "argv", [str(SCRIPT_PATH), *arguments]):
            with redirect_stdout(io.StringIO()):
                return self.sync.main()

    def assert_rejected_without_writes(self, *arguments: str) -> None:
        before = {
            path: path.read_bytes() if path.exists() else None
            for path in (self.source, self.target)
        }
        with patch.object(
            Path, "write_text", side_effect=AssertionError("Unexpected page write")
        ) as write:
            with self.assertRaises((RuntimeError, SystemExit)) as raised:
                self.run_main(*arguments)
            if isinstance(raised.exception, SystemExit):
                self.assertNotIn(raised.exception.code, (None, 0))
            write.assert_not_called()
        for path, content in before.items():
            self.assertEqual(path.read_bytes() if path.exists() else None, content)

    def test_tracker_constant_is_the_exact_absolute_public_tag(self) -> None:
        self.assertEqual(self.sync.USAGE_TRACKER_TAG, EXPECTED_TRACKER_TAG)

    def test_prepare_preserves_valid_source_byte_for_byte(self) -> None:
        source = synthetic_page(EXPECTED_TRACKER_TAG)
        self.assertEqual(self.sync.prepare_canonical(source), source)

    def test_prepare_injects_before_body_and_is_idempotent(self) -> None:
        source = synthetic_page()
        prepared = self.sync.prepare_canonical(source)
        self.assertEqual(prepared.count(EXPECTED_TRACKER_TAG), 1)
        before, after = prepared.split(EXPECTED_TRACKER_TAG)
        self.assertNotIn("</body>", before)
        self.assertEqual(after.lstrip(), "</body>\n</html>\n")
        self.assertIn('<!-- Preserve this synthetic μM label byte-for-byte. -->', prepared)
        self.assertEqual(self.sync.prepare_canonical(prepared), prepared)

    def test_prepare_rejects_relative_or_malformed_tracker_markers(self) -> None:
        malformed_tags = (
            RELATIVE_TRACKER_TAG,
            '<script src="/assets/js/usage-tracker.js"></script>',
            '<script src="/assets/js/usage-tracker.js" data-usage-source="openptm"></script>',
            '<script src="/assets/js/usage-tracker.js" data-usage-source="catlog">',
        )
        for tag in malformed_tags:
            with self.subTest(tag=tag):
                with self.assertRaises(RuntimeError):
                    self.sync.prepare_canonical(synthetic_page(tag))

    def test_prepare_rejects_duplicate_exact_tags(self) -> None:
        source = synthetic_page(EXPECTED_TRACKER_TAG + "\n" + EXPECTED_TRACKER_TAG)
        with self.assertRaises(RuntimeError):
            self.sync.prepare_canonical(source)

    def test_prepare_rejects_exact_plus_malformed_tag_in_either_order(self) -> None:
        for tags in (
            (EXPECTED_TRACKER_TAG, RELATIVE_TRACKER_TAG),
            (RELATIVE_TRACKER_TAG, EXPECTED_TRACKER_TAG),
        ):
            with self.subTest(tags=tags):
                with self.assertRaises(RuntimeError):
                    self.sync.prepare_canonical(synthetic_page("\n".join(tags)))

    def test_prepare_requires_unique_body_closing_tag_for_insertion(self) -> None:
        source = synthetic_page()
        for invalid in (
            source.replace("</body>", ""),
            source.replace("</body>", "</body>\n</body>"),
        ):
            with self.subTest(source=invalid):
                with self.assertRaises(RuntimeError):
                    self.sync.prepare_canonical(invalid)

    def test_check_rejects_missing_tracker_even_when_alias_matches(self) -> None:
        source = synthetic_page()
        aliases = (
            self.sync.build_alias(source),
            self.sync.build_alias(self.sync.prepare_canonical(source)),
        )
        for alias in aliases:
            with self.subTest(alias_has_tracker=EXPECTED_TRACKER_TAG in alias):
                self.write_pages(source, alias)
                self.assert_rejected_without_writes("--check")

    def test_check_rejects_stale_alias_without_writing(self) -> None:
        self.write_pages(synthetic_page(EXPECTED_TRACKER_TAG), "stale alias\n")
        self.assert_rejected_without_writes("--check")

    def test_check_rejects_missing_alias_without_creating_it(self) -> None:
        self.write_pages(synthetic_page(EXPECTED_TRACKER_TAG))
        self.assert_rejected_without_writes("--check")
        self.assertFalse(self.target.exists())

    def test_check_valid_pages_succeeds_without_writing(self) -> None:
        source = synthetic_page(EXPECTED_TRACKER_TAG)
        self.write_pages(source, self.sync.build_alias(source))
        with patch.object(
            Path, "write_text", side_effect=AssertionError("Check mode wrote a page")
        ) as write:
            self.assertEqual(self.run_main("--check"), 0)
            write.assert_not_called()

    def test_main_restores_tracker_after_regeneration_and_updates_both_pages(self) -> None:
        self.write_pages(synthetic_page(), "previous generated alias\n")
        self.assertEqual(self.run_main(), 0)
        canonical = self.source.read_text(encoding="utf-8")
        alias = self.target.read_text(encoding="utf-8")
        self.assertEqual(canonical.count(EXPECTED_TRACKER_TAG), 1)
        self.assertEqual(alias.count(EXPECTED_TRACKER_TAG), 1)
        self.assertEqual(alias, self.sync.build_alias(canonical))
        self.assertIn('src="assets/catlog-static.js"', canonical)
        self.assertIn('src="catlog-static/assets/catlog-static.js"', alias)
        self.assertIn('src="catlog-static/data/manifest.js"', alias)
        self.assertEqual(alias.count('href="catlog-static/README_FIRST.txt"'), 2)
        self.assertIn('data-catalog-base="catlog-static/"', alias)
        self.assertNotIn('src="catlog-static/assets/js/usage-tracker.js"', alias)
        before = (self.source.read_bytes(), self.target.read_bytes())
        self.assertEqual(self.run_main(), 0)
        self.assertEqual((self.source.read_bytes(), self.target.read_bytes()), before)

    def test_main_rejects_invalid_alias_references_before_canonical_write(self) -> None:
        source = synthetic_page().replace(
            'href="assets/catalog.css"', 'href="/unrelated.css"'
        )
        self.write_pages(source, "preserve this existing alias\n")
        self.assert_rejected_without_writes()

    def test_main_rejects_malformed_tracker_before_any_write(self) -> None:
        self.write_pages(synthetic_page(RELATIVE_TRACKER_TAG), "preserve this alias\n")
        self.assert_rejected_without_writes()


if __name__ == "__main__":
    unittest.main()
