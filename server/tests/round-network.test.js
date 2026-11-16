import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import { createGameRouter } from "../routes/game.js";
import { getRoom } from "../game/rooms.js";
import { createToken, jwtSecret as JWT_SECRET } from "../utils.js";
import { trophy, trophyNeighbors } from "./map-helpers.js";

async function until(condition) {
  const deadline = Date.now() + 5000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for synchronized game state");
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use("/api/game", createGameRouter());
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}/api/game` };
}

function player(base, token) {
  const connection = {
    token,
    roomId: null,
    sessionId: null,
    cursor: 0,
    async call(method, path, body) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(`${method} ${path}: ${data.error}`);
      return data;
    },
    async join(roomId) {
      const data = await connection.call("POST", "/join", { roomId });
      connection.roomId = data.roomId;
      connection.sessionId = data.playerId;
      connection.cursor = data.cursor;
      connection.state = withMaps(data.state);
      return connection;
    },
    async poll() {
      const data = await connection.call("GET", `/${connection.roomId}?since=${connection.cursor}`);
      connection.cursor = data.cursor;
      connection.state = withMaps(data.state);
      return data;
    },
    leave() {
      return connection.call("POST", `/${connection.roomId}/leave`);
    },
  };
  return connection;
}

const withMaps = (state) => ({
  ...state,
  players: new Map(Object.entries(state.players)),
  boosts: new Map(Object.entries(state.boosts)),
});

test("banned tokens cannot join a game", async () => {
  const { server, base } = await startServer();
  try {
    const banned = player(base, createToken({ id: 1, username: "banned", isBanned: true }));
    await assert.rejects(banned.join(), /Invalid token/);
  } finally {
    server.close();
  }
});

test("the close-tab beacon can leave with the token in the form body", async () => {
  const { server, base } = await startServer();
  const token = jwt.sign({ id: 50, username: "Beacon" }, JWT_SECRET, { expiresIn: "5m" });
  try {
    const a = await player(base, token).join();
    const response = await fetch(`${base}/${a.roomId}/leave`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    assert.equal(response.status, 200);
    const poll = await fetch(`${base}/${a.roomId}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(poll.status, 404);
  } finally {
    server.close();
  }
});

test("two HTTP clients see the same winner, replay with their tokens, and leave", { timeout: 12000 }, async () => {
  const { server, base } = await startServer();
  const tokens = [1, 2].map((id) => jwt.sign({ id, username: `Player${id}` }, JWT_SECRET, { expiresIn: "5m" }));
  try {
    const a = await player(base, tokens[0]).join();
    const fresh = await player(base, tokens[1]).join();
    assert.notEqual(a.roomId, fresh.roomId);
    await fresh.leave();
    const b = await player(base, tokens[1]).join(a.roomId);
    assert.equal(a.roomId, b.roomId);
    assert.equal(a.state.maxMoveRange, 7);

    await a.call("POST", `/${a.roomId}/team`, { team: 1 });
    await b.call("POST", `/${a.roomId}/team`, { team: 2 });
    const playing = async () => {
      await Promise.all([a.poll(), b.poll()]);
      return a.state.phase === "playing" && b.state.phase === "playing";
    };
    await until(playing);

    const room = getRoom(a.roomId);
    Object.assign(room.state.players.get(a.sessionId), { x: trophyNeighbors[0][0], y: trophyNeighbors[0][1] });
    Object.assign(room.state.players.get(b.sessionId), { x: trophyNeighbors[1][0], y: trophyNeighbors[1][1] });
    await a.call("POST", `/${a.roomId}/move`, { x: trophy[0], y: trophy[1] });
    await until(async () => {
      await Promise.all([a.poll(), b.poll()]);
      return a.state.phase === "finished" && b.state.phase === "finished";
    });
    assert.equal(a.state.winnerName, "Player1");
    assert.equal(b.state.winnerId, a.sessionId);
    assert.equal(b.state.trophyAvailable, false);

    const previousId = a.roomId;
    await a.leave();
    const nextA = await player(base, tokens[0]).join();
    assert.notEqual(nextA.roomId, previousId);
    assert.equal(b.state.winnerName, "Player1");
    const nextB = await player(base, tokens[1]).join(nextA.roomId);
    assert.equal(nextA.roomId, nextB.roomId);
    await until(async () => {
      await Promise.all([nextA.poll(), nextB.poll()]);
      return nextA.state.players.size === 2 && nextB.state.players.size === 2;
    });
    assert.equal(nextA.state.trophyAvailable, true);
    assert.equal(nextA.state.winnerName, "");
    assert.equal(nextA.state.boosts.size, 8);
    assert.equal(nextA.state.maxMoveRange, 7);
    assert.equal(nextA.state.players.get(nextA.sessionId).moveRange, 3);

    await nextA.call("POST", `/${nextA.roomId}/team`, { team: 1 });
    await nextB.call("POST", `/${nextB.roomId}/team`, { team: 2 });
    await until(async () => {
      await Promise.all([nextA.poll(), nextB.poll()]);
      return nextA.state.phase === "playing" && nextB.state.phase === "playing";
    });
    await nextA.leave();
    await until(async () => {
      await nextB.poll();
      return nextB.state.players.size === 1;
    });
    await nextB.leave();
  } finally {
    server.close();
  }
});
