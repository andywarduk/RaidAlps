#!/usr/bin/env python3
"""Regenerates src/data/hotel-data.js from src/data/hotels.geojson.

`hotels.geojson` is the editable source of truth for the eight overnight
stops (nine hotels — night 2 is split across La Giettaz and Flumet): plain
WGS84 lon/lat/elevation, readable in any GIS tool. `hotel-data.js` is the
generated form the app actually loads, with each hotel pre-projected into
the same local metre grid `route-data.js` uses, so `src/app.js` needs no
geodesy of its own and the two datasets are guaranteed to share one
coordinate system.

The app cannot read the .geojson directly: the Artifact build is a single
file under a strict CSP (see tools/build.py) and so cannot fetch anything,
which is why every dataset here ships as a script assigning a global.

Usage:
    python3 tools/build_hotel_data.py
    python3 tools/build.py   # fold the new data into build/

## Where the projection origin comes from

`tools/rebuild_from_strava.py` projects with an equirectangular projection
referenced to the centroid of every raw GPS point across all eight days —
but that centroid is computed from the Strava stream files, which are not
in this repo, and it was never written into `route-data.js`. So it is
recovered here by fitting instead: 18 cols with a known real-world
coordinate (`REAL_COORDS` in that script) against the route points they
were matched to, discarding five whose reference coordinate is itself
known to be approximate. That fit puts the origin at

    lat0 = 45.040081, lon0 = 6.758110

with a standard error of ~7 m and residuals of 25 m median / 71 m max —
comfortably below the ~150 m a marker moves per on-screen pixel at the
overview framing. It is checked, not assumed: --verify re-derives it from
the current route-data.js and fails if it has drifted, and every hotel's
distance to the nearest route point is printed (eight of the nine sit
within 110 m of the road, which is the real cross-check that both the
origin and the geocoded hotel positions are right; the ninth, Campanile
Nice Aéroport, is genuinely 4.4 km off-route because the last day finishes
in Nice itself, not at the airport).

If the Strava streams ever come back, delete all of this and take lat0/
lon0 straight from rebuild_from_strava.py's own centroid.
"""
import json
import math
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GEOJSON = ROOT / "src" / "data" / "hotels.geojson"
ROUTE_JS = ROOT / "src" / "data" / "route-data.js"
OUT = ROOT / "src" / "data" / "hotel-data.js"

LAT0 = 45.040081
LON0 = 6.758110
R = 6371000.0

# Reference coordinates that are themselves approximate — a village centre
# standing in for an unpublished pass, or a figure rounded to two decimal
# places — so they are excluded from the origin fit. They are still fine for
# the col matching rebuild_from_strava.py uses them for, which only needs
# the nearest route point.
FIT_EXCLUDE = {
    "Col d'Èze",                    # village approx, pass itself unpublished
    "Col des Saisies",
    "Col de St Jean de Sixt",       # rounded to 2dp = ~800 m of slack
    "Col de l'Iseran",
    "Col de la Cime de la Bonette",
}


def project(lat, lon):
    """WGS84 -> the local metre grid route-data.js is expressed in."""
    x = math.radians(lon - LON0) * math.cos(math.radians(LAT0)) * R
    z = math.radians(lat - LAT0) * R
    return x, z


def load_route():
    text = ROUTE_JS.read_text(encoding="utf-8")
    return json.loads(text[text.index("{"):].rstrip().rstrip(";"))


def verify_origin(route):
    """Re-derive lat0/lon0 from the current route data and compare."""
    sys.path.insert(0, str(ROOT / "tools"))
    import importlib.util
    spec = importlib.util.spec_from_file_location("rfs", ROOT / "tools" / "rebuild_from_strava.py")
    rfs = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rfs)

    pairs = [
        (rfs.REAL_COORDS[cm["name"]], cm["pt"])
        for leg in route["legs"].values()
        for cm in leg["colMarkers"]
        if rfs.REAL_COORDS.get(cm["name"]) and cm["name"] not in FIT_EXCLUDE
    ]
    if len(pairs) < 12:
        raise SystemExit(f"only {len(pairs)} usable cols for the origin fit — too few to trust")

    lat0 = statistics.fmean(lat - math.degrees(pt[2] / R) for (lat, _), pt in pairs)
    k = math.radians(1) * math.cos(math.radians(lat0)) * R
    lon0 = statistics.fmean(lon - pt[0] / k for (_, lon), pt in pairs)

    dlat_m = abs(lat0 - LAT0) * 111320
    dlon_m = abs(lon0 - LON0) * k
    print(f"origin check: fitted ({lat0:.6f}, {lon0:.6f}) from {len(pairs)} cols, "
          f"{dlat_m:.1f} m / {dlon_m:.1f} m from the baked-in value")
    if max(dlat_m, dlon_m) > 50:
        raise SystemExit(
            "the projection origin has drifted more than 50 m from the value baked into this "
            "script — route-data.js must have been rebuilt against a different centroid. Update "
            "LAT0/LON0 above to the fitted values and re-run."
        )


def nearest_route_point(route, x, z):
    best, best_d = None, float("inf")
    for key, leg in route["legs"].items():
        for i, p in enumerate(leg["pts"]):
            d = math.hypot(p[0] - x, p[2] - z)
            if d < best_d:
                best_d, best = d, (key, i, p)
    return best, best_d


def main():
    route = load_route()
    verify_origin(route)

    gj = json.loads(GEOJSON.read_text(encoding="utf-8"))
    hotels = []
    for f in gj["features"]:
        coords = f["geometry"]["coordinates"]
        if len(coords) < 3:
            raise SystemExit(
                f"{f['properties']['name']}: hotels.geojson needs a third coordinate (elevation "
                "in metres) on every feature — the scene has nowhere to put a marker without it"
            )
        lon, lat, ele = coords[0], coords[1], coords[2]
        p = f["properties"]
        x, z = project(lat, lon)
        hotels.append({
            "name": p["name"],
            "town": p["town"],
            "date": p["date"],
            # same [x, y=altitude, z] layout as route-data.js's pts/colMarkers
            "pt": [round(x, 1), round(ele, 1), round(z, 1)],
        })

        (leg_key, idx, rp), d = nearest_route_point(route, x, z)
        print(f"  {p['name']:24s} {d:8.1f} m from {leg_key} idx {idx:4d}  "
              f"(route alt {rp[1]:6.1f} m vs DEM {ele:6.1f} m)")

    payload = json.dumps({"hotels": hotels}, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(
        "// GENERATED FILE — do not hand-edit.\n"
        "// Source: src/data/hotels.geojson; regenerate with tools/build_hotel_data.py\n"
        f"window.HOTEL_DATA = {payload};\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT} ({len(payload):,} bytes, {len(hotels)} hotels)")


if __name__ == "__main__":
    main()
