import { useState, useEffect, useRef, useCallback, type ReactNode, type MouseEvent as RMouseEvent, type TouchEvent as RTouchEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QuestionPanel } from '../QuestionPanel';
import { Wrench, Heart, Crosshair, ShoppingCart, HelpCircle, Zap } from 'lucide-react';
import { socket } from '../../socket';
import { createInputState, getMoveDirection, setupKeyboardListeners } from '../../engine/input';
import { createCamera, updateCamera } from '../../engine/camera';
import { VirtualJoystick } from '../../engine/VirtualJoystick';
import {
  type Particle, type DustMote, type ShakeState,
  emitBurst, tickParticles,
  triggerShake, tickShake,
  createDust, drawDust,
  drawBeam, drawHPBar, drawGlow, colorAlpha, roundRect,
} from './renderUtils';
import type { CameraState } from '../../engine/types';

const WORLD_SIZE = 1000;
const PLAYER_SPEED = 220;
const BASE_X = 500;
const BASE_Y = 500;

interface Props {
  roomCode: string;
  playerId: string;
  player: any;
  questions: any[];
  globalState: any;
  allPlayers: Record<string, any>;
}

const SHOT_COST = 5;

export function ZombieDefenseGame({ roomCode, playerId, player, questions, globalState, allPlayers }: Props) {
  const [showQuestions, setShowQuestions] = useState(false);
  const [showShop, setShowShop] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gsRef = useRef(globalState);
  const playersRef = useRef(allPlayers);
  const posRef = useRef({
    x: player?.x ?? BASE_X + (Math.random() * 100 - 50),
    y: player?.y ?? BASE_Y + (Math.random() * 100 - 50),
  });
  const inputRef = useRef(createInputState());
  const cameraRef = useRef<CameraState>(createCamera());
  const camInitRef = useRef(false);
  const lastSyncRef = useRef(0);
  const particlesRef = useRef<Particle[]>([]);
  const dustRef = useRef<DustMote[]>([]);
  const shakeRef = useRef<ShakeState>({ intensity: 0, offsetX: 0, offsetY: 0 });
  const prevBaseHp = useRef(globalState?.baseHealth ?? 2000);
  const timeRef = useRef(0);
  const prevLasersRef = useRef(0);

  useEffect(() => { gsRef.current = globalState; }, [globalState]);
  useEffect(() => { playersRef.current = allPlayers; }, [allPlayers]);

  useEffect(() => {
    const newHp = globalState?.baseHealth ?? 2000;
    if (newHp < prevBaseHp.current) {
      const dmg = prevBaseHp.current - newHp;
      triggerShake(shakeRef.current, Math.min(12, dmg * 0.15));
    }
    prevBaseHp.current = newHp;
  }, [globalState]);

  useEffect(() => {
    if (player?.x !== undefined && player?.y !== undefined) {
      const dx = Math.abs(posRef.current.x - player.x);
      const dy = Math.abs(posRef.current.y - player.y);
      if (dx > 80 || dy > 80) posRef.current = { x: player.x, y: player.y };
    }
  }, [player?.x, player?.y]);

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
          dustRef.current = createDust(60, pw, ph);
        }
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) { raf = requestAnimationFrame(loop); return; }

      const vpW = canvas.width;
      const vpH = canvas.height;
      if (vpW === 0 || vpH === 0) { raf = requestAnimationFrame(loop); return; }

      const zoom = Math.min(vpW, vpH) / 700;
      const gs = gsRef.current;
      const players = playersRef.current;
      const cam = cameraRef.current;

      // ── UPDATE: player movement ──
      const dir = getMoveDirection(inputRef.current);
      if (dir.x !== 0 || dir.y !== 0) {
        posRef.current.x = Math.max(30, Math.min(WORLD_SIZE - 30, posRef.current.x + dir.x * PLAYER_SPEED * dt));
        posRef.current.y = Math.max(30, Math.min(WORLD_SIZE - 30, posRef.current.y + dir.y * PLAYER_SPEED * dt));
        if (now - lastSyncRef.current > 50) {
          socket.emit('updatePosition', { code: roomCode, playerId, x: posRef.current.x, y: posRef.current.y });
          lastSyncRef.current = now;
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

      // ── RENDER ──
      const shake = tickShake(shakeRef.current);
      ctx.save();
      ctx.translate(shake.x, shake.y);

      ctx.fillStyle = '#060a12';
      ctx.fillRect(0, 0, vpW, vpH);

      ctx.save();
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);

      // ── 2D Wasteland background (parallax layers) ──
      const cx = cam.x + vpW / (2 * cam.zoom);
      const cy = cam.y + vpH / (2 * cam.zoom);
      const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 600);
      bgGrad.addColorStop(0, '#0f1419');
      bgGrad.addColorStop(0.4, '#0a0d12');
      bgGrad.addColorStop(1, '#050608');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(cam.x - 100, cam.y - 100, vpW / cam.zoom + 200, vpH / cam.zoom + 200);

      // Concrete floor grid (2D perspective)
      ctx.strokeStyle = '#1a1f2e';
      ctx.lineWidth = 0.8;
      for (let i = Math.floor(cam.x / 50) * 50; i < cam.x + vpW / cam.zoom + 100; i += 50) {
        ctx.beginPath();
        ctx.moveTo(i, cam.y - 50);
        ctx.lineTo(i, cam.y + vpH / cam.zoom + 50);
        ctx.stroke();
      }
      for (let j = Math.floor(cam.y / 50) * 50; j < cam.y + vpH / cam.zoom + 100; j += 50) {
        ctx.beginPath();
        ctx.moveTo(cam.x - 50, j);
        ctx.lineTo(cam.x + vpW / cam.zoom + 50, j);
        ctx.stroke();
      }

      // Floor cracks
      const wave = gs?.wave ?? 1;
      ctx.strokeStyle = colorAlpha('#ef4444', 0.15 * (1 - (gs?.baseHealth ?? 2000) / (gs?.maxBaseHealth ?? 2000)));
      ctx.lineWidth = 2;
      for (let i = 0; i < Math.min(wave * 2, 12); i++) {
        const cwx = ((i * 137) % 900) + 50;
        const cwy = ((i * 211) % 900) + 50;
        ctx.beginPath();
        ctx.moveTo(cwx, cwy);
        for (let j = 0; j < 3; j++) {
          ctx.lineTo(cwx + Math.cos(i + j * 0.7) * 25, cwy + Math.sin(i + j * 1.1) * 20);
        }
        ctx.stroke();
      }

      const bHp = gs?.baseHealth ?? 2000;
      const bMax = gs?.maxBaseHealth ?? 2000;

      // Range rings around base
      for (let r = 120; r <= 450; r += 110) {
        ctx.strokeStyle = `rgba(59,130,246,${0.05 + 0.03 * Math.sin(t + r * 0.008)})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 10]);
        ctx.beginPath();
        ctx.arc(BASE_X, BASE_Y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Turrets
      gs?.turrets?.forEach((tur: any) => {
        drawTurret(ctx, tur.x, tur.y, t, gs?.zombies);
      });

      // Base bunker
      drawBunker(ctx, BASE_X, BASE_Y, bHp / bMax, t);

      // Players (2D characters)
      Object.values(players || {}).forEach((p: any) => {
        const px = p.id === playerId ? posRef.current.x : p.x;
        const py = p.id === playerId ? posRef.current.y : p.y;
        const hp = p.modeState?.hp ?? 100;
        const maxHp = p.modeState?.maxHp ?? 100;
        const isMe = p.id === playerId;
        drawPlayer(ctx, px, py, hp, maxHp, t, isMe);
      });

      // Zombies
      gs?.zombies?.forEach((z: any, idx: number) => {
        const angle = Math.atan2(BASE_Y - z.y, BASE_X - z.x);
        const isNear = Math.hypot(z.x - BASE_X, z.y - BASE_Y) < 120;
        drawZombie(ctx, z.x, z.y, z.hp, z.maxHp, angle, t, idx, isNear);
      });

      // Lasers (from player or turret to zombie)
      const laserCount = gs?.lasers?.length || 0;
      gs?.lasers?.forEach((l: any) => {
        drawBeam(ctx, l.x1, l.y1, l.x2, l.y2, l.color || '#ef4444', 2.5, 12);
        particlesRef.current.push(...emitBurst(l.x2, l.y2, 4, 2.5, 0.4, l.color || '#ef4444', 1.5, { type: 'spark' }));
      });
      if (laserCount > prevLasersRef.current) triggerShake(shakeRef.current, 3);
      prevLasersRef.current = laserCount;

      particlesRef.current = tickParticles(ctx, particlesRef.current);

      ctx.restore();

      // Ambient dust (screen space)
      drawDust(ctx, dustRef.current, vpW, vpH, '#64748b');

      // Warning overlay when base low
      if (bHp < bMax * 0.4) {
        const warn = 1 - bHp / (bMax * 0.4);
        const pulse = 0.5 + 0.5 * Math.sin(t * 4);
        ctx.fillStyle = `rgba(220,38,38,${warn * pulse * 0.08})`;
        ctx.fillRect(0, 0, vpW, vpH);
      }

      ctx.restore();
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [roomCode, playerId]);

  const handleCanvasClick = useCallback((e: RMouseEvent<HTMLCanvasElement> | RTouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !gsRef.current?.zombies) return;
    if ((player?.resources || 0) < SHOT_COST) return;

    const rect = canvas.getBoundingClientRect();
    let clientX: number, clientY: number;
    if ('touches' in e) {
      if (!e.touches[0]) return;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const cam = cameraRef.current;
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;
    const worldX = screenX / cam.zoom + cam.x;
    const worldY = screenY / cam.zoom + cam.y;
    let closest: any = null;
    let minDist = 70;
    gsRef.current.zombies.forEach((z: any) => {
      const d = Math.hypot(z.x - worldX, z.y - worldY);
      if (d < minDist) { minDist = d; closest = z; }
    });

    if (closest) {
      socket.emit('action', { code: roomCode, playerId, actionType: 'shoot_zombie', targetId: closest.id });
      triggerShake(shakeRef.current, 3);
    }
  }, [roomCode, playerId, player?.resources]);

  const buyUpgrade = (id: string, cost: number) => {
    socket.emit('buyUpgrade', { code: roomCode, playerId, upgradeId: id, cost });
  };
  const onCorrect = () => {
    socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: true });
  };
  const onWrong = () => {
    socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: false });
  };

  const baseHp = globalState?.baseHealth ?? 0;
  const maxHp = globalState?.maxBaseHealth ?? 2000;
  const wave = globalState?.wave ?? 1;
  const zombieCount = globalState?.zombies?.length ?? 0;
  const turretCount = globalState?.turrets?.length ?? 0;
  const hpPct = baseHp / maxHp;
  const resources = Math.floor(player?.resources || 0);
  const ammo = Math.floor(resources / SHOT_COST);
  const canShoot = resources >= SHOT_COST;
  const showOutOfAmmo = !canShoot && (globalState?.zombies?.length || 0) > 0;

  return (
    <div className="fixed inset-0 bg-[#08090d] text-white flex flex-col">
      {/* Full-screen game canvas */}
      <div className="absolute inset-0">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full cursor-crosshair"
          onClick={handleCanvasClick}
          onTouchStart={handleCanvasClick}
        />
        <AnimatePresence>
          {baseHp < maxHp * 0.25 && baseHp > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: [0.05, 0.2, 0.05] }}
              exit={{ opacity: 0 }}
              transition={{ repeat: Infinity, duration: 0.8 }}
              className="absolute inset-0 border-4 border-red-500/60 pointer-events-none"
            />
          )}
        </AnimatePresence>
      </div>

      {/* Compact HUD overlay */}
      <div className="absolute top-0 left-0 right-0 z-20 p-2 bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-blue-300">הגנת זומבים</span>
            <span className="text-[11px] bg-red-900/60 px-2 py-0.5 rounded">🧟 {zombieCount}</span>
            <span className="text-[11px] bg-indigo-900/60 px-2 py-0.5 rounded">גל {wave}</span>
            <span className="text-[11px] bg-cyan-900/60 px-2 py-0.5 rounded">🗼 {turretCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="bg-amber-900/70 px-3 py-1 rounded-lg border border-amber-600/50">
              <span className="text-sm font-bold text-amber-300">🎯 {ammo}</span>
              <span className="text-[10px] text-amber-400/80 mr-1">יריות</span>
            </div>
            <div className="bg-yellow-900/50 px-2 py-1 rounded border border-yellow-600/40">
              <span className="text-sm font-bold text-yellow-300">💰 {resources}</span>
            </div>
          </div>
        </div>
        <div className="mt-1.5 h-3 bg-slate-800/90 rounded-full overflow-hidden border border-slate-600/50 relative flex items-center">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${hpPct * 100}%`,
              background: hpPct > 0.5 ? 'linear-gradient(90deg,#22c55e,#3b82f6)' : hpPct > 0.25 ? 'linear-gradient(90deg,#eab308,#f97316)' : 'linear-gradient(90deg,#ef4444,#dc2626)',
            }}
            animate={{ width: `${hpPct * 100}%` }}
            transition={{ duration: 0.3 }}
          />
          <span className="relative z-10 w-full text-center text-[10px] font-bold text-white drop-shadow-md">
            בסיס: {Math.floor(baseHp)}/{maxHp}
          </span>
        </div>
      </div>

      {/* Out of ammo banner */}
      <AnimatePresence>
        {showOutOfAmmo && (
          <motion.div
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -50, opacity: 0 }}
            className="absolute top-14 left-1/2 -translate-x-1/2 z-30 bg-amber-900/95 backdrop-blur px-4 py-3 rounded-xl border-2 border-amber-500/60 shadow-xl pointer-events-none"
          >
            <p className="text-amber-100 font-bold text-center">💥 נגמרה התחמושת!</p>
            <p className="text-amber-200/90 text-sm text-center mt-1">לחץ על &quot;שאלות&quot; וענה נכון כדי למלא תחמושת (+10 לכל תשובה נכונה)</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom buttons */}
      <div className="absolute bottom-4 left-0 right-0 z-20 flex justify-center gap-3 px-4 pointer-events-auto">
        <button
          onClick={() => setShowQuestions(true)}
          className="px-5 py-3 rounded-xl font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg border border-blue-500/50 flex items-center gap-2"
        >
          <HelpCircle size={18} /> שאלות (+תחמושת)
        </button>
        <button
          onClick={() => setShowShop(true)}
          className="px-5 py-3 rounded-xl font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg border border-emerald-500/50 flex items-center gap-2"
        >
          <ShoppingCart size={18} /> חנות
        </button>
      </div>

      {/* Virtual joystick */}
      <div className="absolute bottom-4 left-4 z-20 pointer-events-auto">
        <VirtualJoystick onMove={onJoystickMove} onRelease={onJoystickRelease} size={110} teamColor="rgba(34,211,238,0.5)" />
      </div>

      {/* Questions modal - Kahoot style */}
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
              className="bg-slate-900 rounded-2xl border border-slate-600 shadow-2xl max-w-lg w-full max-h-[85vh] overflow-hidden"
            >
              <div className="p-4 border-b border-slate-700 flex justify-between items-center">
                <span className="font-bold text-cyan-400">ענה על שאלות - כל תשובה נכונה = +10 תחמושת!</span>
                <button onClick={() => setShowQuestions(false)} className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 font-bold">סיום ✓</button>
              </div>
              <div className="overflow-y-auto max-h-[calc(85vh-80px)]">
                <QuestionPanel questions={questions} onCorrect={onCorrect} onWrong={onWrong} earnLabel="+10 💰" compact />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Shop modal */}
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
              className="bg-slate-900 rounded-2xl border border-slate-600 shadow-2xl max-w-md w-full max-h-[80vh] overflow-hidden"
            >
              <div className="p-4 border-b border-slate-700 flex justify-between items-center">
                <span className="font-bold text-emerald-400">חנות</span>
                <button onClick={() => setShowShop(false)} className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 font-bold">סגור</button>
              </div>
              <div className="p-4 space-y-2 overflow-y-auto">
                <ShopButton title="בנה צריח" desc="צריח אוטומטי שיורה בזומבים" cost={500}
                  icon={<Crosshair className="text-cyan-400" size={18} />}
                  canAfford={resources >= 500} onBuy={() => buyUpgrade('turret', 500)} />
                <ShopButton title="תקן בסיס" desc="שחזר 500 נקודות חיים לבסיס" cost={100}
                  icon={<Wrench className="text-blue-400" size={18} />}
                  canAfford={resources >= 100} onBuy={() => buyUpgrade('repair', 100)} />
                <ShopButton title="ריפוי קבוצתי" desc="מרפא את כל חברי הקבוצה" cost={300}
                  icon={<Heart className="text-pink-400" size={18} />}
                  canAfford={resources >= 300} onBuy={() => buyUpgrade('heal', 300)} />
                <ShopButton title="שדרוג נזק" desc="הגדל את הנזק של הירייה שלך" cost={200}
                  icon={<Zap className="text-yellow-400" size={18} />}
                  canAfford={resources >= 200} onBuy={() => buyUpgrade('damage', 200)} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Sprite: Player (survivor) - improved 2D ──
function drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, hp: number, maxHp: number, t: number, isMe: boolean) {
  ctx.save();
  ctx.translate(x, y);

  const bodyColor = isMe ? '#22d3ee' : '#3b82f6';
  const darkColor = isMe ? '#0e7490' : '#1e40af';
  const vestGradient = ctx.createLinearGradient(-10, -15, 10, 15);
  vestGradient.addColorStop(0, colorAlpha(bodyColor, 0.9));
  vestGradient.addColorStop(0.5, bodyColor);
  vestGradient.addColorStop(1, darkColor);

  // Shadow (oval)
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, 16, 11, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs
  ctx.fillStyle = '#334155';
  ctx.fillRect(-5, 10, 4, 12);
  ctx.fillRect(1, 10, 4, 12);
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1;
  ctx.strokeRect(-5, 10, 4, 12);
  ctx.strokeRect(1, 10, 4, 12);

  // Body (tactical vest with pockets)
  ctx.fillStyle = vestGradient;
  roundRect(ctx, -9, -10, 18, 20, 3);
  ctx.fill();
  ctx.strokeStyle = darkColor;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = colorAlpha('#0f172a', 0.5);
  ctx.fillRect(-6, 2, 5, 6);
  ctx.fillRect(1, 2, 5, 6);

  // Arms (holding weapon pose)
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-9, -5);
  ctx.lineTo(-14, 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(9, -5);
  ctx.lineTo(16, -8);
  ctx.stroke();

  // Rifle
  ctx.fillStyle = '#374151';
  ctx.fillRect(10, -10, 14, 4);
  ctx.fillStyle = '#22d3ee';
  ctx.beginPath();
  ctx.arc(24, -8, 3, 0, Math.PI * 2);
  ctx.fill();

  // Head
  const skinGrad = ctx.createRadialGradient(-3, -16, 0, 0, -14, 10);
  skinGrad.addColorStop(0, '#fde68a');
  skinGrad.addColorStop(0.7, '#fbbf24');
  skinGrad.addColorStop(1, '#f59e0b');
  ctx.fillStyle = skinGrad;
  ctx.beginPath();
  ctx.arc(0, -14, 8, 0, Math.PI * 2);
  ctx.fill();

  // Helmet
  if (isMe) {
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#22d3ee';
    ctx.beginPath();
    ctx.arc(0, -14, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  ctx.restore();

  const pct = hp / maxHp;
  const barColor = pct > 0.5 ? '#22c55e' : pct > 0.25 ? '#eab308' : '#ef4444';
  drawHPBar(ctx, x, y - 26, 26, 4, pct, barColor);
}

// ── Sprite: Bunker Base ──
function drawBunker(ctx: CanvasRenderingContext2D, x: number, y: number, hpPct: number, t: number) {
  ctx.save();
  const sides = 8;
  const outerR = 50;
  const innerR = 28;

  // Outer bunker wall
  drawGlow(ctx, x, y, outerR * 1.8, '#3b82f6', 0.08 + 0.04 * Math.sin(t * 2));

  ctx.fillStyle = '#1e293b';
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 - Math.PI / sides;
    const px = x + Math.cos(a) * outerR;
    const py = y + Math.sin(a) * outerR;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Damage cracks on bunker
  if (hpPct < 0.7) {
    const crackIntensity = 1 - hpPct;
    ctx.strokeStyle = colorAlpha('#ef4444', crackIntensity * 0.6);
    ctx.lineWidth = 1.5;
    for (let i = 0; i < Math.floor(crackIntensity * 6); i++) {
      const a = (i * 1.1) + 0.5;
      const startR = outerR * 0.5;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * startR, y + Math.sin(a) * startR);
      for (let j = 1; j <= 3; j++) {
        const r = startR + j * 8;
        ctx.lineTo(x + Math.cos(a + (j % 2 ? 0.2 : -0.15)) * r, y + Math.sin(a + (j % 2 ? -0.1 : 0.15)) * r);
      }
      ctx.stroke();
    }
  }

  // Inner core (rotating radar)
  ctx.fillStyle = '#1e40af';
  ctx.shadowBlur = 20;
  ctx.shadowColor = '#3b82f6';
  ctx.beginPath(); ctx.arc(x, y, innerR, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;

  // Radar sweep
  const sweepAngle = t * 1.5;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, innerR, 0, Math.PI * 2);
  ctx.clip();
  const sweepGrad = ctx.createConicGradient(sweepAngle, x, y);
  sweepGrad.addColorStop(0, 'rgba(96,165,250,0.25)');
  sweepGrad.addColorStop(0.15, 'transparent');
  sweepGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = sweepGrad;
  ctx.fillRect(x - innerR, y - innerR, innerR * 2, innerR * 2);
  ctx.restore();

  // Rebar accent lines at edges
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < sides; i += 2) {
    const a = (i / sides) * Math.PI * 2 - Math.PI / sides;
    const a2 = ((i + 1) / sides) * Math.PI * 2 - Math.PI / sides;
    const midA = (a + a2) / 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(midA) * (outerR - 4), y + Math.sin(midA) * (outerR - 4));
    ctx.lineTo(x + Math.cos(midA) * (outerR + 6), y + Math.sin(midA) * (outerR + 6));
    ctx.stroke();
  }

  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('HQ', x, y);
  ctx.restore();
}

// ── Sprite: Zombie (humanoid) - improved 2D ──
function drawZombie(
  ctx: CanvasRenderingContext2D, x: number, y: number,
  hp: number, maxHp: number, angle: number, t: number, idx: number, attacking: boolean
) {
  ctx.save();
  ctx.translate(x, y);

  const wobble = Math.sin(t * 6 + idx * 2) * 0.06;
  ctx.rotate(angle + Math.PI / 2 + wobble);

  const sz = 1.3 * (hp / maxHp > 0.7 ? 1 : 0.9);
  const green = hp / maxHp > 0.5 ? '#15803d' : '#166534';
  const darkGreen = '#14532d';
  const rotGreen = '#1e3a2a';

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(0, 14 * sz, 10 * sz, 4 * sz, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tattered legs
  ctx.fillStyle = darkGreen;
  ctx.fillRect(-4 * sz, 8 * sz, 3 * sz, 14 * sz);
  ctx.fillRect(1 * sz, 8 * sz, 3 * sz, 14 * sz);
  ctx.strokeStyle = rotGreen;
  ctx.lineWidth = 1;
  ctx.strokeRect(-4 * sz, 8 * sz, 3 * sz, 14 * sz);
  ctx.strokeRect(1 * sz, 8 * sz, 3 * sz, 14 * sz);

  // Body (rotting torso)
  const bodyGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 12 * sz);
  bodyGrad.addColorStop(0, '#1a4d2e');
  bodyGrad.addColorStop(0.6, green);
  bodyGrad.addColorStop(1, darkGreen);
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.ellipse(0, 0, 8 * sz, 12 * sz, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rotGreen;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Ripped shirt / wounds
  ctx.strokeStyle = colorAlpha('#7f1d1d', 0.7);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-5 * sz, -2 * sz);
  ctx.lineTo(2 * sz, 4 * sz);
  ctx.moveTo(3 * sz, -4 * sz);
  ctx.lineTo(-2 * sz, 3 * sz);
  ctx.stroke();

  // Arms reaching forward (claw pose)
  const armSwing = Math.sin(t * 5 + idx) * 0.25;
  ctx.strokeStyle = green;
  ctx.lineWidth = 4 * sz;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-6 * sz, -3 * sz);
  ctx.quadraticCurveTo(-12 * sz, -16 * sz - armSwing * 5 * sz, -8 * sz, -24 * sz);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(6 * sz, -3 * sz);
  ctx.quadraticCurveTo(12 * sz, -16 * sz + armSwing * 5 * sz, 8 * sz, -24 * sz);
  ctx.stroke();

  // Head (decayed)
  const headGrad = ctx.createRadialGradient(-2, -14 * sz, 0, 0, -12 * sz, 8 * sz);
  headGrad.addColorStop(0, '#166534');
  headGrad.addColorStop(0.7, green);
  headGrad.addColorStop(1, darkGreen);
  ctx.fillStyle = headGrad;
  ctx.beginPath();
  ctx.arc(0, -12 * sz, 7 * sz, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rotGreen;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Eyes (glowing red)
  ctx.shadowBlur = 10;
  ctx.shadowColor = '#ef4444';
  ctx.fillStyle = '#dc2626';
  ctx.beginPath();
  ctx.arc(-2.5 * sz, -13 * sz, 2 * sz, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(2.5 * sz, -13 * sz, 2 * sz, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Mouth (open growl)
  ctx.fillStyle = '#450a0a';
  ctx.beginPath();
  ctx.ellipse(0, -9 * sz, 3.5 * sz, 2.5 * sz, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#7f1d1d';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();

  const barY = y - 26;
  const pct = hp / maxHp;
  const barColor = pct > 0.5 ? '#22c55e' : pct > 0.25 ? '#eab308' : '#ef4444';
  drawHPBar(ctx, x, barY, 26, 4, pct, barColor);
}

// ── Sprite: Turret ──
function drawTurret(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, zombies: any[]) {
  ctx.save();

  // Find target angle
  let targetAngle = t * 0.5;
  if (zombies?.length) {
    let closest: any = null, minDist = Infinity;
    zombies.forEach((z: any) => {
      const d = Math.hypot(z.x * s - x, z.y * s - y);
      if (d < minDist) { minDist = d; closest = z; }
    });
    if (closest) targetAngle = Math.atan2(closest.y * s - y, closest.x * s - x);
  }

  // Range ring
  ctx.strokeStyle = 'rgba(34,211,238,0.06)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([3, 6]);
  ctx.beginPath(); ctx.arc(x, y, 150, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);

  // Base plate
  ctx.fillStyle = '#374151';
  ctx.strokeStyle = '#4b5563';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x - 11, y - 11, 22, 22, 4);
  ctx.fill(); ctx.stroke();

  // Diamond accent
  ctx.fillStyle = '#1f2937';
  ctx.beginPath();
  ctx.moveTo(x, y - 8);
  ctx.lineTo(x + 8, y);
  ctx.lineTo(x, y + 8);
  ctx.lineTo(x - 8, y);
  ctx.closePath();
  ctx.fill();

  // Rotating barrel
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(targetAngle);
  ctx.fillStyle = '#6b7280';
  ctx.fillRect(0, -2, 18, 4);
  ctx.fillStyle = '#22d3ee';
  ctx.shadowBlur = 6;
  ctx.shadowColor = '#22d3ee';
  ctx.beginPath(); ctx.arc(18, 0, 2, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();

  // Center core
  ctx.fillStyle = '#22d3ee';
  ctx.shadowBlur = 8;
  ctx.shadowColor = '#22d3ee';
  ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;

  ctx.restore();
}

// ── Shop Button Component ──
function ShopButton({ title, desc, cost, icon, canAfford, onBuy }: {
  title: string; desc: string; cost: number; icon: ReactNode; canAfford: boolean; onBuy: () => void;
}) {
  return (
    <motion.button
      whileTap={canAfford ? { scale: 0.96 } : {}}
      whileHover={canAfford ? { scale: 1.01 } : {}}
      disabled={!canAfford}
      onClick={onBuy}
      className={`w-full p-3 rounded-xl flex items-center gap-3 transition-all duration-150 ${
        canAfford
          ? 'bg-slate-800/80 hover:bg-slate-700/80 border border-slate-600/50 shadow-lg hover:shadow-xl'
          : 'bg-slate-800/30 border border-slate-800/50 opacity-40'
      }`}
    >
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
        canAfford ? 'bg-slate-700/80 shadow-inner' : 'bg-slate-800/50'
      }`}>
        {icon}
      </div>
      <div className="flex-1 text-right min-w-0">
        <h4 className="font-bold text-sm">{title}</h4>
        <p className="text-[11px] text-slate-400 truncate">{desc}</p>
      </div>
      <div className={`font-bold text-xs px-3 py-1.5 rounded-lg whitespace-nowrap ${
        canAfford ? 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20' : 'bg-slate-700/50 text-slate-500'
      }`}>
        💰 {cost}
      </div>
    </motion.button>
  );
}
