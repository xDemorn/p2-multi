import { Client } from "colyseus.js";
import { setupAuth } from "./auth.js";
import { buildLobby, renderLobby } from "./lobby.js";
import { createPlayerPings } from "./playerPings.js";
import { GameView } from "./game/GameView.js";
import { HOST, MAX_MOVE_TILES } from "./utils/constants.js";
import { $, show } from "./utils/functions.js";

let room;
let authToken;
let pingInterval;
let rtt = 0;
let offset = 0;
let samples = [];

const serverNow = () => Date.now() + offset;
const moveRange = () => room?.state.players.get(room.sessionId)?.moveRange ?? MAX_MOVE_TILES;
const playerPings = createPlayerPings(() => room);
const game = new GameView({ getRoom: () => room, serverNow, moveRange });
const { showLogin } = setupAuth(joinRoom);

$("copyRoomId").onclick = async () => {
  try {
    await navigator.clipboard.writeText(room.roomId);
    $("copyRoomId").textContent = "Copiado";
  } catch {
    $("copyRoomId").textContent = "No se pudo copiar";
  }
};

$("play-again").onclick = () => exitMatch(true);
$("logout").onclick = () => exitMatch(false);

async function joinRoom(token, roomId) {
  authToken = token;
  const client = new Client(HOST);
  room = roomId
    ? await client.joinById(roomId, { token })
    : await client.create("game", { token });
  $("roomId").textContent = `ID de sala: ${room.roomId}`;
  $("copyRoomId").textContent = "Copiar ID";
  const connection = room;
  samples = [];
  rtt = 0;
  offset = 0;

  room.onMessage("error", (message) => ($("lobbyInfo").textContent = message));
  room.onMessage("pong", ({ clientTime, serverTime }) => {
    if (room !== connection) return;
    const now = Date.now();
    samples.push({ rtt: now - clientTime, offset: serverTime + (now - clientTime) / 2 - now });
    samples = samples.slice(-8);
    rtt = Math.round(samples.reduce((sum, sample) => sum + sample.rtt, 0) / samples.length);
    offset = samples.reduce((sum, sample) => sum + sample.offset, 0) / samples.length;
    updateHud();
    room.send("latency", rtt);
  });
  const ping = () => connection.send("ping", Date.now());
  ping();
  pingInterval = setInterval(ping, 2000);
  $("hud").style.display = "flex";

  buildLobby(room);
  room.onStateChange((state) => {
    if (room === connection) onState(state);
  });
  room.onMessage("move", (movement) => {
    if (room === connection) game.handleMove(movement, connection.state.phase);
  });
  room.onMessage("duel", (event) => {
    if (room === connection) game.showDuelSpell(event);
  });
  room.onLeave(() => {
    if (room === connection) location.reload();
  });
  show("lobby");
}

function onState(state) {
  updateHud();
  playerPings.sync(state);
  game.updateMovementRangePreview(state);
  if (state.phase === "lobby") {
    renderLobby(state, room.sessionId);
    return;
  }
  game.onState(state);
}

function updateHud() {
  const range = moveRange();
  const max = room?.state.maxMoveRange || 7;
  $("move-count").textContent = `${range} / ${max}`;
  const description = range >= max
    ? `Alcance máximo: ${max} casillas. Las bolitas quedan disponibles para los demás.`
    : `Puedes avanzar ${range} casillas por movimiento, hasta un máximo de ${max}.`;
  $("move-info").setAttribute("aria-label", description);
  $("move-info").title = description;
}

async function exitMatch(replay) {
  $("play-again").disabled = true;
  $("logout").disabled = true;
  const previousRoom = room;
  room = undefined;
  clearInterval(pingInterval);
  game.reset();
  playerPings.reset();
  $("hud").style.display = "none";
  try {
    await previousRoom?.leave();
    if (replay && authToken) {
      await joinRoom(authToken);
    } else {
      authToken = undefined;
      $("user").value = "";
      $("pass").value = "";
      showLogin();
      show("menu");
    }
  } catch (error) {
    authToken = undefined;
    $("pass").value = "";
    showLogin();
    show("menu");
    $("msg").textContent = `No se ha podido entrar en otra partida: ${error.message}`;
  } finally {
    $("play-again").disabled = false;
    $("logout").disabled = false;
  }
}
