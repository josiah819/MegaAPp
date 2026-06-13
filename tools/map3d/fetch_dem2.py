"""Re-fetch DTM + DSM at 2 m over the full +-1600 m box, aligned to the camp origin."""
import os, subprocess
import numpy as np, tifffile, pyproj
import mapcfg as C

DATA = r"E:\fable tests\MegaProject\tools\map3d\data"
BASE = "https://datacube.services.geo.ca/ows/elevation"
cx, cy = C.loc2_3979.transform(0, 0)
print(f"origin EPSG:3979 = {cx:.1f}, {cy:.1f}")

def grab(name, ident, half=1600, res=2):
    xmin, xmax, ymin, ymax = cx - half, cx + half, cy - half, cy + half
    url = (f"{BASE}?service=WCS&version=1.1.1&request=GetCoverage"
           f"&identifier={ident}&format=image/geotiff"
           f"&BoundingBox={xmin:.1f},{ymin:.1f},{xmax:.1f},{ymax:.1f},urn:ogc:def:crs:EPSG::3979"
           f"&GridBaseCRS=urn:ogc:def:crs:EPSG::3979&GridCS=urn:ogc:def:crs:OGC::imageCRS"
           f"&GridType=urn:ogc:def:method:WCS:1.1:2dSimpleGrid"
           f"&GridOrigin={xmin:.1f},{ymax:.1f}&GridOffsets={res},-{res}&InterpolationType=bilinear")
    raw = os.path.join(DATA, name + ".raw"); out = os.path.join(DATA, name + ".tif")
    subprocess.run(["curl.exe", "-sL", "-o", raw, url], check=True, timeout=600)
    blob = open(raw, "rb").read()
    i = max(blob.find(b"II*\x00"), blob.find(b"MM\x00*"))
    end = blob.rfind(b"\r\n--"); end = end if end > i else len(blob)
    open(out, "wb").write(blob[i:end]); os.remove(raw)
    tf = tifffile.TiffFile(out); arr = tf.pages[0].asarray().astype(np.float32)
    t = tf.pages[0].tags
    print(f"  {name}: {arr.shape} scale={t['ModelPixelScaleTag'].value[:2]} "
          f"tie={t['ModelTiepointTag'].value[3:5]} min={arr[arr>-1000].min():.1f} max={arr.max():.1f}")
    return out

grab("dtm", "dtm")
grab("dsm", "dsm")
print("done")
