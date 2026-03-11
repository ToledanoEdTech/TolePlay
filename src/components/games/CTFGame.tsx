import { useState, useEffect, useRef, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QuestionPanel } from '../QuestionPanel';
import { HelpCircle, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';
import { socket } from '../../socket';

interface Props {
  roomCode: string;
  playerId: string;
  player: any;
  questions: any[];
  globalState: any;
  allPlayers: Record<string, any>;
}

export function CTFGame({ roomCode, playerId, player, questions, globalState, allPlayers }: Props) {
  const [tab, setTab] = useState<'game' | 'questions'>('game');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gsRef = useRef(globalState);
  const playersRef = useRef(allPlayers);
  const posRef = useRef({ x: player?.x || 500, y: player?.y || 500 });
  const keysRef = useRef({ up: false, down: false, left: false, right: false });
  const lastSyncRef = useRef(0);
  const trailRef = useRef<Array<{ x: number; y: number; life: number; team: string }>>([]);

  useEffect(() => { gsRef.current = globalState; }, [globalState]);
  useEffect(() => { playersRef.current = allPlayers; }, [allPlayers]);

  // Sync position from server
  useEffect(() => {
    if (player?.x !== undefined && player?.y !== undefined) {
      const dx = Math.abs(posRef.current.x - player.x);
      const dy = Math.abs(posRef.current.y - player.y);
      if (dx > 50 || dy > 50) {
        posRef.current = { x: player.x, y: player.y };
      }
    }
  }, [player?.x, player?.y]);

  const team = player?.modeState?.team || 'red';
  const energy = Math.floor(player?.resources || 0);
  const hasFlag = player?.modeState?.hasFlag;
  const isDead = (player?.modeState?.hp || 100) <= 0;
  const redScore = globalState?.redScore || 0;
  const blueScore = globalState?.blueScore || 0;

  // Movement loop
  useEffect(() => {
    let raf: number;
    const speed = 4;

    const move = () => {
      const k = keysRef.current;
      let dx = 0, dy = 0;
      if (k.up) dy -= speed;
      if (k.down) dy += speed;
      if (k.left) dx -= speed;
      if (k.right) dx += speed;

      if ((dx !== 0 || dy !== 0) && !isDead) {
        posRef.current.x = Math.max(15, Math.min(985, posRef.current.x + dx));
        posRef.current.y = Math.max(15, Math.min(985, posRef.current.y + dy));

        // Trail effect
        if (Math.random() > 0.7) {
          trailRef.current.push({
            x: posRef.current.x, y: posRef.current.y,
            life: 1, team
          });
        }

        const now = Date.now();
        if (now - lastSyncRef.current > 50) {
          socket.emit('updatePosition', {
            code: roomCode, playerId,
            x: posRef.current.x, y: posRef.current.y
          });
          lastSyncRef.current = now;
        }
      }
      raf = requestAnimationFrame(move);
    };
    move();
    return () => cancelAnimationFrame(raf);
  }, [roomCode, playerId, isDead, team]);

  // Keyboard controls
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const map: Record<string, string> = {
        'w': 'up', 'ArrowUp': 'up',
        's': 'down', 'ArrowDown': 'down',
        'a': 'left', 'ArrowLeft': 'left',
        'd': 'right', 'ArrowRight': 'right',
      };
      const dir = map[e.key];
      if (dir) keysRef.current = { ...keysRef.current, [dir]: true };
    };
    const up = (e: KeyboardEvent) => {
      const map: Record<string, string> = {
        'w': 'up', 'ArrowUp': 'up',
        's': 'down', 'ArrowDown': 'down',
        'a': 'left', 'ArrowLeft': 'left',
        'd': 'right', 'ArrowRight': 'right',
      };
      const dir = map[e.key];
      if (dir) keysRef.current = { ...keysRef.current, [dir]: false };
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  // Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf: number;

    const render = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) { raf = requestAnimationFrame(render); return; }
      const gs = gsRef.current;
      const players = playersRef.current;
      const w = canvas.width;
      const h = canvas.height;
      const sx = w / 1000;
      const sy = h / 1000;

      // Field
      ctx.fillStyle = '#0c1222';
      ctx.fillRect(0, 0, w, h);

      // Red half gradient
      const redGrad = ctx.createLinearGradient(0, 0, w / 2, 0);
      redGrad.addColorStop(0, 'rgba(220, 38, 38, 0.08)');
      redGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = redGrad;
      ctx.fillRect(0, 0, w / 2, h);

      // Blue half gradient
      const blueGrad = ctx.createLinearGradient(w, 0, w / 2, 0);
      blueGrad.addColorStop(0, 'rgba(37, 99, 235, 0.08)');
      blueGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = blueGrad;
      ctx.fillRect(w / 2, 0, w / 2, h);

      // Center line
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 4]);
      ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
      ctx.setLineDash([]);

      // Grass pattern
      ctx.strokeStyle = '#0f1d2f';
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= 1000; i += 60) {
        ctx.beginPath(); ctx.moveTo(i * sx, 0); ctx.lineTo(i * sx, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * sy); ctx.lineTo(w, i * sy); ctx.stroke();
      }

      // Red base
      ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
      ctx.beginPath(); ctx.arc(100 * sx, 500 * sy, 65 * sx, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(100 * sx, 500 * sy, 65 * sx, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(239, 68, 68, 0.5)';
      ctx.font = `bold ${10 * sx}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText('🔴 BASE', 100 * sx, 505 * sy);

      // Blue base
      ctx.fillStyle = 'rgba(59, 130, 246, 0.12)';
      ctx.beginPath(); ctx.arc(900 * sx, 500 * sy, 65 * sx, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(900 * sx, 500 * sy, 65 * sx, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(59, 130, 246, 0.5)';
      ctx.fillText('🔵 BASE', 900 * sx, 505 * sy);

      // Flags (only if not being carried)
      if (gs?.redFlag && !gs.redFlag.carrier) {
        drawFlagOnCanvas(ctx, gs.redFlag.x * sx, gs.redFlag.y * sy, '#ef4444', sx);
      }
      if (gs?.blueFlag && !gs.blueFlag.carrier) {
        drawFlagOnCanvas(ctx, gs.blueFlag.x * sx, gs.blueFlag.y * sy, '#3b82f6', sx);
      }

      // Trail effect
      trailRef.current = trailRef.current.filter(t => {
        t.life -= 0.03;
        if (t.life <= 0) return false;
        ctx.globalAlpha = t.life * 0.3;
        ctx.fillStyle = t.team === 'red' ? '#ef4444' : '#3b82f6';
        ctx.beginPath(); ctx.arc(t.x * sx, t.y * sy, 4 * sx, 0, Math.PI * 2); ctx.fill();
        return true;
      });
      ctx.globalAlpha = 1;

      // Players
      Object.values(players || {}).forEach((p: any) => {
        const isMe = p.id === playerId;
        const px = isMe ? posRef.current.x * sx : p.x * sx;
        const py = isMe ? posRef.current.y * sy : p.y * sy;
        const alive = (p.modeState?.hp || 100) > 0;
        const pTeam = p.modeState?.team;

        if (!alive) {
          ctx.globalAlpha = 0.2;
          ctx.fillStyle = '#475569';
          ctx.beginPath(); ctx.arc(px, py, 10 * sx, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
          return;
        }

        // Player shadow
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(px, py + 12 * sy, 10 * sx, 4 * sy, 0, 0, Math.PI * 2); ctx.fill();

        // Player body
        const color = pTeam === 'red' ? (isMe ? '#f87171' : '#dc2626') : (isMe ? '#60a5fa' : '#2563eb');
        ctx.shadowBlur = isMe ? 20 : 8;
        ctx.shadowColor = pTeam === 'red' ? '#ef4444' : '#3b82f6';
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(px, py, (isMe ? 13 : 10) * sx, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;

        // Flag indicator on carrier
        if (p.modeState?.hasFlag) {
          const flagColor = pTeam === 'red' ? '#3b82f6' : '#ef4444';
          drawFlagOnCanvas(ctx, px + 8 * sx, py - 18 * sy, flagColor, sx * 0.7);
        }

        // Name
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${isMe ? 9 : 8}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(isMe ? `★ ${p.name}` : p.name, px, py - 16 * sy);
      });

      raf = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(raf);
  }, [playerId, team]);

  const onCorrect = () => {
    socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: true });
  };
  const onWrong = () => {
    socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: false });
  };

  const startMove = (dir: string) => { keysRef.current = { ...keysRef.current, [dir]: true }; };
  const stopMove = (dir: string) => { keysRef.current = { ...keysRef.current, [dir]: false }; };
  const stopAll = () => { keysRef.current = { up: false, down: false, left: false, right: false }; };

  return (
    <div className="flex flex-col h-full bg-[#070b18] text-white">
      {/* Score bar */}
      <div className="flex items-center justify-between p-2.5 bg-black/60 border-b border-slate-800 z-10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
            <span className="text-2xl font-black text-red-400">{redScore}</span>
          </div>
          <span className="text-slate-600 font-bold text-sm">VS</span>
          <div className="flex items-center gap-1">
            <span className="text-2xl font-black text-blue-400">{blueScore}</span>
            <div className="w-4 h-4 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
          </div>
        </div>
        <span className={`text-xs font-bold px-3 py-1 rounded-full border ${
          team === 'red'
            ? 'bg-red-500/20 text-red-400 border-red-500/30'
            : 'bg-blue-500/20 text-blue-400 border-blue-500/30'
        }`}>
          {team === 'red' ? 'קבוצה אדומה' : 'קבוצה כחולה'}
        </span>
        <span className="text-sm font-bold text-yellow-400 bg-yellow-900/30 px-2.5 py-0.5 rounded-full">
          ⚡ {energy}
        </span>
      </div>

      {/* Status messages */}
      <AnimatePresence>
        {isDead && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-red-900/60 text-center py-2 text-sm text-red-300 font-bold border-b border-red-800/50 flex-shrink-0"
          >
            💀 חוסלת! ממתין להחייאה...
          </motion.div>
        )}
        {hasFlag && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-yellow-900/60 text-center py-2 text-sm text-yellow-300 font-bold border-b border-yellow-800/50 flex-shrink-0"
          >
            <motion.span animate={{ scale: [1, 1.1, 1] }} transition={{ repeat: Infinity, duration: 0.8 }}>
              🏳️ יש לך את הדגל! רוץ לבסיס שלך!
            </motion.span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tab bar */}
      <div className="flex bg-slate-900 border-b border-slate-800 flex-shrink-0">
        <button
          onClick={() => setTab('game')}
          className={`flex-1 py-2 text-sm font-bold transition-colors ${
            tab === 'game' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          🗺️ מפה ותנועה
        </button>
        <button
          onClick={() => setTab('questions')}
          className={`flex-1 py-2 text-sm font-bold transition-colors ${
            tab === 'questions' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <HelpCircle size={14} className="inline mr-1" /> שאלות (+אנרגיה)
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden min-h-0">
        {tab === 'game' && (
          <div className="flex flex-col h-full">
            <div className="flex-1 relative min-h-0">
              <canvas ref={canvasRef} width={500} height={400} className="w-full h-full" />
            </div>

            {/* D-pad */}
            <div className="p-3 bg-slate-900 border-t border-slate-800 flex-shrink-0">
              <div className="flex justify-center" onMouseLeave={stopAll} onTouchEnd={stopAll}>
                <div className="grid grid-cols-3 gap-1.5 w-40">
                  <div />
                  <DPadBtn dir="up" onStart={startMove} onStop={stopMove} icon={<ArrowUp size={22} />} />
                  <div />
                  <DPadBtn dir="left" onStart={startMove} onStop={stopMove} icon={<ArrowLeft size={22} />} />
                  <div className="w-[52px] h-[52px] bg-slate-800/50 rounded-xl" />
                  <DPadBtn dir="right" onStart={startMove} onStop={stopMove} icon={<ArrowRight size={22} />} />
                  <div />
                  <DPadBtn dir="down" onStart={startMove} onStop={stopMove} icon={<ArrowDown size={22} />} />
                  <div />
                </div>
              </div>
            </div>
          </div>
        )}
        {tab === 'questions' && (
          <div className="h-full overflow-y-auto">
            <QuestionPanel
              questions={questions}
              onCorrect={onCorrect}
              onWrong={onWrong}
              earnLabel="+50 ⚡"
              disabled={isDead}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function DPadBtn({ dir, onStart, onStop, icon }: {
  dir: string; onStart: (d: string) => void; onStop: (d: string) => void; icon: ReactNode;
}) {
  return (
    <button
      onTouchStart={(e) => { e.preventDefault(); onStart(dir); }}
      onTouchEnd={(e) => { e.preventDefault(); onStop(dir); }}
      onMouseDown={() => onStart(dir)}
      onMouseUp={() => onStop(dir)}
      onMouseLeave={() => onStop(dir)}
      className="w-[52px] h-[52px] bg-slate-700 hover:bg-slate-600 active:bg-slate-500 rounded-xl flex items-center justify-center select-none touch-none transition-colors shadow-md active:shadow-sm"
    >
      {icon}
    </button>
  );
}

function drawFlagOnCanvas(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, scale: number) {
  ctx.save();
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y + 12 * scale); ctx.lineTo(x, y - 12 * scale); ctx.stroke();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - 12 * scale);
  ctx.lineTo(x + 14 * scale, y - 6 * scale);
  ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
