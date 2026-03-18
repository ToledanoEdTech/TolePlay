// Centralized procedural SFX (no external audio files).
// Uses Web Audio API and works across all games + quiz.

type SfxKind = 'shoot' | 'collect' | 'correct' | 'wrong' | 'hit' | 'explosion';

class SoundManagerImpl {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private lastPlayedAt: Record<SfxKind, number> = { shoot: 0, collect: 0, correct: 0, wrong: 0, hit: 0, explosion: 0 };

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    return this.ctx;
  }

  setEnabled(on: boolean) {
    this.enabled = !!on;
  }

  async resumeFromUserGesture() {
    const ctx = this.getContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { /* ignore */ }
    }
  }

  private shouldPlay(kind: SfxKind, minIntervalMs: number) {
    if (!this.enabled) return false;
    const now = Date.now();
    if (now - this.lastPlayedAt[kind] < minIntervalMs) return false;
    this.lastPlayedAt[kind] = now;
    return true;
  }

  private tone(opts: {
    type: OscillatorType;
    f0: number;
    f1?: number;
    dur: number;
    gain: number;
    sweep?: 'exp' | 'lin';
  }) {
    const ctx = this.getContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.f0, now);
    if (opts.f1 != null) {
      if (opts.sweep === 'lin') osc.frequency.linearRampToValueAtTime(opts.f1, now + opts.dur);
      else osc.frequency.exponentialRampToValueAtTime(Math.max(10, opts.f1), now + opts.dur);
    }
    g.gain.setValueAtTime(opts.gain, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + opts.dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + opts.dur);
  }

  playShootSound() {
    if (!this.shouldPlay('shoot', 35)) return;
    this.tone({ type: 'square', f0: 900, f1: 220, dur: 0.075, gain: 0.13, sweep: 'exp' });
  }

  playCollectSound() {
    if (!this.shouldPlay('collect', 80)) return;
    // short "coin" chirp
    this.tone({ type: 'sine', f0: 880, f1: 1320, dur: 0.06, gain: 0.09, sweep: 'lin' });
    setTimeout(() => this.tone({ type: 'sine', f0: 1320, f1: 1760, dur: 0.05, gain: 0.06, sweep: 'lin' }), 40);
  }

  playCorrectSound() {
    if (!this.shouldPlay('correct', 120)) return;
    this.tone({ type: 'sine', f0: 520, f1: 780, dur: 0.09, gain: 0.09, sweep: 'lin' });
    setTimeout(() => this.tone({ type: 'sine', f0: 780, f1: 1040, dur: 0.11, gain: 0.08, sweep: 'lin' }), 70);
  }

  playWrongSound() {
    if (!this.shouldPlay('wrong', 120)) return;
    this.tone({ type: 'sawtooth', f0: 240, f1: 110, dur: 0.18, gain: 0.11, sweep: 'exp' });
  }

  playHitSound() {
    if (!this.shouldPlay('hit', 60)) return;
    // quick "impact" ping
    this.tone({ type: 'square', f0: 320, f1: 80, dur: 0.08, gain: 0.08, sweep: 'exp' });
  }

  playExplosionSound() {
    if (!this.shouldPlay('explosion', 120)) return;
    // short bassy boom using two tones
    this.tone({ type: 'sawtooth', f0: 110, f1: 40, dur: 0.22, gain: 0.12, sweep: 'exp' });
    setTimeout(() => this.tone({ type: 'triangle', f0: 220, f1: 70, dur: 0.16, gain: 0.09, sweep: 'exp' }), 55);
  }
}

export const SoundManager = new SoundManagerImpl();

