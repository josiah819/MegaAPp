"""Quick summary of the GPS road traces GeoJSON."""
import json, math, sys

SRC = r"C:\Users\josia\Downloads\roads.geojson.json"

def length_m(coords):
    R = 6371000
    tot = 0.0
    for i in range(1, len(coords)):
        lon1, lat1 = coords[i-1][:2]
        lon2, lat2 = coords[i][:2]
        x = math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2)) * R
        y = math.radians(lat2 - lat1) * R
        tot += math.hypot(x, y)
    return tot

with open(SRC, encoding="utf-8") as f:
    gj = json.load(f)

lats, lons = [], []
print("features:", len(gj["features"]))
for i, ft in enumerate(gj["features"]):
    g = ft["geometry"]
    p = ft.get("properties", {})
    if g["type"] == "LineString":
        pts = g["coordinates"]
    elif g["type"] == "MultiLineString":
        pts = [q for seg in g["coordinates"] for q in seg]
    elif g["type"] == "Point":
        pts = [g["coordinates"]]
    else:
        pts = []
    for q in pts:
        lons.append(q[0]); lats.append(q[1])
    L = length_m(pts) if g["type"] in ("LineString", "MultiLineString") else 0
    print(f"  [{i}] {g['type']:12s} pts={len(pts):5d} len={L:7.0f}m  name={p.get('name')!r} type={p.get('type')!r}")

print("bbox lon:", min(lons), max(lons))
print("bbox lat:", min(lats), max(lats))
print("centroid:", sum(lats)/len(lats), sum(lons)/len(lons))
print("span EW (m):", length_m([[min(lons), sum(lats)/len(lats)], [max(lons), sum(lats)/len(lats)]]))
print("span NS (m):", length_m([[sum(lons)/len(lons), min(lats)], [sum(lons)/len(lons), max(lats)]]))
