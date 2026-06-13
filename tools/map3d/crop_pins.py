from PIL import Image
DATA = r"E:\fable tests\MegaProject\tools\map3d\data"
img = Image.open(f"{DATA}\\pins_validate.png")
SC = 1 / 0.72; HALF = 720
def box(x0, y0, x1, y1):
    return (int((x0+HALF)*SC), int((HALF-y1)*SC), int((x1+HALF)*SC), int((HALF-y0)*SC))
zones = {
    "p_centre": (-160, -120, 200, 120),
    "p_north": (-140, 100, 120, 280),
    "p_southeast": (60, -560, 360, -180),
    "p_shore": (-220, -260, 60, -100),
    "p_west": (-560, 60, -260, 420),
}
for name, b in zones.items():
    c = img.crop(box(*b)); w, h = c.size; f = max(1.0, 1500/w)
    c.resize((int(w*f), int(h*f)), Image.LANCZOS).save(f"{DATA}\\{name}.png")
    print(name)
