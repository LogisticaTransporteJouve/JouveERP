// Service worker para Web Push. Sin offline cache, sin background
// sync — solo recibe push events y muestra notificaciones nativas.
// Registrado por features/notifications/lib/push-client.ts cuando el
// user otorga permisos.

self.addEventListener("push", (event) => {
  const data = (() => {
    try {
      return event.data ? event.data.json() : {};
    } catch {
      return {};
    }
  })();

  const title = data.title || "JouveERP";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icon.jpeg",
    badge: data.badge || "/icon.jpeg",
    data: { url: data.url || "/" },
    tag: data.tag || undefined,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clients) {
        if (client.url.includes(targetUrl)) {
          return client.focus();
        }
      }
      if (clients.length > 0) {
        await clients[0].focus();
        return clients[0].navigate(targetUrl);
      }
      return self.clients.openWindow(targetUrl);
    })(),
  );
});
