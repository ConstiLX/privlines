/* PrivLines background notifications */
self.addEventListener("push", event => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch {}

    const call = data.kind === "call";
    const options = {
        body: data.body || (call ? "Du wirst angerufen." : "Du hast eine neue Nachricht."),
        icon: "/privlines-192.png",
        badge: "/privlines-192.png",
        tag: call ? `privlines-call-${data.callId || "incoming"}` : "privlines-message",
        renotify: call,
        requireInteraction: call,
        data: { url: data.url || "/login.html", callId: data.callId || null },
        ...(call ? { actions: [{ action: "open", title: "PrivLines öffnen" }] } : {})
    };
    event.waitUntil(self.registration.showNotification(data.title || "PrivLines", options));
});

self.addEventListener("notificationclick", event => {
    event.notification.close();
    const targetUrl = new URL(event.notification.data?.url || "/login.html", self.location.origin).href;
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const client of windows) {
            if (new URL(client.url).origin === self.location.origin) {
                await client.navigate(targetUrl);
                return client.focus();
            }
        }
        return self.clients.openWindow(targetUrl);
    })());
});
