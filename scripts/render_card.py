#!/usr/bin/env python3
"""Rasterize the social card: the light battlefield on a paper strip, 1200×630 PNG.

Link previews (Slack, LinkedIn, X) do not render SVG, so CI screenshots this
composition with headless Chromium and stages it as site/card.png, which
site/index.html names in its og:image and twitter:image tags. Playwright is a
CI-only dependency: locally the script explains what is missing and exits 2.
"""
from __future__ import annotations

import argparse
import base64
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "generator"))
from theme import FONT_BODY, FONT_SERIF, STRAW_HAT  # noqa: E402

W, H = 1200, 630
TITLE_H = 60
NAME = "Abhishek Vishwakarma"
EDITION = "Engineering Atlas"
URL_TEXT = "abhi-at-rei.github.io/abhi-at-rei"


def card_html(svg: bytes) -> str:
    """The 1200×630 page: a title strip above the battlefield, fitted to the width."""
    data = base64.b64encode(svg).decode("ascii")
    img_w = 1040
    return f"""<!doctype html><meta charset="utf-8">
<style>
  html, body {{ margin: 0; width: {W}px; height: {H}px; overflow: hidden; background: #FBF7EE; }}
  .strip {{ position: absolute; left: 0; top: 0; width: {W}px; height: {TITLE_H}px;
    display: flex; align-items: center; justify-content: space-between; padding: 0 80px; box-sizing: border-box;
    font-family: {FONT_BODY}; color: #1B1B1F; }}
  .name {{ font-family: {FONT_SERIF}; font-size: 26px; letter-spacing: .01em; }}
  .name small {{ font-family: {FONT_BODY}; font-size: 13px; letter-spacing: .22em; text-transform: uppercase;
    color: #5C5C66; margin-left: 18px; vertical-align: 3px; }}
  .url {{ font-size: 15px; color: #5C5C66; }}
  .url b {{ color: #B07F00; font-weight: 600; }}
  .rule {{ position: absolute; left: 80px; right: 80px; top: {TITLE_H - 1}px; height: 2px;
    background: linear-gradient(90deg, transparent, {STRAW_HAT["sun_gold"]} 12%, {STRAW_HAT["sun_gold"]} 88%, transparent); }}
  img {{ position: absolute; left: {(W - img_w) // 2}px; top: {TITLE_H}px; width: {img_w}px; display: block; }}
</style>
<div class="strip"><span class="name">{NAME}<small>{EDITION}</small></span><span class="url"><b>↗</b> {URL_TEXT}</span></div>
<div class="rule"></div>
<img alt="" src="data:image/svg+xml;base64,{data}">
"""


def render(svg_path: Path, out: Path) -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("render_card: Playwright is not installed; CI installs it with "
              "`pip install playwright && python -m playwright install --with-deps chromium`.", file=sys.stderr)
        return 2
    html = card_html(svg_path.read_bytes())
    out.parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel="chrome")
        except Exception:
            browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
        page.set_content(html, wait_until="load")
        page.wait_for_timeout(150)  # frame 0 is complete by design; let the image decode
        page.screenshot(path=str(out), clip={"x": 0, "y": 0, "width": W, "height": H})
        browser.close()
    print(f"wrote {out} ({out.stat().st_size // 1024} KB)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--svg", type=Path, default=ROOT / "dist" / "battlefield-light.svg")
    ap.add_argument("--out", type=Path, default=ROOT / "site" / "card.png")
    args = ap.parse_args()
    if not args.svg.exists():
        print(f"render_card: {args.svg} is missing; run generator/build.py first.", file=sys.stderr)
        return 1
    return render(args.svg, args.out)


if __name__ == "__main__":
    sys.exit(main())
