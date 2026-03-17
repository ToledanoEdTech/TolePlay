export type RenderLerpState2D = {
  renderX: number;
  renderY: number;
  renderAngle: number;
  targetX: number;
  targetY: number;
  targetAngle: number;
};

export function wrapAngleRad(a: number): number {
  // Normalize to (-PI, PI]
  let x = a;
  const twoPi = Math.PI * 2;
  x = ((x % twoPi) + twoPi) % twoPi;
  if (x > Math.PI) x -= twoPi;
  return x;
}

export function lerpAngleRad(current: number, target: number, factor: number): number {
  const c = wrapAngleRad(current);
  const t = wrapAngleRad(target);
  const delta = wrapAngleRad(t - c);
  return wrapAngleRad(c + delta * factor);
}

export function ensureRemoteState(
  map: Record<string, RenderLerpState2D>,
  id: string,
  x: number,
  y: number,
  angle: number
): RenderLerpState2D {
  const existing = map[id];
  if (existing) return existing;
  const a = Number.isFinite(angle) ? angle : 0;
  const nx = Number.isFinite(x) ? x : 0;
  const ny = Number.isFinite(y) ? y : 0;
  const st: RenderLerpState2D = {
    renderX: nx,
    renderY: ny,
    renderAngle: a,
    targetX: nx,
    targetY: ny,
    targetAngle: a,
  };
  map[id] = st;
  return st;
}

export function stepRemoteLerp(state: RenderLerpState2D, factor: number) {
  state.renderX += (state.targetX - state.renderX) * factor;
  state.renderY += (state.targetY - state.renderY) * factor;
  state.renderAngle = lerpAngleRad(state.renderAngle, state.targetAngle, factor);
}

