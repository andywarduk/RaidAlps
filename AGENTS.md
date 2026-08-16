# AGENTS.md — handoff notes for whoever picks this up next

This file is for an agent (or human) continuing work on Raid Alps without
the conversation history that produced the current state. Read `README.md`
first for what the project *is* and where the route data comes from — this
file is about *how to work on it*: workflow, architecture, and the specific
mistakes already made and fixed, so they don't get reintroduced.

## What this is, in one line

A Three.js app that renders a real 7-day Alpine cycling route in 3D, with a
responsive HTML/CSS HUD on top. Editable source lives under `src/` — a
normal multi-file page (`.css`/`.js`/font files, a real `<!DOCTYPE html>`
document). Nothing under `src/` is shipped as-is; `./build.sh` produces two
outputs under `build/` (gitignored, regenerated every run, never committed):
`build/artifact/index.html` (everything inlined into one ~940 KB file — see
README's "Project layout" for why: Claude Artifacts, how this is published,
block all external requests, so the published page has to be one
self-contained file) and `build/webserver.tgz` (src/'s contents tarred for
dropping onto a real webserver, no inlining needed there).

**This split is recent.** If anything below talks about editing a root
`index.html` directly, or mentions a line number in one, that's stale — the
same code now lives under `src/`, unchanged in substance, just relocated
(and there is no committed root `index.html` at all any more — `build/` is
gitignored). Trust `src/` as ground truth.

## Workflow: how this project actually gets worked on

1. Edit files under `src/` directly — `src/style.css`, `src/app.js`,
   `src/vendor/*`, `src/data/route-data.js` (regenerate this one with
   `tools/rebuild_from_strava.py`, don't hand-edit it — see README). Treat
   these exactly like any other web source files.
2. Serve `src/` locally and check it in a real browser before shipping:
   ```bash
   ./serve.sh
   ```
   then open `http://localhost:8123/src/index.html` in the browser tool.
   Always kill the server when done (`pkill -f "http.server 8123"`).
3. **Actually look at it.** This app is almost entirely CSS layout and 3D
   camera math; static code review misses real bugs here (see "CSS
   source-order bug" below, which *read* correct and wasn't). Screenshot
   after every change, at more than one viewport size — at minimum a
   desktop width (~900×550) and a narrow phone portrait (~390×844).
4. Before committing or publishing, rebuild `build/` from `src/`:
   ```bash
   ./build.sh
   ```
   Do this *every time* `src/` changes and you're about to commit/publish —
   `build/` is not auto-synced, and publishing a stale
   `build/artifact/index.html` will ship an old version without whatever
   you just changed.
5. Commit only when asked, using the repo's existing commit-message style:
   a one-line summary, then a paragraph explaining *why*, not just what
   (`git log` has ~30 examples). Always `Co-Authored-By: Claude Sonnet 5
   <noreply@anthropic.com>`. `build/` is gitignored — there is nothing
   under it to ever stage or commit.
6. Publish with the `Artifact` tool, passing the **existing** artifact URL
   so it updates in place rather than forking a new one:
   ```
   url: https://claude.ai/code/artifact/a7e256fe-a64f-4a03-86c8-8edf63991aac
   favicon: 🚵   (keep this — same artifact, same favicon, always)
   ```
   `file_path` for that call is `build/artifact/index.html` — never
   `src/index.html` (Artifacts can't load its separate CSS/JS/font files,
   see README) — and only after running `./build.sh` fresh. If the URL is
   ever lost, `Artifact` with `action: "list"` will find it again by title
   ("Raid Alps").
7. There's a second, independent publish target: pushing to `main` also
   auto-deploys `src/` (not the bundled artifact) to GitHub Pages via
   `.github/workflows/deploy-pages.yml` — see README's "GitHub Pages"
   section. Nothing extra to do for this one beyond pushing; it's not
   something you trigger manually the way the Artifact publish is.
8. The user has occasionally asked to check things on a real iPhone
   Simulator too, in addition to the desktop browser tool. See "Testing
   tooling gotchas" below before doing that — it's not as straightforward
   as it sounds.

## Map of the source

Rough landmarks (search for these, don't trust line numbers — they drift):

- `src/style.css`: CSS custom properties at the top (`--bg`, `--panel`,
  etc.), then HUD layout (`.hud`, `.hud-top`, `.hud-bottom`, `.masthead`,
  `.stat-rail`, `.chip-rail`, `.detail-card`, `.col-label*`), then two
  `@media` breakpoints (see "Responsive layout" below), then the loading
  screen. Fonts are real `.woff2` files under `src/fonts/`, referenced by
  relative `url()` — `tools/build.py` (invoked via `./build.sh`) is what
  turns those into the base64 data URIs `build/artifact/index.html`
  actually ships.
- `src/vendor/three.min.js`, `src/vendor/OrbitControls.js`: vendored,
  not app code — don't try to read or edit these.
- `src/data/route-data.js`: sets `window.ROUTE_DATA = {...}`, the embedded
  route dataset. See README for provenance; don't hand-edit this,
  regenerate it with `tools/rebuild_from_strava.py` if it ever needs to
  change.
- `src/app.js`: one big IIFE (`(function(){ "use strict"; ... })()`).
  Inside it, in roughly this order: `LEGS` setup and leg-merging, viewport
  helpers (`vpW`, `vpH`, `vpValid` — always read the viewport through
  these, never `window.innerWidth` directly; see the black-canvas entry
  under "Tooling gotchas" for why), Three.js scene/camera/renderer/controls
  setup, camera framing (`frameBox`, `hudBottomReserveFrac`,
  `applyBottomReserve`), leg mesh building (`buildLegGroup`), col label
  creation and per-frame placement (`createColLabelEls`,
  `updateColLabelScreenPositions`), HUD wiring (stat rail, chip rail,
  detail card), focus/overview transitions (`focusLeg`, `goOverview`), the
  `animate()` render loop, and `onViewportChange()` at the end.

## Responsive layout

Two breakpoints, both on `.hud-bottom` (a CSS Grid — chip rail, detail
card, elevation-exaggeration note, and interaction hint are direct grid
children, positioned via `grid-area`, not nested divs):

- `@media (max-width:640px)` — phone portrait. Stat rail and subtitle
  hide, title shrinks, detail card goes full-width, and the grid reorders
  to `exag → hint → detail → chips` (hint text above the card, card above
  the pills).
- `@media (max-height:500px)` — phone landscape (or any short viewport).
  Detail card, stat rail, and subtitle *all* hide — there just isn't
  vertical room for a route, a detail card, and a stats bar at once.

**If you add a third HUD element or change what's shown/hidden, update
both queries** — they're independent, not layered.

## Camera framing (the part most likely to bite you)

`frameBox(bbox, bottomReserveFrac, viewDir)` computes where the camera
sits to frame either the whole trip or one focused day. `viewDir` is
optional and defaults to `DEFAULT_VIEW_DIR`, the canonical three-quarter
angle; it exists so a re-frame can refit the content without discarding
the angle the user has orbited to. Two things about it are deliberate and
non-obvious:

1. **It fits the bounding box's projected corners exactly, not a
   circumscribed sphere.** An earlier version used
   `boundingRadius = size.length()/2` (half the 3D diagonal) and only
   checked vertical FOV. That's very conservative for a long, thin route
   and ignores that most viewports are wider than tall — the route ended
   up smaller on screen than it needed to be. The fix projects the 8 box
   corners onto the view plane and fits both FOV axes. If you touch this
   function, verify with an actual before/after screenshot on a long day
   (Day 6) — the difference is easy to see, easy to regress silently.

2. **`controls.target` (the orbit pivot) always sits exactly on the
   content's true geometric center — it is never shifted.** The bottom
   HUD needs reserved screen space so the route doesn't render underneath
   it, achieved via `applyBottomReserve()` calling
   `camera.setViewOffset(...)` (an asymmetric projection offset) — *not*
   by moving the camera/target off-center. An earlier version shifted both
   `camPos` and `center` by the same vector to push content up on screen,
   which looked right for the initial framing but left the orbit pivot
   off the true center, so dragging away from that angle made the route
   visibly drift instead of rotating in place. If you ever feel tempted to
   "just nudge the target a bit" to fix a framing issue, don't — use the
   view-offset mechanism instead, or you'll reintroduce that bug.

`hudBottomReserveFrac()` measures `#hud-bottom`'s *actual rendered
height* live via `getBoundingClientRect()` every time a frame is computed
(on load, after the day chips first populate, per focused day, and on
return to overview) rather than hardcoding a guess — it adapts to
whatever's currently showing. `applyBottomReserve()` must be called
alongside every `frameBox()` call with the *same* fraction, or the visual
reserve and the actual camera framing will disagree.

**This now re-runs on viewport change** (it used to be a known limitation:
only `camera.aspect`/`renderer.setSize` updated, so rotating a device left
the route clipped off both sides until you focused a different day).
`onViewportChange()` refits against `currentFramingBox` — the
exaggeration-scaled box the camera is currently framing, recorded by both
`computeOverviewFrame()` and `focusLeg()`, so the handler knows whether
it's refitting the overview or one day. Keep those two assignments in sync
if you add another thing the camera can frame, or a resize will refit the
wrong box. Details worth knowing:

- It **snaps rather than animates**, but retargets an in-flight `flyTo`
  (rewriting `tweenState.toPos/toTarget`) instead of yanking the camera
  out from under it.
- It **inherits the user's current orbit direction**, so dragging a window
  edge doesn't reset their view — except mid-`flyTo`, where the direction
  is a transient, and before `framedOnce`, where it's the placeholder 1×1
  framing from a zero-sized load.
- A `ResizeObserver` on `#scene-root` runs alongside the `resize`
  listener, because a container can gain size while the window doesn't —
  which is exactly the hidden-iframe case.

## Elevation exaggeration

Not a fixed multiplier — it's solved so the scaled vertical extent is a
fixed fraction of the horizontal one, `altRange × ex = k × diag`, where
`diag` is the **ground-plane** diagonal (`diag2D` uses x and z only) and
`k` is `0.22` for the overview, `0.34` for a focused day. That's why every
day reads with comparable relief regardless of length, and why zooming
into a day always looks more dramatic than the same stretch in the
overview. Current data lands on ×25 overview and ×5–×17 per day; the
clamps (`5..60`, `3..22`) never engage and are purely defensive, as is the
`Math.max(1, altRange)`. Note it scales *absolute* altitude, so the route
floats `minAltitude × ex` above the `y=0` grid rather than sitting on it.

Animating it is awkward, because `buildLegGroup` bakes `ex` into vertex
positions (`p[1]*ex`) and applies the tube radius in that already-scaled
space, so a tube is only round at the `ex` it was built at. Both obvious
approaches are dead ends: rebuilding geometry per frame costs **~20 ms**
for the seven legs (43k vertices) — more than a whole 60fps frame — and
baking `ex=1` so `scale.y` could carry it permanently would render every
tube as a flat ribbon. So geometry is still built once at the destination
`ex`, and `applyDisplayEx()` drives `group.scale.y` from `fromEx/toEx` to
exactly `1`, which leaves the resting state identical to building at
`toEx` outright. Points to keep in mind if you touch it:

- The transient non-uniform scale does squash tubes and col markers, but
  it's largest at the start of the flight — when the camera is furthest
  and the tube is about a pixel wide — and is gone by the time the camera
  is close enough for the cross-section to read. Verified acceptable even
  on the worst case, overview → Day 4 (×25 → ×5, `scale.y` starting 4.58).
- `displayEx` is the exaggeration actually on screen. Anything that needs
  where the route *is drawn* must use it, not `legGroups[id].ex`, which is
  the baked value and is wrong mid-transition — `updateColLabelScreenPositions`
  projects the collision path this way, and col label world positions are
  refreshed from it every frame so leader lines stay anchored (measured
  0 px drift through a transition).
- Starting a new transition mid-transition is fine: `startExTween` picks
  up from the current `displayEx`.

## The one rule for transitions: nothing snaps to the destination

This is the single most productive thing to know about this codebase. A
`flyTo` moves the camera over 950ms, and **every quantity derived from
where the camera is must travel with it**. Each time one was instead
applied at the moment of the click, it produced a visible glitch, and each
was found and fixed separately before the pattern was obvious. All five:

| what | applied at departure gave | now |
|---|---|---|
| `scene.fog.density` | fog factor **0.9999** — route rendered as pure background, so the day appeared black and faded in | derived per frame from actual camera→target distance |
| elevation exaggeration | whole route instantly rescaled vertically | `applyDisplayEx()` eases `scale.y` to exactly 1 |
| tube radius | route dropped to **0 rendered pixels** zooming in; **35 px** fat lines zooming out | direction-aware cross-fade + 1px line floor |
| grid opacity | `overviewGrid` 0.35 → 0.04 in one step, darkening most of the frame (grid is ~13,500px vs the route's ~1,200) | cross-faded over the flight |
| HUD bottom reserve | detail card grows `#hud-bottom` 92→231px, `setViewOffset` shoved the route up **34.6px** before the flight started | `startReserveTween()` eases the fraction |

If you add anything else that depends on camera distance or on HUD
geometry, assume it belongs on this list. The tell is always the same: a
discontinuity at the instant of the click, or in the first frame or two.

Two diagnostics that saved time, worth reusing:

- **Transparent vs. black tells opacity from fog.** The fog colour is
  `--bg`, so anything fogged goes *black*, not see-through. An apparent
  "fade in" that is black is fog, not an opacity tween.
- **Measure the route with the grid hidden.** The grid dominates a naive
  lit-pixel count, and it dims deliberately on focus — reading that as the
  route disappearing sent me down a wrong path once. Hide `GridHelper`
  objects before counting.

## Tube radius, and why the route needs a line down its middle

`buildLegGroup` also emits a plain `THREE.Line` along each run's
centreline. That is not decoration — it's a width floor. Tube radius is
picked to hold a roughly constant *apparent* width, so it tracks camera
distance (206.9 for the overview at ~545,000; 20.7 for Day 4 at ~47,000).
Two baked radii can never both be right mid-flight: over that flight the
outgoing radius reads 1.8px then 20px, and the incoming one 0.8px then
2.1px. There is no crossover where both are acceptable — the gap *is* the
10× radius ratio, so no amount of retiming fixes it. A line is 1px at any
distance, so it carries the route across the whole flight. At rest it sits
inside the wider tube and is invisible.

On top of that, `swapDelayFor(oldRadius, newRadius)` decides *which end* of
the flight the geometry swap happens at:

- **Radius shrinking** (zooming in): swap immediately. The outgoing tube
  balloons as the camera closes, so it's retired inside 300ms while still
  ~2px; the line floor covers the incoming tube being thin.
- **Radius growing** (zooming out): delay 650ms. The incoming overview
  radius would read ~20px while the camera is still close, so hold the
  outgoing thin geometry — the line floor keeps it visible as it recedes —
  and swap near the end.

Capture the old radius *before* the rebuild. `goOverview` briefly had this
wrong, comparing `legGroups[].radius` against `OVERVIEW_RADIUS` after the
rebuild had already set it to exactly that, so the delay was always 0.

Verified end state: every transition peaks at exactly the destination's own
resting width (2.9–4.9px depending on day), in both directions.

## Touch vs. mouse handling

Two features (col label hover-to-reveal-elevation, overview marker
hover-to-show-label) originally only worked with a real mouse. Both are
now tap-accessible too, via:

- `@media (hover:hover) and (pointer:fine)` gates the `:hover`-driven CSS
  reveal to devices that actually have a precise pointer. Touch relies
  solely on an explicit `.tap-active` class toggled by a `click` listener.
  This isn't just tidiness — iOS Safari's `:hover` can linger stickily
  after a tap instead of behaving like a real hover, so *not* relying on
  `:hover` at all on touch sidesteps that rather than trying to out-guess
  it.
- **`.col-label` needs `cursor:pointer`, not `cursor:default`.** iOS
  Safari only reliably fires `click` on the *first* tap for elements it
  considers interactive, and `cursor:pointer` is (bizarrely) the signal it
  checks — even though nothing here uses an actual mouse cursor. Without
  it, the first tap gets eaten as a hover-simulation attempt and you need
  a second tap to register. This was found by testing on a real iOS
  Simulator; Chromium-based testing tools will never catch it, since
  WebKit is the only engine with this quirk.
- The interaction hint text ("drag to orbit...") and the active label's
  z-index bump both key off the same `pointer:coarse`/`hover:hover`
  signals for consistency — grep for `pointer:coarse` and
  `hover:hover` if you need to find every place touch-vs-mouse is branched
  on.

## CSS source-order bug (already fixed once — don't reintroduce the shape of it)

A `.detail-card{ max-width:none; }` override was added inside an early
`@media (max-width:640px)` block, but an *unconditional*
`.detail-card{ max-width:min(420px,86vw); }` rule appeared later in the
file. Equal specificity, later source order wins, **regardless of which
one is inside a media query** — the override silently never applied, at
any width, and looked completely plausible on read-through. The fix was
moving the override into a media block that comes after the base rule.
General lesson for this file: when you add a rule meant to override an
existing unconditional one, check where the unconditional rule sits in
the file, not just whether your new rule's media query is "more specific"
in a logical sense — CSS doesn't care about that, only about specificity
+ source order.

## Testing tooling gotchas (this session's scar tissue)

- **The desktop browser tool's click/drag coordinates are unreliable for
  this app specifically.** Clicks on chip buttons frequently land as a
  text-selection drag instead of a click, or time out, for no discernible
  reason tied to anything in the page. When this happens, **don't fight
  it with more coordinate guesses** — drive the DOM directly instead:
  ```js
  var chips = document.querySelectorAll('.chip');
  var day2 = Array.prototype.find.call(chips, function(c){
    return c.textContent.indexOf('Day 2') !== -1;
  });
  day2.click();
  ```
  via `javascript_tool`. This has been the reliable path essentially every
  time coordinate-based clicking wasn't.
- **`:hover` cannot be reliably simulated by either browser tool.**
  `document.querySelectorAll(':hover')` comes back empty even right after
  a synthetic hover in this environment. If you need to verify
  hover-driven CSS, either (a) force it directly —
  `el.querySelector('.col-label-alt').style.opacity = 1` — to check layout
  without relying on the pseudo-class actually engaging, or (b) accept
  that real-device testing (iOS Simulator) is the only way to see genuine
  `:hover`/tap behavior, and say so honestly rather than reporting a guess
  as a confirmed result.
- **The iOS Simulator tool's tap coordinates are also inconsistent
  turn-to-turn**, despite `attach` reporting a fixed point-space (e.g.
  402×874 for an iPhone 17). What's worked empirically: take a screenshot,
  estimate the target's position in *screenshot pixels*, then divide by
  roughly **2.28** to get simulator point coordinates. This ratio was
  reverse-engineered from trial and error, not documented anywhere — it
  may not hold for a different device or a different Simulator window
  size. Expect to need 2–3 attempts even with the right math; a failed tap
  usually just does nothing (safe to retry), but occasionally lands on the
  wrong element, so screenshot after every tap rather than chaining blind
  taps.
- **This tool has no supported rotate action.** Attempting it via
  AppleScript (`System Events` keystrokes for Cmd+Left/Right, or clicking
  the Device menu) produces a visually broken/sideways-looking capture
  that is *not* representative of a real bug — the user confirmed the
  device was genuinely in landscape while the screenshot looked garbled.
  If landscape needs checking, the desktop browser tool at a manually-set
  short-height viewport (e.g. 844×390) has been the reliable substitute,
  and exercises the exact same `max-height:500px` media query real
  landscape would.
- **The "black canvas after `resize_window`" was a real app bug, now
  fixed** — this entry used to describe a fully black canvas over a working
  HUD (seen right after resizing to the mobile preset, never reproducible
  without a resize in the loop) and wrote it off as a paint-timing artifact
  of the browser tool. It wasn't. If the page loads while the viewport is
  zero-sized, `window.innerWidth/innerHeight` are `0`, so `camera.aspect`
  is `NaN`; that propagates through `frameBox()` into `camera.position`,
  because `Math.max(dist, NaN, 200)` returns `NaN` rather than the intended
  `200` floor. The old resize handler only repaired `camera.aspect`, never
  the camera position, so nothing ever brought it back — permanently black,
  not one-off. `vpW()/vpH()/vpValid()` in `app.js` now floor the viewport
  at 1×1 so no zero reaches the math, and `onViewportChange()` re-frames
  the camera instead of only patching aspect. Don't reintroduce a bare
  `window.innerWidth`/`innerHeight` read — route it through the helpers.
- **The preview pane is often hidden, which pauses `requestAnimationFrame`
  entirely** (`document.visibilityState === "hidden"`, zero rAF callbacks).
  Since this app renders only from its rAF loop, the canvas then stays
  blank no matter what — easy to misread as a rendering bug. To verify
  anything 3D, stub `window.requestAnimationFrame` with a manual queue
  before `app.js` loads and pump frames by hand; wrap
  `THREE.WebGLRenderer/PerspectiveCamera/Scene` at the same point to reach
  the objects inside the IIFE. Two traps when doing this: the app's tweens
  use `performance.now()`, so realign your pump clock to
  `performance.now()` at the start of *every* evaluation or fades and
  fly-tos silently freeze at their start values; and a hidden pane can
  report `innerWidth/innerHeight` of 0, which is how the bug above was
  found in the first place.
- Xcode must have its developer directory selected
  (`xcode-select -s /Applications/Xcode.app/Contents/Developer`) for the
  Simulator tool to attach at all — this needs the user's password to fix
  if it's ever wrong, you can't run it yourself.

## Things that look like bugs but aren't

- Grid lines only faintly visible behind the route: **fixed** — was
  `colorB` nearly matching the page background; now brighter. If it looks
  washed out again, check `makeGrid()` calls haven't reverted.
- A day's route jittering/jumping when a col label is hovered: **fixed**,
  root cause was a CSS flexbox `min-width:auto` fight over the (at the
  time) inline elevation reveal. The elevation pill is now
  `position:absolute` specifically so it can never again perturb the
  label's own measured size — don't put it back in normal flow.
- Anything odd in the first frames of a day/overview transition — the route
  starting black, going invisible, rescaling, fattening, or jumping up the
  screen: **all fixed**, and all the same root cause. See "The one rule for
  transitions" above rather than re-deriving them; they were found and
  fixed one at a time over several rounds because each fix exposed the next.
  One extra, opacity-specific, not in that table: `focusLeg()` used to
  `setGroupOpacity(group, 0)` and fade `0 -> 1` unconditionally, so a day
  focused straight from the overview blinked out despite already being
  fully coloured. It now carries the outgoing opacity across the swap, as
  the sibling legs in the same function already did. Check *both* entry
  paths if you touch it — that bug was invisible coming from another day,
  where the group really was dimmed at 0.22.
