const $ = (s) => document.querySelector(s);
let state,
  filter = "",
  refreshTimer;
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function markup(selector, html) {
  const element = $(selector);
  if (element.innerHTML !== html) element.innerHTML = html;
}
function favicon(tab) {
  if (tab.discarded) return '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-8-8 6 6 0 0 0 8 8Z"/></svg>';
  try { const u = new URL(tab.favIconUrl); if (["https:", "http:", "chrome-extension:"].includes(u.protocol)) return `<img src="${esc(u.href)}" alt="" referrerpolicy="no-referrer">`; } catch {}
  return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c5 5 5 11 0 16-5-5-5-11 0-16Z"/></svg>';
}
const colors = {
  lavender: "#d9d3e3",
  sage: "#d1ddd2",
  peach: "#e9d6c7",
  ocean: "#cddce6",
};
async function act(action, data = {}) {
  try {
    const result = await chrome.runtime.sendMessage({ action, data });
    if (result.error) throw Error(result.error);
    state = result;
    render();
    return result;
  } catch (error) {
    $("#status").textContent = error.message;
    setTimeout(() => ($("#status").textContent = ""), 4000);
  }
}
function rows(tabs) {
  return tabs
    .map(
      (t) =>
        `<div class="tab ${t.active ? "active" : ""} ${t.discarded ? "sleeping" : ""}" draggable="true" data-tab="${t.id}"><button class="open" data-activate="${t.id}" title="${esc(t.url)}"><span class="favicon">${favicon(t)}</span><span class="title">${esc(t.title || t.url || "New tab")}</span></button><button class="more" data-more="${t.id}" aria-label="Options for ${esc(t.title)}">⋯</button><button class="close" data-close="${t.id}" aria-label="Archive ${esc(t.title)}">×</button></div>`,
    )
    .join("");
}
function render() {
  if (!state) return;
  const space = state.spaces.find((s) => s.id === state.activeSpace);
  $("#space-name").textContent = space?.name || "Personal";
  document.body.classList.toggle("dark", state.dark);
  document.documentElement.dataset.theme = state.dark ? "dark" : "light";
  document.documentElement.style.setProperty("--wing-panel", state.dark ? "#302d39" : colors[space?.color] || colors.lavender);
  const mark = $(".space-mark"); if (mark) mark.textContent = (space?.name || "P").slice(0,1).toUpperCase();
  document.documentElement.style.setProperty(
    "--panel",
    colors[space?.color] || colors.lavender,
  );
  markup("#spaces", state.spaces
    .map(
      (s) =>
        `<button data-space="${s.id}" class="${s.id === state.activeSpace ? "selected" : ""}" title="${esc(s.name)} — drop a tab here">${esc(s.name)}</button>`,
    )
    .join(""));
  const tabs = state.tabs.filter(
    (t) =>
      state.assignments[t.id] === state.activeSpace &&
      (t.title + " " + t.url).toLowerCase().includes(filter.toLowerCase()),
  );
  markup("#pinned",
    rows(tabs.filter((t) => t.pinned)) ||
    '<div class="empty">Pin a tab to keep it here.</div>');
  markup("#tabs",
    rows(tabs.filter((t) => !t.pinned)) ||
    '<div class="empty">A little room to explore.</div>');
}
function dialog(html) {
  $("#dialog-content").innerHTML = html;
  $("#dialog").showModal();
}
function close() {
  $("#dialog").close();
}
$("#search").onsubmit = (e) => {
  e.preventDefault();
  act("new-tab", { url: $("#query").value });
  $("#query").value = "";
  filter = "";
};
$("#query").oninput = (e) => {
  filter = e.target.value;
  render();
};
$("#new-tab").onclick = () => act("new-tab");
$("#extensions").onclick = () =>
  chrome.tabs.create({ url: "chrome://extensions/" });
$("#group").onclick = () => act("group");
$("#add-space").onclick = () => {
  dialog(
    '<h2>A fresh Space.</h2><p>A home for a different part of your day. Spaces organize tabs; they share this browser profile’s cookies and extensions.</p><form id="create-space"><input id="name" placeholder="Name your Space" required maxlength="50"><select id="color"><option value="lavender">Lavender</option><option value="sage">Sage</option><option value="peach">Peach</option><option value="ocean">Ocean</option></select><button class="primary">Create Space</button></form>',
  );
  $("#name").focus();
  $("#create-space").onsubmit = (e) => {
    e.preventDefault();
    act("add-space", { name: $("#name").value, color: $("#color").value });
    close();
  };
};
$("#archive").onclick = () => {
  dialog(
    `<h2>A way back.</h2><p>Your last ${state.archive.length} archived tabs. Archive stays on this device.</p>${state.archive.map((t) => `<button class="row" data-restore="${t.id}">${esc(t.title || t.url)}</button>`).join("") || "<p>Nothing archived yet.</p>"}`,
  );
};
$("#memory").onclick = () => {
  const live = state.tabs.filter((t) => !t.discarded).length;
  dialog(
    `<h2>A lighter browser.</h2><div class="metric">${live} <small>awake / ${state.tabs.length}</small></div><p>Target: ${state.budget} live tabs. Background tabs sleep using Chromium’s native discard API. Active, split, audible, pinned, loading and protected tabs are excluded. The budget is a soft limit.</p><button class="primary" id="trim">Sleep eligible tabs</button><button class="row" id="diagnostics">Open Chromium’s tab diagnostics</button><p>This is a tab count, not a memory or CPU measurement.</p>`,
  );
  $("#trim").onclick = async () => {
    await act("trim");
    close();
  };
  $("#diagnostics").onclick = () =>
    chrome.tabs.create({ url: "chrome://discards/" });
};
$("#settings").onclick = () => {
  dialog(
    `<h2>Make it yours.</h2><button class="row" id="recover">Recover a browsing session</button><button class="row" id="export-workspace">Export workspace backup</button><label class="row">Import workspace backup<input id="import-workspace" type="file" accept="application/json,.json"></label><label>Awake tab budget<select id="budget">${[4, 8, 16].map((n) => `<option ${n === state.budget ? "selected" : ""}>${n}</option>`).join("")}</select></label><button class="row" id="dark">${state.dark ? "Light" : "Dark"} sidebar</button><button class="row" id="native-settings">Chromium settings & profiles ↗</button><button class="row" id="store">Chrome Web Store ↗</button><button class="row" id="delete-space">Remove current Space (keep tabs)</button><p>Wing 0.2 · CEF + Chromium<br>No account. No Wing telemetry. Native extension permissions remain under your control.</p>`,
  );
  $('#recover').onclick=async()=>{
    const result=await chrome.runtime.sendMessage({action:'recovery'});
    dialog(`<h2>Pick up where you left off.</h2><p>Restores windows, Spaces, pins and splits into new windows. Background pages load when selected. Unsaved forms and navigation history are not included.</p>${result.snapshots.map(x=>`<button class="row" data-session="${x.id}">${new Date(x.at).toLocaleString()} · ${x.windows.length} windows · ${x.windows.reduce((n,w)=>n+w.tabs.length,0)} tabs</button>`).join('')||'<p>No saved session yet.</p>'}`);
    document.querySelectorAll('[data-session]').forEach(b=>b.onclick=async()=>{b.disabled=true;await act('restore-session',{id:b.dataset.session});close()});
  };
  $('#export-workspace').onclick=async()=>{
    const backup=await chrome.runtime.sendMessage({action:'export'});
    const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='Wing-workspace-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  };
  $('#import-workspace').onchange=async e=>{
    const file=e.target.files[0];if(!file)return;
    try{if(file.size>10*1024*1024)throw Error('Backup exceeds 10 MB');const backup=JSON.parse(await file.text());
    if(!confirm('Replace Spaces and archive with this backup? Open tabs stay open. Wing saves a pre-import backup locally.'))return;
    await act('import',{backup});close();}catch(error){$('#status').textContent=error.message;}
  };
  $("#budget").onchange = (e) =>
    act("settings", { budget: Number(e.target.value) });
  $("#dark").onclick = () => {
    act("settings", { dark: !state.dark });
    close();
  };
  $("#native-settings").onclick = () =>
    chrome.tabs.create({ url: "chrome://settings/" });
  $("#store").onclick = () =>
    chrome.tabs.create({ url: "https://chromewebstore.google.com/" });
  $("#delete-space").onclick = () => {
    act("delete-space", { id: state.activeSpace });
    close();
  };
};
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.space) act("space", { id: b.dataset.space });
  if (b.dataset.activate) act("activate", { id: Number(b.dataset.activate) });
  if (b.dataset.close) act("archive", { id: Number(b.dataset.close) });
  if (b.dataset.restore) {
    act("restore", { id: b.dataset.restore });
    close();
  }
  if (b.dataset.more) {
    const id = Number(b.dataset.more),
      tab = state.tabs.find((t) => t.id === id);
    dialog(
      `<h2>Keep it close.</h2><p>${esc(tab.title)}</p><button class="row" id="split">${tab.splitViewId != null && tab.splitViewId !== -1 ? "Separate split panes" : "Open a split beside this tab"}</button><button class="row" id="pin">${tab.pinned ? "Unpin" : "Pin"} this tab</button><label>Move to Space<select id="move">${state.spaces.map((s) => `<option value="${s.id}" ${s.id === state.assignments[id] ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>`,
    );
    $("#split").onclick = () => {
      act("split", { id });
      close();
    };
    $("#pin").onclick = () => {
      act("pin", { id });
      close();
    };
    $("#move").onchange = (e) => {
      act("move", { id, spaceId: e.target.value });
      close();
    };
  }
});
document.addEventListener("dragstart", (e) => {
  const row = e.target.closest("[data-tab]");
  if (row) e.dataTransfer.setData("text/plain", row.dataset.tab);
});
document.addEventListener("dragover", (e) => {
  if (e.target.closest("[data-space]")) e.preventDefault();
});
document.addEventListener("drop", (e) => {
  const target = e.target.closest("[data-space]");
  if (target) {
    e.preventDefault();
    act("move", {
      id: Number(e.dataTransfer.getData("text/plain")),
      spaceId: target.dataset.space,
    });
  }
});
function schedule() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => act("state"), 100);
}
chrome.tabs.onUpdated.addListener(schedule);
chrome.tabs.onActivated.addListener(schedule);
chrome.tabs.onRemoved.addListener(schedule);
chrome.tabs.onCreated.addListener(schedule);
chrome.storage.onChanged.addListener(schedule);
act("state");
