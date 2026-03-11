import express from "express";
import { createServer as createViteServer } from "vite";
import { Server } from "socket.io";
import http from "http";

const PORT = 3000;

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

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function startServer() {
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
        rooms[code].globalState = { baseHealth: 2000, maxBaseHealth: 2000, wave: 1, zombies: [], lasers: [], turrets: [] };
      } else if (mode === 'boss') {
        rooms[code].globalState = { bossId: null, timeLeft: 600, lasers: [] }; // 10 minutes
      } else if (mode === 'ctf') {
        rooms[code].globalState = { redScore: 0, blueScore: 0, redFlag: { x: 100, y: 500, carrier: null, base: {x: 100, y: 500} }, blueFlag: { x: 900, y: 500, carrier: null, base: {x: 900, y: 500} }, lasers: [] };
      } else if (mode === 'economy') {
        rooms[code].globalState = { events: [] };
      } else if (mode === 'farm') {
        rooms[code].globalState = { asteroids: [], lasers: [] };
      }

      socket.join(code);
      callback({ success: true, code });
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
        newPlayer.modeState = { hp: 100, maxHp: 100, damage: 20 };
      } else if (room.mode === 'ctf') {
        const redCount = Object.values(room.players).filter(p => p.modeState.team === 'red').length;
        const blueCount = Object.values(room.players).filter(p => p.modeState.team === 'blue').length;
        newPlayer.modeState = { team: redCount <= blueCount ? 'red' : 'blue', hasFlag: false, hp: 100, maxHp: 100 };
        newPlayer.x = newPlayer.modeState.team === 'red' ? 150 : 850;
      } else if (room.mode === 'economy') {
        newPlayer.modeState = { multiplier: 1, frozenUntil: 0 };
      } else if (room.mode === 'farm') {
        newPlayer.modeState = { laserDamage: 25, magnetRange: 50, hasShield: false };
      } else if (room.mode === 'boss') {
        newPlayer.modeState = { isBoss: false, hp: 100, maxHp: 100, disabledUntil: 0, shields: 0 };
      }

      room.players[playerId] = newPlayer;
      socket.join(code);
      
      io.to(code).emit("roomUpdated", room);
      callback({ success: true, playerId, room });
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

    socket.on("startGame", ({ code }) => {
      const room = rooms[code];
      if (room && room.hostId === socket.id) {
        room.state = 'playing';
        room.startTime = Date.now();
        
        if (room.mode === 'boss') {
          const playerIds = Object.keys(room.players);
          if (playerIds.length > 0) {
            const bossId = playerIds[Math.floor(Math.random() * playerIds.length)];
            room.globalState.bossId = bossId;
            room.players[bossId].modeState.isBoss = true;
            room.players[bossId].modeState.maxHp = playerIds.length * 2000;
            room.players[bossId].modeState.hp = playerIds.length * 2000;
          }
        }

        io.to(code).emit("gameStarted", room);
      }
    });

    socket.on("updatePosition", ({ code, playerId, x, y }) => {
      const room = rooms[code];
      if (room && room.state === 'playing' && room.players[playerId]) {
        const p = room.players[playerId];
        
        if (room.mode === 'economy' && p.modeState.frozenUntil > Date.now()) return;
        if (room.mode === 'boss' && p.modeState.disabledUntil > Date.now()) return;

        if (room.mode === 'ctf') {
          // Consume energy to move
          const dist = Math.hypot(p.x - x, p.y - y);
          if (p.resources >= dist * 0.1) {
            p.resources -= dist * 0.1;
            p.x = Math.max(15, Math.min(985, x));
            p.y = Math.max(15, Math.min(985, y));
          }
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
        if (room.mode === 'economy') earned *= (player.modeState.multiplier || 1);
        if (room.mode === 'ctf') earned = 50; // Energy
        if (room.mode === 'boss') earned = player.modeState.isBoss ? 20 : 50; // Boss gets shield points, heroes get damage points
        if (room.mode === 'farm') earned = 20; // Laser energy
        
        player.resources += earned;
        player.score += 10;
      } else {
        // Penalty
        if (room.mode === 'economy') player.resources = Math.max(0, player.resources - 5);
      }

      io.to(code).emit("playerUpdated", { playerId, player });
      checkWinCondition(code);
    });

    socket.on("buyUpgrade", ({ code, playerId, upgradeId, cost, targetId }) => {
      const room = rooms[code];
      if (!room || room.state !== 'playing') return;
      const player = room.players[playerId];
      if (!player || player.resources < cost) return;

      player.resources -= cost;

      if (upgradeId === 'speed') {
        player.modeState.speed = (player.modeState.speed || 6) + 2;
      }

      if (room.mode === 'zombie') {
        if (upgradeId === 'repair') room.globalState.baseHealth = Math.min(room.globalState.maxBaseHealth, room.globalState.baseHealth + 500);
        if (upgradeId === 'turret') room.globalState.turrets.push({ x: player.x, y: player.y, lastShoot: 0 });
        if (upgradeId === 'heal') {
          Object.values(room.players).forEach(p => p.modeState.hp = p.modeState.maxHp);
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
        if (upgradeId === 'laser') player.modeState.laserDamage += 25;
        if (upgradeId === 'magnet') player.modeState.magnetRange += 50;
        if (upgradeId === 'shield') player.modeState.hasShield = true;
      } else if (room.mode === 'boss') {
        if (player.modeState.isBoss) {
          if (upgradeId === 'shield') player.modeState.shields += 1;
          if (upgradeId === 'disable' && targetId && room.players[targetId]) {
            room.players[targetId].modeState.disabledUntil = Date.now() + 5000;
          }
        }
      }

      io.to(code).emit("playerUpdated", { playerId, player });
      io.to(code).emit("globalStateUpdated", room.globalState);
    });

    socket.on("action", ({ code, playerId, actionType, targetId }) => {
      const room = rooms[code];
      if (!room || room.state !== 'playing') return;
      const player = room.players[playerId];
      if (!player) return;

      if (room.mode === 'boss' && actionType === 'attack' && !player.modeState.isBoss) {
        const boss = room.players[room.globalState.bossId];
        if (boss && player.resources > 0) {
          const damage = player.resources;
          player.resources = 0;
          
          if (boss.modeState.shields > 0) {
            boss.modeState.shields -= 1;
            room.globalState.lasers.push({ x1: player.x, y1: player.y, x2: boss.x, y2: boss.y, color: '#3b82f6', blocked: true });
          } else {
            boss.modeState.hp -= damage;
            room.globalState.lasers.push({ x1: player.x, y1: player.y, x2: boss.x, y2: boss.y, color: '#ef4444' });
          }
          io.to(code).emit("playerUpdated", { playerId: boss.id, player: boss });
          io.to(code).emit("playerUpdated", { playerId: player.id, player });
          checkWinCondition(code);
        }
      } else if (room.mode === 'farm' && actionType === 'shoot' && targetId) {
        const asteroid = room.globalState.asteroids.find((a:any) => a.id === targetId);
        if (asteroid && player.resources >= 10) {
          player.resources -= 10;
          asteroid.hp -= player.modeState.laserDamage;
          room.globalState.lasers.push({ x1: player.x, y1: player.y, x2: asteroid.x, y2: asteroid.y, color: '#a855f7' });
          
          if (asteroid.hp <= 0) {
            player.score += asteroid.value; // Use score for Space Ore
          }
          io.to(code).emit("playerUpdated", { playerId: player.id, player });
        }
      } else if (room.mode === 'zombie' && actionType === 'shoot_zombie' && targetId) {
        const zombie = room.globalState.zombies.find((z:any) => z.id === targetId);
        if (zombie && player.resources >= 5) {
          player.resources -= 5;
          zombie.hp -= player.modeState.damage || 20;
          room.globalState.lasers.push({ x1: player.x, y1: player.y, x2: zombie.x, y2: zombie.y, color: '#ef4444' });
          
          if (zombie.hp <= 0) {
            player.score += 10;
          }
          io.to(code).emit("playerUpdated", { playerId: player.id, player });
        }
      }
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });

    function checkWinCondition(code: string) {
      const room = rooms[code];
      if (!room || room.state !== 'playing') return;
      let winner = null;
      
      if (room.mode === 'economy') {
        const p = Object.values(room.players).find(p => p.resources >= 10000);
        if (p) winner = p.name;
      } else if (room.mode === 'zombie') {
        if (room.globalState.baseHealth <= 0) winner = "הזומבים";
      } else if (room.mode === 'boss') {
        const boss = room.players[room.globalState.bossId];
        if (boss && boss.modeState.hp <= 0) winner = "הגיבורים";
        else if (room.globalState.timeLeft <= 0) winner = boss?.name || "הבוס";
      } else if (room.mode === 'ctf') {
        if (room.globalState.redScore >= 3) winner = "קבוצה אדומה";
        if (room.globalState.blueScore >= 3) winner = "קבוצה כחולה";
      }

      if (winner) {
        room.state = 'ended';
        io.to(code).emit("gameOver", { winner });
      }
    }
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
        if (Math.random() < 0.02 + (state.wave * 0.005)) {
          let zx, zy;
          if (Math.random() < 0.5) { zx = Math.random() * 1000; zy = Math.random() < 0.5 ? -50 : 1050; }
          else { zx = Math.random() < 0.5 ? -50 : 1050; zy = Math.random() * 1000; }
          state.zombies.push({
            id: Math.random().toString(),
            x: zx, y: zy,
            hp: 30 + (state.wave * 10), maxHp: 30 + (state.wave * 10),
            speed: 1 + (state.wave * 0.1)
          });
        }

        state.zombies.forEach((z: any) => {
          const dx = 500 - z.x;
          const dy = 500 - z.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 60) {
            z.x += (dx / dist) * z.speed;
            z.y += (dy / dist) * z.speed;
          } else {
            state.baseHealth -= 1;
          }
        });

        // Turrets shoot
        state.turrets.forEach((t: any) => {
          if (now - t.lastShoot > 500) {
            let closest: any = null; let minDist = 300;
            state.zombies.forEach((z: any) => {
              const d = Math.hypot(z.x - t.x, z.y - t.y);
              if (d < minDist) { minDist = d; closest = z; }
            });
            if (closest) {
              closest.hp -= 30;
              t.lastShoot = now;
              state.lasers.push({ x1: t.x, y1: t.y, x2: closest.x, y2: closest.y, color: '#3b82f6' });
            }
          }
        });

        state.zombies = state.zombies.filter((z: any) => z.hp > 0);
        if (Math.random() < 0.0005) state.wave += 1;
        if (state.baseHealth <= 0) {
          room.state = 'ended';
          io.to(room.code).emit("gameOver", { winner: "הזומבים" });
        }
      }

      // --- BOSS MODE ---
      else if (room.mode === 'boss') {
        if (room.startTime) {
          state.timeLeft = Math.max(0, 600 - Math.floor((now - room.startTime) / 1000));
          if (state.timeLeft <= 0) {
            room.state = 'ended';
            io.to(room.code).emit("gameOver", { winner: room.players[state.bossId]?.name || "הבוס" });
          }
        }
      }

      // --- CTF MODE ---
      else if (room.mode === 'ctf') {
        const playersList = Object.values(room.players);
        
        playersList.forEach(p => {
          if (p.modeState.hp <= 0) {
            // Respawn logic
            if (now > p.modeState.respawnAt) {
              p.modeState.hp = 100;
              p.x = p.modeState.team === 'red' ? 150 : 850;
              p.y = 500;
            }
            return;
          }

          // Regenerate energy slowly
          if (p.resources < 100) {
            p.resources += 0.5; // 15 energy per second at 30fps
          }

          // Tagging logic
          playersList.forEach(otherP => {
            if (otherP.id !== p.id && otherP.modeState.hp > 0 && otherP.modeState.team !== p.modeState.team) {
              if (Math.hypot(p.x - otherP.x, p.y - otherP.y) < 30) {
                // If p is on their own side, they tag otherP
                if ((p.modeState.team === 'red' && p.x < 500 && otherP.x < 500) || 
                    (p.modeState.team === 'blue' && p.x > 500 && otherP.x > 500)) {
                  otherP.modeState.hp = 0;
                  otherP.modeState.respawnAt = now + 3000; // 3 seconds respawn
                  
                  // Drop flag if carrying
                  if (otherP.modeState.hasFlag) {
                    otherP.modeState.hasFlag = false;
                    if (otherP.modeState.team === 'red') {
                      state.blueFlag.carrier = null;
                      // Flag stays where it dropped
                    } else {
                      state.redFlag.carrier = null;
                    }
                  }
                }
              }
            }
          });

          // Grab flag
          if (p.modeState.team === 'red' && !state.blueFlag.carrier && Math.hypot(p.x - state.blueFlag.x, p.y - state.blueFlag.y) < 40) {
            state.blueFlag.carrier = p.id;
            p.modeState.hasFlag = true;
          } else if (p.modeState.team === 'blue' && !state.redFlag.carrier && Math.hypot(p.x - state.redFlag.x, p.y - state.redFlag.y) < 40) {
            state.redFlag.carrier = p.id;
            p.modeState.hasFlag = true;
          }

          // Return dropped flag
          if (p.modeState.team === 'red' && !state.redFlag.carrier && Math.hypot(p.x - state.redFlag.x, p.y - state.redFlag.y) < 40 && (state.redFlag.x !== state.redFlag.base.x || state.redFlag.y !== state.redFlag.base.y)) {
            state.redFlag.x = state.redFlag.base.x;
            state.redFlag.y = state.redFlag.base.y;
          } else if (p.modeState.team === 'blue' && !state.blueFlag.carrier && Math.hypot(p.x - state.blueFlag.x, p.y - state.blueFlag.y) < 40 && (state.blueFlag.x !== state.blueFlag.base.x || state.blueFlag.y !== state.blueFlag.base.y)) {
            state.blueFlag.x = state.blueFlag.base.x;
            state.blueFlag.y = state.blueFlag.base.y;
          }

          // Score flag
          if (p.modeState.hasFlag) {
            const base = p.modeState.team === 'red' ? state.redFlag.base : state.blueFlag.base;
            if (Math.hypot(p.x - base.x, p.y - base.y) < 50) {
              p.modeState.hasFlag = false;
              if (p.modeState.team === 'red') {
                state.redScore++;
                state.blueFlag = { ...state.blueFlag, x: state.blueFlag.base.x, y: state.blueFlag.base.y, carrier: null };
              } else {
                state.blueScore++;
                state.redFlag = { ...state.redFlag, x: state.redFlag.base.x, y: state.redFlag.base.y, carrier: null };
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
          io.to(room.code).emit("gameOver", { winner: state.redScore >= 3 ? "קבוצה אדומה" : "קבוצה כחולה" });
        }
      }

      // --- ECONOMY MODE ---
      else if (room.mode === 'economy') {
        if (!state.coins) state.coins = [];
        if (state.coins.length < 20 && Math.random() < 0.05) {
          state.coins.push({
            id: Math.random().toString(),
            x: 100 + Math.random() * 800,
            y: 100 + Math.random() * 800,
            value: 10 + Math.floor(Math.random() * 40)
          });
        }

        Object.values(room.players).forEach(p => {
          if (p.modeState.frozenUntil > now) return;
          state.coins = state.coins.filter((c: any) => {
            if (Math.hypot(p.x - c.x, p.y - c.y) < 30) {
              p.resources += c.value * (p.modeState.multiplier || 1);
              if (p.resources >= 10000) {
                room.state = 'ended';
                io.to(room.code).emit("gameOver", { winner: p.name });
              }
              return false;
            }
            return true;
          });
        });
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

        state.asteroids = state.asteroids.filter((a: any) => a.hp > 0);
        
        if (room.startTime && now - room.startTime > 7 * 60 * 1000) { // 7 minutes
          const winner = Object.values(room.players).sort((a,b) => b.score - a.score)[0];
          room.state = 'ended';
          io.to(room.code).emit("gameOver", { winner: winner?.name });
        }
      }

      io.to(room.code).emit('tick', { players: room.players, globalState: state });
    });
  }, 1000 / 30);

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
