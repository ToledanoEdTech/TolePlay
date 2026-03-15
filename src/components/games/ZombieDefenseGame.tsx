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

const WORLD_SIZE = 4000;
const ZOMBIE_BASE_X = 2000;
const ZOMBIE_BASE_Y = 2000;
const BASE_RADIUS = 85;
const CAMERA_ZOOM = 0.65;
const PLAYER_SPEED = 7 * 60;

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
  const localLasersRef = useRef<{ x1: number; y1: number; x2: number; y2: number; color: string; createdAt: number }[]>([]);
  const mouseRef = useRef({ screenX: 0, screenY: 0, worldX: ZOMBIE_BASE_X, worldY: ZOMBIE_BASE_Y + 100, down: false });
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const rifleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playerRef = useRef(player);
  const weaponDisplayRef = useRef<string>(player?.modeState?.weapon ?? 'pistol');

  useEffect(() => { gsRef.current = globalState; }, [globalState]);
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
    const baseCellX = Math.floor(ZOMBIE_BASE_X / cellSize);
    const baseCellY = Math.floor(ZOMBIE_BASE_Y / cellSize);
    const excludeRadius = 6;
    for (let i = 0; i < 120; i++) {
      const cell = rnd(i * 7919) % totalCells;
      const cx = (cell % cols) * cellSize;
      const cy = Math.floor(cell / cols) * cellSize;
      const cellX = cell % cols;
      const cellY = Math.floor(cell / cols);
      if (Math.abs(cellX - baseCellX) < excludeRadius && Math.abs(cellY - baseCellY) < excludeRadius) continue;
      const x = cx + rndNorm(i * 7919 + 1) * cellSize * 0.85;
      const y = cy + rndNorm(i * 7919 + 2) * cellSize * 0.85;
      if (Math.hypot(x - ZOMBIE_BASE_X, y - ZOMBIE_BASE_Y) < 320) continue;
      houses.push({
        x, y,
        w: 70 + rndNorm(i * 3 + 100) * 90,
        h: 70 + rndNorm(i * 3 + 101) * 90,
        angle: rndNorm(i * 3 + 102) * Math.PI,
        baseColor: ['#1e293b', '#334155', '#475569'][rnd(i + 200) % 3],
        roof1: ['#0f172a', '#1e293b', '#312e81'][rnd(i + 201) % 3],
        roof2: ['#020617', '#0f172a', '#1e1b4b'][rnd(i + 202) % 3],
      });
    }
    for (let i = 0; i < 500; i++) {
      const cell = rnd(i * 4003 + 11) % totalCells;
      const cx = (cell % cols) * cellSize;
      const cy = Math.floor(cell / cols) * cellSize;
      const x = cx + rndNorm(i * 4003 + 1) * cellSize * 0.9;
      const y = cy + rndNorm(i * 4003 + 2) * cellSize * 0.9;
      if (Math.hypot(x - ZOMBIE_BASE_X, y - ZOMBIE_BASE_Y) < 220) continue;
      const insideHouse = houses.some(h => Math.hypot(x - h.x, y - h.y) < Math.max(h.w, h.h) * 0.6);
      if (!insideHouse) {
        const isDark = rnd(i + 300) % 2 === 0;
        trees.push({
          x, y, r: 25 + rndNorm(i + 301) * 35,
          color1: isDark ? '#064e3b' : '#047857',
          color2: isDark ? '#022c22' : '#064e3b',
          offset: rndNorm(i + 302) * Math.PI * 2,
        });
      }
    }
    for (let i = 0; i < 300; i++) {
      const cell = rnd(i * 6007 + 17) % totalCells;
      const cx = (cell % cols) * cellSize;
      const cy = Math.floor(cell / cols) * cellSize;
      rocks.push({
        x: cx + rndNorm(i + 400) * cellSize,
        y: cy + rndNorm(i + 401) * cellSize,
        r: 5 + rndNorm(i + 402) * 12,
        angle: rndNorm(i + 403) * Math.PI,
      });
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
          socket.emit('updatePosition', { code: roomCode, playerId, x: posRef.current.x, y: posRef.current.y });
          lastSyncRef.current = now;
        }
      }

      const camX = (vpW / 2) / CAMERA_ZOOM - posRef.current.x;
      const camY = (vpH / 2) / CAMERA_ZOOM - posRef.current.y;
      mouseRef.current.worldX = posRef.current.x + (mouseRef.current.screenX - vpW / 2) / CAMERA_ZOOM;
      mouseRef.current.worldY = posRef.current.y + (mouseRef.current.screenY - vpH / 2) / CAMERA_ZOOM;
      const vW = vpW / CAMERA_ZOOM;
      const vH = vpH / CAMERA_ZOOM;
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
      ctx.scale(CAMERA_ZOOM, CAMERA_ZOOM);
      ctx.translate(camX, camY);

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
      const nowMs = Date.now();
      const LASER_LIFETIME_MS = 280;
      const laserCut = nowMs - LASER_LIFETIME_MS;
      localLasersRef.current = localLasersRef.current.filter((l) => l.createdAt > laserCut);
      // Merge server lasers once (avoid duplicates by createdAt)
      const valid = (x: number, y: number) => Number.isFinite(x) && Number.isFinite(y) && x >= -200 && x <= WORLD_SIZE + 200 && y >= -200 && y <= WORLD_SIZE + 200;
      (gs?.lasers ?? []).forEach((l: any) => {
        const x1 = Number(l.x1), y1 = Number(l.y1), x2 = Number(l.x2), y2 = Number(l.y2);
        if (!valid(x1, y1) || !valid(x2, y2)) return;
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len > 2500 || len < 1) return;
        const created = l.createdAt ?? nowMs;
        if (localLasersRef.current.some((ex) => Math.abs(ex.createdAt - created) < 80)) return;
        localLasersRef.current.push({ x1, y1, x2, y2, color: l.color || '#06b6d4', createdAt: created });
      });
      // Draw all lasers at full length; fade out over lifetime
      localLasersRef.current.forEach((l) => {
        const age = nowMs - l.createdAt;
        const life = 1 - age / LASER_LIFETIME_MS;
        if (life <= 0) return;
        const len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
        if (!Number.isFinite(len) || len < 1 || len > 2600) return;
        ctx.save();
        ctx.globalAlpha = life;
        ctx.strokeStyle = l.color;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.shadowBlur = 5;
        ctx.shadowColor = l.color;
        ctx.beginPath();
        ctx.moveTo(l.x1, l.y1);
        ctx.lineTo(l.x2, l.y2);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.stroke();
        ctx.restore();
      });

      // Zombies (same look as HTML: ellipse, arms, HP bar)
      gs?.zombies?.forEach((z: any, idx: number) => {
        if (!isVis(z.x, z.y, 40)) return;
        drawZombieHtml(ctx, z.x, z.y, z.hp, z.maxHp, z.angle ?? 0, t, idx);
      });

      // Players (with stable color index and names)
      const playerList = Object.values(players || {}).filter(Boolean);
      const sortedIds = [...playerList].map((p: any) => p.id).sort();
      const playerColors = ['#22d3ee', '#a855f7', '#f97316', '#22c55e', '#ec4899', '#eab308', '#06b6d4', '#84cc16'];
      const isLocalMoving = dir.x !== 0 || dir.y !== 0;
      playerList.forEach((p: any) => {
        const px = p.id === playerId ? posRef.current.x : (p.x ?? ZOMBIE_BASE_X);
        const py = p.id === playerId ? posRef.current.y : (p.y ?? ZOMBIE_BASE_Y);
        const hp = p.modeState?.hp ?? 100;
        const maxHp = p.modeState?.maxHp ?? 100;
        const weapon = p.id === playerId ? (weaponDisplayRef.current || p.modeState?.weapon || 'pistol') : (p.modeState?.weapon ?? 'pistol');
        const angle = p.id === playerId
          ? Math.atan2(mouseRef.current.worldY - py, mouseRef.current.worldX - px)
          : (Math.atan2(ZOMBIE_BASE_Y - py, ZOMBIE_BASE_X - px));
        const colorIndex = sortedIds.indexOf(p.id);
        const color = playerColors[colorIndex % playerColors.length];
        const isMoving = p.id === playerId ? isLocalMoving : false;
        drawPlayerWithWeapon(ctx, px, py, angle, hp, maxHp, weapon, t, p.id === playerId, color, isMoving);
        ctx.save();
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        const name = (p.name || 'שחקן').slice(0, 12);
        ctx.strokeText(name, px, py - 42);
        ctx.fillText(name, px, py - 42);
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
    const worldX = playerX + (mouseRef.current.screenX - vpW / 2) / CAMERA_ZOOM;
    const worldY = playerY + (mouseRef.current.screenY - vpH / 2) / CAMERA_ZOOM;
    const weapon = weaponDisplayRef.current || (pl?.modeState?.weapon ?? 'pistol');
    const wpn = WEAPONS[weapon];
    const weaponRange = wpn ? (weapon === 'sniper' ? 2000 : weapon === 'shotgun' ? 800 : 1000) : 1000;
    const toScreenEdge = Math.hypot(vpW / 2, vpH / 2) / CAMERA_ZOOM;
    const range = Math.max(weaponRange, toScreenEdge);
    const aimAngle = Math.atan2(worldY - playerY, worldX - playerX);
    const now = Date.now();

    if (weapon === 'shotgun') {
      const spreadOffsets = [-0.2, -0.1, 0, 0.1, 0.2];
      spreadOffsets.forEach((off) => {
        const a = aimAngle + off;
        const ex = playerX + Math.cos(a) * range;
        const ey = playerY + Math.sin(a) * range;
        localLasersRef.current.push({ x1: playerX, y1: playerY, x2: ex, y2: ey, color: (wpn?.color) ?? '#f97316', createdAt: now });
      });
      socket.emit('action', { code: roomCode, playerId, actionType: 'shoot_zombie', aimAngle });
    } else {
      const endX = playerX + Math.cos(aimAngle) * range;
      const endY = playerY + Math.sin(aimAngle) * range;
      localLasersRef.current.push({
        x1: playerX, y1: playerY, x2: endX, y2: endY,
        color: (wpn?.color) ?? '#06b6d4',
        createdAt: now,
      });
      let targetId: string | undefined;
      const zombies = gsRef.current?.zombies ?? [];
      let minDistToClick = Infinity;
      zombies.forEach((z: any) => {
        const distFromPlayer = Math.hypot(z.x - playerX, z.y - playerY);
        if (distFromPlayer > range) return;
        const distToClick = Math.hypot(z.x - worldX, z.y - worldY);
        if (distToClick < minDistToClick) {
          minDistToClick = distToClick;
          targetId = typeof z.id === 'string' ? z.id : String(z.id);
        }
      });
      socket.emit('action', {
        code: roomCode,
        playerId,
        actionType: 'shoot_zombie',
        targetId: targetId ?? undefined,
        aimAngle,
      });
      if (targetId) playHitSound();
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
    const ammo = player?.modeState?.ammo ?? 0;
    if (ammo < 1) {
      playErrorSound();
      return;
    }
    let clientX: number, clientY: number;
    if ('touches' in e) {
      if (!e.touches[0]) return;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
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
    <div className="fixed inset-0 bg-[#08090d] text-white flex flex-col">
      {/* Full-screen game canvas – z-0 so overlays can sit on top */}
      <div className="absolute inset-0 z-0">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
          style={{ touchAction: 'none' }}
          onClick={handleCanvasClick}
          onTouchStart={handleCanvasClick}
          onTouchMove={(e) => { e.preventDefault(); if (e.touches[0]) updateMouse(e.touches[0].clientX, e.touches[0].clientY); }}
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

      {/* Weapon switcher: list of ALL purchased weapons (not a binary toggle). Switch freely between any owned weapon. */}
      <div className="fixed left-2 bottom-24 z-[100] flex flex-row flex-wrap items-center gap-2 pointer-events-auto py-2" dir="ltr">
        <span className="text-[10px] text-slate-300 font-bold shrink-0">נשק:</span>
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
                className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[11px] font-bold border-2 min-h-[48px] min-w-[48px] touch-manipulation cursor-pointer select-none bg-slate-800/95 backdrop-blur ${isActive ? 'ring-2 ring-cyan-400 bg-slate-600 border-cyan-400' : 'border-slate-500 hover:bg-slate-700 active:scale-95'}`}
                style={{ borderColor: isActive ? w.color : undefined }}
                title={w.name}
              >
                <WeaponIcon weaponId={id} size={20} color={w.color} />
                <span className="hidden min-[400px]:inline truncate max-w-[60px]">{w.name}</span>
              </button>
            );
          });
        })()}
      </div>

      {/* Bottom: joystick left, שאלות + חנות right */}
      <div className="absolute bottom-3 left-0 right-0 z-20 flex items-end justify-between gap-2 px-2 min-[480px]:px-4 pointer-events-none">
        <div className="pointer-events-auto">
          <VirtualJoystick onMove={onJoystickMove} onRelease={onJoystickRelease} size={110} teamColor="rgba(34,211,238,0.5)" />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 pointer-events-auto" dir="ltr">
          <button
            onClick={() => setShowQuestions(true)}
            className="px-3 py-2 min-[480px]:px-5 min-[480px]:py-3 rounded-xl font-bold text-sm min-[480px]:text-base bg-blue-600 hover:bg-blue-500 text-white shadow-lg border border-blue-500/50 flex items-center gap-1.5 min-[480px]:gap-2"
          >
            <HelpCircle size={16} className="min-[480px]:w-[18px] min-[480px]:h-[18px]" /> <span className="hidden min-[400px]:inline">שאלות (+תחמושת)</span><span className="min-[400px]:hidden">שאלות</span>
          </button>
          <button
            onClick={() => setShowShop(true)}
            className="px-3 py-2 min-[480px]:px-5 min-[480px]:py-3 rounded-xl font-bold text-sm min-[480px]:text-base bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg border border-emerald-500/50 flex items-center gap-1.5 min-[480px]:gap-2"
          >
            <ShoppingCart size={16} className="min-[480px]:w-[18px] min-[480px]:h-[18px]" /> חנות
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
              className="bg-slate-900 rounded-2xl border border-slate-600 shadow-2xl max-w-lg w-full max-h-[85vh] overflow-hidden"
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
              className="bg-slate-900 rounded-2xl border border-slate-600 shadow-2xl max-w-md w-full max-h-[80vh] overflow-hidden"
            >
              <div className="p-4 border-b border-slate-700 flex justify-between items-center">
                <span className="font-bold text-emerald-400">חנות</span>
                <button onClick={() => setShowShop(false)} className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 font-bold">סגור</button>
              </div>
              <div className="p-4 space-y-2 overflow-y-auto">
                {(() => {
                  const owned = (player?.modeState?.ownedWeapons ?? ['pistol']).filter((id: string) => WEAPONS[id]);
                  const uniqueOwned = [...new Set(owned)];
                  if (uniqueOwned.length === 0) return null;
                  return (
                    <div className="mb-4 p-3 bg-slate-800/70 rounded-xl border border-slate-600">
                      <p className="text-slate-300 text-sm font-bold mb-2">החלף נשק פעיל</p>
                      <div className="flex flex-wrap gap-2" dir="ltr">
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
                              <WeaponIcon weaponId={id} size={18} color={w.color} />
                              {w.name}
                            </button>
                          ) : null;
                        })}
                      </div>
                    </div>
                  );
                })()}
                <p className="text-slate-400 text-sm font-bold mb-2">נשקייה (מטבעות)</p>
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
                      icon={<span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: w.color + '33', color: w.color }}><WeaponIcon weaponId={key} size={22} color={w.color} /></span>}
                      canAfford={!isOwned && canAfford}
                      onBuy={() => { if (!isOwned && canAfford) buyUpgrade(key, w.cost); }}
                    />
                  );
                })}
                <p className="text-slate-400 text-sm font-bold mt-4 mb-2">שדרוגים</p>
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Base: octagon + H (like exmpl.html) ──
function drawBase(ctx: CanvasRenderingContext2D, x: number, y: number, hpPct: number, t: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(0, 0, BASE_RADIUS + 15, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4 + Math.PI / 8;
    const px = Math.cos(angle) * BASE_RADIUS;
    const py = Math.sin(angle) * BASE_RADIUS;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = '#334155';
  ctx.fill();
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, BASE_RADIUS * 0.7, 0, Math.PI * 2);
  ctx.fillStyle = '#1e293b';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#facc15';
  ctx.font = 'bold 40px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('H', 0, 5);
  ctx.shadowBlur = 30;
  const coreColor = hpPct > 0.5 ? '#38bdf8' : hpPct > 0.2 ? '#facc15' : '#ef4444';
  ctx.shadowColor = coreColor;
  ctx.beginPath();
  ctx.arc(0, 0, 25, 0, Math.PI * 2);
  ctx.fillStyle = '#0f172a';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, 20, 0, Math.PI * 2);
  ctx.fillStyle = coreColor;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(0, 0, BASE_RADIUS + 10, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(56, 189, 248, ${0.1 + Math.sin(Date.now() / 300) * 0.05})`;
  ctx.fill();
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

// ── Zombie: same look as exmpl.html (ellipse, green, arms, HP bar) ──
function drawZombieHtml(
  ctx: CanvasRenderingContext2D, x: number, y: number,
  hp: number, maxHp: number, angle: number, t: number, idx: number
) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(x + 8, y + 8, 14, 22, angle, 0, Math.PI * 2);
  ctx.fill();
  ctx.translate(x, y);
  ctx.rotate(angle + Math.sin((Date.now() / 200) + (idx * 100)) * 0.15);
  ctx.fillStyle = '#064e3b';
  ctx.beginPath();
  ctx.ellipse(0, 0, 14, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#166534';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(5, -20, 18, 8, 4);
  else ctx.rect(5, -20, 18, 8);
  ctx.fill();
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(8, 12, 16, 8, 4);
  else ctx.rect(8, 12, 16, 8);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(4, 0, 13, 0, Math.PI * 2);
  ctx.fillStyle = '#22c55e';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#14532d';
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 15, y - 30, 30, 6);
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(x - 15, y - 30, 30 * (Math.max(0, hp) / maxHp), 6);
}

// ── Player with weapon (like exmpl.html); accentColor for different players; legs move only when isMoving ──
function drawPlayerWithWeapon(
  ctx: CanvasRenderingContext2D, x: number, y: number, angle: number,
  hp: number, maxHp: number, weaponId: string, t: number, isMe: boolean, accentColor?: string, isMoving?: boolean
) {
  const bodyColor = accentColor || '#22d3ee';
  const bodyDark = accentColor ? colorAlpha(accentColor, 0.7) : '#0369a1';
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.arc(x + 10, y + 10, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(0, 0, 40, 0, Math.PI * 2);
  ctx.fillStyle = colorAlpha(bodyColor, 0.15);
  ctx.fill();
  ctx.rotate(angle);
  const wC = isMoving ? Math.sin(Date.now() / 150) * 10 : 0;
  ctx.fillStyle = '#1e293b';
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2;
  ctx.fillRect(-10 + wC, -18, 14, 10);
  ctx.strokeRect(-10 + wC, -18, 14, 10);
  ctx.fillRect(-10 - wC, 8, 14, 10);
  ctx.strokeRect(-10 - wC, 8, 14, 10);
  const bGrad = ctx.createRadialGradient(0, 0, 5, 0, 0, 20);
  bGrad.addColorStop(0, bodyColor);
  bGrad.addColorStop(1, bodyDark);
  ctx.beginPath();
  ctx.arc(0, 0, 18, 0, Math.PI * 2);
  ctx.fillStyle = bGrad;
  ctx.fill();
  ctx.strokeStyle = bodyColor;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, Math.PI * 2);
  ctx.fillStyle = '#0f172a';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, 12, -Math.PI / 3, Math.PI / 3);
  ctx.strokeStyle = bodyColor;
  ctx.lineWidth = 4;
  ctx.shadowBlur = 10;
  ctx.shadowColor = bodyColor;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.translate(10, 16);
  const wp = WEAPONS[weaponId] ?? WEAPONS.pistol;
  if (weaponId === 'pistol') {
    ctx.fillStyle = '#334155';
    ctx.fillRect(0, -4, 18, 8);
    ctx.fillStyle = '#06b6d4';
    ctx.beginPath();
    ctx.arc(16, 0, 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (weaponId === 'rifle') {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, -5, 30, 10);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(8, 5, 8, 6);
    ctx.fillStyle = '#eab308';
    ctx.beginPath();
    ctx.arc(28, 0, 4, 0, Math.PI * 2);
    ctx.fill();
  } else if (weaponId === 'shotgun') {
    ctx.fillStyle = '#451a03';
    ctx.fillRect(0, -6, 24, 12);
    ctx.fillStyle = '#9a3412';
    ctx.fillRect(6, -8, 10, 16);
    ctx.fillStyle = '#f97316';
    ctx.fillRect(22, -4, 4, 8);
  } else if (weaponId === 'sniper') {
    ctx.fillStyle = '#172554';
    ctx.fillRect(-5, -3, 45, 6);
    ctx.fillStyle = '#1e3a8a';
    ctx.fillRect(5, -6, 15, 3);
    ctx.fillStyle = '#38bdf8';
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#38bdf8';
    ctx.beginPath();
    ctx.arc(40, 0, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
  const pct = hp / maxHp;
  const barColor = pct > 0.5 ? '#22c55e' : pct > 0.25 ? '#eab308' : '#ef4444';
  drawHPBar(ctx, x, y - 26, 26, 4, pct, barColor);
}

// ── Sprite: Turret ──
function drawTurret(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, zombies: any[]) {
  ctx.save();

  // Find target angle
  let targetAngle = t * 0.5;
  if (zombies?.length) {
    let closest: any = null, minDist = Infinity;
    zombies.forEach((z: any) => {
      const d = Math.hypot(z.x - x, z.y - y);
      if (d < minDist) { minDist = d; closest = z; }
    });
    if (closest) targetAngle = Math.atan2(closest.y - y, closest.x - x);
  }

  // Range ring
  ctx.strokeStyle = 'rgba(34,211,238,0.06)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([3, 6]);
  ctx.beginPath(); ctx.arc(x, y, 150, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);

  // Base plate
  ctx.fillStyle = '#374151';
  ctx.strokeStyle = '#4b5563';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x - 11, y - 11, 22, 22, 4);
  ctx.fill(); ctx.stroke();

  // Diamond accent
  ctx.fillStyle = '#1f2937';
  ctx.beginPath();
  ctx.moveTo(x, y - 8);
  ctx.lineTo(x + 8, y);
  ctx.lineTo(x, y + 8);
  ctx.lineTo(x - 8, y);
  ctx.closePath();
  ctx.fill();

  // Rotating barrel
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(targetAngle);
  ctx.fillStyle = '#6b7280';
  ctx.fillRect(0, -2, 18, 4);
  ctx.fillStyle = '#22d3ee';
  ctx.shadowBlur = 6;
  ctx.shadowColor = '#22d3ee';
  ctx.beginPath(); ctx.arc(18, 0, 2, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();

  // Center core
  ctx.fillStyle = '#22d3ee';
  ctx.shadowBlur = 8;
  ctx.shadowColor = '#22d3ee';
  ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;

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
