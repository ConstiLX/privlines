# PrivLines für Android

Das Android-Studio-Projekt verpackt die vorhandene PrivLines-Weboberfläche in eine native Android-App. Eingehende Direktanrufe kommen als hoch priorisierte Firebase-Cloud-Messaging-Datennachricht an. Android zeigt sie als Anrufbenachrichtigung mit Annehmen/Ablehnen und — wenn der Nutzer den Sonderzugriff erlaubt — als Vollbild-Anruf auf dem Sperrbildschirm. Die Annahme öffnet PrivLines und setzt den bestehenden WebRTC-Anruf fort. Profilbild-Uploads verwenden den nativen Android-Dateiauswahldialog.

## Firebase einrichten

1. In der Firebase Console ein Projekt erstellen oder das bestehende Projekt öffnen.
2. Eine Android-App mit Paketnamen `com.privlines.android` hinzufügen und `google-services.json` nach `android/app/google-services.json` kopieren. Diese Datei ist absichtlich in `.gitignore` eingetragen.
3. Firebase Cloud Messaging für das Projekt aktivieren.
4. Für den PrivLines-Server ein Google-Servicekonto mit Berechtigung zum Senden von Firebase-Cloud-Messaging-Nachrichten einrichten. Den privaten JSON-Schlüssel **nicht** in dieses Repository legen.
5. Den JSON-Schlüssel Base64-kodiert als `FIREBASE_SERVICE_ACCOUNT_BASE64` in der Serverumgebung setzen. Der Server liest den Schlüssel zur Laufzeit und sendet Anruf-Pushes über die FCM HTTP v1 API.

## Android Studio öffnen

Android Studio öffnen und den Ordner `android/` als Projekt laden. Das Projekt benötigt Android SDK 36 und JDK 17. Vor dem Erstellen der App die Basis-URL anpassen, falls PrivLines nicht unter `https://privlines.com` erreichbar ist. Das geht über `android/gradle.properties`:

```properties
PRIVLINES_BASE_URL=https://deine-domain.example
```

Beim ersten Start fragt Android nach Benachrichtigungsrechten. Auf Android 14 und neuer muss zusätzlich der Sonderzugriff **Vollbild-Benachrichtigungen** erlaubt werden, damit ein Anruf den Sperrbildschirm öffnen darf. Mikrofon und Kamera fragt PrivLines erst an, wenn ein Anruf sie benötigt.

Nach der Anmeldung in der nativen App wird das FCM-Gerätetoken an `/api/push/android/subscribe` gebunden. Das Token ist einem eingeloggten PrivLines-Konto zugeordnet und wird nicht im Client-Quellcode hinterlegt.

## Hosting auf Render

PrivLines wird vorerst auf Render als **Web Service** gehostet; GitHub bleibt das Quellcode-Repository. Das Backend startet mit `npm start` (im Repository ist das `node server/server.js`) und benötigt die Umgebungsvariablen aus der bestehenden Serverkonfiguration, insbesondere Datenbank-Zugangsdaten, `JWT_SECRET`, VAPID-Schlüssel und für native Anruf-Pushes `FIREBASE_SERVICE_ACCOUNT_BASE64`. Secrets gehören in Render in **Environment**, nicht ins GitHub-Repository.

Für Profilbilder und Chat-/Sprachdateien reicht das Standard-Dateisystem eines Render-Web-Services nicht: Render setzt es bei Neustarts und Deployments zurück. Render dokumentiert persistente Disks für kostenpflichtige Web Services; dazu muss ein Disk-Mount-Pfad eingerichtet und `PRIVLINES_UPLOADS_DIR` auf genau diesen Pfad gesetzt werden, zum Beispiel `/var/data/privlines-uploads`. Ohne persistenten Speicher gehen Uploads bei einem Neustart oder Deployment verloren. Die existierende Datenbank bleibt separat und muss für Render erreichbar sein.

Die STRATO-Domain kann auf den Render-Service zeigen. Für Service Worker, Web-Push und Android muss PrivLines über HTTPS erreichbar sein. Der Render-Service muss außerdem dauerhaft verfügbar sein: Render-Free-Web-Services schlafen nach Inaktivität ein; für verlässlich zeitnahe Anrufbenachrichtigungen ist ein Tarif ohne Spin-down nötig.

Native FCM-Anrufe sind in diesem ersten Ausbau für **Direkt-Sprach- und Videoanrufe** eingerichtet. Gruppeneinladungen verwenden weiterhin den bisherigen Web-Push-/Socket.IO-Ablauf.
