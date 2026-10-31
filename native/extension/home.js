import { safeURL } from "./workspace.js";
const status = document.querySelector("#status");
let statusTimer;
function error(cause) {
  clearTimeout(statusTimer);
  status.textContent = cause.message || "Could not open this page.";
  statusTimer = setTimeout(() => (status.textContent = ""), 6000);
}
document.querySelector("#date").textContent = new Intl.DateTimeFormat(undefined, {
  weekday: "long", month: "short", day: "numeric",
}).format(new Date());
document.querySelector("#search").addEventListener("submit", (event) => {
  event.preventDefault();
  const value = document.querySelector("#query").value.trim();
  if (!value) return;
  try { location.href = safeURL(value); } catch (cause) { error(cause); }
});
document.querySelectorAll("[data-url]").forEach((button) => {
  button.addEventListener("click", () => { location.href = button.dataset.url; });
});
document.querySelector("#extensions").addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/" }).catch(error);
});
function applyWorkspace(workspace) {
  if (!workspace) return;
  document.documentElement.dataset.theme = workspace.dark ? "dark" : "light";
  const space = workspace.spaces?.find((entry) => entry.id === workspace.activeSpace);
  document.querySelector("#space-name").textContent = space?.name || "Your space";
}
if (globalThis.chrome?.storage) {
  chrome.storage.local.get("workspace").then(({ workspace }) => applyWorkspace(workspace)).catch(error);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.workspace) applyWorkspace(changes.workspace.newValue);
  });
}
