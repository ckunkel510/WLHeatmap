/* app.leaflet.js — Woodson Zip Sales Heatmap (Leaflet + VectorGrid; no WebGL)
   Goal: behave reliably inside BisTrack dashboards where WebGL / readPixels can break Mapbox GL JS interactivity.
*/

(() => {
  const LOG_PREFIX = "[WLHeatmap-Leaflet]";
  const log = (...args) => console.log(LOG_PREFIX, ...args);

  // =========================
  // Config
  // =========================
  const TOKEN = window.WL_MAPBOX_TOKEN || "";
  const TILESET_ID = "ckunkel.bp872kqi";          // same tileset id
  const SOURCE_LAYER = "MapBox-42vjbp";           // same source-layer name inside pbf
  const FILTERS_URL = "filters.json";

  // Fields
  const FIELD_BRANCH = "BranchName";
  const FIELD_GROUP = "ProductGroupLevel1";
  const FIELD_SALES = "TotalSales";
  const FIELD_TICKETS = "TicketCount";
  const FIELD_SALEDATE_KEY = "SaleDateKey";
  const FIELD_SALEDATE_BOM = "\ufeffSaleDate"; // M/D/YYYY string in some exports

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

  const setStatus = (msg) => { if (els.status) els.status.textContent = msg || ""; };

  // =========================
  // State
  // =========================
  const state = {
    metric: "sales",     // sales | tickets
    branch: "__ALL__",
    group: "__ALL__",
    startKey: null,      // YYYYMMDD
    endKey: null,
  };

  // =========================
  // Helpers
  // =========================
  function dateToKey(yyyy_mm_dd) {
    if (!yyyy_mm_dd) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyy_mm_dd);
    if (!m) return null;
    return (Number(m[1]) * 10000) + (Number(m[2]) * 100) + Number(m[3]);
  }

  function parseMDYToKey(mdy) {
    // "M/D/YYYY" or "MM/DD/YYYY"
    if (!mdy || typeof mdy !== "string") return null;
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(mdy.trim());
    if (!m) return null;
    const mo = Number(m[1]);
    const d = Number(m[2]);
    const y = Number(m[3]);
    return (y * 10000) + (mo * 100) + d;
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function passesDate(props) {
    if (state.startKey == null && state.endKey == null) return true;

    // Prefer numeric key if present.
    const k = props?.[FIELD_SALEDATE_KEY] ?? props?.["\ufeffSaleDateKey"];
    let key = Number.isFinite(Number(k)) ? Number(k) : null;

    if (key == null) {
      const raw = props?.[FIELD_SALEDATE_BOM] ?? props?.["SaleDate"];
      key = parseMDYToKey(raw);
    }

    if (key == null) return true; // if we can't read, don't block

    if (state.startKey != null && key < state.startKey) return false;
    if (state.endKey != null && key > state.endKey) return false;
    return true;
  }

  function passesFilters(props) {
    if (!props) return false;

    if (state.branch !== "__ALL__" && props[FIELD_BRANCH] !== state.branch) return false;
    if (state.group !== "__ALL__" && props[FIELD_GROUP] !== state.group) return false;
    if (!passesDate(props)) return false;

    return true;
  }

  function getMetricValue(props) {
    if (!props) return 0;
    return state.metric === "tickets" ? num(props[FIELD_TICKETS]) : num(props[FIELD_SALES]);
  }

  // Simple intensity -> circle size
  function radiusFor(v) {
    // Tune these to taste; keep lightweight for dashboards.
    if (v <= 0) return 0;
    if (v < 100) return 4;
    if (v < 500) return 6;
    if (v < 1500) return 8;
    if (v < 5000) return 10;
    return 12;
  }

  // Intensity -> fill opacity
  function alphaFor(v) {
    if (v <= 0) return 0;
    if (v < 100) return 0.25;
    if (v < 500) return 0.35;
    if (v < 1500) return 0.45;
    if (v < 5000) return 0.55;
    return 0.65;
  }

  function setMetricUI(metric) {
    state.metric = metric;
    const isSales = metric === "sales";
    els.metricSales?.classList.toggle("active", isSales);
    els.metricTickets?.classList.toggle("active", !isSales);
    log("Metric set to", metric);
  }

  // =========================
  // Map init
  // =========================
  if (!TOKEN) {
    setStatus("Missing Mapbox token.");
    console.error(LOG_PREFIX, "Missing Mapbox token.");
    return;
  }

  setStatus("Loading map...");

  const map = L.map("map", {
    center: [30.6, -96.7],
    zoom: 7,
    preferCanvas: true,
    zoomControl: true,
  });

  // Basemap (OSM raster). No Mapbox GL / WebGL.
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);

  // Vector tile URL for Mapbox classic tiles endpoint
  // (vector pbf, works with VectorGrid)
  const vtUrl = `https://api.mapbox.com/v4/${TILESET_ID}/{z}/{x}/{y}.vector.pbf?access_token=${TOKEN}`;

  // Create popup once
  const popup = L.popup({ closeButton: true, autoPan: true });

  let vg; // vector grid layer

  function makeStyle(props) {
    // If it doesn't pass filters, make it invisible and non-interactive.
    if (!passesFilters(props)) {
      return { fill: false, stroke: false, fillOpacity: 0, opacity: 0, radius: 0 };
    }

    const v = getMetricValue(props);
    const r = radiusFor(v);
    const a = alphaFor(v);

    // NOTE: Leaflet VectorGrid supports "radius" for point features.
    // We keep a single neutral color and let radius/alpha do the work.
    return {
      weight: 0,
      color: "#111827",
      opacity: 0,
      fillColor: "#111827",
      fillOpacity: a,
      radius: r,
    };
  }

  function buildVectorGrid() {
    if (vg) {
      map.removeLayer(vg);
      vg = null;
    }

    vg = L.vectorGrid.protobuf(vtUrl, {
      vectorTileLayerStyles: {
        [SOURCE_LAYER]: (props /*, z */) => makeStyle(props),
      },
      interactive: true,
      getFeatureId: (f) => {
        // Prefer Zip as stable id if present; else fallback.
        const p = f?.properties || {};
        return p.Zip || p.ZIP || p.PostalCode || p.postal || `${p[FIELD_BRANCH] || ""}-${p[FIELD_GROUP] || ""}-${p[FIELD_SALES] || ""}`;
      },
      maxNativeZoom: 14,
    });

    vg.on("click", (e) => {
      const props = e?.layer?.properties;
      if (!props || !passesFilters(props)) return;

      const zip = props.Zip || props.ZIP || props.PostalCode || props.postal || "(zip unknown)";
      const branch = props[FIELD_BRANCH] || "";
      const group = props[FIELD_GROUP] || "";
      const sales = num(props[FIELD_SALES]).toLocaleString();
      const tickets = num(props[FIELD_TICKETS]).toLocaleString();

      const html = `
        <div class="wl-pop">
          <h3>Zip ${zip}</h3>
          <div><span class="k">Branch:</span> <span class="v">${branch}</span></div>
          <div><span class="k">Group:</span> <span class="v">${group}</span></div>
          <div style="margin-top:6px;"><span class="k">Sales:</span> <span class="v">$${sales}</span></div>
          <div><span class="k">Tickets:</span> <span class="v">${tickets}</span></div>
        </div>
      `;

      popup.setLatLng(e.latlng).setContent(html).openOn(map);
    });

    vg.addTo(map);
  }

  function redraw() {
    if (!vg) return;
    // VectorGrid doesn't have a public setFilter; we redraw by triggering style function.
    vg.redraw();
  }

  // =========================
  // Filters list loader
  // =========================
  async function loadFilterLists() {
    try {
      log("Loading filter lists...");
      const res = await fetch(FILTERS_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load ${FILTERS_URL} (${res.status})`);
      const data = await res.json();

      const branches = (data.branches || []).slice().sort();
      const groups = (data.groups || []).slice().sort();

      // populate selects
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
      setStatus("Ready");
    } catch (err) {
      console.error(LOG_PREFIX, err);
      setStatus("Loaded map (filters list failed)." );
    }
  }

  // =========================
  // Apply/Clear
  // =========================
  function applyFromUI() {
    state.branch = els.branchSelect?.value || "__ALL__";
    state.group = els.groupSelect?.value || "__ALL__";
    state.startKey = dateToKey(els.startDate?.value);
    state.endKey = dateToKey(els.endDate?.value);

    // Normalize range if swapped
    if (state.startKey != null && state.endKey != null && state.startKey > state.endKey) {
      const tmp = state.startKey;
      state.startKey = state.endKey;
      state.endKey = tmp;
    }

    log("Applied", JSON.stringify(state));
    redraw();
  }

  function clearUI() {
    if (els.branchSelect) els.branchSelect.value = "__ALL__";
    if (els.groupSelect) els.groupSelect.value = "__ALL__";
    if (els.startDate) els.startDate.value = "";
    if (els.endDate) els.endDate.value = "";
    setMetricUI("sales");

    state.branch = "__ALL__";
    state.group = "__ALL__";
    state.startKey = null;
    state.endKey = null;

    redraw();
  }

  // =========================
  // Wire events
  // =========================
  els.metricSales?.addEventListener("click", () => { setMetricUI("sales"); redraw(); });
  els.metricTickets?.addEventListener("click", () => { setMetricUI("tickets"); redraw(); });

  els.applyBtn?.addEventListener("click", applyFromUI);
  els.clearBtn?.addEventListener("click", clearUI);

  // Auto-apply in dashboards (clicks sometimes get eaten).
  els.branchSelect?.addEventListener("change", applyFromUI);
  els.groupSelect?.addEventListener("change", applyFromUI);
  els.startDate?.addEventListener("change", applyFromUI);
  els.endDate?.addEventListener("change", applyFromUI);

  // Build map + layer
  buildVectorGrid();
  loadFilterLists();
  setStatus("Ready");

  // In embedded dashboards, force a resize/recalc once (prevents "dead" canvas).
  setTimeout(() => map.invalidateSize(true), 250);
  setTimeout(() => map.invalidateSize(true), 1200);

})();
