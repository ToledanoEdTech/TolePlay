import React, { useEffect, useMemo, useState } from 'react';

type Props = {
  mode: string | null;
  players: Record<string, any>;
  localPlayerId: string;
  className?: string;
};

type Row = {
  id: string;
  name: string;
  value: number;
  subValue?: number;
};

function getMetric(mode: string | null, p: any): { value: number; label: string; subValue?: number } {
  const safe = (n: any) => (typeof n === 'number' && isFinite(n) ? n : 0);
  const m = mode || '';

  if (m === 'zombie') {
    const kills = safe(p?.modeState?.kills);
    const score = safe(p?.score);
    return { value: kills, subValue: score, label: 'KILLS' };
  }
  if (m === 'boss') {
    return { value: safe(p?.score), label: 'SCORE' };
  }
  if (m === 'economy') {
    return { value: safe(p?.resources), label: 'GOLD' };
  }
  if (m === 'ctf') {
    const coins = safe(p?.modeState?.coins);
    const score = safe(p?.score);
    return { value: coins || score, subValue: coins ? score : undefined, label: 'COINS' };
  }
  if (m === 'farm') {
    return { value: safe(p?.score), label: 'ORE' };
  }
  return { value: safe(p?.score), label: 'SCORE' };
}

function Medal({ rank }: { rank: 1 | 2 | 3 }) {
  const color = rank === 1 ? '#fbbf24' : rank === 2 ? '#cbd5e1' : '#fb923c';
  const text = rank === 1 ? '1' : rank === 2 ? '2' : '3';
  return (
    <div
      style={{
        width: 18,
        height: 18,
        borderRadius: 999,
        display: 'grid',
        placeItems: 'center',
        background: `radial-gradient(circle at 30% 25%, rgba(255,255,255,0.55), rgba(255,255,255,0.05)), ${color}`,
        boxShadow: `0 0 0 1px rgba(255,255,255,0.14), 0 10px 18px rgba(0,0,0,0.35), 0 0 18px ${color}55`,
        fontSize: 11,
        fontWeight: 900,
        color: '#0b1220',
      }}
      aria-label={`rank-${rank}`}
    >
      {text}
    </div>
  );
}

export function Leaderboard({ mode, players, localPlayerId, className }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia ? window.matchMedia('(max-width: 768px)') : null;
    const apply = () => {
      const mobile = !!mq?.matches;
      setIsMobile(mobile);
      // Mobile default: collapsed so it never blocks the view.
      if (mobile) setCollapsed(true);
    };
    apply();
    if (!mq) return;
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, []);

  const { rows, label } = useMemo(() => {
    const list: Row[] = Object.entries(players || {}).map(([id, p]) => {
      const metric = getMetric(mode, p);
      return {
        id,
        name: String(p?.name || 'Player').slice(0, 18),
        value: metric.value,
        subValue: metric.subValue,
      };
    });
    list.sort((a, b) => (b.value - a.value) || ((b.subValue ?? 0) - (a.subValue ?? 0)) || a.name.localeCompare(b.name));
    const metricLabel = getMetric(mode, players?.[localPlayerId]).label;
    return { rows: list, label: metricLabel };
  }, [players, localPlayerId, mode]);

  const top = rows.slice(0, 8);

  return (
    <div
      className={className}
      style={{
        position: 'absolute',
        // Below minimap on all screens (Zombie minimap ~180–200px from top)
        top: 'max(220px, 18vh)',
        right: 'calc(env(safe-area-inset-right, 0px) + 0.65rem)',
        width: 'clamp(10.5rem, 22vw, 15rem)',
        maxHeight: '36vh',
        pointerEvents: 'none',
        userSelect: 'none',
        zIndex: 200,
      }}
    >
      <style>
        {`
          @media (max-width: 768px) {
            .tp-leaderboard {
              top: calc(env(safe-area-inset-top, 0px) + 0.35rem) !important;
              right: calc(env(safe-area-inset-right, 0px) + 0.35rem) !important;
              width: min(10.25rem, 44vw) !important;
              max-height: 22vh !important;
              transform: scale(0.75) !important;
              transform-origin: top right !important;
            }
            .tp-leaderboard-header {
              padding: 0.35rem 0.45rem !important;
            }
            .tp-leaderboard-body {
              padding: 0.35rem !important;
              gap: 0.25rem !important;
              max-height: calc(22vh - 1.75rem) !important;
            }
            .tp-leaderboard-row {
              padding: 0.28rem 0.35rem !important;
              grid-template-columns: 18px 1fr auto !important;
              gap: 0.3rem !important;
              border-radius: 0.75rem !important;
            }
            .tp-leaderboard-mini-btn {
              position: fixed !important;
              top: calc(env(safe-area-inset-top, 0px) + 0.4rem) !important;
              right: calc(env(safe-area-inset-right, 0px) + 0.4rem) !important;
              width: 2.15rem !important;
              height: 2.15rem !important;
              border-radius: 999px !important;
              display: grid !important;
              place-items: center !important;
              pointer-events: auto !important;
              user-select: none !important;
              z-index: 220 !important;
              background: rgba(2,6,23,0.55) !important;
              border: 1px solid rgba(148,163,184,0.22) !important;
              box-shadow: 0 10px 26px rgba(0,0,0,0.55), inset 0 0 20px rgba(34,211,238,0.08) !important;
              backdrop-filter: blur(14px) !important;
              -webkit-backdrop-filter: blur(14px) !important;
            }
          }
        `}
      </style>
      {isMobile && collapsed && (
        <button
          type="button"
          className="tp-leaderboard-mini-btn"
          aria-label="open-leaderboard"
          onClick={() => setCollapsed(false)}
        >
          <span style={{ fontSize: 14, fontWeight: 950, color: 'rgba(226,232,240,0.95)', lineHeight: 1 }}>🏆</span>
        </button>
      )}

      {(!isMobile || !collapsed) && (
        <div
          className="tp-leaderboard"
          style={{
            background: 'rgba(8, 12, 20, 0.55)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            borderRadius: '1rem',
            border: '1px solid rgba(99, 102, 241, 0.35)',
            boxShadow:
              '0 0 0 1px rgba(56, 189, 248, 0.10), 0 18px 60px rgba(0,0,0,0.55), inset 0 0 24px rgba(99,102,241,0.12)',
            overflow: 'hidden',
            pointerEvents: 'auto',
          }}
        >
          <div
            className="tp-leaderboard-header"
            style={{
              padding: '0.55rem 0.6rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid rgba(148, 163, 184, 0.18)',
              background:
                'linear-gradient(90deg, rgba(99,102,241,0.18), rgba(34,211,238,0.10), rgba(2,6,23,0.0))',
            }}
          >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: 'rgba(34,211,238,0.95)',
                boxShadow: '0 0 18px rgba(34,211,238,0.8)',
              }}
            />
            <div style={{ fontWeight: 900, letterSpacing: '0.16em', color: '#e2e8f0', fontSize: '0.65rem' }}>
              LEADERBOARD
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontWeight: 800, letterSpacing: '0.18em', color: 'rgba(148,163,184,0.85)', fontSize: '0.55rem' }}>
              {label}
            </div>
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? 'expand-leaderboard' : 'collapse-leaderboard'}
              style={{
                pointerEvents: 'auto',
                cursor: 'pointer',
                border: '1px solid rgba(148,163,184,0.22)',
                background: 'rgba(2,6,23,0.35)',
                color: 'rgba(226,232,240,0.9)',
                borderRadius: 10,
                padding: '0.15rem 0.35rem',
                fontSize: '0.7rem',
                fontWeight: 900,
                lineHeight: 1,
              }}
            >
              {collapsed ? '+' : '–'}
            </button>
          </div>
        </div>

        {!collapsed && (
          <div className="tp-leaderboard-body" style={{ padding: '0.5rem', display: 'grid', gap: '0.35rem', overflowY: 'auto', maxHeight: 'calc(36vh - 2.1rem)' }}>
          {top.map((r, i) => {
            const rank = i + 1;
            const isMe = r.id === localPlayerId;
            const accent = rank === 1 ? '#fbbf24' : rank === 2 ? '#cbd5e1' : rank === 3 ? '#fb923c' : '#38bdf8';
            return (
              <div
                key={r.id}
                className="tp-leaderboard-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '22px 1fr auto',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.4rem 0.45rem',
                  borderRadius: '0.85rem',
                  background: isMe
                    ? 'linear-gradient(90deg, rgba(34,211,238,0.20), rgba(99,102,241,0.10), rgba(2,6,23,0.0))'
                    : 'rgba(2,6,23,0.22)',
                  border: `1px solid ${isMe ? 'rgba(34,211,238,0.35)' : 'rgba(148,163,184,0.12)'}`,
                  boxShadow: isMe ? '0 0 22px rgba(34,211,238,0.18)' : undefined,
                }}
              >
                <div style={{ display: 'grid', placeItems: 'center' }}>
                  {rank <= 3 ? <Medal rank={rank as 1 | 2 | 3} /> : (
                    <div style={{ color: 'rgba(148,163,184,0.75)', fontWeight: 900, fontSize: 12, width: 20, textAlign: 'center' }}>
                      {rank}
                    </div>
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        width: 6,
                        height: 16,
                        borderRadius: 999,
                        background: `linear-gradient(180deg, ${accent}, rgba(255,255,255,0.0))`,
                        boxShadow: rank <= 3 ? `0 0 16px ${accent}55` : undefined,
                      }}
                    />
                    <div
                      style={{
                        fontWeight: 900,
                        color: isMe ? '#67e8f9' : '#e2e8f0',
                        textShadow: isMe ? '0 0 18px rgba(34,211,238,0.35)' : undefined,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        fontSize: '0.72rem',
                      }}
                      title={r.name}
                    >
                      {r.name}{isMe ? ' (YOU)' : ''}
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '0.45rem',
                    justifyContent: 'flex-end',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  <div style={{ fontWeight: 950, color: rank <= 3 ? accent : '#e2e8f0', fontSize: '0.82rem' }}>
                    {Math.floor(r.value)}
                  </div>
                  {typeof r.subValue === 'number' && (
                    <div style={{ fontWeight: 800, color: 'rgba(148,163,184,0.75)', fontSize: '0.62rem' }}>
                      {Math.floor(r.subValue)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {rows.length === 0 && (
            <div style={{ padding: '0.6rem', color: 'rgba(148,163,184,0.75)', fontWeight: 800, textAlign: 'center', fontSize: '0.75rem' }}>
              Waiting for players…
            </div>
          )}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

