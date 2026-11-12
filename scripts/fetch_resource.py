"""Solar and wind resource at every plant site, from NASA POWER.

Source: NASA Langley POWER Climatology API (v2), "RE" (renewable energy)
community, 2001–2025 long-term annual means. No API key needed.
  https://power.larc.nasa.gov/docs/services/api/temporal/climatology/
  Solar: CERES SYN1deg (~1° grid). Wind/temperature: NASA GMAO MERRA-2 (0.5° x 0.625°).
These are coarse grid-cell averages, good for comparing regions, not for
siting a specific array or turbine.

Usage: python scripts/fetch_resource.py
Inputs:  coal_plants_truck_proximity.csv, retired_plants_truck_proximity.csv,
         idle_fossil_plants.csv (any plant with lat/lon, all states)
Output:  site_resource.csv
Answers are cached in data/cache/nasa_power/ (keyed by coordinates).
"""
import json
import math
import time
from concurrent.futures import ThreadPoolExecutor

import pandas as pd
import requests

from common import ROOT

API = "https://power.larc.nasa.gov/api/temporal/climatology/point"
PARAMS = {
    "ALLSKY_SFC_SW_DWN": "ghi_kwh_m2_day",   # global horizontal irradiance
    "ALLSKY_SFC_SW_DNI": "dni_kwh_m2_day",   # direct normal irradiance
    "ALLSKY_KT": "clearness_index",
    "T2M": "temp_c",
    "WS10M": "wind_10m_ms",
    "WS50M": "wind_50m_ms",
}
CACHE = ROOT / "data" / "cache" / "nasa_power"
INPUTS = ["coal_plants_truck_proximity.csv", "retired_plants_truck_proximity.csv", "idle_fossil_plants.csv"]
HUB_M = 100


def query(lat: float, lon: float) -> dict:
    cached = CACHE / f"{lat:.4f}_{lon:.4f}.json"
    if cached.exists():
        return json.loads(cached.read_text())
    params = {"parameters": ",".join(PARAMS), "community": "RE", "format": "JSON",
              "latitude": f"{lat:.4f}", "longitude": f"{lon:.4f}"}
    for attempt in range(5):
        try:
            r = requests.get(API, params=params, timeout=90)
            r.raise_for_status()
            p = r.json()["properties"]["parameter"]
            ann = {k: (None if p[k]["ANN"] == -999 else p[k]["ANN"]) for k in PARAMS}
            CACHE.mkdir(parents=True, exist_ok=True)
            cached.write_text(json.dumps(ann))
            return ann
        except Exception:
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"NASA POWER query failed for {lat},{lon}")


def hub_wind(v10, v50):
    """Power-law extrapolation of 50 m wind to hub height, with the shear
    exponent taken from the 10 m / 50 m pair (clamped to a physical range)."""
    if not v10 or not v50:
        return None
    alpha = min(max(math.log(v50 / v10) / math.log(50 / 10), 0.05), 0.45)
    return v50 * (HUB_M / 50) ** alpha


def main() -> None:
    sites = pd.concat([pd.read_csv(ROOT / f, usecols=["Plant ID", "lat", "lon"]) for f in INPUTS])
    sites = sites.dropna().drop_duplicates("Plant ID").reset_index(drop=True)
    print(f"  {len(sites)} sites")
    with ThreadPoolExecutor(4) as pool:
        res = list(pool.map(query, sites.lat, sites.lon))
    out = pd.concat([sites[["Plant ID"]], pd.DataFrame(res).rename(columns=PARAMS)], axis=1)
    out["wind_100m_ms_est"] = [hub_wind(a, b) for a, b in zip(out.wind_10m_ms, out.wind_50m_ms)]
    out = out.round(3)
    out.to_csv(ROOT / "site_resource.csv", index=False)
    print(f"wrote site_resource.csv: {len(out)} sites, "
          f"{out.ghi_kwh_m2_day.notna().sum()} with solar, {out.wind_50m_ms.notna().sum()} with wind")


if __name__ == "__main__":
    main()
