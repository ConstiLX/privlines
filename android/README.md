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

PrivLines wird vorerst auf Render als **Web Service** gehostet; GitHub bleibt das Quellcode-Repository. Im Render-Service `npm ci` als **Build Command** und `npm start` als **Start Command** eintragen (`npm start` führt `node server/server.js` aus). Das Backend benötigt die Umgebungsvariablen aus der bestehenden Serverkonfiguration, insbesondere Datenbank-Zugangsdaten, `JWT_SECRET`, VAPID-Schlüssel und für native Anruf-Pushes `FIREBASE_SERVICE_ACCOUNT_BASE64`. Secrets gehören in Render in **Environment**, nicht ins GitHub-Repository.

## Privates GitHub-Repo für Profilbilder

Das private Repo `ConstiLX/privlines-profile-images` wird als Speicher für neue Profilbilder verwendet, sobald das Backend eingerichtet ist. Erstelle einen Fine-grained Personal Access Token mit Zugriff ausschließlich auf dieses Repo und der Berechtigung **Contents: Read and write**. Diesen Schlüssel in Render unter `GITHUB_PROFILE_IMAGES_TOKEN` speichern. Zusätzlich können `GITHUB_PROFILE_IMAGES_REPO=ConstiLX/privlines-profile-images` und `GITHUB_PROFILE_IMAGES_BRANCH=main` gesetzt werden. Der Token darf weder in GitHub noch in die Android-App gelangen.

Wenn `GITHUB_PROFILE_IMAGES_TOKEN` gesetzt ist, lädt das Backend neue Profilbilder in das private Repo und liefert sie nach Anmeldung über PrivLines aus. Ohne Token bleibt der bisherige lokale Upload-Pfad aktiv. Bereits vorhandene Profilbilder werden durch die Umstellung nicht automatisch migriert; sie müssen übertragen oder von den Nutzern erneut hochgeladen werden. Beim Ersetzen oder Löschen wird die aktuelle Datei aus dem Repo entfernt; ältere Versionen bleiben in der Git-Historie des privaten Repos erhalten.

Chat-Bilder, Gruppenmedien und Sprachnachrichten werden weiterhin lokal gespeichert. Render setzt das Standard-Dateisystem bei Neustarts und Deployments zurück. Dafür ist eine persistente Disk nötig; bei einem kostenpflichtigen Web Service den Mount-Pfad `/var/data/privlines-uploads` und `PRIVLINES_UPLOADS_DIR=/var/data/privlines-uploads` konfigurieren. Die existierende Datenbank bleibt separat und muss für Render erreichbar sein.

Die STRATO-Domain kann auf den Render-Service zeigen. Für Service Worker, Web-Push und Android muss PrivLines über HTTPS erreichbar sein. Der Render-Service muss außerdem dauerhaft verfügbar sein: Render-Free-Web-Services schlafen nach Inaktivität ein; für verlässlich zeitnahe Anrufbenachrichtigungen ist ein Tarif ohne Spin-down nötig.

Native FCM-Anrufe sind in diesem ersten Ausbau für **Direkt-Sprach- und Videoanrufe** eingerichtet. Gruppeneinladungen verwenden weiterhin den bisherigen Web-Push-/Socket.IO-Ablauf.
