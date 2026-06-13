from PIL import Image
DATA = r"E:\fable tests\MegaProject\tools\map3d\data"
img = Image.open(f"{DATA}\\sat_overlay.png")
SC = 1 / 0.72
HALF = 720
def box(x0, y0, x1, y1):  # local metres (x east, y north)
    return (int((x0 + HALF) * SC), int((HALF - y1) * SC), int((x1 + HALF) * SC), int((HALF - y0) * SC))
zones = {
    "z_centre": (-160, -120, 160, 120),
    "z_north": (-160, 100, 160, 340),
    "z_east": (60, -260, 380, -20),
    "z_south": (-180, -440, 140, -180),
    "z_west": (-600, 120, -280, 500),
    "z_shore": (-260, -320, 60, -120),
}
for name, (x0, y0, x1, y1) in zones.items():
    c = img.crop(box(x0, y0, x1, y1))
    w, h = c.size
    f = max(1.0, 1400 / w)
    c = c.resize((int(w * f), int(h * f)), Image.LANCZOS)
    c.save(f"{DATA}\\{name}.png")
    print(name, "saved", c.size)
