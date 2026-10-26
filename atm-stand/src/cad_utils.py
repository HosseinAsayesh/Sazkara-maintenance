"""Tessellation, hidden-line projection, raster rendering and DXF helpers."""
import math
import numpy as np
import FreeCAD as App
import Part
import TechDraw

V = App.Vector


# ------------------------------------------------------------------ tessellation
def tessellate(shape, tol=0.6):
    """Per-face tessellation with outward-consistent winding.
    Returns (verts[N,3] float32, tris[M,3] int32). Faces don't share vertices,
    so per-vertex normals give crisp edges between faces."""
    vs, ts, off = [], [], 0
    for f in shape.Faces:
        try:
            pts, tri = f.tessellate(tol)
        except Exception:
            continue
        if not tri:
            continue
        P = np.array([(p.x, p.y, p.z) for p in pts], dtype=np.float64)
        T = np.array(tri, dtype=np.int64)
        # orientation check against the true face normal
        a, b, c = P[T[0, 0]], P[T[0, 1]], P[T[0, 2]]
        n_tri = np.cross(b - a, c - a)
        cen = (a + b + c) / 3.0
        try:
            u, v = f.Surface.parameter(V(*cen))
            n = f.normalAt(u, v)
            if np.dot(n_tri, (n.x, n.y, n.z)) < 0:
                T = T[:, ::-1]
        except Exception:
            pass
        vs.append(P)
        ts.append(T + off)
        off += len(P)
    if not vs:
        return np.zeros((0, 3), np.float32), np.zeros((0, 3), np.int32)
    return np.vstack(vs).astype(np.float32), np.vstack(ts).astype(np.int32)


# ------------------------------------------------------------------ orthographic HLR
VIEW_MATRIX = {
    #            row0 (paper X)  row1 (paper Y)  row2 (towards viewer)
    "top":   ((1, 0, 0), (0, 1, 0), (0, 0, 1)),
    "front": ((1, 0, 0), (0, 0, 1), (0, -1, 0)),
    "rear":  ((-1, 0, 0), (0, 0, 1), (0, 1, 0)),
    "right": ((0, 1, 0), (0, 0, 1), (1, 0, 0)),
    "left":  ((0, -1, 0), (0, 0, 1), (-1, 0, 0)),
}


def _matrix(rows):
    m = App.Matrix()
    (m.A11, m.A12, m.A13), (m.A21, m.A22, m.A23), (m.A31, m.A32, m.A33) = rows
    return m


def view_xy(view, x, y, z):
    r = VIEW_MATRIX[view]
    return (r[0][0] * x + r[0][1] * y + r[0][2] * z, r[1][0] * x + r[1][1] * y + r[1][2] * z)


def project(shape, view, hidden=True, defl=0.3):
    """Hidden-line projection. Returns (visible_polylines, hidden_polylines),
    each polyline an (N,2) array in model mm, paper-oriented."""
    s = shape.copy()
    s.transformShape(_matrix(VIEW_MATRIX[view]))
    res = TechDraw.projectEx(s, V(0, 0, 1))
    vis_idx, hid_idx = (0, 1, 3), (5, 6, 8)

    def polys(idx):
        out = []
        for i in idx:
            sh = res[i]
            if sh is None or sh.isNull():
                continue
            for e in sh.Edges:
                try:
                    pts = e.discretize(QuasiDeflection=defl)
                except Exception:
                    continue
                if len(pts) >= 2:
                    out.append(np.array([(p.x, p.y) for p in pts]))
        return out

    return polys(vis_idx), (polys(hid_idx) if hidden else [])


def bbox2(polys):
    a = np.vstack(polys)
    return a[:, 0].min(), a[:, 1].min(), a[:, 0].max(), a[:, 1].max()


# ------------------------------------------------------------------ raster renderer (matplotlib)
def camera(azim, elev):
    az, el = math.radians(azim), math.radians(elev)
    e = np.array([math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)])
    up = np.array([0.0, 0.0, 1.0])
    r = np.cross(up, e)
    r /= np.linalg.norm(r)
    u = np.cross(e, r)
    return r, u, e


def raster(meshes, azim=35, elev=22, px=(1600, 1600), ss=2, floor=None, margin=0.05,
           edges=True, bg=(1.0, 1.0, 1.0)):
    """Z-buffer software rasteriser (numpy, batched).  Returns an RGB float image (H, W, 3).
    meshes: list of (verts, tris, rgb, offset_xyz). floor: (x0, y0, x1, y1) at z=0."""
    r, u, e = camera(azim, elev)
    L1 = e + 0.55 * u - 0.45 * r
    L1 /= np.linalg.norm(L1)
    L2 = np.array([0.35, 0.25, 1.0])
    L2 /= np.linalg.norm(L2)
    TA, TB, TC, COL, MID = [], [], [], [], []
    for mid, (verts, tris, rgb, off) in enumerate(meshes):
        if len(tris) == 0:
            continue
        P = verts.astype(np.float64) + np.asarray(off, float)
        A, B, C = P[tris[:, 0]], P[tris[:, 1]], P[tris[:, 2]]
        n = np.cross(B - A, C - A)
        ln = np.linalg.norm(n, axis=1)
        ok = (ln > 1e-9)
        n = n[ok] / ln[ok, None]
        A, B, C = A[ok], B[ok], C[ok]
        front = (n @ e) > -1e-6
        A, B, C, n = A[front], B[front], C[front], n[front]
        k = 0.46 + 0.46 * np.clip(n @ L1, 0, 1) + 0.18 * np.clip(n @ L2, 0, 1)
        h = (L1 + e) / np.linalg.norm(L1 + e)
        spec = np.clip(n @ h, 0, 1) ** 30 * 0.16
        TA.append(A); TB.append(B); TC.append(C)
        COL.append(np.clip(np.outer(k, rgb) + spec[:, None], 0, 1))
        MID.append(np.full(len(A), mid, np.int32))
    A, B, C = np.concatenate(TA), np.concatenate(TB), np.concatenate(TC)
    COL, MID = np.concatenate(COL), np.concatenate(MID)
    NRM = np.cross(B - A, C - A)
    NRM /= np.linalg.norm(NRM, axis=1)[:, None]
    allp = np.concatenate([A, B, C])
    X2, Y2 = allp @ r, allp @ u
    xmin, xmax, ymin, ymax = X2.min(), X2.max(), Y2.min(), Y2.max()
    if floor is not None:
        x0, y0, x1, y1 = floor
        q = np.array([[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]], float)
        FA, FB, FC = q[[0, 0]], q[[1, 2]], q[[2, 3]]
        A, B, C = np.concatenate([A, FA]), np.concatenate([B, FB]), np.concatenate([C, FC])
        COL = np.concatenate([COL, np.array([[0.91, 0.92, 0.93]] * 2)])
        MID = np.concatenate([MID, np.array([-2, -2], np.int32)])
        NRM = np.concatenate([NRM, np.array([[0, 0, 1.0]] * 2)])
    W, H = px[0] * ss, px[1] * ss
    sc = min(W * (1 - 2 * margin) / (xmax - xmin), H * (1 - 2 * margin) / (ymax - ymin))
    cx, cy = (xmin + xmax) / 2, (ymin + ymax) / 2

    def scr(P):
        return (P @ r - cx) * sc + W / 2, H / 2 - (P @ u - cy) * sc, P @ e

    ax_, ay_, az_ = scr(A)
    bx_, by_, bz_ = scr(B)
    cx_, cy_, cz_ = scr(C)
    zbuf = np.full(W * H, -np.inf)
    tbuf = np.full(W * H, -1, np.int64)
    area = (bx_ - ax_) * (cy_ - ay_) - (by_ - ay_) * (cx_ - ax_)
    ymin_ = np.minimum.reduce([ay_, by_, cy_])
    ymax_ = np.maximum.reduce([ay_, by_, cy_])
    r0 = np.clip(np.ceil(ymin_ - 0.5), 0, H).astype(np.int64)        # first row (centre >= ymin)
    r1 = np.clip(np.floor(ymax_ - 0.5), -1, H - 1).astype(np.int64)  # last row
    nrows = np.maximum(r1 - r0 + 1, 0)
    valid = (nrows > 0) & (np.abs(area) > 1e-12)
    ids_all = np.where(valid)[0]
    EX = [(ax_, ay_, bx_, by_), (bx_, by_, cx_, cy_), (cx_, cy_, ax_, ay_)]

    def spans(ids):
        n = nrows[ids]
        tid = np.repeat(ids, n)
        start = np.repeat(np.cumsum(n) - n, n)
        row = r0[tid] + (np.arange(len(tid)) - start)
        yc = row + 0.5
        lo = np.full(len(tid), np.inf)
        hi = np.full(len(tid), -np.inf)
        for px_, py_, qx_, qy_ in EX:
            Px, Py, Qx, Qy = px_[tid], py_[tid], qx_[tid], qy_[tid]
            dy = Qy - Py
            cross = ((Py - yc) * (Qy - yc) <= 0) & (np.abs(dy) > 1e-12)
            t = np.where(cross, (yc - Py) / np.where(cross, dy, 1), 0)
            xi = Px + t * (Qx - Px)
            lo = np.where(cross, np.minimum(lo, xi), lo)
            hi = np.where(cross, np.maximum(hi, xi), hi)
        xl = np.clip(np.ceil(lo - 0.5), 0, W).astype(np.int64)
        xr = np.clip(np.floor(hi - 0.5), -1, W - 1).astype(np.int64)
        return tid, row, xl, np.maximum(xr - xl + 1, 0)

    def fill(tid, row, xl, cnt):
        tot = cnt.sum()
        if tot == 0:
            return
        t = np.repeat(tid, cnt)
        st = np.repeat(np.cumsum(cnt) - cnt, cnt)
        X = np.repeat(xl, cnt) + (np.arange(tot) - st)
        Yr = np.repeat(row, cnt)
        Xc, Yc = X + 0.5, Yr + 0.5
        ar = area[t]
        w0 = ((bx_[t] - Xc) * (cy_[t] - Yc) - (by_[t] - Yc) * (cx_[t] - Xc)) / ar
        w1 = ((cx_[t] - Xc) * (ay_[t] - Yc) - (cy_[t] - Yc) * (ax_[t] - Xc)) / ar
        z = w0 * az_[t] + w1 * bz_[t] + (1 - w0 - w1) * cz_[t]
        pix = Yr * W + X
        keep = z > zbuf[pix]
        pix, z, t = pix[keep], z[keep], t[keep]
        if len(pix) == 0:
            return
        o = np.lexsort((z, pix))
        pix, z, t = pix[o], z[o], t[o]
        last = np.r_[pix[1:] != pix[:-1], True]
        zbuf[pix[last]] = z[last]
        tbuf[pix[last]] = t[last]

    # chunk triangles so that each fill handles a bounded number of pixels
    est = nrows[ids_all] * np.maximum(1, (np.maximum.reduce([ax_, bx_, cx_]) - np.minimum.reduce([ax_, bx_, cx_]))[ids_all])
    cum = np.cumsum(est)
    LIM = 4_000_000
    bounds = np.searchsorted(cum, np.arange(LIM, cum[-1] + LIM, LIM)) if len(cum) else []
    s0 = 0
    for b_ in list(bounds) + [len(ids_all)]:
        b_ = max(b_, s0 + 1)
        ch = ids_all[s0:b_]
        if len(ch):
            fill(*spans(ch))
        s0 = b_
        if s0 >= len(ids_all):
            break

    img = np.empty((W * H, 3))
    img[:] = bg
    hit = tbuf >= 0
    img[hit] = COL[tbuf[hit]]
    img = img.reshape(H, W, 3)
    if edges:
        t2 = tbuf.reshape(H, W)
        m2 = np.where(t2 >= 0, np.r_[MID, -1][t2], -1)
        nn = np.zeros((H * W, 3))
        nn[hit] = NRM[tbuf[hit]]
        nn = nn.reshape(H, W, 3)
        zz = zbuf.reshape(H, W)
        edge = np.zeros((H, W), bool)
        for dy, dx in ((0, 1), (1, 0)):
            a_m, b_m = m2[:H - dy, :W - dx], m2[dy:, dx:]
            a_n, b_n = nn[:H - dy, :W - dx], nn[dy:, dx:]
            a_z, b_z = zz[:H - dy, :W - dx], zz[dy:, dx:]
            with np.errstate(invalid="ignore"):
                dz = np.abs(np.nan_to_num(a_z - b_z, nan=0, posinf=1e9, neginf=1e9))
            both = (a_m >= 0) & (b_m >= 0) | ((a_m == -2) & (b_m >= 0)) | ((a_m >= 0) & (b_m == -2))
            crease = ((a_n * b_n).sum(axis=2) < 0.82) & (a_m >= 0) & (b_m >= 0)
            e_ = ((a_m != b_m) & both) | ((a_m >= 0) != (b_m >= 0)) & ((a_m >= 0) | (b_m >= 0)) & \
                 ((a_m != -2) & (b_m != -2)) | crease | ((dz > 48.0 / sc) & (a_m >= 0) & (b_m >= 0))
            edge[:H - dy, :W - dx] |= e_
        img[edge] = img[edge] * 0.35
    # downsample (supersampling AA)
    img = img.reshape(px[1], ss, px[0], ss, 3).mean(axis=(1, 3))
    return img


def render(ax, meshes, azim=35, elev=22, floor=None, px=(1500, 1500), **kw):
    """Draw a rasterised render into a matplotlib axes (axes aspect kept)."""
    img = raster(meshes, azim, elev, px=px, floor=floor, **kw)
    # crop white margins
    nonbg = np.where((img < 0.995).any(axis=2))
    if len(nonbg[0]):
        y0, y1, x0, x1 = nonbg[0].min(), nonbg[0].max(), nonbg[1].min(), nonbg[1].max()
        pad = 8
        img = img[max(0, y0 - pad):y1 + pad, max(0, x0 - pad):x1 + pad]
    ax.imshow(img, interpolation="lanczos")
    ax.set_aspect("equal")
    ax.axis("off")
    return img


def floor_mesh(x0, y0, x1, y1, z=-0.5):
    v = np.array([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], np.float32)
    t = np.array([[0, 1, 2], [0, 2, 3]], np.int32)
    return v, t


# ------------------------------------------------------------------ DXF (R12, ASCII)
def write_dxf(path, shape_2d_edges, layer="CUT", extra=()):
    """Write planar edges (z ignored) to a minimal R12 DXF. extra: [(layer, edges)]"""
    out = ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "4", "0", "ENDSEC",
           "0", "SECTION", "2", "ENTITIES"]

    def ent(e, lay):
        c = e.Curve
        if isinstance(c, Part.Line) or isinstance(c, Part.LineSegment):
            a, b = e.Vertexes[0].Point, e.Vertexes[-1].Point
            out.extend(["0", "LINE", "8", lay, "10", "%.4f" % a.x, "20", "%.4f" % a.y, "30", "0",
                        "11", "%.4f" % b.x, "21", "%.4f" % b.y, "31", "0"])
        elif isinstance(c, Part.Circle):
            cen, R = c.Center, c.Radius
            if e.isClosed():
                out.extend(["0", "CIRCLE", "8", lay, "10", "%.4f" % cen.x, "20", "%.4f" % cen.y,
                            "30", "0", "40", "%.4f" % R])
            else:
                p0, p1 = e.Vertexes[0].Point, e.Vertexes[-1].Point
                pm = e.valueAt((e.FirstParameter + e.LastParameter) / 2)
                ang = lambda p: math.degrees(math.atan2(p.y - cen.y, p.x - cen.x)) % 360
                a0, a1, am = ang(p0), ang(p1), ang(pm)
                ccw = lambda s, t, m: ((m - s) % 360) < ((t - s) % 360)
                if not ccw(a0, a1, am):
                    a0, a1 = a1, a0
                out.extend(["0", "ARC", "8", lay, "10", "%.4f" % cen.x, "20", "%.4f" % cen.y, "30", "0",
                            "40", "%.4f" % R, "50", "%.4f" % a0, "51", "%.4f" % a1])
        else:
            pts = e.discretize(QuasiDeflection=0.05)
            for a, b in zip(pts[:-1], pts[1:]):
                out.extend(["0", "LINE", "8", lay, "10", "%.4f" % a.x, "20", "%.4f" % a.y, "30", "0",
                            "11", "%.4f" % b.x, "21", "%.4f" % b.y, "31", "0"])

    for e in shape_2d_edges:
        ent(e, layer)
    for lay, edges in extra:
        for e in edges:
            ent(e, lay)
    out.extend(["0", "ENDSEC", "0", "EOF"])
    with open(path, "w") as fh:
        fh.write("\n".join(out) + "\n")
