"""Shared paths, EIA-860M loading and freight-truck proximity."""
from pathlib import Path

import geopandas as gpd
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
GPKG = ROOT / "coal_trucks.gpkg"
TRUCK_LAYER = "faf5_truck_flows_2022_1000plus"
MI = 1609.344
CRS = 5070  # CONUS Albers, metres
NOT_CONUS = {"AK", "HI", "PR"}

FUEL_GROUP = {
    **dict.fromkeys(["BIT", "SUB", "LIG", "ANT", "RC", "WC", "SGC", "SC"], "coal"),
    **dict.fromkeys(["NG", "OG", "BFG", "PG", "SGP"], "gas"),
    **dict.fromkeys(["DFO", "RFO", "JF", "KER", "WO", "PC"], "oil"),
}


def load_eia(xlsx: Path, sheet: str) -> pd.DataFrame:
    """One EIA-860M inventory sheet ("Operating" or "Retired"), Puerto Rico included."""
    frames = []
    for name in (sheet, f"{sheet}_PR"):
        d = pd.read_excel(xlsx, sheet_name=name, header=2)
        frames.append(d[pd.to_numeric(d["Plant ID"], errors="coerce").notna()])
    g = pd.concat(frames, ignore_index=True)
    g["Plant ID"] = g["Plant ID"].astype(int)
    g["fuel_group"] = g["Energy Source Code"].map(FUEL_GROUP)
    g["mw"] = pd.to_numeric(g["Nameplate Capacity (MW)"], errors="coerce").fillna(0)
    if "Status" in g:
        g["status_code"] = g["Status"].str.extract(r"\((\w+)\)")[0]
    for c in ("Operating Year", "Planned Retirement Year", "Retirement Year", "Latitude", "Longitude"):
        if c in g:
            g[c] = pd.to_numeric(g[c], errors="coerce")
    return g


def truck_proximity(plants: pd.DataFrame) -> pd.DataFrame:
    """Add freight-route distance and truck-volume columns (lower 48 only).

    `plants` needs "Plant ID", "state", "lat", "lon". Rows outside the lower 48
    get NaN.
    """
    conus = plants[~plants.state.isin(NOT_CONUS) & plants.lat.notna()]
    pts = gpd.GeoDataFrame(conus[["Plant ID"]], crs=4326,
                           geometry=gpd.points_from_xy(conus.lon, conus.lat)).to_crs(CRS)
    roads = gpd.read_file(GPKG, layer=TRUCK_LAYER).to_crs(CRS)
    near = (gpd.sjoin_nearest(pts, roads[["Sign_Rte", "trucks_day", "geometry"]], distance_col="dist_m")
            .drop_duplicates("Plant ID").set_index("Plant ID"))
    out = pd.DataFrame({"mi_to_freight_net": near.dist_m / MI,
                        "nearest_freight_rte": near.Sign_Rte,
                        "nearest_rte_trucks_day": near.trucks_day})
    buf = pts.copy()
    buf["geometry"] = buf.buffer(10 * MI)
    clip = gpd.overlay(roads[["trucks_day", "geometry"]], buf, how="intersection")
    clip["truck_mi"] = clip.length / MI * clip.trucks_day
    agg = clip.groupby("Plant ID").agg(max_trucks_day_10mi=("trucks_day", "max"),
                                       truck_mi_day_10mi=("truck_mi", "sum"))
    out = out.join(agg)
    cols = ["max_trucks_day_10mi", "truck_mi_day_10mi"]
    out[cols] = out[cols].fillna(0)
    return plants.merge(out, left_on="Plant ID", right_index=True, how="left")


def to_gpkg_layer(df: pd.DataFrame, layer: str) -> None:
    """Replace one point layer in coal_trucks.gpkg, leaving the other layers alone."""
    gdf = gpd.GeoDataFrame(df, crs=4326, geometry=gpd.points_from_xy(df.lon, df.lat))
    gdf.to_file(GPKG, layer=layer, driver="GPKG")
