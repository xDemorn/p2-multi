"""Build the 60x60 race maze with two-tile passages and a shared start (Python 3)."""
import json
import random
from collections import deque
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "client/public/assets"
SIZE = 60
RNG = random.Random(1739)
DIRECTIONS = [(1, 0), (0, 1), (-1, 0), (0, -1)]
walkable, edges = set(), set()


def connect(a, b):
    edges.add(tuple(sorted((a, b))))
    ax, ay = 3 + 4 * a[0], 3 + 4 * a[1]
    bx, by = 3 + 4 * b[0], 3 + 4 * b[1]
    walkable.update((x, y) for y in range(min(ay, by), max(ay, by) + 2)
                    for x in range(min(ax, bx), max(ax, bx) + 2))


# Two-wide channels on a four-tile lattice. No plazas or wider starting courts.
# Start and finish each have exactly one connection to the maze graph.
start_node, entry_node = (0, 0), (0, 1)
goal_node, goal_entry = (13, 13), (12, 13)
nodes = {(x, y) for y in range(14) for x in range(14)} - {start_node, goal_node}
visited, stack = {entry_node}, [entry_node]
while stack:
    x, y = stack[-1]
    choices = [(x + dx, y + dy) for dx, dy in DIRECTIONS
               if (x + dx, y + dy) in nodes - visited]
    if not choices:
        stack.pop()
        continue
    nxt = RNG.choice(choices)
    connect((x, y), nxt)
    visited.add(nxt)
    stack.append(nxt)
assert visited == nodes

# More loops create junctions and shorter alternatives while keeping the shared entrance and terminal goal.
shortcuts = []
for a in sorted(nodes):
    for dx, dy in [(1, 0), (0, 1)]:
        b = (a[0] + dx, a[1] + dy)
        if b in nodes and tuple(sorted((a, b))) not in edges:
            shortcuts.append((a, b))
RNG.shuffle(shortcuts)
for a, b in shortcuts[:42]:
    connect(a, b)
connect(start_node, entry_node)
connect(goal_entry, goal_node)

# Six separate positions in one compact 2x3 block, facing a common two-wide exit.
spawns = [(3, 5), (4, 5), (3, 4), (4, 4), (3, 3), (4, 3)]
trophy = (55, 55)
goal_tiles = {(x, y) for y in (55, 56) for x in (55, 56)}
distances, previous = {spawns[0]: 0}, {spawns[0]: None}
queue = deque([spawns[0]])
while queue:
    x, y = queue.popleft()
    for dx, dy in DIRECTIONS:
        p = x + dx, y + dy
        if p in walkable and p not in distances:
            distances[p] = distances[x, y] + 1
            previous[p] = (x, y)
            queue.append(p)
assert set(distances) == walkable, "Disconnected passages"
assert all(p in distances for p in spawns + [trophy])
assert 100 <= distances[trophy] <= 150, "Keep the goal distant without a long detour"
assert len(set(spawns)) == 6
assert sum(goal_node in edge for edge in edges) == 1, "The finish has one entrance"
assert all(0 < x < SIZE - 1 and 0 < y < SIZE - 1 for x, y in walkable)
assert not any(all((x + dx, y + dy) in walkable for dy in range(3) for dx in range(3))
               for y in range(SIZE - 2) for x in range(SIZE - 2)), "Passages exceed two tiles"

# Shared pickups on the main route, with two early targets to compete over.
path, p = [], trophy
while p is not None:
    path.append(p)
    p = previous[p]
path.reverse()
steps = [6, 12] + [round((len(path) - 1) * f) for f in (.22, .36, .5, .64, .78, .9)]
item_positions = [path[step] for step in steps]
assert len(set(item_positions)) == 8
assert not set(item_positions) & (set(spawns) | goal_tiles)

ground, grass, sanctuary, walls, details, collision = [], [], [], [], [], []
for y in range(SIZE):
    for x in range(SIZE):
        p = x, y
        open_tile = p in walkable
        variation = (x * 73 + y * 37 + x * y * 11) % 100
        floor = 33 if (x // 10 + y // 10) % 3 == 0 else 49
        grassy = open_tile and (x // 8 + y // 8) % 4 == 1 and p not in goal_tiles and p not in spawns
        if p in spawns:
            floor = 193
        if p in goal_tiles:
            floor = 49
        ground.append(floor)
        grass.append(49 if grassy else 0)
        sanctuary.append(49 if p in goal_tiles else 0)
        # Existing tree/rock art decorates blocked cells without altering the passages.
        detail = 0
        if not open_tile and variation < 5 and 2 < x < 57 and 2 < y < 57:
            detail = (201 if variation < 3 else 161) + (x + y) % 4
        walls.append((209 if variation < 16 else 233) + (x + y) % 4 if not open_tile and not detail else 0)
        details.append(detail)
        collision.append(0 if open_tile else 49)
assert sum(g == 193 for g in ground) == 6
assert all(not collision[i] or walls[i] or details[i] for i in range(SIZE * SIZE))

properties = [
    {"name": "spawnPositions", "type": "string", "value": json.dumps(spawns)},
    {"name": "trophyPosition", "type": "string", "value": json.dumps(trophy)},
    {"name": "boostPositions", "type": "string", "value": json.dumps(item_positions)},
    {"name": "description", "type": "string", "value": "Pasillos de dos casillas, salida compartida y copa en el extremo opuesto"},
]
layers = []
for i, (name, data, visible, offset) in enumerate([
    ("ground", ground, True, 0), ("grass", grass, True, 0),
    ("sanctuary", sanctuary, True, 0), ("walls", walls, True, -110),
    ("details", details, True, -110), ("collision", collision, False, 0),
], 1):
    layers.append(dict(id=i, name=name, type="tilelayer", width=SIZE, height=SIZE,
                       x=0, y=0, opacity=1, visible=visible, offsetx=0, offsety=offset, data=data))
    if name == "grass":
        layers[-1]["tintcolor"] = "#91bb69"
    if name == "sanctuary":
        layers[-1]["tintcolor"] = "#ffdf89"

map_data = dict(compressionlevel=-1, width=SIZE, height=SIZE, infinite=False,
                orientation="isometric", renderorder="right-down", tilewidth=232,
                tileheight=110, type="map", version="1.10", tiledversion="1.12.2",
                nextlayerid=7, nextobjectid=1, properties=properties, layers=layers,
                tilesets=[{"firstgid": 1, "source": "map_tiles.tsx"}])
(ASSETS / "map.tmj").write_text(json.dumps(map_data, indent=2) + "\n", encoding="utf-8")
root = ET.Element("map", dict(version="1.10", tiledversion="1.12.2", orientation="isometric",
                  renderorder="right-down", width=str(SIZE), height=str(SIZE), tilewidth="232",
                  tileheight="110", infinite="0", nextlayerid="7", nextobjectid="1"))
props = ET.SubElement(root, "properties")
for prop in properties:
    ET.SubElement(props, "property", {k: str(v) for k, v in prop.items()})
ET.SubElement(root, "tileset", firstgid="1", source="map_tiles.tsx")
for layer in layers:
    el = ET.SubElement(root, "layer", id=str(layer["id"]), name=layer["name"],
                       width=str(SIZE), height=str(SIZE), visible="1" if layer["visible"] else "0",
                       offsetx="0", offsety=str(layer["offsety"]))
    if "tintcolor" in layer:
        el.set("tintcolor", layer["tintcolor"])
    ET.SubElement(el, "data", encoding="csv").text = "\n" + ",\n".join(
        ",".join(map(str, layer["data"][y * SIZE:(y + 1) * SIZE])) for y in range(SIZE)) + "\n"
ET.indent(root)
xml = ET.tostring(root, encoding="UTF-8", xml_declaration=True)
for target in (ASSETS / "map.tmx", ROOT / "tiled/map.tmx"):
    target.write_bytes(xml)
assert (ASSETS / "map_tiles.tsx").read_bytes() == (ROOT / "tiled/map_tiles.tsx").read_bytes()
print(f"Maze: {SIZE}x{SIZE}, {len(walkable)} connected tiles, 2-wide passages, "
      f"six nearby spawns, trophy {trophy}, {distances[trophy]} steps from the front spawn.")
