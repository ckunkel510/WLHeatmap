/* app.js — Woodson Zip Sales Heatmap (Mapbox GL JS v3)
   - Filters: BranchName, ProductGroupLevel1, date range (from BOM SaleDate)
   - Metric toggle: TotalSales vs TicketCount
   - Heatmap appearance: unchanged

   Dashboard-hardened build (BisTrack):
   - Waits for DOM + #map container (dashboards often inject HTML late)
   - Avoids double-boot when dashboards re-render widgets
   - Uses more reliable click-to-open tooltip (global click hit-test)
   - Auto-applies filters on change (in addition to Apply button)
*/

(() => {
  // Prevent double-boot in dashboards that re-run scripts on refresh/repaint
  if (window.__WLHeatmapBooted) {
    console.warn("[WLHeatmap] Already booted — skipping duplicate init.");
    return;
  }
  window.__WLHeatmapBooted = true;

  const LOG_PREFIX = "[WLHeatmap]";
  const log = (...args) => console.log(LOG_PREFIX, ...args);

  // =========================
  // EDIT THESE IF NEEDED
  // =========================
  const TILESET_ID = "ckunkel.bp872kqi";
  const SOURCE_LAYER = "MapBox-42vjbp";
  const FILTERS_URL = "filters.json";

  // BOM field name we saw in your tileset properties: "﻿SaleDate"
  const BOM_SALEDATE_FIELD = "\ufeffSaleDate";

  // =========================
  // Dashboard-friendly boot helpers
  // =========================
  function onReady(fn) {
    if (document.readyState === "complete" || document.readyState === "interactive") {
      fn();
    } else {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    }
  }

  // Wait for an element to exist (MutationObserver) — crucial for BisTrack dashboard HTML injection.
  function waitForElement(selector, { timeoutMs = 20000 } = {}) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        obs.disconnect();
        reject(new Error(`Timeout waiting for ${selector}`));
      }, timeoutMs);

      const obs = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found && !done) {
          done = true;
          clearTimeout(timer);
          obs.disconnect();
          resolve(found);
        }
      });

      obs.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  // Resolve a control that may be injected late
  const getById = (id) => document.getElementById(id);

  // =========================
  // State
  // =========================
  const state = {
    metric: "sales", // "sales" | "tickets"
    branch: "__ALL__",
    group: "__ALL__",
    startKey: null, // YYYYMMDD int
    endKey: null,   // YYYYMMDD int
  };

  const METRICS = {
    sales: { label: "Sales", prop: "TotalSales" },
    tickets: { label: "Tickets", prop: "TicketCount" },
  };

  // =========================
  // Helpers
  // =========================
  function dateToKey(yyyy_mm_dd) {
    if (!yyyy_mm_dd) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyy_mm_dd);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    return (y * 10000) + (mo * 100) + d;
  }

  function keyToDate(key) {
    if (!key) return null;
    const y = Math.floor(key / 10000);
    const m = Math.floor((key % 10000) / 100);
    const d = key % 100;
    return new Date(y, m - 1, d);
  }

  function formatMDY(dt) {
    const m = dt.getMonth() + 1;
    const d = dt.getDate();
    const y = dt.getFullYear();
    return `${m}/${d}/${y}`;
  }

  function buildAllowedSaleDates(startKey, endKey) {
    const sdt = keyToDate(startKey);
    const edt = keyToDate(endKey);
    if (!sdt || !edt) return [];
    sdt.setHours(0, 0, 0, 0);
    edt.setHours(0, 0, 0, 0);

    const dayMs = 24 * 60 * 60 * 1000;
    const days = Math.round((edt - sdt) / dayMs);
    if (days < 0) return [];
    if (days > 370) {
      console.warn("[WLHeatmap] Date range too large for SaleDate string filter:", days, "days. Narrow the range or add SaleDateKey to the layer properties.");
      return [];
    }

    const out = [];
    for (let i = 0; i <= days; i++) {
      const dt = new Date(sdt.getTime() + i * dayMs);
      out.push(formatMDY(dt));
    }
    return out;
  }

  function safeToNumberExpr(propName) {
    return ["coalesce", ["to-number", ["get", propName]], 0];
  }

  // Prefer numeric SaleDateKey in the tileset
  function saleDateKeyExpr() {
    return [
      "coalesce",
      ["to-number", ["get", "SaleDateKey"]],
      ["to-number", ["get", "\ufeffSaleDateKey"]],
      0,
    ];
  }

  // =========================
  // Map + layers
  // =========================
  const SOURCE_ID = "wl-zip-sales";
  const HEAT_LAYER_ID = "wl-heat";
  const POINT_LAYER_ID = "wl-points";

  let map = null; // assigned after mapboxgl.Map creates successfully

  function tilesetHasSaleDateKey() {
    if (!map) return false;
    try {
      const sfeats = map.querySourceFeatures(SOURCE_ID, { sourceLayer: SOURCE_LAYER });
      const sp = sfeats && sfeats[0] && sfeats[0].properties;
      if (sp) return (sp.SaleDateKey != null || sp["\ufeffSaleDateKey"] != null);

      const feats = map.queryRenderedFeatures({ layers: [POINT_LAYER_ID] });
      const p = feats && feats[0] && feats[0].properties;
      return !!(p && (p.SaleDateKey != null || p["\ufeffSaleDateKey"] != null));
    } catch {
      return false;
    }
  }

  function buildFilterExpr() {
    const expr = ["all"];

    if (state.branch && state.branch !== "__ALL__") {
      expr.push(["==", ["get", "BranchName"], state.branch]);
    }

    if (state.group && state.group !== "__ALL__") {
      expr.push(["==", ["get", "ProductGroupLevel1"], state.group]);
    }

    const dk = saleDateKeyExpr();
    const hasKey = tilesetHasSaleDateKey();

    if (hasKey) {
      if (state.startKey != null) expr.push([">=", dk, state.startKey]);
      if (state.endKey != null) expr.push(["<=", dk, state.endKey]);
    } else if (state.startKey != null || state.endKey != null) {
      const sKey = state.startKey ?? state.endKey;
      const eKey = state.endKey ?? state.startKey;
      const allowed = buildAllowedSaleDates(sKey, eKey);

      if (allowed.length) {
        expr.push(["in", ["get", BOM_SALEDATE_FIELD], ["literal", allowed]]);
      } else {
        console.warn("[WLHeatmap] Date filter skipped — SaleDateKey not visible and allowed date list is empty/too large.");
      }
    }

    return expr;
  }

  function ensureLayers() {
    if (!map) return;

    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: "vector",
        url: `mapbox://${TILESET_ID}`,
      });
    }

    const metricProp = METRICS[state.metric].prop;
    const metricNum = safeToNumberExpr(metricProp);

    if (!map.getLayer(HEAT_LAYER_ID)) {
      map.addLayer({
        id: HEAT_LAYER_ID,
        type: "heatmap",
        source: SOURCE_ID,
        "source-layer": SOURCE_LAYER,
        paint: {
          "heatmap-weight": [
            "interpolate", ["linear"], metricNum,
            0, 0,
            500, 0.25,
            2000, 0.6,
            10000, 1
          ],
          "heatmap-intensity": [
            "interpolate", ["linear"], ["zoom"],
            0, 0.7,
            7, 1.0,
            10, 1.4,
            12, 1.8
          ],
          "heatmap-radius": [
            "interpolate", ["linear"], ["zoom"],
            0, 10,
            7, 22,
            10, 34,
            12, 48
          ],
          "heatmap-opacity": [
            "interpolate", ["linear"], ["zoom"],
            6, 0.92,
            11, 0.78,
            13, 0.6
          ],
        },
      });
    }

    if (!map.getLayer(POINT_LAYER_ID)) {
      map.addLayer({
        id: POINT_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        "source-layer": SOURCE_LAYER,
        paint: {
          "circle-opacity": [
            "interpolate", ["linear"], ["zoom"],
            6, 0.08,
            9, 0.18,
            12, 0.35
          ],
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            6, 2,
            9, 3,
            12, 5
          ],
          "circle-color": "#111827",
        },
      });
    }
  }

  function updateMetricPaint() {
    if (!map) return;

    const metricProp = METRICS[state.metric].prop;
    const metricNum = safeToNumberExpr(metricProp);

    if (map.getLayer(HEAT_LAYER_ID)) {
      map.setPaintProperty(HEAT_LAYER_ID, "heatmap-weight", [
        "interpolate", ["linear"], metricNum,
        0, 0,
        500, 0.25,
        2000, 0.6,
        10000, 1
      ]);
    }
  }

  // =========================
  // UI + filters
  // =========================
  const els = {
    branchSelect: null,
    groupSelect: null,
    startDate: null,
    endDate: null,
    metricSales: null,
    metricTickets: null,
    applyBtn: null,
    clearBtn: null,
    status: null,
  };

  const setStatus = (msg) => {
    if (els.status) els.status.textContent = msg || "";
  };

  function setMetricUI(metric) {
    state.metric = metric;
    const isSales = metric === "sales";
    els.metricSales?.classList.toggle("active", isSales);
    els.metricTickets?.classList.toggle("active", !isSales);
    log("Metric set to", METRICS[metric].label);
  }

  function applyFilters() {
    // In dashboards, controls can disappear/re-render. Re-resolve lightly each time.
    els.branchSelect = els.branchSelect || getById("branchSelect");
    els.groupSelect  = els.groupSelect  || getById("groupSelect");
    els.startDate    = els.startDate    || getById("startDate");
    els.endDate      = els.endDate      || getById("endDate");

    state.branch = els.branchSelect?.value ?? "__ALL__";
    state.group = els.groupSelect?.value ?? "__ALL__";
    state.startKey = dateToKey(els.startDate?.value);
    state.endKey = dateToKey(els.endDate?.value);

    if (state.startKey != null && state.endKey != null && state.startKey > state.endKey) {
      const tmp = state.startKey;
      state.startKey = state.endKey;
      state.endKey = tmp;

      if (els.startDate && els.endDate) {
        const s = els.startDate.value;
        els.startDate.value = els.endDate.value;
        els.endDate.value = s;
      }
    }

    const filterExpr = buildFilterExpr();
    console.log("[WLHeatmap][DEBUG] state:", JSON.stringify(state));
    console.log("[WLHeatmap][DEBUG] filterExpr:", JSON.stringify(filterExpr));

    if (map) {
      try {
        if (map.getLayer(HEAT_LAYER_ID)) map.setFilter(HEAT_LAYER_ID, filterExpr);
      } catch (e) {
        console.error("[WLHeatmap][DEBUG] setFilter wl-heat failed", e, filterExpr);
      }

      try {
        if (map.getLayer(POINT_LAYER_ID)) map.setFilter(POINT_LAYER_ID, filterExpr);
      } catch (e) {
        console.error("[WLHeatmap][DEBUG] setFilter wl-points failed", e, filterExpr);
      }
    }

    const canDateFilterNow = (state.startKey != null || state.endKey != null) ? tilesetHasSaleDateKey() : true;
    const dateNote = (canDateFilterNow ? "" : " (SaleDateKey not visible — using SaleDate string filter)");

    setStatus(
      `Metric: ${METRICS[state.metric].label} • ` +
      `Branch: ${state.branch === "__ALL__" ? "All" : state.branch} • ` +
      `Group: ${state.group === "__ALL__" ? "All" : state.group} • ` +
      `Dates: ${state.startKey ?? "…"} → ${state.endKey ?? "…"}${dateNote}`
    );

    log("Applied filters • Metric:", METRICS[state.metric].label);
  }

  function clearFilters() {
    els.branchSelect = els.branchSelect || getById("branchSelect");
    els.groupSelect  = els.groupSelect  || getById("groupSelect");
    els.startDate    = els.startDate    || getById("startDate");
    els.endDate      = els.endDate      || getById("endDate");

    if (els.branchSelect) els.branchSelect.value = "__ALL__";
    if (els.groupSelect) els.groupSelect.value = "__ALL__";
    if (els.startDate) els.startDate.value = "";
    if (els.endDate) els.endDate.value = "";

    state.branch = "__ALL__";
    state.group = "__ALL__";
    state.startKey = null;
    state.endKey = null;

    applyFilters();
    log("Cleared filters");
  }

  function debounce(fn, ms) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function wireUI() {
    const debouncedApply = debounce(applyFilters, 150);

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

    // Dashboard-friendly: apply on change (buttons sometimes lose click focus inside the embedded host)
    els.branchSelect?.addEventListener("change", debouncedApply);
    els.groupSelect?.addEventListener("change", debouncedApply);
    els.startDate?.addEventListener("change", debouncedApply);
    els.endDate?.addEventListener("change", debouncedApply);

    els.startDate?.addEventListener("keydown", (e) => { if (e.key === "Enter") applyFilters(); });
    els.endDate?.addEventListener("keydown", (e) => { if (e.key === "Enter") applyFilters(); });
  }

  // =========================
  // Hover/Click tooltip
  // =========================
  function wirePointTooltip() {
    if (!map) return;

    const popup = new mapboxgl.Popup({
      closeButton: true,
      closeOnClick: true,
      maxWidth: "320px",
    });

    const fmtMoney = (v) => {
      const n = Number(v);
      if (!isFinite(n)) return "$0.00";
      return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
    };

    const fmtNum = (v) => {
      const n = Number(v);
      if (!isFinite(n)) return "0";
      return n.toLocaleString();
    };

    const getProp = (p, key) => (p && p[key] != null ? p[key] : undefined);

    // Cursor hint on layer
    map.on("mouseenter", POINT_LAYER_ID, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", POINT_LAYER_ID, () => { map.getCanvas().style.cursor = ""; });

    // More reliable in embedded hosts: global click + hit-test instead of layer click event
    map.on("click", (e) => {
      const hit = map.queryRenderedFeatures(e.point, { layers: [POINT_LAYER_ID] });
      const f = hit && hit[0];
      if (!f) return;

      const p0 = f.properties || {};
      const zip = getProp(p0, "Zip5") ?? "—";
      const branch = getProp(p0, "BranchName") ?? "—";

      // Aggregate across currently rendered + filtered features in the viewport
      const feats = map.queryRenderedFeatures({ layers: [POINT_LAYER_ID] }) || [];

      let ticketsSum = 0;
      let salesSum = 0;
      let profitSum = 0;
      const byGroup = new Map();
      let minDate = null;
      let maxDate = null;

      for (const ft of feats) {
        const p = ft.properties || {};
        const z = getProp(p, "Zip5");
        const b = getProp(p, "BranchName");
        if (String(z) !== String(zip)) continue;
        if (String(b) !== String(branch)) continue;

        const t = Number(getProp(p, "TicketCount")) || 0;
        const s = Number(getProp(p, "TotalSales")) || 0;
        const pr = Number(getProp(p, "TotalProfit")) || 0;

        ticketsSum += t;
        salesSum += s;
        profitSum += pr;

        if (state.group === "__ALL__") {
          const g = String(getProp(p, "ProductGroupLevel1") ?? "—");
          const cur = byGroup.get(g) || { tickets: 0, sales: 0, profit: 0 };
          cur.tickets += t;
          cur.sales += s;
          cur.profit += pr;
          byGroup.set(g, cur);
        }

        const sd =
          getProp(p, BOM_SALEDATE_FIELD) ??
          getProp(p, "SaleDate") ??
          getProp(p, "\ufeffSaleDateISO") ??
          getProp(p, "SaleDateISO") ??
          null;

        if (sd) {
          const dt = new Date(String(sd));
          if (!isNaN(dt.getTime())) {
            if (!minDate || dt < minDate) minDate = dt;
            if (!maxDate || dt > maxDate) maxDate = dt;
          }
        }
      }

      const dateLine = (() => {
        if (minDate && maxDate) {
          const a = formatMDY(minDate);
          const b = formatMDY(maxDate);
          return (a === b) ? a : `${a} → ${b}`;
        }
        const clickedDate =
          getProp(p0, BOM_SALEDATE_FIELD) ??
          getProp(p0, "SaleDate") ??
          getProp(p0, "\ufeffSaleDateISO") ??
          getProp(p0, "SaleDateISO") ??
          "—";
        return clickedDate;
      })();

      let breakdownHtml = "";
      if (state.group === "__ALL__" && byGroup.size) {
        const rows = Array.from(byGroup.entries())
          .map(([g, v]) => ({ g, ...v }))
          .sort((a, b) => b.sales - a.sales)
          .slice(0, 6);

        breakdownHtml =
          `<div style="margin-top:10px; font-size:12px;">` +
          `<div style="font-weight:700; margin-bottom:6px;">Top groups (viewport)</div>` +
          rows.map(r =>
            `<div style="display:flex; justify-content:space-between; gap:10px;">` +
              `<span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;">${r.g}</span>` +
              `<span>${fmtMoney(r.sales)}</span>` +
            `</div>`
          ).join("") +
          `</div>`;
      }

      const html = `
        <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;">
          <div style="font-weight:700; font-size:13px; margin-bottom:6px;">${zip} • ${branch}</div>
          <div style="font-size:12px; opacity:.9; margin-bottom:8px;">${dateLine}</div>
          <div style="font-size:12px; margin-bottom:8px;">
            <b>Scope:</b> ${state.group === "__ALL__" ? "All groups" : state.group} • ${state.branch === "__ALL__" ? "All branches" : state.branch}
          </div>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; font-size:12px;">
            <div><b>Tickets</b><br>${fmtNum(ticketsSum)}</div>
            <div><b>Sales</b><br>${fmtMoney(salesSum)}</div>
            <div><b>Profit</b><br>${fmtMoney(profitSum)}</div>
          </div>
          ${breakdownHtml}
          <div style="margin-top:8px; font-size:11px; opacity:.7;">
            Note: totals are for currently rendered points in the viewport (and respect your filters).
          </div>
        </div>
      `;

      popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
    });
  }

  // =========================
  // Load filters.json
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
      setStatus(`Loaded ${branches.length} branches • ${groups.length} product groups`);
    } catch (err) {
      console.warn(LOG_PREFIX, "filters.json load failed:", err);
      setStatus("Could not load filters.json (check path).");
    }
  }

  // =========================
  // Startup
  // =========================
  log("Booting...");

  onReady(async () => {
    // Wait for map container (fixes: "Container 'map' not found.")
    let mapEl;
    try {
      mapEl = await waitForElement("#map", { timeoutMs: 25000 });
    } catch (e) {
      console.error("[WLHeatmap] #map container never appeared. If BisTrack is using a different container id, update app.js to match.", e);
      return;
    }

    // Resolve UI controls (may not exist in some dashboard layouts)
    els.branchSelect = getById("branchSelect");
    els.groupSelect = getById("groupSelect");
    els.startDate = getById("startDate");
    els.endDate = getById("endDate");
    els.metricSales = getById("metricSales");
    els.metricTickets = getById("metricTickets");
    els.applyBtn = getById("applyBtn");
    els.clearBtn = getById("clearBtn");
    els.status = getById("status");

    // If the dashboard re-renders the controls later, this keeps them usable.
    // (We still re-resolve some controls inside applyFilters/clearFilters.)
    wireUI();
    await loadFilters();

    // Mapbox GL requires WebGL; some dashboard hosts disable GPU acceleration.
    // We'll still try to initialize — if it fails, you'll see a clear console error.
    try {
      map = new mapboxgl.Map({
        container: mapEl, // pass element (more reliable than string id in embedded docs)
        style: "mapbox://styles/mapbox/light-v11",
        center: [-96.7, 30.6],
        zoom: 6.3,
      });

      map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");
    } catch (err) {
      console.error("[WLHeatmap] Mapbox failed to initialize (likely WebGL blocked in dashboard host).", err);
      setStatus("Map failed to load in this dashboard environment (WebGL may be blocked).");
      return;
    }

    // Debug helper
    window.WLdbg = () => {
      try {
        const feats = map.queryRenderedFeatures({ layers: [POINT_LAYER_ID] });
        const p = feats && feats[0] && feats[0].properties;
        console.log("[WLHeatmap] sample feature properties:", p);
        if (p) {
          console.log("[WLHeatmap] keys:", Object.keys(p).sort());
          console.log("[WLHeatmap] SaleDateKey:", p.SaleDateKey, "SaleDate:", p.SaleDate, "BOM SaleDate:", p["\ufeffSaleDate"]);
        }
        return feats && feats[0] && feats[0].properties;
      } catch (e) {
        console.warn("[WLHeatmap] WLdbg error:", e);
        return null;
      }
    };

    map.on("load", () => {
      log("Map loaded. Adding layers...");
      ensureLayers();
      wirePointTooltip();

      setMetricUI("sales");
      updateMetricPaint();
      applyFilters();

      log("Ready");
    });
  });
})();
