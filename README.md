# Saskatoon Spending Story

Interactive civic spending application with three views:
- Neighborhoods (map with project provenance drilldown)
- Spending Signals (contract analytics with year trends and reason context)
- Philosophy (method and mission narrative)

## What Is Included
- Vite web app setup for local development and production builds.
- MapLibre neighborhood map with click-to-audit details panel.
- Analytics view powered by CSV-derived datasets (with optional live API fallback), including year-by-year spend patterns and readable reason labels.
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

Optional analytics setup (PostHog):
```bash
cp .env.example .env.local
```
Then set:
- `VITE_POSTHOG_KEY`: your PostHog project API key (starts with `phc_`).
- `VITE_POSTHOG_HOST`: keep `https://us.i.posthog.com` unless your project is in EU (`https://eu.i.posthog.com`).

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
4. In **Project Settings -> Environment Variables**, add:
	 - `VITE_POSTHOG_KEY` = your PostHog key (starts with `phc_`)
	 - `VITE_POSTHOG_HOST` = `https://us.i.posthog.com` (or EU host if applicable)
5. Keep defaults:
	 - Build Command: `npm run build`
	 - Output Directory: `dist`
6. Click **Deploy**.

Every push to `main` will trigger an automatic redeploy.

## Data Notes
- `npm run build:data` regenerates `public/data/summary.json` and `public/data/analytics.json`.
- Neighborhood runtime rows use `Project_Count` and may include `Projects` for provenance drilldown.
- If `public/data/analytics.json` is unavailable, the app attempts a non-blocking live fallback from the City ArcGIS procurement endpoint.
