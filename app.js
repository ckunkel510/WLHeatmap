/* WLHeatmap Leaflet fallback (v2)
 * Fixes Mapbox Vector Tiles 404 spam by:
 *  - Setting initial view to Texas (so requests hit your data tiles)
 *  - Locking maxBounds + noWrap (so Leaflet doesn't request world tiles)
 *  - Setting sensible zoom limits
 *
 * NOTE: 404s can still happen for truly-empty tiles; with bounds set, it should be minimal.
 */
(function () {
  const LOG = (...a) => console.log("[WLHeatmap-Leaflet]", ...a);

  // ---- Config ----
  const MAPBOX_TOKEN =
    "pk.eyJ1IjoiY2t1bmtlbCIsImEiOiJjbWx1Yjc4ODIwOW51M2Zwdm15dHFodnh1In0.F2yytru7jt9khYyPziZrHw";
  const TILESET_ID = "ckunkel.bp872kqi"; // tileset id in username.id format
  const SOURCE_LAYER = "MapBox-42vjbp";   // vector layer name inside the tiles
  const FILTERS_URL = "filters.json";

  // Texas-ish defaults (covers your branches)
  const DEFAULT_CENTER = [31.35, -96.35];
  const DEFAULT_ZOOM = 7;
  const MIN_ZOOM = 6;
  const MAX_ZOOM = 12;

  // Clamp panning to a generous Texas + nearby buffer to avoid off-data tile requests
  const MAX_BOUNDS = L.latLngBounds(
    L.latLng(24.0, -107.5), // SW
    L.latLng(37.5, -88.0)   // NE
  );

  // ---- State ----
  let state = { metric: "sales", branch: "__ALL__", group: "__ALL__", startKey: null, endKey: null };
  let filtersData = null;
  let vgrid = null;
  let leafletMap = null;

  // ---- Helpers ----
  const byId = (id) => document.getElementById(id);

  function parseKey(dateStr) {
    // expects YYYY-MM-DD from <input type="date">
    if (!dateStr) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
    if (!m) return null;
    return `${m[1]}${m[2]}${m[3]}`; // YYYYMMDD
  }

  function clampView() {
    if (!leafletMap) return;
    leafletMap.setMaxBounds(MAX_BOUNDS);
    leafletMap.on("drag", () => leafletMap.panInsideBounds(MAX_BOUNDS, { animate: false }));
  }

  function makeTileUrl() {
    // Mapbox Vector Tiles API (v4). Docs: https://docs.mapbox.com/api/maps/vector-tiles/
    return `https://api.mapbox.com/v4/${TILESET_ID}/{z}/{x}/{y}.vector.pbf?access_token=${encodeURIComponent(MAPBOX_TOKEN)}`;
  }

  function featurePassesFilters(props) {
    // Branch / Group filters
    if (state.branch !== "__ALL__" && props.BranchName !== state.branch) return false;
    if (state.group !== "__ALL__" && props.ProductGroup !== state.group) return false;

    // Date range filtering using YYYYMMDD (expects properties StartKey/EndKey on features)
    if (state.startKey || state.endKey) {
      const fk1 = props.StartKey || props.startKey || null;
      const fk2 = props.EndKey || props.endKey || null;
      // If your data is per-day with a single key, we tolerate one of them.
      const featureStart = fk1 || fk2;
      const featureEnd = fk2 || fk1;

      if (state.startKey && featureEnd && String(featureEnd) < String(state.startKey)) return false;
      if (state.endKey && featureStart && String(featureStart) > String(state.endKey)) return false;
    }

    return true;
  }

  function metricValue(props) {
    if (state.metric === "tickets") return +props.Tickets || 0;
    return +props.Sales || 0;
  }

  function colorForValue(v) {
    // simple stepped ramp (match your existing feel)
    if (v <= 0) return "#e5e7eb";
    if (v < 500) return "#dbeafe";
    if (v < 2000) return "#93c5fd";
    if (v < 8000) return "#3b82f6";
    return "#1d4ed8";
  }

  function styleFn(props) {
    if (!featurePassesFilters(props)) {
      return { weight: 0, fill: false, stroke: false, fillOpacity: 0 };
    }
    const v = metricValue(props);
    return {
      weight: 1,
      color: "#374151",
      fill: true,
      fillColor: colorForValue(v),
      fillOpacity: 0.85,
    };
  }

  function buildVectorGrid() {
    if (vgrid) {
      leafletMap.removeLayer(vgrid);
      vgrid = null;
    }

    vgrid = L.vectorGrid.protobuf(makeTileUrl(), {
      rendererFactory: L.canvas.tile,
      vectorTileLayerStyles: {
        [SOURCE_LAYER]: (props) => styleFn(props),
      },
      interactive: true,
      maxNativeZoom: MAX_ZOOM,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      noWrap: true,
      // keep features available for clicks
      getFeatureId: (f) => {
        const p = f.properties || {};
        return `${p.BranchName || ""}|${p.ProductGroup || ""}|${p.StartKey || p.startKey || ""}|${p.EndKey || p.endKey || ""}|${p.id || ""}`;
      },
    });

    vgrid.on("click", (e) => {
      const p = e.layer && e.layer.properties ? e.layer.properties : (e.properties || {});
      if (!p) return;
      if (!featurePassesFilters(p)) return;

      const html = `
        <div style="font-family:Tahoma;font-size:12px;min-width:220px">
          <div style="font-weight:bold;margin-bottom:6px">${p.BranchName || "?"} • ${p.ProductGroup || "?"}</div>
          <div><b>Sales:</b> ${(+p.Sales || 0).toLocaleString()}</div>
          <div><b>Tickets:</b> ${(+p.Tickets || 0).toLocaleString()}</div>
          ${(p.StartKey || p.startKey) ? `<div><b>Start:</b> ${(p.StartKey || p.startKey)}</div>` : ``}
          ${(p.EndKey || p.endKey) ? `<div><b>End:</b> ${(p.EndKey || p.endKey)}</div>` : ``}
        </div>
      `;
      L.popup({ closeButton: true, autoPan: true })
        .setLatLng(e.latlng)
        .setContent(html)
        .openOn(leafletMap);
    });

    vgrid.addTo(leafletMap);
  }

  function applyFilters() {
    LOG("[DEBUG] state:", JSON.stringify(state));
    if (!vgrid) return;
    // Rebuild styles by resetting style function (cheap enough at our scale)
    vgrid.setFeatureStyle = vgrid.setFeatureStyle || function () {};
    vgrid.redraw();
    LOG("Applied filters • Metric:", state.metric);
  }

  function wireControls() {
    const metricSelect = byId("metricSelect");
    const branchSelect = byId("branchSelect");
    const groupSelect = byId("groupSelect");
    const startDate = byId("startDate");
    const endDate = byId("endDate");
    const applyBtn = byId("applyBtn");
    const clearBtn = byId("clearBtn");

    function syncFromUI() {
      state.metric = (metricSelect && metricSelect.value) || "sales";
      state.branch = (branchSelect && branchSelect.value) || "__ALL__";
      state.group = (groupSelect && groupSelect.value) || "__ALL__";
      state.startKey = parseKey(startDate ? startDate.value : "");
      state.endKey = parseKey(endDate ? endDate.value : "");
    }

    const onChange = () => {
      syncFromUI();
      applyFilters();
    };

    [metricSelect, branchSelect, groupSelect, startDate, endDate].forEach((el) => {
      if (!el) return;
      el.addEventListener("change", onChange);
    });

    if (applyBtn) applyBtn.addEventListener("click", onChange);

    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        if (metricSelect) metricSelect.value = "sales";
        if (branchSelect) branchSelect.value = "__ALL__";
        if (groupSelect) groupSelect.value = "__ALL__";
        if (startDate) startDate.value = "";
        if (endDate) endDate.value = "";
        onChange();
      });
    }

    // Initial
    syncFromUI();
  }

  async function loadFilters() {
    LOG("Loading filter lists...");
    const res = await fetch(FILTERS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${FILTERS_URL}: ${res.status}`);
    filtersData = await res.json();
    LOG(`Loaded filters.json • ${filtersData.branches?.length || 0} branches • ${filtersData.groups?.length || 0} groups`);

    const branchSelect = byId("branchSelect");
    const groupSelect = byId("groupSelect");

    if (branchSelect) {
      // Keep first option (__ALL__) already in HTML
      (filtersData.branches || []).forEach((b) => {
        const opt = document.createElement("option");
        opt.value = b;
        opt.textContent = b;
        branchSelect.appendChild(opt);
      });
    }

    if (groupSelect) {
      (filtersData.groups || []).forEach((g) => {
        const opt = document.createElement("option");
        opt.value = g;
        opt.textContent = g;
        groupSelect.appendChild(opt);
      });
    }
  }

  function init() {
    const mapEl = byId("map");
    if (!mapEl) {
      console.error("[WLHeatmap-Leaflet] #map not found");
      return;
    }

    leafletMap = L.map(mapEl, {
      zoomControl: true,
      preferCanvas: true,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      worldCopyJump: false,
      inertia: true,
    }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    clampView();

    // Basemap (raster) — light and reliable in WebView
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
      noWrap: true,
      bounds: MAX_BOUNDS,
    }).addTo(leafletMap);

    buildVectorGrid();
    wireControls();
    applyFilters();
  }

  // Boot
  (async () => {
    try {
      await loadFilters();
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
      } else {
        init();
      }
    } catch (e) {
      console.error("[WLHeatmap-Leaflet] Fatal:", e);
    }
  })();
})();
