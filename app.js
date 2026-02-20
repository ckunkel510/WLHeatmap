/* ============================================================
   WLHeatmap • app.js (FULL FILE)
   - BranchName + ProductGroupLevel1 filters
   - Date range filter (uses SaleDateKey = yyyymmdd)
   - Metric toggle (Sales vs Tickets)
   - Apply / Clear fixed
   - Removes unsupported Mapbox expression ops (no "replace")
   ============================================================ */

/*** 1) PUT YOUR TOKEN HERE ***/
const MAPBOX_TOKEN = "pk.eyJ1IjoiY2t1bmtlbCIsImEiOiJjbWx1Yjc4ODIwOW51M2Zwdm15dHFodnh1In0.F2yytru7jt9khYyPziZrHw";

/*** 2) CONFIG YOU MAY NEED TO EDIT ***/
const CONFIG = {
  // Your Mapbox tileset id (account.tileset)
  // Example from your console: ckunkel.bp872kqi
  tilesetId: "ckunkel.bp872kqi",

  // Source-layer name inside the tileset (must match exactly)
  // If you don’t know it: Mapbox Studio -> Tilesets -> your tileset -> “Layers”
  sourceLayer: "MapBox-42vjbp", // <-- update if yours differs

  // URL to your filters.json (same folder as index.html/app.js on GitHub Pages)
  filtersUrl: "./filters.json",

  // Map start view (tweak as desired)
  center: [-96.3698, 30.6744],
  zoom: 6.3,

  // Heatmap feel (tweak)
  heatmapMaxZoom: 10,
  pointsMinZoom: 7.25
};

/*** 3) SMALL HELPERS ***/
const log = (...args) => console.log("[WLHeatmap]", ...args);

function $(id) {
  return document.getElementById(id);
}

function uniqSorted(arr) {
  return Array.from(new Set((arr || []).filter(Boolean))).sort((a, b) =>
    String(a).localeCompare(String(b))
  );
}

// input[type="date"] => "YYYY-MM-DD" -> 20260102
function dateStrToKey(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  // expects YYYY-MM-DD
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return y * 10000 + mo * 100 + d;
}

function setStatus(text) {
  const el = $("statusText") || $("status") || $("wlStatus");
  if (el) el.textContent = text;
}

function fillSelect(selectEl, values, placeholder) {
  if (!selectEl) return;
  selectEl.innerHTML = "";

  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = placeholder || "All";
  selectEl.appendChild(opt0);

  (values || []).forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  });
}

/*** 4) BOOT ***/
log("Booting...");

mapboxgl.accessToken = MAPBOX_TOKEN;

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/light-v11",
  center: CONFIG.center,
  zoom: CONFIG.zoom
});

// UI elements (ids assumed; tweak your index.html ids to match)
const branchSelect = $("branchSelect");
const groupSelect = $("groupSelect");
const startDateInput = $("startDate");
const endDateInput = $("endDate");
const metricSalesRadio = $("metricSales");
const metricTicketsRadio = $("metricTickets");
const applyBtn = $("applyBtn");
const clearBtn = $("clearBtn");

let metric = "Sales"; // "Sales" or "Tickets"

/*** 5) LOAD FILTER LISTS ***/
async function loadFiltersJson() {
  log("Loading filter lists...");
  try {
    const res = await fetch(CONFIG.filtersUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`filters.json HTTP ${res.status}`);
    const json = await res.json();

    const branches = uniqSorted(json.branches || []);
    const groups = uniqSorted(json.groups || []);

    fillSelect(branchSelect, branches, "All Branches");
    fillSelect(groupSelect, groups, "All Product Groups");

    log(`Loaded filters.json • ${branches.length} branches • ${groups.length} groups`);
  } catch (e) {
    console.warn("[WLHeatmap] Failed to load filters.json:", e);
    // Don’t hard-fail. Just leave selects as-is.
    log("Continuing without filters.json (dropdowns may be empty).");
  }
}

/*** 6) MAPBOX EXPRESSIONS ***/
// IMPORTANT: Mapbox GL JS v3 style expressions do NOT support a "replace" operator.
// So we assume your tileset properties are either numeric or numeric strings (e.g., "16.15").
// If Mapbox imported them as non-numeric (currency symbols, commas), fix the CSV export.
function numExprForField(fieldName) {
  // coalesce(to-number(get(field)), 0)
  return ["coalesce", ["to-number", ["get", fieldName]], 0];
}

function metricFieldName() {
  return metric === "Tickets" ? "TicketCount" : "TotalSales";
}

function metricLabel() {
  return metric === "Tickets" ? "Tickets" : "Sales";
}

function heatWeightExpr() {
  // ln(1 + value) mapped later by heatmap built-in kernel
  return ["ln", ["+", 1, numExprForField(metricFieldName())]];
}

function heatIntensityExpr() {
  // Let intensity ramp with zoom and data
  // interpolate(linear, zoom, 0, 0.6, 7, 1.2, 10, 2.0, 12, 3.0)
  return ["interpolate", ["linear"], ["zoom"], 0, 0.6, 7, 1.2, 10, 2.0, 12, 3.0];
}

function heatRadiusExpr() {
  // Smooth radius by zoom
  return ["interpolate", ["linear"], ["zoom"], 4, 12, 7, 20, 10, 34, 12, 48];
}

function heatColorExpr() {
  // You said you like this look — keep it clean with a smooth ramp
  return [
    "interpolate",
    ["linear"],
    ["heatmap-density"],
    0, "rgba(0,0,0,0)",
    0.10, "rgba(0, 145, 255, 0.25)",
    0.25, "rgba(0, 145, 255, 0.55)",
    0.45, "rgba(0, 200, 120, 0.65)",
    0.65, "rgba(255, 220, 0, 0.75)",
    0.85, "rgba(255, 120, 0, 0.85)",
    1.00, "rgba(255, 0, 0, 0.95)"
  ];
}

function circleRadiusExpr() {
  // Circle size should reflect data but not explode
  // interpolate(linear, ln(1+value), 0, 2, 4, 6, 8, 10)
  return [
    "interpolate",
    ["linear"],
    ["ln", ["+", 1, numExprForField(metricFieldName())]],
    0, 2,
    3, 4,
    6, 7,
    9, 11
  ];
}

function circleOpacityExpr() {
  return ["interpolate", ["linear"], ["zoom"], CONFIG.pointsMinZoom, 0.0, CONFIG.pointsMinZoom + 0.75, 0.9];
}

/*** 7) BUILD FILTER FOR LAYERS ***/
function buildLayerFilter() {
  const filters = ["all"];

  const branch = branchSelect ? branchSelect.value : "";
  const group = groupSelect ? groupSelect.value : "";

  const startKey = dateStrToKey(startDateInput ? startDateInput.value : "");
  const endKey = dateStrToKey(endDateInput ? endDateInput.value : "");

  // BranchName filter
  if (branch) {
    filters.push(["==", ["get", "BranchName"], branch]);
  }

  // ProductGroupLevel1 filter
  if (group) {
    filters.push(["==", ["get", "ProductGroupLevel1"], group]);
  }

  // Date filter: compare against SaleDateKey (yyyymmdd)
  // coalesce(to-number(get(SaleDateKey)), 0)
  const saleDateKeyExpr = ["coalesce", ["to-number", ["get", "SaleDateKey"]], 0];

  if (startKey != null) {
    filters.push([">=", saleDateKeyExpr, startKey]);
  }
  if (endKey != null) {
    filters.push(["<=", saleDateKeyExpr, endKey]);
  }

  return filters;
}

/*** 8) APPLY FILTERS + METRIC ***/
function applyFilters() {
  const f = buildLayerFilter();

  // Apply filters
  if (map.getLayer("wl-heat")) map.setFilter("wl-heat", f);
  if (map.getLayer("wl-points")) map.setFilter("wl-points", f);

  // Update paint props for metric changes
  // Heatmap
  if (map.getLayer("wl-heat")) {
    map.setPaintProperty("wl-heat", "heatmap-weight", heatWeightExpr());
    map.setPaintProperty("wl-heat", "heatmap-intensity", heatIntensityExpr());
    map.setPaintProperty("wl-heat", "heatmap-radius", heatRadiusExpr());
    map.setPaintProperty("wl-heat", "heatmap-color", heatColorExpr());
  }

  // Points
  if (map.getLayer("wl-points")) {
    map.setPaintProperty("wl-points", "circle-radius", circleRadiusExpr());
    map.setPaintProperty("wl-points", "circle-opacity", circleOpacityExpr());
  }

  log(`Applied filters • Metric: ${metricLabel()}`);
  setStatus(`Metric: ${metricLabel()}`);
}

/*** 9) CLEAR ***/
function clearFilters() {
  if (branchSelect) branchSelect.value = "";
  if (groupSelect) groupSelect.value = "";
  if (startDateInput) startDateInput.value = "";
  if (endDateInput) endDateInput.value = "";

  // Default metric to Sales (optional)
  metric = "Sales";
  if (metricSalesRadio) metricSalesRadio.checked = true;
  if (metricTicketsRadio) metricTicketsRadio.checked = false;

  applyFilters();
}

/*** 10) ADD LAYERS ***/
map.on("load", async () => {
  await loadFiltersJson();

  log("Map loaded. Adding layers...");

  // Vector source for your tileset
  const sourceId = "wl-src";
  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: "vector",
      url: `mapbox://${CONFIG.tilesetId}`
    });
  }

  // Heatmap layer
  if (!map.getLayer("wl-heat")) {
    map.addLayer(
      {
        id: "wl-heat",
        type: "heatmap",
        source: sourceId,
        "source-layer": CONFIG.sourceLayer,
        maxzoom: CONFIG.heatmapMaxZoom,
        filter: buildLayerFilter(),
        paint: {
          "heatmap-weight": heatWeightExpr(),
          "heatmap-intensity": heatIntensityExpr(),
          "heatmap-radius": heatRadiusExpr(),
          "heatmap-color": heatColorExpr(),
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.95, CONFIG.heatmapMaxZoom, 0.55]
        }
      },
      // place below labels if possible
      "waterway-label"
    );
  }

  // Circle points layer (for “dots”)
  if (!map.getLayer("wl-points")) {
    map.addLayer({
      id: "wl-points",
      type: "circle",
      source: sourceId,
      "source-layer": CONFIG.sourceLayer,
      minzoom: CONFIG.pointsMinZoom,
      filter: buildLayerFilter(),
      paint: {
        "circle-radius": circleRadiusExpr(),
        "circle-color": "rgba(0,0,0,0.55)",
        "circle-stroke-color": "rgba(255,255,255,0.85)",
        "circle-stroke-width": 1,
        "circle-opacity": circleOpacityExpr()
      }
    });
  }

  // Wire up UI
  if (metricSalesRadio) {
    metricSalesRadio.addEventListener("change", () => {
      if (metricSalesRadio.checked) {
        metric = "Sales";
        log("Metric set to Sales");
        applyFilters();
      }
    });
  }
  if (metricTicketsRadio) {
    metricTicketsRadio.addEventListener("change", () => {
      if (metricTicketsRadio.checked) {
        metric = "Tickets";
        log("Metric set to Tickets");
        applyFilters();
      }
    });
  }

  // Apply / Clear buttons
  if (applyBtn) applyBtn.addEventListener("click", applyFilters);
  if (clearBtn) clearBtn.addEventListener("click", clearFilters);

  // Optional: pressing Enter inside date fields applies
  [startDateInput, endDateInput].forEach((el) => {
    if (!el) return;
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") applyFilters();
    });
  });

  // Start state
  if (metricSalesRadio) metricSalesRadio.checked = true;
  metric = "Sales";
  applyFilters();

  log("Ready");
});

/*** 11) SAFETY: TOKEN CHECK ***/
if (!MAPBOX_TOKEN || MAPBOX_TOKEN.includes("PASTE_YOUR_MAPBOX")) {
  console.warn("[WLHeatmap] You still need to set MAPBOX_TOKEN at the top of app.js");
}
