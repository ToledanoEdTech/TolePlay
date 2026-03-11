import { useState, useEffect, useCallback } from 'react';
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

export function QuestionPanel({ questions, onCorrect, onWrong, disabled, earnLabel = '+10', penaltySeconds = 3, compact }: Props) {
  const [qIndex, setQIndex] = useState(() => Math.floor(Math.random() * Math.max(1, questions.length)));
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [locked, setLocked] = useState(false);
  const [lockTime, setLockTime] = useState(0);
  const [showFloat, setShowFloat] = useState(false);

  useEffect(() => {
    if (lockTime <= 0) { setLocked(false); return; }
    const t = setTimeout(() => setLockTime(prev => prev - 1), 1000);
    return () => clearTimeout(t);
  }, [lockTime]);

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
      onCorrect();
      setTimeout(() => { setShowFloat(false); next(); }, 700);
    } else {
      setFeedback('wrong');
      onWrong?.();
      setLocked(true);
      setLockTime(penaltySeconds);
      setTimeout(next, 700);
    }
  };

  if (!questions.length) return <div className="p-6 text-center text-slate-500">אין שאלות זמינות</div>;
  const q = questions[qIndex % questions.length];
  if (!q) return null;

  return (
    <div className={`relative ${compact ? 'p-3' : 'p-5'}`}>
      <AnimatePresence>
        {showFloat && (
          <motion.div
            initial={{ opacity: 1, y: 0, scale: 1 }}
            animate={{ opacity: 0, y: -50, scale: 2 }}
            exit={{ opacity: 0 }}
            className="absolute top-0 left-1/2 -translate-x-1/2 text-2xl font-black text-emerald-400 z-50 pointer-events-none drop-shadow-[0_0_10px_rgba(52,211,153,0.8)]"
          >
            {earnLabel}
          </motion.div>
        )}
      </AnimatePresence>

      {locked && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-red-950/80 border border-red-500/40 rounded-xl p-3 mb-3 text-center"
        >
          <span className="text-red-400 font-bold text-sm">תשובה שגויה! ⏳ {lockTime} שניות</span>
        </motion.div>
      )}

      <motion.div
        animate={feedback === 'wrong' ? { x: [-6, 6, -6, 6, 0] } : {}}
        transition={{ duration: 0.3 }}
        className={feedback === 'wrong' ? 'bg-red-500/10 rounded-xl -m-2 p-2' : ''}
      >
        <h3 className={`font-bold text-center mb-4 ${compact ? 'text-lg' : 'text-xl'}`}>{q.q}</h3>
        <div className="grid grid-cols-2 gap-2">
          {q.opts.map((opt, i) => (
            <motion.button
              key={`${qIndex}-${i}`}
              whileTap={!feedback && !locked && !disabled ? { scale: 0.93 } : {}}
              disabled={!!feedback || locked || disabled}
              onClick={() => answer(i)}
              className={`${compact ? 'p-3 text-sm' : 'p-4 text-base'} rounded-xl font-bold transition-all ${
                feedback
                  ? i === q.a
                    ? 'bg-emerald-500 text-white ring-2 ring-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.5)]'
                    : 'bg-slate-800 text-slate-600'
                  : locked || disabled
                    ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                    : 'bg-slate-700 hover:bg-slate-600 text-white shadow-md hover:shadow-lg'
              }`}
            >
              {opt}
            </motion.button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
