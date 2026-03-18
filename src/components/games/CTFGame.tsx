import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Trophy, Heart, ShieldAlert, BookOpen, CheckCircle, XCircle, ShoppingCart, Coins } from 'lucide-react';
import { QuestionPanel } from '../QuestionPanel';
import { socket } from '../../socket';
import { VirtualJoystick } from '../../engine/VirtualJoystick';
import { SoundManager } from '../../utils/SoundManager';
import {
  WORLD_W,
  WORLD_H,
  RED_BASE_X,
  RED_BASE_Y,
  BLUE_BASE_X,
  BLUE_BASE_Y,
  BASE_RADIUS,
  PLAYER_RADIUS,
  FLAG_RADIUS,
  MAX_ENERGY,
  MAX_HEALTH,
  MAX_AMMO,
  MOVEMENT_SPEED,
  SPRINT_MULTIPLIER,
  CTF_WEAPONS,
  CTF_WEAPON_LIST,
  type CTFTeam,
  type CTFObstacle,
  type CTFTerrainPatch,
  type CTFFlagState,
  type CTFBullet,
} from '../../constants/ctfConstants';
import {
  getCachedAssets,
  buildSpatialGrid,
  getVisibleTrees,
  TREE_TRUNK_HALF,
  TREE_CANOPY_HALF,
  BASE_CANVAS_HALF,
} from './ctfRenderCache';
import { ensureRemoteState, stepRemoteLerp, type RenderLerpState2D } from '../../engine/netLerp';

interface Props {
  roomCode: string;
  playerId: string;
  player: any;
  questions: any[];
  globalState: any;
  allPlayers: Record<string, any>;
  gameStateRef?: React.MutableRefObject<{ players: Record<string, any>; globalState: any }>;
  hudSnapshot?: { redScore: number; blueScore: number; gameOver: any; myPlayer: any } | null;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

// ── Sound engine (Web Audio) ──
class CTFSoundEngine {
  private ctx: AudioContext | null = null;
  init() {
    if (!this.ctx) this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  playTone(freq: number, type: OscillatorType, duration: number, vol: number = 0.1, sweep: boolean = false) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(freq / 2, this.ctx.currentTime + duration);
    gain.gain.setValueAtTime(vol, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }
  playShoot(wId: string) {
    this.init();
    if (wId === 'shotgun') this.playTone(300, 'square', 0.2, 0.1, true);
    else if (wId === 'ar') this.playTone(900, 'sawtooth', 0.08, 0.05);
    else if (wId === 'sniper') this.playTone(150, 'square', 0.4, 0.2, true);
    else if (wId === 'rocket') this.playTone(100, 'sine', 0.8, 0.3, true);
    else this.playTone(600, 'square', 0.1, 0.05, true);
  }
  playHit() {
    this.init();
    this.playTone(200, 'sawtooth', 0.1, 0.1);
  }
  playEmpty() {
    this.init();
    this.playTone(150, 'square', 0.05, 0.05);
  }
  playBuy() {
    this.init();
    this.playTone(1200, 'sine', 0.1, 0.1);
    setTimeout(() => this.playTone(1600, 'sine', 0.2, 0.1), 100);
  }
  playCorrect() {
    this.init();
    this.playTone(600, 'sine', 0.1, 0.1);
    setTimeout(() => this.playTone(800, 'sine', 0.2, 0.1), 100);
  }
  playWrong() {
    this.init();
    this.playTone(300, 'sawtooth', 0.3, 0.1, true);
  }
  playCapture() {
    this.init();
    this.playTone(400, 'sine', 0.1);
    setTimeout(() => this.playTone(600, 'sine', 0.1), 100);
    setTimeout(() => this.playTone(800, 'sine', 0.3), 200);
  }
  playDie() {
    this.init();
    this.playTone(150, 'sawtooth', 0.4, 0.2, true);
  }
}
const ctfSounds = new CTFSoundEngine();

function resolveMovement(
  x: number,
  y: number,
  dx: number,
  dy: number,
  speed: number,
  dt: number,
  obstacles: CTFObstacle[]
): { x: number; y: number } {
  const safe = (n: number, fallback: number) => (typeof n === 'number' && isFinite(n) ? n : fallback);
  const minX = PLAYER_RADIUS;
  const maxX = WORLD_W - PLAYER_RADIUS;
  const minY = PLAYER_RADIUS;
  const maxY = WORLD_H - PLAYER_RADIUS;
  x = safe(x, minX);
  y = safe(y, minY);
  x = Math.max(minX, Math.min(maxX, x));
  y = Math.max(minY, Math.min(maxY, y));
  if (!speed || !dt || (dx === 0 && dy === 0)) return { x, y };
  let nx = x + dx * speed * dt;
  let ny = y + dy * speed * dt;
  nx = Math.max(minX, Math.min(maxX, nx));
  ny = Math.max(minY, Math.min(maxY, ny));
  const list = Array.isArray(obstacles) ? obstacles : [];
  const EMBEDDED_THRESH = 1e-6;
  const MAX_PASSES = 3;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    for (const obs of list) {
      const ox = safe(obs.x, 0);
      const oy = safe(obs.y, 0);
      const rad = safe(obs.radius, 0);
      if (!isFinite(ox) || !isFinite(oy) || rad <= 0) continue;
      const minDist = PLAYER_RADIUS + rad;
      let dist = Math.hypot(nx - ox, ny - oy);
      if (dist >= minDist) continue;
      if (dist <= EMBEDDED_THRESH) {
        nx = ox + minDist;
        ny = oy;
        dist = minDist;
      } else {
        const overlap = minDist - dist;
        const nxNorm = (nx - ox) / dist;
        const nyNorm = (ny - oy) / dist;
        nx += nxNorm * overlap;
        ny += nyNorm * overlap;
      }
      const moveX = nx - x;
      const moveY = ny - y;
      const normalX = (nx - ox) / dist;
      const normalY = (ny - oy) / dist;
      const dot = moveX * normalX + moveY * normalY;
      if (dot < 0) {
        nx -= dot * normalX;
        ny -= dot * normalY;
      }
      nx = Math.max(minX, Math.min(maxX, nx));
      ny = Math.max(minY, Math.min(maxY, ny));
    }
  }
  if (!isFinite(nx) || !isFinite(ny)) return { x, y };
  nx = Math.max(minX, Math.min(maxX, nx));
  ny = Math.max(minY, Math.min(maxY, ny));
  return { x: nx, y: ny };
}

const LERP_MS = 50;
const VIEWPORT_BUFFER = 120;
const HUD_THROTTLE_MS = 250;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

export function CTFGame({ roomCode, playerId, player, questions, globalState, allPlayers, gameStateRef: externalGameStateRef, hudSnapshot }: Props) {
  const [messages, setMessages] = useState<{ id: number; text: string }[]>([]);
  const [showQuestion, setShowQuestion] = useState(false);
  const [showShop, setShowShop] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ globalState, allPlayers });
  const particlesRef = useRef<Particle[]>([]);
  const cameraRef = useRef({ x: WORLD_W / 2, y: WORLD_H / 2, shake: 0 });
  const posRef = useRef({
    x: player?.x ?? (player?.modeState?.team === 'blue' ? BLUE_BASE_X : RED_BASE_X),
    y: player?.y ?? (player?.modeState?.team === 'blue' ? BLUE_BASE_Y : RED_BASE_Y),
  });
  const inputRef = useRef({
    up: false,
    down: false,
    left: false,
    right: false,
    angle: 0,
    sprint: false,
    shoot: false,
  });
  const msgIdCounter = useRef(0);
  const serverSnapshotsRef = useRef<{ prev: { t: number; players: Record<string, any>; globalState: any }; curr: { t: number; players: Record<string, any>; globalState: any } }>({ prev: { t: 0, players: {}, globalState: {} }, curr: { t: 0, players: {}, globalState: {} } });
  const staticMapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const staticMapDirtyRef = useRef(true);
  const spatialGridRef = useRef<Map<string, CTFObstacle[]>>(new Map());
  const cachedAssetsRef = useRef<ReturnType<typeof getCachedAssets> | null>(null);
  const trailRef = useRef<Record<string, { x: number; y: number; t: number }[]>>({});
  const TRAIL_LEN = 5;
  const TRAIL_DECAY = 0.22;
  const serverTargetRef = useRef<{ x: number; y: number } | null>(null);
  const DESYNC_IGNORE_PX = 25;
  const RECONCILE_LERP_SPEED = 8;
  const VISUAL_LERP = 0.3;
  const lastSendRef = useRef(0);
  const lastShootRef = useRef(0);
  const modalBlockRef = useRef(false);
  const visualPosRef = useRef({ x: posRef.current.x, y: posRef.current.y });
  const remoteRenderRef = useRef<Record<string, RenderLerpState2D>>({});
  const bulletsRef = useRef<CTFBullet[]>([]);
  const joystickRef = useRef({ dx: 0, dy: 0 });
  const joystickBaseRef = useRef<HTMLDivElement>(null);
  if (!cachedAssetsRef.current) cachedAssetsRef.current = getCachedAssets();

  if (!externalGameStateRef) {
    stateRef.current = { globalState, allPlayers };
  }

  if (externalGameStateRef) {
    stateRef.current = externalGameStateRef.current;
  }

  useEffect(() => {
    if (!externalGameStateRef) return;
    const onTick = (data: any) => {
      const t = Date.now();
      const prev = serverSnapshotsRef.current.curr;
      serverSnapshotsRef.current = {
        prev: { t: prev.t, players: prev.players, globalState: prev.globalState },
        curr: { t, players: data.players || {}, globalState: data.globalState || {} },
      };
      const me = data.players?.[playerId];
      if (me && me.x != null && me.y != null) {
        serverTargetRef.current = { x: me.x, y: me.y };
      }
    };
    socket.on('tick', onTick);
    return () => { socket.off('tick', onTick); };
  }, [externalGameStateRef, playerId]);

  useEffect(() => {
    const onMsg = (msg: { text: string }) => {
      const id = msgIdCounter.current++;
      setMessages((prev) => [...prev.slice(-3), { id, text: msg.text }]);
      setTimeout(() => setMessages((prev) => prev.filter((m) => m.id !== id)), 4000);
    };
    const onScored = (data: { team: string; x: number; y: number }) => {
      ctfSounds.playCapture();
      cameraRef.current.shake = 25;
      const color = data.team === 'red' ? '#ff4444' : '#4444ff';
      for (let i = 0; i < 150; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 250 + 50;
        particlesRef.current.push({
          x: data.x,
          y: data.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          maxLife: 0.5 + Math.random(),
          color,
          size: Math.random() * 6 + 2,
        });
      }
    };
    const onTagged = () => {
      ctfSounds.playDie();
      cameraRef.current.shake = 15;
    };
    socket.on('ctfMessage', onMsg);
    socket.on('ctfScored', onScored);
    socket.on('ctfTagged', onTagged);
    return () => {
      socket.off('ctfMessage', onMsg);
      socket.off('ctfScored', onScored);
      socket.off('ctfTagged', onTagged);
    };
  }, []);

  // Universal immediate projectile spawns (do not wait for tick).
  useEffect(() => {
    const onSpawn = (msg: any) => {
      if (!msg || msg.mode !== 'ctf') return;
      const p = msg.projectile;
      if (!p || p.kind !== 'ctfBullet') return;
      const b = bulletsRef.current;
      if (b.some((x) => x.id === p.id)) return;
      b.push({
        id: p.id,
        x: p.x,
        y: p.y,
        vx: p.vx,
        vy: p.vy,
        team: p.team,
        ownerId: p.ownerId,
        damage: p.damage,
        color: p.color,
      });
    };
    socket.on('spawnProjectile', onSpawn);
    return () => { socket.off('spawnProjectile', onSpawn); };
  }, []);

  const onCorrect = useCallback(() => {
    socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: true });
    SoundManager.playCorrectSound();
  }, [roomCode, playerId]);
  const onWrong = useCallback(() => {
    socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: false });
    SoundManager.playWrongSound();
  }, [roomCode, playerId]);

  const toggleShop = useCallback(() => {
    if (showQuestion) return;
    setShowShop((s) => !s);
    inputRef.current.shoot = false;
  }, [showQuestion]);

  const openTrivia = useCallback(() => {
    if (showQuestion || showShop) return;
    setShowQuestion(true);
    inputRef.current.shoot = false;
  }, [showQuestion, showShop]);

  const buyOrEquipWeapon = useCallback(
    (wId: string) => {
      const p = stateRef.current.allPlayers?.[playerId] || player;
      if (!p) return;
      const inv = p.modeState?.inventory || ['pistol'];
      const coins = p.modeState?.coins ?? 0;
      const w = CTF_WEAPONS[wId];
      if (!w) return;
      if (inv.includes(wId)) {
        socket.emit('action', { code: roomCode, playerId, actionType: 'equipWeapon', weaponId: wId });
        ctfSounds.playBuy();
      } else if (coins >= w.cost) {
        socket.emit('buyUpgrade', { code: roomCode, playerId, upgradeId: wId, cost: w.cost });
        ctfSounds.playBuy();
      } else {
        ctfSounds.playWrong();
      }
    },
    [roomCode, playerId, player]
  );

  // Keyboard & mouse
  useEffect(() => {
    const i = inputRef.current;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showQuestion || showShop) {
        if (e.code === 'KeyB' || e.key === 'ב') {
          setShowShop((s) => !s);
        }
        return;
      }
      if (e.code === 'KeyW' || e.code === 'ArrowUp') i.up = true;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') i.down = true;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') i.left = true;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') i.right = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') i.sprint = true;
      if (e.code === 'KeyQ' || e.code === 'Slash') openTrivia();
      if (['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].includes(e.code)) {
        const idx = parseInt(e.code.replace('Digit', ''), 10) - 1;
        if (idx < CTF_WEAPON_LIST.length) {
          const wId = CTF_WEAPON_LIST[idx].id;
          const inv = (stateRef.current.allPlayers?.[playerId] || player)?.modeState?.inventory || ['pistol'];
          if (inv.includes(wId)) socket.emit('action', { code: roomCode, playerId, actionType: 'equipWeapon', weaponId: wId });
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') i.up = false;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') i.down = false;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') i.left = false;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') i.right = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') i.sprint = false;
    };
    const handleMouseMove = (e: MouseEvent) => {
      if (showQuestion || showShop) return;
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      i.angle = Math.atan2(e.clientY - cy, e.clientX - cx);
    };
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0 && !showQuestion && !showShop) i.shoot = true;
    };
    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 0) i.shoot = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [showQuestion, showShop, roomCode, playerId, player, openTrivia]);

  useEffect(() => {
    modalBlockRef.current = showQuestion || showShop;
  }, [showQuestion, showShop]);

  // Map questions format: optional { options, ans } -> { opts, a }
  const mappedQuestions = (questions || []).map((q: any) =>
    q.opts != null ? q : { q: q.q, opts: q.options || q.opts || [], a: q.ans ?? q.a ?? 0 }
  );

  const myPlayer = hudSnapshot?.myPlayer ?? allPlayers?.[playerId] ?? player;
  const team = (myPlayer?.modeState?.team || 'red') as CTFTeam;
  const energy = Math.floor(myPlayer?.resources ?? 0);
  const hasFlag = myPlayer?.modeState?.hasFlag;
  const isDead = myPlayer?.modeState?.dead;
  const redScore = hudSnapshot?.redScore ?? globalState?.redScore ?? 0;
  const blueScore = hudSnapshot?.blueScore ?? globalState?.blueScore ?? 0;
  const gameOver = hudSnapshot?.gameOver ?? globalState?.gameOver;

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    let raf: number;
    let lastTime = performance.now();

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();

    const render = (time: number) => {
      try {
      const dt = (time - lastTime) / 1000;
      lastTime = time;
      const now = Date.now();
      let gs: any;
      let players: Record<string, any>;
      const snap = serverSnapshotsRef.current;
      const useLerp = externalGameStateRef && snap.curr.t > 0 && snap.prev.t > 0;
      if (useLerp) {
        const denom = snap.curr.t - snap.prev.t || LERP_MS;
        const alpha = Math.min(1, (now - snap.prev.t) / denom);
        gs = snap.curr.globalState;
        const prevP = snap.prev.players;
        const currP = snap.curr.players;
        players = {};
        const allIds = new Set([...Object.keys(prevP), ...Object.keys(currP)]);
        allIds.forEach((id) => {
          const a = prevP[id];
          const b = currP[id];
          if (!b) return;
          if (!a) { players[id] = b; return; }
          players[id] = { ...b, x: lerp(a.x, b.x, alpha), y: lerp(a.y, b.y, alpha) };
        });
      } else {
        const src = stateRef.current;
        gs = src.globalState;
        players = src.allPlayers || {};
      }
      if (!gs) {
        raf = requestAnimationFrame(render);
        return;
      }

      const myP = players?.[playerId] || player;
      const obstacles = gs?.obstacles || [];
      const dead = myP?.modeState?.dead ?? false;
      const energy = myP?.resources ?? 0;

      if (playerId) {
        if (dead && serverTargetRef.current) {
          posRef.current.x = serverTargetRef.current.x;
          posRef.current.y = serverTargetRef.current.y;
          visualPosRef.current.x = serverTargetRef.current.x;
          visualPosRef.current.y = serverTargetRef.current.y;
          serverTargetRef.current = null;
        } else if (!dead && serverTargetRef.current) {
          const tx = serverTargetRef.current.x;
          const ty = serverTargetRef.current.y;
          const desync = Math.hypot(posRef.current.x - tx, posRef.current.y - ty);
          if (desync < DESYNC_IGNORE_PX) {
            serverTargetRef.current = null;
          } else {
            const k = Math.min(1, RECONCILE_LERP_SPEED * dt);
            posRef.current.x += (tx - posRef.current.x) * k;
            posRef.current.y += (ty - posRef.current.y) * k;
            if (Math.hypot(posRef.current.x - tx, posRef.current.y - ty) < 5) serverTargetRef.current = null;
          }
        }

        if (!dead && !modalBlockRef.current) {
          const i = inputRef.current;
          let dx = 0, dy = 0;
          if (i.up) dy -= 1;
          if (i.down) dy += 1;
          if (i.left) dx -= 1;
          if (i.right) dx += 1;
          dx += joystickRef.current.dx;
          dy += joystickRef.current.dy;
          if (dx !== 0 || dy !== 0) {
            const len = Math.sqrt(dx * dx + dy * dy);
            dx /= len;
            dy /= len;
            const speed = MOVEMENT_SPEED * (i.sprint && energy > 0 ? SPRINT_MULTIPLIER : 1);
            const resolved = resolveMovement(posRef.current.x, posRef.current.y, dx, dy, speed, dt, obstacles);
            if (isFinite(resolved.x) && isFinite(resolved.y)) {
              posRef.current.x = resolved.x;
              posRef.current.y = resolved.y;
            }
          }
          if (now - lastSendRef.current > 50) {
            socket.emit('updatePosition', {
              code: roomCode,
              playerId,
              x: posRef.current.x,
              y: posRef.current.y,
              angle: i.angle,
            });
            lastSendRef.current = now;
          }
          const weaponId = myP.modeState?.currentWeapon || 'pistol';
          const fireRateSec = CTF_WEAPONS[weaponId]?.fireRate ?? 0.35;
          const fireRateMs = Math.max(50, fireRateSec * 1000);
          if (i.shoot && (myP?.modeState?.ammo ?? 0) > 0 && now - lastShootRef.current > fireRateMs) {
            socket.emit('action', { code: roomCode, playerId, actionType: 'shoot', aimAngle: i.angle });
            lastShootRef.current = now;
            const wId = weaponId;
            SoundManager.playShootSound();
            if (myP.modeState.ammo === 1) SoundManager.playWrongSound();
          } else if (i.shoot && (myP?.modeState?.ammo ?? 0) <= 0 && now - lastShootRef.current > 500) {
            lastShootRef.current = now;
            SoundManager.playWrongSound();
          }
        }
      }

      const k = Math.min(1, VISUAL_LERP);
      if (playerId) {
        visualPosRef.current.x += (posRef.current.x - visualPosRef.current.x) * k;
        visualPosRef.current.y += (posRef.current.y - visualPosRef.current.y) * k;
      }
      const rr = remoteRenderRef.current;
      Object.keys(players || {}).forEach((id) => {
        if (id === playerId) return;
        const p = players[id];
        if (!p || p.modeState?.dead) return;
        const tx = p.x ?? 0;
        const ty = p.y ?? 0;
        const ta = p.modeState?.angle ?? p.angle ?? 0;
        const st = ensureRemoteState(rr, id, tx, ty, ta);
        st.targetX = tx;
        st.targetY = ty;
        st.targetAngle = ta;
        stepRemoteLerp(st, 0.2);
      });
      // Ghost prevention: remove missing remote players immediately.
      for (const id of Object.keys(rr)) {
        if (id === playerId) continue;
        if (!players?.[id]) delete rr[id];
      }

      const cam = cameraRef.current;
      if (myP && !myP.modeState?.dead) {
        const camX = playerId ? visualPosRef.current.x : myP.x;
        const camY = playerId ? visualPosRef.current.y : myP.y;
        cam.x += (camX - cam.x) * 8 * dt;
        cam.y += (camY - cam.y) * 8 * dt;
      }
      let shakeX = 0, shakeY = 0;
      if (cam.shake > 0) {
        shakeX = (Math.random() - 0.5) * cam.shake;
        shakeY = (Math.random() - 0.5) * cam.shake;
        cam.shake -= dt * 40;
      }

      const isMobileView = typeof window !== 'undefined' && window.innerWidth < 768;
      const isLandscape = typeof window !== 'undefined' && window.innerWidth > window.innerHeight;
      // Mobile FOV: zoom out further in landscape to free up central gameplay space.
      const viewScale = isMobileView ? (isLandscape ? 0.65 : 0.72) : 1;
      const viewW = canvas.width / viewScale;
      const viewH = canvas.height / viewScale;

      ctx.fillStyle = '#1e3f20';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(canvas.width / 2 + shakeX, canvas.height / 2 + shakeY);
      ctx.scale(viewScale, viewScale);
      ctx.translate(-cam.x, -cam.y);

      const vLeft = cam.x - viewW / 2 - VIEWPORT_BUFFER;
      const vRight = cam.x + viewW / 2 + VIEWPORT_BUFFER;
      const vTop = cam.y - viewH / 2 - VIEWPORT_BUFFER;
      const vBottom = cam.y + viewH / 2 + VIEWPORT_BUFFER;

      if (staticMapDirtyRef.current && gs) {
        const off = document.createElement('canvas');
        off.width = WORLD_W;
        off.height = WORLD_H;
        const octx = off.getContext('2d');
        if (octx) {
          octx.fillStyle = '#1e3f20';
          octx.fillRect(0, 0, WORLD_W, WORLD_H);
          (gs.terrain || []).forEach((patch: CTFTerrainPatch) => {
            octx.beginPath();
            octx.arc(patch.x, patch.y, patch.radius, 0, Math.PI * 2);
            octx.fillStyle = patch.type === 'dirt' ? '#3a2e1d' : '#18331a';
            octx.fill();
          });
          octx.lineCap = 'round';
          octx.lineJoin = 'round';
          octx.beginPath();
          octx.moveTo(RED_BASE_X, RED_BASE_Y);
          octx.bezierCurveTo(WORLD_W * 0.3, WORLD_H * 0.2, WORLD_W * 0.7, WORLD_H * 0.8, BLUE_BASE_X, BLUE_BASE_Y);
          octx.strokeStyle = '#2a2e33';
          octx.lineWidth = 140;
          octx.stroke();
          octx.beginPath();
          octx.moveTo(RED_BASE_X, RED_BASE_Y);
          octx.bezierCurveTo(WORLD_W * 0.3, WORLD_H * 0.2, WORLD_W * 0.7, WORLD_H * 0.8, BLUE_BASE_X, BLUE_BASE_Y);
          octx.strokeStyle = '#eab308';
          octx.lineWidth = 4;
          octx.setLineDash([30, 30]);
          octx.stroke();
          octx.setLineDash([]);
          const gridStep = 150;
          octx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
          octx.lineWidth = 2;
          for (let x = 0; x <= WORLD_W; x += gridStep) {
            octx.beginPath();
            octx.moveTo(x, 0);
            octx.lineTo(x, WORLD_H);
            octx.stroke();
          }
          for (let y = 0; y <= WORLD_H; y += gridStep) {
            octx.beginPath();
            octx.moveTo(0, y);
            octx.lineTo(WORLD_W, y);
            octx.stroke();
          }
          octx.strokeStyle = '#ef4444';
          octx.lineWidth = 10;
          octx.strokeRect(0, 0, WORLD_W, WORLD_H);
          (gs.obstacles || []).forEach((obs: CTFObstacle) => {
            if (obs.type === 'tree') return;
            octx.fillStyle = 'rgba(0,0,0,0.4)';
            octx.beginPath();
            if (obs.type === 'crate') octx.rect(obs.x - obs.radius + 15, obs.y - obs.radius + 15, obs.radius * 2, obs.radius * 2);
            else octx.arc(obs.x + 15, obs.y + 15, obs.visualRadius, 0, Math.PI * 2);
            octx.fill();
            if (obs.type === 'rock') {
              octx.fillStyle = '#64748b';
              octx.beginPath();
              for (let j = 0; j < 6; j++) {
                const a = (j / 6) * Math.PI * 2 + obs.seed;
                const r = obs.radius * (0.8 + ((obs.seed * j) % 0.4));
                octx.lineTo(obs.x + Math.cos(a) * r, obs.y + Math.sin(a) * r);
              }
              octx.fill();
            } else if (obs.type === 'crate') {
              octx.fillStyle = '#d97706';
              octx.fillRect(obs.x - obs.radius, obs.y - obs.radius, obs.radius * 2, obs.radius * 2);
              octx.strokeStyle = '#92400e';
              octx.lineWidth = 4;
              octx.strokeRect(obs.x - obs.radius, obs.y - obs.radius, obs.radius * 2, obs.radius * 2);
            }
          });
        }
        staticMapCanvasRef.current = off;
        spatialGridRef.current = buildSpatialGrid(gs.obstacles || []);
        staticMapDirtyRef.current = false;
      }
      if (staticMapCanvasRef.current) {
        ctx.drawImage(staticMapCanvasRef.current, 0, 0, WORLD_W, WORLD_H, 0, 0, WORLD_W, WORLD_H);
      }

      const assets = cachedAssetsRef.current!;
      const visibleTrees = getVisibleTrees(spatialGridRef.current, vLeft, vRight, vTop, vBottom);

      // Layer 2: Bases (cached), dropped flags, tree trunks (cached)
      ctx.drawImage(assets.baseRed, RED_BASE_X - BASE_CANVAS_HALF, RED_BASE_Y - BASE_CANVAS_HALF);
      ctx.drawImage(assets.baseBlue, BLUE_BASE_X - BASE_CANVAS_HALF, BLUE_BASE_Y - BASE_CANVAS_HALF);
      const drawDroppedFlag = (flag: CTFFlagState, color: string) => {
        if (flag.carrier) return;
        if (flag.x < vLeft - 50 || flag.x > vRight + 50 || flag.y < vTop - 50 || flag.y > vBottom + 50) return;
        const pulse = 1 + Math.sin(time / 200) * 0.1;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(flag.x, flag.y, FLAG_RADIUS * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(flag.x - 12, flag.y + 18);
        ctx.lineTo(flag.x - 12, flag.y - 30);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(flag.x - 10, flag.y - 28);
        ctx.lineTo(flag.x + 20, flag.y - 15);
        ctx.lineTo(flag.x - 10, flag.y - 2);
        ctx.fill();
      };
      drawDroppedFlag(gs.redFlag || { x: RED_BASE_X, y: RED_BASE_Y, team: 'red', carrier: null }, '#ef4444');
      drawDroppedFlag(gs.blueFlag || { x: BLUE_BASE_X, y: BLUE_BASE_Y, team: 'blue', carrier: null }, '#3b82f6');
      for (let i = 0; i < visibleTrees.length; i++) {
        const obs = visibleTrees[i];
        ctx.drawImage(assets.treeTrunk, obs.x - TREE_TRUNK_HALF, obs.y - TREE_TRUNK_HALF);
      }

      // Layer 3: Bullets — sync from server (add/remove only), extrapolate position every frame
      const serverBullets = gs.bullets || [];
      const bulletList = bulletsRef.current;
      serverBullets.forEach((sb: CTFBullet) => {
        if (!bulletList.find((b) => b.id === sb.id)) {
          bulletList.push({
            id: sb.id,
            x: sb.x,
            y: sb.y,
            vx: sb.vx,
            vy: sb.vy,
            team: sb.team,
            ownerId: sb.ownerId,
            damage: sb.damage,
            color: sb.color,
          });
        }
      });
      bulletsRef.current = bulletList.filter((b) => serverBullets.some((s: CTFBullet) => s.id === b.id));
      bulletsRef.current.forEach((b) => {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
      });
      bulletsRef.current.forEach((b: CTFBullet) => {
        if (b.x < vLeft - 20 || b.x > vRight + 20 || b.y < vTop - 20 || b.y > vBottom + 20) return;
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.damage > 50 ? 8 : 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = b.color;
        ctx.lineWidth = b.damage > 50 ? 5 : 3;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - b.vx * 0.04, b.y - b.vy * 0.04);
        ctx.stroke();
        ctx.globalAlpha = 1;
      });

      // Particles
      particlesRef.current = particlesRef.current.filter((p) => {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) return false;
        ctx.globalAlpha = p.life / p.maxLife;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        return true;
      });

      // Layer 3 (continued): Motion trails then players (bobbing, helmet, vest, weapon)
      const playersList = Object.values(players || {});
      if (!trailRef.current) trailRef.current = {};
      playersList.forEach((p: any) => {
        if (!p?.id) return;
        if (p.modeState?.dead) return;
        const st = p.id !== playerId ? rr[p.id] : null;
        const px = p.id === playerId ? visualPosRef.current.x : (st?.renderX ?? p.x);
        const py = p.id === playerId ? visualPosRef.current.y : (st?.renderY ?? p.y);
        if (!trailRef.current[p.id]) trailRef.current[p.id] = [];
        const trail = trailRef.current[p.id];
        const last = trail[trail.length - 1];
        const dist = last ? Math.hypot(px - last.x, py - last.y) : 10;
        if (dist > 3 || trail.length === 0) {
          trail.push({ x: px, y: py, t: time });
          if (trail.length > TRAIL_LEN) trail.shift();
        }
      });
      playersList
        .sort((a: any, b: any) => (a.y ?? 0) - (b.y ?? 0))
        .forEach((p: any) => {
          if (!p?.id) return;
          if (p.modeState?.dead) return;
          const st = p.id !== playerId ? rr[p.id] : null;
          const px = p.id === playerId ? visualPosRef.current.x : (st?.renderX ?? p.x);
          const py = p.id === playerId ? visualPosRef.current.y : (st?.renderY ?? p.y);
          if (px < vLeft - 80 || px > vRight + 80 || py < vTop - 80 || py > vBottom + 80) return;

          const angle = p.id === playerId ? inputRef.current.angle : (st?.renderAngle ?? (p.modeState?.angle ?? 0));
          const trail = trailRef.current[p.id] || [];
          const vel = trail.length >= 2 ? Math.hypot(trail[trail.length - 1].x - trail[0].x, trail[trail.length - 1].y - trail[0].y) / Math.max(1, trail.length) : 0;

          const bob = Math.sin(time * 0.008) * 1.5 + (vel > 5 ? Math.sin(time * 0.02) * 3 : 0);
          const sway = vel > 5 ? Math.sin(time * 0.015) * 4 : Math.sin(time * 0.006) * 2;
          const pColor = p.modeState?.team === 'red' ? '#ef4444' : '#3b82f6';
          const pDark = p.modeState?.team === 'red' ? '#991b1b' : '#1e40af';
          const visorGlow = p.modeState?.team === 'red' ? 'rgba(239,68,68,0.7)' : 'rgba(96,165,250,0.7)';

          for (let ti = 0; ti < trail.length; ti++) {
            const pt = trail[ti];
            const age = (time - pt.t) * 0.002;
            const alpha = Math.max(0, 1 - age - ti * TRAIL_DECAY);
            if (alpha <= 0) continue;
            ctx.save();
            ctx.translate(pt.x, pt.y);
            ctx.globalAlpha = alpha * 0.5;
            ctx.fillStyle = p.modeState?.team === 'red' ? '#ef4444' : '#3b82f6';
            ctx.beginPath();
            ctx.ellipse(0, 0, PLAYER_RADIUS * 1.1, PLAYER_RADIUS * 0.95, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.restore();
          }

          ctx.save();
          ctx.translate(px, py + bob);
          ctx.rotate(angle);

          ctx.fillStyle = '#1e293b';
          ctx.beginPath();
          ctx.ellipse(-4, 14 + sway * 0.3, 10, 12, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(-4, -14 - sway * 0.3, 10, 12, 0, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = pDark;
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(0, 0, PLAYER_RADIUS * 1.05, PLAYER_RADIUS * 0.9, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#334155';
          ctx.beginPath();
          ctx.moveTo(-18, 8);
          ctx.lineTo(-18, -8);
          ctx.lineTo(-8, -12);
          ctx.lineTo(PLAYER_RADIUS + 4, 0);
          ctx.lineTo(-8, 12);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#475569';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          const wLen = p.modeState?.currentWeapon === 'sniper' ? 42 : p.modeState?.currentWeapon === 'rocket' ? 38 : 28;
          const gunX = PLAYER_RADIUS + 14 + Math.sin(sway * 0.05) * 2;
          const gunY = sway * 0.4;
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(gunX, gunY - 4, wLen, 8);
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = CTF_WEAPONS[p.modeState?.currentWeapon || 'pistol']?.color || '#fff';
          ctx.fillRect(gunX + wLen - 14, gunY - 3, 10, 6);
          ctx.fillStyle = '#64748b';
          ctx.fillRect(gunX + 2, gunY - 2, 8, 4);

          ctx.beginPath();
          ctx.arc(0, -2, PLAYER_RADIUS * 0.85, 0, Math.PI * 2);
          ctx.fillStyle = '#1e293b';
          ctx.fill();
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(0, -2, PLAYER_RADIUS * 0.6, 0, Math.PI * 2);
          ctx.fillStyle = pColor;
          ctx.fill();
          ctx.strokeStyle = pDark;
          ctx.stroke();

          ctx.beginPath();
          ctx.ellipse(PLAYER_RADIUS * 0.25, -2, PLAYER_RADIUS * 0.4, PLAYER_RADIUS * 0.32, 0, -Math.PI / 2.2, Math.PI / 2.2);
          ctx.fillStyle = visorGlow;
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.4)';
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.restore();
          ctx.save();
          ctx.translate(px, py + bob);
          ctx.fillStyle = 'white';
          ctx.font = 'bold 14px "Segoe UI", Arial';
          ctx.textAlign = 'center';
          ctx.fillText(`${p.name} [${p.modeState?.ammo ?? 0}]`, 0, -52);
          const barW = 40;
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(-barW / 2, -45, barW, 5);
          ctx.fillStyle = '#22c55e';
          ctx.fillRect(-barW / 2, -45, barW * ((p.modeState?.hp ?? 100) / MAX_HEALTH), 5);
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 1;
          ctx.strokeRect(-barW / 2, -45, barW, 5);
          if (gs.redFlag?.carrier === p.id || gs.blueFlag?.carrier === p.id) {
            const flagColor = gs.redFlag?.carrier === p.id ? '#ef4444' : '#3b82f6';
            ctx.fillStyle = flagColor;
            ctx.beginPath();
            ctx.moveTo(0, -78);
            ctx.lineTo(15, -68);
            ctx.lineTo(0, -58);
            ctx.fill();
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 2;
            ctx.stroke();
          }
          ctx.restore();
        });

      // Layer 4: Tree canopies (drawn last so players under trees are hidden)
      for (let i = 0; i < visibleTrees.length; i++) {
        const obs = visibleTrees[i];
        ctx.drawImage(assets.treeCanopy, obs.x - TREE_CANOPY_HALF, obs.y - TREE_CANOPY_HALF);
      }

      ctx.restore();

      // Minimap — on mobile: smaller and centered between the two joysticks
      const mobileMap = isMobileView;
      const mapW = mobileMap ? 140 : 240;
      const mapH = mobileMap ? 84 : 144;
      const mapX = mobileMap ? (canvas.width - mapW) / 2 : canvas.width - mapW - 20;
      const mapY = mobileMap ? canvas.height - mapH - 118 : canvas.height - mapH - 20;
      const mapR = mobileMap ? mapW / 240 : 1;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.beginPath();
      (ctx as any).roundRect?.(mapX, mapY, mapW, mapH, 12 * mapR);
      ctx.fill();
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 3 * mapR;
      ctx.stroke();
      ctx.fillStyle = 'rgba(239, 68, 68, 0.3)';
      ctx.beginPath();
      ctx.arc(mapX + (RED_BASE_X / WORLD_W) * mapW, mapY + (RED_BASE_Y / WORLD_H) * mapH, 8 * mapR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(59, 130, 246, 0.3)';
      ctx.beginPath();
      ctx.arc(mapX + (BLUE_BASE_X / WORLD_W) * mapW, mapY + (BLUE_BASE_Y / WORLD_H) * mapH, 8 * mapR, 0, Math.PI * 2);
      ctx.fill();
      playersList.forEach((p: any) => {
        if (p.modeState?.dead) return;
        const st = p.id !== playerId ? rr[p.id] : null;
        const px = mapX + (p.id === playerId ? visualPosRef.current.x : (st?.renderX ?? p.x)) / WORLD_W * mapW;
        const py = mapY + (p.id === playerId ? visualPosRef.current.y : (st?.renderY ?? p.y)) / WORLD_H * mapH;
        ctx.fillStyle = p.id === playerId ? '#ffffff' : (p.modeState?.team === 'red' ? '#ef4444' : '#3b82f6');
        ctx.beginPath();
        ctx.arc(px, py, (p.id === playerId ? 4 : 2.5) * mapR, 0, Math.PI * 2);
        ctx.fill();
      });
      const drawMapFlag = (f: CTFFlagState, c: string) => {
        const px = mapX + (f.x / WORLD_W) * mapW;
        const py = mapY + (f.y / WORLD_H) * mapH;
        const s = 3 * mapR;
        ctx.fillStyle = c;
        ctx.fillRect(px - s, py - s, 2 * s, 2 * s);
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1.5 * mapR;
        ctx.strokeRect(px - s, py - s, 2 * s, 2 * s);
      };
      drawMapFlag(gs.redFlag || { x: RED_BASE_X, y: RED_BASE_Y, team: 'red', carrier: null }, '#ef4444');
      drawMapFlag(gs.blueFlag || { x: BLUE_BASE_X, y: BLUE_BASE_Y, team: 'blue', carrier: null }, '#3b82f6');
      } catch (err) {
        console.error('Render error:', err);
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [playerId, player]);

  const handleJoystickStart = (e: React.TouchEvent) => {
    e.preventDefault();
  };
  const handleJoystickMove = (e: React.TouchEvent) => {
    e.preventDefault();
    const el = joystickBaseRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const t = e.touches[0];
    if (!t) return;
    let dx = (t.clientX - cx) / (rect.width / 2);
    let dy = (t.clientY - cy) / (rect.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    joystickRef.current = { dx, dy };
  };
  const handleJoystickEnd = () => {
    joystickRef.current = { dx: 0, dy: 0 };
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 select-none font-sans ctf-game-container" dir="rtl" onContextMenu={(e) => e.preventDefault()}>
      <canvas ref={canvasRef} className="absolute inset-0 z-0 w-full h-full" style={{ width: '100%', height: '100%' }} />
      {/* Mobile: left = move, right = twin-stick aim + shoot (visible only @ max-width: 768px) */}
      <div
        ref={joystickBaseRef}
        className="md:hidden fixed bottom-6 left-6 w-28 h-28 rounded-full bg-white/20 border-2 border-white/50 touch-none flex items-center justify-center z-30 cursor-pointer select-none"
        style={{ touchAction: 'none' }}
        onTouchStart={handleJoystickStart}
        onTouchMove={handleJoystickMove}
        onTouchEnd={handleJoystickEnd}
        onTouchCancel={handleJoystickEnd}
      >
        <div className="w-10 h-10 rounded-full bg-white/50" />
      </div>
      <div className="md:hidden fixed bottom-6 right-6 z-30 pointer-events-auto" style={{ touchAction: 'none' }}>
        <VirtualJoystick
          size={100}
          teamColor={myPlayer?.modeState?.team === 'red' ? 'rgba(239,68,68,0.5)' : 'rgba(59,130,246,0.5)'}
          onMove={(dx, dy) => {
            if (dx !== 0 || dy !== 0) inputRef.current.angle = Math.atan2(dy, dx);
            inputRef.current.shoot = true;
          }}
          onRelease={() => {
            inputRef.current.shoot = false;
          }}
        />
      </div>

      {/* HUD – compact on mobile via ctf-hud-* classes */}
      <style>{`
        @media (max-width: 768px) {
          .ctf-hud-bar {
            flex-wrap: wrap;
            gap: 0.35rem !important;
            padding: 0.35rem 0.5rem !important;
            padding-left: env(safe-area-inset-left);
            padding-right: env(safe-area-inset-right);
            border-radius: 0 0 0.75rem 0.75rem;
          }
          .ctf-hud-bar .ctf-score-label { font-size: 0.6rem !important; }
          .ctf-hud-bar .ctf-score-value { font-size: 1.25rem !important; }
          .ctf-hud-vs { font-size: 0.8rem !important; }
          .ctf-hud-player-panel {
            width: 100% !important;
            max-width: 11rem;
            padding: 0.4rem 0.5rem !important;
            gap: 0.25rem !important;
          }
          .ctf-hud-player-panel .ctf-player-name { font-size: 0.75rem !important; }
          .ctf-hud-player-panel .ctf-ammo-label, .ctf-hud-player-panel .ctf-weapon-label { font-size: 0.6rem !important; }
          .ctf-hud-player-panel .ctf-ammo-value { font-size: 0.9rem !important; }
          .ctf-hud-player-panel .ctf-weapon-value { font-size: 0.7rem !important; }
          .ctf-hud-buttons .ctf-hud-btn { padding: 0.4rem 0.5rem !important; font-size: 0.7rem !important; }
        }
      `}</style>
      <div className="absolute top-0 left-0 right-0 p-2 md:p-4 z-10 flex flex-wrap justify-between items-start gap-2 pointer-events-none ctf-hud-root">
        <div className="ctf-hud-bar flex items-center gap-4 md:gap-8 bg-slate-900/90 backdrop-blur-md border-b-2 border-slate-700/50 px-4 md:px-8 py-2 md:py-4 rounded-b-3xl shadow-2xl pointer-events-auto transform -translate-y-4 hover:translate-y-0 transition-transform">
          <div className="flex flex-col items-center">
            <span className="ctf-score-label text-blue-400 font-bold text-sm tracking-widest uppercase">צוות כחול</span>
            <span className="ctf-score-value text-3xl md:text-5xl font-black text-white drop-shadow-md">{blueScore}</span>
          </div>
          <div className="ctf-hud-vs text-slate-600 font-black text-xl md:text-3xl italic">VS</div>
          <div className="flex flex-col items-center">
            <span className="ctf-score-label text-red-400 font-bold text-sm tracking-widest uppercase">צוות אדום</span>
            <span className="ctf-score-value text-3xl md:text-5xl font-black text-white drop-shadow-md">{redScore}</span>
          </div>
        </div>

        {myPlayer && (
          <div className="ctf-hud-player-panel flex flex-col gap-2 md:gap-3 items-end pointer-events-auto w-56 md:w-72">
            <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/50 px-4 md:px-5 py-2 rounded-2xl flex flex-col w-full shadow-lg">
              <div className="flex items-center justify-between border-b border-slate-700 pb-2 mb-2">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${team === 'red' ? 'bg-red-500' : 'bg-blue-500'}`} />
                  <span className="ctf-player-name text-white font-bold text-base md:text-lg">{myPlayer.name}</span>
                </div>
                <div className="flex items-center gap-1 text-yellow-400 font-black text-base md:text-xl">
                  {myPlayer.modeState?.coins ?? 0} <Coins className="w-4 h-4 md:w-5 md:h-5" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="ctf-ammo-label text-slate-400 text-sm font-bold">תחמושת:</span>
                <div className="ctf-ammo-value font-mono font-black text-lg md:text-xl">
                  <span className={(myPlayer.modeState?.ammo ?? 0) === 0 ? 'text-red-500 animate-pulse' : 'text-white'}>
                    {myPlayer.modeState?.ammo ?? 0}
                  </span>
                  <span className="text-sm text-slate-500">/{MAX_AMMO}</span>
                </div>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="ctf-weapon-label text-slate-400 text-sm font-bold">נשק:</span>
                <span className="ctf-weapon-value text-emerald-400 font-bold text-sm md:text-base" style={{ color: CTF_WEAPONS[myPlayer.modeState?.currentWeapon || 'pistol']?.color }}>
                  {CTF_WEAPONS[myPlayer.modeState?.currentWeapon || 'pistol']?.name}
                </span>
              </div>
            </div>
            <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/50 p-3 rounded-2xl flex items-center gap-3 w-full shadow-lg">
              <Heart className="w-6 h-6 text-red-500 drop-shadow" fill="currentColor" />
              <div className="flex-1 h-4 bg-slate-800 rounded-full overflow-hidden relative shadow-inner">
                <div
                  className="absolute top-0 bottom-0 right-0 bg-gradient-to-l from-green-400 to-green-600 transition-all duration-200"
                  style={{ width: `${((myPlayer.modeState?.hp ?? 100) / MAX_HEALTH) * 100}%` }}
                />
              </div>
            </div>
            <div className="ctf-hud-buttons flex gap-2 w-full mt-2">
              <button
                onClick={openTrivia}
                className="ctf-hud-btn flex-1 bg-gradient-to-r from-yellow-500 to-amber-600 hover:from-yellow-400 hover:to-amber-500 text-slate-900 font-black py-2 md:py-3 rounded-xl md:rounded-2xl flex items-center justify-center gap-1.5 md:gap-2 shadow-lg hover:scale-105 transition-transform text-sm md:text-base"
              >
                <BookOpen className="w-4 h-4 md:w-5 md:h-5" />
                +תחמושת
              </button>
              <button
                onClick={toggleShop}
                className="ctf-hud-btn flex-1 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-black py-2 md:py-3 rounded-xl md:rounded-2xl flex items-center justify-center gap-1.5 md:gap-2 shadow-lg hover:scale-105 transition-transform text-sm md:text-base"
              >
                <ShoppingCart className="w-4 h-4 md:w-5 md:h-5" />
                חנות
              </button>
            </div>
            {isDead && (
              <div className="text-red-500 font-black text-xl animate-bounce bg-slate-900/95 border-2 border-red-500/50 px-6 py-3 rounded-2xl shadow-[0_0_30px_rgba(239,68,68,0.3)] flex items-center gap-3 mt-4">
                <ShieldAlert className="w-8 h-8" />
                חזרה בעוד {Math.ceil(myPlayer.modeState?.respawnTimer ?? 0)}...
              </div>
            )}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="absolute top-40 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3 z-20 pointer-events-none w-full max-w-lg">
        {messages.map((msg) => (
          <div key={msg.id} className="bg-slate-800/95 text-white px-8 py-3 rounded-full shadow-2xl border border-slate-600/50 font-bold text-lg animate-in fade-in duration-300">
            {msg.text}
          </div>
        ))}
      </div>

      {/* Shop */}
      {showShop && myPlayer && (
        <div className="absolute inset-0 bg-slate-950/90 z-40 flex items-center justify-center backdrop-blur-md pointer-events-auto">
          <div className="bg-slate-900 p-8 rounded-3xl border-2 border-indigo-500 shadow-[0_0_50px_rgba(99,102,241,0.2)] max-w-4xl w-full flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center mb-6 border-b border-slate-700 pb-4">
              <div className="flex items-center gap-3">
                <ShoppingCart className="w-8 h-8 text-indigo-400" />
                <h2 className="text-3xl font-black text-white">חנות נשקים</h2>
              </div>
              <div className="flex items-center gap-2 bg-slate-800 px-4 py-2 rounded-xl border border-slate-700">
                <span className="text-slate-400 font-bold">יתרה:</span>
                <span className="text-yellow-400 font-black text-2xl">
                  {myPlayer.modeState?.coins ?? 0} <Coins className="inline w-5 h-5" />
                </span>
              </div>
              <button onClick={toggleShop} className="text-slate-400 hover:text-white">
                <XCircle className="w-8 h-8" />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto pr-2 pb-4">
              {CTF_WEAPON_LIST.map((w, idx) => {
                const isOwned = (myPlayer.modeState?.inventory || []).includes(w.id);
                const isEquipped = myPlayer.modeState?.currentWeapon === w.id;
                const canAfford = (myPlayer.modeState?.coins ?? 0) >= w.cost;
                return (
                  <div
                    key={w.id}
                    className={`bg-slate-800 p-5 rounded-2xl border-2 flex flex-col ${
                      isEquipped ? 'border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.3)]' : 'border-slate-700'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="text-xl font-black" style={{ color: w.color }}>
                        {w.name}
                      </h3>
                      <span className="text-slate-500 font-bold text-sm bg-slate-900 px-2 py-1 rounded">נשק {idx + 1}</span>
                    </div>
                    <p className="text-slate-400 text-sm mb-4 h-10">{w.desc}</p>
                    <div className="space-y-2 mb-4 bg-slate-900/50 p-3 rounded-xl text-sm font-mono">
                      <div className="flex justify-between">
                        <span className="text-slate-500">נזק:</span> <span className="text-red-400 font-bold">{w.damage}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">קצב אש:</span>{' '}
                        <span className="text-yellow-400 font-bold">{(1 / w.fireRate).toFixed(1)}/s</span>
                      </div>
                      {w.pellets > 1 && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">כדורים:</span> <span className="text-orange-400 font-bold">{w.pellets} לירייה</span>
                        </div>
                      )}
                    </div>
                    <div className="mt-auto">
                      {isEquipped ? (
                        <button disabled className="w-full py-3 bg-emerald-600/20 text-emerald-400 border border-emerald-500/50 rounded-xl font-bold flex justify-center items-center gap-2">
                          <CheckCircle className="w-5 h-5" /> מצויד
                        </button>
                      ) : isOwned ? (
                        <button
                          onClick={() => buyOrEquipWeapon(w.id)}
                          className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold transition-colors"
                        >
                          החלף נשק
                        </button>
                      ) : (
                        <button
                          onClick={() => buyOrEquipWeapon(w.id)}
                          disabled={!canAfford}
                          className={`w-full py-3 rounded-xl font-black flex justify-center items-center gap-2 transition-all ${
                            canAfford ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg' : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                          }`}
                        >
                          קנה ב- {w.cost} <Coins className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Question panel — continuous: correct grants reward and loads next question; user closes manually */}
      {showQuestion && (
        <div className="absolute inset-0 bg-slate-950/80 z-40 flex items-center justify-center backdrop-blur-sm pointer-events-auto">
          <div className="bg-slate-900 p-8 rounded-3xl border-4 border-yellow-500 shadow-[0_0_50px_rgba(234,179,8,0.2)] max-w-lg w-full relative">
            <div className="flex items-center justify-between mb-6 gap-4">
              <div className="flex items-center justify-center flex-1">
                <BookOpen className="w-12 h-12 text-yellow-400 mr-3" />
                <h2 className="text-3xl font-black text-white text-center">שעת חידון!</h2>
              </div>
              <button
                onClick={() => setShowQuestion(false)}
                className="px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-xl font-bold text-lg shadow-lg border-2 border-amber-400 shrink-0"
              >
                סגור
              </button>
            </div>
            <QuestionPanel
              questions={mappedQuestions}
              onCorrect={onCorrect}
              onWrong={onWrong}
              earnLabel="+25 כדורים | +50 מטבעות"
              disabled={isDead}
              compact
            />
          </div>
        </div>
      )}

      {/* Game over */}
      {gameOver && (
        <div className="absolute inset-0 bg-slate-950/90 z-50 flex items-center justify-center backdrop-blur-md">
          <div className="bg-slate-900 p-16 rounded-[3rem] text-center border-4 border-slate-700 shadow-[0_0_100px_rgba(0,0,0,0.5)] transform scale-110">
            <Trophy className={`w-32 h-32 mx-auto mb-8 drop-shadow-2xl ${gameOver === 'red' ? 'text-red-500' : 'text-blue-500'}`} />
            <h2 className="text-6xl font-black text-white mb-4 tracking-tight">
              ניצחון לצוות ה{gameOver === 'red' ? 'אדום' : 'כחול'}!
            </h2>
          </div>
        </div>
      )}
    </div>
  );
}
