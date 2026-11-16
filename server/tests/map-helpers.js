import { readFileSync } from "node:fs";

export const map = JSON.parse(readFileSync(new URL("../../client/public/assets/map.tmj", import.meta.url), "utf8"));
export const collision = map.layers.find((layer) => layer.name === "collision").data;
export const property = (name) => JSON.parse(map.properties.find((p) => p.name === name).value);
export const trophy = property("trophyPosition");
export const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const isOpen = (x, y) => x >= 0 && y >= 0 && x < map.width && y < map.height && !collision[y * map.width + x];

// busca un tramo recto de dos casillas de ancho
export const straight = (() => {
  for (let y = 0; y < map.height - 1; y++) {
    for (let x = 0; x < map.width - 5; x++) {
      if ([0, 1].every((dy) => [0, 1, 2, 3, 4, 5].every((dx) => isOpen(x + dx, y + dy))) &&
          !(trophy[0] >= x && trophy[0] <= x + 5 && trophy[1] >= y && trophy[1] <= y + 1)) return { x, y };
    }
  }
  throw new Error("Map needs a two-wide straight stretch for movement tests");
})();

export const trophyNeighbors = directions.map(([dx, dy]) => [trophy[0] + dx, trophy[1] + dy])
  .filter(([x, y]) => isOpen(x, y));
export const trophyCrossing = (() => {
  const [tx, ty] = trophy;
  for (const [dx, dy] of directions) {
    if ([-2, -1, 0, 1].every((step) => isOpen(tx + step * dx, ty + step * dy))) {
      return { start: [tx - 2 * dx, ty - 2 * dy], beyond: { x: tx + dx, y: ty + dy } };
    }
  }
  throw new Error("Map needs a path crossing the trophy tile");
})();
