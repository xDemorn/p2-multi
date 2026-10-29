import test from "node:test";
import assert from "node:assert/strict";
import { GameRoom } from "../GameRoom.js";

function harness() {
  let now = 0, sequence = 0;
  const timers = new Map(), handlers = new Map();
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
  const room = { clock, clients: [], setState(state) { this.state = state; },
    onMessage(type, handler) { handlers.set(type, handler); }, broadcast() {}, lock() {} };
  for (const name of Object.getOwnPropertyNames(GameRoom.prototype)) {
    if (name !== "constructor") room[name] = GameRoom.prototype[name];
  }
  room.onCreate();
  room.state.phase = "playing";
  function addPlayer(id, x, y) {
    const client = { sessionId: id, send() {} };
    room.onJoin(client, {}, { username: id });
    const player = room.state.players.get(id);
    player.x = x; player.y = y;
    return { client, player };
  }
  function boostAt(x, y) {
    const boost = room.state.boosts.values().next().value;
    assert.ok(boost, "Map provides boost instances");
    room.state.boosts.clear(); boost.x = x; boost.y = y;
    room.state.boosts.set("test", boost);
  }
  return { room, clock, addPlayer, boostAt, move: handlers.get("moveTo"), latency: handlers.get("latency") };
}

test("base range is three; a collected boost allows four, but not five", () => {
  const h = harness();
  const { client, player } = h.addPlayer("one", 27, 27);
  assert.equal(player.moveRange, 3);
  h.move(client, { x: 31, y: 27 });
  assert.equal(h.room.destinationClaims.size, 0);
  h.boostAt(27, 27);
  h.room.collectBoost(player, 27, 27);
  assert.equal(player.moveRange, 4);
  h.move(client, { x: 32, y: 27 });
  assert.equal(h.room.destinationClaims.size, 0);
  h.move(client, { x: 31, y: 27 });
  assert.equal(h.room.destinationClaims.get("31,27").candidates[0].path.length, 5);
});

test("player ping is synchronized independently and rejects invalid measurements", () => {
  const h = harness();
  const a = h.addPlayer("one", 27, 27), b = h.addPlayer("two", 30, 30);
  assert.equal(a.player.ping, -1);
  h.latency(a.client, 42.4);
  h.latency(b.client, 175);
  assert.equal(a.player.ping, 42);
  assert.equal(b.player.ping, 175);
  for (const value of [-1, 5001, NaN, Infinity, "20"]) h.latency(a.client, value);
  assert.equal(a.player.ping, 42);
  h.latency({ sessionId: "unknown" }, 20);
  assert.equal(h.room.clientRtts.has("unknown"), false);
  h.room.onLeave(a.client);
  assert.equal(h.room.state.players.has("one"), false);
  assert.equal(h.room.clientRtts.has("one"), false);
});

test("boosts are collected on arrival at an intermediate tile, once only", () => {
  const h = harness();
  const { client, player } = h.addPlayer("one", 27, 27);
  h.boostAt(28, 27);
  h.move(client, { x: 30, y: 27 });
  h.clock.advance(250 + 299);
  assert.equal(player.moveRange, 3);
  assert.equal(h.room.state.boosts.size, 1);
  h.clock.advance(1);
  assert.equal(player.moveRange, 4);
  assert.equal(h.room.state.boosts.size, 0);
  h.room.collectBoost(player, 28, 27);
  assert.equal(player.moveRange, 4);
  h.clock.advance(600);
  assert.equal(player.moving, false);
  assert.equal(player.x, 30);
});

test("a disputed destination awards its boost only to the winning player", () => {
  const h = harness();
  const a = h.addPlayer("one", 27, 27), b = h.addPlayer("two", 30, 30);
  h.boostAt(30, 27);
  h.move(a.client, { x: 30, y: 27, clickedAt: Date.now() - 100 });
  h.move(b.client, { x: 30, y: 27, clickedAt: Date.now() - 50 });
  h.clock.advance(1150);
  assert.equal(a.player.moveRange, 4);
  assert.equal(b.player.moveRange, 3);
  assert.equal(h.room.state.boosts.size, 0);
});

test("disconnect cancels future pickups", () => {
  const h = harness();
  const { client, player } = h.addPlayer("one", 27, 27);
  h.boostAt(30, 27);
  h.move(client, { x: 30, y: 27 });
  h.clock.advance(250);
  h.room.onLeave(client);
  h.clock.advance(1000);
  assert.equal(h.room.state.boosts.size, 1);
  assert.equal(player.moveRange, 3);
});

test("crossing the trophy ends the round and cancels the rest of the path", () => {
  const h = harness();
  const { client, player } = h.addPlayer("champion", 28, 30);
  h.move(client, { x: 31, y: 30 });
  h.clock.advance(250 + 599);
  assert.equal(h.room.state.phase, "playing");
  h.clock.advance(1);
  assert.equal(h.room.state.phase, "finished");
  assert.equal(h.room.state.winnerId, client.sessionId);
  assert.equal(h.room.state.winnerName, "champion");
  assert.equal(h.room.state.trophyAvailable, false);
  assert.equal(h.room.destinationClaims.size, 0);
  assert.deepEqual([player.x, player.y], [30, 30]);
  assert.equal(player.moving, false);
  h.clock.advance(10000);
  assert.deepEqual([player.x, player.y], [30, 30]);
  h.move(client, { x: 31, y: 30 });
  assert.equal(h.room.destinationClaims.size, 0);
});

test("only the winner of a contested trophy tile wins, even after leaving", () => {
  const h = harness();
  const a = h.addPlayer("first", 29, 30), b = h.addPlayer("second", 30, 29);
  h.move(a.client, { x: 30, y: 30, clickedAt: Date.now() - 100 });
  h.move(b.client, { x: 30, y: 30, clickedAt: Date.now() - 50 });
  h.clock.advance(550);
  assert.equal(h.room.state.winnerId, "first");
  assert.equal(b.player.moving, false);
  h.room.finishGame("second", 30, 30);
  assert.equal(h.room.state.winnerId, "first");
  h.room.onLeave(a.client);
  assert.equal(h.room.state.winnerName, "first");
  assert.equal(h.room.state.phase, "finished");
});

test("a new room resets boosts, range, trophy and winner", () => {
  const first = harness();
  const a = first.addPlayer("one", 29, 30);
  first.move(a.client, { x: 30, y: 30 });
  first.clock.advance(550);
  const next = harness();
  const b = next.addPlayer("one", 3, 3);
  assert.equal(next.room.state.trophyAvailable, true);
  assert.equal(next.room.state.winnerName, "");
  assert.equal(next.room.state.boosts.size, 8);
  assert.equal(b.player.moveRange, 3);
});
