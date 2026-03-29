import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

const app = document.querySelector("#app");

app.innerHTML = `
  <main class="app-shell">
    <header class="topbar">
      <div class="brand">Saskatoon Spending Story</div>
      <nav class="topnav" aria-label="Primary">
        <button class="nav-btn is-active" data-view="neighborhoods">Neighborhoods</button>
        <button class="nav-btn" data-view="allocation">Spending Signals</button>
        <button class="nav-btn" data-view="philosophy">Philosophy</button>
      </nav>
    </header>

    <section class="view is-active" data-view="neighborhoods">
      <section class="map-stage">
        <div id="map" aria-label="Saskatoon neighborhood spending map"></div>

        <aside class="map-left-stack">
          <aside class="map-hero">
            <p class="eyebrow">City Spending, Made Legible</p>
            <h1 class="title">Neighborhood Spending Atlas</h1>
            <p class="lead">
              Tap a marker to see where money went, who received it, and why a non-standard path was used.
            </p>
            <div class="hero-kpis">
              <p><span>Neighborhoods</span><strong id="stat-neighborhoods">-</strong></p>
              <p><span>Total Spend</span><strong id="stat-total">-</strong></p>
            </div>
          </aside>

          <aside class="map-tools" aria-label="Map controls">
            <section class="control-group compact">
              <h2>Department</h2>
              <select id="dept-filter">
                <option value="">All Departments</option>
              </select>
            </section>

            <section class="control-group compact">
              <h2>Spend Bands</h2>
              <label><input type="checkbox" id="filter-small" checked /> $20k-$100k</label>
              <label><input type="checkbox" id="filter-medium" checked /> $100k-$500k</label>
              <label><input type="checkbox" id="filter-large" checked /> $500k+</label>
            </section>

            <section class="control-group compact">
              <h2>Legend</h2>
              <div class="legend-row"><span class="swatch low"></span><span>$20k-$100k</span></div>
              <div class="legend-row"><span class="swatch med"></span><span>$100k-$500k</span></div>
              <div class="legend-row"><span class="swatch high"></span><span>$500k-$2.5M</span></div>
              <div class="legend-row"><span class="swatch max"></span><span>$2.5M+</span></div>
            </section>
          </aside>
        </aside>

        <aside class="detail-panel" id="detail-panel">
          <div class="panel-header">
            <p class="eyebrow">Neighborhood Audit</p>
            <h2 id="drawer-name">Select a neighborhood</h2>
            <p id="drawer-meta">Open a marker to see contracts, vendors, and reason context.</p>
          </div>
          <div id="drawer-projects" class="project-list"></div>
        </aside>
      </section>
    </section>

    <section class="view" data-view="allocation">
      <section class="analytics-shell" id="analytics-root">
        <p class="eyebrow">Procurement Signal Desk</p>
        <h1 class="title">Spending Signals</h1>
        <p class="lead">
          A practical read of the full non-standard ledger: where pressure is concentrated,
          why exceptions appear, and who receives the largest contracts.
        </p>
      </section>
    </section>

    <section class="view" data-view="philosophy">
      <section class="philosophy-shell">
        <p class="eyebrow">Why This Exists</p>
        <h1 class="title">Public Spending Should Be Understandable</h1>
        <p class="lead">
          Most people do not read procurement spreadsheets, but everyone lives with the results.
          This project turns hard-to-read records into a clear civic map anyone can use.
        </p>
        <blockquote class="philosophy-quote">"Accountability starts when people can actually read the data."</blockquote>
        <div class="principles-grid">
          <article class="philosophy-card">
            <h2>Principle 1: Start With Place</h2>
            <p>
              We begin with neighborhoods because people think in places they know.
              Clicking a marker should answer one practical question: what happened here?
            </p>
          </article>
          <article class="philosophy-card">
            <h2>Principle 2: Show Receipts, Not Just Totals</h2>
            <p>
              Every high-level number should lead to vendor, amount, and decision reason.
              This is a civic ledger designed for inspection, challenge, and trust.
            </p>
          </article>
        </div>
        <article class="philosophy-card credit-card">
          <h2>Built By</h2>
          <p>
            Mohit Joshi · <a href="https://linkedin.com/in/hellomohit" target="_blank" rel="noreferrer">linkedin.com/in/hellomohit</a>
            · <a href="https://makewithmohit.com" target="_blank" rel="noreferrer">makewithmohit.com</a>
          </p>
        </article>
      </section>
    </section>
  </main>
`;

const formatCurrency = (value) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");

const state = {
  map: null,
  rows: [],
  analytics: null,
  analyticsRendered: false,
  reasonCatalog: {},
  activeTheme: "high-contrast",
};

const MAP_THEMES = {
  "high-contrast": {
    raster: {
      "raster-saturation": -1,
      "raster-contrast": 0.52,
      "raster-brightness-min": 0.08,
      "raster-brightness-max": 0.72,
    },
    glow: "#ffd84f",
    stops: ["#7ee081", "#ffd84f", "#ff7a4f", "#ff4f5a"],
    stroke: "#0d0e10",
  },
};

const REASON_BASE_LABELS = {
  A: "No compliant bids or submissions",
  B: "Insurance or risk placement",
  C: "Emergency procurement",
  D: "Compatibility or standardization",
  E: "Single/sole source conditions",
  F: "Contract continuation or extension",
  G: "Specialized professional services",
  H: "Strategic or partnership-based services",
  I: "Regulatory, legal, or rights constraints",
  J: "Community, social, or environmental programs",
  K: "Other approved policy exception",
  Unspecified: "Reason not specified in source data",
};

const drawerName = document.querySelector("#drawer-name");
const drawerMeta = document.querySelector("#drawer-meta");
const drawerProjects = document.querySelector("#drawer-projects");

function normalizeRow(row) {
  const projects = Array.isArray(row.Projects)
    ? row.Projects
    : Array.isArray(row.projects)
      ? row.projects
      : [];

  return {
    Neighborhood: row.Neighborhood || row.neighborhood || "Unknown",
    Total_Spend: Number(row.Total_Spend ?? row.total_spend ?? 0),
    Project_Count: Number(row.Project_Count ?? row.project_count ?? 0),
    Top_Department: row.Top_Department || row.top_department || "Unknown",
    Coordinates: Array.isArray(row.Coordinates) ? row.Coordinates : row.coordinates,
    Projects: projects,
  };
}

function normalizeReasonCode(token) {
  const text = String(token || "").toUpperCase();
  const letterMatch = text.match(/[A-Z]/);
  if (!letterMatch) return null;
  const letter = letterMatch[0];
  const digitMatch = text.match(/[0-9]/);
  return digitMatch ? `${letter}${digitMatch[0]}` : letter;
}

function extractReasonCodeFromPolicyText(policyReason) {
  const text = String(policyReason || "");
  const parentheses = text.match(/\(([A-Z][A-Z0-9\s/&,-]*)\)/i);
  if (parentheses?.[1]) {
    const normalized = normalizeReasonCode(parentheses[1]);
    if (normalized) return normalized;
  }

  const trailingCode = text.match(/\b([A-Z]\s*[0-9]?)\b/i);
  if (trailingCode?.[1]) {
    return normalizeReasonCode(trailingCode[1]);
  }

  return null;
}

function cleanPolicyLabel(policyReason) {
  const text = String(policyReason || "").trim();
  if (!text) return null;

  return text
    .replace(/\s*\([A-Z][A-Z0-9\s/&,-]*\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildReasonCatalogFromNeighborhoods(rows) {
  const catalog = { ...REASON_BASE_LABELS };

  rows.forEach((row) => {
    const projects = Array.isArray(row.Projects) ? row.Projects : [];
    projects.forEach((project) => {
      const policyReason = project.Policy_Reason ?? project.policy_reason ?? "";
      const code = extractReasonCodeFromPolicyText(policyReason);
      const label = cleanPolicyLabel(policyReason);

      if (code && label) {
        catalog[code] = label;
      }
    });
  });

  return catalog;
}

async function loadNeighborhoodData() {
  const response = await fetch("/data/summary.json");
  if (!response.ok) {
    throw new Error(`Failed to load summary data: ${response.status}`);
  }

  const raw = await response.json();
  const normalized = raw.map(normalizeRow).filter(
    (row) =>
      Array.isArray(row.Coordinates) &&
      row.Coordinates.length === 2 &&
      Number.isFinite(row.Total_Spend)
  );

  if (normalized.length === 0) {
    throw new Error("No valid neighborhood records found in summary data.");
  }

  return normalized;
}

async function loadAnalyticsData() {
  try {
    const response = await fetch("/data/analytics.json");
    if (response.ok) {
      return response.json();
    }
  } catch {
    // Fallback to live API below.
  }

  const apiUrl = "https://services2.arcgis.com/eJz9754Ox6TaFSC2/arcgis/rest/services/Non_Standard_Procurement/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=json";
  const apiResponse = await fetch(apiUrl);
  if (!apiResponse.ok) {
    throw new Error(`Failed to load analytics from API: ${apiResponse.status}`);
  }

  const payload = await apiResponse.json();
  const features = Array.isArray(payload.features) ? payload.features : [];
  const records = features
    .map((feature) => feature.attributes || {})
    .map((attributes) => ({
      DEPARTMENT: attributes.DEPARTMENT,
      VENDOR: attributes.VENDOR,
      DESCRIPTION: attributes.DESCRIPTION,
      CONTRACT_NUMBER: attributes.CONTRACT_NUMBER,
      Year: attributes.Year,
      AMOUNT: attributes.AMOUNT,
      REASON: attributes.REASON,
      ACAN: attributes.ACAN,
      FID: attributes.FID,
    }));

  return buildAnalyticsPayload(records);
}

function parseReasonCodes(reasonRaw) {
  const text = String(reasonRaw || "").toUpperCase().trim();
  if (!text) return [];

  return [
    ...new Set(
      text
        .replace(/[\/&]/g, ",")
        .split(",")
        .map((token) => normalizeReasonCode(token))
        .filter(Boolean)
    ),
  ];
}

function getReasonLabel(code, catalog) {
  if (!code) return catalog.Unspecified || REASON_BASE_LABELS.Unspecified;
  if (catalog[code]) return catalog[code];

  const base = code[0];
  if (catalog[base]) return catalog[base];
  if (REASON_BASE_LABELS[base]) return REASON_BASE_LABELS[base];
  return code;
}

function aggregateRows(records, keySelector, amountSelector) {
  const map = new Map();
  records.forEach((record) => {
    const key = keySelector(record);
    const amount = amountSelector(record);
    if (!map.has(key)) {
      map.set(key, { key, spend: 0, contracts: 0 });
    }
    const entry = map.get(key);
    entry.spend += amount;
    entry.contracts += 1;
  });
  return [...map.values()];
}

function buildAnalyticsPayload(rawRecords) {
  const records = rawRecords.map((row) => ({
    department: String(row.DEPARTMENT || "Unknown").trim() || "Unknown",
    vendor: String(row.VENDOR || "Unknown").trim() || "Unknown",
    description: String(row.DESCRIPTION || "Not provided").trim() || "Not provided",
    contract: String(row.CONTRACT_NUMBER || "Unknown").trim() || "Unknown",
    year: Number(row.Year),
    amount: Number(row.AMOUNT || 0),
    reason: String(row.REASON || "Unspecified").trim() || "Unspecified",
    reasons: parseReasonCodes(row.REASON),
    acan: String(row.ACAN || "").trim().toLowerCase() === "yes",
  })).filter((row) => Number.isFinite(row.amount) && row.amount > 0);

  const totalSpend = records.reduce((sum, row) => sum + row.amount, 0);
  const years = records.map((row) => row.year).filter((year) => Number.isFinite(year));

  const byDepartment = aggregateRows(records, (row) => row.department, (row) => row.amount)
    .sort((a, b) => b.spend - a.spend)
    .map((row) => ({ Department: row.key, Total_Spend: row.spend, Contract_Count: row.contracts }));

  const byReasonMap = new Map();
  records.forEach((row) => {
    const codes = row.reasons.length > 0 ? row.reasons : ["Unspecified"];
    codes.forEach((code) => {
      if (!byReasonMap.has(code)) {
        byReasonMap.set(code, { Reason_Code: code, Total_Spend: 0, Contract_Count: 0 });
      }
      const entry = byReasonMap.get(code);
      entry.Total_Spend += row.amount;
      entry.Contract_Count += 1;
    });
  });

  const byReason = [...byReasonMap.values()].sort((a, b) => b.Total_Spend - a.Total_Spend);

  const byYear = aggregateRows(
    records.filter((row) => Number.isFinite(row.year)),
    (row) => String(row.year),
    (row) => row.amount
  )
    .sort((a, b) => Number(a.key) - Number(b.key))
    .map((row) => ({
      Year: Number(row.key),
      Total_Spend: row.spend,
      Contract_Count: row.contracts,
    }));

  const topVendors = aggregateRows(records, (row) => row.vendor, (row) => row.amount)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 15)
    .map((row) => ({ Vendor: row.key, Total_Spend: row.spend, Contract_Count: row.contracts }));

  const topContracts = [...records]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 30)
    .map((row) => ({
      Contract_Number: row.contract,
      Department: row.department,
      Vendor: row.vendor,
      Description: row.description,
      Year: Number.isFinite(row.year) ? row.year : "Unknown",
      Amount: row.amount,
    }));

  const allContracts = [...records]
    .sort((a, b) => b.amount - a.amount)
    .map((row) => ({
      Contract_Number: row.contract,
      Department: row.department,
      Vendor: row.vendor,
      Description: row.description,
      Year: Number.isFinite(row.year) ? row.year : "Unknown",
      Amount: row.amount,
      Reason: row.reason,
      ACAN: row.acan,
    }));

  const acanYes = records.filter((row) => row.acan);
  const acanNo = records.filter((row) => !row.acan);

  const unknownReasonContracts = records.filter((row) => row.reasons.length === 0).length;
  const unknownReasonSpend = records
    .filter((row) => row.reasons.length === 0)
    .reduce((sum, row) => sum + row.amount, 0);
  const topTwoVendorSpend = topVendors.slice(0, 2).reduce((sum, row) => sum + row.Total_Spend, 0);
  const topTwoVendorSharePct = totalSpend > 0 ? (topTwoVendorSpend / totalSpend) * 100 : 0;
  const clerkNameVarianceSpend = byDepartment
    .filter((dept) => /clerk/i.test(dept.Department))
    .reduce((sum, dept) => sum + dept.Total_Spend, 0);
  const namingVariantsCount = byDepartment.filter((dept) => {
    const name = String(dept.Department || "").toLowerCase();
    return name.includes("clerk") || name.includes("solicitor") || name.includes("recreation");
  }).length;

  return {
    signals: {
      unknownReasonContracts,
      unknownReasonSpend,
      topTwoVendorSharePct,
      clerkNameVarianceSpend,
      namingVariantsCount,
    },
    totals: {
      Contracts: records.length,
      Total_Spend: totalSpend,
      Unique_Departments: new Set(records.map((row) => row.department)).size,
      Unique_Vendors: new Set(records.map((row) => row.vendor)).size,
      Year_Start: years.length ? Math.min(...years) : null,
      Year_End: years.length ? Math.max(...years) : null,
    },
    acan: {
      Yes_Count: acanYes.length,
      Yes_Spend: acanYes.reduce((sum, row) => sum + row.amount, 0),
      No_Count: acanNo.length,
      No_Spend: acanNo.reduce((sum, row) => sum + row.amount, 0),
    },
    byDepartment,
    byYear,
    byReason,
    topVendors,
    topContracts,
    allContracts,
  };
}

function setDrawerContent(properties) {
  const neighborhood = properties.neighborhood || "Unknown";
  const spend = Number(properties.spend || 0);
  const contracts = Number(properties.contracts || 0);
  const topDept = properties.topDept || "Unknown";
  let projects = [];
  try {
    projects = JSON.parse(properties.projects || "[]");
  } catch {
    projects = [];
  }

  drawerName.textContent = neighborhood;
  drawerMeta.textContent = `${formatCurrency(spend)} • ${contracts.toLocaleString("en-CA")} contracts • ${topDept}`;

  if (projects.length === 0) {
    drawerProjects.innerHTML = `<p class="empty-copy">No project-level details available for this neighborhood.</p>`;
    return;
  }

  const markup = projects
    .sort((a, b) => Number(b.Amount || b.amount || 0) - Number(a.Amount || a.amount || 0))
    .map((project) => {
      const amount = Number(project.Amount ?? project.amount ?? 0);
      const vendor = project.Vendor ?? project.vendor ?? "Unknown";
      const description = project.Description ?? project.description ?? "Not provided";
      const policy = project.Policy_Reason ?? project.policy_reason ?? "Not provided";

      return `
        <article class="project-item">
          <h3>${escapeHtml(vendor)}</h3>
          <p class="project-amount">${formatCurrency(amount)}</p>
          <p>${escapeHtml(description)}</p>
          <p class="project-policy">Reason: ${escapeHtml(policy)}</p>
        </article>
      `;
    })
    .join("");

  drawerProjects.innerHTML = markup;
}

function buildGeojson(rows) {
  return {
    type: "FeatureCollection",
    features: rows.map((row, index) => {
      const jitterAmount = 0.015;
      const angle = (index / rows.length) * Math.PI * 2;
      const distance = jitterAmount * (0.3 + Math.random() * 0.7);
      const lng = row.Coordinates[0] + Math.cos(angle) * distance;
      const lat = row.Coordinates[1] + Math.sin(angle) * distance;

      return {
        type: "Feature",
        properties: {
          neighborhood: row.Neighborhood,
          spend: Number(row.Total_Spend),
          contracts: Number(row.Project_Count || 0),
          topDept: row.Top_Department || "Unknown",
          projects: JSON.stringify(row.Projects || []),
        },
        geometry: {
          type: "Point",
          coordinates: [lng, lat],
        },
      };
    }),
  };
}

function updateNeighborhoodStats(rows) {
  const totalSpend = rows.reduce((sum, row) => sum + Number(row.Total_Spend), 0);
  const neighborhoodsEl = document.querySelector("#stat-neighborhoods");
  const totalEl = document.querySelector("#stat-total");

  if (neighborhoodsEl) neighborhoodsEl.textContent = String(rows.length);
  if (totalEl) totalEl.textContent = formatCurrency(totalSpend);
}

function setupFilterHandlers() {
  function updateFilters() {
    const dept = document.querySelector("#dept-filter").value;
    const small = document.querySelector("#filter-small").checked;
    const medium = document.querySelector("#filter-medium").checked;
    const large = document.querySelector("#filter-large").checked;

    let filter = ["all"];
    if (dept) {
      filter.push(["==", ["get", "topDept"], dept]);
    }

    const spendFilters = [];
    if (small) spendFilters.push(["<=", ["get", "spend"], 100000]);
    if (medium) spendFilters.push(["all", [">", ["get", "spend"], 100000], ["<=", ["get", "spend"], 500000]]);
    if (large) spendFilters.push([">", ["get", "spend"], 500000]);

    if (spendFilters.length > 0) {
      filter.push(spendFilters.length === 1 ? spendFilters[0] : ["any", ...spendFilters]);
    } else {
      filter.push(["==", ["get", "spend"], -1]);
    }

    state.map.setFilter("spending-glow", filter);
    state.map.setFilter("spending-points", filter);
  }

  document.querySelector("#dept-filter").addEventListener("change", updateFilters);
  document.querySelector("#filter-small").addEventListener("change", updateFilters);
  document.querySelector("#filter-medium").addEventListener("change", updateFilters);
  document.querySelector("#filter-large").addEventListener("change", updateFilters);
}

function populateDepartmentFilter(rows) {
  const select = document.querySelector("#dept-filter");
  const departments = [...new Set(rows.map((row) => row.Top_Department).filter(Boolean))].sort();
  departments.forEach((department) => {
    const option = document.createElement("option");
    option.value = department;
    option.textContent = department;
    select.appendChild(option);
  });
}

function initializeMap(rows) {
  const theme = MAP_THEMES[state.activeTheme] || MAP_THEMES["high-contrast"];

  state.map = new maplibregl.Map({
    container: "map",
    style: {
      version: 8,
      sources: {
        osm: {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          attribution: "&copy; OpenStreetMap contributors",
        },
      },
      layers: [
        {
          id: "osm",
          type: "raster",
          source: "osm",
        },
      ],
    },
    center: [-106.6702, 52.1332],
    zoom: 11,
    antialias: true,
  });

  state.map.addControl(new maplibregl.NavigationControl(), "top-right");

  state.map.on("load", () => {
    state.map.addSource("spending", {
      type: "geojson",
      data: buildGeojson(rows),
    });

    state.map.addLayer({
      id: "spending-glow",
      type: "circle",
      source: "spending",
      paint: {
        "circle-color": theme.glow,
        "circle-radius": ["interpolate", ["linear"], ["get", "spend"], 20000, 6, 500000, 16, 5000000, 30],
        "circle-opacity": 0.2,
        "circle-blur": 0.7,
      },
    });

    state.map.addLayer({
      id: "spending-points",
      type: "circle",
      source: "spending",
      paint: {
        "circle-color": [
          "interpolate",
          ["linear"],
          ["get", "spend"],
          20000,
          theme.stops[0],
          200000,
          theme.stops[1],
          500000,
          theme.stops[2],
          5000000,
          theme.stops[3],
        ],
        "circle-stroke-color": theme.stroke,
        "circle-stroke-width": 2,
        "circle-radius": ["interpolate", ["linear"], ["get", "spend"], 20000, 6, 200000, 10, 500000, 15, 5000000, 22],
      },
    });

    applyMapTheme(state.activeTheme);

    state.map.on("click", "spending-points", (event) => {
      const feature = event.features?.[0];
      if (!feature) return;

      const coordinates = feature.geometry.coordinates.slice();
      const { neighborhood, spend, contracts, topDept } = feature.properties;

      setDrawerContent(feature.properties);

      new maplibregl.Popup({ closeButton: true, className: "spend-popup" })
        .setLngLat(coordinates)
        .setHTML(`
          <div class="popup">
            <h3>${escapeHtml(neighborhood)}</h3>
            <p><strong>Total Spend:</strong> ${formatCurrency(Number(spend))}</p>
            <p><strong>Contracts:</strong> ${Number(contracts).toLocaleString("en-CA")}</p>
            <p><strong>Top Department:</strong> ${escapeHtml(topDept)}</p>
            <p class="popup-note">Detailed records are open in the right panel.</p>
          </div>
        `)
        .addTo(state.map);
    });

    state.map.on("mouseenter", "spending-points", () => {
      state.map.getCanvas().style.cursor = "pointer";
    });

    state.map.on("mouseleave", "spending-points", () => {
      state.map.getCanvas().style.cursor = "";
    });
  });
}

function applyMapTheme(themeKey) {
  if (!state.map) return;

  const theme = MAP_THEMES[themeKey] || MAP_THEMES["high-contrast"];

  if (!state.map.getLayer("osm")) return;

  Object.entries(theme.raster).forEach(([property, value]) => {
    state.map.setPaintProperty("osm", property, value);
  });

  if (state.map.getLayer("spending-glow")) {
    state.map.setPaintProperty("spending-glow", "circle-color", theme.glow);
  }

  if (state.map.getLayer("spending-points")) {
    state.map.setPaintProperty("spending-points", "circle-color", [
      "interpolate",
      ["linear"],
      ["get", "spend"],
      20000,
      theme.stops[0],
      200000,
      theme.stops[1],
      500000,
      theme.stops[2],
      5000000,
      theme.stops[3],
    ]);
    state.map.setPaintProperty("spending-points", "circle-stroke-color", theme.stroke);
  }
}

function renderAnalytics(analytics, reasonCatalog) {
  const root = document.querySelector("#analytics-root");
  const totalSpend = analytics.totals.Total_Spend || 1;
  const signals = analytics.signals || {
    unknownReasonContracts: 0,
    unknownReasonSpend: 0,
    topTwoVendorSharePct: analytics.totals.Total_Spend > 0
      ? ((analytics.topVendors?.slice(0, 2).reduce((sum, row) => sum + (row.Total_Spend || 0), 0) / analytics.totals.Total_Spend) * 100)
      : 0,
    clerkNameVarianceSpend: (analytics.byDepartment || [])
      .filter((dept) => /clerk/i.test(dept.Department))
      .reduce((sum, dept) => sum + (dept.Total_Spend || 0), 0),
    namingVariantsCount: (analytics.byDepartment || []).filter((dept) => {
      const name = String(dept.Department || "").toLowerCase();
      return name.includes("clerk") || name.includes("solicitor") || name.includes("recreation");
    }).length,
  };

  const yearRowsSource = Array.isArray(analytics.byYear) ? analytics.byYear : [];
  const maxYearSpend = Math.max(...yearRowsSource.map((item) => item.Total_Spend), 1);

  const firstYear = analytics.totals.Year_Start;
  const lastYear = analytics.totals.Year_End;
  const firstYearSpend =
    yearRowsSource.find((entry) => entry.Year === firstYear)?.Total_Spend || 0;
  const lastYearSpend =
    yearRowsSource.find((entry) => entry.Year === lastYear)?.Total_Spend || 0;
  const trendPct = firstYearSpend > 0
    ? ((lastYearSpend - firstYearSpend) / firstYearSpend) * 100
    : null;
  const peakYear = yearRowsSource.reduce(
    (max, item) => (item.Total_Spend > max.Total_Spend ? item : max),
    { Year: null, Total_Spend: 0, Contract_Count: 0 }
  );

  const fullContracts = (Array.isArray(analytics.allContracts) && analytics.allContracts.length > 0
    ? analytics.allContracts
    : analytics.topContracts || []).map((row) => {
      const reasonCode = parseReasonCodes(row.Reason || "")[0] || "Unspecified";
      return {
        Contract_Number: row.Contract_Number || "Unknown",
        Department: row.Department || "Unknown",
        Vendor: row.Vendor || "Unknown",
        Description: row.Description || "Not provided",
        Year: Number.isFinite(Number(row.Year)) ? Number(row.Year) : "Unknown",
        Amount: Number(row.Amount || 0),
        Reason: row.Reason || "Unspecified",
        ACAN: Boolean(row.ACAN),
        reasonCode,
        reasonLabel: getReasonLabel(reasonCode, reasonCatalog),
      };
    });

  const topVendor = analytics.topVendors?.[0];
  const secondVendor = analytics.topVendors?.[1];

  const storyCards = [
    {
      title: "Concentration",
      value: `${Number(signals.topTwoVendorSharePct || 0).toFixed(1)}%`,
      note: "of total spend is concentrated in the top two vendors.",
    },
    {
      title: "Data Gaps",
      value: `${signals.unknownReasonContracts.toLocaleString("en-CA")} rows`,
      note: `have missing reason detail (${formatCurrency(signals.unknownReasonSpend)}).`,
    },
    {
      title: "Naming Drift",
      value: `${signals.namingVariantsCount.toLocaleString("en-CA")} variants`,
      note: "department labels include clerk/solicitor/recreation variations.",
    },
  ];

  const fieldNotes = [
    `${analytics.totals.Contracts.toLocaleString("en-CA")} records are visible in the full ledger below.`,
    topVendor
      ? `Largest vendor: ${escapeHtml(topVendor.Vendor)} at ${formatCurrency(topVendor.Total_Spend)}.`
      : "Largest vendor insight unavailable.",
    secondVendor
      ? `Second largest vendor: ${escapeHtml(secondVendor.Vendor)} at ${formatCurrency(secondVendor.Total_Spend)}.`
      : "Second vendor insight unavailable.",
    `Peak annual spend is ${formatCurrency(peakYear.Total_Spend || 0)} in ${peakYear.Year || "-"}.`,
  ];

  const departmentRecords = new Map();
  fullContracts.forEach((row) => {
    if (!departmentRecords.has(row.Department)) {
      departmentRecords.set(row.Department, []);
    }
    departmentRecords.get(row.Department).push(row);
  });

  const deptCards = analytics.byDepartment.slice(0, 9).map(
    (item, index) => {
      const deptRows = departmentRecords.get(item.Department) || [];
      const topDeptVendor = aggregateRows(deptRows, (row) => row.Vendor, (row) => row.Amount)
        .sort((a, b) => b.spend - a.spend)[0];
      const topDeptReason = aggregateRows(deptRows, (row) => row.reasonCode, (row) => row.Amount)
        .sort((a, b) => b.spend - a.spend)[0];
      const latestYear = deptRows
        .map((row) => Number(row.Year))
        .filter((year) => Number.isFinite(year))
        .sort((a, b) => b - a)[0];

      return `
      <article class="insight-card">
        <span class="insight-rank">#${index + 1}</span>
        <h3>${escapeHtml(item.Department)}</h3>
        <p>${formatCurrency(item.Total_Spend)}</p>
        <small>${item.Contract_Count.toLocaleString("en-CA")} contracts · ${((item.Total_Spend / totalSpend) * 100).toFixed(1)}% share</small>
        <div class="capsule-row">
          <span class="capsule">Top vendor: ${escapeHtml(topDeptVendor?.key || "Unknown")}</span>
          <span class="capsule">Top reason: ${escapeHtml(topDeptReason?.key || "Unspecified")}</span>
          <span class="capsule">Latest year: ${latestYear || "-"}</span>
        </div>
      </article>
    `;
    }
  ).join("");

  const reasonRows = analytics.byReason.slice(0, 8).map((item) => {
    const relatedRows = fullContracts.filter((row) => row.reasonCode === item.Reason_Code);
    const topReasonDept = aggregateRows(relatedRows, (row) => row.Department, (row) => row.Amount)
      .sort((a, b) => b.spend - a.spend)[0];

    return `
      <article class="reason-card">
        <div class="reason-card-top">
          <h3>${escapeHtml(item.Reason_Code)}</h3>
          <strong>${formatCurrency(item.Total_Spend)}</strong>
        </div>
        <p>${escapeHtml(getReasonLabel(item.Reason_Code, reasonCatalog))}</p>
        <div class="reason-meta">
          <span>${item.Contract_Count.toLocaleString("en-CA")} contracts</span>
          <span>${((item.Total_Spend / totalSpend) * 100).toFixed(1)}% spend share</span>
          <span>Most seen in: ${escapeHtml(topReasonDept?.key || "Unknown")}</span>
        </div>
      </article>
    `;
  }).join("");

  const yearlyRows = yearRowsSource.map(
    (item) => `
      <div class="year-row">
        <div class="year-label">${escapeHtml(String(item.Year))}</div>
        <div class="bar-track"><span class="bar-fill" style="width:${(item.Total_Spend / maxYearSpend) * 100}%"></span></div>
        <div class="bar-value">${formatCurrency(item.Total_Spend)}</div>
        <div class="year-contracts">${item.Contract_Count.toLocaleString("en-CA")} contracts</div>
      </div>
    `
  ).join("");

  const topContracts = analytics.topContracts.slice(0, 12).map(
    (contract) => `
      <tr>
        <td>${escapeHtml(contract.Contract_Number)}</td>
        <td>${escapeHtml(contract.Department)}</td>
        <td>${escapeHtml(contract.Vendor)}</td>
        <td>${formatCurrency(contract.Amount)}</td>
        <td>${escapeHtml(String(contract.Year))}</td>
        <td>${escapeHtml(parseReasonCodes(contract.Reason || "")[0] || "Unspecified")}</td>
      </tr>
    `
  ).join("");

  root.innerHTML += `
    <div class="kpi-grid">
      <article class="kpi-card"><span>Contracts</span><strong>${analytics.totals.Contracts.toLocaleString("en-CA")}</strong></article>
      <article class="kpi-card"><span>Total Spend</span><strong>${formatCurrency(analytics.totals.Total_Spend)}</strong></article>
      <article class="kpi-card"><span>Departments</span><strong>${analytics.totals.Unique_Departments}</strong></article>
      <article class="kpi-card"><span>Vendors</span><strong>${analytics.totals.Unique_Vendors}</strong></article>
    </div>

    <section class="analytics-card">
      <h2>Signal Snapshot</h2>
      <div class="story-strip">
        ${storyCards
          .map(
            (card) => `
              <article class="story-card">
                <span>${escapeHtml(card.title)}</span>
                <strong>${escapeHtml(card.value)}</strong>
                <p>${escapeHtml(card.note)}</p>
              </article>
            `
          )
          .join("")}
      </div>
    </section>

    <section class="analytics-card">
      <h2>Field Notes from ${analytics.totals.Contracts.toLocaleString("en-CA")} Records</h2>
      <ul class="signal-bullets">
        ${fieldNotes.map((item) => `<li>${item}</li>`).join("")}
      </ul>
    </section>

    <section class="analytics-card context-grid">
      <article class="context-card">
        <h2>Time Span</h2>
        <p>${firstYear ? escapeHtml(String(firstYear)) : "-"} to ${lastYear ? escapeHtml(String(lastYear)) : "-"}</p>
        <small>How long this dataset has been reporting non-standard procurement.</small>
      </article>
      <article class="context-card">
        <h2>Peak Year</h2>
        <p>${peakYear.Year ? escapeHtml(String(peakYear.Year)) : "-"} · ${formatCurrency(peakYear.Total_Spend || 0)}</p>
        <small>${(peakYear.Contract_Count || 0).toLocaleString("en-CA")} contracts were recorded in the highest-spend year.</small>
      </article>
      <article class="context-card">
        <h2>Trend</h2>
        <p>${trendPct === null ? "-" : `${trendPct >= 0 ? "+" : ""}${trendPct.toFixed(1)}%`}</p>
        <small>Change in spend from first to latest year in this dataset.</small>
      </article>
    </section>

    <section class="analytics-card">
      <h2>Year-by-Year Spend</h2>
      <p class="section-copy">Track procurement pressure over time, including volume of contracts each year.</p>
      <div class="year-grid">${yearlyRows || '<p class="empty-copy">Yearly detail is unavailable in this dataset.</p>'}</div>
    </section>

    <section class="analytics-card">
      <h2>Department Footprint</h2>
      <p class="section-copy">A ranked snapshot of where non-standard spend clusters.</p>
      <div class="insight-grid">${deptCards}</div>
    </section>

    <section class="analytics-card">
      <h2>Exception Pressure Map</h2>
      <p class="section-copy">What each reason code means, how much money flows through it, and which department drives it most.</p>
      <div class="reason-grid">${reasonRows}</div>
    </section>

    <section class="analytics-card">
      <h2>Top Contracts</h2>
      <div class="table-scroll">
        <table class="contracts-table">
          <thead><tr><th>Contract</th><th>Department</th><th>Vendor</th><th>Amount</th><th>Year</th><th>Reason</th></tr></thead>
          <tbody>${topContracts}</tbody>
        </table>
      </div>
    </section>

    <section class="analytics-card">
      <h2>Full Contract Ledger</h2>
      <p class="section-copy">All rows from the CSV. Search, sort, and group to inspect patterns from different angles.</p>
      <div class="ledger-toolbar">
        <input id="ledger-search" type="search" placeholder="Search contract, vendor, department, reason..." />
        <select id="ledger-group">
          <option value="none">No Grouping</option>
          <option value="department">Group by Department</option>
          <option value="reason">Group by Reason</option>
          <option value="year">Group by Year</option>
          <option value="vendor">Group by Vendor</option>
        </select>
        <select id="ledger-sort">
          <option value="amount-desc">Sort: Amount High to Low</option>
          <option value="amount-asc">Sort: Amount Low to High</option>
          <option value="year-desc">Sort: Newest Year</option>
          <option value="year-asc">Sort: Oldest Year</option>
          <option value="vendor-asc">Sort: Vendor A-Z</option>
        </select>
      </div>
      <p class="ledger-summary" id="ledger-summary"></p>
      <div class="table-scroll">
        <table class="contracts-table ledger-table">
          <thead>
            <tr>
              <th>Contract</th>
              <th>Department</th>
              <th>Vendor</th>
              <th>Reason</th>
              <th>Amount</th>
              <th>Year</th>
              <th>ACAN</th>
            </tr>
          </thead>
          <tbody id="ledger-body"></tbody>
        </table>
      </div>
    </section>
  `;

  const ledgerBody = root.querySelector("#ledger-body");
  const ledgerSummary = root.querySelector("#ledger-summary");
  const ledgerSearch = root.querySelector("#ledger-search");
  const ledgerGroup = root.querySelector("#ledger-group");
  const ledgerSort = root.querySelector("#ledger-sort");

  const ledgerState = {
    search: "",
    group: "none",
    sort: "amount-desc",
  };

  function sortRows(rows, mode) {
    const sorted = [...rows];
    const yearValue = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : -1;
    };

    if (mode === "amount-asc") {
      sorted.sort((a, b) => a.Amount - b.Amount);
    } else if (mode === "year-desc") {
      sorted.sort((a, b) => yearValue(b.Year) - yearValue(a.Year));
    } else if (mode === "year-asc") {
      sorted.sort((a, b) => yearValue(a.Year) - yearValue(b.Year));
    } else if (mode === "vendor-asc") {
      sorted.sort((a, b) => String(a.Vendor).localeCompare(String(b.Vendor)));
    } else {
      sorted.sort((a, b) => b.Amount - a.Amount);
    }

    return sorted;
  }

  function groupKey(row, mode) {
    if (mode === "department") return row.Department || "Unknown Department";
    if (mode === "reason") return `${row.reasonCode} - ${row.reasonLabel}`;
    if (mode === "year") return String(row.Year || "Unknown Year");
    if (mode === "vendor") return row.Vendor || "Unknown Vendor";
    return "All Records";
  }

  function renderLedger() {
    const query = ledgerState.search.trim().toLowerCase();
    const searched = fullContracts.filter((row) => {
      if (!query) return true;
      const blob = [
        row.Contract_Number,
        row.Department,
        row.Vendor,
        row.Description,
        row.Reason,
        row.reasonCode,
        row.reasonLabel,
        row.Year,
      ]
        .join(" ")
        .toLowerCase();
      return blob.includes(query);
    });

    const sorted = sortRows(searched, ledgerState.sort);
    const spend = sorted.reduce((sum, row) => sum + row.Amount, 0);

    if (ledgerState.group === "none") {
      ledgerBody.innerHTML = sorted
        .map(
          (row) => `
            <tr>
              <td>${escapeHtml(row.Contract_Number)}</td>
              <td>${escapeHtml(row.Department)}</td>
              <td>${escapeHtml(row.Vendor)}</td>
              <td>${escapeHtml(row.reasonCode)} · ${escapeHtml(row.reasonLabel)}</td>
              <td>${formatCurrency(row.Amount)}</td>
              <td>${escapeHtml(String(row.Year))}</td>
              <td>${row.ACAN ? "Yes" : "No"}</td>
            </tr>
          `
        )
        .join("");

      ledgerSummary.textContent = `${sorted.length.toLocaleString("en-CA")} records · ${formatCurrency(spend)} visible after filters.`;
      return;
    }

    const groups = new Map();
    sorted.forEach((row) => {
      const key = groupKey(row, ledgerState.group);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });

    const groupRows = [...groups.entries()]
      .sort((a, b) => b[1].reduce((sum, row) => sum + row.Amount, 0) - a[1].reduce((sum, row) => sum + row.Amount, 0))
      .map(([key, rows]) => {
        const groupSpend = rows.reduce((sum, row) => sum + row.Amount, 0);
        const header = `
          <tr class="ledger-group-row">
            <td colspan="7">
              <strong>${escapeHtml(key)}</strong>
              <span>${rows.length.toLocaleString("en-CA")} records · ${formatCurrency(groupSpend)}</span>
            </td>
          </tr>
        `;

        const detail = rows
          .slice(0, 30)
          .map(
            (row) => `
              <tr>
                <td>${escapeHtml(row.Contract_Number)}</td>
                <td>${escapeHtml(row.Department)}</td>
                <td>${escapeHtml(row.Vendor)}</td>
                <td>${escapeHtml(row.reasonCode)} · ${escapeHtml(row.reasonLabel)}</td>
                <td>${formatCurrency(row.Amount)}</td>
                <td>${escapeHtml(String(row.Year))}</td>
                <td>${row.ACAN ? "Yes" : "No"}</td>
              </tr>
            `
          )
          .join("");

        const overflow = rows.length > 30
          ? `<tr class="ledger-overflow"><td colspan="7">Showing top 30 rows in this group. Refine with search for deeper inspection.</td></tr>`
          : "";

        return `${header}${detail}${overflow}`;
      })
      .join("");

    ledgerBody.innerHTML = groupRows;
    ledgerSummary.textContent = `${sorted.length.toLocaleString("en-CA")} records across ${groups.size.toLocaleString("en-CA")} groups · ${formatCurrency(spend)} visible after filters.`;
  }

  ledgerSearch.addEventListener("input", (event) => {
    ledgerState.search = event.target.value || "";
    renderLedger();
  });

  ledgerGroup.addEventListener("change", (event) => {
    ledgerState.group = event.target.value || "none";
    renderLedger();
  });

  ledgerSort.addEventListener("change", (event) => {
    ledgerState.sort = event.target.value || "amount-desc";
    renderLedger();
  });

  renderLedger();
}

function activateView(viewName) {
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-active", view.dataset.view === viewName);
  });
  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === viewName);
  });

  if (viewName === "neighborhoods" && state.map) {
    window.setTimeout(() => state.map.resize(), 40);
  }

  if (viewName === "allocation" && !state.analyticsRendered) {
    if (state.analytics) {
      renderAnalytics(state.analytics, state.reasonCatalog);
      state.analyticsRendered = true;
    }
  }
}

async function boot() {
  try {
    const rows = await loadNeighborhoodData();
    state.rows = rows;

    updateNeighborhoodStats(rows);
    state.reasonCatalog = buildReasonCatalogFromNeighborhoods(rows);
    populateDepartmentFilter(rows);
    setupFilterHandlers();
    initializeMap(rows);

    loadAnalyticsData()
      .then((analytics) => {
        state.analytics = analytics;
      })
      .catch((error) => {
        console.error(error);
        const root = document.querySelector("#analytics-root");
        root.insertAdjacentHTML(
          "beforeend",
          `<p class="error">Analytics dataset unavailable right now. Neighborhood map remains fully operational.</p>`
        );
      });
  } catch (error) {
    console.error(error);
    const target = document.querySelector(".map-hero") || document.body;
    target.insertAdjacentHTML(
      "beforeend",
      `<p class="error">Could not load data artifacts. Run <code>npm run build:data</code> and verify files under <code>public/data</code>.</p>`
    );
  }
}

document.querySelectorAll(".nav-btn").forEach((button) => {
  button.addEventListener("click", () => activateView(button.dataset.view));
});

boot();
