// ── Shared game rendering utilities ──

export interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  color: string; size: number;
  gravity: number; friction: number;
  type: 'circle' | 'square' | 'spark';
}

export function createParticle(
  x: number, y: number, angle: number, speed: number,
  life: number, color: string, size: number,
  opts?: Partial<Pick<Particle, 'gravity' | 'friction' | 'type'>>
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
  };
}

export function emitBurst(
  x: number, y: number, count: number,
  speed: number, life: number, color: string, size: number,
  opts?: Partial<Pick<Particle, 'gravity' | 'friction' | 'type'>>
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
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.2, p.size * alpha), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return true;
  });
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

export function colorAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
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
