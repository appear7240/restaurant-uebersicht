# Restaurant-Übersicht

Kuratierte, statische Restaurant-Übersicht (NRW + Hamburg). Filterbar nach
**Stadt**, **Kategorie** und **Freitextsuche**. Aktuell 122 Adressen in 18 Städten.

## Features

- **Restaurant-Roulette „Wohin heute?"** – würfelt eine Zufallsadresse aus der
  aktuell gefilterten Auswahl (Slot-Animation, Re-Roll, „Im Verzeichnis zeigen").
- **Dark-/Light-Mode** – warmer Candlelit-Dark-Mode, in `localStorage` gemerkt,
  Default nach `prefers-color-scheme`.
- **Teilbare Filter** – Stadt/Kategorie/Suche werden in die URL (`#…`) geschrieben;
  Link teilen oder bookmarken stellt den Filterzustand wieder her.
- **Landkarte** – Umschalter Liste/Landkarte; Städte als Blasen (Größe = Anzahl),
  Klick → Stadt-Filter. Karten via Leaflet/OpenStreetMap, kein API-Key.
- Diakritik-unempfindliche Suche (`dusseldorf` findet „Düsseldorf").
- Reduced-Motion-tauglich, tastaturbedienbar.

## Stack

Bewusst minimal: reines HTML/CSS/Vanilla-JS, **kein Build-Schritt**, **keine
Runtime-Abhängigkeiten**. Einzige externe Ressource: Google Fonts (Fraunces +
Hanken Grotesk) per CDN. Läuft per `file://`, GitHub Pages, nginx oder jedem
Static-Host ohne Änderung.

## Struktur

```
index.html            UI-Gerüst
assets/styles.css      Theme (warm/editorial)
assets/app.js          Filter, Suche, Rendering
data/restaurants.js    generierte Daten (window.RESTAURANT_DATA)
build_data.py          erzeugt data/restaurants.js aus der Rohliste
```

## Daten pflegen

Nicht `data/restaurants.js` von Hand editieren. Stattdessen Rohliste in
`build_data.py` (Variable `RAW`) anpassen, dann neu generieren:

```bash
python3 build_data.py
```

Tags werden konservativ abgeleitet (explizite Klammer-Angabe + eindeutige
lexikalische Signale im Namen, z. B. `Trattoria` → Italienisch, `Sushi` →
Sushi). Keine geratenen Kategorien; nicht eindeutige Einträge bleiben ohne Tag
und sind weiterhin über Stadt/Suche auffindbar.

## Daten anreichern (optional, GPT)

`enrich.py` reichert je Restaurant **einmalig** Küche/Kategorie/Kurztext an
(Cache in `enriched.json`, nur fehlende Einträge kosten). GPT liefert nur
Semantik – **keine** Fakten (Adresse/Öffnungszeiten/Preise).

```bash
OPENAI_API_KEY=sk-... python3 enrich.py          # nur neue/fehlende
OPENAI_API_KEY=sk-... python3 enrich.py --force   # alles neu
python3 build_data.py                             # enriched.json -> restaurants.js
```

Modell via `OPENAI_MODEL` (Default `gpt-4o-mini`). `enriched.json` mit committen,
damit der Build ohne erneute API-Calls reproduzierbar bleibt.

## Deploy

- **GitHub Pages:** Repo → Settings → Pages → Branch `main`, Ordner `/ (root)`.
- **Cloudflare Pages:** Repo verbinden, Build-Command leer, Output-Verzeichnis `/`.
- **nginx / statisch:** Verzeichnis ausliefern, `index.html` als Root.
