import { useState, useEffect, useRef, useCallback, type MouseEvent as RMouseEvent, type TouchEvent as RTouchEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QuestionPanel } from '../QuestionPanel';
import { Clock, HelpCircle, ShoppingCart } from 'lucide-react';
import { socket } from '../../socket';
import {
  type Particle, type Star, type ShakeState,
  emitBurst, tickParticles,
  createStarfield, drawStarfield,
  triggerShake, tickShake,
  drawBeam, drawHPBar, drawGlow, colorAlpha,
} from './renderUtils';

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
  const [tab, setTab] = useState<'questions' | 'shop'>('questions');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gsRef = useRef(globalState);
  const starsRef = useRef<Star[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const shakeRef = useRef<ShakeState>({ intensity: 0, offsetX: 0, offsetY: 0 });
  const timeRef = useRef(0);
  const prevLasers = useRef(0);
  const playerRef = useRef(player);

  gsRef.current = globalState;
  playerRef.current = player;

  useEffect(() => {
    starsRef.current = createStarfield(160, 500, 400);
  }, []);

  const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
  const timeLeft = Math.max(0, 7 * 60 - elapsed);
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const energy = Math.floor(player?.resources || 0);
  const ore = player?.score || 0;
  const laserDmg = player?.modeState?.laserDamage || 25;
  const laserLevel = Math.floor(laserDmg / 25);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf: number;

    const nebulae = Array.from({ length: 4 }, () => ({
      x: Math.random() * 500, y: Math.random() * 400,
      r: Math.random() * 120 + 60,
      color: ['#6d28d9', '#1d4ed8', '#0f766e', '#9333ea'][Math.floor(Math.random() * 4)],
    }));

    const render = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) { raf = requestAnimationFrame(render); return; }
      const gs = gsRef.current;
      const p = playerRef.current;
      const curEnergy = Math.floor(p?.resources || 0);
      const curLaserDmg = p?.modeState?.laserDamage || 25;
      const curLaserLevel = Math.floor(curLaserDmg / 25);
      const w = canvas.width;
      const h = canvas.height;
      const sx = w / 1000;
      const sy = h / 1000;
      timeRef.current += 1 / 60;
      const t = timeRef.current;

      const shake = tickShake(shakeRef.current);
      ctx.save();
      ctx.translate(shake.x, shake.y);

      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#020210');
      bg.addColorStop(0.4, '#070720');
      bg.addColorStop(0.7, '#0a0a30');
      bg.addColorStop(1, '#020210');
      ctx.fillStyle = bg;
      ctx.fillRect(-20, -20, w + 40, h + 40);

      nebulae.forEach(n => {
        ctx.globalAlpha = 0.025 + 0.01 * Math.sin(t * 0.3 + n.x * 0.01);
        const ng = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
        ng.addColorStop(0, n.color);
        ng.addColorStop(1, 'transparent');
        ctx.fillStyle = ng;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;

      drawStarfield(ctx, starsRef.current, w, h, 0.4);

      gs?.asteroids?.forEach((a: any) => {
        const ax = a.x * sx;
        const ay = a.y * sy;
        const type = getAsteroidType(a.value);
        const size = (16 + (a.value / 150) * 14) * Math.min(sx, sy);
        const rotation = t * 0.5 + a.x * 0.01;
        const hpPct = a.hp / a.maxHp;

        drawAsteroid(ctx, ax, ay, size, type, rotation, hpPct);

        const barColor = hpPct > 0.5 ? type.glow : hpPct > 0.25 ? '#f59e0b' : '#ef4444';
        drawHPBar(ctx, ax, ay - size - 6 * sy, size * 1.6, 3 * sy, hpPct, barColor);

        ctx.fillStyle = type.glow;
        ctx.globalAlpha = 0.8;
        ctx.font = `bold ${8 * Math.min(sx, sy)}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(`${type.name === 'crystal' ? '💎' : type.name === 'ice' ? '❄️' : '⛏️'}${a.value}`, ax, ay + size + 11 * sy);
        ctx.globalAlpha = 1;
      });

      drawShip(ctx, w / 2, h - 20, sx, sy, t, curLaserLevel, curEnergy);

      const laserCount = gs?.lasers?.length || 0;
      gs?.lasers?.forEach((l: any) => {
        const color = l.color || '#a855f7';
        const beamWidth = 2 + curLaserLevel * 0.5;
        drawBeam(ctx, l.x1 * sx, l.y1 * sy, l.x2 * sx, l.y2 * sy, color, beamWidth * Math.min(sx, sy), 12);

        particlesRef.current.push(
          ...emitBurst(l.x2 * sx, l.y2 * sy, 12, 4, 0.7, color, 3, { gravity: 0.05, friction: 0.97 }),
          ...emitBurst(l.x2 * sx, l.y2 * sy, 5, 2, 0.5, '#fff', 2),
        );
        triggerShake(shakeRef.current, 4);
      });
      prevLasers.current = laserCount;

      particlesRef.current = tickParticles(ctx, particlesRef.current);

      ctx.restore();
      raf = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleCanvasClick = useCallback((e: RMouseEvent<HTMLCanvasElement> | RTouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !gsRef.current?.asteroids) return;
    if ((player?.resources || 0) < 10) return;

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

    const x = ((clientX - rect.left) / rect.width) * 1000;
    const y = ((clientY - rect.top) / rect.height) * 1000;
    let closest: any = null;
    let minDist = 80;
    gsRef.current.asteroids.forEach((a: any) => {
      const d = Math.hypot(a.x - x, a.y - y);
      if (d < minDist) { minDist = d; closest = a; }
    });

    if (closest) {
      socket.emit('action', { code: roomCode, playerId, actionType: 'shoot', targetId: closest.id });
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

  const sorted = Object.values(allPlayers || {}).sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
  const myRank = sorted.findIndex((p: any) => p.id === playerId) + 1;

  return (
    <div className="flex flex-col h-full bg-[#020210] text-white">
      {/* HUD */}
      <div className="flex justify-between items-center p-2.5 bg-black/60 backdrop-blur-sm border-b border-purple-900/20 z-10 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <Clock size={13} className="text-slate-400" />
          <span className={`font-mono text-sm font-bold ${timeLeft < 60 ? 'text-red-400 animate-pulse' : 'text-white'}`}>
            {minutes}:{seconds.toString().padStart(2, '0')}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] bg-purple-500/15 px-2.5 py-0.5 rounded-lg text-purple-300 font-bold border border-purple-500/20">
            💎 {ore}
          </span>
          <span className="text-[11px] bg-blue-500/15 px-2.5 py-0.5 rounded-lg text-blue-300 font-bold border border-blue-500/20">
            ⚡ {energy}
          </span>
          <span className="text-[11px] bg-amber-500/10 px-2.5 py-0.5 rounded-lg text-amber-300 font-bold border border-amber-500/15">
            🔫 Lv.{laserLevel}
          </span>
          <span className="text-[11px] bg-slate-800 px-2.5 py-0.5 rounded-lg text-slate-400 font-bold">
            #{myRank}
          </span>
        </div>
      </div>

      {/* Asteroid field */}
      <div className="flex-[2] relative min-h-0">
        <canvas
          ref={canvasRef} width={500} height={400}
          className="w-full h-full cursor-crosshair"
          onClick={handleCanvasClick}
          onTouchStart={handleCanvasClick}
        />
        <AnimatePresence>
          {energy < 10 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="absolute bottom-2 left-2 right-2 text-center"
            >
              <span className="text-[10px] bg-red-900/70 text-red-300 px-3 py-1.5 rounded-full font-bold border border-red-800/30 backdrop-blur-sm">
                אנרגיה נמוכה! ענה על שאלות כדי לטעון ⚡
              </span>
            </motion.div>
          )}
          {energy >= 10 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute bottom-2 left-0 right-0 text-center pointer-events-none"
            >
              <span className="text-[10px] text-purple-300/30 font-bold">
                לחץ על אסטרואידים כדי לירות (10⚡ | {laserDmg} נזק)
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-900/90 border-t border-b border-purple-900/20 flex-shrink-0 backdrop-blur-sm">
        <button
          onClick={() => setTab('questions')}
          className={`flex-1 py-2.5 text-sm font-bold flex items-center justify-center gap-2 transition-all duration-200 ${
            tab === 'questions'
              ? 'bg-purple-600/80 text-white shadow-[0_-2px_10px_rgba(147,51,234,0.2)]'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <HelpCircle size={15} /> שאלות
        </button>
        <button
          onClick={() => setTab('shop')}
          className={`flex-1 py-2.5 text-sm font-bold flex items-center justify-center gap-2 transition-all duration-200 ${
            tab === 'shop'
              ? 'bg-blue-600/80 text-white shadow-[0_-2px_10px_rgba(59,130,246,0.2)]'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <ShoppingCart size={15} /> חנות
        </button>
      </div>

      {/* Content */}
      <div className="flex-[3] overflow-y-auto min-h-0 bg-gradient-to-b from-slate-900 to-[#020210]">
        {tab === 'questions' && (
          <QuestionPanel questions={questions} onCorrect={onCorrect} onWrong={onWrong} earnLabel="+20 ⚡" compact />
        )}
        {tab === 'shop' && (
          <div className="p-3 space-y-2">
            <SpaceShopItem
              title="שדרוג לייזר"
              desc={`הגדל נזק ל-${laserDmg + 25} (כרגע: ${laserDmg})`}
              cost={200} icon="🔫" accentColor="#a855f7"
              canAfford={energy >= 200}
              onBuy={() => buyUpgrade('laser', 200)}
            />
            <SpaceShopItem
              title="מגנט"
              desc="משוך עפרות קרובות אוטומטית"
              cost={300} icon="🧲" accentColor="#3b82f6"
              canAfford={energy >= 300}
              onBuy={() => buyUpgrade('magnet', 300)}
            />
            <SpaceShopItem
              title="מגן"
              desc="הגנה מפני התנגשויות"
              cost={400} icon="🛡️" accentColor="#14b8a6"
              canAfford={energy >= 400}
              onBuy={() => buyUpgrade('shield', 400)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Asteroid sprite ──
function drawAsteroid(
  ctx: CanvasRenderingContext2D, x: number, y: number, size: number,
  type: typeof ASTEROID_TYPES[number], rotation: number, hpPct: number
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);

  // Glow
  drawGlow(ctx, 0, 0, size * 1.8, type.glow, 0.08);

  // Irregular body (polygon)
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

  // Craters
  ctx.fillStyle = colorAlpha(type.crater, 0.4);
  ctx.beginPath(); ctx.arc(-size * 0.25, -size * 0.15, size * 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(size * 0.15, size * 0.2, size * 0.15, 0, Math.PI * 2); ctx.fill();

  // Crystal/ice sparkle
  if (type.name === 'crystal' || type.name === 'ice') {
    ctx.fillStyle = '#fff';
    const sparkle = 0.5 + 0.5 * Math.sin(rotation * 3);
    ctx.globalAlpha = sparkle * 0.6;
    ctx.beginPath(); ctx.arc(-size * 0.1, -size * 0.3, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(size * 0.3, size * 0.05, 1, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Damage cracks
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

// ── Ship sprite ──
function drawShip(
  ctx: CanvasRenderingContext2D, x: number, y: number,
  sx: number, sy: number, t: number, laserLevel: number, energy: number
) {
  const s = Math.min(sx, sy);

  // Engine thruster glow
  const thrustIntensity = 0.5 + 0.5 * Math.sin(t * 10);
  drawGlow(ctx, x, y + 8 * s, 15 * s, '#3b82f6', 0.15 * thrustIntensity);
  drawGlow(ctx, x, y + 8 * s, 8 * s, '#60a5fa', 0.25 * thrustIntensity);

  // Thruster flames
  ctx.fillStyle = colorAlpha('#3b82f6', 0.5 + 0.3 * thrustIntensity);
  ctx.beginPath();
  ctx.moveTo(x - 4 * s, y + 4 * s);
  ctx.lineTo(x, y + (12 + thrustIntensity * 4) * s);
  ctx.lineTo(x + 4 * s, y + 4 * s);
  ctx.closePath();
  ctx.fill();

  // Ship body
  const shipColor = laserLevel >= 4 ? '#a855f7' : laserLevel >= 3 ? '#3b82f6' : laserLevel >= 2 ? '#14b8a6' : '#6b7280';
  ctx.fillStyle = shipColor;
  ctx.strokeStyle = colorAlpha('#fff', 0.2);
  ctx.lineWidth = 1;

  // Main hull
  ctx.beginPath();
  ctx.moveTo(x, y - 14 * s);
  ctx.lineTo(x + 8 * s, y + 4 * s);
  ctx.lineTo(x + 5 * s, y + 6 * s);
  ctx.lineTo(x - 5 * s, y + 6 * s);
  ctx.lineTo(x - 8 * s, y + 4 * s);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Wings
  ctx.fillStyle = colorAlpha(shipColor, 0.8);
  // Left wing
  ctx.beginPath();
  ctx.moveTo(x - 6 * s, y);
  ctx.lineTo(x - 16 * s, y + 6 * s);
  ctx.lineTo(x - 14 * s, y + 3 * s);
  ctx.lineTo(x - 5 * s, y - 2 * s);
  ctx.closePath();
  ctx.fill();
  // Right wing
  ctx.beginPath();
  ctx.moveTo(x + 6 * s, y);
  ctx.lineTo(x + 16 * s, y + 6 * s);
  ctx.lineTo(x + 14 * s, y + 3 * s);
  ctx.lineTo(x + 5 * s, y - 2 * s);
  ctx.closePath();
  ctx.fill();

  // Cockpit
  ctx.fillStyle = '#22d3ee';
  ctx.shadowBlur = 6;
  ctx.shadowColor = '#22d3ee';
  ctx.beginPath();
  ctx.ellipse(x, y - 6 * s, 3 * s, 4 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Weapon pods (based on laser level)
  if (laserLevel >= 2) {
    ctx.fillStyle = '#a855f7';
    ctx.shadowBlur = 4;
    ctx.shadowColor = '#a855f7';
    ctx.beginPath(); ctx.arc(x - 12 * s, y + 4 * s, 2 * s, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 12 * s, y + 4 * s, 2 * s, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Energy indicator ring
  if (energy >= 10) {
    ctx.strokeStyle = colorAlpha('#a855f7', 0.2 + 0.1 * Math.sin(t * 3));
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(x, y - 2 * s, 20 * s, 0, Math.PI * 2 * Math.min(1, energy / 100));
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// ── Shop item ──
function SpaceShopItem({ title, desc, cost, icon, canAfford, onBuy, accentColor }: {
  title: string; desc: string; cost: number; icon: string;
  canAfford: boolean; onBuy: () => void; accentColor: string;
}) {
  return (
    <motion.button
      whileTap={canAfford ? { scale: 0.96 } : {}}
      whileHover={canAfford ? { y: -1 } : {}}
      disabled={!canAfford}
      onClick={onBuy}
      className={`w-full p-3.5 rounded-xl flex items-center gap-3 transition-all ${
        canAfford
          ? 'bg-slate-800/60 border border-purple-900/30 shadow-lg hover:border-purple-500/30 backdrop-blur-sm'
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
        ⚡{cost}
      </div>
    </motion.button>
  );
}
