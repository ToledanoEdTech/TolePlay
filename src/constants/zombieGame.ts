// Shared constants for Zombie Defense - MUST match server!

export const ZOMBIE_WORLD_SIZE = 4000;
export const ZOMBIE_BASE_X = 2000;
export const ZOMBIE_BASE_Y = 2000;

// Turret build range from base (min/max distance)
export const ZOMBIE_TURRET_MIN_DIST = 120;
export const ZOMBIE_TURRET_MAX_DIST = 250;

// Base
export const ZOMBIE_BASE_MAX_HP = 2000;
export const ZOMBIE_PLAYER_START_AMMO = 50;
export const ZOMBIE_AMMO_REGEN_AMOUNT = 5;
export const ZOMBIE_AMMO_REGEN_INTERVAL_MS = 3000;
export const ZOMBIE_AMMO_QUIZ_REWARD = 15;
export const ZOMBIE_AMMO_MAX = 99;

// Zombie spawn (formula: baseRate = 0.08 + wave*0.02, scaleFactor = 0.5 + playerCount*0.05, spawnChance = min(0.25, baseRate*scaleFactor) per tick)
export const ZOMBIE_SPAWN_BASE_RATE = 0.08;
export const ZOMBIE_SPAWN_WAVE_FACTOR = 0.02;
export const ZOMBIE_SPAWN_SCALE_BASE = 0.5;
export const ZOMBIE_SPAWN_SCALE_PER_PLAYER = 0.05;
export const ZOMBIE_SPAWN_CHANCE_CAP = 0.25;

// Zombie stats: hp = 25 + wave*8, speed = 10 + wave*0.8
export const ZOMBIE_HP_BASE = 25;
export const ZOMBIE_HP_PER_WAVE = 8;
export const ZOMBIE_SPEED_BASE = 10;
export const ZOMBIE_SPEED_PER_WAVE = 0.8;

// Base damage radius (zombie damages base when dist <= this)
export const ZOMBIE_BASE_DAMAGE_RADIUS = 80;

// Rewards per kill
export const ZOMBIE_COINS_PER_KILL = 50;
export const ZOMBIE_SCORE_PER_KILL = 10;

// Win: survive X waves (e.g. 5)
export const ZOMBIE_WAVES_TO_WIN = 5;
export const ZOMBIE_WAVE_INTERVAL_MS = 60000;
