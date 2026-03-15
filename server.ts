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
    io.to(code).emit("gameOver", { winner });
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
          zombiesSpawnedThisWave: 0,
          zombiesToSpawnThisWave: 6,
          gameDurationMs: 6 * 60 * 1000,
        };
      } else if (mode === 'boss') {
        rooms[code].globalState = { bossIds: [], useAiBoss: true, aiBoss: null, timeLeft: 600, lasers: [], projectiles: [], openedBoxes: [], weaponBoxes: [], worldSize: 3000 };
      } else if (mode === 'ctf') {
        rooms[code].globalState = { redScore: 0, blueScore: 0, redFlag: { x: 400, y: 4200, carrier: null, base: {x: 400, y: 4200} }, blueFlag: { x: 5600, y: 800, carrier: null, base: {x: 5600, y: 800} }, lasers: [] };
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
        const playerColor = TACTICAL_COLORS[Math.floor(Math.random() * TACTICAL_COLORS.length)];
        newPlayer.modeState = { hp: 100, maxHp: 100, ammo: 10, weapon: 'pistol', lastFire: 0, ownedWeapons: ['pistol'], playerColor };
      } else if (room.mode === 'ctf') {
        const redCount = Object.values(room.players).filter(p => p.modeState.team === 'red').length;
        const blueCount = Object.values(room.players).filter(p => p.modeState.team === 'blue').length;
        newPlayer.modeState = { team: redCount <= blueCount ? 'red' : 'blue', hasFlag: false, hp: 100, maxHp: 100 };
        newPlayer.x = newPlayer.modeState.team === 'red' ? 500 : 5500;
        newPlayer.y = newPlayer.modeState.team === 'red' ? 4200 : 800;
        newPlayer.resources = 100; // אנרגיה התחלתית
      } else if (room.mode === 'economy') {
        newPlayer.modeState = { multiplier: 1, frozenUntil: 0, energy: 100, maxEnergy: 100 };
        newPlayer.x = 2000;
        newPlayer.y = 2000;
      } else if (room.mode === 'farm') {
        newPlayer.modeState = { laserDamage: 25, magnetRange: 50, hasShield: false, weaponTier: 1, credits: 30 };
        newPlayer.resources = 50;
        newPlayer.x = 500;
        newPlayer.y = 500;
      } else if (room.mode === 'boss') {
        newPlayer.modeState = { isBoss: false, hp: 2, maxHp: 2, disabledUntil: 0, shields: 0, weaponType: 'rifle' };
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
          p.x = team === 'red' ? 500 : 5500;
          p.y = team === 'red' ? 4200 : 800;
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
          const pc = Math.max(1, Object.keys(room.players).length);
          room.globalState.zombiesToSpawnThisWave = 6 * pc + room.globalState.wave * 3;
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
            bossIds.forEach((bid, i) => {
              const p = room.players[bid];
              p.modeState = p.modeState || {};
              p.modeState.isBoss = true;
              p.modeState.maxHp = 10;
              p.modeState.hp = 10;
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

    socket.on("updatePosition", ({ code, playerId, x, y }) => {
      const room = rooms[code];
      if (room && room.state === 'playing' && room.players[playerId]) {
        const p = room.players[playerId];
        
        if (room.mode === 'economy' && p.modeState.frozenUntil > Date.now()) return;
        if (room.mode === 'boss' && p.modeState.disabledUntil > Date.now()) return;

        if (room.mode === 'ctf') {
          if (p.resources <= 0) return; // אין אנרגיה - לא יכול לזוז
          const dist = Math.hypot(p.x - x, p.y - y);
          const energyCost = dist * 0.08;
          if (p.resources >= energyCost) {
            p.resources = Math.max(0, p.resources - energyCost);
            p.x = Math.max(40, Math.min(5960, x));
            p.y = Math.max(40, Math.min(4960, y));
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
        if (room.mode === 'ctf') earned = 50; // Energy
        if (room.mode === 'boss') earned = 2; // 2 ammo per correct answer for both
        if (room.mode === 'farm') {
          player.resources += 20; // Plasma Ammo
          player.modeState.credits = (player.modeState.credits || 0) + 10; // Credits
        } else if (room.mode === 'zombie') {
          player.modeState.ammo = (player.modeState.ammo ?? 10) + 10;
          player.score += 10;
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
          const angle = Math.random() * Math.PI * 2;
          const dist = 170 + Math.random() * 150;
          room.globalState.turrets.push({ x: baseX + Math.cos(angle) * dist, y: baseY + Math.sin(angle) * dist, lastShoot: 0 });
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
      player.modeState.weaponType = box.type || 'rifle';
      player.resources = (player.resources || 0) + 5;
      io.to(code).emit("playerUpdated", { playerId, player });
      io.to(code).emit("globalStateUpdated", room.globalState);
    });

    socket.on("action", ({ code, playerId, actionType, targetId, aimAngle: clientAimAngle }) => {
      const room = rooms[code];
      if (!room || room.state !== 'playing') return;
      const player = room.players[playerId];
      if (!player) return;

      const PROJECTILE_SPEED = 520;

      if (room.mode === 'boss' && actionType === 'attack' && !player.modeState.isBoss && player.resources >= 1 && (player.modeState?.hp ?? 2) > 0) {
        const angle = typeof clientAimAngle === 'number' ? clientAimAngle : 0;
        player.resources -= 1;
        const projs = room.globalState.projectiles || [];
        projs.push({
          x: player.x, y: player.y,
          vx: Math.cos(angle) * PROJECTILE_SPEED, vy: Math.sin(angle) * PROJECTILE_SPEED,
          shooterId: playerId, isBoss: false, spawnTime: Date.now()
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
        let angle = typeof clientAimAngle === 'number' ? clientAimAngle : null;
        if (angle === null && targetId) {
          const ast = room.globalState.asteroids?.find((a: any) => a.id === targetId);
          if (ast) angle = Math.atan2(ast.y - 500, ast.x - 500);
        }
        if (angle === null) angle = 0;
        player.resources -= ammoCost;
        const tier = player.modeState?.weaponTier || 1;
        const projs = room.globalState.projectiles || [];
        const dmg = player.modeState.laserDamage || 25;
        const shipX = player.x ?? 500, shipY = player.y ?? 500;
        if (tier === 1) {
          projs.push({ x: shipX, y: shipY, vx: Math.cos(angle) * 520, vy: Math.sin(angle) * 520, damage: dmg, shooterId: playerId, type: 'laser', radius: 4 });
        } else if (tier === 2) {
          const off = 0.08;
          projs.push({ x: shipX, y: shipY, vx: Math.cos(angle - off) * 520, vy: Math.sin(angle - off) * 520, damage: dmg, shooterId: playerId, type: 'laser', radius: 4 });
          projs.push({ x: shipX, y: shipY, vx: Math.cos(angle + off) * 520, vy: Math.sin(angle + off) * 520, damage: dmg, shooterId: playerId, type: 'laser', radius: 4 });
        } else if (tier === 3) {
          [-0.15, 0, 0.15].forEach(off => projs.push({ x: shipX, y: shipY, vx: Math.cos(angle + off) * 520, vy: Math.sin(angle + off) * 520, damage: dmg, shooterId: playerId, type: 'laser', radius: 4 }));
        } else {
          projs.push({ x: shipX, y: shipY, vx: Math.cos(angle) * 280, vy: Math.sin(angle) * 280, damage: dmg * 2, shooterId: playerId, type: 'plasma', radius: 18 });
        }
        room.globalState.projectiles = projs;
        io.to(code).emit("playerUpdated", { playerId: player.id, player });
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
        } else {
          // Pistol, Assault Rifle, Sniper: single-target. Bullet segment from gun tip to end.
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
            }
          }
          room.globalState.lasers.push({
            x1: gunTipX, y1: gunTipY, x2: hitZombie ? hitZombie.x : endX, y2: hitZombie ? hitZombie.y : endY,
            color: wpn.color, createdAt: now,
          });
        }
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

  // 30 FPS Game Loop
  setInterval(() => {
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
        const playerCount = Math.max(1, Object.keys(room.players).length);
        const toSpawn = state.zombiesToSpawnThisWave ?? 6 * playerCount;
        let spawned = state.zombiesSpawnedThisWave ?? 0;
        const gameDurationMs = state.gameDurationMs ?? 6 * 60 * 1000;

        // 6-minute timer: if time's up and base alive, players win
        if (room.startTime && now - room.startTime >= gameDurationMs) {
          room.state = 'ended';
          io.to(room.code).emit("gameOver", { winner: "השחקנים!" });
          persistGameResult(room, "השחקנים!");
          return;
        }

        // Wave advance: no zombies left and spawned enough this wave
        if (state.zombies.length === 0 && spawned >= toSpawn) {
          state.wave = wave + 1;
          state.zombiesSpawnedThisWave = 0;
          state.zombiesToSpawnThisWave = 6 * playerCount + state.wave * 3;
        }

        // Spawn zombies from edges (~6 per player per wave, scales with wave)
        if (spawned < (state.zombiesToSpawnThisWave ?? 6 * playerCount)) {
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

        // Turrets shoot (weakened: less damage, slower fire)
        (state.turrets || []).forEach((t: any) => {
          if (now - (t.lastShoot || 0) > 1600) {
            let closest: any = null;
            let minDist = 280;
            state.zombies.forEach((z: any) => {
              const d = Math.hypot(z.x - t.x, z.y - t.y);
              if (d < minDist) { minDist = d; closest = z; }
            });
            if (closest) {
              closest.hp -= 12;
              t.lastShoot = now;
              state.lasers.push({ x1: t.x, y1: t.y, x2: closest.x, y2: closest.y, color: '#3b82f6', createdAt: now });
            }
          }
        });

        state.zombies = state.zombies.filter((z: any) => z.hp > 0);

        if (state.baseHealth <= 0) {
          room.state = 'ended';
          io.to(room.code).emit("gameOver", { winner: "הזומבים" });
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
                aiBoss.hp -= 1;
                state.lasers.push({ x1: proj.x, y1: proj.y, x2: aiBoss.x, y2: aiBoss.y, color: '#ef4444' });
                io.to(room.code).emit("globalStateUpdated", state);
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
                  boss.modeState.hp -= 1;
                  state.lasers.push({ x1: proj.x, y1: proj.y, x2: boss.x, y2: boss.y, color: '#ef4444' });
                }
                io.to(room.code).emit("playerUpdated", { playerId: boss.id, player: boss });
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
                hero.modeState.hp = (hero.modeState.hp ?? 2) - 1;
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
            io.to(room.code).emit("gameOver", { winner: bossWinner });
            persistGameResult(room, bossWinner);
          }
        }
      }

      // --- CTF MODE ---
      else if (room.mode === 'ctf') {
        const playersList = Object.values(room.players);
        
        playersList.forEach(p => {
          if (p.modeState.hp <= 0) {
            if (now > p.modeState.respawnAt) {
              p.modeState.hp = 100;
              p.x = p.modeState.team === 'red' ? 500 : 5500;
              p.y = p.modeState.team === 'red' ? 4200 : 800;
            }
            return;
          }

          // אנרגיה מתמלאת רק משאלות נכונות - לא אוטומטית

          playersList.forEach(otherP => {
            if (otherP.id !== p.id && otherP.modeState.hp > 0 && otherP.modeState.team !== p.modeState.team) {
              if (Math.hypot(p.x - otherP.x, p.y - otherP.y) < 30) {
                if ((p.modeState.team === 'red' && p.x < 3000 && otherP.x < 3000) || 
                    (p.modeState.team === 'blue' && p.x > 3000 && otherP.x > 3000)) {
                  otherP.modeState.hp = 0;
                  otherP.modeState.respawnAt = now + 3000; // 3 seconds respawn
                  
                  // Drop flag if carrying
                  if (otherP.modeState.hasFlag) {
                    otherP.modeState.hasFlag = false;
                    if (otherP.modeState.team === 'red') {
                      state.blueFlag.carrier = null;
                    } else {
                      state.redFlag.carrier = null;
                    }
                  }
                  io.to(room.code).emit('ctfTagged', { x: otherP.x, y: otherP.y, taggerTeam: p.modeState.team });
                }
              }
            }
          });

          // Grab flag - מיידי כשמגיעים לאזור הדגל, בלי שאלות
          if (p.modeState.team === 'red' && !state.blueFlag.carrier && Math.hypot(p.x - state.blueFlag.x, p.y - state.blueFlag.y) < 65) {
            state.blueFlag.carrier = p.id;
            p.modeState.hasFlag = true;
          } else if (p.modeState.team === 'blue' && !state.redFlag.carrier && Math.hypot(p.x - state.redFlag.x, p.y - state.redFlag.y) < 65) {
            state.redFlag.carrier = p.id;
            p.modeState.hasFlag = true;
          }

          // Return dropped flag
          if (p.modeState.team === 'red' && !state.redFlag.carrier && Math.hypot(p.x - state.redFlag.x, p.y - state.redFlag.y) < 50 && (state.redFlag.x !== state.redFlag.base.x || state.redFlag.y !== state.redFlag.base.y)) {
            state.redFlag.x = state.redFlag.base.x;
            state.redFlag.y = state.redFlag.base.y;
          } else if (p.modeState.team === 'blue' && !state.blueFlag.carrier && Math.hypot(p.x - state.blueFlag.x, p.y - state.blueFlag.y) < 50 && (state.blueFlag.x !== state.blueFlag.base.x || state.blueFlag.y !== state.blueFlag.base.y)) {
            state.blueFlag.x = state.blueFlag.base.x;
            state.blueFlag.y = state.blueFlag.base.y;
          }

          // Score flag
          if (p.modeState.hasFlag) {
            const base = p.modeState.team === 'red' ? state.redFlag.base : state.blueFlag.base;
            if (Math.hypot(p.x - base.x, p.y - base.y) < 80) {
              p.modeState.hasFlag = false;
              if (p.modeState.team === 'red') {
                state.redScore++;
                state.blueFlag = { ...state.blueFlag, x: state.blueFlag.base.x, y: state.blueFlag.base.y, carrier: null };
                io.to(room.code).emit('ctfScored', { team: 'red', x: base.x, y: base.y });
              } else {
                state.blueScore++;
                state.redFlag = { ...state.redFlag, x: state.redFlag.base.x, y: state.redFlag.base.y, carrier: null };
                io.to(room.code).emit('ctfScored', { team: 'blue', x: base.x, y: base.y });
              }
            }
          }
        });

        if (state.redFlag.carrier && room.players[state.redFlag.carrier]) {
          state.redFlag.x = room.players[state.redFlag.carrier].x;
          state.redFlag.y = room.players[state.redFlag.carrier].y - 20;
        }
        if (state.blueFlag.carrier && room.players[state.blueFlag.carrier]) {
          state.blueFlag.x = room.players[state.blueFlag.carrier].x;
          state.blueFlag.y = room.players[state.blueFlag.carrier].y - 20;
        }

        if (state.redScore >= 3 || state.blueScore >= 3) {
          room.state = 'ended';
          const ctfWinner = state.redScore >= 3 ? "קבוצה אדומה" : "קבוצה כחולה";
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

      // --- FARM MODE ---
      else if (room.mode === 'farm') {
        if (state.asteroids.length < 15 && Math.random() < 0.05) {
          state.asteroids.push({
            id: Math.random().toString(),
            x: 100 + Math.random() * 800,
            y: 100 + Math.random() * 800,
            hp: 100, maxHp: 100,
            value: 50 + Math.floor(Math.random() * 100),
            vx: (Math.random() - 0.5) * 2,
            vy: (Math.random() - 0.5) * 2
          });
        }

        state.asteroids.forEach((a: any) => {
          a.x += a.vx; a.y += a.vy;
          if (a.x < 0 || a.x > 1000) a.vx *= -1;
          if (a.y < 0 || a.y > 1000) a.vy *= -1;
        });

        const MOVE_SPEED = 14;
        Object.values(room.players).forEach((pl: any) => {
          const vx = (pl.modeState?.vx || 0) * MOVE_SPEED;
          const vy = (pl.modeState?.vy || 0) * MOVE_SPEED;
          pl.x = Math.max(80, Math.min(920, (pl.x || 500) + vx));
          pl.y = Math.max(80, Math.min(920, (pl.y || 500) + vy));
        });

        const projs = state.projectiles || [];
        const dt = 1 / 30;
        projs.forEach((p: any) => {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
        });
        state.projectiles = projs.filter((p: any) => {
          if (p.x < -50 || p.x > 1050 || p.y < -50 || p.y > 1050) return false;
          const aoeRadius = p.type === 'plasma' ? 80 : 0;
          const hits = state.asteroids.filter((a: any) => {
            const d = Math.hypot(a.x - p.x, a.y - p.y);
            const astRadius = 20 + (a.value || 50) / 20;
            return d < (aoeRadius || astRadius) + (p.radius || 4);
          });
          if (hits.length > 0) {
            hits.forEach((hit: any) => {
              hit.hp -= p.damage;
              if (hit.hp <= 0) {
                const player = room.players[p.shooterId];
                if (player) player.score += hit.value;
                (state.collectibles || []).push({ id: Math.random().toString(), x: hit.x, y: hit.y, value: hit.value, vx: 0, vy: 0 });
              }
            });
            return false;
          }
          return true;
        });

        const coll = state.collectibles || [];
        coll.forEach((c: any) => {
          c.vy += 0.3;
          c.x += c.vx; c.y += c.vy;
        });
        Object.values(room.players).forEach((pl: any) => {
          const mag = pl.modeState?.magnetRange || 50;
          const shipX = pl.x ?? 500, shipY = pl.y ?? 500;
          state.collectibles = (state.collectibles || []).filter((c: any) => {
            const d = Math.hypot(c.x - shipX, c.y - shipY);
            if (d < mag) {
              pl.score += c.value;
              return false;
            }
            if (c.y > 1100) return false;
            return true;
          });
        });

        state.asteroids = state.asteroids.filter((a: any) => a.hp > 0);
        
        if (room.startTime && now - room.startTime > 7 * 60 * 1000) { // 7 minutes
          const winner = Object.values(room.players).sort((a,b) => b.score - a.score)[0];
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
  }, 1000 / 30);

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
