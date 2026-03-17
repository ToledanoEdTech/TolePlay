import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode, type MouseEvent as RMouseEvent, type TouchEvent as RTouchEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QuestionPanel } from '../QuestionPanel';
import { Wrench, Heart, Crosshair, ShoppingCart, HelpCircle, Target, Zap, Layers } from 'lucide-react';
import { socket } from '../../socket';
import { createInputState, getMoveDirection, setupKeyboardListeners } from '../../engine/input';
import { VirtualJoystick } from '../../engine/VirtualJoystick';
import {
  type Particle, type DustMote, type ShakeState,
  emitBurst, tickParticles,
  triggerShake, tickShake,
  createDust, drawDust,
  drawBeam, drawHPBar, drawGlow, colorAlpha, roundRect,
} from './renderUtils';
import { playShootSound, playLaserSound, playHitSound, playErrorSound, playSuccessSound } from '../../utils/gameSounds';
import { ensureRemoteState, stepRemoteLerp, type RenderLerpState2D } from '../../engine/netLerp';

const WORLD_SIZE = 4000;
const ZOMBIE_BASE_X = 2000;
const ZOMBIE_BASE_Y = 2000;
const BASE_RADIUS = 85;
const CAMERA_ZOOM = 0.65;
/** On mobile (≤768px), zoom out so player sees ~40–50% more world */
const CAMERA_ZOOM_MOBILE = 0.45;
const PLAYER_SPEED = 7 * 60;
/** Scale for player and zombie visuals (1.5 = 50% larger than base); keeps them smaller than houses but more visible */
const ENTITY_SCALE = 1.5;
/** Distance from player center to gun muzzle (bullet/laser origin); forward = +X in local coords */
const GUN_TIP_DISTANCE = 34 * ENTITY_SCALE;

const WEAPONS: Record<string, { id: string; name: string; damage: number; fireRate: number; color: string; cost: number; barrelLength: number }> = {
  pistol: { id: 'pistol', name: 'אקדח', damage: 25, fireRate: 400, color: '#06b6d4', cost: 0, barrelLength: 26 },
  rifle: { id: 'rifle', name: 'רובה סער', damage: 40, fireRate: 150, color: '#eab308', cost: 500, barrelLength: 38 },
  shotgun: { id: 'shotgun', name: 'שוטגאן', damage: 30, fireRate: 800, color: '#f97316', cost: 800, barrelLength: 32 },
  sniper: { id: 'sniper', name: 'צלף', damage: 150, fireRate: 1200, color: '#38bdf8', cost: 1500, barrelLength: 50 },
};

function WeaponIcon({ weaponId, size = 14, color }: { weaponId: string; size?: number; color?: string }) {
  const c = color ?? (WEAPONS[weaponId]?.color ?? '#94a3b8');
  const style = { width: size, height: size, color: c, flexShrink: 0 };
  if (weaponId === 'pistol') return <Target style={style} />;
  if (weaponId === 'rifle') return <Zap style={style} />;
  if (weaponId === 'shotgun') return <Layers style={style} />;
  if (weaponId === 'sniper') return <Crosshair style={style} />;
  return <Target style={style} />;
}

const GAME_DURATION_SEC = 6 * 60;

interface Props {
  roomCode: string;
  playerId: string;
  player: any;
  questions: any[];
  globalState: any;
  allPlayers: Record<string, any>;
  startTime?: number;
}

export function ZombieDefenseGame({ roomCode, playerId, player, questions, globalState, allPlayers, startTime }: Props) {
  const [showQuestions, setShowQuestions] = useState(false);
  const [showShop, setShowShop] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [optimisticWeapon, setOptimisticWeapon] = useState<string | null>(null);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gsRef = useRef(globalState);
  const playersRef = useRef(allPlayers);
  const posRef = useRef({
    x: player?.x ?? ZOMBIE_BASE_X + (Math.random() * 120 - 60),
    y: player?.y ?? ZOMBIE_BASE_Y + 150,
  });
  const inputRef = useRef(createInputState());
  const lastSyncRef = useRef(0);
  const lastInputTimeRef = useRef(0);
  const particlesRef = useRef<Particle[]>([]);
  const dustRef = useRef<DustMote[]>([]);
  const shakeRef = useRef<ShakeState>({ intensity: 0, offsetX: 0, offsetY: 0 });
  const prevBaseHp = useRef(globalState?.baseHealth ?? 1000);
  const timeRef = useRef(0);
  const localLasersRef = useRef<{ x1: number; y1: number; x2: number; y2: number; color: string; createdAt: number; weaponId?: string }[]>([]);
  const hitParticlesRef = useRef<{ x: number; y: number; createdAt: number }[]>([]);
  const mouseRef = useRef({ screenX: 0, screenY: 0, worldX: ZOMBIE_BASE_X, worldY: ZOMBIE_BASE_Y + 100, down: false });
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const rifleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playerRef = useRef(player);
  const weaponDisplayRef = useRef<string>(player?.modeState?.weapon ?? 'pistol');
  const firefliesRef = useRef<{ x: number; y: number; vx: number; vy: number; phase: number; color: string }[] | null>(null);
  const lastTouchFireRef = useRef(0);
  const cameraZoomRef = useRef(CAMERA_ZOOM);
  const clientProjectilesRef = useRef<{ x: number; y: number; vx: number; vy: number }[]>([]);
  const lastServerProjectilesRef = useRef<any>(null);
  const impactParticlesRef = useRef<{ x: number; y: number; vx: number; vy: number; createdAt: number; color: string }[]>([]);
  const lastProcessedHitsRef = useRef<any>(null);
  const remoteProjectilesRef = useRef<{ x: number; y: number; vx: number; vy: number; weaponType: string; projectileData?: any; playerId: string; createdAt: number }[]>([]);
  const remotePlayersRef = useRef<Record<string, RenderLerpState2D>>({});

  useEffect(() => { gsRef.current = globalState; }, [globalState]);
  useEffect(() => {
    const onRemoteShoot = (data: { x: number; y: number; vx: number; vy: number; weaponType: string; projectileData?: any; playerId: string }) => {
      if (data.playerId === playerId) return;
      remoteProjectilesRef.current.push({
        x: data.x,
        y: data.y,
        vx: data.vx,
        vy: data.vy,
        weaponType: data.weaponType || 'pistol',
        projectileData: data.projectileData,
        playerId: data.playerId,
        createdAt: Date.now(),
      });
    };
    socket.on('remoteShoot', onRemoteShoot);
    return () => { socket.off('remoteShoot', onRemoteShoot); };
  }, [playerId]);

  // Universal immediate projectile spawns (do not wait for tick).
  useEffect(() => {
    const onSpawn = (msg: any) => {
      if (!msg || msg.mode !== 'zombie') return;
      const p = msg.projectile;
      if (!p || p.kind !== 'zombieProjectile') return;
      // Only render remote spawns (local player already has immediate feedback).
      if (p.playerId === playerId) return;
      if (p.type !== 'pistol') return;
      remoteProjectilesRef.current.push({
        x: p.x,
        y: p.y,
        vx: p.vx,
        vy: p.vy,
        weaponType: p.weaponType || 'pistol',
        playerId: p.playerId,
        createdAt: Date.now(),
      });
    };
    socket.on('spawnProjectile', onSpawn);
    return () => { socket.off('spawnProjectile', onSpawn); };
  }, [playerId]);
  useEffect(() => { playersRef.current = allPlayers; }, [allPlayers]);
  useEffect(() => { playerRef.current = player; }, [player]);

  useEffect(() => {
    const newHp = globalState?.baseHealth ?? 1000;
    if (newHp < prevBaseHp.current) {
      const dmg = prevBaseHp.current - newHp;
      triggerShake(shakeRef.current, Math.min(12, dmg * 0.15));
    }
    prevBaseHp.current = newHp;
  }, [globalState]);

  useEffect(() => {
    if (player?.x === undefined || player?.y === undefined) return;
    const dx = Math.abs(posRef.current.x - player.x);
    const dy = Math.abs(posRef.current.y - player.y);
    const recentlyMoved = Date.now() - lastInputTimeRef.current < 400;
    const smallDrift = dx < 400 && dy < 400;
    if (recentlyMoved && smallDrift) return;
    if (dx > 350 || dy > 350) posRef.current = { x: player.x, y: player.y };
  }, [player?.x, player?.y]);

  // Server lasers are merged in the draw loop (with validation) so we don't get stale refs

  useEffect(() => setupKeyboardListeners(inputRef.current), []);

  const env = useMemo(() => {
    const houses: { x: number; y: number; w: number; h: number; angle: number; baseColor: string; roof1: string; roof2: string }[] = [];
    const trees: { x: number; y: number; r: number; color1: string; color2: string; offset: number }[] = [];
    const rocks: { x: number; y: number; r: number; angle: number }[] = [];
    const rnd = (seed: number) => ((Math.sin(seed * 99991) * 0.5 + 0.5) * 4294967296) >>> 0;
    const rndNorm = (seed: number) => (rnd(seed) % 10000) / 10000;
    const cellSize = 80;
    const cols = Math.floor(WORLD_SIZE / cellSize);
    const totalCells = cols * cols;
    const roadW = 180;
    const baseRadius = 320;
    const margin = 35;

    const overlapsBase = (cx: number, cy: number, r: number) =>
      Math.hypot(cx - ZOMBIE_BASE_X, cy - ZOMBIE_BASE_Y) < baseRadius + r + margin;
    const overlapsRoad = (cx: number, cy: number, r: number) =>
      Math.abs(cx - ZOMBIE_BASE_X) <= roadW / 2 + r + margin ||
      Math.abs(cy - ZOMBIE_BASE_Y) <= roadW / 2 + r + margin;
    const circlesOverlap = (x1: number, y1: number, r1: number, x2: number, y2: number, r2: number) =>
      Math.hypot(x1 - x2, y1 - y2) < r1 + r2 + margin;

    const houseCount = 72;
    for (let i = 0; i < houseCount * 3; i++) {
      if (houses.length >= houseCount) break;
      const cell = rnd(i * 7919) % totalCells;
      const cx = (cell % cols) * cellSize;
      const cy = Math.floor(cell / cols) * cellSize;
      const x = cx + rndNorm(i * 7919 + 1) * cellSize * 0.85;
      const y = cy + rndNorm(i * 7919 + 2) * cellSize * 0.85;
      const w = 70 + rndNorm(i * 3 + 100) * 90;
      const h = 70 + rndNorm(i * 3 + 101) * 90;
      const houseR = Math.max(w, h) / 2;
      if (overlapsBase(x, y, houseR) || overlapsRoad(x, y, houseR)) continue;
      const overlapsExisting = houses.some(h => circlesOverlap(x, y, houseR, h.x, h.y, Math.max(h.w, h.h) / 2));
      if (overlapsExisting) continue;
      houses.push({
        x, y, w, h,
        angle: rndNorm(i * 3 + 102) * Math.PI,
        baseColor: ['#1e293b', '#334155', '#475569'][rnd(i + 200) % 3],
        roof1: ['#0f172a', '#1e293b', '#312e81'][rnd(i + 201) % 3],
        roof2: ['#020617', '#0f172a', '#1e1b4b'][rnd(i + 202) % 3],
      });
    }

    const treeCount = 300;
    for (let i = 0; i < treeCount * 2; i++) {
      if (trees.length >= treeCount) break;
      const cell = rnd(i * 4003 + 11) % totalCells;
      const cx = (cell % cols) * cellSize;
      const cy = Math.floor(cell / cols) * cellSize;
      const x = cx + rndNorm(i * 4003 + 1) * cellSize * 0.9;
      const y = cy + rndNorm(i * 4003 + 2) * cellSize * 0.9;
      const r = 25 + rndNorm(i + 301) * 35;
      if (overlapsBase(x, y, r) || overlapsRoad(x, y, r)) continue;
      const overlapsHouse = houses.some(h => circlesOverlap(x, y, r, h.x, h.y, Math.max(h.w, h.h) / 2));
      if (overlapsHouse) continue;
      const overlapsTree = trees.some(t => circlesOverlap(x, y, r, t.x, t.y, t.r));
      if (overlapsTree) continue;
      const isDark = rnd(i + 300) % 2 === 0;
      trees.push({
        x, y, r,
        color1: isDark ? '#064e3b' : '#047857',
        color2: isDark ? '#022c22' : '#064e3b',
        offset: rndNorm(i + 302) * Math.PI * 2,
      });
    }

    const rockCount = 180;
    for (let i = 0; i < rockCount * 2; i++) {
      if (rocks.length >= rockCount) break;
      const cell = rnd(i * 6007 + 17) % totalCells;
      const cx = (cell % cols) * cellSize;
      const cy = Math.floor(cell / cols) * cellSize;
      const x = cx + rndNorm(i + 400) * cellSize;
      const y = cy + rndNorm(i + 401) * cellSize;
      const r = 5 + rndNorm(i + 402) * 12;
      if (overlapsBase(x, y, r) || overlapsRoad(x, y, r)) continue;
      const overlapsHouse = houses.some(h => circlesOverlap(x, y, r, h.x, h.y, Math.max(h.w, h.h) / 2));
      if (overlapsHouse) continue;
      const overlapsRock = rocks.some(ro => circlesOverlap(x, y, r, ro.x, ro.y, ro.r));
      if (overlapsRock) continue;
      rocks.push({ x, y, r, angle: rndNorm(i + 403) * Math.PI });
    }
    return { houses, trees, rocks };
  }, []);

  const onJoystickMove = useCallback((dx: number, dy: number) => {
    inputRef.current.joystickDir = { x: dx, y: dy };
    inputRef.current.joystickActive = true;
  }, []);
  const onJoystickRelease = useCallback(() => {
    inputRef.current.joystickDir = { x: 0, y: 0 };
    inputRef.current.joystickActive = false;
  }, []);

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
          dustRef.current = createDust(60, pw, ph);
        }
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) { raf = requestAnimationFrame(loop); return; }

      const vpW = canvas.width;
      const vpH = canvas.height;
      if (vpW === 0 || vpH === 0) { raf = requestAnimationFrame(loop); return; }

      const gs = gsRef.current;
      const players = playersRef.current;

      // ── UPDATE: player movement ──
      const dir = getMoveDirection(inputRef.current);
      if (dir.x !== 0 || dir.y !== 0) {
        lastInputTimeRef.current = now;
        posRef.current.x = Math.max(0, Math.min(WORLD_SIZE, posRef.current.x + dir.x * PLAYER_SPEED * dt));
        posRef.current.y = Math.max(0, Math.min(WORLD_SIZE, posRef.current.y + dir.y * PLAYER_SPEED * dt));
        if (now - lastSyncRef.current > 50) {
          const aimAngle = Math.atan2(mouseRef.current.worldY - posRef.current.y, mouseRef.current.worldX - posRef.current.x);
          socket.emit('updatePosition', { code: roomCode, playerId, x: posRef.current.x, y: posRef.current.y, angle: aimAngle });
          lastSyncRef.current = now;
        }
      }

      const zoom = (typeof window !== 'undefined' && window.innerWidth <= 768) ? CAMERA_ZOOM_MOBILE : CAMERA_ZOOM;
      cameraZoomRef.current = zoom;
      const camX = (vpW / 2) / zoom - posRef.current.x;
      const camY = (vpH / 2) / zoom - posRef.current.y;
      mouseRef.current.worldX = posRef.current.x + (mouseRef.current.screenX - vpW / 2) / zoom;
      mouseRef.current.worldY = posRef.current.y + (mouseRef.current.screenY - vpH / 2) / zoom;
      const vW = vpW / zoom;
      const vH = vpH / zoom;
      const isVis = (x: number, y: number, m: number) =>
        x > posRef.current.x - vW / 2 - m && x < posRef.current.x + vW / 2 + m &&
        y > posRef.current.y - vH / 2 - m && y < posRef.current.y + vH / 2 + m;

      // ── RENDER ──
      const shake = tickShake(shakeRef.current);
      ctx.save();
      ctx.translate(shake.x, shake.y);
      ctx.fillStyle = '#161c14';
      ctx.fillRect(0, 0, vpW, vpH);
      ctx.save();
      ctx.scale(zoom, zoom);
      ctx.translate(camX, camY);

      // Fireflies: init once, then drift and pulse (neon cyan/green)
      const FIREFLY_COUNT = 18;
      if (!firefliesRef.current) {
        const list: { x: number; y: number; vx: number; vy: number; phase: number; color: string }[] = [];
        for (let i = 0; i < FIREFLY_COUNT; i++) {
          list.push({
            x: Math.random() * WORLD_SIZE,
            y: Math.random() * WORLD_SIZE,
            vx: (Math.random() - 0.5) * 25,
            vy: (Math.random() - 0.5) * 25,
            phase: Math.random() * Math.PI * 2,
            color: i % 2 === 0 ? '#22d3ee' : '#4ade80',
          });
        }
        firefliesRef.current = list;
      }
      const fireflies = firefliesRef.current;
      fireflies.forEach((f) => {
        f.x += f.vx * dt * 60;
        f.y += f.vy * dt * 60;
        if (f.x < 0 || f.x > WORLD_SIZE) f.vx *= -1;
        if (f.y < 0 || f.y > WORLD_SIZE) f.vy *= -1;
        f.x = Math.max(0, Math.min(WORLD_SIZE, f.x));
        f.y = Math.max(0, Math.min(WORLD_SIZE, f.y));
      });
      fireflies.forEach((f) => {
        if (!isVis(f.x, f.y, 80)) return;
        const pulse = 0.4 + 0.35 * Math.sin(t * 2 + f.phase);
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.arc(f.x, f.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      // Rocks
      ctx.fillStyle = '#262f22';
      env.rocks.forEach((r) => {
        if (isVis(r.x, r.y, 20)) {
          ctx.beginPath();
          ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // Roads (cross at base center)
      const roadW = 180;
      ctx.fillStyle = '#1e1e24';
      ctx.fillRect(ZOMBIE_BASE_X - roadW / 2, 0, roadW, WORLD_SIZE);
      ctx.fillRect(0, ZOMBIE_BASE_Y - roadW / 2, WORLD_SIZE, roadW);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(ZOMBIE_BASE_X - roadW / 2 + 10, 0);
      ctx.lineTo(ZOMBIE_BASE_X - roadW / 2 + 10, WORLD_SIZE);
      ctx.moveTo(ZOMBIE_BASE_X + roadW / 2 - 10, 0);
      ctx.lineTo(ZOMBIE_BASE_X + roadW / 2 - 10, WORLD_SIZE);
      ctx.moveTo(0, ZOMBIE_BASE_Y - roadW / 2 + 10);
      ctx.lineTo(WORLD_SIZE, ZOMBIE_BASE_Y - roadW / 2 + 10);
      ctx.moveTo(0, ZOMBIE_BASE_Y + roadW / 2 - 10);
      ctx.lineTo(WORLD_SIZE, ZOMBIE_BASE_Y + roadW / 2 - 10);
      ctx.stroke();
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 6;
      ctx.setLineDash([40, 40]);
      ctx.beginPath();
      ctx.moveTo(ZOMBIE_BASE_X, 0);
      ctx.lineTo(ZOMBIE_BASE_X, WORLD_SIZE);
      ctx.moveTo(0, ZOMBIE_BASE_Y);
      ctx.lineTo(WORLD_SIZE, ZOMBIE_BASE_Y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Houses
      env.houses.forEach((h) => {
        if (!isVis(h.x, h.y, 150)) return;
        ctx.save();
        ctx.translate(h.x, h.y);
        ctx.rotate(h.angle);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(-h.w / 2 + 15, -h.h / 2 + 15, h.w, h.h);
        ctx.fillStyle = h.baseColor;
        ctx.fillRect(-h.w / 2, -h.h / 2, h.w, h.h);
        ctx.strokeStyle = '#020617';
        ctx.lineWidth = 2;
        ctx.strokeRect(-h.w / 2, -h.h / 2, h.w, h.h);
        ctx.fillStyle = h.roof1;
        ctx.beginPath();
        ctx.moveTo(-h.w / 2, -h.h / 2);
        ctx.lineTo(0, 0);
        ctx.lineTo(-h.w / 2, h.h / 2);
        ctx.fill();
        ctx.fillStyle = h.roof2;
        ctx.beginPath();
        ctx.moveTo(-h.w / 2, h.h / 2);
        ctx.lineTo(0, 0);
        ctx.lineTo(h.w / 2, h.h / 2);
        ctx.fill();
        ctx.fillStyle = h.roof1;
        ctx.beginPath();
        ctx.moveTo(h.w / 2, h.h / 2);
        ctx.lineTo(0, 0);
        ctx.lineTo(h.w / 2, -h.h / 2);
        ctx.fill();
        ctx.fillStyle = h.roof2;
        ctx.beginPath();
        ctx.moveTo(h.w / 2, -h.h / 2);
        ctx.lineTo(0, 0);
        ctx.lineTo(-h.w / 2, -h.h / 2);
        ctx.fill();
        ctx.restore();
      });

      // Base (octagon + H at center)
      drawBase(ctx, ZOMBIE_BASE_X, ZOMBIE_BASE_Y, (gs?.baseHealth ?? 1000) / (gs?.maxBaseHealth ?? 1000), t);

      // Turrets
      gs?.turrets?.forEach((tur: any) => {
        drawTurret(ctx, tur.x, tur.y, t, gs?.zombies ?? []);
      });

      // Consume server hit events and spawn impact particles (bullet hit zombie)
      const nowMs = Date.now();
      const recentHits = gs?.recentHits ?? [];
      if (recentHits.length > 0 && recentHits !== lastProcessedHitsRef.current) {
        lastProcessedHitsRef.current = recentHits;
        const impactColors = ['#f97316', '#fbbf24', '#facc15', '#fff'];
        recentHits.forEach((h: { x: number; y: number }) => {
          for (let i = 0; i < 4; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 80 + Math.random() * 100;
            impactParticlesRef.current.push({
              x: h.x, y: h.y,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              createdAt: nowMs,
              color: impactColors[i % impactColors.length],
            });
          }
        });
      }

      // Pistol projectiles: client-side extrapolation for smooth 60 FPS movement (server sends at 30 Hz)
      const serverProjectiles = gs?.projectiles ?? [];
      if (serverProjectiles !== lastServerProjectilesRef.current) {
        lastServerProjectilesRef.current = serverProjectiles;
        clientProjectilesRef.current = serverProjectiles
          .filter((p: any) => p.type === 'pistol')
          .map((p: any) => ({ x: p.x, y: p.y, vx: p.vx ?? 0, vy: p.vy ?? 0 }));
      }
      const TICKS_PER_SEC = 30;
      clientProjectilesRef.current.forEach((p) => {
        p.x += p.vx * TICKS_PER_SEC * dt;
        p.y += p.vy * TICKS_PER_SEC * dt;
      });
      clientProjectilesRef.current.forEach((proj) => {
        const px = proj.x;
        const py = proj.y;
        const vx = proj.vx;
        const vy = proj.vy;
        const vlen = Math.hypot(vx, vy) || 1;
        const trailLen = 70;
        const tailX = px - (vx / vlen) * trailLen;
        const tailY = py - (vy / vlen) * trailLen;
        if (!isVis(px, py, trailLen) && !isVis(tailX, tailY, trailLen)) return;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(px, py);
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.6)';
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 255, 220, 0.95)';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 255, 240, 0.98)';
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      const REMOTE_PISTOL_TTL_MS = 2000;
      const REMOTE_TRACER_TTL_MS = 350;
      remoteProjectilesRef.current = remoteProjectilesRef.current.filter((p) => {
        const age = nowMs - p.createdAt;
        const ttl = p.weaponType === 'pistol' ? REMOTE_PISTOL_TTL_MS : REMOTE_TRACER_TTL_MS;
        return age < ttl;
      });
      remoteProjectilesRef.current.forEach((p) => {
        p.x += p.vx * TICKS_PER_SEC * dt;
        p.y += p.vy * TICKS_PER_SEC * dt;
      });
      remoteProjectilesRef.current.forEach((proj) => {
        const px = proj.x;
        const py = proj.y;
        const vx = proj.vx;
        const vy = proj.vy;
        const vlen = Math.hypot(vx, vy) || 1;
        const metaColor = typeof proj.projectileData?.color === 'string' ? proj.projectileData.color : null;
        const color =
          metaColor ||
          (proj.weaponType === 'sniper' ? '#38bdf8' : proj.weaponType === 'rifle' ? '#eab308' : proj.weaponType === 'shotgun' ? '#f97316' : '#06b6d4');
        const size = typeof proj.projectileData?.size === 'number' && isFinite(proj.projectileData.size)
          ? proj.projectileData.size
          : (proj.weaponType === 'rocket' ? 10 : proj.weaponType === 'sniper' ? 6 : 5);
        const trailLen = proj.weaponType === 'pistol' ? 70 : proj.weaponType === 'sniper' ? 55 : proj.weaponType === 'rocket' ? 45 : 40;
        const tailX = px - (vx / vlen) * trailLen;
        const tailY = py - (vy / vlen) * trailLen;
        if (!isVis(px, py, trailLen) && !isVis(tailX, tailY, trailLen)) return;

        const drawTracer = (sx: number, sy: number, ex: number, ey: number, w: number) => {
          ctx.strokeStyle = colorAlpha(color, 0.65);
          ctx.lineWidth = w;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          ctx.strokeStyle = colorAlpha('#ffffff', 0.55);
          ctx.lineWidth = Math.max(1, w - 2);
          ctx.stroke();
        };

        ctx.save();
        if (proj.weaponType === 'shotgun') {
          // Visual spread (server is authoritative; this is purely cosmetic).
          const baseAng = Math.atan2(vy, vx);
          [-0.18, 0, 0.18].forEach((off) => {
            const a = baseAng + off;
            const svx = Math.cos(a) * vlen;
            const svy = Math.sin(a) * vlen;
            const sTailX = px - (svx / vlen) * (trailLen * 0.85);
            const sTailY = py - (svy / vlen) * (trailLen * 0.85);
            drawTracer(sTailX, sTailY, px, py, 3);
          });
        } else if (proj.weaponType === 'rocket') {
          drawTracer(tailX, tailY, px, py, 5);
          drawGlow(ctx, px, py, 18, color, 0.12);
          ctx.fillStyle = colorAlpha(color, 0.9);
          ctx.beginPath();
          ctx.arc(px, py, size, 0, Math.PI * 2);
          ctx.fill();
        } else if (proj.weaponType === 'sniper') {
          drawTracer(tailX, tailY, px, py, 6);
        } else {
          drawTracer(tailX, tailY, px, py, proj.weaponType === 'pistol' ? 4 : 3);
          if (proj.weaponType === 'pistol') {
            ctx.fillStyle = colorAlpha(color, 0.9);
            ctx.beginPath();
            ctx.arc(px, py, Math.max(3, size * 0.6), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      });

      // Bullet impact particles (from server recentHits): move, fade, remove after 180ms
      const IMPACT_LIFETIME_MS = 180;
      impactParticlesRef.current = impactParticlesRef.current.filter((p) => nowMs - p.createdAt < IMPACT_LIFETIME_MS);
      impactParticlesRef.current.forEach((p) => {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const age = nowMs - p.createdAt;
        const life = 1 - age / IMPACT_LIFETIME_MS;
        if (life <= 0 || !isVis(p.x, p.y, 30)) return;
        ctx.save();
        ctx.globalAlpha = life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      // Trees
      env.trees.forEach((tr) => {
        if (!isVis(tr.x, tr.y, tr.r)) return;
        ctx.save();
        ctx.translate(tr.x, tr.y);
        ctx.rotate(tr.offset);
        ctx.beginPath();
        ctx.arc(10, 10, tr.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fill();
        ctx.fillStyle = '#451a03';
        ctx.beginPath();
        ctx.arc(0, 0, tr.r * 0.2, 0, Math.PI * 2);
        ctx.fill();
        const grad = ctx.createRadialGradient(-tr.r * 0.3, -tr.r * 0.3, 0, 0, 0, tr.r);
        grad.addColorStop(0, tr.color1);
        grad.addColorStop(1, tr.color2);
        ctx.beginPath();
        ctx.arc(-tr.r * 0.2, -tr.r * 0.2, tr.r * 0.8, 0, Math.PI * 2);
        ctx.arc(tr.r * 0.3, -tr.r * 0.1, tr.r * 0.7, 0, Math.PI * 2);
        ctx.arc(0, tr.r * 0.3, tr.r * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.2)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      });

      ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
      ctx.lineWidth = 20;
      ctx.strokeRect(0, 0, WORLD_SIZE, WORLD_SIZE);

      // Use Date.now() for laser lifetime so it matches the timestamp we store on click
      const LASER_LIFETIME_MS = 280;
      const laserCut = nowMs - LASER_LIFETIME_MS;
      localLasersRef.current = localLasersRef.current.filter((l) => l.createdAt > laserCut);
      // Merge server lasers once (avoid duplicates by createdAt)
      const valid = (x: number, y: number) => Number.isFinite(x) && Number.isFinite(y) && x >= -200 && x <= WORLD_SIZE + 200 && y >= -200 && y <= WORLD_SIZE + 200;
      (gs?.lasers ?? []).forEach((l: any) => {
        const x1 = Number(l.x1), y1 = Number(l.y1), x2 = Number(l.x2), y2 = Number(l.y2);
        if (!valid(x1, y1) || !valid(x2, y2)) return;
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len > 3600 || len < 1) return;
        const created = l.createdAt ?? nowMs;
        if (localLasersRef.current.some((ex) => Math.abs(ex.createdAt - created) < 80)) return;
        localLasersRef.current.push({ x1, y1, x2, y2, color: l.color || '#06b6d4', createdAt: created, weaponId: 'pistol' });
      });
      const MAX_LASER_LEN = 3600;
      const LASER_LIFETIME_BY_WEAPON: Record<string, number> = { pistol: 200, rifle: 180, shotgun: 220, sniper: 320 };
      localLasersRef.current.forEach((l) => {
        const age = nowMs - l.createdAt;
        const maxLife = LASER_LIFETIME_BY_WEAPON[l.weaponId ?? 'pistol'] ?? LASER_LIFETIME_MS;
        const life = 1 - age / maxLife;
        if (life <= 0) return;
        const len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
        if (!Number.isFinite(len) || len < 1 || len > MAX_LASER_LEN) return;
        const wid = l.weaponId ?? 'pistol';
        ctx.save();
        ctx.globalAlpha = life;
        if (wid === 'shotgun') {
          ctx.strokeStyle = Math.random() > 0.5 ? '#f97316' : '#eab308';
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(l.x1, l.y1);
          ctx.lineTo(l.x2, l.y2);
          ctx.stroke();
        } else if (wid === 'rifle') {
          ctx.strokeStyle = '#f97316';
          ctx.lineWidth = 4;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(l.x1, l.y1);
          ctx.lineTo(l.x2, l.y2);
          ctx.stroke();
        } else if (wid === 'sniper') {
          ctx.strokeStyle = '#22d3ee';
          ctx.lineWidth = 8;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(l.x1, l.y1);
          ctx.lineTo(l.x2, l.y2);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth = 4;
          ctx.stroke();
        } else {
          const shortLen = Math.min(len, 280);
          const x2 = l.x1 + (l.x2 - l.x1) / len * shortLen;
          const y2 = l.y1 + (l.y2 - l.y1) / len * shortLen;
          ctx.strokeStyle = '#FFFF00';
          ctx.lineWidth = 4;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(l.x1, l.y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
        ctx.restore();
      });

      hitParticlesRef.current = hitParticlesRef.current.filter((p) => nowMs - p.createdAt < 380);
      hitParticlesRef.current.forEach((p) => {
        const age = nowMs - p.createdAt;
        const life = 1 - age / 380;
        if (life <= 0) return;
        if (!isVis(p.x, p.y, 50)) return;
        ctx.save();
        ctx.globalAlpha = life;
        const sparks = [[-6, -4], [5, 3], [-3, 6], [6, -5]];
        sparks.forEach(([ax, ay], i) => {
          ctx.fillStyle = i % 2 === 0 ? '#fbbf24' : '#f97316';
          ctx.beginPath();
          ctx.arc(p.x + ax, p.y + ay, 4, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.restore();
      });

      // Zombies – simplified draw when many for performance (shadowBlur is expensive)
      const zombieCount = gs?.zombies?.length ?? 0;
      const useSimplifiedZombie = zombieCount > 30;
      gs?.zombies?.forEach((z: any, idx: number) => {
        if (!isVis(z.x, z.y, 60)) return;
        drawZombieHtml(ctx, z.x, z.y, z.hp, z.maxHp, z.angle ?? 0, t, idx, z.wobbleSeed ?? idx, useSimplifiedZombie);
      });

      // Players (with stable color index and names)
      const playerList = Object.values(players || {}).filter(Boolean);
      const sortedIds = [...playerList].map((p: any) => p.id).sort();
      const fallbackColors = ['#3b82f6', '#ef4444', '#eab308', '#f97316', '#a855f7'];
      const isLocalMoving = dir.x !== 0 || dir.y !== 0;

      // Remote player interpolation state + ghost cleanup.
      const rr = remotePlayersRef.current;
      const present = new Set<string>();
      playerList.forEach((p: any) => { if (p?.id) present.add(p.id); });
      Object.keys(rr).forEach((id) => { if (!present.has(id)) delete rr[id]; });

      playerList.forEach((p: any) => {
        const isLocal = p.id === playerId;
        const tx = Number(p.x ?? ZOMBIE_BASE_X);
        const ty = Number(p.y ?? ZOMBIE_BASE_Y);
        const ta = Number(p.modeState?.angle ?? p.angle ?? 0);
        let px = tx;
        let py = ty;
        let renderAngle = ta;
        if (!isLocal) {
          const st = ensureRemoteState(rr, p.id, tx, ty, ta);
          st.targetX = tx;
          st.targetY = ty;
          st.targetAngle = ta;
          stepRemoteLerp(st, 0.2);
          px = st.renderX;
          py = st.renderY;
          renderAngle = st.renderAngle;
        } else {
          px = posRef.current.x;
          py = posRef.current.y;
        }
        const hp = p.modeState?.hp ?? 100;
        const maxHp = p.modeState?.maxHp ?? 100;
        const weapon = p.id === playerId ? (weaponDisplayRef.current || p.modeState?.weapon || 'pistol') : (p.modeState?.weapon ?? 'pistol');
        const angle = p.id === playerId
          ? Math.atan2(mouseRef.current.worldY - py, mouseRef.current.worldX - px)
          : renderAngle;
        const color = p.modeState?.playerColor ?? fallbackColors[sortedIds.indexOf(p.id) % fallbackColors.length];
        const isMoving = p.id === playerId ? isLocalMoving : false;
        drawPlayerWithWeapon(ctx, px, py, angle, hp, maxHp, weapon, t, p.id === playerId, color, isMoving);
        ctx.save();
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'white';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        const name = (p.name || 'שחקן').slice(0, 12);
        const nameY = py - 18 * ENTITY_SCALE - 18;
        ctx.strokeText(name, px, nameY);
        ctx.fillText(name, px, nameY);
        ctx.restore();
      });

      // Crosshair at aim point (world space)
      const cx = mouseRef.current.worldX;
      const cy = mouseRef.current.worldY;
      if (isVis(cx, cy, 80)) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const ch = 18;
        ctx.moveTo(cx - ch, cy);
        ctx.lineTo(cx + ch, cy);
        ctx.moveTo(cx, cy - ch);
        ctx.lineTo(cx, cy + ch);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      particlesRef.current = tickParticles(ctx, particlesRef.current);

      ctx.restore();
      drawDust(ctx, dustRef.current, vpW, vpH, '#64748b');
      const bHp = gs?.baseHealth ?? 1000;
      const minimap = minimapRef.current;
      if (minimap && minimap.width !== 128) {
        minimap.width = 128;
        minimap.height = 128;
      }
      if (minimap && minimap.getContext('2d')) {
        const mCtx = minimap.getContext('2d')!;
        mCtx.fillStyle = '#0f172a';
        mCtx.fillRect(0, 0, 128, 128);
        const scale = 128 / WORLD_SIZE;
        mCtx.fillStyle = '#3b82f6';
        mCtx.beginPath();
        mCtx.arc(ZOMBIE_BASE_X * scale, ZOMBIE_BASE_Y * scale, 4, 0, Math.PI * 2);
        mCtx.fill();
        mCtx.strokeStyle = '#facc15';
        mCtx.lineWidth = 2;
        mCtx.beginPath();
        mCtx.arc(posRef.current.x * scale, posRef.current.y * scale, 3, 0, Math.PI * 2);
        mCtx.stroke();
        mCtx.fillStyle = '#22d3ee';
        mCtx.fill();
        gs?.zombies?.forEach((z: any) => {
          mCtx.fillStyle = '#ef4444';
          mCtx.fillRect(z.x * scale - 1, z.y * scale - 1, 2, 2);
        });
      }
      const bMax = gs?.maxBaseHealth ?? 1000;
      if (bHp < bMax * 0.4) {
        const warn = 1 - bHp / (bMax * 0.4);
        const pulse = 0.5 + 0.5 * Math.sin(t * 4);
        ctx.fillStyle = `rgba(220,38,38,${warn * pulse * 0.08})`;
        ctx.fillRect(0, 0, vpW, vpH);
      }
      ctx.restore();
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [roomCode, playerId]);

  const updateMouse = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    mouseRef.current.screenX = clientX - rect.left;
    mouseRef.current.screenY = clientY - rect.top;
  }, []);

  const fireOneShot = useCallback(() => {
    const canvas = canvasRef.current;
    const pl = playerRef.current;
    const ammo = pl?.modeState?.ammo ?? 0;
    if (ammo < 1) {
      if (rifleIntervalRef.current) {
        clearInterval(rifleIntervalRef.current);
        rifleIntervalRef.current = null;
      }
      playErrorSound();
      return;
    }
    if (!canvas) return;
    const vpW = canvas.width;
    const vpH = canvas.height;
    const playerX = posRef.current.x;
    const playerY = posRef.current.y;
    const zoom = cameraZoomRef.current;
    const worldX = playerX + (mouseRef.current.screenX - vpW / 2) / zoom;
    const worldY = playerY + (mouseRef.current.screenY - vpH / 2) / zoom;
    const weapon = weaponDisplayRef.current || (pl?.modeState?.weapon ?? 'pistol');
    const wpn = WEAPONS[weapon];
    const weaponRange = wpn ? (weapon === 'sniper' ? 3000 : weapon === 'shotgun' ? 2500 : 2800) : 2800;
    const toScreenEdge = Math.hypot(vpW / 2, vpH / 2) / zoom;
    const range = Math.max(weaponRange, toScreenEdge);
    const aimAngle = Math.atan2(worldY - playerY, worldX - playerX);
    const now = Date.now();

    const gunTipX = playerX + Math.cos(aimAngle) * GUN_TIP_DISTANCE;
    const gunTipY = playerY + Math.sin(aimAngle) * GUN_TIP_DISTANCE;
    if (weapon === 'shotgun') {
      const spreadOffsets = [-0.2, -0.1, 0, 0.1, 0.2];
      spreadOffsets.forEach((off) => {
        const a = aimAngle + off;
        const ex = gunTipX + Math.cos(a) * range;
        const ey = gunTipY + Math.sin(a) * range;
        localLasersRef.current.push({ x1: gunTipX, y1: gunTipY, x2: ex, y2: ey, color: (wpn?.color) ?? '#f97316', createdAt: now, weaponId: 'shotgun' });
      });
      socket.emit('action', { code: roomCode, playerId, actionType: 'shoot_zombie', aimAngle });
    } else if (weapon !== 'pistol') {
      // Rifle/Sniper: instant raycast laser on client
      const endX = gunTipX + Math.cos(aimAngle) * range;
      const endY = gunTipY + Math.sin(aimAngle) * range;
      localLasersRef.current.push({
        x1: gunTipX, y1: gunTipY, x2: endX, y2: endY,
        color: (wpn?.color) ?? '#06b6d4',
        createdAt: now,
        weaponId: weapon,
      });
      let targetId: string | undefined;
      let hitZombie: { x: number; y: number } | null = null;
      const zombies = gsRef.current?.zombies ?? [];
      let minDistToClick = Infinity;
      zombies.forEach((z: any) => {
        const distFromPlayer = Math.hypot(z.x - playerX, z.y - playerY);
        if (distFromPlayer > range) return;
        const distToClick = Math.hypot(z.x - worldX, z.y - worldY);
        if (distToClick < minDistToClick) {
          minDistToClick = distToClick;
          targetId = typeof z.id === 'string' ? z.id : String(z.id);
          hitZombie = { x: z.x, y: z.y };
        }
      });
      socket.emit('action', {
        code: roomCode,
        playerId,
        actionType: 'shoot_zombie',
        targetId: targetId ?? undefined,
        aimAngle,
      });
      if (targetId && hitZombie) {
        playHitSound();
        hitParticlesRef.current.push({ x: hitZombie.x, y: hitZombie.y, createdAt: now });
      }
    } else {
      // Pistol: server spawns physical projectile; no instant laser on client
      socket.emit('action', { code: roomCode, playerId, actionType: 'shoot_zombie', aimAngle });
    }
    triggerShake(shakeRef.current, weapon === 'sniper' ? 5 : 3);
    playShootSound();
    playLaserSound();
  }, [roomCode, playerId]);

  useEffect(() => () => {
    if (rifleIntervalRef.current) {
      clearInterval(rifleIntervalRef.current);
      rifleIntervalRef.current = null;
    }
  }, []);

  const handleCanvasClick = useCallback((e: RMouseEvent<HTMLCanvasElement> | RTouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const target = 'target' in e ? e.target : (e as React.SyntheticEvent).nativeEvent?.target;
    if (target && target !== canvas) return;
    e.preventDefault?.();
    const isTouch = 'touches' in e && e.touches?.length > 0;
    if (!isTouch && Date.now() - lastTouchFireRef.current < 400) return;
    const ammo = player?.modeState?.ammo ?? 0;
    if (ammo < 1) {
      playErrorSound();
      return;
    }
    let clientX: number, clientY: number;
    if (isTouch) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
      lastTouchFireRef.current = Date.now();
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    updateMouse(clientX, clientY);
    const weapon = player?.modeState?.weapon ?? 'pistol';
    if (weapon === 'rifle') return;
    fireOneShot();
  }, [player?.modeState?.ammo, player?.modeState?.weapon, updateMouse, fireOneShot]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || e.target !== canvas) return;
    const weapon = playerRef.current?.modeState?.weapon ?? 'pistol';
    if (weapon !== 'rifle') return;
    if ((playerRef.current?.modeState?.ammo ?? 0) < 1) return;
    updateMouse(e.clientX, e.clientY);
    fireOneShot();
    if (rifleIntervalRef.current) clearInterval(rifleIntervalRef.current);
    rifleIntervalRef.current = setInterval(fireOneShot, 150);
  }, [updateMouse, fireOneShot]);

  const handlePointerUp = useCallback(() => {
    if (rifleIntervalRef.current) {
      clearInterval(rifleIntervalRef.current);
      rifleIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches[0]) handleCanvasClick(e as unknown as RTouchEvent<HTMLCanvasElement>);
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches[0]) updateMouse(e.touches[0].clientX, e.touches[0].clientY);
    };
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
    };
  }, [handleCanvasClick, updateMouse]);

  const switchWeaponTo = useCallback((id: string) => {
    if (!WEAPONS[id]) return;
    setOptimisticWeapon(id);
    socket.emit('switchWeapon', { code: roomCode, playerId, weaponId: id });
  }, [roomCode, playerId]);

  const buyUpgrade = (id: string, cost: number) => {
    socket.emit('buyUpgrade', { code: roomCode, playerId, upgradeId: id, cost });
  };
  const onCorrect = useCallback(() => {
    playSuccessSound();
    socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: true });
  }, [roomCode, playerId]);
  const onWrong = useCallback(() => {
    playErrorSound();
    socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: false });
  }, [roomCode, playerId]);

  const serverWeapon = player?.modeState?.weapon ?? 'pistol';
  const weaponId = optimisticWeapon ?? serverWeapon;
  useEffect(() => {
    setOptimisticWeapon(null);
  }, [serverWeapon]);
  useEffect(() => {
    weaponDisplayRef.current = weaponId;
  }, [weaponId]);

  const baseHp = globalState?.baseHealth ?? 0;
  const maxHp = globalState?.maxBaseHealth ?? 1000;
  const wave = globalState?.wave ?? 1;
  const zombieCount = globalState?.zombies?.length ?? 0;
  const turretCount = globalState?.turrets?.length ?? 0;
  const hpPct = maxHp > 0 ? baseHp / maxHp : 1;
  const coins = Math.floor(player?.resources ?? 0);
  const ammo = Math.floor(player?.modeState?.ammo ?? 0);
  const weaponName = (WEAPONS[weaponId]?.name) ?? 'אקדח';
  const showOutOfAmmo = ammo <= 0 && (globalState?.zombies?.length || 0) > 0;
  const elapsed = startTime ? (now - startTime) / 1000 : 0;
  const timeLeftSec = Math.max(0, Math.floor(GAME_DURATION_SEC - elapsed));
  const timerStr = `${Math.floor(timeLeftSec / 60)}:${(timeLeftSec % 60).toString().padStart(2, '0')}`;

  return (
    <div className="zombie-game-root fixed inset-0 bg-[#08090d] text-white flex flex-col">
      {/* Full-screen game canvas – z-0 so overlays can sit on top */}
      <div className="absolute inset-0 z-0">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
          style={{ touchAction: 'none' }}
          onClick={handleCanvasClick}
          onMouseMove={(e) => updateMouse(e.clientX, e.clientY)}
          onMouseDown={() => { mouseRef.current.down = true; }}
          onMouseUp={() => { mouseRef.current.down = false; }}
          onMouseLeave={() => { mouseRef.current.down = false; }}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
        <div className="absolute top-20 right-2 w-24 h-24 min-[480px]:top-24 min-[480px]:left-4 min-[480px]:w-32 min-[480px]:h-32 bg-slate-900/80 border-2 border-slate-700 rounded-lg pointer-events-none overflow-hidden backdrop-blur-md opacity-80" dir="ltr">
          <canvas ref={minimapRef} width={128} height={128} className="w-full h-full" />
        </div>
        {/* Local leaderboard removed — use universal `Leaderboard` overlay in `PlayerView`. */}
        <AnimatePresence>
          {baseHp < maxHp * 0.25 && baseHp > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: [0.05, 0.2, 0.05] }}
              exit={{ opacity: 0 }}
              transition={{ repeat: Infinity, duration: 0.8 }}
              className="absolute inset-0 border-4 border-red-500/60 pointer-events-none"
            />
          )}
        </AnimatePresence>
      </div>

      {/* HUD – responsive for mobile: wrap, no overlap */}
      <div className="absolute top-0 left-0 right-0 z-20 px-2 pt-1.5 pb-2 min-[480px]:p-2 bg-gradient-to-b from-black/85 to-transparent pointer-events-none">
        <div className="flex flex-wrap gap-1.5 items-center justify-between">
          <div className="flex flex-wrap gap-1.5 items-center min-w-0">
            <span className="text-[10px] min-[480px]:text-xs font-bold text-blue-300 shrink-0">הגנת זומבים</span>
            <span className="text-[10px] min-[480px]:text-[11px] bg-emerald-900/60 px-1.5 py-0.5 rounded font-mono font-bold shrink-0">⏱ {timerStr}</span>
            <span className="text-[10px] min-[480px]:text-[11px] bg-red-900/60 px-1.5 py-0.5 rounded shrink-0">🧟 {zombieCount}</span>
            <span className="text-[10px] min-[480px]:text-[11px] bg-indigo-900/60 px-1.5 py-0.5 rounded shrink-0">גל {wave}</span>
            <span className="text-[10px] min-[480px]:text-[11px] bg-cyan-900/60 px-1.5 py-0.5 rounded shrink-0">🗼 {turretCount}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 items-center shrink-0">
            <span className="text-[10px] min-[480px]:text-sm font-bold text-amber-300 bg-amber-900/70 px-2 py-0.5 rounded border border-amber-600/50">🎯 {ammo}</span>
            <span className="text-[10px] min-[480px]:text-sm font-bold text-yellow-300 bg-yellow-900/50 px-2 py-0.5 rounded border border-yellow-600/40">💰 {coins}</span>
          </div>
        </div>
        <div className="mt-1.5 h-7 min-[480px]:h-8 bg-slate-800/90 rounded-full overflow-hidden border-2 border-slate-600/50 relative flex items-center">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${hpPct * 100}%`,
              background: hpPct > 0.5 ? 'linear-gradient(90deg,#22c55e,#3b82f6)' : hpPct > 0.25 ? 'linear-gradient(90deg,#eab308,#f97316)' : 'linear-gradient(90deg,#ef4444,#dc2626)',
            }}
            animate={{ width: `${hpPct * 100}%` }}
            transition={{ duration: 0.3 }}
          />
          <span className="relative z-10 w-full text-center text-xs min-[480px]:text-sm font-bold text-white drop-shadow-md">
            בסיס: {Math.floor(baseHp)}/{maxHp}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-0.5 items-center">
          <span className="text-[10px] min-[480px]:text-[11px] text-cyan-400">{weaponName}</span>
          <span className="text-[10px] min-[480px]:text-[11px] text-slate-400">⭐ {player?.score ?? 0}</span>
        </div>
      </div>

      {/* Out of ammo banner – below HUD, not overlapping */}
      <AnimatePresence>
        {showOutOfAmmo && (
          <motion.div
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -50, opacity: 0 }}
            className="absolute top-16 min-[480px]:top-14 left-2 right-2 min-[480px]:left-1/2 min-[480px]:right-auto min-[480px]:-translate-x-1/2 min-[480px]:max-w-sm z-30 bg-amber-900/95 backdrop-blur px-3 py-2 min-[480px]:px-4 min-[480px]:py-3 rounded-xl border-2 border-amber-500/60 shadow-xl pointer-events-none"
          >
            <p className="text-amber-100 font-bold text-center text-sm min-[480px]:text-base">💥 נגמרה התחמושת!</p>
            <p className="text-amber-200/90 text-xs min-[480px]:text-sm text-center mt-0.5 min-[480px]:mt-1">לחץ על &quot;שאלות&quot; וענה נכון כדי למלא תחמושת (+10)</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Weapon switcher: list of ALL purchased weapons; container ignores clicks except on buttons */}
      <div className="zombie-weapon-strip fixed left-0 right-0 bottom-20 z-[100] flex flex-row items-center gap-1.5 pointer-events-none py-1.5 px-2 overflow-x-auto overflow-y-hidden" dir="ltr">
        <span className="text-[10px] text-slate-300 font-bold shrink-0 hidden sm:inline">נשק:</span>
        {(() => {
          const owned = player?.modeState?.ownedWeapons;
          const list = Array.isArray(owned) ? owned : [];
          const withPistol = list.includes('pistol') ? list : ['pistol', ...list];
          const withCurrent = player?.modeState?.weapon && !withPistol.includes(player.modeState.weapon)
            ? [...withPistol, player.modeState.weapon]
            : withPistol;
          const allOwned = [...new Set(withCurrent)].filter((id): id is string => !!WEAPONS[id]);
          if (allOwned.length === 0) return null;
          return allOwned.map((id) => {
            const w = WEAPONS[id];
            const isActive = weaponId === id;
            return (
              <button
                key={id}
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  switchWeaponTo(id);
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  switchWeaponTo(id);
                }}
                className={`zombie-weapon-btn pointer-events-auto flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 sm:py-2.5 rounded-lg sm:rounded-xl text-[10px] sm:text-[11px] font-bold border-2 min-h-[40px] min-w-[40px] sm:min-h-[48px] sm:min-w-[48px] touch-manipulation cursor-pointer select-none bg-slate-800/95 backdrop-blur shrink-0 ${isActive ? 'ring-2 ring-cyan-400 bg-slate-600 border-cyan-400' : 'border-slate-500 hover:bg-slate-700 active:scale-95'}`}
                style={{ borderColor: isActive ? w.color : undefined }}
                title={w.name}
              >
                <div className="weapon-icon-wrap">
                  <img src={`/assets/${id}.png`} alt={w.name} className="weapon-icon w-10 h-10 object-contain" />
                </div>
                <span className="hidden min-[400px]:inline truncate max-w-[60px]">{w.name}</span>
              </button>
            );
          });
        })()}
      </div>

      {/* Bottom: joystick left, שאלות + חנות right; compact on mobile */}
      <div className="zombie-bottom-bar absolute bottom-1 left-0 right-0 z-20 flex items-end justify-between gap-1 sm:gap-2 px-1.5 sm:px-4 pb-0.5 pointer-events-none">
        <div className="pointer-events-auto">
          <VirtualJoystick onMove={onJoystickMove} onRelease={onJoystickRelease} size={110} teamColor="rgba(34,211,238,0.5)" />
        </div>
        <div className="flex items-center justify-end gap-1 sm:gap-2 pointer-events-auto shrink-0" dir="ltr">
          <button
            onClick={() => setShowQuestions(true)}
            className="zombie-bottom-btn px-2 py-1.5 sm:px-5 sm:py-3 rounded-lg sm:rounded-xl font-bold text-xs sm:text-base bg-blue-600 hover:bg-blue-500 text-white shadow border border-blue-500/50 flex items-center gap-1 sm:gap-2 min-h-[40px] sm:min-h-[48px]"
          >
            <HelpCircle size={14} className="sm:w-[18px] sm:h-[18px] shrink-0" /> <span className="hidden min-[400px]:inline">שאלות (+תחמושת)</span><span className="min-[400px]:hidden">שאלות</span>
          </button>
          <button
            onClick={() => setShowShop(true)}
            className="zombie-bottom-btn px-2 py-1.5 sm:px-5 sm:py-3 rounded-lg sm:rounded-xl font-bold text-xs sm:text-base bg-emerald-600 hover:bg-emerald-500 text-white shadow border border-emerald-500/50 flex items-center gap-1 sm:gap-2 min-h-[40px] sm:min-h-[48px]"
          >
            <ShoppingCart size={14} className="sm:w-[18px] sm:h-[18px] shrink-0" /> <span className="hidden min-[380px]:inline">חנות</span>
          </button>
        </div>
      </div>

      {/* Questions modal - Kahoot style */}
      <AnimatePresence>
        {showQuestions && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowQuestions(false)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="zombie-game-modal bg-slate-900 rounded-2xl border border-slate-600 shadow-2xl max-w-lg w-full max-h-[85vh] overflow-hidden"
            >
              <div className="p-4 border-b border-slate-700 flex justify-between items-center">
                <span className="font-bold text-cyan-400">ענה על שאלות - כל תשובה נכונה = +10 תחמושת!</span>
                <button onClick={() => setShowQuestions(false)} className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 font-bold">סיום ✓</button>
              </div>
              <div className="overflow-y-auto max-h-[calc(85vh-80px)]">
                <QuestionPanel questions={questions} onCorrect={onCorrect} onWrong={onWrong} earnLabel="+10 תחמושת" compact />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Shop modal */}
      <AnimatePresence>
        {showShop && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowShop(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              className="zombie-game-modal bg-slate-900 rounded-2xl border border-slate-600 shadow-2xl max-w-md w-full max-h-[80vh] overflow-hidden"
            >
              <div className="p-4 border-b border-slate-700 flex justify-between items-center">
                <span className="font-bold text-emerald-400">חנות</span>
                <button onClick={() => setShowShop(false)} className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 font-bold">סגור</button>
              </div>
              <div className="p-4 space-y-2 overflow-y-auto zombie-game-modal-content">
                {(() => {
                  const owned = (player?.modeState?.ownedWeapons ?? ['pistol']).filter((id: string) => WEAPONS[id]);
                  const uniqueOwned = [...new Set(owned)];
                  if (uniqueOwned.length === 0) return null;
                  return (
                    <div className="mb-4 p-3 bg-slate-800/70 rounded-xl border border-slate-600">
                      <p className="text-slate-300 text-sm font-bold mb-2">החלף נשק פעיל</p>
                      <div className="zombie-shop-weapons flex flex-wrap gap-2" dir="ltr">
                        {uniqueOwned.map((id: string) => {
                          const w = WEAPONS[id];
                          const isActive = weaponId === id;
                          return w ? (
                            <button
                              key={`shop-${id}`}
                              type="button"
                              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); switchWeaponTo(id); }}
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); switchWeaponTo(id); }}
                              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold border-2 ${isActive ? 'ring-2 ring-cyan-400' : 'hover:bg-slate-700'}`}
                              style={{ borderColor: w.color, background: isActive ? 'rgba(30,41,59,0.9)' : undefined }}
                            >
                              <div className="weapon-icon-wrap">
                                <img src={`/assets/${id}.png`} alt={w.name} className="weapon-icon w-10 h-10 object-contain" />
                              </div>
                              {w.name}
                            </button>
                          ) : null;
                        })}
                      </div>
                    </div>
                  );
                })()}
                <p className="text-slate-400 text-sm font-bold mb-2">נשקייה (מטבעות)</p>
                <div className="zombie-shop-upgrades flex flex-wrap gap-2">
                {Object.entries(WEAPONS).map(([key, w]) => {
                  const ownedList = player?.modeState?.ownedWeapons ?? ['pistol'];
                  const isOwned = ownedList.includes(key);
                  const canAfford = coins >= w.cost;
                  return (
                    <ShopButton
                      key={key}
                      title={w.name}
                      desc={isOwned ? 'במאגר – בחר למעלה' : `נזק ${w.damage} | קצב ${w.fireRate}ms`}
                      cost={w.cost}
                      icon={<div className="weapon-icon-wrap"><img src={`/assets/${key}.png`} alt={w.name} className="weapon-icon w-10 h-10 object-contain" /></div>}
                      canAfford={!isOwned && canAfford}
                      onBuy={() => { if (!isOwned && canAfford) buyUpgrade(key, w.cost); }}
                    />
                  );
                })}
                </div>
                <p className="text-slate-400 text-sm font-bold mt-4 mb-2">שדרוגים</p>
                <div className="zombie-shop-upgrades flex flex-wrap gap-2">
                <ShopButton title="בנה צריח" desc="צריח אוטומטי שיורה בזומבים" cost={500}
                  icon={<Crosshair className="text-cyan-400" size={18} />}
                  canAfford={coins >= 500} onBuy={() => buyUpgrade('turret', 500)} />
                <ShopButton title="תקן בסיס" desc="שחזר 500 נקודות חיים לבסיס" cost={400}
                  icon={<Wrench className="text-blue-400" size={18} />}
                  canAfford={coins >= 400} onBuy={() => buyUpgrade('repair', 400)} />
                <ShopButton title="ריפוי קבוצתי" desc="מרפא את כל חברי הקבוצה" cost={300}
                  icon={<Heart className="text-pink-400" size={18} />}
                  canAfford={coins >= 300} onBuy={() => buyUpgrade('heal', 300)} />
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Base: High-Tech Protected Defense Generator Core (hex armor, intense neon core, energy lines) ──
const BASE_VISUAL_SCALE = 1.75;
function drawBase(ctx: CanvasRenderingContext2D, x: number, y: number, hpPct: number, t: number) {
  const R = BASE_RADIUS * BASE_VISUAL_SCALE;
  const now = Date.now();
  ctx.save();
  ctx.translate(x, y);

  // Outer armored ring: stylized hexagonal plates (grey / dark blue)
  const hexCount = 14;
  const hexRadius = 22;
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  ctx.fillStyle = '#1e293b';
  for (let i = 0; i < hexCount; i++) {
    const baseAngle = (i / hexCount) * Math.PI * 2 - Math.PI / 2;
    const cx = Math.cos(baseAngle) * (R + 12);
    const cy = Math.sin(baseAngle) * (R + 12);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(baseAngle);
    ctx.beginPath();
    for (let v = 0; v < 6; v++) {
      const a = (v / 6) * Math.PI * 2 + Math.PI / 6;
      const px = Math.cos(a) * hexRadius;
      const py = Math.sin(a) * hexRadius;
      if (v === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = '#0f172a';
  ctx.strokeStyle = '#1e3a5f';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, R + 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Inner armor band (dark metallic)
  ctx.fillStyle = '#1e293b';
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.88, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Radiating energy lines from core (subtle)
  ctx.strokeStyle = `rgba(34, 211, 238, ${0.15 + Math.sin(now / 250) * 0.08})`;
  ctx.lineWidth = 2;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + (now / 2000) * 0.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * R * 0.75, Math.sin(a) * R * 0.75);
    ctx.stroke();
  }

  // Core housing (dark)
  ctx.fillStyle = '#0f172a';
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Central glowing core (no shadow for performance)
  const neonCyan = '#22d3ee';
  const neonGlow = '#06b6d4';
  ctx.fillStyle = `rgba(34, 211, 238, ${0.25 + Math.sin(now / 180) * 0.1})`;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(34, 211, 238, ${0.5 + Math.sin(now / 220) * 0.15})`;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = neonCyan;
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#e0f7ff';
  ctx.globalAlpha = 0.9 + Math.sin(now / 150) * 0.1;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Outer energy ring (pulse)
  ctx.strokeStyle = `rgba(34, 211, 238, ${0.5 + Math.sin(now / 280) * 0.2})`;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(0, 0, R + 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ── Zombie: grotesque top-down monster; optional simplified mode when >30 zombies (no shadowBlur) for performance ──
function drawZombieHtml(
  ctx: CanvasRenderingContext2D, x: number, y: number,
  hp: number, maxHp: number, angle: number, t: number, idx: number, wobbleSeed: number = 0, useSimplified: boolean = false
) {
  const s = ENTITY_SCALE;
  const now = Date.now();
  const phase = now / 320 + wobbleSeed * 10;
  const rotWobble = useSimplified ? 0 : Math.sin(phase) * 0.18 + Math.sin(phase * 2.3) * 0.08;
  const sideSway = useSimplified ? 0 : Math.sin(phase * 1.7) * 4 * s;
  const bob = useSimplified ? 0 : Math.sin(phase * 2) * 2 * s;

  ctx.save();
  ctx.translate(x + sideSway * Math.cos(angle + Math.PI / 2), y + sideSway * Math.sin(angle + Math.PI / 2));
  ctx.rotate(angle + rotWobble);
  ctx.translate(0, bob);

  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 4 * s, 22 * s, 28 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tattered clothing (torso) – no shadow for performance – visible grey-brown rags
  ctx.fillStyle = '#5c5349';
  ctx.strokeStyle = '#3d3630';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(0, 4 * s, 18 * s, 24 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#6b6258';
  ctx.beginPath();
  ctx.ellipse(-6 * s, 2 * s, 8 * s, 10 * s, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(7 * s, 6 * s, 6 * s, 12 * s, -0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#4a4238';
  ctx.beginPath();
  ctx.ellipse(5 * s, -4 * s, 5 * s, 8 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body – bright toxic green / pale sickly skin (high contrast)
  const skinGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 20 * s);
  skinGrad.addColorStop(0, '#a3e635');
  skinGrad.addColorStop(0.4, '#84cc16');
  skinGrad.addColorStop(0.7, '#65a30d');
  skinGrad.addColorStop(1, '#4d7c0f');
  ctx.fillStyle = skinGrad;
  ctx.beginPath();
  ctx.ellipse(0, 2 * s, 14 * s, 20 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#3f6212';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Head – bright toxic green, visible
  const headGrad = ctx.createRadialGradient(0, -2 * s, 0, 0, 0, 14 * s);
  headGrad.addColorStop(0, '#bef264');
  headGrad.addColorStop(0.5, '#a3e635');
  headGrad.addColorStop(1, '#65a30d');
  ctx.fillStyle = headGrad;
  ctx.strokeStyle = '#4d7c0f';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, -16 * s, 14 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.arc(-4 * s, -18 * s, 3 * s, 0, Math.PI * 2);
  ctx.arc(4 * s, -18 * s, 3 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#374151';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, -12 * s, 4 * s, 0.2 * Math.PI, 0.8 * Math.PI);
  ctx.stroke();

  // Arms reaching forward (toward player)
  const armGrad = ctx.createLinearGradient(0, 0, 0, 24 * s);
  armGrad.addColorStop(0, '#84cc16');
  armGrad.addColorStop(1, '#65a30d');
  ctx.fillStyle = armGrad;
  ctx.strokeStyle = '#4d7c0f';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(-11 * s, 10 * s, 6 * s, 20 * s, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(11 * s, 10 * s, 6 * s, 20 * s, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#422006';
  ctx.beginPath();
  ctx.arc(-11 * s, 28 * s, 5 * s, 0, Math.PI * 2);
  ctx.arc(11 * s, 28 * s, 5 * s, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // Health bar – brighter red for visibility
  const barW = 42 * s;
  const barH = 6 * s;
  const barY = y - 40 * s;
  ctx.fillStyle = '#1c1917';
  ctx.fillRect(x - barW / 2 - 1, barY - 1, barW + 2, barH + 2);
  ctx.fillStyle = '#f87171';
  ctx.fillRect(x - barW / 2, barY, barW * (Math.max(0, hp) / maxHp), barH);
  ctx.strokeStyle = '#dc2626';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - barW / 2, barY, barW, barH);
}

// Futuristic soldier: helmet at (0,0), jetpack/vest/belt, walking animation, distinct colors, weapon by id
function drawPlayerWithWeapon(
  ctx: CanvasRenderingContext2D, x: number, y: number, angle: number,
  hp: number, maxHp: number, weaponId: string, t: number, isMe: boolean, accentColor?: string, isMoving?: boolean
) {
  const s = ENTITY_SCALE;
  const now = Date.now() / 1000;
  const phase = now * 4.5;
  const BORDER = '#0d0d0d';
  const BORDER_W = 2.5;
  const metalDark = '#1f2937';
  const metalMid = '#374151';
  const metalLight = '#4b5563';
  const playerColor = accentColor ? colorAlpha(accentColor, 1) : '#3b82f6';
  const playerColorDim = accentColor ? colorAlpha(accentColor, 0.85) : '#2563eb';
  const playerColorDark = accentColor ? colorAlpha(accentColor, 0.6) : '#1d4ed8';
  const visorGlow = accentColor || '#06b6d4';
  const torsoSwayX = isMoving ? Math.sin(phase) * 2.5 * s : 0;
  const torsoSwayY = isMoving ? Math.cos(phase * 0.8) * 1.5 * s : 0;
  const shoulderOppose = isMoving ? -Math.sin(phase) * 2 * s : 0;
  const armSwing = isMoving ? Math.sin(phase + 0.3) * 1.5 * s : 0;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // Head drawn at (0,0). No extra translate; breathe applied only to body/shadow positions.

  // 1. Shadow (offset down-right in local “forward” frame)
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  const torsoCy = 15 * s + torsoSwayY;
  const torsoW = 24 * s;
  const torsoH = 14 * s;
  ctx.ellipse(torsoSwayX * 0.5, torsoCy + 2 * s, torsoW * 0.9, torsoH * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(-8 * s + torsoSwayX * 0.3, torsoCy);
  const packGrad = ctx.createLinearGradient(-12 * s, 0, 12 * s, 0);
  packGrad.addColorStop(0, '#0f172a');
  packGrad.addColorStop(0.5, metalDark);
  packGrad.addColorStop(1, '#0f172a');
  ctx.fillStyle = packGrad;
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = BORDER_W;
  ctx.beginPath();
  ctx.ellipse(0, 0, 10 * s, 12 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = playerColorDark;
  ctx.strokeStyle = BORDER;
  ctx.beginPath();
  ctx.ellipse(-2 * s, 0, 4 * s, 6 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(torsoSwayX, torsoCy);
  const vestGrad = ctx.createLinearGradient(-torsoW, 0, torsoW, 0);
  vestGrad.addColorStop(0, '#0f172a');
  vestGrad.addColorStop(0.35, metalDark);
  vestGrad.addColorStop(0.5, metalMid);
  vestGrad.addColorStop(0.65, metalDark);
  vestGrad.addColorStop(1, '#0f172a');
  ctx.fillStyle = vestGrad;
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = BORDER_W;
  ctx.beginPath();
  ctx.ellipse(0, 0, torsoW, torsoH, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = metalDark;
  ctx.strokeStyle = BORDER;
  ctx.beginPath();
  ctx.ellipse(0, 0, 6 * s, 8 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  const beltY = torsoCy + torsoH * 0.6;
  ctx.fillStyle = playerColor;
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = BORDER_W;
  ctx.beginPath();
  ctx.ellipse(torsoSwayX, beltY, 20 * s, 5 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const shoulderY = 6 * s + shoulderOppose * 0.5;
  const shoulderLx = -14 * s + torsoSwayX * 0.4;
  const shoulderRx = 12 * s + torsoSwayX * 0.4;
  ctx.fillStyle = playerColor;
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = BORDER_W;
  ctx.beginPath();
  ctx.ellipse(shoulderLx, shoulderY - 8 * s, 6 * s, 9 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(shoulderRx, shoulderY - 8 * s, 6 * s, 9 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const armY = shoulderY + armSwing;
  ctx.fillStyle = metalMid;
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(shoulderLx - 2 * s, armY - 4 * s, 6 * s, 14 * s, 2);
    ctx.roundRect(shoulderRx, armY - 3 * s, 20 * s, 6 * s, 2);
  } else {
    ctx.rect(shoulderLx - 2 * s, armY - 4 * s, 6 * s, 14 * s);
    ctx.rect(shoulderRx, armY - 3 * s, 20 * s, 6 * s);
  }
  ctx.fill();
  ctx.stroke();

  const headR = 12 * s;
  const helmetGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, headR);
  helmetGrad.addColorStop(0, metalLight);
  helmetGrad.addColorStop(0.4, metalMid);
  helmetGrad.addColorStop(0.8, metalDark);
  helmetGrad.addColorStop(1, '#0f172a');
  ctx.fillStyle = helmetGrad;
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = BORDER_W;
  ctx.beginPath();
  ctx.arc(0, 0, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const visorGrad = ctx.createRadialGradient(-3 * s, -2 * s, 0, 0, 0, 10 * s);
  visorGrad.addColorStop(0, visorGlow);
  visorGrad.addColorStop(0.6, colorAlpha(visorGlow, 0.5));
  visorGrad.addColorStop(1, colorAlpha(visorGlow, 0.15));
  ctx.fillStyle = visorGrad;
  ctx.beginPath();
  ctx.arc(0, 0, 9 * s, -0.4, 0.4);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = playerColor;
  ctx.lineWidth = BORDER_W;
  ctx.stroke();
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, 10 * s, -Math.PI / 2.5, Math.PI / 2.5);
  ctx.stroke();

  const weaponX = 20 * s + armSwing;
  const weaponY = armY + 2 * s;
  ctx.save();
  ctx.translate(weaponX, weaponY);
  switch (weaponId) {
    case 'pistol':
      ctx.fillStyle = metalDark;
      ctx.strokeStyle = BORDER;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(0, -2.5 * s, 14 * s, 5 * s, 1);
      else ctx.rect(0, -2.5 * s, 14 * s, 5 * s);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = visorGlow;
      ctx.beginPath();
      ctx.arc(14 * s, 0, 3 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    case 'rifle':
      ctx.fillStyle = metalDark;
      ctx.strokeStyle = BORDER;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(0, -3 * s, 28 * s, 6 * s, 1);
      else ctx.rect(0, -3 * s, 28 * s, 6 * s);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = metalMid;
      ctx.fillRect(12 * s, -4.5 * s, 8 * s, 3 * s);
      ctx.strokeStyle = BORDER;
      ctx.strokeRect(12 * s, -4.5 * s, 8 * s, 3 * s);
      ctx.fillStyle = playerColorDim;
      ctx.beginPath();
      ctx.arc(28 * s, 0, 3.5 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    case 'shotgun':
      ctx.fillStyle = metalDark;
      ctx.strokeStyle = BORDER;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(0, -4 * s, 18 * s, 8 * s, 1);
      else ctx.rect(0, -4 * s, 18 * s, 8 * s);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = metalMid;
      ctx.fillRect(14 * s, -5 * s, 6 * s, 4 * s);
      ctx.fillRect(14 * s, 2 * s, 6 * s, 4 * s);
      ctx.strokeStyle = BORDER;
      ctx.strokeRect(14 * s, -5 * s, 6 * s, 4 * s);
      ctx.strokeRect(14 * s, 2 * s, 6 * s, 4 * s);
      ctx.fillStyle = playerColorDim;
      ctx.beginPath();
      ctx.arc(20 * s, -2.5 * s, 2.5 * s, 0, Math.PI * 2);
      ctx.arc(20 * s, 2.5 * s, 2.5 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    case 'sniper':
      ctx.fillStyle = metalDark;
      ctx.strokeStyle = BORDER;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(0, -2.5 * s, 38 * s, 5 * s, 1);
      else ctx.rect(0, -2.5 * s, 38 * s, 5 * s);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = metalMid;
      ctx.fillRect(8 * s, -5 * s, 14 * s, 4 * s);
      ctx.strokeStyle = BORDER;
      ctx.strokeRect(8 * s, -5 * s, 14 * s, 4 * s);
      ctx.fillStyle = playerColorDim;
      ctx.beginPath();
      ctx.arc(22 * s, -2.5 * s, 5 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = visorGlow;
      ctx.beginPath();
      ctx.arc(38 * s, 0, 2.5 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    default:
      ctx.fillStyle = metalDark;
      ctx.fillRect(0, -2.5 * s, 14 * s, 5 * s);
      ctx.fillStyle = visorGlow;
      ctx.beginPath();
      ctx.arc(14 * s, 0, 2.5 * s, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
  ctx.restore();

  ctx.restore();

  const pct = hp / maxHp;
  const barColor = pct > 0.5 ? '#22c55e' : pct > 0.25 ? '#eab308' : '#ef4444';
  drawHPBar(ctx, x, y - 28 * s, 38 * s, 5 * s, pct, barColor);
}

// ── Sprite: Turret – high-tech automated sentry (1.5x scale, heavy base, double-barrel, red LED) ──
const TURRET_SCALE = 1.5;
function drawTurret(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, zombies: any[]) {
  ctx.save();
  const S = TURRET_SCALE;

  let targetAngle = t * 0.5;
  const aliveZombies = zombies?.filter((z: any) => (z.hp ?? 0) > 0) ?? [];
  if (aliveZombies.length) {
    let closest: any = null, minDist = Infinity;
    aliveZombies.forEach((z: any) => {
      const d = Math.hypot(z.x - x, z.y - y);
      if (d < minDist) { minDist = d; closest = z; }
    });
    if (closest) targetAngle = Math.atan2(closest.y - y, closest.x - x);
  }

  ctx.strokeStyle = 'rgba(34,211,238,0.06)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([3, 6]);
  ctx.beginPath(); ctx.arc(x, y, 150 * S, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#1f2937';
  ctx.strokeStyle = '#374151';
  ctx.lineWidth = 2;
  roundRect(ctx, x - 16 * S, y - 16 * S, 32 * S, 32 * S, 6 * S);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#111827';
  roundRect(ctx, x - 12 * S, y - 12 * S, 24 * S, 24 * S, 4 * S);
  ctx.fill();
  ctx.strokeStyle = '#4b5563';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(targetAngle);

  ctx.fillStyle = '#374151';
  ctx.strokeStyle = '#4b5563';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, 10 * S, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#1f2937';
  ctx.fillRect(-8 * S, -4 * S, 16 * S, 8 * S);
  ctx.strokeRect(-8 * S, -4 * S, 16 * S, 8 * S);

  const barrelLen = 28 * S;
  ctx.fillStyle = '#4b5563';
  ctx.fillRect(0, -3 * S, barrelLen, 3 * S);
  ctx.fillRect(0, 0, barrelLen, 3 * S);
  ctx.strokeStyle = '#6b7280';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, -3 * S, barrelLen, 3 * S);
  ctx.strokeRect(0, 0, barrelLen, 3 * S);
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.arc(barrelLen, -1.5 * S, 2 * S, 0, Math.PI * 2);
  ctx.arc(barrelLen, 1.5 * S, 2 * S, 0, Math.PI * 2);
  ctx.fill();

  const flash = Math.sin(t * 0.015) > 0.3;
  ctx.fillStyle = flash ? '#ef4444' : '#7f1d1d';
  ctx.beginPath();
  ctx.arc(6 * S, -6 * S, 3 * S, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#991b1b';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
  ctx.restore();
}

// ── Shop Button Component ──
function ShopButton({ title, desc, cost, icon, canAfford, onBuy }: {
  title: string; desc: string; cost: number; icon: ReactNode; canAfford: boolean; onBuy: () => void;
}) {
  return (
    <motion.button
      whileTap={canAfford ? { scale: 0.96 } : {}}
      whileHover={canAfford ? { scale: 1.01 } : {}}
      disabled={!canAfford}
      onClick={onBuy}
      className={`w-full p-3 rounded-xl flex items-center gap-3 transition-all duration-150 ${
        canAfford
          ? 'bg-slate-800/80 hover:bg-slate-700/80 border border-slate-600/50 shadow-lg hover:shadow-xl'
          : 'bg-slate-800/30 border border-slate-800/50 opacity-40'
      }`}
    >
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
        canAfford ? 'bg-slate-700/80 shadow-inner' : 'bg-slate-800/50'
      }`}>
        {icon}
      </div>
      <div className="flex-1 text-right min-w-0">
        <h4 className="font-bold text-sm">{title}</h4>
        <p className="text-[11px] text-slate-400 truncate">{desc}</p>
      </div>
      <div className={`font-bold text-xs px-3 py-1.5 rounded-lg whitespace-nowrap ${
        canAfford ? 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20' : 'bg-slate-700/50 text-slate-500'
      }`}>
        💰 {cost}
      </div>
    </motion.button>
  );
}
