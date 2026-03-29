import fs from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dataSummaryPath = path.join(rootDir, "data", "summary.json");
const csvPath = path.join(rootDir, "data", "Non-Standard.csv");
const publicSummaryPath = path.join(rootDir, "public", "data", "summary.json");
const analyticsPath = path.join(rootDir, "public", "data", "analytics.json");

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

async function buildSummary() {
  const [enrichedText, currentPublicText] = await Promise.all([
    fs.readFile(dataSummaryPath, "utf8"),
    fs.readFile(publicSummaryPath, "utf8").catch(() => "[]"),
  ]);

  const enrichedRows = JSON.parse(enrichedText);
  const currentPublicRows = JSON.parse(currentPublicText);
  const currentMap = keyByNeighborhood(currentPublicRows);

  const built = enrichedRows.map((row) => {
    const neighborhood = normalizeText(row.neighborhood || row.Neighborhood);
    const legacy = currentMap.get(neighborhood) || {};
    const projects = Array.isArray(row.projects)
      ? row.projects.map((project) => ({
          Vendor: normalizeText(project.vendor),
          Amount: toNumber(project.amount),
          Description: normalizeText(project.description, "Not provided"),
          Policy_Reason: normalizeText(project.policy_reason, "Not provided"),
        }))
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
  const csvText = await fs.readFile(csvPath, "utf8");
  const csvRows = parseCsv(csvText);

  const records = csvRows.map((row) => {
    const amount = toNumber(row.AMOUNT);
    const reasonCodes = parseReasonCodes(row.REASON);
    const year = Number(row.Year);

    return {
      department: normalizeText(row.DEPARTMENT),
      vendor: normalizeText(row.VENDOR),
      description: normalizeText(row.DESCRIPTION, "Not provided"),
      contractNumber: normalizeText(row.CONTRACT_NUMBER),
      year: Number.isFinite(year) ? year : null,
      amount,
      reasonRaw: normalizeText(row.REASON, "Unspecified"),
      reasonCodes,
      acan: String(row.ACAN ?? "").trim().toLowerCase() === "yes",
      fid: Number(row.FID) || null,
    };
  });

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
