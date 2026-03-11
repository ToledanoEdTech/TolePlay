import type { Vec2 } from './types';

export interface InputState {
  keys: Record<string, boolean>;
  joystickDir: Vec2;
  joystickActive: boolean;
}

export function createInputState(): InputState {
  return {
    keys: {},
    joystickDir: { x: 0, y: 0 },
    joystickActive: false,
  };
}

export function getMoveDirection(input: InputState): Vec2 {
  if (input.joystickActive) {
    const len = Math.hypot(input.joystickDir.x, input.joystickDir.y);
    if (len > 0.15) return { x: input.joystickDir.x, y: input.joystickDir.y };
    return { x: 0, y: 0 };
  }

  let dx = 0, dy = 0;
  if (input.keys['w'] || input.keys['arrowup']) dy = -1;
  if (input.keys['s'] || input.keys['arrowdown']) dy = 1;
  if (input.keys['a'] || input.keys['arrowleft']) dx = -1;
  if (input.keys['d'] || input.keys['arrowright']) dx = 1;

  if (dx !== 0 && dy !== 0) {
    const len = Math.SQRT2;
    dx /= len;
    dy /= len;
  }

  return { x: dx, y: dy };
}

export function setupKeyboardListeners(input: InputState): () => void {
  const handleDown = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
      e.preventDefault();
      input.keys[key] = true;
    }
  };
  const handleUp = (e: KeyboardEvent) => {
    input.keys[e.key.toLowerCase()] = false;
  };
  const handleBlur = () => {
    for (const key in input.keys) input.keys[key] = false;
  };

  window.addEventListener('keydown', handleDown);
  window.addEventListener('keyup', handleUp);
  window.addEventListener('blur', handleBlur);

  return () => {
    window.removeEventListener('keydown', handleDown);
    window.removeEventListener('keyup', handleUp);
    window.removeEventListener('blur', handleBlur);
  };
}
