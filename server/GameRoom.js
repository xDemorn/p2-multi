import { Room } from "colyseus";
import { schema } from "@colyseus/schema";
import jwt from "jsonwebtoken";
import fs from "fs";
import { parse as parseCookie } from "cookie";
import { jwtSecret } from "./utils.js";

const mapPath = process.env.MAP_PATH || new URL("../client/public/assets/map.tmj", import.meta.url);
const mapData = JSON.parse(fs.readFileSync(mapPath, "utf8"));
const GRID = mapData.width;
const MS_PER_TILE = 300;
const MIN_PLAYERS = 1;
const BLOCKED = [];
const SPAWNS = [[0, 0], [9, 0], [0, 9], [9, 9], [4, 0], [5, 9]];

mapData.layers.find((l) => l.name === "collision")?.data.forEach((gid, i) => {
  if (gid) BLOCKED.push([i % GRID, Math.floor(i / GRID)]);
});

const Player = schema({ name: "string", team: "number", x: "number", y: "number", moving: "boolean" });
const State = schema({ phase: "string", blocked: "string", players: { map: Player } });

const isBlocked = (x, y) => BLOCKED.some(([bx, by]) => bx === x && by === y);

// Breadth-first search on a 4-direction grid. Returns [{x,y}, ...] including the start tile.
function findPath(sx, sy, tx, ty) {
  const key = (x, y) => y * GRID + x;
  const prev = new Map([[key(sx, sy), null]]);
  const queue = [[sx, sy]];
  while (queue.length) {
    const [x, y] = queue.shift();
    if (x === tx && y === ty) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
      if (isBlocked(nx, ny) || prev.has(key(nx, ny))) continue;
      prev.set(key(nx, ny), [x, y]);
      queue.push([nx, ny]);
    }
  }
  if (!prev.has(key(tx, ty))) return null;
  const path = [];
  for (let c = [tx, ty]; c; c = prev.get(key(c[0], c[1]))) path.unshift({ x: c[0], y: c[1] });
  return path;
}

export class GameRoom extends Room {
  maxClients = 6;

  onCreate() {
    this.setState(new State());
    this.state.phase = "lobby";
    this.state.blocked = JSON.stringify(BLOCKED);

    this.onMessage("ping", (client, t) => client.send("pong", { clientTime: t, serverTime: Date.now() }));

    this.onMessage("selectTeam", (client, team) => {
      if (this.state.phase !== "lobby") return;
      if (!Number.isInteger(team) || team < 1 || team > 6) return;
      const taken = [...this.state.players.entries()].some(([id, p]) => p.team === team && id !== client.sessionId);
      if (taken) return client.send("error", "Team already taken");
      this.state.players.get(client.sessionId).team = team;
      this.checkStart();
    });

    this.onMessage("moveTo", (client, msg) => {
      if (this.state.phase !== "playing") return;
      const p = this.state.players.get(client.sessionId);
      if (!p || p.moving) return; // committed walk: can't be interrupted
      const { x, y } = msg ?? {};
      if (!Number.isInteger(x) || !Number.isInteger(y)) return;
      if (x < 0 || y < 0 || x >= GRID || y >= GRID || isBlocked(x, y)) return;
      if ([...this.state.players.values()].some((o) => o !== p && o.x === x && o.y === y)) return;
      const path = findPath(p.x, p.y, x, y);
      if (!path || path.length < 2) return;

      p.moving = true;
      this.broadcast("move", { id: client.sessionId, path, startTime: Date.now(), msPerTile: MS_PER_TILE });
      this.clock.setTimeout(() => {
        p.x = x; p.y = y; p.moving = false;
      }, (path.length - 1) * MS_PER_TILE);
    });
  }

  onAuth(client, options, request) {
    if (this.state.phase !== "lobby") throw new Error("Game already started");
    // Prefer the token passed by the client (works across origins); fall back to the cookie.
    const token = typeof options?.token === "string" && options.token
      ? options.token
      : parseCookie(request.headers.cookie ?? "").token;
    let user;
    try { user = jwt.verify(token, jwtSecret); }
    catch { throw new Error("Invalid token"); }
    if (this.clients.some((c) => c.auth?.id === user.id)) throw new Error("Already connected");
    return user;
  }

  onJoin(client, options, auth) {
    const p = new Player();
    p.name = auth.username; p.team = 0; p.x = 0; p.y = 0; p.moving = false;
    this.state.players.set(client.sessionId, p);
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId); // frees the team automatically
    this.checkStart();
  }

  checkStart() {
    if (this.state.phase !== "lobby") return;
    const players = [...this.state.players.values()];
    if (players.length >= MIN_PLAYERS && players.every((p) => p.team > 0)) {
      players.forEach((p) => { [p.x, p.y] = SPAWNS[p.team - 1]; });
      this.state.phase = "playing";
      this.lock();
    }
  }
}
