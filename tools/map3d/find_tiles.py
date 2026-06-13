"""Find LiDAR DTM tiles covering the camp area and inspect their attributes."""
import shapefile, pyproj

SHP = r"E:\fable tests\MegaProject\tools\map3d\data\tileindex\OntarioDTM_LidarDerived_TileIndex.shp"

# camp center + 1.7 km margin
LAT, LON, R = 45.2492, -79.6175, 1700.0

with open(SHP.replace(".shp", ".prj")) as f:
    prj = f.read()
print("PRJ:", prj[:160])

sf = shapefile.Reader(SHP)
print("records:", len(sf), "fields:", [f[0] for f in sf.fields[1:]])

# transform camp bbox into the shapefile CRS
crs = pyproj.CRS.from_wkt(prj)
tr = pyproj.Transformer.from_crs("EPSG:4326", crs, always_xy=True)
# geodesic-ish bbox in lon/lat first
import math
dlat = R / 111320.0
dlon = R / (111320.0 * math.cos(math.radians(LAT)))
x0, y0 = tr.transform(LON - dlon, LAT - dlat)
x1, y1 = tr.transform(LON + dlon, LAT + dlat)
xmin, xmax = min(x0, x1), max(x0, x1)
ymin, ymax = min(y0, y1), max(y0, y1)
print("query bbox:", xmin, ymin, xmax, ymax)

hits = []
for i, shrec in enumerate(sf.iterShapeRecords(bbox=(xmin, ymin, xmax, ymax))):
    hits.append(shrec.record.as_dict())
print("tiles found:", len(hits))
for h in hits[:60]:
    print(h)
