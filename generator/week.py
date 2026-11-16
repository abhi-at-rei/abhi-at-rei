"""This week: a small strip that visibly changes every day.

Seven mini bars for the last seven calendar days in the data (today on the
right), today's count, the live streak (or the longest one when no streak is
live) and this week against the seven days before it, as a labelled
comparison. No percentage is shown when the earlier week is zero or not fully
in the data, the same rule as the battlefield's momentum.

Editorial paper card matching the snake strip. Colour means intensity: bars use
the shared POWER ramp indexed by GitHub's level 0-4. Frame 0 is the complete
picture; the only motion is a soft breathing glow behind today's bar and the
"refreshed daily" dot (CSS only, reduced motion stops both).
"""
from __future__ import annotations

import datetime as dt

from battlefield import _span
from snake import SURFACE
from theme import FONT_BODY, FONT_DISPLAY, FONT_SERIF, POWER, STRAW_HAT, WIDTH

W, H = WIDTH, 150
PAD = 22
RIGHT = W - PAD
SLOT = 44.0            # bar pitch
BAR_W = 26.0
BASE_Y = 114.0         # bar baseline
BAR_MAX = 40.0
COLS_X = (356.0, 466.0, 596.0)   # stat columns; separators sit 16 px to the left of each

DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August",
               "September", "October", "November", "December"]
EASE = "cubic-bezier(.37,0,.63,1)"


def _n(v: float) -> str:
    s = f"{v:.1f}"
    if s.endswith(".0"):
        s = s[:-2]
    return "0" if s == "-0" else s


def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _num(v: int, room: int = 9) -> str:
    """'1,234', or '12.3k' / '1.2M' when the full number would not fit."""
    full = f"{v:,}"
    if len(full) <= room:
        return full
    for div, suf in ((1_000_000_000, "B"), (1_000_000, "M"), (1_000, "k")):
        if v >= div:
            q = v / div
            return (f"{q:.1f}".rstrip("0").rstrip(".") if q < 100 else f"{q:.0f}") + suf
    return full


def _tw(text: str, fs: float, serif: bool = False, bold: bool = False) -> float:
    """Approximate advance width of a short label in the system sans (or Georgia) stack."""
    em = 0.0
    for ch in text:
        if ch.isdigit():
            em += .53 if serif else .56
        elif ch in " ,.:;'|!":
            em += .27
        elif ch in "il":
            em += .24
        elif ch == "%":
            em += .8
        elif ch in "+\u2212\u2013-":
            em += .58 if serif else .56
        elif ch.isupper():
            em += .7
        else:
            em += .53 if serif else .54
    return fs * em * (1.06 if bold else 1)


def _weekday(date: str) -> int:
    """GitHub weekday: 0 = Sunday."""
    return (dt.date.fromisoformat(date).weekday() + 1) % 7


def _md(s: str) -> str:
    d = dt.date.fromisoformat(s)
    return f"{MONTHS[d.month - 1]} {d.day}"


def _tooltip(date: str, c: int) -> str:
    d = dt.date.fromisoformat(date)
    when = f"{DAY_NAMES[_weekday(date)]}, {MONTHS_LONG[d.month - 1]} {d.day}, {d.year}"
    return f"No contributions on {when}" if c <= 0 else f"{c:,} contribution{'s' if c != 1 else ''} on {when}"


def week_summary(stats: dict) -> dict | None:
    """The numbers the strip shows, all derived from stats; None without calendar data."""
    days = [d for w in (stats.get("weeks") or []) for d in w]
    if not days:
        return None
    joined = str(stats.get("joined") or "")
    last = dt.date.fromisoformat(days[-1]["date"])
    by_date = {d["date"]: d for d in days}
    first = days[0]["date"]

    def window(end: dt.date) -> list:
        out = []
        for k in range(6, -1, -1):
            date = (end - dt.timedelta(days=k)).isoformat()
            d = by_date.get(date)
            out.append({
                "date": date,
                "count": int(d["count"]) if d else 0,
                "level": int(d.get("level", 0)) if d else 0,
                "known": d is not None and date >= first,
            })
        return out

    this = window(last)
    prev = window(last - dt.timedelta(days=7))
    cur_total = sum(d["count"] for d in this)
    prev_total = sum(d["count"] for d in prev)
    comparable = all(d["known"] for d in prev)
    pct = None
    if comparable and prev_total > 0:
        pct = int((cur_total / prev_total - 1) * 100 + (.5 if cur_total >= prev_total else -.5))

    streak = stats.get("streak") or {}
    live = int(streak.get("current") or 0)
    live_start = streak.get("current_start")
    if live and not live_start:  # derive the start from the calendar
        k = len(days) - 1
        while k >= 0 and days[k]["count"] > 0:
            k -= 1
        live_start = days[k + 1]["date"] if k + 1 < len(days) else None
    longest = int(streak.get("longest") or 0)
    if not streak:
        run = 0
        for d in days:
            run = run + 1 if d["count"] > 0 else 0
            longest = max(longest, run)
    return {
        "days": this, "prev": prev, "today": this[-1],
        "current": cur_total, "previous": prev_total, "pct": pct, "comparable": comparable,
        "span": _span(this[0]["date"], this[-1]["date"]),
        "prev_span": _span(prev[0]["date"], prev[-1]["date"]),
        "live": live, "live_start": live_start,
        "longest": longest,
        "longest_span": (_span(streak["longest_start"], streak["longest_end"])
                         if streak.get("longest_start") and streak.get("longest_end") else ""),
        "joined": joined,
    }


def render_week(stats: dict, mode: str) -> str:
    sf = SURFACE[mode]
    ramp = POWER[mode]
    dark = mode == "dark"
    ink, muted, rule = sf["ink"], sf["muted"], sf["rule"]
    gold = STRAW_HAT["sun_gold"]
    s = week_summary(stats)

    css = (
        f"text{{font-family:{FONT_BODY};fill:{muted};font-size:13px}}"
        f".t{{font-family:{FONT_DISPLAY};fill:{ink};font-size:22px;letter-spacing:.045em}}"
        f".s{{font-family:{FONT_SERIF};font-style:italic;fill:{muted};font-size:15px;letter-spacing:0}}"
        f".v{{font-family:{FONT_SERIF};fill:{ink};font-size:27px}}"
        f".k{{fill:{ink};font-weight:600}}"
        f".b{{fill:{ink};font-weight:700}}"
        + "".join(f".v{i}{{fill:{c}}}" for i, c in enumerate(ramp))
        # today's bar breathes a soft glow; the refreshed-daily dot keeps time with it
        + f".br{{opacity:.45;animation:wk-br 3.4s {EASE} infinite}}"
        "@keyframes wk-br{0%,100%{opacity:.45}50%{opacity:1}}"
        f".lv{{animation:wk-lv 3.4s {EASE} infinite}}"
        "@keyframes wk-lv{0%,100%{opacity:1}50%{opacity:.3}}"
        "@media (prefers-reduced-motion:reduce){*{animation:none!important}}"
    )

    parts: list[str] = []
    a = parts.append
    if s is None:
        title = "This week · waiting for the first contribution"
        desc = "A strip for the last seven days of contributions. There is no calendar data yet."
    else:
        t = s["today"]
        title = f"This week · {s['span']}"
        streak_txt = (f"Live streak: {s['live']} day{'s' if s['live'] != 1 else ''}"
                      + (f" since {_md(s['live_start'])}" if s["live_start"] else "")
                      if s["live"] else
                      (f"No live streak; longest streak {s['longest']} day{'s' if s['longest'] != 1 else ''}"
                       + (f", {s['longest_span']}" if s["longest_span"] else "") if s["longest"] else "No streak yet"))
        cmp_txt = (f"This week {s['current']:,} against {s['previous']:,} the seven days before "
                   f"({s['prev_span']})"
                   + (f", {'up' if s['pct'] >= 0 else 'down'} {abs(s['pct']):,}%" if s["pct"] is not None else "")
                   if s["comparable"] else f"This week {s['current']:,}; the seven days before are not in the data")
        desc = (f"Contributions for the last seven days, {s['span']}: "
                + ", ".join(f"{DAY_NAMES[_weekday(d['date'])][:3]} {d['count']:,}" for d in s["days"])
                + f". Today ({DAY_NAMES[_weekday(t['date'])]}, {_md(t['date'])}): {t['count']:,}. "
                + f"{streak_txt}. {cmp_txt}. Bar colour shows intensity, from gold to crimson.")

    a(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
      f'role="img" aria-labelledby="wk-title wk-desc">')
    a(f'<title id="wk-title">{_esc(title)}</title>')
    a(f'<desc id="wk-desc">{_esc(desc)}</desc>')
    a("<defs>"
      f'<linearGradient id="wkpaper" x1="0" y1="0" x2="1" y2="1">'
      f'<stop offset="0" stop-color="{sf["paper_a"]}"/><stop offset=".6" stop-color="{sf["paper_b"]}"/></linearGradient>'
      f'<radialGradient id="wksun" cx=".06" cy="0" r=".5" gradientTransform="matrix(1 0 0 2.2 0 0)">'
      f'<stop offset="0" stop-color="{sf["glow"]}" stop-opacity="{sf["glow_op"]}"/>'
      f'<stop offset="1" stop-color="{sf["glow"]}" stop-opacity="0"/></radialGradient>'
      '<filter id="wkglow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="4"/></filter>'
      "</defs>")
    a(f"<style>{css}</style>")
    a(f'<rect x=".5" y=".5" width="{W - 1}" height="{H - 1}" rx="14" fill="url(#wkpaper)" stroke="{sf["edge"]}"/>')
    a(f'<rect x="1" y="1" width="{W - 2}" height="{H - 2}" rx="14" fill="url(#wksun)"/>')

    # ---- header: title, the week's dates, and a quiet "refreshed daily" mark on the right
    sub = s["span"] if s else "waiting for the first contribution"
    a(f'<text x="{PAD}" y="38" class="t">THIS WEEK<tspan class="s" dx="12">{_esc(sub)}</tspan></text>')
    a(f'<path d="M{PAD} 52.5H{RIGHT}" stroke="{rule}"/>'
      f'<path d="M{PAD} 52.5h44" stroke="{gold}" stroke-width="2"/>')
    if s:
        t = s["today"]
        stamp = f"refreshed daily · {DAY_NAMES[_weekday(t['date'])][:3]}, {_md(t['date'])}"
        sw = _tw(stamp, 13)
        a(f'<circle class="lv" cx="{_n(RIGHT - sw - 9)}" cy="33.5" r="3.2" fill="{gold}" stroke="{sf["shadow"]}" '
          f'stroke-opacity=".35" stroke-width=".6"/>'
          f'<text x="{RIGHT}" y="38" text-anchor="end">{_esc(stamp)}</text>')

    if s is None:
        a(f'<text x="{PAD}" y="96" class="s">No calendar data yet. The bars arrive with the first daily refresh.</text>')
        a("</svg>")
        return "".join(parts).encode("ascii", "xmlcharrefreplace").decode("ascii")

    # ---- seven bars, today on the right
    peak = max([d["count"] for d in s["days"]] + [1])
    streak_from = s["live_start"] if s["live"] else None
    a(f'<path d="M{PAD},{_n(BASE_Y + .5)}H{_n(PAD + 7 * SLOT - (SLOT - BAR_W))}" stroke="{rule}"/>')
    run = []
    for k, d in enumerate(s["days"]):
        x = PAD + k * SLOT
        cx = x + BAR_W / 2
        c = d["count"]
        h = 2.0 if c <= 0 else max(4.0, BAR_MAX * c / peak)
        lv = max(0, min(4, d["level"]))
        if c > 0 and lv == 0:
            lv = 1
        today = k == 6
        tip = f"<title>{_tooltip(d['date'], c)}</title>"
        if today:
            a(f'<rect class="br" x="{_n(x - 3)}" y="{_n(BASE_Y - h - 3)}" width="{_n(BAR_W + 6)}" height="{_n(h + 3)}" '
              f'rx="5" fill="{sf["glow"]}" filter="url(#wkglow)"/>')
        stroke = (f' stroke="{ink}" stroke-width="1.2"' if today
                  else f' stroke="{sf["edge"] if not dark else rule}" stroke-width=".8"' if lv == 0 else "")
        a(f'<g><rect class="v{lv}" x="{_n(x)}" y="{_n(BASE_Y - h)}" width="{_n(BAR_W)}" height="{_n(h)}" rx="2.5"{stroke}/>{tip}</g>')
        bold = ' class="b"' if today else ""
        a(f'<text x="{_n(cx)}" y="{_n(BASE_Y - h - 6)}" text-anchor="middle"{bold}>{_num(c, 5)}</text>')
        initial = DAY_NAMES[_weekday(d["date"])][0]
        a(f'<text x="{_n(cx)}" y="132" text-anchor="middle"{bold}>{initial}</text>')
        if streak_from and d["date"] >= streak_from and c > 0:
            run.append(x)
    if run:  # the live streak's days get a gold baseline
        a(f'<path d="M{_n(run[0] - 3)},{_n(BASE_Y + .5)}H{_n(run[-1] + BAR_W + 3)}" stroke="{gold}" '
          f'stroke-width="2.4" stroke-linecap="round"/>')
    # today's marker under its initial
    tx = PAD + 6 * SLOT + BAR_W / 2
    a(f'<path d="M{_n(tx - 7)},139.5h14" stroke="{gold}" stroke-width="2" stroke-linecap="round"/>')

    # ---- stat columns
    for x in COLS_X:
        a(f'<path d="M{_n(x - 16)},66V134" stroke="{rule}"/>')
    t = s["today"]
    x1, x2, x3 = COLS_X
    a(f'<text x="{_n(x1)}" y="86" class="v">{_num(t["count"], 7)}</text>'
      f'<text x="{_n(x1)}" y="106" class="k">today</text>'
      f'<text x="{_n(x1)}" y="124">{DAY_NAMES[_weekday(t["date"])][:3]}, {_md(t["date"])}</text>')
    if s["live"]:
        val, lab = f"{s['live']:,} day{'s' if s['live'] != 1 else ''}", "live streak"
        det = f"since {_md(s['live_start'])}" if s["live_start"] else "and counting"
    elif s["longest"]:
        val, lab = f"{s['longest']:,} day{'s' if s['longest'] != 1 else ''}", "longest streak"
        det = s["longest_span"] or "no live streak"
    else:
        val, lab, det = "–", "streak", "no streak yet"
    a(f'<text x="{_n(x2)}" y="86" class="v">{_esc(val)}</text>'
      f'<text x="{_n(x2)}" y="106" class="k">{lab}</text>'
      f'<text x="{_n(x2)}" y="124">{_esc(det)}</text>')

    # ---- this week against the seven days before, with both periods labelled
    cur, prev, pct = s["current"], s["previous"], s["pct"]
    if pct is not None:
        head = f"{'+' if pct >= 0 else '−'}{abs(pct):,}%"
        note = "over the week before"
        accent = ramp[4] if pct > 0 else ink
    else:
        head = _num(cur, 9)
        accent = ink
        if not s["comparable"]:
            note = "this week"
        elif cur == 0:
            note = "a quiet week"
        else:
            note = "this week, up from 0"
    hw = _tw(head, 27, serif=True)
    if x3 + hw + 8 + _tw(note, 13) > RIGHT:
        note = ""  # the rows below still label both periods
    a(f'<text x="{_n(x3)}" y="86" class="v" style="fill:{accent}">{_esc(head)}</text>'
      f'<text x="{_n(x3 + hw + 8)}" y="86" >{note}</text>')
    rows = [(s["span"], cur, ramp[min(4, max(2, max(d["level"] for d in s["days"])))]),
            (s["prev_span"], prev, rule if not dark else "#3A4150")]
    lw = max(_tw(r[0], 13) for r in rows) + 10
    vals = [_num(r[1], 9) if (r is rows[0] or s["comparable"]) else "–" for r in rows]
    vw = max(_tw(v, 13, bold=True) for v in vals) + 6
    bx = x3 + lw
    room = max(20.0, RIGHT - bx - vw)
    top = max(cur, prev, 1)
    for (label, v, col), shown, y in zip(rows, vals, (106, 124)):
        ln = 0.0 if shown == "–" else max(2.0, room * v / top) if v > 0 else 2.0
        a(f'<text x="{_n(x3)}" y="{y}">{_esc(label)}</text>'
          f'<rect x="{_n(bx)}" y="{y - 9}" width="{_n(ln)}" height="8" rx="2" fill="{col}"/>'
          f'<text x="{_n(bx + ln + 6)}" y="{y}" class="k">{shown}</text>')
    a("</svg>")
    # Numeric entities for any non-ASCII so the file is encoding-proof.
    return "".join(parts).encode("ascii", "xmlcharrefreplace").decode("ascii")
