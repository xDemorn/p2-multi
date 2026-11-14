import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { map, collision, property, trophy, directions, isOpen } from "./map-helpers.js";

test("the live maze has no open 3x3 areas and every walkable tile is reachable", () => {
  const spawns = property("spawnPositions");
  const queue = [spawns[0]], seen = new Set([spawns[0].join(",")]);
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    for (const [dx, dy] of directions) {
      const p = [x + dx, y + dy], key = p.join(",");
      if (isOpen(...p) && !seen.has(key)) { seen.add(key); queue.push(p); }
    }
  }
  assert.equal(seen.size, collision.filter((gid) => !gid).length);
  for (let y = 0; y < map.height - 2; y++) {
    for (let x = 0; x < map.width - 2; x++) {
      assert.ok(![0, 1, 2].every((dy) => [0, 1, 2].every((dx) => isOpen(x + dx, y + dy))), `Wide area at ${x},${y}`);
    }
  }
  assert.equal(map.width, 60);
  assert.equal(map.height, 60);
});

test("six distinct spawns occupy a compact 2x3 block on one side", () => {
  const spawns = property("spawnPositions");
  assert.equal(spawns.length, 6);
  assert.equal(new Set(spawns.map((p) => p.join(","))).size, 6);
  assert.equal(Math.max(...spawns.map(([x]) => x)) - Math.min(...spawns.map(([x]) => x)), 1);
  assert.equal(Math.max(...spawns.map(([, y]) => y)) - Math.min(...spawns.map(([, y]) => y)), 2);
  assert.ok(spawns.every(([x, y]) => isOpen(x, y) && x < 10 && y < 10));
});

test("the trophy is at the far end in a two-wide terminal chamber", () => {
  const [tx, ty] = trophy;
  assert.ok(tx >= map.width - 6 && ty >= map.height - 6 && isOpen(tx, ty));
  const chamber = new Set([`${tx},${ty}`, `${tx + 1},${ty}`, `${tx},${ty + 1}`, `${tx + 1},${ty + 1}`]);
  const entrances = [];
  for (const key of chamber) {
    const [x, y] = key.split(",").map(Number);
    assert.ok(isOpen(x, y));
    for (const [dx, dy] of directions) {
      if (isOpen(x + dx, y + dy) && !chamber.has(`${x + dx},${y + dy}`)) entrances.push([dx, dy].join(","));
    }
  }
  assert.equal(entrances.length, 2);
  assert.equal(new Set(entrances).size, 1, "One entrance, two tiles wide");
  const start = property("spawnPositions")[0];
  const queue = [[...start, 0]], seen = new Set([start.join(",")]);
  let distance;
  for (let i = 0; i < queue.length; i++) {
    const [x, y, steps] = queue[i];
    if (x === tx && y === ty) { distance = steps; break; }
    for (const [dx, dy] of directions) {
      const key = `${x + dx},${y + dy}`;
      if (isOpen(x + dx, y + dy) && !seen.has(key)) {
        seen.add(key); queue.push([x + dx, y + dy, steps + 1]);
      }
    }
  }
  assert.ok(distance >= 100 && distance <= 150, `Route should avoid the previous long detour: ${distance}`);
  const boosts = property("boostPositions");
  assert.equal(new Set(boosts.map((p) => p.join(","))).size, 8);
  assert.ok(boosts.every(([x, y]) => isOpen(x, y) && (x !== tx || y !== ty)));
});

test("the maze provides many junctions while preserving two-tile channels", () => {
  let junctions = 0;
  for (let y = 3; y < map.height - 3; y += 4) {
    for (let x = 3; x < map.width - 3; x += 4) {
      const exits = directions.filter(([dx, dy]) =>
        isOpen(x + dx * 2, y + dy * 2) && isOpen(x + dx * 3, y + dy * 3));
      if (exits.length >= 3) junctions++;
    }
  }
  assert.ok(junctions >= 65, `Too few route choices: ${junctions}`);
});

test("both Tiled maps and tilesets stay synchronized with the live map", () => {
  const assets = new URL("../../client/public/assets/", import.meta.url);
  const tiled = new URL("../../tiled/", import.meta.url);
  const xml = readFileSync(new URL("map.tmx", assets), "utf8");
  assert.equal(xml, readFileSync(new URL("map.tmx", tiled), "utf8"));
  assert.deepEqual(readFileSync(new URL("map_tiles.tsx", assets)), readFileSync(new URL("map_tiles.tsx", tiled)));
  assert.deepEqual(map.tilesets, [{ firstgid: 1, source: "map_tiles.tsx" }]);
  for (const layer of map.layers) {
    const match = xml.match(new RegExp(`<layer[^>]*name="${layer.name}"[\\s\\S]*?<data encoding="csv">([\\s\\S]*?)</data>`));
    assert.ok(match, layer.name);
    assert.deepEqual(match[1].trim().split(/\s*,\s*/).map(Number), layer.data);
  }
});
