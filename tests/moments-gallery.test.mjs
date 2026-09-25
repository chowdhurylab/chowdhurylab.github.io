import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Moments does not list the same photo under different filenames", async () => {
  const data = JSON.parse(await readFile(new URL("../assets/data/moments.json", import.meta.url), "utf8"));
  const sources = new Set([
    ...(data.carousel || []).map((item) => item.image),
    ...(data.postGroups || []).flatMap((group) =>
      (group.items || []).filter((item) => item.type === "image").map((item) => item.src),
    ),
  ]);
  const seen = new Map();

  for (const src of sources) {
    const image = await readFile(new URL(`../${src}`, import.meta.url));
    const hash = createHash("sha256").update(image).digest("hex");
    assert.ok(!seen.has(hash), `${src} duplicates ${seen.get(hash)}`);
    seen.set(hash, src);
  }
});
