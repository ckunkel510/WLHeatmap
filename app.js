/* =========================================================
   Woodson Zip Sales Heatmap (Mapbox GL JS)
   - Filters: Branch, Product Group, Date Range
   - Metric toggle: Sales vs Tickets
   - Reads filters.json for dropdown lists
   - Uses vector tileset for points + heatmap layers
   ========================================================= */

/** =========================
 *  1) REQUIRED CONFIG
 *  ========================= */
const MAPBOX_TOKEN = "pk.eyJ1IjoiY2t1bmtlbCIsImEiOiJjbWx1Yjc4ODIwOW51M2Zwdm15dHFodnh1In0.F2yytru7jt9khYyPziZrHw"; // <-- PUT YOUR TOKEN HERE

// Your tileset id: "username.tilesetid"
const MAPBOX_TILESET = "ckunkel.bp872kqi";

// The *source-layer* inside the tileset (this must match what Mapbox Studio shows)
// You referenced layers=MapBox-42vjbp in tilequery errors, so defaulting to that:
const MAPBOX_TILESET_SOURCE_LAYER = "MapBox-42vjbp";

// Map style
const MAP_STYLE = "mapbox://styles/mapbox/light-v11";

// Default map view (centered roughly between your stores)
const DEFAULT_CENTER = [-96.55, 30.35];
const DEFAULT_ZOOM = 7.2;

// Layer IDs we will create
const LAYER_HEAT = "wl-heat";
const LAYER_POINTS = "wl-points";
const SOURCE_ID = "wl-src";

/** =========================
 *  2) DOM HOOKS (index.html)
 *  =========================
 *  Expected element IDs:
 *  - map
 *  - branchSelect
 *  - groupSelect
 *  - startDate
 *  - endDate
 *  - metricSales
 *  - metricTickets
 *  - applyBtn
 *  - clearBtn
 *  - statusText (optional)
 */
const el = {
  map: document.getElementById("map"),
  branch: document.getElementById("branchSelect"),
  group: document.getElementById("groupSelect"),
  start: document.getElementById("startDate"),
  end: document.getElementById("endDate"),
  metricSales: document.getElementById("metricSales"),
  metricTickets: document.getElementById("metricTickets"),
  apply: document.getElementById("applyBtn"),
  clear: document.getElementById("clearBtn"),
  status: document.getElementById("statusText")
};

function log(...args) {
  console.log("app.js: [WLHeatmap]", ...args);
  if (el.status) el.status.textContent = args.join(" ");
}

/** =========================
 *  3) STATE
 *  ========================= */
const state = {
  metric: "Sales", // "Sales" | "Tickets"
  branches: [],
  groups: [],
  // filter selections:
  branchSel: "ALL",
  groupSel: "ALL",
  startKey: null, // integer yyyymmdd
  endKey: null
};

/** =========================
 *  4) HELPERS
 *  ========================= */

// Convert yyyy-mm-dd (from <input type="date">) into int yyyymmdd
function dateToKey(dateStr) {
  if (!dateStr) return null;
  // dateStr is "YYYY-MM-DD"
  const y = dateStr.slice(0, 4);
  const m = dateStr.slice(5, 7);
  const d = dateStr.slice(8, 10);
  const keyStr = `${y}${m}${d}`;
  const n = Number(keyStr);
  return Number.isFinite(n) ? n : null;
}

function setSelectOptions(selectEl, values, includeAll = true) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  if (includeAll) {
    const opt = document.createElement("option");
    opt.value = "ALL";
    opt.textContent = "All";
    selectEl.appendChild(opt);
  }
  values.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  });
}

// Returns a Mapbox expression that converts a feature property into a safe number.
// Handles: null, "", "$1,234.50", " 16.15 ", "1,234"
function numField(fieldName) {
  return [
    "coalesce",
    [
      "to-number",
      [
        "replace",
        ["replace", ["replace", ["to-string", ["get", fieldName]], ",", ""], "$", ""],
        " ",
        ""
      ]
    ],
    0
  ];
}

function metricExpr() {
  // Returns numeric value expression based on state.metric
  return state.metric === "Tickets" ? numField("TicketCount") : numField("TotalSales");
}

function heatWeightExpr() {
  // Weight function: ln(1 + metric)
  return ["ln", ["+", 1, metricExpr()]];
}

function pointsRadiusExpr() {
  // Circle radius ramp; based on ln metric
  const lnMetric = heatWeightExpr();
  return ["interpolate", ["linear"], lnMetric, 0, 2, 3, 4, 6, 8, 9, 14];
}

function heatIntensityExpr() {
  // Heatmap intensity ramp; based on ln metric
  const lnMetric = heatWeightExpr();
  return ["interpolate", ["linear"], lnMetric, 0, 0, 8, 1];
}

function buildFilterExpression() {
  // Mapbox filter expression for the source layers
  // We will use:
  // - BranchName
  // - ProductGroupLevel1
  // - SaleDateKey (int)
  //
  // Return an "all" expression combining conditions.

  const filters = ["all"];

  // Branch
  if (state.branchSel && state.branchSel !== "ALL") {
    filters.push(["==", ["get", "BranchName"], state.branchSel]);
  }

  // Product group
  if (state.groupSel && state.groupSel !== "ALL") {
    filters.push(["==", ["get", "ProductGroupLevel1"], state.groupSel]);
  }

  // Date range (handles start-only or end-only)
  if (Number.isFinite(state.startKey)) {
    filters.push([">=", ["to-number", ["get", "SaleDateKey"]], state.startKey]);
  }
  if (Number.isFinite(state.endKey)) {
    filters.push(["<=", ["to-number", ["get", "SaleDateKey"]], state.endKey]);
  }

  return filters;
}

/** =========================
 *  5) LOAD FILTER LISTS
 *  ========================= */
async function loadFiltersJson() {
  log("Loading filter lists...");
  try {
    const res = await fetch("./filters.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`filters.json HTTP ${res.status}`);
    const json = await res.json();

    state.branches = Array.isArray(json.branches) ? json.branches.slice() : [];
    state.groups = Array.isArray(json.groups) ? json.groups.slice() : [];

    log(`Loaded filters.json • ${state.branches.length} branches • ${state.groups.length} groups`);
    return true;
  } catch (err) {
    console.warn("[WLHeatmap] filters.json load failed; will fallback", err);
    return false;
  }
}

/**
 * Fallback: sample some rendered features after map load to build dropdowns.
 * This avoids tilequery 422 spam and works as long as some data is visible.
 */
function loadFiltersFromRenderedFeatures(map) {
  try {
    const feats = map.queryRenderedFeatures({ layers: [LAYER_POINTS] }) || [];
    const branches = new Set();
    const groups = new Set();

    feats.forEach(f => {
      const p = f.properties || {};
      if (p.BranchName) branches.add(p.BranchName);
      if (p.ProductGroupLevel1) groups.add(p.ProductGroupLevel1);
    });

    const bList = Array.from(branches).sort();
    const gList = Array.from(groups).sort();

    if (bList.length) state.branches = bList;
    if (gList.length) state.groups = gList;

    log("Loaded filters from visible data (fallback)");
  } catch (e) {
    console.warn("[WLHeatmap] fallback filter sampling failed", e);
  }
}

/** =========================
 *  6) APPLY / CLEAR
 *  ========================= */
function readUiIntoState() {
  state.branchSel = el.branch ? el.branch.value : "ALL";
  state.groupSel = el.group ? el.group.value : "ALL";
  state.startKey = dateToKey(el.start ? el.start.value : "");
  state.endKey = dateToKey(el.end ? el.end.value : "");
}

function applyFiltersToMap(map) {
  const filterExpr = buildFilterExpression();

  // Apply to both layers
  if (map.getLayer(LAYER_HEAT)) map.setFilter(LAYER_HEAT, filterExpr);
  if (map.getLayer(LAYER_POINTS)) map.setFilter(LAYER_POINTS, filterExpr);

  // Update paint based on metric
  if (map.getLayer(LAYER_HEAT)) {
    map.setPaintProperty(LAYER_HEAT, "heatmap-intensity", heatIntensityExpr());
    map.setPaintProperty(LAYER_HEAT, "heatmap-weight", heatWeightExpr());
  }
  if (map.getLayer(LAYER_POINTS)) {
    map.setPaintProperty(LAYER_POINTS, "circle-radius", pointsRadiusExpr());
  }

  log(`Applied filters • Metric: ${state.metric}`);
}

function clearUi() {
  if (el.branch) el.branch.value = "ALL";
  if (el.group) el.group.value = "ALL";
  if (el.start) el.start.value = "";
  if (el.end) el.end.value = "";

  // Default metric to Sales
  state.metric = "Sales";
  if (el.metricSales) el.metricSales.checked = true;
  if (el.metricTickets) el.metricTickets.checked = false;

  // Reset state selection
  state.branchSel = "ALL";
  state.groupSel = "ALL";
  state.startKey = null;
  state.endKey = null;
}

/** =========================
 *  7) INIT MAP + LAYERS
 *  ========================= */
function initMap() {
  mapboxgl.accessToken = MAPBOX_TOKEN;

  const map = new mapboxgl.Map({
    container: "map",
    style: MAP_STYLE,
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM
  });

  // Expose for console debugging (fixes your “map.queryRenderedFeatures…” issue)
  window.WL_MAP = map;

  map.addControl(new mapboxgl.NavigationControl(), "top-right");

  map.on("load", () => {
    log("Map loaded. Adding layers...");

    // Add vector tileset source
    map.addSource(SOURCE_ID, {
      type: "vector",
      url: `mapbox://${MAPBOX_TILESET}`
    });

    // Heatmap layer
    map.addLayer(
      {
        id: LAYER_HEAT,
        type: "heatmap",
        source: SOURCE_ID,
        "source-layer": MAPBOX_TILESET_SOURCE_LAYER,
        maxzoom: 12,
        paint: {
          // These will be updated dynamically on apply, but set defaults now
          "heatmap-weight": heatWeightExpr(),
          "heatmap-intensity": heatIntensityExpr(),
          "heatmap-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            6, 10,
            8, 18,
            10, 28,
            12, 40
          ],
          "heatmap-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            6, 0.85,
            12, 0.55
          ]
        }
      },
      // place under labels if possible
      "waterway-label"
    );

    // Points layer
    map.addLayer({
      id: LAYER_POINTS,
      type: "circle",
      source: SOURCE_ID,
      "source-layer": MAPBOX_TILESET_SOURCE_LAYER,
      minzoom: 6,
      paint: {
        "circle-radius": pointsRadiusExpr(),
        "circle-opacity": 0.55
      }
    });

    // If filters.json failed, sample visible data after first render
    // (but only if we don't already have lists)
    setTimeout(() => {
      if (!state.branches.length || !state.groups.length) {
        loadFiltersFromRenderedFeatures(map);
        setSelectOptions(el.branch, state.branches, true);
        setSelectOptions(el.group, state.groups, true);
      }
    }, 900);

    // Start with defaults applied
    applyFiltersToMap(map);
    log("Ready");
  });

  return map;
}

/** =========================
 *  8) WIRE UI EVENTS
 *  ========================= */
function wireUi(map) {
  // Metric radio buttons
  if (el.metricSales) {
    el.metricSales.addEventListener("change", () => {
      if (el.metricSales.checked) {
        state.metric = "Sales";
        log("Metric set to Sales");
        applyFiltersToMap(map);
      }
    });
  }
  if (el.metricTickets) {
    el.metricTickets.addEventListener("change", () => {
      if (el.metricTickets.checked) {
        state.metric = "Tickets";
        log("Metric set to Tickets");
        applyFiltersToMap(map);
      }
    });
  }

  // Apply button
  if (el.apply) {
    el.apply.addEventListener("click", () => {
      readUiIntoState();
      applyFiltersToMap(map);
    });
  }

  // Clear button
  if (el.clear) {
    el.clear.addEventListener("click", () => {
      clearUi();
      applyFiltersToMap(map);
    });
  }

  // Optional: apply automatically when dropdowns change (nice UX)
  if (el.branch) {
    el.branch.addEventListener("change", () => {
      readUiIntoState();
      applyFiltersToMap(map);
    });
  }
  if (el.group) {
    el.group.addEventListener("change", () => {
      readUiIntoState();
      applyFiltersToMap(map);
    });
  }
}

/** =========================
 *  9) BOOT
 *  ========================= */
(async function boot() {
  log("Booting...");

  const gotFilters = await loadFiltersJson();

  // Populate selects immediately from filters.json
  if (gotFilters) {
    setSelectOptions(el.branch, state.branches, true);
    setSelectOptions(el.group, state.groups, true);
  } else {
    // show placeholders; will fill after map loads via fallback sampling
    setSelectOptions(el.branch, [], true);
    setSelectOptions(el.group, [], true);
  }

  // Default metric state in UI
  if (el.metricSales) el.metricSales.checked = true;
  if (el.metricTickets) el.metricTickets.checked = false;

  const map = initMap();
  wireUi(map);
})();
