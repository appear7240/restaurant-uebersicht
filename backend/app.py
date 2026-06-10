#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Admin-Backend (Option A) – Pflege-Tool, Seite bleibt statisch.

- Restaurants hinzufügen/löschen (SQLite), neue Einträge optional via OpenAI anreichern.
- API-Keys (OpenAI + Maps-JS) werden über die Oberfläche gepflegt (DB), je mit Test-Button.
- Export schreibt data/restaurants.js; der Maps-Key wird in config.js propagiert.

Start (aus backend/):
    pip install -r requirements.txt --break-system-packages
    uvicorn app:app --host 0.0.0.0 --port 8080
Env: ADMIN_TOKEN (Schreibschutz), GIT_PUSH=1 (Export pusht), RUE_DB/RUE_DATA/RUE_CONFIG.
OpenAI/Maps-Keys werden bevorzugt aus der DB gelesen (Oberfläche), sonst aus ENV.
"""
import json
import os
import sqlite3
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))
import build_data  # noqa: E402
import enrich       # noqa: E402

DB_PATH = os.environ.get("RUE_DB", str(BASE / "backend" / "restaurants.db"))
DATA_PATH = os.environ.get("RUE_DATA", str(BASE / "data" / "restaurants.js"))
CONFIG_PATH = os.environ.get("RUE_CONFIG", str(BASE / "config.js"))
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")


def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    con = db()
    con.execute(
        """CREATE TABLE IF NOT EXISTS restaurants(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL, city TEXT NOT NULL,
            tags TEXT NOT NULL DEFAULT '[]',
            note TEXT, blurb TEXT, cuisine TEXT,
            created_at TEXT DEFAULT (datetime('now')))"""
    )
    con.execute("CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)")
    for col, decl in (("lat", "REAL"), ("lng", "REAL"), ("place_id", "TEXT"),
                      ("photo", "TEXT"), ("rating", "REAL"), ("reviews", "INTEGER"),
                      ("website", "TEXT"), ("hours", "TEXT"), ("resolved", "INTEGER")):
        try:
            con.execute(f"ALTER TABLE restaurants ADD COLUMN {col} {decl}")
        except sqlite3.OperationalError:
            pass  # Spalte existiert bereits
    con.commit()
    if con.execute("SELECT COUNT(*) AS n FROM restaurants").fetchone()["n"] == 0:
        for r in build_data.parse_records():
            con.execute(
                "INSERT INTO restaurants(name,city,tags,note) VALUES(?,?,?,?)",
                (r["name"], r["city"], json.dumps(r["tags"], ensure_ascii=False), r.get("note")),
            )
        con.commit()
    apply_geo(con)
    con.close()


def apply_geo(con, path=None):
    """geo.json -> lat/lng/place_id der vorhandenen Zeilen (idempotent).
    So holt ein Redeploy neue Koordinaten in die bestehende DB."""
    path = path or str(BASE / "geo.json")
    try:
        with open(path, encoding="utf-8") as f:
            geo = json.load(f)
    except FileNotFoundError:
        return
    for k, g in geo.items():
        name, _, city = k.partition("||")
        hrs = g.get("hours")
        con.execute(
            "UPDATE restaurants SET lat=?, lng=?, place_id=?, photo=?, rating=?, reviews=?, website=?, "
            "hours=COALESCE(?,hours), resolved=COALESCE(?,resolved) WHERE name=? AND city=?",
            (g["lat"], g["lng"], g.get("placeId"), g.get("photo"), g.get("rating"),
             g.get("reviews"), g.get("website"),
             (json.dumps(hrs, ensure_ascii=False) if hrs else None),
             1 if g.get("hours") else None, name, city))
    con.commit()


# ── Settings / Keys ─────────────────────────────────────
def get_setting(k, default=None):
    con = db()
    row = con.execute("SELECT value FROM settings WHERE key=?", (k,)).fetchone()
    con.close()
    return row["value"] if row and row["value"] else default


def set_setting(k, v):
    con = db()
    con.execute(
        "INSERT INTO settings(key,value) VALUES(?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (k, v))
    con.commit()
    con.close()


def get_openai_key():
    return get_setting("openai_key") or os.environ.get("OPENAI_API_KEY")


def get_maps_key():
    return get_setting("maps_key") or os.environ.get("MAPS_API_KEY", "")


def mask(s):
    if not s:
        return ""
    return "…" + s[-4:] if len(s) >= 4 else "…"


def write_config_file():
    js = ("// AUTO-GENERIERT vom Admin-Backend. Maps-JS-Key (client-seitig).\n"
          "window.RUE_CONFIG = " + json.dumps({"mapsKey": get_maps_key() or ""}, ensure_ascii=False) + ";\n")
    Path(CONFIG_PATH).parent.mkdir(parents=True, exist_ok=True)
    Path(CONFIG_PATH).write_text(js, encoding="utf-8")


def order_tags(tags):
    known = [t for t in build_data.TAG_ORDER if t in tags]
    rest = [t for t in tags if t not in build_data.TAG_ORDER]
    return known + rest


def row_public(r):
    d = {"name": r["name"], "city": r["city"], "tags": json.loads(r["tags"] or "[]")}
    if r["note"]:
        d["note"] = r["note"]
    if r["blurb"]:
        d["blurb"] = r["blurb"]
    if r["lat"] is not None:
        d["lat"] = r["lat"]
        d["lng"] = r["lng"]
        d["placeId"] = r["place_id"]
    if r["photo"]:
        d["photo"] = r["photo"]
    if r["rating"] is not None:
        d["rating"] = r["rating"]
        d["reviews"] = r["reviews"] or 0
    if r["website"]:
        d["website"] = r["website"]
    if r["hours"]:
        try:
            d["hours"] = json.loads(r["hours"])
        except (ValueError, TypeError):
            pass
    return d


def write_data_file():
    con = db()
    rows = con.execute("SELECT * FROM restaurants ORDER BY city, name").fetchall()
    con.close()
    payload = {"updated": date.today().isoformat(), "restaurants": [row_public(r) for r in rows]}
    js = ("// AUTO-GENERIERT vom Admin-Backend (Export). Nicht von Hand editieren.\n"
          "window.RESTAURANT_DATA = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n")
    Path(DATA_PATH).parent.mkdir(parents=True, exist_ok=True)
    Path(DATA_PATH).write_text(js, encoding="utf-8")
    return len(rows)


init_db()
app = FastAPI(title="Restaurant-Übersicht Admin")


def check_auth(token):
    if ADMIN_TOKEN and token != ADMIN_TOKEN:
        raise HTTPException(401, "Token ungültig")


class NewRestaurant(BaseModel):
    name: str
    city: str
    note: Optional[str] = None


class SettingsIn(BaseModel):
    openai_key: Optional[str] = None
    maps_key: Optional[str] = None


class TestKey(BaseModel):
    openai_key: Optional[str] = None


@app.get("/api/restaurants")
def list_restaurants():
    con = db()
    rows = con.execute("SELECT * FROM restaurants ORDER BY city, name").fetchall()
    con.close()
    return [dict(id=r["id"], **row_public(r)) for r in rows]


@app.post("/api/restaurants")
def add_restaurant(item: NewRestaurant, x_admin_token: Optional[str] = Header(None)):
    check_auth(x_admin_token)
    name, city = item.name.strip(), item.city.strip()
    if not name or not city:
        raise HTTPException(400, "Name und Stadt erforderlich")
    note = (item.note or "").strip() or None
    base = build_data.derive_tags(name, note)

    cuisine = blurb = ""
    extra = []
    key = get_openai_key()
    if key:
        enr = enrich.call_openai({"name": name, "city": city}, key)
        if enr:
            cuisine = enr.get("cuisine") or ""
            blurb = enr.get("blurb") or ""
            extra = enr.get("extra_tags") or []

    tags = list(base)
    for t in extra + ([cuisine] if cuisine else []):
        t = (t or "").strip()
        if t and t not in tags:
            tags.append(t)
    tags = order_tags(tags)
    keepnote = note if (note and build_data.keep_note(note)) else None

    con = db()
    cur = con.execute(
        "INSERT INTO restaurants(name,city,tags,note,blurb,cuisine) VALUES(?,?,?,?,?,?)",
        (name, city, json.dumps(tags, ensure_ascii=False), keepnote, blurb or None, cuisine or None))
    con.commit()
    row = con.execute("SELECT * FROM restaurants WHERE id=?", (cur.lastrowid,)).fetchone()
    con.close()
    try:
        do_export()
    except Exception:
        pass
    return dict(id=row["id"], enriched=bool(key), **row_public(row))


@app.delete("/api/restaurants/{rid}")
def del_restaurant(rid: int, x_admin_token: Optional[str] = Header(None)):
    check_auth(x_admin_token)
    con = db()
    con.execute("DELETE FROM restaurants WHERE id=?", (rid,))
    con.commit()
    con.close()
    return {"deleted": rid}


@app.get("/api/status")
def status():
    con = db()
    total = con.execute("SELECT COUNT(*) AS n FROM restaurants").fetchone()["n"]
    enriched = con.execute(
        "SELECT COUNT(*) AS n FROM restaurants WHERE cuisine IS NOT NULL AND cuisine!=''").fetchone()["n"]
    geocoded = con.execute(
        "SELECT COUNT(*) AS n FROM restaurants WHERE lat IS NOT NULL").fetchone()["n"]
    con.close()
    return {"total": total, "enriched": enriched, "geocoded": geocoded}


@app.get("/api/settings")
def get_settings(x_admin_token: Optional[str] = Header(None)):
    check_auth(x_admin_token)
    ok, mk = get_openai_key(), get_maps_key()
    return {"openai": {"set": bool(ok), "hint": mask(ok)},
            "maps": {"set": bool(mk), "hint": mask(mk)}}


@app.post("/api/settings")
def save_settings(s: SettingsIn, x_admin_token: Optional[str] = Header(None)):
    check_auth(x_admin_token)
    if s.openai_key is not None:
        set_setting("openai_key", s.openai_key.strip())
    if s.maps_key is not None:
        set_setting("maps_key", s.maps_key.strip())
        write_config_file()  # Maps-Key sofort in config.js propagieren
    return {"saved": True}


@app.post("/api/test/openai")
def test_openai(body: Optional[TestKey] = None, x_admin_token: Optional[str] = Header(None)):
    check_auth(x_admin_token)
    key = (body.openai_key.strip() if (body and body.openai_key) else None) or get_openai_key()
    if not key:
        return {"ok": False, "error": "Kein OpenAI-Key gesetzt"}
    req = urllib.request.Request("https://api.openai.com/v1/models",
                                 headers={"Authorization": "Bearer " + key})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read().decode())
        return {"ok": True, "message": "OK – %d Modelle erreichbar" % len(data.get("data", []))}
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": "HTTP %d (Key ungültig/keine Berechtigung)" % e.code}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


def do_export():
    n = write_data_file()
    write_config_file()
    pushed, msg = False, "geschrieben"
    if os.environ.get("GIT_PUSH") == "1":
        try:
            subprocess.run(["git", "-C", str(BASE), "add", DATA_PATH, CONFIG_PATH, GEO_PATH],
                           check=True, capture_output=True)
            staged = subprocess.run(["git", "-C", str(BASE), "diff", "--cached", "--quiet"])
            if staged.returncode != 0:
                subprocess.run(["git", "-C", str(BASE), "commit", "-m", "data: Update via Admin-Backend"],
                               check=True, capture_output=True)
                subprocess.run(["git", "-C", str(BASE), "pull", "--rebase", "--autostash"],
                               check=True, capture_output=True,
                               env=dict(os.environ, GIT_COMMITTER_NAME="Admin Backend",
                                        GIT_COMMITTER_EMAIL="admin@local"))
                subprocess.run(["git", "-C", str(BASE), "push"], check=True, capture_output=True)
                pushed, msg = True, "geschrieben + gepusht"
            else:
                pushed, msg = True, "geschrieben (keine Änderung)"
        except subprocess.CalledProcessError as e:
            msg = "geschrieben; Push-Fehler: " + (e.stderr.decode().strip() if e.stderr else str(e))
    return n, pushed, msg


@app.post("/api/export")
def export(x_admin_token: Optional[str] = Header(None)):
    check_auth(x_admin_token)
    n, pushed, msg = do_export()
    return {"count": n, "pushed": pushed, "message": msg, "path": DATA_PATH}


@app.post("/api/enrich-all")
def enrich_all(limit: int = 5, x_admin_token: Optional[str] = Header(None)):
    """Reichert bis zu `limit` noch nicht angereicherte Einträge via OpenAI an.
    cuisine wird als Marker gesetzt (Sentinel '—' wenn leer), damit bereits
    verarbeitete Zeilen nicht erneut angefragt werden."""
    check_auth(x_admin_token)
    key = get_openai_key()
    if not key:
        return {"error": "Kein OpenAI-Key gesetzt", "enriched": 0, "remaining": 0}
    con = db()
    rows = con.execute(
        "SELECT * FROM restaurants WHERE cuisine IS NULL OR cuisine='' ORDER BY id LIMIT ?",
        (limit,)).fetchall()
    done = 0
    for r in rows:
        enr = enrich.call_openai({"name": r["name"], "city": r["city"]}, key, retries=0, timeout=25)
        if not enr:
            continue
        tags = json.loads(r["tags"] or "[]")
        for t in (enr.get("extra_tags") or []) + ([enr.get("cuisine")] if enr.get("cuisine") else []):
            t = (t or "").strip()
            if t and t not in tags:
                tags.append(t)
        con.execute(
            "UPDATE restaurants SET tags=?, blurb=?, cuisine=? WHERE id=?",
            (json.dumps(order_tags(tags), ensure_ascii=False),
             enr.get("blurb") or None, enr.get("cuisine") or "—", r["id"]))
        done += 1
    con.commit()
    remaining = con.execute(
        "SELECT COUNT(*) AS n FROM restaurants WHERE cuisine IS NULL OR cuisine=''").fetchone()["n"]
    con.close()
    out = {"enriched": done, "remaining": remaining}
    if done == 0 and rows:
        out["error"] = getattr(enrich, "LAST_ERROR", None) or "Anreicherung lieferte nichts"
    if remaining == 0:
        try:
            do_export()
        except Exception:
            pass
    return out


GEO_PATH = str(BASE / "geo.json")


def geocode_one(name, city, key, timeout=12):
    """Places API (New) Text Search -> (dict|None, error|None). (None,None)=nicht gefunden."""
    body = json.dumps({
        "textQuery": f"{name} {city} Deutschland",
        "languageCode": "de", "regionCode": "DE",
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://places.googleapis.com/v1/places:searchText",
        data=body, method="POST", headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": ("places.id,places.location,places.photos,"
                                 "places.rating,places.userRatingCount,places.websiteUri,"
                                 "places.regularOpeningHours"),
        })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            d = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            em = json.loads(e.read().decode("utf-8")).get("error", {}).get("message", "")
        except Exception:  # noqa: BLE001
            em = ""
        return None, (f"HTTP {e.code}: {em}").strip()[:200]
    except Exception as e:  # noqa: BLE001
        return None, str(e)
    places = d.get("places") or []
    if not places:
        return None, None
    p = places[0]
    loc = p.get("location") or {}
    if "latitude" not in loc:
        return None, None
    photos = p.get("photos") or []
    roh = p.get("regularOpeningHours") or {}
    hours = ""
    if roh:
        per = []
        for x in (roh.get("periods") or []):
            o, c = x.get("open") or {}, x.get("close") or {}
            per.append({"od": o.get("day"), "oh": o.get("hour", 0), "om": o.get("minute", 0),
                        "cd": c.get("day"), "ch": c.get("hour"), "cm": c.get("minute", 0)})
        hours = {"w": roh.get("weekdayDescriptions") or [], "p": per}
    return {
        "lat": loc["latitude"], "lng": loc["longitude"], "place_id": p.get("id"),
        "photo": photos[0]["name"] if photos else None,
        "rating": p.get("rating"), "reviews": p.get("userRatingCount"),
        "website": p.get("websiteUri"), "hours": hours,
    }, None


@app.post("/api/geocode-all")
def geocode_all(limit: int = 4, x_admin_token: Optional[str] = Header(None)):
    """Geocodiert fehlende Restaurants via Maps-Key (Places Text Search).
    Schreibt lat/lng/place_id in DB + geo.json. Nicht gefundene -> Marker '∅'."""
    check_auth(x_admin_token)
    key = get_maps_key()
    if not key:
        return {"error": "Kein Maps-Key gesetzt", "geocoded": 0, "remaining": 0}
    con = db()
    sel = ("(resolved IS NULL OR resolved=0 OR hours IS NULL) "
           "AND (place_id IS NULL OR place_id!='∅')")
    rows = con.execute(
        "SELECT * FROM restaurants WHERE " + sel + " ORDER BY id LIMIT ?", (limit,)).fetchall()
    try:
        with open(GEO_PATH, encoding="utf-8") as f:
            geo = json.load(f)
    except (FileNotFoundError, ValueError):
        geo = {}
    done, last_err = 0, None
    for r in rows:
        res, err = geocode_one(r["name"], r["city"], key)
        if err:
            last_err = err
            continue
        if res is None:  # nicht gefunden -> als erledigt markieren
            con.execute("UPDATE restaurants SET place_id=COALESCE(place_id,'∅'), resolved=1, hours='' WHERE id=?", (r["id"],))
            continue
        hrs = json.dumps(res["hours"], ensure_ascii=False) if res["hours"] else ""
        con.execute(
            "UPDATE restaurants SET lat=?, lng=?, place_id=?, photo=?, rating=?, reviews=?, website=?, hours=?, resolved=1 WHERE id=?",
            (res["lat"], res["lng"], res["place_id"], res["photo"], res["rating"],
             res["reviews"], res["website"], hrs, r["id"]))
        geo[r["name"] + "||" + r["city"]] = {
            "lat": res["lat"], "lng": res["lng"], "placeId": res["place_id"],
            "photo": res["photo"], "rating": res["rating"], "reviews": res["reviews"],
            "website": res["website"], "hours": res["hours"] or None}
        done += 1
    con.commit()
    try:
        with open(GEO_PATH, "w", encoding="utf-8") as f:
            json.dump(geo, f, ensure_ascii=False, indent=2)
    except OSError:
        pass
    remaining = con.execute("SELECT COUNT(*) AS n FROM restaurants WHERE " + sel).fetchone()["n"]
    con.close()
    out = {"geocoded": done, "remaining": remaining}
    if done == 0 and rows:
        out["error"] = last_err or "Keine Treffer"
    if remaining == 0:
        try:
            do_export()
        except Exception:
            pass
    return out


ADMIN_HTML = r"""<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Admin · Restaurant-Übersicht</title>
<style>
:root{--ac:#bf4128;--ink:#211a11;--mut:#82715c;--line:#e7dac6;--bg:#f6efe3;--card:#fffaf1}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--ink)}
.wrap{max-width:780px;margin:0 auto;padding:28px 20px 60px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:16px;margin:0 0 8px}p.sub{color:var(--mut);margin:0 0 22px}
.box{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:18px}
label{display:block;font-weight:700;font-size:13px;margin:10px 0 4px}
input{width:100%;padding:10px 12px;border:1px solid #d8c7ac;border-radius:9px;font:inherit;background:#fff}
.row{display:flex;gap:14px;flex-wrap:wrap}.row>div{flex:1;min-width:200px}
button{font:inherit;font-weight:700;border:none;border-radius:999px;padding:11px 18px;cursor:pointer}
.primary{background:var(--ac);color:#fff}.ghost{background:transparent;border:1px solid #d8c7ac;color:var(--ink)}
.bar{display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap}
.msg{font-size:13px;color:var(--mut);min-height:1.2em}
table{width:100%;border-collapse:collapse;font-size:14px}td{padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}
.tag{display:inline-block;background:#efe6d5;color:#5c4a30;border-radius:6px;padding:2px 7px;font-size:11px;font-weight:700;margin:1px}
.del{background:transparent;border:none;color:var(--mut);cursor:pointer;font-size:18px;padding:0 6px}
.del:hover{color:var(--ac)}.count{color:var(--mut);font-size:13px}
.hint{color:var(--mut);font-size:12px;margin:8px 0 0}
</style></head><body><div class="wrap">
<h1>Restaurant-Übersicht — Admin</h1>
<p class="sub">Schlüssel pflegen · Restaurants hinzufügen (+ Anreicherung) · Export → restaurants.js</p>
<div id="status" class="count" style="margin:0 0 18px;font-weight:700">Stand wird geladen…</div>

<div class="box">
  <label>Admin-Token (falls gesetzt)</label><input id="f-token" type="password" placeholder="leer lassen, wenn keiner">
</div>

<div class="box">
  <h2>Schlüssel</h2>
  <div class="row">
    <div>
      <label>OpenAI-Key <span class="count" id="s-openai"></span></label>
      <input id="f-openai" type="password" placeholder="sk-…">
      <div class="bar"><button class="ghost" id="t-openai" type="button">OpenAI testen</button><span class="msg" id="m-openai"></span></div>
    </div>
    <div>
      <label>Maps-JS-Key <span class="count" id="s-maps"></span></label>
      <input id="f-maps" type="password" placeholder="AIza…">
      <div class="bar"><button class="ghost" id="t-maps" type="button">Maps testen</button><span class="msg" id="m-maps"></span></div>
    </div>
  </div>
  <div class="bar"><button class="primary" id="save-keys" type="button">Schlüssel speichern</button><span class="msg" id="m-keys"></span></div>
  <p class="hint">OpenAI-Test läuft serverseitig (testet eingegebenen oder gespeicherten Key). Maps-Test lädt den eingegebenen Key im Browser — bei Referrer-Beschränkung kann er hier fehlschlagen, maßgeblich ist die Live-Domain.</p>
</div>

<div class="box">
  <h2>Restaurant hinzufügen</h2>
  <div class="row">
    <div><label>Name</label><input id="f-name" placeholder="z. B. Trattoria Neu"></div>
    <div><label>Stadt</label><input id="f-city" list="cities" placeholder="z. B. Bochum"><datalist id="cities"></datalist></div>
  </div>
  <label>Notiz (optional)</label><input id="f-note" placeholder="z. B. Trüffelpasta">
  <div class="bar"><button class="primary" id="add" type="button">Hinzufügen + anreichern</button><span class="msg" id="m-add"></span></div>
</div>

<div class="box">
  <div class="bar"><button class="ghost" id="enrich-all" type="button">Alle anreichern (GPT)</button><span class="msg" id="m-enrich"></span></div>
  <div class="bar"><button class="ghost" id="export" type="button">Exportieren → restaurants.js</button><span class="msg" id="m-exp"></span></div>
</div>

<div class="box">
  <div class="count" id="count"></div>
  <table><tbody id="list"></tbody></table>
</div>
</div><script>
const $=id=>document.getElementById(id);
const tok=()=>$("f-token").value.trim();
const hdr=()=>{const h={"Content-Type":"application/json"};if(tok())h["X-Admin-Token"]=tok();return h;};
function esc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}

async function load(){
  const r=await fetch("api/restaurants");const d=await r.json();
  $("count").textContent=d.length+" Restaurants";
  const cs=[...new Set(d.map(x=>x.city))].sort();
  $("cities").innerHTML=cs.map(c=>`<option value="${esc(c)}">`).join("");
  $("list").innerHTML=d.map(x=>`<tr><td><b>${esc(x.name)}</b><br><span class="count">${esc(x.city)}</span>${x.blurb?'<br><span class="count">'+esc(x.blurb)+'</span>':''}</td><td>${(x.tags||[]).map(t=>'<span class="tag">'+esc(t)+'</span>').join("")}</td><td style="text-align:right"><button class="del" data-id="${x.id}" title="Löschen">×</button></td></tr>`).join("");
  document.querySelectorAll(".del").forEach(b=>b.onclick=()=>del(b.dataset.id));
  refreshStatus();
}
async function refreshStatus(){
  try{const r=await fetch("api/status");const d=await r.json();
    $("status").textContent="Stand: "+d.total+" Restaurants · angereichert "+d.enriched+"/"+d.total+" · Koordinaten "+d.geocoded+"/"+d.total;}
  catch(e){}
}
async function loadSettings(){
  const r=await fetch("api/settings",{headers:hdr()});if(!r.ok)return;const d=await r.json();
  $("s-openai").textContent=d.openai.set?("gesetzt "+d.openai.hint):"nicht gesetzt";
  $("s-maps").textContent=d.maps.set?("gesetzt "+d.maps.hint):"nicht gesetzt";
}
$("save-keys").onclick=async()=>{
  const body={};const o=$("f-openai").value.trim(),m=$("f-maps").value.trim();
  if(o)body.openai_key=o;if(m)body.maps_key=m;
  if(!Object.keys(body).length){$("m-keys").textContent="Nichts eingegeben.";return;}
  $("m-keys").textContent="…";
  const r=await fetch("api/settings",{method:"POST",headers:hdr(),body:JSON.stringify(body)});
  $("m-keys").textContent=r.ok?"gespeichert":("Fehler "+r.status);
  $("f-openai").value="";$("f-maps").value="";loadSettings();
};
$("t-openai").onclick=async()=>{
  $("m-openai").textContent="…";
  const o=$("f-openai").value.trim();
  const r=await fetch("api/test/openai",{method:"POST",headers:hdr(),body:JSON.stringify(o?{openai_key:o}:{})});
  const d=await r.json();
  $("m-openai").textContent=d.ok?("✓ "+(d.message||"OK")):("✗ "+(d.error||"Fehler"));
};
let mapsTried=false;
$("t-maps").onclick=()=>{
  const key=$("f-maps").value.trim();
  if(!key){$("m-maps").textContent="Key ins Feld eingeben zum Testen.";return;}
  if(mapsTried){$("m-maps").textContent="Seite neu laden, um erneut zu testen.";return;}
  mapsTried=true;$("m-maps").textContent="…";
  window.gm_authFailure=()=>{$("m-maps").textContent="✗ Auth-Fehler (Key / Restriction / Billing)";};
  window.__mapsOk=()=>{$("m-maps").textContent="✓ Maps geladen";};
  const s=document.createElement("script");
  s.onerror=()=>{$("m-maps").textContent="✗ Script konnte nicht geladen werden";};
  s.src="https://maps.googleapis.com/maps/api/js?key="+encodeURIComponent(key)+"&callback=__mapsOk&loading=async";
  document.head.appendChild(s);
};
$("add").onclick=async()=>{
  const name=$("f-name").value.trim(),city=$("f-city").value.trim();
  if(!name||!city){$("m-add").textContent="Name und Stadt nötig.";return;}
  $("m-add").textContent="…";$("add").disabled=true;
  try{
    const r=await fetch("api/restaurants",{method:"POST",headers:hdr(),body:JSON.stringify({name,city,note:$("f-note").value.trim()})});
    const d=await r.json();
    if(!r.ok){$("m-add").textContent="Fehler: "+(d.detail||r.status);}
    else{$("m-add").textContent="Hinzugefügt"+(d.enriched?" + angereichert":"")+": "+(d.tags||[]).join(", ");$("f-name").value="";$("f-note").value="";load();}
  }catch(e){$("m-add").textContent="Fehler: "+e;}
  $("add").disabled=false;
};
$("export").onclick=async()=>{
  $("m-exp").textContent="…";
  try{const r=await fetch("api/export",{method:"POST",headers:hdr()});const d=await r.json();
    $("m-exp").textContent=r.ok?(d.message+" ("+d.count+" Einträge)"):("Fehler: "+(d.detail||r.status));}
  catch(e){$("m-exp").textContent="Fehler: "+e;}
};
$("enrich-all").onclick=async()=>{
  if(!confirm("Alle noch nicht angereicherten Restaurants via OpenAI anreichern? (kostet API-Aufrufe)"))return;
  let total=0;$("enrich-all").disabled=true;$("m-enrich").textContent="…";
  for(let i=0;i<40;i++){
    let r,d;
    try{r=await fetch("api/enrich-all?limit=15",{method:"POST",headers:hdr()});d=await r.json();}
    catch(e){$("m-enrich").textContent="Fehler: "+e;break;}
    if(!r.ok){$("m-enrich").textContent="Fehler: "+(d.detail||r.status);break;}
    if(d.error){$("m-enrich").textContent=d.error;break;}
    total+=d.enriched;
    $("m-enrich").textContent="angereichert: "+total+", verbleibend: "+d.remaining;
    refreshStatus();
    if(d.remaining===0){$("m-enrich").textContent="fertig: "+total+" angereichert — jetzt „Exportieren".";break;}
    if(d.enriched===0){$("m-enrich").textContent+=" (gestoppt — Anreicherung lieferte nichts; OpenAI/Netz prüfen)";break;}
  }
  $("enrich-all").disabled=false;load();
};
async function del(id){if(!confirm("Löschen?"))return;await fetch("api/restaurants/"+id,{method:"DELETE",headers:hdr()});load();}
load();loadSettings();
</script></body></html>"""


@app.get("/", response_class=HTMLResponse)
def admin():
    return ADMIN_HTML
