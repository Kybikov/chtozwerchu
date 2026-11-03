/* Imported by the generated worker. Only activity flags cross windows. */
(() => {
  const isApp = (client) => {
    try {
      const url = new URL(client.url);
      return url.origin === self.location.origin && url.pathname === "/";
    } catch {
      return false;
    }
  };
  const appClients = async () =>
    (
      await self.clients.matchAll({ type: "window", includeUncontrolled: true })
    ).filter(isApp);
  const ask = (client) =>
    new Promise((resolve) => {
      const channel = new MessageChannel();
      const finish = (busy) => {
        clearTimeout(timer);
        channel.port1.close();
        resolve({ id: client.id, busy });
      };
      const timer = setTimeout(() => finish(null), 1800);
      channel.port1.onmessage = (event) => {
        if (event.data?.protocol === 1 && typeof event.data.busy === "boolean")
          finish(event.data.busy);
        else finish(null);
      };
      channel.port1.onmessageerror = () => finish(null);
      try {
        client.postMessage({ type: "KHZ_PWA_ACTIVITY", protocol: 1 }, [
          channel.port2,
        ]);
      } catch {
        finish(null);
      }
    });
  self.addEventListener("message", (event) => {
    if (
      event.data?.type !== "KHZ_PWA_APPLY" ||
      event.data.protocol !== 1 ||
      !event.ports[0] ||
      !isApp(event.source)
    )
      return;
    const port = event.ports[0];
    event.waitUntil(
      (async () => {
        try {
          const before = await appClients();
          const replies = await Promise.all(before.map(ask));
          // Ignore closed windows; windows opened during the check need a retry.
          const after = await appClients();
          const active = new Set(after.map((client) => client.id));
          const known = new Set(replies.map((reply) => reply.id));
          const busy = replies.filter(
            (reply) => active.has(reply.id) && reply.busy === true,
          ).length;
          const unknown =
            replies.filter(
              (reply) => active.has(reply.id) && reply.busy === null,
            ).length + after.filter((client) => !known.has(client.id)).length;
          if (!after.length || busy || unknown) {
            port.postMessage({
              type: "KHZ_PWA_RESULT",
              status: "blocked",
              busy,
              unknown: unknown || (!after.length ? 1 : 0),
            });
            return;
          }
          await self.skipWaiting();
          port.postMessage({
            type: "KHZ_PWA_RESULT",
            status: "applied",
            busy: 0,
            unknown: 0,
          });
        } catch {
          port.postMessage({
            type: "KHZ_PWA_RESULT",
            status: "blocked",
            busy: 0,
            unknown: 1,
          });
        } finally {
          port.close();
        }
      })(),
    );
  });
})();
