// Seeded world objects for Boss Battle - consistent across clients
const WORLD = 3000;
const SEED = 12345;

function seededRandom(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export type WorldObjType = 'tree' | 'bush' | 'house' | 'path' | 'rock' | 'barrel' | 'fence' | 'lamp' | 'crate' | 'weaponBox';

export interface WorldObject {
  type: WorldObjType;
  x: number;
  y: number;
  w: number;
  h: number;
  variant?: number;
  id?: string;
}

const objects: WorldObject[] = [];
let _seed = SEED;

// Paths - winding roads
for (let i = 0; i < 8; i++) {
  const startX = 200 + (seededRandom(_seed++) * (WORLD - 400));
  const startY = 200 + (seededRandom(_seed++) * (WORLD - 400));
  let px = startX, py = startY;
  for (let j = 0; j < 25; j++) {
    objects.push({ type: 'path', x: px, y: py, w: 80, h: 40, variant: j % 3 });
    const angle = seededRandom(_seed++) * Math.PI * 2;
    px += Math.cos(angle) * 90;
    py += Math.sin(angle) * 90;
    if (px < 50 || px > WORLD - 50 || py < 50 || py > WORLD - 50) break;
  }
}

// Trees - clusters
for (let c = 0; c < 35; c++) {
  const cx = 150 + seededRandom(_seed++) * (WORLD - 300);
  const cy = 150 + seededRandom(_seed++) * (WORLD - 300);
  const count = 2 + Math.floor(seededRandom(_seed++) * 4);
  for (let i = 0; i < count; i++) {
    const dx = (seededRandom(_seed++) - 0.5) * 120;
    const dy = (seededRandom(_seed++) - 0.5) * 120;
    objects.push({ type: 'tree', x: cx + dx, y: cy + dy, w: 45, h: 60, variant: Math.floor(seededRandom(_seed++) * 3) });
  }
}

// Bushes - scattered
for (let i = 0; i < 120; i++) {
  objects.push({
    type: 'bush',
    x: 80 + seededRandom(_seed++) * (WORLD - 160),
    y: 80 + seededRandom(_seed++) * (WORLD - 160),
    w: 35 + seededRandom(_seed++) * 25,
    h: 30 + seededRandom(_seed++) * 20,
    variant: Math.floor(seededRandom(_seed++) * 4)
  });
}

// Houses - scattered
for (let i = 0; i < 15; i++) {
  objects.push({
    type: 'house',
    x: 200 + seededRandom(_seed++) * (WORLD - 400),
    y: 200 + seededRandom(_seed++) * (WORLD - 400),
    w: 80 + seededRandom(_seed++) * 40,
    h: 70 + seededRandom(_seed++) * 30,
    variant: Math.floor(seededRandom(_seed++) * 4)
  });
}

// Rocks
for (let i = 0; i < 45; i++) {
  objects.push({
    type: 'rock',
    x: 50 + seededRandom(_seed++) * (WORLD - 100),
    y: 50 + seededRandom(_seed++) * (WORLD - 100),
    w: 25 + seededRandom(_seed++) * 25,
    h: 20 + seededRandom(_seed++) * 20,
    variant: Math.floor(seededRandom(_seed++) * 3)
  });
}

// Barrels/crates - industrial
for (let i = 0; i < 30; i++) {
  objects.push({
    type: seededRandom(_seed++) > 0.5 ? 'barrel' : 'crate',
    x: 100 + seededRandom(_seed++) * (WORLD - 200),
    y: 100 + seededRandom(_seed++) * (WORLD - 200),
    w: 28, h: 35,
    variant: Math.floor(seededRandom(_seed++) * 2)
  });
}

// Fences
for (let i = 0; i < 12; i++) {
  const x = 150 + seededRandom(_seed++) * (WORLD - 300);
  const y = 150 + seededRandom(_seed++) * (WORLD - 300);
  const len = 3 + Math.floor(seededRandom(_seed++) * 5);
  for (let j = 0; j < len; j++) {
    objects.push({ type: 'fence', x: x + j * 35, y: y, w: 30, h: 25, variant: 0 });
  }
}

// Street lamps
for (let i = 0; i < 20; i++) {
  objects.push({
    type: 'lamp',
    x: 100 + seededRandom(_seed++) * (WORLD - 200),
    y: 100 + seededRandom(_seed++) * (WORLD - 200),
    w: 15, h: 55,
    variant: Math.floor(seededRandom(_seed++) * 2)
  });
}

// Weapon boxes - openable crates with ammo/weapons (fixed seed for server sync)
const BOX_SEED = 55555;
let boxSeed = BOX_SEED;
for (let i = 0; i < 18; i++) {
  objects.push({
    type: 'weaponBox',
    id: `box_${i}`,
    x: 200 + seededRandom(boxSeed++) * (WORLD - 400),
    y: 200 + seededRandom(boxSeed++) * (WORLD - 400),
    w: 45, h: 40,
    variant: Math.floor(seededRandom(boxSeed++) * 3)
  });
}

export const WORLD_OBJECTS = objects;

export function getWeaponBoxes(): WorldObject[] {
  return objects.filter(o => o.type === 'weaponBox');
}

export function getObjectsInView(camX: number, camY: number, vpW: number, vpH: number, margin = 150): WorldObject[] {
  return objects.filter(o => {
    return o.x + o.w >= camX - margin && o.x - o.w <= camX + vpW + margin &&
           o.y + o.h >= camY - margin && o.y - o.h <= camY + vpH + margin;
  });
}
