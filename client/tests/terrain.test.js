import test from "node:test";
import assert from "node:assert/strict";
import { Container, Sprite, Texture } from "pixi.js";

globalThis.location ??= { hostname: "localhost" };
const { renderTerrainSurfaces } = await import("../src/gameVisuals.js");

test("real grass and ground textures share elevation and painter order", () => {
  const map = new Container();
  const floor = new Container({ label: "ground" });
  floor.getTile = (x, y) => [[11, 11], [12, 11], [11, 12]].some(([a, b]) => x === a && y === b)
    ? { tilesetIndex: 0, localId: 48 } : null;
  const grass = new Container({ label: "grass" });
  grass.tint = 0x91bb69;
  grass.getTile = (x, y) => x === 11 && y === 11 ? { tilesetIndex: 0, localId: 48 } : null;
  map.tileSetRenderers = [{ tileset: { tileoffset: { x: -12, y: 6 } },
    getTexture: () => Texture.EMPTY, getRenderWidth: () => 256, getRenderHeight: () => 352 }];
  const walls = new Container({ label: "walls" });
  map.addChild(floor, grass, walls);
  renderTerrainSurfaces(map);
  const surface = map.getChildByLabel("terrain-tiles");
  assert.ok(surface);
  assert.equal(surface.visible, true);
  assert.ok(!surface.mask);
  assert.equal(grass.visible, false);
  assert.equal(floor.visible, false);
  assert.ok(map.getChildIndex(floor) < map.getChildIndex(surface));
  assert.ok(map.getChildIndex(surface) < map.getChildIndex(walls));
  assert.equal(surface.children.length, 3, "Each cell is drawn exactly once");
  assert.deepEqual(surface.children.map((s) => s.label), ["grass:11,11", "ground:12,11", "ground:11,12"]);
  assert.ok(surface.children.every((s) => s instanceof Sprite && s.texture === Texture.EMPTY));
  assert.equal(surface.children[0].tint, 0x91bb69);
  assert.equal(surface.children[1].tint, 0xffffff);
  assert.equal(surface.children[1].y - surface.children[0].y, 55, "Neighbor uses the same tile elevation");
  map.destroy({ children: true });
});
