/* app.js - WL Zip Sales Heatmap (Mapbox GL JS v3)
   REQUIRED tileset fields:
   - BranchName (string)
   - ProductGroupLevel1 (string)
   - Zip5 (string)
   - TotalSales (number)
   - TicketCount (number)
   - SaleDateKey (number)  // YYYYMMDD e.g. 20260102
*/

(() => {
  const MAPBOX_TOKEN = "pk.eyJ1IjoiY2t1bmtlbCIsImEiOiJjbWx1Yjc4ODIwOW51M2Zwdm15dHFodnh1In0.F2yytru7jt9khYyPziZrHw";
  const TILESET_ID   = "ckunkel.bp872kqi";   // mapbox://ckunkel.bp872kqi
  const SOURCE_LAYER = "MapBox-42vjbp";      // must match your tileset's source-layer
  const FILTERS_JSON_URL = "./filters.json";

  const SOURCE_ID = "zips-src";
  const HEAT_LAYER_ID = "zips-heat";
  const POINT_LAYER_ID = "zips-points";
  const ENABLE_POINT_LAYER = true;

  const DEFAULT_CENTER = [-96.7, 30.6];
  const DEFAULT_ZOOM = 6.2;

  if (!MAPBOX_TOKEN || MAPBOX_TOKEN.includes("PASTE")) {
    console.error("Mapbox token missing. Set window.MAPBOX_TOKEN in index.html.");
    return;
  }
  if (!window.mapboxgl) {
    console.error("mapboxgl not found. Load Mapbox GL JS before app.js.");
    return;
  }

  mapboxgl.accessToken = MAPBOX_TOKEN;

  const UI = {
    branchSelect: document.getElementById("branchSelect"),
    groupSelect: document.getElementById("groupSelect"),
    weightSelect: document.getElementById("weightSelect"),
    startDate: document.getElementById("startDate"),
    endDate: document.getElementById("endDate"),
    clearDatesBtn: document.getElementById("clearDatesBtn"),
    status: document.getElementById("status")
  };

  function setStatus(msg) {
    if (UI.status) UI.status.textContent = msg;
    console.log("[WLHeatmap]", msg);
  }

  function safeSetOptions(selectEl, values, allLabel) {
    if (!selectEl) return;
    const current = selectEl.value;

    selectEl.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = "__all__";
    optAll.textContent = allLabel || "All";
    selectEl.appendChild(optAll);

    (values || []).forEach(v => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      selectEl.appendChild(opt);
    });

    const exists = Array.from(selectEl.options).some(o => o.value === current);
    if (exists) selectEl.value = current;
  }

  // YYYY-MM-DD => YYYYMMDD
  function isoToKey(iso) {
    if (!iso) return null;
    const [y, m, d] = iso.split("-").map(Number);
    if (!y || !m || !d) return null;
    return y * 10000 + m * 100 + d;
  }

  function buildFilter() {
    const branch = UI.branchSelect ? UI.branchSelect.value : "__all__";
    const group  = UI.groupSelect ? UI.groupSelect.value : "__all__";

    const startKey = isoToKey(UI.startDate ? UI.startDate.value : "");
    const endKey   = isoToKey(UI.endDate ? UI.endDate.value : "");

    const f = ["all"];

    if (branch !== "__all__") f.push(["==", ["get", "BranchName"], branch]);
    if (group  !== "__all__") f.push(["==", ["get", "ProductGroupLevel1"], group]);

    // Numeric date filtering (requires SaleDateKey field)
    if (startKey !== null) f.push([">=", ["to-number", ["get", "SaleDateKey"]], startKey]);
    if (endKey   !== null) f.push(["<=", ["to-number", ["get", "SaleDateKey"]], endKey]);

    return f;
  }

  function applyFilter() {
    const f = buildFilter();
    if (map.getLayer(HEAT_LAYER_ID)) map.setFilter(HEAT_LAYER_ID, f);
    if (ENABLE_POINT_LAYER && map.getLayer(POINT_LAYER_ID)) map.setFilter(POINT_LAYER_ID, f);
  }

  function updateWeight() {
    const mode = UI.weightSelect ? UI.weightSelect.value : "sales";
    const weightExpr =
      mode === "tickets"
        ? ["to-number", ["get", "TicketCount"]]
        : ["to-number", ["get", "TotalSales"]];

    if (map.getLayer(HEAT_LAYER_ID)) {
      map.setPaintProperty(HEAT_LAYER_ID, "heatmap-weight", weightExpr);

      // Slightly different intensity curve for each
      map.setPaintProperty(
        HEAT_LAYER_ID,
        "heatmap-intensity",
        mode === "tickets"
          ? ["interpolate", ["linear"], ["zoom"], 5, 0.55, 12, 1.05, 18, 1.25]
          : ["interpolate", ["linear"], ["zoom"], 5, 0.6,  12, 1.15, 18, 1.35]
      );
    }
  }

  async function loadFiltersJson() {
    try {
      const res = await fetch(FILTERS_JSON_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("filters.json not found");
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  const map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/light-v11",
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    cooperativeGestures: true
  });

  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

  function addSourceAndLayers() {
    map.addSource(SOURCE_ID, {
      type: "vector",
      url: `mapbox://${TILESET_ID}`
    });

    // Tighter heatmap so it doesn't smear together
    map.addLayer({
      id: HEAT_LAYER_ID,
      type: "heatmap",
      source: SOURCE_ID,
      "source-layer": SOURCE_LAYER,
      maxzoom: 22,
      paint: {
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 5, 0.6, 12, 1.15, 18, 1.35],
        "heatmap-weight": ["to-number", ["get", "TotalSales"]],
        "heatmap-radius": [
          "interpolate", ["linear"], ["zoom"],
          5, 6,
          8, 12,
          11, 18,
          14, 26,
          16, 34
        ],
        "heatmap-opacity": 0.78
      }
    });

    if (ENABLE_POINT_LAYER) {
      map.addLayer({
        id: POINT_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        "source-layer": SOURCE_LAYER,
        minzoom: 9,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 2, 12, 4, 16, 7],
          "circle-opacity": 0.55
        }
      });
    }
  }

  function wireUiEvents() {
    const onChange = () => applyFilter();

    if (UI.branchSelect) UI.branchSelect.addEventListener("change", onChange);
    if (UI.groupSelect) UI.groupSelect.addEventListener("change", onChange);

    if (UI.weightSelect) {
      UI.weightSelect.addEventListener("change", () => {
        updateWeight();
        applyFilter();
      });
    }

    if (UI.startDate) UI.startDate.addEventListener("change", onChange);
    if (UI.endDate) UI.endDate.addEventListener("change", onChange);

    if (UI.clearDatesBtn) {
      UI.clearDatesBtn.addEventListener("click", () => {
        if (UI.startDate) UI.startDate.value = "";
        if (UI.endDate) UI.endDate.value = "";
        applyFilter();
      });
    }
  }

  map.on("load", async () => {
    setStatus("Loading filter lists...");

    addSourceAndLayers();
    wireUiEvents();

    updateWeight();

    const filters = await loadFiltersJson();
    if (!filters) {
      setStatus("filters.json missing. Add it to GitHub Pages so dropdowns populate.");
      // Keep UI as All-only
    } else {
      safeSetOptions(UI.branchSelect, filters.branches || [], "All branches");
      safeSetOptions(UI.groupSelect, filters.productGroupsLevel1 || [], "All product groups");
      setStatus("Ready");
    }

    applyFilter();
  });
})();
