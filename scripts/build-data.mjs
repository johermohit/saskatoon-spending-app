import fs from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dataSummaryPath = path.join(rootDir, "data", "summary.json");
const csvPath = path.join(rootDir, "data", "Non-Standard.csv");
const publicSummaryPath = path.join(rootDir, "public", "data", "summary.json");
const analyticsPath = path.join(rootDir, "public", "data", "analytics.json");
const arcgisEndpoint =
  "https://services8.arcgis.com/Btd0M0xLx9Q5uIYf/arcgis/rest/services/non_standard_procurement_data/FeatureServer/0/query";

function toNumber(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value, fallback = "Unknown") {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : fallback;
}

function parseCsv(csvText) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];

    if (char === '"') {
      if (inQuotes && csvText[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && csvText[i + 1] === "\n") {
        i += 1;
      }
      row.push(cell);
      if (row.some((value) => String(value).trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((value) => String(value).trim().length > 0)) {
      rows.push(row);
    }
  }

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((values) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ?? "";
    });
    return record;
  });
}

function parseReasonCodes(reasonRaw) {
  const text = String(reasonRaw ?? "").toUpperCase().trim();
  if (!text) return [];

  const rawTokens = text
    .replace(/[\/&]/g, ",")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);

  const normalized = new Set();
  for (const token of rawTokens) {
    const match = token.match(/[A-Z]/);
    if (!match) continue;
    const base = match[0];
    normalized.add(base);
  }

  return [...normalized];
}

function keyByNeighborhood(rows) {
  const map = new Map();
  for (const row of rows) {
    const name = normalizeText(row.Neighborhood || row.neighborhood, "");
    if (!name) continue;
    map.set(name, row);
  }
  return map;
}

function aggregateBy(items, keySelector, amountSelector) {
  const map = new Map();
  for (const item of items) {
    const key = keySelector(item);
    const amount = amountSelector(item);
    if (!map.has(key)) {
      map.set(key, { key, spend: 0, contracts: 0 });
    }
    const entry = map.get(key);
    entry.spend += amount;
    entry.contracts += 1;
  }
  return [...map.values()];
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonOr(filePath, fallbackValue) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch {
    return fallbackValue;
  }
}

function normalizeProject(project) {
  return {
    Vendor: normalizeText(project.vendor ?? project.Vendor),
    Amount: toNumber(project.amount ?? project.Amount),
    Description: normalizeText(project.description ?? project.Description, "Not provided"),
    Policy_Reason: normalizeText(project.policy_reason ?? project.Policy_Reason, "Not provided"),
  };
}

function normalizeProcurementRecord(raw) {
  const amount = toNumber(raw.AMOUNT ?? raw.amount);
  const reasonRaw = normalizeText(raw.REASON ?? raw.reason, "Unspecified");
  const reasonCodes = parseReasonCodes(reasonRaw);
  const yearValue = Number(raw.Year ?? raw.year);
  const acanRaw = String(raw.ACAN ?? raw.acan ?? "").trim().toLowerCase();

  return {
    department: normalizeText(raw.DEPARTMENT ?? raw.department),
    vendor: normalizeText(raw.VENDOR ?? raw.vendor),
    description: normalizeText(raw.DESCRIPTION ?? raw.description, "Not provided"),
    contractNumber: normalizeText(raw.CONTRACT_NUMBER ?? raw.contract_number),
    year: Number.isFinite(yearValue) ? yearValue : null,
    amount,
    reasonRaw,
    reasonCodes,
    acan: acanRaw === "yes" || acanRaw === "y" || acanRaw === "true" || acanRaw === "1",
    fid: Number(raw.FID ?? raw.fid) || null,
  };
}

async function loadProcurementRows() {
  if (await fileExists(csvPath)) {
    const csvText = await fs.readFile(csvPath, "utf8");
    return parseCsv(csvText);
  }

  const params = new URLSearchParams({
    where: "1=1",
    outFields: "FID,Year,DEPARTMENT,VENDOR,DESCRIPTION,CONTRACT_NUMBER,AMOUNT,REASON,ACAN",
    returnGeometry: "false",
    f: "json",
  });

  const response = await fetch(`${arcgisEndpoint}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`ArcGIS fallback request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const features = Array.isArray(payload.features) ? payload.features : [];
  if (features.length === 0) {
    throw new Error("ArcGIS fallback returned no records.");
  }

  console.warn("CSV source missing; using ArcGIS API fallback to build analytics.");
  return features.map((feature) => feature.attributes || {}).filter(Boolean);
}

async function buildSummary() {
  const [enrichedRows, currentPublicRows] = await Promise.all([
    readJsonOr(dataSummaryPath, []),
    readJsonOr(publicSummaryPath, []),
  ]);

  const hasEnrichedRows = Array.isArray(enrichedRows) && enrichedRows.length > 0;
  const hasPublicRows = Array.isArray(currentPublicRows) && currentPublicRows.length > 0;

  if (!hasEnrichedRows && !hasPublicRows) {
    throw new Error("No summary source data found in data/summary.json or public/data/summary.json.");
  }

  if (!hasEnrichedRows && hasPublicRows) {
    console.warn("data/summary.json missing; preserving existing public/data/summary.json.");
    await fs.writeFile(publicSummaryPath, `${JSON.stringify(currentPublicRows, null, 2)}\n`, "utf8");

    return {
      neighborhoods: currentPublicRows.length,
      projects: currentPublicRows.reduce(
        (sum, row) => sum + (Number(row.Project_Count) || (Array.isArray(row.Projects) ? row.Projects.length : 0)),
        0
      ),
      spend: currentPublicRows.reduce((sum, row) => sum + toNumber(row.Total_Spend), 0),
    };
  }

  const currentMap = keyByNeighborhood(currentPublicRows);

  const built = enrichedRows.map((row) => {
    const neighborhood = normalizeText(row.neighborhood || row.Neighborhood);
    const legacy = currentMap.get(neighborhood) || {};
    const projects = Array.isArray(row.projects)
      ? row.projects.map(normalizeProject)
      : Array.isArray(row.Projects)
        ? row.Projects.map(normalizeProject)
      : [];

    return {
      Neighborhood: neighborhood,
      Total_Spend: toNumber(row.total_spend ?? row.Total_Spend),
      Project_Count: Number(row.project_count ?? row.Project_Count ?? projects.length) || 0,
      Top_Department: normalizeText(legacy.Top_Department, "Unknown"),
      Context: normalizeText(legacy.Context, "Neighborhood-level procurement aggregation."),
      Link: normalizeText(legacy.Link, "#"),
      Coordinates: Array.isArray(row.coordinates)
        ? row.coordinates
        : Array.isArray(row.Coordinates)
          ? row.Coordinates
          : Array.isArray(legacy.Coordinates)
            ? legacy.Coordinates
            : [-106.6702, 52.1332],
      Projects: projects,
    };
  });

  await fs.writeFile(publicSummaryPath, `${JSON.stringify(built, null, 2)}\n`, "utf8");

  return {
    neighborhoods: built.length,
    projects: built.reduce((sum, row) => sum + row.Project_Count, 0),
    spend: built.reduce((sum, row) => sum + row.Total_Spend, 0),
  };
}

async function buildAnalytics() {
  const rows = await loadProcurementRows();
  const records = rows.map(normalizeProcurementRecord);

  const validRecords = records.filter((record) => record.amount > 0);
  const years = validRecords.map((record) => record.year).filter((year) => Number.isFinite(year));
  const totalSpend = validRecords.reduce((sum, record) => sum + record.amount, 0);

  const byDepartment = aggregateBy(
    validRecords,
    (record) => record.department,
    (record) => record.amount
  )
    .sort((a, b) => b.spend - a.spend)
    .map((entry) => ({
      Department: entry.key,
      Total_Spend: Number(entry.spend.toFixed(2)),
      Contract_Count: entry.contracts,
    }));

  const byYear = aggregateBy(
    validRecords.filter((record) => Number.isFinite(record.year)),
    (record) => String(record.year),
    (record) => record.amount
  )
    .sort((a, b) => Number(a.key) - Number(b.key))
    .map((entry) => ({
      Year: Number(entry.key),
      Total_Spend: Number(entry.spend.toFixed(2)),
      Contract_Count: entry.contracts,
    }));

  const vendorAgg = aggregateBy(
    validRecords,
    (record) => record.vendor,
    (record) => record.amount
  ).sort((a, b) => b.spend - a.spend);

  const reasonSpendMap = new Map();
  for (const record of validRecords) {
    const reasonCodes = record.reasonCodes.length > 0 ? record.reasonCodes : ["Unspecified"];
    for (const code of reasonCodes) {
      if (!reasonSpendMap.has(code)) {
        reasonSpendMap.set(code, { code, spend: 0, contracts: 0 });
      }
      const entry = reasonSpendMap.get(code);
      entry.spend += record.amount;
      entry.contracts += 1;
    }
  }

  const byReason = [...reasonSpendMap.values()]
    .sort((a, b) => b.spend - a.spend)
    .map((entry) => ({
      Reason_Code: entry.code,
      Total_Spend: Number(entry.spend.toFixed(2)),
      Contract_Count: entry.contracts,
    }));

  const acanYes = validRecords.filter((record) => record.acan);
  const acanNo = validRecords.filter((record) => !record.acan);

  const payload = {
    generatedAt: new Date().toISOString(),
    totals: {
      Contracts: validRecords.length,
      Total_Spend: Number(totalSpend.toFixed(2)),
      Unique_Departments: new Set(validRecords.map((record) => record.department)).size,
      Unique_Vendors: new Set(validRecords.map((record) => record.vendor)).size,
      Year_Start: years.length > 0 ? Math.min(...years) : null,
      Year_End: years.length > 0 ? Math.max(...years) : null,
    },
    acan: {
      Yes_Count: acanYes.length,
      Yes_Spend: Number(acanYes.reduce((sum, record) => sum + record.amount, 0).toFixed(2)),
      No_Count: acanNo.length,
      No_Spend: Number(acanNo.reduce((sum, record) => sum + record.amount, 0).toFixed(2)),
    },
    byDepartment,
    byYear,
    byReason,
    topVendors: vendorAgg.slice(0, 15).map((entry) => ({
      Vendor: entry.key,
      Total_Spend: Number(entry.spend.toFixed(2)),
      Contract_Count: entry.contracts,
    })),
    topContracts: [...validRecords]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 30)
      .map((record) => ({
        Contract_Number: record.contractNumber,
        Department: record.department,
        Vendor: record.vendor,
        Description: record.description,
        Year: record.year,
        Amount: Number(record.amount.toFixed(2)),
        Reason: record.reasonRaw,
        ACAN: record.acan,
        FID: record.fid,
      })),
  };

  await fs.writeFile(analyticsPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return {
    contracts: payload.totals.Contracts,
    spend: payload.totals.Total_Spend,
    departments: payload.totals.Unique_Departments,
  };
}

async function main() {
  const [summaryStats, analyticsStats] = await Promise.all([buildSummary(), buildAnalytics()]);

  console.log(
    `Built summary: ${summaryStats.neighborhoods} neighborhoods, ${summaryStats.projects} projects, ${summaryStats.spend.toFixed(2)} total spend.`
  );
  console.log(
    `Built analytics: ${analyticsStats.contracts} contracts, ${analyticsStats.departments} departments, ${analyticsStats.spend.toFixed(2)} total spend.`
  );
}

main().catch((error) => {
  console.error("Failed to build data artifacts.");
  console.error(error);
  process.exit(1);
});
