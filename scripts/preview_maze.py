"""Render a top-down layout preview from map.tmj (optional: requires Pillow)."""
import json
from collections import deque
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
data = json.loads((ROOT / "client/public/assets/map.tmj").read_text(encoding="utf-8"))
layers = {layer["name"]: layer["data"] for layer in data["layers"]}
props = {p["name"]: json.loads(p["value"]) for p in data["properties"] if p["name"] != "description"}
spawns = [tuple(p) for p in props["spawnPositions"]]
boosts = {tuple(p) for p in props["boostPositions"]}
trophy = tuple(props["trophyPosition"])
image = Image.new("RGB", (1220, 1000), "#121b2a")
draw = ImageDraw.Draw(image)
font_path = Path("C:/Windows/Fonts/arial.ttf")
font = lambda size: ImageFont.truetype(str(font_path), size) if font_path.exists() else ImageFont.load_default(size=size)


def tile(x, y, px, py, size, numbers=False):
    i, p = y * data["width"] + x, (x, y)
    color = "#263549" if layers["collision"][i] else "#ddd8c8"
    if layers["grass"][i] and not layers["collision"][i]:
        color = "#95b47c"
    if p in spawns:
        color = "#55c4d2"
    if layers["sanctuary"][i]:
        color = "#efc451"
    draw.rectangle((px, py, px + size - 1, py + size - 1), fill=color)
    if p in boosts:
        draw.ellipse((px + size * .2, py + size * .2, px + size * .8, py + size * .8), fill="#d76b29")
    if p == trophy:
        draw.ellipse((px + 1, py + 1, px + size - 2, py + size - 2), fill="#fff5ab", outline="#71501a", width=2)
    if numbers and p in spawns:
        draw.text((px + size / 2, py + size / 2), str(spawns.index(p) + 1), fill="#122335", font=font(15), anchor="mm")


draw.text((30, 24), "LABERINTO | salida compartida", fill="#f3e3bc", font=font(30))
draw.text((30, 66), "60 x 60 casillas   /   Pasillos de 2   /   Copa en el extremo opuesto", fill="#afbed1", font=font(18))
for y in range(data["height"]):
    for x in range(data["width"]):
        tile(x, y, 30 + x * 14, 110 + y * 14, 14)

draw.text((900, 110), "SALIDA: 6 JUGADORES", fill="#55c4d2", font=font(20))
draw.text((900, 142), "Bloque de 2 x 3 casillas", fill="#afbed1", font=font(16))
for y in range(1, 11):
    for x in range(1, 10):
        tile(x, y, 900 + (x - 1) * 30, 184 + (y - 1) * 30, 30, numbers=True)
for j, (color, label) in enumerate([
    ("#55c4d2", "Posiciones iniciales"), ("#efc451", "Copa al final: [55,55]"),
    ("#d76b29", "8 mejoras compartidas"), ("#ddd8c8", "Suelo transitable"), ("#263549", "Muros y obstaculos"),
]):
    py = 540 + j * 42
    draw.rectangle((900, py, 918, py + 18), fill=color)
    draw.text((930, py - 1), label, fill="#dce4ee", font=font(16))
queue = deque([(spawns[0], 0)])
seen = {spawns[0]}
while queue:
    (x, y), steps = queue.popleft()
    if (x, y) == trophy:
        break
    for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
        p = x + dx, y + dy
        if 0 <= p[0] < data["width"] and 0 <= p[1] < data["height"] and p not in seen and not layers["collision"][p[1] * data["width"] + p[0]]:
            seen.add(p)
            queue.append((p, steps + 1))
draw.text((900, 790), f"{steps} pasos hasta la copa", fill="#f3e3bc", font=font(18))
draw.text((900, 824), "Esquema de colisiones.\nEl juego conserva su arte\ny perspectiva isometrica.", fill="#afbed1", font=font(16), spacing=8)
(ROOT / "docs").mkdir(exist_ok=True)
image.save(ROOT / "docs/maze-preview.png")
