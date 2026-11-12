"""Installed generating-capacity mix by county and by state, from EIA-860M.

Every generator with status (OP) "operating" on the Operating sheet, nameplate
MW, grouped into broad resource types. This is *capacity* (what is built), not
*generation* (what actually runs): a county with a big standby gas plant shows
a lot of gas even if it rarely runs. Counties with no utility-scale (>=1 MW)
generators don't appear.

Usage: python scripts/grid_mix.py path/to/<month>_generator<year>.xlsx
Outputs: county_grid_mix.csv, state_grid_mix.csv
"""
import sys
from pathlib import Path

import pandas as pd

from common import ROOT, load_eia

RESOURCES = ["coal", "gas", "oil", "nuclear", "hydro", "wind", "solar", "storage", "geothermal", "bio_other"]
BY_SOURCE = {"NUC": "nuclear", "WAT": "hydro", "WND": "wind", "SUN": "solar",
             "MWH": "storage", "GEO": "geothermal"}


def resource(row) -> str:
    if row["Technology"] == "Hydroelectric Pumped Storage" or row["Prime Mover Code"] in ("BA", "FW", "CE"):
        return "storage"
    return row["fuel_group"] if isinstance(row["fuel_group"], str) else BY_SOURCE.get(row["Energy Source Code"], "bio_other")


def mix(op: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    t = op.pivot_table(index=keys, columns="resource", values="mw", aggfunc="sum", fill_value=0)
    t = t.reindex(columns=RESOURCES, fill_value=0)
    out = t.add_prefix("mw_")
    out.insert(0, "total_mw", t.sum(axis=1))
    out.insert(1, "n_plants", op.groupby(keys)["Plant ID"].nunique())
    for r in RESOURCES:
        out[f"pct_{r}"] = 100 * t[r] / out.total_mw
    out["renewable_pct"] = 100 * t[["hydro", "wind", "solar", "geothermal"]].sum(axis=1) / out.total_mw
    out["fossil_pct"] = 100 * t[["coal", "gas", "oil"]].sum(axis=1) / out.total_mw
    out["largest"] = t.idxmax(axis=1)
    return out.round(2).reset_index()


def main() -> None:
    g = load_eia(Path(sys.argv[1]), "Operating")
    op = g[g.status_code == "OP"].copy()
    op["resource"] = op.apply(resource, axis=1)
    op = op.rename(columns={"Plant State": "state", "County": "county"})
    county = mix(op, ["state", "county"])
    state = mix(op, ["state"])
    county.to_csv(ROOT / "county_grid_mix.csv", index=False)
    state.to_csv(ROOT / "state_grid_mix.csv", index=False)
    print(f"grid mix: {len(county)} counties, {len(state)} states, {op.mw.sum() / 1000:,.0f} GW operating")


if __name__ == "__main__":
    main()
