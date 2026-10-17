# PrivLines Upload-Speicher

Profilbilder und andere Uploads werden unter `PRIVLINES_UPLOADS_DIR` gespeichert. Der Server erstellt darin automatisch die Unterordner `profiles/`, `images/` und `audio/` und stellt sie weiter unter `/uploads/...` bereit.

## Produktion

Binde beim Hosting einen persistenten Datenträger ein und setze `PRIVLINES_UPLOADS_DIR` auf dessen absoluten Mount-Pfad, zum Beispiel `/var/lib/privlines/uploads`. Der Prozess braucht Schreib- und Leserechte für dieses Verzeichnis. Ohne die Umgebungsvariable bleibt der lokale Ordner `public/uploads` als rückwärtskompatibler Standard aktiv; dieser ist bei kurzlebigen Deployments nicht dauerhaft.

Vor dem Wechsel müssen vorhandene Dateien aus `public/uploads/` in den persistenten Speicher kopiert werden, damit bestehende Datenbankpfade wie `/uploads/profiles/<datei>` weiter funktionieren. Anschließend den Dienst neu starten. Alte Dateipfade, deren Dateien nie in den Speicher übernommen wurden, müssen neu hochgeladen werden.

Git speichert nur den Servercode, keine Nutzerdaten oder Profilbilder. Der tatsächliche Datenträger muss im Hosting-Konto angelegt und an den Dienst gebunden werden; dieser Schritt ist hosterspezifisch.
