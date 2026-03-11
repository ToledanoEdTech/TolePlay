import { useState, useEffect, useRef, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { QuestionPanel } from '../QuestionPanel';
import { Shield, Wrench, Heart, Crosshair, ShoppingCart, HelpCircle, Zap } from 'lucide-react';
import { socket } from '../../socket';

interface Props {
  roomCode: string;
  playerId: string;
  player: any;
  questions: any[];
  globalState: any;
  allPlayers: Record<string, any>;
}

export function ZombieDefenseGame({ roomCode, playerId, player, questions, globalState, allPlayers }: Props) {
  const [tab, setTab] = useState<'questions' | 'shop'>('questions');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gsRef = useRef(globalState);
  const particlesRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; life: number; color: string }>>([]);

  useEffect(() => { gsRef.current = globalState; }, [globalState]);

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
      const s = Math.min(w, h) / 1000;

      ctx.fillStyle = '#0a0a1a';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 1000; i += 80) {
        ctx.beginPath(); ctx.moveTo(i * s, 0); ctx.lineTo(i * s, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * s); ctx.lineTo(w, i * s); ctx.stroke();
      }

      const bx = 500 * s, by = 500 * s;

      // Base rings
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.1)';
      ctx.lineWidth = 1;
      for (let r = 100; r <= 400; r += 100) {
        ctx.beginPath(); ctx.arc(bx, by, r * s, 0, Math.PI * 2); ctx.stroke();
      }

      // Base
      const gradient = ctx.createRadialGradient(bx, by, 10 * s, bx, by, 55 * s);
      gradient.addColorStop(0, '#3b82f6');
      gradient.addColorStop(1, 'rgba(59, 130, 246, 0.1)');
      ctx.fillStyle = gradient;
      ctx.beginPath(); ctx.arc(bx, by, 55 * s, 0, Math.PI * 2); ctx.fill();

      ctx.shadowBlur = 30; ctx.shadowColor = '#3b82f6';
      ctx.fillStyle = '#1e40af';
      ctx.beginPath(); ctx.arc(bx, by, 25 * s, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;

      ctx.fillStyle = '#fff';
      ctx.font = `bold ${10 * s}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('BASE', bx, by);

      // Turrets
      gs?.turrets?.forEach((t: any) => {
        const tx = t.x * s, ty = t.y * s;
        ctx.fillStyle = '#374151';
        ctx.fillRect(tx - 10 * s, ty - 10 * s, 20 * s, 20 * s);
        ctx.fillStyle = '#22d3ee';
        ctx.shadowBlur = 8; ctx.shadowColor = '#22d3ee';
        ctx.beginPath(); ctx.arc(tx, ty, 5 * s, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;

        ctx.strokeStyle = 'rgba(34, 211, 238, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(tx, ty, 150 * s, 0, Math.PI * 2); ctx.stroke();
      });

      // Zombies
      gs?.zombies?.forEach((z: any) => {
        const zx = z.x * s, zy = z.y * s;
        ctx.shadowBlur = 12; ctx.shadowColor = '#22c55e';
        ctx.fillStyle = '#16a34a';
        ctx.beginPath(); ctx.arc(zx, zy, 12 * s, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;

        // Eyes
        ctx.fillStyle = '#ef4444';
        ctx.beginPath(); ctx.arc(zx - 4 * s, zy - 3 * s, 2 * s, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(zx + 4 * s, zy - 3 * s, 2 * s, 0, Math.PI * 2); ctx.fill();

        const barW = 18 * s;
        ctx.fillStyle = '#1f2937';
        ctx.fillRect(zx - barW / 2, zy - 18 * s, barW, 3 * s);
        ctx.fillStyle = z.hp / z.maxHp > 0.5 ? '#22c55e' : z.hp / z.maxHp > 0.25 ? '#eab308' : '#ef4444';
        ctx.fillRect(zx - barW / 2, zy - 18 * s, barW * (z.hp / z.maxHp), 3 * s);
      });

      // Lasers
      gs?.lasers?.forEach((l: any) => {
        ctx.shadowBlur = 8; ctx.shadowColor = l.color || '#22d3ee';
        ctx.strokeStyle = l.color || '#22d3ee';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(l.x1 * s, l.y1 * s); ctx.lineTo(l.x2 * s, l.y2 * s); ctx.stroke();
        ctx.shadowBlur = 0;

        for (let i = 0; i < 3; i++) {
          particlesRef.current.push({
            x: l.x2 * s, y: l.y2 * s,
            vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6,
            life: 1, color: l.color || '#22d3ee'
          });
        }
      });

      // Particles
      particlesRef.current = particlesRef.current.filter(p => {
        p.x += p.vx; p.y += p.vy; p.life -= 0.04;
        if (p.life <= 0) return false;
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fill();
        return true;
      });
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(raf);
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

  const baseHp = globalState?.baseHealth ?? 0;
  const maxHp = globalState?.maxBaseHealth ?? 2000;
  const wave = globalState?.wave ?? 1;
  const zombieCount = globalState?.zombies?.length ?? 0;
  const turretCount = globalState?.turrets?.length ?? 0;

  return (
    <div className="flex flex-col h-full bg-[#0a0a1a] text-white">
      {/* HUD */}
      <div className="bg-slate-900/90 backdrop-blur p-3 border-b border-slate-800 z-10 flex-shrink-0">
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-400" />
            <span className="text-xs font-bold text-blue-300 uppercase tracking-wider">הגנת זומבים</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-red-900/60 px-2 py-0.5 rounded-full text-red-300 font-bold">
              🧟 {zombieCount}
            </span>
            <span className="text-xs bg-indigo-900/60 px-2 py-0.5 rounded-full text-indigo-300 font-bold">
              גל {wave}
            </span>
            <span className="text-xs bg-cyan-900/60 px-2 py-0.5 rounded-full text-cyan-300 font-bold">
              🗼 {turretCount}
            </span>
            <span className="text-sm font-mono font-bold text-yellow-400 bg-yellow-900/30 px-3 py-0.5 rounded-full">
              💰 {Math.floor(player?.resources || 0)}
            </span>
          </div>
        </div>
        <div className="relative h-4 bg-slate-800 rounded-full overflow-hidden">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              background: baseHp / maxHp > 0.5
                ? 'linear-gradient(90deg, #22c55e, #3b82f6)'
                : baseHp / maxHp > 0.25
                  ? 'linear-gradient(90deg, #eab308, #f97316)'
                  : 'linear-gradient(90deg, #ef4444, #dc2626)'
            }}
            animate={{ width: `${(baseHp / maxHp) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white drop-shadow-md">
            {Math.floor(baseHp)} / {maxHp}
          </span>
        </div>
      </div>

      {/* Game canvas */}
      <div className="flex-[2] relative min-h-0">
        <canvas
          ref={canvasRef}
          width={500}
          height={350}
          className="w-full h-full"
        />
        {baseHp < maxHp * 0.25 && baseHp > 0 && (
          <motion.div
            animate={{ opacity: [0.1, 0.3, 0.1] }}
            transition={{ repeat: Infinity, duration: 1 }}
            className="absolute inset-0 border-4 border-red-500 pointer-events-none rounded"
          />
        )}
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-900 border-t border-b border-slate-800 flex-shrink-0">
        <button
          onClick={() => setTab('questions')}
          className={`flex-1 py-2.5 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${
            tab === 'questions' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <HelpCircle size={16} /> שאלות
        </button>
        <button
          onClick={() => setTab('shop')}
          className={`flex-1 py-2.5 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${
            tab === 'shop' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
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
            earnLabel="+10 💰"
            compact
          />
        )}
        {tab === 'shop' && (
          <div className="p-3 space-y-2">
            <ShopButton
              title="בנה צריח"
              desc="צריח אוטומטי שיורה בזומבים"
              cost={500}
              icon={<Crosshair className="text-cyan-400" size={18} />}
              canAfford={(player?.resources || 0) >= 500}
              onBuy={() => buyUpgrade('turret', 500)}
            />
            <ShopButton
              title="תקן בסיס"
              desc="שחזר 500 נקודות חיים לבסיס"
              cost={100}
              icon={<Wrench className="text-blue-400" size={18} />}
              canAfford={(player?.resources || 0) >= 100}
              onBuy={() => buyUpgrade('repair', 100)}
            />
            <ShopButton
              title="ריפוי קבוצתי"
              desc="מרפא את כל חברי הקבוצה"
              cost={300}
              icon={<Heart className="text-pink-400" size={18} />}
              canAfford={(player?.resources || 0) >= 300}
              onBuy={() => buyUpgrade('heal', 300)}
            />
            <ShopButton
              title="שדרוג נזק"
              desc="הגדל את הנזק של הירייה שלך"
              cost={200}
              icon={<Zap className="text-yellow-400" size={18} />}
              canAfford={(player?.resources || 0) >= 200}
              onBuy={() => buyUpgrade('damage', 200)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ShopButton({ title, desc, cost, icon, canAfford, onBuy }: {
  title: string; desc: string; cost: number; icon: ReactNode; canAfford: boolean; onBuy: () => void;
}) {
  return (
    <motion.button
      whileTap={canAfford ? { scale: 0.96 } : {}}
      disabled={!canAfford}
      onClick={onBuy}
      className={`w-full p-3 rounded-xl flex items-center gap-3 transition-all ${
        canAfford
          ? 'bg-slate-800 hover:bg-slate-750 border border-slate-700 shadow-lg'
          : 'bg-slate-800/40 border border-slate-800 opacity-40'
      }`}
    >
      <div className="w-9 h-9 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="flex-1 text-right min-w-0">
        <h4 className="font-bold text-sm">{title}</h4>
        <p className="text-[11px] text-slate-400 truncate">{desc}</p>
      </div>
      <div className={`font-bold text-xs px-2.5 py-1 rounded-lg whitespace-nowrap ${
        canAfford ? 'bg-yellow-500/20 text-yellow-400' : 'bg-slate-700 text-slate-500'
      }`}>
        💰 {cost}
      </div>
    </motion.button>
  );
}
