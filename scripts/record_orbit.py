#!/usr/bin/env python3
"""Record the README's 3D preview: a 6-second looping orbit of the War Room as animated WebP.

The README cannot run JavaScript, so CI flies a camera in front of the city with headless
Chromium, grabs every frame and assembles dist/orbit-{light,dark}.webp (each at most 2.5 MB),
which ships to the `output` branch next to the SVGs. The page is served from the staged site/
(it needs stats.json and battlefield-*.svg, which CI copies in) on a free localhost port.

The camera path is a pure function of the frame number, so two runs agree: azimuth swings
-35 to +35 degrees and back on a cosine ease (the first and last frames are the same pose,
so the loop is seamless) while the elevation breathes by a few degrees.

Pillow and Playwright are CI-only dependencies: locally the script explains what is missing
and exits 2. Files are written atomically, so a failed run never damages an earlier recording.
"""
from __future__ import annotations

import argparse
import base64
import functools
import http.server
import io
import math
import os
import sys
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import check  # noqa: E402  (the same WebP policy CI enforces on dist/orbit-*.webp)

W, H = 840, 420
MAX_BYTES = check.MAX_ORBIT_BYTES
AZIMUTH_SWING = 35.0   # degrees either side of the Front pose
ELEVATION_SWING = 4.0  # degrees of gentle rise and fall
# CI has no GPU: software WebGL (SwiftShader through ANGLE) renders the scene, slowly but identically.
SOFTWARE_GL = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
QUALITIES = (82, 74, 66, 58, 50, 42, 34, 26)


def pose_at(index: int, count: int) -> tuple[float, float]:
    """(azimuth offset, elevation offset) in degrees for frame `index` of a `count`-frame loop."""
    t = index / count
    ease = 0.5 - 0.5 * math.cos(2 * math.pi * t)  # 0 -> 1 -> 0, smooth at both ends
    return -AZIMUTH_SWING + 2 * AZIMUTH_SWING * ease, ELEVATION_SWING * math.sin(2 * math.pi * t)


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript", ".svg": "image/svg+xml", ".webp": "image/webp"}

    def log_message(self, *args) -> None:
        pass

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def serve(directory: Path) -> tuple[http.server.ThreadingHTTPServer, int]:
    handler = functools.partial(QuietHandler, directory=str(directory))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, server.server_address[1]


# Runs in the page. Orbits the camera about its own target, starting from wherever the scene's current
# (Front) pose is, so the arc stays in front of the city whatever the preset geometry is.
ORBIT_JS = """([azOffset, elOffset]) => {
  const scene = window.__atlas && window.__atlas.scene;
  if (!scene) return 'no scene';
  if (!window.__orbitBase) {
    const pose = typeof scene.getCameraPose === 'function' ? scene.getCameraPose() : null;
    if (pose && pose.position && pose.target) {
      const d = {x: pose.position.x - pose.target.x, y: pose.position.y - pose.target.y, z: pose.position.z - pose.target.z};
      const r = Math.hypot(d.x, d.y, d.z);
      window.__orbitBase = {pose, r, az: Math.atan2(d.x, d.z), el: Math.asin(d.y / r)};
    } else {
      window.__orbitBase = {pose: null};
    }
  }
  const base = window.__orbitBase;
  const rad = Math.PI / 180;
  if (base.pose && typeof scene.setCameraPose === 'function') {
    const az = base.az + azOffset * rad, el = base.el + elOffset * rad;
    const t = base.pose.target;
    scene.setCameraPose({
      position: {x: t.x + base.r * Math.cos(el) * Math.sin(az), y: t.y + base.r * Math.sin(el), z: t.z + base.r * Math.cos(el) * Math.cos(az)},
      target: t, fov: base.pose.fov,
    }, {duration: 0});
    return 'setCameraPose';
  }
  if (typeof scene.debugOrbit === 'function') {
    scene.debugOrbit(azOffset, 20 + elOffset);
    return 'debugOrbit';
  }
  return 'no camera API';
}"""

# Used only when the page predates ?capture=orbit: keep #stage and its ancestors, hide every sibling of
# them and every stage child except the canvas and its labels, then pin the stage to the viewport.
ISOLATE_STAGE_JS = """() => {
  const stage = document.getElementById('stage');
  if (!stage) return false;
  for (let node = stage; node && node !== document.documentElement; node = node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling !== node && !['SCRIPT', 'STYLE'].includes(sibling.tagName)) sibling.style.setProperty('display', 'none', 'important');
    }
  }
  for (const child of stage.children) {
    if (child.tagName !== 'CANVAS' && !['stage-canvas', 'stage-labels'].includes(child.id)) child.style.setProperty('display', 'none', 'important');
  }
  document.body.style.setProperty('margin', '0', 'important');
  document.documentElement.style.setProperty('overflow', 'hidden', 'important');
  for (const [key, value] of Object.entries({position: 'fixed', inset: '0', width: '100vw', height: '100vh', margin: '0', 'max-width': 'none', 'max-height': 'none', 'border-radius': '0'})) {
    stage.style.setProperty(key, value, 'important');
  }
  window.dispatchEvent(new Event('resize'));
  return true;
}"""


def capture_mode_hides_chrome(page) -> bool:
    """True when #stage fills the viewport and nothing visible sits outside it."""
    return page.evaluate("""() => {
        const stage = document.getElementById('stage');
        if (!stage) return false;
        const box = stage.getBoundingClientRect();
        if (box.width < innerWidth - 2 || box.height < innerHeight - 2 || box.top > 2) return false;
        const outside = [...document.body.querySelectorAll('header, nav, footer, .dock, .hero, .toolbar, main section')]
          .filter(node => !stage.contains(node) && !node.contains(stage) && getComputedStyle(node).display !== 'none');
        return outside.length === 0;
    }""")


def grab(page, mode: str) -> bytes:
    """One frame as PNG bytes: scene.capture() when the page offers it, else a #stage screenshot."""
    if mode == "capture":
        url = page.evaluate("() => window.__atlas.scene.capture()")
        prefix = "data:image/png;base64,"
        if isinstance(url, str) and url.startswith(prefix):
            return base64.b64decode(url[len(prefix):])
    stage = page.locator("#stage")
    return (stage if stage.count() else page).screenshot()


def record_theme(playwright, args, base_url: str, theme: str, frames_dir: Path | None) -> list:
    from PIL import Image

    launch = {"headless": True}
    if args.channel:
        launch["channel"] = args.channel
    if args.software_gl:
        launch["args"] = SOFTWARE_GL
    try:
        browser = playwright.chromium.launch(**launch)
    except Exception as error:
        if not args.channel:
            raise
        print(f"record_orbit: channel {args.channel!r} unavailable ({str(error).splitlines()[0]}); using bundled Chromium.", file=sys.stderr)
        launch.pop("channel")
        browser = playwright.chromium.launch(**launch)
    count = args.seconds * args.fps
    images = []
    try:
        context = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1, color_scheme=theme)
        # The stored theme is in place before the page's first script runs.
        context.add_init_script("try { localStorage.setItem('warroom-theme', %r); } catch (error) {}" % theme)
        page = context.new_page()
        problems = []
        page.on("pageerror", lambda error: problems.append(str(error)))
        page.goto(f"{base_url}/?capture=orbit", wait_until="networkidle", timeout=args.timeout_ms)
        page.wait_for_function("() => Boolean(window.__atlas && window.__atlas.scene)", timeout=args.timeout_ms)
        # `ready` resolves after the first complete frame; older scenes have none, so wait a fixed time instead.
        has_ready = page.evaluate("() => Boolean(window.__atlas.scene.ready && typeof window.__atlas.scene.ready.then === 'function')")
        if has_ready:
            page.evaluate("() => Promise.race([window.__atlas.scene.ready, new Promise(r => setTimeout(r, 20000))])")
        else:
            page.wait_for_timeout(4000)
        capture_mode = page.evaluate("() => /[?&]capture=orbit/.test(location.search)")
        # A page without ?capture=orbit support still shows its chrome: hide it so only the stage is recorded.
        if not capture_mode_hides_chrome(page):
            print("record_orbit: ?capture=orbit did not hide the page chrome; isolating #stage by script.", file=sys.stderr)
            page.evaluate(ISOLATE_STAGE_JS)
            page.wait_for_timeout(500)
        # Motion off: continuous animation would make the frames depend on wall-clock time.
        page.evaluate("() => { const s = window.__atlas.scene; if (typeof s.setMotion === 'function') s.setMotion(false); }")
        has_capture = page.evaluate("() => typeof window.__atlas.scene.capture === 'function'")
        source = "capture" if has_capture else "screenshot"
        used = None
        for index in range(count):
            azimuth, elevation = pose_at(index, count)
            used = page.evaluate(ORBIT_JS, [azimuth, elevation])
            if used.startswith("no "):
                raise RuntimeError(f"cannot move the camera: {used}")
            page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
            image = Image.open(io.BytesIO(grab(page, source))).convert("RGB")
            if image.size != (W, H):
                image = image.resize((W, H), Image.LANCZOS)
            if frames_dir is not None and index % max(1, count // 6) == 0:
                image.save(frames_dir / f"{theme}-{index:03d}.png")
            images.append(image)
        print(f"record_orbit: {theme}: {count} frames via {used} + {source}"
              f"{'' if capture_mode else ' (page lacks ?capture=orbit)'}{'; page errors: ' + '; '.join(problems) if problems else ''}")
    finally:
        browser.close()
    return images


def encode(images: list, fps: int, limit: int) -> tuple[bytes, int]:
    """Animated WebP, loop forever; the highest quality that fits `limit` bytes."""
    duration = round(1000 / fps)
    last = b""
    for quality in QUALITIES:
        buffer = io.BytesIO()
        images[0].save(buffer, format="WEBP", save_all=True, append_images=images[1:], duration=duration,
                       loop=0, quality=quality, method=5, minimize_size=False)
        last = buffer.getvalue()
        if len(last) <= limit:
            return last, quality
    raise RuntimeError(f"even quality {QUALITIES[-1]} is {len(last)} bytes, over the {limit} byte limit")


def write_atomic(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(handle, "wb") as out:
            out.write(payload)
        os.chmod(temp, 0o644)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--site", type=Path, default=ROOT / "site", help="staged site directory to serve (default: site/)")
    ap.add_argument("--out", type=Path, default=ROOT / "dist", help="directory for orbit-{light,dark}.webp (default: dist/)")
    ap.add_argument("--themes", nargs="+", default=["light", "dark"], choices=["light", "dark"])
    ap.add_argument("--seconds", type=int, default=6)
    ap.add_argument("--fps", type=int, default=12)
    ap.add_argument("--max-bytes", type=int, default=MAX_BYTES)
    ap.add_argument("--channel", default=None, help="browser channel, e.g. chrome (default: Playwright's bundled Chromium)")
    ap.add_argument("--software-gl", action="store_true", default=bool(os.environ.get("CI")),
                    help="software WebGL flags for GPU-less runners (default on when CI is set)")
    ap.add_argument("--frames-dir", type=Path, help="also save a handful of PNG frames here for inspection")
    ap.add_argument("--timeout-ms", type=int, default=60000)
    args = ap.parse_args()
    try:
        from PIL import Image  # noqa: F401
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        print(f"record_orbit: {error.name or 'a dependency'} is not installed; CI installs them with "
              "`pip install playwright pillow && python -m playwright install --with-deps chromium`.", file=sys.stderr)
        return 2
    site = args.site.resolve()
    for needed in ("index.html", "stats.json"):
        if not (site / needed).is_file():
            print(f"record_orbit: {site / needed} is missing; stage the site first (see .github/workflows/profile.yml).", file=sys.stderr)
            return 1
    if args.frames_dir:
        args.frames_dir.mkdir(parents=True, exist_ok=True)
    server, port = serve(site)
    try:
        with sync_playwright() as playwright:
            for theme in args.themes:
                images = record_theme(playwright, args, f"http://127.0.0.1:{port}", theme, args.frames_dir)
                payload, quality = encode(images, args.fps, args.max_bytes)
                problems = check.orbit_errors(payload, args.max_bytes)
                if problems:
                    raise RuntimeError(f"{theme} recording rejected: {'; '.join(problems)}")
                target = args.out / f"orbit-{theme}.webp"
                write_atomic(target, payload)
                print(f"record_orbit: wrote {target} ({len(payload) / 1024:.0f} KB, {len(images)} frames, quality {quality})")
    except Exception as error:
        print(f"record_orbit: failed: {error}", file=sys.stderr)
        return 1
    finally:
        server.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
