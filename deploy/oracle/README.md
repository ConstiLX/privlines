# PrivLines auf Oracle Cloud Always Free

Diese Konfiguration hält den Node.js-Server unter systemd am Laufen, leitet HTTP/WebSocket über Nginx weiter und speichert Uploads dauerhaft auf dem VM-Boot-Volume.

## OCI-Konto und VM

1. In der OCI-Konsole in der **Home Region** eine Ubuntu-VM erstellen und beim Shape auf **Always Free Eligible** achten. Die aktuelle Always-Free-Kapazität für Ampere A1 entspricht insgesamt bis zu 2 OCPUs und 12 GB RAM; der kostenlose Boot-/Blockspeicher ist insgesamt auf 200 GB begrenzt.
2. Ein öffentliches Subnetz mit öffentlicher IPv4-Adresse wählen. In VCN-Sicherheitsliste/NSG TCP `80` und `443` aus dem Internet erlauben. SSH (`22`) auf die eigene Admin-IP beschränken.
3. Oracle weist darauf hin, dass sehr gering ausgelastete Always-Free-VMs zurückgefordert werden können. Always Free ist daher keine Uptime-Garantie.

## Laufzeit und Daten

Auf Ubuntu `git`, Node.js LTS, npm, MariaDB, Nginx und Certbot installieren. Dann:

```sh
sudo apt install git build-essential nginx mariadb-server certbot python3-certbot-nginx
# Install a supported Node.js LTS release for Ubuntu/ARM64 if not already present.
sudo adduser --system --group --home /var/lib/privlines privlines
sudo mkdir -p /opt/privlines /var/lib/privlines/uploads
sudo chown -R privlines:privlines /opt/privlines /var/lib/privlines
sudo git clone https://github.com/ConstiLX/privlines.git /opt/privlines
cd /opt/privlines
sudo -u privlines npm ci --omit=dev
```

Die Datenbank benötigt MariaDB/MySQL. Für Node.js/Bcrypt zusätzlich Compilerwerkzeuge installieren (Ubuntu: `build-essential`). Eine lokale MariaDB einrichten, eine leere Datenbank und einen eigenen DB-Benutzer anlegen. Für eine Datenmigration zuerst einen konsistenten Dump der bisherigen MariaDB erstellen und den Dump auf der VM importieren; erst danach den App-Dienst auf die neue Datenbank umstellen. Das Repository enthält absichtlich keine bestehenden Nutzerkonten oder Produktions-Secrets.

Die Uploads liegen unter `/var/lib/privlines/uploads`; dieses Verzeichnis bleibt auf dem VM-Boot-Volume über Neustarts und neue Git-Deployments erhalten.

## Secrets und Umgebungsvariablen

`/etc/privlines/privlines.env` mit Besitzer `root:privlines` und Modus `640` anlegen. Beispiel ohne echte Secrets:

```dotenv
PORT=3000
HOST=127.0.0.1
JWT_SECRET=HIER_EIN_LANGES_ZUFAELLIGES_SECRET
COOKIE_SECURE=true
SESSION_DAYS=90
PRIVLINES_UPLOADS_DIR=/var/lib/privlines/uploads
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=privlines
DB_PASSWORD=HIER_EIN_EIGENES_DB_PASSWORT
DB_NAME=privlines
DB_SSL=false
VAPID_PUBLIC_KEY=BESTEHENDEN_WERT_UEBERNEHMEN
VAPID_PRIVATE_KEY=BESTEHENDEN_WERT_UEBERNEHMEN
VAPID_SUBJECT=mailto:admin@privlines.com
```

Bestehende VAPID-Schlüssel aus dem aktuellen Hosting übernehmen. Neue Schlüssel würden bereits gespeicherte Push-Abonnements ungültig machen.

```sh
sudo install -d -o root -g privlines -m 750 /etc/privlines
sudo install -o root -g privlines -m 640 /dev/null /etc/privlines/privlines.env
sudo nano /etc/privlines/privlines.env
sudo install -o root -g root -m 644 deploy/oracle/privlines.service /etc/systemd/system/privlines.service
sudo systemctl daemon-reload
sudo systemctl enable --now privlines
```

## Domain und HTTPS

Nach der VM-Erstellung den DNS-`A`-Eintrag von `privlines.com` auf die öffentliche IPv4-Adresse setzen. `www.privlines.com` als `CNAME` auf `privlines.com` setzen oder ebenfalls auf die VM zeigen lassen. Nach DNS-Übernahme:

```sh
sudo install -o root -g root -m 644 deploy/oracle/nginx.conf /etc/nginx/sites-available/privlines
sudo ln -s /etc/nginx/sites-available/privlines /etc/nginx/sites-enabled/privlines
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d privlines.com -d www.privlines.com
```

TLS ist erforderlich, damit Service Worker und Web-Push im Browser funktionieren.

## Aktualisieren

```sh
cd /opt/privlines
sudo -u privlines git pull --ff-only
sudo -u privlines npm ci --omit=dev
sudo systemctl restart privlines
```

Vor dem DNS-Wechsel die bestehende Datenbank und benötigte Push-Secrets sichern. Nach dem Wechsel den Upload-Ordner und Anmeldung, Nachrichten, WebSocket-Anrufe sowie Web-Push testen.
