import fs from "node:fs";

const mapPath = process.env.MAP_PATH || new URL("../../client/public/assets/map.tmj", import.meta.url);
const mapData = JSON.parse(fs.readFileSync(mapPath, "utf8"));

export const GRID = mapData.width;
export const BLOCKED = [];
export const SPAWNS = JSON.parse(mapData.properties?.find((property) => property.name === "spawnPositions")?.value
  ?? "[[0,0],[9,0],[0,9],[9,9],[4,0],[5,9]]");
export const TROPHY = JSON.parse(mapData.properties?.find((property) => property.name === "trophyPosition")?.value ?? "[30,30]");
export const BOOSTS = JSON.parse(mapData.properties?.find((property) => property.name === "boostPositions")?.value ?? "[]");

mapData.layers.find((layer) => layer.name === "collision")?.data.forEach((gid, index) => {
  if (gid) BLOCKED.push([index % GRID, Math.floor(index / GRID)]);
});

export const isBlocked = (x, y) => BLOCKED.some(([blockedX, blockedY]) => blockedX === x && blockedY === y);

// BFS en 4 direcciones; el camino incluye la casilla inicial
export function findPath(sx, sy, tx, ty) {
  const key = (x, y) => y * GRID + x;
  const previous = new Map([[key(sx, sy), null]]);
  const queue = [[sx, sy]];
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    if (x === tx && y === ty) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
      if (isBlocked(nx, ny) || previous.has(key(nx, ny))) continue;
      previous.set(key(nx, ny), [x, y]);
      queue.push([nx, ny]);
    }
  }
  if (!previous.has(key(tx, ty))) return null;
  const path = [];
  for (let tile = [tx, ty]; tile; tile = previous.get(key(tile[0], tile[1]))) {
    path.unshift({ x: tile[0], y: tile[1] });
  }
  return path;
}
