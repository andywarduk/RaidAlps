#!/usr/bin/env python3
"""One-time extraction: splits the current bundled index.html into src/*.

Run once to bootstrap the split-source layout from a known-good bundled
index.html. After this, tools/build.py (the reverse direction) is the
ongoing workflow tool — this script is not part of the normal loop.
"""
import base64
import re

with open("index.html", encoding="utf-8") as f:
    content = f.read()
lines = content.split("\n")

def join(a, b):  # 1-indexed inclusive line range -> text
    return "\n".join(lines[a - 1:b])

# ---- locate the structural boundaries (see AGENTS.md map) -----------------
style_start = next(i for i, l in enumerate(lines, 1) if l == "<style>")
style_end = next(i for i, l in enumerate(lines, 1) if l == "</style>")
script_tags = [i for i, l in enumerate(lines, 1) if l == "<script>"]
close_tags = [i for i, l in enumerate(lines, 1) if l == "</script>"]
assert len(script_tags) == 3, script_tags
assert len(close_tags) == 3, close_tags
vendor_three_start, orbit_start, app_start = script_tags
vendor_three_end, orbit_end, app_end = close_tags

body_start = style_end + 1
body_end = vendor_three_start - 1
route_line = next(i for i in range(orbit_end + 1, app_start)
                   if lines[i - 1].startswith("<script>window.ROUTE_DATA"))

print("style:", style_start, style_end)
print("body markup:", body_start, body_end)
print("vendor three.js:", vendor_three_start, vendor_three_end)
print("orbit controls:", orbit_start, orbit_end)
print("route data line:", route_line)
print("app script:", app_start, app_end)

# ---- CSS + fonts ------------------------------------------------------------
css = join(style_start + 1, style_end - 1)

font_specs = [
    ("Bebas", "400", "bebas-400"),
    ("JBMono", "400", "jbmono-400"),
    ("JBMono", "600", "jbmono-600"),
]
font_pattern = re.compile(
    r'@font-face\{\s*font-family:"([^"]+)";\s*'
    r'src:url\(data:font/woff2;base64,([A-Za-z0-9+/=]+)\)\s*format\("woff2"\);\s*'
    r'font-weight:(\d+);[^}]*\}',
)
matches = list(font_pattern.finditer(css))
assert len(matches) == 3, f"expected 3 @font-face blocks, found {len(matches)}"

new_css = css
for m, (family, weight, fname) in zip(matches, font_specs):
    assert m.group(1) == family and m.group(3) == weight, (m.group(1), m.group(3), family, weight)
    b64 = m.group(2)
    with open(f"src/fonts/{fname}.woff2", "wb") as f:
        f.write(base64.b64decode(b64))
    print(f"wrote src/fonts/{fname}.woff2 ({len(base64.b64decode(b64))} bytes)")

# replace each matched block with a version pointing at the real font file,
# working right-to-left so earlier offsets stay valid
for m, (family, weight, fname) in zip(reversed(matches), reversed(font_specs)):
    replacement = (
        '@font-face{\n'
        f'  font-family:"{family}";\n'
        f'  src:url("fonts/{fname}.woff2") format("woff2");\n'
        f'  font-weight:{weight};\n'
        '  font-style:normal;\n'
        '  font-display:swap;\n'
        '}'
    )
    new_css = new_css[:m.start()] + replacement + new_css[m.end():]

with open("src/style.css", "w", encoding="utf-8") as f:
    f.write(new_css + "\n")
print("wrote src/style.css")

# ---- body markup --------------------------------------------------------
body_markup = join(body_start, body_end)

# ---- vendor JS ------------------------------------------------------------
three_js = join(vendor_three_start + 1, vendor_three_end - 1)
with open("src/vendor/three.min.js", "w", encoding="utf-8") as f:
    f.write(three_js + "\n")
print("wrote src/vendor/three.min.js", len(three_js), "bytes")

orbit_js = join(orbit_start + 1, orbit_end - 1)
with open("src/vendor/OrbitControls.js", "w", encoding="utf-8") as f:
    f.write(orbit_js + "\n")
print("wrote src/vendor/OrbitControls.js", len(orbit_js), "bytes")

# ---- route data ------------------------------------------------------------
route_line_text = lines[route_line - 1]
prefix = "<script>"
suffix = "</script>"
assert route_line_text.startswith(prefix) and route_line_text.endswith(suffix)
route_js = route_line_text[len(prefix):-len(suffix)]
assert route_js.startswith("window.ROUTE_DATA = ") and route_js.endswith(";")
with open("src/data/route-data.js", "w", encoding="utf-8") as f:
    f.write(route_js + "\n")
print("wrote src/data/route-data.js", len(route_js), "bytes")

# ---- app script ------------------------------------------------------------
app_js = join(app_start + 1, app_end - 1)
with open("src/app.js", "w", encoding="utf-8") as f:
    f.write(app_js + "\n")
print("wrote src/app.js", len(app_js), "bytes")

# ---- skeleton index.html --------------------------------------------------
skeleton = f"""{join(1, 3)}
<link rel="stylesheet" href="style.css">
{body_markup}
<script src="vendor/three.min.js"></script>
<script src="vendor/OrbitControls.js"></script>
<script src="data/route-data.js"></script>
<script src="app.js"></script>
"""
with open("src/index.html", "w", encoding="utf-8") as f:
    f.write(skeleton)
print("wrote src/index.html")
