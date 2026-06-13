"""Extract real oriented building footprints + courts/pier from OSM, place location pins,
then render a labelled validation overlay on the satellite image."""
import json, os, math
import numpy as np
from scipy.spatial import ConvexHull
from PIL import Image, ImageDraw, ImageFont
import mapcfg as C

DATA = r"E:\fable tests\MegaProject\tools\map3d\data"

osm = json.load(open(os.path.join(DATA, "osm.json"), encoding="utf-8-sig"))

def min_area_rect(pts):
    pts = np.array(pts)
    if len(pts) < 3:
        c = pts.mean(0); return c[0], c[1], 6.0, 6.0, 0.0
    try:
        hull = pts[ConvexHull(pts).vertices]
    except Exception:
        hull = pts
    best = None
    for i in range(len(hull)):
        edge = hull[(i + 1) % len(hull)] - hull[i]
        ang = math.atan2(edge[1], edge[0])
        ca, sa = math.cos(-ang), math.sin(-ang)
        R = np.array([[ca, -sa], [sa, ca]])
        rp = pts @ R.T
        mn = rp.min(0); mx = rp.max(0)
        area = (mx[0] - mn[0]) * (mx[1] - mn[1])
        if best is None or area < best[0]:
            cx, cy = (mn + mx) / 2
            cxy = np.array([cx, cy]) @ np.linalg.inv(R.T)
            best = (area, cxy[0], cxy[1], mx[0] - mn[0], mx[1] - mn[1], ang)
    _, cx, cy, w, d, ang = best
    return cx, cy, w, d, ang

buildings = []
for el in osm["elements"]:
    t = el.get("tags", {})
    if el["type"] != "way" or "building" not in t or not el.get("geometry"):
        continue
    ll = [(p["lon"], p["lat"]) for p in el["geometry"] if p]
    loc = [C.ll_to_local(lon, lat) for lon, lat in ll]
    cx, cy = np.mean(loc, 0)
    if math.hypot(cx, cy) > C.RADIUS_M:
        continue
    ecx, ecy, w, d, ang = min_area_rect(loc)
    # world coords
    xw, zw = C.local_to_world(ecx, ecy)
    wU, dU = w / C.M_PER_UNIT, d / C.M_PER_UNIT
    # rotation in world: world z = -north, so a rect angle measured in (east,north) maps to
    # ry about world-y. east aligns with world x; north with -z. angle stays, sign flips.
    ry = -ang
    poly = [[round(C.local_to_world(e, n)[0], 2), round(C.local_to_world(e, n)[1], 2)] for e, n in loc]
    buildings.append({
        "way": el["id"], "x": round(xw, 2), "z": round(zw, 2),
        "w": round(wU, 2), "d": round(dU, 2), "ry": round(ry, 4),
        "areaU": round(w * d / (C.M_PER_UNIT ** 2), 1), "poly": poly,
        "e": round(ecx, 1), "n": round(ecy, 1),
    })

# courts (tennis pitches) + pier + beach
courts, piers, beaches = [], [], []
for el in osm["elements"]:
    t = el.get("tags", {})
    if el["type"] != "way" or not el.get("geometry"):
        continue
    ll = [(p["lon"], p["lat"]) for p in el["geometry"] if p]
    loc = [C.ll_to_local(lon, lat) for lon, lat in ll]
    if not loc:
        continue
    cx, cy = np.mean(loc, 0)
    if math.hypot(cx, cy) > C.RADIUS_M:
        continue
    if t.get("leisure") == "pitch":
        ecx, ecy, w, d, ang = min_area_rect(loc)
        xw, zw = C.local_to_world(ecx, ecy)
        courts.append({"x": round(xw, 2), "z": round(zw, 2),
                       "w": round(w / C.M_PER_UNIT, 2), "d": round(d / C.M_PER_UNIT, 2),
                       "ry": round(-ang, 4), "sport": t.get("sport", "")})
    elif t.get("man_made") == "pier":
        piers.append([[round(C.local_to_world(e, n)[0], 2), round(C.local_to_world(e, n)[1], 2)] for e, n in loc])
    elif t.get("natural") == "beach":
        beaches.append([[round(C.local_to_world(e, n)[0], 2), round(C.local_to_world(e, n)[1], 2)] for e, n in loc])

print(f"buildings={len(buildings)} courts={len(courts)} piers={len(piers)} beaches={len(beaches)}")

# ---- location pin coordinates (east,north metres), cross-referenced w/ satellite + official map ----
LOC_XY = {
    # venues
    "musichall": (-14, -58), "dining": (-26, 6), "heritage": (-55, 150), "hangar": (60, -205),
    "backyard": (90, -190), "fieldhouse": (258, -117), "boathouse": (30, -255), "studio": (-90, -160),
    "ceolodge": (-90, 92), "mac": (-50, 75), "mainoffice": (42, -52), "imprint": (-330, 160), "ian": (-25, 235),
    # stay
    "village": (-40, 200), "treetops": (35, 175), "timberviews": (-120, 60), "hillside": (-180, 80),
    "chalets": (-52, -128), "royal": (35, -32), "havington": (10, -24), "woodsend": (95, -225),
    # sports
    "thepark": (-460, 322), "tennis": (190, -150), "leisure": (165, -120), "broomball": (95, -55),
    "field": (60, -92), "vball": (-78, -118), "range": (-230, 28), "discgolf": (-262, 64),
    # adventure
    "upperzip": (-300, 250), "lowerzip": (120, -300), "highropes": (118, -132), "lowropes": (-380, 262),
    "giantswing": (-55, 40), "archery": (-470, 300), "archerytag": (290, -100), "basecamp": (320, 240),
    # waterfront
    "beach": (-110, -150), "docks": (-130, -172), "wibit": (-152, -158), "kraken": (70, -78),
}
# snap building-type pins onto the nearest real footprint centroid (<=55 m)
BUILDING_LOCS = {"musichall", "dining", "heritage", "fieldhouse", "studio", "ceolodge", "mac",
                 "mainoffice", "imprint", "ian", "village", "treetops", "timberviews", "hillside",
                 "chalets", "royal", "havington", "woodsend", "boathouse", "hangar"}
fp = [(b["e"], b["n"], b) for b in buildings]
def snap(name, e, n):
    if name not in BUILDING_LOCS:
        return e, n
    best = min(fp, key=lambda f: math.hypot(f[0] - e, f[1] - n))
    if math.hypot(best[0] - e, best[1] - n) <= 55:
        return best[0], best[1]
    return e, n
locs = {}
for k, (e, n) in LOC_XY.items():
    e2, n2 = snap(k, e, n)
    locs[k] = {"x": round(e2 / C.M_PER_UNIT, 2), "z": round(-n2 / C.M_PER_UNIT, 2)}

roads = json.load(open(os.path.join(DATA, "roads.json")))
meta = json.load(open(r"E:\fable tests\MegaProject\frontend\public\map3d\terrain_meta.json"))

data = {"meta": meta, "buildings": buildings, "courts": courts, "piers": piers,
        "beaches": beaches, "roads": roads["camp"], "hwy": roads["hwy"], "locations": locs}
json.dump(data, open(r"E:\fable tests\MegaProject\frontend\public\map3d\mapdata.json", "w"))
print("wrote mapdata.json")

# ---- validation overlay ----
img = Image.open(os.path.join(DATA, "sat_overlay.png")).convert("RGB")
SC = 1 / 0.72; HALF = 720
dr = ImageDraw.Draw(img)
try: font = ImageFont.truetype("arialbd.ttf", 20)
except Exception: font = None
def w2px(x, z):
    e, n = x * C.M_PER_UNIT, -z * C.M_PER_UNIT
    return ((e + HALF) * SC, (HALF - n) * SC)
for k, p in locs.items():
    x, y = w2px(p["x"], p["z"])
    dr.ellipse([x-6, y-6, x+6, y+6], fill=(255, 60, 0), outline=(255, 255, 255))
    dr.text((x+8, y-10), k, fill=(255, 240, 0), font=font)
img.save(os.path.join(DATA, "pins_validate.png"))
print("saved pins_validate.png")
