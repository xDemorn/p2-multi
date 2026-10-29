// Game viewport in the reference screenshot. Cover this frame so changes to
// browser zoom or window proportions never expose additional map area.
const REFERENCE_WIDTH = 1920;
const REFERENCE_HEIGHT = 910;

export function cameraScale(width, height, baseScale) {
  return baseScale * Math.max(width / REFERENCE_WIDTH, height / REFERENCE_HEIGHT);
}
