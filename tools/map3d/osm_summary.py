"""Summarize the Overpass response: roads, buildings, water, amenities."""
import json
from collections import Counter

SRC = r"E:\fable tests\MegaProject\tools\map3d\data\osm.json"
with open(SRC, encoding="utf-8-sig") as f:
    osm = json.load(f)

els = osm["elements"]
print("elements:", len(els))

hw, bld, water, other_ways, nodes, rels = [], [], [], [], [], []
for e in els:
    t = e.get("tags", {})
    if e["type"] == "way":
        if "highway" in t: hw.append(e)
        elif "building" in t: bld.append(e)
        elif t.get("natural") == "water" or "water" in t: water.append(e)
        else: other_ways.append(e)
    elif e["type"] == "relation":
        rels.append(e)
    elif e["type"] == "node" and t:
        nodes.append(e)

print(f"\n--- HIGHWAYS ({len(hw)}) ---")
for e in hw:
    t = e["tags"]
    g = e.get("geometry") or []
    print(f"  way/{e['id']} {t.get('highway'):14s} name={t.get('name')!r} surface={t.get('surface')} pts={len(g)}")

print(f"\n--- BUILDINGS ({len(bld)}) ---")
named = [e for e in bld if e["tags"].get("name")]
print("named buildings:")
for e in named:
    print(f"  way/{e['id']} {e['tags'].get('building')} name={e['tags'].get('name')!r}")
print("building types:", Counter(e["tags"].get("building") for e in bld))

print(f"\n--- WATER ways ({len(water)}) ---")
for e in water:
    g = e.get("geometry") or []
    print(f"  way/{e['id']} tags={e['tags']} pts={len(g)}")

print(f"\n--- RELATIONS ({len(rels)}) ---")
for e in rels:
    t = e.get("tags", {})
    m = e.get("members", [])
    ng = sum(len(mm.get("geometry") or []) for mm in m)
    print(f"  rel/{e['id']} tags={ {k:v for k,v in t.items() if k in ('type','natural','water','name','building')} } members={len(m)} geompts={ng}")

print(f"\n--- OTHER WAYS ({len(other_ways)}) ---")
for e in other_ways:
    t = e["tags"]
    key = {k: v for k, v in t.items() if k in ("leisure", "man_made", "landuse", "natural", "amenity", "name", "sport", "aeroway")}
    g = e.get("geometry") or []
    print(f"  way/{e['id']} {key} pts={len(g)}")

print(f"\n--- TAGGED NODES ({len(nodes)}) ---")
for e in nodes:
    t = e["tags"]
    key = {k: v for k, v in t.items() if k in ("amenity", "tourism", "leisure", "name", "shop", "man_made")}
    print(f"  node/{e['id']} {key} at {e.get('lat'):.5f},{e.get('lon'):.5f}")
