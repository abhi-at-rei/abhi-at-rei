from __future__ import annotations

import argparse
import base64
import datetime
import gzip
import json
import os
import struct
import sys
import zlib
from pathlib import Path
from urllib.parse import urljoin, urlsplit

ROOT = Path(__file__).resolve().parent.parent
TRANSFER_BUDGET = 600 * 1024  # bytes on the wire for the War Room's first load (ROADMAP Phase 6)
BROWSERS = ("chromium", "webkit", "firefox")
# GPU-less CI runners render WebGL in software (SwiftShader through ANGLE), as scripts/record_orbit.py does.
SOFTWARE_GL = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
AZIMUTHS = (-150, -90, -45, 0, 45, 90, 150)
ELEVATIONS = (12, 34, 65)
PIXEL_SCOPE = "Detects catastrophic black frames only; not proof that all possible rendering artifacts are absent."


def png_pixels(payload: bytes) -> tuple[int, int, list[bytes]]:
    if payload[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    offset = 8
    compressed = bytearray()
    width = height = channels = 0
    while offset < len(payload):
        length = struct.unpack(">I", payload[offset:offset + 4])[0]
        kind = payload[offset + 4:offset + 8]
        data = payload[offset + 8:offset + 8 + length]
        offset += length + 12
        if kind == b"IHDR":
            width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", data)
            if depth != 8 or color not in (2, 6) or compression or filtering or interlace:
                raise ValueError("only non-interlaced 8-bit RGB/RGBA PNG is supported")
            channels = 3 if color == 2 else 4
        elif kind == b"IDAT":
            compressed.extend(data)
        elif kind == b"IEND":
            break
    if not width or not height or not channels:
        raise ValueError("missing PNG dimensions")
    raw = zlib.decompress(compressed)
    stride = width * channels
    if len(raw) != height * (stride + 1):
        raise ValueError("invalid PNG scanline size")
    rows = []
    previous = bytearray(stride)
    for y in range(height):
        start = y * (stride + 1)
        method = raw[start]
        row = bytearray(raw[start + 1:start + 1 + stride])
        for x in range(stride):
            left = row[x - channels] if x >= channels else 0
            above = previous[x]
            upper_left = previous[x - channels] if x >= channels else 0
            if method == 1:
                predictor = left
            elif method == 2:
                predictor = above
            elif method == 3:
                predictor = (left + above) // 2
            elif method == 4:
                p = left + above - upper_left
                distances = (abs(p - left), abs(p - above), abs(p - upper_left))
                predictor = (left, above, upper_left)[distances.index(min(distances))]
            elif method == 0:
                predictor = 0
            else:
                raise ValueError("unsupported PNG filter")
            row[x] = (row[x] + predictor) & 255
        rows.append(bytes(row) if channels == 3 else bytes(value for x in range(0, stride, 4) for value in row[x:x + 3]))
        previous = row
    return width, height, rows


def pixel_check(payload: bytes) -> dict:
    width, height, rows = png_pixels(payload)
    samples = {
        tuple(rows[min(height - 1, int((y + 0.5) * height / 20))][
            min(width - 1, int((x + 0.5) * width / 20)) * 3:
            min(width - 1, int((x + 0.5) * width / 20)) * 3 + 3
        ])
        for y in range(20) for x in range(20)
    }
    black = sum(
        row[x] <= 3 and row[x + 1] <= 3 and row[x + 2] <= 3
        for row in rows for x in range(0, len(row), 3)
    )
    fraction = black / (width * height)
    return {
        "width": width, "height": height, "sample_grid": [20, 20],
        "distinct_sample_rgb": len(samples), "near_black_fraction": fraction,
        "passed": len(samples) >= 16 and fraction < 0.9,
    }


def is_playing(control) -> bool:
    state = control.get_attribute("data-state")
    return state == "on" if state is not None else control.get_attribute("aria-pressed") == "true"


def semantic_controls(page) -> list[dict]:
    results = []
    for kind in ("filter", "preset"):
        select = page.locator(f"select[data-{kind}]")
        if select.count() and select.first.is_visible() and select.first.is_enabled():
            control = select.first
            original = control.input_value()
            options = control.locator("option:not([disabled])").evaluate_all("options => options.map(option => option.value)")
            target = next((option for option in options if option != original), None)
            if target is not None:
                control.select_option(target)
                if control.input_value() != target:
                    raise AssertionError(f"{kind} select did not change")
                if kind == "filter" and control.get_attribute("data-filter") != target:
                    raise AssertionError("filter semantic state did not update")
                results.append({"control": kind, "status": "passed", "assertion": "select value and semantic state changed"})
                control.select_option(original)
                continue
        selector = f"button[data-{kind}], [role=button][data-{kind}]"
        if kind == "preset":
            selector += ", button[data-camera]"
        controls = page.locator(selector)
        candidates = [controls.nth(index) for index in range(controls.count()) if controls.nth(index).is_visible() and controls.nth(index).is_enabled()]
        more = page.locator("#dock-more-toggle")
        if not candidates and more.count() and more.first.is_visible():
            # On phones the presets and filters live in the dock's controls sheet.
            more.first.click()
            page.wait_for_timeout(350)
            candidates = [controls.nth(index) for index in range(controls.count()) if controls.nth(index).is_visible() and controls.nth(index).is_enabled()]
        if not candidates:
            results.append({"control": kind, "status": "skipped", "reason": "semantic data attribute unavailable"})
            continue
        # Toggle chips un-press when clicked again, so prefer one that is not already pressed.
        control = next((item for item in reversed(candidates) if item.get_attribute("aria-pressed") != "true"), candidates[-1])
        before = control.get_attribute("aria-pressed")
        control.click()
        if before is not None:
            if control.get_attribute("aria-pressed") != "true":
                raise AssertionError(f"{kind} aria-pressed did not activate")
            results.append({"control": kind, "status": "passed", "assertion": "aria-pressed activated"})
        else:
            results.append({"control": kind, "status": "clicked", "reason": "no semantic state attribute exposed"})
    replay = page.locator('input[type="range"][data-replay], [data-replay] input[type="range"], input[type="range"][data-action="replay-scrub"]')
    if replay.count() and replay.first.is_visible() and replay.first.is_enabled():
        result = replay.first.evaluate("""element => {
            const original = element.value;
            const maximum = element.max || '100';
            const minimum = element.min || '0';
            const value = original === maximum ? minimum : maximum;
            element.value = value;
            element.dispatchEvent(new Event('input', {bubbles:true}));
            element.dispatchEvent(new Event('change', {bubbles:true}));
            const actual = element.value;
            element.value = original;
            element.dispatchEvent(new Event('input', {bubbles:true}));
            return {actual, expected:value};
        }""")
        if result["actual"] != result["expected"]:
            raise AssertionError("replay input did not accept its maximum")
        results.append({"control": "replay", "status": "passed", "assertion": "input accepts value and dispatches events; no metric assertions"})
        play = page.locator('button[data-action="replay-play"], button[data-replay-play]')
        if play.count() and play.first.is_visible() and play.first.is_enabled():
            control = play.first
            reduced = page.evaluate("() => matchMedia('(prefers-reduced-motion: reduce)').matches")
            if reduced:
                results.append({"control": "replay-play", "status": "skipped", "reason": "reduced motion steps by week instead of playing"})
            else:
                control.click()
                if not is_playing(control):
                    raise AssertionError("replay play button did not activate")
                control.click()
                if is_playing(control):
                    raise AssertionError("replay play button did not stop")
                results.append({"control": "replay-play", "status": "passed", "assertion": "play and stop state (data-state, else aria-pressed)"})
                replay.first.evaluate("""element => {
                    element.value = element.max || '1';
                    element.dispatchEvent(new Event('input', {bubbles:true}));
                }""")
    else:
        results.append({"control": "replay", "status": "skipped", "reason": "semantic range data attribute unavailable"})
    selection = page.locator('button[data-date], [role="gridcell"][data-date], button[data-day]')
    candidates = [
        selection.nth(index) for index in range(selection.count())
        if selection.nth(index).is_visible() and selection.nth(index).is_enabled()
        and selection.nth(index).get_attribute("aria-selected") != "true"
        and selection.nth(index).get_attribute("aria-disabled") != "true"
    ]
    if candidates:
        control = candidates[0]
        selected = control.get_attribute("aria-selected")
        pressed = control.get_attribute("aria-pressed")
        control.click()
        if selected is not None and control.get_attribute("aria-selected") != "true":
            raise AssertionError("day selection aria-selected did not activate")
        if pressed is not None and control.get_attribute("aria-pressed") != "true":
            raise AssertionError("day selection aria-pressed did not activate")
        results.append({"control": "selection", "status": "passed" if selected is not None or pressed is not None else "clicked"})
    else:
        results.append({"control": "selection", "status": "skipped", "reason": "semantic day data attribute unavailable"})
    return results


def settle(page, delay: int) -> None:
    page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    page.wait_for_timeout(delay)


def wait_stage(page, timeout: int) -> str:
    # The stage is either "ready" (WebGL scene mounted) or "fallback" (static image).
    page.wait_for_function(
        """() => {
            const stage = document.getElementById('stage');
            const atlas = document.getElementById('atlas');
            return Boolean((stage && stage.classList.contains('is-ready')) || (atlas && atlas.classList.contains('is-fallback')));
        }""",
        timeout=timeout,
    )
    return "fallback" if page.evaluate("() => document.getElementById('atlas').classList.contains('is-fallback')") else "ready"


def set_theme(page, mode: str, wait_ms: int = 0) -> None:
    direct = page.locator(f'button[data-t="{mode}"]')
    if direct.count():
        direct.first.click()
    else:
        button = page.locator('button[data-theme-toggle], button[data-action="theme"], button[data-action="toggle-theme"], #theme-toggle')
        if not button.count():
            raise AssertionError("theme button unavailable")
        if page.locator("html").get_attribute("data-theme") != mode:
            button.first.click()
    page.wait_for_function("(mode) => document.documentElement.dataset.theme === mode", arg=mode)
    if wait_ms:
        wait_stage(page, wait_ms)


SCENE_LOOKUP = "const scene = expression.split('.').reduce((value, key) => value == null ? value : value[key], window);"


def scene_eval(page, expression: str, body: str, arg=None):
    # Runs `body` with `scene` resolved from a dotted window expression (e.g. __atlas.scene) and `arg` passed in.
    return page.evaluate("({expression, arg}) => {" + SCENE_LOOKUP + body + "}", {"expression": expression, "arg": arg})


def atlas_state(page) -> dict:
    state = page.evaluate("() => window.__atlas && typeof window.__atlas.getState === 'function' ? window.__atlas.getState() : null")
    if not isinstance(state, dict):
        raise AssertionError("window.__atlas.getState() unavailable")
    return state


def camera_diagnostics(page, expression: str) -> dict:
    # Finite-camera evidence comes only from getDiagnostics().camera/.target; absent means skipped, never passed.
    return scene_eval(page, expression, """
        if (!scene) return {status: 'skipped', reason: 'scene unavailable'};
        if (typeof scene.getDiagnostics !== 'function') return {status: 'skipped', reason: 'getDiagnostics() unavailable'};
        const diagnostics = scene.getDiagnostics();
        const parts = {camera: diagnostics && diagnostics.camera, target: diagnostics && diagnostics.target};
        if (!parts.camera || typeof parts.camera !== 'object') return {status: 'skipped', reason: 'getDiagnostics() exposes no camera coordinates'};
        const values = {};
        let finite = true;
        for (const [name, vector] of Object.entries(parts)) {
          if (name === 'target' && vector === undefined) continue;
          for (const axis of ['x', 'y', 'z']) {
            const value = vector && vector[axis];
            const ok = typeof value === 'number' && Number.isFinite(value);
            finite = finite && ok;
            values[name + '.' + axis] = ok ? value : String(value);
          }
        }
        return {status: finite ? 'passed' : 'failed', values};
    """)


def stage_screenshot(page, path: Path) -> dict:
    stage = page.locator("#stage")
    stage.wait_for(state="visible")
    result = pixel_check(stage.screenshot(path=str(path)))
    result["screenshot"] = str(path)
    return result


def check_theme_button(page, args, mode: str, is_site: bool) -> dict:
    wait = args.timeout_ms if is_site else 0
    other = "dark" if mode == "light" else "light"
    set_theme(page, other, wait)
    set_theme(page, mode, wait)
    return {"flipped_to": other, "restored": mode}


def check_stage_pixels(page, args, label: str) -> dict:
    result = stage_screenshot(page, args.out / f"{label}-stage.png")
    if not result["passed"]:
        result["status"] = "failed"
        result["reason"] = f"distinct_sample_rgb={result['distinct_sample_rgb']} (need >=16), near_black_fraction={result['near_black_fraction']:.3f} (need <0.9)"
    return result


def check_atlas_api(page, args) -> dict:
    missing = scene_eval(page, args.scene_global, """
        if (!scene) return ['scene'];
        return ['capture', 'dispose', 'setFilter', 'debugOrbit', 'getDiagnostics', 'setCameraPreset', 'setReplayProgress']
          .filter(name => typeof scene[name] !== 'function');
    """)
    if missing:
        raise AssertionError(f"{args.scene_global} is missing: {', '.join(missing)}")
    state = atlas_state(page)
    if state.get("preset") != "front":
        raise AssertionError(f"getState().preset is {state.get('preset')!r} on load, expected 'front'")
    return {"preset": state["preset"], "state_keys": sorted(state)}


def check_capture(page, args, label: str) -> dict:
    url = scene_eval(page, args.scene_global, "return scene.capture();")
    prefix = "data:image/png;base64,"
    if not isinstance(url, str) or not url.startswith(prefix) or len(url) <= len(prefix) + 64:
        raise AssertionError(f"capture() did not return a PNG data URL (got {type(url).__name__}: {str(url)[:60]!r})")
    payload = base64.b64decode(url[len(prefix):])
    path = args.out / f"{label}-capture.png"
    path.write_bytes(payload)
    result = {"bytes": len(payload), "file": str(path)}
    try:
        result["pixels"] = pixel_check(payload)
    except ValueError as error:
        result["pixels"] = {"unavailable": str(error)}
    return result


def check_replay(page, args) -> dict:
    scrub = page.locator("#replay-progress")
    if not scrub.count() or not scrub.is_visible():
        return {"status": "skipped", "reason": "#replay-progress unavailable"}
    scrub.evaluate("""element => {
        element.value = '0.5';
        element.dispatchEvent(new Event('input', {bubbles: true}));
        element.dispatchEvent(new Event('change', {bubbles: true}));
    }""")
    settle(page, 100)
    progress = atlas_state(page).get("replayProgress")
    index = scene_eval(page, args.scene_global, "return scene && scene.getDiagnostics ? scene.getDiagnostics().replayIndex : null;")
    if not isinstance(progress, (int, float)) or abs(progress - 0.5) > 0.02:
        raise AssertionError(f"getState().replayProgress is {progress!r} after scrubbing to 0.5")
    scrub.evaluate("""element => {
        element.value = '1';
        element.dispatchEvent(new Event('input', {bubbles: true}));
        element.dispatchEvent(new Event('change', {bubbles: true}));
    }""")
    settle(page, 100)
    restored = atlas_state(page).get("replayProgress")
    if restored != 1:
        raise AssertionError(f"getState().replayProgress is {restored!r} after scrubbing back to 1")
    return {"replayProgress": progress, "scene_replayIndex": index}


def check_filter(page, args) -> dict:
    scene_eval(page, args.scene_global, "scene.setFilter('top'); scene.setFilter('all');")
    result = {"scene_setFilter": "top and all accepted"}
    select = page.locator("select#filter, select[data-filter]")
    if select.count() and select.first.is_visible() and select.first.is_enabled():
        select.first.select_option("top")
        settle(page, 100)
        if atlas_state(page).get("filter") != "top":
            raise AssertionError("getState().filter is not 'top' after selecting Top days")
        select.first.select_option("all")
        settle(page, 100)
        if atlas_state(page).get("filter") != "all":
            raise AssertionError("getState().filter did not return to 'all'")
        result["ui_filter"] = "top and all reflected in getState()"
    else:
        result["ui_filter"] = "skipped: filter select unavailable"
    return result


def check_dispose_reinit(page, args, label: str) -> dict:
    toggle = page.locator("#theme-toggle")
    if not toggle.count():
        return {"status": "skipped", "reason": "#theme-toggle unavailable, cannot trigger scene re-initialisation"}
    theme = page.locator("html").get_attribute("data-theme")
    flipped = "light" if theme == "dark" else "dark"
    disposed = scene_eval(page, args.scene_global, """
        window.__checkOldScene = scene;
        scene.dispose();
        try { return scene.getDiagnostics().disposed; } catch (error) { return 'getDiagnostics unavailable after dispose'; }
    """)
    # Toggling the theme makes the app dispose the stale scene a second time and build a new one.
    set_theme(page, flipped, args.timeout_ms)
    reinit = scene_eval(page, args.scene_global, """
        return {fresh: Boolean(scene) && scene !== window.__checkOldScene,
                disposed: scene && scene.getDiagnostics ? scene.getDiagnostics().disposed : null};
    """)
    if not reinit["fresh"]:
        # The UI now animates the theme in place instead of rebuilding the scene, so nothing replaces the
        # disposed one. Reload to leave a live scene for the checks that follow.
        page.reload(wait_until="networkidle", timeout=args.timeout_ms)
        wait_stage(page, args.timeout_ms)
        return {"status": "skipped", "reason": "the app no longer rebuilds the scene on a theme switch; dispose() itself returned "
                f"disposed={disposed!r}", "disposed_flag_after_dispose": disposed}
    if wait_stage(page, args.timeout_ms) != "ready" or reinit["disposed"]:
        raise AssertionError(f"scene was not rebuilt after dispose(): {reinit}")
    pixels = stage_screenshot(page, args.out / f"{label}-reinit.png")
    if not pixels["passed"]:
        raise AssertionError("re-initialised scene failed the pixel check")
    set_theme(page, theme, args.timeout_ms)
    return {"disposed_flag_after_dispose": disposed, "reinit": reinit, "pixels": pixels}


def camera_sweep(page, args, label: str) -> dict:
    available = scene_eval(page, args.scene_global, "return Boolean(scene) && typeof scene.debugOrbit === 'function';")
    if not available:
        return {"status": "skipped", "reason": f"{args.scene_global}.debugOrbit unavailable", "poses": []}
    poses = []
    for azimuth in AZIMUTHS:
        for elevation in ELEVATIONS:
            pose = {"azimuth": azimuth, "elevation": elevation}
            try:
                scene_eval(page, args.scene_global, "scene.debugOrbit(arg.azimuth, arg.elevation);", {"azimuth": azimuth, "elevation": elevation})
                settle(page, args.settle_ms)
                pose["pixels"] = stage_screenshot(page, args.out / f"{label}-az{azimuth}-el{elevation}.png")
                pose["camera"] = camera_diagnostics(page, args.scene_global)
                pose["passed"] = pose["pixels"]["passed"] and pose["camera"]["status"] != "failed"
            except Exception as error:
                pose.update({"passed": False, "error": str(error).splitlines()[0]})
            poses.append(pose)
    scene_eval(page, args.scene_global, "scene.setCameraPreset('front');")
    camera = [pose.get("camera", {}).get("status", "failed") for pose in poses]
    failed = [f"az{pose['azimuth']}/el{pose['elevation']}" for pose in poses if not pose["passed"]]
    return {
        "status": "failed" if failed else "passed",
        "reason": f"{len(failed)} of {len(poses)} poses failed the pixel or finite-camera check: {failed}" if failed else None,
        "poses": poses,
        "camera_finite": {name: camera.count(name) for name in ("passed", "failed", "skipped")},
        "camera_finite_status": "skipped" if camera.count("skipped") == len(camera) else "failed" if "failed" in camera else "passed",
    }


def skipped(reason: str) -> dict:
    return {"status": "skipped", "reason": reason}


def scene_has(page, expression: str, *names: str) -> list:
    # Names of the given scene members that are missing; feature detection for lanes that land in any order.
    return scene_eval(page, expression, "if (!scene) return arg; return arg.filter(name => typeof scene[name] !== 'function');", list(names))


def camera_pose(page, expression: str):
    return scene_eval(page, expression, "return scene && typeof scene.getCameraPose === 'function' ? JSON.parse(JSON.stringify(scene.getCameraPose())) : null;")


def pose_delta(a: dict, b: dict) -> float:
    return max(abs(a["position"][axis] - b["position"][axis]) for axis in "xyz")


def check_scene_ready(page, args) -> dict:
    state = scene_eval(page, args.scene_global, """
        if (!scene) return 'scene';
        if (!scene.ready || typeof scene.ready.then !== 'function') return 'absent';
        return Promise.race([scene.ready.then(() => 'resolved'), new Promise(resolve => setTimeout(() => resolve('timeout'), 10000))]);
    """)
    if state == "absent":
        return skipped("scene.ready unavailable")
    if state != "resolved":
        raise AssertionError(f"scene.ready did not resolve ({state})")
    return {"ready": "resolved"}


def check_arrival(page, args) -> dict:
    diagnostics = scene_eval(page, args.scene_global, "return scene && scene.getDiagnostics ? scene.getDiagnostics() : null;")
    if not isinstance(diagnostics, dict) or "arrival" not in diagnostics:
        return skipped("getDiagnostics().arrival unavailable")
    try:
        page.wait_for_function(
            "(expression) => { const scene = expression.split('.').reduce((v, k) => v == null ? v : v[k], window); const a = scene.getDiagnostics().arrival; return a === 'done' || a === 'skipped'; }",
            arg=args.scene_global, timeout=10000)
    except Exception:
        raise AssertionError(f"arrival never reached done/skipped (last: {scene_eval(page, args.scene_global, 'return scene.getDiagnostics().arrival;')!r})")
    return {"arrival": scene_eval(page, args.scene_global, "return scene.getDiagnostics().arrival;")}


def check_theme_switch_identity(page, args, mode: str) -> dict:
    diagnostics = scene_eval(page, args.scene_global, "return scene && scene.getDiagnostics ? scene.getDiagnostics() : null;")
    if not isinstance(diagnostics, dict) or "theme" not in diagnostics or "themeTransition" not in diagnostics:
        return skipped("getDiagnostics().theme/.themeTransition unavailable (animated theme switch not landed)")
    other = "dark" if mode == "light" else "light"
    result = {}
    page.evaluate("(expression) => { window.__checkScene = expression.split('.').reduce((v, k) => v == null ? v : v[k], window); }", args.scene_global)
    for target in (other, mode):
        before = scene_eval(page, args.scene_global, "return scene.getDiagnostics().theme;")
        set_theme(page, target)
        try:
            page.wait_for_function(
                "(expression) => { const scene = expression.split('.').reduce((v, k) => v == null ? v : v[k], window); return scene && !scene.getDiagnostics().themeTransition; }",
                arg=args.scene_global, timeout=5000)
        except Exception:
            raise AssertionError("themeTransition stayed true for over 5 s")
        same = page.evaluate("(expression) => window.__checkScene === expression.split('.').reduce((v, k) => v == null ? v : v[k], window)", args.scene_global)
        theme = scene_eval(page, args.scene_global, "return scene.getDiagnostics().theme;")
        if not same:
            raise AssertionError(f"the scene object was replaced by the switch to {target}; it should be animated in place")
        if theme != target or before == theme:
            raise AssertionError(f"getDiagnostics().theme is {theme!r} after switching to {target} (was {before!r})")
        result[target] = {"before": before, "after": theme, "same_scene": same}
    return result


def peak_date(page) -> str:
    stats = page.evaluate("async () => (await fetch('stats.json', {cache: 'no-store'})).json()")
    best = stats.get("best_day") or {}
    if best.get("date"):
        return best["date"]
    days = [day for week in stats.get("weeks", []) for day in week]
    return max(days, key=lambda day: day["count"])["date"]


def check_deep_link(side_page, args, url: str) -> dict:
    page = side_page()
    page.goto(url, wait_until="domcontentloaded", timeout=args.timeout_ms)
    date = peak_date(page)
    parts = urlsplit(url)
    link = parts._replace(query="", fragment=f"day={date}&view=map").geturl()
    page.goto(link, wait_until="networkidle", timeout=args.timeout_ms)
    wait_stage(page, args.timeout_ms)
    try:
        page.wait_for_function("() => { const s = window.__atlas && window.__atlas.getState(); return Boolean(s && s.selectedDate && s.preset === 'map'); }", timeout=8000)
    except Exception:
        pass
    state = atlas_state(page)
    if state.get("selectedDate") != date or state.get("preset") != "map":
        raise AssertionError(f"#day={date}&view=map gave selectedDate={state.get('selectedDate')!r}, preset={state.get('preset')!r}")
    arrival = page.evaluate("() => window.__atlas.scene && window.__atlas.scene.getDiagnostics ? window.__atlas.scene.getDiagnostics().arrival : null")
    if arrival not in (None, "done", "skipped"):
        raise AssertionError(f"a deep link should skip the arrival, but arrival is {arrival!r}")
    page.close()
    return {"date": date, "preset": state["preset"], "arrival": arrival}


CHROME_SELECTORS = ".dock, .hero, header, nav, #details, #stage-loading, .toolbar"


def check_capture_orbit(side_page, args, url: str) -> dict:
    page = side_page()
    page.set_viewport_size({"width": 840, "height": 420})
    page.goto(urlsplit(url)._replace(query="capture=orbit", fragment="").geturl(), wait_until="networkidle", timeout=args.timeout_ms)
    wait_stage(page, args.timeout_ms)
    info = page.evaluate("""selectors => {
        const visible = [...document.querySelectorAll(selectors)].filter(node => {
            const style = getComputedStyle(node), box = node.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0 && Number(style.opacity) > 0;
        }).map(node => node.id ? '#' + node.id : node.tagName.toLowerCase() + '.' + node.className);
        const stage = document.getElementById('stage').getBoundingClientRect();
        return {visible, stage: [Math.round(stage.width), Math.round(stage.height)], viewport: [innerWidth, innerHeight], scrollHeight: document.documentElement.scrollHeight};
    }""", CHROME_SELECTORS)
    page.close()
    if info["visible"]:
        raise AssertionError(f"?capture=orbit leaves chrome visible: {info['visible']}")
    if info["stage"][0] < info["viewport"][0] - 2 or info["stage"][1] < info["viewport"][1] - 2:
        raise AssertionError(f"?capture=orbit stage is {info['stage']}, viewport {info['viewport']}")
    return info


CARD_SELECTORS = ("#voyage [data-chapter]", "#voyage .voyage-card", "#voyage .chapter", "#voyage article", "#voyage section")


def check_voyage_cards(page, args) -> dict:
    if not page.locator("#voyage").count():
        return skipped("#voyage not on the page")
    chapters = page.evaluate("""async () => {
        const module = await import(new URL('model.js', location.href).href);
        if (typeof module.buildChapters !== 'function') return null;
        return module.buildChapters(window.__atlas.model).map(chapter => chapter.id);
    }""")
    if chapters is None:
        return skipped("model.js exports no buildChapters")
    counts = {selector: page.locator(selector).count() for selector in CARD_SELECTORS}
    cards = next((count for count in counts.values() if count), 0)
    if cards != len(chapters):
        raise AssertionError(f"#voyage has {cards} cards for {len(chapters)} chapters {chapters} ({counts})")
    return {"chapters": chapters, "cards": cards}


def check_voyage_scroll(page, args) -> dict:
    voyage = page.locator("#voyage")
    if not voyage.count():
        return skipped("#voyage not on the page")
    if scene_has(page, args.scene_global, "getCameraPose"):
        return skipped("scene.getCameraPose unavailable")
    geometry = page.evaluate("() => { const box = document.getElementById('voyage').getBoundingClientRect(); return {top: box.top + scrollY, height: box.height, viewport: innerHeight}; }")
    if geometry["height"] < geometry["viewport"]:
        raise AssertionError(f"#voyage is only {geometry['height']:.0f}px tall; nothing to scroll through")
    poses, states = [], []
    for fraction in (0.05, 0.3, 0.55, 0.8, 0.97):
        page.evaluate("y => scrollTo(0, y)", geometry["top"] + fraction * (geometry["height"] - geometry["viewport"]))
        settle(page, 450)
        poses.append(camera_pose(page, args.scene_global))
        states.append(page.evaluate("() => document.documentElement.dataset.voyage || ''"))
    page.evaluate("() => scrollTo(0, 0)")
    settle(page, 450)
    top_state = page.evaluate("() => document.documentElement.dataset.voyage || ''")
    spread = max(pose_delta(a, b) for a in poses for b in poses)
    if spread < 0.05:
        raise AssertionError(f"scrolling through #voyage moved the camera by only {spread:.3f}")
    if "active" not in states:
        raise AssertionError(f"documentElement.dataset.voyage never became 'active' while scrolling ({states})")
    if top_state == "active":
        raise AssertionError("dataset.voyage is still 'active' back at the top of the page")
    return {"camera_spread": round(spread, 3), "dataset_voyage": states, "at_top": top_state}


def check_wheel_scrolls_page(page, args) -> dict:
    stage = page.locator("#stage").bounding_box()
    if page.evaluate("() => document.documentElement.scrollHeight - innerHeight") < 600:
        return skipped("page is not scrollable enough to test a wheel")
    page.evaluate("() => scrollTo(0, 0)")
    settle(page, 200)
    before = camera_pose(page, args.scene_global)
    page.mouse.move(stage["x"] + stage["width"] / 2, min(stage["y"] + stage["height"] / 2, page.viewport_size["height"] / 2))
    page.mouse.wheel(0, 300)
    settle(page, 500)
    scrolled = page.evaluate("() => scrollY")
    after = camera_pose(page, args.scene_global)
    voyage = page.evaluate("() => document.documentElement.dataset.voyage || ''")
    page.evaluate("() => scrollTo(0, 0)")
    settle(page, 300)
    if scrolled <= 0:
        raise AssertionError("a plain wheel over the canvas did not scroll the page")
    result = {"scrollY": scrolled}
    if before and after and voyage != "active":
        zoomed = abs(distance(before) - distance(after))
        if zoomed > 0.01:
            raise AssertionError(f"a plain wheel over the canvas zoomed the camera (distance changed by {zoomed:.3f})")
        result["zoom_delta"] = round(zoomed, 4)
    else:
        result["zoom"] = "not compared: getCameraPose unavailable or the voyage moved the camera"
    return result


def distance(pose: dict) -> float:
    return sum((pose["position"][axis] - pose["target"][axis]) ** 2 for axis in "xyz") ** 0.5


def check_keyboard_presets(page, args) -> dict:
    state = atlas_state(page)
    if "preset" not in state:
        return skipped("getState().preset unavailable")
    seen = {}
    page.evaluate("() => document.activeElement && document.activeElement.blur && document.activeElement.blur()")
    for key in "1234":
        page.keyboard.press(key)
        settle(page, 150)
        seen[key] = atlas_state(page).get("preset")
    page.keyboard.press("1")
    settle(page, 150)
    if len(set(seen.values())) != 4:
        raise AssertionError(f"keys 1-4 gave presets {seen}; expected four distinct presets")
    return {"presets": seen}


def check_transfer_budget(browser, args, url: str, layout: str, width: int, height: int, mode: str) -> dict:
    # A cold, cache-less load in its own context. The wire size is what the browser reports (compressed body
    # plus headers); a local server sends no compression, so same-origin text is estimated with gzip -6 instead.
    kwargs = {}
    if layout == "mobile" and args.browser != "firefox":
        kwargs = {"is_mobile": True, "has_touch": True}
    context = browser.new_context(viewport={"width": width, "height": height}, color_scheme=mode, device_scale_factor=1, **kwargs)
    context.add_init_script("try { localStorage.setItem('warroom-theme', %s); } catch (error) {}" % json.dumps(mode))
    page = context.new_page()
    entries = []
    origin = "{0.scheme}://{0.netloc}".format(urlsplit(url))
    page.on("response", lambda response: entries.append(response))
    try:
        page.goto(url, wait_until="networkidle", timeout=args.timeout_ms)
        wait_stage(page, args.timeout_ms)
        rows = []
        for response in entries:
            request = response.request
            try:
                sizes = request.sizes()
                wire = sizes["responseBodySize"] + sizes["responseHeadersSize"]
                if response.url.startswith(origin) and not response.headers.get("content-encoding") and any(
                        kind in response.headers.get("content-type", "") for kind in ("text", "javascript", "json", "svg", "xml")):
                    wire = len(gzip.compress(response.body(), 6)) + sizes["responseHeadersSize"]
            except Exception:
                wire = 0
            rows.append({"url": response.url, "bytes": wire})
    finally:
        context.close()
    total = sum(row["bytes"] for row in rows)
    result = {"status": "passed", "total_bytes": total, "budget_bytes": TRANSFER_BUDGET, "requests": len(rows),
              "largest": sorted(rows, key=lambda row: -row["bytes"])[:5]}
    if total > TRANSFER_BUDGET:
        result.update(status="failed", reason=f"first load transferred {total / 1024:.0f} KB, budget {TRANSFER_BUDGET // 1024} KB")
    return result


def run_check(case: dict, name: str, function) -> None:
    # Records one named check; a failure is logged and never aborts the checks after it.
    try:
        result = function() or {}
    except Exception as error:
        message = str(error).strip().splitlines()[0] if str(error).strip() else type(error).__name__
        case["checks"][name] = {"status": "failed", "error": message}
        case["errors"].append(f"{name}: {message}")
        return
    result = {"status": "passed", **result} if "status" not in result else result
    case["checks"][name] = result
    if result["status"] == "skipped":
        case["skipped"].append(f"{name}: {result.get('reason', 'skipped')}")
    elif result["status"] == "failed":
        case["errors"].append(f"{name}: {result.get('reason') or result.get('values') or 'failed'}")


def check_model_tests(browser, args) -> dict:
    context = browser.new_context()
    try:
        page = context.new_page()
        page.goto(urljoin(args.base.rstrip("/") + "/", "tests/"), timeout=args.timeout_ms)
        outcome = page.evaluate("""async url => {
            try {
                const module = await import(url);
                if (typeof module.runModelTests !== 'function') throw new Error('tests/model.test.js does not export runModelTests');
                const result = await module.runModelTests();
                if (!(result && result.passed === true)) throw new Error('runModelTests() did not return {passed: true}: ' + JSON.stringify(result));
                return {passed: true, result};
            } catch (error) {
                return {passed: false, error: (error && error.message) || String(error)};
            }
        }""", urljoin(args.base.rstrip("/") + "/", "tests/model.test.js"))
    except Exception as error:
        outcome = {"passed": False, "error": str(error).strip().splitlines()[0] if str(error).strip() else type(error).__name__}
    finally:
        context.close()
    return outcome


def check_flat(page, args, mode: str, case: dict) -> None:
    def fallback() -> dict:
        if wait_stage(page, args.timeout_ms) != "fallback":
            raise AssertionError("?flat did not select the static fallback")
        info = page.evaluate("""() => {
            const image = document.getElementById('stage-fallback');
            if (!image) return null;
            const box = image.getBoundingClientRect();
            const style = getComputedStyle(image);
            return {src: image.getAttribute('src'), hidden: image.hidden, display: style.display, visibility: style.visibility,
              width: box.width, height: box.height, loaded: image.complete && image.naturalWidth > 0,
              canvases: document.querySelectorAll('#stage canvas').length, scene: window.__atlas ? window.__atlas.scene : undefined};
        }""")
        if info is None:
            raise AssertionError("#stage-fallback image is missing")
        if info["hidden"] or info["display"] == "none" or info["visibility"] == "hidden" or info["width"] < 50 or info["height"] < 20:
            raise AssertionError(f"fallback image is not visible: {info}")
        if not info["src"].endswith(f"battlefield-{mode}.svg"):
            raise AssertionError(f"fallback src {info['src']!r} does not end with battlefield-{mode}.svg")
        if not info["loaded"]:
            raise AssertionError(f"fallback image did not load: {info['src']}")
        if info["canvases"] or info["scene"]:
            raise AssertionError("?flat still created a WebGL scene")
        return {"src": info["src"], "size": [round(info["width"]), round(info["height"])]}

    run_check(case, "flat_fallback", fallback)

    def follows_theme() -> dict:
        other = "dark" if mode == "light" else "light"
        set_theme(page, other)
        settle(page, 100)
        src = page.get_attribute("#stage-fallback", "src")
        if not (src or "").endswith(f"battlefield-{other}.svg"):
            raise AssertionError(f"fallback src {src!r} did not follow the theme to {other}")
        set_theme(page, mode)
        settle(page, 100)
        return {"flipped_src": src}

    run_check(case, "flat_follows_theme", follows_theme)


def check_preview(page, mode: str, case: dict) -> None:
    def anchors() -> dict:
        broken = page.evaluate("""() => [...document.querySelectorAll('a[href^="#"]')]
            .map(link => link.getAttribute('href').slice(1))
            .filter(id => id && !document.getElementById(decodeURIComponent(id)))""")
        if broken:
            raise AssertionError(f"in-page links without a target: {broken}")
        return {"fragment_links": page.locator('a[href^="#"]').count()}

    def pictures() -> dict:
        other = "dark" if mode == "light" else "light"
        results = {}
        for name in (other, mode):
            set_theme(page, name)
            settle(page, 150)
            sources = page.evaluate("() => [...document.querySelectorAll('picture img')].map(image => image.getAttribute('src'))")
            wrong = [source for source in sources if f"-{name}." not in source]
            if wrong:
                raise AssertionError(f"pictures did not switch to {name}: {wrong}")
            results[name] = len(sources)
        broken = page.evaluate("() => [...document.images].filter(image => !(image.complete && image.naturalWidth > 0)).map(image => image.getAttribute('src'))")
        if broken:
            raise AssertionError(f"images failed to load: {broken}")
        return {"pictures": results}

    run_check(case, "preview_anchors", anchors)
    run_check(case, "preview_picture_theme_switch", pictures)


# Offline previews load github-markdown-css from a CDN; a blocked CDN is environment noise, not a page defect.
IGNORED_CONSOLE = (
    ("error", "favicon", "404"),
    ("error", "cdn.jsdelivr.net/npm/github-markdown-css", ""),
    # Firefox logs this when the dispose check calls renderer.forceContextLoss() on purpose.
    ("warning", "webgl context was lost", ""),
)


def ignored_console(kind: str, location: str, text: str) -> bool:
    return any(
        kind == rule[0] and rule[1] in location.lower() + " " + text.lower() and (not rule[2] or rule[2] in text)
        for rule in IGNORED_CONSOLE
    )


def run_case(browser, args, report: dict, layout: str, width: int, height: int, mode: str, endpoint: str) -> None:
    url = urljoin(args.base.rstrip("/") + "/", endpoint.lstrip("/"))
    label = f"{layout}-{mode}-" + (relabel(endpoint) or "root")
    case = {
        "label": label, "url": url, "layout": layout, "viewport": [width, height], "theme": mode,
        "errors": [], "console": [], "ignored_console": [], "page_errors": [], "checks": {}, "skipped": [],
    }
    report["cases"].append(case)
    context = browser.new_context(
        viewport={"width": width, "height": height}, color_scheme=mode, device_scale_factor=1,
        **mobile_options(args, layout),
    )
    # Equivalent to setting localStorage and reloading: the stored theme is in place before the page's first script.
    context.add_init_script("try { localStorage.setItem('warroom-theme', %s); } catch (error) {}" % json.dumps(mode))

    def console(message):
        if message.type not in ("warning", "error"):
            return
        entry = {"type": message.type, "text": message.text, "url": message.location.get("url", "")}
        (case["ignored_console"] if ignored_console(entry["type"], entry["url"], entry["text"]) else case["console"]).append(entry)

    def wire(target):
        target.on("console", console)
        target.on("pageerror", lambda error: case["page_errors"].append(str(error)))
        return target

    def side_page():
        # Extra pages in the same context (so the stored theme applies); their console output counts too.
        return wire(context.new_page())

    page = wire(context.new_page())
    try:
        response = page.goto(url, wait_until="networkidle", timeout=args.timeout_ms)
        if response is None or response.status >= 400:
            raise AssertionError("endpoint did not return a successful response")
        is_site = args.deployed or "site" in urlsplit(url).path.split("/")
        stage = wait_stage(page, args.timeout_ms) if is_site else None
        if is_site and not args.flat:
            if stage != "ready":
                case["errors"].append("scene fell back to the static image; 3D checks cannot run")
            else:
                run_check(case, "atlas_api_and_initial_preset", lambda: check_atlas_api(page, args))
                run_check(case, "scene_ready", lambda: check_scene_ready(page, args))
                run_check(case, "arrival_completes", lambda: check_arrival(page, args))
        run_check(case, "theme_button", lambda: check_theme_button(page, args, mode, is_site))
        settle(page, args.settle_ms)
        case["overflow"] = page.evaluate("() => ({scrollWidth:document.documentElement.scrollWidth, innerWidth:innerWidth})")
        if case["overflow"]["scrollWidth"] > case["overflow"]["innerWidth"]:
            case["errors"].append("horizontal page overflow")
        if is_site and args.flat:
            check_flat(page, args, mode, case)
            case["skipped"].append("scene checks: skipped by --flat")
        elif is_site and stage == "ready":
            run_check(case, "stage_pixels", lambda: check_stage_pixels(page, args, label))
            run_check(case, "camera_finite", lambda: camera_diagnostics(page, args.scene_global))
            run_check(case, "capture_data_url", lambda: check_capture(page, args, label))
            run_check(case, "replay_scrub", lambda: check_replay(page, args))
            run_check(case, "set_filter_top", lambda: check_filter(page, args))
            run_check(case, "theme_switch_keeps_scene", lambda: check_theme_switch_identity(page, args, mode))
            run_check(case, "deep_link_peak_map", lambda: check_deep_link(side_page, args, url))
            run_check(case, "voyage_cards", lambda: check_voyage_cards(page, args))
            run_check(case, "voyage_scroll", lambda: check_voyage_scroll(page, args))
            if layout == "desktop":
                run_check(case, "capture_orbit_hides_chrome", lambda: check_capture_orbit(side_page, args, url))
                run_check(case, "wheel_scrolls_page", lambda: check_wheel_scrolls_page(page, args))
                run_check(case, "keyboard_presets_1_to_4", lambda: check_keyboard_presets(page, args))
            run_check(case, "transfer_budget", lambda: check_transfer_budget(browser, args, url, layout, width, height, mode))
            if layout == "desktop" and not args.no_camera_sweep:
                run_check(case, "camera_sweep", lambda: camera_sweep(page, args, label))
                sweep = case["checks"].get("camera_sweep", {})
                if sweep.get("camera_finite", {}).get("skipped"):
                    case["skipped"].append(f"camera_finite: {sweep['camera_finite']['skipped']} of {len(sweep['poses'])} poses skipped, getDiagnostics() exposes no camera")
        if is_site and not args.flat:
            run_check(case, "semantic_controls", lambda: {"controls": semantic_controls(page)})
            case["skipped"].extend(
                f"control {entry['control']}: {entry.get('reason', 'skipped')}"
                for entry in case["checks"].get("semantic_controls", {}).get("controls", []) if entry["status"] == "skipped"
            )
        if is_site and stage == "ready" and not args.flat:
            # Last of the scene checks: it disposes the scene (and reloads the page when nothing rebuilds it).
            run_check(case, "dispose_and_reinit", lambda: check_dispose_reinit(page, args, label))
        if not is_site:
            check_preview(page, mode, case)
        settle(page, args.settle_ms)
        case["overflow_after_controls"] = page.evaluate("() => ({scrollWidth:document.documentElement.scrollWidth, innerWidth:innerWidth})")
        if case["overflow_after_controls"]["scrollWidth"] > case["overflow_after_controls"]["innerWidth"]:
            case["errors"].append("horizontal page overflow after controls")
        case["screenshot"] = str(args.out / f"{label}.png")
        page.screenshot(path=case["screenshot"], full_page=True)
    except Exception as error:
        case["errors"].append(str(error).strip().splitlines()[0] if str(error).strip() else type(error).__name__)
        try:
            case["screenshot"] = str(args.out / f"{label}-failure.png")
            page.screenshot(path=case["screenshot"], full_page=True, timeout=args.timeout_ms)
        except Exception:
            case["screenshot"] = None
    finally:
        case["passed"] = not (case["errors"] or case["console"] or case["page_errors"])
        context.close()


def mobile_options(args, layout: str) -> dict:
    # Firefox has no mobile emulation; touch alone is still applied.
    if layout != "mobile":
        return {}
    return {"has_touch": True} if args.browser == "firefox" else {"is_mobile": True, "has_touch": True}


def launch(playwright, args):
    if args.browser != "chromium":
        return getattr(playwright, args.browser).launch(headless=True)
    options = {"headless": True}
    if args.software_gl:
        options["args"] = SOFTWARE_GL
    try:
        return playwright.chromium.launch(channel=args.channel or None, **options)
    except Exception as error:
        if not args.channel:
            raise
        print(f"Chrome channel {args.channel!r} unavailable ({str(error).splitlines()[0]}); falling back to bundled Chromium.", file=sys.stderr)
        return playwright.chromium.launch(**options)


def run_browser(args, sync_playwright) -> dict:
    report = {
        "base": args.base, "started": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "pixel_check_scope": PIXEL_SCOPE, "scene_expression": f"window.{args.scene_global}",
        "camera_contract": f"window.{args.scene_global}.debugOrbit(azimuthDegrees, elevationDegrees); getDiagnostics() camera/target {{x,y,z}}",
        "browser": args.browser, "deployed": args.deployed,
        "mode": "flat" if args.flat else "scene", "cases": [], "model_tests": {"passed": False},
    }
    endpoints = args.endpoint or (["/"] if args.deployed else ["/site/?flat"] if args.flat else ["/site/", "/.preview/"])
    with sync_playwright() as playwright:
        browser = launch(playwright, args)
        try:
            report["browser_version"] = f"{args.browser} {browser.version}"
            report["model_tests"] = ({"passed": True, "skipped": "the deployed site publishes no tests/"} if args.deployed
                                     else check_model_tests(browser, args))
            for layout, width, height in (("desktop", 1440, 1000), ("mobile", 390, 844)):
                for mode in ("light", "dark"):
                    for endpoint in endpoints:
                        run_case(browser, args, report, layout, width, height, mode, endpoint)
        finally:
            browser.close()
    report["skipped"] = [f"{case['label']} :: {entry}" for case in report["cases"] for entry in case["skipped"]]
    report["passed"] = report["model_tests"]["passed"] is True and all(case["passed"] for case in report["cases"]) and not (args.fail_on_skipped and report["skipped"])
    return report


def relabel(value: str) -> str:
    return "-".join(part for part in value.replace(".", "").split("/") if part).replace("?", "-").replace(":", "-")


def print_failures(report: dict) -> None:
    model = report.get("model_tests", {})
    if model.get("passed") is not True:
        print(f"  model tests FAILED: {model.get('error')}")
    for case in report.get("cases", []):
        if case["passed"]:
            continue
        print(f"  FAIL {case['label']} ({case['url']})")
        for error in case["errors"]:
            print(f"    error: {error}")
        for entry in case["console"]:
            print(f"    console {entry['type']}: {entry['text']} [{entry['url']}]")
        for error in case["page_errors"]:
            print(f"    pageerror: {error}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Optional isolated Playwright/Chrome integration checks. Evidence must be outside the repository. " + PIXEL_SCOPE)
    parser.add_argument("--base", default="http://127.0.0.1:8766")
    parser.add_argument("--endpoint", action="append", help="Repeat for endpoints; defaults to /site/ and /.preview/ (or /site/?flat with --flat)")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--browser", choices=BROWSERS, default="chromium", help="Playwright browser engine (default: chromium)")
    parser.add_argument("--channel", default="chrome", help="Chromium channel; pass '' for Playwright's bundled Chromium")
    parser.add_argument("--deployed", action="store_true", help="--base is the published site root (every endpoint is a War Room page; no tests/ or .preview/)")
    parser.add_argument("--software-gl", action="store_true", default=bool(os.environ.get("CI")), help="Software WebGL flags for Chromium on GPU-less runners (default on when CI is set)")
    parser.add_argument("--flat", action="store_true", help="Test the /site/?flat static fallback: visible themed <img>, no scene, no console output")
    parser.add_argument("--scene-global", default="__atlas.scene", help="Dotted window expression that resolves to the scene API (default: __atlas.scene)")
    parser.add_argument("--no-camera-sweep", action="store_true")
    parser.add_argument("--fail-on-skipped", action="store_true", help="Treat any skipped check as a failure")
    parser.add_argument("--settle-ms", type=int, default=300)
    parser.add_argument("--timeout-ms", type=int, default=30000)
    args = parser.parse_args()
    args.out = args.out.expanduser().resolve()
    try:
        args.out.relative_to(ROOT)
    except ValueError:
        pass
    else:
        parser.error("--out must be outside the repository")
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("browser_check.py needs Playwright, which is optional and not a repository dependency.\n"
              "Run it with an already provisioned isolated interpreter, for example:\n"
              "  /tmp/ui-review-abhi/.venv/bin/python -I scripts/browser_check.py --out <dir outside the repo>\n"
              "Nothing was checked.", file=sys.stderr)
        return 2
    args.out.mkdir(parents=True, exist_ok=True)
    try:
        report = run_browser(args, sync_playwright)
    except Exception as error:
        report = {"passed": False, "error": str(error), "pixel_check_scope": PIXEL_SCOPE, "cases": [], "skipped": []}
    evidence = args.out / "report.json"
    evidence.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    cases = report.get("cases", [])
    print(f"{'PASS' if report['passed'] else 'FAIL'} browser checks: {sum(case['passed'] for case in cases)}/{len(cases)} cases; "
          f"{len(report.get('skipped', []))} checks SKIPPED (not passed); evidence {evidence}")
    if report.get("error"):
        print(f"  runner error: {report['error']}")
    print_failures(report)
    for entry in sorted(set(item.split(" :: ", 1)[-1] for item in report.get("skipped", []))):
        print(f"  skipped: {entry}")
    print(PIXEL_SCOPE)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
