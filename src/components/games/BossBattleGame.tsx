import { useState, useEffect, useRef, useCallback, type MutableRefObject } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QuestionPanel } from '../QuestionPanel';
import { Shield, ZapOff, Clock, HelpCircle, Crosshair } from 'lucide-react';
import { socket } from '../../socket';
import { createInputState, getMoveDirection, setupKeyboardListeners } from '../../engine/input';
import { createCamera, updateCamera, screenToWorld } from '../../engine/camera';
import { VirtualJoystick } from '../../engine/VirtualJoystick';
import type { CameraState } from '../../engine/types';
import {
  type Particle, type ShakeState,
  emitBurst, emitDirectional, tickParticles,
  triggerShake, tickShake, drawGlow, drawBeam, colorAlpha,
  roundRect, lerp,
} from './renderUtils';
import { getObjectsInView, type WorldObject } from './bossWorld';
import { playShootSound } from '../../utils/shootSound';

const WORLD_SIZE = 3000;
const PLAYER_SPEED = 420;
const MOVE_SYNC_MS = 25;
const CENTER = WORLD_SIZE / 2;

interface Props {
  roomCode: string;
  playerId: string;
  player: any;
  questions: any[];
  globalState: any;
  allPlayers: Record<string, any>;
}

interface TravelingProjectile {
  x: number; y: number; vx: number; vy: number; spawnTime: number; isBoss: boolean;
}

interface DamageNumber {
  x: number; y: number; value: number; spawnTime: number; vx: number; vy: number;
}

interface MuzzleFlash {
  x: number; y: number; angle: number; spawnTime: number;
}

interface LerpedEntity {
  x: number; y: number;
  vx: number; vy: number;
  lastTargetTime: number;
}

const PROJECTILE_SPEED = 520;
const PROJECTILE_MAX_AGE_MS = 2500;
const ARENA_MARGIN = 80;

export function BossBattleGame({ roomCode, playerId, player, questions, globalState, allPlayers }: Props) {
  const [showQuestions, setShowQuestions] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const projectilesRef = useRef<TravelingProjectile[]>([]);
  const mouseScreenRef = useRef({ x: 0, y: 0 });
  const crosshairScreenRef = useRef({ x: 0, y: 0 });
  const isBossRef = useRef(false);
  const isDisabledRef = useRef(false);
  const isDeadRef = useRef(false);
  const shootRef = useRef<() => void>(() => {});
  const shakeRef = useRef<ShakeState>({ intensity: 0, offsetX: 0, offsetY: 0 });
  const timeRef = useRef(0);
  const prevLasers = useRef(0);
  const gsRef = useRef(globalState);
  const allPlayersRef = useRef(allPlayers);
  const posRef = useRef({ x: player?.x ?? CENTER, y: player?.y ?? CENTER });
  const lastServerPosRef = useRef({ x: posRef.current.x, y: posRef.current.y });
  const lastMoveTimeRef = useRef(0);
  const aimRef = useRef({ x: 1, y: 0 });
  const inputRef = useRef(createInputState());
  const cameraRef = useRef<CameraState>(createCamera());
  const camInitRef = useRef(false);
  const lastSyncRef = useRef(0);
  const lastShootRef = useRef(0);
  const lastOpenBoxRef = useRef(0);
  const lerpedPlayersRef = useRef<Record<string, LerpedEntity>>({});
  const damageNumbersRef = useRef<DamageNumber[]>([]);
  const muzzleFlashesRef = useRef<MuzzleFlash[]>([]);
  const healthBarDisplayRef = useRef<Record<string, number>>({});

  gsRef.current = globalState;
  allPlayersRef.current = allPlayers;

  const bossIds = globalState?.bossIds || [];
  const bosses = bossIds.map((id: string) => allPlayers?.[id]).filter(Boolean);
  const heroes = Object.values(allPlayers || {}).filter((p: any) => !p.modeState?.isBoss && (p.modeState?.hp ?? 2) > 0);
  const aliveBosses = bosses.filter((b: any) => (b.modeState?.hp ?? 0) > 0);

  const isBoss = player?.modeState?.isBoss;
  const isDisabled = (player?.modeState?.disabledUntil || 0) > Date.now();
  const isDead = !isBoss && (player?.modeState?.hp ?? 2) <= 0;
  const timeLeft = globalState?.timeLeft ?? 600;
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const ammo = Math.floor(player?.resources || 0);

  isBossRef.current = isBoss;
  isDisabledRef.current = isDisabled;
  isDeadRef.current = isDead;

  const [, setRespawnTick] = useState(0);
  useEffect(() => {
    if (!isDead || !player?.modeState?.respawnAt) return;
    const id = setInterval(() => setRespawnTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [isDead, player?.modeState?.respawnAt]);

  useEffect(() => setupKeyboardListeners(inputRef.current), []);

  const onJoystickMove = useCallback((dx: number, dy: number) => {
    inputRef.current.joystickDir = { x: dx, y: dy };
    inputRef.current.joystickActive = true;
    if (Math.hypot(dx, dy) > 0.2) aimRef.current = { x: dx, y: dy };
  }, []);
  const onJoystickRelease = useCallback(() => {
    inputRef.current.joystickDir = { x: 0, y: 0 };
    inputRef.current.joystickActive = false;
  }, []);

  useEffect(() => {
    const p = allPlayers?.[playerId];
    if (p?.x !== undefined && p?.y !== undefined) {
      lastServerPosRef.current = { x: p.x, y: p.y };
      const moving = Date.now() - lastMoveTimeRef.current < 600;
      const dist = Math.hypot(p.x - posRef.current.x, p.y - posRef.current.y);
      if (!moving || dist > 180) {
        posRef.current = { x: p.x, y: p.y };
      }
    }
  }, [allPlayers, playerId]);

  const shoot = useCallback(() => {
    if (ammo < 1 || isDead) return;
    const now = Date.now();
    if (now - lastShootRef.current < 180) return;
    lastShootRef.current = now;
    const angle = Math.atan2(aimRef.current.y, aimRef.current.x);
    const vx = Math.cos(angle) * PROJECTILE_SPEED;
    const vy = Math.sin(angle) * PROJECTILE_SPEED;
    projectilesRef.current.push({
      x: posRef.current.x, y: posRef.current.y,
      vx, vy, spawnTime: now, isBoss: !!player?.modeState?.isBoss
    });
    playShootSound();
    triggerShake(shakeRef.current, 4);
    muzzleFlashesRef.current.push({ x: posRef.current.x, y: posRef.current.y, angle, spawnTime: now });
    socket.emit('action', { code: roomCode, playerId, actionType: 'attack', aimAngle: angle });
  }, [roomCode, playerId, ammo, isDead, player?.modeState?.isBoss]);

  shootRef.current = shoot;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf: number;
    let lastTime = performance.now();

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const cam = cameraRef.current;
      const rawX = e.clientX - rect.left;
      const rawY = e.clientY - rect.top;
      crosshairScreenRef.current = { x: rawX, y: rawY };
      mouseScreenRef.current = { x: rawX, y: rawY };
      const worldMouse = screenToWorld(cam, { x: rawX, y: rawY });
      const px = posRef.current.x;
      const py = posRef.current.y;
      const ax = worldMouse.x - px;
      const ay = worldMouse.y - py;
      const len = Math.hypot(ax, ay);
      if (len > 5) aimRef.current = { x: ax / len, y: ay / len };
    };
    const handleClick = (e: MouseEvent) => {
      if ((e.target as Element)?.closest?.('button, a, [role="button"]')) return;
      const rect = canvas.getBoundingClientRect();
      const rawX = e.clientX - rect.left;
      const rawY = e.clientY - rect.top;
      const worldMouse = screenToWorld(cameraRef.current, { x: rawX, y: rawY });
      const px = posRef.current.x;
      const py = posRef.current.y;
      const ax = worldMouse.x - px;
      const ay = worldMouse.y - py;
      const len = Math.hypot(ax, ay);
      if (len > 5) aimRef.current = { x: ax / len, y: ay / len };
      shootRef.current();
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('click', handleClick);

    const render = (now: number) => {
      const rawDt = (now - lastTime) / 1000;
      const dt = Math.min(rawDt, 0.05);
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
      if (!ctx) { raf = requestAnimationFrame(render); return; }

      const vpW = canvas.width;
      const vpH = canvas.height;
      if (vpW === 0 || vpH === 0) { raf = requestAnimationFrame(render); return; }

      const zoom = Math.min(vpW, vpH) / 700;
      const gs = gsRef.current;
      const players = allPlayersRef.current || {};
      const cam = cameraRef.current;
      const p = players[playerId];
      const canMove = !isDisabledRef.current && !isDeadRef.current && (isBossRef.current || (p?.modeState?.hp ?? 2) > 0);

      if (canMove) {
        const dir = getMoveDirection(inputRef.current);
        if (dir.x !== 0 || dir.y !== 0) {
          lastMoveTimeRef.current = now;
          const moveX = dir.x * PLAYER_SPEED * dt;
          const moveY = dir.y * PLAYER_SPEED * dt;
          posRef.current.x = Math.max(40, Math.min(WORLD_SIZE - 40, posRef.current.x + moveX));
          posRef.current.y = Math.max(40, Math.min(WORLD_SIZE - 40, posRef.current.y + moveY));
          if (now - lastSyncRef.current > MOVE_SYNC_MS) {
            socket.emit('updatePosition', { code: roomCode, playerId, x: posRef.current.x, y: posRef.current.y });
            lastSyncRef.current = now;
          }
        } else {
          const srv = lastServerPosRef.current;
          const movingRecently = now - lastMoveTimeRef.current < 400;
          if (!movingRecently) {
            const dx = srv.x - posRef.current.x;
            const dy = srv.y - posRef.current.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 2 && dist < 250) {
              const speed = lerp(0, 1, 18 * dt);
              posRef.current.x += dx * speed;
              posRef.current.y += dy * speed;
            } else if (dist >= 250) {
              posRef.current = { x: srv.x, y: srv.y };
            }
          }
        }
      }

      const lerpSpeed = 12 * dt;
      Object.entries(players).forEach(([id, p]) => {
        if (!p || (p.modeState?.hp ?? 2) <= 0) return;
        const tx = p.x ?? CENTER;
        const ty = p.y ?? CENTER;
        let ent = lerpedPlayersRef.current[id];
        if (!ent) ent = { x: tx, y: ty, vx: 0, vy: 0, lastTargetTime: now };
        const dx = tx - ent.x;
        const dy = ty - ent.y;
        ent.vx = (ent.vx * 0.7 + dx * 0.3) * 0.9;
        ent.vy = (ent.vy * 0.7 + dy * 0.3) * 0.9;
        ent.x = lerp(ent.x, tx, lerpSpeed);
        ent.y = lerp(ent.y, ty, lerpSpeed);
        ent.lastTargetTime = now;
        lerpedPlayersRef.current[id] = ent;
      });

      if (!camInitRef.current) {
        cam.x = posRef.current.x - vpW / (2 * zoom);
        cam.y = posRef.current.y - vpH / (2 * zoom);
        cam.zoom = zoom;
        camInitRef.current = true;
      }
      cam.zoom = zoom;
      updateCamera(cam, posRef.current, vpW, vpH, WORLD_SIZE, WORLD_SIZE, 0.18);

      const shake = tickShake(shakeRef.current);
      ctx.save();
      ctx.translate(shake.x, shake.y);

      const bgGrad = ctx.createRadialGradient(vpW / 2, vpH / 2, 0, vpW / 2, vpH / 2, vpW * 0.8);
      bgGrad.addColorStop(0, '#1a3d1a');
      bgGrad.addColorStop(0.6, '#0f2d0f');
      bgGrad.addColorStop(1, '#051505');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, vpW, vpH);

      ctx.save();
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);

      const vpWorldW = vpW / cam.zoom + 100;
      const vpWorldH = vpH / cam.zoom + 100;
      drawWorld(ctx, cam, vpWorldW, vpWorldH, t);
      const worldObjs = getObjectsInView(cam.x, cam.y, vpWorldW, vpWorldH)
        .filter(o => !['rock', 'barrel', 'crate', 'fence', 'path'].includes(o.type));
      const openedBoxes = gs?.openedBoxes || [];
      const weaponBoxes = (gs?.weaponBoxes || []).filter((b: any) => !openedBoxes.includes(b.id));
      const worldObjsFiltered = worldObjs.filter(o => o.type !== 'weaponBox');
      drawWorldObjects(ctx, worldObjsFiltered, cam, t);
      drawWeaponBoxes(ctx, weaponBoxes, cam, vpWorldW, vpWorldH, t);
      tryOpenNearbyBox(posRef.current, openedBoxes, weaponBoxes, roomCode, playerId, isBossRef.current, isDeadRef.current, lastOpenBoxRef, now);
      drawPlayers(ctx, players, playerId, cam, aimRef, lerpedPlayersRef, posRef, healthBarDisplayRef, inputRef, t, dt);
      const bossIdsArr = gsRef.current?.bossIds || [];
      const bossesArr = bossIdsArr.map((id: string) => players[id]).filter(Boolean);
      const heroesArr = Object.values(players).filter((p: any) => !p.modeState?.isBoss && (p.modeState?.hp ?? 2) > 0);
      drawProjectiles(ctx, projectilesRef, now, dt, particlesRef, bossesArr, heroesArr, WORLD_SIZE, ARENA_MARGIN);
      drawLasers(ctx, gs?.lasers || [], shakeRef, particlesRef, triggerShake, prevLasers, damageNumbersRef);
      drawMuzzleFlashes(ctx, muzzleFlashesRef, now);
      drawDamageNumbers(ctx, damageNumbersRef, now, particlesRef);
      particlesRef.current = tickParticles(ctx, particlesRef.current);

      ctx.restore();
      drawCrosshair(ctx, crosshairScreenRef);
      ctx.restore();

      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('click', handleClick);
      cancelAnimationFrame(raf);
    };
  }, [roomCode, playerId]);

  const onCorrect = () => socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: true });
  const onWrong = () => socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: false });

  const buyShield = () => {
    if (ammo >= 5) socket.emit('buyUpgrade', { code: roomCode, playerId, upgradeId: 'shield', cost: 5 });
  };

  const disableHero = (targetId: string) => {
    if (ammo >= 10) socket.emit('buyUpgrade', { code: roomCode, playerId, upgradeId: 'disable', cost: 10, targetId });
  };

  return (
    <div className={`fixed inset-0 text-white ${isBoss ? 'bg-[#0a0515]' : 'bg-[#050a15]'}`}>
      <div className="absolute inset-0">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ cursor: 'crosshair' }} />
      </div>

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
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isDead && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-red-950/80"
          >
            <div className="text-center">
              <h2 className="text-4xl font-black text-red-200 mb-2">💀 נפלת!</h2>
              {player?.modeState?.respawnAt ? (
                <p className="text-red-300/90 text-xl font-bold">
                  חוזר לחיים בעוד {Math.max(0, Math.ceil((player.modeState.respawnAt - Date.now()) / 1000))} שניות...
                </p>
              ) : (
                <p className="text-red-300/80">צפה בחברים ממשיכים...</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute top-0 left-0 right-0 z-20 p-3 bg-gradient-to-b from-black/70 to-transparent pointer-events-none">
        <div className="flex justify-between items-center flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Clock size={18} className="text-yellow-400" />
            <span className={`font-mono font-black text-xl ${timeLeft < 60 ? 'text-red-400 animate-pulse' : 'text-white'}`}>
              {minutes}:{seconds.toString().padStart(2, '0')}
            </span>
            <span className={`text-sm font-bold px-4 py-1.5 rounded-xl shadow-lg ${isBoss ? 'bg-red-500/30 text-red-300 border border-red-400/50' : 'bg-blue-500/30 text-blue-300 border border-blue-400/50'}`}>
              {isBoss ? '🐉 בוס' : '⚔️ גיבור'}
            </span>
            <span className="text-lg font-black text-amber-300 bg-amber-500/30 px-4 py-1.5 rounded-xl border-2 border-amber-400/50 shadow-lg">
              🔫 {ammo} תחמושת
            </span>
            {isBoss && (
              <span className="text-sm font-bold text-blue-400 bg-blue-500/20 px-2 py-1 rounded">
                🛡️ {player?.modeState?.shields ?? 0}
              </span>
            )}
          </div>
        </div>
        {aliveBosses.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {aliveBosses.map((b: any) => {
              const hp = b.modeState?.hp ?? 0;
              const maxHp = b.modeState?.maxHp ?? 10;
              const pct = Math.max(0, hp / maxHp);
              return (
                <div key={b.id} className="flex-1 min-w-[100px] max-w-[180px]">
                  <div className="text-[10px] text-red-400 font-bold mb-1">{b.name || 'בוס'}</div>
                  <div className="h-3 bg-black/60 rounded-lg overflow-hidden border border-red-500/30 shadow-lg">
                    <motion.div
                      className="h-full rounded-lg bg-gradient-to-r from-red-500 via-red-600 to-red-700"
                      animate={{ width: `${pct * 100}%` }}
                      transition={{ duration: 0.15 }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="absolute bottom-4 left-0 right-0 z-30 flex justify-center gap-3 px-4 pointer-events-auto flex-wrap">
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowQuestions(true)}
          className="px-5 py-3 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg flex items-center gap-2"
        >
          <HelpCircle size={18} /> שאלות (+תחמושת)
        </motion.button>

        {!isDead && ammo > 0 && (
          <motion.button
            whileTap={{ scale: 0.9 }}
            whileHover={{ scale: 1.05 }}
            onClick={shoot}
            className="px-8 py-4 rounded-2xl font-black bg-red-600 hover:bg-red-500 text-white shadow-xl flex items-center gap-3 border-2 border-red-400/50"
          >
            <Crosshair size={24} /> ירי!
          </motion.button>
        )}
        {isBoss && ammo >= 5 && (
          <motion.button whileTap={{ scale: 0.95 }} onClick={buyShield}
            className="px-4 py-2 rounded-xl font-bold bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-2">
            <Shield size={16} /> מגן (5)
          </motion.button>
        )}
      </div>

      {isBoss && heroes.length > 0 && ammo >= 10 && (
        <div className="absolute bottom-20 left-0 right-0 z-25 px-4 pointer-events-auto">
          <div className="flex justify-center gap-2 flex-wrap">
            {heroes.map((h: any) => (
              <motion.button key={h.id} whileTap={{ scale: 0.9 }}
                onClick={() => disableHero(h.id)}
                disabled={(h.modeState?.disabledUntil || 0) > Date.now()}
                className="flex items-center gap-1.5 bg-slate-800/80 px-3 py-1.5 rounded-lg text-xs border border-purple-900/40 disabled:opacity-40">
                <ZapOff size={12} /> {h.name}
                {(h.modeState?.disabledUntil || 0) > Date.now() && <span className="text-purple-400">⏳</span>}
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {!isDead && (
        <div className="absolute bottom-4 left-4 z-20 pointer-events-auto">
          <VirtualJoystick onMove={onJoystickMove} onRelease={onJoystickRelease} size={100}
            teamColor={isBoss ? 'rgba(239,68,68,0.5)' : 'rgba(59,130,246,0.5)'} />
        </div>
      )}

      <AnimatePresence>
        {showQuestions && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowQuestions(false)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-900 rounded-2xl border-2 border-indigo-600/50 shadow-2xl max-w-lg w-full max-h-[85vh] overflow-hidden">
              <div className="p-4 border-b border-slate-700 flex justify-between items-center">
                <span className="font-bold text-indigo-300">ענה נכון = +2 תחמושת 🔫</span>
                <button onClick={() => setShowQuestions(false)} className="text-slate-400 hover:text-white">✕</button>
              </div>
              <div className="overflow-y-auto max-h-[70vh] p-4">
                <QuestionPanel questions={questions} onCorrect={onCorrect} onWrong={onWrong} earnLabel="+2 🔫" disabled={isDisabled} compact />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function drawWeaponBoxes(
  ctx: CanvasRenderingContext2D,
  boxes: { id: string; x: number; y: number; type?: string }[],
  cam: CameraState,
  vpW: number,
  vpH: number,
  t: number
) {
  boxes.forEach(box => {
    if (box.x + 50 < cam.x - 100 || box.x - 50 > cam.x + vpW + 100 ||
        box.y + 50 < cam.y - 100 || box.y - 50 > cam.y + vpH + 100) return;
    ctx.save();
    ctx.translate(box.x, box.y);
    const type = box.type || 'rifle';
    const styles: Record<string, { color: string; accent: string; icon: string }> = {
      rifle: { color: '#4a5568', accent: '#2d3748', icon: '▬' },
      shotgun: { color: '#744210', accent: '#92400e', icon: '≡' },
      rocket: { color: '#1e3a5f', accent: '#1e40af', icon: '◆' },
      sniper: { color: '#14532d', accent: '#166534', icon: '▸' },
      minigun: { color: '#7f1d1d', accent: '#991b1b', icon: '▬▬' }
    };
    const s = styles[type] || styles.rifle;
    drawGlow(ctx, 0, 0, 55, s.accent, 0.25 + 0.1 * Math.sin(t * 2));
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(0, 28, 28, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    const grad = ctx.createLinearGradient(-25, -25, 25, 25);
    grad.addColorStop(0, s.accent);
    grad.addColorStop(0.5, s.color);
    grad.addColorStop(1, '#1a1a1a');
    ctx.fillStyle = grad;
    roundRect(ctx, -28, -22, 56, 44, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#fef08a';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(s.icon, 0, 8);
    ctx.restore();
  });
}

function tryOpenNearbyBox(
  pos: { x: number; y: number },
  openedBoxes: string[],
  weaponBoxes: { id: string; x: number; y: number }[],
  roomCode: string,
  playerId: string,
  isBoss: boolean,
  isDead: boolean,
  lastOpenRef: MutableRefObject<number>,
  now: number
) {
  if (isBoss || isDead || now - lastOpenRef.current < 400) return;
  for (const box of weaponBoxes) {
    if (openedBoxes.includes(box.id)) continue;
    const dist = Math.hypot(pos.x - box.x, pos.y - box.y);
    if (dist < 95) {
      lastOpenRef.current = now;
      socket.emit('openBox', { code: roomCode, playerId, boxId: box.id });
      return;
    }
  }
}

function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  mouseRef: MutableRefObject<{ x: number; y: number }>
) {
  const mx = mouseRef.current.x;
  const my = mouseRef.current.y;
  ctx.save();
  ctx.translate(mx, my);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 3;
  ctx.shadowColor = '#ef4444';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(0, 0, 14, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawProjectiles(
  ctx: CanvasRenderingContext2D,
  projectilesRef: MutableRefObject<TravelingProjectile[]>,
  now: number,
  dt: number,
  particlesRef: MutableRefObject<Particle[]>,
  bosses: any[],
  heroes: any[],
  worldSize: number,
  margin: number
) {
  projectilesRef.current = projectilesRef.current.filter(proj => {
    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;

    const age = now - proj.spawnTime;
    if (age > PROJECTILE_MAX_AGE_MS) return false;
    if (proj.x < -margin || proj.x > worldSize + margin || proj.y < -margin || proj.y > worldSize + margin) return false;

    const bossHit = !proj.isBoss && bosses.some((b: any) => {
      if ((b.modeState?.hp ?? 0) <= 0) return false;
      const bx = b.x ?? CENTER;
      const by = b.y ?? CENTER;
      return Math.hypot(proj.x - bx, proj.y - by) < 55;
    });
    const heroHit = proj.isBoss && heroes.some((h: any) => {
      const hx = h.x ?? CENTER;
      const hy = h.y ?? CENTER;
      return Math.hypot(proj.x - hx, proj.y - hy) < 25;
    });
    if (bossHit || heroHit) {
      particlesRef.current.push(...emitBurst(proj.x, proj.y, 8, 6, 0.4, proj.isBoss ? '#ef4444' : '#fbbf24', 2, { type: 'spark', friction: 0.92 }));
      return false;
    }

    if (Math.random() < 0.4) {
      const angle = Math.atan2(-proj.vy, -proj.vx);
      particlesRef.current.push(...emitDirectional(proj.x, proj.y, angle, 0.4, 1, 2, 0.2, proj.isBoss ? '#ff6666' : '#ffdd44', 1.5, { type: 'spark', friction: 0.9 }));
    }

    const color = proj.isBoss ? '#ef4444' : '#fbbf24';
    ctx.save();
    const angle = Math.atan2(proj.vy, proj.vx);
    ctx.translate(proj.x, proj.y);
    ctx.rotate(angle);
    const g = ctx.createLinearGradient(-12, 0, 12, 0);
    g.addColorStop(0, colorAlpha(color, 0.4));
    g.addColorStop(0.3, colorAlpha(color, 0.9));
    g.addColorStop(0.7, color);
    g.addColorStop(1, colorAlpha(color, 0.95));
    ctx.fillStyle = g;
    ctx.shadowBlur = 14;
    ctx.shadowColor = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
    return true;
  });
}

function drawWorld(ctx: CanvasRenderingContext2D, cam: CameraState, vpW: number, vpH: number, t: number) {
  const baseX = Math.max(0, cam.x - 100);
  const baseY = Math.max(0, cam.y - 100);
  const w = Math.min(WORLD_SIZE + 200, vpW + 200);
  const h = Math.min(WORLD_SIZE + 200, vpH + 200);

  const grassGrad = ctx.createLinearGradient(baseX, baseY, baseX + w, baseY + h);
  grassGrad.addColorStop(0, '#8bc34a');
  grassGrad.addColorStop(0.3, '#7cb342');
  grassGrad.addColorStop(0.6, '#689f38');
  grassGrad.addColorStop(1, '#558b2f');
  ctx.fillStyle = grassGrad;
  ctx.fillRect(baseX, baseY, w, h);

  for (let i = 0; i < 40; i++) {
    const px = (baseX + (i * 137) % w) + Math.sin(t + i) * 3;
    const py = (baseY + (i * 89) % h) + Math.cos(t * 0.7 + i) * 2;
    ctx.fillStyle = `rgba(76,175,80,${0.15 + 0.08 * Math.sin(t + i * 0.5)})`;
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = 'rgba(124,179,66,0.12)';
  ctx.beginPath();
  ctx.ellipse(baseX + w / 2, baseY + h / 2, w * 0.35, h * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();

  drawPathsToCenter(ctx, cam, vpW, vpH);
}

function drawPathsToCenter(ctx: CanvasRenderingContext2D, cam: CameraState, vpW: number, vpH: number) {
  const cx = CENTER;
  const cy = CENTER;
  const pathWidth = 100;
  const pathColor = '#d4a574';
  const pathEdge = '#b8956a';

  const paths: { from: [number, number]; to: [number, number]; width: number }[] = [
    { from: [0, cy], to: [cx, cy], width: pathWidth },
    { from: [WORLD_SIZE, cy], to: [cx, cy], width: pathWidth },
    { from: [cx, 0], to: [cx, cy], width: pathWidth },
    { from: [cx, WORLD_SIZE], to: [cx, cy], width: pathWidth },
    { from: [WORLD_SIZE * 0.2, 0], to: [cx, cy], width: pathWidth * 0.8 },
    { from: [WORLD_SIZE * 0.8, WORLD_SIZE], to: [cx, cy], width: pathWidth * 0.8 },
  ];

  paths.forEach(({ from, to, width }) => {
    const [x1, y1] = from;
    const [x2, y2] = to;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const perpX = -dy / len;
    const perpY = dx / len;
    const hw = width / 2;

    ctx.save();
    ctx.fillStyle = pathColor;
    ctx.strokeStyle = pathEdge;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1 + perpX * hw, y1 + perpY * hw);
    ctx.lineTo(x1 - perpX * hw, y1 - perpY * hw);
    ctx.lineTo(x2 - perpX * hw, y2 - perpY * hw);
    ctx.lineTo(x2 + perpX * hw, y2 + perpY * hw);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  });
}

function drawWorldObjects(ctx: CanvasRenderingContext2D, objs: WorldObject[], cam: CameraState, t: number) {
  const sorted = [...objs].sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2));
  sorted.forEach(o => {
    ctx.save();
    ctx.translate(o.x, o.y);
    const v = o.variant ?? 0;
    switch (o.type) {
      case 'tree':
        drawGlow(ctx, 0, -o.h * 0.2, o.w * 1.2, '#22c55e', 0.15);
        const foliageGrad = ctx.createRadialGradient(0, -o.h * 0.3, 0, 0, -o.h * 0.3, o.w * 0.6);
        foliageGrad.addColorStop(0, '#4ade80');
        foliageGrad.addColorStop(0.5, '#22c55e');
        foliageGrad.addColorStop(1, '#15803d');
        ctx.fillStyle = foliageGrad;
        ctx.beginPath();
        ctx.ellipse(0, -o.h * 0.3, o.w * 0.65, o.h * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#166534';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#78350f';
        ctx.fillRect(-o.w * 0.15, o.h * 0.2, o.w * 0.3, o.h * 0.5);
        ctx.strokeStyle = '#92400e';
        ctx.strokeRect(-o.w * 0.15, o.h * 0.2, o.w * 0.3, o.h * 0.5);
        break;
      case 'bush':
        const bushGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, o.w * 0.6);
        bushGrad.addColorStop(0, '#4ade80');
        bushGrad.addColorStop(0.7, '#22c55e');
        bushGrad.addColorStop(1, '#166534');
        ctx.fillStyle = bushGrad;
        ctx.beginPath();
        ctx.ellipse(0, 0, o.w / 2, o.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#15803d';
        ctx.lineWidth = 1;
        ctx.stroke();
        drawGlow(ctx, 0, 0, o.w, '#22c55e', 0.1);
        break;
      case 'house':
        drawGlow(ctx, 0, 0, o.w * 0.8, v % 2 ? '#dc2626' : '#2563eb', 0.12);
        const wallGrad = ctx.createLinearGradient(-o.w / 2, 0, o.w / 2, 0);
        wallGrad.addColorStop(0, v % 2 ? '#b91c1c' : '#1d4ed8');
        wallGrad.addColorStop(0.5, v % 2 ? '#dc2626' : '#2563eb');
        wallGrad.addColorStop(1, v % 2 ? '#991b1b' : '#1e40af');
        ctx.fillStyle = wallGrad;
        ctx.fillRect(-o.w / 2, -o.h * 0.3, o.w, o.h * 0.8);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 2;
        ctx.strokeRect(-o.w / 2, -o.h * 0.3, o.w, o.h * 0.8);
        ctx.fillStyle = '#78350f';
        ctx.beginPath();
        ctx.moveTo(-o.w / 2 - 8, -o.h * 0.3);
        ctx.lineTo(o.w / 2 + 8, -o.h * 0.3);
        ctx.lineTo(o.w / 2, -o.h * 0.65);
        ctx.lineTo(-o.w / 2, -o.h * 0.65);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#92400e';
        ctx.stroke();
        ctx.fillStyle = '#fef08a';
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#fef08a';
        ctx.fillRect(-o.w * 0.18, o.h * 0.08, o.w * 0.36, o.h * 0.4);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 1;
        ctx.strokeRect(-o.w * 0.18, o.h * 0.08, o.w * 0.36, o.h * 0.4);
        break;
      case 'path':
        const pathGrad = ctx.createLinearGradient(-o.w / 2, 0, o.w / 2, 0);
        pathGrad.addColorStop(0, '#78716c');
        pathGrad.addColorStop(0.5, '#a8a29e');
        pathGrad.addColorStop(1, '#78716c');
        ctx.fillStyle = pathGrad;
        ctx.fillRect(-o.w / 2, -o.h / 2, o.w, o.h);
        ctx.strokeStyle = '#57534e';
        ctx.lineWidth = 2;
        ctx.strokeRect(-o.w / 2, -o.h / 2, o.w, o.h);
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(-o.w / 2 + 4, -o.h / 2 + 4, o.w - 8, o.h - 8);
        break;
      case 'lamp':
        ctx.fillStyle = '#334155';
        ctx.fillRect(-o.w / 2, 0, o.w, o.h);
        ctx.strokeStyle = '#475569';
        ctx.strokeRect(-o.w / 2, 0, o.w, o.h);
        ctx.fillStyle = '#fbbf24';
        ctx.shadowBlur = 25;
        ctx.shadowColor = '#fbbf24';
        drawGlow(ctx, 0, -o.h * 0.3, 30, '#fbbf24', 0.4 + 0.15 * Math.sin(t * 2));
        ctx.beginPath();
        ctx.arc(0, -o.h * 0.3, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        break;
      default:
        break;
    }
    ctx.restore();
  });
}

function drawMuzzleFlashes(
  ctx: CanvasRenderingContext2D,
  ref: MutableRefObject<MuzzleFlash[]>,
  now: number
) {
  const FLASH_DURATION = 80;
  ref.current = ref.current.filter(m => {
    const age = now - m.spawnTime;
    if (age > FLASH_DURATION) return false;
    const alpha = 1 - age / FLASH_DURATION;
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.angle);
    ctx.globalAlpha = alpha;
    const g = ctx.createRadialGradient(0, 0, 0, 25, 0, 0);
    g.addColorStop(0, 'rgba(255,220,100,0.95)');
    g.addColorStop(0.4, 'rgba(255,180,50,0.6)');
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(15, -12, 35, 24);
    ctx.globalAlpha = 1;
    ctx.restore();
    return true;
  });
}

function drawDamageNumbers(
  ctx: CanvasRenderingContext2D,
  ref: MutableRefObject<DamageNumber[]>,
  now: number,
  particlesRef: MutableRefObject<Particle[]>
) {
  const DURATION = 800;
  ref.current = ref.current.filter(d => {
    const age = now - d.spawnTime;
    if (age > DURATION) return false;
    d.x += d.vx; d.y += d.vy;
    d.vy -= 0.15;
    const alpha = 1 - age / DURATION;
    const scale = 1 + age / DURATION * 0.5;
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff4444';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    ctx.strokeText(`-${d.value}`, 0, 0);
    ctx.fillText(`-${d.value}`, 0, 0);
    ctx.restore();
    return true;
  });
}

function drawPlayers(
  ctx: CanvasRenderingContext2D,
  players: Record<string, any>,
  myId: string,
  cam: CameraState,
  aimRef: MutableRefObject<{ x: number; y: number }>,
  lerpedRef: MutableRefObject<Record<string, LerpedEntity>>,
  posRef: MutableRefObject<{ x: number; y: number }>,
  healthBarDisplayRef: MutableRefObject<Record<string, number>>,
  inputRef: MutableRefObject<ReturnType<typeof createInputState>>,
  t: number,
  dt: number
) {
  const sorted = Object.entries(players)
    .filter(([, p]) => (p.modeState?.hp ?? 2) > 0)
    .sort(([, a], [, b]) => (a.y ?? 0) - (b.y ?? 0));

  sorted.forEach(([id, p]) => {
    const isMe = id === myId;
    const x = isMe ? posRef.current.x : (lerpedRef.current[id]?.x ?? p.x ?? CENTER);
    const y = isMe ? posRef.current.y : (lerpedRef.current[id]?.y ?? p.y ?? CENTER);
    const ent = lerpedRef.current[id];
    const velX = ent?.vx ?? 0;
    const velY = ent?.vy ?? 0;
    const dir = isMe ? getMoveDirection(inputRef.current) : { x: 0, y: 0 };
    const isMoving = isMe ? (dir.x !== 0 || dir.y !== 0) : Math.hypot(velX, velY) > 2;
    const isBoss = p.modeState?.isBoss;
    const hp = p.modeState?.hp ?? 2;
    const maxHp = p.modeState?.maxHp ?? (isBoss ? 10 : 2);
    const aim = isMe ? aimRef.current : { x: 1, y: 0 };

    ctx.save();
    ctx.translate(x, y);

    if (isBoss) {
      drawBossCreature(ctx, 0, 0, t, hp / maxHp, p.modeState?.shields ?? 0, isMe ? aim : null);
    } else {
      const weaponType = p.modeState?.weaponType || 'rifle';
      drawBrawler(ctx, 0, 0, t, isMe, aim, isMoving, weaponType);
    }

    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = isMe ? '#93c5fd' : (isBoss ? '#fca5a5' : '#a5b4fc');
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 5;
    ctx.fillText(p.name || '?', 0, isBoss ? -100 : -58);
    ctx.shadowBlur = 0;

    if (!isBoss && maxHp > 0) {
      const barW = 52;
      const barH = 10;
      const pct = Math.max(0.02, hp / maxHp);
      const key = `${id}_hp`;
      let displayPct = healthBarDisplayRef.current[key] ?? pct;
      displayPct = lerp(displayPct, pct, 8 * dt);
      healthBarDisplayRef.current[key] = displayPct;
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 8;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      roundRect(ctx, -barW / 2, -48, barW, barH, 5);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,100,100,0.5)';
      roundRect(ctx, -barW / 2, -48, barW * displayPct, barH, 5);
      ctx.fill();
      const barGrad = ctx.createLinearGradient(-barW / 2, 0, barW / 2, 0);
      barGrad.addColorStop(0, pct > 0.5 ? '#4ade80' : pct > 0.25 ? '#facc15' : '#f87171');
      barGrad.addColorStop(1, pct > 0.5 ? '#22c55e' : pct > 0.25 ? '#eab308' : '#ef4444');
      ctx.fillStyle = barGrad;
      roundRect(ctx, -barW / 2, -48, barW * pct, barH, 5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      roundRect(ctx, -barW / 2, -48, barW, barH, 5);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  });
}

function drawBrawler(
  ctx: CanvasRenderingContext2D, x: number, y: number, t: number, isMe: boolean,
  aim: { x: number; y: number },
  isMoving: boolean,
  weaponType: string
) {
  ctx.save();
  ctx.translate(x, y);

  const bob = isMoving ? Math.sin(t * 8) * 3 : 0;
  const breathe = Math.sin(t * 2.2) * 2;
  const scale = 1 + 0.015 * Math.sin(t * 2);
  ctx.scale(scale, scale);

  const primary = isMe ? '#2563eb' : '#475569';
  const secondary = isMe ? '#3b82f6' : '#64748b';
  const highlight = isMe ? '#60a5fa' : '#94a3b8';
  const dark = isMe ? '#1e40af' : '#334155';
  const skin = '#fcd5b8';
  const outline = '#0f172a';

  ctx.shadowColor = '#000';
  ctx.shadowBlur = 10;
  drawGlow(ctx, 0, 0, 50, secondary, isMe ? 0.25 : 0.12);

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.ellipse(0, 32 + bob, 26, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = primary;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 3;
  roundRect(ctx, -10, 20 + breathe + bob, 9, 22, 4);
  ctx.fill();
  ctx.stroke();
  roundRect(ctx, 1, 20 + breathe + bob, 9, 22, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = highlight;
  ctx.fillRect(-8, 24 + breathe + bob, 5, 4);
  ctx.fillRect(3, 24 + breathe + bob, 5, 4);

  const torsoGrad = ctx.createLinearGradient(-22, -15, 22, 35);
  torsoGrad.addColorStop(0, highlight);
  torsoGrad.addColorStop(0.35, secondary);
  torsoGrad.addColorStop(0.7, primary);
  torsoGrad.addColorStop(1, dark);
  ctx.fillStyle = torsoGrad;
  roundRect(ctx, -20, -10 + breathe + bob, 40, 36, 10);
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = colorAlpha(highlight, 0.4);
  roundRect(ctx, -16, -6 + breathe + bob, 12, 8, 3);
  ctx.fill();
  roundRect(ctx, 4, -6 + breathe + bob, 12, 8, 3);
  ctx.fill();

  ctx.fillStyle = skin;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, -26 + breathe + bob, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(-5, -28 + breathe + bob, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(5, -28 + breathe + bob, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = highlight;
  ctx.shadowBlur = 8;
  ctx.shadowColor = highlight;
  ctx.beginPath();
  ctx.arc(-5, -28 + breathe + bob, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(5, -28 + breathe + bob, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = primary;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 2;
  roundRect(ctx, -24, -14 + breathe + bob, 14, 18, 5);
  ctx.fill();
  ctx.stroke();
  roundRect(ctx, 10, -14 + breathe + bob, 14, 18, 5);
  ctx.fill();
  ctx.stroke();

  const aimAngle = Math.atan2(aim.y, aim.x);
  ctx.save();
  ctx.rotate(aimAngle);

  const weaponStyles: Record<string, { len: number; color: string; thick: number }> = {
    rifle: { len: 38, color: '#4a5568', thick: 3 },
    shotgun: { len: 32, color: '#92400e', thick: 5 },
    rocket: { len: 45, color: '#1e40af', thick: 4 },
    sniper: { len: 50, color: '#166534', thick: 2 },
    minigun: { len: 42, color: '#991b1b', thick: 4 }
  };
  const ws = weaponStyles[weaponType] || weaponStyles.rifle;

  ctx.fillStyle = ws.color;
  ctx.strokeStyle = outline;
  ctx.lineWidth = ws.thick;
  ctx.fillRect(18, -4, ws.len, 8);
  ctx.strokeRect(18, -4, ws.len, 8);
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(18 + ws.len - 8, -3, 6, 6);
  ctx.fillStyle = '#ef4444';
  ctx.shadowBlur = 12;
  ctx.shadowColor = '#ef4444';
  ctx.beginPath();
  ctx.arc(22 + ws.len, 0, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawLasers(
  ctx: CanvasRenderingContext2D,
  lasers: any[],
  shakeRef: MutableRefObject<ShakeState>,
  particlesRef: MutableRefObject<Particle[]>,
  triggerShake: (s: ShakeState, i: number) => void,
  prevLasers: MutableRefObject<number>,
  damageNumbersRef: MutableRefObject<DamageNumber[]>
) {
  const now = Date.now();
  lasers.forEach((l: any) => {
    const color = l.blocked ? '#3b82f6' : '#ef4444';
    drawBeam(ctx, l.x1, l.y1, l.x2, l.y2, color, 5, 22);
    particlesRef.current.push(...emitBurst(l.x2, l.y2, 6, 5, 0.5, color, 2.5, { type: 'spark', friction: 0.95 }));
    if (!l.blocked) {
      triggerShake(shakeRef.current, 4);
      damageNumbersRef.current.push({
        x: l.x2, y: l.y2, value: 1, spawnTime: now,
        vx: (Math.random() - 0.5) * 2, vy: -3 - Math.random() * 2
      });
    } else triggerShake(shakeRef.current, 2);
  });
  if (lasers.length > prevLasers.current && lasers.length > 0) triggerShake(shakeRef.current, 6);
  prevLasers.current = lasers.length;
}

function drawBossCreature(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, hpPct: number, shields: number, aim: { x: number; y: number } | null = null) {
  const breathe = Math.sin(t * 1.8) * 3;
  const scaleBreath = 1 + 0.025 * Math.sin(t * 1.5);
  const isEnraged = hpPct < 0.3;
  const damageFlash = isEnraged && Math.sin(t * 12) > 0.7;

  ctx.save();
  ctx.translate(x, y + breathe);
  ctx.scale(scaleBreath, scaleBreath);

  drawGlow(ctx, 0, 0, 90, isEnraged ? '#ef4444' : '#6d28d9', isEnraged ? 0.2 : 0.12);

  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.ellipse(0, 62, 60, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 58, 55, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  if (shields > 0) {
    ctx.strokeStyle = colorAlpha('#3b82f6', 0.4 + 0.2 * Math.sin(t * 3));
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, 70 + Math.sin(t * 2) * 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    drawGlow(ctx, 0, 0, 80, '#3b82f6', 0.08 + 0.04 * Math.sin(t * 2));
  }

  if (isEnraged) drawGlow(ctx, 0, 0, 85, '#ef4444', 0.15 + 0.08 * Math.sin(t * 4));

  const bodyColor = damageFlash ? '#ef4444' : (isEnraged ? '#7f1d1d' : '#4c1d95');
  const bodyGrad = ctx.createRadialGradient(0, -5, 5, 0, 10, 50);
  bodyGrad.addColorStop(0, damageFlash ? '#fca5a5' : (isEnraged ? '#991b1b' : '#7c3aed'));
  bodyGrad.addColorStop(1, bodyColor);
  ctx.fillStyle = bodyGrad;

  ctx.beginPath();
  ctx.moveTo(-38, -18);
  ctx.quadraticCurveTo(-42, -38, -22, -42);
  ctx.quadraticCurveTo(0, -50, 22, -42);
  ctx.quadraticCurveTo(42, -38, 38, -18);
  ctx.quadraticCurveTo(45, 22, 32, 42);
  ctx.quadraticCurveTo(0, 58, -32, 42);
  ctx.quadraticCurveTo(-45, 22, -38, -18);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = colorAlpha(isEnraged ? '#ef4444' : '#a78bfa', 0.5);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-28, -12);
  ctx.quadraticCurveTo(0, -8, 28, -12);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-22, 18);
  ctx.quadraticCurveTo(0, 22, 22, 18);
  ctx.stroke();

  ctx.fillStyle = isEnraged ? '#991b1b' : '#1e1b4b';
  ctx.beginPath();
  ctx.moveTo(-20, -40);
  ctx.quadraticCurveTo(-32, -62 + breathe * 0.5, -27, -68);
  ctx.quadraticCurveTo(-16, -58, -14, -40);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(20, -40);
  ctx.quadraticCurveTo(32, -62 + breathe * 0.5, 27, -68);
  ctx.quadraticCurveTo(16, -58, 14, -40);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = isEnraged ? '#ef4444' : '#a78bfa';
  ctx.shadowBlur = 10;
  ctx.shadowColor = isEnraged ? '#ef4444' : '#a78bfa';
  ctx.beginPath();
  ctx.arc(-27, -66, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(27, -66, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  const eyeGlow = isEnraged ? '#ef4444' : '#f59e0b';
  const eyeOpen = 0.7 + 0.3 * Math.abs(Math.sin(t * 0.5));
  ctx.fillStyle = '#0f0520';
  ctx.beginPath();
  ctx.ellipse(-14, -24, 9, 6 * eyeOpen, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 14;
  ctx.shadowColor = eyeGlow;
  ctx.fillStyle = eyeGlow;
  ctx.beginPath();
  ctx.ellipse(-14, -24, 5, 3.5 * eyeOpen, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0f0520';
  ctx.beginPath();
  ctx.ellipse(14, -24, 9, 6 * eyeOpen, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = eyeGlow;
  ctx.beginPath();
  ctx.ellipse(14, -24, 5, 3.5 * eyeOpen, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  const armSwing = Math.sin(t * 2) * 10;
  ctx.strokeStyle = bodyColor;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-36, 6);
  ctx.quadraticCurveTo(-55, 12 + armSwing, -50, 32 + armSwing);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(36, 6);
  ctx.quadraticCurveTo(55, 12 - armSwing, 50, 32 - armSwing);
  ctx.stroke();

  if (aim) {
    const angle = Math.atan2(aim.y, aim.x);
    ctx.save();
    ctx.rotate(angle);
    ctx.strokeStyle = '#f87171';
    ctx.lineWidth = 4;
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(40, 0);
    ctx.lineTo(70, 0);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(75, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}
