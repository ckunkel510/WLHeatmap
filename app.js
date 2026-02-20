/* =========================
   Mapbox Zip Heatmap
   - Tileset: ckunkel.bp872kqi
   - Source layer: MapBox-42vjbp (must match exactly)
   - Toggle: tickets vs sales
   - Filter: branch
   ========================= */

mapboxgl.accessToken = "PASTE_YOUR_MAPBOX_TOKEN_HERE";

// Your tileset + source layer
const TILESET_URL = "mapbox://ckunkel.bp872kqi";
const SOURCE_ID = "zipSales";
const SOURCE_LAYER = "MapBox-42vjbp"; // <-- confirm in Mapbox Studio dropdown

// Layer IDs
const HEAT_LAYER_ID = "zip-heat";
const POINT_LAYER_ID = "zip-points";

// UI state
let mode = "tickets"; // "tickets" | "sales"
let selectedBranch = ""; // "" = all

// Use your data properties from the CSV
const PROP_BRANCH = "BranchID";
const PROP_ZIP = "PostCode";
const PROP_DATE = "SaleDate";          // or SaleDateISO if you exported that
const PROP_TICKETS = "TicketCount";
const PROP_SALES = "TotalSales";
const PROP_PROFIT = "TotalProfit";
const PROP_W_TICKETS = "weight_tickets";
const PROP_W_SALES = "weight_sales";

// Heat scaling (tune these after you eyeball the map)
const WEIGHT_MAX_TICKETS = 50;     // raise/lower after checking typical max per ZIP/day
const WEIGHT_MAX_SALES   = 20000;  // raise/lower after checking typical max per ZIP/day

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/light-v11",
  center: [-96.8, 31.0], // Texas-ish start
  zoom: 5.6
});

map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

function setActiveButton() {
  const btnTickets = document.getElementById("btnTickets");
  const btnSales = document.getElementById("btnSales");
  btnTickets.classList.toggle("active", mode === "tickets");
  btnSales.classList.toggle("active", mode === "sales");
}

function buildBranchFilter() {
  // If branch is blank => no filter
  if (!selectedBranch) return true;

  // Vector tile properties can be strings; compare as string
  return ["==", ["to-string", ["get", PROP_BRANCH]], String(selectedBranch)];
}

function applyFilters() {
  const filter = buildBranchFilter();
  if (map.getLayer(HEAT_LAYER_ID)) map.setFilter(HEAT_LAYER_ID, filter);
  if (map.getLayer(POINT_LAYER_ID)) map.setFilter(POINT_LAYER_ID, filter);
}

function applyWeightMode() {
  if (!map.getLayer(HEAT_LAYER_ID)) return;

  const prop = mode === "tickets" ? PROP_W_TICKETS : PROP_W_SALES;
  const max = mode === "tickets" ? WEIGHT_MAX_TICKETS : WEIGHT_MAX_SALES;

  // Heatmap-weight expects values 0..1-ish; we interpolate your property to that range.
  map.setPaintProperty(HEAT_LAYER_ID, "heatmap-weight", [
    "interpolate", ["linear"],
    ["coalesce", ["to-number", ["get", prop]], 0],
    0, 0,
    max, 1
  ]);
}

// Pull distinct BranchIDs for the dropdown by querying rendered features.
// (Works once tiles load and user is zoomed somewhere with data.)
function populateBranchDropdownOnce() {
  const select = document.getElementById("branchSelect");
  if (!select) return;

  const seen = new Set();

  // Query features in current viewport from the points layer (or heat layer)
  const features = map.queryRenderedFeatures({ layers: [POINT_LAYER_ID] });

  for (const f of features) {
    const v = f?.properties?.[PROP_BRANCH];
    if (v === null || v === undefined || v === "") continue;
    seen.add(String(v));
  }

  // If we didn't see any yet (zoomed out / not loaded), skip; it'll try again on moveend.
  if (seen.size === 0) return;

  // Clear existing except first option
  const keepFirst = select.options[0];
  select.innerHTML = "";
  select.appendChild(keepFirst);

  [...seen].sort((a, b) => Number(a) - Number(b)).forEach((branch) => {
    const opt = document.createElement("option");
    opt.value = branch;
    opt.textContent = `Branch ${branch}`;
    select.appendChild(opt);
  });

  // Remove moveend listener after first successful population
  map.off("moveend", populateBranchDropdownOnce);
}

function fmtMoney(n) {
  const x = Number(n);
  if (!isFinite(x)) return "—";
  return x.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtInt(n) {
  const x = Number(n);
  if (!isFinite(x)) return "—";
  return x.toLocaleString();
}

map.on("load", () => {
  map.addSource(SOURCE_ID, {
    type: "vector",
    url: TILESET_URL
  });

  // Heatmap layer
  map.addLayer({
    id: HEAT_LAYER_ID,
    type: "heatmap",
    source: SOURCE_ID,
    "source-layer": SOURCE_LAYER,
    maxzoom: 11,
    paint: {
      "heatmap-weight": [
        "interpolate", ["linear"],
        ["coalesce", ["to-number", ["get", PROP_W_TICKETS]], 0],
        0, 0,
        WEIGHT_MAX_TICKETS, 1
      ],
      "heatmap-intensity": [
        "interpolate", ["linear"],
        ["zoom"],
        5, 1,
        11, 3
      ],
      "heatmap-radius": [
        "interpolate", ["linear"],
        ["zoom"],
        5, 10,
        11, 35
      ],
      "heatmap-opacity": [
        "interpolate", ["linear"],
        ["zoom"],
        7, 0.85,
        11, 0.35
      ]
    }
  });

  // Points layer (for querying + click popups)
  map.addLayer({
    id: POINT_LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    "source-layer": SOURCE_LAYER,
    minzoom: 8.5,
    paint: {
      "circle-radius": 4,
      "circle-opacity": 0.7
    }
  });

  // UI wiring
  document.getElementById("btnTickets").addEventListener("click", () => {
    mode = "tickets";
    setActiveButton();
    applyWeightMode();
  });

  document.getElementById("btnSales").addEventListener("click", () => {
    mode = "sales";
    setActiveButton();
    applyWeightMode();
  });

  document.getElementById("branchSelect").addEventListener("change", (e) => {
    selectedBranch = e.target.value || "";
    applyFilters();
  });

  // Populate branch dropdown once data is visible
  map.on("moveend", populateBranchDropdownOnce);
  populateBranchDropdownOnce();

  // Click popup (use points layer for accuracy)
  map.on("click", POINT_LAYER_ID, (e) => {
    const f = e.features && e.features[0];
    if (!f) return;

    const p = f.properties || {};
    const zip = p[PROP_ZIP] ?? "—";
    const branch = p[PROP_BRANCH] ?? "—";
    const date = p[PROP_DATE] ?? "—";

    const tickets = p[PROP_TICKETS];
    const sales = p[PROP_SALES];
    const profit = p[PROP_PROFIT];

    const html = `
      <div style="font-size:12px; line-height:1.35;">
        <div style="font-weight:700; font-size:13px;">ZIP ${zip}</div>
        <div>Date: ${date}</div>
        <div>Branch: ${branch}</div>
        <hr style="border:none;border-top:1px solid #eee;margin:6px 0;" />
        <div>Tickets: <b>${fmtInt(tickets)}</b></div>
        <div>Sales: <b>${fmtMoney(sales)}</b></div>
        <div>Profit: <b>${fmtMoney(profit)}</b></div>
      </div>
    `;

    new mapboxgl.Popup({ closeButton: true })
      .setLngLat(e.lngLat)
      .setHTML(html)
      .addTo(map);
  });

  // Cursor pointer on hover
  map.on("mouseenter", POINT_LAYER_ID, () => map.getCanvas().style.cursor = "pointer");
  map.on("mouseleave", POINT_LAYER_ID, () => map.getCanvas().style.cursor = "");
});