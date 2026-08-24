(function () {
  "use strict";

  if (
    window.location.protocol !== "https:" ||
    window.location.hostname !== "chowdhurylab.github.io" ||
    /bot|crawler|spider|headless/i.test(window.navigator.userAgent)
  ) {
    return;
  }

  var source = document.currentScript && document.currentScript.dataset.usageSource;
  if (!["catlog", "openptm", "osteoclust"].includes(source)) return;

  var cookieName = "chowdhury_tool_session";
  var match = document.cookie.match(
    new RegExp("(?:^|; )" + cookieName + "=([^;]*)"),
  );
  var sessionId = match && decodeURIComponent(match[1]);
  if (!/^[a-f0-9-]{36}$/i.test(sessionId || "")) {
    sessionId = window.crypto.randomUUID();
    document.cookie =
      cookieName +
      "=" +
      encodeURIComponent(sessionId) +
      "; Path=/; Secure; SameSite=Lax";
  }

  void fetch("https://agrivax.studio/api/usage/session", {
    method: "POST",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ source: source, sessionId: sessionId }),
    keepalive: true,
  }).catch(function () {
    // Usage tracking must never prevent a scientific tool from loading.
  });
})();
