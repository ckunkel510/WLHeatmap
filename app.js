/* ============================================================
   WLHeatmap • app.js (FULL FILE • Mapbox GL JS v3-safe)
   Fixes:
   - Date parsing supports YYYY-MM-DD AND M/D/YYYY
   - Numeric expressions use to-number(value, default) (no NaN errors)
   - Metric toggle Sales/Tickets is click-proof (event delegation)
   ============================================================ */

/*** 1) PUT YOUR TOKEN HERE ***/
const MAPBOX_TOKEN = "pk.eyJ1IjoiY2t1bmtlbCIsImEiOiJjbWx1Yjc4ODIwOW51M2Zwdm15dHFodnh1In0.F2yytru7jt9khYyPziZrHw";

/*** 2) CONFIG ***/
const CONFIG = {
  tilesetId: "ckunkel.bp872kqi",
  sourceLayer: "MapBox-42vjbp", // must match tileset layer name exactly
  filtersUrl: "./filters.json",
  center: [-96.3698, 30.6744],
  zoom: 6.3,
  heatmapMaxZoom: 10,
  pointsMinZoom: 7.25
};

const log = (...args) => console.log("[WLHeatmap]", ...args);
const warn = (...args) => console.warn("[WLHeatmap]", ...args);

function $(id) { return document.getElementById(id); }

function uniqSorted(arr) {
  return Array.from(new Set((arr || []).filter(v => v !== null && v !== undefined && String(v).trim() !== "")))
    .sort((a, b) => String(a).localeCompare(String(b)));
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

/* ------------------------------------------------------------
   Date parsing:
   - supports "YYYY-MM-DD" (date input)
   - supports "M/D/YYYY" or "MM/DD/YYYY" (typed / text input)
   returns int yyyymmdd or null
------------------------------------------------------------- */
function dateStrToKey(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const s = dateStr.trim();

  // YYYY-MM-DD
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (y && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return y * 10000 + mo * 100 + d;
    return null;
  }

  // M/D/YYYY or MM/DD/YYYY
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const mo = Number(m[1]), d = Number(m[2]), y = Number(m[3]);
    if (y && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return y * 10000 + mo * 100 + d;
    return null;
  }

  return null;
}

/* ----------------------------------------------------------------
   Numeric safety for Mapbox expressions:
   - use to-number(value, default) so blank/strings never become NaN
------------------------------------------------------------------ */
function numField(fieldName, fallback = 0) {
  return ["to-number", ["get", fieldName], fallback];
}

function metricFieldName(metric) {
  return metric === "Tickets" ? "TicketCount" : "TotalSales";
}
function metricLabel(metric) {
  return metric === "Tickets" ? "Tickets" : "Sales";
}

/*** Heatmap paint ***/
function heatWeightExpr(metric) {
  // ln(1 + value)
  return ["ln", ["+", 1, numField(metricFieldName(metric), 0)]];
}
function heatIntensityExpr() {
  return ["interpolate", ["linear"], ["zoom"], 0, 0.6, 7, 1.2, 10, 2.0, 12, 3.0];
}
function heatRadiusExpr() {
  return ["interpolate", ["linear"], ["zoom"], 4, 12, 7, 20, 10, 34, 12, 48];
}
function heatColorExpr() {
  return [
    "interpolate",
    ["linear"],
    ["heatmap-density"],
    0, "rgba(0,0,0,0)",
    0.10, "rgba(0,145,255,0.25)",
    0.25, "rgba(0,145,255,0.55)",
    0.45, "rgba(0,200,120,0.65)",
    0.65, "rgba(255,220,0,0.75)",
    0.85, "rgba(255,120,0,0.85)",
    1.00, "rgba(255,0,0,0.95)"
  ];
}

/*** Points paint ***/
function circleRadiusExpr(metric) {
  // interpolate(linear, ln(1+value), ...)
  return [
    "interpolate",
    ["linear"],
    ["ln", ["+", 1, numField(metricFieldName(metric), 0)]],
    0, 2,
    3, 4,
    6, 7,
    9, 11
  ];
}
function circleOpacityExpr() {
  return ["interpolate", ["linear"], ["zoom"], CONFIG.pointsMinZoom, 0.0, CONFIG.pointsMinZoom + 0.75, 0.9];
}

/*** UI elements (IDs expected in index.html) ***/
const branchSelect = $("branchSelect");
const groupSelect = $("groupSelect");
const startDateInput = $("startDate");
const endDateInput = $("endDate");
const metricSalesRadio = $("metricSales");
const metricTicketsRadio = $("metricTickets");
const metricSelect = $("metricSelect"); // optional <select> fallback
const applyBtn = $("applyBtn");
const clearBtn = $("clearBtn");

let metric = "Sales";

/*** FILTER LISTS ***/
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

    // Optional select metric fallback
    if (metricSelect) {
      metricSelect.innerHTML = "";
      ["Sales", "Tickets"].forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m;
        metricSelect.appendChild(opt);
      });
      metricSelect.value = metric;
    }

    log(`Loaded filters.json • ${branches.length} branches • ${groups.length} groups`);
  } catch (e) {
    warn("Failed to load filters.json:", e);
  }
}

/*** BUILD FILTER ***/
function buildLayerFilter() {
  const filters = ["all"];

  const branch = branchSelect ? branchSelect.value : "";
  const group = groupSelect ? groupSelect.value : "";

  const startKey = dateStrToKey(startDateInput ? startDateInput.value : "");
  const endKey = dateStrToKey(endDateInput ? endDateInput.value : "");

  if (branch) filters.push(["==", ["get", "BranchName"], branch]);
  if (group) filters.push(["==", ["get", "ProductGroupLevel1"], group]);

  // SaleDateKey numeric filter (works whether SaleDateKey is stored as string or number)
  const saleKey = numField("SaleDateKey", 0);

  if (startKey != null) filters.push([">=", saleKey, startKey]);
  if (endKey != null) filters.push(["<=", saleKey, endKey]);

  return filters;
}

/*** APPLY ***/
function applyFilters(map) {
  const f = buildLayerFilter();

  if (map.getLayer("wl-heat")) map.setFilter("wl-heat", f);
  if (map.getLayer("wl-points")) map.setFilter("wl-points", f);

  if (map.getLayer("wl-heat")) {
    map.setPaintProperty("wl-heat", "heatmap-weight", heatWeightExpr(metric));
    map.setPaintProperty("wl-heat", "heatmap-intensity", heatIntensityExpr());
    map.setPaintProperty("wl-heat", "heatmap-radius", heatRadiusExpr());
    map.setPaintProperty("wl-heat", "heatmap-color", heatColorExpr());
  }

  if (map.getLayer("wl-points")) {
    map.setPaintProperty("wl-points", "circle-radius", circleRadiusExpr(metric));
    map.setPaintProperty("wl-points", "circle-opacity", circleOpacityExpr());
  }

  log(`Applied filters • Metric: ${metricLabel(metric)} • StartKey=${dateStrToKey(startDateInput?.value || "")} • EndKey=${dateStrToKey(endDateInput?.value || "")}`);
  setStatus(`Metric: ${metricLabel(metric)}`);
}

/*** CLEAR ***/
function clearFilters(map) {
  if (branchSelect) branchSelect.value = "";
  if (groupSelect) groupSelect.value = "";
  if (startDateInput) startDateInput.value = "";
  if (endDateInput) endDateInput.value = "";

  setMetric("Sales", map);
  applyFilters(map);
}

/*** METRIC (click-proof) ***/
function setMetric(newMetric, map) {
  metric = newMetric === "Tickets" ? "Tickets" : "Sales";

  if (metricSalesRadio) metricSalesRadio.checked = metric === "Sales";
  if (metricTicketsRadio) metricTicketsRadio.checked = metric === "Tickets";
  if (metricSelect) metricSelect.value = metric;

  log(`Metric set to ${metricLabel(metric)}`);
  applyFilters(map);
}

function wireMetricControls(map) {
  // Normal wiring (change/click)
  if (metricSalesRadio) {
    metricSalesRadio.addEventListener("change", () => metricSalesRadio.checked && setMetric("Sales", map));
    metricSalesRadio.addEventListener("click", () => setMetric("Sales", map));
  }
  if (metricTicketsRadio) {
    metricTicketsRadio.addEventListener("change", () => metricTicketsRadio.checked && setMetric("Tickets", map));
    metricTicketsRadio.addEventListener("click", () => setMetric("Tickets", map));
  }
  if (metricSelect) {
    metricSelect.addEventListener("change", () => setMetric(metricSelect.value, map));
  }

  // Event delegation fallback:
  // If labels/containers are being clicked but radios don't receive click (overlay/label mismatch),
  // this still toggles based on "metricSales"/"metricTickets" IDs or data-metric attributes.
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!t) return;

    const metricEl = t.closest?.("#metricSales, #metricTickets, [data-metric]");
    if (!metricEl) return;

    const id = metricEl.id;
    const dm = metricEl.getAttribute?.("data-metric");

    if (id === "metricSales" || dm === "Sales") setMetric("Sales", map);
    if (id === "metricTickets" || dm === "Tickets") setMetric("Tickets", map);
  }, true);
}

/*** BOOT ***/
log("Booting...");

if (!MAPBOX_TOKEN || MAPBOX_TOKEN.includes("PASTE_YOUR_MAPBOX")) {
  warn("You still need to set MAPBOX_TOKEN at the top of app.js");
}

mapboxgl.accessToken = MAPBOX_TOKEN;

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/light-v11",
  center: CONFIG.center,
  zoom: CONFIG.zoom
});

map.on("load", async () => {
  await loadFiltersJson();

  log("Map loaded. Adding layers...");

  const sourceId = "wl-src";
  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: "vector",
      url: `mapbox://${CONFIG.tilesetId}`
    });
  }

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
          "heatmap-weight": heatWeightExpr(metric),
          "heatmap-intensity": heatIntensityExpr(),
          "heatmap-radius": heatRadiusExpr(),
          "heatmap-color": heatColorExpr(),
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.95, CONFIG.heatmapMaxZoom, 0.55]
        }
      },
      "waterway-label"
    );
  }

  if (!map.getLayer("wl-points")) {
    map.addLayer({
      id: "wl-points",
      type: "circle",
      source: sourceId,
      "source-layer": CONFIG.sourceLayer,
      minzoom: CONFIG.pointsMinZoom,
      filter: buildLayerFilter(),
      paint: {
        "circle-radius": circleRadiusExpr(metric),
        "circle-color": "rgba(0,0,0,0.55)",
        "circle-stroke-color": "rgba(255,255,255,0.85)",
        "circle-stroke-width": 1,
        "circle-opacity": circleOpacityExpr()
      }
    });
  }

  if (applyBtn) applyBtn.addEventListener("click", () => applyFilters(map));
  if (clearBtn) clearBtn.addEventListener("click", () => clearFilters(map));

  // Enter key applies
  [startDateInput, endDateInput].forEach((el) => {
    if (!el) return;
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") applyFilters(map);
    });
  });

  wireMetricControls(map);

  // initial apply
  applyFilters(map);

  log("Ready");
});
