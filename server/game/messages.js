import { findPath, GRID, isBlocked } from "./map.js";

const CLICK_ARBITRATION_MS = 250;

export function registerMessageHandlers(room, maxMoveRange) {
  room.onMessage("ping", (client, time) => {
    client.send("pong", { clientTime: time, serverTime: Date.now() });
  });

  room.onMessage("latency", (client, rtt) => {
    if (!Number.isFinite(rtt) || rtt < 0 || rtt > 5000) return;
    const player = room.state.players.get(client.sessionId);
    if (!player) return;
    room.clientRtts.set(client.sessionId, rtt);
    player.ping = Math.round(rtt);
  });

  room.onMessage("selectTeam", (client, team) => {
    if (room.state.phase !== "lobby") return;
    if (!Number.isInteger(team) || team < 1 || team > 6) return;
    const taken = [...room.state.players.entries()]
      .some(([id, player]) => player.team === team && id !== client.sessionId);
    if (taken) return client.send("error", "Team already taken");
    room.state.players.get(client.sessionId).team = team;
    room.checkStart();
  });

  room.onMessage("moveTo", (client, message) => handleMoveTo(room, client, message, maxMoveRange));
}

function handleMoveTo(room, client, message, maxMoveRange) {
  if (room.state.phase !== "playing") return;
  const player = room.state.players.get(client.sessionId);
  if (!player || player.moving) return; // committed walk: can't be interrupted
  const { x, y } = message ?? {};
  if (!Number.isInteger(x) || !Number.isInteger(y)) return;
  if (x < 0 || y < 0 || x >= GRID || y >= GRID || isBlocked(x, y)) return;
  if ([...room.state.players.values()].some((other) => other !== player && other.x === x && other.y === y)) return;
  const path = findPath(player.x, player.y, x, y);
  if (!path || path.length < 2 || path.length - 1 > Math.min(player.moveRange, maxMoveRange)) return;

  const destination = `${x},${y}`;
  const now = Date.now();
  const reportedClickTime = message?.clickedAt;
  // Use the client's ping-synchronized estimate, but reject implausibly old/future values.
  const clickedAt = Number.isFinite(reportedClickTime)
    && reportedClickTime >= now - 5000 && reportedClickTime <= now + 100
    ? reportedClickTime
    : now;
  const candidate = {
    client,
    sessionId: client.sessionId,
    player,
    x,
    y,
    path,
    clickedAt,
    sequence: ++room.moveSequence,
  };

  let contest = room.destinationClaims.get(destination);
  if (contest?.status === "active") {
    // A later click can still approach the contested cell while its winner is walking.
    // The short arbitration window has already passed, so it joins as a losing contender.
    if (clickedAt < contest.winner.clickedAt) {
      return client.send("error", "La disputa por esta casilla ya está resuelta");
    }
    candidate.path = path.slice(0, -1);
    if (candidate.path.length === 0) candidate.path = [path[0]];
    contest.candidates.push(candidate);
    player.moving = true;
    room.startCandidateMove(candidate, candidate.path);
    return;
  }

  if (!contest) {
    contest = { status: "pending", candidates: [], winner: null, timer: null };
    room.destinationClaims.set(destination, contest);
    const maxRtt = Math.max(0, ...room.clients.map((client) => room.clientRtts.get(client.sessionId) ?? 0));
    const arbitrationWindow = Math.min(1500, Math.max(CLICK_ARBITRATION_MS, Math.ceil(maxRtt / 2) + 50));
    contest.timer = room.clock.setTimeout(
      () => room.resolveDestinationClaim(destination, contest),
      arbitrationWindow,
    );
  }
  contest.candidates.push(candidate);
  player.moving = true;
}
