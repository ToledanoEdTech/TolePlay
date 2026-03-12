import React, { useState, useEffect, useRef, useCallback, type MouseEvent as RMouseEvent, type TouchEvent as RTouchEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QuestionPanel } from '../QuestionPanel';
import { Clock, HelpCircle, ShoppingCart, X } from 'lucide-react';
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

const VW = 1000;
const VH = 1000;
const SHIP_X = 500;
const SHIP_Y = 500;

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
  { minVal: 0, name: 'iron', body: '#6b7280', crater: '#4b5563', glow: '#9ca3af', outline: '#78716c' },
  { minVal: 70, name: 'ice', body: '#7dd3fc', crater: '#38bdf8', glow: '#67e8f9', outline: '#0ea5e9' },
  { minVal: 100, name: 'crystal', body: '#c084fc', crater: '#a855f7', glow: '#d8b4fe', outline: '#9333ea' },
];

function getAsteroidType(value: number) {
  for (let i = ASTEROID_TYPES.length - 1; i >= 0; i--) {
    if (value >= ASTEROID_TYPES[i].minVal) return ASTEROID_TYPES[i];
  }
  return ASTEROID_TYPES[0];
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
  const mouseRef = useRef({ x: SHIP_X, y: SHIP_Y });
  const keysRef = useRef({ up: false, down: false, left: false, right: false });
  const shipPosRef = useRef({ x: SHIP_X, y: SHIP_Y });
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
  const credits = player?.modeState?.credits || 0;
  const weaponTier = player?.modeState?.weaponTier || 1;
  const laserDmg = player?.modeState?.laserDamage || 25;
  const magnetRange = player?.modeState?.magnetRange || 50;

  const handleMouseMove = useCallback((e: RMouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = VW / rect.width;
    const scaleY = VH / rect.height;
    mouseRef.current = {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (['w','s','a','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)) {
        e.preventDefault();
      }
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

  useEffect(() => {
    const px = player?.x ?? SHIP_X;
    const py = player?.y ?? SHIP_Y;
    shipPosRef.current.x = px;
    shipPosRef.current.y = py;
  }, [player?.x, player?.y]);

  const handleTouchMove = useCallback((e: RTouchEvent<HTMLCanvasElement>) => {
    if (!e.touches[0]) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = VW / rect.width;
    const scaleY = VH / rect.height;
    mouseRef.current = {
      x: (e.touches[0].clientX - rect.left) * scaleX,
      y: (e.touches[0].clientY - rect.top) * scaleY,
    };
  }, []);

  const handleCanvasClick = useCallback((e: RMouseEvent<HTMLCanvasElement> | RTouchEvent<HTMLCanvasElement>) => {
    if (quizOpen || shopOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ammoCost = weaponTier === 4 ? 25 : 10;
    if ((player?.resources || 0) < ammoCost) return;

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
    const scaleX = VW / rect.width;
    const scaleY = VH / rect.height;
    const clickX = (clientX - rect.left) * scaleX;
    const clickY = (clientY - rect.top) * scaleY;
    const pos = shipPosRef.current;
    const angle = Math.atan2(clickY - pos.y, clickX - pos.x);

    muzzleFlashRef.current = { active: true, angle, intensity: 1 };
    socket.emit('action', { code: roomCode, playerId, actionType: 'shoot', aimAngle: angle });
  }, [roomCode, playerId, player?.resources, weaponTier, quizOpen, shopOpen]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    let raf: number;
    const render = (now: number) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) { raf = requestAnimationFrame(render); return; }

      const dt = Math.min(0.05, (now - prevTimeRef.current) / 1000);
      prevTimeRef.current = now;
      const t = now * 0.001;

      const gs = gsRef.current;
      const p = playerRef.current;

      if (!modalOpenRef.current) {
        const k = keysRef.current;
        const dx = (k.right ? 1 : 0) - (k.left ? 1 : 0);
        const dy = (k.down ? 1 : 0) - (k.up ? 1 : 0);
        const MOVE_SPEED = 400;
        shipPosRef.current.x = Math.max(80, Math.min(920, shipPosRef.current.x + dx * MOVE_SPEED * dt));
        shipPosRef.current.y = Math.max(80, Math.min(920, shipPosRef.current.y + dy * MOVE_SPEED * dt));
      }

      const shipX = shipPosRef.current.x;
      const shipY = shipPosRef.current.y;
      const w = canvas.width;
      const h = canvas.height;
      const sx = VW / w;
      const sy = VH / h;
      const scale = Math.min(w / VW, h / VH);
      const offsetX = (w - VW * scale) / 2;
      const offsetY = (h - VH * scale) / 2;

      const toScreen = (vx: number, vy: number) => ({
        x: vx * scale + offsetX,
        y: vy * scale + offsetY,
      });

      const shake = tickShake(shakeRef.current);
      ctx.save();
      ctx.translate(shake.x, shake.y);

      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#020210');
      bg.addColorStop(0.3, '#070720');
      bg.addColorStop(0.6, '#0a0a35');
      bg.addColorStop(1, '#020210');
      ctx.fillStyle = bg;
      ctx.fillRect(-20, -20, w + 40, h + 40);

      const scrollY = t * 30;
      drawParallaxNebulas(ctx, nebulasRef.current, w, h, t, scrollY);
      drawStarfield(ctx, starsRef.current, w, h, 0.5);

      const mouse = mouseRef.current;
      const shipAngle = Math.atan2(mouse.y - shipY, mouse.x - shipX);

      (gs?.collectibles || []).forEach((c: any) => {
        if (!seenCollectiblesRef.current.has(c.id)) {
          seenCollectiblesRef.current.add(c.id);
          const { x: cx, y: cy } = toScreen(c.x, c.y);
          const gemColor = c.value >= 100 ? '#c084fc' : c.value >= 70 ? '#67e8f9' : '#9ca3af';
          particlesRef.current.push(...emitAsteroidExplosion(cx, cy, gemColor, gemColor, 28));
          triggerShake(shakeRef.current, 6);
          floatTextsRef.current.push({ x: cx, y: cy, text: `+${c.value}`, life: 1 });
        }
      });

      gs?.asteroids?.forEach((a: any) => {
        const { x: ax, y: ay } = toScreen(a.x, a.y);
        const type = getAsteroidType(a.value);
        const size = (16 + (a.value / 150) * 14) * scale * 0.5;
        const rotation = t * 0.5 + a.x * 0.01;
        const hpPct = a.hp / a.maxHp;

        drawAsteroid(ctx, ax, ay, size, type, rotation, hpPct);

        const barColor = hpPct > 0.5 ? type.glow : hpPct > 0.25 ? '#f59e0b' : '#ef4444';
        drawHPBar(ctx, ax, ay - size - 6, size * 1.6, 3, hpPct, barColor);
      });

      (gs?.collectibles || []).forEach((c: any) => {
        const { x: cx, y: cy } = toScreen(c.x, c.y);
        const gemColor = c.value >= 100 ? '#c084fc' : c.value >= 70 ? '#67e8f9' : '#9ca3af';
        drawOreGem(ctx, cx, cy, c.value, gemColor, t, scale);
      });

      gs?.projectiles?.forEach((proj: any) => {
        const { x: px, y: py } = toScreen(proj.x, proj.y);
        if (proj.type === 'plasma') {
          drawGlow(ctx, px, py, 25 * scale, '#a855f7', 0.4);
          ctx.fillStyle = colorAlpha('#a855f7', 0.9);
          ctx.shadowBlur = 15;
          ctx.shadowColor = '#a855f7';
          ctx.beginPath();
          ctx.arc(px, py, 12 * scale, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          const color = weaponTier >= 3 ? '#60a5fa' : '#a855f7';
          drawBeam(ctx, toScreen(shipX, shipY).x, toScreen(shipX, shipY).y, px, py, color, 2 * scale, 10);
        }
      });

      drawShip(ctx, toScreen(shipX, shipY).x, toScreen(shipX, shipY).y, scale, t, weaponTier, ammo, shipAngle);

      if (muzzleFlashRef.current.active) {
        drawMuzzleFlash(ctx, toScreen(shipX, shipY).x, toScreen(shipX, shipY).y, shipAngle, muzzleFlashRef.current.intensity);
        muzzleFlashRef.current.intensity -= dt * 8;
        if (muzzleFlashRef.current.intensity <= 0) muzzleFlashRef.current.active = false;
      }

      floatTextsRef.current = floatTextsRef.current.filter(ft => {
        ft.life -= dt * 1.5;
        ft.y -= 40 * dt;
        if (ft.life <= 0) return false;
        ctx.globalAlpha = ft.life;
        ctx.fillStyle = '#22c55e';
        ctx.font = `bold ${14 * scale}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.globalAlpha = 1;
        return true;
      });

      particlesRef.current = tickParticles(ctx, particlesRef.current);

      ctx.restore();
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
        onClick={e => e.stopPropagation()}
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
          <span className="px-3 py-1.5 rounded-xl bg-amber-500/15 backdrop-blur-md border border-amber-400/25 text-amber-300 font-bold text-sm">
            T{weaponTier}
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-slate-800/60 backdrop-blur-md border border-slate-600/40 text-slate-300 font-bold text-sm">
            #{myRank}
          </span>
        </div>
      </div>

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-3 z-20 pointer-events-auto">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setQuizOpen(true)}
          className="px-6 py-3 rounded-xl font-bold flex items-center gap-2 bg-purple-600/90 hover:bg-purple-500 border border-purple-400/30 shadow-lg shadow-purple-500/20 backdrop-blur-sm"
        >
          <HelpCircle size={18} /> טרמינל / שאלות
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShopOpen(true)}
          className="px-6 py-3 rounded-xl font-bold flex items-center gap-2 bg-blue-600/90 hover:bg-blue-500 border border-blue-400/30 shadow-lg shadow-blue-500/20 backdrop-blur-sm"
        >
          <ShoppingCart size={18} /> חנות נשק
        </motion.button>
      </div>

      <AnimatePresence>
        {ammo < 10 && !quizOpen && (
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
        לחץ על המשחק ואז WASD / חצים לזוז
      </div>

      <AnimatePresence>
        {quizOpen && (
          <ModalBackdrop key="quiz-modal" onClose={() => setQuizOpen(false)}>
            <div className="p-6 pt-12 overflow-y-auto max-h-[90vh] rounded-2xl bg-slate-950 text-white border border-slate-700/50">
              <h2 className="text-xl font-bold text-center mb-4 text-white">טרמינל שאלות</h2>
              <p className="text-slate-300 text-sm text-center mb-4">תשובה נכונה = +20 ⚡ + 10 💰</p>
              <div className="min-h-[200px] relative">
                <QuestionPanel questions={questions} onCorrect={onCorrect} onWrong={onWrong} earnLabel="+20 ⚡ +10 💰" compact />
              </div>
            </div>
          </ModalBackdrop>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {shopOpen && (
          <ModalBackdrop key="shop-modal" onClose={() => setShopOpen(false)}>
            <div className="p-6 pt-12 overflow-y-auto max-h-[85vh]">
              <h2 className="text-xl font-bold text-center mb-2 text-blue-200">חנות נשק</h2>
              <p className="text-slate-400 text-sm text-center mb-4">מטבעות: {credits} 💰</p>
              <div className="space-y-3">
                <WeaponTierItem
                  tier={2}
                  title="תאומים"
                  desc="שני לייזרים מקבילים"
                  cost={200}
                  icon="🔫🔫"
                  canAfford={credits >= 200}
                  owned={weaponTier >= 2}
                  onBuy={() => buyUpgrade('weapon_tier_2', 200)}
                />
                <WeaponTierItem
                  tier={3}
                  title="פזורה"
                  desc="3 לייזרים בצורת קונוס"
                  cost={350}
                  icon="🔫🔫🔫"
                  canAfford={credits >= 350}
                  owned={weaponTier >= 3}
                  onBuy={() => buyUpgrade('weapon_tier_3', 350)}
                />
                <WeaponTierItem
                  tier={4}
                  title="פלזמה"
                  desc="פגז גדול עם נזק אזורי"
                  cost={500}
                  icon="💥"
                  canAfford={credits >= 500}
                  owned={weaponTier >= 4}
                  onBuy={() => buyUpgrade('weapon_tier_4', 500)}
                />
                <SpaceShopItem
                  title="שדרוג נזק"
                  desc={`נזק +25 (כרגע: ${laserDmg})`}
                  cost={200}
                  icon="⚔️"
                  accentColor="#a855f7"
                  canAfford={credits >= 200}
                  onBuy={() => buyUpgrade('laser', 200)}
                />
                <SpaceShopItem
                  title="מגנט"
                  desc={`משוך עפרות (טווח +50, כרגע: ${magnetRange})`}
                  cost={300}
                  icon="🧲"
                  accentColor="#3b82f6"
                  canAfford={credits >= 300}
                  onBuy={() => buyUpgrade('magnet', 300)}
                />
                <SpaceShopItem
                  title="מגן"
                  desc="הגנה מפני התנגשויות"
                  cost={400}
                  icon="🛡️"
                  accentColor="#14b8a6"
                  canAfford={credits >= 400}
                  onBuy={() => buyUpgrade('shield', 400)}
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
  tier: number; title: string; desc: string; cost: number; icon: string;
  canAfford: boolean; owned: boolean; onBuy: () => void;
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
        <h4 className="font-bold">Tier {tier}: {title}</h4>
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

function SpaceShopItem({ title, desc, cost, icon, canAfford, onBuy, accentColor }: {
  title: string; desc: string; cost: number; icon: string;
  canAfford: boolean; onBuy: () => void; accentColor: string;
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
        style={{ background: canAfford ? `${accentColor}15` : '#1e293b', border: `1px solid ${canAfford ? accentColor + '30' : '#334155'}` }}
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
  ctx: CanvasRenderingContext2D, x: number, y: number, size: number,
  type: typeof ASTEROID_TYPES[number], rotation: number, hpPct: number
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
  ctx.beginPath(); ctx.arc(-size * 0.25, -size * 0.15, size * 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(size * 0.15, size * 0.2, size * 0.15, 0, Math.PI * 2); ctx.fill();
  if (type.name === 'crystal' || type.name === 'ice') {
    ctx.fillStyle = '#fff';
    const sparkle = 0.5 + 0.5 * Math.sin(rotation * 3);
    ctx.globalAlpha = sparkle * 0.6;
    ctx.beginPath(); ctx.arc(-size * 0.1, -size * 0.3, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(size * 0.3, size * 0.05, 1, 0, Math.PI * 2); ctx.fill();
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

function drawShip(
  ctx: CanvasRenderingContext2D, x: number, y: number,
  scale: number, t: number, weaponTier: number, ammo: number, angle: number
) {
  const s = scale * 2.2;

  const thrustIntensity = 0.5 + 0.5 * Math.sin(t * 12);
  const thrustX = x - Math.cos(angle) * 14 * s;
  const thrustY = y - Math.sin(angle) * 14 * s;
  drawGlow(ctx, thrustX, thrustY, 18 * s, '#3b82f6', 0.2 * thrustIntensity);
  drawGlow(ctx, thrustX, thrustY, 10 * s, '#60a5fa', 0.3 * thrustIntensity);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  ctx.fillStyle = colorAlpha('#3b82f6', 0.5 + 0.3 * thrustIntensity);
  ctx.beginPath();
  ctx.moveTo(-5 * s, 4 * s);
  ctx.lineTo(0, (14 + thrustIntensity * 5) * s);
  ctx.lineTo(5 * s, 4 * s);
  ctx.closePath();
  ctx.fill();

  const shipColor = weaponTier >= 4 ? '#a855f7' : weaponTier >= 3 ? '#3b82f6' : weaponTier >= 2 ? '#14b8a6' : '#6b7280';
  ctx.fillStyle = shipColor;
  ctx.strokeStyle = colorAlpha('#fff', 0.2);
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.moveTo(0, -16 * s);
  ctx.lineTo(10 * s, 5 * s);
  ctx.lineTo(6 * s, 7 * s);
  ctx.lineTo(-6 * s, 7 * s);
  ctx.lineTo(-10 * s, 5 * s);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = colorAlpha(shipColor, 0.8);
  ctx.beginPath();
  ctx.moveTo(-7 * s, 0);
  ctx.lineTo(-18 * s, 7 * s);
  ctx.lineTo(-16 * s, 4 * s);
  ctx.lineTo(-6 * s, -2 * s);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(7 * s, 0);
  ctx.lineTo(18 * s, 7 * s);
  ctx.lineTo(16 * s, 4 * s);
  ctx.lineTo(6 * s, -2 * s);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#22d3ee';
  ctx.shadowBlur = 6;
  ctx.shadowColor = '#22d3ee';
  ctx.beginPath();
  ctx.ellipse(0, -8 * s, 3 * s, 4 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  if (weaponTier >= 2) {
    ctx.fillStyle = '#a855f7';
    ctx.shadowBlur = 4;
    ctx.shadowColor = '#a855f7';
    ctx.beginPath(); ctx.arc(-14 * s, 5 * s, 2.5 * s, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(14 * s, 5 * s, 2.5 * s, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }

  if (ammo >= 10) {
    ctx.strokeStyle = colorAlpha('#a855f7', 0.2 + 0.1 * Math.sin(t * 3));
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(0, -2 * s, 22 * s, 0, Math.PI * 2 * Math.min(1, ammo / 100));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}
