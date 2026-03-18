// Backwards-compatible wrapper exports.
// Prefer importing `SoundManager` directly for new code.
import { SoundManager } from './SoundManager';

export function playShootSound() {
  SoundManager.playShootSound();
}

// Kept for legacy callers (laser/hit/error/success). Map to closest equivalents.
export function playLaserSound() {
  SoundManager.playShootSound();
}
export function playHitSound() {
  SoundManager.playWrongSound();
}
export function playErrorSound() {
  SoundManager.playWrongSound();
}
export function playSuccessSound() {
  SoundManager.playCorrectSound();
}

// New global API requested by UX spec.
export function playCollectSound() {
  SoundManager.playCollectSound();
}
export function playCorrectSound() {
  SoundManager.playCorrectSound();
}
export function playWrongSound() {
  SoundManager.playWrongSound();
}
