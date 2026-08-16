#!/usr/bin/env python3
"""
Rebuilds src/data/route-data.js from real Strava activity data.

This does NOT call the Strava API itself — it consumes location/altitude/
distance stream JSON already fetched for each day's activity (see ACTIVITIES
below for which file maps to which day and the exact real-world summary
values — distance, moving time, elevation gain — read directly off each
activity). Re-fetch with a Strava MCP connector's get_activity_streams
(omit `resolution` for full fidelity) if the activities change.

Pipeline per day:
  1. Project each raw (lat, lon) to local (x, z) metres via an
     equirectangular projection referenced to the whole trip's centroid
     (chosen once, from every point across every day, so all eight days
     share one consistent coordinate system).
  2. Simplify the (x, z) polyline with Douglas-Peucker (tolerance in
     metres) — this keeps points dense through real switchbacks and
     thins them out on straight sections, unlike naive fixed-stride
     decimation. Altitude rides along unchanged at each surviving point.
  3. Parse each day's named cols + their real recorded elevation directly
     from that activity's Strava description (authoritative: it's the
     actual climb-top reading from this specific ride, not a web-sourced
     figure).
  4. Match each named col to a route point. For the 22 cols with a known
     real-world coordinate (REAL_COORDS, hand-gathered by web search),
     this is a direct geographic nearest-point match — reliable now that
     the route itself is real GPS, not the synthetic placeholder data an
     earlier version of this pipeline worked against (GPS-to-synthetic
     reprojection was tried and abandoned then; residuals of 10-60km made
     it worse than useless). The 4 without a known coordinate fall back
     to elevation-matching against a genuine local peak — never a bare
     "closest altitude", which doesn't require the candidate to actually
     be a summit and is how Col de Vars once ended up ~21km from itself,
     matched to a point partway up the approach to a much higher climb
     that happened to pass through nearly the same altitude. Both cases
     are solved as the same sequence-alignment DP (strictly-increasing
     point assignment across the day's ordered col list) rather than
     greedily, so an early col can't grab the best nearby match and leave
     nothing sensible for the col listed right after it.
  5. Per-day and trip-wide summary stats (distance, elevation gain,
     moving time) come straight from Strava's own summary numbers, not
     recomputed from the noisy raw altitude stream.

Usage:
    python3 tools/rebuild_from_strava.py
    python3 tools/build.py   # fold the new data into index.html
"""
import re, json, math, sys

ACTIVITIES = {
    "day1": {"stream_file": "day1_streams.json", "date": "2026-07-26",
              "desc": "Col de Jambaz (1,027 m) • Col de la Colombière (1,613 m) • Col de St Jean de Sixt (956 m) • Col des Aravis (1,487 m)",
              "distance": 102056, "moving_time": 20860, "elevation_gain": 2523.8},
    "day2": {"stream_file": "day2_streams.json", "date": "2026-07-27",
              "desc": "Col des Saisies (1,650 m) • Col du Méraillet (1,605 m) • Cormet de Roselend (1,968 m)",
              "distance": 100164, "moving_time": 21935, "elevation_gain": 3011.6},
    "day3a": {"stream_file": "day3a_streams.json", "date": "2026-07-28",
              "desc": "Col de l'Iseran (2,770 m)",
              "distance": 40315, "moving_time": 9934, "elevation_gain": 1209},
    "day3b": {"stream_file": "day3b_streams.json", "date": "2026-07-28",
              "desc": "Col du Télégraphe (1,566 m)",
              "distance": 76560.7, "moving_time": 12110, "elevation_gain": 1057},
    "day4": {"stream_file": "day4_streams.json", "date": "2026-07-29",
              "desc": "Col du Galibier (2,642 m) • Col du Lautaret (2,058 m)",
              "distance": 39615.3, "moving_time": 9838, "elevation_gain": 1231},
    "day5": {"stream_file": "day5_streams.json", "date": "2026-07-30",
              "desc": "Col du Lautaret (2,058 m) • Col d'Izoard (2,361 m) • Col de la Platrière (2,215 m)",
              "distance": 100120, "moving_time": 21040, "elevation_gain": 2398},
    "day6": {"stream_file": "day6_streams.json", "date": "2026-07-31",
              "desc": "Col de Vars (2,109 m) • Faux col de Restefond (2,656 m) • Col de Restefond (2,680 m) • Col de la Bonette (2,715 m) • Col de la Cime de la Bonette (2,802 m) • Cime de Vermillon (2,579 m) • Col de Raspaillon (2,513 m)",
              "distance": 119952, "moving_time": 24021, "elevation_gain": 2653.7},
    "day7": {"stream_file": "day7_streams.json", "date": "2026-08-01",
              "desc": "Col Saint-Martin (1,500 m) • Col de Turini (1,604 m) • Col St Roch (991 m) • Col de Nice (414 m) • Col d'Èze (507 m)",
              "distance": 107679, "moving_time": 20024, "elevation_gain": 2022},
}

# Strava activity IDs, for reference / re-fetching:
STRAVA_ACTIVITY_IDS = {
    "day1": "19477533657", "day2": "19490363101",
    "day3a": "19524019256", "day3b": "19502730333",
    "day4": "19524023015", "day5": "19529639400",
    "day6": "19543426888", "day7": "19557382766",
}

# Real-world (lat, lon), hand-gathered by web search. None = no reliable
# coordinate found anywhere online; falls back to elevation+peak matching
# (see REAL_ALT below, parsed from each activity's own description).
REAL_COORDS = {
    "Col de Jambaz":                (46.23472,  6.52028),
    "Col de la Colombière":         (45.99222,  6.47583),
    "Col de St Jean de Sixt":       (45.92,     6.41),
    "Col des Aravis":               (45.87250,  6.46472),
    "Col des Saisies":              (45.75833,  6.52861),
    "Col du Méraillet":             (45.69500,  6.63472),
    "Cormet de Roselend":           (45.69111,  6.69056),
    "Col de l'Iseran":              (45.41680,  7.02520),
    "Col du Télégraphe":            (45.20250,  6.44440),
    "Col du Galibier":              (45.06400,  6.40800),
    "Col du Lautaret":              (45.03444,  6.40500),
    "Col d'Izoard":                 (44.81972,  6.73500),
    "Col de la Platrière":          None,
    "Col de Vars":                  (44.53890,  6.70275),
    "Faux col de Restefond":        (44.33680,  6.80130),
    "Col de Restefond":             (44.33600,  6.80800),
    "Col de la Bonette":            (44.32700,  6.80700),
    "Col de la Cime de la Bonette": (44.32170,  6.80690),
    "Cime de Vermillon":            None,
    "Col de Raspaillon":            (44.34050,  6.83220),
    "Col Saint-Martin":             (44.07111,  7.22083),
    "Col de Turini":                (43.97778,  7.39167),
    "Col St Roch":                  (43.89563,  7.33728),
    "Col de Nice":                  None,
    "Col d'Èze":                    (43.72860,  7.36170),  # village approx, pass itself unpublished
}

DP_TOLERANCE_M = 6.0
M_TO_FT = 3.280839895
KM_TO_MI = 0.621371192


def parse_cols(desc):
    cols = []
    for p in desc.split(" • "):
        m = re.match(r"^(.*?)\s*\(([\d,]+)\s*m\)$", p.strip())
        cols.append((m.group(1).strip(), int(m.group(2).replace(",", ""))))
    return cols


def perp_dist(p, a, b):
    ax, az, bx, bz, px, pz = a[0], a[2], b[0], b[2], p[0], p[2]
    dx, dz = bx - ax, bz - az
    if dx == 0 and dz == 0:
        return math.hypot(px - ax, pz - az)
    t = max(0, min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)))
    return math.hypot(px - (ax + t * dx), pz - (az + t * dz))


def douglas_peucker(pts, tol):
    if len(pts) < 3:
        return pts
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        d = perp_dist(pts[i], pts[0], pts[-1])
        if d > dmax:
            dmax, idx = d, i
    if dmax > tol:
        return douglas_peucker(pts[:idx + 1], tol)[:-1] + douglas_peucker(pts[idx:], tol)
    return [pts[0], pts[-1]]


def is_local_max(pts, i):
    n = len(pts)
    if i == 0 or i == n - 1:
        return False
    return pts[i][1] >= pts[i - 1][1] and pts[i][1] >= pts[i + 1][1]


def prominence(pts, i):
    alt = pts[i][1]; n = len(pts)
    left_min = alt; j = i - 1
    while j >= 0:
        if pts[j][1] > alt: break
        left_min = min(left_min, pts[j][1]); j -= 1
    right_min = alt; j = i + 1
    while j < n:
        if pts[j][1] > alt: break
        right_min = min(right_min, pts[j][1]); j += 1
    return alt - max(left_min, right_min)


def pick_cols_dp(pts, col_names, real_alts, project):
    """Best strictly-increasing assignment of route indices to a day's
    ordered col list, solved jointly (not greedily) so an early col can't
    grab the best nearby match and leave nothing sensible for the col
    listed right after it.

    Per-col cost, in priority order:
      1. Known real coordinate (REAL_COORDS): geographic distance in
         metres from that point to the col's true position. This is the
         primary, most reliable signal — it's what "the col is in the
         wrong place" actually means, so it's what should minimize it.
      2. No known coordinate, but a real recorded elevation: |recorded
         altitude - real altitude|, restricted to genuine local maxima
         only (crest with a descent on both sides). Without that
         restriction, a point can be a near-perfect altitude match while
         sitting partway up a climb toward a much higher peak later —
         nowhere near the real col on the ground.
      3. Neither: fall back to the single most topographically prominent
         peak in its slot.
    Distance-based and altitude-based costs are both in "metres", so they
    combine reasonably in the same DP even when a leg mixes col types."""
    n = len(pts); k = len(col_names); NEG = float("inf")
    peak_ok = [is_local_max(pts, i) for i in range(n)]

    def cost(i, name):
        coord = REAL_COORDS.get(name)
        if coord is not None:
            xc, zc = project(*coord)
            return math.hypot(pts[i][0] - xc, pts[i][2] - zc)
        if not peak_ok[i]:
            return NEG
        real_alt = real_alts.get(name)
        if real_alt is not None:
            return abs(pts[i][1] - real_alt)
        return -prominence(pts, i) * 0.1

    dp = [[NEG] * n for _ in range(k)]
    back = [[-1] * n for _ in range(k)]
    for i in range(n):
        dp[0][i] = cost(i, col_names[0])
    for j in range(1, k):
        best_prev, best_prev_idx = NEG, -1
        for i in range(n):
            if i - 1 >= 0 and dp[j - 1][i - 1] < best_prev:
                best_prev, best_prev_idx = dp[j - 1][i - 1], i - 1
            if best_prev == NEG: continue
            dp[j][i] = cost(i, col_names[j]) + best_prev
            back[j][i] = best_prev_idx
    best_i = min(range(n), key=lambda i: dp[k - 1][i])
    if dp[k - 1][best_i] == NEG:
        raise RuntimeError("no valid assignment found — not enough local peaks for this col list")
    chosen = [None] * k; i = best_i
    for j in range(k - 1, -1, -1):
        chosen[j] = i; i = back[j][i]
    return chosen


def main():
    if len(sys.argv) > 2:
        print("usage: rebuild_from_strava.py [path/to/route-data.js]", file=sys.stderr)
        sys.exit(1)
    # src/data/route-data.js is the source of truth for route data; index.html
    # is a build artifact (see tools/build.py) and gets overwritten wholesale
    # from src/ on every build, so writing there directly would just be lost.
    out_path = sys.argv[1] if len(sys.argv) == 2 else "src/data/route-data.js"

    all_lats, all_lons, raw = [], [], {}
    for key, meta in ACTIVITIES.items():
        with open(meta["stream_file"]) as f:
            d = json.load(f)
        raw[key] = d
        for lat, lon in d["location"]:
            all_lats.append(lat); all_lons.append(lon)
    lat0 = sum(all_lats) / len(all_lats)
    lon0 = sum(all_lons) / len(all_lons)
    R = 6371000.0

    def project(lat, lon):
        # +x east, and north is -z, NOT +z. The obvious lon->x, lat->z
        # mapping makes (east, north, up) = (x, z, y), and x cross z is -y
        # where real-world east cross north is +up — a left-handed frame,
        # which three.js renders as a mirror image of the real map. No
        # camera angle can undo that (a mirror is not a rotation), and
        # OrbitControls' maxPolarAngle keeps the camera above the ground
        # plane, so every view of it was flipped east-for-west: the whole
        # traverse and every hairpin came out as their own reflection.
        # Negating z makes the frame right-handed and the scene a true map.
        # Anything reading this data must treat -z as north — see
        # src/app.js's compass labels and tools/build_hotel_data.py.
        x = math.radians(lon - lon0) * math.cos(math.radians(lat0)) * R
        z = -math.radians(lat - lat0) * R
        return x, z

    legs = {}
    for key, meta in ACTIVITIES.items():
        d = raw[key]
        pts3 = [[*project(lat, lon), alt] for (lat, lon), alt in zip(d["location"], d["altitude"])]
        pts3 = [[x, alt, z] for x, z, alt in pts3]  # reorder to [x, y=altitude, z]
        pts = douglas_peucker(pts3, DP_TOLERANCE_M)
        pts = [[round(p[0], 1), round(p[1], 1), round(p[2], 1)] for p in pts]

        cols = parse_cols(meta["desc"])
        col_names = [name for name, _ in cols]
        real_alts = dict(cols)
        chosen = pick_cols_dp(pts, col_names, real_alts, project)
        col_markers = [{"name": name, "pt": pts[idx]} for idx, name in zip(chosen, col_names)]

        dist_km = meta["distance"] / 1000.0
        gain_m = meta["elevation_gain"]
        max_alt_m = max(p[1] for p in pts)
        legs[key] = {
            "date": meta["date"], "cols": " • ".join(col_names), "pts": pts,
            "dist_km": round(dist_km, 1), "dist_mi": round(dist_km * KM_TO_MI, 1),
            "gain_m": round(gain_m), "gain_ft": round(gain_m * M_TO_FT),
            "max_alt_m": round(max_alt_m), "max_alt_ft": round(max_alt_m * M_TO_FT),
            "colMarkers": col_markers,
        }
        for idx, name in zip(chosen, col_names):
            coord = REAL_COORDS.get(name)
            if coord is not None:
                xc, zc = project(*coord)
                dist = math.hypot(pts[idx][0] - xc, pts[idx][2] - zc)
                how = f"GPS  dist={dist:7.1f}m"
            else:
                real_alt = real_alts.get(name)
                how = f"ALT  diff={pts[idx][1]-real_alt:+6.1f}m" if real_alt else "PROMINENCE"
            print(f"{key:6s} idx={idx:4d}/{len(pts)-1:4d}  {how:22s}  -> {name}")

    all_x = [p[0] for k in legs for p in legs[k]["pts"]]
    all_y = [p[1] for k in legs for p in legs[k]["pts"]]
    all_z = [p[2] for k in legs for p in legs[k]["pts"]]
    bbox = {"minx": min(all_x), "maxx": max(all_x), "miny": min(all_y),
            "maxy": max(all_y), "minz": min(all_z), "maxz": max(all_z)}

    total_dist_km = sum(a["distance"] for a in ACTIVITIES.values()) / 1000.0
    total_gain_m = sum(a["elevation_gain"] for a in ACTIVITIES.values())
    total_moving_s = sum(a["moving_time"] for a in ACTIVITIES.values())
    # Take the trip high point from the raw altitudes (all_y), NOT from the
    # per-leg max_alt_m values — those are already rounded to whole metres,
    # and converting a rounded metre figure to feet double-rounds it. The
    # summit that produced this (2793.7 m) came out as 9,166 ft on its day
    # card via round(2793.7 * M_TO_FT) but 9,167 ft in the trip stat rail via
    # round(round(2793.7) * M_TO_FT) — the same summit showing two different
    # heights in two places on screen. Every other summary field already sums
    # raw inputs; this was the one that read a rounded value back out.
    max_alt_m = max(all_y)

    summary = {
        "total_dist_km": round(total_dist_km, 1), "total_dist_mi": round(total_dist_km * KM_TO_MI, 1),
        "total_gain_m": round(total_gain_m), "total_gain_ft": round(total_gain_m * M_TO_FT),
        "max_alt_m": round(max_alt_m), "max_alt_ft": round(max_alt_m * M_TO_FT),
        "moving_time_s": total_moving_s,
    }

    route_data = {
        "order": list(ACTIVITIES.keys()), "legs": legs, "bbox": bbox, "summary": summary,
    }

    new_json = json.dumps(route_data, ensure_ascii=False, separators=(",", ":"))
    new_content = f"window.ROUTE_DATA = {new_json};\n"
    with open(out_path, "w") as f:
        f.write(new_content)

    hh, mm = total_moving_s // 3600, (total_moving_s % 3600) // 60
    print(f"\nTOTAL: {total_dist_km:.1f} km, gain {total_gain_m:.0f} m, "
          f"high point {max_alt_m:.0f} m, moving time {hh}:{mm:02d}")
    print(f"wrote {out_path} ({len(new_content)} bytes)")
    print("run `python3 tools/build.py` to fold this into index.html")


if __name__ == "__main__":
    main()
