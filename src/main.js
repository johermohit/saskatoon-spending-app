import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

const app = document.querySelector("#app");

app.innerHTML = `
  <main class="layout">
    <section class="panel">
      <div class="eyebrow">Saskatoon Spending Story</div>
      <h1>Where infrastructure dollars are flowing</h1>
      <p class="lead">
        Built with a zero-dollar open-data approach: procurement records are matched
        to parcel addresses, then mapped to neighborhoods for transparent public insight.
      </p>

      <div class="stats">
        <article class="stat">
          <span class="label">Neighborhoods</span>
          <strong id="stat-neighborhoods">-</strong>
        </article>
        <article class="stat">
          <span class="label">Total Spend</span>
          <strong id="stat-total">-</strong>
        </article>
        <article class="stat">
          <span class="label">Contracts</span>
          <strong id="stat-contracts">-</strong>
        </article>
      </div>

      <p class="hint">Click a marker to inspect neighborhood spend details.</p>
    </section>

    <section class="map-wrap">
      <div id="map" aria-label="Saskatoon spending map"></div>
    </section>
  </main>
`;

const formatCurrency = (value) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);

const map = new maplibregl.Map({
  container: "map",
  style: "https://demotiles.maplibre.org/style.json",
  center: [-106.6702, 52.1332],
  zoom: 12,
  pitch: 0,
  bearing: 0,
  antialias: true,
});

map.addControl(new maplibregl.NavigationControl(), "top-right");

async function loadData() {
  const response = await fetch("/data/summary.json");
  if (!response.ok) {
    throw new Error(`Failed to load summary data: ${response.status}`);
  }

  const raw = await response.json();
  const cleaned = raw.filter(
    (row) =>
      Array.isArray(row.Coordinates) &&
      row.Coordinates.length === 2 &&
      Number.isFinite(Number(row.Total_Spend))
  );

  if (cleaned.length === 0) {
    throw new Error("No valid records found in summary data.");
  }

  return cleaned;
}

map.on("load", async () => {
  try {
    const rows = await loadData();

    const totalSpend = rows.reduce((sum, row) => sum + Number(row.Total_Spend), 0);
    const totalContracts = rows.reduce(
      (sum, row) => sum + Number(row.Contract_Count || 0),
      0
    );

    document.querySelector("#stat-neighborhoods").textContent = String(rows.length);
    document.querySelector("#stat-total").textContent = formatCurrency(totalSpend);
    document.querySelector("#stat-contracts").textContent = totalContracts.toLocaleString("en-CA");

    const geojson = {
      type: "FeatureCollection",
      features: rows.map((row) => ({
        type: "Feature",
        properties: {
          neighborhood: row.Neighborhood,
          spend: Number(row.Total_Spend),
          contracts: Number(row.Contract_Count || 0),
          topDept: row.Top_Department || "Unknown",
        },
        geometry: {
          type: "Point",
          coordinates: row.Coordinates,
        },
      })),
    };

    map.addSource("spending", {
      type: "geojson",
      data: geojson,
      cluster: true,
      clusterMaxZoom: 12,
      clusterRadius: 40,
      clusterProperties: {
        spendSum: ["+", ["get", "spend"]],
        contractsSum: ["+", ["get", "contracts"]],
      },
    });

    map.addLayer({
      id: "spending-glow",
      type: "circle",
      source: "spending",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": "#ffb347",
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["get", "spend"],
          20000,
          6,
          500000,
          16,
          5000000,
          28,
        ],
        "circle-opacity": 0.15,
        "circle-blur": 0.5,
      },
    });

    map.addLayer({
      id: "spending-points",
      type: "circle",
      source: "spending",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": [
          "interpolate",
          ["linear"],
          ["get", "spend"],
          20000,
          "#ffd699",
          200000,
          "#f5a623",
          500000,
          "#e67e22",
          5000000,
          "#c0392b",
        ],
        "circle-stroke-color": "#fff6e8",
        "circle-stroke-width": 2,
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["get", "spend"],
          20000,
          6,
          200000,
          10,
          500000,
          14,
          5000000,
          20,
        ],
        "circle-pitch-alignment": "map",
      },
    });

    map.addLayer({
      id: "spending-clusters",
      type: "circle",
      source: "spending",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#1f2837",
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["get", "point_count"],
          2,
          16,
          8,
          22,
          32,
          30,
        ],
        "circle-stroke-color": "#7ec8ff",
        "circle-stroke-width": 1.5,
      },
    });

    map.addLayer({
      id: "spending-cluster-count",
      type: "symbol",
      source: "spending",
      filter: ["has", "point_count"],
      layout: {
        "text-field": "{point_count_abbreviated}",
        "text-font": ["Open Sans Bold"],
        "text-size": 12,
      },
      paint: {
        "text-color": "#e8f4ff",
      },
    });

    map.on("click", "spending-points", (event) => {
      const feature = event.features?.[0];
      if (!feature) return;

      const coordinates = feature.geometry.coordinates.slice();
      const { neighborhood, spend, contracts, topDept } = feature.properties;

      new maplibregl.Popup({ closeButton: true })
        .setLngLat(coordinates)
        .setHTML(`
          <div class="popup">
            <h3>${neighborhood}</h3>
            <p><strong>Total Spend:</strong> ${formatCurrency(Number(spend))}</p>
            <p><strong>Contracts:</strong> ${Number(contracts).toLocaleString("en-CA")}</p>
            <p><strong>Top Department:</strong> ${topDept}</p>
          </div>
        `)
        .addTo(map);
    });

    map.on("click", "spending-clusters", (event) => {
      const feature = event.features?.[0];
      if (!feature) return;

      const clusterId = feature.properties.cluster_id;
      const source = map.getSource("spending");

      source.getClusterExpansionZoom(clusterId, (error, zoom) => {
        if (error) return;
        map.easeTo({ center: feature.geometry.coordinates, zoom });
      });
    });

    map.on("mouseenter", "spending-points", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "spending-points", () => {
      map.getCanvas().style.cursor = "";
    });
    map.on("mouseenter", "spending-clusters", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "spending-clusters", () => {
      map.getCanvas().style.cursor = "";
    });
  } catch (error) {
    console.error(error);
    const panel = document.querySelector(".panel");
    panel.insertAdjacentHTML(
      "beforeend",
      `<p class="error">Could not load spending data. Ensure <code>public/data/summary.json</code> is valid JSON.</p>`
    );
  }
});
