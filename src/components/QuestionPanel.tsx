import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface Question {
  q: string;
  opts: string[];
  a: number;
}

interface Props {
  questions: Question[];
  onCorrect: () => void;
  onWrong?: () => void;
  disabled?: boolean;
  earnLabel?: string;
  penaltySeconds?: number;
  compact?: boolean;
  /** When true, question text is static and readable (no rapid transitions). */
  staticDisplay?: boolean;
  /** When true, panel is active/open and may initialize a question once. */
  isOpen?: boolean;
  /** Changes whenever the modal is re-opened (forces a single re-init). */
  sessionId?: number;
}

interface ConfettiPiece {
  x: number; y: number;
  vx: number; vy: number;
  rotation: number; rotSpeed: number;
  color: string; size: number;
  life: number;
}

export function QuestionPanel({
  questions,
  onCorrect,
  onWrong,
  disabled,
  earnLabel = '+10',
  penaltySeconds = 3,
  compact,
  staticDisplay = false,
  isOpen = true,
  sessionId = 0,
}: Props) {
  // IMPORTANT: do not "advance questions" from effects.
  // We only set a question (A) once when opened, and (B) after user answers.
  const [currentQ, setCurrentQ] = useState<Question | null>(null);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [locked, setLocked] = useState(false);
  const [lockTime, setLockTime] = useState(0);
  const [showFloat, setShowFloat] = useState(false);
  const confettiRef = useRef<ConfettiPiece[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const lastAnswerAtRef = useRef(0);
  const didInitForOpenRef = useRef(false);
  const setCountRef = useRef(0);
  const [debugSetInfo, setDebugSetInfo] = useState<{ count: number; reason: string } | null>(null);

  const cloneQuestion = useCallback((q: Question | null): Question | null => {
    if (!q) return null;
    // Defensive deep clone so upstream mutations (ticks/reorders) cannot change what the modal shows.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sc = (globalThis as any).structuredClone;
      if (typeof sc === 'function') return sc(q);
    } catch {
      // ignore and fall back
    }
    return {
      q: String(q.q ?? ''),
      opts: Array.isArray(q.opts) ? q.opts.map(o => String(o)) : [],
      a: typeof q.a === 'number' ? q.a : 0,
    };
  }, []);

  const pickRandom = useCallback((): Question | null => {
    if (!Array.isArray(questions) || questions.length === 0) return null;
    const raw = questions[Math.floor(Math.random() * questions.length)] ?? null;
    return cloneQuestion(raw as any);
  }, [questions, cloneQuestion]);

  const setQuestion = useCallback((reason: string) => {
    const q = pickRandom();
    setCurrentQ(q);
    setCountRef.current += 1;
    setDebugSetInfo({ count: setCountRef.current, reason });
  }, [pickRandom]);

  // (A) Initialize a question ONCE per modal open (sessionId).
  useEffect(() => {
    if (!isOpen) {
      didInitForOpenRef.current = false;
      return;
    }
    if (didInitForOpenRef.current) return;
    didInitForOpenRef.current = true;
    lastAnswerAtRef.current = 0;
    if (!questions.length) {
      setCurrentQ(null);
      return;
    }
    setFeedback(null);
    setLocked(false);
    setLockTime(0);
    setShowFloat(false);
    setQuestion('init');
  }, [isOpen, sessionId]); // strict: only re-init on explicit open/session change

  useEffect(() => {
    // Never set state on every render. Only unlock when we were locked.
    if (lockTime <= 0) {
      if (locked) setLocked(false);
      return;
    }
    const t = setTimeout(() => setLockTime(prev => prev - 1), 1000);
    return () => clearTimeout(t);
  }, [lockTime, locked]);

  // Confetti canvas renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (confettiRef.current.length > 0) {
        confettiRef.current = confettiRef.current.filter(p => {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.12;
          p.vx *= 0.99;
          p.rotation += p.rotSpeed;
          p.life -= 0.012;
          if (p.life <= 0) return false;

          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.globalAlpha = Math.min(1, p.life * 2);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();
          return true;
        });
      }
      rafRef.current = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const spawnConfetti = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const colors = ['#22c55e', '#10b981', '#34d399', '#6ee7b7', '#a7f3d0', '#fbbf24', '#f59e0b'];
    const cx = canvas.width / 2;
    const cy = canvas.height * 0.3;
    for (let i = 0; i < 30; i++) {
      confettiRef.current.push({
        x: cx + (Math.random() - 0.5) * 60,
        y: cy + (Math.random() - 0.5) * 20,
        vx: (Math.random() - 0.5) * 8,
        vy: -Math.random() * 6 - 2,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.3,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.random() * 6 + 3,
        life: 1,
      });
    }
  }, []);

  const next = useCallback(() => {
    setFeedback(null);
    setQuestion('next-button');
  }, [setQuestion]);

  const answer = (i: number) => {
    if (feedback || locked || disabled || !questions.length) return;
    // Prevent double-firing from pointer+click (or touch) events.
    if (Date.now() - lastAnswerAtRef.current < (staticDisplay ? 800 : 250)) return;
    lastAnswerAtRef.current = Date.now();
    if (!currentQ) return;
    const correct = i === currentQ.a;

    if (correct) {
      setFeedback('correct');
      setShowFloat(true);
      spawnConfetti();
      onCorrect();
      // Do NOT auto-advance. User explicitly clicks "next question".
    } else {
      setFeedback('wrong');
      onWrong?.();
      setLocked(true);
      setLockTime(penaltySeconds);
      // Do NOT auto-advance. User explicitly clicks "next question".
    }
  };

  if (!questions.length) return <div className="p-6 text-center text-slate-300">אין שאלות זמינות</div>;
  if (!currentQ) return null;
  const q = currentQ;

  return (
    <div
      className={`relative ${compact ? 'p-3' : 'p-5'} text-white flex flex-col`}
      tabIndex={-1}
      onKeyDownCapture={(e) => {
        // Prevent "held key" (Space/Enter) from auto-clicking buttons and cycling questions.
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {/* Correct feedback: fixed banner at top, never overlaps question */}
      <AnimatePresence>
        {showFloat && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="w-full mb-4 py-3 px-4 rounded-xl bg-emerald-600/90 border-2 border-emerald-400 text-center z-10 shrink-0"
            style={{ color: '#fff', fontWeight: 'bold', boxShadow: '0 0 20px rgba(16,185,129,0.4)' }}
          >
            <span className="text-lg md:text-xl">נכון!</span>
            <span className="block text-sm md:text-base mt-1 text-emerald-100">{earnLabel}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <canvas
        ref={canvasRef}
        width={400}
        height={80}
        className="absolute top-0 left-0 right-0 h-[80px] pointer-events-none z-0 opacity-0"
        aria-hidden
      />

      <AnimatePresence>
        {locked && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="bg-red-950/60 border border-red-500/30 rounded-xl p-3 mb-3 text-center backdrop-blur-sm"
          >
            <span className="text-red-400 font-bold text-sm">תשובה שגויה! ⏳ {lockTime} שניות</span>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        key={staticDisplay ? `static-${sessionId}` : `q-${sessionId}`}
        initial={staticDisplay ? false : { opacity: 0.85 }}
        animate={{ opacity: 1, ...(feedback === 'wrong' ? { x: [-8, 8, -8, 8, -4, 4, 0] } : {}) }}
        transition={{ duration: staticDisplay ? 0 : 0.3 }}
        className={`relative z-20 transition-colors duration-300 rounded-xl ${
          feedback === 'wrong' ? 'bg-red-500/8 -m-2 p-2' :
          feedback === 'correct' ? 'bg-emerald-500/5 -m-2 p-2' : ''
        }`}
      >
        {process.env.NODE_ENV !== 'production' && debugSetInfo && (
          <div className="mb-2 text-[10px] text-slate-500 text-center">
            Q-set #{debugSetInfo.count} ({debugSetInfo.reason})
          </div>
        )}
        <h3
          className={`font-bold text-center mb-4 text-white drop-shadow-sm ${compact ? 'text-lg' : 'text-xl'}`}
          style={{
            textShadow: '0 1px 2px rgba(0,0,0,0.5)',
            whiteSpace: 'normal',
            wordBreak: 'break-word',
            minHeight: staticDisplay ? '3em' : undefined,
          }}
        >
          {q.q}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {q.opts.map((opt, i) => {
            const isCorrectOpt = feedback && i === q.a;
            const isWrongChosen = feedback === 'wrong' && i !== q.a;

            return (
              <motion.button
                key={`question-${sessionId}-answer-${i}`}
                whileTap={!feedback && !locked && !disabled ? { scale: 0.93 } : {}}
                whileHover={!feedback && !locked && !disabled ? { scale: 1.02 } : {}}
                disabled={!!feedback || locked || disabled}
                // Use pointer events only: prevents keyboard "auto-click" from held keys.
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onPointerUp={(e) => {
                  if (e.pointerType !== 'mouse' && e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
                  answer(i);
                }}
                className={`${compact ? 'p-3 text-sm' : 'p-4 text-base'} rounded-xl font-bold transition-all duration-200 border ${
                  isCorrectOpt
                    ? 'bg-emerald-500 text-white ring-2 ring-emerald-300 shadow-[0_0_25px_rgba(16,185,129,0.4)] border-emerald-400'
                    : feedback
                      ? 'bg-slate-700/80 text-slate-400 border-slate-600/50'
                      : locked || disabled
                        ? 'bg-slate-700/80 text-slate-400 cursor-not-allowed border-slate-600/50'
                        : 'bg-slate-600 hover:bg-slate-500 text-white shadow-md hover:shadow-lg border-slate-500 active:shadow-sm'
                }`}
              >
                {opt}
              </motion.button>
            );
          })}
        </div>

        <div className="mt-4 flex justify-center">
          <motion.button
            whileTap={feedback || locked ? { scale: 0.96 } : {}}
            disabled={!feedback || locked}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onPointerUp={(e) => {
              if (e.pointerType !== 'mouse' && e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
              setShowFloat(false);
              setLocked(false);
              setLockTime(0);
              next();
            }}
            className={`px-5 py-2.5 rounded-xl font-bold transition-all border ${
              !feedback || locked
                ? 'bg-slate-800/50 text-slate-500 border-slate-700 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-400/40 shadow-lg'
            }`}
          >
            שאלה הבאה
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}
