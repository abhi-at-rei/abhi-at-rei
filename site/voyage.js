// The voyage: a scroll-driven story through the contribution world.
//
// The cards scroll over the pinned stage. One IntersectionObserver line at the middle of the
// viewport decides which card is active; one passive, rAF-throttled scroll listener maps the
// scroll position to a continuous chapter position that drives the camera and the replay.
// The scene is optional: every method is feature-detected, and with no scene (or no WebGL)
// the cards still read as a linear story.
import { buildChapters, POWER, formatDate, formatCount } from './model.js';

const SVG = 'http://www.w3.org/2000/svg';
const BLEND_MS = 900;
const LONG = { month: 'long', day: 'numeric', year: 'numeric' };
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

const clamp01 = (t) => Math.max(0, Math.min(1, t));
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const can = (obj, name) => !!obj && typeof obj[name] === 'function';
const isVec = (v) => !!v && ['x', 'y', 'z'].every((k) => Number.isFinite(v[k]));
const validPose = (p) => !!p && isVec(p.position) && isVec(p.target);

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) if (child != null && child !== false) el.append(child);
  return el;
}
function s(tag, attrs) {
  const el = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs || {})) el.setAttribute(key, String(value));
  return el;
}

// Interpolates every numeric field of two poses; the position also rises on a gentle arc so
// a long move reads as a flight rather than a slide.
function lerpPose(a, b, t, lift = 0) {
  const mix = (x, y) => {
    if (typeof x === 'number' && typeof y === 'number') return x + (y - x) * t;
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      const out = {};
      for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) out[key] = key in x && key in y ? mix(x[key], y[key]) : (t < 0.5 ? x[key] ?? y[key] : y[key] ?? x[key]);
      return out;
    }
    return t < 0.5 ? x : y;
  };
  const pose = mix(a, b);
  if (lift && t > 0 && t < 1) {
    const d = Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y, b.position.z - a.position.z);
    pose.position.y += Math.sin(Math.PI * t) * d * lift;
  }
  return pose;
}

// Steps the camera back by `pull` and slides it so the framed days sit in the centre of the
// part of the stage the card does not cover. fx and fy are offsets of that centre from the
// stage centre, as fractions of its width and height (right and up are positive).
function offsetPose(pose, fx, fy, pull, aspect) {
  if (!validPose(pose) || !Number.isFinite(pose.fov)) return pose;
  const p = pose.position;
  const q = pose.target;
  const f = { x: q.x - p.x, y: q.y - p.y, z: q.z - p.z };
  const dist0 = Math.hypot(f.x, f.y, f.z);
  if (!(dist0 > 0)) return pose;
  f.x /= dist0; f.y /= dist0; f.z /= dist0;
  const dist = dist0 * (pull || 1);
  const rl = Math.hypot(f.z, f.x) || 1;
  const right = { x: -f.z / rl, y: 0, z: f.x / rl };
  const up = { x: right.y * f.z - right.z * f.y, y: right.z * f.x - right.x * f.z, z: right.x * f.y - right.y * f.x };
  const halfH = dist * Math.tan((pose.fov * Math.PI) / 360);
  const dx = fx * 2 * halfH * aspect;
  const dy = fy * 2 * halfH;
  const move = (v) => ({ x: v.x - right.x * dx - up.x * dy, y: v.y - right.y * dx - up.y * dy, z: v.z - right.z * dx - up.z * dy });
  const target = move(q);
  return { ...pose, target, position: { x: target.x - f.x * dist, y: target.y - f.y * dist, z: target.z - f.z * dist } };
}

// A bar per day around the chapter, coloured by contribution level (POWER), with the
// chapter's own days at full strength and a gold rule beneath them.
function sparkline(model, chapter) {
  const days = model.days;
  const first = model.byDate.get(chapter.start);
  const last = model.byDate.get(chapter.end);
  if (!first || !last) return null;
  const len = last.idx - first.idx + 1;
  const want = Math.min(days.length, Math.max(21, len + 8));
  let lo = first.idx - Math.floor((want - len) / 2);
  lo = Math.max(0, Math.min(lo, days.length - want));
  const view = days.slice(lo, lo + want);
  const inside = new Set(chapter.dates);
  const max = Math.max(1, ...view.map((day) => day.count));
  const W = 240;
  const H = 46;
  const bw = W / view.length;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
  svg.append(s('line', { class: 'voyage__base', x1: 0, x2: W, y1: H - 4.5, y2: H - 4.5, 'vector-effect': 'non-scaling-stroke' }));
  view.forEach((day, i) => {
    const hgt = day.count ? Math.max(3, (day.count / max) * (H - 9)) : 1.4;
    svg.append(s('rect', {
      x: (i * bw + bw * 0.14).toFixed(2), width: Math.max(0.6, bw * 0.72).toFixed(2),
      y: (H - 5 - hgt).toFixed(2), height: hgt.toFixed(2), rx: Math.min(1.2, bw * 0.2).toFixed(2),
      class: `lv${day.level}${inside.has(day.date) ? '' : ' is-out'}`,
    }));
  });
  const x0 = (first.idx - lo) * bw;
  const x1 = (last.idx - lo + 1) * bw;
  svg.append(s('line', { class: 'voyage__mark', x1: x0.toFixed(2), x2: x1.toFixed(2), y1: H - 1, y2: H - 1, 'vector-effect': 'non-scaling-stroke' }));
  const counted = days.slice(first.idx, last.idx + 1).filter((day) => inside.has(day.date));
  const total = counted.reduce((sum, day) => sum + day.count, 0);
  const label = `Daily contributions from ${formatDate(view[0].date)} to ${formatDate(view[view.length - 1].date, LONG)}; the chapter's ${counted.length === 1 ? 'day has' : `${counted.length} days have`} ${formatCount(total)}.`;
  return { svg, from: view[0].date, to: view[view.length - 1].date, label };
}

export function mountVoyage({ root, model, getScene, reducedMotion, onEnter, onExit, onChapter } = {}) {
  const noop = { dispose() {} };
  if (!root || !model) return noop;
  const chapters = buildChapters(model);
  if (!chapters.length) return noop;

  const win = root.ownerDocument.defaultView || window;
  const html = root.ownerDocument.documentElement;
  const n = chapters.length;
  const reduced = () => (typeof reducedMotion === 'function' ? !!reducedMotion() : !!reducedMotion);
  const sceneOf = () => {
    try { return typeof getScene === 'function' ? getScene() || null : null; } catch (e) { return null; }
  };
  const call = (fn, ...args) => {
    if (typeof fn !== 'function') return;
    try { fn(...args); } catch (e) { console.error('Voyage callback failed:', e); }
  };

  // ---------- markup ----------
  const firstDate = chapters[0].start;
  const intro = h('header', { class: 'voyage__step voyage__step--intro', 'data-step': 'intro' },
    h('div', { class: 'voyage__card' },
      h('p', { class: 'voyage__kicker', text: 'A story in the record' }),
      h('h2', { class: 'voyage__title', id: 'voyage-title', text: 'The voyage' }),
      h('p', { class: 'voyage__body', text: `${WORDS[n] || formatCount(n)} chapter${n === 1 ? '' : 's'} from the calendar itself, from ${formatDate(firstDate, LONG)} to now. Scroll to sail through ${n === 1 ? 'it' : 'them'}.` }),
      h('p', { class: 'voyage__cue', 'aria-hidden': 'true' }, h('span', { text: 'Scroll' }), h('span', { class: 'voyage__cue-arrow', text: '↓' })),
    ));

  const dots = [];
  const rail = h('nav', { class: 'voyage__rail', 'aria-label': 'Voyage chapters' },
    h('span', { class: 'voyage__track', 'aria-hidden': 'true' }, h('span', { class: 'voyage__fill' })),
    h('ol', {}, chapters.map((chapter, i) => {
      const dot = h('button', { class: 'voyage__dot', type: 'button', 'data-index': i, 'aria-label': `${chapter.kicker}: ${chapter.title}` },
        h('span', { class: 'voyage__dot-mark', 'aria-hidden': 'true' }),
        h('span', { class: 'voyage__dot-label', 'aria-hidden': 'true', text: chapter.title }));
      dots.push(dot);
      return h('li', {}, dot);
    })));
  const fill = rail.querySelector('.voyage__fill');

  const chapterEls = chapters.map((chapter, i) => {
    const id = `voyage-${chapter.id}`;
    const spark = sparkline(model, chapter);
    return h('article', { class: 'voyage__step', id, 'data-step': 'chapter', 'data-chapter': chapter.id, 'data-index': i, tabindex: '-1', 'aria-labelledby': `${id}-title` },
      h('div', { class: 'voyage__card' },
        h('p', { class: 'voyage__kicker' }, h('span', { text: chapter.kicker }), h('span', { class: 'voyage__of', text: ` / ${n}` })),
        h('h3', { class: 'voyage__title', id: `${id}-title`, text: chapter.title }),
        h('p', { class: 'voyage__body', text: chapter.body }),
        chapter.metrics.length ? h('ul', { class: 'voyage__metrics', 'aria-label': `${chapter.title} in numbers` },
          chapter.metrics.map((m) => h('li', {}, h('strong', { text: m.value }), h('span', { text: m.label })))) : null,
        spark ? h('figure', { class: 'voyage__spark' }, spark.svg,
          h('figcaption', {},
            h('span', { class: 'voyage__axis', 'aria-hidden': 'true' }, h('span', { text: formatDate(spark.from) }), h('span', { text: formatDate(spark.to) })),
            h('span', { class: 'sr-only', text: spark.label }))) : null,
      ));
  });

  const outro = h('footer', { class: 'voyage__step voyage__step--outro', 'data-step': 'outro' },
    h('div', { class: 'voyage__card' },
      h('p', { class: 'voyage__kicker', text: 'The voyage continues' }),
      h('h3', { class: 'voyage__title', id: 'voyage-outro-title', text: 'Your turn at the helm' }),
      h('p', { class: 'voyage__body', text: `${formatCount(model.total)} contributions across ${formatCount(model.activeCount)} active days so far, and the record grows every day. Explore the landscape freely, or read it day by day.` }),
      h('p', { class: 'voyage__links' },
        h('a', { class: 'voyage__link', href: '#stage', 'data-voyage-link': 'stage' }, h('span', { text: 'Explore freely' }), h('span', { class: 'voyage__link-arrow', 'aria-hidden': 'true', text: '↑' })),
        h('a', { class: 'voyage__link voyage__link--quiet', href: '#heatmap-title' }, h('span', { text: 'The daily record' }), h('span', { class: 'voyage__link-arrow', 'aria-hidden': 'true', text: '↓' }))),
    ));

  const steps = [intro, ...chapterEls, outro];
  const inner = h('section', { class: 'voyage__inner', 'aria-labelledby': 'voyage-title' }, intro, rail, chapterEls, outro);
  const addedClasses = ['voyage', 'is-live'].filter((c) => !root.classList.contains(c));
  root.classList.add(...addedClasses);
  root.classList.toggle('voyage--still', reduced());
  POWER.light.forEach((hex, i) => root.style.setProperty(`--vp-l${i}`, hex));
  POWER.dark.forEach((hex, i) => root.style.setProperty(`--vp-d${i}`, hex));
  root.replaceChildren(inner);

  // ---------- state ----------
  let disposed = false;
  let stepEl = null;
  let active = -1;
  let geo = null;
  let raf = 0;
  let blend = null;
  let lastScene = null;
  let posesFor = null;
  let poses = null;
  let lastReplay = NaN;
  let lastT = NaN;

  // ---------- geometry (read only in rAF, after a resize) ----------
  const px = (v) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);
  function measure() {
    const vh = win.innerHeight;
    const sy = win.scrollY;
    const holds = chapterEls.map((step) => {
      const card = step.firstElementChild;
      const r = step.getBoundingClientRect();
      const top = r.top + sy;
      const cs = win.getComputedStyle(step);
      const cc = win.getComputedStyle(card);
      const c = card.offsetHeight;
      const padT = px(cs.paddingTop);
      const padB = px(cs.paddingBottom);
      let a;
      let b;
      if (cc.position === 'sticky' && cc.top !== 'auto') {
        const T = px(cc.top);
        a = top + padT - T;
        b = top + r.height - padB - c - T;
      } else if (cc.position === 'sticky' && cc.bottom !== 'auto') {
        const pinned = vh - px(cc.bottom) - c;
        a = top + padT - pinned;
        b = top + r.height - padB - c - pinned;
      } else {
        const mid = top + padT + c / 2 - vh / 2;
        a = mid; b = mid;
      }
      if (b < a) { const m = (a + b) / 2; a = m; b = m; }
      return [a, b];
    });
    // The part of the stage left clear by the pinned card, the fixed header and (on phones)
    // the rail, so the framing can centre the days there and step back to fit them.
    let fx = 0;
    let fy = 0;
    let pull = 1;
    let aspect = 16 / 9;
    const stage = root.ownerDocument.getElementById('stage');
    const card = chapterEls[0].firstElementChild;
    if (stage) {
      const sr = stage.getBoundingClientRect();
      const W = Math.max(1, sr.width);
      const H = Math.max(1, sr.height);
      const cr = card.getBoundingClientRect();
      const ccs = win.getComputedStyle(card);
      const stageTop = px(win.getComputedStyle(stage).top);
      aspect = W / H;
      let left = 0;
      let top = px(win.getComputedStyle(html).getPropertyValue('--header-h'));
      let bottom = H;
      if (cr.width < W * 0.6) left = Math.max(0, cr.right - sr.left);
      else bottom = Math.min(H, (ccs.top !== 'auto' ? px(ccs.top) : vh - px(ccs.bottom) - cr.height) - stageTop);
      const rr = rail.getBoundingClientRect();
      if (rr.width > rr.height) top = Math.max(top, rr.bottom);
      const freeW = Math.max(0.3, (W - left) / W);
      const freeH = Math.max(0.3, (bottom - top) / H);
      fx = (left + W) / 2 / W - 0.5;
      fy = 0.5 - (top + bottom) / 2 / H;
      pull = Math.min(1.9, Math.max(1, 1.12 / Math.min(freeW, freeH)));
    }
    geo = { holds, fx, fy, pull, aspect, vh };
    poses = null;
    // Where a step's top is when the hand-over to it is half done.
    const cc = win.getComputedStyle(card);
    const c = card.offsetHeight;
    let line = vh / 2;
    if (cc.position === 'sticky' && cc.top !== 'auto') line = (px(cc.top) + c) / 2;
    else if (cc.position === 'sticky' && cc.bottom !== 'auto') line = vh - px(cc.bottom) - c / 2;
    observeAt(Math.max(vh * 0.15, Math.min(vh * 0.9, line)), vh);
  }

  // Continuous chapter position: whole numbers while a card is pinned, eased in between.
  function positionAt(y) {
    const { holds } = geo;
    if (y <= holds[0][1]) return 0;
    for (let i = 0; i < n; i++) {
      const [a, b] = holds[i];
      if (y >= a && y <= b) return i;
      if (i < n - 1 && y > b && y < holds[i + 1][0]) return i + smoother(clamp01((y - b) / (holds[i + 1][0] - b)));
    }
    return n - 1;
  }

  function framedPoses(scene) {
    if (!can(scene, 'poseForRange') || !can(scene, 'setCameraPose')) return null;
    if (!geo) measure();
    if (poses && posesFor === scene) return poses;
    posesFor = scene;
    try {
      const list = chapters.map((c) => scene.poseForRange(c.start, c.end));
      poses = list.every(validPose) ? list.map((p) => offsetPose(p, geo.fx, geo.fy, geo.pull, geo.aspect)) : null;
    } catch (e) {
      poses = null;
    }
    return poses;
  }

  function setReplay(scene, p) {
    if (!can(scene, 'setReplayProgress') || Math.abs(p - lastReplay) < 1e-4) return;
    lastReplay = p;
    scene.setReplayProgress(p);
  }

  function highlight(scene) {
    if (!can(scene, 'setHighlight')) return;
    scene.setHighlight(active >= 0 ? chapters[active].dates.slice() : null);
  }

  // Reduced motion: no scrubbing. The camera snaps to the chapter and the replay jumps.
  function still(scene) {
    if (!scene || active < 0) return;
    const P = framedPoses(scene);
    setReplay(scene, chapters[active].progress);
    if (P) scene.setCameraPose(P[active], { duration: 0 });
  }

  function update(now) {
    raf = 0;
    if (disposed) return;
    const remeasured = !geo;
    if (remeasured) measure();
    const scene = sceneOf();
    if (remeasured && scene && active >= 0 && reduced()) still(scene);
    if (scene !== lastScene) {
      lastScene = scene;
      poses = null;
      lastReplay = NaN;
      if (scene && active >= 0) {
        highlight(scene);
        if (reduced()) still(scene);
      }
    }
    const t = positionAt(win.scrollY);
    if (t !== lastT) {
      lastT = t;
      fill.style.setProperty('--voyage-progress', n > 1 ? (t / (n - 1)).toFixed(4) : '1');
      dots.forEach((dot, i) => dot.classList.toggle('is-past', i < t + 0.5));
    }
    if (active < 0 || !scene || reduced()) return;
    const P = framedPoses(scene);
    const i0 = Math.min(n - 1, Math.floor(t));
    const i1 = Math.min(n - 1, i0 + 1);
    const f = t - i0;
    // Replay first: reaching progress 1 may start the scene's own return flight, which the
    // camera pose below then overrides.
    setReplay(scene, chapters[i0].progress + (chapters[i1].progress - chapters[i0].progress) * f);
    if (P) {
      let pose = lerpPose(P[i0], P[i1], f, 0.12);
      if (blend) {
        const k = clamp01((now - blend.t0) / BLEND_MS);
        if (blend.from) pose = lerpPose(blend.from, pose, easeInOut(k));
        if (k >= 1) blend = null;
      }
      scene.setCameraPose(pose, { duration: 0 });
    } else blend = null;
    if (blend) schedule();
  }
  const schedule = () => { if (!raf && !disposed) raf = win.requestAnimationFrame(update); };

  // ---------- activation ----------
  function activate(step) {
    if (step === stepEl) return;
    if (stepEl) stepEl.classList.remove('is-active');
    stepEl = step;
    if (step) step.classList.add('is-active');
    root.classList.toggle('is-in-view', !!step);
    // The intro and outro cards sit where the hero type does; mark them so it can step aside.
    const bookend = step && step.dataset.step !== 'chapter' ? step.dataset.step : '';
    if (bookend) html.dataset.voyageCard = bookend;
    else delete html.dataset.voyageCard;
    const next = step && step.dataset.step === 'chapter' ? Number(step.dataset.index) : -1;
    if (next === active) return;
    const prev = active;
    active = next;
    root.classList.toggle('has-chapter', active >= 0);
    dots.forEach((dot, i) => (i === active ? dot.setAttribute('aria-current', 'step') : dot.removeAttribute('aria-current')));
    const scene = sceneOf();
    if (active >= 0) {
      if (prev < 0) {
        html.dataset.voyage = 'active';
        call(onEnter, chapters[active]);
        let from = null;
        try { from = can(scene, 'getCameraPose') ? scene.getCameraPose() : null; } catch (e) { from = null; }
        blend = reduced() ? null : { t0: win.performance.now(), from: validPose(from) ? from : null };
        lastReplay = NaN;
      }
      highlight(scene);
      call(onChapter, chapters[active]);
      if (reduced()) still(scene);
      else schedule();
    } else {
      delete html.dataset.voyage;
      blend = null;
      lastReplay = NaN;
      highlight(scene);
      call(onExit);
    }
  }

  // Activation: a one-pixel line across the viewport, placed where one card hands over to the
  // next (the middle of the push between two pinned cards), so the incoming card fades in as
  // it rises into place. The line moves only when the layout does.
  const hits = new Map();
  let io = null;
  let ioLine = -1;
  function observeAt(line, vh) {
    if (io && Math.abs(line - ioLine) < 8) return;
    if (io) io.disconnect();
    hits.clear();
    ioLine = line;
    io = new win.IntersectionObserver((entries) => {
      for (const entry of entries) hits.set(entry.target, entry.isIntersecting);
      activate(steps.filter((step) => hits.get(step)).pop() || null);
    }, { rootMargin: `-${Math.round(line)}px 0px -${Math.max(0, Math.round(vh - line - 1))}px 0px`, threshold: 0 });
    steps.forEach((step) => io.observe(step));
  }

  const onScroll = () => schedule();
  const onResize = () => { geo = null; schedule(); };
  win.addEventListener('scroll', onScroll, { passive: true });
  win.addEventListener('resize', onResize, { passive: true });
  const ro = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(() => { geo = null; schedule(); }) : null;
  if (ro) { ro.observe(inner); ro.observe(chapterEls[0].firstElementChild); }

  function scrollToChapter(i) {
    if (!geo) measure();
    const [a, b] = geo.holds[i];
    win.scrollTo({ top: Math.round((a + b) / 2), behavior: reduced() ? 'instant' : 'smooth' });
    chapterEls[i].focus({ preventScroll: true });
  }
  const onClick = (event) => {
    const dot = event.target.closest('.voyage__dot');
    if (dot && root.contains(dot)) { scrollToChapter(Number(dot.dataset.index)); return; }
    const link = event.target.closest('[data-voyage-link="stage"]');
    if (link && root.contains(link)) {
      // The stage is sticky, so its anchor would resolve to wherever it is pinned now:
      // scroll to the top of the section that holds it instead.
      const stage = root.ownerDocument.getElementById('stage');
      const host = (stage && stage.parentElement) || root.parentElement;
      if (!host) return;
      event.preventDefault();
      win.scrollTo({ top: Math.max(0, host.getBoundingClientRect().top + win.scrollY), behavior: reduced() ? 'instant' : 'smooth' });
    }
  };
  root.addEventListener('click', onClick);
  schedule();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) win.cancelAnimationFrame(raf);
      if (io) io.disconnect();
      if (ro) ro.disconnect();
      win.removeEventListener('scroll', onScroll);
      win.removeEventListener('resize', onResize);
      root.removeEventListener('click', onClick);
      if (active >= 0) {
        const scene = sceneOf();
        if (can(scene, 'setHighlight')) scene.setHighlight(null);
      }
      delete html.dataset.voyage;
      delete html.dataset.voyageCard;
      root.replaceChildren();
      root.classList.remove(...addedClasses, 'is-in-view', 'has-chapter', 'voyage--still');
      for (let i = 0; i < 5; i++) { root.style.removeProperty(`--vp-l${i}`); root.style.removeProperty(`--vp-d${i}`); }
    },
    // Test hooks (not part of the contract).
    debugState: () => ({ active, chapter: active >= 0 ? chapters[active].id : null, t: lastT, holds: geo && geo.holds, fx: geo && geo.fx, fy: geo && geo.fy, pull: geo && geo.pull, chapters: chapters.map((c) => c.id) }),
  };
}
