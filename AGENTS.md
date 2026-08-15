# AGENTS.md — handoff notes for whoever picks this up next

This file is for an agent (or human) continuing work on Raid Alps without
the conversation history that produced the current state. Read `README.md`
first for what the project *is* and where the route data comes from — this
file is about *how to work on it*: workflow, architecture, and the specific
mistakes already made and fixed, so they don't get reintroduced.

## What this is, in one line

A single self-contained `index.html` (~920 KB, Three.js bundled inline) that
renders a real 7-day Alpine cycling route in 3D, with a responsive HTML/CSS
HUD on top. No build step, no dependencies to install, no other source files
except `tools/rebuild_from_strava.py` (regenerates the embedded route data —
see README).

## Workflow: how this project actually gets worked on

There's no build/test/lint pipeline. The loop for every change has been:

1. Edit `index.html` directly with `Edit`/`Read` (it's plain HTML/CSS/JS in
   `<style>`/`<script>` tags — treat it like any web source file, not a
   binary blob).
2. Serve it locally and check it in a real browser before shipping:
   ```bash
   python3 -m http.server 8123
   ```
   then open `http://localhost:8123/index.html` in the browser tool. Always
   kill the server when done (`pkill -f "http.server 8123"`) — it's not
   meant to stay running between turns.
3. **Actually look at it.** This app is almost entirely CSS layout and 3D
   camera math; static code review misses real bugs here (see "CSS
   source-order bug" below, which *read* correct and wasn't). Screenshot
   after every change, at more than one viewport size — at minimum a
   desktop width (~900×550) and a narrow phone portrait (~390×844).
4. Commit only when asked, using the repo's existing commit-message style:
   a one-line summary, then a paragraph explaining *why*, not just what
   (`git log` has ~30 examples). Always `Co-Authored-By: Claude Sonnet 5
   <noreply@anthropic.com>`.
5. Publish with the `Artifact` tool, passing the **existing** artifact URL
   so it updates in place rather than forking a new one:
   ```
   url: https://claude.ai/code/artifact/a7e256fe-a64f-4a03-86c8-8edf63991aac
   favicon: 🚵   (keep this — same artifact, same favicon, always)
   ```
   If that URL is ever lost, `Artifact` with `action: "list"` will find it
   again by title ("Raid Alps").
6. The user has occasionally asked to check things on a real iPhone
   Simulator too, in addition to the desktop browser tool. See "Testing
   tooling gotchas" below before doing that — it's not as straightforward
   as it sounds.

## Map of `index.html`

It's one file, but not an undifferentiated mess. Rough landmarks (search
for these, don't trust line numbers — they drift):

- `<style>` block: CSS custom properties at the top (`--bg`, `--panel`,
  etc.), then HUD layout (`.hud`, `.hud-top`, `.hud-bottom`, `.masthead`,
  `.stat-rail`, `.chip-rail`, `.detail-card`, `.col-label*`), then two
  `@media` breakpoints (see "Responsive layout" below), then the loading
  screen.
- A giant minified Three.js + OrbitControls bundle (`<script>` — don't try
  to read or edit this; it's vendored, not app code).
- `window.ROUTE_DATA = {...}` — the embedded route dataset. See README for
  provenance; don't hand-edit this, regenerate it with
  `tools/rebuild_from_strava.py` if it ever needs to change.
- The app script, one big IIFE (`(function(){ "use strict"; ... })()`).
  Inside it, in roughly this order: `LEGS` setup and leg-merging, Three.js
  scene/camera/renderer/controls setup, camera framing (`frameBox`,
  `hudBottomReserveFrac`, `applyBottomReserve`), leg mesh building
  (`buildLegGroup`), col label creation and per-frame placement
  (`createColLabelEls`, `updateColLabelScreenPositions`), HUD wiring
  (stat rail, chip rail, detail card), focus/overview transitions
  (`focusLeg`, `goOverview`), and the `animate()` render loop at the end.

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

`frameBox(bbox, bottomReserveFrac)` computes where the camera sits to
frame either the whole trip or one focused day. Two things about it are
deliberate and non-obvious:

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

**Known limitation, not yet fixed**: none of this re-runs on window
resize — only `camera.aspect`/`renderer.setSize` update in the resize
handler. If the user resizes mid-session (or rotates a real device, which
does fire a resize), the framing can go stale until they focus a different
day. Fixing this properly would mean re-running `frameBox` on resize,
which weakens the case for *not* animating it (would need a resize-time
`flyTo` or an instant snap) — flagged here rather than fixed because it
wasn't the specific bug reported each time this system got touched.

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
