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
    container: "map",
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

  // Date filter note (tileset must include numeric `SaleDateKey` to enable date filtering)
  const canDateFilterNow = (state.startKey != null || state.endKey != null) ? tilesetHasSaleDateKey() : true;
  const dateNote = (canDateFilterNow ? "" : " (SaleDateKey not visible — using SaleDate string filter)");


    setStatus(
      `Metric: ${METRICS[state.metric].label} • ` +
      `Branch: ${state.branch === "__ALL__" ? "All" : state.branch} • ` +
      `Group: ${state.group === "__ALL__" ? "All" : state.group} • ` +
      `Dates: ${state.startKey ?? "…"} → ${state.endKey ?? "…"}${dateNote}`
    );

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

    els.applyBtn?.addEventListener("click", () => applyFilters());
    els.clearBtn?.addEventListener("click", () => clearFilters());

    els.startDate?.addEventListener("keydown", (e) => { if (e.key === "Enter") applyFilters(); });
    els.endDate?.addEventListener("keydown", (e) => { if (e.key === "Enter") applyFilters(); });
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
    closeButton: false,
    closeOnClick: false,
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
    if (!map.getLayer(POINT_LAYER_ID)) return false;

    map.on("mouseenter", POINT_LAYER_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });

    map.on("mouseleave", POINT_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
      hoverPopup.remove();
    });

    map.on("mousemove", POINT_LAYER_ID, (e) => {
      const f = e.features && e.features[0];
      if (!f) return;

      const p = f.properties || {};

      const branch = getProp(p, "BranchName") ?? "—";
      const zip = getProp(p, "Zip5") ?? "—";
      const group = getProp(p, "ProductGroupLevel1") ?? "—";

      // Dates: prefer BOM SaleDate (M/D/YYYY), fall back to ISO if present
      const saleDate =
        getProp(p, BOM_SALEDATE_FIELD) ??
        getProp(p, "SaleDate") ??
        getProp(p, "\ufeffSaleDateISO") ??
        getProp(p, "SaleDateISO") ??
        "—";

      const tickets = getProp(p, "TicketCount") ?? 0;
      const sales = getProp(p, "TotalSales") ?? 0;
      const profit = getProp(p, "TotalProfit") ?? 0;

      // Coordinates: prefer geometry point, fall back to Lon/Lat props if needed
      let coords = null;
      if (f.geometry && f.geometry.type === "Point" && Array.isArray(f.geometry.coordinates)) {
        coords = f.geometry.coordinates.slice();
      } else {
        const lon = Number(getProp(p, "Lon"));
        const lat = Number(getProp(p, "Lat"));
        if (isFinite(lon) && isFinite(lat)) coords = [lon, lat];
      }
      if (!coords) return;

      // Handle world-wrap
      while (Math.abs(e.lngLat.lng - coords[0]) > 180) {
        coords[0] += e.lngLat.lng > coords[0] ? 360 : -360;
      }

      const html = `
        <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;">
          <div style="font-weight:700; font-size:13px; margin-bottom:6px;">${zip} • ${branch}</div>
          <div style="font-size:12px; opacity:.9; margin-bottom:8px;">${saleDate}</div>
          <div style="font-size:12px; margin-bottom:8px;"><b>Group:</b> ${group}</div>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; font-size:12px;">
            <div><b>Tickets</b><br>${fmtNum(tickets)}</div>
            <div><b>Sales</b><br>${fmtMoney(sales)}</div>
            <div><b>Profit</b><br>${fmtMoney(profit)}</div>
          </div>
        </div>
      `;

      hoverPopup.setLngLat(coords).setHTML(html).addTo(map);
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
})();
