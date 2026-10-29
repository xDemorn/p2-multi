import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import jwt from "jsonwebtoken";
import { GameRoom } from "../GameRoom.js";
import { JWT_SECRET } from "../config.js";

const { Client } = createRequire(new URL("../../client/package.json", import.meta.url))("colyseus.js");

async function until(condition) {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for synchronized game state");
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

test("two network clients see the same winner, replay with their tokens, and leave", { timeout: 12000 }, async () => {
  const server = http.createServer();
  const game = new Server({ transport: new WebSocketTransport({ server }), greet: false, gracefullyShutdown: false });
  game.define("game", GameRoom);
  const connections = new Set();
  try {
    await game.listen(0, "127.0.0.1");
    const sdk = new Client(`ws://127.0.0.1:${server.address().port}`);
    const tokens = [1, 2].map((id) => jwt.sign({ id, username: `Player${id}` }, JWT_SECRET, { expiresIn: "5m" }));
    async function join(token) {
      const room = await sdk.joinOrCreate("game", { token });
      room.onMessage("move", () => {});
      connections.add(room);
      return room;
    }
    async function leave(room) { await room.leave(); connections.delete(room); }
    const a = await join(tokens[0]), b = await join(tokens[1]);
    assert.equal(a.roomId, b.roomId);
    a.send("selectTeam", 1); b.send("selectTeam", 2);
    await until(() => a.state.phase === "playing" && b.state.phase === "playing");
    const original = matchMaker.getLocalRoomById(a.roomId);
    Object.assign(original.state.players.get(a.sessionId), { x: 29, y: 30 });
    Object.assign(original.state.players.get(b.sessionId), { x: 30, y: 29 });
    a.send("moveTo", { x: 30, y: 30 });
    await until(() => a.state.phase === "finished" && b.state.phase === "finished");
    assert.equal(a.state.winnerName, "Player1");
    assert.equal(b.state.winnerId, a.sessionId);
    assert.equal(b.state.trophyAvailable, false);
    const previousId = a.roomId;
    await leave(a);
    const nextA = await join(tokens[0]);
    assert.notEqual(nextA.roomId, previousId);
    assert.equal(b.state.winnerName, "Player1");
    await leave(b);
    const nextB = await join(tokens[1]);
    assert.equal(nextA.roomId, nextB.roomId);
    await until(() => nextA.state.players.size === 2 && nextB.state.players.size === 2);
    assert.equal(nextA.state.trophyAvailable, true);
    assert.equal(nextA.state.winnerName, "");
    assert.equal(nextA.state.boosts.size, 8);
    assert.equal(nextA.state.players.get(nextA.sessionId).moveRange, 3);
    nextA.send("selectTeam", 1); nextB.send("selectTeam", 2);
    await until(() => nextA.state.phase === "playing" && nextB.state.phase === "playing");
    await leave(nextA);
    await until(() => nextB.state.players.size === 1);
    await leave(nextB);
  } finally {
    await Promise.all([...connections].map((room) => room.leave().catch(() => {})));
    await game.gracefullyShutdown(false);
  }
});
