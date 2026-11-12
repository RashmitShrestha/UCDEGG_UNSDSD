"""Coal plant layers from EIA-860M (lower 48).

Replaces the original, missing script that built the plant layers in
coal_trucks.gpkg. Definitions (they reproduce the Sep 2026 layers exactly):
  operating  every plant with a coal unit on the "Operating" sheet (any status)
  retired    plants with no coal unit left on the "Operating" sheet whose last
             coal unit retired in 2015 or later

Usage: python scripts/build_coal_plants.py path/to/<month>_generator<year>.xlsx
Outputs: gpkg layers coal_plants_operating, coal_plants_retired_2015plus;
         coal_plants_truck_proximity.csv, retired_plants_truck_proximity.csv
"""
import sys
from pathlib import Path

import pandas as pd

from common import NOT_CONUS, ROOT, load_eia, to_gpkg_layer, truck_proximity

RETIRED_SINCE = 2015
SOON = 2030


def plant_info(d: pd.DataFrame) -> dict:
    return {"plant": d["Plant Name"].iloc[0], "owner": d["Entity Name"].iloc[0],
            "state": d["Plant State"].iloc[0], "county": d["County"].iloc[0],
            "lat": d["Latitude"].iloc[0], "lon": d["Longitude"].iloc[0]}


def operating(op: pd.DataFrame) -> pd.DataFrame:
    coal = op[(op.fuel_group == "coal") & ~op["Plant State"].isin(NOT_CONUS)]

    def summarize(d):
        ret = d["Planned Retirement Year"]
        first = ret.min()
        return pd.Series({**plant_info(d), "coal_mw": d.mw.sum(), "n_units": len(d),
                          "first_ret": first, "mw_retiring": d.loc[ret.notna(), "mw"].sum(),
                          "status": ("No retirement date" if pd.isna(first)
                                     else f"Retiring by {SOON}" if first <= SOON
                                     else f"Retiring {SOON + 1}+")})

    return coal.groupby("Plant ID").apply(summarize, include_groups=False).reset_index()


def retired(op: pd.DataFrame, rt: pd.DataFrame) -> pd.DataFrame:
    still_coal = set(op.loc[op.fuel_group == "coal", "Plant ID"])
    coal = rt[(rt.fuel_group == "coal") & ~rt["Plant State"].isin(NOT_CONUS)
              & ~rt["Plant ID"].isin(still_coal)]

    def summarize(d):
        return pd.Series({**plant_info(d), "coal_mw": d.mw.sum(),
                          "retired_yr": int(d["Retirement Year"].max()),
                          "status": f"Retired {RETIRED_SINCE}+"})

    out = coal.groupby("Plant ID").apply(summarize, include_groups=False).reset_index()
    return out[out.retired_yr >= RETIRED_SINCE]


def main() -> None:
    xlsx = Path(sys.argv[1])
    op, rt = load_eia(xlsx, "Operating"), load_eia(xlsx, "Retired")

    ops = truck_proximity(operating(op))
    ops.to_csv(ROOT / "coal_plants_truck_proximity.csv", index=False)
    to_gpkg_layer(ops, "coal_plants_operating")

    ret = retired(op, rt)
    to_gpkg_layer(ret, "coal_plants_retired_2015plus")
    truck_proximity(ret).to_csv(ROOT / "retired_plants_truck_proximity.csv", index=False)
    print(f"coal plants: {len(ops)} operating, {len(ret)} retired since {RETIRED_SINCE}")


if __name__ == "__main__":
    main()
