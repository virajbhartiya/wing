"use strict";
// Per-tab developer overrides on Electron, driven through the DevTools protocol.
const { execFile } = require("node:child_process");
const { DEVICES, AGENTS, NETWORKS, parseListeningPorts, devPlan } = require("./dev-plan.cjs");
function localServers() {
  return new Promise((resolve) => {
    execFile(
      "/usr/sbin/lsof",
      ["-nP", "-iTCP", "-sTCP:LISTEN"],
      { timeout: 3000, maxBuffer: 1024 * 1024 },
      (_error, stdout) => resolve(parseListeningPorts(stdout)),
    );
  });
}
const byContents = new WeakMap();
function stateFor(contents) {
  if (!byContents.has(contents))
    byContents.set(contents, {
      agent: contents.getUserAgent(),
      cache: false,
      script: false,
    });
  return byContents.get(contents);
}
// Returns the message to show the developer.
async function apply(contents, tool, value) {
  const state = stateFor(contents);
  const plan = devPlan(state, tool, value);
  if (plan.calls.length && !contents.debugger.isAttached())
    contents.debugger.attach("1.3");
  for (const [method, params = {}] of plan.calls)
    await contents.debugger.sendCommand(method, params);
  if (plan.agent !== undefined) contents.setUserAgent(plan.agent || state.agent);
  if (plan.reload) contents.reload();
  return plan.message;
}
function openInBrowser(name, url) {
  return new Promise((resolve, reject) =>
    execFile("/usr/bin/open", ["-a", name, url], { timeout: 10000 }, (error) =>
      error ? reject(Error(`${name} could not open this page.`)) : resolve(),
    ),
  );
}
module.exports = {
  DEVICES,
  AGENTS,
  NETWORKS,
  parseListeningPorts,
  localServers,
  apply,
  openInBrowser,
};
