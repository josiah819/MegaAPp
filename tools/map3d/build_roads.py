"""Average the GPS traces + OSM camp roads into clean centerlines via skeletonization.

GPS passes that overlap within sensor noise merge into a single road; OSM service
roads fill gaps you didn't drive. Highway 141 is kept as its own simplified polyline.
Outputs roads.json (world units) + roads_debug.png.
"""
import json, os
import numpy as np
from PIL import Image, ImageDraw
from skimage.morphology import skeletonize
from scipy.ndimage import convolve, binary_closing
import mapcfg as C

DATA = r"E:\fable tests\MegaProject\tools\map3d\data"
GPS = r"C:\Users\josia\Downloads\roads.geojson.json"

HALF = 650           # camp-roads raster half-extent (m)
RES = 1.0            # m per pixel
SZ = int(2 * HALF / RES)
STROKE = 9           # px stroke (radius ~4.5 m) so overlapping GPS passes merge

def e2px(e, n):
    return ((e + HALF) / RES, (HALF - n) / RES)

# ---------- gather road lines in local metres ----------
gps_lines, hwy_lines, osm_camp = [], [], []

gj = json.load(open(GPS, encoding="utf-8"))
for ft in gj["features"]:
    g = ft["geometry"]
    if g["type"] == "LineString":
        gps_lines.append([C.ll_to_local(c[0], c[1]) for c in g["coordinates"]])

osm = json.load(open(os.path.join(DATA, "osm.json"), encoding="utf-8-sig"))
for el in osm["elements"]:
    t = el.get("tags", {})
    if el["type"] != "way" or "highway" not in t or not el.get("geometry"):
        continue
    pts = [C.ll_to_local(p["lon"], p["lat"]) for p in el["geometry"] if p]
    hw = t["highway"]
    name = t.get("name", "")
    if name == "Highway 141":
        hwy_lines.append(pts)
    elif hw in ("service", "unclassified", "residential", "track"):
        # keep only camp-side segments (inside the raster box)
        if any(abs(e) < HALF and abs(n) < HALF for e, n in pts):
            osm_camp.append(pts)

print(f"gps lines={len(gps_lines)} osm camp lines={len(osm_camp)} hwy lines={len(hwy_lines)}")

# ---------- rasterize camp roads (GPS + OSM) ----------
img = Image.new("L", (SZ, SZ), 0)
dr = ImageDraw.Draw(img)
def stroke(lines, width):
    for ln in lines:
        px = [e2px(e, n) for e, n in ln]
        if len(px) > 1:
            dr.line(px, fill=255, width=width, joint="curve")
            r = width / 2
            for x, y in px:
                dr.ellipse([x - r, y - r, x + r, y + r], fill=255)
stroke(gps_lines, STROKE)
stroke(osm_camp, STROKE)

mask = np.array(img) > 0
mask = binary_closing(mask, iterations=2)
sk = skeletonize(mask)
print("skeleton px:", int(sk.sum()))

# ---------- skeleton -> polylines ----------
nb = convolve(sk.astype(np.uint8), np.ones((3, 3), np.uint8), mode="constant") - sk.astype(np.uint8)
deg = nb * sk
node = sk & ((deg == 1) | (deg >= 3))
NB8 = [(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]
H_, W_ = sk.shape
def nbrs(r, c):
    for dr_, dc in NB8:
        rr, cc = r + dr_, c + dc
        if 0 <= rr < H_ and 0 <= cc < W_ and sk[rr, cc]:
            yield rr, cc

used = set()
polylines_px = []
node_rc = list(zip(*np.where(node)))
for r, c in node_rc:
    for nr, nc in nbrs(r, c):
        if (r, c, nr, nc) in used:
            continue
        path = [(r, c)]
        pr, pc, cr, cc = r, c, nr, nc
        used.add((r, c, nr, nc))
        while True:
            path.append((cr, cc))
            if node[cr, cc]:
                used.add((cr, cc, pr, pc))
                break
            nxt = [(rr, ccc) for rr, ccc in nbrs(cr, cc) if (rr, ccc) != (pr, pc)]
            if not nxt:
                break
            pr, pc, (cr2, cc2) = cr, cc, nxt[0]
            used.add((pr, pc, cr2, cc2))
            cr, cc = cr2, cc2
        polylines_px.append(path)

# isolated loops (no node touched)
visited = np.zeros_like(sk)
for r, c in node_rc:
    visited[r, c] = 1
for r, c in zip(*np.where(sk)):
    if visited[r, c]:
        continue
    path = [(r, c)]; visited[r, c] = 1; cr, cc = r, c; pr, pc = -1, -1
    while True:
        nxt = [(rr, ccc) for rr, ccc in nbrs(cr, cc) if (rr, ccc) != (pr, pc) and not visited[rr, ccc]]
        if not nxt:
            break
        pr, pc = cr, cc; cr, cc = nxt[0]; visited[cr, cc] = 1; path.append((cr, cc))
    if len(path) > 6:
        polylines_px.append(path)

# ---------- prune spurs, simplify, smooth ----------
def px2world(path):
    return [( (c * RES - HALF) / C.M_PER_UNIT, -(HALF - r * RES) / C.M_PER_UNIT ) for r, c in path]

def length_world(w):
    return sum(np.hypot(w[i][0]-w[i-1][0], w[i][1]-w[i-1][1]) for i in range(1, len(w)))

def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0]), np.array(pts[-1])
    ab = b - a; L = np.hypot(*ab)
    if L < 1e-9:
        d = [np.hypot(*(np.array(p) - a)) for p in pts]
    else:
        d = [abs(np.cross(ab, np.array(p) - a)) / L for p in pts]
    i = int(np.argmax(d))
    if d[i] > eps:
        return rdp(pts[:i+1], eps)[:-1] + rdp(pts[i:], eps)
    return [pts[0], pts[-1]]

def chaikin(pts, it=2):
    for _ in range(it):
        if len(pts) < 3:
            break
        out = [pts[0]]
        for i in range(len(pts) - 1):
            p, q = np.array(pts[i]), np.array(pts[i + 1])
            out.append(tuple(0.75 * p + 0.25 * q)); out.append(tuple(0.25 * p + 0.75 * q))
        out.append(pts[-1]); pts = out
    return pts

roads_world = []
for path in polylines_px:
    w = px2world(path)
    if length_world(w) < 12:        # drop short spurs (<12 m)
        continue
    w = rdp(w, 0.9)                  # simplify (~1.8 m world)
    w = chaikin(w, 2)
    roads_world.append([[round(x, 2), round(z, 2)] for x, z in w])

# ---------- highway: merge + simplify OSM 141 ----------
def simplify_ll(lines):
    out = []
    for ln in lines:
        w = [C.local_to_world(e, n) for e, n in ln]
        w = rdp(w, 1.2)
        out.append([[round(x, 2), round(z, 2)] for x, z in w])
    return out
hwy_world = simplify_ll(hwy_lines)

json.dump({"camp": roads_world, "hwy": hwy_world},
          open(os.path.join(DATA, "roads.json"), "w"))
print(f"clean camp roads: {len(roads_world)}  hwy: {len(hwy_world)}")
print("total camp road length (m):",
      round(sum(length_world(r) * C.M_PER_UNIT for r in roads_world)))

# ---------- debug overlay ----------
dbg = Image.new("RGB", (SZ, SZ), (18, 22, 28))
d2 = ImageDraw.Draw(dbg)
for ln in gps_lines:
    d2.line([e2px(e, n) for e, n in ln], fill=(70, 40, 40), width=STROKE)
for ln in osm_camp:
    d2.line([e2px(e, n) for e, n in ln], fill=(30, 50, 60), width=STROKE)
def w2px(x, z):
    e, n = x * C.M_PER_UNIT, -z * C.M_PER_UNIT
    return e2px(e, n)
for r in roads_world:
    d2.line([w2px(x, z) for x, z in r], fill=(120, 230, 120), width=2)
for r in hwy_world:
    pts = [w2px(x, z) for x, z in r if abs(x*C.M_PER_UNIT) < HALF and abs(z*C.M_PER_UNIT) < HALF]
    if len(pts) > 1:
        d2.line(pts, fill=(240, 150, 0), width=3)
dbg.save(os.path.join(DATA, "roads_debug.png"))
print("saved roads_debug.png")
