// ═══════════════════════════════════════════════════════════════════
// CTF (Capture the Flag) — shared constants for world, bases, weapons
// ═══════════════════════════════════════════════════════════════════

export const WORLD_W = 10000;
export const WORLD_H = 6000;
export const RED_BASE_X = 1000;
export const RED_BASE_Y = 3000;
export const BLUE_BASE_X = 9000;
export const BLUE_BASE_Y = 3000;

export const BASE_RADIUS = 350;
export const PLAYER_RADIUS = 25;
export const FLAG_RADIUS = 20;
export const MAX_ENERGY = 100;
export const MAX_HEALTH = 100;
export const MAX_AMMO = 150;
export const STARTING_AMMO = 30;
export const AMMO_REWARD = 25;
export const COIN_KILL_REWARD = 100;
export const COIN_TRIVIA_REWARD = 50;

export const MOVEMENT_SPEED = 480;
export const SPRINT_MULTIPLIER = 1.4;
export const FLAG_PICKUP_DIST = 60;
export const FLAG_CAPTURE_DIST = 250;
export const WIN_SCORE = 3;
export const BULLET_LIFETIME = 1.5;
export const RESPAWN_SECONDS = 6;

export interface WeaponDef {
  id: string;
  name: string;
  cost: number;
  fireRate: number;
  damage: number;
  bulletSpeed: number;
  spread: number;
  pellets: number;
  color: string;
  desc: string;
}

export const CTF_WEAPONS: Record<string, WeaponDef> = {
  pistol: {
    id: 'pistol',
    name: 'אקדח קלאסי',
    cost: 0,
    fireRate: 0.35,
    damage: 25,
    bulletSpeed: 1000,
    spread: 0.05,
    pellets: 1,
    color: '#fca5a5',
    desc: 'נשק התחלתי אמין ומדויק.',
  },
  shotgun: {
    id: 'shotgun',
    name: 'שוטגאן',
    cost: 300,
    fireRate: 0.9,
    damage: 20,
    bulletSpeed: 900,
    spread: 0.25,
    pellets: 5,
    color: '#fb923c',
    desc: 'יורה 5 כדורים במקביל. קטלני מקרוב.',
  },
  ar: {
    id: 'ar',
    name: 'רובה סער',
    cost: 600,
    fireRate: 0.12,
    damage: 14,
    bulletSpeed: 1200,
    spread: 0.08,
    pellets: 1,
    color: '#fcd34d',
    desc: 'קצב אש מטורף. אוכל תחמושת מהר.',
  },
  sniper: {
    id: 'sniper',
    name: 'רובה צלפים',
    cost: 1000,
    fireRate: 1.5,
    damage: 85,
    bulletSpeed: 2500,
    spread: 0.01,
    pellets: 1,
    color: '#a78bfa',
    desc: 'קליע סופר-מהיר וקטלני. דורש דיוק.',
  },
  rocket: {
    id: 'rocket',
    name: 'משגר פלזמה',
    cost: 1500,
    fireRate: 2.0,
    damage: 100,
    bulletSpeed: 600,
    spread: 0,
    pellets: 1,
    color: '#4ade80',
    desc: 'קליע איטי אך הרסני. מחסל במכה אחת.',
  },
};

export const CTF_WEAPON_LIST = Object.values(CTF_WEAPONS);

export type CTFTeam = 'red' | 'blue';

export interface CTFObstacle {
  id: string;
  x: number;
  y: number;
  radius: number;
  visualRadius: number;
  type: 'tree' | 'rock' | 'crate';
  seed: number;
}

export interface CTFTerrainPatch {
  x: number;
  y: number;
  radius: number;
  type: 'dirt' | 'darkGrass';
}

export interface CTFFlagState {
  x: number;
  y: number;
  team: CTFTeam;
  carrier: string | null;
}

export interface CTFBullet {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  team: CTFTeam;
  ownerId: string;
  life: number;
  damage: number;
  color: string;
}
