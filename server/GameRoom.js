import { Room } from "colyseus";
import { Encoder, schema } from "@colyseus/schema";
import jwt from "jsonwebtoken";
import { parse as parseCookie } from "cookie";
import { jwtSecret } from "./utils.js";
import { BLOCKED, BOOSTS, SPAWNS, TROPHY } from "./game/map.js";
import { registerMessageHandlers } from "./game/messages.js";

// The initial snapshot includes the collision grid for the 60 x 60 map.
Encoder.BUFFER_SIZE = Math.max(Encoder.BUFFER_SIZE, 32 * 1024);

const MS_PER_TILE = 300;
const INITIAL_MOVE_RANGE = 3;
const MAX_MOVE_RANGE = 7;
const MIN_PLAYERS = process.env.COOKIE_SECURE === "production" ? 2 : 1; // for testing, allow single-player start
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS ?? 6);
const LOSS_BACKTRACK_RATIO = 0.3;

const Player = schema({
  name: "string", team: "number", x: "number", y: "number",
  moving: "boolean", moveRange: "number", ping: "number",
});
const Boost = schema({ x: "number", y: "number" });
const State = schema({
  phase: "string", blocked: "string", players: { map: Player }, boosts: { map: Boost },
  trophyX: "number", trophyY: "number", trophyAvailable: "boolean",
  winnerId: "string", winnerName: "string", maxMoveRange: "number",
});

export class GameRoom extends Room {
  maxClients = MAX_PLAYERS;

  onCreate() {
    this.setState(new State());
    this.state.phase = "lobby";
    this.state.maxMoveRange = MAX_MOVE_RANGE;
    this.state.blocked = JSON.stringify(BLOCKED);
    [this.state.trophyX, this.state.trophyY] = TROPHY;
    this.state.trophyAvailable = true;
    this.state.winnerId = "";
    this.state.winnerName = "";
    this.destinationClaims = new Map();
    this.clientRtts = new Map();
    this.moveSequence = 0;
    BOOSTS.forEach(([x, y], index) => {
      const boost = new Boost();
      boost.x = x;
      boost.y = y;
      this.state.boosts.set(String(index), boost);
    });
    registerMessageHandlers(this, MAX_MOVE_RANGE);
  }

  onAuth(client, options, request) {
    if (this.state.phase !== "lobby") throw new Error("Game already started");
    // Prefer the token passed by the client (works across origins); fall back to the cookie.
    const token = typeof options?.token === "string" && options.token
      ? options.token
      : parseCookie(request.headers.cookie ?? "").token;
    let user;
    try {
      user = jwt.verify(token, jwtSecret);
    } catch {
      throw new Error("Invalid token");
    }
    if (user.scope) throw new Error("Invalid token");
    if (user.isBanned) throw new Error("Banned account");
    if (this.clients.some((client) => client.auth?.id === user.id)) throw new Error("Already connected");
    return user;
  }

  onJoin(client, options, auth) {
    const player = new Player();
    player.name = auth.username;
    player.team = 0;
    player.x = 0;
    player.y = 0;
    player.moving = false;
    player.moveRange = INITIAL_MOVE_RANGE;
    player.ping = -1;
    this.state.players.set(client.sessionId, player);
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
      (candidate) => this.state.players.get(candidate.sessionId) === candidate.player,
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
      duration,
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
    if (this.state.phase !== "playing" || player.moveRange >= MAX_MOVE_RANGE) return;
    for (const [id, boost] of this.state.boosts) {
      if (boost.x !== x || boost.y !== y) continue;
      this.state.boosts.delete(id);
      player.moveRange = Math.min(player.moveRange + 1, MAX_MOVE_RANGE);
      return;
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
    this.state.players.forEach((player) => {
      player.moving = false;
    });
    winner.x = x;
    winner.y = y;
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
        Math.max(0, Math.floor((impactTime - loser.startTime) / MS_PER_TILE)),
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
    if (players.length >= MIN_PLAYERS && players.every((player) => player.team > 0)) {
      players.forEach((player) => {
        [player.x, player.y] = SPAWNS[player.team - 1];
      });
      this.state.phase = "playing";
      this.lock();
    }
  }
}
