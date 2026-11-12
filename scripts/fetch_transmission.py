"""Pull HIFLD transmission lines within 1 mile of each plant and estimate how
much power the existing lines at each site were built to carry.

Usage: python scripts/fetch_transmission.py INPUT.csv OUTPUT.csv [--min-mw COL MW]
  INPUT.csv needs "Plant ID", "state", "lat", "lon". Lower 48 only.
  --min-mw idle_fossil_mw 20   only query plants with that column >= 20

HIFLD answers are cached in data/cache/hifld/ (keyed by coordinates), so only
new plants are queried on later runs. Delete that folder to re-query everything.
"""
import argparse
import json
import time
import urllib.parse

import pandas as pd
import requests

from common import NOT_CONUS, ROOT

HIFLD = ("https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/"
         "Electric_Power_Transmission_Lines/FeatureServer/0/query")
CACHE = ROOT / "data" / "cache" / "hifld"
RADIUS_MI = 1.0
KEEP = ["Plant ID", "plant", "owner", "state", "lat", "lon",
        "coal_mw", "retired_yr", "idle_fossil_mw", "main_fuel", "main_status"]

# Approximate per-circuit thermal rating (MW) of a typical overhead AC line by
# voltage. Planning-level rules of thumb only; real ratings depend on conductor,
# bundling, ambient conditions and the terminal equipment.
RATING_MW = [(69, 75), (115, 150), (138, 200), (161, 250), (230, 450),
             (345, 1200), (500, 2500), (765, 4000)]


def rating(kv: float) -> float:
    # nearest voltage class at or below kv (fallback: lowest class)
    best = RATING_MW[0][1]
    for v, mw in RATING_MW:
        if kv >= v * 0.95:
            best = mw
    return best


def query(lat: float, lon: float) -> list[dict]:
    cached = CACHE / f"{lat:.5f}_{lon:.5f}.json"
    if cached.exists():
        return json.loads(cached.read_text())
    params = {
        "geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint",
        "inSR": 4326, "distance": RADIUS_MI, "units": "esriSRUnit_StatuteMile",
        "outFields": "ID,VOLTAGE,VOLT_CLASS,SUB_1,SUB_2,STATUS,OWNER",
        "returnGeometry": "false", "f": "json",
    }
    url = HIFLD + "?" + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            d = requests.get(url, timeout=60).json()
            if "error" in d:
                raise RuntimeError(d["error"])
            feats = [f["attributes"] for f in d.get("features", [])]
            CACHE.mkdir(parents=True, exist_ok=True)
            cached.write_text(json.dumps(feats))
            return feats
        except Exception:
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"HIFLD query failed for {lat},{lon}")


def line_stats(lat: float, lon: float) -> dict:
    lines = pd.DataFrame(query(lat, lon))
    if lines.empty:
        kv = mw = pd.Series(dtype=float)
    else:
        lines = lines.drop_duplicates("ID")
        kv = lines["VOLTAGE"].where(lines["VOLTAGE"] > 0)
        mw = kv.dropna().map(rating)
    thermal = float(mw.sum())
    return {
        "n_lines_1mi": int(len(lines)),
        "n_lines_unknown_kv": int(kv.isna().sum()),
        "max_kv": float(kv.max()) if kv.notna().any() else None,
        "voltages_kv": ";".join(str(int(v)) for v in sorted(kv.dropna().unique(), reverse=True)),
        "line_thermal_mw_est": thermal,
        "line_thermal_n1_mw_est": max(thermal - (float(mw.max()) if len(mw) else 0.0), 0.0),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--min-mw", nargs=2, metavar=("COLUMN", "MW"))
    a = ap.parse_args()

    plants = pd.read_csv(ROOT / a.input)
    plants = plants[~plants.state.isin(NOT_CONUS) & plants.lat.notna()]
    if a.min_mw:
        plants = plants[plants[a.min_mw[0]] >= float(a.min_mw[1])]
    rows = []
    for i, (_, p) in enumerate(plants.iterrows(), 1):
        rows.append({**{k: p[k] for k in KEEP if k in p}, **line_stats(p["lat"], p["lon"])})
        if i % 25 == 0:
            print(f"  transmission: {i}/{len(plants)}")
    out = pd.DataFrame(rows)
    out["Plant ID"] = out["Plant ID"].astype(int)
    out.to_csv(ROOT / a.output, index=False)
    print(f"wrote {a.output}: {len(out)} plants")


if __name__ == "__main__":
    main()
