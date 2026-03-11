import type { Vec2, Rect } from './types';

export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

export function vec2Add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function vec2Sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function vec2Scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

export function vec2Len(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

export function vec2Normalize(v: Vec2): Vec2 {
  const len = vec2Len(v);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

export function vec2Dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function vec2Lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function rectContainsPoint(r: Rect, p: Vec2): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function circleRectOverlap(cx: number, cy: number, cr: number, rect: Rect): boolean {
  const nearestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const nearestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return (dx * dx + dy * dy) < (cr * cr);
}

/**
 * Resolves a circle's position against a set of wall rectangles,
 * pushing the circle out of any overlapping walls using slide-based resolution.
 */
export function resolveCircleWallCollisions(pos: Vec2, radius: number, walls: Rect[]): Vec2 {
  const resolved = { x: pos.x, y: pos.y };

  for (let pass = 0; pass < 3; pass++) {
    for (const wall of walls) {
      const nearestX = Math.max(wall.x, Math.min(resolved.x, wall.x + wall.w));
      const nearestY = Math.max(wall.y, Math.min(resolved.y, wall.y + wall.h));
      const dx = resolved.x - nearestX;
      const dy = resolved.y - nearestY;
      const distSq = dx * dx + dy * dy;

      if (distSq < radius * radius) {
        if (distSq > 0.001) {
          const dist = Math.sqrt(distSq);
          const overlap = radius - dist;
          resolved.x += (dx / dist) * overlap;
          resolved.y += (dy / dist) * overlap;
        } else {
          const pushLeft = resolved.x - wall.x;
          const pushRight = (wall.x + wall.w) - resolved.x;
          const pushUp = resolved.y - wall.y;
          const pushDown = (wall.y + wall.h) - resolved.y;
          const minPush = Math.min(pushLeft, pushRight, pushUp, pushDown);
          if (minPush === pushLeft) resolved.x = wall.x - radius;
          else if (minPush === pushRight) resolved.x = wall.x + wall.w + radius;
          else if (minPush === pushUp) resolved.y = wall.y - radius;
          else resolved.y = wall.y + wall.h + radius;
        }
      }
    }
  }

  return resolved;
}
