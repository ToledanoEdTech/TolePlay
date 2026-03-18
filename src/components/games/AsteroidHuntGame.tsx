import React, { useState, useEffect, useRef, useCallback, type MouseEvent as RMouseEvent, type TouchEvent as RTouchEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, HelpCircle, ShoppingCart, X } from 'lucide-react';
import { socket } from '../../socket';
import { QuizTerminalModal } from './QuizTerminalModal';
import { ShopPanel } from './ShopPanel';
import {
  type Particle, type Star, type ShakeState,
  tickParticles,
  createStarfield, drawStarfield,
  triggerShake, tickShake,
  drawBeam, drawHPBar, drawGlow, colorAlpha,
  createParallaxNebulas, drawParallaxNebulas,
  emitAsteroidExplosion,
  drawOreGem, drawMuzzleFlash,
  type ParallaxLayer,
  drawSpaceship,
  drawAsteroidStandalone,
  emitThrusterParticles,
} from './renderUtils';

const WORLD_SIZE = 4000;
const VIEW_SIZE = 1000;

interface Props {
  roomCode: string;
  playerId: string;
  player: any;
  questions: any[];
  globalState: any;
  allPlayers: Record<string, any>;
  startTime?: number;
}

const ASTEROID_TYPES = [
  { minVal: 0, name: 'iron', body: '#737373', crater: '#4b5563', glow: '#9ca3af', outline: '#78716c' },
  { minVal: 70, name: 'ice', body: '#2dd4bf', crater: '#38bdf8', glow: '#67e8f9', outline: '#0ea5e9' },
  { minVal: 100, name: 'crystal', body: '#c084fc', crater: '#a855f7', glow: '#d8b4fe', outline: '#9333ea' },
];

function getAsteroidType(value: number) {
  for (let i = ASTEROID_TYPES.length - 1; i >= 0; i--) {
    if (value >= ASTEROID_TYPES[i].minVal) return ASTEROID_TYPES[i];
  }
  return ASTEROID_TYPES[0];
}

function playerHslColor(id: string): string {
  const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return `hsl(${hash % 360}, 80%, 60%)`;
}

function ShopModal({
  open,
  credits,
  ownedWeapons,
  equippedWeapon,
  laserDmg,
  magnetRange,
  hasShield,
  onClose,
  onBuy,
  onEquip,
}: {
  open: boolean;
  credits: number;
  ownedWeapons: string[];
  equippedWeapon: string;
  laserDmg: number;
  magnetRange: number;
  hasShield: boolean;
  onClose: () => void;
  onBuy: (upgradeId: string, cost: number) => void;
  onEquip: (weaponId: string) => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
    >
      <div
        className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 shadow-2xl bg-slate-950 text-white"
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 left-3 z-10 p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
        >
          <X size={18} className="text-slate-400" />
        </button>

        <div className="p-6 pt-12 overflow-y-auto max-h-[85vh]">
          <ShopPanel
            credits={credits}
            ownedWeapons={ownedWeapons}
            equippedWeapon={equippedWeapon}
            laserDmg={laserDmg}
            magnetRange={magnetRange}
            hasShield={hasShield}
            onBuy={onBuy}
            onEquip={onEquip}
          />
        </div>
      </div>
    </div>
  );
}

function AmmoHud({ ammo, maxAmmo }: { ammo: number; maxAmmo: number }) {
  return (
    <div className="asteroid-ammo-hud absolute bottom-4 right-4 z-30 pointer-events-none">
      <div className="flex items-center gap-2 px-4 py-2 rounded-2xl border border-cyan-400/20 bg-black/45 backdrop-blur-md shadow-[0_0_0_1px_rgba(34,211,238,0.12),0_12px_28px_rgba(0,0,0,0.45)]">
        <svg viewBox="0 0 64 64" className="w-5 h-5 text-cyan-200">
          <path
            d="M20 10 h16 a8 8 0 0 1 8 8 v28 a8 8 0 0 1-8 8H20z"
            fill="currentColor"
            opacity="0.85"
          />
          <path d="M20 10 h10 v44 H20z" fill="#ffffff" opacity="0.25" />
        </svg>
        <div className="text-right">
          <div className="text-[10px] tracking-[0.22em] text-cyan-200/70 font-extrabold">AMMO</div>
          <div className="font-extrabold text-slate-100">
            {ammo} <span className="text-slate-400 font-bold">/ {maxAmmo}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AsteroidHuntGame({ roomCode, playerId, player, questions, globalState, allPlayers, startTime }: Props) {
  const [quizOpen, setQuizOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [quizQuestions, setQuizQuestions] = useState<any[]>(() => Array.isArray(questions) ? questions : []);
  const [quizSessionId, setQuizSessionId] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const gsRef = useRef(globalState);
  const playerRef = useRef(player);
  const allPlayersRef = useRef<Record<string, any>>(allPlayers || {});
  const playerIdRef = useRef(playerId);
  const localAimAngleRef = useRef(0);
  const quizOpenRef = useRef(false);
  const quizOpenedAtRef = useRef(0);
  const starsRef = useRef<Star[]>([]);
  const nebulasRef = useRef<ParallaxLayer[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const shakeRef = useRef<ShakeState>({ intensity: 0, offsetX: 0, offsetY: 0 });
  const mouseRef = useRef({ worldX: WORLD_SIZE / 2, worldY: WORLD_SIZE / 2 });
  const keysRef = useRef({ up: false, down: false, left: false, right: false });
  const cameraRef = useRef({ x: WORLD_SIZE / 2 - VIEW_SIZE / 2, y: WORLD_SIZE / 2 - VIEW_SIZE / 2 });
  const muzzleFlashRef = useRef({ active: false, angle: 0, intensity: 1 });
  const modalOpenRef = useRef(false);
  const floatTextsRef = useRef<{ x: number; y: number; text: string; life: number }[]>([]);
  const prevTimeRef = useRef(0);
  const prevAsteroidsRef = useRef<Map<string, any>>(new Map());
  const prevAstHpRef = useRef<Map<string, number>>(new Map());

  // --- Client-side smoothing state (prediction + lerp-to-authority) ---
  // EXACT architecture requested:
  // - targetX/targetY (authoritative from server)
  // - renderX/renderY (what we draw)
  // - render += (target - render) * 0.15 each RAF tick
  type PlayerTarget = { x: number; y: number; angle: number; vx: number; vy: number };
  type PlayerRender = { x: number; y: number; angle: number };
  type AstTarget = { x: number; y: number; rotation: number; vx: number; vy: number; rotSpeed: number };
  type AstRender = { x: number; y: number; rotation: number };
  type ProjTarget = { x: number; y: number; vx: number; vy: number; type?: string; radius?: number; color?: string };
  type ProjRender = { x: number; y: number; px: number; py: number; vx: number; vy: number; lastSeenAt: number; locked: boolean; type?: string; radius?: number; color?: string };

  const playerTargetsRef = useRef<Map<string, PlayerTarget>>(new Map());
  const playerRendersRef = useRef<Map<string, PlayerRender>>(new Map());
  const astTargetsRef = useRef<Map<string, AstTarget>>(new Map());
  const astRendersRef = useRef<Map<string, AstRender>>(new Map());
  const projTargetsRef = useRef<Map<string, ProjTarget>>(new Map());
  const projRendersRef = useRef<Map<string, ProjRender>>(new Map());

  gsRef.current = globalState;
  playerRef.current = player;
  allPlayersRef.current = allPlayers || {};
  playerIdRef.current = playerId;
  modalOpenRef.current = quizOpen || shopOpen;
  quizOpenRef.current = quizOpen;

  // Snapshot questions ONCE when opening quiz to prevent rapid remount / cycling
  useEffect(() => {
    if (!quizOpen) return;
    const src = Array.isArray(questions) ? questions : [];
    // IMPORTANT: freeze questions for this modal session.
    // Upstream may mutate/reorder the questions array during server ticks, which looks like "cycling at lightspeed".
    try {
      // structuredClone keeps nested arrays/objects stable
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cloned = (globalThis as any).structuredClone ? (globalThis as any).structuredClone(src) : JSON.parse(JSON.stringify(src));
      setQuizQuestions(cloned);
    } catch {
      // fallback shallow clone
      setQuizQuestions(src.map((q: any) => ({ ...q, opts: Array.isArray(q?.opts) ? [...q.opts] : q?.opts })));
    }
  }, [quizOpen]);

  // Input fix: when quiz opens, clear local keys and stop movement on server.
  useEffect(() => {
    if (!quizOpen) return;

    // Clear stuck key states (canvas loses focus, keyup may never fire)
    keysRef.current = { up: false, down: false, left: false, right: false };

    // Emit "stop" movement so server doesn't keep last vx/vy forever
    socket.emit('move', { code: roomCode, playerId, dx: 0, dy: 0, angle: localAimAngleRef.current });
  }, [quizOpen, roomCode, playerId]);

  // While quiz is open, block keyboard events from triggering button activation (Space/Enter repeats).
  useEffect(() => {
    if (!quizOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [quizOpen]);

  // Allow closing quiz with Escape (and guarantees ref sync)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && quizOpenRef.current) {
        e.preventDefault();
        quizOpenRef.current = false;
        setQuizOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Also clear inputs when the window/canvas loses focus (prevents stuck keys even without opening quiz).
  useEffect(() => {
    const clearInputs = () => {
      keysRef.current = { up: false, down: false, left: false, right: false };
      socket.emit('move', { code: roomCode, playerId, dx: 0, dy: 0, angle: localAimAngleRef.current });
    };
    const onWindowBlur = () => clearInputs();
    const onVisibility = () => { if (document.hidden) clearInputs(); };
    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [roomCode, playerId]);

  // Update targets from server tick, and derive velocities for prediction (vx/vy)
  useEffect(() => {
    const now = performance.now();
    const safeNum = (v: unknown, def: number): number =>
      typeof v === 'number' && !Number.isNaN(v) ? v : def;

    // Players
    const ap = allPlayers || {};
    const alivePlayers = new Set<string>();
    for (const [id, pl] of Object.entries(ap)) {
      alivePlayers.add(id);
      const x = safeNum((pl as any)?.x, WORLD_SIZE / 2);
      const y = safeNum((pl as any)?.y, WORLD_SIZE / 2);
      const angle = safeNum((pl as any)?.angle, safeNum((pl as any)?.modeState?.angle, 0));
      const prev = playerTargetsRef.current.get(id);
      const dt = prev ? Math.max(0.001, 0.05) : 0.05;
      const vx = prev ? (x - prev.x) / dt : 0;
      const vy = prev ? (y - prev.y) / dt : 0;
      playerTargetsRef.current.set(id, { x, y, angle, vx, vy });
    }
    // strict cleanup for players that vanished
    for (const id of Array.from(playerTargetsRef.current.keys())) {
      if (!alivePlayers.has(id)) {
        playerTargetsRef.current.delete(id);
        playerRendersRef.current.delete(id);
      }
    }

    // Asteroids
    const asts: any[] = Array.isArray(globalState?.asteroids) ? globalState.asteroids : [];
    const aliveAst = new Set<string>();
    const nextHp = new Map<string, number>();
    for (const a of asts) {
      const id = typeof a?.id === 'string' ? a.id : undefined;
      if (!id) continue;
      aliveAst.add(id);
      const x = safeNum(a?.x, WORLD_SIZE / 2);
      const y = safeNum(a?.y, WORLD_SIZE / 2);
      const rotation = safeNum(a?.rotation, 0);
      const rotSpeed = safeNum(a?.rotSpeed, 0);
      const prev = astTargetsRef.current.get(id);
      const dt = prev ? Math.max(0.001, 0.05) : 0.05;
      const vx = prev ? (x - prev.x) / dt : safeNum(a?.vx, 0);
      const vy = prev ? (y - prev.y) / dt : safeNum(a?.vy, 0);
      astTargetsRef.current.set(id, { x, y, rotation, rotSpeed, vx, vy });
      const hp = safeNum(a?.hp, safeNum(a?.maxHp, 100));
      nextHp.set(id, hp);
    }
    // strict cleanup for asteroids that vanished (prevents glitch lerp)
    for (const id of Array.from(astTargetsRef.current.keys())) {
      if (!aliveAst.has(id)) {
        astTargetsRef.current.delete(id);
        astRendersRef.current.delete(id);
        prevAstHpRef.current.delete(id);
      }
    }
    // prune missing asteroids from hp tracking
    for (const id of Array.from(prevAstHpRef.current.keys())) {
      if (!nextHp.has(id)) prevAstHpRef.current.delete(id);
    }

    // Projectiles (already have vx/vy from server; keep as target + let RAF predict+lerp)
    const projs: any[] = Array.isArray(globalState?.projectiles) ? globalState.projectiles : [];
    const nextProj = new Map<string, ProjTarget>();
    for (const pr of projs) {
      const x = safeNum(pr?.x, NaN);
      const y = safeNum(pr?.y, NaN);
      if (Number.isNaN(x) || Number.isNaN(y)) continue;
      // Prefer stable server IDs. Fallback is best-effort.
      const id = typeof pr?.id === 'string'
        ? pr.id
        : `${String(pr?.shooterId ?? 'u')}_${String(pr?.spawnTime ?? pr?.createdAt ?? now)}_${String(pr?.type ?? 'p')}`;
      const vx = safeNum(pr?.vx, 0);
      const vy = safeNum(pr?.vy, 0);
      nextProj.set(id, { x, y, vx, vy, type: pr?.type, radius: pr?.radius, color: pr?.color });
    }
    projTargetsRef.current = nextProj;
    // strict cleanup for dead projectiles (prevents phantom shots)
    for (const id of Array.from(projRendersRef.current.keys())) {
      if (!nextProj.has(id)) projRendersRef.current.delete(id);
    }
  }, [allPlayers, globalState]);

  useEffect(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    starsRef.current = createStarfield(220, w, h);
    nebulasRef.current = createParallaxNebulas(6, w, h);
  }, []);

  const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
  const timeLeft = Math.max(0, 7 * 60 - elapsed);
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const ammo = Math.floor(player?.resources || 0);
  const ore = player?.score || 0;
  const credits = player?.modeState?.credits ?? 0;
  const ownedWeapons: string[] = Array.isArray(player?.modeState?.ownedWeapons) ? player.modeState.ownedWeapons : ['weapon_tier_1'];
  const equippedWeapon: string = typeof player?.modeState?.equippedWeapon === 'string' ? player.modeState.equippedWeapon : 'weapon_tier_1';
  const laserDmg = player?.modeState?.laserDamage ?? 25;
  const magnetRange = player?.modeState?.magnetRange ?? 50;
  const hasShield = !!player?.modeState?.hasShield;
  const px = player?.x ?? WORLD_SIZE / 2;
  const py = player?.y ?? WORLD_SIZE / 2;
  const playerAngle = typeof player?.angle === 'number' ? player.angle : 0;

  const updateMouseWorld = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const viewW = canvas.width;
    const viewH = canvas.height;
    const cam = cameraRef.current;
    const screenX = (clientX - rect.left) * scaleX;
    const screenY = (clientY - rect.top) * scaleY;
    mouseRef.current = {
      worldX: cam.x + (screenX / viewW) * viewW,
      worldY: cam.y + (screenY / viewH) * viewH,
    };

    // update local aim angle (used for rendering immediately and for server sync)
    const myId = playerIdRef.current;
    const myR = playerRendersRef.current.get(myId);
    const p = playerRef.current;
    const shipX = typeof myR?.x === 'number' && !Number.isNaN(myR.x) ? myR.x : (typeof p?.x === 'number' && !Number.isNaN(p.x) ? p.x : WORLD_SIZE / 2);
    const shipY = typeof myR?.y === 'number' && !Number.isNaN(myR.y) ? myR.y : (typeof p?.y === 'number' && !Number.isNaN(p.y) ? p.y : WORLD_SIZE / 2);
    localAimAngleRef.current = Math.atan2(mouseRef.current.worldY - shipY, mouseRef.current.worldX - shipX);
  }, []);

  const handleMouseMove = useCallback((e: RMouseEvent<HTMLCanvasElement>) => {
    updateMouseWorld(e.clientX, e.clientY);
  }, [updateMouseWorld]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const c = e.code;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(c)) e.preventDefault();
      if (c === 'KeyW' || c === 'ArrowUp') keysRef.current.up = true;
      if (c === 'KeyS' || c === 'ArrowDown') keysRef.current.down = true;
      if (c === 'KeyA' || c === 'ArrowLeft') keysRef.current.left = true;
      if (c === 'KeyD' || c === 'ArrowRight') keysRef.current.right = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const c = e.code;
      if (c === 'KeyW' || c === 'ArrowUp') keysRef.current.up = false;
      if (c === 'KeyS' || c === 'ArrowDown') keysRef.current.down = false;
      if (c === 'KeyA' || c === 'ArrowLeft') keysRef.current.left = false;
      if (c === 'KeyD' || c === 'ArrowRight') keysRef.current.right = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    if (quizOpen || shopOpen) return;
    const interval = setInterval(() => {
      const k = keysRef.current;
      // Top-down shooter controls:
      // - Mouse controls facing (angle)
      // - Keyboard controls thrust/strafe in ship-space, converted to world-space
      const forward = (k.up ? 1 : 0) - (k.down ? 1 : 0);
      const strafe = (k.right ? 1 : 0) - (k.left ? 1 : 0);
      const a = localAimAngleRef.current;
      let dx = forward * Math.cos(a) + strafe * Math.cos(a + Math.PI / 2);
      let dy = forward * Math.sin(a) + strafe * Math.sin(a + Math.PI / 2);
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      socket.emit('move', { code: roomCode, playerId, dx, dy, angle: a });
    }, 50);
    return () => clearInterval(interval);
  }, [roomCode, playerId, quizOpen, shopOpen]);

  // Universal immediate projectile spawns (do not wait for tick).
  useEffect(() => {
    const safeNum = (v: unknown, def: number): number =>
      typeof v === 'number' && !Number.isNaN(v) ? v : def;
    const onSpawn = (msg: any) => {
      if (!msg || msg.mode !== 'farm') return;
      const p = msg.projectile;
      if (!p || p.kind !== 'farmProjectile') return;
      const id = typeof p.id === 'string' ? p.id : null;
      if (!id) return;
      // Inject into the same authoritative maps the render loop already consumes.
      projTargetsRef.current.set(id, {
        x: safeNum(p.x, NaN),
        y: safeNum(p.y, NaN),
        vx: safeNum(p.vx, 0),
        vy: safeNum(p.vy, 0),
        type: p.type,
        radius: p.radius,
        color: p.color,
      });
    };
    socket.on('spawnProjectile', onSpawn);
    return () => { socket.off('spawnProjectile', onSpawn); };
  }, []);

  const handleTouchMove = useCallback((e: RTouchEvent<HTMLCanvasElement>) => {
    if (!e.touches[0]) return;
    updateMouseWorld(e.touches[0].clientX, e.touches[0].clientY);
  }, [updateMouseWorld]);

  const handleCanvasClick = useCallback((e: RMouseEvent<HTMLCanvasElement> | RTouchEvent<HTMLCanvasElement>) => {
    if (quizOpen || shopOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ammoCost = equippedWeapon === 'weapon_tier_4' ? 25 : 10;
    if ((player?.resources || 0) < ammoCost) return;

    let clientX: number, clientY: number;
    if ('touches' in e) {
      if (!e.touches[0]) return;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    updateMouseWorld(clientX, clientY);
    const angle = localAimAngleRef.current;

    muzzleFlashRef.current = { active: true, angle, intensity: 1 };
    socket.emit('action', { code: roomCode, playerId, actionType: 'shoot', aimAngle: angle });
  }, [roomCode, playerId, player?.resources, equippedWeapon, quizOpen, shopOpen, px, py, updateMouseWorld]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };
    resize();
    window.addEventListener('resize', resize);

    const safeNum = (v: unknown, def: number): number =>
      typeof v === 'number' && !Number.isNaN(v) ? v : def;

    let raf: number;
    const render = (now: number) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        raf = requestAnimationFrame(render);
        return;
      }
      resize();

      try {
      const dt = Math.min(0.05, (now - prevTimeRef.current) / 1000);
      prevTimeRef.current = now;
      const t = now * 0.001;
      const gs = gsRef.current || {};
      const p = playerRef.current;
      const ap = allPlayersRef.current || {};
      const myId = playerIdRef.current;
      const viewW = Math.max(320, canvas.width);
      const viewH = Math.max(240, canvas.height);
      const POS_LERP = 0.2; // EXACT factor requested

      // If a modal is open, pause heavy world rendering to prevent freezes.
      // (The authoritative state will keep updating; rendering resumes smoothly on close.)
      if (modalOpenRef.current) {
        ctx.clearRect(0, 0, viewW, viewH);
        const bg = ctx.createLinearGradient(0, 0, 0, viewH);
        bg.addColorStop(0, '#020210');
        bg.addColorStop(1, '#020210');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, viewW, viewH);
        raf = requestAnimationFrame(render);
        return;
      }

      const cam = cameraRef.current;

      // Use smoothed local render position for camera to eliminate "world stutter"
      const myTarget = playerTargetsRef.current.get(myId);
      if (myTarget) {
        const cur = playerRendersRef.current.get(myId) ?? { x: myTarget.x, y: myTarget.y, angle: myTarget.angle };
        cur.x += (myTarget.vx || 0) * dt;
        cur.y += (myTarget.vy || 0) * dt;
        cur.x += (myTarget.x - cur.x) * POS_LERP;
        cur.y += (myTarget.y - cur.y) * POS_LERP;
        const targetAngle = localAimAngleRef.current;
        const da = Math.atan2(Math.sin(targetAngle - cur.angle), Math.cos(targetAngle - cur.angle));
        cur.angle = cur.angle + da * POS_LERP;
        playerRendersRef.current.set(myId, cur);
        cam.x = cur.x - viewW / 2;
        cam.y = cur.y - viewH / 2;
      } else {
        const plX = safeNum(p?.x, WORLD_SIZE / 2);
        const plY = safeNum(p?.y, WORLD_SIZE / 2);
        cam.x = plX - viewW / 2;
        cam.y = plY - viewH / 2;
      }
      cam.x = Math.max(0, Math.min(WORLD_SIZE - viewW, cam.x));
      cam.y = Math.max(0, Math.min(WORLD_SIZE - viewH, cam.y));

      ctx.clearRect(0, 0, viewW, viewH);

      const shake = tickShake(shakeRef.current);
      ctx.save();
      ctx.translate(safeNum(shake.x, 0), safeNum(shake.y, 0));

      const bg = ctx.createLinearGradient(0, 0, 0, viewH);
      bg.addColorStop(0, '#020210');
      bg.addColorStop(0.3, '#070720');
      bg.addColorStop(0.6, '#0a0a35');
      bg.addColorStop(1, '#020210');
      ctx.fillStyle = bg;
      ctx.fillRect(-20, -20, viewW + 40, viewH + 40);

      const scrollY = t * 30;
      drawParallaxNebulas(ctx, nebulasRef.current, viewW, viewH, t, scrollY);
      drawStarfield(ctx, starsRef.current, viewW, viewH, 0.5);

      ctx.save();
      ctx.translate(-cam.x, -cam.y);

      ctx.strokeStyle = 'rgba(255, 0, 0, 0.2)';
      ctx.lineWidth = 4;
      ctx.strokeRect(0, 0, WORLD_SIZE, WORLD_SIZE);

      // Asteroids (server state is source-of-truth) + explosion detection
      const asteroids: any[] = Array.isArray(gs.asteroids) ? gs.asteroids : [];
      const curAstMap = new Map<string, any>();
      for (const a of asteroids) {
        const id = typeof a?.id === 'string' ? a.id : undefined;
        if (id) curAstMap.set(id, a);
      }
      // detect destroyed asteroids (present in prev, missing now)
      if (prevAsteroidsRef.current.size > 0) {
        prevAsteroidsRef.current.forEach((prevAst, id) => {
          if (curAstMap.has(id)) return;
          const ax = safeNum(prevAst?.x, NaN);
          const ay = safeNum(prevAst?.y, NaN);
          if (Number.isNaN(ax) || Number.isNaN(ay)) return;
          const type = getAsteroidType(safeNum(prevAst?.value, 50));
          particlesRef.current = particlesRef.current.concat(emitAsteroidExplosion(ax, ay, type.body, type.glow, 26));
          triggerShake(shakeRef.current, 7);
        });
      }
      prevAsteroidsRef.current = curAstMap;

      asteroids.forEach((a: any) => {
        const ax = safeNum(a.x, WORLD_SIZE / 2);
        const ay = safeNum(a.y, WORLD_SIZE / 2);
        if (Number.isNaN(ax) || Number.isNaN(ay)) return;
        // cull by camera bounds (in world coords; ctx already translated)
        if (ax < cam.x - 200 || ax > cam.x + viewW + 200 || ay < cam.y - 200 || ay > cam.y + viewH + 200) return;
        const type = getAsteroidType(safeNum(a.value, 50));
        const scale = Math.max(0.35, (viewW / VIEW_SIZE) * 0.65);
        const radius = Math.max(10, safeNum(a.radius, 25) * scale);

        const id = typeof a?.id === 'string' ? a.id : undefined;
        const target = id ? astTargetsRef.current.get(id) : undefined;
        if (!id || !target) return;

        const cur = astRendersRef.current.get(id) ?? { x: target.x, y: target.y, rotation: target.rotation };

        // ── Robust lerp guard (prevents "zombie asteroids" during rapid motion) ──
        // If a target jumps a huge distance (stale render state, ID collision/reuse, or transient invalid data),
        // snapping is safer than lerping/predicting which can appear as an asteroid flying across the screen.
        const tx = target.x;
        const ty = target.y;
        const isInWorld =
          typeof tx === 'number' && typeof ty === 'number' &&
          !Number.isNaN(tx) && !Number.isNaN(ty) &&
          tx > -300 && tx < WORLD_SIZE + 300 &&
          ty > -300 && ty < WORLD_SIZE + 300;
        const jumpDist = Math.hypot(tx - cur.x, ty - cur.y);
        const MAX_AST_SNAP_DIST = 700; // ~< view size; tuned to stop extreme "flybys"
        if (!isInWorld || jumpDist > MAX_AST_SNAP_DIST) {
          cur.x = tx;
          cur.y = ty;
          cur.rotation = target.rotation;
          astRendersRef.current.set(id, cur);
        } else {

        // (optional) tiny prediction step so lerp has directionality
        const pvx = Math.max(-1200, Math.min(1200, target.vx || 0));
        const pvy = Math.max(-1200, Math.min(1200, target.vy || 0));
        cur.x += pvx * dt;
        cur.y += pvy * dt;
        cur.rotation += (target.rotSpeed || 0) * dt;

        // EXACT LERP requested
        cur.x += (target.x - cur.x) * POS_LERP;
        cur.y += (target.y - cur.y) * POS_LERP;
        cur.rotation += (target.rotation - cur.rotation) * POS_LERP;

        astRendersRef.current.set(id, cur);
        }

        const rotation = cur.rotation;
        const maxHp = Math.max(1, safeNum(a.maxHp, 100));
        const hp = safeNum(a.hp, maxHp);
        const hpPct = Math.max(0, Math.min(1, hp / maxHp));

        // Hit effect: when asteroid HP drops, spawn a small impact burst once.
        const prevHp = prevAstHpRef.current.get(id);
        if (typeof prevHp === 'number' && hp < prevHp - 0.001) {
          particlesRef.current = particlesRef.current.concat(
            emitAsteroidExplosion(cur.x, cur.y, type.body, type.glow, 10)
          );
          triggerShake(shakeRef.current, 1.4);
        }
        prevAstHpRef.current.set(id, hp);

        drawAsteroidStandalone(ctx, {
          x: cur.x,
          y: cur.y,
          radius,
          color: type.body,
          rotation,
          vertices: Array.isArray(a.vertices) ? a.vertices : undefined,
          craters: Array.isArray(a.craters) ? a.craters : undefined,
        }, { outline: type.outline, hpPct });

        if (hpPct < 1) {
          const barColor = hpPct > 0.5 ? type.glow : hpPct > 0.25 ? '#f59e0b' : '#ef4444';
          drawHPBar(ctx, cur.x, cur.y - radius - 10, radius * 1.6, 3, hpPct, barColor);
        }
      });

      (gs.collectibles || []).forEach((c: any) => {
        const cx = safeNum(c.x, 0);
        const cy = safeNum(c.y, 0);
        if (Number.isNaN(cx) || Number.isNaN(cy)) return;
        if (cx < cam.x - 40 || cx > cam.x + viewW + 40 || cy < cam.y - 40 || cy > cam.y + viewH + 40) return;
        const gemColor = c.color || (safeNum(c.value, 50) >= 100 ? '#c084fc' : safeNum(c.value, 50) >= 70 ? '#67e8f9' : '#9ca3af');
        drawOreGem(ctx, cx, cy, safeNum(c.value, 50), gemColor, t, viewW / VIEW_SIZE);
      });

      // Projectiles: once spawned, fly straight (stable trajectory)
      const nowMs = now;
      const targets = projTargetsRef.current;
      const renders = projRendersRef.current;
      // STRICT: if projectile is not in authoritative state, remove immediately.
      for (const id of Array.from(renders.keys())) {
        if (!targets.has(id)) renders.delete(id);
      }
      for (const [id, tgt] of targets.entries()) {
        const existing = renders.get(id);
        const r = existing ?? { x: tgt.x, y: tgt.y, px: tgt.x, py: tgt.y, vx: tgt.vx, vy: tgt.vy, lastSeenAt: nowMs, locked: true, type: tgt.type, radius: tgt.radius, color: tgt.color };
        if (!existing) {
          // first sight: lock initial state
          r.x = tgt.x;
          r.y = tgt.y;
          r.px = tgt.x;
          r.py = tgt.y;
          r.vx = tgt.vx;
          r.vy = tgt.vy;
          r.locked = true;
        }
        // integrate forward only (straight line)
        r.px = r.x;
        r.py = r.y;
        r.x += (r.vx || 0) * dt;
        r.y += (r.vy || 0) * dt;
        r.type = tgt.type;
        r.radius = tgt.radius;
        r.color = tgt.color;
        r.lastSeenAt = nowMs;
        renders.set(id, r);

        if (r.x < cam.x - 80 || r.x > cam.x + viewW + 80 || r.y < cam.y - 80 || r.y > cam.y + viewH + 80) continue;
        if (r.type === 'plasma') {
          drawGlow(ctx, r.x, r.y, 25 * (viewW / VIEW_SIZE), '#a855f7', 0.4);
          ctx.fillStyle = colorAlpha('#a855f7', 0.9);
          ctx.shadowBlur = 15;
          ctx.shadowColor = '#a855f7';
          ctx.beginPath();
          ctx.arc(r.x, r.y, 12 * (viewW / VIEW_SIZE), 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          const c = r.color || '#60a5fa';
          const uiScale = viewW / VIEW_SIZE;
          // laser streak (looks more like a shot than a slow dot)
          drawBeam(ctx, r.px, r.py, r.x, r.y, c, 4.2 * uiScale, 0.95);
          drawGlow(ctx, r.x, r.y, 16 * uiScale, c, 0.18);
        }
      }

      // Players: build list from ref (prevents stale closure / invisible remotes)
      const playersList: Array<{ id: string; x?: number; y?: number; angle?: number; name?: string; modeState?: any; color?: string }> =
        Object.entries(ap).map(([id, pl]) => ({ ...(pl as any), id }));

      if (!playersList.some((pl: any) => pl.id === myId)) {
        playersList.push({
          id: myId,
          x: plX,
          y: plY,
          angle: localAimAngleRef.current,
          name: p?.name,
          modeState: p?.modeState,
        });
      }
      playersList.forEach((pl: any) => {
        const id = String(pl.id);
        const target = playerTargetsRef.current.get(id);
        if (!target) return;

        const cur = playerRendersRef.current.get(id) ?? { x: target.x, y: target.y, angle: target.angle };

        // optional prediction
        cur.x += (target.vx || 0) * dt;
        cur.y += (target.vy || 0) * dt;

        // EXACT LERP requested
        cur.x += (target.x - cur.x) * POS_LERP;
        cur.y += (target.y - cur.y) * POS_LERP;

        const targetAngle = id === myId ? localAimAngleRef.current : target.angle;
        const da = Math.atan2(Math.sin(targetAngle - cur.angle), Math.cos(targetAngle - cur.angle));
        cur.angle = cur.angle + da * POS_LERP;

        playerRendersRef.current.set(id, cur);

        const plx = cur.x;
        const ply = cur.y;
        if (Number.isNaN(plx) || Number.isNaN(ply)) return;
        if (plx < cam.x - 120 || plx > cam.x + viewW + 120 || ply < cam.y - 120 || ply > cam.y + viewH + 120) return;
        const angle = cur.angle;
        const color = playerHslColor(id);
        const scale = Math.max(0.3, (viewW / VIEW_SIZE) * 0.5);
        const radius = Math.max(12, 26 * scale);
        const isLocal = pl.id === myId;

        // Thrusters for everyone (based on server movement intent)
        const mvx = safeNum(pl.modeState?.vx, 0);
        const mvy = safeNum(pl.modeState?.vy, 0);
        const moveLen = Math.hypot(mvx, mvy);
        if (moveLen > 0.05 && Math.random() < 0.7) {
          // rear of ship based on its current rotation (not movement vector)
          const thrusterAngle = angle + Math.PI;
          const backX = plx - Math.cos(angle) * (radius * 0.95);
          const backY = ply - Math.sin(angle) * (radius * 0.95);
          particlesRef.current = particlesRef.current.concat(
            emitThrusterParticles(backX, backY, thrusterAngle, isLocal ? color : colorAlpha(color, 0.9), Math.min(1, moveLen), viewW / VIEW_SIZE)
          );
        }

        drawSpaceship(ctx, plx, ply, angle, color, radius, {
          playerId: id,
          name: pl.name || pl.id,
          isLocal,
          magnetRange: (pl.modeState?.magnetRange ?? 50) * scale,
          hasShield: !!pl.modeState?.hasShield,
          uiScale: viewW / VIEW_SIZE,
          showGlow: true,
        });
      });

      if (muzzleFlashRef.current.active && myId === playerId) {
        const mf = muzzleFlashRef.current;
        const myR = playerRendersRef.current.get(myId);
        const sx = safeNum(myR?.x, safeNum(p?.x, WORLD_SIZE / 2));
        const sy = safeNum(myR?.y, safeNum(p?.y, WORLD_SIZE / 2));
        const mfAngle = safeNum(mf.angle, 0);
        const mfIntensity = safeNum(mf.intensity, 0.5);
        if (!Number.isNaN(sx) && !Number.isNaN(sy) && sx >= cam.x - 120 && sx <= cam.x + viewW + 120 && sy >= cam.y - 120 && sy <= cam.y + viewH + 120) {
          drawMuzzleFlash(ctx, sx, sy, mfAngle, mfIntensity);
        }
        muzzleFlashRef.current.intensity = mfIntensity - dt * 8;
        if (muzzleFlashRef.current.intensity <= 0) muzzleFlashRef.current.active = false;
      }

      floatTextsRef.current = floatTextsRef.current.filter((ft) => {
        ft.life -= dt * 1.5;
        ft.y -= 40 * dt;
        if (ft.life <= 0) return false;
        ctx.globalAlpha = ft.life;
        ctx.fillStyle = '#22c55e';
        ctx.font = `bold ${14 * (viewW / VIEW_SIZE)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.globalAlpha = 1;
        return true;
      });

      particlesRef.current = tickParticles(ctx, particlesRef.current);

      ctx.restore();

      const mmSize = 180;
      const mmX = 20;
      const mmY = viewH - mmSize - 20;
      const scale = mmSize / WORLD_SIZE;
      ctx.fillStyle = 'rgba(10, 10, 25, 0.85)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 2;
      ctx.fillRect(mmX, mmY, mmSize, mmSize);
      ctx.strokeRect(mmX, mmY, mmSize, mmSize);
      ctx.fillStyle = 'rgba(150, 150, 150, 0.5)';
      (gs.asteroids || []).forEach((a: any) => {
        const ax = safeNum(a.x, 0);
        const ay = safeNum(a.y, 0);
        if (Number.isNaN(ax) || Number.isNaN(ay)) return;
        ctx.fillRect(mmX + ax * scale, mmY + ay * scale, 2, 2);
      });
      playersList.forEach((pl: any) => {
        ctx.fillStyle = playerHslColor(String(pl.id));
        ctx.beginPath();
        ctx.arc(mmX + safeNum(pl.x, 0) * scale, mmY + safeNum(pl.y, 0) * scale, pl.id === myId ? 5 : 4, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(mmX + cam.x * scale, mmY + cam.y * scale, viewW * scale, viewH * scale);

      ctx.restore();
      } catch (_) {
        ctx.restore();
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  const buyUpgrade = (id: string, cost: number) => {
    socket.emit('buyUpgrade', { code: roomCode, playerId, upgradeId: id, cost });
  };
  const equipWeapon = (weaponId: string) => {
    socket.emit('action', { code: roomCode, playerId, actionType: 'equipWeapon', weaponId });
  };
  const onCorrect = () => {
    socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: true });
  };
  const onWrong = () => {
    socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: false });
  };

  const sorted = Object.values(allPlayers || {}).sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
  const myRank = sorted.findIndex((p: any) => p.id === playerId) + 1;

  // Note: quiz modal is now a dedicated component (no mount/unmount flicker).

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Quick-switch weapons: 1/2/3/4
  useEffect(() => {
    const order = ['weapon_tier_1', 'weapon_tier_2', 'weapon_tier_3', 'weapon_tier_4'];
    const onKeyDown = (e: KeyboardEvent) => {
      if (quizOpenRef.current || modalOpenRef.current) return;
      const k = e.key;
      if (k !== '1' && k !== '2' && k !== '3' && k !== '4') return;
      const idx = Number(k) - 1;
      const id = order[idx];
      if (!id) return;
      const owned = Array.isArray(playerRef.current?.modeState?.ownedWeapons) ? playerRef.current.modeState.ownedWeapons : ['weapon_tier_1'];
      if (!owned.includes(id)) return;
      e.preventDefault();
      equipWeapon(id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [roomCode, playerId]);

  return (
    <div
      ref={containerRef}
      className="asteroid-game-root fixed inset-0 flex flex-col bg-[#020210] overflow-hidden outline-none"
      dir="rtl"
      tabIndex={0}
      onMouseDown={() => containerRef.current?.focus()}
    >
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 w-full h-full cursor-crosshair ${quizOpen || shopOpen ? 'pointer-events-none' : ''}`}
        style={{ width: '100%', height: '100%' }}
        onClick={handleCanvasClick}
        onTouchEnd={handleCanvasClick}
        onMouseMove={handleMouseMove}
        onTouchMove={handleTouchMove}
      />

      <div className="asteroid-top-hud absolute top-0 left-0 right-0 flex justify-between items-center p-3 z-20 pointer-events-none">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black/50 backdrop-blur-md border border-white/10">
            <Clock size={14} className="text-slate-400" />
            <span className={`font-mono text-sm font-bold ${timeLeft < 60 ? 'text-red-400 animate-pulse' : 'text-white'}`}>
              {minutes}:{seconds.toString().padStart(2, '0')}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 rounded-xl bg-purple-500/20 backdrop-blur-md border border-purple-400/30 text-purple-300 font-bold text-sm">
            💎 {ore}
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-cyan-500/20 backdrop-blur-md border border-cyan-400/30 text-cyan-300 font-bold text-sm">
            ⚡ {ammo}
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-green-500/20 backdrop-blur-md border border-green-400/30 text-green-300 font-bold text-sm">
            💰 {credits}
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-slate-800/60 backdrop-blur-md border border-slate-600/40 text-slate-300 font-bold text-sm">
            {equippedWeapon === 'weapon_tier_4' ? 'PLASMA' : equippedWeapon === 'weapon_tier_3' ? 'SPREAD' : equippedWeapon === 'weapon_tier_2' ? 'DUAL' : 'LASER'}
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-slate-800/60 backdrop-blur-md border border-slate-600/40 text-slate-300 font-bold text-sm">
            #{myRank}
          </span>
        </div>
      </div>

      {/* Local leaderboard removed — use universal `Leaderboard` overlay in `PlayerView`. */}

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-3 z-20 pointer-events-auto">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const now = performance.now();
            // Prevent double-fire from touch+click and repeated opens.
            if (quizOpenRef.current) return;
            if (now - quizOpenedAtRef.current < 500) return;
            // Clear inputs immediately so we don't get "stuck moving" if keyup never fires.
            keysRef.current = { up: false, down: false, left: false, right: false };
            socket.emit('move', { code: roomCode, playerId, dx: 0, dy: 0, angle: localAimAngleRef.current });
            quizOpenedAtRef.current = now;
            quizOpenRef.current = true; // set immediately (before React state flush)
            setQuizSessionId((s) => s + 1);
            setQuizOpen(true);
          }}
          className="px-6 py-3 rounded-xl font-bold flex items-center gap-2 bg-purple-600/90 hover:bg-purple-500 border border-purple-400/30 shadow-lg shadow-purple-500/20 backdrop-blur-sm"
        >
          <HelpCircle size={18} /> טרמינל שאלות
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShopOpen(true)}
          className="px-6 py-3 rounded-xl font-bold flex items-center gap-2 bg-orange-600/90 hover:bg-orange-500 border border-orange-400/30 shadow-lg shadow-orange-500/20 backdrop-blur-sm"
        >
          <ShoppingCart size={18} /> חנות נשק
        </motion.button>
      </div>

      <AnimatePresence>
        {ammo < 15 && !quizOpen && (
          <motion.div
            key="low-ammo"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 pointer-events-none"
          >
            <span className="text-xs bg-red-900/80 text-red-300 px-4 py-2 rounded-full font-bold border border-red-800/40 backdrop-blur-sm">
              אנרגיה נמוכה! ענה על שאלות כדי לטעון ⚡
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="absolute bottom-20 right-4 z-20 pointer-events-none text-[10px] text-slate-500">
        WASD / חצים לזוז • לחץ לירי (כיוון העכבר)
      </div>

      <QuizTerminalModal
        open={quizOpen}
        sessionId={quizSessionId}
        questions={quizQuestions as any[]}
        onCorrect={onCorrect}
        onWrong={onWrong}
        onClose={() => {
          quizOpenRef.current = false;
          setQuizOpen(false);
          containerRef.current?.focus();
        }}
      />

      <ShopModal
        open={shopOpen}
        credits={credits}
        ownedWeapons={ownedWeapons}
        equippedWeapon={equippedWeapon}
        laserDmg={laserDmg}
        magnetRange={magnetRange}
        hasShield={hasShield}
        onClose={() => setShopOpen(false)}
        onBuy={(upgradeId, cost) => buyUpgrade(upgradeId, cost)}
        onEquip={(weaponId) => equipWeapon(weaponId)}
      />

      <AmmoHud ammo={ammo} maxAmmo={100} />
    </div>
  );
}

function drawAsteroid(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  type: (typeof ASTEROID_TYPES)[number],
  rotation: number,
  hpPct: number
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  drawGlow(ctx, 0, 0, size * 1.8, type.glow, 0.08);
  ctx.fillStyle = type.body;
  ctx.strokeStyle = type.outline;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const points = 8;
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const r = size * (0.7 + ((Math.sin(i * 3.7 + rotation * 0.1) * 0.5 + 0.5) * 0.3));
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colorAlpha(type.crater, 0.4);
  ctx.beginPath();
  ctx.arc(-size * 0.25, -size * 0.15, size * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(size * 0.15, size * 0.2, size * 0.15, 0, Math.PI * 2);
  ctx.fill();
  if (type.name === 'crystal' || type.name === 'ice') {
    ctx.fillStyle = '#fff';
    const sparkle = 0.5 + 0.5 * Math.sin(rotation * 3);
    ctx.globalAlpha = sparkle * 0.6;
    ctx.beginPath();
    ctx.arc(-size * 0.1, -size * 0.3, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(size * 0.3, size * 0.05, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (hpPct < 0.6) {
    ctx.strokeStyle = colorAlpha('#ef4444', (1 - hpPct) * 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-size * 0.3, -size * 0.1);
    ctx.lineTo(0, size * 0.1);
    ctx.lineTo(size * 0.2, -size * 0.2);
    ctx.stroke();
  }
  ctx.restore();
}
