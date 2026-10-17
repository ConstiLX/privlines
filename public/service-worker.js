/* PrivLines Push-Benachrichtigungen im Hintergrund */
self.addEventListener("push", event => {
    event.waitUntil((async () => {
        let data = {};
        try {
            data = event.data ? event.data.json() : {};
        } catch (error) {
            console.warn("PrivLines: Push-Payload ist kein gültiges JSON.", error);
        }

        // Die sichtbare App zeigt bereits ihre eigene In-App-Meldung bzw. den
        // Anrufdialog. Verhindert doppelte System-Benachrichtigungen.
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        const visibleClient = windows.some(client => {
            try {
                return new URL(client.url).origin === self.location.origin && client.visibilityState === "visible";
            } catch {
                return false;
            }
        });
        if (visibleClient) return;

        const isCall = data.kind === "call";
        const isGroupCall = data.kind === "group-call";
        const call = isCall || isGroupCall;
        const options = {
            body: data.body || (call ? "Du wirst angerufen." : "Du hast eine neue Nachricht."),
            icon: "/logo_black.png",
            badge: "/logo_black.png",
            tag: call ? `privlines-call-${data.callId || "incoming"}` : `privlines-message-${data.chatId || "new"}`,
            renotify: call,
            requireInteraction: call,
            data: {
                url: data.url || "/chat.html",
                callId: data.callId || null,
                kind: data.kind || "message"
            },
            ...(call ? { actions: [{ action: "open", title: "PrivLines öffnen" }] } : {})
        };
        await self.registration.showNotification(data.title || "PrivLines", options);
    })());
});

self.addEventListener("notificationclick", event => {
    event.notification.close();
    const data = event.notification.data || {};
    const targetUrl = new URL(data.url || "/chat.html", self.location.origin).href;
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
