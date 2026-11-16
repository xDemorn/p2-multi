import { BLOCKED, BOOSTS, SPAWNS, TROPHY, findPath, GRID, isBlocked } from "./game/map.js";

const MS_PER_TILE = 300;
const INITIAL_MOVE_RANGE = 3;
const MAX_MOVE_RANGE = 7;
const MIN_PLAYERS = process.env.COOKIE_SECURE === "production" ? 2 : 1; // en local se puede probar solo
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS ?? 6);
const LOSS_BACKTRACK_RATIO = 0.3;
// margen para decidir quién hizo clic antes (se amplía con el ping)
export const CLICK_ARBITRATION_MS = 100;
// si un jugador deja de consultar durante 15 s, se le echa
const PLAYER_TIMEOUT = 15000;
const MAX_EVENTS = 200;

export class GameRoom {
  static onWin = () => {}; // index.js lo cambia por addTrophy

  constructor(roomId, { maxPlayers = MAX_PLAYERS, clock } = {}) {
    this.roomId = roomId;
    this.maxPlayers = maxPlayers;
    this.clock = clock ?? {
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (timer) => clearTimeout(timer),
    };
    this.sessions = new Map();
    this.destinationClaims = new Map();
    this.eventSequence = 0;
    this.moveSequence = 0;
    this.state = {
      phase: "lobby",
      blocked: JSON.stringify(BLOCKED),
      players: new Map(),
      boosts: new Map(BOOSTS.map(([x, y], index) => [String(index), { x, y }])),
      trophyX: TROPHY[0],
      trophyY: TROPHY[1],
      trophyAvailable: true,
      winnerId: "",
      winnerName: "",
      maxMoveRange: MAX_MOVE_RANGE,
    };
  }

  get locked() {
    return this.state.phase !== "lobby";
  }

  join(user) {
    const id = String(user.id);
    const existing = this.sessions.get(id);
    if (existing) {
      existing.lastSeen = Date.now();
      return id;
    }
    this.state.players.set(id, {
      name: user.username, team: 0, x: 0, y: 0,
      moving: false, moveRange: INITIAL_MOVE_RANGE, ping: -1,
    });
    this.sessions.set(id, { lastSeen: Date.now(), events: [] });
    return id;
  }

  leave(playerId) {
    const id = String(playerId);
    if (!this.sessions.has(id)) return;
    for (const [destination, contest] of [...this.destinationClaims]) {
      for (const candidate of contest.candidates) {
        if (candidate.playerId === id) this.stopCandidatePickups(candidate);
      }
      contest.candidates = contest.candidates.filter((candidate) => candidate.playerId !== id);
      if (contest.winner?.playerId === id) {
        this.cancelDestinationContest(destination, contest);
      } else if (contest.status === "pending" && contest.candidates.length === 0) {
        this.clearScheduledTimer(contest.timer);
        this.destinationClaims.delete(destination);
      }
    }
    this.sessions.delete(id);
    this.state.players.delete(id);
    this.checkStart();
  }

  sweep(timeout = PLAYER_TIMEOUT) {
    const deadline = Date.now() - timeout;
    for (const [id, session] of [...this.sessions]) {
      if (session.lastSeen < deadline) this.leave(id);
    }
  }

  send(playerId, type, data = {}) {
    const session = this.sessions.get(String(playerId));
    if (!session) return;
    session.events.push({ seq: ++this.eventSequence, type, ...data });
    if (session.events.length > MAX_EVENTS) session.events.splice(0, session.events.length - MAX_EVENTS);
  }

  broadcast(type, data = {}) {
    for (const id of this.sessions.keys()) this.send(id, type, data);
  }

  snapshot(playerId, since = 0) {
    const session = this.sessions.get(String(playerId));
    if (!session) return null;
    session.lastSeen = Date.now();
    session.events = session.events.filter((event) => event.seq > since);
    const { players, boosts, blocked, ...rest } = this.state;
    return {
      state: {
        ...rest,
        players: Object.fromEntries(players),
        boosts: Object.fromEntries(boosts),
        ...(since === 0 ? { blocked } : {}), // los muros solo se mandan la primera vez
      },
      events: session.events,
      cursor: this.eventSequence,
      serverTime: Date.now(),
    };
  }

  selectTeam(playerId, team) {
    if (this.state.phase !== "lobby") return;
    if (!Number.isInteger(team) || team < 1 || team > 6) return;
    const id = String(playerId);
    const player = this.state.players.get(id);
    if (!player) return;
    const taken = [...this.state.players.entries()]
      .some(([otherId, other]) => other.team === team && otherId !== id);
    if (taken) return this.send(id, "error", { message: "Team already taken" });
    player.team = team;
    this.checkStart();
  }

  setLatency(playerId, rtt) {
    if (!Number.isFinite(rtt) || rtt < 0 || rtt > 5000) return;
    const player = this.state.players.get(String(playerId));
    if (!player) return;
    player.ping = Math.round(rtt);
  }

  moveTo(playerId, message) {
    if (this.state.phase !== "playing") return;
    const id = String(playerId);
    const player = this.state.players.get(id);
    if (!player || player.moving) return; // no se puede cambiar el destino a medio camino
    const { x, y } = message ?? {};
    if (!Number.isInteger(x) || !Number.isInteger(y)) return;
    if (x < 0 || y < 0 || x >= GRID || y >= GRID || isBlocked(x, y)) return;
    if ([...this.state.players.values()].some((other) => other !== player && other.x === x && other.y === y)) return;
    const path = findPath(player.x, player.y, x, y);
    if (!path || path.length < 2 || path.length - 1 > Math.min(player.moveRange, MAX_MOVE_RANGE)) return;

    const destination = `${x},${y}`;
    const now = Date.now();
    const reportedClickTime = message?.clickedAt;
    // usamos la hora del clic que manda el cliente, si es razonable
    const clickedAt = Number.isFinite(reportedClickTime)
      && reportedClickTime >= now - 5000 && reportedClickTime <= now + 100
      ? reportedClickTime
      : now;
    const candidate = {
      playerId: id,
      player,
      x,
      y,
      path,
      clickedAt,
      sequence: ++this.moveSequence,
    };

    let contest = this.destinationClaims.get(destination);
    if (contest?.status === "active") {
      // si la disputa ya se resolvió, este clic llega tarde y pierde
      if (clickedAt < contest.winner.clickedAt) {
        return this.send(id, "error", { message: "La disputa por esta casilla ya está resuelta" });
      }
      candidate.path = path.slice(0, -1);
      if (candidate.path.length === 0) candidate.path = [path[0]];
      contest.candidates.push(candidate);
      player.moving = true;
      this.startCandidateMove(candidate, candidate.path);
      return;
    }

    if (!contest) {
      contest = { status: "pending", candidates: [], winner: null, timer: null };
      this.destinationClaims.set(destination, contest);
      const maxRtt = Math.max(0, ...[...this.state.players.values()].map((other) => other.ping ?? 0));
      const arbitrationWindow = Math.min(1500, Math.max(CLICK_ARBITRATION_MS, Math.ceil(maxRtt / 2) + 50));
      contest.timer = this.clock.setTimeout(
        () => this.resolveDestinationClaim(destination, contest),
        arbitrationWindow,
      );
    }
    contest.candidates.push(candidate);
    player.moving = true;
  }

  resolveDestinationClaim(destination, contest) {
    if (this.state.phase !== "playing") return;
    if (this.destinationClaims.get(destination) !== contest) return;
    contest.candidates = contest.candidates.filter(
      (candidate) => this.state.players.get(candidate.playerId) === candidate.player,
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
        // los que pierden se paran una casilla antes
        candidate.path = candidate.path.slice(0, -1);
        if (candidate.path.length === 0) candidate.path = [{ x: candidate.player.x, y: candidate.player.y }];
        candidate.player.moving = true;
      }
    }

    const winner = contest.winner;
    const duration = (winner.path.length - 1) * MS_PER_TILE;
    // primero se resuelve el duelo y después la llegada (y la copa)
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
      if (this.state.phase !== "playing" || this.state.players.get(candidate.playerId) !== candidate.player) return;
      this.collectBoost(candidate.player, tile.x, tile.y);
      if (this.state.trophyAvailable && tile.x === this.state.trophyX && tile.y === this.state.trophyY) {
        this.finishGame(candidate.playerId, tile.x, tile.y);
      }
    }, (index + 1) * MS_PER_TILE));
    this.broadcast("move", {
      id: candidate.playerId,
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

  finishGame(playerId, x, y) {
    if (this.state.phase !== "playing" || !this.state.trophyAvailable) return;
    const player = this.state.players.get(String(playerId));
    if (!player || x !== this.state.trophyX || y !== this.state.trophyY) return;
    this.state.phase = "finished";
    this.state.trophyAvailable = false;
    this.state.winnerId = String(playerId);
    this.state.winnerName = player.name;
    try {
      GameRoom.onWin(String(playerId));
    } catch (error) {
      console.error("Could not record the trophy:", error);
    }
    for (const [destination, contest] of [...this.destinationClaims]) {
      this.cancelDestinationContest(destination, contest);
    }
    this.state.players.forEach((other) => {
      other.moving = false;
    });
    player.x = x;
    player.y = y;
  }

  clearScheduledTimer(timer) {
    if (timer !== undefined && timer !== null) this.clock.clearTimeout(timer);
  }

  stopCandidatePickups(candidate) {
    for (const timer of candidate.pickupTimers ?? []) this.clearScheduledTimer(timer);
    candidate.pickupTimers = [];
  }

  finishDestinationContest(destination, contest) {
    if (this.state.phase !== "playing") return;
    if (this.destinationClaims.get(destination) !== contest) return;
    const winner = contest.winner;
    if (!winner || this.state.players.get(winner.playerId) !== winner.player) {
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
      if (loser === winner || this.state.players.get(loser.playerId) !== loser.player) continue;
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
        winnerId: winner.playerId,
        x: winner.x,
        y: winner.y,
        loserIds: rollbackPlans.map(({ loser }) => loser.playerId),
        startTime: impactTime,
        duration: 900,
      });
    }

    for (const { loser, rollbackPath, finalTile } of rollbackPlans) {
      this.broadcast("move", {
        id: loser.playerId,
        path: rollbackPath.length ? rollbackPath : [finalTile],
        startTime: impactTime,
        msPerTile: MS_PER_TILE,
      });

      this.clock.setTimeout(() => {
        if (this.state.phase !== "playing" || this.state.players.get(loser.playerId) !== loser.player) return;
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
      if (this.state.players.get(candidate.playerId) !== candidate.player) continue;
      const elapsed = candidate.startTime ? Date.now() - candidate.startTime : 0;
      const step = Math.min(candidate.path.length - 1, Math.max(0, Math.floor(elapsed / MS_PER_TILE)));
      const tile = candidate.path[step] ?? { x: candidate.player.x, y: candidate.player.y };
      candidate.player.x = tile.x;
      candidate.player.y = tile.y;
      candidate.player.moving = false;
      this.broadcast("move", {
        id: candidate.playerId,
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
    }
  }
}
