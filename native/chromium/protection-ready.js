(async () => {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    // The dashboard can finish loading before the background page has registered
    // its message handlers. Once registered, getLists waits on isReadyPromise.
    const lists =
      typeof vAPI !== "undefined" && vAPI?.messaging?.send
        ? await vAPI.messaging.send("dashboard", { what: "getLists" })
        : null;
    if (
      lists &&
      typeof lists === "object" &&
      lists.netFilterCount > 0 &&
      lists.cosmeticFilterCount > 0
    ) {
      post(
        "result",
        JSON.stringify({
          ready: lists.netFilterCount > 0 && lists.cosmeticFilterCount > 0,
          networkFilters: lists.netFilterCount,
          cosmeticFilters: lists.cosmeticFilterCount,
        }),
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error("The uBlock background service did not become ready.");
})().catch((error) =>
  post("result", JSON.stringify({ ready: false, error: String(error) })),
);
