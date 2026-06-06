#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""GPT-Anreicherung der Restaurants (Build-Zeit, gecacht).

Pro Restaurant einmalig: cuisine, extra_tags, blurb -> enriched.json.
Anschließend `python3 build_data.py` ausführen (merged enriched.json).

Aufruf:
    OPENAI_API_KEY=sk-... python3 enrich.py            # nur neue/fehlende
    OPENAI_API_KEY=sk-... python3 enrich.py --force     # alles neu

Kosten: nur fehlende Einträge werden angefragt (Cache in enriched.json).
GPT liefert NUR Semantik (Küche/Kategorie/neutraler Satz) – KEINE Fakten
wie Adresse/Öffnungszeiten/Preise (die kämen aus Google Places).
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error

from build_data import parse_records, enrich_key

CACHE = "enriched.json"
MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
ENDPOINT = "https://api.openai.com/v1/chat/completions"

# Erlaubte Kategorie-Tags (deutsch, Title Case). GPT darf nur hieraus wählen.
ALLOWED_TAGS = [
    "Trüffelpasta", "Trüffelpizza", "Trüffel", "Italienisch", "Sushi", "Poké",
    "Ramen", "Indisch", "Burger", "Frühstück", "Café", "Eis", "Bar", "Shisha",
    "Käsefondue", "Vietnamesisch", "Chinesisch", "Japanisch", "Koreanisch",
    "Thailändisch", "Asiatisch", "Fusion", "Griechisch", "Türkisch", "Mexikanisch",
    "Vegan", "Vegetarisch", "Steakhaus", "Fine Dining", "Brunch", "Bistro",
    "Rooftop", "Mediterran", "Spanisch", "Französisch", "Pizza", "Pasta",
]

SYSTEM = (
    "Du kategorisierst Restaurants in Deutschland anhand von Name und Stadt. "
    "Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, keine Erklärung. "
    "Erfinde KEINE Fakten (keine Öffnungszeiten, Preise, Adressen, Bewertungen, "
    "konkrete Gerichte, die du nicht sicher kennst)."
)


def prompt(rec):
    return (
        f"Restaurant: \"{rec['name']}\" in {rec['city']}.\n"
        f"Erlaubte Tags: {', '.join(ALLOWED_TAGS)}.\n"
        "Gib JSON mit genau diesen Feldern:\n"
        "{\n"
        '  "cuisine": "primäre Küche, 1-2 Wörter deutsch (z.B. Italienisch, Sushi, Café)",\n'
        '  "extra_tags": ["0-3 passende Tags NUR aus der erlaubten Liste"],\n'
        '  "blurb": "EIN neutraler deutscher Satz, max 12 Wörter, nur auf Basis von Name/Küche, ohne erfundene Fakten"\n'
        "}\n"
        "Wenn die Küche aus dem Namen nicht erkennbar ist: cuisine=\"\", extra_tags=[], "
        "blurb=kurzer neutraler Platzhalter."
    )


def call_openai(rec, api_key, retries=2):
    body = json.dumps({
        "model": MODEL,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": prompt(rec)},
        ],
    }).encode("utf-8")
    req = urllib.request.Request(ENDPOINT, data=body, method="POST", headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    })
    last = None
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                data = json.loads(r.read().decode("utf-8"))
            content = data["choices"][0]["message"]["content"]
            obj = json.loads(content)
            return {
                "cuisine": str(obj.get("cuisine", "")).strip(),
                "extra_tags": [t for t in (obj.get("extra_tags") or []) if t in ALLOWED_TAGS],
                "blurb": str(obj.get("blurb", "")).strip(),
            }
        except (urllib.error.HTTPError, urllib.error.URLError, KeyError, ValueError) as e:
            last = e
            if attempt < retries:
                time.sleep(2 * (attempt + 1))
    print(f"  ! Fehler bei {rec['name']} ({rec['city']}): {last}", file=sys.stderr)
    return None


def main():
    force = "--force" in sys.argv
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        sys.exit("OPENAI_API_KEY nicht gesetzt.")

    try:
        with open(CACHE, encoding="utf-8") as f:
            cache = json.load(f)
    except FileNotFoundError:
        cache = {}

    records = parse_records()
    todo = [r for r in records if force or enrich_key(r) not in cache]
    print(f"{len(records)} Restaurants, {len(todo)} anzufragen (Cache: {len(cache)}).")

    done = 0
    for r in todo:
        res = call_openai(r, api_key)
        if res is None:
            continue
        cache[enrich_key(r)] = res
        done += 1
        if done % 10 == 0:  # Zwischenspeichern – Fortschritt bleibt erhalten
            with open(CACHE, "w", encoding="utf-8") as f:
                json.dump(cache, f, ensure_ascii=False, indent=2)
        print(f"  ✓ {r['name']} → {res['cuisine'] or '—'}")

    with open(CACHE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)
    print(f"Fertig: {done} angereichert, Cache {len(cache)}. Jetzt: python3 build_data.py")


if __name__ == "__main__":
    main()
