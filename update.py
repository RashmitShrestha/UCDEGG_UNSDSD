"""Rebuild everything from the newest EIA-860M release with one command.

    python update.py                      # find + download the latest EIA file
    python update.py --eia path.xlsx      # use a specific workbook
    python update.py --skip-transmission  # skip the HIFLD queries

Steps:
  1. download the latest EIA-860M workbook        scripts/fetch_eia.py
  2. coal plant layers + truck proximity          scripts/build_coal_plants.py
  3. idle coal/gas/oil plants + truck proximity   scripts/idle_fossil_plants.py
  4. transmission lines near each site (cached)   scripts/fetch_transmission.py
  5. headline numbers -> summary_stats.md         scripts/summary_stats.py
  6. interactive map -> coal_trucks_interactive.html   scripts/build_map.py

analysis.md is hand-written: compare it against summary_stats.md afterwards.
"""
import argparse
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))


def run(script: str, *args) -> None:
    t = time.time()
    args = [str(a) for a in args]
    print(f"\n== {script} {' '.join(args)}", flush=True)
    subprocess.run([sys.executable, str(SCRIPTS / script), *args], check=True, cwd=ROOT)
    print(f"   done in {time.time() - t:.0f}s")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--eia", type=Path, help="EIA-860M workbook (default: download the latest)")
    ap.add_argument("--skip-transmission", action="store_true")
    a = ap.parse_args()

    if a.eia:
        xlsx = a.eia.resolve()
    else:
        from fetch_eia import latest
        xlsx = latest()
    m = re.search(r"([a-z]+)_generator(\d{4})", xlsx.name)
    release = f"{m[1].title()} {m[2]}" if m else xlsx.name
    print(f"EIA-860M release: {release} ({xlsx})")

    run("build_coal_plants.py", xlsx)
    run("idle_fossil_plants.py", xlsx)
    if not a.skip_transmission:
        run("fetch_transmission.py", "retired_plants_truck_proximity.csv", "retired_plants_transmission.csv")
        run("fetch_transmission.py", "idle_fossil_plants.csv", "idle_plants_transmission.csv",
            "--min-mw", "idle_fossil_mw", "20")
    run("summary_stats.py", release)
    run("build_map.py", xlsx)
    print("\nAll outputs updated. Check summary_stats.md against analysis.md for changed numbers.")


if __name__ == "__main__":
    main()
