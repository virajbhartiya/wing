const $ = (id) => document.getElementById(id);
const address = $("address");
const space = $("space");
space.onchange = () => window.mini.run("space", space.value);
$("back").onclick = () => window.mini.run("back");
$("forward").onclick = () => window.mini.run("forward");
$("expand").onclick = () => window.mini.run("expand");
$("bar").onsubmit = (event) => {
  event.preventDefault();
  window.mini.run("navigate", address.value);
  address.blur();
};
address.onfocus = () => address.select();
window.mini.onFocusAddress(() => {
  address.focus();
  address.select();
});
window.mini.onState((state) => {
  if (document.activeElement !== address) address.value = state.url;
  $("back").disabled = !state.canGoBack;
  $("forward").disabled = !state.canGoForward;
  $("expand").disabled = !state.url;
  const signature = JSON.stringify(state.spaces);
  if (space.dataset.signature !== signature) {
    space.dataset.signature = signature;
    space.replaceChildren(
      ...state.spaces.map((s) => new Option(`${s.icon || ""} ${s.name}`.trim(), s.id)),
    );
  }
  space.value = state.spaceId;
});
window.mini.run("ready");
