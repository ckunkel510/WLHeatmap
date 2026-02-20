/* =========================================================
   WLHeatmap app.js (patched)
   - No Tilequery calls (fixes 422 + disappearing points)
   - Vector tiles source + style layers (heatmap + points)
   - Filters: BranchName, ProductGroupLevel1, Date range
   - Metric toggle: Sales vs Tickets
   - Clear button resets UI + map
   ========================================================= */

/* ========= CONFIG ========= */
const WL = {
  // IMPORTANT: Set these to YOUR Mapbox tileset + source-layer
  // tileset examples:
  //   "ckunkel.bp872kqi"  (classic)
  //   "ckunkel.yourTilesetId"
  tilesetId: "ckunkel.bp872kqi",

  // sourceLayer MUST match the layer name inside the tileset (Mapbox Studio -> Tilesets -> Inspect)
  // You had "MapBox-42vjbp" in your console; keep that if that is correct.
  sourceLayer: "MapBox-42vjbp",

  // UI element IDs (must match index.html)
  ui: {
    branchSelect: "branchSelect",
    groupSelect: "groupSelect",
    metricSelect: "metricSelect", // optional (Sales/Tickets). If missing, fallback to buttons.
    metricSalesBtn: "metricSalesBtn", // optional
    metricTicketsBtn: "metricTicketsBtn", // optional
    startDate: "startDate",
    endDate: "endDate",
    clearBtn: "clearFiltersBtn",
    status: "statusText",
  },

  // Map defaults
  map: {
    containerId: "map",
    style: "mapbox://styles/mapbox/light-v11",
    center: [-96.5, 30.4], // Texas-ish
    zoom: 6,
  },

  // Data fields in your tiles
  fields: {
    branch: "BranchName",
    group: "ProductGroupLevel1",
    // safest for filtering:
    dateKey: "SaleDateKey", // numeric yyyymmdd
    // metrics:
    totalSales: "TotalSales",
    ticketCount: "TicketCount",
  },
};

/* ========= HELPERS ========= */
function $(id) {
  return document.getElementById(id);
}

function setStatus(msg) {
  const el = $(WL.ui.status);
  if (el) el.textContent = msg;
  console.log("[WLHeatmap]", msg);
}

// Expecting input type="date" => "YYYY-MM-DD"
function dateToKey(iso) {
  if (!iso) return null;
  const parts = iso.split("-");
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!y || !m || !d) return null;
  return y * 10000 + m * 100 + d;
}

function normalizeText(v) {
  return (v ?? "").toString().trim();
}

function safeSetSelectValue(selectEl, value) {
  if (!selectEl) return;
  const v = value ?? "";
  // If value doesn't exist as an option, set to "" (All)
  const has = Array.from(selectEl.options).some((o) => o.value === v);
  selectEl.value = has ? v : "";
}

/* ========= MAP INIT ========= */
let map;
let currentMetric = "sales"; // "sales" | "tickets"

function getMetricField() {
  return currentMetric === "tickets" ? WL.fields.ticketCount : WL.fields.totalSales;
}

function getMetricLabel() {
  return currentMetric === "tickets" ? "Tickets" : "Sales";
}

function buildFilterFromUI() {
  const branchEl = $(WL.ui.branchSelect);
  const groupEl = $(WL.ui.groupSelect);
  const startEl = $(WL.ui.startDate);
  const endEl = $(WL.ui.endDate);

  const branch = normalizeText(branchEl?.value);
  const group = normalizeText(groupEl?.value);

  const startKey = dateToKey(startEl?.value);
  const endKey = dateToKey(endEl?.value);

  const clauses = [];

  // Branch filter
  if (branch) clauses.push(["==", ["get", WL.fields.branch], branch]);

  // Product group filter
  if (group) clauses.push(["==", ["get", WL.fields.group], group]);

  // Date range filter using numeric SaleDateKey (robust)
  // Include if user entered date(s)
  const dateKeyExpr = ["to-number", ["get", WL.fields.dateKey], 0];

  if (startKey !== null) clauses.push([">=", dateKeyExpr, startKey]);
  if (endKey !== null) clauses.push(["<=", dateKeyExpr, endKey]);

  // If no clauses => allow all
  return clauses.length ? ["all", ...clauses] : true;
}

function applyFiltersToLayers() {
  if (!map) return;
  const filter = buildFilterFromUI();

  // Apply to both layers
  if (map.getLayer("wl-heat")) map.setFilter("wl-heat", filter);
  if (map.getLayer("wl-points")) map.setFilter("wl-points", filter);

  setStatus(`Applied filters • Metric: ${getMetricLabel()}`);
}

function applyMetricStyling() {
  if (!map) return;

  const field = getMetricField();

  // Weight expression (log scale so it doesn't blob everything together)
  const weight = [
    "interpolate",
    ["linear"],
    ["ln", ["+", 1, ["to-number", ["get", field], 0]]],
    0,
    0,
    8,
    1,
  ];

  // Heatmap layers
  if (map.getLayer("wl-heat")) {
    map.setPaintProperty("wl-heat", "heatmap-weight", weight);

    // Slightly tighter heatmap so it doesn’t “smear everything together”
    map.setPaintProperty("wl-heat", "heatmap-radius", [
      "interpolate",
      ["linear"],
      ["zoom"],
      5,
      12,
      9,
      20,
      12,
      26,
    ]);

    map.setPaintProperty("wl-heat", "heatmap-intensity", [
      "interpolate",
      ["linear"],
      ["zoom"],
      5,
      0.6,
      10,
      1.0,
      13,
      1.3,
    ]);
  }

  // Points layer size based on metric (also log scale)
  if (map.getLayer("wl-points")) {
    map.setPaintProperty("wl-points", "circle-radius", [
      "interpolate",
      ["linear"],
      ["ln", ["+", 1, ["to-number", ["get", field], 0]]],
      0,
      2,
      6,
      8,
      9,
      14,
    ]);

    map.setPaintProperty("wl-points", "circle-opacity", 0.8);
  }

  setStatus(`Metric set to ${getMetricLabel()}`);
}

/* ========= FILTER LISTS ========= */
async function loadFiltersJson() {
  setStatus("Loading filter lists...");

  try {
    // MUST exist at WLHeatmap/filters.json (you were getting 404)
    const res = await fetch("filters.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`filters.json HTTP ${res.status}`);
    const json = await res.json();

    // Accept either:
    // { branches:[{value:"Brenham"}], productGroups:[{value:"Automotive"}] }
    // or { branches:["Brenham"], productGroups:["Automotive"] }
    const branchesRaw = json.branches ?? [];
    const groupsRaw = json.productGroups ?? [];

    const branches =
      branchesRaw.length && typeof branchesRaw[0] === "string"
        ? branchesRaw
        : branchesRaw.map((x) => x.value);

    const groups =
      groupsRaw.length && typeof groupsRaw[0] === "string"
        ? groupsRaw
        : groupsRaw.map((x) => x.value);

    populateSelect($(WL.ui.branchSelect), branches, "All branches");
    populateSelect($(WL.ui.groupSelect), groups, "All product groups");

    setStatus(`Loaded filters.json • ${branches.length} branches • ${groups.length} groups`);
  } catch (err) {
    console.warn("[WLHeatmap] filters.json load failed:", err);
    populateSelect($(WL.ui.branchSelect), [], "All branches");
    populateSelect($(WL.ui.groupSelect), [], "All product groups");
    setStatus("filters.json missing (404). Dropdowns limited to 'All'.");
  }
}

function populateSelect(selectEl, values, allLabel) {
  if (!selectEl) return;

  const prev = selectEl.value;

  selectEl.innerHTML = "";

  // All option
  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = allLabel;
  selectEl.appendChild(optAll);

  // Values
  const dedup = Array.from(new Set(values.filter(Boolean).map((v) => v.toString().trim()))).sort((a, b) =>
    a.localeCompare(b)
  );

  for (const v of dedup) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  }

  // Restore previous selection if still valid
  safeSetSelectValue(selectEl, prev);
}

/* ========= UI WIRING ========= */
function wireUI() {
  // Dropdown change handlers
  const branchEl = $(WL.ui.branchSelect);
  const groupEl = $(WL.ui.groupSelect);
  const startEl = $(WL.ui.startDate);
  const endEl = $(WL.ui.endDate);
  const clearBtn = $(WL.ui.clearBtn);

  if (branchEl) branchEl.addEventListener("change", applyFiltersToLayers);
  if (groupEl) groupEl.addEventListener("change", applyFiltersToLayers);

  // Date fields: apply on change
  if (startEl)
    startEl.addEventListener("change", () => {
      // If start > end, clear end (prevents “blank map” confusion)
      const s = dateToKey(startEl.value);
      const e = dateToKey(endEl?.value);
      if (s !== null && e !== null && s > e && endEl) endEl.value = "";
      applyFiltersToLayers();
    });

  if (endEl)
    endEl.addEventListener("change", () => {
      const s = dateToKey(startEl?.value);
      const e = dateToKey(endEl.value);
      if (s !== null && e !== null && s > e && startEl) startEl.value = "";
      applyFiltersToLayers();
    });

  // Metric dropdown (optional)
  const metricEl = $(WL.ui.metricSelect);
  if (metricEl) {
    metricEl.addEventListener("change", () => {
      const v = normalizeText(metricEl.value).toLowerCase();
      currentMetric = v.includes("ticket") ? "tickets" : "sales";
      applyMetricStyling();
      applyFiltersToLayers();
      syncMetricButtons();
    });
  }

  // Metric buttons (optional)
  const salesBtn = $(WL.ui.metricSalesBtn);
  const ticketsBtn = $(WL.ui.metricTicketsBtn);

  if (salesBtn) {
    salesBtn.addEventListener("click", () => {
      currentMetric = "sales";
      if (metricEl) metricEl.value = "sales";
      applyMetricStyling();
      applyFiltersToLayers();
      syncMetricButtons();
    });
  }

  if (ticketsBtn) {
    ticketsBtn.addEventListener("click", () => {
      currentMetric = "tickets";
      if (metricEl) metricEl.value = "tickets";
      applyMetricStyling();
      applyFiltersToLayers();
      syncMetricButtons();
    });
  }

  // Clear button
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (branchEl) branchEl.value = "";
      if (groupEl) groupEl.value = "";
      if (startEl) startEl.value = "";
      if (endEl) endEl.value = "";

      // Reset metric to Sales by default
      currentMetric = "sales";
      if (metricEl) metricEl.value = "sales";

      applyMetricStyling();
      applyFiltersToLayers();
      syncMetricButtons();

      setStatus("Filters cleared");
    });
  }

  syncMetricButtons();
}

function syncMetricButtons() {
  const salesBtn = $(WL.ui.metricSalesBtn);
  const ticketsBtn = $(WL.ui.metricTicketsBtn);
  if (!salesBtn && !ticketsBtn) return;

  // simple active state
  if (salesBtn) salesBtn.classList.toggle("active", currentMetric === "sales");
  if (ticketsBtn) ticketsBtn.classList.toggle("active", currentMetric === "tickets");
}

/* ========= MAP LAYERS ========= */
function addDataLayers() {
  // Vector tiles source
  if (!map.getSource("wl-sales")) {
    map.addSource("wl-sales", {
      type: "vector",
      url: `mapbox://${WL.tilesetId}`,
    });
  }

  // Heatmap layer
  if (!map.getLayer("wl-heat")) {
    map.addLayer({
      id: "wl-heat",
      type: "heatmap",
      source: "wl-sales",
      "source-layer": WL.sourceLayer,
      maxzoom: 14,
      paint: {
        // defaults; metric styling will override weight/radius/intensity
        "heatmap-weight": 1,
        "heatmap-radius": 18,
        "heatmap-intensity": 1,
        "heatmap-opacity": 0.75,
      },
    });
  }

  // Points layer
  if (!map.getLayer("wl-points")) {
    map.addLayer({
      id: "wl-points",
      type: "circle",
      source: "wl-sales",
      "source-layer": WL.sourceLayer,
      minzoom: 5,
      paint: {
        "circle-radius": 5,
        "circle-opacity": 0.8,
        // Do not hardcode colors (per your preference earlier, but circles need something visible).
        // If you want it to match your old style, tell me your preferred circle color and I'll set it.
        "circle-color": "#000000",
        "circle-stroke-width": 1,
        "circle-stroke-color": "#ffffff",
      },
    });
  }

  applyMetricStyling();
  applyFiltersToLayers();
}

/* ========= BOOT ========= */
async function boot() {
  try {
    setStatus("Booting...");

    // sanity checks
    if (typeof mapboxgl === "undefined") {
      throw new Error("mapboxgl not found. Ensure Mapbox GL JS is loaded before app.js");
    }

    const container = $(WL.map.containerId);
    if (!container) throw new Error(`Map container #${WL.map.containerId} not found`);

    // Load filter lists (branches/groups)
    await loadFiltersJson();

    // Wire UI
    wireUI();

    // Init map
    map = new mapboxgl.Map({
      container: WL.map.containerId,
      style: WL.map.style,
      center: WL.map.center,
      zoom: WL.map.zoom,
    });

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");

    map.on("load", () => {
      setStatus("Map loaded. Adding layers...");
      addDataLayers();
      setStatus("Ready");
    });

    // Helpful debug: if the source-layer is wrong, you'll see zero features always.
    map.on("error", (e) => {
      console.warn("[WLHeatmap] Map error:", e?.error || e);
    });
  } catch (err) {
    console.error("[WLHeatmap] Boot error:", err);
    setStatus(`Error: ${err.message || err}`);
  }
}

document.addEventListener("DOMContentLoaded", boot);
