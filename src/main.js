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
        <button class="nav-btn" data-view="allocation">Allocation Intelligence</button>
        <button class="nav-btn" data-view="philosophy">Philosophy</button>
      </nav>
    </header>

    <section class="view is-active" data-view="neighborhoods">
      <aside class="left-panel">
        <p class="eyebrow">Civic Monolith</p>
        <h1 class="title">Neighborhood Allocation Atlas</h1>
        <p class="lead">
          Click any neighborhood marker to inspect where the total comes from, down to
          vendor, contract detail, and policy reason.
        </p>

        <div class="stats-grid">
          <article class="stat-card">
            <span class="stat-label">Neighborhoods</span>
            <strong id="stat-neighborhoods">-</strong>
          </article>
          <article class="stat-card">
            <span class="stat-label">Total Spend</span>
            <strong id="stat-total">-</strong>
          </article>
          <article class="stat-card">
            <span class="stat-label">Mapped Contracts</span>
            <strong id="stat-contracts">-</strong>
          </article>
        </div>

        <section class="control-group">
          <h2>Department Filter</h2>
          <select id="dept-filter">
            <option value="">All Departments</option>
          </select>
        </section>

        <section class="control-group">
          <h2>Spend Bands</h2>
          <label><input type="checkbox" id="filter-small" checked /> $20k-$100k</label>
          <label><input type="checkbox" id="filter-medium" checked /> $100k-$500k</label>
          <label><input type="checkbox" id="filter-large" checked /> $500k+</label>
        </section>

        <section class="control-group">
          <h2>Legend</h2>
          <div class="legend-row"><span class="swatch low"></span><span>$20k-$100k</span></div>
          <div class="legend-row"><span class="swatch med"></span><span>$100k-$500k</span></div>
          <div class="legend-row"><span class="swatch high"></span><span>$500k-$2.5M</span></div>
          <div class="legend-row"><span class="swatch max"></span><span>$2.5M+</span></div>
        </section>
      </aside>

      <section class="map-stage">
        <div id="map" aria-label="Saskatoon neighborhood spending map"></div>
        <aside class="detail-panel" id="detail-panel">
          <div class="panel-header">
            <p class="eyebrow">Neighborhood Audit</p>
            <h2 id="drawer-name">Select a neighborhood</h2>
            <p id="drawer-meta">Project-level provenance will appear here.</p>
          </div>
          <div id="drawer-projects" class="project-list"></div>
        </aside>
      </section>
    </section>

    <section class="view" data-view="allocation">
      <section class="analytics-shell" id="analytics-root">
        <p class="eyebrow">Procurement Intelligence</p>
        <h1 class="title">Allocation Intelligence</h1>
        <p class="lead">Contract-level analytics from Non-Standard procurement records.</p>
      </section>
    </section>

    <section class="view" data-view="philosophy">
      <section class="philosophy-shell">
        <p class="eyebrow">Foundational Mission</p>
        <h1 class="title">The Architecture of Accountability</h1>
        <p class="lead">
          Every civic dollar should be legible as place, impact, and procurement intent.
          This interface treats budget records as structural evidence, not abstract totals.
        </p>
        <article class="philosophy-card">
          <h2>Zero-Dollar Ethos</h2>
          <p>
            We begin with proof, not assumptions. Neighborhood totals are shown with
            auditable provenance so residents can verify each layer of spend.
          </p>
        </article>
        <article class="philosophy-card">
          <h2>Civic Ledger</h2>
          <p>
            Allocation Intelligence translates raw contracts into clear yearly patterns,
            concentration risks, and policy exceptions for public scrutiny.
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

  return [...new Set(
    text
      .replace(/[\/&]/g, ",")
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => {
        const match = token.match(/[A-Z]/);
        return match ? match[0] : null;
      })
      .filter(Boolean)
  )];
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

  const acanYes = records.filter((row) => row.acan);
  const acanNo = records.filter((row) => !row.acan);

  return {
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
    byReason,
    topVendors,
    topContracts,
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
  const totalContracts = rows.reduce((sum, row) => sum + Number(row.Project_Count || 0), 0);

  document.querySelector("#stat-neighborhoods").textContent = String(rows.length);
  document.querySelector("#stat-total").textContent = formatCurrency(totalSpend);
  document.querySelector("#stat-contracts").textContent = totalContracts.toLocaleString("en-CA");
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
        "circle-color": "#ffb800",
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
          "#d9eaa3",
          200000,
          "#ffba20",
          500000,
          "#ff9d2f",
          5000000,
          "#ffb4ab",
        ],
        "circle-stroke-color": "#111316",
        "circle-stroke-width": 2,
        "circle-radius": ["interpolate", ["linear"], ["get", "spend"], 20000, 6, 200000, 10, 500000, 15, 5000000, 22],
      },
    });

    state.map.on("click", "spending-points", (event) => {
      const feature = event.features?.[0];
      if (!feature) return;

      const coordinates = feature.geometry.coordinates.slice();
      const { neighborhood, spend, contracts, topDept } = feature.properties;

      setDrawerContent(feature.properties);

      new maplibregl.Popup({ closeButton: true })
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

function renderAnalytics(analytics) {
  const root = document.querySelector("#analytics-root");
  const maxDept = Math.max(...analytics.byDepartment.map((item) => item.Total_Spend), 1);
  const maxReason = Math.max(...analytics.byReason.map((item) => item.Total_Spend), 1);

  const deptRows = analytics.byDepartment.slice(0, 8).map(
    (item) => `
      <div class="bar-row">
        <div class="bar-label">${escapeHtml(item.Department)}</div>
        <div class="bar-track"><span class="bar-fill" style="width:${(item.Total_Spend / maxDept) * 100}%"></span></div>
        <div class="bar-value">${formatCurrency(item.Total_Spend)}</div>
      </div>
    `
  ).join("");

  const reasonRows = analytics.byReason.slice(0, 8).map(
    (item) => `
      <div class="bar-row">
        <div class="bar-label">${escapeHtml(item.Reason_Code)}</div>
        <div class="bar-track"><span class="bar-fill muted" style="width:${(item.Total_Spend / maxReason) * 100}%"></span></div>
        <div class="bar-value">${formatCurrency(item.Total_Spend)}</div>
      </div>
    `
  ).join("");

  const topContracts = analytics.topContracts.slice(0, 10).map(
    (contract) => `
      <tr>
        <td>${escapeHtml(contract.Contract_Number)}</td>
        <td>${escapeHtml(contract.Department)}</td>
        <td>${escapeHtml(contract.Vendor)}</td>
        <td>${formatCurrency(contract.Amount)}</td>
        <td>${escapeHtml(String(contract.Year))}</td>
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
      <h2>Department Spend</h2>
      ${deptRows}
    </section>

    <section class="analytics-card two-col">
      <div>
        <h2>Reason Mix</h2>
        ${reasonRows}
      </div>
      <div>
        <h2>ACAN Share</h2>
        <p class="acan-row"><span>Yes</span><strong>${analytics.acan.Yes_Count.toLocaleString("en-CA")}</strong><span>${formatCurrency(analytics.acan.Yes_Spend)}</span></p>
        <p class="acan-row"><span>No</span><strong>${analytics.acan.No_Count.toLocaleString("en-CA")}</strong><span>${formatCurrency(analytics.acan.No_Spend)}</span></p>
      </div>
    </section>

    <section class="analytics-card">
      <h2>Top Contracts</h2>
      <table class="contracts-table">
        <thead><tr><th>Contract</th><th>Department</th><th>Vendor</th><th>Amount</th><th>Year</th></tr></thead>
        <tbody>${topContracts}</tbody>
      </table>
    </section>
  `;
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
      renderAnalytics(state.analytics);
      state.analyticsRendered = true;
    }
  }
}

async function boot() {
  try {
    const rows = await loadNeighborhoodData();
    state.rows = rows;

    updateNeighborhoodStats(rows);
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
    const target = document.querySelector(".left-panel") || document.body;
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
