import type { CameraState, Vec2 } from './types';

export function createCamera(x: number = 0, y: number = 0, zoom: number = 1): CameraState {
  return { x, y, zoom };
}

export function updateCamera(
  cam: CameraState,
  target: Vec2,
  viewportW: number,
  viewportH: number,
  worldW: number,
  worldH: number,
  smoothing: number = 0.08
): void {
  const vpW = viewportW / cam.zoom;
  const vpH = viewportH / cam.zoom;
  const targetX = target.x - vpW / 2;
  const targetY = target.y - vpH / 2;

  cam.x += (targetX - cam.x) * smoothing;
  cam.y += (targetY - cam.y) * smoothing;

  const maxX = Math.max(0, worldW - vpW);
  const maxY = Math.max(0, worldH - vpH);
  cam.x = Math.max(0, Math.min(maxX, cam.x));
  cam.y = Math.max(0, Math.min(maxY, cam.y));
}

export function worldToScreen(cam: CameraState, worldPos: Vec2): Vec2 {
  return {
    x: (worldPos.x - cam.x) * cam.zoom,
    y: (worldPos.y - cam.y) * cam.zoom,
  };
}

export function screenToWorld(cam: CameraState, screenPos: Vec2): Vec2 {
  return {
    x: screenPos.x / cam.zoom + cam.x,
    y: screenPos.y / cam.zoom + cam.y,
  };
}

export function isInView(
  cam: CameraState,
  worldPos: Vec2,
  margin: number,
  vpW: number,
  vpH: number
): boolean {
  const sx = (worldPos.x - cam.x) * cam.zoom;
  const sy = (worldPos.y - cam.y) * cam.zoom;
  return sx >= -margin && sx <= vpW + margin && sy >= -margin && sy <= vpH + margin;
}

/** Check if a rect intersects the camera view (for walls that span large areas) */
export function isRectInView(
  rect: { x: number; y: number; w: number; h: number },
  cam: CameraState,
  vpW: number,
  vpH: number,
  margin: number = 0
): boolean {
  const vpWorldW = vpW / cam.zoom;
  const vpWorldH = vpH / cam.zoom;
  const viewLeft = cam.x - margin;
  const viewRight = cam.x + vpWorldW + margin;
  const viewTop = cam.y - margin;
  const viewBottom = cam.y + vpWorldH + margin;
  return rect.x + rect.w >= viewLeft && rect.x <= viewRight &&
         rect.y + rect.h >= viewTop && rect.y <= viewBottom;
}
