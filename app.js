/* app.js - WLHeatmap (patched)
   Fixes:
   - Date filtering uses SaleDateKey (numeric) to avoid string/date issues
   - ProductGroup dropdown loads from filters.json OR groups.json OR fallback sampling
   - Apply/Clear + Sales/Tickets toggles wired reliably
   - Mapbox expressions use coalesce(to-number(..),0) to avoid "Input is not a number"
*/

(() => {
  const LOG_PREFIX = "[WLHeatmap]";
  const log = (...args) => console.log("app.js:", ...args);
  const warn = (...args) => console.warn("app.js:", ...args);

  log(`${LOG_PREFIX} Booting...`);

  // ========= CONFIG YOU MUST SET =========
  // Example from your console: ckunkel.bp872kqi
  const TILESET_ID = "ckunkel.bp872kqi";

  // Example from your console: layers=MapBox-42vjbp
  const SOURCE_LAYER = "MapBox-42vjbp";

  // Your tileset fields (based on your CSV export)
  const FIELD_BRANCH = "BranchName";
  const FIELD_GROUP = "ProductGroupLevel1";
  const FIELD_SALEDATEKEY = "SaleDateKey"; // numeric like 20260102
  const FIELD_SALES = "TotalSales";
  const FIELD_TICKETS = "TicketCount";

  // Where filter lists live (GitHub Pages)
  // Option A: one file containing { branches:[], groups:[] }
  const FILTERS_URL = "filters.json";
  // Option B: separate lists (if you prefer)
  const BRANCHES_URL = "branches.json";
  const GROUPS_URL = "groups.json";

  // Tilequery sampling (fallback only if groups missing)
  // (Keep small to avoid rate limits; you can add more later)
  const SAMPLE_POINTS = [
    { name: "Brenham-ish", lon: -96.3698, lat: 30.6744 },
    { name: "Bryan-ish", lon: -96.3698, lat: 30.6744 }, // swap if you have exact
    { name: "Austin", lon: -97.7431, lat: 30.2672 },
    { name: "Houston", lon: -95.3698, lat: 29.7604 },
    { name: "Dallas", lon: -96.7969, lat: 32.7763 },
  ];

  // ========= DOM =========
  const elBranch = document.getElementById("branchSelect");
  const elGroup = document.getElementById("groupSelect");
  const elStart = document.getElementById("startDate");
  const elEnd = document.getElementById("endDate");
  const elApply = document.getElementById("applyBtn");
  const elClear = document.getElementById("clearBtn");
  const elMetricSales = document.getElementById("metricSales");
  const elMetricTickets = document.getElementById("metricTickets");
  const elStatus = document.getElementById("status");

  const setStatus = (txt) => {
    if (elStatus) elStatus.textContent = txt || "";
  };

  // ========= STATE =========
  const state = {
    metric: "sales", // "sales" | "tickets"
    branch: "__ALL__",
    group: "__ALL__",
    startKey: null, // numeric SaleDateKey
    endKey: null,   // numeric SaleDateKey
    branches: [],
    groups: [],
    mapLoaded: false,
  };

  // ========= HELPERS =========
  function pad2(n) { return String(n).padStart(2, "0"); }

  // Converts "YYYY-MM-DD" -> 20260102
  function dateToKey(dateStr) {
    if (!dateStr) return null;
    // Expecting HTML date input format
    const [y, m, d] = dateStr.split("-").map((x) => parseInt(x, 10));
    if (!y || !m || !d) return null;
    return (y * 10000) + (m * 100) + d;
  }

  function clampKeyRange() {
    state.startKey = dateToKey(elStart?.value);
    state.endKey = dateToKey(elEnd?.value);

    // If user sets only start, keep end open-ended. If only end, keep start open-ended.
    // If both and swapped, swap.
    if (state.startKey && state.endKey && state.startKey > state.endKey) {
      const t = state.startKey;
      state.startKey = state.endKey;
      state.endKey = t;
    }
  }

  function uniqueSorted(arr) {
    return Array.from(new Set(arr.filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }

  function fillSelect(selectEl, items, allLabel) {
    if (!selectEl) return;
    const current = selectEl.value || "__ALL__";
    selectEl.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = "__ALL__";
    optAll.textContent = allLabel;
    selectEl.appendChild(optAll);

    items.forEach((v) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      selectEl.appendChild(o);
    });

    // restore selection if possible
    if ([...selectEl.options].some(o => o.value === current)) {
      selectEl.value = current;
    } else {
      selectEl.value = "__ALL__";
    }
  }

  // Safe numeric expression: coalesce(to-number(get(field)), 0)
  function numFieldExpr(fieldName) {
    return ["coalesce", ["to-number", ["get", fieldName]], 0];
  }

  function metricExpr() {
    return state.metric === "tickets" ? numFieldExpr(FIELD_TICKETS) : numFieldExpr(FIELD_SALES);
  }

  // ========= MAP INIT =========
  const map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/light-v11",
    center: [-96.5, 30.4],
    zoom: 6.3,
  });

  const SOURCE_ID = "wl-zip-sales";
  const HEAT_LAYER_ID = "wl-heat";
  const POINT_LAYER_ID = "wl-points";

  map.on("load", () => {
    state.mapLoaded = true;
    log(`${LOG_PREFIX} Map loaded. Adding layers...`);

    // Add vector source
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: "vector",
        url: `mapbox://${TILESET_ID}`,
      });
    }

    // Heatmap layer
    if (!map.getLayer(HEAT_LAYER_ID)) {
      map.addLayer({
        id: HEAT_LAYER_ID,
        type: "heatmap",
        source: SOURCE_ID,
        "source-layer": SOURCE_LAYER,
        paint: {
          // weight based on metric (sales or tickets)
          "heatmap-weight": [
            "interpolate",
            ["linear"],
            ["ln", ["+", 1, metricExpr()]],
            0, 0,
            8, 1
          ],
          "heatmap-intensity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            5, 0.8,
            10, 1.6
          ],
          "heatmap-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            5, 10,
            9, 22,
            12, 40
          ],
          "heatmap-opacity": 0.85
        }
      });
    }

    // Point layer (optional)
    if (!map.getLayer(POINT_LAYER_ID)) {
      map.addLayer({
        id: POINT_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        "source-layer": SOURCE_LAYER,
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["ln", ["+", 1, metricExpr()]],
            0, 2,
            6, 8,
            9, 14
          ],
          "circle-opacity": 0.45
        }
      });
    }

    // Apply initial filters
    applyFiltersToMap();
    setMetricUI("sales");
    log(`${LOG_PREFIX} Ready`);
  });

  // ========= FILTER EXPRESSION =========
  function buildFilterExpr() {
    const filters = ["all"];

    // Branch filter
    if (state.branch && state.branch !== "__ALL__") {
      filters.push(["==", ["get", FIELD_BRANCH], state.branch]);
    }

    // Group filter
    if (state.group && state.group !== "__ALL__") {
      filters.push(["==", ["get", FIELD_GROUP], state.group]);
    }

    // Date range using numeric SaleDateKey
    // Note: SaleDateKey might be stored as string in tiles, so convert.
    const saleKeyExpr = ["coalesce", ["to-number", ["get", FIELD_SALEDATEKEY]], 0];

    if (state.startKey) {
      filters.push([">=", saleKeyExpr, state.startKey]);
    }
    if (state.endKey) {
      filters.push(["<=", saleKeyExpr, state.endKey]);
    }

    return filters;
  }

  function applyFiltersToMap() {
    if (!state.mapLoaded) return;

    const filterExpr = buildFilterExpr();

    // apply to both layers
    if (map.getLayer(HEAT_LAYER_ID)) map.setFilter(HEAT_LAYER_ID, filterExpr);
    if (map.getLayer(POINT_LAYER_ID)) map.setFilter(POINT_LAYER_ID, filterExpr);

    // update metric-driven paint props
    updateMetricPaint();

    log(`${LOG_PREFIX} Applied filters • Metric: ${state.metric === "tickets" ? "Tickets" : "Sales"}`);
  }

  function updateMetricPaint() {
    if (!state.mapLoaded) return;

    // Update heatmap weight
    if (map.getLayer(HEAT_LAYER_ID)) {
      map.setPaintProperty(HEAT_LAYER_ID, "heatmap-weight", [
        "interpolate",
        ["linear"],
        ["ln", ["+", 1, metricExpr()]],
        0, 0,
        8, 1
      ]);
    }

    // Update point radius
    if (map.getLayer(POINT_LAYER_ID)) {
      map.setPaintProperty(POINT_LAYER_ID, "circle-radius", [
        "interpolate",
        ["linear"],
        ["ln", ["+", 1, metricExpr()]],
        0, 2,
        6, 8,
        9, 14
      ]);
    }
  }

  // ========= UI WIRING =========
  function setMetricUI(metric) {
    state.metric = metric;

    if (elMetricSales) elMetricSales.classList.toggle("active", metric === "sales");
    if (elMetricTickets) elMetricTickets.classList.toggle("active", metric === "tickets");

    log(`${LOG_PREFIX} Metric set to ${metric === "tickets" ? "Tickets" : "Sales"}`);
    applyFiltersToMap();
  }

  function wireUI() {
    // Branch/group dropdown changes update state (do not auto-apply unless you want it)
    elBranch?.addEventListener("change", () => {
      state.branch = elBranch.value || "__ALL__";
    });

    elGroup?.addEventListener("change", () => {
      state.group = elGroup.value || "__ALL__";
    });

    // Date inputs
    elStart?.addEventListener("change", () => clampKeyRange());
    elEnd?.addEventListener("change", () => clampKeyRange());

    // Apply
    elApply?.addEventListener("click", () => {
      clampKeyRange();
      state.branch = elBranch?.value || "__ALL__";
      state.group = elGroup?.value || "__ALL__";
      applyFiltersToMap();
    });

    // Clear
    elClear?.addEventListener("click", () => {
      if (elBranch) elBranch.value = "__ALL__";
      if (elGroup) elGroup.value = "__ALL__";
      if (elStart) elStart.value = "";
      if (elEnd) elEnd.value = "";

      state.branch = "__ALL__";
      state.group = "__ALL__";
      state.startKey = null;
      state.endKey = null;

      applyFiltersToMap();
      setStatus("");
      log(`${LOG_PREFIX} Cleared filters`);
    });

    // Metric toggles
    elMetricSales?.addEventListener("click", () => setMetricUI("sales"));
    elMetricTickets?.addEventListener("click", () => setMetricUI("tickets"));
  }

  // ========= LOAD FILTER LISTS =========
  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  }

  async function loadFilters() {
    log(`${LOG_PREFIX} Loading filter lists...`);
    setStatus("Loading filters...");

    // 1) Try filters.json
    try {
      const data = await fetchJson(FILTERS_URL);
      const branches = Array.isArray(data.branches) ? data.branches : [];
      const groups = Array.isArray(data.groups) ? data.groups : [];

      state.branches = uniqueSorted(branches);
      state.groups = uniqueSorted(groups);

      fillSelect(elBranch, state.branches, "All branches");
      fillSelect(elGroup, state.groups, "All product groups");

      log(`${LOG_PREFIX} Loaded filters.json • ${state.branches.length} branches • ${state.groups.length} groups`);
      setStatus(`Filters loaded (${state.branches.length} branches, ${state.groups.length} groups).`);

      // If groups is empty, try groups.json next
      if (state.groups.length === 0) {
        await tryLoadSplitLists();
      }

      // If still empty, fallback sampling
      if (state.groups.length === 0) {
        await fallbackSampleTilequery();
      }

      return;
    } catch (e) {
      warn(`${LOG_PREFIX} filters.json not available (${e.message}). Trying branches.json/groups.json...`);
    }

    // 2) Try split lists
    await tryLoadSplitLists();

    // 3) Fallback sampling
    if (state.groups.length === 0) {
      await fallbackSampleTilequery();
    }
  }

  async function tryLoadSplitLists() {
    let branches = [];
    let groups = [];

    try {
      const b = await fetchJson(BRANCHES_URL);
      branches = Array.isArray(b) ? b : (Array.isArray(b.branches) ? b.branches : []);
    } catch (_) {}

    try {
      const g = await fetchJson(GROUPS_URL);
      groups = Array.isArray(g) ? g : (Array.isArray(g.groups) ? g.groups : []);
    } catch (_) {}

    if (branches.length) state.branches = uniqueSorted(branches);
    if (groups.length) state.groups = uniqueSorted(groups);

    fillSelect(elBranch, state.branches, "All branches");
    fillSelect(elGroup, state.groups, "All product groups");

    log(`${LOG_PREFIX} Loaded split lists • ${state.branches.length} branches • ${state.groups.length} groups`);
    setStatus(`Filters loaded (${state.branches.length} branches, ${state.groups.length} groups).`);
  }

  // Only used if you forgot to generate product group list JSON
  async function fallbackSampleTilequery() {
    setStatus("Loading product groups (sampling tiles)...");

    const token = mapboxgl.accessToken;
    if (!token || token.includes("YOUR_MAPBOX_PUBLIC_TOKEN_HERE")) {
      warn(`${LOG_PREFIX} No Mapbox token set; cannot tilequery sample.`);
      setStatus("No token set; cannot auto-discover product groups.");
      return;
    }

    const groupsSet = new Set(state.groups);
    const branchesSet = new Set(state.branches);

    // Mapbox tilequery endpoint expects tileset id WITHOUT username? It uses v4/{tileset}
    // In your earlier logs it was /v4/ckunkel.bp872kqi/tilequery/...
    const tilequeryBase = `https://api.mapbox.com/v4/${TILESET_ID}/tilequery`;

    // We'll keep radius modest to avoid 422 + heavy payloads
    const radius = 8000;
    const limit = 5000;

    for (const p of SAMPLE_POINTS) {
      const url =
        `${tilequeryBase}/${p.lon},${p.lat}.json` +
        `?radius=${radius}&limit=${limit}` +
        `&layers=${encodeURIComponent(SOURCE_LAYER)}` +
        `&access_token=${encodeURIComponent(token)}`;

      try {
        const res = await fetch(url);
        if (!res.ok) {
          warn(`${LOG_PREFIX} tilequery failed ${res.status} @ ${p.name}`);
          continue;
        }
        const json = await res.json();
        const feats = Array.isArray(json.features) ? json.features : [];
        feats.forEach((f) => {
          const props = f.properties || {};
          if (props[FIELD_GROUP]) groupsSet.add(props[FIELD_GROUP]);
          if (props[FIELD_BRANCH]) branchesSet.add(props[FIELD_BRANCH]);
        });
      } catch (e) {
        warn(`${LOG_PREFIX} tilequery error @ ${p.name}`, e);
      }
    }

    state.groups = uniqueSorted(Array.from(groupsSet));
    state.branches = uniqueSorted(Array.from(branchesSet));

    fillSelect(elBranch, state.branches, "All branches");
    fillSelect(elGroup, state.groups, "All product groups");

    log(`${LOG_PREFIX} Loaded filters from sampled tiles (fallback)`);
    setStatus(`Filters loaded (${state.branches.length} branches, ${state.groups.length} groups).`);
  }

  // ========= START =========
  wireUI();
  loadFilters()
    .catch((e) => {
      warn(`${LOG_PREFIX} Failed to load filters`, e);
      setStatus("Failed to load filters.");
    });

})();
