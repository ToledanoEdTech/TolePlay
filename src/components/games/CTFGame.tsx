import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QuestionPanel } from '../QuestionPanel';
import { socket } from '../../socket';
import { CTF_MAP } from '../../engine/maps/ctfMap';
import { createCamera, updateCamera, isInView, isRectInView } from '../../engine/camera';
import { resolveCircleWallCollisions } from '../../engine/physics';
import { createInputState, getMoveDirection, setupKeyboardListeners } from '../../engine/input';
import { VirtualJoystick } from '../../engine/VirtualJoystick';
import {
  type Particle, type ShakeState,
  tickParticles, tickShake, drawGlow, colorAlpha, emitBurst, triggerShake,
} from './renderUtils';
import type { CameraState, Rect } from '../../engine/types';

interface Props {
  roomCode: string;
  playerId: string;
  player: any;
  questions: any[];
  globalState: any;
  allPlayers: Record<string, any>;
}

const PLAYER_RADIUS = 18;
const PLAYER_SPEED = 280;
const MAP = CTF_MAP;

export function CTFGame({ roomCode, playerId, player, questions, globalState, allPlayers }: Props) {
  const [showQuestions, setShowQuestions] = useState(false);

  const team = player?.modeState?.team || 'red';
  const energy = Math.floor(player?.resources || 0);
  const hasFlag = player?.modeState?.hasFlag;
  const isDead = (player?.modeState?.hp || 100) <= 0;
  const redScore = globalState?.redScore || 0;
  const blueScore = globalState?.blueScore || 0;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gsRef = useRef(globalState);
  const playersRef = useRef(allPlayers);
  const posRef = useRef({
    x: player?.x || (team === 'red' ? MAP.redSpawn.x : MAP.blueSpawn.x),
    y: player?.y || (team === 'red' ? MAP.redSpawn.y : MAP.blueSpawn.y),
  });
  const inputRef = useRef(createInputState());
  const cameraRef = useRef<CameraState>(createCamera());
  const camInitRef = useRef(false);
  const lastSyncRef = useRef(0);
  const particlesRef = useRef<Particle[]>([]);
  const shakeRef = useRef<ShakeState>({ intensity: 0, offsetX: 0, offsetY: 0 });
  const timeRef = useRef(0);
  const trailRef = useRef<Array<{ x: number; y: number; life: number; color: string }>>([]);
  const captureFxRef = useRef<{ team: string; x: number; y: number; t: number } | null>(null);
  const showQRef = useRef(false);
  const isDeadRef = useRef(false);
  const teamRef = useRef(team);
  const energyRef = useRef(energy);
  const movingRef = useRef(false);

  showQRef.current = showQuestions;
  isDeadRef.current = isDead;
  teamRef.current = team;
  energyRef.current = energy;
  useEffect(() => { gsRef.current = globalState; }, [globalState]);
  useEffect(() => { playersRef.current = allPlayers; }, [allPlayers]);

  useEffect(() => {
    if (player?.x !== undefined && player?.y !== undefined) {
      const dx = Math.abs(posRef.current.x - player.x);
      const dy = Math.abs(posRef.current.y - player.y);
      if (dx > 80 || dy > 80) posRef.current = { x: player.x, y: player.y };
    }
  }, [player?.x, player?.y]);

  useEffect(() => setupKeyboardListeners(inputRef.current), []);

  useEffect(() => {
    const onTagged = (data: { x: number; y: number }) => {
      particlesRef.current.push(...emitBurst(data.x, data.y, 24, 120, 0.8, '#f59e0b', 4, { gravity: 0.3, friction: 0.92 }));
      triggerShake(shakeRef.current, 12);
    };
    const onScored = (data: { team: string; x: number; y: number }) => {
      captureFxRef.current = { team: data.team, x: data.x, y: data.y, t: 0 };
      const color = data.team === 'red' ? '#ef4444' : '#3b82f6';
      particlesRef.current.push(...emitBurst(data.x, data.y, 45, 160, 1.2, color, 5, { gravity: 0.12, friction: 0.95 }));
      particlesRef.current.push(...emitBurst(data.x, data.y, 20, 100, 0.9, '#fbbf24', 4, { gravity: 0.2, friction: 0.93 }));
      triggerShake(shakeRef.current, 8);
    };
    socket.on('ctfTagged', onTagged);
    socket.on('ctfScored', onScored);
    return () => { socket.off('ctfTagged', onTagged); socket.off('ctfScored', onScored); };
  }, []);

  const onJoystickMove = useCallback((dx: number, dy: number) => {
    inputRef.current.joystickDir = { x: dx, y: dy };
    inputRef.current.joystickActive = true;
  }, []);
  const onJoystickRelease = useCallback(() => {
    inputRef.current.joystickDir = { x: 0, y: 0 };
    inputRef.current.joystickActive = false;
  }, []);

  // ══════════════════════════════════════════════════════
  // MAIN GAME LOOP — movement, camera, rendering @ 60fps
  // ══════════════════════════════════════════════════════
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
        }
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) { raf = requestAnimationFrame(loop); return; }

      const vpW = canvas.width;
      const vpH = canvas.height;
      if (vpW === 0 || vpH === 0) { raf = requestAnimationFrame(loop); return; }
      const gs = gsRef.current;
      const players = playersRef.current;
      const cam = cameraRef.current;

      // ── UPDATE ── (block movement when no energy)
      const canMove = energyRef.current > 0;
      if (!isDeadRef.current && !showQRef.current && canMove) {
        const dir = getMoveDirection(inputRef.current);
        if (dir.x !== 0 || dir.y !== 0) {
          const resolved = resolveCircleWallCollisions(
            { x: posRef.current.x + dir.x * PLAYER_SPEED * dt, y: posRef.current.y + dir.y * PLAYER_SPEED * dt },
            PLAYER_RADIUS, MAP.obstacles,
          );
          posRef.current.x = resolved.x;
          posRef.current.y = resolved.y;
          movingRef.current = true;

          if (Math.random() > 0.35) {
            trailRef.current.push({ x: posRef.current.x, y: posRef.current.y, life: 1, color: teamRef.current === 'red' ? '#ef4444' : '#3b82f6' });
          }
          if (now - lastSyncRef.current > 50) {
            socket.emit('updatePosition', { code: roomCode, playerId, x: posRef.current.x, y: posRef.current.y });
            lastSyncRef.current = now;
          }
        } else {
          movingRef.current = false;
        }
      } else {
        movingRef.current = false;
      }

      if (!camInitRef.current) {
        cam.x = posRef.current.x - vpW / 2;
        cam.y = posRef.current.y - vpH / 2;
        camInitRef.current = true;
      }
      updateCamera(cam, posRef.current, vpW, vpH, MAP.width, MAP.height, 0.06);

      // ── RENDER ──
      const shake = tickShake(shakeRef.current);
      ctx.save();
      ctx.translate(shake.x, shake.y);

      ctx.fillStyle = '#060a14';
      ctx.fillRect(0, 0, vpW, vpH);

      ctx.save();
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);

      drawFloor(ctx, cam, vpW, vpH);
      drawDivider(ctx, t);

      for (const obs of MAP.obstacles) {
        if (!isRectInView(obs, cam, vpW, vpH, 100)) continue;
        const type = (obs as any).type || 'wall';
        if (type === 'house') drawHouse(ctx, obs, t);
        else if (type === 'crate') drawCrate(ctx, obs, t);
        else if (type === 'bush') drawBushShape(ctx, obs, t);
        else drawWallRect(ctx, obs);
      }

      drawBaseHex(ctx, MAP.redFlag.x, MAP.redFlag.y, 'red', t);
      drawBaseHex(ctx, MAP.blueFlag.x, MAP.blueFlag.y, 'blue', t);

      if (gs?.redFlag && !gs.redFlag.carrier) {
        drawFlagZone(ctx, gs.redFlag.x, gs.redFlag.y, t);
        drawFlagPole(ctx, gs.redFlag.x, gs.redFlag.y, '#ef4444', t);
      }
      if (gs?.blueFlag && !gs.blueFlag.carrier) {
        drawFlagZone(ctx, gs.blueFlag.x, gs.blueFlag.y, t);
        drawFlagPole(ctx, gs.blueFlag.x, gs.blueFlag.y, '#3b82f6', t);
      }

      trailRef.current = trailRef.current.filter(tr => {
        tr.life -= dt * 1.8;
        if (tr.life <= 0) return false;
        ctx.globalAlpha = tr.life * 0.5;
        ctx.fillStyle = tr.color;
        ctx.shadowBlur = 4;
        ctx.shadowColor = tr.color;
        ctx.beginPath(); ctx.arc(tr.x, tr.y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        return true;
      });
      ctx.globalAlpha = 1;

      Object.values(players || {}).forEach((p: any) => {
        const isMe = p.id === playerId;
        const px = isMe ? posRef.current.x : p.x;
        const py = isMe ? posRef.current.y : p.y;
        if (!isInView(cam, { x: px, y: py }, 50, vpW, vpH)) return;
        const alive = (p.modeState?.hp || 100) > 0;
        if (!alive) { drawGhost(ctx, px, py); return; }
        const moving = isMe ? movingRef.current : false;
        drawCharacter(ctx, px, py, p.modeState?.team, isMe, t, p.modeState?.hasFlag, p.name, moving);
      });

      particlesRef.current = tickParticles(ctx, particlesRef.current);

      if (captureFxRef.current) {
        captureFxRef.current.t += dt;
        const cf = captureFxRef.current;
        if (cf.t < 1.5) {
          const yOff = cf.t * 80;
          const alpha = cf.t < 0.4 ? cf.t * 2.5 : cf.t > 1.2 ? (1.5 - cf.t) / 0.3 : 1;
          ctx.globalAlpha = alpha;
          ctx.fillStyle = cf.team === 'red' ? '#ef4444' : '#3b82f6';
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 5;
          ctx.font = 'bold 32px sans-serif';
          ctx.textAlign = 'center';
          ctx.strokeText('+1 נקודה!', cf.x, cf.y - yOff);
          ctx.fillText('+1 נקודה!', cf.x, cf.y - yOff);
          ctx.globalAlpha = 1;
        } else captureFxRef.current = null;
      }
      ctx.restore(); // camera

      drawMinimap(ctx, vpW, vpH, cam, players, gs, playerId);

      if (captureFxRef.current && captureFxRef.current.t < 0.2) {
        ctx.globalAlpha = (1 - captureFxRef.current.t / 0.2) * 0.35;
        ctx.fillStyle = captureFxRef.current.team === 'red' ? '#ef4444' : '#3b82f6';
        ctx.fillRect(0, 0, vpW, vpH);
        ctx.globalAlpha = 1;
      }
      ctx.restore(); // shake
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [roomCode, playerId]);

  const onCorrect = () => socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: true });
  const onWrong = () => socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: false });

  const teamBorder = team === 'red' ? 'rgba(239,68,68,0.3)' : 'rgba(59,130,246,0.3)';

  return (
    <div className="fixed inset-0 flex flex-col bg-[#060a14] text-white overflow-hidden">
      {/* ── Score HUD (Brawl Stars style) ── */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-3 px-5 bg-gradient-to-b from-black/70 via-black/30 to-transparent pointer-events-none">
        <div className="flex items-center gap-4 pointer-events-auto">
          <div className="flex items-center gap-4 bg-black/60 backdrop-blur-xl rounded-2xl px-6 py-3 border-2 border-slate-600/40 shadow-[0_4px_20px_rgba(0,0,0,0.4)]">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-red-400 to-red-600 shadow-[0_0_12px_rgba(239,68,68,0.6)] ring-2 ring-red-500/50" />
              <span className="text-2xl font-black text-red-400 drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]">{redScore}</span>
            </div>
            <span className="text-slate-500 font-black text-sm mx-1">VS</span>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-black text-blue-400 drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]">{blueScore}</span>
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 shadow-[0_0_12px_rgba(59,130,246,0.6)] ring-2 ring-blue-500/50" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 pointer-events-auto">
          <span className={`text-sm font-black px-4 py-2 rounded-xl border-2 ${
            team === 'red' ? 'bg-red-500/30 text-red-200 border-red-500/50' : 'bg-blue-500/30 text-blue-200 border-blue-500/50'
          }`}>{team === 'red' ? '🔴' : '🔵'}</span>
          <span className="text-base font-black text-amber-300 bg-amber-500/25 px-4 py-2 rounded-xl border-2 border-amber-500/40 shadow-[0_0_15px_rgba(251,191,36,0.2)]">⚡ {energy}</span>
        </div>
      </div>

      {/* ── Status banners ── */}
      <div className="absolute top-12 left-0 right-0 z-20 pointer-events-none px-4 space-y-2">
        <AnimatePresence>
          {energy <= 0 && !isDead && (
            <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }}
              className="py-2 text-center text-sm font-bold bg-amber-900/60 text-amber-300 rounded-lg border border-amber-700/40 backdrop-blur-sm"
            >⚡ נגמרה האנרגיה! לחץ על "שאלות" וענה נכון כדי לחדש</motion.div>
          )}
          {isDead && (
            <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }}
              className="py-2 text-center text-sm font-bold bg-red-900/60 text-red-300 rounded-lg border border-red-800/40 backdrop-blur-sm"
            >💀 חוסלת! ממתין להחייאה...</motion.div>
          )}
          {hasFlag && (
            <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }}
              className="py-2 text-center text-sm font-bold bg-yellow-900/60 text-yellow-300 rounded-lg border border-yellow-800/40 backdrop-blur-sm"
            ><motion.span animate={{ scale: [1, 1.05, 1] }} transition={{ repeat: Infinity, duration: 0.8 }}>🚩 יש לך את הדגל! רוץ לבסיס!</motion.span></motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Canvas ── */}
      <div className="flex-1 relative min-h-0">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        <div className="absolute bottom-4 left-4 z-10 md:hidden">
          <VirtualJoystick onMove={onJoystickMove} onRelease={onJoystickRelease} size={110} teamColor={teamBorder} />
        </div>
        <button onClick={() => setShowQuestions(!showQuestions)}
          className={`absolute bottom-4 right-4 z-10 px-4 py-3 rounded-xl font-bold text-sm shadow-lg transition-all ${
            showQuestions ? 'bg-slate-700/90 text-slate-300 border border-slate-600/50'
              : 'bg-indigo-600/90 text-white border border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.3)]'
          }`}>{showQuestions ? '🗺️ מפה' : '❓ שאלות (+⚡)'}</button>
      </div>

      {/* ── Questions modal (חלון קופץ במרכז) ── */}
      <AnimatePresence>
        {showQuestions && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-30 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowQuestions(false)}
            />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="absolute left-1/2 top-1/2 z-40 w-[min(420px,90vw)] -translate-x-1/2 -translate-y-1/2 max-h-[80vh] overflow-y-auto rounded-2xl bg-slate-900/98 backdrop-blur-xl border border-slate-600/50 shadow-[0_25px_80px_rgba(0,0,0,0.6)]"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-slate-700/50">
                <h3 className="font-bold text-lg text-white">❓ שאלות – ענה נכון וקבל +50 אנרגיה!</h3>
                <button onClick={() => setShowQuestions(false)}
                  className="p-2 rounded-xl hover:bg-slate-700/80 text-slate-400 hover:text-white transition-all"
                  title="סגור"
                >✕</button>
              </div>
              <div className="p-4">
                <QuestionPanel questions={questions} onCorrect={onCorrect} onWrong={onWrong} earnLabel="+50 ⚡" disabled={isDead} compact />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// RENDERING HELPERS (all operate in world-space coordinates)
// ═══════════════════════════════════════════════════════════

function drawFloor(ctx: CanvasRenderingContext2D, cam: CameraState, vpW: number, vpH: number) {
  const ts = MAP.tileSize;
  const sx = Math.floor(cam.x / ts);
  const sy = Math.floor(cam.y / ts);
  const ex = Math.ceil((cam.x + vpW / cam.zoom) / ts);
  const ey = Math.ceil((cam.y + vpH / cam.zoom) / ts);

  for (let ty = sy; ty <= ey; ty++) {
    for (let tx = sx; tx <= ex; tx++) {
      const wx = tx * ts, wy = ty * ts;
      if (wx < 0 || wy < 0 || wx >= MAP.width || wy >= MAP.height) continue;

      let c1 = '#1a3d1a', c2 = '#0f2a0f';
      for (const z of MAP.zones) {
        if (wx >= z.x && wx < z.x + z.w && wy >= z.y && wy < z.y + z.h) { c1 = z.color1; c2 = z.color2; break; }
      }
      const isEven = (tx + ty) % 2 === 0;
      ctx.fillStyle = isEven ? c1 : c2;
      ctx.fillRect(wx, wy, ts + 1, ts + 1);
      if (isEven && (c1 === '#1a3d1a' || c2 === '#0f2a0f')) {
        ctx.fillStyle = 'rgba(100,200,100,0.08)';
        ctx.fillRect(wx + 2, wy + 2, ts - 2, 6);
      }
    }
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 0.5;
  for (let x = sx * ts; x <= ex * ts; x += ts) {
    ctx.beginPath(); ctx.moveTo(x, sy * ts); ctx.lineTo(x, ey * ts); ctx.stroke();
  }
  for (let y = sy * ts; y <= ey * ts; y += ts) {
    ctx.beginPath(); ctx.moveTo(sx * ts, y); ctx.lineTo(ex * ts, y); ctx.stroke();
  }
}

function drawDivider(ctx: CanvasRenderingContext2D, t: number) {
  const mid = MAP.width / 2;
  const pulse = 0.08 + 0.04 * Math.sin(t * 1.5);
  const grad = ctx.createLinearGradient(mid - 80, 0, mid + 80, 0);
  grad.addColorStop(0, 'transparent');
  grad.addColorStop(0.4, `rgba(148,163,184,${0.03 + pulse})`);
  grad.addColorStop(0.5, `rgba(200,220,255,${0.06 + pulse})`);
  grad.addColorStop(0.6, `rgba(148,163,184,${0.03 + pulse})`);
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.fillRect(mid - 80, 0, 160, MAP.height);

  ctx.strokeStyle = `rgba(148,163,184,${0.2 + 0.05 * Math.sin(t * 2)})`;
  ctx.lineWidth = 3;
  ctx.setLineDash([12, 12]);
  ctx.beginPath(); ctx.moveTo(mid, 0); ctx.lineTo(mid, MAP.height); ctx.stroke();
  ctx.setLineDash([]);
}

function drawWallRect(ctx: CanvasRenderingContext2D, w: Rect) {
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(w.x + 5, w.y + 5, w.w, w.h);

  const grad = ctx.createLinearGradient(w.x, w.y, w.x, w.y + w.h);
  grad.addColorStop(0, '#5a6b7a');
  grad.addColorStop(0.4, '#3d4a5c');
  grad.addColorStop(1, '#2a3340');
  ctx.fillStyle = grad;
  ctx.fillRect(w.x, w.y, w.w, w.h);

  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#1a1f2e';
  ctx.lineWidth = 2;
  ctx.strokeRect(w.x, w.y, w.w, w.h);
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(w.x, w.y, w.w, 3);
}

function drawHouse(ctx: CanvasRenderingContext2D, r: Rect, t: number) {
  const cx = r.x + r.w / 2;
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetX = 5;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = '#8b7355';
  ctx.fillRect(r.x + 4, r.y + 4, r.w, r.h);

  const wallGrad = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
  wallGrad.addColorStop(0, '#e8d5b7');
  wallGrad.addColorStop(0.3, '#d4b896');
  wallGrad.addColorStop(1, '#b8956a');
  ctx.fillStyle = wallGrad;
  ctx.fillRect(r.x, r.y, r.w, r.h);

  ctx.fillStyle = '#8b4513';
  ctx.strokeStyle = '#5d3a1a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(r.x - 5, r.y + r.h * 0.5);
  ctx.lineTo(cx, r.y - 15);
  ctx.lineTo(r.x + r.w + 5, r.y + r.h * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = '#2a1810';
  ctx.lineWidth = 3;
  ctx.shadowBlur = 0;
  ctx.strokeRect(r.x, r.y, r.w, r.h);

  ctx.fillStyle = '#4a5568';
  ctx.fillRect(r.x + r.w * 0.35, r.y + r.h * 0.5, r.w * 0.3, r.h * 0.45);
  ctx.strokeStyle = '#2d3748';
  ctx.lineWidth = 2;
  ctx.strokeRect(r.x + r.w * 0.35, r.y + r.h * 0.5, r.w * 0.3, r.h * 0.45);
}

function drawCrate(ctx: CanvasRenderingContext2D, r: Rect, t: number) {
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#8b6914';
  ctx.fillRect(r.x + 3, r.y + 3, r.w, r.h);

  const grad = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
  grad.addColorStop(0, '#d4a84b');
  grad.addColorStop(0.5, '#b8860b');
  grad.addColorStop(1, '#8b6914');
  ctx.fillStyle = grad;
  ctx.fillRect(r.x, r.y, r.w, r.h);

  ctx.strokeStyle = '#5d4a0a';
  ctx.lineWidth = 2;
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = '#2a2005';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(r.x + r.w / 2, r.y);
  ctx.lineTo(r.x + r.w / 2, r.y + r.h);
  ctx.moveTo(r.x, r.y + r.h / 2);
  ctx.lineTo(r.x + r.w, r.y + r.h / 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawBushShape(ctx: CanvasRenderingContext2D, b: Rect, t: number) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const sway = Math.sin(t * 1.2 + cx * 0.008) * 3;

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(cx + 4, cy + 6, b.w / 2, b.h / 2.4, 0, 0, Math.PI * 2); ctx.fill();

  const baseGrad = ctx.createRadialGradient(cx - b.w * 0.2, cy - b.h * 0.2, 0, cx, cy, b.w * 0.6);
  baseGrad.addColorStop(0, '#2a5c3a');
  baseGrad.addColorStop(0.6, '#1d4a2a');
  baseGrad.addColorStop(1, '#143820');
  ctx.fillStyle = baseGrad;
  ctx.beginPath(); ctx.ellipse(cx + sway, cy, b.w / 2, b.h / 2, 0, 0, Math.PI * 2); ctx.fill();

  const lc = ['#3d7b4f', '#2d6b3f', '#236b35'];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + t * 0.15;
    const rd = Math.min(b.w, b.h) * 0.28;
    ctx.fillStyle = lc[i % 3];
    ctx.shadowColor = '#0a3018';
    ctx.shadowBlur = 2;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rd + sway, cy + Math.sin(a) * rd * 0.75, rd * 0.75, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.fillStyle = 'rgba(120,220,140,0.12)';
  ctx.beginPath(); ctx.ellipse(cx + sway - b.w * 0.12, cy - b.h * 0.18, b.w * 0.22, b.h * 0.18, 0, 0, Math.PI * 2); ctx.fill();
}

function drawBaseHex(ctx: CanvasRenderingContext2D, x: number, y: number, team: string, t: number) {
  const color = team === 'red' ? '#ef4444' : '#3b82f6';
  const dark = team === 'red' ? '#7f1d1d' : '#1e3a8a';
  const pulse = 0.5 + 0.5 * Math.sin(t * 2);

  drawGlow(ctx, x, y, 220, color, 0.08 + 0.04 * pulse);

  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 15;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = colorAlpha(dark, 0.4);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 6, r = 110;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.strokeStyle = colorAlpha(color, 0.25 + 0.15 * pulse);
  ctx.lineWidth = 2; ctx.setLineDash([10, 10]);
  ctx.beginPath(); ctx.arc(x, y, 75, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = colorAlpha(color, 0.9);
  ctx.shadowBlur = 25; ctx.shadowColor = color;
  ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('BASE', x, y + 48);
}

function drawFlagZone(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  const r = 55;
  const pulse = 0.5 + 0.5 * Math.sin(t * 2);
  ctx.strokeStyle = colorAlpha('#fff', 0.15 + 0.1 * pulse);
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 8]);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = colorAlpha('#fff', 0.03);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

function drawFlagPole(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, t: number) {
  ctx.strokeStyle = '#f1f5f9'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(x, y + 28); ctx.lineTo(x, y - 32); ctx.stroke();

  ctx.fillStyle = '#94a3b8';
  ctx.beginPath(); ctx.arc(x, y + 28, 6, 0, Math.PI * 2); ctx.fill();

  const wave = Math.sin(t * 4) * 4;
  ctx.fillStyle = color; ctx.shadowBlur = 16; ctx.shadowColor = color;
  ctx.beginPath();
  ctx.moveTo(x, y - 28);
  const fw = 30, fh = 20;
  ctx.quadraticCurveTo(x + fw * 0.5, y - 28 + wave, x + fw, y - 28 + wave * 0.5);
  ctx.lineTo(x + fw + wave, y - 28 + fh + wave * 0.3);
  ctx.quadraticCurveTo(x + fw * 0.5, y - 28 + fh - wave * 0.5, x, y - 28 + fh);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath(); ctx.arc(x + 15 + wave * 0.3, y - 18 + wave * 0.2, 6, 0, Math.PI * 2); ctx.fill();

  drawGlow(ctx, x, y + 28, 40, color, 0.2);
}

function drawCharacter(
  ctx: CanvasRenderingContext2D, x: number, y: number,
  team: string, isMe: boolean, t: number, hasFlag: boolean, name: string,
  moving: boolean,
) {
  const bob = moving ? Math.sin(t * 12) * 3 : 0;
  const tilt = moving ? Math.sin(t * 10) * 0.08 : 0;
  const drawY = y + bob;

  const main = team === 'red' ? (isMe ? '#fca5a5' : '#ef4444') : (isMe ? '#93c5fd' : '#3b82f6');
  const dark = team === 'red' ? '#991b1b' : '#1e40af';
  const outline = team === 'red' ? '#7f1d1d' : '#1e3a8a';

  ctx.save();
  ctx.translate(x, drawY);
  ctx.rotate(tilt);

  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = outline;
  ctx.beginPath(); ctx.ellipse(0, 4, 15, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;

  if (isMe) drawGlow(ctx, 0, 0, 50, team === 'red' ? '#ef4444' : '#3b82f6', 0.25);

  const bodyGrad = ctx.createRadialGradient(-4, -6, 0, 0, 0, 18);
  bodyGrad.addColorStop(0, main);
  bodyGrad.addColorStop(0.7, main);
  bodyGrad.addColorStop(1, dark);
  ctx.fillStyle = bodyGrad;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(0, 0, 13, 20, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();

  ctx.strokeStyle = dark;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-9, -5); ctx.lineTo(9, -5); ctx.stroke();

  ctx.fillStyle = '#fef08a';
  ctx.shadowBlur = 6; ctx.shadowColor = '#facc15';
  ctx.beginPath(); ctx.arc(0, -24, 11, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#1e293b';
  ctx.beginPath(); ctx.arc(-3.5, -25, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(3.5, -25, 2.5, 0, Math.PI * 2); ctx.fill();

  const swing = moving ? Math.sin(t * 10) * 7 : 0;
  ctx.strokeStyle = main; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-7, 16); ctx.lineTo(-7 + swing * 0.4, 28); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(7, 16); ctx.lineTo(7 - swing * 0.4, 28); ctx.stroke();

  if (hasFlag) {
    const fc = team === 'red' ? '#3b82f6' : '#ef4444';
    ctx.strokeStyle = '#f1f5f9'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -36); ctx.lineTo(0, 0); ctx.stroke();
    const w = Math.sin(t * 5) * 4;
    ctx.fillStyle = fc; ctx.shadowBlur = 14; ctx.shadowColor = fc;
    ctx.beginPath(); ctx.moveTo(0, -36); ctx.lineTo(18 + w, -28); ctx.lineTo(0, -20); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
  }

  if (isMe) {
    ctx.strokeStyle = colorAlpha(team === 'red' ? '#ef4444' : '#3b82f6', 0.7);
    ctx.lineWidth = 2.5; ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();

  ctx.fillStyle = isMe ? '#fff' : 'rgba(255,255,255,0.9)';
  ctx.font = `bold ${isMe ? 15 : 13}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(isMe ? `★ ${name}` : name, x, drawY - 42);
}

function drawGhost(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#64748b';
  ctx.beginPath(); ctx.ellipse(x, y, 12, 16, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.2;
  ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('💀', x, y + 6);
  ctx.globalAlpha = 1;
}

function drawMinimap(
  ctx: CanvasRenderingContext2D, vpW: number, vpH: number,
  cam: CameraState, players: Record<string, any>, gs: any, myId: string,
) {
  const mmW = 140;
  const mmH = mmW * (MAP.height / MAP.width);
  const mx = vpW - mmW - 12;
  const my = 48;
  const sx = mmW / MAP.width;
  const sy = mmH / MAP.height;

  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeStyle = 'rgba(148,163,184,0.3)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(mx - 4, my - 4, mmW + 8, mmH + 8, 6); ctx.fill(); ctx.stroke();

  ctx.fillStyle = 'rgba(239,68,68,0.08)';
  ctx.fillRect(mx, my, mmW / 2, mmH);
  ctx.fillStyle = 'rgba(59,130,246,0.08)';
  ctx.fillRect(mx + mmW / 2, my, mmW / 2, mmH);

  ctx.fillStyle = '#334155';
  for (const o of MAP.obstacles)
    ctx.fillRect(mx + o.x * sx, my + o.y * sy, Math.max(1, o.w * sx), Math.max(1, o.h * sy));

  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
  ctx.strokeRect(mx + cam.x * sx, my + cam.y * sy, (vpW / cam.zoom) * sx, (vpH / cam.zoom) * sy);

  if (gs?.redFlag) {
    ctx.fillStyle = '#ef4444'; ctx.shadowBlur = 3; ctx.shadowColor = '#ef4444';
    ctx.fillRect(mx + gs.redFlag.x * sx - 2, my + gs.redFlag.y * sy - 3, 4, 6); ctx.shadowBlur = 0;
  }
  if (gs?.blueFlag) {
    ctx.fillStyle = '#3b82f6'; ctx.shadowBlur = 3; ctx.shadowColor = '#3b82f6';
    ctx.fillRect(mx + gs.blueFlag.x * sx - 2, my + gs.blueFlag.y * sy - 3, 4, 6); ctx.shadowBlur = 0;
  }

  Object.values(players || {}).forEach((p: any) => {
    const isMe = p.id === myId;
    ctx.fillStyle = p.modeState?.team === 'red' ? '#ef4444' : '#3b82f6';
    if (isMe) { ctx.shadowBlur = 4; ctx.shadowColor = '#fff'; }
    ctx.beginPath(); ctx.arc(mx + p.x * sx, my + p.y * sy, isMe ? 3 : 2, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  });
}
