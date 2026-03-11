import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QuestionPanel } from '../QuestionPanel';
import { Swords, Shield, ZapOff, Clock, Heart } from 'lucide-react';
import { socket } from '../../socket';
import {
  type Particle, type ShakeState,
  emitBurst, emitDirectional, tickParticles,
  triggerShake, tickShake, drawGlow, drawBeam, colorAlpha,
} from './renderUtils';

interface Props {
  roomCode: string;
  playerId: string;
  player: any;
  questions: any[];
  globalState: any;
  allPlayers: Record<string, any>;
}

export function BossBattleGame({ roomCode, playerId, player, questions, globalState, allPlayers }: Props) {
  const [attackFlash, setAttackFlash] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const shakeRef = useRef<ShakeState>({ intensity: 0, offsetX: 0, offsetY: 0 });
  const timeRef = useRef(0);
  const prevBossHp = useRef(0);
  const prevLasers = useRef(0);
  const gsRef = useRef(globalState);
  const allPlayersRef = useRef(allPlayers);

  gsRef.current = globalState;
  allPlayersRef.current = allPlayers;

  const isBoss = player?.modeState?.isBoss;
  const isDisabled = (player?.modeState?.disabledUntil || 0) > Date.now();
  const timeLeft = globalState?.timeLeft ?? 600;
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  const bossPlayer = Object.values(allPlayers || {}).find((p: any) => p.modeState?.isBoss) as any;
  const heroes = Object.values(allPlayers || {}).filter((p: any) => !p.modeState?.isBoss);

  const bossHp = bossPlayer?.modeState?.hp ?? 0;
  const bossMaxHp = bossPlayer?.modeState?.maxHp ?? 1;
  const bossHpPct = Math.max(0, bossHp / bossMaxHp);
  const bossShields = bossPlayer?.modeState?.shields ?? 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf: number;

    const mountains: Array<{ points: number[]; color: string }> = [];
    for (let layer = 0; layer < 3; layer++) {
      const pts: number[] = [];
      for (let x = 0; x <= 500; x += 20) {
        pts.push(120 + layer * 25 + Math.sin(x * 0.03 + layer * 2) * (30 - layer * 8) + Math.sin(x * 0.01 + layer) * 20);
      }
      mountains.push({ points: pts, color: ['#1a0f2e', '#0f172a', '#0c1222'][layer] });
    }

    const render = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) { raf = requestAnimationFrame(render); return; }
      const w = canvas.width;
      const h = canvas.height;
      timeRef.current += 1 / 60;
      const t = timeRef.current;

      const gs = gsRef.current;
      const bp = Object.values(allPlayersRef.current || {}).find((p: any) => p.modeState?.isBoss) as any;
      const curHp = bp?.modeState?.hp ?? 0;
      const curMaxHp = bp?.modeState?.maxHp ?? 1;
      const curHpPct = Math.max(0, curHp / curMaxHp);
      const curShields = bp?.modeState?.shields ?? 0;

      const shake = tickShake(shakeRef.current);
      ctx.save();
      ctx.translate(shake.x, shake.y);

      const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
      skyGrad.addColorStop(0, '#0a0015');
      skyGrad.addColorStop(0.3, '#150a2e');
      skyGrad.addColorStop(0.6, '#0f172a');
      skyGrad.addColorStop(1, '#0c1222');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(-20, -20, w + 40, h + 40);

      if (Math.random() < 0.003) {
        ctx.fillStyle = 'rgba(167,139,250,0.05)';
        ctx.fillRect(0, 0, w, h);
      }

      for (let i = 0; i < 5; i++) {
        const cx = ((i * 120 + t * 5) % (w + 200)) - 100;
        const cy = 20 + i * 12;
        ctx.globalAlpha = 0.04;
        ctx.fillStyle = '#6d28d9';
        ctx.beginPath(); ctx.arc(cx, cy, 50 + i * 10, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + 30, cy - 5, 35 + i * 8, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      mountains.forEach((m, layer) => {
        const offset = t * (1 + layer * 0.5) * 0.5;
        ctx.fillStyle = m.color;
        ctx.beginPath();
        ctx.moveTo(0, h);
        m.points.forEach((y, i) => {
          ctx.lineTo(i * 20 + (offset % 20), y);
        });
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
      });

      ctx.fillStyle = '#0c1222';
      ctx.fillRect(0, h * 0.75, w, h * 0.25);

      for (let i = 0; i < 8; i++) {
        const px = (i * 67 + t * 15) % w;
        const py = h - 20 - ((t * 20 + i * 40) % 80);
        const alpha = 0.15 + 0.1 * Math.sin(t * 2 + i);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = curHpPct < 0.3 ? '#ef4444' : '#a855f7';
        ctx.beginPath();
        ctx.arc(px, py, 2 + Math.sin(t + i) * 1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      const bx = w / 2;
      const by = h * 0.48;
      drawBossCreature(ctx, bx, by, t, curHpPct, curShields);

      const laserCount = gs?.lasers?.length || 0;
      gs?.lasers?.forEach((l: any) => {
        const color = l.blocked ? '#3b82f6' : '#ef4444';
        drawBeam(ctx, l.x1 * (w / 1000), l.y1 * (h / 1000), bx, by, color, 3, 15);
        particlesRef.current.push(
          ...emitBurst(bx, by, 8, 4, 0.6, color, 3, { type: 'spark', friction: 0.95 })
        );
        if (!l.blocked) triggerShake(shakeRef.current, 6);
        else triggerShake(shakeRef.current, 3);
      });
      if (laserCount > prevLasers.current && laserCount > 0) {
        triggerShake(shakeRef.current, 8);
      }
      prevLasers.current = laserCount;

      if (curHp < prevBossHp.current) {
        particlesRef.current.push(
          ...emitBurst(bx, by, 15, 5, 0.8, '#ef4444', 4, { gravity: 0.1, friction: 0.97 })
        );
      }
      prevBossHp.current = curHp;

      particlesRef.current = tickParticles(ctx, particlesRef.current);

      ctx.restore();
      raf = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(raf);
  }, []);

  const onCorrect = () => {
    socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: true });
  };
  const onWrong = () => {
    socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: false });
  };

  const attack = () => {
    if ((player?.resources || 0) <= 0) return;
    socket.emit('action', { code: roomCode, playerId, actionType: 'attack' });
    setAttackFlash(true);
    setTimeout(() => setAttackFlash(false), 400);
  };

  const buyShield = () => {
    socket.emit('buyUpgrade', { code: roomCode, playerId, upgradeId: 'shield', cost: 50 });
  };

  const disableHero = (targetId: string) => {
    socket.emit('buyUpgrade', { code: roomCode, playerId, upgradeId: 'disable', cost: 100, targetId });
  };

  return (
    <div className={`flex flex-col h-full text-white ${
      isBoss
        ? 'bg-gradient-to-b from-red-950 via-slate-900 to-[#070b18]'
        : 'bg-gradient-to-b from-indigo-950 via-slate-900 to-[#070b18]'
    }`}>
      {/* Disabled overlay */}
      <AnimatePresence>
        {isDisabled && !isBoss && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center"
            style={{ background: 'radial-gradient(circle, rgba(88,28,135,0.9), rgba(15,23,42,0.95))' }}
          >
            <div className="text-center">
              <motion.div animate={{ rotate: [0, 15, -15, 0] }} transition={{ repeat: Infinity, duration: 0.4 }}>
                <ZapOff className="w-20 h-20 text-purple-300 mx-auto mb-4" />
              </motion.div>
              <h2 className="text-3xl font-black text-purple-200">⚡ משותק!</h2>
              <p className="text-purple-300/70 mt-2 text-sm">הבוס שיתק אותך...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Attack flash */}
      <AnimatePresence>
        {attackFlash && (
          <motion.div
            initial={{ opacity: 0.4 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 pointer-events-none z-40"
            style={{ background: 'radial-gradient(circle at 50% 40%, rgba(239,68,68,0.3), transparent 70%)' }}
          />
        )}
      </AnimatePresence>

      {/* Timer & Status bar */}
      <div className="flex justify-between items-center p-3 bg-black/50 backdrop-blur-sm border-b border-slate-700/40 flex-shrink-0 z-10">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-slate-400" />
          <span className={`font-mono font-bold text-sm ${timeLeft < 60 ? 'text-red-400 animate-pulse' : 'text-white'}`}>
            {minutes}:{seconds.toString().padStart(2, '0')}
          </span>
        </div>
        <span className={`text-xs font-bold px-3 py-1 rounded-full border ${
          isBoss
            ? 'bg-red-500/15 text-red-400 border-red-500/25'
            : 'bg-blue-500/15 text-blue-400 border-blue-500/25'
        }`}>
          {isBoss ? '🐉 אתה הבוס!' : '⚔️ גיבור'}
        </span>
        <span className="text-sm font-bold text-yellow-400 bg-yellow-500/10 px-3 py-1 rounded-full border border-yellow-500/20">
          {isBoss ? `🛡️ ${bossShields}` : `⚔️ ${Math.floor(player?.resources || 0)}`}
        </span>
      </div>

      {/* Boss Visual Canvas */}
      <div className="flex-shrink-0 relative" style={{ height: '200px' }}>
        <canvas ref={canvasRef} width={500} height={200} className="w-full h-full" />

        {/* Boss HP Bar overlay */}
        <div className="absolute top-2 left-3 right-3">
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-red-400 font-bold drop-shadow">{bossPlayer?.name || 'Boss'}</span>
            <span className="text-slate-300 drop-shadow">{Math.max(0, Math.floor(bossHp)).toLocaleString()} / {Math.floor(bossMaxHp).toLocaleString()}</span>
          </div>
          <div className="h-5 bg-black/50 rounded-full overflow-hidden border border-red-900/40 backdrop-blur-sm">
            <motion.div
              className="h-full rounded-full relative overflow-hidden"
              style={{ background: bossHpPct > 0.5 ? 'linear-gradient(90deg, #dc2626, #f97316)' : bossHpPct > 0.25 ? 'linear-gradient(90deg, #f97316, #eab308)' : 'linear-gradient(90deg, #ef4444, #dc2626)' }}
              animate={{ width: `${bossHpPct * 100}%` }}
              transition={{ duration: 0.3 }}
            >
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                animate={{ x: ['-100%', '100%'] }}
                transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
              />
            </motion.div>
          </div>
          {bossShields > 0 && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -right-1 -top-1 bg-blue-500 text-white text-[10px] font-black w-6 h-6 rounded-full flex items-center justify-center shadow-[0_0_10px_rgba(59,130,246,0.5)] border border-blue-400"
            >
              {bossShields}
            </motion.div>
          )}
        </div>
      </div>

      {/* Heroes row */}
      <div className="flex-shrink-0 px-3 pb-2">
        {!isBoss && heroes.length > 0 && (
          <div className="flex justify-center gap-1.5 flex-wrap">
            {heroes.map((h: any) => (
              <div
                key={h.id}
                className={`text-center px-2 py-1.5 rounded-lg transition-all ${
                  h.id === playerId ? 'bg-blue-500/15 ring-1 ring-blue-400/40' : 'bg-slate-800/30'
                }`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold mx-auto border-2 ${
                  h.id === playerId
                    ? 'bg-gradient-to-br from-blue-500 to-blue-700 border-blue-400/50 shadow-[0_0_10px_rgba(59,130,246,0.3)]'
                    : 'bg-slate-700 border-slate-600'
                }`}>
                  {h.name.charAt(0)}
                </div>
                <div className="text-[9px] mt-0.5 text-slate-400 truncate max-w-[50px]">{h.name}</div>
                {h.resources > 0 && (
                  <div className="text-[8px] text-yellow-400 font-bold mt-0.5">⚔️{Math.floor(h.resources)}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Boss view: hero targets */}
        {isBoss && heroes.length > 0 && (
          <div>
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2 text-center">שתק גיבור (100 נק')</div>
            <div className="flex justify-center gap-2 flex-wrap">
              {heroes.map((h: any) => (
                <motion.button
                  key={h.id}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => disableHero(h.id)}
                  disabled={(player?.resources || 0) < 100 || (h.modeState?.disabledUntil || 0) > Date.now()}
                  className="flex items-center gap-1.5 bg-slate-800/60 px-3 py-1.5 rounded-lg text-xs border border-purple-900/30 disabled:opacity-30 hover:border-purple-500/40 transition-all backdrop-blur-sm"
                >
                  <ZapOff size={12} className="text-purple-400" />
                  <span>{h.name}</span>
                  {(h.modeState?.disabledUntil || 0) > Date.now() && (
                    <span className="text-purple-400 text-[10px]">⏳</span>
                  )}
                </motion.button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="px-4 pb-2 flex-shrink-0">
        {!isBoss && (player?.resources || 0) > 0 && (
          <motion.button
            whileTap={{ scale: 0.92 }}
            whileHover={{ scale: 1.01 }}
            onClick={attack}
            className="w-full py-4 rounded-2xl text-xl font-black text-white flex items-center justify-center gap-3 transition-all relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, #dc2626, #ea580c, #dc2626)',
              boxShadow: '0 0 30px rgba(239,68,68,0.25), inset 0 1px rgba(255,255,255,0.1)',
            }}
          >
            <motion.div
              className="absolute inset-0"
              style={{ background: 'linear-gradient(90deg, transparent 30%, rgba(255,255,255,0.1) 50%, transparent 70%)', backgroundSize: '200% 100%' }}
              animate={{ backgroundPosition: ['200% 0', '-200% 0'] }}
              transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
            />
            <Swords size={24} className="relative z-10" />
            <span className="relative z-10">תקוף! ({Math.floor(player.resources)} נזק)</span>
          </motion.button>
        )}
        {!isBoss && (player?.resources || 0) === 0 && (
          <div className="w-full py-3 bg-slate-800/50 rounded-2xl text-center text-slate-500 text-sm font-bold border border-slate-700/40">
            ענה על שאלות כדי לצבור כוח התקפה ⚔️
          </div>
        )}
        {isBoss && (player?.resources || 0) >= 50 && (
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={buyShield}
            className="w-full py-3 rounded-2xl text-lg font-bold text-white flex items-center justify-center gap-3 relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
              boxShadow: '0 0 20px rgba(59,130,246,0.25)',
            }}
          >
            <Shield size={20} /> הפעל מגן (50 נק')
          </motion.button>
        )}
      </div>

      {/* Questions */}
      <div className="flex-1 overflow-y-auto min-h-0 bg-slate-900/80 border-t border-slate-700/40">
        <div className="p-2 text-center">
          <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
            {isBoss ? 'ענה כדי לצבור נקודות הגנה' : 'ענה כדי לצבור כוח התקפה'}
          </span>
        </div>
        <QuestionPanel
          questions={questions} onCorrect={onCorrect} onWrong={onWrong}
          earnLabel={isBoss ? '+20 🛡️' : '+50 ⚔️'} disabled={isDisabled} compact
        />
      </div>
    </div>
  );
}

// ── Boss creature drawn on canvas ──
function drawBossCreature(
  ctx: CanvasRenderingContext2D, x: number, y: number,
  t: number, hpPct: number, shields: number
) {
  const breathe = Math.sin(t * 1.8) * 3;
  const isEnraged = hpPct < 0.3;
  const damageFlash = isEnraged && Math.sin(t * 12) > 0.7;

  ctx.save();
  ctx.translate(x, y + breathe);

  // Shadow beneath
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 55, 50, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  // Shield barrier
  if (shields > 0) {
    ctx.save();
    ctx.strokeStyle = colorAlpha('#3b82f6', 0.3 + 0.15 * Math.sin(t * 3));
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(0, 0, 65 + Math.sin(t * 2) * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    drawGlow(ctx, 0, 0, 75, '#3b82f6', 0.06 + 0.03 * Math.sin(t * 2));
    ctx.restore();
  }

  // Enrage glow
  if (isEnraged) {
    drawGlow(ctx, 0, 0, 80, '#ef4444', 0.12 + 0.06 * Math.sin(t * 4));
  }

  // ── Body (large central mass) ──
  const bodyColor = damageFlash ? '#ef4444' : (isEnraged ? '#7f1d1d' : '#4c1d95');
  const bodyGrad = ctx.createRadialGradient(0, -5, 5, 0, 10, 45);
  bodyGrad.addColorStop(0, damageFlash ? '#fca5a5' : (isEnraged ? '#991b1b' : '#6d28d9'));
  bodyGrad.addColorStop(1, bodyColor);
  ctx.fillStyle = bodyGrad;

  ctx.beginPath();
  ctx.moveTo(-35, -15);
  ctx.quadraticCurveTo(-40, -35, -20, -40);
  ctx.quadraticCurveTo(0, -48, 20, -40);
  ctx.quadraticCurveTo(40, -35, 35, -15);
  ctx.quadraticCurveTo(42, 20, 30, 40);
  ctx.quadraticCurveTo(0, 55, -30, 40);
  ctx.quadraticCurveTo(-42, 20, -35, -15);
  ctx.closePath();
  ctx.fill();

  // Armor plating
  ctx.strokeStyle = colorAlpha(isEnraged ? '#ef4444' : '#8b5cf6', 0.4);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-25, -10);
  ctx.quadraticCurveTo(0, -5, 25, -10);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-20, 15);
  ctx.quadraticCurveTo(0, 20, 20, 15);
  ctx.stroke();

  // ── Horns ──
  ctx.fillStyle = isEnraged ? '#991b1b' : '#1e1b4b';
  // Left horn
  ctx.beginPath();
  ctx.moveTo(-18, -38);
  ctx.quadraticCurveTo(-30, -60 + breathe * 0.5, -25, -65);
  ctx.quadraticCurveTo(-15, -55, -12, -38);
  ctx.closePath();
  ctx.fill();
  // Right horn
  ctx.beginPath();
  ctx.moveTo(18, -38);
  ctx.quadraticCurveTo(30, -60 + breathe * 0.5, 25, -65);
  ctx.quadraticCurveTo(15, -55, 12, -38);
  ctx.closePath();
  ctx.fill();

  // Horn tips glow
  ctx.fillStyle = isEnraged ? '#ef4444' : '#a78bfa';
  ctx.shadowBlur = 8;
  ctx.shadowColor = isEnraged ? '#ef4444' : '#a78bfa';
  ctx.beginPath(); ctx.arc(-25, -63, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(25, -63, 3, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;

  // ── Eyes ──
  const eyeGlow = isEnraged ? '#ef4444' : '#f59e0b';
  const eyeOpen = 0.7 + 0.3 * Math.abs(Math.sin(t * 0.5));

  ctx.save();
  // Left eye socket
  ctx.fillStyle = '#0f0520';
  ctx.beginPath(); ctx.ellipse(-13, -22, 8, 5 * eyeOpen, 0, 0, Math.PI * 2); ctx.fill();
  // Left eye glow
  ctx.shadowBlur = 12;
  ctx.shadowColor = eyeGlow;
  ctx.fillStyle = eyeGlow;
  ctx.beginPath(); ctx.ellipse(-13, -22, 4, 3 * eyeOpen, 0, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  // Left pupil
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(-12, -22, 1.5 * eyeOpen, 0, Math.PI * 2); ctx.fill();

  // Right eye socket
  ctx.fillStyle = '#0f0520';
  ctx.beginPath(); ctx.ellipse(13, -22, 8, 5 * eyeOpen, 0, 0, Math.PI * 2); ctx.fill();
  // Right eye glow
  ctx.shadowBlur = 12;
  ctx.shadowColor = eyeGlow;
  ctx.fillStyle = eyeGlow;
  ctx.beginPath(); ctx.ellipse(13, -22, 4, 3 * eyeOpen, 0, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  // Right pupil
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(14, -22, 1.5 * eyeOpen, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // ── Mouth (opens when enraged) ──
  const mouthOpen = isEnraged ? 6 + Math.sin(t * 3) * 3 : 2;
  ctx.fillStyle = '#0f0520';
  ctx.beginPath();
  ctx.moveTo(-12, -5);
  ctx.quadraticCurveTo(0, -5 + mouthOpen, 12, -5);
  ctx.quadraticCurveTo(0, -5 + mouthOpen * 2, -12, -5);
  ctx.closePath();
  ctx.fill();

  // Teeth
  if (mouthOpen > 3) {
    ctx.fillStyle = '#e2e8f0';
    for (let i = -8; i <= 8; i += 4) {
      ctx.beginPath();
      ctx.moveTo(i - 1.5, -5);
      ctx.lineTo(i, -5 + mouthOpen * 0.6);
      ctx.lineTo(i + 1.5, -5);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ── Arms/claws ──
  const armSwing = Math.sin(t * 2) * 8;
  ctx.strokeStyle = bodyColor;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  // Left arm
  ctx.beginPath();
  ctx.moveTo(-34, 5);
  ctx.quadraticCurveTo(-52, 10 + armSwing, -48, 30 + armSwing);
  ctx.stroke();
  // Left claws
  ctx.strokeStyle = isEnraged ? '#ef4444' : '#a78bfa';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-48, 30 + armSwing); ctx.lineTo(-55, 35 + armSwing); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-48, 30 + armSwing); ctx.lineTo(-52, 38 + armSwing); ctx.stroke();

  // Right arm
  ctx.strokeStyle = bodyColor;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(34, 5);
  ctx.quadraticCurveTo(52, 10 - armSwing, 48, 30 - armSwing);
  ctx.stroke();
  // Right claws
  ctx.strokeStyle = isEnraged ? '#ef4444' : '#a78bfa';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(48, 30 - armSwing); ctx.lineTo(55, 35 - armSwing); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(48, 30 - armSwing); ctx.lineTo(52, 38 - armSwing); ctx.stroke();

  ctx.restore();
}
