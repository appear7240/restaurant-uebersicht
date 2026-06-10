(function () {
  "use strict";
  // Theme von der Hauptseite übernehmen
  try {
    var t = localStorage.getItem("rue-theme");
    if (t) document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}

  var $ = function (id) { return document.getElementById(id); };
  var API = "/admin/api/";

  function msg(el, text, ok) {
    el.textContent = text || "";
    el.className = "kmsg " + (ok === true ? "ok" : ok === false ? "err" : "");
  }
  async function api(path, opts) {
    var r = await fetch(API + path, opts || {});
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  async function loadStatus() {
    try {
      var d = await api("status");
      $("s-total").textContent = d.total;
      $("s-enr").textContent = d.enriched;
      $("s-geo").textContent = d.geocoded;
    } catch (e) { $("offline").style.display = "block"; }
  }
  async function loadKeys() {
    try {
      var d = await api("settings");
      var parts = [];
      parts.push("OpenAI: " + (d.openai.set ? d.openai.hint : "nicht gesetzt"));
      parts.push("Maps: " + (d.maps.set ? d.maps.hint : "nicht gesetzt"));
      $("k-hint").textContent = parts.join("  ·  ");
    } catch (e) {}
  }

  $("b-save").addEventListener("click", async function () {
    var body = {};
    var o = $("k-openai").value.trim(), m = $("k-maps").value.trim();
    if (o) body.openai_key = o;
    if (m) body.maps_key = m;
    if (!o && !m) { msg($("m-keys"), "Nichts geändert.", false); return; }
    msg($("m-keys"), "Speichere…");
    try {
      await api("settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      $("k-openai").value = ""; $("k-maps").value = "";
      msg($("m-keys"), "Gespeichert.", true);
      loadKeys();
    } catch (e) { msg($("m-keys"), "Fehler: " + e.message, false); }
  });

  $("b-test-openai").addEventListener("click", async function () {
    var o = $("k-openai").value.trim();
    msg($("m-keys"), "Teste OpenAI…");
    try {
      var d = await api("test/openai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o ? { openai_key: o } : {}) });
      msg($("m-keys"), d.ok ? d.message : d.error, !!d.ok);
    } catch (e) { msg($("m-keys"), "Fehler: " + e.message, false); }
  });

  $("b-enrich").addEventListener("click", async function () {
    var btn = this; btn.disabled = true;
    var total = 0;
    try {
      while (true) {
        msg($("m-enrich"), "Reichere an… (" + total + ")");
        var d = await api("enrich-all?limit=2", { method: "POST" });
        if (d.error) { msg($("m-enrich"), d.error, false); break; }
        total += d.enriched || 0;
        if (!d.enriched || d.remaining === 0) {
          msg($("m-enrich"), "Fertig: " + total + " angereichert, " + (d.remaining || 0) + " offen.", true);
          break;
        }
      }
    } catch (e) { msg($("m-enrich"), "Fehler: " + e.message, false); }
    btn.disabled = false; loadStatus();
  });

  $("b-geocode").addEventListener("click", async function () {
    var btn = this; btn.disabled = true;
    var total = 0, prev = null;
    try {
      while (true) {
        msg($("m-geocode"), "Geocodiere… (" + total + ")");
        var d = await api("geocode-all?limit=8", { method: "POST" });
        total += d.geocoded || 0;
        if (d.remaining === 0) {
          msg($("m-geocode"), "Fertig: " + total + " verarbeitet, 0 offen.", true);
          break;
        }
        // kein Fortschritt (alle Restzeilen fehlerhaft/unauffindbar) -> Abbruch
        if (prev !== null && d.remaining >= prev) {
          msg($("m-geocode"), "Gestoppt: " + total + " verarbeitet, " + d.remaining +
              " offen" + (d.error ? " (" + d.error + ")" : "") + ".", false);
          break;
        }
        prev = d.remaining;
      }
    } catch (e) { msg($("m-geocode"), "Fehler: " + e.message, false); }
    btn.disabled = false; loadStatus();
  });

  $("b-export").addEventListener("click", async function () {
    var btn = this; btn.disabled = true;
    msg($("m-export"), "Exportiere…");
    try {
      var d = await api("export", { method: "POST" });
      msg($("m-export"), d.count + " Einträge " + d.message + ".", true);
    } catch (e) { msg($("m-export"), "Fehler: " + e.message, false); }
    btn.disabled = false;
  });

  // ── Tags bearbeiten ───────────────────────────────
  var RS = [], curTags = [];
  function renderTagChips() {
    var box = $("t-tags"); box.replaceChildren();
    curTags.forEach(function (t, i) {
      var chip = document.createElement("span"); chip.className = "t-chip";
      var lab = document.createElement("span"); lab.textContent = t; chip.appendChild(lab);
      var x = document.createElement("button"); x.type = "button"; x.textContent = "\u00d7";
      x.setAttribute("aria-label", "Entfernen: " + t);
      x.addEventListener("click", function () { curTags.splice(i, 1); renderTagChips(); });
      chip.appendChild(x); box.appendChild(chip);
    });
  }
  function addTag() {
    var inp = $("t-add"), v = (inp.value || "").trim();
    if (v && curTags.indexOf(v) === -1) { curTags.push(v); renderTagChips(); }
    inp.value = ""; inp.focus();
  }
  async function loadTagEditor() {
    try { RS = await api("restaurants"); } catch (e) { return; }
    var sel = $("t-sel");
    RS.slice().sort(function (a, b) { return (a.city + a.name).localeCompare(b.city + b.name, "de"); })
      .forEach(function (r) {
        var o = document.createElement("option");
        o.value = String(r.id); o.textContent = r.name + " (" + r.city + ")"; sel.appendChild(o);
      });
    var all = {}; RS.forEach(function (r) { (r.tags || []).forEach(function (t) { all[t] = 1; }); });
    var dl = $("t-alltags");
    Object.keys(all).sort(function (a, b) { return a.localeCompare(b, "de"); })
      .forEach(function (t) { var o = document.createElement("option"); o.value = t; dl.appendChild(o); });
  }
  $("t-sel").addEventListener("change", function () {
    var v = this.value, r = RS.find(function (x) { return String(x.id) === v; });
    curTags = r ? (r.tags || []).slice() : []; renderTagChips(); msg($("m-tags"), "");
  });
  $("t-add-btn").addEventListener("click", addTag);
  $("t-add").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addTag(); } });
  $("t-save").addEventListener("click", async function () {
    var id = $("t-sel").value;
    if (!id) { msg($("m-tags"), "Erst ein Restaurant wählen.", false); return; }
    var btn = this; btn.disabled = true; msg($("m-tags"), "Speichere…");
    try {
      var d = await api("restaurants/" + id + "/tags",
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tags: curTags }) });
      curTags = d.tags || curTags; renderTagChips();
      var r = RS.find(function (x) { return String(x.id) === id; }); if (r) r.tags = d.tags;
      msg($("m-tags"), "Gespeichert (" + d.tags.length + " Tags) + exportiert.", true);
    } catch (e) { msg($("m-tags"), "Fehler: " + e.message, false); }
    btn.disabled = false;
  });

  loadStatus();
  loadKeys();
  loadTagEditor();
})();
