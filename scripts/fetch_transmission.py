"""Pull HIFLD transmission lines within 1 mile of each retired coal plant and
estimate how much power the existing lines at each site were built to carry.

Output: retired_plants_transmission.csv (repo root)
"""
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

import geopandas as gpd
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
HIFLD = ("https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/"
         "Electric_Power_Transmission_Lines/FeatureServer/0/query")
RADIUS_MI = 1.0

# Approximate per-circuit thermal rating (MW) of a typical overhead AC line by
# voltage. Planning-level rules of thumb only; real ratings depend on conductor,
# bundling, ambient conditions and the terminal equipment.
RATING_MW = [(69, 75), (115, 150), (138, 200), (161, 250), (230, 450),
             (345, 1200), (500, 2500), (765, 4000)]


def rating(kv: float) -> float | None:
    if kv is None or kv <= 0:
        return None
    # pick the nearest voltage class at or below kv (fallback: lowest class)
    best = RATING_MW[0][1]
    for v, mw in RATING_MW:
        if kv >= v * 0.95:
            best = mw
    return best


def query(lat: float, lon: float) -> list[dict]:
    params = {
        "geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint",
        "inSR": 4326, "distance": RADIUS_MI, "units": "esriSRUnit_StatuteMile",
        "outFields": "ID,VOLTAGE,VOLT_CLASS,SUB_1,SUB_2,STATUS,OWNER",
        "returnGeometry": "false", "f": "json",
    }
    url = HIFLD + "?" + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                d = json.load(r)
            return [f["attributes"] for f in d.get("features", [])]
        except Exception:
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"HIFLD query failed for {lat},{lon}")


def main() -> None:
    plants = gpd.read_file(ROOT / "coal_trucks.gpkg", layer="coal_plants_retired_2015plus")
    plants["lat"] = plants["lat"].astype(float)
    plants["lon"] = plants["lon"].astype(float)
    rows = []
    for _, p in plants.iterrows():
        lines = pd.DataFrame(query(p.lat, p.lon))
        if not lines.empty:
            lines = lines.drop_duplicates("ID")
            kv = lines["VOLTAGE"].where(lines["VOLTAGE"] > 0)
            mw = kv.map(lambda v: rating(v) if pd.notna(v) else None)
        else:
            kv = mw = pd.Series(dtype=float)
        thermal = float(mw.sum()) if len(mw) else 0.0
        largest = float(mw.max()) if mw.notna().any() else 0.0
        rows.append({
            "Plant ID": int(p["Plant ID"]), "plant": p.plant, "owner": p.owner,
            "state": p.state, "lat": p.lat, "lon": p.lon,
            "coal_mw": p.coal_mw, "retired_yr": p.retired_yr,
            "n_lines_1mi": int(len(lines)),
            "n_lines_unknown_kv": int(kv.isna().sum()) if len(kv) else 0,
            "max_kv": float(kv.max()) if kv.notna().any() else None,
            "voltages_kv": ";".join(str(int(v)) for v in sorted(kv.dropna().unique(), reverse=True)),
            "line_thermal_mw_est": thermal,
            "line_thermal_n1_mw_est": max(thermal - largest, 0.0),
        })
        print(f"{p.plant:35s} {len(lines):3d} lines  max {rows[-1]['max_kv']} kV")
    out = pd.DataFrame(rows)
    out.to_csv(ROOT / "retired_plants_transmission.csv", index=False)
    print("wrote", len(out), "rows")


if __name__ == "__main__":
    main()
