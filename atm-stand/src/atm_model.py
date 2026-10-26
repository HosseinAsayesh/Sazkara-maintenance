"""
Universal ATM Stand - geometry builder (FreeCAD Part workbench, pure scripting).

build(P) returns a list of `Item` objects.  Each item is one physical part (or one
reference body) with its solid, colour, group, BOM description, material and an
explode vector used by the viewer / exploded renders.
"""
import math
import FreeCAD as App
import Part

from atm_params import derived

V = App.Vector
ZDIR = V(0, 0, 1)

DENSITY = {  # kg / mm^3
    "S355 steel": 7.85e-6, "S235 steel": 7.85e-6, "Galv. steel": 7.85e-6,
    "Stainless 304": 8.0e-6, "Zinc-plated steel 8.8": 7.85e-6, "Aluminium 6063": 2.7e-6,
    "EPDM rubber": 1.2e-6, "Opal acrylic": 1.19e-6, "Polycarbonate": 1.2e-6,
    "ABS / PA": 1.1e-6, "Glass mirror": 2.5e-6, "Nylon": 1.15e-6,
    "Reference": 0.0,
}

C = {  # RGB 0..1
    "frame": (0.22, 0.24, 0.26), "deck": (0.60, 0.62, 0.64), "clamp": (0.93, 0.55, 0.10),
    "fast": (0.78, 0.78, 0.80), "rubber": (0.07, 0.07, 0.07), "skirt": (0.30, 0.32, 0.35),
    "elec": (0.55, 0.57, 0.60), "conduit": (0.15, 0.15, 0.17), "wing": (0.92, 0.93, 0.94),
    "ss": (0.80, 0.82, 0.84), "brand": (0.05, 0.30, 0.60), "sign": (0.97, 0.98, 1.00),
    "led": (1.00, 0.97, 0.80), "mirror": (0.70, 0.80, 0.88), "dome": (0.12, 0.12, 0.14),
    "atm": (0.36, 0.38, 0.42), "fascia": (0.10, 0.10, 0.12), "screen": (0.10, 0.38, 0.65),
    "key": (0.82, 0.82, 0.84), "green": (0.20, 0.80, 0.35), "wall": (0.88, 0.89, 0.90),
}


class Item:
    def __init__(self, name, group, shape, color, bom=None, material="Reference",
                 explode=(0, 0, 0), ref=False, skin=None):
        self.name, self.group, self.shape, self.color = name, group, shape, color
        self.bom, self.material, self.explode, self.ref = bom, material, explode, ref
        # `skin`: panel modelled as a solid envelope but fabricated as a sheet-metal
        # shell of equivalent thickness `skin` (mm) -> mass from surface area.
        self.skin = skin

    @property
    def mass(self):
        rho = DENSITY.get(self.material, 7.85e-6)
        if self.skin:
            return self.shape.Area / 2.0 * self.skin * rho
        return self.shape.Volume * rho


# ------------------------------------------------------------------ primitives
def box(x0, y0, z0, dx, dy, dz):
    return Part.makeBox(dx, dy, dz, V(x0, y0, z0))


def cyl(r, h, x, y, z, d=ZDIR):
    return Part.makeCylinder(r, h, V(x, y, z), d)


def hexagon(s, h, x, y, z, d=ZDIR):
    """Hex prism, s = across flats."""
    R = s / math.sqrt(3)
    pts = [V(R * math.cos(math.radians(30 + 60 * i)), R * math.sin(math.radians(30 + 60 * i)), 0)
           for i in range(7)]
    solid = Part.Face(Part.makePolygon(pts)).extrude(V(0, 0, h))
    if d != ZDIR:
        rot = App.Rotation(ZDIR, d)
        solid.Placement = App.Placement(V(), rot)
        solid = solid.copy()
    solid.translate(V(x, y, z))
    return solid


def slot(cx, cy, length, w, axis, z0, h):
    """Obround slot; `length` is overall length."""
    s = length - w
    if axis == "x":
        b = box(cx - s / 2, cy - w / 2, z0, s, w, h)
        e1, e2 = cyl(w / 2, h, cx - s / 2, cy, z0), cyl(w / 2, h, cx + s / 2, cy, z0)
    else:
        b = box(cx - w / 2, cy - s / 2, z0, w, s, h)
        e1, e2 = cyl(w / 2, h, cx, cy - s / 2, z0), cyl(w / 2, h, cx, cy + s / 2, z0)
    return b.fuse([e1, e2])


def prism_xz(pts, y0, t):
    """Extrude a polygon given in the XZ plane along +Y by t."""
    poly = Part.makePolygon([V(x, y0, z) for x, z in pts] + [V(pts[0][0], y0, pts[0][1])])
    return Part.Face(poly).extrude(V(0, t, 0))


def prism_yz(pts, x0, t):
    poly = Part.makePolygon([V(x0, y, z) for y, z in pts] + [V(x0, pts[0][0], pts[0][1])])
    return Part.Face(poly).extrude(V(t, 0, 0))


def cut_all(shape, tools):
    if not tools:
        return shape
    return shape.cut(Part.makeCompound(tools)).removeSplitter()


def mirror_x(shape):
    return shape.mirror(V(0, 0, 0), V(1, 0, 0))


def bolt(x, y, z, size=16, length=40, d=ZDIR, washer=True):
    """Hex-head bolt standing on a surface at z (head up). Returns (head+washer, shank)."""
    s = {10: 16, 12: 18, 16: 24, 20: 30}[size]
    k = {10: 6.4, 12: 7.5, 16: 10, 20: 12.5}[size]
    parts = []
    zz = z
    if washer:
        parts.append(cyl(s * 0.62, size * 0.18, x, y, zz))
        zz += size * 0.18
    parts.append(hexagon(s, k, x, y, zz))
    shank = cyl(size / 2, length, x, y, z - length)
    return Part.makeCompound(parts).fuse(shank).removeSplitter()


# ------------------------------------------------------------------ builder
def build(P):
    d = derived(P)
    items = []

    def add(*a, **k):
        it = Item(*a, **k)
        items.append(it)
        return it

    fw, fd, hw = d["frame_w"], d["frame_d"], d["half_w"]
    rw, rh, rt = d["rhs_w"], d["rhs_h"], d["rhs_t"]
    z0, dz0, dtop = d["frame_z0"], d["deck_z0"], d["deck_top"]

    # ================================================================ 1. BASE FRAME
    G = "Base frame"

    def rhs(x0, y0, L, axis):
        if axis == "x":
            o = box(x0, y0, z0, L, rw, rh)
            i = box(x0 + rt, y0 + rt, z0 + rt, L - 2 * rt, rw - 2 * rt, rh - 2 * rt)
        else:
            o = box(x0, y0, z0, rw, L, rh)
            i = box(x0 + rt, y0 + rt, z0 + rt, rw - 2 * rt, L - 2 * rt, rh - 2 * rt)
        return o.cut(i)

    desc = "RHS 80x40x3 S355, welded, %d mm"
    add("Frame_Front_Rail", G, rhs(-hw, 0, fw, "x"), C["frame"], desc % fw, "S355 steel")
    add("Frame_Rear_Rail", G, rhs(-hw, fd - rw, fw, "x"), C["frame"], desc % fw, "S355 steel")
    Ls = fd - 2 * rw
    add("Frame_Side_Rail_L", G, rhs(-hw, rw, Ls, "y"), C["frame"], desc % Ls, "S355 steel")
    add("Frame_Side_Rail_R", G, rhs(hw - rw, rw, Ls, "y"), C["frame"], desc % Ls, "S355 steel")
    Lc = fw - 2 * rw
    for i, cy in enumerate(d["cross_y"]):
        add("Frame_Cross_Member_%d" % (i + 1), G, rhs(-hw + rw, cy - rw / 2, Lc, "x"),
            C["frame"], desc % Lc, "S355 steel")
    # bearers - segmented between the x-members
    stops = [rw] + [v for cy in d["cross_y"] for v in (cy - rw / 2, cy + rw / 2)] + [fd - rw]
    segs = [(stops[i], stops[i + 1]) for i in range(0, len(stops), 2)]
    for side, sx in (("L", -1), ("R", 1)):
        for j, (a, b) in enumerate(segs):
            add("Frame_Bearer_%s%d" % (side, j + 1), G,
                rhs(sx * d["bearer_x"] - rw / 2, a, b - a, "y"), C["frame"],
                desc % round(b - a), "S355 steel")
    add("Earth_Lug_Plate", G, box(hw - rw - 60, fd - rw - 6, z0 + 25, 40, 6, 30).cut(
        cyl(5, 10, hw - rw - 40, fd - rw - 8, z0 + 40, V(0, 1, 0))), C["frame"],
        "Earth bonding lug 40x30x6 c/w M10 stud", "S355 steel")

    # ================================================================ 2. LEVELLING & ANCHORING
    G = "Levelling & anchoring"
    ex = (0, 0, -120)
    foot_pts = [(sx * (hw - rw / 2), y) for sx in (-1, 1) for y in (rw / 2, fd / 2, fd - rw / 2)]
    for i, (x, y) in enumerate(foot_pts):
        pad = cyl(25, 8, x, y, 0)
        add("Foot_Pad_%d" % (i + 1), G, pad, C["rubber"], "Levelling foot anti-slip pad Ø50", "EPDM rubber", ex)
        swivel = cyl(22, 10, x, y, 8).fuse(Part.makeSphere(13, V(x, y, 22))).removeSplitter()
        rod = cyl(10, z0 + 30 - 18, x, y, 18)
        nut = hexagon(30, 16, x, y, z0 - 16)
        add("Levelling_Foot_%d" % (i + 1), G, swivel.fuse([rod, nut]).removeSplitter(), C["fast"],
            "Levelling foot M20x60, swivel base, lock nut, 1500 kg SWL", "Zinc-plated steel 8.8", ex)

    for i, (sx, sy) in enumerate(((-1, 0), (1, 0), (-1, 1), (1, 1))):
        # bracket built for front-left, mirrored as needed
        x_in = -hw + rw
        y0b = 50
        plate = box(x_in, y0b, 0, 110, 110, 8)
        upst = box(x_in, y0b, 8, 8, 110, z0 + 60 - 8)
        gus = prism_xz([(x_in + 8, 8), (x_in + 80, 8), (x_in + 8, z0 + 50)], y0b + 51, 8)
        brk = plate.fuse([upst, gus]).removeSplitter()
        hole = cyl(9, 20, x_in + 70, y0b + 25, -5)
        hole2 = cyl(9, 20, x_in + 70, y0b + 85, -5)
        brk = brk.cut(hole).cut(hole2)
        bolts = [bolt(x_in + 70, y0b + 25, 8, 16, 110), bolt(x_in + 70, y0b + 85, 8, 16, 110)]
        if sx > 0:
            brk = mirror_x(brk)
            bolts = [mirror_x(b) for b in bolts]
        if sy:
            mir = lambda s: s.mirror(V(0, fd / 2, 0), V(0, 1, 0))
            brk, bolts = mir(brk), [mir(b) for b in bolts]
        add("Anchor_Bracket_%d" % (i + 1), G, brk, C["frame"],
            "Floor anchor bracket 110x110x8 + gusset, welded to side rail", "S355 steel", ex)
        for j, b in enumerate(bolts):
            add("Anchor_Bolt_%d%s" % (i + 1, "ab"[j]), G, b, C["fast"],
                "Chemical anchor M16x160 A4 c/w nut & washer (125 embed.)", "Zinc-plated steel 8.8", ex)

    # ================================================================ 3. DECK PLATE
    G = "Deck & clamp kit"
    deck = box(-hw, 0, dz0, fw, fd, d["deck_t"])
    tools = []
    for y in d["xslot_rows_y"]:
        for sx in (-1, 1):
            tools.append(slot(sx * d["xslot_cx"], y, d["xslot_len"], d["slot_w"], "x", dz0 - 1, 20))
    for a, b in d["yslot_segments"]:
        for sx in (-1, 1):
            tools.append(slot(sx * d["yslot_x"], (a + b) / 2, b - a, d["yslot_w"], "y", dz0 - 1, 20))
    tools.append(cyl(d["cable_hole_d"] / 2, 20, 0, fd / 2, dz0 - 1))
    # countersunk deck screws (holes) on frame centre-lines
    screw_pts = [(x, y) for x in (-420, -210, 0, 210, 420) for y in (rw / 2, fd - rw / 2)]
    screw_pts += [(sx * (hw - rw / 2), y) for sx in (-1, 1) for y in (fd * 0.27, fd / 2 + 1, fd * 0.73)]
    screw_pts += [(x, cy) for x in (-300, 300) for cy in d["cross_y"]]
    for x, y in screw_pts:
        tools.append(cyl(5.5, 20, x, y, dz0 - 1))
        tools.append(Part.makeCone(5.5, 10.5, 5, V(x, y, dtop - 5)))
    deck = cut_all(deck, tools)
    add("Deck_Plate", G, deck, C["deck"],
        "Universal deck plate %dx%dx%d, laser cut slot pattern, HDG" % (fw, fd, d["deck_t"]),
        "S355 steel", (0, 0, 220))
    heads = [Part.makeCone(5.5, 10, 4.6, V(x, y, dtop - 4.6)) for x, y in screw_pts]
    add("Deck_Screws", G, Part.makeCompound(heads), C["fast"],
        "M10x30 countersunk screw DIN 7991 + rivnut (set of %d)" % len(heads),
        "Zinc-plated steel 8.8", (0, 0, 220))
    gr = cyl(70, 4, 0, fd / 2, dtop).fuse(cyl(d["cable_hole_d"] / 2, d["deck_t"], 0, fd / 2, dz0))
    gr = gr.cut(cyl(45, 30, 0, fd / 2, dz0 - 5))
    add("Cable_Grommet", G, gr, C["rubber"], "Cable entry grommet Ø120 / Ø90 brush insert",
        "EPDM rubber", (0, 0, 260))

    # ---------------------------------------------------------------- clamp kit
    G = "Deck & clamp kit"
    exc = (0, 0, 380)
    ys, sb, aw, ad = d["xslot_rows_y"], d["atm_setback"], d["atm_w"], d["atm_d"]
    rows_in = [y for y in ys if sb + 60 <= y <= sb + ad - 60]
    r1, r2 = rows_in[0], rows_in[-1]
    leg, st = d["stop_leg"], d["stop_t"]
    a = aw / 2 + 5
    ang = box(a, r1 - 60, dtop, leg, r2 - r1 + 120, st).fuse(
        box(a, r1 - 60, dtop, st, r2 - r1 + 120, leg)).removeSplitter()
    ang = cut_all(ang, [slot(a + 35, y, 40, 18, "y", dtop - 1, 20) for y in (r1, r2)])
    pad = box(a - 3, r1 - 50, dtop + 12, 3, r2 - r1 + 100, leg - 18)
    sbolts = [bolt(a + 35, y, dtop + st, 16, 45) for y in (r1, r2)]
    for side, f in (("R", lambda s: s), ("L", mirror_x)):
        add("Side_Stop_Angle_" + side, G, f(ang), C["clamp"],
            "Adjustable side stop L60x60x6, slotted, L=%d" % (r2 - r1 + 120), "S355 steel", exc)
        add("Side_Stop_Pad_" + side, G, f(pad), C["rubber"], "EPDM anti-vibration strip 3 mm",
            "EPDM rubber", exc)
        for j, b in enumerate(sbolts):
            add("Side_Stop_Bolt_%s%d" % (side, j + 1), G, f(b), C["fast"],
                "T-head bolt M16x45 + washer + nyloc (slot clamp)", "Zinc-plated steel 8.8", exc)
    yb = sb + ad + 5
    rs = box(-200, yb, dtop, 400, leg, st).fuse(box(-200, yb, dtop, 400, st, leg)).removeSplitter()
    rs = cut_all(rs, [slot(sx * d["yslot_x"], yb + 35, 40, 18, "x", dtop - 1, 20) for sx in (-1, 1)])
    add("Rear_Stop_Angle", G, rs, C["clamp"], "Adjustable rear stop L60x60x6, L=400",
        "S355 steel", exc)
    add("Rear_Stop_Pad", G, box(-190, yb - 3, dtop + 12, 380, 3, leg - 18), C["rubber"],
        "EPDM anti-vibration strip 3 mm", "EPDM rubber", exc)
    for sx in (-1, 1):
        add("Rear_Stop_Bolt_%s" % ("L" if sx < 0 else "R"), G,
            bolt(sx * d["yslot_x"], yb + 35, dtop + st, 16, 45), C["fast"],
            "T-head bolt M16x45 + washer + nyloc (slot clamp)", "Zinc-plated steel 8.8", exc)
    # ATM hold-down bolts (through ATM base into deck slots)
    hx = aw / 2 - 80
    for i, (sx, y) in enumerate([(sx, y) for y in (r1, r2) for sx in (-1, 1)]):
        hd = bolt(sx * hx, y, dtop, 16, 70).fuse(box(sx * hx - 25, y - 25, dtop, 50, 50, 1)).removeSplitter()
        add("ATM_HoldDown_%d" % (i + 1), G, hd, C["fast"],
            "ATM hold-down M16x70 8.8 + 50x50x6 under-deck clamp plate", "Zinc-plated steel 8.8",
            (0, 0, 1000))

    # ================================================================ 4. SKIRTING
    G = "Skirting"
    t, zs = d["skirt_t"], d["skirt_gap"]
    hs = dtop - zs
    front = box(-hw - t, -t, zs, fw + 2 * t, t, hs)
    louv = [box(x - 55, -t - 1, z, 110, t + 2, 9) for x in (-375, -225, -75, 75, 225, 375)
            for z in (zs + 35, zs + 65)]
    front = cut_all(front, louv)
    add("Skirt_Front_Service_Panel", G, front, C["skirt"],
        "Front kick / service panel 2 mm, louvred, 4x M6 security Torx", "Galv. steel", (0, -260, 0))
    fixings = [cyl(6, 2, x, -t, zs + 18, V(0, -1, 0)) for x in (-hw + 20, hw - 20)] + \
              [cyl(6, 2, x, -t, dtop - 18, V(0, -1, 0)) for x in (-hw + 20, hw - 20)]
    add("Skirt_Front_Fixings", G, Part.makeCompound(fixings), C["fast"],
        "M6 pin-Torx security screw (set of 4)", "Stainless 304", (0, -260, 0))
    side = box(hw, 0, zs, t, fd, hs)
    add("Skirt_Side_R", G, side, C["skirt"], "Side skirt 2 mm", "Galv. steel", (260, 0, 0))
    add("Skirt_Side_L", G, mirror_x(side), C["skirt"], "Side skirt 2 mm", "Galv. steel", (-260, 0, 0))
    rear = box(-hw - t, fd, zs, fw + 2 * t, t, hs)
    rear = rear.cut(box(-100, fd - 1, zs - 1, 200, t + 2, 29))
    add("Skirt_Rear", G, rear, C["skirt"], "Rear skirt 2 mm c/w 200x28 cable mouse-hole",
        "Galv. steel", (0, 260, 0))
    add("Cable_Brush_Strip", G, box(-100, fd - 8, zs, 200, 6, 28), C["rubber"],
        "Brush strip 200 mm for surface-run cable entry", "Nylon", (0, 300, 0))

    # ================================================================ 5. ELECTRICAL / SERVICES
    G = "Services"
    for nm, x in (("Power", -28), ("Data", 28)):
        c = cyl(16, dtop + 45, x, fd / 2, 0).cut(cyl(12, dtop + 50, x, fd / 2, -1))
        add("Conduit_" + nm, G, c, C["conduit"], "Flexible conduit Ø32 (%s), floor to ATM" % nm.lower(),
            "Nylon", (0, 0, 60))
    jb = box(-80, fd / 2 + 70, 12, 160, 120, 70)
    lid = box(-84, fd / 2 + 66, 82, 168, 128, 6)
    add("Junction_Box", G, jb, C["elec"], "IP65 junction box 160x120x75 c/w 16 A fused spur + RCBO",
        "ABS / PA", (0, 0, 60))
    add("Junction_Box_Lid", G, lid, C["conduit"], "Junction box lid", "ABS / PA", (0, 0, 90))

    # ================================================================ 6. PRIVACY SURROUND
    if d["surround"]:
        wx0, wx1, wt = d["wing_x0"], d["wing_x1"], d["wing_t"]
        wf, cz0, H = d["wing_front"], d["canopy_z0"], d["total_h"]
        ry0, ry1 = d["rear_y"], d["rear_y1"]

        G = "Privacy wings"
        wing = box(wx0, -wf, 0, wt, ry1 + wf, cz0)
        fe = [e for e in wing.Edges if abs(e.BoundBox.YMin + wf) < 1e-6 and e.BoundBox.ZLength > 1]
        wing = wing.makeFillet(wt / 2 - 0.5, fe)
        # recessed accent groove on the outer face
        wing = wing.cut(box(wx1 - 4, -wf + 120, 160, 5, ry1 + wf - 240, 12))
        wing = wing.cut(box(wx1 - 4, -wf + 120, cz0 - 172, 5, ry1 + wf - 240, 12))
        kick_o = box(wx1, -wf + 30, 0, 1.5, ry1 + wf - 30, 150)
        kick_i = box(wx0 - 1.5, -wf + 30, 0, 1.5, wf - 32, 150)
        for side, f, sx in (("R", lambda s: s, 1), ("L", mirror_x, -1)):
            add("Privacy_Wing_" + side, G, f(wing), C["wing"],
                "Privacy wing 50 mm, 1.5 mm Zintec skins on 40x40 frame, powder coat RAL 9016",
                "Galv. steel", (sx * 520, 0, 0), skin=2.5)
            add("Wing_Kick_Plate_Outer_" + side, G, f(kick_o), C["ss"],
                "Kick plate 1.5 mm brushed stainless", "Stainless 304", (sx * 560, 0, 0))
            add("Wing_Kick_Plate_Inner_" + side, G, f(kick_i), C["ss"],
                "Kick plate 1.5 mm brushed stainless", "Stainless 304", (sx * 520, 0, 0))
        # customer bag shelf on right wing
        shelf = box(wx0 - 150, -wf + 20, 1050, 150, 250, 15)
        shelf = shelf.fuse(box(wx0 - 150, -wf + 20, 1065, 150, 6, 12)).removeSplitter()
        brk = prism_xz([(wx0, 1050), (wx0 - 110, 1050), (wx0, 950)], -wf + 140, 6)
        add("Bag_Shelf", G, shelf, C["ss"], "Customer bag shelf 250x150 stainless",
            "Stainless 304", (300, -200, 0))
        add("Bag_Shelf_Bracket", G, brk, C["ss"], "Shelf gusset 6 mm", "Stainless 304", (300, -200, 0))

        G = "Canopy"
        exk = (0, 0, 650)
        co = d["canopy_overhang"]
        can = box(-wx1, -wf - co, cz0, 2 * wx1, ry1 + wf + co, d["canopy_h"])
        can = can.cut(box(-wx1 + 2, -wf - co + 20, cz0 + 2, 2 * wx1 - 4, ry1 + wf + co - 22,
                          d["canopy_h"] - 4))   # 2 mm folded shell
        can = can.cut(box(-wx1 + 30, -wf - co - 1, cz0 + 25, 2 * wx1 - 60, 22, d["canopy_h"] - 50))
        add("Canopy_Box", G, can, C["brand"],
            "Canopy / topper 2 mm aluminium folded box, powder coat brand colour", "Aluminium 6063", exk)
        add("Sign_Face_Front", G, box(-wx1 + 30, -wf - co - 1 + 15, cz0 + 25, 2 * wx1 - 60, 5,
                                     d["canopy_h"] - 50), C["sign"],
            "Illuminated sign face 5 mm opal acrylic (graphics by others)", "Opal acrylic", exk)
        add("LED_Downlight", G, box(-450, -wf - co + 20, cz0 - 8, 900, 30, 8), C["led"],
            "LED linear downlight 900 mm, 24 V, 4000 K, 500 lux at keypad", "Aluminium 6063", exk)
        dome = Part.makeSphere(45, V(0, -wf / 2, cz0)).common(box(-50, -wf / 2 - 50, cz0 - 50, 100, 100, 50))
        dome = dome.fuse(cyl(55, 10, 0, -wf / 2, cz0 - 10)).removeSplitter()
        add("CCTV_Dome", G, dome, C["dome"], "Vandal-proof IP dome camera (by bank)", "Polycarbonate", exk)
        add("LED_Driver", G, box(-150, 400, cz0 + 20, 300, 60, 40), C["elec"],
            "LED driver 24 V 60 W + photocell/timer", "Aluminium 6063", exk)

        G = "Header & trims"
        hz = d["header_z"]
        hdr = box(-wx0, 0, hz, 2 * wx0, 28, cz0 - hz)
        add("Header_Panel", G, hdr, C["wing"], "Front header panel 2 mm, removable", "Galv. steel",
            (0, -250, 250), skin=2)
        mir = box(-220, -5, hz + 40, 440, 5, 60)
        mir = mir.makeFillet(2, [e for e in mir.Edges if abs(e.BoundBox.YMin + 5) < 1e-6])
        add("Security_Mirror", G, mir, C["mirror"], "Rear-view security mirror 440x60, acrylic",
            "Glass mirror", (0, -300, 250))
        tw = wx0 - aw / 2
        trim = box(aw / 2, sb - 3, dtop, tw, 3, hz - dtop)
        trim = trim.fuse(box(aw / 2, sb - 3, dtop, 3, 40, hz - dtop)).removeSplitter()
        for side, f, sx in (("R", lambda s: s, 1), ("L", mirror_x, -1)):
            add("Side_Trim_" + side, G, f(trim), C["ss"],
                "Telescopic side trim 3 mm stainless (cut to ATM width, here %d mm)" % round(tw),
                "Stainless 304", (sx * 300, -200, 0))
        top_fill = box(-wx0, sb, dtop + d["atm_h_max"] + 10, 2 * wx0, ry0 - sb, 2)
        add("Ceiling_Plate", G, top_fill, C["wall"], "Internal ceiling / anti-intrusion plate 2 mm",
            "Galv. steel", (0, 0, 450))

        G = "Rear wall & door"
        dw, dh = d["door_w"], d["door_h"]
        dz = 80
        rw_ = box(-wx0, ry0, 0, 2 * wx0, ry1 - ry0, cz0)
        rw_ = rw_.cut(box(-dw / 2, ry0 - 1, dz, dw, ry1 - ry0 + 2, dh))
        add("Rear_Wall", G, rw_, C["wing"], "Rear service wall 40 mm composite, door frame",
            "Galv. steel", (0, 450, 0), skin=2.5)
        door = box(-dw / 2 + 2, ry0 + 5, dz + 2, dw - 4, ry1 - ry0 - 5, dh - 4)
        vents = [box(-150, ry0, z, 300, 50, 10) for z in
                 [dz + 120 + 25 * i for i in range(4)] + [dz + dh - 220 + 25 * i for i in range(4)]]
        door = cut_all(door, vents)
        add("Rear_Service_Door", G, door, C["wing"],
            "Service door 760x1900, 2 mm skins, 3-point locking", "Galv. steel", (0, 750, 0),
            skin=2.5)
        hinges = [cyl(10, 140, -dw / 2 - 4, ry1 + 11, z) for z in (dz + 200, dz + dh / 2 - 70, dz + dh - 340)]
        add("Door_Hinges", G, Part.makeCompound(hinges), C["ss"], "Heavy-duty concealed-pin hinge (x3)",
            "Stainless 304", (0, 750, 0))
        hx_ = dw / 2 - 70
        handle = box(hx_ - 20, ry1, dz + 950, 40, 6, 180).fuse(
            box(hx_ - 12, ry1 + 6, dz + 980, 24, 22, 120)).removeSplitter()
        lock = cyl(12, 10, hx_, ry1, dz + 1200, V(0, 1, 0))
        add("Door_Handle", G, handle, C["ss"], "Swing handle, 3-point rod espagnolette", "Stainless 304",
            (0, 750, 0))
        add("Door_Lock", G, lock, C["fast"], "High-security cylinder lock (keyed alike)", "Stainless 304",
            (0, 750, 0))

    # ================================================================ 7. REFERENCE ATM
    if d["show_atm"]:
        G = "Reference ATM"
        exa = (0, 0, 900)
        b, aw2, ah = dtop, aw / 2, d["atm_h"]
        y0, y1 = sb, sb + ad
        body = box(-aw2, y0, b, aw, ad, ah)
        body = body.cut(box(-aw2 + 30, y0 - 1, b + 820, aw - 60, 141, 520))
        add("ATM_Body", G, body, C["atm"], ref=True, explode=exa)
        console = box(-aw2 + 30, y0 - 100, b + 860, aw - 60, 240, 20)
        add("ATM_Console", G, console, C["fascia"], ref=True, explode=exa)
        bez = box(0, 0, 0, 420, 14, 320)
        scr = box(20, -1, 20, 380, 1, 280)
        rot = App.Placement(V(-210, y0 + 45, b + 990), App.Rotation(V(1, 0, 0), -12))
        bez.Placement = rot.multiply(bez.Placement)
        scr.Placement = rot.multiply(scr.Placement)
        add("ATM_Screen_Bezel", G, bez.copy(), C["fascia"], ref=True, explode=exa)
        add("ATM_Screen", G, scr.copy(), C["screen"], ref=True, explode=exa)
        kp = box(-80, y0 - 85, b + 880, 130, 105, 3)
        keys = [box(-74 + c * 31, y0 - 79 + r * 25, b + 883, 22, 20, 4) for c in range(4) for r in range(4)]
        add("ATM_EPP_Keypad", G, kp, C["fascia"], ref=True, explode=exa)
        add("ATM_Keys", G, Part.makeCompound(keys), C["key"], ref=True, explode=exa)
        cr = box(120, y0 - 80, b + 880, 90, 60, 70).cut(box(132, y0 - 81, b + 930, 66, 30, 4))
        add("ATM_Card_Reader", G, cr, C["fascia"], ref=True, explode=exa)
        add("ATM_Card_Light", G, box(128, y0 - 81, b + 922, 74, 1, 4), C["green"], ref=True, explode=exa)
        rp = box(-280, y0 - 70, b + 880, 100, 40, 40).cut(box(-265, y0 - 71, b + 905, 70, 10, 4))
        add("ATM_Receipt_Printer", G, rp, C["fascia"], ref=True, explode=exa)
        cd = box(-140, y0 - 20, b + 740, 280, 20, 80).cut(box(-110, y0 - 21, b + 770, 220, 10, 16))
        add("ATM_Cash_Dispenser", G, cd, C["fascia"], ref=True, explode=exa)
        add("ATM_Topper_Light", G, box(-aw2 + 30, y0 - 2, b + ah - 75, aw - 60, 2, 50), C["led"],
            ref=True, explode=exa)
        sd = box(-aw2 + 40, y1, b + 40, aw - 80, 4, 700)
        sd = sd.fuse(cyl(35, 25, 0, y1 + 4, b + 390, V(0, 1, 0))).removeSplitter()
        add("ATM_Safe_Door", G, sd, C["fascia"], ref=True, explode=exa)

    return items, d
