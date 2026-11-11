"""Freight-truck proximity for retired coal plants (same metrics as
coal_plants_truck_proximity.csv uses for operating plants).

Output: retired_plants_truck_proximity.csv (repo root)
"""
from pathlib import Path

import geopandas as gpd

ROOT = Path(__file__).resolve().parents[1]
GPKG = ROOT / "coal_trucks.gpkg"
MI = 1609.344
CRS = 5070  # CONUS Albers, metres

plants = gpd.read_file(GPKG, layer="coal_plants_retired_2015plus")
plants["lat"] = plants["lat"].astype(float)
plants["lon"] = plants["lon"].astype(float)
plants = plants.to_crs(CRS)
roads = gpd.read_file(GPKG, layer="faf5_truck_flows_2022_1000plus").to_crs(CRS)

near = gpd.sjoin_nearest(plants, roads[["Sign_Rte", "trucks_day", "geometry"]],
                         distance_col="dist_m").drop_duplicates("Plant ID")
plants["mi_to_freight_net"] = near["dist_m"].values / MI
plants["nearest_freight_rte"] = near["Sign_Rte"].values
plants["nearest_rte_trucks_day"] = near["trucks_day"].values

buf = plants[["Plant ID", "geometry"]].copy()
buf["geometry"] = buf.buffer(10 * MI)
clip = gpd.overlay(roads[["trucks_day", "geometry"]], buf, how="intersection")
clip["truck_mi"] = clip.length / MI * clip["trucks_day"]
agg = clip.groupby("Plant ID").agg(max_trucks_day_10mi=("trucks_day", "max"),
                                   truck_mi_day_10mi=("truck_mi", "sum"))
out = plants.drop(columns="geometry").merge(agg, on="Plant ID", how="left")
out[["max_trucks_day_10mi", "truck_mi_day_10mi"]] = out[["max_trucks_day_10mi", "truck_mi_day_10mi"]].fillna(0)
out.to_csv(ROOT / "retired_plants_truck_proximity.csv", index=False)
print(out[["mi_to_freight_net", "max_trucks_day_10mi"]].describe())
