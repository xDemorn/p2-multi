import { AnimatedSprite, Texture } from "pixi.js";

const FRAME_WIDTH = 88;
const FRAME_HEIGHT = 128;
const FIT_PADDING = 4;

// Each source sheet has three rows: profile, back, front. The row and frame
// counts differ between sheets, so describe each sheet independently.
const CHARACTERS = {
  Gryffindor: { file: "Gryffindor.png", frames: [7, 6, 6], rows: [[38, 148], [227, 335], [423, 530]] },
  Ravenclaw: { file: "Ravenclaw.png", frames: [6, 6, 6], rows: [[48, 161], [235, 343], [420, 530]] },
  Slytherin: { file: "Slytherin.png", frames: [6, 6, 6], rows: [[58, 169], [213, 328], [370, 488]] },
  Hufflepuff: { file: "Hufflepuff.png", frames: [6, 6, 6], rows: [[59, 169], [237, 339], [409, 516]] },
  Beauxbatons: { file: "Beauxbatons.png", frames: [6, 5, 5], rows: [[11, 146], [185, 323], [362, 500]] },
  Durmstrang: { file: "Durmstrang.png", frames: [8, 6, 6], rows: [[62, 170], [219, 324], [376, 494]] },
};

const TEAM_CHARACTERS = [
  "Gryffindor", "Ravenclaw", "Slytherin", "Hufflepuff", "Beauxbatons", "Durmstrang",
];

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load character sheet: ${file}`));
    image.src = `/assets/characters/${file}`;
  });
}

function getOpaqueBounds(context, x, y, width, height) {
  const pixels = context.getImageData(x, y, width, height).data;
  let left = width, top = height, right = -1, bottom = -1;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      if (pixels[(py * width + px) * 4 + 3] === 0) continue;
      left = Math.min(left, px);
      top = Math.min(top, py);
      right = Math.max(right, px);
      bottom = Math.max(bottom, py);
    }
  }
  return right < 0 ? null : { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function makeFrameCanvas(image, sourceX, sourceY, sourceWidth, sourceHeight) {
  const scan = document.createElement("canvas");
  scan.width = Math.ceil(sourceWidth);
  scan.height = Math.ceil(sourceHeight);
  const scanContext = scan.getContext("2d", { willReadFrequently: true });
  scanContext.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, scan.width, scan.height);
  const bounds = getOpaqueBounds(scanContext, 0, 0, scan.width, scan.height);

  const canvas = document.createElement("canvas");
  canvas.width = FRAME_WIDTH;
  canvas.height = FRAME_HEIGHT;
  if (bounds) {
    const scale = Math.min(
      (FRAME_WIDTH - FIT_PADDING * 2) / bounds.width,
      (FRAME_HEIGHT - FIT_PADDING) / bounds.height,
    );
    const width = bounds.width * scale;
    const height = bounds.height * scale;
    const context = canvas.getContext("2d");
    context.imageSmoothingEnabled = false;
    context.drawImage(
      scan,
      bounds.left, bounds.top, bounds.width, bounds.height,
      (FRAME_WIDTH - width) / 2, FRAME_HEIGHT - height, width, height,
    );
  }
  return canvas;
}

function makeFrame(image, sourceX, sourceY, sourceWidth, sourceHeight) {
  return Texture.from(makeFrameCanvas(image, sourceX, sourceY, sourceWidth, sourceHeight));
}

export async function loadCharacterAnimations() {
  const animations = {};
  await Promise.all(Object.entries(CHARACTERS).map(async ([name, sheet]) => {
    const image = await loadImage(sheet.file);
    const rowNames = ["profile", "back", "front"];
    const rows = {};
    sheet.rows.forEach(([top, bottom], rowIndex) => {
      const count = sheet.frames[rowIndex];
      const frames = [];
      for (let frame = 0; frame < count; frame++) {
        const left = Math.round(frame * image.width / count);
        const right = Math.round((frame + 1) * image.width / count);
        frames.push(makeFrame(image, left, top, right - left, bottom - top + 1));
      }
      rows[rowNames[rowIndex]] = frames;
    });
    animations[name] = rows;
  }));
  return animations;
}

export function characterNameForTeam(team) {
  return TEAM_CHARACTERS[team - 1] ?? TEAM_CHARACTERS[0];
}

export function makeCharacterSprite(animations, team) {
  const rows = animations[characterNameForTeam(team)];
  const sprite = new AnimatedSprite(rows.front);
  sprite.anchor.set(0.5, 1);
  sprite.animationSpeed = 0.12;
  sprite.loop = true;
  sprite.stop();
  sprite.label = "player-character";
  sprite._rows = rows;
  sprite._walkDirection = null;
  sprite._baseScaleX = 1;
  return sprite;
}

export function setCharacterWalking(sprite, dx, dy, walking) {
  if (!walking) {
    sprite.gotoAndStop(0);
    sprite._walkDirection = null;
    return;
  }

  // Grid X uses the profile view; grid Y uses the front/back views.
  const direction = dx !== 0 ? "profile" : dy > 0 ? "front" : "back";
  const scaleX = direction === "profile" && dx < 0 ? -1 : 1;
  sprite.scale.x = scaleX;
  if (sprite._walkDirection === direction) return;
  sprite._walkDirection = direction;
  sprite.textures = sprite._rows[direction];
  sprite.gotoAndPlay(0);
}
