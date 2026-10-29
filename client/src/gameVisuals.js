import { Container, Graphics, Sprite, Text } from "pixi.js";
import { GRID, TW, TH } from "./utils/constants.js";
import { toScreen } from "./utils/functions.js";

// All floor images share one painter's order. A separate grass layer would draw
// its cube sides over neighboring ground, making a level floor look elevated.
export function renderTerrainSurfaces(map) {
  const floor = map.getChildByLabel("ground");
  if (!floor) return;
  const layers = ["sanctuary", "grass", "ground"].map((name) => map.getChildByLabel(name)).filter(Boolean);
  const terrain = new Container({ label: "terrain-tiles", eventMode: "none" });
  const context = { tilewidth: TW, tileheight: TH };
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      for (const layer of layers) {
        const tile = layer.getTile(x, y);
        if (!tile) continue;
        const renderer = map.tileSetRenderers[tile.tilesetIndex];
        const texture = renderer.getTexture(tile.localId);
        if (!texture) throw new Error(`Missing terrain texture: ${tile.localId}`);
        const sprite = new Sprite(texture);
        const p = toScreen(x, y);
        const offset = renderer.tileset.tileoffset;
        sprite.width = renderer.getRenderWidth(tile.localId, context);
        sprite.height = renderer.getRenderHeight(tile.localId, context);
        sprite.position.set(p.x + offset.x + layer.x, p.y + offset.y + TH - sprite.height + layer.y);
        sprite.tint = layer.tint;
        sprite.label = `${layer.label}:${x},${y}`;
        terrain.addChild(sprite);
        break;
      }
    }
  }
  for (const layer of layers) layer.visible = false;
  map.addChildAt(terrain, map.getChildIndex(floor) + 1);
}

export function createBoostOrb() {
  const marker = new Container();
  marker.eventMode = "none";
  marker.addChild(new Graphics().ellipse(0, 0, 23, 9).fill({ color: 0x3b4d36, alpha: .2 }));
  const orb = new Container();
  orb.y = -40;
  orb.addChild(new Graphics()
    .circle(0, 0, 37).fill({ color: 0xffd66b, alpha: .12 })
    .circle(0, 0, 30).stroke({ color: 0xf8d47c, width: 1.5, alpha: .6 })
    .circle(0, 0, 25).fill(0x276e70).stroke({ color: 0xffe4a1, width: 3 })
    .circle(0, -2, 20).fill(0x398e88)
    .ellipse(-8, -13, 8, 4).fill({ color: 0xffffff, alpha: .35 })
    .star(29, -24, 4, 7, 2).fill(0xffe7a6));
  const label = new Text({ text: "+1", style: {
    fontFamily: "Georgia", fontSize: 26, fontWeight: "bold", fill: 0xfff4cf,
    stroke: { color: 0x245f5b, width: 2 },
  } });
  label.anchor.set(.5);
  orb.addChild(label);
  marker.addChild(orb);
  marker.orb = orb;
  return marker;
}

export function addSanctuaryEmblem(world) {
  const p = toScreen(29.5, 29.5);
  const cx = p.x + TW / 2, cy = p.y - TH / 2;
  const emblem = new Graphics();
  for (const radius of [1.3, 1.65]) {
    emblem.poly([cx, cy - TH * radius / 2, cx + TW * radius / 2, cy,
      cx, cy + TH * radius / 2, cx - TW * radius / 2, cy])
      .stroke({ color: 0xaf792d, width: 3, alpha: .65 });
  }
  emblem.ellipse(cx, cy, 16, 8).fill({ color: 0xaf792d, alpha: .65 });
  world.addChild(emblem);
}
