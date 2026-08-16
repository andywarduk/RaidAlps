#!/usr/bin/env python3
"""Builds two deployable outputs from src/, both under build/.

  build/artifact/index.html  — single self-contained file, CSS/vendor JS/
    fonts/route data all inlined. Claude Artifacts (how this app is also
    published/hosted) enforce a strict CSP that blocks requests to any
    other file, even same-origin, so this is what gets passed to the
    Artifact tool.
  build/webserver.tgz        — src/ as a normal multi-file static site
    (real HTTP requests, no inlining), tarred+gzipped for dropping
    straight onto a real webserver's document root.

src/ is the actual editable source (plain CSS/JS files, a normal skeleton
HTML, real font files) either way. Run this after any change under src/,
before committing or publishing.

Usage:
    python3 tools/build.py
"""
import base64
import re
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
BUILD = ROOT / "build"


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


def strip_wrapper(html):
    # src/index.html is a proper document (<!DOCTYPE>, <html>, <head>,
    # <body>) for a clean standalone dev experience. The bundled index.html
    # is published as a Claude Artifact, which supplies its own
    # <!doctype html>...<head>...<body> wrapper at publish time and expects
    # a bare content fragment — submitting one of our own risks duplicate/
    # nested tags. So the wrapper only ever exists in src/; strip it back
    # out here rather than duplicating the skeleton in two places.
    wrapper_lines = [
        '<!DOCTYPE html>\n', '<html lang="en">\n', '<head>\n',
        '</head>\n', '<body>\n', '</body>\n', '</html>\n',
    ]
    for tag in wrapper_lines:
        if tag not in html:
            raise SystemExit(f"src/index.html is missing expected wrapper line: {tag!r}")
        html = html.replace(tag, "", 1)
    return html


def main():
    skeleton = strip_wrapper(read("index.html"))
    css = inline_fonts(read("style.css"))
    three_js = read("vendor/three.min.js").rstrip("\n")
    orbit_js = read("vendor/OrbitControls.js").rstrip("\n")
    route_js = read("data/route-data.js").rstrip("\n")
    app_js = read("app.js").rstrip("\n")

    replacements = [
        # src/favicon.svg is a real file, served as such by GitHub Pages and
        # by the webserver tarball (both of which keep a real <head>). The
        # Artifact build drops the link instead of inlining it as a data URI:
        # the Artifact tool supplies its own favicon via its `favicon:`
        # parameter (🚵, documented in AGENTS.md as never changing), and a
        # second icon declaration in the bundle would be competing with it.
        ('<link rel="icon" type="image/svg+xml" href="images/favicon.svg">\n', ""),
        ('<link rel="apple-touch-icon" href="images/apple-touch-icon.png">\n', ""),
        # the manifest and its icons are separate files the Artifact bundle
        # cannot fetch (single file, strict CSP), so drop the link there too
        ('<link rel="manifest" href="site.webmanifest">\n', ""),
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

    artifact_dir = BUILD / "artifact"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    out_path = artifact_dir / "index.html"
    out_path.write_text(out, encoding="utf-8")
    print(f"wrote {out_path} ({len(out):,} bytes)")

    webserver_tgz(BUILD / "webserver.tgz")


def webserver_tgz(out_path):
    # arcname=file.relative_to(SRC) so the archive's paths are rooted at
    # src/'s contents directly (index.html, style.css, ...) rather than
    # nested under a "src/" directory — extract onto a webserver's
    # document root and it's ready to serve as-is.
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(out_path, "w:gz") as tar:
        for file in sorted(SRC.rglob("*")):
            if not file.is_file():
                continue
            # Skip dotfiles. rglob picks them up, so a scratch probe left in
            # src/ (.probe.html and friends are a handy debugging pattern here)
            # would otherwise be silently tarred up and shipped.
            if any(part.startswith(".") for part in file.relative_to(SRC).parts):
                continue
            tar.add(file, arcname=file.relative_to(SRC))
    print(f"wrote {out_path} ({out_path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
