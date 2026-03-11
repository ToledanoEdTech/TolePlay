import type { Rect, Vec2, TileZone } from '../types';

export const CTF_MAP = {
  width: 2000,
  height: 1500,
  tileSize: 40,

  redFlag: { x: 150, y: 750 } as Vec2,
  blueFlag: { x: 1850, y: 750 } as Vec2,
  redSpawn: { x: 200, y: 750 } as Vec2,
  blueSpawn: { x: 1800, y: 750 } as Vec2,

  walls: [
    // ═══ Outer boundary ═══
    { x: 0, y: 0, w: 2000, h: 24 },
    { x: 0, y: 1476, w: 2000, h: 24 },
    { x: 0, y: 24, w: 24, h: 1452 },
    { x: 1976, y: 24, w: 24, h: 1452 },

    // ═══ Red base enclosure (gap y:544→956 for entrance) ═══
    { x: 306, y: 24, w: 24, h: 520 },
    { x: 306, y: 956, w: 24, h: 520 },

    // ═══ Blue base enclosure (mirror) ═══
    { x: 1670, y: 24, w: 24, h: 520 },
    { x: 1670, y: 956, w: 24, h: 520 },

    // ═══ Left corridor obstacles ═══
    { x: 420, y: 200, w: 24, h: 240 },
    { x: 420, y: 1060, w: 24, h: 240 },
    { x: 500, y: 540, w: 160, h: 24 },
    { x: 500, y: 936, w: 160, h: 24 },

    // ═══ Right corridor obstacles (mirror) ═══
    { x: 1556, y: 200, w: 24, h: 240 },
    { x: 1556, y: 1060, w: 24, h: 240 },
    { x: 1340, y: 540, w: 160, h: 24 },
    { x: 1340, y: 936, w: 160, h: 24 },

    // ═══ Center lane pillars ═══
    { x: 880, y: 24, w: 24, h: 360 },
    { x: 1096, y: 24, w: 24, h: 360 },
    { x: 880, y: 1116, w: 24, h: 360 },
    { x: 1096, y: 1116, w: 24, h: 360 },

    // Center bridges (top and bottom lane walls)
    { x: 880, y: 360, w: 240, h: 24 },
    { x: 880, y: 1116, w: 240, h: 24 },

    // Center block (solid cover)
    { x: 950, y: 660, w: 100, h: 180 },

    // ═══ Mid-field vertical cover ═══
    { x: 720, y: 620, w: 24, h: 260 },
    { x: 1256, y: 620, w: 24, h: 260 },

    // ═══ Scattered cover blocks ═══
    { x: 580, y: 330, w: 60, h: 24 },
    { x: 580, y: 1146, w: 60, h: 24 },
    { x: 1360, y: 330, w: 60, h: 24 },
    { x: 1360, y: 1146, w: 60, h: 24 },

    // Extra lane obstacles
    { x: 700, y: 430, w: 24, h: 60 },
    { x: 1276, y: 430, w: 24, h: 60 },
    { x: 700, y: 1010, w: 24, h: 60 },
    { x: 1276, y: 1010, w: 24, h: 60 },

    // Near-base defensive blocks
    { x: 380, y: 710, w: 40, h: 80 },
    { x: 1580, y: 710, w: 40, h: 80 },
  ] as Rect[],

  bushes: [
    { x: 370, y: 280, w: 50, h: 40 },
    { x: 370, y: 1180, w: 50, h: 40 },
    { x: 1580, y: 280, w: 50, h: 40 },
    { x: 1580, y: 1180, w: 50, h: 40 },
    { x: 800, y: 490, w: 55, h: 45 },
    { x: 1145, y: 965, w: 55, h: 45 },
    { x: 800, y: 965, w: 55, h: 45 },
    { x: 1145, y: 490, w: 55, h: 45 },
    { x: 620, y: 720, w: 45, h: 40 },
    { x: 1335, y: 740, w: 45, h: 40 },
  ] as Rect[],

  zones: [
    { x: 0, y: 0, w: 330, h: 1500, color1: '#1a0a0a', color2: '#1d0c0c' },
    { x: 1670, y: 0, w: 330, h: 1500, color1: '#0a0a1a', color2: '#0c0c1d' },
    { x: 330, y: 0, w: 550, h: 1500, color1: '#0f1520', color2: '#111824' },
    { x: 1120, y: 0, w: 550, h: 1500, color1: '#0f1520', color2: '#111824' },
    { x: 880, y: 0, w: 240, h: 1500, color1: '#101a12', color2: '#121e14' },
  ] as TileZone[],
};
