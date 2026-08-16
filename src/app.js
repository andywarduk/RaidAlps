(function(){
  "use strict";

  var DATA = window.ROUTE_DATA;

  var LEGS = [
    { id:"day1", label:"Day 1", keys:["day1"], colorVar:"--day-1" },
    { id:"day2", label:"Day 2", keys:["day2"], colorVar:"--day-2" },
    { id:"day3", label:"Day 3", keys:["day3a","day3b"], colorVar:"--day-3" },
    { id:"day4", label:"Day 4", keys:["day4"], colorVar:"--day-4" },
    { id:"day5", label:"Day 5", keys:["day5"], colorVar:"--day-5" },
    { id:"day6", label:"Day 6", keys:["day6"], colorVar:"--day-6" },
    { id:"day7", label:"Day 7", keys:["day7"], colorVar:"--day-7" }
  ];

  var root = getComputedStyle(document.documentElement);
  function cssVar(name){ return root.getPropertyValue(name).trim(); }

  function fmt(n){ return n.toLocaleString("en-US"); }

  // Cime de Vermillon / Col de Nice: no published elevation or position
  // could be found — drop rather than guess. Faux col de Restefond: not
  // a genuine named pass (the name literally means "false col"), just a
  // saddle near the real Col de Restefond.
  var EXCLUDED_COLS = { "Cime de Vermillon":1, "Col de Nice":1, "Faux col de Restefond":1 };

  // ---- merge day3a/day3b into leg records --------------------------------
  LEGS.forEach(function(leg){
    var parts = leg.keys.map(function(k){ return DATA.legs[k]; });
    var pts = [];
    parts.forEach(function(p, i){
      if (i > 0) pts.push(null); // gap marker between sub-legs (lunch break)
      pts = pts.concat(p.pts);
    });
    leg.pts = pts;
    leg.date = parts[0].date;
    leg.cols = parts.map(function(p){ return p.cols; }).join(" · ");
    leg.dist_mi = parts.reduce(function(s,p){ return s+p.dist_mi; }, 0);
    leg.dist_km = parts.reduce(function(s,p){ return s+p.dist_km; }, 0);
    leg.gain_ft = parts.reduce(function(s,p){ return s+p.gain_ft; }, 0);
    leg.gain_m = parts.reduce(function(s,p){ return s+p.gain_m; }, 0);
    leg.max_alt_ft = Math.max.apply(null, parts.map(function(p){ return p.max_alt_ft; }));
    leg.max_alt_m = Math.max.apply(null, parts.map(function(p){ return p.max_alt_m; }));
    leg.color = cssVar(leg.colorVar);
    leg.colMarkers = [];
    parts.forEach(function(p){ leg.colMarkers = leg.colMarkers.concat(p.colMarkers); });
    leg.colMarkers = leg.colMarkers.filter(function(cm){ return !EXCLUDED_COLS[cm.name]; });
  });

  // trip start/end — reuse the same marker/label/leader-line machinery as cols
  var firstLeg = LEGS[0], lastLeg = LEGS[LEGS.length-1];
  firstLeg.colMarkers.unshift({ name:"Thonon-les-Bains", pt:firstLeg.pts[0] });
  lastLeg.colMarkers.push({ name:"Nice", pt:lastLeg.pts[lastLeg.pts.length-1] });

  // ---- geometry helpers ----------------------------------------------------
  function segmentsFromPts(pts){
    // split on null gap markers into contiguous runs
    var runs = [];
    var cur = [];
    pts.forEach(function(p){
      if (p === null){
        if (cur.length > 1) runs.push(cur);
        cur = [];
      } else {
        cur.push(p);
      }
    });
    if (cur.length > 1) runs.push(cur);
    return runs;
  }

  function bboxOfPts(pts){
    var minx=Infinity,maxx=-Infinity,miny=Infinity,maxy=-Infinity,minz=Infinity,maxz=-Infinity;
    pts.forEach(function(p){
      if (!p) return;
      minx=Math.min(minx,p[0]); maxx=Math.max(maxx,p[0]);
      miny=Math.min(miny,p[1]); maxy=Math.max(maxy,p[1]);
      minz=Math.min(minz,p[2]); maxz=Math.max(maxz,p[2]);
    });
    return {minx:minx,maxx:maxx,miny:miny,maxy:maxy,minz:minz,maxz:maxz};
  }

  function diag2D(b){
    return Math.sqrt(Math.pow(b.maxx-b.minx,2)+Math.pow(b.maxz-b.minz,2));
  }

  function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }

  // Fog density calibrated against the camera's actual distance to its
  // target, not the raw scene diagonal — frameBox() places the camera
  // roughly diag/sin(fov/2) away, so a diag-relative density over-fogs
  // everything into the background color for tall/thin routes.
  function fogDensityForCamDist(d){ return 0.6 / Math.max(d, 200); }

  var OVERVIEW_BBOX = DATA.bbox;
  var OVERVIEW_DIAG = diag2D(OVERVIEW_BBOX);
  var OVERVIEW_ALT_RANGE = Math.max(1, OVERVIEW_BBOX.maxy - OVERVIEW_BBOX.miny);
  var OVERVIEW_EX = clamp(0.22 * OVERVIEW_DIAG / OVERVIEW_ALT_RANGE, 5, 60);
  var OVERVIEW_RADIUS = OVERVIEW_DIAG / 1500;

  // ---- viewport size -------------------------------------------------------
  // Never hand a zero to the camera or the framing math. A page that loads
  // into a zero-sized viewport (an artifact iframe mounted hidden, a
  // display:none container, a tab not yet laid out) reports innerWidth and
  // innerHeight of 0, which makes camera.aspect NaN — and that NaN runs
  // straight through frameBox into camera.position, because
  // Math.max(dist, NaN, 200) returns NaN rather than the intended 200 floor.
  // The symptom was a permanently black canvas over a working HUD: the old
  // resize handler repaired camera.aspect but never re-derived the camera
  // position, so nothing ever brought it back. Falling back to 1x1 keeps
  // every number finite; onViewportChange() re-frames for real as soon as a
  // genuine size arrives.
  function vpW(){ return Math.max(1, window.innerWidth || document.documentElement.clientWidth || 0); }
  function vpH(){ return Math.max(1, window.innerHeight || document.documentElement.clientHeight || 0); }
  function vpValid(){
    return (window.innerWidth || document.documentElement.clientWidth || 0) > 0 &&
           (window.innerHeight || document.documentElement.clientHeight || 0) > 0;
  }

  // ---- three.js scene setup -------------------------------------------------
  var container = document.getElementById("scene-root");
  var scene = new THREE.Scene();
  var bgColor = new THREE.Color(cssVar("--bg") || "#0b0f14");
  scene.background = bgColor;
  scene.fog = new THREE.FogExp2(bgColor.getHex(), fogDensityForCamDist(OVERVIEW_DIAG));

  var camera = new THREE.PerspectiveCamera(42, vpW()/vpH(), 5, 4000000);

  var renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:"high-performance" });
  renderer.setPixelRatio(window.devicePixelRatio||1);
  renderer.setSize(vpW(), vpH());
  container.appendChild(renderer.domElement);

  var controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 200;
  controls.maxDistance = OVERVIEW_DIAG * 3;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.screenSpacePanning = true;

  // ---- overview col hover -----------------------------------------------
  // lets a col be labeled by hovering its marker even when no day is
  // focused, without cluttering the overview with all 26 labels at once.
  // Hit-tested in 2D screen space against each marker's projected point
  // (with a fixed pixel radius) rather than 3D-raycasting the actual
  // sphere mesh, since at overview zoom a marker can be only a couple of
  // pixels across — too small a target to click precisely in 3D.
  var hoverMouseX = -1e9, hoverMouseY = -1e9;
  var HOVER_RADIUS = 14;
  renderer.domElement.addEventListener("mousemove", function(e){
    hoverMouseX = e.clientX; hoverMouseY = e.clientY;
    requestRender();
  });
  renderer.domElement.addEventListener("mouseleave", function(){
    hoverMouseX = -1e9; hoverMouseY = -1e9;
    requestRender();
  });

  // touch has no hover state at all, so tapping a marker toggles its label
  // instead — same nearest-marker search as the hover case above, just
  // triggered on tap rather than continuous mouse position. A movement
  // threshold keeps this from firing at the end of a one-finger drag used
  // to orbit the camera.
  var tappedMarker = null;
  var pointerDownPos = null;
  renderer.domElement.addEventListener("pointerdown", function(e){
    pointerDownPos = { x: e.clientX, y: e.clientY };
  });
  renderer.domElement.addEventListener("pointerup", function(e){
    var start = pointerDownPos;
    pointerDownPos = null;
    if (!start || activeLegId !== null) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) return;

    var halfW = vpW()/2, halfH = vpH()/2;
    var best = null, bestDist = HOVER_RADIUS;
    LEGS.forEach(function(leg){
      colLabels[leg.id].forEach(function(l, idx){
        var sp = projectToScreen(l.worldPos, halfW, halfH);
        if (sp.behind) return;
        var d = Math.hypot(sp.x - e.clientX, sp.y - e.clientY);
        if (d <= bestDist){ bestDist = d; best = { legId: leg.id, idx: idx }; }
      });
    });
    tappedMarker = (best && tappedMarker && best.legId === tappedMarker.legId && best.idx === tappedMarker.idx)
      ? null : best;
    requestRender();
  });

  var hemi = new THREE.HemisphereLight(0x9fc3ff, 0x0a0d12, 1.05);
  scene.add(hemi);
  var sun = new THREE.DirectionalLight(0xfff2e0, 0.85);
  sun.position.set(1, 1.5, 0.7);
  scene.add(sun);
  var fillLight = new THREE.DirectionalLight(0x6fa8ff, 0.25);
  fillLight.position.set(-1, 0.6, -0.8);
  scene.add(fillLight);

  // GridHelper bakes colorA/colorB as per-vertex geometry attributes, not a
  // material uniform, so retheming means disposing and rebuilding the mesh
  // rather than updating a color in place — see applyThemeToScene() below.
  var GRID_COLORS = {
    dark:  { ovA:0x3d5570, ovB:0x263a4d, fA:0x46607c, fB:0x2c4055 },
    light: { ovA:0x5b7086, ovB:0x9fb0c2, fA:0x4a6178, fB:0x8ea2b6 }
  };
  function effectiveTheme(){
    var explicit = document.documentElement.getAttribute("data-theme");
    if (explicit === "light" || explicit === "dark") return explicit;
    return (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) ? "light" : "dark";
  }
  function gridColors(){ return GRID_COLORS[effectiveTheme()]; }

  function makeGrid(size, divisions, colorA, colorB){
    var g = new THREE.GridHelper(size, divisions, colorA, colorB);
    g.material.transparent = true;
    g.material.opacity = 0.35;
    return g;
  }

  var overviewGridSize = Math.max(OVERVIEW_BBOX.maxx-OVERVIEW_BBOX.minx, OVERVIEW_BBOX.maxz-OVERVIEW_BBOX.minz) * 1.35;
  var overviewGridCx = (OVERVIEW_BBOX.minx+OVERVIEW_BBOX.maxx)/2;
  var overviewGridCz = (OVERVIEW_BBOX.minz+OVERVIEW_BBOX.maxz)/2;
  var overviewGrid = makeGrid(overviewGridSize, 36, gridColors().ovA, gridColors().ovB);
  overviewGrid.position.set(overviewGridCx, 0, overviewGridCz);
  scene.add(overviewGrid);

  var focusGrid = null;
  var focusGridParams = null;

  // Live-updates scene.background/fog (simple THREE.Color objects) and
  // rebuilds both grids at the current theme's colors, preserving each
  // grid's current opacity/position. Called on every theme change, not just
  // at load — see the theme-toggle wiring near the end of this file.
  function applyThemeToScene(){
    bgColor.set(cssVar("--bg"));
    scene.fog.color.copy(bgColor);

    var gc = gridColors();

    var ovOpacity = overviewGrid.material.opacity;
    scene.remove(overviewGrid);
    overviewGrid.geometry.dispose();
    overviewGrid.material.dispose();
    overviewGrid = makeGrid(overviewGridSize, 36, gc.ovA, gc.ovB);
    overviewGrid.position.set(overviewGridCx, 0, overviewGridCz);
    overviewGrid.material.opacity = ovOpacity;
    scene.add(overviewGrid);

    if (focusGrid && focusGridParams){
      var fOpacity = focusGrid.material.opacity;
      scene.remove(focusGrid);
      focusGrid.geometry.dispose();
      focusGrid.material.dispose();
      focusGrid = makeGrid(focusGridParams.size, 24, gc.fA, gc.fB);
      focusGrid.position.set(focusGridParams.cx, 0, focusGridParams.cz);
      focusGrid.material.opacity = fOpacity;
      scene.add(focusGrid);
    }

    requestRender();
  }

  // ---- build leg meshes ------------------------------------------------------
  var legGroups = {};

  function buildLegGroup(leg, ex, radius){
    var group = new THREE.Group();
    var runs = segmentsFromPts(leg.pts);
    var colorObj = new THREE.Color(leg.color);

    runs.forEach(function(run){
      var vecs = run.map(function(p){
        return new THREE.Vector3(p[0], p[1]*ex, p[2]);
      });
      if (vecs.length < 2) return;
      var curve = new THREE.CatmullRomCurve3(vecs);
      var tubularSeg = clamp(Math.round(run.length*2.2), 32, 500);
      var geo = new THREE.TubeGeometry(curve, tubularSeg, radius, 8, false);
      var mat = new THREE.MeshStandardMaterial({
        color: colorObj,
        emissive: colorObj,
        emissiveIntensity: 0.35,
        roughness: 0.45,
        metalness: 0.08,
        transparent: true,
        opacity: 1
      });
      var mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);

      // A 1px line down the same centreline, as a width floor. The tube's
      // on-screen width scales with 1/distance, and the radius is chosen for
      // the resting camera distance — so during a fly-to, when the camera is
      // still far out but the geometry has already been rebuilt for the
      // destination, the tube can drop below one pixel and effectively
      // vanish. Two baked radii can never both be right: over the Day 4
      // flight the camera closes from ~545,000 to ~47,000, where the outgoing
      // radius reads 1.8px then 20px, and the incoming one 0.8px then 2.1px.
      // A line is one pixel wide at any distance, so it holds the route
      // visible across the whole flight regardless. At rest it sits inside
      // the (wider) tube and is hidden by it.
      var lineGeo = new THREE.BufferGeometry().setFromPoints(vecs);
      var lineMat = new THREE.LineBasicMaterial({
        color: colorObj, transparent: true, opacity: 1
      });
      group.add(new THREE.Line(lineGeo, lineMat));
    });

    // one ball per named col, at its actual position on the route
    var sGeo = new THREE.SphereGeometry(radius*2.4, 16, 16);
    leg.colMarkers.forEach(function(marker){
      var sMat = new THREE.MeshStandardMaterial({
        color: colorObj, emissive: colorObj, emissiveIntensity: 0.9,
        roughness:0.3, transparent:true, opacity:1
      });
      var sMesh = new THREE.Mesh(sGeo, sMat);
      sMesh.position.set(marker.pt[0], marker.pt[1]*ex, marker.pt[2]);
      group.add(sMesh);
    });
    return group;
  }

  // ---- col labels --------------------------------------------------------
  var colLabelsRoot = document.getElementById("col-labels");
  var SVGNS = "http://www.w3.org/2000/svg";
  var leaderSvg = document.getElementById("col-leader-lines");
  var colLabels = {}; // legId -> [{ el, worldPos }]
  var tapActiveLabel = null; // touch has no hover, so tapping a label toggles its elevation instead

  function createColLabelEls(leg){
    colLabels[leg.id] = leg.colMarkers.map(function(marker){
      var el = document.createElement("div");
      el.className = "col-label";
      el.style.setProperty("--label-color", leg.color);

      var nameEl = document.createElement("span");
      nameEl.textContent = marker.name;
      el.appendChild(nameEl);

      // revealed on hover — expands the label rather than opening a
      // separate tooltip, so it still tracks the same collision-avoidance
      // box every other label uses
      var altEl = document.createElement("span");
      altEl.className = "col-label-alt";
      var altFt = Math.round(marker.pt[1] * 3.28084);
      altEl.textContent = fmt(altFt) + " ft · " + fmt(Math.round(marker.pt[1])) + " m";
      el.appendChild(altEl);

      // touch has no :hover, so tapping the label toggles the same reveal
      el.addEventListener("click", function(){
        if (tapActiveLabel === el){
          el.classList.remove("tap-active");
          tapActiveLabel = null;
        } else {
          if (tapActiveLabel) tapActiveLabel.classList.remove("tap-active");
          el.classList.add("tap-active");
          tapActiveLabel = el;
        }
      });

      colLabelsRoot.appendChild(el);
      var rect = el.getBoundingClientRect();

      var line = document.createElementNS(SVGNS, "line");
      leaderSvg.appendChild(line);
      var dot = document.createElementNS(SVGNS, "circle");
      dot.setAttribute("r", "2.5");
      dot.style.setProperty("--label-color", leg.color);
      leaderSvg.appendChild(dot);

      return {
        el:el, line:line, dot:dot, pt:marker.pt, worldPos:new THREE.Vector3(),
        w:rect.width, h:rect.height,
        cx:0, cy:0, ax:0, ay:0, visible:false // filled in each frame
      };
    });
  }

  function updateColLabelWorldPositions(leg, ex){
    colLabels[leg.id].forEach(function(l){
      l.worldPos.set(l.pt[0], l.pt[1]*ex, l.pt[2]);
    });
  }

  LEGS.forEach(function(leg){
    var group = buildLegGroup(leg, OVERVIEW_EX, OVERVIEW_RADIUS);
    scene.add(group);
    legGroups[leg.id] = { group:group, ex:OVERVIEW_EX, radius:OVERVIEW_RADIUS };
    createColLabelEls(leg);
    updateColLabelWorldPositions(leg, OVERVIEW_EX);
  });

  // NB: the label sizes cached by createColLabelEls() are measured before the
  // custom webfont has swapped in and so are too narrow. There used to be a
  // document.fonts.ready hook here to re-measure them; it's gone because
  // updateColLabelScreenPositions() re-measures every visible label live on
  // every frame anyway (see the comment there for why it can't trust the
  // cache), which covers the font swap and then some.

  function setGroupOpacity(group, op){
    group.traverse(function(o){
      if (o.material){ o.material.opacity = op; }
    });
  }

  // ---- camera framing --------------------------------------------------------
  // On narrow screens the bottom HUD (day detail card + pills) can cover a
  // large share of the viewport height, so the route needs to fit above it
  // rather than being centered in the full window and running underneath.
  function hudBottomReserveFrac(){
    var el = document.getElementById("hud-bottom");
    if (!el) return 0;
    var h = el.getBoundingClientRect().height;
    if (h <= 0) return 0;
    return clamp(h / vpH() + 0.03, 0, 0.5);
  }

  var DEFAULT_VIEW_DIR = new THREE.Vector3(0.58, 0.66, 0.92).normalize();

  function frameBox(b, bottomReserveFrac, viewDir){
    bottomReserveFrac = bottomReserveFrac || 0;
    var center = new THREE.Vector3((b.minx+b.maxx)/2, ((b.miny||0)+(b.maxy||0))/2, (b.minz+b.maxz)/2);
    var vFov = camera.fov * Math.PI / 180;
    var hFov = 2 * Math.atan(Math.tan(vFov/2) * camera.aspect);
    // an explicit viewDir lets a re-frame refit the content without throwing
    // away whatever angle the user has orbited to; otherwise use the
    // canonical three-quarter view
    var dir = viewDir ? viewDir.clone().normalize() : DEFAULT_VIEW_DIR.clone();

    // Exact fit instead of circumscribing a sphere around the box's full
    // diagonal: project the 8 corners onto the view plane (perpendicular
    // to the fixed viewing direction) and use their actual half-extents.
    // A sphere wastes a lot of room for the long, thin shape most day
    // routes are, and the old formula only checked vFov, leaving the
    // (usually wider) horizontal FOV of a landscape viewport unused.
    var forward = dir.clone().negate();
    // OrbitControls has no minPolarAngle here, so the user can orbit to
    // straight overhead — where forward is parallel to +Y and the usual up
    // reference collapses to a zero-length cross product
    var worldUp = Math.abs(forward.y) > 0.999 ? new THREE.Vector3(0,0,1) : new THREE.Vector3(0,1,0);
    var right = new THREE.Vector3().crossVectors(forward, worldUp).normalize();
    var up = new THREE.Vector3().crossVectors(right, forward).normalize();
    var corners = [
      [b.minx,b.miny,b.minz],[b.maxx,b.miny,b.minz],[b.minx,b.maxy,b.minz],[b.maxx,b.maxy,b.minz],
      [b.minx,b.miny,b.maxz],[b.maxx,b.miny,b.maxz],[b.minx,b.maxy,b.maxz],[b.maxx,b.maxy,b.maxz]
    ];
    var maxRight = 0, maxUp = 0, offset = new THREE.Vector3();
    corners.forEach(function(c){
      offset.set(c[0]-center.x, c[1]-center.y, c[2]-center.z);
      maxRight = Math.max(maxRight, Math.abs(offset.dot(right)));
      maxUp = Math.max(maxUp, Math.abs(offset.dot(up)));
    });

    // shrink the usable frustum height to leave room for the reserved
    // strip at the bottom, then zoom out enough that the box still fits
    // inside what's left. Positioning the content within that extra room
    // is handled separately by applyBottomReserve() — camPos and center
    // (the orbit target) always stay exactly on the content's true
    // center, so dragging to orbit always pivots correctly around it.
    var usableFrac = 1 - bottomReserveFrac;
    var distForHeight = maxUp / Math.tan(vFov/2) / usableFrac;
    var distForWidth = maxRight / Math.tan(hFov/2);
    var dist = Math.max(distForHeight, distForWidth, 200) * 1.18;

    var camPos = center.clone().addScaledVector(dir, dist);
    return { center: center, camPos: camPos };
  }

  // Pushes the framed content up on screen to clear the reserved bottom
  // strip via an asymmetric camera projection (three.js's view-offset
  // mechanism, normally used for tiled rendering) rather than by moving
  // the camera/target off the content's true center. This is what keeps
  // drag-to-orbit pivoting cleanly around the content regardless of how
  // much room the bottom HUD needs — the earlier approach shifted camPos
  // and the orbit target together by the same amount, which looked right
  // for the initial framing but left controls.target off-center, so
  // orbiting away from that framing made the route visibly drift instead
  // of rotating in place.
  var displayReserve = 0;   // the reserve fraction currently in the projection
  var reserveTween = null;

  function applyBottomReserve(bottomReserveFrac){
    displayReserve = bottomReserveFrac;
    if (bottomReserveFrac > 0){
      var w = vpW(), h = vpH();
      camera.setViewOffset(w, h, 0, h * bottomReserveFrac / 4, w, h);
    } else if (camera.view){
      camera.clearViewOffset();
    }
  }

  // Focusing a day shows the detail card, which makes #hud-bottom about 2.5x
  // taller (92px -> 231px here) and so demands a much bigger reserve. Applied
  // on the spot that re-offsets the projection instantly and the route visibly
  // jumps up the screen — measured 34.6px — before the fly-to has even
  // started. Like the fog, the exaggeration and the tube radius, the reserve
  // belongs to the destination, so it travels with the camera instead.
  function startReserveTween(toFrac, duration){
    if (Math.abs(displayReserve - toFrac) < 0.0005){
      applyBottomReserve(toFrac);
      reserveTween = null;
      return;
    }
    reserveTween = { from: displayReserve, to: toFrac, t0: performance.now(), duration: duration || 950 };
  }

  var tweenState = null;
  function flyTo(camPos, target, duration){
    tweenState = {
      t0: performance.now(),
      duration: duration || 950,
      fromPos: camera.position.clone(),
      toPos: camPos.clone(),
      fromTarget: controls.target.clone(),
      toTarget: target.clone()
    };
  }
  function easeInOutCubic(t){ return t<0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2; }

  // ---- elevation exaggeration transitions ----------------------------------
  // Each leg's geometry is built with the exaggeration baked into its vertex
  // positions (buildLegGroup does p[1]*ex), and the tube radius is applied in
  // that already-scaled space, so a tube is only truly round at the ex it was
  // built at. That rules out the two obvious ways to animate ex: rebuilding
  // the geometry per frame costs ~20ms for the seven legs (43k vertices) —
  // over a whole 60fps frame — and baking ex=1 so scale.y could carry it
  // permanently would render every tube as a flat ribbon.
  //
  // So geometry is still built once at the *destination* ex, and scale.y
  // carries the difference: it starts at fromEx/toEx and eases to exactly 1,
  // which leaves the resting state identical to building at toEx outright.
  // The transient non-uniform scale squashes the tubes and col markers, but
  // it is largest at the start of the flight — exactly when the camera is
  // furthest away and the tube covers about a pixel — and has gone by the
  // time the camera is close enough for the cross-section to read.
  var displayEx = OVERVIEW_EX;   // the exaggeration actually on screen
  var exTween = null;

  // Geometry on its way out, kept alive and cross-faded rather than disposed
  // on the spot. The tube radius is baked into TubeGeometry just like ex is,
  // but unlike ex it can't be carried by scale.y — a uniform group scale
  // would move the vertices too. And the radius really does have to change:
  // it's chosen to hold a roughly constant *apparent* width, so it tracks the
  // camera distance (overview 206.9 at ~450k away, Day 4 20.7 at ~38k).
  // Swapping it on the spot dropped the whole route to 0.18px while the
  // camera was still at overview range — sub-pixel, so it barely rasterised
  // and the path appeared to go dark. Holding the outgoing fat tubes up while
  // the incoming thin ones rise gives a concentric blend that reads as the
  // line narrowing, and costs one extra copy of the geometry for the flight.
  // The outgoing copy only has to cover the moment of the swap, so this is
  // deliberately much shorter than the 950ms flight. Its *apparent* width
  // grows as 1/distance — 1.9px at departure but 20.6px on arrival — so if it
  // is still fading when the camera gets close it shows up as a wide
  // translucent halo round the thin new tube, which reads as the line
  // widening near the end of the flight. Finishing inside 300ms retires it
  // while it is still about 2px. The incoming tube covers the handover: the
  // exaggeration tween stretches it vertically early on, so it is already
  // ~0.8-1.0px wide from the first frame rather than the sub-pixel sliver its
  // radius alone would suggest.
  var GEO_CROSSFADE_MS = 300;
  var retiredGroups = [];

  // Which end of the flight the swap happens at depends on which way the
  // radius is going. Zooming IN the incoming tube is too thin at first (the
  // 1px line floor covers that) while the outgoing one balloons as the camera
  // closes, so swap immediately. Zooming OUT it is the reverse: the incoming
  // overview radius reads ~20px while the camera is still close, so hold the
  // outgoing thin geometry — the line floor keeps it visible as it recedes —
  // and swap near the end, by which point the camera is ~482,000 away and the
  // overview radius reads its intended ~1.7px.
  function swapDelayFor(oldRadius, newRadius){
    return newRadius > oldRadius ? 650 : 0;
  }

  function retireGroup(group, bakedEx, fromOp, duration, delay){
    var entry = { group: group, ex: bakedEx };
    retiredGroups.push(entry);
    fadeOpacity(group, fromOp, 0, duration, function(){
      scene.remove(group);
      group.traverse(function(o){ if(o.geometry) o.geometry.dispose(); if(o.material) o.material.dispose(); });
      var i = retiredGroups.indexOf(entry);
      if (i >= 0) retiredGroups.splice(i, 1);
    }, delay);
  }

  // grids are single-material Object3Ds, so setGroupOpacity's traverse covers
  // them and the same fade machinery works
  function retireGrid(grid, duration){
    fadeOpacity(grid, grid.material.opacity, 0, duration, function(){
      scene.remove(grid);
      grid.geometry.dispose();
      grid.material.dispose();
    });
  }

  function applyDisplayEx(ex){
    displayEx = ex;
    LEGS.forEach(function(leg){
      var entry = legGroups[leg.id];
      if (!entry) return;
      entry.group.scale.y = ex / entry.ex;   // entry.ex = the ex baked into the mesh
      updateColLabelWorldPositions(leg, ex);
    });
    // outgoing copies ride the same exaggeration so they stay superimposed on
    // their replacements instead of drifting apart during the cross-fade
    retiredGroups.forEach(function(r){ r.group.scale.y = ex / r.ex; });
  }

  function startExTween(toEx, duration){
    if (Math.abs(displayEx - toEx) < 0.001){
      applyDisplayEx(toEx);   // snaps scale.y back to exactly 1
      exTween = null;
      return;
    }
    exTween = { from: displayEx, to: toEx, t0: performance.now(), duration: duration || 950 };
  }

  // the exaggeration-scaled box the camera is currently framing — kept so a
  // viewport change can refit exactly what's on screen, overview or one day
  var currentFramingBox = null;

  // initial camera position = overview framing
  // reserve fraction the most recent frameBox() call was computed against —
  // callers decide whether to apply it instantly or animate towards it
  var lastFrameReserve = 0;

  function computeOverviewFrame(){
    var reserveFrac = hudBottomReserveFrac();
    lastFrameReserve = reserveFrac;
    currentFramingBox = {
      minx:OVERVIEW_BBOX.minx, maxx:OVERVIEW_BBOX.maxx,
      miny:OVERVIEW_BBOX.miny*OVERVIEW_EX, maxy:OVERVIEW_BBOX.maxy*OVERVIEW_EX,
      minz:OVERVIEW_BBOX.minz, maxz:OVERVIEW_BBOX.maxz
    };
    return frameBox(currentFramingBox, reserveFrac);
  }
  var overviewFrame = computeOverviewFrame();
  applyBottomReserve(lastFrameReserve);
  camera.position.copy(overviewFrame.camPos);
  controls.target.copy(overviewFrame.center);
  controls.update();

  scene.fog.density = fogDensityForCamDist(overviewFrame.camPos.distanceTo(overviewFrame.center));

  // ---- UI: stat rail -----------------------------------------------------
  var statRail = document.getElementById("stat-rail");
  var s = DATA.summary;
  statRail.innerHTML =
    stat("Distance", Math.round(s.total_dist_mi).toLocaleString(), "mi", s.total_dist_km.toLocaleString()+" km") +
    stat("Elev Gain", Math.round(s.total_gain_ft).toLocaleString(), "ft", s.total_gain_m.toLocaleString()+" m") +
    stat("High Point", Math.round(s.max_alt_ft).toLocaleString(), "ft", s.max_alt_m.toLocaleString()+" m") +
    // floor, not round, on the minutes: rounding a remainder of 3570s or more
    // renders as ":60" instead of rolling into the hour
    stat("Moving Time", Math.floor(s.moving_time_s/3600) + ":" + String(Math.floor((s.moving_time_s%3600)/60)).padStart(2,"0"), "h:mm", LEGS.length + " riding days");

  function stat(label, value, unit, sub){
    return '<div class="stat"><div class="stat-label">'+label+'</div>' +
      '<div class="stat-value">'+value+' <small>'+unit+'</small></div>' +
      '<div class="stat-label" style="margin-top:2px;color:var(--text-muted);text-transform:none;letter-spacing:0;">'+sub+'</div></div>';
  }

  // ---- UI: chip rail -------------------------------------------------------
  var chipRail = document.getElementById("chip-rail");
  var chips = {};

  var overviewChip = document.createElement("button");
  overviewChip.className = "chip active";
  overviewChip.innerHTML = '<span class="overview-icon"></span><span>Overview</span>';
  overviewChip.addEventListener("click", function(){ goOverview(); });
  chipRail.appendChild(overviewChip);

  LEGS.forEach(function(leg){
    var chip = document.createElement("button");
    chip.className = "chip";
    chip.innerHTML = '<span class="dot" style="background:'+leg.color+'"></span><span>'+leg.label+'</span>';
    chip.addEventListener("click", function(){
      if (activeLegId === leg.id){ goOverview(); }
      else { focusLeg(leg.id); }
    });
    chipRail.appendChild(chip);
    chips[leg.id] = chip;
  });

  // the chip rail was empty when the initial overview frame above was
  // computed, so its measured HUD-reserve height was too small — redo it
  // now that the day pills actually exist, snapping straight there since
  // nothing has been rendered on screen yet to animate away from
  overviewFrame = computeOverviewFrame();
  applyBottomReserve(lastFrameReserve);
  camera.position.copy(overviewFrame.camPos);
  controls.target.copy(overviewFrame.center);
  controls.update();
  scene.fog.density = fogDensityForCamDist(overviewFrame.camPos.distanceTo(overviewFrame.center));

  function setActiveChip(id){
    overviewChip.classList.toggle("active", id === null);
    LEGS.forEach(function(leg){
      chips[leg.id].classList.toggle("active", id === leg.id);
    });
  }

  // ---- UI: detail card -----------------------------------------------------
  var detailCard = document.getElementById("detail-card");

  function showDetail(leg){
    detailCard.innerHTML =
      '<div class="detail-head"><span class="detail-swatch" style="background:'+leg.color+'"></span>' +
      '<span class="detail-title">'+leg.label+'</span>' +
      '<span class="detail-date">'+leg.date+'</span></div>' +
      '<div class="detail-cols">'+leg.cols+'</div>' +
      '<div class="detail-stats">' +
      dstat("Distance", Math.round(leg.dist_mi)+" mi", leg.dist_km.toFixed(1)+" km") +
      dstat("Elev Gain", Math.round(leg.gain_ft).toLocaleString()+" ft", leg.gain_m.toLocaleString()+" m") +
      dstat("High Point", Math.round(leg.max_alt_ft).toLocaleString()+" ft", leg.max_alt_m.toLocaleString()+" m") +
      '</div>';
    detailCard.classList.add("visible");
  }
  function dstat(label, value, sub){
    return '<div><div class="detail-stat-label">'+label+'</div>' +
      '<div class="detail-stat-value">'+value+'</div>' +
      '<div class="detail-stat-label" style="text-transform:none;letter-spacing:0;">'+sub+'</div></div>';
  }
  function hideDetail(){ detailCard.classList.remove("visible"); }

  // ---- focus / overview transitions ----------------------------------------
  var activeLegId = null;
  var exagNote = document.getElementById("exag-note");

  // "scroll to zoom" / "click" describe a mouse, not a finger — swap in
  // touch-appropriate wording on devices whose primary pointer is coarse
  // (same signal used to gate the hover-reveal CSS elsewhere on the page)
  var interactionHint = document.getElementById("interaction-hint");
  if (window.matchMedia && window.matchMedia("(pointer:coarse)").matches){
    interactionHint.textContent = "drag to orbit · pinch to zoom";
  }

  function focusLeg(id){
    requestRender();
    tappedMarker = null;
    var leg = LEGS.filter(function(l){ return l.id===id; })[0];
    var b = bboxOfPts(leg.pts);
    var diag = diag2D(b);
    var altRange = Math.max(1, b.maxy-b.miny);
    var ex = clamp(0.34*diag/altRange, 3, 22);
    var radius = Math.max(diag/900, 6);

    // Rebuild this leg's group at higher fidelity/exaggeration, carrying its
    // current opacity across the swap the same way the sibling legs below
    // do. It used to be rebuilt at 0 and faded 0 -> 1 unconditionally, which
    // made the day blink out and re-appear when focused straight from the
    // overview — where it was already fully coloured and should just stay
    // put. Coming from another focused day it was sitting dimmed at 0.22, so
    // this still runs the meaningful reveal.
    var swapDelay = swapDelayFor(legGroups[id].radius, radius);
    retireGroup(legGroups[id].group, legGroups[id].ex, currentOpacity(legGroups[id].group), GEO_CROSSFADE_MS, swapDelay);
    var group = buildLegGroup(leg, ex, radius);
    setGroupOpacity(group, 0);
    scene.add(group);
    legGroups[id] = { group:group, ex:ex, radius:radius };
    updateColLabelWorldPositions(leg, ex);
    fadeOpacity(group, 0, 1, GEO_CROSSFADE_MS, null, swapDelay);

    // dim other legs — rebuild them at the same exaggeration as the
    // focused leg so their altitude scale matches and routes still join
    // up smoothly at the day boundary, instead of kinking where the
    // focused leg's custom exaggeration meets the old overview scale
    LEGS.forEach(function(l){
      if (l.id === id) return;
      var prev = legGroups[l.id];
      retireGroup(prev.group, prev.ex, currentOpacity(prev.group), GEO_CROSSFADE_MS, swapDelay);
      var og = buildLegGroup(l, ex, radius);
      setGroupOpacity(og, 0);
      scene.add(og);
      legGroups[l.id] = { group:og, ex:ex, radius:radius };
      updateColLabelWorldPositions(l, ex);
      fadeOpacity(og, 0, 0.22, GEO_CROSSFADE_MS, null, swapDelay);
    });

    // Local grid. The grid covers far more of the screen than the route does
    // (~13,500px against ~1,200), so snapping the overview grid from 0.35 to
    // 0.04 darkened most of the frame in a single step — the same
    // snap-at-departure problem as the fog, exaggeration and tube radius.
    // Cross-faded over the flight instead.
    if (focusGrid) retireGrid(focusGrid, 950);
    focusGridParams = {
      size: Math.max(b.maxx-b.minx, b.maxz-b.minz)*1.5,
      cx: (b.minx+b.maxx)/2, cz: (b.minz+b.maxz)/2
    };
    focusGrid = makeGrid(focusGridParams.size, 24, gridColors().fA, gridColors().fB);
    focusGrid.position.set(focusGridParams.cx, 0, focusGridParams.cz);
    focusGrid.material.opacity = 0;
    scene.add(focusGrid);
    fadeOpacity(focusGrid, 0, 0.35, 950);
    fadeOpacity(overviewGrid, overviewGrid.material.opacity, 0.04, 950);

    activeLegId = id;
    setActiveChip(id);
    showDetail(leg); // before framing, so its now-current content is measured for the HUD reserve

    var focusReserveFrac = hudBottomReserveFrac();
    startReserveTween(focusReserveFrac, 950);
    currentFramingBox = {
      minx:b.minx, maxx:b.maxx, minz:b.minz, maxz:b.maxz,
      miny:b.miny*ex, maxy:b.maxy*ex
    };
    var frame = frameBox(currentFramingBox, focusReserveFrac);
    // Neither fog density nor the exaggeration is applied here. Both belong
    // to the destination and have to travel with the camera instead of
    // snapping at the start; animate() drives them over the same 950ms and
    // lands on exactly this frame's values.
    flyTo(frame.camPos, frame.center, 950);
    startExTween(ex, 950);

    exagNote.textContent = "elevation exaggerated ×" + Math.round(ex);
  }

  function goOverview(){
    requestRender();
    tappedMarker = null;
    hideDetail(); // before re-measuring the HUD reserve, so its (stale, now-hidden) content doesn't count
    LEGS.forEach(function(leg){
      var cur = legGroups[leg.id];
      // capture before the rebuild: afterwards legGroups[].radius is already
      // OVERVIEW_RADIUS, and comparing it against itself yields no delay
      var swapDelay = swapDelayFor(cur.radius, OVERVIEW_RADIUS);
      if (Math.abs(cur.ex - OVERVIEW_EX) > 0.01 || cur.radius !== OVERVIEW_RADIUS){
        retireGroup(cur.group, cur.ex, currentOpacity(cur.group), GEO_CROSSFADE_MS, swapDelay);
        var group = buildLegGroup(leg, OVERVIEW_EX, OVERVIEW_RADIUS);
        setGroupOpacity(group, 0);
        scene.add(group);
        legGroups[leg.id] = { group:group, ex:OVERVIEW_EX, radius:OVERVIEW_RADIUS };
        updateColLabelWorldPositions(leg, OVERVIEW_EX);
      }
      fadeOpacity(legGroups[leg.id].group, currentOpacity(legGroups[leg.id].group), 1, GEO_CROSSFADE_MS,
        null, swapDelay);
    });
    if (focusGrid){ retireGrid(focusGrid, 950); focusGrid = null; focusGridParams = null; }
    fadeOpacity(overviewGrid, overviewGrid.material.opacity, 0.35, 950);

    overviewFrame = computeOverviewFrame();
    startReserveTween(lastFrameReserve, 950);
    // same as focusLeg: animate() carries the fog and the exaggeration out
    // with the camera rather than snapping them while it's still zoomed in
    flyTo(overviewFrame.camPos, overviewFrame.center, 950);
    startExTween(OVERVIEW_EX, 950);
    activeLegId = null;
    setActiveChip(null);
    exagNote.textContent = "elevation exaggerated ×" + Math.round(OVERVIEW_EX);
  }

  function currentOpacity(group){
    var op = 1;
    group.traverse(function(o){ if (o.material){ op = o.material.opacity; } });
    return op;
  }

  var fadeTweens = [];
  // `delay` simply pushes t0 into the future — animate() clamps negative
  // progress to 0, so the group just holds `from` until the delay elapses
  function fadeOpacity(group, from, to, duration, onDone, delay){
    fadeTweens = fadeTweens.filter(function(f){ return f.group !== group; });
    fadeTweens.push({ group:group, from:from, to:to,
      t0:performance.now() + (delay||0), duration:duration, onDone:onDone });
  }

  // ---- animation loop --------------------------------------------------------
  // Renders on demand rather than every frame. Nothing here is animated by
  // default — no auto-rotate, no shader that evolves with time — so once the
  // camera has settled the scene is completely static, and redrawing it 60
  // times a second was burning CPU and GPU to produce an identical image.
  // That is not free: at devicePixelRatio 3 the buffer is 2.45 MP, and the
  // per-frame label pass also does a full DOM read/write cycle.
  //
  // Anything that changes what is on screen must call requestRender(). The
  // failure mode for forgetting is a stale frame, so the list of callers is
  // deliberately short: the tweens below, OrbitControls' own change event
  // (which covers all drag/zoom/damping), pointer moves that can re-target a
  // hover label, viewport changes, and the webfont finishing loading.
  var needsRender = true;
  function requestRender(){ needsRender = true; }

  // Whether the camera has drifted far enough since the last drawn frame to
  // be worth redrawing, measured in approximate screen pixels.
  //
  // OrbitControls.update() already returns a "did it move" flag, but it is
  // useless here: it compares against an absolute EPS of 1e-6 while this
  // scene spans hundreds of thousands of world units, so a damped delta
  // decaying geometrically stays above that threshold essentially forever.
  // Trusting it left the page rendering indefinitely after every drag, which
  // is the whole problem this is meant to solve.
  //
  // Comparing against the last *drawn* state rather than the last frame is
  // what makes this converge: a slow drift accumulates until it is worth a
  // frame, and once the damping tail's entire remaining travel is below the
  // threshold, no further frame is ever drawn.
  var lastDrawnPos = new THREE.Vector3(), lastDrawnTarget = new THREE.Vector3();
  var haveDrawn = false;

  function cameraMovedVisibly(){
    if (!haveDrawn) return true;
    var moved = camera.position.distanceTo(lastDrawnPos) +
                controls.target.distanceTo(lastDrawnTarget);
    if (moved === 0) return false;
    var camDist = Math.max(camera.position.distanceTo(controls.target), 1);
    var vFov = camera.fov * Math.PI / 180;
    // 1/20th of a pixel. Raising this to a quarter pixel was tried and
    // changed nothing measurable — the damping tail is real motion, not an
    // artefact of the threshold — so the more conservative value stays.
    return (moved / camDist) * (vpH() / vFov) > 0.05;
  }
  controls.addEventListener("change", requestRender);
  if (document.fonts && document.fonts.ready){
    // a font swap changes label widths, and so the collision layout
    document.fonts.ready.then(requestRender);
  }

  function animate(now){
    requestAnimationFrame(animate);

    // set by any tween that is mid-flight this frame, so the loop keeps
    // drawing until everything has settled
    var animating = false;

    if (tweenState){
      animating = true;
      var t = (now - tweenState.t0) / tweenState.duration;
      if (t >= 1){
        camera.position.copy(tweenState.toPos);
        controls.target.copy(tweenState.toTarget);
        tweenState = null;
      } else {
        var e = easeInOutCubic(clamp(t,0,1));
        camera.position.lerpVectors(tweenState.fromPos, tweenState.toPos, e);
        controls.target.lerpVectors(tweenState.fromTarget, tweenState.toTarget, e);
      }
      // Fog travels with the camera. fogDensityForCamDist() returns a density
      // calibrated so density x distance lands around 0.6 at the framing
      // distance it's given, so applying the *destination* density while the
      // camera is still at overview range (roughly 5x further out) puts that
      // product near 3 — and FogExp2 squares it, fogging the route ~100% into
      // the background colour. That read as the day's segment starting black
      // and fading in over the whole flight. Deriving it from where the
      // camera actually is each frame starts at the current correct value and
      // lands exactly on the destination one.
      scene.fog.density = fogDensityForCamDist(camera.position.distanceTo(controls.target));
    }

    if (reserveTween){
      animating = true;
      var rt = clamp((now - reserveTween.t0) / reserveTween.duration, 0, 1);
      applyBottomReserve(reserveTween.from + (reserveTween.to - reserveTween.from) * easeInOutCubic(rt));
      if (rt >= 1) reserveTween = null;
    }

    if (exTween){
      animating = true;
      var et = clamp((now - exTween.t0) / exTween.duration, 0, 1);
      applyDisplayEx(exTween.from + (exTween.to - exTween.from) * easeInOutCubic(et));
      if (et >= 1){
        applyDisplayEx(exTween.to);   // land exactly, so scale.y is exactly 1
        exTween = null;
      }
    }

    if (fadeTweens.length){
      animating = true;
      fadeTweens = fadeTweens.filter(function(f){
        var t = clamp((now - f.t0) / f.duration, 0, 1);
        var op = f.from + (f.to - f.from) * t;
        setGroupOpacity(f.group, op);
        if (t >= 1 && f.onDone) f.onDone();   // retired geometry disposes here
        return t < 1;
      });
    }

    // Must run every frame regardless: this is what applies damping.
    // Its return value is deliberately ignored — see cameraMovedVisibly().
    controls.update();

    if (!animating && !needsRender && !cameraMovedVisibly()) return;
    needsRender = false;

    // OrbitControls only moves the camera object; matrixWorldInverse (what
    // Vector3.project relies on) isn't recomputed until the camera is
    // rendered, which happens *after* the label projection below. Without
    // this, labels/leader-lines project using last frame's camera and lag
    // a frame behind the actual 3D balls while dragging.
    camera.updateMatrixWorld();
    updateColLabelScreenPositions();
    renderer.render(scene, camera);

    lastDrawnPos.copy(camera.position);
    lastDrawnTarget.copy(controls.target);
    haveDrawn = true;
  }
  requestAnimationFrame(animate);

  // candidate label-center offsets from its anchor ball: rings of increasing
  // radius so tightly clustered cols (e.g. the Bonette massif) keep pushing
  // outward until they clear each other, rather than piling onto one spot
  var LABEL_CANDIDATES = (function(){
    var list = [];
    var radii = [26,42,60,80,102,126,152,180,215,255];
    var perRing = [6,8,10,12,14,14,16,16,18,20];
    for (var ri=0; ri<radii.length; ri++){
      var r = radii[ri], n = perRing[ri];
      for (var k=0; k<n; k++){
        var deg = -90 + k*(360/n); // start pointing straight up, sweep clockwise
        var rad = deg*Math.PI/180;
        list.push([r*Math.cos(rad), r*Math.sin(rad)]);
      }
    }
    return list;
  })();
  var LABEL_PAD = 3, PATH_CLEARANCE = 7;

  function boxesOverlap(a,b,margin){
    return !(a.cx+a.hw+margin < b.cx-b.hw || a.cx-a.hw-margin > b.cx+b.hw ||
             a.cy+a.hh+margin < b.cy-b.hh || a.cy-a.hh-margin > b.cy+b.hh);
  }
  function boxOverlapsPath(box, pathPts, clearance){
    var bx0=box.cx-box.hw-clearance, bx1=box.cx+box.hw+clearance;
    var by0=box.cy-box.hh-clearance, by1=box.cy+box.hh+clearance;
    for (var i=0;i<pathPts.length;i++){
      var p = pathPts[i];
      if (!p) continue;
      if (p[0]>=bx0 && p[0]<=bx1 && p[1]>=by0 && p[1]<=by1) return true;
    }
    return false;
  }
  function boxInViewport(box, vw, vh, margin){
    return box.cx-box.hw >= margin && box.cx+box.hw <= vw-margin &&
           box.cy-box.hh >= margin && box.cy+box.hh <= vh-margin;
  }
  function boxOverlapsSegment(box, x1,y1,x2,y2, clearance){
    var bx0=box.cx-box.hw-clearance, bx1=box.cx+box.hw+clearance;
    var by0=box.cy-box.hh-clearance, by1=box.cy+box.hh+clearance;
    var steps = 12;
    for (var i=0;i<=steps;i++){
      var t = i/steps, x = x1+(x2-x1)*t, y = y1+(y2-y1)*t;
      if (x>=bx0 && x<=bx1 && y>=by0 && y<=by1) return true;
    }
    return false;
  }
  function segmentsIntersect(ax,ay,bx,by,cx,cy,dx,dy){
    var d1 = (dx-cx)*(ay-cy) - (dy-cy)*(ax-cx);
    var d2 = (dx-cx)*(by-cy) - (dy-cy)*(bx-cx);
    var d3 = (bx-ax)*(cy-ay) - (by-ay)*(cx-ax);
    var d4 = (bx-ax)*(dy-ay) - (by-ay)*(dx-ax);
    return ((d1>0&&d2<0)||(d1<0&&d2>0)) && ((d3>0&&d4<0)||(d3<0&&d4>0));
  }
  // point where the segment from (cx,cy) toward (tx,ty) exits the box —
  // used so the leader line touches the label's edge, not its middle
  function boxEdgeToward(cx,cy,hw,hh,tx,ty){
    var dx=tx-cx, dy=ty-cy;
    if (dx===0 && dy===0) return [cx,cy];
    var t = Math.min(dx!==0 ? hw/Math.abs(dx) : Infinity, dy!==0 ? hh/Math.abs(dy) : Infinity);
    return [cx+dx*t, cy+dy*t];
  }

  function projectToScreen(worldPos, halfW, halfH){
    var v = worldPos.clone().project(camera);
    return { x: v.x*halfW+halfW, y: -v.y*halfH+halfH, behind: (v.z<-1 || v.z>1) };
  }

  // col labels only show for the currently focused day, to keep the
  // overview (26 cols across 7 days) from turning into text soup
  // fixed HUD chrome (title block, stat tiles, detail card, day chips) that
  // labels must dodge too — otherwise one can land under an opaque panel
  // and just disappear, as "Nice" did behind the day-7 detail card
  var hudObstacleEls = [
    document.querySelector(".masthead"),
    document.getElementById("stat-rail"),
    document.getElementById("detail-card"),
    document.getElementById("chip-rail")
  ].filter(Boolean);

  function getHudObstacleBoxes(){
    var boxes = [];
    hudObstacleEls.forEach(function(el){
      if (el.id === "detail-card" && !el.classList.contains("visible")) return;
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      boxes.push({ cx:r.left+r.width/2, cy:r.top+r.height/2, hw:r.width/2, hh:r.height/2 });
    });
    return boxes;
  }

  function updateColLabelScreenPositions(){
    var halfW = vpW()/2, halfH = vpH()/2;
    var hudBoxes = getHudObstacleBoxes();

    // in the overview (no day focused), hovering a col's marker labels
    // just that one col, instead of the usual "labels only for the
    // focused day" rule — lets you identify any col without focusing it.
    // Falls back to tappedMarker (set by the pointerup handler above) for
    // touch, which never produces a real hover.
    var hoveredMarker = null;
    if (activeLegId === null){
      var bestDist = HOVER_RADIUS;
      LEGS.forEach(function(leg){
        colLabels[leg.id].forEach(function(l, idx){
          var sp = projectToScreen(l.worldPos, halfW, halfH);
          if (sp.behind) return;
          var d = Math.hypot(sp.x - hoverMouseX, sp.y - hoverMouseY);
          if (d <= bestDist){ bestDist = d; hoveredMarker = { legId: leg.id, idx: idx }; }
        });
      });
      if (!hoveredMarker) hoveredMarker = tappedMarker;
    }

    LEGS.forEach(function(leg){
      var isActive = (activeLegId === leg.id);
      var groupOpacity = isActive ? currentOpacity(legGroups[leg.id].group) : 0;
      var labels = colLabels[leg.id];
      var hoverIdx = (!isActive && hoveredMarker && hoveredMarker.legId === leg.id) ? hoveredMarker.idx : -1;

      if (groupOpacity <= 0.02 && hoverIdx < 0){
        labels.forEach(function(l){
          if (l.el.style.opacity !== "0"){
            l.el.style.opacity = 0; l.line.style.opacity = 0; l.dot.style.opacity = 0;
            l.el.style.pointerEvents = "none";
            l.el.classList.remove("tap-active");
            if (tapActiveLabel === l.el) tapActiveLabel = null;
          }
        });
        return;
      }

      // project this leg's path to screen space, for label/path collision checks
      // displayEx, not the leg's baked ex: mid-transition the mesh is being
      // carried by scale.y, so the baked value isn't where the route is drawn
      var renderEx = displayEx;
      var pathScreen = leg.pts.map(function(p){
        if (p === null) return null;
        var sp = projectToScreen(new THREE.Vector3(p[0], p[1]*renderEx, p[2]), halfW, halfH);
        return sp.behind ? null : [sp.x, sp.y];
      });

      var placedBoxes = hudBoxes.slice();
      var placedLines = [];
      labels.forEach(function(l, labelIdx){
        if (!isActive && labelIdx !== hoverIdx){
          if (l.el.style.opacity !== "0"){
            l.el.style.opacity = 0; l.line.style.opacity = 0; l.dot.style.opacity = 0;
            l.el.style.pointerEvents = "none";
            l.el.classList.remove("tap-active");
            if (tapActiveLabel === l.el) tapActiveLabel = null;
          }
          return;
        }
        var labelOpacity = isActive ? groupOpacity : 1;
        var sp = projectToScreen(l.worldPos, halfW, halfH);
        if (sp.behind){
          l.el.style.opacity = 0; l.line.style.opacity = 0; l.dot.style.opacity = 0;
          l.el.style.pointerEvents = "none";
          l.el.classList.remove("tap-active");
          if (tapActiveLabel === l.el) tapActiveLabel = null;
          return;
        }
        l.ax = sp.x; l.ay = sp.y;
        l.el.style.pointerEvents = "auto";

        // re-measure live rather than trust the size cached at creation —
        // sandboxed frames don't reliably signal when the custom webfont
        // has swapped in, and a stale (too-narrow) box lets labels overlap.
        // Safe to do unconditionally: the hover-revealed elevation text is
        // position:absolute (see .col-label-alt), so it's never part of
        // this element's own layout box and can't perturb this measurement.
        var liveRect = l.el.getBoundingClientRect();
        if (liveRect.width > 0) { l.w = liveRect.width; l.h = liveRect.height; }

        var hw = l.w/2 + LABEL_PAD, hh = l.h/2 + LABEL_PAD;
        var vw = halfW*2, vh = halfH*2;

        // Score every candidate ring position and keep the best, rather
        // than a fixed pass order that can exhaust its search (dense
        // clusters) and fall through to a completely unchecked placement.
        // A box overlapping another box/line, or a line piercing a box,
        // makes text unreadable — heavily penalized. A crossed line or a
        // line grazing the path is only cosmetic — penalized lightly so
        // it's still preferred over the unreadable cases, but yields to a
        // perfect (score 0) spot if one exists.
        var chosen = null, bestScore = Infinity;
        for (var c=0; c<LABEL_CANDIDATES.length && bestScore>0; c++){
          var cx = l.ax + LABEL_CANDIDATES[c][0], cy = l.ay + LABEL_CANDIDATES[c][1];
          var box = { cx:cx, cy:cy, hw:hw, hh:hh };
          if (!boxInViewport(box, vw, vh, 4)) continue;
          // scoring-only: the leader line actually drawn is recomputed below
          // against the label's real size, not this padded collision box
          var candEdge = boxEdgeToward(cx,cy,hw,hh,l.ax,l.ay);
          var score = 0;
          if (placedBoxes.some(function(b){ return boxesOverlap(box,b,4); })) score += 1000;
          if (placedLines.some(function(ln){ return boxOverlapsSegment(box, ln.x1,ln.y1,ln.x2,ln.y2, PATH_CLEARANCE); })) score += 1000;
          if (placedBoxes.some(function(b){ return boxOverlapsSegment(b, l.ax,l.ay,candEdge[0],candEdge[1], PATH_CLEARANCE); })) score += 1000;
          if (placedLines.some(function(ln){ return segmentsIntersect(l.ax,l.ay,candEdge[0],candEdge[1], ln.x1,ln.y1,ln.x2,ln.y2); })) score += 10;
          if (boxOverlapsPath(box, pathScreen, PATH_CLEARANCE)) score += 1;
          if (score < bestScore){ bestScore = score; chosen = box; }
        }
        if (!chosen){
          var fx = LABEL_CANDIDATES[0];
          chosen = { cx:l.ax+fx[0], cy:l.ay+fx[1], hw:hw, hh:hh };
        }
        // last-resort safety net: never let a label render partly off-screen
        chosen.cx = Math.min(Math.max(chosen.cx, hw+4), vw-hw-4);
        chosen.cy = Math.min(Math.max(chosen.cy, hh+4), vh-hh-4);
        placedBoxes.push(chosen);
        l.cx = chosen.cx; l.cy = chosen.cy;

        l.el.style.transform = "translate(-50%,-50%) translate(" + chosen.cx.toFixed(1) + "px," + chosen.cy.toFixed(1) + "px)";
        l.el.style.opacity = labelOpacity;

        // the scoring pass worked against the padded collision box
        // (LABEL_PAD bigger than the label so neighbors keep a margin) —
        // recompute against the label's actual rendered size so the line
        // reaches its edge exactly
        var edge = boxEdgeToward(chosen.cx, chosen.cy, l.w/2, l.h/2, l.ax, l.ay);
        l.line.setAttribute("x1", l.ax); l.line.setAttribute("y1", l.ay);
        l.line.setAttribute("x2", edge[0]); l.line.setAttribute("y2", edge[1]);
        l.line.style.opacity = labelOpacity;
        l.dot.setAttribute("cx", l.ax); l.dot.setAttribute("cy", l.ay);
        l.dot.style.opacity = labelOpacity;
        placedLines.push({ x1:l.ax, y1:l.ay, x2:edge[0], y2:edge[1] });
      });
    });
  }

  // ---- resize ----------------------------------------------------------------
  // A viewport change moves both things the framing depends on: the aspect
  // ratio, and (a lot, on phones) how much height the bottom HUD takes. Only
  // patching camera.aspect left the camera at a distance computed for the old
  // shape, so rotating to landscape clipped the route off both sides. Refit
  // against whatever is currently framed instead, keeping the direction the
  // user has orbited to so dragging a window edge doesn't reset their view.
  var framedOnce = vpValid();

  function onViewportChange(){
    requestRender();
    var w = vpW(), h = vpH();
    camera.aspect = w / h;
    renderer.setPixelRatio(window.devicePixelRatio||1);
    renderer.setSize(w, h);
    camera.updateProjectionMatrix();

    if (!vpValid() || !currentFramingBox) return;

    var reserve = hudBottomReserveFrac();
    applyBottomReserve(reserve);
    reserveTween = null;

    // Only inherit the current orbit direction when it came from a framing
    // done at a real viewport size — after a zero-sized load it's the
    // placeholder 1x1 framing and worth discarding. Mid-fly-to it's a
    // transient angle, so let the canonical direction win and just retarget
    // the tween rather than snapping out from under it.
    var dir = null;
    if (framedOnce && !tweenState){
      var d = camera.position.clone().sub(controls.target);
      if (isFinite(d.x) && isFinite(d.y) && isFinite(d.z) && d.lengthSq() > 1e-6) dir = d;
    }

    var frame = frameBox(currentFramingBox, reserve, dir);
    if (tweenState){
      tweenState.toPos = frame.camPos.clone();
      tweenState.toTarget = frame.center.clone();
    } else {
      camera.position.copy(frame.camPos);
      controls.target.copy(frame.center);
      controls.update();
    }
    scene.fog.density = fogDensityForCamDist(frame.camPos.distanceTo(frame.center));
    framedOnce = true;
  }

  window.addEventListener("resize", onViewportChange);
  // a window resize alone misses a container that gains size while the window
  // stays put — which is exactly the hidden/zero-sized-at-load case that used
  // to strand the camera at NaN
  if (window.ResizeObserver){
    new ResizeObserver(onViewportChange).observe(container);
  }

  // ---- theme toggle --------------------------------------------------------
  // index.html's inline head script already set data-theme (if an explicit
  // choice was stored) before style.css was even fetched, so the CSS side is
  // already correct by the time this runs — this just wires up the buttons
  // and keeps the Three.js scene (bg/fog/grids) in sync with future changes.
  var THEME_KEY = "raidalps-theme";
  var themeToggle = document.getElementById("theme-toggle");
  var themeButtons = themeToggle ? Array.prototype.slice.call(themeToggle.querySelectorAll("[data-theme-choice]")) : [];

  function storedTheme(){
    try { return localStorage.getItem(THEME_KEY); } catch(e){ return null; }
  }
  function setStoredTheme(choice){
    try {
      if (choice === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, choice);
    } catch(e){}
  }
  function updateThemeButtons(){
    var choice = storedTheme() || "system";
    themeButtons.forEach(function(b){
      b.classList.toggle("active", b.getAttribute("data-theme-choice") === choice);
    });
  }
  function selectTheme(choice){
    setStoredTheme(choice);
    if (choice === "light" || choice === "dark") document.documentElement.setAttribute("data-theme", choice);
    else document.documentElement.removeAttribute("data-theme");
    updateThemeButtons();
    applyThemeToScene();
  }
  themeButtons.forEach(function(btn){
    btn.addEventListener("click", function(){ selectTheme(btn.getAttribute("data-theme-choice")); });
  });
  updateThemeButtons();

  // only live-updates while "system" is in effect — an explicit choice
  // already overrides the media query in CSS and shouldn't react to it
  if (window.matchMedia){
    window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", function(){
      if (!storedTheme()) applyThemeToScene();
    });
  }

  // ---- init note ---------------------------------------------------------
  exagNote.textContent = "elevation exaggerated ×" + Math.round(OVERVIEW_EX);

  var loading = document.getElementById("loading");
  if (loading){
    loading.style.opacity = "0";
    setTimeout(function(){ loading.style.display = "none"; }, 420);
  }
})();

