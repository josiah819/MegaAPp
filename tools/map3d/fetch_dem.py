"""Fetch HRDEM DTM/DSM clips around Muskoka Woods via NRCan datacube WCS 1.1.1."""
import math, subprocess, sys, os
import pyproj
import numpy as np
import tifffile

DATA = r"E:\fable tests\MegaProject\tools\map3d\data"
BASE = "https://datacube.services.geo.ca/ows/elevation"

LAT, LON = 45.2492, -79.6175   # camp center (origin of existing map)

tr = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:3979", always_xy=True)
cx, cy = tr.transform(LON, LAT)
print(f"center EPSG:3979: {cx:.1f}, {cy:.1f}")

def grab(name, ident, half, res):
    """Fetch a square clip: half-size in m, resolution in m/px."""
    xmin, xmax = cx - half, cx + half
    ymin, ymax = cy - half, cy + half
    url = (f"{BASE}?service=WCS&version=1.1.1&request=GetCoverage"
           f"&identifier={ident}&format=image/geotiff"
           f"&BoundingBox={xmin:.1f},{ymin:.1f},{xmax:.1f},{ymax:.1f},urn:ogc:def:crs:EPSG::3979"
           f"&GridBaseCRS=urn:ogc:def:crs:EPSG::3979"
           f"&GridCS=urn:ogc:def:crs:OGC::imageCRS"
           f"&GridType=urn:ogc:def:method:WCS:1.1:2dSimpleGrid"
           f"&GridOrigin={xmin:.1f},{ymax:.1f}"
           f"&GridOffsets={res},-{res}"
           f"&InterpolationType=bilinear")
    raw = os.path.join(DATA, name + ".raw")
    out = os.path.join(DATA, name + ".tif")
    print("fetching", name, "...")
    r = subprocess.run(["curl.exe", "-sL", "-o", raw, url], capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        print("curl failed:", r.stderr[:500]); return None
    blob = open(raw, "rb").read()
    print(f"  response: {len(blob)/1e6:.1f} MB")
    # multipart? find TIFF magic
    for magic in (b"II*\x00", b"MM\x00*"):
        i = blob.find(magic)
        if i >= 0:
            break
    if i < 0:
        print("  NO TIFF FOUND. head:", blob[:600])
        return None
    # find trailing multipart boundary (starts with \r\n--) after tiff
    end = blob.rfind(b"\r\n--")
    if end <= i:
        end = len(blob)
    with open(out, "wb") as f:
        f.write(blob[i:end])
    os.remove(raw)
    arr = tifffile.imread(out)
    tf = tifffile.TiffFile(out)
    tags = tf.pages[0].tags
    scale = tags.get("ModelPixelScaleTag")
    tie = tags.get("ModelTiepointTag")
    nod = tags.get("GDAL_NODATA")
    print(f"  shape={arr.shape} dtype={arr.dtype} scale={scale.value if scale else None}")
    print(f"  tiepoint={tie.value if tie else None} nodata={nod.value if nod else None}")
    a = arr.astype(np.float64)
    if nod is not None:
        a[a == float(nod.value)] = np.nan
    print(f"  elev min={np.nanmin(a):.2f} max={np.nanmax(a):.2f} mean={np.nanmean(a):.2f} nan%={np.isnan(a).mean()*100:.1f}")
    return out

ok1 = grab("dtm_2m_full", "dtm", 1800, 2)    # 3.6 km square @2m -> 1800px
ok2 = grab("dtm_1m_core", "dtm", 900, 1)     # 1.8 km square @1m -> 1800px
ok3 = grab("dsm_1m_core", "dsm", 900, 1)
print("done:", ok1, ok2, ok3)
