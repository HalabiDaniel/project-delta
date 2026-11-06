"""Maneuver trajectory visualisations: a paper plane, a dashed path and ghost frames.

Each maneuver is a script of body rates (pitch, roll, yaw in rad/s), a speed profile and a 'grip'
(how fast the velocity follows the nose; low grip = the nose turns while the plane keeps sliding).
World: x forward at entry, y left, z up.
"""
import math, sys, os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection, Line3DCollection

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
PAPER = "#f7f2e7"; INK = "#22252b"; BLUE = "#2f6fdf"; RED = "#d9483b"; GREY = "#b9b2a3"; GOLD = "#e39b17"

def bell(t, a, b):
    """Smooth 0→1→0 bump over [a, b], integral = (b-a)/2... normalised so integral = 1."""
    if t < a or t > b: return 0.0
    x = (t - a) / (b - a)
    return (1 - math.cos(2 * math.pi * x)) / (b - a)

def smooth(t, a, b):
    if t <= a: return 0.0
    if t >= b: return 1.0
    x = (t - a) / (b - a)
    return x * x * (3 - 2 * x)

def rot(axis, ang):
    axis = axis / np.linalg.norm(axis)
    K = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    return np.eye(3) + math.sin(ang) * K + (1 - math.cos(ang)) * K @ K

def simulate(T, rates, speed, grip=lambda t: 50.0, force=lambda t, R, v: np.zeros(3), dt=0.005,
             p0=(0, 0, 0), R0=None, v0=None):
    """rates(t) -> (pitch_up, roll_right, yaw_left) rad/s in the body frame."""
    R = np.eye(3) if R0 is None else R0.copy()   # columns: forward, left, up
    p = np.array(p0, float)
    vdir = R[:, 0].copy() if v0 is None else np.array(v0, float)
    out = []
    t = 0.0
    while t <= T + 1e-9:
        out.append((t, p.copy(), R.copy()))
        q, r_, y = rates(t)
        # body axes: f=x, l=y, u=z. Nose up = -rotation about l; roll right = +rotation about f; yaw left = +about u.
        w = R @ np.array([r_, -q, y])
        ang = np.linalg.norm(w) * dt
        if ang > 0: R = rot(w, ang) @ R
        # Re-orthonormalise.
        u, _, vt = np.linalg.svd(R); R = u @ vt
        g = grip(t)
        vdir = vdir + (R[:, 0] - vdir) * (1 - math.exp(-g * dt))
        vdir /= np.linalg.norm(vdir)
        vel = vdir * speed(t) + force(t, R, vdir)
        p = p + vel * dt
        t += dt
    return out

# ---------------------------------------------------------------- plane glyph
WING = np.array([[1.25, 0, 0.02], [-0.85, 0.95, 0.06], [-0.55, 0, 0.0], [-0.85, -0.95, 0.06]])
KEEL = np.array([[1.25, 0, 0.0], [-0.55, 0, 0.0], [-0.75, 0, -0.32]])

def plane_polys(p, R, s):
    w = (R @ (WING * s).T).T + p
    k = (R @ (KEEL * s).T).T + p
    return [[w[0], w[1], w[2]], [w[0], w[2], w[3]], [k[0], k[1], k[2]]]

def draw_plane(ax, p, R, s, color, alpha, edge=INK, z=10):
    polys = plane_polys(p, R, s)
    ax.add_collection3d(Poly3DCollection(polys[:2], facecolor=color, edgecolor=edge, linewidths=0.9,
                                         alpha=alpha))
    ax.add_collection3d(Poly3DCollection(polys[2:], facecolor=shade(color, 0.7), edgecolor=edge,
                                         linewidths=0.7, alpha=alpha))

def shade(hexc, k):
    c = matplotlib.colors.to_rgb(hexc)
    return tuple(min(1, x * k) for x in c)


def kinematic(T, pfun, rollfun=lambda t: 0.0, dt=0.005):
    """Samples along a given path p(t); the nose follows the tangent, banked by roll(t)."""
    out = []; up = np.array([0, 0, 1.0]); prev_f = None
    t = 0.0
    while t <= T + 1e-9:
        p = np.array(pfun(t), float)
        f = np.array(pfun(t + 1e-3), float) - p; f /= np.linalg.norm(f)
        if prev_f is not None:  # parallel transport the up vector
            ax_ = np.cross(prev_f, f); sa = np.linalg.norm(ax_)
            if sa > 1e-9: up = rot(ax_, math.asin(min(1, sa))) @ up
        up = up - f * (up @ f); up /= np.linalg.norm(up)
        l = np.cross(up, f)
        R = np.column_stack([f, l, up]) @ rot(np.array([1.0, 0, 0]), rollfun(t))
        out.append((t, p, R)); prev_f = f; t += dt
    return out

def pick(samples, n):
    if isinstance(n, (list, tuple)):
        ts = np.array([x[0] for x in samples])
        return [int(np.abs(ts - t).argmin()) for t in n]
    return list(np.linspace(0, len(samples) - 1, n).round().astype(int))

def render_side(name, title, subtitle, tracks, size=2.4, notes=None, pad=4, events=(), strip=True):
    """2D orthographic side view (x right, z up): best for moves that happen in the vertical plane."""
    fig = plt.figure(figsize=(9, 6.4), dpi=150, facecolor=PAPER)
    ax = fig.add_axes([0.04, 0.08, 0.92, 0.76], facecolor=PAPER)
    ax.set_aspect("equal"); ax.axis("off")
    allp = np.concatenate([np.array([s[1] for s in tr[0]]) for tr in tracks])
    lo, hi = allp.min(0), allp.max(0)
    ax.set_xlim(lo[0] - pad, hi[0] + pad); ax.set_ylim(lo[2] - pad - 3, hi[2] + pad + 2)
    for gx in np.arange(math.floor(lo[0] / 5) * 5, hi[0] + pad, 5):
        ax.axvline(gx, color="#e9e2d2", lw=0.6, zorder=0)
    for samples, color, label, n, _ in tracks:
        P = np.array([s[1] for s in samples])
        ax.plot(P[:, 0], P[:, 2], linestyle=(0, (5, 3)), color=color, lw=1.8, zorder=2)
        idx = pick(samples, n)
        for j, i in enumerate(idx):
            t, p, R = samples[i]
            a = 0.3 + 0.7 * (j / max(1, len(idx) - 1))
            for k, poly in enumerate(plane_polys(p, R, size)):
                xy = [(v[0], v[2]) for v in poly]
                ax.add_patch(plt.Polygon(xy, closed=True, fc=color if k < 2 else shade(color, 0.7),
                                         ec=INK, lw=0.8, alpha=a, zorder=3 + j))
            top = p + np.array([0, 0, size * 1.25 + 0.6])
            ax.text(top[0], top[2], str(j + 1), color=color, fontsize=8.5, fontweight="bold", ha="center", zorder=20)
    if strip:
        samples, color, _, n, _ = tracks[0]
        idx = pick(samples, n)
        sax = fig.add_axes([0.04, 0.08, 0.92, 0.13], facecolor=PAPER); sax.set_aspect("equal"); sax.axis("off")
        gap = 3.2
        sax.set_xlim(-gap, gap * len(idx)); sax.set_ylim(-1.6, 1.9)
        sax.text(-gap * 0.95, 1.45, "attitude at each frame", fontsize=8, color="#5b5f68", style="italic")
        for j, i in enumerate(idx):
            t, p, R = samples[i]
            for k, poly in enumerate(plane_polys(np.array([j * gap, 0, 0]), R, 1.0)):
                sax.add_patch(plt.Polygon([(v[0], v[2]) for v in poly], fc=color if k < 2 else shade(color, 0.7), ec=INK, lw=0.8))
            sax.text(j * gap, -1.55, f"{j+1}  ·  {t:.2f}s", fontsize=7.5, color=color, ha="center", fontweight="bold")
        ax.set_position([0.04, 0.24, 0.92, 0.62])
    for x, z, txt in events:
        ax.annotate(txt, (x, z), fontsize=9, color=INK, ha="center", style="italic", zorder=30)
    fig.text(0.04, 0.95, title, fontsize=19, fontweight="bold", color=INK)
    fig.text(0.04, 0.925, subtitle, fontsize=10.5, color="#5b5f68", va="top")
    lx = 0.04
    for samples, color, label, _, _ in tracks:
        if not label: continue
        fig.text(lx, 0.03, "■ " + label, color=color, fontsize=9.5, fontweight="bold"); lx += 0.06 + 0.0105 * len(label)
    fig.text(0.96, 0.03, (notes + "   |   " if notes else "") + "side view", color="#5b5f68", fontsize=8.5, ha="right")
    fig.savefig(os.path.join(OUT, name + ".png"), facecolor=PAPER); plt.close(fig)

# ---------------------------------------------------------------- rendering
def render(name, title, subtitle, tracks, frames=7, elev=18, azim=-60, size=2.2, fname=None,
           notes=None, frame_labels=True, ground=True, zoom=1.0):
    """tracks: list of (samples, color, label, frames or None, dashed)"""
    fig = plt.figure(figsize=(9, 6.4), dpi=150, facecolor=PAPER)
    ax = fig.add_axes([0.0, 0.0, 1.0, 0.86], projection="3d", facecolor=PAPER)
    allp = np.concatenate([np.array([s[1] for s in tr[0]]) for tr in tracks])
    lo, hi = allp.min(0), allp.max(0)
    span = (max(hi - lo) * 0.55 + 2) / zoom
    mid = (lo + hi) / 2
    ax.set_xlim(mid[0] - span, mid[0] + span); ax.set_ylim(mid[1] - span, mid[1] + span)
    zlo = lo[2] - 2
    ax.set_zlim(zlo, zlo + 2 * span)
    ax.set_box_aspect((1, 1, 1))
    ax.view_init(elev=elev, azim=azim)
    ax.set_axis_off()
    # Floor grid (paper)
    if ground:
        gx = np.linspace(mid[0] - span, mid[0] + span, 9); gy = np.linspace(mid[1] - span, mid[1] + span, 9)
        segs = [[(x, gy[0], zlo), (x, gy[-1], zlo)] for x in gx] + [[(gx[0], y, zlo), (gx[-1], y, zlo)] for y in gy]
        ax.add_collection3d(Line3DCollection(segs, colors="#e3dccb", linewidths=0.6))
    for samples, color, label, nframes, style in tracks:
        P = np.array([s[1] for s in samples])
        ax.plot(P[:, 0], P[:, 1], P[:, 2], linestyle=(0, (5, 3)) if style == "dash" else "-",
                color=color, lw=1.8, alpha=0.95)
        if ground:
            ax.plot(P[:, 0], P[:, 1], np.full(len(P), zlo), color=color, lw=1.0, alpha=0.18)
        n = nframes if nframes is not None else frames
        idx = np.linspace(0, len(samples) - 1, n).round().astype(int)
        for j, i in enumerate(idx):
            t, p, R = samples[i]
            a = 0.25 + 0.75 * (j / max(1, n - 1))
            draw_plane(ax, p, R, size, color, a)
            if frame_labels and label:
                off = R[:, 2] * size * 1.4
                ax.text(*(p + off), str(j + 1), color=color, fontsize=8, fontweight="bold", ha="center")
            if ground:
                ax.plot([p[0], p[0]], [p[1], p[1]], [zlo, p[2]], color=color, lw=0.5, alpha=0.12)
    fig.text(0.04, 0.95, title, fontsize=19, fontweight="bold", color=INK, family="DejaVu Sans")
    fig.text(0.04, 0.925, subtitle, fontsize=10.5, color="#5b5f68", family="DejaVu Sans", va="top")
    lx = 0.04
    for samples, color, label, _, _ in tracks:
        if not label: continue
        fig.text(lx, 0.03, "■ " + label, color=color, fontsize=9.5, fontweight="bold")
        lx += 0.06 + 0.0105 * len(label)
    if notes:
        fig.text(0.96, 0.03, notes, color="#5b5f68", fontsize=8.5, ha="right")
    fig.savefig(os.path.join(OUT, fname or (name + ".png")), facecolor=PAPER)
    plt.close(fig)

def straight(T, v, p0, R0=None, decel=None):
    return simulate(T, lambda t: (0, 0, 0), (lambda t: v) if decel is None else decel, p0=p0, R0=R0)

# ================================================================ AUTOMATIC
def crane_flip():
    T = 2.2
    rates = lambda t: (2 * math.pi * bell(t, 0.1, 1.5) * 1.0, 0, 0)
    speed = lambda t: 22 - 15 * smooth(t, 0.0, 0.7) + 5 * smooth(t, 1.5, 2.2)
    grip = lambda t: 0.25 if 0.05 < t < 1.5 else 40
    me = simulate(T, rates, speed, grip)
    chaser = straight(T, 25, (-16, 0, -5.5))
    render_side("A1_crane_flip", "A1 · Crane Flip  (Kulbit)",
           "Air-brake, the nose flips a full turn while the plane keeps sliding forward. The chaser overshoots\nand you come out behind it, guns on its tail.",
           [(me, BLUE, "You", [0, 0.3, 0.5, 0.68, 0.82, 0.98, 1.15, 1.4, 2.1], "dash"), (chaser, RED, "Chaser", 6, "dash")], size=2.2,
           events=[(14, -10.5, "chaser overshoots  →")], notes="Fighters · Jumper · Swift   |   ~1.4 s   |   exits slow, same heading")

def fold_back():
    T = 2.3
    rates = lambda t: (math.pi * bell(t, 0.1, 1.5), math.pi * bell(t, 1.5, 2.1), 0)
    speed = lambda t: 24 - 6 * smooth(t, 0.1, 1.5)
    me = simulate(T, rates, speed)
    render("A2_fold_back", "A2 · Fold Back  (Immelmann)",
           "Half loop up, then roll upright: now flying the other way, higher and a little slower.",
           [(me, BLUE, "You", 8, "dash")], elev=12, azim=-70,
           notes="Most fighters & multiroles   |   ~2 s   |   reverses, +height")

def dive_fold():
    T = 2.4
    rates = lambda t: (math.pi * bell(t, 0.6, 2.1), math.pi * bell(t, 0.0, 0.55), 0)
    speed = lambda t: 22 + 10 * smooth(t, 0.6, 2.2)
    me = simulate(T, rates, speed, p0=(0, 0, 30))
    render("A3_dive_fold", "A3 · Dive Fold  (Split-S)",
           "Half roll onto the back, pull through a downward half loop: the other way, lower and faster.",
           [(me, BLUE, "You", 8, "dash")], elev=12, azim=-70,
           notes="Fighters · multiroles · Dart   |   ~2 s   |   reverses, −height, +speed")

def slip_roll(side=+1):
    T = 1.4
    # Full aileron roll while a sideways shove pushes the plane ~8 m to the left.
    rates = lambda t: (0.6 * bell(t, 0.1, 1.1), -side * 2 * math.pi * bell(t, 0.1, 1.1), 0)
    speed = lambda t: 24 + 6 * bell(t, 0.0, 1.2) * 0.6
    shove = lambda t, R, v: np.array([0, side, 0]) * 9.0 * (bell(t, 0.05, 1.15) * 1.1) * 1.0
    me = simulate(T, rates, speed, force=shove)
    shot = straight(T, 24, (0, 0, 0))
    render("A4_slip_roll", "A4 · Slip Roll  (boosted barrel roll, left or right)",
           "A fast roll with a sideways boost: the plane jumps about two wingspans left (A) or right (D).",
           [(me, BLUE, "You", 8, "dash"), (shot, GREY, "Where the enemy aimed", 2, "dash")],
           elev=28, azim=-115, notes="Every eligible plane   |   ~1 s   |   spoils aim, homing rockets re-acquire")

def updraft_roll():
    T = 2.6
    rates = lambda t: (0.9 * bell(t, 0.0, 0.7) * 1.0 - 0.9 * bell(t, 1.6, 2.4),
                       -2 * math.pi * bell(t, 0.75, 1.75), 0)
    speed = lambda t: 22 + 12 * bell(t, 0.0, 1.6) * 0.8
    me = simulate(T, rates, speed)
    render("A5_updraft_roll", "A5 · Updraft Roll  (boosted pop-up)",
           "Kicks the nose up with a boost, rolls a full turn on the climb, then levels off higher on the same heading.",
           [(me, BLUE, "You", 8, "dash")], elev=10, azim=-75,
           notes="Falcon · Lightning · Thug · Jumper · Dart   |   ~2.5 s   |   +height fast, dodges from below")

def paper_hang():
    T = 3.6
    def rates(t):
        pitch = (math.pi / 2) * bell(t, 0.0, 0.8) + (math.pi / 2) * bell(t, 2.6, 3.5)
        yaw = math.pi * bell(t, 1.4, 2.1)
        return (pitch, 0, yaw)
    def speed(t):
        if t < 1.4: return 24 - 20 * smooth(t, 0.3, 1.4)
        if t < 2.1: return 4
        return 4 + 24 * smooth(t, 2.1, 3.2)
    me = simulate(T, rates, speed, grip=lambda t: 1.5 if 1.4 < t < 2.2 else 40)
    render("A6_paper_hang", "A6 · Paper Hang  (Hammerhead / stall turn)",
           "Straight up, hangs at the top, pivots on a wingtip and drops back down the way it came.",
           [(me, BLUE, "You", 9, "dash")], elev=6, azim=-60, notes="Falcon · Raptor   |   ~3.5 s   |   reversal in tight space, bait")

def spiral_drill():
    T = 2.6
    d = np.array([math.cos(math.radians(40)), 0, -math.sin(math.radians(40))])
    side = np.array([0, 1.0, 0]); upv = np.cross(d, side)
    def p(t):
        s_ = 16 * t + 4 * t * t
        r = 6.5 * smooth(t, 0, 0.4) * (1 - smooth(t, 2.0, 2.6))
        a = 5.0 * t
        return np.array([0, 0, 40.0]) + d * s_ + side * r * math.cos(a) + upv * r * math.sin(a)
    me = kinematic(T, p, lambda t: -5.0 * t * smooth(t, 0, 0.4) * (1 - smooth(t, 2.0, 2.6)))
    render("A7_spiral_drill", "A7 · Spiral Drill  (rolling dive)",
           "Noses down and rolls continuously in a tight corkscrew dive, coming out lower and faster.",
           [(me, BLUE, "You", 12, "dash")], elev=14, azim=-50, size=2.6,
           notes="Lightning · Thug · Dart · Specter   |   ~2.5 s   |   escape downward, shakes a tail")

def paper_pivot():
    T = 2.0
    rates = lambda t: (0, 0, math.pi * bell(t, 0.1, 1.1))
    speed = lambda t: 24 - 14 * smooth(t, 0.0, 0.8) + 22 * smooth(t, 1.1, 1.8)
    grip = lambda t: 0.4 if t < 1.1 else 6
    me = simulate(T, rates, speed, grip=grip)
    render("A8_paper_pivot", "A8 · Paper Pivot  (flat 180° drift)",
           "Swings the tail round flat, drifting sideways like a car handbrake turn, then boosts out the other way.",
           [(me, BLUE, "You", 9, "dash")], elev=55, azim=-90,
           notes="Raptor · Jumper · Specter   |   ~1.8 s   |   level reversal, no height change")

# ================================================================ MANUAL
def brake_let_pass():
    T = 4.2
    # Player: S held + mouse up: nose up 50°, speed falls to the air-brake floor; enemy passes; nose
    # back down onto the enemy and Shift.
    rates = lambda t: (1.2 * bell(t, 0.1, 1.1) - 1.2 * bell(t, 1.9, 2.9), 0, 0)
    speed = lambda t: 22 - 17 * smooth(t, 0.1, 1.3) + 28 * smooth(t, 2.6, 3.8)
    me = simulate(T, rates, speed, grip=lambda t: 0.8 if t < 2.6 else 20)
    chaser = straight(T, 24, (-18, 0, -3))
    render_side("M1_brake_let_pass", "M1 · Brake and Let Pass  (manual)",
           "Hold S hard and pull up: the plane bleeds down to air-brake speed, the chaser flies past,\nthen nose back down onto them and boost. You end up on their tail.",
           [(me, BLUE, "You", [0, 0.5, 1.0, 1.6, 2.2, 2.6, 3.0, 3.5, 4.1], "dash"), (chaser, RED, "Chaser", 7, "dash")], size=2.2,
           notes="S + mouse up → wait → mouse down + Shift")

def full_loop():
    T = 3.2
    rates = lambda t: (2 * math.pi * bell(t, 0.1, 3.0), 0, 0)
    speed = lambda t: 24 - 8 * math.sin(math.pi * smooth(t, 0.1, 3.0))
    me = simulate(T, rates, speed)
    render("M2_full_loop", "M2 · Full Loop / Flip  (manual)",
           "Keep pulling the mouse back: the nose goes up, over the top inverted and back round.\nNeeds the 60° pitch limit lifted.",
           [(me, BLUE, "You", 10, "dash")], elev=8, azim=-75, notes="Mouse held back the whole way · the speed drops over the top")

def high_yoyo():
    T = 5.0
    # Enemy turns in a level circle; you are too fast, pull up out of the plane, roll and drop back.
    R_e = 24.0; w_e = 0.75
    ev = simulate(T, lambda t: (0, 0, w_e), lambda t: R_e * w_e, p0=(0, -0, 0))
    # me: start behind, turn with climb
    def rates(t):
        return (0.8 * bell(t, 0.3, 1.8) - 0.9 * bell(t, 2.3, 3.8), -0.9 * bell(t, 0.8, 2.0) + 0.9 * bell(t, 3.0, 4.2), 0.85)
    me = simulate(T, rates, lambda t: 27 - 7 * smooth(t, 0.5, 2.2) + 6 * smooth(t, 2.5, 4.0),
                  p0=(-14, -6, 0), R0=rot(np.array([0, 0, 1]), -0.35))
    render("M3_high_yoyo", "M3 · High Yo-Yo  (manual)",
           "Too fast behind a turning enemy? Climb out of their turn, roll over the top and drop back in behind.",
           [(me, BLUE, "You", 8, "dash"), (ev, RED, "Enemy (turning)", 8, "dash")], elev=28, azim=-60,
           notes="Turn + mouse up → roll in → mouse down")

def low_yoyo():
    T = 4.2
    w_e = 0.7
    ev = simulate(T, lambda t: (0, 0, w_e), lambda t: 17, p0=(0, 0, 10))
    me = simulate(T, lambda t: (-0.5 * bell(t, 0.0, 1.4) + 0.5 * bell(t, 1.8, 3.4), 0, 0.85),
                  lambda t: 18 + 9 * bell(t, 0.0, 2.6) * 1.0,
                  p0=(-20, -4, 10), R0=rot(np.array([0, 0, 1]), -0.2))
    render("M4_low_yoyo", "M4 · Low Yo-Yo  (manual)",
           "Too slow or too far behind? Dive inside the enemy's turn to gain speed and cut the corner, then climb into them.",
           [(me, BLUE, "You", 8, "dash"), (ev, RED, "Enemy (turning)", 8, "dash")], elev=24, azim=-55,
           notes="Turn + mouse down → speed builds → mouse up")

def scissors():
    T = 6.0
    def weave(phase, side):
        return lambda t: (0, 0, side * 1.4 * math.cos(1.6 * t + phase))
    me = simulate(T, weave(0, +1), lambda t: 15 - 4 * smooth(t, 0, 3), p0=(0, -2, 0))
    en = simulate(T, weave(0, -1), lambda t: 17, p0=(-8, 2, 0))
    render("M5_scissors", "M5 · Scissors  (manual)",
           "Both planes weave across each other's path. Whoever slows down more (brake!) ends up behind.",
           [(me, BLUE, "You (braking)", 9, "dash"), (en, RED, "Enemy", 9, "dash")], elev=72, azim=-90,
           notes="A/D or mouse left-right reversals + S", frame_labels=True)

def break_turn():
    T = 4.0
    normal = simulate(T, lambda t: (0, 0, 1.45 * smooth(t, 0, 0.3)), lambda t: 24, p0=(0, 0, 0))
    braked = simulate(T, lambda t: (0, 0, 2.6 * smooth(t, 0, 0.3)), lambda t: 24 - 12 * smooth(t, 0, 0.8), p0=(0, 0, 0))
    render("M6_break_turn", "M6 · Break Turn  (manual)",
           "Brake while turning: slower means a tighter circle (speed-dependent turn rate). Out-turn anyone at full speed.",
           [(braked, BLUE, "You: S + turn", 8, "dash"), (normal, GREY, "Same turn at full speed", 6, "dash")],
           elev=75, azim=-90, notes="S + A/D or mouse · turn rate peaks near 'corner speed'")

def boom_zoom():
    T = 5.0
    R0 = rot(np.array([0, 1, 0]), math.radians(40))
    rates = lambda t: (0.9 * bell(t, 1.4, 2.4) * 1.3 + 0.0, 0, 0)
    me = simulate(T, rates, lambda t: 22 + 14 * smooth(t, 0, 1.6) - 12 * smooth(t, 2.4, 5.0), R0=R0, p0=(0, 0, 40))
    tgt = straight(T, 14, (34, 0, 6))
    render("M7_boom_zoom", "M7 · Boom and Zoom  (manual)",
           "Dive from above with speed, shoot as you pass, and use that speed to climb straight back up out of reach.",
           [(me, BLUE, "You", 9, "dash"), (tgt, RED, "Target", 5, "dash")], elev=6, azim=-90,
           notes="Height → mouse down (dive) → fire → mouse up (zoom)")

for f in [crane_flip, fold_back, dive_fold, slip_roll, updraft_roll, paper_hang, spiral_drill, paper_pivot,
          brake_let_pass, full_loop, high_yoyo, low_yoyo, scissors, break_turn, boom_zoom]:
    f(); print("ok", f.__name__)
