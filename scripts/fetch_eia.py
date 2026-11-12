"""Download the newest EIA-860M monthly generator workbook.

EIA-860M is cumulative, so only the latest release is needed. Files are saved
to data/raw/eia860m/ (git-ignored) and reused if already there.

Usage: python scripts/fetch_eia.py      -> prints the local path
"""
import datetime as dt
from pathlib import Path

import requests

from common import ROOT

RAW = ROOT / "data" / "raw" / "eia860m"
BASES = ["https://www.eia.gov/electricity/data/eia860m/xls/",
         "https://www.eia.gov/electricity/data/eia860m/archive/xls/"]
XLSX = "spreadsheetml"
MONTHS = ["january", "february", "march", "april", "may", "june", "july",
          "august", "september", "october", "november", "december"]


def candidates(today: dt.date, n: int = 15):
    y, m = today.year, today.month
    for _ in range(n):
        yield f"{MONTHS[m - 1]}_generator{y}.xlsx"
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)


def latest(today: dt.date | None = None) -> Path:
    """Path to the newest release, downloading it if it's not cached locally."""
    RAW.mkdir(parents=True, exist_ok=True)
    for name in candidates(today or dt.date.today()):
        local = RAW / name
        if local.exists():
            return local
        for base in BASES:
            r = requests.get(base + name, stream=True, timeout=60)
            # EIA answers a missing month with a 200 HTML page, so check the type
            if r.ok and XLSX in r.headers.get("Content-Type", ""):
                tmp = local.with_suffix(".part")
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
                tmp.rename(local)
                return local
            r.close()
    raise RuntimeError("No EIA-860M workbook found in the last 15 months")


if __name__ == "__main__":
    print(latest())
