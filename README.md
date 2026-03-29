# Saskatoon Spending Story

Interactive civic spending application with three views:
- Neighborhoods (map with project provenance drilldown)
- Allocation Intelligence (contract analytics)
- Philosophy (method and mission narrative)

## What Is Included
- Vite web app setup for local development and production builds.
- MapLibre neighborhood map with click-to-audit details panel.
- Analytics view powered by CSV-derived datasets (with optional live API fallback).
- Build-time data pipeline that outputs runtime artifacts under `public/data/`.

## Project Structure
- `src/main.js`: App and map logic.
- `src/styles.css`: UI styling.
- `scripts/build-data.mjs`: Data pipeline (summary + analytics artifacts).
- `public/data/summary.json`: Runtime neighborhood dataset used by the map.
- `public/data/analytics.json`: Runtime analytics dataset.
- `data/summary.json`: Enriched neighborhood source with project-level details.
- `data/Non-Standard.csv`: Contract-level source data.

## Run Locally
```bash
npm install
npm run build:data
npm run dev
```

Vite will print a local URL (usually `http://localhost:5173`).

## Build for Production
```bash
npm run build
```

Build output is generated in `dist/`.

## Deploy to Vercel
1. Push this repository to GitHub.
2. In Vercel, click **Add New Project** and import the repository.
3. Vercel will auto-detect Vite using `vercel.json`.
4. Keep defaults:
	 - Build Command: `npm run build`
	 - Output Directory: `dist`
5. Click **Deploy**.

Every push to `main` will trigger an automatic redeploy.

## Data Notes
- `npm run build:data` regenerates `public/data/summary.json` and `public/data/analytics.json`.
- Neighborhood runtime rows use `Project_Count` and may include `Projects` for provenance drilldown.
- If `public/data/analytics.json` is unavailable, the app attempts a non-blocking live fallback from the City ArcGIS procurement endpoint.
