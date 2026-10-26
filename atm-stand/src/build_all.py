"""
Universal ATM Stand - full build.

Run headless:   freecad.cmd src/build_all.py        (or ./build.sh)
Run in GUI:     Macro > Execute src/build_all.py     (also colours the model)

Outputs (relative to the project root):
    cad/        ATM_Stand.FCStd, STEP files, deck plate DXF
    stl/        per-part STL + full assembly STL
    renders/    shaded PNG renders
    drawings/   PDF drawing set + PNG/SVG per sheet
    viewer/     interactive 3D viewer (single HTML file)
    BOM.csv, BOM.md
"""
import os
import sys
import json
import base64
import csv
import time

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else os.path.join(os.getcwd(), "src")
if not os.path.exists(os.path.join(HERE, "atm_model.py")):
    HERE = os.path.join(os.getcwd(), "src") if os.path.exists(os.path.join(os.getcwd(), "src")) else os.getcwd()
sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)

import numpy as np
import FreeCAD as App
import Part
import Mesh
import Import

import importlib
import atm_params, atm_model, cad_utils
for m in (atm_params, atm_model, cad_utils):
    importlib.reload(m)
from atm_params import P
from atm_model import build
from cad_utils import tessellate, render, write_dxf

T0 = time.time()


def log(*a):
    print("[%5.1fs]" % (time.time() - T0), *a, flush=True)


def outdir(*p):
    d = os.path.join(ROOT, *p)
    os.makedirs(d, exist_ok=True)
    return d


items, D = build(P)
log("built %d items" % len(items))

PLINTH_GROUPS = ("Base frame", "Levelling & anchoring", "Deck & clamp kit", "Skirting", "Services")
SURROUND_GROUPS = ("Privacy wings", "Canopy", "Header & trims", "Rear wall & door")

# ====================================================================== FreeCAD document
doc_name = "ATM_Stand"
if doc_name in App.listDocuments():
    App.closeDocument(doc_name)
doc = App.newDocument(doc_name)
sheet = doc.addObject("Spreadsheet::Sheet", "Parameters")
sheet.set("A1", "Parameter")
sheet.set("B1", "Value")
for i, (k, v) in enumerate(P.items(), start=2):
    sheet.set("A%d" % i, k)
    sheet.set("B%d" % i, "'" + str(v) if not isinstance(v, (int, float)) or isinstance(v, bool) else str(v))
groups = {}
objs = []
for it in items:
    g = groups.get(it.group)
    if g is None:
        g = groups[it.group] = doc.addObject("App::DocumentObjectGroup", it.group.replace(" ", "_").replace("&", "and"))
        g.Label = it.group
    o = doc.addObject("Part::Feature", it.name)
    o.Shape = it.shape
    o.addProperty("App::PropertyColor", "DesignColour", "ATM", "Design colour")
    o.DesignColour = tuple(it.color)
    o.addProperty("App::PropertyString", "Description", "ATM", "BOM description")
    o.Description = it.bom or "Reference body (not supplied)"
    o.addProperty("App::PropertyString", "Material", "ATM", "Material")
    o.Material = it.material
    o.addProperty("App::PropertyFloat", "MassKg", "ATM", "Estimated mass")
    o.MassKg = round(it.mass, 3)
    g.addObject(o)
    objs.append((it, o))
    if App.GuiUp:
        o.ViewObject.ShapeColor = tuple(it.color)
        if it.ref:
            o.ViewObject.Transparency = 35
doc.recompute()
cad = outdir("cad")
fc_path = os.path.join(cad, "ATM_Stand.FCStd")
if os.path.exists(fc_path):
    os.remove(fc_path)  # avoid FreeCAD .FCBak backups on every rebuild
doc.saveAs(fc_path)
log("FCStd saved")

# ====================================================================== STEP
def step(name, pred):
    sel = [o for it, o in objs if pred(it)]
    Import.export(sel, os.path.join(cad, name))
    log("STEP", name, len(sel))


step("ATM_Stand_Complete.step", lambda it: True)
step("ATM_Stand_Complete_noATM.step", lambda it: not it.ref)
step("ATM_Plinth_Kit.step", lambda it: it.group in PLINTH_GROUPS)
step("ATM_Privacy_Surround.step", lambda it: it.group in SURROUND_GROUPS)
step("Deck_Plate.step", lambda it: it.name == "Deck_Plate")
step("Base_Frame_Weldment.step", lambda it: it.group == "Base frame")

# ====================================================================== DXF (laser profiles)
deck = next(it for it in items if it.name == "Deck_Plate").shape
sec = deck.slice(App.Vector(0, 0, 1), D["deck_z0"] + D["deck_t"] / 2)
edges = [e for w in sec for e in w.Edges]
for e in edges:
    e.translate(App.Vector(0, 0, -(D["deck_z0"] + D["deck_t"] / 2)))
write_dxf(os.path.join(cad, "Deck_Plate_10mm_S355.dxf"), edges, "CUT_10MM")
log("DXF written")

# ====================================================================== STL
stl = outdir("stl")
for it in items:
    mesh = Mesh.Mesh(it.shape.tessellate(0.3))
    mesh.write(os.path.join(stl, it.name + ".stl"))
full = Mesh.Mesh()
for it in items:
    if not it.ref:
        full.addMesh(Mesh.Mesh(it.shape.tessellate(0.5)))
full.write(os.path.join(stl, "_ATM_Stand_Complete_noATM.stl"))
log("STL written")

# ====================================================================== BOM
GROUP_ORDER = list(PLINTH_GROUPS) + list(SURROUND_GROUPS)
rows = {}
for it in items:
    if it.ref:
        continue
    key = (it.group, it.bom, it.material)
    r = rows.setdefault(key, dict(qty=0, mass=0.0, parts=[]))
    r["qty"] += 1
    r["mass"] += it.mass
    r["parts"].append(it.name)
bom = []
n = 0
for g in GROUP_ORDER:
    for (gg, desc, mat), r in rows.items():
        if gg != g:
            continue
        n += 1
        bom.append(dict(item=n, assembly=g, description=desc, material=mat, qty=r["qty"],
                        unit_kg=round(r["mass"] / r["qty"], 2), total_kg=round(r["mass"], 2),
                        cad_parts=" ".join(r["parts"])))
with open(os.path.join(ROOT, "BOM.csv"), "w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=list(bom[0].keys()))
    w.writeheader()
    w.writerows(bom)
tot = sum(b["total_kg"] for b in bom)
plinth_kg = sum(b["total_kg"] for b in bom if b["assembly"] in PLINTH_GROUPS)
with open(os.path.join(ROOT, "BOM.md"), "w") as fh:
    fh.write("# Bill of Materials - Universal ATM Stand\n\n")
    fh.write("Generated from the CAD model (`src/build_all.py`). Masses are estimates from CAD volume; "
             "sheet-metal panels modelled as envelopes are weighed by skin area.\n\n")
    for g in GROUP_ORDER:
        sub = [b for b in bom if b["assembly"] == g]
        if not sub:
            continue
        fh.write("## %s  (%.1f kg)\n\n| # | Description | Material | Qty | Unit kg | Total kg |\n"
                 "|---|---|---|---:|---:|---:|\n" % (g, sum(b["total_kg"] for b in sub)))
        for b in sub:
            fh.write("| %d | %s | %s | %d | %.2f | %.2f |\n" % (b["item"], b["description"], b["material"],
                                                               b["qty"], b["unit_kg"], b["total_kg"]))
        fh.write("\n")
    fh.write("**Plinth kit mass:** %.0f kg  \n**Complete stand + surround mass:** %.0f kg (excl. ATM)\n"
             % (plinth_kg, tot))
log("BOM: %d lines, plinth %.0f kg, total %.0f kg" % (len(bom), plinth_kg, tot))

# ====================================================================== meshes (shared)
MESH = {}
for it in items:
    MESH[it.name] = tessellate(it.shape, 0.6 if it.shape.BoundBox.DiagonalLength > 200 else 0.3)
log("tessellated %d tris" % sum(len(t) for v, t in MESH.values()))

# ====================================================================== renders
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

rnd = outdir("renders")


def meshes_for(pred, explode=0.0):
    out = []
    for it in items:
        if pred(it):
            v, t = MESH[it.name]
            off = np.asarray(it.explode, float) * explode
            out.append((v, t, it.color, off))
    return out


def save_render(fname, meshes, azim, elev, title=None, size=(10, 10), floor=True):
    fig = plt.figure(figsize=size, dpi=160)
    ax = fig.add_axes([0, 0, 1, 1])
    fig.patch.set_facecolor("white")
    render(ax, meshes, azim, elev, floor=(-800, -700, 800, 1450) if floor else None)
    if title:
        ax.text(0.02, 0.97, title, transform=ax.transAxes, fontsize=13, weight="bold", color="#222",
                va="top")
    fig.savefig(os.path.join(rnd, fname), facecolor="white")
    plt.close(fig)
    log("render", fname)


ALL = lambda it: True
save_render("01_iso_front.png", meshes_for(ALL), 35, 20, "Universal ATM Stand - complete kiosk")
save_render("02_iso_rear_service.png", meshes_for(ALL), 150, 20, "Rear service side")
save_render("03_exploded.png", meshes_for(ALL, 1.0), 38, 24, "Exploded assembly", floor=False)
save_render("04_plinth_kit.png", meshes_for(lambda it: it.group in PLINTH_GROUPS), 30, 32,
            "Plinth kit (stand only)", (10, 8))
save_render("05_plinth_exploded.png", meshes_for(lambda it: it.group in PLINTH_GROUPS, 1.0), 30, 28,
            "Plinth kit - exploded", (10, 9), floor=False)
save_render("06_frame_and_feet.png",
            meshes_for(lambda it: it.group in ("Base frame", "Levelling & anchoring", "Services")),
            -35, 38, "Welded base frame, levelling & anchoring", (10, 8))
save_render("07_plinth_with_atm.png",
            meshes_for(lambda it: it.group in PLINTH_GROUPS or it.ref), 30, 18,
            "Plinth + reference ATM (no surround)", (9, 10))

# ====================================================================== viewer payload
def b64(a):
    return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode("ascii")


payload = dict(params={k: v for k, v in P.items() if not isinstance(v, (tuple, list))},
               derived={k: D[k] for k in ("deck_top", "wing_x1", "rear_y1", "canopy_z0")},
               parts=[])
for it in items:
    v, t = MESH[it.name]
    v3 = np.empty_like(v)
    v3[:, 0], v3[:, 1], v3[:, 2] = v[:, 0], v[:, 2], -v[:, 1]  # FreeCAD Z-up -> three.js Y-up
    payload["parts"].append(dict(
        name=it.name, group=it.group, color=[round(c, 3) for c in it.color], ref=it.ref,
        desc=it.bom or "Reference ATM body (not supplied)", material=it.material,
        mass=round(it.mass, 2), explode=[it.explode[0], it.explode[2], -it.explode[1]],
        pos=b64(v3.astype(np.float32)),
        idx=b64(t.astype(np.uint16 if len(v) < 65535 else np.uint32)), wide=len(v) >= 65535))
payload["bom"] = bom
vd = outdir("viewer")
from PIL import Image as _Img  # bundled with FreeCAD / matplotlib
import io as _io
_im = _Img.open(os.path.join(rnd, "01_iso_front.png")).convert("RGB")
_im.thumbnail((900, 900))
_buf = _io.BytesIO()
_im.save(_buf, "JPEG", quality=82)
fallback_img = "data:image/jpeg;base64," + base64.b64encode(_buf.getvalue()).decode()
with open(os.path.join(HERE, "viewer_template.html")) as fh:
    tpl = fh.read()
blob = json.dumps(payload, separators=(",", ":")).replace("</", "<\\/")
with open(os.path.join(vd, "ATM_Stand_Viewer.html"), "w") as fh:
    fh.write(tpl.replace("__MODEL_JSON__", blob).replace("__FALLBACK_IMG__", fallback_img))
log("viewer %.1f MB" % (os.path.getsize(os.path.join(vd, "ATM_Stand_Viewer.html")) / 1e6))

# ====================================================================== drawings
if os.environ.get("ATM_SKIP_DRAWINGS"):
    log("drawings skipped (ATM_SKIP_DRAWINGS)")
    raise SystemExit(0) if not App.GuiUp else None
import drawings
importlib.reload(drawings)
drawings.make_all(items, D, P, MESH, bom, outdir("drawings"), log)
log("DONE")
