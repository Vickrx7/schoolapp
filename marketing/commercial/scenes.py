"""The commercial's scenes. Each scene is draw(c, S): `c` is the frame context (canvas, local time
t, frame index), `S` the scene's timing (dur, voice start, voice duration, caption, chapter).

Layout: brand plate top right, chapter tab top left, caption strip at the bottom; a device with
a real screenshot and paper labels in between. Times are mostly relative to the voice line
(V(S, f) = voice start + f × voice duration), so the French cut, which runs longer, stays in sync.
"""
from __future__ import annotations

import math

import numpy as np

import art as A
from art import (AMBER, BLUE, DARK, FPS, GREEN, LILAC, MINT, NAVY, ORANGE, PAPER, PINK, PURPLE, RED, SKY, SLATE,
                 WHITE, YELLOW, H, W, T)

CH_CARD = 1.35  # seconds the big chapter card holds at the start of a chapter


def V(S, f):
    return S.voice + f * S.vdur


# ---------------------------------------------------------------------------
# frame furniture
# ---------------------------------------------------------------------------
def chapter_furniture(c, S):
    if not S.ch:
        return
    from script import CHAPTERS
    title = T(*CHAPTERS[S.ch])
    if S.first:
        c.put(A.chapter_card(S.ch, title, True), W / 2, H / 2 - 60, t0=0.05, enter="pop", dur=0.3, key=f"chbig{S.ch}",
              t1=CH_CARD, exit="up", edur=0.3, jit=1.2, jrot=0.3, rot=-1.5)
        c.put(A.chapter_card(S.ch, title, False), 40 + A.chapter_card(S.ch, title, False).width / 2, 62, t0=CH_CARD + 0.1,
              enter="slide", from_dir="left", dist=500, dur=0.3, key="chtab", jit=0.8, jrot=0.2, rot=-1)
    else:
        tab = A.chapter_card(S.ch, title, False)
        c.put(tab, 40 + tab.width / 2, 62, t0=-1, enter="none", key="chtab", jit=0.8, jrot=0.2, rot=-1)


def brand(c, t0=-1.0):
    b = A.brand_plate()
    c.put(b, W - 40 - b.width / 2 + 30, 62, t0=t0, enter="pop" if t0 >= 0 else "none", dur=0.3, key="brand", jit=0.8, jrot=0.2)


def wrap_caption(page: str, limit: int = 80) -> str:
    out = []
    for line in page.split("\n"):
        if len(line) <= limit:
            out.append(line)
            continue
        mid = len(line) // 2
        cut = min((i for i, ch in enumerate(line) if ch == " "), key=lambda i: abs(i - mid))
        out += [line[:cut], line[cut + 1:]]
    return "\n".join(out)


def captions(c, S):
    # drawn last, so the chapter tab, the chapter card and the brand sit on top of the devices
    chapter_furniture(c, S)
    if S.id not in ("papers", "title", "end"):
        brand(c)
    if not S.cap or c.t < S.voice:
        return
    pages = [wrap_caption(p) for p in S.cap.split("|")]
    if len(pages) == 1:
        c.caption(pages[0], S.voice)
        return
    lens = np.array([len(p) for p in pages], float)
    bounds = S.voice + np.concatenate([[0], np.cumsum(lens) / lens.sum()]) * S.vdur
    for i, p in enumerate(pages):
        t0 = bounds[i]
        t1 = bounds[i + 1] if i < len(pages) - 1 else 1e9
        if t0 <= c.t < t1:
            c.put(A.caption_strip(p), W / 2, 985, t0=t0, enter="slide" if i == 0 else "pop", dur=0.25, steps=3,
                  from_dir="down", dist=220, jit=1.0, jrot=0.0, key="caption")


def C0(S):
    """When a scene's own content may start (after the chapter card)."""
    return CH_CARD + 0.3 if S.first else 0.05


def tag_to(c, pl, b, text, color, x, y, t0, key, fsize=40, rot=0.0, fg=SLATE, side="left", fy=0.5, enter="pop"):
    """A paper tag at (x, y) with a connector to the box b of the device placed as `pl`."""
    tg = A.tag(text, color, fg, fsize)
    pos = c.put(tg, x, y, t0=t0, enter=enter, dur=0.3, rot=rot, key=key, steps=3 if enter == "stamp" else 4)
    if pos is not None and pl is not None and b is not None:
        if side == "left":
            p1 = (pos[0] - tg.width / 2 + 34, pos[1] + 4)
            p2 = pl.mid(b, 1.0, fy)
        elif side == "right":
            p1 = (pos[0] + tg.width / 2 - 34, pos[1] + 4)
            p2 = pl.mid(b, 0.0, fy)
        elif side == "up":
            p1 = (pos[0], pos[1] - tg.height / 2 + 30)
            p2 = pl.mid(b, 0.5, 1.0)
        else:
            p1 = (pos[0], pos[1] + tg.height / 2 - 30)
            p2 = pl.mid(b, 0.5, 0.0)
        if pl.visible(p2):
            c.connector(p1, p2, t0=t0, key=key)
    return pos


def ring(c, pl, b, t0, key, color=AMBER, pad=10):
    if pl is not None and b is not None:
        A.highlight(c, pl.rect(b), t0, key, color=color, pad=pad)


def bx(name, key, fallback=None):
    return A.boxes(name).get(key, fallback)


def tap(c, pl, b, t_tap, key, t_in=None, t_out=None, size=1.05, fx=0.5, fy=0.5):
    """The paper hand taps the centre of box b at t_tap (with a ring and a click)."""
    if pl is None or b is None:
        return
    bxp, byp = pl.mid(b, fx, fy)
    hm = A.hand(size)
    press = 8 if t_tap - 1 / FPS <= c.t < t_tap + 2 / FPS else 0
    tip_dx = 63 * size + 30 - hm.width / 2
    tip_dy = 4 + 30 - hm.height / 2
    c.put(hm, bxp - tip_dx + 4, byp - tip_dy + 6 + press, t0=t_in if t_in is not None else t_tap - 0.7, enter="slide",
          from_dir="downright", dur=0.4, steps=4, dist=650, rot=-8, key=key + "hand", jit=1.5, jrot=0.4,
          t1=t_out if t_out is not None else t_tap + 0.8, exit="downright", edur=0.4)
    if t_tap <= c.t < t_tap + 2 / FPS:
        c.put(A.tap_ring(40 if c.t < t_tap + 1 / FPS else 60), bxp, byp, t0=-1, enter="none", key=key + "ring", jit=0, jrot=0)
    c.sfx("tap", t_tap)


def phone_at(c, name, cx, cy, t0, sw=370, scroll=0, time_txt="8:30", key="phone", enter="slide", from_dir="down", rot=0.0, t1=None, exit="down", dim=0.0):
    built = A.phone(name, sw, int(scroll), 2532, time_txt, dim)
    return A.place_device(c, built, cx, cy, t0=t0, enter=enter, dur=0.4, steps=4, from_dir=from_dir, dist=900, key=key,
                          jit=1.0, jrot=0.0, rot=rot, t1=t1, exit=exit)


def laptop_at(c, name, cx, cy, t0, sw=1060, view=None, key="laptop", enter="slide", from_dir="down", t1=None, exit="down"):
    built = A.laptop(name, sw, view)
    return A.place_device(c, built, cx, cy, t0=t0, enter=enter, dur=0.4, steps=4, from_dir=from_dir, dist=900, key=key,
                          jit=1.0, jrot=0.0, t1=t1, exit=exit)


def scroll_steps(t, t0, t1, a, b, steps=4):
    """A stop-motion scroll from a to b between t0 and t1, in `steps` jumps."""
    p = A.qstep(t, t0, max(1e-3, t1 - t0), steps)
    return a + (b - a) * p


# desktop screenshots are 1920 wide; their content column sits between about x=190 and x=1730
DESK_VIEW = (170, 0, 1580, 990)


def dv(y=0, h=990, x=170, w=1580):
    return (x, y, w, h)


# ---------------------------------------------------------------------------
# intro
# ---------------------------------------------------------------------------
PAPERS = [  # x, y, rot, color, en, fr
    (330, 250, -7, YELLOW, "Plan de\nsuppléance ?!", "Plan de\nsuppléance ?!"),
    (640, 200, 5, PINK, "Bulletins\n× 25", "Bulletins\n× 25"),
    (950, 270, -4, MINT, "Info aux\nfamilles\n(vendredi)", "Message aux\nfamilles\n(vendredi)"),
    (1260, 210, 8, SKY, "Messe\njeudi 10 h", "Messe\njeudi 10 h"),
    (1560, 280, -5, LILAC, "Photocopies\n!!", "Photocopies\n!!"),
    (420, 560, 6, YELLOW, "Journée\npédago.", "Journée\npédago."),
    (760, 590, -6, PINK, "Quiz\nmaths", "Quiz\nmaths"),
    (1090, 560, 4, SKY, "Rencontres\nparents", "Rencontres\nparents"),
    (1420, 600, -8, MINT, "Plan à\nlong terme", "Plan à\nlong terme"),
    (1700, 560, 6, YELLOW, "Unité 3 ?", "Unité 3 ?"),
]


def s_papers(c, S):
    c.put(A.clock(220, 8, 20), 150, 830, t0=0.1, enter="pop", rot=-4, key="clock", jit=1.5, jrot=0.4)
    c.put(A.coffee(int(c.t * 4) % 3, 190), 1780, 840, t0=0.3, enter="slide", from_dir="right", key="coffee", rot=3)
    for i, (x, y, rot, col, en, fr) in enumerate(PAPERS):
        c.put(A.sticky(T(en, fr), col, 230, 40), x, y, t0=0.4 + i * 0.32, enter="pop", dur=0.3, rot=rot, key=f"st{i}")
    captions(c, S)


def s_title(c, S):
    for i, (x, y, rot, col, en, fr) in enumerate(PAPERS):
        c.put(A.sticky(T(en, fr), col, 230, 40), x, y, t0=-1, enter="none", rot=rot, key=f"st{i}",
              t1=0.05 + (i % 5) * 0.06, exit=["up", "left", "right", "up", "down"][i % 5], edur=0.35)
    c.put(A.clock(220, 8, 20), 150, 830, t0=-1, enter="none", rot=-4, key="clock", t1=0.1, exit="left")
    c.put(A.coffee(0, 190), 1780, 840, t0=-1, enter="none", rot=3, key="coffee", t1=0.15, exit="right")
    c.put(A.end_card(1160, 520), 960, 430, t0=0.5, enter="pop", dur=0.3, key="card", jit=1.0, jrot=0.2)
    c.put(A.app_icon(170), 560, 330, t0=0.8, enter="drop", dur=0.4, dist=600, rot=-4, key="icon")
    c.put(A.text_img(A.APP, A.font("bold", 104), SLATE), 1040, 320, t0=1.0, enter="slide", from_dir="right", dur=0.35,
          steps=4, dist=400, key="name", jit=1.0, jrot=0.0)
    c.put(A.label(T("for French-language Catholic elementary schools", "pour les écoles élémentaires catholiques de langue française"),
                  L(44, 40), BLUE), 960, 470, t0=V(S, 0.35), enter="pop", key="sub1", jit=1.0, jrot=0.0)
    c.put(A.tag(T("Ontario · elementary · pilot build", "Ontario · élémentaire · version pilote"), AMBER, SLATE, 40),
          960, 580, t0=V(S, 0.6), enter="stamp", dur=0.3, steps=3, rot=-2, key="sub2")
    c.put(A.school_building(300), 1660, 760, t0=V(S, 0.4), enter="drop", dur=0.4, rot=2, key="school")
    c.put(A.maple_leaf(150), 250, 760, t0=V(S, 0.65), enter="drop", dur=0.4, rot=-14, key="leaf")
    captions(c, S)


def L(en, fr):
    return A.T(en, fr) if isinstance(en, str) else (en if A.LANG == "en" else fr)


# ---------------------------------------------------------------------------
# 1 · your day
# ---------------------------------------------------------------------------
def s_today(c, S):
    t0 = C0(S)
    sc = scroll_steps(c.t, V(S, 0.55), V(S, 0.85), 0, 1350, 4)
    pl = phone_at(c, "today-phone-full", 520, 470, t0, scroll=sc)
    name = "today-phone-full"
    tag_to(c, pl, bx(name, "prayer"), T("morning prayer & O Canada ✝", "prière du matin et Ô Canada ✝"), MINT, 1180, 300, V(S, 0.25), "prayer", side="left")
    tag_to(c, pl, bx(name, "next"), T("the next lesson, from your planning →", "la prochaine leçon, tirée de votre planification →"), SKY, L(1260, 1290), 520, V(S, 0.5), "next", fsize=36, side="left")
    c.put(A.tag(T("every period, every routine", "chaque période, chaque routine"), AMBER, SLATE, 44), 1240, 720, t0=V(S, 0.12), enter="pop", rot=-2, key="every")
    # boxes scroll with the page: show the connector only before the scroll moves them
    captions(c, S)


def s_calendar(c, S):
    t = c.t
    swaps = [(0.0, "pa-day-phone", 0), (V(S, 0.3), "mass-phone", 300), (V(S, 0.62), "early-phone", 1500)]
    cur, scr, sx = swaps[0][1], 0, 1.0
    for ts, nm, s in swaps:
        if t >= ts:
            cur, scr = nm, s
            if ts > 0 and t < ts + 2 / FPS:
                sx = 0.45 if t < ts + 1 / FPS else 0.8
    built = A.phone(cur, 350, scr, 2532)
    A.place_device(c, built, 470, 470, t0=0.05, enter="slide", from_dir="down", dist=900, key="phone", jit=1.0, jrot=0.0, sx=sx)
    c.put(A.calendar_card("9", T("OCTOBER", "OCTOBRE"), T("PA day", "Journée\npédagogique"), BLUE), 900, 300, t0=0.25, enter="drop", rot=-5, key="cal1")
    c.put(A.calendar_card("8", T("OCTOBER", "OCTOBRE"), T("School\nmass", "Messe de\nl'école"), PURPLE), 1210, 300, t0=V(S, 0.3), enter="drop", rot=4, key="cal2")
    c.put(A.calendar_card("19", T("NOVEMBER", "NOVEMBRE"), T("Early\ndismissal", "Départ\nhâtif"), ORANGE), 1520, 300, t0=V(S, 0.62), enter="drop", rot=-3, key="cal3")
    c.put(A.tag(T("no class today", "pas de classe"), PAPER, SLATE, 34), 900, 490, t0=0.8, enter="pop", rot=-3, key="t1")
    c.put(A.tag(T("« Perturbé » periods", "périodes « Perturbé »"), PAPER, SLATE, 32), 1215, 560, t0=V(S, 0.4), enter="pop", rot=2, key="t2")
    c.put(A.tag(T("« Annulé » afternoon", "après-midi « Annulé »"), PAPER, SLATE, 32), 1530, 490, t0=V(S, 0.72), enter="pop", rot=-2, key="t3")
    c.put(A.tag(T("adjusts on its own ✓", "s'ajuste toute seule ✓"), GREEN, WHITE, 46), 1240, 720, t0=V(S, 0.85), enter="stamp", dur=0.3, steps=3, rot=-4, key="t4")
    captions(c, S)


def s_taught(c, S):
    t = c.t
    tap_t = V(S, 0.18)
    undo_t = V(S, 0.78)
    cur = "taught-after" if tap_t <= t < undo_t + 0.15 else "taught-before"
    pl = phone_at(c, cur, 520, 470, 0.05)
    tap(c, pl, bx("taught-before", "taught"), tap_t, "tap1")
    if pl is not None:
        if t >= undo_t - 0.6:
            tap(c, pl, bx("taught-after", "undo"), undo_t, "tap2", t_in=undo_t - 0.6, t_out=undo_t + 0.6)
    c.put(A.stamp(T("Taught!", "Donnée !"), 230), 1040, 300, t0=tap_t + 0.15, enter="stamp", dur=0.3, steps=3, rot=-12, key="stamp", t1=undo_t, exit="shrink")
    c.put(A.tag(T("the plan moves ahead →", "la planification avance →"), AMBER, SLATE, 44), 1280, 520, t0=tap_t + 0.6, enter="pop", rot=-2, key="moves")
    c.put(A.tag(T("next time: lesson 5", "la prochaine fois : leçon 5"), PAPER, SLATE, 36), 1300, 630, t0=tap_t + 1.1, enter="pop", rot=1, key="next")
    if pl is not None and t >= undo_t - 0.4:
        tag_to(c, pl, bx("taught-after", "undo"), T("Undo: one tap too", "Annuler : une touche aussi"), PAPER, 1250, 160, undo_t - 0.4, "undo", fsize=36, side="left")
    captions(c, S)


def s_timetable(c, S):
    pl = laptop_at(c, "timetable-desktop", 760, 495, C0(S), view=dv(150, 960))
    c.put(A.tag(T("weekly or Jour 1 … 6", "semaine ou Jour 1 … 6"), AMBER, SLATE, 42), 1620, 300, t0=V(S, 0.1), enter="pop", rot=3, key="jour")
    c.put(A.tag(T("rotary periods ✓", "enseignement en rotation ✓"), MINT, SLATE, 40), 1620, 430, t0=V(S, 0.35), enter="pop", rot=-2, key="rot")
    c.put(A.tag(T("combined grades ✓", "classes combinées ✓"), SKY, SLATE, 40), 1620, 560, t0=V(S, 0.55), enter="pop", rot=2, key="comb")
    c.put(A.tag(T("prayer, recess, mass: all in", "prière, pauses santé, messe"), PAPER, SLATE, 36), 1620, 690, t0=V(S, 0.75), enter="pop", rot=-1, key="all")
    captions(c, S)


# ---------------------------------------------------------------------------
# 2 · your planning
# ---------------------------------------------------------------------------
def s_unit(c, S):
    pl = laptop_at(c, "unit-desktop", 760, 495, C0(S), view=dv(120, 960))
    c.put(A.tag(T("lesson by lesson", "leçon par leçon"), AMBER, SLATE, 44), 1640, 330, t0=V(S, 0.15), enter="pop", rot=-3, key="lbl")
    c.put(A.tag(T("+ a resource from the library", "+ une ressource de la banque"), SKY, SLATE, 36), 1620, 480, t0=V(S, 0.55), enter="pop", rot=2, key="res")
    c.put(A.tag(T("attentes C1.1 · C1.2 …", "attentes C1.1 · C1.2 …"), PAPER, SLATE, 36), 1620, 620, t0=V(S, 0.75), enter="pop", rot=-1, key="att")
    captions(c, S)


def s_year(c, S):
    name = "year-desktop-full" if "year-desktop-full" in _available() else ("year-desktop" if "year-desktop" in _available() else "site-year-desktop")
    src = A.shot(name)
    if name.startswith("site-"):
        view = (0, 0, src.width, src.height)
        sw = 1100
    else:
        y = scroll_steps(c.t, V(S, 0.45), V(S, 0.85), 150, min(900, src.height - 1000), 3)
        view = dv(int(y), 960)
        sw = 1100
    laptop_at(c, name, 760, 495, C0(S), sw=sw, view=view)
    c.put(A.tag(T("My year: week by week", "« Mon année » : semaine par semaine"), AMBER, SLATE, 40), 1630, 280, t0=V(S, 0.05), enter="pop", rot=-3, key="y1")
    c.put(A.tag(T("PA days, masses", "journées pédago., messes"), PAPER, SLATE, 36), 1640, 420, t0=V(S, 0.45), enter="pop", rot=2, key="y2")
    c.put(A.tag(T("report card dates", "dates de bulletin"), SKY, SLATE, 38), 1650, 540, t0=V(S, 0.62), enter="pop", rot=-2, key="y3")
    c.put(A.tag(T("Advent ✝", "l'Avent ✝"), LILAC, SLATE, 40), 1660, 660, t0=V(S, 0.8), enter="pop", rot=3, key="y4")
    captions(c, S)


def s_coverage(c, S):
    sc = scroll_steps(c.t, V(S, 0.15), V(S, 0.5), 600, 1100, 3)
    phone_at(c, "coverage-phone-full", 480, 470, C0(S), scroll=sc)
    c.put(A.tag(T("taught ✓", "enseignées ✓"), GREEN, WHITE, 42), 1000, 300, t0=V(S, 0.3), enter="pop", rot=-3, key="c1")
    c.put(A.tag(T("planned", "prévues"), SKY, SLATE, 42), 1000, 420, t0=V(S, 0.4), enter="pop", rot=2, key="c2")
    c.put(A.tag(T("not planned yet", "pas encore prévues"), PAPER, SLATE, 40), 1030, 540, t0=V(S, 0.5), enter="pop", rot=-2, key="c3")
    c.put(A.tag(T("only the expectations loaded in the app · demo sample, to verify", "seulement les attentes chargées · échantillon de démo, à vérifier"), PAPER, (90, 100, 120), 28, kind="hand"),
          1010, 700, t0=V(S, 0.55), enter="pop", rot=1, key="c4")
    pdf_t = S.voice + S.vdur * 0.78
    c.put(A.sheet(T("Long-range plan", "Plan à long terme"), ("Français · Unité 1 …", "Mathématiques · Unité 2 …", "Sciences · Unité 1 …"), 460, 560),
          1590, 470, t0=pdf_t, enter="slide", from_dir="right", dist=700, rot=4, key="pdf")
    c.put(A.tag("PDF", RED, WHITE, 44, kind="bold"), 1760, 190, t0=pdf_t + 0.3, enter="stamp", dur=0.3, steps=3, rot=-8, key="pdftag")
    captions(c, S)


# ---------------------------------------------------------------------------
# 3 · resources
# ---------------------------------------------------------------------------
def s_library(c, S):
    pl = laptop_at(c, "library-search", 760, 495, C0(S), view=dv(120, 960))
    tag_to(c, pl, bx("library-search", "search"), T("search « huard »", "recherche « huard »"), AMBER, 1600, 250, V(S, 0.2), "srch", side="left")
    c.put(A.tag(T("in French", "en français"), PAPER, SLATE, 42), 1640, 420, t0=V(S, 0.1), enter="pop", rot=-2, key="fr")
    c.put(A.tag(T("filters: grade, subject, type", "filtres : année, matière, type"), SKY, SLATE, 34), 1600, 560, t0=V(S, 0.5), enter="pop", rot=2, key="flt")
    c.put(A.tag(T("filed by expectation", "rangée par attente"), MINT, SLATE, 40), 1620, 690, t0=V(S, 0.75), enter="pop", rot=-2, key="att")
    captions(c, S)


def s_versions(c, S):
    laptop_at(c, "library-item", 700, 495, C0(S), sw=1020, view=dv(120, 960))
    c.put(A.tag(T("one version per language level", "une version par niveau de langue"), AMBER, SLATE, 36), 1560, 230, t0=V(S, 0.15), enter="pop", rot=-2, key="v1")
    st = A.sheet(T("Le huard", "Le huard"), ("Nom : ______________", "1. Le huard est un grand", "   oiseau qui vit sur les lacs.", "2. Où vit le huard ?"), 420, 520)
    c.put(st, 1560, 600, t0=V(S, 0.5), enter="slide", from_dir="right", dist=700, rot=3, key="sheet")
    c.put(A.tag(T("no level name on the sheet ✓", "aucun nom de niveau sur la feuille ✓"), GREEN, WHITE, 32), 1560, 890, t0=V(S, 0.7), enter="stamp", dur=0.3, steps=3, rot=-3, key="nolvl")
    captions(c, S)


def s_review(c, S):
    steps = [
        (T("Draft", "Brouillon"), PAPER, "✎", BLUE),
        (T("Approved by\nthe board's reviewers", "Approuvée par\nle conseil"), SKY, "✓", BLUE),
        (T("Faith content:\nits own review", "Contenu de foi :\nrévisé à part"), LILAC, "✝", PURPLE),
        (T("Shared with\nthe board", "Partagée avec\nle conseil"), MINT, "★", GREEN),
    ]
    xs = [300, 740, 1180, 1620]
    for i, (txt, col, ic, icol) in enumerate(steps):
        t0 = C0(S) + 0.2 + i * max(0.35, S.vdur * 0.16)
        c.put(A.badge(ic, txt, icol, 360, 300), xs[i], 420, t0=t0, enter="pop", rot=(-3, 2, -2, 3)[i], key=f"b{i}")
        if i:
            c.put(A.arrow(110, 40), (xs[i - 1] + xs[i]) / 2, 420, t0=t0 - 0.1, enter="pop", key=f"a{i}", rot=0)
    c.put(A.tag(T("reviewers named by your board", "des personnes désignées par votre conseil"), AMBER, SLATE, 38), 960, 700,
          t0=V(S, 0.55), enter="stamp", dur=0.3, steps=3, rot=-2, key="who")
    captions(c, S)


def s_differentiate(c, S):
    name = "differentiate-preview"
    pl = laptop_at(c, name, 640, 495, C0(S), sw=960, view=dv(500, 900, 170, 1200))
    zb = None
    a, b = bx(name, "markA"), bx(name, "markB")
    if a and b:
        zb = (a[0] - 24, a[1] - 34, 560, a[3] + 64)
    if zb:
        card = A.zoom_card(name, zb, 700)
        c.put(card, 1490, 300, t0=V(S, 0.45), enter="pop", rot=2, key="zoom")
        if pl is not None and c.t >= V(S, 0.45):
            c.connector(pl.mid(a, 0.5, 1.0), (1490 - card.width / 2 + 30, 300 + card.height / 2 - 30), t0=V(S, 0.45), key="zc")
            ring(c, pl, (a[0], a[1], b[0] + b[2] - a[0], a[3]), V(S, 0.45), "ra")
    c.put(A.tag(T("Zoé → « Élève A »", "Zoé → « Élève A »"), AMBER, SLATE, 44), 1490, 520, t0=V(S, 0.6), enter="pop", rot=-2, key="z1")
    c.put(A.tag(T("emails, phone numbers, ID numbers,\naddresses, birth dates: blocked", "courriels, téléphones, numéros,\nadresses, dates de naissance : bloqués"), RED, WHITE, 30),
          1490, 680, t0=V(S, 0.75), enter="stamp", dur=0.3, steps=3, rot=2, key="z2")
    c.put(A.magnifier(110), 1830, 210, t0=V(S, 0.45), enter="pop", rot=10, key="mag")
    captions(c, S)


def s_aicontrols(c, S):
    name = "school-ai"
    src = A.shot(name)
    laptop_at(c, name, 700, 495, C0(S), sw=1000, view=dv(max(0, 620), min(580, src.height - 620), 170, 1300))
    c.put(A.tag(T("off until the principal turns it on", "éteinte tant que la direction ne l'active pas"), AMBER, SLATE, 34), 1540, 240, t0=V(S, 0.05), enter="pop", rot=-2, key="a1")
    c.put(A.badge("☺", T("staff only", "personnel seulement"), BLUE, 300, 250), 1420, 520, t0=V(S, 0.45), enter="pop", rot=-3, key="a2")
    c.put(A.badge("✕", T("never students", "jamais les élèves"), RED, 300, 250), 1740, 520, t0=V(S, 0.6), enter="pop", rot=3, key="a3")
    c.put(A.tag(T("a board can forbid it", "un conseil peut l'interdire"), MINT, SLATE, 42), 1580, 760, t0=V(S, 0.8), enter="stamp", dur=0.3, steps=3, rot=-2, key="a4")
    captions(c, S)


# ---------------------------------------------------------------------------
# 4 · in class
# ---------------------------------------------------------------------------
def s_projector(c, S):
    t = c.t
    reveal = V(S, 0.7)
    name = "projector-answer" if t >= reveal else "projector-question"
    built = A.projector_screen(name, 1060, (0, 0, 1920, 1200))
    A.place_device(c, built, 760, 470, t0=C0(S), enter="drop", dur=0.4, dist=700, key="proj", jit=0.8, jrot=0.0)
    c.put(A.tag(T("one question at a time", "une question à la fois"), AMBER, SLATE, 40), 1610, 330, t0=V(S, 0.35), enter="pop", rot=3, key="p1")
    c.put(A.tag(T("the answer when you ask", "la réponse quand vous la demandez"), MINT, SLATE, 34), 1600, 480, t0=reveal, enter="stamp", dur=0.3, steps=3, rot=-3, key="p2")
    if t >= reveal:
        c.sfx("ding", reveal)
    captions(c, S)


def s_tablets(c, S):
    c.put(A.projector_screen("projector-question", 700, (0, 0, 1920, 1200))[0], 600, 440, t0=-1, enter="none", key="proj", jit=0.8, jrot=0.0)
    for i, (x, y, r) in enumerate(((1380, 300, -4), (1640, 520, 3), (1360, 720, -2))):
        lbl = T(f"Device {i + 1}", f"Appareil {i + 1}")
        img = A.tablet("site-tablet-join", 440, 300) if i == 0 else A.tablet(None, 440, 300, label=lbl)
        c.put(img[0], x, y, t0=C0(S) + 0.2 + i * 0.35, enter="slide", from_dir="right", dist=800, rot=r, key=f"tab{i}")
    c.put(A.tag(T("join with a code", "on se joint avec un code"), AMBER, SLATE, 40), 1000, 140, t0=V(S, 0.25), enter="pop", rot=-2, key="t1")
    c.put(A.tag(T("no student accounts ✓", "aucun compte d'élève ✓"), GREEN, WHITE, 42), 1660, 860, t0=V(S, 0.6), enter="stamp", dur=0.3, steps=3, rot=2, key="t2")
    captions(c, S)


# ---------------------------------------------------------------------------
# 5 · a sick day
# ---------------------------------------------------------------------------
def s_sick(c, S):
    t = c.t
    if c.cv is not None:
        c.cv.alpha_composite(A.night_overlay())
    ring_on = 0.0 <= t < CH_CARD + 1.4
    wob = (6 if int(round(t * FPS)) % 2 == 0 else -6) if ring_on and t > 0.2 else 0
    c.put(A.clock(230, 6, 5, alarm=True), 1600, 300, t0=0.1, enter="pop", rot=wob - 3, key="alarm", jit=2.5 if ring_on else 1.2, jrot=0.5)
    c.sfx("alarm", 0.15)
    c.put(A.moon(140), 1780, 190, t0=0.2, enter="pop", rot=-10, key="moon")
    c.put(A.thermometer(200), 1340, 360, t0=C0(S) + 0.1, enter="drop", rot=18, key="thermo")
    tap1, tap2 = V(S, 0.55), V(S, 0.85)
    cur = "absence-form" if t >= tap1 + 0.15 else "today-phone"
    pl = phone_at(c, cur, 760, 470, C0(S), time_txt="6:05", dim=0.0)
    tap(c, pl, bx("today-phone", "absent"), tap1, "tap1", t_in=tap1 - 0.6, t_out=tap1 + 0.3)
    tap(c, pl, bx("absence-form", "send"), tap2, "tap2", t_in=tap2 - 0.35, t_out=tap2 + 0.9)
    c.put(A.tag("1", AMBER, SLATE, 60, kind="bold"), 1120, 470, t0=tap1, enter="stamp", dur=0.25, steps=3, rot=-6, key="n1")
    c.put(A.tag("2", AMBER, SLATE, 60, kind="bold"), 1230, 560, t0=tap2, enter="stamp", dur=0.25, steps=3, rot=5, key="n2")
    c.put(A.tag(T("two taps", "deux touches"), PAPER, SLATE, 48), 1520, 650, t0=tap2 + 0.3, enter="pop", rot=-3, key="two")
    captions(c, S)


def s_plan(c, S):
    name = "plan-desktop-full"
    gb = bx("plan-desktop", "group")
    src = A.shot(name)
    y_end = int(min(src.height - 1000, (gb[1] - 250) if gb else 1800))
    y = scroll_steps(c.t, V(S, 0.35), V(S, 0.65), 0, y_end, 4)
    laptop_at(c, name, 720, 495, C0(S), sw=1060, view=dv(int(y), 960))
    c.put(A.tag(T("from where each class left off", "là où chaque classe est rendue"), AMBER, SLATE, 36), 1580, 240, t0=V(S, 0.1), enter="pop", rot=-2, key="p1")
    c.put(A.tag(T("next lessons", "prochaines leçons"), SKY, SLATE, 40), 1620, 380, t0=V(S, 0.42), enter="pop", rot=2, key="p2")
    c.put(A.tag(T("groups by language level", "groupes par niveau de langue"), MINT, SLATE, 38), 1620, 500, t0=V(S, 0.6), enter="pop", rot=-2, key="p3")
    c.put(A.tag(T("routines", "routines"), LILAC, SLATE, 40), 1640, 620, t0=V(S, 0.75), enter="pop", rot=3, key="p4")
    c.put(A.tag(T("office: 555-0100", "secrétariat : 555-0100"), PAPER, SLATE, 38), 1620, 740, t0=V(S, 0.88), enter="pop", rot=-1, key="p5")
    captions(c, S)


def s_released(c, S):
    name = "absence-sent"
    pl = phone_at(c, name, 660, 470, 0.05, time_txt="6:07")
    ring(c, pl, bx(name, "status"), V(S, 0.4), "st")
    tag_to(c, pl, bx(name, "status"), T("goes out on its own at 7:30 (default)", "publié tout seul à 7 h 30 (par défaut)"), AMBER, 1300, 330, V(S, 0.45), "rel", fsize=38, side="left")
    c.put(A.clock(230, 7, 30), 1180, 640, t0=V(S, 0.55), enter="pop", rot=-4, key="clk")
    c.put(A.tag(T("or « Publier maintenant »", "ou « Publier maintenant »"), PAPER, SLATE, 36), 1560, 640, t0=V(S, 0.15), enter="pop", rot=3, key="rev")
    captions(c, S)


def s_code(c, S):
    name = "office-code"
    pl = laptop_at(c, name, 720, 495, 0.05, sw=1060, view=dv(0, 960))
    cb = bx(name, "code")
    if cb:
        ring(c, pl, cb, V(S, 0.3), "code")
        tag_to(c, pl, cb, T("one day only", "pour une journée"), AMBER, 1640, 300, V(S, 0.35), "cd", fsize=42, side="left")
    c.put(A.tag(T("text · e-mail · print", "texto · courriel · impression"), SKY, SLATE, 36), 1620, 460, t0=V(S, 0.6), enter="pop", rot=2, key="send")
    c.put(A.tag(T("no account needed ✓", "aucun compte requis ✓"), GREEN, WHITE, 40), 1620, 600, t0=V(S, 0.8), enter="stamp", dur=0.3, steps=3, rot=-3, key="noacc")
    captions(c, S)


def s_subphone(c, S):
    name = "sub-plan"
    pl = phone_at(c, name, 660, 470, 0.05, time_txt="11:20")
    tag_to(c, pl, bx(name, "now"), T("Now", "Maintenant"), AMBER, 1180, 360, V(S, 0.35), "now", fsize=48, side="left")
    tag_to(c, pl, bx(name, "next"), T("Next", "Ensuite"), SKY, 1180, 560, V(S, 0.6), "next", fsize=48, side="left")
    c.put(A.clock(200, 11, 20), 1560, 450, t0=0.4, enter="pop", rot=4, key="clk")
    c.put(A.tag(T("on the substitute's phone", "sur le téléphone de la suppléance"), PAPER, SLATE, 34), 1500, 700, t0=V(S, 0.15), enter="pop", rot=-2, key="ph")
    captions(c, S)


def s_alerts(c, S):
    name = "sub-students"
    pl = phone_at(c, name, 640, 470, 0.05, time_txt="11:24")
    ab = bx(name, "alerts")
    ring(c, pl, ab, V(S, 0.35), "al")
    t_open = V(S, 0.5)
    c.put(A.tag(T("if the principal turns them on", "si la direction les active"), PAPER, SLATE, 34), 1300, 190, t0=V(S, 0.02), enter="pop", rot=-2, key="opt")
    c.put(A.lock(150, is_open=c.t >= t_open), 1100, 360, t0=V(S, 0.1), enter="pop", rot=-6, key="lock")
    c.put(A.tag(T("encrypted", "chiffrées"), BLUE, WHITE, 42), 1100, 550, t0=V(S, 0.15), enter="pop", rot=-3, key="enc")
    c.put(A.eye(150, closed=c.t < t_open), 1420, 360, t0=V(S, 0.3), enter="pop", rot=3, key="eye")
    c.put(A.tag(T("shown only when tapped", "affichées sur demande"), PAPER, SLATE, 38), 1430, 550, t0=V(S, 0.35), enter="pop", rot=2, key="tap")
    c.put(A.tag(T("a code opens them:\nevery view is logged ✎", "un code les ouvre :\nchaque consultation\nest enregistrée ✎"), AMBER, SLATE, 36),
          1720, 760, t0=V(S, 0.65), enter="stamp", dur=0.3, steps=3, rot=-4, key="log")
    captions(c, S)


def s_report(c, S):
    name = "sub-report"
    pl = phone_at(c, name, 660, 470, 0.05, time_txt="15:22")
    tap(c, pl, bx(name, "send"), V(S, 0.75), "send", t_in=V(S, 0.45))
    c.put(A.clock(200, 3, 20), 1180, 300, t0=0.3, enter="pop", rot=-4, key="clk")
    c.put(A.tag(T("what got done, lesson by lesson", "ce qui a été fait, leçon par leçon"), AMBER, SLATE, 36), 1450, 500, t0=V(S, 0.3), enter="pop", rot=2, key="r1")
    c.put(A.tag(T("Send the report ✓", "« Envoyer le suivi » ✓"), GREEN, WHITE, 40), 1450, 640, t0=V(S, 0.8), enter="stamp", dur=0.3, steps=3, rot=-3, key="r2")
    captions(c, S)


def s_confirm(c, S):
    name = "report-desktop"
    pl = laptop_at(c, name, 720, 495, 0.05, sw=1060, view=dv(80, 960))
    cb = bx(name, "confirm")
    ring(c, pl, cb, V(S, 0.6), "cf")
    tag_to(c, pl, cb, T("you confirm", "vous confirmez"), AMBER, 1620, 420, V(S, 0.62), "cf2", side="left", fsize=44)
    c.put(A.coffee(int(c.t * 4) % 3, 200), 1640, 720, t0=0.3, enter="slide", from_dir="right", key="coffee", rot=3)
    c.put(A.tag(T("next morning", "le lendemain"), PAPER, SLATE, 40), 1600, 250, t0=V(S, 0.05), enter="pop", rot=-2, key="nm")
    captions(c, S)


# ---------------------------------------------------------------------------
# 6 · report cards and families
# ---------------------------------------------------------------------------
def s_bulletins(c, S):
    laptop_at(c, "site-report-comments-desktop", 720, 495, C0(S), sw=1060, view=(0, 0, 1280, 800))
    c.put(A.tag(T("student by student", "élève par élève"), AMBER, SLATE, 42), 1630, 280, t0=V(S, 0.2), enter="pop", rot=-3, key="b1")
    c.put(A.tag(T("strengths · next steps", "points forts · prochaines étapes"), SKY, SLATE, 34), 1610, 420, t0=V(S, 0.5), enter="pop", rot=2, key="b2")
    c.put(A.tag(T("expectation by expectation", "attente par attente"), MINT, SLATE, 38), 1620, 560, t0=V(S, 0.75), enter="pop", rot=-2, key="b3")
    captions(c, S)


def s_ondevice(c, S):
    br = A.browser_card((T("Aïcha shows strong", "Aïcha démontre une"), T("understanding of numbers", "bonne compréhension des"), T("to 1,000…", "nombres jusqu'à 1 000…")), 640, 320,
                        T("your browser", "votre navigateur"))
    c.put(br, 560, 420, t0=0.1, enter="pop", rot=-2, key="br")
    c.put(A.lock(140), 900, 300, t0=0.5, enter="pop", rot=8, key="lk")
    c.put(A.cloud(300, crossed=c.t >= V(S, 0.45)), 1300, 300, t0=V(S, 0.35), enter="pop", rot=-3, key="cl")
    c.put(A.tag(T("our servers ✕", "nos serveurs ✕"), PAPER, RED, 38), 1300, 450, t0=V(S, 0.45), enter="pop", rot=2, key="cltag")
    c.put(A.cloud(260, crossed=c.t >= V(S, 0.75)), 1660, 560, t0=V(S, 0.65), enter="pop", rot=4, key="ai")
    c.put(A.tag(T("the AI ✕", "l'IA ✕"), PAPER, RED, 38), 1660, 700, t0=V(S, 0.75), enter="pop", rot=-2, key="aitag")
    if c.t >= V(S, 0.45):
        c.sfx("stamp", V(S, 0.45))
    if c.t >= V(S, 0.75):
        c.sfx("stamp", V(S, 0.75))
    c.put(A.tag(T("stays on your device", "reste sur votre appareil"), GREEN, WHITE, 44), 560, 700, t0=V(S, 0.15), enter="stamp", dur=0.3, steps=3, rot=-3, key="st")
    captions(c, S)


def s_infoparents(c, S):
    name = "site-newsletter-desktop"
    view = dv(120, 960) if not name.startswith("site-") else (0, 0, 1280, 800)
    laptop_at(c, name, 720, 495, C0(S), sw=1060, view=view)
    c.put(A.tag("Français | English", AMBER, SLATE, 44, kind="handb"), 1620, 300, t0=V(S, 0.6), enter="pop", rot=-3, key="i1")
    c.put(A.tag(T("from your class's week", "à partir de la semaine de la classe"), SKY, SLATE, 34), 1600, 450, t0=V(S, 0.35), enter="pop", rot=2, key="i2")
    c.put(A.tag(T("lessons · dates · a faith moment", "leçons · dates · un moment de foi"), PAPER, SLATE, 32), 1600, 590, t0=V(S, 0.8), enter="pop", rot=-1, key="i3")
    captions(c, S)


def s_print(c, S):
    p = A.qstep(c.t, V(S, 0.2), 0.9, 6)
    doc = A.doc_image("site-newsletter-pdf", 360)
    if c.t >= V(S, 0.2):
        y = 760 - p * 330
        c.put(doc, 520, y, t0=-1, enter="none", key="doc", rot=-1 + 2 * p)
    c.put(A.printer(440), 520, 790, t0=0.05, enter="pop", rot=0, key="printer")
    c.put(A.backpack(280), 1080, 640, t0=V(S, 0.35), enter="drop", rot=4, key="bag")
    c.put(A.tag(T("copy · print", "copier · imprimer"), AMBER, SLATE, 44), 1100, 300, t0=V(S, 0.15), enter="pop", rot=-3, key="cp")
    c.put(A.envelope(220, crossed=c.t >= V(S, 0.75)), 1600, 420, t0=V(S, 0.6), enter="pop", rot=-4, key="env")
    c.put(A.tag(T("the app sends nothing to families", "l'application n'envoie rien aux familles"), RED, WHITE, 34), 1560, 620, t0=V(S, 0.78), enter="stamp", dur=0.3, steps=3, rot=2, key="none")
    captions(c, S)


# ---------------------------------------------------------------------------
# 7 · principals
# ---------------------------------------------------------------------------
def s_direction(c, S):
    name = "direction-desktop"
    pl = laptop_at(c, name, 740, 495, C0(S), sw=1080, view=dv(100, 960))
    ab = bx(name, "absence")
    ring(c, pl, ab, V(S, 0.35), "abs")
    c.put(A.clock(200, 7, 45), 1640, 280, t0=C0(S) + 0.2, enter="pop", rot=4, key="clk")
    c.put(A.tag(T("today's absences", "les absences du jour"), AMBER, SLATE, 40), 1630, 470, t0=V(S, 0.3), enter="pop", rot=-2, key="d1")
    c.put(A.tag(T("plan released · 1 code · report in", "plan publié · 1 code · suivi reçu"), SKY, SLATE, 32), 1610, 600, t0=V(S, 0.6), enter="pop", rot=2, key="d2")
    c.put(A.tag(T("alert views, last 7 days", "accès aux alertes, 7 jours"), PAPER, SLATE, 32), 1610, 720, t0=V(S, 0.85), enter="pop", rot=-1, key="d3")
    captions(c, S)


def s_audit(c, S):
    name = "audit-desktop"
    pl = laptop_at(c, name, 640, 495, 0.05, sw=980, view=dv(150, 960))
    eb = bx(name, "entry")
    if eb:
        x, y, w, h = eb
        zb = (x, y - 10, int(w * 0.62), h + 20)
        card = A.zoom_card(name, zb, 720)
        c.put(card, 1480, 290, t0=V(S, 0.4), enter="pop", rot=2, key="zoom")
        ring(c, pl, bx(name, "badge"), V(S, 0.4), "badge")
    c.put(A.tag(T("every alert read, with its code", "chaque consultation, avec son code"), AMBER, SLATE, 36), 1560, 560, t0=V(S, 0.15), enter="pop", rot=-2, key="a1")
    c.put(A.tag(T("office-issued codes flagged", "« Code émis par le secrétariat »"), SKY, SLATE, 34), 1560, 680, t0=V(S, 0.6), enter="pop", rot=2, key="a2")
    c.put(A.tag(T("never a student's name", "jamais le nom d'un élève"), PAPER, SLATE, 32), 1560, 790, t0=V(S, 0.85), enter="pop", rot=-1, key="a3")
    captions(c, S)


def s_yours(c, S):
    folder = A.sheet(T("My planning", "Ma planification"), (T("Unit 1 · lesson 4", "Unité 1 · leçon 4"), T("Unit 2 · lesson 5", "Unité 2 · leçon 5"), "…"), 460, 400, title_color=GREEN)
    c.put(folder, 560, 420, t0=0.05, enter="pop", rot=-3, key="folder")
    c.put(A.lock(150), 820, 300, t0=0.4, enter="pop", rot=8, key="lock")
    items = [T("units", "unités"), T("lessons", "leçons"), T("progress", "progression")]
    for i, it in enumerate(items):
        c.put(A.tag(f"{it}  ✕", PAPER, RED, 42), 1380, 290 + i * 130, t0=V(S, 0.4) + i * 0.25, enter="pop", rot=(-2, 2, -1)[i], key=f"x{i}")
    c.put(A.tag(T("never on the dashboard", "jamais au tableau de bord"), RED, WHITE, 38), 1380, 700, t0=V(S, 0.85), enter="stamp", dur=0.3, steps=3, rot=-2, key="never")
    captions(c, S)


# ---------------------------------------------------------------------------
# 8 · school boards
# ---------------------------------------------------------------------------
def s_staff(c, S):
    name = "board-staff" if "board-staff" in _available() else "site-staff-desktop"
    view = dv(0, 960) if not name.startswith("site-") else (0, 0, 1280, 800)
    laptop_at(c, name, 720, 495, C0(S), sw=1060, view=view)
    c.put(A.tag(T("invite", "inviter"), AMBER, SLATE, 46), 1620, 300, t0=V(S, 0.15), enter="pop", rot=-3, key="s1")
    c.put(A.tag(T("assign roles", "attribuer les rôles"), SKY, SLATE, 42), 1620, 440, t0=V(S, 0.4), enter="pop", rot=2, key="s2")
    c.put(A.tag(T("remove access", "retirer un accès"), PAPER, SLATE, 42), 1620, 580, t0=V(S, 0.7), enter="pop", rot=-2, key="s3")
    captions(c, S)


def s_board(c, S):
    name = "board-desktop-full"
    src = A.shot(name)
    y = scroll_steps(c.t, V(S, 0.4), V(S, 0.7), 0, max(0, src.height - 1000), 3)
    laptop_at(c, name, 720, 495, 0.05, sw=1060, view=dv(int(y), 960))
    c.put(A.tag(T("AI use, school by school", "l'IA, école par école"), AMBER, SLATE, 38), 1620, 270, t0=V(S, 0.1), enter="pop", rot=-3, key="b1")
    c.put(A.tag(T("system health", "état du système"), SKY, SLATE, 42), 1620, 410, t0=V(S, 0.35), enter="pop", rot=2, key="b2")
    c.put(A.moon(110), 1760, 560, t0=V(S, 0.6), enter="pop", rot=-8, key="moon")
    c.put(A.tag(T("data retention:\nerased each night", "conservation :\neffacé chaque nuit"), PAPER, SLATE, 36), 1580, 620, t0=V(S, 0.65), enter="pop", rot=-2, key="b3")
    captions(c, S)


def s_hosting(c, S):
    c.put(A.maple_leaf(240), 420, 380, t0=0.1, enter="drop", rot=10, key="leaf")
    c.put(A.server_rack(230, 330), 760, 420, t0=0.3, enter="slide", from_dir="down", key="rack1")
    c.put(A.tag(T("designed to be hosted in Canada", "conçue pour être hébergée au Canada"), AMBER, SLATE, 38), 600, 700, t0=V(S, 0.1), enter="pop", rot=-2, key="h1")
    c.put(A.label(T("or", "ou"), 70, SLATE), 1060, 420, t0=V(S, 0.35), enter="pop", key="or")
    c.put(A.server_rack(230, 330, (GREEN, GREEN, SKY)), 1340, 420, t0=V(S, 0.4), enter="slide", from_dir="down", key="rack2")
    c.put(A.tag(T("your board's own servers", "les serveurs de votre conseil"), SKY, SLATE, 38), 1340, 700, t0=V(S, 0.45), enter="pop", rot=2, key="h2")
    c.put(A.lock(130), 1640, 300, t0=V(S, 0.7), enter="pop", rot=6, key="lock")
    c.put(A.tag(T("encrypted, signed backups", "sauvegardes chiffrées et signées"), GREEN, WHITE, 36), 1640, 480, t0=V(S, 0.75), enter="stamp", dur=0.3, steps=3, rot=-3, key="h3")
    c.put(A.tag(T("pilot: hosting not live yet", "projet pilote : hébergement pas encore en ligne"), PAPER, (100, 110, 130), 26, kind="hand"),
          960, 830, t0=V(S, 0.5), enter="fade", dur=0.2, steps=2, key="note")
    captions(c, S)


# ---------------------------------------------------------------------------
# 9 · privacy first
# ---------------------------------------------------------------------------
def s_privacy(c, S):
    items = [
        ("A", T("first names only", "prénoms seulement"), BLUE),
        ("✎", T("sensitive access\nlogged", "accès sensibles\nenregistrés"), ORANGE),
        ("✓", T("report card comments\nstay on your device", "commentaires de bulletin\nsur votre appareil"), GREEN),
        ("✕", T("no AI for students", "pas d'IA pour\nles élèves"), RED),
    ]
    for i, (ic, txt, col) in enumerate(items):
        t0 = V(S, 0.12 + i * 0.2) if i else C0(S) + 0.2
        c.put(A.badge(ic, txt, col, 360, 300), 300 + i * 440, 430, t0=t0, enter="pop", rot=(-3, 2, -2, 3)[i], key=f"pv{i}")
    c.put(A.lock(130), 960, 720, t0=V(S, 0.9), enter="pop", rot=0, key="lock")
    captions(c, S)


# ---------------------------------------------------------------------------
# 10 · getting started
# ---------------------------------------------------------------------------
def s_start(c, S):
    t_swap = V(S, 0.5)
    name = "start-phone" if c.t < t_swap else "sample-class-phone"
    pl = phone_at(c, name, 520, 470, C0(S))
    if c.t < t_swap:
        tag_to(c, pl, bx("start-phone", "checklist"), T("Getting started: 0 of 4", "« Pour bien commencer » : 0 sur 4"), AMBER, 1240, 330, V(S, 0.15), "ck", fsize=38, side="left")
    else:
        tag_to(c, pl, bx("sample-class-phone", "notice"), T("a sample class to try things", "une classe exemple pour essayer"), MINT, 1240, 420, t_swap + 0.2, "sc", fsize=38, side="left")
        c.put(A.tag(T("never in a sub plan", "jamais dans un plan de suppléance"), PAPER, SLATE, 32), 1260, 560, t0=t_swap + 0.6, enter="pop", rot=2, key="sc2")
    captions(c, S)


def s_bilingual(c, S):
    phone_at(c, "today-phone", 470, 470, 0.05, key="pfr", sw=330, rot=-3)
    phone_at(c, "today-phone-en", 900, 470, 0.4, key="pen", sw=330, rot=3, from_dir="right")
    c.put(A.tag("FR ⇄ EN", AMBER, SLATE, 56, kind="bold"), 690, 170, t0=V(S, 0.2), enter="stamp", dur=0.3, steps=3, rot=-4, key="sw")
    c.put(A.tablet(None, 360, 240, label=T("tablet", "tablette"))[0], 1450, 330, t0=V(S, 0.55), enter="pop", rot=-4, key="tab")
    lap = A.laptop("today-phone-en" if False else "direction-desktop", 460, (0, 0, 1920, 1200))[0]
    c.put(lap, 1500, 640, t0=V(S, 0.75), enter="pop", rot=2, key="lap")
    captions(c, S)


def s_feedback(c, S):
    name = "today-phone"
    pl = phone_at(c, name, 520, 470, 0.05)
    fb = (690, 30, 450, 100)
    ring(c, pl, fb, V(S, 0.25), "fb")
    tag_to(c, pl, fb, T("a Feedback button on every page", "« Commentaires » sur chaque page"), AMBER, 1220, 260, V(S, 0.3), "fbt", fsize=38, side="left")
    c.put(A.sticky(T("Your ideas\nshape the\npilot!", "Vos idées\nfaçonnent\nle pilote!"), PINK, 260, 44), 1460, 600, t0=V(S, 0.6), enter="pop", rot=6, key="st")
    captions(c, S)


def s_end(c, S):
    c.put(A.end_card(1180, 620), 960, 450, t0=0.05, enter="pop", dur=0.3, key="card", jit=1.0, jrot=0.2)
    c.put(A.app_icon(180), 560, 330, t0=0.4, enter="drop", dur=0.4, dist=600, rot=-4, key="icon")
    c.put(A.text_img(A.APP, A.font("bold", 104), SLATE), 1040, 320, t0=0.6, enter="slide", from_dir="right", dur=0.35, steps=4, dist=400, key="name", jit=1.0, jrot=0.0)
    c.put(A.label(T("Less paperwork, more teaching.", "Moins de paperasse, plus d'enseignement."), L(66, 56), BLUE), 960, 470, t0=V(S, 0.2), enter="pop", key="tagline", jit=1.0, jrot=0.0)
    c.put(A.tag(T("Join the pilot!", "Joignez-vous au projet pilote!"), AMBER, SLATE, 50), 960, 590, t0=V(S, 0.6), enter="stamp", dur=0.3, steps=3, rot=-3, key="cta")
    c.put(A.label(T("Working name · Pilot build, not online yet · All demo data shown is fictional.",
                    "Nom provisoire · Version pilote, pas encore en ligne · Toutes les données montrées sont fictives."), 24, (100, 110, 130), "sans"),
          960, 715, t0=V(S, 0.4), enter="fade", dur=0.2, steps=2, key="foot", jit=0.5, jrot=0.0)
    c.put(A.maple_leaf(130), 250, 780, t0=V(S, 0.5), enter="drop", rot=-12, key="leaf")
    c.put(A.school_building(220), 1700, 790, t0=V(S, 0.5), enter="drop", rot=3, key="school")
    cols = [BLUE, AMBER, PINK, MINT, SKY, RED]
    rng = np.random.default_rng(5)
    for i in range(34):
        x, y = rng.uniform(330, 1590), rng.uniform(90, 820)
        if 380 < x < 1540 and 150 < y < 760:
            continue
        c.put(A.confetti(cols[i % 6]), x, y, t0=V(S, 0.6) + rng.uniform(0, 0.6), enter="pop", dur=0.25, steps=2, rot=rng.uniform(-60, 60), key=f"conf{i}", jit=2.5, jrot=8)
    captions(c, S)


# ---------------------------------------------------------------------------
_AVAIL = None


def _available():
    global _AVAIL
    if _AVAIL is None:
        import os
        _AVAIL = {os.path.splitext(f)[0] for f in os.listdir(A.SCREENS)}
    return _AVAIL


SCENES = {
    "papers": s_papers, "title": s_title,
    "today": s_today, "calendar": s_calendar, "taught": s_taught, "timetable": s_timetable,
    "unit": s_unit, "year": s_year, "coverage": s_coverage,
    "library": s_library, "versions": s_versions, "review": s_review, "differentiate": s_differentiate, "aicontrols": s_aicontrols,
    "projector": s_projector, "tablets": s_tablets,
    "sick": s_sick, "plan": s_plan, "released": s_released, "code": s_code, "subphone": s_subphone, "alerts": s_alerts,
    "report": s_report, "confirm": s_confirm,
    "bulletins": s_bulletins, "ondevice": s_ondevice, "infoparents": s_infoparents, "print": s_print,
    "direction": s_direction, "audit": s_audit, "yours": s_yours,
    "staff": s_staff, "board": s_board, "hosting": s_hosting,
    "privacy": s_privacy,
    "start": s_start, "bilingual": s_bilingual, "feedback": s_feedback,
    "end": s_end,
}

# extra seconds before / after the voice line, per scene
EXTRA_LEAD = {"title": 0.8, "taught": 0.3, "sick": 0.6, "calendar": 0.2, "projector": 0.2}
EXTRA_TAIL = {"title": 0.4, "papers": 0.6, "end": 2.6, "differentiate": 0.5, "sick": 0.4, "hosting": 0.3, "privacy": 0.3}
