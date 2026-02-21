/* app.js — Woodson Zip Sales Heatmap (Mapbox GL JS v3)
   - Filters: BranchName, ProductGroupLevel1, date range (from BOM SaleDate)
   - Metric toggle: TotalSales vs TicketCount
   - Heatmap appearance: unchanged
*/

(() => {
  const LOG_PREFIX = "[WLHeatmap]";
  const log = (...args) => console.log(LOG_PREFIX, ...args);

  // =========================
  // EDIT THESE IF NEEDED
  // =========================
  const TILESET_ID = "ckunkel.bp872kqi";
  const SOURCE_LAYER = "MapBox-42vjbp";
  const FILTERS_URL = "filters.json";

  // BOM field name we saw in your tileset properties: "﻿SaleDate"
  const BOM_SALEDATE_FIELD = "\ufeffSaleDate";

  
  // =========================
  // Dashboard-safe boot (BisTrack WebView / iframe)
  // =========================
  const onceKey = "__WLHeatmapBooted__";
  if (window[onceKey]) { log("Already booted; skipping duplicate load."); return; }
  window[onceKey] = true;

  const ready = (fn) => {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once: true });
    else fn();
  };

  const waitForElement = (id, { timeoutMs = 15000 } = {}) =>
    new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const el = document.getElementById(id);
        if (el) return resolve(el);
        if (Date.now() - start > timeoutMs) return reject(new Error(`Timed out waiting for #${id}`));
        requestAnimationFrame(check);
      };
      check();
    });

  const waitForNonZeroSize = (el, { timeoutMs = 15000 } = {}) =>
    new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const r = el.getBoundingClientRect();
        if (r.width > 20 && r.height > 20) return resolve(r);
        if (Date.now() - start > timeoutMs) return reject(new Error("Map container has zero size"));
        requestAnimationFrame(check);
      };
      check();
    });

  const boot = async () => {
    const mapEl = await waitForElement("map");
    await waitForNonZeroSize(mapEl).catch(() => {
      mapEl.style.minHeight = "600px";
    });

// =========================
  // DOM
  // =========================
  const els = {
    branchSelect: document.getElementById("branchSelect"),
    groupSelect: document.getElementById("groupSelect"),
    startDate: document.getElementById("startDate"),
    endDate: document.getElementById("endDate"),
    metricSales: document.getElementById("metricSales"),
    metricTickets: document.getElementById("metricTickets"),
    applyBtn: document.getElementById("applyBtn"),
    clearBtn: document.getElementById("clearBtn"),
    status: document.getElementById("status"),
  };


  // =========================
  // Mobile / Tablet: collapsible filter drawer (no HTML edits required)
  // - Hides the sidebar filter section on small screens
  // - Shows a compact "Filters" bar; tap to open drawer
  // - On Apply: auto-hides the drawer again
  // =========================
  const MOBILE_BREAKPOINT_PX = 820; // tablet/mobile cutoff

  function isMobileViewport() {
    return !!(window.matchMedia && window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches);
  }

  // Locate the filter panel by walking up from Apply and finding the smallest ancestor
  // that contains the core filter controls.
  function findFilterPanel() {
    const apply = els.applyBtn;
    if (!apply) return null;

    const mapEl = document.getElementById("map");
    const required = [els.branchSelect, els.groupSelect, els.startDate, els.endDate, els.applyBtn].filter(Boolean);

    const containsAll = (node) => required.every((c) => node && node.contains && node.contains(c));
    const containsMap = (node) => !!(mapEl && node && node.contains && node.contains(mapEl));

    // Walk up from Apply; prefer the smallest ancestor that has all controls but NOT the map.
    let cur = apply.parentElement;
    let best = null;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (containsAll(cur) && !containsMap(cur)) best = cur;
      cur = cur.parentElement;
    }

    // Fallback: nearest "panel-ish" ancestor that doesn't include the map
    const fallback = apply.closest("section, aside, .sidebar, .filters, .filter-panel, .panel");
    if (fallback && !containsMap(fallback)) return fallback;

    return best || apply.parentElement;
  }

  // Create a compact status + toggle button for mobile/tablet
  function ensureMobileFilterToggleUI(filterPanelEl) {
    if (!filterPanelEl) return;

    // Prevent duplicates (BisTrack can re-init)
    if (document.getElementById("wlFilterToggleBar")) return;

    // Inject CSS once
    if (!document.getElementById("wlMobileFilterStyle")) {
      const st = document.createElement("style");
      st.id = "wlMobileFilterStyle";
      st.textContent = `
        /* Mobile filter toggle + drawer */
        #wlFilterToggleBar{
          position: absolute;
          top: 10px;
          left: 10px;
          right: 10px;
          z-index: 5;
          display: none;
        }
        #wlFilterToggleBar .wl-bar{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:10px;
          padding:10px 12px;
          border:1px solid rgba(0,0,0,.15);
          border-radius:12px;
          background: rgba(255,255,255,.95);
          box-shadow: 0 6px 18px rgba(0,0,0,.08);
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
          -webkit-text-size-adjust: 100%;
        }
        #wlFilterToggleBar .wl-title{
          font-weight: 700;
          font-size: 13px;
          color:#111827;
          line-height:1.15;
        }
        #wlFilterToggleBar .wl-summary{
          font-size: 11px;
          color:#111827;
          opacity:.9;
          line-height:1.2;
          max-width: 70%;
          overflow:hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        #wlFilterToggleBar button{
          color:#111827 !important;
          background:#ffffff !important;
          border:1px solid rgba(0,0,0,.18) !important;
          border-radius:10px !important;
          padding:8px 10px !important;
          font-size:12px !important;
          cursor:pointer !important;
          -webkit-text-fill-color:#111827 !important;
          white-space:nowrap !important;
        }
        #wlFilterToggleBar button:active{ transform: translateY(1px); }

        /* Drawer states (mobile only) */
        @media (max-width: ${MOBILE_BREAKPOINT_PX}px){
          .wl-filter-drawer{
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            height: 100vh !important;
            width: min(420px, 92vw) !important;
            max-width: 92vw !important;
            z-index: 9999 !important;
            background: #ffffff !important;
            box-shadow: 16px 0 40px rgba(0,0,0,.25) !important;
            overflow: auto !important;
            transform: translateX(-110%);
            transition: transform .18s ease;
            padding: 14px 14px 22px 14px !important;
          }
          .wl-filter-drawer.is-open{ transform: translateX(0); }

          .wl-filter-backdrop{
            position: fixed;
            inset: 0;
            z-index: 9998;
            background: rgba(0,0,0,.35);
            opacity: 0;
            pointer-events: none;
            transition: opacity .18s ease;
          }
          .wl-filter-backdrop.is-open{
            opacity: 1;
            pointer-events: auto;
          }

          .wl-filter-drawer .wl-drawer-header{
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap:10px;
            margin-bottom: 10px;
          }
          .wl-filter-drawer .wl-drawer-header .wl-h{
            font-weight: 800;
            font-size: 14px;
            color:#111827;
            font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
          }
          .wl-filter-drawer .wl-close{
            border:1px solid rgba(0,0,0,.18);
            border-radius: 10px;
            padding: 7px 10px;
            background:#fff;
            cursor:pointer;
            color:#111827;
            font-size: 12px;
            -webkit-text-fill-color:#111827;
          }
        }

        /* Only activate on small screens */
        @media (max-width: ${MOBILE_BREAKPOINT_PX}px){
          #wlFilterToggleBar{ display:block; }
        }
      `;
      document.head.appendChild(st);
    }

    // Backdrop
    const backdrop = document.createElement("div");
    backdrop.id = "wlFilterBackdrop";
    backdrop.className = "wl-filter-backdrop";
    document.body.appendChild(backdrop);

    // Toggle bar (overlay on top of map; doesn't require HTML changes)
    const barWrap = document.createElement("div");
    barWrap.id = "wlFilterToggleBar";
    barWrap.innerHTML = `
      <div class="wl-bar">
        <div style="min-width:0;">
          <div class="wl-title">Filters</div>
          <div class="wl-summary" id="wlFilterSummary">Tap to adjust…</div>
        </div>
        <button type="button" id="wlToggleFiltersBtn">Show</button>
      </div>
    `;

    // Place it near the map so it feels "attached" (fallback to body)
    const mapParent = (document.getElementById("map")?.parentElement) || document.body;
    if (mapParent !== document.body) {
      const pos = getComputedStyle(mapParent).position;
      if (pos === "static") mapParent.style.position = "relative";
    }
    mapParent.appendChild(barWrap);

    // Convert filter panel into a drawer on mobile
    filterPanelEl.classList.add("wl-filter-drawer");

    // Add a header row inside the drawer (only once)
    if (!filterPanelEl.querySelector(".wl-drawer-header")) {
      const header = document.createElement("div");
      header.className = "wl-drawer-header";
      header.innerHTML = `
        <div class="wl-h">Filters</div>
        <button type="button" class="wl-close" id="wlCloseFiltersBtn">Close</button>
      `;
      filterPanelEl.insertBefore(header, filterPanelEl.firstChild);
    }

    const toggleBtn = barWrap.querySelector("#wlToggleFiltersBtn");
    const closeBtn = filterPanelEl.querySelector("#wlCloseFiltersBtn");
    const summaryEl = barWrap.querySelector("#wlFilterSummary");

    function setOpen(open) {
      if (!isMobileViewport()) {
        filterPanelEl.classList.remove("is-open");
        backdrop.classList.remove("is-open");
        if (toggleBtn) toggleBtn.textContent = "Show";
        return;
      }
      filterPanelEl.classList.toggle("is-open", !!open);
      backdrop.classList.toggle("is-open", !!open);
      if (toggleBtn) toggleBtn.textContent = open ? "Hide" : "Show";
    }

    function updateSummary() {
      if (!summaryEl) return;
      const b = els.branchSelect?.value || "__ALL__";
      const g = els.groupSelect?.value || "__ALL__";
      const s = els.startDate?.value || "";
      const e = els.endDate?.value || "";
      const bTxt = (b === "__ALL__") ? "All branches" : b;
      const gTxt = (g === "__ALL__") ? "All groups" : g;
      const dTxt = (s || e) ? `${s || "…"} → ${e || "…"}` : "Any dates";
      summaryEl.textContent = `${bTxt} • ${gTxt} • ${dTxt}`;
    }

    toggleBtn?.addEventListener("click", () => {
      const openNow = !filterPanelEl.classList.contains("is-open");
      setOpen(openNow);
      updateSummary();
    });

    closeBtn?.addEventListener("click", () => setOpen(false));
    backdrop.addEventListener("click", () => setOpen(false));

    ["change", "input"].forEach((evt) => {
      els.branchSelect?.addEventListener(evt, updateSummary);
      els.groupSelect?.addEventListener(evt, updateSummary);
      els.startDate?.addEventListener(evt, updateSummary);
      els.endDate?.addEventListener(evt, updateSummary);
    });

    const onResize = () => {
      updateSummary();
      if (!isMobileViewport()) {
        backdrop.classList.remove("is-open");
        filterPanelEl.classList.remove("is-open");
        if (toggleBtn) toggleBtn.textContent = "Show";
      } else {
        setOpen(false);
      }
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);

    window.__WLFilterDrawer__ = { setOpen, updateSummary, isMobileViewport };
    updateSummary();
    setOpen(false);
  }

  // Kickoff once DOM is available (we're inside boot(), so elements exist)
  const __wlFilterPanelEl = findFilterPanel();
  ensureMobileFilterToggleUI(__wlFilterPanelEl);


  const setStatus = (msg) => {
    if (els.status) els.status.textContent = msg || "";
  };

  // =========================
  // State
  // =========================
  const state = {
    metric: "sales", // "sales" | "tickets"
    branch: "__ALL__",
    group: "__ALL__",
    startKey: null, // YYYYMMDD int
    endKey: null,   // YYYYMMDD int
  };

  const METRICS = {
    sales: { label: "Sales", prop: "TotalSales" },
    tickets: { label: "Tickets", prop: "TicketCount" },
  };

  // =========================
  // Helpers
  // =========================
  function dateToKey(yyyy_mm_dd) {
    // input from <input type="date"> is "YYYY-MM-DD"
    if (!yyyy_mm_dd) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyy_mm_dd);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    return (y * 10000) + (mo * 100) + d;
  }


// Convert YYYYMMDD int -> Date (local)
function keyToDate(key) {
  if (!key) return null;
  const y = Math.floor(key / 10000);
  const m = Math.floor((key % 10000) / 100);
  const d = key % 100;
  return new Date(y, m - 1, d);
}

// Format Date -> "M/D/YYYY" (no leading zeros), matching tileset "﻿SaleDate" values
function formatMDY(dt) {
  const m = dt.getMonth() + 1;
  const d = dt.getDate();
  const y = dt.getFullYear();
  return `${m}/${d}/${y}`;
}

// Build an array of "M/D/YYYY" strings between startKey and endKey (inclusive)
function buildAllowedSaleDates(startKey, endKey) {
  const sdt = keyToDate(startKey);
  const edt = keyToDate(endKey);
  if (!sdt || !edt) return [];
  // normalize to midnight
  sdt.setHours(0,0,0,0);
  edt.setHours(0,0,0,0);

  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.round((edt - sdt) / dayMs);
  if (days < 0) return [];
  // guard: avoid massive literal arrays in filters
  if (days > 370) {
    console.warn("[WLHeatmap] Date range too large for SaleDate string filter:", days, "days. Narrow the range or add SaleDateKey to the layer properties.");
    return [];
  }

  const out = [];
  for (let i = 0; i <= days; i++) {
    const dt = new Date(sdt.getTime() + i * dayMs);
    out.push(formatMDY(dt));
  }
  return out;
}


  function safeToNumberExpr(propName) {
  return ["coalesce", ["to-number", ["get", propName]], 0];
}

  // Build numeric YYYYMMDD from the tileset's M/D/YYYY string in "﻿SaleDate"
  // Example: "2/11/2026" => 20260211
 // Build numeric YYYYMMDD from the tileset's M/D/YYYY string in "﻿SaleDate"
// Example: "2/11/2026" => 20260211

// =========================
// Date filtering
// =========================
// IMPORTANT:
// Mapbox GL JS v3 style validation is rejecting string-parsing expressions (split/at/etc.)
// inside filters in your environment. The robust fix is to filter on a precomputed numeric
// field in the tileset called `SaleDateKey` (YYYYMMDD as a NUMBER).
//
// Example property per feature:
//   SaleDateKey: 20260219
//
// If SaleDateKey is missing, the date filter will be skipped (and we’ll surface a status note).
function saleDateKeyExpr() {
    return [
      "coalesce",
      ["to-number", ["get", "SaleDateKey"]],
      ["to-number", ["get", "\ufeffSaleDateKey"]],
      0,
    ];
  }

function tilesetHasSaleDateKey() {
    try {
      // Prefer querySourceFeatures (sees properties even if not currently rendered)
      const sfeats = map.querySourceFeatures(SOURCE_ID, { sourceLayer: SOURCE_LAYER });
      const sp = sfeats?.[0]?.properties;
      if (sp) return (sp.SaleDateKey != null || sp["\ufeffSaleDateKey"] != null);

      // Fallback: rendered features
      const feats = map.queryRenderedFeatures({ layers: [POINT_LAYER_ID] });
      const p = feats?.[0]?.properties;
      return !!(p && (p.SaleDateKey != null || p["\ufeffSaleDateKey"] != null));
    } catch {
      return false;
    }
}


  function buildFilterExpr() {
    const expr = ["all"];

    if (state.branch && state.branch !== "__ALL__") {
      expr.push(["==", ["get", "BranchName"], state.branch]);
    }

    if (state.group && state.group !== "__ALL__") {
      expr.push(["==", ["get", "ProductGroupLevel1"], state.group]);
    }



const dk = saleDateKeyExpr();

// Date filter prefers numeric SaleDateKey when available.
// If it isn't available via client-side feature properties, fall back to matching the raw "M/D/YYYY" SaleDate strings.
const canDateFilter = tilesetHasSaleDateKey();

if (canDateFilter) {
  if (state.startKey != null) expr.push([">=", dk, state.startKey]);
  if (state.endKey != null) expr.push(["<=", dk, state.endKey]);
} else if (state.startKey != null || state.endKey != null) {
  // Fallback: build list of allowed dates and filter on the BOM SaleDate field directly.
  // Works without parsing inside Mapbox expressions (avoids GL JS v3 validation issues).
  const sKey = state.startKey ?? state.endKey;
  const eKey = state.endKey ?? state.startKey;
  const allowed = buildAllowedSaleDates(sKey, eKey);

  if (allowed.length) {
    expr.push(["in", ["get", BOM_SALEDATE_FIELD], ["literal", allowed]]);
  } else {
    console.warn("[WLHeatmap] Date filter skipped — SaleDateKey not visible and allowed date list is empty/too large.");
  }
}return expr;
  }

  function setMetricUI(metric) {
    state.metric = metric;
    const isSales = metric === "sales";
    els.metricSales?.classList.toggle("active", isSales);
    els.metricTickets?.classList.toggle("active", !isSales);
    log("Metric set to", METRICS[metric].label);
  }

  // =========================
  // Map init
  // =========================
  log("Booting...");

  const map = new mapboxgl.Map({
    container: mapEl,
    style: "mapbox://styles/mapbox/light-v11",
    center: [-96.7, 30.6],
    zoom: 6.3,
  });

  map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");

  // Debug helper
  window.WLdbg = () => {
    try {
      const feats = map.queryRenderedFeatures({ layers: ["wl-points"] });
      const p = feats?.[0]?.properties;
      console.log("[WLHeatmap] sample feature properties:", p);
      if (p) {
        console.log("[WLHeatmap] keys:", Object.keys(p).sort());
        console.log("[WLHeatmap] SaleDateKey:", p.SaleDateKey, "SaleDate:", p.SaleDate, "BOM SaleDate:", p["\ufeffSaleDate"]); 
      }
      return feats?.[0]?.properties;
    } catch (e) {
      console.warn("[WLHeatmap] WLdbg error:", e);
      return null;
    }
  };

  // =========================
  // Load filters
  // =========================
  async function loadFilters() {
    log("Loading filter lists...");
    setStatus("Loading filters…");

    try {
      const res = await fetch(FILTERS_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`filters.json HTTP ${res.status}`);
      const data = await res.json();

      const branches = Array.isArray(data.branches) ? data.branches : [];
      const groups = Array.isArray(data.groups) ? data.groups : [];

      if (els.branchSelect) {
        for (const b of branches) {
          const opt = document.createElement("option");
          opt.value = b;
          opt.textContent = b;
          els.branchSelect.appendChild(opt);
        }
      }

      if (els.groupSelect) {
        for (const g of groups) {
          const opt = document.createElement("option");
          opt.value = g;
          opt.textContent = g;
          els.groupSelect.appendChild(opt);
        }
      }

      log(`Loaded filters.json • ${branches.length} branches • ${groups.length} groups`);
      setStatus(`Loaded ${branches.length} branches • ${groups.length} product groups`);
    } catch (err) {
      console.warn(LOG_PREFIX, "filters.json load failed:", err);
      setStatus("Could not load filters.json (check path).");
    }
  }

  // =========================
  // Layers (appearance unchanged)
  // =========================
  const SOURCE_ID = "wl-zip-sales";
  const HEAT_LAYER_ID = "wl-heat";
  const POINT_LAYER_ID = "wl-points";

  const HIT_LAYER_ID = "wl-points-hit";
  function ensureLayers() {
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: "vector",
        url: `mapbox://${TILESET_ID}`,
      });
    }

    const metricProp = METRICS[state.metric].prop;
    const metricNum = safeToNumberExpr(metricProp);

    if (!map.getLayer(HEAT_LAYER_ID)) {
      map.addLayer({
        id: HEAT_LAYER_ID,
        type: "heatmap",
        source: SOURCE_ID,
        "source-layer": SOURCE_LAYER,
        paint: {
          "heatmap-weight": [
            "interpolate", ["linear"], metricNum,
            0, 0,
            500, 0.25,
            2000, 0.6,
            10000, 1
          ],
          "heatmap-intensity": [
            "interpolate", ["linear"], ["zoom"],
            0, 0.7,
            7, 1.0,
            10, 1.4,
            12, 1.8
          ],
          "heatmap-radius": [
            "interpolate", ["linear"], ["zoom"],
            0, 10,
            7, 22,
            10, 34,
            12, 48
          ],
          "heatmap-opacity": [
            "interpolate", ["linear"], ["zoom"],
            6, 0.92,
            11, 0.78,
            13, 0.6
          ],
        },
      });
    }

    if (!map.getLayer(POINT_LAYER_ID)) {
      map.addLayer({
        id: POINT_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        "source-layer": SOURCE_LAYER,
        paint: {
          "circle-opacity": [
            "interpolate", ["linear"], ["zoom"],
            6, 0.08,
            9, 0.18,
            12, 0.35
          ],
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            6, 2,
            9, 3,
            12, 5
          ],
          "circle-color": "#111827",
        },
      });
    }

    // Invisible-but-clickable "hit" layer to make points easier to tap/click (keeps visual styling unchanged)
    // - Uses a much larger radius
    // - Nearly transparent but still interactive
    if (!map.getLayer(HIT_LAYER_ID)) {
      map.addLayer({
        id: HIT_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        "source-layer": SOURCE_LAYER,
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            6, 12,
            9, 18,
            12, 26
          ],
          "circle-color": "#000000",
          "circle-opacity": 0.001,
        },
      });
    }
  }

  function updateMetricPaint() {
    const metricProp = METRICS[state.metric].prop;
    const metricNum = safeToNumberExpr(metricProp);

    if (map.getLayer(HEAT_LAYER_ID)) {
      map.setPaintProperty(HEAT_LAYER_ID, "heatmap-weight", [
        "interpolate", ["linear"], metricNum,
        0, 0,
        500, 0.25,
        2000, 0.6,
        10000, 1
      ]);
    }
  }

  // =========================
  // Apply / Clear
  // =========================
  function applyFilters() {
    state.branch = els.branchSelect?.value ?? "__ALL__";
    state.group = els.groupSelect?.value ?? "__ALL__";

    state.startKey = dateToKey(els.startDate?.value);
    state.endKey = dateToKey(els.endDate?.value);

    if (state.startKey != null && state.endKey != null && state.startKey > state.endKey) {
      const tmp = state.startKey;
      state.startKey = state.endKey;
      state.endKey = tmp;

      const s = els.startDate.value;
      els.startDate.value = els.endDate.value;
      els.endDate.value = s;
    }

    const filterExpr = buildFilterExpr();
     // ---- DEBUG ----
console.log("[WLHeatmap][DEBUG] state:", JSON.stringify(state));
console.log("[WLHeatmap][DEBUG] filterExpr:", JSON.stringify(filterExpr));
// --------------

    try {
  if (map.getLayer(HEAT_LAYER_ID)) map.setFilter(HEAT_LAYER_ID, filterExpr);
} catch (e) {
  console.error("[WLHeatmap][DEBUG] setFilter wl-heat failed", e, filterExpr);
}

try {
  if (map.getLayer(POINT_LAYER_ID)) map.setFilter(POINT_LAYER_ID, filterExpr);
} catch (e) {
  console.error("[WLHeatmap][DEBUG] setFilter wl-points failed", e, filterExpr);
}

try {
  if (map.getLayer(HIT_LAYER_ID)) map.setFilter(HIT_LAYER_ID, filterExpr);
} catch (e) {
  console.error("[WLHeatmap][DEBUG] setFilter wl-points-hit failed", e, filterExpr);
}

  // Date filter note (tileset must include numeric `SaleDateKey` to enable date filtering)
  const canDateFilterNow = (state.startKey != null || state.endKey != null) ? tilesetHasSaleDateKey() : true;
  const dateNote = (canDateFilterNow ? "" : " (SaleDateKey not visible — using SaleDate string filter)");


    setStatus(
      `Metric: ${METRICS[state.metric].label} • ` +
      `Branch: ${state.branch === "__ALL__" ? "All" : state.branch} • ` +
      `Group: ${state.group === "__ALL__" ? "All" : state.group} • ` +
      `Dates: ${state.startKey ?? "…"} → ${state.endKey ?? "…"}${dateNote}`
    );

    try { window.__WLFilterDrawer__?.updateSummary?.(); } catch {}

    log("Applied filters • Metric:", METRICS[state.metric].label);
  }

  function clearFilters() {
    if (els.branchSelect) els.branchSelect.value = "__ALL__";
    if (els.groupSelect) els.groupSelect.value = "__ALL__";
    if (els.startDate) els.startDate.value = "";
    if (els.endDate) els.endDate.value = "";

    state.branch = "__ALL__";
    state.group = "__ALL__";
    state.startKey = null;
    state.endKey = null;

    applyFilters();
    log("Cleared filters");
  }

  function wireUI() {
    els.metricSales?.addEventListener("click", () => {
      setMetricUI("sales");
      updateMetricPaint();
      applyFilters();
    });

    els.metricTickets?.addEventListener("click", () => {
      setMetricUI("tickets");
      updateMetricPaint();
      applyFilters();
    });

    els.applyBtn?.addEventListener("click", () => { applyFilters(); try { window.__WLFilterDrawer__?.setOpen(false); } catch {} });
    els.clearBtn?.addEventListener("click", () => { clearFilters(); try { window.__WLFilterDrawer__?.setOpen(false); } catch {} });

    els.startDate?.addEventListener("keydown", (e) => { if (e.key === "Enter") applyFilters(); });
    els.endDate?.addEventListener("keydown", (e) => { if (e.key === "Enter") applyFilters(); });

    // =========================
    // Quick date presets (no HTML edits required)
    // =========================
    function pad2(n){ return String(n).padStart(2,"0"); }
    function toInputDate(d){
      return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
    }
    function startOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
    function endOfMonth(d){ return new Date(d.getFullYear(), d.getMonth()+1, 0); }

    function setDateInputs(startDt, endDt, { apply = true } = {}) {
      if (!els.startDate || !els.endDate) return;
      els.startDate.value = startDt ? toInputDate(startDt) : "";
      els.endDate.value = endDt ? toInputDate(endDt) : "";
      if (apply) applyFilters();
    }

    function ensureQuickDateBar(){
      if (!els.startDate || !els.endDate) return;

      // avoid duplicates if BisTrack re-inits
      if (document.getElementById("wlQuickDates")) return;

      // Some BisTrack themes override button text colors (making labels appear blank).
      // Inject a tiny style block to force readable button text.
      if (!document.getElementById("wlQuickDatesStyle")) {
        const st = document.createElement("style");
        st.id = "wlQuickDatesStyle";
        st.textContent = `
          #wlQuickDates button{
            color:#111827 !important;
            font-size:12px !important;
            line-height:1.2 !important;
            font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif !important;
            background:#ffffff !important;
            border:1px solid rgba(0,0,0,.15) !important;
            border-radius:8px !important;
            padding:6px 10px !important;
            cursor:pointer !important;
            -webkit-text-fill-color:#111827 !important;
          }
          #wlQuickDates button:hover{
            background:#f3f4f6 !important;
          }
        `;
        document.head.appendChild(st);
      }

      const bar = document.createElement("div");
      bar.id = "wlQuickDates";

      bar.style.display = "flex";
      bar.style.flexWrap = "wrap";
      bar.style.gap = "8px";
      bar.style.marginTop = "8px";

      const mkBtn = (label, onClick) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.style.padding = "6px 10px";
        b.style.border = "1px solid rgba(0,0,0,.15)";
        b.style.borderRadius = "8px";
        b.style.background = "#fff";
        b.style.cursor = "pointer";
        b.style.color = "#111827";
        b.style.fontSize = "12px";
        b.style.lineHeight = "1.2";
        b.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
        b.style.webkitTextFillColor = "#111827";
        b.addEventListener("click", onClick);
        return b;
      };

      bar.appendChild(mkBtn("Current Year", () => {
        const y = new Date().getFullYear();
        setDateInputs(new Date(y, 0, 1), new Date(y, 11, 31));
      }));

      bar.appendChild(mkBtn("Last Year", () => {
        const y = new Date().getFullYear() - 1;
        setDateInputs(new Date(y, 0, 1), new Date(y, 11, 31));
      }));

      bar.appendChild(mkBtn("Current Month", () => {
        const d = new Date();
        setDateInputs(startOfMonth(d), endOfMonth(d));
      }));

      bar.appendChild(mkBtn("Previous Month", () => {
        const d = new Date();
        const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
        setDateInputs(startOfMonth(prev), endOfMonth(prev));
      }));

      bar.appendChild(mkBtn("YTD", () => {
        const d = new Date();
        setDateInputs(new Date(d.getFullYear(), 0, 1), d);
      }));

      bar.appendChild(mkBtn("Clear Dates", () => {
        setDateInputs(null, null);
      }));

      // Insert right after the end date input (best “no HTML edits” anchor)
      els.endDate.parentElement?.appendChild(bar);
    }

    // build the bar once when wiring UI
    ensureQuickDateBar();
  }

  // =========================
  // Startup
  // =========================
  (async function init() {
    await loadFilters();
    wireUI();

    
// =========================
// Hover tooltip on points
// =========================
function wirePointHoverTooltip() {
  if (!map) return;

  // Avoid double-binding if load re-runs in dev/hot reload scenarios
  if (wirePointHoverTooltip._bound) return;
  wirePointHoverTooltip._bound = true;

  const hoverPopup = new mapboxgl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: "320px",
  });

  const fmtMoney = (v) => {
    const n = Number(v);
    if (!isFinite(n)) return "$0.00";
    return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
  };

  const fmtNum = (v) => {
    const n = Number(v);
    if (!isFinite(n)) return "0";
    return n.toLocaleString();
  };

  const getProp = (p, key) => (p && p[key] != null ? p[key] : undefined);

  const bindHandlers = () => {
    if (!map.getLayer(HIT_LAYER_ID) || !map.getLayer(POINT_LAYER_ID)) return false;

    map.on("mouseenter", HIT_LAYER_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });

    map.on("mouseleave", HIT_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
      hoverPopup.remove();
    });

    // Click-to-show tooltip (more reliable + lighter than hover in BisTrack embedded dashboards)
map.on("click", HIT_LAYER_ID, (e) => {
  const f = e.features && e.features[0];
  if (!f) return;

  const p0 = f.properties || {};
  const zip = getProp(p0, "Zip5") ?? "—";
  const branch = getProp(p0, "BranchName") ?? "—";

  // Aggregate across currently rendered + filtered features in the viewport (fast enough on click)
  const feats = map.queryRenderedFeatures({ layers: [POINT_LAYER_ID] }) || [];

  let ticketsSum = 0;
  let salesSum = 0;
  let profitSum = 0;
  const byGroup = new Map();
  let minDate = null;
  let maxDate = null;

  for (const ft of feats) {
    const p = ft.properties || {};
    const z = getProp(p, "Zip5");
    const b = getProp(p, "BranchName");
    if (String(z) !== String(zip)) continue;
    if (String(b) !== String(branch)) continue;

    const t = Number(getProp(p, "TicketCount")) || 0;
    const s = Number(getProp(p, "TotalSales")) || 0;
    const pr = Number(getProp(p, "TotalProfit")) || 0;

    ticketsSum += t;
    salesSum += s;
    profitSum += pr;

    if (state.group === "__ALL__") {
      const g = String(getProp(p, "ProductGroupLevel1") ?? "—");
      const cur = byGroup.get(g) || { tickets: 0, sales: 0, profit: 0 };
      cur.tickets += t;
      cur.sales += s;
      cur.profit += pr;
      byGroup.set(g, cur);
    }

    const sd =
      getProp(p, BOM_SALEDATE_FIELD) ??
      getProp(p, "SaleDate") ??
      getProp(p, "\ufeffSaleDateISO") ??
      getProp(p, "SaleDateISO") ??
      null;

    if (sd) {
      const dt = new Date(String(sd));
      if (!isNaN(dt.getTime())) {
        if (!minDate || dt < minDate) minDate = dt;
        if (!maxDate || dt > maxDate) maxDate = dt;
      }
    }
  }

  const dateLine = (() => {
    if (minDate && maxDate) {
      const a = formatMDY(minDate);
      const b = formatMDY(maxDate);
      return (a === b) ? a : `${a} → ${b}`;
    }
    const clickedDate =
      getProp(p0, BOM_SALEDATE_FIELD) ??
      getProp(p0, "SaleDate") ??
      getProp(p0, "\ufeffSaleDateISO") ??
      getProp(p0, "SaleDateISO") ??
      "—";
    return clickedDate;
  })();

  // Breakdown (top 6 groups by sales)
  let breakdownHtml = "";
  if (state.group === "__ALL__" && byGroup.size) {
    const rows = Array.from(byGroup.entries())
      .map(([g, v]) => ({ g, ...v }))
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 6);

    breakdownHtml =
      `<div style="margin-top:10px; font-size:12px;">` +
      `<div style="font-weight:700; margin-bottom:6px;">Top groups (viewport)</div>` +
      rows.map(r =>
        `<div style="display:flex; justify-content:space-between; gap:10px;">` +
          `<span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;">${r.g}</span>` +
          `<span>${fmtMoney(r.sales)}</span>` +
        `</div>`
      ).join("") +
      `</div>`;
  }

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;">
      <div style="font-weight:700; font-size:13px; margin-bottom:6px;">${zip} • ${branch}</div>
      <div style="font-size:12px; opacity:.9; margin-bottom:8px;">${dateLine}</div>
      <div style="font-size:12px; margin-bottom:8px;">
        <b>Scope:</b> ${state.group === "__ALL__" ? "All groups" : state.group} • ${state.branch === "__ALL__" ? "All branches" : state.branch}
      </div>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; font-size:12px;">
        <div><b>Tickets</b><br>${fmtNum(ticketsSum)}</div>
        <div><b>Sales</b><br>${fmtMoney(salesSum)}</div>
        <div><b>Profit</b><br>${fmtMoney(profitSum)}</div>
      </div>
      ${breakdownHtml}
      <div style="margin-top:8px; font-size:11px; opacity:.7;">
        Note: totals are for currently rendered points in the viewport (and respect your filters).
      </div>
    </div>
  `;

  hoverPopup.setLngLat(e.lngLat).setHTML(html).addTo(map);
});

    return true;
  };

  // Bind now if layer exists, otherwise wait until after layers are added
  if (!bindHandlers()) {
    map.once("idle", () => {
      bindHandlers();
    });
  }
}

map.on("load", () => {
      log("Map loaded. Adding layers...");
      ensureLayers();
      wirePointHoverTooltip();

      setMetricUI("sales");
      updateMetricPaint();
      applyFilters();

      log("Ready");
    });
  })();

  };

  ready(() => {
    boot().catch((err) => {
      console.error(LOG_PREFIX, "Failed to boot:", err);
      const status = document.getElementById("status");
      if (status) status.textContent = `Failed to initialize: ${err.message || err}`;
    });
  });

})();