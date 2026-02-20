/* app.js — Woodson Zip Sales Heatmap (Mapbox GL JS v3)
   - Filters: BranchName, ProductGroupLevel1, SaleDateKey range
   - Metric toggle: TotalSales vs TicketCount
   - Uses vector tileset source (NOT tilequery) so points persist while panning/zooming
*/

(() => {
  const LOG_PREFIX = "[WLHeatmap]";
  const log = (...args) => console.log(LOG_PREFIX, ...args);

  // =========================
  // ✅ EDIT THESE TWO CONSTANTS
  // =========================
  // Tileset id you uploaded (from Mapbox Studio -> Tilesets)
  const TILESET_ID = "ckunkel.bp872kqi";

  // Source layer name inside the tileset.
  // Your console earlier showed: layers=MapBox-42vjbp
  // That is typically the source-layer name.
  const SOURCE_LAYER = "MapBox-42vjbp";

  // Optional: if you changed the filename or folder
  const FILTERS_URL = "filters.json";

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
    // filters
    branch: "__ALL__",
    group: "__ALL__",
    startKey: null, // YYYYMMDD int
    endKey: null,   // YYYYMMDD int
  };

  // Metric mapping to tileset properties
  const METRICS = {
    sales: {
      label: "Sales",
      prop: "TotalSales",
    },
    tickets: {
      label: "Tickets",
      prop: "TicketCount",
    },
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
    return (y * 10000) + (mo * 100) + d; // YYYYMMDD
  }

  function safeToNumberExpr(propName) {
    // Forces numeric conversion even if Mapbox typed the column as string
    // to-number(value, fallback) is supported in GL JS v3 expression spec
    return ["to-number", ["get", propName], 0];
  }

  function buildFilterExpr() {
    const expr = ["all"];

    // Branch filter
    if (state.branch && state.branch !== "__ALL__") {
      expr.push(["==", ["get", "BranchName"], state.branch]);
    }

    // Product group filter
    if (state.group && state.group !== "__ALL__") {
      expr.push(["==", ["get", "ProductGroupLevel1"], state.group]);
    }

    // Date range filter (SaleDateKey)
    // Your data has SaleDateKey like 20260102
    const dateKeyExpr = safeToNumberExpr("SaleDateKey");

    if (state.startKey != null) {
      expr.push([">=", dateKeyExpr, state.startKey]);
    }
    if (state.endKey != null) {
      expr.push(["<=", dateKeyExpr, state.endKey]);
    }

    return expr;
  }

  function setMetricUI(metric) {
    state.metric = metric;

    if (els.metricSales && els.metricTickets) {
      const isSales = metric === "sales";
      els.metricSales.classList.toggle("active", isSales);
      els.metricTickets.classList.toggle("active", !isSales);
    }
    log("Metric set to", METRICS[metric].label);
  }

  // =========================
  // Map init
  // =========================
  log("Booting...");

  const map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/light-v11",
    center: [-96.7, 30.6], // Texas-ish default
    zoom: 6.3,
  });

  // Add basic nav controls
  map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");

  // =========================
  // Load filters.json & populate selects
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

      // Branch select
      if (els.branchSelect) {
        // keep first option
        for (const b of branches) {
          const opt = document.createElement("option");
          opt.value = b;
          opt.textContent = b;
          els.branchSelect.appendChild(opt);
        }
      }

      // Group select
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
      setStatus("Could not load filters.json (check path). Filters may be incomplete.");
    }
  }

  // =========================
  // Layers
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

    // Metric expression (numeric)
    const metricProp = METRICS[state.metric].prop;
    const metricNum = safeToNumberExpr(metricProp);

    // Heatmap layer
    if (!map.getLayer(HEAT_LAYER_ID)) {
      map.addLayer({
        id: HEAT_LAYER_ID,
        type: "heatmap",
        source: SOURCE_ID,
        "source-layer": SOURCE_LAYER,
        paint: {
          // Weight by metric (0..1 scaled)
          "heatmap-weight": [
            "interpolate",
            ["linear"],
            metricNum,
            0, 0,
            500, 0.25,
            2000, 0.6,
            10000, 1
          ],

          // Intensity vs zoom (subtle)
          "heatmap-intensity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0, 0.7,
            7, 1.0,
            10, 1.4,
            12, 1.8
          ],

          // Radius vs zoom (this controls the “blur” feel)
          "heatmap-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0, 10,
            7, 22,
            10, 34,
            12, 48
          ],

          // Opacity vs zoom
          "heatmap-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            6, 0.92,
            11, 0.78,
            13, 0.6
          ],
        },
      });
    }

    // Points layer (optional, helps “anchor” the heatmap)
    if (!map.getLayer(POINT_LAYER_ID)) {
      map.addLayer({
        id: POINT_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        "source-layer": SOURCE_LAYER,
        paint: {
          "circle-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            6, 0.08,
            9, 0.18,
            12, 0.35
          ],
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            6, 2,
            9, 3,
            12, 5
          ],
          // Keep neutral so the heatmap is the star
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
        "interpolate",
        ["linear"],
        metricNum,
        0, 0,
        500, 0.25,
        2000, 0.6,
        10000, 1
      ]);
    }
  }

  // =========================
  // Apply filters to layers
  // =========================
  function applyFilters() {
    // Read UI -> state
    state.branch = els.branchSelect?.value ?? "__ALL__";
    state.group = els.groupSelect?.value ?? "__ALL__";

    state.startKey = dateToKey(els.startDate?.value);
    state.endKey = dateToKey(els.endDate?.value);

    // Validate date range: swap if user entered backwards
    if (state.startKey != null && state.endKey != null && state.startKey > state.endKey) {
      const tmp = state.startKey;
      state.startKey = state.endKey;
      state.endKey = tmp;

      // also swap inputs so user sees it
      const s = els.startDate.value;
      els.startDate.value = els.endDate.value;
      els.endDate.value = s;
    }

    const filterExpr = buildFilterExpr();

    if (map.getLayer(HEAT_LAYER_ID)) map.setFilter(HEAT_LAYER_ID, filterExpr);
    if (map.getLayer(POINT_LAYER_ID)) map.setFilter(POINT_LAYER_ID, filterExpr);

    setStatus(
      `Metric: ${METRICS[state.metric].label} • ` +
      `Branch: ${state.branch === "__ALL__" ? "All" : state.branch} • ` +
      `Group: ${state.group === "__ALL__" ? "All" : state.group} • ` +
      `Dates: ${state.startKey ?? "…"} → ${state.endKey ?? "…"}`
    );

    log("Applied filters • Metric:", METRICS[state.metric].label);
  }

  function clearFilters() {
    // Reset UI
    if (els.branchSelect) els.branchSelect.value = "__ALL__";
    if (els.groupSelect) els.groupSelect.value = "__ALL__";
    if (els.startDate) els.startDate.value = "";
    if (els.endDate) els.endDate.value = "";

    // Reset state
    state.branch = "__ALL__";
    state.group = "__ALL__";
    state.startKey = null;
    state.endKey = null;

    // Apply reset filter
    applyFilters();
    log("Cleared filters");
  }

  // =========================
  // Wire up UI events
  // =========================
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

    // Nice UX: hitting Enter in date fields applies
    els.startDate?.addEventListener("keydown", (e) => { if (e.key === "Enter") applyFilters(); });
    els.endDate?.addEventListener("keydown", (e) => { if (e.key === "Enter") applyFilters(); });
  }

  // =========================
  // Startup sequence
  // =========================
  (async function init() {
    await loadFilters();
    wireUI();

    map.on("load", () => {
      log("Map loaded. Adding layers...");
      ensureLayers();

      // default metric
      setMetricUI("sales");
      updateMetricPaint();

      // default filters
      applyFilters();

      log("Ready");
    });
  })();
})();
