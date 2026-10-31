"use strict";
// A short-lived process. Stdout is a private protocol pipe, never a log. Cookie
// and password payloads go only to the native host, never to Wing's renderer.
const readline = require("node:readline");
const P = require("./profile-import.cjs");
const { importProfile } = require("./import-controller.cjs");
const testBase = process.env.WING_CHROMIUM_TEST_PROFILE
  ? process.env.WING_IMPORT_TEST_BASE
  : undefined;
const lines = readline.createInterface({ input: process.stdin });
const pending = new Map();
let sequence = 0,
  started = false;
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
function request(operation, data) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    send({ kind: "request", id, operation, data });
  });
}
lines.on("line", (line) => {
  if (line.length > 16000000) {
    process.exitCode = 1;
    lines.close();
    return;
  }
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.kind === "response") {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    message.error
      ? entry.reject(Error(message.error))
      : entry.resolve(message.result);
    return;
  }
  if (started || message.kind !== "start") return;
  started = true;
  (async () => {
    if (message.operation === "profiles")
      return { profiles: await P.discoverProfiles(testBase) };
    if (message.operation !== "import")
      throw Error("Unknown importer operation.");
    const source = await P.resolveSource(String(message.source), testBase);
    const options = Object.fromEntries(
      ["bookmarks", "tabs", "history", "cookies", "passwords"].map((key) => [
        key,
        message.options?.[key] === true,
      ]),
    );
    if (!Object.values(options).some(Boolean))
      throw Error("Choose data to import.");
    const result = await importProfile({
      source,
      options,
      ...(testBase &&
      source.browser === "wing" &&
      process.env.WING_IMPORT_TEST_KEY
        ? {
            getKey: async () => {
              const key = Buffer.from(
                process.env.WING_IMPORT_TEST_KEY,
                "base64",
              );
              if (key.length !== 16) throw Error("Invalid fixture key");
              return key;
            },
          }
        : {}),
      state: message.state,
      sessionFor: (profile) => ({
        cookies: {
          set: (cookie) => request("cookie", { profile, cookie }),
          flushStore: () => request("flush-cookies", { profile }),
        },
        clearStorageData: () => request("rollback", { profile }),
      }),
      vault: {
        import: (profile, credentials) =>
          request("passwords", { profile, credentials }),
        removeProfile: (profile) => request("rollback", { profile }),
      },
      persist: (state) => request("persist", { state }),
    });
    return { ok: true, report: result.report, profileId: result.profileId };
  })().then(
    (result) => {
      send({ kind: "result", result });
      lines.close();
    },
    (error) => {
      send({ kind: "result", error: error.message });
      lines.close();
    },
  );
});
