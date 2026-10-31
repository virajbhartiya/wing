if (location.pathname === "/benchmark") {
  chrome.runtime.sendMessage({ type: "wing-benchmark" }, (result) =>
    console.log(result),
  );
} else if (location.pathname === "/") {
  chrome.runtime.sendMessage({ type: "wing-probe" }, async (result) => {
    let blocked = false;
    try {
      await fetch("/must-be-blocked");
    } catch {
      blocked = true;
    }
    const report = {
      ...result,
      userAgent: navigator.userAgent,
      contentScript: true,
      declarativeNetRequest: blocked,
    };
    const pre = document.createElement("pre");
    pre.id = "wing-extension-proof";
    pre.textContent = JSON.stringify(report, null, 2);
    document.body.append(pre);
    fetch("/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });
  });
}
