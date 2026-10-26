"""2D drawing set (A3) generated from the 3D model with hidden-line projection."""
import os
import datetime
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.patches import Rectangle, Circle
import FreeCAD as App
import Part

from cad_utils import project, bbox2, render, view_xy

MM = 2.835          # points per mm (font sizes)
W, H = 420.0, 297.0
INK, GREY, RED, BLUE = "#111111", "#8a8f96", "#c0392b", "#1f5fa8"
TODAY = datetime.date.today().isoformat()
N_SHEETS = 7
PROJECT = "UNIVERSAL ATM STAND  -  UATM-1000"


class Sheet:
    def __init__(self, title, dwg, scale, n):
        self.fig = plt.figure(figsize=(W / 25.4, H / 25.4))
        self.ax = ax = self.fig.add_axes([0, 0, 1, 1])
        ax.set_xlim(0, W)
        ax.set_ylim(0, H)
        ax.set_aspect("equal")
        ax.axis("off")
        ax.patch.set_alpha(0)           # let inset renders (drawn underneath) show through
        self.fig.patch.set_facecolor("white")
        self.title, self.dwg, self.scale, self.n = title, dwg, scale, n
        ax.add_patch(Rectangle((20, 10), W - 30, H - 20, fill=False, lw=1.4, ec=INK))
        ax.add_patch(Rectangle((5, 5), W - 10, H - 10, fill=False, lw=0.3, ec=INK))
        for i in range(8):  # zone marks
            x = 20 + (W - 30) * (i + 0.5) / 8
            ax.text(x, H - 7.5, str(i + 1), ha="center", va="center", fontsize=2.2 * MM, color=INK)
            ax.text(x, 7.5, str(i + 1), ha="center", va="center", fontsize=2.2 * MM, color=INK)
        for i, c in enumerate("ABCDEF"):
            y = H - 10 - (H - 20) * (i + 0.5) / 6
            ax.text(12.5, y, c, ha="center", va="center", fontsize=2.2 * MM, color=INK)
            ax.text(W - 7.5, y, c, ha="center", va="center", fontsize=2.2 * MM, color=INK)
        self._title_block()

    # ---------------------------------------------------------------- primitives
    def line(self, xs, ys, lw=0.5, c=INK, ls="-", z=2):
        self.ax.plot(xs, ys, lw=lw, color=c, ls=ls, solid_capstyle="round", zorder=z)

    def text(self, x, y, s, size=2.5, ha="left", va="baseline", rot=0, c=INK, weight="normal",
             family="DejaVu Sans", z=5, **kw):
        return self.ax.text(x, y, s, fontsize=size * MM, ha=ha, va=va, rotation=rot, color=c,
                            weight=weight, family=family, zorder=z, **kw)

    def box(self, x, y, w, h, lw=0.4, ec=INK, fc="none", ls="-", z=1):
        self.ax.add_patch(Rectangle((x, y), w, h, lw=lw, ec=ec, fc=fc, ls=ls, zorder=z))

    def _title_block(self):
        x0, y0, w, h = 250, 10, 160, 46
        self.box(x0, y0, w, h, lw=1.0)
        L = self.line
        for yy in (y0 + 14, y0 + 24, y0 + 34):
            L([x0, x0 + w], [yy, yy], 0.5)
        L([x0 + 100, x0 + 100], [y0, y0 + 24], 0.5)
        L([x0 + 50, x0 + 50], [y0, y0 + 14], 0.5)
        L([x0 + 130, x0 + 130], [y0, y0 + 14], 0.5)
        L([x0 + 100, x0 + 100], [y0 + 34, y0 + h], 0.5)
        t = self.text
        t(x0 + 2, y0 + 41.5, "PROJECT", 1.6, c=GREY)
        t(x0 + 2, y0 + 36.5, PROJECT, 2.6, weight="bold")
        t(x0 + 102, y0 + 41.5, "UNITS / TOLERANCE", 1.6, c=GREY)
        t(x0 + 102, y0 + 36.5, "mm  -  ISO 2768-mK", 2.4)
        t(x0 + 2, y0 + 31, "TITLE", 1.6, c=GREY)
        t(x0 + 2, y0 + 26, self.title, 3.6, weight="bold")
        t(x0 + 2, y0 + 20.5, "DRAWING No.", 1.6, c=GREY)
        t(x0 + 2, y0 + 16, self.dwg, 3.2, weight="bold")
        t(x0 + 102, y0 + 20.5, "PROJECTION", 1.6, c=GREY)
        t(x0 + 102, y0 + 16, "THIRD ANGLE", 2.4)
        t(x0 + 2, y0 + 10.5, "SCALE (A3)", 1.6, c=GREY)
        t(x0 + 2, y0 + 4, self.scale, 3.0, weight="bold")
        t(x0 + 52, y0 + 10.5, "DRAWN / DATE", 1.6, c=GREY)
        t(x0 + 52, y0 + 4, "CAD-gen  " + TODAY, 2.2)
        t(x0 + 102, y0 + 10.5, "REV", 1.6, c=GREY)
        t(x0 + 102, y0 + 4, "A", 3.0, weight="bold")
        t(x0 + 132, y0 + 10.5, "SHEET", 1.6, c=GREY)
        t(x0 + 132, y0 + 4, "%d / %d" % (self.n, N_SHEETS), 3.0, weight="bold")

    # ---------------------------------------------------------------- views
    def view(self, vis, hid, x, y, s, label=None, lw=0.55, color=INK, bbox=None):
        """Place projected polylines with their bbox lower-left at paper (x, y)."""
        xmin, ymin, xmax, ymax = bbox or bbox2(vis)
        f = lambda X, Y: (x + (X - xmin) * s, y + (Y - ymin) * s)
        for p in hid:
            self.ax.plot(x + (p[:, 0] - xmin) * s, y + (p[:, 1] - ymin) * s, lw=0.25, color=color,
                         ls=(0, (3, 2)), zorder=2)
        for p in vis:
            self.ax.plot(x + (p[:, 0] - xmin) * s, y + (p[:, 1] - ymin) * s, lw=lw, color=color,
                         solid_capstyle="round", zorder=3)
        pw, ph = (xmax - xmin) * s, (ymax - ymin) * s
        if label:
            self.text(x + pw / 2, y - 14, label, 2.6, ha="center", weight="bold")
        return f, (x, y, x + pw, y + ph)

    def ground(self, x0, x1, y):
        self.line([x0, x1], [y, y], 0.6)
        for xx in np.arange(x0 + 2, x1, 3):
            self.line([xx, xx - 2], [y, y - 2], 0.25)

    def dim_h(self, p1, p2, yd, value=None, txt=None, c=INK):
        (x1, y1), (x2, y2) = p1, p2
        sgn = 1 if yd >= max(y1, y2) else -1
        for x, y in ((x1, y1), (x2, y2)):
            self.line([x, x], [y + sgn * 1.0, yd + sgn * 1.5], 0.25, c)
        self.ax.annotate("", xy=(x1, yd), xytext=(x2, yd),
                         arrowprops=dict(arrowstyle="<|-|>", lw=0.35, color=c, mutation_scale=5,
                                         shrinkA=0, shrinkB=0), zorder=4)
        s = txt if txt is not None else "%g" % round(value if value is not None else 0, 1)
        self.text((x1 + x2) / 2, yd + 0.8, s, 2.3, ha="center", c=c,
                  bbox=dict(fc="white", ec="none", pad=0.2))

    def dim_v(self, p1, p2, xd, value=None, txt=None, c=INK):
        (x1, y1), (x2, y2) = p1, p2
        sgn = 1 if xd >= max(x1, x2) else -1
        for x, y in ((x1, y1), (x2, y2)):
            self.line([x + sgn * 1.0, xd + sgn * 1.5], [y, y], 0.25, c)
        self.ax.annotate("", xy=(xd, y1), xytext=(xd, y2),
                         arrowprops=dict(arrowstyle="<|-|>", lw=0.35, color=c, mutation_scale=5,
                                         shrinkA=0, shrinkB=0), zorder=4)
        s = txt if txt is not None else "%g" % round(value, 1)
        self.text(xd - 0.8, (y1 + y2) / 2, s, 2.3, ha="center", va="bottom", rot=90, c=c,
                  bbox=dict(fc="white", ec="none", pad=0.2))

    def leader(self, p, q, s, size=2.2, c=INK, ha=None):
        self.line([p[0], q[0]], [p[1], q[1]], 0.3, c)
        self.ax.add_patch(Circle(p, 0.5, color=c, zorder=4))
        ha = ha or ("left" if q[0] >= p[0] else "right")
        self.text(q[0] + (1 if ha == "left" else -1), q[1], s, size, ha=ha, va="center", c=c)

    def notes(self, x, y, title, lines, size=2.15, width=None, gap=3.6):
        self.text(x, y, title, 2.6, weight="bold")
        yy = y - 5
        for ln in lines:
            self.text(x, yy, ln, size)
            yy -= gap
        return yy

    def iso(self, rect, meshes, azim=35, elev=22, frame=True, caption=None, floor=True):
        x, y, w, h = rect
        a = self.fig.add_axes([x / W, y / H, w / W, h / H])
        a.set_zorder(-1)
        render(a, meshes, azim, elev, floor=(-800, -700, 800, 1450) if floor else None)
        if frame:
            self.box(x, y, w, h, lw=0.3, ec=GREY)
        if caption:
            self.text(x + 2, y + h - 4, caption, 2.4, weight="bold")
        return a

    def table(self, x, y, cols, rows, size=1.9, rh=4.2, head_fc="#e8ebef"):
        """cols: [(header, width, align)] ; y = top edge."""
        tw = sum(c[1] for c in cols)
        self.box(x, y - rh, tw, rh, lw=0.4, fc=head_fc)
        cx = x
        for hd, cw, al in cols:
            self.text(cx + (1 if al == "left" else cw - 1 if al == "right" else cw / 2), y - rh + 1.3,
                      hd, size, ha=al if al != "center" else "center", weight="bold")
            cx += cw
        for i, r in enumerate(rows):
            yy = y - rh * (i + 2)
            if i % 2:
                self.box(x, yy, tw, rh, lw=0, fc="#f6f7f9", z=0)
            cx = x
            for (hd, cw, al), v in zip(cols, r):
                self.text(cx + (1 if al == "left" else cw - 1 if al == "right" else cw / 2), yy + 1.3,
                          str(v), size, ha=al if al != "center" else "center")
                cx += cw
        self.box(x, y - rh * (len(rows) + 1), tw, rh * (len(rows) + 1), lw=0.4)
        cx = x
        for hd, cw, al in cols[:-1]:
            cx += cw
            self.line([cx, cx], [y, y - rh * (len(rows) + 1)], 0.2)
        return y - rh * (len(rows) + 1)

    def save(self, pdf, folder, fname):
        pdf.savefig(self.fig)
        self.fig.savefig(os.path.join(folder, fname + ".png"), dpi=170, facecolor="white")
        plt.close(self.fig)


# ====================================================================== helpers
def compound(items, pred):
    return Part.makeCompound([it.shape for it in items if pred(it)])


def section_below(items, pred, z):
    cut = Part.makeBox(6000, 6000, z + 10, App.Vector(-3000, -3000, -10))
    out = []
    for it in items:
        if not pred(it):
            continue
        s = it.shape
        if s.BoundBox.ZMin >= z:
            continue
        out.append(s.common(cut) if s.BoundBox.ZMax > z else s)
    return Part.makeCompound(out)


def meshes(items, MESH, pred, explode=0.0):
    out = []
    for it in items:
        if pred(it):
            v, t = MESH[it.name]
            out.append((v, t, it.color, np.asarray(it.explode, float) * explode))
    return out


PLINTH = ("Base frame", "Levelling & anchoring", "Deck & clamp kit", "Skirting", "Services")
SURROUND = ("Privacy wings", "Canopy", "Header & trims", "Rear wall & door")


# ====================================================================== sheets
def make_all(items, D, P, MESH, bom, folder, log):
    pdf_path = os.path.join(folder, "UATM-1000_Drawing_Set.pdf")
    with PdfPages(pdf_path) as pdf:
        sheet_ga(items, D, MESH, pdf, folder, log)
        sheet_plinth(items, D, MESH, pdf, folder, log)
        sheet_frame(items, D, MESH, pdf, folder, log)
        sheet_deck(items, D, pdf, folder, log)
        sheet_fit(items, D, MESH, pdf, folder, log)
        sheet_exploded(items, D, MESH, pdf, folder, log)
        sheet_bom(bom, pdf, folder, log)
    log("drawing set ->", pdf_path)


# ---------------------------------------------------------------------- 1. GA
def sheet_ga(items, D, MESH, pdf, folder, log):
    s = 1 / 20.0
    sh = Sheet("GENERAL ARRANGEMENT - KIOSK", "UATM-1000-GA", "1:20", 1)
    allc = compound(items, lambda it: True)
    fv, _ = project(allc, "front", hidden=False)
    rv, _ = project(allc, "right", hidden=False)
    pv, _ = project(section_below(items, lambda it: True, 1200), "top", hidden=False)
    log("GA projections done")
    wx1, wx0, Ht = D["wing_x1"], D["wing_x0"], D["total_h"]
    fx, fb = sh.view(fv, [], 42, 40, s, "FRONT ELEVATION (CUSTOMER SIDE)")
    rx, rb = sh.view(rv, [], fb[2] + 34, 40, s, "SIDE ELEVATION (RIGHT)")
    px, pb = sh.view(pv, [], 42, fb[3] + 30, s, "PLAN - SECTION A-A AT +1200 FFL")
    sh.ground(fb[0] - 6, fb[2] + 6, fb[1])
    sh.ground(rb[0] - 6, rb[2] + 6, rb[1])
    # front dims (front view: X=x, Y=z)
    F = lambda x, z: fx(*view_xy("front", x, 0, z))
    sh.dim_h(F(-wx1, 0), F(wx1, 0), fb[1] - 6, 2 * wx1)
    sh.dim_v(F(-wx1, 0), F(-wx1, Ht), fb[0] - 14, Ht)
    sh.dim_v(F(-wx1, 0), F(-wx1, D["canopy_z0"]), fb[0] - 7, D["canopy_z0"])
    sh.dim_v(F(wx1, 0), F(wx1, D["deck_top"]), fb[2] + 6, D["deck_top"])
    sh.dim_v(F(wx1, D["deck_top"]), F(wx1, D["header_z"]), fb[2] + 14, txt="%g" % (D["header_z"] - D["deck_top"]))
    sh.dim_h(F(-wx0, D["deck_top"] + 40), F(wx0, D["deck_top"] + 40), F(0, 600)[1], 2 * wx0)
    # side dims (right view: X=y, Y=z)
    R = lambda y, z: rx(*view_xy("right", 0, y, z))
    wf, co, ry1 = D["wing_front"], D["canopy_overhang"], D["rear_y1"]
    sh.dim_h(R(-wf, 0), R(0, 0), rb[1] - 6, wf)
    sh.dim_h(R(0, 0), R(D["frame_d"], 0), rb[1] - 6, D["frame_d"])
    sh.dim_h(R(-wf, 0), R(ry1, 0), rb[1] - 13, ry1 + wf)
    sh.dim_h(R(-wf - co, Ht), R(ry1, Ht), rb[3] + 6, ry1 + wf + co)
    sh.dim_v(R(ry1, D["canopy_z0"]), R(ry1, Ht), rb[2] + 6, D["canopy_h"])
    # plan dims
    T = lambda x, y: px(*view_xy("top", x, y, 0))
    sh.dim_h(T(-wx1, ry1), T(wx1, ry1), pb[3] + 6, 2 * wx1)
    sh.dim_v(T(wx1, -wf), T(wx1, ry1), pb[2] + 6, ry1 + wf)
    sh.leader(T(0, D["atm_setback"] + D["atm_d"] / 2), (pb[2] + 18, pb[1] + 30), "REFERENCE ATM\n(NOT SUPPLIED)", 2.0)
    sh.leader(T(wx0 - 75, -wf + 145), (pb[2] + 18, pb[1] + 12), "BAG SHELF", 2.0)
    # labels on front view
    sh.leader(F(0, D["total_h"] - 110), (fb[2] + 22, fb[3] - 4), "ILLUMINATED SIGN / CANOPY", 2.0)
    sh.leader(F(-160, D["header_z"] + 70), (fb[2] + 22, fb[3] - 22), "SECURITY MIRROR", 2.0)
    sh.leader(F(wx0 + 25, 900), (fb[2] + 22, fb[1] + 52), "PRIVACY WING", 2.0)
    # iso + notes
    sh.iso((232, 120, 176, 162), meshes(items, MESH, lambda it: True), 35, 18, caption="ISOMETRIC")
    sh.notes(232, 112, "GENERAL NOTES", [
        "1. Universal stand for floor-standing lobby ATMs: W 480-780, D 550-1000,",
        "   H <= 1600 mm, mass <= 1000 kg (static).",
        "2. Reference ATM shown for fit only - supplied by bank / OEM.",
        "3. Floor: level concrete C25/30 min. 150 thk. Anchor with 8x M16",
        "   chemical anchors (125 embed.) after levelling +/-25 mm.",
        "4. Interface heights per EN 1090-2 fabrication; customer zone kept",
        "   clear 964 mm between wings. Check local accessibility code.",
        "5. Finish: frame RAL 7016, wings RAL 9016, canopy brand colour.",
    ], size=2.0, gap=3.3)
    sh.save(pdf, folder, "UATM-1000-GA")


# ---------------------------------------------------------------------- 2. PLINTH
def sheet_plinth(items, D, MESH, pdf, folder, log):
    s = 1 / 10.0
    sh = Sheet("PLINTH KIT ASSEMBLY", "UATM-1100", "1:10", 2)
    pc = compound(items, lambda it: it.group in PLINTH)
    tv, _ = project(pc, "top", hidden=False)
    fv, fh = project(pc, "front", hidden=True)
    rv, rh = project(pc, "right", hidden=True)
    log("plinth projections done")
    hw, fd, dt = D["half_w"], D["frame_d"], D["deck_top"]
    fx, fb = sh.view(fv, fh, 40, 72, s, "FRONT ELEVATION")
    tx, tb = sh.view(tv, [], 40, fb[3] + 26, s, "PLAN (DECK & CLAMP KIT)")
    rx, rb = sh.view(rv, rh, fb[2] + 30, fb[1], s, "SIDE ELEVATION")
    sh.ground(fb[0] - 5, fb[2] + 5, fb[1])
    sh.ground(rb[0] - 5, rb[2] + 5, rb[1])
    F = lambda x, z: fx(*view_xy("front", x, 0, z))
    R = lambda y, z: rx(*view_xy("right", 0, y, z))
    T = lambda x, y: tx(*view_xy("top", x, y, 0))
    t = D["skirt_t"]
    sh.dim_h(F(-hw - t, 0), F(hw + t, 0), fb[1] - 7, 2 * (hw + t))
    sh.dim_v(F(-hw - t, 0), F(-hw - t, dt), fb[0] - 6, dt)
    sh.dim_v(F(hw + t, D["frame_z0"]), F(hw + t, D["deck_z0"]), fb[2] + 6, D["rhs_h"])
    sh.dim_v(F(hw + t, 0), F(hw + t, D["frame_z0"]), fb[2] + 12, txt="%g±%g" % (D["foot_h"], D["foot_adj"]))
    sh.dim_h(R(0, 0), R(fd, 0), rb[1] - 7, fd)
    sh.dim_h(T(-hw, fd), T(hw, fd), tb[3] + 6, 2 * hw)
    sh.dim_v(T(-hw, 0), T(-hw, fd), tb[0] - 6, fd)
    rows = D["xslot_rows_y"]
    sh.dim_v(T(hw, rows[0]), T(hw, rows[1]), tb[2] + 6, D["xslot_pitch"])
    sh.dim_v(T(hw, 0), T(hw, rows[0]), tb[2] + 6, rows[0])
    sh.dim_h(T(-D["xslot_cx"], 0), T(D["xslot_cx"], 0), tb[1] - 6, 2 * D["xslot_cx"])
    sh.leader(T(0, fd / 2), (tb[2] + 18, tb[1] + 62), "CABLE ENTRY Ø%d + GROMMET" % D["cable_hole_d"], 2.0)
    sh.leader(T(D["atm_w"] / 2 + 30, rows[2]), (tb[2] + 18, tb[1] + 50), "SIDE STOP L60x60x6 (ADJ.)", 2.0)
    sh.leader(T(0, D["atm_setback"] + D["atm_d"] + 30), (tb[2] + 18, tb[1] + 92), "REAR STOP L60x60x6 (ADJ.)", 2.0)
    sh.leader(T(D["atm_w"] / 2 - 80, rows[1]), (tb[2] + 18, tb[1] + 38), "ATM HOLD-DOWN M16 (4x)", 2.0)
    sh.leader(F(-hw + 20, 4), (fb[0] + 20, fb[1] - 16), "LEVELLING FOOT M20 (6x)", 2.0, ha="left")
    sh.iso((262, 150, 146, 130), meshes(items, MESH, lambda it: it.group in PLINTH), 32, 30, caption="ISOMETRIC")
    sh.notes(262, 140, "PLINTH NOTES", [
        "1. Deck: 10 mm S355 laser cut, M10 CSK to rivnuts in frame.",
        "2. Universal slots 18 wide: 14x lateral (X), 6x longitudinal (Y).",
        "3. Side/rear stops clamp with M16 T-bolts; set 5 mm clear of ATM",
        "   with 3 mm EPDM strip, then torque 120 Nm.",
        "4. ATM hold-down: M16 8.8 through ATM base, 50x50x6 clamp plate",
        "   under deck. Torque per ATM OEM (typ. 140 Nm).",
        "5. Level with 6x M20 feet (±25), then fix 8x M16 anchors.",
        "6. Front service panel removable for under-deck access.",
        "7. Design load 1000 kg static + 2 kN horizontal at 1.2 m.",
    ], size=1.95, gap=3.2)
    sh.save(pdf, folder, "UATM-1100-Plinth")


# ---------------------------------------------------------------------- 3. FRAME
def sheet_frame(items, D, MESH, pdf, folder, log):
    s = 1 / 10.0
    sh = Sheet("BASE FRAME WELDMENT", "UATM-1110", "1:10", 3)
    pred = lambda it: it.group == "Base frame" or it.name.startswith("Anchor_Bracket")
    fc = compound(items, pred)
    tv, th = project(fc, "top", hidden=True)
    fv, fh = project(fc, "front", hidden=True)
    rv, rh = project(fc, "right", hidden=True)
    log("frame projections done")
    hw, fd, rw = D["half_w"], D["frame_d"], D["rhs_w"]
    fx, fb = sh.view(fv, fh, 40, 72, s, "FRONT ELEVATION")
    tx, tb = sh.view(tv, th, 40, fb[3] + 26, s, "PLAN")
    rx, rb = sh.view(rv, rh, fb[2] + 30, fb[1], s, "SIDE ELEVATION")
    T = lambda x, y: tx(*view_xy("top", x, y, 0))
    F = lambda x, z: fx(*view_xy("front", x, 0, z))
    sh.dim_h(T(-hw, fd), T(hw, fd), tb[3] + 6, 2 * hw)
    sh.dim_v(T(-hw, 0), T(-hw, fd), tb[0] - 10, fd)
    for cy in D["cross_y"]:
        sh.dim_v(T(hw, 0), T(hw, cy), tb[2] + 6 + (8 if cy > 600 else 0), cy)
    bx = D["bearer_x"]
    sh.dim_h(T(-bx, 0), T(bx, 0), tb[1] - 6, 2 * bx)
    sh.dim_v(F(hw, D["frame_z0"]), F(hw, D["deck_z0"]), fb[2] + 6, D["rhs_h"])
    # cut list
    rows, marks = {}, {}
    for it in items:
        if it.group != "Base frame" or not it.name.startswith("Frame_"):
            continue
        bb = it.shape.BoundBox
        L = round(max(bb.XLength, bb.YLength))
        r = rows.setdefault(L, [0, 0.0, []])
        r[0] += 1
        r[1] += it.mass
        r[2].append(it.name.replace("Frame_", "").replace("_", " "))
    data = []
    for i, (L, (q, m, names)) in enumerate(sorted(rows.items(), reverse=True)):
        kind = names[0].rstrip("0123456789 LR").strip()
        data.append(("F%d" % (i + 1), "RHS 80x40x3", kind[:20], q, L, "%.1f" % (m / q), "%.1f" % m))
    data.append(("B1", "PL 110x110x8 + upst.", "Anchor bracket", 4, "-", "-", "-"))
    data.append(("L1", "PL 40x30x6", "Earth lug", 1, "-", "-", "-"))
    sh.text(262, 270, "CUT LIST (S355J2H EN 10219)", 2.6, weight="bold")
    y = sh.table(262, 266, [("Mk", 10, "left"), ("Section", 34, "left"), ("Member", 38, "left"),
                            ("Qty", 10, "right"), ("L mm", 16, "right"), ("kg/ea", 14, "right"),
                            ("kg", 14, "right")], data)
    sh.notes(262, y - 8, "WELDING & FINISH", [
        "1. All joints fillet weld a3 all round, MIG (135), EN ISO 5817-C.",
        "2. Butt-jointed RHS, ends closed by adjoining member; open",
        "   ends of front/rear rails seal-welded with 3 mm cap plates.",
        "3. Frame square within 2 mm across diagonals; top face flat",
        "   within 1.5 mm over full length (deck seating).",
        "4. M20 weld nuts at 6x foot positions inside side rails.",
        "5. M10 rivnuts (20x) in top face for deck fixing - drill Ø13.",
        "6. Hot-dip galvanise ISO 1461 after welding, vent holes Ø10",
        "   at member ends (not shown), then powder coat RAL 7016.",
    ], size=1.95, gap=3.2)
    sh.iso((150, 150, 100, 100),
           meshes(items, MESH, pred), -35, 35, caption="ISOMETRIC (FROM REAR)")
    sh.save(pdf, folder, "UATM-1110-Frame")


# ---------------------------------------------------------------------- 4. DECK PLATE
def sheet_deck(items, D, pdf, folder, log):
    s = 1 / 5.0
    sh = Sheet("UNIVERSAL DECK PLATE", "UATM-1120", "1:5", 4)
    deck = next(it for it in items if it.name == "Deck_Plate").shape
    zc = D["deck_z0"] + D["deck_t"] / 2
    sec = deck.slice(App.Vector(0, 0, 1), zc)
    polys = []
    for w in sec:
        for e in w.Edges:
            pts = e.discretize(QuasiDeflection=0.1)
            polys.append(np.array([(p.x, p.y) for p in pts]))
    # countersinks: draw outer csk circles
    hw, fd = D["half_w"], D["frame_d"]
    ox, oy = 30, 42
    f, b = sh.view(polys, [], ox, oy, s, None, lw=0.6, bbox=(-hw, 0, hw, fd))
    csk = []
    for e in deck.Edges:
        c = e.Curve
        if isinstance(c, Part.Circle) and abs(c.Radius - 10.5) < 0.2 and abs(e.BoundBox.ZMax - D["deck_top"]) < 0.1:
            csk.append((c.Center.x, c.Center.y))
            sh.ax.add_patch(Circle(f(c.Center.x, c.Center.y), 10.5 * s, fill=False, lw=0.3, ec=INK, zorder=3))
    sh.text(b[0] + (b[2] - b[0]) / 2, b[1] - 17, "PLAN - DECK PLATE 10 mm (DATUM A/B AT FRONT-LEFT CORNER)", 2.4,
            ha="center", weight="bold")
    # ordinate dims from front-left corner (datum)
    X = lambda x: f(x, 0)[0]
    Y = lambda y: f(0, y)[1]
    xs_ = sorted(set([-hw, hw, -D["xslot_cx"], D["xslot_cx"], -D["yslot_x"], D["yslot_x"], 0,
                      -D["xslot_cx"] - D["xslot_len"] / 2 + 9, D["xslot_cx"] + D["xslot_len"] / 2 - 9,
                      -D["xslot_cx"] + D["xslot_len"] / 2 - 9, D["xslot_cx"] - D["xslot_len"] / 2 + 9]))
    yb = b[1] - 3
    for x in xs_:
        sh.line([X(x), X(x)], [b[1] - 0.8, yb], 0.25)
        sh.text(X(x), yb - 1, "%g" % (x + hw), 1.9, ha="center", va="top", rot=90)
    ys_ = sorted(set([0, fd] + list(D["xslot_rows_y"]) + [fd / 2]))
    for y in ys_:
        sh.line([b[0] - 0.8, b[0] - 3], [Y(y), Y(y)], 0.25)
        sh.text(b[0] - 3.5, Y(y), "%g" % y, 1.9, ha="right", va="center")
    segy = sorted(set(v for seg in D["yslot_segments"] for v in seg))
    for y in segy:
        sh.line([b[2] + 0.8, b[2] + 3], [Y(y), Y(y)], 0.25, BLUE)
        sh.text(b[2] + 3.5, Y(y), "%g" % y, 1.9, va="center", c=BLUE)
    sh.text(b[2] + 2, b[1] - 6, "Y-SLOT ENDS\n(blue)", 1.7, c=BLUE)
    # tables
    sh.text(242, 272, "FEATURE TABLE", 2.6, weight="bold")
    nx = 2 * D["xslot_rows"]
    ny = 2 * len(D["yslot_segments"])
    data = [
        ("S1", "Slot 18 x %d (lateral X)" % D["xslot_len"], nx, "M16 T-bolt / ATM anchor"),
        ("S2", "Slot 18 x var. (longit. Y)", ny, "Rear stop / ATM anchor"),
        ("H1", "Ø%d through" % D["cable_hole_d"], 1, "Cable entry + grommet"),
        ("H2", "Ø11 csk 90° x Ø21", len(csk), "M10 CSK to frame rivnut"),
    ]
    y = sh.table(242, 268, [("Ref", 10, "left"), ("Feature", 52, "left"), ("Qty", 10, "right"),
                            ("Purpose", 94, "left")], data)
    sh.notes(242, y - 9, "PLATE NOTES", [
        "1. Material S355J2+N EN 10025-2, 10 mm, flatness 2 mm/m.",
        "2. Laser / plasma cut to DXF 'Deck_Plate_10mm_S355.dxf'.",
        "3. Slot pattern: X-slots centred +/-%g, rows at %g + n x %g (n=0..%d)." % (
            D["xslot_cx"], D["xslot_y0"], D["xslot_pitch"], D["xslot_rows"] - 1),
        "4. Y-slots on X = +/-%g between cross members." % D["yslot_x"],
        "5. Remove all burrs, break edges 0.5 x 45°.",
        "6. Hot-dip galvanise ISO 1461 (85 µm), no paint on top face",
        "   under ATM footprint (earth continuity).",
        "7. Countersinks 90° to suit DIN 7991 M10 (flush +0 / -0.5).",
        "8. Engrave 'UATM-1120 / FRONT' on top face front-left.",
        "9. Ordinate dimensions from datum A (left edge) & B (front edge).",
        "   Slot ordinates are to slot centres / arc centres.",
    ], size=1.95, gap=3.3)
    # slot detail 1:2
    sd = 0.5
    cx0, cy0 = 245, 70
    L, w = D["xslot_len"], D["slot_w"]
    th = np.linspace(-np.pi / 2, np.pi / 2, 30)
    xs = list((L / 2 - w / 2 + w / 2 * np.cos(th)) * sd + cx0 + L / 2 * sd)
    ys = list((w / 2 * np.sin(th)) * sd + cy0)
    xs += list((-(L / 2 - w / 2) - w / 2 * np.cos(th[::-1])) * sd + cx0 + L / 2 * sd)
    ys += list((w / 2 * np.sin(th[::-1])) * sd + cy0)
    sh.line(xs + [xs[0]], ys + [ys[0]], 0.6)
    sh.dim_h((cx0, cy0), (cx0 + L * sd, cy0), cy0 + 9, L)
    sh.dim_v((cx0 + L * sd, cy0 - w / 2 * sd), (cx0 + L * sd, cy0 + w / 2 * sd), cx0 + L * sd + 6, w)
    sh.text(cx0, cy0 - 12, "DETAIL C - SLOT S1 (1:2)", 2.2, weight="bold")
    sh.save(pdf, folder, "UATM-1120-Deck")


# ---------------------------------------------------------------------- 5. UNIVERSAL FIT
def sheet_fit(items, D, MESH, pdf, folder, log):
    s = 1 / 10.0
    sh = Sheet("UNIVERSAL FIT & ACCESSIBILITY", "UATM-1000-UF", "1:10 / 1:20", 5)
    deck = next(it for it in items if it.name == "Deck_Plate").shape
    sec = deck.slice(App.Vector(0, 0, 1), D["deck_z0"] + 5)
    polys = [np.array([(p.x, p.y) for p in e.discretize(QuasiDeflection=0.2)]) for w in sec for e in w.Edges]
    hw, fd, sb = D["half_w"], D["frame_d"], D["atm_setback"]
    f, b = sh.view(polys, [], 40, 120, s, "ATM FOOTPRINT ENVELOPE ON DECK (PLAN)", lw=0.35, color=GREY,
                   bbox=(-hw, 0, hw, fd))
    env = [("MIN  %d x %d" % (D["atm_w_min"], D["atm_d_min"]), D["atm_w_min"], D["atm_d_min"], "#2e8b57", (0, (4, 2))),
           ("REF  %d x %d" % (D["atm_w"], D["atm_d"]), D["atm_w"], D["atm_d"], BLUE, "-"),
           ("MAX  %d x %d" % (D["atm_w_max"], D["atm_d_max"]), D["atm_w_max"], D["atm_d_max"], RED, (0, (6, 2, 1, 2)))]
    for i, (lab, w, dd, c, ls) in enumerate(env):
        x0, y0 = f(-w / 2, sb)
        sh.box(x0, y0, w * s, dd * s, lw=0.9, ec=c, ls=ls, z=4)
        sh.text(x0 + 1, y0 + dd * s - 3.2 - 0.0, lab, 2.0, c=c, weight="bold",
                bbox=dict(fc="white", ec="none", pad=0.3))
    # side-stop bolt range band
    for sx in (-1, 1):
        xa, ya = f(sx * (D["xslot_cx"] - D["xslot_len"] / 2 + 9), 0)
        xb, _ = f(sx * (D["xslot_cx"] + D["xslot_len"] / 2 - 9), 0)
        sh.box(min(xa, xb), b[1], abs(xb - xa), b[3] - b[1], lw=0, fc="#f39c12", z=0)
        sh.ax.patches[-1].set_alpha(0.12)
    sh.text(b[2] + 3, b[3] - 4, "Shaded: side-stop / anchor\nbolt adjustment zone", 2.0, va="top")
    sh.dim_h(f(-hw, 0), f(hw, 0), b[1] - 6, 2 * hw)
    sh.dim_v(f(hw, 0), f(hw, sb), b[2] + 5, sb)
    # compatibility table
    sh.text(185, 272, "ADJUSTMENT RANGE", 2.6, weight="bold")
    data = [
        ("Cabinet width", "%d - %d" % (D["atm_w_min"], D["atm_w_max"]), "Side stops slide in X-slots"),
        ("Cabinet depth", "%d - %d" % (D["atm_d_min"], D["atm_d_max"]), "Rear stop in Y-slots (+spacer)"),
        ("Cabinet height", "<= %d" % D["atm_h_max"], "Below ceiling plate +%d" % (D["deck_top"] + D["atm_h_max"] + 10)),
        ("Fascia setback", "0 - 60", "Slot rows / spacer under stops"),
        ("Mass", "<= %d kg" % D["atm_mass_max"], "4x M16 hold-down + 6 feet"),
        ("Anchor pattern", "any 4-bolt", "Lands on slots; else drill 10 mm"),
        ("Floor levelling", "+/- %d" % D["foot_adj"], "6x M20 swivel feet"),
        ("Trim width", "%d - %d" % (D["wing_x0"] - D["atm_w_max"] / 2, D["wing_x0"] - D["atm_w_min"] / 2),
         "Telescopic stainless side trims"),
    ]
    y = sh.table(185, 268, [("Item", 34, "left"), ("Range (mm)", 28, "left"), ("Method", 60, "left")], data)
    # elevation with accessibility zones
    s2 = 1 / 20.0
    sv, _ = project(compound(items, lambda it: it.group in PLINTH or it.ref), "right", hidden=False)
    log("fit projection done")
    rx, rb = sh.view(sv, [], 205, 88, s2, "SIDE ELEVATION - REACH ZONES (1:20)", lw=0.4)
    R = lambda y, z: rx(*view_xy("right", 0, y, z))
    sh.ground(rb[0] - 5, rb[2] + 5, rb[1])
    for z, lab, c in ((1220, "MAX. HIGH REACH 1220", RED), (380, "MIN. LOW REACH 380", RED),
                      (D["deck_top"] + 880, "ATM KEYPAD +%d (REF.)" % (D["deck_top"] + 880), BLUE)):
        p = R(-D["wing_front"] - 250, z)
        q = R(D["frame_d"] + 150, z)
        sh.line([p[0], q[0]], [p[1], p[1]], 0.5, c, ls=(0, (5, 2)), z=5)
        sh.text(q[0] + 2, p[1], lab, 1.9, va="center", c=c)
    sh.dim_v(R(0, 0), R(0, D["deck_top"]), rb[0] - 8, D["deck_top"])
    sh.dim_v(R(D["frame_d"], D["deck_top"]), R(D["frame_d"], D["deck_top"] + D["atm_h"]), rb[2] + 6, D["atm_h"])
    sh.notes(300, 200, "ACCESSIBILITY", [
        "Reach limits shown per ADA 2010 §308 /",
        "EN 17210 guidance. Deck height %d keeps" % D["deck_top"],
        "operable parts of most lobby ATMs <= 1220.",
        "For tall cabinets reduce foot_h / deck",
        "height (parametric) - check OEM data.",
        "Clear floor space 760x1220 in front of",
        "fascia must be kept free of obstacles.",
    ], size=1.9, gap=3.1)
    sh.save(pdf, folder, "UATM-1000-UF-Fit")


# ---------------------------------------------------------------------- 6. EXPLODED
def sheet_exploded(items, D, MESH, pdf, folder, log):
    sh = Sheet("EXPLODED VIEW & ASSEMBLY SEQUENCE", "UATM-1000-EX", "NTS", 6)
    sh.iso((24, 14, 222, 268), meshes(items, MESH, lambda it: True, 1.0), 38, 24, frame=False, floor=False)
    sh.notes(252, 272, "ASSEMBLY SEQUENCE", [
        "1.  Mark out footprint; check floor flatness (<= 5 mm / 2 m).",
        "2.  Place base frame weldment; fit 6x M20 levelling feet.",
        "3.  Level frame (spirit level on top face, <= 1 mm / m).",
        "4.  Drill & set 8x M16 chemical anchors through brackets;",
        "    cure per resin datasheet, torque 80 Nm.",
        "5.  Route power & data conduits; mount junction box.",
        "6.  Fit deck plate: 20x M10 CSK into rivnuts, 45 Nm.",
        "7.  Fit cable grommet; pre-set side & rear stops loosely.",
        "8.  Fit side, rear & front skirts (front = service panel).",
        "9.  Erect privacy wings; bolt to frame & floor (M10).",
        "10. Fit rear wall + service door; check door swing & locks.",
        "11. Fit canopy, sign face, LED + CCTV; wire to JB.",
        "12. Lift ATM onto deck (pallet truck / gantry),",
        "    push against rear stop, clamp side stops at 5 mm.",
        "13. Fit 4x M16 hold-downs through ATM base; torque.",
        "14. Fit telescopic side trims & front header panel.",
        "15. Earth bond: frame lug -> ATM -> JB PE (< 0.1 ohm).",
        "16. Commission: lighting, CCTV, mirror, locks, signage.",
    ], size=2.05, gap=3.6)
    sh.notes(252, 196 - 25, "TOOLS & TORQUES", [
        "M10 CSK deck screws ........ 45 Nm (8.8)",
        "M16 stop T-bolts ........... 120 Nm",
        "M16 anchors ................ 80 Nm (resin)",
        "M20 foot lock nuts ......... 150 Nm",
        "M6 security Torx ........... 8 Nm",
    ], size=2.0, gap=3.4)
    sh.save(pdf, folder, "UATM-1000-EX-Exploded")


# ---------------------------------------------------------------------- 7. BOM
def sheet_bom(bom, pdf, folder, log):
    sh = Sheet("BILL OF MATERIALS", "UATM-1000-BOM", "-", 7)
    data = [(b["item"], b["assembly"], b["description"][:84], b["material"], b["qty"],
             "%.2f" % b["unit_kg"], "%.1f" % b["total_kg"]) for b in bom]
    cols = [("#", 8, "right"), ("Assembly", 40, "left"), ("Description", 158, "left"),
            ("Material", 48, "left"), ("Qty", 10, "right"), ("Unit kg", 16, "right"), ("Total kg", 18, "right")]
    rh = 4.05 if len(data) <= 56 else 3.6
    y = sh.table(26, 282, cols, data, size=1.75, rh=rh)
    tot = sum(b["total_kg"] for b in bom)
    pl = sum(b["total_kg"] for b in bom if b["assembly"] in PLINTH)
    sh.text(26 + 298, y - 5, "PLINTH KIT: %.0f kg     COMPLETE (EXCL. ATM): %.0f kg" % (pl, tot), 2.4,
            ha="right", weight="bold")
    sh.save(pdf, folder, "UATM-1000-BOM")
