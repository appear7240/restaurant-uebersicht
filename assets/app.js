/* Restaurant-Übersicht – Filter, Suche, Roulette, Theme, URL-State.
   Keine Abhängigkeiten. */
(function () {
  "use strict";

  var DATA = (window.RESTAURANT_DATA || { restaurants: [], updated: "" });
  var ALL = DATA.restaurants.slice();

  var TAG_ORDER = [
    "Trüffelpasta", "Trüffelpizza", "Trüffel", "Italienisch", "Sushi",
    "Poké", "Ramen", "Indisch", "Burger", "Frühstück", "Café", "Eis",
    "Bar", "Shisha", "Käsefondue"
  ];

  var reduceMotion = !!(window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // diakritik-unempfindliche Faltung für die Suche
  function fold(s) {
    return (s || "").toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss");
  }

  // Index + Suchstring vorberechnen
  ALL.forEach(function (r, i) {
    r._i = i;
    r._s = fold([r.name, r.city, (r.tags || []).join(" "), r.note || ""].join(" "));
  });

  // Zählungen
  var catCount = {}, cityCount = {};
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
  var state = { q: "", qRaw: "", cats: new Set(), city: "" };

  var $ = function (id) { return document.getElementById(id); };
  var elResults = $("results"), elEmpty = $("empty"), elFoot = $("foot-count");
  var elQ = $("q"), elCity = $("city"), elChips = $("cat-chips");

  // ── Theme ──────────────────────────────────────────
  var ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8Z"/></svg>';
  var ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.4M12 19.6V22M22 12h-2.4M4.4 12H2M19 5l-1.7 1.7M6.7 17.3 5 19M19 19l-1.7-1.7M6.7 6.7 5 5"/></svg>';
  var elTheme = $("theme");
  function setTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    document.documentElement.style.colorScheme = t;
    try { localStorage.setItem("rue-theme", t); } catch (e) {}
    elTheme.innerHTML = t === "dark" ? ICON_SUN : ICON_MOON;
    elTheme.setAttribute("aria-pressed", t === "dark" ? "true" : "false");
  }
  (function initTheme() {
    var stored = null;
    try { stored = localStorage.getItem("rue-theme"); } catch (e) {}
    var prefersDark = window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(stored || (prefersDark ? "dark" : "light"));
  })();
  elTheme.addEventListener("click", function () {
    setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
  });

  // ── Meta ───────────────────────────────────────────
  $("m-total").textContent = String(ALL.length);
  $("m-cities").textContent = String(cities.length);
  var upd = DATA.updated || "";
  if (upd) {
    var pp = upd.split("-");
    $("m-updated").textContent = pp.length === 3 ? pp[2] + "." + pp[1] + "." + pp[0] : upd;
  }

  // ── Stadt-Select ───────────────────────────────────
  function opt(v, l) { var o = document.createElement("option"); o.value = v; o.textContent = l; return o; }
  elCity.appendChild(opt("", "Alle Städte (" + ALL.length + ")"));
  cities.forEach(function (c) { elCity.appendChild(opt(c, c + " (" + cityCount[c] + ")")); });

  // ── Kategorie-Chips ────────────────────────────────
  function makeChip(o) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "chip" + (o.reset ? " reset" : "");
    if (o.tag) b.dataset.tag = o.tag;
    if (o.dot) { var d = document.createElement("span"); d.className = "dot"; b.appendChild(d); }
    var lab = document.createElement("span"); lab.textContent = o.label; b.appendChild(lab);
    if (o.n != null) { var n = document.createElement("span"); n.className = "n"; n.textContent = o.n; b.appendChild(n); }
    b.addEventListener("click", o.onClick);
    return b;
  }
  var resetChip = makeChip({ label: "Alle", n: ALL.length, reset: true,
    onClick: function () { state.cats.clear(); syncChips(); render(); } });
  elChips.appendChild(resetChip);
  var tagChips = {};
  presentTags.forEach(function (t) {
    var c = makeChip({ label: t, n: catCount[t], tag: t, dot: true,
      onClick: function () {
        if (state.cats.has(t)) state.cats.delete(t); else state.cats.add(t);
        syncChips(); render();
      } });
    tagChips[t] = c; elChips.appendChild(c);
  });
  function syncChips() {
    resetChip.classList.toggle("on", state.cats.size === 0);
    presentTags.forEach(function (t) { tagChips[t].classList.toggle("on", state.cats.has(t)); });
  }

  // ── Tag- & Karten-Elemente ─────────────────────────
  function tagEl(t) {
    var s = document.createElement("span");
    s.className = "tag"; s.dataset.tag = t; s.textContent = t; return s;
  }
  var PIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10Z"/><circle cx="12" cy="11" r="2"/></svg>';

  function cardEl(r, i) {
    var card = document.createElement("article");
    card.className = "card" + ((r.tags && r.tags.length) ? "" : " untagged");
    card.dataset.key = String(r._i);
    card.style.setProperty("--i", String(Math.min(i, 14)));
    var nm = document.createElement("div"); nm.className = "name"; nm.textContent = r.name; card.appendChild(nm);
    if (r.note) { var nt = document.createElement("div"); nt.className = "note"; nt.textContent = r.note; card.appendChild(nt); }
    if (r.tags && r.tags.length) {
      var tw = document.createElement("div"); tw.className = "tags";
      r.tags.forEach(function (t) { tw.appendChild(tagEl(t)); });
      card.appendChild(tw);
    }
    var foot = document.createElement("div"); foot.className = "card-foot";
    var mb = document.createElement("button");
    mb.type = "button"; mb.className = "card-map";
    mb.setAttribute("aria-label", "Karte: " + r.name);
    mb.innerHTML = PIN_SVG + "<span>Karte</span>";
    mb.addEventListener("click", function () { openMap(r); });
    foot.appendChild(mb); card.appendChild(foot);
    return card;
  }

  function matches(r) {
    if (state.city && r.city !== state.city) return false;
    if (state.cats.size && !(r.tags || []).some(function (t) { return state.cats.has(t); })) return false;
    if (state.q && r._s.indexOf(state.q) === -1) return false;
    return true;
  }

  // ── URL-State (teilbare Filter) ────────────────────
  function parseHash() {
    var h = location.hash.replace(/^#/, ""), o = {};
    h.split("&").forEach(function (p) {
      if (!p) return;
      var i = p.indexOf("="); if (i < 0) return;
      o[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1));
    });
    return o;
  }
  function applyHash() {
    var o = parseHash();
    if (o.q) { state.qRaw = o.q; state.q = fold(o.q); elQ.value = o.q; }
    if (o.cat) o.cat.split(",").forEach(function (t) { if (catCount[t]) state.cats.add(t); });
    if (o.city && cityCount[o.city]) { state.city = o.city; elCity.value = o.city; }
  }
  function writeHash() {
    var parts = [];
    if (state.qRaw) parts.push("q=" + encodeURIComponent(state.qRaw));
    if (state.cats.size) parts.push("cat=" + encodeURIComponent(Array.from(state.cats).join(",")));
    if (state.city) parts.push("city=" + encodeURIComponent(state.city));
    var url = parts.length ? "#" + parts.join("&") : location.pathname + location.search;
    history.replaceState(null, "", url);
  }

  // ── Rendering ──────────────────────────────────────
  function render() {
    var list = ALL.filter(matches);
    var byCity = {};
    list.forEach(function (r) { (byCity[r.city] = byCity[r.city] || []).push(r); });

    var frag = document.createDocumentFragment(), shownCities = 0, gi = 0;
    cities.forEach(function (c) {
      var arr = byCity[c]; if (!arr || !arr.length) return;
      shownCities++;
      arr.sort(function (a, b) { return a.name.localeCompare(b.name, "de"); });
      var sec = document.createElement("section"); sec.className = "city";
      var head = document.createElement("div"); head.className = "city-head";
      var h2 = document.createElement("h2"); h2.textContent = c;
      var rule = document.createElement("span"); rule.className = "rule";
      var cnt = document.createElement("span"); cnt.className = "count";
      cnt.textContent = arr.length + (arr.length === 1 ? " Adresse" : " Adressen");
      head.appendChild(h2); head.appendChild(rule); head.appendChild(cnt);
      sec.appendChild(head);
      var grid = document.createElement("div"); grid.className = "grid";
      arr.forEach(function (r) { grid.appendChild(cardEl(r, gi++)); });
      sec.appendChild(grid); frag.appendChild(sec);
    });
    elResults.replaceChildren(frag);

    var none = list.length === 0;
    elEmpty.hidden = !none;
    elResults.style.display = none ? "none" : "";
    elFoot.textContent = none
      ? "0 von " + ALL.length + " angezeigt"
      : list.length + " von " + ALL.length + " angezeigt · " + shownCities + (shownCities === 1 ? " Stadt" : " Städte");

    writeHash();
  }

  // ── Filter-Events ──────────────────────────────────
  var dq;
  elQ.addEventListener("input", function () {
    clearTimeout(dq);
    dq = setTimeout(function () {
      state.qRaw = elQ.value.trim(); state.q = fold(state.qRaw); render();
    }, 110);
  });
  elCity.addEventListener("change", function () { state.city = elCity.value; render(); });
  function resetAll() {
    state.q = ""; state.qRaw = ""; state.cats.clear(); state.city = "";
    elQ.value = ""; elCity.value = ""; syncChips(); render();
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }
  $("reset-empty").addEventListener("click", resetAll);
  $("totop").addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  });

  // ── Roulette „Wohin heute?" ────────────────────────
  var elRoulette = $("roulette"), elReel = $("rl-reel"), elWin = $("rl-winner");
  var elRName = $("rl-name"), elRCity = $("rl-city"), elRNote = $("rl-note"), elRTags = $("rl-tags");
  var elPool = $("rl-pool"), elAgain = $("rl-again"), elGoto = $("rl-goto"), rollBtn = $("roll");
  var pool = [], spinning = false, lastFocus = null, winnerKey = null, timers = [];

  function poolText(n) {
    if (n === 0) return "Keine Adressen im aktuellen Filter.";
    if (n === ALL.length) return "Zufallswahl aus allen " + n + " Adressen";
    return "Zufallswahl aus " + n + (n === 1 ? " gefilterten Adresse" : " gefilterten Adressen");
  }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function pick() { return pool[Math.floor(Math.random() * pool.length)]; }

  function reveal(w) {
    winnerKey = w._i;
    elReel.style.display = "none";
    elRName.textContent = w.name;
    elRCity.textContent = w.city;
    if (w.note) { elRNote.textContent = w.note; elRNote.style.display = ""; }
    else { elRNote.style.display = "none"; }
    elRTags.replaceChildren();
    (w.tags || []).forEach(function (t) { elRTags.appendChild(tagEl(t)); });
    elWin.hidden = false;
    elWin.classList.remove("show"); void elWin.offsetWidth; elWin.classList.add("show");
    elGoto.hidden = false; elRMap.hidden = false;
    elAgain.focus();
  }
  function spin() {
    clearTimers(); spinning = true;
    elWin.hidden = true; elWin.classList.remove("show");
    elReel.style.display = ""; elGoto.hidden = true; elRMap.hidden = true;
    var winner = pick();
    if (reduceMotion || pool.length === 1) {
      elReel.textContent = winner.name; reveal(winner); spinning = false; return;
    }
    var steps = Math.min(26, 12 + pool.length), acc = 0;
    for (var i = 0; i < steps; i++) {
      (function (idx) {
        var t = idx / steps;
        acc += 45 + Math.pow(t, 2.2) * 230;
        timers.push(setTimeout(function () {
          if (idx === steps - 1) { elReel.textContent = winner.name; reveal(winner); spinning = false; }
          else { elReel.textContent = pick().name; }
        }, acc));
      })(i);
    }
  }
  function openRoulette() {
    pool = ALL.filter(matches);
    lastFocus = document.activeElement;
    elRoulette.hidden = false;
    document.body.style.overflow = "hidden";
    elPool.textContent = poolText(pool.length);
    if (pool.length === 0) {
      elWin.hidden = true; elWin.classList.remove("show");
      elReel.style.display = ""; elReel.textContent = "–";
      elAgain.disabled = true; elGoto.hidden = true; elRMap.hidden = true; elAgain.focus(); return;
    }
    elAgain.disabled = false; spin();
  }
  function closeRoulette() {
    clearTimers(); spinning = false;
    elRoulette.hidden = true; document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function gotoWinner() {
    var key = winnerKey; closeRoulette();
    if (key == null) return;
    var card = document.querySelector('.card[data-key="' + key + '"]');
    if (!card) return;
    card.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash");
    setTimeout(function () { card.classList.remove("flash"); }, 1800);
  }
  rollBtn.addEventListener("click", openRoulette);
  elAgain.addEventListener("click", function () { if (!spinning) spin(); });
  elGoto.addEventListener("click", gotoWinner);
  elRoulette.addEventListener("click", function (e) {
    if (e.target.hasAttribute("data-close")) closeRoulette();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !elRoulette.hidden) closeRoulette();
  });

  // ── Karte (Standort-Modal, keyless Google-Embed) ───
  var elMap = $("mapmodal"), elFrame = $("map-frame"),
      elMapTitle = $("map-title"), elMapLink = $("map-link"), elRMap = $("rl-map");
  var mapLastFocus = null;
  function openMap(r) {
    var q = encodeURIComponent(r.name + ", " + r.city + ", Deutschland");
    mapLastFocus = document.activeElement;
    elMapTitle.textContent = r.name + " · " + r.city;
    elFrame.src = "https://maps.google.com/maps?q=" + q + "&z=16&output=embed";
    elMapLink.href = "https://www.google.com/maps/search/?api=1&query=" + q;
    elMap.hidden = false; document.body.style.overflow = "hidden";
  }
  function closeMap() {
    elMap.hidden = true; elFrame.src = "about:blank"; document.body.style.overflow = "";
    if (mapLastFocus && mapLastFocus.focus) mapLastFocus.focus();
  }
  elMap.addEventListener("click", function (e) { if (e.target.hasAttribute("data-close")) closeMap(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !elMap.hidden) closeMap(); });
  elRMap.addEventListener("click", function () {
    if (winnerKey == null) return;
    var r = ALL[winnerKey]; closeRoulette(); openMap(r);
  });

  // ── Init ───────────────────────────────────────────
  applyHash();
  syncChips();
  render();
})();
