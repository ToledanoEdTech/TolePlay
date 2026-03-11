import { useState, useEffect, useRef, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QuestionPanel } from '../QuestionPanel';
import { TrendingUp, Snowflake, ShoppingCart, HelpCircle, Crown, Zap } from 'lucide-react';
import { socket } from '../../socket';

interface Props {
  roomCode: string;
  playerId: string;
  player: any;
  questions: any[];
  globalState: any;
  allPlayers: Record<string, any>;
}

const VAULT_TIERS = [
  { min: 0, label: 'ארגז עץ', color: '#92400e', accent: '#b45309', border: '#78350f', glow: '#d97706' },
  { min: 1000, label: 'כספת ברזל', color: '#374151', accent: '#6b7280', border: '#4b5563', glow: '#9ca3af' },
  { min: 3000, label: 'כספת זהב', color: '#854d0e', accent: '#ca8a04', border: '#a16207', glow: '#facc15' },
  { min: 6000, label: 'כספת פלטינום', color: '#3b0764', accent: '#a855f7', border: '#7e22ce', glow: '#c084fc' },
  { min: 9000, label: 'כספת יהלום', color: '#083344', accent: '#22d3ee', border: '#0e7490', glow: '#67e8f9' },
];

function getVaultTier(cash: number) {
  for (let i = VAULT_TIERS.length - 1; i >= 0; i--) {
    if (cash >= VAULT_TIERS[i].min) return VAULT_TIERS[i];
  }
  return VAULT_TIERS[0];
}

export function EconomyMarathonGame({ roomCode, playerId, player, questions, globalState, allPlayers }: Props) {
  const [tab, setTab] = useState<'questions' | 'shop'>('questions');
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef(0);
  const cash = Math.floor(player?.resources || 0);
  const multiplier = player?.modeState?.multiplier || 1;
  const isFrozen = (player?.modeState?.frozenUntil || 0) > Date.now();
  const progress = Math.min(100, (cash / 10000) * 100);
  const vault = getVaultTier(cash);

  const sorted = Object.values(allPlayers || {})
    .sort((a: any, b: any) => (b.resources || 0) - (a.resources || 0));
  const myRank = sorted.findIndex((p: any) => p.id === playerId) + 1;

  // Animated background canvas
  useEffect(() => {
    const canvas = bgCanvasRef.current;
    if (!canvas) return;
    let raf: number;

    const lines: Array<{ x: number; speed: number; height: number; color: string; phase: number }> = [];
    for (let i = 0; i < 30; i++) {
      lines.push({
        x: Math.random() * 500,
        speed: Math.random() * 0.3 + 0.1,
        height: Math.random() * 80 + 20,
        color: ['#14b8a6', '#a855f7', '#f59e0b', '#3b82f6'][Math.floor(Math.random() * 4)],
        phase: Math.random() * Math.PI * 2,
      });
    }

    const dataParticles: Array<{ x: number; y: number; vy: number; char: string; alpha: number }> = [];
    for (let i = 0; i < 40; i++) {
      dataParticles.push({
        x: Math.random() * 500, y: Math.random() * 200,
        vy: Math.random() * 0.4 + 0.1,
        char: ['0', '1', '$', '₿', '%', '↑', '↓'][Math.floor(Math.random() * 7)],
        alpha: Math.random() * 0.15 + 0.03,
      });
    }

    const render = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) { raf = requestAnimationFrame(render); return; }
      const w = canvas.width;
      const h = canvas.height;
      timeRef.current += 1 / 60;
      const t = timeRef.current;

      // Dark gradient background
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#060918');
      bg.addColorStop(0.5, '#0a1628');
      bg.addColorStop(1, '#071210');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Animated graph lines
      lines.forEach(line => {
        const y = h * 0.5;
        ctx.strokeStyle = line.color;
        ctx.globalAlpha = 0.06;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let px = 0; px < w; px += 3) {
          const val = Math.sin((px + t * line.speed * 100) * 0.02 + line.phase) * line.height;
          px === 0 ? ctx.moveTo(px, y + val) : ctx.lineTo(px, y + val);
        }
        ctx.stroke();
      });
      ctx.globalAlpha = 1;

      // Floating data characters
      ctx.font = '10px monospace';
      dataParticles.forEach(p => {
        p.y += p.vy;
        if (p.y > h) { p.y = -10; p.x = Math.random() * w; }
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = '#14b8a6';
        ctx.fillText(p.char, p.x, p.y);
      });
      ctx.globalAlpha = 1;

      // Horizontal scan line
      const scanY = (t * 30) % h;
      ctx.strokeStyle = 'rgba(20, 184, 166, 0.04)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, scanY); ctx.lineTo(w, scanY); ctx.stroke();

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

  const recentEvents = (globalState?.events || []).slice(-3).reverse();

  return (
    <div className="flex flex-col h-full text-white relative overflow-hidden">
      {/* Background canvas */}
      <canvas ref={bgCanvasRef} width={500} height={300} className="absolute inset-0 w-full h-full opacity-100" />

      {/* Frozen overlay */}
      <AnimatePresence>
        {isFrozen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center"
            style={{ background: 'radial-gradient(circle, rgba(30,58,138,0.9), rgba(15,23,42,0.95))' }}
          >
            <div className="absolute inset-0 overflow-hidden">
              {Array.from({ length: 20 }).map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute w-1 bg-blue-300/30"
                  style={{ left: `${Math.random() * 100}%`, height: `${Math.random() * 60 + 20}px`, top: `${Math.random() * 100}%` }}
                  animate={{ opacity: [0, 0.6, 0], y: [0, 30], scaleY: [1, 0.5] }}
                  transition={{ repeat: Infinity, duration: 2 + Math.random() * 2, delay: Math.random() * 2 }}
                />
              ))}
            </div>
            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 6, ease: 'linear' }}>
              <Snowflake className="w-24 h-24 text-blue-200/80" />
            </motion.div>
            <div className="absolute text-center mt-40">
              <h2 className="text-4xl font-black text-blue-100">❄️ קפוא!</h2>
              <p className="text-blue-200/70 mt-2 text-sm">מישהו הקפיא אותך...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cash Display */}
      <div className="relative z-10 p-4 text-center flex-shrink-0">
        <div className="text-[10px] text-teal-500/50 font-bold uppercase tracking-[0.2em] mb-1">מרתון כלכלי</div>
        <motion.div
          key={cash}
          initial={{ scale: 1.1, filter: 'brightness(1.5)' }}
          animate={{ scale: 1, filter: 'brightness(1)' }}
          transition={{ duration: 0.3 }}
          className="text-5xl font-black mb-3"
          style={{
            background: 'linear-gradient(135deg, #fde68a, #f59e0b, #d97706, #f59e0b, #fde68a)',
            backgroundSize: '200% 200%',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 0 20px rgba(245,158,11,0.3))',
          }}
        >
          ${cash.toLocaleString()}
        </motion.div>

        {/* Race progress path */}
        <div className="max-w-xs mx-auto mb-3">
          <div className="flex justify-between text-[10px] mb-1.5">
            <span className="text-slate-500">$0</span>
            <span className="text-amber-400 font-bold">{progress.toFixed(1)}%</span>
            <span className="text-slate-500">$10,000</span>
          </div>
          <div className="relative h-6 bg-slate-800/70 rounded-full overflow-hidden border border-slate-700/40">
            <motion.div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ background: 'linear-gradient(90deg, #14b8a6, #f59e0b, #f97316)' }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
            <motion.div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${progress}%`, background: 'linear-gradient(90deg, transparent 40%, rgba(255,255,255,0.2) 50%, transparent 60%)', backgroundSize: '200% 100%' }}
              animate={{ backgroundPosition: ['200% 0', '-200% 0'] }}
              transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
            />
            {/* Avatar on track */}
            <motion.div
              className="absolute top-1/2 -translate-y-1/2 z-10"
              animate={{ left: `${Math.min(93, progress)}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            >
              <div className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-400 to-yellow-600 border-2 border-white shadow-[0_0_10px_rgba(245,158,11,0.5)] flex items-center justify-center text-[8px] font-black">
                {(player?.name || '?').charAt(0)}
              </div>
            </motion.div>
          </div>

          {/* Vault tier indicator */}
          <motion.div
            key={vault.label}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="mt-2 flex items-center justify-center gap-2"
          >
            <div
              className="w-6 h-6 rounded-md border-2 flex items-center justify-center text-[10px]"
              style={{ background: vault.color, borderColor: vault.border, boxShadow: `0 0 8px ${vault.glow}40` }}
            >
              🔐
            </div>
            <span className="text-[10px] font-bold" style={{ color: vault.accent }}>{vault.label}</span>
          </motion.div>
        </div>

        {/* Stats chips */}
        <div className="flex justify-center gap-2">
          <motion.span
            key={multiplier}
            initial={{ scale: 1.2 }}
            animate={{ scale: 1 }}
            className="text-xs px-3 py-1 rounded-full font-bold border"
            style={{
              background: 'rgba(245,158,11,0.1)',
              borderColor: 'rgba(245,158,11,0.2)',
              color: '#f59e0b',
              boxShadow: multiplier > 1 ? `0 0 12px rgba(245,158,11,${0.1 * multiplier})` : 'none',
            }}
          >
            x{multiplier} מכפיל
          </motion.span>
          <span className="text-xs bg-indigo-500/10 px-3 py-1 rounded-full text-indigo-400 font-bold border border-indigo-500/20">
            מקום #{myRank || '?'}
          </span>
        </div>
      </div>

      {/* Leaderboard */}
      <div className="relative z-10 px-3 pb-2 flex-shrink-0">
        <div className="bg-slate-900/70 backdrop-blur-sm rounded-xl p-2.5 space-y-0.5 border border-slate-700/30">
          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider px-2 mb-1">טבלת מובילים</div>
          {sorted.slice(0, 5).map((p: any, i: number) => {
            const isMe = p.id === playerId;
            const pProgress = Math.min(100, ((p.resources || 0) / 10000) * 100);
            return (
              <motion.div
                layout
                key={p.id}
                className={`flex items-center justify-between py-1.5 px-2.5 rounded-lg text-sm transition-all ${
                  isMe ? 'bg-amber-500/10 border border-amber-500/15' : 'hover:bg-slate-800/30'
                }`}
              >
                <span className="flex items-center gap-2 flex-1 min-w-0">
                  {i === 0 && <Crown size={12} className="text-yellow-400 flex-shrink-0" />}
                  <span className={`font-bold text-xs flex-shrink-0 ${isMe ? 'text-amber-400' : 'text-slate-500'}`}>{i + 1}.</span>
                  <span className={`text-sm truncate ${isMe ? 'text-amber-200 font-bold' : 'text-slate-400'}`}>
                    {p.name}{isMe ? ' (אתה)' : ''}
                  </span>
                </span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-teal-500 to-amber-500"
                      animate={{ width: `${pProgress}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                  <span className={`font-mono font-bold text-xs ${isMe ? 'text-amber-400' : 'text-slate-500'}`}>
                    ${Math.floor(p.resources || 0).toLocaleString()}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Events log */}
      {recentEvents.length > 0 && (
        <div className="relative z-10 px-3 pb-2 flex-shrink-0">
          <AnimatePresence>
            {recentEvents.map((ev: any, i: number) => (
              <motion.div
                key={ev.time}
                initial={{ opacity: 0, x: -20, height: 0 }}
                animate={{ opacity: 1 - i * 0.3, x: 0, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="text-xs text-cyan-400 bg-cyan-500/5 rounded-lg px-3 py-1.5 mb-1 border border-cyan-500/10 backdrop-blur-sm"
              >
                {ev.type === 'freeze' ? `❄️ ${ev.by} הקפיא את כולם!` : ev.type}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Tabs */}
      <div className="relative z-10 flex bg-slate-900/80 border-t border-b border-slate-700/30 flex-shrink-0 backdrop-blur-sm">
        <button
          onClick={() => setTab('questions')}
          className={`flex-1 py-2.5 text-sm font-bold flex items-center justify-center gap-2 transition-all duration-200 ${
            tab === 'questions'
              ? 'bg-amber-600/80 text-white shadow-[0_-2px_10px_rgba(245,158,11,0.2)]'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <HelpCircle size={15} /> שאלות
        </button>
        <button
          onClick={() => setTab('shop')}
          className={`flex-1 py-2.5 text-sm font-bold flex items-center justify-center gap-2 transition-all duration-200 ${
            tab === 'shop'
              ? 'bg-teal-600/80 text-white shadow-[0_-2px_10px_rgba(20,184,166,0.2)]'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <ShoppingCart size={15} /> חנות
        </button>
      </div>

      {/* Content */}
      <div className="relative z-10 flex-1 overflow-y-auto min-h-0 bg-slate-900/90">
        {tab === 'questions' && (
          <QuestionPanel
            questions={questions} onCorrect={onCorrect} onWrong={onWrong}
            earnLabel={`+${10 * multiplier}$`} disabled={isFrozen} compact
          />
        )}
        {tab === 'shop' && (
          <div className="p-3 space-y-2">
            <HoloShopItem
              title="מכפיל רווחים"
              desc={`הכפל את הרווח ל-x${multiplier + 1}`}
              cost={300 * multiplier} currency="$"
              icon={<TrendingUp className="text-amber-400" size={18} />}
              accentColor="#f59e0b"
              canAfford={cash >= 300 * multiplier}
              onBuy={() => buyUpgrade('multiplier', 300 * multiplier)}
            />
            <HoloShopItem
              title="זירוז שאלות"
              desc="הפחת את זמן הנעילה בשגיאה"
              cost={200} currency="$"
              icon={<Zap className="text-teal-400" size={18} />}
              accentColor="#14b8a6"
              canAfford={cash >= 200}
              onBuy={() => buyUpgrade('speedup', 200)}
            />
            <HoloShopItem
              title="הקפאת מתחרים"
              desc="הקפא את כל השחקנים האחרים ל-10 שניות!"
              cost={500} currency="$"
              icon={<Snowflake className="text-blue-400" size={18} />}
              accentColor="#3b82f6"
              canAfford={cash >= 500}
              onBuy={() => buyUpgrade('freeze', 500)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function HoloShopItem({ title, desc, cost, icon, currency, canAfford, onBuy, accentColor }: {
  title: string; desc: string; cost: number; icon: ReactNode; currency: string;
  canAfford: boolean; onBuy: () => void; accentColor: string;
}) {
  return (
    <motion.button
      whileTap={canAfford ? { scale: 0.96 } : {}}
      whileHover={canAfford ? { y: -1 } : {}}
      disabled={!canAfford}
      onClick={onBuy}
      className={`w-full p-3.5 rounded-xl flex items-center gap-3 transition-all relative overflow-hidden ${
        canAfford
          ? 'bg-slate-800/60 border border-slate-600/40 shadow-lg backdrop-blur-sm'
          : 'bg-slate-800/20 border border-slate-800/40 opacity-40'
      }`}
    >
      {canAfford && (
        <motion.div
          className="absolute inset-0 opacity-[0.03]"
          style={{ background: `linear-gradient(135deg, transparent 40%, ${accentColor} 50%, transparent 60%)`, backgroundSize: '300% 300%' }}
          animate={{ backgroundPosition: ['0% 0%', '100% 100%'] }}
          transition={{ repeat: Infinity, duration: 3, ease: 'linear' }}
        />
      )}
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 relative z-10"
        style={{ background: canAfford ? `${accentColor}15` : '#1e293b', border: `1px solid ${canAfford ? accentColor + '30' : '#334155'}` }}
      >
        {icon}
      </div>
      <div className="flex-1 text-right min-w-0 relative z-10">
        <h4 className="font-bold text-sm">{title}</h4>
        <p className="text-[11px] text-slate-400 truncate">{desc}</p>
      </div>
      <div
        className="font-bold text-xs px-3 py-1.5 rounded-lg whitespace-nowrap relative z-10"
        style={{
          background: canAfford ? `${accentColor}15` : '#1e293b',
          color: canAfford ? accentColor : '#64748b',
          border: `1px solid ${canAfford ? accentColor + '25' : '#334155'}`,
        }}
      >
        {currency}{cost}
      </div>
    </motion.button>
  );
}
