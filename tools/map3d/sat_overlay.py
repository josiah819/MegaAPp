"""Stitch Esri World Imagery tiles (z18), reproject to local frame, overlay numbered OSM footprints."""
import json, math, os, time, io, urllib.request
import numpy as np
import pyproj
from PIL import Image, ImageDraw, ImageFont

DATA = r"E:\fable tests\MegaProject\tools\map3d\data"
LAT0, LON0 = 45.2492, -79.6175
AEQD = f"+proj=aeqd +lat_0={LAT0} +lon_0={LON0} +datum=WGS84 +units=m"
tr_ll2loc = pyproj.Transformer.from_crs("EPSG:4326", AEQD, always_xy=True)
tr_loc2ll = pyproj.Transformer.from_crs(AEQD, "EPSG:4326", always_xy=True)

Z = 18
def ll2tile(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y
def tile2ll(x, y, z):
    n = 2 ** z
    lon = x / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lon, lat

HALF = 720
# local frame corners -> lat/lon -> tile range
lons, lats = [], []
for dx in (-HALF, HALF):
    for dy in (-HALF, HALF):
        lon, lat = tr_loc2ll.transform(dx, dy)
        lons.append(lon); lats.append(lat)
tx0, ty0 = ll2tile(min(lons), max(lats), Z)
tx1, ty1 = ll2tile(max(lons), min(lats), Z)
tx0, ty0, tx1, ty1 = int(tx0), int(ty0), int(tx1), int(ty1)
print(f"tiles x {tx0}..{tx1} y {ty0}..{ty1}  -> {(tx1-tx0+1)*(ty1-ty0+1)} tiles")

cache = os.path.join(DATA, "tiles")
os.makedirs(cache, exist_ok=True)
mosaic = Image.new("RGB", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
for ty in range(ty0, ty1 + 1):
    for tx in range(tx0, tx1 + 1):
        fp = os.path.join(cache, f"{Z}_{tx}_{ty}.jpg")
        if not os.path.exists(fp):
            url = f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{Z}/{ty}/{tx}"
            for attempt in range(3):
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": "WoodsOS-map-builder/1.0"})
                    with urllib.request.urlopen(req, timeout=30) as r:
                        open(fp, "wb").write(r.read())
                    break
                except Exception as ex:
                    print("  retry", tx, ty, ex)
                    time.sleep(1.5)
        try:
            img = Image.open(fp).convert("RGB")
            mosaic.paste(img, ((tx - tx0) * 256, (ty - ty0) * 256))
        except Exception as ex:
            print("  bad tile", tx, ty, ex)
print("mosaic", mosaic.size)

# resample mosaic into local frame at 0.72 m/px -> 2000x2000
SC = 1 / 0.72
SZ = int(2 * HALF * SC)
xs = (np.arange(SZ) / SC) - HALF
ys = HALF - (np.arange(SZ) / SC)
XX, YY = np.meshgrid(xs, ys)
LO, LA = tr_loc2ll.transform(XX, YY)
n = 2 ** Z
TXf = (LO + 180) / 360 * n
TYf = (1 - np.arcsinh(np.tan(np.radians(LA))) / math.pi) / 2 * n
PXc = np.clip(((TXf - tx0) * 256).astype(int), 0, mosaic.size[0] - 1)
PYc = np.clip(((TYf - ty0) * 256).astype(int), 0, mosaic.size[1] - 1)
arr = np.asarray(mosaic)
out = arr[PYc, PXc]
img = Image.fromarray(out, "RGB")
dr = ImageDraw.Draw(img)
try:
    font = ImageFont.truetype("arial.ttf", 22)
    font_sm = ImageFont.truetype("arial.ttf", 15)
except Exception:
    font = font_sm = None

def to_px(x, y): return ((x + HALF) * SC, (HALF - y) * SC)

# GPS traces (thin red)
with open(r"C:\Users\josia\Downloads\roads.geojson.json", encoding="utf-8") as f:
    gj = json.load(f)
for ft in gj["features"]:
    if ft["geometry"]["type"] == "LineString":
        pts = [to_px(*tr_ll2loc.transform(c[0], c[1])) for c in ft["geometry"]["coordinates"]]
        dr.line(pts, fill=(255, 40, 40), width=2)

# OSM footprints numbered
osm = json.load(open(os.path.join(DATA, "osm.json"), encoding="utf-8-sig"))
index = []
for e in osm["elements"]:
    t = e.get("tags", {})
    if e["type"] == "way" and "building" in t and e.get("geometry"):
        geom = [p for p in e["geometry"] if p]
        pts = [tr_ll2loc.transform(p["lon"], p["lat"]) for p in geom]
        cx = sum(q[0] for q in pts) / len(pts); cy = sum(q[1] for q in pts) / len(pts)
        if abs(cx) > HALF or abs(cy) > HALF: continue
        k = len(index); index.append((k, e["id"], cx, cy))
        px = [to_px(*q) for q in pts]
        dr.line(px + px[:1], fill=(0, 255, 255), width=2)
        dr.text(to_px(cx, cy), str(k), fill=(255, 255, 0), font=font, anchor="mm")
# pitches & pier for context
for e in osm["elements"]:
    t = e.get("tags", {})
    if e["type"] == "way" and e.get("geometry") and (t.get("leisure") == "pitch" or t.get("man_made") == "pier"):
        geom = [p for p in e["geometry"] if p]
        px = [to_px(*tr_ll2loc.transform(p["lon"], p["lat"])) for p in geom]
        dr.line(px + (px[:1] if t.get("leisure") else []), fill=(0, 255, 0), width=2)

# scale + axes
dr.line([to_px(-20, 0), to_px(20, 0)], fill=(255, 255, 255), width=2)
dr.line([to_px(0, -20), to_px(0, 20)], fill=(255, 255, 255), width=2)
dr.line([to_px(-700, -690), to_px(-600, -690)], fill=(255, 255, 255), width=4)
dr.text(to_px(-650, -676), "100 m", fill=(255, 255, 255), font=font_sm, anchor="mm")

img.save(os.path.join(DATA, "sat_overlay.png"))
print("saved sat_overlay.png")
for k, wid, cx, cy in index:
    print(f"  #{k:2d} way/{wid} ({cx:5.0f},{cy:5.0f})")
