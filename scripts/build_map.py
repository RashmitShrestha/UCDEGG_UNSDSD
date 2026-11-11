"""Build coal_trucks_interactive.html: a compact, hand-written Leaflet map.

Inputs (repo root): coal_trucks.gpkg, coal_plants_truck_proximity.csv,
retired_plants_truck_proximity.csv, retired_plants_transmission.csv
"""
import json
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely import set_precision

ROOT = Path(__file__).resolve().parents[1]
GPKG = ROOT / "coal_trucks.gpkg"


def r(v, nd=0):
    return None if pd.isna(v) else round(float(v), nd) if nd else int(round(float(v)))


# --- truck network: merge segments sharing route + volume, simplify, round ---
roads = gpd.read_file(GPKG, layer="faf5_truck_flows_2022_1000plus")
roads = roads.dissolve(by=["Sign_Rte", "trucks_day"], as_index=False)
roads["geometry"] = roads.to_crs(5070).simplify(800).to_crs(4326)
roads["geometry"] = set_precision(roads.geometry.values, 0.001)
roads = roads[~roads.geometry.is_empty]
roads["t"] = roads["trucks_day"].round().astype(int)
roads = roads.rename(columns={"Sign_Rte": "r"})[["r", "t", "geometry"]].sort_values("t")
trucks_geojson = json.loads(roads.to_json(drop_id=True))

# --- plants ---
op = pd.read_csv(ROOT / "coal_plants_truck_proximity.csv")
ret = pd.read_csv(ROOT / "retired_plants_truck_proximity.csv")
tx_path = ROOT / "retired_plants_transmission.csv"
if tx_path.exists():
    tx = pd.read_csv(tx_path)[["Plant ID", "n_lines_1mi", "max_kv"]]
    ret = ret.merge(tx, on="Plant ID", how="left")

plants = []
for _, p in ret.iterrows():
    plants.append({
        "n": p.plant, "o": p.owner, "s": p.state, "la": round(p.lat, 4), "lo": round(p.lon, 4),
        "mw": r(p.coal_mw), "c": "retired", "y": int(p.retired_yr),
        "fd": r(p.mi_to_freight_net, 1), "fr": None if pd.isna(p.nearest_freight_rte) else p.nearest_freight_rte,
        "mt": r(p.max_trucks_day_10mi),
        "kv": r(p.get("max_kv")), "nl": r(p.get("n_lines_1mi")),
    })
cat = {"No retirement date": "none", "Retiring by 2030": "by2030", "Retiring 2031+": "after2030"}
for _, p in op.iterrows():
    plants.append({
        "n": p.plant, "o": p.owner, "s": p.state, "la": round(p.lat, 4), "lo": round(p.lon, 4),
        "mw": r(p.coal_mw), "c": cat[p.status], "y": r(p.first_ret), "u": int(p.n_units),
        "fd": r(p.mi_to_freight_net, 1), "fr": None if pd.isna(p.nearest_freight_rte) else p.nearest_freight_rte,
        "mt": r(p.max_trucks_day_10mi),
    })

template = (ROOT / "scripts" / "map_template.html").read_text(encoding="utf-8")
html = (template
        .replace("/*TRUCKS*/null", json.dumps(trucks_geojson, separators=(",", ":")))
        .replace("/*PLANTS*/null", json.dumps(plants, separators=(",", ":"))))
out = ROOT / "coal_trucks_interactive.html"
out.write_text(html, encoding="utf-8")
print(f"wrote {out.name}: {out.stat().st_size / 1e6:.1f} MB, {len(roads)} road features, {len(plants)} plants")
