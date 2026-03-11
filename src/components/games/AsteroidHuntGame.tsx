import { useState, useEffect, useRef, useCallback, type MouseEvent as RMouseEvent, type TouchEvent as RTouchEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QuestionPanel } from '../QuestionPanel';
import { Clock, HelpCircle, ShoppingCart } from 'lucide-react';
import { socket } from '../../socket';

interface Props {
  roomCode: string;
  playerId: string;
  player: any;
  questions: any[];
  globalState: any;
  allPlayers: Record<string, any>;
  startTime?: number;
}

export function AsteroidHuntGame({ roomCode, playerId, player, questions, globalState, allPlayers, startTime }: Props) {
  const [tab, setTab] = useState<'questions' | 'shop'>('questions');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gsRef = useRef(globalState);
  const starsRef = useRef<Array<{ x: number; y: number; s: number; speed: number; brightness: number }>>([]);
  const explosionsRef = useRef<Array<{ x: number; y: number; particles: Array<{ x: number; y: number; vx: number; vy: number; life: number; color: string; size: number }> }>>([]);

  useEffect(() => { gsRef.current = globalState; }, [globalState]);

  useEffect(() => {
    starsRef.current = Array.from({ length: 120 }, () => ({
      x: Math.random() * 600,
      y: Math.random() * 500,
      s: Math.random() * 2 + 0.3,
      speed: Math.random() * 0.3 + 0.05,
      brightness: Math.random() * 0.7 + 0.3,
    }));
  }, []);

  const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
  const timeLeft = Math.max(0, 7 * 60 - elapsed);
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const energy = Math.floor(player?.resources || 0);
  const ore = player?.score || 0;
  const laserDmg = player?.modeState?.laserDamage || 25;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf: number;

    const render = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) { raf = requestAnimationFrame(render); return; }
      const gs = gsRef.current;
      const w = canvas.width;
      const h = canvas.height;
      const sx = w / 1000;
      const sy = h / 1000;

      // Space background
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#050510');
      grad.addColorStop(0.5, '#0a0a2e');
      grad.addColorStop(1, '#050510');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Stars
      starsRef.current.forEach(star => {
        star.y += star.speed;
        if (star.y > h) { star.y = 0; star.x = Math.random() * w; }
        ctx.globalAlpha = star.brightness;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.s, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      // Nebula effect
      const nebGrad = ctx.createRadialGradient(w * 0.7, h * 0.3, 0, w * 0.7, h * 0.3, w * 0.4);
      nebGrad.addColorStop(0, 'rgba(139, 92, 246, 0.03)');
      nebGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = nebGrad;
      ctx.fillRect(0, 0, w, h);

      // Asteroids
      const asteroidColors = ['#6b7280', '#78716c', '#71717a', '#737373'];
      gs?.asteroids?.forEach((a: any) => {
        const ax = a.x * sx;
        const ay = a.y * sy;
        const hpPct = a.hp / a.maxHp;
        const size = (18 + (a.value / 150) * 12) * Math.min(sx, sy);

        // Glow based on value
        const glowColor = a.value > 100 ? '#c084fc' : a.value > 70 ? '#60a5fa' : '#94a3b8';
        ctx.shadowBlur = 12;
        ctx.shadowColor = glowColor;

        // Body
        ctx.fillStyle = asteroidColors[Math.floor(a.value) % asteroidColors.length];
        ctx.beginPath();
        ctx.arc(ax, ay, size, 0, Math.PI * 2);
        ctx.fill();

        // Craters
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.arc(ax - size * 0.3, ay - size * 0.2, size * 0.25, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(ax + size * 0.2, ay + size * 0.3, size * 0.15, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;

        // HP bar
        const barW = size * 1.8;
        ctx.fillStyle = '#1f2937';
        ctx.fillRect(ax - barW / 2, ay - size - 8 * sy, barW, 3 * sy);
        ctx.fillStyle = hpPct > 0.5 ? '#a78bfa' : hpPct > 0.25 ? '#f59e0b' : '#ef4444';
        ctx.fillRect(ax - barW / 2, ay - size - 8 * sy, barW * hpPct, 3 * sy);

        // Value
        ctx.fillStyle = glowColor;
        ctx.font = `bold ${9 * Math.min(sx, sy)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(`💎${a.value}`, ax, ay + size + 12 * sy);
      });

      // Lasers
      gs?.lasers?.forEach((l: any) => {
        ctx.shadowBlur = 12;
        ctx.shadowColor = l.color || '#a855f7';
        ctx.strokeStyle = l.color || '#a855f7';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(l.x1 * sx, l.y1 * sy);
        ctx.lineTo(l.x2 * sx, l.y2 * sy);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Spawn explosion at hit point
        const ex = { x: l.x2 * sx, y: l.y2 * sy, particles: [] as any[] };
        for (let i = 0; i < 8; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = Math.random() * 4 + 1;
          ex.particles.push({
            x: ex.x, y: ex.y,
            vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            life: 1, color: l.color || '#a855f7', size: Math.random() * 3 + 1,
          });
        }
        explosionsRef.current.push(ex);
      });

      // Render explosions
      explosionsRef.current = explosionsRef.current.filter(exp => {
        exp.particles = exp.particles.filter(p => {
          p.x += p.vx; p.y += p.vy; p.life -= 0.04;
          if (p.life <= 0) return false;
          ctx.globalAlpha = p.life;
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
          return true;
        });
        return exp.particles.length > 0;
      });
      ctx.globalAlpha = 1;

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
    <div className="flex flex-col h-full bg-[#050510] text-white">
      {/* HUD */}
      <div className="flex justify-between items-center p-2.5 bg-black/60 backdrop-blur border-b border-purple-900/30 z-10 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <Clock size={13} className="text-slate-400" />
          <span className={`font-mono text-sm font-bold ${timeLeft < 60 ? 'text-red-400 animate-pulse' : 'text-white'}`}>
            {minutes}:{seconds.toString().padStart(2, '0')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs bg-purple-900/50 px-2.5 py-0.5 rounded-full text-purple-300 font-bold border border-purple-800/30">
            💎 {ore}
          </span>
          <span className="text-xs bg-blue-900/50 px-2.5 py-0.5 rounded-full text-blue-300 font-bold border border-blue-800/30">
            ⚡ {energy}
          </span>
          <span className="text-xs bg-slate-800 px-2.5 py-0.5 rounded-full text-slate-400 font-bold">
            #{myRank}
          </span>
        </div>
      </div>

      {/* Asteroid field */}
      <div className="flex-[2] relative min-h-0">
        <canvas
          ref={canvasRef}
          width={500}
          height={400}
          className="w-full h-full cursor-crosshair"
          onClick={handleCanvasClick}
          onTouchStart={handleCanvasClick}
        />
        {energy < 10 && (
          <div className="absolute bottom-2 left-2 right-2 text-center">
            <span className="text-[10px] bg-red-900/80 text-red-300 px-3 py-1 rounded-full font-bold">
              אנרגיה נמוכה! ענה על שאלות כדי לטעון ⚡
            </span>
          </div>
        )}
        {energy >= 10 && (
          <div className="absolute bottom-2 left-0 right-0 text-center">
            <span className="text-[10px] text-purple-300/40 font-bold pointer-events-none">
              לחץ על אסטרואידים כדי לירות (10⚡ לירייה | {laserDmg} נזק)
            </span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-900 border-t border-b border-purple-900/30 flex-shrink-0">
        <button
          onClick={() => setTab('questions')}
          className={`flex-1 py-2.5 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${
            tab === 'questions' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          <HelpCircle size={16} /> שאלות
        </button>
        <button
          onClick={() => setTab('shop')}
          className={`flex-1 py-2.5 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${
            tab === 'shop' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          <ShoppingCart size={16} /> חנות
        </button>
      </div>

      {/* Content */}
      <div className="flex-[3] overflow-y-auto min-h-0 bg-slate-900">
        {tab === 'questions' && (
          <QuestionPanel
            questions={questions}
            onCorrect={onCorrect}
            onWrong={onWrong}
            earnLabel="+20 ⚡"
            compact
          />
        )}
        {tab === 'shop' && (
          <div className="p-3 space-y-2">
            <ShopItem
              title="שדרוג לייזר"
              desc={`הגדל נזק ל-${laserDmg + 25} (כרגע: ${laserDmg})`}
              cost={200}
              icon="🔫"
              canAfford={energy >= 200}
              onBuy={() => buyUpgrade('laser', 200)}
            />
            <ShopItem
              title="מגנט"
              desc="משוך עפרות קרובות אוטומטית"
              cost={300}
              icon="🧲"
              canAfford={energy >= 300}
              onBuy={() => buyUpgrade('magnet', 300)}
            />
            <ShopItem
              title="מגן"
              desc="הגנה מפני התנגשויות"
              cost={400}
              icon="🛡️"
              canAfford={energy >= 400}
              onBuy={() => buyUpgrade('shield', 400)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ShopItem({ title, desc, cost, icon, canAfford, onBuy }: {
  title: string; desc: string; cost: number; icon: string; canAfford: boolean; onBuy: () => void;
}) {
  return (
    <motion.button
      whileTap={canAfford ? { scale: 0.96 } : {}}
      disabled={!canAfford}
      onClick={onBuy}
      className={`w-full p-3 rounded-xl flex items-center gap-3 transition-all ${
        canAfford
          ? 'bg-slate-800 border border-purple-900/30 shadow-lg hover:border-purple-500/30'
          : 'bg-slate-800/40 border border-slate-800 opacity-40'
      }`}
    >
      <div className="w-9 h-9 rounded-lg bg-slate-700 flex items-center justify-center text-lg flex-shrink-0">{icon}</div>
      <div className="flex-1 text-right min-w-0">
        <h4 className="font-bold text-sm">{title}</h4>
        <p className="text-[11px] text-slate-400 truncate">{desc}</p>
      </div>
      <div className={`font-bold text-xs px-2.5 py-1 rounded-lg whitespace-nowrap ${
        canAfford ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-700 text-slate-500'
      }`}>
        ⚡{cost}
      </div>
    </motion.button>
  );
}
