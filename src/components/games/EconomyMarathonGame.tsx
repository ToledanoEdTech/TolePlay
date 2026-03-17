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
  tickParticlesInPlace, tickShake, triggerShake,
  createDust, drawDust, drawGlow, colorAlpha, roundRect,
} from './renderUtils';
import { ProceduralPlayer, type FacingDir } from './ProceduralPlayer';
import type { CameraState } from '../../engine/types';

const WORLD_SIZE = 4000;
const PLAYER_SPEED = 280;
const MAP_CENTER = 2000;
const COLLECTIBLE_SCALE = 1.85; // 1.5x–2x more prominent
const COLLECTIBLE_ROTATION_SPEED = 0.6;
const COLLECTIBLE_FLOAT_AMPLITUDE = 10;
const COLLECTIBLE_FLOAT_SPEED = 2.5;
const PICKUP_RADIUS = 85; // match server
const ENV_GRID = 200;

type EnvType = 'tree' | 'bush' | 'rock';
type EnvObj = { x: number; y: number; type: EnvType; seed: number; variant: number };
type CachedSprite = { canvas: HTMLCanvasElement | OffscreenCanvas; w: number; h: number };

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
  // Target (authoritative local) position. We move this immediately from input and send it to server.
  const posRef = useRef({
    x: player?.x ?? MAP_CENTER,
    y: player?.y ?? MAP_CENTER,
  });
  // Render position is smoothed towards target to avoid snapping/jitter.
  const renderPosRef = useRef({
    x: player?.x ?? MAP_CENTER,
    y: player?.y ?? MAP_CENTER,
  });
  const inputRef = useRef(createInputState());
  const cameraRef = useRef<CameraState>(createCamera());
  const camInitRef = useRef(false);
  const lastSyncRef = useRef(0);
  const lastMoveTimeRef = useRef(0);
  const prevPosRef = useRef({ x: MAP_CENTER, y: MAP_CENTER });
  const particlesRef = useRef<Particle[]>([]);
  const particlePoolRef = useRef<Particle[]>([]);
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
  const prevCollectiblesRef = useRef<{ id: string; x: number; y: number; type: string; value: number }[]>([]);
  const floatingTextsRef = useRef<{ x: number; y: number; text: string; life: number; maxLife: number; vy: number; color: string }[]>([]);
  const floatingTextPoolRef = useRef<{ x: number; y: number; text: string; life: number; maxLife: number; vy: number; color: string }[]>([]);
  const lastDirRef = useRef<FacingDir>('down');
  const dustTrailRef = useRef<{ x: number; y: number; r: number; life: number; maxLife: number }[]>([]);
  const goldPulseRef = useRef(0);
  const energyPulseRef = useRef(0);

  // Per-player procedural animators (stateful for smooth transitions).
  const animatorsRef = useRef<Map<string, ProceduralPlayer>>(new Map());
  // Track previous positions for all players so we can derive velocity (server does not send it).
  const prevWorldPosRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const envRef = useRef<EnvObj[]>([]);
  const spriteCacheRef = useRef<Map<string, CachedSprite>>(new Map());

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

  // Build deterministic environment list once (cheap: 20x20 grid).
  useEffect(() => {
    if (envRef.current.length) return;
    const out: EnvObj[] = [];
    for (let gx = 0; gx <= WORLD_SIZE; gx += ENV_GRID) {
      for (let gy = 0; gy <= WORLD_SIZE; gy += ENV_GRID) {
        const seed = gx * 7 + gy * 13;
        const r = seededRandom(seed);
        const rx = gx + r * ENV_GRID * 0.8;
        const ry = gy + seededRandom(seed + 1) * ENV_GRID * 0.8;
        // Match old distribution (slightly fuller). Use small number of variants for caching.
        if (r < 0.15) out.push({ x: rx, y: ry, type: 'tree', seed, variant: Math.floor(seededRandom(seed + 99) * 6) });
        else if (r < 0.27) out.push({ x: rx, y: ry, type: 'bush', seed, variant: Math.floor(seededRandom(seed + 77) * 6) });
        else if (r < 0.31) out.push({ x: rx, y: ry, type: 'rock', seed, variant: Math.floor(seededRandom(seed + 55) * 4) });
      }
    }
    envRef.current = out;
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
      goldPulseRef.current = (goldPulseRef.current + 1) | 0;
    }
    prevGoldRef.current = newGold;
  }, [player?.resources]);
  useEffect(() => {
    // Pulse on energy changes (server or local replenish).
    energyPulseRef.current = (energyPulseRef.current + 1) | 0;
  }, [player?.modeState?.energy]);

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
      let dt = Math.min((now - lastTime) / 1000, 0.05);
      if (dt <= 0) dt = 1 / 60;
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

      // Smooth rendering (lerp) towards target position.
      // Performance note: constant-time per frame, avoids per-pixel physics and keeps multiplayer smooth.
      const target = posRef.current;
      const rp = renderPosRef.current;
      // Convert "smoothing" into framerate-independent factor.
      const follow = 1 - Math.pow(0.001, dt); // ~0.1 at 60fps; converges quickly without snapping
      rp.x = rp.x + (target.x - rp.x) * follow;
      rp.y = rp.y + (target.y - rp.y) * follow;

      if (!camInitRef.current) {
        cam.x = renderPosRef.current.x - vpW / (2 * zoom);
        cam.y = renderPosRef.current.y - vpH / (2 * zoom);
        cam.zoom = zoom;
        camInitRef.current = true;
      }
      cam.zoom = zoom;
      updateCamera(cam, renderPosRef.current, vpW, vpH, WORLD_SIZE, WORLD_SIZE, 0.12);

      const shake = tickShake(shakeRef.current);

      const collectibles = gs?.collectibles || [];
      const prevCollectibles = prevCollectiblesRef.current;
      const myX = renderPosRef.current.x;
      const myY = renderPosRef.current.y;
      prevCollectibles.forEach((prev: { id: string; x: number; y: number; type: string; value: number }) => {
        const stillExists = collectibles.some((c: any) => (c.id && c.id === prev.id) || (Math.hypot(c.x - prev.x, c.y - prev.y) < 5));
        if (stillExists) return;
        const dist = Math.hypot(myX - prev.x, myY - prev.y);
        if (dist > PICKUP_RADIUS) return;
        const value = prev.value ?? (prev.type === 'treasure_chest' ? 40 : prev.type === 'coin_pile' ? 20 : 10);
        const isGreen = prev.type === 'money_bills';
        const particleColor = isGreen ? '#4ade80' : '#fbbf24';
        spawnBurstPooled(particlesRef.current, particlePoolRef.current, prev.x, prev.y, 14, 110, 0.6, particleColor, 5, {
          friction: 0.92,
          scaleDown: true,
          gravity: 0.02,
        });
        const ftPool = floatingTextPoolRef.current;
        const ft = ftPool.length ? ftPool.pop()! : { x: 0, y: 0, text: '', life: 0, maxLife: 0, vy: 0, color: '' };
        ft.x = prev.x;
        ft.y = prev.y;
        ft.text = `+$${value}`;
        ft.life = 1;
        ft.maxLife = 1;
        ft.vy = 48;
        ft.color = isGreen ? '#4ade80' : '#fde68a';
        floatingTextsRef.current.push(ft);
      });
      prevCollectiblesRef.current = collectibles.map((c: any) => ({
        id: c.id || `${c.x}-${c.y}`,
        x: c.x,
        y: c.y,
        type: c.type || 'money_bills',
        value: c.value ?? 10,
      }));

      const myPos = renderPosRef.current;
      const vel = {
        x: (myPos.x - prevPosRef.current.x) / dt,
        y: (myPos.y - prevPosRef.current.y) / dt,
      };
      const isMoving = Math.hypot(vel.x, vel.y) > 20;
      const speed = Math.hypot(vel.x, vel.y);
      // Direction-based facing (no slow rotation/spinning).
      let dir: FacingDir = lastDirRef.current;
      if (speed > 10) {
        if (Math.abs(vel.x) > Math.abs(vel.y)) dir = vel.x >= 0 ? 'right' : 'left';
        else dir = vel.y >= 0 ? 'down' : 'up';
        lastDirRef.current = dir;
      }

      if (isMoving && Math.random() < 0.5) {
        // Foot position for dust trail: behind movement direction.
        const backX = dir === 'right' ? -1 : dir === 'left' ? 1 : 0;
        const backY = dir === 'down' ? -1 : dir === 'up' ? 1 : 0;
        const fx = myPos.x + backX * 42;
        const fy = myPos.y + backY * 42;
        dustTrailRef.current.push({
          x: fx + (Math.random() - 0.5) * 20,
          y: fy + (Math.random() - 0.5) * 10,
          r: 3 + Math.random() * 4,
          life: 0.3 + Math.random() * 0.2,
          maxLife: 0.3 + Math.random() * 0.2,
        });
      }

      ctx.fillStyle = '#050a0f';
      ctx.fillRect(0, 0, vpW, vpH);
      ctx.save();
      ctx.translate(shake.x, shake.y);
      ctx.save();
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);

      drawWorld(ctx, cam, vpW, vpH, t, envRef.current, spriteCacheRef.current);
      drawCollectiblesWorld(ctx, collectibles, collectibleImgsRef.current, cam, vpW, vpH);
      drawPlayers(ctx, players, playerId, myPos, dt, vel, dir, animatorsRef.current, prevWorldPosRef.current, cam, vpW, vpH);

      tickParticlesInPlace(ctx, particlesRef.current, dt);
      // Return dead particles to pool to keep memory flat.
      // (tickParticlesInPlace compacts; we pool via explicit recycle in spawn only.)
      tickDustTrail(ctx, dustTrailRef.current, dt);
      tickFloatingTexts(ctx, floatingTextsRef.current, floatingTextPoolRef.current, dt);
      ctx.restore();
      drawDust(ctx, dustRef.current, vpW, vpH, '#fbbf24');
      ctx.restore();
      prevPosRef.current = { x: myPos.x, y: myPos.y };

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
            <div>
              <span className="text-base font-bold text-amber-400">מרתון כלכלי</span>
              <p className="text-xs text-amber-300/80 mt-0.5">מי שאוסף הכי הרבה זהב מנצח!</p>
            </div>
            <motion.div
              key={`gold-${goldPulseRef.current}`}
              initial={{ scale: 1 }}
              animate={{ scale: [1, 1.12, 1] }}
              transition={{ duration: 0.35 }}
              className="bg-amber-900/70 px-4 py-1.5 rounded-lg border border-amber-600/50"
            >
              <span className="text-xl font-black text-amber-300">💰 {gold.toLocaleString()}</span>
            </motion.div>
            <motion.div
              key={`energy-${energyPulseRef.current}`}
              initial={{ scale: 1 }}
              animate={{ scale: [1, 1.08, 1] }}
              transition={{ duration: 0.35 }}
              className="bg-yellow-900/50 px-3 py-1.5 rounded border border-yellow-600/40"
            >
              <span className="text-base font-bold text-yellow-300">⚡ {energy}</span>
            </motion.div>
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

function makeOffscreenCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  // OffscreenCanvas is faster when available; fallback keeps compatibility.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyGlobal: any = globalThis as any;
  if (typeof anyGlobal.OffscreenCanvas === 'function') return new anyGlobal.OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function getSprite(cache: Map<string, CachedSprite>, key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): CachedSprite {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = makeOffscreenCanvas(w, h);
  // OffscreenCanvas getContext signature differs slightly.
  const ctx = (canvas as any).getContext('2d') as CanvasRenderingContext2D | null;
  if (ctx) draw(ctx);
  const spr = { canvas, w, h };
  cache.set(key, spr);
  return spr;
}

function spawnBurstPooled(
  out: Particle[],
  pool: Particle[],
  x: number,
  y: number,
  count: number,
  speed: number,
  life: number,
  color: string,
  size: number,
  opts?: Partial<Pick<Particle, 'gravity' | 'friction' | 'type' | 'scaleDown'>>
) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.4 + Math.random() * 0.6);
    const l = life * (0.6 + Math.random() * 0.4);
    const sz = size * (0.5 + Math.random() * 0.5);
    const p = pool.length ? pool.pop()! : ({
      x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, color: '', size: 1, gravity: 0, friction: 1, type: 'circle',
    } as Particle);
    p.x = x; p.y = y;
    p.vx = Math.cos(a) * s;
    p.vy = Math.sin(a) * s;
    p.life = l; p.maxLife = l;
    p.color = color;
    p.size = sz;
    p.gravity = opts?.gravity ?? 0;
    p.friction = opts?.friction ?? 1;
    p.type = opts?.type ?? 'circle';
    p.scaleDown = opts?.scaleDown;
    out.push(p);
  }
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

function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function drawWorld(
  ctx: CanvasRenderingContext2D,
  cam: CameraState,
  vpW: number,
  vpH: number,
  t: number,
  env: EnvObj[],
  spriteCache: Map<string, CachedSprite>
) {
  const viewLeft = cam.x - 100;
  const viewTop = cam.y - 100;
  const viewW = vpW / cam.zoom + 200;
  const viewH = vpH / cam.zoom + 200;

  // Parallax distant layer (soft hills). Moves slower than the camera to add depth.
  drawParallaxHills(ctx, cam, viewLeft, viewTop, viewW, viewH, t);

  const g = ctx.createLinearGradient(viewLeft, viewTop, viewLeft + viewW, viewTop + viewH);
  g.addColorStop(0, '#0d2818');
  g.addColorStop(0.5, '#166534');
  g.addColorStop(1, '#22c55e');
  ctx.fillStyle = g;
  ctx.fillRect(viewLeft, viewTop, viewW, viewH);
  ctx.strokeStyle = colorAlpha('#22c55e', 0.06);
  ctx.lineWidth = 1;
  const gridSize = ENV_GRID;
  const startX = Math.floor(viewLeft / gridSize) * gridSize;
  const startY = Math.floor(viewTop / gridSize) * gridSize;
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

  // Cached environment (trees/bushes/rocks): cull + stamp sprites.
  drawEnvironmentCached(ctx, cam, viewLeft, viewTop, viewW, viewH, t, env, spriteCache);
}

// NOTE: Trees/bushes/rocks are now intended to be rendered from cached sprites (OffscreenCanvas)
// for performance. The sprite-drawing helpers live below.

function drawEnvironmentCached(
  ctx: CanvasRenderingContext2D,
  cam: CameraState,
  viewLeft: number,
  viewTop: number,
  viewW: number,
  viewH: number,
  t: number,
  env: EnvObj[],
  spriteCache: Map<string, CachedSprite>
) {
  const margin = 220;
  const left = viewLeft - margin;
  const top = viewTop - margin;
  const right = viewLeft + viewW + margin;
  const bottom = viewTop + viewH + margin;

  const wind = Math.sin(t * 0.35) * 0.03;

  for (let i = 0; i < env.length; i++) {
    const o = env[i];
    if (o.x < left || o.x > right || o.y < top || o.y > bottom) continue;

    if (o.type === 'tree') {
      const scale = 1.28;
      const sway = wind + Math.sin(t * 0.55 + o.seed) * 0.02;
      const spr = getSprite(spriteCache, `tree:${o.variant}`, 220, 260, (c) => drawTreeSprite(c, o.variant));
      drawGroundEllipseShadow(ctx, o.x, o.y + 70 * scale, 40 * scale, 14 * scale, 0.18);
      ctx.save();
      ctx.translate(o.x, o.y);
      ctx.rotate(sway);
      ctx.scale(scale, scale);
      ctx.drawImage(spr.canvas as any, -spr.w / 2, -spr.h, spr.w, spr.h);
      ctx.restore();
    } else if (o.type === 'bush') {
      const scale = 1.38;
      const sway = wind * 0.6 + Math.sin(t * 0.5 + o.seed * 1.3) * 0.018;
      const spr = getSprite(spriteCache, `bush:${o.variant}`, 200, 170, (c) => drawBushSprite(c, o.variant));
      drawGroundEllipseShadow(ctx, o.x, o.y + 34 * scale, 42 * scale, 14 * scale, 0.18);
      ctx.save();
      ctx.translate(o.x, o.y);
      ctx.rotate(sway);
      ctx.scale(scale, scale);
      ctx.drawImage(spr.canvas as any, -spr.w / 2, -spr.h, spr.w, spr.h);
      ctx.restore();
    } else {
      const scale = 1.1;
      const rot = (seededRandom(o.seed + 6) * 0.6 - 0.3);
      const spr = getSprite(spriteCache, `rock:${o.variant}`, 130, 95, (c) => drawRockSprite(c, o.variant));
      drawGroundEllipseShadow(ctx, o.x, o.y + 18 * scale, 30 * scale, 14 * scale, 0.14);
      ctx.save();
      ctx.translate(o.x, o.y);
      ctx.rotate(rot);
      ctx.scale(scale, scale);
      ctx.globalAlpha = 0.95;
      ctx.drawImage(spr.canvas as any, -spr.w / 2, -spr.h / 2, spr.w, spr.h);
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }
}

function drawGroundEllipseShadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(0,0,0,1)';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTreeSprite(ctx: CanvasRenderingContext2D, variant: number) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.save();
  // Anchor: bottom-center of sprite
  ctx.translate(ctx.canvas.width / 2, ctx.canvas.height - 10);
  const seed = 1000 + variant * 777;
  const trunkH = 64;
  const trunkWBottom = 22;
  const trunkWTop = 14;
  const trunkGrad = ctx.createLinearGradient(-trunkWBottom / 2, 0, trunkWBottom / 2, 0);
  trunkGrad.addColorStop(0, '#2d1a0a');
  trunkGrad.addColorStop(0.55, '#3a210d');
  trunkGrad.addColorStop(1, '#5a3417');
  ctx.fillStyle = trunkGrad;
  ctx.beginPath();
  ctx.moveTo(-trunkWBottom / 2, 0);
  ctx.lineTo(-trunkWTop / 2, -trunkH);
  ctx.lineTo(trunkWTop / 2, -trunkH);
  ctx.lineTo(trunkWBottom / 2, 0);
  ctx.closePath();
  ctx.fill();

  const baseY = -trunkH;
  const blobs = 9;
  for (let i = 0; i < blobs; i++) {
    const rr = seededRandom(seed + i * 17);
    const rr2 = seededRandom(seed + i * 17 + 9);
    const ox = (rr - 0.5) * 64;
    const oy = baseY + (rr2 - 0.5) * 42 - 18;
    const r = (18 + rr * 18);
    const shade = rr2;
    const col = shade < 0.45 ? '#0d2818' : shade < 0.7 ? '#14532d' : '#22c55e';
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(ox, oy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#bbf7d0';
  ctx.beginPath();
  ctx.ellipse(-14, baseY - 44, 26, 18, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawBushSprite(ctx: CanvasRenderingContext2D, variant: number) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.save();
  ctx.translate(ctx.canvas.width / 2, ctx.canvas.height - 10);
  const seed = 2000 + variant * 631;
  const blobs = 11;
  for (let i = 0; i < blobs; i++) {
    const rr = seededRandom(seed + i * 13);
    const rr2 = seededRandom(seed + i * 13 + 5);
    const ox = (rr - 0.5) * 70;
    const oy = (rr2 - 0.5) * 36 - 8;
    const r = (14 + rr * 16);
    const col = (oy > 0) ? '#0d2818' : (oy > -18) ? '#14532d' : '#22c55e';
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(ox, oy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = '#bbf7d0';
  ctx.beginPath();
  ctx.ellipse(-18, -26, 24, 16, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawRockSprite(ctx: CanvasRenderingContext2D, variant: number) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.save();
  ctx.translate(ctx.canvas.width / 2, ctx.canvas.height / 2);
  const seed = 3000 + variant * 911;
  const s = 0.9 + seededRandom(seed + 5) * 0.9;
  const rock = ctx.createRadialGradient(-10, 2, 2, 0, 0, 22 * s);
  rock.addColorStop(0, '#cbd5e1');
  rock.addColorStop(0.5, '#94a3b8');
  rock.addColorStop(1, '#334155');
  ctx.fillStyle = rock;
  ctx.beginPath();
  ctx.ellipse(0, 0, 22 * s, 16 * s, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawParallaxHills(
  ctx: CanvasRenderingContext2D,
  cam: CameraState,
  viewLeft: number,
  viewTop: number,
  viewW: number,
  viewH: number,
  t: number
) {
  // Screen-space-ish parallax: offset is a small fraction of cam position.
  // This keeps it cheap (no extra culling passes) and stable visually.
  const px = cam.x * 0.25;
  const py = cam.y * 0.15;
  const baseY = viewTop + viewH * 0.35 + Math.sin(t * 0.15) * 10;
  ctx.save();
  ctx.globalAlpha = 0.35;
  const grad = ctx.createLinearGradient(viewLeft, baseY - 140, viewLeft, baseY + 220);
  grad.addColorStop(0, 'rgba(3,7,18,0.0)');
  grad.addColorStop(0.4, 'rgba(3,7,18,0.25)');
  grad.addColorStop(1, 'rgba(3,7,18,0.55)');
  ctx.fillStyle = grad;
  ctx.fillRect(viewLeft, viewTop, viewW, viewH);

  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#052e16';
  ctx.beginPath();
  const step = 140;
  for (let x = viewLeft - step; x <= viewLeft + viewW + step; x += step) {
    const y = baseY + Math.sin((x + px) * 0.003 + 0.7) * 55 + Math.cos((x + px) * 0.0017) * 25 + py;
    if (x === viewLeft - step) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineTo(viewLeft + viewW + step, viewTop + viewH + 220);
  ctx.lineTo(viewLeft - step, viewTop + viewH + 220);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawCollectiblesWorld(
  ctx: CanvasRenderingContext2D,
  collectibles: any[],
  imgs: { treasure_chest: HTMLImageElement | null; coin_pile: HTMLImageElement | null; money_bills: HTMLImageElement | null },
  cam: CameraState,
  vpW: number,
  vpH: number
) {
  const margin = 200;
  const viewLeft = cam.x - margin;
  const viewTop = cam.y - margin;
  const viewRight = cam.x + vpW / cam.zoom + margin;
  const viewBottom = cam.y + vpH / cam.zoom + margin;
  const now = performance.now();
  const hoverY = Math.sin(now * 0.004) * 7;
  const pulseScale = 1 + Math.sin(now * 0.006) * 0.09;
  const itemScale = 1.42; // baseline up-scale

  collectibles.forEach((c: any) => {
    if (c.x < viewLeft || c.x > viewRight || c.y < viewTop || c.y > viewBottom) return;
    // Normalize type defensively (fixes invisible chests if server/client type varies by case/dash).
    const rawType = (c.type || 'money_bills');
    const norm = String(rawType).trim().toLowerCase().replace(/-/g, '_');
    const type =
      norm === 'chest' || norm === 'treasure' || norm === 'treasurechest' || norm === 'treasure_chest'
        ? 'treasure_chest'
        : norm === 'coin' || norm === 'coins' || norm === 'coin_pile'
          ? 'coin_pile'
          : norm === 'bills' || norm === 'money' || norm === 'money_bills'
            ? 'money_bills'
            : norm;
    const value = c.value ?? (type === 'treasure_chest' ? 40 : type === 'coin_pile' ? 20 : 10);

    ctx.save();
    ctx.translate(c.x, c.y + hoverY);
    // Type-specific scaling impact:
    // - Chest: +20–30% more than baseline
    // - Coins/Bills: +15% more than baseline
    const typeScale = type === 'treasure_chest' ? 1.25 : 1.15;
    ctx.scale(pulseScale * itemScale * typeScale, pulseScale * itemScale * typeScale);

    // Ground drop shadow under item (depth)
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(0, 26, 20, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // No shadowBlur (performance). Use cheap radial-glow instead.
    const glow = type === 'money_bills' ? '#22c55e' : '#fbbf24';
    drawGlow(ctx, 0, 0, type === 'treasure_chest' ? 44 : 34, glow, type === 'treasure_chest' ? 0.22 : 0.14);

    // Constraint: Canvas-only (no external images). Always render procedurally.
    if (type === 'treasure_chest') {
      const w = 56; const h = 40;

      // Extra aura layer for the most valuable item (still cheap: gradients).
      drawGlow(ctx, 0, -6, 58, '#fbbf24', 0.18);

      const bg = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
      bg.addColorStop(0, '#fde68a');
      bg.addColorStop(0.45, '#fbbf24');
      bg.addColorStop(1, '#b45309');
      ctx.fillStyle = bg;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 2;
      ctx.strokeRect(-w / 2, -h / 2, w, h);

      // Lid line
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h / 2 + 12);
      ctx.lineTo(w / 2, -h / 2 + 12);
      ctx.stroke();

      // Wooden slats
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = '#2d1a0a';
      for (let i = -2; i <= 2; i++) {
        ctx.fillRect(i * 10 - 2, -h / 2, 4, h);
      }
      ctx.globalAlpha = 1;

      // Golden lock (new detail)
      ctx.save();
      ctx.translate(0, -h / 2 + 18);
      const lock = ctx.createRadialGradient(-3, -3, 1, 0, 0, 10);
      lock.addColorStop(0, '#fff7cc');
      lock.addColorStop(0.5, '#fde047');
      lock.addColorStop(1, '#b45309');
      ctx.fillStyle = lock;
      ctx.beginPath();
      roundRect(ctx, -8, -6, 16, 18, 4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.stroke();
      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.arc(0, 6, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#000';
      ctx.fillText(`$${value}`, 2, h / 2 + 12);
      ctx.fillStyle = '#fde68a';
      ctx.fillText(`$${value}`, 0, h / 2 + 10);
    } else if (type === 'coin_pile') {
      const w = 48; const h = 40;
      // Metallic coin look (radial gradients + highlight)
      const coins = [{ x: -10, y: 6 }, { x: 10, y: 3 }, { x: 0, y: -8 }];
      for (const p of coins) {
        const rg = ctx.createRadialGradient(p.x - 5, p.y - 6, 2, p.x, p.y, 13);
        rg.addColorStop(0, '#fff7cc');
        rg.addColorStop(0.35, '#fde047');
        rg.addColorStop(0.7, '#f59e0b');
        rg.addColorStop(1, '#92400e');
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(p.x, p.y, 12.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, 12.5, 0, Math.PI * 2); ctx.stroke();

        ctx.globalAlpha = 0.32;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(p.x - 4, p.y - 5, 5, 3.2, -0.6, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.font = 'bold 14px sans-serif';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#000';
      ctx.fillText(`$${value}`, 2, 28);
      ctx.fillStyle = '#FFD700';
      ctx.fillText(`$${value}`, 0, 26);
    } else {
      const w = 48; const h = 32;
      for (let i = 2; i >= 0; i--) {
        const ox = i * 3 - 3; const oy = i * -3 + 3;
        ctx.fillStyle = '#065f46';
        ctx.fillRect(-22 + ox + 1, -12 + oy + 1, 44, 24);
        const billG = ctx.createLinearGradient(-22 + ox, -12 + oy, 22 + ox, 12 + oy);
        billG.addColorStop(0, '#bbf7d0');
        billG.addColorStop(0.25, '#4ade80');
        billG.addColorStop(1, '#166534');
        ctx.fillStyle = billG;
        ctx.fillRect(-22 + ox, -12 + oy, 44, 24);
        ctx.strokeStyle = '#166534';
        ctx.lineWidth = 2;
        ctx.strokeRect(-22 + ox, -12 + oy, 44, 24);
      }
      ctx.font = 'bold 14px sans-serif';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#000';
      ctx.fillText(`$${value}`, 2, 26);
      ctx.fillStyle = '#bbf7d0';
      ctx.fillText(`$${value}`, 0, 24);
    }

    ctx.shadowBlur = 0;
    ctx.restore();
  });
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  isMe: boolean,
  name: string,
  colors: { main: string; dark: string; light: string },
  velocityX: number,
  velocityY: number,
  dir: FacingDir,
  animator: ProceduralPlayer,
  dt: number
) {
  // Procedural premium character (no external assets).
  // We force animator direction to match game-facing logic and update with velocity.
  animator.state.dir = dir;
  animator.update(dt, velocityX, velocityY);
  animator.draw(ctx, x, y, { isMe, name, colors });
}

function drawPlayers(
  ctx: CanvasRenderingContext2D,
  players: Record<string, any>,
  playerId: string,
  myPos: { x: number; y: number },
  dt: number,
  vel: { x: number; y: number },
  myDir: FacingDir,
  animators: Map<string, ProceduralPlayer>,
  prevWorldPos: Map<string, { x: number; y: number }>,
  cam: CameraState,
  vpW: number,
  vpH: number
) {
  const list = Object.values(players || {}).sort((a: any, b: any) => (a.id || '').localeCompare(b.id || ''));
  const now = performance.now();
  const maxDt = Math.max(1 / 120, Math.min(1 / 15, dt));
  // Viewport culling: skip players outside view + buffer.
  const margin = 220;
  const left = cam.x - margin;
  const top = cam.y - margin;
  const right = cam.x + vpW / cam.zoom + margin;
  const bottom = cam.y + vpH / cam.zoom + margin;
  list.forEach((p: any, idx: number) => {
    if (!p?.id) return;
    const px = p.id === playerId ? myPos.x : p.x;
    const py = p.id === playerId ? myPos.y : p.y;
    if (px < left || px > right || py < top || py > bottom) return;
    const colors = PLAYER_COLORS[idx % PLAYER_COLORS.length];

    // Derive velocity from last known positions for remote players (cheap + good enough).
    const prev = prevWorldPos.get(p.id);
    let vx = 0, vy = 0;
    if (p.id === playerId) {
      vx = vel.x; vy = vel.y;
    } else if (prev) {
      vx = (px - prev.x) / maxDt;
      vy = (py - prev.y) / maxDt;
    }
    prevWorldPos.set(p.id, { x: px, y: py });

    // Determine direction for remote players too (based on derived velocity).
    let dir: FacingDir = p.id === playerId ? myDir : 'down';
    if (p.id !== playerId && Math.hypot(vx, vy) > 10) {
      if (Math.abs(vx) > Math.abs(vy)) dir = vx >= 0 ? 'right' : 'left';
      else dir = vy >= 0 ? 'down' : 'up';
    }

    let animator = animators.get(p.id);
    if (!animator) {
      animator = new ProceduralPlayer();
      animators.set(p.id, animator);
      // Seed phase variation so players don't sync perfectly.
      animator.state.phase = (now * 0.001 + idx * 0.7) * Math.PI * 2;
      animator.state.dir = dir;
    }

    drawPlayer(ctx, px, py, p.id === playerId, p.name || '?', colors, vx, vy, dir, animator, maxDt);
  });
}

function tickDustTrail(
  ctx: CanvasRenderingContext2D,
  list: { x: number; y: number; r: number; life: number; maxLife: number }[],
  dt: number
) {
  for (let i = list.length - 1; i >= 0; i--) {
    const d = list[i];
    d.life -= dt;
    if (d.life <= 0) {
      list.splice(i, 1);
      continue;
    }
    const t = 1 - d.life / d.maxLife;
    const alpha = d.life / d.maxLife;
    const r = d.r * (1 + t * 0.8);
    ctx.save();
    ctx.globalAlpha = alpha * 0.6;
    ctx.fillStyle = t > 0.5 ? '#e5e7eb' : '#f3f4f6';
    ctx.beginPath();
    ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function tickFloatingTexts(
  ctx: CanvasRenderingContext2D,
  list: { x: number; y: number; text: string; life: number; maxLife: number; vy: number; color: string }[],
  pool: { x: number; y: number; text: string; life: number; maxLife: number; vy: number; color: string }[],
  dt: number
) {
  // In-place update + swap-remove + pooling (no splice -> less GC).
  for (let i = list.length - 1; i >= 0; i--) {
    const ft = list[i];
    ft.life -= dt;
    ft.y -= ft.vy * dt;
    if (ft.life <= 0) {
      const dead = list[i];
      list[i] = list[list.length - 1];
      list.pop();
      pool.push(dead);
      continue;
    }
    const alpha = Math.max(0, ft.life / ft.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText(ft.text, ft.x + 2, ft.y + 2);
    ctx.fillStyle = ft.color || '#fde68a';
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.restore();
  }
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

