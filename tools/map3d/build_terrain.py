"""Build terrain height + canopy + water grids from the aligned DTM/DSM.

Outputs (into frontend/public/map3d/):
  terrain_ground.bin   Int16  cm above lake datum,  N*N row-major (row0=NORTH, col0=WEST)
  terrain_canopy.bin   Int16  cm canopy height (DSM-DTM), 0 where none
  terrain_water.bin    Uint8  1 = lake
  terrain_meta.json    grid metadata
"""
import json, os
import numpy as np, tifffile
from scipy import ndimage
import mapcfg as C

DATA = r"E:\fable tests\MegaProject\tools\map3d\data"
OUT = r"E:\fable tests\MegaProject\frontend\public\map3d"
os.makedirs(OUT, exist_ok=True)

def load(name):
    tf = tifffile.TiffFile(os.path.join(DATA, name + ".tif"))
    arr = tf.pages[0].asarray().astype(np.float64)
    t = tf.pages[0].tags
    sx, sy, _ = t["ModelPixelScaleTag"].value
    _, _, _, ox, oy, _ = t["ModelTiepointTag"].value   # top-left corner in 3979
    return arr, sx, sy, ox, oy

dtm, sx, sy, ox, oy = load("dtm")
dsm, *_ = load("dsm")
H, W = dtm.shape

N = 501
HALF = C.RADIUS_M            # 1500 m
spacing = 2 * HALF / (N - 1) # 6.0 m
# local grid: col0 = west (-HALF), colN = east (+HALF); row0 = north (+HALF), rowN = south (-HALF)
ex = np.linspace(-HALF, HALF, N)
ny = np.linspace(HALF, -HALF, N)
EX, NY = np.meshgrid(ex, ny)
PX, PY = C.loc2_3979.transform(EX, NY)        # -> EPSG:3979

def bilinear(arr):
    fx = (PX - ox) / sx
    fy = (oy - PY) / sy
    x0 = np.clip(np.floor(fx).astype(int), 0, W - 2)
    y0 = np.clip(np.floor(fy).astype(int), 0, H - 2)
    tx = np.clip(fx - x0, 0, 1); ty = np.clip(fy - y0, 0, 1)
    v00 = arr[y0, x0]; v10 = arr[y0, x0 + 1]; v01 = arr[y0 + 1, x0]; v11 = arr[y0 + 1, x0 + 1]
    return (v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty)

ground = bilinear(dtm)
surf = bilinear(dsm)
canopy = np.clip(surf - ground, 0, None)

# ---- water: low flat cells connected to the big SW water body ----
cand = ground <= (C.LAKE_DATUM + 0.5)
lbl, n = ndimage.label(cand)
if n:
    # lake = the component containing the SW corner (deep open water)
    sw = lbl[N - 5, 5]
    sizes = ndimage.sum(np.ones_like(lbl), lbl, range(1, n + 1))
    biggest = int(np.argmax(sizes)) + 1
    lake_id = sw if sw != 0 else biggest
    water = (lbl == lake_id)
    water = ndimage.binary_dilation(water, iterations=1)   # pull lake edge over the ragged shore fringe
    water = ndimage.binary_fill_holes(water)               # swallow interior speckle/noise islands
else:
    water = np.zeros_like(ground, bool)
# sink the lake bed well below the water plane (datum=world y 0) so no z-fight / sandy specks
ground = np.where(water, C.LAKE_DATUM - 2.5, ground)
canopy = np.where(water, 0, canopy)

cm = lambda m: np.round((m - C.LAKE_DATUM) * 100).astype(np.int16)
cm_h = lambda m: np.round(m * 100).astype(np.int16)
cm(ground).tofile(os.path.join(OUT, "terrain_ground.bin"))
cm_h(canopy).tofile(os.path.join(OUT, "terrain_canopy.bin"))
water.astype(np.uint8).tofile(os.path.join(OUT, "terrain_water.bin"))

meta = {
    "n": N, "half_m": HALF, "spacing_m": spacing, "m_per_unit": C.M_PER_UNIT,
    "lake_datum_m": C.LAKE_DATUM,
    "ground_min_m": float(ground.min()), "ground_max_m": float(ground.max()),
    "canopy_max_m": float(canopy.max()), "water_frac": float(water.mean()),
    "note": "row0=NORTH(+z south), col0=WEST(-x). world: x=east/2, z=south/2, y=(elev-datum)/2",
}
json.dump(meta, open(os.path.join(OUT, "terrain_meta.json"), "w"), indent=2)
print(json.dumps(meta, indent=2))
print("elev around camp centre (world y):", round(C.elev_to_world(ground[N // 2, N // 2]), 2))
