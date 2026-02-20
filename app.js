// ====== CONFIG (EDIT THESE) ======
const MAPBOX_TOKEN = "pk.eyJ1IjoiY2t1bmtlbCIsImEiOiJjbWx1Yjc4ODIwOW51M2Zwdm15dHFodnh1In0.F2yytru7jt9khYyPziZrHw";
const TILESET_ID   = "ckunkel.bp872kqi";
const SOURCE_LAYER = "MapBox-42vjbp";
const FILTERS_JSON_URL = "./filters.json"; // optional, set to null to disable
// ================================

mapboxgl.accessToken = MAPBOX_TOKEN;

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/light-v11",
  center: [-96.7, 30.7],
  zoom: 6
});

const UI = {
  branchSelect: document.getElementById("branchSelect"),
  groupSelect: document.getElementById("groupSelect"),
  metricSales: document.getElementById("metricSales"),
  metricTickets: document.getElementById("metricTickets"),
  startDate: document.getElementById("startDate"),
  endDate: document.getElementById("endDate"),
  applyDates: document.getElementById("applyDates"),
  clearDates: document.getElementById("clearDates")
};

let metric = "sales"; // "sales" | "tickets"

function setActiveMetricButtons() {
  UI.metricSales.classList.toggle("activeBtn", metric === "sales");
  UI.metricTickets.classList.toggle("activeBtn", metric === "tickets");
}

/**
 * Date filtering notes:
 * - We assume feature property "SaleDate" is a string "YYYY-MM-DD".
 * - String comparison works correctly for ISO dates.
 */
function toMDY(iso) {
  // iso = "YYYY-MM-DD" from <input type="date">
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}/${y}`; // matches your tileset format like 1/2/2026
}

function buildFilter() {
  const branch = UI.branchSelect.value;
  const group  = UI.groupSelect.value;

  const startIso = UI.startDate.value;
  const endIso   = UI.endDate.value;

  const start = toMDY(startIso);
  const end   = toMDY(endIso);

  const f = ["all"];

  if (branch !== "__all__") f.push(["==", ["get", "BranchName"], branch]);
  if (group  !== "__all__") f.push(["==", ["get", "ProductGroupLevel1"], group]);

  // Date range (string compare) — works OK within same year/month ranges but ISO is still better
  if (start) f.push([">=", ["get", "SaleDate"], start]);
  if (end)   f.push(["<=", ["get", "SaleDate"], end]);

  return f;
}

function setHeatmapWeight() {
  if (metric === "sales") {
    map.setPaintProperty("zips-heat", "heatmap-weight", [
      "interpolate", ["linear"], ["coalesce", ["get", "TotalSales"], 0],
      0, 0,
      250, 0.15,
      1000, 0.35,
      5000, 0.75,
      15000, 1
    ]);
  } else {
    map.setPaintProperty("zips-heat", "heatmap-weight", [
      "interpolate", ["linear"], ["coalesce", ["get", "TicketCount"], 0],
      0, 0,
      1, 0.15,
      10, 0.40,
      40, 0.75,
      120, 1
    ]);
  }
}

function applyFiltersAndMetric() {
  const filter = buildFilter();

  if (map.getLayer("zips-heat")) map.setFilter("zips-heat", filter);
  if (map.getLayer("zips-circles")) map.setFilter("zips-circles", filter);

  setHeatmapWeight();
}

function wireUI() {
  UI.branchSelect.addEventListener("change", applyFiltersAndMetric);
  UI.groupSelect.addEventListener("change", applyFiltersAndMetric);

  UI.metricSales.addEventListener("click", () => {
    metric = "sales";
    setActiveMetricButtons();
    applyFiltersAndMetric();
  });

  UI.metricTickets.addEventListener("click", () => {
    metric = "tickets";
    setActiveMetricButtons();
    applyFiltersAndMetric();
  });

  // Date controls
  UI.applyDates.addEventListener("click", applyFiltersAndMetric);

  UI.clearDates.addEventListener("click", () => {
    UI.startDate.value = "";
    UI.endDate.value = "";
    applyFiltersAndMetric();
  });
}

function addOption(selectEl, value, label) {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  selectEl.appendChild(opt);
}

async function tryLoadFiltersJson() {
  if (!FILTERS_JSON_URL) return false;

  try {
    const res = await fetch(FILTERS_JSON_URL, { cache: "no-store" });
    if (!res.ok) return false;
    const json = await res.json();

    const branches = Array.isArray(json.branches) ? json.branches : [];
    const groups   = Array.isArray(json.productGroupsLevel1) ? json.productGroupsLevel1 : [];

    branches.sort().forEach(b => addOption(UI.branchSelect, b, b));
    groups.sort().forEach(g => addOption(UI.groupSelect, g, g));

    return branches.length > 0 || groups.length > 0;
  } catch (e) {
    return false;
  }
}

// Fallback sampling (may miss some values if not using filters.json)
async function sampleDistinctValues() {
  const sampleCenters = [
    [-96.8, 30.6],
    [-95.4, 29.8],
    [-97.7, 30.3],
    [-96.1, 31.5]
  ];

  async function tilequery(lngLat) {
    const [lng, lat] = lngLat;
    const url =
      `https://api.mapbox.com/v4/${TILESET_ID}/tilequery/${lng},${lat}.json` +
      `?radius=60000&limit=50&layers=${encodeURIComponent(SOURCE_LAYER)}` +
      `&access_token=${encodeURIComponent(MAPBOX_TOKEN)}`;

    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    return (json.features || []).map(f => f.properties || {});
  }

  const props = [];
  for (const c of sampleCenters) props.push(...(await tilequery(c)));

  const branches = new Set();
  const groups = new Set();

  for (const p of props) {
    if (p.BranchName) branches.add(p.BranchName);
    if (p.ProductGroupLevel1) groups.add(p.ProductGroupLevel1);
  }

  [...branches].sort().forEach(b => addOption(UI.branchSelect, b, b));
  [...groups].sort().forEach(g => addOption(UI.groupSelect, g, g));
}

map.on("load", async () => {
  map.addSource("zips-src", {
    type: "vector",
    url: `mapbox://${TILESET_ID}`
  });

  map.addLayer({
    id: "zips-heat",
    type: "heatmap",
    source: "zips-src",
    "source-layer": SOURCE_LAYER,
    maxzoom: 12,
    paint: {
      "heatmap-radius": [
        "interpolate", ["linear"], ["zoom"],
        5, 10,
        8, 25,
        11, 45
      ],
      "heatmap-intensity": [
        "interpolate", ["linear"], ["zoom"],
        5, 0.8,
        11, 1.4
      ],
      "heatmap-opacity": [
        "interpolate", ["linear"], ["zoom"],
        5, 0.85,
        12, 0.15
      ]
    }
  });

  map.addLayer({
    id: "zips-circles",
    type: "circle",
    source: "zips-src",
    "source-layer": SOURCE_LAYER,
    minzoom: 9,
    paint: {
      "circle-radius": 3,
      "circle-opacity": 0.35
    }
  });

  const loaded = await tryLoadFiltersJson();
  if (!loaded) await sampleDistinctValues();

  wireUI();
  setActiveMetricButtons();

  // Default date range (optional): set to YTD automatically
  const now = new Date();
  const yyyy = now.getFullYear();
  UI.startDate.value = `${yyyy}-01-01`;
  UI.endDate.value = now.toISOString().slice(0, 10);

  applyFiltersAndMetric();
});
