import { Application, Assets, Container, Graphics, Sprite, Text, extensions } from "pixi.js";
import { tiledMapLoader } from "pixi-tiledmap";
import { GRID, MS_PER_TILE, TH, TW, WORLD_SCALE } from "../utils/constants.js";
import { $, show, toGrid, toScreen } from "../utils/functions.js";
import { findPath, findReachableTiles } from "../utils/movement.js";
import { loadCharacterAnimations, makeCharacterSprite, setCharacterWalking } from "../utils/characters.js";
import { cameraScale } from "../utils/camera.js";
import { addSanctuaryEmblem, createBoostOrb, renderTerrainSurfaces } from "../gameVisuals.js";

extensions.add(tiledMapLoader);

function tileCenter(gx, gy) {
  const point = toScreen(gx, gy);
  return { x: point.x + TW / 2, y: point.y - TH / 2 };
}

function drawTilePreview(graphics, tiles, fillAlpha, strokeAlpha, strokeWidth) {
  for (const { x, y } of tiles) {
    const center = tileCenter(x, y);
    graphics
      .moveTo(center.x, center.y - TH * 0.38)
      .lineTo(center.x + TW * 0.38, center.y)
      .lineTo(center.x, center.y + TH * 0.38)
      .lineTo(center.x - TW * 0.38, center.y)
      .closePath()
      .fill({ color: 0x748a4b, alpha: fillAlpha })
      .stroke({ width: strokeWidth, color: 0x506735, alpha: strokeAlpha });
  }
}

const sameTiles = (a, b) => a.length === b.length
  && a.every((tile, index) => tile.x === b[index].x && tile.y === b[index].y);

export class GameView {
  sprites = {};
  anims = {};
  blockedTiles = new Set();
  boostSprites = new Map();
  pickupEffects = [];
  duelEffects = [];
  duelBacktracks = new Set();
  prediction = null;
  holding = new Set();
  started = false;

  constructor({ getRoom, serverNow, moveRange }) {
    this.getRoom = getRoom;
    this.serverNow = serverNow;
    this.moveRange = moveRange;
  }

  handleMove({ id, path, startTime, msPerTile }, phase) {
    if (phase !== "playing" && !this.duelBacktracks.has(id)) return;
    if (id === this.getRoom().sessionId) this.clearPathPreview();
    const predicted = this.prediction;
    if (predicted?.id === id) {
      // es nuestro propio clic: seguimos con el tiempo local para que no salte
      if (sameTiles(path, predicted.path)) return;
      // hubo disputa y el camino se recorta: seguimos por el trozo común
      if (sameTiles(path, predicted.path.slice(0, path.length))) {
        predicted.path = path;
        this.anims[id].path = path;
        return;
      }
      this.prediction = null;
    }
    this.holding.delete(id);
    this.anims[id] = { path, startTime, msPerTile };
  }

  predictMove(id, path, startTime) {
    this.prediction = { id, path };
    this.anims[id] = { path, startTime, msPerTile: MS_PER_TILE };
  }

  clearPathPreview() {
    this.pathPreview?.clear();
  }

  reset() {
    this.app?.stop();
    $("game").style.display = "none";
    if (this.world) this.world.visible = false;
    for (const sprite of Object.values(this.sprites)) sprite.destroy({ children: true });
    this.sprites = {};
    this.anims = {};
    for (const child of this.boostLayer?.removeChildren() ?? []) child.destroy({ children: true });
    this.boostSprites.clear();
    this.pickupEffects.length = 0;
    for (const { label } of this.duelEffects) label.destroy();
    this.duelEffects.length = 0;
    this.duelBacktracks.clear();
    this.prediction = null;
    this.holding.clear();
    this.clearPathPreview();
    this.rangePreview?.clear();
  }

  updateMovementRangePreview(state) {
    this.rangePreview?.clear();
    if (!this.rangePreview || state.phase !== "playing") return;
    const room = this.getRoom();
    const player = state.players.get(room.sessionId);
    if (!player || player.moving || this.prediction) return;

    const occupied = new Set();
    state.players.forEach((other, id) => {
      if (id !== room.sessionId) occupied.add(other.y * GRID + other.x);
    });
    const tiles = findReachableTiles(player.x, player.y, this.moveRange(), GRID, this.blockedTiles)
      .filter(({ x, y }) => !occupied.has(y * GRID + x));
    drawTilePreview(this.rangePreview, tiles, 0.24, 0.8, 1.5);
  }

  onState(state) {
    const room = this.getRoom();
    if (state.phase === "finished") {
      for (const id of Object.keys(this.anims)) {
        if (!this.duelBacktracks.has(id)) delete this.anims[id];
      }
      this.clearPathPreview();
      this.syncSprites(state);
      if (this.trophyMarker) this.trophyMarker.visible = false;
      $("hud").style.display = "none";
      $("winner-name").textContent = `${state.winnerName} ha ganado`;
      $("result-message").textContent = state.winnerId === room.sessionId
        ? "¡Has conseguido la copa del laberinto!"
        : "Ha conseguido la copa del laberinto.";
      const wasVisible = $("result").classList.contains("active");
      show("result");
      if (!wasVisible) $("play-again").focus();
      return;
    }

    if (!this.started) {
      this.started = true;
      this.startGame(state);
    } else if (this.world) {
      this.world.visible = true;
      this.app.start();
      show("playing");
    }
    $("game").style.display = "block";
    if (this.trophyMarker) this.trophyMarker.visible = state.trophyAvailable;
    this.syncSprites(state);
    this.syncBoosts(state);
  }

  async startGame() {
    $("lobby").classList.remove("active");
    this.app = new Application();
    await this.app.init({ resizeTo: window, backgroundAlpha: 0, antialias: true });
    $("game").appendChild(this.app.canvas);

    this.world = new Container();
    this.world.scale.set(cameraScale(this.app.screen.width, this.app.screen.height, WORLD_SCALE));
    this.app.stage.addChild(this.world);

    const { container: map } = await Assets.load("/assets/map.tmj");
    renderTerrainSurfaces(map);
    this.world.addChild(map);
    this.rangePreview = new Graphics();
    this.pathPreview = new Graphics();
    this.world.addChild(this.rangePreview, this.pathPreview);
    this.characterAnimations = await loadCharacterAnimations();

    const room = this.getRoom();
    addSanctuaryEmblem(this.world, room.state.trophyX, room.state.trophyY);
    const trophyTexture = await Assets.load("/assets/trophy.png");
    this.trophyMarker = new Container();
    this.trophyMarker.eventMode = "none";
    this.trophyMarker.addChild(new Graphics().ellipse(0, 0, 46, 20).fill({ color: 0xe5b54b, alpha: 0.28 }));
    const trophy = new Sprite(trophyTexture);
    trophy.anchor.set(0.5, 1);
    trophy.width = 126;
    trophy.height = 126 * trophyTexture.height / trophyTexture.width;
    trophy.y = 5;
    this.trophyMarker.addChild(trophy);
    this.place(this.trophyMarker, room.state.trophyX, room.state.trophyY);
    this.trophyMarker.visible = room.state.trophyAvailable;
    this.world.addChild(this.trophyMarker);

    this.blockedTiles = new Set(JSON.parse(room.state.blocked).map(([x, y]) => y * GRID + x));
    this.boostLayer = new Container();
    this.world.addChild(this.boostLayer);

    this.players = new Container();
    this.players.sortableChildren = true;
    this.world.addChild(this.players);

    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = this.app.screen;
    const tileAtPointer = (event) => {
      const local = this.world.toLocal(event.global);
      const grid = toGrid(local.x - TW / 2, local.y + TH / 2);
      return { x: Math.round(grid.x), y: Math.round(grid.y) };
    };

    this.app.stage.on("pointermove", (event) => {
      this.clearPathPreview();
      const currentRoom = this.getRoom();
      if (currentRoom?.state.phase !== "playing") return;
      const player = currentRoom.state.players.get(currentRoom.sessionId);
      if (!player || player.moving) return;

      const { x, y } = tileAtPointer(event);
      if (x < 0 || y < 0 || x >= GRID || y >= GRID || this.blockedTiles.has(y * GRID + x)) return;
      let occupied = false;
      currentRoom.state.players.forEach((other, id) => {
        if (id !== currentRoom.sessionId && other.x === x && other.y === y) occupied = true;
      });
      if (occupied) return;

      const path = findPath(player.x, player.y, x, y, GRID, this.blockedTiles);
      if (!path || path.length < 2 || path.length - 1 > this.moveRange()) return;
      drawTilePreview(this.pathPreview, path.slice(1), 0.28, 0.9, 2);
    });

    this.app.stage.on("pointerout", () => this.clearPathPreview());
    this.app.stage.on("pointertap", (event) => {
      const currentRoom = this.getRoom();
      if (currentRoom?.state.phase !== "playing") return;
      const { x, y } = tileAtPointer(event);
      if (x < 0 || y < 0 || x >= GRID || y >= GRID) return;
      const player = currentRoom.state.players.get(currentRoom.sessionId);
      if (!player || player.moving || this.prediction) return;
      const path = findPath(player.x, player.y, x, y, GRID, this.blockedTiles);
      if (path && path.length >= 2 && path.length - 1 <= this.moveRange()) {
        const clickedAt = this.serverNow();
        currentRoom.send("moveTo", { x, y, clickedAt });
        // empezamos a andar ya; el servidor lo confirma después
        this.predictMove(currentRoom.sessionId, path, clickedAt);
      }
      this.clearPathPreview();
    });

    this.app.ticker.add(() => this.tick());
    this.syncSprites(room.state);
    this.syncBoosts(room.state);
    this.updateMovementRangePreview(room.state);
  }

  tick() {
    const now = performance.now();
    let index = 0;
    for (const marker of this.boostSprites.values()) {
      marker.orb.y = -40 + Math.sin(now / 450 + index++) * 5;
    }
    for (let i = this.pickupEffects.length - 1; i >= 0; i--) {
      const { effect, start, y } = this.pickupEffects[i];
      const age = (now - start) / 800;
      effect.y = y - age * 55;
      effect.alpha = Math.max(0, 1 - age);
      if (age >= 1) {
        effect.destroy();
        this.pickupEffects.splice(i, 1);
      }
    }
    for (let i = this.duelEffects.length - 1; i >= 0; i--) {
      const spell = this.duelEffects[i];
      const elapsed = this.serverNow() - spell.startTime;
      if (elapsed < 0) {
        spell.label.visible = false;
        continue;
      }
      if (elapsed >= spell.duration) {
        spell.label.destroy();
        this.duelEffects.splice(i, 1);
        continue;
      }

      spell.label.visible = true;
      spell.label.position.set(spell.x, spell.y - 112 - Math.min(elapsed / 20, 38));
      spell.label.alpha = Math.min(1, elapsed / 90) * Math.max(0, 1 - elapsed / spell.duration);
    }

    this.followPlayer();
    for (const [id, animation] of Object.entries(this.anims)) {
      const sprite = this.sprites[id];
      if (!sprite) {
        delete this.anims[id];
        continue;
      }
      const elapsed = Math.max(0, this.serverNow() - animation.startTime);
      const index = Math.floor(elapsed / animation.msPerTile);
      if (index >= animation.path.length - 1) {
        const last = animation.path.at(-1);
        this.place(sprite, last.x, last.y);
        setCharacterWalking(sprite.character, 0, 0, false);
        delete this.anims[id];
        this.duelBacktracks.delete(id);
        // esperamos a que el servidor confirme la llegada en vez de volver atrás
        if (this.prediction?.id === id) {
          this.holding.add(id);
          this.prediction = null;
        }
        continue;
      }
      const fraction = (elapsed % animation.msPerTile) / animation.msPerTile;
      const from = animation.path[index];
      const to = animation.path[index + 1];
      setCharacterWalking(sprite.character, to.x - from.x, to.y - from.y, true);
      this.place(sprite, from.x + (to.x - from.x) * fraction, from.y + (to.y - from.y) * fraction);
    }
  }

  followPlayer() {
    const room = this.getRoom();
    if (!room) return;
    const player = this.sprites[room.sessionId];
    if (!player) return;

    const scale = cameraScale(this.app.screen.width, this.app.screen.height, WORLD_SCALE);
    this.world.scale.set(scale);
    this.world.position.set(
      this.app.screen.width / 2 - player.position.x * scale,
      this.app.screen.height / 2 - player.position.y * scale,
    );
  }

  place(sprite, gx, gy) {
    const { x, y } = tileCenter(gx, gy);
    sprite.position.set(x, y);
    sprite.zIndex = gx + gy;
  }

  syncSprites(state) {
    if (!this.players) return;
    state.players.forEach((player, id) => {
      if (!this.sprites[id]) {
        const container = new Container();
        container.addChild(new Graphics().ellipse(0, 0, 14, 7).fill({ color: 0x000000, alpha: 0.35 }));
        const character = makeCharacterSprite(this.characterAnimations, player.team);
        container.character = character;
        container.addChild(character);
        const label = new Text({ text: player.name, style: {
          fontSize: 12, fontWeight: "600", fill: 0x493b2b,
          stroke: { color: 0xfff3d6, width: 3 },
        } });
        label.anchor.set(0.5, 1);
        label.y = -132;
        container.addChild(label);
        this.players.addChild(container);
        this.sprites[id] = container;
        this.place(container, player.x, player.y);
      }
      if (!player.moving) this.holding.delete(id);
      if (!this.anims[id] && !this.holding.has(id)) this.place(this.sprites[id], player.x, player.y);
    });
    for (const id of Object.keys(this.sprites)) {
      if (!state.players.has(id)) {
        this.sprites[id].destroy();
        delete this.sprites[id];
      }
    }
  }

  syncBoosts(state) {
    if (!this.boostLayer) return;
    state.boosts.forEach((boost, id) => {
      if (this.boostSprites.has(id)) return;
      const marker = createBoostOrb();
      this.place(marker, boost.x, boost.y);
      this.boostLayer.addChild(marker);
      this.boostSprites.set(id, marker);
    });
    for (const [id, marker] of this.boostSprites) {
      if (state.boosts.has(id)) continue;
      const effect = new Text({ text: "+1", style: {
        fontSize: 30, fontWeight: "bold", fill: 0xffefb4,
        stroke: { color: 0x416748, width: 4 },
      } });
      effect.anchor.set(0.5);
      effect.position.set(marker.x, marker.y - 40);
      this.boostLayer.addChild(effect);
      this.pickupEffects.push({ effect, start: performance.now(), y: effect.y });
      marker.destroy({ children: true });
      this.boostSprites.delete(id);
    }
  }

  showDuelSpell({ x, y, loserIds, startTime, duration }) {
    if (!this.world || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(startTime)
      || !Array.isArray(loserIds) || loserIds.length === 0) return;

    loserIds.forEach((id) => this.duelBacktracks.add(id));
    const position = tileCenter(x, y);
    const label = new Text({ text: "¡Expelliarmus!", style: {
      fontSize: 24, fontWeight: "bold", fill: 0xfff1b8,
      stroke: { color: 0x572d91, width: 5 },
    } });
    label.anchor.set(0.5);
    this.world.addChild(label);
    this.duelEffects.push({
      label,
      x: position.x,
      y: position.y,
      startTime,
      duration: Number.isFinite(duration) ? duration : 900,
    });
  }
}
