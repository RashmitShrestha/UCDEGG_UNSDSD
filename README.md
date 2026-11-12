# UCDEGG_UNSDSD
A repo to house the codebase for UCD's EGG team for the UN SDSN project in 2026

## Updating

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # once
.venv/bin/python update.py   # pulls the newest EIA-860M release and rebuilds all CSVs, stats and the map
```

See `analysis.md` → "Files and reproduction" for what each step does.
