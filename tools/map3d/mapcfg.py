"""Shared config + coordinate helpers for the Muskoka Woods 3D map rebuild.

World convention (matches the existing map3d so its styling/camera code still fits):
  1 world unit = 2 metres.  x = EAST,  z = SOUTH (so +z points south, lake side).
  Vertical is TRUE 1:1 with horizontal (height_world = (elev_m - LAKE_DATUM)/2).
  Origin = documented camp centre.
"""
import math, pyproj

LAT0, LON0 = 45.2492, -79.6170      # documented camp centre
M_PER_UNIT = 2.0                    # 1 world unit = 2 m
LAKE_DATUM = 225.30                 # Lake Rosseau surface (m, CGVD) -> world y = 0
RADIUS_M = 1500.0                   # requested 1.5 km radius
BOX_M = 1600.0                      # fetch half-box (a little margin past the radius)

AEQD = f"+proj=aeqd +lat_0={LAT0} +lon_0={LON0} +datum=WGS84 +units=m"
_ll2loc = pyproj.Transformer.from_crs("EPSG:4326", AEQD, always_xy=True)
_loc2ll = pyproj.Transformer.from_crs(AEQD, "EPSG:4326", always_xy=True)
_loc2_3979 = pyproj.Transformer.from_crs(AEQD, "EPSG:3979", always_xy=True)
_3979_2loc = pyproj.Transformer.from_crs("EPSG:3979", AEQD, always_xy=True)

def ll_to_local(lon, lat):
    """lon,lat -> (east_m, north_m)."""
    return _ll2loc.transform(lon, lat)

def ll_to_world(lon, lat):
    """lon,lat -> (x_world, z_world) with x=east/2, z=south/2."""
    e, n = _ll2loc.transform(lon, lat)
    return e / M_PER_UNIT, -n / M_PER_UNIT

def local_to_world(e, n):
    return e / M_PER_UNIT, -n / M_PER_UNIT

def elev_to_world(elev_m):
    return (elev_m - LAKE_DATUM) / M_PER_UNIT

# expose transformers for vectorised numpy use
loc2_3979 = _loc2_3979
xy3979_2loc = _3979_2loc
loc2ll = _loc2ll
