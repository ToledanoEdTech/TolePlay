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
  emitBurst,
} from './renderUtils';
import type { CameraState } from '../../engine/types';

const WORLD_SIZE = 4000;
const PLAYER_SPEED = 280;
const MAP_CENTER = 2000;
const COLLECTIBLE_SCALE = 1.85; // 1.5x–2x more prominent
const COLLECTIBLE_ROTATION_SPEED = 0.6;
const COLLECTIBLE_FLOAT_AMPLITUDE = 10;
const COLLECTIBLE_FLOAT_SPEED = 2.5;
const PICKUP_RADIUS = 85; // match server

type FacingDir = 'down' | 'up' | 'left' | 'right';

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
  const lastDirRef = useRef<FacingDir>('down');
  const dustTrailRef = useRef<{ x: number; y: number; r: number; life: number; maxLife: number }[]>([]);
  const goldPulseRef = useRef(0);
  const energyPulseRef = useRef(0);

  // Optional sprite sheet support (future upgrade).
  // Expected asset format (recommended):
  // - Sprite sheet contains 4 rows in this order: down, left, right, up.
  // - Each row contains N frames (idle can be frame 0; walk cycle frames 0..N-1).
  // - Every frame is exactly FRAME_W x FRAME_H pixels.
  // - Character's "feet" should be around ANCHOR_Y (0..1) of the frame height.
  // Place your asset here (example):
  //   public/images/character/character_sheet.png
  // Then update the loader below to match your file name.
  const characterSheetRef = useRef<HTMLImageElement | null>(null);
  const characterSheetReadyRef = useRef(false);

  const CHAR_FRAME_W = 96;
  const CHAR_FRAME_H = 96;
  const CHAR_FRAMES_PER_DIR = 6;
  const CHAR_ANCHOR_X = 0.5;
  const CHAR_ANCHOR_Y = 0.86; // feet pivot

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

    // Replace with your real sheet:
    // e.g. loadCharacter('character/character_sheet.png')
    const loadCharacter = (name: string) => {
      const img = new Image();
      img.src = `${basePath}/images/${name}`;
      img.onload = () => { characterSheetRef.current = img; characterSheetReadyRef.current = true; };
      img.onerror = () => { characterSheetRef.current = null; characterSheetReadyRef.current = false; };
    };
    loadCharacter('character/character_sheet.png');
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
        const burst = emitBurst(prev.x, prev.y, 14, 110, 0.6, particleColor, 5, { friction: 0.92, scaleDown: true });
        particlesRef.current = [...particlesRef.current, ...burst];
        floatingTextsRef.current.push({
          x: prev.x,
          y: prev.y,
          text: `+$${value}`,
          life: 1,
          maxLife: 1,
          vy: 48,
          color: isGreen ? '#4ade80' : '#fde68a',
        });
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

      drawWorld(ctx, cam, vpW, vpH, t);
      drawCollectiblesWorld(ctx, collectibles, collectibleImgsRef.current, cam, vpW, vpH);
      drawPlayers(ctx, players, playerId, myPos, t, isMoving, vel, dir, characterSheetRef.current, characterSheetReadyRef.current, {
        frameW: CHAR_FRAME_W,
        frameH: CHAR_FRAME_H,
        framesPerDir: CHAR_FRAMES_PER_DIR,
        anchorX: CHAR_ANCHOR_X,
        anchorY: CHAR_ANCHOR_Y,
      });

      particlesRef.current = tickParticles(ctx, particlesRef.current);
      tickDustTrail(ctx, dustTrailRef.current, dt);
      tickFloatingTexts(ctx, floatingTextsRef.current, dt);
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

function drawWorld(ctx: CanvasRenderingContext2D, cam: CameraState, vpW: number, vpH: number, t: number) {
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
  const gridSize = 200;
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

  const now = Date.now();
  // Subtle "wind" sway: deterministic based on time + per-object seed.
  const windSkew = Math.sin(now / 900) * 0.06;
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 4;

  for (let gx = startX; gx < viewLeft + viewW + gridSize; gx += gridSize) {
    for (let gy = startY; gy < viewTop + viewH + gridSize; gy += gridSize) {
      const seed = gx * 7 + gy * 13;
      const r = seededRandom(seed);
      const rx = gx + r * gridSize * 0.8;
      const ry = gy + seededRandom(seed + 1) * gridSize * 0.8;
      if (r < 0.12) {
        ctx.save();
        ctx.translate(rx, ry);
        const sway = windSkew + Math.sin(t * 0.9 + seed) * 0.03 + seededRandom(seed + 2) * 0.02;
        ctx.rotate(sway);
        ctx.fillStyle = '#2d1a0a';
        ctx.fillRect(-8, 0, 16, 50);
        ctx.fillStyle = '#0d2818';
        ctx.beginPath();
        ctx.ellipse(0, -20, 28, 32, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#14532d';
        ctx.beginPath();
        ctx.ellipse(0, -28, 22, 26, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#166534';
        ctx.beginPath();
        ctx.ellipse(0, -32, 16, 20, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (r < 0.22) {
        ctx.save();
        ctx.translate(rx, ry);
        const sway = windSkew * 0.7 + Math.sin(t * 0.8 + seed * 1.3) * 0.03 + seededRandom(seed + 3) * 0.03;
        ctx.rotate(sway);
        ctx.fillStyle = '#0d2818';
        ctx.beginPath();
        ctx.ellipse(0, 2, 24, 20, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#14532d';
        ctx.beginPath();
        ctx.ellipse(0, -2, 18, 16, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#166534';
        ctx.beginPath();
        ctx.ellipse(0, -6, 12, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
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
  const now = Date.now();
  const hoverY = Math.sin(now / 200) * 6;

  const pulseScale = 1 + Math.sin(now / 300) * 0.08;

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
    ctx.scale(pulseScale, pulseScale);

    ctx.shadowColor = type === 'money_bills' ? '#22c55e' : '#fbbf24';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    if (type === 'treasure_chest') {
      const w = 56; const h = 40;
      if (imgs.treasure_chest?.complete && imgs.treasure_chest.naturalWidth > 0) {
        ctx.drawImage(imgs.treasure_chest, -w / 2, -h / 2, w, h);
      } else {
        const bg = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
        bg.addColorStop(0, '#fde68a');
        bg.addColorStop(0.5, '#fbbf24');
        bg.addColorStop(1, '#b45309');
        ctx.fillStyle = bg;
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.strokeStyle = '#78350f';
        ctx.lineWidth = 2;
        ctx.strokeRect(-w / 2, -h / 2, w, h);
        ctx.fillStyle = '#5c3317';
        ctx.fillRect(-8, -h / 2 + 8, 16, 14);
        ctx.strokeStyle = '#2d1a0a';
        ctx.strokeRect(-8, -h / 2 + 8, 16, 14);
        ctx.fillStyle = '#1a1a1a';
        ctx.beginPath();
        ctx.arc(0, -h / 2 + 15, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#000';
      ctx.fillText(`$${value}`, 2, h / 2 + 12);
      ctx.fillStyle = '#fde68a';
      ctx.fillText(`$${value}`, 0, h / 2 + 10);
    } else if (type === 'coin_pile') {
      const w = 48; const h = 40;
      if (imgs.coin_pile?.complete && imgs.coin_pile.naturalWidth > 0) {
        ctx.drawImage(imgs.coin_pile, -w / 2, -h / 2, w, h);
      } else {
        [{ x: -10, y: 6 }, { x: 10, y: 3 }, { x: 0, y: -8 }].forEach((p: { x: number; y: number }) => {
          ctx.fillStyle = '#b8860b';
          ctx.beginPath(); ctx.arc(p.x + 1, p.y + 1, 12, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#FFD700';
          ctx.beginPath(); ctx.arc(p.x, p.y, 12, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#92400e';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(p.x, p.y, 12, 0, Math.PI * 2); ctx.stroke();
        });
      }
      ctx.font = 'bold 14px sans-serif';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#000';
      ctx.fillText(`$${value}`, 2, 28);
      ctx.fillStyle = '#FFD700';
      ctx.fillText(`$${value}`, 0, 26);
    } else {
      const w = 48; const h = 32;
      if (imgs.money_bills?.complete && imgs.money_bills.naturalWidth > 0) {
        ctx.drawImage(imgs.money_bills, -w / 2, -h / 2, w, h);
      } else {
        for (let i = 2; i >= 0; i--) {
          const ox = i * 3 - 3; const oy = i * -3 + 3;
          ctx.fillStyle = '#065f46';
          ctx.fillRect(-22 + ox + 1, -12 + oy + 1, 44, 24);
          ctx.fillStyle = '#4ade80';
          ctx.fillRect(-22 + ox, -12 + oy, 44, 24);
          ctx.strokeStyle = '#166534';
          ctx.lineWidth = 2;
          ctx.strokeRect(-22 + ox, -12 + oy, 44, 24);
        }
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
  sheet: HTMLImageElement | null,
  sheetReady: boolean,
  sheetSpec: { frameW: number; frameH: number; framesPerDir: number; anchorX: number; anchorY: number }
) {
  const now = Date.now();
  const speed = Math.hypot(velocityX, velocityY);
  const moving = speed > 8;
  const runPhase = now / 120;
  const stride = moving ? Math.sin(runPhase) * 14 : 0;
  const strideAlt = moving ? Math.sin(runPhase + Math.PI) * 14 : 0;
  const armSwing = moving ? Math.sin(runPhase) * 22 : 0;
  const armSwingAlt = moving ? Math.sin(runPhase + Math.PI) * 22 : 0;
  const bob = moving ? Math.abs(Math.sin(runPhase * 2)) * 3 : 0;
  const breathScale = moving ? 1 : 1 + Math.sin(now / 500) * 0.02;
  const lean = moving ? Math.sin(runPhase) * 0.04 : 0;

  // IMPORTANT: Keep label + ground shadow screen-aligned.
  // Rotating them with the character makes it look like the body "crawls/smears" on the ground.
  ctx.save();
  ctx.translate(x, y);

  // label (not rotated)
  ctx.font = 'bold 17px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillText(name, 1, -92 - bob);
  ctx.fillStyle = colors.light;
  ctx.fillText(name, 0, -91 - bob);

  // ground shadow (not rotated)
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 58, 46, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // character body
  ctx.save();
  ctx.translate(0, -bob);

  // Sprite sheet path (preferred) — supports professional walk cycles.
  // If no sheet is available, fall back to procedural vector character.
  if (sheet && sheetReady && sheet.naturalWidth > 0 && sheet.naturalHeight > 0) {
    drawCharacterSprite(ctx, sheet, sheetSpec, dir, moving, speed, now);
    if (isMe) {
      drawGlow(ctx, 0, -52, 70, colors.main, 0.2);
    }
    ctx.restore(); // body
    ctx.restore(); // translate
    return;
  }

  const legGrad = ctx.createLinearGradient(0, 0, 0, 52);
  legGrad.addColorStop(0, colors.light);
  legGrad.addColorStop(0.5, colors.main);
  legGrad.addColorStop(0.85, colors.dark);
  legGrad.addColorStop(1, colorAlpha(colors.dark, 0.95));

  const legShadow = ctx.createLinearGradient(0, 0, 0, 52);
  legShadow.addColorStop(0, colorAlpha(colors.dark, 0.4));
  legShadow.addColorStop(0.6, colorAlpha(colors.dark, 0.15));
  legShadow.addColorStop(1, 'transparent');

  ctx.save();
  ctx.translate(-12, 26);
  ctx.translate(0, stride);
  ctx.fillStyle = legShadow;
  ctx.fillRect(-8, 2, 16, 50);
  ctx.fillStyle = legGrad;
  ctx.beginPath();
  roundRect(ctx, -8, 0, 16, 52, 4);
  ctx.fill();
  ctx.strokeStyle = colorAlpha(colors.dark, 0.85);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(12, 26);
  ctx.translate(0, strideAlt);
  ctx.fillStyle = legShadow;
  ctx.fillRect(-8, 2, 16, 50);
  ctx.fillStyle = legGrad;
  ctx.beginPath();
  roundRect(ctx, -8, 0, 16, 52, 4);
  ctx.fill();
  ctx.strokeStyle = colorAlpha(colors.dark, 0.85);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(0, -4);
  ctx.rotate(lean);
  ctx.scale(1, breathScale);
  ctx.translate(0, 4);
  const bodyGrad = ctx.createLinearGradient(-22, -32, 22, 28);
  bodyGrad.addColorStop(0, colors.light);
  bodyGrad.addColorStop(0.35, colors.main);
  bodyGrad.addColorStop(0.7, colors.dark);
  bodyGrad.addColorStop(1, colorAlpha(colors.dark, 0.95));
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  roundRect(ctx, -32, -34, 64, 56, 14);
  ctx.fill();
  ctx.strokeStyle = colorAlpha(colors.dark, 0.9);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  const armGrad = ctx.createLinearGradient(0, 0, 0, 40);
  armGrad.addColorStop(0, colors.light);
  armGrad.addColorStop(0.6, colors.main);
  armGrad.addColorStop(1, colors.dark);

  ctx.save();
  ctx.translate(-28, -14);
  ctx.rotate(armSwing * (Math.PI / 180));
  ctx.strokeStyle = armGrad;
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-18, 24);
  ctx.stroke();
  ctx.fillStyle = colorAlpha(colors.dark, 0.5);
  ctx.beginPath();
  ctx.arc(0, 0, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = colorAlpha(colors.dark, 0.8);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(28, -14);
  ctx.rotate(armSwingAlt * (Math.PI / 180));
  ctx.strokeStyle = armGrad;
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(18, 20);
  ctx.stroke();
  ctx.fillStyle = colorAlpha(colors.dark, 0.5);
  ctx.beginPath();
  ctx.arc(0, 0, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = colorAlpha(colors.dark, 0.8);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  const headY = -50;
  const skinGrad = ctx.createRadialGradient(-10, -12, 0, 0, 0, 32);
  skinGrad.addColorStop(0, '#fffef9');
  skinGrad.addColorStop(0.5, '#fef3c7');
  skinGrad.addColorStop(0.85, '#f59e0b');
  skinGrad.addColorStop(1, '#d97706');
  ctx.fillStyle = skinGrad;
  ctx.beginPath();
  ctx.arc(0, headY, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = colorAlpha('#b45309', 0.75);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.ellipse(-9, headY - 2, 5.5, 6.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(9, headY - 2, 5.5, 6.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  ctx.ellipse(-8, headY - 3, 2.2, 2.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(9.5, headY - 3, 2.2, 2.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#78716c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, headY + 7, 6.5, 0.2 * Math.PI, 0.8 * Math.PI);
  ctx.stroke();

  if (isMe) {
    drawGlow(ctx, 0, headY, 60, colors.main, 0.35);
    ctx.strokeStyle = colorAlpha(colors.main, 0.95);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, headY, 30, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore(); // body rotation
  ctx.restore(); // translate
}

function drawCharacterSprite(
  ctx: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  spec: { frameW: number; frameH: number; framesPerDir: number; anchorX: number; anchorY: number },
  dir: FacingDir,
  moving: boolean,
  speed: number,
  nowMs: number
) {
  const row = dir === 'down' ? 0 : dir === 'left' ? 1 : dir === 'right' ? 2 : 3;
  const fps = moving ? (8 + Math.min(8, speed / 80)) : 0;
  const frame = moving ? Math.floor((nowMs / 1000) * fps) % spec.framesPerDir : 0;

  const sx = frame * spec.frameW;
  const sy = row * spec.frameH;
  const dx = -spec.frameW * spec.anchorX;
  const dy = -spec.frameH * spec.anchorY;

  // For left direction, you may prefer a dedicated row OR a flip.
  // This implementation uses the left row. If your sheet has only right-facing frames,
  // you can flip when dir === 'left' by scaling(-1,1) and using the right row instead.
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(sheet, sx, sy, spec.frameW, spec.frameH, dx, dy, spec.frameW, spec.frameH);
}

function drawPlayers(
  ctx: CanvasRenderingContext2D,
  players: Record<string, any>,
  playerId: string,
  myPos: { x: number; y: number },
  t: number,
  isMoving: boolean,
  vel: { x: number; y: number },
  myDir: FacingDir,
  sheet: HTMLImageElement | null,
  sheetReady: boolean,
  sheetSpec: { frameW: number; frameH: number; framesPerDir: number; anchorX: number; anchorY: number }
) {
  const list = Object.values(players || {}).sort((a: any, b: any) => (a.id || '').localeCompare(b.id || ''));
  list.forEach((p: any, idx: number) => {
    const px = p.id === playerId ? myPos.x : p.x;
    const py = p.id === playerId ? myPos.y : p.y;
    const colors = PLAYER_COLORS[idx % PLAYER_COLORS.length];
    const vx = p.id === playerId ? vel.x : 0;
    const vy = p.id === playerId ? vel.y : 0;
    // Remote players: without velocity from server tick, show them idle facing down for now.
    // If you later stream velocity/dir from server, pass it here.
    const dir: FacingDir = p.id === playerId ? myDir : 'down';
    drawPlayer(ctx, px, py, p.id === playerId, p.name || '?', colors, vx, vy, dir, sheet, sheetReady, sheetSpec);
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
  dt: number
) {
  for (let i = list.length - 1; i >= 0; i--) {
    const ft = list[i];
    ft.life -= dt;
    ft.y -= ft.vy * dt;
    if (ft.life <= 0) {
      list.splice(i, 1);
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

