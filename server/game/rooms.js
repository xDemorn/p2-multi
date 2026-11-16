import { GameRoom } from "../GameRoom.js";

const rooms = new Map();
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newRoomId() {
  let id;
  do {
    id = Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
  } while (rooms.has(id));
  return id;
}

export function createRoom() {
  const room = new GameRoom(newRoomId());
  rooms.set(room.roomId, room);
  return room;
}

export const getRoom = (roomId) => rooms.get(String(roomId ?? "").toUpperCase());

export function findPlayerRoom(playerId) {
  const id = String(playerId);
  for (const room of rooms.values()) {
    if (room.sessions.has(id)) return room;
  }
  return null;
}

export function leaveRoom(room, playerId) {
  room.leave(playerId);
  if (room.sessions.size === 0) rooms.delete(room.roomId);
}

export function sweepRooms() {
  for (const room of [...rooms.values()]) {
    room.sweep();
    if (room.sessions.size === 0) rooms.delete(room.roomId);
  }
}
