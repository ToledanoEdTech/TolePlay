import React, { useState, useEffect, useRef, useCallback, type MouseEvent as RMouseEvent, type TouchEvent as RTouchEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QuestionPanel } from '../QuestionPanel';
import { Clock, HelpCircle, ShoppingCart, X, Trophy } from 'lucide-react';
import { socket } from '../../socket';
import {
  type Particle, type Star, type ShakeState,
  tickParticles,
  createStarfield, drawStarfield,
  triggerShake, tickShake,
  drawBeam, drawHPBar, drawGlow, colorAlpha,
  createParallaxNebulas, drawParallaxNebulas,
  emitAsteroidExplosion,
  drawOreGem, drawMuzzleFlash,
  type ParallaxLayer,
} from './renderUtils';

const WORLD_SIZE = 4000;
const VIEW_SIZE = 1000;

interface Props {
  roomCode: string;
  playerId: string;
  player: any;
  questions: any[];
  globalState: any;
  allPlayers: Record<string, any>;
  startTime?: number;
}

const ASTEROID_TYPES = [
  { minVal: 0, name: 'iron', body: '#737373', crater: '#4b5563', glow: '#9ca3af', outline: '#78716c' },
  { minVal: 70, name: 'ice', body: '#2dd4bf', crater: '#38bdf8', glow: '#67e8f9', outline: '#0ea5e9' },
  { minVal: 100, name: 'crystal', body: '#c084fc', crater: '#a855f7', glow: '#d8b4fe', outline: '#9333ea' },
];

function getAsteroidType(value: number) {
  for (let i = ASTEROID_TYPES.length - 1; i >= 0; i--) {
    if (value >= ASTEROID_TYPES[i].minVal) return ASTEROID_TYPES[i];
  }
  return ASTEROID_TYPES[0];
}

const PLAYER_COLORS = ['#38bdf8', '#f43f5e', '#a855f7', '#10b981', '#f59e0b', '#06b6d4', '#ec4899', '#84cc16'];

function playerColor(playerId: string): string {
  let h = 0;
  for (let i = 0; i < playerId.length; i++) h = (h * 31 + playerId.charCodeAt(i)) >>> 0;
  return PLAYER_COLORS[h % PLAYER_COLORS.length];
}

export function AsteroidHuntGame({ roomCode, playerId, player, questions, globalState, allPlayers, startTime }: Props) {
  const [quizOpen, setQuizOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const gsRef = useRef(globalState);
  const playerRef = useRef(player);
  const starsRef = useRef<Star[]>([]);
  const nebulasRef = useRef<ParallaxLayer[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const shakeRef = useRef<ShakeState>({ intensity: 0, offsetX: 0, offsetY: 0 });
  const mouseRef = useRef({ worldX: WORLD_SIZE / 2, worldY: WORLD_SIZE / 2 });
  const keysRef = useRef({ up: false, down: false, left: false, right: false });
  const cameraRef = useRef({ x: WORLD_SIZE / 2 - VIEW_SIZE / 2, y: WORLD_SIZE / 2 - VIEW_SIZE / 2 });
  const muzzleFlashRef = useRef({ active: false, angle: 0, intensity: 1 });
  const modalOpenRef = useRef(false);
  const floatTextsRef = useRef<{ x: number; y: number; text: string; life: number }[]>([]);
  const prevTimeRef = useRef(0);
  const seenCollectiblesRef = useRef<Set<string>>(new Set());

  gsRef.current = globalState;
  playerRef.current = player;
  modalOpenRef.current = quizOpen || shopOpen;

  useEffect(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    starsRef.current = createStarfield(220, w, h);
    nebulasRef.current = createParallaxNebulas(6, w, h);
  }, []);

  const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
  const timeLeft = Math.max(0, 7 * 60 - elapsed);
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const ammo = Math.floor(player?.resources || 0);
  const ore = player?.score || 0;
  const credits = player?.modeState?.credits ?? 0;
  const weaponTier = player?.modeState?.weaponTier ?? 1;
  const laserDmg = player?.modeState?.laserDamage ?? 25;
  const magnetRange = player?.modeState?.magnetRange ?? 50;
  const hasShield = !!player?.modeState?.hasShield;
  const px = player?.x ?? WORLD_SIZE / 2;
  const py = player?.y ?? WORLD_SIZE / 2;
  const playerAngle = typeof player?.angle === 'number' ? player.angle : 0;

  const updateMouseWorld = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const viewW = canvas.width;
    const viewH = canvas.height;
    const cam = cameraRef.current;
    const screenX = (clientX - rect.left) * scaleX;
    const screenY = (clientY - rect.top) * scaleY;
    mouseRef.current = {
      worldX: cam.x + (screenX / viewW) * viewW,
      worldY: cam.y + (screenY / viewH) * viewH,
    };
  }, []);

  const handleMouseMove = useCallback((e: RMouseEvent<HTMLCanvasElement>) => {
    updateMouseWorld(e.clientX, e.clientY);
  }, [updateMouseWorld]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (['w', 's', 'a', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
      if (k === 'w' || k === 'arrowup') keysRef.current.up = true;
      if (k === 's' || k === 'arrowdown') keysRef.current.down = true;
      if (k === 'a' || k === 'arrowleft') keysRef.current.left = true;
      if (k === 'd' || k === 'arrowright') keysRef.current.right = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'w' || k === 'arrowup') keysRef.current.up = false;
      if (k === 's' || k === 'arrowdown') keysRef.current.down = false;
      if (k === 'a' || k === 'arrowleft') keysRef.current.left = false;
      if (k === 'd' || k === 'arrowright') keysRef.current.right = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    if (quizOpen || shopOpen) return;
    const interval = setInterval(() => {
      const k = keysRef.current;
      const dx = (k.right ? 1 : 0) - (k.left ? 1 : 0);
      const dy = (k.down ? 1 : 0) - (k.up ? 1 : 0);
      socket.emit('move', { code: roomCode, playerId, dx, dy });
    }, 50);
    return () => clearInterval(interval);
  }, [roomCode, playerId, quizOpen, shopOpen]);

  const handleTouchMove = useCallback((e: RTouchEvent<HTMLCanvasElement>) => {
    if (!e.touches[0]) return;
    updateMouseWorld(e.touches[0].clientX, e.touches[0].clientY);
  }, [updateMouseWorld]);

  const handleCanvasClick = useCallback((e: RMouseEvent<HTMLCanvasElement> | RTouchEvent<HTMLCanvasElement>) => {
    if (quizOpen || shopOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ammoCost = weaponTier === 4 ? 25 : 10;
    if ((player?.resources || 0) < ammoCost) return;

    let clientX: number, clientY: number;
    if ('touches' in e) {
      if (!e.touches[0]) return;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    updateMouseWorld(clientX, clientY);
    const { worldX, worldY } = mouseRef.current;
    const angle = Math.atan2(worldY - py, worldX - px);

    muzzleFlashRef.current = { active: true, angle, intensity: 1 };
    socket.emit('action', { code: roomCode, playerId, actionType: 'shoot', aimAngle: angle });
  }, [roomCode, playerId, player?.resources, weaponTier, quizOpen, shopOpen, px, py, updateMouseWorld]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };
    resize();
    window.addEventListener('resize', resize);

    const safeNum = (v: unknown, def: number): number =>
      typeof v === 'number' && !Number.isNaN(v) ? v : def;

    let raf: number;
    const render = (now: number) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        raf = requestAnimationFrame(render);
        return;
      }
      resize();

      try {
      const dt = Math.min(0.05, (now - prevTimeRef.current) / 1000);
      prevTimeRef.current = now;
      const t = now * 0.001;
      const gs = gsRef.current || {};
      const p = playerRef.current;
      const viewW = Math.max(320, canvas.width);
      const viewH = Math.max(240, canvas.height);

      const cam = cameraRef.current;
      const plX = safeNum(p?.x, WORLD_SIZE / 2);
      const plY = safeNum(p?.y, WORLD_SIZE / 2);
      cam.x = plX - viewW / 2;
      cam.y = plY - viewH / 2;
      cam.x = Math.max(0, Math.min(WORLD_SIZE - viewW, cam.x));
      cam.y = Math.max(0, Math.min(WORLD_SIZE - viewH, cam.y));

      ctx.clearRect(0, 0, viewW, viewH);

      const shake = tickShake(shakeRef.current);
      ctx.save();
      ctx.translate(safeNum(shake.x, 0), safeNum(shake.y, 0));

      const bg = ctx.createLinearGradient(0, 0, 0, viewH);
      bg.addColorStop(0, '#020210');
      bg.addColorStop(0.3, '#070720');
      bg.addColorStop(0.6, '#0a0a35');
      bg.addColorStop(1, '#020210');
      ctx.fillStyle = bg;
      ctx.fillRect(-20, -20, viewW + 40, viewH + 40);

      const scrollY = t * 30;
      drawParallaxNebulas(ctx, nebulasRef.current, viewW, viewH, t, scrollY);
      drawStarfield(ctx, starsRef.current, viewW, viewH, 0.5);

      ctx.save();
      ctx.translate(-cam.x, -cam.y);

      ctx.strokeStyle = 'rgba(255, 0, 0, 0.2)';
      ctx.lineWidth = 4;
      ctx.strokeRect(0, 0, WORLD_SIZE, WORLD_SIZE);

      const toScreen = (wx: number, wy: number) => ({
        x: safeNum(wx, 0) - cam.x,
        y: safeNum(wy, 0) - cam.y,
      });

      (gs.asteroids || []).forEach((a: any) => {
        const ax = safeNum(a.x, WORLD_SIZE / 2);
        const ay = safeNum(a.y, WORLD_SIZE / 2);
        const { x: sx, y: sy } = toScreen(ax, ay);
        if (Number.isNaN(sx) || Number.isNaN(sy) || sx < -200 || sx > viewW + 200 || sy < -200 || sy > viewH + 200) return;
        const type = getAsteroidType(safeNum(a.value, 50));
        const scale = Math.max(0.3, (viewW / VIEW_SIZE) * 0.5);
        const size = Math.max(8, safeNum(a.radius, 25) * scale);
        const rotation = safeNum(a.rotation, 0) + ax * 0.01;
        const maxHp = Math.max(1, safeNum(a.maxHp, 100));
        const hpPct = Math.max(0, Math.min(1, safeNum(a.hp, maxHp) / maxHp));
        drawAsteroid(ctx, sx, sy, size, type, rotation, hpPct);
        const barColor = hpPct > 0.5 ? type.glow : hpPct > 0.25 ? '#f59e0b' : '#ef4444';
        drawHPBar(ctx, sx, sy - size - 6, size * 1.6, 3, hpPct, barColor);
      });

      (gs.collectibles || []).forEach((c: any) => {
        const cx = safeNum(c.x, 0);
        const cy = safeNum(c.y, 0);
        const { x: scrX, y: scrY } = toScreen(cx, cy);
        if (Number.isNaN(scrX) || Number.isNaN(scrY) || scrX < -30 || scrX > viewW + 30 || scrY < -30 || scrY > viewH + 30) return;
        const gemColor = c.color || (safeNum(c.value, 50) >= 100 ? '#c084fc' : safeNum(c.value, 50) >= 70 ? '#67e8f9' : '#9ca3af');
        drawOreGem(ctx, scrX, scrY, safeNum(c.value, 50), gemColor, t, viewW / VIEW_SIZE);
      });

      (gs.projectiles || []).filter((proj: any) => {
        const projX = proj.x;
        const projY = proj.y;
        return typeof projX === 'number' && !Number.isNaN(projX) && typeof projY === 'number' && !Number.isNaN(projY);
      }).forEach((proj: any) => {
        const { x: px, y: py } = toScreen(proj.x, proj.y);
        if (Number.isNaN(px) || Number.isNaN(py) || px < -30 || px > viewW + 30 || py < -30 || py > viewH + 30) return;
        if (proj.type === 'plasma') {
          drawGlow(ctx, px, py, 25 * (viewW / VIEW_SIZE), '#a855f7', 0.4);
          ctx.fillStyle = colorAlpha('#a855f7', 0.9);
          ctx.shadowBlur = 15;
          ctx.shadowColor = '#a855f7';
          ctx.beginPath();
          ctx.arc(px, py, 12 * (viewW / VIEW_SIZE), 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          ctx.beginPath();
          ctx.arc(px, py, (proj.radius || 4) * (viewW / VIEW_SIZE), 0, Math.PI * 2);
          ctx.fillStyle = proj.color || '#60a5fa';
          ctx.shadowBlur = 10;
          ctx.shadowColor = proj.color || '#60a5fa';
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      });

      const allPlayersMap = allPlayers || {};
      const playersList: Array<{ id: string; x?: number; y?: number; angle?: number; name?: string; modeState?: any }> = Object.entries(allPlayersMap).map(([id, pl]) => ({ ...pl, id }));
      if (!playersList.some((pl: any) => pl.id === playerId)) {
        playersList.push({
          id: playerId,
          x: plX,
          y: plY,
          angle: typeof p?.angle === 'number' ? p.angle : 0,
          name: p?.name,
          modeState: p?.modeState,
        });
      }
      playersList.forEach((pl: any) => {
        const plx = safeNum(pl.x, WORLD_SIZE / 2);
        const ply = safeNum(pl.y, WORLD_SIZE / 2);
        const { x: sx, y: sy } = toScreen(plx, ply);
        if (Number.isNaN(sx) || Number.isNaN(sy) || sx < -80 || sx > viewW + 80 || sy < -80 || sy > viewH + 80) return;
        const angle = safeNum(pl.angle, 0);
        const color = pl.color || playerColor(pl.id);
        const scale = Math.max(0.3, (viewW / VIEW_SIZE) * 0.5);
        const radius = Math.max(12, 26 * scale);
        const isLocal = pl.id === playerId;

        if (isLocal) {
          drawGlow(ctx, sx, sy, radius + 25, color, 0.2);
          ctx.beginPath();
          ctx.arc(sx, sy, (pl.modeState?.magnetRange ?? 50) * scale, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        if (pl.modeState?.hasShield) {
          ctx.beginPath();
          ctx.arc(sx, sy, radius + 12, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(59, 130, 246, 0.9)';
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
          ctx.fill();
        }

        ctx.save();
        ctx.translate(safeNum(sx, viewW / 2), safeNum(sy, viewH / 2));
        ctx.rotate(angle);
        ctx.strokeStyle = colorAlpha('#fff', 0.35);
        ctx.lineWidth = 2;
        ctx.fillStyle = color;
        ctx.shadowBlur = 12;
        ctx.shadowColor = color;
        ctx.beginPath();
        ctx.moveTo(radius, 0);
        ctx.lineTo(-radius * 0.5, radius * 0.4);
        ctx.lineTo(-radius * 0.8, 0);
        ctx.lineTo(-radius * 0.5, -radius * 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(-radius * 0.2, radius * 0.3);
        ctx.lineTo(-radius, radius * 0.9);
        ctx.lineTo(-radius * 0.7, radius * 0.3);
        ctx.closePath();
        ctx.fillStyle = '#334155';
        ctx.fill();
        ctx.strokeStyle = colorAlpha('#fff', 0.15);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-radius * 0.2, -radius * 0.3);
        ctx.lineTo(-radius, -radius * 0.9);
        ctx.lineTo(-radius * 0.7, -radius * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#bae6fd';
        ctx.beginPath();
        ctx.ellipse(radius * 0.2, 0, radius * 0.4, radius * 0.15, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = `bold ${14 * (viewW / VIEW_SIZE)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(pl.name || pl.id, sx, sy - radius - 18);
      });

      if (muzzleFlashRef.current.active && p?.id === playerId) {
        const mf = muzzleFlashRef.current;
        const sx = safeNum(plX - cam.x, viewW / 2);
        const sy = safeNum(plY - cam.y, viewH / 2);
        const mfAngle = safeNum(mf.angle, 0);
        const mfIntensity = safeNum(mf.intensity, 0.5);
        if (!Number.isNaN(sx) && !Number.isNaN(sy)) {
          drawMuzzleFlash(ctx, sx, sy, mfAngle, mfIntensity);
        }
        muzzleFlashRef.current.intensity = mfIntensity - dt * 8;
        if (muzzleFlashRef.current.intensity <= 0) muzzleFlashRef.current.active = false;
      }

      floatTextsRef.current = floatTextsRef.current.filter((ft) => {
        ft.life -= dt * 1.5;
        ft.y -= 40 * dt;
        if (ft.life <= 0) return false;
        ctx.globalAlpha = ft.life;
        ctx.fillStyle = '#22c55e';
        ctx.font = `bold ${14 * (viewW / VIEW_SIZE)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.globalAlpha = 1;
        return true;
      });

      particlesRef.current = tickParticles(ctx, particlesRef.current);

      ctx.restore();

      const mmSize = 180;
      const mmX = 20;
      const mmY = viewH - mmSize - 20;
      const scale = mmSize / WORLD_SIZE;
      ctx.fillStyle = 'rgba(10, 10, 25, 0.85)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 2;
      ctx.fillRect(mmX, mmY, mmSize, mmSize);
      ctx.strokeRect(mmX, mmY, mmSize, mmSize);
      ctx.fillStyle = 'rgba(150, 150, 150, 0.5)';
      (gs.asteroids || []).forEach((a: any) => {
        const ax = safeNum(a.x, 0);
        const ay = safeNum(a.y, 0);
        if (Number.isNaN(ax) || Number.isNaN(ay)) return;
        ctx.fillRect(mmX + ax * scale, mmY + ay * scale, 2, 2);
      });
      playersList.forEach((pl: any) => {
        ctx.fillStyle = pl.color || playerColor(pl.id);
        ctx.beginPath();
        ctx.arc(mmX + safeNum(pl.x, 0) * scale, mmY + safeNum(pl.y, 0) * scale, pl.id === playerId ? 5 : 4, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(mmX + cam.x * scale, mmY + cam.y * scale, viewW * scale, viewH * scale);

      ctx.restore();
      } catch (_) {
        ctx.restore();
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  const buyUpgrade = (id: string, cost: number) => {
    socket.emit('buyUpgrade', { code: roomCode, playerId, upgradeId: id, cost });
  };
  const onCorrect = () => {
    socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: true });
  };
  const onWrong = () => {
    socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: false });
  };

  const sorted = Object.values(allPlayers || {}).sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
  const myRank = sorted.findIndex((p: any) => p.id === playerId) + 1;

  const ModalBackdrop = ({ children, onClose }: { children: React.ReactNode; onClose: () => void }) => (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
    >
      <motion.div
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', damping: 22, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 shadow-2xl"
        style={{
          background: 'rgb(2, 6, 23)',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
      >
        <button
          onClick={onClose}
          className="absolute top-3 left-3 z-10 p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
        >
          <X size={18} className="text-slate-400" />
        </button>
        {children}
      </motion.div>
    </motion.div>
  );

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 flex flex-col bg-[#020210] overflow-hidden outline-none"
      dir="rtl"
      tabIndex={0}
      onMouseDown={() => containerRef.current?.focus()}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full cursor-crosshair"
        style={{ width: '100%', height: '100%' }}
        onClick={handleCanvasClick}
        onTouchEnd={handleCanvasClick}
        onMouseMove={handleMouseMove}
        onTouchMove={handleTouchMove}
      />

      <div className="absolute top-0 left-0 right-0 flex justify-between items-center p-3 z-20 pointer-events-none">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black/50 backdrop-blur-md border border-white/10">
            <Clock size={14} className="text-slate-400" />
            <span className={`font-mono text-sm font-bold ${timeLeft < 60 ? 'text-red-400 animate-pulse' : 'text-white'}`}>
              {minutes}:{seconds.toString().padStart(2, '0')}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 rounded-xl bg-purple-500/20 backdrop-blur-md border border-purple-400/30 text-purple-300 font-bold text-sm">
            💎 {ore}
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-cyan-500/20 backdrop-blur-md border border-cyan-400/30 text-cyan-300 font-bold text-sm">
            ⚡ {ammo}
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-green-500/20 backdrop-blur-md border border-green-400/30 text-green-300 font-bold text-sm">
            💰 {credits}
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-slate-800/60 backdrop-blur-md border border-slate-600/40 text-slate-300 font-bold text-sm">
            T{weaponTier}
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-slate-800/60 backdrop-blur-md border border-slate-600/40 text-slate-300 font-bold text-sm">
            #{myRank}
          </span>
        </div>
      </div>

      <div className="absolute right-4 top-24 z-20 pointer-events-auto min-w-[200px] rounded-xl bg-slate-900/90 backdrop-blur-md border border-white/10 p-3">
        <h3 className="text-lg font-bold mb-2 flex items-center gap-2 text-amber-400">
          <Trophy size={18} /> מובילים
        </h3>
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {sorted.slice(0, 8).map((pl: any, i: number) => (
            <div
              key={pl.id}
              className={`flex justify-between text-sm ${pl.id === playerId ? 'text-amber-300 font-bold' : 'text-slate-300'}`}
            >
              <span>
                {i + 1}. {pl.name || pl.id}
              </span>
              <span>{pl.score ?? 0}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-3 z-20 pointer-events-auto">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setQuizOpen(true)}
          className="px-6 py-3 rounded-xl font-bold flex items-center gap-2 bg-purple-600/90 hover:bg-purple-500 border border-purple-400/30 shadow-lg shadow-purple-500/20 backdrop-blur-sm"
        >
          <HelpCircle size={18} /> טרמינל שאלות
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShopOpen(true)}
          className="px-6 py-3 rounded-xl font-bold flex items-center gap-2 bg-orange-600/90 hover:bg-orange-500 border border-orange-400/30 shadow-lg shadow-orange-500/20 backdrop-blur-sm"
        >
          <ShoppingCart size={18} /> חנות נשק
        </motion.button>
      </div>

      <AnimatePresence>
        {ammo < 15 && !quizOpen && (
          <motion.div
            key="low-ammo"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 pointer-events-none"
          >
            <span className="text-xs bg-red-900/80 text-red-300 px-4 py-2 rounded-full font-bold border border-red-800/40 backdrop-blur-sm">
              אנרגיה נמוכה! ענה על שאלות כדי לטעון ⚡
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="absolute bottom-20 right-4 z-20 pointer-events-none text-[10px] text-slate-500">
        WASD / חצים לזוז • לחץ לירי (כיוון העכבר)
      </div>

      <AnimatePresence>
        {quizOpen && (
          <ModalBackdrop key="quiz-modal" onClose={() => setQuizOpen(false)}>
            <div className="p-6 pt-12 overflow-y-auto max-h-[90vh] rounded-2xl bg-slate-950 text-white border border-slate-700/50">
              <h2 className="text-xl font-bold text-center mb-4 text-white">טרמינל שאלות</h2>
              <p className="text-slate-300 text-sm text-center mb-4">תשובה נכונה = +20 ⚡ + 10 💰</p>
              <div className="min-h-[220px] relative" style={{ overflow: 'visible' }}>
                <QuestionPanel questions={questions} onCorrect={onCorrect} onWrong={onWrong} earnLabel="+20 ⚡ +10 💰" compact staticDisplay />
              </div>
            </div>
          </ModalBackdrop>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {shopOpen && (
          <ModalBackdrop key="shop-modal" onClose={() => setShopOpen(false)}>
            <div className="p-6 pt-12 overflow-y-auto max-h-[85vh]">
              <h2 className="text-xl font-bold text-center mb-2 text-orange-400">חנות שדרוגים</h2>
              <p className="text-slate-400 text-sm text-center mb-4">מטבעות: {credits} 💰</p>
              <div className="space-y-3">
                <WeaponTierItem
                  tier={2}
                  title="תאומים"
                  desc="שני לייזרים מקבילים"
                  cost={100}
                  icon="🔫🔫"
                  canAfford={credits >= 100}
                  owned={weaponTier >= 2}
                  onBuy={() => buyUpgrade('weapon_tier_2', 100)}
                />
                <WeaponTierItem
                  tier={3}
                  title="פזורה"
                  desc="3 לייזרים בצורת קונוס"
                  cost={150}
                  icon="🔫🔫🔫"
                  canAfford={credits >= 150}
                  owned={weaponTier >= 3}
                  onBuy={() => buyUpgrade('weapon_tier_3', 150)}
                />
                <WeaponTierItem
                  tier={4}
                  title="פלזמה"
                  desc="פגז גדול עם נזק אזורי"
                  cost={250}
                  icon="💥"
                  canAfford={credits >= 250}
                  owned={weaponTier >= 4}
                  onBuy={() => buyUpgrade('weapon_tier_4', 250)}
                />
                <SpaceShopItem
                  title="שדרוג נזק"
                  desc={`נזק +25 (כרגע: ${laserDmg})`}
                  cost={100}
                  icon="⚔️"
                  accentColor="#a855f7"
                  canAfford={credits >= 100}
                  onBuy={() => buyUpgrade('laser', 100)}
                />
                <SpaceShopItem
                  title="מגנט"
                  desc={`משוך עפרות (טווח +50, כרגע: ${magnetRange})`}
                  cost={150}
                  icon="🧲"
                  accentColor="#3b82f6"
                  canAfford={credits >= 150}
                  onBuy={() => buyUpgrade('magnet', 150)}
                />
                <SpaceShopItem
                  title="מגן"
                  desc="הגנה מפני התנגשויות"
                  cost={200}
                  icon="🛡️"
                  accentColor="#14b8a6"
                  canAfford={credits >= 200}
                  onBuy={() => buyUpgrade('shield', 200)}
                />
              </div>
            </div>
          </ModalBackdrop>
        )}
      </AnimatePresence>
    </div>
  );
}

function WeaponTierItem({ tier, title, desc, cost, icon, canAfford, owned, onBuy }: {
  tier: number;
  title: string;
  desc: string;
  cost: number;
  icon: string;
  canAfford: boolean;
  owned: boolean;
  onBuy: () => void;
}) {
  return (
    <motion.button
      whileTap={canAfford && !owned ? { scale: 0.96 } : {}}
      disabled={!canAfford || owned}
      onClick={onBuy}
      className={`w-full p-4 rounded-xl flex items-center gap-3 transition-all ${
        owned
          ? 'bg-emerald-500/20 border border-emerald-500/40 opacity-90'
          : canAfford
            ? 'bg-slate-800/60 border border-purple-900/30 hover:border-purple-500/40 backdrop-blur-sm'
            : 'bg-slate-800/20 border border-slate-800/40 opacity-50'
      }`}
    >
      <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 bg-slate-700/50">
        {icon}
      </div>
      <div className="flex-1 text-right min-w-0">
        <h4 className="font-bold">
          Tier {tier}: {title}
        </h4>
        <p className="text-xs text-slate-400">{desc}</p>
      </div>
      {owned ? (
        <span className="text-emerald-400 font-bold text-sm">✓ נרכש</span>
      ) : (
        <span className={`font-bold text-sm px-3 py-1.5 rounded-lg ${canAfford ? 'bg-amber-500/20 text-amber-300' : 'text-slate-500'}`}>
          💰{cost}
        </span>
      )}
    </motion.button>
  );
}

function SpaceShopItem({
  title,
  desc,
  cost,
  icon,
  canAfford,
  onBuy,
  accentColor,
}: {
  title: string;
  desc: string;
  cost: number;
  icon: string;
  canAfford: boolean;
  onBuy: () => void;
  accentColor: string;
}) {
  return (
    <motion.button
      whileTap={canAfford ? { scale: 0.96 } : {}}
      disabled={!canAfford}
      onClick={onBuy}
      className={`w-full p-3.5 rounded-xl flex items-center gap-3 transition-all ${
        canAfford
          ? 'bg-slate-800/60 border border-purple-900/30 hover:border-purple-500/30 backdrop-blur-sm'
          : 'bg-slate-800/20 border border-slate-800/40 opacity-40'
      }`}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
        style={{
          background: canAfford ? `${accentColor}15` : '#1e293b',
          border: `1px solid ${canAfford ? accentColor + '30' : '#334155'}`,
        }}
      >
        {icon}
      </div>
      <div className="flex-1 text-right min-w-0">
        <h4 className="font-bold text-sm">{title}</h4>
        <p className="text-[11px] text-slate-400 truncate">{desc}</p>
      </div>
      <div
        className="font-bold text-xs px-3 py-1.5 rounded-lg whitespace-nowrap"
        style={{
          background: canAfford ? `${accentColor}15` : '#1e293b',
          color: canAfford ? accentColor : '#64748b',
          border: `1px solid ${canAfford ? accentColor + '25' : '#334155'}`,
        }}
      >
        💰{cost}
      </div>
    </motion.button>
  );
}

function drawAsteroid(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  type: (typeof ASTEROID_TYPES)[number],
  rotation: number,
  hpPct: number
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  drawGlow(ctx, 0, 0, size * 1.8, type.glow, 0.08);
  ctx.fillStyle = type.body;
  ctx.strokeStyle = type.outline;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const points = 8;
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const r = size * (0.7 + ((Math.sin(i * 3.7 + rotation * 0.1) * 0.5 + 0.5) * 0.3));
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colorAlpha(type.crater, 0.4);
  ctx.beginPath();
  ctx.arc(-size * 0.25, -size * 0.15, size * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(size * 0.15, size * 0.2, size * 0.15, 0, Math.PI * 2);
  ctx.fill();
  if (type.name === 'crystal' || type.name === 'ice') {
    ctx.fillStyle = '#fff';
    const sparkle = 0.5 + 0.5 * Math.sin(rotation * 3);
    ctx.globalAlpha = sparkle * 0.6;
    ctx.beginPath();
    ctx.arc(-size * 0.1, -size * 0.3, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(size * 0.3, size * 0.05, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (hpPct < 0.6) {
    ctx.strokeStyle = colorAlpha('#ef4444', (1 - hpPct) * 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-size * 0.3, -size * 0.1);
    ctx.lineTo(0, size * 0.1);
    ctx.lineTo(size * 0.2, -size * 0.2);
    ctx.stroke();
  }
  ctx.restore();
}
