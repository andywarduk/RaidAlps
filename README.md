# Raid Alps

A self-contained 3D visualization of a real 7-day, 427-mile cycling
traverse of the French Alps — Thonon-les-Bains to Nice, 26 named cols,
16,106 m of climbing. Built with Three.js, rendered client-side from an
embedded route dataset sourced from the rider's own Strava activities.

## Running it

Open `index.html` directly in a browser, or serve the directory:

```bash
python3 -m http.server 8000
```

then visit `http://localhost:8000/`.

Drag to orbit, scroll to zoom, click a day to focus on it. Focusing a day
shows labels for its named cols, each with a leader line to a marker on
the route.

## Where the route data comes from

`index.html` embeds a `window.ROUTE_DATA` object: per-day polylines
(`[x, altitude, z]` points in a local, unscaled coordinate system — a
flat equirectangular projection referenced to the trip's centroid, not
tied to true north) plus each day's list of named cols in ride order.

The eight rides (day 3 was split into two activities) are real Strava
activities — see `STRAVA_ACTIVITY_IDS` in `tools/rebuild_from_strava.py`.
`tools/rebuild_from_strava.py` turns their location/altitude/distance
streams into `ROUTE_DATA`:

- **Points**: full-resolution GPS streams are simplified with
  Douglas-Peucker (6 m tolerance) rather than naive fixed-stride
  decimation, so real switchbacks (the Bonette massif especially) keep
  their shape while straight sections thin out.
- **Col markers**: placed by matching against real-world data, in
  priority order:
  1. **23 of 26 cols have a known real-world coordinate** (`REAL_COORDS`
     in `tools/rebuild_from_strava.py`, hand-gathered by web search).
     For these, matching is a direct geographic nearest-point search —
     the route point closest to the col's true position on the ground.
     This only became possible once the route itself was real GPS data;
     an earlier version of this pipeline tried reprojecting these same
     coordinates onto the *previous*, synthetic placeholder route and
     abandoned it — residuals of 10–60 km made it worse than useless
     against data that didn't preserve real-world bearings.
  2. **The remaining 3** (Col de la Platrière, Cime de Vermillon, Col de
     Nice — no reliable coordinate could be found for any of them, even
     after a targeted follow-up search) fall back to matching their real
     recorded elevation — read straight from that
     activity's own Strava description, the actual climb-top reading
     from that specific ride — against a genuine local peak in the
     recorded altitude profile. "Genuine local peak" is load-bearing
     here: a plain closest-altitude search doesn't require the matched
     point to actually be a summit, and this exact gap is how Col de
     Vars once ended up ~21 km from itself, matched to a point partway
     up the approach to the much higher Bonette climb because that
     point's raw altitude happened to be 0.2 m closer to the real 2109 m
     than the real (lower, genuinely cresting) pass.

  Both cases are solved as the same dynamic-programming sequence-
  alignment problem — the strictly-increasing assignment of route points
  to the day's ordered col list that minimizes total cost — rather than
  matching cols one at a time, greedily, left to right, which lets an
  early col grab the best nearby match and leave nothing sensible for
  the col listed right after it. GPS matches land within meters to
  ~100 m of the published coordinate almost everywhere (accuracy of the
  published coordinate itself, mostly); elevation-fallback matches land
  within a few metres of the recorded elevation, except a handful of
  peaks in the tightly-packed Bonette cluster and the day's-sole-peak
  cases (Iseran, Galibier, Izoard), off by a few tens of metres from
  real barometric/GPS altimeter drift over long climbs.
- **Stats**: per-day and trip-wide distance/elevation-gain/moving-time
  come straight from Strava's own summary numbers for each activity, not
  recomputed from the noisier raw altitude stream.

Two named cols (Cime de Vermillon, Col de Nice) get no marker or label
even though real data exists for both now — `index.html`'s own
leg-merge step drops them from `colMarkers` at runtime (`EXCLUDED_COLS`),
alongside Faux col de Restefond (not a genuine named pass — the name
means "false col"). This is a client-side filter, not a hole in the
source data.

Re-run after re-fetching activity streams (the script expects each
day's raw stream JSON as `day1_streams.json`, `day2_streams.json`, etc.,
in the working directory — see the module docstring):

```bash
python3 tools/rebuild_from_strava.py index.html
```

It rewrites `window.ROUTE_DATA` in place and prints each col's chosen
point, altitude, and error against its recorded elevation.

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
  position is scored against the day's projected polyline, every
  already-placed label's box, and every already-placed label's leader
  line (checked in both directions — a new label avoiding an old line
  isn't enough, the new line must avoid old boxes too), in expanding
  rings around its marker. Positions that would make text unreadable
  (overlapping a box, or a line piercing one) are weighted far more
  heavily than merely cosmetic ones (a crossed line, a line grazing the
  path), and the best-scoring candidate always wins — so a crowded
  cluster degrades gracefully instead of a fixed search order
  exhausting itself and falling back to an unchecked placement. Label
  width/height is re-measured from the live DOM every frame rather than
  cached once at creation — the custom webfont doesn't reliably signal
  "loaded" inside a sandboxed iframe, so a one-time measurement can be
  too narrow.
