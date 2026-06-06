#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Erzeugt data/restaurants.js aus der kuratierten Rohliste.
Tags werden konservativ abgeleitet (explizite Klammer-Angabe + eindeutige
lexikalische Signale im Namen). Keine Erfindung von Kategorien."""
import json
import re
from datetime import date

RAW = r"""
Bochum
- Trattoria Momo (Trüffelpasta)
- Bassano Vinoteca e Cucina Italiana (Trüffelpasta)
- NEĀ The Deli & Urban Concept Store (Frühstück)
- Café Konkret (Frühstück)
- Café Zuckersüß (Frühstück)
- Lokmahouse Café (Café)
- Chillers
- Heiter & Herrlich
- Arte Italiana (Trüffelpasta)
- Knüppelknifte
- Kleene Tocke
- Traumkuh (Burger)
- Mufasa (Frühstück)
- Takumi (Ramen)
- Nandy's (Indisch)
- Cups 'n Berry (Frühstück)
- Veeva Acai (Frühstück)

Castrop-Rauxel
- Trattoria Puglia

Bottrop
- Ristorante Fratelli (Trüffelpasta)

Dortmund
- AMI Restaurant
- Café Lemberg (Frühstück)
- MemorieZ
- BASE.KITCHEN
- Ong Bui Asia Fusion
- Pasta Lounge
- Medusa (Frühstück)
- MA'LOA Poké Bowl
- bona'me
- OISHINBO Restaurant & Bar (jetzt auch noch Frühstück)
- Raphael's am Phoenixsee
- Bosco (Trüffelpizza)
- Bocca
- Meeting die Brunchery (Frühstück)
- Ristorante Sale & Pepe
- Saigon Soul
- Amara (Frühstück)
- Sono
- Café Lotte (Frühstück)
- Noché (Frühstück)
- Imperatore (Italiener, Trüffel)
- Eiscafé Neue Mitte (Frühstück + Eis)
- Saft-Manufaktur (Frühstück)

Dinslaken
- Labbis (Café)

Duisburg
- Café Liu (Frühstück)
- Eli's Crumble (Café)
- Cheesy Pasta
- Luna Bistrobar
- Brunchies

Düsseldorf
- King Fusion
- BaBa Sushi
- Tengri Tagh
- Zweigleisig
- Xiao Long Kan
- MAKI Sushi und Burrito
- Trattoria Zucchero (Trüffelpasta)
- Ishi Fusion Sushi Restaurant
- QOMO Restaurant & Bar
- Piazza Saitta (Trüffelpasta)
- 20° RESTOBAR
- Done Cake (Café)
- El&N Café
- thewaytonapoli
- Café Buur (Frühstück)
- Soulbrunch (Frühstück)
- Cloud Kitchen (Frühstück)
- The Loft Garden
- Shari's Kitchen (Trüffelpasta)
- Lido Malkasten (Trüffelpasta)
- Boho Brunch Café (Frühstück)
- bona'me
- Riva (Trüffelpasta)
- Rheinhardts (Käsefondue)
- Sayomi
- Café Zen (Frühstück)
- Trattoria il Tartufo

Essen
- ION Fusion
- Chillers
- Lil•Tiger Rooftop Terrace (Bar)
- Tacos
- Ruff's Burger
- Trattoria Trüffel
- Brama's Italian Food Club (Trüffelpasta)
- Delulu Café (Frühstück)

Moers
- Ceyse Café
- Trattoria Emma
- Restaurant Corfu
- La Calma
- Maguro Sushi Grill & Bar
- Okinawa Sushi & More
- Perfetto Moers am Altmarkt (Frühstück)
- Kaori Sushi & Asia Restaurant

Mülheim
- Brotkorb (Frühstück)

Gelsenkirchen
- Sorella Café (Frühstück)
- Buer 1 (Frühstück)
- BUERNO (Café)
- DoNg Sushi Asian-Fusion Restaurant
- La Voca Café (Frühstück)
- 45 Burgers

Hamburg
- Tagliere e Vino (Trüffelpasta)
- Sencha Sushi Bar & Restaurant

Herten
- Brunch and Cake (Frühstück)

Köln
- Oscar im Apropos (Trüffelpasta)
- Grissini Restaurant & Terrasse
- Bricco -The Club Restaurant-
- MA'LOA Poké Bowl
- bona'me
- Gigi Italian (eher Frühstück)
- Café de Paris
- Haus am See
- Köln Sky
- Ristorante il Tartufo (Trüffelpasta)

Krefeld
- Sigon
- Cheat Day (Frühstück)

Oberhausen
- Tropical Café (Frühstück)
- Vivre Bar (Shishabar)
- Ruby's Cafe Bar (Shisha)
- Edelweiß (Café)
- Café Nova (Frühstück)

Recklinghausen
- BLACK BONSAI - Restaurant & Bar

Wuppertal
- The Loft (Frühstück)
- MA'LOA Poké Bowl
- Goldalm
"""

# Klammer-Keyword -> Tag
NOTE_MAP = [
    ("trüffelpasta", "Trüffelpasta"),
    ("trüffelpizza", "Trüffelpizza"),
    ("trüffel", "Trüffel"),
    ("frühstück", "Frühstück"),
    ("käsefondue", "Käsefondue"),
    ("shisha", "Shisha"),
    ("café", "Café"),
    ("cafe", "Café"),
    ("burger", "Burger"),
    ("ramen", "Ramen"),
    ("indisch", "Indisch"),
    ("poké", "Poké"),
    ("poke", "Poké"),
    ("eis", "Eis"),
    ("bar", "Bar"),
]

# Eindeutige lexikalische Signale im Namen
NAME_MAP = [
    ("sushi", "Sushi"),
    ("poké", "Poké"),
    ("burger", "Burger"),
    ("café", "Café"),
    ("trattoria", "Italienisch"),
    ("ristorante", "Italienisch"),
    ("italiana", "Italienisch"),
    ("italian", "Italienisch"),
    ("napoli", "Italienisch"),
    ("pizza", "Italienisch"),
    ("pasta", "Italienisch"),
]

# Tokens, die in einer Klammer komplett von Chips abgedeckt sind ->
# dann brauchen wir keine zusaetzliche Notiz-Zeile.
COVERED = {
    "trüffelpasta", "trüffelpizza", "trüffel", "frühstück", "käsefondue",
    "shisha", "shishabar", "café", "cafe", "burger", "ramen", "indisch",
    "poké", "poke", "eis", "bar", "italiener", "italienisch", "sushi",
    "pizza", "pasta",
}

TAG_ORDER = [
    "Trüffelpasta", "Trüffelpizza", "Trüffel", "Italienisch", "Sushi",
    "Poké", "Ramen", "Indisch", "Burger", "Frühstück", "Café", "Eis",
    "Bar", "Shisha", "Käsefondue",
]


def derive_tags(name: str, note: str):
    tags = []
    nl = (note or "").lower()
    for kw, tag in NOTE_MAP:
        if kw in nl and tag not in tags:
            tags.append(tag)
    # "Trüffelpasta"/"Trüffelpizza" implizieren keinen zusaetzlichen "Trüffel"
    if "Trüffelpasta" in tags or "Trüffelpizza" in tags:
        tags = [t for t in tags if t != "Trüffel"]
    nm = name.lower()
    for kw, tag in NAME_MAP:
        if kw in nm and tag not in tags:
            tags.append(tag)
    # Stabile Reihenfolge
    return [t for t in TAG_ORDER if t in tags]


def keep_note(note: str) -> bool:
    if not note:
        return False
    toks = re.findall(r"[a-zäöüß]+", note.lower())
    if not toks:
        return False
    return any(t not in COVERED for t in toks)


def parse_records():
    """Rohliste -> Liste strukturierter Records (ohne Anreicherung)."""
    records = []
    city = None
    for line in RAW.splitlines():
        s = line.strip()
        if not s:
            continue
        if not s.startswith("- "):
            city = s
            continue
        body = s[2:].strip()
        m = re.search(r"\(([^)]*)\)\s*$", body)
        note = None
        if m:
            note = m.group(1).strip()
            name = body[: m.start()].strip()
        else:
            name = body
        rec = {"name": name, "city": city, "tags": derive_tags(name, note)}
        if keep_note(note):
            rec["note"] = note
        records.append(rec)
    return records


def enrich_key(rec):
    return rec["name"] + "||" + rec["city"]


def merge_enrichment(records, path="enriched.json"):
    """Falls vorhanden, GPT-Anreicherung (cuisine/extra_tags/blurb) einmischen.
    Fehlt die Datei, bleiben die Records unverändert (Pipeline degradiert sauber)."""
    try:
        with open(path, encoding="utf-8") as f:
            cache = json.load(f)
    except FileNotFoundError:
        return 0
    n = 0
    for rec in records:
        e = cache.get(enrich_key(rec))
        if not e:
            continue
        n += 1
        if e.get("blurb"):
            rec["blurb"] = e["blurb"]
        extra = list(e.get("extra_tags") or [])
        if e.get("cuisine"):
            extra.append(e["cuisine"])
        merged = list(rec["tags"])
        for t in extra:
            t = (t or "").strip()
            if t and t not in merged:
                merged.append(t)
        # bekannte Tags in fester Reihenfolge zuerst, Rest in Fundreihenfolge
        known = [t for t in TAG_ORDER if t in merged]
        rest = [t for t in merged if t not in TAG_ORDER]
        rec["tags"] = known + rest
    return n


def main():
    records = parse_records()
    enriched = merge_enrichment(records)

    payload = {"updated": date.today().isoformat(), "restaurants": records}
    js = (
        "// AUTO-GENERIERT von build_data.py – nicht von Hand editieren.\n"
        "// Quelle: kuratierte Liste (+ optionale GPT-Anreicherung aus enriched.json).\n"
        "// Neu generieren: python3 build_data.py\n"
        "window.RESTAURANT_DATA = "
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + ";\n"
    )
    with open("data/restaurants.js", "w", encoding="utf-8") as f:
        f.write(js)

    # Verifikation
    from collections import Counter
    cities = Counter(r["city"] for r in records)
    tagc = Counter(t for r in records for t in r["tags"])
    untagged = [r["name"] for r in records if not r["tags"]]
    print(f"Total: {len(records)} Restaurants in {len(cities)} Städten")
    print(f"Angereichert: {enriched}/{len(records)}")
    print("--- Pro Stadt ---")
    for c, n in cities.items():
        print(f"{c}: {n}")
    print("--- Tags ---")
    for t, n in tagc.most_common():
        print(f"{t}: {n}")
    print(f"--- Ohne Tag ({len(untagged)}) ---")
    print(", ".join(untagged))


if __name__ == "__main__":
    main()
