#!/usr/bin/env python3
"""Bundles src/* into the single self-contained index.html at repo root.

Claude Artifacts (how this app is published/hosted) enforce a strict CSP
that blocks requests to any other file, even same-origin — so the
published page has to be one file with CSS, vendor JS, fonts, and the
route dataset all inlined. src/ is the actual editable source (plain
CSS/JS files, a normal skeleton HTML, real font files); this script does
the inlining. Run it after any change under src/, before publishing.

Usage:
    python3 tools/build.py
"""
import base64
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"


def read(rel_path):
    return (SRC / rel_path).read_text(encoding="utf-8")


def inline_fonts(css):
    def replace(m):
        rel_path = m.group(1)
        data = (SRC / rel_path).read_bytes()
        b64 = base64.b64encode(data).decode("ascii")
        return f'url(data:font/woff2;base64,{b64}) format("woff2")'
    new_css, count = re.subn(
        r'url\("(fonts/[^"]+\.woff2)"\)\s*format\("woff2"\)', replace, css
    )
    expected = len(re.findall(r"@font-face", css))
    if count != expected:
        raise SystemExit(
            f"inlined {count} font url()s but found {expected} @font-face blocks — "
            "check src/style.css font syntax matches what this script expects"
        )
    return new_css


def main():
    skeleton = read("index.html")
    css = inline_fonts(read("style.css"))
    three_js = read("vendor/three.min.js").rstrip("\n")
    orbit_js = read("vendor/OrbitControls.js").rstrip("\n")
    route_js = read("data/route-data.js").rstrip("\n")
    app_js = read("app.js").rstrip("\n")

    replacements = [
        ('<link rel="stylesheet" href="style.css">', f"<style>\n{css}</style>"),
        ('<script src="vendor/three.min.js"></script>', f"<script>\n{three_js}\n</script>"),
        ('<script src="vendor/OrbitControls.js"></script>', f"<script>\n{orbit_js}\n</script>"),
        ('<script src="data/route-data.js"></script>', f"<script>{route_js}</script>"),
        ('<script src="app.js"></script>', f"<script>\n{app_js}\n</script>"),
    ]

    out = skeleton
    for needle, replacement in replacements:
        if needle not in out:
            raise SystemExit(f"src/index.html is missing expected tag: {needle!r}")
        out = out.replace(needle, replacement, 1)

    out_path = ROOT / "index.html"
    out_path.write_text(out, encoding="utf-8")
    print(f"wrote {out_path} ({len(out):,} bytes)")


if __name__ == "__main__":
    main()
