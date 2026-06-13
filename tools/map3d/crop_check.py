from PIL import Image
DATA = r"E:\fable tests\MegaProject\tools\map3d\data"
img = Image.open(f"{DATA}\\sat_overlay.png")
SC = 1 / 0.72; HALF = 720
def box(x0, y0, x1, y1):
    return (int((x0+HALF)*SC), int((HALF-y1)*SC), int((x1+HALF)*SC), int((HALF-y0)*SC))
zones = {
    "c_eastshore": (40, -340, 420, 40),     # courts + east side + south
    "c_southshore": (-260, -360, 120, -120), # SW->S shore, Leadership/beach/docks
}
for name, b in zones.items():
    c = img.crop(box(*b)); w, h = c.size; f = max(1.0, 1500/w)
    c.resize((int(w*f), int(h*f)), Image.LANCZOS).save(f"{DATA}\\{name}.png")
    print(name, c.size)
