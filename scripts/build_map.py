"""Build coal_trucks_interactive.html: a compact, hand-written Leaflet map.

Usage: python scripts/build_map.py [path/to/<month>_generator<year>.xlsx]
  (the workbook name is only used for the "EIA-860M (Mon YYYY)" source label)

Inputs (repo root): coal_trucks.gpkg, coal_plants_truck_proximity.csv,
retired_plants_truck_proximity.csv, retired_plants_transmission.csv,
idle_fossil_plants.csv, idle_plants_transmission.csv
"""
import json
import re
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely import set_precision

from common import GPKG, ROOT, TRUCK_LAYER

IDLE_MIN_MW = 20  # smaller idle plants are mostly on-site backup diesel generators


def r(v, nd=0):
    return None if pd.isna(v) else round(float(v), nd) if nd else int(round(float(v)))


def s(v):
    return None if pd.isna(v) else v


def with_lines(df: pd.DataFrame, path: Path) -> pd.DataFrame:
    if path.exists():
        tx = pd.read_csv(path)[["Plant ID", "n_lines_1mi", "max_kv"]]
        return df.merge(tx, on="Plant ID", how="left")
    return df


def release_label(arg: list[str]) -> str:
    m = re.search(r"([a-z]+)_generator(\d{4})", arg[0] if arg else "")
    return f"{m[1][:3].title()} {m[2]}" if m else "latest release"


# --- truck network: merge segments sharing route + volume, simplify, round ---
roads = gpd.read_file(GPKG, layer=TRUCK_LAYER)
roads = roads.dissolve(by=["Sign_Rte", "trucks_day"], as_index=False)
roads["geometry"] = roads.to_crs(5070).simplify(800).to_crs(4326)
roads["geometry"] = set_precision(roads.geometry.values, 0.001)
roads = roads[~roads.geometry.is_empty]
roads["t"] = roads["trucks_day"].round().astype(int)
roads = roads.rename(columns={"Sign_Rte": "r"})[["r", "t", "geometry"]].sort_values("t")
trucks_geojson = json.loads(roads.to_json(drop_id=True))

# --- plants ---
op = pd.read_csv(ROOT / "coal_plants_truck_proximity.csv")
ret = with_lines(pd.read_csv(ROOT / "retired_plants_truck_proximity.csv"), ROOT / "retired_plants_transmission.csv")
idle = pd.read_csv(ROOT / "idle_fossil_plants.csv")
idle = with_lines(idle[idle.idle_fossil_mw >= IDLE_MIN_MW], ROOT / "idle_plants_transmission.csv")
# a coal plant whose units are all idle is shown once, as idle
op = op[~op["Plant ID"].isin(idle["Plant ID"])]


def common(p) -> dict:
    return {"n": p.plant, "o": s(p.owner), "s": p.state, "la": round(p.lat, 4), "lo": round(p.lon, 4),
            "fd": r(p.mi_to_freight_net, 1), "fr": s(p.nearest_freight_rte), "mt": r(p.max_trucks_day_10mi)}


plants = []
for _, p in ret.iterrows():
    plants.append({**common(p), "mw": r(p.coal_mw), "c": "retired", "y": int(p.retired_yr),
                   "kv": r(p.get("max_kv")), "nl": r(p.get("n_lines_1mi"))})
for _, p in idle.iterrows():
    plants.append({**common(p), "mw": r(p.idle_fossil_mw), "c": "idle", "f": p.main_fuel,
                   "st": p.main_status, "u": int(p.n_idle_units), "sec": s(p.sector),
                   "oo": r(p.other_operating_mw), "kv": r(p.get("max_kv")), "nl": r(p.get("n_lines_1mi"))})
cat = {"No retirement date": "none", "Retiring by 2030": "by2030", "Retiring 2031+": "after2030"}
for _, p in op.iterrows():
    plants.append({**common(p), "mw": r(p.coal_mw), "c": cat[p.status], "y": r(p.first_ret),
                   "u": int(p.n_units)})

meta = {"release": release_label(sys.argv[1:]),
        "retiredLabel": f"Retired coal {int(ret.retired_yr.min())}–{int(ret.retired_yr.max())}",
        "idleLabel": f"Idle coal/gas/oil ≥{IDLE_MIN_MW} MW"}

template = (ROOT / "scripts" / "map_template.html").read_text(encoding="utf-8")
html = (template
        .replace("/*TRUCKS*/null", json.dumps(trucks_geojson, separators=(",", ":")))
        .replace("/*PLANTS*/null", json.dumps(plants, separators=(",", ":")))
        .replace("/*META*/null", json.dumps(meta, ensure_ascii=False)))
out = ROOT / "coal_trucks_interactive.html"
out.write_text(html, encoding="utf-8")
print(f"wrote {out.name}: {out.stat().st_size / 1e6:.1f} MB, {len(roads)} road features, {len(plants)} plants")
