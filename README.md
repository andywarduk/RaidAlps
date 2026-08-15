# Raid Alps

A self-contained 3D visualization of a 7-day, 352-mile cycling traverse of
the French Alps — Annecy to Nice, 26 named cols, 15,483 m of climbing.
Built with Three.js, rendered client-side from an embedded route dataset.

## Running it

Open `index.html` directly in a browser, or serve the directory:

```bash
python3 -m http.server 8000
```

then visit `http://localhost:8000/`.

Drag to orbit, scroll to zoom, click a day to focus on it. Focusing a day
shows labels for its named cols, each with a leader line to a marker on
the route.

## How the col markers are placed

`index.html` embeds a `window.ROUTE_DATA` object: per-day polylines
(`[x, altitude, z]` points in an internal, unscaled local coordinate
system — not real GPS) plus each day's list of named cols in ride order.
The data has no per-col position, only the polyline and the names.

`tools/place_col_markers.py` figures out which point on each day's
polyline corresponds to which named col, using real published elevations
(hand-gathered from Wikipedia and cycling-climb sites) as ground truth.
For each day it solves a small dynamic-programming sequence-alignment
problem — find the strictly-increasing assignment of route points to that
day's ordered col list minimizing total elevation error — rather than
matching cols one at a time, greedily, left to right. The DP avoids the
greedy version's failure mode: an earlier col grabbing the best nearby
altitude match and leaving nothing sensible for the col listed right
after it.

Two named cols (Cime de Vermillon, Col de Nice) have no reliable
published elevation or position anywhere online. They stay in each day's
descriptive text but get no marker or label — `index.html`'s own
leg-merge step drops them from `colMarkers` at runtime, so this is a
client-side filter, not a hole in the source data.

Re-run after changing route point data or the `REAL_ALT` table:

```bash
python3 tools/place_col_markers.py index.html
```

It rewrites `window.ROUTE_DATA` in place and prints each col's chosen
point, altitude, and error against its published elevation.

## Rendering notes

- Three.js (bundled inline) draws each day's route as a tube along a
  Catmull-Rom curve through its points, with altitude exaggerated
  (~×11–25 depending on zoom) so climbs read clearly at this horizontal
  scale.
- Fog density is derived from the camera's actual distance to its
  target (computed after camera framing, not from the raw scene
  diagonal) — an earlier version based it on the diagonal directly and
  the mismatch between that and the camera's true distance fogged the
  entire route into the background color, rendering as an empty scene.
- Col labels are placed in 2D screen space each frame: each candidate
  position is checked against the day's projected polyline and every
  already-placed label, in expanding rings around its marker, so labels
  never overlap each other or the route line. Label width/height is
  re-measured from the live DOM every frame rather than cached once at
  creation — the custom webfont doesn't reliably signal "loaded" inside
  a sandboxed iframe, so a one-time measurement can be too narrow.
