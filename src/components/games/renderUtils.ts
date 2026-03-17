// ── Shared game rendering utilities ──

export interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  color: string; size: number;
  gravity: number; friction: number;
  type: 'circle' | 'square' | 'spark';
  /** When true, particle scale goes to 0 as life decreases (for collection VFX). */
  scaleDown?: boolean;
}

export function createParticle(
  x: number, y: number, angle: number, speed: number,
  life: number, color: string, size: number,
  opts?: Partial<Pick<Particle, 'gravity' | 'friction' | 'type' | 'scaleDown'>>
): Particle {
  return {
    x, y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life, maxLife: life,
    color, size,
    gravity: opts?.gravity ?? 0,
    friction: opts?.friction ?? 1,
    type: opts?.type ?? 'circle',
    scaleDown: opts?.scaleDown,
  };
}

export function emitBurst(
  x: number, y: number, count: number,
  speed: number, life: number, color: string, size: number,
  opts?: Partial<Pick<Particle, 'gravity' | 'friction' | 'type' | 'scaleDown'>>
): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.4 + Math.random() * 0.6);
    const l = life * (0.6 + Math.random() * 0.4);
    const sz = size * (0.5 + Math.random() * 0.5);
    out.push(createParticle(x, y, a, s, l, color, sz, opts));
  }
  return out;
}

export function emitDirectional(
  x: number, y: number, angle: number, spread: number,
  count: number, speed: number, life: number, color: string, size: number,
  opts?: Partial<Pick<Particle, 'gravity' | 'friction' | 'type'>>
): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const a = angle + (Math.random() - 0.5) * spread;
    const s = speed * (0.5 + Math.random() * 0.5);
    out.push(createParticle(x, y, a, s, life * (0.7 + Math.random() * 0.3), color, size * (0.5 + Math.random() * 0.5), opts));
  }
  return out;
}

export function tickParticles(ctx: CanvasRenderingContext2D, particles: Particle[]): Particle[] {
  return particles.filter(p => {
    p.x += p.vx; p.y += p.vy;
    p.vy += p.gravity;
    p.vx *= p.friction; p.vy *= p.friction;
    p.life -= 1 / 60;
    if (p.life <= 0) return false;

    const alpha = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;

    if (p.type === 'spark') {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(p.vy, p.vx));
      ctx.fillRect(-p.size * 2, -p.size * 0.4, p.size * 4, p.size * 0.8);
      ctx.restore();
    } else if (p.type === 'square') {
      const s = p.size * alpha;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    } else {
      const r = p.scaleDown ? p.size * alpha : Math.max(0.2, p.size * alpha);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return true;
  });
}

/**
 * High-performance particle tick:
 * - Updates + draws in-place
 * - Compacts array without allocating a new one (reduces GC spikes)
 * - Uses delta-time (dt) rather than a fixed 1/60
 */
export function tickParticlesInPlace(ctx: CanvasRenderingContext2D, particles: Particle[], dt: number): void {
  const step = typeof dt === 'number' && dt > 0 ? Math.min(0.05, dt) : 1 / 60;
  let write = 0;
  for (let read = 0; read < particles.length; read++) {
    const p = particles[read];
    p.x += p.vx * step * 60;
    p.y += p.vy * step * 60;
    p.vy += p.gravity * step * 60;
    const f = Math.pow(p.friction, step * 60);
    p.vx *= f; p.vy *= f;
    p.life -= step;
    if (p.life <= 0) continue;

    const alpha = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;

    if (p.type === 'spark') {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(p.vy, p.vx));
      ctx.fillRect(-p.size * 2, -p.size * 0.4, p.size * 4, p.size * 0.8);
      ctx.restore();
    } else if (p.type === 'square') {
      const s = p.size * alpha;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    } else {
      const r = p.scaleDown ? p.size * alpha : Math.max(0.2, p.size * alpha);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    particles[write++] = p;
  }
  particles.length = write;
}

// ── Screen shake ──

export interface ShakeState {
  intensity: number;
  offsetX: number;
  offsetY: number;
}

export function triggerShake(s: ShakeState, intensity: number) {
  s.intensity = Math.max(s.intensity, intensity);
}

export function tickShake(s: ShakeState): { x: number; y: number } {
  if (s.intensity > 0.3) {
    s.offsetX = (Math.random() - 0.5) * s.intensity;
    s.offsetY = (Math.random() - 0.5) * s.intensity;
    s.intensity *= 0.88;
  } else {
    s.offsetX = 0; s.offsetY = 0; s.intensity = 0;
  }
  return { x: s.offsetX, y: s.offsetY };
}

// ── Starfield (space games) ──

export interface Star {
  x: number; y: number; z: number;
  brightness: number; size: number;
}

export function createStarfield(count: number, w: number, h: number): Star[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * w, y: Math.random() * h,
    z: Math.random(),
    brightness: Math.random() * 0.7 + 0.3,
    size: Math.random() * 1.8 + 0.4,
  }));
}

export function drawStarfield(ctx: CanvasRenderingContext2D, stars: Star[], w: number, h: number, speed: number = 0.3) {
  const t = Date.now() * 0.002;
  stars.forEach(star => {
    star.y += speed * (0.15 + star.z * 0.85);
    if (star.y > h + 5) { star.y = -5; star.x = Math.random() * w; }
    const twinkle = 0.65 + 0.35 * Math.sin(t * star.brightness + star.x);
    ctx.globalAlpha = star.brightness * twinkle;
    ctx.fillStyle = star.z > 0.7 ? '#e0e7ff' : star.z > 0.4 ? '#a5b4fc' : '#64748b';
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.size * (0.4 + star.z * 0.6), 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

// ── Drawing helpers ──

export function drawGlow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha: number = 0.25) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, colorAlpha(color, alpha));
  g.addColorStop(0.5, colorAlpha(color, alpha * 0.4));
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
}

export function drawBeam(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  color: string, width: number = 3, glowWidth: number = 12
) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.shadowBlur = glowWidth;
  ctx.shadowColor = color;
  ctx.strokeStyle = colorAlpha(color, 0.4);
  ctx.lineWidth = width * 3;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

  ctx.shadowBlur = glowWidth * 0.5;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = width * 0.4;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.restore();
}

export function drawHPBar(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  pct: number, color: string, bgColor: string = '#1f2937'
) {
  ctx.fillStyle = bgColor;
  roundRect(ctx, x - w / 2, y, w, h, h / 2);
  ctx.fill();
  if (pct > 0) {
    ctx.fillStyle = color;
    roundRect(ctx, x - w / 2, y, w * Math.max(0.02, pct), h, h / 2);
    ctx.fill();
  }
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

export function colorAlpha(color: string, alpha: number): string {
  const safeAlpha = typeof alpha === 'number' && !Number.isNaN(alpha) ? Math.max(0, Math.min(1, alpha)) : 0.8;
  if (color && typeof color === 'string') {
    const c = color.trim();
    // Support hsl() / hsla() for deterministic per-player coloring.
    if (c.startsWith('hsl(')) {
      const inner = c.slice(4, -1);
      return `hsla(${inner},${safeAlpha})`;
    }
    if (c.startsWith('hsla(')) {
      // Replace alpha component if present (best-effort).
      const inner = c.slice(5, -1);
      const parts = inner.split(',');
      if (parts.length >= 3) return `hsla(${parts[0]},${parts[1]},${parts[2]},${safeAlpha})`;
    }
  }
  if (color && typeof color === 'string' && color.startsWith('#')) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    const sr = Number.isNaN(r) ? 96 : Math.max(0, Math.min(255, r));
    const sg = Number.isNaN(g) ? 165 : Math.max(0, Math.min(255, g));
    const sb = Number.isNaN(b) ? 250 : Math.max(0, Math.min(255, b));
    return `rgba(${sr},${sg},${sb},${safeAlpha})`;
  }
  return `rgba(96,165,250,${safeAlpha})`;
}

export function lerpColor(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16), ag = parseInt(a.slice(3, 5), 16), ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16), bg = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

// ── Ambient dust / floating particles ──

export interface DustMote {
  x: number; y: number;
  vx: number; vy: number;
  size: number; alpha: number;
  phase: number;
}

export function createDust(count: number, w: number, h: number): DustMote[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * w, y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.3,
    vy: -Math.random() * 0.2 - 0.05,
    size: Math.random() * 1.5 + 0.5,
    alpha: Math.random() * 0.3 + 0.1,
    phase: Math.random() * Math.PI * 2,
  }));
}

export function drawDust(ctx: CanvasRenderingContext2D, dust: DustMote[], w: number, h: number, color: string = '#94a3b8') {
  const t = Date.now() * 0.001;
  dust.forEach(d => {
    d.x += d.vx + Math.sin(t + d.phase) * 0.15;
    d.y += d.vy;
    if (d.y < -5) { d.y = h + 5; d.x = Math.random() * w; }
    if (d.x < -5) d.x = w + 5;
    if (d.x > w + 5) d.x = -5;

    ctx.globalAlpha = d.alpha * (0.6 + 0.4 * Math.sin(t * 0.5 + d.phase));
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

// ── Parallax layers (deep space) ──

export interface ParallaxLayer {
  x: number; y: number; z: number;
  r: number; color: string; phase: number;
}

export function createParallaxNebulas(count: number, w: number, h: number): ParallaxLayer[] {
  const colors = ['#4c1d95', '#1e3a8a', '#0f766e', '#7c3aed', '#6366f1', '#0ea5e9'];
  return Array.from({ length: count }, () => ({
    x: Math.random() * w * 1.5 - w * 0.25,
    y: Math.random() * h * 1.5 - h * 0.25,
    z: Math.random() * 0.6 + 0.2,
    r: 80 + Math.random() * 180,
    color: colors[Math.floor(Math.random() * colors.length)],
    phase: Math.random() * Math.PI * 2,
  }));
}

export function drawParallaxNebulas(
  ctx: CanvasRenderingContext2D,
  layers: ParallaxLayer[],
  w: number, h: number,
  t: number, scrollY: number
) {
  layers.forEach(n => {
    const driftX = Math.sin(t * 0.15 + n.phase) * 8;
    const driftY = Math.cos(t * 0.12 + n.phase * 0.7) * 6;
    const x = n.x + driftX - scrollY * 0.02 * n.z;
    const y = n.y + driftY + scrollY * 0.05 * n.z;
    const alpha = (0.03 + 0.02 * n.z) * (0.7 + 0.3 * Math.sin(t * 0.2 + n.phase));
    ctx.globalAlpha = alpha;
    const g = ctx.createRadialGradient(x, y, 0, x, y, n.r);
    g.addColorStop(0, colorAlpha(n.color, 0.6));
    g.addColorStop(0.5, colorAlpha(n.color, 0.2));
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, n.r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

// ── Asteroid explosion particles (rock chunks + energy) ──

export function emitAsteroidExplosion(
  x: number, y: number,
  rockColor: string, glowColor: string,
  count: number = 24
): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const s = 2 + Math.random() * 6;
    const useRock = Math.random() < 0.6;
    out.push(createParticle(x, y, a, s, 0.4 + Math.random() * 0.4, useRock ? rockColor : glowColor, useRock ? 3 : 2, {
      gravity: 0.02, friction: 0.96, type: useRock ? 'square' : 'circle',
    }));
  }
  return out;
}

// ── Space Ore (collectible gem) ──

export interface OreGem {
  id: string;
  x: number; y: number;
  vx: number; vy: number;
  value: number;
  color: string;
  phase: number;
  collected: boolean;
}

export function drawOreGem(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, value: number, color: string,
  t: number, scale: number = 1
) {
  const pulse = 0.8 + 0.2 * Math.sin(t * 4);
  const bob = Math.sin(t * 3 + x * 0.01) * 3.5 * scale;
  const yy = y + bob;
  const size = (5 + value / 28) * scale * pulse;
  drawGlow(ctx, x, yy, size * 5, color, 0.28 * pulse);
  ctx.fillStyle = color;
  ctx.shadowBlur = 8;
  ctx.shadowColor = color;
  ctx.beginPath();
  // diamond shape
  ctx.moveTo(x, yy - size);
  ctx.lineTo(x + size * 0.85, yy);
  ctx.lineTo(x, yy + size * 1.05);
  ctx.lineTo(x - size * 0.85, yy);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = colorAlpha('#fff', 0.5);
  ctx.lineWidth = 1;
  ctx.stroke();

  // sparkle
  const sp = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 6 + x * 0.02));
  ctx.strokeStyle = colorAlpha('#ffffff', 0.25 * sp);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, yy - size * 1.6);
  ctx.lineTo(x, yy + size * 1.6);
  ctx.moveTo(x - size * 1.1, yy);
  ctx.lineTo(x + size * 1.1, yy);
  ctx.stroke();
}

// ── Muzzle flash ──

export function drawMuzzleFlash(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, angle: number,
  intensity: number, color: string = '#60a5fa'
) {
  const safeX = typeof x === 'number' && !Number.isNaN(x) ? x : 0;
  const safeY = typeof y === 'number' && !Number.isNaN(y) ? y : 0;
  const safeAngle = typeof angle === 'number' && !Number.isNaN(angle) ? angle : 0;
  const safeIntensity = typeof intensity === 'number' && !Number.isNaN(intensity) ? Math.max(0, Math.min(1, intensity)) : 0.5;
  const safeColor = color && typeof color === 'string' && color.startsWith('#') ? color : '#60a5fa';
  try {
    ctx.save();
    ctx.translate(safeX, safeY);
    ctx.rotate(safeAngle);
    ctx.globalAlpha = safeIntensity;
    const g = ctx.createLinearGradient(-15, 0, 15, 0);
    g.addColorStop(0, 'transparent');
    g.addColorStop(0.3, colorAlpha(safeColor, 0.8));
    g.addColorStop(0.5, colorAlpha('#ffffff', 0.9));
    g.addColorStop(0.7, colorAlpha(safeColor, 0.8));
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(-15, -4, 30, 8);
    ctx.restore();
  } catch (_) {
    try { ctx.restore(); } catch (_) {}
  }
}

// ── Standalone-style spaceship rendering ──

export function drawSpaceship(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  color: string,
  radius: number,
  opts?: {
    playerId?: string;
    name?: string;
    isLocal?: boolean;
    magnetRange?: number;
    hasShield?: boolean;
    shieldColor?: string;
    showGlow?: boolean;
    uiScale?: number;
  }
) {
  const safeX = typeof x === 'number' && !Number.isNaN(x) ? x : 0;
  const safeY = typeof y === 'number' && !Number.isNaN(y) ? y : 0;
  const safeAngle = typeof angle === 'number' && !Number.isNaN(angle) ? angle : 0;
  const safeR = typeof radius === 'number' && !Number.isNaN(radius) ? Math.max(4, radius) : 18;
  // Required player coloring logic (stable across clients)
  const pid = opts?.playerId ?? '';
  const hash = pid ? pid.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) : 0;
  const playerColor = pid ? `hsl(${hash % 360}, 80%, 60%)` : color;
  const safeColor = playerColor || (color && typeof color === 'string' ? color : '#60a5fa');
  const uiScale = typeof opts?.uiScale === 'number' && !Number.isNaN(opts.uiScale) ? Math.max(0.2, opts.uiScale) : 1;

  // local-only helpers (magnet ring + soft glow)
  if (opts?.isLocal && typeof opts?.magnetRange === 'number' && opts.magnetRange > 0) {
    ctx.beginPath();
    ctx.arc(safeX, safeY, opts.magnetRange, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  if (opts?.showGlow ?? true) {
    drawGlow(ctx, safeX, safeY, safeR + 22, safeColor, opts?.isLocal ? 0.18 : 0.1);
  }

  if (opts?.hasShield) {
    const shield = (opts.shieldColor && opts.shieldColor.startsWith('#')) ? opts.shieldColor : '#3b82f6';
    ctx.beginPath();
    ctx.arc(safeX, safeY, safeR + 12, 0, Math.PI * 2);
    ctx.strokeStyle = colorAlpha(shield, 0.9);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = colorAlpha(shield, 0.15);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(safeX, safeY);
  ctx.rotate(safeAngle);

  ctx.shadowBlur = 14;
  ctx.shadowColor = safeColor;

  // main hull
  ctx.beginPath();
  ctx.moveTo(safeR, 0);
  ctx.lineTo(-safeR * 0.5, safeR * 0.4);
  ctx.lineTo(-safeR * 0.8, 0);
  ctx.lineTo(-safeR * 0.5, -safeR * 0.4);
  ctx.closePath();
  ctx.fillStyle = safeColor;
  ctx.fill();

  // fins (left/right)
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#334155';
  ctx.beginPath();
  ctx.moveTo(-safeR * 0.2, safeR * 0.3);
  ctx.lineTo(-safeR, safeR * 0.9);
  ctx.lineTo(-safeR * 0.7, safeR * 0.3);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-safeR * 0.2, -safeR * 0.3);
  ctx.lineTo(-safeR, -safeR * 0.9);
  ctx.lineTo(-safeR * 0.7, -safeR * 0.3);
  ctx.closePath();
  ctx.fill();

  // cockpit window
  ctx.beginPath();
  ctx.ellipse(safeR * 0.2, 0, safeR * 0.4, safeR * 0.15, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#bae6fd';
  ctx.fill();

  ctx.restore();

  // label
  if (opts?.name) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = `bold ${Math.max(10, Math.round(14 * uiScale))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(opts.name, safeX, safeY - safeR - Math.max(12, 18 * uiScale));
  }
}

// ── Standalone-style asteroid rendering (supports vertices + craters) ──

export function drawAsteroidStandalone(
  ctx: CanvasRenderingContext2D,
  asteroid: {
    x: number;
    y: number;
    radius: number;
    color?: string;
    rotation?: number;
    vertices?: number[];
    craters?: Array<{ dist: number; angle: number; size: number }>;
  },
  opts?: {
    outline?: string;
    shadowColor?: string;
    hpPct?: number;
  }
) {
  const ax = typeof asteroid.x === 'number' && !Number.isNaN(asteroid.x) ? asteroid.x : 0;
  const ay = typeof asteroid.y === 'number' && !Number.isNaN(asteroid.y) ? asteroid.y : 0;
  const r = typeof asteroid.radius === 'number' && !Number.isNaN(asteroid.radius) ? Math.max(6, asteroid.radius) : 20;
  const rot = typeof asteroid.rotation === 'number' && !Number.isNaN(asteroid.rotation) ? asteroid.rotation : 0;
  const baseColor = asteroid.color && asteroid.color.startsWith('#') ? asteroid.color : '#737373';
  const outline = (opts?.outline && opts.outline.startsWith('#')) ? opts.outline : 'rgba(255,255,255,0.2)';

  const verts = Array.isArray(asteroid.vertices) && asteroid.vertices.length >= 6
    ? asteroid.vertices
    : Array.from({ length: 10 }, () => 0.85 + Math.random() * 0.2);

  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(rot);

  const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  grad.addColorStop(0, baseColor);
  grad.addColorStop(1, '#111');

  ctx.beginPath();
  const n = verts.length;
  for (let j = 0; j < n; j++) {
    const a = (j / n) * Math.PI * 2;
    const rr = r * (typeof verts[j] === 'number' ? verts[j] : 0.9);
    const vx = Math.cos(a) * rr;
    const vy = Math.sin(a) * rr;
    if (j === 0) ctx.moveTo(vx, vy);
    else ctx.lineTo(vx, vy);
  }
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = outline;
  ctx.stroke();

  const craters = Array.isArray(asteroid.craters) ? asteroid.craters : [];
  for (const crater of craters) {
    if (!crater) continue;
    const dist = typeof crater.dist === 'number' && !Number.isNaN(crater.dist) ? crater.dist : 0.25;
    const ang = typeof crater.angle === 'number' && !Number.isNaN(crater.angle) ? crater.angle : 0;
    const size = typeof crater.size === 'number' && !Number.isNaN(crater.size) ? crater.size : 0.2;
    ctx.beginPath();
    const cx = Math.cos(ang) * r * dist;
    const cy = Math.sin(ang) * r * dist;
    ctx.arc(cx, cy, r * size, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.stroke();
  }

  ctx.restore();
}

// ── Thruster particles helper ──

export function emitThrusterParticles(
  x: number,
  y: number,
  angle: number,
  color: string,
  intensity: number,
  uiScale: number = 1
): Particle[] {
  const safeIntensity = typeof intensity === 'number' && !Number.isNaN(intensity) ? Math.max(0, Math.min(1, intensity)) : 0.5;
  const count = Math.round(3 + safeIntensity * 6);
  const speed = (2.2 + safeIntensity * 3.8) * uiScale;
  const life = 0.25 + safeIntensity * 0.25;
  return emitDirectional(x, y, angle, 0.6, count, speed, life, colorAlpha(color, 0.9), 2.2 * uiScale, {
    gravity: 0.02 * uiScale,
    friction: 0.92,
    type: 'spark',
  });
}
