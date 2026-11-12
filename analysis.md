# Retired coal plants as EV-truck charging hubs: analysis

## The idea

Retired coal plants already have a high-voltage grid connection: a switchyard, step-up transformers and transmission lines built to carry hundreds of megawatts. Many also sit near major freight corridors. Building a large truck-charging site normally means waiting years for a new grid connection. These sites could reuse the one that is already there, ideally paired with solar, wind or batteries placed on the same site.

## Headline numbers

| Metric | Value |
|---|---|
| Coal plants fully retired, 2015–2025 (lower 48) | **184 plants** |
| Combined coal capacity of those plants | **104,447 MW (≈104.4 GW)** |
| Median plant size | 385 MW (mean 568 MW; range 1.5–2,741 MW) |
| Retired plants with a 230 kV+ line within 1 mile | 111 plants, ≈89.2 GW |
| Retired plants within 5 miles of a 1,000+ trucks/day freight route | 95 plants, ≈47.4 GW |
| More plants with coal units scheduled to retire by 2030 | 33 plants, ≈36.8 GW of units retiring |

"Retired" means every coal unit at the plant is retired. Plants that are still partly running are listed separately with their planned retirement dates (see `coal_plants_truck_proximity.csv`).

### Retirements by year

| Year | Plants | MW |
|---|---:|---:|
| 2015 | 38 | 16,608 |
| 2016 | 21 | 6,176 |
| 2017 | 13 | 5,121 |
| 2018 | 18 | 14,692 |
| 2019 | 26 | 13,387 |
| 2020 | 17 | 10,581 |
| 2021 | 13 | 5,189 |
| 2022 | 19 | 16,304 |
| 2023 | 11 | 8,105 |
| 2024 | 4 | 4,631 |
| 2025 | 4 | 3,654 |
| **Total** | **184** | **104,447** |

Top states by retired megawatts: Ohio (13.9 GW, 14 plants), Texas (7.6 GW), Illinois (6.7 GW), Kentucky (6.0 GW), Michigan (5.9 GW), Georgia (5.9 GW), Pennsylvania (5.8 GW).

## How much power can the existing T&D handle?

### Short answer: about 104 GW, roughly equal to the former nameplate capacity

A plant's grid connection was designed and studied to export its full output. That includes the step-up transformers, the switchyard breakers and the outgoing lines. **So the best estimate of each site's grid capacity is the plant's former coal nameplate MW.** Across all 184 sites, that is about **104 GW**. For a single site, it is typically 100–1,000 MW (median 385 MW).

### Voltage of the lines at each site

To check whether the high-voltage lines are still there, I queried the HIFLD transmission-line dataset for lines within 1 mile of each retired plant (`retired_plants_transmission.csv`).

| Highest voltage within 1 mile | Plants | Retired coal MW | Typical capacity of one circuit* |
|---|---:|---:|---|
| 500–765 kV | 21 | 26,156 | ~2,500–4,000 MW |
| 345 kV | 50 | 44,324 | ~1,200 MW |
| 230 kV | 40 | 18,688 | ~450 MW |
| 115–161 kV | 56 | 14,615 | ~150–250 MW |
| None mapped within 1 mile | 17 | 664 | — |

\*These are rough planning figures for one overhead AC circuit. Actual ratings depend on the conductor, weather and terminal equipment. Most sites have several circuits.

- **167 of 184 sites (≈104 GW)** still have mapped transmission within 1 mile, and **111 sites (≈89 GW)** have a line at 230 kV or higher. At that voltage, a single circuit can carry hundreds of megawatts to several gigawatts.
- The 17 sites with no mapped line are all small (664 MW combined): mostly industrial or institutional boilers such as paper mills and campus steam plants, which may never have had a dedicated high-voltage line. An earlier run reported 25 such sites, including Bruce Mansfield (PA, 2.7 GW) and Wansley (GA, 1.9 GW). Those were failed HIFLD queries that had been recorded as "no lines". Re-queried, they show 345 kV and 500 kV lines respectively. `fetch_transmission.py` now stops with an error when a query fails instead of recording zero lines.
- `retired_plants_transmission.csv` also has a `line_thermal_mw_est` column, which adds up the rough ratings of every mapped line segment. **Don't quote it as site capacity.** HIFLD splits lines into many segments, and lines that simply pass through a substation get counted too. That inflates the total (762 GW across all sites) far above what any site could actually draw. Use it only to rank sites against each other.

### What that means for truck charging

| Example site | Grid capacity | Megawatt chargers (MCS) it could supply at once |
|---|---|---|
| Median retired plant | ~385 MW | ~380 at 1 MW, or ~100 at the 3.75 MW MCS maximum |
| Small plant | ~100 MW | ~100 at 1 MW |
| Large plant | ~1,000+ MW | 1,000+ at 1 MW |

The Megawatt Charging System (MCS, SAE J3271) supports up to about 3.75 MW per charger. Real-world heavy-truck chargers today mostly run at about 1 MW. Even a small retired plant's grid connection is far larger than any truck stop would need. The limiting factors will be the points under caveats below, not the wires.

## Overlap with freight corridors

Freight data: FHWA FAF5 2022 highway assignment, limited to road segments carrying at least 1,000 trucks per day (`retired_plants_truck_proximity.csv`).

| Distance to a 1,000+ trucks/day route | Plants | Retired MW |
|---|---:|---:|
| ≤ 1 mile | 26 | 7,808 |
| ≤ 5 miles | 95 | 47,416 |
| ≤ 10 miles | 128 | 67,271 |

The median retired plant is 4.8 miles from such a route.

### Shortlist: a strong grid connection next to heavy truck traffic

These sites meet all three filters: ≤5 miles to the freight network, ≥230 kV transmission within 1 mile, and ≥2,500 trucks/day within 10 miles. **35 plants, 24.9 GW** qualify. The top 15 by truck volume:

| Plant | State | Coal MW | Retired | Max kV | Miles to route | Route | Busiest segment ≤10 mi (trucks/day) |
|---|---|---:|---:|---:|---:|---|---:|
| Will County | IL | 1,269 | 2022 | 345 | 2.6 | I-355 | 9,212 |
| Logan Generating Plant | NJ | 242 | 2022 | 230 | 2.4 | I-495 | 8,466 |
| Avon Lake | OH | 766 | 2022 | 345 | 2.8 | I-90 | 7,052 |
| Allen | TN | 990 | 2018 | 500 | 4.1 | I-55 | 6,240 |
| Bull Run | TN | 950 | 2023 | 500 | 3.0 | — | 5,204 |
| FirstEnergy Eastlake | OH | 1,257 | 2015 | 345 | 3.7 | I-90 | 5,117 |
| Kraft | GA | 208 | 2015 | 230 | 1.8 | GA-21 | 5,017 |
| St Johns River Power Park | FL | 1,358 | 2018 | 230 | 1.2 | I-295 | 4,683 |
| Bridgeport Station | CT | 400 | 2021 | 345 | 0.3 | I-95 | 4,661 |
| Valmont | CO | 192 | 2017 | 230 | 2.1 | SR-157 | 4,589 |
| C R Huntley | NY | 780 | 2016 | 230 | 4.5 | — | 4,324 |
| Cherokee | CO | 421 | 2015 | 230 | 0.8 | I-270 | 4,269 |
| Pleasant Prairie | WI | 1,233 | 2018 | 345 | 2.0 | — | 4,092 |
| R Gallagher | IN | 600 | 2021 | 345 | 1.3 | I-64 | 4,054 |
| Scholz | FL | 98 | 2015 | 230 | 2.5 | I-10 | 3,951 |

"—" means the nearest network segment has no signed route number in FAF5.

## Caveats

1. **Grid connection rights often expire after retirement.** In PJM, for example, a retired plant keeps its "capacity interconnection rights" for about a year unless they are transferred to a replacement project. Check site by site whether those rights are still held, sold, or already reused.
2. **Many sites are already being reused.** TVA's Allen site, for example, now has a gas plant using that connection. Gas plants, battery storage, solar and data centers all compete for these connections. Check each site's current status before shortlisting it.
3. **Supplying power is not the same as exporting it.** These connections were studied for a plant pushing power onto the grid. A charging hub draws power from it, which needs a separate load study from the utility, even if the equipment is physically big enough.
4. **Cleaner power is a real option here.** FERC Order 845 allows "surplus interconnection service", and several grid operators offer a "generator replacement" process. Both let new solar, wind or storage reuse an existing connection, so pairing on-site solar and batteries with chargers fits these sites well.
5. **Coal ash and site cleanup.** Ash ponds and contamination may limit which parts of a site can be built on.
6. **Truck counts are modeled, not counted.** FAF5 assigns estimated freight flows to the road network, so it shows corridor demand, not actual stops at a site.

## Idle (not retired) fossil plants: coal, gas and oil

Everything above covers **retired** coal plants. EIA-860M also lists generators that are still on the books but not running. They sit on the "Operating" sheet with one of three statuses:

| Status | EIA definition | How idle |
|---|---|---|
| **OS** | Out of service, not expected to return next calendar year | Most idle. Effectively mothballed |
| **OA** | Out of service, expected to return next calendar year | Temporarily down (repairs, economics) |
| **SB** | Standby/backup: available but not normally used | Runs occasionally (peaks, emergencies) |

From the Sep 2026 release (`scripts/idle_fossil_plants.py`):

| | Units | MW |
|---|---:|---:|
| All idle fossil generators (OS + OA + SB), incl. at plants that otherwise run | 1,800 | 17,842 |
| …of which coal / gas / oil | 22 / 379 / 1,399 | 2,499 / 11,464 / 3,876 |
| Plants where **every** fossil unit is idle | 370 plants | 10,176 |
| …of those, ≥20 MW | 65 plants | 8,514 |
| …≥20 MW, lower 48, ≤5 mi from a 1,000+ trucks/day route | 32 plants | 5,074 |

- **Idle fossil is small next to retired coal.** About 10 GW at fully idle plants, compared with 104 GW of retired coal. Most idle units are small standby diesel generators: 1,295 oil units at SB, 2.9 GW in total.
- Of the ≥20 MW fully idle plants, 16 (3.5 GW) are mainly **OS**, which is the closest to "sitting there doing nothing". 47 (5.0 GW) are mainly **SB**, which still run sometimes, so their grid connection is not entirely free.
- Some sites are industrial or commercial backup generators, such as refineries and data centers ("SC 1 Data Center"). Their connection serves an on-site load, not the bulk grid. Filter by the `sector` column (Electric Utility / IPP rows are the relevant ones: 41 plants, 7.4 GW).
- Another 7.7 GW of idle units sit at plants that still have other fossil units running, for example Big Cajun 2 (LA, 658 MW coal OS) and Merrimack (NH, 346 MW coal OS). These are in `idle_fossil_units.csv` but not in the plant list, because the site's connection is still in use.

Largest fully idle plants (≥20 MW):

| Plant | State | Fuel | Status | Idle MW | Miles to route | Busiest segment ≤10 mi (trucks/day) |
|---|---|---|---|---:|---:|---:|
| Sandy Creek Energy Station | TX | coal | OS | 1,008 | 1.9 | 1,708 |
| Rockingham County CT Station | NC | gas | SB | 978 | 6.1 | 1,709 |
| Middletown | CT | oil | OS | 786 | 2.5 | 3,214 |
| Indian River | FL | gas | OS | 609 | 2.7 | 2,297 |
| Elizabeth River Power Station | VA | gas | SB | 389 | 5.0 | 3,073 |
| MPH Elwood | IL | gas | OS | 384 | 3.7 | 7,939 |
| Fredonia (WA) | WA | gas | SB | 376 | 4.2 | 2,182 |
| NAEA Lakewood LLC | NJ | gas | SB | 288 | 0.2 | 5,362 |
| Louisiana 2 | LA | gas | SB | 175 | 3.5 | 5,924 |
| Hazelton | PA | gas | SB | 172 | 1.2 | 4,953 |

Transmission (`idle_plants_transmission.csv`, the 61 plants in the lower 48 that are ≥20 MW): **27 plants (6.6 GW) have a 230 kV+ line within 1 mile**. 17 have no mapped line, mostly small on-site plants.

## Data sources

| Data | Source | Used for |
|---|---|---|
| Coal plant capacity, retirement status and dates | U.S. EIA, **Form EIA-860M "Monthly Update to the Annual Electric Generator Report"**, Sep 2026 release. https://www.eia.gov/electricity/data/eia860m/ | Plant lists, MW, retired / planned retirement years (`coal_trucks.gpkg` plant layers) |
| Heavy-truck flows | U.S. DOT FHWA / BTS, **Freight Analysis Framework v5 (FAF5), 2022 highway network assignment**. https://ops.fhwa.dot.gov/freight/freight_analysis/faf/ | Trucks/day per road segment (`faf5_truck_flows_2022_1000plus` layer, segments ≥1,000 trucks/day) |
| Transmission lines | DHS / CISA **HIFLD "Electric Power Transmission Lines"** (ArcGIS feature service, last data edit Sep 2023). https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Power_Transmission_Lines/FeatureServer/0 | Line voltage near each retired plant |
| Basemap | Esri World Light Gray Canvas | Interactive map only |

The plant layers in `coal_trucks.gpkg` are rebuilt from the EIA workbook by `scripts/build_coal_plants.py`, which reproduces the original Sep 2026 layers exactly (same 206 operating and 184 retired plants, same MW). The FAF5 truck layer is fixed input and isn't rebuilt.

## Files and reproduction

One command rebuilds everything from the newest EIA-860M release:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # once
.venv/bin/python update.py
```

`update.py` runs these steps in order (each can also be run on its own):

1. `scripts/fetch_eia.py` finds and downloads the latest monthly workbook into `data/raw/eia860m/` (git-ignored). EIA-860M is cumulative, so only the newest file is needed.
2. `scripts/build_coal_plants.py` → coal plant layers in `coal_trucks.gpkg`, `coal_plants_truck_proximity.csv`, `retired_plants_truck_proximity.csv`
3. `scripts/idle_fossil_plants.py` → `idle_fossil_units.csv`, `idle_fossil_plants.csv`
4. `scripts/fetch_transmission.py` → `retired_plants_transmission.csv`, `idle_plants_transmission.csv`. It queries HIFLD, about 10 minutes the first time. Results are cached in `data/cache/hifld/`, so later runs only query new plants. Use `--skip-transmission` to skip this step.
5. `scripts/summary_stats.py` → `summary_stats.md` (headline numbers, auto-generated)
6. `scripts/build_map.py` + `scripts/map_template.html` → `coal_trucks_interactive.html`

This document is written by hand. After an update, compare its tables with `summary_stats.md` and copy over any changed numbers. `coal_trucks_conus.png` is a static image from the original analysis and is not regenerated.
