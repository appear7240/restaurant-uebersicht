# Admin-Backend (Option A)

Pflege-Tool: Restaurants hinzufügen/löschen, neue Einträge optional via OpenAI
anreichern, Datensatz nach `../data/restaurants.js` **exportieren**. Die
statische Seite bleibt unverändert und liest weiter nur diese Datei – das
Backend muss **nicht** öffentlich erreichbar sein.

## Lokal starten

```bash
pip install -r requirements.txt --break-system-packages
OPENAI_API_KEY=sk-... uvicorn app:app --host 0.0.0.0 --port 8080
# Admin-UI: http://<host>:8080/
```

Ohne `OPENAI_API_KEY` funktioniert alles, nur ohne GPT-Anreicherung (es werden
nur die aus dem Namen abgeleiteten Basis-Tags gesetzt).

## Env

| Variable | Wirkung |
|---|---|
| `OPENAI_API_KEY` | aktiviert GPT-Anreicherung beim Hinzufügen |
| `OPENAI_MODEL` | Default `gpt-4o-mini` |
| `ADMIN_TOKEN` | wenn gesetzt: Schreibrouten brauchen Header `X-Admin-Token` |
| `GIT_PUSH=1` | beim Export zusätzlich `git add/commit/push` |
| `RUE_DB` / `RUE_DATA` | DB- bzw. Export-Pfad überschreiben |

## Im LXC 177 (neben nginx)

Läuft das Backend im selben Container wie die Seite, schreibt der Export
**direkt** die ausgelieferte Datei `/var/www/restaurant/data/restaurants.js` —
die LAN-Seite ist sofort aktuell. Mit `GIT_PUSH=1` wird zusätzlich gepusht,
sodass auch GitHub Pages neu baut.

```bash
pct exec 177 -- bash -c '
cd /var/www/restaurant/backend
pip install -r requirements.txt --break-system-packages
cat >/etc/systemd/system/restaurant-admin.service <<EOF
[Unit]
Description=Restaurant-Übersicht Admin
After=network.target
[Service]
WorkingDirectory=/var/www/restaurant/backend
Environment=OPENAI_API_KEY=sk-...
Environment=ADMIN_TOKEN=setzen
ExecStart=/usr/local/bin/uvicorn app:app --host 0.0.0.0 --port 8080
Restart=on-failure
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now restaurant-admin'
```

Admin-UI dann intern unter `http://192.168.1.86:8080/`. Nicht über den
öffentlichen Tunnel freigeben (Pflege-Tool).

## Workflow

1. Admin-UI öffnen → Restaurant + Stadt (+ optional Notiz) → „Hinzufügen".
2. „Exportieren" → schreibt `restaurants.js` (und pusht, wenn `GIT_PUSH=1`).
