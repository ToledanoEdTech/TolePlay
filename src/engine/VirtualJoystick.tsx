import { useRef, useCallback } from 'react';

interface Props {
  onMove: (dx: number, dy: number) => void;
  onRelease: () => void;
  size?: number;
  className?: string;
  teamColor?: string;
}

export function VirtualJoystick({ onMove, onRelease, size = 120, className = '', teamColor }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(false);
  const centerRef = useRef({ x: 0, y: 0 });

  const maxDist = size / 2 - 18;

  const handleMove = useCallback((clientX: number, clientY: number) => {
    if (!activeRef.current || !stickRef.current) return;

    const dx = clientX - centerRef.current.x;
    const dy = clientY - centerRef.current.y;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, maxDist);

    let nx = 0, ny = 0;
    if (dist > 4) {
      nx = (dx / dist) * clamped;
      ny = (dy / dist) * clamped;
    }

    stickRef.current.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;

    if (dist > 8) {
      onMove(dx / dist, dy / dist);
    } else {
      onMove(0, 0);
    }
  }, [maxDist, onMove]);

  const handleEnd = useCallback(() => {
    activeRef.current = false;
    if (stickRef.current) {
      stickRef.current.style.transform = 'translate(-50%, -50%)';
    }
    onRelease();
  }, [onRelease]);

  const handleStart = useCallback((clientX: number, clientY: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    centerRef.current = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    activeRef.current = true;
    handleMove(clientX, clientY);
  }, [handleMove]);

  const borderColor = teamColor || 'rgba(148,163,184,0.3)';

  return (
    <div
      ref={containerRef}
      className={`relative rounded-full select-none touch-none ${className}`}
      style={{
        width: size, height: size,
        background: 'rgba(15,23,42,0.6)',
        border: `2px solid ${borderColor}`,
        backdropFilter: 'blur(8px)',
        touchAction: 'none',
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        handleStart(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => handleMove(e.clientX, e.clientY)}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        handleEnd();
      }}
      onPointerCancel={handleEnd}
    >
      <div
        className="absolute rounded-full"
        style={{
          inset: '18%',
          border: '1px solid rgba(148,163,184,0.12)',
        }}
      />
      <div
        ref={stickRef}
        className="absolute top-1/2 left-1/2 rounded-full shadow-lg"
        style={{
          width: size * 0.36,
          height: size * 0.36,
          transform: 'translate(-50%, -50%)',
          background: `radial-gradient(circle at 40% 35%, rgba(203,213,225,0.5), rgba(100,116,139,0.4))`,
          border: '1px solid rgba(203,213,225,0.35)',
          transition: 'box-shadow 0.15s',
        }}
      />
    </div>
  );
}
