/* PrivLines PWA background notifications */
self.addEventListener("install", event => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("push", event => {
    event.waitUntil((async () => {
        let data = {};
        try {
            data = event.data ? event.data.json() : {};
        } catch (error) {
            console.warn("PrivLines: Push-Payload ist kein gültiges JSON.", error);
        }

        // In einem sichtbaren und fokussierten App-Fenster zeigt die Seite
        // selbst ihre Nachricht. Im Hintergrund wird der System-Push gezeigt.
        const clients = await self.clients.matchAll({
            type: "window",
            includeUncontrolled: true
        });
        const appIsFocused = clients.some(client => {
            try {
                return new URL(client.url).origin === self.location.origin
                    && client.visibilityState === "visible"
                    && client.focused === true;
            } catch (_) {
                return false;
            }
        });
        if (appIsFocused) return;

        const isPrivateCall = data.kind === "call";
        const isGroupCall = data.kind === "group-call";
        const isCall = isPrivateCall || isGroupCall;

        const options = {
            body: data.body || (isCall
                ? "Du wirst angerufen."
                : "Du hast eine neue Nachricht."),
            icon: "/logo_black.png",
            badge: "/logo_black.png",
            tag: isCall
                ? `privlines-call-${data.callId || "incoming"}`
                : `privlines-message-${data.chatId || "new"}`,
            renotify: isCall,
            requireInteraction: isCall,
            data: {
                url: data.url || "/chat.html",
                callId: data.callId || null,
                kind: data.kind || "message"
            },
            // Private Einzelanrufe können direkt aus der Benachrichtigung
            // angenommen oder abgelehnt werden. Gruppenanrufe öffnen die PWA.
            ...(isPrivateCall
                ? {
                    actions: [
                        { action: "answer", title: "Annehmen" },
                        { action: "reject", title: "Ablehnen" }
                    ]
                }
                : {})
        };

        await self.registration.showNotification(data.title || "PrivLines", options);
    })());
});

self.addEventListener("notificationclick", event => {
    const notification = event.notification;
    const data = notification.data || {};
    notification.close();

    const targetUrl = new URL(data.url || "/chat.html", self.location.origin);

    // call.js liest diese Parameter bereits aus und führt die gewählte Aktion
    // aus, sobald der Server das noch gültige Anrufangebot zurückgeliefert hat.
    if (
        data.kind === "call"
        && data.callId
        && (event.action === "answer" || event.action === "reject")
    ) {
        targetUrl.searchParams.set("nativeCallId", String(data.callId));
        targetUrl.searchParams.set("nativeCallAction", event.action);
    }

    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({
            type: "window",
            includeUncontrolled: true
        });

        for (const client of windows) {
            try {
                if (new URL(client.url).origin === self.location.origin) {
                    await client.navigate(targetUrl.href);
                    return client.focus();
                }
            } catch (error) {
                console.warn("PrivLines: PWA-Fenster konnte nicht geöffnet werden.", error);
            }
        }

        return self.clients.openWindow(targetUrl.href);
    })());
});
