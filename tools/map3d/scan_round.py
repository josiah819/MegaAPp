import json, pyproj
osm = json.load(open(r'E:\fable tests\MegaProject\tools\map3d\data\osm.json', encoding='utf-8-sig'))
tr = pyproj.Transformer.from_crs('EPSG:4326', '+proj=aeqd +lat_0=45.2492 +lon_0=-79.6175 +datum=WGS84', always_xy=True)
for e in osm['elements']:
    if e['type'] == 'way' and 'building' in e.get('tags', {}) and e.get('geometry'):
        pts = [tr.transform(p['lon'], p['lat']) for p in e['geometry']]
        cx = sum(q[0] for q in pts) / len(pts)
        cy = sum(q[1] for q in pts) / len(pts)
        if abs(cx) < 700 and abs(cy) < 700 and len(e['geometry']) >= 9:
            w = max(q[0] for q in pts) - min(q[0] for q in pts)
            h = max(q[1] for q in pts) - min(q[1] for q in pts)
            print(f"way/{e['id']} pts={len(e['geometry'])} c=({cx:.0f},{cy:.0f}) w={w:.0f} h={h:.0f}")
