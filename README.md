# Saskatoon Spending Story

Interactive map application for visualizing City of Saskatoon infrastructure spending by neighborhood using open data only.

## What Is Included
- Vite web app setup for local development and production builds.
- MapLibre map with scaled spending markers, clustering, and detail popups.
- Summary KPI panel showing neighborhood count, total spend, and contract totals.
- Static runtime data loaded from `public/data/summary.json`.

## Project Structure
- `src/main.js`: App and map logic.
- `src/styles.css`: UI styling.
- `public/data/summary.json`: Runtime summary dataset used by the frontend.
- `data/summary.json`: Source data snapshot (kept for pipeline/reference).

## Run Locally
```bash
npm install
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
- The app expects each row in `public/data/summary.json` to include:
	- `Neighborhood`
	- `Total_Spend`
	- `Contract_Count`
	- `Top_Department`
	- `Coordinates` as `[longitude, latitude]`
