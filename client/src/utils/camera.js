// encuadre de referencia: lo cubrimos para no enseñar más mapa al hacer zoom
const REFERENCE_WIDTH = 1920;
const REFERENCE_HEIGHT = 910;

export function cameraScale(width, height, baseScale) {
  return baseScale * Math.max(width / REFERENCE_WIDTH, height / REFERENCE_HEIGHT);
}
