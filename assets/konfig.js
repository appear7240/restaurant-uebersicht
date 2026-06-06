(function () {
  "use strict";
  // Theme von der Hauptseite übernehmen
  try {
    var t = localStorage.getItem("rue-theme");
    if (t) document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}

  var $ = function (id) { return document.getElementById(id); };
  var API = "/api/";

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
        var d = await api("enrich-all?limit=15", { method: "POST" });
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

  $("b-export").addEventListener("click", async function () {
    var btn = this; btn.disabled = true;
    msg($("m-export"), "Exportiere…");
    try {
      var d = await api("export", { method: "POST" });
      msg($("m-export"), d.count + " Einträge " + d.message + ".", true);
    } catch (e) { msg($("m-export"), "Fehler: " + e.message, false); }
    btn.disabled = false;
  });

  loadStatus();
  loadKeys();
})();
