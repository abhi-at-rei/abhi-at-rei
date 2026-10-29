# CURRENT STATE — October 26, 2026 (Claude integration pass, after Devin)

Read this section first. It supersedes the Devin handover and the historical notes below.
Everything is local: there are no commits, no remote, nothing published, nothing deployed.

## What is done

The redesign is integrated and verified as a reviewable candidate. Five lanes ran in
parallel with disjoint file ownership, then one integration/QA pass:

1. **README artwork** (`generator/battlefield.py`, `cards.py`, `art_caption.py`, `README.md`,
   `assets/caption-*`, `dist/*`): the battlefield shows real water before the join date in
   both themes (sun path, ship, lighthouse, wake), a HUD with the labelled matched-period
   momentum ("+900% · Oct 1–25 over Sep 1–25", shared helper `matched_momentum`), streak
   bridge and peak pennant; frame 0 is complete; worst-case fixture size is ~227 KB. The
   README order is in `DESIGN.md`. The caption strip is an editorial field-note with a
   compass and a typewriter. The dossier shows the same labelled momentum.
2. **Snake** (`generator/snake.py`): straw-hat head with no face, bead body on a measured
   path, eat/pop/regrow loop of ~22 s, seamless at the loop boundary, reduced-motion still,
   840×214, ~72 KB (fixtures ≤ 226 KB).
3. **War Room scene** (`site/scene.js`): Front is a finished composition on desktop and
   phones; Map frames the whole calendar; replay hides unrevealed days, peak/sail markers and
   bridges and ignores hidden instances in picking; synchronous scrub when motion is off,
   reduced or offscreen; muted blue-grey light water with gold glitter; label collision
   culling (pre-join zero months hidden outside Map); controls/composer/passes tracked for
   dispose after partial init; `getDiagnostics()` exposes `camera`, `target` and `fov`;
   baseline comment tokens restored (79 of 85; the 6 missing belong to removed code).
4. **War Room UI** (`site/index.html`, `style.css`, `app.js`): Front default, touch
   exploration opt-in and applied before first render, `model.bestMonth` highlight, one-day
   slider steps, reduced-motion "Step one week", fallback and noscript use
   `./battlefield-{light,dark}.svg` inside `site/`, og/twitter image metadata, details panel
   with rank/ties/ratio/week/month context, focus management. Phone audit at 375/390: no text
   below 12 px, no control under 44 px, no horizontal overflow.
5. **Tooling** (`scripts/check.py`, `browser_check.py`, `preview.py`, `tests/`, workflow):
   strict SVG policy (no script/handlers/foreignObject/external URLs/CJK, singular "straw hat"
   allowed, crew name banned), README picture/anchor checks, site reference checks, browser
   checker with dotted scene lookup, camera sweep, flat mode, console, replay, filter,
   capture and dispose checks; workflow stages `stats.json` and the fallback SVGs into
   `site/` before tests and checks. Preview adds GitHub-style ids to API-rendered headings.
6. **Shared model** (`site/model.js`, `tests/model.test.js`): `bestMonth` (greatest total,
   earliest on ties, null without positive activity) with tests.

## Verification evidence (all under the session scratchpad)

`/private/tmp/claude-205849495/-Users-avishwakarma-Documents-GitHub/b09ae978-d8ee-4a17-9f85-aeb1d5b14996/scratchpad/`

- `shots/qa1/`: README and War Room, light/dark × desktop/phone, every preset, replay at
  0/35/70, flat fallback, reduced motion, plus `summary.json` (state, camera, console,
  small-text and small-target audits).
- `shots/final/`: final README previews. `shots/bc-final2/report.json`: browser checker run.
- `laneA/`, `laneB/shots/`, `laneC/final/`, `laneS/`, `laneD/run1/`: per-lane evidence,
  including the 7×3 camera sweep in both themes (`laneC/final/sweep-contact.png`).
- Results at hand-back: `unittest` OK (45 tests), `scripts/check.py` 34/34, browser checker
  PASS with zero console errors, `tests/model.test.js` `{passed: true}`.

These temp paths disappear on reboot; regenerate with the commands below.

## Commands (absolute paths; this Mac resets the shell cwd between tool calls)

```sh
python3 generator/art_caption.py && python3 generator/build.py
cp dist/battlefield-*.svg site/ && cp data/stats.json site/stats.json
python3 scripts/preview.py            # gh Markdown API; add --offline without gh
python3 -m unittest discover -s tests -p 'test_*.py'
python3 scripts/check.py
/tmp/ui-review-abhi/refresh-mirror.sh # mirror served at http://127.0.0.1:8766
/tmp/ui-review-abhi/.venv/bin/python scripts/browser_check.py --base http://127.0.0.1:8766 --out /tmp/bc
```

Mac notes: the Menlo proxy breaks Python TLS, so run `fetch.py` without a token (it uses
`gh`); `SSL_CERT_FILE=~/.local/certs/bundle.pem` fixes Python HTTPS; `uv` needs
`--system-certs`; no Node or Homebrew; macOS blocks app-launched servers from reading
`~/Documents`, so serve a copy (the mirror script does this).

## Honest remaining limitations

- Chrome only (Playwright, ANGLE/Metal). Safari, Firefox and real phones are untested; no
  Lighthouse or performance numbers.
- The browser pixel policy catches catastrophic black/blank frames only.
- On phones the battlefield SVG's HUD text is tiny; the native README text carries the numbers.
- Towers are small on phones (26 land weeks in ~350 px) in the 3D Front view.
- `og:image` is an SVG, which some social platforms will not render; a PNG social card is a
  follow-up.
- shields.io has no AWS or OpenAI logos (brand icons were removed from simple-icons), so the
  "Bedrock · OpenAI" badge embeds an original cloud-and-spark logo as a base64 `logo=` value.
- Oct 28 live audit fixes: `fetch.py` creates `data/` before saving the avatar (CI has no
  `data/` directory, so the first published poster fell back to the straw-hat portrait); the
  battlefield HUD tightens its type when the column text grows; the highlighted streak is
  always the longest one (a short live streak used to replace the record and collide with the
  peak label); the streak label steps clear of the peak pennant.
- Oct 29 future-proofing: the battlefield keeps a five-week harbour margin once the join week
  has aged out of the 53-week window (from May 2027), so the ship, lighthouse and sun path
  survive; leading empty months get no row of zero pills (README art and War Room); the
  "active days since <join>" label falls back to "in the last year" when the join date is
  outside the window. Verified by rendering synthetic stats (join 2024, window ending Nov 1
  and Jan 1) and by loading the War Room with a no-sea stats.json: no console errors.
- GitHub runs the 03:17 UTC cron late under load (observed 09:00–09:45 UTC); the data is still
  refreshed daily.
- The workflow has never been run; CI uses Python 3.12 and the local system is 3.9.

## Guardrails

Work locally in `/Users/avishwakarma/Documents/GitHub/abhi-at-rei`. Do not create a GitHub
repository, commit, push, enable Pages or publish without the user's explicit go-ahead.
Commits, when approved, are authored only under the user's git identity with no AI
attribution. Keep `DESIGN.md` as the binding spec.

## Publish checklist (only on approval)

1. `git add -A && git commit` under the user's identity (no AI trailer).
2. Create `abhi-at-rei/abhi-at-rei` (public), push `main`.
3. Settings → Pages → Source: GitHub Actions. Run the workflow once (`workflow_dispatch`).
4. Confirm the `output` branch holds `dist/*.svg` and the Pages URL serves `site/`.
5. Open the profile in light and dark, desktop and phone; open the War Room link.

---

# HISTORICAL HANDOVER: "The Clash" GitHub profile for `abhi-at-rei`

**Handing over to:** Devin, for implementation, with independent review by Grok and OpenAI models.
**From:** Claude Code session, Oct 25–26, 2026, working with Abhishek Vishwakarma (`abhi-at-rei`).
**Read with:** [`DESIGN.md`](DESIGN.md), the binding spec covering rules, constraints and data.

---

## 1. Status at a glance

| Area | State | Notes |
|---|---|---|
| Data pipeline (`fetch.py` → `stats.json`) | ✅ Working | Real data: 313 contributions, 309 private |
| Hero banner, caption, ribbons, footer | ✅ Done | Scenery only, no characters and no faction names |
| Most Valued poster + Bingo Book | ✅ Done | The latest round of feedback is applied |
| Battlefield SVG (straight-on 3D city) | ✅ Done | Colour shows intensity; adds month totals, a streak bridge and momentum |
| Snake SVG (custom, stdlib) | ✅ Done | Uses the `POWER` ramp; animated with SMIL and CSS |
| Achievement rings | ✅ Done | English engravings: MERGE, DUO, SWIFT, BOLD, CREW |
| README | ✅ Done | Light/dark `<picture>` on every image; the user's final copy |
| CI workflow (`.github/workflows/profile.yml`) | ⚠️ Written, never run | No GitHub repo exists yet |
| **War Room (`site/`)** | ❌ **Broken, mid-refactor** | The 3D view crashes; see §6.1 |
| Published to GitHub | ❌ Not yet | No repo or remote, and nothing committed; the user must approve |

## 2. Get it running

**Location:** the project lives only on this Mac, at
`/Users/avishwakarma/Documents/GitHub/abhi-at-rei`. It is a git repo with no commits and no
remote. Work in that folder directly.

**Notes for this Mac:**
- **Python HTTPS:** a Menlo Security TLS-inspecting proxy breaks Python HTTPS here (curl and
  `gh` work).
  - Run `generator/fetch.py` **without** `GITHUB_TOKEN`/`PROFILE_TOKEN` set, so it falls
    back to the `gh` CLI, and the avatar download falls back to curl.
  - If you need Python HTTPS, set `SSL_CERT_FILE=~/.local/certs/bundle.pem` first.
  - `uv pip install` needs `--system-certs`.
- **No Node or Homebrew:** none is installed, so keep tooling stdlib Python or standalone
  binaries.
- **Local server:** a server started by a desktop app may be blocked by macOS from reading
  `~/Documents` (`PermissionError` in `os.getcwd`). If that happens, copy `assets/`,
  `dist/`, `.preview/` and `site/` to a temp folder and serve from there.
- **Python version:** system Python is 3.9, so keep generators 3.9-compatible.


```bash
# All generators are stdlib Python and also run on 3.9.
python3 generator/fetch.py            # GITHUB_TOKEN or PROFILE_TOKEN; falls back to the `gh` CLI locally
python3 generator/build.py            # writes dist/*.svg (wanted, bingo, seals, battlefield, snake), both modes
python3 generator/art_banner.py       # static art in assets/ (also art_caption, art_ribbons, art_footer)
python3 scripts/preview.py            # renders README.md via the GitHub markdown API into .preview/index.html
cp data/stats.json site/stats.json    # the War Room reads ./stats.json (gitignored; CI copies it)
python3 -m http.server 8765           # then open /.preview/index.html (Light/Dark switch) and /site/
```

`dist/`, `data/`, `.preview/` and `site/stats.json` are generated and gitignored.

## 3. Architecture

```
GitHub GraphQL (user.contributionsCollection; aggregate calendar, private counts included)
        │  generator/fetch.py  (+ avatar download)
        ▼
data/stats.json ── generator/build.py ──► dist/{wanted,bingo,seals,battlefield,snake}-{light,dark}.svg
        │                                   │  CI: crazy-max/ghaction-github-pages → `output` branch
        │                                   ▼
        │                           README <picture> → raw.githubusercontent.com/.../output/*.svg
        │
        └── CI copies to site/stats.json ──► site/ (Three.js War Room) → actions/deploy-pages → GitHub Pages
assets/*.svg (static art, generator/art_*.py) ──► README via relative paths on `main`
```

- **Theme switching:** every README image is a `<picture>` with a `prefers-color-scheme: dark`
  source, so GitHub picks the variant from the viewer's theme.
- **Theme tokens:** live in `generator/theme.py`. `POWER` is the single intensity ramp.
- **Schedule:** CI runs daily at 03:17 UTC, on manual dispatch, and on pushes to `generator/`,
  `assets/`, `site/` or the workflow.
- **Action versions:** checked against GitHub releases on Oct 25, 2026: checkout v7,
  setup-python v7, ghaction-github-pages v5, upload-pages-artifact v5 and deploy-pages v5.

## 4. File map

| Path | Lines | Purpose |
|---|---|---|
| `generator/theme.py` | 87 | Palette, `POWER` ramp, font stacks, width |
| `generator/fetch.py` | 195 | GraphQL fetch, streaks, monthly and weekday totals, avatar |
| `generator/build.py` | 40 | Calls the renderers and writes `dist/` |
| `generator/cards.py` | 1108 | `render_wanted` (Most Valued), `render_bingo`, `render_seals` |
| `generator/battlefield.py` | 944 | Straight-on 3D city: sun, glitter path, ship, HUD, month totals, streak bridge, a `<title>` per day |
| `generator/snake.py` | 394 | Greedy-path snake, SMIL motion, per-cell CSS keyframes |
| `generator/art_banner.py` | 524 | Hero banner: scenery only |
| `generator/art_caption.py`, `art_ribbons.py`, `art_footer.py` | ~180 each | Static art |
| `generator/achievements.json` | – | Mirrors the profile's Achievements tab (GitHub has no API for it) |
| `site/index.html`, `app.js`, `scene.js`, `style.css` | 135 / 731 / 1660 / 742 | The War Room |
| `scripts/preview.py` | 73 | Local README preview with a Light/Dark switch, light by default |
| `.github/workflows/profile.yml` | 77 | Daily build, the `output` branch and Pages |

## 5. Decision log (what the user asked for, and why things look the way they do)

Read this before proposing changes. Each line is a reversal or preference the user stated explicitly.

1. **Theme:** Gear 5 Luffy and Zoro against Itachi and Pain, on a work account, with
   contributions highlighted.
2. **Constraint: most contributions are private** (309 of 313). Hosted widgets
   (github-readme-stats and similar) would show about 2 commits and are rate-limited, so
   we built our own generator from the public calendar. No repo-scoped token is needed and
   nothing private can leak.
3. **Light/dark:** both themes are supported, but **each mode shows the whole scene** rather
   than one faction per mode.
4. **English everywhere:** the kanji on the rings was replaced with MERGE, DUO, SWIFT, BOLD
   and CREW.
5. **Poster tagline:** "for shipping ambitious software" became "for shipping perfect
   software in record time".
6. **Characters were rejected three times:**
   - chibi figures were rejected;
   - hand-drawn "realistic" faces were called a "bad drawing";
   - cinematic silhouettes were still not good enough.

   The user then asked to **remove all characters**. Do not reintroduce drawn people.
   Real character art would have to be licensed or commissioned raster art, and the user
   has not asked for that.
7. **No "STRAW HATS", "VS" or "AKATSUKI" text anywhere.**
8. **Contribution graph:**
   - The user asked for it to be clickable and to show all data like GitHub's. README
     images can't be interactive, so we added a `<title>` per day plus the War Room page.
   - The user wanted a straight view rather than a slant, with better animation.
   - The user asked for a stronger sun and a bigger boat.
9. **The gold/crimson split** (the point where half the year's total was reached) **was
   meaningless**, so colour now means intensity only.
10. **Copy:**
    - Less AI wording; "AI Expert · developing solutions since 2016".
    - "AI Engineer at REI Systems".
    - "delivering secure software from 2016".
    - Banking, fintech and blockchain until 2025, then AI.
11. **"WANTED" became "MOST VALUED · ENGINEER"** with an upgraded UI.
12. **Bingo Book:** "Threat level" became "Monthly momentum", and "Chakra" became "Focus".
13. **Default theme is light** (preview and War Room); the preview has an explicit switch.
14. **Global preference (`~/.claude/CLAUDE.md`):** commits are authored solely as the user,
    with **no AI co-author or "Generated with" lines**. When asked to finalize, push to the
    existing remote.

## 6. Open issues (highest priority first)

### 6.1 The War Room is broken (P0)
- **Symptom:** opening `/site/` logs `3D view failed to start: ReferenceError: frontX is not
  defined at createScene (scene.js:1166)`. The page then falls back to the flat heatmap.
- **Cause:** the agent rewriting it stopped partway through the redesign in §7. It removed
  the front-line split (and `frontX`), but left a "Front line" label at `scene.js:1166`
  that still references `frontX`, and `peakDay.faction` is still used just above it. It
  had also started adding NaN guards (13 `isFinite`/`clamp` sites in `scene.js`).
  `app.js` (4 hits) and `index.html` (7 hits) still say "Gold side" and "Crimson side",
  which also breaks the no-faction-names rule.
- **Original bug report from the user:** "half screen goes black on movement sometimes".
  The likely cause is NaN or Inf values from the god-ray pass, the corona, beam or glitter
  shaders, or the lens flare, spreading through `UnrealBloomPass` when the sun is behind or
  at the edge of the camera.
  - Fix the cause: guard the shaders, clamp the HDR output before bloom, and disable the
    god rays when the sun's clip w ≤ 0 or the sun is off-screen.
  - Prove the fix with an automated orbit sweep: about 60 camera poses in both themes,
    sampling `readPixels` for black or NaN regions.

### 6.2 Other known issues
- **Battlefield frame 0 is empty.** The towers rise over 2.4 s, so static thumbnails and
  social cards show an empty board. Consider a static `og:image`.
- **Snake fallback:** a renderer without SMIL draws the snake beads at the top-left. Every
  browser GitHub supports has SMIL.
- **Untested engines:** banner wind pivots and `<use>`-cloned animations were only checked in
  Chromium. Safari and Firefox are untested.
- **Font-width guesses:** ribbon and poster text widths are estimated for Impact and Georgia,
  so fallback fonts may shift them a few pixels.
- **Tooltips:** the per-day `<title>` tooltips only work when the SVG is opened directly.
- **CI never run:** Pages must be enabled with source "GitHub Actions", and the `output`
  branch is created on the first run.
- **Tech-stack badges:** skillicons.dev and shields.io are the only external README
  dependencies.

## 7. Unfinished War Room redesign (spec the user approved)

- **Colour = intensity:** use `POWER` (mirror the hex values in `style.css` and `scene.js`)
  with a "Less → More" legend. Remove every gold/crimson side label and the front line. Keep
  the theme in the scenery: sun and ship on the left; red moon, clouds and rain on the right.
- **Month districts:** a ground divider for each month and a floating label such as "Aug · 82".
- **Streak bridges:** glowing bridges between consecutive active days. The longest streak is
  labelled "5-day streak · Aug 17–21".
- **▶ Replay the year:**
  - towers rise in date order, with a date counter and a running total;
  - the camera glides along with them;
  - a timeline slider for pause and scrub;
  - respect reduced motion.
- **Camera presets:**
  - Front;
  - Map, a top-down view identical to GitHub's grid;
  - Isometric;
  - Cinematic fly-through.
- **Filters:** Top 10 days, Longest streak, Weekdays and Weekends. They dim everything else
  and stay in sync with the heatmap.
- **Day panel:**
  - "3.2× your weekly average" style comparison;
  - the day's rank;
  - previous and next buttons.
- **Insight cards:**
  - month-over-month momentum;
  - best weekday with mini bars;
  - a consistency ring (active days divided by days since joining);
  - best week.
- **Keep from the current page:**
  - tooltips in GitHub's exact wording, e.g. "47 contributions on Monday, September 28, 2026";
  - click or Enter to pin a day, keyboard navigation on the heatmap and Esc to unpin;
  - layout at 375 px with no sideways scroll;
  - the WebGL fallback, pausing when the tab is hidden, light as the default theme, and a
    clean console.

## 8. Polish plan: more comical, more impressive

Everything here must still obey §5 and `DESIGN.md`: no characters, no faction names, English,
and fun-but-professional. Humour comes from **props, motion and copy**, never from mockery.

### Phase A: make it bulletproof (do this before anything else)
1. **Fix the War Room (§6.1),** then finish the redesign (§7).
2. **Add `scripts/check.py` and run it in CI before publishing.** It fails the build on:
   - invalid XML;
   - any file over its size budget;
   - banned words ("Straw Hats", "Akatsuki", "versus", "wanted", "threat", "Agentic") in
     SVGs, the README or `site/`;
   - external URLs inside SVGs;
   - missing `role`/`title`/`desc` or a missing reduced-motion block;
   - private names (repo or org names) anywhere.

   Scan visible text, not file names. The poster's output file is still called
   `wanted-{mode}.svg`; renaming it to `poster-{mode}.svg` in `build.py` and the README is
   a reasonable cleanup.
3. **Golden tests:** feed synthetic stats (zero activity, one day, a full year, a huge total
   with a long name, and an empty dict) to every renderer and assert each one parses and
   stays under budget.
4. **Social card:** a static `og:image` PNG for the War Room and the repo, rendered in CI
   from the battlefield's end state, for example with `rsvg-convert` from apt. This fixes
   the empty frame 0 in link previews.
5. **Cross-browser pass:** Safari, Firefox and Chrome, desktop and mobile, light and dark.

### Phase B: comical touches (small, delightful, professional)
- **Banner:**
  - every ~20 s a gust lifts the straw hat off the barrel; it boings and lands back
    (`cubic-bezier` overshoot);
  - a crow occasionally lands on a planted rod, then flaps off;
  - the ship's flag sometimes flips to show a `{ }` curly-brace emblem.
- **Caption:** add one or two wry lines to the rotation, such as "Bounty increases with
  every merge." and "Powered by coffee, type hints and the occasional rubber band." Keep it
  to four or five lines in total.
- **Most Valued poster:** a small fine-print line, "Reward payable in berries. Coffee also
  accepted." The wax seal stamps in on load, with a brief scale and settle.
- **Bingo Book:** a "Signature techniques" field mapping playful names to real skills, in
  English only, e.g. "Shadow Clone Deploy" (Kubernetes scaling), "Summoning: Data
  Pipelines" and "Spiral Refactor".
- **Snake:**
  - stretches like rubber to reach distant cells (a scaleX squash);
  - pops a tiny "+47" on the peak day;
  - gives a satisfied wiggle at the end of each lap.
- **Achievement rings:** each ring does one coin-flip spin, staggered, then shines.
- **Battlefield:**
  - a seagull occasionally tugs the PEAK flag;
  - the ship toots (a puff of steam) as it passes the "Set sail" buoy.
- **Footer:** "To be continued… after this merge."
- **War Room Easter egg:** clicking the sun five times, or the Konami code, starts "Drums
  mode": towers bounce rubbery to a beat, with confetti made of tiny straw hats and clouds.
  A toast reads "You found the treasure: it was the commits all along." There is no audio by
  default.

### Phase C: impressive features
- **War Room redesign (§7):** replay, camera presets, filters and insight cards.
- **Shareable trading card:** a "Download my card" button in the War Room that exports a PNG
  of the poster and key stats from a canvas.
- **Multi-year support:** a year selector when 2027 data exists. `fetch.py` should loop over
  `contributionYears`.
- **Performance budget:** the War Room should score Lighthouse ≥ 90 for performance and
  accessibility. Lazy-load the god-ray pass, and use a quality toggle (Low/High) that
  defaults to Auto, based on device memory and frame time.
- **Accessibility:** a screen-reader summary of the year, focus-visible styles everywhere,
  and an axe-core pass with no violations.
- **Optional contact call to action:** add LinkedIn or email only if the user provides one.
  Don't invent links.

### Acceptance criteria
- All checks in `scripts/check.py` pass in CI.
- The War Room has zero console errors.
- The orbit sweep finds no black frames.
- Everything works at 375 px, in light and dark, on Safari, Firefox and Chrome.
- The README looks right on github.com in both themes, on desktop and mobile.

## 9. Brief for the Grok and OpenAI reviewers

Please review independently and report findings as **severity / file:line / problem /
concrete fix**. Focus on:

1. **Correctness:**
   - `fetch.py`: streak logic (the current streak may skip today), the timezone of the
     calendar, and error handling when the GraphQL call fails or returns partial data.
   - `cards.py`: the momentum maths and division guards.
   - `snake.py`: path timing, and whether the SMIL and CSS clocks stay in sync.
   - `battlefield.py`: painter's-algorithm ordering and the size budget for a full year.
2. **The War Room:**
   - Three.js resource disposal and memory leaks.
   - NaN sources in the shaders.
   - The post-processing order (bloom, god rays, a lens flare in a second pass).
   - The cost of `readPixels` and the raycaster on mobile.
   - Accessibility of the heatmap's roving tabindex.
3. **Security and privacy:**
   - Confirm no private repo or org names can ever reach the output.
   - Check the workflow permissions: `contents: write` on build, `pages: write` and
     `id-token: write` only on deploy.
   - Check the pinned action versions, and whether the actions should be pinned to SHAs.
4. **GitHub rendering:**
   - Will the camo proxy, `<picture>` with `prefers-color-scheme`, SMIL and CSS animation
     inside `<img>`, and `raw.githubusercontent.com` caching behave as intended?
   - Is anything likely to be stripped?
5. **Design:**
   - Does the page stay "fun but professional" for a work account?
   - Are any of the comical ideas in §8 too much?
   - Is text legible at 360 px?
6. **Maintainability:**
   - The single-file generators run to 1,000+ lines. Is there a sensible split?
   - Are there duplicated helpers (icons, number formatting) that belong in a shared module?

**Out of scope:** reintroducing characters, faction names, or switching to hosted stat widgets.
The user has already decided these (§5).

## 10. Guardrails for Devin
- **Local work:** work locally in the path above. Don't create a GitHub repo, push, make
  anything public or enable Pages without the user's explicit go-ahead. The intended target is a new **public** repo,
  `abhi-at-rei/abhi-at-rei`, whose name makes it the profile README. A **private** repo is
  fine for review first.
- **Commits:** commits pushed on the user's behalf use their identity (`abhi-at-rei`,
  `avishwakarma@reisystems.com`) with no AI attribution lines.
- **Art:** don't add copyrighted artwork, screenshots or watermarked images. Original SVG
  only.
- **Data:** keep every number data-driven from `stats.json`.
- **Spec changes:** update `DESIGN.md` whenever a rule changes.

## 11. Publish checklist (when the user approves)
1. Run `gh repo create abhi-at-rei/abhi-at-rei --public`, commit as the user and push `main`.
2. Enable Pages with source "GitHub Actions":
   `gh api -X POST repos/abhi-at-rei/abhi-at-rei/pages -f build_type=workflow`.
3. Run the workflow with `gh workflow run profile`. Confirm the `output` branch exists and the
   Pages URL is live at https://abhi-at-rei.github.io/abhi-at-rei/.
4. Open https://github.com/abhi-at-rei in light and dark, on desktop and mobile, and check
   every image and the War Room link.
