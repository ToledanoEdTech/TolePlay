import type { Rect, Vec2, TileZone } from '../types';

// ═══════════════════════════════════════════════════════════════════
// CTF ARENA — Brawl Stars style: expansive world, houses, crates, walls
// Red Base: left/bottom | Blue Base: right/top
// ═══════════════════════════════════════════════════════════════════

export interface MapObstacle extends Rect {
  type: 'wall' | 'house' | 'crate' | 'bush';
}

export const CTF_MAP = {
  width: 6000,
  height: 5000,
  tileSize: 40,

  redFlag: { x: 400, y: 4200 } as Vec2,
  blueFlag: { x: 5600, y: 800 } as Vec2,
  redSpawn: { x: 500, y: 4200 } as Vec2,
  blueSpawn: { x: 5500, y: 800 } as Vec2,

  // All obstacles with AABB collision (walls, houses, crates, bushes)
  obstacles: [
    // ═══ BOUNDARY ═══
    { x: 0, y: 0, w: 6000, h: 40, type: 'wall' as const },
    { x: 0, y: 4960, w: 6000, h: 40, type: 'wall' as const },
    { x: 0, y: 40, w: 40, h: 4920, type: 'wall' as const },
    { x: 5960, y: 40, w: 40, h: 4920, type: 'wall' as const },

    // ═══ RED BASE WALLS ═══
    { x: 800, y: 40, w: 40, h: 1800, type: 'wall' as const },
    { x: 800, y: 3160, w: 40, h: 1800, type: 'wall' as const },
    { x: 800, y: 1840, w: 280, h: 40, type: 'wall' as const },
    { x: 800, y: 3120, w: 280, h: 40, type: 'wall' as const },

    // ═══ BLUE BASE WALLS ═══
    { x: 5160, y: 40, w: 40, h: 1800, type: 'wall' as const },
    { x: 5160, y: 3160, w: 40, h: 1800, type: 'wall' as const },
    { x: 4900, y: 1840, w: 280, h: 40, type: 'wall' as const },
    { x: 4900, y: 3120, w: 280, h: 40, type: 'wall' as const },

    // ═══ HOUSES (stylized 2D buildings) ═══
    { x: 1200, y: 600, w: 180, h: 140, type: 'house' as const },
    { x: 1200, y: 3400, w: 180, h: 140, type: 'house' as const },
    { x: 4620, y: 600, w: 180, h: 140, type: 'house' as const },
    { x: 4620, y: 3400, w: 180, h: 140, type: 'house' as const },
    { x: 2600, y: 1200, w: 200, h: 160, type: 'house' as const },
    { x: 3200, y: 3640, w: 200, h: 160, type: 'house' as const },
    { x: 1800, y: 2200, w: 160, h: 120, type: 'house' as const },
    { x: 4040, y: 2280, w: 160, h: 120, type: 'house' as const },

    // ═══ CONCRETE WALLS ═══
    { x: 1500, y: 1200, w: 40, h: 400, type: 'wall' as const },
    { x: 1500, y: 3400, w: 40, h: 400, type: 'wall' as const },
    { x: 4460, y: 1200, w: 40, h: 400, type: 'wall' as const },
    { x: 4460, y: 3400, w: 40, h: 400, type: 'wall' as const },
    { x: 2700, y: 40, w: 40, h: 1100, type: 'wall' as const },
    { x: 3260, y: 40, w: 40, h: 1100, type: 'wall' as const },
    { x: 2700, y: 3860, w: 40, h: 1100, type: 'wall' as const },
    { x: 3260, y: 3860, w: 40, h: 1100, type: 'wall' as const },
    { x: 2700, y: 1100, w: 600, h: 40, type: 'wall' as const },
    { x: 2700, y: 3860, w: 600, h: 40, type: 'wall' as const },
    { x: 2100, y: 1800, w: 40, h: 900, type: 'wall' as const },
    { x: 3860, y: 1800, w: 40, h: 900, type: 'wall' as const },
    { x: 2100, y: 1800, w: 900, h: 40, type: 'wall' as const },
    { x: 2100, y: 2660, w: 900, h: 40, type: 'wall' as const },
    { x: 2800, y: 2100, w: 400, h: 460, type: 'wall' as const },

    // ═══ WOODEN CRATES ═══
    { x: 1000, y: 1000, w: 80, h: 80, type: 'crate' as const },
    { x: 1150, y: 3800, w: 80, h: 80, type: 'crate' as const },
    { x: 4920, y: 1000, w: 80, h: 80, type: 'crate' as const },
    { x: 4770, y: 3800, w: 80, h: 80, type: 'crate' as const },
    { x: 2300, y: 1400, w: 70, h: 70, type: 'crate' as const },
    { x: 3030, y: 3500, w: 70, h: 70, type: 'crate' as const },
    { x: 1700, y: 2500, w: 60, h: 60, type: 'crate' as const },
    { x: 3640, y: 2500, w: 60, h: 60, type: 'crate' as const },
    { x: 1400, y: 1600, w: 65, h: 65, type: 'crate' as const },
    { x: 3935, y: 2735, w: 65, h: 65, type: 'crate' as const },

    // ═══ BUSHES (decorative + collision) ═══
    { x: 950, y: 750, w: 90, h: 75, type: 'bush' as const },
    { x: 950, y: 4175, w: 90, h: 75, type: 'bush' as const },
    { x: 4960, y: 750, w: 90, h: 75, type: 'bush' as const },
    { x: 4960, y: 4175, w: 90, h: 75, type: 'bush' as const },
    { x: 2100, y: 1400, w: 85, h: 70, type: 'bush' as const },
    { x: 3815, y: 3530, w: 85, h: 70, type: 'bush' as const },
    { x: 2100, y: 3530, w: 85, h: 70, type: 'bush' as const },
    { x: 3815, y: 1400, w: 85, h: 70, type: 'bush' as const },
    { x: 1600, y: 2100, w: 70, h: 65, type: 'bush' as const },
    { x: 4330, y: 2400, w: 70, h: 65, type: 'bush' as const },
  ] as MapObstacle[],

  // Legacy compatibility
  get walls() { return this.obstacles.filter(o => o.type === 'wall' || !('type' in o)); },
  get houses() { return this.obstacles.filter(o => o.type === 'house'); },
  get crates() { return this.obstacles.filter(o => o.type === 'crate'); },
  get bushes() { return this.obstacles.filter(o => o.type === 'bush'); },

  zones: [
    { x: 0, y: 0, w: 840, h: 5000, color1: '#1a0a08', color2: '#2a0f0a' },
    { x: 5160, y: 0, w: 840, h: 5000, color1: '#080a1a', color2: '#0a0f2a' },
    { x: 840, y: 0, w: 800, h: 5000, color1: '#0c1410', color2: '#101a14' },
    { x: 4360, y: 0, w: 800, h: 5000, color1: '#0c1410', color2: '#101a14' },
    { x: 1640, y: 0, w: 2720, h: 5000, color1: '#0c1410', color2: '#101a14' },
  ] as TileZone[],
};
