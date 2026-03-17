import { lerp, colorAlpha, drawGlow, roundRect } from './renderUtils';

export type FacingDir = 'down' | 'up' | 'left' | 'right';

export interface ProceduralPlayerColors {
  main: string;  // e.g. '#f59e0b'
  dark: string;  // e.g. '#d97706'
  light: string; // e.g. '#fde68a'
}

export interface ProceduralPlayerState {
  dir: FacingDir;
  /** 0..1. Smoothed blend between idle (0) and run (1). */
  run: number;
  /** Continuous phase for gait. */
  phase: number;
  /** Smoothed velocity for stable animation timing. */
  vx: number;
  vy: number;
}

/**
 * Premium-looking procedural character with math-driven animation.
 *
 * Tweakable knobs (feel free to adjust):
 * - RUN_FPS: affects limb swing speed when running
 * - RUN_BOB_AMP / IDLE_BOB_AMP: vertical motion
 * - LEAN_MAX: max body lean in radians
 * - RUN_BLEND_IN/OUT: smoothing into/out of running
 */
export class ProceduralPlayer {
  state: ProceduralPlayerState = {
    dir: 'down',
    run: 0,
    phase: 0,
    vx: 0,
    vy: 0,
  };

  update(dt: number, vx: number, vy: number) {
    const speed = Math.hypot(vx, vy);
    const moving = speed > 10;

    // Direction update (direct facing, no spinning).
    if (moving) {
      if (Math.abs(vx) > Math.abs(vy)) this.state.dir = vx >= 0 ? 'right' : 'left';
      else this.state.dir = vy >= 0 ? 'down' : 'up';
    }

    // Smooth velocity to prevent jittery limb timing (lerp is frame-rate independent here).
    const vFollow = 1 - Math.pow(0.001, dt);
    this.state.vx = lerp(this.state.vx, vx, vFollow);
    this.state.vy = lerp(this.state.vy, vy, vFollow);

    // Smooth run/idle blend (no snapping).
    // RUN_BLEND_* are "time to settle" style constants.
    const RUN_BLEND_IN = 1 - Math.pow(0.02, dt);  // faster to enter run
    const RUN_BLEND_OUT = 1 - Math.pow(0.2, dt);  // slower to exit run
    const targetRun = moving ? 1 : 0;
    this.state.run = lerp(this.state.run, targetRun, moving ? RUN_BLEND_IN : RUN_BLEND_OUT);

    // Phase advances faster when moving faster.
    const RUN_FPS = 7.5; // base cycles/sec
    const phaseSpeed = (RUN_FPS * (0.35 + Math.min(1.8, speed / 180))) * (Math.PI * 2);
    this.state.phase += phaseSpeed * dt * Math.max(0.05, this.state.run);
  }

  draw(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    opts: {
      isMe: boolean;
      name: string;
      colors: ProceduralPlayerColors;
      uiScale?: number;
    }
  ) {
    const now = performance.now() * 0.001;
    const { colors } = opts;
    const { dir, run, phase, vx, vy } = this.state;
    const speed = Math.hypot(vx, vy);

    // --- Animation values (idle <-> run blended) ---
    // Idle: gentle breathing + float
    const breathe = 1 + Math.sin(now * 2.2) * 0.025 * (1 - run);
    const idleBob = Math.sin(now * 1.4) * 2.2 * (1 - run);

    // Run: faster bob tied to gait phase + speed
    const RUN_BOB_AMP = 7.5;
    const runBob = Math.abs(Math.sin(phase)) * RUN_BOB_AMP * (0.55 + Math.min(0.65, speed / 240)) * run;

    // Lean into movement direction (but cap it, and blend with run).
    const LEAN_MAX = 0.18; // radians (~10°)
    const leanX = Math.max(-1, Math.min(1, vx / 220));
    const leanY = Math.max(-1, Math.min(1, vy / 220));
    // We lean sideways a bit when moving left/right; tiny pitch when moving up/down.
    const lean = (leanX * LEAN_MAX) * run + (Math.sin(phase) * 0.04) * run;

    // Limb swing: opposite pairs (left arm with right leg etc).
    const swing = Math.sin(phase) * (0.95 + Math.min(0.35, speed / 320)) * run;
    const swingAlt = Math.sin(phase + Math.PI) * (0.95 + Math.min(0.35, speed / 320)) * run;

    // Facing offsets (eyes/limbs shift slightly to direction).
    const faceX = dir === 'right' ? 6 : dir === 'left' ? -6 : 0;
    const faceY = dir === 'down' ? 3 : dir === 'up' ? -3 : 0;

    // Ground shadow (screen-aligned)
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 44, 42, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Label (screen-aligned)
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(opts.name, 1, -86);
    ctx.fillStyle = colorAlpha(colors.light, 0.95);
    ctx.fillText(opts.name, 0, -85);

    // Character: anchor at feet (y = 0 is ground contact)
    const baseY = -idleBob - runBob;
    ctx.translate(0, baseY);

    // Soft aura flare (premium touch)
    const auraAlpha = opts.isMe ? 0.22 : 0.12;
    drawGlow(ctx, 0, -38, 78, colors.main, auraAlpha);

    // Body transform (squash/stretch + lean)
    ctx.save();
    ctx.rotate(lean);
    const squash = 1 - run * 0.08 + Math.abs(Math.sin(phase)) * 0.03 * run;
    const stretch = 1 + run * 0.1 + (breathe - 1);
    ctx.scale(stretch, squash);

    // --- Limbs (behind body) ---
    // Legs: thick strokes with round caps, swing opposite.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const legLen = 30;
    const legY = 12;
    const legSpread = 16;
    const legSwing = swing * 0.85;
    const legSwingAlt = swingAlt * 0.85;

    const legGrad = ctx.createLinearGradient(0, -10, 0, 40);
    legGrad.addColorStop(0, colorAlpha(colors.dark, 0.95));
    legGrad.addColorStop(1, colorAlpha('#1f2937', 0.9));
    ctx.strokeStyle = legGrad;
    ctx.lineWidth = 11;

    drawLimb(ctx, -legSpread, legY, legLen, legSwing);
    drawLimb(ctx, legSpread, legY, legLen, legSwingAlt);

    // Arms: slightly higher, swing opposite to legs (kinematic feel).
    const armLen = 26;
    const armY = -18;
    const armSpread = 28;
    const armSwing = -legSwing * 1.1;
    const armSwingAlt = -legSwingAlt * 1.1;
    const armGrad = ctx.createLinearGradient(0, -40, 0, 20);
    armGrad.addColorStop(0, colorAlpha(colors.light, 0.95));
    armGrad.addColorStop(1, colorAlpha(colors.main, 0.95));
    ctx.strokeStyle = armGrad;
    ctx.lineWidth = 10;
    drawLimb(ctx, -armSpread, armY, armLen, armSwing);
    drawLimb(ctx, armSpread, armY, armLen, armSwingAlt);

    // --- Body (premium gold sphere) ---
    const bodyR = 34;
    const g = ctx.createRadialGradient(-12, -18, 8, 0, 0, bodyR + 12);
    g.addColorStop(0, '#fff7d1');              // specular highlight
    g.addColorStop(0.28, colors.light);
    g.addColorStop(0.55, colors.main);
    g.addColorStop(1, colors.dark);
    ctx.fillStyle = g;
    ctx.shadowColor = colorAlpha(colors.main, 0.35);
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(0, -18, bodyR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Rim outline for crispness
    ctx.strokeStyle = colorAlpha('#7c2d12', 0.55);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, -18, bodyR, 0, Math.PI * 2);
    ctx.stroke();

    // Headband flair (stylized)
    ctx.save();
    ctx.translate(0, -18);
    ctx.rotate(-0.1 + Math.sin(now * 3) * 0.03);
    const hbW = 58, hbH = 12;
    const hb = ctx.createLinearGradient(-hbW / 2, 0, hbW / 2, 0);
    hb.addColorStop(0, '#0ea5e9');
    hb.addColorStop(0.5, '#22c55e');
    hb.addColorStop(1, '#f43f5e');
    ctx.fillStyle = colorAlpha('#000', 0.25);
    roundRect(ctx, -hbW / 2 + 1, -bodyR * 0.62 + 1, hbW, hbH, 6);
    ctx.fill();
    ctx.fillStyle = hb;
    roundRect(ctx, -hbW / 2, -bodyR * 0.62, hbW, hbH, 6);
    ctx.fill();
    ctx.restore();

    // --- Face (eyes + mouth), shifted by direction ---
    ctx.save();
    ctx.translate(faceX, faceY - 18);

    // Eyes
    const eyeY = -6;
    const eyeX = 12;
    const eyeW = 9;
    const eyeH = 10;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(-eyeX, eyeY, eyeW, eyeH, 0, 0, Math.PI * 2);
    ctx.ellipse(eyeX, eyeY, eyeW, eyeH, 0, 0, Math.PI * 2);
    ctx.fill();

    // Pupils track direction + swing slightly when running
    const lookX = (dir === 'right' ? 3 : dir === 'left' ? -3 : 0) + Math.sin(phase) * 1.2 * run;
    const lookY = (dir === 'down' ? 2 : dir === 'up' ? -2 : 0) + Math.cos(phase) * 0.8 * run;
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.ellipse(-eyeX + lookX, eyeY + lookY, 3.6, 4.2, 0, 0, Math.PI * 2);
    ctx.ellipse(eyeX + lookX, eyeY + lookY, 3.6, 4.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eye sparkles
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.ellipse(-eyeX + lookX + 1.2, eyeY + lookY - 1.2, 1.4, 1.8, 0, 0, Math.PI * 2);
    ctx.ellipse(eyeX + lookX + 1.2, eyeY + lookY - 1.2, 1.4, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Mouth: smile at idle, more open on run
    const mouthY = 14;
    const mouthOpen = run * (0.25 + Math.abs(Math.sin(phase)) * 0.55);
    ctx.strokeStyle = colorAlpha('#1f2937', 0.9);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-10, mouthY);
    ctx.quadraticCurveTo(0, mouthY + 7 + mouthOpen * 10, 10, mouthY);
    ctx.stroke();

    // Tiny cheek blush highlight (premium warmth)
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = '#fb7185';
    ctx.beginPath();
    ctx.ellipse(-22, 6, 7, 5, 0, 0, Math.PI * 2);
    ctx.ellipse(22, 6, 7, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.restore(); // face

    ctx.restore(); // body transform
    ctx.restore(); // translate to (x,y)
  }
}

function drawLimb(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, swing: number) {
  // Simple 2-bone-ish feel using a single segment with curved tip.
  // swing is in "radians-ish" space already (sin output), so we scale it.
  const a = swing * 0.75;
  const ex = x + Math.sin(a) * 10;
  const ey = y + Math.cos(a) * len;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + Math.sin(a) * 6, y + len * 0.55, ex, ey);
  ctx.stroke();
  // Small "hand/foot" cap
  ctx.fillStyle = colorAlpha('#0b1220', 0.15);
  ctx.beginPath();
  ctx.arc(ex, ey, 5.5, 0, Math.PI * 2);
  ctx.fill();
}

