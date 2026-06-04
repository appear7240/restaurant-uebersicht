/* Restaurant-Übersicht – Filter, Suche, Rendering. Keine Abhängigkeiten. */
(function () {
  "use strict";

  var DATA = (window.RESTAURANT_DATA || { restaurants: [], updated: "" });
  var ALL = DATA.restaurants.slice();

  var TAG_ORDER = [
    "Trüffelpasta", "Trüffelpizza", "Trüffel", "Italienisch", "Sushi",
    "Poké", "Ramen", "Indisch", "Burger", "Frühstück", "Café", "Eis",
    "Bar", "Shisha", "Käsefondue"
  ];

  // diakritik-unempfindliche Faltung für die Suche
  function fold(s) {
    return (s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ß/g, "ss");
  }

  // Suchindex vorberechnen
  ALL.forEach(function (r) {
    r._s = fold([r.name, r.city, (r.tags || []).join(" "), r.note || ""].join(" "));
  });

  // Zählungen
  var catCount = {};
  var cityCount = {};
  ALL.forEach(function (r) {
    cityCount[r.city] = (cityCount[r.city] || 0) + 1;
    (r.tags || []).forEach(function (t) { catCount[t] = (catCount[t] || 0) + 1; });
  });

  var cities = Object.keys(cityCount).sort(function (a, b) {
    if (cityCount[b] !== cityCount[a]) return cityCount[b] - cityCount[a];
    return a.localeCompare(b, "de");
  });
  var presentTags = TAG_ORDER.filter(function (t) { return catCount[t]; });

  // State
  var state = { q: "", cats: new Set(), city: "" };

  // DOM
  var $ = function (id) { return document.getElementById(id); };
  var elResults = $("results");
  var elEmpty = $("empty");
  var elFoot = $("foot-count");
  var elQ = $("q");
  var elCity = $("city");
  var elChips = $("cat-chips");

  // Meta (Datensatz-Gesamtwerte)
  $("m-total").textContent = String(ALL.length);
  $("m-cities").textContent = String(cities.length);
  var upd = DATA.updated || "";
  if (upd) {
    var p = upd.split("-");
    $("m-updated").textContent = p.length === 3 ? p[2] + "." + p[1] + "." + p[0] : upd;
  }

  // Stadt-Select
  function opt(value, label) { var o = document.createElement("option"); o.value = value; o.textContent = label; return o; }
  elCity.appendChild(opt("", "Alle Städte (" + ALL.length + ")"));
  cities.forEach(function (c) { elCity.appendChild(opt(c, c + " (" + cityCount[c] + ")")); });

  // Kategorie-Chips
  function makeChip(opts) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (opts.reset ? " reset" : "");
    if (opts.tag) b.dataset.tag = opts.tag;
    if (opts.dot) {
      var d = document.createElement("span"); d.className = "dot"; b.appendChild(d);
    }
    var lab = document.createElement("span"); lab.textContent = opts.label; b.appendChild(lab);
    if (opts.n != null) { var n = document.createElement("span"); n.className = "n"; n.textContent = opts.n; b.appendChild(n); }
    b.addEventListener("click", opts.onClick);
    return b;
  }

  var resetChip = makeChip({ label: "Alle", n: ALL.length, reset: true, onClick: function () { state.cats.clear(); syncChips(); render(); } });
  elChips.appendChild(resetChip);

  var tagChips = {};
  presentTags.forEach(function (t) {
    var c = makeChip({
      label: t, n: catCount[t], tag: t, dot: true,
      onClick: function () {
        if (state.cats.has(t)) state.cats.delete(t); else state.cats.add(t);
        syncChips(); render();
      }
    });
    tagChips[t] = c;
    elChips.appendChild(c);
  });

  function syncChips() {
    resetChip.classList.toggle("on", state.cats.size === 0);
    presentTags.forEach(function (t) { tagChips[t].classList.toggle("on", state.cats.has(t)); });
  }
  syncChips();

  // Tag-Element für Karte (DOM, kein innerHTML)
  function tagEl(t) {
    var s = document.createElement("span");
    s.className = "tag";
    s.dataset.tag = t;
    s.textContent = t;
    return s;
  }

  function cardEl(r, i) {
    var card = document.createElement("article");
    card.className = "card" + ((r.tags && r.tags.length) ? "" : " untagged");
    card.style.setProperty("--i", String(Math.min(i, 14)));

    var nm = document.createElement("div");
    nm.className = "name";
    nm.textContent = r.name;
    card.appendChild(nm);

    if (r.note) {
      var nt = document.createElement("div");
      nt.className = "note";
      nt.textContent = r.note;
      card.appendChild(nt);
    }
    if (r.tags && r.tags.length) {
      var tw = document.createElement("div");
      tw.className = "tags";
      r.tags.forEach(function (t) { tw.appendChild(tagEl(t)); });
      card.appendChild(tw);
    }
    return card;
  }

  function matches(r) {
    if (state.city && r.city !== state.city) return false;
    if (state.cats.size) {
      var hit = (r.tags || []).some(function (t) { return state.cats.has(t); });
      if (!hit) return false;
    }
    if (state.q && r._s.indexOf(state.q) === -1) return false;
    return true;
  }

  function render() {
    var list = ALL.filter(matches);

    // gruppieren nach Stadt in city-Reihenfolge
    var byCity = {};
    list.forEach(function (r) { (byCity[r.city] = byCity[r.city] || []).push(r); });

    var frag = document.createDocumentFragment();
    var shownCities = 0;
    var globalIdx = 0;

    cities.forEach(function (c) {
      var arr = byCity[c];
      if (!arr || !arr.length) return;
      shownCities++;
      arr.sort(function (a, b) { return a.name.localeCompare(b.name, "de"); });

      var sec = document.createElement("section");
      sec.className = "city";

      var head = document.createElement("div");
      head.className = "city-head";
      var h2 = document.createElement("h2"); h2.textContent = c;
      var rule = document.createElement("span"); rule.className = "rule";
      var cnt = document.createElement("span"); cnt.className = "count";
      cnt.textContent = arr.length + (arr.length === 1 ? " Adresse" : " Adressen");
      head.appendChild(h2); head.appendChild(rule); head.appendChild(cnt);
      sec.appendChild(head);

      var grid = document.createElement("div");
      grid.className = "grid";
      arr.forEach(function (r) { grid.appendChild(cardEl(r, globalIdx++)); });
      sec.appendChild(grid);
      frag.appendChild(sec);
    });

    elResults.replaceChildren(frag);

    var none = list.length === 0;
    elEmpty.hidden = !none;
    elResults.style.display = none ? "none" : "";

    if (none) {
      elFoot.textContent = "0 von " + ALL.length + " angezeigt";
    } else {
      elFoot.textContent = list.length + " von " + ALL.length +
        " angezeigt · " + shownCities + (shownCities === 1 ? " Stadt" : " Städte");
    }
  }

  // Events
  var t;
  elQ.addEventListener("input", function () {
    clearTimeout(t);
    t = setTimeout(function () { state.q = fold(elQ.value.trim()); render(); }, 110);
  });
  elCity.addEventListener("change", function () { state.city = elCity.value; render(); });
  $("reset-empty").addEventListener("click", function () {
    state.q = ""; state.cats.clear(); state.city = "";
    elQ.value = ""; elCity.value = ""; syncChips(); render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $("totop").addEventListener("click", function () { window.scrollTo({ top: 0, behavior: "smooth" }); });

  render();
})();
