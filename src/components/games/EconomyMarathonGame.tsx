import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QuestionPanel } from '../QuestionPanel';
import { TrendingUp, Snowflake, ShoppingCart, HelpCircle } from 'lucide-react';
import { socket } from '../../socket';
import { createInputState, getMoveDirection, setupKeyboardListeners } from '../../engine/input';
import { createCamera, updateCamera } from '../../engine/camera';
import { VirtualJoystick } from '../../engine/VirtualJoystick';
import {
  type Particle, type DustMote, type ShakeState,
  tickParticles, tickShake, triggerShake,
  createDust, drawDust, drawGlow, colorAlpha, roundRect,
} from './renderUtils';
import type { CameraState } from '../../engine/types';

const WORLD_SIZE = 4000;
const PLAYER_SPEED = 280;
const MAP_CENTER = 2000;

interface Props {
  roomCode: string;
  playerId: string;
  player: any;
  questions: any[];
  globalState: any;
  allPlayers: Record<string, any>;
  startTime?: number;
}

export function EconomyMarathonGame({ roomCode, playerId, player, questions, globalState, allPlayers, startTime }: Props) {
  const [showQuestions, setShowQuestions] = useState(false);
  const [showShop, setShowShop] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gsRef = useRef(globalState);
  const playersRef = useRef(allPlayers);
  const posRef = useRef({
    x: player?.x ?? MAP_CENTER,
    y: player?.y ?? MAP_CENTER,
  });
  const inputRef = useRef(createInputState());
  const cameraRef = useRef<CameraState>(createCamera());
  const camInitRef = useRef(false);
  const lastSyncRef = useRef(0);
  const lastMoveTimeRef = useRef(0);
  const particlesRef = useRef<Particle[]>([]);
  const dustRef = useRef<DustMote[]>([]);
  const shakeRef = useRef<ShakeState>({ intensity: 0, offsetX: 0, offsetY: 0 });
  const prevGoldRef = useRef(0);
  const timeRef = useRef(0);
  const playerRef = useRef(player);
  const localEnergyRef = useRef<number>(player?.modeState?.energy ?? 100);
  const collectibleImgsRef = useRef<{
    treasure_chest: HTMLImageElement | null;
    coin_pile: HTMLImageElement | null;
    money_bills: HTMLImageElement | null;
  }>({ treasure_chest: null, coin_pile: null, money_bills: null });

  useEffect(() => {
    const base = import.meta.env.BASE_URL || '/';
    const basePath = base.endsWith('/') ? base.slice(0, -1) : base;
    const load = (name: string, key: 'treasure_chest' | 'coin_pile' | 'money_bills') => {
      const img = new Image();
      img.src = `${basePath}/images/${name}`;
      img.onload = () => { collectibleImgsRef.current[key] = img; };
      img.onerror = () => console.warn(`[EconomyMarathon] Failed to load ${name}`);
    };
    load('treasure-chest.png', 'treasure_chest');
    load('coin-pile.png', 'coin_pile');
    load('money-bills.png', 'money_bills');
  }, []);

  useEffect(() => { gsRef.current = globalState; }, [globalState]);
  useEffect(() => { playerRef.current = player; }, [player]);
  useEffect(() => {
    const srvE = player?.modeState?.energy;
    if (srvE !== undefined) localEnergyRef.current = srvE;
  }, [player?.modeState?.energy]);
  useEffect(() => { playersRef.current = allPlayers; }, [allPlayers]);
  useEffect(() => {
    const newGold = player?.resources || 0;
    if (newGold > prevGoldRef.current) {
      triggerShake(shakeRef.current, Math.min(4, (newGold - prevGoldRef.current) * 0.01));
    }
    prevGoldRef.current = newGold;
  }, [player?.resources]);

  useEffect(() => setupKeyboardListeners(inputRef.current), []);

  const onJoystickMove = useCallback((dx: number, dy: number) => {
    inputRef.current.joystickDir = { x: dx, y: dy };
    inputRef.current.joystickActive = true;
  }, []);
  const onJoystickRelease = useCallback(() => {
    inputRef.current.joystickDir = { x: 0, y: 0 };
    inputRef.current.joystickActive = false;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let lastTime = performance.now();
    let raf: number;

    const loop = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      timeRef.current += dt;
      const t = timeRef.current;

      const parent = canvas.parentElement;
      if (parent) {
        const pw = parent.clientWidth;
        const ph = parent.clientHeight;
        if (canvas.width !== pw || canvas.height !== ph) {
          canvas.width = pw;
          canvas.height = ph;
          dustRef.current = createDust(50, pw, ph);
        }
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) { raf = requestAnimationFrame(loop); return; }

      const vpW = canvas.width;
      const vpH = canvas.height;
      if (vpW === 0 || vpH === 0) { raf = requestAnimationFrame(loop); return; }

      const zoom = Math.min(vpW, vpH) / 900;
      const gs = gsRef.current;
      const players = playersRef.current;
      const cam = cameraRef.current;
      const p = playerRef.current;
      const canMove = localEnergyRef.current > 0 && (p?.modeState?.frozenUntil || 0) <= Date.now();

      if (canMove) {
        const dir = getMoveDirection(inputRef.current);
        if (dir.x !== 0 || dir.y !== 0) {
          const moveX = dir.x * PLAYER_SPEED * dt;
          const moveY = dir.y * PLAYER_SPEED * dt;
          const moveDist = Math.hypot(moveX, moveY);
          const cost = moveDist * 0.02;

          if (localEnergyRef.current >= cost) {
            localEnergyRef.current = Math.max(0, localEnergyRef.current - cost);
            lastMoveTimeRef.current = now;
            posRef.current.x = Math.max(30, Math.min(WORLD_SIZE - 30, posRef.current.x + moveX));
            posRef.current.y = Math.max(30, Math.min(WORLD_SIZE - 30, posRef.current.y + moveY));

            if (now - lastSyncRef.current > 50) {
              socket.emit('updatePosition', { code: roomCode, playerId, x: posRef.current.x, y: posRef.current.y });
              lastSyncRef.current = now;
            }
          } else {
            localEnergyRef.current = 0;
          }
        }
      }

      if (!camInitRef.current) {
        cam.x = posRef.current.x - vpW / (2 * zoom);
        cam.y = posRef.current.y - vpH / (2 * zoom);
        cam.zoom = zoom;
        camInitRef.current = true;
      }
      cam.zoom = zoom;
      updateCamera(cam, posRef.current, vpW, vpH, WORLD_SIZE, WORLD_SIZE, 0.12);

      const shake = tickShake(shakeRef.current);
      ctx.save();
      ctx.translate(shake.x, shake.y);

      ctx.fillStyle = '#050a0f';
      ctx.fillRect(0, 0, vpW, vpH);

      ctx.save();
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);

      drawWorld(ctx, cam, vpW, vpH, t);
      drawCollectiblesWorld(ctx, gs?.collectibles || [], t, collectibleImgsRef.current, cam, vpW, vpH);
      drawPlayers(ctx, players, playerId, posRef.current, t);
      particlesRef.current = tickParticles(ctx, particlesRef.current);

      ctx.restore();
      drawDust(ctx, dustRef.current, vpW, vpH, '#fbbf24');
      ctx.restore();

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [roomCode, playerId]);

  const onCorrect = () => {
    socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: true });
    localEnergyRef.current = Math.min(player?.modeState?.maxEnergy ?? 100, localEnergyRef.current + 25);
  };
  const onWrong = () => socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: false });
  const buyUpgrade = (id: string, cost: number) => socket.emit('buyUpgrade', { code: roomCode, playerId, upgradeId: id, cost });

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 100);
    return () => clearInterval(id);
  }, []);
  const gold = Math.floor(player?.resources || 0);
  const energy = Math.floor(localEnergyRef.current);
  const maxEnergy = player?.modeState?.maxEnergy ?? 100;
  const energyPct = maxEnergy > 0 ? energy / maxEnergy : 0;
  const timeLimit = globalState?.timeLimit ?? 300;
  const timeLeft = startTime && timeLimit
    ? Math.max(0, timeLimit - Math.floor((Date.now() - startTime) / 1000))
    : (globalState?.timeLeft ?? 300);
  const isFrozen = (player?.modeState?.frozenUntil || 0) > Date.now();
  const collectibleCount = globalState?.collectibles?.length || 0;
  const sorted = Object.values(allPlayers || {}).sort((a: any, b: any) => (b.resources || 0) - (a.resources || 0));
  const myRank = sorted.findIndex((p: any) => p.id === playerId) + 1;

  return (
    <div className="fixed inset-0 bg-[#050a0f] text-white flex flex-col">
      <div className="absolute inset-0">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      </div>

      <div className="absolute top-0 left-0 right-0 z-20 p-3 bg-gradient-to-b from-black/85 to-transparent pointer-events-none">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <span className="text-base font-bold text-amber-400">מרתון כלכלי</span>
            <div className="bg-amber-900/70 px-4 py-1.5 rounded-lg border border-amber-600/50">
              <span className="text-xl font-black text-amber-300">💰 {gold.toLocaleString()}</span>
            </div>
            <div className="bg-yellow-900/50 px-3 py-1.5 rounded border border-yellow-600/40">
              <span className="text-base font-bold text-yellow-300">⚡ {energy}</span>
            </div>
            <span className="text-sm bg-indigo-900/60 px-2.5 py-1 rounded">#{myRank || '?'}</span>
            <span className="text-xs bg-green-900/60 px-2 py-1 rounded text-green-300">🗺️ {collectibleCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-cyan-400">⏱️ {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}</span>
          </div>
        </div>
        <div className="mt-2 h-12 min-h-[48px] bg-slate-800/95 rounded-xl overflow-hidden border-2 border-amber-600/50 relative flex items-center">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-xl"
            style={{
              width: `${energyPct * 100}%`,
              background: 'linear-gradient(90deg,#f59e0b,#fbbf24,#fde68a)',
            }}
            animate={{ width: `${energyPct * 100}%` }}
            transition={{ duration: 0.3 }}
          />
          <span className="relative z-10 w-full text-center text-base font-black text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] px-2">
            אנרגיה ({energy}/{maxEnergy}) - ענה על שאלות למלא אנרגיה!
          </span>
        </div>
      </div>

      <AnimatePresence>
        {energy === 0 && !isFrozen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 flex items-center justify-center bg-black/60"
          >
            <div className="bg-amber-900/95 px-8 py-6 rounded-2xl border-2 border-amber-500 shadow-2xl text-center max-w-md pointer-events-auto">
              <p className="text-amber-200 font-black text-2xl mb-2">⚡ נגמרה האנרגיה!</p>
              <p className="text-amber-100 font-bold text-lg mb-4">אתה תקוע. ענה על שאלות כדי למלא אנרגיה ולהמשיך!</p>
              <button
                onClick={() => setShowQuestions(true)}
                className="px-8 py-4 rounded-xl font-black bg-amber-500 hover:bg-amber-400 text-white shadow-lg text-xl border-2 border-amber-300"
              >
                ❓ ענה על שאלות (+אנרגיה)
              </button>
            </div>
          </motion.div>
        )}
        {energy > 0 && energy < 20 && !isFrozen && (
          <motion.div
            initial={{ y: -30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -30, opacity: 0 }}
            className="absolute top-20 left-1/2 -translate-x-1/2 z-30 bg-amber-900/95 px-6 py-3 rounded-xl border-2 border-amber-500/60 pointer-events-none"
          >
            <p className="text-amber-200 font-bold text-lg">⚡ אנרגיה נמוכה! לחץ על &quot;שאלות&quot; וענה נכון למלא אנרגיה</p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isFrozen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-blue-900/30 backdrop-blur-sm"
          >
            <p className="text-2xl font-bold text-blue-200">❄️ קפוא!</p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute bottom-4 left-0 right-0 z-50 flex justify-center gap-3 px-4 pointer-events-auto">
        <button
          onClick={() => setShowQuestions(true)}
          className="px-5 py-3 rounded-xl font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-lg border border-amber-500/50 flex items-center gap-2"
        >
          <HelpCircle size={18} /> שאלות (+אנרגיה)
        </button>
        <button
          onClick={() => setShowShop(true)}
          className="px-5 py-3 rounded-xl font-bold bg-teal-600 hover:bg-teal-500 text-white shadow-lg border border-teal-500/50 flex items-center gap-2"
        >
          <ShoppingCart size={18} /> חנות
        </button>
      </div>

      <div className="absolute bottom-4 left-4 z-20 pointer-events-auto">
        <VirtualJoystick onMove={onJoystickMove} onRelease={onJoystickRelease} size={110} teamColor="rgba(245,158,11,0.5)" />
      </div>

      <div className="absolute top-20 right-4 z-20 pointer-events-none">
        <div className="bg-slate-900/80 backdrop-blur rounded-xl p-2 border border-amber-600/30 max-w-[160px]">
          <div className="text-[10px] text-amber-400 font-bold mb-1">טבלת מובילים</div>
          {sorted.slice(0, 5).map((p: any, i: number) => (
            <div key={p.id} className={`flex justify-between text-xs py-0.5 ${p.id === playerId ? 'text-amber-300 font-bold' : 'text-slate-400'}`}>
              <span>{i === 0 && '👑 '}{i + 1}. {p.name?.slice(0, 8)}{p.id === playerId ? ' (אתה)' : ''}</span>
              <span className="text-amber-400 font-mono">${Math.floor(p.resources || 0)}</span>
            </div>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {showQuestions && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowQuestions(false)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-900 rounded-2xl border-2 border-amber-600/50 shadow-2xl max-w-lg w-full max-h-[85vh] overflow-hidden"
            >
              <div className="p-4 border-b border-amber-600/30 flex justify-between items-center bg-amber-900/20">
                <span className="font-bold text-amber-400">ענה נכון = +25 אנרגיה!</span>
                <button onClick={() => setShowQuestions(false)} className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 font-bold">סיום ✓</button>
              </div>
              <div className="overflow-y-auto max-h-[calc(85vh-80px)]">
                <QuestionPanel questions={questions} onCorrect={onCorrect} onWrong={onWrong} earnLabel="+10 💰 +25 ⚡" compact disabled={isFrozen} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showShop && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowShop(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-900 rounded-2xl border-2 border-teal-600/50 shadow-2xl max-w-md w-full max-h-[80vh] overflow-hidden"
            >
              <div className="p-4 border-b border-teal-600/30 flex justify-between items-center bg-teal-900/20">
                <span className="font-bold text-teal-400">חנות</span>
                <button onClick={() => setShowShop(false)} className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 font-bold">סגור</button>
              </div>
              <div className="p-4 space-y-2 overflow-y-auto">
                <ShopItem title="מכפיל רווחים" desc={`הכפל את הרווח ל-x${(player?.modeState?.multiplier || 1) + 1}`}
                  cost={300 * (player?.modeState?.multiplier || 1)} icon={<TrendingUp className="text-amber-400" size={18} />}
                  canAfford={gold >= 300 * (player?.modeState?.multiplier || 1)} onBuy={() => buyUpgrade('multiplier', 300 * (player?.modeState?.multiplier || 1))} />
                <ShopItem title="הקפאת מתחרים" desc="הקפא את כל השחקנים האחרים ל-10 שניות!"
                  cost={500} icon={<Snowflake className="text-blue-400" size={18} />}
                  canAfford={gold >= 500} onBuy={() => buyUpgrade('freeze', 500)} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ShopItem({ title, desc, cost, icon, canAfford, onBuy }: {
  title: string; desc: string; cost: number; icon: ReactNode; canAfford: boolean; onBuy: () => void;
}) {
  return (
    <motion.button
      whileTap={canAfford ? { scale: 0.96 } : {}}
      disabled={!canAfford}
      onClick={onBuy}
      className={`w-full p-3.5 rounded-xl flex items-center gap-3 transition-all relative overflow-hidden ${
        canAfford ? 'bg-slate-800/80 border border-amber-600/40' : 'bg-slate-800/30 border border-slate-700/40 opacity-50'
      }`}
    >
      <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-amber-900/30">{icon}</div>
      <div className="flex-1 text-right">
        <h4 className="font-bold text-sm">{title}</h4>
        <p className="text-[11px] text-slate-400">{desc}</p>
      </div>
      <div className={`font-bold px-3 py-1.5 rounded-lg ${canAfford ? 'bg-amber-600/30 text-amber-400' : 'text-slate-500'}`}>
        💰 {cost}
      </div>
    </motion.button>
  );
}

function seededRandom(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function drawWorld(ctx: CanvasRenderingContext2D, cam: CameraState, vpW: number, vpH: number, t: number) {
  const cx = cam.x + vpW / (2 * cam.zoom);
  const cy = cam.y + vpH / (2 * cam.zoom);
  const viewLeft = cam.x - 100;
  const viewTop = cam.y - 100;
  const viewW = vpW / cam.zoom + 200;
  const viewH = vpH / cam.zoom + 200;

  const grassGrad = ctx.createLinearGradient(viewLeft, viewTop, viewLeft + viewW, viewTop + viewH);
  grassGrad.addColorStop(0, '#0d2818');
  grassGrad.addColorStop(0.2, '#134e2a');
  grassGrad.addColorStop(0.5, '#166534');
  grassGrad.addColorStop(0.8, '#15803d');
  grassGrad.addColorStop(1, '#22c55e');
  ctx.fillStyle = grassGrad;
  ctx.fillRect(viewLeft, viewTop, viewW, viewH);

  const gridSize = 200;
  const startX = Math.floor(viewLeft / gridSize) * gridSize;
  const startY = Math.floor(viewTop / gridSize) * gridSize;
  ctx.strokeStyle = colorAlpha('#22c55e', 0.06);
  ctx.lineWidth = 1;
  for (let i = startX; i < viewLeft + viewW; i += gridSize) {
    ctx.beginPath();
    ctx.moveTo(i, viewTop);
    ctx.lineTo(i, viewTop + viewH);
    ctx.stroke();
  }
  for (let j = startY; j < viewTop + viewH; j += gridSize) {
    ctx.beginPath();
    ctx.moveTo(viewLeft, j);
    ctx.lineTo(viewLeft + viewW, j);
    ctx.stroke();
  }

  for (let gx = startX; gx < viewLeft + viewW + gridSize; gx += gridSize) {
    for (let gy = startY; gy < viewTop + viewH + gridSize; gy += gridSize) {
      const seed = gx * 7 + gy * 13;
      const r = seededRandom(seed);
      const rx = gx + r * gridSize * 0.8;
      const ry = gy + seededRandom(seed + 1) * gridSize * 0.8;

      if (r < 0.12) {
        drawTree(ctx, rx, ry, seed, t);
      } else if (r < 0.22) {
        drawBush(ctx, rx, ry, seed, t);
      } else if (r < 0.28) {
        drawRock(ctx, rx, ry, seed);
      } else if (r < 0.32 && Math.abs(rx - 2000) > 300 && Math.abs(ry - 2000) > 300) {
        drawPath(ctx, rx, ry, seed);
      } else if (r < 0.36) {
        drawFlower(ctx, rx, ry, seed, t);
      }
    }
  }

  for (let i = 0; i < 25; i++) {
    const seed = i * 7919;
    const ax = (seededRandom(seed) * WORLD_SIZE * 0.9) + 200;
    const ay = (seededRandom(seed + 1) * WORLD_SIZE * 0.9) + 200;
    if (ax > viewLeft - 100 && ax < viewLeft + viewW + 100 && ay > viewTop - 100 && ay < viewTop + viewH + 100) {
      drawAnimal(ctx, ax, ay, i % 3, t);
    }
  }

  drawGlow(ctx, cx, cy, 800, '#f59e0b', 0.02 + 0.01 * Math.sin(t * 0.5));
}

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, seed: number, t: number) {
  const sway = Math.sin(t * 2 + seed) * 4;
  const treeType = Math.floor(seededRandom(seed + 5) * 3);
  ctx.save();
  ctx.translate(x + sway, y);

  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 8;

  const trunkGrad = ctx.createLinearGradient(-12, 0, 12, 55);
  trunkGrad.addColorStop(0, '#5c3317');
  trunkGrad.addColorStop(0.3, '#422006');
  trunkGrad.addColorStop(0.7, '#3d1f05');
  trunkGrad.addColorStop(1, '#2d1a0a');
  ctx.fillStyle = trunkGrad;
  ctx.fillRect(-10, 0, 20, 55);
  ctx.strokeStyle = '#2d1a0a';
  ctx.lineWidth = 2;
  ctx.strokeRect(-10, 0, 20, 55);

  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  const leafColors = ['#166534', '#15803d', '#14532d', '#1a472a'];
  const leafColor = leafColors[Math.floor(seededRandom(seed + 2) * 4)];
  const size = treeType === 0 ? 1 : treeType === 1 ? 1.2 : 0.9;
  ctx.fillStyle = leafColor;
  ctx.beginPath();
  ctx.ellipse(0, -28, 42 * size, 48 * size, sway * 0.015, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#0f3d1a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, -28, 42 * size, 48 * size, sway * 0.015, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = colorAlpha('#22c55e', 0.4);
  ctx.beginPath();
  ctx.ellipse(sway * 2, -32, 28 * size, 32 * size, sway * 0.02, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawBush(ctx: CanvasRenderingContext2D, x: number, y: number, seed: number, t: number) {
  const bob = Math.sin(t * 3 + seed) * 3;
  ctx.save();
  ctx.translate(x, y + bob);

  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 4;

  ctx.fillStyle = '#0d3d1a';
  ctx.beginPath();
  ctx.ellipse(0, 2, 26, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#166534';
  ctx.beginPath();
  ctx.ellipse(0, 0, 24, 20, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#15803d';
  ctx.beginPath();
  ctx.ellipse(-10, -4, 14, 12, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(12, 2, 16, 14, -0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = colorAlpha('#22c55e', 0.6);
  ctx.beginPath();
  ctx.ellipse(2, -8, 10, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.restore();
}

function drawRock(ctx: CanvasRenderingContext2D, x: number, y: number, seed: number) {
  ctx.save();
  ctx.translate(x, y);

  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 4;

  const rot = seededRandom(seed) * 0.6;
  const rockGrad = ctx.createRadialGradient(-5, -5, 0, 0, 0, 25);
  rockGrad.addColorStop(0, '#6b7280');
  rockGrad.addColorStop(0.5, '#4b5563');
  rockGrad.addColorStop(1, '#374151');
  ctx.fillStyle = rockGrad;
  ctx.beginPath();
  ctx.ellipse(0, 0, 18, 12, rot, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = colorAlpha('#9ca3af', 0.3);
  ctx.beginPath();
  ctx.ellipse(-4, -4, 6, 4, rot, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.restore();
}

function drawPath(ctx: CanvasRenderingContext2D, x: number, y: number, seed: number) {
  ctx.save();
  ctx.translate(x, y);

  const rot = seededRandom(seed) * 0.4;
  const pathGrad = ctx.createLinearGradient(-50, 0, 50, 0);
  pathGrad.addColorStop(0, 'rgba(120,113,108,0.5)');
  pathGrad.addColorStop(0.5, 'rgba(139,119,101,0.7)');
  pathGrad.addColorStop(1, 'rgba(120,113,108,0.5)');
  ctx.fillStyle = pathGrad;
  ctx.beginPath();
  ctx.ellipse(0, 0, 55, 22, rot, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = colorAlpha('#57534e', 0.4);
  ctx.beginPath();
  ctx.ellipse(0, 0, 48, 18, rot, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = colorAlpha('#44403c', 0.5);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, 48, 18, rot, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

function drawFlower(ctx: CanvasRenderingContext2D, x: number, y: number, seed: number, t: number) {
  const sway = Math.sin(t * 4 + seed) * 2;
  const colors = ['#f472b6', '#fbbf24', '#a78bfa', '#34d399', '#fb7185', '#c084fc'];
  const petalColor = colors[Math.floor(seededRandom(seed) * 6)];
  ctx.save();
  ctx.translate(x + sway, y);

  ctx.fillStyle = '#166534';
  ctx.beginPath();
  ctx.ellipse(0, 4, 2, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = petalColor;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + seed * 0.1;
    ctx.save();
    ctx.translate(Math.cos(a) * 5, Math.sin(a) * 5 - 2);
    ctx.beginPath();
    ctx.ellipse(0, 0, 4, 6, a, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = '#fde68a';
  ctx.beginPath();
  ctx.arc(0, -2, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.arc(0, -2, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawAnimal(ctx: CanvasRenderingContext2D, x: number, y: number, type: number, t: number) {
  const walk = Math.sin(t * 4) * 6;
  const bob = Math.abs(Math.sin(t * 4)) * 2;
  ctx.save();
  ctx.translate(x + walk, y + bob);

  ctx.shadowColor = 'rgba(0,0,0,0.2)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;

  if (type === 0) {
    ctx.fillStyle = '#a16207';
    ctx.beginPath();
    ctx.ellipse(0, 2, 22, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ca8a04';
    ctx.beginPath();
    ctx.ellipse(0, 0, 20, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(14, -6, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(16, -7, 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 1) {
    ctx.fillStyle = '#4b5563';
    ctx.beginPath();
    ctx.ellipse(0, 2, 18, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6b7280';
    ctx.beginPath();
    ctx.ellipse(0, 0, 16, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9ca3af';
    ctx.beginPath();
    ctx.arc(12, -4, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#374151';
    ctx.beginPath();
    ctx.arc(14, -5, 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = '#57534e';
    ctx.beginPath();
    ctx.ellipse(0, 2, 14, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#78716c';
    ctx.beginPath();
    ctx.ellipse(0, 0, 12, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#a8a29e';
    ctx.beginPath();
    ctx.arc(10, -3, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.restore();
}

function drawCollectiblesWorld(
  ctx: CanvasRenderingContext2D,
  collectibles: any[],
  t: number,
  imgs: { treasure_chest: HTMLImageElement | null; coin_pile: HTMLImageElement | null; money_bills: HTMLImageElement | null },
  cam: CameraState,
  vpW: number,
  vpH: number,
) {
  const margin = 200;
  const viewLeft = cam.x - margin;
  const viewTop = cam.y - margin;
  const viewRight = cam.x + vpW / cam.zoom + margin;
  const viewBottom = cam.y + vpH / cam.zoom + margin;

  collectibles.forEach((c: any) => {
    if (c.x < viewLeft || c.x > viewRight || c.y < viewTop || c.y > viewBottom) return;

    const floatY = Math.sin(t * 2.5 + c.x * 0.005) * 12;
    ctx.save();
    ctx.translate(c.x, c.y + floatY);

    const ringR = 90 + Math.sin(t * 3 + c.y * 0.01) * 15;
    ctx.globalAlpha = 0.6 + 0.35 * Math.sin(t * 4);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(0, 0, ringR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(0, 0, 110, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    const type = c.type || 'money_bills';
    const value = c.value ?? (type === 'treasure_chest' ? 40 : type === 'coin_pile' ? 20 : 10);

    const drawImg = (img: HTMLImageElement | null, w: number, h: number): boolean => {
      if (img?.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        return true;
      }
      return false;
    };

    if (type === 'treasure_chest') {
      const w = 140, h = 100;
      if (!drawImg(imgs.treasure_chest, w, h)) {
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.strokeStyle = '#78350f';
        ctx.lineWidth = 6;
        ctx.strokeRect(-w / 2, -h / 2, w, h);
      }
      ctx.font = 'bold 36px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#000';
      ctx.fillText(`$${value}`, 2, h / 2 + 28);
      ctx.fillStyle = '#fde68a';
      ctx.fillText(`$${value}`, 0, h / 2 + 26);

    } else if (type === 'coin_pile') {
      const w = 120, h = 100;
      if (!drawImg(imgs.coin_pile, w, h)) {
        [{ x: -24, y: 14 }, { x: 24, y: 8 }, { x: 0, y: -20 }].forEach(p => {
          ctx.fillStyle = '#b45309';
          ctx.beginPath(); ctx.arc(p.x + 2, p.y + 2, 32, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath(); ctx.arc(p.x, p.y, 32, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#92400e';
          ctx.lineWidth = 5;
          ctx.beginPath(); ctx.arc(p.x, p.y, 32, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = '#92400e';
          ctx.font = 'bold 32px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('$', p.x, p.y);
        });
      }
      ctx.font = 'bold 36px sans-serif';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#000';
      ctx.fillText(`$${value}`, 2, 72);
      ctx.fillStyle = '#fde68a';
      ctx.fillText(`$${value}`, 0, 70);

    } else {
      const w = 120, h = 80;
      if (!drawImg(imgs.money_bills, w, h)) {
        for (let i = 2; i >= 0; i--) {
          const ox = i * 8 - 8, oy = i * -8 + 8;
          ctx.fillStyle = '#065f46';
          ctx.fillRect(-56 + ox + 2, -30 + oy + 2, 112, 60);
          ctx.fillStyle = '#4ade80';
          ctx.fillRect(-56 + ox, -30 + oy, 112, 60);
          ctx.strokeStyle = '#166534';
          ctx.lineWidth = 5;
          ctx.strokeRect(-56 + ox, -30 + oy, 112, 60);
        }
        ctx.fillStyle = '#14532d';
        ctx.font = 'bold 40px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('$', 0, 0);
      }
      ctx.font = 'bold 36px sans-serif';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#000';
      ctx.fillText(`$${value}`, 2, 64);
      ctx.fillStyle = '#bbf7d0';
      ctx.fillText(`$${value}`, 0, 62);
    }

    ctx.restore();
  });
}

function drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, isMe: boolean, t: number, name: string, colors: { main: string; dark: string; light: string }) {
  ctx.save();
  ctx.translate(x, y);

  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillText(name, 0, -80);
  ctx.fillText(name, 1, -79);
  ctx.fillText(name, -1, -79);
  ctx.fillStyle = colors.light;
  ctx.fillText(name, 0, -79);

  const runCycle = Math.sin(t * 8) * 0.05;
  ctx.rotate(runCycle);

  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(0, 52, 42, 18, 0, 0, Math.PI * 2);
  ctx.fill();

  const legSwing = Math.sin(t * 10) * 22;
  ctx.fillStyle = colors.main;
  ctx.fillRect(-20, 20, 16, 48);
  ctx.fillRect(4, 20 + legSwing * 0.3, 16, 48);
  ctx.strokeStyle = colors.dark;
  ctx.lineWidth = 2;
  ctx.strokeRect(-20, 20, 16, 48);
  ctx.strokeRect(4, 20 + legSwing * 0.3, 16, 48);

  const bodyGrad = ctx.createLinearGradient(-12, -18, 12, 18);
  bodyGrad.addColorStop(0, colors.light);
  bodyGrad.addColorStop(0.4, colors.main);
  bodyGrad.addColorStop(0.7, colors.main);
  bodyGrad.addColorStop(1, colors.dark);
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  roundRect(ctx, -30, -28, 60, 50, 10);
  ctx.fill();
  ctx.strokeStyle = colors.dark;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = colorAlpha('#0f172a', 0.5);
  ctx.fillRect(-22, -8, 20, 14);
  ctx.fillRect(2, -8, 20, 14);

  const armSwing = Math.sin(t * 10) * 18;
  ctx.strokeStyle = colors.light;
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-30, -12);
  ctx.lineTo(-48 - armSwing, 8);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(30, -12);
  ctx.lineTo(52 + armSwing * 0.7, -6);
  ctx.stroke();

  const skinGrad = ctx.createRadialGradient(-4, -48, 0, 0, -44, 28);
  skinGrad.addColorStop(0, '#fffbeb');
  skinGrad.addColorStop(0.5, '#fef3c7');
  skinGrad.addColorStop(0.8, '#fde68a');
  skinGrad.addColorStop(1, '#fcd34d');
  ctx.fillStyle = skinGrad;
  ctx.beginPath();
  ctx.arc(0, -44, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.ellipse(-8, -48, 5, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(8, -48, 5, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(-7, -49, 2, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(9, -49, 2, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#78716c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, -38, 6, 0.2 * Math.PI, 0.8 * Math.PI);
  ctx.stroke();

  if (isMe) {
    drawGlow(ctx, 0, -44, 55, colors.main, 0.4);
    ctx.strokeStyle = colors.main;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, -44, 26, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

const PLAYER_COLORS = [
  { main: '#f59e0b', dark: '#d97706', light: '#fde68a' },
  { main: '#3b82f6', dark: '#1e40af', light: '#93c5fd' },
  { main: '#22c55e', dark: '#16a34a', light: '#86efac' },
  { main: '#ef4444', dark: '#dc2626', light: '#fca5a5' },
  { main: '#a855f7', dark: '#7e22ce', light: '#c084fc' },
  { main: '#ec4899', dark: '#db2777', light: '#f9a8d4' },
  { main: '#06b6d4', dark: '#0891b2', light: '#67e8f9' },
  { main: '#f97316', dark: '#ea580c', light: '#fdba74' },
];

function drawPlayers(ctx: CanvasRenderingContext2D, players: Record<string, any>, playerId: string, myPos: { x: number; y: number }, t: number) {
  const list = Object.values(players || {}).sort((a: any, b: any) => (a.id || '').localeCompare(b.id || ''));
  list.forEach((p: any, idx: number) => {
    const px = p.id === playerId ? myPos.x : p.x;
    const py = p.id === playerId ? myPos.y : p.y;
    const colors = PLAYER_COLORS[idx % PLAYER_COLORS.length];
    drawPlayer(ctx, px, py, p.id === playerId, t, p.name || '?', colors);
  });
}
