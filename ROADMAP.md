# Roadmap: a more immersive Engineering Atlas

Written November 16, 2026 from a live audit of https://github.com/abhi-at-rei and
https://abhi-at-rei.github.io/abhi-at-rei/. `DESIGN.md` stays the binding spec (scenery
only, no faction names, English, colour means intensity, aggregates only, light default).

## Where it stands today

- The daily job has succeeded on all of its last 20 runs. Live data: 679 contributions,
  57 active days, peak 63 on Oct 29, October 255, November 231 so far.
- War Room: about 60 fps on desktop and phone emulation, 350–370 KB transferred in 19
  requests, 2.3–3.2 s to idle, clean console in both themes. There is headroom for richer
  visuals.
- Tested in Chrome only.

## Phase 0: fixes found in the audit (small, do first)

1. **The current month is missing from the month row.** November (231) has no pill in the
   README battlefield (the row stops at "Oct 255") or in the 3D view (the "Now" pill wins
   the collision). The current month must always be shown; "Now" can merge into it
   ("Nov 231 · now").
2. **The 3D stage starts below the fold.** At 1440×900 it begins around y=555; on a phone it
   is more than a screen down. The main attraction is not visible on arrival (Phase 1).
3. **Light-mode skyline reads as grey untextured boxes**, and the "Peak" label sits on the
   moon in Front. Both are solved by Phase 3's tower and label work, but the label can be
   nudged now.

## Phase 1: the scene becomes the hero

- Full-bleed stage filling the first viewport; the headline "A little curiosity. A world of
  contributions." and the three numbers sit over the sky as overlay type and glass chips.
- Controls dock along the bottom edge of the stage (presets, filter, replay) instead of a
  toolbar above it. On phones the stage takes about 70vh with the headline over it and the
  dock collapses to one row plus a sheet.
- One-time arrival: a 2.5 s camera dolly from open water to the Front pose. The first frame
  is already a complete picture; reduced motion skips straight to Front.
- Loading: the static battlefield SVG shows immediately and cross-fades into WebGL, so there
  is never a blank or spinner-only state.

## Phase 2: richer, data-driven 3D

- **Towers with character:** bevelled caps, soft contact shadows, lit windows in the dark
  theme (window count scales with the day's contributions), a beacon on the peak tower.
- **Day to night:** the theme toggle animates sunset and moonrise in about 1.2 s instead of
  rebuilding the scene (today a theme switch recreates it and resets the camera).
- **Living water:** tower reflections, the ship bobbing with a wake, the lighthouse beam
  sweeping, a small flock of birds on a looped path.
- **Weather that means something:** rain density follows quiet weeks, embers rise from the
  hottest days. Atmosphere becomes a reading of the data, not decoration.
- **Touchable days:** hover lifts a tower on a spring and dims its neighbours; click flies
  the camera to that day and slides the daily record in; arrow keys walk day to day with the
  camera following.

## Phase 3: the voyage (scroll-driven story)

- Scrolling moves the camera through chapters built from the model, never hard-coded:
  Set sail (join date) → first streak → best week → peak day → now. Each chapter pins one
  caption card with its numbers.
- Implemented as scroll progress mapped to a camera path plus the existing replay API, so
  the towers rise as the story advances.
- Reduced motion: the chapters become still cards with pre-framed captures.

## Phase 4: interface polish

- Timeline scrubber with month ticks and a sparkline of daily counts; the running total
  counts up while playing.
- Filters as toggle chips (Top days, Longest streak, Weekdays, Weekends) instead of a select.
- Deep links: `#day=2026-10-29&view=cinematic` opens on that day and view; a "Copy link"
  button in the daily record.
- Keyboard: 1–4 presets, Space play/pause, ←/→ day, Esc close; a "?" sheet lists them.
- Phone: bottom sheet with snap points; optional "tilt to look" parallax behind an explicit
  permission tap.

## Phase 5: README (no JavaScript allowed there; CSS/SMIL inside SVG only)

- **A real 3D preview in the README:** CI records a 6-second orbit of the War Room with
  headless Chromium and publishes an animated WebP (target ≤ 2.5 MB) to the `output` branch.
  It becomes the link into the War Room. This is the highest-impact item for the profile
  page itself.
- **This week strip:** seven mini bars, today's count and the live streak, re-rendered daily,
  so the page visibly changes day to day.
- **Battlefield motion:** drifting clouds on two parallax layers, the lighthouse beam, the
  ship's bob, twinkling windows in dark mode, a soft pulse on today's tower. Frame 0 stays
  complete and every file stays under 250 KB.
- Tidy: the Toolkit section repeats its list as icons and text; keep the text for phones and
  screen readers but set it smaller.

## Phase 6: quality gates before each release

- Safari and Firefox passes, plus one real iPhone and one Android phone.
- Lighthouse performance and accessibility ≥ 90, measured, not assumed.
- Frame budget: 60 fps on desktop, ≥ 45 fps on a mid-range phone, with quality tiers that
  drop reflections and window lights first.
- Transfer budget ≤ 600 KB for the War Room; reduced-motion parity for every new animation.
- Model tests for the chapter derivation; browser checks extended to the arrival, the
  day/night transition and deep links.

## Suggested order

Phase 0 → Phase 1 → the "touchable days" and day-to-night parts of Phase 2 → the README 3D
preview from Phase 5 → Phase 3 → the rest. Each phase ships on its own and is verified with
the existing checker, unit tests and browser sweep.

## Build contract (November 16, all phases in parallel)

Six lanes own disjoint files. Lanes code against this contract and feature-detect
(`typeof scene.flyTo === 'function'`) so they can land in any order.

| Lane | Owns | Phases |
|---|---|---|
| Scene | `site/scene.js` | 0 (3D month row, peak label), 2 (all), scene side of 1/3/4 |
| UI | `site/index.html`, `site/style.css`, `site/app.js` | 1, 4, UI side of 3 |
| Voyage | `site/voyage.js`, `site/voyage.css` | 3 |
| README art | `README.md`, `generator/battlefield.py`, `generator/build.py`, new `generator/week.py`, `assets/` | 0 (README month row), 5 |
| Tooling | `scripts/`, `.github/workflows/`, `tests/test_check.py`, `tests/test_renderers.py` | 5 (orbit recording), 6 |
| Achievements | `generator/fetch.py`, `generator/cards.py` (seals only), `generator/achievements.json`, new `tests/test_achievements.py` | live achievement rings |
| Lead | `site/model.js`, `tests/model.test.js`, `DESIGN.md`, `HANDOVER.md`, this file | chapters, integration, QA |

### Scene API additions (`createScene` return value; existing methods unchanged)

- `ready: Promise<void>` resolves after the first complete frame is on screen.
- `playArrival({ duration = 2500 } = {}) → Promise` one-time dolly from open water to the
  current preset pose. Resolves at once under reduced motion.
- `skipArrival()` marks the arrival `skipped`; mid-dolly it lands on the current preset at once.
- `setTheme(theme, { animate = false } = {})` with `animate: true` cross-fades sky, water,
  lights and fog over about 1200 ms (sunset or moonrise) without rebuilding. Instant under
  reduced motion. The UI stops recreating the scene on a theme switch.
- `flyTo(date, { duration = 1200 } = {}) → Promise` frames one day's tower.
- `getCameraPose() → { position: {x, y, z}, target: {x, y, z}, fov }`
- `setCameraPose(pose, { duration = 0 } = {}) → Promise`
- `poseForRange(startDate, endDate) → pose` a framing for a range of days (one day when equal).
- `setHighlight(dates: string[] | null)` emphasises a set of days and dims the rest,
  independent of `setFilter`; `null` clears.
- `setParallax(dx, dy)` with dx, dy in [-1, 1]: a small eased camera offset; no-op under
  reduced motion.
- Hover lift and neighbour dimming happen inside the scene for pointer hover and `setHover`.
- `getDiagnostics()` adds `theme`, `arrival` (`pending|playing|done|skipped`),
  `highlightCount` and `themeTransition` (boolean).

### Page structure (UI lane)

```
<main>
  <section class="world" id="explore">          one tall section
    <div class="stage" id="stage">                sticky, full-bleed: 100svh desktop, 70svh phone
      #stage-fallback (static SVG, shown first)   #stage-canvas   #stage-labels
      .hero overlay: h1#page-title + metric chips (pointer-events: none except links)
      .dock: presets, filter chips, replay scrubber + sparkline, view settings, explore toggle
      #details (daily record), #stage-toast, #stage-loading
    </div>
    <div class="voyage" id="voyage"></div>        filled by voyage.js; scrolls over the pinned stage
  </section>
  heatmap, insights, craft, journey, footer (existing content, existing ids)
</main>
```

- `site/voyage.css` is linked in `<head>`. After the scene is created the app calls
  `mountVoyage({ root, model, getScene, reducedMotion, onEnter, onExit, onChapter })`;
  `onExit` restores the user's preset, replay progress 1 and clears the highlight.
  While a chapter is active the voyage sets `document.documentElement.dataset.voyage = 'active'`;
  the UI hides the dock and hero overlay then.
- Deep links: `#day=YYYY-MM-DD&view=front|map|isometric|cinematic`, read on load and kept
  current with `history.replaceState`. A deep link skips the arrival.
- `?capture=orbit` hides all chrome, sizes the stage to the viewport, turns motion off and
  skips the arrival; used by `scripts/record_orbit.py`.
- Keyboard: 1–4 presets, Space play/pause, ←/→ previous/next day, Esc close, ? shortcut sheet.

### Story chapters (lead, `site/model.js`)

`buildChapters(model)` returns chapters in date order, each
`{ id, index, kicker, title, body, dates, start, end, progress, metrics: [{ label, value }] }`
with ids `sail`, `first-streak`, `best-week`, `peak`, `now`; chapters without data are
omitted. `progress` is the replay position at the chapter's last day.

### README assets (README art and tooling lanes)

- `dist/week-{light,dark}.svg` this-week strip, registered in `generator/build.py`.
- `dist/orbit-{light,dark}.webp` 6-second looping flight recorded by `scripts/record_orbit.py`
  in CI (≤ 2.5 MB each), published to the `output` branch with the SVGs.
- The README's achievements line links to the profile's Achievements tab instead of listing
  names, because the rings now update from the live profile.
