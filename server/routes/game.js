import { Router } from "express";
import jwt from "jsonwebtoken";
import { jwtSecret } from "../utils.js";
import { createRoom, findPlayerRoom, getRoom, leaveRoom, sweepRooms } from "../game/rooms.js";

const SWEEP_MS = 2000;

export function createGameRouter() {
  const sweeper = setInterval(sweepRooms, SWEEP_MS);
  sweeper.unref();
  const router = Router();

  router.use((req, res, next) => {
    const header = req.get("authorization") ?? "";
    // sendBeacon no puede mandar cabeceras, así que el token va en el body
    const token = header.startsWith("Bearer ")
      ? header.slice(7)
      : (typeof req.body?.token === "string" ? req.body.token : "");
    try {
      const user = jwt.verify(token, jwtSecret);
      if (user.scope || user.isBanned) throw new Error("not a game session");
      req.gameUser = user;
      next();
    } catch {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  const fail = (res, status, error) => res.status(status).json({ error });
  const inRoom = (req, room) => room?.sessions.has(String(req.gameUser.id));

  router.post("/join", (req, res) => {
    const user = req.gameUser;
    const requested = typeof req.body?.roomId === "string" ? req.body.roomId.trim() : "";
    let room = findPlayerRoom(user.id);
    if (requested) {
      const target = getRoom(requested);
      if (!target) return fail(res, 404, "La sala no existeix.");
      const joined = target.sessions.has(String(user.id));
      if (!joined && (target.locked || target.sessions.size >= target.maxPlayers)) {
        return fail(res, 409, target.locked ? "Game already started" : "Room is full");
      }
      if (room && room !== target) leaveRoom(room, user.id);
      room = target;
    } else if (!room) {
      room = createRoom();
    }
    const playerId = room.join(user);
    res.json({ roomId: room.roomId, playerId, ...room.snapshot(playerId, 0) });
  });

  router.get("/:roomId", (req, res) => {
    const room = getRoom(req.params.roomId);
    if (!room || !inRoom(req, room)) return fail(res, 404, "La sala no existeix.");
    const playerId = String(req.gameUser.id);
    const since = Number(req.query.since);
    if (req.query.rtt !== undefined) room.setLatency(playerId, Number(req.query.rtt));
    const snapshot = room.snapshot(playerId, Number.isFinite(since) && since >= 0 ? since : 0);
    if (!snapshot) return fail(res, 410, "Ja no ets en aquesta sala.");
    res.json(snapshot);
  });

  router.post("/:roomId/team", (req, res) => {
    const room = getRoom(req.params.roomId);
    if (!room || !inRoom(req, room)) return fail(res, 404, "La sala no existeix.");
    room.selectTeam(String(req.gameUser.id), req.body?.team);
    res.json({ ok: true });
  });

  router.post("/:roomId/move", (req, res) => {
    const room = getRoom(req.params.roomId);
    if (!room || !inRoom(req, room)) return fail(res, 404, "La sala no existeix.");
    room.moveTo(String(req.gameUser.id), req.body ?? {});
    res.json({ ok: true });
  });

  router.post("/:roomId/leave", (req, res) => {
    const room = getRoom(req.params.roomId);
    if (room) leaveRoom(room, String(req.gameUser.id));
    res.json({ ok: true });
  });

  return router;
}
