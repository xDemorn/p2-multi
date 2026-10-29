"""Rebuild the playable Tiled maze using only the existing tileset (Python 3)."""
import json
import random
from collections import deque
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "client/public/assets"
SIZE = 60
RNG = random.Random(1739)
walkable = set()


def carve(x, y, width=2, height=2):
    walkable.update((xx, yy) for yy in range(y, y + height) for xx in range(x, x + width))


# Two-tile passages on a four-tile lattice leave substantial stone walls.
# Keep the central courtyard out of the maze graph.
nodes = {(x, y) for y in range(14) for x in range(14)
         if not (6 <= x <= 7 and 6 <= y <= 7)}
visited = {(0, 0)}
stack = [(0, 0)]
edges = set()


def connect(a, b):
    edges.add(tuple(sorted((a, b))))
    ax, ay = 3 + 4 * a[0], 3 + 4 * a[1]
    bx, by = 3 + 4 * b[0], 3 + 4 * b[1]
    carve(min(ax, bx), min(ay, by), abs(ax - bx) + 2, abs(ay - by) + 2)


while stack:
    x, y = stack[-1]
    choices = [(x + dx, y + dy) for dx, dy in [(1, 0), (0, 1), (-1, 0), (0, -1)]
               if (x + dx, y + dy) in nodes - visited]
    if not choices:
        stack.pop()
        continue
    nxt = RNG.choice(choices)
    connect((x, y), nxt)
    visited.add(nxt)
    stack.append(nxt)

# A few alternative routes let players approach the same destination from different sides.
shortcuts = []
for a in sorted(nodes):
    for dx, dy in [(1, 0), (0, 1)]:
        b = (a[0] + dx, a[1] + dy)
        if b in nodes and tuple(sorted((a, b))) not in edges:
            shortcuts.append((a, b))
RNG.shuffle(shortcuts)
for a, b in shortcuts[:22]:
    connect(a, b)

# A discreet 6 x 6 clearing blends into the maze, with narrow approach passages.
carve(27, 27, 6, 6)
carve(27, 23, 2, 6)
carve(27, 31, 2, 6)
carve(23, 27, 6, 2)
carve(31, 27, 6, 2)

# Six little starting courts, distributed around the outer maze.
spawns = [(3, 3), (55, 3), (3, 55), (55, 55), (27, 3), (27, 55)]
for x, y in spawns:
    carve(x - 1, y - 1, 4, 4)


# Occasional wider clearings contain individual obstacles, never rows of trees.
# Each tree/rock has floor on all four sides so players can walk around it.
clearings = [(11, 11), (43, 11), (11, 43), (43, 43),
             (27, 11), (27, 47), (47, 27), (11, 27)]
scenery = {}
rivers = {}
bridges = set()
grass_tiles = set()
for i, (x, y) in enumerate(clearings):
    carve(x - 2, y - 2, 6, 6)
    scenery[x, y] = 201 + i % 4
    scenery[x + 2, y + 1] = 161 + i % 4
    grass_tiles.update((xx, yy) for yy in range(y - 2, y + 4) for xx in range(x - 2, x + 4))
    # A short capped stream beside the tree; a bridge preserves the north entrance.
    for dx, gid in [(-1, 109), (0, 89), (1, 97), (2, 111)]:
        rivers[x + dx, y - 2] = gid
    bridges.add((x + 1, y - 2))
walkable.difference_update(scenery)
walkable.difference_update(set(rivers) - bridges)

ground, grass, sanctuary, walls, details, collision = [], [], [], [], [], []
for y in range(SIZE):
    for x in range(SIZE):
        p = (x, y)
        open_tile = p in walkable
        variation = (x * 73 + y * 37 + x * y * 11) % 100
        # Broad areas of plain stone, earth and grass; no checkerboard or stair floors.
        central = 27 <= x <= 32 and 27 <= y <= 32
        floor = 33 if open_tile and not central and (x // 10 + y // 10) % 3 == 0 else 49
        grassy = p in grass_tiles and p not in rivers
        if p in rivers:
            floor = rivers[p]
        if p in spawns:
            floor = 193
            grassy = False
        if central:
            floor = 33 if x in (27, 32) or y in (27, 32) else 49
        ground.append(floor)
        grass.append(49 if grassy else 0)
        sanctuary.append(49 if 28 <= x <= 31 and 28 <= y <= 31 else 0)
        obstacle = 0
        detail = scenery.get(p, 0)
        if not open_tile and not detail and p not in rivers:
            obstacle = (209 if variation < 16 else 233) + (x + y) % 4
        # Walls define the maze; trees and rocks are isolated obstacles in wider areas.
        walls.append(obstacle)
        details.append(detail)
        collision.append(49 if not open_tile else 0)

# Verify reachability across every passage, spawn and the completely clear central square.
seen = {spawns[0]}
queue = deque(seen)
while queue:
    x, y = queue.popleft()
    for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
        p = x + dx, y + dy
        if p in walkable and p not in seen:
            seen.add(p)
            queue.append(p)
assert seen == walkable, "Disconnected passages"
assert all(p in seen for p in spawns)
assert all((x, y) in seen for y in range(27, 33) for x in range(27, 33))
assert all(not walls[y * SIZE + x] and not details[y * SIZE + x]
           for y in range(27, 33) for x in range(27, 33))
assert all(ground[y * SIZE + x] == 193 for x, y in spawns)
assert sum(g == 193 for g in ground) == len(spawns), "Only spawns have blue markings"
assert all((x, y) in seen for x, y in bridges), "Bridges must stay reachable"
assert all(collision[y * SIZE + x] for x, y in set(rivers) - bridges)
assert all((x + dx, y + dy) in walkable for x, y in scenery
           for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]), "Scenery must be isolated"
assert all(not collision[i] or walls[i] or details[i] or (i % SIZE, i // SIZE) in rivers
           for i in range(SIZE * SIZE))
assert all(0 < x < SIZE - 1 and 0 < y < SIZE - 1 for x, y in walkable)

# Six shared boosts: one exactly eight walking steps from each spawn.
item_positions = []
for spawn in spawns:
    distances = {spawn: 0}
    queue = deque([spawn])
    while queue:
        x, y = queue.popleft()
        if distances[x, y] == 8:
            continue
        for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
            p = x + dx, y + dy
            if p in walkable and p not in distances:
                distances[p] = distances[x, y] + 1
                queue.append(p)
    candidates = [p for p, distance in distances.items() if distance == 8 and p not in spawns
                  and p not in item_positions and p not in bridges]
    assert candidates, "Every spawn needs a boost at equal walking distance"
    chosen = max(candidates, key=lambda p: min(abs(p[0]-s[0])+abs(p[1]-s[1]) for s in spawns if s != spawn))
    item_positions.append(chosen)
assert len(set(item_positions)) == 6


def walking_distances(sources):
    distances = {tuple(p): 0 for p in sources}
    queue = deque(distances)
    while queue:
        x, y = queue.popleft()
        for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
            p = x + dx, y + dy
            if p in walkable and p not in distances:
                distances[p] = distances[x, y] + 1
                queue.append(p)
    return distances


# Only two extra boosts, in opposite interior regions. Keep the six equal-distance
# starting boosts and avoid giving a spawn a closer second pickup.
spawn_distances = walking_distances(spawns)
for target_x, target_y in [(19, 31), (39, 27)]:
    item_distances = walking_distances(item_positions)
    candidates = [p for p in sorted(walkable)
                  if spawn_distances[p] >= 16 and item_distances[p] >= 12
                  and p not in bridges and not (27 <= p[0] <= 32 and 27 <= p[1] <= 32)
                  and ((p[0] < 30) == (target_x < 30))]
    assert candidates, "Extra boosts must remain separated from spawns and each other"
    item_positions.append(min(candidates, key=lambda p: abs(p[0]-target_x)+abs(p[1]-target_y)))
assert len(set(item_positions)) == 8

properties = [
    {"name": "spawnPositions", "type": "string", "value": json.dumps(spawns)},
    {"name": "trophyPosition", "type": "string", "value": "[30, 30]"},
    {"name": "boostPositions", "type": "string", "value": json.dumps(item_positions)},
    {"name": "description", "type": "string", "value": "Laberinto de piedra, tierra y hierba con arroyos, spawns marcados y plaza para la copa"},
]
layers = []
for i, (name, data, visible, offset) in enumerate([
    ("ground", ground, True, 0),
    ("grass", grass, True, 0),
    ("sanctuary", sanctuary, True, 0),
    ("walls", walls, True, -110),
    ("details", details, True, -110),
    ("collision", collision, False, 0),
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
ET.ElementTree(root).write(ASSETS / "map.tmx", encoding="UTF-8", xml_declaration=True)
print(f"Maze generated: {SIZE} x {SIZE}, {len(seen)} connected walkable tiles, 6 spawns, clear 6 x 6 plaza.")
