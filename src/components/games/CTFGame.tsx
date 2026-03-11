import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QuestionPanel } from '../QuestionPanel';
import { socket } from '../../socket';
import { CTF_MAP } from '../../engine/maps/ctfMap';
import { createCamera, updateCamera, isInView } from '../../engine/camera';
import { resolveCircleWallCollisions } from '../../engine/physics';
import { createInputState, getMoveDirection, setupKeyboardListeners } from '../../engine/input';
import { VirtualJoystick } from '../../engine/VirtualJoystick';
import {
  type Particle, type ShakeState,
  tickParticles, tickShake, drawGlow, colorAlpha,
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

const PLAYER_RADIUS = 14;
const PLAYER_SPEED = 200;
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
  const showQRef = useRef(false);
  const isDeadRef = useRef(false);
  const teamRef = useRef(team);

  showQRef.current = showQuestions;
  isDeadRef.current = isDead;
  teamRef.current = team;
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

      // ── UPDATE ──
      if (!isDeadRef.current && !showQRef.current) {
        const dir = getMoveDirection(inputRef.current);
        if (dir.x !== 0 || dir.y !== 0) {
          const resolved = resolveCircleWallCollisions(
            { x: posRef.current.x + dir.x * PLAYER_SPEED * dt, y: posRef.current.y + dir.y * PLAYER_SPEED * dt },
            PLAYER_RADIUS, MAP.walls,
          );
          posRef.current.x = resolved.x;
          posRef.current.y = resolved.y;

          if (Math.random() > 0.5) {
            trailRef.current.push({ x: posRef.current.x, y: posRef.current.y, life: 1, color: teamRef.current === 'red' ? '#ef4444' : '#3b82f6' });
          }
          if (now - lastSyncRef.current > 50) {
            socket.emit('updatePosition', { code: roomCode, playerId, x: posRef.current.x, y: posRef.current.y });
            lastSyncRef.current = now;
          }
        }
      }

      if (!camInitRef.current) {
        cam.x = posRef.current.x - vpW / 2;
        cam.y = posRef.current.y - vpH / 2;
        camInitRef.current = true;
      }
      updateCamera(cam, posRef.current, vpW, vpH, MAP.width, MAP.height, 0.1);

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

      for (const wall of MAP.walls) {
        if (isInView(cam, { x: wall.x + wall.w / 2, y: wall.y + wall.h / 2 }, 60, vpW, vpH))
          drawWallRect(ctx, wall);
      }
      for (const bush of MAP.bushes) {
        if (isInView(cam, { x: bush.x + bush.w / 2, y: bush.y + bush.h / 2 }, 50, vpW, vpH))
          drawBushShape(ctx, bush, t);
      }

      drawBaseHex(ctx, MAP.redFlag.x, MAP.redFlag.y, 'red', t);
      drawBaseHex(ctx, MAP.blueFlag.x, MAP.blueFlag.y, 'blue', t);

      if (gs?.redFlag && !gs.redFlag.carrier) drawFlagPole(ctx, gs.redFlag.x, gs.redFlag.y, '#ef4444', t);
      if (gs?.blueFlag && !gs.blueFlag.carrier) drawFlagPole(ctx, gs.blueFlag.x, gs.blueFlag.y, '#3b82f6', t);

      trailRef.current = trailRef.current.filter(tr => {
        tr.life -= dt * 2;
        if (tr.life <= 0) return false;
        ctx.globalAlpha = tr.life * 0.3;
        ctx.fillStyle = tr.color;
        ctx.beginPath(); ctx.arc(tr.x, tr.y, 3, 0, Math.PI * 2); ctx.fill();
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
        drawCharacter(ctx, px, py, p.modeState?.team, isMe, t, p.modeState?.hasFlag, p.name);
      });

      particlesRef.current = tickParticles(ctx, particlesRef.current);
      ctx.restore(); // camera

      drawMinimap(ctx, vpW, vpH, cam, players, gs, playerId);
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
    <div className="flex flex-col h-full bg-[#060a14] text-white relative">
      {/* ── Score HUD ── */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-2.5 px-4 bg-gradient-to-b from-black/80 via-black/40 to-transparent pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md rounded-xl px-3 py-1.5 border border-slate-700/30">
            <div className="w-4 h-4 rounded-full bg-gradient-to-br from-red-400 to-red-600 shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
            <span className="text-xl font-black text-red-400">{redScore}</span>
            <span className="text-slate-600 font-bold text-[10px] mx-1">VS</span>
            <span className="text-xl font-black text-blue-400">{blueScore}</span>
            <div className="w-4 h-4 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
          </div>
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
            team === 'red' ? 'bg-red-500/20 text-red-300 border-red-500/30' : 'bg-blue-500/20 text-blue-300 border-blue-500/30'
          }`}>{team === 'red' ? '🔴' : '🔵'}</span>
          <span className="text-sm font-bold text-yellow-400 bg-yellow-500/15 px-2.5 py-1 rounded-full border border-yellow-500/25">⚡ {energy}</span>
        </div>
      </div>

      {/* ── Status banners ── */}
      <div className="absolute top-12 left-0 right-0 z-20 pointer-events-none px-4 space-y-2">
        <AnimatePresence>
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

      {/* ── Questions overlay ── */}
      <AnimatePresence>
        {showQuestions && (
          <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="absolute bottom-0 left-0 right-0 z-30 max-h-[65vh] overflow-y-auto bg-slate-900/95 backdrop-blur-xl rounded-t-2xl border-t border-slate-700/50 shadow-[0_-10px_50px_rgba(0,0,0,0.5)]"
          >
            <div className="flex justify-center pt-2 pb-1"><div className="w-10 h-1 rounded-full bg-slate-600" /></div>
            <QuestionPanel questions={questions} onCorrect={onCorrect} onWrong={onWrong} earnLabel="+50 ⚡" disabled={isDead} compact />
          </motion.div>
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

      let c1 = '#0d1420', c2 = '#0f1724';
      for (const z of MAP.zones) {
        if (wx >= z.x && wx < z.x + z.w && wy >= z.y && wy < z.y + z.h) { c1 = z.color1; c2 = z.color2; break; }
      }
      ctx.fillStyle = (tx + ty) % 2 === 0 ? c1 : c2;
      ctx.fillRect(wx, wy, ts + 1, ts + 1);
    }
  }

  ctx.strokeStyle = 'rgba(148,163,184,0.02)';
  ctx.lineWidth = 0.5;
  for (let x = sx * ts; x <= ex * ts; x += ts) {
    ctx.beginPath(); ctx.moveTo(x, sy * ts); ctx.lineTo(x, ey * ts); ctx.stroke();
  }
  for (let y = sy * ts; y <= ey * ts; y += ts) {
    ctx.beginPath(); ctx.moveTo(sx * ts, y); ctx.lineTo(ex * ts, y); ctx.stroke();
  }
}

function drawDivider(ctx: CanvasRenderingContext2D, _t: number) {
  const mid = MAP.width / 2;
  const grad = ctx.createLinearGradient(mid - 30, 0, mid + 30, 0);
  grad.addColorStop(0, 'transparent');
  grad.addColorStop(0.5, 'rgba(148,163,184,0.06)');
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.fillRect(mid - 30, 0, 60, MAP.height);

  ctx.strokeStyle = 'rgba(148,163,184,0.15)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);
  ctx.beginPath(); ctx.moveTo(mid, 0); ctx.lineTo(mid, MAP.height); ctx.stroke();
  ctx.setLineDash([]);
}

function drawWallRect(ctx: CanvasRenderingContext2D, w: Rect) {
  const d = 5;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(w.x + d, w.y + d, w.w, w.h);

  const grad = ctx.createLinearGradient(w.x, w.y, w.x, w.y + w.h);
  grad.addColorStop(0, '#2a3548'); grad.addColorStop(1, '#1a2435');
  ctx.fillStyle = grad;
  ctx.fillRect(w.x, w.y, w.w, w.h);

  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(w.x, w.y, w.w, 3);
  ctx.fillRect(w.x, w.y, 3, w.h);
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(w.x, w.y + w.h - 2, w.w, 2);
  ctx.fillRect(w.x + w.w - 2, w.y, 2, w.h);

  if (w.w > 40 || w.h > 40) {
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 0.5;
    const bH = 16, bW = 24;
    for (let y = w.y; y < w.y + w.h; y += bH) {
      const off = (Math.floor((y - w.y) / bH) % 2) * (bW / 2);
      for (let x = w.x + off; x < w.x + w.w; x += bW) ctx.strokeRect(x, y, bW, bH);
    }
  }
}

function drawBushShape(ctx: CanvasRenderingContext2D, b: Rect, t: number) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const sway = Math.sin(t * 1.2 + cx * 0.01) * 2;

  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(cx + 3, cy + 4, b.w / 2, b.h / 2.5, 0, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = '#1a4a2a';
  ctx.beginPath(); ctx.ellipse(cx + sway, cy, b.w / 2, b.h / 2, 0, 0, Math.PI * 2); ctx.fill();

  const lc = ['#2d6b3f', '#236b35', '#1d5e2d'];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + t * 0.2;
    const rd = Math.min(b.w, b.h) * 0.25;
    ctx.fillStyle = lc[i % 3];
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rd + sway, cy + Math.sin(a) * rd * 0.7, rd * 0.7, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = 'rgba(100,200,100,0.08)';
  ctx.beginPath(); ctx.ellipse(cx + sway - b.w * 0.1, cy - b.h * 0.15, b.w * 0.25, b.h * 0.2, 0, 0, Math.PI * 2); ctx.fill();
}

function drawBaseHex(ctx: CanvasRenderingContext2D, x: number, y: number, team: string, t: number) {
  const color = team === 'red' ? '#ef4444' : '#3b82f6';
  const dark = team === 'red' ? '#991b1b' : '#1e40af';
  const pulse = 0.5 + 0.5 * Math.sin(t * 2);

  drawGlow(ctx, x, y, 100, color, 0.04 + 0.02 * pulse);

  ctx.fillStyle = colorAlpha(dark, 0.25);
  ctx.strokeStyle = colorAlpha(color, 0.3);
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 6, r = 70;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();

  ctx.strokeStyle = colorAlpha(color, 0.15 + 0.1 * pulse);
  ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
  ctx.beginPath(); ctx.arc(x, y, 50, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = colorAlpha(color, 0.5);
  ctx.shadowBlur = 12; ctx.shadowColor = color;
  ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = colorAlpha(color, 0.4);
  ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('BASE', x, y + 32);
}

function drawFlagPole(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, t: number) {
  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x, y + 20); ctx.lineTo(x, y - 22); ctx.stroke();

  ctx.fillStyle = '#94a3b8';
  ctx.beginPath(); ctx.arc(x, y + 20, 4, 0, Math.PI * 2); ctx.fill();

  const wave = Math.sin(t * 4) * 3;
  ctx.fillStyle = color; ctx.shadowBlur = 10; ctx.shadowColor = color;
  ctx.beginPath();
  ctx.moveTo(x, y - 20);
  const fw = 22, fh = 14;
  ctx.quadraticCurveTo(x + fw * 0.5, y - 20 + wave, x + fw, y - 20 + wave * 0.5);
  ctx.lineTo(x + fw + wave, y - 20 + fh + wave * 0.3);
  ctx.quadraticCurveTo(x + fw * 0.5, y - 20 + fh - wave * 0.5, x, y - 20 + fh);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath(); ctx.arc(x + 11 + wave * 0.3, y - 13 + wave * 0.2, 4, 0, Math.PI * 2); ctx.fill();

  drawGlow(ctx, x, y + 20, 25, color, 0.15);
}

function drawCharacter(
  ctx: CanvasRenderingContext2D, x: number, y: number,
  team: string, isMe: boolean, t: number, hasFlag: boolean, name: string,
) {
  const main = team === 'red' ? (isMe ? '#f87171' : '#dc2626') : (isMe ? '#60a5fa' : '#2563eb');
  const dark = team === 'red' ? '#991b1b' : '#1e3a8a';
  const glow = team === 'red' ? '#ef4444' : '#3b82f6';

  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(x, y + 16, 10, 4, 0, 0, Math.PI * 2); ctx.fill();

  if (isMe) drawGlow(ctx, x, y, 30, glow, 0.15);

  ctx.fillStyle = main;
  ctx.beginPath(); ctx.ellipse(x, y, 9, 13, 0, 0, Math.PI * 2); ctx.fill();

  ctx.strokeStyle = dark; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x - 6, y - 3); ctx.lineTo(x + 6, y - 3); ctx.stroke();

  ctx.fillStyle = '#fcd34d';
  ctx.beginPath(); ctx.arc(x, y - 15, 7, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = '#1e293b';
  ctx.beginPath(); ctx.arc(x - 2.5, y - 16, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 2.5, y - 16, 1.5, 0, Math.PI * 2); ctx.fill();

  const swing = Math.sin(t * 8) * 5;
  ctx.strokeStyle = main; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - 4, y + 10); ctx.lineTo(x - 4 + swing * 0.4, y + 18); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 4, y + 10); ctx.lineTo(x + 4 - swing * 0.4, y + 18); ctx.stroke();

  if (hasFlag) {
    const fc = team === 'red' ? '#3b82f6' : '#ef4444';
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + 7, y + 2); ctx.lineTo(x + 7, y - 24); ctx.stroke();
    const w = Math.sin(t * 5) * 2;
    ctx.fillStyle = fc; ctx.shadowBlur = 8; ctx.shadowColor = fc;
    ctx.beginPath(); ctx.moveTo(x + 7, y - 24); ctx.lineTo(x + 18 + w, y - 19); ctx.lineTo(x + 7, y - 14); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
  }

  if (isMe) {
    ctx.strokeStyle = colorAlpha(glow, 0.5); ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(x, y, 20, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.fillStyle = isMe ? '#fff' : 'rgba(255,255,255,0.6)';
  ctx.font = `bold ${isMe ? 11 : 10}px sans-serif`; ctx.textAlign = 'center';
  ctx.fillText(isMe ? `★ ${name}` : name, x, y - 28);
}

function drawGhost(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = '#475569';
  ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.15;
  ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('💀', x, y + 4);
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
  for (const w of MAP.walls)
    ctx.fillRect(mx + w.x * sx, my + w.y * sy, Math.max(1, w.w * sx), Math.max(1, w.h * sy));

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
