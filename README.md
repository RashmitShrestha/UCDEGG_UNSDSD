# UCDEGG_UNSDSD
A repo to house the codebase for UCD's EGG team for the UN SDSN project in 2026

## View the dashboard

```bash
python -m http.server 8000     # run from the repo folder
```

Then open **http://localhost:8000**. The dashboard (`index.html`) reads the CSVs in this folder directly in the browser, so it always shows whatever data is there. No build step. Opening `index.html` by double-clicking won't work, because browsers block a `file://` page from reading local CSVs.

The same files work on **GitHub Pages**: Settings → Pages → Deploy from a branch → `main` / root.

## Update the data

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt   # once (Windows: .venv\Scripts\pip)
.venv/bin/python update.py                                          # run everything below, in order
```

`update.py` options: `--eia path.xlsx` (use a specific EIA workbook), `--skip-transmission` (skip HIFLD queries), `--skip-resource` (skip NASA POWER queries).

Python is only the data layer: every script writes CSVs, and the dashboard picks them up on reload. Each script can also be run on its own, from the repo root:

| # | Script | What it does | Writes |
|---|---|---|---|
| 1 | `python scripts/fetch_eia.py` | Downloads the newest EIA-860M monthly generator workbook (cached in `data/raw/eia860m/`) | the `.xlsx` |
| 2 | `python scripts/build_coal_plants.py <xlsx>` | Operating and retired (2015+) coal plants, plus distance to the nearest freight route and truck volumes within 10 mi | `coal_plants_truck_proximity.csv`, `retired_plants_truck_proximity.csv`, plant layers in `coal_trucks.gpkg` |
| 3 | `python scripts/idle_fossil_plants.py <xlsx>` | Plants where every coal/gas/oil unit is idle (out of service or standby), plus truck proximity | `idle_fossil_units.csv`, `idle_fossil_plants.csv` |
| 4 | `python scripts/fetch_transmission.py IN.csv OUT.csv [--min-mw COL MW]` | HIFLD transmission lines within 1 mi of each plant: count, max kV, rough line ratings (cached in `data/cache/hifld/`). `update.py` runs it for retired, idle ≥20 MW and operating coal plants | `retired_plants_transmission.csv`, `idle_plants_transmission.csv`, `coal_plants_transmission.csv` |
| 5 | `python scripts/summary_stats.py <release>` | Headline numbers behind `analysis.md` | `summary_stats.md` |
| 6 | `python scripts/fetch_resource.py` | Solar irradiance (GHI, DNI), wind speed (10 m, 50 m, estimated 100 m) and temperature at every plant, from NASA POWER (cached in `data/cache/nasa_power/`) | `site_resource.csv` |
| 7 | `python scripts/grid_mix.py <xlsx>` | Operating generating capacity by resource type (coal, gas, solar, wind…) per county and per state | `county_grid_mix.csv`, `state_grid_mix.csv` |
| 8 | `python scripts/export_trucks.py` | FAF5 heavy-truck network from `coal_trucks.gpkg`, simplified, as CSV with WKT geometry | `truck_routes.csv` |

`scripts/common.py` holds shared paths, EIA loading and the truck-proximity calculation.

## Dashboard

- **Sidebar**: search (plant, owner, county, state, route), sort, filters by plant type, fuel and state, and threshold sliders (capacity, freight distance, truck traffic, transmission kV, solar, wind, county renewable share).
- **Suitability score**: weighted average of each plant's percentile rank on solar, wind, truck traffic, freight proximity, transmission voltage and capacity. You set the weights in the sidebar. A factor with no data counts as the worst rank.
- **Map**: plants colored by type or by any score input, and truck corridors by volume.
- **Charts**: plants by type, capacity by fuel, top states, solar vs. wind, score distribution, and the grid mix of the counties shown.
- **Table and detail panel**: click any plant for its resource, grid access, county/state capacity mix and every raw CSV field. *Download filtered CSV* exports the current view.

Data sources and caveats are in `analysis.md`.
