"use strict";
// What each developer override asks of the page, shared by both engines. Calls
// are Chrome DevTools Protocol commands.
const DEVICES = Object.freeze({
  iphone: { label: "iPhone (390 × 844)", width: 390, height: 844, scale: 3, mobile: true },
  ipad: { label: "iPad (820 × 1180)", width: 820, height: 1180, scale: 2, mobile: true },
  laptop: { label: "Laptop (1440 × 900)", width: 1440, height: 900, scale: 2, mobile: false },
});
const AGENTS = Object.freeze({
  safari: {
    label: "Safari",
    value:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  },
  iphone: {
    label: "Safari on iPhone",
    value:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  },
  firefox: {
    label: "Firefox",
    value:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0",
  },
});
// Throughput is bytes per second, matching the protocol.
const NETWORKS = Object.freeze({
  fast3g: { label: "Fast 3G", latency: 150, down: 180000, up: 84000 },
  slow3g: { label: "Slow 3G", latency: 400, down: 50000, up: 50000 },
  offline: { label: "Offline", offline: true, latency: 0, down: 0, up: 0 },
});
const SERVER_COMMANDS =
  /^(node|python\d*|ruby|php|java|go|deno|bun|com\.docke|docker|nginx|caddy|httpd|uvicorn|gunicorn|dotnet|beam|rails|puma|next|vite|hugo|air)/i;
// Databases and caches listen locally too, but have no page to open.
const NON_WEB_PORTS = new Set([3306, 5432, 5433, 5440, 6379, 6380, 9042, 11211, 27017]);
function parseListeningPorts(output) {
  const ports = new Map();
  for (const line of String(output).split("\n")) {
    const match = line.match(
      /^(\S+)\s+\d+\s.*TCP\s+(?:\*|127\.0\.0\.1|\[::1?\]):(\d+)\s+\(LISTEN\)/,
    );
    if (!match || !SERVER_COMMANDS.test(match[1])) continue;
    const port = Number(match[2]);
    if (port >= 1024 && !NON_WEB_PORTS.has(port) && !ports.has(port))
      ports.set(port, { port, command: match[1].replace(/\\x20/g, " ") });
  }
  return [...ports.values()].sort((a, b) => a.port - b.port);
}
// state is per tab: { cache, script }. agent is the value to apply, "" for default.
function devPlan(state, tool, value) {
  switch (tool) {
    case "cache":
      state.cache = !state.cache;
      return {
        calls: [
          ["Network.enable"],
          ["Network.setCacheDisabled", { cacheDisabled: state.cache }],
        ],
        message: `Cache ${state.cache ? "disabled" : "enabled"} for this tab`,
      };
    case "javascript":
      state.script = !state.script;
      return {
        calls: [["Emulation.setScriptExecutionDisabled", { value: state.script }]],
        reload: true,
        message: `JavaScript ${state.script ? "disabled" : "enabled"} for this tab`,
      };
    case "device": {
      const device = DEVICES[value];
      if (!device)
        return {
          calls: [["Emulation.clearDeviceMetricsOverride"]],
          message: "Showing the page at window size",
        };
      return {
        calls: [
          [
            "Emulation.setDeviceMetricsOverride",
            {
              width: device.width,
              height: device.height,
              deviceScaleFactor: device.scale,
              mobile: device.mobile,
            },
          ],
        ],
        message: `Emulating ${device.label}`,
      };
    }
    case "scheme": {
      const known = ["light", "dark"].includes(value);
      return {
        calls: [
          [
            "Emulation.setEmulatedMedia",
            { features: [{ name: "prefers-color-scheme", value: known ? value : "" }] },
          ],
        ],
        message: known ? `Page sees ${value} mode` : "Page sees the system color scheme",
      };
    }
    case "agent":
      return {
        calls: [],
        agent: AGENTS[value]?.value || "",
        reload: true,
        message: `User agent: ${AGENTS[value]?.label || "Default"}`,
      };
    case "network": {
      const network = NETWORKS[value];
      return {
        calls: [
          ["Network.enable"],
          [
            "Network.emulateNetworkConditions",
            {
              offline: !!network?.offline,
              latency: network?.latency || 0,
              downloadThroughput: network ? network.down : -1,
              uploadThroughput: network ? network.up : -1,
            },
          ],
        ],
        message: `Network: ${network?.label || "No throttling"}`,
      };
    }
    default:
      throw Error("Unknown developer tool.");
  }
}
module.exports = { DEVICES, AGENTS, NETWORKS, parseListeningPorts, devPlan };
