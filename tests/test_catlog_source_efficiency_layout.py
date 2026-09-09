"""Keep each source-listed efficiency and its unit in one grid item.

Run with stdlib unittest; Node.js exercises the real public renderer.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path
from xml.etree import ElementTree


class SourceEfficiencyLayoutTests(unittest.TestCase):
    def test_source_efficiency_value_and_unit_share_one_grid_item(self) -> None:
        node = shutil.which("node")
        if node is None:
            self.skipTest("Node.js is required to exercise the real viewer renderer")

        viewer = (
            Path(__file__).resolve().parents[1]
            / "tools/catlog-static/assets/catlog-static.js"
        )
        harness = r"""
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const viewerPath = process.argv[1];
const viewer = fs.readFileSync(viewerPath, "utf8");
const apiStart = "    window.CATLOG_STATIC_TEST_API = {\n";
assert.equal(viewer.split(apiStart).length, 2, "Expected one public test API");
const instrumented = viewer.replace(
  apiStart, apiStart + "      sourceEfficiencyRow,\n",
);
const sandbox = {
  URL,
  document: {
    currentScript: { src: "https://example.test/tools/catlog-static/assets/catlog-static.js" },
    baseURI: "https://example.test/tools/catlog-static/",
  },
  window: {
    CATLOG_STATIC_MANIFEST: {},
    CATLOG_STATIC_TEST_MODE: true,
    matchMedia: () => ({ matches: false }),
  },
};
vm.runInNewContext(instrumented, sandbox, { filename: viewerPath, timeout: 1000 });
const render = sandbox.window.CATLOG_STATIC_TEST_API.sourceEfficiencyRow;
assert.equal(typeof render, "function");
process.stdout.write(JSON.stringify([6004, "6.004e+7"].map((value) => render(
  { kcat_over_km_source_differs: true },
  { source_kcat_over_km_values: [
    { value, unit: "s^(-1)*mM^(-1)", source_db: "brenda" },
  ] },
))));
"""
        result = subprocess.run(
            [node, "-e", harness, str(viewer)],
            text=True,
            capture_output=True,
            check=True,
            timeout=10,
        )
        rendered = json.loads(result.stdout)
        self.assertEqual(len(rendered), 2)
        for index, html in enumerate(rendered):
            with self.subTest(value=(6004, "6.004e+7")[index]):
                # These fixtures contain only one named HTML entity: &times;.
                root = ElementTree.fromstring(html.replace("&times;", "&#215;"))
                values = root.findall(".//span[@class='source-efficiency-value']")
                self.assertEqual(len(values), 1)
                value = values[0]
                self.assertEqual(
                    [child.tag for child in value],
                    ["span", "small"],
                    "The value and unit must share one span, with source attribution "
                    "as a sibling; direct superscripts become separate CSS grid items",
                )
                number_line, attribution = value
                self.assertFalse((value.text or "").strip())
                self.assertFalse((number_line.tail or "").strip())
                self.assertEqual(
                    [sup.text for sup in number_line.findall("sup")], ["-1", "-1"]
                )
                self.assertIn("s-1 mM-1", "".join(number_line.itertext()))
                self.assertEqual("".join(attribution.itertext()), "BRENDA")
                self.assertIsNone(number_line.find("small"))
                scientific = number_line.find(".//span[@class='scientific-number']")
                if index == 0:
                    self.assertIsNone(scientific)
                    self.assertIn("6004", "".join(number_line.itertext()))
                else:
                    self.assertIsNotNone(scientific)
                    self.assertEqual(scientific.find(".//sup").text, "7")
                    self.assertEqual(
                        scientific.attrib["aria-label"],
                        "6.004 times 10 to the power of 7",
                    )


if __name__ == "__main__":
    unittest.main()
