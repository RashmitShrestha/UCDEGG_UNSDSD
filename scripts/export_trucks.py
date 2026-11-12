"""Export the FAF5 heavy-truck network from coal_trucks.gpkg as a CSV the
dashboard can read directly: one row per route/volume group, geometry as WKT.

Segments sharing a route and truck volume are merged, simplified to ~800 m and
rounded to 0.001° (~100 m), which keeps the file a few MB.

Usage: python scripts/export_trucks.py
Output: truck_routes.csv  (route, trucks_day, wkt)
"""
import geopandas as gpd
from shapely import set_precision, to_wkt

from common import GPKG, ROOT, TRUCK_LAYER

roads = gpd.read_file(GPKG, layer=TRUCK_LAYER)
roads = roads.dissolve(by=["Sign_Rte", "trucks_day"], as_index=False)
roads["geometry"] = roads.to_crs(5070).simplify(800).to_crs(4326)
roads["geometry"] = set_precision(roads.geometry.values, 0.001)
roads = roads[~roads.geometry.is_empty].sort_values("trucks_day")
out = roads.rename(columns={"Sign_Rte": "route"})[["route"]].copy()
out["trucks_day"] = roads.trucks_day.round().astype(int)
out["wkt"] = to_wkt(roads.geometry.values, rounding_precision=3, trim=True)
out.to_csv(ROOT / "truck_routes.csv", index=False)
print(f"wrote truck_routes.csv: {len(out)} features, {(ROOT / 'truck_routes.csv').stat().st_size / 1e6:.1f} MB")
