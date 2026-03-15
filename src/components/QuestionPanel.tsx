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
}

interface ConfettiPiece {
  x: number; y: number;
  vx: number; vy: number;
  rotation: number; rotSpeed: number;
  color: string; size: number;
  life: number;
}

export function QuestionPanel({ questions, onCorrect, onWrong, disabled, earnLabel = '+10', penaltySeconds = 3, compact }: Props) {
  const [qIndex, setQIndex] = useState(() => Math.floor(Math.random() * Math.max(1, questions.length)));
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [locked, setLocked] = useState(false);
  const [lockTime, setLockTime] = useState(0);
  const [showFloat, setShowFloat] = useState(false);
  const confettiRef = useRef<ConfettiPiece[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (lockTime <= 0) { setLocked(false); return; }
    const t = setTimeout(() => setLockTime(prev => prev - 1), 1000);
    return () => clearTimeout(t);
  }, [lockTime]);

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
    setQIndex(Math.floor(Math.random() * questions.length));
  }, [questions.length]);

  const answer = (i: number) => {
    if (feedback || locked || disabled || !questions.length) return;
    const correct = i === questions[qIndex % questions.length]?.a;

    if (correct) {
      setFeedback('correct');
      setShowFloat(true);
      spawnConfetti();
      onCorrect();
      setTimeout(() => { setShowFloat(false); next(); }, 1200);
    } else {
      setFeedback('wrong');
      onWrong?.();
      setLocked(true);
      setLockTime(penaltySeconds);
      setTimeout(next, 1200);
    }
  };

  if (!questions.length) return <div className="p-6 text-center text-slate-300">אין שאלות זמינות</div>;
  const q = questions[qIndex % questions.length];
  if (!q) return null;

  return (
    <div className={`relative ${compact ? 'p-3' : 'p-5'} text-white flex flex-col`}>
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
        key={`q-${qIndex}`}
        initial={{ opacity: 0.85 }}
        animate={{ opacity: 1, ...(feedback === 'wrong' ? { x: [-8, 8, -8, 8, -4, 4, 0] } : {}) }}
        transition={{ duration: 0.3 }}
        className={`relative z-20 transition-colors duration-300 rounded-xl ${
          feedback === 'wrong' ? 'bg-red-500/8 -m-2 p-2' :
          feedback === 'correct' ? 'bg-emerald-500/5 -m-2 p-2' : ''
        }`}
      >
        <h3 className={`font-bold text-center mb-4 text-white drop-shadow-sm ${compact ? 'text-lg' : 'text-xl'}`} style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>{q.q}</h3>
        <div className="grid grid-cols-2 gap-2">
          {q.opts.map((opt, i) => {
            const isCorrectOpt = feedback && i === q.a;
            const isWrongChosen = feedback === 'wrong' && i !== q.a;

            return (
              <motion.button
                key={`question-${qIndex}-answer-${i}`}
                whileTap={!feedback && !locked && !disabled ? { scale: 0.93 } : {}}
                whileHover={!feedback && !locked && !disabled ? { scale: 1.02 } : {}}
                disabled={!!feedback || locked || disabled}
                onClick={() => answer(i)}
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
      </motion.div>
    </div>
  );
}
