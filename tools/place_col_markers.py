#!/usr/bin/env python3
"""
Places each named col's marker at the point in the route data whose
altitude best matches its real, published elevation (sourced by hand
from Wikipedia / cycling-climb sites — see REAL_ALT below).

Matching is solved as a sequence-alignment DP rather than a greedy
per-col search: it finds the assignment of strictly-increasing route
indices to the day's ordered col list that minimizes total altitude
error, so an early col can never "steal" a later col's best match.

Cols with no published elevation (REAL_ALT value of None) fall back to
picking the most topographically prominent peak in their slot instead.

Usage:
    python3 tools/place_col_markers.py path/to/index.html

Rewrites the embedded `window.ROUTE_DATA = {...}` object in place,
replacing each sub-leg's "colMarkers" list. Run this after changing
route point data or the REAL_ALT table below.
"""
import re
import json
import sys

# Real-world elevation (m) for each named col, gathered from published
# sources. None = no reliable figure found; falls back to a prominence
# search instead of an elevation match for that col.
REAL_ALT = {
    "Col de Jambaz": 1027, "Col de la Colombière": 1613, "Col de St Jean de Sixt": 965,
    "Col des Aravis": 1487, "Col des Saisies": 1657, "Col du Méraillet": 1605,
    "Cormet de Roselend": 1968, "Col de l'Iseran": 2764, "Col du Télégraphe": 1566,
    "Col du Galibier": 2642, "Col du Lautaret": 2058, "Col d'Izoard": 2360,
    "Col de la Platrière": 2293, "Col de Vars": 2108, "Faux col de Restefond": 2656,
    "Col de Restefond": 2680, "Col de la Bonette": 2715, "Col de la Cime de la Bonette": 2860,
    "Cime de Vermillon": None, "Col de Raspaillon": 2513, "Col Saint-Martin": 1500,
    "Col de Turini": 1607, "Col St Roch": 1004, "Col de Nice": None, "Col d'Èze": 520,
}

# Cols with no reliable published position or elevation at all. Still
# written into ROUTE_DATA (so the underlying data stays complete) —
# index.html's own JS drops them from colMarkers at runtime (see the
# NO_DATA_COLS filter in the leg-merge step), so no marker/label is ever
# drawn for them. Listed here only so the report below can flag them.
NO_DATA_COLS = {"Cime de Vermillon", "Col de Nice"}

UNKNOWN_WEIGHT = 0.1  # how strongly an unmatched col prefers a prominent peak


def local_maxima(pts):
    idxs = []
    n = len(pts)
    i = 1
    while i < n - 1:
        if pts[i] is None or pts[i - 1] is None or pts[i + 1] is None:
            i += 1
            continue
        if pts[i][1] >= pts[i - 1][1] and pts[i][1] >= pts[i + 1][1]:
            j = i
            while j + 1 < n - 1 and pts[j + 1] is not None and pts[j + 1][1] == pts[i][1]:
                j += 1
            idxs.append((i + j) // 2)
            i = j + 1
        else:
            i += 1
    return idxs


def prominence(pts, i):
    """Topographic prominence: height above the higher of the two
    nearest 'key saddles' you'd have to cross to reach higher ground."""
    alt = pts[i][1]
    n = len(pts)
    left_min = alt
    j = i - 1
    while j >= 0:
        if pts[j] is None:
            j -= 1
            continue
        if pts[j][1] > alt:
            break
        left_min = min(left_min, pts[j][1])
        j -= 1
    right_min = alt
    j = i + 1
    while j < n:
        if pts[j] is None:
            j += 1
            continue
        if pts[j][1] > alt:
            break
        right_min = min(right_min, pts[j][1])
        j += 1
    return alt - max(left_min, right_min)


def cost(pts, i, name):
    if pts[i] is None:
        return float("inf")
    real = REAL_ALT.get(name)
    if real is not None:
        return abs(pts[i][1] - real)
    return -prominence(pts, i) * UNKNOWN_WEIGHT


def pick_cols_dp(pts, cols):
    """Best strictly-increasing assignment of route indices to cols,
    minimizing total cost (DP over index x col-position)."""
    n = len(pts)
    k = len(cols)
    NEG = float("inf")
    dp = [[NEG] * n for _ in range(k)]
    back = [[-1] * n for _ in range(k)]
    for i in range(n):
        if pts[i] is None:
            continue
        dp[0][i] = cost(pts, i, cols[0])
    for j in range(1, k):
        best_prev = NEG
        best_prev_idx = -1
        for i in range(n):
            if i - 1 >= 0 and dp[j - 1][i - 1] < best_prev:
                best_prev = dp[j - 1][i - 1]
                best_prev_idx = i - 1
            if pts[i] is None or best_prev == NEG:
                continue
            dp[j][i] = cost(pts, i, cols[j]) + best_prev
            back[j][i] = best_prev_idx
    best_i = min(range(n), key=lambda i: dp[k - 1][i])
    chosen = [None] * k
    i = best_i
    for j in range(k - 1, -1, -1):
        chosen[j] = i
        i = back[j][i]
    return chosen


def main():
    if len(sys.argv) != 2:
        print("usage: place_col_markers.py path/to/index.html", file=sys.stderr)
        sys.exit(1)
    path = sys.argv[1]

    with open(path) as f:
        content = f.read()

    m = re.search(r"window\.ROUTE_DATA = (\{.*?\});(</script>)", content, re.S)
    if not m:
        print("could not find window.ROUTE_DATA in file", file=sys.stderr)
        sys.exit(1)
    data = json.loads(m.group(1))

    for leg_id, leg in data["legs"].items():
        pts = leg["pts"]
        cols = leg["cols"].split(" • ")
        chosen = pick_cols_dp(pts, cols)
        leg["colMarkers"] = [{"name": name, "pt": pts[idx]} for idx, name in zip(chosen, cols)]
        for idx, name in zip(chosen, cols):
            real = REAL_ALT.get(name)
            diff = "" if real is None else f"  diff={pts[idx][1]-real:+.0f}m"
            dropped = "  (no data — hidden client-side)" if name in NO_DATA_COLS else ""
            print(f"{leg_id:6s} idx={idx:4d}  alt={pts[idx][1]:8.1f}{diff}  -> {name}{dropped}")

    new_json = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    new_content = content[: m.start(1)] + new_json + content[m.end(1):]

    with open(path, "w") as f:
        f.write(new_content)
    print(f"\nwrote {path} ({len(new_content)} bytes)")


if __name__ == "__main__":
    main()
