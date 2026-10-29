import { Application, Container, Graphics, Sprite, Text, Assets, extensions } from "pixi.js";
import { tiledMapLoader } from 'pixi-tiledmap';
import { Client } from "colyseus.js";
import { API, HOST, GRID, TW, TH, COLORS, WORLD_SCALE, MAX_MOVE_TILES } from "./utils/constants.js";
import * as utils from "./utils/functions.js";
import { characterNameForTeam, loadCharacterAnimations, makeCharacterSprite, setCharacterWalking } from "./utils/characters.js";
import { renderTerrainSurfaces, createBoostOrb, addSanctuaryEmblem } from "./gameVisuals.js";
import { cameraScale } from "./utils/camera.js";

extensions.add(tiledMapLoader);

const $ = utils.$;

// ---------- screens ----------
function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
}

// ---------- auth ----------
function showAuthPanel(kind) {
  const isLogin = kind === "login";
  for (const [el, active] of [[$("login"), isLogin], [$("register"), !isLogin]]) {
    el.classList.toggle("active", active);
    el.setAttribute("aria-selected", String(active));
  }
  $("login-panel").classList.toggle("active", isLogin);
  $("register-panel").classList.toggle("active", !isLogin);
  $("msg").textContent = "";
}

$("login").onclick = () => showAuthPanel("login");
$("register").onclick = () => showAuthPanel("register");

async function auth(kind) {
  $("msg").textContent = "";
  const payload = kind === "login"
    ? { username: $("user").value.trim(), password: $("pass").value }
    : {
        username: $("reg-user").value.trim(),
        email: $("reg-email").value.trim(),
        birthdate: $("reg-birth").value,
        password: $("reg-pass").value,
      };
  try {
    const res = await fetch(`${API}/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    await joinRoom(data.token);
  } catch (e) {
    $("msg").textContent = e.message;
  }
}
$("login-panel").onsubmit = (e) => { e.preventDefault(); auth("login"); };
$("register-panel").onsubmit = (e) => { e.preventDefault(); auth("register"); };

// ---------- room + latency ----------
let room, authToken, pingInterval, rtt = 0, offset = 0, samples = [];
const serverNow = () => Date.now() + offset;

async function joinRoom(token) {
  authToken = token;
  room = await new Client(HOST).joinOrCreate("game", { token });
  const connection = room;
  samples = []; rtt = 0; offset = 0;

  room.onMessage("error", (m) => ($("lobbyInfo").textContent = m));
  room.onMessage("pong", ({ clientTime, serverTime }) => {
    if (room !== connection) return;
    const now = Date.now();
    samples.push({ rtt: now - clientTime, offset: serverTime + (now - clientTime) / 2 - now });
    samples = samples.slice(-8);
    rtt = Math.round(samples.reduce((a, s) => a + s.rtt, 0) / samples.length);
    offset = samples.reduce((a, s) => a + s.offset, 0) / samples.length;
    updateHud();
    room.send("latency", rtt);
  });
  const ping = () => connection.send("ping", Date.now());
  ping(); pingInterval = setInterval(ping, 2000);
  $("hud").style.display = "flex";

  buildLobby();
  room.onStateChange((state) => { if (room === connection) onState(state); });
  room.onMessage("move", ({ id, path, startTime, msPerTile }) => {
    if (room !== connection || (connection.state.phase !== "playing" && !duelBacktracks.has(id))) return;
    if (id === room.sessionId) clearPathPreview();
    anims[id] = { path, startTime, msPerTile };
  });
  room.onMessage("duel", (event) => {
    if (room === connection) showDuelSpell(event);
  });
  room.onLeave(() => { if (room === connection) location.reload(); });
  show("lobby");
}

async function exitMatch(replay) {
  $("play-again").disabled = true;
  $("logout").disabled = true;
  const previousRoom = room;
  room = undefined;
  clearInterval(pingInterval);
  resetGameView();
  $("hud").style.display = "none";
  try {
    await previousRoom?.leave();
    if (replay && authToken) {
      await joinRoom(authToken);
    } else {
      authToken = undefined;
      $("user").value = "";
      $("pass").value = "";
      $("reg-pass").value = "";
      showAuthPanel("login");
      show("menu");
    }
  } catch (error) {
    authToken = undefined;
    $("pass").value = "";
    $("reg-pass").value = "";
    showAuthPanel("login");
    show("menu");
    $("msg").textContent = `No se ha podido entrar en otra partida: ${error.message}`;
  } finally {
    $("play-again").disabled = false;
    $("logout").disabled = false;
  }
}

$("play-again").onclick = () => exitMatch(true);
$("logout").onclick = () => exitMatch(false);

// ---------- lobby ----------
function buildLobby() {
  $("teams").innerHTML = "";
  for (let t = 1; t <= 6; t++) {
    const b = document.createElement("button");
    b.className = "team"; b.id = `team${t}`;
    const color = "#" + COLORS[t - 1].toString(16).padStart(6, "0");
    b.style.borderColor = color;
    b.style.setProperty("--team-color", color);
    b.onclick = () => room.send("selectTeam", t);
    const avatar = document.createElement("img");
    avatar.className = "team-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.alt = "";
    avatar.src = `/assets/interfaz/${characterNameForTeam(t)}.png`;
    const platform = document.createElement("span");
    platform.className = "team-platform";
    platform.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "team-name";
    const owner = document.createElement("span");
    owner.className = "team-owner";
    b.append(avatar, platform, name, owner);
    $("teams").appendChild(b);
  }
}

function renderLobby(state) {
  const owners = {};
  state.players.forEach((p, id) => { if (p.team) owners[p.team] = { name: p.name, mine: id === room.sessionId }; });
  for (let t = 1; t <= 6; t++) {
    const b = $(`team${t}`), o = owners[t];
    b.querySelector(".team-name").textContent = ["Gryffindor", "Ravenclaw", "Slytherin", "Hufflepuff", "Beauxbatons", "Durmstrang"][t - 1];
    b.querySelector(".team-owner").textContent = o ? (o.mine ? "Tu personaje" : o.name) : "Disponible";
    b.disabled = !!o && !o.mine;
    b.classList.toggle("mine", !!o?.mine);
  }
  const waiting = [...state.players.values()].filter((p) => !p.team).length;
  $("lobbyInfo").textContent = `${state.players.size} player(s) in lobby, ${waiting} still choosing. Needs 2+ players.`;
}

// ---------- game ----------
let characterAnimations;
let app, world, players, pathPreview, blockedTiles = new Set(), sprites = {}, anims = {}, started = false;
let boostLayer, trophyMarker;
const boostSprites = new Map();
const pickupEffects = [];
const duelEffects = [];
const duelBacktracks = new Set();
const moveRange = () => room?.state.players.get(room.sessionId)?.moveRange ?? MAX_MOVE_TILES;
const pingRows = new Map();
let pingPanelOpen = false;

function togglePlayerPings() {
  if (room?.state.phase !== "playing") return;
  pingPanelOpen = !pingPanelOpen;
  syncPlayerPings(room.state);
}

$("ping-toggle").onclick = togglePlayerPings;
document.addEventListener("keydown", (event) => {
  if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
    || room?.state.phase !== "playing") return;
  if (event.target instanceof HTMLElement &&
    (event.target.isContentEditable || event.target.closest("input, textarea, select"))) return;
  event.preventDefault();
  if (!event.repeat) togglePlayerPings();
});

function syncPlayerPings(state) {
  const list = $("player-pings");
  const playing = state.phase === "playing";
  if (!playing) pingPanelOpen = false;
  $("ping-toggle").hidden = !playing;
  $("ping-toggle").setAttribute("aria-expanded", String(playing && pingPanelOpen));
  list.hidden = !playing || !pingPanelOpen;
  if (list.hidden) return;
  state.players.forEach((player, id) => {
    let row = pingRows.get(id);
    if (!row) {
      row = document.createElement("div");
      row.className = "player-ping";
      row.setAttribute("role", "listitem");
      row.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="2" y="16" width="4" height="6" rx="1"/><rect x="8" y="11" width="4" height="11" rx="1"/><rect x="14" y="6" width="4" height="16" rx="1"/><rect x="20" y="2" width="4" height="20" rx="1"/></svg><span class="player-ping-name"></span><span class="player-ping-value"></span>';
      list.appendChild(row);
      pingRows.set(id, row);
    }
    const ping = player.ping;
    const color = ping < 0 ? "#c4b795" : ping < 100 ? "#b5d583" : ping < 250 ? "#f1cf76" : "#f49a7e";
    row.querySelector("svg").style.color = color;
    row.querySelector(".player-ping-name").textContent = player.name + (id === room.sessionId ? " (tú)" : "");
    row.querySelector(".player-ping-value").textContent = ping < 0 ? "—" : `${ping} ms`;
    row.title = ping < 0 ? `${player.name}: esperando medición de ping` : `${player.name}: ${ping} ms de ping`;
  });
  for (const [id, row] of pingRows) {
    if (!state.players.has(id)) { row.remove(); pingRows.delete(id); }
  }
}

function updateHud() {
  const range = moveRange();
  $("move-count").textContent = range;
  $("move-info").setAttribute("aria-label", `Puedes avanzar ${range} casillas por movimiento`);
}

function syncBoosts(state) {
  if (!boostLayer) return;
  state.boosts.forEach((boost, id) => {
    if (boostSprites.has(id)) return;
    const marker = createBoostOrb();
    place(marker, boost.x, boost.y);
    boostLayer.addChild(marker);
    boostSprites.set(id, marker);
  });
  for (const [id, marker] of boostSprites) {
    if (state.boosts.has(id)) continue;
    const effect = new Text({ text: "+1", style: {
      fontSize: 30, fontWeight: "bold", fill: 0xffefb4,
      stroke: { color: 0x416748, width: 4 },
    } });
    effect.anchor.set(.5);
    effect.position.set(marker.x, marker.y - 40);
    boostLayer.addChild(effect);
    pickupEffects.push({ effect, start: performance.now(), y: effect.y });
    marker.destroy({ children: true });
    boostSprites.delete(id);
  }
}

function findPreviewPath(sx, sy, tx, ty) {
  const key = (x, y) => y * GRID + x;
  const start = key(sx, sy), target = key(tx, ty);
  const previous = new Map([[start, null]]);
  const queue = [[sx, sy]];

  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    if (key(x, y) === target) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, next = key(nx, ny);
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
      if (blockedTiles.has(next) || previous.has(next)) continue;
      previous.set(next, [x, y]);
      queue.push([nx, ny]);
    }
  }

  if (!previous.has(target)) return null;
  const path = [];
  for (let tile = [tx, ty]; tile; tile = previous.get(key(tile[0], tile[1]))) {
    path.unshift({ x: tile[0], y: tile[1] });
  }
  return path;
}

function clearPathPreview() {
  pathPreview?.clear();
}

function resetGameView() {
  app?.stop();
  $("game").style.display = "none";
  if (world) world.visible = false;
  for (const sprite of Object.values(sprites)) sprite.destroy({ children: true });
  sprites = {}; anims = {};
  for (const child of boostLayer?.removeChildren() ?? []) child.destroy({ children: true });
  boostSprites.clear(); pickupEffects.length = 0;
  for (const { label } of duelEffects) label.destroy();
  duelEffects.length = 0;
  duelBacktracks.clear();
  for (const row of pingRows.values()) row.remove();
  pingRows.clear(); pingPanelOpen = false;
  clearPathPreview();
}

function showDuelSpell({ x, y, loserIds, startTime, duration }) {
  if (!world || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(startTime)
    || !Array.isArray(loserIds) || loserIds.length === 0) return;

  loserIds.forEach((id) => duelBacktracks.add(id));
  const position = tileCenter(x, y);
  const label = new Text({ text: "¡Expelliarmus!", style: {
    fontSize: 24, fontWeight: "bold", fill: 0xfff1b8,
    stroke: { color: 0x572d91, width: 5 },
  } });
  label.anchor.set(.5);
  world.addChild(label);
  duelEffects.push({
    label,
    x: position.x,
    y: position.y,
    startTime,
    duration: Number.isFinite(duration) ? duration : 900,
  });
}

function onState(state) {
  updateHud();
  syncPlayerPings(state);
  if (state.phase === "lobby") return renderLobby(state);
  if (state.phase === "finished") {
    for (const id of Object.keys(anims)) {
      if (!duelBacktracks.has(id)) delete anims[id];
    }
    clearPathPreview();
    syncSprites(state);
    if (trophyMarker) trophyMarker.visible = false;
    $("hud").style.display = "none";
    $("winner-name").textContent = `${state.winnerName} ha ganado`;
    $("result-message").textContent = state.winnerId === room.sessionId
      ? "¡Has conseguido la copa del laberinto!" : "Ha conseguido la copa del laberinto.";
    const wasVisible = $("result").classList.contains("active");
    show("result");
    if (!wasVisible) $("play-again").focus();
    return;
  }
  if (!started) { started = true; startGame(state); }
  else if (world) {
    world.visible = true;
    app.start();
    show("playing");
  }
  $("game").style.display = "block";
  if (trophyMarker) trophyMarker.visible = state.trophyAvailable;
  syncSprites(state);
  syncBoosts(state);
}

async function startGame(state) {
  $("lobby").classList.remove("active");
  app = new Application();
  await app.init({ resizeTo: window, backgroundAlpha: 0, antialias: true });
  $("game").appendChild(app.canvas);

  world = new Container();
  world.scale.set(cameraScale(app.screen.width, app.screen.height, WORLD_SCALE));
  app.stage.addChild(world);

  const { container: map } = await Assets.load("/assets/map.tmj");
  renderTerrainSurfaces(map);
  world.addChild(map);
  characterAnimations = await loadCharacterAnimations();
  addSanctuaryEmblem(world);
  const trophyTexture = await Assets.load("/assets/trophy.png");
  trophyMarker = new Container();
  trophyMarker.eventMode = "none";
  trophyMarker.addChild(new Graphics().ellipse(0, 0, 46, 20).fill({ color: 0xe5b54b, alpha: .28 }));
  const trophy = new Sprite(trophyTexture);
  trophy.anchor.set(.5, 1);
  trophy.width = 126;
  trophy.height = 126 * trophyTexture.height / trophyTexture.width;
  trophy.y = 5;
  trophyMarker.addChild(trophy);
  place(trophyMarker, room.state.trophyX, room.state.trophyY);
  trophyMarker.visible = room.state.trophyAvailable;
  world.addChild(trophyMarker);

  blockedTiles = new Set(JSON.parse(room.state.blocked).map(([x, y]) => y * GRID + x));
  pathPreview = new Graphics();
  world.addChild(pathPreview);
  boostLayer = new Container();
  world.addChild(boostLayer);

  players = new Container();
  players.sortableChildren = true;
  world.addChild(players);

  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;
  const tileAtPointer = (e) => {
    const l = world.toLocal(e.global);
    const g = utils.toGrid(l.x - TW / 2, l.y + TH / 2);
    return { x: Math.round(g.x), y: Math.round(g.y) };
  };

  app.stage.on("pointermove", (e) => {
    clearPathPreview();
    if (room?.state.phase !== "playing") return;
    const player = room.state.players.get(room.sessionId);
    if (!player || player.moving) return;

    const { x, y } = tileAtPointer(e);
    if (x < 0 || y < 0 || x >= GRID || y >= GRID || blockedTiles.has(y * GRID + x)) return;
    let occupied = false;
    room.state.players.forEach((other, id) => {
      if (id !== room.sessionId && other.x === x && other.y === y) occupied = true;
    });
    if (occupied) return;

    const path = findPreviewPath(player.x, player.y, x, y);
    if (!path || path.length < 2 || path.length - 1 > moveRange()) return;
    for (const tile of path.slice(1)) {
      const center = utils.toScreen(tile.x, tile.y);
      const cx = center.x + TW / 2, cy = center.y - TH / 2;
      pathPreview
        .moveTo(cx, cy - TH * 0.38)
        .lineTo(cx + TW * 0.38, cy)
        .lineTo(cx, cy + TH * 0.38)
        .lineTo(cx - TW * 0.38, cy)
        .closePath()
        .fill({ color: 0x748a4b, alpha: 0.28 })
        .stroke({ width: 2, color: 0x506735, alpha: 0.9 });
    }
  });
  app.stage.on("pointerout", clearPathPreview);
  app.stage.on("pointertap", (e) => {
    if (room?.state.phase !== "playing") return;
    const { x, y } = tileAtPointer(e);
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) return;
    const player = room.state.players.get(room.sessionId);
    if (!player || player.moving) return;
    const path = findPreviewPath(player.x, player.y, x, y);
    if (path && path.length >= 2 && path.length - 1 <= moveRange()) {
      room.send("moveTo", { x, y, clickedAt: serverNow() });
    }
    clearPathPreview();
  });

  app.ticker.add(() => {
    const now = performance.now();
    let index = 0;
    for (const marker of boostSprites.values()) {
      marker.orb.y = -40 + Math.sin(now / 450 + index++) * 5;
    }
    for (let i = pickupEffects.length - 1; i >= 0; i--) {
      const { effect, start, y } = pickupEffects[i];
      const age = (now - start) / 800;
      effect.y = y - age * 55;
      effect.alpha = Math.max(0, 1 - age);
      if (age >= 1) { effect.destroy(); pickupEffects.splice(i, 1); }
    }
    for (let i = duelEffects.length - 1; i >= 0; i--) {
      const spell = duelEffects[i];
      const elapsed = serverNow() - spell.startTime;
      if (elapsed < 0) { spell.label.visible = false; continue; }
      if (elapsed >= spell.duration) {
        spell.label.destroy();
        duelEffects.splice(i, 1);
        continue;
      }

      spell.label.visible = true;
      spell.label.position.set(spell.x, spell.y - 112 - Math.min(elapsed / 20, 38));
      spell.label.alpha = Math.min(1, elapsed / 90) * Math.max(0, 1 - elapsed / spell.duration);
    }
    followPlayer();
    for (const [id, a] of Object.entries(anims)) {
      const s = sprites[id];
      if (!s) { delete anims[id]; continue; }
      const elapsed = Math.max(0, serverNow() - a.startTime);
      const i = Math.floor(elapsed / a.msPerTile);
      if (i >= a.path.length - 1) {
        place(s, a.path.at(-1).x, a.path.at(-1).y);
        setCharacterWalking(s.character, 0, 0, false);
        delete anims[id];
        duelBacktracks.delete(id);
        continue;
      }
      const f = (elapsed % a.msPerTile) / a.msPerTile;
      const p0 = a.path[i], p1 = a.path[i + 1];
      setCharacterWalking(s.character, p1.x - p0.x, p1.y - p0.y, true);
      place(s, p0.x + (p1.x - p0.x) * f, p0.y + (p1.y - p0.y) * f);
    }
  });
  syncSprites(room.state);
  syncBoosts(room.state);
}

function followPlayer() {
  if (!room) return;
  const player = sprites[room.sessionId];
  if (!player) return;

  const scale = cameraScale(app.screen.width, app.screen.height, WORLD_SCALE);
  world.scale.set(scale);
  world.position.set(
    app.screen.width / 2 - player.position.x * scale,
    app.screen.height / 2 - player.position.y * scale
  );
}

function place(sprite, gx, gy) {
  const { x, y } = tileCenter(gx, gy);
  sprite.position.set(x, y);
  sprite.zIndex = gx + gy;
}

function tileCenter(gx, gy) {
  const p = utils.toScreen(gx, gy);
  return { x: p.x + TW / 2, y: p.y - TH / 2 };
}

function syncSprites(state) {
  if (!players) return;
  state.players.forEach((p, id) => {
    if (!sprites[id]) {
      const c = new Container();
      c.addChild(new Graphics().ellipse(0, 0, 14, 7).fill({ color: 0x000000, alpha: 0.35 }));
      const character = makeCharacterSprite(characterAnimations, p.team);
      c.character = character;
      c.addChild(character);
      const label = new Text({ text: p.name, style: {
        fontSize: 12, fontWeight: "600", fill: 0x493b2b,
        stroke: { color: 0xfff3d6, width: 3 },
      } });
      label.anchor.set(0.5, 1); label.y = -132;
      c.addChild(label);
      players.addChild(c);
      sprites[id] = c;
      place(c, p.x, p.y);
    }
    if (!anims[id]) place(sprites[id], p.x, p.y);
  });
  for (const id of Object.keys(sprites)) {
    if (!state.players.has(id)) { sprites[id].destroy(); delete sprites[id]; }
  }
}
