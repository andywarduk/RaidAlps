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
- **Col markers**: each day's named cols and their real recorded
  elevation come straight from that activity's Strava description — the
  actual climb-top reading from that specific ride, not a web-sourced
  figure. Matching a col to a route point is a small dynamic-programming
  sequence-alignment problem — find the strictly-increasing assignment
  of route points to the day's ordered col list minimizing total
  elevation error — rather than matching cols one at a time, greedily,
  left to right (which lets an early col grab the best nearby altitude
  match and leave nothing sensible for the col listed right after it).
  Candidates are restricted to genuine local peaks (crests followed by a
  descent) — elevation closeness alone isn't sufficient, or a col can
  "match" a point that merely has a numerically close altitude while
  sitting partway up a climb toward a much higher peak later. That's
  exactly what happened to Col de Vars before this restriction existed:
  matched to a point ~21 km away, partway up the approach to the much
  higher Bonette climb, because that point's raw altitude happened to be
  0.2 m closer to the real 2109 m than the actual (lower, genuinely
  cresting) pass. Matches land within a few metres of the recorded
  elevation almost everywhere; the handful several tens of metres off
  (Iseran, Galibier, Izoard, and a few peaks in the tightly-packed
  Bonette cluster) are real barometric/GPS altimeter drift, or a nearby
  real peak within the same small massif, not a matching error.
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
