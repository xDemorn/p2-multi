import test from "node:test";
import assert from "node:assert/strict";
import { cameraScale } from "../src/utils/camera.js";

test("browser zoom preserves the reference camera view", () => {
  for (const zoom of [0.25, 0.5, 0.8, 1, 1.25, 2, 5]) {
    const width = 1920 / zoom;
    const height = 910 / zoom;
    const scale = cameraScale(width, height, 0.6);
    assert.ok(Math.abs(width / scale - 1920 / 0.6) < 1e-9);
    assert.ok(Math.abs(height / scale - 910 / 0.6) < 1e-9);
  }
});

test("window sizes never reveal more map than the reference frame", () => {
  for (const [width, height] of [[3440, 1440], [1280, 1024], [390, 844], [1920, 910]]) {
    const scale = cameraScale(width, height, 0.6);
    assert.ok(width / scale <= 1920 / 0.6 + 1e-9);
    assert.ok(height / scale <= 910 / 0.6 + 1e-9);
  }
  assert.equal(cameraScale(1920, 910, 0.6), 0.6);
});
