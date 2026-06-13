"""Render a debug overlay: LiDAR hillshade + OSM + GPS traces in local meters."""
import json, math
import numpy as np
import tifffile, pyproj
from PIL import Image, ImageDraw

DATA = r"E:\fable tests\MegaProject\tools\map3d\data"
LAT0, LON0 = 45.2492, -79.6175

# ---- local frame: AEQD centered on camp (x=east m, y=north m) ----
tr_ll2loc = pyproj.Transformer.from_crs(
    "EPSG:4326", f"+proj=aeqd +lat_0={LAT0} +lon_0={LON0} +datum=WGS84 +units=m", always_xy=True)
tr_3979 = pyproj.Transformer.from_crs(
    "EPSG:3979", f"+proj=aeqd +lat_0={LAT0} +lon_0={LON0} +datum=WGS84 +units=m", always_xy=True)

# ---- image frame: 2200x2200 px covering +-1100 m ----
HALF = 1100
SZ = 2200  # 1 m/px
def to_px(x, y):
    return (x + HALF, HALF - y)

# ---- hillshade from DTM 2m ----
tif = tifffile.TiffFile(f"{DATA}\\dtm_2m_full.tif")
dem = tif.pages[0].asarray().astype(np.float32)
tags = tif.pages[0].tags
sx, sy, _ = tags["ModelPixelScaleTag"].value
_, _, _, ox, oy, _ = tags["ModelTiepointTag"].value     # top-left corner in EPSG:3979
H, W = dem.shape

# build hillshade
gy, gx = np.gradient(dem, sy, sx)
az, alt = math.radians(315), math.radians(45)
slope = np.arctan(np.hypot(gx, gy))
aspect = np.arctan2(-gx, gy)
hs = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
hs = np.clip((hs + 1) / 2 * 255, 0, 255).astype(np.uint8)

# resample hillshade into local frame (nearest is fine for debug)
xs = np.arange(SZ) - HALF            # local x east
ys = HALF - np.arange(SZ)            # local y north
XX, YY = np.meshgrid(xs, ys)
# local -> 3979
tr_loc2_3979 = pyproj.Transformer.from_crs(
    f"+proj=aeqd +lat_0={LAT0} +lon_0={LON0} +datum=WGS84 +units=m", "EPSG:3979", always_xy=True)
PX, PY = tr_loc2_3979.transform(XX, YY)
ci = np.clip(((PX - ox) / sx).astype(int), 0, W - 1)
ri = np.clip(((oy - PY) / sy).astype(int), 0, H - 1)
base = hs[ri, ci]
lake = dem[ri, ci] < 225.6   # lake-level mask
img_arr = np.stack([base, base, base], -1)
img_arr[lake] = (img_arr[lake] * np.array([0.55, 0.75, 0.95])).astype(np.uint8)
img = Image.fromarray(img_arr, "RGB")
dr = ImageDraw.Draw(img)

def draw_line(coords_ll, color, w=2):
    pts = [to_px(*tr_ll2loc.transform(lon, lat)) for lon, lat in coords_ll]
    if len(pts) > 1:
        dr.line(pts, fill=color, width=w)

def draw_poly(coords_ll, color, w=2):
    draw_line(coords_ll + coords_ll[:1], color, w)

# ---- OSM ----
with open(f"{DATA}\\osm.json", encoding="utf-8-sig") as f:
    osm = json.load(f)

HW_COLORS = {"primary": (255, 80, 0), "secondary": (255, 140, 0), "residential": (255, 210, 0),
             "service": (0, 220, 255), "unclassified": (0, 255, 160), "path": (170, 110, 255), "track": (170, 110, 255)}
labels = []
for e in osm["elements"]:
    t = e.get("tags", {})
    if e["type"] == "way" and e.get("geometry"):
        g = [(p["lon"], p["lat"]) for p in e["geometry"] if p]
        if "highway" in t:
            draw_line(g, HW_COLORS.get(t["highway"], (200, 200, 200)), 3 if t.get("highway") == "primary" else 2)
        elif "building" in t:
            draw_poly(g, (255, 0, 255), 2)
        elif t.get("natural") == "water" or "water" in t:
            draw_poly(g, (0, 90, 255), 2)
        elif t.get("leisure") == "pitch":
            draw_poly(g, (0, 255, 0), 2)
        elif t.get("man_made") == "pier":
            draw_line(g, (255, 255, 255), 3)
        elif t.get("natural") == "beach":
            draw_poly(g, (255, 230, 120), 2)
        elif t.get("amenity") == "school":
            draw_poly(g, (255, 0, 80), 3)
            labels.append((g[0], t.get("name", "school")))
        if t.get("name") and "highway" not in t:
            cx = sum(p[0] for p in g) / len(g); cy = sum(p[1] for p in g) / len(g)
            labels.append(((cx, cy), t["name"]))
    elif e["type"] == "relation" and t.get("name") == "Lake Rosseau":
        for m in e.get("members", []):
            if m.get("geometry"):
                g = [(p["lon"], p["lat"]) for p in m["geometry"] if p]
                draw_line(g, (0, 90, 255), 3)

# ---- GPS traces ----
with open(r"C:\Users\josia\Downloads\roads.geojson.json", encoding="utf-8") as f:
    gj = json.load(f)
for ft in gj["features"]:
    if ft["geometry"]["type"] == "LineString":
        draw_line([(c[0], c[1]) for c in ft["geometry"]["coordinates"]], (255, 0, 0), 2)

for (lon, lat), name in labels:
    x, y = to_px(*tr_ll2loc.transform(lon, lat))
    dr.text((x + 4, y - 6), name, fill=(255, 255, 0))

# rings at 0.5/1.0/1.5 km
for r in (500, 1000, 1500):
    dr.ellipse([HALF - r, HALF - r, HALF + r, HALF + r], outline=(255, 255, 255), width=1)
dr.line([HALF - 12, HALF, HALF + 12, HALF], fill=(255, 255, 255), width=2)
dr.line([HALF, HALF - 12, HALF, HALF + 12], fill=(255, 255, 255), width=2)

img.save(f"{DATA}\\debug_overlay.png")
print("saved", f"{DATA}\\debug_overlay.png")

# stats: where do GPS traces sit vs OSM service roads?
allg = [c for ft in gj["features"] for c in ft["geometry"]["coordinates"]]
gx0, gy0 = tr_ll2loc.transform(allg[0][0], allg[0][1])
xs2, ys2 = zip(*[tr_ll2loc.transform(lon, lat) for lon, lat in allg])
print(f"GPS local bbox: x {min(xs2):.0f}..{max(xs2):.0f}  y {min(ys2):.0f}..{max(ys2):.0f}")
