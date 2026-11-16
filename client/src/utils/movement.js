// BFS en 4 direcciones, incluye la casilla inicial
export function findPath(sx, sy, tx, ty, gridSize, blockedTiles) {
  const key = (x, y) => y * gridSize + x;
  const start = key(sx, sy);
  const target = key(tx, ty);
  const previous = new Map([[start, null]]);
  const queue = [[sx, sy]];

  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    if (key(x, y) === target) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      const next = key(nx, ny);
      if (nx < 0 || ny < 0 || nx >= gridSize || ny >= gridSize) continue;
      if (blockedTiles.has(next) || previous.has(next)) continue;
      previous.set(next, [x, y]);
      queue.push([nx, ny]);
    }
  }

  if (!previous.has(target)) return null;
  const path = [];
  for (let tile = [tx, ty]; tile; tile = previous.get(key(tile[0], tile[1]))) {
    path.unshift({ x: tile[0], y: tile[1] });
  }
  return path;
}

export function findReachableTiles(sx, sy, maxSteps, gridSize, blockedTiles) {
  const key = (x, y) => y * gridSize + x;
  const distances = new Map([[key(sx, sy), 0]]);
  const queue = [[sx, sy]];

  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    const steps = distances.get(key(x, y));
    if (steps >= maxSteps) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, next = key(nx, ny);
      if (nx < 0 || ny < 0 || nx >= gridSize || ny >= gridSize
        || blockedTiles.has(next) || distances.has(next)) continue;
      distances.set(next, steps + 1);
      queue.push([nx, ny]);
    }
  }

  return queue.slice(1).map(([x, y]) => ({ x, y }));
}
