import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const sourceCode = await readFile(
  new URL("../assets/js/usage-tracker.js", import.meta.url),
  "utf8",
);

let cookie = "";
const requests = [];
const document = {
  currentScript: { dataset: { usageSource: "catlog" } },
  get cookie() {
    return cookie;
  },
  set cookie(value) {
    cookie = value;
  },
};
const context = {
  document,
  fetch: (url, options) => {
    requests.push({ url, options });
    return Promise.resolve(new Response("{}"));
  },
  Response,
  window: {
    crypto: {
      randomUUID: () => "9c7f663e-583f-4bdf-8c96-96d2a828557f",
    },
    location: {
      hostname: "chowdhurylab.github.io",
      protocol: "https:",
    },
  },
};

vm.runInNewContext(sourceCode, context);
assert.match(cookie, /^chowdhury_tool_session=/);
assert.doesNotMatch(cookie, /Expires|Max-Age/i);
assert.equal(requests.length, 1);
assert.equal(requests[0].url, "https://agrivax.studio/api/usage/session");
assert.deepEqual(
  JSON.parse(requests[0].options.body),
  {
    source: "catlog",
    sessionId: "9c7f663e-583f-4bdf-8c96-96d2a828557f",
  },
);

context.window.location.protocol = "file:";
vm.runInNewContext(sourceCode, context);
assert.equal(requests.length, 1);

console.log("Chowdhury Lab tool usage tracker checks passed.");
