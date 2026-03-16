import 'dotenv/config';
import express from "express";
import { createServer as createViteServer } from "vite";
import { Server } from "socket.io";
import http from "http";
import { initFirebase, getDb } from './firebase-config.js';

const PORT = Number(process.env.PORT) || 3000;

interface Player {
  id: string;
  name: string;
  score: number;
  resources: number; // Universal currency (Gold, Cash, Damage Points, Energy, etc.)
  socketId: string;
  x: number;
  y: number;
  modeState: any;
}

interface GameRoom {
  code: string;
  hostId: string;
  players: Record<string, Player>;
  state: 'lobby' | 'playing' | 'ended';
  mode: string;
  questions: any[];
  globalState: any;
  startTime?: number;
}

const rooms: Record<string, GameRoom> = {};

// Zombie mode: weapon definitions (match client exmpl.html)
const ZOMBIE_WEAPONS: Record<string, { damage: number; fireRate: number; cost: number; color: string }> = {
  pistol: { damage: 25, fireRate: 400, cost: 0, color: '#06b6d4' },
  rifle: { damage: 40, fireRate: 150, cost: 500, color: '#eab308' },
  shotgun: { damage: 30, fireRate: 800, cost: 800, color: '#f97316' },
  sniper: { damage: 150, fireRate: 1200, cost: 1500, color: '#38bdf8' },
};

// CTF mode: world and weapon definitions (match client ctfConstants)
const CTF_WORLD_W = 10000;
const CTF_WORLD_H = 6000;
const CTF_RED_BASE_X = 1000;
const CTF_RED_BASE_Y = 3000;
const CTF_BLUE_BASE_X = 9000;
const CTF_BLUE_BASE_Y = 3000;
const CTF_BASE_RADIUS = 350;
const CTF_PLAYER_RADIUS = 25;
const CTF_FLAG_PICKUP_DIST = 60;
const CTF_FLAG_CAPTURE_DIST = 250;
const CTF_WIN_SCORE = 3;
const CTF_BULLET_LIFETIME = 1.5;
const CTF_RESPAWN_SECONDS = 6;
const CTF_MOVEMENT_SPEED = 480;
const CTF_SPRINT_MULTIPLIER = 1.4;
const CTF_MAX_ENERGY = 100;
const CTF_MAX_HEALTH = 100;
const CTF_MAX_AMMO = 150;
const CTF_STARTING_AMMO = 30;
const CTF_AMMO_REWARD = 25;
const CTF_COIN_TRIVIA_REWARD = 50;
const CTF_COIN_KILL_REWARD = 100;
const CTF_WEAPONS: Record<string, { fireRate: number; damage: number; bulletSpeed: number; spread: number; pellets: number; color: string }> = {
  pistol: { fireRate: 0.35, damage: 25, bulletSpeed: 1000, spread: 0.05, pellets: 1, color: '#fca5a5' },
  shotgun: { fireRate: 0.9, damage: 20, bulletSpeed: 900, spread: 0.25, pellets: 5, color: '#fb923c' },
  ar: { fireRate: 0.12, damage: 14, bulletSpeed: 1200, spread: 0.08, pellets: 1, color: '#fcd34d' },
  sniper: { fireRate: 1.5, damage: 85, bulletSpeed: 2500, spread: 0.01, pellets: 1, color: '#a78bfa' },
  rocket: { fireRate: 2.0, damage: 100, bulletSpeed: 600, spread: 0, pellets: 1, color: '#4ade80' },
};

function generateCTFWorld() {
  const obstacles: any[] = [];
  const terrain: any[] = [];
  const numObstacles = 400;
  for (let i = 0; i < 200; i++) {
    terrain.push({
      x: Math.random() * CTF_WORLD_W,
      y: Math.random() * CTF_WORLD_H,
      radius: Math.random() * 300 + 100,
      type: Math.random() > 0.5 ? 'dirt' : 'darkGrass',
    });
  }
  for (let i = 0; i < numObstacles; i++) {
    let x = Math.random() * CTF_WORLD_W;
    let y = Math.random() * CTF_WORLD_H;
    if (Math.hypot(x - CTF_RED_BASE_X, y - CTF_RED_BASE_Y) < CTF_BASE_RADIUS + 200) continue;
    if (Math.hypot(x - CTF_BLUE_BASE_X, y - CTF_BLUE_BASE_Y) < CTF_BASE_RADIUS + 200) continue;
    if (y > CTF_WORLD_H / 2 - 250 && y < CTF_WORLD_H / 2 + 250 && Math.random() > 0.15) continue;
    const rand = Math.random();
    let type: 'tree' | 'rock' | 'crate' = 'tree';
    let radius = 20;
    let visualRadius = 60;
    if (rand > 0.8) {
      type = 'rock';
      radius = Math.random() * 30 + 30;
      visualRadius = radius;
    } else if (rand > 0.7) {
      type = 'crate';
      radius = 25;
      visualRadius = 25;
    } else {
      radius = Math.random() * 10 + 15;
      visualRadius = Math.random() * 50 + 70;
    }
    obstacles.push({ id: `obs_${i}`, x, y, radius, visualRadius, type, seed: Math.random() });
  }
  return { obstacles, terrain };
}

function checkWinCondition(io: Server, code: string) {
  const room = rooms[code];
  if (!room || room.state !== 'playing') return;
  let winner: string | null = null;
  if (room.mode === 'economy') {
    const p = Object.values(room.players).find((p: any) => p.resources >= 5000);
    if (p) winner = (p as any).name;
  } else if (room.mode === 'zombie') {
    if (room.globalState.baseHealth <= 0) winner = "הזומבים";
  } else if (room.mode === 'boss') {
    const useAiBoss = room.globalState.useAiBoss;
    const aiBoss = room.globalState.aiBoss;
    const bossIds = room.globalState.bossIds || [];
    const heroes = Object.values(room.players).filter((p: any) => !p.modeState?.isBoss && (p.modeState?.hp ?? 2) > 0);
    if (useAiBoss && aiBoss) {
      if (aiBoss.hp <= 0) winner = "הגיבורים";
      else if (heroes.length === 0) winner = "המפלצת הענקית";
    } else {
      const bosses = bossIds.map((id: string) => room.players[id]).filter(Boolean);
      const aliveBosses = bosses.filter((b: any) => (b.modeState?.hp ?? 0) > 0);
      if (aliveBosses.length === 0) winner = "הגיבורים";
      else if (room.globalState.timeLeft <= 0) winner = bosses[0]?.name || "הבוס";
    }
  } else if (room.mode === 'ctf') {
    if (room.globalState.redScore >= 3) winner = "קבוצה אדומה";
    if (room.globalState.blueScore >= 3) winner = "קבוצה כחולה";
  }
  if (winner) {
    room.state = 'ended';
    const payload: any = { winner };
    if (room.mode === 'boss') {
      payload.mode = 'boss';
      payload.players = Object.entries(room.players).map(([id, p]: [string, any]) => ({
        id,
        name: p.name,
        score: p.score ?? 0,
        correctAnswers: p.modeState?.correctAnswers ?? 0
      }));
    }
    io.to(code).emit("gameOver", payload);
    persistGameResult(room, winner);
  }
}

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function persistRoom(room: GameRoom) {
  const db = getDb();
  if (!db) return;
  db.ref(`rooms/${room.code}`).set({
    code: room.code,
    mode: room.mode,
    state: room.state,
    playerCount: Object.keys(room.players).length,
    players: Object.values(room.players).map(p => ({
      id: p.id, name: p.name, score: p.score, resources: p.resources
    })),
    createdAt: room.startTime || Date.now(),
    updatedAt: Date.now()
  }).catch(err => console.error('[Firebase] persistRoom failed:', err));
}

function persistGameResult(room: GameRoom, winner: string) {
  const db = getDb();
  if (!db) return;
  db.ref('gameHistory').push({
    roomCode: room.code,
    mode: room.mode,
    winner,
    players: Object.values(room.players).map(p => ({
      name: p.name, score: p.score, resources: p.resources
    })),
    startedAt: room.startTime || null,
    endedAt: Date.now()
  }).catch(err => console.error('[Firebase] persistGameResult failed:', err));
  db.ref(`rooms/${room.code}`).remove().catch(() => {});
}

function removeRoomFromDb(code: string) {
  const db = getDb();
  if (!db) return;
  db.ref(`rooms/${code}`).remove().catch(() => {});
}

async function startServer() {
  initFirebase();

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
  });

  app.use(express.json());

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("createRoom", ({ mode, questions }, callback) => {
      const code = generateRoomCode();
      rooms[code] = {
        code,
        hostId: socket.id,
        players: {},
        state: 'lobby',
        mode,
        questions: questions || [],
        globalState: {}
      };
      
      if (mode === 'zombie') {
        rooms[code].globalState = {
          worldSize: 4000,
          baseX: 2000,
          baseY: 2000,
          baseRadius: 85,
          baseHealth: 1000,
          maxBaseHealth: 1000,
          wave: 1,
          zombies: [],
          lasers: [],
          turrets: [],
          particles: [],
          projectiles: [],
          recentHits: [],
          zombiesSpawnedThisWave: 0,
          zombiesToSpawnThisWave: 6,
          gameDurationMs: 6 * 60 * 1000,
        };
      } else if (mode === 'boss') {
        rooms[code].globalState = { bossIds: [], useAiBoss: true, aiBoss: null, timeLeft: 600, lasers: [], projectiles: [], openedBoxes: [], weaponBoxes: [], worldSize: 3000 };
      } else if (mode === 'ctf') {
        const { obstacles, terrain } = generateCTFWorld();
        rooms[code].globalState = {
          worldW: CTF_WORLD_W,
          worldH: CTF_WORLD_H,
          redScore: 0,
          blueScore: 0,
          redFlag: { x: CTF_RED_BASE_X, y: CTF_RED_BASE_Y, team: 'red', carrier: null },
          blueFlag: { x: CTF_BLUE_BASE_X, y: CTF_BLUE_BASE_Y, team: 'blue', carrier: null },
          bullets: [],
          obstacles,
          terrain,
          gameOver: null,
        };
      } else if (mode === 'economy') {
        rooms[code].globalState = { events: [], collectibles: [], timeLimit: 300, worldSize: 4000 };
      } else if (mode === 'farm') {
        rooms[code].globalState = { asteroids: [], lasers: [], projectiles: [], collectibles: [] };
      }

      socket.join(code);
      callback({ success: true, code, room: rooms[code] });
      persistRoom(rooms[code]);
    });

    socket.on("joinRoom", ({ code, name }, callback) => {
      const room = rooms[code];
      if (!room) return callback({ success: false, error: "Room not found" });
      if (room.state !== 'lobby') return callback({ success: false, error: "Game already started" });

      const playerId = Math.random().toString(36).substring(7);
      const newPlayer: Player = {
        id: playerId, name, score: 0, resources: 0, socketId: socket.id,
        x: 500 + (Math.random() * 200 - 100), y: 500 + (Math.random() * 200 - 100),
        modeState: {}
      };

      if (room.mode === 'zombie') {
        const baseX = 2000, baseY = 2000;
        newPlayer.x = baseX + (Math.random() * 120 - 60);
        newPlayer.y = baseY + 120 + Math.random() * 80;
        const TACTICAL_COLORS = ['#3b82f6', '#ef4444', '#eab308', '#f97316', '#a855f7'];
        const usedColors = new Set(
          Object.values(room.players)
            .map((p: any) => p.modeState?.playerColor)
            .filter(Boolean) as string[]
        );
        const available = TACTICAL_COLORS.filter(c => !usedColors.has(c));
        const playerColor = available.length > 0
          ? available[Math.floor(Math.random() * available.length)]
          : TACTICAL_COLORS[Math.floor(Math.random() * TACTICAL_COLORS.length)];
        newPlayer.modeState = {
          hp: 100,
          maxHp: 100,
          ammo: 10,
          weapon: 'pistol',
          lastFire: 0,
          ownedWeapons: ['pistol'],
          playerColor,
          kills: 0,
          correctAnswers: 0
        };
      } else if (room.mode === 'ctf') {
        const redCount = Object.values(room.players).filter((p: any) => p.modeState?.team === 'red').length;
        const blueCount = Object.values(room.players).filter((p: any) => p.modeState?.team === 'blue').length;
        const team = redCount <= blueCount ? 'red' : 'blue';
        const spawnX = team === 'red' ? CTF_RED_BASE_X + (Math.random() * 200 - 100) : CTF_BLUE_BASE_X + (Math.random() * 200 - 100);
        const spawnY = team === 'red' ? CTF_RED_BASE_Y + (Math.random() * 200 - 100) : CTF_BLUE_BASE_Y + (Math.random() * 200 - 100);
        newPlayer.x = spawnX;
        newPlayer.y = spawnY;
        newPlayer.resources = CTF_MAX_ENERGY;
        newPlayer.modeState = {
          team,
          hasFlag: false,
          hp: CTF_MAX_HEALTH,
          maxHp: CTF_MAX_HEALTH,
          ammo: CTF_STARTING_AMMO,
          coins: 0,
          inventory: ['pistol'],
          currentWeapon: 'pistol',
          dead: false,
          respawnTimer: 0,
          lastShotTime: 0,
          angle: 0,
        };
      } else if (room.mode === 'economy') {
        newPlayer.modeState = { multiplier: 1, frozenUntil: 0, energy: 100, maxEnergy: 100 };
        newPlayer.x = 2000;
        newPlayer.y = 2000;
      } else if (room.mode === 'farm') {
        newPlayer.modeState = { laserDamage: 25, magnetRange: 50, hasShield: false, weaponTier: 1, credits: 30, vx: 0, vy: 0 };
        newPlayer.resources = 50;
        newPlayer.x = 2000;
        newPlayer.y = 2000;
        newPlayer.angle = 0;
      } else if (room.mode === 'boss') {
        newPlayer.modeState = { isBoss: false, hp: 2, maxHp: 2, disabledUntil: 0, shields: 0, weaponType: 'rifle', ownedWeapons: ['rifle', 'sniper', 'shotgun'] };
        newPlayer.x = 1500 + (Math.random() - 0.5) * 200;
        newPlayer.y = 1500 + (Math.random() - 0.5) * 200;
      }

      room.players[playerId] = newPlayer;
      socket.join(code);
      
      io.to(code).emit("roomUpdated", room);
      callback({ success: true, playerId, room });
      persistRoom(room);
    });

    socket.on("kickPlayer", ({ code, playerId }) => {
      const room = rooms[code];
      if (room && room.hostId === socket.id && room.players[playerId]) {
        const socketId = room.players[playerId].socketId;
        delete room.players[playerId];
        io.to(socketId).emit("kicked");
        io.to(code).emit("roomUpdated", room);
      }
    });

    socket.on("assignTeam", ({ code, playerId, team }) => {
      const room = rooms[code];
      if (room && room.hostId === socket.id && room.state === 'lobby' && room.players[playerId] && room.mode === 'ctf') {
        const p = room.players[playerId];
        if (team === 'red' || team === 'blue') {
          p.modeState.team = team;
          p.x = team === 'red' ? CTF_RED_BASE_X : CTF_BLUE_BASE_X;
          p.y = team === 'red' ? CTF_RED_BASE_Y : CTF_BLUE_BASE_Y;
          io.to(code).emit("roomUpdated", room);
          io.to(p.socketId).emit("playerUpdated", { playerId, player: p });
        }
      }
    });

    socket.on("assignBossRole", ({ code, playerId, isBoss }) => {
      const room = rooms[code];
      if (room && room.hostId === socket.id && room.state === 'lobby' && room.players[playerId] && room.mode === 'boss' && !room.globalState.useAiBoss) {
        const p = room.players[playerId];
        p.modeState = p.modeState || {};
        p.modeState.isBoss = !!isBoss;
        io.to(code).emit("roomUpdated", room);
        io.to(p.socketId).emit("playerUpdated", { playerId, player: p });
      }
    });

    socket.on("setBossUseAi", ({ code, useAiBoss }) => {
      const room = rooms[code];
      if (room && room.hostId === socket.id && room.state === 'lobby' && room.mode === 'boss') {
        room.globalState.useAiBoss = !!useAiBoss;
        io.to(code).emit("roomUpdated", room);
      }
    });

    socket.on("startGame", ({ code }) => {
      const room = rooms[code];
      if (room && room.hostId === socket.id) {
        room.state = 'playing';
        room.startTime = Date.now();
        if (room.mode === 'zombie') {
          const pc = Math.min(30, Math.max(1, Object.keys(room.players).length));
          const baseZombies = 4;
          const multiplier = 2;
          const wave = room.globalState.wave ?? 1;
          room.globalState.zombiesToSpawnThisWave = baseZombies + Math.floor(pc * multiplier * wave);
        }
        if (room.mode === 'boss') {
          const playerIds = Object.keys(room.players);
          const WORLD = room.globalState.worldSize || 3000;
          const CENTER = WORLD / 2;
          const useAiBoss = room.globalState.useAiBoss !== false;
          let bossIds: string[] = [];
          if (useAiBoss) {
            room.globalState.bossIds = [];
            const heroCount = playerIds.length;
            const baseHp = 350;
            const hpPerPlayer = 80;
            room.globalState.aiBoss = {
              x: CENTER, y: CENTER - 200,
              hp: baseHp + hpPerPlayer * Math.max(0, heroCount - 1),
              maxHp: baseHp + hpPerPlayer * Math.max(0, heroCount - 1),
              facing: 0, lastShotTime: 0
            };
          } else {
            const chosenBosses = playerIds.filter(id => room.players[id].modeState?.isBoss);
            const numBosses = playerIds.length >= 6 ? 2 : 1;
            bossIds = chosenBosses.length >= 1
              ? chosenBosses.slice(0, numBosses)
              : [...playerIds].sort(() => Math.random() - 0.5).slice(0, numBosses);
            room.globalState.bossIds = bossIds;
            room.globalState.aiBoss = null;
            const heroCount = playerIds.filter(id => !bossIds.includes(id)).length;
            const bossBaseHp = 8;
            const bossHpPerHero = 4;
            const bossMaxHp = Math.max(10, bossBaseHp + heroCount * bossHpPerHero);
            bossIds.forEach((bid, i) => {
              const p = room.players[bid];
              p.modeState = p.modeState || {};
              p.modeState.isBoss = true;
              p.modeState.maxHp = bossMaxHp;
              p.modeState.hp = bossMaxHp;
              p.x = CENTER + (i === 0 ? -200 : 200) + (Math.random() - 0.5) * 100;
              p.y = CENTER - 150 + (Math.random() - 0.5) * 80;
            });
          }
          const WORLD_BOSS = room.globalState.worldSize || 3000;
          const BOX_SEED = 55555;
          const sr = (s: number) => { const x = Math.sin(s) * 10000; return x - Math.floor(x); };
          const WEAPON_TYPES = ['rifle', 'shotgun', 'rocket', 'sniper', 'minigun'];
          const weaponBoxes: { id: string; x: number; y: number; type: string }[] = [];
          let boxSeed = BOX_SEED;
          for (let i = 0; i < 18; i++) {
            weaponBoxes.push({
              id: `box_${i}`,
              x: 200 + sr(boxSeed++) * (WORLD_BOSS - 400),
              y: 200 + sr(boxSeed++) * (WORLD_BOSS - 400),
              type: WEAPON_TYPES[Math.floor(sr(boxSeed++) * WEAPON_TYPES.length)]
            });
          }
          room.globalState.weaponBoxes = weaponBoxes;
          room.globalState.openedBoxes = [];
          const heroIds = useAiBoss ? playerIds : playerIds.filter(id => !bossIds.includes(id));
          heroIds.forEach((hid, i) => {
            const p = room.players[hid];
            p.modeState = p.modeState || {};
            p.modeState.isBoss = false;
            p.modeState.hp = 2;
            p.modeState.maxHp = 2;
            p.modeState.weaponType = p.modeState.weaponType || 'rifle';
            p.modeState.ownedWeapons = [...new Set([...(p.modeState.ownedWeapons || []), 'rifle', 'sniper', 'shotgun'])];
            const angle = (i / Math.max(1, heroIds.length)) * Math.PI * 1.5 + Math.PI * 0.25;
            const dist = 250 + Math.random() * 80;
            p.x = CENTER + Math.cos(angle) * dist + (Math.random() - 0.5) * 60;
            p.y = CENTER + Math.sin(angle) * dist + (Math.random() - 0.5) * 60;
            p.modeState.spawnX = p.x;
            p.modeState.spawnY = p.y;
          });
        }
        if (room.mode === 'economy' && room.globalState.collectibles) {
          const WORLD = 4000;
          const MARGIN = 150;
          const playerCount = Object.keys(room.players).length;
          const collectiblesPerPlayer = 10;
          const totalCount = Math.max(12, Math.min(60, playerCount * collectiblesPerPlayer));
          const gridSize = Math.ceil(Math.sqrt(totalCount));
          const cellW = (WORLD - 2 * MARGIN) / gridSize;
          const cellH = (WORLD - 2 * MARGIN) / gridSize;
          for (let i = 0; i < totalCount; i++) {
            const r = Math.random();
            let type: string, value: number;
            if (r < 0.25) { type = 'treasure_chest'; value = 40; }
            else if (r < 0.55) { type = 'coin_pile'; value = 20; }
            else { type = 'money_bills'; value = 10; }
            const gx = i % gridSize;
            const gy = Math.floor(i / gridSize);
            const jitter = 0.35;
            const x = MARGIN + (gx + 0.5 + (Math.random() - 0.5) * jitter) * cellW;
            const y = MARGIN + (gy + 0.5 + (Math.random() - 0.5) * jitter) * cellH;
            room.globalState.collectibles.push({
              id: Math.random().toString(),
              x, y, type, value
            });
          }
        }

        io.to(code).emit("gameStarted", room);
        persistRoom(room);
      }
    });

    socket.on("updatePosition", ({ code, playerId, x, y, angle, sprint }) => {
      const room = rooms[code];
      if (room && room.state === 'playing' && room.players[playerId]) {
        const p = room.players[playerId];
        
        if (room.mode === 'economy' && p.modeState.frozenUntil > Date.now()) return;
        if (room.mode === 'boss' && p.modeState.disabledUntil > Date.now()) return;
        if (room.mode === 'ctf' && typeof angle === 'number') {
          if (p.modeState) p.modeState.angle = angle;
        }

        if (room.mode === 'ctf') {
          if (p.modeState?.dead) return;
          // Always process position update (no freeze when energy is 0); energy deduction only when enough
          // Validation: world bounds + max distance per update only (no rejection by absolute position; high x/y are valid)
          const safeNum = (n, fallback) => (typeof n === 'number' && isFinite(n) ? n : fallback);
          const minX = CTF_PLAYER_RADIUS;
          const maxX = CTF_WORLD_W - CTF_PLAYER_RADIUS;
          const minY = CTF_PLAYER_RADIUS;
          const maxY = CTF_WORLD_H - CTF_PLAYER_RADIUS;
          const prevX = Math.max(minX, Math.min(maxX, safeNum(p.x, minX)));
          const prevY = Math.max(minY, Math.min(maxY, safeNum(p.y, minY)));
          let nx = Math.max(minX, Math.min(maxX, safeNum(x, prevX)));
          let ny = Math.max(minY, Math.min(maxY, safeNum(y, prevY)));
          const obstacles = room.globalState?.obstacles || [];
          const EMBEDDED_THRESH = 1e-6;
          const MAX_PASSES = 3;
          for (let pass = 0; pass < MAX_PASSES; pass++) {
            for (const obs of obstacles) {
              const ox = safeNum(obs.x, 0);
              const oy = safeNum(obs.y, 0);
              const rad = safeNum(obs.radius, 0);
              if (!rad || !isFinite(ox) || !isFinite(oy)) continue;
              const minDist = CTF_PLAYER_RADIUS + rad;
              let dist = Math.hypot(nx - ox, ny - oy);
              if (dist >= minDist) continue;
              if (dist <= EMBEDDED_THRESH) {
                nx = ox + minDist;
                ny = oy;
                dist = minDist;
              } else {
                const overlap = minDist - dist;
                const nxNorm = (nx - ox) / dist;
                const nyNorm = (ny - oy) / dist;
                nx += nxNorm * overlap;
                ny += nyNorm * overlap;
              }
              const moveX = nx - prevX;
              const moveY = ny - prevY;
              const normalX = (nx - ox) / dist;
              const normalY = (ny - oy) / dist;
              const dot = moveX * normalX + moveY * normalY;
              if (dot < 0) {
                nx -= dot * normalX;
                ny -= dot * normalY;
              }
              nx = Math.max(minX, Math.min(maxX, nx));
              ny = Math.max(minY, Math.min(maxY, ny));
            }
          }
          if (!isFinite(nx) || !isFinite(ny)) {
            nx = prevX;
            ny = prevY;
          }
          nx = Math.max(minX, Math.min(maxX, nx));
          ny = Math.max(minY, Math.min(maxY, ny));
          const dist = Math.hypot(nx - prevX, ny - prevY);
          const dt = 1 / 30;
          const maxMove = CTF_MOVEMENT_SPEED * 1.2 * dt * 2;
          if (dist > maxMove && dist > 1e-6) {
            const scale = maxMove / dist;
            nx = prevX + (nx - prevX) * scale;
            ny = prevY + (ny - prevY) * scale;
          }
          const energyCost = dist * 0.04;
          p.x = isFinite(nx) ? nx : prevX;
          p.y = isFinite(ny) ? ny : prevY;
          if (p.resources >= energyCost) {
            p.resources = Math.max(0, Math.min(CTF_MAX_ENERGY, p.resources - energyCost));
          }
        } else if (room.mode === 'boss') {
          const WORLD = room.globalState.worldSize || 3000;
          p.x = Math.max(30, Math.min(WORLD - 30, x));
          p.y = Math.max(30, Math.min(WORLD - 30, y));
        } else if (room.mode === 'economy') {
          const WORLD = 4000;
          const energy = p.modeState.energy ?? 100;

          if (energy <= 0) return;

          const targetX = Math.max(50, Math.min(WORLD - 50, x));
          const targetY = Math.max(50, Math.min(WORLD - 50, y));
          const dist = Math.hypot(targetX - p.x, targetY - p.y);

          if (dist < 0.5) return;

          const energyCost = dist * 0.02;
          p.modeState.energy = Math.max(0, energy - energyCost);
          p.x = targetX;
          p.y = targetY;
        } else if (room.mode === 'zombie') {
          const WORLD = room.globalState.worldSize ?? 4000;
          p.x = Math.max(0, Math.min(WORLD, x));
          p.y = Math.max(0, Math.min(WORLD, y));
        } else {
          p.x = Math.max(15, Math.min(985, x));
          p.y = Math.max(15, Math.min(985, y));
        }
      }
    });

    socket.on("submitAnswer", ({ code, playerId, isCorrect }) => {
      const room = rooms[code];
      if (!room || room.state !== 'playing') return;
      const player = room.players[playerId];
      if (!player) return;

      if (room.mode === 'economy' && player.modeState.frozenUntil > Date.now()) return;
      if (room.mode === 'boss' && player.modeState.disabledUntil > Date.now()) return;

      if (isCorrect) {
        let earned = 10;
        if (room.mode === 'economy') {
          earned *= (player.modeState.multiplier || 1);
          player.modeState.energy = Math.min(player.modeState.maxEnergy || 100, (player.modeState.energy || 0) + 25);
        }
        if (room.mode === 'ctf') {
          player.modeState.ammo = Math.min(CTF_MAX_AMMO, (player.modeState.ammo ?? CTF_STARTING_AMMO) + CTF_AMMO_REWARD);
          player.modeState.coins = (player.modeState.coins ?? 0) + CTF_COIN_TRIVIA_REWARD;
          earned = 0;
        }
        if (room.mode === 'boss') {
          earned = 2; // 2 ammo per correct answer for both
          player.score = (player.score ?? 0) + 5;
          player.modeState.correctAnswers = (player.modeState.correctAnswers ?? 0) + 1;
        }
        if (room.mode === 'farm') {
          player.resources += 20; // Plasma Ammo
          player.modeState.credits = (player.modeState.credits || 0) + 10; // Credits
        } else if (room.mode === 'zombie') {
          player.modeState.ammo = (player.modeState.ammo ?? 10) + 10;
          player.score += 10;
          player.modeState.correctAnswers = (player.modeState.correctAnswers ?? 0) + 1;
        } else {
          player.resources += earned;
          player.score += 10;
        }
      } else {
        // Penalty
        if (room.mode === 'economy') player.resources = Math.max(0, player.resources - 5);
      }

      io.to(code).emit("playerUpdated", { playerId, player });
      checkWinCondition(io, code);
    });

    socket.on("buyUpgrade", ({ code, playerId, upgradeId, cost, targetId }) => {
      const room = rooms[code];
      if (!room || room.state !== 'playing') return;
      const player = room.players[playerId];
      if (!player) return;

      if (room.mode === 'ctf') {
        const wpn = CTF_WEAPONS[upgradeId];
        if (!wpn || player.modeState?.dead) return;
        const coins = player.modeState?.coins ?? 0;
        if (coins < cost) return;
        if ((player.modeState?.inventory || []).includes(upgradeId)) return;
        player.modeState.coins = coins - cost;
        player.modeState.inventory = [...(player.modeState.inventory || ['pistol']), upgradeId];
        player.modeState.currentWeapon = upgradeId;
        io.to(code).emit("playerUpdated", { playerId, player });
        io.to(code).emit("globalStateUpdated", room.globalState);
        return;
      }

      const useCredits = room.mode === 'farm' && ['weapon_tier_2', 'weapon_tier_3', 'weapon_tier_4', 'laser', 'magnet', 'shield'].includes(upgradeId);
      const currency = useCredits ? (player.modeState?.credits || 0) : player.resources;
      if (currency < cost) return;

      if (useCredits) player.modeState.credits -= cost;
      else player.resources -= cost;

      if (upgradeId === 'speed') {
        player.modeState.speed = (player.modeState.speed || 6) + 2;
      }

      if (room.mode === 'zombie') {
        if (upgradeId === 'repair') room.globalState.baseHealth = Math.min(room.globalState.maxBaseHealth, room.globalState.baseHealth + 500);
        if (upgradeId === 'turret') {
          const baseX = room.globalState.baseX ?? 2000, baseY = room.globalState.baseY ?? 2000;
          const turretCount = (room.globalState.turrets || []).length;
          const TURRET_PLACE_RADIUS = 200;
          const TURRET_SLOTS = 8;
          const angle = (turretCount % TURRET_SLOTS) * (2 * Math.PI / TURRET_SLOTS);
          room.globalState.turrets.push({ x: baseX + Math.cos(angle) * TURRET_PLACE_RADIUS, y: baseY + Math.sin(angle) * TURRET_PLACE_RADIUS, lastShoot: 0 });
        }
        if (upgradeId === 'heal') {
          Object.values(room.players).forEach(p => { if (p.modeState) p.modeState.hp = p.modeState.maxHp ?? 100; });
        }
        if (upgradeId === 'damage') player.modeState.damage = (player.modeState.damage || 20) + 10;
        // Weapon purchases (coins = player.resources; cost already deducted above)
        const wpn = ZOMBIE_WEAPONS[upgradeId];
        if (wpn && wpn.cost > 0 && cost === wpn.cost) {
          if (!Array.isArray(player.modeState.ownedWeapons)) player.modeState.ownedWeapons = ['pistol'];
          player.modeState.ownedWeapons.push(upgradeId);
          player.modeState.weapon = upgradeId;
        }
      } else if (room.mode === 'economy') {
        if (upgradeId === 'multiplier') player.modeState.multiplier += 1;
        if (upgradeId === 'freeze') {
          Object.values(room.players).forEach(p => {
            if (p.id !== player.id) p.modeState.frozenUntil = Date.now() + 10000;
          });
          room.globalState.events.push({ type: 'freeze', by: player.name, time: Date.now() });
        }
      } else if (room.mode === 'farm') {
        if (upgradeId === 'weapon_tier_2') player.modeState.weaponTier = 2;
        if (upgradeId === 'weapon_tier_3') player.modeState.weaponTier = 3;
        if (upgradeId === 'weapon_tier_4') player.modeState.weaponTier = 4;
        if (upgradeId === 'laser') player.modeState.laserDamage += 25;
        if (upgradeId === 'magnet') player.modeState.magnetRange += 50;
        if (upgradeId === 'shield') player.modeState.hasShield = true;
      } else if (room.mode === 'boss') {
        if (player.modeState.isBoss) {
          if (upgradeId === 'shield' && cost === 5) player.modeState.shields += 1;
          if (upgradeId === 'disable' && cost === 10 && targetId && room.players[targetId]) {
            room.players[targetId].modeState.disabledUntil = Date.now() + 5000;
          }
        }
      }

      const ownedCopy = [...(player.modeState?.ownedWeapons || [])];
      io.to(code).emit("playerUpdated", { playerId, player: { ...player, modeState: { ...player.modeState, ownedWeapons: ownedCopy } } });
      io.to(code).emit("globalStateUpdated", room.globalState);
    });

    socket.on("switchWeapon", ({ code, playerId, weaponId }) => {
      const room = rooms[code];
      if (!room || room.state !== 'playing' || room.mode !== 'zombie') return;
      const player = room.players[playerId];
      if (!player) return;
      if (!player.modeState) player.modeState = {};
      let owned = Array.isArray(player.modeState.ownedWeapons) ? [...player.modeState.ownedWeapons] : [];
      if (!owned.includes('pistol')) owned.unshift('pistol');
      if (player.modeState.weapon && !owned.includes(player.modeState.weapon)) owned.push(player.modeState.weapon);
      player.modeState.ownedWeapons = [...new Set(owned)];
      if (!player.modeState.ownedWeapons.includes(weaponId) || !ZOMBIE_WEAPONS[weaponId]) return;
      player.modeState.weapon = weaponId;
      const payload = {
        playerId,
        player: { ...player, modeState: { ...player.modeState, ownedWeapons: [...player.modeState.ownedWeapons] } },
      };
      io.to(code).emit("playerUpdated", payload);
    });

    socket.on("openBox", ({ code, playerId, boxId }) => {
      const room = rooms[code];
      if (!room || room.state !== 'playing' || room.mode !== 'boss') return;
      const player = room.players[playerId];
      if (!player || player.modeState?.isBoss || (player.modeState?.hp ?? 2) <= 0) return;
      const opened = room.globalState.openedBoxes || [];
      if (opened.includes(boxId)) return;
      const boxes = room.globalState.weaponBoxes || [];
      const box = boxes.find((b: any) => b.id === boxId);
      if (!box) return;
      const dist = Math.hypot(player.x - box.x, player.y - box.y);
      if (dist > 95) return;
      opened.push(boxId);
      room.globalState.openedBoxes = opened;
      player.modeState = player.modeState || {};
      const type = box.type || 'rifle';
      // Maintain a boss-mode weapon inventory so client can switch between weapons,
      // while keeping current weapon in weaponType (used by rendering & attacks).
      const ownedBossWeapons: string[] = Array.isArray(player.modeState.ownedWeapons)
        ? [...player.modeState.ownedWeapons]
        : [];
      if (!ownedBossWeapons.includes(type)) ownedBossWeapons.push(type);
      player.modeState.ownedWeapons = ownedBossWeapons;
      player.modeState.weaponType = type;
      player.resources = (player.resources || 0) + 5;
      io.to(code).emit("playerUpdated", { playerId, player });
      io.to(code).emit("globalStateUpdated", room.globalState);
    });

    socket.on("action", ({ code, playerId, actionType, targetId, aimAngle: clientAimAngle, weaponId, burst }) => {
      const room = rooms[code];
      if (!room || room.state !== 'playing') return;
      const player = room.players[playerId];
      if (!player) return;

      if (room.mode === 'ctf') {
        if (player.modeState?.dead) return;
        if (actionType === 'equipWeapon' && weaponId) {
          if ((player.modeState?.inventory || []).includes(weaponId) && CTF_WEAPONS[weaponId]) {
            player.modeState.currentWeapon = weaponId;
            io.to(code).emit("playerUpdated", { playerId, player });
          }
          return;
        }
        if (actionType === 'shoot') {
          const aimAngle = typeof clientAimAngle === 'number' ? clientAimAngle : (player.modeState?.angle ?? 0);
          const currentWpn = player.modeState?.currentWeapon || 'pistol';
          const wpn = CTF_WEAPONS[currentWpn] || CTF_WEAPONS.pistol;
          const ammo = player.modeState?.ammo ?? CTF_STARTING_AMMO;
          const now = Date.now();
          const lastShot = player.modeState?.lastShotTime ?? 0;
          if (ammo < 1 || (now - lastShot) < wpn.fireRate * 1000) return;
          player.modeState.ammo = ammo - 1;
          player.modeState.lastShotTime = now;
          const spawnDist = CTF_PLAYER_RADIUS + 5;
          const bullets = room.globalState.bullets || [];
          for (let i = 0; i < wpn.pellets; i++) {
            const angleOffset = (Math.random() - 0.5) * wpn.spread;
            const finalAngle = aimAngle + angleOffset;
            bullets.push({
              id: Math.random().toString(36).slice(2),
              x: player.x + Math.cos(finalAngle) * spawnDist,
              y: player.y + Math.sin(finalAngle) * spawnDist,
              vx: Math.cos(finalAngle) * wpn.bulletSpeed,
              vy: Math.sin(finalAngle) * wpn.bulletSpeed,
              team: player.modeState.team,
              ownerId: playerId,
              life: CTF_BULLET_LIFETIME,
              damage: wpn.damage,
              color: wpn.color,
            });
          }
          room.globalState.bullets = bullets;
          io.to(code).emit("playerUpdated", { playerId, player });
          io.to(code).emit("globalStateUpdated", room.globalState);
        }
        return;
      }

      const PROJECTILE_SPEED = 520;

      if (room.mode === 'boss' && actionType === 'equipWeapon' && weaponId) {
        player.modeState = player.modeState || {};
        let owned = Array.isArray(player.modeState.ownedWeapons) ? [...player.modeState.ownedWeapons] : [];
        if (!owned.includes(weaponId)) owned.push(weaponId);
        player.modeState.ownedWeapons = owned;
        player.modeState.weaponType = weaponId;
        io.to(code).emit("playerUpdated", { playerId, player });
        return;
      }

      if (room.mode === 'boss' && actionType === 'attack' && !player.modeState.isBoss && player.resources >= 1 && (player.modeState?.hp ?? 2) > 0) {
        const angle = typeof clientAimAngle === 'number' ? clientAimAngle : 0;
        player.resources -= 1;
        const projs = room.globalState.projectiles || [];
        const weaponType = player.modeState?.weaponType || 'rifle';
        const isShotgun = weaponType === 'shotgun';
        const isRifleBurst = weaponType === 'rifle' && burst;
        let angles: number[];
        if (isRifleBurst) angles = [angle, angle, angle];
        else if (isShotgun) angles = [angle - 0.15, angle, angle + 0.15];
        else angles = [angle];
        const now = Date.now();
        angles.forEach((a, i) => {
          projs.push({
            id: `${playerId}_${now}_${i}`,
            x: player.x, y: player.y,
            vx: Math.cos(a) * PROJECTILE_SPEED, vy: Math.sin(a) * PROJECTILE_SPEED,
            shooterId: playerId, isBoss: false, spawnTime: now, aimAngle: a
          });
        });
        room.globalState.projectiles = projs;
        io.to(code).emit("playerUpdated", { playerId: player.id, player });
      } else if (room.mode === 'boss' && actionType === 'attack' && player.modeState?.isBoss && player.resources >= 1) {
        const angle = typeof clientAimAngle === 'number' ? clientAimAngle : 0;
        player.resources -= 1;
        const projs = room.globalState.projectiles || [];
        projs.push({
          x: player.x, y: player.y,
          vx: Math.cos(angle) * PROJECTILE_SPEED, vy: Math.sin(angle) * PROJECTILE_SPEED,
          shooterId: playerId, isBoss: true, spawnTime: Date.now()
        });
        room.globalState.projectiles = projs;
        io.to(code).emit("playerUpdated", { playerId: player.id, player });
      } else if (room.mode === 'farm' && actionType === 'shoot') {
        const ammoCost = player.modeState?.weaponTier === 4 ? 25 : 10;
        if (player.resources < ammoCost) return;
        let angle = typeof clientAimAngle === 'number' && !Number.isNaN(clientAimAngle) ? clientAimAngle : null;
        const shipX = Number(player.x) || 2000;
        const shipY = Number(player.y) || 2000;
        if (angle === null && targetId) {
          const ast = room.globalState.asteroids?.find((a: any) => a.id === targetId);
          if (ast) angle = Math.atan2(Number(ast.y) - shipY, Number(ast.x) - shipX);
        }
        if (angle === null || Number.isNaN(angle)) angle = 0;
        player.angle = angle;
        player.resources -= ammoCost;
        const tier = player.modeState?.weaponTier || 1;
        const projs = room.globalState.projectiles || [];
        const dmg = Number(player.modeState.laserDamage) || 25;
        const LASER_SPEED = 520;
        const PLASMA_SPEED = 280;
        const num = (v: number) => (typeof v === 'number' && !Number.isNaN(v) ? v : 0);
        if (tier === 1) {
          projs.push({ x: shipX, y: shipY, vx: num(Math.cos(angle) * LASER_SPEED), vy: num(Math.sin(angle) * LASER_SPEED), damage: dmg, shooterId: playerId, type: 'laser', radius: 4 });
        } else if (tier === 2) {
          const nx = Math.cos(angle + Math.PI / 2) * 12, ny = Math.sin(angle + Math.PI / 2) * 12;
          projs.push({ x: shipX + nx, y: shipY + ny, vx: num(Math.cos(angle) * LASER_SPEED), vy: num(Math.sin(angle) * LASER_SPEED), damage: dmg, shooterId: playerId, type: 'laser', radius: 3 });
          projs.push({ x: shipX - nx, y: shipY - ny, vx: num(Math.cos(angle) * LASER_SPEED), vy: num(Math.sin(angle) * LASER_SPEED), damage: dmg, shooterId: playerId, type: 'laser', radius: 3 });
        } else if (tier === 3) {
          [-0.25, 0, 0.25].forEach(off => projs.push({ x: shipX, y: shipY, vx: num(Math.cos(angle + off) * LASER_SPEED), vy: num(Math.sin(angle + off) * LASER_SPEED), damage: dmg, shooterId: playerId, type: 'laser', radius: 4 }));
        } else {
          projs.push({ x: shipX, y: shipY, vx: num(Math.cos(angle) * PLASMA_SPEED), vy: num(Math.sin(angle) * PLASMA_SPEED), damage: dmg * 3, shooterId: playerId, type: 'plasma', radius: 12 });
        }
        room.globalState.projectiles = projs;
        io.to(code).emit("playerUpdated", { playerId: player.id, player });
        io.to(code).emit("globalStateUpdated", room.globalState);
      } else if (room.mode === 'zombie' && actionType === 'shoot_zombie') {
        const ammo = player.modeState?.ammo ?? 0;
        const weapon = player.modeState?.weapon ?? 'pistol';
        const wpn = ZOMBIE_WEAPONS[weapon] ?? ZOMBIE_WEAPONS.pistol;
        const now = Date.now();
        const lastFire = player.modeState?.lastFire ?? 0;
        if (ammo < 1 || now - lastFire < wpn.fireRate) return;
        const px = player.x ?? 2000;
        const py = player.y ?? 2150;
        const aimAngle = typeof clientAimAngle === 'number' ? clientAimAngle : Math.atan2(0, 1);
        const weaponRange = weapon === 'sniper' ? 3000 : weapon === 'shotgun' ? 2500 : 2800;
        const maxHitRange = 3000;
        const GUN_TIP_DISTANCE = 51;
        const gunTipX = px + Math.cos(aimAngle) * GUN_TIP_DISTANCE;
        const gunTipY = py + Math.sin(aimAngle) * GUN_TIP_DISTANCE;

        function distPointToSegment(zx: number, zy: number, x1: number, y1: number, x2: number, y2: number): number {
          const dx = x2 - x1, dy = y2 - y1;
          const len = Math.hypot(dx, dy) || 1;
          const t = Math.max(0, Math.min(1, ((zx - x1) * dx + (zy - y1) * dy) / (len * len)));
          const projX = x1 + t * dx, projY = y1 + t * dy;
          return Math.hypot(zx - projX, zy - projY);
        }
        function segmentIntersectsCircle(
          cx: number, cy: number, r: number,
          x1: number, y1: number, x2: number, y2: number
        ): boolean {
          return distPointToSegment(cx, cy, x1, y1, x2, y2) <= r;
        }
        const SHOTGUN_HIT_RADIUS = 52;
        const ZOMBIE_HITBOX_RADIUS = 52; // Matches scaled zombie visual radius; segment-circle intersection for precision

        if (weapon === 'shotgun') {
          // Shotgun: 5 rays in a cone – only damage zombies that are hit by at least one ray (within hit radius of ray)
          const state = room.globalState;
          if (!state.zombies) state.zombies = [];
          if (!state.lasers) state.lasers = [];
          const zombies = state.zombies;
          const spreadOffsets = [-0.2, -0.1, 0, 0.1, 0.2];
          player.modeState.ammo = ammo - 1;
          player.modeState.lastFire = now;
          let killed = 0;
          for (let i = 0; i < zombies.length; i++) {
            const z = zombies[i];
            if ((z.hp ?? 0) <= 0) continue;
            const d = Math.hypot(z.x - px, z.y - py);
            if (d < 10 || d > weaponRange) continue;
            let hit = false;
            for (const off of spreadOffsets) {
              const a = aimAngle + off;
              const rx2 = gunTipX + Math.cos(a) * weaponRange;
              const ry2 = gunTipY + Math.sin(a) * weaponRange;
              if (distPointToSegment(z.x, z.y, gunTipX, gunTipY, rx2, ry2) <= SHOTGUN_HIT_RADIUS) {
                hit = true;
                break;
              }
            }
            if (!hit) continue;
            const prevHp = typeof z.hp === 'number' ? z.hp : (z.maxHp ?? 100);
            zombies[i].hp = Math.max(0, prevHp - wpn.damage);
            console.log("HIT! Zombie took damage. Remaining HP:", zombies[i].hp);
            if (zombies[i].hp <= 0) killed++;
          }
          player.modeState.kills = (player.modeState.kills ?? 0) + killed;
          spreadOffsets.forEach((off) => {
            const a = aimAngle + off;
            state.lasers.push({
              x1: gunTipX, y1: gunTipY,
              x2: gunTipX + Math.cos(a) * weaponRange,
              y2: gunTipY + Math.sin(a) * weaponRange,
              color: wpn.color, createdAt: now,
            });
          });
          player.resources = (player.resources || 0) + 50 * killed;
          player.score += 10 * killed;
        } else if (weapon === 'pistol') {
          // Pistol: spawn physical projectile (moved each tick, collision in game loop)
          if (!room.globalState.projectiles) room.globalState.projectiles = [];
          const PISTOL_BULLET_SPEED = 12000;
          room.globalState.projectiles.push({
            x: gunTipX, y: gunTipY,
            vx: Math.cos(aimAngle) * PISTOL_BULLET_SPEED / 30,
            vy: Math.sin(aimAngle) * PISTOL_BULLET_SPEED / 30,
            damage: wpn.damage,
            playerId: player.id,
            type: 'pistol',
          });
          player.modeState.ammo = ammo - 1;
          player.modeState.lastFire = now;
        } else {
          // Assault Rifle, Sniper: instant raycast
          const endX = gunTipX + Math.cos(aimAngle) * weaponRange;
          const endY = gunTipY + Math.sin(aimAngle) * weaponRange;
          const zombies = room.globalState.zombies || [];
          let hitZombie: any = null;
          let closestDist = Infinity;
          for (const z of zombies) {
            if ((z.hp ?? 0) <= 0) continue;
            const d = Math.hypot(z.x - gunTipX, z.y - gunTipY);
            if (d > maxHitRange || d < 2) continue;
            const intersects = segmentIntersectsCircle(z.x, z.y, ZOMBIE_HITBOX_RADIUS, gunTipX, gunTipY, endX, endY);
            if (intersects && d < closestDist) {
              closestDist = d;
              hitZombie = z;
            }
          }
          player.modeState.ammo = ammo - 1;
          player.modeState.lastFire = now;
          if (hitZombie) {
            const prevHp = hitZombie.hp;
            hitZombie.hp = Math.max(0, (typeof prevHp === 'number' ? prevHp : hitZombie.maxHp ?? 100) - wpn.damage);
            console.log("HIT! Zombie took damage. Remaining HP:", hitZombie.hp);
            if (hitZombie.hp <= 0) {
              player.resources = (player.resources || 0) + 50;
              player.score += 10;
              player.modeState.kills = (player.modeState.kills ?? 0) + 1;
            }
          }
          room.globalState.lasers.push({
            x1: gunTipX, y1: gunTipY, x2: hitZombie ? hitZombie.x : endX, y2: hitZombie ? hitZombie.y : endY,
            color: wpn.color, createdAt: now,
          });
        }
        const broadcastVx = weapon === 'pistol' ? Math.cos(aimAngle) * 12000 / 30 : Math.cos(aimAngle) * 2000;
        const broadcastVy = weapon === 'pistol' ? Math.sin(aimAngle) * 12000 / 30 : Math.sin(aimAngle) * 2000;
        socket.to(code).emit('remoteShoot', { x: gunTipX, y: gunTipY, vx: broadcastVx, vy: broadcastVy, weaponType: weapon, playerId: player.id });
        io.to(code).emit("playerUpdated", { playerId: player.id, player });
        io.to(code).emit("globalStateUpdated", room.globalState);
      }
    });

    socket.on("move", ({ code, playerId, dx, dy }) => {
      const room = rooms[code];
      if (!room || room.state !== 'playing' || room.mode !== 'farm') return;
      const player = room.players[playerId];
      if (!player) return;
      player.modeState = player.modeState || {};
      player.modeState.vx = typeof dx === 'number' ? Math.max(-1, Math.min(1, dx)) : 0;
      player.modeState.vy = typeof dy === 'number' ? Math.max(-1, Math.min(1, dy)) : 0;
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      for (const [code, room] of Object.entries(rooms)) {
        if (room.hostId === socket.id && room.state === 'lobby') {
          delete rooms[code];
          removeRoomFromDb(code);
        }
      }
    });
  });

  // 30 FPS Game Loop — wrapped in try/catch so one room/mode error cannot kill the tick loop
  setInterval(() => {
    try {
    const now = Date.now();
    Object.values(rooms).forEach(room => {
      if (room.state !== 'playing') return;
      const state = room.globalState;
      state.lasers = []; // Clear lasers

      // --- ZOMBIE MODE ---
      if (room.mode === 'zombie') {
        const WORLD_SIZE = state.worldSize ?? 4000;
        const BASE_X = state.baseX ?? 2000;
        const BASE_Y = state.baseY ?? 2000;
        const BASE_RADIUS = state.baseRadius ?? 85;
        const wave = state.wave ?? 1;
        const playerCount = Math.min(30, Math.max(1, Object.keys(room.players).length));
        const baseZombies = 4;
        const multiplier = 2;
        const toSpawn = state.zombiesToSpawnThisWave ?? baseZombies + Math.floor(playerCount * multiplier * wave);
        let spawned = state.zombiesSpawnedThisWave ?? 0;
        const gameDurationMs = state.gameDurationMs ?? 6 * 60 * 1000;

        // 6-minute timer: if time's up and base alive, players win
        if (room.startTime && now - room.startTime >= gameDurationMs) {
          room.state = 'ended';
          const summary = Object.entries(room.players).map(([id, p]: [string, any]) => ({ id, name: p.name, kills: p.modeState?.kills ?? 0, score: p.score ?? 0, correctAnswers: p.modeState?.correctAnswers ?? 0 }));
          io.to(room.code).emit("gameOver", { winner: "השחקנים!", mode: 'zombie', players: summary });
          persistGameResult(room, "השחקנים!");
          return;
        }

        // Wave advance: no zombies left and spawned enough this wave
        if (state.zombies.length === 0 && spawned >= toSpawn) {
          state.wave = wave + 1;
          state.zombiesSpawnedThisWave = 0;
          const baseZombies = 4;
          const multiplier = 2;
          const cappedPlayers = Math.min(30, Math.max(1, playerCount));
          state.zombiesToSpawnThisWave = baseZombies + Math.floor(cappedPlayers * multiplier * state.wave);
        }

        // Spawn zombies from edges (~6 per player per wave, scales with wave)
        if (spawned < (state.zombiesToSpawnThisWave ?? baseZombies + Math.floor(playerCount * multiplier * wave))) {
          const spawnChance = Math.min(0.25, (0.08 + state.wave * 0.02) * 0.55);
          if (Math.random() < spawnChance) {
            const side = Math.floor(Math.random() * 4);
            let zx: number, zy: number;
            if (side === 0) { zx = Math.random() * WORLD_SIZE; zy = 0; }
            else if (side === 1) { zx = WORLD_SIZE; zy = Math.random() * WORLD_SIZE; }
            else if (side === 2) { zx = Math.random() * WORLD_SIZE; zy = WORLD_SIZE; }
            else { zx = 0; zy = Math.random() * WORLD_SIZE; }
            state.zombies.push({
              id: Math.random().toString(),
              x: zx, y: zy,
              hp: 25 + state.wave * 8,
              maxHp: 25 + state.wave * 8,
              speed: 2 + state.wave * 0.2,
              angle: 0,
              wobbleSeed: Math.random() * 100,
            });
            state.zombiesSpawnedThisWave = (state.zombiesSpawnedThisWave ?? 0) + 1;
          }
        }

        // Move zombies toward base (center) with shuffling/staggering gait (side sway + slight speed variation)
        state.zombies.forEach((z: any) => {
          const dx = BASE_X - z.x;
          const dy = BASE_Y - z.y;
          const dist = Math.hypot(dx, dy);
          z.angle = Math.atan2(dy, dx);
          if (dist > BASE_RADIUS + 10) {
            const seed = (z.wobbleSeed ?? 0) * 100;
            const phase = now / 400 + seed;
            const sideSway = Math.sin(phase) * 0.9;
            const speedMult = 0.85 + 0.3 * (0.5 + 0.5 * Math.sin(phase * 1.3));
            const perpX = -dy / dist;
            const perpY = dx / dist;
            z.x += (dx / dist) * z.speed * speedMult + perpX * sideSway;
            z.y += (dy / dist) * z.speed * speedMult + perpY * sideSway;
          } else {
            state.baseHealth -= 0.5 + state.wave * 0.1;
            if (state.baseHealth < 0) state.baseHealth = 0;
          }
        });

        // Pistol projectiles: CCD (segment vs circle) to prevent tunneling, then move
        if (!state.projectiles) state.projectiles = [];
        if (!state.recentHits) state.recentHits = [];
        state.recentHits = [];
        const PROJ_MARGIN = 100;
        const ZOMBIE_HIT_R = 52;
        function segmentIntersectsCircle(px1: number, py1: number, px2: number, py2: number, cx: number, cy: number, r: number): boolean {
          const dx = px2 - px1, dy = py2 - py1;
          const len = Math.hypot(dx, dy) || 1;
          const t = Math.max(0, Math.min(1, ((cx - px1) * dx + (cy - py1) * dy) / (len * len)));
          const qx = px1 + t * dx, qy = py1 + t * dy;
          return Math.hypot(cx - qx, cy - qy) <= r;
        }
        state.projectiles = state.projectiles.filter((proj: any) => {
          if (proj.type !== 'pistol') return true;
          const prevX = proj.x, prevY = proj.y;
          proj.x += proj.vx;
          proj.y += proj.vy;
          if (proj.x < -PROJ_MARGIN || proj.x > WORLD_SIZE + PROJ_MARGIN || proj.y < -PROJ_MARGIN || proj.y > WORLD_SIZE + PROJ_MARGIN) return false;
          for (let i = 0; i < state.zombies.length; i++) {
            const z = state.zombies[i];
            if ((z.hp ?? 0) <= 0) continue;
            if (!segmentIntersectsCircle(prevX, prevY, proj.x, proj.y, z.x, z.y, ZOMBIE_HIT_R)) continue;
            const prevHp = typeof z.hp === 'number' ? z.hp : (z.maxHp ?? 100);
            const newHp = Math.max(0, prevHp - (proj.damage ?? 25));
            state.zombies[i].hp = newHp;
            const shooter = room.players[proj.playerId];
            if (shooter && newHp <= 0) {
              shooter.resources = (shooter.resources || 0) + 50;
              shooter.score += 10;
              shooter.modeState.kills = (shooter.modeState.kills ?? 0) + 1;
            }
            state.recentHits.push({ x: z.x, y: z.y });
            return false;
          }
          return true;
        });

        // Turrets: each has its own cooldown and target; +15% damage, +15% range, ~15% faster fire
        const TURRET_DAMAGE = 23;
        const TURRET_RANGE = 451;
        const TURRET_COOLDOWN_MS = 1360;
        const turrets = state.turrets || [];
        for (let i = 0; i < turrets.length; i++) {
          const t = turrets[i];
          const lastFired = t.lastShoot ?? 0;
          if (now - lastFired < TURRET_COOLDOWN_MS) continue;
          let closest: any = null;
          let minDist = TURRET_RANGE;
          for (let j = 0; j < state.zombies.length; j++) {
            const z = state.zombies[j];
            if ((z.hp ?? 0) <= 0) continue;
            const d = Math.hypot(z.x - t.x, z.y - t.y);
            if (d < minDist) { minDist = d; closest = z; }
          }
          if (closest) {
            closest.hp -= TURRET_DAMAGE;
            turrets[i].lastShoot = now;
            state.lasers.push({ x1: t.x, y1: t.y, x2: closest.x, y2: closest.y, color: '#3b82f6', createdAt: now });
          }
        }

        state.zombies = state.zombies.filter((z: any) => z.hp > 0);

        if (state.baseHealth <= 0) {
          room.state = 'ended';
          const summary = Object.entries(room.players).map(([id, p]: [string, any]) => ({ id, name: p.name, kills: p.modeState?.kills ?? 0, score: p.score ?? 0, correctAnswers: p.modeState?.correctAnswers ?? 0 }));
          io.to(room.code).emit("gameOver", { winner: "הזומבים", mode: 'zombie', players: summary });
          persistGameResult(room, "הזומבים");
        }
      }

      // --- BOSS MODE ---
      else if (room.mode === 'boss') {
        const bossIds = state.bossIds || [];
        const aiBoss = state.aiBoss;
        const WORLD = state.worldSize || 3000;
        const CENTER = WORLD / 2;
        const DT = 1 / 30;
        const PROJ_SPEED = 520;
        const PROJ_MAX_AGE = 2500;
        const BOSS_PROJ_SPEED = 240;

        if (aiBoss && aiBoss.hp > 0) {
          const heroes = Object.values(room.players).filter((p: any) => !p.modeState?.isBoss && (p.modeState?.hp ?? 2) > 0);
          if (heroes.length > 0) {
            let target: any = null;
            let minDistSq = Infinity;
            for (const h of heroes) {
              const dx = h.x - aiBoss.x, dy = h.y - aiBoss.y;
              const d2 = dx * dx + dy * dy;
              if (d2 < minDistSq) { minDistSq = d2; target = h; }
            }
            if (target) {
              const dist = Math.sqrt(minDistSq);
              const dirX = dist > 1 ? (target.x - aiBoss.x) / dist : 0;
              const dirY = dist > 1 ? (target.y - aiBoss.y) / dist : 0;
              aiBoss.facing = Math.atan2(dirY, dirX);
              if (dist > 150) {
                aiBoss.x = Math.max(50, Math.min(WORLD - 50, aiBoss.x + dirX * 60 * DT));
                aiBoss.y = Math.max(50, Math.min(WORLD - 50, aiBoss.y + dirY * 60 * DT));
              }
              if (now - aiBoss.lastShotTime >= 2500) {
                aiBoss.lastShotTime = now;
                const projs = state.projectiles || [];
                for (let i = 0; i < 6; i++) {
                  const spread = (Math.random() - 0.5) * 0.8;
                  const angle = aiBoss.facing + spread;
                  projs.push({
                    x: aiBoss.x, y: aiBoss.y,
                    vx: Math.cos(angle) * BOSS_PROJ_SPEED, vy: Math.sin(angle) * BOSS_PROJ_SPEED,
                    isBoss: true, spawnTime: now
                  });
                }
                state.projectiles = projs;
              }
            }
          }
        }

        const projs = state.projectiles || [];
        state.projectiles = projs.filter((proj: any) => {
          const prevX = proj.x, prevY = proj.y;
          proj.x += proj.vx * DT;
          proj.y += proj.vy * DT;
          if (now - proj.spawnTime > PROJ_MAX_AGE) return false;
          if (proj.x < -80 || proj.x > WORLD + 80 || proj.y < -80 || proj.y > WORLD + 80) return false;

          function pointToSegmentDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
            const dx = x2 - x1, dy = y2 - y1;
            const len = Math.hypot(dx, dy) || 1;
            const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (len * len)));
            const projX = x1 + t * dx, projY = y1 + t * dy;
            return Math.hypot(px - projX, py - projY);
          }

          if (!proj.isBoss) {
            const aiBoss = state.aiBoss;
            if (aiBoss && aiBoss.hp > 0) {
              const dist = Math.hypot(proj.x - aiBoss.x, proj.y - aiBoss.y);
              const sweepDist = pointToSegmentDist(aiBoss.x, aiBoss.y, prevX, prevY, proj.x, proj.y);
              const hitRadius = 90;
              if (dist < hitRadius || sweepDist < hitRadius) {
                aiBoss.hp = Math.max(0, (aiBoss.hp || 0) - 1);
                state.lasers.push({ x1: proj.x, y1: proj.y, x2: aiBoss.x, y2: aiBoss.y, color: '#ef4444' });
                io.to(room.code).emit("globalStateUpdated", { ...state });
                checkWinCondition(io, room.code);
                return false;
              }
            }
            const bosses = bossIds.map((id: string) => room.players[id]).filter((b: any) => b && (b.modeState?.hp ?? 0) > 0);
            for (const boss of bosses) {
              const dist = Math.hypot(proj.x - boss.x, proj.y - boss.y);
              const sweepDist = pointToSegmentDist(boss.x, boss.y, prevX, prevY, proj.x, proj.y);
              const hitRadius = 90;
              if (dist < hitRadius || sweepDist < hitRadius) {
                if (boss.modeState.shields > 0) {
                  boss.modeState.shields -= 1;
                  state.lasers.push({ x1: proj.x, y1: proj.y, x2: boss.x, y2: boss.y, color: '#3b82f6', blocked: true });
                } else {
                  boss.modeState.hp = Math.max(0, (boss.modeState.hp ?? 0) - 1);
                  state.lasers.push({ x1: proj.x, y1: proj.y, x2: boss.x, y2: boss.y, color: '#ef4444' });
                }
                io.to(room.code).emit("playerUpdated", { playerId: boss.id, player: boss });
                io.to(room.code).emit("globalStateUpdated", { ...state });
                checkWinCondition(io, room.code);
                return false;
              }
            }
          } else {
            const heroes = Object.values(room.players).filter((p: any) => !p.modeState?.isBoss && (p.modeState?.hp ?? 2) > 0);
            for (const hero of heroes) {
              if (hero.id === proj.shooterId) continue;
              const dist = Math.hypot(proj.x - hero.x, proj.y - hero.y);
              const sweepDist = pointToSegmentDist(hero.x, hero.y, prevX, prevY, proj.x, proj.y);
              const hitRadius = 55;
              if (dist < hitRadius || sweepDist < hitRadius) {
                hero.modeState.hp = Math.max(0, (hero.modeState.hp ?? 2) - 1);
                if (hero.modeState.hp <= 0) hero.modeState.respawnAt = now + 15000;
                state.lasers.push({ x1: proj.x, y1: proj.y, x2: hero.x, y2: hero.y, color: '#ef4444' });
                io.to(room.code).emit("playerUpdated", { playerId: hero.id, player: hero });
                checkWinCondition(io, room.code);
                return false;
              }
            }
          }
          return true;
        });

        Object.values(room.players).forEach((p: any) => {
          if (!p.modeState?.isBoss && (p.modeState?.hp ?? 2) <= 0 && p.modeState?.respawnAt) {
            if (now >= p.modeState.respawnAt) {
              p.modeState.hp = 2;
              p.modeState.respawnAt = null;
              p.x = p.modeState.spawnX ?? CENTER + (Math.random() - 0.5) * 200;
              p.y = p.modeState.spawnY ?? CENTER + (Math.random() - 0.5) * 200;
            }
          }
        });
        if (room.startTime) {
          state.timeLeft = Math.max(0, 600 - Math.floor((now - room.startTime) / 1000));
          if (state.timeLeft <= 0) {
            room.state = 'ended';
            const bossWinner = state.useAiBoss ? "המפלצת הענקית" : (bossIds.length ? room.players[bossIds[0]]?.name || "הבוס" : "הבוס");
            const players = Object.entries(room.players).map(([id, p]: [string, any]) => ({
              id,
              name: p.name,
              score: p.score ?? 0,
              correctAnswers: p.modeState?.correctAnswers ?? 0
            }));
            io.to(room.code).emit("gameOver", { winner: bossWinner, mode: 'boss', players });
            persistGameResult(room, bossWinner);
          }
        }
      }

      // --- CTF MODE ---
      else if (room.mode === 'ctf') {
        const dt = 0.05;
        const playersList = Object.values(room.players);
        const obstacles = state.obstacles || [];

        // Respawn
        playersList.forEach((p: any) => {
          if (!p.modeState?.dead) return;
          p.modeState.respawnTimer = (p.modeState.respawnTimer ?? 0) - dt;
          if (p.modeState.respawnTimer <= 0) {
            p.modeState.dead = false;
            p.modeState.hp = CTF_MAX_HEALTH;
            p.modeState.respawnTimer = 0;
            p.resources = CTF_MAX_ENERGY;
            p.modeState.ammo = CTF_STARTING_AMMO;
            p.x = p.modeState.team === 'red' ? CTF_RED_BASE_X + (Math.random() * 200 - 100) : CTF_BLUE_BASE_X + (Math.random() * 200 - 100);
            p.y = p.modeState.team === 'red' ? CTF_RED_BASE_Y + (Math.random() * 200 - 100) : CTF_BLUE_BASE_Y + (Math.random() * 200 - 100);
          }
        });

        // Bullets
        state.bullets = (state.bullets || []).filter((b: any) => {
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          b.life -= dt;
          if (b.life <= 0 || b.x < 0 || b.x > CTF_WORLD_W || b.y < 0 || b.y > CTF_WORLD_H) return false;
          for (const obs of obstacles) {
            if (Math.hypot(b.x - obs.x, b.y - obs.y) < obs.radius + 5) return false;
          }
          const enemies = playersList.filter((pl: any) => !pl.modeState?.dead && pl.modeState?.team !== b.team);
          for (const pl of enemies) {
            if (Math.hypot(b.x - pl.x, b.y - pl.y) < CTF_PLAYER_RADIUS + 10) {
              pl.modeState.hp = (pl.modeState.hp ?? CTF_MAX_HEALTH) - b.damage;
              if (pl.modeState.hp <= 0) {
                pl.modeState.dead = true;
                pl.modeState.respawnTimer = CTF_RESPAWN_SECONDS;
                pl.modeState.hasFlag = false;
                if (state.redFlag.carrier === pl.id) {
                  state.redFlag.carrier = null;
                  state.redFlag.x = pl.x;
                  state.redFlag.y = pl.y;
                }
                if (state.blueFlag.carrier === pl.id) {
                  state.blueFlag.carrier = null;
                  state.blueFlag.x = pl.x;
                  state.blueFlag.y = pl.y;
                }
                const killer = room.players[b.ownerId];
                if (killer?.modeState) killer.modeState.coins = (killer.modeState.coins ?? 0) + CTF_COIN_KILL_REWARD;
              }
              return false;
            }
          }
          return true;
        });

        // Flag position from carrier & flag logic
        if (state.redFlag.carrier && room.players[state.redFlag.carrier]) {
          state.redFlag.x = room.players[state.redFlag.carrier].x;
          state.redFlag.y = room.players[state.redFlag.carrier].y;
        }
        if (state.blueFlag.carrier && room.players[state.blueFlag.carrier]) {
          state.blueFlag.x = room.players[state.blueFlag.carrier].x;
          state.blueFlag.y = room.players[state.blueFlag.carrier].y;
        }

        const redBaseX = CTF_RED_BASE_X, redBaseY = CTF_RED_BASE_Y;
        const blueBaseX = CTF_BLUE_BASE_X, blueBaseY = CTF_BLUE_BASE_Y;

        playersList.forEach((p: any) => {
          if (p.modeState?.dead) return;

          // Drop flag if carrier died (already cleared above)
          if (state.redFlag.carrier === p.id && p.modeState.dead) state.redFlag.carrier = null;
          if (state.blueFlag.carrier === p.id && p.modeState.dead) state.blueFlag.carrier = null;

          // Enemy pickup red flag (blue team takes red flag)
          if (p.modeState.team === 'blue' && !state.redFlag.carrier && Math.hypot(p.x - state.redFlag.x, p.y - state.redFlag.y) < CTF_FLAG_PICKUP_DIST) {
            state.redFlag.carrier = p.id;
            p.modeState.hasFlag = true;
            io.to(room.code).emit('ctfMessage', { text: `${p.name} לקח את הדגל האדום!` });
          }
          if (p.modeState.team === 'red' && !state.blueFlag.carrier && Math.hypot(p.x - state.blueFlag.x, p.y - state.blueFlag.y) < CTF_FLAG_PICKUP_DIST) {
            state.blueFlag.carrier = p.id;
            p.modeState.hasFlag = true;
            io.to(room.code).emit('ctfMessage', { text: `${p.name} לקח את הדגל הכחול!` });
          }

          // Return own flag (teammate touches dropped flag)
          if (p.modeState.team === 'red' && !state.redFlag.carrier && (state.redFlag.x !== redBaseX || state.redFlag.y !== redBaseY) && Math.hypot(p.x - state.redFlag.x, p.y - state.redFlag.y) < CTF_FLAG_PICKUP_DIST) {
            state.redFlag.x = redBaseX;
            state.redFlag.y = redBaseY;
            io.to(room.code).emit('ctfMessage', { text: 'הדגל האדום הוחזר לבסיס.' });
          }
          if (p.modeState.team === 'blue' && !state.blueFlag.carrier && (state.blueFlag.x !== blueBaseX || state.blueFlag.y !== blueBaseY) && Math.hypot(p.x - state.blueFlag.x, p.y - state.blueFlag.y) < CTF_FLAG_PICKUP_DIST) {
            state.blueFlag.x = blueBaseX;
            state.blueFlag.y = blueBaseY;
            io.to(room.code).emit('ctfMessage', { text: 'הדגל הכחול הוחזר לבסיס.' });
          }

          // Capture: bring enemy flag to own base
          if (p.modeState.hasFlag && p.modeState.team === 'red' && Math.hypot(p.x - redBaseX, p.y - redBaseY) < CTF_FLAG_CAPTURE_DIST) {
            p.modeState.hasFlag = false;
            state.blueFlag.carrier = null;
            state.blueFlag.x = blueBaseX;
            state.blueFlag.y = blueBaseY;
            state.redScore = (state.redScore || 0) + 1;
            io.to(room.code).emit('ctfScored', { team: 'red', x: redBaseX, y: redBaseY });
            io.to(room.code).emit('ctfMessage', { text: 'הדגל נכבש! נקודה לצוות האדום!' });
          }
          if (p.modeState.hasFlag && p.modeState.team === 'blue' && Math.hypot(p.x - blueBaseX, p.y - blueBaseY) < CTF_FLAG_CAPTURE_DIST) {
            p.modeState.hasFlag = false;
            state.redFlag.carrier = null;
            state.redFlag.x = redBaseX;
            state.redFlag.y = redBaseY;
            state.blueScore = (state.blueScore || 0) + 1;
            io.to(room.code).emit('ctfScored', { team: 'blue', x: blueBaseX, y: blueBaseY });
            io.to(room.code).emit('ctfMessage', { text: 'הדגל נכבש! נקודה לצוות הכחול!' });
          }
        });

        // Regenerate energy in base
        playersList.forEach((p: any) => {
          if (p.modeState?.dead) return;
          const inBase = p.modeState.team === 'red'
            ? Math.hypot(p.x - redBaseX, p.y - redBaseY) < CTF_BASE_RADIUS
            : Math.hypot(p.x - blueBaseX, p.y - blueBaseY) < CTF_BASE_RADIUS;
          if (inBase) p.resources = Math.min(CTF_MAX_ENERGY, (p.resources || 0) + 30 * dt);
        });

        if ((state.redScore || 0) >= CTF_WIN_SCORE || (state.blueScore || 0) >= CTF_WIN_SCORE) {
          state.gameOver = (state.redScore || 0) >= CTF_WIN_SCORE ? 'red' : 'blue';
          room.state = 'ended';
          const ctfWinner = (state.redScore || 0) >= CTF_WIN_SCORE ? "קבוצה אדומה" : "קבוצה כחולה";
          io.to(room.code).emit("gameOver", { winner: ctfWinner });
          persistGameResult(room, ctfWinner);
        }
      }

      // --- ECONOMY MODE ---
      else if (room.mode === 'economy') {
        if (!state.collectibles) {
          state.collectibles = [];
          if (state.coins && Array.isArray(state.coins)) {
            state.collectibles = state.coins.map((c: any) => ({
              id: c.id || Math.random().toString(),
              x: c.x, y: c.y,
              type: c.type || 'silver',
              value: c.value || 20
            }));
            delete state.coins;
          }
        }
        if (!state.timeLimit) state.timeLimit = 300;
        const WORLD = 4000;
        const MARGIN = 150;
        const playerCount = Object.keys(room.players).length;
        const minPerPlayer = 4;
        const targetMin = Math.max(8, playerCount * minPerPlayer);
        if (state.collectibles.length < targetMin && Math.random() < 0.5) {
          const r = Math.random();
          let type: string, value: number;
          if (r < 0.25) { type = 'treasure_chest'; value = 40; }
          else if (r < 0.55) { type = 'coin_pile'; value = 20; }
          else { type = 'money_bills'; value = 10; }
          const gridSize = Math.ceil(Math.sqrt(targetMin));
          const cellW = (WORLD - 2 * MARGIN) / gridSize;
          const cellH = (WORLD - 2 * MARGIN) / gridSize;
          const gx = Math.floor(Math.random() * gridSize);
          const gy = Math.floor(Math.random() * gridSize);
          const jitter = 0.4;
          const x = MARGIN + (gx + 0.5 + (Math.random() - 0.5) * jitter) * cellW;
          const y = MARGIN + (gy + 0.5 + (Math.random() - 0.5) * jitter) * cellH;
          state.collectibles.push({
            id: Math.random().toString(),
            x, y, type, value
          });
        }

        Object.values(room.players).forEach((p: any) => {
          if (p.modeState.frozenUntil > now) return;
          state.collectibles = state.collectibles.filter((c: any) => {
            if (Math.hypot(p.x - c.x, p.y - c.y) < 85) {
              p.resources += c.value * (p.modeState.multiplier || 1);
              if (p.resources >= 5000) {
                room.state = 'ended';
                io.to(room.code).emit("gameOver", { winner: p.name });
                persistGameResult(room, p.name);
              }
              return false;
            }
            return true;
          });
        });

        if (room.startTime && state.timeLimit) {
          const elapsed = now - room.startTime;
          state.timeLeft = Math.max(0, state.timeLimit - Math.floor(elapsed / 1000));
          if (state.timeLeft <= 0) {
            const sorted = Object.values(room.players).sort((a: any, b: any) => (b.resources || 0) - (a.resources || 0));
            const winner = sorted[0]?.name || 'אף אחד';
            room.state = 'ended';
            io.to(room.code).emit("gameOver", { winner });
            persistGameResult(room, winner);
          }
        }
      }

      // --- FARM MODE (4000x4000 world) ---
      else if (room.mode === 'farm') {
        const FARM_WORLD = 4000;
        const PLAYER_RADIUS = 26;
        const MOVE_SPEED = 14;
        const dt = 1 / 30;

        // Spawn asteroids across full world
        if (state.asteroids.length < 100 && Math.random() < 0.1) {
          const rand = Math.random();
          let type: string, color: string, value: number, hp: number, radius: number, craterCount: number;
          if (rand < 0.6) {
            type = 'iron'; color = '#737373'; value = Math.floor(Math.random() * 70); hp = 50; radius = 25 + Math.random() * 15; craterCount = 3;
          } else if (rand < 0.9) {
            type = 'ice'; color = '#2dd4bf'; value = 70 + Math.floor(Math.random() * 30); hp = 100; radius = 20 + Math.random() * 10; craterCount = 2;
          } else {
            type = 'crystal'; color = '#c084fc'; value = 100 + Math.floor(Math.random() * 50); hp = 200; radius = 15 + Math.random() * 8; craterCount = 1;
          }
          const angle = Math.random() * Math.PI * 2;
          const speed = 0.4 + Math.random() * 1.2;
          const vertices = Array.from({ length: 10 }, () => 0.75 + Math.random() * 0.3);
          const craters = Array.from({ length: craterCount }, () => ({
            dist: Math.random() * 0.5,
            angle: Math.random() * Math.PI * 2,
            size: 0.15 + Math.random() * 0.2
          }));
          state.asteroids.push({
            id: Math.random().toString(36).slice(2),
            x: Math.random() * FARM_WORLD,
            y: Math.random() * FARM_WORLD,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            radius, type, color, value, hp, maxHp: hp,
            rotation: 0,
            rotSpeed: (Math.random() - 0.5) * 0.03,
            vertices,
            craters
          });
        }

        state.asteroids.forEach((a: any) => {
          a.x += a.vx; a.y += a.vy;
          a.rotation = (a.rotation || 0) + (a.rotSpeed || 0);
          if (a.x < -100) a.x = FARM_WORLD + 100;
          if (a.x > FARM_WORLD + 100) a.x = -100;
          if (a.y < -100) a.y = FARM_WORLD + 100;
          if (a.y > FARM_WORLD + 100) a.y = -100;
        });

        Object.values(room.players).forEach((pl: any) => {
          const vx = (pl.modeState?.vx || 0) * MOVE_SPEED;
          const vy = (pl.modeState?.vy || 0) * MOVE_SPEED;
          pl.x = Math.max(PLAYER_RADIUS, Math.min(FARM_WORLD - PLAYER_RADIUS, (pl.x ?? 2000) + vx));
          pl.y = Math.max(PLAYER_RADIUS, Math.min(FARM_WORLD - PLAYER_RADIUS, (pl.y ?? 2000) + vy));
        });

        const projs = (state.projectiles || []).filter((p: any) =>
          typeof p.x === 'number' && !Number.isNaN(p.x) &&
          typeof p.y === 'number' && !Number.isNaN(p.y) &&
          typeof p.vx === 'number' && !Number.isNaN(p.vx) &&
          typeof p.vy === 'number' && !Number.isNaN(p.vy)
        );
        projs.forEach((p: any) => {
          p.x = (Number(p.x) || 0) + (Number(p.vx) || 0) * dt;
          p.y = (Number(p.y) || 0) + (Number(p.vy) || 0) * dt;
        });
        state.projectiles = projs.filter((p: any) => {
          const px = Number(p.x);
          const py = Number(p.y);
          if (Number.isNaN(px) || Number.isNaN(py)) return false;
          if (px < -50 || px > FARM_WORLD + 50 || py < -50 || py > FARM_WORLD + 50) return false;
          const hitRadius = p.radius || 4;
          let primaryHit: any = null;
          for (const ast of state.asteroids) {
            const d = Math.hypot(ast.x - p.x, ast.y - p.y);
            const astR = ast.radius ?? (20 + (ast.value || 50) / 20);
            if (d < astR + hitRadius) { primaryHit = ast; break; }
          }
          if (!primaryHit) return true;
          primaryHit.hp -= p.damage;
          if (p.type === 'plasma') {
            state.asteroids.forEach((other: any) => {
              if (other === primaryHit) return;
              const od = Math.hypot(primaryHit.x - other.x, primaryHit.y - other.y);
              if (od < 150) other.hp -= p.damage * 0.5;
            });
          }
          state.asteroids = state.asteroids.filter((a: any) => {
            if (a.hp > 0) return true;
            const shooter = room.players[p.shooterId];
            if (shooter) shooter.score = (shooter.score || 0) + (a.value || 0);
            (state.collectibles || []).push({
              id: Math.random().toString(36).slice(2),
              x: a.x,
              y: a.y,
              value: a.value || 0,
              vx: (Math.random() - 0.5) * 3,
              vy: (Math.random() - 0.5) * 3,
              color: a.color || '#9ca3af'
            });
            return false;
          });
          return false;
        });

        const coll = state.collectibles || [];
        coll.forEach((c: any) => {
          c.vx = (c.vx || 0) * 0.95;
          c.vy = (c.vy || 0) * 0.95;
          c.x += c.vx || 0;
          c.y += c.vy || 0;
        });
        Object.values(room.players).forEach((pl: any) => {
          const mag = pl.modeState?.magnetRange || 50;
          const shipX = pl.x ?? 2000, shipY = pl.y ?? 2000;
          state.collectibles = (state.collectibles || []).filter((c: any) => {
            const d = Math.hypot(c.x - shipX, c.y - shipY);
            if (d < mag) {
              pl.score = (pl.score || 0) + (c.value || 0);
              return false;
            }
            if (c.x < -100 || c.x > FARM_WORLD + 100 || c.y < -100 || c.y > FARM_WORLD + 100) return false;
            return true;
          });
        });

        if (room.startTime && now - room.startTime >= 7 * 60 * 1000) {
          const winner = Object.values(room.players).sort((a: any, b: any) => (b.score || 0) - (a.score || 0))[0];
          room.state = 'ended';
          const farmWinner = winner?.name || "unknown";
          io.to(room.code).emit("gameOver", { winner: farmWinner });
          persistGameResult(room, farmWinner);
        }
      }

      io.to(room.code).emit('tick', {
        players: Object.fromEntries(Object.entries(room.players).map(([k, v]) => {
          const ms = v.modeState || {};
          return [k, { ...v, modeState: { ...ms, ownedWeapons: [...(ms.ownedWeapons || [])] } }];
        })),
        globalState: { ...state, collectibles: [...(state.collectibles || [])] }
      });
    });
    } catch (err) {
      console.error('Tick error:', err);
    }
  }, 50); // 20 Hz tick for network efficiency; client interpolates for smooth display

  // Serve static assets from public (images, etc.) - before Vite in dev
  app.use(express.static('public'));

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
