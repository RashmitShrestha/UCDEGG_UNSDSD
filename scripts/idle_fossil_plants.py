"""Idle (not retired) fossil-fuel generators and plants from EIA-860M.

Idle units are on the "Operating" sheet, not the "Retired" sheet. They have
one of these statuses:
  (OS) Out of service, NOT expected to return to service next calendar year
  (OA) Out of service, expected to return to service next calendar year
  (SB) Standby/backup: available for service but not normally used

Usage: python scripts/idle_fossil_plants.py path/to/<month>_generator<year>.xlsx
Outputs (repo root):
  idle_fossil_units.csv   every idle fossil generator, incl. ones at plants that
                          still have other fossil units running
  idle_fossil_plants.csv  plants where every fossil unit is idle, with
                          freight-truck proximity for lower-48 plants
"""
import sys
from pathlib import Path

import pandas as pd

from common import ROOT, load_eia, truck_proximity

IDLE = ["OS", "OA", "SB"]  # most to least idle; breaks ties for main_status


def plant_table(g: pd.DataFrame) -> pd.DataFrame:
    fos = g[g.fuel_group.notna()]
    running_fossil = set(fos.loc[fos.status_code == "OP", "Plant ID"])
    cand = fos[fos.status_code.isin(IDLE) & ~fos["Plant ID"].isin(running_fossil)]

    def summarize(d: pd.DataFrame) -> pd.Series:
        by_status = d.groupby("status_code").mw.sum()
        by_fuel = d.groupby("fuel_group").mw.sum().sort_values(ascending=False)
        return pd.Series({
            "plant": d["Plant Name"].iloc[0], "owner": d["Entity Name"].iloc[0],
            "state": d["Plant State"].iloc[0], "county": d["County"].iloc[0],
            "sector": d["Sector"].iloc[0], "ba": d["Balancing Authority Code"].iloc[0],
            "lat": d["Latitude"].iloc[0], "lon": d["Longitude"].iloc[0],
            "idle_fossil_mw": d.mw.sum(), "n_idle_units": len(d),
            **{f"mw_{s}": by_status.get(s, 0.0) for s in IDLE},
            "main_status": max(IDLE, key=lambda s: (by_status.get(s, 0.0), -IDLE.index(s))),
            "main_fuel": by_fuel.index[0], "fuels": ";".join(by_fuel.index),
            "technologies": ";".join(sorted(d.Technology.unique())),
            "oldest_unit_yr": d["Operating Year"].min(),
            "planned_retirement_yr": d["Planned Retirement Year"].min(),
        })

    plants = cand.groupby("Plant ID").apply(summarize, include_groups=False).reset_index()
    other_op = (g[(g.status_code == "OP") & g.fuel_group.isna()]
                .groupby("Plant ID").mw.sum().rename("other_operating_mw"))
    plants = plants.merge(other_op, on="Plant ID", how="left")
    plants["other_operating_mw"] = plants["other_operating_mw"].fillna(0)
    return plants.sort_values("idle_fossil_mw", ascending=False)


def main() -> None:
    g = load_eia(Path(sys.argv[1]), "Operating")
    units = g[g.fuel_group.notna() & g.status_code.isin(IDLE)]
    cols = ["Plant ID", "Plant Name", "Entity Name", "Plant State", "County", "Generator ID",
            "fuel_group", "Energy Source Code", "Technology", "Prime Mover Code", "mw",
            "status_code", "Operating Year", "Planned Retirement Year", "Latitude", "Longitude"]
    units[cols].sort_values(["Plant ID", "Generator ID"]).to_csv(ROOT / "idle_fossil_units.csv", index=False)

    plants = truck_proximity(plant_table(g))
    plants.to_csv(ROOT / "idle_fossil_plants.csv", index=False)
    print(f"idle fossil: {len(units)} units ({units.mw.sum():,.0f} MW); "
          f"{len(plants)} fully idle plants ({plants.idle_fossil_mw.sum():,.0f} MW)")


if __name__ == "__main__":
    main()
