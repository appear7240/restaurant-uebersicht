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

  // Stadt-Mittelpunkte (verlässlich) für die Übersichts-Landkarte
  var CITY_COORDS = {
    "Bochum": [51.4818, 7.2162], "Castrop-Rauxel": [51.5497, 7.3110],
    "Bottrop": [51.5235, 6.9286], "Dortmund": [51.5136, 7.4653],
    "Dinslaken": [51.5601, 6.7670], "Duisburg": [51.4344, 6.7623],
    "Düsseldorf": [51.2277, 6.7735], "Essen": [51.4556, 7.0116],
    "Moers": [51.4517, 6.6406], "Mülheim": [51.4275, 6.8825],
    "Gelsenkirchen": [51.5177, 7.0857], "Hamburg": [53.5511, 9.9937],
    "Herten": [51.5938, 7.1357], "Köln": [50.9375, 6.9603],
    "Krefeld": [51.3388, 6.5853], "Oberhausen": [51.4963, 6.8638],
    "Recklinghausen": [51.6142, 7.1979], "Wuppertal": [51.2562, 7.1508]
  };

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
    r._s = fold([r.name, r.city, (r.tags || []).join(" "), r.note || "", r.blurb || ""].join(" "));
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
  var knownTags = TAG_ORDER.filter(function (t) { return catCount[t]; });
  var extraTags = Object.keys(catCount)
    .filter(function (t) { return TAG_ORDER.indexOf(t) === -1; })
    .sort(function (a, b) {
      if (catCount[b] !== catCount[a]) return catCount[b] - catCount[a];
      return a.localeCompare(b, "de");
    });
  var presentTags = knownTags.concat(extraTags);

  // State
  var state = { q: "", qRaw: "", cats: new Set(), city: "" };
  var view = "list";

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
    onClick: function () { state.cats.clear(); syncChips(); refresh(); } });
  elChips.appendChild(resetChip);
  var tagChips = {};
  presentTags.forEach(function (t) {
    var c = makeChip({ label: t, n: catCount[t], tag: t, dot: true,
      onClick: function () {
        if (state.cats.has(t)) state.cats.delete(t); else state.cats.add(t);
        syncChips(); refresh();
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
    if (r.blurb) { var bl = document.createElement("div"); bl.className = "blurb"; bl.textContent = r.blurb; card.appendChild(bl); }
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
    mb.addEventListener("click", function (e) { e.stopPropagation(); openMap(r); });
    foot.appendChild(mb); card.appendChild(foot);
    card.style.cursor = "pointer";
    card.title = "Mit Google Maps navigieren";
    card.addEventListener("click", function () {
      var q = encodeURIComponent(r.name + ", " + r.city + ", Deutschland");
      var url = "https://www.google.com/maps/dir/?api=1&destination=" + q;
      if (r.placeId) url += "&destination_place_id=" + encodeURIComponent(r.placeId);
      window.open(url, "_blank", "noopener");
    });
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
    if (view === "map") {
      elResults.style.display = "none"; elEmpty.hidden = true;
    } else {
      elResults.style.display = none ? "none" : "";
      elEmpty.hidden = !none;
    }
    elFoot.textContent = none
      ? "0 von " + ALL.length + " angezeigt"
      : list.length + " von " + ALL.length + " angezeigt · " + shownCities + (shownCities === 1 ? " Stadt" : " Städte");

    writeHash();
  }

  // ── Ansicht: Liste / Landkarte ─────────────────────
  var elMapView = $("map"), elViewList = $("view-list"), elViewMap = $("view-map");
  var mapInited = false, mapObj = null, googleReady = false;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function mapsKey() { return (window.RUE_CONFIG && window.RUE_CONFIG.mapsKey) || ""; }

  function initMap() {
    if (mapInited) return; mapInited = true;
    if (mapsKey()) initGoogle();
    else if (window.L) initLeaflet();
    else elMapView.innerHTML = '<div class="map-msg">Karte nicht verfügbar.</div>';
  }

  // Leaflet-Fallback: Städte-Übersicht (keyless)
  function initLeaflet() {
    if (!window.L) { elMapView.innerHTML = '<div class="map-msg">Karte nicht verfügbar.</div>'; return; }
    var L = window.L;
    elMapView.innerHTML = "";
    mapObj = L.map(elMapView, { scrollWheelZoom: false }).setView([51.45, 7.2], 9);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(mapObj);
    var pts = [];
    cities.forEach(function (c) {
      var co = CITY_COORDS[c]; if (!co) return;
      var n = cityCount[c];
      var mk = L.circleMarker(co, { radius: 8 + Math.sqrt(n) * 4, color: "#bf4128",
        weight: 2, fillColor: "#bf4128", fillOpacity: 0.5 }).addTo(mapObj);
      var box = document.createElement("div"); box.className = "pin-pop";
      box.innerHTML = "<b>" + esc(c) + "</b><br>" + n + (n === 1 ? " Adresse" : " Adressen") + "<br>";
      var b = document.createElement("button"); b.type = "button"; b.textContent = "Hier ansehen";
      b.addEventListener("click", function () { showCity(c); });
      box.appendChild(b); mk.bindPopup(box);
      pts.push(co);
    });
    if (pts.length) mapObj.fitBounds(pts, { padding: [40, 40] });
  }

  // Google Maps: echte Pins pro Restaurant
  function initGoogle() {
    window.__rueGmaps = buildGoogle;
    window.gm_authFailure = function () {
      // Key/Restriction/Billing -> sauberer Fallback
      if (window.L && !googleReady) initLeaflet();
      else if (!googleReady) elMapView.innerHTML = '<div class="map-msg">Google-Karte fehlgeschlagen (Key/Restriction/Billing).</div>';
    };
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(mapsKey()) +
            "&libraries=places&loading=async&callback=__rueGmaps";
    s.onerror = function () { if (window.L) initLeaflet(); };
    document.head.appendChild(s);
  }

  function buildGoogle() {
    var g = window.google && window.google.maps;
    if (!g) { if (window.L) initLeaflet(); return; }
    googleReady = true;
    var map = new g.Map(elMapView, {
      center: { lat: 51.3, lng: 7.1 }, zoom: 8,
      streetViewControl: false, mapTypeControl: false, fullscreenControl: true
    });
    var svc = null; // legacy PlacesService entfällt – Details via places.Place (New)
    var iw = new g.InfoWindow();
    var bounds = new g.LatLngBounds();
    var withGeo = ALL.filter(function (r) { return typeof r.lat === "number"; });
    withGeo.forEach(function (r) {
      var pos = { lat: r.lat, lng: r.lng };
      bounds.extend(pos);
      var m = new g.Marker({ position: pos, map: map, title: r.name });
      m.addListener("click", function () { openInfo(r, m, map, svc, iw, g); });
    });
    if (withGeo.length) map.fitBounds(bounds);
  }

  async function openInfo(r, marker, map, svc, iw, g) {
    var q = encodeURIComponent(r.name + ", " + r.city);
    var maps = "https://www.google.com/maps/search/?api=1&query=" + q +
               (r.placeId ? "&query_place_id=" + r.placeId : "");
    function render(extra) {
      iw.setContent('<div class="gpop"><b>' + esc(r.name) + '</b><div class="c">' + esc(r.city) +
        '</div>' + (extra || "") + '<a href="' + maps + '" target="_blank" rel="noopener">In Google Maps öffnen &#8599;</a></div>');
    }
    render("");
    iw.open(map, marker);
    if (!r.placeId || !g.places || !g.places.Place) return;
    try {
      var place = new g.places.Place({ id: r.placeId });
      await place.fetchFields({ fields: ["photos", "rating", "userRatingCount", "regularOpeningHours", "websiteURI"] });
      var html = "";
      if (place.photos && place.photos.length) {
        html += '<div class="ph">' + place.photos.slice(0, 2).map(function (p) {
          return '<img loading="lazy" src="' + p.getURI({ maxWidth: 320, maxHeight: 200 }) + '" alt="">';
        }).join("") + '</div>';
      }
      if (place.rating) html += '<div class="r">★ ' + place.rating + ' (' + (place.userRatingCount || 0) + ')</div>';
      try {
        if (typeof place.isOpen === "function") {
          var on = await place.isOpen();
          if (on === true) html += '<div class="o open">Jetzt geöffnet</div>';
          else if (on === false) html += '<div class="o">Geschlossen</div>';
        }
      } catch (e) {}
      if (place.websiteURI) html += '<a class="site" href="' + esc(place.websiteURI) + '" target="_blank" rel="noopener">Speisekarte / Website &#8599;</a>';
      render(html);
    } catch (e) { /* Basis-Popup bleibt stehen */ }
  }

  function setView(v) {
    view = v;
    var isMap = v === "map";
    elViewMap.classList.toggle("on", isMap); elViewList.classList.toggle("on", !isMap);
    elViewMap.setAttribute("aria-selected", isMap ? "true" : "false");
    elViewList.setAttribute("aria-selected", isMap ? "false" : "true");
    elMapView.hidden = !isMap;
    if (isMap) {
      elResults.style.display = "none"; elEmpty.hidden = true;
      initMap();
      if (mapObj) setTimeout(function () { mapObj.invalidateSize(); }, 0);
    } else {
      render();
    }
  }
  function refresh() { if (view !== "list") setView("list"); else render(); }
  function showCity(c) {
    state.city = c; elCity.value = c; setView("list");
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }
  elViewList.addEventListener("click", function () { setView("list"); });
  elViewMap.addEventListener("click", function () { setView("map"); });

  // ── Filter-Events ──────────────────────────────────
  var dq;
  elQ.addEventListener("input", function () {
    clearTimeout(dq);
    dq = setTimeout(function () {
      state.qRaw = elQ.value.trim(); state.q = fold(state.qRaw); refresh();
    }, 110);
  });
  elCity.addEventListener("change", function () { state.city = elCity.value; refresh(); });
  function resetAll() {
    state.q = ""; state.qRaw = ""; state.cats.clear(); state.city = "";
    elQ.value = ""; elCity.value = ""; syncChips(); refresh();
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

  // ── Restaurant hinzufügen (Backend nötig) ──────────
  (function () {
    var fab = $("add-fab"), modal = $("addmodal");
    if (!fab || !modal) return;
    var nm = $("add-name"), ct = $("add-city"), nt = $("add-note"),
        save = $("add-save"), msg = $("add-msg"), dl = $("add-cities");
    var API = "/admin/api/";
    cities.forEach(function (c) { var o = document.createElement("option"); o.value = c; dl.appendChild(o); });
    function setMsg(t, ok) { msg.textContent = t || ""; msg.className = "add-msg" + (ok === true ? " ok" : ok === false ? " err" : ""); }
    function open() { setMsg(""); modal.hidden = false; document.body.style.overflow = "hidden"; nm.focus(); }
    function close() { modal.hidden = true; document.body.style.overflow = ""; }
    fab.addEventListener("click", open);
    modal.addEventListener("click", function (e) { if (e.target.hasAttribute("data-close")) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !modal.hidden) close(); });
    save.addEventListener("click", async function () {
      var name = nm.value.trim(), city = ct.value.trim();
      if (!name || !city) { setMsg("Name und Stadt nötig.", false); return; }
      save.disabled = true; setMsg("Speichere…");
      try {
        var r = await fetch(API + "restaurants", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name, city: city, note: nt.value.trim() }) });
        if (!r.ok) throw new Error("HTTP " + r.status);
        await fetch(API + "export", { method: "POST" });
        setMsg("Hinzugefügt + exportiert. Seite neu laden, um es zu sehen.", true);
        nm.value = ""; nt.value = "";
      } catch (e) { setMsg("Fehler (Backend erreichbar?): " + e.message, false); }
      save.disabled = false;
    });
  })();

  // ── Init ───────────────────────────────────────────
  applyHash();
  syncChips();
  render();
})();
