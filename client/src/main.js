import { setupAuth } from "./auth.js";
import { setupMenu } from "./menu.js";
import { setupProfile } from "./profile.js";
import { setupSettings } from "./settings.js";
import { audio } from "./audio.js";
import { buildLobby, renderLobby } from "./lobby.js";
import { createPlayerPings } from "./playerPings.js";
import { joinGame } from "./game/connection.js";
import { GameView } from "./game/GameView.js";
import { fetchMe, getToken, logout, setToken } from "./session.js";
import { MAX_MOVE_TILES } from "./utils/constants.js";
import { $, screenListeners, show } from "./utils/functions.js";

let room;
let me;
let lastPhase = "";

const serverNow = () => room?.serverNow() ?? Date.now();
const moveRange = () => room?.state.players.get(room.sessionId)?.moveRange ?? MAX_MOVE_TILES;
const playerPings = createPlayerPings(() => room);
const game = new GameView({ getRoom: () => room, serverNow, moveRange });

const settings = setupSettings({ onLeave: () => exitMatch(false) });

const auth = setupAuth(async (token) => {
  setToken(token);
  await enterMenu();
});

const menu = setupMenu({
  onQuickPlay: () => joinRoom("quick"),
  onCreateRoom: () => joinRoom("create"),
  onJoinRoom: (code) => joinRoom("join", code),
  onProfile: async () => {
    me = await fetchMe();
    profile.open(me);
    show("profile");
  },
  onLogout: async () => {
    await logout();
    goToLogin();
  },
});

const profile = setupProfile({
  onBack: () => {
    menu.render(me);
    show("home");
  },
  onUpdated: (user) => (me = user),
  onDeleted: () => {
    setToken(null);
    goToLogin("Tu cuenta se ha eliminado.");
  },
});

function goToLogin(message = "") {
  me = undefined;
  setToken(null);
  auth.showLogin();
  auth.message(message, Boolean(message));
  show("auth");
}

async function enterMenu(message = "") {
  me = await fetchMe();
  menu.render(me);
  menu.message(message);
  show("home");
}

// al recargar se mantiene la sesión; el enlace de reset va primero
async function boot() {
  if (auth.consumeResetLink()) return show("auth");
  if (!getToken()) return goToLogin();
  try {
    await enterMenu();
  } catch {
    goToLogin("Tu sesión ha caducado. Vuelve a iniciar sesión.");
  }
}
// sonido al cambiar de pantalla (no al empezar ni al acabar la partida)
const NAVIGATION_SCREENS = new Set(["auth", "home", "profile", "lobby"]);
screenListeners.add((id, previous) => {
  if (previous && NAVIGATION_SCREENS.has(id)) audio.play("click");
});

audio.start();
boot();

$("copyRoomId").onclick = async () => {
  try {
    await navigator.clipboard.writeText(room.roomId);
    $("copyRoomId").textContent = "¡Copiado!";
  } catch {
    $("copyRoomId").textContent = "No se pudo copiar";
  }
};

$("play-again").onclick = () => exitMatch(true);
$("back-menu").onclick = () => exitMatch(false);
$("leave-lobby").onclick = () => exitMatch(false);

function friendlyJoinError(error, mode) {
  // el servidor ya manda el motivo en { error }
  const text = String(error?.response?.data?.error ?? error?.message ?? error);
  if (/no existeix|not found|no rooms found/i.test(text)) {
    return mode === "join" ? "No existe ninguna sala con ese código." : "No se ha encontrado ninguna sala disponible.";
  }
  if (/already started|locked|full|liena/i.test(text)) return "Esa partida ya ha empezado o está llena.";
  if (/invalid token/i.test(text)) return "Tu sesión ha caducado. Vuelve a iniciar sesión.";
  return `No se ha podido entrar en la sala: ${text}`;
}

// "quick" y "create" abren una sala nueva; "join" entra con código
async function joinRoom(mode, code) {
  const token = getToken();
  let connection;
  try {
    connection = await joinGame({ token, roomId: mode === "join" ? code : null });
  } catch (error) {
    const message = friendlyJoinError(error, mode);
    if (error?.response?.status === 401) goToLogin(message);
    throw new Error(message);
  }
  room = connection;

  $("roomId").textContent = `Código de sala: ${room.roomId}`;
  $("copyRoomId").textContent = "Copiar código";
  lastPhase = "";
  settings.setInRoom(true);
  audio.setScene("game");

  room.onMessage("error", (message) => ($("lobbyInfo").textContent = message));
  room.onMessage("move", (movement) => {
    if (room === connection) game.handleMove(movement, connection.state.phase);
  });
  room.onMessage("duel", (event) => {
    if (room !== connection) return;
    game.showDuelSpell(event);
    // el hechizo suena cuando empieza la animación (startTime es hora del servidor)
    const delay = Number.isFinite(event?.startTime) ? event.startTime - serverNow() : 0;
    setTimeout(() => room === connection && audio.play("spell"), Math.max(0, Math.min(delay, 2000)));
  });
  room.onLeave(() => {
    if (room !== connection) return;
    leaveCleanup();
    enterMenu("Se ha perdido la conexión con la sala.").catch(() => goToLogin());
  });
  $("hud").style.display = "flex";

  buildLobby(room);
  room.onStateChange((state) => {
    if (room === connection) onState(state);
  });
  room.start();
  show("lobby");
}

function onState(state) {
  if (state.phase === "finished" && lastPhase !== "finished") {
    audio.duckFor(4500);
    audio.play("win");
  }
  lastPhase = state.phase;
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

function leaveCleanup() {
  room = undefined;
  settings.setInRoom(false);
  audio.setScene("menu");
  game.reset();
  playerPings.reset();
  $("hud").style.display = "none";
}

async function exitMatch(replay) {
  const controls = ["play-again", "back-menu", "leave-lobby"];
  controls.forEach((id) => ($(id).disabled = true));
  const previousRoom = room;
  leaveCleanup();
  try {
    await previousRoom?.leave();
    if (replay) await joinRoom("quick");
    else await enterMenu();
  } catch (error) {
    await enterMenu(error.message).catch(() => goToLogin());
  } finally {
    controls.forEach((id) => ($(id).disabled = false));
  }
}
