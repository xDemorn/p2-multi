import { Room } from "colyseus";
import { Encoder, schema } from "@colyseus/schema";
import jwt from "jsonwebtoken";
import fs from "fs";
import { parse as parseCookie } from "cookie";
import { jwtSecret } from "./utils.js";

// The initial snapshot includes the collision grid for the 60 x 60 map.
Encoder.BUFFER_SIZE = Math.max(Encoder.BUFFER_SIZE, 32 * 1024);

const mapPath = process.env.MAP_PATH || new URL("../client/public/assets/map.tmj", import.meta.url);
const mapData = JSON.parse(fs.readFileSync(mapPath, "utf8"));
const GRID = mapData.width;
const MS_PER_TILE = 300;
const MAX_MOVE_TILES = 3;
const MIN_PLAYERS = process.env.COOKIE_SECURE === 'production' ? 2 : 1; // for testing, allow single-player start
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS ?? 6);
const CLICK_ARBITRATION_MS = 250;
const LOSS_BACKTRACK_RATIO = 0.3;
const BLOCKED = [];
const SPAWNS = JSON.parse(mapData.properties?.find((p) => p.name === "spawnPositions")?.value
  ?? "[[0,0],[9,0],[0,9],[9,9],[4,0],[5,9]]");
const TROPHY = JSON.parse(mapData.properties?.find((p) => p.name === "trophyPosition")?.value ?? "[30,30]");

mapData.layers.find((l) => l.name === "collision")?.data.forEach((gid, i) => {
  if (gid) BLOCKED.push([i % GRID, Math.floor(i / GRID)]);
});

const Player = schema({ name: "string", team: "number", x: "number", y: "number", moving: "boolean", moveRange: "number", ping: "number" });
const Boost = schema({ x: "number", y: "number" });
const State = schema({ phase: "string", blocked: "string", players: { map: Player }, boosts: { map: Boost },
  trophyX: "number", trophyY: "number", trophyAvailable: "boolean", winnerId: "string", winnerName: "string" });

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
  maxClients = MAX_PLAYERS;

  onCreate() {
    this.setState(new State());
    this.state.phase = "lobby";
    this.state.blocked = JSON.stringify(BLOCKED);
    [this.state.trophyX, this.state.trophyY] = TROPHY;
    this.state.trophyAvailable = true;
    this.state.winnerId = "";
    this.state.winnerName = "";
    this.destinationClaims = new Map();
    this.clientRtts = new Map();
    this.moveSequence = 0;
    const boosts = JSON.parse(mapData.properties?.find((p) => p.name === "boostPositions")?.value ?? "[]");
    boosts.forEach(([x, y], index) => {
      const boost = new Boost();
      boost.x = x; boost.y = y;
      this.state.boosts.set(String(index), boost);
    });

    this.onMessage("ping", (client, t) => client.send("pong", { clientTime: t, serverTime: Date.now() }));
    this.onMessage("latency", (client, rtt) => {
      if (Number.isFinite(rtt) && rtt >= 0 && rtt <= 5000) {
        const player = this.state.players.get(client.sessionId);
        if (!player) return;
        this.clientRtts.set(client.sessionId, rtt);
        player.ping = Math.round(rtt);
      }
    });

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
      if (!path || path.length < 2 || path.length - 1 > p.moveRange) return;

      const destination = `${x},${y}`;
      const now = Date.now();
      const reportedClickTime = msg?.clickedAt;
      // Use the client's ping-synchronized estimate, but reject implausibly old/future values.
      const clickedAt = Number.isFinite(reportedClickTime) &&
        reportedClickTime >= now - 5000 && reportedClickTime <= now + 100
        ? reportedClickTime
        : now;
      const candidate = {
        client,
        sessionId: client.sessionId,
        player: p,
        x,
        y,
        path,
        clickedAt,
        sequence: ++this.moveSequence,
      };

      let contest = this.destinationClaims.get(destination);
      if (contest?.status === "active") {
        // A later click can still approach the contested cell while its winner is walking.
        // The short arbitration window has already passed, so it joins as a losing contender.
        if (clickedAt < contest.winner.clickedAt) {
          return client.send("error", "La disputa por esta casilla ya está resuelta");
        }
        candidate.path = path.slice(0, -1);
        if (candidate.path.length === 0) candidate.path = [path[0]];
        contest.candidates.push(candidate);
        p.moving = true;
        this.startCandidateMove(candidate, candidate.path);
        return;
      }

      if (!contest) {
        contest = { status: "pending", candidates: [], winner: null, timer: null };
        this.destinationClaims.set(destination, contest);
        const maxRtt = Math.max(0, ...this.clients.map((c) => this.clientRtts.get(c.sessionId) ?? 0));
        const arbitrationWindow = Math.min(1500, Math.max(CLICK_ARBITRATION_MS, Math.ceil(maxRtt / 2) + 50));
        contest.timer = this.clock.setTimeout(
          () => this.resolveDestinationClaim(destination, contest),
          arbitrationWindow
        );
      }
      contest.candidates.push(candidate);
      p.moving = true;
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
    p.moveRange = MAX_MOVE_TILES;
    p.ping = -1;
    this.state.players.set(client.sessionId, p);
  }

  onLeave(client) {
    for (const [destination, contest] of this.destinationClaims) {
      for (const candidate of contest.candidates) {
        if (candidate.sessionId === client.sessionId) this.stopCandidatePickups(candidate);
      }
      contest.candidates = contest.candidates.filter((candidate) => candidate.sessionId !== client.sessionId);
      if (contest.winner?.sessionId === client.sessionId) {
        this.cancelDestinationContest(destination, contest);
      } else if (contest.status === "pending" && contest.candidates.length === 0) {
        this.clearScheduledTimer(contest.timer);
        this.destinationClaims.delete(destination);
      }
    }
    this.clientRtts.delete(client.sessionId);
    this.state.players.delete(client.sessionId); // frees the team automatically
    this.checkStart();
  }

  resolveDestinationClaim(destination, contest) {
    if (this.state.phase !== "playing") return;
    if (this.destinationClaims.get(destination) !== contest) return;
    contest.candidates = contest.candidates.filter(
      (candidate) => this.state.players.get(candidate.sessionId) === candidate.player
    );
    if (contest.candidates.length === 0) {
      this.destinationClaims.delete(destination);
      return;
    }

    contest.candidates.sort((a, b) => a.clickedAt - b.clickedAt || a.sequence - b.sequence);
    contest.winner = contest.candidates[0];
    contest.status = "active";

    for (const candidate of contest.candidates) {
      if (candidate === contest.winner) {
        candidate.player.moving = true;
      } else {
        // Losers walk as far as the tile before the contested destination.
        candidate.path = candidate.path.slice(0, -1);
        if (candidate.path.length === 0) candidate.path = [{ x: candidate.player.x, y: candidate.player.y }];
        candidate.player.moving = true;
      }
    }

    const winner = contest.winner;
    const duration = (winner.path.length - 1) * MS_PER_TILE;
    // Resolve the contest before the winner's arrival callbacks (including the trophy pickup)
    // so every client can show the same impact before any round-ending state change.
    contest.timer = this.clock.setTimeout(
      () => this.finishDestinationContest(destination, contest),
      duration
    );
    for (const candidate of contest.candidates) this.startCandidateMove(candidate, candidate.path);
  }

  startCandidateMove(candidate, path) {
    candidate.path = path;
    candidate.startTime = Date.now();
    candidate.pickupTimers = path.slice(1).map((tile, index) => this.clock.setTimeout(() => {
      if (this.state.phase !== "playing" || this.state.players.get(candidate.sessionId) !== candidate.player) return;
      this.collectBoost(candidate.player, tile.x, tile.y);
      if (this.state.trophyAvailable && tile.x === this.state.trophyX && tile.y === this.state.trophyY) {
        this.finishGame(candidate.sessionId, tile.x, tile.y);
      }
    }, (index + 1) * MS_PER_TILE));
    this.broadcast("move", {
      id: candidate.sessionId,
      path,
      startTime: candidate.startTime,
      msPerTile: MS_PER_TILE,
    });
  }

  collectBoost(player, x, y) {
    if (this.state.phase !== "playing") return;
    for (const [id, boost] of this.state.boosts) {
      if (boost.x !== x || boost.y !== y) continue;
      this.state.boosts.delete(id);
      player.moveRange += 1;
    }
  }

  finishGame(sessionId, x, y) {
    if (this.state.phase !== "playing" || !this.state.trophyAvailable) return;
    const winner = this.state.players.get(sessionId);
    if (!winner || x !== this.state.trophyX || y !== this.state.trophyY) return;
    this.state.phase = "finished";
    this.state.trophyAvailable = false;
    this.state.winnerId = sessionId;
    this.state.winnerName = winner.name;
    for (const [destination, contest] of [...this.destinationClaims]) {
      this.cancelDestinationContest(destination, contest);
    }
    this.state.players.forEach((player) => { player.moving = false; });
    winner.x = x; winner.y = y;
  }

  clearScheduledTimer(timer) {
    if (typeof timer?.clear === "function") timer.clear();
    else if (typeof this.clock.clearTimeout === "function") this.clock.clearTimeout(timer);
  }

  stopCandidatePickups(candidate) {
    for (const timer of candidate.pickupTimers ?? []) this.clearScheduledTimer(timer);
    candidate.pickupTimers = [];
  }

  finishDestinationContest(destination, contest) {
    if (this.state.phase !== "playing") return;
    if (this.destinationClaims.get(destination) !== contest) return;
    const winner = contest.winner;
    if (!winner || this.state.players.get(winner.sessionId) !== winner.player) {
      this.cancelDestinationContest(destination, contest);
      return;
    }

    winner.player.x = winner.x;
    winner.player.y = winner.y;
    winner.player.moving = false;
    this.destinationClaims.delete(destination);

    const impactTime = Date.now();
    const rollbackPlans = [];
    for (const loser of contest.candidates) {
      if (loser === winner || this.state.players.get(loser.sessionId) !== loser.player) continue;
      this.stopCandidatePickups(loser);

      const steps = Math.min(
        loser.path.length - 1,
        Math.max(0, Math.floor((impactTime - loser.startTime) / MS_PER_TILE))
      );
      const current = loser.path[steps];
      loser.player.x = current.x;
      loser.player.y = current.y;

      const backtrack = steps === 0
        ? 0
        : Math.min(steps, Math.max(1, Math.round(steps * LOSS_BACKTRACK_RATIO)));
      const rollbackPath = loser.path.slice(steps - backtrack, steps + 1).reverse();
      const finalTile = rollbackPath[rollbackPath.length - 1] ?? current;
      rollbackPlans.push({ loser, rollbackPath, finalTile });
    }

    if (rollbackPlans.length > 0) {
      this.broadcast("duel", {
        winnerId: winner.sessionId,
        x: winner.x,
        y: winner.y,
        loserIds: rollbackPlans.map(({ loser }) => loser.sessionId),
        startTime: impactTime,
        duration: 900,
      });
    }

    for (const { loser, rollbackPath, finalTile } of rollbackPlans) {
      this.broadcast("move", {
        id: loser.sessionId,
        path: rollbackPath.length ? rollbackPath : [finalTile],
        startTime: impactTime,
        msPerTile: MS_PER_TILE,
      });

      this.clock.setTimeout(() => {
        if (this.state.phase !== "playing" || this.state.players.get(loser.sessionId) !== loser.player) return;
        loser.player.x = finalTile.x;
        loser.player.y = finalTile.y;
        loser.player.moving = false;
      }, Math.max(0, rollbackPath.length - 1) * MS_PER_TILE);
    }
  }

  cancelDestinationContest(destination, contest) {
    this.clearScheduledTimer(contest.timer);
    this.destinationClaims.delete(destination);
    for (const candidate of contest.candidates) {
      this.stopCandidatePickups(candidate);
      if (this.state.players.get(candidate.sessionId) !== candidate.player) continue;
      const elapsed = candidate.startTime ? Date.now() - candidate.startTime : 0;
      const step = Math.min(candidate.path.length - 1, Math.max(0, Math.floor(elapsed / MS_PER_TILE)));
      const tile = candidate.path[step] ?? { x: candidate.player.x, y: candidate.player.y };
      candidate.player.x = tile.x;
      candidate.player.y = tile.y;
      candidate.player.moving = false;
      this.broadcast("move", {
        id: candidate.sessionId,
        path: [tile],
        startTime: Date.now(),
        msPerTile: MS_PER_TILE,
      });
    }
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
