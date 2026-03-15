/**
 * CTF Render Cache & Spatial Grid
 * - Pre-rendered OffscreenCanvas assets (tree trunk, tree canopy, bases)
 * - Spatial chunking: only iterate obstacles in viewport-intersecting chunks
 */

import type { CTFObstacle } from '../../constants/ctfConstants';
import { BASE_RADIUS, RED_BASE_X, RED_BASE_Y, BLUE_BASE_X, BLUE_BASE_Y, WORLD_W, WORLD_H } from '../../constants/ctfConstants';

export const CHUNK_SIZE = 500;
export const MAX_CHUNK_COLUMNS = Math.max(1, Math.floor(WORLD_W / CHUNK_SIZE));
export const MAX_CHUNK_ROWS = Math.max(1, Math.floor(WORLD_H / CHUNK_SIZE));

const TREE_TRUNK_SIZE = 80;
const TREE_TRUNK_RADIUS = 34;
const TREE_CANOPY_SIZE = 240;
const TREE_CANOPY_RADIUS = 110;
const BASE_CANVAS_SIZE = 700;

export interface CachedAssets {
  treeTrunk: HTMLCanvasElement;
  treeCanopy: HTMLCanvasElement;
  baseRed: HTMLCanvasElement;
  baseBlue: HTMLCanvasElement;
}

function createTreeTrunkCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TREE_TRUNK_SIZE;
  c.height = TREE_TRUNK_SIZE;
  const ctx = c.getContext('2d')!;
  const cx = TREE_TRUNK_SIZE / 2;
  const cy = TREE_TRUNK_SIZE / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx + 2, cy + 2, TREE_TRUNK_RADIUS, TREE_TRUNK_RADIUS * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5c4033';
  ctx.beginPath();
  ctx.arc(cx, cy, TREE_TRUNK_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

function createTreeCanopyCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TREE_CANOPY_SIZE;
  c.height = TREE_CANOPY_SIZE;
  const ctx = c.getContext('2d')!;
  const cx = TREE_CANOPY_SIZE / 2;
  const cy = TREE_CANOPY_SIZE / 2;
  ctx.fillStyle = 'hsl(110, 55%, 28%)';
  ctx.beginPath();
  for (let j = 0; j < 12; j++) {
    const a = (j / 12) * Math.PI * 2;
    const r = TREE_CANOPY_RADIUS * (0.88 + Math.sin(j * 1.2) * 0.14);
    if (j === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath();
  ctx.arc(cx - TREE_CANOPY_RADIUS * 0.2, cy - TREE_CANOPY_RADIUS * 0.2, TREE_CANOPY_RADIUS * 0.55, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

function createBaseCanvas(isRed: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = BASE_CANVAS_SIZE;
  c.height = BASE_CANVAS_SIZE;
  const ctx = c.getContext('2d')!;
  const cx = BASE_CANVAS_SIZE / 2;
  ctx.fillStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.arc(cx, cx, BASE_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, BASE_RADIUS);
  grad.addColorStop(0, isRed ? 'rgba(239, 68, 68, 0.4)' : 'rgba(59, 130, 246, 0.4)');
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cx, BASE_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = isRed ? '#991b1b' : '#1e40af';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(cx, cx, BASE_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  return c;
}

let cachedAssets: CachedAssets | null = null;

export function getCachedAssets(): CachedAssets {
  if (!cachedAssets) {
    cachedAssets = {
      treeTrunk: createTreeTrunkCanvas(),
      treeCanopy: createTreeCanopyCanvas(),
      baseRed: createBaseCanvas(true),
      baseBlue: createBaseCanvas(false),
    };
  }
  return cachedAssets;
}

export const TREE_TRUNK_HALF = TREE_TRUNK_SIZE / 2;
export const TREE_CANOPY_HALF = TREE_CANOPY_SIZE / 2;
export const BASE_CANVAS_HALF = BASE_CANVAS_SIZE / 2;

/** Build spatial grid: chunk key -> list of obstacles in that chunk. Indices clamped to prevent out-of-bounds. */
export function buildSpatialGrid(obstacles: CTFObstacle[]): Map<string, CTFObstacle[]> {
  const grid = new Map<string, CTFObstacle[]>();
  const cols = MAX_CHUNK_COLUMNS - 1;
  const rows = MAX_CHUNK_ROWS - 1;
  for (const obs of obstacles) {
    const ox = typeof obs.x === 'number' && Number.isFinite(obs.x) ? obs.x : 0;
    const oy = typeof obs.y === 'number' && Number.isFinite(obs.y) ? obs.y : 0;
    const cx = Math.max(0, Math.min(cols, Math.floor(ox / CHUNK_SIZE)));
    const cy = Math.max(0, Math.min(rows, Math.floor(oy / CHUNK_SIZE)));
    const key = `${cx},${cy}`;
    const list = grid.get(key);
    if (list) list.push(obs);
    else grid.set(key, [obs]);
  }
  return grid;
}

/** Get only tree obstacles that intersect the viewport (using chunk grid). Chunk indices clamped to array bounds. */
export function getVisibleTrees(
  grid: Map<string, CTFObstacle[]>,
  vLeft: number,
  vRight: number,
  vTop: number,
  vBottom: number
): CTFObstacle[] {
  if (![vLeft, vRight, vTop, vBottom].every((n) => typeof n === 'number' && Number.isFinite(n))) return [];
  const maxCol = MAX_CHUNK_COLUMNS - 1;
  const maxRow = MAX_CHUNK_ROWS - 1;
  const cxMin = Math.max(0, Math.min(maxCol, Math.floor(vLeft / CHUNK_SIZE)));
  const cxMax = Math.max(0, Math.min(maxCol, Math.floor(vRight / CHUNK_SIZE)));
  const cyMin = Math.max(0, Math.min(maxRow, Math.floor(vTop / CHUNK_SIZE)));
  const cyMax = Math.max(0, Math.min(maxRow, Math.floor(vBottom / CHUNK_SIZE)));
  if (cxMin > cxMax || cyMin > cyMax) return [];
  const out: CTFObstacle[] = [];
  for (let cy = cyMin; cy <= cyMax; cy++) {
    for (let cx = cxMin; cx <= cxMax; cx++) {
      const key = `${cx},${cy}`;
      const list = grid.get(key);
      if (!list?.length) continue;
      for (const obs of list) {
        if (obs?.type !== 'tree') continue;
        const r = (obs.visualRadius ?? obs.radius ?? 60) || 60;
        const ox = obs.x ?? 0;
        const oy = obs.y ?? 0;
        if (ox + r < vLeft || ox - r > vRight || oy + r < vTop || oy - r > vBottom) continue;
        out.push(obs);
      }
    }
  }
  return out;
}

export { RED_BASE_X, RED_BASE_Y, BLUE_BASE_X, BLUE_BASE_Y, BASE_RADIUS };
