# PrivLines – Anruf- und Chat-Reparaturen

## Enthaltene Änderungen

- Audio-only-Anrufe verwenden jetzt ein separates `audio`-Element für den Ton, statt sich auf die Audiowiedergabe eines Video-Elements ohne Videospur zu verlassen.
- Remote-Audio/Video startet mit expliziter Wiedergabe; blockierte Wiedergabe wird protokolliert.
- Einzel- und Gruppenanrufe verwenden dieselbe ICE-Konfiguration. STUN ist als Fallback enthalten; optional kann ein TURN-Server für restriktive Mobilfunk-/WLAN-Netze konfiguriert werden.
- Bereits vorhandene Chats werden beim Laden im Hintergrund vorab indiziert. Beim erneuten Öffnen eines Chats entfällt dadurch der zusätzliche POST-Aufruf zum Auflösen der Chat-ID.
- Der Blockstatus wird parallel zum Nachrichtenladen abgerufen und hält das Öffnen des Chats nicht mehr auf. Ein verspäteter Status einer vorherigen Unterhaltung überschreibt nicht mehr den aktuell ausgewählten Kontakt.

## TURN für zuverlässige Anrufe

STUN allein reicht nicht in jedem Netzwerk. Wenn Anrufe zwischen Mobilfunknetzen, Firmen-WLANs oder restriktiven Routern weiterhin nicht verbinden, muss ein TURN-Dienst bereitgestellt werden. Trage dessen Werte als Umgebungsvariablen auf dem Server ein:

- `TURN_URLS` – eine oder mehrere TURN-URLs, durch Kommas getrennt, z. B. `turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp`
- `TURN_USERNAME` – Benutzername des TURN-Dienstes
- `TURN_CREDENTIAL` – Kennwort bzw. Credential des TURN-Dienstes

Der Client fragt die ICE-Konfiguration über den angemeldeten Endpunkt `/api/webrtc-config` ab. Ohne diese Variablen funktioniert der STUN-Fallback weiterhin, aber eine Verbindung kann je nach Netzwerk trotzdem scheitern.

## Prüfung

Die JavaScript-Dateien wurden mit `node --check` auf Syntaxfehler geprüft. Ein echter Audio-/Netzwerktest benötigt zwei angemeldete Geräte und einen laufenden Server; das lässt sich in dieser isolierten Umgebung nicht simulieren.
