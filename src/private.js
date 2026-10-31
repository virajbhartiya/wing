const $ = (id) => document.getElementById(id);
const address = $("address");
$("back").onclick = () => window.privateWing.run("back");
$("forward").onclick = () => window.privateWing.run("forward");
$("reload").onclick = () => window.privateWing.run("reload");
$("bar").onsubmit = (event) => {
  event.preventDefault();
  window.privateWing.run("navigate", address.value);
  address.blur();
};
address.onfocus = () => address.select();
window.privateWing.onFocusAddress(() => {
  address.focus();
  address.select();
});
window.privateWing.onState((state) => {
  if (document.activeElement !== address) address.value = state.url;
  $("back").disabled = !state.canGoBack;
  $("forward").disabled = !state.canGoForward;
});
window.privateWing.run("ready");
