/* app.js
   WL Zip Sales Heatmap (Mapbox GL JS v3)

   REQUIREMENTS (your tileset properties):
   - BranchName (string)
   - ProductGroupLevel1 (string)
   - Zip5 (string or number)
   - TicketCount (number)
   - TotalSales (number)
   - TotalProfit (number)
   - SaleDateKey (number)  <-- strongly recommended: YYYYMMDD (e.g., 20260102)

   OPTIONAL (for display only):
   - SaleDate (string)

   Notes:
   - This file supports:
     ✅ Heatmap weight toggle (TotalSales vs TicketCount)
     ✅ Branch dropdown (uses filters.json if present; otherwise sampling)
     ✅ Product group dropdown (same)
     ✅ Date range filter (uses SaleDateKey numeric filtering)
     ✅ Works on GitHub Pages
*/

(() => {
  // =========================
  // CONFIG (EDIT THESE)
  // =========================
  const MAPBOX_TOKEN = "pk.eyJ1IjoiY2t1bmtlbCIsImEiOiJjbWx1Yjc4ODIwOW51M2Zwdm15dHFodnh1In0.F2yytru7jt9khYyPziZrHw"; // set in index.html before app.js OR paste here
  const TILESET_ID = "ckunkel.bp872kqi";          // your tileset id
  const SOURCE_LAYER = "MapBox-42vjbp";           // your source-layer name EXACT
  const DEFAULT_CENTER = [-96.7, 30.6];           // Texas-ish
  const DEFAULT_ZOOM = 6.2;

  // Layer IDs
  const SOURCE_ID = "zips-src";
  const HEAT_LAYER_ID = "zips-heat";
  const POINT_LAYER_ID = "zips-points";

  // If you want circles at high zoom, set to true
  const ENABLE_POINT_LAYER = true;

  // Where we try to load full lists from (recommended)
  const FILTERS_JSON_URL = "./filters.json";

  // Sampling settings (fallback if filters.json not found)
  const SAMPLE_ZOOMS = [6, 7, 8, 9, 10];
  const SAMPLE_LIMIT_PER_QUERY = 5000; // Mapbox tilequery limit is typically 50k; keep safe

  const SAMPLE_CENTERS = [
    [-96.3698, 30.6744], // Bryan
    [-96.3250, 30.1699], // Brenham-ish
    [-96.4012, 30.1790], // Brenham center-ish
    [-96.5500, 30.5300], // between Bryan/Brenham
    [-96.0100, 30.3000], // toward College Station area
    [-95.3698, 29.7604], // Houston
    [-97.7431, 30.2672], // Austin
    [-96.7969, 32.7763]  // Dallas
  ];

  // =========================
  // BASIC GUARDS
  // =========================
  if (!MAPBOX_TOKEN || MAPBOX_TOKEN.trim() === "" || MAPBOX_TOKEN.includes("PASTE")) {
    console.error("Mapbox token missing. Set window.MAPBOX_TOKEN in index.html or paste MAPBOX_TOKEN in app.js.");
    return;
  }

  // Mapbox GL is expected to be loaded by index.html
  if (!window.mapboxgl) {
    console.error("mapboxgl not found. Make sure Mapbox GL JS is loaded before app.js.");
    return;
  }

  mapboxgl.accessToken = MAPBOX_TOKEN;

  // =========================
  // UI HOOKUP
  // =========================
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

    values.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      selectEl.appendChild(opt);
    });

    // Preserve selection if still exists
    const exists = Array.from(selectEl.options).some(o => o.value === current);
    if (exists) selectEl.value = current;
  }

  // Converts YYYY-MM-DD => YYYYMMDD number
  function isoToKey(iso) {
    if (!iso) return null;
    const parts = iso.split("-");
    if (parts.length !== 3) return null;
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const d = Number(parts[2]);
    if (!y || !m || !d) return null;
    return (y * 10000) + (m * 100) + d;
  }

  // =========================
  // MAP INIT
  // =========================
  const map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/light-v11",
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    cooperativeGestures: true
  });

  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

  // =========================
  // SOURCE + LAYERS
  // =========================
  function addSourceAndLayers() {
    if (map.getSource(SOURCE_ID)) return;

    map.addSource(SOURCE_ID, {
      type: "vector",
      url: `mapbox://${TILESET_ID}`
    });

    // Heatmap
    map.addLayer({
      id: HEAT_LAYER_ID,
      type: "heatmap",
      source: SOURCE_ID,
      "source-layer": SOURCE_LAYER,
      maxzoom: 22,
      paint: {
        // Base intensity scales with zoom a bit
        "heatmap-intensity": [
          "interpolate", ["linear"], ["zoom"],
          5, 0.7,
          12, 1.25,
          18, 1.6
        ],

        // Weight is set dynamically by updateWeight() using setPaintProperty
        "heatmap-weight": ["to-number", ["get", "TotalSales"]],

        "heatmap-radius": [
          "interpolate", ["linear"], ["zoom"],
          5, 10,
          9, 20,
          12, 30,
          16, 45
        ],

        "heatmap-opacity": 0.85
      }
    });

    // Optional point layer at higher zoom
    if (ENABLE_POINT_LAYER) {
      map.addLayer({
        id: POINT_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        "source-layer": SOURCE_LAYER,
        minzoom: 9,
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            9, 2,
            12, 4,
            16, 7
          ],
          "circle-opacity": 0.6
        }
      });
    }
  }

  // =========================
  // FILTER + WEIGHT UPDATES
  // =========================
  function buildFilter() {
    const branch = UI.branchSelect ? UI.branchSelect.value : "__all__";
    const group = UI.groupSelect ? UI.groupSelect.value : "__all__";

    const startKey = isoToKey(UI.startDate ? UI.startDate.value : "");
    const endKey = isoToKey(UI.endDate ? UI.endDate.value : "");

    const f = ["all"];

    if (branch !== "__all__") {
      f.push(["all", ["has", "BranchName"], ["==", ["get", "BranchName"], branch]]);
    }

    if (group !== "__all__") {
      f.push(["all", ["has", "ProductGroupLevel1"], ["==", ["get", "ProductGroupLevel1"], group]]);
    }

    // Date range on numeric key
    // IMPORTANT: this requires SaleDateKey in the tileset (YYYYMMDD)
    if (startKey !== null) {
      f.push([">=", ["to-number", ["get", "SaleDateKey"]], startKey]);
    }
    if (endKey !== null) {
      f.push(["<=", ["to-number", ["get", "SaleDateKey"]], endKey]);
    }

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
    }

    // Optional: adjust intensity a bit for ticket mode
    if (map.getLayer(HEAT_LAYER_ID)) {
      const intensity =
        mode === "tickets"
          ? ["interpolate", ["linear"], ["zoom"], 5, 0.6, 12, 1.15, 18, 1.4]
          : ["interpolate", ["linear"], ["zoom"], 5, 0.7, 12, 1.25, 18, 1.6];

      map.setPaintProperty(HEAT_LAYER_ID, "heatmap-intensity", intensity);
    }
  }

  function onAnyUiChange() {
    applyFilter();
  }

  // =========================
  // FILTER LIST POPULATION
  // =========================
  async function loadFiltersJson() {
    try {
      const res = await fetch(FILTERS_JSON_URL, { cache: "no-store" });
      if (!res.ok) return null;
      const json = await res.json();
      return json;
    } catch (e) {
      return null;
    }
  }

  async function tileQueryDistinctValues() {
    // Uses Mapbox Tilequery API to sample values.
    // Note: Must be public tileset or token must have access.
    const branches = new Set();
    const groups = new Set();

    async function queryOne(center, zoom) {
      // radius in meters; increase slightly at low zoom
      const radius = zoom <= 7 ? 12000 : zoom <= 9 ? 8000 : 5000;

      const url =
        `https://api.mapbox.com/v4/${TILESET_ID}/tilequery/${center[0]},${center[1]}.json` +
        `?radius=${radius}` +
        `&limit=${SAMPLE_LIMIT_PER_QUERY}` +
        `&layers=${encodeURIComponent(SOURCE_LAYER)}` +
        `&access_token=${encodeURIComponent(MAPBOX_TOKEN)}`;

      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !data.features) return;

      for (const feat of data.features) {
        const p = feat.properties || {};
        if (p.BranchName) branches.add(String(p.BranchName));
        if (p.ProductGroupLevel1) groups.add(String(p.ProductGroupLevel1));
      }
    }

    // Run sequentially to avoid hammering
    for (const z of SAMPLE_ZOOMS) {
      for (const c of SAMPLE_CENTERS) {
        await queryOne(c, z);
      }
    }

    return {
      branches: Array.from(branches).sort(),
      productGroupsLevel1: Array.from(groups).sort()
    };
  }

  async function initDropdownLists() {
    setStatus("Loading filter lists...");

    // 1) Try filters.json (complete list)
    const filtersJson = await loadFiltersJson();
    if (filtersJson && (filtersJson.branches || filtersJson.productGroupsLevel1)) {
      safeSetOptions(UI.branchSelect, filtersJson.branches || [], "All branches");
      safeSetOptions(UI.groupSelect, filtersJson.productGroupsLevel1 || [], "All product groups");
      setStatus("Loaded filters from filters.json");
      return;
    }

    // 2) Fallback to sampling
    const sampled = await tileQueryDistinctValues();
    safeSetOptions(UI.branchSelect, sampled.branches || [], "All branches");
    safeSetOptions(UI.groupSelect, sampled.productGroupsLevel1 || [], "All product groups");
    setStatus("Loaded filters from sampled tiles (fallback)");
  }

  // =========================
  // DEBUG HELPERS (optional)
  // =========================
  function attachDebug() {
    map.on("sourcedata", (e) => {
      if (e.sourceId === SOURCE_ID && e.isSourceLoaded) {
        console.log("[zips-src] source loaded, zoom:", map.getZoom().toFixed(2));
      }
    });

    // Click to inspect feature props
    map.on("click", (e) => {
      const feats = map.queryRenderedFeatures(e.point, { layers: [HEAT_LAYER_ID].concat(ENABLE_POINT_LAYER ? [POINT_LAYER_ID] : []) });
      if (!feats.length) return console.log("No feature at click");
      console.log("Clicked feature properties:", feats[0].properties);
    });
  }

  // =========================
  // WIRE UI EVENTS
  // =========================
  function wireUiEvents() {
    if (UI.branchSelect) UI.branchSelect.addEventListener("change", onAnyUiChange);
    if (UI.groupSelect) UI.groupSelect.addEventListener("change", onAnyUiChange);

    if (UI.weightSelect) {
      UI.weightSelect.addEventListener("change", () => {
        updateWeight();
        onAnyUiChange();
      });
    }

    if (UI.startDate) UI.startDate.addEventListener("change", onAnyUiChange);
    if (UI.endDate) UI.endDate.addEventListener("change", onAnyUiChange);

    if (UI.clearDatesBtn) {
      UI.clearDatesBtn.addEventListener("click", () => {
        if (UI.startDate) UI.startDate.value = "";
        if (UI.endDate) UI.endDate.value = "";
        onAnyUiChange();
      });
    }
  }

  // =========================
  // BOOT
  // =========================
  map.on("load", async () => {
    try {
      addSourceAndLayers();
      wireUiEvents();

      // Default weight mode
      updateWeight();

      // Populate dropdown lists (filters.json preferred)
      await initDropdownLists();

      // Apply initial filter
      applyFilter();

      // Optional debug
      // attachDebug();

      setStatus("Ready");
    } catch (err) {
      console.error(err);
      setStatus("Error initializing map. Check console.");
    }
  });
})();
