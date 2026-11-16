import test from "node:test";
import assert from "node:assert/strict";
import { GameRoom, CLICK_ARBITRATION_MS } from "../GameRoom.js";
import { straight, trophy, trophyNeighbors, trophyCrossing, property, directions, isOpen } from "./map-helpers.js";

const { x: X, y: Y } = straight;

function harness() {
  let now = 0, sequence = 0;
  const timers = new Map();
  const clock = {
    setTimeout(callback, delay) {
      const id = ++sequence;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      const until = now + ms;
      while (true) {
        const next = [...timers].filter(([, t]) => t.at <= until)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        timers.delete(next[0]); now = next[1].at; next[1].callback();
      }
      now = until;
    },
  };
  const room = new GameRoom("test", { clock });
  room.state.phase = "playing";
  function addPlayer(id, x, y) {
    room.join({ id, username: id });
    const player = room.state.players.get(id);
    player.x = x; player.y = y;
    return { client: id, player };
  }
  function boostAt(x, y) {
    const boost = room.state.boosts.values().next().value;
    assert.ok(boost, "Map provides boost instances");
    room.state.boosts.clear(); boost.x = x; boost.y = y;
    room.state.boosts.set("test", boost);
  }
  return {
    room, clock, addPlayer, boostAt,
    move: (client, message) => room.moveTo(client, message),
    latency: (client, rtt) => room.setLatency(client, rtt),
  };
}

test("starting a six-player room puts all teams at the grouped map spawns", () => {
  const h = harness();
  h.room.state.phase = "lobby";
  const players = Array.from({ length: 6 }, (_, i) => h.addPlayer(`team${i + 1}`, 0, 0).player);
  players.forEach((player, i) => { player.team = i + 1; });
  h.room.checkStart();
  assert.equal(h.room.state.phase, "playing");
  assert.deepEqual(players.map((player) => [player.x, player.y]), property("spawnPositions"));
});

test("nearby starting players can contest the same free tile with their initial range", () => {
  const h = harness();
  const spawns = property("spawnPositions");
  const a = h.addPlayer("first", ...spawns[0]), b = h.addPlayer("second", ...spawns[1]);
  const target = { x: spawns[0][0], y: spawns[0][1] + 1 };
  h.move(a.client, { ...target, clickedAt: Date.now() - 100 });
  h.move(b.client, { ...target, clickedAt: Date.now() - 50 });
  assert.equal(h.room.destinationClaims.get(`${target.x},${target.y}`).candidates.length, 2);
  h.clock.advance(1150);
  assert.deepEqual([a.player.x, a.player.y], [target.x, target.y]);
  assert.notDeepEqual([b.player.x, b.player.y], [target.x, target.y]);
});

test("base range is three; a collected boost allows four, but not five", () => {
  const h = harness();
  const { client, player } = h.addPlayer("one", X, Y);
  assert.equal(player.moveRange, 3);
  h.move(client, { x: X + 4, y: Y });
  assert.equal(h.room.destinationClaims.size, 0);
  h.boostAt(X, Y);
  h.room.collectBoost(player, X, Y);
  assert.equal(player.moveRange, 4);
  h.move(client, { x: X + 5, y: Y });
  assert.equal(h.room.destinationClaims.size, 0);
  h.move(client, { x: X + 4, y: Y });
  assert.equal(h.room.destinationClaims.get(`${X + 4},${Y}`).candidates[0].path.length, 5);
});

test("player ping is synchronized independently and rejects invalid measurements", () => {
  const h = harness();
  const a = h.addPlayer("one", X, Y), b = h.addPlayer("two", X + 3, Y + 1);
  assert.equal(a.player.ping, -1);
  h.latency(a.client, 42.4);
  h.latency(b.client, 175);
  assert.equal(a.player.ping, 42);
  assert.equal(b.player.ping, 175);
  for (const value of [-1, 5001, NaN, Infinity, "20"]) h.latency(a.client, value);
  assert.equal(a.player.ping, 42);
  h.latency("unknown", 20);
  assert.equal(h.room.state.players.has("unknown"), false);
  h.room.leave(a.client);
  assert.equal(h.room.state.players.has("one"), false);
});

test("boosts stop at seven and a capped player leaves pickups for another player", () => {
  const h = harness();
  const capped = h.addPlayer("capped", X, Y).player;
  const other = h.addPlayer("other", X, Y + 1).player;
  assert.equal(h.room.state.maxMoveRange, 7);
  const pickups = [...h.room.state.boosts.values()];
  h.room.state.boosts.clear();
  function putBoost(x, y) {
    const boost = pickups.pop();
    boost.x = x; boost.y = y;
    h.room.state.boosts.set(`boost${pickups.length}`, boost);
  }
  for (let range = 4; range <= 7; range++) {
    putBoost(X, Y);
    h.room.collectBoost(capped, X, Y);
    assert.equal(capped.moveRange, range);
    assert.equal(h.room.state.boosts.size, 0);
  }
  putBoost(X + 1, Y);
  h.room.collectBoost(capped, X + 1, Y);
  assert.equal(capped.moveRange, 7);
  assert.equal(h.room.state.boosts.size, 1);
  h.room.collectBoost(other, X + 1, Y);
  assert.equal(other.moveRange, 4);
  assert.equal(h.room.state.boosts.size, 0);
});

test("the server accepts seven steps at maximum range and rejects eight", () => {
  const h = harness();
  const start = property("spawnPositions")[0];
  const { client, player } = h.addPlayer("one", ...start);
  player.moveRange = 7;
  const queue = [[...start, 0]], seen = new Set([start.join(",")]);
  const targets = new Map();
  for (let i = 0; i < queue.length && !targets.has(8); i++) {
    const [x, y, distance] = queue[i];
    targets.set(distance, { x, y });
    for (const [dx, dy] of directions) {
      const key = `${x + dx},${y + dy}`;
      if (isOpen(x + dx, y + dy) && !seen.has(key)) {
        seen.add(key); queue.push([x + dx, y + dy, distance + 1]);
      }
    }
  }
  h.move(client, targets.get(8));
  assert.equal(h.room.destinationClaims.size, 0);
  h.move(client, targets.get(7));
  assert.equal(h.room.destinationClaims.size, 1);
  h.clock.advance(CLICK_ARBITRATION_MS + 2100);
  assert.deepEqual([player.x, player.y], [targets.get(7).x, targets.get(7).y]);
  assert.equal(player.moveRange, 7);
});

test("reaching seven during movement leaves later boosts along that same path untouched", () => {
  const h = harness();
  const { client, player } = h.addPlayer("one", X, Y);
  player.moveRange = 6;
  const boosts = [...h.room.state.boosts.values()].slice(0, 2);
  h.room.state.boosts.clear();
  boosts.forEach((boost, i) => {
    boost.x = X + i + 1; boost.y = Y;
    h.room.state.boosts.set(`boost${i}`, boost);
  });
  h.move(client, { x: X + 3, y: Y });
  h.clock.advance(CLICK_ARBITRATION_MS + 300);
  assert.equal(player.moveRange, 7);
  assert.equal(h.room.state.boosts.has("boost0"), false);
  h.clock.advance(600);
  assert.equal(player.moveRange, 7);
  assert.equal(h.room.state.boosts.has("boost1"), true);
  assert.equal(player.x, X + 3);
});

test("boosts are collected on arrival at an intermediate tile, once only", () => {
  const h = harness();
  const { client, player } = h.addPlayer("one", X, Y);
  h.boostAt(X + 1, Y);
  h.move(client, { x: X + 3, y: Y });
  h.clock.advance(CLICK_ARBITRATION_MS + 299);
  assert.equal(player.moveRange, 3);
  assert.equal(h.room.state.boosts.size, 1);
  h.clock.advance(1);
  assert.equal(player.moveRange, 4);
  assert.equal(h.room.state.boosts.size, 0);
  h.room.collectBoost(player, X + 1, Y);
  assert.equal(player.moveRange, 4);
  h.clock.advance(600);
  assert.equal(player.moving, false);
  assert.equal(player.x, X + 3);
});

test("a disputed destination awards its boost only to the winning player", () => {
  const h = harness();
  const a = h.addPlayer("one", X, Y), b = h.addPlayer("two", X + 3, Y + 1);
  h.boostAt(X + 3, Y);
  h.move(a.client, { x: X + 3, y: Y, clickedAt: Date.now() - 100 });
  h.move(b.client, { x: X + 3, y: Y, clickedAt: Date.now() - 50 });
  h.clock.advance(1150);
  assert.equal(a.player.moveRange, 4);
  assert.equal(b.player.moveRange, 3);
  assert.equal(h.room.state.boosts.size, 0);
});

test("disconnect cancels future pickups", () => {
  const h = harness();
  const { client, player } = h.addPlayer("one", X, Y);
  h.boostAt(X + 3, Y);
  h.move(client, { x: X + 3, y: Y });
  h.clock.advance(CLICK_ARBITRATION_MS);
  h.room.leave(client);
  h.clock.advance(1000);
  assert.equal(h.room.state.boosts.size, 1);
  assert.equal(player.moveRange, 3);
});

test("crossing the trophy ends the round and cancels the rest of the path", () => {
  const h = harness();
  const { client, player } = h.addPlayer("champion", ...trophyCrossing.start);
  h.move(client, trophyCrossing.beyond);
  h.clock.advance(CLICK_ARBITRATION_MS + 599);
  assert.equal(h.room.state.phase, "playing");
  h.clock.advance(1);
  assert.equal(h.room.state.phase, "finished");
  assert.equal(h.room.state.winnerId, client);
  assert.equal(h.room.state.winnerName, "champion");
  assert.equal(h.room.state.trophyAvailable, false);
  assert.equal(h.room.destinationClaims.size, 0);
  assert.deepEqual([player.x, player.y], trophy);
  assert.equal(player.moving, false);
  h.clock.advance(10000);
  assert.deepEqual([player.x, player.y], trophy);
  h.move(client, trophyCrossing.beyond);
  assert.equal(h.room.destinationClaims.size, 0);
});

test("only the winner of a contested trophy tile wins, even after leaving", () => {
  const h = harness();
  const a = h.addPlayer("first", ...trophyNeighbors[0]), b = h.addPlayer("second", ...trophyNeighbors[1]);
  h.move(a.client, { x: trophy[0], y: trophy[1], clickedAt: Date.now() - 100 });
  h.move(b.client, { x: trophy[0], y: trophy[1], clickedAt: Date.now() - 50 });
  h.clock.advance(550);
  assert.equal(h.room.state.winnerId, "first");
  assert.equal(b.player.moving, false);
  h.room.finishGame("second", ...trophy);
  assert.equal(h.room.state.winnerId, "first");
  h.room.leave(a.client);
  assert.equal(h.room.state.winnerName, "first");
  assert.equal(h.room.state.phase, "finished");
});

test("a new room resets boosts, range, trophy and winner", () => {
  const first = harness();
  const a = first.addPlayer("one", ...trophyNeighbors[0]);
  first.move(a.client, { x: trophy[0], y: trophy[1] });
  first.clock.advance(550);
  const next = harness();
  const b = next.addPlayer("one", 3, 3);
  assert.equal(next.room.state.trophyAvailable, true);
  assert.equal(next.room.state.winnerName, "");
  assert.equal(next.room.state.boosts.size, 8);
  assert.equal(b.player.moveRange, 3);
});
