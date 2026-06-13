"""Zoomed debug of the camp core +-650m, with labels and local coords listing."""
import json, math
import numpy as np
import tifffile, pyproj
from PIL import Image, ImageDraw

DATA = r"E:\fable tests\MegaProject\tools\map3d\data"
LAT0, LON0 = 45.2492, -79.6175
AEQD = f"+proj=aeqd +lat_0={LAT0} +lon_0={LON0} +datum=WGS84 +units=m"
tr_ll2loc = pyproj.Transformer.from_crs("EPSG:4326", AEQD, always_xy=True)
tr_loc2_3979 = pyproj.Transformer.from_crs(AEQD, "EPSG:3979", always_xy=True)

HALF = 650
SCALE = 1.6                      # px per metre
SZ = int(2 * HALF * SCALE)
def to_px(x, y): return ((x + HALF) * SCALE, (HALF - y) * SCALE)

tif = tifffile.TiffFile(f"{DATA}\\dtm_1m_core.tif")
dem = tif.pages[0].asarray().astype(np.float32)
tags = tif.pages[0].tags
sx, sy, _ = tags["ModelPixelScaleTag"].value
_, _, _, ox, oy, _ = tags["ModelTiepointTag"].value
H, W = dem.shape
gy, gx = np.gradient(dem, sy, sx)
az, alt = math.radians(315), math.radians(45)
slope = np.arctan(np.hypot(gx, gy)); aspect = np.arctan2(-gx, gy)
hs = np.clip((np.sin(alt)*np.cos(slope) + np.cos(alt)*np.sin(slope)*np.cos(az-aspect) + 1)/2*255, 0, 255).astype(np.uint8)

xs = (np.arange(SZ) / SCALE) - HALF
ys = HALF - (np.arange(SZ) / SCALE)
XX, YY = np.meshgrid(xs, ys)
PX, PY = tr_loc2_3979.transform(XX, YY)
ci = np.clip(((PX - ox) / sx).astype(int), 0, W - 1)
ri = np.clip(((oy - PY) / sy).astype(int), 0, H - 1)
base = hs[ri, ci]
lake = dem[ri, ci] < 225.6
img_arr = np.stack([base, base, base], -1)
img_arr[lake] = (img_arr[lake] * np.array([0.55, 0.75, 0.95])).astype(np.uint8)
img = Image.fromarray(img_arr, "RGB")
dr = ImageDraw.Draw(img)

def draw_line(coords_ll, color, w=2):
    pts = [to_px(*tr_ll2loc.transform(lon, lat)) for lon, lat in coords_ll]
    if len(pts) > 1: dr.line(pts, fill=color, width=w)
def draw_poly(coords_ll, color, w=2): draw_line(coords_ll + coords_ll[:1], color, w)

with open(f"{DATA}\\osm.json", encoding="utf-8-sig") as f:
    osm = json.load(f)

HW = {"primary": (255,80,0), "secondary": (255,140,0), "residential": (255,210,0),
      "service": (0,220,255), "unclassified": (0,255,160), "path": (170,110,255)}
print("--- local coords of notable items (x east m, y north m) ---")
for e in osm["elements"]:
    t = e.get("tags", {})
    g0 = e.get("geometry")
    if e["type"] == "way" and g0:
        g = [(p["lon"], p["lat"]) for p in g0 if p]
        c = [sum(p[0] for p in g)/len(g), sum(p[1] for p in g)/len(g)]
        lx, ly = tr_ll2loc.transform(*c)
        if "highway" in t:
            draw_line(g, HW.get(t["highway"], (200,200,200)), 3 if t.get("highway")=="primary" else 2)
            if abs(lx) < 700 and abs(ly) < 700:
                print(f"  hw {t.get('highway'):12s} {t.get('name') or 'way/'+str(e['id']):30s} c=({lx:5.0f},{ly:5.0f}) pts={len(g)}")
        elif "building" in t:
            draw_poly(g, (255,0,255), 2)
        elif t.get("natural") == "water" or "water" in t: draw_poly(g, (0,90,255), 2)
        elif t.get("leisure") == "pitch":
            draw_poly(g, (0,255,0), 2)
            print(f"  pitch {t.get('sport'):20s} c=({lx:5.0f},{ly:5.0f})")
        elif t.get("man_made") == "pier":
            draw_line(g, (255,255,255), 3)
            print(f"  pier  c=({lx:5.0f},{ly:5.0f}) pts={[f'({q[0]:.0f},{q[1]:.0f})' for q in [tr_ll2loc.transform(*p) for p in g]]}")
        elif t.get("natural") == "beach":
            draw_poly(g, (255,230,120), 2); print(f"  beach c=({lx:5.0f},{ly:5.0f})")
        elif t.get("amenity") == "school":
            draw_poly(g, (255,0,80), 4)
            print(f"  SCHOOL {t.get('name')!r} c=({lx:5.0f},{ly:5.0f}) poly={[f'({q[0]:.0f},{q[1]:.0f})' for q in [tr_ll2loc.transform(*p) for p in g]]}")
        elif t.get("amenity") == "parking":
            draw_poly(g, (255,160,60), 2); print(f"  parking c=({lx:5.0f},{ly:5.0f})")
        elif t.get("leisure") == "park":
            draw_poly(g, (120,255,120), 2); print(f"  park {t.get('name')} c=({lx:5.0f},{ly:5.0f})")
    elif e["type"] == "relation" and t.get("name") == "Lake Rosseau":
        for m in e.get("members", []):
            if m.get("geometry"):
                draw_line([(p["lon"], p["lat"]) for p in m["geometry"] if p], (0,90,255), 3)

with open(r"C:\Users\josia\Downloads\roads.geojson.json", encoding="utf-8") as f:
    gj = json.load(f)
for ft in gj["features"]:
    if ft["geometry"]["type"] == "LineString":
        draw_line([(c[0], c[1]) for c in ft["geometry"]["coordinates"]], (255,0,0), 2)

# building centroids list (within core)
print("--- buildings within 650m ---")
n = 0
for e in osm["elements"]:
    t = e.get("tags", {})
    if e["type"] == "way" and "building" in t and e.get("geometry"):
        g = [(p["lon"], p["lat"]) for p in e["geometry"] if p]
        c = [sum(p[0] for p in g)/len(g), sum(p[1] for p in g)/len(g)]
        lx, ly = tr_ll2loc.transform(*c)
        if abs(lx) < 650 and abs(ly) < 650:
            n += 1
            xs2, ys2 = zip(*[tr_ll2loc.transform(*p) for p in g])
            wx, wy = max(xs2)-min(xs2), max(ys2)-min(ys2)
            print(f"  bldg way/{e['id']} c=({lx:5.0f},{ly:5.0f}) ~{wx:.0f}x{wy:.0f}m {t.get('name') or ''}")
print("count:", n)

dr.line([to_px(-20,0), to_px(20,0)], fill=(255,255,255), width=3)
dr.line([to_px(0,-20), to_px(0,20)], fill=(255,255,255), width=3)
img.save(f"{DATA}\\debug_core.png")
print("saved debug_core.png")
