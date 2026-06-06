#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Admin-Backend (Option A) – Pflege-Tool, Seite bleibt statisch.

Speichert Restaurants in SQLite, reichert neue Einträge via OpenAI an
(optional, nur wenn OPENAI_API_KEY gesetzt) und EXPORTIERT den Datensatz
nach data/restaurants.js (optional mit git push). Die statische Seite liest
weiterhin nur diese Datei – kein öffentliches API nötig.

Start:
    pip install -r backend/requirements.txt --break-system-packages
    OPENAI_API_KEY=sk-... uvicorn app:app --host 0.0.0.0 --port 8080   # aus backend/
Env:
    OPENAI_API_KEY  optionale GPT-Anreicherung beim Hinzufügen
    OPENAI_MODEL    Default gpt-4o-mini
    ADMIN_TOKEN     wenn gesetzt: X-Admin-Token-Header für Schreibrouten nötig
    GIT_PUSH=1      beim Export zusätzlich git add/commit/push
    RUE_DB          DB-Pfad (Default backend/restaurants.db)
    RUE_DATA        Ziel der Exportdatei (Default data/restaurants.js)
"""
import json
import os
import sqlite3
import subprocess
import sys
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
    con.commit()
    if con.execute("SELECT COUNT(*) AS n FROM restaurants").fetchone()["n"] == 0:
        for r in build_data.parse_records():
            con.execute(
                "INSERT INTO restaurants(name,city,tags,note) VALUES(?,?,?,?)",
                (r["name"], r["city"], json.dumps(r["tags"], ensure_ascii=False), r.get("note")),
            )
        con.commit()
    con.close()


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
    return d


def write_data_file():
    con = db()
    rows = con.execute("SELECT * FROM restaurants ORDER BY city, name").fetchall()
    con.close()
    payload = {"updated": date.today().isoformat(), "restaurants": [row_public(r) for r in rows]}
    js = (
        "// AUTO-GENERIERT vom Admin-Backend (Export). Nicht von Hand editieren.\n"
        "window.RESTAURANT_DATA = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n"
    )
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
    key = os.environ.get("OPENAI_API_KEY")
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
        (name, city, json.dumps(tags, ensure_ascii=False), keepnote, blurb or None, cuisine or None),
    )
    con.commit()
    row = con.execute("SELECT * FROM restaurants WHERE id=?", (cur.lastrowid,)).fetchone()
    con.close()
    return dict(id=row["id"], enriched=bool(key), **row_public(row))


@app.delete("/api/restaurants/{rid}")
def del_restaurant(rid: int, x_admin_token: Optional[str] = Header(None)):
    check_auth(x_admin_token)
    con = db()
    con.execute("DELETE FROM restaurants WHERE id=?", (rid,))
    con.commit()
    con.close()
    return {"deleted": rid}


@app.post("/api/export")
def export(x_admin_token: Optional[str] = Header(None)):
    check_auth(x_admin_token)
    n = write_data_file()
    pushed, msg = False, "geschrieben"
    if os.environ.get("GIT_PUSH") == "1":
        try:
            for cmd in (["add", DATA_PATH],
                        ["commit", "-m", "data: Update via Admin-Backend"],
                        ["push"]):
                subprocess.run(["git", "-C", str(BASE)] + cmd, check=True, capture_output=True)
            pushed, msg = True, "geschrieben + gepusht"
        except subprocess.CalledProcessError as e:
            msg = "geschrieben; Push-Fehler: " + (e.stderr.decode().strip() if e.stderr else str(e))
    return {"count": n, "pushed": pushed, "message": msg, "path": DATA_PATH}


ADMIN_HTML = """<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Admin · Restaurant-Übersicht</title>
<style>
:root{--ac:#bf4128;--ink:#211a11;--mut:#82715c;--line:#e7dac6;--bg:#f6efe3;--card:#fffaf1}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--ink)}
.wrap{max-width:760px;margin:0 auto;padding:28px 20px 60px}
h1{font-size:26px;margin:0 0 4px}p.sub{color:var(--mut);margin:0 0 22px}
.box{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:18px}
label{display:block;font-weight:700;font-size:13px;margin:10px 0 4px}
input{width:100%;padding:10px 12px;border:1px solid #d8c7ac;border-radius:9px;font:inherit;background:#fff}
.row{display:flex;gap:10px;flex-wrap:wrap}.row>div{flex:1;min-width:160px}
button{font:inherit;font-weight:700;border:none;border-radius:999px;padding:11px 18px;cursor:pointer}
.primary{background:var(--ac);color:#fff}.ghost{background:transparent;border:1px solid #d8c7ac;color:var(--ink)}
.bar{display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap}
.msg{font-size:13px;color:var(--mut);min-height:1.2em}
table{width:100%;border-collapse:collapse;font-size:14px}td{padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}
.tag{display:inline-block;background:#efe6d5;color:#5c4a30;border-radius:6px;padding:2px 7px;font-size:11px;font-weight:700;margin:1px}
.del{background:transparent;border:none;color:var(--mut);cursor:pointer;font-size:18px;padding:0 6px}
.del:hover{color:var(--ac)}.count{color:var(--mut);font-size:13px}
</style></head><body><div class="wrap">
<h1>Restaurant-Übersicht — Admin</h1>
<p class="sub">Hinzufügen + GPT-Anreicherung. Danach „Exportieren" schreibt data/restaurants.js.</p>

<div class="box">
  <div class="row">
    <div><label>Name</label><input id="f-name" placeholder="z. B. Trattoria Neu"></div>
    <div><label>Stadt</label><input id="f-city" list="cities" placeholder="z. B. Bochum"><datalist id="cities"></datalist></div>
  </div>
  <label>Notiz (optional)</label><input id="f-note" placeholder="z. B. Trüffelpasta">
  <label>Admin-Token (falls gesetzt)</label><input id="f-token" type="password" placeholder="leer lassen, wenn keiner">
  <div class="bar"><button class="primary" id="add">Hinzufügen + anreichern</button><span class="msg" id="m-add"></span></div>
</div>

<div class="box">
  <div class="bar"><button class="ghost" id="export">Exportieren → restaurants.js</button><span class="msg" id="m-exp"></span></div>
</div>

<div class="box">
  <div class="count" id="count"></div>
  <table><tbody id="list"></tbody></table>
</div>
</div><script>
const $=id=>document.getElementById(id);
const tok=()=>$("f-token").value.trim();
const hdr=()=>{const h={"Content-Type":"application/json"};if(tok())h["X-Admin-Token"]=tok();return h;};
async function load(){
  const r=await fetch("api/restaurants");const d=await r.json();
  $("count").textContent=d.length+" Restaurants";
  const cs=[...new Set(d.map(x=>x.city))].sort();
  $("cities").innerHTML=cs.map(c=>`<option value="${c}">`).join("");
  $("list").innerHTML=d.map(x=>`<tr><td><b>${esc(x.name)}</b><br><span class="count">${esc(x.city)}</span>${x.blurb?'<br><span class="count">'+esc(x.blurb)+'</span>':''}</td><td>${(x.tags||[]).map(t=>'<span class="tag">'+esc(t)+'</span>').join("")}</td><td style="text-align:right"><button class="del" data-id="${x.id}" title="Löschen">×</button></td></tr>`).join("");
  document.querySelectorAll(".del").forEach(b=>b.onclick=()=>del(b.dataset.id));
}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
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
$("del-x");async function del(id){if(!confirm("Löschen?"))return;await fetch("api/restaurants/"+id,{method:"DELETE",headers:hdr()});load();}
load();
</script></body></html>"""


@app.get("/", response_class=HTMLResponse)
def admin():
    return ADMIN_HTML
